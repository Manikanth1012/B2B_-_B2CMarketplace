import { lazy } from 'react'
import type { OperatorView } from '../../types/view'
const OperatorDashboard = lazy(() => import('./OperatorDashboard').then(m => ({ default: m.OperatorDashboard })))
const OperatorAccounts = lazy(() => import('./OperatorAccounts').then(m => ({ default: m.OperatorAccounts })))
const OperatorRenewals = lazy(() => import('./OperatorRenewals').then(m => ({ default: m.OperatorRenewals })))
const OperatorOnboarding = lazy(() => import('./OperatorOnboarding').then(m => ({ default: m.OperatorOnboarding })))
const OperatorPartners = lazy(() => import('./OperatorPartners').then(m => ({ default: m.OperatorPartners })))
const OperatorCatalogue = lazy(() => import('./OperatorCatalogue').then(m => ({ default: m.OperatorCatalogue })))
const OperatorSettlement = lazy(() => import('./OperatorSettlement').then(m => ({ default: m.OperatorSettlement })))
const OperatorInventory = lazy(() => import('./OperatorInventory').then(m => ({ default: m.OperatorInventory })))
const OperatorNumbers = lazy(() => import('./OperatorNumbers').then(m => ({ default: m.OperatorNumbers })))
const OperatorTickets = lazy(() => import('./OperatorTickets').then(m => ({ default: m.OperatorTickets })))
const OperatorDunning = lazy(() => import('./OperatorDunning').then(m => ({ default: m.OperatorDunning })))
const OperatorDeveloper = lazy(() => import('./OperatorDeveloper').then(m => ({ default: m.OperatorDeveloper })))
const OperatorPromotions = lazy(() => import('./OperatorPromotions').then(m => ({ default: m.OperatorPromotions })))
const OperatorBanners = lazy(() => import('./OperatorBanners').then(m => ({ default: m.OperatorBanners })))
const OperatorBillTemplates = lazy(() => import('./OperatorBillTemplates').then(m => ({ default: m.OperatorBillTemplates })))
const OperatorMarkets = lazy(() => import('./OperatorMarkets').then(m => ({ default: m.OperatorMarkets })))
const OperatorKnowledge = lazy(() => import('./OperatorKnowledge').then(m => ({ default: m.OperatorKnowledge })))
const OperatorChannels = lazy(() => import('./OperatorChannels').then(m => ({ default: m.OperatorChannels })))
const OperatorJobs = lazy(() => import('./OperatorJobs').then(m => ({ default: m.OperatorJobs })))
const OperatorRoles = lazy(() => import('./OperatorRoles').then(m => ({ default: m.OperatorRoles })))
const OperatorAudit = lazy(() => import('./OperatorAudit').then(m => ({ default: m.OperatorAudit })))
const OperatorShelves = lazy(() => import('./OperatorShelves').then(m => ({ default: m.OperatorShelves })))
const OperatorNotes = lazy(() => import('./OperatorNotes').then(m => ({ default: m.OperatorNotes })))
const OperatorOrders = lazy(() => import('./OperatorOrders').then(m => ({ default: m.OperatorOrders })))
const OperatorBaskets = lazy(() => import('./OperatorBaskets').then(m => ({ default: m.OperatorBaskets })))
const OperatorDisputes = lazy(() => import('./OperatorDisputes').then(m => ({ default: m.OperatorDisputes })))
const OperatorCredit = lazy(() => import('./OperatorCredit').then(m => ({ default: m.OperatorCredit })))
const OperatorContracts = lazy(() => import('./OperatorContracts').then(m => ({ default: m.OperatorContracts })))
const OperatorPriceBooks = lazy(() => import('./OperatorPriceBooks').then(m => ({ default: m.OperatorPriceBooks })))
const OperatorEnquiries = lazy(() => import('./OperatorEnquiries').then(m => ({ default: m.OperatorEnquiries })))
const OperatorReviews = lazy(() => import('./OperatorReviews').then(m => ({ default: m.OperatorReviews })))
const OperatorWallets = lazy(() => import('./OperatorWallets').then(m => ({ default: m.OperatorWallets })))
const OperatorContentFeedback = lazy(() => import('./OperatorContentFeedback').then(m => ({ default: m.OperatorContentFeedback })))
const OperatorRefunds = lazy(() => import('./OperatorRefunds').then(m => ({ default: m.OperatorRefunds })))
const OperatorRewards = lazy(() => import('./OperatorRewards').then(m => ({ default: m.OperatorRewards })))
const OperatorRevenueShare = lazy(() => import('./OperatorRevenueShare').then(m => ({ default: m.OperatorRevenueShare })))
const OperatorLedger = lazy(() => import('./OperatorLedger').then(m => ({ default: m.OperatorLedger })))
const OperatorNotifications = lazy(() => import('./OperatorNotifications').then(m => ({ default: m.OperatorNotifications })))
const OperatorProfile = lazy(() => import('./OperatorProfile').then(m => ({ default: m.OperatorProfile })))

