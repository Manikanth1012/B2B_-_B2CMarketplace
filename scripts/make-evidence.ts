/* Generate a real document behind every proof this marketplace claims to hold.
 *
 * Two hundred and twelve onboarding documents, the category evidence, the
 * business account's onboarding pack and the customer's own records were rows
 * with a name, a kind and a size — and no file. This writes each of them and
 * uploads it to the private `evidence` bucket at the path the row now carries.
 *
 * The documents are synthetic and say so, on the face of every page. That
 * matters more than it sounds: a demo certificate of incorporation that does
 * not announce itself is a forged certificate of incorporation, and the fact
 * that it was produced for a prototype is not a defence anybody would have to
 * hand when it turned up somewhere it should not.
 *
 * Run with the service role, which is why this lives in `scripts/` and takes
 * its key from the environment rather than from `.env` — the anon key cannot
 * write to a private bucket, and the service role must never reach the client.
 *
 *   SUPABASE_URL=… SUPABASE_SERVICE_ROLE=… npx vite-node scripts/make-evidence.ts
 */
import { createClient } from '@supabase/supabase-js'
import { buildPdf, wrap, Sheet, A4, MARGIN } from '../src/lib/pdf'

const URL = process.env.SUPABASE_URL
const KEY = process.env.SUPABASE_SERVICE_ROLE ?? process.env.SUPABASE_ANON_KEY
if (!URL || !KEY) {
  console.error('SUPABASE_URL and one of SUPABASE_SERVICE_ROLE or SUPABASE_ANON_KEY are required')
  process.exit(1)
}
const db = createClient(URL, KEY, { auth: { persistSession: false } })

/* Two ways in. The service role is the original and writes everything. The
   operator sign-in is the other, for an environment where the service role key
   is deliberately absent — `evidence_operator_all` lets the operator write the
   whole bucket, which is the same permission by a narrower route. It reads only
   what the operator's own policies allow, so it is used with ONLY, below. */
const OPERATOR = process.env.OPERATOR_EMAIL
const OPERATOR_PASSWORD = process.env.OPERATOR_PASSWORD

/* Restrict the run to one section, so a customer's records can be regenerated
   without rewriting two hundred seller documents. */
const ONLY = process.env.ONLY ?? 'all'

/* One customer, by the id on their profile. Without it every consumer document
   in the table is written. */
const CUSTOMER = process.env.CUSTOMER ?? null

const NAVY: [number, number, number] = [13, 71, 161]
const INK: [number, number, number] = [17, 24, 39]
const MUTED: [number, number, number] = [107, 114, 128]
const WASH: [number, number, number] = [246, 248, 251]
const WARN: [number, number, number] = [180, 83, 9]

interface Issuer { name: string; mark: string; lines: string[]; tax: string }

/* The entity whose name goes on the page.
 *
 * This was one constant, and it named the Indian company on every document the
 * script wrote — so a customer in Kisumu held an account record footed with a
 * Bengaluru address and an Indian GSTIN. It is the same fault the bills had
 * before `invoice_issuer` grew a `market`, and the fix is the same: read the
 * entity registered where the customer is.
 *
 * Kept as a fallback for the seller documents, which are held by the
 * marketplace rather than issued to anybody in particular. */
const ISSUER: Issuer = {
  name: 'Aventa Communications Private Limited',
  mark: 'Aventa Telecom',
  lines: ['Level 9, Prestige Tech Park', 'Marathahalli, Bengaluru 560103', 'Karnataka, India'],
  tax: 'GSTIN 29AAACA4471Q1ZV',
}

const issuers = new Map<string, Issuer>()

async function loadIssuers(): Promise<void> {
  const { data } = await db.from('invoice_issuer')
    .select('market, legal_name, trading_name, lines, tax_label, tax_id')
  for (const r of data ?? []) {
    issuers.set(r.market, {
      name: r.legal_name,
      mark: r.trading_name,
      /* The stored lines lead with "Registered office:", which reads as a
         label on a letterhead and as noise in a one-line footer. */
      lines: (r.lines ?? []).map((l: string) => l.replace(/^Registered office:\s*/, '')),
      tax: `${r.tax_label} ${r.tax_id}`,
    })
  }
}

