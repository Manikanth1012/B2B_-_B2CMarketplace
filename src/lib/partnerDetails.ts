/* What a seller may know and change about themselves — the rules, with no React
   and no Supabase in them.

   Four separate concerns share this file because they share one screen: who you
   are, how we reach you, where the money goes, and which marketplaces you are
   actually trading in. They are kept as separate exported groups rather than one
   blob, because only the last two have any money in them. */

/* ========================================================================= */
/* Masking                                                                   */
/* ========================================================================= */

/* An account number on a screen is a fraud waiting for an opportunity, so every
   screen asks for the masked form and the full number is a deliberate, logged
   act. Four digits is enough for a human to recognise their own account and not
   enough for anybody to pay into it. */
export function maskAccount(value: string | null | undefined): string {
  const s = String(value ?? '').replace(/\s+/g, '')
  if (!s) return 'Not on file'
  if (s.length <= 4) return '•'.repeat(s.length)
  return '•••• ' + s.slice(-4)
}

/* A tax identifier is shorter and its shape carries meaning, so the first two
   characters stay: they are the jurisdiction, not the secret. */
export function maskTaxId(value: string | null | undefined): string {
  const s = String(value ?? '').replace(/\s+/g, '')
  if (!s) return 'Not supplied'
  if (s.length <= 4) return '•'.repeat(s.length)
  return s.slice(0, 2) + '•'.repeat(Math.max(3, s.length - 6)) + s.slice(-2)
}

export function maskIban(value: string | null | undefined): string | null {
  const s = String(value ?? '').replace(/\s+/g, '')
  if (!s) return null
  if (s.length <= 8) return '•'.repeat(s.length)
  return s.slice(0, 4) + ' •••• ' + s.slice(-4)
}

/* ========================================================================= */
/* Contacts                                                                  */
/* ========================================================================= */

export type ContactKind = 'email' | 'phone'
export type ContactPurpose =
  | 'signin' | 'settlement' | 'escalation' | 'technical' | 'disputes' | 'notices'

export interface Contact {
  id: string
  partner_id: string
  kind: ContactKind
  value: string
  purpose: ContactPurpose
  label: string | null
  verified: boolean
  verified_on: string | null
  sort_order: number
}

export interface PurposeSpec {
  id: ContactPurpose
  label: string
  /* What actually gets sent here. Written as the thing that arrives, not as a
     category — "the remittance advice" tells a seller more than "finance". */
  sends: string
  /* What happens when nobody is listed. This is the sentence that makes a
     seller add one, and it has to be true rather than alarming. */
  ifMissing: string
  /* A purpose nobody can be missing. Only sign-in qualifies: it is the account. */
  required: boolean
  allows: ContactKind[]
}

export const CONTACT_PURPOSES: PurposeSpec[] = [
  {
    id: 'signin', label: 'Sign-in address', required: true, allows: ['email'],
    sends: 'Password resets and anything about the account itself.',
    ifMissing: 'There is no account without one.',
  },
  {
    id: 'settlement', label: 'Settlement', required: false, allows: ['email', 'phone'],
    sends: 'Remittance advice, statements, and notice of anything held back.',
    ifMissing: 'Statements and holds go to the sign-in address only, so finance finds out when somebody forwards it.',
  },
  {
    id: 'escalation', label: 'Escalation', required: false, allows: ['email', 'phone'],
    sends: 'An order that failed, out of hours.',
    ifMissing: 'A failed order waits until somebody opens the portal. Most of them fail overnight.',
  },
  {
    id: 'technical', label: 'Technical', required: false, allows: ['email', 'phone'],
    sends: 'Webhook failures, sandbox results, API deprecations.',
    ifMissing: 'Integration failures are reported to whoever signs in, who is usually not the person who can fix them.',
  },
  {
    id: 'disputes', label: 'Disputes', required: false, allows: ['email'],
    sends: 'Buyer claims against you, and the deadline to answer one.',
    ifMissing: 'A dispute you do not answer in time is decided without you.',
  },
  {
    id: 'notices', label: 'Policy notices', required: false, allows: ['email'],
    sends: 'Category rule changes, commission changes, and anything you have to act on.',
    ifMissing: 'A rule change that delists your stock arrives in one inbox, and only when that person reads it.',
  },
]

