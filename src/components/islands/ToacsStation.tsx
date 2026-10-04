import { useCallback, useEffect, useRef, useState, type MouseEvent as RME } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Check, Eye, LoaderCircle, Minus, X, ZoomIn, ZoomOut } from 'lucide-react';
import { navigate } from 'astro:transitions/client';
import { toast } from '../../scripts/toast';

export type Station = { file: string; src: string; w: number; h: number; caption: string; source: string; facts: { id: string; fact: string; label: string; labelText: string }[] };
type Grade = 'got' | 'partial' | 'missed';
interface Props { id: number; seconds: number; stations: Station[]; grades: Record<string, Grade> }

const ease = [0.16, 1, 0.3, 1] as const;
const GRADES: [Grade, string, string, typeof Check][] = [['got', 'Got it', 'ok', Check], ['partial', 'Partly', 'signal', Minus], ['missed', 'Missed', 'bad', X]];
const R = 27, C = 2 * Math.PI * R;

export default function ToacsStation(p: Props) {
  const reduce = useReducedMotion();
  const [grades, setGrades] = useState(p.grades);
  const [i, setI] = useState(() => Math.max(0, p.stations.findIndex((s) => !p.grades[s.file])));
  const [revealed, setRevealed] = useState(false);
  const [left, setLeft] = useState(p.seconds);
  const [zoom, setZoom] = useState<{ x: number; y: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [live, setLive] = useState('');
  const t0 = useRef(0);
  const used = useRef(0);
  const answer = useRef<HTMLTextAreaElement>(null);
  const model = useRef<HTMLDivElement>(null);
  const s = p.stations[i];

  const reveal = useCallback((auto = false) => {
    used.current = performance.now() - t0.current;
    setRevealed(true);
    setLive(auto ? 'Time. The model answer is shown.' : 'Model answer shown.');
  }, []);

  useEffect(() => {
    t0.current = performance.now();
    setLeft(p.seconds); setRevealed(false); setZoom(null);
    if (answer.current) answer.current.value = '';
    const next = p.stations[i + 1];
    if (next) new Image().src = next.src;
  }, [i]);

  // On phones the answer opens below the fold: bring it up.
  useEffect(() => { if (revealed) model.current?.scrollIntoView({ block: 'nearest', behavior: reduce ? 'auto' : 'smooth' }); }, [revealed]);

  useEffect(() => {
    if (revealed) return;
    const t = setInterval(() => {
      const l = Math.max(0, p.seconds - (performance.now() - t0.current) / 1000);
      setLeft(l);
      if (l <= 0) { clearInterval(t); reveal(true); }
    }, 200);
    return () => clearInterval(t);
  }, [revealed, i, reveal]);

  const grade = async (g: Grade) => {
    if (!revealed || busy) return;
    setBusy(true);
    const r = await fetch(`/api/exams/${p.id}/answer`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ item: s.file, choice: g, ms: Math.round(used.current), pos: Math.min(i + 1, p.stations.length - 1) }) }).catch(() => null);
    if (!r?.ok) { setBusy(false); toast('Could not save that grade. Try again.', 'bad'); return; }
    const all = { ...grades, [s.file]: g };
    setGrades(all);
    navigator.vibrate?.(8);
    const next = p.stations.findIndex((x, k) => k > i && !all[x.file]);
    const any = next >= 0 ? next : p.stations.findIndex((x) => !all[x.file]);
    if (any >= 0) { setI(any); setBusy(false); return; }
    await fetch(`/api/exams/${p.id}/finish`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }).catch(() => null);
    navigate(location.pathname, { history: 'replace' });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (/input|select|textarea/i.test(t.tagName) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (!revealed && (e.key === 'r' || e.key === 'R' || (e.key === 'Enter' && !t.closest('button,a')))) { e.preventDefault(); reveal(); }
      else if (revealed && ['1', '2', '3'].includes(e.key)) grade(GRADES[Number(e.key) - 1][0]);
      else if (e.key === 'z' || e.key === 'Z') setZoom((z) => (z ? null : { x: 50, y: 50 }));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const at = (e: RME) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * 100, y: ((e.clientY - r.top) / r.height) * 100 };
  };
  const state = left <= 5 ? 'bad' : left <= 10 ? 'signal' : 'accent';
  const done = Object.keys(grades).length;

  return (
    <div className="ts">
      <p className="sr-only" aria-live="assertive">{live}</p>
      <div className="ts-stage" onDoubleClick={(e) => setZoom((z) => (z ? null : at(e)))} onPointerMove={(e) => zoom && e.pointerType === 'mouse' && setZoom(at(e))}>
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.img key={s.file} src={s.src} width={s.w} height={s.h} alt={`Station ${i + 1} image. Caption hidden until you reveal.`} draggable={false}
            initial={{ opacity: 0, scale: reduce ? 1 : 1.03 }} animate={{ opacity: 1, scale: zoom ? 2.2 : 1 }} exit={{ opacity: 0 }}
            transition={{ duration: zoom === null ? 0.35 : 0.25, ease }} style={{ transformOrigin: zoom ? `${zoom.x}% ${zoom.y}%` : '50% 50%' }} className={zoom ? 'cursor-zoom-out' : 'cursor-zoom-in'} />
        </AnimatePresence>
        <span className="ts-tag">Station <span className="num">{i + 1}</span> of <span className="num">{p.stations.length}</span></span>
        <button type="button" className="ts-zoom" onClick={() => setZoom((z) => (z ? null : { x: 50, y: 50 }))} aria-label={zoom ? 'Zoom out (Z)' : 'Zoom in (Z)'} aria-pressed={!!zoom}>{zoom ? <ZoomOut size={18} /> : <ZoomIn size={18} />}</button>
      </div>

      <aside className="ts-side" aria-label="Station">
        <ol className="ts-dots" aria-label={`${done} of ${p.stations.length} stations graded`}>
          {p.stations.map((x, k) => <li key={x.file} data-g={grades[x.file]} aria-current={k === i ? 'step' : undefined} />)}
        </ol>
        <div className="mt-4 flex items-center gap-4">
          <div className="relative grid h-[68px] w-[68px] shrink-0 place-items-center" role="timer" aria-label="Time left at this station">
            <svg width="68" height="68" viewBox="0 0 68 68" className="absolute inset-0 -rotate-90" aria-hidden="true">
              <circle cx="34" cy="34" r={R} fill="none" stroke="var(--line)" strokeWidth="5" />
              <circle cx="34" cy="34" r={R} fill="none" stroke={`var(--${state})`} strokeWidth="5" strokeLinecap="round" strokeDasharray={C} style={{ strokeDashoffset: C * (1 - left / p.seconds), transition: 'stroke-dashoffset 200ms linear, stroke 200ms' }} />
            </svg>
            <span className={`num text-lg ${revealed ? 'text-muted' : ''}`} style={{ color: revealed ? undefined : `var(--${state === 'accent' ? 'ink' : state})` }}>{Math.ceil(left)}</span>
          </div>
          <div className="min-w-0">
            <h2 className="font-medium">Station {i + 1}</h2>
            <p className="truncate text-sm text-muted">{s.source}</p>
          </div>
        </div>

        <label className="mt-5 block text-sm" htmlFor="ts-answer">Your answer <span className="text-muted">(private, never saved)</span></label>
        <textarea id="ts-answer" ref={answer} className={`field mt-2 resize-none py-2 leading-relaxed transition-[height] ${revealed ? '!h-16' : '!h-24'}`} placeholder="Findings and diagnosis…" />

        <AnimatePresence mode="wait" initial={false}>
          {!revealed ? (
            <motion.div key="look" exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
              <button type="button" className="btn btn-primary mt-4 w-full justify-center" onClick={() => reveal()}><Eye size={16} />Reveal model answer</button>
              <p className="mt-3 text-xs text-muted"><span className="kbd">R</span> reveals; it also reveals itself when time runs out. Double-click the image, or press <span className="kbd">Z</span>, to zoom.</p>
            </motion.div>
          ) : (
            <motion.div key="reveal" ref={model} initial={{ opacity: 0, y: reduce ? 0 : 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, ease }}>
              <h3 id="ts-cap-h" className="mt-5 text-xs font-medium tracking-wide text-muted">SOURCE CAPTION</h3>
              <div className="ts-cap mt-1.5" role="region" aria-labelledby="ts-cap-h" tabIndex={0}>{s.caption || 'No source caption.'}</div>
              <h3 className="mt-4 text-xs font-medium tracking-wide text-muted">FACTS FROM THIS PAGE</h3>
              {s.facts.length ? (
                <ul className="mt-1.5 space-y-2">
                  {s.facts.map((f, k) => (
                    <motion.li key={f.id} initial={{ opacity: 0, x: reduce ? 0 : -6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.1 + k * 0.06, duration: 0.3, ease }} className="rounded-lg border border-line bg-sunk p-2.5 text-sm">
                      <span className="flex items-center gap-2"><span className={`badge s-${f.label}`}>{f.labelText}</span><a href={`/facts?id=${f.id}`} className="num text-xs text-muted hover:text-accent">{f.id}</a></span>
                      <span className="mt-1 block leading-relaxed">{f.fact}</span>
                    </motion.li>
                  ))}
                </ul>
              ) : <p className="mt-1.5 text-sm text-muted">No model answer in the source; compare with the caption only.</p>}
              <div className="mt-5 grid grid-cols-3 gap-2" role="group" aria-label="Grade yourself">
                {GRADES.map(([g, label, c, I], k) => (
                  <button key={g} type="button" className={`grade grade-${c}`} onClick={() => grade(g)} disabled={busy}>
                    {busy ? <LoaderCircle size={16} className="animate-spin" /> : <I size={17} />}<span>{label}</span><span className="kbd max-sm:hidden">{k + 1}</span>
                  </button>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </aside>
    </div>
  );
}
