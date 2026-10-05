// Comment moderation: the recent stream with hide (reason required), unhide and hard delete.
import { useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { ArrowBigUp, CornerDownRight, Eye, EyeOff, Flag, MessagesSquare, Trash2 } from 'lucide-react';
import type { CommentRow } from '../../../server/admin';
import { toast } from '../../../scripts/toast';
import { ago, api, fail, first, full, initials, plural, useConfirm } from './kit';
import { ItemContext } from './Reports';

export interface AdminCommentsProps { comments: CommentRow[]; filter: string; now: number; me: string }
const REASONS = ['Off-topic', 'Unkind or offensive', 'Misleading medical claim', 'Spam or duplicate'];
const ON: Record<string, string> = { fact: 'a fact', topic: 'a topic', mcq: 'an MCQ', image: 'an image', dispute: 'a disputed item' };

export default function AdminComments({ comments: initial, filter, now, me }: AdminCommentsProps) {
  const reduce = useReducedMotion();
  const [list, setList] = useState(initial);
  const [hiding, setHiding] = useState<number | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState<number | null>(null);
  const [confirm, confirmDialog] = useConfirm();

  const drop = (id: number) => setList((l) => l.filter((c) => c.id !== id));
  const patch = (id: number, p: Partial<CommentRow>) => setList((l) => l.map((c) => (c.id === id ? { ...c, ...p } : c)));

  async function hide(c: CommentRow) {
    const why = reason.trim();
    if (!why) { toast('Give a reason. The author sees it.', 'bad'); return; }
    setBusy(c.id);
    try {
      await api(`/api/admin/comments/${c.id}`, 'POST', { action: 'hide', reason: why });
      if (filter === 'visible') drop(c.id); else patch(c.id, { hidden: 1, hiddenReason: why, hiddenBy: me });
      setHiding(null); setReason('');
      toast(`Hidden. ${first(c.name)} was told why.`, 'ok');
    } catch (e) { fail(e); } finally { setBusy(null); }
  }
  async function unhide(c: CommentRow) {
    setBusy(c.id);
    try {
      await api(`/api/admin/comments/${c.id}`, 'POST', { action: 'unhide' });
      if (filter === 'hidden') drop(c.id); else patch(c.id, { hidden: 0, hiddenReason: '', hiddenBy: null });
      toast('Comment visible again.', 'ok');
    } catch (e) { fail(e); } finally { setBusy(null); }
  }
  async function remove(c: CommentRow) {
    if (!(await confirm({ title: 'Delete this comment for good?', body: <>The comment, its replies and their upvotes are removed. This cannot be undone. Hiding keeps a record instead.</>, confirm: 'Delete comment', danger: true }))) return;
    setBusy(c.id);
    try {
      const r = await api<{ removed: number }>(`/api/admin/comments/${c.id}`, 'DELETE');
      setList((l) => l.filter((x) => x.id !== c.id && x.parentId !== c.id));
      toast(r.removed > 1 ? `Deleted with ${plural(r.removed - 1, 'reply', 'replies')}.` : 'Comment deleted.', 'ok');
    } catch (e) { fail(e); } finally { setBusy(null); }
  }

  if (!list.length) return (
    <div className="adm-clear panel">
      <span className="adm-ico"><MessagesSquare size={20} aria-hidden="true" /></span>
      <h3 className="mt-3 font-medium">{filter === 'hidden' ? 'No hidden comments' : 'No comments yet'}</h3>
      <p className="mt-1 max-w-sm text-sm text-muted">Comments from fact pages, topics, MCQs and the review centre stream in here, newest first.</p>
    </div>
  );

  return (
    <>
      <ol className="clist panel" aria-label="Comments">
        <AnimatePresence initial={false}>
          {list.map((c) => (
            <motion.li key={c.id} layout={reduce ? false : 'position'} exit={{ opacity: 0, x: reduce ? 0 : 24, transition: { duration: 0.2 } }} transition={{ type: 'spring', stiffness: 380, damping: 34 }}
              className={`crow${c.hidden ? ' is-hidden' : ''}${c.deleted ? ' is-deleted' : ''}`} data-comment={c.id}>
              <span className="u-av sm" aria-hidden="true">{initials(c.name)}</span>
              <div className="min-w-0 flex-1">
                <p className="crow-h">
                  <span className="font-medium text-ink">{c.name}</span><span className="num">@{c.username}</span>
                  <span aria-hidden="true">·</span><time dateTime={new Date(c.createdAt).toISOString()} title={full(c.createdAt)}>{ago(c.createdAt, now)}</time>
                  {c.editedAt && <span>· edited</span>}
                  {c.votes > 0 && <span className="crow-stat" title="Upvotes"><ArrowBigUp size={14} aria-hidden="true" /><span className="num">{c.votes}</span><span className="sr-only"> upvotes</span></span>}
                  {c.reports > 0 && <span className="crow-stat text-signal" title="Open reports"><Flag size={13} aria-hidden="true" /><span className="num">{c.reports}</span><span className="sr-only"> open reports</span></span>}
                </p>
                {c.parentId && <p className="mt-0.5 flex items-center gap-1 text-xs text-faint"><CornerDownRight size={13} aria-hidden="true" />Reply to #{c.parentId}</p>}
                <p className="crow-b">{c.body}</p>
                {!!c.deleted && <p className="mt-1 text-xs text-faint">Deleted by the author. Still stored until you delete it.</p>}
                {!!c.hidden && <p className="crow-why"><EyeOff size={14} aria-hidden="true" className="mt-0.5 shrink-0" /><span>Hidden by @{c.hiddenBy ?? 'admin'}: {c.hiddenReason}</span></p>}
                <details className="crow-ctx">
                  <summary>On {ON[c.ctx.type] ?? 'an item'}: <span className="text-ink">{c.ctx.title.length > 90 ? c.ctx.title.slice(0, 89) + '…' : c.ctx.title}</span></summary>
                  <ItemContext ctx={c.ctx} />
                </details>
                <AnimatePresence initial={false}>
                  {hiding === c.id && (
                    <motion.form key="hide" initial={{ opacity: 0, y: reduce ? 0 : -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="crow-hide" onSubmit={(e) => { e.preventDefault(); hide(c); }}>
                      <label className="block text-xs font-medium text-muted" htmlFor={`why-${c.id}`}>Why hide it? The author sees this.</label>
                      <div className="mt-1.5 flex flex-wrap gap-1.5">{REASONS.map((r) => <button key={r} type="button" className="chip" aria-pressed={reason === r} onClick={() => setReason(r)}>{r}</button>)}</div>
                      <input id={`why-${c.id}`} className="field mt-2" maxLength={300} required value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Or write a reason" autoFocus />
                      <div className="mt-2 flex justify-end gap-2">
                        <button type="button" className="btn btn-sm btn-ghost" onClick={() => { setHiding(null); setReason(''); }}>Cancel</button>
                        <button className="btn btn-sm btn-primary" disabled={busy === c.id || !reason.trim()}><EyeOff size={14} aria-hidden="true" />Hide comment</button>
                      </div>
                    </motion.form>
                  )}
                </AnimatePresence>
              </div>
              <div className="crow-act">
                {c.hidden ? <button type="button" className="btn btn-sm btn-ghost" disabled={busy === c.id} onClick={() => unhide(c)}><Eye size={15} aria-hidden="true" />Unhide</button>
                  : !c.deleted && <button type="button" className="btn btn-sm btn-ghost" disabled={busy === c.id} aria-expanded={hiding === c.id} onClick={() => { setHiding(hiding === c.id ? null : c.id); setReason(''); }}><EyeOff size={15} aria-hidden="true" />Hide</button>}
                <button type="button" className="btn btn-sm btn-ghost !px-2 hover:text-bad" disabled={busy === c.id} onClick={() => remove(c)} aria-label={`Delete comment by @${c.username}`} title="Delete for good"><Trash2 size={15} aria-hidden="true" /></button>
              </div>
            </motion.li>
          ))}
        </AnimatePresence>
      </ol>
      {confirmDialog}
    </>
  );
}
