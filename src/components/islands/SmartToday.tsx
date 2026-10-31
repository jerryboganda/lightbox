import { useCallback, useEffect, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { navigate } from 'astro:transitions/client';
import { BookOpenText, Check, Images, Layers, LoaderCircle, Play, RotateCcw, Sparkles, Target, Undo2 } from 'lucide-react';
import type { Plan, Step } from '../../server/planner';

const ICON = { review: Layers, mistakes: RotateCcw, new: Sparkles, quiz: Target, read: BookOpenText, toacs: Images } as const;
const BUDGETS = [15, 30, 60];
const today = () => new Date(Date.now() + 5 * 3_600_000).toISOString().slice(0, 10);
const KEY = 'lb-plan-done';

function readDone(): Set<string> {
  try { const v = JSON.parse(localStorage.getItem(KEY) || '{}'); return new Set(v.day === today() ? v.ids : []); } catch { return new Set(); }
}
const saveDone = (s: Set<string>) => { try { localStorage.setItem(KEY, JSON.stringify({ day: today(), ids: [...s] })); } catch {} };

/** Home hero: pick a time budget, get an ordered plan where every step opens a ready session. */
export default function SmartToday({ initial }: { initial: Plan }) {
  const [plan, setPlan] = useState(initial);
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [done, setDone] = useState<Set<string>>(new Set());
  const reduce = useReducedMotion();
  useEffect(() => setDone(readDone()), []);

  const pick = useCallback(async (m: number) => {
    if (m === plan.minutes) return;
    setBusy('m' + m); setErr('');
    const r = await fetch(`/api/plan?m=${m}`).then((x) => (x.ok ? x.json() : null)).catch(() => null);
    setBusy('');
    if (r) setPlan(r); else setErr('Could not rebuild the plan. Check your connection.');
  }, [plan.minutes]);

  const toggle = (id: string, on?: boolean) => setDone((d) => { const n = new Set(d); (on ?? !n.has(id)) ? n.add(id) : n.delete(id); saveDone(n); return n; });

  const start = async (s: Step) => {
    setErr('');
    toggle(s.id, true);
    if (s.href) return navigate(s.href);
    if (s.start?.type === 'exam') {
      setBusy(s.id);
      const r = await fetch('/api/exams', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(s.start.body) }).then((x) => x.json()).catch(() => ({ error: 'Network error. Try again.' }));
      if (r.href) return navigate(r.href);
      setBusy(''); toggle(s.id, false); setErr(r.error || 'Could not start.');
    } else if (s.start?.type === 'toacs') {
      setBusy(s.id);
      const f = document.createElement('form');
      f.method = 'post'; f.action = '/api/toacs';
      for (const [k, v] of Object.entries(s.start.fields)) { const i = document.createElement('input'); i.type = 'hidden'; i.name = k; i.value = v; f.append(i); }
      document.body.append(f); f.submit();
    }
  };

  const left = plan.steps.filter((s) => !done.has(s.id));
  const next = left[0];
  return (
    <section className="panel overflow-hidden" aria-labelledby="plan-h">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
        <div className="min-w-0">
          <h2 id="plan-h" className="flex items-center gap-2 text-[0.95rem] font-medium"><Sparkles size={16} className="text-accent" aria-hidden="true" />Your plan for today</h2>
          <p className="mt-0.5 text-sm text-muted">
            {plan.focus ? <>Focus: <span className="text-ink">{plan.focus.label}</span> ({plan.focus.why})</> : 'Built from what is due and what you have not tried.'}
            {plan.examDays !== null && plan.examDays >= 0 && <> · <span className="text-signal">{plan.examDays === 0 ? 'exam today' : `${plan.examDays} days to the exam`}</span></>}
          </p>
        </div>
        <div className="seg" role="radiogroup" aria-label="Time you have today">
          {BUDGETS.map((m) => (
            <button key={m} type="button" role="radio" aria-checked={plan.minutes === m} onClick={() => pick(m)} disabled={!!busy}>
              {busy === 'm' + m ? <LoaderCircle size={14} className="animate-spin" /> : null}{m} min
            </button>
          ))}
        </div>
      </div>
      {plan.steps.length === 0 ? (
        <p className="px-5 py-6 text-sm text-muted">Nothing is due and every card is learned. Try a timed exam or the TOACS stations.</p>
      ) : (
        <ol className="divide-y divide-line">
          {plan.steps.map((s, i) => {
            const I = ICON[s.kind], ok = done.has(s.id), isNext = s === next;
            return (
              <motion.li key={plan.minutes + s.id} initial={reduce ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04, duration: 0.3 }}
                className={`flex items-center gap-3 px-5 py-3 ${ok ? 'opacity-60' : ''}`}>
                <button type="button" onClick={() => toggle(s.id)} className={`grid size-7 shrink-0 place-items-center rounded-full border ${ok ? 'border-ok bg-ok/15 text-ok' : 'border-line text-muted hover:border-accent'}`}
                  aria-pressed={ok} aria-label={ok ? `Mark "${s.title}" not done` : `Mark "${s.title}" done`}>{ok ? <Check size={15} /> : <I size={14} />}</button>
                <div className="min-w-0 flex-1">
                  <div className={`text-sm ${ok ? 'line-through' : ''}`}>{s.title}</div>
                  <div className="truncate text-xs text-faint">{s.detail}</div>
                </div>
                <span className="num shrink-0 text-xs text-muted">{s.minutes} min</span>
                {ok ? <button type="button" className="btn btn-sm btn-ghost" onClick={() => toggle(s.id, false)} aria-label={`Undo ${s.title}`}><Undo2 size={14} /></button>
                  : <button type="button" className={`btn btn-sm ${isNext ? 'btn-primary' : ''}`} onClick={() => start(s)} disabled={busy === s.id}>
                      {busy === s.id ? <LoaderCircle size={14} className="animate-spin" /> : <Play size={14} />}Start
                    </button>}
              </motion.li>
            );
          })}
        </ol>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-5 py-2.5 text-xs text-faint">
        <span>{left.length ? `About ${left.reduce((n, s) => n + s.minutes, 0)} min left · ${plan.steps.length - left.length} of ${plan.steps.length} done` : 'Plan complete. Anything more today is a bonus.'}</span>
        {err ? <span className="text-bad" role="alert">{err}</span> : <a href="/?setup=1" className="hover:text-accent">Change exam date, time or confidence</a>}
      </div>
    </section>
  );
}
