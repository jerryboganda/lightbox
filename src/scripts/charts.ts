// Chart tooltips and keyboard roving for server-rendered charts. Marks carry data-tip; a [data-rove] group is one tab stop.
let cur: HTMLElement | null = null;

const tip = () => {
  let t = document.getElementById('ch-tip');
  if (!t) {
    t = document.createElement('div');
    t.id = 'ch-tip';
    t.setAttribute('aria-hidden', 'true'); // the focused mark's aria-label already says the same
    document.body.append(t);
  }
  return t;
};

function show(el: HTMLElement) {
  if (cur === el) return;
  hide();
  const t = tip();
  t.textContent = el.dataset.tip || '';
  const r = el.getBoundingClientRect(), w = t.offsetWidth, h = t.offsetHeight;
  const x = Math.min(Math.max(8, r.left + r.width / 2 - w / 2), innerWidth - w - 8);
  const y = r.top - h - 8 < 8 ? r.bottom + 8 : r.top - h - 8;
  t.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  t.dataset.on = '';
  el.classList.add('is-tip');
  cur = el;
}

function hide() {
  cur?.classList.remove('is-tip');
  cur = null;
  delete document.getElementById('ch-tip')?.dataset.on;
}

const mark = (e: Event) => (e.target as Element).closest?.<HTMLElement>('[data-tip]') ?? null;

if (!(window as any).lbCharts) {
  (window as any).lbCharts = true;
  document.addEventListener('pointerover', (e) => { const el = mark(e); if (el) show(el); else if (!document.activeElement?.closest('[data-tip]')) hide(); });
  document.addEventListener('focusin', (e) => { const el = mark(e); if (el) show(el); else hide(); });
  // Arrow keys can scroll the heatmap; keep the focused mark's tip, re-placed, instead of dropping it.
  document.addEventListener('scroll', () => { const el = cur; hide(); if (el && el === document.activeElement) show(el); }, { passive: true, capture: true });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') return hide();
    const el = mark(e), box = el?.closest('[data-rove]');
    if (!el || !box) return;
    const items = [...box.querySelectorAll<HTMLElement>('[data-tip]')], i = items.indexOf(el), step = Number(box.getAttribute('data-step') || 1);
    const j = ({ ArrowRight: i + step, ArrowLeft: i - step, ArrowDown: i + 1, ArrowUp: i - 1, Home: 0, End: items.length - 1 } as Record<string, number>)[e.key];
    if (j === undefined) return;
    e.preventDefault();
    const k = Math.max(0, Math.min(items.length - 1, j));
    el.tabIndex = -1;
    items[k].tabIndex = 0;
    items[k].focus();
  });
  document.addEventListener('astro:page-load', init);
}
// Wide charts in narrow cards start at the most recent end.
function init() {
  hide();
  document.querySelectorAll<HTMLElement>('[data-scroll-end]').forEach((el) => (el.scrollLeft = el.scrollWidth));
}
init();
