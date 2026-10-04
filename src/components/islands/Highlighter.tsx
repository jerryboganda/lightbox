// Floating toolbar on text selected inside #main: highlight, note, flashcard, copy with source, search.
// Highlights are stored as quote + prefix/suffix and re-painted as <mark class="lb-hl"> on every page load.
// Mounted once in App.astro with transition:persist, so listeners live for the whole session.
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as RKeyboardEvent } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Copy, Layers, Search, StickyNote, Trash2, X } from 'lucide-react';
import { toast } from '../../scripts/toast';
import { reduced } from '../../scripts/motion';
import '../../styles/personal.css';

type Color = 'amber' | 'cyan' | 'green' | 'violet';
const COLORS: Color[] = ['amber', 'cyan', 'green', 'violet'];
type Hl = { id: number; quote: string; prefix: string; suffix: string; color: Color; note: string; factId: string | null };
type Sel = { start: number; end: number; quote: string; prefix: string; suffix: string; factId: string | null; phone: boolean };
type Src = { id: string; fact: string; file: string; unit: number };

// Text inside these never takes part in highlighting (islands re-render their own DOM).
const SKIP = 'astro-island,script,style,noscript,template,textarea,input,select,button,svg,[contenteditable],[data-no-highlight],[popover],[aria-hidden="true"],.sr-only';
const CTX = 32;
const WORD = /[\p{L}\p{N}]/u;
const JSON_HEADERS = { 'content-type': 'application/json' };
const mainEl = () => document.getElementById('main');
const elOf = (n: Node) => (n.nodeType === 1 ? (n as Element) : n.parentElement);
const isPhone = () => matchMedia('(max-width: 767px), (pointer: coarse)').matches;
const blocked = () => !!document.querySelector('[aria-modal="true"], dialog[open]');
const marksOf = (id: number | string) => [...document.querySelectorAll<HTMLElement>(`mark.lb-hl[data-hl-id="${id}"]`)];

function stream(root: HTMLElement) {
  const nodes: Text[] = [], starts: number[] = [];
  let text = '';
  const w = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.nodeType === 1 ? ((n as Element).matches(SKIP) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_SKIP) : NodeFilter.FILTER_ACCEPT),
  });
  for (let n = w.nextNode(); n; n = w.nextNode()) { nodes.push(n as Text); starts.push(text.length); text += (n as Text).data; }
  return { nodes, starts, text };
}

// A DOM boundary point as an offset into the stream text.
function offsetAt(s: ReturnType<typeof stream>, node: Node, off: number) {
  const i = node.nodeType === 3 ? s.nodes.indexOf(node as Text) : -1;
  if (i >= 0) return s.starts[i] + off;
  const r = document.createRange();
  r.setStart(node, off);
  for (let k = 0; k < s.nodes.length; k++) if (r.comparePoint(s.nodes[k], 0) >= 0) return s.starts[k];
  return s.text.length;
}

// Best occurrence of the quote: the one whose surroundings match the saved prefix/suffix the furthest.
function locate(text: string, h: Pick<Hl, 'quote' | 'prefix' | 'suffix'>) {
  let best = -1, score = -1;
  for (let i = text.indexOf(h.quote); i >= 0; i = text.indexOf(h.quote, i + 1)) {
    let sc = 0;
    for (let k = 1; k <= h.prefix.length && text[i - k] === h.prefix[h.prefix.length - k]; k++) sc++;
    for (let k = 0, e = i + h.quote.length; k < h.suffix.length && text[e + k] === h.suffix[k]; k++) sc++;
    if (sc > score) { score = sc; best = i; }
  }
  return best;
}

function wrap(root: HTMLElement, start: number, end: number, id: number | string, color: Color) {
  const s = stream(root), out: HTMLElement[] = [];
  s.nodes.forEach((node, i) => {
    const ns = s.starts[i], ne = ns + node.data.length;
    if (ne <= start || ns >= end) return;
    const a = Math.max(start, ns) - ns, b = Math.min(end, ne) - ns;
    if (!node.data.slice(a, b).trim()) return; // whitespace between blocks stays bare
    if (b < node.data.length) node.splitText(b);
    const mid = a > 0 ? node.splitText(a) : node;
    const m = document.createElement('mark');
    m.className = 'lb-hl';
    m.dataset.color = color;
    m.dataset.hlId = String(id);
    mid.replaceWith(m);
    m.append(mid);
    out.push(m);
  });
  return out;
}

