import { useState, useEffect, useCallback } from 'react'
import { Pager, usePaging } from '../Pager'
import { supabase } from '../../lib/supabase'
import type { OperatorInventory, OperatorWarehouse, Product } from '../../types'
import { demandByProduct, type Watch } from '../../lib/stockWatch'
import {
  stockBadge, stockLabel, lineValue, totalValue, attentionOrder, canStock,
} from '../../lib/inventory'
import { Callout } from '../OnboardingJourney'
import { useMarket } from '../../lib/MarketContext'
import {
  SectionCard, Table, Td, StatusPill, EmptyState, fmtInt, fmtDate,
  Btn, Modal, FormField, TextInput, Select, toast,
} from './shared'

/* The row shape the ledger reads: a stock line with its product and warehouse
   attached. Before this the table stored a product name, a partner name, a
   category and a warehouse as four independent strings, and none of the four
   resolved to the record it was naming. */
const SELECT = '*, product:products(id,name,seller,category_id,price), warehouse:operator_warehouses(id,name,type,categories)'

export function OperatorInventory() {
  /* Stock is bought centrally in the marketplace's reporting currency, and the
     unit cost is compared against `products.price`, which is in the same one.
     So this is a single-currency screen — the mark comes from the currency
     table rather than being typed, and nothing here needs grouping. */
  const { book: moneyBook, fmtIn } = useMarket()
  const cost = (n: number) =>
    fmtIn(Number(n), moneyBook.currencies.find(c => c.is_reporting)?.code ?? 'USD')
  const [inventory, setInventory] = useState<OperatorInventory[]>([])
  const [warehouses, setWarehouses] = useState<OperatorWarehouse[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'stock' | 'warehouses'>('stock')
  const [editModal, setEditModal] = useState<OperatorInventory | null>(null)
  const [addModal, setAddModal] = useState(false)
  const [whModal, setWhModal] = useState<OperatorWarehouse | null>(null)
  const [whAddModal, setWhAddModal] = useState(false)
  /* Who is waiting for what. This used to have to go round the catalogue
     separately because the ledger had no key back to it; it still reads
     `products`, but now the two tables are talking about the same rows. */
  const [demand, setDemand] = useState<{ product: Product; waiting: number }[]>([])

  const refreshInv = useCallback(async () => {
    const { data, error } = await supabase.from('operator_inventory').select(SELECT).order('sort_order')
    if (error) { setLoadError(`Stock lines could not be loaded: ${error.message}`); return }
    setLoadError(null)
    setInventory((data ?? []) as OperatorInventory[])
  }, [])

  const refreshWh = useCallback(async () => {
    const { data } = await supabase.from('operator_warehouses').select('*').order('sort_order')
    if (data) setWarehouses(data as OperatorWarehouse[])
  }, [])

  useEffect(() => {
    Promise.all([
      refreshInv(),
      refreshWh(),
      supabase.from('products').select('*').eq('fulfil', 'shipped').order('id'),
    ]).then(([, , prod]) => {
      /* Only shippable products can hold warehouse stock, so only those are
         offerable when adding a line. A count of an eSIM is not a number
         anybody can take. */
      setProducts((prod.data ?? []) as Product[])
      setLoading(false)
    })

    supabase.from('stock_watch').select('*').then(async ({ data }) => {
      const counts = demandByProduct((data ?? []) as Watch[])
      if (counts.length === 0) return
      const { data: prods } = await supabase.from('products').select('*').in('id', counts.map(c => c.productId))
      const byId = Object.fromEntries(((prods ?? []) as Product[]).map(p => [p.id, p]))
      setDemand(counts.filter(c => byId[c.productId]).map(c => ({ product: byId[c.productId], waiting: c.waiting })))
    })
  }, [refreshInv, refreshWh])

  /* Above the loading guard: `usePaging` is a hook, and a hook after an
     early return runs on some renders and not others. */
  const stockPage = usePaging(inventory)
  const whPage = usePaging(warehouses)
  const demandPage = usePaging(demand, { initialSize: 5 })

  if (loading) return <div style={{ textAlign: 'center', padding: '40px' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>

  const handleDeleteWh = async (id: string) => {
    const { error } = await supabase.from('operator_warehouses').delete().eq('id', id)
    /* The stock line's foreign key is `on delete restrict`, so deleting a
       warehouse that still holds stock fails rather than orphaning it. Say so
       instead of reporting a success that did not happen. */
    if (error) { toast(`This warehouse still holds stock, so it cannot be deleted: ${error.message}`, 'error'); return }
    toast('Warehouse deleted')
    await refreshWh()
  }

  const value = totalValue(inventory)
  const attention = attentionOrder(inventory)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px', flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 800, color: 'var(--text)' }}>Inventory &amp; WMS</h1>
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)', marginTop: '4px' }}>
            {inventory.length} stock lines across {warehouses.filter(w => w.type !== 'returns').length} fulfilment
            {' '}locations · {cost(value)} at cost
          </p>
        </div>
        <Btn onClick={() => tab === 'stock' ? setAddModal(true) : setWhAddModal(true)}>
          {tab === 'stock' ? 'Add stock line' : 'Add warehouse'}
        </Btn>
      </div>

      {loadError && <Callout tone="danger" title="This did not load">{loadError}</Callout>}

      <div style={{ display: 'flex', gap: '8px' }}>
        {[{ id: 'stock' as const, label: 'Stock ledger' }, { id: 'warehouses' as const, label: 'Warehouses' }].map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            padding: '8px 16px', borderRadius: 'var(--radius)', fontSize: 'var(--text-sm)', fontWeight: 600,
            background: tab === t.id ? 'var(--brand-navy)' : 'white',
            color: tab === t.id ? 'white' : 'var(--text-secondary)',
            border: '1px solid var(--border)', cursor: 'pointer',
          }}>{t.label}</button>
        ))}
      </div>

      {/* What needs doing, worst first. A line that is out with 2,000 units
          landing on Friday needs nothing from anybody, and showing it beside one
          that is out with nothing on order teaches people to ignore both. */}
      {tab === 'stock' && attention.length > 0 && (
        <SectionCard
          title="Needs a decision"
          subtitle={(() => {
            const bare = attention.filter(a => !a.attention.covered).length
            /* "0 of 3 have nothing on order" is a true sentence nobody can read.
               The panel is about what to do, so say what there is to do. */
            return bare === 0
              ? `${attention.length} below the reorder point, all covered by stock already on order`
              : `${bare} of ${attention.length} with nothing on order`
          })()}
        >
          <div style={{ padding: '14px 20px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {attention.map(({ line, attention: a }) => (
              <div key={line.id} style={{
                display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap',
                padding: '10px 12px', borderRadius: 'var(--radius-md)',
                border: '1px solid var(--border)',
                background: a.covered ? 'white' : a.kind === 'out' ? 'var(--danger-bg)' : 'var(--warning-bg)',
              }}>
                <div style={{ flex: 1, minWidth: '200px' }}>
                  <div style={{ fontSize: 'var(--text-xs)', fontWeight: 700, color: 'var(--text)' }}>
                    {line.product?.name ?? line.product_id}
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>
                    {line.product?.seller ?? '—'} · {line.warehouse?.name ?? line.warehouse_id}
                  </div>
                </div>
                <div style={{ fontSize: '11px', color: 'var(--text-secondary)', minWidth: '170px' }}>
                  {fmtInt(line.available)} available against a reorder point of {fmtInt(line.reorder_point)}
                </div>
                <div style={{
                  fontSize: '11px', fontWeight: 700, minWidth: '190px', textAlign: 'right',
                  color: a.covered ? 'var(--success)' : 'var(--danger)',
                }}>
                  {a.covered
                    ? `${fmtInt(line.inbound)} inbound${line.inbound_due ? `, due ${fmtDate(line.inbound_due)}` : ''}`
                    : line.inbound > 0
                    ? `${fmtInt(line.inbound)} inbound — still short`
                    : 'Nothing on order'}
                </div>
              </div>
            ))}
          </div>
        </SectionCard>
      )}

      {/* Shoppers who tried to buy something that was not there and asked to be
          told. A line nobody is waiting for and a line twelve people are waiting
          for should not look the same when deciding what to reorder. */}
      {tab === 'stock' && demand.length > 0 && (
        <SectionCard title="Waiting for stock" subtitle="Shoppers who asked to be told when these come back">
          <><Table headers={['Product', 'Seller', 'Stock', 'Waiting']}>
            {demandPage.rows.map(d => {
              const badge = d.product.stock as 'in' | 'low' | 'out'
              return (
                <tr key={d.product.id}>
                  <Td>{d.product.name}</Td>
                  <Td>{d.product.seller}</Td>
                  {/* StatusPill's vocabulary is approval states — reusing it here
                      labelled an out-of-stock product "rejected". Stock has its
                      own words. */}
                  <Td>
                    <span style={{
                      padding: '2px 10px', borderRadius: '999px', fontSize: 'var(--text-xs)', fontWeight: 700,
                      background: badge === 'out' ? '#FEE2E2' : badge === 'low' ? '#FEF3C7' : '#DCFCE7',
                      color: badge === 'out' ? '#B91C1C' : badge === 'low' ? '#92400E' : '#15803D',
                    }}>{stockLabel(badge)}</span>
                  </Td>
                  <Td right style={{ fontWeight: 700 }}>{fmtInt(d.waiting)}</Td>
                </tr>
              )
            })}
          </Table>
          <div style={{ padding: '0 18px 12px' }}><Pager page={demandPage} noun="products" /></div></>
        </SectionCard>
      )}

      {tab === 'stock' && (
        <SectionCard
          title="Stock ledger"
          subtitle="Available is on hand minus reserved, computed by the database rather than stored beside them"
        >
          {inventory.length === 0 ? <EmptyState message="No stock lines" /> : (
            <><Table headers={['Product', 'Seller', 'Warehouse', 'On hand', 'Reserved', 'Available', 'Reorder', 'Inbound', 'Unit cost', 'Value', '']}>
              {stockPage.rows.map(i => {
                const badge = stockBadge(i.available, i.reorder_point)
                return (
                  <tr key={i.id}>
                    <Td>
                      <div style={{ fontWeight: 600 }}>{i.product?.name ?? i.product_id}</div>
                      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>{i.product_id}</div>
                    </Td>
                    <Td>{i.product?.seller ?? '—'}</Td>
                    <Td>{i.warehouse?.name ?? i.warehouse_id}</Td>
                    <Td right>{fmtInt(i.on_hand)}</Td>
                    <Td right>{fmtInt(i.reserved)}</Td>
                    <Td right style={{
                      fontWeight: 700,
                      color: badge === 'out' ? 'var(--danger)' : badge === 'low' ? 'var(--warning)' : 'var(--success)',
                    }}>{fmtInt(i.available)}</Td>
                    <Td right>{fmtInt(i.reorder_point)}</Td>
                    <Td right>{i.inbound > 0 ? `${fmtInt(i.inbound)} (${fmtDate(i.inbound_due)})` : '—'}</Td>
                    <Td right>{cost(i.unit_cost)}</Td>
                    <Td right>{cost(lineValue(i))}</Td>
                    <Td right>
                      <Btn variant="secondary" size="sm" onClick={() => setEditModal(i)}>Edit</Btn>
                    </Td>
                  </tr>
                )
              })}
            </Table>
            <div style={{ padding: '0 18px 12px' }}><Pager page={stockPage} noun="stock lines" /></div></>
          )}
          <div style={{ padding: '12px 20px', borderTop: '1px solid var(--border-light)' }}>
            <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', margin: 0 }}>
              A stock line cannot be deleted from here. Stock does not stop existing because a row was
              removed — a line that should not be sold is taken to zero on hand, which the storefront reads
              as out of stock and which leaves the count auditable.
            </p>
          </div>
        </SectionCard>
      )}

      {tab === 'warehouses' && (
        <SectionCard title="Warehouse configuration" subtitle="Type · address · capacity · system link">
          {warehouses.length === 0 ? <EmptyState message="No warehouses configured" /> : (
            <><Table headers={['Name', 'Type', 'Address', 'Capacity', 'Utilisation', 'Marketplaces served', 'System', 'Sync', 'State', '']}>
              {whPage.rows.map(w => (
                <tr key={w.id}>
                  <Td>{w.name}</Td>
                  <Td>{w.type}</Td>
                  <Td>{w.address}</Td>
                  <Td right>{fmtInt(w.capacity)}</Td>
                  <Td right style={{ color: w.utilisation / w.capacity > 0.8 ? 'var(--warning)' : 'var(--text)' }}>
                    {fmtInt(w.utilisation)} ({(w.utilisation / w.capacity * 100).toFixed(0)}%)
                  </Td>
                  <Td>{w.categories.join(', ') || '—'}</Td>
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
            <div style={{ padding: '0 18px 12px' }}><Pager page={whPage} noun="warehouses" /></div></>
          )}
          <div style={{ padding: '12px 20px', borderTop: '1px solid var(--border-light)' }}>
            <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', margin: 0 }}>
              Utilisation is measured in storage slots, not units — it is not the sum of the stock ledger,
              and the two are not expected to agree.
            </p>
          </div>
        </SectionCard>
      )}

      {(editModal || addModal) && (
        <InvModal
          item={editModal ?? undefined}
          products={products}
          warehouses={warehouses}
          taken={inventory}
          onClose={() => { setEditModal(null); setAddModal(false) }}
          onSaved={async (msg) => {
            toast(msg)
            setEditModal(null); setAddModal(false)
            await refreshInv()
          }}
        />
      )}

      {(whModal || whAddModal) && (
        <WhModal
          wh={whModal ?? undefined}
          onClose={() => { setWhModal(null); setWhAddModal(false) }}
          onSaved={async (msg) => { toast(msg); setWhModal(null); setWhAddModal(false); await refreshWh() }}
          nextSort={warehouses.length > 0 ? Math.max(...warehouses.map(x => x.sort_order)) + 1 : 0}
        />
      )}
    </div>
  )
}

/* -------------------------------------------------------- stock modal ----- */

function InvModal({ item, products, warehouses, taken, onClose, onSaved }: {
  item?: OperatorInventory
  products: Product[]
  warehouses: OperatorWarehouse[]
  taken: OperatorInventory[]
  onClose: () => void
  onSaved: (message: string) => void
}) {
  /* Same currency as the list behind it — the modal quotes the sale price it is
     checking the cost against, and the two must be marked the same way. */
  const { book: moneyBook, fmtIn } = useMarket()
  const cost = (n: number) =>
    fmtIn(Number(n), moneyBook.currencies.find(c => c.is_reporting)?.code ?? 'USD')
  const [productId, setProductId] = useState(item?.product_id ?? products[0]?.id ?? '')
  const [warehouseId, setWarehouseId] = useState(item?.warehouse_id ?? '')
  const [onHand, setOnHand] = useState(item?.on_hand ?? 0)
  const [reserved, setReserved] = useState(item?.reserved ?? 0)
  const [reorderPoint, setReorderPoint] = useState(item?.reorder_point ?? 10)
  const [inbound, setInbound] = useState(item?.inbound ?? 0)
  const [inboundDue, setInboundDue] = useState(item?.inbound_due ?? '')
  const [unitCost, setUnitCost] = useState(item?.unit_cost ?? 0)
  const [saving, setSaving] = useState(false)

  const product = products.find(p => p.id === productId) ?? null

  /* Only warehouses that may actually hold this product. A returns centre and a
     location that does not serve the marketplace are both refused, so the
     picker cannot offer a choice the database will reject. */
  const eligible = warehouses.filter(w => product && canStock(w, product.category_id).ok)

  useEffect(() => {
    if (!warehouseId || !eligible.some(w => w.id === warehouseId)) {
      setWarehouseId(eligible[0]?.id ?? '')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId, warehouses.length])

  const available = onHand - reserved
  const badge = stockBadge(available, reorderPoint)

  /* The same key the database enforces. Told before saving rather than after. */
  const duplicate = !item && taken.some(t => t.product_id === productId && t.warehouse_id === warehouseId)

  const problem =
    !productId ? 'Choose a product.'
    : !warehouseId ? 'This product has no warehouse that serves its marketplace. Add one, or extend an existing one.'
    : reserved > onHand ? 'Reserved cannot exceed what is on hand — that would be stock sold twice.'
    : onHand < 0 || reserved < 0 ? 'Quantities cannot be negative.'
    : unitCost <= 0 ? 'A unit cost is required. It is the figure a stock write-down is taken against.'
    : product && unitCost >= product.price ? `Unit cost is at or above the ${product.name} sale price of ${cost(product.price)}.`
    : inbound > 0 && !inboundDue ? 'An inbound quantity needs a date, or nobody can tell whether it will arrive in time.'
    : duplicate ? 'This product already has a line in that warehouse. Edit that one rather than opening a second count.'
    : null

  const save = async () => {
    if (problem) { toast(problem, 'error'); return }
    setSaving(true)
    /* `available` is generated in the database and cannot be written. */
    const row = {
      product_id: productId, warehouse_id: warehouseId,
      on_hand: onHand, reserved, reorder_point: reorderPoint,
      inbound, inbound_due: inbound > 0 ? inboundDue : null,
      unit_cost: unitCost, last_count: new Date().toISOString().slice(0, 10),
    }

    const res = item
      ? await supabase.from('operator_inventory').update(row).eq('id', item.id).select()
      : await supabase.from('operator_inventory').insert({
          ...row, id: `inv-${productId}-${warehouseId}`.toLowerCase(),
          sort_order: taken.length + 1,
        }).select()

    if (res.error) { setSaving(false); toast(`The stock line was not saved: ${res.error.message}`, 'error'); return }
    if (!res.data || res.data.length === 0) {
      setSaving(false)
      toast('No row was written. Check that write access is permitted.', 'error')
      return
    }

    /* The badge a buyer reads is derived from these numbers, so it moves with
       them. Leaving it behind is how a product ends up "in stock" on the
       storefront with an empty shelf behind it. */
    const { error: badgeErr } = await supabase.from('products').update({ stock: badge }).eq('id', productId)
    setSaving(false)
    if (badgeErr) {
      onSaved(`Stock saved, but the storefront badge still says "${product?.stock}": ${badgeErr.message}`)
      return
    }
    onSaved(`${product?.name ?? productId} saved — the storefront now shows ${stockLabel(badge).toLowerCase()}`)
  }

  return (
    <Modal open onClose={onClose} title={item ? 'Edit stock line' : 'New stock line'}
      footer={<>
        <Btn variant="secondary" size="sm" onClick={onClose}>Cancel</Btn>
        <Btn size="sm" disabled={!!problem || saving} onClick={save}>{saving ? 'Saving…' : 'Save'}</Btn>
      </>}>
      <FormField label="Product" required hint="Only products that are shipped — nothing else has warehouse stock.">
        <Select value={productId} onChange={e => setProductId(e.target.value)} disabled={!!item}>
          {products.map(p => <option key={p.id} value={p.id}>{p.name} — {p.seller}</option>)}
        </Select>
      </FormField>

      <FormField label="Warehouse" required hint="Locations that serve this product's marketplace, excluding returns.">
        <Select value={warehouseId} onChange={e => setWarehouseId(e.target.value)} disabled={!!item}>
          {eligible.length === 0 && <option value="">No warehouse serves this marketplace</option>}
          {eligible.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
        </Select>
      </FormField>

      <div style={{ display: 'flex', gap: '12px' }}>
        <div style={{ flex: 1 }}><FormField label="On hand" required>
          <TextInput type="number" value={onHand} onChange={e => setOnHand(parseInt(e.target.value) || 0)} />
        </FormField></div>
        <div style={{ flex: 1 }}><FormField label="Reserved">
          <TextInput type="number" value={reserved} onChange={e => setReserved(parseInt(e.target.value) || 0)} />
        </FormField></div>
        <div style={{ flex: 1 }}><FormField label="Available" hint="On hand minus reserved.">
          <TextInput value={available} readOnly style={{ background: 'var(--bg-alt)', fontWeight: 700 }} />
        </FormField></div>
      </div>

      <div style={{ display: 'flex', gap: '12px' }}>
        <div style={{ flex: 1 }}><FormField label="Reorder point">
          <TextInput type="number" value={reorderPoint} onChange={e => setReorderPoint(parseInt(e.target.value) || 0)} />
        </FormField></div>
        <div style={{ flex: 1 }}><FormField label="Inbound quantity">
          <TextInput type="number" value={inbound} onChange={e => setInbound(parseInt(e.target.value) || 0)} />
        </FormField></div>
        <div style={{ flex: 1 }}><FormField label="Inbound due">
          <TextInput type="date" value={inboundDue ?? ''} onChange={e => setInboundDue(e.target.value)} disabled={inbound === 0} />
        </FormField></div>
      </div>

      <FormField label="Unit cost" required hint="What it costs the marketplace. This is also the product's recorded cost.">
        <TextInput type="number" step="0.01" value={unitCost} onChange={e => setUnitCost(parseFloat(e.target.value) || 0)} />
      </FormField>

      {/* What saving this does to the storefront, before it does it. */}
      <Callout tone={badge === 'out' ? 'danger' : badge === 'low' ? 'warning' : 'info'}>
        Buyers will see <strong>{stockLabel(badge).toLowerCase()}</strong> — {available} available against a
        reorder point of {reorderPoint}.
        {problem && <div style={{ marginTop: '4px', color: 'var(--danger)' }}>{problem}</div>}
      </Callout>
    </Modal>
  )
}

/* ---------------------------------------------------- warehouse modal ----- */

function WhModal({ wh, onClose, onSaved, nextSort }: {
  wh?: OperatorWarehouse
  onClose: () => void
  onSaved: (message: string) => void
  nextSort: number
}) {
  const [form, setForm] = useState<OperatorWarehouse>(wh ?? {
    id: '', name: '', type: 'fulfilment', address: '', timezone: 'UTC', despatch_cutoff: '16:00',
    capacity: 5000, utilisation: 0, categories: [], countries: [], system_name: '', sync_mode: 'real-time',
    sync_state: 'healthy', last_sync: new Date().toISOString(), tax_reg: '', sort_order: nextSort,
  })
  const [categories, setCategories] = useState<{ id: string; name: string }[]>([])
  const [countryInput, setCountryInput] = useState('')

  useEffect(() => {
    supabase.from('categories').select('id,name').order('sort_order')
      .then(({ data }) => setCategories((data ?? []) as { id: string; name: string }[]))
  }, [])

  const toggleCategory = (id: string) => setForm(f => ({
    ...f,
    categories: f.categories.includes(id) ? f.categories.filter(c => c !== id) : [...f.categories, id],
  }))

  const save = async () => {
    if (!form.name.trim()) { toast('A name is required', 'error'); return }
    if (!form.address.trim()) { toast('An address is required', 'error'); return }
    const res = wh
      ? await supabase.from('operator_warehouses').update(form).eq('id', wh.id).select()
      : await supabase.from('operator_warehouses').insert({ ...form, id: `wh-${Date.now()}` }).select()
    if (res.error) { toast(`The warehouse was not saved: ${res.error.message}`, 'error'); return }
    onSaved(wh ? 'Warehouse updated' : 'Warehouse created')
  }

  return (
    <Modal open onClose={onClose} title={wh ? 'Edit warehouse' : 'New warehouse'}
      footer={<><Btn variant="secondary" size="sm" onClick={onClose}>Cancel</Btn>
                <Btn size="sm" onClick={save}>Save</Btn></>}>
      <FormField label="Name" required><TextInput value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></FormField>
      <div style={{ display: 'flex', gap: '12px' }}>
        <div style={{ flex: 1 }}><FormField label="Type">
          <Select value={form.type} onChange={e => setForm({ ...form, type: e.target.value })}>
            <option value="fulfilment">Fulfilment</option>
            <option value="returns">Returns</option>
          </Select>
        </FormField></div>
        <div style={{ flex: 1 }}><FormField label="Timezone">
          <TextInput value={form.timezone} onChange={e => setForm({ ...form, timezone: e.target.value })} />
        </FormField></div>
      </div>
      <FormField label="Address" required><TextInput value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} /></FormField>
      <div style={{ display: 'flex', gap: '12px' }}>
        <div style={{ flex: 1 }}><FormField label="Capacity" hint="Storage slots, not units.">
          <TextInput type="number" value={form.capacity} onChange={e => setForm({ ...form, capacity: parseInt(e.target.value) || 0 })} />
        </FormField></div>
        <div style={{ flex: 1 }}><FormField label="Utilisation">
          <TextInput type="number" value={form.utilisation} onChange={e => setForm({ ...form, utilisation: parseInt(e.target.value) || 0 })} />
        </FormField></div>
        <div style={{ flex: 1 }}><FormField label="Despatch cutoff">
          <TextInput value={form.despatch_cutoff} onChange={e => setForm({ ...form, despatch_cutoff: e.target.value })} />
        </FormField></div>
      </div>
      <div style={{ display: 'flex', gap: '12px' }}>
        <div style={{ flex: 1 }}><FormField label="System name">
          <TextInput value={form.system_name || ''} onChange={e => setForm({ ...form, system_name: e.target.value })} />
        </FormField></div>
        <div style={{ flex: 1 }}><FormField label="Sync mode">
          <Select value={form.sync_mode} onChange={e => setForm({ ...form, sync_mode: e.target.value })}>
            <option value="real-time">Real-time</option>
            <option value="batch">Batch</option>
            <option value="delegated">Delegated</option>
          </Select>
        </FormField></div>
      </div>
      <FormField label="Tax registration">
        <TextInput value={form.tax_reg || ''} onChange={e => setForm({ ...form, tax_reg: e.target.value })} />
      </FormField>

      {/* Picked from the real six rather than typed. Free text here is how the
          table ended up serving a 'Device' marketplace that does not exist. */}
      <FormField label="Marketplaces served"
                 hint="Stock can only be held in a location that serves its marketplace.">
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
          {categories.map(c => {
            const on = form.categories.includes(c.id)
            return (
              <button key={c.id} type="button" onClick={() => toggleCategory(c.id)} style={{
                padding: '5px 11px', borderRadius: 'var(--radius-full)', cursor: 'pointer',
                fontSize: 'var(--text-xs)', fontWeight: 600,
                border: `1px solid ${on ? 'var(--brand-navy)' : 'var(--border)'}`,
                background: on ? 'var(--brand-navy)' : 'white',
                color: on ? 'white' : 'var(--text-secondary)',
              }}>{c.name}</button>
            )
          })}
        </div>
      </FormField>

      <FormField label="Countries served">
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '6px' }}>
          {form.countries.map((c, i) => (
            <span key={c} className="pill" style={{ cursor: 'pointer' }}
                  onClick={() => setForm({ ...form, countries: form.countries.filter((_, j) => j !== i) })}>{c} ×</span>
          ))}
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <TextInput value={countryInput} onChange={e => setCountryInput(e.target.value)} placeholder="Add country..." style={{ flex: 1 }} />
          <Btn variant="secondary" size="sm" onClick={() => {
            if (countryInput.trim()) { setForm({ ...form, countries: [...form.countries, countryInput.trim()] }); setCountryInput('') }
          }}>Add</Btn>
        </div>
      </FormField>
    </Modal>
  )
}
