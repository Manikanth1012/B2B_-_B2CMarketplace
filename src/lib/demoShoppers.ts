/**
 * The accounts a demo can be given as, and which one a market implies.
 *
 * A persona is one console; an account is one country's version of it. The
 * marketplace trades in India, the UAE and Kenya, and for a long time the only
 * account anybody could sign in as was Indian — so the second and third markets
 * were things the screens claimed rather than things a demo could show.
 *
 * That was not only a demo problem. Four faults in the Kenyan market were found
 * within an hour of there being a Kenyan customer to look at, all of them
 * weeks old, all of them invisible for the same reason: nobody could open the
 * screen. The seller and buyer consoles had the same gap until a Kenyan seller
 * and a Kenyan buyer could sign in.
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
  /* What is distinctive about this account's money — the line under the name in
     the picker, because "Nairobi, Kenya" alone does not say why you would
     choose it. */
  money: string
  /* The market this account is registered in, so the picker in the header can
     decide which of them the sign-in card opens on. */
  market: string
}

/* The first entry in each list is what `DEMO_CREDENTIALS` has always been, so a
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

export const PARTNER_SHOPPERS: DemoShopper[] = [
  {
    email: 'rajesh.kumar@nimbussensors.com', password: 'partner123',
    who: 'Nimbus Sensors', where: 'Bengaluru, India', money: 'Paid in $ · IoT sensors',
    market: 'IN',
  },
  {
    email: 'amara.okonkwo@example.com', password: 'partner123',
    who: 'Beacon Reseller Co', where: 'Nairobi, Kenya', money: 'Paid in KSh on $ sales · reseller',
    market: 'KE',
  },
]

export const ENTERPRISE_SHOPPERS: DemoShopper[] = [
  {
    email: 'vikram.shah@smartbuild.in', password: 'enterprise123',
    who: 'SmartBuild Ltd', where: 'Bengaluru, India', money: 'Invoiced in ₹ under GST',
    market: 'IN',
  },
  {
    email: 'grace.wanjiru@harbourpoint.co.ke', password: 'enterprise123',
    who: 'Harbourpoint Retail', where: 'Nairobi, Kenya', money: 'Invoiced in KSh under VAT',
    market: 'KE',
  },
]

/** Every persona that offers more than one country to sign in as. */
export const SHOPPERS_BY_PERSONA: Record<string, DemoShopper[]> = {
  consumer: CONSUMER_SHOPPERS,
  partner: PARTNER_SHOPPERS,
  enterprise: ENTERPRISE_SHOPPERS,
}

/**
 * The accounts offered for a persona, or none.
 *
 * The operator console is deliberately absent: the marketplace operator runs
 * all three markets and is not registered in any of them, so offering to sign
 * in as "the operator in Kenya" would be describing a role that does not exist.
 */
export const shoppersFor = (persona: string): DemoShopper[] =>
  SHOPPERS_BY_PERSONA[persona] ?? []

/**
 * The account the header's market picker implies.
 *
 * Choosing Kenya and then being signed in as somebody in Bengaluru is the
 * picker being ignored, which is worse than not offering one. Falls back to the
 * first account for a market none is registered in — the UAE has none — because
 * a card that opens on nobody is not an improvement on a card that opens on the
 * wrong person.
 */
export function shopperForMarket(
  code: string | null | undefined, list: readonly DemoShopper[] = CONSUMER_SHOPPERS,
): number {
  const i = list.findIndex(s => s.market === code)
  return i === -1 ? 0 : i
}
