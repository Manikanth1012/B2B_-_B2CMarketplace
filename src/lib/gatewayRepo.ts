/* Starting a payment at a provider, and applying what they said.

   The rules are in `gateway.ts` so they can be tested without a network. The
   part that moves money is `settle_payment_attempt` in the database and not
   here, on purpose: the wallet, the ledger row and the attempt have to move
   together, and three writes from a browser cannot promise that. */
import { supabase } from './supabase'
import { referenceFor } from './gateway'
import type { PaymentMethod, MethodMarket, PaymentAttempt, Check } from './gateway'

export interface PaymentCatalogue {
  methods: PaymentMethod[]
  links: MethodMarket[]
  loadError?: string
}

export async function loadPaymentCatalogue(): Promise<PaymentCatalogue> {
  const [mRes, lRes] = await Promise.all([
    supabase.from('payment_methods').select('*').order('sort_order'),
    supabase.from('payment_method_markets').select('*').order('sort_order'),
  ])
  const errors: string[] = []
  if (mRes.error) errors.push(`methods: ${mRes.error.message}`)
  if (lRes.error) errors.push(`markets: ${lRes.error.message}`)
  return {
    methods: (mRes.data ?? []) as PaymentMethod[],
    links: (lRes.data ?? []) as MethodMarket[],
    ...(errors.length > 0 ? { loadError: `Could not load the ways to pay (${errors.join('; ')}).` } : {}),
  }
}

/**
 * Close out anything nobody is going to answer.
 *
 * There is no scheduler, so the wallet screens call this when they load — the
 * same arrangement `publish_due_listings` uses. Forgetting to call it reports a
 * stale attempt as still waiting, which is only ever more cautious than the
 * truth, so the failure mode is one-sided by design.
 */
export async function expireStale(): Promise<number> {
  const { data } = await supabase.rpc('expire_stale_payments')
  return Number(data ?? 0)
}

/** One payment, by the reference the shopper's orders carry. */
export async function loadAttemptByRef(reference: string): Promise<PaymentAttempt | null> {
  const { data } = await supabase.from('payment_attempts')
    .select('*').eq('reference', reference).maybeSingle()
  return data ? { ...(data as PaymentAttempt), amount: Number((data as PaymentAttempt).amount) } : null
}

/** This wallet's payments, most recent first — the failed ones included. */
export async function loadAttempts(walletId: string): Promise<PaymentAttempt[]> {
  await expireStale()
  const { data } = await supabase.from('payment_attempts')
    .select('*').eq('wallet_id', walletId).order('started_at', { ascending: false }).limit(20)
  return ((data ?? []) as PaymentAttempt[]).map(a => ({ ...a, amount: Number(a.amount) }))
}

/** A reference the checkout can put on its orders before the attempt exists. */
export function newReference(now = new Date()): string {
  return referenceFor(now, now.getTime() + Math.floor(Math.random() * 1e6))
}

/**
 * Book the intention before leaving.
 *
 * The row exists before the customer goes anywhere, so that a customer who
 * never comes back has left a record of what they were trying to do. Booking it
 * on return instead would mean the only case that needs a record is the one
 * case with none.
 */
export async function startPayment(
  { walletId, orderRef, userId, amount, currency, method, marketCode, provider, reference }: {
    /* A payment is for a wallet or for a basket, never both — the table's own
       check constraint says so, and passing both here is a caller bug rather
       than something to resolve quietly. */
    walletId?: string
    orderRef?: string
    userId?: string
    amount: number
    currency: string
    method: PaymentMethod
    marketCode: string
    provider: string
    /* The checkout needs the reference before the attempt exists, because the
       orders it is about to write carry it. Given here when so. */
    reference?: string
  },
): Promise<{ ok: true; attempt: PaymentAttempt } | { ok: false; reason: string }> {
  if ((walletId == null) === (orderRef == null)) {
    return { ok: false, reason: 'A payment is for a wallet or for an order, not both and not neither.' }
  }

  const now = new Date()
  const id = `PA-${now.getTime().toString(36).toUpperCase()}`
  const row = {
    id,
    reference: reference ?? referenceFor(now, now.getTime() + Math.floor(Math.random() * 1e6)),
    wallet_id: walletId ?? null,
    order_ref: orderRef ?? null,
    user_id: userId ?? null,
    purpose: walletId ? 'wallet_topup' : 'order',
    amount: +amount.toFixed(2),
    currency,
    method_id: method.id,
    market_code: marketCode,
    provider,
    state: 'initiated' as const,
  }

  const { data, error } = await supabase.from('payment_attempts').insert(row).select().maybeSingle()
  if (error) {
    return {
      ok: false,
      reason: /row-level security/i.test(error.message)
        ? (walletId ? 'That wallet is not yours to top up.' : 'That basket is not yours to pay for.')
        : `The payment could not be started: ${error.message}`,
    }
  }
  const attempt = (data ?? row) as PaymentAttempt
  return { ok: true, attempt: { ...attempt, amount: Number(attempt.amount) } }
}

/**
 * What the provider said.
 *
 * Everything the outcome implies happens inside one function in the database.
 * A second call with the same attempt is answered rather than refused — a
 * provider calling back twice is ordinary, and the second call has to find the
 * first call's answer.
 */
export async function settle(
  { attemptId, outcome, instrument, gatewayRef, reason }: {
    attemptId: string
    outcome: 'succeeded' | 'failed' | 'cancelled' | 'expired'
    instrument?: string
    gatewayRef?: string
    reason?: string
  },
): Promise<Check & { state?: string }> {
  const { data, error } = await supabase.rpc('settle_payment_attempt', {
    p_attempt: attemptId,
    p_outcome: outcome,
    p_instrument: instrument ?? null,
    p_gateway_ref: gatewayRef ?? null,
    p_reason: reason ?? null,
  })
  if (error) {
    const m = error.message.replace(/^.*?\bERROR:\s*/i, '').replace(/^P0001:\s*/, '').trim()
    return { ok: false, reason: m }
  }

  const out = (data ?? {}) as { state?: string; note?: string; already?: boolean }
  return { ok: true, state: out.state, note: out.note }
}
