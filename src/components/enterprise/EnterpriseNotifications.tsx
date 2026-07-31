import { NotificationPreferencesView } from '../NotificationPreferencesView'
import { toast } from '../operator/shared'

/* The enterprise buyer's side of notifications. Scoped to the person signed in
 * rather than to the whole account: an approver and a requester on the same
 * account want different things, and a shared setting would mean one of them
 * either misses an approval or is interrupted by every one raised. */
export function EnterpriseNotifications() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div>
        <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 800, color: 'var(--text)' }}>Notifications</h1>
        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)', marginTop: '4px' }}>
          What the marketplace tells you, where it reaches you, and what it has already sent.
        </p>
      </div>
      <NotificationPreferencesView
        persona="enterprise"
        onToast={(msg, kind) => toast(msg, kind ?? 'success')}
      />
    </div>
  )
}
