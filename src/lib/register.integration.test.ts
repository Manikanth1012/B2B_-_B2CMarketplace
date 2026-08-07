/* Touches the live Supabase project. Creates auth users and removes them.
 *
 * The claim worth testing is the security one, and it cannot be checked from a
 * mock: `current_persona()` is `select persona from profiles where id =
 * auth.uid()`, so anything that can write `profiles` decides what it is. This
 * checks that registration produces a consumer and cannot produce anything
 * else — and, the other half, that it produces a working one, because a
 * registration that creates nothing satisfies every escalation test ever
 * written for it.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { supabase } from './supabase'
import { signIn, signOut } from './authRepo'
import { registerShopper, emailTaken } from './registerRepo'
import { validateSignUp } from './register'
import type { SignUpDraft } from './register'

const OPERATOR = { email: 'anika.sharma@aventa.com', password: 'operator123' }
const CONSUMER = { email: 'priya.raman@example.com', password: 'demo1234' }
const PARTNER = { email: 'rajesh.kumar@nimbussensors.com', password: 'partner123' }

/* Registered addresses cannot be deleted from a client, so the sweep at the end
   goes through the management connection the migrations use. Every address this
   file creates carries the marker so that sweep can find them. */
const MARKER = '@register.integration.test'
const mail = () => `shopper-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}${MARKER}`

function draft(over: Partial<SignUpDraft> = {}): SignUpDraft {
  return {
    name: 'Integration Shopper', email: mail(), password: 'harbour-lantern-tin',
    /* Not Priya Raman's number, which this fixture used to copy — every account
       the suite left behind carried it, so a support search for it returned
       sixteen people. */
    msisdn: '+91 98860 4' + Math.floor(1000 + Math.random() * 8999),
    city: 'Kochi', market: 'IN', ...over,
  }
}

