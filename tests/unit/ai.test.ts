import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createUser } from '../../src/server/auth';
import { db } from '../../src/server/db';
import {
  AI, MSG, approvedMcqs, callModel, chatMessages, citeIds, createChat, deleteChat, disputeRecord, explainFact, generateMcqs, getChat, parseMcqs,
  pendingCount, quota, renameChat, retrieve, sse, sseData, summariseDispute, topicFacts, tutorReply, validateMcq,
} from '../../src/server/ai';
import { facts, mcqs, topicBySlug } from '../../src/lib/data';

// The gateway is always mocked: no key exists on this machine and none is ever needed for tests.
const enc = new TextEncoder();
const stream = (chunks: string[]) => new Response(new ReadableStream({ start(c) { for (const x of chunks) c.enqueue(enc.encode(x)); c.close(); } }), { headers: { 'content-type': 'text/event-stream' } });
const deltas = (...parts: string[]) => stream([...parts.map((p) => `data: ${JSON.stringify({ choices: [{ delta: { content: p } }] })}\n\n`), 'data: [DONE]\n\n']);
const json = (content: string, tokens = 42) => Response.json({ choices: [{ message: { content } }], usage: { total_tokens: tokens } });
async function run<R>(g: AsyncGenerator<string, R>) {
  let text = '', r = await g.next();
  while (!r.done) { text += r.value; r = await g.next(); }
  return { text, result: r.value };
}
const call = (userId: number, o: Partial<Parameters<typeof callModel>[0]> = {}) =>
  callModel({ kind: 'tutor', userId, session: `lightbox-u${userId}-test`, messages: [{ role: 'user', content: 'hi' }], ...o });

let fetchMock = vi.fn();
const ids: Record<string, number> = {};
const idOf = (u: string) => (db.prepare('SELECT id FROM users WHERE username = ?').get(u) as { id: number }).id;
beforeAll(async () => {
  for (const [u, role] of [['ai-m1', 'member'], ['ai-m2', 'member'], ['ai-m3', 'member'], ['ai-m4', 'member'], ['ai-admin', 'admin']] as const) {
    await createUser(null, u, u, role, 'test-pass-123');
    ids[u] = idOf(u);
  }
});
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubEnv('OPENCODE_API_KEY', 'test-key');
  for (const k of ['AI_MODEL', 'AI_BASE_URL', 'AI_FALLBACK', 'AI_FALLBACK_MODEL', 'AI_DAILY_CAP']) vi.stubEnv(k, '');
  db.exec('DELETE FROM ai_usage; DELETE FROM ai_cache;');
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); AI.queueMs = 8_000; });

