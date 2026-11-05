import { useState, useEffect, useCallback } from 'react'
import { Zap, Star, Award, Gift, Wallet, FileText, Tag, RefreshCw, Send, Minus, Plus, Check, CircleAlert as AlertCircle, Info } from 'lucide-react'
import { BentoCard, KpiCard, StatusBadge, Dialog } from './ui'
import { AccountPage } from './account/AccountPage'
import { creditWalletFromRewards, loadMyWallet } from '../lib/walletRepo'
import { loadMyRewards, redeemPoints as redeemThroughTheMarketplace } from '../lib/loyaltyRepo'
import {
  validateRedemption, offeredTo, mostRedeemable, ladderIn, rungOf, rungState, nextRung,
  rateFor, worthIn, earnLine,
} from '../lib/loyalty'
import { useMarket } from '../lib/MarketContext'
import type { LoyaltyTier, EarnRule, LoyaltyLedgerEntry } from '../types'
import type { Programme as LoyaltyProgramme, RedeemOption, Member as LoyaltyMember, PointRate, Threshold } from '../lib/loyalty'
import { Pager, usePaging } from './Pager'

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

/* Both of these used to write a `$` and nothing else could be said about it.
   Every money figure on this screen is in the member's own currency now — what
   their points are worth, what they have spent, what the next rung costs — so
   the formatter takes it. */

/* A point at the plain rate — no option's own multiplier on top. Used where the
   screen says what a balance is worth in general rather than under one choice. */
const BASE = { value_per: 1 }

