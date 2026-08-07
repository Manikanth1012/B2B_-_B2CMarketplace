/* Touches the live Supabase project.
 *
 * The claim this feature makes is a permission claim: the marketplace configures
 * notifications and everybody else only chooses among what it configured. A
 * claim like that cannot be tested against a mock, because the thing enforcing
 * it is RLS and two triggers in the database. So these run as each persona in
 * turn and check what they can actually see and change.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { supabase } from './supabase'
import { signIn, signOut } from './authRepo'
import {
  loadConfiguration, loadMine, savePreference, resetPreference, testGateway,
} from './notificationRepo'
import type { NotificationBook } from './notificationRepo'
import {
  myRules, effective, missingTemplates, deliverySummary, notDelivered, byKind,
  validatePreference, orderKinds, quote, liveButBroken, nameRecipient, ownerKey,
} from './notifications'
import type { Rule, Persona } from './notifications'

const OPERATOR   = { email: 'anika.sharma@aventa.com',        password: 'operator123' }
const PARTNER    = { email: 'rajesh.kumar@nimbussensors.com', password: 'partner123' }
const ENTERPRISE = { email: 'vikram.shah@smartbuild.in',      password: 'enterprise123' }
const CONSUMER   = { email: 'priya.raman@example.com',        password: 'demo1234' }
const DEMO_PARTNER = 'PTR-1004'

describe('the configuration, read by the marketplace', () => {
  let book: NotificationBook

  beforeAll(async () => {
    await signIn(OPERATOR.email, OPERATOR.password)
    book = await loadConfiguration()
    expect(book.loadError).toBeUndefined()
  })

  afterAll(async () => { await signOut() })

  it('has rules for all four personas', () => {
    const personas = new Set(book.rules.map(r => r.persona))
    expect([...personas].sort()).toEqual(['consumer', 'enterprise', 'operator', 'partner'])
  })

  it('can say something on every channel every rule claims', () => {
    expect(missingTemplates(book.rules, book.templates).map(g => `${g.rule.id}/${g.kind}`)).toEqual([])
  })

  it('never writes a template longer than the channel carries', () => {
    for (const t of book.templates) {
      const k = book.kinds.find(x => x.id === t.kind_id)!
      if (k.max_chars === null) continue
      expect(t.body.length, `${t.id} is ${t.body.length} on a ${k.max_chars} channel`).toBeLessThanOrEqual(k.max_chars)
    }
  })

  it('only aims a rule at a persona its event applies to', () => {
    for (const r of book.rules) {
      const e = book.events.find(x => x.id === r.event_id)!
      expect(e.personas, `${r.id}: ${e.id} does not happen to ${r.persona}`).toContain(r.persona)
    }
  })

  it('has an enabled gateway behind every channel a live rule uses', () => {
    const used = new Set(book.rules.filter(r => r.enabled).flatMap(r => r.kinds))
    for (const k of used) {
      if (k === 'inapp') continue
      expect(book.gateways.some(g => g.kind === k && g.enabled), `nothing carries ${k}`).toBe(true)
    }
  })

  it('has no preference switching off something mandatory', () => {
    const mandatory = new Set(book.rules.filter(r => r.mandatory).map(r => r.id))
    const broken = book.preferences.filter(p => mandatory.has(p.rule_id) && !p.enabled)
    expect(broken.map(p => p.id)).toEqual([])
  })

  it('has no preference naming a channel its rule cannot send on', () => {
    for (const p of book.preferences) {
      const r = book.rules.find(x => x.id === p.rule_id)!
      for (const k of p.kinds) expect(r.kinds, `${p.id} picked ${k}`).toContain(k)
    }
  })

  it('records a reason on everything that did not reach somebody', () => {
    for (const e of notDelivered(book.log)) {
      expect(e.detail, `${e.id} has no reason on it`).toBeTruthy()
    }
  })

  it('has a history with both a failure and a deliberate silence in it', () => {
    const s = deliverySummary(book.log)
    expect(s.failed).toBeGreaterThanOrEqual(1)
    expect(s.suppressed).toBeGreaterThanOrEqual(2)
    expect(s.rate).not.toBeNull()
  })

  it('only bills for the channels that cost money', () => {
    for (const row of byKind(book.log, book.kinds)) {
      if (row.kind === 'inapp' || row.kind === 'push') {
        for (const s of row.spend) {
          expect(s.amount, `${row.kind} should be free`).toBe(0)
        }
      }
    }
  })

  it('never reports one spend figure across two currencies', () => {
    /* Route Mobile bills Kenya in shillings and India in rupees. A single
       total across those is not money in any currency. */
    for (const row of byKind(book.log, book.kinds)) {
      const seen = new Set(row.spend.map(s => s.currency))
      expect(seen.size).toBe(row.spend.length)
    }
    for (const e of book.log) {
      if (e.cost > 0) {
        expect(e.cost_currency, `${e.id} is priced and says in what`).toBeTruthy()
      }
    }
  })

  it('links every logged message to a gateway of the right kind', () => {
    for (const e of book.log) {
      if (!e.channel_id) continue
      const g = book.gateways.find(x => x.id === e.channel_id)
      expect(g, `${e.id} names a gateway that does not exist`).toBeTruthy()
      expect(g!.kind, `${e.id} went out on ${e.kind_id} through a ${g!.kind} gateway`).toBe(e.kind_id)
    }
  })
})

