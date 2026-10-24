"""Loads weather + ARCOS damage reports into tensors for the outage / restoration models."""

import json
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import pandas as pd
import shapefile

ROOT = Path(__file__).resolve().parents[2]
WEATHER_DIR = ROOT / "data" / "weather"
DAMAGE_SHP = ROOT / "data" / "Data1" / "arcos_prod_damage_09_28_Clip.shp"

WEATHER_COLS = ["temperature_2m", "precipitation", "rain", "snowfall", "wind_speed_10m", "wind_gusts_10m"]
LOG_COLS = {"precipitation", "rain", "snowfall"}
WINDOW_HOURS = 72
# Damage reports are date-only local dates; the window ends at 05:00 UTC the next day (~local midnight, EST).
DAY_END_OFFSET_H = 29
ASSET_TYPES = ["primary", "Pole", "Fuse Bank", "secondary", "Transformer", "Recloser Bank", "Switch", "Capacitor Bank"]
DAMAGE_TYPES = ["Damaged Wire", "Damaged Switch", "Damaged Pole", "Damaged Equipment", "Damaged Light"]


@dataclass
class Dataset:
    cities: list[str]
    start: pd.Timestamp
    weather: np.ndarray  # [city, hour, feature], normalised
    norm: dict  # per-feature mean/std (after log transform)
    damage: pd.DataFrame  # one row per damage report, with city_idx, day_idx, days_to_repair


def _load_weather():
    manifest = json.loads((WEATHER_DIR / "manifest.json").read_text())
    cities, frames = [], []
    for c in manifest["cities"]:
        path = WEATHER_DIR / f"{c['city'].lower().replace(' ', '_')}_{c['state'].lower()}_hourly.csv"
        if not path.exists():
            continue
        df = pd.read_csv(path, usecols=["time_utc", *WEATHER_COLS])
        df["time_utc"] = pd.to_datetime(df["time_utc"], utc=True).dt.tz_localize(None)
        frames.append(df.set_index("time_utc"))
        cities.append(c)
    start = min(f.index.min() for f in frames)
    end = max(f.index.max() for f in frames)
    index = pd.date_range(start, end, freq="h")
    arr = np.stack([f.reindex(index).interpolate(limit_direction="both").to_numpy(dtype=np.float32) for f in frames])
    for i, col in enumerate(WEATHER_COLS):
        if col in LOG_COLS:
            arr[:, :, i] = np.log1p(np.clip(arr[:, :, i], 0, None))
    mean, std = arr.mean(axis=(0, 1)), arr.std(axis=(0, 1)) + 1e-6
    norm = {"mean": mean.tolist(), "std": std.tolist()}
    return cities, start, (arr - mean) / std, norm


def _load_damage(cities, start):
    r = shapefile.Reader(str(DAMAGE_SHP))
    fields = [f[0] for f in r.fields[1:]]
    df = pd.DataFrame(r.records(), columns=fields)
    cl = np.array([[c["latitude"], c["longitude"]] for c in cities])
    d = np.hypot(df["Latitude"].to_numpy()[:, None] - cl[:, 0], (df["Longitude"].to_numpy()[:, None] - cl[:, 1]) * 0.8)
    df["city_idx"] = d.argmin(axis=1)
    report = pd.to_datetime(df["Report_Tim"])
    df["day_idx"] = (report - start.normalize()).dt.days
    # Repaired_D is the extract date (not a repair) for records still open, so those are censored.
    df["censored"] = df["Repaired"] != "Yes"
    df["days_to_repair"] = (pd.to_datetime(df["Repaired_D"]) - report).dt.days.clip(lower=0)
    return df


def load() -> Dataset:
    cities, start, weather, norm = _load_weather()
    damage = _load_damage(cities, start)
    return Dataset([c["city"] for c in cities], start, weather, norm, damage)


def window(ds_weather: np.ndarray, city_idx: int, day_idx: int) -> np.ndarray:
    """WINDOW_HOURS of normalised weather ending at the end of local day `day_idx`; edge-padded."""
    end = day_idx * 24 + DAY_END_OFFSET_H
    lo = end - WINDOW_HOURS
    n = ds_weather.shape[1]
    idx = np.clip(np.arange(lo, end), 0, n - 1)
    return ds_weather[city_idx, idx]


def season(day_idx: int, start: pd.Timestamp) -> np.ndarray:
    doy = (start.normalize() + pd.Timedelta(days=int(day_idx))).dayofyear
    a = 2 * np.pi * doy / 365.25
    return np.array([np.sin(a), np.cos(a)], dtype=np.float32)
