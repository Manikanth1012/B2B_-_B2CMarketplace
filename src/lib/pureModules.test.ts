/* The unit suite must not need a database.
 *
 * `./supabase` builds a client at import time and throws when there are no
 * credentials. That makes it poison for a unit test: importing it — at any
 * depth — takes the whole file down before a single assertion runs, in any
 * environment without credentials. CI is deliberately such an environment.
 *
 * This is not hypothetical. `consumerBillDoc.ts` grew a `loadBillBook` and its
 * test file went red in CI while passing on every developer machine, because
 * developers have the variables in their shell. 1,515 tests passed and the
 * suite still failed, on a module none of the tests were about.
 *
 * The convention that prevents it is already everywhere in this codebase —
 * `kb.ts`/`kbRepo.ts`, `onboarding.ts`/`onboardingRepo.ts`, `auth.ts`/
 * `authRepo.ts`, `evidence.ts`/`evidenceRepo.ts`. This makes the convention
 * fail a test rather than a pipeline.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'

const LIB = resolve(__dirname)

/** Every relative import in a file, as resolved paths without an extension. */
function importsOf(file: string): string[] {
  const src = readFileSync(file, 'utf8')
  const out: string[] = []
  for (const m of src.matchAll(/(?:^|\n)\s*import\s[^'"]*['"](\.[^'"]+)['"]/g)) {
    out.push(resolve(dirname(file), m[1]))
  }
  return out
}

function exists(base: string): string | null {
  for (const ext of ['.ts', '.tsx', '/index.ts']) {
    try { readFileSync(base + ext, 'utf8'); return base + ext } catch { /* keep looking */ }
  }
  return null
}

/**
 * The import chain from `file` to `./supabase`, or null if there is none.
 *
 * Returned as a chain rather than a boolean because "some test imports
 * supabase" is not a message anybody can act on — the useful thing is which
 * hop introduced it.
 */
function chainToSupabase(file: string, seen = new Set<string>()): string[] | null {
  if (seen.has(file)) return null
  seen.add(file)

  for (const target of importsOf(file)) {
    if (target === join(LIB, 'supabase')) return [file, `${target}.ts`]
    const resolved = exists(target)
    if (!resolved) continue
    const rest = chainToSupabase(resolved, seen)
    if (rest) return [file, ...rest]
  }
  return null
}

const short = (p: string) => p.slice(p.indexOf('/src/') + 1)

describe('the unit suite runs without credentials', () => {
  const tests = readdirSync(LIB)
    .filter(f => f.endsWith('.test.ts') && !f.endsWith('.integration.test.ts'))
    .map(f => join(LIB, f))

  it('finds the unit test files', () => {
    expect(tests.length).toBeGreaterThan(30)
  })

  it.each(tests.map(t => [short(t), t]))('%s reaches no Supabase client', (_name, file) => {
    const chain = chainToSupabase(file as string)
    expect(
      chain,
      chain ? `imports ./supabase via:\n    ${chain.map(short).join('\n      -> ')}` : '',
    ).toBeNull()
  })
})
