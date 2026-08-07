export type View = 'home' | 'category' | 'product' | 'checkout' | 'orders' | 'subscriptions' | 'rewards' | 'account' | 'kb'

export type OperatorView =
  | 'op-dashboard'
  | 'op-onboarding'
  | 'op-partners'
  | 'op-catalogue'
  | 'op-settlement'
  | 'op-inventory'
  | 'op-numbers'
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
  | 'op-profile'
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
  | 'pt-developer'
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
  | 'en-numbers'
  | 'en-refunds'
  | 'en-billing'
  | 'en-wallet'
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
  /* Signing in.

     `demo` opens the four-persona chooser with its passwords already typed in —
     the tour. Without it this is the real sign-in a registered seller, shopper
     or business uses: one address, one password, nothing prefilled.

     `prefill` names the audience the visitor came from. In demo mode it picks
     the card and its credentials; in real mode it only decides what the heading
     calls them. Neither decides which console opens — that comes back from the
     server with the JWT, so signing in from the wrong page lands somebody in
     their own console rather than in somebody else's. */
  | { kind: 'login'; prefill?: Persona; demo?: boolean }
  /* Applying to sell. Its own surface rather than a public page, because the
     applicant is part-way through a form that is being saved as they go — the
     header's marketplace nav would take them out of it with one click, and
     there is no route to come back to. */
  | { kind: 'apply'; resume?: boolean; kindOf?: 'seller' | 'business' }
  /* Registering as a shopper. Its own surface for the same reason as `apply`:
     it is a form somebody is part-way through, and the header's marketplace nav
     would take them out of it with one click. */
  | { kind: 'register' }
  /* The second door. Somebody the telco already knows opens an account from
     what it already holds, instead of filling the form in again. */
  | { kind: 'sso' }
  | { kind: 'session'; session: Session }
