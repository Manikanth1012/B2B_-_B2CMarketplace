/**
 * The shoppers a demo can be given as, and which one a market implies.
 *
 * A persona is one console; a shopper is one country's version of it. The
 * marketplace trades in India, the UAE and Kenya, and for a long time the only
 * account anybody could sign in as was Indian — so the second and third markets
 * were things the screens claimed rather than things a demo could show.
 *
 * Pure, and here rather than in `LoginScreen` for the reason the unit suite
 * insists on: the rule is worth testing and the component drags a Supabase
 * client in behind it.
 */
export interface DemoShopper {
  email: string
  password: string
  who: string
  where: string
  money: string
  /* The market this shopper is registered in, so the picker in the header can
     decide which of them the sign-in card opens on. */
  market: string
}

/* The first entry is what `DEMO_CREDENTIALS.consumer` has always been, so a
   demo that never touches the market picker opens exactly as it did. */
export const CONSUMER_SHOPPERS: DemoShopper[] = [
  {
    email: 'priya.raman@example.com', password: 'demo1234',
    who: 'Priya Raman', where: 'Bengaluru, India', money: 'Billed in ₹ under GST',
    market: 'IN',
  },
  {
    email: 'wanjiru.kamau@example.com', password: 'demo1234',
    who: 'Wanjiru Kamau', where: 'Nairobi, Kenya', money: 'Billed in KSh and $ under VAT',
    market: 'KE',
  },
]

/**
 * The shopper the header's market picker implies.
 *
 * Choosing Kenya and then being signed in as somebody in Bengaluru is the
 * picker being ignored, which is worse than not offering one. Falls back to the
 * first shopper for a market no demo account is registered in — the UAE has
 * none — because a card that opens on nobody is not an improvement on a card
 * that opens on the wrong person.
 */
export function shopperForMarket(code: string | null | undefined): number {
  const i = CONSUMER_SHOPPERS.findIndex(s => s.market === code)
  return i === -1 ? 0 : i
}
