import type { APIRoute } from 'astro';
import { fail } from '../../../server/personal';
import { download, exportCards, fileStem, resolveScope, toCsv } from '../../../server/exports';

// Same scopes as /api/export/anki. Columns: Front, Back, Source, Status, Fact.
export const GET: APIRoute = ({ url, locals }) => {
  const uid = locals.user!.id, s = resolveScope(uid, url.searchParams.get('scope') ?? 'all');
  if (!s) return fail('That export is not available.', 404);
  const list = exportCards(uid, s.refs);
  if (!list.length) return fail('There are no cards in this selection yet.');
  return download(toCsv(list), `${fileStem(s.scope)}.csv`, 'text/csv; charset=utf-8');
};