export const PURPOSE_SPEC: Record<ContactPurpose, PurposeSpec> =
  Object.fromEntries(CONTACT_PURPOSES.map(p => [p.id, p])) as Record<ContactPurpose, PurposeSpec>

/* `note` is what a caller shows when the answer is yes but there is something
   worth saying — an invitation to an address the company does not control is
   allowed and is still worth a sentence. */
export type Check = { ok: true; note?: string } | { ok: false; reason: string }

/* Deliberately loose on shape. An address is proved by sending to it, not by a
   regular expression, and a phone number's format varies by country far more
   than any pattern worth writing here. What is checked is what actually breaks:
   an empty value, the wrong kind for the purpose, and a duplicate. */
export function validateContact(
  { kind, value, purpose, existing, editingId }: {
    kind: ContactKind
    value: string
    purpose: ContactPurpose
    existing: readonly Contact[]
    editingId?: string
  },
): Check {
  const v = value.trim()
  if (!v) return { ok: false, reason: 'Enter an address or a number.' }

  const spec = PURPOSE_SPEC[purpose]
  if (!spec) return { ok: false, reason: 'Pick what this contact is for.' }
  if (!spec.allows.includes(kind)) {
    return {
      ok: false,
      reason: kind === 'phone'
        ? `${spec.label} is sent in writing, so it needs an address rather than a number.`
        : `${spec.label} needs a telephone number.`,
    }
  }

  if (kind === 'email' && !(v.includes('@') && !v.startsWith('@') && !v.endsWith('@') && v.includes('.'))) {
    return { ok: false, reason: 'That does not look like an email address.' }
  }
  if (kind === 'phone' && v.replace(/[^0-9]/g, '').length < 7) {
    return { ok: false, reason: 'That is too short to be a telephone number.' }
  }

  const clash = existing.find(c =>
    c.id !== editingId && c.purpose === purpose && c.value.trim().toLowerCase() === v.toLowerCase())
  if (clash) return { ok: false, reason: `That is already listed for ${spec.label.toLowerCase()}.` }

  if (purpose === 'signin' && existing.some(c => c.id !== editingId && c.purpose === 'signin')) {
    return {
      ok: false,
      reason: 'There is already a sign-in address. Change it on the existing one rather than adding a second — an account signs in as one address.',
    }
  }
  return { ok: true }
}

/** Removing a contact. The sign-in address is the account, so it cannot go. */
export function canRemoveContact(contact: Contact): Check {
  if (contact.purpose === 'signin') {
    return {
      ok: false,
      reason: 'This is the address you sign in with. Removing it would lock you out, so it can be changed but not deleted.',
    }
  }
  return { ok: true }
}

export interface Gap { purpose: ContactPurpose; label: string; ifMissing: string }

/** Which purposes nobody is listed for, and what that costs. Ordered so the
    ones that lose money come before the ones that lose time. */
export function contactGaps(contacts: readonly Contact[]): Gap[] {
  const order: ContactPurpose[] = ['settlement', 'disputes', 'escalation', 'technical', 'notices']
  return order
    .filter(p => !contacts.some(c => c.purpose === p))
    .map(p => ({ purpose: p, label: PURPOSE_SPEC[p].label, ifMissing: PURPOSE_SPEC[p].ifMissing }))
}

/** Contacts recorded but never proved. Worth its own list: an unverified number
    reads on screen as cover, and it is not. */
export function unverified(contacts: readonly Contact[]): Contact[] {
  return contacts.filter(c => !c.verified)
}

export function groupByPurpose(contacts: readonly Contact[]): { spec: PurposeSpec; rows: Contact[] }[] {
  return CONTACT_PURPOSES.map(spec => ({
    spec,
    rows: contacts.filter(c => c.purpose === spec.id).slice().sort((a, b) => a.sort_order - b.sort_order),
  }))
}

