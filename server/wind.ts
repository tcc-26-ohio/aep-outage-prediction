// Wind loading on the pole and transformer that serve a premise, for the risk estimate.
//
// This is a closed-form structural model, not a trained network: wind pressure on the pole, its wires and the transformer is
// summed into a bending moment at the groundline and compared with the pole's ANSI O5.1-2022 class rating (the horizontal load
// the pole is rated to carry 2 ft from its tip). A physics-informed or neural-operator surrogate would need simulated or
// measured load data to train on; there is none here, and the calculation below is what such a surrogate would approximate.
//
// Wind comes from the hourly weather files in data/weather (Open-Meteo, 10 m gusts, km/h). That data is historical, so the
// scored wind is the area's typical yearly peak gust; `sensitivity` shows the same structure under stronger gusts.
//
// Ice and wet ground: the same weather files give temperature, rain and precipitation, so two more winter inputs are derived.
// Freezing rain (rain at or below 0 C) is accreted into a radial ice thickness with the Jones (1998) simple freezing-rain
// model, reset when it thaws. Soil wetness is an antecedent precipitation index (daily rainfall with 10%/day decay); the
// area's "wet" ground is the top quarter of its own history. Both are rough: no ice gauge, soil probe or tree-ice data backs them.
// Trees: branches and trees falling on lines cause most real wind outages, so NLCD tree canopy cover around the poles along the
// serving line is scored alongside the structural load (scripts/build-canopy.py). Canopy cover says how wooded the corridor is,
// not which trees are hazards: there is no tree height, health or trimming data.
// Span, wire size and pole circumference are typical values (see the constants), not field measurements.
import { canopyAround } from './canopy';
import { nearestPole, poleAtLoc, polesWithin, type Pole } from './exposure';

const GIS = new URL('../public/gis/', import.meta.url).pathname;
const WEATHER = new URL('../data/weather/', import.meta.url).pathname;

// ---- weather
export interface Station {
  city: string; coords: [number, number]; annualPeakKmh: number; recordKmh: number; recordAt: string; recent72hKmh: number; dataEnd: string;
  /** largest radial ice (mm) from one freezing-rain event, when it peaked, and the strongest gust while that ice was on */
  iceRecordMm: number; iceRecordAt: string; iceGustKmh: number;
  /** days a year with a gust of 45 mph or more, and the share of them that came on wet ground */
  windyDaysPerYear: number; windyWetPct: number;
}
let stations: Station[] | null = null;
/** months (1-12) with at least 4% of all freezing-rain hours in the record */
let iceMonths: number[] = [];

/** The date the risk is judged for: today, or RISK_DATE (YYYY-MM-DD) to preview another time of year. */
export function riskDate() {
  const d = process.env.RISK_DATE ? new Date(`${process.env.RISK_DATE}T12:00:00`) : null;
  return d && !Number.isNaN(d.getTime()) ? d : new Date();
}

const ICE_DENSITY = 900; // kg/m3
const WINDY_KMH = 72; // 45 mph

