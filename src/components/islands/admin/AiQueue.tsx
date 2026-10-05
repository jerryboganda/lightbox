// AI question review: edit inline, check against the grounding facts, approve or reject with a reason.
import { useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { ArrowUpRight, Check, CircleCheckBig, Plus, Save, Sparkles, X } from 'lucide-react';
import type { AiRow } from '../../../server/admin';
import { toast } from '../../../scripts/toast';
import { ago, api, bump, fail, full } from './kit';

export interface AdminAiProps { items: AiRow[]; status: string; now: number }
const KEYS = 'ABCDEF';
const LABEL: Record<string, string> = { cited: 'Cited', agreed: 'Agreed', unchecked: 'Unchecked', disputed: 'Disputed' };
const REASONS = ['Not supported by the cited facts', 'Key is wrong', 'Ambiguous stem or options', 'Duplicates an existing question'];
type Draft = { stem: string; options: string[]; key: string; explanation: string };
const draftOf = (m: AiRow): Draft => ({ stem: m.stem, options: [...m.options], key: m.key, explanation: m.explanation });
const same = (a: Draft, b: Draft) => a.stem === b.stem && a.key === b.key && a.explanation === b.explanation && a.options.join('\u0000') === b.options.join('\u0000');

export default function AdminAiQueue({ items: initial, status, now }: AdminAiProps) {
  const reduce = useReducedMotion();
  const [items, setItems] = useState(initial);

  if (!items.length) return (
    <div className="adm-clear panel">
      <span className={`adm-ico${status === 'pending' ? ' is-ok' : ''}`}>{status === 'pending' ? <CircleCheckBig size={20} aria-hidden="true" /> : <Sparkles size={20} aria-hidden="true" />}</span>
      <h3 className="mt-3 font-medium">{status === 'pending' ? 'Queue is clear' : `No ${status} questions yet`}</h3>
      <p className="mt-1 max-w-sm text-sm text-muted">Questions classmates generate with AI wait here until an admin checks them against the facts they cite. Only approved ones reach the practice bank.</p>
    </div>
  );

  return (
    <ol className="ailist" aria-label={`${status} AI questions`}>
      <AnimatePresence initial={false}>
        {items.map((m) => (
          <motion.li key={m.id} layout={reduce ? false : 'position'} exit={{ opacity: 0, x: reduce ? 0 : 28, transition: { duration: 0.22 } }} transition={{ type: 'spring', stiffness: 360, damping: 34 }} className="panel aicard" data-aimcq={m.id}>
            {m.status === 'pending'
              ? <Editor m={m} now={now} onDone={() => { setItems((l) => l.filter((x) => x.id !== m.id)); bump('ai', -1); }} />
              : <ReadOnly m={m} now={now} />}
          </motion.li>
        ))}
      </AnimatePresence>
    </ol>
  );
}

function Meta({ m, now }: { m: AiRow; now: number }) {
  return (
    <header className="ai-h">
      <span className="ai-tag"><Sparkles size={13} aria-hidden="true" />AI draft · unverified</span>
      {m.topic && <a href={m.topic.href} className="text-xs text-muted hover:text-accent">{m.topic.title}</a>}
      <span className="ml-auto text-xs text-faint"><span className="num">#{m.id}</span> · {m.creatorName ? <>by {m.creatorName}</> : 'creator removed'} · <time dateTime={new Date(m.createdAt).toISOString()} title={full(m.createdAt)}>{ago(m.createdAt, now)}</time></span>
    </header>
  );
}

function Facts({ m }: { m: AiRow }) {
  return (
    <section className="ai-facts" aria-label="Grounding facts">
      <h4 className="text-xs font-medium uppercase tracking-wide text-faint">Grounded on {m.facts.length} fact{m.facts.length === 1 ? '' : 's'}</h4>
      {m.facts.length ? (
        <ul className="mt-2 space-y-2">
          {m.facts.map((f) => (
            <li key={f.id} className={`ai-fact${f.missing ? ' is-missing' : ''}`}>
              <div className="flex flex-wrap items-center gap-1.5 text-xs">
                {f.missing ? <span className="num text-faint">{f.id}</span> : <a href={`/facts/${f.id}`} className="num text-accent hover:underline">{f.id}<ArrowUpRight size={11} className="inline" aria-hidden="true" /></a>}
                {f.label && <span className={`badge s-${f.label}`}>{LABEL[f.label] ?? f.label}</span>}
                <span className="truncate text-faint">{f.sub}</span>
              </div>
              <p className="mt-1 text-sm leading-relaxed">{f.text}</p>
            </li>
          ))}
        </ul>
      ) : <p className="mt-2 text-sm text-bad">No grounding facts were attached. Reject unless you can verify it yourself.</p>}
    </section>
  );
}

function ReadOnly({ m, now }: { m: AiRow; now: number }) {
  return (
    <>
      <Meta m={m} now={now} />
      <p className="ai-stem">{m.stem}</p>
      <ol className="ai-ro">{m.options.map((o, i) => <li key={i} className={KEYS[i] === m.key ? 'is-key' : ''}><span className="pb-key num">{KEYS[i]}</span><span>{o}</span>{KEYS[i] === m.key && <span className="badge s-cited ml-auto">key</span>}</li>)}</ol>
      {m.explanation && <p className="mt-3 text-sm text-muted whitespace-pre-line">{m.explanation}</p>}
      <p className="mt-3 flex items-center gap-1.5 text-xs text-muted">{m.status === 'approved' ? <Check size={14} className="text-ok" aria-hidden="true" /> : <X size={14} className="text-bad" aria-hidden="true" />}
        {m.status === 'approved' ? 'Approved' : 'Rejected'} by @{m.reviewer ?? 'admin'}{m.reviewedAt ? ` · ${ago(m.reviewedAt, now)}` : ''}</p>
      <details className="mt-3"><summary className="cursor-pointer text-xs text-muted hover:text-ink">Grounding facts</summary><div className="mt-2"><Facts m={m} /></div></details>
    </>
  );
}

function Editor({ m, now, onDone }: { m: AiRow; now: number; onDone: () => void }) {
  const reduce = useReducedMotion();
  const [saved, setSaved] = useState(() => draftOf(m));
  const [d, setD] = useState(() => draftOf(m));
  const [busy, setBusy] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const dirty = !same(d, saved);
  const keys = KEYS.slice(0, d.options.length).split('');

  const setOpt = (i: number, v: string) => setD({ ...d, options: d.options.map((o, j) => (j === i ? v : o)) });
  const delOpt = (i: number) => {
    const options = d.options.filter((_, j) => j !== i);
    const ki = KEYS.indexOf(d.key);
    setD({ ...d, options, key: ki === i ? '' : ki > i ? KEYS[ki - 1] : d.key });
  };

  async function save() {
    setBusy(true);
    try { await api(`/api/admin/ai-mcqs/${m.id}`, 'PATCH', d); setSaved(d); toast('Edits saved.', 'ok'); } catch (e) { fail(e); } finally { setBusy(false); }
  }
  async function decide(decision: 'approve' | 'reject') {
    setBusy(true);
    try {
      await api(`/api/admin/ai-mcqs/${m.id}`, 'POST', decision === 'approve' ? { decision, edits: dirty ? d : undefined } : { decision, reason });
      toast(decision === 'approve' ? 'Approved. It joins the AI practice set.' : 'Rejected. The creator was told why.', 'ok');
      onDone();
    } catch (e) { fail(e); setBusy(false); }
  }

  return (
    <>
      <Meta m={m} now={now} />
      <div className="ai-grid">
        <div className="min-w-0">
          <label className="ai-lbl" htmlFor={`stem-${m.id}`}>Stem</label>
          <textarea id={`stem-${m.id}`} className="lb-ta ai-stem-in" rows={Math.min(8, Math.max(3, Math.ceil(d.stem.length / 70)))} maxLength={1500} value={d.stem} onChange={(e) => setD({ ...d, stem: e.target.value })} />
          <fieldset className="mt-3">
            <legend className="ai-lbl">Options <span className="font-normal text-faint">· choose the key</span></legend>
            <ol className="ai-opts">
              {d.options.map((o, i) => (
                <li key={i} className={d.key === keys[i] ? 'is-key' : ''}>
                  <label className="ai-key" title={`Make ${keys[i]} the key`}>
                    <input type="radio" name={`key-${m.id}`} checked={d.key === keys[i]} onChange={() => setD({ ...d, key: keys[i] })} aria-label={`${keys[i]} is the key`} />
                    <span className="num" aria-hidden="true">{keys[i]}</span>
                  </label>
                  <input className="field" maxLength={400} value={o} onChange={(e) => setOpt(i, e.target.value)} aria-label={`Option ${keys[i]}`} />
                  <button type="button" className="btn btn-sm btn-ghost !px-2" disabled={d.options.length <= 2} onClick={() => delOpt(i)} aria-label={`Remove option ${keys[i]}`}><X size={15} aria-hidden="true" /></button>
                </li>
              ))}
            </ol>
            {d.options.length < 6 && <button type="button" className="btn btn-sm btn-ghost mt-1 -ml-1" onClick={() => setD({ ...d, options: [...d.options, ''] })}><Plus size={15} aria-hidden="true" />Add option</button>}
            {!d.key && <p className="mt-1 text-xs text-bad" role="alert">Choose which option is the key.</p>}
          </fieldset>
          <label className="ai-lbl mt-3" htmlFor={`exp-${m.id}`}>Explanation</label>
          <textarea id={`exp-${m.id}`} className="lb-ta" rows={3} maxLength={3000} value={d.explanation} onChange={(e) => setD({ ...d, explanation: e.target.value })} />
        </div>
        <Facts m={m} />
      </div>
      <AnimatePresence initial={false}>
        {rejecting && (
          <motion.form key="rej" initial={{ opacity: 0, y: reduce ? 0 : -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="ai-rej" onSubmit={(e) => { e.preventDefault(); if (reason.trim()) decide('reject'); }}>
            <label className="block text-xs font-medium text-muted" htmlFor={`rej-${m.id}`}>Why reject it? The creator sees this.</label>
            <div className="mt-1.5 flex flex-wrap gap-1.5">{REASONS.map((r) => <button key={r} type="button" className="chip" aria-pressed={reason === r} onClick={() => setReason(r)}>{r}</button>)}</div>
            <div className="mt-2 flex flex-wrap gap-2">
              <input id={`rej-${m.id}`} className="field min-w-0 flex-1 basis-60" maxLength={300} required value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Or write a reason" autoFocus />
              <button type="button" className="btn btn-ghost" onClick={() => { setRejecting(false); setReason(''); }}>Cancel</button>
              <button className="btn btn-danger" disabled={busy || !reason.trim()}><X size={15} aria-hidden="true" />Reject question</button>
            </div>
          </motion.form>
        )}
      </AnimatePresence>
      <footer className="ai-f">
        <p className="mr-auto text-xs text-faint">{dirty ? 'Unsaved edits. Approving saves them.' : 'Nothing reaches the practice bank until you approve it.'}</p>
        <button type="button" className="btn btn-sm btn-ghost" disabled={busy || !dirty || !d.key} onClick={save}><Save size={15} aria-hidden="true" />Save edits</button>
        <button type="button" className="btn btn-sm" disabled={busy} aria-expanded={rejecting} onClick={() => setRejecting(!rejecting)}><X size={15} aria-hidden="true" />Reject</button>
        <button type="button" className="btn btn-sm btn-primary" disabled={busy || !d.key} onClick={() => decide('approve')}><Check size={15} aria-hidden="true" />Approve</button>
      </footer>
    </>
  );
}
