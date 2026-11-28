/**
 * What changing the basket rules would do to the baskets on screen, computed
 * on the client from the baskets already loaded (spec 19). Pure.
 */
import { addDays, basketStateFor, clearsOn, utcDay } from './reminders'
import type { BasketWindow } from './reminders'

export interface RuleEffect { becomeAbandoned: number; becomePending: number; clearedTonight: number }

/**
 * Baskets that change side between `before` and `after`, judged on `today`:
 * Pending to Abandoned, Abandoned to Pending, and those the coming night would
 * clear that the old rules would not (the night that clears a basket is
 * clearsOn: day of last change + clear after + 1, as basket_anchor; the coming night runs as of tomorrow).
 */
export function basketRuleEffect(baskets: readonly { lastChange: string }[], before: BasketWindow,
  after: BasketWindow, today: Date): RuleEffect {
  /* The coming night runs with p_as_of = tomorrow and clears where clearsOn <= that day. */
  const day = utcDay(today)
  const night = day ? addDays(day, 1) : null
  let becomeAbandoned = 0, becomePending = 0, clearedTonight = 0
  for (const b of baskets) {
    const was = basketStateFor(b.lastChange, before, today) !== 'pending'
    const is = basketStateFor(b.lastChange, after, today) !== 'pending'
    if (!was && is) becomeAbandoned++
    if (was && !is) becomePending++
    const c0 = clearsOn(b.lastChange, before), c1 = clearsOn(b.lastChange, after)
    if (night && c1 && c1 <= night && !(c0 && c0 <= night)) clearedTonight++
  }
  return { becomeAbandoned, becomePending, clearedTonight }
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/** '12 baskets become abandoned, 3 would be cleared tonight'; says so when nothing moves. */
export function effectText(e: RuleEffect): string {
  const parts: string[] = []
  if (e.becomeAbandoned) parts.push(`${plural(e.becomeAbandoned, 'basket becomes', 'baskets become')} abandoned`)
  if (e.becomePending) parts.push(`${plural(e.becomePending, 'basket becomes', 'baskets become')} pending again`)
  if (e.clearedTonight) parts.push(`${e.clearedTonight} would be cleared tonight`)
  return parts.length ? parts.join(', ') : 'No basket changes state, and none would be cleared tonight'
}
