export const reduced = () => {
  const m = document.documentElement.dataset.motion;
  return m === 'reduced' || (m !== 'full' && matchMedia('(prefers-reduced-motion: reduce)').matches);
};

// Numbers settle into place instead of popping in.
export function countUp(root: ParentNode = document) {
  if (reduced()) return;
  root.querySelectorAll<HTMLElement>('[data-count]').forEach((el, i) => {
    const n = Number(el.dataset.count);
    if (!Number.isFinite(n) || n === 0) return;
    const t0 = performance.now() + 120 + i * 40;
    const tick = (t: number) => {
      const p = Math.max(0, Math.min(1, (t - t0) / 900));
      el.textContent = String(Math.round(n * (1 - Math.pow(1 - p, 4))));
      if (p < 1) requestAnimationFrame(tick);
    };
    el.textContent = '0';
    requestAnimationFrame(tick);
  });
}

// Primary buttons lean slightly toward the pointer.
export function magnetic(root: ParentNode = document) {
  if (reduced() || matchMedia('(pointer: coarse)').matches) return;
  root.querySelectorAll<HTMLElement>('.magnetic').forEach((el) => {
    el.style.transition = 'transform 260ms cubic-bezier(0.16,1,0.3,1)';
    el.addEventListener('pointermove', (e) => {
      const r = el.getBoundingClientRect();
      el.style.transform = `translate(${((e.clientX - r.left) / r.width - 0.5) * 6}px, ${((e.clientY - r.top) / r.height - 0.5) * 5}px)`;
    });
    el.addEventListener('pointerleave', () => (el.style.transform = ''));
  });
}
