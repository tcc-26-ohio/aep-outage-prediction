#!/usr/bin/env python3
"""For every ARCOS damage report, find the best device to open so the fewest customers lose power while crews work.

Run after build-gis.py (reads public/gis/chains.json + arcos.geojson, patches arcos.geojson, writes opendown.json).

Method
  1. Each transformer's upstream route is rebuilt on the primary-conductor graph by chaining shortest-hop paths
     between its matched upstream devices (matched_upstream.txt) - so the direction toward the source is the
     utility's own, not inferred.
  2. Along each route a segment is "protected" by the first openable device (closed fuse, recloser or switch)
     that lies between that segment and the source. Votes over all routes give one protecting device per segment.
  3. A device de-energizes exactly the transformers whose routes pass through it, so customers affected = sum of
     those transformers' customer counts. Devices nearer the fault always affect a subset of those further up,
     so the nearest protecting device is the minimum.
  4. A report is attached to the network by asset type:
       primary wire         -> the protecting device of the nearest primary segment
       pole/switch/fuse/... -> the device protecting the most customers among segments touching the nearest node, excluding
                               the damaged device itself (the pole or device stays energized from the line side)
       transformer/secondary/light -> the first openable device on the nearest transformer's route
"""
import collections
import json
import math
import os

import numpy as np
import shapefile  # pyshp

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
DATA = os.path.join(ROOT, "data")
GIS = os.path.join(ROOT, "public", "gis")
LAT0 = 37.2
KX, KY = 111320 * math.cos(math.radians(LAT0)), 110540


def records(source, name):
    r = shapefile.Reader(os.path.join(DATA, source, name))
    fields = [f[0] for f in r.fields[1:]]
    for sr in r.iterShapeRecords():
        yield dict(zip(fields, sr.record)), sr.shape.points


print("Reading network", flush=True)
segs = []  # (a, b, pts)
seg_circuit = []
adj = collections.defaultdict(list)
node_xy = {}
for rec, pts in records("Data1", "Primary_ExportFeatures"):
    i = len(segs)
    a, b = rec["location_n"], rec["location_1"]
    segs.append((a, b, pts))
    seg_circuit.append(rec["circuit_id"])
    if a and b:
        adj[a].append((b, i))
        adj[b].append((a, i))
        node_xy.setdefault(a, pts[0])
        node_xy.setdefault(b, pts[-1])

xf_info = {}
circuit_cust = collections.Counter()
for rec, pts in records("Data2", "Transformer_Clip"):
    xf_info.setdefault(rec["location_n"], {"cust": rec["aep_custom"] or 0, "xy": pts[0]})
    circuit_cust[rec["circuit_id"]] += rec["aep_custom"] or 0

# openable devices per location; priority fuse > switch > recloser (simplest field operation)
devices = collections.defaultdict(dict)
for layer, source, shp in (("reclosers", "Data2", "Recloser_Bank_Clip"), ("switches", "Data2", "Switch_Clip"), ("fuses", "Data1", "Fuse_Bank_Clip")):
    for rec, pts in records(source, shp):
        if rec["normal_sta"] == "Open":
            continue  # already open: cannot be used to de-energize anything
        devices[rec["location_n"]][layer] = {"type": rec["device_typ"], "xy": pts[0]}
PRIORITY = ["fuses", "switches", "reclosers"]


def pick(loc):
    d = devices.get(loc)
    if not d:
        return None
    layer = next(l for l in PRIORITY if l in d)
    return layer, d[layer]


# life-support customers per serving transformer, to weigh outages that would hit them
life_by_xf = collections.Counter()
for rec, _ in records("Data1", "Customer_Clip"):
    if (rec["critical_c"] or "").startswith("LS"):
        life_by_xf[rec["aep_xfmr_l"]] += 1
life_by_circuit = collections.Counter()
for rec, _ in records("Data2", "Transformer_Clip"):
    life_by_circuit[rec["circuit_id"]] += life_by_xf.get(rec["location_n"], 0)

chains = json.load(open(os.path.join(GIS, "chains.json")))

path_cache = {}


def path(src, dst):
    """Shortest-hop route on the primary graph: (nodes, segment ids) or None."""
    key = (src, dst)
    if key in path_cache:
        return path_cache[key]
    res = None
    if src == dst:
        res = ([src], [])
    elif src in adj and dst in adj:
        prev = {src: None}
        frontier = [src]
        while frontier and res is None and len(prev) < 60000:
            nxt = []
            for n in frontier:
                for m, s in adj[n]:
                    if m in prev:
                        continue
                    prev[m] = (n, s)
                    if m == dst:
                        nodes, ss, c = [dst], [], dst
                        while prev[c]:
                            c, s2 = prev[c][0], prev[c][1]
                            ss.append(s2)
                            nodes.append(c)
                        res = (nodes[::-1], ss[::-1])
                        break
                    nxt.append(m)
                if res:
                    break
            frontier = nxt
    path_cache[key] = res
    return res


print("Routing", len(chains), "transformers", flush=True)
votes = collections.defaultdict(collections.Counter)  # segment -> device loc
downstream = collections.defaultdict(list)  # device loc -> transformers
first_open = {}  # transformer -> first openable device loc

