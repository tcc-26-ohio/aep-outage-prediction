import React, { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ArrowUp, Bell, Bug, Check, Home, MapPin, Repeat, Search, ShieldCheck, TriangleAlert, Zap } from 'lucide-react';
import { SatelliteMap, type MapOutage, type MapRisk } from './SatelliteMap';
import './client.css';

// The only behaviour on this page is finding which premise the customer is from their address (matched on the server:
// GET /api/premises/search). Quick-action buttons answer from the utility data; free-text questions go to the LLM (POST /api/client-chat).

interface Premise { pid: string; address: string; service: string; customers: number; lifeSupport: boolean; circuit: string; locationId: string; coords: [number, number] | null }

const STORAGE_KEY = 'gridguide.premise';
const DEBUG_KEY = 'gridguide.debug.includeRepaired';
const DEBUG_IDS_KEY = 'gridguide.debug.showLocationIds';
const updatesKey = (pid: string) => `gridguide.updates.${pid}`;

/** Debug switches. Messages already on screen read this, so toggling updates them in place. */
const DebugContext = React.createContext({ showLocationIds: false });
function stored(key: string) { try { return localStorage.getItem(key) === '1'; } catch { return false; } }
function store(key: string, on: boolean) { try { localStorage.setItem(key, on ? '1' : '0'); } catch { /* storage unavailable */ } }
/** Location ids only appear when the "Show location IDs" debug option is on. */
function Ids({ children, block }: { children: React.ReactNode; block?: boolean }) {
  const { showLocationIds } = React.useContext(DebugContext);
  return showLocationIds ? (block ? <p className="cl-ids">{children}</p> : <>{children}</>) : null;
}
const SERVICE: Record<string, string> = { OH: 'Overhead service', UG: 'Underground service', '?': 'Service type unknown' };

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return res.json();
}

function remembered(): string | null {
  try { return localStorage.getItem(STORAGE_KEY); } catch { return null; }
}
function remember(p: Premise | null) {
  try { p ? localStorage.setItem(STORAGE_KEY, p.pid) : localStorage.removeItem(STORAGE_KEY); } catch { /* storage unavailable */ }
}

