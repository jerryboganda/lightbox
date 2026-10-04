import { expect, test } from '@playwright/test';

test('first sign-in forces a new password', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/login/);
  await page.getByLabel('Username').fill('e2e');
  await page.getByLabel('Password', { exact: true }).fill('e2e-initial-pass-1');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/account\?first=1/);
  await page.getByLabel('Temporary password').fill('e2e-initial-pass-1');
  await page.getByLabel('New password', { exact: true }).fill('e2e-chosen-pass-2');
  await page.getByLabel('Repeat new password').fill('e2e-chosen-pass-2');
  await page.getByRole('button', { name: 'Save and continue' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('E2E');
  await page.context().storageState({ path: 'test-results/auth.json' });
});
