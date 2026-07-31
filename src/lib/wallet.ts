/**
 * Stored value, and the one distinction everything here turns on.
 *
 * A wallet holds two pots that are legally different things:
 *
 *   cash   top-ups and refunds paid in. The customer's own money. They can ask
 *          for it back, and on closure it goes to the instrument that funded it.
 *   promo  reward redemptions and goodwill. The marketplace's own money, already
 *          spent on marketing. Spendable here and nowhere else, never returned.
 *
 * Mixing them is how a platform refunds its own promotional credit to a card.
 * Every function below keeps them apart, and the spend order draws promotional
 * credit down first — so the money that is actually returnable stays returnable
 * for as long as possible, which is the customer-favouring choice.
 */

export type Pot = 'cash' | 'promo'

export interface WalletPolicy {
  max_balance: number
  min_topup: number
  dormancy_months: number
  cash_refundable: string
  non_refundable: string
  dormancy_note: string
}

export interface Wallet {
  id: string
  party: string
  name: string
  kind: 'consumer' | 'enterprise'
  cash: number
  promo: number
  balance: number
  opened: string
  last_move: string
  state: 'active' | 'dormant' | 'closing' | 'closed'
  note: string | null
}

export interface LedgerEntry {
  id: string
  wallet_id: string
  when_date: string
  source: string
  what: string
  amount: number
  pot: Pot
  ref: string | null
}

const round2 = (n: number) => Math.round(n * 100) / 100

/* ------------------------------------------------------------- topping up */

export type Verdict = { ok: true } | { ok: false; reason: string }

/**
 * Whether this top-up may go ahead.
 *
 * The ceiling exists because a wallet is a liability, not a savings account —
 * a marketplace holding thousands of somebody's money is running an unlicensed
 * deposit business.
 */
export function canTopUp(wallet: Wallet, amount: number, policy: WalletPolicy): Verdict {
  if (!Number.isFinite(amount) || amount <= 0) return { ok: false, reason: 'Enter an amount to add.' }
  if (amount < policy.min_topup) {
    return { ok: false, reason: `The smallest top-up is $${policy.min_topup.toFixed(2)}.` }
  }
  if (wallet.state === 'closed' || wallet.state === 'closing') {
    return { ok: false, reason: 'This account is closing. Nothing more can be added to it.' }
  }
  const after = round2(wallet.balance + amount)
  if (after > policy.max_balance) {
    const room = round2(policy.max_balance - wallet.balance)
    return {
      ok: false,
      reason: room <= 0
        ? `The wallet is already at the $${policy.max_balance.toFixed(2)} ceiling. Spend some before adding more.`
        : `That would take the wallet to $${after.toFixed(2)}, past the $${policy.max_balance.toFixed(2)} ceiling. You can add up to $${room.toFixed(2)}.`,
    }
  }
  return { ok: true }
}

/* --------------------------------------------------------------- spending */

export interface SpendPlan {
  fromPromo: number
  fromCash: number
  total: number
  shortfall: number
  ok: boolean
}

/**
 * How a payment is drawn from the two pots.
 *
 * Promotional credit first, deliberately. It is the marketplace's money and it
 * cannot be refunded, so spending it first leaves the customer holding the part
 * they could still ask back. Drawing cash first would quietly convert
 * refundable money into non-refundable credit.
 */
export function planSpend(wallet: Wallet, amount: number): SpendPlan {
  const total = round2(Math.max(0, amount))
  const fromPromo = round2(Math.min(wallet.promo, total))
  const fromCash = round2(Math.min(wallet.cash, total - fromPromo))
  const covered = round2(fromPromo + fromCash)
  return {
    fromPromo, fromCash, total,
    shortfall: round2(Math.max(0, total - covered)),
    ok: covered >= total && total > 0,
  }
}

/* --------------------------------------------------------------- rewards */

export interface RedeemOption {
  id: string
  name: string
  kind: string
  min: number
  step: number
  value_per: number
  status: string
}

export interface RedeemPlan {
  points: number
  credit: number
  ok: boolean
  reason?: string
}

/**
 * Points converted to wallet credit.
 *
 * The result lands in the promotional pot, and that is not a technicality: the
 * customer did not pay for those points, so converting them cannot create money
 * they can withdraw. A marketplace that let them would be a money transmitter
 * with a loyalty scheme attached.
 */
export function planRedemption(
  points: number,
  balance: number,
  option: RedeemOption,
  wallet: Wallet,
  policy: WalletPolicy,
): RedeemPlan {
  if (option.status !== 'active') {
    return { points: 0, credit: 0, ok: false, reason: `${option.name} is not currently offered.` }
  }
  if (!Number.isFinite(points) || points <= 0) {
    return { points: 0, credit: 0, ok: false, reason: 'Choose how many points to convert.' }
  }
  if (points > balance) {
    return { points, credit: 0, ok: false, reason: `You have ${balance.toLocaleString()} points, so ${points.toLocaleString()} is more than you hold.` }
  }
  if (points < option.min) {
    return { points, credit: 0, ok: false, reason: `The smallest conversion is ${option.min.toLocaleString()} points.` }
  }
  if (option.step > 0 && points % option.step !== 0) {
    return { points, credit: 0, ok: false, reason: `Convert in multiples of ${option.step.toLocaleString()} points.` }
  }

  /* value_per is dollars per hundred points, as the redemption table states it. */
  const credit = round2((points / 100) * option.value_per)
  const after = round2(wallet.balance + credit)
  if (after > policy.max_balance) {
    return {
      points, credit, ok: false,
      reason: `That would take the wallet to $${after.toFixed(2)}, past the $${policy.max_balance.toFixed(2)} ceiling.`,
    }
  }
  return { points, credit, ok: true }
}

