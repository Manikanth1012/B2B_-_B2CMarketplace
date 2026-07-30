/* Address book rules, pure. */

export interface Address {
  id: string
  label: string
  line1: string
  city: string
  pin: string
  phone: string | null
  notes: string | null
  is_default: boolean
}

export type AddressDraft = Omit<Address, 'id' | 'is_default'>

/** One line, for a summary row or a Checkout confirmation. */
export function formatAddress(a: Pick<Address, 'line1' | 'city' | 'pin'>): string {
  return [a.line1, a.city, a.pin].filter(Boolean).join(', ')
}

/**
 * The address Checkout should start on: the default, or the only one, or nothing.
 * Never "the first row" — row order is whatever the database felt like, and silently
 * shipping to an arbitrary address is the worst failure this screen has.
 */
export function defaultAddress(addresses: readonly Address[]): Address | null {
  return addresses.find(a => a.is_default) ?? (addresses.length === 1 ? addresses[0] : null)
}

/* Ordered for a picker: default first, then alphabetically by label so the list does
   not reshuffle as rows are edited. */
export function orderedAddresses(addresses: readonly Address[]): Address[] {
  return [...addresses].sort((a, b) =>
    Number(b.is_default) - Number(a.is_default) || a.label.localeCompare(b.label))
}

export interface Invalid { field: keyof AddressDraft; reason: string }

/* Deliberately thin. Only line1, city and a PIN are genuinely required to deliver;
   a phone number helps the courier and a note is optional. Demanding more would
   invent rules the marketplace does not actually have. */
export function validateAddress(draft: Partial<AddressDraft>): Invalid[] {
  const problems: Invalid[] = []
  if (!draft.label?.trim()) problems.push({ field: 'label', reason: 'Give it a name, like Home or Work.' })
  if (!draft.line1?.trim()) problems.push({ field: 'line1', reason: 'The street address is required.' })
  if (!draft.city?.trim()) problems.push({ field: 'city', reason: 'The city is required.' })

  const pin = draft.pin?.trim() ?? ''
  if (!pin) problems.push({ field: 'pin', reason: 'The postcode is required.' })
  /* Loose on purpose: the marketplace ships to India, the UAE and Kenya, whose
     postcodes are 6 digits, 5-6 digits and 5 digits respectively. A strict Indian
     PIN pattern would reject two of the three countries it claims to serve. */
  else if (!/^[A-Za-z0-9][A-Za-z0-9 -]{2,9}$/.test(pin)) {
    problems.push({ field: 'pin', reason: 'That does not look like a postcode.' })
  }

  return problems
}

export function isValid(draft: Partial<AddressDraft>): boolean {
  return validateAddress(draft).length === 0
}

/**
 * Can this address be deleted? The last one can — an empty book is a legitimate
 * state and Checkout copes with it — but the default cannot while others remain,
 * because that would leave the book with no default and Checkout with no answer.
 */
export function canDelete(address: Address, all: readonly Address[]): boolean {
  if (!address.is_default) return true
  return all.length === 1
}
