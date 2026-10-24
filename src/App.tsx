import { useEffect, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent } from "react";
import { DEFAULT_FILTERS, REGIONS, SORTS, eventLabel, useOutlook, useOutlookData } from "./outlookData";
import type { Filters, PageProps, RegionFilter, SortKey } from "./outlookData";
import { Outages } from "./pages/Outages";
import { Weather } from "./pages/Weather";
import { PastPredictions } from "./pages/PastPredictions";
import { Scenarios } from "./pages/Scenarios";
import { StormSearch } from "./pages/StormSearch";

const TABS = [
  { id: "outages", label: "Outages", Page: Outages, filters: true, sort: true },
  { id: "weather", label: "Weather", Page: Weather, filters: true, sort: false },
  { id: "past-predictions", label: "Past predictions", Page: PastPredictions, filters: false, sort: false },
  { id: "scenarios", label: "Scenarios", Page: Scenarios, filters: false, sort: false },
  { id: "storm-search", label: "Storm search", Page: StormSearch, filters: false, sort: false },
] as const;
type TabId = (typeof TABS)[number]["id"];

const tabFromHash = (): TabId => TABS.find(tab => `#${tab.id}` === window.location.hash)?.id ?? "outages";

export function App() {
  const dialog = useRef<HTMLDialogElement>(null);
  const [tab, setTab] = useState<TabId>(tabFromHash);
  const [now, setNow] = useState(new Date());
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [alertError, setAlertError] = useState("");
  const { data, loadError } = useOutlookData();
  const view = useOutlook(data, filters);
  const update = (patch: Partial<Filters>) => setFilters(current => ({ ...current, ...patch }));
  const active = TABS.find(item => item.id === tab)!;

  useEffect(() => { const timer = setInterval(() => setNow(new Date()), 30000); return () => clearInterval(timer); }, []);
  useEffect(() => {
    const sync = () => setTab(tabFromHash());
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);

  function select(id: TabId) { window.location.hash = id; setTab(id); }

  function onTabKey(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    const next = TABS[(index + step + TABS.length) % TABS.length]!;
    select(next.id);
    document.getElementById(`tab-${next.id}`)?.focus();
  }

  async function enroll(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setAlertError("");
    const values = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/location-subscriptions", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ location: values.get("location"), email: values.get("email"), consent: values.get("consent") === "on" }),
      });
      if (!response.ok) throw new Error("We couldn’t save your preference. Please try again later.");
      setSaved(true);
    } catch (error) { setAlertError(error instanceof Error ? error.message : "Unable to save."); }
    finally { setSaving(false); }
  }

  const pageProps: PageProps = { data, view, filters, update, loadError, go: id => select(id as TabId) };

  return <div className="page">
    <header className="masthead">
      <div className="title-block">
        <p className="eyebrow">GRIDAHEAD · OUTAGE PREDICTION · DATA1 + DATA2</p>
        <h1>{active.label === "Outages" ? "Outage outlook" : active.label}</h1>
        <p className="stamp">{now.toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" })}</p>
      </div>
      <button className="solid" onClick={() => dialog.current?.showModal()}>✉ Customer alerts</button>
    </header>

    <div className="tabs" role="tablist" aria-label="Sections">
      {TABS.map((item, index) => <button key={item.id} id={`tab-${item.id}`} role="tab" aria-selected={item.id === tab} aria-controls="tab-panel"
        tabIndex={item.id === tab ? 0 : -1} onClick={() => select(item.id)} onKeyDown={e => onTabKey(e, index)}>{item.label}</button>)}
    </div>

    {active.filters && <div className="filters">
      <label>Region<select value={filters.region} onChange={e => update({ region: e.target.value as RegionFilter })}>
        <option value="All">All regions</option>{REGIONS.map(name => <option key={name}>{name}</option>)}</select></label>
      <label>Time window<select value={filters.window} onChange={e => update({ window: e.target.value })}>
        <option value="all">All history</option>
        {[...data.events].filter(event => event.significant || event.id === filters.window).sort((a, b) => b.start.localeCompare(a.start))
          .map(event => <option key={event.id} value={event.id}>{eventLabel(event)} · {event.reports.toLocaleString()} reports</option>)}</select></label>
      {active.sort && <label>Sort by<select value={filters.sort} onChange={e => update({ sort: e.target.value as SortKey })}>
        {SORTS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>}
    </div>}

    <main id="tab-panel" role="tabpanel" aria-labelledby={`tab-${tab}`} className="tab-panel">
      <active.Page {...pageProps} />
    </main>

    <dialog ref={dialog} className="alert-dialog" onClick={e => { if (e.target === e.currentTarget) dialog.current?.close(); }}>
      <button className="close-button" aria-label="Close automatic alerts" onClick={() => dialog.current?.close()}>×</button>
      <p className="eyebrow">A HEADS-UP, WITHOUT THE GUESSWORK</p><h2>Stay ahead of what’s coming.</h2>
      <p>Automatic alerts will let customers know when severe weather could affect power in their area.</p>
      <div className="coming-soon">Delivery coming soon</div><p>Save an opt-in preference below. This prototype stores details locally on the server; it does not send alerts, verify email, or confirm service eligibility yet. Use a test email while trying it out.</p>
      {saved ? <p role="status">The preference is saved. Alerts are not active yet.</p> : <form className="alert-form" onSubmit={enroll}>
        <label htmlFor="alert-location">Address or ZIP code</label><input id="alert-location" name="location" required maxLength={500} placeholder="Address or ZIP code" />
        <label htmlFor="alert-email">Email address</label><input id="alert-email" name="email" type="email" required placeholder="you@example.com" />
        <label className="consent"><input name="consent" type="checkbox" required />I opt in to weather-related power alerts and consent to storing this location and email.</label>
        {alertError && <p className="error" role="alert">{alertError}</p>}
        <button className="primary-button" disabled={saving}>{saving ? "Saving…" : "Save alert preference"}<span>→</span></button>
      </form>}
    </dialog>
  </div>;
}
