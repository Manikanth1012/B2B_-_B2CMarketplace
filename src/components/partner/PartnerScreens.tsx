import type { PartnerView } from '../../types/view'
import { PartnerDashboard } from './PartnerDashboard'
import { PartnerOnboarding } from './PartnerOnboarding'
import { PartnerListings } from './PartnerListings'
import { PartnerNewListing } from './PartnerNewListing'
import { PartnerOrders } from './PartnerOrders'
import { PartnerEnquiries } from './PartnerEnquiries'
import { PartnerWholesale } from './PartnerWholesale'
import { PartnerRenewals } from './PartnerRenewals'
import { PartnerSettlement } from './PartnerSettlement'
import { PartnerSettlementPlan } from './PartnerSettlementPlan'
import { PartnerPerformance } from './PartnerPerformance'
import { PartnerIntegrations } from './PartnerIntegrations'
import { PartnerDeveloper } from './PartnerDeveloper'
import { PartnerSupport } from './PartnerSupport'
import { PartnerTeam, PartnerAudit } from './PartnerMisc'
import { PartnerDetails } from './PartnerDetails'
import { PartnerNotifications } from './PartnerNotifications'
import { PartnerRefunds } from './PartnerRefunds'
import { PartnerRewards } from './PartnerRewards'
import { PartnerReviews } from './PartnerReviews'
import { KnowledgeBase } from '../KnowledgeBase'

/* The seller console's screens, one per view. Its own module so App can load
   it lazily: nobody but a seller downloads the seller's console. The shell
   around it is not in here, so it stays on screen while this arrives. */
export function PartnerScreens({ view, partnerId, anchor, onSetView }: {
  view: PartnerView
  /* Undefined only for the reviews screen's sake, which has always read the
     session defensively; every other screen is mounted for a signed-in seller. */
  partnerId: string | undefined
  anchor: string | undefined
  onSetView: (v: PartnerView) => void
}) {
  const id = partnerId!
  return (
    <>
      {view === 'pt-dashboard' && <PartnerDashboard partnerId={id} onNavigate={onSetView} />}
      {view === 'pt-onboarding' && <PartnerOnboarding partnerId={id} />}
      {view === 'pt-listings' && <PartnerListings partnerId={id} onNewListing={() => onSetView('pt-newlisting')} />}
      {view === 'pt-newlisting' && <PartnerNewListing partnerId={id} />}
      {view === 'pt-orders' && <PartnerOrders partnerId={id} />}
      {view === 'pt-enquiries' && <PartnerEnquiries partnerId={id} />}
      {view === 'pt-wholesale' && <PartnerWholesale partnerId={id} />}
      {view === 'pt-renewals' && <PartnerRenewals partnerId={id} />}
      {view === 'pt-settlement' && <PartnerSettlement partnerId={id} />}
      {view === 'pt-plan' && <PartnerSettlementPlan partnerId={id} />}
      {view === 'pt-performance' && <PartnerPerformance />}
      {view === 'pt-integrations' && <PartnerIntegrations partnerId={id} />}
      {view === 'pt-developer' && <PartnerDeveloper partnerId={id} />}
      {view === 'pt-reviews' && <PartnerReviews partnerId={partnerId ?? ''} />}
      {view === 'pt-support' && <PartnerSupport partnerId={id} />}
      {view === 'pt-refunds' && <PartnerRefunds partnerId={id} />}
      {view === 'pt-rewards' && <PartnerRewards partnerId={id} />}
      {view === 'pt-notifications' && <PartnerNotifications partnerId={id} />}
      {view === 'pt-team' && <PartnerTeam partnerId={id} />}
      {view === 'pt-audit' && <PartnerAudit />}
      {view === 'pt-profile' && <PartnerDetails partnerId={id} anchor={anchor} />}
      {view === 'pt-kb' && <KnowledgeBase persona="partner" title="Knowledge base" feedbackAs={{ actor: 'Rajesh Kumar', org: 'Nimbus Sensors' }} />}
    </>
  )
}
