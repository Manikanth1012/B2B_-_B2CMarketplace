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

/* ------------------------------------- what an order says about how it was
                                          paid, in words -------------------- */

export interface MethodLabel { id: string; label: string }

/**
 * The words to print where an order records how it was paid.
 *
 * `orders.payment_method` holds two vocabularies and both are legitimate.
 * Forty-one orders carry a gateway method id — `mobile_money`, `card`, `upi` —
 * and fourteen carry a settlement arrangement already written as prose: "On
 * account — Net 30", "Invoice". Every one of the second kind is an enterprise
 * order, because an arrangement is something a company negotiates and not
 * something anybody picks at a checkout. Normalising them into ids would mean
 * inventing gateway methods that no gateway offers.
 *
 * So: an id is translated through `payment_methods.label`, which already holds
 * the right words and which the order card simply never joined to — a customer
 * in Kisumu was reading "mobile_money" while the payment-methods card on the
 * same account said "M-Pesa".
 *
 * Anything that is not an id is printed as it stands, with one exception. A
 * value that still *looks* like an id — no spaces, no capitals — but is missing
 * from the table is a method that has been retired since the order was placed.
 * Printing that raw is the bug this function exists to fix, so it is humanised
 * rather than passed through: an old order should not start showing machine
 * text because somebody tidied a lookup table.
 */
export function paymentLabel(
  stored: string | null | undefined,
  methods: readonly MethodLabel[] = [],
): string {
  const value = (stored ?? '').trim()
  if (!value) return '—'

  const known = methods.find(m => m.id === value)
  if (known) return known.label

  /* Prose the moment it has a space or a capital — an arrangement, a card
     description, anything a person wrote. */
  if (/[A-Z\s]/.test(value)) return value

  /* A token the table no longer knows. */
  const words = value.replace(/[_-]+/g, ' ').trim()
  return words.charAt(0).toUpperCase() + words.slice(1)
}
