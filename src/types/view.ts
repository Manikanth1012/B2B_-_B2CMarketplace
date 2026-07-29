export type View = 'home' | 'category' | 'product' | 'checkout' | 'orders' | 'subscriptions' | 'rewards' | 'account' | 'kb'

export type OperatorView =
  | 'op-dashboard'
  | 'op-onboarding'
  | 'op-catalogue'
  | 'op-settlement'
  | 'op-inventory'
  | 'op-tickets'
  | 'op-dunning'
  | 'op-developer'
  | 'op-promotions'
  | 'op-banners'
  | 'op-channels'
  | 'op-roles'
  | 'op-audit'
  | 'op-kb'

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
  | 'pt-team'
  | 'pt-audit'
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
