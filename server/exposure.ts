// Pole age and road exposure around a premise, for the risk estimate.
const GIS = new URL('../public/gis/', import.meta.url).pathname;

/** poles considered "around" a premise */
export const POLE_RADIUS_KM = 0.15;
/** a pole this close to a road counts as exposed to its traffic */
export const ROAD_KM = 0.025;
/** poles this old (or older) are ignored: their install dates are mostly placeholders */
export const MAX_POLE_AGE = 70;

type Pt = [number, number];
const KX = 88.8, KY = 110.54; // km per degree of longitude / latitude at this latitude
const GRID = 0.002;
const ROAD_GRID = 0.005;
const key = (x: number, y: number, size: number) => `${Math.floor(x / size)},${Math.floor(y / size)}`;

export interface Pole { c: Pt; yr: number | null; loc?: string; cls?: string; h?: string; mat?: string }
interface Seg { a: Pt; b: Pt; interstate: boolean }
let poleGrid: Map<string, Pole[]> | null = null;
const poleByLoc = new Map<string, Pole>();
let roadGrid: Map<string, Seg[]> | null = null;

async function load() {
  if (poleGrid && roadGrid) return;
  const poles = (await Bun.file(GIS + 'poles.geojson').json()) as { features: { geometry: { coordinates: Pt }; properties: { yr?: number | null; loc?: string; cls?: string; h?: string; mat?: string } }[] };
  poleGrid = new Map();
  for (const f of poles.features) {
    const c = f.geometry.coordinates, k = key(c[0], c[1], GRID);
    const p = f.properties, pole: Pole = { c, yr: p.yr ?? null, loc: p.loc, cls: p.cls, h: p.h, mat: p.mat };
    (poleGrid.get(k) ?? poleGrid.set(k, []).get(k)!).push(pole);
    if (p.loc && !poleByLoc.has(p.loc)) poleByLoc.set(p.loc, pole);
  }
  roadGrid = new Map();
  // roads.json comes from scripts/build-roads.py; without it nothing counts as near a road
  const roads = (await Bun.file(GIS + 'roads.json').json().catch(() => [])) as { c: string; p: Pt[] }[];
  for (const r of roads) {
    for (let i = 0; i + 1 < r.p.length; i++) {
      const a = r.p[i]!, b = r.p[i + 1]!, seg: Seg = { a, b, interstate: r.c === 'interstate' };
      for (let x = Math.floor(Math.min(a[0], b[0]) / ROAD_GRID); x <= Math.floor(Math.max(a[0], b[0]) / ROAD_GRID); x++)
        for (let y = Math.floor(Math.min(a[1], b[1]) / ROAD_GRID); y <= Math.floor(Math.max(a[1], b[1]) / ROAD_GRID); y++) {
          const k = `${x},${y}`;
          (roadGrid.get(k) ?? roadGrid.set(k, []).get(k)!).push(seg);
        }
    }
  }
}

const distKm = (p: Pt, a: Pt, b: Pt) => {
  const ax = (a[0] - p[0]) * KX, ay = (a[1] - p[1]) * KY, bx = (b[0] - p[0]) * KX, by = (b[1] - p[1]) * KY;
  const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
  return Math.hypot(ax + t * dx, ay + t * dy);
};

/** nearest road class within ROAD_KM of the point */
function nearRoad(p: Pt): 'interstate' | 'major' | null {
  let best: 'interstate' | 'major' | null = null;
  const cx = Math.floor(p[0] / ROAD_GRID), cy = Math.floor(p[1] / ROAD_GRID);
  for (let x = cx - 1; x <= cx + 1; x++) for (let y = cy - 1; y <= cy + 1; y++)
    for (const s of roadGrid!.get(`${x},${y}`) ?? []) {
      if (distKm(p, s.a, s.b) > ROAD_KM) continue;
      if (s.interstate) return 'interstate';
      best = 'major';
    }
  return best;
}

export interface Exposure {
  /** poles within POLE_RADIUS_KM */
  poles: number;
  /** ages in years of those poles that have a usable install year (under MAX_POLE_AGE) */
  ages: number[];
  nearInterstate: number;
  nearMajor: number;
}

export async function exposureAround(c: Pt): Promise<Exposure> {
  await load();
  const out: Exposure = { poles: 0, ages: [], nearInterstate: 0, nearMajor: 0 };
  const year = new Date().getFullYear();
  const cx = Math.floor(c[0] / GRID), cy = Math.floor(c[1] / GRID);
  const reach = Math.ceil(POLE_RADIUS_KM / (GRID * KX)) + 1;
  for (let x = cx - reach; x <= cx + reach; x++) for (let y = cy - reach; y <= cy + reach; y++)
    for (const p of poleGrid!.get(`${x},${y}`) ?? []) {
      if (Math.hypot((p.c[0] - c[0]) * KX, (p.c[1] - c[1]) * KY) > POLE_RADIUS_KM) continue;
      out.poles++;
      if (p.yr && p.yr > 1901 && year - p.yr >= 0 && year - p.yr < MAX_POLE_AGE) out.ages.push(year - p.yr);
      const road = nearRoad(p.c);
      if (road === 'interstate') out.nearInterstate++; else if (road) out.nearMajor++;
    }
  return out;
}

/** The pole carrying the equipment at a location id (transformers share their pole's location id). */
export async function poleAtLoc(loc: string): Promise<Pole | undefined> {
  await load();
  return poleByLoc.get(loc);
}

/** Closest pole to a point within maxKm. */
export async function nearestPole(c: Pt, maxKm: number): Promise<Pole | undefined> {
  await load();
  let best: Pole | undefined, bd = maxKm;
  const cx = Math.floor(c[0] / GRID), cy = Math.floor(c[1] / GRID), reach = Math.ceil(maxKm / (GRID * KX)) + 1;
  for (let x = cx - reach; x <= cx + reach; x++) for (let y = cy - reach; y <= cy + reach; y++)
    for (const p of poleGrid!.get(`${x},${y}`) ?? []) {
      const d = Math.hypot((p.c[0] - c[0]) * KX, (p.c[1] - c[1]) * KY);
      if (d <= bd) { bd = d; best = p; }
    }
  return best;
}

/** Coordinates of every pole within radiusKm of a point (the poles along the line serving it). */
export async function polesWithin(c: Pt, radiusKm: number): Promise<Pt[]> {
  await load();
  const out: Pt[] = [];
  const cx = Math.floor(c[0] / GRID), cy = Math.floor(c[1] / GRID), reach = Math.ceil(radiusKm / (GRID * KX)) + 1;
  for (let x = cx - reach; x <= cx + reach; x++) for (let y = cy - reach; y <= cy + reach; y++)
    for (const p of poleGrid!.get(`${x},${y}`) ?? [])
      if (Math.hypot((p.c[0] - c[0]) * KX, (p.c[1] - c[1]) * KY) <= radiusKm) out.push(p.c);
  return out;
}
