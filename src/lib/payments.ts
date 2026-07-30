/* Payment-method rules, pure. */

export interface PaymentMethodRow {
  status: string
  expires: string | null
  is_primary: boolean
}

/* Cards carry `expires` as 'MM/YY'. A card that has passed that month still sits in
   the account and still shows, but it cannot be charged — so it has to be counted
   separately rather than folded into the total. */
export function isExpired(card: { expires: string | null }, now: Date = new Date()): boolean {
  if (!card.expires) return false
  const m = /^(\d{1,2})\s*\/\s*(\d{2}|\d{4})$/.exec(card.expires.trim())
  if (!m) return false

  const month = Number(m[1])
  if (month < 1 || month > 12) return false
  const year = m[2].length === 2 ? 2000 + Number(m[2]) : Number(m[2])

  /* A card is good through the last day of its stated month. Comparing on the first
     of the following month avoids an off-by-one that would expire a card early. */
  const expiresAfter = new Date(Date.UTC(year, month, 1))
  return now.getTime() >= expiresAfter.getTime()
}

/**
 * The one-line summary on the My details security card. This row used to be the
 * literal string "3 saved (1 expired)" no matter what was stored, so adding or
 * removing a card changed nothing on the screen behind the dialog.
 */
export function paymentSummary(cards: readonly PaymentMethodRow[], now: Date = new Date()): string {
  if (cards.length === 0) return 'None saved'

  const expired = cards.filter(c => isExpired(c, now)).length
  const noun = cards.length === 1 ? 'card' : 'cards'
  return expired > 0
    ? `${cards.length} saved (${expired} expired)`
    : `${cards.length} ${noun} saved`
}
