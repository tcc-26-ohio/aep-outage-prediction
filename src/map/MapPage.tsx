import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import type { GeoJSONSource, Map as MLMap, Marker } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import 'maplibre-gl/dist/maplibre-gl.css';
import './map.css';
import { FILTERS, FILTER_TARGETS, fieldValueExpr, type FilterField } from './filters';
import { IssuesPanel } from './IssuesPanel';
import { INDIRECT_LABOR_MULTIPLIER, reportLabor } from './labor';
import { addIcons, ICON_COLORS } from './icons';
import {
  BASEMAPS, buildLayers, CUSTOMER_COLOR, EMPTY, INTERACTIVE, LAYER_IDS, MIN_ZOOM, PHASE_COLORS, POLE_COLOR, SECONDARY_COLOR, SERVICE_COLOR, SOURCE_IDS, type Basemap,
} from './layers';
import {
  CHAIN_LABEL, CHAIN_SHORT, chainFor, DEFAULT_ON, GROUPS, loadLayer, loadManifest, primaryPath, store, type ChainItem, type LayerKey, type LngLat, type Props,
} from './store';

type Status = 'idle' | 'loading' | 'ready' | 'error';
type Tab = 'layers' | 'inspect' | 'issues' | 'data';

interface Sel { key: LayerKey; props: Props; coords: LngLat }
interface Rel {
  title: string;
  xf?: Props;
  chain: ChainItem[];
  downstreamXf: number;
  downstreamCust: number;
  onPole: { label: string; key: LayerKey; props: Props; coords: LngLat }[];
  circuit?: string;
  pattern?: number;
  isolation?: { loc: string; layer: LayerKey; type: string; customers: number; transformers: number; method: string; approx: boolean; coords?: LngLat } | { breaker: true; circuit: string; customers: number };
}

const KEYS: LayerKey[] = ['primary', 'secondary', 'customers', 'poles', 'transformers', 'fuses', 'switches', 'reclosers', 'arcos', 'hospitals', 'fire', 'ambulance'];
const TITLE: Record<LayerKey, (p: Props) => string> = {
  primary: p => `Primary conductor · ${p.phn ?? '?'}-phase`,
  secondary: p => p.type ?? 'Secondary conductor',
  customers: p => `Premise ${p.pid}`,
  poles: p => `Pole ${p.loc ?? ''}`,
  transformers: p => `Transformer ${p.kva ?? ''}`.trim(),
  fuses: () => 'Fuse', switches: p => `Switch (${p.state ?? '?'})`, reclosers: p => p.dev ?? 'Recloser',
  arcos: p => p.damage ?? 'ARCOS damage', hospitals: p => p.name, fire: p => p.name, ambulance: p => p.name,
};

const fmt = (v: unknown) => (typeof v === 'number' ? (Number.isInteger(v) ? String(v) : v.toFixed(2)) : String(v));
const emptyIn = (prop: string, vals: (string | number)[]): any => ['in', ['get', prop], ['literal', vals]];

maplibregl.setWorkerUrl(workerUrl);

