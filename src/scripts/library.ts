// Actions on the library pages, delegated once for the session (pages swap under the ClientRouter).
import { navigate } from 'astro:transitions/client';
import { toast } from './toast';
import { reduced } from './motion';
import './marks';

const J = { 'content-type': 'application/json' };
async function api(url: string, method: string, body?: unknown) {
  const r = await fetch(url, { method, headers: J, body: body === undefined ? undefined : JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'Something went wrong. Try again.');
  return j;
}
const fail = (e: unknown) => toast(e instanceof Error ? e.message : 'Something went wrong. Try again.', 'bad');

function bump(tab: string, d: number) {
  const c = document.querySelector(`[data-tab-count="${tab}"]`);
  if (c) c.textContent = String(Math.max(0, Number(c.textContent) + d));
}

// Fade the row out; when a list empties, re-render the page so its empty state shows.
function dropRow(row: Element | null, tab?: string) {
  if (!row) return;
  const list = row.closest('[data-list]');
  const done = () => {
    row.remove();
    if (tab) bump(tab, -1);
    if (list && !list.querySelector('[data-row]')) navigate(location.pathname + location.search, { history: 'replace' });
  };
  if (reduced()) return done();
  row.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateX(14px)' }], { duration: 240, easing: 'cubic-bezier(0.16,1,0.3,1)' }).finished.then(done, done);
}

// Two-step destructive buttons: the first press arms, the second within 4 s acts.
function armed(b: HTMLElement) {
  if (b.dataset.armed) return true;
  b.dataset.armed = '1';
  const label = b.querySelector('[data-label]'), prevLabel = label?.textContent, prevAria = b.getAttribute('aria-label');
  if (label) label.textContent = b.dataset.confirm!;
  b.setAttribute('aria-label', b.dataset.confirm!);
  b.classList.add('is-armed');
  toast(`${b.dataset.confirm} Press again to confirm.`, 'info');
  setTimeout(() => {
    delete b.dataset.armed;
    b.classList.remove('is-armed');
    if (label && prevLabel != null) label.textContent = prevLabel;
    if (prevAria) b.setAttribute('aria-label', prevAria); else b.removeAttribute('aria-label');
  }, 4000);
  return false;
}

// Swap a collection row with its neighbour, animate the move (FLIP), and save the order shortly after.
let orderTimer = 0;
function move(b: HTMLButtonElement, dir: number) {
  const row = b.closest<HTMLElement>('[data-row]'), list = row?.parentElement;
  if (!row || !list) return;
  const other = (dir < 0 ? row.previousElementSibling : row.nextElementSibling) as HTMLElement | null;
  if (!other) return;
  const r1 = row.getBoundingClientRect(), r2 = other.getBoundingClientRect();
  if (dir < 0) list.insertBefore(row, other); else list.insertBefore(other, row);
  if (!reduced()) {
    row.animate([{ transform: `translateY(${r1.top - row.getBoundingClientRect().top}px)` }, { transform: 'none' }], { duration: 280, easing: 'cubic-bezier(0.16,1,0.3,1)' });
    other.animate([{ transform: `translateY(${r2.top - other.getBoundingClientRect().top}px)` }, { transform: 'none' }], { duration: 280, easing: 'cubic-bezier(0.16,1,0.3,1)' });
  }
  syncMoveButtons(list);
  // At the top or bottom the pressed button turns off: keep keyboard focus on its partner.
  (b.disabled ? b.parentElement?.querySelector<HTMLElement>('[data-act="move"]:not(:disabled)') : b)?.focus();
  clearTimeout(orderTimer);
  const cid = list.closest<HTMLElement>('[data-collection]')?.dataset.collection;
  orderTimer = window.setTimeout(() => {
    const order = [...list.querySelectorAll<HTMLElement>('[data-item]')].map((r) => ({ type: r.dataset.type, id: r.dataset.id }));
    api(`/api/collections/${cid}/items`, 'PUT', { order }).then(() => toast('Order saved', 'ok'), fail);
  }, 500);
}
function syncMoveButtons(list: Element) {
  const rows = [...list.querySelectorAll<HTMLElement>('[data-item]')];
  rows.forEach((r, i) => {
    r.querySelector<HTMLButtonElement>('[data-act="move"][data-dir="-1"]')!.disabled = i === 0;
    r.querySelector<HTMLButtonElement>('[data-act="move"][data-dir="1"]')!.disabled = i === rows.length - 1;
  });
}

async function act(b: HTMLElement) {
  const { act: a, id = '', type = '' } = b.dataset;
  if (b.dataset.busy || (b.dataset.confirm && !armed(b))) return;
  b.dataset.busy = '1'; // a double press must not copy or delete twice
  const row = b.closest('[data-row]');
  try {
    if (a === 'del-note') { await api(`/api/notes?type=${encodeURIComponent(type)}&id=${encodeURIComponent(id)}`, 'DELETE'); dropRow(row, 'notes'); toast('Note deleted', 'ok'); }
    else if (a === 'del-hl') { await api(`/api/highlights?id=${id}`, 'DELETE'); dropRow(row, 'highlights'); toast('Highlight deleted', 'ok'); }
    else if (a === 'del-card') { await api(`/api/cards/U${id}`, 'DELETE'); dropRow(row, 'cards'); toast('Card deleted', 'ok'); }
    else if (a === 'edit-card') {
      const d = document.getElementById('card-dlg') as HTMLDialogElement, f = d.querySelector('form')!;
      f.dataset.id = id;
      (f.elements.namedItem('front') as HTMLTextAreaElement).value = row?.querySelector('[data-front]')?.textContent ?? '';
      (f.elements.namedItem('back') as HTMLTextAreaElement).value = row?.querySelector('[data-back]')?.textContent ?? '';
      d.showModal();
    }
    else if (a === 'edit-col') (document.getElementById('col-dlg') as HTMLDialogElement).showModal();
    else if (a === 'share') {
      const on = b.getAttribute('aria-checked') !== 'true';
      await api(`/api/collections/${id}`, 'PATCH', { shared: on });
      b.setAttribute('aria-checked', String(on));
      document.querySelectorAll('[data-share-state]').forEach((el) => { el.textContent = on ? 'shared' : 'private'; el.classList.toggle('s-agreed', on); el.classList.toggle('s-neutral', !on); });
      toast(on ? 'Shared with the class. Classmates can view and copy it.' : 'Collection is private again', 'ok');
    }
    else if (a === 'del-col') { await api(`/api/collections/${id}`, 'DELETE'); toast('Collection deleted', 'ok'); navigate('/library?tab=collections'); }
    else if (a === 'copy-col') { const r = await api(`/api/collections/${id}/copy`, 'POST'); toast('Copied to your collections', 'ok'); navigate(`/library/c/${r.id}`); }
    else if (a === 'rm-item') {
      const cid = b.closest<HTMLElement>('[data-collection]')?.dataset.collection;
      await api(`/api/collections/${cid}/items`, 'POST', { type, id, on: false });
      const list = row?.parentElement;
      dropRow(row);
      document.querySelectorAll('[data-item-count]').forEach((el) => (el.textContent = String(Math.max(0, Number(el.textContent) - 1))));
      if (list) setTimeout(() => syncMoveButtons(list), 300);
      toast('Removed from the collection', 'ok');
    }
    else if (a === 'move') move(b as HTMLButtonElement, Number(b.dataset.dir));
  } catch (e) { fail(e); }
  delete b.dataset.busy;
}

async function submit(f: HTMLFormElement) {
  const v = (n: string) => ((f.elements.namedItem(n) as HTMLInputElement | null)?.value ?? '').trim();
  const btn = f.querySelector<HTMLButtonElement>('button:not([type="button"])');
  if (btn) btn.disabled = true;
  try {
    if (f.dataset.form === 'new-col') {
      const r = await api('/api/collections', 'POST', { name: v('name'), description: v('description') });
      toast('Collection created', 'ok');
      navigate(`/library/c/${r.id}`);
    } else if (f.dataset.form === 'edit-card') {
      const id = f.dataset.id!, front = v('front'), back = v('back');
      await api(`/api/cards/U${id}`, 'PATCH', { front, back });
      const card = document.querySelector(`[data-card="${id}"]`);
      card?.querySelector('[data-front]')?.replaceChildren(front);
      card?.querySelector('[data-back]')?.replaceChildren(back);
      f.closest('dialog')?.close();
      toast('Card saved', 'ok');
    } else if (f.dataset.form === 'edit-col') {
      const name = v('name'), description = v('description');
      await api(`/api/collections/${f.dataset.id}`, 'PATCH', { name, description });
      document.querySelectorAll('[data-col-name]').forEach((el) => el.replaceChildren(name));
      document.querySelectorAll('[data-col-desc]').forEach((el) => { el.replaceChildren(description); el.classList.toggle('hidden', !description); });
      f.closest('dialog')?.close();
      toast('Collection saved', 'ok');
    }
  } catch (e) { fail(e); }
  if (btn) btn.disabled = false;
}

const w = window as unknown as { lbLibrary?: boolean };
if (!w.lbLibrary) {
  w.lbLibrary = true;
  document.addEventListener('click', (e) => {
    const t = e.target as Element;
    const b = t.closest?.<HTMLElement>('[data-act]');
    if (b && !(b as HTMLButtonElement).disabled) { e.preventDefault(); act(b); return; }
    if (t.closest?.('[data-close]')) t.closest('dialog')?.close();
    else if (t instanceof HTMLDialogElement && t.classList.contains('lb-dialog')) t.close(); // backdrop
  });
  // Capture phase: claim our forms before the ClientRouter turns them into navigations.
  document.addEventListener('submit', (e) => {
    const f = e.target as HTMLFormElement;
    if (!f.dataset?.form) return;
    e.preventDefault();
    submit(f);
  }, true);
  // On narrow screens the section tabs scroll: bring the current one into view.
  const centerTab = () => {
    const nav = document.querySelector<HTMLElement>('.ltabs'), on = nav?.querySelector<HTMLElement>('[aria-current="page"]');
    if (nav && on) nav.scrollLeft = on.offsetLeft - (nav.clientWidth - on.offsetWidth) / 2;
  };
  document.addEventListener('astro:page-load', centerTab);
  centerTab();
  // Keep the library's note previews in step with the inline editor.
  window.addEventListener('lb:note', (e) => {
    const { type, id, body } = (e as CustomEvent).detail;
    document.querySelectorAll(`[data-note-preview="${CSS.escape(`${type}|${id}`)}"]`).forEach((el) => (el.textContent = body));
  });
}