async function loadStations() {
  if (stations) return stations;
  const out: Station[] = [];
  const monthHours = new Array<number>(13).fill(0);
  const { readdirSync } = await import('node:fs');
  for (const name of readdirSync(WEATHER).filter(n => n.endsWith('_hourly.csv'))) {
    const lines = (await Bun.file(WEATHER + name).text()).split('\n');
    let coords: [number, number] | null = null, city = '';
    const yearly: number[] = [];
    let record = 0, recordAt = '', n = 0, last = '';
    const tail: number[] = [];
    // ice
    let ice = 0, evGust = 0, iceBest = 0, iceAt = '', iceGust = 0;
    // soil wetness, per day
    const days: { api: number; gust: number }[] = [];
    let curDay = '', dayP = 0, dayG = 0, api = 0;
    for (let i = 1; i < lines.length; i++) {
      const f = lines[i]!.split(',');
      if (f.length < 13 || !f[12]) continue;
      const gust = Number(f[12]);
      if (!Number.isFinite(gust)) continue;
      if (!coords) { coords = [Number(f[3]), Number(f[2])]; city = f[0]!; }
      const w = Math.floor(n++ / 8760); // consecutive 365-day windows from the start of the record
      yearly[w] = Math.max(yearly[w] ?? 0, gust);
      if (gust > record) { record = gust; recordAt = f[6]!; }
      tail.push(gust); if (tail.length > 72) tail.shift();
      last = f[6]!;

      const temp = Number(f[7]), prec = Number(f[8]) || 0, rain = Number(f[9]) || 0, wind = (Number(f[11]) || 0) / 3.6;
      if (temp > 0) { ice = 0; evGust = 0; }
      else if (rain > 0) {
        monthHours[Number(f[6]!.slice(5, 7))]!++;
        // Jones simple model: vertical rain flux and wind-driven flux onto a cylinder; the diameter cancels out of the radial thickness
        const lwc = 0.067e-3 * Math.pow(rain, 0.846); // kg/m3
        ice += Math.hypot(rain / 3600, lwc * wind) * 3600 / (ICE_DENSITY * Math.PI); // metres per hour
      }
      if (ice > 0) evGust = Math.max(evGust, gust);
      if (ice * 1000 > iceBest) { iceBest = ice * 1000; iceAt = f[6]!; iceGust = evGust; }

      const day = f[6]!.slice(0, 10);
      if (!curDay) curDay = day;
      if (day !== curDay) { api = api * 0.9 + dayP; days.push({ api, gust: dayG }); curDay = day; dayP = 0; dayG = 0; }
      dayP += prec; dayG = Math.max(dayG, gust);
    }
    if (!coords || !yearly.length) continue;
    const whole = yearly.length > 1 && n % 8760 < 2000 ? yearly.slice(0, -1) : yearly; // drop a short final window
    const sorted = days.map(d => d.api).sort((a, b) => a - b);
    const wetAbove = sorted[Math.floor(0.75 * (sorted.length - 1))] ?? Infinity;
    const windy = days.filter(d => d.gust >= WINDY_KMH);
    out.push({
      city, coords, recordKmh: record, recordAt, dataEnd: last, recent72hKmh: Math.max(...tail),
      annualPeakKmh: whole.reduce((s, v) => s + v, 0) / whole.length,
      iceRecordMm: iceBest, iceRecordAt: iceAt, iceGustKmh: iceGust,
      windyDaysPerYear: windy.length / (days.length / 365.25),
      windyWetPct: windy.length ? 100 * windy.filter(d => d.api >= wetAbove).length / windy.length : 0,
    });
  }
  const total = monthHours.reduce((a, b) => a + b, 0) || 1;
  iceMonths = monthHours.map((h, m) => (h / total >= 0.04 ? m : 0)).filter(Boolean);
  return (stations = out);
}

async function stationFor(c: [number, number]) {
  const list = await loadStations();
  let best: Station | undefined, bd = Infinity;
  for (const s of list) {
    const d = Math.hypot((s.coords[0] - c[0]) * 88.8, (s.coords[1] - c[1]) * 110.54);
    if (d < bd) { bd = d; best = s; }
  }
  return best ? { station: best, km: bd } : null;
}

// ---- transformers
interface XfRecord { kva: string; ph: string; mount: string; bank: string; vin: string; vout: string }
let xfs: Map<string, XfRecord> | null = null;
async function transformer(loc: string) {
  if (!xfs) {
    const fc = (await Bun.file(GIS + 'transformers.geojson').json()) as { features: { properties: Record<string, any> }[] };
    xfs = new Map(fc.features.map(f => [f.properties.loc, { kva: f.properties.kva ?? '', ph: f.properties.ph ?? '', mount: f.properties.mount ?? '', bank: f.properties.bank ?? '', vin: f.properties.vin ?? '', vout: f.properties.vout ?? '' }]));
  }
  return xfs.get(loc);
}