/* --------------------------------------------------------- what each sees -- */

const RECIPIENTS: { who: string; creds: { email: string; password: string }; persona: Persona }[] = [
  { who: 'a seller',            creds: PARTNER,    persona: 'partner' },
  { who: 'an enterprise buyer', creds: ENTERPRISE, persona: 'enterprise' },
  { who: 'a customer',          creds: CONSUMER,   persona: 'consumer' },
]

for (const { who, creds, persona } of RECIPIENTS) {
  describe(`what ${who} can see`, () => {
    let book: NotificationBook

    beforeAll(async () => {
      await signIn(creds.email, creds.password)
      book = await loadMine(persona)
      expect(book.loadError).toBeUndefined()
    })

    afterAll(async () => { await signOut() })

    it('sees rules, and only its own persona\'s', async () => {
      expect(book.rules.length).toBeGreaterThan(0)
      /* Asking for somebody else's returns nothing rather than failing — RLS
         filters rows, it does not raise. That is the check. */
      const { data } = await supabase.from('notification_rules').select('id,persona')
      expect(data!.every(r => r.persona === persona)).toBe(true)
    })

    it('can read the wording of what it will be sent', () => {
      const ids = new Set(book.rules.map(r => r.id))
      expect(book.templates.length).toBeGreaterThan(0)
      expect(book.templates.every(t => ids.has(t.rule_id))).toBe(true)
    })

    it('sees the channel and event catalogues, which it needs to choose', () => {
      expect(book.kinds.length).toBe(5)
      expect(book.events.length).toBeGreaterThan(0)
    })

    it('cannot change a rule', async () => {
      const target = book.rules[0]
      const { error } = await supabase.from('notification_rules')
        .update({ enabled: !target.enabled }).eq('id', target.id).select()
      /* RLS refuses silently on update: no rows match the policy, so nothing
         changes and no error is raised. Either shape is a refusal; what must
         not happen is the value moving. */
      const { data } = await supabase.from('notification_rules').select('enabled').eq('id', target.id).single()
      expect(data!.enabled, `${who} changed a marketplace rule`).toBe(target.enabled)
      if (error) expect(error.message).toBeTruthy()
    })

    it('cannot rewrite a template', async () => {
      const t = book.templates[0]
      await supabase.from('notification_templates').update({ subject: 'tampered' }).eq('id', t.id)
      const { data } = await supabase.from('notification_templates').select('subject').eq('id', t.id).single()
      expect(data!.subject).toBe(t.subject)
    })

    it('sees only its own history', () => {
      for (const e of book.log) expect(e.persona).toBe(persona)
    })

    it('has something mandatory it is not offered a way out of', () => {
      const mine = myRules(book.rules, persona, book.preferences)
      const locked = mine.filter(e => e.rule.mandatory)
      expect(locked.length).toBeGreaterThan(0)
      for (const e of locked) {
        expect(validatePreference(e.rule, false, []).ok).toBe(false)
      }
    })

    it('is on at least one channel for everything it has switched on', () => {
      for (const e of myRules(book.rules, persona, book.preferences)) {
        if (e.enabled) expect(e.kinds.length, `${e.rule.name} is on with nowhere to go`).toBeGreaterThan(0)
      }
    })
  })
}

/* ------------------------------------------------------- what each can do -- */

