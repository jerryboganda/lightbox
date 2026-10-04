import type { APIRoute } from 'astro';
import { denied, hideAnnouncement, isAdmin, reply } from '../../../../server/admin';
import { intId } from '../../../../server/personal';

export const DELETE: APIRoute = ({ locals, params }) => (isAdmin(locals.user) ? reply(hideAnnouncement(locals.user.id, intId(params.id))) : denied());
