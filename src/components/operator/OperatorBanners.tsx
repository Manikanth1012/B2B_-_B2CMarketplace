import { useState, useEffect, useCallback, useMemo } from 'react'
import { Plus, Pause, Play, Trash2, Pencil, TriangleAlert, Image as ImageIcon, ExternalLink } from 'lucide-react'
import {
  SectionCard, EmptyState, Btn, Modal, FormField, TextInput, Select,
  Table, Td, toast, fmtInt, fmtMoney, StatCard,
} from './shared'
import { Callout } from '../OnboardingJourney'
import { loadBanners, saveBanner, setBannerStatus, deleteBanner } from '../../lib/bannerRepo'
import type { BannerSnapshot } from '../../lib/bannerRepo'
import {
  checkArtwork, occupancy, scheduleDrift, validateBanner, bannerWarnings,
  metrics, destinationLabel, AUDIENCES, DESTINATIONS,
} from '../../lib/banners'
import type { BannerRow, BannerSlot, BannerDraft, Dimensions, ArtworkVerdict } from '../../lib/banners'
import { BANNERS as LIBRARY } from '../../lib/assets'

/* Merchandising. A banner occupies a slot with a size and a capacity, competes
   for the rotation by weight, points somewhere and runs between two dates —
   every one of which can be wrong in a way nobody notices until it is live to
   everybody. So the console shows the thing itself while it is being written. */

const ACTOR = 'Marketplace operations'
const today = () => new Date().toISOString().slice(0, 10)

const STATUS_INK: Record<string, string> = {
  live: 'var(--success)', scheduled: 'var(--info, #2a78d6)', draft: 'var(--text-tertiary)',
  paused: 'var(--warning)', ended: 'var(--text-tertiary)',
}

