// "Export" button + dialog: pick a card scope (when given several) and a format, see the count, download. Place with client:idle.
import { useEffect, useId, useRef, useState } from 'react';
import { animate, AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Bookmark, Check, CircleAlert, Download, FileSpreadsheet, Flag, FolderOpen, Layers, LoaderCircle, PackageOpen, ShieldCheck, Stethoscope, X } from 'lucide-react';
import type { Scope } from '../../server/exports';
import '../../styles/exports.css';

export interface ExportMenuProps { scopes: Scope[]; trigger?: string; className?: string }
type Kind = 'all' | 'system' | 'bookmarks' | 'weak' | 'mine' | 'collection';
const KINDS: { k: Kind; label: string; Icon: typeof Download; empty: string }[] = [
  { k: 'all', label: 'All verified', Icon: ShieldCheck, empty: '' },
  { k: 'system', label: 'A system', Icon: Stethoscope, empty: '' },
  { k: 'bookmarks', label: 'Bookmarks', Icon: Bookmark, empty: 'Bookmark facts that have flashcards and they gather in this deck.' },
  { k: 'weak', label: 'Weak spots', Icon: Flag, empty: 'Flag facts or cards as weak spots and they gather in this deck.' },
  { k: 'mine', label: 'My cards', Icon: Layers, empty: 'Turn any highlight into a flashcard to start your own deck.' },
  { k: 'collection', label: 'A collection', Icon: FolderOpen, empty: 'No flashcards here yet. Facts and topics in a collection bring their cards; MCQs and images have none.' },
];
const FORMATS = [
  { f: 'apkg', label: 'Anki deck', sub: 'Anki, AnkiDroid, AnkiMobile', Icon: PackageOpen },
  { f: 'csv', label: 'Spreadsheet', sub: 'Excel, Sheets, Quizlet', Icon: FileSpreadsheet },
] as const;
const ease = [0.16, 1, 0.3, 1] as const;
const kindOf = (scope: string) => scope.split(':')[0] as Kind;
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

function Count({ n }: { n: number }) {
  const ref = useRef<HTMLSpanElement>(null), prev = useRef(n), reduce = useReducedMotion();
  useEffect(() => {
    const from = prev.current, el = ref.current;
    prev.current = n;
    if (!el || reduce || from === n) { if (el) el.textContent = String(n); return; }
    const c = animate(from, n, { duration: 0.5, ease, onUpdate: (v) => { el.textContent = String(Math.round(v)); } });
    return () => c.stop();
  }, [n, reduce]);
  return <span ref={ref}>{n}</span>;
}

