import { useState, useEffect, useCallback } from 'react'
import { User, Bell, History, Users, RotateCcw, Check, X, Plus, CircleAlert as AlertCircle, Info, Shield, Wallet, Star, Phone, Mail, MapPin, CreditCard, Clock, ChevronRight, Lock, Trash2, FileText, LifeBuoy, MessageSquare, Send, Download, Globe, Eye, FolderOpen } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { changePassword, currentEmail, SignInError } from '../lib/authRepo'
import { WalletCard } from './WalletCard'
import { checkNewPassword, strengthOf, isDemoAccount, MIN_LENGTH } from '../lib/password'
import { paymentSummary } from '../lib/payments'
import { LANGUAGES, TIME_ZONES, DATA_UNITS, effectivePreferences, isAuditable } from '../lib/preferences'
import { PrivacyCard } from './PrivacyCard'
import { NotificationPreferencesView } from './NotificationPreferencesView'
import { AddressBookCard } from './AddressBookCard'
import { StockWatchCard } from './StockWatchCard'
import { CustomerDocuments } from './consumer/CustomerDocuments'
import type { Viewer } from '../lib/evidence'
import { MyReviewsCard } from './MyReviewsCard'
import type {
  ConsumerProfile, ConsumerAuditEntry,
  ConsumerHouseholdMember, ConsumerPaymentMethod,
  ConsumerBill, ConsumerTicket, TicketMessage,
} from '../types'
import { BillDocument } from './BillDocument'
import { Pager, usePaging } from './Pager'
import { templateForBill, sectionIds, factsFor, asText, fileNameFor } from '../lib/consumerBillDoc'
import { loadBillBook } from '../lib/consumerBillDocRepo'
import { billPdf, pdfNameFor, saveBlob } from '../lib/billPdf'
import type { BillBook } from '../lib/consumerBillDoc'
import { loadMyRefunds, requestRefund } from '../lib/refundRepo'
import type { RefundBook } from '../lib/refundRepo'
import { STATES, REASONS, REASON_LIST, sla, ownership, autoApproves } from '../lib/refunds'
import type { RefundPolicy, RefundReason } from '../lib/refunds'

type Tab = 'profile' | 'security' | 'notifications' | 'activity' | 'household' | 'wallet' | 'refunds' | 'bills' | 'documents' | 'support'

function isTab(v: string): v is Tab {
  return ['profile', 'security', 'notifications', 'activity', 'household', 'wallet', 'refunds', 'bills', 'documents', 'support'].includes(v)
}


function fmtMoney(n: number): string {
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtPts(n: number): string {
  return Math.round(n).toLocaleString('en-US') + ' pts'
}

const SEV_COLORS: Record<string, string> = {
  info: '#6B7280',
  warning: 'var(--warning)',
  high: 'var(--danger)',
  low: '#6B7280',
  normal: '#6B7280',
}

const REFUND_STATES: Record<string, { label: string; color: string; bg: string }> = {
  pending: { label: 'Pending', color: 'var(--warning)', bg: '#FEF3C7' },
  refunded: { label: 'Refunded', color: 'var(--success)', bg: '#DCFCE7' },
  partial: { label: 'Partial', color: 'var(--warning)', bg: '#FEF3C7' },
  declined: { label: 'Declined', color: 'var(--danger)', bg: '#FEE2E2' },
}

export function AccountView({ initialTab, onWatchesChanged }: {
  initialTab?: string
  /* Cancelling a restock alert here changes what a product tile says elsewhere. */
  onWatchesChanged?: () => void
}) {
  const [tab, setTab] = useState<Tab>(initialTab && isTab(initialTab) ? initialTab : 'profile')

  /* initialTab is read once at mount, so choosing a different item from the account
     menu while already on this screen would change nothing — the same "the link does
     not work" symptom, one layer down. */
  useEffect(() => {
    if (initialTab && isTab(initialTab)) setTab(initialTab)
  }, [initialTab])
  const [profile, setProfile] = useState<ConsumerProfile | null>(null)
  const [auditLog, setAuditLog] = useState<ConsumerAuditEntry[]>([])
  const [household, setHousehold] = useState<ConsumerHouseholdMember[]>([])
  const [refundBook, setRefundBook] = useState<RefundBook>({ refunds: [], policy: null, windows: [] })
  const [bills, setBills] = useState<ConsumerBill[]>([])
  const [tickets, setTickets] = useState<ConsumerTicket[]>([])
  const [loading, setLoading] = useState(true)
  const [toast, setToast] = useState('')

  const loadData = useCallback(async () => {
    const [pRes, aRes, hRes, bRes, tRes, refunds] = await Promise.all([
      supabase.from('consumer_profile').select('*').eq('id', 'me').maybeSingle(),
      supabase.from('consumer_audit_log').select('*').order('when_date', { ascending: false }),
      supabase.from('consumer_household').select('*').order('joined'),
      supabase.from('consumer_bills').select('*').order('id', { ascending: false }),
      supabase.from('support_tickets').select('*').order('opened_at', { ascending: false }),
      loadMyRefunds(),
    ])
    if (pRes.data) setProfile(pRes.data as ConsumerProfile)
    if (aRes.data) setAuditLog(aRes.data as ConsumerAuditEntry[])
    if (hRes.data) setHousehold(hRes.data as ConsumerHouseholdMember[])
    setRefundBook(refunds)
    if (bRes.data) setBills(bRes.data as ConsumerBill[])
    if (tRes.data) setTickets(tRes.data as ConsumerTicket[])
    setLoading(false)
  }, [])

  useEffect(() => { loadData() }, [loadData])

  const showToast = (msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(''), 3000)
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
    { id: 'security', label: 'Sign-in & security', icon: Shield },
    { id: 'notifications', label: 'Notifications', icon: Bell },
    { id: 'activity', label: 'Account activity', icon: History },
    { id: 'household', label: 'Household', icon: Users },
    { id: 'wallet', label: 'Wallet', icon: Wallet },
    { id: 'refunds', label: 'Refunds', icon: RotateCcw },
    { id: 'bills', label: 'Bills', icon: FileText },
    { id: 'documents', label: 'Documents', icon: FolderOpen },
    { id: 'support', label: 'Help & Support', icon: LifeBuoy },
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

      {/* Tab bar.
          Wraps rather than scrolls. Ten tabs no longer fit a 1280px column, and
          a strip that scrolls sideways puts the last tab — Help & Support, and
          before it Documents — somewhere nobody will look for it. Two rows of
          tabs cost thirty pixels of height and hide nothing. */}
      <div style={{
        display: 'flex',
        flexWrap: 'wrap',
        rowGap: '2px',
        gap: '4px',
        borderBottom: '2px solid var(--border)',
        marginBottom: '32px',
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
      {tab === 'profile' && <ProfileTab profile={profile} showToast={showToast} onWatchesChanged={onWatchesChanged} />}
      {tab === 'security' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '24px' }}>
          <SecurityTab profile={profile} showToast={showToast} />
          <PrivacyCard profile={profile} showToast={showToast} />
        </div>
      )}
      {tab === 'notifications' && (
        <NotificationPreferencesView persona="consumer" onToast={(m) => showToast(m)} />
      )}
      {tab === 'activity' && <ActivityTab log={auditLog} />}
      {tab === 'household' && <HouseholdTab members={household} showToast={showToast} />}
      {tab === 'wallet' && <WalletTab />}
      {tab === 'refunds' && <RefundsTab book={refundBook} onChanged={loadData} showToast={showToast} />}
      {tab === 'bills' && <BillsTab bills={bills} showToast={showToast} />}
      {tab === 'documents' && (
        /* The customer's own id is the folder their documents are filed under,
           and the profile already carries it. */
        <CustomerDocuments viewer={{ persona: 'consumer', customerId: profile.customer_id } as Viewer} />
      )}
      {tab === 'support' && <SupportTab tickets={tickets} showToast={showToast} />}

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
function ProfileTab({ profile, showToast, onWatchesChanged }: {
  profile: ConsumerProfile
  showToast: (m: string) => void
  onWatchesChanged?: () => void
}) {
  const [name, setName] = useState(profile.name)
  const [email, setEmail] = useState(profile.email)
  const [phone, setPhone] = useState(profile.msisdn)
  const [city, setCity] = useState(profile.city)
  const [saving, setSaving] = useState(false)
  const [modal, setModal] = useState<null | 'password' | 'mfa' | 'payments' | 'sessions'>(null)
  /* Counted from the table rather than written into the markup. This row said
     "3 saved (1 expired)" whatever was actually stored, which is why the whole
     section read as decoration — adding a card changed nothing on the screen
     behind it. */
  const [cards, setCards] = useState<ConsumerPaymentMethod[]>([])
  const prefs = effectivePreferences(profile)
  const [language, setLanguage] = useState(prefs.language)
  const [timeZone, setTimeZone] = useState(prefs.timeZone)
  const [units, setUnits] = useState(prefs.units)

  const loadCards = useCallback(async () => {
    const { data } = await supabase.from('consumer_payment_methods').select('*')
    if (data) setCards(data as ConsumerPaymentMethod[])
  }, [])

  useEffect(() => { loadCards() }, [loadCards])

  const save = async () => {
    setSaving(true)
    await supabase.from('consumer_profile').update({
      name, email, msisdn: phone, city,
    }).eq('id', 'me')
    setSaving(false)
    showToast('Your details have been saved')
  }

  /* Preferences save on change rather than behind the button — a picker that needs a
     separate Save is the commonest way a setting silently fails to stick. */
  const savePreference = async (
    field: 'language' | 'timeZone' | 'units',
    value: string,
    label: string,
  ) => {
    const column = field === 'language' ? 'preferred_language' : field === 'timeZone' ? 'time_zone' : 'data_units'
    await supabase.from('consumer_profile').update({ [column]: value }).eq('id', 'me')

    /* Language and time zone change what the customer is sent and when, so an agent
       looking at a "why did I get this in English" complaint needs the date. Data
       units are cosmetic and are not worth a log line. */
    if (isAuditable(field)) {
      const now = new Date()
      await supabase.from('consumer_audit_log').insert({
        id: 'AUD-CU-' + Date.now(),
        when_date: now.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) + ' ' +
                   now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
        action: field === 'language' ? 'preference.language' : 'preference.timezone',
        label: `${label} changed`, category: 'Preferences', severity: 'info',
        detail: `Set to ${value}`,
      })
    }
    showToast(`${label} updated`)
  }

  return (
    <>
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
                background: 'var(--brand-accent-dark)', color: 'white', fontWeight: 600,
                fontSize: 'var(--text-sm)', cursor: saving ? 'not-allowed' : 'pointer',
                alignSelf: 'flex-start',
              }}
            >
              {saving ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </Card>

        {/* Preferences — the prototype's three-up grid. Language decides what the
            marketplace writes to this customer in; the marketplace serves India, UAE
            and Kenya, so the options are those regions'. */}
        <Card icon={<Globe size={18} />} title="Preferences" subtitle="How we talk to you">
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <Field label="Preferred language" icon={<Globe size={14} />}>
              <select
                style={inputStyle}
                value={language}
                onChange={(e) => { setLanguage(e.target.value as typeof language); savePreference('language', e.target.value, 'Preferred language') }}
              >
                {LANGUAGES.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}
              </select>
            </Field>
            <Field label="Time zone" icon={<Clock size={14} />}>
              <select
                style={inputStyle}
                value={timeZone}
                onChange={(e) => { setTimeZone(e.target.value); savePreference('timeZone', e.target.value, 'Time zone') }}
              >
                {TIME_ZONES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </Field>
            <Field label="Data units" icon={<Info size={14} />}>
              <select
                style={inputStyle}
                value={units}
                onChange={(e) => { setUnits(e.target.value as typeof units); savePreference('units', e.target.value, 'Data units') }}
              >
                {DATA_UNITS.map(u => <option key={u} value={u}>{u}</option>)}
              </select>
            </Field>
            <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', margin: 0, lineHeight: 1.5 }}>
              Bills, order updates and support replies follow your language. Changes save straight away.
            </p>
          </div>
        </Card>

        <AddressBookCard showToast={showToast} />

        <StockWatchCard showToast={showToast} onChanged={onWatchesChanged} />

        <MyReviewsCard showToast={showToast} />

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
      </div>

    </>
  )
}


