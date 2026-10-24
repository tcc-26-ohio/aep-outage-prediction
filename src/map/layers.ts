// MapLibre layer definitions. Every source starts empty and is filled by setData once its GeoJSON loads.
import type { LayerSpecification } from 'maplibre-gl';
import { DEFAULT_ON, type LayerKey } from './store';
import { ICON_COLORS } from './icons';

export const PHASE_COLORS: Record<number, string> = { 1: '#fde047', 2: '#fb923c', 3: '#f43f5e' };
export const SECONDARY_COLOR = '#38bdf8';
export const SERVICE_COLOR = '#94a3b8';
export const CUSTOMER_COLOR = '#86efac';
export const POLE_COLOR = '#a8a29e';

export const BASEMAPS = {
  dark: { label: 'Dark', maxzoom: 16, tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}'], attribution: 'Esri, HERE, Garmin, © OpenStreetMap contributors' },
  streets: { label: 'Streets', maxzoom: 19, tiles: ['a', 'b', 'c'].map(s => `https://${s}.tile.openstreetmap.org/{z}/{x}/{y}.png`), attribution: '© OpenStreetMap contributors' },
  satellite: { label: 'Satellite', maxzoom: 19, tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'], attribution: 'Esri, Maxar, Earthstar Geographics' },
} as const;
export type Basemap = keyof typeof BASEMAPS;

const phNum = ['coalesce', ['get', 'phn'], 1];
const phColor: any = ['match', phNum, 1, PHASE_COLORS[1], 2, PHASE_COLORS[2], 3, PHASE_COLORS[3], '#a3a3a3'];
const phWidth: any = ['match', phNum, 1, 1.1, 2, 1.9, 3, 2.9, 1.1];
const zoomScaled = (lo: number, hi: number, w: any): any => ['interpolate', ['linear'], ['zoom'], 9, ['*', lo, w], 16, ['*', hi, w]];
const isUG: any = ['==', ['get', 'mount'], 'Underground'];
const isOH: any = ['!=', ['get', 'mount'], 'Underground'];
const none: any = ['==', ['get', 'g'], -1];

export const EMPTY = { type: 'FeatureCollection', features: [] } as const;
export const SOURCE_IDS: string[] = ['secondary', 'primary', 'poles', 'customers', 'transformers', 'fuses', 'switches', 'reclosers', 'arcos', 'hospitals', 'fire', 'ambulance', 'chain', 'sel', 'openpt'];

/** MapLibre layer ids that belong to each toggleable layer. */
export const LAYER_IDS: Record<LayerKey, string[]> = {
  secondary: ['sec-oh', 'sec-ug'],
  primary: ['pri-oh', 'pri-ug'],
  poles: ['poles'],
  customers: ['cust', 'cust-life'],
  transformers: ['tx'],
  fuses: ['fuses'],
  switches: ['switches'],
  reclosers: ['reclosers'],
  arcos: ['arcos'],
  hospitals: ['hospitals'],
  fire: ['fire'],
  ambulance: ['ambulance'],
};

/** Layers a click can select, in priority order (first hit wins). */
export const INTERACTIVE: [string, LayerKey][] = [
  ['hospitals', 'hospitals'], ['fire', 'fire'], ['ambulance', 'ambulance'], ['arcos', 'arcos'],
  ['reclosers', 'reclosers'], ['switches', 'switches'], ['fuses', 'fuses'], ['tx', 'transformers'],
  ['cust-life', 'customers'], ['cust', 'customers'], ['poles', 'poles'],
  ['pri-oh', 'primary'], ['pri-ug', 'primary'], ['sec-oh', 'secondary'], ['sec-ug', 'secondary'],
];

export const MIN_ZOOM: Partial<Record<LayerKey, number>> = { secondary: 12, customers: 13, poles: 14, transformers: 11, fuses: 11 };

export function buildLayers(): LayerSpecification[] {
  const vis = (key: LayerKey) => ({ visibility: DEFAULT_ON.includes(key) ? 'visible' : 'none' } as const);
  const symbol = (id: string, key: LayerKey, extra: any = {}): any => ({
    id, type: 'symbol', source: key, layout: { 'icon-allow-overlap': true, 'icon-ignore-placement': true, ...vis(key), ...extra.layout }, ...(extra.rest ?? {}),
  });
  const secColor: any = ['match', ['get', 'type'], 'Service drop', SERVICE_COLOR, SECONDARY_COLOR];
  const secWidth: any = ['interpolate', ['linear'], ['zoom'], 12, 0.5, 18, ['match', ['get', 'type'], 'Service drop', 1.2, 2.4]];
  const layers: any[] = [
    // secondary (low voltage): solid overhead, dashed underground
    { id: 'sec-oh', type: 'line', source: 'secondary', minzoom: MIN_ZOOM.secondary, filter: isOH, layout: { ...vis('secondary') }, paint: { 'line-color': secColor, 'line-width': secWidth, 'line-opacity': 0.85 } },
    { id: 'sec-ug', type: 'line', source: 'secondary', minzoom: MIN_ZOOM.secondary, filter: isUG, layout: { ...vis('secondary') }, paint: { 'line-color': secColor, 'line-width': secWidth, 'line-opacity': 0.85, 'line-dasharray': [2, 2] } },
    { id: 'sec-hl-glow', type: 'line', source: 'secondary', filter: none, layout: { 'line-cap': 'round' }, paint: { 'line-color': '#e0f2fe', 'line-width': ['interpolate', ['linear'], ['zoom'], 12, 4, 18, 9], 'line-opacity': 0.35, 'line-blur': 2 } },
    { id: 'sec-hl', type: 'line', source: 'secondary', filter: none, layout: { 'line-cap': 'round' }, paint: { 'line-color': '#ffffff', 'line-width': ['interpolate', ['linear'], ['zoom'], 12, 1.2, 18, 3.2] } },
    // primary (15 kV-class distribution): width + color encode phase count
    { id: 'pri-circuit', type: 'line', source: 'primary', filter: ['==', ['get', 'circuit'], ''], paint: { 'line-color': '#ffffff', 'line-width': zoomScaled(2, 5, phWidth), 'line-opacity': 0.28, 'line-blur': 1.5 } },
    { id: 'pri-oh', type: 'line', source: 'primary', filter: isOH, layout: { ...vis('primary'), 'line-cap': 'round' }, paint: { 'line-color': phColor, 'line-width': zoomScaled(0.5, 1.6, phWidth) } },
    { id: 'pri-ug', type: 'line', source: 'primary', filter: isUG, layout: { ...vis('primary') }, paint: { 'line-color': phColor, 'line-width': zoomScaled(0.5, 1.6, phWidth), 'line-dasharray': [2, 1.5] } },
    { id: 'pri-hl-glow', type: 'line', source: 'primary', filter: ['in', ['get', 'i'], ['literal', []]], layout: { 'line-cap': 'round' }, paint: { 'line-color': '#ffffff', 'line-width': zoomScaled(5, 9, phWidth), 'line-opacity': 0.35, 'line-blur': 2 } },
    { id: 'pri-hl', type: 'line', source: 'primary', filter: ['in', ['get', 'i'], ['literal', []]], layout: { 'line-cap': 'round' }, paint: { 'line-color': phColor, 'line-width': zoomScaled(1.4, 2.6, phWidth) } },
    { id: 'poles', type: 'circle', source: 'poles', minzoom: MIN_ZOOM.poles, layout: { ...vis('poles') }, paint: { 'circle-color': POLE_COLOR, 'circle-radius': ['interpolate', ['linear'], ['zoom'], 14, 1.2, 18, 3.2], 'circle-stroke-color': '#292524', 'circle-stroke-width': 0.6 } },
    { id: 'cust', type: 'circle', source: 'customers', minzoom: MIN_ZOOM.customers, layout: { ...vis('customers') }, paint: { 'circle-color': CUSTOMER_COLOR, 'circle-radius': ['interpolate', ['linear'], ['zoom'], 13, 1.3, 18, 4.5], 'circle-stroke-color': '#052e16', 'circle-stroke-width': 0.6, 'circle-opacity': 0.9 } },
    { id: 'cust-life', type: 'circle', source: 'customers', minzoom: 10, filter: ['==', ['get', 'life'], 1], layout: { ...vis('customers') }, paint: { 'circle-color': '#ef4444', 'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 3, 18, 7], 'circle-stroke-color': '#fff', 'circle-stroke-width': 1.2 } },
    { id: 'cust-hl', type: 'circle', source: 'customers', filter: ['in', ['get', 'xf'], ['literal', []]], paint: { 'circle-color': '#bbf7d0', 'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 3, 18, 7], 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 1.6 } },
    { id: 'chain-line', type: 'line', source: 'chain', layout: { 'line-cap': 'round' }, paint: { 'line-color': '#ffffff', 'line-width': 1.6, 'line-dasharray': [1, 2], 'line-opacity': 0.9 } },
    symbol('tx', 'transformers', { layout: { 'icon-image': 'tx', 'icon-size': ['interpolate', ['linear'], ['zoom'], 11, 0.35, 17, 0.8] }, rest: { minzoom: MIN_ZOOM.transformers } }),
    { id: 'tx-hl', type: 'circle', source: 'transformers', filter: ['in', ['get', 'loc'], ['literal', []]], paint: { 'circle-color': 'rgba(0,0,0,0)', 'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 4, 17, 13], 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2 } },
    symbol('fuses', 'fuses', { layout: { 'icon-image': 'fuse', 'icon-size': ['interpolate', ['linear'], ['zoom'], 11, 0.4, 17, 0.85] }, rest: { minzoom: MIN_ZOOM.fuses } }),
    symbol('switches', 'switches', { layout: { 'icon-image': ['case', ['==', ['get', 'state'], 'Open'], 'sw-open', 'sw-closed'], 'icon-size': ['interpolate', ['linear'], ['zoom'], 9, 0.5, 17, 1] } }),
    symbol('reclosers', 'reclosers', { layout: { 'icon-image': 'recloser', 'icon-size': ['interpolate', ['linear'], ['zoom'], 9, 0.55, 17, 1.1] } }),
    symbol('arcos', 'arcos', { layout: { 'icon-image': 'arcos', 'icon-size': ['interpolate', ['linear'], ['zoom'], 9, 0.5, 17, 1] } }),
    symbol('hospitals', 'hospitals', { layout: { 'icon-image': 'hospital', 'icon-size': 1.1 } }),
    symbol('fire', 'fire', { layout: { 'icon-image': 'fire', 'icon-size': 0.95 } }),
    symbol('ambulance', 'ambulance', { layout: { 'icon-image': 'ambulance', 'icon-size': 0.95 } }),
    { id: 'open-halo', type: 'circle', source: 'openpt', paint: { 'circle-color': 'rgba(239,68,68,0.25)', 'circle-radius': 26, 'circle-stroke-color': '#ef4444', 'circle-stroke-width': 1.5 } },
    { id: 'open-pt', type: 'symbol', source: 'openpt', layout: { 'icon-image': 'open-here', 'icon-size': 1.1, 'icon-allow-overlap': true, 'icon-ignore-placement': true } },
    { id: 'sel-ring', type: 'circle', source: 'sel', paint: { 'circle-color': 'rgba(0,0,0,0)', 'circle-radius': 15, 'circle-stroke-color': '#facc15', 'circle-stroke-width': 3 } },
  ];
  return layers;
}

export const LEGEND_COLORS = ICON_COLORS;
