/* What API access a seller actually holds.
 *
 * The Integrations screen listed "catalogue:read, orders:read, orders:write,
 * settlement:read" as a hard-coded string, alongside a rate limit and a monthly
 * quota that were also strings. `operator_api_subscriptions` holds the real
 * grants; until the seller was joined to them, the screen had nothing to read.
 */
import { supabase } from './supabase'

export interface ApiSubscription {
  id: string
  api_id: string
  api_name: string
  version: string
  environment: string
  scopes: string[]
  volume: number
  started_at: string
  status: string
}

export interface ApiAccess {
  subscriptions: ApiSubscription[]
  /* Sellers' APIs this seller does not hold. Shown because "what am I allowed
     to call" is only half the question a developer arrives with. */
  unsubscribed: { id: string; name: string; version: string }[]
  /* The union across their subscriptions. A seller with orders:read on sandbox
     and orders:write on production holds both — the screen lists what they can
     do somewhere, and the table below says where. */
  scopes: string[]
  environments: string[]
  volume: number
  rateLimit: number
  quota: number
}

const EMPTY: ApiAccess = {
  subscriptions: [], unsubscribed: [], scopes: [], environments: [],
  volume: 0, rateLimit: 0, quota: 0,
}

/* Sandbox is throttled harder than production because a seller testing a loop
   against it is the normal case, and the point of the limit is that their bug
   does not become the marketplace's outage. */
const SANDBOX = { rate: 100, quota: 10000 }
const PRODUCTION = { rate: 600, quota: 250000 }

export async function loadApiAccess(partnerId: string): Promise<ApiAccess> {
  const [subs, apis] = await Promise.all([
    supabase.from('operator_api_subscriptions').select('*').eq('partner_id', partnerId).order('sort_order'),
    supabase.from('operator_apis').select('id, name, version, audience').order('sort_order'),
  ])
  if (subs.error || apis.error) return EMPTY

  type ApiRow = { id: string; name: string; version: string; audience: string }
  const named = (apis.data ?? []) as ApiRow[]

  const subscriptions: ApiSubscription[] = ((subs.data ?? []) as Record<string, unknown>[])
    .map(s => ({
      id: String(s.id),
      api_id: String(s.api_id),
      api_name: named.find(a => a.id === s.api_id)?.name ?? String(s.api_id),
      version: String(s.version),
      environment: String(s.environment),
      scopes: (s.scopes ?? []) as string[],
      volume: Number(s.volume ?? 0),
      started_at: String(s.started_at ?? ''),
      status: String(s.status ?? 'active'),
    }))
    .filter(s => s.status === 'active')

  const held = new Set(subscriptions.map(s => s.api_id))
  const scopes = [...new Set(subscriptions.flatMap(s => s.scopes))].sort()
  const environments = [...new Set(subscriptions.map(s => s.environment))].sort()

  /* Production access, where it exists, sets the limits — a seller who holds
     both is not throttled to their sandbox allowance. */
  const tier = environments.includes('production') ? PRODUCTION : SANDBOX

  return {
    subscriptions,
    unsubscribed: named
      .filter(a => a.audience.includes('Sellers') && !held.has(a.id))
      .map(a => ({ id: a.id, name: a.name, version: a.version })),
    scopes,
    environments,
    volume: subscriptions.reduce((a, s) => a + s.volume, 0),
    rateLimit: subscriptions.length ? tier.rate : 0,
    quota: subscriptions.length ? tier.quota : 0,
  }
}
