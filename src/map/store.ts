// Data layer for the network map: layer catalogue, lazy loading, and the lookup indexes that
// let the UI trace how premises, transformers, conductors and protective devices connect.

export type LayerKey =
  | 'primary' | 'secondary' | 'customers' | 'poles' | 'transformers'
  | 'fuses' | 'switches' | 'reclosers' | 'arcos' | 'hospitals' | 'fire' | 'ambulance';

export type Props = Record<string, any>;
export type LngLat = [number, number];

export interface Manifest {
  label: string;
  group: string;
  geometry: 'point' | 'line';
  source: string;
  count: number;
  fields: [string, string][];
}

export interface FieldSummary { distinct: number; top: [string, number][]; min?: number; max?: number; /** every value with its count (when <= 100 distinct) */ all?: [string, number][]; /** features without this property */ missing: number }

export const GROUPS = ['Network', 'Sectionalizing devices', 'Impact', 'Emergency services'] as const;

export const DEFAULT_ON: LayerKey[] = ['primary', 'transformers', 'fuses', 'switches', 'reclosers', 'arcos', 'hospitals', 'fire', 'ambulance'];

export interface XfInfo { loc: string; g?: number; coords: LngLat; cust: number; props: Props }
export interface DevInfo { loc: string; layer: LayerKey; coords: LngLat; props: Props }
export interface CircuitInfo { bbox: [number, number, number, number]; segments: number }

export interface Topology {
  premises: number;
  stages: { code: string; paths: number; perPath: number; rank: number; mapped: number | null }[];
  patterns: { seq: string; premises: number; transformers: number }[];
  xfPattern: Record<string, number>;
}

export const store = {
  /** every ARCOS damage report with its isolation fields (for the Issues tab) */
  arcosFeatures: [] as { id: number; props: Props; coords: LngLat }[],
  /** ARCOS damage counts: category (damage type) -> asset type -> reports */
  arcos: new Map<string, Map<string, { n: number; open: number }>>(),
  topology: null as Topology | null,
  /** device location -> transformers it de-energizes when opened (for ARCOS isolation points) */
  openDown: {} as Record<string, string[]>,
  anchors: {} as Record<string, LngLat>,
  /** pattern index -> transformers whose upstream equipment order matches it */
  patternXfs: new Map<number, string[]>(),
  manifest: {} as Record<string, Manifest>,
  chains: {} as Record<string, string[]>,
  summaries: {} as Partial<Record<LayerKey, Record<string, FieldSummary>>>,
  xf: new Map<string, XfInfo>(),
  /** emergency facilities by layer, keyed by name */
  facilities: {} as Partial<Record<LayerKey, Map<string, { coords: LngLat; props: Props }>>>,
  devByLoc: new Map<string, DevInfo[]>(),
  /** device/step-transformer location -> transformers downstream of it */
  downstream: new Map<string, string[]>(),
  /** transformer location -> poles/other equipment sharing it */
  poleLocs: new Set<string>(),
  circuits: new Map<string, CircuitInfo>(),
  adj: new Map<string, [string, number][]>(),
};

const cache = new Map<LayerKey, Promise<any>>();

async function getJson(url: string) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return res.json();
}

export async function loadManifest() {
  const [manifest, chains, topology, anchors, openDown] = await Promise.all([
    getJson('/gis/manifest.json'), getJson('/gis/chains.json'), getJson('/gis/topology.json'), getJson('/gis/anchors.json'), getJson('/gis/opendown.json'),
  ]);
  store.openDown = openDown;
  store.manifest = manifest;
  store.chains = chains;
  store.topology = topology;
  store.anchors = anchors;
  for (const [xf, idx] of Object.entries<number>(topology.xfPattern)) {
    const list = store.patternXfs.get(idx);
    if (list) list.push(xf); else store.patternXfs.set(idx, [xf]);
  }
  for (const [xf, chain] of Object.entries<string[]>(chains)) {
    for (const item of chain) {
      if (item.startsWith('B:')) continue;
      const loc = item.split(':')[1]!;
      const list = store.downstream.get(loc);
      if (list) list.push(xf); else store.downstream.set(loc, [xf]);
    }
  }
}

function summarize(key: LayerKey, fc: any) {
  const out: Record<string, FieldSummary> = {};
  for (const [field] of store.manifest[key]!.fields) {
    const counts = new Map<string, number>();
    let min = Infinity, max = -Infinity, numeric = true, capped = false, missing = 0;
    for (const f of fc.features) {
      const v = f.properties[field];
      if (v === undefined) { missing++; continue; }
      if (typeof v === 'number') { if (v < min) min = v; if (v > max) max = v; } else numeric = false;
      if (capped) continue;
      const s = String(v);
      counts.set(s, (counts.get(s) ?? 0) + 1);
      if (counts.size > 5000) capped = true;
    }
    const top = [...counts].sort((a, b) => b[1] - a[1]).slice(0, 6);
    out[field] = { distinct: counts.size, top, missing, ...(!capped && counts.size <= 100 ? { all: [...counts].sort((a, b) => b[1] - a[1]) } : {}), ...(numeric && min <= max ? { min, max } : {}) };
  }
  store.summaries[key] = out;
}

function firstCoord(geom: any): LngLat {
  return geom.type === 'Point' ? geom.coordinates : geom.type === 'LineString' ? geom.coordinates[0] : geom.coordinates[0][0];
}

