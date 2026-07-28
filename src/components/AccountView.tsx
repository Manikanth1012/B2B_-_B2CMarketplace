import { useState, useEffect, useCallback } from 'react'
import { User, Bell, History, Users, RotateCcw, Check, X, Plus, Minus, CircleAlert as AlertCircle, Info, Shield, Wallet, Star, Phone, Mail, MapPin, CreditCard, Clock, ChevronRight, Lock } from 'lucide-react'
import { supabase } from '../lib/supabase'
import type {
  ConsumerProfile, ConsumerNotification, ConsumerAuditEntry,
  ConsumerHouseholdMember, ConsumerRefund,
} from '../types'

type Tab = 'profile' | 'notifications' | 'activity' | 'household' | 'refunds'

const CHANNELS = ['Push', 'SMS', 'Email']

function fmtMoney(n: number): string {
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtPts(n: number): string {
  return Math.round(n).toLocaleString('en-US') + ' pts'
}

const SEV_COLORS: Record<string, string> = {
  info: '#6B7280',
  warning: '#D97706',
  high: '#DC2626',
  low: '#6B7280',
  normal: '#6B7280',
}

const REFUND_STATES: Record<string, { label: string; color: string; bg: string }> = {
  pending: { label: 'Pending', color: '#D97706', bg: '#FEF3C7' },
  refunded: { label: 'Refunded', color: '#16A34A', bg: '#DCFCE7' },
  partial: { label: 'Partial', color: '#D97706', bg: '#FEF3C7' },
  declined: { label: 'Declined', color: '#DC2626', bg: '#FEE2E2' },
}

export function AccountView() {
  const [tab, setTab] = useState<Tab>('profile')
  const [profile, setProfile] = useState<ConsumerProfile | null>(null)
  const [notifications, setNotifications] = useState<ConsumerNotification[]>([])
  const [auditLog, setAuditLog] = useState<ConsumerAuditEntry[]>([])
  const [household, setHousehold] = useState<ConsumerHouseholdMember[]>([])
  const [refunds, setRefunds] = useState<ConsumerRefund[]>([])
  const [loading, setLoading] = useState(true)
  const [toast, setToast] = useState('')

  const loadData = useCallback(async () => {
    const [pRes, nRes, aRes, hRes, rRes] = await Promise.all([
      supabase.from('consumer_profile').select('*').eq('id', 'me').maybeSingle(),
      supabase.from('consumer_notifications').select('*').order('id'),
      supabase.from('consumer_audit_log').select('*').order('when_date', { ascending: false }),
      supabase.from('consumer_household').select('*').order('joined'),
      supabase.from('consumer_refunds').select('*').order('id'),
    ])
    if (pRes.data) setProfile(pRes.data as ConsumerProfile)
    if (nRes.data) setNotifications(nRes.data as ConsumerNotification[])
    if (aRes.data) setAuditLog(aRes.data as ConsumerAuditEntry[])
    if (hRes.data) setHousehold(hRes.data as ConsumerHouseholdMember[])
    if (rRes.data) setRefunds(rRes.data as ConsumerRefund[])
    setLoading(false)
  }, [])

  useEffect(() => { loadData() }, [loadData])

  const showToast = (msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(''), 3000)
  }

  const toggleNotification = async (id: string, on: boolean) => {
    const n = notifications.find((x) => x.id === id)
    if (!n || n.mandatory) {
      showToast('This alert cannot be turned off — pick where it reaches you instead')
      return
    }
    await supabase.from('consumer_notifications').update({ on_state: on }).eq('id', id)
    setNotifications((prev) => prev.map((x) => x.id === id ? { ...x, on_state: on } : x))
    showToast(`${n.name} ${on ? 'on' : 'off'}`)
  }

  const toggleChannel = async (id: string, channel: string) => {
    const n = notifications.find((x) => x.id === id)
    if (!n) return
    const has = n.channels.includes(channel)
    if (has && n.channels.length === 1) {
      showToast(n.mandatory
        ? `${n.name} has to reach you somewhere — pick another channel first`
        : `${n.name} would have nowhere to go. Turn the whole subject off instead.`)
      return
    }
    const newChannels = has
      ? n.channels.filter((c) => c !== channel)
      : [...n.channels, channel].sort((a, b) => CHANNELS.indexOf(a) - CHANNELS.indexOf(b))
    await supabase.from('consumer_notifications').update({ channels: newChannels }).eq('id', id)
    setNotifications((prev) => prev.map((x) => x.id === id ? { ...x, channels: newChannels } : x))
    showToast(`${n.name} ${has ? 'will no longer come by' : 'will also come by'} ${channel.toLowerCase()}`)
  }

  if (loading || !profile) {
    return (
      <div className="container" style={{ padding: '80px 0', textAlign: 'center' }}>
        <div style={{ fontSize: 'var(--text-lg)', color: 'var(--text-secondary)' }}>Loading account…</div>
      </div>
    )
  }

  const tabs: { id: Tab; label: string; icon: typeof User }[] = [
    { id: 'profile', label: 'My details', icon: User },
    { id: 'notifications', label: 'Notifications', icon: Bell },
    { id: 'activity', label: 'Account activity', icon: History },
    { id: 'household', label: 'Household', icon: Users },
    { id: 'refunds', label: 'Refunds', icon: RotateCcw },
  ]

  return (
    <div className="container" style={{ padding: '32px 0' }}>
      {/* Header */}
      <div style={{ marginBottom: '32px' }}>
        <h1 style={{ fontSize: 'var(--text-3xl)', fontWeight: 800, marginBottom: '8px' }}>My account</h1>
        <p style={{ fontSize: 'var(--text-base)', color: 'var(--text-secondary)' }}>
          {profile.name} · {profile.customer_id} · {profile.since}
        </p>
      </div>

      {/* Tab bar */}
      <div style={{
        display: 'flex',
        gap: '4px',
        borderBottom: '2px solid var(--border)',
        marginBottom: '32px',
        overflowX: 'auto',
      }}>
        {tabs.map((t) => {
          const Icon = t.icon
          const active = tab === t.id
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '12px 18px',
                border: 'none',
                background: 'none',
                borderBottom: active ? '3px solid var(--brand-accent)' : '3px solid transparent',
                color: active ? 'var(--brand-accent)' : 'var(--text-secondary)',
                fontWeight: active ? 700 : 500,
                fontSize: 'var(--text-sm)',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                marginBottom: '-2px',
                transition: 'all 200ms ease',
              }}
            >
              <Icon size={16} />
              {t.label}
            </button>
          )
        })}
      </div>

      {/* Tab content */}
      {tab === 'profile' && <ProfileTab profile={profile} showToast={showToast} />}
      {tab === 'notifications' && (
        <NotificationsTab
          notifications={notifications}
          onToggle={toggleNotification}
          onToggleChannel={toggleChannel}
        />
      )}
      {tab === 'activity' && <ActivityTab log={auditLog} />}
      {tab === 'household' && <HouseholdTab members={household} showToast={showToast} />}
      {tab === 'refunds' && <RefundsTab refunds={refunds} />}

      {/* Toast */}
      {toast && (
        <div style={{
          position: 'fixed', bottom: '24px', left: '50%', transform: 'translateX(-50%)',
          background: 'var(--brand-navy)', color: 'white', padding: '12px 24px',
          borderRadius: 'var(--radius-lg)', fontSize: 'var(--text-sm)', fontWeight: 600,
          zIndex: 300, boxShadow: 'var(--shadow-lg)',
        }}>
          {toast}
        </div>
      )}
    </div>
  )
}

