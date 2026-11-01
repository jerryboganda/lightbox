// Bulk AI questions: pick thin topics, generate a few questions for each in turn, and send them all to the review queue.
import { useRef, useState } from 'react';
import { Check, CircleAlert, LoaderCircle, Square, WandSparkles } from 'lucide-react';
import type { BulkTopic } from '../../../server/admin';
import { toast } from '../../../scripts/toast';
import { bump, plural } from './kit';

type Row = { state: 'queued' | 'working' | 'done' | 'error'; note?: string };
const THIN = 10;

export default function AdminAiBulk({ topics }: { topics: BulkTopic[] }) {
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [n, setN] = useState(3);
  const [rows, setRows] = useState<Record<string, Row>>({});
  const [running, setRunning] = useState(false);
  const [left, setLeft] = useState<number | null>(null);
  const ac = useRef<AbortController | null>(null);

  if (!topics.length) return null;
  const toggle = (slug: string) => setSel((s) => { const x = new Set(s); x.has(slug) ? x.delete(slug) : x.add(slug); return x; });
  const set = (slug: string, r: Row) => setRows((m) => ({ ...m, [slug]: r }));

  async function run() {
    const list = topics.filter((t) => sel.has(t.slug)).map((t) => t.slug);
    if (!list.length) return;
    const c = (ac.current = new AbortController());
    setRunning(true);
    setRows(Object.fromEntries(list.map((s) => [s, { state: 'queued' } as Row])));
    let added = 0, failed = 0;
    for (const slug of list) {
      if (c.signal.aborted) break;
      set(slug, { state: 'working' });
      const r = await fetch('/api/ai/generate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ topicSlug: slug, n }), signal: c.signal }).catch(() => null);
      if (c.signal.aborted) { set(slug, { state: 'queued', note: 'Stopped' }); break; }
      const j = await r?.json().catch(() => null);
      if (j?.quota) setLeft(Math.max(0, j.quota.cap - j.quota.used));
      if (r?.ok && Array.isArray(j?.items)) {
        added += j.items.length;
        bump('ai', j.items.length);
        set(slug, { state: 'done', note: `${plural(j.items.length, 'question')} queued${j.dupes ? ` · ${j.dupes} duplicate${j.dupes === 1 ? '' : 's'} dropped` : ''}` });
      } else {
        failed++;
        set(slug, { state: 'error', note: j?.error ?? (r ? 'AI did not answer.' : 'You seem to be offline.') });
        if (r?.status === 429 || r?.status === 503) break; // a cap or a missing AI key stops the whole run
      }
    }
    setRunning(false);
    ac.current = null;
    toast(`${plural(added, 'question')} added to the review queue${failed ? ` · ${failed} topic${failed === 1 ? '' : 's'} failed` : ''}. Reload to review them.`, added ? 'ok' : 'bad');
  }

  const chosen = topics.filter((t) => sel.has(t.slug)).length;
  return (
    <section className="panel mt-6 p-4 sm:p-5" aria-labelledby="bulk-h">
      <header className="flex flex-wrap items-start gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1 basis-72">
          <h3 id="bulk-h" className="flex items-center gap-2 font-medium"><WandSparkles size={17} className="text-accent" aria-hidden="true" />Fill thin topics with AI questions</h3>
          <p className="mt-1 text-sm text-muted">Writes questions from each topic's verified facts only. They wait in the queue above until you approve them. Thinnest topics are listed first.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1.5 text-sm text-muted">Per topic
            <select className="field !h-8 !w-auto !py-0" value={n} onChange={(e) => setN(Number(e.target.value))} disabled={running}>{[1, 2, 3, 4, 5].map((k) => <option key={k} value={k}>{k}</option>)}</select>
          </label>
          {running
            ? <button type="button" className="btn btn-sm" onClick={() => ac.current?.abort()}><Square size={13} fill="currentColor" aria-hidden="true" />Stop</button>
            : <button type="button" className="btn btn-sm btn-primary" disabled={!chosen} onClick={run}><WandSparkles size={15} aria-hidden="true" />Generate {chosen ? `for ${plural(chosen, 'topic')}` : ''}</button>}
        </div>
      </header>
      <div className="mt-3 flex flex-wrap items-center gap-1.5 text-sm">
        <button type="button" className="chip" disabled={running} onClick={() => setSel(new Set(topics.slice(0, THIN).map((t) => t.slug)))}>Pick the {THIN} thinnest</button>
        {chosen > 0 && <button type="button" className="chip" disabled={running} onClick={() => setSel(new Set())}>Clear</button>}
        <span className="ml-auto text-xs text-faint">{chosen ? `${chosen} chosen · about ${chosen * n} questions · ${plural(chosen, 'AI request')}` : `${topics.length} topics with at least 3 verified facts`}{left !== null ? ` · ${left} requests left today` : ''}</span>
      </div>
      <div className="mt-3 max-h-80 overflow-y-auto rounded-lg border border-line" tabIndex={0} role="region" aria-label="Topics">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-panel text-xs text-faint"><tr>
            <th scope="col" className="w-8 p-2"><span className="sr-only">Choose</span></th>
            <th scope="col" className="p-2 text-left font-normal">Topic</th>
            <th scope="col" className="p-2 text-right font-normal" title="Verified facts">Facts</th>
            <th scope="col" className="p-2 text-right font-normal" title="Past-paper, approved and queued AI questions">Questions</th>
            <th scope="col" className="p-2 text-left font-normal max-sm:hidden">Status</th>
          </tr></thead>
          <tbody>
            {topics.map((t) => {
              const r = rows[t.slug];
              return (
                <tr key={t.slug} className="border-t border-line">
                  <td className="p-2"><input type="checkbox" checked={sel.has(t.slug)} disabled={running} onChange={() => toggle(t.slug)} aria-label={`Choose ${t.title}`} /></td>
                  <td className="p-2"><span className="block">{t.title}</span><span className="text-xs text-faint">{t.system}</span></td>
                  <td className="num p-2 text-right">{t.verified}</td>
                  <td className="num p-2 text-right" title={`${t.bank} past paper · ${t.approved} approved · ${t.pending} queued`}>{t.bank + t.approved + t.pending}</td>
                  <td className="p-2 text-xs max-sm:hidden" aria-live="polite">
                    {r?.state === 'working' && <span className="inline-flex items-center gap-1 text-accent"><LoaderCircle size={13} className="animate-spin" aria-hidden="true" />Writing…</span>}
                    {r?.state === 'queued' && <span className="text-faint">{r.note ?? 'Waiting'}</span>}
                    {r?.state === 'done' && <span className="inline-flex items-center gap-1 text-ok"><Check size={13} aria-hidden="true" />{r.note}</span>}
                    {r?.state === 'error' && <span className="inline-flex items-center gap-1 text-bad"><CircleAlert size={13} aria-hidden="true" />{r.note}</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
