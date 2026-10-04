import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const noHorizontalScroll = async (page: Page) =>
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);

test('dashboard shows live numbers and fits the screen', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('link', { name: /Start review|Learn new cards/ })).toBeVisible();
  await expect(page.getByText('Your mastery by system')).toBeVisible();
  await noHorizontalScroll(page);
});

test('search palette finds a topic and opens it', async ({ page, isMobile }) => {
  await page.goto('/');
  if (isMobile) await page.getByRole('button', { name: /Search/ }).click();
  else await page.keyboard.press('Control+k');
  const input = page.getByPlaceholder(/Search 463 facts/);
  await input.fill('tracheal diverticulum');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/study\/chest\/tracheal-diverticulum/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Tracheal diverticulum');
});

test('fact explorer filters by status', async ({ page }) => {
  await page.goto('/facts?label=unchecked');
  await expect(page.getByText(/Showing \d+ of 463 facts/)).toBeVisible();
  await expect(page.getByText('Showing 42 of 463 facts')).toBeVisible();
  await noHorizontalScroll(page);
});

test('MCQ gives feedback after checking', async ({ page }) => {
  await page.goto('/practice/mcq');
  const first = page.getByRole('radio').filter({ hasText: /^A/ }).first();
  await first.click();
  await page.getByRole('button', { name: /Check answer/ }).click();
  await expect(page.getByText(/Correct\.|The key says|No answer key/)).toBeVisible();
});

test('flashcard flips and records a rating', async ({ page }) => {
  await page.goto('/practice/cards');
  await page.getByRole('button', { name: 'Show answer' }).click();
  await page.getByRole('button', { name: /^Good/ }).click();
  await expect(page.getByText(/^1 \//)).toBeVisible();
});

test('atlas opens an image in the lightbox', async ({ page }) => {
  await page.goto('/atlas');
  await page.locator('#atlas a.tile').first().click();
  await expect(page.locator('.pswp')).toBeVisible();
  await expect(page.locator('.pswp-cap')).not.toBeEmpty();
});

test('theme toggle switches light and dark', async ({ page }) => {
  await page.goto('/study');
  const before = await page.locator('html').getAttribute('data-theme');
  await page.getByRole('button', { name: 'Change theme' }).click();
  await page.getByRole('button', { name: 'Change theme' }).click();
  await expect.poll(() => page.locator('html').getAttribute('data-theme')).not.toBe(before);
});

for (const scheme of ['light', 'dark'] as const) for (const path of ['/', '/study', '/study/physics/bremsstrahlung', '/facts', '/practice/mcq', '/review', '/atlas', '/account']) {
  test(`no serious accessibility issues on ${path} (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto(path);
    await page.waitForTimeout(900);
    const r = await new AxeBuilder({ page }).disableRules(['region']).analyze();
    const bad = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(bad.map((v) => `${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
  });
}