export function MapPage() {
  const el = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MLMap | null>(null);
  const markers = useRef<Marker[]>([]);
  const [ready, setReady] = useState(false);
  const [tab, setTab] = useState<Tab>('layers');
  const [status, setStatus] = useState<Record<string, Status>>({});
  const [visible, setVisible] = useState<Record<string, boolean>>(() => Object.fromEntries(KEYS.map(k => [k, DEFAULT_ON.includes(k)])));
  const [zoom, setZoom] = useState(10);
  const [basemap, setBasemap] = useState<Basemap>('dark');
  /** values switched off per `layer.prop` */
  const [fOff, setFOff] = useState<Record<string, string[]>>({});
  const [circuit, setCircuit] = useState('');
  const [circuits, setCircuits] = useState<string[]>([]);
  const [sel, setSel] = useState<Sel | null>(null);
  const [rel, setRel] = useState<Rel | null>(null);
  const [debugAddresses, setDebugAddresses] = useState(() => { try { return localStorage.getItem('gridguide.map.debug.addresses') === '1'; } catch { return false; } });
  const [address, setAddress] = useState<{ state: 'idle' | 'loading' | 'ok' | 'error'; address?: string; locationId?: string }>({ state: 'idle' });
  const [arcosOff, setArcosOff] = useState<Set<string>>(new Set());
  const [pattern, setPattern] = useState<number | null>(null);
  const [allPatterns, setAllPatterns] = useState(false);
  const [version, setVersion] = useState(0); // bumps when summaries change

  const statusRef = useRef<Record<string, Status>>({});
  const visibleRef = useRef(visible);
  visibleRef.current = visible;
  const setLayerStatus = (k: string, s: Status) => { statusRef.current[k] = s; setStatus(prev => ({ ...prev, [k]: s })); };

  const ensure = useCallback(async (key: LayerKey) => {
    const map = mapRef.current;
    if (!map) return;
    if (statusRef.current[key] === 'ready' || statusRef.current[key] === 'loading') return;
    setLayerStatus(key, 'loading');
    try {
      const fc = await loadLayer(key);
      (map.getSource(key) as GeoJSONSource).setData(fc);
      setLayerStatus(key, 'ready');
      setVersion(v => v + 1);
      if (key === 'primary') setCircuits([...store.circuits.keys()].sort());
    } catch (e) {
      console.error(e);
      setLayerStatus(key, 'error');
    }
  }, []);

  const ensureRef = useRef(ensure);
  ensureRef.current = ensure;

  const show = useCallback((key: LayerKey, on: boolean) => {
    const map = mapRef.current;
    if (!map) return;
    for (const id of LAYER_IDS[key]) map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
    setVisible(v => ({ ...v, [key]: on }));
    if (on) void ensure(key);
  }, [ensure]);

  // ---- map setup
  useEffect(() => {
    const sources: any = {};
    for (const [k, b] of Object.entries(BASEMAPS)) sources[`bm-${k}`] = { type: 'raster', tiles: b.tiles, tileSize: 256, attribution: b.attribution, maxzoom: b.maxzoom };
    for (const id of SOURCE_IDS) sources[id] = { type: 'geojson', data: EMPTY };
    const map = new maplibregl.Map({
      container: el.current!,
      style: {
        version: 8,
        sources,
        layers: [
          ...Object.keys(BASEMAPS).map(k => ({ id: `bm-${k}`, type: 'raster', source: `bm-${k}`, layout: { visibility: k === 'dark' ? 'visible' : 'none' } })),
          ...buildLayers(),
        ],
      } as any,
      bounds: [-80.22, 36.99, -79.7, 37.45],
      fitBoundsOptions: { padding: 20 },
      maxZoom: 19,
    });
    mapRef.current = map;
    if (import.meta.env.DEV) (window as any).__map = map;
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), 'top-right');
    map.addControl(new maplibregl.ScaleControl({ unit: 'imperial' }), 'bottom-right');
    map.on('zoom', () => setZoom(map.getZoom()));
    map.on('load', async () => {
      addIcons(map);
      setReady(true);
      await loadManifest();
      setVersion(v => v + 1);
      DEFAULT_ON.forEach(k => void ensureRef.current(k));
    });
    for (const [id] of INTERACTIVE) {
      map.on('mouseenter', id, () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', id, () => { map.getCanvas().style.cursor = ''; });
    }
    return () => { map.remove(); mapRef.current = null; };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    for (const k of Object.keys(BASEMAPS)) map.setLayoutProperty(`bm-${k}`, 'visibility', k === basemap ? 'visible' : 'none');
  }, [basemap, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    for (const [layer, targets] of Object.entries(FILTER_TARGETS) as [LayerKey, [string, any][]][]) {
      const clauses = (FILTERS[layer] ?? []).flatMap(f => {
        const off = fOff[`${layer}.${f.prop}`];
        return off?.length ? [['!', ['in', fieldValueExpr(f), ['literal', off]]]] : [];
      });
      for (const [id, base] of targets) {
        const all = [...(base ? [base] : []), ...clauses];
        map.setFilter(id, (all.length ? ['all', ...all] : null) as any);
      }
    }
  }, [fOff, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const key: any = ['concat', ['coalesce', ['get', 'damage'], 'Other'], '|', ['coalesce', ['get', 'asset'], 'Unknown']];
    map.setFilter('arcos', arcosOff.size ? ['!', ['in', key, ['literal', [...arcosOff]]]] as any : null);
  }, [arcosOff, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    map.setFilter('pri-circuit', ['==', ['get', 'circuit'], circuit] as any);
    const bbox = store.circuits.get(circuit)?.bbox;
    if (bbox) map.fitBounds([[bbox[0], bbox[1]], [bbox[2], bbox[3]]], { padding: 60, duration: 700 });
  }, [circuit, ready]);

  // ---- highlighting
  const clearHighlight = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    map.setFilter('sec-hl', ['==', ['get', 'g'], -1]);
    map.setFilter('sec-hl-glow', ['==', ['get', 'g'], -1]);
    map.setFilter('cust-hl', emptyIn('xf', []));
    map.setFilter('tx-hl', emptyIn('loc', []));
    map.setFilter('pri-hl', emptyIn('i', []));
    map.setFilter('pri-hl-glow', emptyIn('i', []));
    (map.getSource('chain') as GeoJSONSource).setData(EMPTY as any);
    (map.getSource('sel') as GeoJSONSource).setData(EMPTY as any);
    (map.getSource('openpt') as GeoJSONSource).setData(EMPTY as any);
    markers.current.forEach(m => m.remove());
    markers.current = [];
  }, []);

  const clearSelection = useCallback(() => { clearHighlight(); setSel(null); setRel(null); setPattern(null); }, [clearHighlight]);

  /** Highlight every transformer whose upstream equipment order matches pattern `idx`. */
  const showPattern = useCallback(async (idx: number | null) => {
    const map = mapRef.current;
    if (!map) return;
    clearSelection();
    if (idx === null) return;
    setPattern(idx);
    await ensure('transformers');
    const xfs = store.patternXfs.get(idx) ?? [];
    map.setFilter('tx-hl', emptyIn('loc', xfs));
    const b = new maplibregl.LngLatBounds();
    for (const x of xfs) { const c = store.xf.get(x)?.coords; if (c) b.extend(c); }
    if (!b.isEmpty()) map.fitBounds(b, { padding: 60, duration: 700, maxZoom: 14 });
  }, [clearSelection, ensure]);

  const select = useCallback(async (key: LayerKey, props: Props, coords: LngLat, fly = false, openInspect = true) => {
    const map = mapRef.current;
    if (!map) return;
    clearHighlight();
    setPattern(null);
    setSel({ key, props, coords });
    if (openInspect) setTab('inspect');
    (map.getSource('sel') as GeoJSONSource).setData({ type: 'Feature', geometry: { type: 'Point', coordinates: coords }, properties: {} } as any);
    if (fly) map.flyTo({ center: coords, zoom: Math.max(map.getZoom(), 15.5), duration: 800 });

    const isDevice = key === 'fuses' || key === 'switches' || key === 'reclosers';
    const xfLoc = key === 'customers' ? props.xf : key === 'transformers' ? props.loc : undefined;
    const r: Rel = { title: TITLE[key](props), chain: [], downstreamXf: 0, downstreamCust: 0, onPole: [], circuit: props.circuit };
    let xfs: string[] = [];
    let chain: ChainItem[] = [];
    let startLoc: string | undefined;

    if (xfLoc) {
      xfs = [xfLoc];
      chain = chainFor(xfLoc);
      startLoc = xfLoc;
      r.xf = store.xf.get(xfLoc)?.props;
      r.pattern = store.topology?.xfPattern[xfLoc];
    } else if (isDevice) {
      xfs = store.downstream.get(props.loc) ?? [];
      const sample = xfs[0] ? chainFor(xfs[0]) : [];
      const at = sample.findIndex(c => c.loc === props.loc);
      chain = at >= 0 ? sample.slice(at + 1) : [];
      startLoc = props.loc;
    } else if (key === 'poles') {
      for (const x of store.xf.values()) if (x.loc === props.loc) r.onPole.push({ label: `Transformer ${x.props.kva ?? ''}`, key: 'transformers', props: x.props, coords: x.coords });
      for (const d of store.devByLoc.get(props.loc) ?? []) r.onPole.push({ label: d.props.dev ?? d.props.kind, key: d.layer, props: d.props, coords: d.coords });
    }
    r.chain = chain;
    r.downstreamXf = isDevice ? xfs.length : 0;
    r.downstreamCust = isDevice ? xfs.reduce((n, x) => n + (store.xf.get(x)?.cust ?? 0), 0) : 0;
    if (key === 'arcos' && props.openM === 'breaker') r.isolation = { breaker: true, circuit: props.openC, customers: props.openN ?? 0 };
    if (key === 'arcos' && props.open) {
      const dev = (store.devByLoc.get(props.open) ?? []).find(d => d.layer === props.openL);
      r.isolation = { loc: props.open, layer: props.openL, type: props.openT, customers: props.openN, transformers: props.openX, method: props.openM, approx: !!props.openA, coords: dev?.coords };
      if (dev) {
        (map.getSource('openpt') as GeoJSONSource).setData({ type: 'Feature', geometry: { type: 'Point', coordinates: dev.coords }, properties: {} } as any);
        (map.getSource('chain') as GeoJSONSource).setData({ type: 'Feature', geometry: { type: 'LineString', coordinates: [coords, dev.coords] }, properties: {} } as any);
        const b = new maplibregl.LngLatBounds(coords, coords).extend(dev.coords);
        map.fitBounds(b, { padding: { top: 90, bottom: 90, left: 90, right: 90 }, maxZoom: 16, duration: 700 });
      }
      xfs = store.openDown[props.open] ?? [];
    }
    setRel(r);

    if (!xfs.length) return;
    // premises, secondary network and transformers served through this asset
    if (!visibleRef.current.secondary) show('secondary', true);
    if (!visibleRef.current.customers) show('customers', true);
    const groups = [...new Set(xfs.map(x => store.xf.get(x)?.g).filter((g): g is number => g !== undefined))];
    map.setFilter('sec-hl', emptyIn('g', groups));
    map.setFilter('sec-hl-glow', emptyIn('g', groups));
    map.setFilter('cust-hl', emptyIn('xf', xfs));
    map.setFilter('tx-hl', emptyIn('loc', xfs));

    // upstream protection chain: dashed logical path + numbered stops, plus primary-conductor route
    const stops = chain.filter(c => c.coords) as (ChainItem & { coords: LngLat })[];
    const line: LngLat[] = [coords, ...stops.map(s => s.coords)];
    if (line.length > 1) (map.getSource('chain') as GeoJSONSource).setData({ type: 'Feature', geometry: { type: 'LineString', coordinates: line }, properties: {} } as any);
    stops.forEach((s, i) => {
      const dot = document.createElement('div');
      dot.className = `chain-marker ${s.code}`;
      dot.title = `${s.label} ${s.loc}`;
      dot.textContent = String(i + 1);
      dot.title = `${s.label} ${s.loc}`;
      dot.onclick = e => { e.stopPropagation(); if (s.dev) void select(s.dev.layer, s.dev.props, s.dev.coords, true); else map.flyTo({ center: s.coords, zoom: Math.max(map.getZoom(), 15.5) }); };
      markers.current.push(new maplibregl.Marker({ element: dot }).setLngLat(s.coords).addTo(map));
    });
    await ensure('primary');
    const nodes = [startLoc, ...chain.filter(c => c.code !== 'B').map(c => c.loc)].filter(Boolean) as string[];
    const ids = new Set<number>();
    for (let i = 0; i + 1 < nodes.length; i++) primaryPath(nodes[i]!, nodes[i + 1]!)?.forEach(s => ids.add(s));
    map.setFilter('pri-hl', emptyIn('i', [...ids]));
    map.setFilter('pri-hl-glow', emptyIn('i', [...ids]));
  }, [clearHighlight, ensure, show]);

  // ---- click-to-select
  const selectRef = useRef(select);
  selectRef.current = select;
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const onClick = (e: maplibregl.MapMouseEvent) => {
      const pad = 6;
      const box: [[number, number], [number, number]] = [[e.point.x - pad, e.point.y - pad], [e.point.x + pad, e.point.y + pad]];
      const active = INTERACTIVE.filter(([id]) => map.getLayer(id) && map.getLayoutProperty(id, 'visibility') !== 'none');
      const hits = map.queryRenderedFeatures(box, { layers: active.map(([id]) => id) });
      for (const [id, key] of active) {
        const f = hits.find(h => h.layer.id === id);
        if (!f) continue;
        const g = f.geometry as any;
        const coords: LngLat = g.type === 'Point' ? g.coordinates : [e.lngLat.lng, e.lngLat.lat];
        void selectRef.current(key, f.properties as Props, coords);
        return;
      }
      clearSelection();
    };
    map.on('click', onClick);
    return () => { map.off('click', onClick); };
  }, [ready, clearSelection]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') clearSelection(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [clearSelection]);

  // Debug: resolve a selected premise to its street address. One lookup per click; the address list never reaches the browser.
  useEffect(() => {
    if (!debugAddresses || sel?.key !== 'customers' || !sel.props.pid) { setAddress({ state: 'idle' }); return; }
    const ctl = new AbortController();
    setAddress({ state: 'loading' });
    fetch(`/api/premises/${encodeURIComponent(sel.props.pid)}`, { signal: ctl.signal })
      .then(r => (r.ok ? r.json() : Promise.reject(r.status)))
      .then(d => setAddress({ state: 'ok', address: d.address, locationId: d.locationId }))
      .catch(e => { if (e?.name !== 'AbortError') setAddress({ state: 'error' }); });
    return () => ctl.abort();
  }, [debugAddresses, sel]);

  const fieldList = sel ? store.manifest[sel.key]?.fields ?? [] : [];

