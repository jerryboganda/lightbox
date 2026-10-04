// Private note on any item; place with client:visible. Autosaves ~700 ms after typing stops.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Check, CloudOff, Lock, Trash2 } from 'lucide-react';
import { toast } from '../../scripts/toast';

export interface NotePadProps { itemType: 'fact' | 'topic' | 'mcq' | 'image'; itemId: string; title?: string }
const MAX = 5000;
const ago = (t: number) => {
  const s = (Date.now() - t) / 1000;
  return s < 60 ? 'just now' : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86_400 ? `${Math.round(s / 3600)} h ago` : new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
};

export default function NotePad({ itemType, itemId, title }: NotePadProps) {
  const [body, setBody] = useState('');
  const [state, setState] = useState<'loading' | 'unloaded' | 'idle' | 'saving' | 'saved' | 'error'>('loading');
  const [updated, setUpdated] = useState<number | null>(null);
  const [confirm, setConfirm] = useState(false);
  const ta = useRef<HTMLTextAreaElement>(null);
  const saved = useRef('');
  const pending = useRef<string | null>(null);
  const timer = useRef(0);
  const q = `type=${itemType}&id=${encodeURIComponent(itemId)}`;

  useEffect(() => {
    fetch(`/api/notes?${q}`).then((r) => (r.ok ? r.json() : Promise.reject())).then((n: { body: string; updatedAt: number | null }) => {
      saved.current = n.body; setBody(n.body); setUpdated(n.updatedAt); setState('idle');
    }).catch(() => setState('unloaded')); // never save over a note we could not read
  }, [q]);

  const save = useCallback(async (text: string, keepalive = false) => {
    clearTimeout(timer.current);
    pending.current = null;
    if (text === saved.current) { setState('idle'); return; }
    setState('saving');
    try {
      const r = await fetch('/api/notes', { method: 'PUT', keepalive, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: itemType, id: itemId, body: text }) });
      if (!r.ok) throw new Error(String(r.status));
      saved.current = text;
      setUpdated(text.trim() ? (await r.json()).updatedAt : null);
      setState('saved');
      window.dispatchEvent(new CustomEvent('lb:note', { detail: { type: itemType, id: itemId, body: text } }));
    } catch { setState('error'); }
  }, [itemType, itemId]);

  // Unsaved text is sent when the island goes away (navigation) or the tab is hidden.
  useEffect(() => {
    const flush = () => { if (pending.current !== null) save(pending.current, true); };
    addEventListener('pagehide', flush);
    document.addEventListener('astro:before-preparation', flush);
    return () => { removeEventListener('pagehide', flush); document.removeEventListener('astro:before-preparation', flush); flush(); };
  }, [save]);

  useLayoutEffect(() => {
    const t = ta.current;
    if (!t) return;
    t.style.height = 'auto';
    t.style.height = `${t.scrollHeight}px`;
  }, [body]);

  const change = (v: string) => {
    setBody(v);
    setConfirm(false);
    pending.current = v;
    clearTimeout(timer.current);
    timer.current = window.setTimeout(() => save(v), 700);
  };

  const remove = async () => {
    if (!confirm) { setConfirm(true); setTimeout(() => setConfirm(false), 4000); return; }
    setConfirm(false);
    setBody('');
    await save('');
    toast('Note deleted', 'ok');
    ta.current?.focus();
  };

  const status = state === 'loading' ? 'Loading…' : state === 'unloaded' ? "Couldn't load your note. Reload to try again." : state === 'saving' ? 'Saving…' : state === 'error' ? 'Not saved. Retrying when you type.'
    : state === 'saved' ? 'Saved' : updated ? `Saved ${ago(updated)}` : 'Only you can see this';
  const near = body.length > MAX - 500;

  return (
    <section className="lb-note" aria-label={title ? `Private note on ${title}` : 'Private note'} data-no-highlight>
      <div className="flex items-center gap-2 px-4 pb-1.5 pt-3 text-xs">
        <Lock size={13} className="text-faint" aria-hidden="true" />
        <span className="font-medium text-muted">Private note</span>
        <span className={`ml-auto flex items-center gap-1.5 ${state === 'error' || state === 'unloaded' ? 'text-bad' : 'text-faint'}`}>
          {state === 'saving' && <span className="lb-dot pulse text-accent" aria-hidden="true" />}
          {state === 'saved' && <Check size={13} className="text-ok" aria-hidden="true" />}
          {(state === 'error' || state === 'unloaded') && <CloudOff size={13} aria-hidden="true" />}
          {status}
        </span>
        <span className="sr-only" role="status">{state === 'error' ? 'Your note was not saved.' : ''}</span>
      </div>
      <label htmlFor={`note-${itemType}-${itemId}`} className="sr-only">{title ? `Private note on ${title}` : 'Private note'}</label>
      <textarea id={`note-${itemType}-${itemId}`} ref={ta} rows={3} maxLength={MAX} value={body} disabled={state === 'loading' || state === 'unloaded'}
        placeholder="Write a mnemonic, a doubt or a link to a case. Only you can see it."
        onChange={(e) => change(e.target.value)} onBlur={() => pending.current !== null && save(pending.current)}
        onKeyDown={(e) => {
          if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'Enter')) { e.preventDefault(); save(body); }
          if (e.key === 'Escape') e.currentTarget.blur();
        }} />
      {(near || body) && (
        <div className="flex items-center justify-between gap-2 px-3 pb-2 text-xs">
          <span className={`num px-1 ${body.length >= MAX ? 'text-bad' : near ? 'text-signal' : 'invisible'}`}>{near ? `${body.length} / ${MAX}` : ''}</span>
          <button type="button" className={`btn btn-sm btn-ghost ${confirm ? '!text-bad' : 'text-muted'}`} onClick={remove} aria-label={confirm ? 'Confirm: delete this note' : 'Delete note'}>
            <Trash2 size={14} aria-hidden="true" />{confirm ? 'Delete?' : 'Delete'}
          </button>
        </div>
      )}
    </section>
  );
}
