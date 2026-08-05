/* The one module that talks to Supabase about wallets. The rules live in
   wallet.ts; this is the read path they sit on and the write path that applies
   them.

   Every write here moves two rows — the wallet and a ledger entry — because a
   balance that changed with nothing recording why is the thing this table
   exists to prevent. */

import { supabase } from './supabase'
import { canTopUp, settleOnClosure, canCloseWallet, planSpend, limitFor } from './wallet'
import type { Wallet, WalletPolicy, WalletLimit, LedgerEntry } from './wallet'
import { format as formatMoney, money as asMoney } from './money'
import type { Currency } from './money'

/* Every refusal and every confirmation below quotes a figure, and each one used
   to quote it with a `$`. The wallet knows what it is in; this turns that into
   a formatter, using the same `format` the screens use rather than a second
   copy of the rules for where a mark goes. */
const writer = (currency: string, currencies: readonly Currency[]) =>
  (n: number) => formatMoney(asMoney(n, currency), currencies)

export interface WalletSource {
  id: string
  label: string
  pot: 'cash' | 'promo'
  direction: 'in' | 'out'
  note: string
  sort_order: number
}

export interface WalletClosure {
  id: string
  wallet_id: string
  requested_at: string
  instrument: string
  cash_returned: number
  promo_written_off: number
  state: 'requested' | 'returned' | 'failed'
  completed_at: string | null
  note: string | null
}

const DEFAULT_POLICY: WalletPolicy = {
  max_balance: 2000, min_topup: 5, dormancy_months: 24,
  cash_refundable: '', non_refundable: '', dormancy_note: '',
}

/* ------------------------------------------------------------- the book -- */

export interface WalletBookSnapshot {
  wallets: Wallet[]
  ledger: LedgerEntry[]
  sources: WalletSource[]
  policy: WalletPolicy
  /* One ceiling and floor per currency. The single dollar pair on
     `wallet_policy` is still there for the prose it carries — what is
     refundable and what is not — but the numbers come from here. */
  limits: WalletLimit[]
  currencies: Currency[]
  closures: WalletClosure[]
  loadError?: string
}

/** Everything the operator sees: the whole book, because it is their liability. */
export async function loadWalletBook(): Promise<WalletBookSnapshot> {
  const [wRes, lRes, sRes, pRes, cRes, xRes, curRes] = await Promise.all([
    supabase.from('wallets').select('*').order('sort_order'),
    supabase.from('wallet_ledger').select('*').order('when_date', { ascending: false }),
    supabase.from('wallet_sources').select('*').order('sort_order'),
    supabase.from('wallet_policy').select('*').eq('id', 'marketplace').maybeSingle(),
    supabase.from('wallet_closures').select('*').order('requested_at', { ascending: false }),
    supabase.from('wallet_limits').select('*'),
    supabase.from('currencies').select('*').order('sort_order'),
  ])

  const errors: string[] = []
  const note = (label: string, e: { message: string } | null) => { if (e) errors.push(`${label}: ${e.message}`) }
  note('wallets', wRes.error); note('ledger', lRes.error); note('sources', sRes.error)
  note('policy', pRes.error); note('closures', cRes.error); note('limits', xRes.error)

  return {
    wallets: (wRes.data ?? []) as Wallet[],
    ledger: (lRes.data ?? []) as LedgerEntry[],
    sources: (sRes.data ?? []) as WalletSource[],
    policy: (pRes.data as WalletPolicy | null) ?? DEFAULT_POLICY,
    limits: numericLimits((xRes.data ?? []) as WalletLimit[]),
    currencies: (curRes.data ?? []) as Currency[],
    closures: (cRes.data ?? []) as WalletClosure[],
    ...(errors.length > 0 ? { loadError: `Could not load the wallet book (${errors.join('; ')}).` } : {}),
  }
}

/* PostgREST hands numerics back as strings, and a ceiling that is a string
   compares as text — "500" > "200000" — so a top-up would be refused for
   crossing a limit it is nowhere near. */
const numericLimits = (rows: WalletLimit[]): WalletLimit[] =>
  rows.map(l => ({ ...l, max_balance: Number(l.max_balance), min_topup: Number(l.min_topup) }))

export interface MyWallet {
  wallet: Wallet | null
  ledger: LedgerEntry[]
  sources: WalletSource[]
  policy: WalletPolicy
  limits: WalletLimit[]
  currencies: Currency[]
  loadError?: string
}

