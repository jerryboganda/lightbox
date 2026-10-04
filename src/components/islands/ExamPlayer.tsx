import { useCallback, useEffect, useRef, useState, type KeyboardEvent as RKE } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { ArrowLeft, ArrowRight, Check, CircleAlert, CloudOff, ExternalLink, Flag, Info, LayoutGrid, LoaderCircle, Send, Timer, X } from 'lucide-react';
import { navigate } from 'astro:transitions/client';
import { clock, host, PAPERS, urls, verdictBadge } from '../../lib/quiz';
import { toast } from '../../scripts/toast';

export type PlayerItem = { qid: string; paper: string; stem: string; options: [string, string][]; key?: string; keyEvidence?: string; myAnswer?: string; confidence?: string; reason?: string; verdict?: string; evidence?: string; note?: string; notBlind?: boolean; notBlindReason?: string };
export type Ans = { choice: string | null; flagged: boolean; correct: number | null };
interface Props { id: number; mode: 'quiz' | 'exam'; title: string; items: PlayerItem[]; answers: Record<string, Ans>; pos: number; deadline: number | null; startedAt: number; serverNow: number }

const LETTERS = 'ABCDEFGHI';
const ease = [0.16, 1, 0.3, 1] as const;
const EMPTY: Ans = { choice: null, flagged: false, correct: null };
type Clocked = { deadline: number | null; startedAt: number; serverNow: number };

// The clock lives in its own small components so a tick never re-renders the question.
function useNow(serverNow: number) {
  const [now, setNow] = useState(serverNow);
  useEffect(() => {
    const skew = serverNow - Date.now();
    const t = setInterval(() => setNow(Date.now() + skew), 250);
    return () => clearInterval(t);
  }, [serverNow]);
  return now;
}
const leftOf = (c: Clocked, now: number) => (c.deadline ? Math.max(0, Math.ceil((c.deadline - now) / 1000)) : null);
const stateOf = (left: number | null) => (left === null ? '' : left <= 60 ? 'crit' : left <= 300 ? 'warn' : '');

function Clock({ c, big }: { c: Clocked; big?: boolean }) {
  const now = useNow(c.serverNow), left = leftOf(c, now), st = stateOf(left);
  const text = left !== null ? clock(left) : clock((now - c.startedAt) / 1000);
  const label = left !== null ? 'Time left' : 'Time elapsed';
  if (!big) return <span className="xp-clock flex items-center gap-1.5 rounded-lg border border-line bg-panel px-2.5 py-1.5 text-sm" data-state={st} role="timer" aria-label={label}><Timer size={15} className="xp-tick" />{text}</span>;
  return (
    <>
      <div className="xp-clock mt-1 flex items-center gap-2 text-[2rem] leading-none" data-state={st} role="timer" aria-label={label}><Timer size={20} className="xp-tick text-muted" />{text}</div>
      {left !== null && c.deadline && (
        <div className="mt-3 h-1 overflow-hidden rounded-full bg-sunk" aria-hidden="true">
          <div className="h-full origin-left rounded-full transition-transform duration-300 ease-linear" style={{ transform: `scaleX(${left / Math.max(1, (c.deadline - c.startedAt) / 1000)})`, background: st === 'crit' ? 'var(--bad)' : st === 'warn' ? 'var(--signal)' : 'var(--accent)' }} />
        </div>
      )}
    </>
  );
}

// Screen-reader warnings at 5 and 1 minutes; submits at zero.
function Countdown({ c, onEnd }: { c: Clocked; onEnd: () => void }) {
  const left = leftOf(c, useNow(c.serverNow));
  const said = useRef(new Set<number>());
  const [live, setLive] = useState('');
  useEffect(() => {
    if (left === null) return;
    for (const [s, msg] of [[300, '5 minutes left.'], [60, '1 minute left.']] as const) if (left <= s && left > 0 && !said.current.has(s)) { said.current.add(s); setLive(msg); }
    if (left === 0 && !said.current.has(0)) { said.current.add(0); setLive('Time is up. Submitting your answers.'); onEnd(); }
  }, [left]);
  return <p className="sr-only" aria-live="assertive">{live}</p>;
}

