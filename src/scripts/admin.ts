// Admin console page script: announcements (post, take down) and KPI count-ups. Delegated once per session.
import { navigate } from 'astro:transitions/client';
import { toast } from './toast';
import { countUp } from './motion';

async function send(url: string, method: string, body?: unknown) {
  const r = await fetch(url, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }).catch(() => null);
  const j = (await r?.json().catch(() => null)) ?? {};
  if (!r?.ok) throw new Error(j.error || (r ? 'That did not work. Try again.' : 'You seem to be offline.'));
  return j;
}
const refresh = () => navigate(location.pathname + location.search, { history: 'replace' });
const fail = (e: unknown) => toast(e instanceof Error ? e.message : 'That did not work. Try again.', 'bad');

if (!(window as any).lbAdmin) {
  (window as any).lbAdmin = true;
  // Capture on window so this runs before the view-transition router turns the submit into a navigation.
  window.addEventListener('submit', async (e) => {
    const f = (e.target as HTMLElement).closest<HTMLFormElement>('form[data-ann-form]');
    if (!f) return;
    e.preventDefault();
    e.stopPropagation();
    const b = f.querySelector<HTMLButtonElement>('button:not([type="button"])')!;
    if (b.disabled) return;
    b.disabled = true;
    const notify = (f.elements.namedItem('notify') as HTMLInputElement).checked;
    try {
      await send('/api/admin/announcements', 'POST', { body: (f.elements.namedItem('body') as HTMLTextAreaElement).value, notify });
      toast(notify ? 'Posted. Everyone was notified.' : 'Posted to dashboards.', 'ok');
      await refresh();
    } catch (err) { fail(err); b.disabled = false; }
  }, { capture: true });
  document.addEventListener('click', async (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-ann-hide]');
    if (!b || b.disabled) return;
    b.disabled = true;
    try { await send(`/api/admin/announcements/${b.dataset.annHide}`, 'DELETE'); toast('Taken down.', 'ok'); await refresh(); } catch (err) { fail(err); b.disabled = false; }
  });
  document.addEventListener('input', (e) => {
    const t = e.target as HTMLTextAreaElement;
    if (t.dataset?.countInto) document.getElementById(t.dataset.countInto)!.textContent = String(t.value.length);
  });
  document.addEventListener('astro:page-load', kpis);
}
// The first page-load event can fire before this module runs; the flag stops a second count-up.
function kpis() {
  const k = document.querySelector<HTMLElement>('[data-kpis]:not([data-counted])');
  if (k) { k.dataset.counted = ''; countUp(k); }
}
kpis();
