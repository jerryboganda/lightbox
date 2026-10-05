import type { APIRoute } from 'astro';
import { fail } from '../../../server/personal';
import { ankiPackage, download, exportCards, fileStem, resolveScope } from '../../../server/exports';

// ?scope=all | system:<key> | bookmarks | weak | mine | collection:<id>
export const GET: APIRoute = ({ url, locals }) => {
  const uid = locals.user!.id, s = resolveScope(uid, url.searchParams.get('scope') ?? 'all');
  if (!s) return fail('That export is not available.', 404);
  const list = exportCards(uid, s.refs);
  if (!list.length) return fail('There are no cards in this selection yet.');
  return download(new Uint8Array(ankiPackage(s.label, list)), `${fileStem(s.scope)}.apkg`, 'application/octet-stream');
};
