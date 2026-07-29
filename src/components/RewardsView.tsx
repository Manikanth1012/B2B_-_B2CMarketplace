import { useState, useEffect, useCallback } from 'react'
import { Zap, Star, TrendingUp, Clock, Award, Gift, Wallet, FileText, Tag, RefreshCw, Send, X, Minus, Plus, Check, CircleAlert as AlertCircle, Info } from 'lucide-react'
import { supabase } from '../lib/supabase'
import type { LoyaltyProgramme, LoyaltyTier, EarnRule, RedeemOption, LoyaltyMember, LoyaltyLedgerEntry } from '../types'

const MEMBER_ID = 'LM-4001'

const KIND_ICONS: Record<string, typeof Wallet> = {
  wallet: Wallet,
  bill: FileText,
  basket: Tag,
  voucher: Tag,
  tradein: RefreshCw,
  delivery: Send,
  external: AlertCircle,
}

const TYPE_LABELS: Record<string, { label: string; sign: number }> = {
  earn: { label: 'Earned', sign: 1 },
  bonus: { label: 'Bonus', sign: 1 },
  redeem: { label: 'Redeemed', sign: -1 },
  expire: { label: 'Expired', sign: -1 },
  reverse: { label: 'Reversed', sign: -1 },
  adjust: { label: 'Adjusted', sign: 0 },
}

const FUNDER_LABELS: Record<string, string> = {
  operator: 'Marketplace',
  partner: 'Seller',
  shared: 'Shared',
}

function fmtPts(n: number | null): string {
  if (n === null || n === undefined) return '—'
  return Math.round(n).toLocaleString('en-US') + ' pts'
}

