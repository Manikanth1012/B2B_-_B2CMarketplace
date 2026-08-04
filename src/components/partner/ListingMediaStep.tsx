/* The media step of the new-listing wizard.
 *
 * It was a dashed rectangle with two buttons on it, both `toast('Image added')`
 * — no file input, no upload, no state. A seller could press Add image six
 * times, be told six times that an image had been added, and submit a listing
 * with no photograph on it.
 *
 * Everything the step already claimed — one to six images, 800px minimum, up to
 * 5 MB each — is now enforced rather than printed. Files upload as they are
 * picked, because "your progress is saved as you go" is written at the bottom
 * of this wizard and was not true of media.
 */
import { useRef, useState } from 'react'
import { Image as ImageIcon, Film, Trash2, Upload } from 'lucide-react'
import { Btn, toast } from '../operator/shared'
import { addListingMedia, removeListingMedia } from '../../lib/listingMediaRepo'
import {
  MAX_IMAGES, MIN_EDGE, IMAGE_MAX_BYTES, IMAGE_TYPES, VIDEO_TYPES,
  mediaOutstanding, ordered,
} from '../../lib/listingMedia'
import type { MediaItem } from '../../lib/listingMedia'

const ACCEPT_IMAGE = IMAGE_TYPES.join(',')
const ACCEPT_VIDEO = VIDEO_TYPES.join(',')

export function ListingMediaStep({ partnerId, draftId, media, onChange }: {
  partnerId: string
  draftId: string
  media: MediaItem[]
  onChange: (next: MediaItem[]) => void
}) {
  const imageInput = useRef<HTMLInputElement>(null)
  const videoInput = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [over, setOver] = useState(false)

  /* One path for every way a file can arrive — the two buttons and the drop
     zone — so a dropped file is validated exactly as a picked one is. */
  const take = async (files: FileList | File[] | null) => {
    if (!files || !files.length) return
    setBusy(true)
    /* Sequential rather than in parallel: each addition is judged against what
       is already there, and six at once would all see an empty list and all
       pass the six-image test. */
    let have = media
    for (const file of Array.from(files)) {
      const res = await addListingMedia({ file, partnerId, draftId, have })
      if (!res.ok) { toast(res.reason, 'error'); continue }
      have = [...have, res.item]
      onChange(have)
    }
    setBusy(false)
  }

  const drop = async (e: React.DragEvent) => {
    e.preventDefault()
    setOver(false)
    await take(e.dataTransfer?.files ?? null)
  }

  const remove = async (item: MediaItem) => {
    const res = await removeListingMedia(item)
    if (!res.ok) { toast(res.reason, 'error'); return }
    onChange(media.filter(m => m.path !== item.path))
  }

  const describe = (item: MediaItem, alt: string) => {
    onChange(media.map(m => m.path === item.path ? { ...m, alt } : m))
  }

  const shots = ordered(media)
  const images = shots.filter(m => m.kind === 'image')
  const outstanding = mediaOutstanding(media)

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
        <span style={{ fontSize: 'var(--text-sm)', fontWeight: 600 }}>Media</span>
        <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
          1 to {MAX_IMAGES} images · {MIN_EDGE}px minimum · up to {IMAGE_MAX_BYTES / 1024 / 1024} MB each
        </span>
      </div>

      {shots.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '12px' }}>
          {shots.map((m, i) => (
            <div key={m.path} style={{
              display: 'flex', gap: '12px', alignItems: 'center', padding: '10px',
              border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', background: 'white',
            }}>
              <div style={{ width: 64, height: 64, flexShrink: 0, borderRadius: 'var(--radius)', overflow: 'hidden', background: 'var(--bg-alt)' }}>
                {m.kind === 'image'
                  ? <img src={m.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                  : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-tertiary)' }}><Film size={22} /></div>}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginBottom: '4px' }}>
                  {m.name}
                  {/* Said rather than left to be discovered — a seller should
                      know which of six photographs became the card. */}
                  {m.kind === 'image' && i === 0 && ' · shown on the card'}
                  {m.kind === 'video' && ' · video'}
                </div>
                <input
                  value={m.alt}
                  onChange={e => describe(m, e.target.value)}
                  placeholder="Describe it — read by anyone who cannot see it"
                  aria-label={`Description of ${m.name}`}
                  style={{
                    width: '100%', padding: '6px 8px', borderRadius: 'var(--radius)',
                    border: `1px solid ${m.alt.trim() ? 'var(--border)' : 'var(--warning)'}`,
                    fontSize: 'var(--text-sm)', outline: 'none', color: 'var(--text)',
                  }}
                />
              </div>
              <button
                onClick={() => remove(m)}
                aria-label={`Remove ${m.name}`}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-tertiary)' }}
              >
                <Trash2 size={16} />
              </button>
            </div>
          ))}
        </div>
      )}

      <div
        onDragOver={e => { e.preventDefault(); setOver(true) }}
        onDragLeave={() => setOver(false)}
        onDrop={drop}
        style={{
          border: `2px dashed ${over ? 'var(--brand-accent)' : 'var(--border)'}`,
          borderRadius: 'var(--radius-md)', padding: '24px', textAlign: 'center',
          background: over ? 'var(--info-bg)' : 'var(--bg-alt)', transition: 'all 120ms ease',
        }}
      >
        <Upload size={24} style={{ color: 'var(--text-tertiary)', margin: '0 auto' }} />
        <div style={{ fontSize: 'var(--text-sm)', marginTop: '8px', color: 'var(--text-secondary)' }}>
          {busy ? 'Uploading…' : 'Drop files here, or add one:'}
        </div>
        <div style={{ display: 'flex', gap: '7px', justifyContent: 'center', marginTop: '10px' }}>
          <Btn variant="secondary" size="sm" disabled={busy || images.length >= MAX_IMAGES}
            onClick={() => imageInput.current?.click()}>
            <ImageIcon size={14} /> Add image
          </Btn>
          <Btn variant="secondary" size="sm" disabled={busy || media.some(m => m.kind === 'video')}
            onClick={() => videoInput.current?.click()}>
            <Film size={14} /> Add video
          </Btn>
        </div>

        {/* The real controls. Hidden because a bare file input cannot be styled
            to match anything, but they are what the buttons above press. */}
        <input
          ref={imageInput} type="file" accept={ACCEPT_IMAGE} multiple hidden
          onChange={e => { void take(e.target.files); e.target.value = '' }}
        />
        <input
          ref={videoInput} type="file" accept={ACCEPT_VIDEO} hidden
          onChange={e => { void take(e.target.files); e.target.value = '' }}
        />
      </div>

      {outstanding.length > 0 && (
        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginTop: '8px' }}>
          Still needs {outstanding.length === 1 ? outstanding[0]
            : `${outstanding.slice(0, -1).join(', ')} and ${outstanding[outstanding.length - 1]}`}.
        </div>
      )}
    </div>
  )
}