export function ClientChat() {
  const [premise, setPremise] = useState<Premise | null>(null);
  const [restoring, setRestoring] = useState(true);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [outages, setOutages] = useState<MapOutage[]>([]);
  const [risk, setRisk] = useState<MapRisk | null>(null);
  const sendRef = useRef<((text: string) => void) | null>(null);
  const submit = () => { const t = draft.trim(); if (!t || sending || !sendRef.current) return; sendRef.current(t); setDraft(''); };
  const [debugOpen, setDebugOpen] = useState(false);
  const [updatesOpen, setUpdatesOpen] = useState(false);
  const [signedUp, setSignedUp] = useState<string[]>([]); // pids this browser has signed up for updates
  const subscribed = !!premise && signedUp.includes(premise.pid);
  const openUpdates = () => { setDebugOpen(false); setUpdatesOpen(true); };
  const [includeRepaired, setIncludeRepaired] = useState(() => stored(DEBUG_KEY));
  const [showLocationIds, setShowLocationIds] = useState(() => stored(DEBUG_IDS_KEY));
  const toggleRepaired = (on: boolean) => { setIncludeRepaired(on); store(DEBUG_KEY, on); };
  const toggleIds = (on: boolean) => { setShowLocationIds(on); store(DEBUG_IDS_KEY, on); };

  useEffect(() => {
    if (premise && stored(updatesKey(premise.pid)) && !signedUp.includes(premise.pid)) setSignedUp(s => [...s, premise.pid]);
  }, [premise?.pid]);

  // restore the premise chosen last time, if it still exists
  useEffect(() => {
    const pid = remembered();
    if (!pid) { setRestoring(false); return; }
    getJson<Premise>(`/api/premises/${encodeURIComponent(pid)}`).then(setPremise).catch(() => remember(null)).finally(() => setRestoring(false));
  }, []);

  // look up this premise's outage(s) so they can be drawn on the map next to the house
  useEffect(() => {
    setOutages([]);
    setRisk(null);
    if (!premise) return;
    const ctl = new AbortController();
    fetch(`/api/premises/${encodeURIComponent(premise.pid)}/status${includeRepaired ? '?includeRepaired=1' : ''}`, { signal: ctl.signal })
      .then(r => (r.ok ? r.json() : Promise.reject(r.status)))
            .then((s: { risk: MapRisk; damage: { damage: string; asset: string; repaired: boolean; coords: [number, number] }[] }) => {
        setRisk(s.risk);
        const seen = new Set<string>();
        setOutages(s.damage.filter(d => { const k = d.coords.map(c => c.toFixed(5)).join(','); return seen.has(k) ? false : (seen.add(k), true); })
          .map(d => ({ coords: d.coords, repaired: d.repaired, label: `${d.damage.replace('Damaged ', '')} · ${d.asset}${d.repaired ? ' (repaired)' : ''}` })));
      })
      .catch(e => { if (e?.name !== 'AbortError') setOutages([]); });
    return () => ctl.abort();
  }, [premise?.pid, includeRepaired]);

  const choose = (p: Premise | null) => { setPremise(p); remember(p); };

  return (
    <DebugContext.Provider value={{ showLocationIds }}>
    <div className="cl-shell">
    <SatelliteMap target={premise?.coords ? { coords: premise.coords, address: premise.address } : null} outages={outages} risk={risk} />
    <div className="cl">
      <header className="cl-top">
        <a className="cl-brand" href="/client.html" aria-label="GridGuide home">
          <span className="cl-logo"><Zap size={20} fill="currentColor" /></span>
          <span>GridGuide</span>
        </a>
        {premise ? (
          <button className="cl-premise" onClick={() => choose(null)} title="Choose a different premise">
            <Home size={14} /> <span className="cl-premise-text">{premise.address}</span> <Repeat size={13} />
          </button>
        ) : <span className="cl-live"><i /> Online</span>}
        <button className={`cl-icon${includeRepaired || showLocationIds ? ' cl-icon-on' : ''}`} aria-label="Debug options" aria-expanded={debugOpen} onClick={() => { setUpdatesOpen(false); setDebugOpen(o => !o); }}><Bug size={19} /></button>
        <button className={`cl-icon${subscribed ? ' cl-icon-ok' : ''}`} aria-label="Get outage updates" aria-expanded={updatesOpen} onClick={() => (updatesOpen ? setUpdatesOpen(false) : openUpdates())}><Bell size={20} /></button>
        {updatesOpen && (
          <UpdatesForm
            premise={premise} subscribed={subscribed} onChoose={choose} onClose={() => setUpdatesOpen(false)}
            onDone={() => { if (premise) { store(updatesKey(premise.pid), true); setSignedUp(s => [...s, premise.pid]); } }}
          />
        )}
        {debugOpen && (
          <div className="cl-debug" role="dialog" aria-label="Debug options">
            <h4>Debug</h4>
            <label>
              <input type="checkbox" checked={includeRepaired} onChange={e => toggleRepaired(e.target.checked)} />
              <span>Include already-repaired outages<small>Status and estimates also count damage reports marked repaired, so you can test with the storm data.</small></span>
            </label>
            <label>
              <input type="checkbox" checked={showLocationIds} onChange={e => toggleIds(e.target.checked)} />
              <span>Show location IDs<small>Adds the premise, transformer and device location IDs to the chat replies.</small></span>
            </label>
            {premise && <dl><div><dt>Premise ID</dt><dd>{premise.pid}</dd></div><div><dt>Location ID</dt><dd>{premise.locationId || '—'}</dd></div><div><dt>Circuit</dt><dd>{premise.circuit || '—'}</dd></div></dl>}
          </div>
        )}
      </header>

      <main className="cl-main">
        <div className="cl-thread" role="log" aria-label="Conversation">
          <div className="cl-day">Today</div>
          {restoring ? null : premise ? <Conversation premise={premise} includeRepaired={includeRepaired} subscribed={subscribed} openUpdates={openUpdates} sendRef={sendRef} onBusy={setSending} /> : <Welcome onChoose={choose} />}
        </div>
      </main>

      <footer className="cl-foot">
        <form className="cl-composer" onSubmit={e => { e.preventDefault(); submit(); }}>
          <textarea
            aria-label="Message" rows={1} disabled={!premise} value={draft} maxLength={1000}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); } }}
            placeholder={premise ? 'Ask a question…' : 'Enter your address to start'}
          />
          <button type="submit" className="cl-send" aria-label="Send message" disabled={!premise || sending || !draft.trim()}><ArrowUp size={19} /></button>
        </form>
        <p className="cl-fine">GridGuide gives general guidance and can’t dispatch crews. In an emergency, call 911.</p>
      </footer>
    </div>
    </div>
    </DebugContext.Provider>
  );
}