/* The operator console's screens, one per view. Its own module so App can load
   it lazily: a visitor, a shopper or a seller never downloads the operator's
   console. The shell around it is not in here, so it stays on screen while
   this arrives.

   Unlike the seller's and the buyer's consoles, each screen here is also its
   own chunk: the operator's thirty-odd screens came to over 800 kB together,
   and an operator opening the dashboard has no use for the catalogue editor
   or the template designer until they go there. The Suspense boundary in App,
   inside the shell, covers each first visit. */
export function OperatorScreens({ view, focus, onNavigate, onSetView }: {
  view: OperatorView
  focus: string | null
  onNavigate: (v: OperatorView, opts?: { focus?: string }) => void
  onSetView: (v: OperatorView) => void
}) {
  return (
    <>
      {view === 'op-dashboard' && <OperatorDashboard onNavigate={onNavigate} />}
      {view === 'op-onboarding' && <OperatorOnboarding />}
      {view === 'op-accounts' && <OperatorAccounts onNavigate={onSetView} />}
      {view === 'op-partners' && <OperatorPartners focus={focus} />}
      {view === 'op-catalogue' && <OperatorCatalogue focus={focus} />}
      {view === 'op-settlement' && <OperatorSettlement focus={focus} />}
      {view === 'op-inventory' && <OperatorInventory />}
      {view === 'op-renewals' && <OperatorRenewals />}
      {view === 'op-numbers' && <OperatorNumbers />}
      {view === 'op-tickets' && <OperatorTickets focus={focus} />}
      {view === 'op-dunning' && <OperatorDunning />}
      {view === 'op-developer' && <OperatorDeveloper />}
      {view === 'op-promotions' && <OperatorPromotions />}
      {view === 'op-banners' && <OperatorBanners />}
      {view === 'op-billtemplates' && <OperatorBillTemplates />}
      {view === 'op-profile' && <OperatorProfile anchor={focus ?? undefined} />}
      {view === 'op-markets' && <OperatorMarkets />}
      {view === 'op-notifications' && <OperatorNotifications />}
      {view === 'op-channels' && <OperatorChannels />}
      {view === 'op-jobs' && <OperatorJobs />}
      {view === 'op-roles' && <OperatorRoles />}
      {view === 'op-shelves' && <OperatorShelves />}
      {view === 'op-reviews' && <OperatorReviews />}
      {view === 'op-wallets' && <OperatorWallets />}
      {view === 'op-refunds' && <OperatorRefunds />}
      {view === 'op-rewards' && <OperatorRewards />}
      {view === 'op-revshare' && <OperatorRevenueShare />}
      {view === 'op-notes' && <OperatorNotes />}
      {view === 'op-orders' && <OperatorOrders />}
      {view === 'op-baskets' && <OperatorBaskets />}
      {view === 'op-disputes' && <OperatorDisputes />}
      {view === 'op-credit' && <OperatorCredit />}
      {view === 'op-contracts' && <OperatorContracts />}
      {view === 'op-pricebooks' && <OperatorPriceBooks />}
      {view === 'op-enquiries' && <OperatorEnquiries />}
      {view === 'op-ledger' && <OperatorLedger />}
      {view === 'op-feedback' && <OperatorContentFeedback />}
      {view === 'op-audit' && <OperatorAudit />}
      {view === 'op-kb' && <OperatorKnowledge />}
      {/* No feedbackAs: the operator is the queue. */}
    </>
  )
}
