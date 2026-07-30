/* Touches the live Supabase project. Reads only.
 *
 * The seller record has three parts that can quietly contradict each other:
 * the partner's status, the gates behind it, and what they are approved and
 * paid to sell. Each of these checks is one of those contradictions, and every
 * one of them was true of this database before the migrations that fixed it —
 * a live partner shown stuck at Bank & tax, a seller in flight with no gate
 * rows at all, and a task chasing somebody who went live in 2024.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { supabase } from './supabase'
import { signIn, signOut } from './authRepo'
import { GATES, SLA_DAYS, deriveTaskState, buildJourney, journeyProgress } from './onboarding'
import type { GateRow, TaskRow, JourneyStep, Submission, GateDocument } from './onboarding'
import { loadOnboarding } from './onboardingRepo'
import { loadPartnerDirectory, loadPartnerDetail } from './partnerRepo'
import { canListIn, rateAt } from './partnerCommerce'

const OPERATOR = { email: 'anika.sharma@aventa.com', password: 'operator123' }
const DEMO_PARTNER = 'PTR-1004'

interface P { id: string; name: string; status: string; joined: string; plan_id: string | null }

let partners: P[] = []
let gates: (GateRow & { partner_id: string; target_days: number })[] = []

beforeAll(async () => {
  await signIn(OPERATOR.email, OPERATOR.password)
  const [p, g] = await Promise.all([
    supabase.from('partners').select('id,name,status,joined,plan_id'),
    supabase.from('onboarding_gates').select('*'),
  ])
  partners = (p.data ?? []) as P[]
  gates = (g.data ?? []) as typeof gates
  expect(partners.length).toBeGreaterThan(0)
})

afterAll(async () => { await signOut() })

const gatesFor = (id: string) => gates.filter(g => g.partner_id === id)

describe('a partner and its onboarding record', () => {
  it('gives every partner all seven gates', () => {
    for (const p of partners) {
      expect(gatesFor(p.id).length, `${p.name} has the wrong number of gates`).toBe(GATES.length)
    }
  })

  /* The defect this whole migration exists to remove: Nimbus Sensors has been
     live since September 2024 and the console showed it awaiting a bank
     verification. A partner with no live application came through long ago. */
  it('shows no open gate on a partner that is already trading', () => {
    for (const p of partners.filter(x => x.status === 'live' || x.status === 'suspended')) {
      const open = gatesFor(p.id).filter(g => g.status === 'current' || g.status === 'failed')
      expect(open.map(g => g.gate_name), `${p.name} is ${p.status} but has an open gate`).toEqual([])
    }
  })

  it('gives every seller still applying exactly one gate to act on', () => {
    for (const p of partners.filter(x => x.status === 'onboarding' || x.status === 'review')) {
      const open = gatesFor(p.id).filter(g => g.status === 'current')
      expect(open.length, `${p.name} is ${p.status} but has ${open.length} current gates`).toBe(1)
    }
  })

  it('records a stopped application as failed rather than merely unfinished', () => {
    for (const p of partners.filter(x => x.status === 'rejected')) {
      expect(gatesFor(p.id).filter(g => g.status === 'failed').length, `${p.name}`).toBe(1)
    }
  })

  /* The published SLA and the ladder it is the sum of. */
  it('keeps the gate targets summing to the published SLA', () => {
    for (const p of partners) {
      const sum = gatesFor(p.id).reduce((n, g) => n + g.target_days, 0)
      expect(sum, `${p.name}'s ladder promises ${sum} days, not ${SLA_DAYS}`).toBe(SLA_DAYS)
    }
  })
})

describe('what was submitted at each gate', () => {
  it('has a submission for every gate reached and none for a gate that was not', async () => {
    const [subs, docs] = await Promise.all([
      supabase.from('onboarding_submissions').select('*'),
      supabase.from('onboarding_documents').select('*'),
    ])
    const submissions = (subs.data ?? []) as Submission[]
    const documents = (docs.data ?? []) as GateDocument[]

    for (const g of gates) {
      const has = submissions.some(s => s.gate_id === g.id)
      expect(has, `${g.partner_id} ${g.gate_name} (${g.status})`).toBe(g.status !== 'pending')
    }
    /* And nothing is attached to a gate nobody reached. */
    const pendingIds = new Set(gates.filter(g => g.status === 'pending').map(g => g.id))
    expect(documents.filter(d => pendingIds.has(d.gate_id))).toEqual([])
  })

  /* The demo partner is the one anybody opening this project looks at first. */
  it('gives the demo partner a complete, cleared record with documents on it', async () => {
    const snap = await loadOnboarding(DEMO_PARTNER)
    expect(snap.loadError).toBeUndefined()

    const progress = journeyProgress(snap.journey)
    expect(progress.complete).toBe(true)
    expect(progress.cleared).toBe(GATES.length)

    for (const step of snap.journey) {
      expect(step.submission, `${step.gate.name} has no submission`).toBeTruthy()
      expect(step.submission!.fields.length, `${step.gate.name} submitted nothing`).toBeGreaterThan(3)
      expect(step.documents.length, `${step.gate.name} has no documents`).toBeGreaterThan(0)
      expect(step.row.submitted_by).toBeTruthy()
      expect(step.row.reviewed_by).toBeTruthy()
    }
  })

  /* Onboarding runs forwards. A gate reviewed before it was submitted, or
     submitted before the one in front of it cleared, is a record nobody can
     read as a sequence. */
  it('keeps every journey in chronological order', () => {
    for (const p of partners) {
      const steps = buildJourney(gatesFor(p.id) as JourneyStep['row'][], [], [])
      let previousDecision = 0
      for (const s of steps) {
        if (!s.row.submitted_at) continue
        const submitted = Date.parse(s.row.submitted_at)
        expect(submitted, `${p.name} submitted ${s.gate.name} before the gate before it cleared`)
          .toBeGreaterThanOrEqual(previousDecision)
        if (s.row.reviewed_at) {
          const reviewed = Date.parse(s.row.reviewed_at)
          expect(reviewed, `${p.name} reviewed ${s.gate.name} before it was submitted`).toBeGreaterThanOrEqual(submitted)
          previousDecision = reviewed
        }
      }
    }
  })

  it('lands the demo partner live on the day its partner record says', async () => {
    const p = partners.find(x => x.id === DEMO_PARTNER)!
    const golive = gatesFor(DEMO_PARTNER).find(g => g.gate_name === 'Go-live')!
    expect(new Date(golive.reviewed_at!).toDateString()).toBe(new Date(p.joined).toDateString())
  })
})