const issuerFor = (market: string | null): Issuer =>
  (market ? issuers.get(market) : undefined) ?? ISSUER

/* What each kind of document actually contains. Keyed on the words in its
   name, because the rows were written as prose rather than as a type. */
const BODIES: { match: RegExp; heading: string; body: (who: string) => string[][] }[] = [
  {
    match: /certificate of incorporation/i,
    heading: 'Certificate of incorporation',
    body: who => [
      ['Registered entity', `${who} is recorded on the register of companies as an incorporated body with limited liability.`],
      ['Registered number', 'The number shown on this certificate is the number by which the entity is identified on every filing.'],
      ['Date of incorporation', 'The date on which the entity came into existence. Trading before this date is trading by a different party.'],
      ['What this proves', 'That the counterparty exists as a legal person and can enter into a contract in its own name. It proves nothing about solvency, ownership or trading history.'],
    ],
  },
  {
    match: /beneficial ownership/i,
    heading: 'Beneficial ownership declaration',
    body: who => [
      ['Declared by', `An officer of ${who}, on the entity's behalf.`],
      ['What is declared', 'Every natural person who ultimately owns or controls more than 25% of the entity, whether directly or through an intermediate holding.'],
      ['Why it is asked for', 'A marketplace that settles money to a company is required to know who ultimately receives it. A chain of holding companies is not an answer to that question.'],
      ['Standing', 'The declaration speaks as at its date. A change of control obliges the entity to submit a fresh one.'],
    ],
  },
  {
    match: /bank verification|bank letter/i,
    heading: 'Bank verification letter',
    body: who => [
      ['Issued by', 'The account-holding bank, on its own letterhead, at the request of the account holder.'],
      ['What it confirms', `That the named account is held in the name of ${who}, and that the sort code and account number quoted belong to it.`],
      ['Why a letter and not a statement', 'A statement proves activity; only the bank confirming the name against the number prevents settlement being paid to somebody who has retyped a digit.'],
      ['Validity', 'Accepted within 90 days of issue. Settlement is not released against a letter older than that.'],
    ],
  },
  {
    match: /tax residency/i,
    heading: 'Tax residency certificate',
    body: who => [
      ['Issued by', 'The tax authority of the jurisdiction in which the entity is resident.'],
      ['What it establishes', `That ${who} is resident for tax purposes in the jurisdiction named, for the period stated.`],
      ['What it is used for', 'Determining whether withholding applies to a settlement, and at what rate. Without it the marketplace withholds at the default rate, which is almost always higher.'],
      ['Period', 'Certificates are issued for a fiscal year and do not carry forward.'],
    ],
  },
  {
    match: /iso 27001|security certificate/i,
    heading: 'ISO/IEC 27001 certificate',
    body: who => [
      ['Certified entity', who],
      ['Scope', 'The information security management system covering the services listed in the scope statement. A certificate is only as wide as its scope, and the scope is the part worth reading.'],
      ['Certification body', 'An accredited body, itself audited. A self-issued certificate is a statement of intent.'],
      ['Surveillance', 'Certification is maintained by annual surveillance audit and full recertification every three years. A certificate is evidence of a system, not of an outcome.'],
    ],
  },
  {
    match: /security questionnaire/i,
    heading: 'Security questionnaire — completed',
    body: who => [
      ['Completed by', `The security contact named by ${who}.`],
      ['Coverage', 'Access control, encryption in transit and at rest, logging and retention, incident response, sub-processors, and the location of every data store.'],
      ['How it is used', 'Answers are compared against the certificate and the penetration test. Where they disagree, the questionnaire is the one that is wrong.'],
      ['Sub-processors', 'Each named sub-processor inherits the obligations in the data processing agreement, and the seller remains answerable for all of them.'],
    ],
  },
  {
    match: /data processing agreement/i,
    heading: 'Data processing agreement',
    body: who => [
      ['Parties', `Aventa Communications Private Limited as controller, and ${who} as processor.`],
      ['Subject matter', 'Personal data of marketplace customers, processed solely to fulfil orders placed through the marketplace.'],
      ['Instructions', 'The processor acts only on documented instructions. Anything else is a processing operation the processor is answerable for in its own right.'],
      ['Sub-processing', 'No sub-processor without prior written authorisation, and each on terms no weaker than these.'],
      ['On termination', 'Return or deletion at the controller’s election, and certification that no copy remains.'],
    ],
  },
  {
    match: /marketplace terms|countersigned/i,
    heading: 'Marketplace terms — countersigned',
    body: who => [
      ['Parties', `Aventa Communications Private Limited and ${who}.`],
      ['Commercial terms', 'Commission, fees and the settlement cycle are set by the plan the seller is on and may be changed on notice. The plan in force is the one on the seller record.'],
      ['Listing obligations', 'Every listing must satisfy the rules of the category it is filed under. A listing that stops satisfying them is withdrawn, not renegotiated.'],
      ['Settlement', 'Net of commission, fees and refunds, on the cycle stated. A debt to the marketplace is recovered from settlement rather than by suspension.'],
      ['Termination', 'On notice by either party. Orders already placed are fulfilled; the settlement that follows them is paid.'],
    ],
  },
  {
    match: /application form/i,
    heading: 'Application to sell',
    body: who => [
      ['Applicant', who],
      ['Categories applied for', 'Each category carries its own evidence requirements, and a category opens only when all of them are satisfied.'],
      ['Declarations', 'That the information given is true, that the signatory is authorised, and that nothing material has been withheld.'],
      ['What happens next', 'The application passes through seven gates. A gate that fails names what failed rather than refusing.'],
    ],
  },
  {
    match: /go-live checklist/i,
    heading: 'Go-live checklist — signed off',
    body: who => [
      ['Seller', who],
      ['Catalogue', 'At least one listing approved, priced within its band, with images and a description that match the product.'],
      ['Fulfilment', 'Dispatch route tested end to end, including a return.'],
      ['Support', 'A named contact, a response target, and an escalation that reaches a person.'],
      ['Settlement', 'Bank details verified against the bank letter, and a first settlement modelled without being paid.'],
    ],
  },
  {
    match: /integration test|sandbox|test report/i,
    heading: 'Integration test report',
    body: who => [
      ['Environment', 'Sandbox. No customer data, no real money, no live stock.'],
      ['Cases exercised', 'Order placed, order acknowledged, order dispatched, tracking published, order delivered, refund raised, refund settled.'],
      ['Result', 'Every case passed at the attempt recorded. A case that passed only on retry is recorded as a retry.'],
      ['Not covered', 'Load, failover and partial outage. Those are exercised against the live integration after go-live, under supervision.'],
    ],
  },
  {
    match: /insurance|liability/i,
    heading: 'Certificate of insurance',
    body: who => [
      ['Insured', who],
      ['Cover', 'Public and product liability to the limit stated, for the period stated.'],
      ['Why it is required', 'A product sold through this marketplace is sold by the seller. The marketplace is not the insurer of last resort and does not intend to become one.'],
      ['Renewal', 'Cover lapsing takes the seller’s categories with it until it is replaced.'],
    ],
  },
]