function unwrap(id: number | string) {
  for (const m of marksOf(id)) {
    const p = m.parentNode!;
    m.replaceWith(...m.childNodes);
    p.normalize();
  }
}

// First segment is keyboard-reachable (unless it sits inside a link or button); the last one carries the note dot.
function decorate(id: number, note: string) {
  const ms = marksOf(id);
  ms.forEach((m, i) => {
    m.toggleAttribute('data-hl-note', i === ms.length - 1 && !!note.trim());
    if (i === 0 && !m.closest('a,button')) m.tabIndex = 0; else m.removeAttribute('tabindex');
  });
}

const sources = new Map<string, Promise<Src | null>>();
const factSource = (id: string) => {
  if (!sources.has(id)) sources.set(id, fetch(`/api/cards/source?fact=${encodeURIComponent(id)}`).then((r) => (r.ok ? r.json() : null)).catch(() => null));
  return sources.get(id)!;
};

function capture(): Sel | null {
  const root = mainEl(), sel = getSelection();
  if (!root || !sel || sel.isCollapsed || !sel.rangeCount) return null;
  const r = sel.getRangeAt(0);
  if (!root.contains(r.startContainer) || !root.contains(r.endContainer) || elOf(r.commonAncestorContainer)?.closest(SKIP)) return null;
  const s = stream(root);
  let start = offsetAt(s, r.startContainer, r.startOffset), end = offsetAt(s, r.endContainer, r.endOffset);
  while (start < end && /\s/.test(s.text[start])) start++;
  while (end > start && /\s/.test(s.text[end - 1])) end--;
  // Touch selections are imprecise: snap a cut word to its edges, without crossing into the next text node.
  const within = (o: number) => { let k = 0; while (k + 1 < s.starts.length && s.starts[k + 1] <= o) k++; return [s.starts[k] ?? 0, (s.starts[k] ?? 0) + (s.nodes[k]?.data.length ?? 0)]; };
  const [a0] = within(start), [, b1] = within(Math.max(start, end - 1));
  while (start > a0 && start < end && WORD.test(s.text[start - 1]) && WORD.test(s.text[start])) start--;
  while (end < b1 && end > start && WORD.test(s.text[end]) && WORD.test(s.text[end - 1])) end++;
  const quote = s.text.slice(start, end);
  if (quote.length < 2 || quote.length > 1000) return null;
  const factId = elOf(r.startContainer)?.closest('[data-fact]')?.getAttribute('data-fact') || elOf(r.endContainer)?.closest('[data-fact]')?.getAttribute('data-fact') || null;
  return { start, end, quote, prefix: s.text.slice(Math.max(0, start - CTX), start), suffix: s.text.slice(end, end + CTX), factId, phone: isPhone() };
}

// Open the Ctrl K palette with the selection typed in.
function searchFor(q: string) {
  Object.assign(window as any, { lbPaletteWanted: true, lbPaletteQuery: q });
  window.dispatchEvent(new CustomEvent('lb:palette', { detail: { q } }));
}

const applied = new WeakSet<HTMLElement>();

