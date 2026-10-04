// Shared by the AI islands: the event-stream reader, a smooth reveal, and safe rendering of AI text
// (paragraphs, lists, **bold**, [F-...] citation chips) as React text nodes, never HTML.
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { CircleAlert, PlugZap } from 'lucide-react';
import { reduced } from '../../scripts/motion';
import '../../styles/ai.css';

export interface CiteInfo { id: string; fact: string; label: string }
export interface Quota { used: number; cap: number }
export interface Done { cites?: CiteInfo[]; quota?: Quota; cached?: boolean; id?: number; admin?: boolean }
export interface StreamResult { done?: Done; error?: string; status?: number; quota?: Quota; aborted?: boolean }

/** POSTs JSON and reads the server's events ({d}, {done}, {error}). Errors before the stream come back with their HTTP status. */
export async function streamAi(url: string, body: object, onDelta: (d: string) => void, signal?: AbortSignal): Promise<StreamResult> {
  try {
    const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal });
    if (!r.ok || !r.body || !r.headers.get('content-type')?.includes('text/event-stream')) {
      const j = await r.json().catch(() => null);
      return { error: j?.error ?? 'AI did not answer.', status: r.status, quota: j?.quota };
    }
    const reader = r.body.pipeThrough(new TextDecoderStream()).getReader();
    let buf = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += value;
      for (let i = buf.indexOf('\n\n'); i >= 0; i = buf.indexOf('\n\n')) {
        const line = buf.slice(0, i).split('\n').find((l) => l.startsWith('data:'));
        buf = buf.slice(i + 2);
        if (!line) continue;
        const j = JSON.parse(line.slice(5));
        if (typeof j.d === 'string') onDelta(j.d);
        else if (j.done) return { done: j };
        else if (j.error) return { error: j.error };
      }
    }
    return { error: 'The answer was cut off. Try again.' };
  } catch {
    return signal?.aborted ? { aborted: true } : { error: 'Could not reach Lightbox. Check your connection.' };
  }
}

export type Phase = 'idle' | 'wait' | 'stream' | 'done' | 'error';
export interface StreamState { phase: Phase; text: string; done?: Done; error?: string; status?: number; quota?: Quota }
/** One streamed answer at a time; a new run or unmounting aborts the previous one. */
export function useAiStream(url: string) {
  const [s, set] = useState<StreamState>({ phase: 'idle', text: '' });
  const ac = useRef<AbortController | null>(null);
  useEffect(() => () => ac.current?.abort(), []);
  const run = useCallback(async (body: object) => {
    ac.current?.abort();
    const c = (ac.current = new AbortController());
    let text = '';
    set({ phase: 'wait', text });
    const r = await streamAi(url, body, (d) => { text += d; set({ phase: 'stream', text }); }, c.signal);
    if (ac.current !== c) return r;
    if (r.aborted) set((p) => ({ ...p, phase: p.text ? 'done' : 'idle' }));
    else if (r.error) set({ phase: 'error', text, error: r.error, status: r.status, quota: r.quota });
    else set({ phase: 'done', text, done: r.done });
    return r;
  }, [url]);
  const stop = useCallback(() => ac.current?.abort(), []);
  return { ...s, run, stop };
}

