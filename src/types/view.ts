export type View = 'home' | 'category' | 'product' | 'checkout' | 'orders' | 'subscriptions' | 'rewards' | 'account' | 'kb'

export type OperatorView =
  | 'op-dashboard'
  | 'op-onboarding'
  | 'op-partners'
  | 'op-catalogue'
  | 'op-settlement'
  | 'op-inventory'
  | 'op-tickets'
  | 'op-dunning'
  | 'op-developer'
  | 'op-promotions'
  | 'op-banners'
  | 'op-channels'
  | 'op-notifications'
  | 'op-roles'
  | 'op-audit'
  | 'op-reviews'
  | 'op-feedback'
  | 'op-wallets'
  | 'op-refunds'
  | 'op-rewards'
  | 'op-ledger'
  | 'op-revshare'
  | 'op-billtemplates'
  | 'op-markets'
  | 'op-kb'
  | 'op-kbadmin'

export type PartnerView =
  | 'pt-dashboard'
  | 'pt-onboarding'
  | 'pt-listings'
  | 'pt-newlisting'
  | 'pt-orders'
  | 'pt-settlement'
  | 'pt-plan'
  | 'pt-performance'
  | 'pt-integrations'
  | 'pt-support'
  | 'pt-refunds'
  | 'pt-rewards'
  | 'pt-notifications'
  | 'pt-team'
  | 'pt-audit'
  | 'pt-reviews'
  | 'pt-profile'
  | 'pt-kb'

export type EnterpriseView =
  | 'en-dashboard'
  | 'en-browse'
  | 'en-iot'
  | 'en-security'
  | 'en-devices'
  | 'en-approvals'
  | 'en-orders'
  | 'en-subs'
  | 'en-refunds'
  | 'en-billing'
  | 'en-rewards'
  | 'en-support'
  | 'en-notifications'
  | 'en-team'
  | 'en-audit'
  | 'en-profile'
  | 'en-kb'

export type Persona = 'consumer' | 'operator' | 'partner' | 'enterprise'

export interface NavigateOptions {
  category?: string
  product?: import('./index').Product
  tab?: string
}

export interface Session {
  persona: Persona
  /* Set when persona === 'partner'. The console has to know whose record it is. */
  partnerId?: string
}

export type PublicPage = 'landing' | 'partner' | 'retail' | 'enterprise'

/* The app has no router — react-router-dom is declared but never imported.
   Rather than introduce one here (which would touch every console), the
   existing state machine gains a third surface. */
export type Surface =
  | { kind: 'public'; page: PublicPage }
  /* `prefill` preselects a persona card. It chooses which credentials are
     filled in, never which console opens — that comes back from the server. */
  | { kind: 'login'; prefill?: Persona }
  | { kind: 'session'; session: Session }
