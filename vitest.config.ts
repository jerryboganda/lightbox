import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['tests/unit/**/*.test.ts'], env: { DB_PATH: ':memory:' } },
});
