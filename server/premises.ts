// Address -> premise lookup for the client chat.
//
// The index (data/premise-addresses.json, written by scripts/build-gis.py) stays on the server. A query returns at most a few
// matches, so a browser never receives the address list. Addresses are house number + street + city; the source
// data has no street suffix (St, Ave...) so matching is on whatever words the customer types.
import { existsSync } from 'node:fs';

export interface PremiseMatch {
  pid: string;
  address: string;
  service: 'OH' | 'UG' | '?';
  customers: number;
  lifeSupport: boolean;
  circuit: string;
  /** the premise's own location id (aep_locati) */
  locationId: string;
}

type Row = [pid: string, number: string, street: string, city: string, state: string, service: string, customers: number, life: number, circuit: string, locationId: string];

const FILE = new URL('../data/premise-addresses.json', import.meta.url).pathname;
let rows: Row[] | null = null;
let haystack: string[] = [];

const title = (s: string) => s.toLowerCase().replace(/\b[a-z]/g, c => c.toUpperCase());
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

async function load() {
  if (rows) return rows;
  if (!existsSync(FILE)) throw new Error('premise address index missing: run `bun run gis:build`');
  rows = (await Bun.file(FILE).json()) as Row[];
  haystack = rows.map(r => norm(`${r[1]} ${r[2]} ${r[3]}`));
  return rows;
}

function toMatch(r: Row): PremiseMatch {
  return {
    pid: r[0],
    address: `${r[1]} ${title(r[2])}, ${title(r[3])}, ${r[4]}`.trim(),
    service: (r[5] as PremiseMatch['service']) ?? '?',
    customers: r[6],
    lifeSupport: r[7] === 1,
    circuit: r[8],
    locationId: r[9] ?? '',
  };
}

export async function searchPremises(query: string, limit = 8): Promise<PremiseMatch[]> {
  const q = norm(query);
  if (q.length < 3) return [];
  const all = await load();
  const tokens = q.split(' ');
  const out: { i: number; score: number }[] = [];
  for (let i = 0; i < all.length; i++) {
    const h = haystack[i]!;
    // every typed word must start a word in the address
    let score = 0;
    for (const t of tokens) {
      const at = h.startsWith(t) ? 0 : h.indexOf(' ' + t);
      if (at < 0) { score = -1; break; }
      score += at === 0 ? 2 : 1;
    }
    if (score < 0) continue;
    if (h.startsWith(tokens[0]!)) score += 2; // house-number-first matches rank higher
    out.push({ i, score });
  }
  out.sort((a, b) => b.score - a.score || haystack[a.i]!.localeCompare(haystack[b.i]!));
  return out.slice(0, limit).map(o => toMatch(all[o.i]!));
}

export async function getPremise(pid: string): Promise<PremiseMatch | null> {
  const all = await load();
  const r = all.find(x => x[0] === pid);
  return r ? toMatch(r) : null;
}

// ---- per-premise status, estimates and outage reports (used by the client chat's action buttons)
import { reportLabor } from '../src/map/labor';

const GIS = new URL('../public/gis/', import.meta.url).pathname;
// Person-hours -> elapsed hours: a larger crew finishes sooner, a smaller one later. The range is returned instead of person-hours.
const CREW_MAX = 8;
const CREW_MIN = 2;

interface Detail { pid: string; coords: [number, number]; xf: string }
let details: Map<string, Detail> | null = null;
let arcos: any[] | null = null;
let openDown: Record<string, string[]> = {};

async function loadDetails() {
  if (!details) {
    const fc = (await Bun.file(GIS + 'customers.geojson').json()) as { features: { geometry: { coordinates: [number, number] }; properties: { pid: string; xf?: string } }[] };
    details = new Map(fc.features.map(f => [f.properties.pid, { pid: f.properties.pid, coords: f.geometry.coordinates, xf: f.properties.xf ?? '' }]));
  }
  if (!arcos) {
    arcos = ((await Bun.file(GIS + 'arcos.geojson').json()) as { features: any[] }).features;
    openDown = (await Bun.file(GIS + 'opendown.json').json()) as Record<string, string[]>;
  }
  return details;
}

export interface PremiseStatus {
  /** unrepaired damage reports whose isolation point would also cut this premise */
  /** serving transformer's location id */
  transformerId: string;
  damage: { damage: string; asset: string; reported: string | null; repaired: boolean; circuitWide: boolean; locationId: string }[];
  /** estimated hours from now until the repairs are done (null when no open damage report is tied to the premise) */
  restoration: { lowHours: number; highHours: number } | null;
}

/** includeRepaired is a debug switch: also report damage that has already been repaired. */
export async function premiseStatus(pid: string, includeRepaired = false): Promise<PremiseStatus | null> {
  const d = (await loadDetails()).get(pid);
  const p = await getPremise(pid);
  if (!d || !p) return null;
  const damage: PremiseStatus['damage'] = [];
  const hoursByReport: number[] = [];
  for (const f of arcos!) {
    const a = f.properties;
    const repaired = a.repaired === 'Yes';
    if (repaired && !includeRepaired) continue;
    const circuitWide = a.openM === 'breaker' && a.openC === p.circuit;
    if (!circuitWide && !(a.open && openDown[a.open]?.includes(d.xf))) continue;
    hoursByReport.push(reportLabor(a)?.person ?? 0);
    damage.push({ damage: a.damage ?? 'Damage', asset: a.asset ?? 'equipment', reported: a.reported ?? null, repaired, circuitWide, locationId: a.open ?? a.openC ?? '' });
  }
  const personHours = hoursByReport.reduce((s, h) => s + h, 0);
  return {
    transformerId: d.xf,
    damage,
    restoration: personHours > 0 ? { lowHours: Math.max(1, Math.round(personHours / CREW_MAX)), highHours: Math.max(2, Math.round(personHours / CREW_MIN)) } : null,
  };
}
