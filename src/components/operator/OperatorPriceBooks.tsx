import { useCallback, useEffect, useMemo, useState } from 'react'
import { BookMarked } from 'lucide-react'
import { SectionCard, Btn, Table, Td, EmptyState, StatusPill, FormField, TextInput, Select, toast } from './shared'
import { Callout } from '../OnboardingJourney'
import { useMarket } from '../../lib/MarketContext'
import { loadAccountBook } from '../../lib/accountsRepo'
import { loadPriceBook } from '../../lib/moneyRepo'
import type { PriceRow } from '../../lib/moneyRepo'
import { loadEnterpriseCatalogue } from '../../lib/enterpriseRepo'
import { loadAccountPrices, loadPromotable } from '../../lib/priceBookRepo'
import { standingOf, shelfPrice, promotable } from '../../lib/accountPrices'
import type { AccountPrice, PriceStanding, QuoteLineForPromotion } from '../../lib/accountPrices'
import { priceStandingStatus } from '../../lib/consoleTone'
import { currenciesOf } from '../../lib/money'
import { day } from '../../lib/enterprise'
import type { Account } from '../../lib/accounts'
import { SetPriceDialog } from '../pricebooks/SetPriceDialog'
import type { SetPriceListing } from '../pricebooks/SetPriceDialog'
import { EndPriceDialog } from '../pricebooks/EndPriceDialog'
import { PromoteQuoteDialog } from '../pricebooks/PromoteQuoteDialog'

/* The desk's view of each business account's own prices.
 *
 * Prices are set, replaced and ended here and nowhere else; the database holds
 * every rule (guard_account_price and the three functions) and this screen says
 * them before it asks. "Charged today" is the same figure the shelf and the
 * requisition compute — least(published, greatest(account price, floor)) with
 * today's published price and floor — so when a floor has risen or a published
 * price has fallen since the price was agreed, the row says which. */

type StandingFilter = 'current' | PriceStanding | 'all'
const FILTERS: { id: StandingFilter; label: string }[] = [
  { id: 'current', label: 'In force and scheduled' },
  { id: 'in force', label: 'In force' },
  { id: 'scheduled', label: 'Scheduled' },
  { id: 'ended', label: 'Ended' },
  { id: 'withdrawn', label: 'Withdrawn' },
  { id: 'all', label: 'Every price' },
]

const todayIso = () => new Date().toISOString().slice(0, 10)

interface Loaded {
  prices: AccountPrice[]
  listings: SetPriceListing[]
  quotes: QuoteLineForPromotion[]
  books: Record<string, Map<string, PriceRow>>
  error: string | null
}