describe('gateway', () => {
  it('sends the Go headers, model and key from the environment, and counts usage', async () => {
    fetchMock.mockImplementation(async () => json('Hello'));
    const { text, result } = await run(call(ids['ai-m1'], { session: 'lightbox-u7-c9', maxTokens: 300 }));
    expect(text).toBe('Hello');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://opencode.ai/zen/go/v1/chat/completions');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ authorization: 'Bearer test-key', 'content-type': 'application/json', 'x-opencode-session': 'lightbox-u7-c9', 'user-agent': 'lightbox-tutor/1.0' });
    expect(JSON.parse(init.body)).toMatchObject({ model: 'deepseek-v4-flash', stream: false, max_tokens: 300, messages: [{ role: 'user', content: 'hi' }] });
    expect(result).toMatchObject({ cached: false, tokens: 42, quota: { used: 1, cap: 30 } });
    expect(db.prepare('SELECT n, tokens FROM ai_usage WHERE user_id = ?').get(ids['ai-m1'])).toEqual({ n: 1, tokens: 42 });

    vi.stubEnv('AI_MODEL', 'other-model');
    vi.stubEnv('AI_BASE_URL', 'http://localhost:9/v1/');
    await run(call(ids['ai-m1']));
    expect(fetchMock.mock.calls[1][0]).toBe('http://localhost:9/v1/chat/completions');
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).model).toBe('other-model');
  });

  it('answers 503 without a key and never calls out', async () => {
    vi.stubEnv('OPENCODE_API_KEY', '  ');
    await expect(run(call(ids['ai-m1']))).rejects.toMatchObject({ status: 503, message: MSG.off });
    const res = await sse(explainFact(ids['ai-m1'], facts[0].id), new AbortController());
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: MSG.off });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('enforces the daily cap per user, three times higher for admins', async () => {
    vi.stubEnv('AI_DAILY_CAP', '2');
    fetchMock.mockImplementation(async () => json('ok'));
    await run(call(ids['ai-m1']));
    await run(call(ids['ai-m1']));
    await expect(run(call(ids['ai-m1']))).rejects.toMatchObject({ status: 429, quota: { used: 2, cap: 2 } });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await run(call(ids['ai-m2'])); // other users are unaffected
    expect(quota(ids['ai-admin'])).toEqual({ used: 0, cap: 6 });
  });

  it('maps failures to friendly messages and does not count them', async () => {
    const u = ids['ai-m1'];
    fetchMock.mockResolvedValueOnce(new Response('down', { status: 500 }));
    await expect(run(call(u))).rejects.toMatchObject({ status: 502, message: MSG.silent });
    fetchMock.mockResolvedValueOnce(new Response('no', { status: 401 }));
    await expect(run(call(u))).rejects.toMatchObject({ status: 502, message: MSG.unavailable });
    fetchMock.mockResolvedValueOnce(new Response('slow down', { status: 429 }));
    await expect(run(call(u))).rejects.toMatchObject({ status: 429, message: MSG.busy });
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));
    await expect(run(call(u))).rejects.toMatchObject({ status: 504, message: MSG.silent });
    fetchMock.mockResolvedValueOnce(json(''));
    await expect(run(call(u))).rejects.toMatchObject({ message: MSG.silent });
    expect(quota(u).used).toBe(0);
  });

  it('falls back to paid Zen only when Go fails with a 5xx', async () => {
    vi.stubEnv('AI_FALLBACK', 'zen');
    vi.stubEnv('AI_FALLBACK_MODEL', 'paid-model');
    fetchMock.mockResolvedValueOnce(new Response('', { status: 503 })).mockResolvedValueOnce(json('from zen'));
    expect((await run(call(ids['ai-m1']))).text).toBe('from zen');
    expect(fetchMock.mock.calls[1][0]).toBe('https://opencode.ai/zen/v1/chat/completions');
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).model).toBe('paid-model');
    fetchMock.mockReset();
    fetchMock.mockResolvedValueOnce(new Response('', { status: 403 }));
    await expect(run(call(ids['ai-m1']))).rejects.toMatchObject({ message: MSG.unavailable });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('streams deltas whatever the chunking and stops at [DONE]', async () => {
    const body = 'data: {"choices":[{"delta":{"content":"Hel"}}]}\r\n\r\n: keep-alive\n\ndata: {"choices":[{"delta":{"role":"assistant"}}]}\n\ndata: {"choices":[{"delta":{"content":"lo"}}],"usage":{"total_tokens":9}}\n\ndata: [DONE]\n\ndata: {"choices":[{"delta":{"content":"IGNORED"}}]}\n\n';
    fetchMock.mockResolvedValue(stream(body.match(/[\s\S]{1,7}/g)!));
    const parts: string[] = [];
    const g = call(ids['ai-m1'], { stream: true });
    for (let r = await g.next(); !r.done; r = await g.next()) parts.push(r.value);
    expect(parts).toEqual(['Hel', 'lo']);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).stream).toBe(true);
    const got: string[] = [];
    for await (const d of sseData(stream(['data: a', '\ndata: b']).body!)) got.push(d);
    expect(got).toEqual(['a', 'b']);
  });

  it('allows two requests in flight, queues briefly, then answers busy; one at a time per user', async () => {
    AI.queueMs = 80;
    const gates: (() => void)[] = [];
    fetchMock.mockImplementation(() => new Promise((res) => gates.push(() => res(json('done')))));
    const p1 = run(call(ids['ai-m1'])), p2 = run(call(ids['ai-m2']));
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await expect(run(call(ids['ai-m1']))).rejects.toMatchObject({ status: 429, message: 'Wait for your current AI answer to finish.' });
    await expect(run(call(ids['ai-m3']))).rejects.toMatchObject({ status: 429, message: MSG.busy });
    const p4 = run(call(ids['ai-m4'])); // waits for a free slot
    gates[0]();
    await p1;
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    gates[1](); gates[2]();
    await expect(Promise.all([p2, p4])).resolves.toHaveLength(2);
    expect(quota(ids['ai-m3']).used).toBe(0);
  });

  it('neither sends nor counts a request whose student left while it was queued', async () => {
    AI.queueMs = 2_000;
    const gates: (() => void)[] = [];
    fetchMock.mockImplementation((_url: string, init: RequestInit) => (init.signal?.aborted ? Promise.reject(init.signal.reason) : new Promise((res) => gates.push(() => res(json('done'))))));
    const p1 = run(call(ids['ai-m1'])), p2 = run(call(ids['ai-m2']));
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const ac = new AbortController();
    const p3 = run(call(ids['ai-m3'], { signal: ac.signal })); // queued behind the two in flight
    ac.abort();
    gates[0]();
    await expect(p3).rejects.toThrow(/abort/i);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(quota(ids['ai-m3']).used).toBe(0);
    gates[1]();
    await Promise.all([p1, p2]);
  });
});

