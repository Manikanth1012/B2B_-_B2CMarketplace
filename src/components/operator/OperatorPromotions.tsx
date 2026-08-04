import { useState, useEffect } from 'react'
import { Pager, usePaging } from '../Pager'
import { supabase } from '../../lib/supabase'
import type { OperatorPromotion } from '../../types'
import { SectionCard, Table, Td, StatusPill, EmptyState, fmtDate, Btn, Modal, FormField, TextInput, Select, TextArea, toast, ConfirmDialog } from './shared'
import { useMarket } from '../../lib/MarketContext'
import { byCurrency, formatGroups, money } from '../../lib/money'

export function OperatorPromotions() {
  const { fmtIn } = useMarket()
  const [promos, setPromos] = useState<OperatorPromotion[]>([])
  const [loading, setLoading] = useState(true)
  const [editModal, setEditModal] = useState<OperatorPromotion | null>(null)
  const [addModal, setAddModal] = useState(false)

  useEffect(() => {
    supabase.from('operator_promotions').select('*').order('sort_order').then(({ data }) => {
      if (data) setPromos(data as OperatorPromotion[])
      setLoading(false)
    })
  }, [])

  /* Above the loading guard: `usePaging` is a hook, and a hook after an
     early return runs on some renders and not others. */
  const page = usePaging(promos)

  if (loading) return <div style={{ textAlign: 'center', padding: '40px' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>

  const activeCount = promos.filter(p => p.status === 'active').length
  const pausedCount = promos.filter(p => p.status === 'paused').length
  /* A promotion is an offer to a customer, so it is denominated where the
     customer is. Grouped rather than added, for the same reason as everywhere
     else: the day a second market runs its own campaign, one total over the two
     is a number in no currency. */
  const budgetBy = byCurrency(promos.map(p => money(Number(p.budget), p.currency)))
  const spentBy = byCurrency(promos.map(p => money(Number(p.spent), p.currency)))

  const refresh = async () => {
    const { data } = await supabase.from('operator_promotions').select('*').order('sort_order')
    if (data) setPromos(data as OperatorPromotion[])
  }

  const handleToggle = async (p: OperatorPromotion) => {
    const newStatus = p.status === 'active' ? 'paused' : 'active'
    await supabase.from('operator_promotions').update({ status: newStatus }).eq('id', p.id)
    toast(`Promotion ${newStatus === 'active' ? 'resumed' : 'paused'}`)
    await refresh()
  }

  const handleDelete = async (id: string) => {
    await supabase.from('operator_promotions').delete().eq('id', id)
    toast('Promotion deleted')
    await refresh()
  }

  const handleSave = async (p: OperatorPromotion) => {
    if (p.id) {
      await supabase.from('operator_promotions').update(p).eq('id', p.id)
      toast('Promotion updated')
    } else {
      const id = `promo-${Date.now()}`
      const sortOrder = promos.length > 0 ? Math.max(...promos.map(x => x.sort_order)) + 1 : 0
      await supabase.from('operator_promotions').insert({ ...p, id, sort_order: sortOrder, status: 'active', spent: 0 })
      toast('Promotion created')
    }
    await refresh()
    setEditModal(null)
    setAddModal(false)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 800, color: 'var(--text)' }}>Promotions</h1>
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)', marginTop: '4px' }}>
            {activeCount} active · {pausedCount} paused · {formatGroups(spentBy, fmtIn, 'nothing')} of {formatGroups(budgetBy, fmtIn, 'nothing')} budget used
          </p>
        </div>
        <Btn onClick={() => setAddModal(true)}>New promotion</Btn>
      </div>

      <SectionCard title="Conditional Discount Rules" subtitle="Conditions + effect + budget. Cost floor enforced in the pricing engine.">
        {promos.length === 0 ? <EmptyState message="No promotions configured" /> : (
          <><Table headers={['Name', 'Description', 'Effect', 'Value', 'Stacking', 'Priority', 'Budget', 'Spent', 'Status', 'Actions']}>
            {page.rows.map(p => {
              const pct = p.budget > 0 ? (p.spent / p.budget * 100).toFixed(0) : '0'
              return (
                <tr key={p.id}>
                  <Td>{p.name}</Td>
                  <Td>{p.description}</Td>
                  <Td right>{p.effect_type}</Td>
                  <Td right>{p.effect_type === 'percentage' ? `${p.effect_value}%` : p.effect_type === 'fixed' ? fmtIn(Number(p.effect_value), p.currency) : `${p.effect_value} mo`}</Td>
                  <Td right>{p.stacking ? 'Yes' : 'No'}</Td>
                  <Td right>{p.priority}</Td>
                  <Td right>{fmtIn(Number(p.budget), p.currency)}</Td>
                  <Td right style={{ color: Number(pct) > 80 ? 'var(--danger)' : Number(pct) > 50 ? 'var(--warning)' : 'var(--success)' }}>{fmtIn(Number(p.spent), p.currency)} ({pct}%)</Td>
                  <Td right><StatusPill status={p.status} /></Td>
                  <Td right>
                    <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
                      <Btn variant="secondary" size="sm" onClick={() => setEditModal(p)}>Edit</Btn>
                      <Btn variant="secondary" size="sm" onClick={() => handleToggle(p)}>{p.status === 'active' ? 'Pause' : 'Resume'}</Btn>
                      <Btn variant="danger" size="sm" onClick={() => handleDelete(p.id)}>Delete</Btn>
                    </div>
                  </Td>
                </tr>
              )
            })}
          </Table>
          <div style={{ padding: '0 18px 12px' }}><Pager page={page} noun="promotions" /></div></>
        )}
      </SectionCard>

      {(editModal || addModal) && <PromoModal promo={editModal} onClose={() => { setEditModal(null); setAddModal(false) }} onSave={handleSave} />}
    </div>
  )
}

