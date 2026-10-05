// Practice player for admin-approved AI MCQs (/practice/ai). Kept apart from past-paper MCQs: answers are not recorded in analytics.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowLeft, ArrowRight, Check, RotateCcw, Sparkles, X } from 'lucide-react';
import { AiText, type CiteInfo } from './AiText';

export interface BankItem { id: number; stem: string; options: Record<string, string>; key: string; explanation: string; topic: { slug: string; title: string; href: string } | null; system: string; facts: CiteInfo[] }
export interface AiMcqPlayerProps { items: BankItem[]; systems: [string, string, number][] }
const EASE = [0.16, 1, 0.3, 1] as const;

export default function AiMcqPlayer({ items, systems }: AiMcqPlayerProps) {
  const [sys, setSys] = useState('all');
  const [topic, setTopic] = useState('all');
  const [i, setI] = useState(0);
  const [dir, setDir] = useState(1);
  const [pick, setPick] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);
  const [err, setErr] = useState('');
  const [got, setGot] = useState<Map<number, boolean>>(new Map()); // this session only

  const topicsIn = useMemo(() => [...new Map(items.filter((q) => q.topic && (sys === 'all' || q.system === sys)).map((q) => [q.topic!.slug, q.topic!.title])).entries()].sort((a, b) => a[1].localeCompare(b[1])), [items, sys]);
  const list = useMemo(() => items.filter((q) => (sys === 'all' || q.system === sys) && (topic === 'all' || q.topic?.slug === topic)), [items, sys, topic]);
  const q = list[Math.min(i, list.length - 1)];
  const right = list.filter((x) => got.get(x.id)).length, answered = list.filter((x) => got.has(x.id)).length;

  useEffect(() => { setI(0); }, [sys, topic]);
  useEffect(() => { setPick(null); setChecked(false); setErr(''); }, [q?.id]);
  const go = useCallback((d: number) => { setDir(d); setI((x) => Math.max(0, Math.min(list.length - 1, x + d))); }, [list.length]);
  const check = useCallback(() => {
    if (!q) return;
    if (!pick) { setErr('Choose an option first.'); return; }
    setChecked(true);
    setGot((m) => new Map(m).set(q.id, pick === q.key));
    navigator.vibrate?.(pick === q.key ? 12 : [20, 40, 20]);
  }, [q, pick]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!q || /input|select|textarea/i.test((e.target as HTMLElement).tagName) || e.metaKey || e.ctrlKey || e.altKey) return;
      const letters = Object.keys(q.options), k = e.key.toUpperCase();
      const idx = /^[1-9]$/.test(k) ? Number(k) - 1 : letters.indexOf(k);
      if (!checked && idx >= 0 && idx < letters.length) { setPick(letters[idx]); setErr(''); }
      else if (e.key === 'Enter' && (e.target as HTMLElement).tagName !== 'BUTTON' && (e.target as HTMLElement).tagName !== 'A') { e.preventDefault(); checked ? go(1) : check(); }
      else if (e.key === 'ArrowRight') go(1);
      else if (e.key === 'ArrowLeft') go(-1);
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [q, checked, check, go]);

  const state = (l: string) => (!checked ? (pick === l ? 'picked' : '') : l === q.key ? 'right' : pick === l ? 'wrong' : 'dim');

  return (
    <div className="mx-auto max-w-3xl">
      <div className="flex flex-wrap items-center gap-2">
        <select className="field !h-9 !w-auto text-sm" value={sys} onChange={(e) => { setSys(e.target.value); setTopic('all'); }} aria-label="System">
          <option value="all">All systems ({items.length})</option>
          {systems.map(([k, label, n]) => <option key={k} value={k}>{label} ({n})</option>)}
        </select>
        {topicsIn.length > 1 && (
          <select className="field !h-9 !w-auto max-w-full text-sm" value={topic} onChange={(e) => setTopic(e.target.value)} aria-label="Topic">
            <option value="all">All topics</option>
            {topicsIn.map(([slug, title]) => <option key={slug} value={slug}>{title}</option>)}
          </select>
        )}
        <span className="num ml-auto text-sm text-muted" aria-live="polite">{answered ? `${right}/${answered} right this session` : `${list.length} question${list.length === 1 ? '' : 's'}`}</span>
      </div>
      <div className="mt-3 h-1 overflow-hidden rounded-full bg-sunk" aria-hidden="true">
        <motion.div className="h-full origin-left rounded-full bg-accent" initial={false} animate={{ scaleX: list.length ? (i + 1) / list.length : 0 }} transition={{ duration: 0.4, ease: EASE }} />
      </div>

      {!q ? (
        <div className="panel mt-6 grid place-items-center gap-2 px-6 py-14 text-center">
          <p className="font-medium">No questions here</p>
          <button type="button" className="btn btn-sm mt-1" onClick={() => { setSys('all'); setTopic('all'); }}><RotateCcw size={14} aria-hidden="true" />Show all</button>
        </div>
      ) : (
        <AnimatePresence mode="wait" custom={dir} initial={false}>
          <motion.article key={q.id} initial={{ opacity: 0, x: 24 * dir }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -24 * dir }} transition={{ duration: 0.22, ease: EASE }} className="panel mt-5 p-5 sm:p-7" aria-labelledby={`aq-${q.id}`}>
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-xs text-muted">
              <span className="ai-mark"><Sparkles size={12} aria-hidden="true" />AI-generated · admin-approved</span>
              <span className="num">Question {Math.min(i, list.length - 1) + 1} of {list.length}</span>
              {q.topic && <><span aria-hidden="true">·</span><a href={q.topic.href} className="truncate hover:text-accent">{q.topic.title}</a></>}
            </div>
            <h2 id={`aq-${q.id}`} className="mt-3 text-[1.1rem] leading-relaxed sm:text-[1.2rem]">{q.stem}</h2>
            <div className="mt-5 grid gap-2.5" role="radiogroup" aria-label="Options">
              {Object.entries(q.options).map(([l, t], k) => {
                const s = state(l);
                return (
                  <motion.button layout="position" key={l} type="button" role="radio" aria-checked={pick === l} disabled={checked} onClick={() => { setPick(l); setErr(''); }} className={`opt opt-${s || 'idle'}`}>
                    <span className="opt-key num">{l}</span>
                    <span className="flex-1 text-left">{t}</span>
                    {s === 'right' && <Check size={18} className="shrink-0 text-ok" aria-label="Correct answer" />}
                    {s === 'wrong' && <X size={18} className="shrink-0 text-bad" aria-label="Your answer" />}
                    {!checked && <span className="kbd max-sm:hidden" aria-hidden="true">{k + 1}</span>}
                  </motion.button>
                );
              })}
            </div>
            {err && <p role="alert" className="mt-3 text-sm text-bad">{err}</p>}
            <AnimatePresence>
              {checked && (
                <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, ease: EASE, delay: 0.05 }} className="mt-6 space-y-3 rounded-xl border border-line bg-sunk p-4 text-sm" role="status">
                  <p>{pick === q.key ? <span className="font-medium text-ok">Correct.</span> : <span className="font-medium text-bad">The answer is {q.key}.</span>}<span className="text-muted"> Explanation written by AI from the facts below.</span></p>
                  <AiText text={q.explanation} cites={q.facts} className="!text-sm text-muted" />
                  {q.facts.length > 0 && (
                    <div>
                      <h3 className="text-xs font-medium uppercase tracking-wide text-muted">Grounded on</h3>
                      <ul className="mt-2 grid gap-1.5">
                        {q.facts.map((f) => <li key={f.id} className="min-w-0"><a href={`/facts/${f.id}`} className="ai-rel !h-auto min-h-8 !rounded-lg py-1.5" title={f.fact}><span className={`badge s-${f.label} shrink-0`}>{f.id}</span><span className="t">{f.fact}</span></a></li>)}
                      </ul>
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
            <div className="mt-6 flex items-center gap-2">
              <button type="button" className="btn btn-ghost" onClick={() => go(-1)} disabled={i === 0} aria-label="Previous question"><ArrowLeft size={16} aria-hidden="true" /></button>
              {!checked ? <button type="button" className="btn btn-primary ml-auto" onClick={check}>Check answer</button>
                : <button type="button" className="btn btn-primary ml-auto" onClick={() => go(1)} disabled={i >= list.length - 1}>Next question<ArrowRight size={16} aria-hidden="true" /></button>}
            </div>
          </motion.article>
        </AnimatePresence>
      )}
    </div>
  );
}
