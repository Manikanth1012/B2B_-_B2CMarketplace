/**
 * The only module that reads the customer book for the operator.
 *
 * Everything here is already readable by the operator — `enterprise_accounts`,
 * `enterprise_onboarding`, `credit_assessment` and `consumer_profile` all carry
 * an `operator` policy and have done since they were created. Nothing was
 * locked; nothing was joined up. This is the join.
 */
import { supabase } from './supabase'
import type { Account, Step, CreditFile, Shopper } from './accounts'

const num = (v: unknown) => Number(v ?? 0)

export interface AccountBook {
  accounts: Account[]
  steps: Step[]
  credit: CreditFile[]
  shoppers: Shopper[]
  /* Companies who have asked for an account and not been decided. Counted here
     so the screen can point at the queue rather than pretend to be it — the
     decision lives on Onboarding, with the seller applications it shares a desk
     with. */
  waiting: number
  loadError?: string
}

export async function loadAccountBook(): Promise<AccountBook> {
  const [acc, steps, credit, shoppers, members, apps] = await Promise.all([
    supabase.from('enterprise_accounts')
      .select('id, company, legal_name, market, segment, industry, status, terms, currency, sites, staff')
      .order('company'),
    supabase.from('enterprise_onboarding').select('*').order('sort_order'),
    supabase.from('credit_assessment').select('*').is('partner_id', null),
    supabase.from('consumer_profile')
      .select('user_id, name, email, market, currency, since'),
    supabase.from('loyalty_members').select('user_id, tier, balance, joined').eq('kind', 'consumer'),
    supabase.from('applications').select('id, state, kind_of').eq('kind_of', 'business'),
  ])

  const failed = [acc.error, steps.error].find(Boolean)

  const tiers = new Map<string, { tier: string | null; balance: number; joined: string | null }>()
  for (const m of (members.data ?? []) as Record<string, unknown>[]) {
    if (m.user_id) {
      tiers.set(String(m.user_id), {
        tier: (m.tier as string) ?? null, balance: num(m.balance),
        joined: (m.joined as string) ?? null,
      })
    }
  }

  return {
    accounts: ((acc.data ?? []) as Record<string, unknown>[]).map(a => ({
      ...a, sites: num(a.sites), staff: num(a.staff),
    })) as unknown as Account[],
    steps: ((steps.data ?? []) as Record<string, unknown>[]).map(s => ({
      ...s, sort_order: num(s.sort_order),
    })) as unknown as Step[],
    credit: ((credit.data ?? []) as Record<string, unknown>[]).map(c => ({
      account_id: (c.account_id as string) ?? null,
      band: String(c.band),
      limit_granted: c.limit_granted == null ? null : num(c.limit_granted),
      currency: String(c.currency),
      next_review: (c.next_review as string) ?? null,
      reviewed_on: String(c.reviewed_on),
    })),
    shoppers: ((shoppers.data ?? []) as Record<string, unknown>[]).map(p => {
      const extra = tiers.get(String(p.user_id))
      return {
        user_id: String(p.user_id),
        name: String(p.name ?? '—'),
        email: (p.email as string) ?? null,
        market: (p.market as string) ?? null,
        currency: (p.currency as string) ?? null,
        tier: extra?.tier ?? null,
        points: extra?.balance ?? 0,
        joined: (p.since as string) ?? extra?.joined ?? null,
      }
    }),
    /* Submitted and not yet decided. A draft is somebody still typing and is
       not work for the desk. */
    waiting: ((apps.data ?? []) as { state: string }[]).filter(a => a.state === 'submitted').length,
    ...(failed ? { loadError: failed.message } : {}),
  }
}
