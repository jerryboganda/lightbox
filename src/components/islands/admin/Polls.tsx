// Class polls: create a custom poll, watch the results come in, close, reopen or delete.
import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { ArrowUpRight, BellRing, ChartBarBig, Lock, LockOpen, Plus, Trash2, Vote, X } from 'lucide-react';
import type { PollRow } from '../../../server/admin';
import { toast } from '../../../scripts/toast';
import { ago, api, bump, fail, full, plural, useConfirm } from './kit';

export interface AdminPollsProps { polls: PollRow[]; now: number }
const KEYS = 'ABCDEF';
const left = (t: number, now: number) => { const h = (t - now) / 3_600_000; return h < 1 ? 'Closes within the hour' : h < 48 ? `Closes in ${Math.round(h)} h` : `Closes in ${Math.round(h / 24)} days`; };

export default function AdminPolls({ polls: initial, now }: AdminPollsProps) {
  const reduce = useReducedMotion();
  const [polls, setPolls] = useState(initial);
  const [busy, setBusy] = useState<number | null>(null);
  const [confirm, confirmDialog] = useConfirm();
  const root = useRef<HTMLDivElement>(null);

  // Results stay live while the tab is open and visible.
  useEffect(() => {
    const tick = async () => {
      if (!root.current?.isConnected) return clearInterval(timer);
      if (document.visibilityState !== 'visible') return;
      const r = await api<{ polls: PollRow[] }>('/api/admin/polls', 'GET').catch(() => null);
      if (r) setPolls(r.polls);
    };
    const timer = window.setInterval(tick, 15_000);
    return () => clearInterval(timer);
  }, []);

  const swap = (p: PollRow) => setPolls((l) => l.map((x) => (x.id === p.id ? p : x)));
  async function setClosed(p: PollRow, closed: boolean) {
    setBusy(p.id);
    try {
      const r = await api<{ poll: PollRow }>(`/api/admin/polls/${p.id}`, 'PATCH', { closed });
      swap(r.poll);
      bump('polls', closed ? -1 : 1);
      toast(closed ? 'Poll closed. Results are final.' : 'Poll reopened.', 'ok');
    } catch (e) { fail(e); } finally { setBusy(null); }
  }
  async function remove(p: PollRow) {
    if (!(await confirm({ title: 'Delete this poll?', body: <>“{p.question}” and its {plural(p.voters, 'vote')} are removed for everyone.</>, confirm: 'Delete poll', danger: true }))) return;
    setBusy(p.id);
    try {
      await api(`/api/admin/polls/${p.id}`, 'DELETE');
      setPolls((l) => l.filter((x) => x.id !== p.id));
      if (!p.closed) bump('polls', -1);
      toast('Poll deleted.', 'ok');
    } catch (e) { fail(e); } finally { setBusy(null); }
  }

  return (
    <div className="adm-polls" ref={root}>
      <CreatePoll onCreated={(p) => { setPolls((l) => [p, ...l]); bump('polls', 1); }} />
      <section aria-labelledby="polls-h" className="min-w-0">
        <h2 id="polls-h" className="sr-only">All polls</h2>
        {polls.length ? (
          <ol className="plist">
            <AnimatePresence initial={false}>
              {polls.map((p) => {
                const top = Math.max(...p.options.map((o) => o.n));
                return (
                  <motion.li key={p.id} layout={reduce ? false : 'position'} initial={{ opacity: 0, y: reduce ? 0 : 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: reduce ? 1 : 0.98, transition: { duration: 0.18 } }}
                    transition={{ type: 'spring', stiffness: 360, damping: 32 }} className={`panel pcard${p.closed ? ' is-closed' : ''}`} data-poll={p.id} aria-labelledby={`p${p.id}-q`}>
                    <header className="pc-h">
                      {p.mcq ? <a href={p.mcq.href} className="badge s-edition hover:brightness-125">MCQ {p.mcq.qid}<ArrowUpRight size={11} aria-hidden="true" /></a> : <span className="badge s-agreed">Class poll</span>}
                      {p.closed ? <span className="badge s-neutral" data-state>Closed</span> : <span className="badge s-cited" data-state>Open</span>}
                      {!p.closed && p.closesAt && <span className="text-xs text-muted" title={full(p.closesAt)}>{left(p.closesAt, now)}</span>}
                      <span className="ml-auto flex items-center gap-1 text-xs text-muted"><Vote size={14} aria-hidden="true" /><span className="num" data-voters>{p.voters}</span> {p.voters === 1 ? 'voter' : 'voters'}</span>
                    </header>
                    <h3 id={`p${p.id}-q`} className="pc-q">{p.question}</h3>
                    <ol className="pbars" aria-label="Results">
                      {p.options.map((o) => {
                        const pct = p.voters ? Math.round((o.n / p.voters) * 100) : 0;
                        const lead = o.n > 0 && o.n === top;
                        return (
                          <li key={o.key} className={`pb${lead ? ' is-lead' : ''}`} aria-label={`${o.key}. ${o.label}: ${plural(o.n, 'vote')}, ${pct}%${p.mcq?.key === o.key ? '. Answer key' : ''}`}>
                            <div className="pb-row" aria-hidden="true">
                              <span className="pb-key num">{o.key}</span>
                              <span className="pb-label">{o.label}</span>
                              {p.mcq?.key === o.key && <span className="badge s-cited">key</span>}
                              <span className="pb-n num">{o.n}<span className="text-faint"> · {pct}%</span></span>
                            </div>
                            <div className="pb-track" aria-hidden="true">
                              <motion.span className="pb-fill" initial={false} animate={{ scaleX: pct / 100 }} transition={reduce ? { duration: 0 } : { type: 'spring', stiffness: 140, damping: 22 }} />
                            </div>
                          </li>
                        );
                      })}
                    </ol>
                    <footer className="pc-f">
                      <span className="text-xs text-faint">{p.creator ? `@${p.creator}` : 'Created automatically'} · <time dateTime={new Date(p.createdAt).toISOString()} title={full(p.createdAt)}>{ago(p.createdAt, now)}</time></span>
                      <span className="ml-auto flex gap-1">
                        <button type="button" className="btn btn-sm btn-ghost" disabled={busy === p.id} onClick={() => setClosed(p, !p.closed)}>{p.closed ? <><LockOpen size={15} aria-hidden="true" />Reopen</> : <><Lock size={15} aria-hidden="true" />Close</>}</button>
                        <button type="button" className="btn btn-sm btn-ghost !px-2 hover:text-bad" disabled={busy === p.id} onClick={() => remove(p)} aria-label={`Delete poll: ${p.question}`} title="Delete poll"><Trash2 size={15} aria-hidden="true" /></button>
                      </span>
                    </footer>
                  </motion.li>
                );
              })}
            </AnimatePresence>
          </ol>
        ) : (
          <div className="adm-clear panel">
            <span className="adm-ico"><ChartBarBig size={20} aria-hidden="true" /></span>
            <h3 className="mt-3 font-medium">No polls yet</h3>
            <p className="mt-1 max-w-sm text-sm text-muted">Ask the class anything: a mock exam date, which topic to revise next, or how a disputed MCQ should be keyed. Polls on disputed MCQs appear here too.</p>
          </div>
        )}
      </section>
      {confirmDialog}
    </div>
  );
}

