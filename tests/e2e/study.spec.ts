import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const noHorizontalScroll = async (page: Page) =>
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);

test('fact page shows the fact beside its highlighted source passage', async ({ page, isMobile }) => {
  await page.goto('/facts/F-M-001');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Right middle lobe collapse');
  await expect(page.getByRole('heading', { name: 'Verification' })).toBeVisible();
  if (isMobile) {
    await expect(page.locator('#pane-p')).toBeHidden();
    await page.getByRole('tab', { name: 'Original page' }).click();
    await expect(page.getByRole('tab', { name: 'Original page' })).toHaveAttribute('aria-selected', 'true');
  }
  await expect(page.getByText(/Best match highlighted at line/)).toBeVisible();
  const hl = page.locator('[data-pbox] mark.hl');
  await expect(hl.first()).toBeVisible();
  await expect(hl.first()).toContainText(/right atrial border|triangular density/);
  await noHorizontalScroll(page);
});

test('fact page links to neighbours, its page and its topic', async ({ page }) => {
  await page.goto('/facts/F-M-014');
  await expect(page.getByText('Paper says.')).toBeVisible();
  await expect(page.getByRole('link', { name: /FEB2025-Q13/ })).toHaveAttribute('href', '/practice/mcq?q=FEB2025-Q13');
  await page.getByRole('navigation', { name: 'Previous and next fact' }).getByRole('link').last().click();
  await expect(page).toHaveURL(/\/facts\/F-M-015$/);
  await page.getByRole('link', { name: /IMM Feb 2025-2 · Page 10/ }).click();
  await expect(page).toHaveURL(/\/sources\/final-imm-feb-2025-2\/10#F-M-015$/);
  await expect(page.locator('#F-M-015')).toHaveClass(/lit/);
});

test('unknown fact gets a styled 404', async ({ page }) => {
  const res = await page.goto('/facts/NOT-A-FACT');
  expect(res?.status()).toBe(404);
  await expect(page.getByRole('heading', { name: 'Fact not found' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Fact explorer' }).last()).toBeVisible();
});

test('source viewer lists files and lights up a fact in the page text', async ({ page }) => {
  await page.goto('/sources');
  await expect(page.getByRole('heading', { name: 'Source pages' })).toBeVisible();
  await page.getByRole('link', { name: /IMM TOACS Feb 2023/ }).click();
  await expect(page).toHaveURL(/\/sources\/imm-toacs-feb-2023\/\d+$/);
  const item = page.locator('[data-facts] > li[data-range]').first();
  await item.getByRole('button', { name: /Show where/ }).click();
  await expect(item).toHaveClass(/lit/);
  await expect(page.locator('[data-pbox] .on').first()).toBeVisible();
  const before = page.url();
  await page.getByRole('link', { name: /^Next:/ }).click();
  await expect(page).not.toHaveURL(before);
  await noHorizontalScroll(page);
});

test('nothing-examinable pages say why, and bad pages 404', async ({ page }) => {
  await page.goto('/sources/final-imm-feb-2025-2/1');
  await expect(page.getByText(/Nothing examinable on this page/)).toBeVisible();
  await expect(page.locator('.pg[aria-current="page"]')).toHaveText('1');
  expect((await page.goto('/sources/final-imm-feb-2025-2/999'))?.status()).toBe(404);
  expect((await page.goto('/sources/not-a-file/1'))?.status()).toBe(404);
  await page.goto('/sources/final-imm-feb-2025-2');
  await expect(page).toHaveURL(/\/sources\/final-imm-feb-2025-2\/3$/);
});

test('compare picks topics with the search box and aligns them', async ({ page }) => {
  await page.goto('/study/compare');
  const box = page.getByRole('combobox');
  await box.fill('cavitating lung');
  await expect(page.getByRole('option', { name: /Cavitating lung lesions/ })).toBeVisible();
  await box.press('Enter');
  await expect(page).toHaveURL(/\?t=cavitating-lung-lesions$/);
  await page.locator('.sugg a.chip').first().click();
  await expect(page).toHaveURL(/\?t=cavitating-lung-lesions,[a-z0-9-]+$/);
  await expect(page.locator('.cmp-head .th')).toHaveCount(2);
  await expect(page.locator('.cmp-row').first()).toContainText(/Key points/i);
  await page.getByRole('link', { name: /Remove Cavitating lung lesions/ }).click();
  await expect(page.locator('.cmp-head .th')).toHaveCount(1);
  await noHorizontalScroll(page);
});

test('compare works without the script and ignores junk', async ({ page }) => {
  await page.goto('/study/compare?t=bremsstrahlung,nope,bremsstrahlung&add=Compton%20scatter');
  await expect(page).toHaveURL(/\?t=bremsstrahlung,compton-scatter$/);
  await expect(page.locator('.cmp-head .th')).toHaveCount(2);
});

test('topic reader offers compare, save as PDF and focus mode', async ({ page, isMobile }) => {
  await page.goto('/study/physics/bremsstrahlung');
  await expect(page.locator('[data-fact]').first()).toBeVisible();
  await page.evaluate(() => { (window as any).printed = 0; window.print = () => { (window as any).printed++; }; });
  await page.getByRole('button', { name: 'Save as PDF' }).click();
  expect(await page.evaluate(() => (window as any).printed)).toBe(1);
  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('.print-foot')).toBeVisible();
  await expect(page.locator('.print-foot')).toContainText('Printed from');
  await expect(page.getByRole('button', { name: 'Save as PDF' })).toBeHidden();
  await page.emulateMedia({ media: 'screen' });
  if (!isMobile) {
    await expect(page.locator('.side')).toBeVisible();
    await page.getByRole('button', { name: 'Focus mode' }).click();
    await expect(page.locator('.side')).toBeHidden();
    await page.getByRole('button', { name: 'Focus mode' }).click();
  }
  await page.getByRole('link', { name: 'Compare', exact: true }).click();
  await expect(page).toHaveURL(/\/study\/compare\?t=bremsstrahlung$/);
});

test('system print page lists every topic and waits for the button', async ({ page }) => {
  await page.addInitScript(() => { (window as any).printed = 0; window.print = () => { (window as any).printed++; }; });
  await page.goto('/study/physics/print');
  await expect(page.getByRole('heading', { name: 'Physics and safety', level: 2 })).toBeVisible();
  const n = await page.locator('.toc li').count();
  expect(n).toBeGreaterThan(10);
  await expect(page.locator('section.topic:not(.refs)')).toHaveCount(n);
  expect(await page.evaluate(() => (window as any).printed)).toBe(0);
  await page.getByRole('button', { name: /Print or save as PDF/ }).click();
  expect(await page.evaluate(() => (window as any).printed)).toBe(1);
});

const PAGES = ['/facts/F-M-014', '/facts/NOT-A-FACT', '/sources', '/sources/final-imm-feb-2025-2/10', '/sources/imm-toacs-march-2026/2', '/study/compare', '/study/compare?t=lobe-collapse-silhouette-signs,cavitating-lung-lesions,pulmonary-fibrosis-vs-heart-failure', '/study/physics/print'];
for (const scheme of ['light', 'dark'] as const) for (const path of PAGES) {
  test(`no serious accessibility issues on ${path} (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto(path);
    await page.waitForTimeout(900);
    const r = await new AxeBuilder({ page }).disableRules(['region']).analyze();
    const bad = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(bad.map((v) => `${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
    await noHorizontalScroll(page);
  });
}