// ---- pole (ANSI O5.1-2022)
/** horizontal load (lb) a pole of this class is rated for, applied 2 ft from the tip */
const CLASS_LOAD: Record<string, number> = { '1': 4500, '2': 3700, '3': 3000, '4': 2400, '5': 1900, '6': 1500, '7': 1200, '9': 740, '10': 370, H1: 5400, H2: 6400, H3: 7500, H4: 8700, H5: 10000, H6: 11400 };
/** minimum circumference (in) at the tip, by class (approximate; used only to size the pole's wind area) */
const TIP_CIRC: Record<string, number> = { '1': 27, '2': 25, '3': 23, '4': 21, '5': 19, '6': 17, '7': 15, '9': 12.5, '10': 12, H1: 29, H2: 31, H3: 33, H4: 35, H5: 37, H6: 39 };
const TAPER_IN_PER_FT = 0.25; // circumference growth toward the butt
const WOOD = new Set(['Pine', 'Wood', 'Cedar', 'Ponderosa Pine', 'Douglas Fir']);
const DEFAULT_CLASS = '5', DEFAULT_HEIGHT_FT = 40;

// typical distribution-line values, not measured
const SPAN_FT = 250, WIRE_DIA_IN = 0.5, SERVICE_DIA_IN = 0.6;

export interface Structure {
  poleLabel: string;
  transformerLabel: string | null;
  /** inputs that were missing and replaced with a typical value */
  assumed: string[];
  momentCapacity: number; // ft·lb at the groundline
  /** wind moment (ft·lb) at a 10 m gust in km/h, with an optional radial ice thickness (mm) on the wires */
  moment: (gustKmh: number, iceMm?: number) => number;
}

const kvaNumber = (s: string) => Number(/([\d.]+)\s*kVA/i.exec(s)?.[1]) || 0;

function buildStructure(pole: Pole | undefined, xf: XfRecord): Structure {
  const assumed: string[] = [];
  const cls = pole?.cls && CLASS_LOAD[pole.cls] ? pole.cls : (assumed.push(pole ? 'pole class' : 'pole'), DEFAULT_CLASS);
  const hParsed = Number(/(\d+)/.exec(pole?.h ?? '')?.[1]);
  const hFt = hParsed > 0 ? hParsed : (pole && assumed.push('pole height'), DEFAULT_HEIGHT_FT);
  const mat = pole?.mat && pole.mat !== 'Unknown' ? pole.mat : null;
  const wood = !mat || WOOD.has(mat);
  if (!mat && pole) assumed.push('pole material');
  const setting = 0.1 * hFt + 2; // ft in the ground
  const H = hFt - setting; // ft above ground
  const capacity = CLASS_LOAD[cls]! * (H - 2);
  const tip = TIP_CIRC[cls]! * (mat === 'Cedar' ? 1.12 : 1) * (wood ? 1 : 0.85);
  const dAvg = (((tip + TAPER_IN_PER_FT * H / 2) / Math.PI) / 12); // ft, mean diameter above ground
  const phases = Math.max(1, (xf.ph.match(/[ABC]/g) ?? []).length);
  const units = phases, kvaTotal = kvaNumber(xf.kva) || 25;
  const kvaUnit = kvaTotal / phases; // a three-phase rating is split over its single-phase units
  const tankArea = 1.2 * Math.pow(Math.max(kvaUnit, 5), 0.4); // ft², projected area of one unit

  const moment = (gustKmh: number, iceMm = 0) => {
    const ice = iceMm / 25.4; // in, radial
    const v10 = gustKmh * 0.621371; // mph
    const q = (z: number) => 0.00256 * Math.pow(v10 * Math.pow(Math.max(z, 6) / 33, 0.143), 2); // psf at height z
    const primaryZ = H - 1.5, xfZ = H - 5, secZ = Math.max(H - 14, 6);
    const wires = (phases + 1) * q(primaryZ) * ((WIRE_DIA_IN + 2 * ice) / 12) * SPAN_FT * primaryZ;
    const service = q(secZ) * ((SERVICE_DIA_IN + 2 * ice) / 12) * SPAN_FT * secZ;
    const tanks = units * q(xfZ) * 1.2 * tankArea * xfZ;
    const shaft = q(H / 2) * dAvg * H * (H / 2);
    return wires + service + tanks + shaft;
  };
  const kva = kvaNumber(xf.kva);
  return {
    poleLabel: `${wood ? '' : 'non-wood '}${mat ? mat.toLowerCase() : 'wood'} pole, class ${cls}, ${hFt} ft`,
    transformerLabel: kva ? `${units > 1 ? `${units}-unit ` : ''}${kva} kVA pole-mounted transformer` : 'pole-mounted transformer',
    assumed, momentCapacity: capacity, moment,
  };
}

