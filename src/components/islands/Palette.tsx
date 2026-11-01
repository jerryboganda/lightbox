import { useEffect, useMemo, useRef, useState } from 'react';
import { Command } from 'cmdk';
import MiniSearch, { type Query } from 'minisearch';
import { AnimatePresence, motion } from 'motion/react';
import { navigate } from 'astro:transitions/client';
import { Bell, Bot, MessagesSquare, Sparkles, BookOpenText, Bookmark, ChartNoAxesCombined, CircleHelp, Columns3, FileText, Image, LayoutDashboard, Layers, ListChecks, Maximize2, MoonStar, ScanEye, Search, ShieldAlert, Target, Timer, Images, UsersRound, CornerDownLeft, Clock, Keyboard, Wand, X } from 'lucide-react';
import { expansions } from '../../lib/synonyms';

type Doc = { id: string; type: 'topic' | 'fact' | 'mcq' | 'image'; title: string; text: string; href: string; label?: string; body?: string; tp?: string[]; sys?: string[] };
const TYPE = { topic: { icon: BookOpenText, name: 'Topics' }, fact: { icon: FileText, name: 'Facts' }, mcq: { icon: CircleHelp, name: 'MCQs' }, image: { icon: Image, name: 'Atlas' } };
const LABEL_COLOR: Record<string, string> = { cited: 's-cited', agreed: 's-agreed', unchecked: 's-unchecked', disputed: 's-disputed' };
const RECENT_KEY = 'lb:recent-searches';
const readRecent = (): string[] => { try { const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]'); return Array.isArray(v) ? v.filter((x) => typeof x === 'string').slice(0, 6) : []; } catch { return []; } };
type Scope = 'all' | 'topic' | 'system';
type Here = { system: string; slug: string; title: string; sysLabel: string } | null;
/** The topic page the palette was opened on, for the "In this topic" filter. */
const whereAmI = (): Here => {
  const m = location.pathname.match(/^\/study\/([a-z0-9-]+)\/([a-z0-9-]+)\/?$/i);
  if (!m || m[2] === 'print') return null;
  const sysLink = document.querySelector<HTMLAnchorElement>(`nav[aria-label="Breadcrumb"] a[href="/study/${m[1]}"]`);
  return { system: m[1], slug: m[2], title: document.querySelector('main h1, h1')?.textContent?.trim() || 'this topic', sysLabel: sysLink?.textContent?.trim() || 'this system' };
};

export default function Palette({ isAdmin }: { isAdmin: boolean }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [docs, setDocs] = useState<Doc[] | null>(null);
  const [recent, setRecent] = useState<string[]>([]);
  const [here, setHere] = useState<Here>(null);
  const [scope, setScope] = useState<Scope>('all');
  const loading = useRef(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if ((e.key === 'k' && (e.metaKey || e.ctrlKey)) || (e.key === '/' && !/input|textarea|select/i.test(t.tagName) && !t.isContentEditable)) { e.preventDefault(); setOpen((o) => !o); }
    };
    // detail.q (or lbPaletteQuery for requests made before hydration) pre-fills the search.
    const onOpen = (e: Event) => { const w = window as any; w.lbPaletteWanted = false; setOpen(true); setQ((e as CustomEvent).detail?.q ?? w.lbPaletteQuery ?? ''); w.lbPaletteQuery = ''; };
    window.addEventListener('keydown', onKey);
    window.addEventListener('lb:palette', onOpen);
    (window as any).lbPaletteReady = true;
    if ((window as any).lbPaletteWanted) { setOpen(true); setQ((window as any).lbPaletteQuery ?? ''); (window as any).lbPaletteQuery = ''; }
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('lb:palette', onOpen); };
  }, []);

  useEffect(() => {
    if (!open) { setQ(''); return; }
    (window as any).lbPaletteWanted = false;
    setRecent(readRecent());
    setHere(whereAmI());
    setScope('all');
  }, [open]);
  useEffect(() => {
    if (open && !docs && !loading.current) {
      loading.current = true;
      fetch('/api/search-index').then((r) => r.json()).then(setDocs).finally(() => (loading.current = false));
    }
  }, [open, docs]);

  const ms = useMemo(() => {
    if (!docs) return null;
    const m = new MiniSearch<Doc>({ fields: ['title', 'text', 'id', 'body'], storeFields: ['type', 'title', 'text', 'href', 'label', 'tp', 'sys'], searchOptions: { boost: { title: 3, id: 4 }, prefix: true, fuzzy: 0.18 } });
    m.addAll(docs);
    return m;
  }, [docs]);

  // Abbreviations and spellings widen the search ("RML" also finds "right middle lobe"); each expansion must match as a whole phrase.
  const query = useMemo<Query>(() => {
    const ex = expansions(q.trim());
    return ex.length ? { combineWith: 'OR', queries: [q.trim(), ...ex.map((e) => ({ combineWith: 'AND' as const, prefix: false, fuzzy: false, queries: [e] }))] } : q.trim();
  }, [q]);
  const inScope = (r: { tp?: string[]; sys?: string[] }) => !here || scope === 'all' || (scope === 'topic' ? !!r.tp?.includes(here.slug) : !!r.sys?.includes(here.system));
  const results = useMemo(() => {
    if (!ms || q.trim().length < 2) return [];
    return ms.search(query, { filter: (r) => inScope(r as { tp?: string[]; sys?: string[] }) }).slice(0, 40) as unknown as (Doc & { score: number })[];
  }, [ms, query, scope, here]);
  const expanded = useMemo(() => (q.trim().length >= 2 ? expansions(q.trim()).slice(0, 3) : []), [q]);
  // "Did you mean": the closest indexed words when nothing matched.
  const suggestion = useMemo(() => {
    if (!ms || results.length || q.trim().length < 3) return null;
    const s = ms.autoSuggest(q.trim(), { fuzzy: 0.34, prefix: true, combineWith: 'AND' })[0]?.suggestion;
    return s && s.toLowerCase() !== q.trim().toLowerCase() ? s : null;
  }, [ms, results, q]);

  const remember = (term: string) => {
    const t = term.trim();
    if (t.length < 2) return;
    const next = [t, ...readRecent().filter((x) => x.toLowerCase() !== t.toLowerCase())].slice(0, 6);
    try { localStorage.setItem(RECENT_KEY, JSON.stringify(next)); } catch { /* storage full or blocked */ }
  };
  const clearRecent = () => { try { localStorage.removeItem(RECENT_KEY); } catch { /* ignore */ } setRecent([]); };

  const go = (href: string) => { setOpen(false); navigate(href); };
  const openResult = (href: string) => { remember(q); go(href); };
  const actions = [
    { label: 'Home dashboard', icon: LayoutDashboard, run: () => go('/') },
    { label: 'Review flashcards due today', icon: Layers, run: () => go('/practice/cards') },
    { label: 'Practise MCQs', icon: Target, run: () => go('/practice/mcq') },
    { label: 'Browse study topics', icon: BookOpenText, run: () => go('/study') },
    { label: 'Open the image atlas', icon: Images, run: () => go('/atlas') },
    { label: 'Open the review centre', icon: ShieldAlert, run: () => go('/review') },
    { label: 'Open my library', icon: Bookmark, run: () => go('/library') },
    { label: 'Open analytics', icon: ChartNoAxesCombined, run: () => go('/analytics') },
    { label: 'Build a custom quiz', icon: ListChecks, run: () => go('/practice/builder') },
    { label: 'Start a timed exam', icon: Timer, run: () => go('/practice/builder?mode=exam') },
    { label: 'TOACS station mode', icon: ScanEye, run: () => go('/practice/toacs') },
    { label: 'Compare topics side by side', icon: Columns3, run: () => go('/study/compare') },
    { label: 'Browse source pages', icon: FileText, run: () => go('/sources') },
    { label: 'Open the class hub and leaderboard', icon: MessagesSquare, run: () => go('/class') },
    { label: 'Ask the AI tutor', icon: Sparkles, run: () => go('/tutor') },
    { label: 'Practise AI-generated MCQs', icon: Bot, run: () => go('/practice/ai') },
    { label: 'Open notifications', icon: Bell, run: () => go('/notifications') },
    { label: 'Start a focus timer', icon: Timer, run: () => { setOpen(false); window.dispatchEvent(new CustomEvent('lb:timer', { detail: 'start' })); } },
    { label: 'Toggle focus mode', icon: Maximize2, run: () => { setOpen(false); document.querySelector<HTMLElement>('[data-focus-toggle]')?.click(); } },
    { label: 'Change theme', icon: MoonStar, run: () => { setOpen(false); document.querySelector<HTMLElement>('[data-theme-toggle]')?.click(); } },
    { label: 'Print my high-yield sheet', icon: FileText, run: () => go('/library/high-yield') },
    { label: 'Keyboard shortcuts', icon: Keyboard, run: () => { setOpen(false); window.dispatchEvent(new Event('lb:shortcuts')); } },
    ...(isAdmin ? [{ label: 'Manage users', icon: UsersRound, run: () => go('/admin') }] : []),
  ];
  const groups = (['topic', 'fact', 'mcq', 'image'] as const).map((t) => ({ t, items: results.filter((r) => r.type === t).slice(0, t === 'fact' ? 12 : 6) })).filter((g) => g.items.length);

  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-50 flex items-start justify-center px-3 pt-[12vh]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.16 }}>
          <div className="absolute inset-0 bg-black/45 backdrop-blur-[3px]" onClick={() => setOpen(false)} aria-hidden="true" />
          <motion.div className="panel relative w-full max-w-2xl overflow-hidden !bg-raised" initial={{ opacity: 0, y: -8, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -6, scale: 0.985 }} transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }} role="dialog" aria-modal="true" aria-label="Search Lightbox">
            <Command shouldFilter={false} loop label="Search Lightbox" onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}>
              <div className="flex items-center gap-3 border-b border-line px-4">
                <Search size={18} className="text-muted shrink-0" />
                <Command.Input autoFocus value={q} onValueChange={setQ} placeholder="Search 463 facts, 183 topics, MCQs and images…" className="h-14 w-full bg-transparent text-[15px] outline-none placeholder:text-faint" />
                <span className="kbd">Esc</span>
              </div>
              {(here || expanded.length > 0) && (
                <div className="flex flex-wrap items-center gap-1.5 border-b border-line px-4 py-2 text-xs">
                  {here && (
                    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Search in">
                      {([['all', 'Everywhere'], ['topic', `In ${here.title}`], ['system', `In ${here.sysLabel}`]] as const).map(([k, l]) => (
                        <button key={k} type="button" className="chip max-w-[14rem] !h-7 truncate" aria-pressed={scope === k} onClick={() => setScope(k)}>{l}</button>
                      ))}
                    </div>
                  )}
                  {expanded.length > 0 && <span className="ml-auto truncate text-faint" title={expanded.join(', ')}>Also searching: {expanded.join(', ')}</span>}
                </div>
              )}
              <Command.List className="max-h-[60vh] overflow-y-auto p-2">
                {q.trim().length >= 2 && docs && !results.length && (
                  <>
                    {suggestion && (
                      <Command.Group heading="Did you mean" className="pal-group">
                        <Command.Item value={`suggest:${suggestion}`} onSelect={() => setQ(suggestion)} className="pal-item"><Wand size={17} className="text-accent" />Search for “{suggestion}”</Command.Item>
                      </Command.Group>
                    )}
                    {scope !== 'all' && (
                      <Command.Group heading="Wider" className="pal-group">
                        <Command.Item value="scope:all" onSelect={() => setScope('all')} className="pal-item"><Search size={17} className="text-muted" />Search everywhere instead</Command.Item>
                      </Command.Group>
                    )}
                    {!suggestion && scope === 'all' && <div className="px-3 py-10 text-center text-muted text-sm">No matches for "{q}". Try a fact ID like F-AUG-145, an abbreviation like RML, or a shorter word.</div>}
                  </>
                )}
                {q.trim().length >= 2 && !docs && <div className="space-y-2 p-2">{[0, 1, 2].map((i) => <div key={i} className="skeleton h-10" />)}</div>}
                {q.trim().length < 2 && recent.length > 0 && (
                  <Command.Group heading="Recent searches" className="pal-group">
                    {recent.map((r) => (
                      <Command.Item key={r} value={`recent:${r}`} onSelect={() => setQ(r)} className="pal-item"><Clock size={17} className="text-muted" />{r}</Command.Item>
                    ))}
                    <Command.Item value="recent:clear" onSelect={clearRecent} className="pal-item text-faint"><X size={17} />Clear recent searches</Command.Item>
                  </Command.Group>
                )}
                {q.trim().length < 2 && (
                  <Command.Group heading="Go to" className="pal-group">
                    {actions.map((a) => (
                      <Command.Item key={a.label} onSelect={a.run} className="pal-item"><a.icon size={17} className="text-muted" />{a.label}</Command.Item>
                    ))}
                  </Command.Group>
                )}
                {groups.map((g) => (
                  <Command.Group key={g.t} heading={TYPE[g.t].name} className="pal-group">
                    {g.items.map((r) => {
                      const I = TYPE[r.type].icon;
                      return (
                        <Command.Item key={r.id} value={r.id} onSelect={() => openResult(r.href)} className="pal-item">
                          <I size={17} className="text-muted shrink-0" />
                          <span className="min-w-0 flex-1"><span className="block truncate">{r.title}</span>{r.text && r.type !== 'topic' && <span className="block truncate text-xs text-faint">{r.text}</span>}</span>
                          {r.label && <span className={`badge ${LABEL_COLOR[r.label] ?? 's-neutral'}`}>{r.label}</span>}
                          <CornerDownLeft size={14} className="pal-enter text-faint" />
                        </Command.Item>
                      );
                    })}
                  </Command.Group>
                ))}
              </Command.List>
              <div className="flex items-center gap-4 border-t border-line px-4 py-2 text-[11px] text-faint">
                <span><span className="kbd">↑</span> <span className="kbd">↓</span> to move</span><span><span className="kbd">Enter</span> to open</span><span className="ml-auto">Type / anywhere to search · <span className="kbd">?</span> for shortcuts</span>
              </div>
            </Command>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
