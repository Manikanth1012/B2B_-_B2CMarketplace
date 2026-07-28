export type View = 'home' | 'category' | 'product' | 'checkout' | 'orders' | 'subscriptions' | 'rewards' | 'account'

export interface NavigateOptions {
  category?: string
  product?: import('./index').Product
  tab?: string
}