function fmtMoney(n: number): string {
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtMoney0(n: number): string {
  return '$' + Math.round(n).toLocaleString('en-US')
}

export function RewardsView() {
  const [programme, setProgramme] = useState<LoyaltyProgramme | null>(null)
  const [tiers, setTiers] = useState<LoyaltyTier[]>([])
  const [earnRules, setEarnRules] = useState<EarnRule[]>([])
  const [redeemOptions, setRedeemOptions] = useState<RedeemOption[]>([])
  const [member, setMember] = useState<LoyaltyMember | null>(null)
  const [ledger, setLedger] = useState<LoyaltyLedgerEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [redeemModalOpen, setRedeemModalOpen] = useState(false)
  const [selectedOption, setSelectedOption] = useState<string>('')
  const [redeemPoints, setRedeemPoints] = useState<number>(0)
  const [redeemError, setRedeemError] = useState<string>('')
  const [toast, setToast] = useState<string>('')

  const loadData = useCallback(async () => {
    const [progRes, tiersRes, rulesRes, optionsRes, memberRes, ledgerRes] = await Promise.all([
      supabase.from('loyalty_programme').select('*').maybeSingle(),
      supabase.from('loyalty_tiers').select('*').order('sort_order'),
      supabase.from('loyalty_earn_rules').select('*').order('id'),
      supabase.from('loyalty_redeem_options').select('*').order('id'),
      supabase.from('loyalty_members').select('*').eq('id', MEMBER_ID).maybeSingle(),
      supabase.from('loyalty_ledger').select('*').eq('member', MEMBER_ID).order('when_date', { ascending: false }),
    ])

    if (progRes.data) setProgramme(progRes.data as LoyaltyProgramme)
    if (tiersRes.data) setTiers(tiersRes.data as LoyaltyTier[])
    if (rulesRes.data) setEarnRules(rulesRes.data as EarnRule[])
    if (optionsRes.data) setRedeemOptions(optionsRes.data as RedeemOption[])
    if (memberRes.data) setMember(memberRes.data as LoyaltyMember)
    if (ledgerRes.data) setLedger(ledgerRes.data as LoyaltyLedgerEntry[])
    setLoading(false)
  }, [])

  useEffect(() => {
    loadData()
  }, [loadData])

  const tierOf = (m: LoyaltyMember): LoyaltyTier => {
    return tiers.find((t) => t.id === m.tier) || tiers[0]
  }

  const tierProgress = (m: LoyaltyMember) => {
    const cur = tierOf(m)
    const sorted = [...tiers].sort((a, b) => a.sort_order - b.sort_order)
    const next = sorted.find((t) => t.sort_order > cur.sort_order)
    if (!next) return { cur, next: null, pct: 100, need: 0 }
    const pct = Math.min(100, Math.round((m.qualify_12m / next.qualify_spend) * 100))
    const need = Math.max(0, next.qualify_spend - m.qualify_12m)
    return { cur, next, pct, need }
  }

  const openRedeem = (optId?: string) => {
    if (!member || !programme) return
    const active = redeemOptions.filter(
      (o) => o.status === 'active' && (o.audience === 'all' || o.audience === member.kind)
    )
    if (!active.length) {
      setToast('You need at least ' + fmtPts(programme.min_redeem) + ' before anything can be redeemed')
      setTimeout(() => setToast(''), 3000)
      return
    }
    const pick = optId || active[0].id
    setSelectedOption(pick)
    const opt = redeemOptions.find((o) => o.id === pick)
    setRedeemPoints(opt ? opt.min : 0)
    setRedeemError('')
    setRedeemModalOpen(true)
  }

  const validateRedeem = (): string => {
    if (!member || !programme) return 'No account loaded'
    const opt = redeemOptions.find((o) => o.id === selectedOption)
    if (!opt) return 'Select a redemption option'
    if (redeemPoints < opt.min) return `${opt.name} starts at ${fmtPts(opt.min)}`
    if (redeemPoints > member.balance) return `That is more than your balance (${fmtPts(member.balance)} available)`
    if (redeemPoints % opt.step !== 0) return `${opt.name} goes up in steps of ${fmtPts(opt.step)}`
    return ''
  }

  const submitRedeem = async () => {
    if (!member || !programme) return
    const err = validateRedeem()
    if (err) {
      setRedeemError(err)
      return
    }
    const opt = redeemOptions.find((o) => o.id === selectedOption)
    if (!opt) return
    const worth = +((redeemPoints / programme.per_unit) * opt.value_per).toFixed(2)
    const newBalance = member.balance - redeemPoints

    await supabase
      .from('loyalty_members')
      .update({
        balance: newBalance,
        lifetime_redeemed: member.lifetime_redeemed + redeemPoints,
        last_activity: '25 Jul 2026',
        expiring_soon: Math.max(0, member.expiring_soon - redeemPoints),
      })
      .eq('id', member.id)

    const newId = 'LTX-' + (70208 + ledger.length * 3)
    await supabase.from('loyalty_ledger').insert({
      id: newId,
      member: member.id,
      when_date: '25 Jul 2026',
      type: 'redeem',
      points: -redeemPoints,
      ref: opt.id,
      rule_id: null,
      funder: opt.cost,
      seller_id: null,
      value: worth,
      note: `Redeemed for ${opt.name.toLowerCase()} — ${fmtMoney(worth)}`,
    })

    setRedeemModalOpen(false)
    setToast(`${fmtPts(redeemPoints)} redeemed — ${fmtMoney(worth)} of ${opt.name.toLowerCase()}`)
    setTimeout(() => setToast(''), 4000)
    await loadData()
  }

  const bumpPoints = (dir: number) => {
    const opt = redeemOptions.find((o) => o.id === selectedOption)
    if (!opt || !member) return
    const step = opt.step
    const v = redeemPoints + dir * step
    setRedeemPoints(Math.max(opt.min, Math.min(Math.floor(member.balance / step) * step, v)))
    setRedeemError('')
  }

  if (loading || !programme || !member) {
    return (
      <div className="container" style={{ padding: '80px 0', textAlign: 'center' }}>
        <div style={{ fontSize: 'var(--text-lg)', color: 'var(--text-secondary)' }}>Loading rewards…</div>
      </div>
    )
  }

  const progress = tierProgress(member)
  const earned12 = ledger.filter((t) => t.points > 0).reduce((a, t) => a + t.points, 0)
  const activeOptions = redeemOptions.filter(
    (o) => o.status === 'active' && (o.audience === 'all' || o.audience === member.kind)
  )
  const activeRules = earnRules.filter(
    (r) =>
      r.status === 'active' &&
      (r.audience === 'all' || r.audience === member.kind || (r.audience === 'gold+' && progress.cur.sort_order >= 3))
  )

  return (
    <div className="container" style={{ padding: '32px 0' }}>
      {/* Page header */}
      <div style={{ marginBottom: '32px' }}>
        <h1 style={{ fontSize: 'var(--text-3xl)', fontWeight: 800, marginBottom: '8px' }}>{programme.name}</h1>
        <p style={{ fontSize: 'var(--text-base)', color: 'var(--text-secondary)', marginBottom: '16px' }}>
          What you have earned, what it is worth and when it runs out.
        </p>
        <button
          onClick={() => openRedeem()}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
            padding: '10px 20px',
            borderRadius: 'var(--radius)',
            background: 'var(--brand-accent)',
            color: 'white',
            border: 'none',
            fontWeight: 600,
            fontSize: 'var(--text-sm)',
            cursor: 'pointer',
            transition: 'opacity 200ms ease',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.opacity = '0.9')}
          onMouseLeave={(e) => (e.currentTarget.style.opacity = '1')}
        >
          <Zap size={16} /> Redeem
        </button>
      </div>

      {/* Expiry banner */}
      {member.expiring_soon > 0 ? (
        <div
          style={{
            background: 'var(--warning-bg, #FEF3C7)',
            border: '1px solid var(--warning-border, #FCD34D)',
            borderRadius: 'var(--radius-lg)',
            padding: '16px 20px',
            marginBottom: '24px',
            display: 'flex',
            gap: '12px',
            alignItems: 'flex-start',
          }}
        >
          <AlertCircle size={20} style={{ color: '#92400E', flexShrink: 0, marginTop: 2 }} />
          <div>
            <strong style={{ color: '#92400E' }}>{fmtPts(member.expiring_soon)} expire on {member.expiring_on}.</strong>{' '}
            <span style={{ color: '#92400E' }}>
              That is {fmtMoney(member.expiring_soon / programme.per_unit)} of value that disappears if not used. Points expire {programme.expiry_months} months after they were earned, oldest first.
            </span>
          </div>
        </div>
      ) : (
        <div
          style={{
            background: 'var(--bg-alt)',
            border: '1px solid var(--border-light)',
            borderRadius: 'var(--radius-lg)',
            padding: '16px 20px',
            marginBottom: '24px',
            display: 'flex',
            gap: '12px',
            alignItems: 'flex-start',
          }}
        >
          <Info size={20} style={{ color: 'var(--brand-accent)', flexShrink: 0, marginTop: 2 }} />
          <div>
            <strong>Nothing is close to expiring.</strong> Points last {programme.expiry_months} months from the day they were earned, and the oldest are always spent first.
          </div>
        </div>
      )}

      {/* Stats grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px', marginBottom: '32px' }}>
        <StatCard icon={<Zap size={20} />} label="Balance" value={fmtPts(member.balance)} foot={`Worth ${fmtMoney(member.balance / programme.per_unit)} as wallet credit`} />
        <StatCard icon={<Star size={20} />} label="Tier" value={progress.cur.name} foot={`${progress.cur.multiplier}× on everything you buy`} />
        <StatCard icon={<TrendingUp size={20} />} label="Qualifying spend" value={fmtMoney0(member.qualify_12m)} foot="Rolling 12 months" />
        <StatCard
          icon={<Clock size={20} />}
          label="Expiring soon"
          value={member.expiring_soon ? fmtPts(member.expiring_soon) : 'None'}
          foot={member.expiring_on ? `On ${member.expiring_on}` : 'Nothing within 90 days'}
        />
      </div>

      {/* Tier ladder */}
      <SectionCard icon={<Award size={18} />} title="Your tier">
        <div style={{ display: 'flex', gap: '0', marginBottom: '20px', overflowX: 'auto' }}>
          {[...tiers].sort((a, b) => a.sort_order - b.sort_order).map((t, i) => {
            const state = t.sort_order < progress.cur.sort_order ? 'past' : t.sort_order === progress.cur.sort_order ? 'here' : 'future'
            return (
              <div
                key={t.id}
                style={{
                  flex: '1 1 0',
                  minWidth: '140px',
                  textAlign: 'center',
                  padding: '16px 12px',
                  borderRight: i < tiers.length - 1 ? '1px solid var(--border-light)' : 'none',
                  position: 'relative',
                }}
              >
                <div
                  style={{
                    width: '40px',
                    height: '40px',
                    borderRadius: '50%',
                    margin: '0 auto 8px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontWeight: 700,
                    fontSize: 'var(--text-sm)',
                    background: state === 'past' ? '#16A34A20' : state === 'here' ? t.colour + '30' : 'var(--bg-alt)',
                    color: state === 'past' ? 'var(--success)' : state === 'here' ? t.colour : 'var(--text-tertiary)',
                    border: state === 'here' ? `2px solid ${t.colour}` : '2px solid transparent',
                  }}
                >
                  {state === 'past' ? <Check size={16} /> : state === 'here' ? <Star size={16} /> : t.sort_order}
                </div>
                <div style={{ fontWeight: 700, fontSize: 'var(--text-sm)', marginBottom: '2px' }}>{t.name}</div>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginBottom: '4px' }}>
                  {t.qualify_spend > 0 ? `${fmtMoney0(t.qualify_spend)} a year` : 'No qualification'}
                </div>
                <div style={{ fontSize: 'var(--text-xs)' }}>{t.multiplier}× earn</div>
                {state === 'here' && (
                  <div style={{ fontSize: 'var(--text-xs)', fontWeight: 700, color: t.colour, marginTop: '4px' }}>You are here</div>
                )}
              </div>
            )
          })}
        </div>

        {progress.next ? (
          <div style={{ display: 'flex', gap: '16px', alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 200px', minWidth: '200px' }}>
              <div
                style={{
                  height: '8px',
                  borderRadius: '4px',
                  background: 'var(--bg-alt)',
                  overflow: 'hidden',
                  marginBottom: '6px',
                }}
              >
                <div
                  style={{
                    height: '100%',
                    width: `${progress.pct}%`,
                    borderRadius: '4px',
                    background: 'var(--brand-accent)',
                    transition: 'width 600ms ease',
                  }}
                />
              </div>
              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>
                {fmtMoney0(member.qualify_12m)} of {fmtMoney0(progress.next.qualify_spend)}
              </div>
            </div>
            <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
              {fmtMoney0(progress.need)} more qualifying spend and you are {progress.next.name}.
            </div>
          </div>
        ) : (
          <div
            style={{
              background: 'var(--bg-alt)',
              borderRadius: 'var(--radius)',
              padding: '12px 16px',
              fontSize: 'var(--text-sm)',
              color: 'var(--text-secondary)',
            }}
          >
            <strong>Top tier held.</strong> There is nothing above {progress.cur.name}, and points do not expire while it is held.
          </div>
        )}

        <div style={{ borderTop: '1px solid var(--border-light)', margin: '20px 0 0', paddingTop: '20px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
          <div>
            <h4 style={{ fontWeight: 700, fontSize: 'var(--text-sm)', marginBottom: '8px' }}>What {progress.cur.name} gives you</h4>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {progress.cur.benefits.map((b, i) => (
                <li key={i} style={{ display: 'flex', gap: '8px', alignItems: 'flex-start', fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
                  <Check size={14} style={{ color: 'var(--success)', flexShrink: 0, marginTop: 3 }} />
                  {b}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h4 style={{ fontWeight: 700, fontSize: 'var(--text-sm)', marginBottom: '8px' }}>How the tier is decided</h4>
            <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', marginBottom: '8px' }}>
              Qualifying spend excludes tax, delivery and anything later refunded.
            </p>
            <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
              At the annual review, and only if qualifying spend has been below the threshold for a full twelve months. A member is told sixty days before it happens.
            </p>
          </div>
        </div>
      </SectionCard>

      {/* Redemption catalogue */}
      <SectionCard icon={<Gift size={18} />} title="What you can turn points into" subtitle={`${activeOptions.length} available to you · every one of them is spent inside the marketplace, and the rate differs because the funder differs`}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '16px' }}>
          {activeOptions.map((o) => {
            const Icon = KIND_ICONS[o.kind] || Zap
            const afford = member.balance >= o.min
            return (
              <div
                key={o.id}
                style={{
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-lg)',
                  padding: '16px',
                  background: afford ? 'white' : 'var(--bg-alt)',
                  opacity: afford ? 1 : 0.7,
                }}
              >
                <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-start', marginBottom: '12px' }}>
                  <div
                    style={{
                      width: '40px',
                      height: '40px',
                      borderRadius: 'var(--radius)',
                      background: 'var(--brand-accent)',
                      color: 'white',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                    }}
                  >
                    <Icon size={20} />
                  </div>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 'var(--text-sm)', marginBottom: '2px' }}>{o.name}</div>
                    <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>{o.description}</div>
                  </div>
                </div>
                <div style={{ borderTop: '1px solid var(--border-light)', paddingTop: '12px', display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', flex: '1 1 auto' }}>
                    From {fmtPts(o.min)} · funded by {FUNDER_LABELS[o.cost] || o.cost}
                  </span>
                  {afford ? (
                    <button
                      onClick={() => openRedeem(o.id)}
                      style={{
                        padding: '6px 14px',
                        borderRadius: 'var(--radius)',
                        border: '1px solid var(--brand-accent)',
                        background: 'white',
                        color: 'var(--brand-accent)',
                        fontWeight: 600,
                        fontSize: 'var(--text-xs)',
                        cursor: 'pointer',
                      }}
                    >
                      Redeem
                    </button>
                  ) : (
                    <span style={{ fontSize: 'var(--text-xs)', color: 'var(--danger)', fontWeight: 600 }}>
                      {fmtPts(o.min - member.balance)} short
                    </span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </SectionCard>

      {/* Ledger */}
      <SectionCard icon={<FileText size={18} />} title="Every movement on the account" subtitle={`${fmtPts(earned12)} earned on this account · ${ledger.length} movements on record`}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--text-sm)' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid var(--border)' }}>
                <th style={{ textAlign: 'left', padding: '10px 12px', fontWeight: 600, fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>When</th>
                <th style={{ textAlign: 'left', padding: '10px 12px', fontWeight: 600, fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>What</th>
                <th style={{ textAlign: 'left', padding: '10px 12px', fontWeight: 600, fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>Why</th>
                <th style={{ textAlign: 'right', padding: '10px 12px', fontWeight: 600, fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>Points</th>
                <th style={{ textAlign: 'right', padding: '10px 12px', fontWeight: 600, fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>Worth</th>
              </tr>
            </thead>
            <tbody>
              {ledger.map((t) => {
                const tl = TYPE_LABELS[t.type] || { label: t.type, sign: 0 }
                return (
                  <tr key={t.id} style={{ borderBottom: '1px solid var(--border-light)' }}>
                    <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>{t.when_date}</td>
                    <td style={{ padding: '10px 12px' }}>
                      <span
                        style={{
                          display: 'inline-block',
                          padding: '2px 8px',
                          borderRadius: 'var(--radius-full)',
                          fontSize: 'var(--text-xs)',
                          fontWeight: 600,
                          background: t.points < 0 ? '#DC262615' : t.points > 0 ? '#16A34A15' : 'var(--bg-alt)',
                          color: t.points < 0 ? 'var(--danger)' : t.points > 0 ? 'var(--success)' : 'var(--text-secondary)',
                        }}
                      >
                        {tl.label}
                      </span>
                    </td>
                    <td style={{ padding: '10px 12px' }}>
                      <div>{t.note}</div>
                      {t.ref && <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>{t.ref}</div>}
                    </td>
                    <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 600, color: t.points < 0 ? 'var(--danger)' : t.points > 0 ? 'var(--success)' : 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                      {t.points > 0 ? '+' : ''}{Math.round(t.points).toLocaleString('en-US')}
                    </td>
                    <td style={{ padding: '10px 12px', textAlign: 'right', whiteSpace: 'nowrap' }}>{fmtMoney(t.value)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </SectionCard>

      {/* Earn rules */}
      <SectionCard icon={<Info size={18} />} title="How points are earned here">
        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', marginBottom: '16px' }}>{programme.rounding_note}</p>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--text-sm)' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid var(--border)' }}>
                <th style={{ textAlign: 'left', padding: '10px 12px', fontWeight: 600, fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>Rule</th>
                <th style={{ textAlign: 'left', padding: '10px 12px', fontWeight: 600, fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>Applies to</th>
                <th style={{ textAlign: 'right', padding: '10px 12px', fontWeight: 600, fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>Rate</th>
                <th style={{ textAlign: 'left', padding: '10px 12px', fontWeight: 600, fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>Running</th>
              </tr>
            </thead>
            <tbody>
              {activeRules.map((r) => (
                <tr key={r.id} style={{ borderBottom: '1px solid var(--border-light)' }}>
                  <td style={{ padding: '10px 12px' }}>
                    <strong>{r.name}</strong>
                    <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>{r.why}</div>
                  </td>
                  <td style={{ padding: '10px 12px', fontSize: 'var(--text-xs)' }}>
                    {r.scope === 'all' ? 'Everything' : r.scope === 'vertical' ? r.scope_id : r.scope_id || 'Everything'}
                  </td>
                  <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 600 }}>{r.rate}×</td>
                  <td style={{ padding: '10px 12px', fontSize: 'var(--text-xs)' }}>
                    {r.from}{r.to ? ` – ${r.to}` : ' onwards'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionCard>

      {/* Redeem modal */}
      {redeemModalOpen && member && programme && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.4)',
            zIndex: 200,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '16px',
          }}
          onClick={() => setRedeemModalOpen(false)}
        >
          <div
            style={{
              background: 'white',
              borderRadius: 'var(--radius-xl)',
              maxWidth: '480px',
              width: '100%',
              maxHeight: '90vh',
              overflow: 'auto',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '20px 20px 0' }}>
              <Zap size={24} style={{ color: 'var(--brand-accent)' }} />
              <div style={{ flex: 1 }}>
                <h3 style={{ fontWeight: 700, fontSize: 'var(--text-lg)' }}>Redeem points</h3>
                <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)' }}>
                  {member.name} · {fmtPts(member.balance)} available
                </div>
              </div>
              <button onClick={() => setRedeemModalOpen(false)} style={{ border: 'none', background: 'none', cursor: 'pointer', padding: '4px' }} aria-label="Close">
                <X size={20} />
              </button>
            </div>

            <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div>
                <label style={{ display: 'block', fontSize: 'var(--text-sm)', fontWeight: 600, marginBottom: '6px' }}>What to turn them into</label>
                <select
                  value={selectedOption}
                  onChange={(e) => {
                    setSelectedOption(e.target.value)
                    const opt = redeemOptions.find((o) => o.id === e.target.value)
                    setRedeemPoints(opt ? opt.min : 0)
                    setRedeemError('')
                  }}
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    borderRadius: 'var(--radius)',
                    border: '1px solid var(--border)',
                    fontSize: 'var(--text-sm)',
                    background: 'white',
                  }}
                >
                  {activeOptions.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name} — from {fmtPts(o.min)}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 'var(--text-sm)', fontWeight: 600, marginBottom: '6px' }}>How many points</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0' }}>
                  <button
                    type="button"
                    onClick={() => bumpPoints(-1)}
                    style={{
                      padding: '10px 12px',
                      border: '1px solid var(--border)',
                      borderRadius: 'var(--radius) 0 0 var(--radius)',
                      background: 'var(--bg-alt)',
                      cursor: 'pointer',
                    }}
                    aria-label="Fewer points"
                  >
                    <Minus size={14} />
                  </button>
                  <input
                    type="number"
                    value={redeemPoints}
                    onChange={(e) => {
                      setRedeemPoints(parseInt(e.target.value, 10) || 0)
                      setRedeemError('')
                    }}
                    style={{
                      flex: 1,
                      padding: '10px 12px',
                      border: '1px solid var(--border)',
                      borderLeft: 'none',
                      borderRight: 'none',
                      textAlign: 'center',
                      fontSize: 'var(--text-sm)',
                      outline: 'none',
                    }}
                    aria-label="Points to redeem"
                  />
                  <button
                    type="button"
                    onClick={() => bumpPoints(1)}
                    style={{
                      padding: '10px 12px',
                      border: '1px solid var(--border)',
                      borderRadius: '0 var(--radius) var(--radius) 0',
                      background: 'var(--bg-alt)',
                      cursor: 'pointer',
                    }}
                    aria-label="More points"
                  >
                    <Plus size={14} />
                  </button>
                </div>
              </div>

              {redeemError ? (
                <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 'var(--radius)', padding: '12px 16px', fontSize: 'var(--text-sm)', color: '#991B1B' }}>
                  <strong>{redeemError}</strong>
                </div>
              ) : (() => {
                const opt = redeemOptions.find((o) => o.id === selectedOption)
                if (!opt) return null
                const worth = +((redeemPoints / programme.per_unit) * opt.value_per).toFixed(2)
                return (
                  <div style={{ background: 'var(--bg-alt)', borderRadius: 'var(--radius)', padding: '12px 16px', fontSize: 'var(--text-sm)' }}>
                    <strong>{fmtPts(redeemPoints)} becomes {fmtMoney(worth)}.</strong> {opt.why}
                    <br />
                    The balance after this would be {fmtPts(member.balance - redeemPoints)}, and the liability behind those points is released the moment it happens.
                  </div>
                )
              })()}
            </div>

            <div style={{ display: 'flex', gap: '12px', padding: '0 20px 20px', justifyContent: 'flex-end' }}>
              <button
                onClick={() => setRedeemModalOpen(false)}
                style={{
                  padding: '10px 20px',
                  borderRadius: 'var(--radius)',
                  border: '1px solid var(--border)',
                  background: 'white',
                  fontWeight: 600,
                  fontSize: 'var(--text-sm)',
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                onClick={submitRedeem}
                style={{
                  padding: '10px 20px',
                  borderRadius: 'var(--radius)',
                  border: 'none',
                  background: 'var(--brand-accent)',
                  color: 'white',
                  fontWeight: 600,
                  fontSize: 'var(--text-sm)',
                  cursor: 'pointer',
                }}
              >
                Redeem
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div
          style={{
            position: 'fixed',
            bottom: '24px',
            left: '50%',
            transform: 'translateX(-50%)',
            background: 'var(--brand-navy)',
            color: 'white',
            padding: '12px 24px',
            borderRadius: 'var(--radius-lg)',
            fontSize: 'var(--text-sm)',
            fontWeight: 600,
            zIndex: 300,
            boxShadow: 'var(--shadow-lg)',
          }}
        >
          {toast}
        </div>
      )}
    </div>
  )
}

function StatCard({ icon, label, value, foot }: { icon: React.ReactNode; label: string; value: string; foot: string }) {
  return (
    <div
      style={{
        background: 'white',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-lg)',
        padding: '20px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px', color: 'var(--brand-accent)' }}>
        {icon}
        <span style={{ fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--text-tertiary)' }}>{label}</span>
      </div>
      <div style={{ fontSize: 'var(--text-2xl)', fontWeight: 800, marginBottom: '4px' }}>{value}</div>
      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>{foot}</div>
    </div>
  )
}

function SectionCard({ icon, title, subtitle, children }: { icon: React.ReactNode; title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        background: 'white',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-lg)',
        padding: '24px',
        marginBottom: '24px',
      }}
    >
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