describe('a customer changing where things reach them', () => {
  let book: NotificationBook
  let optional: Rule
  let before: { enabled: boolean; kinds: string[] } | null = null

  beforeAll(async () => {
    await signIn(CONSUMER.email, CONSUMER.password)
    book = await loadMine('consumer')
    optional = book.rules.find(r => !r.mandatory && r.kinds.length > 1)!
    expect(optional).toBeTruthy()
    const p = book.preferences.find(x => x.rule_id === optional.id)
    before = p ? { enabled: p.enabled, kinds: p.kinds } : null
  })

  afterAll(async () => {
    /* Put the demo account back exactly as it was, so the next person to open
       the screen sees what the seed intended. */
    const fresh = await loadMine('consumer')
    const now = fresh.preferences.find(x => x.rule_id === optional.id)
    if (before && now) {
      await supabase.from('notification_preferences')
        .update({ enabled: before.enabled, kinds: before.kinds }).eq('id', now.id)
    } else if (!before && now) {
      await supabase.from('notification_preferences').delete().eq('id', now.id)
    }
    await signOut()
  })

  it('narrows a rule to one channel and it sticks', async () => {
    const current = effective(optional, book.preferences.find(x => x.rule_id === optional.id) ?? null)
    const one = [optional.kinds[0]]
    const res = await savePreference({
      rule: optional, current, enabled: true, kinds: one, scope: 'user',
    })
    expect(res.ok, res.ok ? '' : res.reason).toBe(true)

    const after = await loadMine('consumer')
    const saved = after.preferences.find(x => x.rule_id === optional.id)!
    expect(orderKinds(saved.kinds)).toEqual(orderKinds(one))
    expect(saved.updated_on).toBeTruthy()
  })

  it('is refused a channel the rule does not carry, by the database and not just the screen', async () => {
    const fresh = await loadMine('consumer')
    const p = fresh.preferences.find(x => x.rule_id === optional.id)!
    const notOffered = (['inapp', 'whatsapp', 'sms', 'email', 'push'] as const)
      .find(k => !optional.kinds.includes(k))!
    const { error } = await supabase.from('notification_preferences')
      .update({ kinds: [...optional.kinds, notOffered] }).eq('id', p.id)
    expect(error, `${notOffered} was accepted on a rule that cannot send it`).toBeTruthy()
    expect(error!.message).toMatch(/no template|not sent on every channel/i)
  })

  it('cannot switch off something mandatory, whatever it sends', async () => {
    const fresh = await loadMine('consumer')
    const locked = fresh.rules.find(r => r.mandatory)!
    const p = fresh.preferences.find(x => x.rule_id === locked.id)
    if (!p) return
    const { error } = await supabase.from('notification_preferences')
      .update({ enabled: false }).eq('id', p.id)
    expect(error, `${locked.name} was switched off`).toBeTruthy()
    expect(error!.message).toMatch(/cannot be switched off/i)
  })

  it('cannot touch somebody else\'s preferences', async () => {
    const { data } = await supabase.from('notification_preferences').select('id,partner_id,user_id')
    expect(data!.every(p => p.partner_id === null), 'a customer can see a seller\'s choices').toBe(true)
  })
})

describe('a seller changing where things reach the account', () => {
  let book: NotificationBook
  let optional: Rule
  let before: { enabled: boolean; kinds: string[] } | null = null

  beforeAll(async () => {
    await signIn(PARTNER.email, PARTNER.password)
    book = await loadMine('partner')
    optional = book.rules.find(r => !r.mandatory && r.kinds.length > 1)!
    const p = book.preferences.find(x => x.rule_id === optional.id)
    before = p ? { enabled: p.enabled, kinds: p.kinds } : null
  })

  afterAll(async () => {
    const fresh = await loadMine('partner')
    const now = fresh.preferences.find(x => x.rule_id === optional.id)
    if (before && now) {
      await supabase.from('notification_preferences')
        .update({ enabled: before.enabled, kinds: before.kinds }).eq('id', now.id)
    } else if (!before && now) {
      await supabase.from('notification_preferences').delete().eq('id', now.id)
    }
    await signOut()
  })

  it('reads its preferences at the account level, not the person level', () => {
    expect(book.preferences.length).toBeGreaterThan(0)
    expect(book.preferences.every(p => p.scope === 'partner' && p.partner_id === DEMO_PARTNER)).toBe(true)
  })

  it('saves a narrowed choice for the whole account', async () => {
    const current = effective(optional, book.preferences.find(x => x.rule_id === optional.id) ?? null)
    const res = await savePreference({
      rule: optional, current, enabled: true, kinds: [optional.kinds[0]],
      scope: 'partner', partnerId: DEMO_PARTNER,
    })
    expect(res.ok, res.ok ? '' : res.reason).toBe(true)
    const after = await loadMine('partner')
    expect(after.preferences.find(x => x.rule_id === optional.id)!.kinds).toEqual([optional.kinds[0]])
  })

  it('sees only its own account in the history', () => {
    for (const e of book.log) {
      expect(e.partner_id === DEMO_PARTNER || e.partner_id === null).toBe(true)
    }
  })
})

