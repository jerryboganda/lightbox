// Class poll. mcqQid = the poll for that disputed or unkeyed MCQ (created on first view); pollId = a custom poll.
// Results stay hidden until you vote, so early votes don't steer the rest. Polls never change an answer key.
import { useEffect, useId, useState } from 'react';
import { motion } from 'motion/react';
import { ArrowUpRight, Check, LoaderCircle, Users, Vote } from 'lucide-react';
import { reduced } from '../../scripts/motion';
import { send } from '../../scripts/class';
import { toast } from '../../scripts/toast';
import '../../styles/class.css';

export interface PollProps { mcqQid?: string; pollId?: number; compact?: boolean }
type View = { id: number; kind: 'mcq' | 'custom'; question: string; context: string | null; href: string | null; options: { key: string; label: string; votes?: number }[]; total: number; mine: string | null; open: boolean; closesAt: number | null };
const voters = (n: number) => `${n} ${n === 1 ? 'vote' : 'votes'}`;
// Custom polls have word keys; show them as letters.
const letter = (key: string, i: number) => (key.length <= 2 ? key : String.fromCharCode(65 + i));

export default function Poll({ mcqQid, pollId, compact = false }: PollProps) {
  const [v, setV] = useState<View | null>(null);
  const [state, setState] = useState<'loading' | 'none' | 'ready'>('loading');
  const [busy, setBusy] = useState<string | null>(null);
  const [changing, setChanging] = useState(false);
  const [live, setLive] = useState('');
  const id = useId();
  const rm = typeof document !== 'undefined' && reduced();

  useEffect(() => {
    const q = mcqQid ? `mcq=${encodeURIComponent(mcqQid)}` : pollId ? `id=${pollId}` : '';
    if (!q) { setState('none'); return; }
    fetch(`/api/polls?${q}`).then((r) => (r.ok ? r.json() : Promise.reject())).then((d: View) => { setV(d); setState('ready'); }).catch(() => setState('none'));
  }, [mcqQid, pollId]);

  if (state === 'none') return null;
  if (!v) return <div className={`lb-poll${compact ? ' is-compact' : ''}`} aria-hidden="true"><div className="skeleton h-4 w-1/3" /><div className="skeleton mt-3 h-9" /><div className="skeleton mt-2 h-9" /></div>;

  const results = (!!v.mine && !changing) || !v.open;
  const top = Math.max(0, ...v.options.map((o) => o.votes ?? 0));
  const cast = async (key: string) => {
    if (busy) return;
    setBusy(key);
    try {
      const next = await send<View>(`/api/polls/${v.id}/vote`, 'POST', { choice: key });
      setV(next); setChanging(false);
      setLive(`Vote saved. ${voters(next.total)} so far.`);
      navigator.vibrate?.(8);
    } catch (e) { toast((e as Error).message, 'bad'); }
    setBusy(null);
  };

  return (
    <section className={`lb-poll${compact ? ' is-compact' : ''}`} aria-labelledby={`${id}-q`} data-no-highlight>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="badge s-agreed">Class opinion</span>
        {!v.open && <span className="badge s-neutral">Closed</span>}
        <span className="ml-auto flex items-center gap-1.5 text-xs text-muted"><Users size={13} aria-hidden="true" /><span className="num">{voters(v.total)}</span></span>
      </div>
      {!compact && v.context && (
        <p className="mt-2.5 line-clamp-3 text-sm text-muted">{v.context}{v.href && <> <a href={v.href} className="inline-flex items-center gap-0.5 whitespace-nowrap text-accent hover:underline">Open question<ArrowUpRight size={13} aria-hidden="true" /></a></>}</p>
      )}
      <h3 id={`${id}-q`} className={`${compact ? 'mt-2 text-sm' : 'mt-2.5 text-[0.95rem]'} font-medium leading-snug`}>{v.question}</h3>

      {results ? (
        <ul className={`lb-pres${compact ? ' is-compact' : ''}`} aria-label="Results">
          {v.options.map((o, i) => {
            const n = o.votes ?? 0, pct = v.total ? Math.round((n / v.total) * 100) : 0;
            return (
              <li key={o.key} className={`lb-prow${n && n === top ? ' is-lead' : ''}${v.mine === o.key ? ' is-mine' : ''}`}>
                <span className="lb-key" aria-hidden="true">{letter(o.key, i)}</span>
                <span className={compact ? 'sr-only' : 'lbl min-w-0'}>{o.label}{v.mine === o.key && <span className="ml-1.5 inline-flex items-center gap-0.5 align-middle text-xs text-accent"><Check size={13} aria-hidden="true" />Your vote</span>}</span>
                <span className="val">{compact && v.mine === o.key && <Check size={12} className="mr-1 inline align-[-1px] text-accent" aria-hidden="true" />}<span className="text-ink">{pct}%</span> · {n}</span>
                <span className="lb-bar" aria-hidden="true">
                  <motion.span initial={{ scaleX: rm ? pct / 100 : 0 }} animate={{ scaleX: pct / 100 }} transition={rm ? { duration: 0 } : { type: 'spring', stiffness: 120, damping: 20, delay: 0.05 + i * 0.05 }} />
                </span>
              </li>
            );
          })}
        </ul>
      ) : compact ? (
        <ul className="lb-pchips" aria-label="Options">
          {v.options.map((o, i) => (
            <li key={o.key}>
              <button type="button" className="lb-pchip" disabled={!!busy} onClick={() => cast(o.key)} aria-label={`Vote ${letter(o.key, i)}: ${o.label}`} title={o.label} aria-pressed={v.mine === o.key}>
                {busy === o.key ? <LoaderCircle size={14} className="animate-spin" aria-hidden="true" /> : letter(o.key, i)}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <ul className="lb-popts" aria-label="Options">
          {v.options.map((o, i) => (
            <li key={o.key}>
              <button type="button" className="lb-popt" disabled={!!busy} onClick={() => cast(o.key)} aria-label={`Vote ${letter(o.key, i)}: ${o.label}`} aria-pressed={v.mine === o.key}>
                <span className="lb-key" aria-hidden="true">{busy === o.key ? <LoaderCircle size={12} className="animate-spin" /> : letter(o.key, i)}</span>
                <span className="min-w-0 flex-1">{o.label}</span>
                {v.mine === o.key && <Check size={15} className="mt-0.5 shrink-0 text-accent" aria-hidden="true" />}
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
        <span className="flex items-center gap-1.5"><Vote size={13} aria-hidden="true" />{results ? 'Polls never change the answer key.' : v.total ? 'Vote to see how the class split.' : 'No votes yet. Results show after you vote.'}</span>
        {v.open && v.mine && (changing
          ? <button type="button" className="ml-auto text-accent hover:underline" onClick={() => setChanging(false)}>Keep my vote</button>
          : <button type="button" className="ml-auto text-accent hover:underline" onClick={() => setChanging(true)}>Change vote</button>)}
      </div>
      <p className="sr-only" aria-live="polite">{live}</p>
    </section>
  );
}
