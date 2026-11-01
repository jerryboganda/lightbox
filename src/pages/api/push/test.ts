import type { APIRoute } from 'astro';
import { fail } from '../../../server/personal';
import { pushTo, vapid } from '../../../server/push';

const last = new Map<number, number>();

// Sends a test reminder to every device of the signed-in member, at most once a minute.
export const POST: APIRoute = async ({ locals }) => {
  const uid = locals.user!.id;
  if (!vapid()) return fail('Reminders are not set up on this server.', 404);
  if ((last.get(uid) ?? 0) > Date.now() - 60_000) return fail('Wait a minute before sending another test.', 429);
  last.set(uid, Date.now());
  const sent = await pushTo(uid);
  return sent ? Response.json({ sent }) : fail('No device accepted it. Turn reminders off and on again.', 502);
};