/** What the signed-in customer sees: their own wallet and nothing else. RLS
    does the narrowing, so this is the same query the operator runs. */
export async function loadMyWallet(): Promise<MyWallet> {
  const [wRes, sRes, pRes, xRes, curRes] = await Promise.all([
    supabase.from('wallets').select('*').maybeSingle(),
    supabase.from('wallet_sources').select('*').order('sort_order'),
    supabase.from('wallet_policy').select('*').eq('id', 'marketplace').maybeSingle(),
    supabase.from('wallet_limits').select('*'),
    supabase.from('currencies').select('*').order('sort_order'),
  ])
  const wallet = (wRes.data as Wallet | null) ?? null

  const lRes = wallet
    ? await supabase.from('wallet_ledger').select('*')
        .eq('wallet_id', wallet.id).order('when_date', { ascending: false })
    : { data: [], error: null }

  const errors: string[] = []
  if (wRes.error) errors.push(`wallet: ${wRes.error.message}`)
  if (lRes.error) errors.push(`statement: ${lRes.error.message}`)

  return {
    wallet,
    ledger: (lRes.data ?? []) as LedgerEntry[],
    sources: (sRes.data ?? []) as WalletSource[],
    policy: (pRes.data as WalletPolicy | null) ?? DEFAULT_POLICY,
    limits: numericLimits((xRes.data ?? []) as WalletLimit[]),
    currencies: (curRes.data ?? []) as Currency[],
    ...(errors.length > 0 ? { loadError: `Could not load your wallet (${errors.join('; ')}).` } : {}),
  }
}

export type Result = { ok: true; note?: string } | { ok: false; reason: string }

const today = () => new Date().toISOString().slice(0, 10)
const txId = () => `WTX-${Date.now().toString(36).slice(-6).toUpperCase()}`

/* Re-read before deciding. The ceiling is checked against what the wallet holds
   now, not what the screen was showing when the form opened. */
async function fresh(walletId: string): Promise<
  { wallet: Wallet; policy: WalletPolicy; limit: WalletLimit; fmt: (n: number) => string } | null
> {
  const [w, p, x, cur] = await Promise.all([
    supabase.from('wallets').select('*').eq('id', walletId).maybeSingle(),
    supabase.from('wallet_policy').select('*').eq('id', 'marketplace').maybeSingle(),
    supabase.from('wallet_limits').select('*'),
    supabase.from('currencies').select('*').order('sort_order'),
  ])
  if (w.error || !w.data) return null
  const wallet = w.data as Wallet
  const policy = (p.data as WalletPolicy | null) ?? DEFAULT_POLICY
  const currencies = (cur.data ?? []) as Currency[]
  return {
    wallet, policy,
    limit: limitFor(numericLimits((x.data ?? []) as WalletLimit[]), wallet.currency, policy),
    fmt: writer(wallet.currency, currencies),
  }
}

/* Money in used to be written here, from a browser, in two writes: a ledger row
   and then the balance. It has moved to `settle_payment_attempt` in the
   database, called by `gatewayRepo`, because a top-up now begins with a trip to
   a provider who may say no — and because two writes from a browser cannot
   promise that the second one happens. What used to live here had to apologise
   in prose when it did not ("the movement was recorded but the balance did not
   update... tell support before trying again"), and that apology was an honest
   description of a bug rather than a message worth writing. */

/**
 * Points converted to spendable credit.
 *
 * Lands in the *promotional* pot, and that is the whole point: the customer did
 * not pay for these points, so converting them must not create money they can
 * withdraw to a card.
 *
 * Deliberately narrow — it touches the wallet and nothing else. The loyalty
 * side (the points balance, the lifetime totals, the points statement) is the
 * rewards screen's own business, and two modules both deducting points is how
 * a balance goes negative.
 */