export interface WindDetail {
  station: string;
  stationKm: number;
  /** typical yearly peak gust at the area's weather grid, and the record, in km/h */
  annualPeakKmh: number;
  recordKmh: number;
  recordAt: string;
  recent72hKmh: number;
  dataEnd: string;
  poleLabel: string;
  transformerLabel: string | null;
  assumed: string[];
  /** share of the pole's rated strength used by wind at the yearly peak gust (0-1+) */
  utilization: number;
  /** wind load on the pole, as a share of its rating, at other gusts */
  sensitivity: { gustKmh: number; utilization: number }[];
  /** gust at which wind alone would reach the pole's rating */
  ratedGustKmh: number;
  exposed: boolean;
  /** mean NLCD tree canopy cover (percent) around the poles within 150 m, when the grid is available */
  canopy: { pct: number; poles: number } | null;
  /** worst freezing-rain event on record: radial ice (mm), when, the gust while it was on, and the pole's load with that ice on the wires and a 40 mph gust (NESC heavy-loading style case) */
  ice: { recordMm: number; recordAt: string; gustKmh: number; utilization: number };
  /** gusts of 45 mph or more per year, and the share of those days that came on wet (top-quarter) ground */
  ground: { windyDaysPerYear: number; windyWetPct: number };
}

/** Wind load on the structure serving a premise, or null when the weather or equipment data is missing. */
export async function windAssessment(xfLoc: string, coords: [number, number]): Promise<WindDetail | null> {
  const st = await stationFor(coords);
  const xf = xfLoc ? await transformer(xfLoc) : undefined;
  if (!st || !xf) return null;
  const base = { station: st.station.city, stationKm: Math.round(st.km), annualPeakKmh: Math.round(st.station.annualPeakKmh), recordKmh: Math.round(st.station.recordKmh), recordAt: st.station.recordAt.slice(0, 10), recent72hKmh: Math.round(st.station.recent72hKmh), dataEnd: st.station.dataEnd.slice(0, 10),
    ground: { windyDaysPerYear: Math.round(st.station.windyDaysPerYear), windyWetPct: Math.round(st.station.windyWetPct) } };
  // pad-mounted and underground equipment has no pole to load
  if (xf.mount === 'Underground' || /\bPD\b/.test(xf.kva)) {
    return { ...base, poleLabel: 'underground / pad-mounted equipment', transformerLabel: null, assumed: [], utilization: 0, sensitivity: [], ratedGustKmh: 0, exposed: false, canopy: null,
      ice: { recordMm: Math.round(st.station.iceRecordMm), recordAt: st.station.iceRecordAt.slice(0, 10), gustKmh: Math.round(st.station.iceGustKmh), utilization: 0 } };
  }
  const pole = (await poleAtLoc(xfLoc)) ?? (await nearestPole(coords, 0.03));
  const s = buildStructure(pole, xf);
  const u = (g: number) => s.moment(g) / s.momentCapacity;
  const utilization = u(base.annualPeakKmh);
  const near = await polesWithin(coords, 0.15);
  const tree = await canopyAround(near.length ? near : [coords]);
  return {
    ...base, poleLabel: s.poleLabel, transformerLabel: s.transformerLabel, assumed: s.assumed, utilization, exposed: true,
    sensitivity: [50, 70, 90, 110].map(g => ({ gustKmh: g, utilization: u(g) })),
    ratedGustKmh: Math.round(base.annualPeakKmh / Math.sqrt(utilization || 1)),
    canopy: tree ? { pct: Math.round(tree.mean), poles: near.length } : null,
    ice: { recordMm: Math.round(st.station.iceRecordMm), recordAt: st.station.iceRecordAt.slice(0, 10), gustKmh: Math.round(st.station.iceGustKmh), utilization: s.moment(64, st.station.iceRecordMm) / s.momentCapacity },
  };
}

