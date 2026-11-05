/* The list of enquiries, shared by the buyer's, the seller's and the operator's
 * consoles. It only shows and filters; what counts as "waiting on you" is
 * decided in lib/enquiryList.ts so the three agree.
 *
 * The chips are a radio group (arrow keys move between them), as on Business
 * Accounts. `extraFilters` is where the operator's own filters go.
 */
import type React from 'react'
import { Search } from 'lucide-react'
import { SectionCard, Table, Td, StatusPill, EmptyState, Select, fmtDate, fmtInt } from '../operator/shared'
import { enquiryState } from '../../lib/enquiries'
import type { Enquiry, Role } from '../../lib/enquiries'
import { CHIPS, TYPE_LABEL, chipCounts, filterEnquiries } from '../../lib/enquiryList'
import type { Chip, TypeFilter } from '../../lib/enquiryList'

export interface EnquiryListProps {
  enquiries: readonly Enquiry[]
  role: Role
  today: string
  chip: Chip
  onChip: (c: Chip) => void
  type: TypeFilter
  onType: (t: TypeFilter) => void
  query: string
  onQuery: (q: string) => void
  onOpen: (id: string) => void
  /** The row that is open, if any. */
  openId?: string | null
  /** Who answers each enquiry, in words. Also searched. */
  answerer: (e: Enquiry) => string
  title?: string
  subtitle?: string
  /** Further filters (the operator's), shown beside the type filter. */
  extraFilters?: React.ReactNode
  /** Applied after the chip/type/search cut (the operator's own filters). */
  extraFilter?: (e: Enquiry) => boolean
}

export function EnquiryList({
  enquiries, role, today, chip, onChip, type, onType, query, onQuery, onOpen, openId,
  answerer, title = 'Enquiries', subtitle, extraFilters, extraFilter,
}: EnquiryListProps) {
  const counts = chipCounts(enquiries, role, today)
  const rows = filterEnquiries(enquiries, { chip, type, query }, role, today, answerer)
    .filter(e => !extraFilter || extraFilter(e))

  const onChipKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const dir = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1
      : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0
    if (!dir) return
    e.preventDefault()
    const i = CHIPS.findIndex(c => c.id === chip)
    const next = CHIPS[(i + dir + CHIPS.length) % CHIPS.length].id
    onChip(next)
    e.currentTarget.querySelector<HTMLButtonElement>(`[data-chip="${next}"]`)?.focus()
  }

  return (
    <div className="enq-list">
      <div className="enq-filters">
        <div className="acct-chips enq-chips" role="radiogroup" aria-label="Filter by who it is waiting on" onKeyDown={onChipKey}>
          {CHIPS.map(c => (
            <button key={c.id} type="button" role="radio" data-chip={c.id}
              aria-checked={chip === c.id} tabIndex={chip === c.id ? 0 : -1}
              className="acct-chip" onClick={() => onChip(c.id)}>
              {c.label} <span className="acct-chip__n">{fmtInt(counts[c.id])}</span>
            </button>
          ))}
        </div>
        <div className="enq-filters__row">
          <label className="enq-filter">
            <span className="enq-filter__label">Type</span>
            <Select value={type} onChange={e => onType(e.target.value as TypeFilter)}>
              <option value="all">Every type</option>
              <option value="quote">Quotes</option>
              <option value="demo">Demos</option>
              <option value="sales">Sales</option>
            </Select>
          </label>
          {extraFilters}
          <label className="enq-filter enq-filter--grow">
            <span className="enq-filter__label">Search</span>
            <span className="enq-search">
              <Search size={14} aria-hidden="true" className="enq-search__icon" />
              <input className="c-input enq-search__input" type="search" value={query}
                onChange={e => onQuery(e.target.value)} placeholder="Subject, reference, who answers…" />
            </span>
          </label>
        </div>
      </div>

      <SectionCard title={title} subtitle={subtitle ?? 'Whatever is waiting on you comes first. Open a row to read it and act on it.'}>
        {rows.length === 0 ? (
          <EmptyState message={enquiries.length === 0 ? 'Nothing has been asked yet.' : 'Nothing matches these filters.'} />
        ) : (
          <Table headers={['Enquiry', 'Subject', 'Answered by', 'Last update', 'Status']}>
            {rows.map(e => {
              const state = enquiryState(e, today)
              const isOpen = openId === e.id
              return (
                <tr key={e.id} className={`enq-row${isOpen ? ' is-open' : ''}`}>
                  <Td>
                    <button type="button" className="enq-row__open" onClick={() => onOpen(e.id)}
                      aria-expanded={isOpen} aria-label={`Open ${TYPE_LABEL[e.type].toLowerCase()} enquiry ${e.id}: ${e.subject}`}>
                      <span className="enq-row__type">{TYPE_LABEL[e.type]}</span>
                      <span className="enq-row__id">{e.id}</span>
                    </button>
                  </Td>
                  <Td>{e.subject}</Td>
                  <Td>{answerer(e)}</Td>
                  <Td>{fmtDate(e.updated_at)}</Td>
                  <Td><StatusPill status={state} /></Td>
                </tr>
              )
            })}
          </Table>
        )}
      </SectionCard>
    </div>
  )
}
