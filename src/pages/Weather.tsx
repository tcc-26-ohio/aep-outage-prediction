import { useEffect, useState } from "react";
import { ALL, REGIONS, dateLabel, eventLabel } from "../outlookData";
import type { PageProps, RegionName } from "../outlookData";
import { WeatherMap } from "./WeatherMap";

type Metrics = { gust: number; wind: number; rain: number; snow: number };
type WeatherData = { available: true; days: Record<string, Partial<Record<RegionName, Metrics>>>; thresholds: Metrics; attribution: string; notice: string } | { available: false; command: string };

const COLUMNS: { key: keyof Metrics; label: string; unit: string; sum?: boolean }[] = [
  { key: "gust", label: "Peak gust", unit: "mph" }, { key: "wind", label: "Peak wind", unit: "mph" },
  { key: "rain", label: "Rain", unit: "in", sum: true }, { key: "snow", label: "Snow", unit: "in", sum: true },
];

export function Weather(props: PageProps) {
  return <><WeatherMap {...props} /><WeatherTables {...props} /></>;
}

function WeatherTables({ data, filters, view }: PageProps) {
  const [weather, setWeather] = useState<WeatherData | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    fetch("/api/weather").then(response => { if (!response.ok) throw new Error(); return response.json(); }).then(setWeather).catch(() => setError(true));
  }, []);

  if (error) return <p className="error" role="alert">Weather data unavailable. Start the backend.</p>;
  if (!weather) return <p className="empty">Loading weather…</p>;
  if (!weather.available) return <section className="card padded">
    <h2>No weather data downloaded</h2>
    <p className="note">Weather isn’t part of Data1 or Data2. Download historical Open-Meteo weather for the damage period (needs internet, takes a few minutes), then reload this tab:</p>
    <pre className="command">{weather.command}</pre>
  </section>;

  // Rows are the days of the selected storm; for all history, one row per significant storm (peaks and totals).
  const windows = view.event
    ? view.event.days.map(day => ({ label: dateLabel(day.date), dates: [day.date], reports: day.regions }))
    : data.events.filter(event => event.significant).sort((a, b) => b.start.localeCompare(a.start))
      .map(event => ({ label: eventLabel(event), dates: event.days.map(day => day.date), reports: event.regions }));
  const regions = REGIONS.filter(name => filters.region === "All" || name === filters.region);
  const value = (name: RegionName, dates: string[], column: (typeof COLUMNS)[number]) => {
    const values = dates.map(date => weather.days[date]?.[name]?.[column.key]).filter((v): v is number => v !== undefined);
    if (!values.length) return null;
    return column.sum ? values.reduce((a, b) => a + b, 0) : Math.max(...values);
  };
  const tone = (column: (typeof COLUMNS)[number], perDay: number | null) => {
    const limit = weather.thresholds[column.key];
    return perDay === null || !limit ? "" : perDay >= limit ? "met" : perDay >= limit * 0.8 ? "near" : "";
  };

  return <>
    <section className="panel-grid" aria-label="Weather by region">
      {regions.map(name => <article key={name} className="card">
        <header className="panel-head"><h2>{name}</h2><span>{view.event ? view.label : "Significant storms"}</span></header>
        <div className="table-scroll">
          <table className="weather-matrix">
            <thead><tr><th scope="col">{view.event ? "Day" : "Storm"}</th>{COLUMNS.map(c => <th key={c.key} scope="col" className="num">{c.label} <small>{c.unit}</small></th>)}<th scope="col" className="num">Reports</th></tr></thead>
            <tbody>{windows.map(row => <tr key={row.label}>
              <th scope="row">{row.label}</th>
              {COLUMNS.map(c => {
                const v = value(name, row.dates, c);
                // Thresholds are per-day values, so storm totals are compared on a per-day basis.
                return <td key={c.key} className={`num ${tone(c, v === null ? null : c.sum ? v / row.dates.length : v)}`}>{v === null ? "·" : v ? v.toFixed(c.sum ? 2 : 0) : "–"}</td>;
              })}
              <td className="num"><strong>{row.reports[name] ?? 0}</strong></td>
            </tr>)}</tbody>
          </table>
        </div>
      </article>)}
    </section>
    <section className="card padded" aria-label="Weather thresholds">
      <h2>Thresholds</h2>
      <p className="note">Cells turn <span className="met tag">Met</span> when a day is in the top 10% of all downloaded days for that measure, and <span className="near tag">Near</span> within 80% of it. “·” means no weather was downloaded for that date.</p>
      <ul className="threshold-list">{COLUMNS.map(c => <li key={c.key}><span>{c.label}</span><strong>{weather.thresholds[c.key]} {c.unit}</strong></li>)}</ul>
      <p className="source-note">{weather.notice} {weather.attribution}. Region values use each region’s nearest city samples; wind is the peak, rain and snow are averaged across cities.</p>
    </section>
  </>;
}