export async function creditWalletFromRewards(
  { walletId, points, credit, optionId }: {
    walletId: string; points: number; credit: number; optionId: string
  },
): Promise<Result> {
  const now = await fresh(walletId)
  if (!now) return { ok: false, reason: 'Could not read the wallet. Try again.' }

  const after = +(Number(now.wallet.balance) + credit).toFixed(2)
  if (after > now.limit.max_balance) {
    return {
      ok: false,
      reason: `That would take your wallet to ${now.fmt(after)}, past the ${now.fmt(now.limit.max_balance)} ceiling. Spend some before converting more.`,
    }
  }

  const { error: ledErr } = await supabase.from('wallet_ledger').insert({
    id: txId(), wallet_id: walletId, when_date: today(), source: 'reward',
    what: `${points.toLocaleString()} points redeemed for credit`,
    amount: credit, pot: 'promo', ref: optionId, sort_order: 999,
  })
  if (ledErr) return { ok: false, reason: `The credit was not recorded: ${ledErr.message}` }

  const { error } = await supabase.from('wallets')
    .update({ promo: +(Number(now.wallet.promo) + credit).toFixed(2), last_move: today() })
    .eq('id', walletId)
  if (error) return { ok: false, reason: `The credit was not applied: ${error.message}` }

  return {
    ok: true,
    note: `$${credit.toFixed(2)} of credit added. It is spendable in the marketplace but cannot be paid out as cash.`,
  }
}

/** Money out, against a purchase. Promotional credit is drawn down first. */
export async function spendFromWallet(
  { walletId, amount, what, ref }: { walletId: string; amount: number; what: string; ref?: string },
): Promise<Result> {
  const now = await fresh(walletId)
  if (!now) return { ok: false, reason: 'Could not read the wallet. Try again.' }

  const plan = planSpend(now.wallet, amount)
  if (!plan.ok) {
    return { ok: false, reason: `The wallet holds $${now.wallet.balance.toFixed(2)}, which is $${plan.shortfall.toFixed(2)} short of $${amount.toFixed(2)}.` }
  }

  /* Two entries where both pots are touched, because one line saying "$20" over
     two kinds of money is the ambiguity this model exists to remove. */
  const rows = []
  if (plan.fromPromo > 0) {
    rows.push({ id: txId(), wallet_id: walletId, when_date: today(), source: 'spend',
      what: `${what} — from credit`, amount: -plan.fromPromo, pot: 'promo', ref: ref ?? null, sort_order: 999 })
  }
  if (plan.fromCash > 0) {
    rows.push({ id: `${txId()}C`, wallet_id: walletId, when_date: today(), source: 'spend',
      what, amount: -plan.fromCash, pot: 'cash', ref: ref ?? null, sort_order: 999 })
  }
  const { error: ledErr } = await supabase.from('wallet_ledger').insert(rows)
  if (ledErr) return { ok: false, reason: `The payment was not recorded: ${ledErr.message}` }

  const { error } = await supabase.from('wallets').update({
    cash: +(Number(now.wallet.cash) - plan.fromCash).toFixed(2),
    promo: +(Number(now.wallet.promo) - plan.fromPromo).toFixed(2),
    last_move: today(),
  }).eq('id', walletId)
  if (error) return { ok: false, reason: `The balance did not update: ${error.message}` }

  return {
    ok: true,
    note: plan.fromPromo > 0 && plan.fromCash > 0
      ? `Paid $${amount.toFixed(2)} — $${plan.fromPromo.toFixed(2)} of credit first, then $${plan.fromCash.toFixed(2)} of your own money.`
      : `Paid $${amount.toFixed(2)} from your wallet.`,
  }
}

/**
 * The customer has scheduled their account to close.
 *
 * Nothing moves yet, and that is deliberate: closure is thirty days out and can
 * be withdrawn until then, so paying the money back now would mean clawing it
 * back if they change their mind. What this does is record what *will* happen —
 * the split, and where the returnable part is going — and freeze the wallet so
 * nothing more can be added to it.
 */
export async function requestWalletReturn(
  { walletId, instrument, effective }: {
    walletId: string; instrument: string | null; effective: string
  },
): Promise<Result & { cashReturned?: number; promoWrittenOff?: number }> {
  const now = await fresh(walletId)
  if (!now) return { ok: false, reason: 'Could not read the wallet. Try again.' }

  const verdict = canCloseWallet(now.wallet, instrument)
  if (!verdict.ok) return verdict

  const settlement = settleOnClosure(now.wallet, instrument)

  /* One pending return per wallet — scheduling twice is one closure, not two. */
  await supabase.from('wallet_closures').delete()
    .eq('wallet_id', walletId).eq('state', 'requested')

  const { error: closeErr } = await supabase.from('wallet_closures').insert({
    id: `WCL-${Date.now().toString(36).slice(-6).toUpperCase()}`,
    wallet_id: walletId, instrument: instrument ?? 'none on file',
    cash_returned: settlement.cashReturned,
    promo_written_off: settlement.promoWrittenOff,
    state: 'requested', completed_at: null,
    note: `Account closes ${effective}. ${settlement.lines.join(' ')}`,
  })
  if (closeErr) return { ok: false, reason: `The return was not recorded: ${closeErr.message}` }

  const { error } = await supabase.from('wallets')
    .update({ state: 'closing' }).eq('id', walletId)
  if (error) return { ok: false, reason: `The wallet was not frozen: ${error.message}` }

  return {
    ok: true,
    cashReturned: settlement.cashReturned,
    promoWrittenOff: settlement.promoWrittenOff,
    note: settlement.lines.join(' '),
  }
}

