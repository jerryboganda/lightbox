import type { APIRoute } from 'astro';
import { copyCollection, fail, intId } from '../../../../server/personal';

export const POST: APIRoute = ({ locals, params }) => {
  const id = copyCollection(locals.user!.id, intId(params.id));
  return id ? Response.json({ id }, { status: 201 }) : fail('Collection not found, or you have reached 100 collections.', 404);
};
