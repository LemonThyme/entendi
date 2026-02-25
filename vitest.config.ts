import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    include: ['tests/**/*.test.ts'],
    coverage: {
      include: ['src/**/*.ts'],
      exclude: ['src/hooks/**'],
    },
  },
});
