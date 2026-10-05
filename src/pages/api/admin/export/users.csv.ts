import type { APIRoute } from 'astro';
import { denied, download, isAdmin, usersCsv } from '../../../../server/admin';

// Accounts only; never password hashes or sessions.
export const GET: APIRoute = ({ locals }) => (isAdmin(locals.user) ? download(usersCsv(), 'users', 'text/csv; charset=utf-8') : denied());
