import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import { ArrowRight, ArrowUp, Check, ChevronRight, CircleHelp, HardHat, House, MessageSquare, Plus, ShieldCheck, Sparkles, Square, TriangleAlert, X, Zap } from 'lucide-react';
import './styles.css';

type Audience = 'users' | 'workers';

function Chat({ audience }: { audience: Audience }) {
  const worker = audience === 'workers';
  const [input, setInput] = useState('');
  const [help, setHelp] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);
  const [transport] = useState(() => new DefaultChatTransport({ api: '/api/chat', body: { audience } }));
  const { messages, sendMessage, status, error, stop, setMessages, clearError } = useChat({ transport });
  const busy = status === 'submitted' || status === 'streaming';
  useEffect(() => { bottom.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, status]);
  const prompts = worker ? [
    { icon: HardHat, title: 'Prepare for a response', description: 'Review a field readiness checklist', text: 'Help me prepare a general outage response checklist.' },
    { icon: ShieldCheck, title: 'Put safety first', description: 'Talk through safe response practices', text: 'What general safety precautions should utility workers keep in mind during an outage?' },
    { icon: MessageSquare, title: 'Keep customers informed', description: 'Draft a clear outage update', text: 'Help me draft an outage update for customers without making unverified claims.' },
  ] : [
    { icon: Zap, title: 'Could I be affected?', description: 'Learn about outage preparedness', text: 'How can I prepare in case my home is affected by an outage?' },
    { icon: TriangleAlert, title: 'Experiencing an outage?', description: 'Find out what to do next', text: 'My power is out. What should I do, and how can I report it to my utility?' },
    { icon: ShieldCheck, title: 'Stay safe & prepared', description: 'Get tips for you and your home', text: 'What are the most important safety tips during a power outage?' },
  ];
  function submit(text: string) {
    if (!text.trim() || busy) return;
    clearError();
    void sendMessage({ text: text.trim() });
    setInput('');
  }
  return <>
    <aside className="sidebar">
      <button className="new-chat" onClick={() => { void stop(); setMessages([]); clearError(); setInput(''); }}><Plus size={17} /> New conversation</button>
      <div className="sidebar-label">YOUR WORKSPACE</div>
      <div className="workspace-item"><MessageSquare size={17} /> {worker ? 'Worker assistant' : 'Outage assistant'} <span className="active-dot" /></div>
      <div className="sidebar-bottom"><div className="sidebar-tip"><div className="tip-icon"><Zap size={18} /></div><strong>A little preparation.<br />A lot of peace of mind.</strong><p>Helpful guidance, before and during an outage.</p></div><button className="help-button" onClick={() => setHelp(!help)}><CircleHelp size={17} /> Help & information <ChevronRight size={15} /></button></div>
    </aside>
    <main>
      <div className="section-heading"><span>{worker ? 'Worker assistant' : 'Outage assistant'}</span><span className="preview-badge">CHAT PREVIEW</span></div>
      <div className={`chat-scroll ${messages.length ? 'has-messages' : ''}`}>
        {messages.length === 0 ? <section className="welcome">
          <div className="welcome-icon"><Zap size={30} fill="currentColor" strokeWidth={1.5} /><span><Sparkles size={13} /></span></div>
          <div className="eyebrow">A LITTLE CLARITY WHEN IT MATTERS</div>
          <h1>{worker ? 'Ready to support your community.' : 'Here to help you stay connected.'}</h1>
          <p className="welcome-description">{worker ? 'Your partner for outage response guidance, safety practices, and clear communication.' : 'Questions about power outages? Get guidance, know your next steps, and feel a little more prepared.'}</p>
          <div className="prompt-grid">{prompts.map(({ icon: Icon, title, description, text }) => <button className="prompt-card" key={title} onClick={() => submit(text)}><Icon size={21} /><strong>{title}</strong><span>{description}</span><ArrowRight className="card-arrow" size={17} /></button>)}</div>
          <div className="welcome-note"><ShieldCheck size={15} /> Guidance you can use. Your safety comes first.</div>
        </section> : <section className="messages" aria-label="Conversation" aria-live="polite">{messages.map(message => <article key={message.id} className={`message ${message.role}`}><div className="message-avatar">{message.role === 'user' ? (worker ? <HardHat size={17} /> : <House size={17} />) : <Zap size={17} />}</div><div><div className="message-author">{message.role === 'user' ? 'You' : 'GridGuide'}</div>{message.parts.map((part, i) => part.type === 'text' ? <div className="message-text" key={i}>{part.text}</div> : null)}</div></article>)}{status === 'submitted' && <div className="thinking"><Sparkles size={16} /> Thinking…</div>}<div ref={bottom} /></section>}
      </div>
      <div className="composer-area">
        {error && <div className="error" role="alert">Chat couldn’t connect. Check your connection and the server’s Groq API key, then try again.<button onClick={() => { const last = [...messages].reverse().find(m => m.role === 'user'); const text = last?.parts.filter(p => p.type === 'text').map(p => p.text).join('\n'); if (text) submit(text); }}>Retry</button><button aria-label="Dismiss error" onClick={clearError}><X size={16} /></button></div>}
        <form className="composer" onSubmit={e => { e.preventDefault(); submit(input); }}><textarea aria-label="Message" placeholder={worker ? 'Ask about response, safety, or customer communication…' : 'Ask a question about outages, safety, or what to do next…'} value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(input); } }} rows={2} /><div className="composer-tools"><span><Sparkles size={14} /> {worker ? 'Worker' : 'Personal'} assistant</span>{busy ? <button type="button" className="send" aria-label="Stop response" onClick={() => void stop()}><Square size={16} /></button> : <button className="send" type="submit" disabled={!input.trim()} aria-label="Send message"><ArrowUp size={19} /></button>}</div></form>
        <p className="disclaimer">AI guidance only. Live outage checks and report submission aren’t available yet.</p>
      </div>
      <footer><span><span className="footer-dot" /> Built for a more resilient community</span><span>Powered by Groq <Zap size={12} /></span></footer>
    </main>
    {help && <div className="modal-backdrop" onClick={() => setHelp(false)}><section className="help-modal" role="dialog" aria-modal="true" aria-label="Help and information" onClick={e => e.stopPropagation()}><button className="close-modal" autoFocus aria-label="Close help" onClick={() => setHelp(false)}><X size={20} /></button><ShieldCheck size={28} /><h2>A guide, not a live outage service.</h2><p>GridGuide provides AI-generated general guidance. It cannot check your address, predict outages, submit reports, or dispatch crews.</p><p>Report outages directly to your utility. Stay away from downed power lines and contact emergency services if there is immediate danger.</p><button className="new-chat" onClick={() => setHelp(false)}><Check size={16} /> Got it</button></section></div>}
  </>;
}

function App() {
  const [audience, setAudience] = useState<Audience>('users');
  return <div className="app"><header className="topbar"><a className="brand" href="/" aria-label="GridGuide home"><span className="brand-icon"><Zap size={21} fill="currentColor" /></span>GridGuide<span className="brand-divider" /><span className="brand-subtitle">Outage intelligence</span></a><nav aria-label="Assistant interface">{(['users', 'workers'] as const).map(tab => <button key={tab} className={audience === tab ? 'selected' : ''} aria-pressed={audience === tab} onClick={() => setAudience(tab)}>{tab === 'users' ? <House size={16} /> : <HardHat size={16} />}{tab === 'users' ? 'Users' : 'Workers'}</button>)}</nav><div className="header-label"><span /> Here when you need us</div></header><div className="app-body">{(['users', 'workers'] as const).map(tab => <div className="interface" key={tab} hidden={audience !== tab}><Chat audience={tab} /></div>)}</div></div>;
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