/* Sign-in and security, its own tab. It used to be one card at the bottom of My
   details, which had grown to eight cards — and the account menu's "Sign-in &
   security" had nowhere to point at. */
function SecurityTab({ profile, showToast }: { profile: ConsumerProfile; showToast: (m: string) => void }) {
  const [modal, setModal] = useState<null | 'password' | 'mfa' | 'payments' | 'sessions'>(null)
  const [cards, setCards] = useState<ConsumerPaymentMethod[]>([])

  const loadCards = useCallback(async () => {
    const { data } = await supabase.from('consumer_payment_methods').select('*')
    if (data) setCards(data as ConsumerPaymentMethod[])
  }, [])
  useEffect(() => { loadCards() }, [loadCards])

  return (
    <>
        <Card icon={<Shield size={18} />} title="Sign-in & security">
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <SecurityRow
              icon={<Lock size={16} />}
              label="Password"
              value={`Last changed ${profile.pwd_changed}`}
              action="Change"
              onClick={() => setModal('password')}
            />
            <SecurityRow
              icon={<Shield size={16} />}
              label="Two-factor auth"
              value={profile.mfa_enabled ? 'Enabled' : 'Not enabled'}
              action={profile.mfa_enabled ? 'Manage' : 'Enable'}
              positive={profile.mfa_enabled}
              onClick={() => setModal('mfa')}
            />
            <SecurityRow
              icon={<CreditCard size={16} />}
              label="Payment methods"
              value={paymentSummary(cards)}
              action="Manage"
              onClick={() => setModal('payments')}
            />
            <SecurityRow
              icon={<Clock size={16} />}
              label="Active sessions"
              value={`${profile.active_sessions} ${profile.active_sessions === 1 ? 'device' : 'devices'}`}
              action="Sign out all"
              onClick={() => setModal('sessions')}
            />
          </div>
        </Card>
      {modal === 'password' && <PasswordModal profile={profile} onClose={() => setModal(null)} showToast={showToast} />}
      {modal === 'mfa' && <MfaModal profile={profile} onClose={() => setModal(null)} showToast={showToast} />}
      {modal === 'payments' && <PaymentsModal onClose={() => { setModal(null); loadCards() }} showToast={showToast} />}
      {modal === 'sessions' && <SessionsModal profile={profile} onClose={() => setModal(null)} showToast={showToast} />}
    </>
  )
}

/* ============================ SECURITY MODALS ============================ */
function Modal({ title, onClose, children, wide }: {
  title: string; onClose: () => void; children: React.ReactNode; wide?: boolean
}) {
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 400,
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'white', borderRadius: 'var(--radius-lg)', padding: '28px',
          maxWidth: wide ? '680px' : '480px', width: '100%', maxHeight: '90vh', overflowY: 'auto',
          boxShadow: 'var(--shadow-lg)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <h2 style={{ fontSize: 'var(--text-xl)', fontWeight: 800 }}>{title}</h2>
          <button onClick={onClose} style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text-tertiary)' }}>
            <X size={20} />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

function PasswordModal({ profile, onClose, showToast }: { profile: ConsumerProfile; onClose: () => void; showToast: (m: string) => void }) {
  const [cur, setCur] = useState('')
  const [nw, setNw] = useState('')
  const [confirm, setConfirm] = useState('')
  const [err, setErr] = useState('')
  const [saving, setSaving] = useState(false)
  /* Keyed on the address the session is authenticated as, not profile.email — those
     differ by design (priya.raman@example.com signs in; the profile shows
     priya.raman@6dtech.co.in), and it is the sign-in identity that is shared. */
  const [authEmail, setAuthEmail] = useState<string | null>(null)
  useEffect(() => { currentEmail().then(setAuthEmail) }, [])
  const demo = authEmail !== null && isDemoAccount(authEmail)
  const strength = strengthOf(nw)

  const submit = async () => {
    setErr('')
    const check = checkNewPassword(cur, nw, confirm)
    if (!check.ok) { setErr(check.reason!); return }

    setSaving(true)
    try {
      /* This used to stamp pwd_changed and write an audit row without ever calling
         Supabase Auth — it reported success and the password did not change. It now
         actually changes, which means the current password is genuinely checked. */
      await changePassword(cur, nw)
    } catch (e) {
      setSaving(false)
      setErr(e instanceof SignInError ? e.message : 'We could not change your password just now.')
      return
    }

    const today = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
    await supabase.from('consumer_profile').update({ pwd_changed: today }).eq('id', 'me')
    await supabase.from('consumer_audit_log').insert({
      id: 'AUD-CU-' + Date.now(), when_date: today + ' ' + new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
      action: 'password.changed', label: 'Password changed', category: 'Security', severity: 'warning',
      detail: 'Changed by the account holder',
    })
    setSaving(false)
    showToast('Your password has been changed')
    onClose()
  }

  return (
    <Modal title="Change password" onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <Field label="Current password" icon={<Lock size={14} />}>
          <input type="password" style={inputStyle} value={cur} onChange={(e) => setCur(e.target.value)} placeholder="Enter current password" />
        </Field>
        <Field label="New password" icon={<Lock size={14} />}>
          <input type="password" style={inputStyle} value={nw} onChange={(e) => setNw(e.target.value)} placeholder="At least 12 characters" />
        </Field>
        <Field label="Confirm new password" icon={<Lock size={14} />}>
          <input type="password" style={inputStyle} value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="Re-enter new password" />
        </Field>
        {nw.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div style={{ flex: 1, height: '4px', borderRadius: '2px', background: 'var(--border)', overflow: 'hidden' }}>
              <div style={{
                width: `${(strength.level / 3) * 100}%`, height: '100%',
                background: strength.level >= 3 ? 'var(--success)' : strength.level === 2 ? 'var(--warning)' : 'var(--danger)',
                transition: 'width 150ms ease',
              }} />
            </div>
            <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', minWidth: '64px' }}>{strength.label}</span>
          </div>
        )}
        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
          At least {MIN_LENGTH} characters. A long passphrase is stronger than a short one with symbols in it.
        </div>
        {/* The demo personas are shared — one visitor changing Priya's password would
            lock out everybody else, and the credentials are printed on the sign-in
            cards. Said plainly rather than failing at the server. */}
        {demo && (
          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--warning)', background: '#FEF3C7', padding: '10px 12px', borderRadius: 'var(--radius)', lineHeight: 1.5 }}>
            This is a shared demonstration account, so its password is fixed — the
            credentials on the sign-in cards have to keep working. Everything else on
            this form is live: your current password is checked for real.
          </div>
        )}
        {err && <div style={{ fontSize: 'var(--text-sm)', color: 'var(--danger)', fontWeight: 600 }}>{err}</div>}
        <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={btnSecondary}>Cancel</button>
          <button onClick={submit} disabled={saving || demo} style={{ ...btnPrimary, opacity: demo ? 0.5 : 1, cursor: demo ? 'not-allowed' : 'pointer' }}>
            {saving ? 'Saving…' : 'Change password'}
          </button>
        </div>
      </div>
    </Modal>
  )
}

