// Reports queue: each report with the item in context, and accept / reject / fixed with a note to the reporter.
import { useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { ArrowUpRight, Check, CircleCheckBig, FileText, Flag, Image, ListChecks, MessageSquare, NotebookText, X } from 'lucide-react';
import type { ReportRow } from '../../../server/admin';
import { toast } from '../../../scripts/toast';
import { ago, api, bump, fail, first, full, initials } from './kit';

export interface AdminReportsProps { reports: ReportRow[]; status: string | null; now: number; me: string }
export const KIND: Record<string, [string, string]> = {
  wrong: ['Wrong', 's-disputed'], source: ['Source issue', 's-edition'], typo: ['Typo', 's-unchecked'], unclear: ['Unclear', 's-unchecked'],
  duplicate: ['Duplicate', 's-neutral'], offensive: ['Offensive', 's-disputed'], other: ['Other', 's-neutral'],
};
export const STATUS: Record<string, [string, string]> = { open: ['Open', 's-unchecked'], accepted: ['Accepted', 's-agreed'], rejected: ['Rejected', 's-neutral'], fixed: ['Fixed', 's-cited'] };
const TYPE: Record<string, [string, typeof Flag]> = { fact: ['Fact', FileText], topic: ['Topic', NotebookText], mcq: ['MCQ', ListChecks], image: ['Image', Image], comment: ['Comment', MessageSquare], dispute: ['Disputed item', Flag] };
const LABEL: Record<string, string> = { cited: 'Cited', agreed: 'Agreed', unchecked: 'Unchecked', disputed: 'Disputed' };

export function ItemContext({ ctx }: { ctx: ReportRow['ctx'] }) {
  const [name, Ico] = TYPE[ctx.type] ?? ['Item', FileText];
  return (
    <div className={`ictx${ctx.missing ? ' is-missing' : ''}`}>
      <div className="ictx-h">
        <Ico size={14} aria-hidden="true" /><span>{name}</span>
        {ctx.label && <span className={`badge s-${ctx.label}`}>{LABEL[ctx.label] ?? ctx.label}</span>}
        {ctx.state && <span className="badge s-neutral">{ctx.state}</span>}
        <span className="num min-w-0 truncate">{ctx.sub}</span>
      </div>
      <p className="ictx-t">{ctx.title}</p>
      {(ctx.author || ctx.href) && (
        <div className="ictx-f">
          {ctx.author && <span className="text-muted">by {ctx.author}</span>}
          {ctx.href && <a href={ctx.href} className="ictx-open">Open {ctx.type === 'mcq' ? 'MCQ' : name.toLowerCase()}<ArrowUpRight size={14} aria-hidden="true" /></a>}
        </div>
      )}
    </div>
  );
}

export default function AdminReports({ reports: initial, status, now, me }: AdminReportsProps) {
  const reduce = useReducedMotion();
  const [list, setList] = useState(initial);
  const [notes, setNotes] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState<number | null>(null);

  async function resolve(r: ReportRow, next: 'accepted' | 'rejected' | 'fixed') {
    setBusy(r.id);
    try {
      const res = await api<{ status: string; resolution: string; resolvedAt: number }>(`/api/admin/reports/${r.id}`, 'POST', { status: next, resolution: notes[r.id] ?? '' });
      if (r.status === 'open') bump('moderation', -1);
      setNotes((n) => ({ ...n, [r.id]: '' }));
      setList((l) => (status && status !== next ? l.filter((x) => x.id !== r.id) : l.map((x) => (x.id === r.id ? { ...x, ...res, resolver: me } : x))));
      toast(`Report ${STATUS[next][0].toLowerCase()}. ${first(r.name)} was notified.`, 'ok');
    } catch (e) { fail(e); } finally { setBusy(null); }
  }

  if (!list.length) return (
    <div className="adm-clear panel">
      <span className="adm-ico is-ok"><CircleCheckBig size={20} aria-hidden="true" /></span>
      <h3 className="mt-3 font-medium">{status === 'open' ? 'No open reports' : 'Nothing here'}</h3>
      <p className="mt-1 max-w-sm text-sm text-muted">{status === 'open' ? 'When classmates report a wrong fact, a source problem or a typo, it lands here with the item beside it.' : 'No reports match these filters.'}</p>
    </div>
  );

  return (
    <ol className="rlist" aria-label="Reports">
      <AnimatePresence initial={false}>
        {list.map((r) => (
          <motion.li key={r.id} layout={reduce ? false : 'position'} exit={{ opacity: 0, x: reduce ? 0 : 24, transition: { duration: 0.2 } }} transition={{ type: 'spring', stiffness: 380, damping: 34 }}
            className="panel rcard" data-report={r.id} aria-labelledby={`r${r.id}-h`}>
            <header className="rc-h">
              <span className={`badge ${KIND[r.kind]?.[1] ?? 's-neutral'}`}>{KIND[r.kind]?.[0] ?? r.kind}</span>
              <span className={`badge ${STATUS[r.status][1]}`} data-status>{STATUS[r.status][0]}</span>
              <h3 id={`r${r.id}-h`} className="sr-only">Report {r.id}: {KIND[r.kind]?.[0]} on {TYPE[r.type]?.[0] ?? r.type} {r.itemId}</h3>
              <span className="ml-auto text-xs text-faint"><span className="num">#{r.id}</span> · <time dateTime={new Date(r.createdAt).toISOString()} title={full(r.createdAt)}>{ago(r.createdAt, now)}</time></span>
            </header>
            <ItemContext ctx={r.ctx} />
            <div className="rc-who">
              <span className="u-av sm" aria-hidden="true">{initials(r.name)}</span>
              <p className="min-w-0 text-sm"><span className="font-medium">{r.name}</span> <span className="num text-xs text-muted">@{r.username}</span>
                {r.path && <span className="text-muted"> · on <a href={r.path} className="num text-xs hover:text-accent">{r.path.length > 48 ? r.path.slice(0, 47) + '…' : r.path}</a></span>}</p>
            </div>
            {r.quote && <blockquote className="rc-quote"><span className="sr-only">Quoted text: </span>{r.quote}</blockquote>}
            {r.body ? <p className="rc-body">{r.body}</p> : <p className="rc-body text-faint">No details given.</p>}
            {r.status !== 'open' && (
              <div className="rc-res">
                <Check size={15} aria-hidden="true" className="mt-0.5 shrink-0" />
                <p className="min-w-0 text-sm"><span className="text-muted">{STATUS[r.status][0]} by @{r.resolver ?? 'admin'}{r.resolvedAt ? ` · ${ago(r.resolvedAt, Math.max(now, r.resolvedAt))}` : ''}</span>{r.resolution && <span className="mt-0.5 block whitespace-pre-line">{r.resolution}</span>}</p>
              </div>
            )}
            {r.status !== 'fixed' && (
              <div className="rc-act">
                <label className="block">
                  <span className="sr-only">Note to {r.name} (optional)</span>
                  <textarea className="lb-ta" rows={2} maxLength={1000} placeholder={r.status === 'open' ? `Note to ${first(r.name)} (optional): what you changed or why` : 'New note (optional); leave empty to keep the current one'} value={notes[r.id] ?? ''} onChange={(e) => setNotes({ ...notes, [r.id]: e.target.value })} />
                </label>
                <div className="rc-btns">
                  {r.status === 'open' && <button type="button" className="btn btn-sm btn-primary" disabled={busy === r.id} onClick={() => resolve(r, 'accepted')}><Check size={15} aria-hidden="true" />Accept</button>}
                  <button type="button" className="btn btn-sm" disabled={busy === r.id} onClick={() => resolve(r, 'fixed')}><CircleCheckBig size={15} aria-hidden="true" />Mark fixed</button>
                  {r.status !== 'rejected' ? <button type="button" className="btn btn-sm btn-ghost" disabled={busy === r.id} onClick={() => resolve(r, 'rejected')}><X size={15} aria-hidden="true" />Reject</button>
                    : <button type="button" className="btn btn-sm btn-ghost" disabled={busy === r.id} onClick={() => resolve(r, 'accepted')}><Check size={15} aria-hidden="true" />Accept instead</button>}
                </div>
              </div>
            )}
          </motion.li>
        ))}
      </AnimatePresence>
    </ol>
  );
}
