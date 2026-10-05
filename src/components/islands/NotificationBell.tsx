// Top-bar bell: unread count plus a popover with the latest notifications. Mounted once in App.astro (transition:persist).
// The count refreshes on every page load and once a minute while the tab is visible.
import { useCallback, useEffect, useRef, useState, type MouseEvent } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Bell, BellOff, CheckCheck } from 'lucide-react';
import { navigate } from 'astro:transitions/client';
import { reduced } from '../../scripts/motion';
import { ago, fullDate, safeHref, send } from '../../scripts/class';
import '../../styles/class.css';

type N = { id: number; kind: string; title: string; body: string; href: string | null; createdAt: number; readAt: number | null };

export default function NotificationBell() {
  const [unread, setUnread] = useState(0);
  const [items, setItems] = useState<N[] | null>(null);
  const pop = useRef<HTMLDivElement>(null);
  const rm = typeof document !== 'undefined' && reduced();

  const refresh = useCallback(async (full = false) => {
    const r = await fetch(`/api/notifications?limit=${full ? 15 : 0}`).then((x) => (x.ok ? x.json() : null)).catch(() => null);
    if (!r) return;
    setUnread(r.unread);
    if (full) setItems(r.items);
  }, []);

  useEffect(() => {
    let t = 0;
    const tick = () => { clearInterval(t); if (document.visibilityState === 'visible') { refresh(pop.current?.matches(':popover-open')); t = window.setInterval(() => refresh(), 60_000); } };
    const onPage = () => refresh();
    const onChange = (e: Event) => { const n = (e as CustomEvent<{ unread?: number }>).detail?.unread; if (typeof n === 'number') setUnread(n); else refresh(); };
    const hide = () => pop.current?.hidePopover?.();
    const onToggle = (e: Event) => { if ((e as ToggleEvent).newState === 'open') refresh(true); };
    tick();
    document.addEventListener('visibilitychange', tick);
    document.addEventListener('astro:page-load', onPage);
    document.addEventListener('astro:before-swap', hide);
    window.addEventListener('lb:notifications', onChange);
    pop.current?.addEventListener('toggle', onToggle);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', tick);
      document.removeEventListener('astro:page-load', onPage);
      document.removeEventListener('astro:before-swap', hide);
      window.removeEventListener('lb:notifications', onChange);
      pop.current?.removeEventListener('toggle', onToggle);
    };
  }, [refresh]);

  const read = (ids: number[] | 'all') => {
    const left = ids === 'all' ? 0 : Math.max(0, unread - (items ?? []).filter((n) => ids.includes(n.id) && !n.readAt).length);
    setUnread(left);
    setItems((l) => l && l.map((n) => (ids === 'all' || ids.includes(n.id) ? { ...n, readAt: n.readAt ?? Date.now() } : n)));
    send<{ unread: number }>('/api/notifications/read', 'POST', ids === 'all' ? { all: true } : { ids })
      .then((r) => { setUnread(r.unread); window.dispatchEvent(new CustomEvent('lb:notifications-read', { detail: { ids } })); })
      .catch(() => refresh(true));
  };

  const open = (e: MouseEvent, n: N) => {
    if (!n.readAt) read([n.id]);
    if (!safeHref(n.href) || e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    pop.current?.hidePopover?.();
    navigate(n.href);
  };

  const label = unread ? `Notifications, ${unread} unread` : 'Notifications';
  return (
    <>
      <button type="button" className="btn btn-ghost btn-sm lb-bell !px-2" popoverTarget="lb-notif" aria-label={label} title={label}>
        <Bell size={18} aria-hidden="true" />
        <AnimatePresence initial={false}>
          {unread > 0 && (
            <motion.span key="n" className="lb-bell-n num" aria-hidden="true" initial={{ scale: rm ? 1 : 0.3, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: rm ? 1 : 0.3, opacity: 0 }}
              transition={rm ? { duration: 0.1 } : { type: 'spring', stiffness: 600, damping: 20 }}>
              <motion.span key={unread} className="block" initial={rm ? false : { y: -6, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ type: 'spring', stiffness: 500, damping: 26 }}>{unread > 9 ? '9+' : unread}</motion.span>
            </motion.span>
          )}
        </AnimatePresence>
      </button>
      <div id="lb-notif" ref={pop} popover="auto" className="lb-npop" role="dialog" aria-label="Notifications" data-no-highlight>
        <header>
          <h2 className="text-sm font-medium">Notifications{unread > 0 && <span className="num ml-1.5 text-xs font-normal text-muted">{unread} unread</span>}</h2>
          <button type="button" className="btn btn-ghost btn-sm" disabled={!unread} onClick={() => read('all')}><CheckCheck size={15} aria-hidden="true" />Mark all read</button>
        </header>
        {items === null ? (
          <div className="grid gap-2 p-3" aria-hidden="true"><div className="skeleton h-12" /><div className="skeleton h-12" /><div className="skeleton h-12" /></div>
        ) : items.length ? (
          <ul className="lb-nlist">
            {items.map((n) => (
              <li key={n.id}>
                {safeHref(n.href)
                  ? <a href={n.href} className="lb-ni" data-read={n.readAt ? '' : undefined} onClick={(e) => open(e, n)}><Row n={n} /></a>
                  : <button type="button" className="lb-ni" data-read={n.readAt ? '' : undefined} onClick={(e) => open(e, n)}><Row n={n} /></button>}
              </li>
            ))}
          </ul>
        ) : (
          <div className="grid justify-items-center gap-1.5 px-6 py-10 text-center">
            <span className="mb-1 grid h-11 w-11 place-items-center rounded-2xl bg-sunk text-faint"><BellOff size={20} aria-hidden="true" /></span>
            <p className="text-sm font-medium">You're all caught up</p>
            <p className="text-xs text-muted">Replies to your comments and class news land here.</p>
          </div>
        )}
        <footer><a href="/notifications" className="btn btn-ghost btn-sm w-full justify-center" onClick={() => pop.current?.hidePopover?.()}>See all notifications</a></footer>
      </div>
    </>
  );
}

function Row({ n }: { n: N }) {
  return (
    <>
      <span className="dot" aria-hidden="true" />
      <span className="min-w-0">
        <span className="t">{n.title}{!n.readAt && <span className="sr-only"> (unread)</span>}</span>
        {n.body && <span className="b">{n.body}</span>}
        <time dateTime={new Date(n.createdAt).toISOString()} title={fullDate(n.createdAt)}>{ago(n.createdAt)}</time>
      </span>
    </>
  );
}
