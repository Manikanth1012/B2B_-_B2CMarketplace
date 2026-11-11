import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    /* Unit tests run in Node. Component tests (*.dom.test.tsx) are the only
       ones given a DOM, by jsdom, through environmentMatchGlobs below. */
    include: ['src/**/*.test.ts', 'src/**/*.dom.test.tsx'],
    environmentMatchGlobs: [['src/**/*.dom.test.tsx', 'jsdom']],
    exclude: ['**/*.integration.test.ts', 'node_modules/**'],
  },
})
