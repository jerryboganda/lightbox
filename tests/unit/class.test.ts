import { beforeAll, describe, expect, it } from 'vitest';
import { createUser } from '../../src/server/auth';
import { db } from '../../src/server/db';
import {
  classStats, clearLeaderboard, deleteComment, editComment, feed, fileReport, itemLink, leaderboard, listNotifications, markRead, mcqPoll, openPolls,
  pollById, pollEligible, pollView, postComment, thread, threadItem, unreadCount, voteComment, votePoll, type Actor,
} from '../../src/server/class';
import { recordAttempt, srsReview } from '../../src/server/progress';
import { facts, mcqs, topics } from '../../src/lib/data';

let ann: Actor, bob: Actor, boss: Actor;
const actor = (u: string): Actor => {
  const r = db.prepare('SELECT id, display_name, role FROM users WHERE username = ?').get(u) as { id: number; display_name: string; role: 'admin' | 'member' };
  return { id: r.id, displayName: r.display_name, role: r.role };
};
const fact = facts[0].id;
const disputedMcq = mcqs.find((m) => m.verdict === 'DISPUTED' && Object.keys(m.options).length >= 2)!;
const keyedMcq = mcqs.find((m) => m.key && m.verdict !== 'DISPUTED')!;
const ok = <T,>(r: T | { error: string; status: number }) => { if (r && typeof r === 'object' && 'error' in r) throw new Error(r.error); return r as T; };

beforeAll(async () => {
  await createUser(null, 'c-ann', 'Ann Able', 'member', 'ann-pass-1234');
  await createUser(null, 'c-bob', 'Bob Baker', 'member', 'bob-pass-1234');
  await createUser(null, 'c-boss', 'Boss Admin', 'admin', 'boss-pass-1234');
  ann = actor('c-ann'); bob = actor('c-bob'); boss = actor('c-boss');
});

describe('thread targets', () => {
  it('accepts real items and disputed ids only', () => {
    expect(threadItem('fact', fact)).toEqual({ type: 'fact', id: fact });
    expect(threadItem('topic', topics[0].slug)).not.toBeNull();
    expect(threadItem('mcq', keyedMcq.qid)).not.toBeNull();
    expect(threadItem('dispute', disputedMcq.qid)).not.toBeNull();
    expect(threadItem('dispute', keyedMcq.qid)).toBeNull();
    expect(threadItem('card', 'U1')).toBeNull();
    expect(threadItem('fact', 'F-NOPE')).toBeNull();
    expect(threadItem('comment', '1')).toBeNull();
    expect(itemLink('fact', fact)?.href).toBe(`/facts/${fact}#discussion`);
    expect(itemLink('dispute', disputedMcq.qid)?.href).toBe('/review#mcqs');
    expect(itemLink('mcq', keyedMcq.qid)?.href).toContain('/practice/mcq?q=');
  });
});