export function OperatorBanners() {
  const [snap, setSnap] = useState<BannerSnapshot | null>(null)
  const [tab, setTab] = useState<'banners' | 'slots'>('banners')
  const [editing, setEditing] = useState<BannerRow | 'new' | null>(null)

  const reload = useCallback(async () => setSnap(await loadBanners()), [])
  useEffect(() => { void reload() }, [reload])

  const act = async (fn: () => Promise<{ ok: boolean; reason?: string; note?: string }>, ok: string) => {
    const res = await fn()
    if (!res.ok) { toast(res.reason ?? 'That did not work', 'error'); return false }
    toast(res.note ?? ok)
    await reload()
    return true
  }

  if (!snap) return <div style={{ textAlign: 'center', padding: '40px' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>

  const productName = (id: string) => snap.products.find(p => p.id === id)?.name

  const live = snap.banners.filter(b => b.status === 'live')
  const drift = snap.banners.map(b => ({ b, why: scheduleDrift(b, today()) })).filter(x => x.why)
  const over = snap.slots.map(s => occupancy(s, snap.banners)).filter(o => o.over)

  const totalImpressions = snap.banners.reduce((n, b) => n + b.impressions, 0)
  const totalClicks = snap.banners.reduce((n, b) => n + b.clicks, 0)
  const totalRevenue = snap.banners.reduce((n, b) => n + Number(b.revenue), 0)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '16px', flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 800, color: 'var(--text)' }}>Storefront banners</h1>
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)', marginTop: '4px' }}>
            {live.length} live across {snap.slots.length} slots · {snap.banners.length} in total
          </p>
        </div>
        <Btn onClick={() => setEditing('new')}><Plus size={14} /> New banner</Btn>
      </div>

      {snap.loadError && <Callout tone="danger" title="Some of this screen did not load">{snap.loadError}</Callout>}

      {/* Named rather than counted. A banner whose state contradicts its own
          dates shows nothing while claiming to be live, which is the kind of
          thing that goes unnoticed for a quarter. */}
      {drift.length > 0 && (
        <Callout tone="warning" title={`${drift.length} banner${drift.length === 1 ? '' : 's'} disagree${drift.length === 1 ? 's' : ''} with its own schedule`}>
          {drift.map(({ b, why }) => (
            <div key={b.id} style={{ marginTop: '3px' }}><strong>{b.name ?? b.title}</strong> — {why}</div>
          ))}
        </Callout>
      )}
      {over.map(o => (
        <Callout key={o.slot.id} tone="danger" title={`${o.slot.label} is over capacity`}>
          {o.running} banners are competing for {o.max} places. The rotation is so thin that none of them
          is seen twice by the same person — pause one.
        </Callout>
      ))}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: '12px' }}>
        <StatCard label="Live now" value={String(live.length)}
                  sublabel={`${snap.banners.filter(b => b.status === 'draft').length} drafts, ${snap.banners.filter(b => b.status === 'scheduled').length} scheduled`} />
        <StatCard label="Impressions" value={fmtInt(totalImpressions)} sublabel="Across every banner ever run" />
        <StatCard label="Click-through" value={totalImpressions === 0 ? '—' : `${Math.round((totalClicks / totalImpressions) * 1000) / 10}%`}
                  sublabel={`${fmtInt(totalClicks)} clicks`} />
        <StatCard label="Attributed revenue" value={`$${fmtMoney(totalRevenue)}`}
                  sublabel="Orders that began with a banner" color="var(--success)" />
      </div>

      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
        {([['banners', `Banners (${snap.banners.length})`], ['slots', `Slots (${snap.slots.length})`]] as const).map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)} style={{
            padding: '8px 15px', borderRadius: 'var(--radius)', cursor: 'pointer',
            fontSize: 'var(--text-sm)', fontWeight: 600, border: '1px solid var(--border)',
            background: tab === id ? 'var(--brand-navy)' : 'white',
            color: tab === id ? 'white' : 'var(--text-secondary)',
          }}>{label}</button>
        ))}
      </div>

      {tab === 'slots' && (
        <SectionCard title="Where advertising may run"
                     subtitle="A slot decides the artwork size, how many banners share it, and whether it can target a person at all">
          <div style={{ padding: '14px 20px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {snap.slots.map(s => {
              const o = occupancy(s, snap.banners)
              return (
                <div key={s.id} style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
                  <div style={{ display: 'flex', gap: '10px', alignItems: 'center', padding: '10px 13px', background: 'var(--bg-alt)', flexWrap: 'wrap' }}>
                    <strong style={{ fontSize: 'var(--text-sm)' }}>{s.label}</strong>
                    <span style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>{s.surface}</span>
                    <span style={{ marginLeft: 'auto', fontSize: '11px', fontWeight: 700, fontFamily: 'ui-monospace, monospace' }}>
                      {s.width}×{s.height}
                    </span>
                    <span style={{
                      fontSize: '10px', fontWeight: 700, padding: '2px 8px', borderRadius: 'var(--radius-full)',
                      background: o.over ? 'var(--danger-bg)' : 'white',
                      color: o.over ? 'var(--danger)' : 'var(--text-secondary)',
                    }}>
                      {o.running} of {o.max} in rotation
                    </span>
                    {!s.personal_targeting && (
                      <span style={{ fontSize: '10px', fontWeight: 700, color: 'var(--warning)' }}>No personal targeting</span>
                    )}
                  </div>
                  <div style={{ padding: '10px 13px', fontSize: '11px', color: 'var(--text-secondary)' }}>{s.note}</div>
                  {o.share.length > 0 && (
                    <div style={{ padding: '0 13px 11px' }}>
                      <div style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.03em', color: 'var(--text-tertiary)', marginBottom: '5px' }}>
                        Share of the rotation
                      </div>
                      {o.share.map(x => (
                        <div key={x.id} style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '3px' }}>
                          <span style={{ fontSize: '11px', flex: 1, minWidth: 0 }}>{x.name}</span>
                          <div style={{ width: '120px', height: '6px', borderRadius: '3px', background: 'var(--border-light)', overflow: 'hidden' }}>
                            <div style={{ width: `${x.pct}%`, height: '100%', background: 'var(--brand-navy)' }} />
                          </div>
                          <span style={{ fontSize: '10px', width: '38px', textAlign: 'right', color: 'var(--text-secondary)' }}>{x.pct}%</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </SectionCard>
      )}

      {tab === 'banners' && snap.slots.map(s => {
        const mine = snap.banners.filter(b => b.slot === s.id)
        if (mine.length === 0) return null
        return (
          <SectionCard key={s.id} title={s.label}
                       subtitle={`${s.width}×${s.height} · ${occupancy(s, snap.banners).running} of ${s.max_banners} in rotation`}>
            <Table headers={['Banner', 'Audience', 'Schedule', 'Weight', 'Seen', 'CTR', 'Revenue', 'State', '']}>
              {mine.map(b => {
                const m = metrics(b)
                return (
                  <tr key={b.id}>
                    <Td>
                      <div style={{ display: 'flex', gap: '9px', alignItems: 'center' }}>
                        {b.image_url
                          ? <img src={b.image_url} alt="" style={{ width: '64px', height: '30px', objectFit: 'cover', borderRadius: 'var(--radius-sm)', flexShrink: 0 }} />
                          : <div style={{ width: '64px', height: '30px', borderRadius: 'var(--radius-sm)', background: 'var(--danger-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                              <ImageIcon size={13} style={{ color: 'var(--danger)' }} />
                            </div>}
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontWeight: 700, fontSize: 'var(--text-xs)' }}>{b.name ?? b.title}</div>
                          <div style={{ fontSize: '10px', color: 'var(--text-tertiary)' }}>
                            <ExternalLink size={9} style={{ display: 'inline', verticalAlign: '-1px' }} />{' '}
                            {destinationLabel(b, productName)}
                          </div>
                        </div>
                      </div>
                    </Td>
                    <Td><span style={{ fontSize: '11px' }}>{b.audience}</span>
                        <div style={{ fontSize: '10px', color: 'var(--text-tertiary)' }}>{b.region}</div></Td>
                    <Td><span style={{ fontSize: '10px', color: 'var(--text-tertiary)' }}>
                      {b.starts_at ?? '—'} → {b.ends_at ?? 'open'}
                    </span></Td>
                    <Td right>{b.weight}</Td>
                    <Td right>{b.impressions === 0 ? '—' : fmtInt(b.impressions)}</Td>
                    <Td right>{m.ctr === null ? '—' : `${m.ctr}%`}</Td>
                    <Td right>{Number(b.revenue) === 0 ? '—' : `$${fmtMoney(Number(b.revenue))}`}</Td>
                    <Td>
                      <span style={{ fontSize: '10px', fontWeight: 800, color: STATUS_INK[b.status] }}>{b.status}</span>
                    </Td>
                    <Td>
                      <div style={{ display: 'flex', gap: '4px' }}>
                        <Btn size="sm" variant="secondary" onClick={() => setEditing(b)}><Pencil size={12} /></Btn>
                        {b.status === 'live'
                          ? <Btn size="sm" variant="secondary" title="Pause"
                                 onClick={() => act(() => setBannerStatus({ id: b.id, status: 'paused', actor: ACTOR }), 'Paused')}><Pause size={12} /></Btn>
                          : (b.status === 'paused' || b.status === 'draft') &&
                            <Btn size="sm" variant="secondary" title="Set live"
                                 onClick={() => act(() => setBannerStatus({ id: b.id, status: 'live', actor: ACTOR }), 'Live')}><Play size={12} /></Btn>}
                        {b.impressions === 0 && (
                          <Btn size="sm" variant="danger" title="Delete"
                               onClick={() => act(() => deleteBanner({ id: b.id, actor: ACTOR }), 'Deleted')}><Trash2 size={12} /></Btn>
                        )}
                      </div>
                    </Td>
                  </tr>
                )
              })}
            </Table>
          </SectionCard>
        )
      })}

      {tab === 'banners' && snap.banners.length === 0 && <EmptyState message="No banners yet" />}

      {editing && (
        <BannerEditor
          snap={snap}
          banner={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSave={async (draft, artwork) => {
            const done = await act(
              () => saveBanner({ draft, artwork, actor: ACTOR, editingId: editing === 'new' ? undefined : editing.id }),
              'Saved')
            if (done) setEditing(null)
          }}
        />
      )}
    </div>
  )
}

/* ------------------------------------------------------------- preview --- */

/** The banner as it will render, at the slot's own aspect ratio. This is the
    whole reason the editor is a dialog rather than a row of inputs: the copy,
    the artwork and the accent only make sense together, and finding that out
    after publishing means finding out from a customer. */
export function BannerPreview({ draft, slot, width = 520 }: {
  draft: Pick<BannerDraft, 'title' | 'subtitle' | 'cta' | 'accent' | 'image_url' | 'alt'>
  slot: BannerSlot | undefined
  width?: number
}) {
  const ratio = slot ? slot.height / slot.width : 0.22
  const height = Math.round(width * ratio)
  const accent = draft.accent ?? '#1b3a6b'

  return (
    <div style={{
      width: '100%', maxWidth: `${width}px`, height: `${height}px`,
      borderRadius: 'var(--radius-md)', overflow: 'hidden', position: 'relative',
      background: accent, border: '1px solid var(--border)', flexShrink: 0,
    }}>
      {draft.image_url && (
        <img src={draft.image_url} alt={draft.alt || ''}
             style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
      )}
      {/* A scrim in the accent, so the copy stays legible whatever the
          photograph is doing behind it. Without one, white text on a bright
          picture is unreadable exactly where the offer is. */}
      <div style={{
        position: 'absolute', inset: 0,
        background: `linear-gradient(90deg, ${accent}f2 0%, ${accent}cc 45%, ${accent}33 100%)`,
      }} />
      <div style={{
        position: 'absolute', inset: 0, padding: `${Math.max(10, height * 0.12)}px`,
        display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: '4px',
      }}>
        <div style={{
          color: 'white', fontWeight: 800, lineHeight: 1.15,
          fontSize: `${Math.max(12, Math.round(height * 0.155))}px`, maxWidth: '68%',
        }}>{draft.title || 'Your headline'}</div>
        {draft.subtitle && (
          <div style={{
            color: 'rgba(255,255,255,0.86)', lineHeight: 1.25,
            fontSize: `${Math.max(9, Math.round(height * 0.095))}px`, maxWidth: '62%',
          }}>{draft.subtitle}</div>
        )}
        {draft.cta && (
          <div style={{ marginTop: '5px' }}>
            <span style={{
              display: 'inline-block', background: 'white', color: accent,
              fontWeight: 700, borderRadius: 'var(--radius-full)',
              padding: `${Math.max(3, height * 0.035)}px ${Math.max(9, height * 0.075)}px`,
              fontSize: `${Math.max(9, Math.round(height * 0.09))}px`,
            }}>{draft.cta}</span>
          </div>
        )}
      </div>
    </div>
  )
}

/* -------------------------------------------------------------- editor --- */

function BannerEditor({ snap, banner, onClose, onSave }: {
  snap: BannerSnapshot
  banner: BannerRow | null
  onClose: () => void
  onSave: (draft: BannerDraft, artwork: ArtworkVerdict | null) => void
}) {
  const [draft, setDraft] = useState<BannerDraft>(() => ({
    name: banner?.name ?? '', slot: banner?.slot ?? snap.slots[0]?.id ?? '',
    title: banner?.title ?? '', subtitle: banner?.subtitle ?? '', cta: banner?.cta ?? 'Shop now',
    audience: banner?.audience ?? 'all', region: banner?.region ?? 'India', device: banner?.device ?? 'all',
    weight: banner?.weight ?? 50, status: banner?.status ?? 'draft',
    starts_at: banner?.starts_at ?? null, ends_at: banner?.ends_at ?? null,
    destination: banner?.destination ?? 'retail', destination_ref: banner?.destination_ref ?? null,
    accent: banner?.accent ?? '#1b3a6b', image_url: banner?.image_url ?? null, alt: banner?.alt ?? '',
  }))
  /* Measured from the file the browser actually loaded, not declared by hand.
     A size somebody typed is a size nobody checked. */
  const [dims, setDims] = useState<Dimensions | null>(null)

  const set = <K extends keyof BannerDraft>(k: K, v: BannerDraft[K]) => setDraft(d => ({ ...d, [k]: v }))

  const slot = snap.slots.find(s => s.id === draft.slot)

  useEffect(() => {
    if (!draft.image_url) { setDims(null); return }
    const img = new Image()
    let alive = true
    img.onload = () => { if (alive) setDims({ width: img.naturalWidth, height: img.naturalHeight }) }
    img.onerror = () => { if (alive) setDims({ width: 0, height: 0 }) }
    img.src = draft.image_url
    return () => { alive = false }
  }, [draft.image_url])

  const artwork = useMemo(
    () => slot ? checkArtwork(draft.image_url ? dims : null, slot) : null,
    [draft.image_url, dims, slot])

  const problem = validateBanner(draft, slot, artwork, snap.slots, snap.banners, today(), banner?.id)
  const warnings = bannerWarnings(draft, slot, artwork, snap.banners, banner?.id)

  return (
    <Modal open onClose={onClose} title={banner ? `Edit ${banner.name ?? banner.title}` : 'New banner'}
      footer={<>
        <Btn variant="secondary" size="sm" onClick={onClose}>Cancel</Btn>
        <Btn size="sm" disabled={!!problem} onClick={() => onSave(draft, artwork)}>
          {draft.status === 'draft' ? 'Save draft' : `Save and set ${draft.status}`}
        </Btn>
      </>}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        {/* The preview first, because it is the thing being made. */}
        <div>
          <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600, marginBottom: '6px' }}>
            Preview
            {slot && <span style={{ fontWeight: 400, color: 'var(--text-tertiary)' }}>
              {' '}· {slot.label} at {slot.width}×{slot.height}
            </span>}
          </div>
          <BannerPreview draft={draft} slot={slot} />
        </div>

        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 200px' }}>
            <FormField label="Name" required hint="What you call it internally.">
              <TextInput value={draft.name} onChange={e => set('name', e.target.value)} placeholder="e.g. Diwali device sale" />
            </FormField>
          </div>
          <div style={{ flex: '0 1 190px' }}>
            <FormField label="Slot" required>
              <Select value={draft.slot} onChange={e => set('slot', e.target.value)}>
                {snap.slots.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
              </Select>
            </FormField>
          </div>
        </div>

        {slot && <Callout tone={slot.personal_targeting ? 'info' : 'warning'}>{slot.note}</Callout>}

        <FormField label="Headline" required hint="What a reader sees.">
          <TextInput value={draft.title} onChange={e => set('title', e.target.value)} />
        </FormField>
        <FormField label="Supporting line">
          <TextInput value={draft.subtitle} onChange={e => set('subtitle', e.target.value)} />
        </FormField>

        {/* ---- artwork ---- */}
        <div>
          <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600, marginBottom: '4px' }}>Artwork</div>
          <p style={{ fontSize: '11px', color: 'var(--text-tertiary)', margin: '0 0 7px' }}>
            {slot ? `${slot.label} wants ${slot.width}×${slot.height}. ` : ''}
            Pick from the marketplace library or give a path. Whatever you choose is measured and checked
            against the slot before it can run.
          </p>
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '8px' }}>
            {LIBRARY.map(url => (
              <button key={url} onClick={() => set('image_url', url)}
                      aria-label={`Use ${url.split('/').pop()}`}
                      style={{
                        padding: 0, border: draft.image_url === url ? '2px solid var(--brand-navy)' : '1px solid var(--border)',
                        borderRadius: 'var(--radius-sm)', cursor: 'pointer', background: 'none', lineHeight: 0,
                      }}>
                <img src={url} alt="" style={{ width: '72px', height: '34px', objectFit: 'cover', borderRadius: '3px' }} />
              </button>
            ))}
          </div>
          <TextInput value={draft.image_url ?? ''} onChange={e => set('image_url', e.target.value || null)}
                     placeholder="/assets/mp/banner-01.webp" />
          {artwork && (
            <div style={{
              marginTop: '6px', fontSize: '11px', fontWeight: 600,
              color: artwork.blocking ? 'var(--danger)' : /under size/.test(artwork.message) ? 'var(--warning)' : 'var(--success)',
            }}>
              {artwork.blocking && <TriangleAlert size={12} style={{ display: 'inline', verticalAlign: '-2px', marginRight: '4px' }} />}
              {artwork.message}
            </div>
          )}
        </div>

        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 220px' }}>
            <FormField label="Describe the artwork" hint="Read aloud instead of the picture.">
              <TextInput value={draft.alt} onChange={e => set('alt', e.target.value)} />
            </FormField>
          </div>
          <div style={{ flex: '0 1 130px' }}>
            <FormField label="Accent">
              <input type="color" value={draft.accent ?? '#1b3a6b'}
                     onChange={e => set('accent', e.target.value)}
                     aria-label="Accent colour"
                     style={{ width: '100%', height: '34px', border: '1px solid var(--border)', borderRadius: 'var(--radius)', cursor: 'pointer', background: 'white' }} />
            </FormField>
          </div>
        </div>

        {/* ---- where the click goes ---- */}
        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
          <div style={{ flex: '0 1 150px' }}>
            <FormField label="Button label" required>
              <TextInput value={draft.cta} onChange={e => set('cta', e.target.value)} />
            </FormField>
          </div>
          <div style={{ flex: '0 1 170px' }}>
            <FormField label="Opens" required>
              <Select value={draft.destination ?? ''} onChange={e => set('destination', e.target.value || null)}>
                <option value="">Choose…</option>
                {DESTINATIONS.map(d => <option key={d} value={d}>{d}</option>)}
              </Select>
            </FormField>
          </div>
          <div style={{ flex: '1 1 220px' }}>
            <FormField label="A specific product" hint="Optional. Otherwise it opens the page itself.">
              <Select value={draft.destination_ref ?? ''} onChange={e => set('destination_ref', e.target.value || null)}>
                <option value="">The page on its own</option>
                {snap.products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </Select>
            </FormField>
          </div>
        </div>

        {/* ---- who, when, how much ---- */}
        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
          <div style={{ flex: '0 1 175px' }}>
            <FormField label="Audience">
              <Select value={draft.audience} onChange={e => set('audience', e.target.value)}>
                {AUDIENCES.map(a => <option key={a} value={a}>{a}</option>)}
              </Select>
            </FormField>
          </div>
          <div style={{ flex: '0 1 150px' }}>
            <FormField label="Region">
              <TextInput value={draft.region} onChange={e => set('region', e.target.value)} />
            </FormField>
          </div>
          <div style={{ flex: '0 1 120px' }}>
            <FormField label="Weight" hint="Share of the rotation.">
              <TextInput type="number" value={String(draft.weight)}
                         onChange={e => set('weight', parseInt(e.target.value) || 0)} />
            </FormField>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
          <div style={{ flex: '0 1 150px' }}>
            <FormField label="Starts">
              <TextInput type="date" value={draft.starts_at ?? ''} onChange={e => set('starts_at', e.target.value || null)} />
            </FormField>
          </div>
          <div style={{ flex: '0 1 150px' }}>
            <FormField label="Ends">
              <TextInput type="date" value={draft.ends_at ?? ''} onChange={e => set('ends_at', e.target.value || null)} />
            </FormField>
          </div>
          <div style={{ flex: '0 1 150px' }}>
            <FormField label="State">
              <Select value={draft.status} onChange={e => set('status', e.target.value as BannerDraft['status'])}>
                {(['draft', 'scheduled', 'live', 'paused', 'ended'] as const).map(s => <option key={s} value={s}>{s}</option>)}
              </Select>
            </FormField>
          </div>
        </div>

        {warnings.map((w, i) => <Callout key={i} tone="warning">{w}</Callout>)}
        {problem
          ? <Callout tone="danger" title="Not ready">{problem}</Callout>
          : <Callout tone="success">
              Ready. {draft.status === 'draft'
                ? 'Saving it as a draft puts nothing on the site.'
                : `It will run on ${slot?.label} and the button opens ${destinationLabel(draft, id => snap.products.find(p => p.id === id)?.name)}.`}
            </Callout>}
      </div>
    </Modal>
  )
}
