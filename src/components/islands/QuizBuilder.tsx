import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { animate, motion, useReducedMotion } from 'motion/react';
import { ArrowRight, BookOpenCheck, Clock3, FileText, LoaderCircle, Scale, Shuffle, Sparkles, Target, Zap } from 'lucide-react';
import { navigate } from 'astro:transitions/client';
import { HISTORIES, matcher, STATUSES, type Filters, type Mine, type PoolItem } from '../../lib/quiz';

interface Props { pool: PoolItem[]; mine: Mine; papers: [string, string][]; systems: [string, string][]; mode: 'quiz' | 'exam' }
type Body = { mode: 'quiz' | 'exam'; filters: Partial<Filters>; count: number; shuffle?: boolean; shuffleOptions?: boolean; timing?: 'per' | 'total'; perQuestion?: number; totalMinutes?: number; title?: string };
const ease = [0.16, 1, 0.3, 1] as const;
const NONE: Filters = { papers: [], systems: [], status: [], history: 'any' };

function Count({ n }: { n: number }) {
  const ref = useRef<HTMLSpanElement>(null), prev = useRef(n), reduce = useReducedMotion();
  useEffect(() => {
    const from = prev.current, el = ref.current;
    prev.current = n;
    if (!el || reduce || from === n) { if (el) el.textContent = String(n); return; }
    const c = animate(from, n, { duration: 0.45, ease, onUpdate: (v) => { el.textContent = String(Math.round(v)); } });
    return () => c.stop();
  }, [n, reduce]);
  return <span ref={ref}>{n}</span>;
}

const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

function Group({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <fieldset className="panel p-4 sm:p-5">
      <legend className="sr-only">{title}</legend>
      <div className="flex items-baseline justify-between gap-3"><h2 className="text-sm font-medium" aria-hidden="true">{title}</h2>{hint && <span className="text-xs text-muted">{hint}</span>}</div>
      <div className="mt-3 flex flex-wrap gap-2">{children}</div>
    </fieldset>
  );
}

