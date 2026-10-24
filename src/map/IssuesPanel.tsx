import React, { useMemo, useState } from 'react';
import { FACILITY_LABEL, FAR_M, NEAR_M, rankIssues, WEIGHTS, type Issue, type Ranked } from './priority';
import { reportLabor } from './labor';
import { store } from './store';

const typeKey = (p: Issue['props']) => `${p.damage ?? 'Other'}|${p.asset ?? 'Unknown'}`;
const n0 = (n: number) => Math.round(n).toLocaleString();

interface Props {
  /** ARCOS type keys switched off in the Layers tab; the issue list follows that filter */
  arcosOff: Set<string>;
  /** layer data has loaded */
  ready: boolean;
  onFocus: (issue: Issue) => void;
}

/** Pick damage reports, then rank them by customers affected and nearby hospitals / fire stations / ambulances. */
export function IssuesPanel({ arcosOff, ready, onFocus }: Props) {
  const [openOnly, setOpenOnly] = useState(true);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [ranked, setRanked] = useState<Ranked[] | null>(null);
  const [limit, setLimit] = useState(100);
  const [active, setActive] = useState<number | null>(null);
  const focus = (i: Issue) => { setActive(i.id); onFocus(i); };

  const issues = useMemo(
    () => store.arcosFeatures.filter(i => !arcosOff.has(typeKey(i.props)) && (!openOnly || i.props.repaired === 'No')).sort((a, b) => (b.props.openN ?? 0) - (a.props.openN ?? 0)),
    [arcosOff, openOnly, ready, store.arcosFeatures.length],
  );
  const visibleIds = issues.map(i => i.id);
  const selected = issues.filter(i => picked.has(i.id));

  const toggle = (ids: number[], on: boolean) => setPicked(prev => { const n = new Set(prev); ids.forEach(id => (on ? n.add(id) : n.delete(id))); return n; });

  if (!store.arcosFeatures.length) return <div className="mp-body"><div className="mp-card mp-empty">Loading damage reports…</div></div>;

  if (ranked) {
    return (
      <div className="mp-body">
        <section className="mp-card">
          <div className="mp-group-head">
            <h3>Priority order · {ranked.length}</h3>
            <button onClick={() => setRanked(null)}>Back</button>
            <button onClick={() => download(ranked)}>CSV</button>
          </div>
          <div className="mp-hint">
            Score = customers off ({WEIGHTS.customer} each) + life-support customers ({WEIGHTS.lifeSupport} each) + hospital {WEIGHTS.hospitals} / fire station {WEIGHTS.fire} / ambulance {WEIGHTS.ambulance} within {NEAR_M} m of the damage or any de-energized transformer (×0.4 out to {FAR_M} m).
          </div>
        </section>
        <ol className="mp-ranked">
          {ranked.map(r => <RankedRow key={r.issue.id} r={r} active={active === r.issue.id} onFocus={focus} />)}
        </ol>
      </div>
    );
  }

  return (
    <div className="mp-body">
      <section className="mp-card">
        <h3>Damage reports</h3>
        <label className="mp-arcos-sub" style={{ paddingLeft: 0 }}>
          <input type="checkbox" checked={openOnly} onChange={e => { setOpenOnly(e.target.checked); }} />
          <span className="mp-name">Only reports not yet repaired</span>
        </label>
        <div className="mp-hint">{issues.length.toLocaleString()} reports match. The list follows the damage-type filter under Impact in the Layers tab.</div>
        <div className="mp-actions">
          <button onClick={() => toggle(visibleIds, true)}>Select all</button>
          <button onClick={() => toggle(visibleIds, false)}>Clear</button>
        </div>
        <button className="mp-primary" disabled={!selected.length} onClick={() => setRanked(rankIssues(selected))}>
          Prioritize {selected.length ? `${selected.length} selected` : 'selected'}
        </button>
      </section>
      <ul className="mp-issues">
        {issues.slice(0, limit).map(i => {
          const p = i.props;
          const l = reportLabor(p);
          return (
            <li key={i.id} className={active === i.id ? 'active' : ''}>
              <label>
                <input type="checkbox" checked={picked.has(i.id)} onChange={e => toggle([i.id], e.target.checked)} />
                <div>
                  <b>{(p.damage ?? 'Damage').replace('Damaged ', '')}</b> · {p.asset ?? 'asset'} <span className="mp-pill">{p.repaired === 'No' ? 'open' : 'repaired'}</span>
                  <small>Circuit {p.circuit ?? '?'} · {p.reported ?? ''} · {p.openN !== undefined ? `${n0(p.openN)} customers off` : 'no isolation point'}{l ? ` · ${l.person.toFixed(1)} person-h` : ''}</small>
                </div>
              </label>
              <button className="mp-locate" title="Show on map" onClick={() => focus(i)}>⌖</button>
            </li>
          );
        })}
      </ul>
      {issues.length > limit && <button className="mp-link" onClick={() => setLimit(limit + 200)}>Show more ({issues.length - limit} hidden)</button>}
    </div>
  );
}

function RankedRow({ r, active, onFocus }: { r: Ranked; active: boolean; onFocus: (i: Issue) => void }) {
  const p = r.issue.props;
  return (
    <li className={`mp-ranked-row${active ? ' active' : ''}`}>
      <button onClick={() => onFocus(r.issue)}>
        <span className="mp-rank">{r.rank}</span>
        <div>
          <div><b>{(p.damage ?? 'Damage').replace('Damaged ', '')}</b> · {p.asset ?? 'asset'} · circuit {p.circuit ?? '?'}</div>
          <small>
            {n0(r.customers)} customers off{r.lifeSupport ? ` (${r.lifeSupport} life support)` : ''}
            {p.open ? ` · open ${String(p.openT ?? 'device').toLowerCase()} ${p.open}` : p.openC ? ` · breaker on circuit ${p.openC}` : ''}
          </small>
          {r.facilities.slice(0, 3).map(f => <small key={f.name} className="mp-fac">{FACILITY_LABEL[f.layer]}: {f.name} · {f.meters < 1000 ? `${Math.round(f.meters)} m` : `${(f.meters / 1000).toFixed(1)} km`}</small>)}
          {r.facilities.length > 3 && <small className="mp-fac">+{r.facilities.length - 3} more nearby</small>}
        </div>
        <span className="mp-score" title={`customers ${n0(r.parts.customers)} + life support ${n0(r.parts.lifeSupport)} + facilities ${n0(r.parts.facilities)}`}>{n0(r.score)}</span>
      </button>
    </li>
  );
}

function download(ranked: Ranked[]) {
  const rows = [['rank', 'score', 'damage', 'asset', 'circuit', 'reported', 'repaired', 'customers_off', 'life_support_off', 'open_device', 'open_location', 'nearby_facilities']];
  for (const r of ranked) {
    const p = r.issue.props;
    rows.push([String(r.rank), r.score.toFixed(0), p.damage ?? '', p.asset ?? '', p.circuit ?? '', p.reported ?? '', p.repaired ?? '', String(r.customers), String(r.lifeSupport), p.openT ?? (p.openC ? 'Substation breaker' : ''), p.open ?? p.openC ?? '', r.facilities.map(f => `${f.name} (${Math.round(f.meters)} m)`).join('; ')]);
  }
  const csv = rows.map(r => r.map(c => `"${c.replace(/"/g, '""')}"`).join(',')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  a.download = 'prioritized-issues.csv';
  a.click();
}