/* ========================================================================= */
/* Settlement account                                                        */
/* ========================================================================= */

export interface BankCode {
  local: string
  localEg: string
  tax: string
  taxEg: string
  iban: boolean
}

/* What a country actually calls its local clearing code, so the form asks for
   the thing the person is holding rather than a generic "bank code" they cannot
   find on a statement.

   The three markets the marketplace trades in, and no more. It used to carry
   fourteen — Singapore, Germany, Poland, Brazil, Vietnam, Sweden, Taiwan,
   Israel, the UK and the United States among them — none of which the
   marketplace does business in, and nine sellers were seeded banking in them.
   A seller cannot settle into an account in a country the marketplace has no
   entity, no tax registration and no payout rail in, so offering to ask them
   for a Bankleitzahl was offering something that could not happen.

   `DEFAULT_BANK_CODE` still catches anything else, which is what a fourth
   market looks like on the day it opens and before this list learns about
   it. */
const BANK_CODES: Record<string, BankCode> = {
  'India': { local: 'IFSC',             localEg: 'HDFC0001234', tax: 'PAN',     taxEg: 'AAACH1234K',      iban: false },
  'UAE':   { local: 'Routing code',     localEg: '302620122',   tax: 'TRN',     taxEg: '100123456700003', iban: true },
  'Kenya': { local: 'Bank/branch code', localEg: '068-000',     tax: 'KRA PIN', taxEg: 'P051234567X',     iban: false },
}

/* Deliberately generic rather than a guess. A seller in a market this list has
   not learned yet gets a field they can still fill in, instead of being asked
   for the wrong country's identifier. */
const DEFAULT_BANK_CODE: BankCode =
  { local: 'Local clearing code', localEg: '—', tax: 'Tax identifier', taxEg: '—', iban: true }

export function bankCodeFor(country: string | null | undefined): BankCode {
  return BANK_CODES[String(country ?? '')] ?? DEFAULT_BANK_CODE
}

/**
 * How to render the local clearing code: outright.
 *
 * A bank identifier is not a secret. An IFSC, a routing code and a branch code
 * all name a bank or a branch and are published directory data, so masking one
 * beside an unmasked BIC would be a card contradicting itself about what it is
 * protecting.
 *
 * There used to be an exception, and a `localHoldsAccount` flag for it: Brazil's
 * "Agência/conta" is a branch and an account number in one box, so it was
 * masked. Brazil is not a market the marketplace trades in and the seller who
 * banked there has been moved, which left that branch unreachable — and an
 * unreachable branch is one nothing exercises and nobody notices breaking. A
 * market whose clearing code carries an account number will need it back, with
 * a test; it is easier to add that deliberately than to trust code that has
 * never run.
 *
 * `country` stays in the signature because this is where the decision belongs
 * and both callers already have it to hand.
 */
export function showLocalCode(country: string | null | undefined, code: string): string {
  void country
  return code
}

export interface BankAccount {
  partner_id: string
  holder: string
  bank: string
  branch: string | null
  account: string
  local_label: string
  local_code: string
  swift: string
  iban: string | null
  currency: string
  tax_label: string
  tax_id: string
  residency: string
  treaty_on_file: boolean
  treaty_expires: string | null
  withholding: string
  verified: boolean
  verified_on: string | null
  verified_by: string | null
  method: string | null
  pending_status: 'none' | 'submitted' | 'rejected'
  pending_holder: string | null
  pending_bank: string | null
  pending_branch: string | null
  pending_account: string | null
  pending_local: string | null
  pending_swift: string | null
  pending_why: string | null
  pending_requested_on: string | null
  pending_requested_by: string | null
  pending_decided_on: string | null
  pending_decided_by: string | null
  pending_note: string | null
}

export interface BankDraft {
  holder: string
  bank: string
  branch: string
  account: string
  confirm: string
  local: string
  swift: string
  why: string
}

