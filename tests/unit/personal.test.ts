import { beforeAll, describe, expect, it } from 'vitest';
import { Rating } from 'ts-fsrs';
import { createUser } from '../../src/server/auth';
import { db } from '../../src/server/db';
import {
  addHighlight, copyCollection, createCollection, createUserCard, deleteCollection, deleteHighlight, deleteUserCard, getCollection, getNote, history, item, itemInfo,
  libraryCounts, listCollections, listHighlights, listMarks, listNotes, listUserCards, reorderCollection, saveNote, setCollectionItem, setMark, sharedCollections,
  updateCollection, updateHighlight, updateUserCard, validPath,
} from '../../src/server/personal';
import { noteVisit, recordAttempt, srsQueue, srsReview } from '../../src/server/progress';
import { cards, facts, images, mcqs, topics } from '../../src/lib/data';

let me = 0, other = 0;
const idOf = (u: string) => (db.prepare('SELECT id FROM users WHERE username = ?').get(u) as { id: number }).id;
beforeAll(async () => {
  await createUser(null, 'p-owner', 'Pat Owner', 'member', 'owner-pass-123');
  await createUser(null, 'p-other', 'Oli Other', 'member', 'other-pass-123');
  me = idOf('p-owner'); other = idOf('p-other');
});

describe('item references', () => {
  it('accepts real items only and keeps user cards private', () => {
    expect(item(me, 'fact', facts[0].id)).toEqual({ type: 'fact', id: facts[0].id });
    expect(item(me, 'topic', topics[0].slug)).not.toBeNull();
    expect(item(me, 'mcq', mcqs[0].qid)).not.toBeNull();
    expect(item(me, 'image', images[0].file)).not.toBeNull();
    expect(item(me, 'fact', 'F-NOPE-999')).toBeNull();
    expect(item(me, 'user', '1')).toBeNull();
    expect(item(me, 'fact', 42)).toBeNull();
    const c = createUserCard(me, { front: 'Q', back: 'A' })!;
    expect(item(me, 'card', `U${c}`)).not.toBeNull();
    expect(item(other, 'card', `U${c}`)).toBeNull();
    expect(item(me, 'card', `U${c}`, false)).toBeNull();
    expect(itemInfo(me, 'fact', facts[0].id)).toMatchObject({ title: facts[0].fact, href: `/facts/${facts[0].id}` });
  });

  it('only stores same-origin paths', () => {
    expect(validPath('/study/chest/tracheal-diverticulum')).toBeTruthy();
    expect(validPath('/sources/(FINAL)%20IMM')).toBeTruthy();
    for (const bad of ['//evil.com/x', 'https://evil.com', '/a?b=1', '/a#b', '/a b', '/a"b', 'study']) expect(validPath(bad)).toBeNull();
  });
});

describe('marks', () => {
  it('toggles per user and kind', () => {
    const it = item(me, 'fact', facts[1].id)!;
    expect(setMark(me, it, 'bookmark', true)).toBe(true);
    expect(setMark(me, it, 'bookmark', true)).toBe(true); // idempotent
    expect(setMark(me, it, 'weak', true)).toBe(true);
    expect(setMark(me, it, 'loved', true)).toBe(false);
    expect(listMarks(me).filter((m) => m.id === it.id).map((m) => m.kind).sort()).toEqual(['bookmark', 'weak']);
    expect(listMarks(other)).toEqual([]);
    setMark(me, it, 'weak', false);
    expect(listMarks(me).filter((m) => m.id === it.id).map((m) => m.kind)).toEqual(['bookmark']);
  });
});

describe('collections', () => {
  it('creates, fills, orders, shares, copies and deletes, scoped to the owner', () => {
    expect(createCollection(me, '   ')).toHaveProperty('error');
    expect(createCollection(me, 'x'.repeat(81))).toHaveProperty('error');
    const made = createCollection(me, ' Neuro high-yield ', 'Before the viva');
    if ('error' in made) throw new Error(made.error);
    const cid = made.id;
    const a = item(me, 'fact', facts[2].id)!, b = item(me, 'topic', topics[1].slug)!;
    expect(setCollectionItem(me, cid, a, true)).toBe(true);
    expect(setCollectionItem(me, cid, b, true)).toBe(true);
    expect(setCollectionItem(other, cid, a, false)).toBe(false); // not theirs
    expect(listCollections(me, a)[0]).toMatchObject({ name: 'Neuro high-yield', count: 2, has: 1 });
    expect(listCollections(me, item(me, 'fact', facts[3].id))[0].has).toBe(0);
    expect(reorderCollection(me, cid, [{ type: 'topic', id: b.id }, { type: 'fact', id: a.id }])).toBe(true);
    expect(getCollection(me, cid)!.items.map((i) => i.id)).toEqual([b.id, a.id]);

    expect(getCollection(other, cid)).toBeNull(); // private
    expect(updateCollection(other, cid, { shared: true })).toBe('missing');
    expect(updateCollection(me, cid, { shared: 'yes' })).toBe('invalid');
    expect(updateCollection(me, cid, { shared: true, name: 'Neuro HY' })).toBe('ok');
    expect(getCollection(other, cid)).toMatchObject({ name: 'Neuro HY', owner: false, ownerName: 'Pat Owner' });
    expect(sharedCollections().some((c) => c.id === cid)).toBe(true);

    const copy = copyCollection(other, cid)!;
    expect(getCollection(other, copy)).toMatchObject({ owner: true, shared: 0 });
    expect(getCollection(other, copy)!.items.map((i) => i.id)).toEqual([b.id, a.id]);

    expect(deleteCollection(other, cid)).toBe(false);
    expect(deleteCollection(me, cid)).toBe(true);
    expect(getCollection(me, cid)).toBeNull();
  });
});

