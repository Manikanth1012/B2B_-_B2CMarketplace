import { NotificationPreferencesView } from '../NotificationPreferencesView'
import { toast } from '../operator/shared'

/* The seller's side of notifications.
 *
 * Scoped to the whole seller account rather than to whoever is signed in: a
 * failed order needs to reach the fulfilment desk whether or not the person who
 * set the preference is at work that day, so "who at your company hears this"
 * is a company setting. The marketplace still decides what is worth sending —
 * this screen only chooses where, among the channels it offers. */
export function PartnerNotifications({ partnerId }: { partnerId: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div>
        <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 800, color: 'var(--text)' }}>Notifications</h1>
        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)', marginTop: '4px' }}>
          What the marketplace tells you, where it reaches you, and what it has already sent.
          These apply to everybody on the account.
        </p>
      </div>
      <NotificationPreferencesView
        persona="partner"
        partnerId={partnerId}
        onToast={(msg, kind) => toast(msg, kind ?? 'success')}
      />
    </div>
  )
}