export default function ExamPlayer(p: Props) {
  const practice = p.mode === 'quiz';
  const reduce = useReducedMotion();
  const N = p.items.length;
  const [i, setI] = useState(Math.max(0, Math.min(p.pos, N - 1)));
  const [dir, setDir] = useState(1);
  const [ans, setAns] = useState<Record<string, Ans>>(p.answers);
  const [pick, setPick] = useState<string | null>(null);
  const [err, setErr] = useState('');
  const [save, setSave] = useState<'saved' | 'saving' | 'offline'>('saved');
  const [submitting, setSubmitting] = useState(false);
  const shown = useRef(0);
  const queue = useRef<object[]>([]);
  const running = useRef<Promise<void> | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const sheet = useRef<HTMLDivElement>(null);
  const busy = useRef(false);
  const iRef = useRef(i);
  iRef.current = i;

  const q = p.items[i];
  const a = ans[q.qid] ?? EMPTY;
  const checked = practice && !!a.choice;
  const answered = p.items.filter((x) => ans[x.qid]?.choice).length;
  const flagged = p.items.filter((x) => ans[x.qid]?.flagged).length;

  // Time on question: counted while visible, sent with the next save for that item.
  const spent = () => { const t = performance.now(), d = shown.current ? t - shown.current : 0; shown.current = t; return Math.round(d); };

  const flush = useCallback((): Promise<void> => {
    running.current ??= (async () => {
      while (queue.current.length) {
        setSave('saving');
        try {
          const r = await fetch(`/api/exams/${p.id}/answer`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(queue.current[0]), keepalive: true });
          if (r.status >= 500) throw new Error(String(r.status));
          queue.current.shift();
          if (r.status === 409 && (await r.json()).finished) { queue.current = []; navigate(location.pathname, { history: 'replace' }); return; }
        } catch {
          setSave('offline');
          setTimeout(() => flush(), 4000);
          return;
        }
      }
      setSave('saved');
    })().finally(() => { running.current = null; });
    return running.current;
  }, [p.id]);
  const send = useCallback((body: object) => { queue.current.push({ ...body }); flush(); }, [flush]);

  useEffect(() => {
    shown.current = performance.now();
    const vis = () => { if (document.hidden) send({ item: p.items[iRef.current].qid, ms: spent() }); else shown.current = performance.now(); };
    const online = () => flush();
    document.addEventListener('visibilitychange', vis);
    window.addEventListener('online', online);
    return () => { document.removeEventListener('visibilitychange', vis); window.removeEventListener('online', online); };
  }, []);

  const go = useCallback((n: number) => {
    if (n < 0 || n >= N || n === iRef.current) return;
    send({ item: p.items[iRef.current].qid, ms: spent(), pos: n });
    setDir(n > iRef.current ? 1 : -1);
    setI(n); setPick(null); setErr('');
    sheet.current?.hidePopover?.();
  }, [N, send]);

  const choose = (l: string) => {
    setErr('');
    if (practice) { if (!checked) setPick(l); return; }
    setAns((s) => ({ ...s, [q.qid]: { ...a, choice: l } }));
    send({ item: q.qid, choice: l, ms: spent() });
  };
  const clear = () => { setAns((s) => ({ ...s, [q.qid]: { ...a, choice: null } })); send({ item: q.qid, choice: null }); };
  const check = () => {
    if (!pick) { setErr('Choose an option first.'); return; }
    const correct = q.key ? (pick === q.key ? 1 : 0) : null;
    setAns((s) => ({ ...s, [q.qid]: { ...a, choice: pick, correct } }));
    send({ item: q.qid, choice: pick, ms: spent() });
    if (correct === 1) navigator.vibrate?.(12); else if (correct === 0) navigator.vibrate?.([20, 40, 20]);
  };
  const flag = () => { const f = !a.flagged; setAns((s) => ({ ...s, [q.qid]: { ...a, flagged: f } })); send({ item: q.qid, flagged: f }); };

  const submit = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    setSubmitting(true);
    queue.current.push({ item: p.items[iRef.current].qid, ms: spent() });
    await flush();
    const r = await fetch(`/api/exams/${p.id}/finish`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }).catch(() => null);
    if (!r?.ok) { busy.current = false; setSubmitting(false); toast('Could not submit. Check your connection and try again.', 'bad'); return; }
    dialog.current?.close();
    navigate(location.pathname, { history: 'replace' });
  }, [flush, p.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (/input|select|textarea/i.test(t.tagName) || e.metaKey || e.ctrlKey || e.altKey || dialog.current?.open || submitting) return;
      const k = e.key.toUpperCase();
      const idx = /^[1-9]$/.test(k) ? Number(k) - 1 : k.length === 1 ? LETTERS.indexOf(k) : -1;
      if (idx >= 0 && idx < q.options.length && !checked) { e.preventDefault(); choose(q.options[idx][0]); }
      else if (k === 'F') flag();
      else if (e.key === 'Enter' && !t.closest('a, button:not([role=radio]), [popover]')) { e.preventDefault(); if (practice && !checked) check(); else go(i + 1); }
      else if (e.key === 'ArrowRight' && (checked || !t.closest('[role=radiogroup]'))) go(i + 1);
      else if (e.key === 'ArrowLeft' && (checked || !t.closest('[role=radiogroup]'))) go(i - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // Radio-group arrows move the choice, as native radios do.
  const roving = (e: RKE<HTMLDivElement>) => {
    if (checked || !['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'].includes(e.key)) return;
    e.preventDefault();
    const cur = practice ? pick : a.choice;
    const at = q.options.findIndex(([l]) => l === cur);
    const n = (at + (e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : -1) + q.options.length) % q.options.length;
    choose(q.options[n][0]);
    (e.currentTarget.children[n] as HTMLElement)?.focus();
  };

  const state = (l: string) => {
    if (!practice) return a.choice === l ? 'picked' : 'idle';
    if (!checked) return pick === l ? 'picked' : 'idle';
    if (q.key && l === q.key) return 'right';
    if (a.choice === l && q.key) return 'wrong';
    if (!q.key && l === q.myAnswer) return 'model';
    return a.choice === l ? 'picked' : 'dim';
  };
  const display = (orig?: string) => (orig ? LETTERS[q.options.findIndex(([l]) => l === orig)] ?? orig : '');
  const cellState = (x: PlayerItem) => { const s = ans[x.qid]; return !s?.choice ? '' : practice && s.correct === 1 ? 'right' : practice && s.correct === 0 ? 'wrong' : 'done'; };
  const cur = practice ? pick : a.choice;
  const verdict = verdictBadge(q.verdict ?? '', q.key ?? '');
  const focusIdx = Math.max(0, q.options.findIndex(([l]) => l === cur));

  const grid = (
    <>
      <div className="qgrid" role="list" aria-label="Questions">
        {p.items.map((x, n) => {
          const s = ans[x.qid];
          return (
            <span role="listitem" key={x.qid}>
              <button type="button" className="qcell w-full" data-s={cellState(x) || undefined} data-flag={s?.flagged ? '' : undefined} aria-current={n === i ? 'true' : undefined} onClick={() => go(n)}
                aria-label={`Question ${n + 1}${s?.choice ? ', answered' : ', not answered'}${s?.flagged ? ', flagged' : ''}`}>{n + 1}</button>
            </span>
          );
        })}
      </div>
      <p className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-faint">
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-[4px] border border-accent/40 bg-accent/15" />{practice ? 'Checked' : 'Answered'}</span>
        <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-signal" />Flagged</span>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-[4px] border border-line" />Open</span>
      </p>
    </>
  );
  const saveBadge = save === 'offline'
    ? <span className="flex items-center gap-1.5 text-xs text-signal" role="status"><CloudOff size={14} />Not saved yet, retrying</span>
    : <span className="flex items-center gap-1.5 text-xs text-faint">{save === 'saving' ? <LoaderCircle size={13} className="animate-spin" /> : <Check size={13} />}{save === 'saving' ? 'Saving' : 'Saved'}</span>;

  return (
    <div className="xp">
      {p.deadline && <Countdown c={p} onEnd={submit} />}
      <div className="min-w-0">
        <div className="xp-strip">
          <Clock c={p} />
          <span className="num text-sm text-muted"><span className="text-ink">{answered}</span>/{N}</span>
          <button type="button" className="btn btn-sm ml-auto" popoverTarget="xp-sheet" aria-label="Question navigator"><LayoutGrid size={15} /><span className="max-[380px]:hidden">Questions</span></button>
          <button type="button" className="btn btn-sm btn-primary" onClick={() => dialog.current?.showModal()}>{practice ? 'Finish' : 'Submit'}</button>
        </div>

        <div className="mt-1 flex items-center gap-3">
          <div className="h-1 flex-1 overflow-hidden rounded-full bg-sunk" aria-hidden="true">
            <motion.div className="h-full rounded-full bg-accent" initial={false} animate={{ width: `${(answered / N) * 100}%` }} transition={{ duration: 0.5, ease }} />
          </div>
          {saveBadge}
        </div>

        <AnimatePresence mode="wait" custom={dir} initial={false}>
          <motion.article key={q.qid} initial={{ opacity: 0, x: reduce ? 0 : 28 * dir }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: reduce ? 0 : -28 * dir }} transition={{ duration: 0.24, ease }} className="panel mt-4 p-5 sm:p-7" aria-labelledby="xp-stem">
            <div className="flex items-start gap-2">
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1 pt-1.5 text-xs text-muted">
                <span className="num">Question {i + 1} of {N}</span><span aria-hidden="true">·</span><span>{PAPERS[q.paper] ?? q.paper}</span><span className="num text-faint">{q.qid.split('-')[1]}</span>
                {practice && q.notBlind && <span className="badge s-neutral" title={q.notBlindReason}>Answer printed in source</span>}
              </div>
              <button type="button" className={`btn btn-sm shrink-0 ${a.flagged ? 'text-signal' : 'btn-ghost'}`} aria-pressed={a.flagged} onClick={flag} title="Flag for review (F)">
                <Flag size={14} fill={a.flagged ? 'currentColor' : 'none'} />{a.flagged ? 'Flagged' : 'Flag'}
              </button>
            </div>
            <h2 id="xp-stem" className="mt-3 text-[1.08rem] leading-relaxed [text-wrap:pretty] sm:text-[1.2rem]">{q.stem}</h2>
            <div className="mt-5 grid gap-2.5" role="radiogroup" aria-labelledby="xp-stem" onKeyDown={roving}>
              {q.options.map(([l, t], k) => {
                const s = state(l);
                return (
                  <motion.button layout="position" key={l} type="button" role="radio" aria-checked={cur === l} tabIndex={k === focusIdx ? 0 : -1} aria-disabled={checked || undefined}
                    onClick={() => !checked && choose(l)} className={`opt opt-${s}`}>
                    <span className="opt-key num">{LETTERS[k]}</span>
                    <span className="flex-1">{t}</span>
                    <AnimatePresence initial={false}>
                      {s === 'right' && <motion.span key="r" initial={{ scale: reduce ? 1 : 0.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: 'spring', stiffness: 500, damping: 22 }}><Check size={18} className="text-ok" aria-label="Correct answer" /></motion.span>}
                      {s === 'wrong' && <motion.span key="w" initial={{ scale: reduce ? 1 : 0.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: 'spring', stiffness: 500, damping: 22 }}><X size={18} className="text-bad" aria-label="Your answer, incorrect" /></motion.span>}
                    </AnimatePresence>
                    {!checked && <span className="kbd max-sm:hidden" aria-hidden="true">{k + 1}</span>}
                  </motion.button>
                );
              })}
            </div>
            {err && <p role="alert" className="mt-3 text-sm text-bad">{err}</p>}

            <AnimatePresence>
              {checked && (
                <motion.div initial={{ opacity: 0, y: reduce ? 0 : 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, ease, delay: 0.05 }} className="mt-6 space-y-3 rounded-xl border border-line bg-sunk p-4 text-sm" role="status">
                  <div className="flex flex-wrap items-center gap-2">
                    {q.key ? (a.choice === q.key ? <span className="font-medium text-ok">Correct.</span> : <span className="font-medium text-bad">The key says {display(q.key)}.</span>) : <span className="font-medium">No answer key in the source. Unscored.</span>}
                    {verdict && <span className={`badge ${verdict[0]}`}>{verdict[1]}</span>}
                  </div>
                  {q.verdict === 'DISPUTED' && <p className="flex gap-2 rounded-lg bg-bad/10 px-3 py-2 text-ink"><CircleAlert size={16} className="mt-0.5 shrink-0 text-bad" /><span>The key is disputed. {q.key ? <>The paper says {display(q.key)}</> : 'The paper gives no usable key'}{q.myAnswer ? <>; answered blind, Lightbox chose {display(q.myAnswer)}</> : ''}. Weigh both sides below.</span></p>}
                  {q.keyEvidence && <p className="text-muted"><span className="text-faint">Answer line in the source: </span>{q.keyEvidence}</p>}
                  {!q.key && q.myAnswer && <p className="text-muted"><span className="text-ink">Lightbox's blind answer, unverified: {display(q.myAnswer)}</span>{q.confidence && ` (${q.confidence} confidence)`}. {q.reason}</p>}
                  {q.key && q.myAnswer && q.myAnswer !== q.key && q.verdict !== 'DISPUTED' && <p className="flex gap-2 text-muted"><CircleAlert size={16} className="mt-0.5 shrink-0 text-signal" />Answered blind, Lightbox chose {display(q.myAnswer)}. {q.reason}</p>}
                  {q.note && <p className="text-muted">{q.note}</p>}
                  {urls(q.evidence ?? '').length > 0 && <div className="flex flex-wrap gap-2">{urls(q.evidence ?? '').map((u) => <a key={u} href={u} target="_blank" rel="noopener noreferrer" className="chip"><ExternalLink size={13} />{host(u)}</a>)}</div>}
                  {q.notBlind && <p className="flex gap-2 text-xs text-muted"><Info size={14} className="mt-0.5 shrink-0" />{q.notBlindReason}</p>}
                </motion.div>
              )}
            </AnimatePresence>

            <div className="mt-6 flex flex-wrap items-center gap-2">
              <button type="button" className="btn btn-ghost" onClick={() => go(i - 1)} disabled={i === 0} aria-label="Previous question"><ArrowLeft size={16} /><span className="max-sm:hidden">Previous</span></button>
              {!practice && a.choice && <button type="button" className="btn btn-ghost btn-sm text-muted" onClick={clear}>Clear choice</button>}
              <span className="ml-auto" />
              {practice && !checked
                ? <button type="button" className="btn btn-primary" onClick={check}>Check answer</button>
                : i < N - 1
                  ? <button type="button" className={`btn ${practice || a.choice ? 'btn-primary' : ''}`} onClick={() => go(i + 1)}>{a.choice || practice ? 'Next' : 'Skip'}<ArrowRight size={16} /></button>
                  : <button type="button" className="btn btn-primary" onClick={() => dialog.current?.showModal()}><Send size={15} />{practice ? 'Finish' : 'Submit'}</button>}
            </div>
          </motion.article>
        </AnimatePresence>
        <p className="mt-4 text-center text-xs text-faint max-sm:hidden">
          <span className="kbd">1</span>–<span className="kbd">{Math.min(9, q.options.length)}</span> choose · <span className="kbd">Enter</span> {practice ? 'check, then next' : 'next'} · <span className="kbd">←</span><span className="kbd">→</span> move · <span className="kbd">F</span> flag
        </p>
      </div>

      <aside className="xp-side" aria-label="Session">
        <section className="panel p-4">
          <div className="flex items-center justify-between text-xs text-muted"><span>{p.deadline ? 'Time left' : 'Time elapsed'}</span><span className={`badge ${practice ? 's-agreed' : 's-unchecked'}`}>{practice ? 'Practice' : 'Exam'}</span></div>
          <Clock c={p} big />
          <p className="mt-3 text-xs text-muted"><span className="num text-ink">{answered}</span> of <span className="num">{N}</span> answered{flagged ? <> · <span className="num text-signal">{flagged}</span> flagged</> : ''}</p>
        </section>
        <section className="panel p-4">
          <h2 className="mb-3 text-xs font-medium text-muted">Questions</h2>
          {grid}
        </section>
        <button type="button" className="btn btn-primary w-full justify-center" onClick={() => dialog.current?.showModal()}><Send size={15} />{practice ? 'Finish session' : 'Submit exam'}</button>
      </aside>

      <div id="xp-sheet" ref={sheet} popover="auto" className="xp-sheet panel">
        <div className="mb-3 flex items-center justify-between"><h2 className="text-sm font-medium">Questions</h2><span className="num text-xs text-muted">{answered}/{N} answered</span></div>
        {grid}
      </div>

      <dialog ref={dialog} className="xp-dialog panel" aria-labelledby="xp-dlg-h">
        <h2 id="xp-dlg-h" className="text-lg font-medium">{practice ? 'Finish this session?' : 'Submit your exam?'}</h2>
        <p className="mt-2 text-sm text-muted">You answered <span className="num text-ink">{answered}</span> of <span className="num">{N}</span>.{N - answered > 0 && <> <span className="num text-ink">{N - answered}</span> unanswered{!practice && ' will count as not correct'}.</>}{flagged > 0 && <> <span className="num text-signal">{flagged}</span> flagged.</>}</p>
        {[['Unanswered', p.items.map((x, n) => [x, n] as const).filter(([x]) => !ans[x.qid]?.choice)], ['Flagged', p.items.map((x, n) => [x, n] as const).filter(([x]) => ans[x.qid]?.flagged)]].map(([label, list]) => (list as (readonly [PlayerItem, number])[]).length > 0 && (
          <div key={label as string} className="mt-4">
            <h3 className="text-xs text-muted">{label as string}</h3>
            <div className="mt-1.5 flex flex-wrap gap-1.5">{(list as (readonly [PlayerItem, number])[]).slice(0, 40).map(([x, n]) => <button key={x.qid} type="button" className="qcell w-9" onClick={() => { dialog.current?.close(); go(n); }} aria-label={`Go to question ${n + 1}`}>{n + 1}</button>)}</div>
          </div>
        ))}
        <div className="mt-6 flex justify-end gap-2">
          <button type="button" className="btn btn-ghost" onClick={() => dialog.current?.close()}>Keep working</button>
          <button type="button" className="btn btn-primary" onClick={submit} disabled={submitting}>{submitting ? <LoaderCircle size={15} className="animate-spin" /> : <Send size={15} />}{practice ? 'Finish' : 'Submit now'}</button>
        </div>
      </dialog>
    </div>
  );
}