describe('outstanding tasks', () => {
  it('chases nobody who has already come through', async () => {
    const { data } = await supabase.from('onboarding_tasks').select('*')
    const tasks = (data ?? []) as TaskRow[]
    expect(tasks.length).toBeGreaterThan(0)

    for (const p of partners.filter(x => x.status === 'live' || x.status === 'suspended')) {
      const mine = tasks.filter(t => t.partner_id === p.id)
      expect(mine.length, `${p.name} has no task ladder`).toBeGreaterThan(0)
      const open = mine.filter(t => deriveTaskState(t, gatesFor(p.id)) !== 'done')
      expect(open.map(t => t.title), `${p.name} is ${p.status} but is being chased`).toEqual([])
    }
  })

  it('gives a seller still applying something to act on', async () => {
    const { data } = await supabase.from('onboarding_tasks').select('*')
    const tasks = (data ?? []) as TaskRow[]
    for (const p of partners.filter(x => x.status === 'onboarding')) {
      const open = tasks.filter(t => t.partner_id === p.id && deriveTaskState(t, gatesFor(p.id)) === 'open')
      expect(open.length, `${p.name} is applying with nothing outstanding`).toBeGreaterThan(0)
    }
  })
})

describe('what a seller may sell, and what they settle on', () => {
  it('never lists a product in a category its seller was not approved for', async () => {
    const dir = await loadPartnerDirectory()
    expect(dir.loadError).toBeUndefined()

    const { data } = await supabase.from('products').select('id,partner_id,category_id').not('partner_id', 'is', null)
    const products = (data ?? []) as { id: string; partner_id: string; category_id: string }[]
    expect(products.length).toBeGreaterThan(0)

    for (const row of products) {
      const seller = dir.rows.find(r => r.id === row.partner_id)
      expect(seller, `${row.id} names a seller that does not exist`).toBeTruthy()
      expect(seller!.categories, `${row.id} sits in ${row.category_id}, which ${seller!.name} was not approved for`)
        .toContain(row.category_id)
    }
  })

  it('refuses the demo partner a category nobody approved', async () => {
    const detail = await loadPartnerDetail(DEMO_PARTNER)
    const name = (id: string) => id
    expect(canListIn('iot', detail.approvals, name).ok).toBe(true)
    const refused = canListIn('security', detail.approvals, name)
    expect(refused.ok).toBe(false)
    if (!refused.ok) expect(refused.reason).toMatch(/not approved/i)
  })

  it('settles the demo partner on the plan its agreement names', async () => {
    const detail = await loadPartnerDetail(DEMO_PARTNER)
    expect(detail.plan).toBeTruthy()
    expect(detail.plan!.id).toBe('CP-IOT-STD')
    /* The figure the seller's own console prints. */
    expect(rateAt(detail.plan!, 0)).toBe(11)
  })

  it('gives every trading seller a plan, and the stopped application none', () => {
    for (const p of partners) {
      if (p.status === 'rejected') expect(p.plan_id, `${p.name} was rejected but has a plan`).toBeNull()
      else expect(p.plan_id, `${p.name} is ${p.status} with nothing to settle on`).toBeTruthy()
    }
  })
})

describe('lifecycle history', () => {
  it('ends on the status the partner record shows', async () => {
    const { data } = await supabase.from('partner_lifecycle_events').select('*')
    const events = (data ?? []) as { partner_id: string; to_status: string; at: string; reason: string }[]

    for (const p of partners) {
      const mine = events.filter(e => e.partner_id === p.id).sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
      expect(mine.length, `${p.name} has no lifecycle history`).toBeGreaterThan(0)
      expect(mine[mine.length - 1].to_status, `${p.name}'s history disagrees with its status`).toBe(p.status)
      /* A status change nobody stated a ground for is one the seller cannot
         answer and the marketplace cannot defend. */
      mine.forEach(e => expect(e.reason.trim().length, `${p.name} has an unexplained move`).toBeGreaterThan(10))
    }
  })
})