/** They changed their mind. The wallet goes back to normal and the pending
    return is dropped — nothing was paid, so there is nothing to reverse. */
export async function cancelWalletReturn(walletId: string): Promise<Result> {
  const { error: delErr } = await supabase.from('wallet_closures')
    .delete().eq('wallet_id', walletId).eq('state', 'requested')
  if (delErr) return { ok: false, reason: `Could not withdraw the return: ${delErr.message}` }

  const { error } = await supabase.from('wallets')
    .update({ state: 'active' }).eq('id', walletId)
  if (error) return { ok: false, reason: `The wallet was not reopened: ${error.message}` }
  return { ok: true, note: 'Your wallet is active again.' }
}

/**
 * The operator has actually paid the money back.
 *
 * This is where the balance moves, because this is where the money does. Both
 * pots are recorded as movements before the wallet is zeroed, so the statement
 * still explains how it got to nothing — a wallet that empties with no entry
 * saying why is the thing the ledger exists to prevent.
 */
export async function markReturnPaid(
  { closureId, actor }: { closureId: string; actor: string },
): Promise<Result> {
  const { data: c, error: readErr } = await supabase
    .from('wallet_closures').select('*').eq('id', closureId).maybeSingle()
  if (readErr || !c) return { ok: false, reason: 'That return no longer exists.' }
  const closure = c as WalletClosure
  if (closure.state !== 'requested') return { ok: false, reason: `It is already ${closure.state}.` }

  const now = await fresh(closure.wallet_id)
  if (!now) return { ok: false, reason: 'Could not read the wallet.' }

  const rows = []
  if (Number(now.wallet.cash) > 0) {
    rows.push({
      id: txId(), wallet_id: closure.wallet_id, when_date: today(), source: 'return',
      what: `Returned to ${closure.instrument} on closing the account`,
      amount: -Number(now.wallet.cash), pot: 'cash', sort_order: 999,
    })
  }
  if (Number(now.wallet.promo) > 0) {
    rows.push({
      id: `${txId()}W`, wallet_id: closure.wallet_id, when_date: today(), source: 'writeoff',
      what: 'Promotional credit cancelled on closing the account',
      amount: -Number(now.wallet.promo), pot: 'promo', sort_order: 999,
    })
  }
  if (rows.length > 0) {
    const { error: ledErr } = await supabase.from('wallet_ledger').insert(rows)
    if (ledErr) return { ok: false, reason: `The closing movements were not recorded: ${ledErr.message}` }
  }

  const { error: wErr } = await supabase.from('wallets')
    .update({ cash: 0, promo: 0, state: 'closed', last_move: today() })
    .eq('id', closure.wallet_id)
  if (wErr) return { ok: false, reason: `The wallet did not close: ${wErr.message}` }

  const { data, error } = await supabase.from('wallet_closures')
    .update({ state: 'returned', completed_at: new Date().toISOString() })
    .eq('id', closureId).eq('state', 'requested').select('id')
  if (error) return { ok: false, reason: `That did not save: ${error.message}` }
  if (!data || data.length === 0) {
    return { ok: false, reason: 'Nothing was updated — it may already have been settled.' }
  }

  await supabase.from('operator_audit_log').insert({
    id: `AUD-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    actor, role: 'Marketplace operations', action: 'wallet.return.paid', object: closureId,
    category: 'Commercial', severity: 'high', outcome: 'success',
    before_val: 'requested',
    after_val: `returned — $${Number(closure.cash_returned).toFixed(2)} paid to ${closure.instrument}`,
  })
  return {
    ok: true,
    note: `$${Number(closure.cash_returned).toFixed(2)} returned to ${closure.instrument}. The marketplace no longer holds it.`,
  }
}
