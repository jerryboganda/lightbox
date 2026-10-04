import type { APIRoute } from 'astro';
import { fileReport } from '../../server/class';
import { fail, readBody } from '../../server/personal';

// { type, id, kind, body?, quote?, path? } files a report for the admins.
export const POST: APIRoute = async ({ request, locals }) => {
  const b = await readBody(request);
  if (!b) return fail('Choose what is wrong.');
  const r = fileReport(locals.user!, b);
  return 'error' in r ? fail(r.error, r.status) : Response.json(r, { status: 201 });
};
