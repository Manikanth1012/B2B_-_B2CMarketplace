/* Touches the live Supabase project. Reads only.
 *
 * Every screen in every console carries a help button, and for 52 of the 71 it
 * opened a dialog saying there was no article. Nothing failed when a screen
 * shipped without one, so the gap grew with the app.
 *
 * This is the check that makes it fail. It asks `articleForView` — the function
 * the button actually calls, filtering on `personas` rather than `persona`,
 * which is the distinction a coverage query written against the wrong column
 * would miss — for every screen the app can be on.
 *
 * The screen list is asserted against `src/types/view.ts` rather than hand-kept,
 * because a list maintained by hand is how the coverage drifted in the first
 * place: a new screen would be added to the app and not to the list, and this
 * file would go on reporting full coverage of a smaller app than exists.
 */
import { describe, it, expect, afterAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { signIn, signOut } from './authRepo'
import { articleForView } from './kbRepo'
import type { Persona } from '../types/view'

/* Signed in as each persona in turn, not as one of them.

   `kb_articles` is scoped by RLS to the audience it is published to, so a
   shopper cannot read a seller's articles — asking all four questions from one
   session reports 61 screens uncovered when every one of them has an article.
   The first version of this file did exactly that. Whoever is asking has to be
   the audience being asked about. */
const LOGIN: Record<Persona, { email: string; password: string }> = {
  consumer:   { email: 'priya.raman@example.com', password: 'demo1234' },
  operator:   { email: 'anika.sharma@aventa.com', password: 'operator123' },
  partner:    { email: 'rajesh.kumar@nimbussensors.com', password: 'partner123' },
  enterprise: { email: 'vikram.shah@smartbuild.in', password: 'enterprise123' },
}

const PERSONAS: Persona[] = ['consumer', 'operator', 'partner', 'enterprise']

async function asPersona<T>(persona: Persona, run: () => Promise<T>): Promise<T> {
  await signOut()
  await signIn(LOGIN[persona].email, LOGIN[persona].password)
  return run()
}

/** The members of a union type, read out of the source it is declared in. */
function unionMembers(source: string, name: string): string[] {
  const at = source.indexOf(`export type ${name} =`)
  if (at < 0) throw new Error(`${name} is not declared in types/view.ts`)
  /* Up to the blank line that ends the declaration. */
  const rest = source.slice(at)
  const end = rest.indexOf('\n\n')
  const body = end < 0 ? rest : rest.slice(0, end)
  return [...body.matchAll(/'([^']+)'/g)].map(m => m[1])
}

const SOURCE = readFileSync(new URL('../types/view.ts', import.meta.url), 'utf8')

/* `kb` is a consumer screen and is in the union; the three consoles name theirs
   op-kb / pt-kb / en-kb. Nothing is excluded — a knowledge base that cannot
   explain itself is as much a gap as any other. */
const SCREENS: { persona: Persona; view: string }[] = [
  ...unionMembers(SOURCE, 'View').map(view => ({ persona: 'consumer' as Persona, view })),
  ...unionMembers(SOURCE, 'OperatorView').map(view => ({ persona: 'operator' as Persona, view })),
  ...unionMembers(SOURCE, 'PartnerView').map(view => ({ persona: 'partner' as Persona, view })),
  ...unionMembers(SOURCE, 'EnterpriseView').map(view => ({ persona: 'enterprise' as Persona, view })),
]

afterAll(async () => { await signOut() }, 30000)

describe('help for this screen', () => {
  it('found the screens by reading the union types, not a list kept by hand', () => {
    /* The guard on the guard. If the parser silently returned nothing, every
       coverage assertion below would range over an empty set and pass. */
    expect(SCREENS.length, 'no screens were parsed out of types/view.ts').toBeGreaterThan(60)
    expect(SCREENS.filter(s => s.persona === 'operator').length).toBeGreaterThan(20)
    expect(SCREENS.filter(s => s.persona === 'enterprise').length).toBeGreaterThan(15)
    expect(SCREENS.filter(s => s.persona === 'partner').length).toBeGreaterThan(15)
    /* And they look like screen ids rather than whatever else was in quotes. */
    expect(SCREENS.map(s => s.view)).toContain('en-browse')
    expect(SCREENS.map(s => s.view)).toContain('op-markets')
  })

  it('has an article for every screen, asked as the persona that reads it', async () => {
    const missing: string[] = []
    const thin: string[] = []
    let asked = 0

    for (const persona of PERSONAS) {
      await asPersona(persona, async () => {
        for (const s of SCREENS.filter(x => x.persona === persona)) {
          asked++
          const res = await articleForView(s.persona, s.view)
          if (!res.ok) { missing.push(`${s.persona}/${s.view} (query failed: ${res.reason})`); continue }
          if (!res.article) { missing.push(`${s.persona}/${s.view}`); continue }
          /* Coverage measured as "a row came back" is satisfied by a row with
             no body, which renders the same useless dialog. */
          const a = res.article
          if (!a.title?.trim() || !a.summary?.trim() || !Array.isArray(a.body) || a.body.length < 3) {
            thin.push(`${s.persona}/${s.view}`)
          }
        }
      })
    }

    expect(asked, 'no screen was asked about, so this checked nothing').toBe(SCREENS.length)
    expect(missing, 'these screens open a help dialog with nothing in it').toEqual([])
    expect(thin, 'these articles are too thin to answer anything').toEqual([])
  }, 300000)

  it('gives each persona its own article for a screen name they share', async () => {
    /* Every console has a knowledge base screen and a notifications screen. If
       one article were being served to all of them, the coverage above would
       pass while three of the four audiences read something written for
       somebody else. */
    const pairs: [Persona, string][] = [
      ['operator', 'op-kb'], ['partner', 'pt-kb'], ['enterprise', 'en-kb'], ['consumer', 'kb'],
    ]
    const ids: (string | null)[] = []
    for (const [persona, view] of pairs) {
      const r = await asPersona(persona, () => articleForView(persona, view))
      ids.push(r.ok && r.article ? r.article.id : null)
    }
    expect(ids.every(Boolean), 'a knowledge base screen has no article').toBe(true)
    expect(new Set(ids).size, 'two personas are being served the same article').toBe(ids.length)
  }, 120000)
})