function MfaModal({ profile, onClose, showToast }: { profile: ConsumerProfile; onClose: () => void; showToast: (m: string) => void }) {
  const [enabled, setEnabled] = useState(profile.mfa_enabled)
  const [code, setCode] = useState('')
  const [step, setStep] = useState<'manage' | 'verify'>(profile.mfa_enabled ? 'manage' : 'verify')
  const [saving, setSaving] = useState(false)

  const toggle = async () => {
    setSaving(true)
    const newState = !enabled
    await supabase.from('consumer_profile').update({ mfa_enabled: newState }).eq('id', 'me')
    const today = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
    await supabase.from('consumer_audit_log').insert({
      id: 'AUD-CU-' + Date.now(), when_date: today + ' ' + new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
      action: newState ? 'mfa.enabled' : 'mfa.disabled',
      label: newState ? 'Two-factor auth enabled' : 'Two-factor auth disabled',
      category: 'Security', severity: 'warning',
      detail: 'Changed by the account holder',
    })
    setEnabled(newState)
    setSaving(false)
    showToast(newState ? 'Two-factor auth is now on' : 'Two-factor auth is now off')
    if (newState) onClose()
  }

  const verify = async () => {
    if (code.length !== 6) { showToast('Enter the 6-digit code from your authenticator app'); return }
    await toggle()
  }

  return (
    <Modal title="Two-factor authentication" onClose={onClose}>
      {step === 'manage' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '16px', background: '#DCFCE7', borderRadius: 'var(--radius)' }}>
            <Shield size={24} style={{ color: 'var(--success)' }} />
            <div>
              <div style={{ fontWeight: 700, fontSize: 'var(--text-sm)' }}>Two-factor auth is on</div>
              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>
                You need a code from your authenticator app to sign in.
              </div>
            </div>
          </div>
          <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
            Turning it off means anyone with your password can sign in. We recommend keeping it on.
          </div>
          <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
            <button onClick={onClose} style={btnSecondary}>Close</button>
            <button onClick={toggle} disabled={saving} style={{ ...btnPrimary, background: 'var(--danger)' }}>
              {saving ? 'Working…' : 'Turn off 2FA'}
            </button>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
            Scan the QR code in your authenticator app (Google Authenticator, Authy, etc.) and enter the 6-digit code it shows.
          </div>
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: '24px', background: 'var(--bg-alt)', borderRadius: 'var(--radius)',
            border: '2px dashed var(--border)',
          }}>
            <Shield size={48} style={{ color: 'var(--brand-accent-dark)' }} />
          </div>
          <Field label="6-digit code" icon={<Lock size={14} />}>
            <input style={inputStyle} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="000000" maxLength={6} />
          </Field>
          <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
            <button onClick={onClose} style={btnSecondary}>Cancel</button>
            <button onClick={verify} disabled={saving} style={btnPrimary}>{saving ? 'Verifying…' : 'Verify and enable'}</button>
          </div>
        </div>
      )}
    </Modal>
  )
}

function PaymentsModal({ onClose, showToast }: { onClose: () => void; showToast: (m: string) => void }) {
  const [payments, setPayments] = useState<ConsumerPaymentMethod[]>([])
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(false)
  const [newKind, setNewKind] = useState('Visa')
  const [newDetail, setNewDetail] = useState('')
  const [newHolder, setNewHolder] = useState('')
  const [newExp, setNewExp] = useState('')

  const load = useCallback(async () => {
    const { data } = await supabase.from('consumer_payment_methods').select('*').order('added')
    if (data) setPayments(data as ConsumerPaymentMethod[])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const setPrimary = async (id: string) => {
    await supabase.from('consumer_payment_methods').update({ is_primary: false }).neq('id', '')
    await supabase.from('consumer_payment_methods').update({ is_primary: true }).eq('id', id)
    load()
    showToast('Primary payment method updated')
  }

  const remove = async (id: string) => {
    await supabase.from('consumer_payment_methods').delete().eq('id', id)
    load()
    showToast('Payment method removed')
  }

  const add = async () => {
    if (!newDetail || !newHolder) { showToast('Card number and cardholder name are required'); return }
    const id = 'PM-' + Date.now()
    const today = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
    await supabase.from('consumer_payment_methods').insert({
      id, kind: newKind, detail: '•••• ' + newDetail.slice(-4), holder: newHolder,
      expires: newExp || null, is_primary: false, status: 'active', added: today,
    })
    setNewDetail(''); setNewHolder(''); setNewExp('')
    setAdding(false)
    load()
    showToast('Payment method added')
  }

  return (
    <Modal title="Payment methods" onClose={onClose}>
      {loading ? (
        <div style={{ textAlign: 'center', padding: '24px', color: 'var(--text-secondary)' }}>Loading…</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {payments.map((p) => (
            <div key={p.id} style={{
              display: 'flex', gap: '12px', alignItems: 'center', padding: '14px',
              border: '1px solid var(--border)', borderRadius: 'var(--radius)',
            }}>
              <CreditCard size={20} style={{ color: 'var(--text-tertiary)' }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 'var(--text-sm)' }}>
                  {p.kind} {p.detail}
                  {p.is_primary && <span style={{ marginLeft: '8px', fontSize: 'var(--text-xs)', color: 'var(--brand-accent-dark)' }}>Primary</span>}
                </div>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
                  {p.holder}{p.expires ? ` · expires ${p.expires}` : ''} · added {p.added}
                </div>
                {p.status === 'expired' && <span style={{ fontSize: 'var(--text-xs)', color: 'var(--danger)', fontWeight: 600 }}>Expired</span>}
              </div>
              {!p.is_primary && p.status === 'active' && (
                <button onClick={() => setPrimary(p.id)} style={btnSmall}>Make primary</button>
              )}
              <button onClick={() => remove(p.id)} style={{ ...btnSmall, color: 'var(--danger)', borderColor: '#FCA5A5' }}>
                <Trash2 size={14} />
              </button>
            </div>
          ))}

          {adding ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', padding: '16px', border: '1px solid var(--border)', borderRadius: 'var(--radius)' }}>
              <div style={{ fontWeight: 700, fontSize: 'var(--text-sm)' }}>Add a payment method</div>
              <select style={inputStyle} value={newKind} onChange={(e) => setNewKind(e.target.value)}>
                <option>Visa</option><option>Mastercard</option><option>Amex</option><option>Bill to mobile</option>
              </select>
              <input style={inputStyle} value={newDetail} onChange={(e) => setNewDetail(e.target.value)} placeholder="Card number" />
              <input style={inputStyle} value={newHolder} onChange={(e) => setNewHolder(e.target.value)} placeholder="Cardholder name" />
              <input style={inputStyle} value={newExp} onChange={(e) => setNewExp(e.target.value)} placeholder="MM/YYYY" />
              <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
                <button onClick={() => setAdding(false)} style={btnSecondary}>Cancel</button>
                <button onClick={add} style={btnPrimary}>Add</button>
              </div>
            </div>
          ) : (
            <button onClick={() => setAdding(true)} style={{
              display: 'inline-flex', alignItems: 'center', gap: '8px', alignSelf: 'flex-start',
              padding: '10px 20px', borderRadius: 'var(--radius)', border: '1px solid var(--brand-accent)',
              background: 'white', color: 'var(--brand-accent-dark)', fontWeight: 600,
              fontSize: 'var(--text-sm)', cursor: 'pointer',
            }}>
              <Plus size={16} /> Add payment method
            </button>
          )}
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '8px' }}>
            <button onClick={onClose} style={btnSecondary}>Done</button>
          </div>
        </div>
      )}
    </Modal>
  )
}

