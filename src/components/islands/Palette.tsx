import { useEffect, useMemo, useRef, useState } from 'react';
import { Command } from 'cmdk';
import MiniSearch from 'minisearch';
import { AnimatePresence, motion } from 'motion/react';
import { navigate } from 'astro:transitions/client';
import { BookOpenText, CircleHelp, FileText, Image, LayoutDashboard, Layers, MoonStar, Search, ShieldAlert, Target, Images, UsersRound, CornerDownLeft } from 'lucide-react';

type Doc = { id: string; type: 'topic' | 'fact' | 'mcq' | 'image'; title: string; text: string; href: string; label?: string };
const TYPE = { topic: { icon: BookOpenText, name: 'Topics' }, fact: { icon: FileText, name: 'Facts' }, mcq: { icon: CircleHelp, name: 'MCQs' }, image: { icon: Image, name: 'Atlas' } };
const LABEL_COLOR: Record<string, string> = { cited: 's-cited', agreed: 's-agreed', unchecked: 's-unchecked', disputed: 's-disputed' };

export default function Palette({ isAdmin }: { isAdmin: boolean }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [docs, setDocs] = useState<Doc[] | null>(null);
  const loading = useRef(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if ((e.key === 'k' && (e.metaKey || e.ctrlKey)) || (e.key === '/' && !/input|textarea|select/i.test(t.tagName) && !t.isContentEditable)) { e.preventDefault(); setOpen((o) => !o); }
    };
    const onOpen = () => { (window as any).lbPaletteWanted = false; setOpen(true); };
    window.addEventListener('keydown', onKey);
    window.addEventListener('lb:palette', onOpen);
    (window as any).lbPaletteReady = true;
    if ((window as any).lbPaletteWanted) setOpen(true);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('lb:palette', onOpen); };
  }, []);

  useEffect(() => {
    if (!open) { setQ(''); return; }
    (window as any).lbPaletteWanted = false;
    if (!docs && !loading.current) {
      loading.current = true;
      fetch('/api/search-index').then((r) => r.json()).then(setDocs).finally(() => (loading.current = false));
    }
  }, [open, docs]);

  const ms = useMemo(() => {
    if (!docs) return null;
    const m = new MiniSearch<Doc>({ fields: ['title', 'text', 'id'], storeFields: ['type', 'title', 'text', 'href', 'label'], searchOptions: { boost: { title: 3, id: 4 }, prefix: true, fuzzy: 0.18 } });
    m.addAll(docs);
    return m;
  }, [docs]);

  const results = useMemo(() => {
    if (!ms || q.trim().length < 2) return [];
    return ms.search(q).slice(0, 40) as unknown as (Doc & { score: number })[];
  }, [ms, q]);

  const go = (href: string) => { setOpen(false); navigate(href); };
  const actions = [
    { label: 'Home dashboard', icon: LayoutDashboard, run: () => go('/') },
    { label: 'Review flashcards due today', icon: Layers, run: () => go('/practice/cards') },
    { label: 'Practise MCQs', icon: Target, run: () => go('/practice/mcq') },
    { label: 'Browse study topics', icon: BookOpenText, run: () => go('/study') },
    { label: 'Open the image atlas', icon: Images, run: () => go('/atlas') },
    { label: 'Open the review centre', icon: ShieldAlert, run: () => go('/review') },
    { label: 'Change theme', icon: MoonStar, run: () => { setOpen(false); document.querySelector<HTMLElement>('[data-theme-toggle]')?.click(); } },
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
              <Command.List className="max-h-[60vh] overflow-y-auto p-2">
                {q.trim().length >= 2 && docs && !results.length && <Command.Empty className="px-3 py-10 text-center text-muted text-sm">No matches for "{q}". Try a fact ID like F-AUG-145, or a shorter word.</Command.Empty>}
                {q.trim().length >= 2 && !docs && <div className="space-y-2 p-2">{[0, 1, 2].map((i) => <div key={i} className="skeleton h-10" />)}</div>}
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
                        <Command.Item key={r.id} value={r.id} onSelect={() => go(r.href)} className="pal-item">
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
                <span><span className="kbd">↑</span> <span className="kbd">↓</span> to move</span><span><span className="kbd">Enter</span> to open</span><span className="ml-auto">Type / anywhere to search</span>
              </div>
            </Command>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
