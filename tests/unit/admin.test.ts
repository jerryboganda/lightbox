import { beforeAll, describe, expect, it } from 'vitest';
import { createUser, readSession, createSession } from '../../src/server/auth';
import { db, now } from '../../src/server/db';
import { dayKey } from '../../src/server/analytics';
import {
  addUser, aiUsage, announce, auditPage, bulkAdd, checkMcq, context, createPoll, csvCell, deleteComment, deletePoll, editAiMcq, hideAnnouncement, hideComment,
  listAiMcqs, listComments, listPolls, listReports, listUsers, navCounts, overview, parseBulk, reportCounts, reportsExport, resolveReport, reviewAiMcq, safePath,
  setPollClosed, unhideComment, userAction, usersCsv,
} from '../../src/server/admin';
import { facts, mcqs } from '../../src/lib/data';

const id = (u: string) => (db.prepare('SELECT id FROM users WHERE username = ?').get(u) as { id: number }).id;
const me = () => ({ id: id('boss'), username: 'boss', displayName: 'Boss', role: 'admin' as const, mustChange: false, sessionId: 'x', expiresAt: 0 });
const notes = (uid: number) => db.prepare('SELECT kind, title, body, href FROM notifications WHERE user_id = ? ORDER BY id').all(uid) as { kind: string; title: string; body: string; href: string | null }[];
const audits = (action: string) => db.prepare('SELECT target FROM audit_log WHERE action = ? ORDER BY id').all(action) as { target: string }[];
const comment = (uid: number, body: string, parent: number | null = null, type = 'fact', item = facts[0].id) =>
  Number(db.prepare('INSERT INTO comments (user_id, item_type, item_id, parent_id, body, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(uid, type, item, parent, body, now()).lastInsertRowid);

beforeAll(async () => {
  await createUser(null, 'boss', 'Boss', 'admin', 'boss-password-1');
  await createUser(null, 'amna', 'Dr Amna', 'member', 'amna-password-1');
});

describe('accounts', () => {
  it('creates one account with a temporary password and rejects bad or taken usernames', async () => {
    const r = await addUser(me().id, { username: '  Sana.R ', displayName: 'Dr  Sana\tRauf', role: 'member' });
    expect(r).toMatchObject({ user: { username: 'sana.r', name: 'Dr Sana Rauf', role: 'member', mustChange: 1 }, password: expect.stringMatching(/^\w{4}-\w{4}-\w{4}$/) });
    expect(await addUser(me().id, { username: 'SANA.R' })).toMatchObject({ error: '@sana.r already exists.' });
    expect(await addUser(me().id, { username: 'x' })).toHaveProperty('error');
    expect(await addUser(me().id, { username: 'ok-name', displayName: 'n'.repeat(61) })).toMatchObject({ error: /60 characters/ });
  });

  it('audits an admin grant on create, and a double submit errors instead of throwing', async () => {
    expect(await addUser(me().id, { username: 'new.admin', role: 'admin' })).toMatchObject({ user: { role: 'admin' } });
    expect(audits('user.role').at(-1)?.target).toBe('new.admin:admin');
    db.prepare("UPDATE users SET role = 'member' WHERE username = 'new.admin'").run(); // boss stays the only admin below
    const [a, b] = await Promise.all([addUser(me().id, { username: 'twice' }), addUser(me().id, { username: 'twice' })]);
    expect(a).toHaveProperty('password');
    expect(b).toMatchObject({ error: '@twice already exists.' });
  });

  it('bulk-creates only when every line passes, and audits each account', async () => {
    const bad = await bulkAdd(me().id, 'bilal.k, Dr Bilal Khan\nbad name, Oops\nbilal.k, Again\namna, Taken\n\n# a comment');
    expect(bad).toMatchObject({ error: /3 lines need fixing/ });
    expect((bad as any).lines.map((l: any) => l.line)).toEqual([2, 3, 4]);
    expect(db.prepare('SELECT 1 FROM users WHERE username = ?').get('bilal.k')).toBeUndefined();
    const before = audits('user.create').length;
    const ok = await bulkAdd(me().id, 'bilal.k, Dr Bilal Khan\r\nhina\tDr Hina\nzain.m');
    expect(ok).toMatchObject({ created: [{ username: 'bilal.k', name: 'Dr Bilal Khan' }, { username: 'hina', name: 'Dr Hina' }, { username: 'zain.m', name: 'zain.m' }] });
    expect((ok as any).created.every((c: any) => /^\w{4}-\w{4}-\w{4}$/.test(c.password))).toBe(true);
    expect((ok as any).users).toHaveLength(3);
    expect(audits('user.create').length - before).toBe(3);
    expect(parseBulk('a'.repeat(5))).toHaveProperty('rows');
    expect(parseBulk(Array.from({ length: 51 }, (_, i) => `user${i}`).join('\n'))).toMatchObject({ error: /Up to 50/ });
    expect(parseBulk('   \n#x')).toHaveProperty('error');
  });

  it('resets, toggles and changes roles with the guard rails', async () => {
    const amna = id('amna');
    const { token } = createSession(amna);
    const r = await userAction(me(), amna, 'reset');
    expect(r).toMatchObject({ username: 'amna', password: expect.any(String) });
    expect(readSession(token)).toBeNull();
    expect(await userAction(me(), me().id, 'toggle')).toMatchObject({ error: /your own/ });
    const mine = createSession(me().id);
    expect(await userAction(me(), me().id, 'reset')).toMatchObject({ error: /account page/ });
    expect(readSession(mine.token)).not.toBeNull();
    expect(await userAction(me(), amna, 'toggle')).toMatchObject({ user: { disabled: 1 } });
    expect(await userAction(me(), amna, 'toggle')).toMatchObject({ user: { disabled: 0 } });
    expect(await userAction(me(), me().id, 'role')).toMatchObject({ error: 'Keep at least one admin.' });
    expect(await userAction(me(), amna, 'role')).toMatchObject({ user: { role: 'admin' } });
    expect(await userAction(me(), amna, 'role')).toMatchObject({ user: { role: 'member' } });
    expect(await userAction(me(), 99999, 'reset')).toMatchObject({ status: 404 });
    expect(await userAction(me(), amna, 'nuke')).toHaveProperty('error');
    expect(audits('user.disable').at(-1)?.target).toBe('amna');
  });

  it('summarises activity per person without N+1 queries', () => {
    const amna = id('amna');
    db.prepare("INSERT INTO srs_log (user_id, fact_id, rating, reviewed_at) VALUES (?, 'F1', 3, ?), (?, 'F2', 3, ?)").run(amna, now(), amna, now());
    db.prepare("INSERT INTO ai_usage (user_id, day, n, tokens) VALUES (?, ?, 4, 900)").run(amna, dayKey(now()));
    const row = listUsers().find((u) => u.username === 'amna')!;
    expect(row).toMatchObject({ reviews: 2, aiToday: 4 });
    expect(usersCsv()).not.toMatch(/argon|password/i);
  });
});

describe('csv', () => {
  it('quotes and defuses formula cells', () => {
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('@cmd')).toBe("'@cmd");
    expect(csvCell(null)).toBe('');
    expect(usersCsv().split('\r\n')[0]).toBe('﻿username,display_name,role,disabled,created,last_seen');
  });
});

describe('announcements', () => {
  it('posts, optionally notifies everyone except the author, and takes down', () => {
    expect(announce(me().id, '  ', false)).toHaveProperty('error');
    const a = announce(me().id, 'Mock TOACS on Sunday', true) as { id: number };
    expect(notes(id('amna')).at(-1)).toMatchObject({ kind: 'announcement', body: 'Mock TOACS on Sunday', href: '/' });
    expect(notes(me().id).some((n) => n.kind === 'announcement')).toBe(false);
    expect(navCounts().announcements).toBe(1);
    expect(hideAnnouncement(me().id, a.id)).toEqual({ ok: true });
    expect(hideAnnouncement(me().id, a.id)).toMatchObject({ status: 404 });
  });
});

describe('reports', () => {
  it('lists with context, resolves, keeps the earlier note and notifies the reporter', () => {
    const amna = id('amna'), f = facts[0];
    const rid = Number(db.prepare("INSERT INTO reports (user_id, item_type, item_id, kind, body, quote, path, created_at) VALUES (?, 'fact', ?, 'wrong', 'Wrong value', 'quoted', ?, ?)")
      .run(amna, f.id, `/facts/${f.id}`, now()).lastInsertRowid);
    db.prepare("INSERT INTO reports (user_id, item_type, item_id, kind, path, created_at) VALUES (?, 'mcq', ?, 'typo', 'javascript:alert(1)', ?)").run(amna, mcqs[0].qid, now());
    const open = listReports({ status: 'open' });
    expect(open).toHaveLength(2);
    expect(open.find((r) => r.id === rid)!.ctx).toMatchObject({ type: 'fact', title: f.fact, href: `/facts/${f.id}`, label: f.label });
    expect(open.find((r) => r.type === 'mcq')!.path).toBeNull();
    expect(listReports({ status: 'open', kind: 'typo' })).toHaveLength(1);
    expect(listReports({ status: 'bogus', type: 'fact' })).toHaveLength(1);

    expect(resolveReport(me().id, rid, 'deleted', '')).toHaveProperty('error');
    expect(resolveReport(me().id, rid, 'accepted', 'Will fix in the next export')).toMatchObject({ status: 'accepted' });
    expect(notes(amna).at(-1)).toEqual({ kind: 'report', title: 'Your report was accepted', body: 'Will fix in the next export', href: `/facts/${f.id}` });
    expect(resolveReport(me().id, rid, 'accepted', '')).toMatchObject({ error: /already accepted/ });
    expect(resolveReport(me().id, rid, 'fixed', '')).toMatchObject({ status: 'fixed', resolution: 'Will fix in the next export' });
    expect(audits('report.fix').at(-1)?.target).toBe(`#${rid} fact ${f.id}`);
    expect(reportCounts()).toMatchObject({ open: 1, fixed: 1, all: 2 });
    expect(resolveReport(me().id, 4242, 'fixed', '')).toMatchObject({ status: 404 });
  });

  it('exports every report with an item snapshot for the pipeline', () => {
    const x = reportsExport();
    const fact = x.reports.find((r) => r.item.type === 'fact')!;
    expect(fact.item).toMatchObject({ id: facts[0].id, statement: facts[0].fact, status: facts[0].status, basis: facts[0].basis, file: facts[0].file, unit: facts[0].unit, sources: facts[0].sources });
    expect(fact.reporter).toEqual({ username: 'amna', displayName: 'Dr Amna' });
    expect(x.reports.find((r) => r.item.type === 'mcq')!.item).toMatchObject({ qid: mcqs[0].qid, stem: mcqs[0].stem, key: mcqs[0].key, verdict: mcqs[0].verdict });
  });

  it('accepts only internal paths', () => {
    expect(safePath('/facts/F1?x=1#y')).toBe('/facts/F1?x=1#y');
    expect(safePath('/')).toBe('/');
    for (const bad of ['//evil.com', '/\\evil.com', 'https://x', 'javascript:alert(1)', '/a b', 5]) expect(safePath(bad)).toBeNull();
  });
});

describe('comments', () => {
  it('hides with a reason, tells the author, unhides, and hard-deletes with replies and votes', () => {
    const amna = id('amna');
    const c = comment(amna, 'Bad take');
    const reply = comment(me().id, 'A reply', c);
    db.prepare("INSERT INTO votes (user_id, item_type, item_id, created_at) VALUES (?, 'comment', ?, ?), (?, 'comment', ?, ?)").run(me().id, String(c), now(), amna, String(reply), now());
    const row = listComments('all').find((x) => x.id === c)!;
    expect(row).toMatchObject({ votes: 1, ctx: { type: 'fact', id: facts[0].id } });

    expect(hideComment(me().id, c, '  ')).toHaveProperty('error');
    expect(hideComment(me().id, c, 'Off-topic')).toEqual({ ok: true });
    expect(notes(amna).at(-1)).toMatchObject({ kind: 'moderation', title: 'Your comment was hidden', body: expect.stringContaining('Off-topic') });
    expect(listComments('hidden').map((x) => x.id)).toContain(c);
    expect(listComments('visible').map((x) => x.id)).not.toContain(c);
    expect(hideComment(me().id, c, 'Again')).toHaveProperty('error');
    expect(unhideComment(me().id, c)).toEqual({ ok: true });
    expect(db.prepare('SELECT hidden, hidden_by, hidden_reason FROM comments WHERE id = ?').get(c)).toEqual({ hidden: 0, hidden_by: null, hidden_reason: '' });

    // a report against the comment shows its body and author
    db.prepare("INSERT INTO reports (user_id, item_type, item_id, kind, created_at) VALUES (?, 'comment', ?, 'offensive', ?)").run(me().id, String(c), now());
    expect(listReports({ type: 'comment' })[0].ctx).toMatchObject({ title: 'Bad take', author: 'Dr Amna (@amna)' });

    expect(deleteComment(me().id, c)).toEqual({ ok: true, removed: 2 });
    expect(db.prepare('SELECT COUNT(*) n FROM comments WHERE id IN (?, ?)').get(c, reply)).toEqual({ n: 0 });
    expect(db.prepare("SELECT COUNT(*) n FROM votes WHERE item_type = 'comment' AND item_id IN (?, ?)").get(String(c), String(reply))).toEqual({ n: 0 });
    expect(listReports({ type: 'comment' })[0].ctx).toMatchObject({ missing: true });
    expect(deleteComment(me().id, c)).toMatchObject({ status: 404 });
  });

  it('describes disputed items and unknown ones', () => {
    expect(context('dispute', mcqs[0].qid)).toMatchObject({ href: '/review#mcqs', sub: expect.stringMatching(/^Disputed/) });
    expect(context('fact', 'nope')).toMatchObject({ missing: true, href: null });
  });
});

describe('polls', () => {
  it('validates, tallies, closes, reopens past deadlines and deletes', () => {
    const b = { question: 'Mock date?', options: ['Sat', 'Sun'] };
    expect(createPoll(me().id, { ...b, options: ['Only'] })).toHaveProperty('error');
    expect(createPoll(me().id, { ...b, options: ['A', 'a'] })).toMatchObject({ error: /different/ });
    expect(createPoll(me().id, { ...b, options: Array(7).fill('x').map((x, i) => x + i) })).toHaveProperty('error');
    expect(createPoll(me().id, { ...b, question: 'q'.repeat(201) })).toHaveProperty('error');
    expect(createPoll(me().id, { ...b, closesAt: now() - 1 })).toHaveProperty('error');
    const p = (createPoll(me().id, { ...b, announce: true, closesAt: now() + 86_400_000 }) as any).poll;
    expect(p.options).toEqual([{ key: 'A', label: 'Sat', n: 0 }, { key: 'B', label: 'Sun', n: 0 }]);
    expect(notes(id('amna')).at(-1)).toMatchObject({ kind: 'poll', href: `/class#poll-${p.id}` });
    db.prepare("INSERT INTO poll_votes (poll_id, user_id, choice, created_at) VALUES (?, ?, 'B', ?), (?, ?, 'B', ?)").run(p.id, id('amna'), now(), p.id, me().id, now());
    expect(listPolls(p.id)[0]).toMatchObject({ voters: 2, closed: false, options: [{ n: 0 }, { n: 2 }] });

    db.prepare('UPDATE polls SET closes_at = ? WHERE id = ?').run(now() - 1000, p.id);
    expect(listPolls(p.id)[0].closed).toBe(true);
    expect(setPollClosed(me().id, p.id, false)).toMatchObject({ poll: { closed: false, closesAt: null } });
    expect(setPollClosed(me().id, p.id, 'yes')).toHaveProperty('error');
    expect(setPollClosed(me().id, p.id, true)).toMatchObject({ poll: { closed: true, manual: true } });
    expect(navCounts().polls).toBe(0);
    expect(deletePoll(me().id, p.id)).toEqual({ ok: true });
    expect(db.prepare('SELECT COUNT(*) n FROM poll_votes WHERE poll_id = ?').get(p.id)).toEqual({ n: 0 });
    expect(audits('poll.delete')).toHaveLength(1);
  });

  it('shows the key of MCQ polls', () => {
    const m = mcqs.find((x) => x.key)!;
    db.prepare("INSERT INTO polls (item_type, item_id, question, options, created_at) VALUES ('mcq', ?, 'Which is right?', ?, ?)").run(m.qid, JSON.stringify(m.options), now());
    expect(listPolls().find((p) => p.type === 'mcq')!.mcq).toMatchObject({ qid: m.qid, key: m.key });
  });
});

describe('AI questions', () => {
  const add = (fids: string[] = [facts[0].id, 'missing-id']) => Number(db.prepare(`INSERT INTO ai_mcqs (created_by, topic_slug, fact_ids, stem, options, key, explanation, created_at)
    VALUES (?, NULL, ?, 'Which sign is classic for this?', ?, 'A', 'Because.', ?)`).run(id('amna'), JSON.stringify(fids), JSON.stringify({ A: 'One', B: 'Two', C: 'Three' }), now()).lastInsertRowid);

  it('validates edits', () => {
    const ok = { stem: 'A long enough stem?', options: ['x', 'y'], key: 'B', explanation: '' };
    expect(checkMcq(ok)).toMatchObject({ options: { A: 'x', B: 'y' }, key: 'B' });
    expect(checkMcq({ ...ok, key: 'C' })).toMatchObject({ error: /key/ });
    expect(checkMcq({ ...ok, options: ['x'] })).toHaveProperty('error');
    expect(checkMcq({ ...ok, options: ['x', ' '] })).toHaveProperty('error');
    expect(checkMcq({ ...ok, stem: 'short' })).toHaveProperty('error');
  });

  it('edits, approves with edits, rejects with a reason and notifies the creator', () => {
    const a = add(), b = add([]);
    const pending = listAiMcqs('pending');
    expect(pending.find((m) => m.id === a)!.facts).toEqual([
      expect.objectContaining({ id: facts[0].id, text: facts[0].fact, label: facts[0].label }),
      expect.objectContaining({ id: 'missing-id', missing: true }),
    ]);
    expect(editAiMcq(me().id, a, { stem: 'Edited stem, long enough', options: ['One', 'Two'], key: 'B', explanation: 'x' })).toEqual({ ok: true });
    expect(reviewAiMcq(me().id, a, { decision: 'approve', edits: { stem: 'Final stem, long enough', options: ['One', 'Two', 'Four'], key: 'C' } })).toMatchObject({ status: 'approved' });
    expect(db.prepare('SELECT stem, options, key, status, reviewed_by FROM ai_mcqs WHERE id = ?').get(a)).toEqual({ stem: 'Final stem, long enough', options: JSON.stringify({ A: 'One', B: 'Two', C: 'Four' }), key: 'C', status: 'approved', reviewed_by: me().id });
    expect(notes(id('amna')).at(-1)).toMatchObject({ kind: 'ai', title: 'Your AI question was approved' });
    expect(reviewAiMcq(me().id, a, { decision: 'reject', reason: 'x' })).toMatchObject({ error: /already approved/ });
    expect(editAiMcq(me().id, a, { stem: 'Edited stem, long enough', options: ['One', 'Two'], key: 'B' })).toHaveProperty('error');

    expect(reviewAiMcq(me().id, b, { decision: 'reject' })).toMatchObject({ error: /reason/ });
    expect(reviewAiMcq(me().id, b, { decision: 'reject', reason: 'Not supported by the cited facts' })).toMatchObject({ status: 'rejected' });
    expect(notes(id('amna')).at(-1)).toMatchObject({ title: 'Your AI question was not approved', body: 'Not supported by the cited facts' });
    expect(listAiMcqs('rejected').map((m) => m.id)).toEqual([b]);
    expect(audits('aimcq.reject').at(-1)?.target).toBe(`#${b}: Not supported by the cited facts`);
  });
});

describe('overview, usage and audit', () => {
  it('counts the class and fills 14 days', () => {
    const o = overview();
    expect(o.days).toHaveLength(14);
    expect(o.days.at(-1)!.day).toBe(dayKey(now()));
    expect(o.days.at(-1)!.reviews).toBeGreaterThanOrEqual(2);
    expect(o.kpi.members).toBeGreaterThanOrEqual(5);
    expect(o.kpi.aiToday).toBe(4);
  });

  it('adds AI usage per person and per day', () => {
    const u = aiUsage();
    expect(u.total).toBe(4);
    expect(u.users[0]).toMatchObject({ username: 'amna', total: 4, totalTokens: 900 });
    expect(u.users[0].n.at(-1)).toBe(4);
    expect(u.days.at(-1)).toMatchObject({ n: 4, tokens: 900 });
  });

  it('filters, searches safely and paginates the audit log', () => {
    for (let i = 0; i < 60; i++) db.prepare('INSERT INTO audit_log (actor_id, action, target, at) VALUES (?, ?, ?, ?)').run(me().id, 'poll.close', `#${i} 100%_done`, now());
    const all = auditPage({ action: 'poll' });
    expect(all.total).toBeGreaterThanOrEqual(61);
    expect(all.rows).toHaveLength(50);
    expect(all.rows[0]).toMatchObject({ area: 'poll', label: 'closed poll' });
    expect(auditPage({ action: 'poll', page: '2' }).rows.length).toBeGreaterThan(0);
    expect(auditPage({ action: 'poll', page: '999' }).page).toBe(auditPage({ action: 'poll' }).pages);
    expect(auditPage({ q: '100%_' }).total).toBe(60);
    expect(auditPage({ q: '%' }).total).toBe(60);
    expect(auditPage({ actor: String(id('amna')) }).rows.every((r) => r.username === 'amna')).toBe(true);
    expect(auditPage({ action: "x' OR 1=1 --" }).prefix).toBeNull();
    const reset = auditPage({ action: 'user' }).rows.find((r) => r.action === 'user.reset')!;
    expect(reset.target).toBe('amna');
    expect(auditPage({}).areas).toEqual(expect.arrayContaining(['user', 'report', 'comment', 'poll', 'aimcq', 'announcement']));
  });
});