function PromoModal({ promo, onClose, onSave }: { promo: OperatorPromotion | null; onClose: () => void; onSave: (p: OperatorPromotion) => void }) {
  const { book: moneyBook } = useMarket()
  /* A new promotion is offered where the customers are, so it defaults to the
     default market's currency rather than to the marketplace's reporting one.
     A budget of 1000 was a dollar figure; the equivalent in rupees is not 1000,
     and neither is it 87,420 — it is a round number somebody would sign off. */
  const homeCurrency = moneyBook.markets.find(m => m.is_default)?.currency
    ?? moneyBook.currencies.find(c => c.is_reporting)?.code ?? 'USD'
  const [form, setForm] = useState<OperatorPromotion>(promo || {
    id: '', name: '', description: '', effect_type: 'percentage', effect_value: 10, conditions: {}, stacking: false, priority: 50, budget: 100000, spent: 0, currency: homeCurrency, status: 'active', starts_at: null, ends_at: null, sort_order: 0,
  })
  useEffect(() => { if (promo) setForm(promo) }, [promo])

  const handleSave = () => {
    if (!form.name.trim()) { toast('Name is required', 'error'); return }
    if (form.budget <= 0) { toast('Budget must be greater than zero', 'error'); return }
    onSave(form)
  }

  return (
    <Modal open onClose={onClose} title={promo ? 'Edit Promotion' : 'New Promotion'}
      footer={<><Btn variant="secondary" size="sm" onClick={onClose}>Cancel</Btn><Btn size="sm" onClick={handleSave}>Save</Btn></>}>
      <FormField label="Name" required><TextInput value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></FormField>
      <FormField label="Description"><TextInput value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></FormField>
      <div style={{ display: 'flex', gap: '12px' }}>
        <div style={{ flex: 1 }}><FormField label="Effect type"><Select value={form.effect_type} onChange={(e) => setForm({ ...form, effect_type: e.target.value })}><option value="percentage">Percentage off</option><option value="fixed">Fixed amount off</option><option value="free_months">Free months</option><option value="free_delivery">Free delivery</option></Select></FormField></div>
        <div style={{ flex: 1 }}><FormField label="Effect value"><TextInput type="number" step="0.01" value={form.effect_value} onChange={(e) => setForm({ ...form, effect_value: parseFloat(e.target.value) || 0 })} /></FormField></div>
      </div>
      <div style={{ display: 'flex', gap: '12px' }}>
        <div style={{ flex: 1 }}><FormField label="Priority (lower runs first)"><TextInput type="number" value={form.priority} onChange={(e) => setForm({ ...form, priority: parseInt(e.target.value) || 50 })} /></FormField></div>
        <div style={{ flex: 1 }}>
          <FormField label="Currency" hint="What the discount, the minimum basket and the budget are all in.">
            <Select value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })}>
              {moneyBook.currencies.map(c => <option key={c.code} value={c.code}>{c.code} — {c.name}</option>)}
            </Select>
          </FormField>
        </div>
        <div style={{ flex: 1 }}><FormField label="Budget"><TextInput type="number" step="0.01" value={form.budget} onChange={(e) => setForm({ ...form, budget: parseFloat(e.target.value) || 0 })} /></FormField></div>
      </div>
      <div style={{ display: 'flex', gap: '12px' }}>
        <div style={{ flex: 1 }}><FormField label="Start date"><TextInput type="date" value={form.starts_at?.slice(0, 10) || ''} onChange={(e) => setForm({ ...form, starts_at: e.target.value ? new Date(e.target.value).toISOString() : null })} /></FormField></div>
        <div style={{ flex: 1 }}><FormField label="End date"><TextInput type="date" value={form.ends_at?.slice(0, 10) || ''} onChange={(e) => setForm({ ...form, ends_at: e.target.value ? new Date(e.target.value).toISOString() : null })} /></FormField></div>
      </div>
      <FormField label="Stacking (adds on top of the winning non-stacking rule)">
        <Select value={form.stacking ? 'yes' : 'no'} onChange={(e) => setForm({ ...form, stacking: e.target.value === 'yes' })}><option value="no">No — competes, largest wins</option><option value="yes">Yes — stacks on top</option></Select>
      </FormField>
    </Modal>
  )
}
