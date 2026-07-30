import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import type { OperatorInventory, OperatorWarehouse, Product } from '../../types'
import { demandByProduct, type Watch } from '../../lib/stockWatch'
import { SectionCard, Table, Td, StatusPill, EmptyState, fmtMoney, fmtInt, fmtDate, Btn, Modal, FormField, TextInput, Select, toast, ConfirmDialog } from './shared'

export function OperatorInventory() {
  const [inventory, setInventory] = useState<OperatorInventory[]>([])
  const [warehouses, setWarehouses] = useState<OperatorWarehouse[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'stock' | 'warehouses'>('stock')
  const [editModal, setEditModal] = useState<OperatorInventory | null>(null)
  const [addModal, setAddModal] = useState(false)
  const [whModal, setWhModal] = useState<OperatorWarehouse | null>(null)
  const [whAddModal, setWhAddModal] = useState(false)
  /* Who is waiting for what. Sourced from stock_watch joined to `products` rather
     than to operator_inventory, which carries product_name as free text and has no
     key back to the catalogue. */
  const [demand, setDemand] = useState<{ product: Product; waiting: number }[]>([])

  useEffect(() => {
    Promise.all([
      supabase.from('operator_inventory').select('*').order('sort_order'),
      supabase.from('operator_warehouses').select('*').order('sort_order'),
    ]).then(([inv, wh]) => {
      if (inv.data) setInventory(inv.data as OperatorInventory[])
      if (wh.data) setWarehouses(wh.data as OperatorWarehouse[])
      setLoading(false)
    })

    supabase.from('stock_watch').select('*').then(async ({ data }) => {
      const counts = demandByProduct((data ?? []) as Watch[])
      if (counts.length === 0) return
      const { data: prods } = await supabase.from('products').select('*')
        .in('id', counts.map(c => c.productId))
      const byId = Object.fromEntries(((prods ?? []) as Product[]).map(p => [p.id, p]))
      setDemand(counts.filter(c => byId[c.productId]).map(c => ({ product: byId[c.productId], waiting: c.waiting })))
    })
  }, [])

  if (loading) return <div style={{ textAlign: 'center', padding: '40px' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>

  const refreshInv = async () => {
    const { data } = await supabase.from('operator_inventory').select('*').order('sort_order')
    if (data) setInventory(data as OperatorInventory[])
  }
  const refreshWh = async () => {
    const { data } = await supabase.from('operator_warehouses').select('*').order('sort_order')
    if (data) setWarehouses(data as OperatorWarehouse[])
  }

  const handleDeleteInv = async (id: string) => {
    await supabase.from('operator_inventory').delete().eq('id', id)
    toast('Stock line deleted')
    await refreshInv()
  }
  const handleDeleteWh = async (id: string) => {
    await supabase.from('operator_warehouses').delete().eq('id', id)
    toast('Warehouse deleted')
    await refreshWh()
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 800, color: 'var(--text)' }}>Inventory & WMS</h1>
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)', marginTop: '4px' }}>{inventory.length} stock lines · {warehouses.length} warehouses</p>
        </div>
        <Btn onClick={() => tab === 'stock' ? setAddModal(true) : setWhAddModal(true)}>{tab === 'stock' ? 'Add stock line' : 'Add warehouse'}</Btn>
      </div>

      <div style={{ display: 'flex', gap: '8px' }}>
        {[{ id: 'stock' as const, label: 'Stock Ledger' }, { id: 'warehouses' as const, label: 'Warehouses' }].map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{ padding: '8px 16px', borderRadius: 'var(--radius)', fontSize: 'var(--text-sm)', fontWeight: 600, background: tab === t.id ? 'var(--brand-navy)' : 'white', color: tab === t.id ? 'white' : 'var(--text-secondary)', border: '1px solid var(--border)', cursor: 'pointer' }}>{t.label}</button>
        ))}
      </div>

      {/* Demand the ledger cannot show: shoppers who tried to buy something that was
          not there and asked to be told. A line nobody is waiting for and a line
          twelve people are waiting for should not look the same when deciding what
          to reorder. */}
      {tab === 'stock' && demand.length > 0 && (
        <SectionCard title="Waiting for stock" subtitle="Shoppers who asked to be told when these come back">
          <Table headers={['Product', 'Seller', 'Stock', 'Waiting']}>
            {demand.map(d => (
              <tr key={d.product.id}>
                <Td>{d.product.name}</Td>
                <Td>{d.product.seller}</Td>
                {/* StatusPill's vocabulary is approval states — reusing it here
                    labelled an out-of-stock product "rejected". Stock has its own
                    words. */}
                <Td>
                  <span style={{
                    padding: '2px 10px', borderRadius: '999px', fontSize: 'var(--text-xs)', fontWeight: 700,
                    background: d.product.stock === 'out' ? '#FEE2E2' : d.product.stock === 'low' ? '#FEF3C7' : '#DCFCE7',
                    color: d.product.stock === 'out' ? '#B91C1C' : d.product.stock === 'low' ? '#92400E' : '#15803D',
                  }}>
                    {d.product.stock === 'out' ? 'Out of stock' : d.product.stock === 'low' ? 'Low stock' : 'In stock'}
                  </span>
                </Td>
                <Td right style={{ fontWeight: 700 }}>{fmtInt(d.waiting)}</Td>
              </tr>
            ))}
          </Table>
        </SectionCard>
      )}

      {tab === 'stock' && (
        <SectionCard title="Stock Ledger" subtitle="On hand · Reserved · Available = on hand − reserved">
          {inventory.length === 0 ? <EmptyState message="No inventory records" /> : (
            <Table headers={['Product', 'Partner', 'Warehouse', 'On Hand', 'Reserved', 'Available', 'Reorder', 'Inbound', 'Unit Cost', 'Actions']}>
              {inventory.map(i => (
                <tr key={i.id}>
                  <Td>{i.product_name}</Td>
                  <Td>{i.partner_name}</Td>
                  <Td>{i.warehouse}</Td>
                  <Td right>{fmtInt(i.on_hand)}</Td>
                  <Td right>{fmtInt(i.reserved)}</Td>
                  <Td right style={{ fontWeight: 700, color: i.available === 0 ? 'var(--danger)' : i.available < i.reorder_point ? 'var(--warning)' : 'var(--success)' }}>{fmtInt(i.available)}</Td>
                  <Td right>{fmtInt(i.reorder_point)}</Td>
                  <Td right>{i.inbound > 0 ? `${fmtInt(i.inbound)} (${fmtDate(i.inbound_due)})` : '—'}</Td>
                  <Td right>${fmtMoney(i.unit_cost)}</Td>
                  <Td right>
                    <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
                      <Btn variant="secondary" size="sm" onClick={() => setEditModal(i)}>Edit</Btn>
                      <Btn variant="danger" size="sm" onClick={() => handleDeleteInv(i.id)}>Delete</Btn>
                    </div>
                  </Td>
                </tr>
              ))}
            </Table>
          )}
        </SectionCard>
      )}

      {tab === 'warehouses' && (
        <SectionCard title="Warehouse Configuration" subtitle="Type · Address · Capacity · System link">
          {warehouses.length === 0 ? <EmptyState message="No warehouses configured" /> : (
            <Table headers={['Name', 'Type', 'Address', 'Capacity', 'Utilisation', 'Categories', 'System', 'Sync', 'State', 'Actions']}>
              {warehouses.map(w => (
                <tr key={w.id}>
                  <Td>{w.name}</Td>
                  <Td>{w.type}</Td>
                  <Td>{w.address}</Td>
                  <Td right>{fmtInt(w.capacity)}</Td>
                  <Td right style={{ color: w.utilisation / w.capacity > 0.8 ? 'var(--warning)' : 'var(--text)' }}>{fmtInt(w.utilisation)} ({(w.utilisation / w.capacity * 100).toFixed(0)}%)</Td>
                  <Td>{w.categories.join(', ')}</Td>
                  <Td>{w.system_name || '—'}</Td>
                  <Td right>{w.sync_mode}</Td>
                  <Td right><StatusPill status={w.sync_state} /></Td>
                  <Td right>
                    <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
                      <Btn variant="secondary" size="sm" onClick={() => setWhModal(w)}>Edit</Btn>
                      <Btn variant="danger" size="sm" onClick={() => handleDeleteWh(w.id)}>Delete</Btn>
                    </div>
                  </Td>
                </tr>
              ))}
            </Table>
          )}
        </SectionCard>
      )}

      {/* Inventory edit/add modal */}
      {editModal && <InvModal item={editModal} onClose={() => setEditModal(null)} onSave={async (item) => {
        await supabase.from('operator_inventory').update(item).eq('id', item.id)
        toast('Stock line updated')
        setEditModal(null)
        await refreshInv()
      }} />}
      {addModal && <InvModal open={addModal} onClose={() => setAddModal(false)} onSave={async (item) => {
        const id = `inv-${Date.now()}`
        const sortOrder = inventory.length > 0 ? Math.max(...inventory.map(i => i.sort_order)) + 1 : 0
        await supabase.from('operator_inventory').insert({ ...item, id, sort_order: sortOrder })
        toast('Stock line created')
        setAddModal(false)
        await refreshInv()
      }} />}

      {/* Warehouse edit/add modal */}
      {whModal && <WhModal wh={whModal} onClose={() => setWhModal(null)} onSave={async (w) => {
        await supabase.from('operator_warehouses').update(w).eq('id', w.id)
        toast('Warehouse updated')
        setWhModal(null)
        await refreshWh()
      }} />}
      {whAddModal && <WhModal open={whAddModal} onClose={() => setWhAddModal(false)} onSave={async (w) => {
        const id = `wh-${Date.now()}`
        const sortOrder = warehouses.length > 0 ? Math.max(...warehouses.map(x => x.sort_order)) + 1 : 0
        await supabase.from('operator_warehouses').insert({ ...w, id, sort_order: sortOrder })
        toast('Warehouse created')
        setWhAddModal(false)
        await refreshWh()
      }} />}
    </div>
  )
}