/** Points (0-3) and a plain label for the wind factor: structural load on the pole plus tree canopy along the line, capped at 3. */
export function windFactor(w: WindDetail | null): { label: string; points: number } {
  if (!w) return { label: 'No wind or equipment data for this location', points: 0 };
  if (!w.exposed) return { label: 'Underground or pad-mounted equipment, not loaded by wind', points: 0 };
  // structural: share of the pole's rated strength used at the yearly peak gust, against NESC-style margins (2.5 load factor on wind, 0.65 strength factor)
  const structural = w.utilization < 0.13 ? 0 : w.utilization < 0.195 ? 1 : w.utilization < 0.26 ? 2 : 3;
  const tree = !w.canopy ? 0 : w.canopy.pct < 15 ? 0 : w.canopy.pct < 30 ? 1 : w.canopy.pct < 50 ? 2 : 3;
  const mph = Math.round(w.annualPeakKmh * 0.621371);
  const label = `Yearly peak gusts near ${mph} mph load the serving ${w.poleLabel} to about ${Math.round(w.utilization * 100)}% of its rated strength`
    + (w.canopy ? `; about ${w.canopy.pct}% tree canopy around the nearby line` : '');
  return { label, points: Math.min(3, structural + tree) };
}

const MONTH = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAY = 86400000, RAMP_DAYS = 30;

/** Where `now` sits relative to the ice season: 1 inside it, ramping to 0 over 30 days before and after, 0 otherwise. */
export function iceSeason(now = riskDate()) {
  const months = new Set(iceMonths);
  if (!months.size) return { weight: 1, months: [] as number[], label: '', daysToStart: 0 };
  const startMonth = [...months].find(m => !months.has(m === 1 ? 12 : m - 1)) ?? Math.min(...months);
  const endMonth = [...months].find(m => !months.has(m === 12 ? 1 : m + 1)) ?? Math.max(...months);
  const y = now.getFullYear();
  let weight = 0, daysToStart = Infinity;
  for (const yy of [y - 1, y, y + 1]) {
    const start = new Date(yy, startMonth - 1, 1), end = new Date(startMonth <= endMonth ? yy : yy + 1, endMonth, 0, 23, 59);
    if (now >= start && now <= end) { weight = 1; daysToStart = 0; break; }
    if (start > now) { const d = (start.getTime() - now.getTime()) / DAY; daysToStart = Math.min(daysToStart, d); weight = Math.max(weight, 1 - d / RAMP_DAYS); }
    if (end < now) weight = Math.max(weight, 1 - (now.getTime() - end.getTime()) / DAY / RAMP_DAYS);
  }
  const first = MONTH[startMonth]!, last = MONTH[endMonth]!;
  return { weight: Math.max(0, Math.min(1, weight)), months: [...months], label: `${first} to ${last}`, daysToStart: Math.round(daysToStart) };
}

/** Points (0-3) and a plain label for ice and wet ground: radial ice from the worst freezing-rain event on record, scaled by how close the date is to ice season, plus 1 for wooded lines where gusty days often find the ground wet. */
export function winterFactor(w: WindDetail | null): { label: string; points: number } {
  if (!w) return { label: 'No weather data for this location', points: 0 };
  if (!w.exposed) return { label: 'Underground or pad-mounted equipment, not loaded by ice', points: 0 };
  const season = iceSeason();
  const inches = (w.ice.recordMm / 25.4).toFixed(1);
  const icePts = w.ice.recordMm < 6 ? 0 : w.ice.recordMm < 10 ? 1 : w.ice.recordMm < 15 ? 2 : 3;
  const wooded = (w.canopy?.pct ?? 0) >= 30, soggy = w.ground.windyWetPct >= 40;
  const soilPts = wooded && soggy ? 1 : 0;
  const ice = season.weight === 1 ? `Worst ice storm on record here (${w.ice.recordAt}) built up about ${inches} in of ice on wires`
    : season.weight > 0 ? `Ice season (${season.label}) ${season.daysToStart <= RAMP_DAYS ? 'is close' : 'has just ended'}: the worst ice storm on record here built up about ${inches} in of ice on wires`
    : `Out of ice season (${season.label}), so ice is not counted now`;
  const label = ice + `; gusty days here find the ground already wet about ${w.ground.windyWetPct}% of the time${wooded ? ' and the line is wooded' : ''}`;
  return { label, points: Math.min(3, Math.round(icePts * season.weight) + soilPts) };
}