function CreatePoll({ onCreated }: { onCreated: (p: PollRow) => void }) {
  const reduce = useReducedMotion();
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState(['', '']);
  const [ids, setIds] = useState([0, 1]);
  const [closes, setCloses] = useState('');
  const [announce, setAnnounce] = useState(true);
  const [busy, setBusy] = useState(false);
  const nextId = useRef(2);
  const list = useRef<HTMLOListElement>(null);

  const add = () => {
    if (options.length >= 6) return;
    setOptions([...options, '']); setIds([...ids, nextId.current++]);
    requestAnimationFrame(() => list.current?.querySelectorAll('input')[options.length]?.focus());
  };
  const del = (i: number) => { setOptions(options.filter((_, j) => j !== i)); setIds(ids.filter((_, j) => j !== i)); };

  async function submit(e: { preventDefault(): void }) {
    e.preventDefault();
    if (busy) return;
    const closesAt = closes ? new Date(closes).getTime() : null;
    setBusy(true);
    try {
      const r = await api<{ poll: PollRow }>('/api/admin/polls', 'POST', { question, options, closesAt, announce });
      onCreated(r.poll);
      setQuestion(''); setOptions(['', '']); setIds([nextId.current++, nextId.current++]); setCloses('');
      toast(announce ? 'Poll live. Everyone was notified.' : 'Poll live.', 'ok');
    } catch (err) { fail(err); } finally { setBusy(false); }
  }

  return (
    <form className="panel pnew" onSubmit={submit} aria-labelledby="pnew-h">
      <div className="flex items-center gap-2.5"><span className="adm-ico"><ChartBarBig size={18} aria-hidden="true" /></span><h2 id="pnew-h" className="font-medium">New poll</h2></div>
      <label className="mt-4 block text-sm font-medium" htmlFor="pq">Question</label>
      <textarea id="pq" className="lb-ta mt-1.5" rows={2} required maxLength={200} value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="When should we hold the next mock TOACS?" aria-describedby="pq-n" />
      <p id="pq-n" className="mt-1 text-right text-xs text-faint num">{question.length}/200</p>
      <fieldset className="mt-1">
        <legend className="text-sm font-medium">Options <span className="font-normal text-faint">2 to 6</span></legend>
        <ol className="popts" ref={list}>
          <AnimatePresence initial={false}>
            {options.map((o, i) => (
              <motion.li key={ids[i]} layout={reduce ? false : 'position'} initial={{ opacity: 0, x: reduce ? 0 : -8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, transition: { duration: 0.12 } }}>
                <span className="pb-key num" aria-hidden="true">{KEYS[i]}</span>
                <input className="field" required maxLength={100} value={o} aria-label={`Option ${KEYS[i]}`} placeholder={i < 2 ? ['e.g. Saturday morning', 'e.g. Sunday afternoon'][i] : `Option ${KEYS[i]}`}
                  onChange={(e) => setOptions(options.map((x, j) => (j === i ? e.target.value : x)))} />
                <button type="button" className="btn btn-sm btn-ghost !px-2" onClick={() => del(i)} disabled={options.length <= 2} aria-label={`Remove option ${KEYS[i]}`}><X size={15} aria-hidden="true" /></button>
              </motion.li>
            ))}
          </AnimatePresence>
        </ol>
        {options.length < 6 && <button type="button" className="btn btn-sm btn-ghost mt-1 -ml-1" onClick={add}><Plus size={15} aria-hidden="true" />Add option</button>}
      </fieldset>
      <label className="mt-3 block text-sm font-medium" htmlFor="pclose">Closes <span className="font-normal text-faint">(optional)</span></label>
      <input id="pclose" type="datetime-local" className="field mt-1.5" value={closes} onChange={(e) => setCloses(e.target.value)} />
      <label className="adm-check mt-3"><input type="checkbox" checked={announce} onChange={(e) => setAnnounce(e.target.checked)} /><BellRing size={15} aria-hidden="true" /><span>Notify everyone</span></label>
      <button className="btn btn-primary mt-4 w-full justify-center" disabled={busy}><Plus size={16} aria-hidden="true" />{busy ? 'Publishing…' : 'Publish poll'}</button>
    </form>
  );
}