function SessionsModal({ profile, onClose, showToast }: { profile: ConsumerProfile; onClose: () => void; showToast: (m: string) => void }) {
  const [count, setCount] = useState(profile.active_sessions)
  const [saving, setSaving] = useState(false)

  const signOutAll = async () => {
    setSaving(true)
    await supabase.from('consumer_profile').update({ active_sessions: 0 }).eq('id', 'me')
    const today = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
    await supabase.from('consumer_audit_log').insert({
      id: 'AUD-CU-' + Date.now(), when_date: today + ' ' + new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
      action: 'sessions.revoked', label: 'All sessions signed out', category: 'Security', severity: 'warning',
      detail: 'All devices signed out by the account holder',
    })
    setCount(0)
    setSaving(false)
    showToast('All devices have been signed out')
    onClose()
  }

  return (
    <Modal title="Active sessions" onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: '12px', padding: '16px',
          background: 'var(--bg-alt)', borderRadius: 'var(--radius)',
        }}>
          <Clock size={24} style={{ color: 'var(--brand-accent-dark)' }} />
          <div>
            <div style={{ fontWeight: 700, fontSize: 'var(--text-sm)' }}>
              {count} {count === 1 ? 'device' : 'devices'} currently signed in
            </div>
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
              This includes this browser and any other devices where you are signed in.
            </div>
          </div>
        </div>
        <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
          Signing out all devices means you will need to enter your password again on every device, including this one.
        </div>
        <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={btnSecondary}>Cancel</button>
          <button onClick={signOutAll} disabled={saving || count === 0} style={{ ...btnPrimary, background: 'var(--danger)' }}>
            {saving ? 'Signing out…' : 'Sign out all devices'}
          </button>
        </div>
      </div>
    </Modal>
  )
}

/* ============================ NOTIFICATIONS TAB ============================
   The whole subject moved to `notification_rules` / `notification_preferences`,
   which the marketplace configures and every persona reads the same way. This
   tab is now the shared screen with a customer's persona passed to it — the
   eight hard-coded toggles that used to live here could not be configured, had
   no wording behind them and no record of what was actually sent. */

