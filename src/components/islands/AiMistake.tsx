// "Explain my mistake": why the key beats the option the student picked, grounded on the page's facts.
// One explanation per (question, wrong option) is cached and shared by the class.
import { useId, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ChevronDown, RefreshCw, Sparkles, X } from 'lucide-react';
import { AiState, AiText, Grounding, Thinking, Thumbs, quotaText, useAiStream, useReveal } from './AiText';

const EASE = [0.16, 1, 0.3, 1] as const;

export default function AiMistake({ qid, choice, keyLetter }: { qid: string; choice: string; keyLetter: string }) {
  const [open, setOpen] = useState(false);
  const s = useAiStream('/api/ai/mistake');
  const pid = useId();
  const shown = useReveal(s.text, true);
  const live = s.phase === 'wait' || s.phase === 'stream';
  const revealing = shown.length < s.text.length;
  const start = (fresh = false) => { s.run(fresh ? { qid, choice, fresh } : { qid, choice }); };
  // The parent keys this island on qid+choice, so a new question starts fresh.
  const toggle = () => {
    if (!open) { setOpen(true); if (s.phase === 'idle' || s.phase === 'error') start(); return; }
    if (live) s.stop();
    setOpen(false);
  };

  return (
    <div className="mt-3" data-ai>
      <button type="button" className="ai-disc !inline-flex !w-auto" aria-expanded={open} aria-controls={pid} onClick={toggle}>
        <Sparkles size={15} className="text-accent" aria-hidden="true" />Why {keyLetter}, not {choice}?<ChevronDown size={15} className="chev" aria-hidden="true" />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.section key="panel" id={pid} aria-label="AI explanation of your mistake" className="ai-surface mt-3 max-w-[72ch] p-4 sm:p-5"
            initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.24, ease: EASE }}>
            <header className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
              <span className="ai-mark"><Sparkles size={12} aria-hidden="true" />AI explanation</span>
              <span className="ai-note">Not verified. Check it against the key evidence.</span>
              <span className="ml-auto flex items-center">
                {s.phase === 'done' && s.done?.admin && (
                  <button type="button" className="btn btn-sm btn-ghost !px-2" onClick={() => start(true)} aria-label="Regenerate for everyone" title="Regenerate for everyone"><RefreshCw size={15} aria-hidden="true" /></button>
                )}
                <button type="button" className="btn btn-sm btn-ghost !px-2" onClick={toggle} aria-label="Close explanation"><X size={16} aria-hidden="true" /></button>
              </span>
            </header>
            <div className="mt-3" aria-live="polite" aria-busy={live || revealing}>
              {s.phase === 'wait' && (
                <div className="grid gap-2.5">
                  <Thinking label="Comparing your pick with the key…" />
                  <span className="skeleton ai-scan block h-3.5 w-11/12" /><span className="skeleton block h-3.5 w-4/5" />
                </div>
              )}
              {s.text && <AiText text={shown} cites={s.phase === 'done' ? s.done?.cites ?? [] : null} caret={live || revealing} />}
              {s.phase === 'error' && <div className={s.text ? 'mt-3' : ''}><AiState status={s.status} error={s.error} onRetry={() => start()} /></div>}
            </div>
            {s.phase === 'done' && !revealing && (
              <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-3">
                <Grounding grounded={s.done?.grounded} cites={s.done?.cites?.length} />
                <p className="ai-note">{s.done?.cached ? 'Shared with the class · no AI request used' : quotaText(s.done?.quota)}</p>
                <span className="ml-auto"><Thumbs kind="mistake" refId={`${qid}:${choice}`} /></span>
              </div>
            )}
          </motion.section>
        )}
      </AnimatePresence>
    </div>
  );
}