describe('comments', () => {
  it('posts, replies one level deep, notifies the parent author and keeps text plain', () => {
    const top = ok(postComment(ann, { type: 'fact', id: fact, body: '  <b>Is this</b> the\r\n\n\n\nadult value?  ' })).comment;
    expect(top.body).toBe('<b>Is this</b> the\n\nadult value?');
    expect(top).toMatchObject({ own: true, votes: 0, parentId: null, author: { name: 'Ann Able', admin: false } });
    const before = unreadCount(ann.id);
    const reply = ok(postComment(bob, { type: 'fact', id: fact, body: 'Yes, per the source.', parentId: top.id })).comment;
    expect(reply.parentId).toBe(top.id);
    expect(unreadCount(ann.id)).toBe(before + 1);
    expect(listNotifications(ann.id, 1)[0]).toMatchObject({ kind: 'reply', title: 'Bob Baker replied to your comment', href: `/facts/${fact}#discussion` });
    // A reply to a reply attaches to the top-level comment.
    const nested = ok(postComment(ann, { type: 'fact', id: fact, body: 'Thanks', parentId: reply.id })).comment;
    expect(nested.parentId).toBe(top.id);
    // Replying to yourself is not a notification.
    const n = unreadCount(ann.id);
    ok(postComment(ann, { type: 'fact', id: fact, body: 'Self reply', parentId: top.id }));
    expect(unreadCount(ann.id)).toBe(n);
  });

  it('rejects bad input', () => {
    expect(postComment(ann, { type: 'fact', id: fact, body: '   ' })).toMatchObject({ status: 400 });
    expect(postComment(ann, { type: 'fact', id: fact, body: 'x'.repeat(2001) })).toMatchObject({ status: 400 });
    expect(postComment(ann, { type: 'fact', id: 'nope', body: 'hi' })).toMatchObject({ status: 400 });
    expect(postComment(ann, { type: 'fact', id: fact, body: 'hi', parentId: 999999 })).toMatchObject({ status: 404 });
    const other = ok(postComment(ann, { type: 'fact', id: facts[1].id, body: 'Elsewhere' })).comment;
    expect(postComment(ann, { type: 'fact', id: fact, body: 'hi', parentId: other.id })).toMatchObject({ status: 404 });
  });

  it('edits and soft-deletes own comments only; deleted parents keep their replies', () => {
    const top = ok(postComment(bob, { type: 'topic', id: topics[0].slug, body: 'Original' })).comment;
    expect(editComment(ann, top.id, 'Hijack')).toMatchObject({ status: 404 });
    const edited = ok(editComment(bob, top.id, 'Edited text')).comment;
    expect(edited.body).toBe('Edited text');
    expect(edited.editedAt).toBeTypeOf('number');
    ok(postComment(ann, { type: 'topic', id: topics[0].slug, body: 'A reply', parentId: top.id }));
    expect(deleteComment(ann, top.id)).toBe(false);
    expect(deleteComment(bob, top.id)).toBe(true);
    expect(deleteComment(bob, top.id)).toBe(false);
    const t = thread(ann, { type: 'topic', id: topics[0].slug });
    const gone = t.comments.find((c) => c.id === top.id)!;
    expect(gone).toMatchObject({ deleted: true, body: '', author: null });
    expect(t.count).toBe(1);
    expect(editComment(bob, top.id, 'Back')).toMatchObject({ status: 404 });
    // A deleted comment without replies disappears from the thread.
    const lone = ok(postComment(bob, { type: 'topic', id: topics[0].slug, body: 'Lonely' })).comment;
    deleteComment(bob, lone.id);
    expect(thread(ann, { type: 'topic', id: topics[0].slug }).comments.some((c) => c.id === lone.id)).toBe(false);
  });

  it('masks hidden comments from members and shows admins the reason', () => {
    const c = ok(postComment(bob, { type: 'topic', id: topics[1].slug, body: 'Rude words' })).comment;
    db.prepare("UPDATE comments SET hidden = 1, hidden_by = ?, hidden_reason = 'Off topic' WHERE id = ?").run(boss.id, c.id);
    const asMember = thread(ann, { type: 'topic', id: topics[1].slug }).comments[0];
    expect(asMember).toMatchObject({ hidden: true, body: '', author: null });
    expect(asMember.hiddenReason).toBeUndefined();
    expect(thread(boss, { type: 'topic', id: topics[1].slug }).comments[0]).toMatchObject({ hidden: true, body: 'Rude words', hiddenReason: 'Off topic' });
    expect(editComment(bob, c.id, 'Nicer')).toMatchObject({ status: 403 });
    expect(voteComment(ann, c.id, true)).toMatchObject({ status: 404 });
  });

  it('rate limits members to 8 comments in 5 minutes, but not admins', () => {
    const slug = topics[2].slug;
    const fresh = db.prepare('SELECT COUNT(*) n FROM comments WHERE user_id = ? AND created_at > ?');
    const left = 8 - (fresh.get(ann.id, Date.now() - 300_000) as { n: number }).n;
    for (let i = 0; i < left; i++) ok(postComment(ann, { type: 'topic', id: slug, body: `Note ${i}` }));
    expect(postComment(ann, { type: 'topic', id: slug, body: 'One too many' })).toMatchObject({ status: 429 });
    for (let i = 0; i < 10; i++) ok(postComment(boss, { type: 'topic', id: slug, body: `Admin ${i}` }));
  });
});

