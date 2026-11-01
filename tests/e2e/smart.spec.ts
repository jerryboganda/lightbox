import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// Phase 4 time savers: keyboard shortcuts, the weekly challenge, the high-yield sheet and offline packs.

test('? opens the shortcut sheet and g then s jumps to Study', async ({ page, isMobile }) => {
  test.skip(isMobile, 'keyboard shortcuts are for desktop');
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await page.keyboard.press('Shift+Slash');
  const sheet = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByText('Show these shortcuts')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
  await page.keyboard.press('g');
  await page.keyboard.press('s');
  await expect(page).toHaveURL(/\/study$/);
});

test('shortcuts stay quiet while typing', async ({ page, isMobile }) => {
  test.skip(isMobile, 'keyboard shortcuts are for desktop');
  await page.goto('/account');
  await page.waitForLoadState('networkidle');
  const field = page.locator('input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=range]):not([type=time]), textarea').first();
  test.skip(!(await field.count()), 'no text field on this page');
  await field.focus();
  await page.keyboard.type('?gs');
  await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeHidden();
  await expect(page).toHaveURL(/\/account$/);
});

test('weekly challenge starts once and resumes after', async ({ page }) => {
  await page.goto('/class');
  const tile = page.locator('#challenge');
  await expect(tile.getByRole('heading', { name: 'Weekly challenge' })).toBeVisible();
  const start = tile.getByRole('button', { name: /Start this week's challenge/ });
  if (await start.count()) await start.click(); else await tile.getByRole('link', { name: /Resume the challenge/ }).click();
  await expect(page).toHaveURL(/\/practice\/exam\/\d+/);
  const exam = page.url();
  await page.goto('/class');
  await tile.getByRole('link', { name: /Resume the challenge/ }).click();
  await expect(page).toHaveURL(exam);
});

test('challenge API returns the same session every time', async ({ page }) => {
  const a = await page.request.post('/api/challenge', { headers: { accept: 'application/json', 'content-type': 'application/json' } });
  const b = await page.request.post('/api/challenge', { headers: { accept: 'application/json', 'content-type': 'application/json' } });
  expect(a.status()).toBe(201);
  expect((await a.json()).id).toBe((await b.json()).id);
});

test('high-yield sheet opens from the library', async ({ page }) => {
  await page.goto('/library/high-yield');
  await expect(page.getByRole('heading', { level: 1, name: 'My high-yield sheet' })).toBeVisible();
});

test('a system can be saved for offline study and removed from Account', async ({ page, isMobile }) => {
  test.skip(isMobile, 'one run is enough: packs are per browser');
  test.setTimeout(90_000);
  await page.goto('/study/physics');
  const btn = page.locator('[data-pack]');
  await expect(btn).toBeVisible();
  await btn.click();
  await expect(btn).toHaveText(/Saved offline/, { timeout: 60_000 });
  await page.goto('/account');
  const remove = page.getByRole('button', { name: /Remove the .* offline pack/ });
  await expect(remove).toBeVisible();
  await remove.click();
  await expect(page.getByText(/Nothing saved yet/)).toBeVisible();
});

for (const path of ['/class', '/library/high-yield', '/practice']) {
  test(`no serious accessibility issues on ${path}`, async ({ page }) => {
    await page.goto(path);
    await page.waitForTimeout(900);
    const r = await new AxeBuilder({ page }).disableRules(['region']).analyze();
    const bad = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(bad.map((v) => `${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
  });
}
