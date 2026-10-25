#!/usr/bin/env python3
"""Combine the Data1 + Data2 ESRI shapefiles into web-ready GeoJSON for the map page.

Usage: .venv/bin/python scripts/build-gis.py   (reads data/Data1, data/Data2, data/matched_upstream)
Writes public/gis/*.geojson, chains.json and manifest.json.

Customers are anonymized: no address, premise number, meter, street or internal id leaves this
script. Each premise gets a salted one-way pseudo id (the salt is random per run and discarded).
"""
import collections
import hashlib
import json
import math
import os
import secrets
import sys

import shapefile  # pyshp

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
DATA = os.path.join(ROOT, "data")
OUT = os.path.join(ROOT, "public", "gis")
os.makedirs(OUT, exist_ok=True)

SALT = secrets.token_hex(16)
R = 6378137.0


def merc_to_lonlat(x, y):
    return (math.degrees(x / R), math.degrees(2 * math.atan(math.exp(y / R)) - math.pi / 2))


def read(source, name):
    r = shapefile.Reader(os.path.join(DATA, source, name))
    needs_unproject = abs(r.bbox[0]) > 360
    fields = [f[0] for f in r.fields[1:]]
    for sr in r.iterShapeRecords():
        rec = dict(zip(fields, sr.record))
        pts = sr.shape.points
        if needs_unproject:
            pts = [merc_to_lonlat(x, y) for x, y in pts]
        yield rec, sr.shape.parts, pts, r.shapeType


def rd(v, n=5):
    return round(v, n)


def point_geom(pts):
    return {"type": "Point", "coordinates": [rd(pts[0][0]), rd(pts[0][1])]}


def line_geom(parts, pts):
    segs = []
    bounds = list(parts) + [len(pts)]
    for a, b in zip(bounds, bounds[1:]):
        segs.append([[rd(x), rd(y)] for x, y in pts[a:b]])
    return {"type": "LineString", "coordinates": segs[0]} if len(segs) == 1 else {"type": "MultiLineString", "coordinates": segs}


def clean(v):
    if v is None:
        return None
    if hasattr(v, "isoformat"):
        return v.isoformat() if v.year > 1901 else None
    if isinstance(v, float):
        return round(v, 3)
    if isinstance(v, str):
        v = v.strip()
        return v or None
    return v


def props(d):
    return {k: v for k, v in ((k, clean(v)) for k, v in d.items()) if v is not None}


def first(*vals):
    for v in vals:
        if v:
            return v
    return None


def write(name, features):
    path = os.path.join(OUT, name + ".geojson")
    with open(path, "w") as f:
        json.dump({"type": "FeatureCollection", "features": features}, f, separators=(",", ":"))
    print(f"  {name}: {len(features)} features, {os.path.getsize(path) / 1e6:.1f} MB", flush=True)
    return len(features)


manifest = {}
# location ids present in each mapped layer, to report how much of the upstream path can be drawn
LOCS = collections.defaultdict(set)
POLE_XY = {}


def register(key, label, group, geometry, source, shp, count, fields):
    manifest[key] = {"label": label, "group": group, "geometry": geometry, "source": f"{source}/{shp}.shp", "count": count, "fields": fields}


# ---- Secondary: union-find over wire end nodes -> network groups (one per transformer service area)
print("Secondary conductors")
sec_rows = list(read("Data2", "Secondary_ExportFeatures"))
parent = {}


def find(a):
    parent.setdefault(a, a)
    while parent[a] != a:
        parent[a] = parent[parent[a]]
        a = parent[a]
    return a


for rec, _, _, _ in sec_rows:
    a, b = rec["location_n"], rec["location_1"]
    if a:
        find(a)
        if b:
            parent[find(a)] = find(b)
group_ids = {}


def group_of(node):
    if not node or node not in parent:
        return None
    return group_ids.setdefault(find(node), len(group_ids))


features = []
for rec, parts, pts, _ in sec_rows:
    kind = rec["esri_defau"] or ""
    p = props({
        "g": group_of(rec["location_n"]),
        "type": "Service drop" if "Service" in kind else "Secondary",
        "mount": rec["mounting"],
        "volt": rec["nominal_vo"],
        "ph": rec["existing_p"],
        "spec": first(rec["spec_name"], rec["c_phase_sp"], rec["a_phase_sp"], rec["b_phase_sp"]),
        "len": rec["report_len"],
        "circuit": rec["circuit_id"],
        "status": rec["status"],
    })
    features.append({"type": "Feature", "geometry": line_geom(parts, pts), "properties": p})
