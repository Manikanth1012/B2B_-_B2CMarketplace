import { useMemo, useState } from 'react'
import { Drawer } from '../ui/Drawer'
import { Callout } from '../OnboardingJourney'
import { Btn, Select, Table, Td, TextInput, RowActions, toast } from './shared'
import { removeBasketSettings, saveBasketSettings } from '../../lib/remindersRepo'
import type { BasketSettings } from '../../lib/remindersRepo'
import { DEFAULT_BASKET_WINDOW, validateBasketWindow } from '../../lib/reminders'
import type { BasketWindow } from '../../lib/reminders'
import { basketRuleEffect, effectText } from '../../lib/basketRuleEffect'

/* Basket rules (spec 19): when a basket is pending, abandoned and cleared, for
   the default and for each market. Saving writes basket_settings; the audit row
   is written by the database trigger. Before saving, the drawer says what each
   change does to the baskets on screen, market by market. */

type Draft = { pending: string; abandoned: string; clear: string }

const toDraft = (w: BasketWindow): Draft => ({
  pending: String(w.pending_days), abandoned: String(w.abandoned_after_days), clear: String(w.clear_after_days),
})
const toWindow = (d: Draft): BasketWindow => ({
  pending_days: Number(d.pending), abandoned_after_days: Number(d.abandoned), clear_after_days: Number(d.clear),
})
const blank = (d: Draft) => [d.pending, d.abandoned, d.clear].some(v => v.trim() === '')
const same = (a: Draft, b: Draft) => a.pending === b.pending && a.abandoned === b.abandoned && a.clear === b.clear

const FIELD_NAME = { pending: 'pending days', abandoned: 'abandoned after days', clear: 'clear after days' } as const

