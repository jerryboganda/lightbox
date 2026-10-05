import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import fs from 'node:fs';

// Exports: Anki/CSV decks from the library, a collection and a system page; "download my data"; offline manifest.
// Runs once per project against one shared database, so tests create and clean up their own state.
const hydrated = (page: Page, name: string) =>
  page.waitForFunction((n) => [...document.querySelectorAll('astro-island')].some((i) => i.getAttribute('component-url')?.includes(n) && !i.hasAttribute('ssr')), name);
const noHorizontalScroll = async (page: Page) =>
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
const del = (page: Page, url: string) => page.request.delete(url, { headers: { 'content-type': 'application/json' } });
const openExport = async (page: Page, trigger: string) => {
  await hydrated(page, 'ExportMenu');
  await page.getByRole('button', { name: trigger }).click();
  const dlg = page.getByRole('dialog', { name: 'Export flashcards' });
  await expect(dlg).toBeVisible();
  return dlg;
};
const save = async (page: Page, click: () => Promise<void>) => {
  const [d] = await Promise.all([page.waitForEvent('download'), click()]);
  return { name: d.suggestedFilename(), body: fs.readFileSync((await d.path())!) };
};

test('export all verified cards, then one system as CSV, from the library', async ({ page }) => {
  await page.goto('/library');
  const dlg = await openExport(page, 'Export to Anki');
  await expect(dlg.getByRole('radio', { name: /All verified/ })).toBeChecked();
  await expect(dlg.locator('.ex-n')).toContainText('420');
  await expect(dlg.getByText('Lightbox::All verified cards')).toBeVisible();
  await noHorizontalScroll(page);
  const apkg = await save(page, () => dlg.getByRole('button', { name: 'Download deck' }).click());
  expect(apkg.name).toBe('lightbox-all.apkg');
  expect(apkg.body.subarray(0, 4).toString('hex')).toBe('504b0304'); // zip local header
  await expect(dlg.getByRole('button', { name: 'Downloaded' })).toBeVisible();

  await dlg.locator('label', { hasText: 'A system' }).click();
  await dlg.getByRole('combobox').selectOption('system:chest');
  await dlg.locator('label', { hasText: 'Spreadsheet' }).click();
  await expect(dlg.getByText('lightbox-system-chest.csv')).toBeVisible();
  const csv = await save(page, () => dlg.getByRole('button', { name: 'Download CSV' }).click());
  expect(csv.name).toBe('lightbox-system-chest.csv');
  const text = csv.body.toString('utf8');
  expect(text.startsWith('﻿"Front","Back","Source","Status","Fact"\r\n')).toBe(true);
  const rows = text.trim().split('\r\n').length - 1;
  await expect(dlg.locator('.ex-n')).toHaveText(new RegExp(`^${rows}`));
  await page.keyboard.press('Escape');
  await expect(dlg).toBeHidden();
});

test('an empty personal deck explains itself and cannot be downloaded', async ({ page }) => {
  const r = await page.request.get('/api/export/anki?scope=mine');
  test.skip(r.ok(), 'this account already has its own cards');
  expect(r.status()).toBe(400);
  await page.goto('/library');
  const dlg = await openExport(page, 'Export to Anki');
  await dlg.locator('label', { hasText: 'My cards' }).click();
  await expect(dlg.getByText('Turn any highlight into a flashcard')).toBeVisible();
  await expect(dlg.getByRole('button', { name: 'Download deck' })).toBeDisabled();
});

test('export a collection to Anki from its page', async ({ page }) => {
  const anki = (await (await page.request.get('/api/data/anki')).json()) as { factId: string }[];
  const res = await page.request.post('/api/collections', { data: { name: 'E2E export deck', item: { type: 'fact', id: anki[0].factId } } });
  const { id } = await res.json();
  try {
    await page.goto(`/library/c/${id}`);
    const dlg = await openExport(page, 'Export to Anki');
    await expect(dlg.locator('.ex-n')).toContainText('1');
    await expect(dlg.getByText('Lightbox::E2E export deck')).toBeVisible();
    const apkg = await save(page, () => dlg.getByRole('button', { name: 'Download deck' }).click());
    expect(apkg.name).toBe(`lightbox-collection-${id}.apkg`);
    expect(apkg.body.subarray(0, 2).toString()).toBe('PK');
  } finally {
    await del(page, `/api/collections/${id}`);
  }
  expect((await page.request.get(`/api/export/anki?scope=collection:${id}`)).status()).toBe(404);
});

