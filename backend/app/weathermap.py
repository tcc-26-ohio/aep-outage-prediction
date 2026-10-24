"""Proxy for the weather tab's map: forecast/observed wind grid, stations, storm cells and tropical tracks.

Everything here is public data fetched on demand and cached:
  wind grid       Open-Meteo (live forecast + past hours, archive for observed, historical-forecast for archived forecasts)
  stations        NWS/FAA ASOS via the Iowa Environmental Mesonet
  storm cells     NEXRAD storm-cell attributes (position and motion) via the Iowa Environmental Mesonet
  tropical        NHC active storms + NOAA IBTrACS best tracks
Lightning is a WMS layer the browser loads straight from NOAA nowCOAST, so it is not proxied here.
"""

import csv
import datetime as dt
import json
import time
from functools import lru_cache
from urllib.error import URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from fastapi import APIRouter, HTTPException, Query

from .layers import DATA
from .outlook import build

router = APIRouter(prefix="/api/weathermap", tags=["Weather map"])
UA = {"User-Agent": "GridAhead-research/0.1"}
STEP = 0.5  # degrees between wind grid points
MARGIN = 1.5  # degrees of context around the circuits: the weather that is about to arrive matters too
HOURLY = "wind_speed_10m,wind_direction_10m,wind_gusts_10m,precipitation"
NETWORKS = ["VA_ASOS", "WV_ASOS", "NC_ASOS", "KY_ASOS", "TN_ASOS"]
IBTRACS = DATA / "tropical" / "ibtracs.last3years.csv"
IBTRACS_URL = "https://www.ncei.noaa.gov/data/international-best-track-archive-for-climate-stewardship-ibtracs/v04r01/access/csv/ibtracs.last3years.list.v04r01.csv"
KT_TO_MPH = 1.15078


def fetch_json(url, timeout=40):
    try:
        with urlopen(Request(url, headers=UA), timeout=timeout) as response:
            return json.load(response)
    except (URLError, TimeoutError, ValueError) as error:
        raise HTTPException(502, "A weather data provider is unavailable. Try again shortly.") from error