export function RewardsView() {
  const [programme, setProgramme] = useState<LoyaltyProgramme | null>(null)
  const [tiers, setTiers] = useState<LoyaltyTier[]>([])
  const [rates, setRates] = useState<PointRate[]>([])
  const [thresholds, setThresholds] = useState<Threshold[]>([])
  const { fmtIn } = useMarket()
  const [earnRules, setEarnRules] = useState<EarnRule[]>([])
  const [redeemOptions, setRedeemOptions] = useState<RedeemOption[]>([])
  const [member, setMember] = useState<LoyaltyMember | null>(null)
  const [ledger, setLedger] = useState<LoyaltyLedgerEntry[]>([])
  /* Nineteen movements and growing. Scrolling a ledger is not reading one. */
  const ledgerPage = usePaging(ledger, { initialSize: 10 })
  const [loading, setLoading] = useState(true)
  const [redeemModalOpen, setRedeemModalOpen] = useState(false)
  const [selectedOption, setSelectedOption] = useState<string>('')
  const [redeemPoints, setRedeemPoints] = useState<number>(0)
  const [redeemError, setRedeemError] = useState<string>('')
  const [toast, setToast] = useState<string>('')

  /* Whoever is signed in, rather than LM-4001 by name — that constant was
     right for exactly one demo login and wrong for everybody else. Row-level
     security returns the caller's own membership and nobody else's. */
  const loadData = useCallback(async () => {
    const book = await loadMyRewards()
    setProgramme(book.programme)
    setTiers(book.tiers)
    setRates(book.rates)
    setThresholds(book.thresholds)
    setEarnRules(book.rules)
    setRedeemOptions(book.options)
    setMember(book.member)
    setLedger(book.ledger)
    setLoading(false)
  }, [])

  useEffect(() => {
    loadData()
  }, [loadData])

  /* Scoped to this member's own ladder. `loyalty_tiers` holds the retail and
     the business progressions in one table, sharing sort_order 1..4, so an
     unscoped list is eight interleaved rungs — and the fallback to `tiers[0]`
     below used to land a retail customer on "Registered", a business rung.
     The rules are in `loyalty.ts` and tested there. */
  /* The member's own money, everywhere on this screen. `rate` is what a point
     is worth where they are — $0.01 to a dollar customer, ₹1 to a rupee one —
     and the ladder carries the thresholds set for their currency rather than
     the dollar ones every rung used to show. */
  const rate = rateFor(rates, member?.currency ?? 'USD')
  const money = (n: number) => fmtIn(n, member?.currency ?? 'USD')
  const money0 = (n: number) => fmtIn(n, member?.currency ?? 'USD', { decimals: false })
  const ladder = (member
    ? ladderIn(tiers as unknown as (typeof tiers[number] & { id: string; sort_order: number; qualify_spend: number; kind: string })[], thresholds, member)
    : []) as LoyaltyTier[]

  /* Both read the ladder built above — scoped to the member's kind and carrying
     the thresholds for their currency. Passing raw `tiers` here told a Gold
     customer with ₹187,127 of spend that she was at the top, because every
     dollar threshold on the raw rungs is below that number. */
  const tierProgress = (m: LoyaltyMember) => {
    const cur = (rungOf(ladder, m) ?? ladder[0]) as LoyaltyTier
    return { cur, ...nextRung(ladder, m) }
  }

  const openRedeem = (optId?: string) => {
    if (!member || !programme) return
    const active = offeredTo(redeemOptions, member)
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

  /* The same rules `redeem_points()` applies in the database, asked here first
     so a refusal is a sentence the customer can act on rather than an error
     that arrives after they have pressed the button. */
  const validateRedeem = (): string => {
    const check = validateRedemption({
      member, programme,
      option: redeemOptions.find((o) => o.id === selectedOption),
      points: redeemPoints,
    })
    return check.ok ? '' : check.reason
  }

  const submitRedeem = async () => {
    if (!member || !programme) return
    const err = validateRedeem()
    if (err) { setRedeemError(err); return }
    const opt = redeemOptions.find((o) => o.id === selectedOption)
    if (!opt) return

    /* The client no longer writes the ledger or the balance — the policies that
       let it are gone, because a balance a client can write is not a balance.
       `redeem_points()` reads the option, the programme and the balance for
       itself and posts the movement. */
    const res = await redeemThroughTheMarketplace({
      book: { programme, member, tiers, rules: earnRules, options: redeemOptions, ledger, rates, thresholds },
      optionId: opt.id,
      points: redeemPoints,
    })
    if (!res.ok) { setRedeemError(res.reason); return }

    /* Wallet credit is the one redemption that has somewhere to land. It goes
       into the promotional pot: the customer did not pay for these points, so
       converting them must not create money they can withdraw to a card. */
    let walletNote = ''
    if (opt.kind === 'wallet') {
      const mine = await loadMyWallet()
      if (mine.wallet) {
        const credited = await creditWalletFromRewards({
          walletId: mine.wallet.id, points: redeemPoints, credit: res.worth ?? 0, optionId: opt.id,
        })
        walletNote = credited.ok
          ? ' — spendable in the marketplace, not refundable as cash'
          : ` — but the wallet was not credited: ${credited.reason}`
      }
    }

    setRedeemModalOpen(false)
    setToast(`${res.note}${walletNote}`)
    setTimeout(() => setToast(''), 4000)
    await loadData()
  }

  const bumpPoints = (dir: number) => {
    const opt = redeemOptions.find((o) => o.id === selectedOption)
    if (!opt || !member) return
    const v = redeemPoints + dir * opt.step
    setRedeemPoints(Math.max(opt.min, Math.min(mostRedeemable(opt, member), v)))
    setRedeemError('')
  }

  if (loading || !programme || !member) {
    return (
      <AccountPage title="Rewards">
        <div style={{ textAlign: 'center', padding: '32px 0', color: 'var(--text-secondary)' }}>Loading rewards…</div>
      </AccountPage>
    )
  }

  const progress = tierProgress(member)
  const earned12 = ledger.filter((t) => t.points > 0).reduce((a, t) => a + t.points, 0)
  const activeOptions = offeredTo(redeemOptions, member)
  const activeRules = earnRules.filter(
    (r) =>
      r.status === 'active' &&
      (r.audience === 'all' || r.audience === member.kind || (r.audience === 'gold+' && progress.cur.sort_order >= 3))
  )
  /* The label for the bar is built from the two figures the bar is drawn from:
     what has been spent, and what the next rung asks for. */
  const progressLabel = progress.next
    ? `${money0(member.qualify_12m)} of ${money0(progress.next.qualify_spend)} qualifying spend towards ${progress.next.name}`
    : ''

  return (
    <AccountPage
      title={programme.name}
      subtitle="What you have earned, what it is worth and when it runs out."
      actions={
        <button type="button" className="acct-btn acct-btn--primary" onClick={() => openRedeem()}>
          <Zap size={16} aria-hidden="true" /> Redeem
        </button>
      }
    >
      {/* Expiry banner */}
      {member.expiring_soon > 0 ? (
        <div className="acct-notice acct-notice--warning">
          <AlertCircle size={20} aria-hidden="true" className="acct-notice__icon" />
          <div>
            <strong>{fmtPts(member.expiring_soon)} expire on {member.expiring_on}.</strong>{' '}
            <span>
              That is {money(worthIn(member.expiring_soon, BASE, rate))} of value that disappears if not used. Points expire {programme.expiry_months} months after they were earned, oldest first.
            </span>
          </div>
        </div>
      ) : (
        <div className="acct-notice">
          <Info size={20} aria-hidden="true" className="acct-notice__icon acct-notice__icon--teal" />
          <div>
            <strong>Nothing is close to expiring.</strong> Points last {programme.expiry_months} months from the day they were earned, and the oldest are always spent first.
          </div>
        </div>
      )}

      {/* Figures: 4 / 2 / 1 columns */}
      <div className="rw-kpis">
        <KpiCard label="Balance" value={fmtPts(member.balance)}>
          <div className="rw-kpi-foot">Worth {money(worthIn(member.balance, BASE, rate))} as wallet credit</div>
        </KpiCard>
        <KpiCard label="Tier" value={progress.cur.name}>
          <div className="rw-kpi-foot">{progress.cur.multiplier}× on everything you buy</div>
        </KpiCard>
        <KpiCard label="Qualifying spend" value={money0(member.qualify_12m)}>
          <div className="rw-kpi-foot">Rolling 12 months</div>
        </KpiCard>
        <KpiCard label="Expiring soon" value={member.expiring_soon ? fmtPts(member.expiring_soon) : 'None'}>
          <div className="rw-kpi-foot">{member.expiring_on ? `On ${member.expiring_on}` : 'Nothing within 90 days'}</div>
        </KpiCard>
      </div>

      <div className="rw-sections">
        {/* Tier ladder */}
        <BentoCard headingLevel={2} className="rw-span2"
          title={<span className="rw-title"><Award size={18} aria-hidden="true" />Your tier</span>}>
          <div className="rw-ladder">
            {ladder.map((t, i) => {
              const state = rungState(t, progress.cur)
              return (
                <div key={t.id} className="rw-rung">
                  <div
                    className="rw-rung__dot"
                    style={{
                      background: state === 'past' ? '#16A34A20' : state === 'here' ? t.colour + '30' : 'var(--bg-alt)',
                      color: state === 'past' ? 'var(--success)' : state === 'here' ? 'var(--text)' : 'var(--text-secondary)',
                      border: state === 'here' ? `2px solid ${t.colour}` : '2px solid transparent',
                    }}
                  >
                    {state === 'past' ? <Check size={16} aria-hidden="true" /> : state === 'here' ? <Star size={16} aria-hidden="true" /> : i + 1}
                  </div>
                  <div className="rw-rung__name">{t.name}</div>
                  <div className="rw-rung__meta">
                    {t.qualify_spend > 0 ? `${money0(t.qualify_spend)} a year` : 'No qualification'}
                  </div>
                  <div className="rw-rung__meta">{t.multiplier}× earn</div>
                  {/* t.colour comes from loyalty_tiers and is chosen for the badge, not for
                      legibility as text — Gold is 2.44:1 on white. The tier colour still carries
                      the badge and border above; the label itself uses readable ink. */}
                  {state === 'here' && <div className="rw-rung__here">You are here</div>}
                </div>
              )
            })}
          </div>

          {progress.next ? (
            <div className="rw-progress">
              {/* The bar is decoration for the label under it, which says the
                  same thing in words, so the state never rests on colour. */}
              <div className="rw-bar" role="progressbar" aria-label={progressLabel}
                aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress.pct)}>
                <div className="rw-bar__fill" style={{ width: `${progress.pct}%` }} />
              </div>
              <div className="rw-progress__label">{progressLabel}</div>
              <div className="rw-progress__need">
                {money0(progress.need)} more qualifying spend and you are {progress.next.name}.
              </div>
            </div>
          ) : (
            <div className="acct-callout">
              <strong>Top tier held.</strong> There is nothing above {progress.cur.name}, and points do not expire while it is held.
            </div>
          )}

          <div className="rw-tier-info">
            <div>
              <h3 className="rw-sub">What {progress.cur.name} gives you</h3>
              <ul className="rw-checks">
                {/* The earn rate is assembled here rather than stored. It used to
                    be prose on the tier — "Earn 1.5 points per $1" — which is
                    wrong in three of the four currencies the marketplace trades
                    in. The multiplier belongs to the rung, the currency to the
                    reader, and the sentence needs both. */}
                {rate && (
                  <li>
                    <Check size={14} aria-hidden="true" />
                    Earn {earnLine(rate, Number(progress.cur.multiplier)).replace(
                      /per ([\d.]+) spent/, (_, n) => `per ${money0(Number(n))} spent`)}
                  </li>
                )}
                {progress.cur.benefits.map((b, i) => (
                  <li key={i}>
                    <Check size={14} aria-hidden="true" />
                    {b}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h3 className="rw-sub">How the tier is decided</h3>
              <p className="rw-text">Qualifying spend excludes tax, delivery and anything later refunded.</p>
              <p className="rw-text rw-text--small">
                At the annual review, and only if qualifying spend has been below the threshold for a full twelve months. A member is told sixty days before it happens.
              </p>
            </div>
          </div>
        </BentoCard>

        {/* Redemption catalogue */}
        <BentoCard headingLevel={2} className="rw-span2"
          title={<span className="rw-title"><Gift size={18} aria-hidden="true" />What you can turn points into</span>}
          text={`${activeOptions.length} available to you · every one of them is spent inside the marketplace, and the rate differs because the funder differs`}>
          <div className="rw-options">
            {activeOptions.map((o) => {
              const Icon = KIND_ICONS[o.kind] || Zap
              const afford = member.balance >= o.min
              return (
                <div key={o.id} className={`rw-option${afford ? '' : ' rw-option--short'}`}>
                  <div className="rw-option__top">
                    <div className="rw-option__icon"><Icon size={20} aria-hidden="true" /></div>
                    <div>
                      <div className="rw-option__name">{o.name}</div>
                      {/* What the minimum is worth, in the reader's own money.
                          The description used to open with "100 points becomes
                          $1.00" — one sentence, one currency, true for one reader
                          in four. The rate belongs to the option, the currency to
                          the reader, and only this line knows both. */}
                      <div className="rw-option__worth">{fmtPts(o.min)} → {money(worthIn(o.min, o, rate))}</div>
                      <div className="rw-text rw-text--small">{o.description}</div>
                    </div>
                  </div>
                  <div className="rw-option__foot">
                    <span className="rw-text rw-text--small" style={{ flex: '1 1 auto' }}>
                      From {fmtPts(o.min)} · funded by {FUNDER_LABELS[o.cost] || o.cost}
                    </span>
                    {afford ? (
                      <button type="button" className="acct-btn" onClick={() => openRedeem(o.id)}
                        aria-label={`Redeem ${o.name}`}>
                        Redeem
                      </button>
                    ) : (
                      <span className="rw-option__short">{fmtPts(o.min - member.balance)} short</span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </BentoCard>

        {/* Ledger */}
        <BentoCard headingLevel={2}
          title={<span className="rw-title"><FileText size={18} aria-hidden="true" />Every movement on the account</span>}
          text={`${fmtPts(earned12)} earned on this account · ${ledger.length} movements on record`}>
          <div className="rw-table-wrap">
            <table className="rw-table">
              <thead>
                <tr>
                  <th scope="col">When</th>
                  <th scope="col">What</th>
                  <th scope="col">Why</th>
                  <th scope="col" className="rw-num">Points</th>
                  <th scope="col" className="rw-num">Worth</th>
                </tr>
              </thead>
              <tbody>
                {ledgerPage.rows.map((t) => {
                  const tl = TYPE_LABELS[t.type] || { label: t.type, sign: 0 }
                  return (
                    <tr key={t.id}>
                      <td style={{ whiteSpace: 'nowrap' }}>{t.when_date}</td>
                      <td>
                        <StatusBadge tone={t.points < 0 ? 'danger' : t.points > 0 ? 'success' : 'neutral'} icon={null}>
                          {tl.label}
                        </StatusBadge>
                      </td>
                      <td>
                        <div>{t.note}</div>
                        {t.ref && <div className="rw-text rw-text--small">{t.ref}</div>}
                      </td>
                      <td className="rw-num" style={{ fontWeight: 600, color: t.points < 0 ? 'var(--danger)' : t.points > 0 ? 'var(--success)' : 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                        {t.points > 0 ? '+' : ''}{Math.round(t.points).toLocaleString('en-US')}
                      </td>
                      <td className="rw-num" style={{ whiteSpace: 'nowrap' }}>{fmtIn(Number(t.value), t.currency ?? member.currency)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <Pager page={ledgerPage} noun="movements" />
        </BentoCard>

        {/* Earn rules */}
        <BentoCard headingLevel={2}
          title={<span className="rw-title"><Info size={18} aria-hidden="true" />How points are earned here</span>}
          text={programme.rounding_note}>
          <div className="rw-table-wrap">
            <table className="rw-table">
              <thead>
                <tr>
                  <th scope="col">Rule</th>
                  <th scope="col">Applies to</th>
                  <th scope="col" className="rw-num">Rate</th>
                  <th scope="col">Running</th>
                </tr>
              </thead>
              <tbody>
                {activeRules.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <strong>{r.name}</strong>
                      <div className="rw-text rw-text--small">{r.why}</div>
                    </td>
                    <td>{r.scope === 'all' ? 'Everything' : r.scope === 'vertical' ? r.scope_id : r.scope_id || 'Everything'}</td>
                    <td className="rw-num" style={{ fontWeight: 600 }}>{r.rate}×</td>
                    <td>{r.from}{r.to ? ` – ${r.to}` : ' onwards'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </BentoCard>
      </div>

      {/* Redeem modal */}
      <Dialog
        open={redeemModalOpen && !!member && !!programme}
        onClose={() => setRedeemModalOpen(false)}
        title="Redeem points"
        footer={
          <>
            <button type="button" className="acct-btn" onClick={() => setRedeemModalOpen(false)}>Cancel</button>
            <button type="button" className="acct-btn acct-btn--primary" onClick={submitRedeem}>Redeem</button>
          </>
        }
      >
        <div className="rw-form">
          <div className="rw-text">{member.name} · {fmtPts(member.balance)} available</div>

          <div>
            <label className="rw-label" htmlFor="rw-option">What to turn them into</label>
            <select
              id="rw-option"
              className="rw-field"
              value={selectedOption}
              onChange={(e) => {
                setSelectedOption(e.target.value)
                const opt = redeemOptions.find((o) => o.id === e.target.value)
                setRedeemPoints(opt ? opt.min : 0)
                setRedeemError('')
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
            <label className="rw-label" htmlFor="rw-points">How many points</label>
            <div className="rw-stepper">
              <button type="button" className="rw-stepper__btn" onClick={() => bumpPoints(-1)} aria-label="Fewer points">
                <Minus size={14} aria-hidden="true" />
              </button>
              <input
                id="rw-points"
                type="number"
                className="rw-stepper__input"
                value={redeemPoints}
                onChange={(e) => {
                  setRedeemPoints(parseInt(e.target.value, 10) || 0)
                  setRedeemError('')
                }}
                aria-label="Points to redeem"
              />
              <button type="button" className="rw-stepper__btn" onClick={() => bumpPoints(1)} aria-label="More points">
                <Plus size={14} aria-hidden="true" />
              </button>
            </div>
          </div>

          {redeemError ? (
            <div className="acct-notice acct-notice--danger" role="alert" style={{ margin: 0 }}>
              <div><strong>{redeemError}</strong></div>
            </div>
          ) : (() => {
            const opt = redeemOptions.find((o) => o.id === selectedOption)
            if (!opt) return null
            const worth = worthIn(redeemPoints, opt, rate)
            return (
              <div className="acct-callout">
                <strong>{fmtPts(redeemPoints)} becomes {money(worth)}.</strong> {opt.why}
                <br />
                The balance after this would be {fmtPts(member.balance - redeemPoints)}, and the liability behind those points is released the moment it happens.
              </div>
            )
          })()}
        </div>
      </Dialog>

      {/* Toast */}
      {toast && (
        <div role="status" className="rw-toast">
          {toast}
        </div>
      )}
    </AccountPage>
  )
}
