import type { APIRoute } from 'astro';
import { download, myData, myDataFile } from '../../../server/exports';

export const GET: APIRoute = ({ locals }) =>
  download(JSON.stringify(myData(locals.user!.id), null, 2), myDataFile(locals.user!.username), 'application/json; charset=utf-8');
