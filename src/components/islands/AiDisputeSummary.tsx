// Owner: ai (phase 3). AI summary of both sides of a disputed item, from its recorded evidence only. Cached for the class.
import { useId, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ChevronDown, Scale } from 'lucide-react';
import { AiState, AiText, Thinking, quotaText, useAiStream, useReveal } from './AiText';

export interface AiDisputeSummaryProps { itemType: 'mcq' | 'fact'; itemId: string }

export default function AiDisputeSummary({ itemType, itemId }: AiDisputeSummaryProps) {
  const [open, setOpen] = useState(false);
  const s = useAiStream('/api/ai/dispute');
  const pid = useId();
  const shown = useReveal(s.text, true);
  const live = s.phase === 'wait' || s.phase === 'stream';
  const revealing = shown.length < s.text.length;
  const start = () => { s.run({ itemType, itemId }); };
  const toggle = () => {
    if (!open) { setOpen(true); if (s.phase === 'idle' || s.phase === 'error') start(); return; }
    if (live) s.stop();
    setOpen(false);
  };

  return (
    <div>
      <button type="button" className="ai-disc" aria-expanded={open} aria-controls={pid} onClick={toggle}>
        <Scale size={15} className="text-accent" aria-hidden="true" />AI summary of both sides<ChevronDown size={15} className="chev" aria-hidden="true" />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div key="panel" id={pid} role="region" aria-label="AI summary of both sides" className="ai-surface mt-2 p-4"
            initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}>
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
              <span className="ai-mark">AI summary</span>
              <span className="ai-note">From the recorded evidence only. Check the sources.</span>
            </div>
            <div className="mt-3 text-[0.9rem]" aria-live="polite" aria-busy={live || revealing}>
              {s.phase === 'wait' && (
                <div className="grid gap-2.5">
                  <Thinking label="Weighing both sides…" />
                  <span className="skeleton ai-scan block h-3.5 w-11/12" /><span className="skeleton block h-3.5 w-3/4" />
                </div>
              )}
              {s.text && <AiText text={shown} cites={s.phase === 'done' ? [] : null} caret={live || revealing} />}
              {s.phase === 'error' && <div className={s.text ? 'mt-3' : ''}><AiState status={s.status} error={s.error} onRetry={start} /></div>}
            </div>
            {s.phase === 'done' && !revealing && <p className="ai-note mt-3">{s.done?.cached ? 'Shared with the class · no AI request used' : quotaText(s.done?.quota)}</p>}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
