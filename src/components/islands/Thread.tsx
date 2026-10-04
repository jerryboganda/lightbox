// Discussion thread: one level of replies, upvotes, edit/delete own, report others; place with client:visible.
// Comments are classmates' words, shown as plain text and labelled as unverified.
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowBigUp, ChevronDown, Flag, LoaderCircle, MessageSquareReply, MessagesSquare, Pencil, RotateCcw, Trash2 } from 'lucide-react';
import { toast } from '../../scripts/toast';
import { reduced } from '../../scripts/motion';
import { ago, fullDate, initials, send } from '../../scripts/class';
import { ReportDialog, type ReportTarget } from './ReportButton';
import '../../styles/class.css';

export interface ThreadProps { itemType: 'fact' | 'topic' | 'mcq' | 'image' | 'dispute'; itemId: string; title?: string; compact?: boolean }
type C = {
  id: number; parentId: number | null; author: { id: number; name: string; admin: boolean } | null; body: string; createdAt: number; editedAt: number | null;
  deleted: boolean; hidden: boolean; hiddenReason?: string; votes: number; mine: boolean; own: boolean; pending?: boolean; k?: string;
};
type Me = { name: string; admin: boolean };
const MAX = 2000;
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
const isMac = () => typeof navigator !== 'undefined' && /Mac|iP(hone|ad)/.test(navigator.platform);

function Composer({ label, placeholder, submit, onSubmit, onCancel, initial = '', autoFocus = false }: {
  label: string; placeholder: string; submit: string; onSubmit: (body: string) => Promise<boolean>; onCancel?: () => void; initial?: string; autoFocus?: boolean;
}) {
  const [v, setV] = useState(initial);
  const [busy, setBusy] = useState(false);
  const ta = useRef<HTMLTextAreaElement>(null);
  const id = useId();
  useLayoutEffect(() => {
    const t = ta.current;
    if (!t) return;
    t.style.height = 'auto';
    t.style.height = `${t.scrollHeight}px`;
  }, [v]);
  useEffect(() => {
    const t = ta.current;
    if (autoFocus && t) { t.focus({ preventScroll: false }); t.setSelectionRange(t.value.length, t.value.length); }
  }, [autoFocus]);
  // Optimistic: the box clears at once and gets the text back if the post fails.
  const go = async () => {
    const s = v.trim();
    if (!s || s.length > MAX || busy) return;
    setBusy(true);
    if (!initial) setV('');
    const ok = await onSubmit(s);
    setBusy(false);
    if (!ok && !initial) setV(s);
  };
  const key = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); go(); }
    else if (e.key === 'Escape' && onCancel) { e.preventDefault(); e.stopPropagation(); onCancel(); }
  };
  const left = MAX - v.length;
  return (
    <div className="lb-compose">
      <label className="sr-only" htmlFor={id}>{label}</label>
      <textarea id={id} ref={ta} rows={1} maxLength={MAX} value={v} placeholder={placeholder} onChange={(e) => setV(e.target.value)} onKeyDown={key} />
      <footer>
        <span className="min-w-0 flex-1 truncate">{left < 300 ? '' : 'Visible to the class · not verified'}</span>
        {left < 300 && <span className={`lb-count num ${left <= 0 ? 'is-over' : 'is-near'}`}>{left} left</span>}
        <span className="kbd max-sm:hidden" aria-hidden="true">{isMac() ? '⌘' : 'Ctrl'} Enter</span>
        {onCancel && <button type="button" className="btn btn-sm btn-ghost" onClick={onCancel}>Cancel</button>}
        <button type="button" className="btn btn-sm btn-primary" disabled={!v.trim() || busy} onClick={go} aria-keyshortcuts="Control+Enter Meta+Enter">
          {busy && <LoaderCircle size={14} className="animate-spin" aria-hidden="true" />}{submit}
        </button>
      </footer>
    </div>
  );
}

