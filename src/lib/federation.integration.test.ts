import { describe, it, expect, beforeAll } from 'vitest'
import { supabase } from './supabase'
import { compose } from './federation'
import type { TelcoItem, BundleRule, ComponentPick } from './federation'

const signIn = async (email: string, password: string) => {
  const { error } = await supabase.auth.signInWithPassword({ email, password })
  expect(error, `could not sign in as ${email}`).toBeNull()
}
const signOut = () => supabase.auth.signOut()

/* The federated rate card, the packs composed from it, and the wall between the
   two personas that may and may not read what delivery costs. */
describe('the federated operator catalogue', () => {
  let telco: TelcoItem[]
  let rule: BundleRule

  beforeAll(async () => {
    await signOut()
    await signIn('anika.sharma@aventa.com', 'operator123')
    const [t, r] = await Promise.all([
      supabase.from('telco_catalogue').select('*').order('sort_order'),
      supabase.from('bundle_rules').select('*').eq('id', 'standard').maybeSingle(),
    ])
    expect(t.error).toBeNull()
    expect(r.error).toBeNull()
    telco = (t.data ?? []) as TelcoItem[]
    rule = r.data as BundleRule
  })

  it('carries the whole rate card, with nothing sold at or below what it costs', () => {
    expect(telco.length).toBe(17)
    expect(new Set(telco.map(t => t.family)).size).toBe(8)
    for (const t of telco) {
      expect(t.rc > 0 || t.nrc > 0, `${t.id} has no price at all`).toBe(true)
      if (t.rc > 0) expect(t.cost_rc, `${t.id} costs at least what it charges`).toBeLessThan(t.rc)
      if (t.nrc > 0) expect(t.cost_nrc, `${t.id} costs at least what it charges`).toBeLessThan(t.nrc)
    }
  })

  it('prices every composed pack exactly as the rule in this repo does', async () => {
    const { data: packs, error } = await supabase
      .from('products').select('id, name, price, was_price, cost, model')
      .like('id', 'SKU-FP%')
    expect(error).toBeNull()
    expect(packs!.length).toBeGreaterThan(0)

    const { data: comps } = await supabase.from('product_telco_components').select('*')

    for (const p of packs as { id: string; name: string; price: number; was_price: number; cost: number }[]) {
      const mine = (comps ?? []).filter((c: { product_id: string }) => c.product_id === p.id)
      /* Only packs — a single federated component is a rate-card item resold as
         it stands, and it is priced by the channel rather than by this rule. */
      if (mine.length < 2) continue

      const picks: ComponentPick[] = mine.map((c: { telco_id: string; quantity: number; discount: number }) =>
        ({ telcoId: c.telco_id, quantity: c.quantity, discount: c.discount }))
      const c = compose(picks, telco, rule)

      /* The database and this module are two independent evaluations of the same
         published rule. If they disagree, one of them has drifted. */
      expect(c.price, `${p.name}: stored price disagrees with the composition rule`).toBe(Number(p.price))
      expect(c.listTotal, `${p.name}: stored rate-card total disagrees`).toBe(Number(p.was_price))
      expect(Number(p.price), `${p.name} is priced at or above its parts`).toBeLessThan(Number(p.was_price))
      expect(Number(p.price), `${p.name} is priced at or below what it costs`).toBeGreaterThan(Number(p.cost))
    }
  })

  it('resolves every composed component to a rate-card item, named as it was', async () => {
    const { data: comps } = await supabase.from('product_telco_components').select('*')
    for (const c of (comps ?? []) as { product_id: string; telco_id: string; name_at: string }[]) {
      const item = telco.find(t => t.id === c.telco_id)
      expect(item, `${c.product_id} references ${c.telco_id}, which is not in the rate card`).toBeTruthy()
      /* The captured name is what the buyer was told. It may legitimately lag a
         rename in the BSS, but on freshly seeded data it should still agree —
         a mismatch here means the seed captured the wrong row. */
      expect(c.name_at, `${c.telco_id} was captured under a different name`).toBe(item!.name)
    }
  })

  it('keeps every pack on the shelf accountable — a review record and a hero image', async () => {
    const { data: packs } = await supabase.from('products').select('id, name, status').like('id', 'SKU-FP%')
    const ids = (packs ?? []).map((p: { id: string }) => p.id)
    const [{ data: listings }, { data: media }] = await Promise.all([
      supabase.from('operator_listings').select('product_id, status, partner_id').in('product_id', ids),
      supabase.from('product_media').select('product_id, role').in('product_id', ids),
    ])
    for (const p of (packs ?? []) as { id: string; name: string; status: string }[]) {
      if (p.status !== 'live') continue
      const l = (listings ?? []).find((x: { product_id: string }) => x.product_id === p.id)
      expect(l, `${p.name} is on sale with no review record`).toBeTruthy()
      /* First party means no seller, so nothing settles and no commission is
         taken. A partner id here would put a pack in somebody's statement. */
      expect(l!.partner_id, `${p.name} is first party but names a seller`).toBeNull()
      expect((media ?? []).some((m: { product_id: string; role: string }) => m.product_id === p.id && m.role === 'hero'),
        `${p.name} is on sale with no hero image`).toBe(true)
    }
  })

  it('hides what delivery costs from everyone but the operator', async () => {
    /* The rate card carries cost_rc and cost_nrc. A seller reading it would see
       the operator's margin on every product it competes with. RLS answers with
       no rows rather than an error, which is the behaviour loadCatalogue relies
       on to stay quiet for other personas. */
    await signOut()
    await signIn('rajesh.kumar@nimbussensors.com', 'partner123')
    const { data, error } = await supabase.from('telco_catalogue').select('*')
    expect(error).toBeNull()
    expect(data, 'a seller can read the operator rate card').toEqual([])

    /* What a pack contains is not a secret — it is the reason to buy it — and it
       is legible without the rate card because the name and rate are captured on
       the row. */
    const { data: comps } = await supabase.from('product_telco_components').select('*').limit(1)
    expect(comps!.length, 'pack contents should stay readable').toBe(1)
    expect(comps![0].name_at).toBeTruthy()

    await signOut()
  })
})