describe('votes', () => {
  it('toggles one upvote per person and never on your own comment', () => {
    const c = ok(postComment(bob, { type: 'mcq', id: keyedMcq.qid, body: 'Key is right' })).comment;
    expect(voteComment(bob, c.id, true)).toMatchObject({ status: 403 });
    expect(ok(voteComment(ann, c.id, true))).toEqual({ votes: 1, mine: true });
    expect(ok(voteComment(ann, c.id, true))).toEqual({ votes: 1, mine: true });
    expect(ok(voteComment(boss, c.id, true))).toEqual({ votes: 2, mine: true });
    expect(thread(ann, { type: 'mcq', id: keyedMcq.qid }).comments.find((x) => x.id === c.id)).toMatchObject({ votes: 2, mine: true });
    expect(ok(voteComment(ann, c.id, false))).toEqual({ votes: 1, mine: false });
    expect(voteComment(ann, 999999, true)).toMatchObject({ status: 404 });
  });
});

describe('reports', () => {
  it('files once per item and kind, validates, and tells the admins', () => {
    const before = unreadCount(boss.id);
    const r = ok(fileReport(ann, { type: 'fact', id: fact, kind: 'typo', body: 'Spelling', quote: 'the quote', path: '/facts/x' }));
    expect(r.id).toBeGreaterThan(0);
    expect(unreadCount(boss.id)).toBe(before + 1);
    expect(listNotifications(boss.id, 1)[0]).toMatchObject({ kind: 'report', title: 'New report: Typo', href: '/admin?tab=moderation' });
    expect(fileReport(ann, { type: 'fact', id: fact, kind: 'typo' })).toMatchObject({ status: 409 });
    ok(fileReport(ann, { type: 'fact', id: fact, kind: 'unclear' }));
    expect(fileReport(ann, { type: 'fact', id: fact, kind: 'offensive' })).toMatchObject({ status: 400 });
    expect(fileReport(ann, { type: 'fact', id: fact, kind: 'nope' })).toMatchObject({ status: 400 });
    expect(fileReport(ann, { type: 'fact', id: 'F-NOPE', kind: 'typo' })).toMatchObject({ status: 400 });
    expect(fileReport(ann, { type: 'user', id: '1', kind: 'typo' })).toMatchObject({ status: 400 });
    expect(fileReport(ann, { type: 'fact', id: fact, kind: 'other', body: 'x'.repeat(1001) })).toMatchObject({ status: 400 });
    const c = ok(postComment(bob, { type: 'fact', id: fact, body: 'Spam' })).comment;
    ok(fileReport(ann, { type: 'comment', id: String(c.id), kind: 'offensive' }));
    expect(fileReport(ann, { type: 'comment', id: '1 OR 1=1', kind: 'offensive' })).toMatchObject({ status: 400 });
    // A report path is stored only when it is a same-origin path.
    const row = db.prepare('SELECT path FROM reports WHERE id = ?').get(r.id) as { path: string };
    expect(row.path).toBe('/facts/x');
  });

  it('rate limits members to 10 reports an hour', () => {
    const n = (db.prepare('SELECT COUNT(*) n FROM reports WHERE user_id = ? AND created_at > ?').get(bob.id, Date.now() - 3_600_000) as { n: number }).n;
    const kinds = ['wrong', 'source', 'typo', 'unclear', 'duplicate', 'other'];
    let k = 0;
    for (let i = n; i < 10; i++, k++) ok(fileReport(bob, { type: 'fact', id: facts[2 + Math.floor(k / 6)].id, kind: kinds[k % 6] }));
    expect(fileReport(bob, { type: 'fact', id: facts[20].id, kind: 'typo' })).toMatchObject({ status: 429 });
  });
});

describe('notifications', () => {
  it('lists newest first and marks read for the owner only', () => {
    const mine = listNotifications(ann.id, 50);
    expect(mine.length).toBeGreaterThan(0);
    expect(listNotifications(ann.id, 50, true).every((x) => x.readAt === null)).toBe(true);
    expect(markRead(bob.id, [mine[0].id])).toBe(0);
    expect(markRead(ann.id, [mine[0].id])).toBe(1);
    expect(markRead(ann.id, 'all')).toBeGreaterThanOrEqual(0);
    expect(unreadCount(ann.id)).toBe(0);
  });
});