export default function Thread({ itemType, itemId, title = 'Discussion', compact = false }: ThreadProps) {
  const [list, setList] = useState<C[] | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [failed, setFailed] = useState(false);
  const [sort, setSort] = useState<'top' | 'new'>('top');
  const [open, setOpen] = useState(!compact);
  const [reply, setReply] = useState<number | null>(null);
  const [edit, setEdit] = useState<number | null>(null);
  const [armed, setArmed] = useState<number | null>(null);
  const [more, setMore] = useState<Set<number>>(new Set());
  const [report, setReport] = useState<ReportTarget | null>(null);
  const [fresh, setFresh] = useState<number | null>(null);
  const [popped, setPopped] = useState<number | null>(null);
  const [live, setLive] = useState('');
  const mineNew = useRef(new Set<number>());
  const armTimer = useRef(0);
  const uid = useId();
  const rm = typeof document !== 'undefined' && reduced();
  const q = `type=${itemType}&id=${encodeURIComponent(itemId)}`;

  const load = useCallback(() => {
    setFailed(false);
    fetch(`/api/comments?${q}`).then((r) => (r.ok ? r.json() : Promise.reject())).then((d: { comments: C[]; me: Me }) => { setList(d.comments); setMe(d.me); })
      .catch(() => setFailed(true));
  }, [q]);
  useEffect(load, [load]);

  // A link to #c-<id> opens the thread and brings that comment into view.
  useEffect(() => {
    const id = Number(location.hash.match(/^#c-(\d+)$/)?.[1]);
    if (!list || !id || !list.some((c) => c.id === id)) return;
    setOpen(true);
    setFresh(id);
    requestAnimationFrame(() => document.getElementById(`c-${id}`)?.scrollIntoView({ block: 'center', behavior: rm ? 'auto' : 'smooth' }));
  }, [list === null]);

  const patch = (id: number, p: Partial<C>) => setList((l) => l && l.map((c) => (c.id === id ? { ...c, ...p } : c)));

  const post = async (body: string, parentId: number | null) => {
    const temp: C = { id: -Date.now(), k: `t${Date.now()}`, parentId, author: { id: 0, name: me?.name ?? 'You', admin: !!me?.admin }, body, createdAt: Date.now(), editedAt: null,
      deleted: false, hidden: false, votes: 0, mine: false, own: true, pending: true };
    if (!parentId) mineNew.current.add(temp.id);
    setList((l) => [...(l ?? []), temp]);
    try {
      const { comment } = await send<{ comment: C }>('/api/comments', 'POST', { type: itemType, id: itemId, body, parentId });
      if (!parentId) mineNew.current.add(comment.id);
      setList((l) => l && l.map((c) => (c.id === temp.id ? { ...comment, k: temp.k } : c)));
      setFresh(comment.id);
      setLive(parentId ? 'Reply posted.' : 'Comment posted.');
      if (parentId) setReply(null);
      return true;
    } catch (e) {
      setList((l) => l && l.filter((c) => c.id !== temp.id));
      toast((e as Error).message, 'bad');
      return false;
    }
  };

  const vote = async (c: C) => {
    const on = !c.mine;
    patch(c.id, { mine: on, votes: c.votes + (on ? 1 : -1) });
    if (on) { setPopped(c.id); navigator.vibrate?.(8); }
    try { patch(c.id, await send<{ votes: number; mine: boolean }>('/api/votes', 'POST', { type: 'comment', id: c.id, on })); }
    catch (e) { patch(c.id, { mine: c.mine, votes: c.votes }); toast((e as Error).message, 'bad'); }
  };

  const save = async (c: C, body: string) => {
    if (body === c.body) { setEdit(null); return true; }
    patch(c.id, { body, editedAt: Date.now() });
    setEdit(null);
    try {
      const { comment } = await send<{ comment: C }>(`/api/comments/${c.id}`, 'PATCH', { body });
      patch(c.id, comment);
      setLive('Comment updated.');
      return true;
    } catch (e) {
      patch(c.id, { body: c.body, editedAt: c.editedAt });
      toast((e as Error).message, 'bad');
      return false;
    }
  };

  // Two-step delete: the first press arms the button for a few seconds.
  const del = async (c: C) => {
    clearTimeout(armTimer.current);
    if (armed !== c.id) { setArmed(c.id); armTimer.current = window.setTimeout(() => setArmed(null), 3500); return; }
    setArmed(null);
    const before = list;
    setList((l) => l && l.map((x) => (x.id === c.id ? { ...x, deleted: true, body: '', author: null, votes: 0, mine: false } : x)));
    try { await send(`/api/comments/${c.id}`, 'DELETE'); setLive('Comment deleted.'); }
    catch (e) { setList(before); toast((e as Error).message, 'bad'); }
  };

  const kids = useMemo(() => {
    const m = new Map<number, C[]>();
    for (const c of list ?? []) if (c.parentId !== null) (m.get(c.parentId) ?? m.set(c.parentId, []).get(c.parentId)!).push(c);
    for (const v of m.values()) v.sort((a, b) => a.createdAt - b.createdAt);
    return m;
  }, [list]);
  const liveKids = (id: number) => (kids.get(id) ?? []).filter((c) => !c.deleted);
  const tops = useMemo(() => {
    const t = (list ?? []).filter((c) => c.parentId === null && (!c.deleted || liveKids(c.id).length));
    const pin = (c: C) => (mineNew.current.has(c.id) ? 1 : 0);
    return t.sort((a, b) => pin(b) - pin(a) || (sort === 'top' ? b.votes - a.votes : 0) || b.createdAt - a.createdAt);
  }, [list, kids, sort]);
  const count = (list ?? []).filter((c) => !c.deleted && !c.hidden).length;

  const spring = rm ? { duration: 0.12 } : { type: 'spring' as const, stiffness: 520, damping: 30, mass: 0.7 };

  const item = (c: C, isReply: boolean) => {
    const masked = c.deleted || (c.hidden && !me?.admin);
    const replies = isReply ? [] : (kids.get(c.id) ?? []).filter((r) => !r.deleted);
    const shown = replies.length > 3 && !more.has(c.id) ? replies.slice(0, 2) : replies;
    const editing = edit === c.id;
    const canAct = !c.deleted && !c.pending;
    return (
      <motion.li key={c.k ?? c.id} id={c.id > 0 ? `c-${c.id}` : undefined} layout={rm ? false : 'position'} initial={{ opacity: 0, y: rm ? 0 : 8 }} animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, transition: { duration: 0.12 } }} transition={spring} className={`lb-c${fresh === c.id ? ' is-new' : ''}${c.pending ? ' is-pending' : ''}`}>
        <span className={`lb-av${isReply ? ' sm' : ''}${masked ? ' is-ghost' : c.author?.admin ? ' is-admin' : ''}`} aria-hidden="true">{masked ? '' : initials(c.author?.name ?? '')}</span>
        <div className="min-w-0">
          <div className="lb-c-meta">
            {masked ? <span className="soft">{c.deleted ? 'Removed' : 'Moderated'}</span> : <span className="who">{c.author?.name}</span>}
            {!masked && c.author?.admin && <span className="badge s-edition !py-0.5">Admin</span>}
            {!masked && c.own && <span className="soft">You</span>}
            <time dateTime={new Date(c.createdAt).toISOString()} title={fullDate(c.createdAt)}>{c.pending ? 'Posting…' : ago(c.createdAt)}</time>
            {!masked && c.editedAt && <span className="soft" title={`Edited ${fullDate(c.editedAt)}`}>· edited</span>}
          </div>
          {c.deleted ? <p className="lb-c-gone">[deleted]</p>
            : c.hidden && !me?.admin ? <p className="lb-c-gone">Hidden by a moderator</p>
            : editing ? <div className="mt-2"><Composer label="Edit your comment" placeholder="Edit your comment" submit="Save" initial={c.body} autoFocus onSubmit={(b) => save(c, b)} onCancel={() => setEdit(null)} /></div>
            : <>
                <p className="lb-c-body">{c.body}</p>
                {c.hidden && <p className="lb-c-mod text-xs text-muted"><span className="font-medium text-bad">Hidden by a moderator</span>{c.hiddenReason ? `: ${c.hiddenReason}` : ''}. Only admins see this text.</p>}
              </>}
          {canAct && !c.hidden && !editing && (
            <div className="lb-acts">
              {c.own ? (
                <span className="lb-act lb-up is-static" title="Upvotes on your comment"><ArrowBigUp size={16} aria-hidden="true" /><span className="num" aria-hidden="true">{c.votes}</span><span className="sr-only">{plural(c.votes, 'upvote')}</span></span>
              ) : (
                <button type="button" className="lb-act lb-up" aria-pressed={c.mine} aria-label={`Upvote, ${plural(c.votes, 'vote')}`} onClick={() => vote(c)}>
                  <motion.span key={String(c.mine)} className="grid" initial={popped === c.id && c.mine && !rm ? { scale: 0.5, y: 3 } : false} animate={{ scale: 1, y: 0 }} transition={{ type: 'spring', stiffness: 640, damping: 14 }}>
                    <ArrowBigUp size={16} aria-hidden="true" />
                  </motion.span>
                  <span className="lb-num num" aria-hidden="true">
                    <AnimatePresence initial={false} mode="popLayout">
                      <motion.span key={c.votes} initial={{ y: rm ? 0 : c.mine ? 10 : -10, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: rm ? 0 : c.mine ? -10 : 10, opacity: 0 }} transition={spring}>{c.votes}</motion.span>
                    </AnimatePresence>
                  </span>
                </button>
              )}
              {!isReply && <button type="button" className="lb-act" aria-expanded={reply === c.id} onClick={() => setReply(reply === c.id ? null : c.id)}><MessageSquareReply size={15} aria-hidden="true" />Reply</button>}
              {c.own && <button type="button" className="lb-act" onClick={() => { setEdit(c.id); setReply(null); }}><Pencil size={14} aria-hidden="true" />Edit</button>}
              {c.own && <button type="button" className={`lb-act is-danger${armed === c.id ? ' is-armed' : ''}`} onClick={() => del(c)} aria-live="polite"><Trash2 size={14} aria-hidden="true" />{armed === c.id ? 'Delete?' : 'Delete'}</button>}
              {!c.own && <button type="button" className="lb-act" aria-label={`Report comment by ${c.author?.name ?? 'a classmate'}`} title="Report this comment" aria-haspopup="dialog" onClick={() => setReport({ itemType: 'comment', itemId: String(c.id) })}><Flag size={14} aria-hidden="true" /><span className="max-sm:hidden">Report</span></button>}
            </div>
          )}
          {!isReply && (shown.length > 0 || reply === c.id) && (
            <div className="lb-replies">
              <ul className="grid gap-0.5" aria-label={`Replies to ${c.author?.name ?? 'a removed comment'}`}>
                <AnimatePresence initial={false}>{shown.map((r) => item(r, true))}</AnimatePresence>
              </ul>
              {shown.length < replies.length && (
                <button type="button" className="lb-more" onClick={() => setMore((s) => new Set(s).add(c.id))}><ChevronDown size={14} aria-hidden="true" />Show {replies.length - shown.length} more {replies.length - shown.length === 1 ? 'reply' : 'replies'}</button>
              )}
              {reply === c.id && (
                <div className="py-2 pl-1">
                  <Composer label={`Reply to ${c.author?.name ?? 'this comment'}`} placeholder={`Reply to ${c.author?.name?.split(' ')[0] ?? 'this comment'}…`} submit="Reply" autoFocus
                    onSubmit={(b) => post(b, c.id)} onCancel={() => setReply(null)} />
                </div>
              )}
            </div>
          )}
        </div>
      </motion.li>
    );
  };

  const composer = me && (
    <Composer label={`Add to the ${title.toLowerCase()}`} placeholder={count ? 'Add to the discussion…' : 'Ask a question, share a mnemonic or flag a doubt…'} submit="Post" onSubmit={(b) => post(b, null)} />
  );
  const body = failed ? (
    <p className="flex flex-wrap items-center gap-3 py-4 text-sm text-muted" role="alert">Couldn't load the discussion.<button type="button" className="btn btn-sm" onClick={load}><RotateCcw size={14} aria-hidden="true" />Try again</button></p>
  ) : !list ? (
    <div className="grid gap-3 py-2" aria-hidden="true"><div className="skeleton h-12" /><div className="flex gap-3"><div className="skeleton h-8 w-8 !rounded-full" /><div className="skeleton h-12 flex-1" /></div></div>
  ) : (
    <>
      {!compact && composer && <div className="mt-4">{composer}</div>}
      {tops.length ? (
        <ul className="lb-clist mt-3" aria-label="Comments">
          <AnimatePresence initial={false}>{tops.map((c) => item(c, false))}</AnimatePresence>
        </ul>
      ) : !compact && (
        <div className="lb-empty">
          <span className="ico"><MessagesSquare size={20} aria-hidden="true" /></span>
          <p className="font-medium">No discussion yet</p>
          <p className="max-w-[46ch] text-sm text-muted">Start it: a question, a mnemonic or a doubt about the source. Your classmates see it here.</p>
        </div>
      )}
      {compact && composer && <div className="mt-2">{composer}</div>}
    </>
  );

  const reportDlg = <ReportDialog target={report} onClose={() => setReport(null)} />;
  const announcer = <p className="sr-only" aria-live="polite">{live}</p>;

  if (compact) return (
    <div className="lb-thread is-compact" data-thread data-no-highlight>
      <button type="button" className="lb-trow" aria-expanded={open} aria-controls={`${uid}-b`} onClick={() => setOpen((o) => !o)}>
        <MessagesSquare size={15} aria-hidden="true" className="shrink-0" />
        <span className="font-medium text-ink">Discussion</span>
        <span aria-hidden="true">·</span>
        <span className="num truncate">{list ? (count ? plural(count, 'comment') : 'Start one') : '…'}</span>
        <ChevronDown size={15} aria-hidden="true" className="chev shrink-0" />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div id={`${uid}-b`} className="lb-tbody" initial={{ opacity: 0, y: rm ? 0 : -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, transition: { duration: 0.1 } }} transition={spring}>
            {body}
          </motion.div>
        )}
      </AnimatePresence>
      {reportDlg}{announcer}
    </div>
  );

  return (
    <section id="discussion" className="lb-thread scroll-mt-24" aria-labelledby={`${uid}-h`} data-thread data-no-highlight>
      <div className="lb-th-h">
        <h2 id={`${uid}-h`} className="flex items-center gap-2"><MessagesSquare size={18} className="text-accent" aria-hidden="true" />{title}{list && count > 0 && <span className="badge s-neutral">{count}</span>}</h2>
        <span className="text-xs text-faint">Classmates' comments, not verified by Lightbox</span>
        {tops.length > 1 && (
          <div className="seg ml-auto" role="radiogroup" aria-label="Sort comments">
            {(['top', 'new'] as const).map((s) => <button key={s} type="button" role="radio" aria-checked={sort === s} onClick={() => setSort(s)}>{s === 'top' ? 'Top' : 'New'}</button>)}
          </div>
        )}
      </div>
      {body}
      {reportDlg}{announcer}
    </section>
  );
}