export default function ExportMenu({ scopes, trigger = 'Export', className = 'btn btn-sm' }: ExportMenuProps) {
  const uid = useId().replace(/:/g, '');
  const dlg = useRef<HTMLDialogElement>(null);
  const reduce = useReducedMotion();
  const kinds = KINDS.filter((x) => scopes.some((s) => kindOf(s.scope) === x.k));
  const [pick, setPick] = useState<Record<Kind, string>>(() => Object.fromEntries(KINDS.map((x) => [x.k, scopes.find((s) => kindOf(s.scope) === x.k)?.scope ?? ''])) as Record<Kind, string>);
  const [kind, setKind] = useState<Kind>(kindOf(scopes[0]?.scope ?? 'all'));
  const [format, setFormat] = useState<'apkg' | 'csv'>('apkg');
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'error'>('idle');
  const [msg, setMsg] = useState('');
  const fixed = scopes.length === 1;
  const s = scopes.find((x) => x.scope === pick[kind]) ?? scopes[0];
  const file = `lightbox-${s.scope.replace(':', '-')}.${format}`;
  const meta = KINDS.find((x) => x.k === kind)!;
  const subOf = (k: Kind) => {
    const list = scopes.filter((x) => kindOf(x.scope) === k);
    return k === 'system' ? plural(list.length, 'deck') : k === 'collection' ? plural(list.length, 'collection') : plural(list[0].count, 'card');
  };

  useEffect(() => { setState('idle'); setMsg(''); }, [s.scope, format]);

  const download = async () => {
    if (state === 'busy' || !s.count) return;
    setState('busy'); setMsg('');
    try {
      const r = await fetch(`/api/export/${format === 'apkg' ? 'anki' : 'cards.csv'}?scope=${encodeURIComponent(s.scope)}`);
      if (!r.ok) throw new Error((await r.json().catch(() => null))?.error ?? 'The export failed. Try again in a moment.');
      const url = URL.createObjectURL(await r.blob()), a = document.createElement('a');
      a.href = url; a.download = file; document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      setState('done'); setMsg(`Downloaded ${file}: ${plural(s.count, 'card')}.`);
    } catch (e) {
      setState('error'); setMsg(e instanceof TypeError ? 'You seem to be offline. Exports need a connection.' : (e as Error).message);
    }
  };

  const spring = reduce ? { duration: 0 } : { type: 'spring' as const, stiffness: 520, damping: 38 };
  return (
    <>
      <button type="button" className={className} onClick={() => dlg.current?.showModal()} aria-haspopup="dialog">
        <Download size={15} aria-hidden="true" />{trigger}
      </button>
      <dialog ref={dlg} className="ex-dialog" aria-labelledby={`${uid}-h`} aria-describedby={`${uid}-d`} onClick={(e) => { if (e.target === dlg.current) dlg.current.close(); }}>
        <div className="ex-dh">
          <span className="ex-ico"><Download size={18} aria-hidden="true" /></span>
          <div className="min-w-0 flex-1">
            <h2 id={`${uid}-h`} className="font-medium">Export flashcards</h2>
            <p id={`${uid}-d`} className="text-xs text-muted">Every card keeps its source and verification status under the answer.</p>
          </div>
          <button type="button" className="btn btn-ghost btn-sm !px-1.5 -mr-1.5 self-start" onClick={() => dlg.current?.close()} aria-label="Close"><X size={17} aria-hidden="true" /></button>
        </div>

        <div className="ex-db">
          {!fixed && (
            <fieldset>
              <legend className="ex-lg">Cards</legend>
              <div className="ex-tiles">
                {kinds.map(({ k, label, Icon }) => (
                  <label key={k} className="ex-tile" data-on={kind === k || undefined}>
                    <input type="radio" name={`${uid}-kind`} className="sr-only" checked={kind === k} onChange={() => setKind(k)} />
                    {kind === k && <motion.span layoutId={`${uid}-sel`} className="ex-sel" transition={spring} aria-hidden="true" />}
                    <Icon size={17} aria-hidden="true" className="ex-ti" />
                    <span className="ex-tl">{label}</span>
                    <span className="ex-ts num">{subOf(k)}</span>
                  </label>
                ))}
              </div>
              <AnimatePresence initial={false} mode="popLayout">
                {(kind === 'system' || kind === 'collection') && (
                  <motion.label key={kind} className="ex-pick" initial={reduce ? false : { opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.22, ease }}>
                    <span>{kind === 'system' ? 'System' : 'Collection'}</span>
                    <select className="field" value={pick[kind]} onChange={(e) => setPick({ ...pick, [kind]: e.target.value })}>
                      {scopes.filter((x) => kindOf(x.scope) === kind).map((x) => <option key={x.scope} value={x.scope}>{x.label} ({x.count})</option>)}
                    </select>
                  </motion.label>
                )}
              </AnimatePresence>
            </fieldset>
          )}

          <fieldset>
            <legend className="ex-lg">Format</legend>
            <div className="ex-formats">
              {FORMATS.map(({ f, label, sub, Icon }) => (
                <label key={f} className="ex-fmt" data-on={format === f || undefined}>
                  <input type="radio" name={`${uid}-fmt`} className="sr-only" checked={format === f} onChange={() => setFormat(f)} />
                  <Icon size={18} aria-hidden="true" className="ex-ti" />
                  <span className="min-w-0"><span className="ex-tl">{label} <span className="num ex-ext">.{f}</span></span><span className="ex-ts">{sub}</span></span>
                  <span className="ex-dot" aria-hidden="true" />
                </label>
              ))}
            </div>
          </fieldset>

          <div className="ex-receipt" data-empty={!s.count || undefined}>
            <div className="ex-n num"><Count n={s.count} /><span className="ex-nu">{s.count === 1 ? 'card' : 'cards'}</span></div>
            <div className="min-w-0">
              {s.count ? (
                <>
                  <p className="ex-deck">{format === 'apkg' ? <>Deck <span className="num">Lightbox::{s.label.replace(/::+/g, ':')}</span></> : <>{s.label} · columns Front, Back, Source, Status, Fact</>}</p>
                  <p className="ex-file num">{file}</p>
                </>
              ) : <p className="ex-deck">{meta.empty || 'Nothing to export here yet.'}</p>}
            </div>
          </div>

          <p className="ex-help">
            {format === 'apkg'
              ? <>In Anki, choose <b>File › Import</b> and pick the file. On AnkiDroid or AnkiMobile, open the downloaded file and share it to Anki. Importing a newer export updates these cards instead of duplicating them.</>
              : <>Opens in Excel or Google Sheets with accents intact. Import it into most flashcard apps as Front and Back columns.</>}
          </p>
          {state === 'error' && <p className="ex-err" role="alert"><CircleAlert size={15} aria-hidden="true" />{msg}</p>}
        </div>

        <div className="ex-df">
          <button type="button" className="btn btn-ghost" onClick={() => dlg.current?.close()}>Close</button>
          <button type="button" className="btn btn-primary ex-go" onClick={download} disabled={!s.count} aria-busy={state === 'busy'}>
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.span key={state} className="ex-gi" initial={reduce ? false : { opacity: 0, scale: 0.6, rotate: -30 }} animate={{ opacity: 1, scale: 1, rotate: 0 }} exit={{ opacity: 0, scale: 0.6 }} transition={{ duration: 0.2, ease }}>
                {state === 'busy' ? <LoaderCircle size={16} className="animate-spin" aria-hidden="true" /> : state === 'done' ? <Check size={16} aria-hidden="true" /> : <Download size={16} aria-hidden="true" />}
              </motion.span>
            </AnimatePresence>
            {state === 'busy' ? 'Building…' : state === 'done' ? 'Downloaded' : `Download ${format === 'apkg' ? 'deck' : 'CSV'}`}
          </button>
        </div>
        <div className="sr-only" aria-live="polite">{state === 'done' ? msg : state === 'busy' ? 'Building the export…' : ''}</div>
      </dialog>
    </>
  );
}