/**
 * A seller changing where their money is paid.
 *
 * The account number is typed twice on purpose — nobody proof-reads a number
 * they pasted, and this is the one field where a typo sends money to a
 * stranger. The reason is required rather than optional because an unexplained
 * payout change is the shape every account takeover takes, and a reason the
 * marketplace can read is the cheapest control there is.
 */
export function validateBankChange(draft: BankDraft, current: BankAccount | null): Check {
  const holder = draft.holder.trim()
  const bank = draft.bank.trim()
  const account = draft.account.replace(/\s+/g, '')
  const confirm = draft.confirm.replace(/\s+/g, '')
  const why = draft.why.trim()

  if (!holder) return { ok: false, reason: 'Name the account holder. It has to match the registered entity — a personal account in a director’s name is refused.' }
  if (!bank) return { ok: false, reason: 'Name the bank. An account number with no bank cannot be paid to.' }
  if (!account) return { ok: false, reason: 'Enter the new account number.' }
  if (account !== confirm) {
    return { ok: false, reason: 'The two account numbers do not match. Check both — this is the one field where a typo sends money to a stranger.' }
  }
  if (current && account === current.account.replace(/\s+/g, '')) {
    return { ok: false, reason: 'That is the account already on file. Nothing to change.' }
  }
  if (why.length < 10) {
    return { ok: false, reason: 'Say why it is changing. An unexplained payout change is the shape every account takeover takes, so the reason is required.' }
  }
  return { ok: true }
}

export type PendingState =
  | { state: 'none' }
  | { state: 'submitted'; to: string; why: string; on: string; by: string }
  | { state: 'rejected'; why: string; note: string; on: string; by: string }

/** What is currently in flight against the settlement instruction. */
export function pendingChange(bank: BankAccount | null): PendingState {
  if (!bank || bank.pending_status === 'none') return { state: 'none' }
  if (bank.pending_status === 'rejected') {
    return {
      state: 'rejected',
      why: bank.pending_why ?? '',
      note: bank.pending_note ?? '',
      on: bank.pending_decided_on ?? '',
      by: bank.pending_decided_by ?? 'the marketplace',
    }
  }
  return {
    state: 'submitted',
    to: maskAccount(bank.pending_account),
    why: bank.pending_why ?? '',
    on: bank.pending_requested_on ?? '',
    by: bank.pending_requested_by ?? 'you',
  }
}

export interface TaxPosition {
  level: 'ok' | 'expiring' | 'expired' | 'none'
  headline: string
  detail: string
  daysLeft: number | null
}

/**
 * Where the seller stands on withholding, and how long that lasts.
 *
 * Withholding is not a penalty and cannot be waived — it comes off at source and
 * is paid to the authority. The only thing that changes the rate is a valid
 * certificate, and the only thing that makes it lapse is nobody noticing the
 * date. Sixty days is the window because a certificate takes weeks to obtain.
 */
export const RENEWAL_WINDOW_DAYS = 60

export function taxPosition(bank: BankAccount | null, today: Date): TaxPosition {
  if (!bank) {
    return {
      level: 'none', daysLeft: null,
      headline: 'No tax position on file',
      detail: 'It is recorded at the bank and tax gate. Until it is, the statutory rate applies.',
    }
  }
  if (!bank.treaty_on_file || !bank.treaty_expires) {
    return {
      level: 'none', daysLeft: null,
      headline: 'No treaty certificate on file',
      detail: `${bank.withholding}. It is withheld at source and paid to the ${bank.residency} authority — it is not a marketplace charge and cannot be waived. A valid certificate changes the rate from the settlement run after it is accepted.`,
    }
  }

  const expiry = new Date(bank.treaty_expires + 'T00:00:00Z')
  const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()))
  const daysLeft = Math.round((expiry.getTime() - start.getTime()) / 86400000)

  if (daysLeft < 0) {
    return {
      level: 'expired', daysLeft,
      headline: `Certificate expired ${Math.abs(daysLeft)} days ago`,
      detail: 'The statutory rate resumed on its own the day it lapsed. Anything already withheld is reclaimed from the authority, not from the marketplace.',
    }
  }
  if (daysLeft <= RENEWAL_WINDOW_DAYS) {
    return {
      level: 'expiring', daysLeft,
      headline: `Certificate expires in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`,
      detail: 'Nothing is withheld while it is valid. It does not roll over — the statutory rate resumes automatically the day after, so a replacement has to be accepted before then.',
    }
  }
  return {
    level: 'ok', daysLeft,
    headline: 'Nothing withheld under the treaty',
    detail: `Valid for another ${daysLeft} days. You are reminded ${RENEWAL_WINDOW_DAYS} days before it expires, because the statutory rate resumes on its own.`,
  }
}

