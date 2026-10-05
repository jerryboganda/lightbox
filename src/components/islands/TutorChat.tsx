// The AI tutor: saved chats, streamed answers grounded on Lightbox facts with citation chips. Page: /tutor (client:load).
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowUp, ArrowUpRight, BookOpenText, Check, Copy, PanelLeft, Pencil, RotateCcw, Sparkles, Square, SquarePen, Trash2, X } from 'lucide-react';
import { toast } from '../../scripts/toast';
import { reduced } from '../../scripts/motion';
import { AiState, AiText, Thinking, left, streamAi, useReveal, type CiteInfo, type Quota } from './AiText';

export interface TopicRef { slug: string; title: string; href: string }
export interface ChatRow { id: number; title: string; topic: TopicRef | null; updatedAt: number }
export interface SavedMsg { id: number; role: 'user' | 'assistant'; content: string; cites: CiteInfo[] }
export interface TutorChatProps {
  enabled: boolean; quota: Quota; chats: ChatRow[]; active: number | null; messages: SavedMsg[];
  topic: TopicRef | null; starters: { topic: string[]; general: string[]; weak: boolean };
}
interface Msg { key: string; role: 'user' | 'assistant'; content: string; cites: CiteInfo[] | null; fresh?: boolean; stopped?: boolean; phase?: 'wait' | 'stream' | 'error'; error?: string; status?: number }

const MAX = 2000;
const EASE = [0.16, 1, 0.3, 1] as const;
const toMsg = (m: SavedMsg): Msg => ({ key: `s${m.id}`, role: m.role, content: m.content, cites: m.cites });
const ago = (t: number) => {
  const s = (Date.now() - t) / 1000;
  return s < 60 ? 'just now' : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86_400 ? `${Math.round(s / 3600)} h ago` : new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
};
const plain = (s: string) => s.replace(/\*\*/g, '');
let seq = 0;

function ChatList({ chats, active, onOpen, onRename, onDelete }: { chats: ChatRow[]; active: number | null; onOpen: (id: number) => void; onRename: (id: number, t: string) => void; onDelete: (id: number) => void }) {
  const [editing, setEditing] = useState<number | null>(null);
  const [armed, setArmed] = useState<number | null>(null);
  useEffect(() => { if (armed === null) return; const t = setTimeout(() => setArmed(null), 4000); return () => clearTimeout(t); }, [armed]);
  if (!chats.length) return <p className="px-2 py-3 text-sm text-muted">Your chats will appear here.</p>;
  return (
    <ul className="tc-list">
      <AnimatePresence initial={false}>
        {chats.map((c) => (
          <motion.li key={c.id} layout="position" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: -12 }} transition={{ duration: 0.22, ease: EASE }}
            className={`tc-item${c.id === active ? ' on' : ''}`}>
            {editing === c.id ? (
              <form className="flex min-w-0 flex-1 items-center gap-1 p-1" onSubmit={(e) => { e.preventDefault(); const v = String(new FormData(e.currentTarget).get('t') ?? '').trim(); if (v) onRename(c.id, v); setEditing(null); }}>
                <input name="t" defaultValue={c.title} maxLength={80} autoFocus aria-label="Chat title" className="field !h-8 !px-2 text-sm" onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setEditing(null); } }} />
                <button type="submit" className="btn btn-sm btn-ghost !px-1.5" aria-label="Save title"><Check size={15} aria-hidden="true" /></button>
              </form>
            ) : (
              <>
                <button type="button" className="tc-open" onClick={() => onOpen(c.id)} aria-current={c.id === active ? 'true' : undefined}>
                  <span className="block truncate text-sm">{c.title}</span>
                  <span className="mt-0.5 flex items-center gap-1.5 truncate text-xs text-muted">{c.topic && <BookOpenText size={12} className="shrink-0 text-accent" aria-hidden="true" />}{c.topic ? `${c.topic.title} · ` : ''}{ago(c.updatedAt)}</span>
                </button>
                <span className="tc-acts">
                  <button type="button" className="tc-ib" onClick={() => setEditing(c.id)} aria-label={`Rename chat: ${c.title}`}><Pencil size={14} aria-hidden="true" /></button>
                  <button type="button" className={`tc-ib${armed === c.id ? ' is-armed' : ''}`} onClick={() => (armed === c.id ? (setArmed(null), onDelete(c.id)) : setArmed(c.id))} aria-label={armed === c.id ? `Confirm: delete chat ${c.title}` : `Delete chat: ${c.title}`}>
                    <Trash2 size={14} aria-hidden="true" />
                  </button>
                </span>
              </>
            )}
          </motion.li>
        ))}
      </AnimatePresence>
    </ul>
  );
}

