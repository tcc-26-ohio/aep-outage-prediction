import { useMemo, useState } from "react";
import { REGIONS, dateLabel, eventLabel } from "../outlookData";
import type { PageProps, RegionName, StormEvent } from "../outlookData";

const topRegions = (event: StormEvent) => REGIONS.filter(name => event.regions[name]).sort((a, b) => event.regions[b]! - event.regions[a]!).slice(0, 2);

export function StormSearch({ data, update, go }: PageProps) {
  const [query, setQuery] = useState("");
  const [region, setRegion] = useState<RegionName | "All">("All");
  const [size, setSize] = useState<"all" | "significant">("significant");
  const [selected, setSelected] = useState<string | null>(null);

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return data.events.filter(event => (size === "all" || event.significant) && (region === "All" || event.regions[region])
      && (!needle || `${eventLabel(event)} ${event.start} ${event.end} ${Object.keys(event.regions).join(" ")} ${Object.keys(event.types).join(" ")}`.toLowerCase().includes(needle)))
      .sort((a, b) => b.start.localeCompare(a.start));
  }, [data.events, query, region, size]);
  const storm = data.events.find(event => event.id === selected);
  const worst = useMemo(() => storm ? data.circuits.filter(c => c.events[storm.id]).sort((a, b) => b.events[storm.id]! - a.events[storm.id]!).slice(0, 6) : [], [storm, data.circuits]);
  const max = (values: number[]) => Math.max(1, ...values);

  return <div className="split wide-left">
    <section className="card" aria-label="Storm results">
      <header className="panel-head">
        <h2>Storm search <small>{matches.length} of {data.events.length} events</small></h2>
        <div className="head-actions">
          <input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Date, region, damage type…" aria-label="Search storms" />
          <select value={region} onChange={e => setRegion(e.target.value as RegionName | "All")} aria-label="Region"><option value="All">All regions</option>{REGIONS.map(name => <option key={name}>{name}</option>)}</select>
          <select value={size} onChange={e => setSize(e.target.value as "all" | "significant")} aria-label="Size"><option value="significant">10+ reports</option><option value="all">All events</option></select>
        </div>
      </header>
      <div className="table-scroll">
        <table>
          <thead><tr><th scope="col">Dates</th><th scope="col">Hardest hit</th><th scope="col" className="num">Reports</th><th scope="col" className="num">Circuits</th><th scope="col" className="num">Customers</th><th scope="col" className="num">Median repair</th></tr></thead>
          <tbody>{matches.map(event => <tr key={event.id} className={event.id === selected ? "current" : ""} tabIndex={0} aria-selected={event.id === selected}
            onClick={() => setSelected(event.id)} onKeyDown={e => { if (e.key === "Enter") setSelected(event.id); }}>
            <th scope="row">{eventLabel(event)}</th><td>{topRegions(event).join(", ")}</td>
            <td className="num"><strong>{event.reports.toLocaleString()}</strong></td><td className="num">{event.circuits}</td>
            <td className="num">{event.customers.toLocaleString()}</td><td className="num">{event.median_repair_days === null ? "–" : `${event.median_repair_days} d`}</td>
          </tr>)}</tbody>
        </table>
      </div>
      {!matches.length && <p className="empty">No storms match that search.</p>}
    </section>

    <section className="card padded" aria-label="Storm detail" aria-live="polite">
      {storm ? <>
        <p className="eyebrow">{storm.days.length} DAY{storm.days.length === 1 ? "" : "S"} OF REPORTS</p>
        <h2>{eventLabel(storm)}</h2>
        <dl className="facts">
          <div><dt>Damage reports</dt><dd>{storm.reports.toLocaleString()}</dd></div><div><dt>Circuits hit</dt><dd>{storm.circuits}</dd></div>
          <div><dt>Customers on those circuits</dt><dd>{storm.customers.toLocaleString()}</dd></div><div><dt>Median repair</dt><dd>{storm.median_repair_days === null ? "–" : `${storm.median_repair_days} days`}</dd></div>
          <div><dt>Still unrepaired</dt><dd>{storm.unrepaired}</dd></div><div><dt>Access issues</dt><dd>{storm.access_issues}</dd></div>
        </dl>
        <h3>Damage by type</h3>
        <ul className="bars">{Object.entries(storm.types).sort((a, b) => b[1] - a[1]).map(([name, count]) => <li key={name}><span>{name}</span><span className="meter"><span style={{ width: `${count / max(Object.values(storm.types)) * 100}%` }} /></span><strong>{count}</strong></li>)}</ul>
        <h3>By region</h3>
        <ul className="bars">{REGIONS.map(name => <li key={name}><span>{name}</span><span className="meter"><span style={{ width: `${(storm.regions[name] ?? 0) / max(Object.values(storm.regions) as number[]) * 100}%` }} /></span><strong>{storm.regions[name] ?? 0}</strong></li>)}</ul>
        {storm.days.length > 1 && <><h3>Day by day</h3>
          <ul className="bars">{storm.days.map(day => <li key={day.date}><span>{dateLabel(day.date).replace(/^\w+, /, "")}</span><span className="meter"><span style={{ width: `${day.reports / max(storm.days.map(d => d.reports)) * 100}%` }} /></span><strong>{day.reports}</strong></li>)}</ul></>}
        <h3>Most affected circuits</h3>
        <ol className="circuit-list">{worst.map(c => <li key={c.id}><span>{c.id} <small>{c.region}</small></span><span /><strong>{c.events[storm.id]}</strong></li>)}</ol>
        <button className="solid wide-button" onClick={() => { update({ window: storm.id }); go("outages"); }}>View on the Outages map →</button>
        <p className="source-note">Events group damage reports from Data1 that are within two days of each other, placed on circuits using Data2’s equipment records.</p>
      </> : <p className="empty">Select a storm to see what it damaged and where.</p>}
    </section>
  </div>;
}
