import { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { PageProps } from "../outlookData";
import { createWindLayer } from "./windLayer";

type Grid = { mode: string; lats: number[]; lons: number[]; step: number; times: string[]; wind: (number | null)[][]; dir: (number | null)[][]; gust: (number | null)[][]; precip: (number | null)[][] };
type Station = { id: string; name: string; lat: number; lon: number; wind: number | null; gust: number | null; precip: number | null; temp: number | null; time: string; kind: string };
type Cell = { id: string; lat: number; lon: number; dir_from: number | null; speed_kt: number | null; dbz: number; hail_prob: number | null; tvs: string; meso: string; vil: number | null; radar: string; valid: string };
type Track = { id: string; name: string; points: [number, number, number | null, string][] };
type Active = { id: string; name: string; class: string; wind: number; lat: number; lon: number; dir: number | null; speed: number | null; advisory: string };
type Field = "gust" | "wind" | "precip";

const FIELDS: Record<Field, { label: string; unit: string; stops: number[] }> = {
  gust: { label: "Wind gust", unit: "mph", stops: [0, 15, 25, 35, 45, 55] },
  wind: { label: "Wind speed", unit: "mph", stops: [0, 8, 15, 22, 30, 40] },
  precip: { label: "Rain (hourly)", unit: "in", stops: [0, 0.01, 0.05, 0.1, 0.25, 0.5] },
};
const RAMP = ["#edf5ff", "#a6c8ff", "#4589ff", "#8a3ffc", "#d12771", "#a2191f"];
const rampFor = (value: number, stops: number[]) => RAMP[stops.reduce((best, stop, i) => value >= stop ? i : best, 0)]!;
const dbzColor = (dbz: number) => (dbz >= 60 ? "#8a1aa0" : dbz >= 50 ? "#e8261c" : dbz >= 45 ? "#f5a800" : "#f1e319");
const windCategory = (kt: number | null) => (kt === null ? ["#8d8d8d", "unknown"] : kt >= 137 ? ["#8a1aa0", "Cat 5"] : kt >= 113 ? ["#c4259b", "Cat 4"] : kt >= 96 ? ["#e8261c", "Cat 3"] : kt >= 83 ? ["#f56c1d", "Cat 2"] : kt >= 64 ? ["#f5a800", "Cat 1"] : kt >= 34 ? ["#f1e319", "Tropical storm"] : ["#78a9ff", "Depression"]) as [string, string];
const ET = "America/New_York";
const timeLabel = (iso: string) => new Date(iso).toLocaleString("en-US", { timeZone: ET, weekday: "short", month: "short", day: "numeric", hour: "numeric", timeZoneName: "short" });
const localDate = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: ET });
const shiftDays = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 864e5).toISOString().slice(0, 10);

const LAYER_DEFS = [
  { id: "field", label: "Weather field" }, { id: "stream", label: "Wind stream" }, { id: "stations", label: "Weather stations" },
  { id: "storms", label: "Storm tracks" }, { id: "tropical", label: "Tropical tracks" }, { id: "lightning", label: "Lightning" },
] as const;
type LayerId = (typeof LAYER_DEFS)[number]["id"];

function popup(title: string, lines: string[]) {
  const box = document.createElement("div");
  const strong = document.createElement("strong"); strong.textContent = title; box.append(strong);
  for (const line of lines) { const row = document.createElement("div"); row.textContent = line; box.append(row); }
  return box;
}

function useApi<T>(url: string | null) {
  const [state, setState] = useState<{ data: T | null; error: string; loading: boolean }>({ data: null, error: "", loading: false });
  useEffect(() => {
    if (!url) { setState({ data: null, error: "", loading: false }); return; }
    const controller = new AbortController();
    setState(current => ({ ...current, error: "", loading: true }));
    fetch(url, { signal: controller.signal })
      .then(async response => { if (!response.ok) throw new Error((await response.json().catch(() => null))?.detail ?? "Data unavailable."); return response.json(); })
      .then(data => setState({ data, error: "", loading: false }))
      .catch(error => { if (!controller.signal.aborted) setState({ data: null, error: error instanceof Error ? error.message : "Data unavailable.", loading: false }); });
    return () => controller.abort();
  }, [url]);
  return state;
}

