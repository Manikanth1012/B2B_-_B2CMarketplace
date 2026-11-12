import { defineConfig } from 'vitest/config'

export default defineConfig({
  /* Unit tests never read .env, so they run here as they do in CI, which has no
     Supabase keys: a test that reaches src/lib/supabase.ts without mocking it
     fails on this machine too, not only on GitHub. */
  envDir: './.no-env-for-unit-tests',
  test: {
    environment: 'node',
    /* Unit tests run in Node. Component tests (*.dom.test.tsx) are the only
       ones given a DOM, by jsdom, through environmentMatchGlobs below. */
    include: ['src/**/*.test.ts', 'src/**/*.dom.test.tsx'],
    environmentMatchGlobs: [['src/**/*.dom.test.tsx', 'jsdom']],
    exclude: ['**/*.integration.test.ts', 'node_modules/**'],
  },
})
