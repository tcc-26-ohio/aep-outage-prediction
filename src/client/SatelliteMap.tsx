import React, { useEffect, useRef } from 'react';
import * as maplibregl from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import 'maplibre-gl/dist/maplibre-gl.css';

maplibregl.setWorkerUrl(workerUrl);

// Plain satellite imagery: no network, circuit or outage layers.
const OVERVIEW = { center: [-79.96, 37.22] as [number, number], zoom: 9.6 };
const SATELLITE = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';

export interface MapTarget { coords: [number, number]; address: string }
export interface MapRisk {
  level: 'none' | 'low' | 'moderate' | 'high' | 'severe';
  score: number;
  confidence: 'high' | 'medium' | 'low';
  factors: Record<'poleAge' | 'roads' | 'escalation' | 'nearby', { label: string; points: number }>;
  notes: string[];
}
export interface MapOutage { coords: [number, number]; label: string; repaired: boolean }

const km = (a: [number, number], b: [number, number]) => Math.hypot((a[0] - b[0]) * 88.8, (a[1] - b[1]) * 110.54);

/** Satellite backdrop that flies in to the customer's address once they have chosen it, and back out if they change it. */
export function SatelliteMap({ target, outages, risk }: { target: MapTarget | null; outages: MapOutage[]; risk: MapRisk | null }) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const marker = useRef<maplibregl.Marker | null>(null);
  const pending = useRef<MapTarget | null>(target);
  const ready = useRef(false);
  const outageMarkers = useRef<maplibregl.Marker[]>([]);
  const outageRef = useRef<MapOutage[]>(outages);
  outageRef.current = outages;
  const targetRef = useRef<MapTarget | null>(target);
  targetRef.current = target;

  const fly = (t: MapTarget | null) => {
    const m = map.current;
    if (!m) return;
    marker.current?.remove();
    marker.current = null;
    clearOutages();
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!t) {
      m.flyTo({ ...OVERVIEW, pitch: 0, bearing: 0, duration: reduce ? 0 : 2600, essential: true });
      return;
    }
    m.flyTo({ center: t.coords, zoom: 18.2, pitch: 0, speed: 0.8, curve: 1.7, essential: !reduce, duration: reduce ? 0 : undefined });
    m.once('moveend', () => {
      const pin = document.createElement('div');
      pin.className = 'cl-pin';
      pin.innerHTML = '<i></i><span></span>';
      pin.title = t.address;
      marker.current = new maplibregl.Marker({ element: pin }).setLngLat(t.coords).addTo(m);
      showOutages();
    });
  };

  function clearOutages() { outageMarkers.current.forEach(x => x.remove()); outageMarkers.current = []; }

  /** Put the outage(s) on the map, then zoom out until the house and every outage are in view. */
  function showOutages() {
    const m = map.current, t = targetRef.current, list = outageRef.current;
    clearOutages();
    if (!m || !t || !list.length) return;
    const bounds = new maplibregl.LngLatBounds(t.coords, t.coords);
    for (const o of list) {
      const el = document.createElement('div');
      el.className = `cl-outage${o.repaired ? ' repaired' : ''}`;
      el.innerHTML = '<span></span><b>!</b>';
      el.title = o.label;
      outageMarkers.current.push(new maplibregl.Marker({ element: el }).setLngLat(o.coords).addTo(m));
      bounds.extend(o.coords);
    }
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    m.fitBounds(bounds, { padding: { top: 90, bottom: 110, left: 90, right: 90 }, maxZoom: 17, duration: reduce ? 0 : 2200, essential: !reduce });
  }

  useEffect(() => {
    const m = new maplibregl.Map({
      container: el.current!,
      style: {
        version: 8,
        sources: { sat: { type: 'raster', tiles: [SATELLITE], tileSize: 256, maxzoom: 19, attribution: 'Imagery © Esri, Maxar, Earthstar Geographics' } },
        layers: [{ id: 'sat', type: 'raster', source: 'sat' }],
      },
      ...OVERVIEW,
      // zoom and pan only: no rotating or tilting the imagery
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
      maxZoom: 19,
      attributionControl: { compact: true },
    });
    m.touchZoomRotate.disableRotation();
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    map.current = m;
    m.on('load', () => { ready.current = true; if (pending.current) fly(pending.current); });
    return () => { m.remove(); map.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    pending.current = target;
    if (ready.current) fly(target);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target?.coords[0], target?.coords[1]]);

  // outages arriving (or changing) after the house is already in view
  const outageKey = outages.map(o => o.coords.join(',')).join('|');
  useEffect(() => {
    const m = map.current;
    if (!m || !ready.current || !targetRef.current) return;
    if (m.isMoving()) m.once('moveend', showOutages); else showOutages();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outageKey]);

  const nearest = target && outages.length ? Math.min(...outages.map(o => km(target.coords, o.coords))) : null;

  return (
    <div className="cl-map">
      <div ref={el} className="cl-map-canvas" />
      <div className={`cl-map-label${target ? ' on' : ''}`} aria-live="polite">
        {target ? target.address : ''}
        {nearest !== null && <span className="cl-map-out"><i /> {outages.length === 1 ? 'Outage' : `${outages.length} outages`} {nearest < 1 ? `${Math.round(nearest * 1000)} m` : `${nearest.toFixed(1)} km`} away</span>}
      </div>
      {target && risk && <RiskBand risk={risk} />}
    </div>
  );
}

const LEVELS = ['low', 'moderate', 'high', 'severe'] as const;
const LEVEL_LABEL = { none: 'No known outage', low: 'Low risk', moderate: 'Moderate risk', high: 'High risk', severe: 'Severe risk' } as const;

/** Color-coded risk band + confidence indicator along the bottom of the map. */
function RiskBand({ risk }: { risk: MapRisk }) {
  const lit = risk.level === 'none' ? 0 : LEVELS.indexOf(risk.level) + 1;
  const dots = risk.confidence === 'high' ? 3 : risk.confidence === 'medium' ? 2 : 1;
  return (
    <div className={`cl-risk lvl-${risk.level}`} role="status" aria-label={`${LEVEL_LABEL[risk.level]}, ${risk.confidence} confidence`}>
      <div className="cl-risk-main">
        <div className="cl-risk-head">
          <strong>{LEVEL_LABEL[risk.level]}</strong>
          <span className="cl-conf" title={risk.notes.join(' ') || 'Based on complete data for this address.'}>
            Confidence: {risk.confidence}
            <span className="cl-dots">{[0, 1, 2].map(i => <i key={i} className={i < dots ? 'on' : ''} />)}</span>
          </span>
        </div>
        <div className="cl-risk-bar" aria-hidden>
          {LEVELS.map((l, i) => <span key={l} className={`seg ${l}${i < lit ? ' on' : ''}${i === lit - 1 ? ' cur' : ''}`} />)}
        </div>
        <div className="cl-risk-labels" aria-hidden>{LEVELS.map(l => <span key={l}>{l}</span>)}</div>
      </div>
    </div>
  );
}
