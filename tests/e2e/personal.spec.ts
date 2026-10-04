import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// Personal layer: marks, highlights, user cards, notes, collections and the library.
// Runs once per project against one database, so every test sets up and cleans up its own state.
const TOPIC = '/study/physics/bremsstrahlung';
const hydrated = (page: Page, name: string) =>
  page.waitForFunction((n) => [...document.querySelectorAll('astro-island')].some((i) => i.getAttribute('component-url')?.includes(n) && !i.hasAttribute('ssr')), name);
const noHorizontalScroll = async (page: Page) =>
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
// Select characters [a, b) of the first text inside `sel` (bullet text in a topic note).
const select = (page: Page, sel: string, a: number, b: number) => page.evaluate(([sel, a, b]) => {
  const el = document.querySelector(sel as string)!;
  const t = document.createTreeWalker(el, NodeFilter.SHOW_TEXT).nextNode() as Text;
  const r = document.createRange();
  r.setStart(t, a as number); r.setEnd(t, Math.min(b as number, t.data.length));
  getSelection()!.removeAllRanges(); getSelection()!.addRange(r);
}, [sel, a, b] as const);
const mark = (page: Page, type: string, id: string, kind: string, on: boolean) => page.request.post('/api/marks', { data: { type, id, kind, on } });
// Bodiless DELETEs need a non-form content type to pass Astro's origin check, as the app's own fetches send.
const del = (page: Page, url: string) => page.request.delete(url, { headers: { 'content-type': 'application/json' } });

test('bookmark a fact from its fact card, then find and remove it in the library', async ({ page }) => {
  await page.goto(TOPIC);
  const chip = page.locator('#main .factchip').first();
  const id = (await chip.textContent())!.trim();
  await mark(page, 'fact', id, 'bookmark', false);
  await page.reload();
  await page.locator('#main .factchip').first().click();
  const toggle = page.locator(`[popover]:popover-open [data-mark="bookmark"][data-id="${id}"]`);
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('status').getByText('Bookmarked')).toBeVisible();

  await page.goto('/library');
  const row = page.getByRole('button', { name: `Bookmark: ${id}` });
  await expect(row).toHaveAttribute('aria-pressed', 'true');
  await noHorizontalScroll(page);
  await row.click();
  await expect(row).toHaveAttribute('aria-pressed', 'false');
  await page.reload();
  await expect(page.getByRole('button', { name: `Bookmark: ${id}` })).toHaveCount(0);
});

test('highlight a selection, see it again after reload, recolour, annotate and delete it', async ({ page }) => {
  await page.goto(TOPIC);
  await hydrated(page, 'Highlighter');
  await select(page, '#main .point p', 0, 24);
  const bar = page.getByRole('toolbar', { name: 'Selection tools' });
  await expect(bar).toBeVisible();
  const [res] = await Promise.all([page.waitForResponse((r) => r.url().includes('/api/highlights') && r.request().method() === 'POST'), bar.getByRole('button', { name: 'Highlight green' }).click()]);
  const { id } = await res.json();
  await expect(bar).toBeHidden();

  await page.reload();
  await hydrated(page, 'Highlighter');
  const hl = page.locator(`mark.lb-hl[data-hl-id="${id}"]`).first();
  await expect(hl).toHaveAttribute('data-color', 'green');
  await hl.click();
  const editor = page.getByRole('dialog', { name: 'Edit highlight' });
  await expect(editor).toBeVisible();
  await editor.getByRole('button', { name: 'Colour violet' }).click();
  await expect(hl).toHaveAttribute('data-color', 'violet');
  await editor.getByLabel('Note on this highlight').fill('Ask about the K-edge in the viva');
  // Closing straight after typing still sends the note.
  await Promise.all([page.waitForResponse((r) => r.url().includes('/api/highlights') && r.request().method() === 'PATCH' && !!r.request().postData()?.includes('K-edge') && r.ok()), page.keyboard.press('Escape')]);
  await expect(editor).toBeHidden();

  await page.reload();
  await hydrated(page, 'Highlighter');
  await expect(page.locator(`mark.lb-hl[data-hl-id="${id}"]`).first()).toHaveAttribute('data-hl-note', '');
  await page.goto('/library?tab=highlights');
  await expect(page.getByText('Ask about the K-edge in the viva')).toBeVisible();
  await page.goto(`${TOPIC}#hl-${id}`);
  await hydrated(page, 'Highlighter');
  await page.locator(`mark.lb-hl[data-hl-id="${id}"]`).first().click();
  await page.getByRole('dialog', { name: 'Edit highlight' }).getByRole('button', { name: 'Delete highlight' }).click();
  await expect(page.locator(`mark.lb-hl[data-hl-id="${id}"]`)).toHaveCount(0);
  await page.reload();
  await hydrated(page, 'Highlighter');
  await expect(page.locator(`mark.lb-hl[data-hl-id="${id}"]`)).toHaveCount(0);
});