function InvModal({ item, open, onClose, onSave }: { item?: OperatorInventory; open?: boolean; onClose: () => void; onSave: (item: OperatorInventory) => void }) {
  const [form, setForm] = useState<OperatorInventory>(item || {
    id: '', product_name: '', partner_name: '', warehouse: 'Mumbai East',
    on_hand: 0, reserved: 0, available: 0, reorder_point: 10, inbound: 0, inbound_due: null,
    unit_cost: 0, last_count: new Date().toISOString().slice(0, 10), category: 'Device', sort_order: 0,
  })
  useEffect(() => {
    if (item) setForm(item)
  }, [item])
  useEffect(() => {
    setForm(f => ({ ...f, available: f.on_hand - f.reserved }))
  }, [form.on_hand, form.reserved])

  const handleSave = () => {
    if (!form.product_name.trim()) { toast('Product name is required', 'error'); return }
    if (form.on_hand < form.reserved) { toast('On hand cannot be less than reserved', 'error'); return }
    onSave(form)
  }

  return (
    <Modal open={open ?? true} onClose={onClose} title={item ? 'Edit Stock Line' : 'New Stock Line'}
      footer={<><Btn variant="secondary" size="sm" onClick={onClose}>Cancel</Btn><Btn size="sm" onClick={handleSave}>Save</Btn></>}>
      <FormField label="Product name" required><TextInput value={form.product_name} onChange={(e) => setForm({ ...form, product_name: e.target.value })} /></FormField>
      <FormField label="Partner name" required><TextInput value={form.partner_name} onChange={(e) => setForm({ ...form, partner_name: e.target.value })} /></FormField>
      <div style={{ display: 'flex', gap: '12px' }}>
        <div style={{ flex: 1 }}><FormField label="Warehouse"><Select value={form.warehouse} onChange={(e) => setForm({ ...form, warehouse: e.target.value })}><option>Mumbai East</option><option>Dubai South</option><option>Nairobi Hub</option><option>Digital (virtual)</option></Select></FormField></div>
        <div style={{ flex: 1 }}><FormField label="Category"><Select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}><option>Device</option><option>Consumer</option><option>IoT</option><option>Security</option><option>Digital Content</option></Select></FormField></div>
      </div>
      <div style={{ display: 'flex', gap: '12px' }}>
        <div style={{ flex: 1 }}><FormField label="On hand" required><TextInput type="number" value={form.on_hand} onChange={(e) => setForm({ ...form, on_hand: parseInt(e.target.value) || 0 })} /></FormField></div>
        <div style={{ flex: 1 }}><FormField label="Reserved"><TextInput type="number" value={form.reserved} onChange={(e) => setForm({ ...form, reserved: parseInt(e.target.value) || 0 })} /></FormField></div>
        <div style={{ flex: 1 }}><FormField label="Available (calculated)"><TextInput value={form.available} readOnly style={{ background: 'var(--bg-alt)', fontWeight: 700 }} /></FormField></div>
      </div>
      <div style={{ display: 'flex', gap: '12px' }}>
        <div style={{ flex: 1 }}><FormField label="Reorder point"><TextInput type="number" value={form.reorder_point} onChange={(e) => setForm({ ...form, reorder_point: parseInt(e.target.value) || 0 })} /></FormField></div>
        <div style={{ flex: 1 }}><FormField label="Inbound qty"><TextInput type="number" value={form.inbound} onChange={(e) => setForm({ ...form, inbound: parseInt(e.target.value) || 0 })} /></FormField></div>
        <div style={{ flex: 1 }}><FormField label="Unit cost"><TextInput type="number" step="0.01" value={form.unit_cost} onChange={(e) => setForm({ ...form, unit_cost: parseFloat(e.target.value) || 0 })} /></FormField></div>
      </div>
    </Modal>
  )
}

