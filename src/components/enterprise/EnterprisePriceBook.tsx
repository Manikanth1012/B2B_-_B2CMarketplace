import { useState, useEffect, useCallback, useMemo } from 'react'
import { SectionCard, Table, Td, StatusPill, Btn, toast, fmtDate, FormField, TextArea, Select, EmptyState } from '../operator/shared'
import { Callout } from '../OnboardingJourney'
import { PriceTag } from '../pricebooks/PriceTag'
import { RuleCards } from '../pricebooks/RuleCards'
import { useAccountMoney } from './money'
import { loadAccount, loadEnterpriseCatalogue } from '../../lib/enterpriseRepo'
import type { AccountBook, EnterpriseListing } from '../../lib/enterpriseRepo'
import { saveBuyingRules, addPreference, removePreference } from '../../lib/priceBookRepo'
import { standingOf } from '../../lib/accountPrices'
import type { AccountPrice, OffContractRule, PriceStanding } from '../../lib/accountPrices'
import { may } from '../../lib/enterpriseAdmin'
import { priceStandingStatus } from '../../lib/consoleTone'

/* The account's own prices and the rules it buys by.
 *
 * Prices are agreed with Aventa and are read-only here: the account sees what
 * it will be charged, what everybody else sees beside it, and the saving.
 * The buying rules and the preferred sellers and products are the account's
 * own policy, so they are editable by a role that may set policy and shown
 * (not hidden) to everybody else.
 *
 * Before the price-book migration is applied the repo reads no prices, the
 * 'allow' rule and no preferences, and a write answers with a sentence. This
 * screen shows the empty state and that sentence rather than failing.
 */

const READ_ONLY = 'Only somebody who can set your account\'s policy can change these.'
const ORDER: Record<PriceStanding, number> = { 'in force': 0, scheduled: 1, ended: 2, withdrawn: 3 }

