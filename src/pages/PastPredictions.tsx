import { useMemo } from "react";
import { eventLabel } from "../outlookData";
import type { PageProps } from "../outlookData";

const TOP = 10;
const top = (scores: Map<string, number>, n: number) => [...scores].sort((a, b) => b[1] - a[1]).slice(0, n).map(([id]) => id);

// Walk through the storms in order. For each one, a baseline model that only knows the earlier
// storms and the equipment on each circuit guesses the size and where the damage lands.
export function PastPredictions({ data }: PageProps) {
  const results = useMemo(() => {
    const events = data.events.filter(event => event.significant).sort((a, b) => a.start.localeCompare(b.start));
    const exposureTotal = data.circuits.reduce((sum, c) => sum + c.exposure, 0) || 1;
    return events.slice(1).map((event, index) => {
      const prior = events.slice(0, index + 1);
      const sizes = prior.map(e => e.reports).sort((a, b) => a - b);
      const predicted = Math.round((sizes[Math.floor((sizes.length - 1) / 2)]! + sizes[Math.floor(sizes.length / 2)]!) / 2);
      const history = new Map(data.circuits.map(c => [c.id, prior.reduce((sum, e) => sum + (c.events[e.id] ?? 0), 0)]));
      const historyTotal = [...history.values()].reduce((a, b) => a + b, 0) || 1;
      const scores = new Map(data.circuits.map(c => [c.id, 0.6 * history.get(c.id)! / historyTotal + 0.4 * c.exposure / exposureTotal]));
      const actual = new Map(data.circuits.map(c => [c.id, c.events[event.id] ?? 0]));
      const predictedTop = new Set(top(scores, TOP));
      const hits = top(actual, TOP).filter(id => predictedTop.has(id)).length;
      return { event, predicted, error: (predicted - event.reports) / event.reports, hits };
    }).reverse();
  }, [data]);

  if (!results.length) return <p className="empty">Not enough storms in the data to backtest.</p>;
  const sortedErrors = results.map(r => Math.abs(r.error)).sort((a, b) => a - b);
  const median = sortedErrors[Math.floor(sortedErrors.length / 2)]!;
  const within = results.filter(r => Math.abs(r.error) <= 0.25).length;
  const meanHits = results.reduce((sum, r) => sum + r.hits, 0) / results.length;
  const max = Math.max(...results.flatMap(r => [r.predicted, r.event.reports]));

  return <>
    <dl className="kpis wide">
      <div><dt>Storms backtested</dt><dd>{results.length}</dd></div>
      <div><dt>Median size error</dt><dd>{(median * 100).toFixed(0)}%</dd></div>
      <div><dt>Within 25% of actual</dt><dd>{within} of {results.length}</dd></div>
      <div><dt>Top-{TOP} circuits found</dt><dd>{meanHits.toFixed(1)} of {TOP}</dd></div>
    </dl>
    <section className="card" aria-label="Past predictions">
      <header className="panel-head"><h2>Predicted vs actual</h2><span>Baseline model replayed on each storm in the data</span></header>
      <div className="table-scroll">
        <table>
          <thead><tr><th scope="col">Storm</th><th scope="col" className="num">Circuits hit</th><th scope="col">Predicted vs actual</th><th scope="col" className="num">Predicted</th><th scope="col" className="num">Actual</th><th scope="col" className="num">Error</th><th scope="col" className="num">Top-{TOP} found</th></tr></thead>
          <tbody>{results.map(({ event, predicted, error, hits }) => <tr key={event.id} className="static">
            <th scope="row">{eventLabel(event)}</th><td className="num">{event.circuits}</td>
            <td className="pair" aria-hidden="true"><span className="bar-pred" style={{ width: `${predicted / max * 100}%` }} /><span className="bar-actual" style={{ width: `${event.reports / max * 100}%` }} /></td>
            <td className="num">{predicted}</td><td className="num">{event.reports.toLocaleString()}</td>
            <td className={`num ${Math.abs(error) <= 0.25 ? "good" : "off"}`}>{error > 0 ? "+" : ""}{(error * 100).toFixed(0)}%</td>
            <td className="num">{hits} / {TOP}</td>
          </tr>)}</tbody>
        </table>
      </div>
      <p className="legend-key"><span className="swatch pred" /> Predicted <span className="swatch actual" /> Actual</p>
      <p className="source-note">A deliberately simple baseline, not the production model. Size = median of the earlier storms’ damage reports. Placement = earlier damage history (60%) blended with equipment on each circuit (40%), using Data1 and Data2. The first storm has no history to learn from, so it isn’t scored.</p>
    </section>
  </>;
}
