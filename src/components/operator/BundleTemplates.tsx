/* Configurable bundles: the templates buyers build their own bundle from.
   Beside "Compose a bundle" (a fixed bundle) in the catalogue. Publishing is
   the database's decision; its sentence is shown as it comes. */
import { useCallback, useEffect, useState } from 'react'
import { Plus } from 'lucide-react'
import { SectionCard, Table, Td, StatusPill, Btn, EmptyState, toast } from './shared'
import { Callout } from '../OnboardingJourney'
import { TemplateBuilder, emptyDraft, draftToSave, newSlot } from '../bundles/TemplateBuilder'
import type { TemplateDraft } from '../bundles/TemplateBuilder'
import { loadBundleBook, saveTemplate, setTemplateStatus } from '../../lib/bundleRepo'
import type { BundleBook } from '../../lib/bundleRepo'
import type { BundleTemplate } from '../../lib/bundles'
import type { ProductRow } from '../../lib/catalogue'
import type { BundleRule } from '../../lib/federation'

const EMPTY: BundleBook = { templates: [], slots: [], options: [], loadError: null }
const AUDIENCE: Record<string, string> = { consumer: 'Shoppers', enterprise: 'Business buyers' }

export function BundleTemplates({ products, rule }: { products: ProductRow[]; rule: BundleRule }) {
  const [book, setBook] = useState<BundleBook | null>(null)
  const [editing, setEditing] = useState<TemplateDraft | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [refusal, setRefusal] = useState<{ id: string; text: string } | null>(null)

  const reload = useCallback(async () => { setBook(await loadBundleBook()) }, [])
  useEffect(() => { reload() }, [reload])

  const b = book ?? EMPTY

  const draftOf = (t: BundleTemplate, copy = false): TemplateDraft => ({
    ...(copy ? {} : { id: t.id }),
    name: copy ? `${t.name} (copy)` : t.name,
    description: t.description ?? '', image: t.image ?? '',
    audiences: t.audiences, discount_pct: t.discount_pct, status: copy ? 'draft' : t.status,
    slots: b.slots.filter(s => s.template_id === t.id).sort((x, y) => x.sort_order - y.sort_order).map(s => ({
      ...newSlot(), ...(copy ? {} : { id: s.id, key: s.id }),
      label: s.label, min_pick: s.min_pick, max_pick: s.max_pick, qty_min: s.qty_min, qty_max: s.qty_max, qty_default: s.qty_default,
      options: b.options.filter(o => o.slot_id === s.id).sort((x, y) => x.sort_order - y.sort_order)
        .map(o => ({ product_id: o.product_id, is_default: o.is_default })),
    })),
  })

  const save = async (d: TemplateDraft): Promise<string | null> => {
    const [t, slots] = draftToSave(d)
    const res = await saveTemplate(t, slots)
    // Not one transaction: whatever happened, show what stands now.
    await reload()
    if (!res.ok) {
      if (!d.id) {
        // A partly built draft may now be in the list; edit it from there.
        setEditing(null)
        toast(`Not finished: ${res.error} A partly built draft may be in the list.`, 'error')
        return null
      }
      return res.error
    }
    toast(`${d.name.trim()} saved`)
    setEditing(null)
    return null
  }

  const change = async (t: BundleTemplate, status: BundleTemplate['status'], done: string) => {
    setBusyId(t.id); setRefusal(null)
    const res = await setTemplateStatus(t.id, status)
    setBusyId(null)
    await reload()
    if (!res.ok) { setRefusal({ id: t.id, text: res.error }); return }
    toast(done)
  }

  const shape = (t: BundleTemplate) => {
    const slots = b.slots.filter(s => s.template_id === t.id)
    return `${slots.length} part${slots.length === 1 ? '' : 's'}, ${b.options.filter(o => slots.some(s => s.id === o.slot_id)).length} options`
  }

  return (
    <SectionCard title="Configurable bundles"
      subtitle="Templates a buyer builds their own bundle from, within the published discount rule."
      action={<Btn onClick={() => setEditing(emptyDraft())}><Plus size={14} aria-hidden /> Build a configurable bundle</Btn>}>
      <div className="tb-section">
        {b.loadError && (
          <Callout tone="warning" title="Configurable bundles are not available yet">
            {b.loadError} If this is a new feature, the database may not have been updated for it yet.
          </Callout>
        )}
        {refusal && <Callout tone="danger" title="That did not go through">{refusal.text}</Callout>}
        {!book && <p className="tb-hint" role="status">Reading the bundles...</p>}
        {book && !book.loadError && b.templates.length === 0 && (
          <EmptyState message="No configurable bundles yet. Build one from live listings and publish it." />
        )}
        {b.templates.length > 0 && (
          <Table headers={['Bundle', 'Status', 'Sold to', { label: 'Discount', align: 'right' }, 'Shape', 'Actions']}>
            {b.templates.map(t => (
              <tr key={t.id}>
                <Td><strong>{t.name}</strong></Td>
                <Td><StatusPill status={t.status} /></Td>
                <Td>{t.audiences.map(a => AUDIENCE[a] ?? a).join(', ')}</Td>
                <Td right>{t.discount_pct}%</Td>
                <Td>{shape(t)}</Td>
                <Td>
                  <div className="tb-actions">
                    <Btn size="sm" variant="secondary" onClick={() => setEditing(draftOf(t))}
                      aria-label={`Edit ${t.name}`}>Edit</Btn>
                    {t.status !== 'live' && (
                      <Btn size="sm" disabled={busyId === t.id} aria-label={`Publish ${t.name}`}
                        onClick={() => change(t, 'live', `${t.name} is on sale`)}>Publish</Btn>
                    )}
                    {t.status === 'live' && (
                      <Btn size="sm" variant="secondary" disabled={busyId === t.id} aria-label={`Pause ${t.name}`}
                        onClick={() => change(t, 'paused', `${t.name} is paused`)}>Pause</Btn>
                    )}
                    {t.status === 'paused' && (
                      <Btn size="sm" variant="secondary" disabled={busyId === t.id} aria-label={`Return ${t.name} to draft`}
                        onClick={() => change(t, 'draft', `${t.name} is a draft again`)}>Back to draft</Btn>
                    )}
                    <Btn size="sm" variant="secondary" onClick={() => setEditing(draftOf(t, true))}
                      aria-label={`Duplicate ${t.name}`}>Duplicate</Btn>
                  </div>
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </div>

      {editing && (
        <TemplateBuilder initial={editing} products={products} rule={rule} onClose={() => setEditing(null)} onSave={save} />
      )}
    </SectionCard>
  )
}