function index(key: LayerKey, fc: any) {
  if (key === 'transformers') {
    for (const f of fc.features) {
      const p = f.properties;
      store.xf.set(p.loc, { loc: p.loc, g: p.g, coords: f.geometry.coordinates, cust: p.cust ?? 0, props: p });
    }
  } else if (key === 'fuses' || key === 'switches' || key === 'reclosers') {
    for (const f of fc.features) {
      const p = f.properties;
      const info: DevInfo = { loc: p.loc, layer: key, coords: f.geometry.coordinates, props: p };
      const list = store.devByLoc.get(p.loc);
      if (list) list.push(info); else store.devByLoc.set(p.loc, [info]);
    }
  } else if (key === 'hospitals' || key === 'fire' || key === 'ambulance') {
    const m = new Map<string, { coords: LngLat; props: Props }>();
    for (const f of fc.features) m.set(f.properties.name, { coords: f.geometry.coordinates, props: f.properties });
    store.facilities[key] = m;
  } else if (key === 'arcos') {
    store.arcosFeatures = fc.features.map((f: any, id: number) => ({ id, props: f.properties, coords: f.geometry.coordinates }));
    for (const f of fc.features) {
      const cat = f.properties.damage ?? 'Other', asset = f.properties.asset ?? 'Unknown';
      const m = store.arcos.get(cat) ?? store.arcos.set(cat, new Map()).get(cat)!;
      const c = m.get(asset) ?? m.set(asset, { n: 0, open: 0 }).get(asset)!;
      c.n++;
      if (f.properties.repaired === 'No') c.open++;
    }
  } else if (key === 'poles') {
    for (const f of fc.features) store.poleLocs.add(f.properties.loc);
  } else if (key === 'primary') {
    for (const f of fc.features) {
      const { i, a, b, circuit } = f.properties;
      if (a && b) {
        (store.adj.get(a) ?? store.adj.set(a, []).get(a)!).push([b, i]);
        (store.adj.get(b) ?? store.adj.set(b, []).get(b)!).push([a, i]);
      }
      if (circuit) {
        const c = f.geometry.type === 'LineString' ? f.geometry.coordinates : f.geometry.coordinates.flat();
        let info = store.circuits.get(circuit);
        if (!info) store.circuits.set(circuit, info = { bbox: [Infinity, Infinity, -Infinity, -Infinity], segments: 0 });
        info.segments++;
        for (const [x, y] of c) {
          if (x < info.bbox[0]) info.bbox[0] = x;
          if (y < info.bbox[1]) info.bbox[1] = y;
          if (x > info.bbox[2]) info.bbox[2] = x;
          if (y > info.bbox[3]) info.bbox[3] = y;
        }
      }
    }
  }
}

/** Fetch + index a layer once; resolves with the GeoJSON for the caller to hand to MapLibre. */
export function loadLayer(key: LayerKey): Promise<any> {
  let p = cache.get(key);
  if (!p) {
    p = getJson(`/gis/${key}.geojson`).then(fc => { index(key, fc); summarize(key, fc); return fc; });
    p.catch(() => cache.delete(key));
    cache.set(key, p);
  }
  return p;
}

/** Shortest hop path between two primary-conductor nodes; returns segment ids (the `i` property). */
export function primaryPath(from: string, to: string): number[] | null {
  if (from === to) return [];
  if (!store.adj.has(from) || !store.adj.has(to)) return null;
  const prev = new Map<string, [string, number]>([[from, ['', -1]]]);
  let frontier = [from];
  while (frontier.length && prev.size < 40000) {
    const next: string[] = [];
    for (const n of frontier) {
      for (const [m, seg] of store.adj.get(n) ?? []) {
        if (prev.has(m)) continue;
        prev.set(m, [n, seg]);
        if (m === to) {
          const path: number[] = [];
          for (let c = to; c !== from;) { const [pn, ps] = prev.get(c)!; path.push(ps); c = pn; }
          return path;
        }
        next.push(m);
      }
    }
    frontier = next;
  }
  return null;
}

/** Equipment classes in matched_upstream.txt (nearest the premise first). */
export const CHAIN_LABEL: Record<string, string> = {
  X: 'Distribution transformer', T: 'Step transformer', F: 'Fuse', H: 'Recloser (hydraulic)', E: 'Recloser (electronic)', Z: 'Sectionalizer', B: 'Circuit breaker', '?': 'Device',
};
export const CHAIN_SHORT: Record<string, string> = { X: 'Xfmr', T: 'Step', F: 'Fuse', H: 'Recl-H', E: 'Recl-E', Z: 'Sect', B: 'Breaker', '?': '?' };

export interface ChainItem { code: string; loc: string; id: string; label: string; coords?: LngLat; dev?: DevInfo }

export function chainFor(xfLoc: string): ChainItem[] {
  return (store.chains[xfLoc] ?? []).map(raw => {
    const [code = '?', loc = '', id = ''] = raw.split(':');
    let coords: LngLat | undefined, dev: DevInfo | undefined;
    if (code === 'F' || code === 'H' || code === 'E') {
      const want = code === 'F' ? 'fuses' : 'reclosers';
      const list = store.devByLoc.get(loc) ?? [];
      dev = list.find(d => d.layer === want && (code === 'F' || d.props.dev === CHAIN_LABEL[code])) ?? list.find(d => d.layer === want);
      coords = dev?.coords;
    } else if (code !== 'B') {
      coords = store.anchors[loc];
    }
    return { code, loc, id, label: CHAIN_LABEL[code] ?? 'Device', coords, dev };
  });
}

export { firstCoord };
