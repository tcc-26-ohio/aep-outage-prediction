#!/usr/bin/env python3
"""Add a SIMULATED crew status to each open ARCOS damage report (the real data has none).

Sets properties.crew on public/gis/arcos.geojson to one of:
  reported -> assigned -> arrived -> underway
Repaired reports get no crew status. Seeded, so reruns give the same result.
Run after build-isolation.py (which rewrites arcos.geojson and would drop the field).
"""
import json, os, random

GIS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "public", "gis")
STATES = ["reported", "assigned", "arrived", "underway"]
PATH = os.path.join(GIS, "arcos.geojson")

rng = random.Random(26)
arcos = json.load(open(PATH))
counts = dict.fromkeys(STATES, 0)
for f in arcos["features"]:
    p = f["properties"]
    p.pop("crew", None)
    if p.get("repaired") == "Yes":
        continue
    p["crew"] = rng.choice(STATES)
    counts[p["crew"]] += 1

with open(PATH, "w") as fh:
    json.dump(arcos, fh, separators=(",", ":"))
print("crew status:", counts)
