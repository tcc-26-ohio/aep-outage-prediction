import { useState } from "react";
import type { FormEvent } from "react";
import { getAssessment, subscribe } from "./api";
import type { Assessment } from "./api";

export function App() {
  const [premise, setPremise] = useState("DEMO-001");
  const [assessment, setAssessment] = useState<Assessment | null>(null);
  const [email, setEmail] = useState("");
  const [consent, setConsent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function assess(event: FormEvent) {
    event.preventDefault(); setLoading(true); setError(""); setNotice(""); setAssessment(null);
    try { setAssessment(await getAssessment(premise.trim())); }
    catch (error) { setError(error instanceof Error ? error.message : "Unable to load assessment."); }
    finally { setLoading(false); }
  }

  async function enroll(event: FormEvent) {
    event.preventDefault();
    if (!assessment) return;
    setSubmitting(true); setError(""); setNotice("");
    try { setNotice((await subscribe(assessment.premise, email, consent)).message); }
    catch (error) { setError(error instanceof Error ? error.message : "Unable to enroll."); }
    finally { setSubmitting(false); }
  }

  return <>
    <header className="nav"><a className="brand" href="/">ϟ <span>GridAhead</span></a><span className="nav-label">WEATHER READINESS / ROANOKE, VA</span><span className="pill">Prototype</span></header>
    <main>
      <section className="hero">
        <div><p className="eyebrow">A LITTLE NOTICE. A LOT MORE PREPARED.</p><h1>Stay ahead<br />of the storm.</h1><p className="intro">Understand your power risk, plan for what’s next, and get ready before severe weather arrives.</p></div>
        <aside className="weather"><span className="weather-icon" aria-hidden="true">☁</span><p className="eyebrow">DEMO WEATHER SCENARIO</p><h2>Strong winds ahead</h2><p>Illustrative gusts of 45–60 mph.<br />Not a current weather forecast.</p><div className="weather-footer">ROANOKE REGION <span>↗</span></div></aside>
      </section>

      <section className="lookup"><div><p className="eyebrow">YOUR POWER OUTLOOK</p><h2>Let’s check your connection.</h2><p>Use DEMO-001, DEMO-002, or DEMO-003. No real customer information needed.</p></div><form onSubmit={assess}><label htmlFor="premise">Demo premise ID</label><div className="input-row"><input id="premise" value={premise} onChange={e => setPremise(e.target.value)} required /><button disabled={loading}>{loading ? "Checking…" : "Check outlook →"}</button></div></form></section>

      {error && <p className="message error" role="alert">{error} Make sure the backend is running.</p>}
      {assessment ? <>
        <div className="section-heading"><div><p className="eyebrow">{assessment.location} · {assessment.circuit}</p><h2>Your readiness snapshot</h2></div><span className="pill">Demo assessment · not a live prediction</span></div>
        <div className="cards">
          <section className="card risk"><p className="eyebrow">01 / WILL I LOSE POWER?</p><span className="risk-badge">{assessment.risk} risk</span><h3>Be ready, not worried.</h3><p>Scenario window: {assessment.window}. An outage is possible, not certain.</p><ul>{assessment.drivers.map(driver => <li key={driver}>{driver}</li>)}</ul></section>
          <section className="card"><p className="eyebrow">02 / HOW LONG COULD IT TAKE?</p><h3>Plan for a range.</h3><p>{assessment.restoration}</p><small>Conditional planning guidance, not a restoration commitment.</small></section>
          <section className="card"><p className="eyebrow">03 / WHAT SHOULD I DO?</p><h3>A few things, today.</h3><ul className="checklist">{assessment.preparation.map(item => <li key={item}>{item}</li>)}</ul></section>
        </div>
        <section className="enrollment"><div><p className="eyebrow">04 / DO I QUALIFY FOR ALERTS?</p><h2>{assessment.eligible ? "You’re in the demo service area." : "This premise is not eligible."}</h2><p>Try alert enrollment. This prototype records your request locally; it does not verify email addresses or send messages.</p></div><form onSubmit={enroll}><label htmlFor="email">Email address</label><input id="email" type="email" value={email} onChange={e => setEmail(e.target.value)} required placeholder="you@example.com" /><label className="consent"><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} required />I consent to storing this email for demo alert enrollment.</label><button disabled={!assessment.eligible || submitting}>{submitting ? "Saving…" : "Save demo enrollment →"}</button></form></section>
        {notice && <p className="message" role="status">{notice}</p>}
      </> : <div className="empty"><span aria-hidden="true">↗</span><h2>A clearer outlook starts here.</h2><p>Check a demo premise to explore risk, restoration planning, and preparation.</p></div>}
      <footer>Built for preparedness, not certainty.<span>Demo data only · No live weather or notifications</span></footer>
    </main>
  </>;
}