export function BasketRulesDrawer({ open, onClose, settings, markets, baskets, onSaved }: {
  open: boolean
  onClose: () => void
  settings: BasketSettings[]
  /** Every market's code, for adding rules to one that has none of its own. */
  markets: readonly string[]
  /** The baskets on screen, with their market, for the effect summary. */
  baskets: readonly { lastChange: string; market: string | null }[]
  /** Reload the settings; false when that failed. */
  onSaved: () => Promise<boolean | void> | boolean | void
}) {
  const [drafts, setDrafts] = useState<Record<string, Draft>>(
    () => Object.fromEntries(settings.map(s => [s.market, toDraft(s)])))
  const [reset, setReset] = useState<Set<string>>(new Set())
  const [added, setAdded] = useState<string[]>([])
  const [pick, setPick] = useState('')
  const [busy, setBusy] = useState(false)
  const [problems, setProblems] = useState<string[]>([])
  const [note, setNote] = useState<string | null>(null)

  const dflt = settings.find(s => s.market === 'default')
  const base = dflt ? toWindow(toDraft(dflt)) : DEFAULT_BASKET_WINDOW
  const own = new Set(settings.map(s => s.market))

  /* What the default will be once saved: a market put back on the default, or an unsaved
     market's neighbours, are previewed against it. */
  const dDraft = dflt ? drafts[dflt.market] ?? toDraft(dflt) : null
  const draftBase = dDraft && !blank(dDraft) && validateBasketWindow(toWindow(dDraft)).ok ? toWindow(dDraft) : base

  const rows = useMemo(() => {
    const list = [
      ...settings.map(s => ({ market: s.market, saved: toDraft(s) as Draft | null })),
      ...added.filter(m => !own.has(m)).map(m => ({ market: m, saved: null as Draft | null })),
    ]
    return list.map(({ market, saved }) => {
      const d = drafts[market] ?? saved ?? toDraft(base)
      const w = toWindow(d)
      const check = blank(d) ? { ok: false as const, reason: 'Fill in all three numbers' } : validateBasketWindow(w)
      const removed = saved !== null && reset.has(market)
      const changed = saved === null || !same(d, saved)
      /* The window these baskets were judged by, and the one they would be. */
      const before = saved ? toWindow(saved) : base
      const after = removed ? draftBase : w
      return { market, saved, d, w, check, changed, removed, before, after }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings, added, drafts, reset, draftBase])

  const invalid = rows.filter(r => !r.removed && r.changed && !r.check.ok)
  const dirty = rows.some(r => r.removed || r.changed)
  const name = (m: string) => (m === 'default' ? 'Default' : m)

  /* Per row: the baskets it governs (a market's own; the default's are those in a market with no row of its own). */
  const effects = useMemo(() => rows
    .filter(r => (r.removed || r.changed) && (r.removed || r.check.ok))
    .map(r => {
      const mine = baskets.filter(b => (r.market === 'default'
        ? !own.has(b.market ?? '') && !added.includes(b.market ?? '') : b.market === r.market))
      return { market: r.market, count: mine.length, effect: basketRuleEffect(mine, r.before, r.after, new Date()) }
    }),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [rows, baskets])

  const set = (market: string, patch: Partial<Draft>) => {
    setDrafts(d => ({ ...d, [market]: { ...(d[market] ?? toDraft(base)), ...patch } }))
    setProblems([])
  }

  const addable = markets.filter(m => m !== 'default' && !own.has(m) && !added.includes(m))

  const save = async () => {
    setBusy(true)
    setProblems([])
    setNote(null)
    const failed: string[] = []
    const done: string[] = []
    for (const r of rows) {
      if (r.removed) {
        const res = await removeBasketSettings(r.market)
        if (res.ok) done.push(r.market); else failed.push(`${name(r.market)}: ${res.error}`)
      } else if (r.changed && r.check.ok) {
        const res = await saveBasketSettings(r.market, r.w)
        if (res.ok) done.push(r.market); else failed.push(`${name(r.market)}: ${res.error}`)
      }
    }
    /* Reload even when some rows failed, so the page is not left stale. */
    const reloaded = await onSaved()
    setBusy(false)
    setAdded(a => a.filter(m => !done.includes(m)))
    setReset(s => new Set([...s].filter(m => !done.includes(m))))
    if (failed.length) {
      setProblems(failed)
      setNote(done.length ? `Saved: ${done.map(name).join(', ')}.` : null)
      return
    }
    if (reloaded === false) {
      setNote('Saved, but the rules could not be read back. Reload the page to see them.')
      return
    }
    toast('Basket rules saved')
    onClose()
  }

  const fallback: Draft = toDraft(base)

  return (
    <Drawer open={open} onClose={onClose} title="Basket rules" width="min(720px, 100vw)"
      description="When a basket is pending, when it counts as abandoned, and when the nightly run clears it. A shopper’s basket takes its market’s rules; a business basket takes its account’s home market."
      footer={<>
        <Btn variant="secondary" size="sm" onClick={onClose}>Cancel</Btn>
        <Btn size="sm" onClick={() => { void save() }} disabled={busy || !dirty || invalid.length > 0}>
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
            const d = r.removed ? fallback : r.d
            return (
              <tr key={r.market}>
                <Td>
                  {name(r.market)}
                  {r.removed && <div className="op-rules__sub">Back on the default rules</div>}
                  {r.saved === null && <div className="op-rules__sub">New: not saved yet</div>}
                </Td>
                {(['pending', 'abandoned', 'clear'] as const).map(f => (
                  <Td key={f} kind="num">
                    <TextInput type="number" min={1} max={365} className="op-rules__num" value={d[f]} disabled={r.removed}
                      aria-label={`${name(r.market)} ${FIELD_NAME[f]}`}
                      aria-invalid={!r.removed && r.changed && !r.check.ok ? true : undefined}
                      onChange={e => set(r.market, { [f]: e.target.value })} />
                  </Td>
                ))}
                <Td>
                  {r.market !== 'default' && (
                    <RowActions label={name(r.market)} actions={[r.saved === null
                      ? { id: 'drop', label: 'Cancel', variant: 'tertiary' as const, srOnly: name(r.market),
                          onClick: () => setAdded(a => a.filter(m => m !== r.market)) }
                      : { id: 'reset', label: r.removed ? 'Keep own rules' : 'Use default', variant: 'tertiary' as const,
                          srOnly: name(r.market),
                          onClick: () => setReset(s => {
                            const n = new Set(s)
                            if (n.has(r.market)) n.delete(r.market); else n.add(r.market)
                            return n
                          }) }]} />
                  )}
                </Td>
              </tr>
            )
          })}
        </Table>

        {addable.length > 0 && (
          <div className="op-rules__chipset">
            <Select aria-label="Market to add rules for" value={pick} onChange={e => setPick(e.target.value)}>
              <option value="">Pick a market…</option>
              {addable.map(m => <option key={m} value={m}>{m}</option>)}
            </Select>
            <Btn variant="secondary" size="sm" disabled={!pick}
              onClick={() => { setAdded(a => [...a, pick]); setPick('') }}>Add rules for a market</Btn>
          </div>
        )}

        <p className="op-rules__sub">
          Pending is display only: it sets the Pending and Abandoned labels. The nightly clearing uses Clear after.
          Abandoned after must be at least Pending, and Clear after more than Abandoned after; each is 1 to 365 days.
          A market with no rules of its own uses the default.
        </p>

        {invalid.length > 0 && (
          <div role="alert" className="op-rules__refused">
            <ul className="op-rules__list">
              {invalid.map(r => !r.check.ok && <li key={r.market}>{name(r.market)}: {r.check.reason}</li>)}
            </ul>
          </div>
        )}
        {problems.length > 0 && (
          <div role="alert" className="op-rules__refused">
            Not saved:
            <ul className="op-rules__list">{problems.map(p => <li key={p}>{p}</li>)}</ul>
          </div>
        )}
        {note && <p role="status" className="op-rules__sub">{note}</p>}

        {effects.length > 0 && (
          <Callout tone="info" title="What this changes">
            <ul className="op-rules__list">
              {effects.map(e => (
                <li key={e.market}>
                  <strong>{name(e.market)}</strong> ({e.count} {e.count === 1 ? 'basket' : 'baskets'} on screen):{' '}
                  <span data-testid={`basket-rules-effect-${e.market}`}>{effectText(e.effect)}</span>
                </li>
              ))}
            </ul>
          </Callout>
        )}
      </div>
    </Drawer>
  )
}
