import type { APIRoute } from 'astro';
import { recordSession } from '../../../server/analytics';

// One finished focus or break phase, or a batch from the timer's offline outbox. Idempotent on clientId.
export const POST: APIRoute = async ({ request, locals }) => {
  const body = await request.json().catch(() => null);
  const items = (Array.isArray(body) ? body : [body]).filter(Boolean).slice(0, 50);
  if (!items.length) return Response.json({ error: 'Nothing to record.' }, { status: 400 });
  const ok = items.filter((s) => recordSession(locals.user!.id, s)).length;
  return Response.json({ ok, rejected: items.length - ok }, { status: ok ? 200 : 400 });
};
