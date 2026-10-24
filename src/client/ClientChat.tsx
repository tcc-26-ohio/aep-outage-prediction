import React, { useEffect, useState } from 'react';
import { ArrowUp, Bug, CircleHelp, Home, MapPin, Repeat, Search, ShieldCheck, TriangleAlert, Zap } from 'lucide-react';
import './client.css';

// The only behaviour on this page is finding which premise the customer is from their address (matched on the server:
// GET /api/premises/search). The conversation itself is a static sample and the composer is inert: nothing is sent or answered.

interface Premise { pid: string; address: string; service: string; customers: number; lifeSupport: boolean; circuit: string; locationId: string }

const STORAGE_KEY = 'gridguide.premise';
const DEBUG_KEY = 'gridguide.debug.includeRepaired';
const DEBUG_IDS_KEY = 'gridguide.debug.showLocationIds';

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
  const [debugOpen, setDebugOpen] = useState(false);
  const [includeRepaired, setIncludeRepaired] = useState(() => stored(DEBUG_KEY));
  const [showLocationIds, setShowLocationIds] = useState(() => stored(DEBUG_IDS_KEY));
  const toggleRepaired = (on: boolean) => { setIncludeRepaired(on); store(DEBUG_KEY, on); };
  const toggleIds = (on: boolean) => { setShowLocationIds(on); store(DEBUG_IDS_KEY, on); };

  // restore the premise chosen last time, if it still exists
  useEffect(() => {
    const pid = remembered();
    if (!pid) { setRestoring(false); return; }
    getJson<Premise>(`/api/premises/${encodeURIComponent(pid)}`).then(setPremise).catch(() => remember(null)).finally(() => setRestoring(false));
  }, []);

  const choose = (p: Premise | null) => { setPremise(p); remember(p); };

  return (
    <DebugContext.Provider value={{ showLocationIds }}>
    <div className="cl">
      <header className="cl-top">
        <a className="cl-brand" href="/client.html" aria-label="GridGuide home">
          <span className="cl-logo"><Zap size={20} fill="currentColor" /></span>
          <span>GridGuide</span>
        </a>
        {premise ? (
          <button className="cl-premise" onClick={() => choose(null)} title="Choose a different premise">
            <Home size={14} /> {premise.address} <Repeat size={13} />
          </button>
        ) : <span className="cl-live"><i /> Assistant online</span>}
        <button className={`cl-icon${includeRepaired || showLocationIds ? ' cl-icon-on' : ''}`} aria-label="Debug options" aria-expanded={debugOpen} onClick={() => setDebugOpen(o => !o)}><Bug size={19} /></button>
        <button className="cl-icon" aria-label="Help and information"><CircleHelp size={20} /></button>
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
          {restoring ? null : premise ? <Conversation premise={premise} includeRepaired={includeRepaired} /> : <Welcome onChoose={choose} />}
        </div>
      </main>

      <footer className="cl-foot">
        <form className="cl-composer" onSubmit={e => e.preventDefault()}>
          <textarea aria-label="Message" rows={1} disabled={!premise} placeholder={premise ? 'Describe the problem or ask a question…' : 'Enter your address above to start chatting'} />
          <button type="submit" className="cl-send" aria-label="Send message" disabled={!premise}><ArrowUp size={19} /></button>
        </form>
        <p className="cl-fine">GridGuide gives general guidance and can’t dispatch crews. In an emergency, call 911.</p>
      </footer>
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
function AddressPicker({ onChoose }: { onChoose: (p: Premise) => void }) {
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
            role="combobox" aria-expanded={!!matches?.length} aria-controls="cl-addr-list" aria-autocomplete="list"
          />
        </div>
      </label>
      {matches && matches.length > 0 && (
        <ul className="cl-results" id="cl-addr-list" role="listbox" aria-label="Matching addresses">
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
}
interface Chip { label: string; run: () => void }
interface Msg { id: number; role: 'bot' | 'me'; time: string; body: React.ReactNode; chips?: Chip[]; menu?: boolean }

const now = () => new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const plural = (n: number, w: string) => `${n.toLocaleString()} ${w}${n === 1 ? '' : 's'}`;

const TIPS = [
  'Treat every downed line as live. Stay at least 30 feet back and call 911.',
  'Keep refrigerator and freezer doors closed: a full freezer holds temperature about 48 hours, a fridge about 4.',
  'Unplug sensitive electronics and leave one lamp on so you’ll know when power returns.',
  'Never run a generator, grill or camp stove indoors or in a garage: carbon monoxide is deadly.',
  'Use flashlights, not candles. If anyone relies on medical equipment, call your provider or 911 right away.',
];

function Conversation({ premise, includeRepaired }: { premise: Premise; includeRepaired: boolean }) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [busy, setBusy] = useState(false);
  const end = React.useRef<HTMLDivElement>(null);
  const push = (m: Omit<Msg, 'id' | 'time'>) => setMsgs(prev => [...prev, { ...m, id: prev.length, time: now() }]);

  const MENU: Chip[] = [
    { label: 'Check my outage status', run: () => lookup('Check my outage status', statusReply) },
    { label: 'Safety tips', run: () => say('Safety tips', tipsReply()) },
    { label: 'When will power return?', run: () => lookup('When will power return?', etrReply) },
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
      </div>
    </>
  );

  const etrReply = (s: Status) => (
    <div className="cl-bubble">
      {s.restoration ? (
        <>
          <p>There {s.damage.length === 1 ? `is 1 ${includeRepaired ? 'repair' : 'open repair'}` : `are ${s.damage.length} ${includeRepaired ? 'repairs' : 'open repairs'}`} affecting your service{includeRepaired && s.damage.some(d => d.repaired) ? ' (including ones already repaired, debug)' : ''}.</p>
          <p>Power may be restored in about <strong>{s.restoration.lowHours === s.restoration.highHours ? s.restoration.lowHours : `${s.restoration.lowHours}–${s.restoration.highHours}`} hours</strong> from now.</p>
          <p>This is an estimate, not a promise. Weather, access and crew availability can change it.</p>
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
  useEffect(() => { end.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [msgs.length, busy]);

  const last = msgs.length - 1;
  return (
    <>
      {msgs.map((m, i) => {
        const chips = m.menu ? MENU : i === last ? m.chips : undefined;
        const body = m.role === 'me' ? <div className="cl-bubble">{m.body}</div> : m.body;
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
      {busy && (
        <div className="cl-row">
          <div className="cl-avatar"><Zap size={16} /></div>
          <div className="cl-col"><div className="cl-bubble cl-typing" aria-label="GridGuide is typing"><i /><i /><i /></div></div>
        </div>
      )}
      <div ref={end} />
    </>
  );
}