export default function QuizBuilder(p: Props) {
  const [f, setF] = useState<Filters>(NONE);
  const [mode, setMode] = useState(p.mode);
  const [count, setCount] = useState(20);
  const [shuffle, setShuffle] = useState(true);
  const [shuffleOptions, setShuffleOptions] = useState(false);
  const [timing, setTiming] = useState<'per' | 'total'>('per');
  const [per, setPer] = useState(60);
  const [total, setTotal] = useState(30);
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');

  const count$ = (g: Partial<Filters>) => p.pool.filter(matcher({ ...f, ...g }, p.mine)).length;
  const list = useMemo(() => p.pool.filter(matcher(f, p.mine)), [f, p.pool, p.mine]);
  const avail = list.length;
  const min = Math.min(5, avail);
  const n = Math.max(min, Math.min(count, avail));
  const scored = list.filter((x) => x.keyed).length;
  const minutes = mode === 'exam' ? (timing === 'per' ? Math.ceil((per * n) / 60) : total) : 0;

  const presets = useMemo(() => {
    const c = (g: Partial<Filters>) => p.pool.filter(matcher({ ...NONE, ...g }, p.mine)).length;
    return [
      ...p.papers.map(([k, label]) => { const all = c({ papers: [k] }); return { key: k, icon: FileText, title: 'Full paper', sub: label, meta: `${all} questions · ${all} min`, timed: true, n: all, body: { mode: 'exam', filters: { papers: [k] }, count: all, perQuestion: 60, title: `Full paper · ${label}` } as Body }; }),
      { key: 'quick', icon: Zap, title: 'Quick 10', sub: 'Random keyed questions', meta: '10 questions · 10 min', timed: true, n: c({ status: ['keyed'] }), body: { mode: 'exam', filters: { status: ['keyed'] }, count: 10, perQuestion: 60, shuffle: true, shuffleOptions: true, title: 'Quick 10' } as Body },
      { key: 'weak', icon: Target, title: 'Weak spots', sub: 'Got wrong, bookmarked or marked weak', meta: '', timed: false, n: c({ history: 'weak' }), body: { mode: 'quiz', filters: { history: 'weak' }, count: 200, shuffle: true, title: 'Weak spots' } as Body },
      { key: 'disputed', icon: Scale, title: 'Disputed only', sub: 'Both sides of every disputed key', meta: '', timed: false, n: c({ status: ['disputed'] }), body: { mode: 'quiz', filters: { status: ['disputed'] }, count: 200, title: 'Disputed only' } as Body },
    ];
  }, [p.pool, p.mine, p.papers]);

  const start = async (key: string, body: Body) => {
    setBusy(key); setErr('');
    const r = await fetch('/api/exams', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((x) => x.json()).catch(() => ({ error: 'Network error. Try again.' }));
    if (r.href) return navigate(r.href);
    setBusy(''); setErr(r.error || 'Could not start.');
  };
  const custom = () => start('custom', { mode, filters: f, count: n, shuffle, shuffleOptions, timing, perQuestion: per, totalMinutes: total });

  const chip = (on: boolean, label: string, k: number, onClick: () => void, key: string) => (
    <button key={key} type="button" className="chip" aria-pressed={on} onClick={onClick} disabled={!on && k === 0}>{label}<span className="num text-xs text-muted">{k}</span></button>
  );
  const startLabel = mode === 'exam' ? `Start exam · ${minutes} min` : `Start practice · ${n}`;

  return (
    <div className="space-y-8">
      <section aria-labelledby="h-presets">
        <h2 id="h-presets" className="text-sm font-medium text-muted">One click</h2>
        <div className="presets mt-3">
          {presets.map((x, k) => (
            <button key={x.key} type="button" className="preset panel lift press reveal text-left" style={{ ['--i' as string]: k + 1 }} disabled={!x.n || !!busy} onClick={() => start(x.key, { ...x.body, count: Math.min(x.body.count, x.n) })} aria-describedby={`ps-${x.key}`}>
              <span className="flex items-center justify-between gap-2">
                <span className="preset-ic"><x.icon size={17} /></span>
                {busy === x.key ? <LoaderCircle size={16} className="animate-spin text-muted" /> : <span className={`badge ${x.timed ? 's-unchecked' : 's-agreed'}`}>{x.timed ? 'Timed' : 'Practice'}</span>}
              </span>
              <span className="mt-3 block font-medium">{x.title}</span>
              <span id={`ps-${x.key}`} className="mt-0.5 block text-sm text-muted">{x.sub}<span className="mt-1 block num text-xs text-muted">{x.n ? x.meta || `${x.n} question${x.n === 1 ? '' : 's'}` : 'Nothing here yet'}</span></span>
            </button>
          ))}
        </div>
      </section>

      <section aria-labelledby="h-custom" className="builder">
        <div className="space-y-3">
          <h2 id="h-custom" className="text-sm font-medium text-muted">Or build your own</h2>
          <Group title="Paper" hint="none selected means all">
            {p.papers.map(([k, l]) => chip(f.papers.includes(k), l, count$({ papers: [k] }), () => setF({ ...f, papers: toggle(f.papers, k) }), k))}
          </Group>
          <Group title="System" hint="inferred from the paper's facts">
            {p.systems.map(([k, l]) => chip(f.systems.includes(k), l, count$({ systems: [k] }), () => setF({ ...f, systems: toggle(f.systems, k) }), k))}
          </Group>
          <Group title="Answer status" hint="any selected">
            {STATUSES.map(([k, l]) => chip(f.status.includes(k), l, count$({ status: [k] }), () => setF({ ...f, status: toggle(f.status, k) }), k))}
          </Group>
          <Group title="My history">
            <div className="seg flex-wrap" role="radiogroup" aria-label="My history">
              {HISTORIES.map(([k, l]) => <button key={k} type="button" role="radio" aria-checked={f.history === k} onClick={() => setF({ ...f, history: k })}>{l} <span className="num text-xs">{count$({ history: k })}</span></button>)}
            </div>
          </Group>
          {(f.papers.length + f.systems.length + f.status.length > 0 || f.history !== 'any') && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setF(NONE)}>Clear filters</button>}
        </div>

        <aside className="summary panel p-5" aria-labelledby="h-sum">
          <h2 id="h-sum" className="text-sm font-medium text-muted">Your quiz</h2>
          <p className="mt-2 flex items-baseline gap-2" aria-live="polite" aria-atomic="true"><span className="num text-[2.6rem] leading-none"><Count n={avail} /></span><span className="text-muted">question{avail === 1 ? '' : 's'} match</span></p>
          <div className="mt-3 flex h-1.5 gap-0.5 overflow-hidden rounded-full bg-sunk" aria-hidden="true">
            <motion.span className="h-full rounded-full bg-accent" initial={false} animate={{ flexGrow: scored }} style={{ flexBasis: 0 }} transition={{ duration: 0.4, ease }} />
            <motion.span className="h-full rounded-full bg-line-strong" initial={false} animate={{ flexGrow: avail - scored }} style={{ flexBasis: 0 }} transition={{ duration: 0.4, ease }} />
          </div>
          <p className="mt-2 text-xs text-muted"><span className="num text-ink">{scored}</span> can be scored · <span className="num">{avail - scored}</span> have no key (practice only)</p>

          <div className="divider my-5" />
          <label className="flex items-baseline justify-between text-sm" htmlFor="qb-n"><span>Questions</span><span className="num text-lg">{avail ? n : 0}</span></label>
          <input id="qb-n" type="range" className="mt-2 w-full" min={min || 0} max={avail || 0} value={avail ? n : 0} disabled={avail <= min} onChange={(e) => setCount(Number(e.target.value))} />
          <div className="mt-4 grid gap-2">
            <button type="button" role="switch" aria-checked={shuffle} className="switch" onClick={() => setShuffle(!shuffle)}><Shuffle size={15} className="text-muted" />Shuffle questions<span className="switch-ui" aria-hidden="true" /></button>
            <button type="button" role="switch" aria-checked={shuffleOptions} className="switch" onClick={() => setShuffleOptions(!shuffleOptions)}><Shuffle size={15} className="rotate-90 text-muted" />Shuffle options<span className="switch-ui" aria-hidden="true" /></button>
          </div>

          <div className="divider my-5" />
          <div className="seg grid w-full grid-cols-2" role="radiogroup" aria-label="Mode">
            <button type="button" role="radio" aria-checked={mode === 'quiz'} onClick={() => setMode('quiz')}><BookOpenCheck size={14} className="mr-1.5 inline" />Practice</button>
            <button type="button" role="radio" aria-checked={mode === 'exam'} onClick={() => setMode('exam')}><Clock3 size={14} className="mr-1.5 inline" />Exam</button>
          </div>
          <p className="mt-2 text-xs text-muted">{mode === 'exam' ? 'Timed. Answers save as you go; the key and evidence come at the end.' : 'Untimed. Check each answer for instant feedback and evidence.'}</p>
          {mode === 'exam' && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} transition={{ duration: 0.3, ease }} className="overflow-hidden">
              <div className="seg mt-4 grid w-full grid-cols-2" role="radiogroup" aria-label="Timing">
                <button type="button" role="radio" aria-checked={timing === 'per'} onClick={() => setTiming('per')}>Per question</button>
                <button type="button" role="radio" aria-checked={timing === 'total'} onClick={() => setTiming('total')}>Total time</button>
              </div>
              {timing === 'per' ? (
                <>
                  <label className="mt-4 flex items-baseline justify-between text-sm" htmlFor="qb-per"><span>Seconds per question</span><span className="num text-lg">{per}</span></label>
                  <input id="qb-per" type="range" className="mt-2 w-full" min={15} max={180} step={15} value={per} onChange={(e) => setPer(Number(e.target.value))} />
                </>
              ) : (
                <label className="mt-4 flex items-center justify-between gap-3 text-sm"><span>Total minutes</span><input type="number" className="field num !h-9 !w-24 text-right" min={1} max={360} value={total} onChange={(e) => setTotal(Math.max(1, Math.min(360, Number(e.target.value) || 1)))} /></label>
              )}
              <p className="mt-2 text-xs text-muted">Total <span className="num text-ink">{minutes} min</span>. Warnings at 5 minutes and 1 minute; it submits itself at zero.</p>
            </motion.div>
          )}
          <button type="button" className="btn btn-primary mt-5 w-full justify-center" disabled={!avail || !!busy} onClick={custom}>{busy === 'custom' ? <LoaderCircle size={16} className="animate-spin" /> : <Sparkles size={16} />}{startLabel}<ArrowRight size={16} /></button>
          {err && <p role="alert" className="mt-3 text-sm text-bad">{err}</p>}
          {!avail && <p className="mt-3 text-sm text-muted">No questions match. Loosen a filter.</p>}
        </aside>
      </section>

      <div className="dock panel" aria-hidden="true">
        <span className="num text-sm"><span className="text-ink">{avail ? n : 0}</span> <span className="text-muted">of {avail}</span></span>
        <button type="button" tabIndex={-1} className="btn btn-primary btn-sm ml-auto" disabled={!avail || !!busy} onClick={custom}>{startLabel}<ArrowRight size={15} /></button>
      </div>
    </div>
  );
}
