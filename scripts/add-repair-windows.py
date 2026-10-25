#!/usr/bin/env python3
"""Tag repaired ARCOS damage reports with how recently they were fixed, for the network map.

Adds to public/gis/arcos.geojson:
  repairedAt  the repair date from the source shapefile (Repaired_D)
  rw          "48h"   repaired within 48 hours of the extract date (infant-mortality watch)
              "30d"   repaired 48 hours to 30 days before it (recent history)
              "older" repaired earlier, or repaired with no date
              (open reports get no rw)
and sets arcos.asOf in manifest.json.

The windows are measured back from the latest date in the extract (the data is a historical snapshot), not from today.
Patches in place, so it keeps the other fields (isolation, simulated crew status). Safe to rerun; rerun after build-isolation.py.
"""
import datetime, json, os, shapefile

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
SHP = os.path.join(ROOT, "data", "Data1", "arcos_prod_damage_09_28_Clip")
GIS = os.path.join(ROOT, "public", "gis")


def as_dt(v):
    if isinstance(v, datetime.datetime):
        return v
    if isinstance(v, datetime.date):
        return datetime.datetime(v.year, v.month, v.day)
    return None


r = shapefile.Reader(SHP)
fields = [f[0] for f in r.fields[1:]]
recs = [dict(zip(fields, sr)) for sr in r.records()]
repaired = [as_dt(x["Repaired_D"]) for x in recs]
reported = [as_dt(x["Report_Tim"]) for x in recs]
dates = [d for d in repaired + reported if d and d.year > 1901]
as_of = max(dates)

path = os.path.join(GIS, "arcos.geojson")
fc = json.load(open(path))
feats = fc["features"]
assert len(feats) == len(recs), f"{len(feats)} features vs {len(recs)} shapefile records"

counts = {"open": 0, "48h": 0, "30d": 0, "older": 0}
for f, rec, rep in zip(feats, recs, repaired):
    p = f["properties"]
    p.pop("rw", None)
    p.pop("repairedAt", None)
    if rec["Repaired"] != "Yes":
        counts["open"] += 1
        continue
    if rep and rep.year > 1901:
        p["repairedAt"] = rep.date().isoformat() if rep.time() == datetime.time() else rep.isoformat()
        hours = (as_of - rep).total_seconds() / 3600
        # dates without a time of day count as the end of that day, so "48 h" is the extract day and the two before it
        if rep.time() == datetime.time():
            hours = (as_of.date() - rep.date()).days * 24
        p["rw"] = "48h" if hours <= 48 else "30d" if hours <= 30 * 24 else "older"
    else:
        p["rw"] = "older"
    counts[p["rw"]] += 1

with open(path, "w") as fh:
    json.dump(fc, fh, separators=(",", ":"))

mpath = os.path.join(GIS, "manifest.json")
manifest = json.load(open(mpath))
arcos = manifest["arcos"]
arcos["asOf"] = as_of.date().isoformat()
if not any(k == "repairedAt" for k, _ in arcos["fields"]):
    i = next((i for i, (k, _) in enumerate(arcos["fields"]) if k == "reported"), len(arcos["fields"]) - 1)
    arcos["fields"].insert(i + 1, ["repairedAt", "Repaired on"])
with open(mpath, "w") as fh:
    json.dump(manifest, fh, separators=(",", ":"))

print("as of", as_of.date(), "| repair windows:", counts)