n = write("secondary", features)
register("secondary", "Secondary conductors (LV)", "Network", "line", "Data2", "Secondary_ExportFeatures", n, [
    ["type", "Segment type"], ["mount", "Mounting"], ["volt", "Voltage"], ["ph", "Phases"], ["spec", "Conductor"], ["len", "Length (m)"], ["circuit", "Circuit"], ["status", "Status"], ["g", "Service-area group"]])
del sec_rows, features

# ---- Primary: phase count from the ESRI symbol name ("OH MV 3 Phase")
print("Primary conductors")
features = []
for rec, parts, pts, _ in read("Data1", "Primary_ExportFeatures"):
    sym = rec["esri_defau"] or ""
    ph_n = next((int(t) for t in sym.split() if t.isdigit()), None) or len(rec["existing_p"] or "") or None
    p = props({
        "i": len(features),
        "a": rec["location_n"],
        "b": rec["location_1"],
        "phn": ph_n,
        "ph": rec["existing_p"],
        "volt": rec["nominal_vo"],
        "design": rec["aep_design"] if rec["aep_design"] != "Unknown" else None,
        "usage": rec["usage"],
        "mount": rec["mounting"],
        "spec": first(rec["c_phase_sp"], rec["a_phase_sp"], rec["b_phase_sp"]),
        "constr": rec["aep_constr"],
        "len": rec["report_len"],
        "circuit": rec["circuit_id"],
        "station": rec["aep_statio"],
        "status": rec["status"],
        "owner": rec["owner_name"],
    })
    features.append({"type": "Feature", "geometry": line_geom(parts, pts), "properties": p})
n = write("primary", features)
register("primary", "Primary conductors (distribution)", "Network", "line", "Data1", "Primary_ExportFeatures", n, [
    ["phn", "Number of phases"], ["ph", "Phase(s)"], ["volt", "Voltage"], ["design", "Design class"], ["usage", "Usage"], ["mount", "Mounting"], ["spec", "Conductor"],
    ["constr", "Construction"], ["len", "Length (m)"], ["circuit", "Circuit"], ["station", "Substation"], ["status", "Status"], ["owner", "Owner"]])
del features

# ---- Point layers
print("Transformers")
xfmr_group = {}
features = []
for rec, _, pts, _ in read("Data2", "Transformer_Clip"):
    g = group_of(rec["location_n"])
    xfmr_group[rec["location_n"]] = g
    LOCS["X"].add(rec["location_n"])
    p = props({
        "loc": rec["location_n"],
        "g": g,
        "type": rec["device_typ"],
        "kva": first(rec["c_phase_sp"], rec["a_phase_sp"], rec["b_phase_sp"]),
        "bank": rec["bank_confi"],
        "ph": rec["existing_p"],
        "vin": rec["source_nom"],
        "vout": rec["load_nomin"],
        "sec": rec["aep_sec_vo"],
        "cust": rec["aep_custom"],
        "mount": rec["mounting"],
        "up": rec["upstream_l"],
        "circuit": rec["circuit_id"],
        "station": rec["aep_statio"],
        "status": rec["status"],
    })
    features.append({"type": "Feature", "geometry": point_geom(pts), "properties": p})
n = write("transformers", features)
register("transformers", "Transformers", "Network", "point", "Data2", "Transformer_Clip", n, [
    ["loc", "Location id"], ["type", "Type"], ["kva", "Rating"], ["bank", "Bank configuration"], ["ph", "Phases"], ["vin", "Primary voltage"], ["vout", "Secondary voltage"],
    ["sec", "Secondary service"], ["cust", "Customers served"], ["mount", "Mounting"], ["up", "Upstream node"], ["circuit", "Circuit"], ["station", "Substation"], ["status", "Status"], ["g", "Service-area group"]])

print("Poles")
features = []
for rec, _, pts, _ in read("Data1", "Pole_Clip"):
    d = rec["date_insta"]
    POLE_XY[rec["location_n"]] = [rd(pts[0][0]), rd(pts[0][1])]
    p = props({
        "loc": rec["location_n"],
        "usage": rec["usage"],
        "mat": rec["material"],
        "h": rec["height"],
        "cls": rec["class"],
        "yr": d.year if d and d.year > 1901 else None,
        "owner": rec["owner_name"],
        "status": rec["status"],
    })
    features.append({"type": "Feature", "geometry": point_geom(pts), "properties": p})
n = write("poles", features)
register("poles", "Poles", "Network", "point", "Data1", "Pole_Clip", n, [
    ["loc", "Location id"], ["usage", "Usage"], ["mat", "Material"], ["h", "Height"], ["cls", "Class"], ["yr", "Year installed"], ["owner", "Owner"], ["status", "Status"]])


