/* Reading everything a bill needs beyond the bill itself.
 *
 * Split out of `consumerBillDoc.ts` so that module stays pure. `./supabase`
 * constructs a client at import time and throws without credentials, so a
 * module that touches it cannot be unit tested in an environment that has no
 * `.env` — and CI is exactly that environment, on purpose.
 */
import { supabase } from './supabase'
import type { Currency, Market } from './money'
import type {
  Section, Template, TemplateSection, Assignment, Issuer,
} from './billTemplate'
import type { BillBook } from './consumerBillDoc'

/**
 * Everything a bill needs beyond the bill itself.
 *
 * One round trip for the whole tab rather than one per bill: seven bills on
 * record would otherwise be seven identical reads of the same template.
 */
export async function loadBillBook(): Promise<BillBook> {
  const [secRes, tplRes, tsRes, asgRes, issRes, profRes, addrRes, memRes, ledRes, banRes, curRes, mktRes] =
    await Promise.all([
      supabase.from('invoice_sections').select('*').order('sort_order'),
      supabase.from('invoice_templates').select('*').order('sort_order'),
      supabase.from('invoice_template_sections').select('*'),
      supabase.from('invoice_template_assignments').select('*'),
      supabase.from('invoice_issuer').select('*').eq('id', 'default').maybeSingle(),
      supabase.from('consumer_profile').select('*').eq('id', 'me').maybeSingle(),
      supabase.from('consumer_addresses').select('*').eq('is_default', true).maybeSingle(),
      supabase.from('loyalty_members').select('*').eq('kind', 'consumer'),
      supabase.from('loyalty_ledger').select('*'),
      /* `public_banners`, not `operator_banners`. The second is operator-only,
         so reading it from a customer's session returned nothing and the
         advert section vanished from their own bill without a word — while
         the operator's preview, run from an operator session, showed it. The
         view is the same live banners with the commercial columns dropped,
         which is all a bill needs. */
      supabase.from('public_banners').select('*').eq('audience', 'consumer').order('sort_order'),
      supabase.from('currencies').select('*').order('sort_order'),
      supabase.from('markets').select('*').order('sort_order'),
    ])

  const profile = (profRes.data as Record<string, string> | null) ?? null
  const member = ((memRes.data ?? []) as Record<string, string>[]).find(m =>
    (profile?.user_id && m.user_id === profile.user_id) || m.name === profile?.name) ?? null
  const banner = ((banRes.data ?? []) as Record<string, string>[])[0]

  const failed = [secRes.error, tplRes.error, asgRes.error].find(Boolean)

  return {
    sections: (secRes.data ?? []) as Section[],
    templates: (tplRes.data ?? []) as Template[],
    chosen: (tsRes.data ?? []) as TemplateSection[],
    assignments: (asgRes.data ?? []) as Assignment[],
    issuer: (issRes.data as Issuer | null) ?? null,
    profile,
    address: (addrRes.data as Record<string, string> | null) ?? null,
    member,
    ledger: (ledRes.data ?? []) as Record<string, string>[],
    currencies: (curRes.data ?? []) as Currency[],
    markets: (mktRes.data ?? []) as Market[],
    advert: banner
      ? { title: banner.title, subtitle: banner.subtitle ?? null, cta: banner.cta, accent: banner.accent || '#0D47A1' }
      : null,
    ...(failed ? { loadError: failed.message } : {}),
  }
}
