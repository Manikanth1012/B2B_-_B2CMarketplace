/* Touches the live Supabase project.
 *
 * The claim being tested is that there is now one queue. A ticket a customer
 * raises in the self-care portal has to reach the desk that works it, an
 * enterprise account has to see everything raised by anyone on it and nothing
 * raised by anyone else, and none of them may edit the numbers the desk is
 * measured on. All three live in RLS and a trigger, so all three are checked
 * from a client.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { supabase } from './supabase'
import { signIn, signOut } from './authRepo'
import { loadAccount } from './enterpriseRepo'
import {
  loadSupport, raiseTicket, replyToTicket, resolveTicket, confirmResolved, reopenTicket,
} from './supportRepo'
import type { SupportBook } from './supportRepo'
import { summarise, isOpen, pastTarget, workedMinutes, standing, priorityFor, categoriesFor } from './support'

const ENTERPRISE = { email: 'vikram.shah@smartbuild.in', password: 'enterprise123' }
const OPERATOR   = { email: 'anika.sharma@aventa.com',   password: 'operator123' }
const CONSUMER   = { email: 'priya.raman@example.com',   password: 'demo1234' }
const PARTNER    = { email: 'rajesh.kumar@nimbussensors.com', password: 'partner123' }
const NOW = new Date()

describe('the marketplace\'s queue', () => {
  let book: SupportBook

  beforeAll(async () => {
    await signIn(OPERATOR.email, OPERATOR.password)
    book = await loadSupport()
    expect(book.loadError).toBeUndefined()
  })

  afterAll(async () => { await signOut() })

  it('holds tickets from every persona, in one place', () => {
    const personas = new Set(book.tickets.map(t => t.persona))
    expect(personas.size).toBeGreaterThanOrEqual(3)
    expect(book.tickets.length).toBeGreaterThan(10)
  })

  it('has an SLA policy and a category list behind it', () => {
    expect(book.sla.length).toBe(4)
    expect(book.categories.length).toBeGreaterThan(5)
  })

  it('holds every ticket to the target its priority sets, not one typed on the row', () => {
    for (const t of book.tickets) {
      const sla = book.sla.find(s => s.priority === t.priority)!
      expect(sla, `${t.id} has priority ${t.priority}`).toBeTruthy()
      expect(t.sla_mins, `${t.id}`).toBe(sla.resolve_mins)
    }
  })

  it('puts every ticket in a category that exists', () => {
    const known = new Set(book.categories.map(c => c.id))
    for (const t of book.tickets) expect(known.has(t.category), `${t.id} is in ${t.category}`).toBe(true)
  })

  it('gives every closed ticket a resolution', () => {
    for (const t of book.tickets.filter(t => !isOpen(t))) {
      expect(t.resolution_note, `${t.id}`).toBeTruthy()
    }
  })

  it('ties every ticket to somebody the marketplace deals with', () => {
    for (const t of book.tickets) {
      if (t.persona === 'operator') continue
      expect(
        t.account_id || t.partner_id || t.user_id,
        `${t.id} from ${t.org} belongs to nobody`,
      ).toBeTruthy()
    }
  })

  it('measures a paused ticket on worked time rather than elapsed', () => {
    const paused = book.tickets.find(t => t.waiting_on_customer && t.waiting_since)
    expect(paused, 'nothing is waiting on a requester').toBeTruthy()
    const elapsed = Math.floor((NOW.getTime() - Date.parse(paused!.opened_at)) / 60000)
    expect(workedMinutes(paused!, NOW)).toBeLessThan(elapsed)
    expect(pastTarget(paused!, NOW)).toBe(false)
    expect(standing(paused!, NOW).state).toBe('paused')
  })
})

/* --------------------------------------------------------- the account -- */