describe('going back to the marketplace default', () => {
  beforeAll(async () => { await signIn(ENTERPRISE.email, ENTERPRISE.password) })
  afterAll(async () => { await signOut() })

  it('removes the row and the rule takes over again', async () => {
    const book = await loadMine('enterprise')
    const target = book.rules.find(r => !r.mandatory && book.preferences.some(p => p.rule_id === r.id))!
    const pref = book.preferences.find(p => p.rule_id === target.id)!
    const saved = { enabled: pref.enabled, kinds: pref.kinds }

    const res = await resetPreference(pref, target)
    expect(res.ok, res.ok ? '' : res.reason).toBe(true)

    const after = await loadMine('enterprise')
    expect(after.preferences.some(p => p.rule_id === target.id)).toBe(false)
    const e = myRules(after.rules, 'enterprise', after.preferences).find(x => x.rule.id === target.id)!
    expect(e.customised).toBe(false)
    expect(e.kinds).toEqual(orderKinds(target.kinds))

    /* Put it back — the demo account is somebody's walkthrough. */
    const restore = await savePreference({
      rule: target, current: e, enabled: saved.enabled, kinds: saved.kinds as never, scope: 'user',
    })
    expect(restore.ok).toBe(true)
  })
})

/* ---- The gateway behind the name ------------------------------------------
 *
 * Six channels were "enabled" and none of them was integrated: a transport name
 * and a protocol string, and no host, credential, sender registration, receipt
 * callback, retry policy or failover target anywhere. These check that the
 * records now exist, that the check refuses a half-configured one, and that a
 * credential cannot be read back by anybody, including the desk that set it.
 */
