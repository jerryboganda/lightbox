// Buttons with data-timer="open|goals|start" talk to the StudyTimer island. It hydrates on idle,
// so the request is also left on window for it to pick up when it mounts.
export type TimerRequest = 'open' | 'goals' | 'start';
export function openTimer(mode: TimerRequest = 'open') {
  (window as any).lbTimerWanted = mode;
  window.dispatchEvent(new CustomEvent('lb:timer', { detail: mode }));
}
if (!(window as any).lbTimerClicks) {
  (window as any).lbTimerClicks = true;
  document.addEventListener('click', (e) => {
    const b = (e.target as Element).closest?.<HTMLElement>('[data-timer]');
    if (b) openTimer((['goals', 'start'].includes(b.dataset.timer!) ? b.dataset.timer : 'open') as TimerRequest);
  });
}