function formatToSevenDigits(value: string): string {
  const match = value.match(/\d+/);
  const padded = match ? match[0].padStart(7, "0") : "0000000";
  //console.log("returning:", padded);
  return padded;
}

  return (
    <div className="mp">
      <aside className="mp-side">
        <header className="mp-head">
          <div className="mp-brand"><span className="mp-bolt">⚡</span> GridGuide <span className="mp-sub">Network map</span></div>
          <nav className="mp-tabs" role="tablist">
            {(['layers', 'inspect', 'issues', 'data'] as Tab[]).map(t => (
              <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>
                {t === 'layers' ? 'Layers' : t === 'inspect' ? `Inspect${sel ? ' •' : ''}` : t === 'issues' ? 'Issues' : 'Data'}
              </button>
            ))}
          </nav>
        </header>

        {tab === 'layers' && (
          <div className="mp-body">
            <section className="mp-card">
              <h3>Basemap</h3>
              <div className="mp-seg">
                {(Object.keys(BASEMAPS) as Basemap[]).map(b => <button key={b} className={basemap === b ? 'on' : ''} onClick={() => setBasemap(b)}>{BASEMAPS[b].label}</button>)}
              </div>
            </section>

            {GROUPS.map(group => (
              <section className="mp-card" key={group}>
                <div className="mp-group-head">
                  <h3>{group}</h3>
                  <button onClick={() => { KEYS.filter(k => store.manifest[k]?.group === group).forEach(k => show(k, true)); if (group === 'Impact') setArcosOff(new Set()); setFOff(prev => Object.fromEntries(Object.entries(prev).filter(([key]) => store.manifest[key.split('.')[0]!]?.group !== group))); }}>Select all</button>
                  <button onClick={() => KEYS.filter(k => store.manifest[k]?.group === group).forEach(k => show(k, false))}>Clear</button>
                </div>
                {KEYS.filter(k => store.manifest[k]?.group === group).map(k => {
                  const m = store.manifest[k]!;
                  const min = MIN_ZOOM[k];
                  const hidden = min !== undefined && visible[k] && zoom < min;
                  return (
                    <div className="mp-layer" key={k}>
                      <label>
                        <input type="checkbox" checked={!!visible[k]} onChange={e => show(k, e.target.checked)} />
                        <Swatch k={k} />
                        <span className="mp-name">{m.label}</span>
                        <span className="mp-count">{status[k] === 'loading' ? 'loading…' : status[k] === 'error' ? 'failed' : m.count.toLocaleString()}</span>
                      </label>
                      {hidden && <div className="mp-hint">Zoom in to level {min} to see this layer (now {zoom.toFixed(1)})</div>}
                      {k === 'customers' && visible[k] && <div className="mp-hint">{debugAddresses ? 'Debug on: selecting a premise also shows its address.' : 'Anonymized: no names, addresses or account numbers — pseudo ids only.'}</div>}
                      {k === 'primary' && visible[k] && <div className="mp-hint">Dashed = underground. Color and width grow with phase count: <i className="ln" style={{ background: PHASE_COLORS[1] }} /> 1 <i className="ln" style={{ background: PHASE_COLORS[2] }} /> 2 <i className="ln" style={{ background: PHASE_COLORS[3] }} /> 3 phases.</div>}
                      {visible[k] && FILTERS[k] && <LayerFilters layer={k} fOff={fOff} setFOff={setFOff} locate={FACILITY_KEYS.includes(k) ? (name: string) => { const f = store.facilities[k]?.get(name); if (f) mapRef.current?.flyTo({ center: f.coords, zoom: 15, duration: 800 }); } : undefined} />}
                      {k === 'arcos' && visible[k] && <div className="mp-hint"><i className="sw sw-dot" style={{ background: '#dc2626' }} /> Click a report to see where to open the circuit (fewest customers off).</div>}
                      {k === 'arcos' && visible[k] && <ArcosFilter off={arcosOff} setOff={setArcosOff} />}
                      {k === 'secondary' && visible[k] && <div className="mp-hint"><i className="ln" style={{ background: SECONDARY_COLOR }} /> secondary &nbsp; <i className="ln" style={{ background: SERVICE_COLOR }} /> service drop to premise</div>}
                    </div>
                  );
                })}
              </section>
            ))}

            <section className="mp-card">
              <h3>Debug</h3>
              <label className="mp-arcos-sub" style={{ paddingLeft: 0 }}>
                <input type="checkbox" checked={debugAddresses} onChange={e => { setDebugAddresses(e.target.checked); try { localStorage.setItem('gridguide.map.debug.addresses', e.target.checked ? '1' : '0'); } catch { /* storage unavailable */ } }} />
                <span className="mp-name">Show premise addresses</span>
              </label>
              <div className="mp-hint">When on, selecting a premise looks up its street address from the server. Off by default: premises are otherwise anonymous.</div>
            </section>

            <section className="mp-card">
              <h3>Select circuit</h3>
              <select value={circuit} onChange={e => setCircuit(e.target.value)} aria-label="Highlight a circuit">
                <option value="">None</option>
                {circuits.map(c => <option key={c} value={c}>Circuit {c}</option>)}
              </select>
              <div className="mp-hint">Halos every primary segment on the circuit and zooms to it.</div>
            </section>

            <EquipmentOrder pattern={pattern} all={allPatterns} setAll={setAllPatterns} onPattern={i => void showPattern(i)} />
          </div>
        )}

        {tab === 'inspect' && (
          <div className="mp-body">
            {!sel && <div className="mp-card mp-empty">Click any feature on the map to inspect its attributes and see what it is connected to. <kbd>Esc</kbd> clears the selection.</div>}
            {sel && rel && (
              <>
                <section className="mp-card">
                  <div className="mp-title"><Swatch k={sel.key} /> <h2>{rel.title}</h2></div>
                  <div className="mp-hint">{store.manifest[sel.key]?.label} · {store.manifest[sel.key]?.source}</div>
                  <div className="mp-actions">
                    <button onClick={() => mapRef.current?.flyTo({ center: sel.coords, zoom: Math.max(mapRef.current.getZoom(), 16), duration: 700 })}>Zoom to</button>
                    {rel.circuit && <button onClick={() => { setCircuit(formatToSevenDigits(rel.circuit!)); }}>Show circuit {rel.circuit}</button>}
                    <button onClick={clearSelection}>Clear</button>
                  </div>
                </section>

                {sel.key === 'arcos' && rel.isolation && <IsolationCard iso={rel.isolation} onZoom={c => mapRef.current?.flyTo({ center: c, zoom: 16.5, duration: 700 })} onSelect={(layer, loc) => { const d = (store.devByLoc.get(loc) ?? []).find(x => x.layer === layer); if (d) void select(d.layer, d.props, d.coords, true); }} />}

                <section className="mp-card">
                  <h3>Connections</h3>
                  {rel.xf && sel.key === 'customers' && (
                    <Row label="Served by transformer">
                      <button className="mp-link" onClick={() => { const x = store.xf.get(rel.xf!.loc); if (x) void select('transformers', x.props, x.coords, true); }}>
                        {rel.xf.kva ?? 'Transformer'} · {rel.xf.cust ?? '?'} customers
                      </button>
                    </Row>
                  )}
                  {sel.key === 'transformers' && <Row label="Premises served">{sel.props.cust ?? '?'}</Row>}
                  {(sel.key === 'fuses' || sel.key === 'switches' || sel.key === 'reclosers') && (
                    <Row label="Downstream">{rel.downstreamXf.toLocaleString()} transformers · ≈{rel.downstreamCust.toLocaleString()} premises{!rel.downstreamXf && ' (no matched transformers)'}</Row>
                  )}
                  {sel.key === 'poles' && (rel.onPole.length ? rel.onPole.map((o, i) => (
                    <Row key={i} label="On this pole"><button className="mp-link" onClick={() => void select(o.key, o.props, o.coords, true)}>{o.label}</button></Row>
                  )) : <Row label="On this pole">No transformer or protective device</Row>)}
                  {sel.key === 'primary' && <Row label="Conductor path">{sel.props.a ?? '?'} → {sel.props.b ?? '?'}</Row>}
                  {rel.chain.length > 0 && (
                    <>
                      <div className="mp-sub2">Upstream equipment, nearest the premise first</div>
                      {rel.pattern !== undefined && store.topology && (
                        <div className="mp-pattern-now">
                          <Seq seq={store.topology.patterns[rel.pattern]!.seq} />
                          <button className="mp-link" onClick={() => void showPattern(rel.pattern!)}>
                            {store.topology.patterns[rel.pattern]!.transformers.toLocaleString()} transformers share this order
                          </button>
                        </div>
                      )}
                      <ol className="mp-chain">
                        {rel.chain.map((c, i) => {
                          const n = rel.chain.filter(x => x.coords).indexOf(c) + 1;
                          return (
                            <li key={i}>
                              <span className={`chain-marker static ${c.code}`}>{c.code === 'B' ? '★' : n || '·'}</span>
                              <div>
                                {c.dev ? (
                                  <button className="mp-link" onClick={() => void select(c.dev!.layer, c.dev!.props, c.dev!.coords, true)}>{c.label}</button>
                                ) : c.code === 'B' ? (
                                  <button className="mp-link" onClick={() => setCircuit(c.loc)}>{c.label} · circuit {c.loc}</button>
                                ) : c.coords ? (
                                  <button className="mp-link" onClick={() => mapRef.current?.flyTo({ center: c.coords!, zoom: 16, duration: 700 })}>{c.label}</button>
                                ) : <span>{c.label}</span>}
                                <small>step {i + 1} of {rel.chain.length}{c.dev ? ` · ${c.dev.props.state ?? ''} · ${c.dev.props.cust ?? '?'} cust.` : ''}{c.code !== 'B' ? ` · ${c.loc}` : ''}{c.id ? ` · obj ${c.id}` : ''}</small>
                              </div>
                            </li>
                          );
                        })}
                      </ol>
                      <div className="mp-hint">White dashed line links the stops in order; highlighted primary conductor shows the shortest route through the network model.</div>
                    </>
                  )}
                  {!rel.chain.length && !rel.xf && sel.key !== 'arcos' && sel.key !== 'poles' && sel.key !== 'primary' && !['fuses', 'switches', 'reclosers'].includes(sel.key) && <div className="mp-hint">No electrical connections tracked for this layer.</div>}
                </section>

                <section className="mp-card">
                  <h3>Attributes</h3>
                  <table className="mp-attrs"><tbody>
                    {fieldList.filter(([k]) => sel.props[k] !== undefined && sel.props[k] !== null).map(([k, label]) => (
                      <tr key={k}><th>{label}</th><td>{k === 'life' ? 'Yes' : fmt(sel.props[k])}</td></tr>
                    ))}
                    {sel.key === 'customers' && debugAddresses && (
                      <>
                        <tr><th>Address<small>debug</small></th><td>{address.state === 'ok' ? address.address : address.state === 'error' ? 'Lookup unavailable (is the API server running?)' : 'Looking up…'}</td></tr>
                        {address.state === 'ok' && address.locationId && <tr><th>Location ID<small>debug</small></th><td>{address.locationId}</td></tr>}
                      </>
                    )}
                  </tbody></table>
                  {sel.key === 'arcos' && <ReportLaborCard props={sel.props} />}
                </section>
              </>
            )}
          </div>
        )}

        {/* kept mounted so the picked issues and the ranking survive clicking an issue or switching tabs */}
        <div style={{ display: tab === 'issues' ? 'contents' : 'none' }}>
          <IssuesPanel
            arcosOff={arcosOff}
            ready={version > 0}
            onFocus={i => { if (!visibleRef.current.arcos) show('arcos', true); void select('arcos', i.props, i.coords, true, false); }}
          />
        </div>

        {tab === 'data' && (
          <div className="mp-body" key={version}>
            <section className="mp-card">
              <h3>Combined sources</h3>
              <div className="mp-hint">Data1 + Data2 shapefiles merged by <code>scripts/build-gis.py</code>. Layers join on shared location ids (<code>location_n</code>, <code>aep_xfmr_l</code>) and the matched-upstream chain.</div>
            </section>
            {KEYS.map(k => {
              const m = store.manifest[k];
              if (!m) return null;
              const sum = store.summaries[k];
              return (
                <details className="mp-card" key={k}>
                  <summary><Swatch k={k} /> {m.label} <span className="mp-count">{m.count.toLocaleString()}</span></summary>
                  <div className="mp-hint">{m.source} · {m.geometry}s</div>
                  {!sum ? <div className="mp-hint">Enable the layer to load and summarize its attributes.</div> : (
                    <table className="mp-attrs"><tbody>
                      {m.fields.map(([f, label]) => {
                        const s = sum[f];
                        if (!s) return null;
                        return (
                          <tr key={f}>
                            <th>{label}<small>{f}</small></th>
                            <td>
                              {s.min !== undefined && s.distinct > 12 ? `${fmt(s.min)} – ${fmt(s.max!)}` : s.distinct > 12 ? `${s.distinct.toLocaleString()}+ distinct` : s.top.map(([v, n]) => `${v} (${n.toLocaleString()})`).join(', ')}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody></table>
                  )}
                </details>
              );
            })}
          </div>
        )}
      </aside>
      <div className="mp-map" ref={el} />
      {!ready && <div className="mp-loading">Loading map…</div>}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="mp-row"><span>{label}</span><div>{children}</div></div>;
}

const SWATCH: Record<LayerKey, { c: string; shape: string }> = {
  primary: { c: PHASE_COLORS[3]!, shape: 'line' }, secondary: { c: SECONDARY_COLOR, shape: 'line' }, customers: { c: CUSTOMER_COLOR, shape: 'dot' }, poles: { c: POLE_COLOR, shape: 'dot' },
  transformers: { c: ICON_COLORS.transformer, shape: 'sq' }, fuses: { c: ICON_COLORS.fuse, shape: 'tri' }, switches: { c: ICON_COLORS.switchClosed, shape: 'dia' },
  reclosers: { c: ICON_COLORS.recloser, shape: 'hex' }, arcos: { c: ICON_COLORS.arcos, shape: 'tri' }, hospitals: { c: ICON_COLORS.hospital, shape: 'sq' },
  fire: { c: ICON_COLORS.fire, shape: 'sq' }, ambulance: { c: ICON_COLORS.ambulance, shape: 'sq' },
};

function Swatch({ k }: { k: LayerKey }) {
  const s = SWATCH[k];
  return <i className={`sw sw-${s.shape}`} style={{ background: s.c }} aria-hidden />;
}

const CODE_COLOR: Record<string, string> = { X: '#c084fc', T: '#c084fc', F: '#f8fafc', H: '#60a5fa', E: '#3b82f6', Z: '#2dd4bf', B: '#facc15', '?': '#94a3b8' };

function Seq({ seq }: { seq: string }) {
  return (
    <span className="mp-seq">
      {seq.split('>').map((c, i) => (
        <React.Fragment key={i}>
          {i > 0 && <span className="mp-arrow">›</span>}
          <span className="mp-chip" style={{ borderColor: CODE_COLOR[c] }} title={CHAIN_LABEL[c]}>{CHAIN_SHORT[c] ?? c}</span>
        </React.Fragment>
      ))}
    </span>
  );
}

/** Replaces the old hard-coded explainer: equipment classes and orderings measured from matched_upstream.txt. */
function EquipmentOrder({ pattern, all, setAll, onPattern }: { pattern: number | null; all: boolean; setAll: (v: boolean) => void; onPattern: (i: number | null) => void }) {
  const t = store.topology;
  if (!t) return <section className="mp-card"><h3>Equipment order</h3><div className="mp-hint">Loading…</div></section>;
  const patterns = t.patterns.map((p, i) => ({ ...p, i }));
  const shown = all ? patterns : patterns.slice(0, 8);
  return (
    <section className="mp-card mp-flow">
      <h3>Equipment order</h3>
      <div className="mp-hint">Measured from the upstream paths of {t.premises.toLocaleString()} premises (matched_upstream.txt), premise side first.</div>
      <ol className="mp-stages">
        <li><span className="mp-chip" style={{ borderColor: '#86efac' }}>Premise</span><small>served by a distribution transformer via service drop and secondary</small></li>
        {t.stages.map(s => (
          <li key={s.code}>
            <span className="mp-chip" style={{ borderColor: CODE_COLOR[s.code] }}>{CHAIN_SHORT[s.code] ?? s.code}</span>
            <div>
              <span>{CHAIN_LABEL[s.code] ?? s.code}</span>
              <small>on {s.paths >= 0.995 ? 'all' : `${(s.paths * 100).toFixed(s.paths < 0.01 ? 1 : 0)}%`} of paths{s.perPath > 1.05 ? ` · avg ${s.perPath.toFixed(1)} in series` : ''}{s.mapped !== null ? ` · ${(s.mapped * 100).toFixed(s.mapped < 0.995 ? 1 : 0)}% placed on map` : ''}</small>
            </div>
          </li>
        ))}
      </ol>
      <div className="mp-sub2">Most common orderings — click to highlight their transformers</div>
      <ul className="mp-patterns">
        {shown.map(p => (
          <li key={p.i}>
            <button className={pattern === p.i ? 'on' : ''} onClick={() => onPattern(pattern === p.i ? null : p.i)}>
              <Seq seq={p.seq} />
              <small>{p.transformers.toLocaleString()} xfmrs · {p.premises.toLocaleString()} premises</small>
            </button>
          </li>
        ))}
      </ul>
      <button className="mp-link" onClick={() => setAll(!all)}>{all ? 'Show fewer' : `Show all ${patterns.length} orderings`}</button>
    </section>
  );
}

const arcosKey = (cat: string, asset: string) => `${cat}|${asset}`;

/** Damage-type filter for ARCOS reports: one group per damage category, with its asset types beneath. */
function ArcosFilter({ off, setOff }: { off: Set<string>; setOff: (s: Set<string>) => void }) {
  const cats = [...store.arcos].map(([cat, assets]) => ({ cat, assets: [...assets].map(([a, c]) => [a, c.n] as [string, number]).sort((a, b) => b[1] - a[1]), total: [...assets.values()].reduce((a, c) => a + c.n, 0) })).sort((a, b) => b.total - a.total);
  if (!cats.length) return <div className="mp-hint">Loading report types…</div>;
  const all = cats.flatMap(c => c.assets.map(([a]) => arcosKey(c.cat, a)));
  const set = (keys: string[], on: boolean) => { const n = new Set(off); keys.forEach(k => (on ? n.delete(k) : n.add(k))); setOff(n); };
  const shown = all.filter(k => !off.has(k)).length;
  return (
    <div className="mp-arcos">
      <div className="mp-arcos-top">
        <span>{shown} of {all.length} types shown</span>
        <button onClick={() => set(all, true)}>Select all</button>
        <button onClick={() => set(all, false)}>Clear</button>
      </div>
      {cats.map(({ cat, assets, total }) => {
        const keys = assets.map(([a]) => arcosKey(cat, a));
        const on = keys.filter(k => !off.has(k)).length;
        return (
          <div className="mp-arcos-cat" key={cat}>
            <div className="mp-arcos-head">
              <label>
                <input type="checkbox" checked={on === keys.length} ref={el => { if (el) el.indeterminate = on > 0 && on < keys.length; }} onChange={e => set(keys, e.target.checked)} />
                <span className="mp-name">{cat.replace('Damaged ', '')}</span>
                <span className="mp-count">{total.toLocaleString()}</span>
              </label>
              <button onClick={() => set(keys, true)} disabled={on === keys.length}>Select all</button>
            </div>
            {assets.length > 1 || assets[0]![0] !== cat.replace('Damaged ', '') ? assets.map(([asset, n]) => (
              <label className="mp-arcos-sub" key={asset}>
                <input type="checkbox" checked={!off.has(arcosKey(cat, asset))} onChange={e => set([arcosKey(cat, asset)], e.target.checked)} />
                <span className="mp-name">{asset}</span>
                <span className="mp-count">{n.toLocaleString()}</span>
              </label>
            )) : null}
          </div>
        );
      })}
    </div>
  );
}

/** Per-report labor: remove + install of the matched compatible units, times the indirect labor multiplier. */
function ReportLaborCard({ props }: { props: Props }) {
  const l = reportLabor(props);
  return (
    <div className="mp-labor">
      {l ? (
        <>
          <div className="mp-labor-total"><b>{l.person.toLocaleString(undefined, { maximumFractionDigits: 1 })}</b> person-hours <small>{l.work}</small></div>
          <div className="mp-hint">{l.direct.toFixed(2)} direct hours (remove + install) × {INDIRECT_LABOR_MULTIPLIER} indirect multiplier for travel, safety and set-up. Size-dependent units use the size-group average; access and site adders are not applied.</div>
        </>
      ) : <div className="mp-hint">No person-hour estimate: no labor unit matches {props.damage ?? 'this damage'} on {props.asset ?? 'an unknown asset'}.</div>}
    </div>
  );
}

const FACILITY_KEYS: LayerKey[] = ['hospitals', 'fire', 'ambulance'];

/** Attribute filters for one layer: a checkbox per value (with counts) and Select all / Clear per attribute. */
function LayerFilters({ layer, fOff, setFOff, locate }: { layer: LayerKey; fOff: Record<string, string[]>; setFOff: React.Dispatch<React.SetStateAction<Record<string, string[]>>>; locate?: (value: string) => void }) {
  const summary = store.summaries[layer];
  const fields = (FILTERS[layer] ?? []).filter(f => {
    const s = summary?.[f.prop];
    if (!s?.all) return false;
    const n = s.all.length + (s.missing ? 1 : 0);
    return n <= (f.max ?? 16) && (n > 1 || f.prop === 'name');
  });
  if (!summary) return <div className="mp-hint">Loading attributes…</div>;
  if (!fields.length) return null;
  const active = fields.filter(f => fOff[`${layer}.${f.prop}`]?.length).length;
  return (
    <details className="mp-filters">
      <summary>Filters{active ? ` · ${active} active` : ''}</summary>
      {fields.map(f => <FieldFilter key={f.prop} layer={layer} field={f} fOff={fOff} setFOff={setFOff} locate={f.prop === 'name' ? locate : undefined} />)}
    </details>
  );
}

function FieldFilter({ layer, field, fOff, setFOff, locate }: { layer: LayerKey; field: FilterField; fOff: Record<string, string[]>; setFOff: React.Dispatch<React.SetStateAction<Record<string, string[]>>>; locate?: (value: string) => void }) {
  const s = store.summaries[layer]![field.prop]!;
  const key = `${layer}.${field.prop}`;
  const off = new Set(fOff[key] ?? []);
  const values: [string, number][] = [...s.all!];
  if (s.missing) values.push([field.missing ?? 'Unknown', s.missing]);
  const label = (v: string) => (field.format ? field.format(v) : v);
  const set = (vals: string[], on: boolean) => { const n = new Set(off); vals.forEach(v => (on ? n.delete(v) : n.add(v))); setFOff(prev => ({ ...prev, [key]: [...n] })); };
  const all = values.map(([v]) => v);
  const shown = all.filter(v => !off.has(v)).length;
  return (
    <div className="mp-field">
      <div className="mp-arcos-top">
        <span>{field.label} <small>{shown}/{all.length}</small></span>
        <button onClick={() => set(all, true)} disabled={!off.size}>Select all</button>
        <button onClick={() => set(all, false)} disabled={shown === 0}>Clear</button>
      </div>
      {values.map(([v, n]) => (
        <label className="mp-arcos-sub" key={v}>
          <input type="checkbox" checked={!off.has(v)} onChange={e => set([v], e.target.checked)} />
          <span className="mp-name">{label(v)}</span>
          {locate && <button className="mp-locate" title="Zoom to" onClick={e => { e.preventDefault(); locate(v); }}>⌖</button>}
          <span className="mp-count">{n.toLocaleString()}</span>
        </label>
      ))}
    </div>
  );
}

type Isolation = NonNullable<Rel['isolation']>;

/** Where to open the circuit so the fewest customers lose power while crews repair a damage report. */
function IsolationCard({ iso, onZoom, onSelect }: { iso: Isolation; onZoom: (c: LngLat) => void; onSelect: (layer: LayerKey, loc: string) => void }) {
  if ('breaker' in iso) {
    return (
      <section className="mp-card mp-iso">
        <h3>Isolation plan</h3>
        <div className="mp-labor-total"><b>Substation breaker</b><small>circuit {iso.circuit} · {iso.customers.toLocaleString()} customers</small></div>
        <div className="mp-hint">No fuse, recloser or closed switch sits between this damage and the substation in the matched network data, so the only way to de-energize it is the circuit breaker. That drops every customer on the circuit.</div>
      </section>
    );
  }
  const how = { segment: 'the device that feeds the damaged conductor segment', node: 'the device feeding the line at this structure', transformer: 'the first device upstream of the transformer serving it' }[iso.method] ?? '';
  return (
    <section className="mp-card mp-iso">
      <h3>Isolation plan</h3>
      <div className="mp-labor-total"><b>Open {iso.type?.toLowerCase() ?? 'device'}</b><small>{iso.loc}</small></div>
      <div className="mp-row"><span>Customers de-energized</span><div>{iso.customers.toLocaleString()} on {iso.transformers.toLocaleString()} transformer{iso.transformers === 1 ? '' : 's'}</div></div>
      <div className="mp-actions">
        {iso.coords && <button onClick={() => onZoom(iso.coords!)}>Zoom to open point</button>}
        <button onClick={() => onSelect(iso.layer, iso.loc)}>Inspect device</button>
      </div>
      <div className="mp-hint">The red <b>⛔</b> marks it on the map; highlighted transformers and premises lose power. Chosen as {how}: the nearest openable device upstream, which de-energizes the fewest customers of all devices that isolate the damage.{iso.approx ? ' Approximate: the damage is off the traced network, so the nearest protected line was used.' : ''} Assumes no back-feed from a tie; normally-open devices are not counted.</div>
    </section>
  );
}
