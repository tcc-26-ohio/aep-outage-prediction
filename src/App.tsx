import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { apiUrl } from "./api";

type Place = { lat: number; lon: number; name: string; bounds: L.LatLngBoundsExpression };

export function App() {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const marker = useRef<L.CircleMarker | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Place[]>([]);
  const [selected, setSelected] = useState<Place | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [mapError, setMapError] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [alertError, setAlertError] = useState("");
  const [enabledLayers, setEnabledLayers] = useState<string[]>(["damage"]);
  const [layerStatus, setLayerStatus] = useState("Loading historical damage…");
  const [viewport, setViewport] = useState(0);

  useEffect(() => {
    const instance = map.current;
    if (!instance) return;
    const controller = new AbortController();
    const group = L.layerGroup().addTo(instance);
    const colors: Record<string, string> = { damage: "#c26b36", primary: "#567f8c", hospitals: "#a34f72", fire: "#bb4d47", ems: "#6c66a1" };
    const bounds = instance.getBounds();
    const bbox = [Math.max(-180, bounds.getWest()), Math.max(-90, bounds.getSouth()), Math.min(180, bounds.getEast()), Math.min(90, bounds.getNorth())].join(",");
    setLayerStatus(enabledLayers.length ? "Loading map layers…" : "All data layers hidden");
    async function load() {
      try {
        const results = await Promise.all(enabledLayers.map(async name => {
          const response = await fetch(apiUrl(`/api/layers/${name}?bbox=${bbox}&limit=5000`), { signal: controller.signal });
          if (!response.ok) throw new Error("Map data unavailable. Check the backend and downloaded datasets.");
          const data = await response.json();
          return { name, data };
        }));
        if (controller.signal.aborted) return;
        let count = 0; let truncated = false;
        for (const { name, data } of results) {
          count += data.features.length; truncated ||= data.metadata.truncated;
          L.geoJSON(data, {
            style: { color: colors[name], weight: 2, opacity: 0.65 },
            pointToLayer: (_feature, latlng) => L.circleMarker(latlng, { radius: name === "damage" ? 5 : 7, color: "#fff", weight: 1, fillColor: colors[name], fillOpacity: 0.85 }),
            onEachFeature: (feature, layer) => {
              const popup = document.createElement("div");
              const title = document.createElement("strong");
              title.textContent = name === "damage" ? "Historical damage report" : name === "primary" ? "Primary power line" : String(feature.properties?.name ?? "Emergency facility");
              popup.append(title);
              for (const [key, value] of Object.entries(feature.properties ?? {})) {
                if (value === null || value === "") continue;
                const row = document.createElement("div"); row.textContent = `${key.replaceAll("_", " ")}: ${value}`; popup.append(row);
              }
              layer.bindPopup(popup);
            },
          }).addTo(group);
        }
        setLayerStatus(enabledLayers.length ? `${count.toLocaleString()} features in view${truncated ? " · Zoom in to see all features" : ""}` : "All data layers hidden");
      } catch (error) {
        if (!controller.signal.aborted) setLayerStatus(error instanceof Error ? error.message : "Unable to load layers.");
      }
    }
    void load();
    return () => { controller.abort(); group.remove(); };
  }, [enabledLayers, viewport]);

  async function enroll(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setAlertError("");
    const values = new FormData(event.currentTarget);
    try {
      const response = await fetch(apiUrl("/api/location-subscriptions"), {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ location: values.get("location"), email: values.get("email"), consent: values.get("consent") === "on" }),
      });
      if (!response.ok) throw new Error("We couldn’t save your preference. Please try again later.");
      setSaved(true);
    } catch (error) { setAlertError(error instanceof Error ? error.message : "Unable to save."); }
    finally { setSaving(false); }
  }

  useEffect(() => {
    if (!container.current) return;
    const instance = L.map(container.current, { zoomControl: false }).setView([37.27, -79.94], 11);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19,
    }).on("tileerror", () => setMapError(true)).addTo(instance);
    L.control.zoom({ position: "bottomright" }).addTo(instance);
    map.current = instance;
    instance.on("moveend", () => setViewport(value => value + 1));
    setViewport(value => value + 1);
    return () => { instance.remove(); map.current = null; };
  }, []);

  function select(place: Place) {
    setSelected(place); setResults([]); setQuery(place.name);
    map.current?.fitBounds(place.bounds, { maxZoom: 15, padding: [35, 35] });
    marker.current?.remove();
    if (map.current) marker.current = L.circleMarker([place.lat, place.lon], {
      radius: 10, color: "#ffffff", weight: 3, fillColor: "#23765e", fillOpacity: 1,
    }).addTo(map.current).bindTooltip("Selected location");
  }

  async function findLocation(event: FormEvent) {
    event.preventDefault();
    const value = query.trim();
    if (!value) return;
    setBusy(true); setError(""); setResults([]);
    try {
      const params = new URLSearchParams({ q: value, format: "json", countrycodes: "us", limit: "5" });
      const response = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, { signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error("Location search is temporarily unavailable. Please try again shortly.");
      const data: { lat: string; lon: string; display_name: string; boundingbox: [string, string, string, string] }[] = await response.json();
      const places = data.map(item => ({ lat: Number(item.lat), lon: Number(item.lon), name: item.display_name,
        bounds: [[Number(item.boundingbox[0]), Number(item.boundingbox[2])], [Number(item.boundingbox[1]), Number(item.boundingbox[3])]] as L.LatLngBoundsExpression }));
      if (!places.length) setError("We couldn’t find that location. Try a 5-digit ZIP code or include your city and state.");
      else if (places.length === 1) select(places[0]!);
      else setResults(places);
    } catch (error) { setError(error instanceof Error && error.name !== "TimeoutError" ? error.message : "Search timed out. Please try again."); }
    finally { setBusy(false); }
  }

  return <div className="app-shell">
    <header className="toolbar">
      <a className="brand" href="/" aria-label="GridAhead home"><span className="brand-mark">ϟ</span>GridAhead</a>
      <nav aria-label="Main navigation"><span className="active-nav">Power outlook</span><button className="text-button" onClick={() => search.current?.focus()}>Find my area</button></nav>
      <button className="alert-button" onClick={() => dialog.current?.showModal()}><span aria-hidden="true">♧</span> Get automatic alerts</button>
    </header>

    <main className="workspace">
      <aside className="sidebar">
        <div className="intro"><p className="eyebrow">BEFORE THE WEATHER TURNS</p><h1>Your neighborhood.<br />Your power outlook.</h1><p>A little heads-up makes a big difference. Start with your address or ZIP code.</p></div>
        <form className="search-form" onSubmit={findLocation}>
          <label htmlFor="location">Where would you like to check?</label>
          <div className="search-input"><span aria-hidden="true">⌕</span><input ref={search} id="location" value={query} onChange={e => setQuery(e.target.value)} placeholder="Enter an address or ZIP code" required maxLength={250} autoComplete="street-address" /></div>
          <button className="primary-button" disabled={busy}>{busy ? "Finding your area…" : "Find my area"}<span aria-hidden="true">→</span></button>
          <small>US locations · Search powered by OpenStreetMap</small>
        </form>
        {error && <p className="error" role="alert">{error}</p>}
        {results.length > 0 && <section className="results" aria-label="Location search results"><p>Choose your location</p>{results.map((place, index) => <button key={index} onClick={() => select(place)}>{place.name}<span>↗</span></button>)}</section>}
        {selected ? <section className="location-card" aria-live="polite"><p className="eyebrow">YOUR SELECTED AREA</p><h2>{selected.name}</h2><span className="status-tag">Location found</span><p>Live weather risk and restoration estimates aren’t available yet. Finding a location does not confirm utility service or alert eligibility.</p><button className="text-link" onClick={() => dialog.current?.showModal()}>Explore automatic alerts →</button></section> : <section className="how-it-works"><span className="compass" aria-hidden="true">⌖</span><h2>A clearer picture starts here.</h2><p>Find your neighborhood on the map. When live forecasts are connected, this is where you’ll see what weather could mean for your power.</p></section>}
        <section className="prepare"><span aria-hidden="true">☀</span><div><h2>A small step for peace of mind</h2><p>Keep a flashlight handy and charge your phone before severe weather arrives.</p></div></section>
        <p className="privacy-note">Your search is sent to OpenStreetMap’s location service. We don’t save your address in this app.</p>
      </aside>

      <section className="map-panel" aria-label="Interactive neighborhood map">
        <div ref={container} className="map" />
        <div className="map-heading"><span className="live-dot" /><div><strong>Explore your area</strong><span>{selected ? "Your selected location" : "Starting in Roanoke, Virginia"}</span></div></div>
        <div className="layer-controls"><strong>Map layers</strong>{[
          ["damage", "Historical damage", "#c26b36"], ["primary", "Primary power lines", "#567f8c"],
          ["hospitals", "Hospitals", "#a34f72"], ["fire", "Fire stations", "#bb4d47"], ["ems", "Emergency medical services", "#6c66a1"],
        ].map(([id, label, color]) => <label key={id}><input type="checkbox" checked={enabledLayers.includes(id!)} onChange={e => setEnabledLayers(current => e.target.checked ? [...current, id!] : current.filter(name => name !== id))} /><span style={{ background: color }} />{label}</label>)}<small role="status">{layerStatus}</small></div>
        <div className="map-disclaimer">Historical GIS data <span>·</span> Not live outages or predicted weather impacts</div>
        {mapError && <p className="map-error" role="status">Some map tiles couldn’t load. Check your connection or refresh.</p>}
      </section>
    </main>

    <dialog ref={dialog} className="alert-dialog" onClick={e => { if (e.target === e.currentTarget) dialog.current?.close(); }}>
      <button className="close-button" aria-label="Close automatic alerts" onClick={() => dialog.current?.close()}>×</button>
      <p className="eyebrow">A HEADS-UP, WITHOUT THE GUESSWORK</p><h2>Stay ahead of what’s coming.</h2>
      <p>Automatic alerts will let you know when severe weather could affect power in your area.</p>
      <div className="coming-soon">Delivery coming soon</div><p>Save your opt-in preference below. This prototype stores your details locally on the server; it does not send alerts, verify your email, or confirm service eligibility yet. Use a test email while trying it out.</p>
      {saved ? <p role="status">Your preference is saved. Alerts are not active yet.</p> : <form className="alert-form" onSubmit={enroll}>
        <label htmlFor="alert-location">Address or ZIP code</label><input id="alert-location" name="location" defaultValue={selected?.name ?? query} required maxLength={500} placeholder="Address or ZIP code" />
        <label htmlFor="alert-email">Email address</label><input id="alert-email" name="email" type="email" required placeholder="you@example.com" />
        <label className="consent"><input name="consent" type="checkbox" required />I opt in to weather-related power alerts and consent to storing this location and email.</label>
        {alertError && <p className="error" role="alert">{alertError}</p>}
        <button className="primary-button" disabled={saving}>{saving ? "Saving…" : "Save alert preference"}<span>→</span></button>
      </form>}
    </dialog>
  </div>;
}
