"""Public GIS overlays. Never export customer or life-support records."""

import math
from functools import lru_cache
from pathlib import Path
from typing import Optional

import shapefile
from fastapi import APIRouter, HTTPException, Query

router = APIRouter(prefix="/api/layers", tags=["GIS layers"])
DATA = Path(__file__).resolve().parents[2] / "data"
LAYERS = {
    "damage": ("Historical damage reports", "Data1/arcos_prod_damage_09_28_Clip.shp"),
    "primary": ("Primary power lines", "Data1/Primary_ExportFeatures.shp"),
    "hospitals": ("Hospitals", "Data1/Hospitals_Medic_Pairwis_Clip.shp"),
    "fire": ("Fire stations", "Data1/Fire_Stations_E_Pairwis_Clip.shp"),
    "ems": ("Emergency medical services", "Data1/Ambulance_Servi_Pairwis_Clip.shp"),
}


def text(value):
    return value.isoformat() if hasattr(value, "isoformat") else value


@lru_cache(maxsize=5)
def load_layer(name):
    path = DATA / LAYERS[name][1]
    if not path.exists():
        raise HTTPException(503, "GIS data is missing. Run bun run data:pull.")
    features = []
    try:
        with shapefile.Reader(str(path), encoding="utf-8") as reader:
            for index, item in enumerate(reader.iterShapeRecords()):
                record = item.record.as_dict()
                if not item.shape.points:
                    continue
                if name == "damage":
                    x, y = item.shape.points[0][:2]
                    geometry = {"type": "Point", "coordinates": [x, y]}
                    properties = {key: text(record.get(field)) for key, field in {
                        "asset_type": "Asset_Type", "damage": "Inform_Wor",
                        "reported": "Report_Tim", "repair_date": "Repaired_D",
                        "repaired": "Repaired", "access_issue": "Access_Iss",
                        "circuit": "Circuit",
                    }.items()}
                elif name == "primary":
                    geometry = item.shape.__geo_interface__
                    properties = {"mounting": record.get("mounting"), "voltage": record.get("nominal_vo"), "circuit": record.get("circuit_id")}
                else:
                    # These facility layers use EPSG:3857; GeoJSON needs WGS84.
                    x, y = item.shape.points[0][:2]
                    geometry = {"type": "Point", "coordinates": [
                        math.degrees(x / 6378137),
                        math.degrees(2 * math.atan(math.exp(y / 6378137)) - math.pi / 2),
                    ]}
                    properties = {"name": record.get("NAME"), "city": record.get("CITY")}
                features.append({"type": "Feature", "id": f"{name}-{index}", "geometry": geometry, "properties": properties})
    except (OSError, shapefile.ShapefileException) as error:
        raise HTTPException(503, "GIS layer could not be read. Check the extracted shapefile companions.") from error
    return features


@router.get("")
def catalog():
    return {"historical": True, "layers": [
        {"id": name, "name": label, "available": (DATA / filename).exists()}
        for name, (label, filename) in LAYERS.items()
    ]}


def intersects(feature, bounds):
    coords = feature["geometry"]["coordinates"]
    kind = feature["geometry"]["type"]
    points = [coords] if kind == "Point" else coords if kind == "LineString" else [p for line in coords for p in line]
    west, south, east, north = bounds
    return (min(p[0] for p in points) <= east and max(p[0] for p in points) >= west
            and min(p[1] for p in points) <= north and max(p[1] for p in points) >= south)


@router.get("/{name}")
def layer(name: str, bbox: Optional[str] = None, limit: int = Query(5000, ge=1, le=10000)):
    if name not in LAYERS:
        raise HTTPException(404, "Unknown map layer.")
    bounds = None
    if bbox:
        try:
            bounds = tuple(float(v) for v in bbox.split(","))
            if len(bounds) != 4 or not all(math.isfinite(v) for v in bounds):
                raise ValueError
            w, s, e, n = bounds
            if not (-180 <= w < e <= 180 and -90 <= s < n <= 90):
                raise ValueError
        except ValueError:
            raise HTTPException(422, "bbox must be west,south,east,north in longitude/latitude.")
    features = load_layer(name)
    matches = [f for f in features if bounds is None or intersects(f, bounds)]
    return {"type": "FeatureCollection", "features": matches[:limit], "metadata": {
        "historical": True, "total_matching": len(matches), "returned": min(len(matches), limit),
        "truncated": len(matches) > limit,
        "notice": "Historical source data, not live outages or a weather prediction. Repair flags may be inconsistent.",
    }}