export function EnterprisePriceBook() {
  const [book, setBook] = useState<AccountBook | null>(null)
  const [listings, setListings] = useState<EnterpriseListing[]>([])
  const [rule, setRule] = useState<OffContractRule>('allow')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [pickSeller, setPickSeller] = useState('')
  const [pickProduct, setPickProduct] = useState('')

  const reload = useCallback(async () => {
    const b = await loadAccount()
    setBook(b)
    setRule(b.rules.off_contract)
    setNote(b.rules.note ?? '')
    /* The pickers and the product names come from the shelf, one read per
       currency the account has a price in, plus its own. */
    const codes = Array.from(new Set([b.account?.currency, ...b.prices.map(p => p.currency)].filter(Boolean))) as string[]
    const shelves = await Promise.all(codes.map(c => loadEnterpriseCatalogue(c, b.account?.id).catch(() => [] as EnterpriseListing[])))
    setListings(shelves.flat())
  }, [])
  useEffect(() => { void reload() }, [reload])

  const cur = book?.account?.currency ?? 'USD'
  const { money } = useAccountMoney(cur)
  const today = new Date().toISOString().slice(0, 10)

  const byKey = useMemo(() => {
    const m = new Map<string, EnterpriseListing>()
    for (const l of listings) m.set(`${l.currency}:${l.id}`, l)
    return m
  }, [listings])
  const shelf = useMemo(() => {
    const m = new Map<string, EnterpriseListing>()
    for (const l of listings) if (!m.has(l.id)) m.set(l.id, l)
    return Array.from(m.values())
  }, [listings])

  if (!book) {
    return <div style={{ textAlign: 'center', padding: '40px' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>
  }
  if (book.loadError) {
    return <Callout tone="danger" title="Your price book did not load">{book.loadError}</Callout>
  }

  const editable = may(book.me, book.roles, 'can_set_policy')
  const accountId = book.account?.id ?? book.rules.account_id

  const rows = book.prices
    .map(p => ({ p, standing: standingOf(p, today) }))
    .sort((a, b) => ORDER[a.standing] - ORDER[b.standing] || a.p.starts_on.localeCompare(b.p.starts_on))
  const current = rows.filter(r => r.standing === 'in force' || r.standing === 'scheduled')
  const earlier = rows.filter(r => r.standing === 'ended' || r.standing === 'withdrawn')

  const nameOf = (p: AccountPrice) => byKey.get(`${p.currency}:${p.product_id}`)?.name
    ?? shelf.find(l => l.id === p.product_id)?.name ?? p.product_id
  const publishedOf = (p: AccountPrice): number | null => byKey.get(`${p.currency}:${p.product_id}`)?.published_price ?? null

  const priceRow = ({ p, standing }: { p: AccountPrice; standing: PriceStanding }) => {
    const pub = publishedOf(p)
    const saved = pub !== null && pub > p.unit_price ? pub - p.unit_price : 0
    return (
      <tr key={p.id}>
        <Td>{nameOf(p)}</Td>
        <Td>{pub !== null ? <PriceTag price={p.unit_price} published={pub} currency={p.currency} /> : <PriceTag price={p.unit_price} published={p.unit_price} currency={p.currency} />}</Td>
        <Td right>{pub !== null ? <PriceTag price={pub} published={pub} currency={p.currency} /> : '—'}</Td>
        <Td right>{saved > 0 ? money(saved) : '—'}</Td>
        <Td>{p.currency}</Td>
        <Td>{fmtDate(p.starts_on)} – {p.ends_on ? fmtDate(p.ends_on) : 'open-ended'}</Td>
        <Td><StatusPill status={priceStandingStatus(standing)} label={standing} /></Td>
      </tr>
    )
  }
  const headers = ['Listing', 'Your price', { label: 'Published', align: 'right' as const }, { label: 'Saving', align: 'right' as const }, 'Currency', 'From – to', 'Standing']

  const save = async () => {
    setSaving(true); setProblem(null)
    const r = await saveBuyingRules({ account_id: accountId, off_contract: rule, note: note.trim() || null })
    setSaving(false)
    if (!r.ok) { setProblem(r.error); return }
    toast('Your buying rules are saved.')
    await reload()
  }

  const add = async (kind: 'seller' | 'product', id: string) => {
    if (!id) return
    setProblem(null)
    const r = await addPreference(kind === 'seller'
      ? { account_id: accountId, kind, partner_id: id }
      : { account_id: accountId, kind, product_id: id })
    if (!r.ok) { setProblem(r.error); return }
    if (kind === 'seller') setPickSeller(''); else setPickProduct('')
    await reload()
  }
  const remove = async (id: string) => {
    setProblem(null)
    const r = await removePreference(id)
    if (!r.ok) { setProblem(r.error); return }
    await reload()
  }

  const sellerPrefs = book.preferences.filter(x => x.kind === 'seller')
  const productPrefs = book.preferences.filter(x => x.kind === 'product')
  const sellers = Array.from(new Map(shelf.filter(l => l.partner_id).map(l => [l.partner_id as string, l.seller])).entries())
    .filter(([id]) => !sellerPrefs.some(x => x.partner_id === id))
  const products = shelf.filter(l => !productPrefs.some(x => x.product_id === l.id))
  const sellerName = (id: string | null) => shelf.find(l => l.partner_id === id)?.seller ?? 'A seller'
  const productName = (id: string | null) => shelf.find(l => l.id === id)?.name ?? 'A product'

  const prefList = (title: string, kind: 'seller' | 'product', items: typeof sellerPrefs,
    label: (id: string | null) => string, options: [string, string][], pick: string, setPick: (v: string) => void) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      <h3 style={{ fontSize: 'var(--text-sm)', fontWeight: 700 }}>{title}</h3>
      {items.length === 0
        ? <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>None chosen. Preferred ones are shown first on the shelf.</p>
        : (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {items.map(x => {
              const name = label(kind === 'seller' ? x.partner_id : x.product_id)
              return (
                <li key={x.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                  <span>{name}</span>
                  {editable && <Btn variant="secondary" size="sm" style={{ minHeight: '44px' }}
                    aria-label={`Remove ${name} from ${title.toLowerCase()}`} onClick={() => void remove(x.id)}>Remove</Btn>}
                </li>
              )
            })}
          </ul>
        )}
      {editable && (
        <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 220px' }}>
            <FormField label={`Add to ${title.toLowerCase()}`}>
              <Select value={pick} onChange={e => setPick(e.target.value)}>
                <option value="">Choose…</option>
                {options.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
              </Select>
            </FormField>
          </div>
          <Btn variant="secondary" style={{ minHeight: '44px' }} disabled={!pick} onClick={() => void add(kind, pick)}>Add</Btn>
        </div>
      )}
    </div>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div>
        <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 800, color: 'var(--text)' }}>Price book</h1>
        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)', marginTop: '4px', maxWidth: '84ch' }}>
          The prices Aventa has agreed for your account, and the rules you buy by. A price here is
          what you are charged; a listing without one is charged at its published price.
        </p>
      </div>

      <SectionCard title="Your prices">
        {current.length === 0 && earlier.length === 0 ? (
          <EmptyState message="Your account has no prices of its own yet. They are agreed with Aventa; until then every listing is charged at its published price." />
        ) : (
          <>
            {current.length === 0
              ? <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>No price is in force or scheduled.</p>
              : <Table headers={headers}>{current.map(priceRow)}</Table>}
            {earlier.length > 0 && (
              <details style={{ marginTop: '12px' }}>
                <summary style={{ cursor: 'pointer', minHeight: '44px', display: 'flex', alignItems: 'center', fontWeight: 600 }}>
                  Earlier prices ({earlier.length})
                </summary>
                <Table headers={headers}>{earlier.map(priceRow)}</Table>
              </details>
            )}
          </>
        )}
      </SectionCard>

      <SectionCard title="Buying rules" subtitle="What happens when a buyer adds something that is not on your price book.">
        {!editable && <div style={{ marginBottom: '12px' }}><Callout tone="info">{READ_ONLY}</Callout></div>}
        <RuleCards value={rule} onChange={setRule} readOnly={!editable} />
        <div style={{ marginTop: '12px', maxWidth: '84ch' }}>
          <FormField label="Note for your buyers and approvers">
            <TextArea rows={2} value={note} readOnly={!editable} onChange={e => setNote(e.target.value)} maxLength={300} />
          </FormField>
        </div>
        {editable && (
          <div style={{ marginTop: '12px' }}>
            <Btn style={{ minHeight: '44px' }} disabled={saving} onClick={() => void save()}>{saving ? 'Saving…' : 'Save buying rules'}</Btn>
          </div>
        )}
        {problem && <div role="alert" style={{ marginTop: '12px' }}><Callout tone="danger">{problem}</Callout></div>}
      </SectionCard>

      <SectionCard title="Preferred sellers and products" subtitle="Shown first on your shelf. Nothing else is hidden or blocked.">
        {!editable && <div style={{ marginBottom: '12px' }}><Callout tone="info">{READ_ONLY}</Callout></div>}
        <div style={{ display: 'grid', gap: '24px', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}>
          {prefList('Preferred sellers', 'seller', sellerPrefs, sellerName, sellers, pickSeller, setPickSeller)}
          {prefList('Preferred products', 'product', productPrefs, productName, products.map(l => [l.id, l.name] as [string, string]), pickProduct, setPickProduct)}
        </div>
      </SectionCard>
    </div>
  )
}
