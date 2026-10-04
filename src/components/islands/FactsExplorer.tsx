import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowUpRight, Bookmark, ChevronDown, ExternalLink, Flag, Layers, Search, SlidersHorizontal, X } from 'lucide-react';
import { hasMark, loadMarks, marksVersion, subscribeMarks } from '../../scripts/marks';

type Fact = { id: string; file: string; unit: number; fact: string; kind: string; label: string; sources: string[]; accessDate: string; note: string; paperDiffers: string; edition: string; topics: string[]; system: string };
type Card = { factId: string; front: string; back: string };
const LABELS = [['cited', 'Cited'], ['agreed', 'Agreed'], ['unchecked', 'Unchecked'], ['disputed', 'Disputed']] as const;
const isClash = (f: Fact) => / vs |Paper:|Published Graf|AS PRINTED/.test(f.edition);
const host = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };

function Highlight({ text, q }: { text: string; q: string }) {
  if (q.length < 2) return <>{text}</>;
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return <>{text}</>;
  return <>{text.slice(0, i)}<mark className="rounded bg-signal/25 px-0.5 text-ink">{text.slice(i, i + q.length)}</mark>{text.slice(i + q.length)}</>;
}

export default function FactsExplorer({ systems, topicTitles }: { systems: Record<string, string>; topicTitles: Record<string, { title: string; system: string }> }) {
  const [facts, setFacts] = useState<Fact[] | null>(null);
  const [cards, setCards] = useState<Map<string, Card>>(new Map());
  const [q, setQ] = useState('');
  const [labels, setLabels] = useState<string[]>([]);
  const [system, setSystem] = useState('');
  const [kind, setKind] = useState('');
  const [file, setFile] = useState('');
  const [special, setSpecial] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [limit, setLimit] = useState(60);
  const focusId = useRef<string | null>(null);
  const marks = useSyncExternalStore(subscribeMarks, marksVersion, () => 0);

  useEffect(() => {
    const p = new URLSearchParams(location.search);
    setQ(p.get('q') || ''); setLabels(p.get('label')?.split(',').filter(Boolean) || []); setSystem(p.get('system') || '');
    setKind(p.get('kind') || ''); setFile(p.get('file') || ''); setSpecial(p.get('only') || '');
    focusId.current = p.get('id');
    loadMarks();
    Promise.all([fetch('/api/data/facts').then((r) => r.json()), fetch('/api/data/anki').then((r) => r.json())]).then(([f, a]: [Fact[], Card[]]) => {
      setFacts(f); setCards(new Map(a.map((c) => [c.factId, c])));
      if (focusId.current) { setOpen(focusId.current); setLimit(1000); }
    });
  }, []);

  useEffect(() => {
    const p = new URLSearchParams();
    if (q) p.set('q', q); if (labels.length) p.set('label', labels.join(',')); if (system) p.set('system', system);
    if (kind) p.set('kind', kind); if (file) p.set('file', file); if (special) p.set('only', special);
    history.replaceState(history.state, '', p.toString() ? `?${p}` : location.pathname);
    setLimit(60);
  }, [q, labels, system, kind, file, special]);

  useEffect(() => {
    if (facts && focusId.current) {
      const id = focusId.current; focusId.current = null;
      requestAnimationFrame(() => document.getElementById(`fact-${id}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }));
    }
  }, [facts]);

  const kinds = useMemo(() => [...new Set(facts?.map((f) => f.kind))].sort(), [facts]);
  const files = useMemo(() => [...new Set(facts?.map((f) => f.file))].sort(), [facts]);
  const shown = useMemo(() => {
    if (!facts) return [];
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    return facts.filter((f) =>
      (!labels.length || labels.includes(f.label)) && (!system || f.system === system) && (!kind || f.kind === kind) && (!file || f.file === file) &&
      (special !== 'paper' || f.paperDiffers) && (special !== 'edition' || isClash(f)) &&
      (special !== 'bookmarked' || hasMark('bookmark', 'fact', f.id)) && (special !== 'weak' || hasMark('weak', 'fact', f.id)) &&
      (!words.length || words.every((w) => `${f.id} ${f.fact} ${f.file} ${f.note}`.toLowerCase().includes(w))));
  }, [facts, q, labels, system, kind, file, special, marks]);

  const toggle = (l: string) => setLabels((s) => (s.includes(l) ? s.filter((x) => x !== l) : [...s, l]));
  const active = labels.length + (system ? 1 : 0) + (kind ? 1 : 0) + (file ? 1 : 0) + (special ? 1 : 0);
  const reset = () => { setQ(''); setLabels([]); setSystem(''); setKind(''); setFile(''); setSpecial(''); };

  return (
    <div>
      <div className="sticky top-[3.75rem] z-10 -mx-1 bg-bg/85 px-1 pb-3 pt-1 backdrop-blur-md max-md:top-[3.4rem]">
        <div className="flex gap-2">
          <label className="relative flex-1">
            <span className="sr-only">Search facts</span>
            <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
            <input className="field pl-9" placeholder="Search text, fact ID or source file" value={q} onChange={(e) => setQ(e.target.value)} />
          </label>
          <button type="button" className="btn md:hidden" onClick={() => setShowFilters((s) => !s)} aria-expanded={showFilters}><SlidersHorizontal size={16} />Filters{active > 0 && <span className="num text-accent">{active}</span>}</button>
        </div>
        <div className={`${showFilters ? 'flex' : 'hidden'} mt-3 flex-wrap items-center gap-2 md:flex`}>
          {LABELS.map(([v, l]) => (
            <button key={v} type="button" className="chip" aria-pressed={labels.includes(v)} onClick={() => toggle(v)}><span className={`h-1.5 w-1.5 rounded-full s-${v}`} style={{ background: 'var(--c)' }} />{l}</button>
          ))}
          <button type="button" className="chip" aria-pressed={special === 'paper'} onClick={() => setSpecial((s) => (s === 'paper' ? '' : 'paper'))}>Paper differs</button>
          <button type="button" className="chip" aria-pressed={special === 'edition'} onClick={() => setSpecial((s) => (s === 'edition' ? '' : 'edition'))}>Edition clash</button>
          <button type="button" className="chip" aria-pressed={special === 'bookmarked'} onClick={() => { loadMarks(); setSpecial((s) => (s === 'bookmarked' ? '' : 'bookmarked')); }}><Bookmark size={13} aria-hidden="true" />Bookmarked</button>
          <button type="button" className="chip" aria-pressed={special === 'weak'} onClick={() => { loadMarks(); setSpecial((s) => (s === 'weak' ? '' : 'weak')); }}><Flag size={13} aria-hidden="true" />Weak</button>
          <span className="mx-1 hidden h-5 w-px bg-line md:block" />
          <select className="field !h-8 !w-auto !py-0 text-sm" value={system} onChange={(e) => setSystem(e.target.value)} aria-label="System">
            <option value="">All systems</option>{Object.entries(systems).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <select className="field !h-8 !w-auto !py-0 text-sm" value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Kind">
            <option value="">All kinds</option>{kinds.map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
          <select className="field !h-8 !w-auto max-w-[14rem] !py-0 text-sm" value={file} onChange={(e) => setFile(e.target.value)} aria-label="Source file">
            <option value="">All source files</option>{files.map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
          {active + (q ? 1 : 0) > 0 && <button type="button" className="btn btn-sm btn-ghost" onClick={reset}><X size={14} />Clear</button>}
        </div>
      </div>

      <p className="mb-2 text-sm text-muted" aria-live="polite">{facts ? <>Showing <span className="num text-ink">{shown.length}</span> of <span className="num">{facts.length}</span> facts</> : 'Loading facts…'}</p>

      {!facts ? (
        <div className="space-y-2">{Array.from({ length: 8 }, (_, i) => <div key={i} className="skeleton h-16" />)}</div>
      ) : !shown.length ? (
        <div className="panel grid place-items-center gap-2 px-6 py-14 text-center"><p className="font-medium">{special === 'bookmarked' ? 'No bookmarked facts here' : special === 'weak' ? 'No facts marked weak here' : 'No facts match these filters'}</p><p className="text-sm text-muted">{special === 'bookmarked' || special === 'weak' ? 'Use the bookmark on any row, or mark facts weak from a flashcard or a fact card.' : 'Remove a filter or search for a shorter word.'}</p><button className="btn btn-sm mt-2" onClick={reset}>Clear all filters</button></div>
      ) : (
        <ul className="panel divide-y divide-line overflow-hidden">
          {shown.slice(0, limit).map((f) => {
            const isOpen = open === f.id, card = cards.get(f.id);
            return (
              <li key={f.id} id={`fact-${f.id}`} className={isOpen ? 'bg-ink/[0.025]' : ''}>
                <div className="relative flex items-start gap-3 px-4 py-3.5 transition-colors hover:bg-ink/[0.03]">
                  <span className={`mt-[0.55rem] h-1.5 w-1.5 shrink-0 rounded-full s-${f.label}`} style={{ background: 'var(--c)' }} />
                  <span className="min-w-0 flex-1">
                    {/* The text button stretches over the whole row; links and toggles sit above it. */}
                    <button type="button" className="block w-full text-left leading-relaxed after:absolute after:inset-0 after:content-['']" onClick={() => setOpen(isOpen ? null : f.id)} aria-expanded={isOpen}><Highlight text={f.fact} q={q} /></button>
                    <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-faint">
                      <a href={`/facts/${f.id}`} className="num relative z-[1] hover:text-accent hover:underline">{f.id}</a><span>·</span><span>{systems[f.system] ?? 'Other'}</span><span>·</span><span className="truncate">{f.file} p{f.unit}</span>
                      {f.paperDiffers && <span className="badge s-unchecked">paper differs</span>}{isClash(f) && <span className="badge s-edition">edition</span>}
                    </span>
                  </span>
                  <span className={`badge s-${f.label} shrink-0 max-sm:hidden`}>{f.label}</span>
                  <button type="button" className="btn btn-sm btn-ghost mk relative z-[1] -my-1 !h-8 !px-1.5" data-mark="bookmark" data-type="fact" data-id={f.id} aria-pressed="false" aria-label={`Bookmark ${f.id}`} title="Bookmark"><Bookmark size={15} aria-hidden="true" /></button>
                  <ChevronDown size={16} className={`mt-1 shrink-0 text-faint transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} aria-hidden="true" />
                </div>
                <AnimatePresence initial={false}>
                  {isOpen && (
                    <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }} className="overflow-hidden">
                      <div className="grid gap-5 px-4 pb-5 pl-[2.1rem] md:grid-cols-2">
                        <div className="space-y-3 text-sm">
                          {f.paperDiffers && <p className="rounded-lg bg-signal/10 px-3 py-2 text-signal"><span className="font-medium">Paper says:</span> {f.paperDiffers}</p>}
                          {isClash(f) && <p className="rounded-lg bg-edition/10 px-3 py-2 text-edition">{f.edition}</p>}
                          {f.sources.length > 0 && <div><div className="text-xs text-faint">Checked against{f.accessDate && ` (accessed ${f.accessDate})`}</div><ul className="mt-1 space-y-1">{f.sources.map((u) => <li key={u}><a href={u} target="_blank" rel="noopener noreferrer" className="inline-flex max-w-full items-center gap-1.5 text-accent hover:underline"><ExternalLink size={13} className="shrink-0" /><span className="truncate">{host(u)}{new URL(u).pathname.length > 1 ? ' › ' + decodeURIComponent(new URL(u).pathname.split('/').filter(Boolean).pop() || '').slice(0, 50) : ''}</span></a></li>)}</ul></div>}
                          {f.note && <div><div className="text-xs text-faint">Verification note</div><p className="mt-1 text-muted">{f.note}</p></div>}
                        </div>
                        <div className="space-y-3 text-sm">
                          {card && <div className="rounded-xl border border-line bg-sunk p-3"><div className="flex items-center gap-1.5 text-xs text-faint"><Layers size={13} />Flashcard</div><p className="mt-1.5 font-medium">{card.front}</p><p className="mt-1 text-muted">{card.back}</p></div>}
                          <a href={`/facts/${f.id}`} className="btn btn-sm">Open fact page<ArrowUpRight size={14} aria-hidden="true" /></a>
                          {f.topics.length > 0 && <div><div className="text-xs text-faint">In topic notes</div><div className="mt-1 flex flex-wrap gap-1.5">{f.topics.map((t) => topicTitles[t] && <a key={t} href={`/study/${topicTitles[t].system}/${t}`} className="chip">{topicTitles[t].title}</a>)}</div></div>}
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </li>
            );
          })}
        </ul>
      )}
      {shown.length > limit && <div className="mt-4 text-center"><button className="btn" onClick={() => setLimit((l) => l + 120)}>Show more ({shown.length - limit} left)</button></div>}
    </div>
  );
}
