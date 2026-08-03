import { useState, useEffect, useRef } from 'react'
import { ChevronDown } from 'lucide-react'

/* The avatar menu, once, for the three consoles.
 *
 * It existed three times — operator, seller, business — as a `ProfileItem` that
 * drew a bare label and, for six of the nine items across the three, called
 * nothing but `setProfileOpen(false)`. Clicking "Sign-in & security" closed the
 * menu and did precisely that.
 *
 * Two things were wrong and only one of them was visible. The visible one is
 * that the consumer header has an icon against every item and these did not, so
 * the same product looked like two products. The other is that the items were
 * dead, which nobody had reported because a menu that closes when you click it
 * looks like a menu that worked.
 *
 * Written once here so the fourth persona cannot drift from the other three
 * again. The consumer's own header keeps its own copy for now — it is a
 * different shell with a different palette — but the row is the same row.
 */

export interface AccountMenuItem {
  icon: React.ReactNode
  label: string
  onClick: () => void
}

export function AccountMenu({ initials, name, role, org, colour, items, onSignOut, signOutIcon }: {
  initials: string
  name: string
  role: string
  /* The company or marketplace this person is acting for. A name on its own
     does not say which account you are signed into. */
  org?: string
  colour: string
  items: AccountMenuItem[]
  onSignOut: () => void
  signOutIcon: React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)

  /* Closed by a click anywhere else, and by Escape. The three copies of this
     listened for the click and none of them listened for the key, so a menu
     opened by keyboard could only be closed by mouse. */
  useEffect(() => {
    if (!open) return
    const away = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false)
    }
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('mousedown', away)
    window.addEventListener('keydown', key)
    return () => {
      window.removeEventListener('mousedown', away)
      window.removeEventListener('keydown', key)
    }
  }, [open])

  return (
    <div style={{ position: 'relative' }} ref={box}>
      <button
        onClick={() => setOpen(o => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        style={{
          display: 'flex', alignItems: 'center', gap: '8px', padding: '4px 8px 4px 4px',
          borderRadius: 'var(--radius-full)', background: 'var(--bg-alt)', border: 'none', cursor: 'pointer',
        }}
      >
        <div style={{
          width: '32px', height: '32px', borderRadius: '50%', background: colour, color: 'white',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontWeight: 700, fontSize: 'var(--text-xs)', flexShrink: 0,
        }}>{initials}</div>
        <div className="hide-mobile" style={{ textAlign: 'left' }}>
          <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--text)' }}>{name}</div>
          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>{role}</div>
        </div>
        <ChevronDown size={14} style={{ color: 'var(--text-tertiary)' }} />
      </button>

      {open && (
        <div role="menu" style={{
          position: 'absolute', top: '100%', right: 0, marginTop: '8px', background: 'white',
          borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-lg)', border: '1px solid var(--border)',
          minWidth: '240px', zIndex: 200, overflow: 'hidden',
        }}>
          <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border-light)' }}>
            <div style={{ fontWeight: 700, fontSize: 'var(--text-sm)', color: 'var(--text)' }}>{name}</div>
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginTop: '2px' }}>
              {role}{org ? ` · ${org}` : ''}
            </div>
          </div>
          <div style={{ padding: '4px' }}>
            {items.map(item => (
              <AcctRow key={item.label} icon={item.icon} label={item.label}
                       onClick={() => { setOpen(false); item.onClick() }} />
            ))}
          </div>
          <div style={{ padding: '4px', borderTop: '1px solid var(--border-light)' }}>
            <AcctRow icon={signOutIcon} label="Sign out" onClick={() => { setOpen(false); onSignOut() }} />
          </div>
        </div>
      )}
    </div>
  )
}

/* The same row the consumer header draws, down to the gap and the ink the icon
   wears — recessive, so the label leads and the icon locates. */
function AcctRow({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      role="menuitem"
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: '10px', width: '100%',
        padding: '10px 12px', borderRadius: 'var(--radius)', border: 'none',
        background: 'none', color: 'var(--text-secondary)',
        fontSize: 'var(--text-sm)', fontWeight: 500, cursor: 'pointer',
        textAlign: 'left', transition: 'background 150ms ease',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-alt)' }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'none' }}
    >
      <span style={{ color: 'var(--text-tertiary)', display: 'flex' }}>{icon}</span>
      {label}
    </button>
  )
}
