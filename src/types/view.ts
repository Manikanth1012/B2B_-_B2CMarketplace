export type View = 'home' | 'category' | 'product' | 'checkout' | 'orders' | 'subscriptions' | 'rewards' | 'account'

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

export type Persona = 'consumer' | 'operator'

export interface NavigateOptions {
  category?: string
  product?: import('./index').Product
  tab?: string
}
