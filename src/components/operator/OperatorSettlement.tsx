import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import type { SettlementStatement } from '../../types'
import { SectionCard, Table, Td, StatusPill, EmptyState, fmtDate, Btn, Modal, FormField, TextInput, TextArea, Select, toast, ConfirmDialog } from './shared'
import { useMarket } from '../../lib/MarketContext'
import { byCurrency, formatGroups, money } from '../../lib/money'
import { payoutFor } from '../../lib/settlement'
import { Pager, usePaging } from '../Pager'

/* `focus` is a statement id handed over from the dashboard. Opening it here
   rather than making the operator find the row again is the whole point of a
   dashboard listing work: the list says what needs doing and this is where it
   gets done. */
export function OperatorSettlement({ focus = null }: { focus?: string | null } = {}) {
  const { book: moneyBook, fmtIn } = useMarket()
  /* The reporting currency, which is what every statement is computed in. */
  const bookCurrency = moneyBook.currencies.find(c => c.is_reporting)?.code ?? 'USD'
  const book = (n: number) => fmtIn(Number(n), bookCurrency)
  const [statements, setStatements] = useState<SettlementStatement[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<string>('all')
  const [detailModal, setDetailModal] = useState<SettlementStatement | null>(null)
  const [addModal, setAddModal] = useState(false)
  const [rejectModal, setRejectModal] = useState<SettlementStatement | null>(null)
  const [rejectReason, setRejectReason] = useState('')

  useEffect(() => {
    supabase.from('settlement_statements').select('*').order('sort_order').then(({ data }) => {
      if (data) setStatements(data as SettlementStatement[])
      setLoading(false)
    })
  }, [])

  /* Above the loading guard: `usePaging` is a hook, and a hook below an early
     return runs on some renders and not others. */
  const filtered = filter === 'all' ? statements : statements.filter(s => s.status === filter)
  const page = usePaging(filtered, { resetKey: filter })

  /* Once, when the id arrives — reopening it every render would make the modal
     impossible to close. */
  useEffect(() => {
    if (!focus || !statements.length) return
    const wanted = statements.find(s => s.id === focus)
    if (wanted) setDetailModal(wanted)
  }, [focus, statements])

  if (loading) return <div style={{ textAlign: 'center', padding: '40px' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>
  const pendingCount = statements.filter(s => s.status === 'pending').length
  const approvedCount = statements.filter(s => s.status === 'approved').length
  /* Two figures, because a settlement has two legs. The book total is what the
     marketplace owes, in the currency it computes in — safely added, since every
     statement is computed in that one. What is remitted is not: six of fifteen
     sellers bank in rupees, dirhams or shillings, so that side is grouped. */
  const pending = statements.filter(s => s.status === 'pending')
  const totalPending = pending.reduce((sum, s) => sum + Number(s.net), 0)
  const payableBy = byCurrency(pending.map(s => money(Number(s.payout_net), s.payout_currency)))

  const refresh = async () => {
    const { data } = await supabase.from('settlement_statements').select('*').order('sort_order')
    if (data) setStatements(data as SettlementStatement[])
  }

  const handleApprove = async (id: string) => {
    await supabase.from('settlement_statements').update({
      status: 'approved', approved_by: 'Finance Team', approved_at: new Date().toISOString(),
    }).eq('id', id)
    toast('Settlement approved')
    await refresh()
  }

  const handleReject = async () => {
    if (!rejectModal) return
    if (!rejectReason.trim()) { toast('A reason is required to reject a settlement', 'error'); return }
    await supabase.from('settlement_statements').update({
      status: 'rejected', disputed: true, approved_by: 'Finance Team', approved_at: new Date().toISOString(),
    }).eq('id', rejectModal.id)
    toast('Settlement rejected — disputed')
    setRejectReason('')
    setRejectModal(null)
    await refresh()
  }

  const handleDelete = async (id: string) => {
    await supabase.from('settlement_statements').delete().eq('id', id)
    toast('Statement deleted')
    await refresh()
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 800, color: 'var(--text)' }}>Settlement Runs</h1>
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)', marginTop: '4px' }}>
            {pendingCount} pending · {book(totalPending)} net payable, remitting {formatGroups(payableBy, fmtIn, 'nothing')} · {approvedCount} approved
          </p>
        </div>
        <Btn onClick={() => setAddModal(true)}>New statement</Btn>
      </div>

      <div style={{ display: 'flex', gap: '8px' }}>
        {[{ id: 'all', label: 'All', count: statements.length }, { id: 'pending', label: 'Pending', count: pendingCount }, { id: 'approved', label: 'Approved', count: approvedCount }].map(f => (
          <button key={f.id} onClick={() => setFilter(f.id)} style={{ padding: '8px 16px', borderRadius: 'var(--radius)', fontSize: 'var(--text-sm)', fontWeight: 600, background: filter === f.id ? 'var(--brand-navy)' : 'white', color: filter === f.id ? 'white' : 'var(--text-secondary)', border: '1px solid var(--border)', cursor: 'pointer' }}>{f.label} ({f.count})</button>
        ))}
      </div>

      <SectionCard title="Settlement Statements" subtitle="Gross-to-net deduction stack. A disputed statement cannot be approved.">
        {filtered.length === 0 ? <EmptyState message="No statements in this filter" /> : (
          <Table headers={['Partner', 'Period', 'Gross', 'Commission', 'Fees', 'Refunds', 'Net', 'Orders', 'Status', 'Actions']}>
            {page.rows.map(s => (
              <tr key={s.id}>
                <Td>{s.partner_name}{s.disputed && <span style={{ fontSize: '10px', color: 'var(--danger)', marginLeft: '4px' }}>disputed</span>}</Td>
                <Td right>{s.period}</Td>
                <Td right>{fmtIn(Number(s.gross), s.currency)}</Td>
                <Td right>-{fmtIn(Number(s.commission), s.currency)}</Td>
                <Td right>-{fmtIn(Number(s.fees), s.currency)}</Td>
                <Td right>-{fmtIn(Number(s.refunds), s.currency)}</Td>
                <Td right style={{ fontWeight: 700 }}>
                  {fmtIn(Number(s.net), s.currency)}
                  {/* What actually leaves, where the seller's account takes
                      something else. Nine of fifteen bank in dollars and see
                      nothing extra; the other six were being shown a figure
                      their bank would never receive. */}
                  {s.payout_currency !== s.currency && (
                    <div style={{ fontSize: '10px', color: 'var(--text-tertiary)', fontWeight: 500 }}>
                      pays {fmtIn(Number(s.payout_net), s.payout_currency)} at {s.fx_rate}
                    </div>
                  )}
                </Td>
                <Td right>{s.order_count}</Td>
                <Td right><StatusPill status={s.status} /></Td>
                <Td right>
                  <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
                    <Btn variant="secondary" size="sm" onClick={() => setDetailModal(s)}>View</Btn>
                    {s.status === 'pending' && <Btn variant="success" size="sm" onClick={() => handleApprove(s.id)}>Approve</Btn>}
                    {s.status === 'pending' && <Btn variant="danger" size="sm" onClick={() => setRejectModal(s)}>Reject</Btn>}
                    <Btn variant="danger" size="sm" onClick={() => handleDelete(s.id)}>Delete</Btn>
                  </div>
                </Td>
              </tr>
            ))}
          </Table>
        )}
        <Pager page={page} noun="statements" />
      </SectionCard>

      {/* Detail modal */}
      <Modal open={!!detailModal} onClose={() => setDetailModal(null)} title="Settlement Detail"
        footer={<Btn variant="secondary" size="sm" onClick={() => setDetailModal(null)}>Close</Btn>}>
        {detailModal && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <div><strong>{detailModal.partner_name}</strong> · {detailModal.period}</div>
              <StatusPill status={detailModal.status} />
            </div>
            <table style={{ width: '100%', fontSize: 'var(--text-sm)', minWidth: 'min-content' }}>
              <tbody>
                <tr><td style={{ padding: '6px 0', color: 'var(--text-tertiary)' }}>Gross sales</td><td style={{ textAlign: 'right', fontWeight: 600 }}>{fmtIn(Number(detailModal.gross), detailModal.currency)}</td></tr>
                <tr><td style={{ padding: '6px 0', color: 'var(--text-tertiary)' }}>Commission ({detailModal.commission_rate}%)</td><td style={{ textAlign: 'right', color: 'var(--danger)' }}>-{fmtIn(Number(detailModal.commission), detailModal.currency)}</td></tr>
                <tr><td style={{ padding: '6px 0', color: 'var(--text-tertiary)' }}>Platform fees</td><td style={{ textAlign: 'right', color: 'var(--danger)' }}>-{fmtIn(Number(detailModal.fees), detailModal.currency)}</td></tr>
                <tr><td style={{ padding: '6px 0', color: 'var(--text-tertiary)' }}>Withholding</td><td style={{ textAlign: 'right', color: 'var(--danger)' }}>-{fmtIn(Number(detailModal.withholding), detailModal.currency)}</td></tr>
                <tr><td style={{ padding: '6px 0', color: 'var(--text-tertiary)' }}>Refunds</td><td style={{ textAlign: 'right', color: 'var(--danger)' }}>-{fmtIn(Number(detailModal.refunds), detailModal.currency)}</td></tr>
                <tr style={{ borderTop: '2px solid var(--border)' }}><td style={{ padding: '10px 0', fontWeight: 800 }}>Net payable</td><td style={{ textAlign: 'right', fontWeight: 800, fontSize: 'var(--text-lg)' }}>{fmtIn(Number(detailModal.net), detailModal.currency)}</td></tr>
                {detailModal.payout_currency !== detailModal.currency && (
                  <tr>
                    <td style={{ padding: '10px 0', color: 'var(--text-tertiary)' }}>
                      Remitted to the seller's account
                      <div style={{ fontSize: '10px' }}>
                        at the {detailModal.fx_as_of} fix of {detailModal.fx_rate} — frozen, so a reprint
                        matches what was paid
                      </div>
                    </td>
                    <td style={{ textAlign: 'right', fontWeight: 800, fontSize: 'var(--text-lg)' }}>
                      {fmtIn(Number(detailModal.payout_net), detailModal.payout_currency)}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>{detailModal.order_count} orders · {detailModal.currency}</div>
            {detailModal.approved_by && <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>Approved by {detailModal.approved_by} on {fmtDate(detailModal.approved_at)}</div>}
          </div>
        )}
      </Modal>

      {/* Reject modal */}
      <Modal open={!!rejectModal} onClose={() => setRejectModal(null)} title="Reject Settlement"
        footer={<><Btn variant="secondary" size="sm" onClick={() => setRejectModal(null)}>Cancel</Btn><Btn variant="danger" size="sm" onClick={handleReject}>Reject & dispute</Btn></>}>
        <FormField label="Reason for rejection" required>
          <TextArea value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} placeholder="e.g. Commission rate does not match contract schedule..." />
        </FormField>
      </Modal>

      {/* Add modal */}
      {addModal && <StatementModal open={addModal} onClose={() => setAddModal(false)} onSave={async (s) => {
        const id = `ss-${Date.now()}`
        const sortOrder = statements.length > 0 ? Math.max(...statements.map(x => x.sort_order)) + 1 : 0
        await supabase.from('settlement_statements').insert({ ...s, id, sort_order: sortOrder, status: 'pending', submitted_at: new Date().toISOString() })
        toast('Statement created')
        setAddModal(false)
        await refresh()
      }} />}
    </div>
  )
}

