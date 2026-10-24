"""Download city-level historical weather estimates from Open-Meteo.

Uses customer-location centroids (not customer IDs) and the damage date range.
Requires the backend environment: .venv/bin/python scripts/download_weather.py
"""

import argparse
import csv
import datetime as dt
import hashlib
import json
import statistics
import sys
import time
from collections import defaultdict
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

import shapefile

ROOT = Path(__file__).resolve().parents[1]
API = "https://archive-api.open-meteo.com/v1/archive"
VARIABLES = ["temperature_2m", "precipitation", "rain", "snowfall", "wind_speed_10m", "wind_gusts_10m"]


def discover_cities(data):
    locations = defaultdict(list)
    with shapefile.Reader(str(data / "Data1/Customer_Clip.shp")) as reader:
        for item in reader.iterShapeRecords():
            record = item.record.as_dict()
            city = str(record.get("city", "")).strip().upper()
            # Exclude suspect state labels; the supplied network is in Virginia.
            if city and any(c.isalpha() for c in city) and record.get("state") == "VA" and item.shape.points:
                lon, lat = item.shape.points[0][:2]
                if -81 < lon < -79 and 36 < lat < 39:
                    locations[city].append((lat, lon))
    return [{"city": city, "state": "VA", "latitude": statistics.mean(p[0] for p in points),
             "longitude": statistics.mean(p[1] for p in points), "customer_records": len(points)}
            for city, points in sorted(locations.items())]


def damage_dates(data):
    with shapefile.Reader(str(data / "Data1/arcos_prod_damage_09_28_Clip.shp")) as reader:
        dates = [r.as_dict()["Report_Tim"] for r in reader.iterRecords()]
    dates = [d for d in dates if isinstance(d, dt.date)]
    if not dates:
        raise ValueError("No valid damage report dates found.")
    return min(dates), max(dates)


def chunks(start, end):
    while start <= end:
        stop = min(end, dt.date(start.year, 12, 31))
        yield start, stop
        start = stop + dt.timedelta(days=1)


def validate(payload):
    hourly = payload.get("hourly", {})
    times = hourly.get("time", [])
    if not times or any(len(hourly.get(v, [])) != len(times) for v in VARIABLES):
        raise ValueError("Incomplete hourly response from weather provider.")
    return payload


