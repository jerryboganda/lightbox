// One delegated controller for every bookmark / weak toggle (button[data-mark][data-type][data-id]),
// including buttons that islands render later. Islands can read the same store via hasMark / subscribeMarks.
import { toast } from './toast';

const key = (kind: string, type: string, id: string) => `${kind}|${type}|${id}`;
const btnKey = (b: HTMLElement) => key(b.dataset.mark!, b.dataset.type!, b.dataset.id!);
let marks = new Set<string>();
let version = 0;
let inflight: Promise<void> | null = null;
let chain: Promise<unknown> = Promise.resolve(); // saves go out one at a time, so a quick double press lands in order
const subs = new Set<() => void>();
const MSG: Record<string, [string, string]> = { bookmark: ['Bookmarked', 'Bookmark removed'], weak: ['Marked as a weak spot', 'Weak mark removed'] };

export const hasMark = (kind: string, type: string, id: string) => marks.has(key(kind, type, id));
export const marksVersion = () => version;
export const subscribeMarks = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
const emit = () => { version++; subs.forEach((f) => f()); };

function paint(root: ParentNode = document) {
  root.querySelectorAll<HTMLElement>('[data-mark]').forEach((b) => b.setAttribute('aria-pressed', String(marks.has(btnKey(b)))));
}

export function loadMarks() {
  return (inflight ??= fetch('/api/marks')
    .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
    .then((rows: { type: string; id: string; kind: string }[]) => { marks = new Set(rows.map((r) => key(r.kind, r.type, r.id))); paint(); emit(); })
    .catch(() => {})
    .finally(() => { inflight = null; }));
}

async function toggle(b: HTMLElement) {
  if (inflight) await inflight; // let a page-load fetch land first so it can't undo this click
  const k = btnKey(b), on = !marks.has(k), { mark: kind, type, id } = b.dataset;
  const set = (v: boolean) => { if (v) marks.add(k); else marks.delete(k); paint(); emit(); };
  set(on);
  b.classList.remove('mk-pop'); void b.offsetWidth; b.classList.add('mk-pop');
  navigator.vibrate?.(8);
  try {
    const req = chain.then(() => fetch('/api/marks', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type, id, kind, on }) }));
    chain = req.catch(() => {});
    const r = await req;
    if (!r.ok) throw new Error(String(r.status));
    toast(MSG[kind!]?.[on ? 0 : 1] ?? 'Saved', 'ok');
  } catch {
    set(!on);
    toast("Couldn't save that. Check your connection and try again.", 'bad');
  }
}

// Islands import this module during SSR too: only wire the DOM in the browser, once.
const w = (typeof window === 'undefined' ? { lbMarks: true } : window) as { lbMarks?: boolean };
if (!w.lbMarks) {
  w.lbMarks = true;
  document.addEventListener('click', (e) => {
    const b = (e.target as Element | null)?.closest?.<HTMLElement>('button[data-mark]');
    if (!b || !b.dataset.type || !b.dataset.id) return;
    e.preventDefault();
    toggle(b);
  });
  document.addEventListener('animationend', (e) => (e.target as Element).closest?.('.mk-pop')?.classList.remove('mk-pop'));
  const boot = () => { paint(); if (document.querySelector('[data-mark]')) loadMarks(); };
  document.addEventListener('astro:page-load', boot);
  boot();
  // Toggles rendered later (islands, lightbox captions) get their state without another request.
  let queued = false;
  new MutationObserver((recs) => {
    if (queued || !recs.some((r) => [...r.addedNodes].some((n) => n instanceof Element && (n.matches('[data-mark]') || n.querySelector('[data-mark]'))))) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; paint(); if (!version) loadMarks(); });
  }).observe(document.documentElement, { childList: true, subtree: true });
}