function StatementModal({ open, onClose, onSave }: { open: boolean; onClose: () => void; onSave: (s: SettlementStatement) => void }) {
  const { book: moneyBook, fmtIn } = useMarket()
  const bookCurrency = moneyBook.currencies.find(c => c.is_reporting)?.code ?? 'USD'
  /* Which seller, so the payout account can be looked up rather than typed. A
     statement created by hand has to freeze exactly what a computed one does —
     otherwise the one route into this table that a person controls is the one
     route that produces rows nothing downstream can reconcile. */
  const [banks, setBanks] = useState<{ partner_id: string; partner_name: string; currency: string }[]>([])
  useEffect(() => {
    void (async () => {
      const { data } = await supabase
        .from('partner_bank').select('partner_id, currency, partner:partners(name)')
      /* PostgREST types an embedded one-to-one as an array. Read as one and
         normalised here rather than asserted away, because the shape is real. */
      setBanks(((data ?? []) as unknown as { partner_id: string; currency: string; partner: { name: string } | { name: string }[] | null }[])
        .map(r => {
          const p = Array.isArray(r.partner) ? r.partner[0] : r.partner
          return { partner_id: r.partner_id, partner_name: p?.name ?? r.partner_id, currency: r.currency }
        })
        .sort((a, b) => a.partner_name.localeCompare(b.partner_name)))
    })()
  }, [])

  const [form, setForm] = useState({
    partner_id: '', partner_name: '', period: '', gross: 0, commission: 0, commission_rate: 9.3, fees: 0, withholding: 0, refunds: 0, net: 0, order_count: 0, currency: bookCurrency,
  })

  const account = banks.find(b => b.partner_id === form.partner_id) ?? null
  /* Worked out as the operator types, so a period with no rate on file is a
     refusal they can see rather than a row that fails to save. */
  const payout = account && form.period
    ? payoutFor({
        net: form.net, from: form.currency, to: account.currency,
        period: form.period, rates: moneyBook.rates, currencies: moneyBook.currencies,
      })
    : null

  useEffect(() => {
    const net = form.gross - form.commission - form.fees - form.withholding - form.refunds
    setForm(f => ({ ...f, net }))
  }, [form.gross, form.commission, form.fees, form.withholding, form.refunds])

  const handleSave = () => {
    if (!form.partner_id) { toast('Choose the seller — the payout account decides what they are paid in', 'error'); return }
    if (form.gross <= 0) { toast('Gross must be greater than zero', 'error'); return }
    if (!payout) { toast('A period is required, so the statement can be converted at the right fix', 'error'); return }
    if (!payout.ok) { toast(payout.reason, 'error'); return }
    onSave({
      ...form, id: '',
      payout_currency: payout.payout.currency,
      payout_net: payout.payout.net,
      fx_rate: payout.payout.rate,
      fx_as_of: payout.payout.asOf,
      status: 'pending', submitted_at: new Date().toISOString(),
      approved_by: null, approved_at: null, disputed: false, sort_order: 0,
    })
  }

  return (
    <Modal open={open} onClose={onClose} title="New Settlement Statement"
      footer={<><Btn variant="secondary" size="sm" onClick={onClose}>Cancel</Btn><Btn size="sm" onClick={handleSave}>Create</Btn></>}>
      <FormField label="Seller" required hint="Their payout account decides what the net is remitted in.">
        <Select value={form.partner_id} onChange={(e) => {
          const b = banks.find(x => x.partner_id === e.target.value)
          setForm({ ...form, partner_id: e.target.value, partner_name: b?.partner_name ?? '' })
        }}>
          <option value="">Choose a seller…</option>
          {banks.map(b => (
            <option key={b.partner_id} value={b.partner_id}>{b.partner_name} — paid in {b.currency}</option>
          ))}
        </Select>
      </FormField>
      <div style={{ display: 'flex', gap: '12px' }}>
        <div style={{ flex: 1 }}><FormField label="Period" required><TextInput value={form.period} onChange={(e) => setForm({ ...form, period: e.target.value })} placeholder="e.g. Aug 2026" /></FormField></div>
        <div style={{ flex: 1 }}><FormField label="Order count"><TextInput type="number" value={form.order_count} onChange={(e) => setForm({ ...form, order_count: parseInt(e.target.value) || 0 })} /></FormField></div>
      </div>
      <div style={{ display: 'flex', gap: '12px' }}>
        <div style={{ flex: 1 }}><FormField label="Gross" required><TextInput type="number" step="0.01" value={form.gross} onChange={(e) => setForm({ ...form, gross: parseFloat(e.target.value) || 0 })} /></FormField></div>
        <div style={{ flex: 1 }}><FormField label="Commission"><TextInput type="number" step="0.01" value={form.commission} onChange={(e) => setForm({ ...form, commission: parseFloat(e.target.value) || 0 })} /></FormField></div>
      </div>
      <div style={{ display: 'flex', gap: '12px' }}>
        <div style={{ flex: 1 }}><FormField label="Fees"><TextInput type="number" step="0.01" value={form.fees} onChange={(e) => setForm({ ...form, fees: parseFloat(e.target.value) || 0 })} /></FormField></div>
        <div style={{ flex: 1 }}><FormField label="Withholding"><TextInput type="number" step="0.01" value={form.withholding} onChange={(e) => setForm({ ...form, withholding: parseFloat(e.target.value) || 0 })} /></FormField></div>
      </div>
      <div style={{ display: 'flex', gap: '12px' }}>
        <div style={{ flex: 1 }}><FormField label="Refunds"><TextInput type="number" step="0.01" value={form.refunds} onChange={(e) => setForm({ ...form, refunds: parseFloat(e.target.value) || 0 })} /></FormField></div>
        <div style={{ flex: 1 }}><FormField label="Net (calculated)"><TextInput value={form.net} readOnly style={{ background: 'var(--bg-alt)', fontWeight: 700 }} /></FormField></div>
      </div>

      {/* What will actually leave, shown before it is committed. An operator who
          only sees the book figure has no way to tell that a seller banking in
          Bengaluru is about to be sent a number their bank cannot receive. */}
      {payout && (payout.ok ? (
        payout.payout.currency === form.currency ? (
          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginTop: '6px' }}>
            {account?.partner_name} banks in {form.currency}, so {fmtIn(form.net, form.currency)} is remitted as it stands.
          </div>
        ) : (
          <div style={{
            marginTop: '8px', padding: '10px 12px', borderRadius: 'var(--radius)',
            background: 'var(--info-bg)', fontSize: 'var(--text-xs)', lineHeight: 1.6,
          }}>
            <strong>Remits {fmtIn(payout.payout.net, payout.payout.currency)}</strong> to {account?.partner_name}'s
            account, at the {payout.payout.asOf} fix of {payout.payout.rate}. The rate is frozen on the
            statement, so a reprint next year matches what was paid rather than what today's fix would give.
          </div>
        )
      ) : (
        <div style={{
          marginTop: '8px', padding: '10px 12px', borderRadius: 'var(--radius)',
          background: 'var(--danger-bg)', color: 'var(--danger)', fontSize: 'var(--text-xs)', lineHeight: 1.6,
        }}>
          {payout.reason}
        </div>
      ))}
    </Modal>
  )
}
