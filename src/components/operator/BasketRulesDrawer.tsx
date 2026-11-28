import { useMemo, useState } from 'react'
import { Drawer } from '../ui/Drawer'
import { Callout } from '../OnboardingJourney'
import { Btn, Table, Td, TextInput, RowActions, toast } from './shared'
import { removeBasketSettings, saveBasketSettings } from '../../lib/remindersRepo'
import type { BasketSettings } from '../../lib/remindersRepo'
import { DEFAULT_BASKET_WINDOW, validateBasketWindow } from '../../lib/reminders'
import type { BasketWindow } from '../../lib/reminders'
import { basketRuleEffect, effectText } from '../../lib/basketRuleEffect'

/* Basket rules (spec 19): when a basket is pending, abandoned and cleared, for
   the default and for each market. Saving writes basket_settings; the audit row
   is written by the database trigger. Before saving, the drawer says what the
   change does to the baskets on screen. */

type Draft = { pending: string; abandoned: string; clear: string }

const toDraft = (w: BasketWindow): Draft => ({
  pending: String(w.pending_days), abandoned: String(w.abandoned_after_days), clear: String(w.clear_after_days),
})
const toWindow = (d: Draft): BasketWindow => ({
  pending_days: Number(d.pending), abandoned_after_days: Number(d.abandoned), clear_after_days: Number(d.clear),
})
const blank = (d: Draft) => [d.pending, d.abandoned, d.clear].some(v => v.trim() === '')

const FIELD_NAME = { pending: 'pending days', abandoned: 'abandoned after days', clear: 'clear after days' } as const

export function BasketRulesDrawer({ open, onClose, settings, baskets, onSaved }: {
  open: boolean
  onClose: () => void
  settings: BasketSettings[]
  /** The baskets on screen, for the effect summary. */
  baskets: readonly { lastChange: string }[]
  onSaved: () => Promise<void> | void
}) {
  const [drafts, setDrafts] = useState<Record<string, Draft>>(
    () => Object.fromEntries(settings.map(s => [s.market, toDraft(s)])))
  const [reset, setReset] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  const rows = useMemo(() => settings.map(s => {
    const d = drafts[s.market] ?? toDraft(s)
    const w = toWindow(d)
    const check = blank(d) ? { ok: false as const, reason: 'Fill in all three numbers' } : validateBasketWindow(w)
    const changed = d.pending !== String(s.pending_days) || d.abandoned !== String(s.abandoned_after_days)
      || d.clear !== String(s.clear_after_days)
    return { s, d, w, check, changed, removed: reset.has(s.market) }
  }), [settings, drafts, reset])

  const invalid = rows.find(r => !r.removed && r.changed && !r.check.ok)
  const dirty = rows.some(r => r.removed || r.changed)

  const dflt = rows.find(r => r.s.market === 'default')
  const effect = useMemo(() => {
    if (!dflt || !dflt.changed || !dflt.check.ok) return null
    return basketRuleEffect(baskets, toWindow(toDraft(dflt.s)), dflt.w, new Date())
  }, [dflt, baskets])
  const marketsChanged = rows.some(r => r.s.market !== 'default' && (r.removed || r.changed))

  const set = (market: string, patch: Partial<Draft>) => {
    setDrafts(d => ({ ...d, [market]: { ...d[market], ...patch } }))
    setProblem(null)
  }

  const save = async () => {
    setBusy(true)
    setProblem(null)
    for (const r of rows) {
      if (r.removed) {
        const res = await removeBasketSettings(r.s.market)
        if (!res.ok) { setBusy(false); setProblem(`${r.s.market}: ${res.error}`); return }
      } else if (r.changed) {
        const res = await saveBasketSettings(r.s.market, r.w)
        if (!res.ok) { setBusy(false); setProblem(`${r.s.market}: ${res.error}`); return }
      }
    }
    setBusy(false)
    toast('Basket rules saved')
    await onSaved()
    onClose()
  }

  const fallback: Draft = toDraft(dflt?.s ?? DEFAULT_BASKET_WINDOW)

  return (
    <Drawer open={open} onClose={onClose} title="Basket rules" width="min(720px, 100vw)"
      description="When a basket is pending, when it counts as abandoned, and when the nightly run clears it. A shopper’s basket takes its market’s rules; a business basket takes its account’s home market."
      footer={<>
        <Btn variant="secondary" size="sm" onClick={onClose}>Cancel</Btn>
        <Btn size="sm" onClick={() => { void save() }} disabled={busy || !dirty || !!invalid}>
          {busy ? 'Saving…' : 'Save rules'}
        </Btn>
      </>}>
      <div className="op-rules">
        <Table headers={[
          'Market',
          { label: 'Pending (days)', align: 'right' },
          { label: 'Abandoned after (days)', align: 'right' },
          { label: 'Clear after (days)', align: 'right' },
          'Actions']}>
          {rows.map(r => {
            const name = r.s.market === 'default' ? 'Default' : r.s.market
            const d = r.removed ? fallback : r.d
            return (
              <tr key={r.s.market}>
                <Td>{name}{r.removed && <div className="op-rules__sub">Back on the default rules</div>}</Td>
                {(['pending', 'abandoned', 'clear'] as const).map(f => (
                  <Td key={f} kind="num">
                    <TextInput type="number" min={1} max={365} className="op-rules__num" value={d[f]} disabled={r.removed}
                      aria-label={`${name} ${FIELD_NAME[f]}`}
                      aria-invalid={!r.removed && r.changed && !r.check.ok ? true : undefined}
                      onChange={e => set(r.s.market, { [f]: e.target.value })} />
                  </Td>
                ))}
                <Td>
                  {r.s.market !== 'default' && (
                    <RowActions label={name} actions={[{
                      id: 'reset', label: r.removed ? 'Keep own rules' : 'Use default', variant: 'tertiary',
                      srOnly: name,
                      onClick: () => setReset(s => {
                        const n = new Set(s)
                        if (n.has(r.s.market)) n.delete(r.s.market); else n.add(r.s.market)
                        return n
                      }),
                    }]} />
                  )}
                </Td>
              </tr>
            )
          })}
        </Table>

        <p className="op-rules__sub">
          Pending is display only: it sets the Pending and Abandoned labels. The nightly clearing uses Clear after.
          Abandoned after must be at least Pending, and Clear after more than Abandoned after; each is 1 to 365 days.
        </p>

        {invalid && !invalid.check.ok && (
          <p role="alert" className="op-rules__refused">
            {invalid.s.market === 'default' ? 'Default' : invalid.s.market}: {invalid.check.reason}
          </p>
        )}
        {problem && <p role="alert" className="op-rules__refused">Not saved: {problem}</p>}

        {effect && (
          <Callout tone="info" title="What this changes">
            <span data-testid="basket-rules-effect">{effectText(effect)}</span>
            {' '}(of {baskets.length} {baskets.length === 1 ? 'basket' : 'baskets'} on screen, on the default rules).
          </Callout>
        )}
        {marketsChanged && (
          <p className="op-rules__sub">
            A market’s change applies to the baskets in that market from tonight’s run.
          </p>
        )}
      </div>
    </Drawer>
  )
}