test('make a flashcard from a selection; it joins the review queue and my cards', async ({ page }) => {
  await page.goto(TOPIC);
  await hydrated(page, 'Highlighter');
  await select(page, '#main .point p', 0, 30);
  await page.getByRole('toolbar', { name: 'Selection tools' }).getByRole('button', { name: 'Make a flashcard' }).click();
  const dlg = page.getByRole('dialog', { name: 'New flashcard' });
  await expect(dlg).toBeVisible();
  await expect(dlg.getByLabel('Front')).not.toHaveValue('');
  await expect(dlg.getByLabel(/Back/)).not.toHaveValue(''); // prefilled from the fact statement
  await dlg.getByLabel('Front').fill('E2E: what does this bullet say?');
  const [res] = await Promise.all([page.waitForResponse((r) => r.url().endsWith('/api/cards') && r.request().method() === 'POST'), dlg.getByRole('button', { name: 'Save card' }).click()]);
  const { id } = await res.json();
  await expect(dlg).toBeHidden();
  await expect(page.getByRole('status').getByText(/Card added/)).toBeVisible();

  const q = await (await page.request.get('/api/srs/queue')).json();
  expect(q.fresh).toContain(id);
  expect(q.custom[id].front).toBe('E2E: what does this bullet say?');

  await page.goto('/library?tab=cards');
  const card = page.locator(`#card-${id}`);
  await expect(card).toContainText('E2E: what does this bullet say?');
  await card.getByRole('button', { name: 'Edit' }).click();
  const edit = page.getByRole('dialog', { name: 'Edit card' });
  await edit.getByLabel('Front').fill('E2E: edited front');
  await edit.getByRole('button', { name: 'Save card' }).click();
  await expect(card).toContainText('E2E: edited front');
  await card.getByRole('button', { name: 'Delete card' }).click();
  await card.getByRole('button', { name: 'Delete this card?' }).click();
  await expect(card).toHaveCount(0);
});

test('collections: create, collect a bookmark, share with the class, delete', async ({ page }) => {
  const facts = await (await page.request.get('/api/data/facts')).json();
  const fact = facts[3].id as string;
  await mark(page, 'fact', fact, 'bookmark', true);
  const name = `E2E set ${Date.now()}`;

  await page.goto('/library?tab=collections');
  await page.getByLabel('Name').fill(name);
  await page.getByRole('button', { name: 'Create collection' }).click();
  await expect(page).toHaveURL(/\/library\/c\/\d+$/);
  const url = page.url();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(name);

  await page.goto('/library?type=fact');
  await hydrated(page, 'CollectMenu');
  await page.getByRole('button', { name: new RegExp(`^Add ${fact} to a collection`) }).click();
  await page.getByRole('dialog', { name: 'Add to collections' }).getByLabel(name).check();
  await expect(page.getByRole('status').getByText(`Added to ${name}`)).toBeVisible();

  await page.goto(url);
  await expect(page.locator(`[data-item][data-id="${fact}"]`)).toBeVisible();
  const share = page.getByRole('switch', { name: 'Share with class' });
  await expect(share).toHaveAttribute('aria-checked', 'false');
  await share.click();
  await expect(share).toHaveAttribute('aria-checked', 'true');
  await page.goto('/library/shared');
  await expect(page.getByRole('link', { name })).toBeVisible();

  await page.goto(url);
  await page.getByRole('button', { name: 'Delete' }).click();
  await page.getByRole('button', { name: 'Delete this collection?' }).click();
  await expect(page).toHaveURL(/tab=collections/);
  await expect(page.getByText(name)).toHaveCount(0);
  await mark(page, 'fact', fact, 'bookmark', false);
});

