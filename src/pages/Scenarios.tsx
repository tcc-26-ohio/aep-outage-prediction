import { useMemo, useState } from "react";
import { REGIONS, allocate, eventLabel, makeLevelFor } from "../outlookData";
import type { PageProps, RegionName } from "../outlookData";

export function Scenarios({ data }: PageProps) {
  const events = useMemo(() => data.events.filter(event => event.significant).sort((a, b) => b.start.localeCompare(a.start)), [data.events]);
  const [eventId, setEventId] = useState<string | null>(null);
  const [intensity, setIntensity] = useState(100);
  const [hit, setHit] = useState<RegionName[]>([...REGIONS]);
  const event = events.find(item => item.id === eventId) ?? [...events].sort((a, b) => b.reports - a.reports)[0];

  const results = useMemo(() => {
    const rows = data.circuits.map(c => ({ ...c, scenario: 0 }));
    if (!event) return { rows, regions: REGIONS.map(name => ({ name, count: 0 })), total: 0 };
    for (const name of REGIONS) {
      // The storm's damage in each region, scaled, then spread over that region's circuits by history + equipment.
      const own = rows.filter(row => row.region === name);
      const total = hit.includes(name) ? Math.round((event.regions[name] ?? 0) * intensity / 100) : 0;
      allocate(own.map(row => row.weight), total).forEach((count, i) => { own[i]!.scenario = count; });
    }
    const regions = REGIONS.map(name => ({ name, count: rows.filter(row => row.region === name).reduce((sum, row) => sum + row.scenario, 0) }));
    return { rows, regions, total: regions.reduce((sum, r) => sum + r.count, 0) };
  }, [data.circuits, event, intensity, hit]);

  if (!event) return <p className="empty">No storms in the data to build a scenario from.</p>;
  const { levelFor } = makeLevelFor(results.rows.map(row => row.scenario));
  const maxRegion = Math.max(1, ...results.regions.map(r => r.count));
  const affected = results.rows.filter(row => row.scenario > 0).reduce((sum, row) => sum + row.customers, 0);
  const topRows = [...results.rows].sort((a, b) => b.scenario - a.scenario).slice(0, 8);

  return <div className="split">
    <section className="card padded" aria-label="Scenario inputs">
      <h2>Build a scenario</h2>
      <p className="note">Replay a storm from the data at a different strength, or aim it at fewer regions, to see where the damage would land on today’s circuits.</p>
      <label className="field">Storm to replay
        <select value={event.id} onChange={e => setEventId(e.target.value)}>{events.map(item => <option key={item.id} value={item.id}>{eventLabel(item)} · {item.reports.toLocaleString()} reports</option>)}</select></label>
      <label className="slider"><span>Strength<strong>{intensity}%</strong></span>
        <input type="range" min={25} max={300} step={5} value={intensity} onChange={e => setIntensity(Number(e.target.value))} /></label>
      <fieldset className="regions-pick"><legend>Regions hit</legend>
        {REGIONS.map(name => <label key={name}><input type="checkbox" checked={hit.includes(name)} onChange={e => setHit(current => e.target.checked ? [...current, name] : current.filter(r => r !== name))} />{name}<small>{event.regions[name] ?? 0} in storm</small></label>)}
      </fieldset>
    </section>

    <section className="card" aria-label="Scenario results">
      <dl className="kpis wide flat">
        <div><dt>Scenario damage reports</dt><dd>{results.total.toLocaleString()}</dd></div>
        <div><dt>Vs. the original storm ({event.reports.toLocaleString()})</dt><dd>{results.total >= event.reports ? "+" : ""}{(results.total - event.reports).toLocaleString()}</dd></div>
        <div><dt>Customers on affected circuits</dt><dd>{affected.toLocaleString()}</dd></div>
      </dl>
      <header className="panel-head"><h2>By region</h2></header>
      <ul className="bars">{results.regions.map(r => <li key={r.name}><span>{r.name}</span><span className="meter"><span style={{ width: `${r.count / maxRegion * 100}%` }} /></span><strong>{r.count.toLocaleString()}</strong></li>)}</ul>
      <header className="panel-head"><h2>Most affected circuits</h2></header>
      <ol className="circuit-list padded-list">{topRows.map(row => { const level = levelFor(row.scenario); return <li key={row.id}><span>{row.id} <small>{row.region}</small></span>
        <span className="chip-level" style={{ background: level.color }}>{level.label}</span><strong>{row.scenario}</strong></li>; })}</ol>
      <p className="source-note">The storm’s damage per region comes from Data1’s reports; it is spread over each region’s circuits by damage history and equipment (Data1 + Data2). A what-if, not a forecast.</p>
    </section>
  </div>;
}