/* What a retail customer holds. Kept apart from the seller shapes because the
   words are not interchangeable: "held as evidence against the onboarding gate
   it was submitted for" is a sentence about a seller, and printing it on a
   customer's identity certificate says something untrue about that customer. */
const CONSUMER_BODIES: typeof BODIES = [
  {
    match: /customer agreement/i,
    heading: 'Customer agreement',
    body: who => [
      ['Parties', `Aventa Communications Private Limited and ${who}.`],
      ['What is agreed', 'The plan, what it includes, what it costs and what falls outside it. Anything not listed is charged at the rates published for it.'],
      ['Notice', 'Either party may end the agreement on the notice stated. Charges run to the end of the notice period and no further.'],
      ['The number', 'The number stays with the account holder. On closure it can be ported out for as long as the rules allow, and is only recycled after that.'],
    ],
  },
  {
    /* A customer who came in through the operator's identity provider. This is
       deliberately not an identity certificate: the marketplace never ran a
       check and never saw the document, so a page that reads like the result of
       one would be claiming something it did not do. What it records is the
       assertion — who vouched, for what, when, and where the underlying
       document actually lives. */
    match: /verified by aventa id|identity assertion|federated identity/i,
    heading: 'Identity assertion from Aventa ID',
    body: who => [
      ['Subject', who],
      ['Asserted by', 'Aventa Telecom, acting as the identity provider for this account.'],
      ['What was asserted', 'Name, mobile number, service address and a verified government identity document, together with the date that document was checked.'],
      ['Where the check happened', 'At the operator, before it would activate a line — which is where the rules already require it. The marketplace did not repeat it.'],
      ['What is held here', 'This record of the assertion, and nothing else. The identity document itself was never sent to the marketplace, so no proof of identity and no proof of address were collected on this account.'],
      ['If the assertion is withdrawn', 'Unlinking the Aventa ID leaves the marketplace account in place but removes the verified standing. Anything that needs a verified identity would then have to be established here directly.'],
    ],
  },
  {
    /* The consumer wording. Without an entry here the seller shape wins, and it
       talks about counter-signature and onboarding gates — sentences about a
       seller, printed on a customer's paperwork. */
    match: /marketplace terms/i,
    heading: 'Marketplace terms — accepted',
    body: who => [
      ['Accepted by', who],
      ['What was accepted', 'The terms on which the marketplace sells: what is bought from whom, who answers for a fault, how refunds are decided and what happens to the account if it closes.'],
      ['Why this one is here', 'An operator can vouch for who you are. It cannot agree to the marketplace\'s own contract on your behalf, so this is accepted here whichever door the account came through.'],
      ['Changes', 'A material change is notified before it takes effect, and the version accepted is the one that governs until then.'],
    ],
  },
  {
    match: /warranty/i,
    heading: 'Manufacturer\'s warranty',
    body: who => [
      ['Held by', who],
      ['What is covered', 'Defects in materials and workmanship for the period stated, from the date of delivery rather than the date of manufacture.'],
      ['What is not', 'Accidental damage, liquid ingress, cosmetic wear and anything arising after an unauthorised repair. Those are what a protection policy is for.'],
      ['Claiming', 'Through the seller, who handles it with the manufacturer. A warranty claim does not run through the refunds process and does not have a refund\'s deadlines.'],
    ],
  },
  {
    match: /policy schedule|device protect/i,
    heading: 'Protection policy schedule',
    body: who => [
      ['Policyholder', who],
      ['Underwriter', 'Aegis Assurance. The marketplace sells the cover and does not carry the risk, so a claim is decided by the underwriter.'],
      ['What is covered', 'Accidental damage, liquid damage and theft, for the device named on the schedule.'],
      ['Excess', 'Payable on each claim, and stated on the schedule. A claim below the excess is not worth making and the schedule says so.'],
      ['Cancelling', 'Cover can be stopped at the end of any billing period. Stopping it does not refund periods already covered.'],
    ],
  },
  {
    match: /vat statement|tax statement/i,
    heading: 'Annual tax statement',
    body: who => [
      ['Account holder', who],
      ['What this shows', 'Every bill issued in the tax year, the tax charged on each and the total, in the currency the account is billed in.'],
      ['Why it exists', 'It is the document an accountant asks for and the one nobody keeps the individual bills to reconstruct.'],
      ['Standing', 'A statement of what was charged. It is not itself a tax invoice — the individual bills are, and they remain available on the account.'],
    ],
  },
  {
    match: /proof of identity/i,
    heading: 'Identity verification certificate',
    body: who => [
      ['Subject', who],
      ['What was checked', 'Name, date of birth and address, against a document issued by a government and against an independent source.'],
      ['Result', 'Verified. The check was completed before the line was activated, which is the order the rules require.'],
      ['What is held', 'This certificate, and nothing else. The identity document itself stays with the verification agent — an operator that does not hold a copy cannot lose one.'],
    ],
  },
  {
    match: /portability|porting/i,
    heading: 'Number portability authorisation',
    body: who => [
      ['Authorised by', who],
      ['What was authorised', 'The transfer of the number named to Aventa Telecom, and the instruction to the losing operator to release it.'],
      ['Release', 'The losing operator confirmed release. A port completes on that confirmation, not on the request.'],
      ['If it goes wrong', 'A port that fails leaves the number where it was. Service on the old account continues until the port completes.'],
    ],
  },
  {
    match: /direct debit|mandate/i,
    heading: 'Direct debit mandate',
    body: who => [
      ['Account holder', who],
      ['What is authorised', 'Collection of amounts due under the agreement, from the account quoted, on or after the date shown on each bill.'],
      ['Notice of a change', 'A change to the amount or the date is notified in advance of collection. A bill is that notice.'],
      ['Cancelling', 'The mandate can be cancelled with the bank at any time. Cancelling it does not settle what is owed, and the account moves to another method or falls into arrears.'],
    ],
  },
  {
    match: /plan change/i,
    heading: 'Plan change confirmation',
    body: who => [
      ['Account holder', who],
      ['What changed', 'The plan on the account, from the one previously held to the one named. Everything else on the account is unaffected.'],
      ['When it took effect', 'On the date shown. Charges before it are on the old plan and after it on the new one.'],
      ['Pro-rating', 'The bill covering the change carries a part-month at each rate rather than a full month at either. The two part-months add to one.'],
    ],
  },
  {
    match: /device protection|cover certificate/i,
    heading: 'Device protection certificate',
    body: who => [
      ['Covered', `The handset supplied to ${who}, identified by the serial number on the account.`],
      ['What is covered', 'Accidental damage, liquid damage and theft, for the period shown.'],
      ['What is not', 'Loss without evidence of theft, cosmetic wear, and damage arising after an unauthorised repair.'],
      ['Claiming', 'Report within the window stated, pay the excess, and the device is repaired or replaced. A replacement is of equivalent specification, not necessarily the same model.'],
    ],
  },
  {
    match: /privacy and marketing|marketing preferences/i,
    heading: 'Privacy and marketing preferences',
    body: who => [
      ['Account holder', who],
      ['Consented to', 'Service messages about this account, which are sent regardless of marketing preference because they are not marketing.'],
      ['Refused', 'Marketing by any channel not ticked below, and the sharing of contact details with third parties for their own marketing.'],
      ['Changing this', 'Preferences can be changed at any time in the account, and take effect on the next send rather than retrospectively.'],
      ['Standing', 'This record states the position as at the date shown. It is superseded by any later change.'],
    ],
  },
  {
    match: /register extract|filed accounts|trade reference|gst registration/i,
    heading: 'Onboarding evidence',
    body: who => [
      ['Held for', who],
      ['Purpose', 'Submitted against the onboarding step named above, and assessed as part of it.'],
      ['Standing', 'Evidence speaks as at its date. A step that has been signed off is not reopened by a document going stale, but the review that follows will ask for a current one.'],
    ],
  },
]