test('download a system deck from its study page', async ({ page }) => {
  await page.goto('/study/physics');
  const dlg = await openExport(page, 'Anki deck');
  await expect(dlg.getByText('Lightbox::Physics and safety')).toBeVisible();
  await noHorizontalScroll(page);
  const apkg = await save(page, () => dlg.getByRole('button', { name: 'Download deck' }).click());
  expect(apkg.name).toBe('lightbox-system-physics.apkg');
});

test('the study page deck menu hydrates without a mismatch', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/study');
  const dlg = await openExport(page, 'Anki decks');
  await expect(dlg.getByRole('radio', { name: /All verified/ })).toBeChecked();
  expect(await page.locator('dialog.ex-dialog').count()).toBe(1); // a <dialog> inside a <p> gets split out of the island
  expect(errors).toEqual([]);
});

test('download my data as JSON from the account page', async ({ page }) => {
  await page.goto('/account');
  const file = await save(page, () => page.getByRole('link', { name: 'Download my data' }).click());
  expect(file.name).toMatch(/^lightbox-e2e-\d{4}-\d{2}-\d{2}\.json$/);
  const data = JSON.parse(file.body.toString('utf8'));
  expect(data.profile.username).toBe('e2e');
  expect(Object.keys(data)).toEqual(expect.arrayContaining(['marks', 'collections', 'notes', 'highlights', 'cards', 'goals', 'exams', 'mcqAttempts', 'studySessions']));
  expect(file.body.toString('utf8')).not.toMatch(/password|"sessions?"/i);
});

test('export endpoints validate the scope and never cache', async ({ page }) => {
  for (const s of ['nope', 'system:__proto__', 'collection:abc', 'collection:99999999']) expect((await page.request.get(`/api/export/anki?scope=${s}`)).status()).toBe(404);
  const r = await page.request.get('/api/export/cards.csv?scope=system:breast');
  expect(r.headers()['cache-control']).toBe('no-store');
  expect(r.headers()['content-disposition']).toBe('attachment; filename="lightbox-system-breast.csv"');
});

test('the app manifest offers shortcuts and the service worker skips API routes', async ({ page }) => {
  const m = await (await page.request.get('/manifest.webmanifest')).json();
  expect(m.categories).toEqual(['education', 'medical']);
  expect(m.shortcuts.map((s: { url: string }) => s.url)).toEqual(['/practice/cards', '/practice/builder?mode=exam', '/tutor', '/library']);
  const sw = await (await page.request.get('/sw.js')).text();
  expect(sw).toContain("!p.startsWith('/api/')");
  for (const p of ['/offline', '/icons/icon-512.png']) expect(sw).toContain(`'${p}'`);
});

for (const scheme of ['light', 'dark'] as const) {
  for (const [path, trigger] of [['/library', 'Export to Anki'], ['/study/chest', 'Anki deck']] as const) {
    test(`export dialog on ${path} has no serious accessibility issues (${scheme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto(path);
      await openExport(page, trigger);
      await page.waitForTimeout(500);
      const r = await new AxeBuilder({ page }).include('dialog[open]').analyze();
      const bad = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
      expect(bad.map((v) => `${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
    });
  }
  test(`library and account pages with export actions pass axe (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    for (const path of ['/library', '/study', '/account']) {
      await page.goto(path);
      await page.waitForTimeout(900);
      const r = await new AxeBuilder({ page }).disableRules(['region']).analyze();
      const bad = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
      expect(bad.map((v) => `${path} ${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
    }
  });
}
