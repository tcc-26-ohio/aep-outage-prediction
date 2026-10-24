"""Daily weather per region, from the Open-Meteo files that `bun run weather:pull` writes.

Weather is not part of Data1/Data2, so this only reports what has been downloaded:
historical gridded estimates (not archived forecasts), one grid sample per city.
"""

import csv
import datetime as dt
import json
from collections import defaultdict
from zoneinfo import ZoneInfo
from functools import lru_cache

from fastapi import APIRouter

from .layers import DATA
from .outlook import build

router = APIRouter(prefix="/api/weather", tags=["Weather"])
WEATHER_DIR = DATA / "weather"
LOCAL = ZoneInfo("America/New_York")  # damage reports are dated in local time; the weather files are UTC
KMH_TO_MPH, MM_TO_IN, CM_TO_IN = 0.621371, 1 / 25.4, 1 / 2.54


@lru_cache(maxsize=None)
def local_date(time_utc):
    stamp = dt.datetime.strptime(time_utc, "%Y-%m-%dT%H:%MZ").replace(tzinfo=dt.timezone.utc)
    return stamp.astimezone(LOCAL).date().isoformat()


def nearest_region(lat, lon, circuits):
    return min(circuits, key=lambda c: (c["lat"] - lat) ** 2 + ((c["lon"] - lon) * 0.8) ** 2)["region"]


def percentile(values, share):
    ordered = sorted(values)
    return ordered[min(len(ordered) - 1, int(len(ordered) * share))] if ordered else 0


@lru_cache(maxsize=1)
def load(directory=WEATHER_DIR):
    manifest = directory / "manifest.json"
    if not manifest.exists():
        return None
    cities = {c["city"]: c for c in json.loads(manifest.read_text()).get("cities", [])}
    circuits = build()["circuits"]
    # Per region per day: peak across the region's cities for wind, mean of cities for rain and snow.
    cells = defaultdict(lambda: defaultdict(lambda: {"gust": 0.0, "wind": 0.0, "rain": [], "snow": []}))
    for path in sorted(directory.glob("*_hourly.csv")):
        with path.open(newline="") as file:
            daily = defaultdict(lambda: {"gust": 0.0, "wind": 0.0, "rain": 0.0, "snow": 0.0})
            region = None
            for row in csv.DictReader(file):
                city = cities.get(row["city"])
                if not city:
                    break
                region = region or nearest_region(city["latitude"], city["longitude"], circuits)
                day = daily[local_date(row["time_utc"])]
                for key, column in (("gust", "wind_gusts_10m"), ("wind", "wind_speed_10m")):
                    if row[column]:
                        day[key] = max(day[key], float(row[column]))
                day["rain"] += float(row["rain"] or 0)
                day["snow"] += float(row["snowfall"] or 0)
        if region:
            for date, day in daily.items():
                cell = cells[date][region]
                cell["gust"] = max(cell["gust"], day["gust"]); cell["wind"] = max(cell["wind"], day["wind"])
                cell["rain"].append(day["rain"]); cell["snow"].append(day["snow"])
    days = {date: {region: {
        "gust": round(cell["gust"] * KMH_TO_MPH, 1), "wind": round(cell["wind"] * KMH_TO_MPH, 1),
        "rain": round(sum(cell["rain"]) / len(cell["rain"]) * MM_TO_IN, 2), "snow": round(sum(cell["snow"]) / len(cell["snow"]) * CM_TO_IN, 2),
    } for region, cell in regions.items()} for date, regions in cells.items()}
    # "Met" = in the top decile of all downloaded days for that variable.
    thresholds = {key: round(percentile([v[key] for regions in days.values() for v in regions.values() if v[key] > 0], 0.9), 2)
                  for key in ("gust", "wind", "rain", "snow")}
    return {"days": days, "thresholds": thresholds}


@router.get("")
def weather():
    data = load()
    if not data:
        load.cache_clear()  # let a later download be picked up without a restart
        return {"available": False, "command": "bun run weather:pull"}
    return {"available": True, **data, "attribution": "Weather data by Open-Meteo (https://open-meteo.com/), CC BY 4.0",
            "notice": "Historical gridded estimates, not archived forecasts or station observations."}