/* ============================== ACTIVITY TAB ============================== */
function ActivityTab({ log }: { log: ConsumerAuditEntry[] }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <div style={{
        background: 'var(--bg-alt)', borderRadius: 'var(--radius-lg)', padding: '16px 20px',
        display: 'flex', gap: '12px', alignItems: 'flex-start',
      }}>
        <Info size={20} style={{ color: 'var(--brand-accent-dark)', flexShrink: 0, marginTop: 2 }} />
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
const ROLE_OPTIONS = [
  { value: 'Adult member', label: 'Adult member — can buy within a monthly cap' },
  { value: 'Young person', label: 'Young person — requests need your approval' },
  { value: 'View only', label: 'View only — sees the bill, cannot buy' },
]

function HouseholdTab({ members: initialMembers, showToast }: { members: ConsumerHouseholdMember[]; showToast: (m: string) => void }) {
  const [members, setMembers] = useState<ConsumerHouseholdMember[]>(initialMembers)
  const [showAdd, setShowAdd] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [addName, setAddName] = useState('')
  const [addEmail, setAddEmail] = useState('')
  const [addRole, setAddRole] = useState('Adult member')
  const [addCap, setAddCap] = useState('40')
  const [saving, setSaving] = useState(false)

  // Per-member edit state
  const [editRole, setEditRole] = useState('')
  const [editCap, setEditCap] = useState('')

  const active = members.filter((m) => m.status === 'active')
  const capped = members.filter((m) => m.cap !== null && m.cap !== undefined && m.cap > 0)

  const openEdit = (m: ConsumerHouseholdMember) => {
    setEditingId(m.id)
    setEditRole(m.role_name)
    setEditCap(m.cap !== null && m.cap !== undefined ? String(m.cap) : '')
  }

  const saveEdit = async (m: ConsumerHouseholdMember) => {
    setSaving(true)
    const newCap = editCap === '' ? null : parseFloat(editCap)
    await supabase.from('consumer_household').update({
      role_name: editRole,
      cap: newCap,
    }).eq('id', m.id)
    setMembers((prev) => prev.map((x) => x.id === m.id ? { ...x, role_name: editRole, cap: newCap } : x))
    setEditingId(null)
    setSaving(false)
    showToast(`${m.name} updated`)
  }

  const removeMember = async (m: ConsumerHouseholdMember) => {
    if (!confirm(`Remove ${m.name} from the account?`)) return
    await supabase.from('consumer_household').delete().eq('id', m.id)
    setMembers((prev) => prev.filter((x) => x.id !== m.id))
    showToast(`${m.name} removed from the account`)
  }

  const resendInvite = (m: ConsumerHouseholdMember) => {
    showToast(`Invite resent to ${m.email} — link valid for 7 days`)
  }

  const addMember = async () => {
    if (!addName.trim() || !addEmail.trim()) { showToast('Name and email are required'); return }
    setSaving(true)
    const id = 'HH-' + Math.random().toString(36).slice(2, 8).toUpperCase()
    const initials = addName.trim().split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase()
    const newMember: ConsumerHouseholdMember = {
      id, name: addName.trim(), email: addEmail.trim(),
      role_id: 'CO-ADULT', role_name: addRole, status: 'invited',
      joined: 'Just now', last_active: 'Never',
      mfa: false, is_you: false,
      cap: addRole === 'View only' ? null : parseFloat(addCap) || 40,
      spent: 0,
    }
    await supabase.from('consumer_household').insert({
      ...newMember,
      initials,
    })
    setMembers((prev) => [...prev, newMember])
    setAddName(''); setAddEmail(''); setAddRole('Adult member'); setAddCap('40')
    setShowAdd(false)
    setSaving(false)
    showToast(`Invite sent to ${newMember.email} — link valid for 7 days`)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <div style={{
        background: 'var(--bg-alt)', borderRadius: 'var(--radius-lg)', padding: '16px 20px',
        display: 'flex', gap: '12px', alignItems: 'flex-start',
      }}>
        <Users size={20} style={{ color: 'var(--brand-accent-dark)', flexShrink: 0, marginTop: 2 }} />
        <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
          Everyone here shares one bill and one basket history, but each person only sees their own orders.
          {' '}
          <strong>{capped.length} {capped.length === 1 ? 'person has' : 'people have'}</strong> a monthly spend cap; anything above it comes to you to approve.
        </div>
      </div>

      <Card icon={<Users size={18} />} title="People on this account" subtitle={`${active.length} active · ${members.length - active.length} invited`}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0' }}>
          {members.map((m) => (
            <div key={m.id}>
              <div style={{
                display: 'flex', gap: '16px', alignItems: 'center',
                padding: '16px 0',
                borderBottom: editingId === m.id ? 'none' : '1px solid var(--border-light)',
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
                  color: m.mfa ? 'var(--success)' : 'var(--warning)',
                }}>
                  <Shield size={14} />
                  {m.mfa ? '2FA on' : 'No 2FA'}
                </div>

                {/* Cap */}
                {m.cap !== null && m.cap !== undefined && m.cap > 0 && (
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>Monthly cap</div>
                    <div style={{ fontWeight: 700, fontSize: 'var(--text-sm)' }}>{fmtMoney(m.cap)}</div>
                    <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
                      {fmtMoney(m.spent ?? 0)} spent
                    </div>
                  </div>
                )}

                {/* Status */}
                <span style={{
                  padding: '4px 10px', borderRadius: 'var(--radius-full)',
                  fontSize: 'var(--text-xs)', fontWeight: 600,
                  background: m.status === 'active' ? '#DCFCE7' : '#FEF3C7',
                  color: m.status === 'active' ? 'var(--success)' : 'var(--warning)',
                  flexShrink: 0,
                }}>
                  {m.status}
                </span>

                {/* Actions — not shown for yourself */}
                {!m.is_you && (
                  <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
                    {m.status === 'invited' && (
                      <button onClick={() => resendInvite(m)} style={btnSecondarySmall}>
                        Resend invite
                      </button>
                    )}
                    <button
                      onClick={() => editingId === m.id ? setEditingId(null) : openEdit(m)}
                      style={btnSecondarySmall}
                    >
                      {editingId === m.id ? 'Cancel' : 'Manage'}
                    </button>
                    <button
                      onClick={() => removeMember(m)}
                      style={{ ...btnSecondarySmall, color: 'var(--danger)', borderColor: '#FECACA' }}
                    >
                      Remove
                    </button>
                  </div>
                )}
              </div>

              {/* Inline edit panel */}
              {editingId === m.id && (
                <div style={{
                  padding: '16px 20px', marginBottom: '8px',
                  background: 'var(--bg-alt)', borderRadius: 'var(--radius)',
                  border: '1px solid var(--border)', borderTop: 'none',
                  display: 'flex', flexDirection: 'column', gap: '14px',
                }}>
                  <div style={{ fontWeight: 600, fontSize: 'var(--text-sm)' }}>Edit {m.name}</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                    <Field label="Role" icon={<Users size={14} />}>
                      <select style={inputStyle} value={editRole} onChange={(e) => setEditRole(e.target.value)}>
                        {ROLE_OPTIONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                      </select>
                    </Field>
                    {editRole !== 'View only' && (
                      <Field label="Monthly spend cap ($)" icon={<Wallet size={14} />}>
                        <input
                          style={inputStyle} type="number" min="0" step="5"
                          value={editCap} onChange={(e) => setEditCap(e.target.value)}
                          placeholder="e.g. 40 — leave blank for no cap"
                        />
                      </Field>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
                    <button onClick={() => setEditingId(null)} style={btnSecondary}>Cancel</button>
                    <button onClick={() => saveEdit(m)} disabled={saving} style={btnPrimary}>
                      {saving ? 'Saving…' : 'Save changes'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Add someone */}
        {!showAdd ? (
          <button
            onClick={() => setShowAdd(true)}
            style={{
              marginTop: '16px', display: 'inline-flex', alignItems: 'center', gap: '8px',
              padding: '10px 20px', borderRadius: 'var(--radius)', border: '1px solid var(--brand-accent)',
              background: 'white', color: 'var(--brand-accent-dark)', fontWeight: 600,
              fontSize: 'var(--text-sm)', cursor: 'pointer',
            }}
          >
            <Plus size={16} /> Add someone
          </button>
        ) : (
          <div style={{
            marginTop: '16px', padding: '20px',
            border: '1px solid var(--border)', borderRadius: 'var(--radius)',
            display: 'flex', flexDirection: 'column', gap: '14px',
          }}>
            <div style={{ fontWeight: 700, fontSize: 'var(--text-sm)' }}>Invite someone to your account</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <Field label="Full name" icon={<User size={14} />}>
                <input style={inputStyle} value={addName} onChange={(e) => setAddName(e.target.value)} placeholder="e.g. Ananya Raman" />
              </Field>
              <Field label="Email address" icon={<Mail size={14} />}>
                <input style={inputStyle} type="email" value={addEmail} onChange={(e) => setAddEmail(e.target.value)} placeholder="e.g. ananya@gmail.com" />
              </Field>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <Field label="Role" icon={<Users size={14} />}>
                <select style={inputStyle} value={addRole} onChange={(e) => setAddRole(e.target.value)}>
                  {ROLE_OPTIONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                </select>
              </Field>
              {addRole !== 'View only' && (
                <Field label="Monthly spend cap ($)" icon={<Wallet size={14} />}>
                  <input
                    style={inputStyle} type="number" min="0" step="5"
                    value={addCap} onChange={(e) => setAddCap(e.target.value)}
                    placeholder="e.g. 40 — leave blank for no cap"
                  />
                </Field>
              )}
            </div>
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
              They will receive an email invite with a link to set up their account. The link is valid for 7 days.
            </div>
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
              <button onClick={() => setShowAdd(false)} style={btnSecondary}>Cancel</button>
              <button onClick={addMember} disabled={saving} style={btnPrimary}>
                {saving ? 'Sending…' : 'Send invite'}
              </button>
            </div>
          </div>
        )}
      </Card>
    </div>
  )
}

const btnSecondarySmall: React.CSSProperties = {
  padding: '5px 12px', borderRadius: 'var(--radius)', border: '1px solid var(--border)',
  background: 'white', color: 'var(--text-secondary)', fontWeight: 600,
  fontSize: 'var(--text-xs)', cursor: 'pointer',
}

/* ============================== REFUNDS TAB ============================== */
/* The customer's side of the same record the seller and the marketplace read.
   It used to be a list in a table only this page could see, so nobody who could
   act on a refund could see one. What changed here is the two things a customer
   actually wants: who is deciding and by when, and a way to ask in the first
   place. */
function RefundsTab({ book, onChanged, showToast }: {
  book: RefundBook; onChanged: () => Promise<void> | void; showToast: (m: string) => void
}) {
  const [asking, setAsking] = useState(false)
  const now = new Date()
  const back = book.refunds
    .filter((r) => r.state === 'refunded' || r.state === 'partial')
    .reduce((a, r) => a + Number(r.refunded ?? 0), 0)
  const waiting = book.refunds.filter((r) => !STATES[r.state].final)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '16px' }}>
        <StatBox icon={<RotateCcw size={20} />} label="Money back" value={fmtMoney(back)} />
        <StatBox icon={<Clock size={20} />} label="Still waiting" value={String(waiting.length)} />
        <StatBox icon={<Check size={20} />} label="Requests made" value={String(book.refunds.length)} />
      </div>

      <Card icon={<RotateCcw size={18} />} title="Your refunds" subtitle={`${book.refunds.length} on record`}>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '8px' }}>
          <button onClick={() => setAsking(true)} style={btnPrimary}>Ask for a refund</button>
        </div>
        {book.refunds.length === 0 ? (
          <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)', padding: '8px 0' }}>
            Nothing yet. If something never arrived, arrived broken or was charged twice, ask here and
            whoever sold it has two days to answer.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0' }}>
            {book.refunds.map((r) => {
              const spec = STATES[r.state]
              const clock = book.policy ? sla(r, book.policy, now) : null
              const own = ownership(r)
              return (
                <div key={r.id} style={{
                  display: 'flex', gap: '16px', alignItems: 'flex-start',
                  padding: '16px 0', borderBottom: '1px solid var(--border-light)',
                }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 'var(--text-sm)', marginBottom: '2px' }}>{r.item}</div>
                    <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginBottom: '4px' }}>
                      {r.id} · Order {r.order_ref} · {r.seller}
                    </div>
                    <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
                      {REASONS[r.reason].label}
                    </div>
                    {/* Who is deciding and by when. It is the question a customer
                        is actually asking when they open this page — but only
                        while somebody is still deciding. An agreed refund is
                        waiting on the payment run, not on a person, and saying
                        "the seller is deciding this" underneath "Approved" is
                        the page contradicting itself. */}
                    {(r.state === 'requested' || r.state === 'escalated') && (
                      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', marginTop: '5px', lineHeight: 1.5 }}>
                        <strong>{own.owner === 'marketplace' ? 'The marketplace' : r.seller} is deciding this.</strong>
                        {clock && clock.level !== 'settled' ? ` ${clock.text}` : ''}
                      </div>
                    )}
                    {r.decision_note && (
                      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginTop: '5px', lineHeight: 1.5 }}>
                        {r.decided_on ? `Decided ${r.decided_on} by ${r.decided_by} — ` : ''}{r.decision_note}
                      </div>
                    )}
                    {r.escalated_why && (
                      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginTop: '5px', lineHeight: 1.5 }}>
                        Taken over by the marketplace: {r.escalated_why}
                      </div>
                    )}
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <div style={{ fontWeight: 800, fontSize: 'var(--text-lg)', marginBottom: '4px' }}>
                      {fmtMoney(Number(r.refunded ?? r.amount))}
                    </div>
                    {r.state === 'partial' && (
                      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginBottom: '4px' }}>
                        of {fmtMoney(Number(r.amount))} asked for
                      </div>
                    )}
                    <span style={{
                      padding: '4px 10px', borderRadius: 'var(--radius-full)',
                      fontSize: 'var(--text-xs)', fontWeight: 600,
                      background: spec.final ? (r.state === 'declined' ? '#FEE2E2' : '#DCFCE7') : '#FEF3C7',
                      color: spec.final ? (r.state === 'declined' ? 'var(--danger)' : 'var(--success)') : 'var(--warning)',
                    }}>{spec.label}</span>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </Card>

      {book.policy && (
        <Card icon={<Clock size={18} />} title="What you are entitled to" subtitle="The rules everybody here plays by">
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', fontSize: 'var(--text-sm)', lineHeight: 1.6 }}>
            <div>{book.policy.escalation_rule}</div>
            <div>{book.policy.store_credit}</div>
            {book.windows.length > 0 && (
              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
                {book.windows.map((w) => `${w.category_id}: ${w.days} days`).join(' · ')}
              </div>
            )}
          </div>
        </Card>
      )}

      {asking && book.policy && (
        <AskForRefund policy={book.policy} onClose={() => setAsking(false)}
                      onDone={async () => { setAsking(false); await onChanged() }} showToast={showToast} />
      )}
    </div>
  )
}

interface RefundableOrder {
  order_ref: string; product_id: string; item: string; category_id: string | null
  partner_id: string | null; seller: string; first_party: boolean
  customer: string; amount: number; placed: string
}

/* Raising one. The order picker is the point: a refund against an order that
   does not exist is a support ticket, not a refund, and typing an order number
   by hand is how you get one. */
function AskForRefund({ policy, onClose, onDone, showToast }: {
  policy: RefundPolicy
  onClose: () => void
  onDone: () => Promise<void>
  showToast: (m: string) => void
}) {
  const [orders, setOrders] = useState<RefundableOrder[] | null>(null)
  const [pick, setPick] = useState('')
  const [reason, setReason] = useState<RefundReason>('faulty')
  const [detail, setDetail] = useState('')
  const [evidence, setEvidence] = useState('')
  const [err, setErr] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    void (async () => {
      const [oRes, iRes, pRes, existing] = await Promise.all([
        supabase.from('orders').select('id,order_ref,buyer_name,placed_date,total'),
        supabase.from('order_items').select('order_id,product_id,product_name,price,quantity'),
        supabase.from('products').select('id,category_id,partner_id,seller'),
        supabase.from('refunds').select('order_ref,product_id'),
      ])
      const products = (pRes.data ?? []) as { id: string; category_id: string | null; partner_id: string | null; seller: string }[]
      const claimed = new Set(((existing.data ?? []) as { order_ref: string; product_id: string }[])
        .map((r) => `${r.order_ref}::${r.product_id}`))
      const rows: RefundableOrder[] = []
      for (const o of (oRes.data ?? []) as { id: string; order_ref: string; buyer_name: string; placed_date: string; total: number }[]) {
        for (const i of (iRes.data ?? []) as { order_id: string; product_id: string; product_name: string; price: number; quantity: number }[]) {
          if (i.order_id !== o.id) continue
          if (claimed.has(`${o.order_ref}::${i.product_id}`)) continue
          const p = products.find((x) => x.id === i.product_id)
          rows.push({
            order_ref: o.order_ref, product_id: i.product_id, item: i.product_name,
            category_id: p?.category_id ?? null, partner_id: p?.partner_id ?? null,
            seller: p?.seller ?? 'Aventa Telecom', first_party: !p?.partner_id,
            customer: o.buyer_name, amount: Number(i.price) * Number(i.quantity),
            placed: o.placed_date,
          })
        }
      }
      setOrders(rows)
      if (rows.length > 0) setPick(`${rows[0].order_ref}::${rows[0].product_id}`)
    })()
  }, [])

  const chosen = orders?.find((o) => `${o.order_ref}::${o.product_id}` === pick) ?? null
  const auto = chosen ? autoApproves(reason, chosen.amount, policy) : null

  return (
    <Modal title="Ask for a refund" onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {orders === null ? (
          <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)' }}>Loading your orders…</div>
        ) : orders.length === 0 ? (
          <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)', lineHeight: 1.6 }}>
            Every item on your orders already has a refund request against it. To raise a second one on the
            same item, contact support — a duplicate request would only sit behind the first.
          </div>
        ) : (
          <>
            <Field label="Which order" icon={<RotateCcw size={14} />}>
              <select style={inputStyle} value={pick} onChange={(e) => setPick(e.target.value)}>
                {orders.map((o) => (
                  <option key={`${o.order_ref}::${o.product_id}`} value={`${o.order_ref}::${o.product_id}`}>
                    {o.item} — {fmtMoney(o.amount)} · {o.order_ref} · {o.placed}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="What went wrong" icon={<AlertCircle size={14} />}>
              <select style={inputStyle} value={reason} onChange={(e) => setReason(e.target.value as RefundReason)}>
                {REASON_LIST.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
              </select>
            </Field>

            <Field label="In your own words" icon={<MessageSquare size={14} />}>
              <textarea style={{ ...inputStyle, minHeight: '80px', resize: 'vertical' }}
                        value={detail} onChange={(e) => setDetail(e.target.value)}
                        placeholder="A line or two on what happened. The seller reads this." />
            </Field>

            <Field label="Anything that backs it up" icon={<FileText size={14} />}>
              <input style={inputStyle} value={evidence} onChange={(e) => setEvidence(e.target.value)}
                     placeholder={REASONS[reason].evidence} />
            </Field>

            {chosen && auto && (
              <div style={{
                fontSize: 'var(--text-xs)', lineHeight: 1.6, padding: '10px 12px',
                borderRadius: 'var(--radius)',
                background: auto.yes ? '#DCFCE7' : 'var(--bg-alt)',
                color: auto.yes ? 'var(--success)' : 'var(--text-secondary)',
              }}>
                {auto.yes
                  ? `This one is agreed on the spot — ${auto.because.charAt(0).toLowerCase()}${auto.because.slice(1)}`
                  : `${chosen.first_party ? 'The marketplace' : chosen.seller} has ${policy.seller_sla_hours} hours to answer. If none comes, the marketplace decides it — you do not have to chase anybody.`}
              </div>
            )}
            {err && <div style={{ fontSize: 'var(--text-sm)', color: 'var(--danger)', fontWeight: 600 }}>{err}</div>}
            <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
              <button onClick={onClose} style={btnSecondary}>Cancel</button>
              <button
                disabled={saving || !chosen}
                onClick={async () => {
                  if (!chosen) return
                  setSaving(true); setErr('')
                  const r = await requestRefund({ order: chosen, policy, reason, detail, evidence })
                  setSaving(false)
                  if (!r.ok) { setErr(r.reason); return }
                  showToast(r.note ?? 'Refund requested')
                  await onDone()
                }}
                style={{ ...btnPrimary, opacity: saving || !chosen ? 0.5 : 1 }}
              >
                {saving ? 'Sending…' : 'Ask for it back'}
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  )
}

/* ============================== BILLS TAB ============================== */
function BillsTab({ bills, showToast }: { bills: ConsumerBill[]; showToast: (m: string) => void }) {
  const openBills = bills.filter((b) => b.status === 'open')
  const totalPaid = bills.filter((b) => b.status === 'paid').reduce((a, b) => a + b.total, 0)
  const currentDue = openBills.reduce((a, b) => a + b.total, 0)

  /* The template these bills are issued on, loaded once for the tab. Viewing
     and downloading are the same document, so they read the same record. */
  const [book, setBook] = useState<BillBook | null>(null)
  const [viewing, setViewing] = useState<ConsumerBill | null>(null)
  const billsPage = usePaging(bills, { initialSize: 5 })
  useEffect(() => { void loadBillBook().then(setBook) }, [])

  const template = book ? templateForBill(book) : null
  const ids = book ? sectionIds(book, template) : []

  /* A PDF, on the template the operator assigned. It used to be a .txt, which
     is a document nobody can file, print or forward to their accounts
     department. The plain-text rendition is still there behind "Plain text"
     for anybody who wants to read it in a terminal or paste it into a ticket. */
  const downloadBill = (bill: ConsumerBill, as: 'pdf' | 'txt' = 'pdf') => {
    if (!book || !template) { showToast('The bill format is still loading — try again in a moment'); return }
    const facts = factsFor(bill, book)
    if (as === 'pdf') {
      saveBlob(billPdf(facts, template, ids, book.sections), pdfNameFor(facts))
      showToast(`${bill.id} downloaded as a PDF`)
      return
    }
    saveBlob(new Blob([asText(facts, template, ids, book.sections)], { type: 'text/plain' }), fileNameFor(bill))
    showToast(`${bill.id} downloaded as plain text`)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '16px' }}>
        <StatBox icon={<FileText size={20} />} label="Current bill" value={fmtMoney(currentDue)} />
        <StatBox icon={<Clock size={20} />} label="Open bills" value={String(openBills.length)} />
        <StatBox icon={<Check size={20} />} label="Paid (last 6 mo)" value={fmtMoney(totalPaid)} />
      </div>

      <Card icon={<FileText size={18} />} title="Bill history" subtitle={`${bills.length} bills on record`}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--text-sm)' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid var(--border)' }}>
                <th style={thStyle}>Bill ID</th>
                <th style={thStyle}>Period</th>
                <th style={thStyle}>Issued</th>
                <th style={thStyle}>Due</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>Total</th>
                <th style={thStyle}>Status</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>Bill</th>
              </tr>
            </thead>
            <tbody>
              {billsPage.rows.map((b) => (
                <tr key={b.id} style={{ borderBottom: '1px solid var(--border-light)' }}>
                  <td style={tdStyle}>{b.id}</td>
                  <td style={tdStyle}>{b.period}</td>
                  <td style={tdStyle}>{b.issued}</td>
                  <td style={tdStyle}>{b.due}</td>
                  <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 700 }}>{fmtMoney(b.total)}</td>
                  <td style={tdStyle}>
                    <span style={{
                      padding: '3px 10px', borderRadius: 'var(--radius-full)',
                      fontSize: 'var(--text-xs)', fontWeight: 600,
                      background: b.status === 'paid' ? '#DCFCE7' : '#FEF3C7',
                      color: b.status === 'paid' ? 'var(--success)' : 'var(--warning)',
                    }}>
                      {b.status}
                    </span>
                  </td>
                  <td style={{ ...tdStyle, textAlign: 'right' }}>
                    <div style={{ display: 'inline-flex', gap: '6px' }}>
                      <button onClick={() => setViewing(b)} disabled={!book} style={{
                        ...billBtn, opacity: book ? 1 : 0.5,
                      }}>
                        <Eye size={12} /> View
                      </button>
                      <button onClick={() => downloadBill(b)} disabled={!book} style={{
                        ...billBtn, opacity: book ? 1 : 0.5,
                      }}>
                        <Download size={12} /> PDF
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Pager page={billsPage} noun="bills" />
        <div style={{ marginTop: '16px', fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
          Your bill includes your Aventa mobile plan, all subscriptions, and any one-off purchases made during the billing period. The total shown is what was charged to your mobile account.
        </div>
      </Card>

      {viewing && book && template && (
        <Modal title={`${template.doc_title} — ${viewing.period}`} onClose={() => setViewing(null)} wide>
          <BillDocument template={template} ids={ids} facts={factsFor(viewing, book)} />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '20px' }}>
            <button onClick={() => setViewing(null)} style={billBtn}>Close</button>
            <button onClick={() => downloadBill(viewing, 'txt')} style={billBtn}>Plain text</button>
            <button onClick={() => downloadBill(viewing)} style={{ ...billBtn, borderColor: 'var(--brand-navy)', background: 'var(--brand-navy)', color: 'white' }}>
              <Download size={12} /> Download PDF
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}

const billBtn: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: '4px',
  padding: '4px 10px', borderRadius: 'var(--radius)',
  border: '1px solid var(--border)', background: 'white',
  color: 'var(--text-secondary)', fontWeight: 600,
  fontSize: 'var(--text-xs)', cursor: 'pointer',
}

/* ============================ SUPPORT TAB ============================ */
function SupportTab({ tickets: initialTickets, showToast }: { tickets: ConsumerTicket[]; showToast: (m: string) => void }) {
  const [tickets, setTickets] = useState<ConsumerTicket[]>(initialTickets)
  const [showNew, setShowNew] = useState(false)
  const [selectedTicket, setSelectedTicket] = useState<ConsumerTicket | null>(null)
  const [subject, setSubject] = useState('')
  const [category, setCategory] = useState('General')
  const [message, setMessage] = useState('')
  const [severity, setSeverity] = useState('P3')
  const [submitting, setSubmitting] = useState(false)
  const ticketsPage = usePaging(tickets, { initialSize: 10 })

  const createTicket = async () => {
    if (!subject || !message) { showToast('Subject and message are required'); return }
    setSubmitting(true)
    const id = 'TCK-' + Math.floor(59200 + Math.random() * 1000)
    const now = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) + ' ' +
      new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
    const newTicket: ConsumerTicket = {
      id, subject, category, severity, status: 'new', opened: 'Just now',
      opened_by: 'Priya Raman', channel: 'Self-care portal', owner: null,
      sla_mins: severity === 'P1' ? 240 : severity === 'P2' ? 480 : severity === 'P3' ? 1440 : 4320,
      resolution_mins: null, breached: false, escalated: false,
      messages: [{ who: 'Priya Raman', when: now, text: message }],
    }
    /* The shared queue speaks one vocabulary: `priority` rather than
       `severity`, `ref` rather than `order_ref`, and a persona on every row so
       the support desk can see a ticket a customer raised. `guard_ticket`
       overwrites the SLA fields from the policy, so what is sent here for them
       is a starting point rather than a promise. */
    const { data: session } = await supabase.auth.getUser()
    await supabase.from('support_tickets').insert({
      id, subject, category, priority: severity, status: 'new',
      persona: 'consumer', org: 'Consumer', opened_by: 'Priya Raman',
      channel: 'Self-care portal', owner: null,
      sla_mins: newTicket.sla_mins, breached: false, escalated: false,
      user_id: session.user?.id ?? null,
      messages: newTicket.messages,
    })
    setTickets((prev) => [newTicket, ...prev])
    setSubject(''); setMessage(''); setCategory('General'); setSeverity('P3')
    setShowNew(false)
    setSubmitting(false)
    showToast(`Ticket ${id} created — we will respond within the SLA`)
  }

  const openCount = tickets.filter((t) => t.status !== 'resolved').length
  const resolvedCount = tickets.filter((t) => t.status === 'resolved').length

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '16px' }}>
        <StatBox icon={<LifeBuoy size={20} />} label="Open tickets" value={String(openCount)} />
        <StatBox icon={<Check size={20} />} label="Resolved" value={String(resolvedCount)} />
        <StatBox icon={<MessageSquare size={20} />} label="Total" value={String(tickets.length)} />
      </div>

      <Card icon={<LifeBuoy size={18} />} title="Help & Support" subtitle="Track your support requests and raise a new one">
        {!showNew ? (
          <button onClick={() => setShowNew(true)} style={{
            display: 'inline-flex', alignItems: 'center', gap: '8px',
            padding: '10px 20px', borderRadius: 'var(--radius)',
            border: '1px solid var(--brand-accent)', background: 'white',
            color: 'var(--brand-accent-dark)', fontWeight: 600,
            fontSize: 'var(--text-sm)', cursor: 'pointer', marginBottom: '16px',
          }}>
            <Plus size={16} /> Raise a ticket
          </button>
        ) : (
          <div style={{
            display: 'flex', flexDirection: 'column', gap: '14px',
            padding: '20px', border: '1px solid var(--border)',
            borderRadius: 'var(--radius)', marginBottom: '16px',
          }}>
            <div style={{ fontWeight: 700, fontSize: 'var(--text-sm)' }}>New support ticket</div>
            <Field label="Subject" icon={<MessageSquare size={14} />}>
              <input style={inputStyle} value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Briefly describe the issue" />
            </Field>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <Field label="Category" icon={<Info size={14} />}>
                <select style={inputStyle} value={category} onChange={(e) => setCategory(e.target.value)}>
                  <option>General</option><option>Delivery</option><option>Product</option>
                  <option>Technical</option><option>Billing</option><option>Account</option>
                </select>
              </Field>
              <Field label="Priority" icon={<AlertCircle size={14} />}>
                <select style={inputStyle} value={severity} onChange={(e) => setSeverity(e.target.value)}>
                  <option value="P1">P1 — Urgent</option>
                  <option value="P2">P2 — High</option>
                  <option value="P3">P3 — Normal</option>
                  <option value="P4">P4 — Low</option>
                </select>
              </Field>
            </div>
            <Field label="Message" icon={<MessageSquare size={14} />}>
              <textarea
                style={{ ...inputStyle, minHeight: '80px', resize: 'vertical' }}
                value={message} onChange={(e) => setMessage(e.target.value)}
                placeholder="Describe the issue in detail"
              />
            </Field>
            <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
              <button onClick={() => setShowNew(false)} style={btnSecondary}>Cancel</button>
              <button onClick={createTicket} disabled={submitting} style={btnPrimary}>
                {submitting ? 'Creating…' : 'Create ticket'}
              </button>
            </div>
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0' }}>
          {ticketsPage.rows.map((t) => (
            <div key={t.id} style={{
              display: 'flex', gap: '12px', alignItems: 'center',
              padding: '14px 0', borderBottom: '1px solid var(--border-light)',
              cursor: 'pointer',
            }} onClick={() => setSelectedTicket(t)}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: 'var(--text-sm)' }}>{t.subject}</div>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
                  {t.id} · {t.category} · opened {t.opened} · {t.channel}
                </div>
                {t.owner && (
                  <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
                    Owner: {t.owner}
                  </div>
                )}
              </div>
              <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                <span style={{
                  padding: '2px 8px', borderRadius: 'var(--radius-full)',
                  fontSize: 'var(--text-xs)', fontWeight: 600,
                  background: t.severity === 'P1' ? '#FEE2E2' : t.severity === 'P2' ? '#FEF3C7' : 'var(--bg-alt)',
                  color: t.severity === 'P1' ? 'var(--danger)' : t.severity === 'P2' ? 'var(--warning)' : 'var(--text-secondary)',
                }}>
                  {t.severity}
                </span>
                <span style={{
                  padding: '3px 10px', borderRadius: 'var(--radius-full)',
                  fontSize: 'var(--text-xs)', fontWeight: 600,
                  background: t.status === 'resolved' ? '#DCFCE7' : t.status === 'inprogress' ? '#E0E7FF' : '#FEF3C7',
                  color: t.status === 'resolved' ? 'var(--success)' : t.status === 'inprogress' ? '#4338CA' : 'var(--warning)',
                }}>
                  {t.status}
                </span>
                <ChevronRight size={16} style={{ color: 'var(--text-tertiary)' }} />
              </div>
            </div>
          ))}
        </div>
        <Pager page={ticketsPage} noun="tickets" />
      </Card>

      {selectedTicket && (
        <TicketDetailModal ticket={selectedTicket} onClose={() => setSelectedTicket(null)} showToast={showToast} />
      )}
    </div>
  )
}