function useDebounced<T>(value: T, ms: number) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => { const timer = setTimeout(() => setDebounced(value), ms); return () => clearTimeout(timer); }, [value, ms]);
  return debounced;
}

export function WeatherMap({ view }: PageProps) {
  const event = view.event;
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const wind = useRef<ReturnType<typeof createWindLayer> | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [source, setSource] = useState<"live" | "replay">("live");
  const [replayMode, setReplayMode] = useState<"observed" | "forecast">("observed");
  const [layers, setLayers] = useState<Record<LayerId, boolean>>({ field: true, stream: true, stations: true, storms: true, tropical: false, lightning: false });
  const [field, setField] = useState<Field>("gust");
  const [tIdx, setTIdx] = useState(0);
  const [playing, setPlaying] = useState(false);

  const replay = source === "replay" && !!event;
  const range = event ? { start: shiftDays(event.start, -1), end: shiftDays(event.end, 1) } : null;
  const gridUrl = replay && range ? `/api/weathermap/grid?mode=${replayMode}&start=${range.start}&end=${range.end}` : "/api/weathermap/grid?mode=live";
  const { data: grid, error: gridError, loading: gridLoading } = useApi<Grid>(gridUrl);

  const nowIdx = useMemo(() => {
    if (!grid || replay) return 0;
    const now = Date.now();
    return Math.max(0, grid.times.reduce((best, time, i) => Date.parse(time) <= now ? i : best, 0));
  }, [grid, replay]);

  // Choosing a storm replays it; going back to all history returns to live.
  useEffect(() => { setSource(event ? "replay" : "live"); }, [event?.id]);
  useEffect(() => { if (grid) setTIdx(replay ? Math.min(36, grid.times.length - 1) : nowIdx); }, [grid?.times[0], replay, nowIdx]);
  useEffect(() => {
    if (!playing || !grid) return;
    const timer = setInterval(() => setTIdx(i => (i + 1 >= grid.times.length ? (setPlaying(false), i) : i + 1)), 700);
    return () => clearInterval(timer);
  }, [playing, grid]);

  const time = grid?.times[tIdx];
  // Live stations, cells and lightning describe "right now", so they only apply while the slider sits on the current hour.
  const nowLayers = replay || tIdx === nowIdx;
  const debouncedTime = useDebounced(time, 350);
  const stationsUrl = layers.stations && nowLayers ? (replay && debouncedTime ? `/api/weathermap/stations?date=${localDate(debouncedTime)}` : replay ? null : "/api/weathermap/stations") : null;
  const stormsUrl = layers.storms && nowLayers ? (replay ? (debouncedTime ? `/api/weathermap/storms?time=${encodeURIComponent(debouncedTime)}` : null) : "/api/weathermap/storms") : null;
  const tropicalUrl = layers.tropical ? (replay && range ? `/api/weathermap/tropical?start=${range.start}&end=${range.end}` : "/api/weathermap/tropical") : null;
  const stations = useApi<{ stations: Station[] }>(stationsUrl);
  const storms = useApi<{ cells: Cell[] }>(stormsUrl);
  const tropical = useApi<{ tracks: Track[]; active: Active[] }>(tropicalUrl);

  useEffect(() => {
    if (!container.current) return;
    const instance = L.map(container.current, { zoomControl: false, zoomSnap: 0.25 }).setView([37.3, -80], 7);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors', maxZoom: 19, className: "basemap",
    }).addTo(instance);
    L.control.zoom({ position: "bottomright" }).addTo(instance);
    map.current = instance; setMapReady(true);
    return () => { wind.current?.remove(); wind.current = null; instance.remove(); map.current = null; };
  }, []);

  useEffect(() => {
    if (!map.current || !grid) return;
    map.current.fitBounds([[grid.lats[0]!, grid.lons[0]!], [grid.lats[grid.lats.length - 1]!, grid.lons[grid.lons.length - 1]!]], { padding: [10, 10] });
  }, [mapReady, grid?.lats.length, grid?.lons.length]);

  // Weather field
  useEffect(() => {
    const instance = map.current;
    if (!instance || !grid || !layers.field) return;
    const group = L.layerGroup().addTo(instance);
    const values = grid[field][tIdx] ?? [];
    const { stops } = FIELDS[field];
    const half = grid.step / 2;
    grid.lats.forEach((lat, y) => grid.lons.forEach((lon, x) => {
      const value = values[y * grid.lons.length + x];
      if (value === null || value === undefined) return;
      L.rectangle([[lat - half, lon - half], [lat + half, lon + half]], { stroke: false, fillColor: rampFor(value, stops), fillOpacity: value < stops[1]! ? 0.12 : 0.5, interactive: false }).addTo(group);
    }));
    return () => { group.remove(); };
  }, [grid, tIdx, field, layers.field, mapReady]);

  // Wind stream
  useEffect(() => {
    const instance = map.current;
    if (!instance || !layers.stream) return;
    const layer = createWindLayer(instance);
    wind.current = layer;
    return () => { layer.remove(); wind.current = null; };
  }, [layers.stream, mapReady]);
  useEffect(() => {
    if (!grid || !wind.current) return;
    const speed = grid.wind[tIdx] ?? [], dir = grid.dir[tIdx] ?? [];
    const u: number[] = [], v: number[] = [];
    speed.forEach((s, i) => {
      const radians = ((dir[i] ?? 0) * Math.PI) / 180; // meteorological: the direction the wind blows from
      u.push(s === null ? NaN : -s * Math.sin(radians)); v.push(s === null ? NaN : -s * Math.cos(radians));
    });
    wind.current.setField({ lats: grid.lats, lons: grid.lons, u, v });
  }, [grid, tIdx, layers.stream, mapReady]);

  // Stations
  useEffect(() => {
    const instance = map.current;
    if (!instance || !stations.data) return;
    const group = L.layerGroup().addTo(instance);
    for (const s of stations.data.stations) {
      const value = s.gust ?? s.wind ?? 0;
      L.circleMarker([s.lat, s.lon], { radius: 6, color: "#161616", weight: 1.5, fillColor: rampFor(value, FIELDS.gust.stops), fillOpacity: 0.95 })
        .bindTooltip(`${s.id} · ${s.gust ?? s.wind ?? "–"} mph`)
        .bindPopup(popup(`${s.name} (${s.id})`, [`${s.kind}: ${s.time}`, `Gust ${s.gust ?? "–"} mph · Wind ${s.wind ?? "–"} mph`, `Rain ${s.precip ?? "–"} in · Temp ${s.temp ?? "–"} °F`])).addTo(group);
    }
    return () => { group.remove(); };
  }, [stations.data, mapReady]);

  // Storm tracks: radar-detected cells with their motion projected one hour ahead
  useEffect(() => {
    const instance = map.current;
    if (!instance || !storms.data) return;
    const group = L.layerGroup().addTo(instance);
    for (const c of storms.data.cells) {
      const info = [`Radar ${c.radar} · ${c.dbz} dBZ`, `Moving ${c.speed_kt ?? 0} kt from ${c.dir_from ?? "–"}°`, `Hail probability ${c.hail_prob ?? 0}% · Rotation ${c.meso === "NONE" ? "none" : c.meso} · TVS ${c.tvs}`, c.valid];
      L.circleMarker([c.lat, c.lon], { radius: 4 + Math.max(0, c.dbz - 35) / 4, color: "#161616", weight: 1, fillColor: dbzColor(c.dbz), fillOpacity: 0.9 }).bindPopup(popup(`Storm cell ${c.id}`, info)).addTo(group);
      if (c.speed_kt && c.speed_kt >= 5 && c.dir_from !== null) {
        const bearing = ((c.dir_from + 180) % 360) * Math.PI / 180, miles = c.speed_kt / 60; // nautical miles in one hour, in degrees of latitude
        const end: [number, number] = [c.lat + miles * Math.cos(bearing), c.lon + miles * Math.sin(bearing) / Math.cos(c.lat * Math.PI / 180)];
        L.polyline([[c.lat, c.lon], end], { color: "#262626", weight: 2, dashArray: "4 3", interactive: false }).addTo(group);
        L.circleMarker(end, { radius: 2, color: "#262626", fillColor: "#262626", fillOpacity: 1, interactive: false }).addTo(group);
      }
    }
    return () => { group.remove(); };
  }, [storms.data, mapReady]);

  // Tropical tracks
  useEffect(() => {
    const instance = map.current;
    if (!instance || !tropical.data) return;
    const group = L.layerGroup().addTo(instance);
    for (const track of tropical.data.tracks) {
      L.polyline(track.points.map(p => [p[0], p[1]] as [number, number]), { color: "#525252", weight: 2, opacity: 0.8 }).addTo(group);
      track.points.forEach((p, i) => {
        const [color, category] = windCategory(p[2]);
        const marker = L.circleMarker([p[0], p[1]], { radius: 4, color: "#161616", weight: 1, fillColor: color, fillOpacity: 1 })
          .bindPopup(popup(`${track.name || "Unnamed"} · ${category}`, [`${p[2] ?? "–"} kt`, timeLabel(p[3])])).addTo(group);
        if (i === track.points.length - 1) marker.bindTooltip(track.name || "Unnamed", { permanent: true, direction: "right", className: "track-label" });
      });
    }
    for (const a of tropical.data.active) {
      const [color] = windCategory(a.wind);
      L.circleMarker([a.lat, a.lon], { radius: 9, color: "#161616", weight: 2, fillColor: color, fillOpacity: 1 })
        .bindPopup(popup(`${a.name} (active)`, [`${a.class} · ${a.wind} kt`, `Moving ${a.speed ?? "–"} kt toward ${a.dir ?? "–"}°`, a.advisory])).addTo(group);
    }
    return () => { group.remove(); };
  }, [tropical.data, mapReady]);

  // Lightning: strike density tiles straight from NOAA nowCOAST (latest 15 minutes)
  useEffect(() => {
    const instance = map.current;
    if (!instance || !layers.lightning || replay || !nowLayers) return;
    const layer = L.tileLayer.wms("https://nowcoast.noaa.gov/geoserver/lightning_detection/wms", {
      layers: "ldn_lightning_strike_density", format: "image/png", transparent: true, version: "1.3.0", opacity: 0.85, zIndex: 450,
      attribution: "Lightning: NOAA nowCOAST (NLDN, GLD360)", ...({ _t: Math.floor(Date.now() / 9e5) } as object),
    }).addTo(instance);
    return () => { layer.remove(); };
  }, [layers.lightning, replay, nowLayers, mapReady]);

  function zoomTo(points: [number, number][]) { if (points.length) map.current?.fitBounds(L.latLngBounds(points), { padding: [40, 40], maxZoom: 7 }); }
  const toggle = (id: LayerId) => setLayers(current => ({ ...current, [id]: !current[id] }));
  const disabled = (id: LayerId) => (id === "lightning" && (replay || !nowLayers)) || ((id === "stations" || id === "storms") && !nowLayers);
  const badge = !grid ? "" : replay ? (replayMode === "observed" ? "Observed" : "Forecast") : tIdx <= nowIdx ? "Observed" : "Forecast";
  const notes = [gridError && `Wind: ${gridError}`, stations.error && `Stations: ${stations.error}`, storms.error && `Storm tracks: ${storms.error}`, tropical.error && `Tropical: ${tropical.error}`].filter(Boolean) as string[];
  const spec = FIELDS[field];

  return <section className="card wxmap" aria-label="Forecast and observed weather map">
    <header className="panel-head">
      <h2>Forecast &amp; observed map</h2>
      <div className="head-actions">
        <div className="segmented" role="group" aria-label="Time source">
          <button aria-pressed={source === "live"} onClick={() => setSource("live")}>Live</button>
          <button aria-pressed={source === "replay"} disabled={!event} title={event ? "" : "Choose a storm in Time window to replay it"} onClick={() => setSource("replay")}>{event ? `Replay ${view.label}` : "Replay (choose a storm)"}</button>
        </div>
        {replay && <div className="segmented" role="group" aria-label="Replay data">
          <button aria-pressed={replayMode === "observed"} onClick={() => setReplayMode("observed")}>Observed</button>
          <button aria-pressed={replayMode === "forecast"} onClick={() => setReplayMode("forecast")}>Forecast</button>
        </div>}
      </div>
    </header>
    <div className="wxmap-body">
      <div className="map-wrap">
        <div ref={container} className="map wxmap-canvas" />
        {gridLoading && <p className="layer-status" role="status">Loading wind grid…</p>}
        {badge && <span className={`mode-badge ${badge.toLowerCase()}`}>{badge}{time ? ` · ${timeLabel(time)}` : ""}</span>}
      </div>
      <div className="wxmap-side">
        <fieldset><legend>Overlays</legend>
          {LAYER_DEFS.map(def => <label key={def.id} className={disabled(def.id) ? "off" : ""}><input type="checkbox" checked={layers[def.id] && !disabled(def.id)} disabled={disabled(def.id)} onChange={() => toggle(def.id)} />{def.label}
            {def.id === "lightning" && <small>{replay ? "live only" : !nowLayers ? "now only" : "latest 15 min"}</small>}
            {(def.id === "stations" || def.id === "storms") && !nowLayers && <small>now only</small>}</label>)}
          <label className="off" title="No free feed separates cloud-to-ground from cloud-to-cloud lightning"><input type="checkbox" disabled />Cloud-to-ground<small>no free feed</small></label>
          <label className="off" title="No free feed separates cloud-to-ground from cloud-to-cloud lightning"><input type="checkbox" disabled />Cloud-to-cloud<small>no free feed</small></label>
        </fieldset>
        <label className="field">Weather field<select value={field} onChange={e => setField(e.target.value as Field)}>{Object.entries(FIELDS).map(([id, f]) => <option key={id} value={id}>{f.label}</option>)}</select></label>
        <div className="ramp" aria-label={`${spec.label} legend`}>
          {spec.stops.map((stop, i) => <span key={stop}><i style={{ background: RAMP[i] }} />{stop}{i === spec.stops.length - 1 ? "+" : ""}</span>)}
          <small>{spec.unit}</small>
        </div>
        {layers.storms && <p className="key"><i style={{ background: "#f1e319" }} /><i style={{ background: "#f5a800" }} /><i style={{ background: "#e8261c" }} /><i style={{ background: "#8a1aa0" }} /> Storm cell by radar strength; dashed line is its next hour</p>}
        {layers.tropical && tropical.data && <div className="tracks">
          {tropical.data.tracks.length === 0 && tropical.data.active.length === 0 && <small>No tropical systems in this period.</small>}
          {tropical.data.tracks.map(track => <button key={track.id} className="link-button" onClick={() => zoomTo(track.points.map(p => [p[0], p[1]]))}>{track.name || "Unnamed"} →</button>)}
        </div>}
        {notes.map(note => <p key={note} className="error">{note}</p>)}
      </div>
    </div>
    {grid && <div className="timebar">
      <button className="ghost" onClick={() => setPlaying(p => !p)} aria-label={playing ? "Pause" : "Play"}>{playing ? "❚❚" : "▶"}</button>
      <input type="range" min={0} max={grid.times.length - 1} value={tIdx} onChange={e => { setPlaying(false); setTIdx(Number(e.target.value)); }} aria-label="Time" />
      <span className="time-text">{time && timeLabel(time)}</span>
      {!replay && <button className="link-button" onClick={() => setTIdx(nowIdx)} disabled={tIdx === nowIdx}>Now</button>}
    </div>}
    <p className="source-note">
      {replay ? (replayMode === "observed" ? "Observed: Open-Meteo reanalysis for the storm (gridded estimates, not station readings)." : "Forecast: the model forecast archived at the time (Open-Meteo historical forecasts).") : "Live: the last 24 hours are model analysis, the next 48 hours are the forecast (Open-Meteo)."}
      {" "}Stations: NWS/FAA ASOS via Iowa Environmental Mesonet{replay ? " (that day’s peak gust)" : " (latest report)"}. Storm tracks: NEXRAD cell motion, projected one hour; no multi-hour history. Tropical: NHC and IBTrACS.
      {" "}Lightning is NOAA’s combined strike density (NLDN and GLD360, ground-based networks); the feed does not separate cloud-to-ground from cloud-to-cloud strikes, so those two toggles stay off, and it is available for the latest 15 minutes only.
    </p>
  </section>;
}
