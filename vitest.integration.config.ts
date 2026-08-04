import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.integration.test.ts'],
    testTimeout: 30000,
    hookTimeout: 30000,
    /* One file at a time.
     *
     * These tests share one live Supabase project and one set of demo logins,
     * and several of them mutate that shared state and put it back — the
     * pricing suite suspends the demo partner's market grant and restores it in
     * a `finally`, the settlement suite reopens a decided requisition, the
     * application suite creates and deletes partners.
     *
     * Run in parallel, one file's temporary mutation is another file's
     * assertion. That is exactly what happened: `homeMarket` asserts no seller
     * holds a price in a currency none of their approved markets take, and it
     * failed on four dirham prices belonging to a seller whose dirham grant was
     * suspended at that instant by `marketPricing` two files away. Nothing was
     * wrong with either test or with the data — they were simply both true at
     * different moments and read at the same one.
     *
     * The cost is wall-clock: about two minutes becomes about five. That is the
     * right trade for a suite whose failures are otherwise unreproducible, and
     * the alternative — every cross-cutting assertion narrowed until it only
     * reads rows nobody else touches — would delete the checks that have caught
     * the most.
     *
     * The unit suite is untouched and still parallel; it has no database. */
    fileParallelism: false,
  },
})
