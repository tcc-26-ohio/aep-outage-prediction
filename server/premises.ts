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
  /** [longitude, latitude], used by the client page to zoom the satellite map to the address */
  coords: [number, number] | null;
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
    coords: details?.get(r[0])?.coords ?? null,
  };
}

export async function searchPremises(query: string, limit = 8): Promise<PremiseMatch[]> {
  const q = norm(query);
  if (q.length < 3) return [];
  const all = await load();
  await loadDetails();
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
  await loadDetails();
  const r = all.find(x => x[0] === pid);
  return r ? toMatch(r) : null;
}

// ---- per-premise status, estimates and outage reports (used by the client chat's action buttons)
import { reportLabor } from '../src/map/labor';
import { exposureAround, type Exposure } from './exposure';
import { windAssessment, windFactor, winterFactor, type WindDetail } from './wind';

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
  damage: { damage: string; asset: string; reported: string | null; repaired: boolean; circuitWide: boolean; locationId: string; /** where the damage is, [longitude, latitude] */ coords: [number, number]; crew: CrewState | null }[];
  /** wind loading on the pole and transformer serving the premise (null without weather or equipment data) */
  wind: WindDetail | null;
  /** simulated crew progress; the least advanced of the open repairs (null when none has a status) */
  crew: CrewState | null;
  /** estimated hours from now until the repairs are done (null when no open damage report is tied to the premise) */
  restoration: { lowHours: number; highHours: number } | null;
  risk: Risk;
}

export const CREW_STATES = ['reported', 'assigned', 'arrived', 'underway'] as const;
export type CrewState = typeof CREW_STATES[number];

/** Color-coded outlook for the client map, from pole age, road exposure, wind loading, escalation and surrounding outages. */
export interface Risk {
  level: 'none' | 'low' | 'moderate' | 'high' | 'severe';
  /** 0-18: six factors scored 0-3 each */
  score: number;
  confidence: 'high' | 'medium' | 'low';
  factors: { poleAge: RiskFactor; roads: RiskFactor; wind: RiskFactor; winter: RiskFactor; escalation: RiskFactor; nearby: RiskFactor };
  notes: string[];
}
interface RiskFactor { label: string; points: number }

const NEARBY_KM = 2;
const kmBetween = (a: [number, number], b: [number, number]) => Math.hypot((a[0] - b[0]) * 88.8, (a[1] - b[1]) * 110.54);

