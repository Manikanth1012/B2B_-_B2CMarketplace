import { CircleCheck as CheckCircle, Circle } from 'lucide-react'
import { TECH_CHECKS } from '../lib/onboarding'
import type { TechStatus } from '../lib/onboarding'
import { Btn } from './operator/shared'

/* One component, both consoles. The partner gets the action that moves each
   check; the operator gets the same four rows read-only. Same source, so the
   two screens cannot disagree about whether the integration is proved. */
export function TechChecklist({ tech, mode, onRegisterEndpoint, onFixAuth, onSendTestCall, onRunSandbox }: {
  tech: TechStatus
  mode: 'partner' | 'operator'
  onRegisterEndpoint?: () => void
  onFixAuth?: () => void
  onSendTestCall?: () => void
  onRunSandbox?: () => void
}) {
  const action = (id: string) =>
    id === 'registered' ? onRegisterEndpoint
    : id === 'auth' ? onFixAuth
    : id === 'tested' ? onSendTestCall
    : onRunSandbox

  const label = (id: string) =>
    id === 'registered' ? 'Register an endpoint'
    : id === 'auth' ? 'Set authentication'
    : id === 'tested' ? 'Send a test call'
    : 'Run sandbox order'

  const passed = TECH_CHECKS.filter(c => tech.checks[c.id]).length

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <div style={{ fontSize: 'var(--text-sm)', fontWeight: 700 }}>
        {passed} of {TECH_CHECKS.length} checks pass
      </div>

      {TECH_CHECKS.map(c => {
        const ok = tech.checks[c.id]
        const handler = action(c.id)
        return (
          <div key={c.id} style={{
            display: 'flex', gap: '12px', alignItems: 'flex-start',
            padding: '12px', borderRadius: 'var(--radius-md)',
            background: ok ? 'var(--success-bg)' : 'var(--bg-alt)',
            border: `1px solid ${ok ? 'var(--success)' : 'var(--border)'}`,
          }}>
            <div style={{ flexShrink: 0, marginTop: '2px' }}>
              {ok ? <CheckCircle size={18} style={{ color: 'var(--success)' }} />
                  : <Circle size={18} style={{ color: 'var(--text-tertiary)' }} />}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600 }}>{c.label}</div>
              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginTop: '2px' }}>{c.why}</div>
              {c.id === 'registered' && tech.missing.length > 0 && (
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--danger)', marginTop: '4px' }}>
                  No endpoint for: {tech.missing.join(', ')}
                </div>
              )}
              {c.id === 'auth' && tech.noAuth.length > 0 && (
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--danger)', marginTop: '4px' }}>
                  Unauthenticated: {tech.noAuth.map(e => e.name).join(', ')}
                </div>
              )}
              {c.id === 'tested' && tech.untested.length > 0 && (
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--danger)', marginTop: '4px' }}>
                  No acknowledged call: {tech.untested.map(e => e.name).join(', ')}
                </div>
              )}
            </div>
            {mode === 'partner' && !ok && handler && (
              <div style={{ flexShrink: 0 }}>
                <Btn size="sm" onClick={handler}>{label(c.id)}</Btn>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
