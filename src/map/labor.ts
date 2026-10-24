// Labor-hour estimate for ARCOS damage reports.
//
// Source: the compatible-unit (CU) hour tables supplied for this project. A damage report is costed as
// replace-in-kind: remove the damaged unit + install a new one. Direct hours are then multiplied by the
// indirect labor multiplier (travel, safety discussion, set-up) to give total person-hours,
// e.g. 6 direct hours * 4.5 = 27 person-hours.
//
// Assumptions that are NOT in the source data (adjust `WORK` below if the crew practice differs):
//  - ARCOS reports carry no pole height or kVA, so poles and transformers use the mean of the size-group averages.
//  - No wire-span CU was supplied; a damaged wire is costed as repairing its termination/attachment hardware.
//  - Access/site adders (restricted access, hand dig, rock hole...) are not applied: the report data has no site conditions.

export const INDIRECT_LABOR_MULTIPLIER = 4.5;

interface Hours { install: number; remove: number }
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const avg = (rows: Hours[]): Hours => ({ install: mean(rows.map(r => r.install)), remove: mean(rows.map(r => r.remove)) });

const CU: Record<string, Hours> = {
  connector: { install: 0.21515789473684216, remove: 0.044800000000000027 },
  dead_end: { install: 0.10760784313725497, remove: 0.06400000000000004 },
  secondary_attachment: { install: 0.23258536585365866, remove: 0.12682926829268298 },
  fuse_cutout: { install: 0.25600000000000017, remove: 0.12800000000000009 },
  recloser: { install: 0.5726238532110097, remove: 0.5253577981651364 },
  switch: { install: 1.7579459459459466, remove: 1.0097297297297296 },
  // mean of Small / Medium / Large pole groups
  pole: avg([
    { install: 1.9416103896103902, remove: 0.763636363636363 },
    { install: 2.50295207667732, remove: 0.9274888178913726 },
    { install: 3.368367816091952, remove: 1.153195402298852 },
  ]),
  // mean of the 12 transformer kVA sizes (10 - 833 kVA)
  transformer: avg([
    [1.189485714285714, 0.8082285714285718], [1.184, 0.8000000000000004], [1.1880851063829778, 0.8061276595744681], [1.2384, 0.8816000000000005],
    [1.2445957446808502, 0.890893617021277], [1.2776585365853663, 0.9369756097560975], [1.2800000000000007, 0.944], [1.2800000000000007, 0.9439999999999997],
    [1.3304615384615381, 0.9624615384615383], [1.3546666666666665, 0.9759999999999999], [1.3795555555555552, 0.9866666666666666], [1.364, 0.98],
  ].map(([install, remove]) => ({ install: install!, remove: remove! }))),
};

/** ARCOS `damage|asset` -> compatible units replaced per report. Keys with no entry are excluded from the estimate. */
export const WORK: Record<string, { label: string; units: string[] }> = {
  'Damaged Pole|Pole': { label: 'Pole replacement', units: ['pole'] },
  'Damaged Switch|Fuse Bank': { label: 'Fuse cutout', units: ['fuse_cutout'] },
  'Damaged Switch|Recloser Bank': { label: 'Recloser', units: ['recloser'] },
  'Damaged Switch|Switch': { label: 'Switch', units: ['switch'] },
  'Damaged Equipment|Transformer': { label: 'Transformer', units: ['transformer'] },
  'Damaged Equipment|Step Transformer': { label: 'Transformer', units: ['transformer'] },
  'Damaged Wire|primary': { label: 'Primary wire: splice + dead-end', units: ['connector', 'dead_end'] },
  'Damaged Wire|secondary': { label: 'Secondary wire: attachment + splice', units: ['secondary_attachment', 'connector'] },
  'Damaged Wire|Unknown': { label: 'Wire: splice', units: ['connector'] },
};

export interface ReportLabor { work: string; units: string[]; direct: number; person: number }

/** Labor for a single ARCOS damage report, or null when no labor unit matches its damage/asset type. */
export function reportLabor(props: { damage?: string; asset?: string }): ReportLabor | null {
  const work = WORK[`${props.damage ?? 'Other'}|${props.asset ?? 'Unknown'}`];
  if (!work) return null;
  const direct = work.units.reduce((h, u) => h + CU[u]!.install + CU[u]!.remove, 0);
  return { work: work.label, units: work.units, direct, person: direct * INDIRECT_LABOR_MULTIPLIER };
}