def fresh(minutes=15):
    """Cache key that changes every `minutes`, so live data refreshes without refetching on every request."""
    return int(time.time() // (minutes * 60))


@lru_cache(maxsize=1)
def bounds():
    circuits = build()["circuits"]
    return (min(c["lat"] for c in circuits) - MARGIN, min(c["lon"] for c in circuits) - MARGIN,
            max(c["lat"] for c in circuits) + MARGIN, max(c["lon"] for c in circuits) + MARGIN)


def in_bounds(lat, lon):
    south, west, north, east = bounds()
    return south <= lat <= north and west <= lon <= east


@lru_cache(maxsize=1)
def grid_axes():
    south, west, north, east = bounds()
    lats = [round(south + i * STEP, 3) for i in range(int((north - south) / STEP) + 1)]
    lons = [round(west + i * STEP, 3) for i in range(int((east - west) / STEP) + 1)]
    return lats, lons


@lru_cache(maxsize=32)
def wind_grid(mode, start, end, bucket):
    lats, lons = grid_axes()
    points = [(lat, lon) for lat in lats for lon in lons]
    params = {"latitude": ",".join(str(p[0]) for p in points), "longitude": ",".join(str(p[1]) for p in points),
              "hourly": HOURLY, "timezone": "UTC", "wind_speed_unit": "mph", "precipitation_unit": "inch"}
    if mode == "live":
        url = "https://api.open-meteo.com/v1/forecast?" + urlencode({**params, "past_hours": 24, "forecast_hours": 48})
    else:
        host = "archive-api.open-meteo.com/v1/archive" if mode == "observed" else "historical-forecast-api.open-meteo.com/v1/forecast"
        url = f"https://{host}?" + urlencode({**params, "start_date": start, "end_date": end})
    body = fetch_json(url, timeout=90)
    body = body if isinstance(body, list) else [body]
    times = [t + ":00Z" if len(t) == 16 else t for t in body[0]["hourly"]["time"]]
    series = lambda key: [[None if body[p]["hourly"][key][t] is None else round(body[p]["hourly"][key][t], 2) for p in range(len(points))] for t in range(len(times))]
    return {"lats": lats, "lons": lons, "step": STEP, "times": times, "wind": series("wind_speed_10m"), "dir": series("wind_direction_10m"),
            "gust": series("wind_gusts_10m"), "precip": series("precipitation"), "units": {"speed": "mph", "precip": "in"}}


def check_dates(start, end):
    try:
        first, last = dt.date.fromisoformat(start), dt.date.fromisoformat(end)
    except (TypeError, ValueError):
        raise HTTPException(422, "start and end must be YYYY-MM-DD dates.")
    if first > last or (last - first).days > 14:
        raise HTTPException(422, "Choose a range of 14 days or less.")
    return first, last


@router.get("/grid")
def grid(mode: str = Query("live", pattern="^(live|observed|forecast)$"), start: str = "", end: str = ""):
    if mode == "live":
        return {"mode": mode, **wind_grid(mode, "", "", fresh())}
    first, last = check_dates(start, end)
    return {"mode": mode, **wind_grid(mode, first.isoformat(), last.isoformat(), 0)}


@lru_cache(maxsize=8)
def currents(bucket):
    stations = {}
    for network in NETWORKS:
        for row in fetch_json(f"https://mesonet.agron.iastate.edu/api/1/currents.json?network={network}")["data"]:
            if row.get("lat") is not None and in_bounds(row["lat"], row["lon"]):
                stations[row["station"]] = row
    return stations


@lru_cache(maxsize=64)
def daily(network, date):
    return {row["station"]: row for row in fetch_json(f"https://mesonet.agron.iastate.edu/api/1/daily.json?network={network}&date={date}")["data"]}


@router.get("/stations")
def stations(date: str = ""):
    rows = currents(fresh())
    out = []
    if date:
        check_dates(date, date)
        days = {}
        for network in NETWORKS:
            days.update(daily(network, date))
        for station, row in rows.items():
            day = days.get(station)
            if day and (day.get("max_gust") is not None or day.get("precip") is not None):
                out.append({"id": station, "name": row["name"], "lat": row["lat"], "lon": row["lon"], "gust": day.get("max_gust"),
                            "wind": None, "precip": day.get("precip"), "temp": day.get("max_tmpf"), "time": date, "kind": "daily peak"})
    else:
        for station, row in rows.items():
            out.append({"id": station, "name": row["name"], "lat": row["lat"], "lon": row["lon"],
                        "wind": None if row.get("sknt") is None else round(row["sknt"] * KT_TO_MPH, 1),
                        "gust": None if row.get("gust") is None else round(row["gust"] * KT_TO_MPH, 1), "dir": row.get("drct"),
                        "precip": row.get("phour"), "temp": row.get("tmpf"), "time": row.get("utc_valid"), "kind": "latest"})
    return {"stations": out}


@lru_cache(maxsize=128)
def cells(valid, bucket):
    url = "https://mesonet.agron.iastate.edu/geojson/nexrad_attr.geojson" + (f"?valid={valid}" if valid else "")
    return fetch_json(url)["features"]


@router.get("/storms")
def storms(time: str = ""):
    if time:
        try:
            dt.datetime.fromisoformat(time.replace("Z", "+00:00"))
        except ValueError:
            raise HTTPException(422, "time must be an ISO timestamp.")
    out = []
    for feature in cells(time, 0 if time else fresh(5)):
        lon, lat = feature["geometry"]["coordinates"]
        p = feature["properties"]
        if in_bounds(lat, lon) and (p.get("max_dbz") or 0) >= 35:
            # NEXRAD reports the direction a cell is moving *from*, like wind.
            out.append({"id": f"{p['nexrad']}-{p['storm_id']}", "lat": round(lat, 4), "lon": round(lon, 4), "dir_from": p.get("drct"),
                        "speed_kt": p.get("sknt"), "dbz": p.get("max_dbz"), "hail_prob": p.get("posh"), "tvs": p.get("tvs"),
                        "meso": p.get("meso"), "vil": p.get("vil"), "radar": p["nexrad"], "valid": p.get("valid")})
    return {"cells": out}


@lru_cache(maxsize=1)
def ibtracs():
    if not IBTRACS.exists():
        IBTRACS.parent.mkdir(parents=True, exist_ok=True)
        try:
            with urlopen(Request(IBTRACS_URL, headers=UA), timeout=120) as response:
                temporary = IBTRACS.with_suffix(".part")
                temporary.write_bytes(response.read())
                temporary.replace(IBTRACS)
        except (URLError, TimeoutError) as error:
            raise HTTPException(502, "Tropical track archive is unavailable. Try again shortly.") from error
    tracks = {}
    with IBTRACS.open(newline="") as file:
        for row in csv.DictReader(file):
            try:
                lat, lon = float(row["LAT"]), float(row["LON"])
            except ValueError:
                continue  # the file has a units row under the header
            wind = float(row["USA_WIND"]) if row.get("USA_WIND", "").strip() else (float(row["WMO_WIND"]) if row.get("WMO_WIND", "").strip() else None)
            track = tracks.setdefault(row["SID"], {"id": row["SID"], "name": row["NAME"].title(), "points": []})
            track["points"].append([lat, lon, wind, row["ISO_TIME"].replace(" ", "T") + "Z"])
    return list(tracks.values())


@lru_cache(maxsize=1)
def active_storms(bucket):
    try:
        return [{"id": s["id"], "name": s["name"].title(), "class": s["classification"], "wind": float(s["intensity"]),
                 "lat": s["latitudeNumeric"], "lon": s["longitudeNumeric"], "dir": s.get("movementDir"), "speed": s.get("movementSpeed"),
                 "advisory": s["publicAdvisory"]["url"]} for s in fetch_json("https://www.nhc.noaa.gov/CurrentStorms.json")["activeStorms"]]
    except (KeyError, TypeError):
        return []


@router.get("/tropical")
def tropical(start: str = "", end: str = ""):
    if start:
        first, last = check_dates(start, end or start)
        low = (first - dt.timedelta(days=3)).isoformat()
        high = (last + dt.timedelta(days=4)).isoformat()
    else:
        low = (dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=10)).strftime("%Y-%m-%d")
        high = "9999"
    out = []
    for track in ibtracs():
        points = [p for p in track["points"] if low <= p[3] <= high]
        # Keep Atlantic / eastern Pacific systems that were in the window, and thin 3-hourly rows to 6-hourly.
        if points and any(-140 < p[1] < -40 and 0 < p[0] < 60 for p in points):
            out.append({**track, "points": points[::2] + ([points[-1]] if len(points) % 2 == 0 else [])})
    return {"tracks": out, "active": [] if start else active_storms(fresh()), "source": "NOAA NHC and IBTrACS (NCEI)"}
