import { defineConfig, devices } from '@playwright/test';

const PORT = 4400;
export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: { baseURL: `http://localhost:${PORT}`, trace: 'retain-on-failure', channel: 'chromium' },
  projects: [
    { name: 'setup', testMatch: /setup\.ts/ },
    { name: 'desktop', use: { ...devices['Desktop Chrome'], channel: 'chromium', viewport: { width: 1280, height: 800 }, storageState: 'test-results/auth.json' }, dependencies: ['setup'], testIgnore: /setup\.ts/ },
    { name: 'mobile', use: { ...devices['Pixel 7'], channel: 'chromium', storageState: 'test-results/auth.json' }, dependencies: ['setup'], testIgnore: /setup\.ts/ },
  ],
  webServer: {
    command: 'node -e "require(\'fs\').rmSync(\'data/e2e.db\',{force:true})" && node dist/server/entry.mjs',
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: false,
    env: { PORT: String(PORT), HOST: 'localhost', DB_PATH: './data/e2e.db', ADMIN_USERNAME: 'e2e', ADMIN_DISPLAY_NAME: 'E2E Tester', ADMIN_INITIAL_PASSWORD: 'e2e-initial-pass-1' },
  },
});