/* ============================== PROFILE TAB ============================== */
function ProfileTab({ profile, showToast }: { profile: ConsumerProfile; showToast: (m: string) => void }) {
  const [name, setName] = useState(profile.name)
  const [email, setEmail] = useState(profile.email)
  const [phone, setPhone] = useState(profile.msisdn)
  const [city, setCity] = useState(profile.city)
  const [saving, setSaving] = useState(false)

  const save = async () => {
    setSaving(true)
    await supabase.from('consumer_profile').update({
      name, email, msisdn: phone, city,
    }).eq('id', 'me')
    setSaving(false)
    showToast('Your details have been saved')
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '24px' }}>
      {/* Profile card */}
      <Card icon={<User size={18} />} title="Personal details">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <Field label="Full name" icon={<User size={14} />}>
            <input style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Email" icon={<Mail size={14} />}>
            <input style={inputStyle} value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field label="Phone" icon={<Phone size={14} />}>
            <input style={inputStyle} value={phone} onChange={(e) => setPhone(e.target.value)} />
          </Field>
          <Field label="City" icon={<MapPin size={14} />}>
            <input style={inputStyle} value={city} onChange={(e) => setCity(e.target.value)} />
          </Field>
          <button
            onClick={save}
            disabled={saving}
            style={{
              padding: '10px 24px', borderRadius: 'var(--radius)', border: 'none',
              background: 'var(--brand-accent)', color: 'white', fontWeight: 600,
              fontSize: 'var(--text-sm)', cursor: saving ? 'not-allowed' : 'pointer',
              alignSelf: 'flex-start',
            }}
          >
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </Card>

      {/* Account summary */}
      <Card icon={<Star size={18} />} title="Account summary">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <SummaryRow label="Customer ID" value={profile.customer_id} />
          <SummaryRow label="Member since" value={profile.since} />
          <SummaryRow label="Tier" value={profile.tier} />
          <SummaryRow label="Wallet balance" value={fmtMoney(profile.wallet)} />
          <SummaryRow label="Reward points" value={fmtPts(profile.points)} />
          <SummaryRow label="Payment method" value={profile.payment_method} />
        </div>
      </Card>

      {/* Security */}
      <Card icon={<Shield size={18} />} title="Sign-in & security">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <SecurityRow icon={<Lock size={16} />} label="Password" value="Last changed 12 Jun 2026" action="Change" />
          <SecurityRow icon={<Shield size={16} />} label="Two-factor auth" value="Enabled" action="Manage" positive />
          <SecurityRow icon={<CreditCard size={16} />} label="Payment methods" value="3 saved (1 expired)" action="Manage" />
          <SecurityRow icon={<Clock size={16} />} label="Active sessions" value="2 devices" action="Sign out all" />
        </div>
      </Card>
    </div>
  )
}

