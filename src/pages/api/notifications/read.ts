import type { APIRoute } from 'astro';
import { markRead, unreadCount } from '../../../server/class';
import { fail, intId, readBody } from '../../../server/personal';

// { all: true } or { ids: number[] } → { unread }
export const POST: APIRoute = async ({ request, locals }) => {
  const uid = locals.user!.id, b = await readBody(request);
  const ids = Array.isArray(b?.ids) && b.ids.length <= 200 ? b.ids.map(intId).filter(Boolean) : null;
  if (b?.all !== true && !ids?.length) return fail('Say which notifications to mark read.');
  markRead(uid, b?.all === true ? 'all' : ids!);
  return Response.json({ unread: unreadCount(uid) });
};
