// Owner: ai (phase 3). "Explain this fact" grounded on Lightbox facts; place with client:visible.
// One explanation per fact is cached and shared by the class; admins can regenerate it.
import { useId, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ChevronDown, RefreshCw, Sparkles, X } from 'lucide-react';
import { AiState, AiText, Thinking, quotaText, useAiStream, useReveal } from './AiText';

export interface AiExplainProps { factId: string }
const EASE = [0.16, 1, 0.3, 1] as const;
// The model lists related facts last; they show as "Revise with" cards instead, so the line (or its first letters while streaming) is hidden.
const body = (t: string) => t.replace(/\n[ \t]*\**(?:R(?:e(?:l(?:a(?:t(?:e(?:d)?)?)?)?)?)?)?$|\n[ \t]*\**Related\b[\s\S]*$/, '');

export default function AiExplain({ factId }: AiExplainProps) {
  const [open, setOpen] = useState(false);
  const s = useAiStream('/api/ai/explain');
  const pid = useId();
  const shown = useReveal(body(s.text), true);
  const live = s.phase === 'wait' || s.phase === 'stream';
  const revealing = shown.length < body(s.text).length;
  const start = (fresh = false) => { s.run(fresh ? { factId, fresh } : { factId }); };
  const toggle = () => {
    if (!open) { setOpen(true); if (s.phase === 'idle' || s.phase === 'error') start(); return; }
    if (live) s.stop();
    setOpen(false);
  };
  const related = s.phase === 'done' ? (s.done?.cites ?? []).filter((c) => c.id !== factId) : [];

  return (
    <div>
      <button type="button" className="ai-disc !inline-flex !w-auto" aria-expanded={open} aria-controls={pid} onClick={toggle}>
        <Sparkles size={15} className="text-accent" aria-hidden="true" />Explain this fact<ChevronDown size={15} className="chev" aria-hidden="true" />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.section key="panel" id={pid} aria-label="AI explanation" className="ai-surface mt-3 max-w-[72ch] p-4 sm:p-5"
            initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.24, ease: EASE }}>
            <header className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
              <span className="ai-mark"><Sparkles size={12} aria-hidden="true" />AI explanation</span>
              <span className="ai-note">Not verified. Check it against the sources.</span>
              <span className="ml-auto flex items-center">
                {s.phase === 'done' && s.done?.admin && (
                  <button type="button" className="btn btn-sm btn-ghost !px-2" onClick={() => start(true)} aria-label="Regenerate explanation for everyone" title="Regenerate for everyone"><RefreshCw size={15} aria-hidden="true" /></button>
                )}
                <button type="button" className="btn btn-sm btn-ghost !px-2" onClick={toggle} aria-label="Close explanation"><X size={16} aria-hidden="true" /></button>
              </span>
            </header>
            <div className="mt-3" aria-live="polite" aria-busy={live || revealing}>
              {s.phase === 'wait' && (
                <div className="grid gap-2.5">
                  <Thinking label="Reading this fact and its topic…" />
                  <span className="skeleton ai-scan block h-3.5 w-11/12" /><span className="skeleton block h-3.5 w-4/5" /><span className="skeleton block h-3.5 w-2/3" />
                </div>
              )}
              {s.text && <AiText text={shown} cites={s.phase === 'done' ? s.done?.cites ?? [] : null} caret={live || revealing} />}
              {s.phase === 'error' && <div className={s.text ? 'mt-3' : ''}><AiState status={s.status} error={s.error} onRetry={() => start()} /></div>}
            </div>
            {s.phase === 'done' && !revealing && (
              <motion.footer className="mt-4 border-t border-line pt-3" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.3 }}>
                {related.length > 0 && (
                  <div className="mb-3">
                    <h3 className="text-xs font-medium uppercase tracking-wide text-muted">Revise with</h3>
                    <ul className="mt-2 flex flex-wrap gap-1.5">
                      {related.map((c) => <li key={c.id} className="min-w-0 max-w-full"><a href={`/facts/${c.id}`} className="ai-rel" title={c.fact}><span className="num">{c.id}</span><span className="t">{c.fact}</span></a></li>)}
                    </ul>
                  </div>
                )}
                <p className="ai-note">{s.done?.cached ? 'Shared with the class · no AI request used' : quotaText(s.done?.quota)}</p>
              </motion.footer>
            )}
          </motion.section>
        )}
      </AnimatePresence>
    </div>
  );
}