export default function Highlighter() {
  const [sel, setSel] = useState<Sel | null>(null);
  const [edit, setEdit] = useState<{ id: number; phone: boolean; focusNote: boolean } | null>(null);
  const [note, setNote] = useState('');
  const [noteState, setNoteState] = useState('');
  const [card, setCard] = useState<{ front: string; back: string; factId: string | null; path: string; loading: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [live, setLive] = useState('');
  const hls = useRef(new Map<number, Hl>());
  const selRef = useRef<Sel | null>(null);
  const bar = useRef<HTMLDivElement>(null), pop = useRef<HTMLDivElement>(null), dlg = useRef<HTMLDialogElement>(null);
  const opener = useRef<Element | null>(null);
  const noteTimer = useRef(0);
  const noteSave = useRef<(() => void) | null>(null);
  const lastColor = useRef<Color>('amber');
  selRef.current = sel;
  const rm = typeof document !== 'undefined' && reduced();

  // Paint saved highlights on each page.
  const apply = useCallback(async () => {
    const root = mainEl();
    if (!root || applied.has(root)) return;
    applied.add(root);
    let list: Hl[] = [];
    try {
      const r = await fetch(`/api/highlights?path=${encodeURIComponent(location.pathname)}`);
      if (r.ok) list = await r.json();
    } catch {}
    if (root !== mainEl() || !list.length) return;
    const text = stream(root).text;
    for (const h of list) {
      const i = locate(text, h);
      if (i < 0) continue;
      wrap(root, i, i + h.quote.length, h.id, h.color);
      hls.current.set(h.id, h);
      decorate(h.id, h.note);
    }
    const want = location.hash.match(/^#hl-(\d+)$/)?.[1];
    const m = want && marksOf(want)[0];
    if (m) { m.scrollIntoView({ block: 'center', behavior: reduced() ? 'auto' : 'smooth' }); m.classList.add('lb-hl-flash'); setTimeout(() => m.classList.remove('lb-hl-flash'), 3400); }
  }, []);

  // Toolbar placement: above the first line of the selection, or below the last when there is no room.
  const placeBar = useCallback(() => {
    const b = bar.current, s = getSelection();
    if (!b || !s?.rangeCount || selRef.current?.phone) return;
    const rects = s.getRangeAt(0).getClientRects();
    if (!rects.length) return;
    const W = b.offsetWidth, H = b.offsetHeight, first = rects[0], last = rects[rects.length - 1];
    const above = first.top - H - 12 > 64;
    const a = above ? first : last, cx = a.left + a.width / 2;
    const x = Math.min(Math.max(8, cx - W / 2), innerWidth - W - 8);
    b.style.left = `${x}px`;
    b.style.top = `${above ? a.top - H - 12 : a.bottom + 12}px`;
    b.style.setProperty('--ax', `${Math.min(Math.max(16, cx - x), W - 16)}px`);
    b.dataset.place = above ? 'above' : 'below';
  }, []);

  const placePop = useCallback(() => {
    const p = pop.current, id = edit?.id;
    if (!p || !id || edit?.phone) return;
    const m = marksOf(id);
    if (!m.length) return;
    const r = m[0].getBoundingClientRect(), W = p.offsetWidth, H = p.offsetHeight;
    p.style.left = `${Math.min(Math.max(8, r.left), innerWidth - W - 8)}px`;
    p.style.top = `${r.bottom + 8 + H < innerHeight ? r.bottom + 8 : Math.max(8, r.top - H - 8)}px`;
  }, [edit]);

  useLayoutEffect(placeBar, [sel, placeBar]);
  useLayoutEffect(placePop, [edit, placePop]);
  const placePopRef = useRef(placePop);
  placePopRef.current = placePop;

  // A note typed just before closing is sent now rather than dropped.
  const flushNote = useCallback(() => {
    clearTimeout(noteTimer.current);
    noteTimer.current = 0;
    const f = noteSave.current;
    noteSave.current = null;
    f?.();
  }, []);

  const closeEditor = useCallback((restore = false) => {
    flushNote();
    setEdit(null);
    if (restore && opener.current instanceof HTMLElement && opener.current.isConnected) opener.current.focus();
  }, [flushNote]);

  // Selection, marks, keyboard and navigation listeners: registered once for the session.
  useEffect(() => {
    let t = 0, down = false, raf = 0;
    const check = () => {
      clearTimeout(t);
      t = window.setTimeout(() => { if (!down) setSel(blocked() ? null : capture()); }, 160);
    };
    const onDown = (e: PointerEvent) => { if (!bar.current?.contains(e.target as Node)) down = true; };
    const onUp = () => { down = false; check(); };
    const onScroll = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => { placeBar(); placePopRef.current(); }); };
    const openMark = (m: HTMLElement) => {
      const id = Number(m.dataset.hlId), h = hls.current.get(id);
      if (!h) return;
      opener.current = document.activeElement === m ? m : null;
      setNote(h.note); setNoteState('');
      setEdit({ id, phone: isPhone(), focusNote: false });
    };
    const onClick = (e: MouseEvent) => {
      const m = (e.target as Element | null)?.closest?.<HTMLElement>('mark.lb-hl');
      if (!m || m.closest('a,button') || !getSelection()?.isCollapsed) return;
      openMark(m);
    };
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if ((e.key === 'Enter' || e.key === ' ') && t.matches?.('mark.lb-hl')) { e.preventDefault(); openMark(t); return; }
      if (e.key === 'Escape' && selRef.current) { setSel(null); return; }
      // Keyboard users reach the toolbar with Tab right after selecting.
      if (e.key === 'Tab' && !e.shiftKey && selRef.current && bar.current && !bar.current.contains(t) && !t.closest?.('input,textarea,select,[contenteditable]')) {
        e.preventDefault();
        bar.current.querySelector<HTMLElement>('button')?.focus();
      }
    };
    const beforeSwap = () => { setSel(null); setEdit(null); if (dlg.current?.open) dlg.current.close(); };
    document.addEventListener('selectionchange', check);
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('pointerup', onUp, true);
    document.addEventListener('pointercancel', onUp, true);
    document.addEventListener('click', onClick);
    document.addEventListener('keydown', onKey);
    document.addEventListener('astro:before-swap', beforeSwap);
    document.addEventListener('astro:page-load', apply);
    addEventListener('scroll', onScroll, { passive: true, capture: true });
    addEventListener('resize', onScroll, { passive: true });
    apply();
    check();
    return () => {
      document.removeEventListener('selectionchange', check);
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('pointerup', onUp, true);
      document.removeEventListener('pointercancel', onUp, true);
      document.removeEventListener('click', onClick);
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('astro:before-swap', beforeSwap);
      document.removeEventListener('astro:page-load', apply);
      removeEventListener('scroll', onScroll, { capture: true });
      removeEventListener('resize', onScroll);
    };
  }, [apply, placeBar]);

  useEffect(() => { if (sel?.factId) factSource(sel.factId); }, [sel]);

  // Editor: focus on open, close on outside press or Escape.
  useEffect(() => {
    if (!edit) return;
    const p = pop.current;
    (edit.focusNote ? p?.querySelector<HTMLElement>('textarea') : p?.querySelector<HTMLElement>('button[aria-pressed="true"]'))?.focus({ preventScroll: true });
    const outside = (e: PointerEvent) => { if (!p?.contains(e.target as Node) && !(e.target as Element).closest?.(`mark.lb-hl[data-hl-id="${edit.id}"]`)) closeEditor(); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); closeEditor(true); } };
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', esc, true);
    return () => { document.removeEventListener('pointerdown', outside, true); document.removeEventListener('keydown', esc, true); };
  }, [edit, closeEditor]);

  useEffect(() => { if (card && dlg.current && !dlg.current.open) dlg.current.showModal(); }, [card]);

  const clearSel = () => { getSelection()?.removeAllRanges(); setSel(null); };

  const create = async (color: Color) => {
    const s = selRef.current, root = mainEl();
    if (!s || !root) return null;
    lastColor.current = color;
    const tmp = `t${Date.now()}`;
    const ms = wrap(root, s.start, s.end, tmp, color);
    clearSel();
    navigator.vibrate?.(6);
    try {
      const r = await fetch('/api/highlights', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ path: location.pathname, quote: s.quote, prefix: s.prefix, suffix: s.suffix, color, factId: s.factId }) });
      if (!r.ok) throw new Error(String(r.status));
      const { id } = (await r.json()) as { id: number };
      ms.forEach((m) => (m.dataset.hlId = String(id)));
      hls.current.set(id, { id, quote: s.quote, prefix: s.prefix, suffix: s.suffix, color, note: '', factId: s.factId });
      decorate(id, '');
      setLive(`Highlighted in ${color}.`);
      return id;
    } catch {
      unwrap(tmp);
      toast("Couldn't save the highlight. Try again.", 'bad');
      return null;
    }
  };

  const addNote = async () => {
    const phone = selRef.current?.phone ?? false;
    const id = await create(lastColor.current);
    if (!id) return;
    opener.current = null;
    setNote(''); setNoteState('');
    setEdit({ id, phone, focusNote: true });
  };

  const makeCard = () => {
    const s = selRef.current;
    if (!s) return;
    clearSel();
    setCard({ front: s.quote, back: '', factId: s.factId, path: location.pathname, loading: !!s.factId });
    if (s.factId) factSource(s.factId).then((src) => setCard((c) => c && { ...c, back: c.back || src?.fact || '', loading: false }));
  };

  const copy = async () => {
    const s = selRef.current;
    if (!s) return;
    const src = s.factId ? await factSource(s.factId) : null;
    const cite = src ? ` · ${src.id}, ${src.file} p${src.unit}` : s.factId ? ` · ${s.factId}` : '';
    const out = `“${s.quote}”\n— ${document.title}${cite}\n${location.origin}${location.pathname}`;
    try { await navigator.clipboard.writeText(out); toast('Copied with its source', 'ok'); } catch { toast("Couldn't copy. Your browser blocked the clipboard.", 'bad'); }
    clearSel();
  };

  const search = () => {
    const s = selRef.current;
    if (!s) return;
    clearSel();
    searchFor(s.quote.split(/\s+/).slice(0, 8).join(' '));
  };

  const recolor = async (c: Color) => {
    const h = edit && hls.current.get(edit.id);
    if (!h || h.color === c) return;
    const prev = h.color;
    const paint = (v: Color) => { h.color = v; marksOf(h.id).forEach((m) => (m.dataset.color = v)); };
    paint(c);
    lastColor.current = c;
    setEdit((e) => e && { ...e });
    const r = await fetch('/api/highlights', { method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify({ id: h.id, color: c }) }).catch(() => null);
    if (!r?.ok) { paint(prev); setEdit((e) => e && { ...e }); toast("Couldn't change the colour.", 'bad'); }
  };

  const saveNote = (id: number, v: string) => {
    clearTimeout(noteTimer.current);
    setNoteState('Saving…');
    noteSave.current = async () => {
      const r = await fetch('/api/highlights', { method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify({ id, note: v }), keepalive: true }).catch(() => null);
      const h = hls.current.get(id);
      if (r?.ok && h) { h.note = v; decorate(id, v); setNoteState('Saved'); } else setNoteState('Not saved. Keep typing to retry.');
    };
    noteTimer.current = window.setTimeout(flushNote, 600);
  };

  const remove = async () => {
    const h = edit && hls.current.get(edit.id);
    if (!h) return;
    noteSave.current = null; // the highlight is going away with its note
    unwrap(h.id);
    hls.current.delete(h.id);
    closeEditor();
    const r = await fetch(`/api/highlights?id=${h.id}`, { method: 'DELETE' }).catch(() => null);
    if (r?.ok) { setLive('Highlight removed.'); toast('Highlight removed', 'ok'); return; }
    const root = mainEl(), i = root ? locate(stream(root).text, h) : -1;
    if (root && i >= 0) { wrap(root, i, i + h.quote.length, h.id, h.color); hls.current.set(h.id, h); decorate(h.id, h.note); }
    toast("Couldn't remove the highlight.", 'bad');
  };

  const saveCard = async (e: { preventDefault(): void }) => {
    e.preventDefault();
    if (!card || busy) return;
    setBusy(true);
    const r = await fetch('/api/cards', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ front: card.front, back: card.back, factId: card.factId, path: card.path }) }).catch(() => null);
    setBusy(false);
    if (!r?.ok) { toast("Couldn't save the card. Check both sides and try again.", 'bad'); return; }
    dlg.current?.close();
    toast('Card added. It joins your next review.', 'ok');
  };

  // Arrow keys move along the toolbar.
  const rove = (e: RKeyboardEvent) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft' && e.key !== 'Home' && e.key !== 'End') return;
    const bs = [...(e.currentTarget as HTMLElement).querySelectorAll<HTMLElement>('button')];
    const i = bs.indexOf(document.activeElement as HTMLElement);
    const n = e.key === 'Home' ? 0 : e.key === 'End' ? bs.length - 1 : (i + (e.key === 'ArrowRight' ? 1 : -1) + bs.length) % bs.length;
    e.preventDefault();
    bs[n]?.focus();
  };

  // Phase 3 adds "Report" to this list.
  const actions = [
    { label: 'Note', short: 'Note', icon: StickyNote, run: addNote },
    { label: 'Make a flashcard', short: 'Flashcard', icon: Layers, run: makeCard },
    { label: 'Copy with source', short: 'Copy', icon: Copy, run: copy },
    { label: 'Search Lightbox', short: 'Search', icon: Search, run: search },
  ];
  const h = edit ? hls.current.get(edit.id) : undefined;
  const spring = rm ? { duration: 0.12 } : { type: 'spring' as const, stiffness: 560, damping: 34, mass: 0.7 };

  return (
    <>
      <AnimatePresence>
        {sel && (
          <motion.div key="bar" ref={bar} role="toolbar" aria-label="Selection tools" className={`lb-hlbar${sel.phone ? ' is-phone' : ''}`}
            initial={{ opacity: 0, y: rm ? 0 : sel.phone ? 14 : 6, scale: rm ? 1 : 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: rm ? 0 : 4, scale: rm ? 1 : 0.98, transition: { duration: 0.12 } }} transition={spring}
            onPointerDown={(e) => e.preventDefault()} onKeyDown={rove}>
            {!sel.phone && <span className="arrow" aria-hidden="true" />}
            {COLORS.map((c) => <button key={c} type="button" className="lb-sw" data-color={c} aria-label={`Highlight ${c}`} title={`Highlight ${c}`} onClick={() => create(c)} />)}
            <span className="lb-sep" aria-hidden="true" />
            {actions.map((a) => (
              <button key={a.label} type="button" className="lb-tb" aria-label={a.label} title={a.label} onClick={a.run}><a.icon size={16} aria-hidden="true" /><span className="lb-tl">{a.short}</span></button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {edit && h && (
          <motion.div key="pop" ref={pop} role="dialog" aria-label="Edit highlight" className={`lb-hlpop${edit.phone ? ' is-phone' : ''}`}
            initial={{ opacity: 0, y: rm ? 0 : 6, scale: rm ? 1 : 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, transition: { duration: 0.1 } }} transition={spring}>
            <div className="flex items-center gap-0.5">
              {COLORS.map((c) => <button key={c} type="button" className="lb-sw" data-color={c} aria-pressed={h.color === c} aria-label={`Colour ${c}`} title={`Colour ${c}`} onClick={() => recolor(c)} />)}
              <span className="flex-1" />
              <button type="button" className="lb-tb !px-2 hover:!text-bad" aria-label="Delete highlight" title="Delete highlight" onClick={remove}><Trash2 size={16} aria-hidden="true" /></button>
              <button type="button" className="lb-tb !px-2" aria-label="Close" title="Close (Esc)" onClick={() => closeEditor(true)}><X size={16} aria-hidden="true" /></button>
            </div>
            <label className="sr-only" htmlFor="lb-hl-note">Note on this highlight</label>
            <textarea id="lb-hl-note" className="lb-ta mt-2" rows={3} maxLength={1000} placeholder="Add a note to this highlight" value={note}
              onChange={(e) => { setNote(e.target.value); saveNote(h.id, e.target.value); }} />
            <div className="mt-1.5 flex items-center justify-between gap-2 text-[11px] text-faint">
              <span aria-live="polite">{noteState || (h.factId ? `Linked to ${h.factId}` : 'Only you can see this')}</span>
              {note.length > 850 && <span className="num">{note.length}/1000</span>}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <dialog ref={dlg} className="lb-dialog" aria-labelledby="lb-card-h" onClose={() => setCard(null)} onClick={(e) => { if (e.target === dlg.current) dlg.current.close(); }}>
        {card && (
          <form onSubmit={saveCard}>
            <div className="dh">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-accent/12 text-accent"><Layers size={19} aria-hidden="true" /></span>
              <div className="min-w-0">
                <h2 id="lb-card-h" className="font-medium">New flashcard</h2>
                <p className="text-xs text-muted">It joins your daily reviews and is scheduled like the rest of your deck.</p>
              </div>
            </div>
            <div className="db">
              <label><span>Front</span><textarea className="lb-ta" rows={3} required maxLength={1000} value={card.front} onChange={(e) => setCard({ ...card, front: e.target.value })} /></label>
              <label>
                <span>Back{card.factId && <span className="num font-normal text-faint">from {card.factId}</span>}</span>
                <textarea className="lb-ta" rows={4} required maxLength={2000} value={card.back} placeholder={card.loading ? 'Loading the fact statement…' : 'The answer, in your words or from the source'} onChange={(e) => setCard({ ...card, back: e.target.value })} />
              </label>
            </div>
            <div className="df">
              <button type="button" className="btn btn-ghost" onClick={() => dlg.current?.close()}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={busy || !card.front.trim() || !card.back.trim()}>{busy ? 'Saving…' : 'Save card'}</button>
            </div>
          </form>
        )}
      </dialog>
      <div className="sr-only" aria-live="polite">{live}</div>
    </>
  );
}
