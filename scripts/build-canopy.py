#!/usr/bin/env python3
"""Download NLCD Tree Canopy Cover (USFS / MRLC, 30 m, percent 0-100) for the service area -> public/gis/canopy.bin + canopy.json.

The utility data has no vegetation layer. Canopy cover near the poles that feed a premise stands in for how many trees could
come down on the line in high wind. server/canopy.ts reads the grid back (it carries its own copy of the Albers projection).
canopy.bin: uint8, row-major from the north-west corner, 255 = no data. canopy.json: grid placement in EPSG:5070.
"""
import io, json, math, os, urllib.parse, urllib.request
import numpy as np
import tifffile  # pip install tifffile (in .venv)

BBOX = (-80.26, 36.99, -79.64, 37.48)  # west, south, east, north: covers customers.geojson
COVERAGE = "mrlc_download:nlcd_tcc_conus_2021_v2021-4"  # newest year MRLC serves over WCS
GRID_X0, GRID_Y0, CELL = -2493045.0, 3310005.0, 30.0  # north-west edge of the national grid
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "public", "gis")

A, F = 6378137.0, 1 / 298.257222101
E2 = F * (2 - F); E = math.sqrt(E2)

def albers(lon, lat, lat1=29.5, lat2=45.5, lat0=23.0, lon0=-96.0):
    """EPSG:5070 (NAD83 / Conus Albers)."""
    def m(p): s = math.sin(math.radians(p)); return math.cos(math.radians(p)) / math.sqrt(1 - E2 * s * s)
    def q(p):
        s = math.sin(math.radians(p))
        return (1 - E2) * (s / (1 - E2 * s * s) - math.log((1 - E * s) / (1 + E * s)) / (2 * E))
    n = (m(lat1) ** 2 - m(lat2) ** 2) / (q(lat2) - q(lat1))
    C = m(lat1) ** 2 + n * q(lat1)
    rho = A * math.sqrt(C - n * q(lat)) / n
    rho0 = A * math.sqrt(C - n * q(lat0)) / n
    th = n * math.radians(lon - lon0)
    return rho * math.sin(th), rho0 - rho * math.cos(th)

assert all(abs(v) < 1e-6 for v in albers(-96, 23)), "projection sanity check failed"

corners = [albers(x, y) for x in (BBOX[0], BBOX[2]) for y in (BBOX[1], BBOX[3])]
pad = 600.0
x_min = GRID_X0 + CELL * math.floor((min(c[0] for c in corners) - pad - GRID_X0) / CELL)
x_max = GRID_X0 + CELL * math.ceil((max(c[0] for c in corners) + pad - GRID_X0) / CELL)
y_max = GRID_Y0 - CELL * math.floor((GRID_Y0 - (max(c[1] for c in corners) + pad)) / CELL)
y_min = GRID_Y0 - CELL * math.ceil((GRID_Y0 - (min(c[1] for c in corners) - pad)) / CELL)
w, h = round((x_max - x_min) / CELL), round((y_max - y_min) / CELL)

qs = urllib.parse.urlencode({"service": "WCS", "version": "1.0.0", "request": "GetCoverage", "coverage": COVERAGE, "crs": "EPSG:5070",
                             "bbox": f"{x_min},{y_min},{x_max},{y_max}", "width": w, "height": h, "format": "GeoTIFF"})
print(f"requesting {w} x {h} cells ...", flush=True)
req = urllib.request.Request("https://www.mrlc.gov/geoserver/wcs?" + qs, headers={"User-Agent": "aep-outage-prediction/1.0"})
raw = urllib.request.urlopen(req, timeout=300).read()
if raw[:2] not in (b"II", b"MM"):
    raise SystemExit("MRLC did not return a GeoTIFF: " + raw[:300].decode(errors="replace"))
grid = tifffile.imread(io.BytesIO(raw))
assert grid.shape == (h, w), f"unexpected grid {grid.shape}, wanted {(h, w)}"
out = np.where(grid > 100, 255, grid).astype(np.uint8)  # NLCD marks non-processing areas with values above 100

os.makedirs(OUT, exist_ok=True)
out.tofile(os.path.join(OUT, "canopy.bin"))
json.dump({"crs": "EPSG:5070", "source": COVERAGE, "x0": x_min, "y0": y_max, "cell": CELL, "w": w, "h": h, "nodata": 255},
          open(os.path.join(OUT, "canopy.json"), "w"))
valid = out[out != 255]
print(f"saved {out.nbytes / 1e6:.1f} MB; {valid.size / out.size:.0%} of cells have data; mean canopy {valid.mean():.1f}%; "
      f"{(valid >= 50).mean():.0%} of cells are at least 50% canopy")
