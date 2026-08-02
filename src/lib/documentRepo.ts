/* The template a console's documents come out on.
 *
 * Every console that issues a document needs the same four things: the
 * sections catalogue, the template its audience is assigned, which sections
 * that template carries, and the identity the document is issued under. Each
 * of them reading those four for itself is how the seller console ends up
 * rendering a bill on a template the operator changed last week.
 *
 * All four tables carry an anon-readable SELECT policy by design: a
 * counterparty is entitled to know the shape of the document they are sent.
 */
import { supabase } from './supabase'
import { sectionsOn, templateFor } from './billTemplate'
import type { Section, Template, Issuer, Audience } from './billTemplate'

export interface DocumentSetup {
  issuer: Issuer | null
  template: Template | null
  /* The section ids that template carries, in document order. */
  ids: string[]
  sections: Section[]
  loadError?: string
}

/**
 * @param audience whose document this is
 * @param partyId a counterparty with an exception of their own — one seller in
 *   a jurisdiction that prescribes a format must not change the document every
 *   other seller gets
 */
export async function loadDocumentSetup(
  audience: Audience, partyId?: string | null,
): Promise<DocumentSetup> {
  const [secRes, tplRes, tsRes, asgRes, issRes] = await Promise.all([
    supabase.from('invoice_sections').select('*').order('sort_order'),
    supabase.from('invoice_templates').select('*').order('sort_order'),
    supabase.from('invoice_template_sections').select('*'),
    supabase.from('invoice_template_assignments').select('*'),
    supabase.from('invoice_issuer').select('*').eq('id', 'default').maybeSingle(),
  ])

  const sections = (secRes.data ?? []) as Section[]
  const templates = (tplRes.data ?? []) as Template[]
  const chosen = (tsRes.data ?? []) as { template_id: string; section_id: string; sort_order: number }[]
  const assignments = (asgRes.data ?? []) as never[]

  const template = templateFor({ audience, partyId }, assignments, templates)
  const failed = [secRes.error, tplRes.error, asgRes.error].find(Boolean)

  return {
    issuer: (issRes.data as Issuer | null) ?? null,
    template,
    ids: template ? sectionsOn(template, sections, chosen).map(s => s.id) : [],
    sections,
    ...(failed ? { loadError: failed.message } : {}),
  }
}
