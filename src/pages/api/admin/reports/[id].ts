import type { APIRoute } from 'astro';
import { denied, isAdmin, reply, resolveReport } from '../../../../server/admin';
import { intId, readBody } from '../../../../server/personal';

// { status: 'accepted' | 'rejected' | 'fixed', resolution? }. The reporter is notified.
export const POST: APIRoute = async ({ request, locals, params }) => {
  if (!isAdmin(locals.user)) return denied();
  const b = await readBody(request);
  return reply(resolveReport(locals.user.id, intId(params.id), b?.status, b?.resolution));
};
