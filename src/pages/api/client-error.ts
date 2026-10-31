import type { APIRoute } from 'astro';
import { clientError } from '../../server/log';
import { readBody } from '../../server/personal';

// { message, stack?, url? } from the browser's error handlers; rate limited per user.
export const POST: APIRoute = async ({ request, locals }) => {
  const ok = clientError(locals.user!.id, await readBody(request));
  return new Response(null, { status: ok ? 204 : 202 });
};