def fetch(params, cache, delay):
    url = API + "?" + urlencode(params)
    filename = cache / (hashlib.sha256(url.encode()).hexdigest() + ".json")
    if filename.exists():
        return validate(json.loads(filename.read_text()))
    for attempt in range(5):
        try:
            time.sleep(delay)
            with urlopen(Request(url, headers={"User-Agent": "GridAhead-research/0.1"}), timeout=90) as response:
                payload = validate(json.load(response))
            temporary = filename.with_suffix(".part")
            temporary.write_text(json.dumps(payload))
            temporary.replace(filename)
            return payload
        except HTTPError as error:
            if error.code not in (429, 500, 502, 503, 504) or attempt == 4:
                raise RuntimeError(f"Weather API HTTP {error.code}: {error.read().decode()[:500]}") from error
            time.sleep(max(2 ** (attempt + 1), 60 if error.code == 429 else 0))
        except (URLError, TimeoutError):
            if attempt == 4:
                raise
            time.sleep(2 ** (attempt + 1))
    raise RuntimeError("Weather request failed")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--city", action="append", help="City name; repeat to select multiple cities. Default: all dataset cities.")
    parser.add_argument("--start", type=dt.date.fromisoformat, help="YYYY-MM-DD; default: 7 days before first damage report")
    parser.add_argument("--end", type=dt.date.fromisoformat, help="YYYY-MM-DD; default: last report, capped for archive availability")
    parser.add_argument("--output", type=Path, default=ROOT / "data/weather")
    parser.add_argument("--list-cities", action="store_true", help="List derived city centroids without downloading")
    parser.add_argument("--delay", type=float, default=1.0, help="Seconds between uncached requests (default: 1)")
    args = parser.parse_args()
    if args.delay < 0:
        parser.error("--delay must not be negative")
    cities = discover_cities(ROOT / "data")
    if args.city:
        selected = {c.strip().upper() for c in args.city}
        unknown = selected - {c["city"] for c in cities}
        if unknown:
            parser.error("Cities not in dataset: " + ", ".join(sorted(unknown)))
        cities = [c for c in cities if c["city"] in selected]
    if args.list_cities:
        print(json.dumps(cities, indent=2)); return
    if not cities:
        parser.error("No supported cities found in customer dataset")
    earliest, latest = damage_dates(ROOT / "data")
    available_end = dt.datetime.now(dt.timezone.utc).date() - dt.timedelta(days=6)
    start = args.start or earliest - dt.timedelta(days=7)
    end = args.end or min(latest, available_end)
    if end > available_end:
        parser.error(f"Historical archive requires a lag. Choose --end {available_end} or earlier.")
    if start > end or start < dt.date(1940, 1, 1):
        parser.error("Invalid date range; start must be on/after 1940-01-01 and not after end")
    if args.end is None and latest > available_end:
        print(f"Note: damage reports extend to {latest}; archive download capped at {end}.")
    output = args.output.resolve(); cache = output / "raw"
    cache.mkdir(parents=True, exist_ok=True)
    metadata = {"provider": "Open-Meteo Historical Weather API", "source": API,
        "attribution": "Weather data by Open-Meteo (https://open-meteo.com/), CC BY 4.0; underlying reanalysis sources documented by provider.",
        "kind": "Historical gridded weather estimates, NOT archived forecasts or station observations",
        "timezone": "UTC", "start": str(start), "end": str(end), "damage_report_end": str(latest),
        "units": {"temperature_2m": "C", "precipitation": "mm", "rain": "mm", "snowfall": "cm", "wind_speed_10m": "km/h", "wind_gusts_10m": "km/h"},
        "location_method": "Customer-record-weighted city centroid; one grid sample per city, not asset-level exposure",
        "notes": ["Damage report dates need local-time alignment before joins.", "Rain and temperature do not directly measure freezing rain or ice accumulation.", "Nearby cities may share a weather grid cell."],
        "cities": cities, "files": [], "status": "in_progress"}
    manifest = output / "manifest.json"
    manifest.write_text(json.dumps(metadata, indent=2))
    for city in cities:
        slug = "".join(c.lower() if c.isalnum() else "_" for c in city["city"]) + "_va"
        destination = output / f"{slug}_hourly.csv"
        temporary = destination.with_suffix(".csv.part")
        total = 0; grids = []
        with temporary.open("w", newline="") as file:
            writer = csv.writer(file)
            writer.writerow(["city", "state", "requested_latitude", "requested_longitude", "grid_latitude", "grid_longitude", "time_utc", *VARIABLES])
            for first, last in chunks(start, end):
                print(f"{city['city']}: {first} through {last}", flush=True)
                payload = fetch({"latitude": round(city["latitude"], 5), "longitude": round(city["longitude"], 5),
                    "start_date": str(first), "end_date": str(last), "hourly": ",".join(VARIABLES),
                    "timezone": "UTC", "temperature_unit": "celsius", "wind_speed_unit": "kmh", "precipitation_unit": "mm"}, cache, args.delay)
                hourly = payload["hourly"]
                grids.append({"start": str(first), "end": str(last), "latitude": payload["latitude"], "longitude": payload["longitude"], "units": payload.get("hourly_units")})
                for i, timestamp in enumerate(hourly["time"]):
                    writer.writerow([city["city"], "VA", city["latitude"], city["longitude"], payload["latitude"], payload["longitude"], timestamp + "Z", *[hourly[v][i] for v in VARIABLES]])
                    total += 1
        temporary.replace(destination)
        metadata["files"].append({"city": city["city"], "file": destination.name, "rows": total, "grids": grids})
        manifest.write_text(json.dumps(metadata, indent=2))
    metadata["status"] = "complete"
    manifest.write_text(json.dumps(metadata, indent=2))
    print(f"Saved {len(cities)} city files to {output}. Raw responses cached for repeat runs.")


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, RuntimeError, shapefile.ShapefileException) as error:
        print(f"Download failed: {error}. Check your network and run bun run data:pull if GIS files are missing.", file=sys.stderr)
        sys.exit(1)
