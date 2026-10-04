// One polite live region for the whole app. Usable from islands and plain scripts.
export function toast(message: string, tone: 'ok' | 'bad' | 'info' = 'info') {
  let host = document.getElementById('lb-toasts');
  if (!host) {
    host = document.createElement('div');
    host.id = 'lb-toasts';
    host.setAttribute('role', 'status');
    host.setAttribute('aria-live', 'polite');
    document.body.append(host);
  }
  const el = document.createElement('div');
  el.className = `lb-toast t-${tone}`;
  el.textContent = message;
  host.append(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 260); }, 2600);
}
