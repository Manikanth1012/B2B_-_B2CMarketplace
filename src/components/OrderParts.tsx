import { Package, Truck, Check, Clock, Zap, TriangleAlert as AlertTriangle } from 'lucide-react'
import { RAIL, labelFor, progressOf, onRail } from '../lib/orderParts'
import type { Part, FulfilKind } from '../lib/orderParts'

/* The parts of an order, each on its own journey.
 *
 * An order used to draw one rail from `orders.stages`. On a basket of a handset
 * and an eSIM that rail is one of the two journeys the order is actually on,
 * printed over both halves — so the eSIM appeared to be waiting for a van and
 * the handset appeared to be provisioning.
 *
 * One rail per part. A single-part order draws one, which is what it always
 * drew; a mixed one draws two and stops lying about one of them.
 */

const KIND_ICON: Record<FulfilKind, typeof Package> = {
  shipped: Truck, instant: Zap, esim: Zap, provisioned: Package, activation: Package,
}

const KIND_NOUN: Record<FulfilKind, string> = {
  shipped: 'Shipped', instant: 'Instant', esim: 'eSIM',
  provisioned: 'Provisioned', activation: 'Activation',
}

export function OrderParts({ parts, showSeller = true }: {
  parts: readonly Part[]
  /* Off on a seller's own screen, where every part on show is theirs and the
     name would be the same word repeated down the page. */
  showSeller?: boolean
}) {
  if (parts.length === 0) return null
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
      {parts.map(p => <PartRail key={p.id} part={p} showSeller={showSeller} />)}
    </div>
  )
}

function PartRail({ part, showSeller }: { part: Part; showSeller: boolean }) {
  const rail = RAIL[part.kind] ?? RAIL.instant
  const { at } = progressOf(part)
  const off = !onRail(part)
  const Icon = KIND_ICON[part.kind] ?? Package
  const bad = part.state === 'failed'

  return (
    <div style={{
      border: `1px solid ${bad ? 'var(--danger)' : 'var(--border-light)'}`,
      borderRadius: 'var(--radius)', padding: '10px 12px',
      background: bad ? 'var(--danger-bg)' : 'transparent',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginBottom: off ? 0 : '10px' }}>
        <Icon size={14} style={{ color: 'var(--text-tertiary)', flexShrink: 0 }} />
        <span style={{ fontSize: 'var(--text-xs)', fontWeight: 700 }}>
          {KIND_NOUN[part.kind] ?? part.kind}
        </span>
        {showSeller && (
          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
            from {part.seller}
          </span>
        )}
        <span style={{
          marginLeft: 'auto', fontSize: 'var(--text-xs)', fontWeight: 600,
          color: bad ? 'var(--danger)' : 'var(--text-secondary)',
        }}>
          {labelFor(part)}
        </span>
      </div>

      {/* A part that failed or was refunded is not partway along a road, so it
          gets a sentence rather than a rail with an arbitrary position on it. */}
      {off ? (
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center', fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', marginTop: '6px' }}>
          <AlertTriangle size={12} style={{ color: bad ? 'var(--danger)' : 'var(--warning)', flexShrink: 0 }} />
          {bad
            ? 'This part could not be fulfilled. Nothing else on the order is affected.'
            : 'This part was refunded.'}
        </div>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center' }}>
          {rail.map((state, i) => {
            const done = i <= at
            const last = i === rail.length - 1
            return (
              <div key={state} style={{ display: 'flex', alignItems: 'center', flex: last ? '0 0 auto' : '1 1 0' }}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '3px', flexShrink: 0 }}>
                  <div style={{
                    width: '20px', height: '20px', borderRadius: '50%',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: done ? 'var(--brand-accent)' : 'var(--bg-alt)',
                    color: done ? 'white' : 'var(--text-tertiary)',
                  }}>
                    {done ? <Check size={11} /> : <Clock size={11} />}
                  </div>
                  <span style={{
                    fontSize: '10px', whiteSpace: 'nowrap',
                    fontWeight: i === at ? 700 : 400,
                    color: done ? 'var(--text)' : 'var(--text-tertiary)',
                  }}>
                    {labelFor({ kind: part.kind, state })}
                  </span>
                </div>
                {!last && (
                  <div style={{
                    flex: 1, height: '2px', margin: '0 4px', marginBottom: '14px',
                    background: i < at ? 'var(--brand-accent)' : 'var(--border-light)',
                  }} />
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Carriage belongs to the part that ships, and to no other. The header
          used to carry one tracking number for the whole order — on a mixed
          basket it was the handset's, printed under the eSIM as well. */}
      {part.tracking_ref && (
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center', fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginTop: '8px' }}>
          <Truck size={12} /> {part.carrier} · {part.tracking_ref}
        </div>
      )}
    </div>
  )
}
