/* What a role may be scoped to and what it may hold. Pure.
 *
 * The New Role form asked an operator to type audit categories into a
 * comma-separated box and capabilities into a free-text field, from memory,
 * with nothing offering the values and nothing checking them. "Setlement" saved
 * cleanly and scoped the role to nothing; `catalog` saved cleanly and granted
 * nothing. On an access-control screen that is the worst failure available,
 * because the role looks granted.
 *
 * Everything here is about turning two catalogues the database now holds into
 * something a form can present and check.
 */

/**
 * What a role holds for one capability.
 *
 * Four, not three. `read` was already in the seeded data and in nothing else —
 * not in the form, not in the console — so the two roles holding it granted
 * nothing at all, and "Read-Only Analyst" was an empty role that looked
 * configured.
 *
 * `read` and `scoped` are different axes and neither is a weaker form of the
 * other. `scoped` limits breadth — this seller, this market, this queue — and
 * still permits acting. `read` limits depth — everything here, changing none of
 * it.
 */
export type CapabilityLevel = 'none' | 'read' | 'scoped' | 'full'

export const LEVELS: CapabilityLevel[] = ['none', 'read', 'scoped', 'full']

export interface CapabilityDef {
  id: string
  label: string
  area: string
  covers: string
  /* Whether "scoped" means anything here. There is no partial holding of the
     audit log, so offering the middle setting would offer a setting with no
     behaviour behind it. */
  scopable: boolean
  sort_order: number
}

export interface AuditCategoryDef {
  id: string
  label: string
  covers: string
  sort_order: number
}

export type Capabilities = Record<string, string>

/* ------------------------------------------------------------ presenting -- */

/** The capabilities grouped by the part of the console they govern, in the
    catalogue's own order, so twenty-eight rows read as eight short lists. */
export function byArea(defs: readonly CapabilityDef[]): { area: string; caps: CapabilityDef[] }[] {
  const order = [...defs].sort((a, b) => a.sort_order - b.sort_order)
  const areas: { area: string; caps: CapabilityDef[] }[] = []
  for (const d of order) {
    const found = areas.find(g => g.area === d.area)
    if (found) found.caps.push(d)
    else areas.push({ area: d.area, caps: [d] })
  }
  return areas
}

/**
 * The capabilities matching what somebody has typed into the filter.
 *
 * Searches the label, the id and the sentence saying what it covers — the last
 * because somebody looking for "webhooks" is looking for `developer_portal`,
 * and matching only the name would tell them the console has no such thing.
 */
export function matching(defs: readonly CapabilityDef[], query: string): CapabilityDef[] {
  const q = query.trim().toLowerCase()
  if (!q) return [...defs]
  return defs.filter(d =>
    d.label.toLowerCase().includes(q)
    || d.id.toLowerCase().includes(q)
    || d.area.toLowerCase().includes(q)
    || d.covers.toLowerCase().includes(q))
}

/** The level a role holds, defaulting to none — an absent key and an explicit
    'none' are the same grant and should not read differently. */
export const levelOf = (caps: Capabilities, id: string): CapabilityLevel =>
  (LEVELS as string[]).includes(caps[id]) ? caps[id] as CapabilityLevel : 'none'

/** "6 full · 3 scoped · 19 none", for the line that says what this role comes
    to without making anybody count the rows. */
export function summarise(
  caps: Capabilities, defs: readonly CapabilityDef[],
): { full: number; scoped: number; read: number; none: number; text: string } {
  let full = 0, scoped = 0, read = 0
  for (const d of defs) {
    const l = levelOf(caps, d.id)
    if (l === 'full') full++
    else if (l === 'scoped') scoped++
    else if (l === 'read') read++
  }
  const none = defs.length - full - scoped - read
  /* Only the levels actually held are named. "0 read" on every role that does
     not use it is noise in the one line meant to be read at a glance. */
  const parts = [
    full > 0 ? `${full} full` : '',
    scoped > 0 ? `${scoped} scoped` : '',
    read > 0 ? `${read} read-only` : '',
    `${none} none`,
  ].filter(Boolean)
  return { full, scoped, read, none, text: parts.join(' · ') }
}

/* ------------------------------------------------------------ validating -- */

export type RoleVerdict = { ok: true } | { ok: false; reason: string }

export interface RoleDraft {
  name: string
  audit_categories: string[]
  capabilities: Capabilities
}

/**
 * Whether this role is one the console can actually honour.
 *
 * The same four rules the database enforces, said in the language of somebody
 * who was filling in a form. Checked here as well as there because a refusal
 * that arrives as a Postgres error after the save is a refusal nobody can act
 * on — but the database keeps its copy, because a form is not a permission
 * boundary.
 */
export function validateRole(
  draft: RoleDraft,
  known: { categories: readonly AuditCategoryDef[]; capabilities: readonly CapabilityDef[] },
): RoleVerdict {
  if (!draft.name.trim()) {
    return { ok: false, reason: 'Give the role a name — it is what appears against everybody who holds it.' }
  }

  const badCat = draft.audit_categories.find(c => !known.categories.some(k => k.id === c))
  if (badCat) {
    return {
      ok: false,
      reason: `${badCat} is not an audit category. A role scoped to one that does not exist can see nothing, and says nothing about it.`,
    }
  }

  for (const [id, level] of Object.entries(draft.capabilities)) {
    const def = known.capabilities.find(c => c.id === id)
    if (!def) {
      return { ok: false, reason: `${id} is not a capability this console has, so granting it grants nothing.` }
    }
    if (!LEVELS.includes(level as CapabilityLevel)) {
      return { ok: false, reason: `${def.label} is set to "${level}", which is not one of none, read, scoped or full.` }
    }
    if (level === 'scoped' && !def.scopable) {
      return { ok: false, reason: `${def.label} cannot be scoped — hold it in full, read-only, or not at all.` }
    }
  }

  /* A role that can do nothing is almost certainly a half-filled form rather
     than an intention. Refused with a way forward rather than saved as a role
     somebody will later wonder about. */
  const granted = known.capabilities.filter(c => levelOf(draft.capabilities, c.id) !== 'none')
  if (granted.length === 0) {
    return {
      ok: false,
      reason: 'This role holds nothing, so anybody assigned it sees an empty console. Grant at least one capability.',
    }
  }

  /* Audit scope without the audit capability is a scope on a screen the holder
     cannot open. Worth saying, because both halves look right on their own. */
  if (draft.audit_categories.length > 0 && levelOf(draft.capabilities, 'audit') === 'none') {
    return {
      ok: false,
      reason: 'This role is scoped to audit categories but cannot open the audit log. Grant the Audit log capability, or clear the categories.',
    }
  }

  return { ok: true }
}

/** A role with every capability at none, for a form opening on a blank one —
    so the picker shows the whole catalogue rather than an empty list somebody
    has to populate from memory. */
export const emptyCapabilities = (defs: readonly CapabilityDef[]): Capabilities =>
  Object.fromEntries(defs.map(d => [d.id, 'none' as const]))

/** The catalogue's levels merged over what a role already holds, so editing an
    existing role shows every capability rather than only the ones it was given
    when it was made. A capability added to the console since then would
    otherwise be invisible on every role that predates it. */
export const fillGaps = (caps: Capabilities, defs: readonly CapabilityDef[]): Capabilities =>
  Object.fromEntries(defs.map(d => [d.id, levelOf(caps, d.id)]))
