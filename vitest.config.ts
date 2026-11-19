import { defineConfig } from 'vitest/config';

// Each package is its own Vitest project, configured in its own vitest.config.ts.
export default defineConfig({
  test: {
    projects: ['packages/*'],
  },
});