/* ============================ NOTIFICATIONS TAB ============================ */
function NotificationsTab({
  notifications, onToggle, onToggleChannel,
}: {
  notifications: ConsumerNotification[]
  onToggle: (id: string, on: boolean) => void
  onToggleChannel: (id: string, channel: string) => void
}) {
  const onCount = notifications.filter((n) => n.on_state).length
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <div style={{
        background: 'var(--bg-alt)', borderRadius: 'var(--radius-lg)', padding: '16px 20px',
        display: 'flex', gap: '12px', alignItems: 'flex-start',
      }}>
        <Info size={20} style={{ color: 'var(--brand-accent)', flexShrink: 0, marginTop: 2 }} />
        <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
          Pick what reaches you and how it reaches you. A switch turns the whole subject off; the channels next to it decide where the ones you keep are sent.
          <br />
          <strong>{onCount} of {notifications.length} on</strong> · Push {notifications.filter((n) => n.on_state && n.channels.includes('Push')).length} · SMS {notifications.filter((n) => n.on_state && n.channels.includes('SMS')).length} · Email {notifications.filter((n) => n.on_state && n.channels.includes('Email')).length}
        </div>
      </div>

      <Card icon={<Bell size={18} />} title="What you want to hear about">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0' }}>
          {notifications.map((n) => (
            <div
              key={n.id}
              style={{
                display: 'flex', gap: '12px', alignItems: 'center',
                padding: '16px 0', borderBottom: '1px solid var(--border-light)',
              }}
            >
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 'var(--text-sm)', marginBottom: '2px' }}>
                  {n.name}
                  {n.mandatory && (
                    <span style={{ marginLeft: '8px', fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
                      — Always sent, we are required to tell you
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>{n.event}</div>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginTop: '2px' }}>
                  Last sent: {n.last_sent || 'Never'}
                </div>
              </div>

              {/* Channel chips */}
              <div style={{ display: 'flex', gap: '6px' }}>
                {CHANNELS.map((c) => {
                  const on = n.channels.includes(c)
                  const onlyOn = on && n.channels.length === 1
                  return (
                    <button
                      key={c}
                      onClick={() => onToggleChannel(n.id, c)}
                      disabled={n.mandatory && onlyOn}
                      style={{
                        display: 'flex', alignItems: 'center', gap: '4px',
                        padding: '6px 12px', borderRadius: 'var(--radius-full)',
                        border: `1px solid ${on ? 'var(--brand-accent)' : 'var(--border)'}`,
                        background: on ? 'var(--brand-accent)' : 'white',
                        color: on ? 'white' : 'var(--text-secondary)',
                        fontSize: 'var(--text-xs)', fontWeight: 600,
                        cursor: n.mandatory && onlyOn ? 'not-allowed' : 'pointer',
                        opacity: n.mandatory && onlyOn ? 0.6 : 1,
                      }}
                    >
                      {on ? <Check size={12} /> : <Minus size={12} />}
                      {c}
                    </button>
                  )
                })}
              </div>

              {/* Toggle */}
              <button
                onClick={() => onToggle(n.id, !n.on_state)}
                disabled={n.mandatory}
                style={{
                  width: '44px', height: '24px', borderRadius: '12px',
                  background: n.on_state ? 'var(--brand-accent)' : 'var(--border)',
                  border: 'none', cursor: n.mandatory ? 'not-allowed' : 'pointer',
                  position: 'relative', transition: 'background 200ms ease',
                  flexShrink: 0,
                }}
                aria-label={`Toggle ${n.name}`}
              >
                <div style={{
                  position: 'absolute', top: '3px', left: n.on_state ? '23px' : '3px',
                  width: '18px', height: '18px', borderRadius: '50%', background: 'white',
                  transition: 'left 200ms ease',
                }} />
              </button>
            </div>
          ))}
        </div>
        <div style={{ marginTop: '16px', fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
          Anything about a payment failing or your service being interrupted is always sent, whatever is set here — you would want to know, and in most places we have to tell you. Those subjects still let you choose the channel, as long as one is left on.
        </div>
      </Card>

      {/* Delivery log */}
      <Card icon={<History size={18} />} title="What we sent you" subtitle="Recent messages delivered to your channels">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0' }}>
          {[
            { when: '20 min ago', rule: 'Order and delivery updates', chan: 'Push, SMS', state: 'delivered' },
            { when: '2 h ago', rule: 'Delivery problem', chan: 'Push, SMS, Email', state: 'delivered' },
            { when: 'Yesterday', rule: 'Before a subscription renews', chan: 'Push, Email', state: 'delivered' },
            { when: '4 d ago', rule: 'A household member asks to buy', chan: 'Push', state: 'delivered' },
            { when: '2 w ago', rule: 'Spend cap reached', chan: 'Push, Email', state: 'delivered' },
          ].map((d, i) => (
            <div key={i} style={{
              display: 'flex', gap: '12px', alignItems: 'center',
              padding: '12px 0', borderBottom: '1px solid var(--border-light)',
            }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: 'var(--text-sm)' }}>{d.rule}</div>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>{d.when} · {d.chan}</div>
              </div>
              <span style={{
                padding: '4px 10px', borderRadius: 'var(--radius-full)',
                fontSize: 'var(--text-xs)', fontWeight: 600,
                background: '#DCFCE7', color: '#16A34A',
              }}>
                {d.state}
              </span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  )
}

/* ============================== ACTIVITY TAB ============================== */
function ActivityTab({ log }: { log: ConsumerAuditEntry[] }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <div style={{
        background: 'var(--bg-alt)', borderRadius: 'var(--radius-lg)', padding: '16px 20px',
        display: 'flex', gap: '12px', alignItems: 'flex-start',
      }}>
        <Info size={20} style={{ color: 'var(--brand-accent)', flexShrink: 0, marginTop: 2 }} />
        <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
          <strong>Everything that has happened on this account.</strong> Who bought what, who changed a spend cap, when a password was changed. As the account owner you see all of it; everyone else on the account sees only their own orders. Nothing here can be deleted, including by you — which is the point of it.
        </div>
      </div>

      <Card icon={<History size={18} />} title="Account activity log" subtitle={`${log.length} entries on record`}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--text-sm)' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid var(--border)' }}>
                <th style={thStyle}>When</th>
                <th style={thStyle}>What</th>
                <th style={thStyle}>Category</th>
                <th style={thStyle}>Detail</th>
              </tr>
            </thead>
            <tbody>
              {log.map((e) => (
                <tr key={e.id} style={{ borderBottom: '1px solid var(--border-light)' }}>
                  <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>{e.when_date}</td>
                  <td style={tdStyle}>
                    <div style={{ fontWeight: 600 }}>{e.label}</div>
                    <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>{e.action}</div>
                  </td>
                  <td style={tdStyle}>
                    <span style={{
                      padding: '2px 8px', borderRadius: 'var(--radius-full)',
                      fontSize: 'var(--text-xs)', fontWeight: 600,
                      background: 'var(--bg-alt)', color: SEV_COLORS[e.severity] || 'var(--text-secondary)',
                    }}>
                      {e.category}
                    </span>
                  </td>
                  <td style={{ ...tdStyle, color: 'var(--text-secondary)' }}>{e.detail || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}

/* ============================== HOUSEHOLD TAB ============================== */
function HouseholdTab({ members, showToast }: { members: ConsumerHouseholdMember[]; showToast: (m: string) => void }) {
  const active = members.filter((m) => m.status === 'active')
  const capped = members.filter((m) => m.cap !== null && m.cap > 0)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <div style={{
        background: 'var(--bg-alt)', borderRadius: 'var(--radius-lg)', padding: '16px 20px',
        display: 'flex', gap: '12px', alignItems: 'flex-start',
      }}>
        <Users size={20} style={{ color: 'var(--brand-accent)', flexShrink: 0, marginTop: 2 }} />
        <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
          Everyone here shares one bill and one basket history, but each person only sees their own orders.
          {' '}
          <strong>{capped.length} {capped.length === 1 ? 'person has' : 'people have'}</strong> a monthly spend cap; anything above it comes to you to approve.
        </div>
      </div>

      <Card icon={<Users size={18} />} title="People on this account" subtitle={`${active.length} active · ${members.length - active.length} invited`}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0' }}>
          {members.map((m) => (
            <div key={m.id} style={{
              display: 'flex', gap: '16px', alignItems: 'center',
              padding: '16px 0', borderBottom: '1px solid var(--border-light)',
            }}>
              {/* Avatar */}
              <div style={{
                width: '44px', height: '44px', borderRadius: '50%',
                background: m.is_you ? 'var(--brand-accent)' : 'var(--bg-alt)',
                color: m.is_you ? 'white' : 'var(--text-secondary)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontWeight: 700, fontSize: 'var(--text-sm)', flexShrink: 0,
              }}>
                {m.name.split(' ').map((w) => w[0]).join('').slice(0, 2)}
              </div>

              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 'var(--text-sm)' }}>
                  {m.name}
                  {m.is_you && <span style={{ marginLeft: '8px', fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>(you)</span>}
                </div>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>{m.email}</div>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginTop: '2px' }}>
                  {m.role_name} · Joined {m.joined} · Last active {m.last_active || 'Never'}
                </div>
              </div>

              {/* MFA badge */}
              <div style={{
                display: 'flex', alignItems: 'center', gap: '4px',
                fontSize: 'var(--text-xs)', fontWeight: 600,
                color: m.mfa ? '#16A34A' : '#D97706',
              }}>
                <Shield size={14} />
                {m.mfa ? '2FA on' : 'No 2FA'}
              </div>

              {/* Cap */}
              {m.cap !== null && m.cap > 0 && (
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>Monthly cap</div>
                  <div style={{ fontWeight: 700, fontSize: 'var(--text-sm)' }}>{fmtMoney(m.cap)}</div>
                  <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
                    {fmtMoney(m.spent)} spent
                  </div>
                </div>
              )}

              {/* Status */}
              <span style={{
                padding: '4px 10px', borderRadius: 'var(--radius-full)',
                fontSize: 'var(--text-xs)', fontWeight: 600,
                background: m.status === 'active' ? '#DCFCE7' : '#FEF3C7',
                color: m.status === 'active' ? '#16A34A' : '#D97706',
                flexShrink: 0,
              }}>
                {m.status}
              </span>
            </div>
          ))}
        </div>
        <button
          onClick={() => showToast('Invite sent — the link is valid for 7 days')}
          style={{
            marginTop: '16px', display: 'inline-flex', alignItems: 'center', gap: '8px',
            padding: '10px 20px', borderRadius: 'var(--radius)', border: '1px solid var(--brand-accent)',
            background: 'white', color: 'var(--brand-accent)', fontWeight: 600,
            fontSize: 'var(--text-sm)', cursor: 'pointer',
          }}
        >
          <Plus size={16} /> Add someone
        </button>
      </Card>
    </div>
  )
}

/* ============================== REFUNDS TAB ============================== */
function RefundsTab({ refunds }: { refunds: ConsumerRefund[] }) {
  const total = refunds.filter((r) => r.state === 'refunded' || r.state === 'partial')
    .reduce((a, r) => a + r.amount, 0)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '16px' }}>
        <StatBox icon={<RotateCcw size={20} />} label="Total refunds" value={fmtMoney(total)} />
        <StatBox icon={<Clock size={20} />} label="Pending" value={String(refunds.filter((r) => r.state === 'pending').length)} />
        <StatBox icon={<Check size={20} />} label="Completed" value={String(refunds.filter((r) => r.state === 'refunded').length)} />
      </div>

      <Card icon={<RotateCcw size={18} />} title="Your refunds" subtitle={`${refunds.length} refund requests on record`}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0' }}>
          {refunds.map((r) => {
            const st = REFUND_STATES[r.state] || REFUND_STATES.pending
            return (
              <div key={r.id} style={{
                display: 'flex', gap: '16px', alignItems: 'flex-start',
                padding: '16px 0', borderBottom: '1px solid var(--border-light)',
              }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: 'var(--text-sm)', marginBottom: '2px' }}>
                    {r.item}
                  </div>
                  <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginBottom: '4px' }}>
                    {r.id} · Order {r.order_ref} · {r.seller}
                  </div>
                  <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>{r.reason}</div>
                  {r.note && (
                    <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginTop: '4px' }}>
                      {r.decided ? `Decided ${r.decided} — ` : ''}{r.note}
                    </div>
                  )}
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <div style={{ fontWeight: 800, fontSize: 'var(--text-lg)', marginBottom: '4px' }}>{fmtMoney(r.amount)}</div>
                  <span style={{
                    padding: '4px 10px', borderRadius: 'var(--radius-full)',
                    fontSize: 'var(--text-xs)', fontWeight: 600,
                    background: st.bg, color: st.color,
                  }}>
                    {st.label}
                  </span>
                </div>
              </div>
            )
          })}
        </div>
      </Card>
    </div>
  )
}