/* ========================================================================= */
/* Go-live                                                                   */
/* ========================================================================= */

export interface GoLiveRow {
  category_id: string
  name: string
  state: 'trading' | 'empty' | 'paused' | 'applied' | 'available'
  since: string | null
  live: number
  pending: number
  /* What the seller should do about it, or null when the answer is nothing. */
  next: string | null
  pausedReason?: string | null
}

interface CategoryLike { id: string; name: string; self_apply?: boolean }
interface ApprovalLike { category_id: string; approved_at: string | null }
interface GoLiveLike {
  category_id: string
  storefront_enabled: boolean
  went_live_on: string | null
  first_listing_on: string | null
  paused_reason?: string | null
}
interface ListingLike { category_id: string | null; status: string }

/**
 * Which marketplaces this seller is actually trading in.
 *
 * Approved and trading are different states and the gap between them is where
 * sellers sit for months: a storefront open in Devices with nothing published in
 * it is a shop with the lights on and no stock, and nobody tells them, because
 * from the marketplace's side nothing is wrong.
 */
export function goLiveRows(
  categories: readonly CategoryLike[],
  approvals: readonly ApprovalLike[],
  golive: readonly GoLiveLike[],
  listings: readonly ListingLike[],
): GoLiveRow[] {
  const rank: Record<GoLiveRow['state'], number> =
    { empty: 0, paused: 1, trading: 2, applied: 3, available: 4 }

  const rows = categories.map((c): GoLiveRow => {
    const live = listings.filter(l => l.category_id === c.id && l.status === 'live').length
    const pending = listings.filter(l => l.category_id === c.id && l.status === 'pending').length
    const approval = approvals.find(a => a.category_id === c.id)
    const g = golive.find(x => x.category_id === c.id)

    if (!approval) {
      return { category_id: c.id, name: c.name, state: 'available', since: null, live, pending,
        next: c.self_apply === false
          ? 'Not open to applications — the marketplace places sellers here itself.'
          : 'Apply from Onboarding if you have something to sell here.' }
    }
    if (!approval.approved_at) {
      return { category_id: c.id, name: c.name, state: 'applied', since: null, live, pending,
        next: 'Applied for. The marketplace decides once your evidence is complete.' }
    }
    if (g && !g.storefront_enabled) {
      return { category_id: c.id, name: c.name, state: 'paused',
        since: g.went_live_on, live, pending, pausedReason: g.paused_reason ?? null,
        next: `Paused by you. Your ${live} listing${live === 1 ? '' : 's'} ${live === 1 ? 'is' : 'are'} hidden from buyers until you reopen it.` }
    }
    if (live === 0) {
      return { category_id: c.id, name: c.name, state: 'empty',
        since: g?.went_live_on ?? approval.approved_at, live, pending,
        next: pending > 0
          ? `${pending} listing${pending === 1 ? '' : 's'} in review. Until one is published, buyers browsing here do not see you at all.`
          : 'Open since then with nothing published. Buyers browsing here do not see you at all.' }
    }
    return { category_id: c.id, name: c.name, state: 'trading',
      since: g?.went_live_on ?? approval.approved_at, live, pending, next: null }
  })

  return rows.sort((a, b) => rank[a.state] - rank[b.state] || a.name.localeCompare(b.name))
}

/** Pausing your own storefront. It hides listings rather than withdrawing them,
    which is exactly why it needs a reason attached. */
