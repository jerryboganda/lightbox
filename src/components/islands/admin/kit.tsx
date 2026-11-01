// Shared bits for the admin islands: JSON fetch, times, confirm and credentials dialogs.
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Check, Copy, KeyRound, MessageCircle, Printer, TriangleAlert } from 'lucide-react';
import { toast } from '../../../scripts/toast';

export async function api<T = any>(url: string, method = 'POST', body?: unknown): Promise<T> {
  const r = await fetch(url, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }).catch(() => null);
  const j = (await r?.json().catch(() => null)) ?? {};
  if (!r?.ok) throw Object.assign(new Error(j.error || (r ? 'That did not work. Try again.' : 'You seem to be offline.')), { data: j });
  return j as T;
}
export const fail = (e: unknown) => toast(e instanceof Error ? e.message : 'That did not work. Try again.', 'bad');

// Dates by hand in Pakistan time: the server and browser ICU builds can disagree ("Sept" / "Sep") and break hydration.
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pk = (t: number) => new Date(t + 5 * 3_600_000);
const day = (t: number, year: boolean) => { const d = pk(t); return `${d.getUTCDate()} ${MON[d.getUTCMonth()]}${year ? ` ${d.getUTCFullYear()}` : ''}`; };
/** Relative time against the server's clock at render, so the first client render matches the HTML. */
export const ago = (t: number, now: number) => {
  const s = (now - t) / 1000;
  return s < 60 ? 'just now' : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86_400 ? `${Math.round(s / 3600)} h ago` : s < 7 * 86_400 ? `${Math.round(s / 86_400)} d ago` : day(t, s > 300 * 86_400);
};
export const full = (t: number) => { const d = pk(t); return `${day(t, true)}, ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')} PKT`; };
export const initials = (s: string) => s.split(/\s+/).filter(Boolean).map((w) => w[0]).join('').slice(0, 2).toUpperCase() || '?';
/** First name for friendly copy, skipping titles: "Dr Ayesha Amjad" -> "Ayesha". */
export const first = (name: string) => name.split(/\s+/).find((w) => w && !/^(dr|prof|mr|mrs|ms|miss)\.?$/i.test(w)) ?? name;
export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Keeps the count beside a console tab in step with in-place changes. */
export function bump(tab: string, d: number) {
  const c = document.querySelector(`[data-tab-count="${tab}"]`);
  if (c) c.textContent = String(Math.max(0, Number(c.textContent) + d));
}

export async function copy(text: string, what = 'Copied') {
  try { await navigator.clipboard.writeText(text); toast(what, 'ok'); } catch { toast('Copy failed. Select the text and copy it by hand.', 'bad'); }
}

/** Opens a native modal while `open` is true; Escape and the backdrop button route through onClose. */
function useModal(open: boolean) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (open && d && !d.open) d.showModal();
    if (!open && d?.open) d.close();
  }, [open]);
  return ref;
}

type Ask = { title: string; body?: ReactNode; confirm: string; danger?: boolean };
/** const [confirm, dialog] = useConfirm(); if (await confirm({...})) ... ; render {dialog}. */
export function useConfirm() {
  const id = useId();
  const [ask, setAsk] = useState<Ask | null>(null);
  const res = useRef<((v: boolean) => void) | undefined>(undefined);
  const ref = useModal(!!ask);
  const settle = (v: boolean) => { res.current?.(v); res.current = undefined; setAsk(null); };
  const confirm = (a: Ask) => new Promise<boolean>((resolve) => { res.current?.(false); res.current = resolve; setAsk(a); });
  const node = (
    <dialog ref={ref} className="lb-dialog adm-dialog" aria-labelledby={`${id}-h`} onClose={() => settle(false)}>
      {ask && (
        <form onSubmit={(e) => { e.preventDefault(); settle(true); }}>
          <div className="dh"><span className={`adm-ico${ask.danger ? ' is-bad' : ''}`}><TriangleAlert size={18} aria-hidden="true" /></span><h2 id={`${id}-h`} className="font-medium">{ask.title}</h2></div>
          {ask.body && <div className="db text-sm text-muted">{ask.body}</div>}
          <div className="df">
            <button type="button" className="btn btn-ghost" autoFocus onClick={() => settle(false)}>Cancel</button>
            <button className={`btn ${ask.danger ? 'btn-danger' : 'btn-primary'}`}>{ask.confirm}</button>
          </div>
        </form>
      )}
    </dialog>
  );
  return [confirm, node] as const;
}

export type Cred = { username: string; name: string; password: string };
const loginText = (c: Cred) => `Lightbox login\n${location.origin}\nUsername: ${c.username}\nTemporary password: ${c.password}`;
/** The first-sign-in steps on every slip and message. */
export const FIRST_STEPS = [
  'Open the link and sign in with the username and temporary password.',
  'Choose your own password when asked. Nobody else will know it.',
  'Tell Lightbox your exam date when asked, then follow the daily plan on Home. Add it to your home screen to use it like an app.',
];
/** A friendly message for WhatsApp or SMS. */
export const welcomeText = (c: Cred) =>
  `Hi ${first(c.name)}! Your Lightbox account for FCPS-II radiology prep is ready.\n\n${location.origin}\nUsername: ${c.username}\nTemporary password: ${c.password}\n\n${FIRST_STEPS.map((s, i) => `${i + 1}. ${s}`).join('\n')}`;