/* ============================== SHARED UI ============================== */
const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '10px 14px',
  borderRadius: 'var(--radius)',
  border: '1px solid var(--border)',
  fontSize: 'var(--text-sm)',
  outline: 'none',
  transition: 'border-color 200ms ease',
}

const thStyle: React.CSSProperties = {
  textAlign: 'left',
  padding: '10px 12px',
  fontWeight: 600,
  fontSize: 'var(--text-xs)',
  color: 'var(--text-tertiary)',
}

const tdStyle: React.CSSProperties = {
  padding: '10px 12px',
}

function Card({ icon, title, subtitle, children }: { icon: React.ReactNode; title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div style={{
      background: 'white',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius-lg)',
      padding: '24px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '4px' }}>
        <span style={{ color: 'var(--brand-accent)' }}>{icon}</span>
        <h2 style={{ fontWeight: 700, fontSize: 'var(--text-lg)' }}>{title}</h2>
      </div>
      {subtitle && <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginBottom: '20px' }}>{subtitle}</p>}
      {!subtitle && <div style={{ marginBottom: '20px' }} />}
      {children}
    </div>
  )
}

function Field({ label, icon, children }: { label: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <label style={{
        display: 'flex', alignItems: 'center', gap: '6px',
        fontSize: 'var(--text-sm)', fontWeight: 600, marginBottom: '6px',
        color: 'var(--text-secondary)',
      }}>
        {icon} {label}
      </label>
      {children}
    </div>
  )
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      padding: '10px 0', borderBottom: '1px solid var(--border-light)',
    }}>
      <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>{label}</span>
      <span style={{ fontWeight: 600, fontSize: 'var(--text-sm)' }}>{value}</span>
    </div>
  )
}