function Message({ m, last, onRetry }: { m: Msg; last: boolean; onRetry: () => void }) {
  const shown = useReveal(m.content, !!m.fresh);
  const live = m.phase === 'wait' || m.phase === 'stream';
  const revealing = shown.length < m.content.length;
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(plain(m.content)); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { toast('Could not copy', 'bad'); }
  };
  if (m.role === 'user') {
    return (
      <motion.li className="tc-msg is-user" initial={m.fresh ? { opacity: 0, y: 8, scale: 0.98 } : false} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ duration: 0.26, ease: EASE }}>
        <h3 className="sr-only">You</h3>
        <p className="tc-bubble">{m.content}</p>
      </motion.li>
    );
  }
  const n = m.cites?.length ?? 0;
  return (
    <motion.li className="tc-msg is-ai" initial={m.fresh ? { opacity: 0, y: 8 } : false} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.28, ease: EASE }}>
      <span className={`tc-av${live ? ' is-live' : ''}`} aria-hidden="true"><Sparkles size={15} /></span>
      <div className="min-w-0 flex-1">
        <h3 className="flex flex-wrap items-baseline gap-x-2 text-sm"><span className="font-medium">Tutor</span><span className="ai-note">AI · from Lightbox facts</span></h3>
        <div className="mt-1.5" aria-busy={live || revealing}>
          {m.phase === 'wait' && <Thinking label="Searching your notes…" />}
          {m.content && <AiText text={shown} cites={live ? null : m.cites} caret={live || revealing} />}
          {m.phase === 'error' && <div className={m.content ? 'mt-3' : ''}><AiState status={m.status} error={m.error} onRetry={last ? onRetry : undefined} /></div>}
        </div>
        {!live && !revealing && m.phase !== 'error' && m.content && (
          <div className="tc-foot">
            <span className="ai-note">{m.stopped ? 'Stopped · the answer is incomplete' : n ? `Grounded on ${n} cited fact${n === 1 ? '' : 's'}` : 'No Lightbox fact cited. Treat with care.'}</span>
            <span className="ml-auto flex items-center">
              <button type="button" className="tc-ib" onClick={copy} aria-label="Copy answer">{copied ? <Check size={14} className="text-ok" aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}</button>
              {last && <button type="button" className="tc-ib" onClick={onRetry} aria-label="Answer again"><RotateCcw size={14} aria-hidden="true" /></button>}
            </span>
          </div>
        )}
      </div>
    </motion.li>
  );
}

