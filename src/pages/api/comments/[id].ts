import type { APIRoute } from 'astro';
import { deleteComment, editComment } from '../../../server/class';
import { fail, intId, readBody } from '../../../server/personal';

// { body } edits your own comment.
export const PATCH: APIRoute = async ({ params, request, locals }) => {
  const b = await readBody(request);
  const r = editComment(locals.user!, intId(params.id), b?.body);
  return 'error' in r ? fail(r.error, r.status) : Response.json(r);
};

export const DELETE: APIRoute = ({ params, locals }) =>
  deleteComment(locals.user!, intId(params.id)) ? Response.json({ ok: true }) : fail('Comment not found.', 404);
