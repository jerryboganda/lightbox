import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion, useMotionValue, useTransform } from 'motion/react';
import { createEmptyCard, fsrs, Rating, type Card as FCard, type Grade } from 'ts-fsrs';
import { get, set } from 'idb-keyval';
import { CloudOff, ExternalLink, RotateCcw, Sparkles } from 'lucide-react';

type Anki = { factId: string; front: string; back: string; sourceFile: string; page: number; evidence: string };
type Item = { factId: string; card: FCard; isNew: boolean };
type Review = { factId: string; rating: Grade; reviewedAt: number; clientId: string };
const OUTBOX = 'lb-srs-outbox';
const scheduler = fsrs({ request_retention: 0.9, enable_fuzz: false });
const RATINGS: [Grade, string, string, string][] = [[Rating.Again, 'Again', '1', 'bad'], [Rating.Hard, 'Hard', '2', 'signal'], [Rating.Good, 'Good', '3', 'accent'], [Rating.Easy, 'Easy', '4', 'ok']];
const revive = (c: any): FCard => ({ ...c, due: new Date(c.due), last_review: c.last_review ? new Date(c.last_review) : undefined });
const fmt = (ms: number) => { const m = ms / 60000; if (m < 60) return `${Math.max(1, Math.round(m))}m`; const h = m / 60; if (h < 24) return `${Math.round(h)}h`; const d = h / 24; if (d < 30) return `${Math.round(d)}d`; const mo = d / 30; return mo < 12 ? `${Math.round(mo)}mo` : `${(mo / 12).toFixed(1)}y`; };

async function flush() {
  const box: Review[] = (await get(OUTBOX)) || [];
  if (!box.length || !navigator.onLine) return box.length;
  try {
    const r = await fetch('/api/srs/review', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(box) });
    if (r.ok) { const left: Review[] = ((await get(OUTBOX)) || []).filter((x: Review) => !box.some((b) => b.clientId === x.clientId)); await set(OUTBOX, left); return left.length; }
  } catch {}
  return box.length;
}

