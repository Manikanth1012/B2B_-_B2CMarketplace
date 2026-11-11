import type { EnterpriseView } from '../../types/view'
import { RequisitionPanel } from './RequisitionPanel'
import { EnterpriseDashboard } from './EnterpriseDashboard'
import { EnterpriseBrowse } from './EnterpriseBrowse'
import { EnterpriseSubs, EnterpriseMarketplace } from './EnterpriseViews'
import { EnterpriseOrders } from './EnterpriseOrders'
import { EnterpriseEnquiries } from './EnterpriseEnquiries'
import { EnterpriseAudit } from './EnterpriseMisc'
import { EnterpriseTeam } from './EnterpriseTeam'
import { EnterpriseProfile } from './EnterpriseProfile'
import { EnterpriseWallet } from './EnterpriseWallet'
import { EnterpriseNumbers } from './EnterpriseNumbers'
import { EnterpriseNotifications } from './EnterpriseNotifications'
import { EnterpriseApprovals } from './EnterpriseApprovals'
import { EnterpriseRefunds } from './EnterpriseRefunds'
import { EnterpriseBilling } from './EnterpriseBilling'
import { EnterpriseAgreement } from './EnterpriseAgreement'
import { EnterpriseRewards } from './EnterpriseRewards'
import { EnterpriseSupport } from './EnterpriseSupport'
import { KnowledgeBase } from '../KnowledgeBase'

/* The business console's screens, one per view, and the requisition panel
   that floats over them. Its own module so App can load it lazily: nobody but
   a business buyer downloads the business console. The shell, the
   requisition provider and the bundle configurator stay in App, so the
   requisition outlives this arriving and the configurator's sink is there
   from the first render. */
export function EnterpriseScreens({ view, anchor, onSetView }: {
  view: EnterpriseView
  anchor: string | undefined
  onSetView: (v: EnterpriseView) => void
}) {
  return (
    <>
      {/* Raising sends them to the queue their requisition just joined —
          within policy or not, it is waiting for a decision there and that is
          where the order gets placed. */}
      <RequisitionPanel onRaised={() => onSetView('en-approvals')} onQuoteRequested={() => onSetView('en-enquiries')} />
      {view === 'en-dashboard' && <EnterpriseDashboard onNavigate={onSetView} />}
      {view === 'en-browse' && <EnterpriseBrowse />}
      {view === 'en-iot' && <EnterpriseMarketplace vertical="iot" />}
      {view === 'en-security' && <EnterpriseMarketplace vertical="security" />}
      {view === 'en-devices' && <EnterpriseMarketplace vertical="device" />}
      {view === 'en-approvals' && <EnterpriseApprovals />}
      {view === 'en-orders' && <EnterpriseOrders />}
      {view === 'en-enquiries' && <EnterpriseEnquiries />}
      {view === 'en-subs' && <EnterpriseSubs />}
      {view === 'en-numbers' && <EnterpriseNumbers />}
      {view === 'en-refunds' && <EnterpriseRefunds />}
      {view === 'en-billing' && <EnterpriseBilling />}
      {view === 'en-agreement' && <EnterpriseAgreement />}
      {view === 'en-rewards' && <EnterpriseRewards />}
      {view === 'en-support' && <EnterpriseSupport />}
      {view === 'en-notifications' && <EnterpriseNotifications />}
      {view === 'en-team' && <EnterpriseTeam />}
      {view === 'en-audit' && <EnterpriseAudit />}
      {view === 'en-profile' && <EnterpriseProfile anchor={anchor} />}
      {view === 'en-wallet' && <EnterpriseWallet />}
      {view === 'en-kb' && <KnowledgeBase persona="enterprise" title="Knowledge base" feedbackAs={{ actor: 'Vikram Shah', org: 'SmartBuild Ltd' }} />}
    </>
  )
}