for xf, chain in chains.items():
    stops = [xf] + [it.split(":")[1] for it in chain if it[0] != "B"]
    # first openable device at or after each stop (the fallback protector for a leg's trailing segments)
    after = [None] * (len(stops) + 1)
    for i in range(len(stops) - 1, -1, -1):
        after[i] = stops[i] if (i > 0 and stops[i] in devices) else after[i + 1]
    seen = set()
    for i in range(len(stops) - 1):
        p = path(stops[i], stops[i + 1])
        nodes, segids = p if p else ([], [])
        on_route = nodes if p else [stops[i + 1]]
        for loc in on_route + [stops[i + 1]]:
            if loc in devices and loc not in seen:
                seen.add(loc)
                downstream[loc].append(xf)
                first_open.setdefault(xf, loc)
        nxt = after[i + 1]
        for j in range(len(nodes) - 1, 0, -1):
            if nodes[j] in devices:
                nxt = nodes[j]
            if nxt:
                votes[segids[j - 1]][nxt] += 1

prot = {s: c.most_common(1)[0][0] for s, c in votes.items()}
cust = {loc: sum(xf_info.get(x, {}).get("cust", 0) for x in xs) for loc, xs in downstream.items()}
life = {loc: sum(life_by_xf.get(x, 0) for x in xs) for loc, xs in downstream.items()}
print(f"  {len(prot)} of {len(segs)} primary segments have a protecting device", flush=True)

# ---- attach each ARCOS report
verts, owner = [], []
for i, (_, _, pts) in enumerate(segs):
    for x, y in pts:
        verts.append((x * KX, y * KY))
        owner.append(i)
verts = np.array(verts)
owner = np.array(owner)
# restrict the nearest-line search to the report's own circuit ("CIR60" -> "0000060") so a neighbouring feeder is never picked
circuit_idx = collections.defaultdict(list)
for k, sidx in enumerate(owner):
    circuit_idx[seg_circuit[sidx]].append(k)
circuit_idx = {c: np.array(v) for c, v in circuit_idx.items()}


def circuit_id(name):
    digits = "".join(ch for ch in (name or "") if ch.isdigit())
    return digits.zfill(7) if digits else None


xf_locs = list(xf_info)
xf_xy = np.array([(xf_info[l]["xy"][0] * KX, xf_info[l]["xy"][1] * KY) for l in xf_locs])


def nearest(arr, p, subset=None):
    if subset is not None:
        d = np.hypot(arr[subset, 0] - p[0], arr[subset, 1] - p[1])
        k = int(d.argmin())
        return int(subset[k]), float(d[k])
    d = np.hypot(arr[:, 0] - p[0], arr[:, 1] - p[1])
    k = int(d.argmin())
    return k, float(d[k])


def best_nearby(node, exclude=None, max_hops=6):
    """Protecting devices of segments around `node`; widen the ring until something is found."""
    ring, seen = [node], {node}
    for hop in range(max_hops):
        found = set()
        for n in ring:
            for m, s in adj.get(n, []):
                d = prot.get(s)
                if d and d != exclude:
                    found.add(d)
        if found:
            return max(found, key=lambda d: cust.get(d, 0)), hop > 0
        ring = [m for n in ring for m, _ in adj.get(n, []) if m not in seen]
        seen.update(ring)
    return None, True


arcos = json.load(open(os.path.join(GIS, "arcos.geojson")))
used = set()
stats = collections.Counter()
for f in arcos["features"]:
    p = f["properties"]
    lon, lat = f["geometry"]["coordinates"]
    xy = (lon * KX, lat * KY)
    asset = p.get("asset") or ""
    for k in ("open", "openL", "openN", "openX", "openT", "openM", "openA", "openC", "openLife"):
        p.pop(k, None)
    loc, approx, method = None, False, None
    if asset in ("Transformer", "Step Transformer", "secondary", "Light"):
        k, dist = nearest(xf_xy, xy)
        if dist < 150 and xf_locs[k] in first_open:
            loc, method = first_open[xf_locs[k]], "transformer"
    if loc is None:
        k, dist = nearest(verts, xy, circuit_idx.get(circuit_id(p.get("circuit"))))
        s = int(owner[k])
        a, b, pts = segs[s]
        if asset == "primary":
            loc, method = prot.get(s), "segment"
            if not loc:
                loc, approx = best_nearby(a if a else b)
        else:
            node = min((n for n in (a, b) if n in node_xy), key=lambda n: math.hypot(node_xy[n][0] * KX - xy[0], node_xy[n][1] * KY - xy[1]), default=None)
            method = "node"
            if node:
                exclude = node if asset in ("Fuse Bank", "Recloser Bank", "Switch") else None
                cands = {prot[s2] for _, s2 in adj[node] if s2 in prot and prot[s2] != exclude}
                if cands:
                    loc = max(cands, key=lambda d: cust.get(d, 0))
                else:
                    loc, approx = best_nearby(node, exclude)
    chosen = pick(loc) if loc else None
    if not chosen:
        # nothing sectionalizes this part of the line: the substation breaker is the only isolation point
        circuit = seg_circuit[int(owner[nearest(verts, xy, circuit_idx.get(circuit_id(p.get("circuit"))))[0]])]
        p.update({"openM": "breaker", "openC": circuit, "openN": circuit_cust.get(circuit, 0), "openLife": life_by_circuit.get(circuit, 0)})
        stats["breaker"] += 1
        continue
    layer, dev = chosen
    p.update({"open": loc, "openL": layer, "openT": dev["type"], "openN": cust.get(loc, 0), "openLife": life.get(loc, 0), "openX": len(downstream.get(loc, [])), "openM": method})
    if approx:
        p["openA"] = 1
    used.add(loc)
    stats[method + ("~" if approx else "")] += 1

with open(os.path.join(GIS, "arcos.geojson"), "w") as fh:
    json.dump(arcos, fh, separators=(",", ":"))
with open(os.path.join(GIS, "opendown.json"), "w") as fh:
    json.dump({loc: downstream[loc] for loc in used}, fh, separators=(",", ":"))
print("Isolation points:", dict(stats), f"({len(used)} distinct devices)")