const FALLBACK = {
  heading: 'Supporting document',
  body: (who: string) => [
    ['Held for', who],
    ['Purpose', 'Held as evidence against the onboarding gate or category rule it was submitted for.'],
    ['Retention', 'Kept for the life of the relationship and for the period the applicable rules require afterwards.'],
  ],
}

const CONSUMER_FALLBACK = {
  heading: 'Account record',
  body: (who: string) => [
    ['Account holder', who],
    ['Purpose', 'Held on the account as a record of what was agreed, and available to the account holder at any time.'],
    ['Standing', 'The record states the position as at its date and is superseded by any later one.'],
  ],
}

function shape(name: string, consumer = false) {
  if (consumer) {
    return CONSUMER_BODIES.find(b => b.match.test(name))
      ?? BODIES.find(b => b.match.test(name))
      ?? CONSUMER_FALLBACK
  }
  return BODIES.find(b => b.match.test(name))
    ?? CONSUMER_BODIES.find(b => b.match.test(name))
    ?? FALLBACK
}

/**
 * One document.
 *
 * Every page carries the specimen notice. A demo certificate that does not
 * announce itself is a forged certificate, and "it was for a prototype" is not
 * something anybody wants to be explaining later.
 */
function document(opts: {
  title: string
  who: string
  reference: string
  issued: string
  kind: string
  meta: [string, string][]
  /* A customer's own record rather than a counterparty's submission. */
  consumer?: boolean
  /* A sentence about this particular document, above the standard prose. */
  intro?: string
  /* Whose name goes on it. Defaults to the marketplace's own entity, which is
     right for a seller's submission and wrong for a customer's record. */
  issuer?: Issuer
}): Uint8Array {
  const s = new Sheet()
  const iss = opts.issuer ?? ISSUER
  const spec = shape(opts.title, opts.consumer)
  const HOLDER = opts.consumer ? 'Account holder' : 'Held for'

  s.text(iss.mark, { size: 14, font: 'bold', colour: NAVY })
  s.text(opts.kind.toUpperCase(), { x: s.right, align: 'right', size: 8, font: 'bold', colour: MUTED })
  s.y += 18
  s.rule({ colour: NAVY, width: 1.6, gap: 16 })

  /* The gap has to clear the line it follows, or the subheading prints through
     the title. A 15pt line needs more than 6 points of advance. */
  s.line(opts.title, { size: 15, font: 'bold', colour: INK, gap: 19 })
  if (spec.heading !== opts.title) s.line(spec.heading, { size: 9, colour: MUTED, gap: 14 })

  s.room(28)
  s.band(24, WASH)
  s.text(`SPECIMEN — generated for the Aventa marketplace prototype. Not a genuine ${spec.heading.toLowerCase()}.`,
    { x: s.left + 10, y: s.y + 12, size: 7.5, font: 'bold', colour: WARN })
  s.y += 34

  /* Values wrap in their own column. A meta value set as one unbroken run is a
     line that leaves the page — and a document whose right-hand edge is
     missing is not one anybody can rely on. */
  const VALUE_X = s.left + 130
  for (const [k, v] of [
    [HOLDER, opts.who],
    ['Reference', opts.reference],
    ['Dated', opts.issued],
    ...opts.meta,
  ] as [string, string][]) {
    const rows = wrap(v, s.right - VALUE_X, 8.5)
    s.room(rows.length * 12 + 4)
    s.text(k, { size: 7, font: 'bold', colour: MUTED })
    for (const [i, row] of rows.entries()) {
      s.text(row, { x: VALUE_X, y: s.y + i * 11, size: 8.5, colour: INK })
    }
    s.y += Math.max(13, rows.length * 11 + 2)
  }

  s.gap(10)
  s.rule({ colour: [226, 232, 240], gap: 12 })

  if (opts.intro) {
    s.paragraph(opts.intro, { size: 8.5, colour: INK })
    s.gap(10)
  }

  /* A body pair that says nothing but the counterparty's name is already in
     the meta block three lines above it. Printing it twice reads as a template
     showing through. */
  for (const [heading, prose] of spec.body(opts.who).filter(([, v]) => v !== opts.who)) {
    s.room(30)
    /* The gap has to clear the line, not merely separate it: a 9pt heading
       advanced by 5 points is a heading with the paragraph printed through it. */
    s.line(heading, { size: 9, font: 'bold', colour: INK, gap: 12 })
    s.paragraph(prose, { size: 8, colour: MUTED })
    s.gap(7)
  }

  s.gap(14)
  s.rule({ colour: [226, 232, 240], gap: 10 })
  s.paragraph(
    `Issued by ${iss.name}, ${iss.lines.join(', ')}. ${iss.tax}. `
    + 'This document exists so that a record in the marketplace can be opened and read. '
    + 'It carries no legal effect and represents no real person or company.',
    { size: 7, colour: MUTED })

  const total = s.pages.length
  s.pages.forEach((page, i) => {
    page.push({
      kind: 'text', text: `${opts.reference}   ·   SPECIMEN   ·   Page ${i + 1} of ${total}`,
      x: A4.width / 2, y: A4.height - MARGIN + 14, size: 6.5, font: 'regular',
      align: 'centre', colour: MUTED,
    })
  })

  return buildPdf(s.pages, { title: `${opts.title} - ${opts.reference}`, author: iss.name })
}