describe('grounding and citations', () => {
  it('retrieves facts for a question', () => {
    expect(retrieve('right middle lobe collapse lateral view').slice(0, 3).map((f) => f.id)).toContain('F-M-001');
  });

  it('keeps only real ids that were given to the model', () => {
    expect(citeIds('A [F-M-001]. B [F-NOPE-999], C [F-M-002, F-M-001].', ['F-M-001', 'F-NOPE-999'])).toEqual(['F-M-001']);
  });

  it('caches explanations for the class and lets admins regenerate', async () => {
    const f = facts.find((x) => facts.some((y) => y !== x && y.topics.some((s) => x.topics.includes(s))))!;
    const peer = facts.find((y) => y !== f && y.topics.some((s) => f.topics.includes(s)))!;
    fetchMock.mockImplementation(async () => deltas('**Why it matters:** see ', `[${peer.id}] and [F-M-999z].`));
    const a = await run(explainFact(ids['ai-m1'], f.id));
    expect(a.result.cites.map((c) => c.id)).toEqual([peer.id]);
    expect(a.result.cites[0].fact).toBe(peer.fact);
    const prompt = JSON.parse(fetchMock.mock.calls[0][1].body).messages;
    expect(prompt[0].content).toContain('Use ONLY the Lightbox facts provided');
    expect(prompt[1].content).toContain(`[${f.id}]`);
    const b = await run(explainFact(ids['ai-m2'], f.id));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(b).toMatchObject({ text: a.text, result: { cached: true } });
    expect(quota(ids['ai-m2']).used).toBe(0);
    expect(db.prepare("SELECT hits FROM ai_cache WHERE kind = 'explain'").get()).toEqual({ hits: 1 });
    const c = await run(explainFact(ids['ai-admin'], f.id, true));
    expect(c.result.cached).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await expect(run(explainFact(ids['ai-m1'], 'F-NOPE-001'))).rejects.toMatchObject({ status: 404 });
  });
});