describe('the enterprise account\'s queue', () => {
  let book: SupportBook

  beforeAll(async () => {
    await signIn(ENTERPRISE.email, ENTERPRISE.password)
    book = await loadSupport()
    expect(book.loadError).toBeUndefined()
  })

  afterAll(async () => { await signOut() })

  it('sees its own tickets and nobody else\'s', () => {
    expect(book.tickets.length).toBeGreaterThan(3)
    expect(book.tickets.every(t => t.account_id === 'ENT-2007')).toBe(true)
  })

  it('sees tickets raised by colleagues, because support is a shared inbox', () => {
    const raisers = new Set(book.tickets.map(t => t.opened_by))
    expect(raisers.size).toBeGreaterThan(1)
  })

  it('has the three cases the screen exists to explain', () => {
    const s = summarise(book.tickets, NOW)
    expect(s.open).toBeGreaterThan(0)
    expect(s.waiting).toBeGreaterThan(0)
    expect(s.resolved).toBeGreaterThan(1)
    expect(book.tickets.some(t => t.status === 'escalated')).toBe(true)
  })

  it('is offered categories a business has and a customer does not', () => {
    const mine = categoriesFor(book.categories, 'enterprise').map(c => c.id)
    expect(mine).toContain('licensing')
    expect(categoriesFor(book.categories, 'consumer').map(c => c.id)).not.toContain('licensing')
  })

  it('cannot give itself a longer target', async () => {
    const t = book.tickets[0]
    await supabase.from('support_tickets').update({ sla_mins: 99999, priority: 'P4' }).eq('id', t.id)
    const after = await loadSupport()
    const saved = after.tickets.find(x => x.id === t.id)!
    expect(saved.sla_mins).toBe(t.sla_mins)
    expect(saved.priority).toBe(t.priority)
  })

  it('cannot un-escalate itself or clear a breach', async () => {
    const t = book.tickets.find(x => x.status === 'escalated')!
    await supabase.from('support_tickets').update({ escalated: false, breached: false }).eq('id', t.id)
    const after = await loadSupport()
    const saved = after.tickets.find(x => x.id === t.id)!
    expect(saved.escalated).toBe(true)
  })

  it('cannot reassign a ticket to a team of its choosing', async () => {
    const t = book.tickets[0]
    await supabase.from('support_tickets').update({ owner: 'Somebody senior' }).eq('id', t.id)
    const after = await loadSupport()
    expect(after.tickets.find(x => x.id === t.id)!.owner).toBe(t.owner)
  })

  it('cannot close one with no resolution', async () => {
    const t = book.tickets.find(x => isOpen(x))!
    const { error } = await supabase.from('support_tickets')
      .update({ status: 'resolved' }).eq('id', t.id)
    expect(error, 'a ticket was closed with no note').toBeTruthy()
    expect(error!.message).toMatch(/say what resolved it/i)
  })
})

describe('isolation', () => {
  afterAll(async () => { await signOut() })

  it('shows a seller its own tickets and no account\'s', async () => {
    await signIn(PARTNER.email, PARTNER.password)
    const { data } = await supabase.from('support_tickets').select('id,partner_id,account_id')
    expect(data!.length).toBeGreaterThan(0)
    expect(data!.every(t => t.partner_id === 'PTR-1004')).toBe(true)
    await signOut()
  })

  it('shows a customer their own and not the account\'s', async () => {
    await signIn(CONSUMER.email, CONSUMER.password)
    const { data } = await supabase.from('support_tickets').select('id,user_id,account_id')
    expect(data!.every(t => t.account_id === null)).toBe(true)
    await signOut()
  })
})

/* ---------------------------------------------------------- raising it -- */