export function validatePause(reason: string, liveListings: number): Check {
  if (reason.trim().length < 5) {
    return { ok: false, reason: 'Say why. A storefront that is off with no reason on it becomes a support ticket a week later.' }
  }
  if (liveListings === 0) {
    return { ok: false, reason: 'There is nothing published here to hide. Pausing would change nothing.' }
  }
  return { ok: true }
}

/* ========================================================================= */
/* You                                                                       */
/* ========================================================================= */

export interface PartnerUser {
  id: string
  partner_id: string
  name: string
  email: string
  job_title: string
  role: 'admin' | 'fulfilment' | 'finance' | 'read_only'
  /* 'removed' rather than a deleted row: this is what an audit entry points at
     when it says who acted, and deleting the person turns their own history
     into dangling references. */
  status: 'active' | 'invited' | 'suspended' | 'removed'
  joined: string
  last_active: string | null
  mfa: boolean
  sessions: number
  pwd_changed: string | null
  pwd_strength: 'weak' | 'fair' | 'strong' | null
  must_reset: boolean
  timezone: string
  date_format: string
  language: string
  out_of_office: boolean
  delegate_id: string | null
  digest: string
  sort_order: number
}

export const ROLE_LABEL: Record<PartnerUser['role'], string> = {
  admin: 'Seller admin',
  fulfilment: 'Fulfilment operator',
  finance: 'Finance',
  read_only: 'Read only',
}

export const ROLE_SCOPE: Record<PartnerUser['role'], string> = {
  admin: 'Publish listings, act on onboarding, change the settlement account.',
  fulfilment: 'Move an order along and answer a buyer. No access to money or listings.',
  finance: 'Statements, settlement and tax. Cannot publish or change a listing.',
  read_only: 'Look at everything, change nothing.',
}

export const TIMEZONES = [
  'Asia/Kolkata (IST)', 'Asia/Dubai (GST)', 'Asia/Singapore (SGT)',
  'Europe/Berlin (CET)', 'Europe/London (GMT)',
  'America/New_York (EST)', 'Africa/Nairobi (EAT)',
]

export const DATE_FORMATS = ['DD MMM YYYY', 'YYYY-MM-DD', 'MM/DD/YYYY']

export function validateProfile(name: string, jobTitle: string): Check {
  if (!name.trim()) {
    return { ok: false, reason: 'A name is required — it is what colleagues see against your actions.' }
  }
  if (!jobTitle.trim()) {
    return { ok: false, reason: 'A job title is required. The marketplace desk uses it to work out who to ask.' }
  }
  return { ok: true }
}

/* ------------------------------------------------------------ inviting --- */

export interface InviteDraft {
  name: string
  email: string
  jobTitle: string
  role: PartnerUser['role']
}

export function blankInvite(): InviteDraft {
  return { name: '', email: '', jobTitle: '', role: 'fulfilment' }
}

/**
 * Whether this invitation can be sent.
 *
 * The domain check is the one worth having: an invitation to a personal address
 * is how somebody who has left keeps their access, and how a supplier ends up
 * inside a seller's console with nobody quite remembering who added them. It is
 * a warning rather than a refusal, because a company that genuinely uses a
 * shared address should not be stopped by a rule about domains.
 */