const DAY: Intl.DateTimeFormatOptions = { day: '2-digit', month: 'short', year: 'numeric' }

const dated = (n: number) =>
  new Date(2024, 2, 14 + (n % 700)).toLocaleDateString('en-GB', DAY)

/* One date format across every document. A page that reads "04 Aug 2025" in
   one row and "2025-08-04" in the next looks assembled rather than issued. */
function day(value: string | null | undefined, fallback: string): string {
  if (!value) return fallback
  const d = new Date(value)
  return isNaN(d.getTime()) ? value : d.toLocaleDateString('en-GB', DAY)
}

const sentence = (s: string) => s ? s[0].toUpperCase() + s.slice(1) : s

async function put(path: string, bytes: Uint8Array): Promise<boolean> {
  const { error } = await db.storage.from('evidence')
    .upload(path, bytes, { contentType: 'application/pdf', upsert: true })
  if (error) { console.error(`  ! ${path}: ${error.message}`); return false }
  return true
}

/**
 * The customers' own records.
 *
 * Its own function because it is the one section an operator sign-in can run on
 * its own: regenerating a customer's paperwork should not mean rewriting two
 * hundred sellers' onboarding documents.
 */
async function consumerRecords(): Promise<{ made: number; failed: number }> {
  let made = 0
  let failed = 0
  /* Keyed on the document's own owner rather than on `id = 'me'`. That lookup
     was right while there was one registered customer and wrote the first
     customer's name onto the second one's paperwork the moment there were two. */
  const { data: mine } = await db.from('consumer_documents').select('*').order('sort_order')
  const { data: profiles } = await db.from('consumer_profile').select('name, customer_id, user_id, market')
  const owner = (userId: string | null) => profiles?.find(p => p.user_id === userId) ?? null

  const wanted = (mine ?? []).filter(c =>
    !CUSTOMER || owner(c.user_id)?.customer_id === CUSTOMER)

  for (const c of wanted) {
    const who = owner(c.user_id)
    const ok = await put(c.path, document({
      title: c.name, who: who?.name ?? 'The account holder', reference: c.id,
      issued: day(c.issued, c.issued), kind: c.kind, consumer: true, intro: c.detail,
      /* The entity registered where this customer is, not the one the script
         was written in. A Kenyan account record footed with an Indian GSTIN is
         the same fault the bills used to have. */
      issuer: issuerFor(who?.market ?? null),
      meta: [['Account', who?.customer_id ?? '—'], ['Category', c.category]],
    }))
    ok ? made++ : failed++
  }
  console.log(`customer records: ${wanted.length} written`)
  return { made, failed }
}