describe('raising, replying and closing', () => {
  let book: SupportBook
  let account: Awaited<ReturnType<typeof loadAccount>>
  let raised: string | null = null

  beforeAll(async () => {
    await signIn(ENTERPRISE.email, ENTERPRISE.password)
    book = await loadSupport()
    account = await loadAccount()
  })

  afterAll(async () => {
    await signOut()
    await signIn(OPERATOR.email, OPERATOR.password)
    if (raised) await supabase.from('support_tickets').delete().eq('id', raised)
    await signOut()
  })

  it('refuses a description too short to act on', async () => {
    const res = await raiseTicket({
      draft: { subject: 'Broken', category: 'service', note: 'help', ref: null },
      book, persona: 'enterprise', raisedBy: account.me!.name,
      org: account.account!.company, accountId: 'ENT-2007',
      memberId: account.me!.id, channel: 'Enterprise portal',
    })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.reason).toMatch(/only what you write here/)
  })

  it('raises one, and the database sets the target rather than the caller', async () => {
    const res = await raiseTicket({
      draft: {
        subject: 'Integration test — seats will not assign',
        category: 'licensing',
        note: 'Twenty of the ZTNA seats will not assign to users in the Pune directory.',
        ref: 'SUB-7782',
      },
      book, persona: 'enterprise', raisedBy: account.me!.name,
      org: account.account!.company, accountId: 'ENT-2007',
      memberId: account.me!.id, channel: 'Enterprise portal',
    })
    expect(res.ok, res.ok ? '' : res.reason).toBe(true)

    const after = await loadSupport()
    const mine = after.tickets.find(t => t.subject.startsWith('Integration test'))!
    expect(mine).toBeTruthy()
    raised = mine.id

    /* The caller sent sla_mins: 0. The policy decides. */
    const expected = after.sla.find(s => s.priority === priorityFor('licensing', after.categories))!
    expect(mine.priority).toBe(expected.priority)
    expect(mine.sla_mins).toBe(expected.resolve_mins)
    expect(mine.status).toBe('new')
    expect(mine.account_id).toBe('ENT-2007')
    expect(mine.breached).toBe(false)
    expect(mine.messages.length).toBe(1)
  })

  it('adds to the thread', async () => {
    const fresh = await loadSupport()
    const mine = fresh.tickets.find(t => t.id === raised)!
    const res = await replyToTicket(mine, 'The directory sync finished this morning, still failing.', account.me!.name)
    expect(res.ok, res.ok ? '' : res.reason).toBe(true)

    const after = await loadSupport()
    expect(after.tickets.find(t => t.id === raised)!.messages.length).toBe(2)
  })

  it('resolves it with a note, and refuses one without', async () => {
    const fresh = await loadSupport()
    const mine = fresh.tickets.find(t => t.id === raised)!

    const bad = await resolveTicket(mine, '  ', account.me!.name)
    expect(bad.ok).toBe(false)

    const good = await resolveTicket(mine, 'Resolved — the seats needed the directory group mapping, now applied.', account.me!.name)
    expect(good.ok, good.ok ? '' : good.reason).toBe(true)

    const after = await loadSupport()
    const saved = after.tickets.find(t => t.id === raised)!
    /* Resolved, not closed. The desk's word starts a window; it does not end
       the ticket. */
    expect(saved.status).toBe('resolved')
    expect(saved.resolution_note).toMatch(/directory group mapping/)
    expect(saved.resolved_at).toBeTruthy()
    expect(saved.confirm_due).toBeTruthy()
    expect(saved.closed_how).toBeNull()
    expect(isOpen(saved)).toBe(false)
  })

  it('sends it back when it was not fixed, and counts the bounce', async () => {
    const fresh = await loadSupport()
    const mine = fresh.tickets.find(t => t.id === raised)!
    expect(mine.status).toBe('resolved')

    const sent = await reopenTicket(mine, 'Four of the twelve seats still cannot sign in.', account.me!.name)
    expect(sent.ok, sent.ok ? '' : sent.reason).toBe(true)

    const after = await loadSupport()
    const saved = after.tickets.find(t => t.id === raised)!
    expect(saved.status).toBe('open')
    expect(saved.reopened).toBe(1)
    expect(saved.confirm_due).toBeNull()
    expect(saved.resolution_note).toBeNull()
    expect(saved.messages.at(-1)!.text).toMatch(/^Not resolved: /)
  })

  it('closes only when the account says so, and records that it did', async () => {
    const fresh = await loadSupport()
    const mine = fresh.tickets.find(t => t.id === raised)!

    /* A ticket cannot jump from open to closed — the desk answers it first. */
    const early = await confirmResolved(mine, account.me!.name)
    expect(early.ok).toBe(false)

    await resolveTicket(mine, 'Mapped the second directory group as well.', account.me!.name)
    const mid = await loadSupport()
    const done = await confirmResolved(mid.tickets.find(t => t.id === raised)!, account.me!.name)
    expect(done.ok, done.ok ? '' : done.reason).toBe(true)

    const after = await loadSupport()
    const saved = after.tickets.find(t => t.id === raised)!
    expect(saved.status).toBe('closed')
    expect(saved.closed_how).toBe('confirmed')
    expect(saved.confirmed_by).toBe(account.me!.name)
    expect(saved.confirmed_at).toBeTruthy()
    /* The bounce from the previous test is still on the record. */
    expect(saved.reopened).toBe(1)
  })
})

/* --------------------------------------------- a customer reaches the desk */

describe('a ticket raised in the self-care portal', () => {
  let raised: string | null = null

  afterAll(async () => {
    await signOut()
    await signIn(OPERATOR.email, OPERATOR.password)
    if (raised) await supabase.from('support_tickets').delete().eq('id', raised)
    await signOut()
  })

  it('reaches the queue the marketplace actually works', async () => {
    await signIn(CONSUMER.email, CONSUMER.password)
    const book = await loadSupport()
    const res = await raiseTicket({
      draft: {
        subject: 'Integration test — parcel never arrived',
        category: 'delivery',
        note: 'Tracking says delivered but nothing was left and nobody signed for it.',
        ref: null,
      },
      book, persona: 'consumer', raisedBy: 'Priya Raman', org: 'Consumer',
      accountId: null, memberId: null, channel: 'Self-care portal',
    })
    expect(res.ok, res.ok ? '' : res.reason).toBe(true)

    const mine = (await loadSupport()).tickets.find(t => t.subject.startsWith('Integration test'))!
    expect(mine).toBeTruthy()
    raised = mine.id
    expect(mine.user_id).toBeTruthy()
    await signOut()

    /* The whole point: the desk can see it. */
    await signIn(OPERATOR.email, OPERATOR.password)
    const desk = await loadSupport()
    const seen = desk.tickets.find(t => t.id === raised)
    expect(seen, 'a customer\'s ticket never reached the desk').toBeTruthy()
    expect(seen!.persona).toBe('consumer')
    await signOut()
  })
})