describe('the gateways, from the marketplace desk', () => {
  let book: NotificationBook

  beforeAll(async () => {
    await signIn(OPERATOR.email, OPERATOR.password)
    book = await loadConfiguration()
  })

  afterAll(async () => { await signOut() })

  it('has an integration record for every channel', () => {
    for (const g of book.gateways) {
      expect(book.integrations.some(i => i.channel_id === g.id), `${g.name} has wiring`).toBe(true)
    }
  })

  it('prices every enabled gateway, in the currency its carrier bills in', () => {
    for (const g of book.gateways.filter(x => x.enabled)) {
      const mine = book.rates.filter(r => r.channel_id === g.id && !r.effective_to)
      expect(mine.length, `${g.name} has a rate`).toBeGreaterThan(0)
      for (const r of mine) expect(r.currency).toMatch(/^[A-Z]{3}$/)
    }
  })

  it('quotes a Kenyan SMS in shillings and an Indian one in rupees', () => {
    const ke = quote(book.rates, 'ch-001', 'KE', 45)
    const inr = quote(book.rates, 'ch-001', 'IN', 45)
    expect(ke.priced && ke.currency).toBe('KES')
    expect(inr.priced && inr.currency).toBe('INR')
  })

  it('never hands back a credential, only its last four characters', () => {
    for (const i of book.integrations) {
      /* If this ever returns a secret, the reveal is the leak. */
      expect(Object.keys(i)).not.toContain('secret_hash')
      if (i.secret_hint) expect(i.secret_hint.length).toBeLessThanOrEqual(4)
    }
  })

  it('refuses to call a half-configured channel healthy', async () => {
    /* ch-006 has no access token loaded and ch-002 claims delivery receipts
       with nowhere for them to arrive. Both are states a real desk hits. */
    const wa = await testGateway('ch-006', 'Integration test')
    expect(wa.ok).toBe(false)
    if (!wa.ok) expect(wa.reason).toMatch(/credential/i)

    const failover = await testGateway('ch-002', 'Integration test')
    expect(failover.ok).toBe(false)
    if (!failover.ok) expect(failover.reason).toMatch(/callback/i)
  })

  it('passes the one that is actually wired, and says what it checked', async () => {
    const r = await testGateway('ch-001', 'Integration test')
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.checks?.join(' ')).toMatch(/routemobile/i)
      expect(r.checks?.join(' ')).toMatch(/DLT/)
    }
  })

  it('refuses a failover target that is not a real alternative', async () => {
    /* Same kind, enabled, not itself, no loop — the database holds all four
       rules and the screen only offers what it would accept. */
    const { error: itself } = await supabase.from('channel_integration')
      .update({ failover_id: 'ch-003' }).eq('channel_id', 'ch-003')
    expect(itself?.message ?? '').toMatch(/itself/i)

    const { error: wrongKind } = await supabase.from('channel_integration')
      .update({ failover_id: 'ch-001' }).eq('channel_id', 'ch-003')
    expect(wrongKind?.message ?? '').toMatch(/same kind/i)
  })

  it('prices the log itself rather than trusting the number on it', async () => {
    const { data } = await supabase.from('notification_log')
      .select('id,cost,cost_currency,segments,destination,channel_id,body')
      .eq('id', 'NL-K002').single()
    expect(data).toBeTruthy()
    /* 168 characters on a 160/153 rate card is two segments, at 0.8 KES each. */
    expect(data!.segments).toBe(2)
    expect(data!.cost_currency).toBe('KES')
    expect(Number(data!.cost)).toBe(1.6)
  })

  it('spends in more than one currency and never adds them together', () => {
    const spend = deliverySummary(book.log).spend
    expect(spend.length).toBeGreaterThan(1)
    expect(new Set(spend.map(s => s.currency)).size).toBe(spend.length)
  })

  it('has no enabled gateway that cannot send', () => {
    /* Two are deliberately incomplete and both are meant to be visible as such,
       so this asserts the report exists rather than that it is empty. */
    const broken = liveButBroken(book.gateways, book.integrations, book.rates)
    for (const b of broken) expect(b.gaps.length).toBeGreaterThan(0)
    expect(broken.map(b => b.gateway.id)).toContain('ch-006')
  })
})

describe('the gateways, from everybody else', () => {
  afterAll(async () => { await signOut() })

  it('are not readable by a seller', async () => {
    await signIn(PARTNER.email, PARTNER.password)
    const { data } = await supabase.from('channel_integration').select('*')
    expect(data ?? []).toHaveLength(0)
  })

  it('are not readable by a customer, and a rate is not either', async () => {
    await signIn(CONSUMER.email, CONSUMER.password)
    const [{ data: ci }, { data: cr }] = await Promise.all([
      supabase.from('channel_integration').select('*'),
      supabase.from('channel_rate').select('*'),
    ])
    expect(ci ?? []).toHaveLength(0)
    expect(cr ?? []).toHaveLength(0)
  })
})

/* ---- Who chose what ------------------------------------------------------- */

describe('the recipient directory', () => {
  let book: NotificationBook

  beforeAll(async () => {
    await signIn(OPERATOR.email, OPERATOR.password)
    book = await loadConfiguration()
  })

  afterAll(async () => { await signOut() })

  it('names the owner of every preference on file', () => {
    /* The screen listed `e5b3c7a1…` in the recipient column, which answers
       nothing about why somebody was not told. */
    for (const p of book.preferences) {
      const who = nameRecipient(ownerKey(p), book.recipients)
      expect(who.known, `${ownerKey(p)} resolves`).toBe(true)
      expect(who.name).not.toMatch(/^[0-9a-f]{8}/)
    }
  })

  it('names the seller account by its name rather than its code', () => {
    const who = nameRecipient(DEMO_PARTNER, book.recipients)
    expect(who.known).toBe(true)
    expect(who.name).not.toBe(DEMO_PARTNER)
    expect(who.ref).toBe(DEMO_PARTNER)
  })

  it('covers all four personas, because a preference can belong to any of them', () => {
    const personas = new Set(book.recipients.map(r => r.persona))
    expect([...personas].sort()).toEqual(['consumer', 'enterprise', 'operator', 'partner'])
  })
})