async function main() {
  let made = 0
  let failed = 0

  if (OPERATOR && OPERATOR_PASSWORD) {
    const { error } = await db.auth.signInWithPassword({ email: OPERATOR, password: OPERATOR_PASSWORD })
    if (error) { console.error(`Could not sign in as ${OPERATOR}: ${error.message}`); process.exit(1) }
    console.log(`signed in as ${OPERATOR}`)
  }

  await loadIssuers()
  console.log(`issuers: ${[...issuers.keys()].sort().join(', ') || 'none — falling back to the Indian entity'}`)

  if (ONLY === 'consumer') {
    const only = await consumerRecords()
    console.log(`\n${only.made} documents uploaded, ${only.failed} failed`)
    if (only.failed) process.exit(1)
    return
  }

  /* ---- the sellers' gate documents ---- */
  const { data: docs } = await db.from('onboarding_documents').select('*').order('partner_id')
  const { data: partners } = await db.from('partners').select('id, name')
  const nameOf = (id: string | null) => partners?.find(p => p.id === id)?.name ?? id ?? 'A seller'

  for (const [i, d] of (docs ?? []).entries()) {
    const ok = await put(d.path, document({
      title: d.name, who: nameOf(d.partner_id), reference: d.id,
      issued: day(d.uploaded_at, dated(i)),
      kind: d.kind,
      meta: [['Gate', d.gate_id ?? '—'], ['Submitted by', d.uploaded_by ?? 'The seller']],
    }))
    ok ? made++ : failed++
  }
  console.log(`gate documents: ${made} written`)

  /* ---- the category evidence ---- */
  /* Only what was actually submitted. `document` on an outstanding row names
     the thing the category demands, not a thing that arrived — writing a file
     for one of those fabricates evidence against a gate nobody satisfied. The
     path is null on exactly those rows, so this filter and the database agree
     by construction rather than by both being remembered. */
  const { data: evidence } = await db.from('partner_category_evidence')
    .select('*').not('path', 'is', null).not('submitted_at', 'is', null)
  for (const [i, e] of (evidence ?? []).entries()) {
    const ok = await put(e.path, document({
      title: e.document, who: nameOf(e.partner_id), reference: e.id,
      issued: day(e.submitted_at, dated(i)),
      kind: e.kind ?? 'PDF',
      meta: [
        ['Category', e.category_id], ['Rule', e.rule_id ?? '—'],
        ['State', sentence(e.state)], ['Expires', day(e.expires_on, 'Does not expire')],
      ],
    }))
    ok ? made++ : failed++
  }
  console.log(`category evidence: ${(evidence ?? []).length} written`)

  /* ---- the business account's onboarding pack ---- */
  const { data: steps } = await db.from('enterprise_onboarding').select('*')
  const { data: accounts } = await db.from('enterprise_accounts').select('id, legal_name, company')
  for (const step of steps ?? []) {
    /* The step's documents are jsonb objects — `{ name, kind, size }` — not
       bare names. Both shapes are read, because a row written by hand later
       should not silently produce a page titled "[object Object]". */
    const listed: { name: string; kind?: string }[] = (Array.isArray(step.documents) ? step.documents : [])
      .map((d: unknown) => typeof d === 'string' ? { name: d } : (d as { name: string; kind?: string }))
    const paths: string[] = step.document_paths ?? []
    const acc = accounts?.find(a => a.id === step.account_id)
    for (const [j, path] of paths.entries()) {
      const ok = await put(path, document({
        title: listed[j]?.name ?? step.name, who: acc?.legal_name ?? acc?.company ?? step.account_id,
        reference: `${step.id}-${j + 1}`, issued: day(step.done_on, dated(j)), kind: listed[j]?.kind ?? 'PDF',
        meta: [['Onboarding step', step.name], ['State', sentence(step.state)], ['Signed off by', step.done_by ?? '—']],
      }))
      ok ? made++ : failed++
    }
  }
  console.log('business onboarding: written')

  const c = await consumerRecords()
  made += c.made
  failed += c.failed


  console.log(`\n${made} documents uploaded, ${failed} failed`)
  if (failed) process.exit(1)
}

void main()
