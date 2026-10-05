import type { APIRoute } from 'astro';
import { mcqPoll, pollById, pollView } from '../../../server/class';
import { fail, intId } from '../../../server/personal';

// ?mcq=<qid> → that MCQ's class poll (created on first request; disputed or unkeyed MCQs only). ?id=<n> → any poll.
export const GET: APIRoute = ({ locals, url }) => {
  const qid = url.searchParams.get('mcq');
  const p = qid ? (qid.length <= 40 ? mcqPoll(qid) : null) : pollById(intId(url.searchParams.get('id')));
  return p ? Response.json(pollView(locals.user!.id, p), { headers: { 'cache-control': 'no-store' } }) : fail('No poll here.', 404);
};