function SecurityRow({ icon, label, value, action, positive }: { icon: React.ReactNode; label: string; value: string; action: string; positive?: boolean }) {
  return (
    <div style={{
      display: 'flex', gap: '12px', alignItems: 'center',
      padding: '10px 0', borderBottom: '1px solid var(--border-light)',
    }}>
      <span style={{ color: positive ? '#16A34A' : 'var(--text-tertiary)' }}>{icon}</span>
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 600, fontSize: 'var(--text-sm)' }}>{label}</div>
        <div style={{ fontSize: 'var(--text-xs)', color: positive ? '#16A34A' : 'var(--text-tertiary)' }}>{value}</div>
      </div>
      <button style={{
        padding: '6px 14px', borderRadius: 'var(--radius)', border: '1px solid var(--border)',
        background: 'white', color: 'var(--text-secondary)', fontWeight: 600,
        fontSize: 'var(--text-xs)', cursor: 'pointer',
      }}>
        {action}
      </button>
    </div>
  )
}

function StatBox({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div style={{
      background: 'white', border: '1px solid var(--border)',
      borderRadius: 'var(--radius-lg)', padding: '20px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px', color: 'var(--brand-accent)' }}>
        {icon}
        <span style={{ fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--text-tertiary)' }}>{label}</span>
      </div>
      <div style={{ fontSize: 'var(--text-2xl)', fontWeight: 800 }}>{value}</div>
    </div>
  )
}
