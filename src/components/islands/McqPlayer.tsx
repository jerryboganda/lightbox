import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowLeft, ArrowRight, Check, CircleAlert, ExternalLink, Info, RotateCcw, Shuffle, ThumbsUp, X } from 'lucide-react';
import { host, PAPERS, urls, verdictBadge } from '../../lib/quiz';
import AiMistake from './AiMistake';
import Thread from './Thread';
import Poll from './Poll';

type Mcq = { qid: string; paper: string; stem: string; options: Record<string, string>; key: string; keyEvidence: string; myAnswer: string; confidence: string; reason: string; verdict: string; evidence: string; note: string; notBlind: boolean; notBlindReason: string; file: string; unit: number };
type Attempt = { qid: string; choice: string; correct: number | null };
type Conf = 'sure' | 'unsure' | 'guess';
const CONF: [Conf, string][] = [['sure', 'Sure'], ['unsure', 'Unsure'], ['guess', 'Guess']];
const SETS = [['all', 'All'], ['keyed', 'With answer key'], ['mistakes', 'Mistakes due'], ['disputed', 'Disputed'], ['unanswered', 'Not answered yet'], ['wrong', 'Got wrong']] as const;

export default function McqPlayer() {
  const [all, setAll] = useState<Mcq[] | null>(null);
  const [hist, setHist] = useState<Map<string, Attempt>>(new Map());
  // Mistakes due when the page opened; a snapshot so answering one does not pull it out from under the student.
  const [due, setDue] = useState<string[]>([]);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [paper, setPaper] = useState('all');
  const [set, setSet] = useState<string>('keyed');
  const [shuffle, setShuffle] = useState(false);
  const [seed, setSeed] = useState(1);
  const [i, setI] = useState(0);
  const [pick, setPick] = useState<string | null>(null);
  const [conf, setConf] = useState<Conf | null>(null);
  const [checked, setChecked] = useState(false);
  const [dir, setDir] = useState(1);
  const [err, setErr] = useState('');
  const shownAt = useRef(0); // time on question, sent with the attempt
  const want = useRef<string | null>(null);

  useEffect(() => {
    const mist = fetch('/api/mistakes').then((r) => (r.ok ? r.json() : null)).catch(() => null);
    Promise.all([fetch('/api/data/mcqs').then((r) => r.json()), fetch('/api/mcq/attempt').then((r) => r.json()), mist]).then(([m, h, mk]: [Mcq[], Attempt[], { items: { qid: string; due: number }[]; now: number } | null]) => {
      setAll(m.filter((x) => Object.keys(x.options).length >= 2));
      setHist(new Map(h.map((a) => [a.qid, a])));
      if (mk) setDue(mk.items.filter((x) => x.due <= mk.now).map((x) => x.qid));
      const sp = new URLSearchParams(location.search);
      const q = sp.get('q'), s = sp.get('set');
      if (s && SETS.some(([v]) => v === s)) { setSet(s); setPaper('all'); }
      if (q) { want.current = q; setSet('all'); setPaper('all'); }
    });
  }, []);

  const list = useMemo(() => {
    if (!all) return [];
    if (set === 'mistakes') {
      const by = new Map(all.map((x) => [x.qid, x]));
      return due.map((q) => by.get(q)!).filter((x) => x && (paper === 'all' || x.paper === paper));
    }
    let l = all.filter((m) => (paper === 'all' || m.paper === paper) && (
      set === 'all' || (set === 'keyed' && m.key) || (set === 'disputed' && m.verdict === 'DISPUTED') ||
      (set === 'unanswered' && !hist.has(m.qid)) || (set === 'wrong' && hist.get(m.qid)?.correct === 0)));
    if (shuffle) {
      let s = seed;
      const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
      l = [...l].sort(() => rnd() - 0.5);
    }
    return l;
  }, [all, paper, set, shuffle, seed, due]);

  const m = list[Math.min(i, list.length - 1)];
  const prior = m && hist.get(m.qid);

  useEffect(() => { setPick(null); setConf(null); setChecked(false); setErr(''); shownAt.current = performance.now(); }, [m?.qid]);
  // ?q=<qid> deep link: open that question once the full list is in place.
  useEffect(() => {
    const k = want.current ? list.findIndex((x) => x.qid === want.current) : -1;
    if (list.length) want.current = null;
    setI(Math.max(0, k));
  }, [all, paper, set, shuffle, seed, due]);

  const go = useCallback((d: number) => { setDir(d); setI((x) => Math.max(0, Math.min(list.length - 1, x + d))); }, [list.length]);

  const check = useCallback(async () => {
    if (!m) return;
    if (!pick) { setErr('Choose an option first.'); return; }
    setChecked(true);
    const r = await fetch('/api/mcq/attempt', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ qid: m.qid, choice: pick, ms: Math.round(performance.now() - shownAt.current), confidence: conf }) }).then((x) => x.json()).catch(() => null);
    if (r && 'correct' in r) {
      setHist((h) => new Map(h).set(m.qid, { qid: m.qid, choice: pick, correct: r.correct }));
      if (r.correct === 1) navigator.vibrate?.(12); else if (r.correct === 0) navigator.vibrate?.([20, 40, 20]);
    }
  }, [m, pick, conf]);

  const dismiss = useCallback(async (qid: string) => {
    const r = await fetch(`/api/mistakes?qid=${encodeURIComponent(qid)}`, { method: 'DELETE' }).catch(() => null);
    if (r?.ok) setDismissed((d) => new Set(d).add(qid));
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!m || /input|select|textarea/i.test((e.target as HTMLElement).tagName) || (e.target as HTMLElement).closest?.('[data-thread], [data-ai], dialog, [popover]') || e.metaKey || e.ctrlKey) return;
      const letters = Object.keys(m.options);
      const k = e.key.toUpperCase();
      const idx = /^[1-9]$/.test(k) ? Number(k) - 1 : letters.indexOf(k);
      if (!checked && idx >= 0 && idx < letters.length) { setPick(letters[idx]); setErr(''); }
      else if (e.key === 'Enter') { e.preventDefault(); checked ? go(1) : check(); }
      else if (e.key === 'ArrowRight') go(1);
      else if (e.key === 'ArrowLeft') go(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [m, checked, check, go]);

  if (!all) return <div className="space-y-3"><div className="skeleton h-10 w-2/3" /><div className="skeleton h-48" /></div>;
  const answered = list.filter((x) => hist.has(x.qid)).length;
  const vb = m && verdictBadge(m.verdict, m.key);
  const optionState = (l: string) => {
    if (!checked) return pick === l ? 'picked' : '';
    if (m.key && l === m.key) return 'right';
    if (pick === l && m.key && l !== m.key) return 'wrong';
    if (!m.key && l === m.myAnswer) return 'model';
    return pick === l ? 'picked' : 'dim';
  };

  return (
    <div className="mx-auto max-w-3xl">
      <div className="flex flex-wrap items-center gap-2">
        <div className="seg" role="radiogroup" aria-label="Paper">
          {[['all', 'Both papers'], ...Object.entries(PAPERS)].map(([v, l]) => <button key={v} type="button" role="radio" aria-checked={paper === v} onClick={() => setPaper(v)}>{l}</button>)}
        </div>
        <select className="field !h-9 !w-auto text-sm" value={set} onChange={(e) => setSet(e.target.value)} aria-label="Question set">
          {SETS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <button type="button" className="chip" aria-pressed={shuffle} onClick={() => { setShuffle((s) => !s); setSeed(Date.now() % 100000 + 1); }}><Shuffle size={14} />Shuffle</button>
        <span className="num ml-auto text-sm text-muted">{answered}/{list.length} answered</span>
      </div>
      <div className="mt-3 h-1 overflow-hidden rounded-full bg-sunk" aria-hidden="true"><motion.div className="h-full rounded-full bg-accent" animate={{ width: `${list.length ? ((i + 1) / list.length) * 100 : 0}%` }} transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }} /></div>

      {!m ? (
        <div className="panel mt-6 grid place-items-center gap-2 px-6 py-16 text-center">{set === 'mistakes'
          ? <><p className="font-medium">No mistakes due</p><p className="text-sm text-muted">Questions you get wrong come back here after 1, 3, 7 and 21 days until you get them right.</p></>
          : <><p className="font-medium">No questions in this set</p><p className="text-sm text-muted">Pick another set, or answer some questions first.</p></>}<button className="btn btn-sm mt-2" onClick={() => setSet('all')}><RotateCcw size={14} />Show all questions</button></div>
      ) : (
        <AnimatePresence mode="wait" custom={dir} initial={false}>
          <motion.article key={m.qid} custom={dir} initial={{ opacity: 0, x: 24 * dir }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -24 * dir }} transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }} className="panel mt-5 p-5 sm:p-7">
            <div className="flex flex-wrap items-center gap-2 text-xs text-faint">
              <span className="num">Question {i + 1} of {list.length}</span><span>·</span><span>{PAPERS[m.paper] ?? m.paper}</span><span className="num">{m.qid.split('-')[1]}</span>
              {m.notBlind && <span className="badge s-neutral" title={m.notBlindReason}>Answer printed in source</span>}
              {prior && !checked && <span className={`badge ${prior.correct === 1 ? 's-cited' : prior.correct === 0 ? 's-disputed' : 's-neutral'}`}>Last time: {prior.choice}</span>}
            </div>
            <h2 className="mt-3 text-[1.1rem] leading-relaxed sm:text-[1.2rem]">{m.stem}</h2>
            <div className="mt-5 grid gap-2.5" role="radiogroup" aria-label="Options">
              {Object.entries(m.options).map(([l, t], k) => {
                const s = optionState(l);
                return (
                  <motion.button layout="position" key={l} type="button" role="radio" aria-checked={pick === l} disabled={checked} onClick={() => { setPick(l); setErr(''); }} className={`opt opt-${s || 'idle'}`}>
                    <span className="opt-key num">{l}</span>
                    <span className="flex-1 text-left">{t}</span>
                    {s === 'right' && <Check size={18} className="shrink-0 text-ok" />}{s === 'wrong' && <X size={18} className="shrink-0 text-bad" />}
                    {!checked && <span className="kbd max-sm:hidden">{k + 1}</span>}
                  </motion.button>
                );
              })}
            </div>
            {err && <p role="alert" className="mt-3 text-sm text-bad">{err}</p>}
            {!checked && m.key && (
              <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-muted">
                <span id={`conf-${m.qid}`}>How sure are you?</span>
                <div className="seg !h-8 text-xs" role="radiogroup" aria-labelledby={`conf-${m.qid}`}>
                  {CONF.map(([v, l]) => <button key={v} type="button" role="radio" aria-checked={conf === v} onClick={() => setConf((c) => (c === v ? null : v))}>{l}</button>)}
                </div>
                <span className="text-faint">Optional. Guesses come back even when right.</span>
              </div>
            )}

            <AnimatePresence>
              {checked && (
                <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1], delay: 0.05 }} className="mt-6 space-y-3 rounded-xl border border-line bg-sunk p-4 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    {m.key ? (pick === m.key ? <span className="font-medium text-ok">Correct.</span> : <span className="font-medium text-bad">The key says {m.key}.</span>) : <span className="font-medium">No answer key in the source.</span>}
                    {vb && <span className={`badge ${vb[0]}`}>{vb[1]}</span>}
                  </div>
                  {!m.key && m.myAnswer && <p className="text-muted"><span className="text-ink">Lightbox's blind answer: {m.myAnswer}</span>{m.confidence && ` (${m.confidence} confidence)`}. {m.reason}</p>}
                  {m.key && m.myAnswer && m.myAnswer !== m.key && <p className="flex gap-2 text-muted"><CircleAlert size={16} className="mt-0.5 shrink-0 text-signal" />Answered blind, Lightbox chose {m.myAnswer}. {m.reason}</p>}
                  {m.note && <p className="text-muted">{m.note}</p>}
                  {urls(m.evidence).length > 0 && <div className="flex flex-wrap gap-2">{urls(m.evidence).map((u) => <a key={u} href={u} target="_blank" rel="noopener noreferrer" className="chip"><ExternalLink size={13} />{host(u)}</a>)}</div>}
                  {m.notBlind && <p className="flex gap-2 text-xs text-faint"><Info size={14} className="mt-0.5 shrink-0" />{m.notBlindReason}</p>}
                  {m.key && pick && pick !== m.key && Object.hasOwn(m.options, m.key) && <AiMistake key={`${m.qid}-${pick}`} qid={m.qid} choice={pick} keyLetter={m.key} />}
                  {m.key && pick && pick !== m.key && <p className="text-xs text-faint">Added to your mistakes. It comes back tomorrow, then after 3, 7 and 21 days.</p>}
                  {m.key && pick === m.key && conf === 'guess' && <p className="text-xs text-signal">Right, but a guess. It joins your mistakes so it comes back until you know it.</p>}
                  {m.key && pick && pick !== m.key && conf === 'sure' && <p className="text-xs text-signal">You were sure. Confident errors stick, so read the explanation closely.</p>}
                  {set === 'mistakes' && pick === m.key && !dismissed.has(m.qid) && (
                    <button type="button" className="btn btn-sm btn-ghost" onClick={() => dismiss(m.qid)}><ThumbsUp size={14} />I've got this, stop showing it</button>
                  )}
                  {dismissed.has(m.qid) && <p className="text-xs text-ok">Removed from your mistakes.</p>}
                </motion.div>
              )}
            </AnimatePresence>
            {checked && (m.verdict === 'DISPUTED' || !m.key) && Object.keys(m.options).length >= 2 && (
              <div className="mt-3"><p className="mb-1.5 text-xs text-muted">The key here is {m.key ? 'disputed' : 'missing'}. Tell the class which answer you'd pick:</p><Poll key={m.qid} mcqQid={m.qid} compact /></div>
            )}
            {checked && <div className="mt-3"><Thread itemType="mcq" itemId={m.qid} compact /></div>}

            <div className="mt-6 flex items-center gap-2">
              <button type="button" className="btn btn-ghost" onClick={() => go(-1)} disabled={i === 0} aria-label="Previous question"><ArrowLeft size={16} /></button>
              {!checked ? <button type="button" className="btn btn-primary ml-auto" onClick={check}>Check answer</button>
                : <button type="button" className="btn btn-primary ml-auto" onClick={() => go(1)} disabled={i >= list.length - 1}>Next question<ArrowRight size={16} /></button>}
            </div>
          </motion.article>
        </AnimatePresence>
      )}
    </div>
  );
}
