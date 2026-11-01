import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion, useMotionValue, useTransform } from 'motion/react';
import { createEmptyCard, fsrs, Rating, type Card as FCard, type FSRS, type Grade } from 'ts-fsrs';
import { get, set } from 'idb-keyval';
import { ArrowLeft, CloudOff, ExternalLink, Flag, MessageCircleQuestionMark, PenLine, RotateCcw, Sparkles, Volume2, VolumeX, Zap } from 'lucide-react';
import '../../scripts/marks';

type Anki = { factId: string; front: string; back: string; sourceFile: string; page: number; evidence: string; own?: { factId: string | null; path: string | null } };
type Item = { factId: string; card: FCard; isNew: boolean; topic?: string };
type Review = { factId: string; rating: Grade; reviewedAt: number; clientId: string };
const OUTBOX = 'lb-srs-outbox';
const makeScheduler = (r = 0.9) => fsrs({ request_retention: r, enable_fuzz: false });
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
  const [leech, setLeech] = useState(4);
  const [pace, setPace] = useState<{ status: string; message: string } | null>(null);
  const [back, setBack] = useState<string | null>(null);
  const scheduler = useRef<FSRS>(makeScheduler());
  const x = useMotionValue(0);
  const tilt = useTransform(x, [-200, 200], [-8, 8]);
  const tint = useTransform(x, [-140, 0, 140], ['color-mix(in oklab, var(--bad) 22%, var(--panel))', 'var(--panel)', 'color-mix(in oklab, var(--ok) 22%, var(--panel))']);
  const startedAt = useRef(Date.now());

  const load = useCallback(async () => {
    setQueue(null);
    await flush();
    const p = new URLSearchParams(location.search);
    const qs = new URLSearchParams();
    for (const k of ['topic', 'sys']) { const v = p.get(k); if (v) qs.set(k, v); }
    const [a, q] = await Promise.all([fetch('/api/data/anki').then((r) => r.json()), fetch('/api/srs/queue' + (String(qs) ? '?' + qs : '')).then((r) => r.json())]);
    const d = new Map<string, Anki>(a.map((c: Anki) => [c.factId, c]));
    // The user's own cards ('U<id>') travel with the queue.
    for (const [id, c] of Object.entries((q.custom ?? {}) as Record<string, { front: string; back: string; factId: string | null; path: string | null }>))
      d.set(id, { factId: id, front: c.front, back: c.back, sourceFile: '', page: 0, evidence: '', own: { factId: c.factId, path: c.path } });
    setDeck(d);
    setRemainingNew(q.remainingNew);
    // Previews and in-session repeats follow the same desired retention as the server.
    if (typeof q.retention === 'number') scheduler.current = makeScheduler(q.retention);
    if (typeof q.leech === 'number') setLeech(q.leech);
    setPace(q.pace ?? null);
    const b = p.get('back');
    setBack(b && b.startsWith('/') && !b.startsWith('//') ? b : null);
    const f = p.get('focus');
    setFocus(f && d.has(f) ? f : null);
    // Planner sessions: ?only=due|new and ?limit=N keep a session to the size the plan promised.
    const only = p.get('only'), limit = Math.max(0, Math.min(500, Number(p.get('limit')) || 0));
    let items: Item[] = [
      ...(only === 'new' ? [] : q.due.map((x: any) => ({ factId: x.factId, card: revive(x.card), isNew: false, topic: x.topic }))),
      ...(only === 'due' ? [] : q.fresh.map((id: string) => ({ factId: id, card: createEmptyCard(new Date()), isNew: true }))),
    ].filter((it) => d.has(it.factId));
    if (limit) items = items.slice(0, limit);
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

  // Read aloud: when on, each card's question is spoken, then its answer once shown.
  const [canSpeak, setCanSpeak] = useState(false);
  const [aloud, setAloud] = useState(false);
  useEffect(() => {
    if (!('speechSynthesis' in window)) return;
    setCanSpeak(true);
    setAloud(localStorage.getItem('lb-aloud') === '1');
    return () => speechSynthesis.cancel();
  }, []);
  const say = info ? (flipped ? info.back : info.front) : '';
  useEffect(() => {
    if (!aloud || !say) return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(say);
    u.lang = 'en-GB';
    speechSynthesis.speak(u);
  }, [aloud, say, done.n]);
  const toggleAloud = () => {
    const on = !aloud;
    setAloud(on);
    localStorage.setItem('lb-aloud', on ? '1' : '0');
    if (!on) speechSynthesis.cancel();
  };
  const preview = useMemo(() => {
    if (!cur) return null;
    const now = new Date(), log = scheduler.current.repeat(cur.card, now);
    return Object.fromEntries(RATINGS.map(([g]) => [g, fmt(log[g].card.due.getTime() - now.getTime())]));
  }, [cur]);

  const rate = useCallback(async (g: Grade) => {
    if (!cur || !flipped) return;
    const now = new Date();
    const next = scheduler.current.next(cur.card, now, g).card;
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
      const t = e.target as HTMLElement;
      // Buttons and links keep their own Enter/Space; the card face (role=button) and the page body drive the session.
      if (/input|textarea|select/i.test(t.tagName) || e.metaKey || e.ctrlKey || e.altKey || t.closest?.('[role="dialog"], dialog')) return;
      if ((e.key === ' ' || e.key === 'Enter') && !t.closest?.('button, a')) { e.preventDefault(); if (!flipped) setFlipped(true); else rate(Rating.Good); }
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
        {pace && pace.status !== 'none' && <p className={`max-w-sm text-xs ${pace.status === 'behind' ? 'text-signal' : 'text-faint'}`}>{pace.message}</p>}
        {pending > 0 && <p className="flex items-center gap-1.5 text-xs text-signal"><CloudOff size={14} />{pending} reviews will sync when you're back online.</p>}
        <div className="mt-2 flex gap-2">{back ? <a href={back} className="btn btn-primary"><ArrowLeft size={15} />Back to Fix-it</a> : <a href="/practice/mcq" className="btn">Practise MCQs</a>}<button className="btn btn-ghost" onClick={load}><RotateCcw size={15} />Check again</button></div>
      </motion.div>
    );
  }

  const total = done.n + queue.length;
  const isLeech = !cur.isNew && cur.card.lapses >= leech;
  return (
    <div className="mx-auto max-w-2xl">
      <div className="flex items-center gap-3 text-sm text-muted">
        <span className="num"><span className="text-ink">{done.n}</span> / {total}</span>
        <div className="h-1 flex-1 overflow-hidden rounded-full bg-sunk"><motion.div className="h-full rounded-full bg-accent" animate={{ width: `${(done.n / total) * 100}%` }} transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }} /></div>
        {info?.own && <span className="badge s-edition">your card</span>}
        {cur.isNew ? <span className="badge s-agreed">new</span> : <span className="badge s-neutral">review</span>}
        {isLeech && <span className="badge s-disputed inline-flex items-center gap-1" title={`Forgotten ${cur.card.lapses} times. It is now on your weak spots.`}><Zap size={11} aria-hidden="true" />leech</span>}
        {/* Keyed per card: a fresh node gets painted by the marks script instead of keeping the last card's state. */}
        <button key={cur.factId} type="button" className="btn btn-sm btn-ghost mk !h-7 !px-1.5" data-mark="weak" data-type={info?.own ? 'card' : 'fact'} data-id={cur.factId} aria-pressed="false" aria-label={`Mark ${cur.factId} as a weak spot`} title="Mark as a weak spot"><Flag size={15} aria-hidden="true" /></button>
        {canSpeak && <button type="button" className="btn btn-sm btn-ghost !h-7 !px-1.5" aria-pressed={aloud} onClick={toggleAloud} aria-label={aloud ? 'Stop reading cards aloud' : 'Read cards aloud'} title={aloud ? 'Stop reading aloud' : 'Read aloud'}>{aloud ? <Volume2 size={15} className="text-accent" aria-hidden="true" /> : <VolumeX size={15} aria-hidden="true" />}</button>}
        {pending > 0 && <span className="flex items-center gap-1 text-xs text-signal" title="Saved on this device; will sync"><CloudOff size={13} />{pending}</span>}
      </div>
      {focus === cur.factId && <p className="mt-3 flex items-center gap-1.5 text-xs text-accent"><Sparkles size={13} />Opened from a topic note</p>}
      {isLeech && flipped && (
        <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
          <span>Keeps slipping. Rebuild it from the source rather than drilling harder:</span>
          <a href={`/facts/${info?.own?.factId ?? cur.factId}`} className="inline-flex items-center gap-1 text-accent hover:underline"><ExternalLink size={12} aria-hidden="true" />Open the fact</a>
          {cur.topic && <a href={`/tutor?topic=${encodeURIComponent(cur.topic)}`} className="inline-flex items-center gap-1 text-accent hover:underline"><MessageCircleQuestionMark size={12} aria-hidden="true" />Ask the tutor</a>}
          {cur.topic && <a href={`/fix/${encodeURIComponent(cur.topic)}`} className="inline-flex items-center gap-1 text-accent hover:underline"><Zap size={12} aria-hidden="true" />Fix this topic</a>}
        </p>
      )}

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
                {info!.own ? (
                  <div className="mt-auto flex flex-wrap items-center gap-2 pt-6 text-xs text-faint">
                    <span className="inline-flex items-center gap-1"><PenLine size={12} aria-hidden="true" />Written by you</span>
                    {info!.own.factId && <a href={`/facts/${info!.own.factId}`} className="num hover:text-accent" onClick={(e) => e.stopPropagation()}>{info!.own.factId}</a>}
                    {info!.own.path && <a href={info!.own.path} className="hover:text-accent" onClick={(e) => e.stopPropagation()}>where you made it</a>}
                    <a href="/library?tab=cards" className="hover:text-accent" onClick={(e) => e.stopPropagation()}>edit</a>
                  </div>
                ) : (
                  <div className="mt-auto flex flex-wrap items-center gap-2 pt-6 text-xs text-faint">
                    <span className="truncate">{info!.sourceFile} p{info!.page}</span>
                    <a href={`/facts/${cur.factId}`} className="num hover:text-accent" onClick={(e) => e.stopPropagation()}>{cur.factId}</a>
                    {(info!.evidence.match(/https?:\/\/\S+/g) || []).slice(0, 1).map((u) => <a key={u} href={u} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="inline-flex items-center gap-1 hover:text-accent"><ExternalLink size={12} />source</a>)}
                  </div>
                )}
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