const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
export const ONBOARD_KEY = 'lb:onboard-shared';
const markShared = () => { localStorage.setItem(ONBOARD_KEY, '1'); dispatchEvent(new Event('lb:onboard')); };

/** One cut-out slip per person, in a new window that opens the print dialog. */
export function printSlips(rows: Cred[]) {
  const w = window.open('', '_blank', 'width=820,height=900');
  if (!w) { toast('Allow pop-ups for this site to print slips.', 'bad'); return; }
  const slip = (c: Cred) => `<section class="slip"><p class="k">Lightbox · FCPS-II radiology</p><h2>${esc(c.name)}</h2>
    <dl><dt>Sign in at</dt><dd>${esc(location.origin)}</dd><dt>Username</dt><dd class="m">${esc(c.username)}</dd><dt>Temporary password</dt><dd class="m">${esc(c.password)}</dd></dl>
    <ol>${FIRST_STEPS.map((s) => `<li>${esc(s)}</li>`).join('')}</ol></section>`;
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Lightbox login slips</title><style>
    body{font:12pt/1.4 system-ui,sans-serif;color:#000;margin:12mm}.grid{display:grid;grid-template-columns:1fr 1fr;gap:6mm}
    .slip{border:1.5px dashed #777;border-radius:3mm;padding:5mm;break-inside:avoid}.k{margin:0;font-size:8pt;letter-spacing:.08em;text-transform:uppercase;color:#555}
    h2{margin:1.5mm 0 3mm;font-size:14pt}dl{display:grid;grid-template-columns:auto 1fr;gap:1mm 3mm;margin:0;font-size:10pt}dt{color:#555}dd{margin:0;overflow-wrap:anywhere}
    .m{font:600 11pt ui-monospace,monospace}ol{margin:3mm 0 0;padding-left:5mm;font-size:9pt;color:#333}li{margin:.6mm 0}
    @media print{body{margin:8mm}}</style></head><body><div class="grid">${rows.map(slip).join('')}</div>
    <script>window.onload=()=>{window.print()}<\/script></body></html>`);
  w.document.close();
  markShared();
}

/** Temporary passwords, shown once. Closing the dialog drops them from memory. */
export function Credentials({ rows, onClose }: { rows: Cred[] | null; onClose: () => void }) {
  const id = useId();
  const ref = useModal(!!rows?.length);
  const [copied, setCopied] = useState<string | null>(null);
  const one = async (c: Cred) => { await copy(loginText(c), `Copied @${c.username}'s login`); setCopied(c.username); };
  const shared = markShared;
  return (
    <dialog ref={ref} className="lb-dialog adm-dialog adm-creds" aria-labelledby={`${id}-h`} aria-describedby={`${id}-d`} onClose={() => { setCopied(null); onClose(); }}>
      {rows && rows.length > 0 && (
        <>
          <div className="dh">
            <span className="adm-ico"><KeyRound size={18} aria-hidden="true" /></span>
            <div className="min-w-0"><h2 id={`${id}-h`} className="font-medium">{rows.length === 1 ? 'Temporary password' : `${rows.length} temporary passwords`}</h2>
              <p id={`${id}-d`} className="text-xs text-muted">Shown once. Share privately; each person picks their own password at first sign-in.</p></div>
          </div>
          <div className="db">
            <ul className="creds" aria-label="New sign-in details">
              {rows.map((c) => (
                <li key={c.username} className="cred">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{c.name}</div>
                    <div className="num text-xs text-muted">@{c.username}</div>
                  </div>
                  <code className="num cred-pw" aria-label={`Temporary password for @${c.username}`} data-secret>{c.password}</code>
                  <button type="button" className="btn btn-sm" onClick={() => { shared(); one(c); }} aria-label={`Copy login details for @${c.username}`}>
                    {copied === c.username ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}<span className="max-sm:hidden">{copied === c.username ? 'Copied' : 'Copy'}</span>
                  </button>
                  <a className="btn btn-sm btn-ghost !px-2" href={`https://wa.me/?text=${encodeURIComponent(welcomeText(c))}`} target="_blank" rel="noopener noreferrer" onClick={shared}
                    aria-label={`Send @${c.username} a welcome message on WhatsApp`} title="Send on WhatsApp"><MessageCircle size={14} aria-hidden="true" /></a>
                </li>
              ))}
            </ul>
          </div>
          <div className="df flex-wrap">
            <button type="button" className="btn btn-ghost" onClick={() => printSlips(rows)}><Printer size={15} aria-hidden="true" />Print slips</button>
            <button type="button" className="btn btn-ghost mr-auto" onClick={() => { shared(); copy(rows.map(welcomeText).join('\n\n———\n\n'), rows.length > 1 ? `Copied ${rows.length} welcome messages` : 'Copied the welcome message'); }}><MessageCircle size={15} aria-hidden="true" />Copy message{rows.length > 1 ? 's' : ''}</button>
            {rows.length > 1 && <button type="button" className="btn btn-ghost" onClick={() => { shared(); copy(rows.map(loginText).join('\n\n'), `Copied ${rows.length} logins`); }}><Copy size={15} aria-hidden="true" />Copy all</button>}
            <button type="button" className="btn btn-primary" autoFocus onClick={() => ref.current?.close()}>Done</button>
          </div>
        </>
      )}
    </dialog>
  );
}