export default function Flashcards() {
  const [deck, setDeck] = useState<Map<string, Anki>>(new Map());
  const [queue, setQueue] = useState<Item[] | null>(null);
  const [flipped, setFlipped] = useState(false);
  const [done, setDone] = useState({ n: 0, again: 0 });
  const [pending, setPending] = useState(0);
  const [focus, setFocus] = useState<string | null>(null);
  const [remainingNew, setRemainingNew] = useState(0);
  const x = useMotionValue(0);
  const tilt = useTransform(x, [-200, 200], [-8, 8]);
  const tint = useTransform(x, [-140, 0, 140], ['color-mix(in oklab, var(--bad) 22%, var(--panel))', 'var(--panel)', 'color-mix(in oklab, var(--ok) 22%, var(--panel))']);
  const startedAt = useRef(Date.now());

  const load = useCallback(async () => {
    setQueue(null);
    await flush();
    const [a, q] = await Promise.all([fetch('/api/data/anki').then((r) => r.json()), fetch('/api/srs/queue').then((r) => r.json())]);
    const d = new Map<string, Anki>(a.map((c: Anki) => [c.factId, c]));
    setDeck(d);
    setRemainingNew(q.remainingNew);
    const f = new URLSearchParams(location.search).get('focus');
    setFocus(f && d.has(f) ? f : null);
    const items: Item[] = [
      ...q.due.map((x: any) => ({ factId: x.factId, card: revive(x.card), isNew: false })),
      ...q.fresh.map((id: string) => ({ factId: id, card: createEmptyCard(new Date()), isNew: true })),
    ].filter((it) => d.has(it.factId));
    if (f && d.has(f)) {
      const k = items.findIndex((it) => it.factId === f);
      if (k > 0) items.unshift(items.splice(k, 1)[0]);
      else if (k < 0) items.unshift({ factId: f, card: createEmptyCard(new Date()), isNew: true });
    }
    setQueue(items);
    setPending(((await get(OUTBOX)) || []).length);
  }, []);

  useEffect(() => {
    load();
    const on = () => flush().then(setPending);
    window.addEventListener('online', on);
    return () => window.removeEventListener('online', on);
  }, [load]);

  const cur = queue?.[0];
  const info = cur && deck.get(cur.factId);
  const preview = useMemo(() => {
    if (!cur) return null;
    const now = new Date(), log = scheduler.repeat(cur.card, now);
    return Object.fromEntries(RATINGS.map(([g]) => [g, fmt(log[g].card.due.getTime() - now.getTime())]));
  }, [cur]);

  const rate = useCallback(async (g: Grade) => {
    if (!cur || !flipped) return;
    const now = new Date();
    const next = scheduler.next(cur.card, now, g).card;
    const review: Review = { factId: cur.factId, rating: g, reviewedAt: now.getTime(), clientId: crypto.randomUUID() };
    await set(OUTBOX, [...((await get(OUTBOX)) || []), review]);
    navigator.vibrate?.(8);
    setDone((d) => ({ n: d.n + 1, again: d.again + (g === Rating.Again ? 1 : 0) }));
    setFlipped(false);
    x.set(0);
    // Cards due again within this session go back in the queue.
    setQueue((q) => {
      const rest = q!.slice(1);
      if (next.due.getTime() - now.getTime() < 15 * 60_000) rest.splice(Math.min(rest.length, g === Rating.Again ? 3 : 6), 0, { ...cur, card: next, isNew: false });
      return rest;
    });
    flush().then(setPending);
  }, [cur, flipped, x]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (/input|textarea|select/i.test((e.target as HTMLElement).tagName) || e.metaKey || e.ctrlKey) return;
      if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); if (!flipped) setFlipped(true); else rate(Rating.Good); }
      const r = RATINGS.find(([, , k]) => k === e.key);
      if (r && flipped) rate(r[0]);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [flipped, rate]);

  if (!queue) return <div className="mx-auto max-w-2xl space-y-4"><div className="skeleton h-6 w-40" /><div className="skeleton h-80" /></div>;

  if (!cur) {
    const mins = Math.max(1, Math.round((Date.now() - startedAt.current) / 60000));
    return (
      <motion.div initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }} className="panel mx-auto grid max-w-xl place-items-center gap-3 px-6 py-14 text-center">
        <svg width="64" height="64" viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="28" fill="none" stroke="var(--line)" strokeWidth="4" /><motion.path d="M20 33l8 8 16-17" fill="none" stroke="var(--accent)" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.6, delay: 0.15, ease: [0.16, 1, 0.3, 1] }} /></svg>
        <h2 className="text-xl font-medium">{done.n ? 'Session complete' : 'Nothing due right now'}</h2>
        <p className="max-w-sm text-sm text-muted">{done.n ? <>You reviewed <span className="num text-ink">{done.n}</span> cards in about {mins} min{done.again ? <>, and <span className="num">{done.again}</span> will come back sooner</> : ''}.</> : <>New cards unlock tomorrow ({remainingNew} left to learn). Due reviews appear here when their interval ends.</>}</p>
        {pending > 0 && <p className="flex items-center gap-1.5 text-xs text-signal"><CloudOff size={14} />{pending} reviews will sync when you're back online.</p>}
        <div className="mt-2 flex gap-2"><a href="/practice/mcq" className="btn">Practise MCQs</a><button className="btn btn-ghost" onClick={load}><RotateCcw size={15} />Check again</button></div>
      </motion.div>
    );
  }

  const total = done.n + queue.length;
  return (
    <div className="mx-auto max-w-2xl">
      <div className="flex items-center gap-3 text-sm text-muted">
        <span className="num"><span className="text-ink">{done.n}</span> / {total}</span>
        <div className="h-1 flex-1 overflow-hidden rounded-full bg-sunk"><motion.div className="h-full rounded-full bg-accent" animate={{ width: `${(done.n / total) * 100}%` }} transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }} /></div>
        {cur.isNew ? <span className="badge s-agreed">new</span> : <span className="badge s-neutral">review</span>}
        {pending > 0 && <span className="flex items-center gap-1 text-xs text-signal" title="Saved on this device; will sync"><CloudOff size={13} />{pending}</span>}
      </div>
      {focus === cur.factId && <p className="mt-3 flex items-center gap-1.5 text-xs text-accent"><Sparkles size={13} />Opened from a topic note</p>}

      <div className="relative mt-5" style={{ perspective: 1400 }}>
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.div key={cur.factId + done.n} initial={{ opacity: 0, y: 18, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, x: x.get() > 60 ? 300 : x.get() < -60 ? -300 : 0, y: -10, transition: { duration: 0.2 } }} transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
            drag={flipped ? 'x' : false} dragSnapToOrigin style={{ x, rotate: tilt }} onDragEnd={(_, i) => { if (i.offset.x > 110) rate(Rating.Good); else if (i.offset.x < -110) rate(Rating.Again); }}>
            <motion.div className="flip" animate={{ rotateY: flipped ? 180 : 0 }} transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }} onClick={() => !flipped && setFlipped(true)} role="button" tabIndex={0} aria-label={flipped ? 'Answer shown' : 'Show answer'}>
              <motion.div className="face panel" style={{ background: tint }}>
                <span className="text-xs text-faint">Question</span>
                <p className="mt-3 text-[1.2rem] leading-relaxed sm:text-[1.35rem]">{info!.front}</p>
                <span className="mt-auto pt-6 text-xs text-faint">Tap, or press <span className="kbd">Space</span>, to show the answer</span>
              </motion.div>
              <motion.div className="face back panel" style={{ background: tint }}>
                <span className="text-xs text-faint">Answer</span>
                <p className="mt-3 text-[1.1rem] leading-relaxed">{info!.back}</p>
                <div className="mt-auto flex flex-wrap items-center gap-2 pt-6 text-xs text-faint">
                  <span className="truncate">{info!.sourceFile} p{info!.page}</span>
                  <a href={`/facts?id=${cur.factId}`} className="num hover:text-accent" onClick={(e) => e.stopPropagation()}>{cur.factId}</a>
                  {(info!.evidence.match(/https?:\/\/\S+/g) || []).slice(0, 1).map((u) => <a key={u} href={u} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="inline-flex items-center gap-1 hover:text-accent"><ExternalLink size={12} />source</a>)}
                </div>
              </motion.div>
            </motion.div>
          </motion.div>
        </AnimatePresence>
      </div>

      <div className="mt-5 grid grid-cols-4 gap-2" aria-hidden={!flipped}>
        {RATINGS.map(([g, label, key, c]) => (
          <button key={g} type="button" disabled={!flipped} onClick={() => rate(g)} className={`rate rate-${c}`}>
            <span className="font-medium">{label}</span>
            <span className="num text-xs opacity-75">{preview?.[g]}</span>
            <span className="kbd absolute right-2 top-2 max-sm:hidden">{key}</span>
          </button>
        ))}
      </div>
      <p className="mt-3 text-center text-xs text-faint sm:hidden">Swipe right for Good, left for Again.</p>
    </div>
  );
}