describe('polls', () => {
  it('opens on disputed or unkeyed MCQs, hides counts until you vote, and lets you change your vote', () => {
    expect(pollEligible(keyedMcq.qid)).toBe(false);
    expect(mcqPoll(keyedMcq.qid)).toBeNull();
    const p = mcqPoll(disputedMcq.qid)!;
    expect(mcqPoll(disputedMcq.qid)!.id).toBe(p.id); // one poll per MCQ
    const [a, b] = Object.keys(disputedMcq.options);
    let v = pollView(ann.id, p);
    expect(v).toMatchObject({ kind: 'mcq', mine: null, total: 0, open: true, context: disputedMcq.stem });
    expect(v.options.every((o) => o.votes === undefined)).toBe(true);
    v = ok(votePoll(ann.id, p.id, a));
    expect(v.mine).toBe(a);
    expect(v.options.find((o) => o.key === a)!.votes).toBe(1);
    ok(votePoll(bob.id, p.id, a));
    v = ok(votePoll(ann.id, p.id, b));
    expect(v.total).toBe(2);
    expect(v.options.find((o) => o.key === b)!.votes).toBe(1);
    expect(pollView(boss.id, p).options[0].votes).toBeUndefined();
    expect(votePoll(ann.id, p.id, 'Z')).toMatchObject({ status: 400 });
    expect(votePoll(ann.id, 999999, a)).toMatchObject({ status: 404 });
    expect(openPolls().some((x) => x.id === p.id)).toBe(true);
    db.prepare('UPDATE polls SET closed = 1 WHERE id = ?').run(p.id);
    expect(votePoll(ann.id, p.id, a)).toMatchObject({ status: 409 });
    expect(pollView(boss.id, pollById(p.id)!).options[0].votes).toBeTypeOf('number'); // closed: results for everyone
    db.prepare('UPDATE polls SET closed = 0 WHERE id = ?').run(p.id);
  });

  it('serves custom polls by id', () => {
    const id = Number(db.prepare("INSERT INTO polls (item_type, item_id, question, options, created_by, created_at) VALUES ('custom', NULL, 'Viva on Friday?', ?, ?, ?)")
      .run(JSON.stringify({ y: 'Yes', n: 'No' }), boss.id, Date.now()).lastInsertRowid);
    const v = ok(votePoll(bob.id, id, 'y'));
    expect(v).toMatchObject({ kind: 'custom', question: 'Viva on Friday?', mine: 'y', total: 1, context: null });
    expect(openPolls()[0].id).toBe(id);
  });
});

describe('class hub', () => {
  it('ranks everyone active with points from reviews, MCQs, exams, upvotes and streaks', async () => {
    await createUser(null, 'c-gone', 'Gone User', 'member', 'gone-pass-1234');
    db.prepare("UPDATE users SET disabled = 1 WHERE username = 'c-gone'").run();
    srsReview(bob.id, facts.find((f) => f.status !== 'unchecked')!.id, 3, Date.now(), 'c-test-1');
    recordAttempt(bob.id, keyedMcq.qid, keyedMcq.key);
    recordAttempt(bob.id, keyedMcq.qid, keyedMcq.key); // the same question twice scores once
    clearLeaderboard();
    const week = leaderboard('week');
    expect(week.some((r) => r.name === 'Gone User')).toBe(false);
    const b = week.find((r) => r.id === bob.id)!;
    expect(b).toMatchObject({ solved: 1, right: 2, keyed: 2, streak: 1 });
    expect(b.cards).toBeGreaterThanOrEqual(1);
    expect(b.points).toBe(b.cards + 2 * b.solved + b.exam + 3 * b.upvotes + 5 * Math.min(b.streak, 7));
    expect(week[0].rank).toBe(1);
    expect(week.every((r, i) => i === 0 || r.points <= week[i - 1].points)).toBe(true);
    expect(leaderboard('all').length).toBe(week.length);

    const s = classStats();
    expect(s.members).toBeGreaterThanOrEqual(3);
    expect(s.discussions).toBeGreaterThan(0);
    expect(s.openPolls).toBeGreaterThanOrEqual(1);
    const f = feed(5);
    expect(f.length).toBe(5);
    expect(f.every((x) => x.href.startsWith('/') && x.title)).toBe(true);
  });
});
