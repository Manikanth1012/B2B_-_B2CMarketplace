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

/* ------------------------------------------ category-level onboarding ---- */

describe('what each marketplace demands', () => {
  it('enforces sanctions screening in every category and never downgrades it', async () => {
    const [{ data: cats }, { data: matrix }] = await Promise.all([
      supabase.from('categories').select('id'),
      supabase.from('category_policy_rules').select('*'),
    ])
    const rules = (matrix ?? []) as { category_id: string; rule_id: string; level: string }[]
    for (const c of (cats ?? []) as { id: string }[]) {
      const screen = rules.find(r => r.category_id === c.id && r.rule_id === 'PR-10')
      expect(screen, `${c.id} does not screen sellers at all`).toBeTruthy()
      expect(screen!.level, `${c.id} downgraded sanctions screening`).toBe('enforce')
    }
  })

  it('gives every category a policy and every active rule a category', async () => {
    const [{ data: cats }, { data: pol }, { data: rules }, { data: matrix }] = await Promise.all([
      supabase.from('categories').select('id'),
      supabase.from('category_policy').select('category_id'),
      supabase.from('policy_rules').select('id,status'),
      supabase.from('category_policy_rules').select('rule_id'),
    ])
    const covered = new Set(((pol ?? []) as { category_id: string }[]).map(p => p.category_id))
    for (const c of (cats ?? []) as { id: string }[]) {
      expect(covered.has(c.id), `${c.id} has no listing policy`).toBe(true)
    }
    const used = new Set(((matrix ?? []) as { rule_id: string }[]).map(m => m.rule_id))
    for (const r of (rules ?? []) as { id: string; status: string }[]) {
      if (r.status === 'active') expect(used.has(r.id), `${r.id} is active but applied nowhere`).toBe(true)
    }
  })

  /* The evidence pack must follow the matrix. A seller in two categories
     answers each category's rules, which is the whole point of doing this per
     category rather than once per company. */
  it('asks each seller for exactly what their categories demand', async () => {
    const [{ data: pcs }, { data: matrix }, { data: ev }] = await Promise.all([
      supabase.from('partner_categories').select('partner_id,category_id'),
      supabase.from('category_policy_rules').select('*'),
      supabase.from('partner_category_evidence').select('partner_id,category_id,rule_id,state'),
    ])
    const rules = (matrix ?? []) as { category_id: string; rule_id: string; level: string }[]
    const evidence = (ev ?? []) as { partner_id: string; category_id: string; rule_id: string; state: string }[]

    for (const pc of (pcs ?? []) as { partner_id: string; category_id: string }[]) {
      const expected = rules.filter(r => r.category_id === pc.category_id && r.level !== 'off').map(r => r.rule_id).sort()
      const actual = evidence
        .filter(e => e.partner_id === pc.partner_id && e.category_id === pc.category_id)
        .map(e => e.rule_id).sort()
      expect(actual, `${pc.partner_id} in ${pc.category_id}`).toEqual(expected)
    }
  })

  it('holds a category closed while a document rule is outstanding, and opens it otherwise', async () => {
    const [{ data: pcs }, { data: ev }] = await Promise.all([
      supabase.from('partner_categories').select('partner_id,category_id,approved_at'),
      supabase.from('partner_category_evidence').select('partner_id,category_id,state'),
    ])
    const evidence = (ev ?? []) as { partner_id: string; category_id: string; state: string }[]

    for (const pc of (pcs ?? []) as { partner_id: string; category_id: string; approved_at: string | null }[]) {
      const outstanding = evidence.filter(e =>
        e.partner_id === pc.partner_id && e.category_id === pc.category_id && e.state === 'outstanding')
      if (pc.approved_at === null) {
        expect(outstanding.length, `${pc.partner_id}/${pc.category_id} is unapproved with nothing outstanding`)
          .toBeGreaterThan(0)
      } else {
        expect(outstanding.map(o => o.state), `${pc.partner_id}/${pc.category_id} is approved with something outstanding`)
          .toEqual([])
      }
    }
  })

  /* A marketplace where nothing ever lapses cannot show what happens when
     something does, and an expiring type approval is the commonest real reason
     a live seller stops being able to list in a market. */
  it('carries at least one lapsed certificate, recorded as lapsed rather than in force', async () => {
    const { data } = await supabase.from('partner_category_evidence')
      .select('partner_id,category_id,rule_id,state,expires_on,note').not('expires_on', 'is', null)
    const rows = (data ?? []) as { state: string; expires_on: string; note: string | null }[]
    const lapsed = rows.filter(r => Date.parse(r.expires_on) < Date.now())
    expect(lapsed.length, 'nothing has ever expired').toBeGreaterThan(0)
    lapsed.forEach(r => {
      expect(r.state, 'an expired document is still recorded as accepted').not.toBe('accepted')
      expect(r.note, 'an expired document with no explanation').toBeTruthy()
    })
  })
})