def protective(key, label, shp, source, kind):
    features = []
    for rec, _, pts, _ in read(source, shp):
        LOCS[{"Fuse": "F", "Recloser (Hydraulic)": "H", "Recloser (Electronic)": "E"}.get(rec["device_typ"], "?")].add(rec["location_n"])
        LOCS["dev"].add(rec["location_n"])
        p = props({
            "loc": rec["location_n"],
            "kind": kind,
            "dev": rec["device_typ"],
            "state": rec["normal_sta"],
            "ph": rec["existing_p"],
            "volt": rec["nominal_vo"],
            "cust": rec["aep_custom"],
            "scada": "Yes" if rec["scada_cont"] else "No",
            "spec": first(rec["c_phase_sp"], rec["b_phase_sp"], rec["a_phase_sp"]),
            "up": rec["upstream_l"],
            "circuit": rec["circuit_id"],
            "station": rec["aep_statio"],
            "status": rec["status"],
        })
        features.append({"type": "Feature", "geometry": point_geom(pts), "properties": p})
    n = write(key, features)
    register(key, label, "Sectionalizing devices", "point", source, shp, n, [
        ["loc", "Location id"], ["dev", "Device type"], ["state", "Normal state"], ["ph", "Phases"], ["volt", "Voltage"], ["cust", "Customers downstream"], ["scada", "SCADA controlled"],
        ["spec", "Rating / spec"], ["up", "Upstream node"], ["circuit", "Circuit"], ["station", "Substation"], ["status", "Status"]])


print("Protective devices")
protective("fuses", "Fuses", "Fuse_Bank_Clip", "Data1", "Fuse")
protective("switches", "Switches", "Switch_Clip", "Data2", "Switch")
protective("reclosers", "Reclosers", "Recloser_Bank_Clip", "Data2", "Recloser")

print("ARCOS damage")
features = []
for rec, _, pts, _ in read("Data1", "arcos_prod_damage_09_28_Clip"):
    p = props({
        "asset": rec["Asset_Type"],
        "damage": rec["Inform_Wor"],
        "repaired": rec["Repaired"],
        "reported": rec["Report_Tim"],
        "repairedAt": rec["Repaired_D"],
        "region": rec["Region"],
        "station": rec["Substation"],
        "circuit": rec["Circuit"],
        "event": rec["Event"],
        "dist": rec["NEAR_DIST"],
    })
    features.append({"type": "Feature", "geometry": point_geom(pts), "properties": p})
n = write("arcos", features)
register("arcos", "ARCOS damage reports", "Impact", "point", "Data1", "arcos_prod_damage_09_28_Clip", n, [
    ["asset", "Asset type"], ["damage", "Damage"], ["repaired", "Repaired"], ["reported", "Reported"], ["repairedAt", "Repaired on"], ["region", "Region"], ["station", "Substation"], ["circuit", "Circuit"], ["event", "Event"]])


def facility(key, label, shp, kind):
    features = []
    for rec, _, pts, _ in read("Data1", shp):
        p = props({"kind": kind, "name": rec["NAME"], "addr": rec["ADDRESS"], "city": rec["CITY"], "state": rec["STATE"], "zip": rec["ZIPCODE"]})
        features.append({"type": "Feature", "geometry": point_geom(pts), "properties": p})
    n = write(key, features)
    register(key, label, "Emergency services", "point", "Data1", shp, n, [["name", "Name"], ["addr", "Address"], ["city", "City"], ["state", "State"], ["zip", "ZIP"]])


print("Emergency facilities")
facility("hospitals", "Hospitals", "Hospitals_Medic_Pairwis_Clip", "Hospital")
facility("fire", "Fire stations", "Fire_Stations_E_Pairwis_Clip", "Fire station")
facility("ambulance", "Ambulance services", "Ambulance_Servi_Pairwis_Clip", "Ambulance")

# ---- Customers (anonymized) + upstream chains from matched_upstream
print("Customers (anonymized)")
features = []
premise_xfmr = {}
premise_addresses = []
service_kind = {"Overhead": "OH", "Underground": "UG"}
for rec, _, pts, _ in read("Data1", "Customer_Clip"):
    pid = hashlib.sha256((SALT + str(rec["premise_nu"])).encode()).hexdigest()[:8]
    premise_xfmr[rec["premise_nu"]] = rec["aep_xfmr_l"]
    p = props({
        "pid": "P-" + pid,
        "xf": rec["aep_xfmr_l"],
        "g": xfmr_group.get(rec["aep_xfmr_l"]),
        "svc": service_kind.get(rec["kind_of_se"], "?"),
        "n": rec["customer_c"],
        "life": 1 if (rec["critical_c"] or "").startswith("LS") else None,
        "circuit": rec["circuit_id"],
    })
    features.append({"type": "Feature", "geometry": point_geom(pts), "properties": p})
    # house number (anno_strin) + street + city; the shapefile's own `address` fields are empty
    premise_addresses.append([p["pid"], rec["anno_strin"] or rec["address_nu"] or "", rec["road_name"] or "", rec["city"] or "", rec["state"] or "", p.get("svc", "?"), p.get("n", 1), p.get("life", 0), rec["circuit_id"] or "", rec["aep_locati"] or ""])
