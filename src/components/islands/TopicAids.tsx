// Topic study aids on the reader: a 60-second recap, memory hooks and how the topic is examined.
// Each aid is made once from the topic's facts and shared with the class; ones already made arrive with the page.
import { useEffect, useId, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Lightbulb, RefreshCw, Sparkles, Target, Timer, X } from 'lucide-react';
import { AiState, AiText, Grounding, Thinking, Thumbs, quotaText, useAiStream, useReveal, type CiteInfo, type Quota } from './AiText';
import type { Grounded } from '../../lib/grounding';

export type AidKind = 'recap' | 'mnemonic' | 'examined';
export interface Aid { text: string; cites: CiteInfo[]; grounded?: Grounded; cached?: boolean; quota?: Quota }
export interface TopicAidsProps { slug: string; enabled: boolean; admin?: boolean; cached: Partial<Record<AidKind, Aid>>; votes?: Partial<Record<AidKind, -1 | 0 | 1>> }

const AIDS: { kind: AidKind; label: string; Icon: typeof Timer; wait: string }[] = [
  { kind: 'recap', label: '60-second recap', Icon: Timer, wait: 'Pulling out the most examinable points…' },
  { kind: 'mnemonic', label: 'Memory hooks', Icon: Lightbulb, wait: 'Finding hooks for the hard-to-remember facts…' },
  { kind: 'examined', label: 'How it is examined', Icon: Target, wait: 'Thinking like an examiner…' },
];
const EASE = [0.16, 1, 0.3, 1] as const;

export default function TopicAids({ slug, enabled, admin = false, cached, votes = {} }: TopicAidsProps) {
  const [kind, setKind] = useState<AidKind | null>(null);
  const [got, setGot] = useState<Partial<Record<AidKind, Aid>>>(() => Object.fromEntries(Object.entries(cached).map(([k, v]) => [k, { ...v, cached: true }])));
  const [streamKind, setStreamKind] = useState<AidKind | null>(null);
  const s = useAiStream('/api/ai/aid');
  const pid = useId();
  const live = s.phase === 'wait' || s.phase === 'stream';

  useEffect(() => {
    if (s.phase === 'done' && streamKind) setGot((g) => ({ ...g, [streamKind]: { text: s.text, cites: s.done?.cites ?? [], grounded: s.done?.grounded, cached: s.done?.cached, quota: s.done?.quota } }));
  }, [s.phase, s.done]); // eslint-disable-line react-hooks/exhaustive-deps

  // The streamed answer stays the source until it is stored, so the reveal never restarts.
  const streaming = kind !== null && kind === streamKind && s.phase !== 'idle' && !(s.phase === 'done' && got[kind]);
  const aid = kind ? got[kind] : undefined;
  const text = streaming ? s.text : aid?.text ?? '';
  const shown = useReveal(text, kind === streamKind);
  const revealing = shown.length < text.length;
  const available = AIDS.filter((a) => enabled || got[a.kind]);
  if (!available.length) return null;

  const ask = (k: AidKind, fresh = false) => {
    setStreamKind(k);
    if (fresh) setGot((g) => { const n = { ...g }; delete n[k]; return n; });
    s.run(fresh ? { topic: slug, kind: k, fresh } : { topic: slug, kind: k });
  };
  const pick = (k: AidKind) => {
    if (kind === k) { if (live) s.stop(); setKind(null); return; }
    setKind(k);
    if (!got[k] && enabled && !(k === streamKind && live)) ask(k);
  };
  const meta = AIDS.find((a) => a.kind === kind);

  return (
    <div className="mt-6">
      <div className="ai-aids-tabs" role="group" aria-label="AI study aids for this topic">
        <span className="ai-mark"><Sparkles size={12} aria-hidden="true" />AI study aids</span>
        {available.map(({ kind: k, label, Icon }) => (
          <button key={k} type="button" className="ai-chip" aria-pressed={kind === k} aria-controls={pid} onClick={() => pick(k)}>
            <Icon size={14} aria-hidden="true" />{label}{got[k]?.cached && <span className="sr-only"> (ready)</span>}
          </button>
        ))}
      </div>
      <AnimatePresence initial={false}>
        {kind && meta && (
          <motion.section key="aid" id={pid} aria-label={meta.label} className="ai-surface mt-3 max-w-[72ch] p-4 sm:p-5"
            initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.24, ease: EASE }}>
            <header className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
              <span className="ai-mark"><meta.Icon size={12} aria-hidden="true" />{meta.label}</span>
              <span className="ai-note">AI-made from this topic's facts. Not verified.</span>
              <span className="ml-auto flex items-center">
                {admin && enabled && aid && !streaming && (
                  <button type="button" className="btn btn-sm btn-ghost !px-2" onClick={() => ask(kind, true)} aria-label={`Regenerate ${meta.label} for everyone`} title="Regenerate for everyone"><RefreshCw size={15} aria-hidden="true" /></button>
                )}
                <button type="button" className="btn btn-sm btn-ghost !px-2" onClick={() => pick(kind)} aria-label="Close study aid"><X size={16} aria-hidden="true" /></button>
              </span>
            </header>
            <div className="mt-3" aria-live="polite" aria-busy={streaming || revealing}>
              {streaming && s.phase === 'wait' && (
                <div className="grid gap-2.5">
                  <Thinking label={meta.wait} />
                  <span className="skeleton ai-scan block h-3.5 w-11/12" /><span className="skeleton block h-3.5 w-4/5" /><span className="skeleton block h-3.5 w-2/3" />
                </div>
              )}
              {text && <AiText text={shown} cites={streaming ? null : aid?.cites ?? []} caret={(streaming && live) || revealing} />}
              {streaming && s.phase === 'error' && <div className={s.text ? 'mt-3' : ''}><AiState status={s.status} error={s.error} onRetry={() => ask(kind)} /></div>}
              {!streaming && !aid && !enabled && <p className="ai-note">AI is not configured on this server.</p>}
            </div>
            {aid && !streaming && !revealing && (
              <footer className="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-3">
                <Grounding grounded={aid.grounded} cites={aid.cites.length} />
                <p className="ai-note">{aid.cached ? 'Shared with the class · no AI request used' : quotaText(aid.quota)}</p>
                <span className="ml-auto"><Thumbs kind="aid" refId={`${slug}:${kind}`} initial={votes[kind] ?? 0} /></span>
              </footer>
            )}
          </motion.section>
        )}
      </AnimatePresence>
    </div>
  );
}
