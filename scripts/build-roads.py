#!/usr/bin/env python3
"""Download major roads from OpenStreetMap (Overpass) for the service area -> public/gis/roads.json.

The utility data has no road layer. OSM road class is the traffic proxy (no traffic counts available):
  interstate = motorway/trunk (interstates and freeways), major = primary/secondary.
Output: [{"c": "interstate"|"major", "n": name/ref, "p": [[lon, lat], ...]}, ...]
"""
import json, os, urllib.parse, urllib.request

BBOX = (36.99, -80.26, 37.48, -79.64)  # south, west, north, east: covers customers.geojson
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "public", "gis", "roads.json")
CLASS = {"motorway": "interstate", "motorway_link": "interstate", "trunk": "interstate", "trunk_link": "interstate", "primary": "major", "primary_link": "major", "secondary": "major", "secondary_link": "major"}

q = f'[out:json][timeout:120];way["highway"~"^(motorway|motorway_link|trunk|trunk_link|primary|primary_link|secondary|secondary_link)$"]({",".join(map(str, BBOX))});out geom;'
req = urllib.request.Request("https://overpass-api.de/api/interpreter", data=urllib.parse.urlencode({"data": q}).encode(), headers={"User-Agent": "aep-outage-prediction/1.0", "Accept": "application/json"})
els = json.load(urllib.request.urlopen(req, timeout=180))["elements"]
roads = []
for e in els:
    t = e.get("tags", {})
    if e.get("type") != "way" or t.get("highway") not in CLASS or not e.get("geometry"):
        continue
    roads.append({"c": CLASS[t["highway"]], "n": t.get("ref") or t.get("name") or "", "p": [[round(g["lon"], 5), round(g["lat"], 5)] for g in e["geometry"]]})
with open(OUT, "w") as fh:
    json.dump(roads, fh, separators=(",", ":"))
print(len(roads), "road ways;", sum(r["c"] == "interstate" for r in roads), "interstate-class")