n = write("customers", features)
register("customers", "Customers / premises (anonymized)", "Network", "point", "Data1", "Customer_Clip", n, [
    ["pid", "Anonymous premise id"], ["svc", "Service (OH/UG)"], ["n", "Customer count"], ["life", "Life support"], ["xf", "Serving transformer"], ["circuit", "Circuit"], ["g", "Service-area group"]])
del features

# Address -> premise lookup for the client chat. Written outside public/ on purpose: the server searches it and
# returns a handful of matches per query, so no bulk address list is ever shipped to a browser.
with open(os.path.join(DATA, "premise-addresses.json"), "w") as f:
    json.dump(premise_addresses, f, separators=(",", ":"))
print(f"  address index for {len(premise_addresses)} premises (data/premise-addresses.json, private)")

print("Upstream chains")
# matched_upstream.txt: premise \t then, nearest-first, "<feature class>*<object id>*<device type>*<location id>"
# (distribution transformer first, circuit breaker last). Keep the exact equipment order and ids.
CODE = {
    ("eo_power_xfrmr_inst", "Distribution"): "X", ("eo_power_xfrmr_inst", "Step"): "T", ("eo_isolating_eqpt_inst", "Fuse"): "F",
    ("eo_isolating_eqpt_inst", "Recloser (Hydraulic)"): "H", ("eo_isolating_eqpt_inst", "Recloser (Electronic)"): "E",
    ("eo_isolating_eqpt_inst", "Sectionalizer"): "Z", ("eo_circuit", "Circuit Breaker"): "B",
}
chains = {}
pattern_premises = collections.Counter()
pattern_xf = collections.defaultdict(set)
stage = collections.defaultdict(lambda: {"paths": 0, "n": 0, "rank": 0.0, "mapped": 0, "total": 0})
with open(os.path.join(DATA, "matched_upstream", "matched_upstream.txt")) as f:
    for line in f:
        parts = line.rstrip("\n").split("\t")
        xf = premise_xfmr.get(parts[0])
        items = [i.split("*") for i in parts[1:]]
        codes = [CODE.get((i[0], i[2]), "?") for i in items]
        seq = ">".join(codes)
        pattern_premises[seq] += 1
        for k, (c, it) in enumerate(zip(codes, items)):
            st = stage[c]
            st["n"] += 1
            st["rank"] += k / max(len(items) - 1, 1)
            if c != "B":
                st["total"] += 1
                st["mapped"] += it[3] in (LOCS[c] if c in "XFHE" else POLE_XY)
        for c in set(codes):
            stage[c]["paths"] += 1
        if not xf or xf in chains:
            continue
        pattern_xf[seq].add(xf)
        chains[xf] = [f"{c}:{i[3]}:{i[1]}" for c, i in zip(codes[1:], items[1:])]
# equipment with no point of its own (step transformers, sectionalizers) is anchored to the pole at its location id
anchors = {}
for x, ch in chains.items():
    for it in ch:
        c, loc = it[0], it.split(":")[1]
        if c not in "BXFHE" and loc in POLE_XY:
            anchors[loc] = POLE_XY[loc]
with open(os.path.join(OUT, "anchors.json"), "w") as f:
    json.dump(anchors, f, separators=(",", ":"))
with open(os.path.join(OUT, "chains.json"), "w") as f:
    json.dump(chains, f, separators=(",", ":"))
total = sum(pattern_premises.values())
patterns = [{"seq": k, "premises": v, "transformers": len(pattern_xf[k])} for k, v in pattern_premises.most_common()]
xf_pattern = {x: i for i, pt in enumerate(patterns) for x in pattern_xf[pt["seq"]]}
stages = sorted(
    ({"code": c, "paths": v["paths"] / total, "perPath": v["n"] / v["paths"], "rank": v["rank"] / v["n"], "mapped": (v["mapped"] / v["total"]) if v["total"] else None} for c, v in stage.items()),
    key=lambda s: s["rank"],
)
with open(os.path.join(OUT, "topology.json"), "w") as f:
    json.dump({"premises": total, "stages": stages, "patterns": patterns, "xfPattern": xf_pattern}, f, separators=(",", ":"))
print(f"  {len(chains)} transformer chains, {len(patterns)} distinct equipment orderings")

with open(os.path.join(OUT, "manifest.json"), "w") as f:
    json.dump(manifest, f, separators=(",", ":"))
print("Done ->", OUT)
