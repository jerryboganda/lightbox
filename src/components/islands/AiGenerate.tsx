// Owner: ai (phase 3). "Generate practice MCQs" from a topic or facts; results wait for admin approval.
import { useId, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { Check, ChevronDown, WandSparkles, X } from 'lucide-react';
import { AiState, AiText, Thinking, quotaText, type CiteInfo, type Quota } from './AiText';

export interface AiGenerateProps { topicSlug?: string; factIds?: string[]; compact?: boolean }
interface Item { id: number; stem: string; options: Record<string, string>; key: string; explanation: string; facts: CiteInfo[] }
type Phase = 'form' | 'busy' | 'done' | 'error';
const COUNTS = [1, 2, 3, 4, 5];

export default function AiGenerate({ topicSlug, factIds, compact }: AiGenerateProps) {
  const dlg = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const ac = useRef<AbortController | null>(null);
  const hid = useId();
  const [n, setN] = useState(3);
  const [st, setSt] = useState<(Quota & { enabled: boolean }) | null>(null);
  const [phase, setPhase] = useState<Phase>('form');
  const [items, setItems] = useState<Item[]>([]);
  const [dropped, setDropped] = useState(0);
  const [err, setErr] = useState<{ status?: number; error?: string }>({});

  const open = () => {
    setPhase('form');
    dlg.current?.showModal();
    fetch('/api/ai/status').then((r) => (r.ok ? r.json() : null)).then((j) => j && setSt(j)).catch(() => {});
  };
  const close = () => dlg.current?.close();
  const submit = async () => {
    setPhase('busy');
    setErr({});
    const c = (ac.current = new AbortController());
    try {
      const r = await fetch('/api/ai/generate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ topicSlug, factIds, n }), signal: c.signal });
      const j = await r.json().catch(() => null);
      if (!r.ok) { setErr({ status: r.status, error: j?.error }); setPhase('error'); return; }
      setItems(j.items);
      setDropped(j.rejected);
      setSt((s) => (s ? { ...s, ...j.quota } : s));
      setPhase('done');
      navigator.vibrate?.(12);
    } catch {
      if (!c.signal.aborted) { setErr({ error: 'Could not reach Lightbox. Check your connection.' }); setPhase('error'); }
    }
  };
  const off = st?.enabled === false;
  const plural = (k: number) => (k === 1 ? '' : 's');

  return (
    <>
      <button ref={opener} type="button" className="btn btn-sm btn-ghost max-sm:!px-2" onClick={open} aria-haspopup="dialog" title="Generate practice MCQs with AI">
        <WandSparkles size={15} aria-hidden="true" /><span className={compact ? 'max-sm:sr-only' : ''}>Generate MCQs</span>
      </button>
      <dialog ref={dlg} className="ai-dialog" aria-labelledby={hid}
        onClose={() => { ac.current?.abort(); opener.current?.focus(); }}
        onClick={(e) => { if (e.target === dlg.current && phase !== 'busy') close(); }}>
        <div className="dh">
          <span className="ai-tile" aria-hidden="true"><WandSparkles size={19} /></span>
          <div className="min-w-0 flex-1">
            <h2 id={hid} className="font-medium leading-tight">Generate practice MCQs</h2>
            <p className="mt-0.5 text-xs text-muted">AI-written · an admin reviews each one first</p>
          </div>
          <button type="button" className="btn btn-sm btn-ghost !px-2" onClick={close} aria-label="Close"><X size={17} aria-hidden="true" /></button>
        </div>

        <div className="db" aria-live="polite" aria-busy={phase === 'busy'}>
          {phase === 'form' && (
            <>
              <p className="text-sm leading-relaxed text-muted">The AI writes single-best-answer questions from this {topicSlug ? 'topic’s' : 'selection’s'} <span className="text-ink">verified facts only</span>. They wait in the admin queue; approved ones appear in the AI practice set, always badged as AI-generated.</p>
              <div>
                <p id={`${hid}-n`} className="mb-2 text-sm font-medium">How many questions</p>
                <div className="seg" role="radiogroup" aria-labelledby={`${hid}-n`}>
                  {COUNTS.map((k) => <button key={k} type="button" role="radio" aria-checked={n === k} className="num !px-3.5" onClick={() => setN(k)}>{k}</button>)}
                </div>
              </div>
              {off ? <AiState status={503} /> : <p className="ai-note">{st ? `${quotaText(st)} · one per batch` : ' '}</p>}
            </>
          )}
          {phase === 'busy' && (
            <div className="grid gap-3">
              <Thinking label={`Writing ${n} question${plural(n)} from verified facts…`} />
              {COUNTS.slice(0, Math.min(n, 3)).map((k) => (
                <div key={k} className="ai-q ai-scan grid gap-2 p-3.5" aria-hidden="true">
                  <span className="skeleton block h-3.5 w-11/12" /><span className="skeleton block h-3.5 w-3/5" />
                  <span className="mt-1 grid grid-cols-2 gap-1.5"><span className="skeleton h-6" /><span className="skeleton h-6" /><span className="skeleton h-6" /><span className="skeleton h-6" /></span>
                </div>
              ))}
            </div>
          )}
          {phase === 'done' && (
            <>
              <motion.div className="flex items-start gap-3" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}>
                <motion.span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-ok/15 text-ok" initial={{ scale: 0.6 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 420, damping: 18 }}><Check size={18} aria-hidden="true" /></motion.span>
                <div>
                  <p className="font-medium">Sent to admins for review</p>
                  <p className="mt-0.5 text-sm text-muted">{items.length} question{plural(items.length)} wait in the admin queue. You will get a notification when {items.length === 1 ? 'it is' : 'they are'} reviewed.{dropped > 0 && ` ${dropped} failed the checks and ${dropped === 1 ? 'was' : 'were'} dropped.`}</p>
                </div>
              </motion.div>
              <ul className="grid gap-2">
                {items.map((q, i) => (
                  <motion.li key={q.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, delay: 0.08 * (i + 1), ease: [0.16, 1, 0.3, 1] }}>
                    <details className="ai-q" open={i === 0}>
                      <summary><span className="num mt-px text-xs text-muted">{i + 1}</span><span className="min-w-0 flex-1">{q.stem}</span><ChevronDown size={15} className="chev" aria-hidden="true" /></summary>
                      <ol aria-label="Options">
                        {Object.entries(q.options).map(([l, t]) => <li key={l} className={l === q.key ? 'key' : ''}><span className="num">{l}</span><span className="flex-1">{t}</span>{l === q.key && <span className="text-xs text-ok">key</span>}</li>)}
                      </ol>
                      <div className="border-t border-line px-3.5 py-2.5 text-muted"><AiText text={q.explanation} cites={q.facts} className="!text-[0.8125rem]" /></div>
                    </details>
                  </motion.li>
                ))}
              </ul>
            </>
          )}
          {phase === 'error' && <AiState status={err.status} error={err.error} />}
        </div>

        <div className="df">
          {phase === 'done' ? (
            <>
              <a href="/practice/ai" className="btn btn-sm btn-ghost mr-auto max-sm:!px-2">AI practice set</a>
              <button type="button" className="btn" onClick={() => setPhase('form')}>Write more</button>
              <button type="button" className="btn btn-primary" onClick={close}>Done</button>
            </>
          ) : (
            <>
              <button type="button" className="btn btn-ghost ml-auto" onClick={close}>Cancel</button>
              <button type="button" className="btn btn-primary" onClick={submit} disabled={phase === 'busy' || off}>
                <WandSparkles size={16} aria-hidden="true" />{phase === 'busy' ? 'Writing…' : phase === 'error' ? 'Try again' : `Generate ${n}`}
              </button>
            </>
          )}
        </div>
      </dialog>
    </>
  );
}
