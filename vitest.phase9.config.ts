import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/phase9-purity/**/*.test.ts'],
    globals: true,
    reporters: ['verbose'],
  },
});
