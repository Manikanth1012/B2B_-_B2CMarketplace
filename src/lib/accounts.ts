/**
 * The marketplace's customers, as the marketplace sees them.
 *
 * The operator console had Sellers and no Accounts. Enterprise accounts turned
 * up sideways — through Credit & Exposure, through Agreements, through Wallets
 * — each screen showing the slice it needed and none of them answering "who are
 * our customers and where has each of them got to". Retail shoppers appeared
 * nowhere at all.
 *
 * The sharper half was onboarding. `enterprise_onboarding` holds the six steps a
 * company passes to open an account, including the credit assessment the
 * marketplace itself owns and staffs — and it was read by exactly one module,
 * used only by the customer's own console. The desk that owns the gate could not
 * see the gate. Sellers have had a journey rail on the onboarding screen since
 * the beginning; companies had nothing after the accept button.
 *
 * No React and no Supabase in here: shapes, the reduction from steps to a
 * progress figure, and the sentence a desk reads off it.
 */

export type StepState = 'done' | 'due' | 'overdue' | 'blocked' | 'waived'

export interface Step {
  id: string
  account_id: string
  name: string
  detail: string
  state: StepState
  /* Null on the annual credit review, which is a diary entry rather than a
     gate — the ladder says so in its own words: "Opened as a diary entry, not
     something to do now". Counting it towards completeness made every account
     on the book read as part-way through for ever, because a yearly review is
     never finished by design. */
  gate_id: string | null
  done_on: string | null
  done_by: string | null
  due_on: string | null
  sort_order: number
}

export interface Account {
  id: string
  company: string
  legal_name?: string | null
  market: string
  segment: string
  industry?: string | null
  status: string
  terms: string
  currency: string
  sites?: number
  staff?: number
}

export interface CreditFile {
  account_id: string | null
  band: string
  limit_granted: number | null
  currency: string
  next_review: string | null
  reviewed_on: string
}

/* --------------------------------------------------------- where they are -- */

export interface Progress {
  done: number
  of: number
  /* The diary entry, kept apart from the gates. A review that has come round
     again is worth saying, and is not a company failing to onboard. */
  review: Step | null
  /* The step the desk would work on next, or null where nothing is outstanding.
     Overdue first: a step that has run past its date has a better claim on
     somebody's attention than one that has not. */
  next: Step | null
  overdue: number
  complete: boolean
}

const OPEN: StepState[] = ['due', 'overdue', 'blocked']

/** A settled order, so two callers cannot disagree about which step is next. */
export function stepsOf(steps: readonly Step[], accountId: string): Step[] {
  return steps.filter(s => s.account_id === accountId)
    .slice()
    .sort((a, b) => a.sort_order - b.sort_order)
}

export function progressOf(steps: readonly Step[]): Progress {
  /* Gates only. A step with no gate behind it is a diary entry. */
  const gates = steps.filter(s => s.gate_id !== null)
  const review = steps.find(s => s.gate_id === null) ?? null
  const done = gates.filter(s => s.state === 'done' || s.state === 'waived').length
  const open = gates.filter(s => OPEN.includes(s.state))
  const overdue = open.filter(s => s.state === 'overdue')
  return {
    done,
    of: gates.length,
    review,
    next: overdue[0] ?? open[0] ?? null,
    overdue: overdue.length,
    complete: gates.length > 0 && done === gates.length,
  }
}

/**
 * Whether a step has run past its date, whatever the row says.
 *
 * The stored state is what somebody last wrote; the date is what is true. A
 * ladder that only goes overdue when a person marks it overdue is a ladder that
 * never does.
 */
export function isLate(step: Step, today: string): boolean {
  if (step.state === 'done' || step.state === 'waived') return false
  return !!step.due_on && step.due_on < today
}

/** What the desk reads on the row, without opening the account. */
export function whereTheyAre(p: Progress, today: string): string {
  if (p.of === 0) return 'No onboarding record at all'
  if (p.complete) {
    /* Onboarded, and separately overdue a review. Both are true, and the
       second is the one somebody has to do something about. */
    return p.review && (p.review.state === 'overdue' || isLate(p.review, today))
      ? 'Onboarded · credit review overdue'
      : 'Onboarded'
  }
  if (!p.next) return `${p.done} of ${p.of} steps`
  const late = isLate(p.next, today) || p.next.state === 'overdue'
  return `${p.next.name}${late ? ' — overdue' : p.next.due_on ? ` by ${p.next.due_on}` : ''}`
}

/* ------------------------------------------------------------ the counting -- */

export interface Rollup {
  accounts: number
  onboarded: number
  inFlight: number
  overdue: number
  /* Companies who have asked and not been decided. They are not accounts yet
     and are counted apart from them — a queue of decisions is different work
     from a book of customers. */
  waiting: number
}

export function rollup(
  { accounts, steps, waiting, today }: {
    accounts: readonly Account[]; steps: readonly Step[]; waiting: number; today: string
  },
): Rollup {
  let onboarded = 0
  let inFlight = 0
  let overdue = 0
  for (const a of accounts) {
    const p = progressOf(stepsOf(steps, a.id))
    if (p.complete) onboarded++
    else inFlight++
    const late = [p.next, p.review].some(x => !!x && (x.state === 'overdue' || isLate(x, today)))
    if (late) overdue++
  }
  return { accounts: accounts.length, onboarded, inFlight, overdue, waiting }
}

/* --------------------------------------------------------------- searching -- */

export function matches(a: Account, q: string): boolean {
  const t = q.trim().toLowerCase()
  if (!t) return true
  return [a.company, a.legal_name ?? '', a.id, a.market, a.segment, a.industry ?? '']
    .some(v => v.toLowerCase().includes(t))
}

/**
 * Accounts in the order a desk wants them: whoever needs doing something about,
 * first. Overdue, then in flight, then everybody else alphabetically.
 */
export function deskOrder(
  accounts: readonly Account[], steps: readonly Step[], today: string,
): Account[] {
  const rank = (a: Account) => {
    const p = progressOf(stepsOf(steps, a.id))
    if ([p.next, p.review].some(x => !!x && (x.state === 'overdue' || isLate(x, today)))) return 0
    if (!p.complete) return 1
    return 2
  }
  return accounts.slice().sort((a, b) =>
    rank(a) - rank(b) || a.company.localeCompare(b.company))
}

/* --------------------------------------------------------------- customers -- */

export interface Shopper {
  /* The profile's own id, which every row has. `user_id` is the link to a
     login and is null for anybody who has not signed in — four of the seven on
     file. Keying a list on it gave four rows the same key, React collided them,
     and switching tabs left the old rows in the DOM under the new headings. An
     identity that is null for most of the set is not an identity. */
  id: string
  user_id: string | null
  name: string
  email: string | null
  market: string | null
  currency: string | null
  tier: string | null
  points: number
  joined: string | null
}

/** What a retail customer is worth reading as a row. */
export function shopperLine(s: Shopper): string {
  const tier = s.tier ? s.tier[0].toUpperCase() + s.tier.slice(1) : null
  const bits = [s.market, tier ? `${tier} member` : null].filter(Boolean)
  return bits.length ? bits.join(' · ') : 'No market recorded'
}
