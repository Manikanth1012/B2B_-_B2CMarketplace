/* The operator's bundle builder: what the bundle is, what the buyer chooses,
   and what it would cost. It writes through saveTemplate and decides nothing
   the database would refuse — it shows the database's sentence. */
import { useCallback, useMemo, useRef, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { Dialog } from '../ui/Dialog'
import { Btn, FormField, TextArea, TextInput, Select } from '../operator/shared'
import { Callout } from '../OnboardingJourney'
import { TemplatePreview } from './TemplatePreview'
import type { PreviewSlot } from './previewPrices'
import { draftProblems, hasProblems } from './templateDraftProblems'
import type { BundleTemplate } from '../../lib/bundles'
import type { SlotInput } from '../../lib/bundlePayload'
import type { ProductRow } from '../../lib/catalogue'
import type { BundleRule } from '../../lib/federation'

type Audience = BundleTemplate['audiences'][number]
const AUDIENCES: { id: Audience; label: string }[] = [
  { id: 'consumer', label: 'Shoppers' },
  { id: 'enterprise', label: 'Business buyers' },
]

export interface DraftSlot {
  key: string
  id?: string
  label: string
  min_pick: number
  max_pick: number
  qty_min: number
  qty_max: number
  qty_default: number
  options: { product_id: string; is_default: boolean }[]
}

export interface TemplateDraft {
  id?: string
  name: string
  description: string
  image: string
  audiences: Audience[]
  discount_pct: number
  status: BundleTemplate['status']
  slots: DraftSlot[]
}

let seq = 0
export const newSlot = (): DraftSlot => ({
  key: `new-${++seq}`, label: '', min_pick: 1, max_pick: 1, qty_min: 1, qty_max: 1, qty_default: 1, options: [],
})

export const emptyDraft = (): TemplateDraft => ({
  name: '', description: '', image: '', audiences: ['enterprise'], discount_pct: 5, status: 'draft', slots: [newSlot(), newSlot()],
})

const num = (v: string): number => (v === '' ? 0 : Number(v))

export function TemplateBuilder({ initial, products, rule, onClose, onSave }: {
  initial: TemplateDraft
  products: ProductRow[]
  rule: BundleRule
  onClose: () => void
  /** Resolves to the database's sentence when it refused (with the id of a
      partly created template, if one now exists), or null when saved. */
  onSave: (draft: TemplateDraft) => Promise<{ error: string; id?: string } | null>
}) {
  const [d, setD] = useState<TemplateDraft>(initial)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tried, setTried] = useState(false)
  const body = useRef<HTMLDivElement>(null)
  const frozen = d.status === 'live'
  const problems = useMemo(() => draftProblems(d, rule.max_discount), [d, rule.max_discount])
  const bad = hasProblems(problems)
  const bp = (k: string) => (tried ? problems.bundle[k] : undefined)
  const sp = (key: string, k: string) => (tried ? problems.slots[key]?.[k] : undefined)

  const byId = useMemo(() => new Map(products.map(p => [p.id, p])), [products])
  const nameOf = useCallback((id: string) => byId.get(id)?.name ?? id, [byId])
  const set = (patch: Partial<TemplateDraft>) => setD(cur => ({ ...cur, ...patch }))
  const setSlot = (key: string, patch: Partial<DraftSlot>) =>
    setD(cur => ({ ...cur, slots: cur.slots.map(s => (s.key === key ? { ...s, ...patch } : s)) }))

  const used = new Set(d.slots.flatMap(s => s.options.map(o => o.product_id)))
  const offerable = products.filter(p =>
    p.status === 'live' && p.stock !== 'out' && d.audiences.every(a => p.audiences.includes(a)) && !used.has(p.id))

  const previewSlots: PreviewSlot[] = useMemo(() => d.slots.map((s, i) => ({
    id: s.id ?? s.key, label: s.label, min_pick: s.min_pick, max_pick: s.max_pick, qty_min: s.qty_min,
    qty_max: s.qty_max, qty_default: s.qty_default, sort_order: i, options: s.options,
  })), [d.slots])

  const save = async () => {
    if (bad) {
      setTried(true)
      // Wait for the messages to render, then land on the first field that is wrong.
      setTimeout(() => body.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus(), 0)
      return
    }
    setBusy(true); setError(null)
    const refused = await onSave(d)
    setBusy(false)
    if (refused) {
      setError(refused.error)
      if (refused.id && !d.id) set({ id: refused.id })
    }
  }

  const count = Object.keys(problems.bundle).length + Object.values(problems.slots).reduce((n, p) => n + Object.keys(p).length, 0)
  const inv = (msg: string | undefined, id: string) => (msg ? { 'aria-invalid': true as const, 'aria-describedby': id } : {})
  const Err = ({ id, msg }: { id: string; msg?: string }) => (msg ? <div id={id} className="tb-err">{msg}</div> : null)

  return (
    <Dialog open onClose={busy ? () => undefined : onClose} wide className="tb"
      title={d.id ? `Edit ${initial.name || 'bundle'}` : 'Build a configurable bundle'}
      footer={(
        <>
          <div className="tb-foot">
            {error && <p role="alert" className="tb-foot__err"><strong>That was not saved.</strong> {error}</p>}
            {tried && bad && <p role="status" className="tb-foot__err">{count} thing{count === 1 ? '' : 's'} to fix before this can be saved.</p>}
          </div>
          <Btn variant="secondary" onClick={onClose} disabled={busy}>Cancel</Btn>
          <Btn onClick={save} disabled={busy} aria-disabled={bad || undefined} className={bad ? 'tb-save--blocked' : undefined}>{busy ? 'Saving...' : 'Save bundle'}</Btn>
        </>
      )}>
      <div className="tb-body" ref={body}>
        {frozen && (
          <Callout tone="info" title="This bundle is on sale">
            Its parts and options are locked while buyers can choose from them. Pause the bundle first to change them;
            the name, description, image, audience and discount can change now.
          </Callout>
        )}

        <div className="tb-grid">
          <FormField label="Name" required>
            <TextInput value={d.name} maxLength={80} {...inv(bp('name'), 'tb-e-name')} onChange={e => set({ name: e.target.value })} />
          </FormField>
          <FormField label="Discount off the parts (%)" required
            hint={`At most ${rule.max_discount}% under the published rule. No part is ever priced below its floor.`}>
            <TextInput type="number" min={0} max={rule.max_discount} step="any" value={d.discount_pct} {...inv(bp('discount'), 'tb-e-discount')}
              onChange={e => set({ discount_pct: num(e.target.value) })} />
          </FormField>
        </div>
        <FormField label="Description">
          <TextArea rows={2} value={d.description} onChange={e => set({ description: e.target.value })} />
        </FormField>
        <FormField label="Image address" hint="Optional. A picture shown on the bundle card.">
          <TextInput value={d.image} onChange={e => set({ image: e.target.value })} />
        </FormField>

        <fieldset className="tb-aud" aria-describedby={bp('audiences') ? 'tb-e-aud' : undefined}>
          <legend className="c-field__label">Sold to</legend>
          {AUDIENCES.map(a => (
            <label key={a.id} className="tb-check">
              <input type="checkbox" checked={d.audiences.includes(a.id)}
                onChange={e => set({ audiences: e.target.checked ? [...d.audiences, a.id] : d.audiences.filter(x => x !== a.id) })} />
              {a.label}
            </label>
          ))}
          <Err id="tb-e-aud" msg={bp('audiences')} />
        </fieldset>

        <h3 className="tb-h">What the buyer chooses</h3>
        <p className="tb-hint">
          {rule.min_components} to {rule.max_components} parts. Each part offers products to pick from, and one product
          belongs to one part only. Mark the starting choice for every part the buyer must fill.
        </p>

        {d.slots.map((s, i) => {
          const free = offerable
          return (
            <section key={s.key} className="tb-slot" aria-label={`Part ${i + 1}`}>
              <div className="tb-slot__top">
                <FormField label={`Part ${i + 1} name`} required>
                  <TextInput value={s.label} disabled={frozen} maxLength={60} placeholder="For example, Laptop" {...inv(sp(s.key, 'label'), `tb-e-${s.key}-label`)}
                    onChange={e => setSlot(s.key, { label: e.target.value })} />
                </FormField>
                <Btn variant="secondary" disabled={frozen} aria-label={`Remove part ${i + 1}`}
                  onClick={() => setD(cur => ({ ...cur, slots: cur.slots.filter(x => x.key !== s.key) }))}>
                  <Trash2 size={14} aria-hidden /> Remove
                </Btn>
              </div>
              <div className="tb-nums">
                {([
                  ['min_pick', 'Pick at least', 'Zero makes the part optional'],
                  ['max_pick', 'Pick at most', ''],
                  ['qty_min', 'Fewest of each', ''],
                  ['qty_max', 'Most of each', ''],
                  ['qty_default', 'Starts at', ''],
                ] as const).map(([k, label, hint]) => (
                  <div key={k}>
                    <FormField label={label} hint={hint || undefined}>
                      <TextInput type="number" min={0} step={1} value={s[k]} disabled={frozen} {...inv(sp(s.key, k), `tb-e-${s.key}-${k}`)}
                        onChange={e => setSlot(s.key, { [k]: num(e.target.value) })} />
                    </FormField>
                    <Err id={`tb-e-${s.key}-${k}`} msg={sp(s.key, k)} />
                  </div>
                ))}
              </div>

              <ul className="tb-opts" aria-label={`Options for ${s.label || `part ${i + 1}`}`}>
                {s.options.length === 0 && <li className="tb-muted">No options yet.</li>}
                {s.options.map(o => {
                  const p = byId.get(o.product_id)
                  return (
                    <li key={o.product_id} className="tb-opt">
                      <span className="tb-opt__name">{nameOf(o.product_id)}{p && <span className="tb-muted"> - {p.seller}</span>}
                        {(!p || p.status !== 'live') && <span className="tb-bad">No longer on sale - remove it before publishing</span>}</span>
                      <label className="tb-check">
                        <input type="checkbox" checked={o.is_default} disabled={frozen}
                          onChange={e => setSlot(s.key, { options: s.options.map(x => (x.product_id === o.product_id ? { ...x, is_default: e.target.checked } : x)) })} />
                        Starting choice
                      </label>
                      <Btn variant="secondary" size="sm" disabled={frozen} aria-label={`Remove ${nameOf(o.product_id)}`}
                        onClick={() => setSlot(s.key, { options: s.options.filter(x => x.product_id !== o.product_id) })}>
                        <Trash2 size={14} aria-hidden />
                      </Btn>
                    </li>
                  )
                })}
              </ul>
              <FormField label="Add an option">
                <Select value="" disabled={frozen || free.length === 0} {...inv(sp(s.key, 'options'), `tb-e-${s.key}-options`)}
                  onChange={e => { if (e.target.value) setSlot(s.key, { options: [...s.options, { product_id: e.target.value, is_default: s.options.length === 0 }] }) }}>
                  <option value="">{free.length === 0 ? 'No live listing left to offer' : 'Choose a live listing...'}</option>
                  {free.map(p => <option key={p.id} value={p.id}>{p.name} - {p.seller}</option>)}
                </Select>
              </FormField>
              <Err id={`tb-e-${s.key}-options`} msg={sp(s.key, 'options')} />
            </section>
          )
        })}

        <Btn variant="secondary" disabled={frozen || d.slots.length >= rule.max_components}
          onClick={() => setD(cur => ({ ...cur, slots: [...cur.slots, newSlot()] }))}>
          <Plus size={14} aria-hidden /> Add a part
        </Btn>

        <TemplatePreview slots={previewSlots} discountPct={d.discount_pct} nameOf={nameOf} />
      </div>
    </Dialog>
  )
}

/** The saveTemplate arguments for a draft. */
export function draftToSave(d: TemplateDraft): [Omit<BundleTemplate, 'id'> & { id?: string }, SlotInput[]] {
  return [
    {
      ...(d.id ? { id: d.id } : {}),
      name: d.name.trim(), description: d.description.trim() || null, image: d.image.trim() || null,
      status: d.status, audiences: d.audiences, discount_pct: d.discount_pct,
    },
    d.slots.map((s, i) => ({
      ...(s.id ? { id: s.id } : {}),
      label: s.label.trim(), min_pick: s.min_pick, max_pick: s.max_pick, qty_min: s.qty_min, qty_max: s.qty_max,
      qty_default: s.qty_default, sort_order: i, options: s.options,
    })),
  ]
}