describe('tutor chats', () => {
  it('are private to their owner and validated', () => {
    const t = topicBySlug.get('defecography')!;
    const r = createChat(ids['ai-m1'], undefined, t.slug);
    expect(r).toHaveProperty('id');
    const id = (r as { id: number }).id;
    expect(getChat(ids['ai-m1'], id)).toMatchObject({ title: t.title, context: `topic:${t.slug}` });
    expect(getChat(ids['ai-m2'], id)).toBeUndefined();
    expect(chatMessages(ids['ai-m2'], id)).toBeNull();
    expect(renameChat(ids['ai-m2'], id, 'Mine now')).toBe(false);
    expect(deleteChat(ids['ai-m2'], id)).toBe(false);
    expect(renameChat(ids['ai-m1'], id, 'x'.repeat(81))).toBe(false);
    expect(renameChat(ids['ai-m1'], id, 'Defecography revision')).toBe(true);
    expect(createChat(ids['ai-m1'], 'Hi', 'no-such-topic')).toHaveProperty('error');
    expect(getChat(ids['ai-m1'], (createChat(ids['ai-m1'], 'q'.repeat(300), null) as { id: number }).id)!.title).toHaveLength(80);
    expect(deleteChat(ids['ai-m1'], id)).toBe(true);
  });

  it('grounds answers on the topic and retrieved facts, saves both turns and cites only what it was given', async () => {
    const u = ids['ai-m3'];
    const t = topicBySlug.get('defecography')!;
    const tf = topicFacts(t).map((f) => f.id);
    const { id } = createChat(u, undefined, t.slug) as { id: number };
    fetchMock.mockImplementation(async () => deltas(`Rectocele first [${tf[0]}]. `, 'Made up [F-ZZZ-999].'));
    const { text, result } = await run(tutorReply(u, id, { text: '  What is assessed?  ' }));
    expect(text).toContain('Rectocele first');
    expect(result.cites.map((c) => c.id)).toEqual([tf[0]]);
    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers['x-opencode-session']).toBe(`lightbox-u${u}-c${id}`);
    const msgs = JSON.parse(init.body).messages;
    expect(msgs[0].content).toContain('Not covered in Lightbox notes yet');
    expect(msgs[0].content).toContain(t.title);
    expect(msgs.at(-1).content).toContain(`[${tf[0]}]`);
    expect(msgs.at(-1).content).toMatch(/Question: What is assessed\?$/);
    const saved = chatMessages(u, id)!;
    expect(saved.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(saved[1].cites.map((c) => c.id)).toEqual([tf[0]]);

    // Retry replaces the last answer; the history goes along as context.
    fetchMock.mockImplementation(async () => deltas('Second take.'));
    await run(tutorReply(u, id, { retry: true }));
    expect(chatMessages(u, id)!.map((m) => m.content)).toEqual(['What is assessed?', 'Second take.']);
    await run(tutorReply(u, id, { text: 'And then?' }));
    expect(JSON.parse(fetchMock.mock.calls.at(-1)![1].body).messages.slice(1, 3)).toEqual([{ role: 'user', content: 'What is assessed?' }, { role: 'assistant', content: 'Second take.' }]);

    await expect(run(tutorReply(ids['ai-m1'], id, { text: 'hi' }))).rejects.toMatchObject({ status: 404 });
    await expect(run(tutorReply(u, id, { text: 'x'.repeat(2001) }))).rejects.toMatchObject({ status: 400 });
  });

  it('keeps the old answer when a retry cannot run', async () => {
    vi.stubEnv('AI_DAILY_CAP', '1');
    const u = ids['ai-m1'];
    const { id } = createChat(u, 'Retry at the cap', null) as { id: number };
    fetchMock.mockImplementation(async () => deltas('First answer.'));
    await run(tutorReply(u, id, { text: 'What is a rectocele?' }));
    await expect(run(tutorReply(u, id, { retry: true }))).rejects.toMatchObject({ status: 429 });
    expect(chatMessages(u, id)!.map((m) => m.content)).toEqual(['What is a rectocele?', 'First answer.']);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('keeps a stopped answer and frees the slot', async () => {
    const u = ids['ai-m4'];
    const { id } = createChat(u, 'Stop test', null) as { id: number };
    fetchMock.mockImplementation(async () => deltas('Partial ', 'answer', ' never read'));
    const g = tutorReply(u, id, { text: 'Tell me about the trachea' });
    expect((await g.next()).value).toBe('Partial ');
    await g.return(undefined as never);
    expect(chatMessages(u, id)!.at(-1)!.content).toBe('Partial …');
    fetchMock.mockImplementation(async () => deltas('Fine.'));
    await expect(run(tutorReply(u, id, { text: 'Again' }))).resolves.toBeTruthy(); // not "busy"
  });
});

describe('generated MCQs', () => {
  const allowed = new Set(['F-M-001', 'F-M-002']);
  const good = { stem: 'Which sign is classic for right middle lobe collapse?', options: { A: 'Loss of right heart border', B: 'Loss of left heart border', C: 'Air bronchogram', D: 'Deep sulcus' }, key: 'A', explanation: 'It silhouettes the right atrium [F-M-001].', fact_ids: ['F-M-001', 'F-X-999'] };

  it('validates and repairs single questions', () => {
    expect(validateMcq(good, allowed)).toEqual({ ...good, fact_ids: ['F-M-001'] });
    const repaired = validateMcq({ question: good.stem, options: ['A) Loss of right heart border', 'B. Air bronchogram', 'Deep sulcus', 'Hilar elevation', 'Pleural effusion'], answer: 'air bronchogram', rationale: 'See [F-M-002].' }, allowed);
    expect(repaired).toMatchObject({ options: { A: 'Loss of right heart border', B: 'Air bronchogram', E: 'Pleural effusion' }, key: 'B', fact_ids: ['F-M-002'] });
    expect(validateMcq({ ...good, options: { b: 'one', c: 'two', d: 'three', e: 'four' }, key: 'c' }, allowed)).toMatchObject({ key: 'B', options: { A: 'one' } });
    for (const bad of [
      { ...good, key: 'E' }, { ...good, options: { A: 'a', B: 'b', C: 'c' } }, { ...good, options: { A: 'Same', B: 'same', C: 'c', D: 'd' } },
      { ...good, fact_ids: ['F-X-999'], explanation: 'No ids.' }, { ...good, explanation: '' }, { ...good, stem: 'Too short' },
      { ...good, options: { ...good.options, D: 'All of the above' } }, 'not an object', null,
    ]) expect(validateMcq(bad, allowed)).toBeNull();
  });

  it('parses JSON with fences or prose around it', () => {
    expect(parseMcqs('```json\n{"mcqs":[' + JSON.stringify(good) + ',{"stem":"bad"}]}\n```', allowed)).toMatchObject({ rejected: 1, items: [{ key: 'A' }] });
    expect(parseMcqs('Here you go: [' + JSON.stringify(good) + ']', allowed).items).toHaveLength(1);
    expect(parseMcqs('Sorry, I cannot.', allowed)).toEqual({ items: [], rejected: 0 });
  });

  it('writes pending rows from verified facts only and tells the admins', async () => {
    const t = topicBySlug.get('defecography')!;
    const verified = topicFacts(t).filter((f) => f.status === 'verified').map((f) => f.id);
    const other = topicFacts(t).filter((f) => f.status !== 'verified').map((f) => f.id);
    const q = { ...good, explanation: `Because [${verified[0]}].`, fact_ids: [verified[0]] };
    fetchMock.mockImplementation(async () => deltas(JSON.stringify({ mcqs: [q, { ...q, key: 'Z' }] })));
    const u = ids['ai-m2'];
    const r = await generateMcqs(u, { topicSlug: t.slug, n: 2 });
    expect(r).toMatchObject({ rejected: 1, items: [{ key: 'A', fact_ids: [verified[0]], facts: [{ id: verified[0] }] }] });
    const prompt = JSON.parse(fetchMock.mock.calls[0][1].body).messages[1].content as string;
    for (const id of verified) expect(prompt).toContain(`[${id}]`);
    for (const id of other) expect(prompt).not.toContain(`[${id}]`);
    expect(db.prepare('SELECT status, created_by, topic_slug FROM ai_mcqs WHERE id = ?').get(r.items[0].id)).toEqual({ status: 'pending', created_by: u, topic_slug: t.slug });
    expect(pendingCount(u)).toBe(1);
    expect(db.prepare("SELECT title, href FROM notifications WHERE user_id = ? AND kind = 'ai-mcq'").all(ids['ai-admin'])).toEqual([{ title: '1 AI MCQ await review', href: '/admin?tab=ai' }]);
    expect(approvedMcqs().some((x) => x.id === r.items[0].id)).toBe(false);
    db.prepare("UPDATE ai_mcqs SET status = 'approved' WHERE id = ?").run(r.items[0].id);
    expect(approvedMcqs().find((x) => x.id === r.items[0].id)).toMatchObject({ system: t.system, topic: { slug: t.slug }, facts: [{ id: verified[0] }] });

    for (const n of [0, 6, '3', 2.5]) await expect(generateMcqs(u, { topicSlug: t.slug, n })).rejects.toMatchObject({ status: 400 });
    await expect(generateMcqs(u, { topicSlug: 'nope', n: 1 })).rejects.toMatchObject({ status: 400 });
    await expect(generateMcqs(u, { topicSlug: 'mr-spectroscopy', n: 1 })).rejects.toMatchObject({ status: 400, message: /no verified facts/ });
    fetchMock.mockImplementation(async () => deltas('not json at all'));
    await expect(generateMcqs(u, { factIds: [verified[0]], n: 1 })).rejects.toMatchObject({ status: 502 });
  });
});

describe('dispute summaries', () => {
  it('use only the recorded fields of disputed items', async () => {
    const m = mcqs.find((x) => x.verdict === 'DISPUTED')!;
    const rec = disputeRecord('mcq', m.qid)!;
    for (const s of [m.stem, `Answer key in the paper: ${m.key}`, m.note]) expect(rec).toContain(s);
    expect(disputeRecord('mcq', mcqs.find((x) => x.verdict === 'KEY CORRECT')!.qid)).toBeNull();
    expect(disputeRecord('fact', 'F-M-124p')).toContain('Fact: ');
    expect(disputeRecord('fact', 'F-M-001')).toBeNull();
    expect(disputeRecord('topic', 'defecography')).toBeNull();
    fetchMock.mockImplementation(async () => deltas('**Side 1:** ...'));
    const a = await run(summariseDispute(ids['ai-m1'], 'mcq', m.qid));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).messages[1].content).toBe(`Record:\n${rec}`);
    const b = await run(summariseDispute(ids['ai-m2'], 'mcq', m.qid));
    expect(b).toMatchObject({ text: a.text, result: { cached: true } });
    await expect(run(summariseDispute(ids['ai-m1'], 'mcq', 'nope'))).rejects.toMatchObject({ status: 404 });
  });
});
