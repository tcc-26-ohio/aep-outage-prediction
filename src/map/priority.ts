// Priority ranking for ARCOS damage reports.
//
// score = customers de-energized
//       + LIFE_SUPPORT_WEIGHT  per life-support customer de-energized
//       + facility weight      per hospital / fire station / ambulance service near the de-energized area
//
// "Near" is measured from the damage site and from every transformer that loses power when the chosen
// isolation device is opened: full weight within NEAR_M, reduced weight within FAR_M. A hospital is worth as
// much as several hundred customers by default; tune the weights below.
import { store, type LayerKey, type LngLat, type Props } from './store';

export const WEIGHTS = { customer: 1, lifeSupport: 50, hospitals: 400, fire: 150, ambulance: 150 } as const;
export const NEAR_M = 500;
export const FAR_M = 1500;
export const FAR_FACTOR = 0.4;

export interface Issue { id: number; props: Props; coords: LngLat }
export interface Ranked {
  issue: Issue;
  rank: number;
  score: number;
  customers: number;
  lifeSupport: number;
  facilities: { layer: 'hospitals' | 'fire' | 'ambulance'; name: string; meters: number; points: number }[];
  parts: { customers: number; lifeSupport: number; facilities: number };
}

const FACILITY_LAYERS = ['hospitals', 'fire', 'ambulance'] as const;
const FACILITY_LABEL = { hospitals: 'Hospital', fire: 'Fire station', ambulance: 'Ambulance' } as const;
export { FACILITY_LABEL };

const meters = (a: LngLat, b: LngLat) => Math.hypot((a[0] - b[0]) * 88800, (a[1] - b[1]) * 110540);

/** Locations that lose power (plus the damage site) for an issue. */
function affectedPoints(issue: Issue): LngLat[] {
  const p = issue.props;
  const pts: LngLat[] = [issue.coords];
  const xfs = p.open ? store.openDown[p.open] ?? [] : p.openC ? [...store.xf.values()].filter(x => x.props.circuit === p.openC).map(x => x.loc) : [];
  for (const loc of xfs) { const c = store.xf.get(loc)?.coords; if (c) pts.push(c); }
  return pts;
}

export function rankIssues(issues: Issue[]): Ranked[] {
  const ranked = issues.map(issue => {
    const p = issue.props;
    const customers = p.openN ?? 0;
    const lifeSupport = p.openLife ?? 0;
    const pts = affectedPoints(issue);
    const facilities: Ranked['facilities'] = [];
    for (const layer of FACILITY_LAYERS) {
      for (const [name, f] of store.facilities[layer] ?? []) {
        let d = Infinity;
        for (const pt of pts) { const m = meters(pt, f.coords); if (m < d) d = m; }
        const factor = d <= NEAR_M ? 1 : d <= FAR_M ? FAR_FACTOR : 0;
        if (factor) facilities.push({ layer, name, meters: d, points: WEIGHTS[layer] * factor });
      }
    }
    facilities.sort((a, b) => b.points - a.points);
    const parts = { customers: customers * WEIGHTS.customer, lifeSupport: lifeSupport * WEIGHTS.lifeSupport, facilities: facilities.reduce((a, f) => a + f.points, 0) };
    return { issue, rank: 0, score: parts.customers + parts.lifeSupport + parts.facilities, customers, lifeSupport, facilities, parts };
  });
  ranked.sort((a, b) => b.score - a.score || b.customers - a.customers);
  ranked.forEach((r, i) => { r.rank = i + 1; });
  return ranked;
}