function TicketDetailModal({ ticket, onClose, showToast }: { ticket: ConsumerTicket; onClose: () => void; showToast: (m: string) => void }) {
  const [reply, setReply] = useState('')
  const [messages, setMessages] = useState<TicketMessage[]>(ticket.messages || [])
  const [sending, setSending] = useState(false)

  const sendReply = async () => {
    if (!reply.trim()) return
    setSending(true)
    const now = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) + ' ' +
      new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
    const newMsg: TicketMessage = { who: 'Priya Raman', when: now, text: reply }
    const updated = [...messages, newMsg]
    await supabase.from('support_tickets').update({
      messages: updated,
    }).eq('id', ticket.id)
    setMessages(updated)
    setReply('')
    setSending(false)
    showToast('Reply sent')
  }

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 400,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px',
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        background: 'white', borderRadius: 'var(--radius-lg)', padding: '28px',
        maxWidth: '560px', width: '100%', maxHeight: '90vh', overflowY: 'auto',
        boxShadow: 'var(--shadow-lg)',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <div>
            <h2 style={{ fontSize: 'var(--text-xl)', fontWeight: 800 }}>{ticket.id}</h2>
            <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)' }}>{ticket.subject}</div>
          </div>
          <button onClick={onClose} style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text-tertiary)' }}>
            <X size={20} />
          </button>
        </div>

        <div style={{ display: 'flex', gap: '8px', marginBottom: '20px' }}>
          <span style={{
            padding: '3px 10px', borderRadius: 'var(--radius-full)', fontSize: 'var(--text-xs)', fontWeight: 600,
            background: ticket.status === 'resolved' ? '#DCFCE7' : ticket.status === 'inprogress' ? '#E0E7FF' : '#FEF3C7',
            color: ticket.status === 'resolved' ? 'var(--success)' : ticket.status === 'inprogress' ? '#4338CA' : 'var(--warning)',
          }}>{ticket.status}</span>
          <span style={{
            padding: '3px 10px', borderRadius: 'var(--radius-full)', fontSize: 'var(--text-xs)', fontWeight: 600,
            background: 'var(--bg-alt)', color: 'var(--text-secondary)',
          }}>{ticket.severity}</span>
          <span style={{
            padding: '3px 10px', borderRadius: 'var(--radius-full)', fontSize: 'var(--text-xs)', fontWeight: 600,
            background: 'var(--bg-alt)', color: 'var(--text-secondary)',
          }}>{ticket.category}</span>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '20px' }}>
          {messages.map((m, i) => {
            const isMe = m.who === 'Priya Raman'
            return (
              <div key={i} style={{
                display: 'flex', flexDirection: 'column',
                alignItems: isMe ? 'flex-end' : 'flex-start',
              }}>
                <div style={{
                  maxWidth: '80%', padding: '12px 16px',
                  borderRadius: 'var(--radius-lg)',
                  background: isMe ? 'var(--brand-accent)' : 'var(--bg-alt)',
                  color: isMe ? 'white' : 'var(--text)',
                  fontSize: 'var(--text-sm)',
                }}>
                  {m.text}
                </div>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginTop: '4px' }}>
                  {m.who} · {m.when}
                </div>
              </div>
            )
          })}
        </div>

        {ticket.status !== 'resolved' && (
          <div style={{ borderTop: '1px solid var(--border-light)', paddingTop: '16px' }}>
            <textarea
              style={{ ...inputStyle, minHeight: '60px', resize: 'vertical', marginBottom: '12px' }}
              value={reply} onChange={(e) => setReply(e.target.value)}
              placeholder="Type a reply…"
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button onClick={sendReply} disabled={sending || !reply.trim()} style={btnPrimary}>
                <Send size={14} style={{ display: 'inline', marginRight: '4px' }} />
                {sending ? 'Sending…' : 'Send reply'}
              </button>
            </div>
          </div>
        )}
      </div>
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

