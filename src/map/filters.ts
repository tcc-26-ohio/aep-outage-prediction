// Attribute filters offered under each layer. Values come from the loaded data, so counts are exact.
import type { LayerKey } from './store';

export interface FilterField {
  prop: string;
  label: string;
  /** label for features that lack the property (default "Unknown") */
  missing?: string;
  format?: (v: string) => string;
  /** show the field only if it has at most this many distinct values (default 16) */
  max?: number;
}

const phase = (v: string) => `${v}-phase`;
const yes = (v: string) => (v === '1' ? 'Yes' : v);

export const FILTERS: Partial<Record<LayerKey, FilterField[]>> = {
  primary: [
    { prop: 'phn', label: 'Phases', format: phase },
    { prop: 'volt', label: 'Voltage' },
    { prop: 'usage', label: 'Usage' },
    { prop: 'mount', label: 'Mounting' },
  ],
  secondary: [
    { prop: 'type', label: 'Segment' },
    { prop: 'mount', label: 'Mounting' },
    { prop: 'ph', label: 'Phase(s)' },
  ],
  customers: [
    { prop: 'svc', label: 'Service', format: v => ({ OH: 'Overhead', UG: 'Underground', '?': 'Unknown' }[v] ?? v) },
    { prop: 'life', label: 'Life support', missing: 'No', format: yes },
  ],
  poles: [
    { prop: 'mat', label: 'Material' },
    { prop: 'h', label: 'Height', max: 24 },
    { prop: 'cls', label: 'Class' },
    { prop: 'usage', label: 'Usage' },
    { prop: 'status', label: 'Status' },
  ],
  transformers: [
    { prop: 'type', label: 'Type' },
    { prop: 'bank', label: 'Bank configuration' },
    { prop: 'ph', label: 'Phase(s)' },
    { prop: 'mount', label: 'Mounting' },
  ],
  fuses: [
    { prop: 'state', label: 'Normal state' },
    { prop: 'ph', label: 'Phase(s)' },
    { prop: 'volt', label: 'Voltage' },
  ],
  switches: [
    { prop: 'state', label: 'Normal state' },
    { prop: 'ph', label: 'Phase(s)' },
    { prop: 'volt', label: 'Voltage' },
  ],
  reclosers: [
    { prop: 'dev', label: 'Type' },
    { prop: 'state', label: 'Normal state' },
    { prop: 'ph', label: 'Phase(s)' },
    { prop: 'volt', label: 'Voltage' },
  ],
  hospitals: [{ prop: 'name', label: 'Facility', max: 80 }],
  fire: [{ prop: 'name', label: 'Facility', max: 80 }],
  ambulance: [{ prop: 'name', label: 'Facility', max: 80 }],
};

export const fieldValueExpr = (f: FilterField): any => ['to-string', ['coalesce', ['get', f.prop], f.missing ?? 'Unknown']];

/** MapLibre layers a layer's filters apply to, with the filter each already has. */
export const FILTER_TARGETS: Partial<Record<LayerKey, [string, any | null][]>> = {
  primary: [['pri-oh', ['!=', ['get', 'mount'], 'Underground']], ['pri-ug', ['==', ['get', 'mount'], 'Underground']]],
  secondary: [['sec-oh', ['!=', ['get', 'mount'], 'Underground']], ['sec-ug', ['==', ['get', 'mount'], 'Underground']]],
  customers: [['cust', null], ['cust-life', ['==', ['get', 'life'], 1]]],
  poles: [['poles', null]],
  transformers: [['tx', null]],
  fuses: [['fuses', null]],
  switches: [['switches', null]],
  reclosers: [['reclosers', null]],
  hospitals: [['hospitals', null]],
  fire: [['fire', null]],
  ambulance: [['ambulance', null]],
};
