// "Report a problem" button + native dialog. ReportDialog is also used by the highlighter's Report action.
import { useEffect, useId, useRef, useState } from 'react';
import { Flag, LoaderCircle } from 'lucide-react';
import { toast } from '../../scripts/toast';
import { send } from '../../scripts/class';
import '../../styles/personal.css';
import '../../styles/class.css';

export interface ReportButtonProps { itemType: 'fact' | 'topic' | 'mcq' | 'image' | 'comment'; itemId: string; quote?: string; compact?: boolean }
export type ReportTarget = Omit<ReportButtonProps, 'compact'>;

const KINDS = {
  wrong: ['Wrong fact', 'The statement or key is incorrect'],
  source: ['Source problem', "Missing, broken or doesn't say this"],
  typo: ['Typo', 'Spelling, number or formatting'],
  unclear: ['Unclear', 'Hard to follow or ambiguous'],
  duplicate: ['Duplicate', 'Same as another item'],
  offensive: ['Offensive', 'Rude, personal or inappropriate'],
  other: ['Other', 'Something else'],
} as const;
type Kind = keyof typeof KINDS;
const FOR_COMMENT: Kind[] = ['wrong', 'offensive', 'duplicate', 'unclear', 'other'];
const FOR_CONTENT: Kind[] = ['wrong', 'source', 'typo', 'unclear', 'duplicate', 'other'];
const NOUN = { fact: 'fact', topic: 'topic note', mcq: 'question', image: 'image', comment: 'comment' } as const;
const MAX = 1000;

export function ReportDialog({ target, onClose }: { target: ReportTarget | null; onClose: () => void }) {
  const dlg = useRef<HTMLDialogElement>(null);
  const [kind, setKind] = useState<Kind | null>(null);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const id = useId();

  useEffect(() => {
    if (!target) return;
    setKind(null); setBody(''); setErr('');
    if (!dlg.current?.open) dlg.current?.showModal();
    const away = () => dlg.current?.close();
    document.addEventListener('astro:before-swap', away);
    return () => document.removeEventListener('astro:before-swap', away);
  }, [target]);

  if (!target) return null;
  const kinds = target.itemType === 'comment' ? FOR_COMMENT : FOR_CONTENT;

  const submit = async (e: { preventDefault(): void }) => {
    e.preventDefault();
    if (!kind) { setErr('Choose what is wrong.'); return; }
    setBusy(true); setErr('');
    try {
      await send('/api/reports', 'POST', { type: target.itemType, id: target.itemId, kind, body, quote: target.quote ?? '', path: location.pathname });
      dlg.current?.close();
      toast('Thanks. An admin will review it.', 'ok');
    } catch (x) { setErr((x as Error).message); }
    setBusy(false);
  };

  return (
    <dialog ref={dlg} className="lb-dialog" aria-labelledby={`${id}-h`} onClose={onClose} onClick={(e) => { if (e.target === dlg.current) dlg.current.close(); }} data-no-highlight>
      <form onSubmit={submit} noValidate>
        <div className="dh">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-signal/12 text-signal"><Flag size={18} aria-hidden="true" /></span>
          <div className="min-w-0">
            <h2 id={`${id}-h`} className="font-medium">Report a problem</h2>
            <p className="text-xs text-muted">With this {NOUN[target.itemType]}. An admin reviews every report; nothing changes until they do.</p>
          </div>
        </div>
        <div className="db">
          {target.quote && <blockquote className="lb-quote" aria-label="Selected text">{target.quote}</blockquote>}
          <fieldset>
            <legend className="mb-2 text-[0.8125rem] font-medium text-muted">What's wrong?</legend>
            <div className="lb-kinds">
              {kinds.map((k) => (
                <label key={k} className="lb-kind">
                  <input type="radio" name={`${id}-kind`} value={k} checked={kind === k} onChange={() => { setKind(k); setErr(''); }} />
                  <span>{KINDS[k][0]}<small>{KINDS[k][1]}</small></span>
                </label>
              ))}
            </div>
          </fieldset>
          <label>
            <span>Details <span className="font-normal text-faint">optional</span></span>
            <textarea className="lb-ta" rows={3} maxLength={MAX} value={body} onChange={(e) => setBody(e.target.value)} placeholder="What should it say? A source or page number helps." />
          </label>
          {body.length > MAX - 150 && <p className="num -mt-2 text-right text-[11px] text-signal">{body.length}/{MAX}</p>}
          {err && <p role="alert" className="text-sm text-bad">{err}</p>}
        </div>
        <div className="df">
          <button type="button" className="btn btn-ghost" onClick={() => dlg.current?.close()}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? <LoaderCircle size={15} className="animate-spin" aria-hidden="true" /> : <Flag size={15} aria-hidden="true" />}Send report</button>
        </div>
      </form>
    </dialog>
  );
}

export default function ReportButton({ itemType, itemId, quote, compact }: ReportButtonProps) {
  const [target, setTarget] = useState<ReportTarget | null>(null);
  return (
    <>
      <button type="button" className={`btn btn-sm btn-ghost${compact ? ' !px-2' : ''}`} aria-label={compact ? 'Report a problem' : undefined} title="Report a problem"
        aria-haspopup="dialog" onClick={() => setTarget({ itemType, itemId, quote })}>
        <Flag size={15} aria-hidden="true" />{!compact && 'Report'}
      </button>
      <ReportDialog target={target} onClose={() => setTarget(null)} />
    </>
  );
}
