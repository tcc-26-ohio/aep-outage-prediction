// Rough bill of materials for an ARCOS damage report, inferred from its damage type and asset (the report has no parts list).
// Same replace-in-kind view as labor.ts. Conductor details come from the nearest primary line when that layer is loaded.
import { store, type LngLat, type Props } from './store';

export interface Material { item: string; qty?: string; note?: string }
export interface MaterialsEstimate { work: string; items: Material[]; conductor?: { spec?: string; volt?: string; phn?: number; mount?: string; meters: number } }

const KX = 88800, KY = 110540; // metres per degree of longitude / latitude here
const NEAR_M = 40;

/** Closest primary conductor segment to a point, if one is within NEAR_M. */
export function nearestPrimary(c: LngLat): MaterialsEstimate['conductor'] | undefined {
  let best: { seg: (typeof store.primarySegs)[number]; d: number } | undefined;
  for (const seg of store.primarySegs) {
    for (let i = 0; i + 1 < seg.pts.length; i++) {
      const a = seg.pts[i]!, b = seg.pts[i + 1]!;
      const ax = (a[0] - c[0]) * KX, ay = (a[1] - c[1]) * KY, dx = (b[0] - a[0]) * KX, dy = (b[1] - a[1]) * KY, len2 = dx * dx + dy * dy;
      const t = len2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
      const d = Math.hypot(ax + t * dx, ay + t * dy);
      if (!best || d < best.d) best = { seg, d };
    }
  }
  return best && best.d <= NEAR_M ? { spec: best.seg.spec, volt: best.seg.volt, phn: best.seg.phn, mount: best.seg.mount, meters: Math.round(best.d) } : undefined;
}

const m = (item: string, qty?: string, note?: string): Material => ({ item, qty, note });

export function estimateMaterials(props: Props, coords: LngLat): MaterialsEstimate | null {
  const damage: string = props.damage ?? 'Other', asset: string = props.asset ?? 'Unknown';
  const line = nearestPrimary(coords);
  const ph = line?.phn && line.phn > 0 ? line.phn : undefined;
  const perPhase = ph ? `${ph} (one per phase)` : '1 per phase';
  const wire = line?.spec ? `${line.spec} primary conductor` : 'Primary conductor, same size as the adjacent span';
  const ug = line?.mount === 'Underground';
  const key = `${damage}|${asset}`;
  const items = ((): { work: string; items: Material[] } | null => {
    switch (key) {
      case 'Damaged Pole|Pole': return { work: 'Pole replacement', items: [
        m('Pole, matching the existing class and height', '1'),
        m('Crossarm and braces', '1 set'),
        m('Insulators, pins and pole-top hardware', perPhase),
        m('Guy wire, anchor and guy guard', '0–2', 'if the old pole was guyed'),
        m('Ground wire, staples and ground rod', '1 set'),
        m(wire, 'transfer'),
      ] };
      case 'Damaged Switch|Fuse Bank': return { work: 'Fuse cutout', items: [
        m('Fuse cutout (with mounting bracket)', perPhase),
        m('Fuse links, sized to the transformer or branch load', perPhase),
        m('Jumper wire and hot-line (stirrup) clamps', perPhase),
        m('Lightning arrester', '0–1 per phase', 'if the bank is arrester-protected'),
      ] };
      case 'Damaged Switch|Recloser Bank': return { work: 'Recloser', items: [
        m('Recloser (matching voltage and phases)', ph && ph > 1 ? '1 three-phase or 1 per phase' : '1'),
        m('Control cable and controller', '1', 'electronic units only'),
        m('Bypass switch or cutouts', perPhase),
        m('Mounting bracket and hardware', '1 set'),
        m('Jumper wire and connectors', perPhase),
      ] };
      case 'Damaged Switch|Switch': return { work: 'Switch', items: [
        m('Line switch / disconnect, matching rating', '1'),
        m('Operating handle and linkage', '1 set'),
        m('Switch insulators and mounting hardware', perPhase),
        m('Jumper wire and connectors', perPhase),
      ] };
      case 'Damaged Equipment|Transformer': return { work: 'Transformer', items: [
        m('Distribution transformer, same kVA as the one replaced', '1'),
        m('Primary fuse cutout and fuse link', '1'),
        m('Lightning arrester', '1'),
        m('Secondary connectors and service leads', '1 set'),
        m('Ground wire and clamps', '1 set'),
        m('Transformer mounting bracket or pad', '1', ug ? 'padmount: concrete pad and cable terminations' : 'pole mount: bracket and bolts'),
      ] };
      case 'Damaged Equipment|Step Transformer': return { work: 'Step transformer', items: [
        m('Step transformer (matching voltage ratio and kVA)', '1'),
        m('Primary and secondary fuse cutouts', perPhase),
        m('Lightning arresters', perPhase),
        m('Jumper wire and connectors', perPhase),
      ] };
      case 'Damaged Wire|primary': return { work: 'Primary wire repair', items: [
        m(wire, ph ? `${ph} phase${ph === 1 ? '' : 's'}` : undefined),
        m('Compression splices / sleeves', perPhase),
        m('Dead-end clamps and insulators', perPhase),
        m('Tie wires and hot-line clamps', perPhase),
      ] };
      case 'Damaged Wire|secondary': return { work: 'Secondary wire repair', items: [
        m('Triplex / quadruplex secondary cable, matching the existing size'),
        m('Secondary clamps and spacers', '1 set'),
        m('Insulation-piercing connectors or splices', '2–4'),
      ] };
      case 'Damaged Wire|Unknown': return { work: 'Wire repair', items: [
        m('Conductor, matching the existing wire'),
        m('Splice sleeves / connectors', '2'),
      ] };
      default: return null;
    }
  })();
  return items ? { ...items, conductor: line } : null;
}
