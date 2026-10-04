// "Collect" button + popover listing my collections with check states; place with client:visible.
import { useEffect, useId, useRef, useState } from 'react';
import { ArrowUpRight, FolderPlus, Plus } from 'lucide-react';
import { toast } from '../../scripts/toast';

export interface CollectMenuProps { itemType: 'fact' | 'topic' | 'mcq' | 'image'; itemId: string; compact?: boolean }
type Col = { id: number; name: string; count: number; has: number; shared: number };
const JSON_HEADERS = { 'content-type': 'application/json' };

export default function CollectMenu({ itemType, itemId, compact = false }: CollectMenuProps) {
  const pid = `collect-${useId().replace(/:/g, '')}`;
  const [list, setList] = useState<Col[] | null>(null);
  const [err, setErr] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const btn = useRef<HTMLButtonElement>(null), pop = useRef<HTMLDivElement>(null);
  const inCount = list?.filter((c) => c.has).length ?? 0;

  const load = () => {
    setErr(false);
    fetch(`/api/collections?type=${itemType}&id=${encodeURIComponent(itemId)}`).then((r) => (r.ok ? r.json() : Promise.reject())).then(setList).catch(() => setErr(true));
  };

  // Place under the trigger (phones get a bottom sheet from CSS), then focus the first control.
  const onToggle = (e: { newState?: string }) => {
    if (e.newState !== 'open') return;
    if (!list) load();
    const p = pop.current, b = btn.current;
    if (p && b) {
      const r = b.getBoundingClientRect(), W = p.offsetWidth, H = p.offsetHeight;
      p.style.left = `${Math.min(Math.max(8, r.right - W), innerWidth - W - 8)}px`;
      p.style.top = `${r.bottom + 6 + H < innerHeight ? r.bottom + 6 : Math.max(8, r.top - H - 6)}px`;
    }
    requestAnimationFrame(() => p?.querySelector<HTMLElement>('input')?.focus());
  };

  useEffect(() => {
    const p = pop.current;
    if (!p) return;
    const h = (e: Event) => onToggle(e as unknown as { newState?: string });
    p.addEventListener('toggle', h);
    return () => p.removeEventListener('toggle', h);
  });
  // The popover works before hydration (popovertarget is plain HTML): catch up if it is already open.
  useEffect(() => { if (pop.current?.matches(':popover-open')) onToggle({ newState: 'open' }); }, []);

  const toggle = async (c: Col) => {
    const on = !c.has;
    const flip = (v: boolean) => setList((l) => l && l.map((x) => (x.id === c.id ? { ...x, has: Number(v), count: x.count + (v ? 1 : -1) } : x)));
    flip(on);
    const r = await fetch(`/api/collections/${c.id}/items`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ type: itemType, id: itemId, on }) }).catch(() => null);
    if (!r?.ok) { flip(!on); toast("Couldn't update that collection.", 'bad'); return; }
    toast(on ? `Added to ${c.name}` : `Removed from ${c.name}`, 'ok');
  };

  const create = async (e: { preventDefault(): void }) => {
    e.preventDefault();
    const n = name.trim();
    if (!n || busy) return;
    setBusy(true);
    const r = await fetch('/api/collections', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ name: n, item: { type: itemType, id: itemId } }) }).catch(() => null);
    setBusy(false);
    if (!r?.ok) { toast((await r?.json().catch(() => null))?.error ?? "Couldn't create the collection.", 'bad'); return; }
    const { id } = await r.json();
    setList((l) => [{ id, name: n, count: 1, has: 1, shared: 0 }, ...(l ?? [])]);
    setName('');
    toast(`Added to ${n}`, 'ok');
  };

  return (
    <>
      <button ref={btn} type="button" popoverTarget={pid} className={`btn btn-sm btn-ghost${compact ? ' !px-2' : ''}${inCount ? ' text-accent' : ''}`}
        aria-label={compact ? `Add ${itemId} to a collection${inCount ? ` (in ${inCount})` : ''}` : undefined} title={compact ? 'Add to a collection' : undefined}>
        <FolderPlus size={15} aria-hidden="true" />{!compact && <span>Collect</span>}
        {inCount > 0 && <><span className="num text-[11px]" aria-hidden="true">{inCount}</span>{!compact && <span className="sr-only">, in {inCount}</span>}</>}
      </button>
      <div ref={pop} id={pid} popover="auto" className="lb-cpop" role="dialog" aria-label="Add to collections">
        <div className="px-2.5 pb-1.5 pt-1.5 text-xs font-medium text-faint">Add to collections</div>
        <div className="max-h-64 overflow-y-auto">
          {err ? (
            <p className="px-2.5 py-3 text-sm text-muted">Couldn't load your collections. <button type="button" className="text-accent underline" onClick={load}>Retry</button></p>
          ) : !list ? (
            <div className="space-y-1.5 p-1.5" aria-busy="true"><div className="skeleton h-8" /><div className="skeleton h-8" /></div>
          ) : !list.length ? (
            <p className="px-2.5 py-2 text-sm text-muted">No collections yet. Name your first one below.</p>
          ) : (
            <ul>{list.map((c) => (
              <li key={c.id}>
                <label className="lb-crow">
                  <input type="checkbox" checked={!!c.has} onChange={() => toggle(c)} />
                  <span className="min-w-0 flex-1 truncate">{c.name}</span>
                  {!!c.shared && <span className="badge s-agreed">class</span>}
                  <span className="num text-xs text-faint">{c.count}</span>
                </label>
              </li>
            ))}</ul>
          )}
        </div>
        <form onSubmit={create} className="mt-1 flex gap-1.5 border-t border-line p-1.5 pt-2">
          <label className="sr-only" htmlFor={`${pid}-new`}>New collection name</label>
          <input id={`${pid}-new`} className="field !h-9 text-sm" placeholder="New collection" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
          <button type="submit" className="btn btn-primary btn-sm !h-9 shrink-0" disabled={!name.trim() || busy} aria-label="Create collection and add"><Plus size={15} aria-hidden="true" /></button>
        </form>
        <a href="/library?tab=collections" className="flex items-center gap-1 px-2.5 py-1.5 text-xs text-muted hover:text-accent">Manage collections<ArrowUpRight size={13} aria-hidden="true" /></a>
      </div>
    </>
  );
}