describe('notes', () => {
  it('saves one note per item, deletes on empty, rejects oversize', () => {
    const it = item(me, 'topic', topics[2].slug)!;
    expect(saveNote(me, it, 'Mnemonic: ABC')).toBeTypeOf('number');
    expect(saveNote(me, it, 'Mnemonic: ABCD')).toBeTypeOf('number');
    expect(getNote(me, it)?.body).toBe('Mnemonic: ABCD');
    expect(getNote(other, it)).toBeUndefined();
    expect(saveNote(me, it, 'x'.repeat(5001))).toBeNull();
    expect(saveNote(me, it, 42)).toBeNull();
    expect(listNotes(me)).toHaveLength(1);
    saveNote(me, it, '   ');
    expect(getNote(me, it)).toBeUndefined();
  });
});

describe('highlights', () => {
  it('validates, lists by page and only lets the owner edit', () => {
    const base = { path: '/study/chest/x', quote: 'tram-track calcification', prefix: 'shows ', suffix: ' in', color: 'cyan', factId: facts[0].id };
    expect(addHighlight(me, { ...base, color: 'red' })).toBeNull();
    expect(addHighlight(me, { ...base, path: 'https://evil.com' })).toBeNull();
    expect(addHighlight(me, { ...base, quote: ' ' })).toBeNull();
    const id = addHighlight(me, { ...base, factId: 'not-a-fact' })!;
    expect(listHighlights(me, base.path)).toMatchObject([{ id, quote: base.quote, color: 'cyan', factId: null }]);
    expect(listHighlights(other, base.path)).toEqual([]);
    expect(updateHighlight(other, id, { color: 'green' })).toBe(false);
    expect(updateHighlight(me, id, { color: 'green', note: 'check the paper' })).toBe(true);
    expect(updateHighlight(me, id, { note: 'n'.repeat(1001) })).toBe(false);
    expect(listHighlights(me, base.path)[0]).toMatchObject({ color: 'green', note: 'check the paper' });
    expect(deleteHighlight(other, id)).toBe(false);
    expect(deleteHighlight(me, id)).toBe(true);
  });
});

describe('user cards in the FSRS queue', () => {
  it('come first as new cards, carry their text, and schedule like fact cards', () => {
    const before = srsQueue(me);
    const id = createUserCard(me, { front: 'Front text', back: 'Back text', factId: facts[0].id, path: '/study/chest/x' })!;
    expect(createUserCard(me, { front: '', back: 'b' })).toBeNull();
    const q = srsQueue(me);
    const ids = listUserCards(me).map((c) => `U${c.id}`);
    expect(q.fresh.slice(0, ids.length).sort()).toEqual([...ids].sort());
    expect(q.custom[`U${id}`]).toEqual({ front: 'Front text', back: 'Back text', factId: facts[0].id, path: '/study/chest/x' });
    expect(q.remainingNew).toBe(before.remainingNew + 1);
    expect(q.fresh.length).toBeLessThanOrEqual(20);

    expect(srsReview(other, `U${id}`, Rating.Good, Date.now(), '')).toBe(false); // not their card
    expect(srsReview(me, `U${id}`, Rating.Again, Date.now(), 'u-1')).toBe(true);
    expect(srsQueue(me).fresh).not.toContain(`U${id}`);
    expect(listUserCards(me).find((c) => c.id === id)?.due).toBeTypeOf('number');

    expect(updateUserCard(other, id, { front: 'a', back: 'b' })).toBe('missing');
    expect(updateUserCard(me, id, { front: 'New front', back: 'New back' })).toBe('ok');
    db.prepare('UPDATE srs_cards SET due = 0 WHERE user_id = ? AND fact_id = ?').run(me, `U${id}`);
    const due = srsQueue(me);
    expect(due.due.map((d) => d.factId)).toContain(`U${id}`);
    expect(due.custom[`U${id}`].front).toBe('New front');

    expect(deleteUserCard(other, id)).toBe(false);
    expect(deleteUserCard(me, id)).toBe(true);
    expect(srsQueue(me).due.map((d) => d.factId)).not.toContain(`U${id}`);
    expect(srsReview(me, `U${id}`, Rating.Good, Date.now(), '')).toBe(false);
  });

  it('still schedules deck cards', () => {
    expect(srsReview(me, cards[5].factId, Rating.Good, Date.now(), 'deck-1')).toBe(true);
    expect(srsReview(me, 'U999999', Rating.Good, Date.now(), '')).toBe(false);
  });
});

describe('library', () => {
  it('counts and merges history by day', () => {
    noteVisit(me, 'topic', '/study/chest/x', 'Chest X');
    recordAttempt(me, mcqs.find((m) => m.key)!.qid, mcqs.find((m) => m.key)!.key);
    const h = history(me);
    expect(h[0].events.map((e) => e.kind)).toEqual(expect.arrayContaining(['visit', 'mcq', 'review']));
    expect(h[0].events.every((e, i, a) => i === 0 || a[i - 1].at >= e.at)).toBe(true);
    expect(libraryCounts(me)).toMatchObject({ bookmarks: 1, weak: 0 });
    expect(history(other)).toEqual([]);
  });
});
