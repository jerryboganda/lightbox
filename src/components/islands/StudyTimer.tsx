// Owner: analytics and study rhythm (phase 2). Floating Pomodoro and daily goals; mounted once in App.astro.
// Time is derived from stored timestamps, never counted, so it survives navigation, reloads and sleeping tabs.
import { useEffect, useRef, useState, type SubmitEvent } from 'react';
import { Minus, Pause, Play, RotateCcw, SkipForward, Timer, X } from 'lucide-react';
import { toast } from '../../scripts/toast';
import '../../styles/timer.css';

type Phase = 'focus' | 'break';
interface T {
  phase: Phase; focus: number; brk: number; // preset minutes
  total: number; left: number; // this phase's length and what is left while not running (ms)
  endsAt: number | null; startedAt: number | null; id: string; // running end time, first start, session client id
  sound: boolean; title: boolean; dock: 'pill' | 'dot';
}
interface Today { goals: { cards: number; mcqs: number; minutes: number; examDate: string | null }; done: { cards: number; mcqs: number; minutes: number }; examDays: number | null }
type Sess = { kind: Phase; startedAt: number; seconds: number; clientId: string };

const KEY = 'lb-timer', OUTBOX = 'lb-timer-outbox', PANEL = 'lb-timer-panel';
const PRESETS: [number, number][] = [[25, 5], [50, 10]];
const uid = () => crypto.randomUUID();
const durOf = (s: Pick<T, 'focus' | 'brk'>, p: Phase) => (p === 'focus' ? s.focus : s.brk) * 60_000;
const fresh = (): T => ({ phase: 'focus', focus: 25, brk: 5, total: 25 * 60_000, left: 25 * 60_000, endsAt: null, startedAt: null, id: uid(), sound: false, title: false, dock: 'pill' });
const load = (): T => {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (s && (s.phase === 'focus' || s.phase === 'break') && s.total > 0) return { ...fresh(), ...s };
  } catch {}
  return fresh();
};
const save = (s: T) => { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch {} };
const remaining = (s: T, t = Date.now()) => (s.endsAt ? Math.max(0, s.endsAt - t) : s.left);
const mmss = (ms: number) => { const sec = Math.ceil(ms / 1000); return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`; };
const clock = (t: number) => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

const readBox = (): Sess[] => { try { return JSON.parse(localStorage.getItem(OUTBOX) || '[]'); } catch { return []; } };
async function flush() {
  const box = readBox().slice(0, 50);
  if (!box.length || !navigator.onLine) return;
  try {
    const r = await fetch('/api/study/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(box) });
    if (r.ok || r.status === 400) { // 400: rejected for good, do not retry forever
      const sent = new Set(box.map((b) => b.clientId));
      localStorage.setItem(OUTBOX, JSON.stringify(readBox().filter((b) => !sent.has(b.clientId))));
    }
  } catch {}
}
function record(s: Sess) {
  try { localStorage.setItem(OUTBOX, JSON.stringify([...readBox().filter((b) => b.clientId !== s.clientId), s].slice(-100))); } catch {}
  flush();
}
// Focus time already spent counts even when a phase is skipped or reset.
function partial(s: T) {
  const spent = s.total - remaining(s);
  if (s.phase === 'focus' && s.startedAt && spent >= 60_000) record({ kind: 'focus', startedAt: s.startedAt, seconds: Math.round(spent / 1000), clientId: s.id });
}
const nextPhase = (s: T): T => { const phase: Phase = s.phase === 'focus' ? 'break' : 'focus', total = durOf(s, phase); return { ...s, phase, total, left: total, endsAt: null, startedAt: null, id: uid() }; };
function complete(s: T) {
  record({ kind: s.phase, startedAt: s.startedAt ?? s.endsAt! - s.total, seconds: Math.round(s.total / 1000), clientId: s.id });
  return nextPhase(s);
}
function chime() {
  try {
    const ac = new AudioContext();
    [660, 880].forEach((f, i) => {
      const o = ac.createOscillator(), g = ac.createGain(), t = ac.currentTime + i * 0.2;
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.12, t + 0.03);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
      o.connect(g).connect(ac.destination);
      o.start(t); o.stop(t + 0.65);
    });
    setTimeout(() => ac.close(), 1500);
  } catch {}
}

function Ring({ size, sw, p, className = '' }: { size: number; sw: number; p: number; className?: string }) {
  const r = (size - sw) / 2, C = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className={`tm-ring ${className}`} aria-hidden="true">
      <circle cx={size / 2} cy={size / 2} r={r} className="tm-track" strokeWidth={sw} />
      <circle cx={size / 2} cy={size / 2} r={r} className="tm-arc" strokeWidth={sw} strokeDasharray={C} strokeDashoffset={C * (1 - Math.min(1, Math.max(0, p)))} opacity={p > 0.002 ? 1 : 0} />
    </svg>
  );
}

const GOALS = [
  { key: 'cards', label: 'Cards', unit: '', c: 'var(--ok)', max: 500 },
  { key: 'mcqs', label: 'MCQs', unit: '', c: 'var(--signal)', max: 500 },
  { key: 'minutes', label: 'Focus', unit: 'm', c: 'var(--accent)', max: 720 },
] as const;

export default function StudyTimer() {
  const [s, setS] = useState<T | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [custom, setCustom] = useState(false);
  const [today, setToday] = useState<Today | null>(null);
  const [editing, setEditing] = useState(false);
  const [err, setErr] = useState('');
  const [say, setSay] = useState('');
  const sRef = useRef<T | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  const primary = useRef<HTMLButtonElement>(null);

  const commit = (n: T) => { sRef.current = n; save(n); setS(n); setNow(Date.now()); };
  const refresh = () => fetch('/api/goals').then((r) => (r.ok ? r.json() : null)).then((d) => d && setToday(d)).catch(() => {});

  const start = () => {
    const c = sRef.current!;
    if (c.endsAt) return;
    const t = Date.now();
    commit({ ...c, endsAt: t + c.left, startedAt: c.startedAt ?? t });
    setSay(`${c.phase === 'focus' ? 'Focus' : 'Break'} running, ${mmss(c.left)} left.`);
  };
  const pause = () => {
    const c = sRef.current!;
    if (!c.endsAt) return;
    commit({ ...c, left: Math.max(0, c.endsAt - Date.now()), endsAt: null });
    setSay('Paused.');
  };
  const reset = () => {
    const c = sRef.current!;
    partial(c);
    const total = durOf(c, c.phase);
    commit({ ...c, total, left: total, endsAt: null, startedAt: null, id: uid() });
    setSay(`Reset to ${mmss(total)}.`);
  };
  const skip = () => {
    const c = sRef.current!;
    partial(c);
    const n = nextPhase(c);
    commit(n);
    setSay(`Skipped. ${n.phase === 'focus' ? 'Focus' : 'Break'} is next, ${mmss(n.total)}.`);
  };
  const setDurations = (focus: number, brk: number) => {
    const c = sRef.current!, fresh = !c.endsAt && !c.startedAt; // an untouched phase takes the new length now
    const n = { ...c, focus, brk };
    commit(fresh ? { ...n, total: durOf(n, n.phase), left: durOf(n, n.phase) } : n);
  };
  const openPanel = (goals = false) => {
    const p = panel.current;
    if (!p) return;
    if (!p.matches(':popover-open')) p.showPopover();
    if (goals) setEditing(true);
  };

  // Load, catch up on a phase that ended while away, and listen for other tabs and page buttons.
  useEffect(() => {
    let st = load();
    if (st.endsAt && st.endsAt <= Date.now()) {
      const done = st.phase;
      st = complete(st);
      setTimeout(() => toast(done === 'focus' ? 'Your focus session finished while you were away.' : 'Your break ended while you were away.', 'info'), 600);
    }
    sRef.current = st; save(st); setS(st);
    flush();
    const onStorage = (e: StorageEvent) => { if (e.key === KEY) { const n = load(); sRef.current = n; setS(n); } };
    const onOnline = () => flush();
    const handle = (req: string) => {
      (window as any).lbTimerWanted = null;
      const c = sRef.current!;
      if (c.dock === 'dot') commit({ ...c, dock: 'pill' });
      if (req === 'start' && !sRef.current!.endsAt) start();
      requestAnimationFrame(() => openPanel(req === 'goals'));
    };
    const onReq = (e: Event) => handle(String((e as CustomEvent).detail || 'open'));
    addEventListener('storage', onStorage);
    addEventListener('online', onOnline);
    addEventListener('lb:timer', onReq);
    const wanted = (window as any).lbTimerWanted;
    if (wanted) setTimeout(() => handle(wanted));
    return () => { removeEventListener('storage', onStorage); removeEventListener('online', onOnline); removeEventListener('lb:timer', onReq); };
  }, []);

  // Tick while running; a finished phase records itself and moves on.
  useEffect(() => {
    if (!s?.endsAt) return;
    const id = setInterval(() => {
      const c = sRef.current!, t = Date.now();
      if (!c.endsAt) return;
      if (c.endsAt > t) return setNow(t);
      const done = c.phase;
      commit(complete(c));
      navigator.vibrate?.([140, 70, 140]);
      if (c.sound) chime();
      toast(done === 'focus' ? `Focus done. Take a ${c.brk}-minute break.` : 'Break over. Ready for the next focus?', 'ok');
      if (panel.current?.matches(':popover-open')) refresh();
    }, 250);
    return () => clearInterval(id);
  }, [s?.endsAt]);

  // Optional countdown in the tab title.
  useEffect(() => {
    const base = document.title.replace(/^\d+:\d\d (Focus|Break) · /, '');
    document.title = s?.title && s.endsAt ? `${mmss(remaining(s, now))} ${s.phase === 'focus' ? 'Focus' : 'Break'} · ${base}` : base;
  }, [s, now]);

  // Popover open/close: focus the main control, fetch today's goals.
  useEffect(() => {
    const p = panel.current;
    if (!p) return;
    const onToggle = (e: Event) => {
      const isOpen = (e as ToggleEvent).newState === 'open';
      if (isOpen) { refresh(); requestAnimationFrame(() => primary.current?.focus()); } else { setEditing(false); setErr(''); }
    };
    p.addEventListener('toggle', onToggle);
    return () => p.removeEventListener('toggle', onToggle);
  }, [!!s]);

  if (!s) return null;
  const rem = remaining(s, now), prog = 1 - rem / s.total;
  const running = !!s.endsAt, begun = running || !!s.startedAt;
  const label = s.phase === 'focus' ? 'Focus' : 'Break';
  const isPreset = PRESETS.some(([f, b]) => f === s.focus && b === s.brk);
  const status = running ? `${label}, ${mmss(rem)} left` : begun ? `${label} paused, ${mmss(rem)} left` : `${label}, ${mmss(rem)}`;

  const saveGoals = async (e: SubmitEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget), num = (k: string) => Number(f.get(k));
    setErr('');
    try {
      const r = await fetch('/api/goals', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ cards: num('cards'), mcqs: num('mcqs'), minutes: num('minutes'), examDate: String(f.get('examDate') || '') || null }) });
      const d = await r.json();
      if (!r.ok) return setErr(d.error || 'Could not save.');
      setToday(d); setEditing(false); toast('Goals saved', 'ok');
    } catch { setErr('You seem to be offline. Try again in a moment.'); }
  };

  return (
    <div className="tm-dock" data-phase={s.phase} data-running={running ? '' : undefined}>
      {s.dock === 'dot' ? (
        <button type="button" className="tm-dot press" onClick={() => commit({ ...s, dock: 'pill' })} aria-label={`Show study timer. ${status}`} title="Study timer">
          <Ring size={44} sw={3} p={prog} className="tm-dot-ring" />
          <Timer size={17} aria-hidden="true" />
        </button>
      ) : (
        <div className="tm-pill" role="group" aria-label="Study timer">
          <button type="button" className="tm-pill-main" popoverTarget={PANEL} aria-label={`Open study timer. ${status}`}>
            <Ring size={26} sw={3} p={prog} />
            <span className="num tm-pill-time">{mmss(rem)}</span>
            <span className="tm-pill-phase">{label}</span>
          </button>
          <button type="button" className="tm-pill-btn press" onClick={running ? pause : start} aria-label={running ? 'Pause timer' : begun ? 'Resume timer' : `Start ${label.toLowerCase()}`}>
            {running ? <Pause size={16} aria-hidden="true" /> : <Play size={16} aria-hidden="true" />}
          </button>
        </div>
      )}

      <div id={PANEL} ref={panel} popover="auto" className="tm-panel" role="dialog" aria-labelledby="tm-h">
        <header className="tm-head">
          <h2 id="tm-h">Study timer</h2>
          <div className="flex gap-1">
            <button type="button" className="btn btn-ghost btn-sm !px-2" onClick={() => { panel.current?.hidePopover(); commit({ ...sRef.current!, dock: 'dot' }); }} aria-label="Minimise timer to a dot" title="Minimise"><Minus size={16} aria-hidden="true" /></button>
            <button type="button" className="btn btn-ghost btn-sm !px-2" popoverTarget={PANEL} popoverTargetAction="hide" aria-label="Close timer panel" title="Close"><X size={16} aria-hidden="true" /></button>
          </div>
        </header>

        <div className="seg tm-seg" role="radiogroup" aria-label="Timer length">
          {PRESETS.map(([f, b]) => (
            <button key={f} type="button" role="radio" aria-checked={isPreset && !custom && s.focus === f} onClick={() => { setCustom(false); setDurations(f, b); }}>{f}<span className="tm-slash">/</span>{b}</button>
          ))}
          <button type="button" role="radio" aria-checked={custom || !isPreset} onClick={() => setCustom(true)}>Custom</button>
        </div>
        {(custom || !isPreset) && (
          <div className="tm-custom">
            {(['focus', 'brk'] as const).map((k) => (
              <label key={k}>
                <span>{k === 'focus' ? 'Focus' : 'Break'}</span>
                <input className="field num" type="number" inputMode="numeric" min={1} max={k === 'focus' ? 180 : 60} defaultValue={s[k]}
                  onChange={(e) => { const v = Math.round(Number(e.currentTarget.value)); if (v >= 1 && v <= (k === 'focus' ? 180 : 60)) setDurations(k === 'focus' ? v : s.focus, k === 'brk' ? v : s.brk); }} />
                <span className="text-muted">min</span>
              </label>
            ))}
          </div>
        )}

        <div className="tm-face">
          <Ring size={176} sw={9} p={prog} className="tm-big" />
          <div className="tm-time">
            <span className="tm-phase">{label}</span>
            <span className="num tm-clock">{mmss(rem)}</span>
            <span className="tm-sub">{running ? `ends ${clock(s.endsAt!)}` : begun ? 'Paused' : `${Math.round(s.total / 60_000)} min`}</span>
          </div>
        </div>

        <div className="tm-ctrl">
          <button type="button" className="btn btn-ghost tm-icon" onClick={reset} aria-label="Reset this phase" title="Reset"><RotateCcw size={17} aria-hidden="true" /></button>
          <button type="button" ref={primary} className="btn btn-primary tm-go" onClick={running ? pause : start}>
            {running ? <><Pause size={17} aria-hidden="true" />Pause</> : <><Play size={17} aria-hidden="true" />{begun ? 'Resume' : `Start ${label.toLowerCase()}`}</>}
          </button>
          <button type="button" className="btn btn-ghost tm-icon" onClick={skip} aria-label={`Skip to ${s.phase === 'focus' ? 'break' : 'focus'}`} title="Skip"><SkipForward size={17} aria-hidden="true" /></button>
        </div>
        <p className="sr-only" aria-live="polite">{say}</p>

        <div className="tm-opts">
          <label className="tm-check"><input type="checkbox" checked={s.title} onChange={(e) => commit({ ...s, title: e.currentTarget.checked })} />Countdown in the tab title</label>
          <label className="tm-check"><input type="checkbox" checked={s.sound} onChange={(e) => commit({ ...s, sound: e.currentTarget.checked })} />Soft chime when a phase ends</label>
        </div>

        <section className="tm-today" aria-labelledby="tm-today-h">
          <div className="tm-today-head">
            <h3 id="tm-today-h">Today</h3>
            {today && today.examDays !== null && <span className="tm-exam num">{today.examDays > 1 ? `Exam in ${today.examDays} days` : today.examDays === 1 ? 'Exam tomorrow' : today.examDays === 0 ? 'Exam today' : 'Exam date passed'}</span>}
            <button type="button" className="btn btn-ghost btn-sm" aria-expanded={editing} onClick={() => { setEditing(!editing); setErr(''); }}>{editing ? 'Cancel' : 'Edit goals'}</button>
          </div>
          {editing && today ? (
            <form className="tm-form" onSubmit={saveGoals}>
              {GOALS.map((g) => (
                <label key={g.key}><span>{g.key === 'minutes' ? 'Focus minutes' : g.key === 'mcqs' ? 'MCQs' : 'Cards'} per day</span>
                  <input className="field num" name={g.key} type="number" inputMode="numeric" min={0} max={g.max} step={1} required defaultValue={today.goals[g.key]} />
                </label>
              ))}
              <label className="tm-wide"><span>Exam date (optional)</span><input className="field" name="examDate" type="date" min="2000-01-01" max="2100-12-31" defaultValue={today.goals.examDate ?? ''} /></label>
              <p className="tm-err tm-wide" role="alert">{err}</p>
              <button type="submit" className="btn btn-primary btn-sm tm-wide">Save goals</button>
            </form>
          ) : today ? (
            <ul className="tm-rings">
              {GOALS.map((g) => {
                const d = today.done[g.key], goal = today.goals[g.key];
                return (
                  <li key={g.key} style={{ ['--tm' as string]: g.c }}>
                    <Ring size={46} sw={5} p={goal ? d / goal : 0} />
                    <span><span className="num text-ink">{d}{g.unit}</span><span className="text-muted num">/{goal}{g.unit}</span></span>
                    <span className="tm-ring-l">{g.label}</span>
                  </li>
                );
              })}
            </ul>
          ) : <div className="tm-rings" aria-hidden="true">{GOALS.map((g) => <div key={g.key} className="skeleton h-[4.6rem]" />)}</div>}
        </section>
      </div>
    </div>
  );
}