/* --------------------------------------------------------------- closing */

export interface ClosureSettlement {
  /* Their money, going back to the instrument that funded it. */
  cashReturned: number
  /* Ours, cancelled. It was never theirs to take. */
  promoWrittenOff: number
  total: number
  hasCash: boolean
  hasPromo: boolean
  /* What the customer should be told, in one line each. */
  lines: string[]
}

/**
 * What happens to a balance when the account closes.
 *
 * This is where the two pots stop being a modelling nicety. The cash is
 * returned; the promotional credit is written off. Telling somebody their
 * "$42.60 balance" is coming back when $12 of it never can is the kind of
 * promise a support queue is made of — so the split is stated up front.
 */
export function settleOnClosure(wallet: Wallet, instrument: string | null): ClosureSettlement {
  const cashReturned = round2(wallet.cash)
  const promoWrittenOff = round2(wallet.promo)
  const lines: string[] = []

  if (cashReturned > 0) {
    lines.push(instrument
      ? `$${cashReturned.toFixed(2)} of your own money goes back to ${instrument}. Allow five working days.`
      : `$${cashReturned.toFixed(2)} of your own money is returnable, but there is no payment method on file to send it to. Add one before closing.`)
  }
  if (promoWrittenOff > 0) {
    lines.push(`$${promoWrittenOff.toFixed(2)} of credit the marketplace gave you — rewards and goodwill — cannot be paid out as cash and is cancelled. Spend it before you close if you would rather not lose it.`)
  }
  if (cashReturned === 0 && promoWrittenOff === 0) {
    lines.push('Your wallet is empty, so there is nothing to return.')
  }

  return {
    cashReturned, promoWrittenOff,
    total: round2(cashReturned + promoWrittenOff),
    hasCash: cashReturned > 0,
    hasPromo: promoWrittenOff > 0,
    lines,
  }
}

/** Whether the closure can actually be completed. Money with nowhere to go is
    the one thing that must stop it, because the alternative is the marketplace
    keeping it. */
export function canCloseWallet(wallet: Wallet, instrument: string | null): Verdict {
  if (wallet.state === 'closed') return { ok: false, reason: 'This wallet is already closed.' }
  if (wallet.cash > 0 && !instrument) {
    return {
      ok: false,
      reason: `There is $${wallet.cash.toFixed(2)} of your money in this wallet and no payment method to return it to. Add one first — the marketplace will not keep it, and it cannot close with it sitting here.`,
    }
  }
  return { ok: true }
}

/* -------------------------------------------------------------- the book */

export interface WalletBook {
  accounts: number
  total: number
  /* Split by whose money it is. The operator's headline number is a liability,
     and how much of it is refundable decides how much has to stay liquid. */
  cash: number
  promo: number
  dormant: number
  dormantValue: number
  byKind: { kind: string; accounts: number; total: number }[]
}

export function summariseBook(wallets: readonly Wallet[]): WalletBook {
  const kinds = [...new Set(wallets.map(w => w.kind))]
  return {
    accounts: wallets.length,
    total: round2(wallets.reduce((n, w) => n + Number(w.balance), 0)),
    cash: round2(wallets.reduce((n, w) => n + Number(w.cash), 0)),
    promo: round2(wallets.reduce((n, w) => n + Number(w.promo), 0)),
    dormant: wallets.filter(w => w.state === 'dormant').length,
    dormantValue: round2(wallets.filter(w => w.state === 'dormant')
      .reduce((n, w) => n + Number(w.balance), 0)),
    byKind: kinds.map(kind => {
      const mine = wallets.filter(w => w.kind === kind)
      return {
        kind, accounts: mine.length,
        total: round2(mine.reduce((n, w) => n + Number(w.balance), 0)),
      }
    }).sort((a, b) => b.total - a.total),
  }
}

/** Whether a wallet has gone quiet for long enough to be flagged. Dormancy is
    a real obligation — the holder is written to and the money returned or
    escheated, never absorbed. */
export function isDormant(wallet: Wallet, policy: WalletPolicy, today: Date): boolean {
  const cutoff = new Date(today)
  cutoff.setMonth(cutoff.getMonth() - policy.dormancy_months)
  return Date.parse(wallet.last_move) <= cutoff.getTime()
}

/** A running balance down the statement, so a customer can see how each line
    got them to where they are. Oldest first, because that is how it accrued. */
export function runningBalance(entries: readonly LedgerEntry[]): (LedgerEntry & { balance: number })[] {
  const ordered = [...entries].sort((a, b) =>
    a.when_date.localeCompare(b.when_date) || a.id.localeCompare(b.id))
  let running = 0
  return ordered.map(e => {
    running = round2(running + Number(e.amount))
    return { ...e, balance: running }
  })
}