export function OperatorPriceBooks() {
  const { book, fmtIn } = useMarket()
  const fmt = (n: number, c: string) => fmtIn(n, c, { decimals: true })
  const today = todayIso()

  const [accounts, setAccounts] = useState<Account[] | null>(null)
  const [accountsError, setAccountsError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [accountId, setAccountId] = useState('')
  const [data, setData] = useState<Loaded | null>(null)
  const [standing, setStanding] = useState<StandingFilter>('current')
  const [currency, setCurrency] = useState('all')
  const [setting, setSetting] = useState(false)
  const [quote, setQuote] = useState<QuoteLineForPromotion | null>(null)
  const [promoting, setPromoting] = useState(false)
  const [ending, setEnding] = useState<AccountPrice | null>(null)

  useEffect(() => {
    let live = true
    loadAccountBook().then(b => {
      if (!live) return
      setAccounts(b.accounts)
      setAccountsError(b.loadError ?? null)
    }, e => { if (live) { setAccounts([]); setAccountsError(e instanceof Error ? e.message : 'The accounts did not load.') } })
    return () => { live = false }
  }, [])

  const account = accounts?.find(a => a.id === accountId) ?? null
  const marketCurrencies = useMemo(
    () => (account ? currenciesOf(account.market, book.accepted) : []),
    [account, book.accepted],
  )

  const reload = useCallback(async (a: Account, takes: readonly string[]) => {
    const [ap, cat, pq] = await Promise.all([
      loadAccountPrices(a.id),
      loadEnterpriseCatalogue(a.currency, a.id).catch(() => []),
      loadPromotable(a.id),
    ])
    const prices = ap.ok ? ap.value : []
    const quotes = pq.ok ? pq.value : []
    const wanted = new Set<string>([...takes, a.currency, ...prices.map(p => p.currency), ...quotes.map(q => q.currency)])
    const books: Record<string, Map<string, PriceRow>> = {}
    await Promise.all([...wanted].map(async c => { books[c] = await loadPriceBook(c).catch(() => new Map()) }))
    setData({
      prices, quotes, books,
      listings: cat.map(l => ({ id: l.id, name: l.name, seller: l.seller })),
      error: !ap.ok ? ap.error : !pq.ok ? pq.error : null,
    })
  }, [])

  useEffect(() => {
    setData(null)
    if (account) void reload(account, marketCurrencies)
  }, [account, marketCurrencies, reload])

  const matches = (accounts ?? []).filter(a =>
    !search.trim() || a.company.toLowerCase().includes(search.trim().toLowerCase()) || a.id.toLowerCase().includes(search.trim().toLowerCase()))

  const nameOf = (id: string) => data?.listings.find(l => l.id === id)
  const waiting = data ? promotable(data.quotes, data.prices, today) : []
  const currenciesOnBook = data ? [...new Set(data.prices.map(p => p.currency))].sort() : []
  const rows = (data?.prices ?? []).filter(p => {
    const s = standingOf(p, today)
    if (standing === 'current' ? !(s === 'in force' || s === 'scheduled') : standing !== 'all' && s !== standing) return false
    return currency === 'all' || p.currency === currency
  }).sort((a, b) => a.currency.localeCompare(b.currency) || (nameOf(a.product_id)?.name ?? a.product_id).localeCompare(nameOf(b.product_id)?.name ?? b.product_id) || b.starts_on.localeCompare(a.starts_on))

  const afterWrite = (said: string) => {
    toast(said)
    if (account) void reload(account, marketCurrencies)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div>
        <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 800, color: 'var(--text)' }}>Price books</h1>
        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)', marginTop: '4px', maxWidth: '84ch' }}>
          Each business account's own prices, per listing, currency and dates. An account is charged its
          price, never under the seller's floor and never over the published price. Prices are not edited:
          setting a new one ends whatever it overlaps, so every requisition raised at the old price can
          still be explained.
        </p>
      </div>

      <SectionCard title="Account" pad>
        {accountsError && <Callout tone="danger" title="The accounts did not load">{accountsError}</Callout>}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '12px' }}>
          <FormField label="Find an account" hint="By company name or account id.">
            <TextInput type="search" value={search} onChange={e => setSearch(e.target.value)} />
          </FormField>
          <FormField label="Account">
            <Select value={accountId} onChange={e => { setAccountId(e.target.value); setStanding('current'); setCurrency('all') }}>
              <option value="">{accounts === null ? 'Loading accounts…' : `Choose an account (${matches.length})`}</option>
              {matches.map(a => <option key={a.id} value={a.id}>{a.company} — {a.id}</option>)}
              {account && !matches.includes(account) && <option value={account.id}>{account.company} — {account.id}</option>}
            </Select>
          </FormField>
        </div>
      </SectionCard>

      {!account ? (
        <SectionCard title="Price book">
          <EmptyState icon={<BookMarked size={24} />} message="Choose an account to see its prices." />
        </SectionCard>
      ) : !data ? (
        <div style={{ textAlign: 'center', padding: '40px' }} aria-live="polite">
          <div className="spinner" style={{ margin: '0 auto' }} />
          <span className="sr-only">Loading {account.company}'s prices</span>
        </div>
      ) : (
        <SectionCard title={`${account.company}'s price book`}
          subtitle={`${account.market} · trades in ${marketCurrencies.join(', ') || account.currency}. Charged today uses today's published price and floor.`}
          action={
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <Btn variant="secondary" className="pb-target" onClick={() => setPromoting(true)}>
                Promote from a quote{waiting.length ? ` (${waiting.length})` : ''}
              </Btn>
              <Btn className="pb-target" onClick={() => { setQuote(null); setSetting(true) }}>Set a price</Btn>
            </div>
          }>
          {data.error && (
            <div style={{ padding: '0 16px' }}>
              <Callout tone="danger" title="Part of the book did not load">{data.error}</Callout>
            </div>
          )}
          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', padding: '12px 16px' }}>
            <FormField label="Standing">
              <Select value={standing} onChange={e => setStanding(e.target.value as StandingFilter)}>
                {FILTERS.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}
              </Select>
            </FormField>
            <FormField label="Currency">
              <Select value={currency} onChange={e => setCurrency(e.target.value)}>
                <option value="all">Every currency</option>
                {currenciesOnBook.map(c => <option key={c} value={c}>{c}</option>)}
              </Select>
            </FormField>
          </div>
          {data.prices.length === 0 ? (
            <EmptyState icon={<BookMarked size={24} />}
              message={`${account.company} has no prices of its own. It is charged the published price for everything.`} />
          ) : rows.length === 0 ? (
            <EmptyState message="No prices match these filters." />
          ) : (
            <Table headers={['Listing', 'Currency', 'Account price', 'Published · floor today', 'Charged today', 'Window', 'Source', 'Standing', '']}>
              {rows.map(p => {
                const s = standingOf(p, today)
                const listing = nameOf(p.product_id)
                const today_ = data.books[p.currency]?.get(p.product_id) ?? null
                const live = s === 'in force' || s === 'scheduled'
                const charged = today_ ? shelfPrice(today_.price, today_.floor_price, p) : null
                return (
                  <tr key={p.id}>
                    <Td style={{ maxWidth: '26ch' }}>
                      <strong style={{ fontSize: 'var(--text-sm)' }}>{listing?.name ?? p.product_id}</strong>
                      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>
                        {listing ? listing.seller : 'Not on the business shelf today'} · {p.id}
                      </div>
                    </Td>
                    <Td>{p.currency}</Td>
                    <Td right>{fmt(p.unit_price, p.currency)}</Td>
                    <Td right>
                      {today_
                        ? <>{fmt(today_.price, p.currency)}<div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>
                            floor {today_.floor_price === null ? 'none' : fmt(today_.floor_price, p.currency)}</div></>
                        : <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>No published price</span>}
                    </Td>
                    <Td right>
                      {!live ? '—' : !charged ? '—' : (
                        <>
                          {fmt(charged.price, p.currency)}
                          {charged.clamp !== 'none' && (
                            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--warning)', fontWeight: 600 }}>
                              {charged.clamp === 'floor' ? 'held at floor' : 'published is lower'}
                            </div>
                          )}
                          {s === 'scheduled' && (
                            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>at today's figures</div>
                          )}
                        </>
                      )}
                    </Td>
                    <Td style={{ fontSize: 'var(--text-xs)' }}>
                      {s === 'withdrawn'
                        ? `Withdrawn before ${day(p.starts_on)}`
                        : `${day(p.starts_on)} – ${p.ends_on ? day(p.ends_on) : 'no end'}`}
                      {p.end_reason && (
                        <div style={{ color: 'var(--text-secondary)', maxWidth: '24ch' }}>{p.end_reason}</div>
                      )}
                    </Td>
                    <Td style={{ fontSize: 'var(--text-xs)' }}>
                      {p.source === 'quote' ? `From quote ${p.quote_ref ?? ''}`.trim() : 'Negotiated'}
                    </Td>
                    <Td><StatusPill status={priceStandingStatus(s)} label={s} /></Td>
                    <Td>
                      {live && (
                        <Btn size="sm" variant="secondary" className="pb-target" onClick={() => setEnding(p)}
                          aria-label={`End ${p.id}, ${listing?.name ?? p.product_id} in ${p.currency}`}>End</Btn>
                      )}
                    </Td>
                  </tr>
                )
              })}
            </Table>
          )}
        </SectionCard>
      )}

      {account && data && (
        <>
          <SetPriceDialog open={setting} onClose={() => { setSetting(false); setQuote(null) }}
            onSaved={id => { setSetting(false); setQuote(null); afterWrite(`${id} is on ${account.company}'s price book.`) }}
            account={account} currencies={marketCurrencies.length ? marketCurrencies : [account.currency]}
            listings={data.listings} prices={data.prices} today={today} quote={quote} />
          <PromoteQuoteDialog open={promoting} onClose={() => setPromoting(false)}
            company={account.company} lines={waiting} books={data.books}
            onPick={l => { setPromoting(false); setQuote(l); setSetting(true) }} />
          <EndPriceDialog price={ending} productName={ending ? (nameOf(ending.product_id)?.name ?? ending.product_id) : ''}
            today={today} onClose={() => setEnding(null)}
            onEnded={() => { const id = ending?.id; setEnding(null); afterWrite(`${id} has been ended.`) }} />
        </>
      )}
    </div>
  )
}
