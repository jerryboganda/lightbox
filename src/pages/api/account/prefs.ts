import type { APIRoute } from 'astro';
import { fail, readBody } from '../../../server/personal';
import { getProfile, setPrefs, setRetention } from '../../../server/profile';

// POST { retention?: 0.80-0.97, remindAt?: minutes after midnight (Pakistan time) | null } → { retention, remindAt }.
export const POST: APIRoute = async ({ request, locals }) => {
  const uid = locals.user!.id;
  const b = await readBody(request);
  if (!b) return fail('Send the settings as JSON.');
  if ('retention' in b) {
    const r = setRetention(uid, b.retention);
    if (typeof r === 'string') return fail(r);
  }
  if ('remindAt' in b) {
    const m = b.remindAt;
    if (m !== null && (typeof m !== 'number' || !Number.isInteger(m) || m < 0 || m > 1439)) return fail('Pick a reminder time.');
    setPrefs(uid, { remindAt: m ?? undefined });
  }
  const p = getProfile(uid);
  return Response.json({ retention: p.retention, remindAt: p.prefs.remindAt ?? null });
};