function Assistant({ children, time }: { children: React.ReactNode; time?: string }) {
  return (
    <div className="cl-row">
      <div className="cl-avatar"><Zap size={16} /></div>
      <div className="cl-col">
        <div className="cl-name">GridGuide</div>
        {children}
        {time && <div className="cl-time">{time}</div>}
      </div>
    </div>
  );
}

/** First thing the chat shows: ask where the customer is. */
function Welcome({ onChoose }: { onChoose: (p: Premise) => void }) {
  return (
    <Assistant>
      <div className="cl-bubble">
        <p>Hi, I’m GridGuide. I can check what’s affecting your power and share safety tips while you wait.</p>
        <p>First, what’s the address you’re contacting us about?</p>
      </div>
      <AddressPicker onChoose={onChoose} />
    </Assistant>
  );
}

/** Type an address, pick the match: the server resolves it to the premise. */
function AddressPicker({ onChoose, id = 'cl-addr-list' }: { onChoose: (p: Premise) => void; id?: string }) {
  const [query, setQuery] = useState('');
  const [matches, setMatches] = useState<Premise[] | null>(null);
  const [active, setActive] = useState(0);
  const [error, setError] = useState(false);
  const q = query.trim();

  useEffect(() => {
    setActive(0);
    if (q.length < 3) { setMatches(null); setError(false); return; }
    const ctl = new AbortController();
    const t = setTimeout(() => {
      fetch(`/api/premises/search?q=${encodeURIComponent(q)}`, { signal: ctl.signal })
        .then(r => (r.ok ? r.json() : Promise.reject(r.status)))
        .then(d => { setMatches(d.matches); setError(false); })
        .catch(e => { if (e?.name !== 'AbortError') setError(true); });
    }, 200);
    return () => { clearTimeout(t); ctl.abort(); };
  }, [q]);

  const onKey = (e: React.KeyboardEvent) => {
    if (!matches?.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(a + 1, matches.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(a - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); onChoose(matches[active]!); }
  };

  return (
    <div className="cl-picker">
      <label className="cl-field">
        <span>Service address</span>
        <div className="cl-search">
          <Search size={16} />
          <input
            value={query} onChange={e => setQuery(e.target.value)} onKeyDown={onKey} autoFocus autoComplete="off"
            placeholder="Start with your house number, e.g. 2347 Gardner"
            role="combobox" aria-expanded={!!matches?.length} aria-controls={id} aria-autocomplete="list"
          />
        </div>
      </label>
      {matches && matches.length > 0 && (
        <ul className="cl-results" id={id} role="listbox" aria-label="Matching addresses">
          {matches.map((m, i) => (
            <li key={m.pid} role="option" aria-selected={i === active}>
              <button className={i === active ? 'on' : ''} onMouseEnter={() => setActive(i)} onClick={() => onChoose(m)}>
                <MapPin size={15} />
                <span className="cl-addr">{m.address}</span>
                <span className="cl-meta">{SERVICE[m.service] ?? 'Service type unknown'}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {matches && !matches.length && <div className="cl-hint">No address matches “{q}”. Try the house number and street name only (no “Street” or “Ave”).</div>}
      {q.length > 0 && q.length < 3 && <div className="cl-hint">Keep typing…</div>}
      {error && <div className="cl-hint cl-err">Address lookup isn’t available right now. Please try again in a moment.</div>}
    </div>
  );
}

interface Status {
  transformerId: string;
  damage: { damage: string; asset: string; reported: string | null; repaired: boolean; circuitWide: boolean; locationId: string }[];
  restoration: { lowHours: number; highHours: number } | null;
  crew: 'reported' | 'assigned' | 'arrived' | 'underway' | null;
}
interface Chip { label: string; run: () => void }
interface Msg { id: number; role: 'bot' | 'me'; time: string; body: React.ReactNode; chips?: Chip[]; menu?: boolean; /** streamed LLM answer (markdown) */ md?: string }

/** Hide the model's reasoning if it leaks through: complete <think> blocks, and an unfinished one while it streams. */
const stripThink = (t: string) => t.replace(/<think>[\s\S]*?<\/think>/g, '').replace(/<think>[\s\S]*$/, '').trimStart();

const now = () => new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const plural = (n: number, w: string) => `${n.toLocaleString()} ${w}${n === 1 ? '' : 's'}`;

const TIPS = [
  'Treat every downed line as live. Stay at least 30 feet back and call 911.',
  'Keep refrigerator and freezer doors closed: a full freezer holds temperature about 48 hours, a fridge about 4.',
  'Unplug sensitive electronics and leave one lamp on so you’ll know when power returns.',
  'Never run a generator, grill or camp stove indoors or in a garage: carbon monoxide is deadly.',
  'Use flashlights, not candles. If anyone relies on medical equipment, call your provider or 911 right away.',
];

/** Plain-language progress timeline. "Reported" is a real date, crew progress is SIMULATED data, and the restoration window comes from the estimate. */
const CREW_ORDER = ['reported', 'assigned', 'arrived', 'underway'] as const;
function Timeline({ status }: { status: Status }) {
  const dates = status.damage.map(d => d.reported).filter((r): r is string => !!r).sort();
  const reported = dates[0] ? new Date(`${dates[0]}T12:00:00`).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) : 'Date not on file';
  const r = status.restoration;
  const at = (h: number) => new Date(Date.now() + h * 3600_000).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' });
  const cur = status.crew ? CREW_ORDER.indexOf(status.crew) : 0;
  const steps = [
    { name: 'Outage reported', when: reported },
    { name: 'Crew assigned', when: cur >= 1 ? 'Done' : 'Next' },
    { name: 'Crew arrived', when: cur >= 2 ? 'On site' : 'After assignment' },
    { name: 'Repairs under way', when: cur >= 3 ? (r ? `About ${r.lowHours === r.highHours ? r.lowHours : `${r.lowHours}–${r.highHours}`} h of work left` : 'In progress') : '' },
    { name: 'Power restored', when: r ? `${at(r.lowHours)} – ${at(r.highHours)}` : 'No estimate yet' },
  ];
  return (
    <ol className="cl-timeline" aria-label="Repair progress">
      {steps.map((s, i) => (
        <li key={s.name} className={i <= cur ? 'done' : i === cur + 1 ? 'now' : ''} aria-current={i === cur ? 'step' : undefined}>
          <strong>{s.name}</strong>
          {s.when && <span>{s.when}</span>}
        </li>
      ))}
    </ol>
  );
}

/** Offered under outage status replies: a nudge to sign up for updates, or a confirmation once they have. */
function UpdatesOffer({ subscribed, open }: { subscribed: boolean; open: () => void }) {
  return subscribed
    ? <p className="cl-offer ok"><Check size={14} /> You’re signed up for updates on this outage.</p>
    : <p className="cl-offer">Want a heads-up as this outage progresses? <button type="button" className="cl-link" onClick={open}>Get outage updates</button></p>;
}

/** Bell dropdown: sign up for updates about the outage at the customer's premise. Asks for the address only when none is chosen yet. */
function UpdatesForm({ premise, subscribed, onChoose, onClose, onDone }: { premise: Premise | null; subscribed: boolean; onChoose: (p: Premise) => void; onClose: () => void; onDone: () => void }) {
  const [contact, setContact] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'done'>(subscribed ? 'done' : 'idle');
  const [error, setError] = useState('');
  useEffect(() => { if (subscribed) setState('done'); }, [subscribed]);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!premise || !contact.trim()) return;
    setState('sending'); setError('');
    try {
      const res = await fetch(`/api/premises/${encodeURIComponent(premise.pid)}/updates`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ contact }) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Something went wrong. Please try again.');
      onDone(); setState('done');
    } catch (err) { setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.'); setState('idle'); }
  };
  return (
    <div className="cl-debug cl-updates" role="dialog" aria-label="Get outage updates">
      <div className="cl-updates-head"><h4>Outage updates</h4><button type="button" className="cl-link" onClick={onClose}>Close</button></div>
      {state === 'done' && premise ? (
        <p className="cl-updates-done"><Check size={16} /> You’re signed up for updates on the outage at <strong>{premise.address}</strong>.</p>
      ) : (
        <form onSubmit={submit}>
          {premise ? <p className="cl-updates-addr"><Home size={14} /> {premise.address}</p> : <AddressPicker onChoose={onChoose} id="cl-upd-addr-list" />}
          <label className="cl-field">
            <span>Email or mobile number</span>
            <input className="cl-text" value={contact} onChange={e => setContact(e.target.value)} autoComplete="email" inputMode="email" maxLength={254} placeholder="you@example.com or 540-555-0123" disabled={!premise} />
          </label>
          {error && <p className="cl-updates-err" role="alert">{error}</p>}
          <button type="submit" className="cl-submit" disabled={!premise || !contact.trim() || state === 'sending'}>{state === 'sending' ? 'Signing up…' : 'Send me updates'}</button>
          <small className="cl-updates-fine">Only used to tell you how this outage is progressing.</small>
        </form>
      )}
    </div>
  );
}

function Conversation({ premise, includeRepaired, subscribed, openUpdates, sendRef, onBusy }: { premise: Premise; includeRepaired: boolean; subscribed: boolean; openUpdates: () => void; sendRef: React.MutableRefObject<((text: string) => void) | null>; onBusy: (b: boolean) => void }) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [busy, setBusyState] = useState(false);
  const setBusy = (b: boolean) => { setBusyState(b); onBusy(b); };
  const turns = useRef<{ role: 'user' | 'assistant'; content: string }[]>([]); // free-text exchange sent to the model
  const end = React.useRef<HTMLDivElement>(null);
  const push = (m: Omit<Msg, 'id' | 'time'>) => setMsgs(prev => [...prev, { ...m, id: prev.length, time: now() }]);

  const MENU: Chip[] = [
    { label: 'Check my outage status', run: () => lookup('Check my outage status', statusReply) },
    { label: 'Safety tips', run: () => say('Safety tips', tipsReply()) },
    { label: 'When will power return?', run: () => lookup('When will power return?', etrReply) },
    ...(subscribed ? [] : [{ label: 'Get outage updates', run: openUpdates }]),
  ];
  const more = MENU;

  const say = (me: string, bot: React.ReactNode, chips: Chip[] = more) => { push({ role: 'me', body: me }); push({ role: 'bot', body: bot, chips }); };

  async function lookup(me: string, reply: (s: Status) => React.ReactNode) {
    push({ role: 'me', body: me });
    setBusy(true);
    try {
      const status = await getJson<Status>(`/api/premises/${encodeURIComponent(premise.pid)}/status${includeRepaired ? '?includeRepaired=1' : ''}`);
      push({ role: 'bot', body: reply(status), chips: more });
    } catch {
      push({ role: 'bot', body: <div className="cl-bubble"><p>Sorry, I couldn’t check that just now. Please try again in a moment. If this is an emergency, call 911.</p></div>, chips: more });
    } finally { setBusy(false); }
  }

  const statusReply = (s: Status) => (
    <>
      <div className="cl-bubble">
        <p>Here’s what I can see for <strong>{premise.address}</strong>:</p>
        <Ids block>Location ID <code>{premise.locationId || 'not on file'}</code>{s.transformerId && <> · served by transformer <code>{s.transformerId}</code></>}</Ids>
        {s.damage.length ? (
          <div className="cl-card">
            <div className="cl-card-head"><TriangleAlert size={16} /> {plural(s.damage.length, includeRepaired ? 'damage report' : 'open damage report')} affecting you</div>
            <dl>
              {s.damage.slice(0, 4).map((d, i) => (
                <div key={i}>
                  <dt>{d.damage.replace('Damaged ', '')} · {d.asset}{d.reported ? ` · reported ${d.reported}` : ''}{d.repaired ? ' · repaired' : ''}</dt>
                  <dd>{d.circuitWide ? 'Circuit-wide' : 'Upstream'}{d.locationId && <Ids><small className="cl-loc">Location ID {d.locationId}</small></Ids>}</dd>
                </div>
              ))}
            </dl>
            {s.damage.length > 4 && <div className="cl-more">+ {s.damage.length - 4} more</div>}
          </div>
        ) : <p>No open utility damage reports affect your service.</p>}
        {s.damage.length > 0 && <UpdatesOffer subscribed={subscribed} open={openUpdates} />}
      </div>
    </>
  );

  const etrReply = (s: Status) => (
    <div className="cl-bubble">
      {s.restoration ? (
        <>
          <p>There {s.damage.length === 1 ? `is 1 ${includeRepaired ? 'repair' : 'open repair'}` : `are ${s.damage.length} ${includeRepaired ? 'repairs' : 'open repairs'}`} affecting your service{includeRepaired && s.damage.some(d => d.repaired) ? ' (including ones already repaired, debug)' : ''}.</p>
          <p>Power may be restored in about <strong>{s.restoration.lowHours === s.restoration.highHours ? s.restoration.lowHours : `${s.restoration.lowHours}–${s.restoration.highHours}`} hours</strong> from now.</p>
          <Timeline status={s} />
          {s.crew && <p>Repair crew progress (simulated demo data): {s.crew}.</p>}
          <p>This is an estimate based on typical repair times for the damage, not a promise. Weather, access and crew availability can change it. Crew progress is simulated for this demo.</p>
          <UpdatesOffer subscribed={subscribed} open={openUpdates} />
        </>
      ) : (
        <>
          <p>I don’t have a repair estimate for your address because no open utility damage report is tied to it.</p>
        </>
      )}
    </div>
  );

  const tipsReply = () => (
    <>
      <div className="cl-bubble">
        <p>Here are the most important things to do while the power is out:</p>
        <ul className="cl-list">{TIPS.map(t => <li key={t}>{t}</li>)}</ul>
      </div>
      <div className="cl-note"><ShieldCheck size={14} /> In an emergency, call 911 first.</div>
    </>
  );

  /** Free-text question -> LLM answer, streamed into a new assistant message. */
  async function ask(text: string) {
    push({ role: 'me', body: text });
    turns.current.push({ role: 'user', content: text });
    setBusy(true);
    setMsgs(prev => [...prev, { id: prev.length, role: 'bot', time: now(), body: null, md: '' }]);
    const update = (md: string, chips?: Chip[]) => setMsgs(prev => prev.map((m, i) => (i === prev.length - 1 && m.md !== undefined ? { ...m, md, chips } : m)));
    let answer = '';
    try {
      const res = await fetch('/api/client-chat', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ pid: premise.pid, includeRepaired, subscribed, messages: turns.current }),
      });
      if (!res.ok || !res.body) throw new Error(String(res.status));
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        answer += dec.decode(value, { stream: true });
        update(stripThink(answer));
      }
      answer = stripThink(answer);
      if (!answer.trim()) throw new Error('empty');
      turns.current.push({ role: 'assistant', content: answer });
      update(answer, more);
    } catch {
      turns.current.pop(); // drop the unanswered question so the next try starts clean
      update('Sorry, I couldn’t get an answer just now. Please try again in a moment. If this is an emergency, call 911.', more);
    } finally { setBusy(false); }
  }
  sendRef.current = (t: string) => { void ask(t); };

  // opening message
  useEffect(() => {
    setMsgs([{
      id: 0, role: 'bot', time: now(), menu: true,
      body: (
        <>
          <div className="cl-bubble">
            <p>Thanks. I have you at <strong>{premise.address}</strong> ({(SERVICE[premise.service] ?? 'service type unknown').toLowerCase()}).</p>
            <Ids block>Location ID <code>{premise.locationId || 'not on file'}</code></Ids>
            <p>What can I help you with today?</p>
          </div>
          {premise.lifeSupport && <div className="cl-note cl-note-info"><ShieldCheck size={14} /> This premise is registered for life support. If your power is out and it’s urgent, call 911 first.</div>}
        </>
      ),
    }]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [premise.pid]);
  useEffect(() => { end.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [msgs.length, busy, msgs[msgs.length - 1]?.md?.length]);

  const last = msgs.length - 1;
  return (
    <>
      {msgs.map((m, i) => {
        if (m.md === '') return null; // answer hasn't started streaming: the typing dots stand in for it
        const chips = m.menu ? MENU : i === last ? m.chips : undefined;
        const body = m.role === 'me' ? <div className="cl-bubble">{m.body}</div> : m.md !== undefined ? (m.md ? <div className="cl-bubble cl-md"><ReactMarkdown remarkPlugins={[remarkGfm]}>{m.md}</ReactMarkdown></div> : null) : m.body;
        return m.role === 'me' ? (
          <div className="cl-row me" key={m.id}>
            <div className="cl-col">{body}<div className="cl-time">{m.time}</div></div>
            <div className="cl-avatar me"><Home size={16} /></div>
          </div>
        ) : (
          <Assistant key={m.id} time={m.time}>
            {body}
            {chips && <div className="cl-chips">{chips.map(c => <button key={c.label} className="cl-chip" disabled={busy} onClick={c.run}>{c.label}</button>)}</div>}
          </Assistant>
        );
      })}
      {busy && !msgs[last]?.md && (
        <div className="cl-row">
          <div className="cl-avatar"><Zap size={16} /></div>
          <div className="cl-col"><div className="cl-bubble cl-typing" aria-label="GridGuide is typing"><i /><i /><i /></div></div>
        </div>
      )}
      <div ref={end} />
    </>
  );
}