export default function TutorChat(p: TutorChatProps) {
  const [chats, setChats] = useState(p.chats);
  const [active, setActive] = useState(p.active);
  const [msgs, setMsgs] = useState<Msg[]>(p.messages.map(toMsg));
  const [draftTopic, setDraftTopic] = useState(p.active ? null : p.topic);
  const [quota, setQuota] = useState(p.quota);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [say, setSay] = useState('');
  const ta = useRef<HTMLTextAreaElement>(null);
  const sheet = useRef<HTMLDialogElement>(null);
  const ac = useRef<AbortController | null>(null);
  const near = useRef(true);
  const tid = useId();
  const chat = chats.find((c) => c.id === active);
  const topic = chat ? chat.topic : draftTopic;
  const starters = topic ? p.starters.topic : p.starters.general;

  useLayoutEffect(() => {
    const t = ta.current;
    if (!t) return;
    t.style.height = 'auto';
    t.style.height = `${Math.min(t.scrollHeight, 200)}px`;
  }, [text]);

  // Follow the answer while the reader is at the bottom; leave them alone if they scrolled up.
  useEffect(() => {
    const on = () => { near.current = innerHeight + scrollY >= document.documentElement.scrollHeight - 160; };
    addEventListener('scroll', on, { passive: true });
    return () => removeEventListener('scroll', on);
  }, []);
  useEffect(() => {
    if (near.current && msgs.length) scrollTo({ top: document.documentElement.scrollHeight, behavior: busy || reduced() ? 'auto' : 'smooth' });
  }, [msgs, busy]);
  useEffect(() => () => ac.current?.abort(), []);

  const url = (id: number | null) => history.replaceState(history.state, '', id ? `/tutor?c=${id}` : draftTopic ? `/tutor?topic=${draftTopic.slug}` : '/tutor');
  const patchLast = (f: (m: Msg) => Msg) => setMsgs((l) => l.map((m, i) => (i === l.length - 1 ? f(m) : m)));

  const ask = async (q: string | null) => {
    if (busy || !p.enabled) return;
    let id = active;
    setBusy(true);
    if (!id) {
      const r = await fetch('/api/ai/chats', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(draftTopic ? { topic: draftTopic.slug } : { title: (q ?? '').slice(0, 80) }) }).catch(() => null);
      const j = await r?.json().catch(() => null);
      if (!r?.ok || !j?.id) { setBusy(false); toast(j?.error ?? 'Could not start a chat', 'bad'); return; }
      id = j.id as number;
      setChats((l) => [{ id: id!, title: draftTopic?.title ?? (q ?? '').slice(0, 80), topic: draftTopic, updatedAt: Date.now() }, ...l]);
      setActive(id);
      url(id);
    }
    near.current = true;
    if (q !== null) { setText(''); setMsgs((l) => [...l, { key: `u${++seq}`, role: 'user', content: q, cites: null, fresh: true }]); }
    else setMsgs((l) => (l[l.length - 1]?.role === 'assistant' ? l.slice(0, -1) : l));
    setMsgs((l) => [...l, { key: `a${++seq}`, role: 'assistant', content: '', cites: null, fresh: true, phase: 'wait' }]);
    setSay('Tutor is answering.');
    const c = (ac.current = new AbortController());
    let got = '';
    const r = await streamAi(`/api/ai/chats/${id}/messages`, q === null ? { retry: true } : { text: q }, (d) => { got += d; patchLast((m) => ({ ...m, content: got, phase: 'stream' })); }, c.signal);
    if (r.aborted) {
      patchLast((m) => (got ? { ...m, phase: undefined, stopped: true } : { ...m, phase: 'error', error: 'Stopped before the tutor answered.' }));
      setSay('Stopped.');
    } else if (r.error) {
      patchLast((m) => ({ ...m, phase: 'error', error: r.error, status: r.status }));
      setSay(r.error);
    } else {
      patchLast((m) => ({ ...m, phase: undefined, cites: r.done?.cites ?? [] }));
      if (r.done?.quota) setQuota(r.done.quota);
      setSay(`Tutor: ${plain(got)}`);
      setChats((l) => { const c0 = l.find((x) => x.id === id); return c0 ? [{ ...c0, updatedAt: Date.now() }, ...l.filter((x) => x !== c0)] : l; });
    }
    if (r.quota) setQuota(r.quota);
    setBusy(false);
    ta.current?.focus({ preventScroll: true });
  };
  const send = () => { const q = text.trim(); if (q) ask(q.slice(0, MAX)); };

  const open = async (id: number) => {
    sheet.current?.close();
    if (id === active || busy) return;
    const prev = active;
    setLoading(true);
    setActive(id);
    const j = await fetch(`/api/ai/chats/${id}`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    setLoading(false);
    if (!j) { setActive(prev); toast('Could not open that chat', 'bad'); return; }
    setMsgs((j.messages as SavedMsg[]).map(toMsg));
    url(id);
    near.current = true;
    requestAnimationFrame(() => scrollTo({ top: document.documentElement.scrollHeight }));
  };
  const newChat = () => {
    sheet.current?.close();
    if (busy) ac.current?.abort();
    setActive(null); setMsgs([]); setDraftTopic(null);
    history.replaceState(history.state, '', '/tutor');
    ta.current?.focus();
  };
  const rename = async (id: number, title: string) => {
    const prev = chats;
    setChats((l) => l.map((c) => (c.id === id ? { ...c, title } : c)));
    const r = await fetch(`/api/ai/chats/${id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title }) }).catch(() => null);
    if (!r?.ok) { setChats(prev); toast('Could not rename the chat', 'bad'); }
  };
  const remove = async (id: number) => {
    const r = await fetch(`/api/ai/chats/${id}`, { method: 'DELETE', headers: { 'content-type': 'application/json' } }).catch(() => null);
    if (!r?.ok) { toast('Could not delete the chat', 'bad'); return; }
    setChats((l) => l.filter((c) => c.id !== id));
    if (id === active) newChat();
    toast('Chat deleted', 'ok');
  };

  const list = <ChatList chats={chats} active={active} onOpen={open} onRename={rename} onDelete={remove} />;
  const remaining = left(quota) ?? 0;

  return (
    <div className="tc">
      <aside className="tc-side" aria-label="Chats">
        <button type="button" className="btn btn-primary w-full justify-center" onClick={newChat}><SquarePen size={16} aria-hidden="true" />New chat</button>
        <h2 className="tc-side-h">Recent</h2>
        {list}
        {p.enabled && <div className="tc-quota" title="Requests reset at midnight, Pakistan time">
          <span className="flex justify-between text-xs"><span className="text-muted">AI requests today</span><span className="num">{remaining}/{quota.cap} left</span></span>
          <span className="tc-meter" aria-hidden="true"><motion.span initial={false} animate={{ scaleX: quota.cap ? remaining / quota.cap : 0 }} transition={{ duration: 0.5, ease: EASE }} /></span>
        </div>}
      </aside>

      <section className="tc-main" aria-labelledby={tid}>
        <header className="tc-head">
          <button type="button" className="btn btn-sm btn-ghost !px-2 md:!hidden" onClick={() => sheet.current?.showModal()} aria-label="Your chats" aria-haspopup="dialog"><PanelLeft size={18} aria-hidden="true" /></button>
          <div className="min-w-0 flex-1">
            <h2 id={tid} className="truncate text-[0.95rem] font-medium">{chat?.title ?? 'New chat'}</h2>
            {topic && <a href={topic.href} className="tc-ctx"><BookOpenText size={12} aria-hidden="true" />Topic · {topic.title}</a>}
          </div>
          <button type="button" className="btn btn-sm btn-ghost !px-2 md:!hidden" onClick={newChat} aria-label="New chat"><SquarePen size={17} aria-hidden="true" /></button>
        </header>

        {loading ? (
          <div className="tc-log grid content-start gap-4 pt-6" aria-hidden="true"><span className="skeleton ml-auto h-10 w-2/3" /><span className="skeleton h-24 w-11/12" /><span className="skeleton ml-auto h-10 w-1/2" /></div>
        ) : msgs.length ? (
          <ol className="tc-log" aria-label="Conversation">
            {msgs.map((m, i) => <Message key={m.key} m={m} last={i === msgs.length - 1} onRetry={() => ask(null)} />)}
          </ol>
        ) : (
          <div className="tc-empty">
            <div className="tc-orb" aria-hidden="true"><span /><span /><Sparkles size={26} /></div>
            <h3 className="mt-5 text-lg font-medium">{topic ? `Ask about ${topic.title}` : 'Ask about anything in your notes'}</h3>
            <p className="mx-auto mt-1.5 max-w-[46ch] text-sm text-muted">Answers come only from Lightbox's verified facts, each cited with a link. If the notes don't cover it, the tutor says so.</p>
            {!p.enabled ? <div className="mx-auto mt-6 max-w-md text-left"><AiState status={503} /></div> : (
              <>
                {p.starters.weak && !topic && <p className="mt-6 text-xs font-medium uppercase tracking-wide text-muted">From your weak topics</p>}
                <ul className={`tc-starters ${p.starters.weak && !topic ? 'mt-2' : 'mt-6'}`}>
                  {starters.map((s, i) => (
                    <motion.li key={s} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, delay: 0.05 * i, ease: EASE }}>
                      <button type="button" className="tc-starter" onClick={() => ask(s)}><span>{s}</span><ArrowUpRight size={15} className="shrink-0 text-faint" aria-hidden="true" /></button>
                    </motion.li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}

        <form className="tc-composer" onSubmit={(e) => { e.preventDefault(); send(); }}>
          <div className={`tc-box${p.enabled ? '' : ' is-off'}`}>
            <label htmlFor={`${tid}-q`} className="sr-only">Ask the tutor</label>
            <textarea id={`${tid}-q`} ref={ta} rows={1} value={text} maxLength={MAX} disabled={!p.enabled}
              placeholder={p.enabled ? (topic ? `Ask about ${topic.title}…` : 'Ask about a sign, a classification, a next step…') : 'AI is not configured on this server'}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); if (!busy) send(); } }} />
            {busy ? (
              <motion.button type="button" whileTap={{ scale: 0.9 }} className="tc-send is-stop" onClick={() => ac.current?.abort()} aria-label="Stop answering"><Square size={14} fill="currentColor" aria-hidden="true" /></motion.button>
            ) : (
              <motion.button type="submit" whileTap={{ scale: 0.9 }} className="tc-send" disabled={!p.enabled || !text.trim()} aria-label="Send question"><ArrowUp size={18} aria-hidden="true" /></motion.button>
            )}
          </div>
          <p className="tc-hint">
            <span className="max-sm:hidden"><span className="kbd">Enter</span> to send · <span className="kbd">Shift</span>+<span className="kbd">Enter</span> for a new line</span>
            {p.enabled && <span className="num md:hidden" title="Resets at midnight, Pakistan time">{remaining}/{quota.cap} AI requests left</span>}
            {text.length > MAX - 300 && <span className={`num ml-auto ${text.length >= MAX ? 'text-bad' : 'text-signal'}`}>{text.length}/{MAX}</span>}
          </p>
        </form>
        <p className="sr-only" role="status" aria-live="polite">{say}</p>
      </section>

      <dialog ref={sheet} className="ai-dialog tc-sheet" aria-label="Your chats" onClick={(e) => { if (e.target === sheet.current) sheet.current.close(); }}>
        <div className="dh">
          <h2 className="flex-1 font-medium">Your chats</h2>
          <button type="button" className="btn btn-sm btn-ghost !px-2" onClick={() => sheet.current?.close()} aria-label="Close"><X size={17} aria-hidden="true" /></button>
        </div>
        <div className="db !gap-3">
          <button type="button" className="btn btn-primary w-full justify-center" onClick={newChat}><SquarePen size={16} aria-hidden="true" />New chat</button>
          {list}
          {p.enabled && <p className="num text-xs text-muted">{remaining}/{quota.cap} AI requests left today</p>}
        </div>
      </dialog>
    </div>
  );
}