/** Text that catches up with `target` a few characters per frame, so bursts and cached answers read as a stream. */
export function useReveal(target: string, animate: boolean) {
  const [n, setN] = useState(animate ? 0 : target.length);
  const shown = useRef(n);
  useEffect(() => {
    if (!animate || reduced()) { shown.current = target.length; setN(target.length); return; }
    if (shown.current > target.length) shown.current = 0;
    let raf = 0;
    const tick = () => {
      const left = target.length - shown.current;
      if (left <= 0) return;
      shown.current += Math.max(1, Math.ceil(left / 9));
      setN(shown.current);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, animate]);
  return target.slice(0, n);
}

const ID = /F-[A-Z]+-\d{3}[a-z]?/g;
// Bold runs, bracketed id lists like [F-M-001, F-M-002], and bare ids.
const INLINE = /(\*\*[^*\n]+?\*\*|\[\s*F-[A-Z]+-\d{3}[a-z]?(?:\s*[,;]\s*F-[A-Z]+-\d{3}[a-z]?)*\s*\]|\bF-[A-Z]+-\d{3}[a-z]?\b)/g;
type Block = { kind: 'p'; lines: string[] } | { kind: 'ul' | 'ol'; items: string[] };

function toBlocks(text: string) {
  const out: Block[] = [];
  let open = false;
  for (const raw of text.replace(/\r/g, '').split('\n')) {
    const line = raw.trim();
    if (!line) { open = false; continue; }
    const h = line.match(/^#{1,6}\s+(.*)$/);
    if (h) { out.push({ kind: 'p', lines: [`**${h[1].replace(/\*\*/g, '')}**`] }); open = false; continue; }
    const m = line.match(/^(?:([-*•])|(\d{1,2})[.)])\s+(.*)$/);
    const last = out[out.length - 1];
    if (m) {
      const kind = m[1] ? 'ul' : 'ol';
      if (last && last.kind === kind) last.items.push(m[3]); else out.push({ kind, items: [m[3]] });
      open = false;
    } else if (open && last?.kind === 'p' && !/^\*\*[^*]+\*\*/.test(line)) last.lines.push(line); // a line opening in bold ("**Label:**") starts a paragraph
    else { out.push({ kind: 'p', lines: [line] }); open = true; }
  }
  return out;
}

function Tip({ id, info, at }: { id: string; info: CiteInfo; at: DOMRect }) {
  const w = Math.min(336, innerWidth - 24);
  const below = at.top < 160;
  const left = Math.max(12, Math.min(at.left + at.width / 2 - w / 2, innerWidth - w - 12));
  return createPortal(
    <span className="ai-tip" aria-hidden="true" style={{ width: w, left, ...(below ? { top: at.bottom + 8 } : { top: at.top - 8, transform: 'translateY(-100%)' }) }}>
      <span className="ai-tip-k"><span className={`dot s-${info.label}`} />{id} · {info.label}</span>
      {info.fact}
    </span>, document.body);
}

/** A citation: links to the fact page and shows the fact on hover or focus. Ids the AI was not given render as plain text. */
export function Cite({ id, info, known = true }: { id: string; info?: CiteInfo; known?: boolean }) {
  const desc = useId();
  const ref = useRef<HTMLAnchorElement>(null);
  const [at, setAt] = useState<DOMRect | null>(null);
  useEffect(() => {
    if (!at) return;
    const off = () => setAt(null);
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') off(); };
    addEventListener('scroll', off, true);
    addEventListener('keydown', key);
    return () => { removeEventListener('scroll', off, true); removeEventListener('keydown', key); };
  }, [at]);
  if (!known) return <span className="ai-cite is-unknown" title="Not one of the facts the AI was given">{id}</span>;
  const show = () => info && ref.current && setAt(ref.current.getBoundingClientRect());
  return (
    <>
      <a ref={ref} href={`/facts/${id}`} className="ai-cite" aria-describedby={info ? desc : undefined}
        onMouseEnter={show} onMouseLeave={() => setAt(null)} onFocus={show} onBlur={() => setAt(null)}>
        {info && <span className={`dot s-${info.label}`} aria-hidden="true" />}{id}
      </a>
      {info && <span id={desc} hidden>{info.fact}</span>}
      {at && info && <Tip id={id} info={info} at={at} />}
    </>
  );
}

function inline(s: string, cites: Map<string, CiteInfo> | null, bold = true): ReactNode[] {
  return s.split(INLINE).map((part, i) => {
    if (!part) return null;
    if (bold && part.startsWith('**') && part.endsWith('**') && part.length > 4) return <strong key={i}>{inline(part.slice(2, -2), cites, false)}</strong>;
    if (/^\[?\s*F-/.test(part) && (part.startsWith('[') || /^F-[A-Z]+-\d{3}[a-z]?$/.test(part)))
      return (part.match(ID) ?? []).map((id) => <Cite key={`${i}-${id}`} id={id} info={cites?.get(id)} known={!cites || cites.has(id)} />);
    return part;
  });
}

/** AI text with light formatting. `cites` null while streaming (every id links); afterwards only the returned cites do. */
export function AiText({ text, cites = null, caret = false, className = '' }: { text: string; cites?: CiteInfo[] | null; caret?: boolean; className?: string }) {
  const map = cites ? new Map(cites.map((c) => [c.id, c])) : null;
  const blocks = toBlocks(text);
  const end = caret ? <span className="ai-caret" aria-hidden="true" /> : null;
  if (!blocks.length) return <div className={`ai-prose ${className}`}>{end && <p>{end}</p>}</div>;
  return (
    <div className={`ai-prose ${className}`}>
      {blocks.map((b, i) => {
        const tail = i === blocks.length - 1 ? end : null;
        if (b.kind === 'p') return <p key={i}>{b.lines.map((l, j) => <span key={j}>{j > 0 && <br />}{inline(l, map)}</span>)}{tail}</p>;
        const L = b.kind;
        return <L key={i}>{b.items.map((t, j) => <li key={j}>{inline(t, map)}{j === b.items.length - 1 && tail}</li>)}</L>;
      })}
    </div>
  );
}

export function Thinking({ label }: { label: string }) {
  return <span className="ai-think"><span className="ai-dots" aria-hidden="true"><i /><i /><i /></span>{label}</span>;
}

export const left = (q?: Quota) => (q ? Math.max(0, q.cap - q.used) : null);
export const quotaText = (q?: Quota) => (q ? `${left(q)} of ${q.cap} AI requests left today` : '');

/** Not configured (503), limits (429) and failures, each with a plain next step. */
export function AiState({ status, error, onRetry }: { status?: number; error?: string; onRetry?: () => void }) {
  if (status === 503) {
    return (
      <div className="ai-state" role="status">
        <PlugZap size={18} className="text-signal" aria-hidden="true" />
        <span><strong>AI is not configured on this server.</strong>Everything else in Lightbox works as usual. Ask an admin to add the AI key.</span>
      </div>
    );
  }
  return (
    <div className="ai-state is-bad" role="alert">
      <CircleAlert size={18} aria-hidden="true" />
      <span className="min-w-0 flex-1"><strong>{error || 'AI did not answer.'}</strong>{status === 429 && 'Limits keep the AI fair for the whole class.'}</span>
      {onRetry && status !== 429 && <button type="button" className="btn btn-sm shrink-0" onClick={onRetry}>Try again</button>}
    </div>
  );
}