test('a private note autosaves from the library', async ({ page }) => {
  const idx = await (await page.request.get('/api/search-index')).json();
  const slug = (idx.find((d: any) => d.type === 'topic').id as string).slice(6);
  await page.request.put('/api/notes', { data: { type: 'topic', id: slug, body: 'First draft' } });
  await page.goto('/library?tab=notes');
  const row = page.locator(`[data-row][data-id="${slug}"]`);
  await row.getByText('Edit note').click();
  await hydrated(page, 'NotePad');
  const text = `Autosaved ${Date.now()}`;
  await row.getByRole('textbox').fill(text);
  await expect(row.getByText('Saved', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.locator(`[data-row][data-id="${slug}"] [data-note-preview]`)).toHaveText(text);
  expect((await del(page, `/api/notes?type=topic&id=${slug}`)).status()).toBe(200);
});

test('a flashcard can be marked weak and appears under weak spots', async ({ page }) => {
  await page.goto('/practice/cards');
  const flag = page.locator('[data-mark="weak"]').first();
  await expect(flag).toBeVisible();
  const [type, id] = [await flag.getAttribute('data-type'), await flag.getAttribute('data-id')];
  await mark(page, type!, id!, 'weak', false);
  await page.reload();
  await expect(flag).toHaveAttribute('aria-pressed', 'false');
  await flag.click();
  await expect(flag).toHaveAttribute('aria-pressed', 'true');
  // The next card's flag shows that card's own state, not the one just set.
  await page.locator('.flip').click();
  await page.getByRole('button', { name: /^Good/ }).click();
  await expect(flag).not.toHaveAttribute('data-id', id!);
  const [nType, nId] = [await flag.getAttribute('data-type'), await flag.getAttribute('data-id')];
  const nextWeak = (await (await page.request.get('/api/marks')).json()).some((m: any) => m.kind === 'weak' && m.type === nType && m.id === nId);
  await expect(flag).toHaveAttribute('aria-pressed', String(nextWeak));
  await page.goto('/library?tab=weak');
  await expect(page.getByRole('button', { name: `Weak spot: ${id}` })).toBeVisible();
  await mark(page, type!, id!, 'weak', false);
});

test('fact explorer filters to bookmarked facts and links to fact pages', async ({ page }) => {
  const facts = await (await page.request.get('/api/data/facts')).json();
  const id = facts[7].id as string;
  await mark(page, 'fact', id, 'bookmark', true);
  await page.goto('/facts?only=bookmarked');
  await expect(page.locator(`#fact-${id}`)).toBeVisible();
  await expect(page.locator(`#fact-${id} a[href="/facts/${id}"]`)).toBeVisible();
  const toggle = page.locator(`#fact-${id} [data-mark="bookmark"]`);
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await toggle.click();
  await expect(page.locator(`#fact-${id}`)).toHaveCount(0);
});

test('atlas images can be bookmarked from the grid', async ({ page }) => {
  await page.goto('/atlas');
  const cell = page.locator('#atlas .cell').first();
  const toggle = cell.locator('[data-mark="bookmark"]');
  const file = (await toggle.getAttribute('data-id'))!;
  await mark(page, 'image', file, 'bookmark', false);
  await page.reload();
  await cell.hover();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  expect((await (await page.request.get('/api/marks')).json()).some((m: any) => m.type === 'image' && m.id === file)).toBe(true);
  await mark(page, 'image', file, 'bookmark', false);
});

test('personal APIs reject bad input', async ({ page }) => {
  const r = page.request;
  expect((await r.post('/api/marks', { data: { type: 'fact', id: 'F-NOPE', kind: 'bookmark', on: true } })).status()).toBe(400);
  expect((await r.post('/api/marks', { data: { type: 'user', id: '1', kind: 'bookmark', on: true } })).status()).toBe(400);
  expect((await r.post('/api/highlights', { data: { path: 'https://evil.example', quote: 'x y', color: 'amber' } })).status()).toBe(400);
  expect((await r.post('/api/highlights', { data: { path: '/study', quote: 'x y', color: 'red' } })).status()).toBe(400);
  expect((await r.patch('/api/collections/999999', { data: { name: 'x' } })).status()).toBe(404);
  expect((await r.post('/api/collections', { data: { name: '' } })).status()).toBe(400);
  expect((await r.put('/api/notes', { data: { type: 'topic', id: 'nope', body: 'x' } })).status()).toBe(400);
  expect((await r.post('/api/cards', { data: { front: 'x'.repeat(1001), back: 'y' } })).status()).toBe(400);
  expect((await del(page, '/api/cards/U999999')).status()).toBe(404);
  expect((await r.delete('/api/cards/U999999')).status()).toBe(403); // cross-site style request without origin
});

// Some saved items so the scans see real rows, not only empty states.
async function seed(page: Page) {
  const facts = await (await page.request.get('/api/data/facts')).json();
  await mark(page, 'fact', facts[0].id, 'bookmark', true);
  await mark(page, 'fact', facts[1].id, 'weak', true);
  await page.request.put('/api/notes', { data: { type: 'fact', id: facts[0].id, body: 'Scan note' } });
  if (!(await (await page.request.get(`/api/highlights?path=${encodeURIComponent(TOPIC)}`)).json()).length)
    await page.request.post('/api/highlights', { data: { path: TOPIC, quote: 'Bremsstrahlung', color: 'cyan', note: 'scan' } });
  if (!(await (await page.request.get('/api/cards')).json()).length) await page.request.post('/api/cards', { data: { front: 'Scan front', back: 'Scan back' } });
  const cols = await (await page.request.get('/api/collections')).json();
  const c = cols.find((x: any) => x.name === 'Scan collection') ?? await (await page.request.post('/api/collections', { data: { name: 'Scan collection', description: 'For accessibility scans' } })).json();
  await page.request.post(`/api/collections/${c.id}/items`, { data: { type: 'fact', id: facts[0].id, on: true } });
  await page.request.patch(`/api/collections/${c.id}`, { data: { shared: true } });
  return c.id as number;
}

for (const scheme of ['light', 'dark'] as const) {
  test(`no serious accessibility issues on the library (${scheme})`, async ({ page }) => {
    const cid = await seed(page);
    await page.emulateMedia({ colorScheme: scheme });
    for (const path of ['/library', '/library?tab=weak', '/library?tab=collections', '/library?tab=notes', '/library?tab=highlights', '/library?tab=cards', '/library?tab=history', '/library/shared', `/library/c/${cid}`, '/library/c/999999']) {
      await page.goto(path);
      await page.waitForTimeout(900);
      await noHorizontalScroll(page);
      const r = await new AxeBuilder({ page }).disableRules(['region']).analyze();
      const bad = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
      expect(bad.map((v) => `${path} ${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
    }
  });

  test(`no serious accessibility issues with the selection toolbar and dialogs (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto(TOPIC);
    await hydrated(page, 'Highlighter');
    await select(page, '#main .point p', 0, 20);
    await expect(page.getByRole('toolbar', { name: 'Selection tools' })).toBeVisible();
    await page.waitForTimeout(400); // let the entrance animation settle before measuring contrast
    let r = await new AxeBuilder({ page }).include('.lb-hlbar').analyze();
    expect(r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id)).toEqual([]);
    await page.getByRole('button', { name: 'Make a flashcard' }).click();
    await expect(page.getByRole('dialog', { name: 'New flashcard' })).toBeVisible();
    await page.waitForTimeout(600);
    r = await new AxeBuilder({ page }).include('dialog.lb-dialog').analyze();
    expect(r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id)).toEqual([]);
    await page.keyboard.press('Escape');
  });
}