function WhModal({ wh, open, onClose, onSave }: { wh?: OperatorWarehouse; open?: boolean; onClose: () => void; onSave: (w: OperatorWarehouse) => void }) {
  const [form, setForm] = useState<OperatorWarehouse>(wh || {
    id: '', name: '', type: 'fulfilment', address: '', timezone: 'UTC', despatch_cutoff: '16:00',
    capacity: 5000, utilisation: 0, categories: [], countries: [], system_name: '', sync_mode: 'real-time',
    sync_state: 'healthy', last_sync: new Date().toISOString(), tax_reg: '', sort_order: 0,
  })
  const [catInput, setCatInput] = useState('')
  const [countryInput, setCountryInput] = useState('')
  useEffect(() => { if (wh) setForm(wh) }, [wh])

  const handleSave = () => {
    if (!form.name.trim()) { toast('Warehouse name is required', 'error'); return }
    if (!form.address.trim()) { toast('Address is required', 'error'); return }
    onSave(form)
  }

  return (
    <Modal open={open ?? true} onClose={onClose} title={wh ? 'Edit Warehouse' : 'New Warehouse'}
      footer={<><Btn variant="secondary" size="sm" onClick={onClose}>Cancel</Btn><Btn size="sm" onClick={handleSave}>Save</Btn></>}>
      <FormField label="Name" required><TextInput value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></FormField>
      <div style={{ display: 'flex', gap: '12px' }}>
        <div style={{ flex: 1 }}><FormField label="Type"><Select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}><option value="fulfilment">Fulfilment</option><option value="returns">Returns</option></Select></FormField></div>
        <div style={{ flex: 1 }}><FormField label="Timezone"><TextInput value={form.timezone} onChange={(e) => setForm({ ...form, timezone: e.target.value })} /></FormField></div>
      </div>
      <FormField label="Address" required><TextInput value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></FormField>
      <div style={{ display: 'flex', gap: '12px' }}>
        <div style={{ flex: 1 }}><FormField label="Capacity"><TextInput type="number" value={form.capacity} onChange={(e) => setForm({ ...form, capacity: parseInt(e.target.value) || 0 })} /></FormField></div>
        <div style={{ flex: 1 }}><FormField label="Utilisation"><TextInput type="number" value={form.utilisation} onChange={(e) => setForm({ ...form, utilisation: parseInt(e.target.value) || 0 })} /></FormField></div>
        <div style={{ flex: 1 }}><FormField label="Despatch cutoff"><TextInput value={form.despatch_cutoff} onChange={(e) => setForm({ ...form, despatch_cutoff: e.target.value })} /></FormField></div>
      </div>
      <div style={{ display: 'flex', gap: '12px' }}>
        <div style={{ flex: 1 }}><FormField label="System name"><TextInput value={form.system_name || ''} onChange={(e) => setForm({ ...form, system_name: e.target.value })} /></FormField></div>
        <div style={{ flex: 1 }}><FormField label="Sync mode"><Select value={form.sync_mode} onChange={(e) => setForm({ ...form, sync_mode: e.target.value })}><option value="real-time">Real-time</option><option value="batch">Batch</option><option value="delegated">Delegated</option></Select></FormField></div>
      </div>
      <FormField label="Tax registration"><TextInput value={form.tax_reg || ''} onChange={(e) => setForm({ ...form, tax_reg: e.target.value })} /></FormField>
      <FormField label="Categories served">
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '6px' }}>
          {form.categories.map((c, i) => <span key={i} className="pill" style={{ cursor: 'pointer' }} onClick={() => setForm({ ...form, categories: form.categories.filter((_, j) => j !== i) })}>{c} ×</span>)}
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <TextInput value={catInput} onChange={(e) => setCatInput(e.target.value)} placeholder="Add category..." style={{ flex: 1 }} />
          <Btn variant="secondary" size="sm" onClick={() => { if (catInput.trim()) { setForm({ ...form, categories: [...form.categories, catInput.trim()] }); setCatInput('') } }}>Add</Btn>
        </div>
      </FormField>
      <FormField label="Countries served">
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '6px' }}>
          {form.countries.map((c, i) => <span key={i} className="pill" style={{ cursor: 'pointer' }} onClick={() => setForm({ ...form, countries: form.countries.filter((_, j) => j !== i) })}>{c} ×</span>)}
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <TextInput value={countryInput} onChange={(e) => setCountryInput(e.target.value)} placeholder="Add country..." style={{ flex: 1 }} />
          <Btn variant="secondary" size="sm" onClick={() => { if (countryInput.trim()) { setForm({ ...form, countries: [...form.countries, countryInput.trim()] }); setCountryInput('') } }}>Add</Btn>
        </div>
      </FormField>
    </Modal>
  )
}
