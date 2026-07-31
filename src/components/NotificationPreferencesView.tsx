import { useState, useEffect, useCallback } from 'react'
import { Bell, Check, Minus, Lock, History, RotateCcw, ChevronDown } from 'lucide-react'
import { loadMine, savePreference, resetPreference } from '../lib/notificationRepo'
import type { NotificationBook } from '../lib/notificationRepo'
import {
  myRules, byCategory, summarisePrefs, toggleKind, validatePreference, orderKinds,
  filterLog, notDelivered, explain, when, STATE_LABEL, PERSONA_LABEL,
} from '../lib/notifications'
import type { Persona, KindId, Effective, LogState, LogEntry } from '../lib/notifications'

/* One preferences screen, shared by the seller, the enterprise buyer and the
 * customer. Their consoles look different but their choice is the same one, and
 * three copies of it would be three places for the rules to drift apart.
 *
 * What a recipient can do here is deliberately narrow. The marketplace decides
 * what is worth sending and on which channels; this screen decides where, among
 * those, it reaches you — and refuses, in plain words, the two things the
 * database will refuse anyway: silencing something mandatory, and picking a
 * channel nothing is written for.
 */

export function NotificationPreferencesView({
  persona, partnerId, onToast,
}: {
  persona: Persona
  /* Set for a seller: their choices are made once for the whole account, because
     "who at your company hears this" is a company decision. */
  partnerId?: string
  onToast?: (msg: string, kind?: 'success' | 'error') => void
}) {
  const [book, setBook] = useState<NotificationBook | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [showHistory, setShowHistory] = useState(false)
  const [note, setNote] = useState<{ text: string; bad: boolean } | null>(null)

  const reload = useCallback(async () => setBook(await loadMine(persona)), [persona])
  useEffect(() => { void reload() }, [reload])

  const say = (text: string, bad = false) => {
    setNote({ text, bad })
    onToast?.(text, bad ? 'error' : 'success')
    setTimeout(() => setNote(null), 5000)
  }

  if (!book) {
    return <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-tertiary)' }}>Loading your preferences…</div>
  }

  const scope: 'user' | 'partner' = partnerId ? 'partner' : 'user'
  const mine = myRules(book.rules, persona, book.preferences)
  const summary = summarisePrefs(mine)
  const groups = byCategory(mine, book.events)

  const setEnabled = async (e: Effective, enabled: boolean) => {
    const check = validatePreference(e.rule, enabled, enabled ? e.kinds : [])
    if (!check.ok) { say(check.reason, true); return }
    setBusy(e.rule.id)
    const res = await savePreference({
      rule: e.rule, current: e, enabled, kinds: enabled ? e.kinds : [], scope, partnerId,
    })
    setBusy(null)
    say(res.ok ? res.note ?? 'Saved' : res.reason, !res.ok)
    if (res.ok) await reload()
  }

  const flipKind = async (e: Effective, kind: KindId) => {
    const out = toggleKind(e.rule, e, kind)
    if (!out.ok) { say(out.reason, true); return }
    setBusy(e.rule.id)
    const res = await savePreference({
      rule: e.rule, current: e, enabled: e.enabled, kinds: out.kinds!, scope, partnerId,
    })
    setBusy(null)
    say(res.ok ? res.note ?? 'Saved' : res.reason, !res.ok)
    if (res.ok) await reload()
  }

  const restore = async (e: Effective) => {
    if (!e.pref) return
    setBusy(e.rule.id)
    const res = await resetPreference(e.pref, e.rule)
    setBusy(null)
    say(res.ok ? res.note ?? 'Reset' : res.reason, !res.ok)
    if (res.ok) await reload()
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <Banner>
        Pick what reaches you and where. The switch turns a whole subject off; the chips beside it decide which
        channels the ones you keep are sent on.
        <br />
        <strong>{summary.on} of {summary.total} on</strong>
        {summary.byKind.length > 0 && <> · {summary.byKind.map(k => `${k.kind} ${k.count}`).join(' · ')}</>}
        {summary.locked > 0 && <> · {summary.locked} cannot be switched off</>}
        {scope === 'partner' && <> · these apply to everybody on the {partnerId} account</>}
      </Banner>

      {note && (
        <div style={{
          padding: '10px 12px', borderRadius: 'var(--radius-md)', fontSize: 'var(--text-sm)',
          background: note.bad ? 'var(--danger-bg)' : 'var(--success-bg)',
          color: note.bad ? 'var(--danger)' : 'var(--success)',
          borderLeft: `3px solid ${note.bad ? 'var(--danger)' : 'var(--success)'}`,
        }}>{note.text}</div>
      )}

      {book.loadError && (
        <div style={{
          padding: '10px 12px', borderRadius: 'var(--radius-md)', fontSize: 'var(--text-sm)',
          background: 'var(--danger-bg)', color: 'var(--danger)',
        }}>{book.loadError}</div>
      )}

      {groups.map(group => (
        <Panel key={group.category} icon={<Bell size={18} />} title={group.category}>
          <div>
            {group.items.map(e => {
              const templates = book.templates.filter(t => t.rule_id === e.rule.id)
              return (
                <RuleRow
                  key={e.rule.id}
                  entry={e}
                  busy={busy === e.rule.id}
                  sample={templates}
                  onEnabled={on => setEnabled(e, on)}
                  onKind={k => flipKind(e, k)}
                  onReset={() => restore(e)}
                />
              )
            })}
          </div>
        </Panel>
      ))}

      {mine.length === 0 && (
        <Panel icon={<Bell size={18} />} title="Nothing is set up yet">
          <div style={{ padding: '16px 0', fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
            The marketplace has not published any notifications for {PERSONA_LABEL[persona].toLowerCase()} yet.
          </div>
        </Panel>
      )}

      <Panel
        icon={<History size={18} />}
        title="What was actually sent to you"
        subtitle={`${book.log.length} messages · including anything we decided not to send, and why`}
        action={
          <button onClick={() => setShowHistory(s => !s)} style={{
            display: 'flex', alignItems: 'center', gap: '4px', border: 'none', background: 'none',
            cursor: 'pointer', fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--brand-accent-dark)',
          }}>
            {showHistory ? 'Hide' : 'Show'}
            <ChevronDown size={14} style={{ transform: showHistory ? 'rotate(180deg)' : 'none', transition: 'transform 150ms' }} />
          </button>
        }
      >
        {showHistory ? <HistoryList log={book.log} /> : (
          <div style={{ padding: '12px 0', fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
            {notDelivered(book.log).length > 0
              ? `${notDelivered(book.log).length} of these never reached you. Open the list to see why.`
              : 'Everything we sent got through.'}
          </div>
        )}
      </Panel>

      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', lineHeight: 1.6 }}>
        Anything about a payment failing, a service being interrupted or a price changing is always sent,
        whatever is set here — you would want to know, and in most places we are required to tell you. Those
        subjects still let you choose the channel, as long as one is left on.
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ rows -- */

function RuleRow({ entry, busy, sample, onEnabled, onKind, onReset }: {
  entry: Effective
  busy: boolean
  sample: { kind_id: KindId; subject: string; body: string }[]
  onEnabled: (on: boolean) => void
  onKind: (k: KindId) => void
  onReset: () => void
}) {
  const [open, setOpen] = useState(false)
  const { rule } = entry
  const allowed = orderKinds(rule.kinds)

  return (
    <div data-rule={rule.id} style={{ padding: '16px 0', borderBottom: '1px solid var(--border-light, var(--border))', opacity: busy ? 0.6 : 1 }}>
      <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 260px', minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 'var(--text-sm)', marginBottom: '2px', display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
            {rule.name}
            {rule.mandatory && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '3px', fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--info)' }}>
                <Lock size={10} /> always sent
              </span>
            )}
            {entry.customised && (
              <span style={{ fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--text-tertiary)' }}>you changed this</span>
            )}
          </div>
          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', lineHeight: 1.5 }}>{rule.why}</div>
          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginTop: '3px', display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
            <span>{rule.throttle}</span>
            <span>Goes to: {rule.audience}</span>
            <span>Last sent: {rule.last_sent ?? 'never'}</span>
            <button onClick={() => setOpen(o => !o)} style={{
              border: 'none', background: 'none', padding: 0, cursor: 'pointer',
              fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--brand-accent-dark)',
            }}>{open ? 'Hide the wording' : 'See what it says'}</button>
            {entry.pref && (
              <button onClick={onReset} style={{
                border: 'none', background: 'none', padding: 0, cursor: 'pointer',
                display: 'inline-flex', alignItems: 'center', gap: '3px',
                fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--text-tertiary)',
              }}><RotateCcw size={10} /> Back to default</button>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
          {allowed.map(k => {
            const on = entry.kinds.includes(k)
            const last = on && entry.kinds.length === 1
            const stuck = last && (rule.mandatory || entry.enabled)
            return (
              <button
                key={k}
                onClick={() => onKind(k)}
                disabled={busy}
                title={stuck
                  ? rule.mandatory
                    ? 'This has to reach you somewhere — add another channel first'
                    : 'It would have nowhere to go. Turn the whole subject off instead.'
                  : undefined}
                style={{
                  display: 'flex', alignItems: 'center', gap: '4px',
                  padding: '6px 12px', borderRadius: 'var(--radius-full)',
                  border: `1px solid ${on ? 'var(--brand-accent)' : 'var(--border)'}`,
                  background: on ? 'var(--brand-accent)' : 'var(--surface, white)',
                  color: on ? 'white' : 'var(--text-secondary)',
                  fontSize: 'var(--text-xs)', fontWeight: 600,
                  cursor: busy ? 'wait' : 'pointer',
                  opacity: entry.enabled ? 1 : 0.45,
                }}
              >
                {on ? <Check size={12} /> : <Minus size={12} />}
                {k}
              </button>
            )
          })}
        </div>

        <button
          onClick={() => onEnabled(!entry.enabled)}
          disabled={busy || rule.mandatory}
          aria-label={`Turn ${rule.name} ${entry.enabled ? 'off' : 'on'}`}
          title={rule.mandatory ? 'This one cannot be switched off — choose where it reaches you instead' : undefined}
          style={{
            width: '44px', height: '24px', borderRadius: '12px', flexShrink: 0,
            background: entry.enabled ? 'var(--brand-accent)' : 'var(--border)',
            border: 'none', cursor: rule.mandatory ? 'not-allowed' : 'pointer',
            position: 'relative', transition: 'background 200ms ease',
            opacity: rule.mandatory ? 0.6 : 1,
          }}
        >
          <div style={{
            position: 'absolute', top: '3px', left: entry.enabled ? '23px' : '3px',
            width: '18px', height: '18px', borderRadius: '50%', background: 'white',
            transition: 'left 200ms ease',
          }} />
        </button>
      </div>

      {open && (
        <div style={{ marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {sample.filter(s => entry.kinds.includes(s.kind_id)).map(s => (
            <div key={s.kind_id} style={{
              padding: '10px 12px', borderRadius: 'var(--radius-md)',
              background: 'var(--bg-alt)', border: '1px solid var(--border)',
            }}>
              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', fontWeight: 700, marginBottom: '4px' }}>
                {s.kind_id.toUpperCase()}
              </div>
              <div style={{ fontSize: 'var(--text-sm)', fontWeight: 700 }}>{s.subject}</div>
              <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{s.body}</div>
            </div>
          ))}
          {sample.filter(s => entry.kinds.includes(s.kind_id)).length === 0 && (
            <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)' }}>
              Nothing is going out on this while every channel is off.
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/* --------------------------------------------------------------- history -- */

function HistoryList({ log }: { log: LogEntry[] }) {
  const [state, setState] = useState<LogState | 'all'>('all')
  const rows = filterLog(log, { state })

  const tone: Record<LogState, string> = {
    delivered: 'var(--success)', sent: 'var(--info)', queued: 'var(--text-tertiary)',
    failed: 'var(--danger)', suppressed: 'var(--warning)',
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', padding: '4px 0 12px' }}>
        {(['all', 'delivered', 'failed', 'suppressed'] as const).map(s => (
          <button key={s} onClick={() => setState(s)} style={{
            padding: '4px 12px', borderRadius: 'var(--radius-full)', cursor: 'pointer',
            border: `1px solid ${state === s ? 'var(--brand-accent)' : 'var(--border)'}`,
            background: state === s ? 'var(--brand-accent)' : 'transparent',
            color: state === s ? 'white' : 'var(--text-secondary)',
            fontSize: 'var(--text-xs)', fontWeight: 600,
          }}>
            {s === 'all' ? 'Everything' : STATE_LABEL[s]}
            {' '}({s === 'all' ? log.length : log.filter(e => e.state === s).length})
          </button>
        ))}
      </div>

      {rows.length === 0 && (
        <div style={{ padding: '12px 0', fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)' }}>Nothing here.</div>
      )}

      {rows.map(e => (
        <div key={e.id} style={{ padding: '12px 0', borderTop: '1px solid var(--border-light, var(--border))' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
            <div style={{ fontWeight: 700, fontSize: 'var(--text-sm)' }}>{e.subject}</div>
            <div style={{ fontSize: 'var(--text-xs)', fontWeight: 600, color: tone[e.state], whiteSpace: 'nowrap' }}>
              {STATE_LABEL[e.state]} · {e.kind_id} · {when(e.sent_at)}
            </div>
          </div>
          <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', marginTop: '2px', lineHeight: 1.5 }}>{e.body}</div>
          {(e.state === 'failed' || e.state === 'suppressed') && (
            <div style={{ fontSize: 'var(--text-xs)', color: tone[e.state], marginTop: '4px' }}>{explain(e)}</div>
          )}
        </div>
      ))}
    </div>
  )
}

/* ---------------------------------------------------------------- chrome -- */

/* Deliberately plain, because this component is dropped into three consoles
   with three different card components. Borrowing one console's Card would
   make the other two look like a mistake. */
function Panel({ icon, title, subtitle, action, children }: {
  icon: React.ReactNode; title: string; subtitle?: string
  action?: React.ReactNode; children: React.ReactNode
}) {
  return (
    <div style={{
      background: 'var(--surface, white)', border: '1px solid var(--border)',
      borderRadius: 'var(--radius-lg)', padding: '20px 24px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', marginBottom: '8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ color: 'var(--brand-accent-dark)', display: 'flex' }}>{icon}</span>
          <div>
            <div style={{ fontWeight: 700, fontSize: 'var(--text-base)' }}>{title}</div>
            {subtitle && <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>{subtitle}</div>}
          </div>
        </div>
        {action}
      </div>
      {children}
    </div>
  )
}

function Banner({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      background: 'var(--bg-alt)', borderRadius: 'var(--radius-lg)', padding: '16px 20px',
      display: 'flex', gap: '12px', alignItems: 'flex-start',
    }}>
      <Bell size={20} style={{ color: 'var(--brand-accent-dark)', flexShrink: 0, marginTop: 2 }} />
      <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', lineHeight: 1.6 }}>{children}</div>
    </div>
  )
}