describe('tiers', () => {
  it('puts every seller on a tier that exists, on a ladder that ascends', async () => {
    const [{ data: tiers }, { data: ps }] = await Promise.all([
      supabase.from('partner_tiers').select('*').order('rank'),
      supabase.from('partners').select('id,name,tier_id'),
    ])
    const ladder = (tiers ?? []) as { id: string; rank: number; qualify_gross: number; benefits: string[] }[]
    expect(ladder.length).toBeGreaterThan(1)

    const ids = new Set(ladder.map(t => t.id))
    for (const p of (ps ?? []) as { name: string; tier_id: string }[]) {
      expect(ids.has(p.tier_id), `${p.name} is on tier "${p.tier_id}", which does not exist`).toBe(true)
    }
    for (let i = 1; i < ladder.length; i++) {
      expect(ladder[i].qualify_gross, 'the ladder does not ascend').toBeGreaterThan(ladder[i - 1].qualify_gross)
    }
    /* A tier that carries no consequence is decoration. */
    ladder.forEach(t => expect(t.benefits.length, `${t.id} promises nothing`).toBeGreaterThan(0))
  })
})

describe('settlement statements', () => {
  it('makes every bill out to a seller that exists, under the name they trade as', async () => {
    const [{ data: st }, { data: ps }] = await Promise.all([
      supabase.from('settlement_statements').select('*'),
      supabase.from('partners').select('id,name'),
    ])
    const statements = (st ?? []) as { id: string; partner_id: string | null; partner_name: string }[]
    expect(statements.length).toBeGreaterThan(0)
    const byId = new Map(((ps ?? []) as { id: string; name: string }[]).map(p => [p.id, p.name]))

    for (const s of statements) {
      if (s.partner_id === null) continue
      expect(byId.get(s.partner_id), `${s.id} names a seller that does not exist`).toBe(s.partner_name)
    }
  })

  it('charges the rate on the plan the seller counter-signed', async () => {
    const { data } = await supabase.from('settlement_statements')
      .select('id,commission_rate,plan:commission_plans(id,base_rate)')
      .returns<{ id: string; commission_rate: number; plan: { id: string; base_rate: number } | null }[]>()
    for (const s of data ?? []) {
      if (!s.plan) continue
      expect(Number(s.commission_rate), `${s.id} charges a rate the seller never agreed`).toBe(Number(s.plan.base_rate))
    }
  })

  it('reconciles gross to net on every row', async () => {
    const { data } = await supabase.from('settlement_statements').select('*')
    for (const s of (data ?? []) as Record<string, number & string>[]) {
      const stack = Number(s.gross) - Number(s.commission) - Number(s.fees) - Number(s.withholding) - Number(s.refunds)
      expect(Math.abs(Number(s.net) - stack), `${s.id} does not reconcile`).toBeLessThan(0.02)
      expect(Number(s.net), `${s.id} settles to a negative payout`).toBeGreaterThanOrEqual(0)
    }
  })

  /* Two screens quoting different gross values for the same month, neither of
     them wrong, is the failure this pins shut. */
  it('sums each period to the month the operator dashboard shows', async () => {
    const [{ data: st }, { data: months }] = await Promise.all([
      supabase.from('settlement_statements').select('period,gross'),
      supabase.from('operator_monthly').select('month,gross'),
    ])
    const byPeriod = new Map<string, number>()
    for (const s of (st ?? []) as { period: string; gross: number }[]) {
      byPeriod.set(s.period, (byPeriod.get(s.period) ?? 0) + Number(s.gross))
    }
    expect(byPeriod.size).toBeGreaterThan(1)
    for (const [period, billed] of byPeriod) {
      const month = ((months ?? []) as { month: string; gross: number }[]).find(m => m.month === period)
      expect(month, `${period} is billed but is not on the dashboard series`).toBeTruthy()
      expect(Math.abs(billed - Number(month!.gross)), `${period} disagrees with the dashboard`).toBeLessThan(0.02)
    }
  })

  it('gives every trading seller a history worth opening', async () => {
    const [{ data: st }, { data: ps }, { data: prods }] = await Promise.all([
      supabase.from('settlement_statements').select('partner_id'),
      supabase.from('partners').select('id,name,status'),
      supabase.from('products').select('partner_id').eq('status', 'live').not('partner_id', 'is', null),
    ])
    const counted = new Set(((st ?? []) as { partner_id: string | null }[]).map(s => s.partner_id))
    const sells = new Set(((prods ?? []) as { partner_id: string }[]).map(p => p.partner_id))

    for (const p of (ps ?? []) as { id: string; name: string; status: string }[]) {
      /* A seller with nothing *on sale* has nothing to settle — that is an
         answer, not a gap. Beacon Reseller Co is the case: live, with its first
         listing still in the review queue and therefore no share of any month. */
      if (p.status !== 'live' || !sells.has(p.id)) continue
      expect(counted.has(p.id), `${p.name} is trading with no statements`).toBe(true)
    }
  })
})