describe('a shopper registers', () => {
  const made: string[] = []

  beforeAll(async () => { await signOut() }, 30000)

  afterAll(async () => {
    /* Signed out rather than leaving a freshly made account signed in — the
       next file to run would otherwise inherit it. */
    await signOut()
  }, 30000)

  it('creates a working consumer account', async () => {
    /* The permission half. Everything below is about what registration must not
       do, and all of it passes on a function that does nothing. */
    const d = draft()
    const res = await registerShopper(d, [{ code: 'IN' }])
    expect(res.ok, res.ok ? '' : res.reason).toBe(true)
    if (!res.ok) return
    made.push(d.email)

    expect(res.session.persona).toBe('consumer')
    expect(res.customer_id).toMatch(/^CUS-\d+$/)

    /* The profile is theirs, in their own market, with their own details — not
       the seeded defaults, which are Priya Raman's down to her wallet. */
    const { data } = await supabase.from('consumer_profile')
      .select('name, customer_id, city, market, currency, wallet, msisdn').maybeSingle()
    const p = data as {
      name: string; customer_id: string; city: string; market: string
      currency: string; wallet: number; msisdn: string
    } | null
    expect(p?.name).toBe('Integration Shopper')
    expect(p?.customer_id).toBe(res.customer_id)
    expect(p?.city).toBe('Kochi')
    expect(p?.market).toBe('IN')
    expect(p?.currency).toBe('INR')
    /* Their own number, not a literal. This asserted `+91 98860 41127` —
       Priya Raman's — which is what the fixture happened to copy, so it passed
       while every account the suite created carried the demo customer's phone
       number. Comparing against the draft is the check that was meant. */
    expect(p?.msisdn).toBe(d.msisdn)
    /* A new shopper starts at nothing. Inheriting the demo customer's ₹42.60
       would be the table's defaults leaking. */
    expect(Number(p?.wallet)).toBe(0)

    /* Tier and balance are read off the membership, not the profile: they used
       to be duplicated onto `consumer_profile` and nothing maintained the copy,
       so the second seeded customer arrived with 0 points against a ledger of
       760. The membership assertions are in their own test below. */
    const { data: mem } = await supabase.from('loyalty_members').select('tier, balance').maybeSingle()
    expect((mem as { tier: string } | null)?.tier).toBe('bronze')
    expect(Number((mem as { balance: number } | null)?.balance)).toBe(0)
  }, 60000)

  it('can do what a shopper does, and nothing an operator does', async () => {
    /* The persona is real, not just a string in a row: RLS is what proves it. */
    const { data: mine } = await supabase.from('consumer_profile').select('id')
    expect((mine ?? []).length, 'the new shopper cannot see their own profile').toBe(1)

    const { data: partners, error } = await supabase.from('partners').select('id')
    expect(error ? true : (partners ?? []).length === 0,
      'a shopper read the seller directory').toBe(true)

    const { data: apps } = await supabase.from('applications').select('id')
    expect((apps ?? []).length, 'a shopper read the application queue').toBe(0)
  }, 30000)

  it('has a loyalty membership, so the rewards screen has something to read', async () => {
    const { data } = await supabase.from('loyalty_members').select('tier, balance, kind')
    const rows = (data ?? []) as { tier: string; balance: number; kind: string }[]
    expect(rows.length, 'the new shopper has no membership row').toBe(1)
    expect(rows[0].kind).toBe('consumer')
    expect(rows[0].tier).toBe('bronze')
    /* Nought, because points are earned. Seeding any would be inventing a
       purchase history. */
    expect(Number(rows[0].balance)).toBe(0)
  }, 30000)

  it('refuses to register the same sign-in twice', async () => {
    /* The check that makes the function safe to expose at all: it can create a
       first profile and never change an existing one. */
    const { error } = await supabase.rpc('register_as_consumer', {
      p_name: 'Someone Else', p_msisdn: '+91 90000 00000', p_city: 'Pune', p_market: 'IN',
    })
    expect(error, 'a second profile was created for one sign-in').not.toBeNull()
    expect(error?.message).toMatch(/already registered/i)
  }, 30000)

  it('will not let an existing persona re-register as a shopper', async () => {
    /* The escalation this whole design is about, run in both directions. An
       operator or a seller calling it must be refused — they already have a
       profile, and this must never be a way to acquire a second persona or
       swap one. */
    for (const who of [OPERATOR, PARTNER, CONSUMER]) {
      await signOut()
      await signIn(who.email, who.password)
      const { error } = await supabase.rpc('register_as_consumer', {
        p_name: 'Escalation Attempt', p_msisdn: '+91 90000 00001', p_city: 'Pune', p_market: 'IN',
      })
      expect(error, `${who.email} registered a second profile`).not.toBeNull()
    }
    await signOut()
  }, 60000)

  it('cannot write its own persona row directly', async () => {
    /* The function is the only way in because the table is shut. If an INSERT
       policy ever appears on `profiles`, `current_persona()` stops being ours
       to decide — so this is checked from a client rather than assumed. */
    await signIn(CONSUMER.email, CONSUMER.password)
    const { data: session } = await supabase.auth.getSession()
    const uid = session.session?.user.id

    const { data, error } = await supabase.from('profiles')
      .insert({ id: uid, persona: 'operator' }).select('id')
    expect(error !== null || (data ?? []).length === 0,
      'a signed-in user wrote their own profiles row').toBe(true)

    const { data: up, error: upErr } = await supabase.from('profiles')
      .update({ persona: 'operator' }).eq('id', uid).select('id')
    expect(upErr !== null || (up ?? []).length === 0,
      'a signed-in user promoted themselves to operator').toBe(true)

    /* And they are still a consumer afterwards. */
    const { data: still } = await supabase.from('profiles').select('persona').maybeSingle()
    expect((still as { persona: string } | null)?.persona).toBe('consumer')
    await signOut()
  }, 30000)

  it('refuses a country the marketplace does not operate in', async () => {
    const d = draft({ market: 'GB' })
    /* The form refuses it, and so does the database — checked separately so a
       weakened client cannot get past both. */
    expect(validateSignUp(d, [{ code: 'IN' }]).ok).toBe(false)

    await signIn(CONSUMER.email, CONSUMER.password)
    const { error } = await supabase.rpc('register_as_consumer', {
      p_name: 'X', p_msisdn: '+91 90000 00002', p_city: 'London', p_market: 'GB',
    })
    expect(error).not.toBeNull()
    await signOut()
  }, 30000)

  it('says whether an address is already taken', async () => {
    expect(await emailTaken(CONSUMER.email), 'a known address reported free').toBe(true)
    expect(await emailTaken(`definitely-not-${Date.now()}@nowhere.test`)).toBe(false)
  }, 30000)

  it('refuses a second account on an address that has one', async () => {
    const res = await registerShopper(draft({ email: CONSUMER.email }), [{ code: 'IN' }])
    expect(res.ok, 'a second account was created on a taken address').toBe(false)
    if (!res.ok) expect(res.reason).toMatch(/already an account|Sign in instead/i)
  }, 60000)

  it('leaves the demo customer exactly as she was', async () => {
    /* Every other test in the repo is built around her row, and registration
       must not have moved it — the defaults on that table are hers. */
    await signIn(OPERATOR.email, OPERATOR.password)
    const { data } = await supabase.from('consumer_profile')
      .select('id, name, market, currency').eq('id', 'me').maybeSingle()
    const p = data as { name: string; market: string; currency: string } | null
    expect(p?.name).toBe('Priya Raman')
    expect(p?.market).toBe('IN')
    expect(p?.currency).toBe('INR')

    /* Her tier lives on the membership now rather than on the profile. */
    const { data: hers } = await supabase.from('loyalty_members')
      .select('tier, balance').eq('id', 'LM-4001').maybeSingle()
    expect((hers as { tier: string } | null)?.tier).toBe('gold')
    expect(Number((hers as { balance: number } | null)?.balance)).toBe(2500)
    await signOut()
  }, 30000)

  it('registered at least one account, so none of this passed vacuously', () => {
    expect(made.length, 'no account was created, so every refusal above proves nothing')
      .toBeGreaterThan(0)
  })
})
