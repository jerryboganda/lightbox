import type { APIRoute } from 'astro';
import { commentsExport, denied, download, isAdmin } from '../../../../server/admin';

export const GET: APIRoute = ({ locals }) => (isAdmin(locals.user) ? download(JSON.stringify(commentsExport(), null, 2), 'comments', 'application/json; charset=utf-8') : denied());
