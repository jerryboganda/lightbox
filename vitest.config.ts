import { defineConfig } from 'vitest/config';

export default defineConfig({
  oxc: { jsx: { runtime: 'automatic' } }, // lets tests import the React islands
  test: { include: ['tests/unit/**/*.test.ts'], env: { DB_PATH: ':memory:' } },
});
