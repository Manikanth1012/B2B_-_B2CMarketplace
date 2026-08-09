/* Touches the live Supabase project.
 *
 * The standard an API claims is checked twice: by `check_named_standard` in
 * the database, so nothing can be written past the form, and by
 * `standardProblem` in TypeScript, so the form can say what is wrong before it
 * tries. Two evaluations of one rule stay in agreement for exactly as long as
 * nobody edits one of them.
 *
 * It also tries the guard rather than reading it. A control nobody has
 * attempted to break is a sentence in a migration.
 *
 * Everything written here is undone in the same file.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { supabase } from './supabase'
import { signIn, signOut } from './authRepo'
import { loadTmfStandards } from './devPortalRepo'
import { standardProblem, namedStandards, type TmfStandard } from './devPortal'

const OPERATOR = { email: 'anika.sharma@aventa.com', password: 'operator123' }
const PROBE = 'AP-ITEST'

const publish = (standard: string) =>
  supabase.from('operator_apis').insert({
    id: PROBE, name: 'Integration probe', standard, audience: 'Sellers',
    description: 'Written and removed by the integration suite.',
    why: 'To find out whether the guard on this column does anything.',
    scopes: ['probe:read'],
  })

describe('an API cannot claim a standard that does not exist', () => {
  let register: TmfStandard[]

  beforeAll(async () => {
    await signIn(OPERATOR.email, OPERATOR.password)
    register = await loadTmfStandards()
  }, 30_000)

  afterAll(async () => {
    await supabase.from('operator_apis').delete().eq('id', PROBE)
    await signOut()
  })

  it('publishes the register to whoever is signed in', () => {
    expect(register.length).toBeGreaterThan(30)
    /* Every number this marketplace actually uses has to be in it, or the
       guard would refuse rows the table already holds. */
    for (const code of ['TMF620', 'TMF622', 'TMF632', 'TMF637', 'TMF678', 'TMF687', 'TMF688']) {
      expect(register.find(s => s.code === code), `${code} missing from the register`).toBeTruthy()
    }
    expect(register.every(s => /^TMF\d{3}$/.test(s.code))).toBe(true)
    expect(register.every(s => s.name.trim().length > 0)).toBe(true)
  })

  /* The number that caused this. It is a real standard for a different API,
     and the register carries the reason so the next person reaching for it
     sees what it actually is. */
  it('keeps TMF685 with the reason it was the wrong answer', () => {
    const hit = register.find(s => s.code === 'TMF685')!
    expect(hit.name).toBe('Resource Pool Management')
    expect(hit.note).toMatch(/not stock on hand/)
  })

  it('agrees with the database about every published API', async () => {
    const { data, error } = await supabase.from('operator_apis').select('id, standard')
    expect(error, error?.message).toBeNull()
    const rows = (data ?? []) as { id: string; standard: string }[]
    expect(rows.length).toBeGreaterThan(0)

    const wrong = rows
      .filter(a => standardProblem(a.standard, register) !== null)
      .map(a => `${a.id} claims ${a.standard}`)
    expect(wrong, wrong.join('; ')).toEqual([])

    /* And at least one is a compound claim, or the "every number in the
       string" reading is never exercised against real data. */
    expect(rows.some(a => a.standard !== namedStandards(a.standard)[0]),
      'no published API names anything but a bare TMF number').toBe(true)
  })

  it('refuses a number nothing in the register carries', async () => {
    const { error } = await publish('TMF999')
    expect(error, 'a made-up standard was written').not.toBeNull()
    expect(error!.message).toMatch(/not a TM Forum Open API/)
    /* And the module refuses the same thing, with its own words. */
    expect(standardProblem('TMF999', register)).toMatch(/TMF999/)
  })

  it('refuses a made-up number hidden inside a compound claim', async () => {
    const { error } = await publish('TMF688 / TMF999')
    expect(error, 'a made-up standard passed because it had company').not.toBeNull()
    expect(error!.message).toMatch(/TMF999/)
  })

  /* Not everything a marketplace publishes is a TM Forum standard — two of
     the seven here are 6D's own — and forcing those into a number would be
     the original mistake with more ceremony. */
  it('lets through an API that never claimed a TM Forum standard', async () => {
    const { error } = await publish('6D internal')
    expect(error, error?.message).toBeNull()
    expect(standardProblem('6D internal', register)).toBeNull()

    /* And the guard is on UPDATE too, not only INSERT — the shape this build
       has found twice, where a rule watched one door. */
    const bad = await supabase.from('operator_apis')
      .update({ standard: 'TMF999' }).eq('id', PROBE)
    expect(bad.error, 'a published API could be edited into a made-up standard').not.toBeNull()

    const good = await supabase.from('operator_apis')
      .update({ standard: 'TMF687' }).eq('id', PROBE)
    expect(good.error, good.error?.message).toBeNull()
  })

  it('does not let a seller write the register', async () => {
    await signOut()
    await signIn('rajesh.kumar@nimbussensors.com', 'partner123')

    const read = await supabase.from('tmf_standard').select('code').limit(1)
    expect(read.error, 'a seller cannot read the published register').toBeNull()
    expect((read.data ?? []).length).toBe(1)

    const { error } = await supabase.from('tmf_standard')
      .insert({ code: 'TMF998', name: 'Invented', domain: 'Product' })
    /* A row-level refusal is not an error to PostgREST — it writes nothing and
       reports success — so the absence of the row is the assertion. */
    const after = await supabase.from('tmf_standard').select('code').eq('code', 'TMF998')
    expect((after.data ?? []).length, `a seller added a standard${error ? '' : ' silently'}`).toBe(0)

    await signOut()
    await signIn(OPERATOR.email, OPERATOR.password)
  }, 30_000)
})
