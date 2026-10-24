"""Circuit-level outlook built by joining Data1 and Data2 on substation + circuit.

Data1 contributes historical damage reports, fuse banks and primary line length;
Data2 contributes transformers, reclosers, switches and secondary line counts.
Only aggregate counts are returned: no customer, premise or life-support records.
"""

import datetime as dt
import statistics
from collections import defaultdict
from functools import lru_cache

import shapefile
from fastapi import APIRouter, HTTPException

from .layers import DATA

router = APIRouter(prefix="/api/outlook", tags=["Outlook"])

# (dataset file, field read for the metric, how it accumulates)
SOURCES = {
    "damage": "Data1/arcos_prod_damage_09_28_Clip.shp",
    "fuses": "Data1/Fuse_Bank_Clip.shp",
    "primary": "Data1/Primary_ExportFeatures.shp",
    "transformers": "Data2/Transformer_Clip.shp",
    "reclosers": "Data2/Recloser_Bank_Clip.shp",
    "switches": "Data2/Switch_Clip.shp",
    "secondary": "Data2/Secondary_ExportFeatures.shp",
}


def records(key, fields):
    path = DATA / SOURCES[key]
    if not path.exists():
        raise HTTPException(503, "GIS data is missing. Run bun run data:pull.")
    with shapefile.Reader(str(path), encoding="utf-8") as reader:
        if key in ("transformers", "reclosers", "switches"):
            for item in reader.iterShapeRecords(fields=fields):
                yield item.shape, item.record.as_dict()
        else:
            for record in reader.iterRecords(fields=fields):
                yield None, record.as_dict()


def circuit_key(station, circuit):
    return (station or "").strip(), (circuit or "").strip()


GAP_DAYS = 2  # report dates closer together than this belong to the same event
SIGNIFICANT = 10  # reports an event needs to be offered as a headline window


def cluster_events(dates):
    """Group sorted distinct report dates into events separated by quiet gaps."""
    groups = []
    for date in sorted(set(dates)):
        if groups and (date - groups[-1][-1]).days <= GAP_DAYS:
            groups[-1].append(date)
        else:
            groups.append([date])
    return groups


