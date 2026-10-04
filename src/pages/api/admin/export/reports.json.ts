import type { APIRoute } from 'astro';
import { denied, download, isAdmin, reportsExport } from '../../../../server/admin';

// Every report with a snapshot of the item, for the content pipeline to act on.
export const GET: APIRoute = ({ locals }) => (isAdmin(locals.user) ? download(JSON.stringify(reportsExport(), null, 2), 'reports', 'application/json; charset=utf-8') : denied());
