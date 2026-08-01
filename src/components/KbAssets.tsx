import { FileText, FileSpreadsheet, BookOpen, Play, Download, Newspaper } from 'lucide-react'
import { assetsByKind, assetMeta } from '../lib/kb'
import type { KbAsset, KbAssetKind } from '../lib/kb'
import { assetUrl } from '../lib/kbRepo'

/* The files that go with an article — the manual, the datasheet, the brochure,
   the walkthrough, the spreadsheet template.
 *
 * These are published documents in a public bucket, so the link is a plain URL
 * rather than a signed one: it keeps working when somebody forwards it to the
 * engineer who is actually holding the sensor, which is the whole point of
 * publishing a manual.
 */

const ICONS: Record<KbAssetKind, typeof FileText> = {
  manual: BookOpen,
  datasheet: FileText,
  brochure: Newspaper,
  video: Play,
  template: FileSpreadsheet,
  other: FileText,
}

export function KbAssets({ assets }: { assets: KbAsset[] }) {
  if (!assets.length) return null
  const groups = assetsByKind(assets)

  return (
    <div style={{ borderTop: '1px solid var(--border-light)', paddingTop: '16px' }}>
      <div style={{
        fontSize: 'var(--text-xs)', fontWeight: 700, color: 'var(--text-tertiary)',
        textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '4px',
      }}>
        Downloads
      </div>
      <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', margin: '0 0 12px' }}>
        Everything here opens in a new tab and can be forwarded — a manual is no use on the screen of
        whoever is not holding the thing.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
        {groups.map(g => (
          <div key={g.kind}>
            <div style={{ fontSize: 'var(--text-xs)', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: '8px' }}>
              {g.label}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '10px' }}>
              {g.assets.map(a => {
                const Icon = ICONS[a.kind] ?? FileText
                const href = assetUrl(a)
                return (
                  <a
                    key={a.id}
                    href={href ?? undefined}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-disabled={!href}
                    style={{
                      display: 'flex', gap: '12px', alignItems: 'flex-start',
                      padding: '12px 14px', borderRadius: 'var(--radius)',
                      border: '1px solid var(--border-light)', background: 'var(--bg-alt)',
                      textDecoration: 'none', color: 'inherit',
                      cursor: href ? 'pointer' : 'not-allowed', opacity: href ? 1 : 0.5,
                    }}
                  >
                    <span style={{
                      width: '34px', height: '34px', borderRadius: 'var(--radius)', flexShrink: 0,
                      background: a.kind === 'video' ? 'var(--brand-navy)' : 'white',
                      border: a.kind === 'video' ? 'none' : '1px solid var(--border)',
                      color: a.kind === 'video' ? 'white' : 'var(--brand-accent-dark)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      <Icon size={16} />
                    </span>

                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: 'block', fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--text)' }}>
                        {a.title}
                      </span>
                      <span style={{ display: 'block', fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', marginTop: '3px', lineHeight: 1.5 }}>
                        {a.description}
                      </span>
                      <span style={{
                        display: 'block', marginTop: '6px',
                        fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', fontWeight: 600,
                      }}>
                        <Download size={11} style={{ verticalAlign: '-1px', marginRight: '5px' }} />
                        {assetMeta(a)}
                      </span>
                    </span>
                  </a>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
