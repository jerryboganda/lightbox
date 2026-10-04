// Small client helpers shared by the class islands (threads, polls, notifications).
export const JSON_HEADERS = { 'content-type': 'application/json' };

export const ago = (t: number) => {
  const s = (Date.now() - t) / 1000;
  return s < 60 ? 'just now' : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86_400 ? `${Math.round(s / 3600)} h ago` : s < 7 * 86_400 ? `${Math.round(s / 86_400)} d ago`
    : new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: s > 300 * 86_400 ? 'numeric' : undefined });
};
export const fullDate = (t: number) => new Date(t).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
export const initials = (name: string) => name.split(/\s+/).filter(Boolean).map((s) => s[0]).join('').slice(0, 2).toUpperCase() || '?';
/** Same-origin app paths only, so stored links can never leave the site. */
export const safeHref = (h: unknown): h is string => typeof h === 'string' && /^\/(?![\/\\])/.test(h);

/** JSON request; resolves to the parsed body, or throws an Error carrying the server's message. */
export async function send<T>(url: string, method: string, body?: unknown): Promise<T> {
  const r = await fetch(url, { method, headers: JSON_HEADERS, body: body === undefined ? undefined : JSON.stringify(body) }).catch(() => null);
  const j = r ? await r.json().catch(() => ({})) : {};
  if (!r?.ok) throw new Error(j.error || (r ? 'Something went wrong. Try again.' : "You're offline. Try again when you're connected."));
  return j as T;
}
