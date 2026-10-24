import { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { ALL, LEVEL_COLORS, LEVEL_LABELS, eventLabel, sortRows } from "../outlookData";
import type { PageProps, RegionName, Row } from "../outlookData";

const LAYERS = [
  { id: "damage", label: "Historical damage", icon: "✸", color: "#c26b36" },
  { id: "primary", label: "Primary power lines", icon: "⌇", color: "#567f8c" },
  { id: "hospitals", label: "Hospitals", icon: "✚", color: "#a34f72" },
  { id: "fire", label: "Fire stations", icon: "▲", color: "#bb4d47" },
  { id: "ems", label: "Emergency medical services", icon: "✱", color: "#6c66a1" },
];

export function Outages({ data, view, filters, update, loadError }: PageProps) {
  const { region, window: windowId, sort } = filters;
  const { rows, scoped, inScope, customersAtRisk, worst, shownRegions, maxRegion, label, total, levelFor, countFor } = view;
  // Headline windows: all history plus the three biggest storms, newest first.
  const headline = [...data.events].sort((a, b) => b.reports - a.reports).slice(0, 3).sort((a, b) => b.start.localeCompare(a.start));
  const cards = [{ id: ALL, label: "All history" }, ...headline.map(event => ({ id: event.id, label: eventLabel(event) }))];
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const markers = useRef<Record<string, L.CircleMarker>>({});
  const [query, setQuery] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [showCounts, setShowCounts] = useState(false);
  const [expanded, setExpanded] = useState<RegionName | null>(null);
  const [enabledLayers, setEnabledLayers] = useState<string[]>([]);
  const [layerStatus, setLayerStatus] = useState("");
  const [viewport, setViewport] = useState(0);
  const [mapError, setMapError] = useState(false);

  const table = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return sortRows(scoped.filter(row => !needle || `${row.id} ${row.region}`.toLowerCase().includes(needle)), sort);
  }, [scoped, query, sort]);
  const visibleRows = showAll ? table : table.slice(0, 12);

  useEffect(() => {
    if (!container.current) return;
    const instance = L.map(container.current, { zoomControl: false, zoomSnap: 0.25 }).setView([37.3, -80], 8);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors', maxZoom: 19, className: "basemap",
    }).on("tileerror", () => setMapError(true)).addTo(instance);
    L.control.zoom({ position: "bottomright" }).addTo(instance);
    map.current = instance;
    instance.on("moveend", () => setViewport(value => value + 1));
    return () => { instance.remove(); map.current = null; };
  }, []);

  function fitRegion() {
    const points = scoped.map(row => [row.lat, row.lon] as [number, number]);
    if (points.length) map.current?.fitBounds(L.latLngBounds(points), { padding: [40, 40], maxZoom: 11 });
  }
  useEffect(fitRegion, [region, rows.length]);

  useEffect(() => {
    const instance = map.current;
    if (!instance) return;
    const group = L.layerGroup().addTo(instance);
    markers.current = {};
    for (const row of rows) {
      const value = row.count;
      const level = levelFor(value);
      const active = inScope(row);
      const marker = L.circleMarker([row.lat, row.lon], {
        radius: 7 + Math.sqrt(value) * 3.2, color: "#262626", weight: active ? 1.5 : 0.5, opacity: active ? 0.9 : 0.3,
        fillColor: level.color, fillOpacity: active ? 0.85 : 0.2,
      }).bindPopup(`<strong>${row.id}</strong> · ${row.region}<br>${value} damage reports · ${level.label === "–" ? "No level" : level.label}<br>` +
        `${row.customers.toLocaleString()} customers · ${row.damage} reports all-time<br>${row.transformers.toLocaleString()} transformers · ${row.reclosers + row.switches} reclosers/switches`).addTo(group);
      if (showCounts && active && value > 0) marker.bindTooltip(String(value), { permanent: true, direction: "center", className: "count-label" });
      markers.current[row.id] = marker;
    }
    return () => { group.remove(); };
  }, [rows, region, showCounts]);

  useEffect(() => {
    const instance = map.current;
    if (!instance || !enabledLayers.length) { setLayerStatus(""); return; }
    const controller = new AbortController();
    const group = L.layerGroup().addTo(instance);
    const bounds = instance.getBounds();
    const bbox = [Math.max(-180, bounds.getWest()), Math.max(-90, bounds.getSouth()), Math.min(180, bounds.getEast()), Math.min(90, bounds.getNorth())].join(",");
    setLayerStatus("Loading map layers…");
    async function load() {
      try {
        const results = await Promise.all(enabledLayers.map(async name => {
          const response = await fetch(`/api/layers/${name}?bbox=${bbox}&limit=5000`, { signal: controller.signal });
          if (!response.ok) throw new Error("Map data unavailable. Check the backend and downloaded datasets.");
          return { name, data: await response.json() };
        }));
        if (controller.signal.aborted) return;
        let total = 0; let truncated = false;
        for (const { name, data } of results) {
          const color = LAYERS.find(layer => layer.id === name)!.color;
          total += data.features.length; truncated ||= data.metadata.truncated;
          L.geoJSON(data, {
            style: { color, weight: 2, opacity: 0.65 },
            pointToLayer: (_feature, latlng) => L.circleMarker(latlng, { radius: name === "damage" ? 3 : 6, color: "#fff", weight: 1, fillColor: color, fillOpacity: 0.85 }),
            onEachFeature: (feature, layer) => {
              const popup = document.createElement("div");
              const title = document.createElement("strong");
              title.textContent = name === "damage" ? "Historical damage report" : name === "primary" ? "Primary power line" : String(feature.properties?.name ?? "Emergency facility");
              popup.append(title);
              for (const [key, value] of Object.entries(feature.properties ?? {})) {
                if (value === null || value === "") continue;
                const line = document.createElement("div"); line.textContent = `${key.replaceAll("_", " ")}: ${value}`; popup.append(line);
              }
              layer.bindPopup(popup);
            },
          }).addTo(group);
        }
        setLayerStatus(`${total.toLocaleString()} features in view${truncated ? " · Zoom in to see all" : ""}`);
      } catch (error) {
        if (!controller.signal.aborted) setLayerStatus(error instanceof Error ? error.message : "Unable to load layers.");
      }
    }
    void load();
    return () => { controller.abort(); group.remove(); };
  }, [enabledLayers, viewport]);

  function focusCircuit(row: Row) {
    map.current?.flyTo([row.lat, row.lon], 11, { duration: 0.6 });
    markers.current[row.id]?.openPopup();
    container.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function exportCsv() {
    const header = ["Circuit", "Region", `Damage reports (${label})`, "Level", "Customers served", "Transformers", "Reclosers", "Switches", "Fuse banks", "Secondary spans", "Primary km", "All-time damage reports", "Unrepaired reports"];
    const lines = table.map(row => [row.id, row.region, row.count, levelFor(row.count).label, row.customers, row.transformers,
      row.reclosers, row.switches, row.fuses, row.secondary, row.primary_km, row.damage, row.unrepaired]);
    const csv = [header, ...lines].map(line => line.map(cell => `"${String(cell).replaceAll('"', '""')}"`).join(",")).join("\n");
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    link.download = `circuit-outlook-${region.toLowerCase()}.csv`;
    link.click(); URL.revokeObjectURL(link.href);
  }

  return <>
    <section className="days" aria-label="Time window">
      {cards.map(card => {
        const worstLevel = levelFor(Math.max(0, ...scoped.map(row => card.id === ALL ? row.damage : row.events[card.id] ?? 0)));
        return <button key={card.id} className={card.id === windowId ? "day selected" : "day"} aria-pressed={card.id === windowId} onClick={() => update({ window: card.id })}>
          <span className="day-name">{card.label}</span>
          <strong>{countFor(card.id).toLocaleString()}</strong><span className="day-unit">damage reports</span>
          <i style={{ background: worstLevel.color }} title={`Busiest circuit: ${worstLevel.label}`} />
        </button>;
      })}
      <dl className="kpis">
        <div><dt>Customers on affected circuits</dt><dd>{customersAtRisk.toLocaleString()}</dd></div>
        <div><dt>Most affected circuit</dt><dd>{worst && worst.count > 0 ? `${worst.id} (${worst.count})` : "–"}</dd></div>
        <div><dt>Circuits with damage</dt><dd>{scoped.filter(row => row.count > 0).length} of {scoped.length}</dd></div>
      </dl>
    </section>

    {loadError && <p className="error" role="alert">{loadError}</p>}

    <div className="board">
      <section className="map-card" aria-label="Damage reports by circuit">
        <div className="map-wrap">
          <div ref={container} className="map" />
          <button className="fit-button" aria-label="Fit map to region" title="Fit to region" onClick={fitRegion}>⤢</button>
          <div className="layer-buttons" role="group" aria-label="Historical map layers">
            {LAYERS.map(layer => <button key={layer.id} title={layer.label} aria-label={layer.label} aria-pressed={enabledLayers.includes(layer.id)} style={{ color: layer.color }}
              onClick={() => setEnabledLayers(current => current.includes(layer.id) ? current.filter(id => id !== layer.id) : [...current, layer.id])}>{layer.icon}</button>)}
          </div>
          {layerStatus && <p className="layer-status" role="status">{layerStatus}</p>}
          {mapError && <p className="map-error" role="status">Some map tiles couldn’t load.</p>}
        </div>
        <div className="legend">
          <span>Circuit level · {label}</span>
          {LEVEL_LABELS.map((name, i) => <span key={name} className="legend-item"><i style={{ background: LEVEL_COLORS[i] }} />{name}</span>)}
          <button className="link-button" onClick={() => setShowCounts(value => !value)}>{showCounts ? "Hide counts" : "Show counts"}</button>
        </div>
      </section>

      <section className="regions" aria-label="Regions">
        <header className="panel-head"><h2>Regions</h2><span>{label} · {total.toLocaleString()} reports</span></header>
        {shownRegions.map(stat => {
          const open = expanded === stat.name;
          return <article key={stat.name} className="region-card">
            <button className="region-top" aria-expanded={open} onClick={() => setExpanded(open ? null : stat.name)}>
              <span className="region-name">{open ? "⌄" : "›"} {stat.name}</span>
              <span className="region-meta">{stat.circuits.length} circuits · {stat.customers.toLocaleString()} customers</span>
              <strong>{stat.count.toLocaleString()}</strong>
              <span className="meter"><span style={{ width: `${stat.count / maxRegion * 100}%` }} /></span>
            </button>
            {open && <ol className="circuit-list">{[...stat.circuits].sort((a, b) => b.count - a.count).slice(0, 6).map(row =>
              <li key={row.id}><button onClick={() => focusCircuit(row)}>{row.id}</button><span className="chip-level" style={{ background: levelFor(row.count).color }}>{levelFor(row.count).label}</span><strong>{row.count}</strong></li>)}</ol>}
          </article>;
        })}
      </section>
    </div>

    <section className="circuits" aria-label="Circuit detail">
      <header className="panel-head">
        <h2>Circuits <small>{table.length} shown · {label}</small></h2>
        <div className="head-actions">
          <input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search circuit or region" aria-label="Search circuits" />
          <button className="ghost" onClick={exportCsv} disabled={!table.length}>⤓ Export</button>
        </div>
      </header>
      <div className="table-scroll">
        <table>
          <thead><tr>
            <th scope="col">Circuit</th><th scope="col">Region</th><th scope="col" className="num">Reports</th><th scope="col">Level</th>
            <th scope="col" className="num">Customers</th><th scope="col" className="num">Transformers</th>
            <th scope="col" className="num">Reclosers / switches</th><th scope="col" className="num">Fuse banks</th>
            <th scope="col" className="num">Primary km</th><th scope="col" className="num">All-time reports</th><th scope="col" className="num">Unrepaired</th>
          </tr></thead>
          <tbody>{visibleRows.map(row => {
            const level = levelFor(row.count);
            return <tr key={row.id} onClick={() => focusCircuit(row)} tabIndex={0} onKeyDown={e => { if (e.key === "Enter") focusCircuit(row); }}>
              <th scope="row">{row.id}</th><td>{row.region}</td><td className="num"><strong>{row.count}</strong></td>
              <td><span className="chip-level" style={{ background: level.color }}>{level.label}</span></td>
              <td className="num">{row.customers.toLocaleString()}</td><td className="num">{row.transformers.toLocaleString()}</td>
              <td className="num">{row.reclosers} / {row.switches}</td><td className="num">{row.fuses.toLocaleString()}</td>
              <td className="num">{row.primary_km}</td><td className="num">{row.damage}</td><td className="num">{row.unrepaired}</td>
            </tr>;
          })}</tbody>
        </table>
      </div>
      {table.length > 12 && <button className="link-button" onClick={() => setShowAll(value => !value)}>{showAll ? "Show top 12" : `Show all ${table.length} circuits`}</button>}
      <p className="source-note">Damage reports, equipment and customer counts are combined by substation and circuit from Data1 and Data2. Counts only; no customer records are shown. Repair flags in the source data may be inconsistent.</p>
    </section>
  </>;
}
