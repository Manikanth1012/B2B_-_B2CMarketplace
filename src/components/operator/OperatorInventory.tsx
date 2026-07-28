import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import type { OperatorInventory, OperatorWarehouse } from '../../types'
import { SectionCard, Table, Td, StatusPill, EmptyState, fmtMoney, fmtInt, fmtDate } from './shared'

export function OperatorInventory() {
  const [inventory, setInventory] = useState<OperatorInventory[]>([])
  const [warehouses, setWarehouses] = useState<OperatorWarehouse[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'stock' | 'warehouses'>('stock')

  useEffect(() => {
    Promise.all([
      supabase.from('operator_inventory').select('*').order('sort_order'),
      supabase.from('operator_warehouses').select('*').order('sort_order'),
    ]).then(([inv, wh]) => {
      if (inv.data) setInventory(inv.data as OperatorInventory[])
      if (wh.data) setWarehouses(wh.data as OperatorWarehouse[])
      setLoading(false)
    })
  }, [])

  if (loading) return <div style={{ textAlign: 'center', padding: '40px' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div>
        <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 800, color: 'var(--text)' }}>Inventory & WMS</h1>
        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)', marginTop: '4px' }}>
          {inventory.length} stock lines · {warehouses.length} warehouses
        </p>
      </div>

      <div style={{ display: 'flex', gap: '8px' }}>
        {[
          { id: 'stock' as const, label: 'Stock Ledger' },
          { id: 'warehouses' as const, label: 'Warehouses' },
        ].map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            padding: '8px 16px', borderRadius: 'var(--radius)', fontSize: 'var(--text-sm)', fontWeight: 600,
            background: tab === t.id ? 'var(--brand-navy)' : 'white', color: tab === t.id ? 'white' : 'var(--text-secondary)',
            border: '1px solid var(--border)', cursor: 'pointer',
          }}>{t.label}</button>
        ))}
      </div>

      {tab === 'stock' && (
        <SectionCard title="Stock Ledger" subtitle="On hand · Reserved · Available = on hand − reserved">
          {inventory.length === 0 ? <EmptyState message="No inventory records" /> : (
            <Table headers={['Product', 'Partner', 'Warehouse', 'On Hand', 'Reserved', 'Available', 'Reorder', 'Inbound', 'Unit Cost', 'Last Count']}>
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
                  <Td right>{fmtDate(i.last_count)}</Td>
                </tr>
              ))}
            </Table>
          )}
        </SectionCard>
      )}

      {tab === 'warehouses' && (
        <SectionCard title="Warehouse Configuration" subtitle="Type · Address · Capacity · System link">
          {warehouses.length === 0 ? <EmptyState message="No warehouses configured" /> : (
            <Table headers={['Name', 'Type', 'Address', 'Capacity', 'Utilisation', 'Categories', 'System', 'Sync', 'State']}>
              {warehouses.map(w => (
                <tr key={w.id}>
                  <Td>{w.name}</Td>
                  <Td>{w.type}</Td>
                  <Td>{w.address}</Td>
                  <Td right>{fmtInt(w.capacity)}</Td>
                  <Td right style={{ color: w.utilisation / w.capacity > 0.8 ? 'var(--warning)' : 'var(--text)' }}>
                    {fmtInt(w.utilisation)} ({(w.utilisation / w.capacity * 100).toFixed(0)}%)
                  </Td>
                  <Td>{w.categories.join(', ')}</Td>
                  <Td>{w.system_name || '—'}</Td>
                  <Td right>{w.sync_mode}</Td>
                  <Td right><StatusPill status={w.sync_state} /></Td>
                </tr>
              ))}
            </Table>
          )}
        </SectionCard>
      )}
    </div>
  )
}