export function validateInvite(
  draft: InviteDraft, team: readonly PartnerUser[],
): Check {
  if (!draft.name.trim()) return { ok: false, reason: 'A name is required — it is what colleagues see against their actions.' }
  if (!draft.jobTitle.trim()) return { ok: false, reason: 'A job title is required. The marketplace desk uses it to work out who to ask.' }

  const email = draft.email.trim().toLowerCase()
  if (!email) return { ok: false, reason: 'An email address is required — it is what the invitation goes to.' }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    return { ok: false, reason: `"${draft.email.trim()}" is not an email address the invitation could reach.` }
  }

  const already = team.find(u => u.email.toLowerCase() === email)
  if (already) {
    return {
      ok: false,
      reason: already.status === 'removed'
        ? `${already.name} was removed from this account. Restore them rather than inviting them again — it keeps their history attached.`
        : `${already.name} is already on this account as ${ROLE_LABEL[already.role].toLowerCase()}.`,
    }
  }

  const theirs = email.split('@')[1]
  const colleagues = team.filter(u => u.status !== 'removed').map(u => u.email.toLowerCase().split('@')[1])
  const common = colleagues.find(d => colleagues.filter(x => x === d).length > 1) ?? colleagues[0]
  if (common && theirs !== common) {
    return {
      ok: true,
      note: `${draft.email.trim()} is not on ${common}. An invitation to an address your company does not control is one you cannot take back when they leave — send it only if you meant to.`,
    }
  }

  return { ok: true, note: `They will be sent an invitation and appear here as invited until they accept.` }
}

/**
 * Whether this person can be taken off the account.
 *
 * A company left with no administrator can publish nothing and act on no
 * onboarding, and nobody inside it can fix that — they would have to ring the
 * marketplace to get their own account back.
 */
export function canRemove(who: PartnerUser, team: readonly PartnerUser[]): Check {
  if (who.status === 'removed') return { ok: false, reason: `${who.name} has already been removed.` }
  if (who.role !== 'admin') return { ok: true, note: `${who.name} loses access. What they did stays on the audit log.` }

  const others = team.filter(u => u.id !== who.id && u.role === 'admin' && u.status === 'active')
  if (!others.length) {
    return {
      ok: false,
      reason: `${who.name} is the last seller admin here. Make somebody else an admin first, or nobody at this company will be able to publish a listing or act on onboarding.`,
    }
  }
  return { ok: true, note: `${others.length} other admin${others.length === 1 ? '' : 's'} remain.` }
}

/** What actually happens to your work while you are away. Said in terms of the
    work rather than the toggle, because "out of office: on" tells nobody
    whether an approval will sit for a fortnight. */
export function awayCover(me: PartnerUser, peers: readonly PartnerUser[]): string {
  if (!me.out_of_office) return 'Work assigned to you comes to you.'
  const delegate = peers.find(p => p.id === me.delegate_id)
  if (!delegate) {
    return 'You are marked as away with no delegate, so anything assigned to you will simply wait until you are back.'
  }
  return `${delegate.name} can act in your place while you are away. The audit log still records who actually acted, not who it was assigned to.`
}

export function canDelegate(me: PartnerUser, to: PartnerUser): Check {
  if (to.id === me.id) return { ok: false, reason: 'You cannot delegate to yourself.' }
  if (to.status !== 'active') {
    return { ok: false, reason: `${to.name}'s account is ${to.status}, so nothing would reach them.` }
  }
  if (to.role === 'read_only') {
    return { ok: false, reason: `${to.name} can look but not act, so delegating to them would leave the work waiting anyway.` }
  }
  return { ok: true }
}

export interface SecurityGap { who: string; what: string; why: string }

/** What is weak about this company's sign-ins. One row per person rather than a
    percentage: "67% MFA coverage" is not a thing anybody can act on. */
export function securityGaps(users: readonly PartnerUser[]): SecurityGap[] {
  const gaps: SecurityGap[] = []
  for (const u of users) {
    if (u.status !== 'active') continue
    if (!u.mfa) {
      gaps.push({
        who: u.name,
        what: 'No multi-factor authentication',
        why: u.role === 'admin' || u.role === 'finance'
          ? `A stolen password alone would be enough to sign in as them, and ${ROLE_LABEL[u.role].toLowerCase()} can move money.`
          : 'A stolen password alone would be enough to sign in as them.',
      })
    }
    if (u.must_reset) {
      gaps.push({ who: u.name, what: 'Password reset outstanding', why: 'They cannot sign in until they set a new one.' })
    }
    if (u.sessions > 2) {
      gaps.push({
        who: u.name, what: `${u.sessions} sessions open`,
        why: 'More open sessions than devices anybody uses is usually one nobody signed out of.',
      })
    }
  }
  return gaps
}
