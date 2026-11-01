import type { APIRoute } from 'astro';
import { fail, readBody } from '../../../server/personal';
import { pushCount, subscribe, unsubscribe, vapid } from '../../../server/push';

// POST { endpoint, keys: { p256dh, auth } } saves this browser for reminders; DELETE { endpoint } forgets it.
export const POST: APIRoute = async ({ request, locals }) => {
  if (!vapid()) return fail('Reminders are not set up on this server.', 404);
  const err = subscribe(locals.user!.id, await readBody(request));
  return err ? fail(err) : Response.json({ devices: pushCount(locals.user!.id) }, { status: 201 });
};

export const DELETE: APIRoute = async ({ request, locals }) => {
  const b = await readBody(request);
  unsubscribe(locals.user!.id, b?.endpoint);
  return Response.json({ devices: pushCount(locals.user!.id) });
};
