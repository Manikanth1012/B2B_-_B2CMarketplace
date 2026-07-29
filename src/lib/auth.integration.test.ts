/* Touches the live Supabase project. Signs in as the seeded demo users and
   signs out again; creates nothing. Requires scripts/seed-auth-users.mjs to
   have been run once against the project. */
import { describe, it, expect, afterEach } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { supabase } from './supabase'
import { signIn, restoreSession, signOut, SignInError } from './authRepo'

const CREDENTIALS = {
  consumer: { email: 'priya.raman@example.com', password: 'demo1234' },
  operator: { email: 'anika.sharma@aventa.com', password: 'operator123' },
  partner: { email: 'rajesh.kumar@nimbussensors.com', password: 'partner123' },
  enterprise: { email: 'vikram.shah@smartbuild.in', password: 'enterprise123' },
} as const

afterEach(async () => {
  await signOut()
})

describe('sign-in against the live project', () => {
  it('signs in each persona and reads the persona back off the JWT', async () => {
    for (const [persona, { email, password }] of Object.entries(CREDENTIALS)) {
      const session = await signIn(email, password)
      expect(session.persona).toBe(persona)
      await signOut()
    }
  })

  it('gives the partner its partner_id, and gives nobody else one', async () => {
    const partner = await signIn(CREDENTIALS.partner.email, CREDENTIALS.partner.password)
    expect(partner.partnerId).toBe('PTR-1004')
    await signOut()

    const consumer = await signIn(CREDENTIALS.consumer.email, CREDENTIALS.consumer.password)
    expect(consumer.partnerId).toBeUndefined()
  })

  /* The failure Task 3 exists to prevent. The console must follow the
     credentials, not the card the user happened to click. */
  it('returns the operator console for operator credentials, whatever card was clicked', async () => {
    const session = await signIn(CREDENTIALS.operator.email, CREDENTIALS.operator.password)
    expect(session.persona).toBe('operator')
  })

  it('refuses a wrong password and leaves no session behind', async () => {
    await expect(signIn(CREDENTIALS.consumer.email, 'not-the-password')).rejects.toBeInstanceOf(SignInError)
    expect(await restoreSession()).toBeNull()
  })

  it('refuses an unknown account', async () => {
    await expect(signIn('nobody@example.com', 'whatever123')).rejects.toBeInstanceOf(SignInError)
  })

  it('restores the session after sign-in and drops it after sign-out', async () => {
    await signIn(CREDENTIALS.enterprise.email, CREDENTIALS.enterprise.password)
    expect(await restoreSession()).toEqual({ persona: 'enterprise', partnerId: undefined })

    await signOut()
    expect(await restoreSession()).toBeNull()
    expect((await supabase.auth.getSession()).data.session).toBeNull()
  })
})

/* persistSession is what keeps a reload inside the console. Asserting it needs
   two clients over one storage, because a reload is a new client reading what
   the old one left behind. */
describe('persistSession survives a reload', () => {
  it('a second client picks up the session the first one stored', async () => {
    const store = new Map<string, string>()
    const storage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    }
    const opts = { auth: { persistSession: true, autoRefreshToken: false, storage } }
    const url = import.meta.env.VITE_SUPABASE_URL
    const key = import.meta.env.VITE_SUPABASE_ANON_KEY

    const before = createClient(url, key, opts)
    await before.auth.signInWithPassword(CREDENTIALS.operator)
    expect(store.size).toBeGreaterThan(0)

    const after = createClient(url, key, opts)
    const { data } = await after.auth.getSession()
    expect(data.session).not.toBeNull()
    expect(data.session!.user.app_metadata.persona).toBe('operator')

    await after.auth.signOut()
  })
})
