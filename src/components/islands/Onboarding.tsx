import { useState } from 'react';
import { ArrowLeft, ArrowRight, CalendarDays, Clock3, Gauge, LoaderCircle } from 'lucide-react';

interface Props { systems: [string, string][]; initial: { examDate: string | null; minutes: number; confidence: Record<string, number> }; again?: boolean }
const MINUTES = [15, 30, 45, 60, 90, 120];
const LEVELS: [number, string][] = [[1, 'Lost'], [2, 'Shaky'], [3, 'OK'], [4, 'Good'], [5, 'Strong']];

/** Three quick questions on first login (or from "Change exam date, time or confidence") that seed goals and the planner. */
export default function Onboarding({ systems, initial, again }: Props) {
  const [step, setStep] = useState(0);
  const [examDate, setExamDate] = useState(initial.examDate ?? '');
  const [minutes, setMinutes] = useState(initial.minutes);
  const [conf, setConf] = useState<Record<string, number>>(initial.confidence);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [hidden, setHidden] = useState(false);

  const send = async (body: object) => {
    setBusy(true); setErr('');
    const r = await fetch('/api/onboarding', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((x) => x.json()).catch(() => ({ error: 'Network error. Try again.' }));
    if (r.error) { setBusy(false); setErr(r.error); return; }
    location.replace('/'); // reload Home so the plan and goal rings use the new settings
  };
  if (hidden) return null;

  const days = examDate ? Math.round((Date.parse(examDate + 'T00:00:00+05:00') - Date.now()) / 86_400_000) : null;
  const title = ['When is your exam?', 'How long can you study on a normal day?', 'How confident are you in each system?'][step];
  return (
    <section className="panel reveal mb-6 p-5 sm:p-6" aria-labelledby="ob-h">
      <div className="flex items-center justify-between gap-3 text-xs text-faint">
        <span>{again ? 'Study settings' : 'Welcome · 1 minute setup'} · step {step + 1} of 3</span>
        <button type="button" className="hover:text-accent" onClick={() => (again ? setHidden(true) : send({ skip: true }))} disabled={busy}>{again ? 'Close' : 'Skip for now'}</button>
      </div>
      <h2 id="ob-h" className="mt-2 text-lg font-medium">{title}</h2>

      {step === 0 && (
        <div className="mt-4 max-w-sm">
          <label className="flex items-center gap-2 text-sm text-muted" htmlFor="ob-date"><CalendarDays size={16} />Exam date (optional)</label>
          <input id="ob-date" type="date" className="field mt-2" value={examDate} onChange={(e) => setExamDate(e.target.value)} />
          <p className="mt-2 text-sm text-muted">{days === null ? 'Without a date the plan stays steady. Add it any time.' : days < 0 ? 'That date has passed.' : `${days} days to go. The plan shifts to revision and timed practice in the last two weeks.`}</p>
        </div>
      )}

      {step === 1 && (
        <div className="mt-4">
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Minutes per day">
            {MINUTES.map((m) => <button key={m} type="button" role="radio" aria-checked={minutes === m} className={`chip ${minutes === m ? 'on' : ''}`} onClick={() => setMinutes(m)}><Clock3 size={13} />{m < 60 ? `${m} min` : `${m / 60} h`}</button>)}
          </div>
          <p className="mt-3 text-sm text-muted">Daily goals become about <span className="num text-ink">{Math.max(10, Math.round(minutes * 0.75))}</span> cards and <span className="num text-ink">{Math.max(5, Math.round(minutes / 3))}</span> MCQs. You can still pick 15, 30 or 60 minutes each day.</p>
        </div>
      )}

      {step === 2 && (
        <div className="mt-3">
          <p className="text-sm text-muted">Your first plans start with the systems you rate lowest. Real results take over as you study.</p>
          <ul className="mt-3 grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
            {systems.map(([k, label]) => (
              <li key={k} className="flex items-center justify-between gap-3">
                <span className="truncate text-sm">{label}</span>
                <span className="seg shrink-0" role="radiogroup" aria-label={`${label} confidence`}>
                  {LEVELS.map(([n, word]) => <button key={n} type="button" role="radio" aria-checked={(conf[k] ?? 3) === n} title={word} aria-label={`${n}: ${word}`} className="!px-2" onClick={() => setConf((c) => ({ ...c, [k]: n }))}>{n}</button>)}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-2 flex items-center gap-1.5 text-xs text-faint"><Gauge size={13} />1 Lost · 3 OK · 5 Strong</p>
        </div>
      )}

      {err && <p className="mt-3 text-sm text-bad" role="alert">{err}</p>}
      <div className="mt-5 flex items-center gap-2">
        {step > 0 && <button type="button" className="btn btn-ghost" onClick={() => setStep(step - 1)} disabled={busy}><ArrowLeft size={16} />Back</button>}
        {step < 2 ? <button type="button" className="btn btn-primary" onClick={() => setStep(step + 1)}>Next<ArrowRight size={16} /></button>
          : <button type="button" className="btn btn-primary" disabled={busy} onClick={() => send({ examDate: examDate || null, minutes, confidence: Object.fromEntries(systems.map(([k]) => [k, conf[k] ?? 3])) })}>
              {busy && <LoaderCircle size={16} className="animate-spin" />}Build my plan
            </button>}
      </div>
    </section>
  );
}