const btnPrimary: React.CSSProperties = {
  padding: '10px 24px', borderRadius: 'var(--radius)', border: 'none',
  background: 'var(--brand-accent-dark)', color: 'white', fontWeight: 600,
  fontSize: 'var(--text-sm)', cursor: 'pointer',
}

const btnSecondary: React.CSSProperties = {
  padding: '10px 24px', borderRadius: 'var(--radius)', border: '1px solid var(--border)',
  background: 'white', color: 'var(--text-secondary)', fontWeight: 600,
  fontSize: 'var(--text-sm)', cursor: 'pointer',
}

const btnSmall: React.CSSProperties = {
  padding: '6px 12px', borderRadius: 'var(--radius)', border: '1px solid var(--border)',
  background: 'white', color: 'var(--text-secondary)', fontWeight: 600,
  fontSize: 'var(--text-xs)', cursor: 'pointer',
  display: 'inline-flex', alignItems: 'center', gap: '4px',
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
        <span style={{ color: 'var(--brand-accent-dark)' }}>{icon}</span>
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

function SecurityRow({ icon, label, value, action, positive, onClick }: { icon: React.ReactNode; label: string; value: string; action: string; positive?: boolean; onClick?: () => void }) {
  return (
    <div style={{
      display: 'flex', gap: '12px', alignItems: 'center',
      padding: '10px 0', borderBottom: '1px solid var(--border-light)',
    }}>
      <span style={{ color: positive ? 'var(--success)' : 'var(--text-tertiary)' }}>{icon}</span>
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 600, fontSize: 'var(--text-sm)' }}>{label}</div>
        <div style={{ fontSize: 'var(--text-xs)', color: positive ? 'var(--success)' : 'var(--text-tertiary)' }}>{value}</div>
      </div>
      <button onClick={onClick} style={{
        padding: '6px 14px', borderRadius: 'var(--radius)', border: '1px solid var(--border)',
        background: 'white', color: 'var(--text-secondary)', fontWeight: 600,
        fontSize: 'var(--text-xs)', cursor: onClick ? 'pointer' : 'default',
        transition: 'background 150ms ease',
      }}
      onMouseEnter={(e) => { if (onClick) e.currentTarget.style.background = 'var(--bg-alt)' }}
      onMouseLeave={(e) => { if (onClick) e.currentTarget.style.background = 'white' }}
      >
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
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px', color: 'var(--brand-accent-dark)' }}>
        {icon}
        <span style={{ fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--text-tertiary)' }}>{label}</span>
      </div>
      <div style={{ fontSize: 'var(--text-2xl)', fontWeight: 800 }}>{value}</div>
    </div>
  )
}

/* The wallet, on the customer's own side. Payment methods come with it so the
   closing copy can name the card the money would actually go back to rather
   than saying "your default payment method" and hoping there is one. */
function WalletTab() {
  const [cards, setCards] = useState<ConsumerPaymentMethod[]>([])

  useEffect(() => {
    supabase.from('consumer_payment_methods').select('*').order('is_primary', { ascending: false })
      .then(({ data }) => { if (data) setCards(data as ConsumerPaymentMethod[]) })
  }, [])

  return <WalletCard paymentMethods={cards.map(c => ({ detail: c.detail, is_primary: c.is_primary }))} />
}