function assessRisk(args: {
  affecting: { customers: number; approx: boolean; circuitWide: boolean }[];
  nearby: number;
  lifeSupport: boolean;
  exposure: Exposure;
  wind: WindDetail | null;
}): Risk {
  const { affecting, nearby, lifeSupport, exposure, wind: w } = args;
  const none = affecting.length === 0;
  // pole age: older poles around the house are more likely to fail (poles MAX_POLE_AGE years or older are ignored)
  const { ages } = exposure;
  const mean = ages.length ? Math.round(ages.reduce((s, a) => s + a, 0) / ages.length) : 0;
  const poleAge: RiskFactor = !ages.length ? { label: 'No usable pole age data nearby', points: 0 }
    : { label: `Nearby poles average ${mean} years old`, points: mean < 20 ? 0 : mean < 35 ? 1 : mean < 50 ? 2 : 3 };
  // roads: poles beside interstates and busy roads are exposed to crashes (OSM road class stands in for traffic)
  const roadWeight = exposure.nearInterstate + 0.5 * exposure.nearMajor;
  const share = exposure.poles ? roadWeight / exposure.poles : 0;
  const roads: RiskFactor = roadWeight === 0 ? { label: exposure.poles ? 'No nearby poles beside major roads' : 'No poles mapped nearby', points: 0 }
    : { label: [exposure.nearInterstate && `${exposure.nearInterstate} beside an interstate or highway`, exposure.nearMajor && `${exposure.nearMajor} beside a busy road`].filter(Boolean).join(', ') + ` (of ${exposure.poles} nearby poles)`, points: share < 0.1 ? 1 : share < 0.3 ? 2 : 3 };
  // wind and trees: the area's typical yearly peak gust loading the serving pole (ANSI O5.1 class rating) plus tree canopy along the line
  const wind: RiskFactor = windFactor(w);
  // ice and wet ground: the worst freezing-rain event on record, plus how often gusty days find the ground saturated
  const winter: RiskFactor = winterFactor(w);
  // escalation: how far the outage reaches (customers cut, circuit-wide, life support)
  const maxCust = Math.max(0, ...affecting.map(a => a.customers));
  const wide = affecting.some(a => a.circuitWide);
  const base = wide ? 3 : maxCust >= 1500 ? 3 : maxCust >= 300 ? 2 : maxCust >= 50 ? 1 : 0;
  const escalation: RiskFactor = none ? { label: 'Nothing escalating', points: 0 }
    : { label: `${wide ? 'Circuit-wide' : `${maxCust.toLocaleString()} customers off`}${lifeSupport ? ' · life support' : ''}`, points: Math.min(3, base + (lifeSupport ? 1 : 0)) };
  // surrounding outages: other open damage reports close to the house
  const around: RiskFactor = { label: nearby === 0 ? `None within ${NEARBY_KM} km` : `${nearby} report${nearby === 1 ? '' : 's'} within ${NEARBY_KM} km`, points: nearby === 0 ? 0 : nearby <= 2 ? 1 : nearby <= 6 ? 2 : 3 };
  const score = poleAge.points + roads.points + wind.points + winter.points + escalation.points + around.points;
  const level: Risk['level'] = none && nearby === 0 ? 'none' : score <= 5 ? 'low' : score <= 9 ? 'moderate' : score <= 13 ? 'high' : 'severe';
  // confidence: how well the underlying data supports the estimate
  const notes: string[] = [];
  let conf = 3;
  if (none) { conf = 2; notes.push('No open report does not rule out an unreported outage.'); }
  else {
    if (affecting.some(a => a.approx)) { conf--; notes.push('Some damage is off the traced network, so reach is approximate.'); }
    if (wide) { conf--; notes.push('No device isolates the damage, so the whole circuit is assumed affected.'); }
  }
  if (!ages.length) { conf = Math.max(1, conf - 1); notes.push('No pole age data is available near this address.'); }
  if (!w) { conf = Math.max(1, conf - 1); notes.push('No wind or equipment data is available for this address.'); }
  else if (w.exposed && !w.canopy) { conf = Math.max(1, conf - 1); notes.push('No tree canopy data is available for this address.'); }
  if (w && w.exposed && w.assumed.length) { conf = Math.max(1, conf - 1); notes.push(`Some pole details were missing (${w.assumed.join(', ')}), so typical values were used for the wind load.`); }
  return { level, score, confidence: conf >= 3 ? 'high' : conf === 2 ? 'medium' : 'low', factors: { poleAge, roads, wind, winter, escalation, nearby: around }, notes };
}

/** includeRepaired is a debug switch: also report damage that has already been repaired. */
export async function premiseStatus(pid: string, includeRepaired = false): Promise<PremiseStatus | null> {
  const d = (await loadDetails()).get(pid);
  const p = await getPremise(pid);
  if (!d || !p) return null;
  const damage: PremiseStatus['damage'] = [];
  const hoursByReport: number[] = [];
  const affecting: { customers: number; approx: boolean; circuitWide: boolean }[] = [];
  for (const f of arcos!) {
    const a = f.properties;
    const repaired = a.repaired === 'Yes';
    if (repaired && !includeRepaired) continue;
    const circuitWide = a.openM === 'breaker' && a.openC === p.circuit;
    if (!circuitWide && !(a.open && openDown[a.open]?.includes(d.xf))) continue;
    hoursByReport.push(reportLabor(a)?.person ?? 0);
    affecting.push({ customers: a.openN ?? 0, approx: !!a.openA, circuitWide });
    damage.push({ damage: a.damage ?? 'Damage', asset: a.asset ?? 'equipment', reported: a.reported ?? null, repaired, circuitWide, locationId: a.open ?? a.openC ?? '', coords: f.geometry.coordinates, crew: CREW_STATES.includes(a.crew) ? a.crew : null });
  }
  const personHours = hoursByReport.reduce((s, h) => s + h, 0);
  const restoration = personHours > 0 ? { lowHours: Math.max(1, Math.round(personHours / CREW_MAX)), highHours: Math.max(2, Math.round(personHours / CREW_MIN)) } : null;
  const nearby = arcos!.filter(f => (f.properties.repaired === 'No' || includeRepaired) && kmBetween(d.coords, f.geometry.coordinates) <= NEARBY_KM).length;
  const wind = await windAssessment(d.xf, d.coords);
  const crewIdx = damage.filter(x => !x.repaired && x.crew).map(x => CREW_STATES.indexOf(x.crew!));
  return {
    transformerId: d.xf,
    damage,
    crew: crewIdx.length ? CREW_STATES[Math.min(...crewIdx)]! : null,
    restoration,
    wind,
    risk: assessRisk({ affecting, nearby, lifeSupport: p.lifeSupport, exposure: await exposureAround(d.coords), wind }),
  };
}