@lru_cache(maxsize=1)
def build():
    rows = defaultdict(lambda: defaultdict(float))
    points = defaultdict(list)
    damage = []

    for _, rec in records("damage", ["Substation", "Circuit", "Repaired", "Repaired_D", "Report_Tim", "Inform_Wor", "Access_Iss"]):
        row = rows[circuit_key(rec["Substation"], rec["Circuit"])]
        row["damage"] += 1
        row["unrepaired"] += rec["Repaired"] == "No"
        if isinstance(rec["Report_Tim"], dt.date):
            damage.append(rec)
    for _, rec in records("fuses", ["aep_statio", "aep_circui"]):
        rows[circuit_key(rec["aep_statio"], rec["aep_circui"])]["fuses"] += 1
    for _, rec in records("primary", ["aep_statio", "aep_circui", "report_len"]):
        row = rows[circuit_key(rec["aep_statio"], rec["aep_circui"])]
        row["primary_km"] += float(rec["report_len"] or 0) * 0.0003048  # feet to km
    for _, rec in records("secondary", ["aep_statio", "aep_circui"]):
        rows[circuit_key(rec["aep_statio"], rec["aep_circui"])]["secondary"] += 1
    for key, extra in (("transformers", ["aep_custom"]), ("reclosers", []), ("switches", [])):
        for shape, rec in records(key, ["aep_statio", "aep_circui", *extra]):
            ck = circuit_key(rec["aep_statio"], rec["aep_circui"])
            rows[ck][key] += 1
            if key == "transformers":
                rows[ck]["customers"] += float(rec["aep_custom"] or 0)
            if shape and shape.points:
                points[ck].append(shape.points[0][:2])

    circuits = []
    for (station, circuit), row in rows.items():
        pts = points.get((station, circuit))
        # Circuits that exist only in the damage layer have no Data2 asset to place them.
        if not station or not circuit or not pts:
            continue
        circuits.append({
            "id": f"{station}/{circuit}", "station": station, "circuit": circuit,
            "lon": round(statistics.fmean(p[0] for p in pts), 5), "lat": round(statistics.fmean(p[1] for p in pts), 5),
            "damage": int(row["damage"]), "unrepaired": int(row["unrepaired"]),
            "transformers": int(row["transformers"]), "reclosers": int(row["reclosers"]),
            "switches": int(row["switches"]), "fuses": int(row["fuses"]),
            "secondary": int(row["secondary"]), "primary_km": round(row["primary_km"], 1),
            "customers": int(row["customers"]), "events": {},
        })

    # Region = position within the service territory: top/bottom quarter by
    # latitude are North/South, the rest split west/east into Central/East.
    lats = sorted(c["lat"] for c in circuits)
    lons = sorted(c["lon"] for c in circuits)
    north, south = lats[int(len(lats) * 0.75)], lats[int(len(lats) * 0.25)]
    mid_lon = lons[len(lons) // 2]
    for c in circuits:
        c["region"] = "North" if c["lat"] >= north else "South" if c["lat"] <= south else "East" if c["lon"] >= mid_lon else "Central"

    # Weight = blend of historical damage share and equipment exposure, so the
    # combined data decides how a total is spread across circuits.
    damage_total = sum(c["damage"] for c in circuits) or 1
    exposure = [c["transformers"] + c["reclosers"] * 5 + c["switches"] * 5 + c["fuses"] for c in circuits]
    exposure_total = sum(exposure) or 1
    for c, e in zip(circuits, exposure):
        c["exposure"] = e
        c["weight"] = round(0.6 * c["damage"] / damage_total + 0.4 * e / exposure_total, 6)

    by_id = {c["id"]: c for c in circuits}
    groups = cluster_events(r["Report_Tim"] for r in damage)
    event_of = {d: f"E{i + 1}" for i, group in enumerate(groups) for d in group}
    events = {f"E{i + 1}": {
        "id": f"E{i + 1}", "start": group[0].isoformat(), "end": group[-1].isoformat(), "reports": 0, "unrepaired": 0,
        "access_issues": 0, "repair_days": [], "types": defaultdict(int), "regions": defaultdict(int),
        "days": {d: {"date": d.isoformat(), "reports": 0, "regions": defaultdict(int)} for d in group},
    } for i, group in enumerate(groups)}
    for rec in damage:
        circuit = by_id.get(f"{rec['Substation'].strip()}/{rec['Circuit'].strip()}")
        if not circuit:
            continue
        event_id = event_of[rec["Report_Tim"]]
        event = events[event_id]
        circuit["events"][event_id] = circuit["events"].get(event_id, 0) + 1
        event["reports"] += 1
        event["unrepaired"] += rec["Repaired"] == "No"
        event["access_issues"] += rec["Access_Iss"] == "Yes"
        event["types"][(rec["Inform_Wor"] or "Unknown").replace("Damaged ", "")] += 1
        event["regions"][circuit["region"]] += 1
        day = event["days"][rec["Report_Tim"]]
        day["reports"] += 1
        day["regions"][circuit["region"]] += 1
        if isinstance(rec["Repaired_D"], dt.date) and rec["Repaired"] == "Yes":
            event["repair_days"].append((rec["Repaired_D"] - rec["Report_Tim"]).days)

    out = []
    for event in events.values():
        hit = [c for c in circuits if event["id"] in c["events"]]
        repair = event.pop("repair_days")
        event.update({
            "circuits": len(hit), "customers": sum(c["customers"] for c in hit),
            "median_repair_days": statistics.median(repair) if repair else None,
            "significant": event["reports"] >= SIGNIFICANT,
            "types": dict(event["types"]), "regions": dict(event["regions"]),
            "days": [{**d, "regions": dict(d["regions"])} for d in event["days"].values()],
        })
        out.append(event)
    return {"circuits": sorted(circuits, key=lambda c: -c["weight"]), "events": out}


@router.get("")
def outlook():
    data = build()
    return {**data, "metadata": {
        "datasets": ["Data1", "Data2"], "join": "substation + circuit",
        "notice": "Historical GIS source data: damage reports joined to the equipment on each circuit.",
    }}
