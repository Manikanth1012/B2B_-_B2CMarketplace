/* Touches the live Supabase project. Reads only.
 *
 * Every proof in this marketplace used to be a filename. Now each row carries a
 * path, and there is a file at the end of it. Two things have to hold for that
 * to be true rather than merely intended:
 *
 *   1. Every path resolves. A row pointing at nothing is the same broken
 *      promise as a row pointing at nowhere, and it looks identical on screen.
 *   2. The bucket's rule and `evidence.ts` agree. The rule is written twice —
 *      once in SQL as a storage policy and once in TypeScript so a console can
 *      decline to show a dead button — and two statements of one rule drift.
 *      Here they are read against each other, per persona, per folder.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { supabase } from './supabase'
import { signIn, signOut } from './authRepo'
import { canOpen } from './evidence'
import type { Viewer } from './evidence'
import { openEvidence, loadConsumerDocuments, BUCKET } from './evidenceRepo'

const OPERATOR = { email: 'anika.sharma@aventa.com', password: 'operator123' }
const PARTNER = { email: 'rajesh.kumar@nimbussensors.com', password: 'partner123' }
const ENTERPRISE = { email: 'vikram.shah@smartbuild.in', password: 'enterprise123' }
const CONSUMER = { email: 'priya.raman@example.com', password: 'demo1234' }

const DEMO_PARTNER = 'PTR-1004'
const DEMO_ACCOUNT = 'ENT-2007'
const DEMO_CUSTOMER = 'CUS-449021'

interface Doc { id: string; partner_id: string; name: string; path: string | null }
interface Evi { id: string; partner_id: string; document: string | null; path: string | null; submitted_at: string | null }
interface Step { id: string; account_id: string; documents: unknown; document_paths: string[] }

let docs: Doc[] = []
let evidence: Evi[] = []
let steps: Step[] = []

beforeAll(async () => {
  await signIn(OPERATOR.email, OPERATOR.password)
  const [d, e, s] = await Promise.all([
    supabase.from('onboarding_documents').select('id,partner_id,name,path'),
    supabase.from('partner_category_evidence').select('id,partner_id,document,path,submitted_at'),
    supabase.from('enterprise_onboarding').select('id,account_id,documents,document_paths'),
  ])
  docs = (d.data ?? []) as Doc[]
  evidence = (e.data ?? []) as Evi[]
  steps = (s.data ?? []) as Step[]
  expect(docs.length, 'no onboarding documents to check at all').toBeGreaterThan(100)
})

afterAll(async () => { await signOut() })

/* ------------------------------------------------ every row knows its file -- */

describe('the records', () => {
  it('gives every gate document a path', () => {
    const orphans = docs.filter(d => !d.path)
    expect(orphans.map(d => d.id)).toEqual([])
  })

  it('files every path under the seller it belongs to', () => {
    const misfiled = docs.filter(d => d.path!.split('/')[0] !== d.partner_id)
    expect(misfiled.map(d => d.id)).toEqual([])
  })

  it('gives a path to submitted evidence and to nothing else', () => {
    /* `document` on an outstanding row names what the category demands, not
       what arrived — six rows read "Type-approval certificate · Not supplied"
       and had a generated certificate behind them, which is fabricated
       evidence rather than a broken link. `submitted_at` is the only column
       that records that something actually came in, so it is the test. */
    expect(evidence.filter(e => e.submitted_at && e.document && !e.path).map(e => e.id)).toEqual([])
    expect(evidence.filter(e => !e.submitted_at && e.path).map(e => e.id)).toEqual([])
    expect(evidence.filter(e => e.path).length, 'no category evidence has a file at all').toBeGreaterThan(20)
  })

  it('gives the business onboarding pack one path per document, in order', () => {
    for (const s of steps) {
      const named = Array.isArray(s.documents) ? s.documents.length : 0
      expect(s.document_paths.length, `${s.id} lists ${named} documents and ${s.document_paths.length} paths`)
        .toBe(named)
      for (const p of s.document_paths) expect(p.split('/')[0]).toBe(s.account_id)
    }
    expect(steps.some(s => s.document_paths.length > 0), 'no business step has any document').toBe(true)
  })

  it('never gives two documents the same path', () => {
    const all = [
      ...docs.map(d => d.path!),
      ...evidence.filter(e => e.path).map(e => e.path!),
      ...steps.flatMap(s => s.document_paths),
    ]
    const seen = new Set<string>()
    const clashes = all.filter(p => (seen.has(p) ? true : (seen.add(p), false)))
    expect(clashes).toEqual([])
  })
})

/* ---------------------------------------------- every path opens something -- */

describe('as the operator', () => {
  const viewer: Viewer = { persona: 'operator' }

  it('opens a seller document, a category evidence file and a business pack page', async () => {
    const sample = [
      docs.find(d => d.partner_id === DEMO_PARTNER)!,
      { ...evidence.find(e => e.path)!, name: 'category evidence' },
      { id: 'pack', name: 'onboarding pack', path: steps.find(s => s.document_paths.length)!.document_paths[0] },
    ]
    for (const doc of sample) {
      const res = await openEvidence(viewer, doc as { id: string; name: string; path: string })
      expect(res.error, `${doc.path} did not open`).toBeNull()
      expect(res.url).toContain(BUCKET)
    }
  })

  it('actually fetches the bytes, and they are a PDF', async () => {
    const doc = docs.find(d => d.partner_id === DEMO_PARTNER && d.path!.endsWith('.pdf'))!
    const { url } = await openEvidence({ persona: 'operator' }, doc)
    const body = await fetch(url!).then(r => r.arrayBuffer())
    const head = new TextDecoder().decode(new Uint8Array(body).slice(0, 8))
    expect(head, `${doc.path} is not a PDF`).toContain('%PDF-')
    expect(body.byteLength).toBeGreaterThan(1000)
  })

  it('says the file is missing rather than pretending, for a path nothing was written to', async () => {
    const res = await openEvidence({ persona: 'operator' },
      { id: 'x', name: 'Nothing', path: `${DEMO_PARTNER}/gates/not-a-real-document.pdf` })
    expect(res.url).toBeNull()
    expect(res.error).toMatch(/missing/i)
  })
})

describe('as the seller', () => {
  beforeAll(async () => { await signOut(); await signIn(PARTNER.email, PARTNER.password) })
  afterAll(async () => { await signOut(); await signIn(OPERATOR.email, OPERATOR.password) })

  const viewer: Viewer = { persona: 'partner', partnerId: DEMO_PARTNER }

  it('opens its own documents', async () => {
    const mine = docs.filter(d => d.partner_id === DEMO_PARTNER).slice(0, 3)
    expect(mine.length).toBeGreaterThan(0)
    for (const d of mine) {
      const res = await openEvidence(viewer, d)
      expect(res.error, `${d.path} did not open for its own seller`).toBeNull()
    }
  })

  it('is refused another seller\'s, by the bucket and not only by the check', async () => {
    const theirs = docs.find(d => d.partner_id !== DEMO_PARTNER)!
    /* Past the client-side check on purpose — claiming to be the other seller —
       so what is being tested is the storage policy rather than `canOpen`. */
    const lying: Viewer = { persona: 'partner', partnerId: theirs.partner_id }
    expect(canOpen(lying, theirs.path)).toBe(true)

    const { data } = await supabase.storage.from(BUCKET).createSignedUrl(theirs.path!, 60)
    expect(data?.signedUrl, `the bucket signed ${theirs.path} for the wrong seller`).toBeFalsy()
  })

  it('cannot reach the business account\'s pack or a customer\'s records', async () => {
    const pack = steps.find(s => s.document_paths.length)!.document_paths[0]
    for (const path of [pack, `${DEMO_CUSTOMER}/cd-001.pdf`]) {
      const { data } = await supabase.storage.from(BUCKET).createSignedUrl(path, 60)
      expect(data?.signedUrl, `the bucket signed ${path} for a seller`).toBeFalsy()
    }
  })
})

describe('as the business buyer', () => {
  beforeAll(async () => { await signOut(); await signIn(ENTERPRISE.email, ENTERPRISE.password) })
  afterAll(async () => { await signOut(); await signIn(OPERATOR.email, OPERATOR.password) })

  const viewer: Viewer = { persona: 'enterprise', accountId: DEMO_ACCOUNT }

  it('opens every document in its own onboarding pack', async () => {
    const mine = steps.filter(s => s.account_id === DEMO_ACCOUNT).flatMap(s => s.document_paths)
    expect(mine.length).toBeGreaterThan(0)
    for (const path of mine) {
      const res = await openEvidence(viewer, { id: path, name: 'Pack document', path })
      expect(res.error, `${path} did not open for its own account`).toBeNull()
    }
  })

  it('cannot reach a seller\'s onboarding documents', async () => {
    const theirs = docs.find(d => d.partner_id === DEMO_PARTNER)!
    const { data } = await supabase.storage.from(BUCKET).createSignedUrl(theirs.path!, 60)
    expect(data?.signedUrl, `the bucket signed ${theirs.path} for a buyer`).toBeFalsy()
  })
})

describe('as the customer', () => {
  beforeAll(async () => { await signOut(); await signIn(CONSUMER.email, CONSUMER.password) })
  afterAll(async () => { await signOut(); await signIn(OPERATOR.email, OPERATOR.password) })

  const viewer: Viewer = { persona: 'consumer', customerId: DEMO_CUSTOMER }

  it('has documents of its own, each filed under its own customer id', async () => {
    const { documents, loadError } = await loadConsumerDocuments()
    expect(loadError).toBeNull()
    expect(documents.length).toBeGreaterThan(0)
    for (const d of documents) {
      expect(d.path, `${d.id} has no file`).toBeTruthy()
      expect(d.path!.split('/')[0], `${d.id} is filed under the wrong customer`).toBe(DEMO_CUSTOMER)
    }
  })

  it('opens every one of them, and gets a PDF back', async () => {
    const { documents } = await loadConsumerDocuments()
    for (const d of documents) {
      const res = await openEvidence(viewer, d)
      expect(res.error, `${d.name} did not open`).toBeNull()
    }
    const first = await openEvidence(viewer, documents[0])
    const head = await fetch(first.url!).then(r => r.arrayBuffer())
      .then(b => new TextDecoder().decode(new Uint8Array(b).slice(0, 8)))
    expect(head).toContain('%PDF-')
  })

  it('downloads under the document\'s own name rather than the row id', async () => {
    const { documents } = await loadConsumerDocuments()
    const res = await openEvidence(viewer, documents[0], { download: true })
    expect(res.url).toContain('download=')
  })

  it('cannot reach a seller\'s documents or the business pack', async () => {
    const pack = steps.find(s => s.document_paths.length)!.document_paths[0]
    const sellerDoc = docs.find(d => d.partner_id === DEMO_PARTNER)!.path!
    for (const path of [pack, sellerDoc]) {
      const { data } = await supabase.storage.from(BUCKET).createSignedUrl(path, 60)
      expect(data?.signedUrl, `the bucket signed ${path} for a customer`).toBeFalsy()
    }
  })

  it('cannot read another customer\'s document rows', async () => {
    /* The table's own policy, not the bucket's. A row visible to the wrong
       account leaks the document's name and what it is about even if the file
       itself stays shut. */
    const { data } = await supabase.from('consumer_documents').select('id,user_id')
    const mine = await supabase.auth.getUser()
    for (const row of data ?? []) {
      expect((row as { user_id: string }).user_id).toBe(mine.data.user?.id)
    }
  })
})

/* ------------------------------------------- the two statements of one rule -- */

describe('the check and the bucket agree', () => {
  beforeAll(async () => { await signOut(); await signIn(PARTNER.email, PARTNER.password) })
  afterAll(async () => { await signOut(); await signIn(OPERATOR.email, OPERATOR.password) })

  it('signs exactly the paths `canOpen` says it will, across a spread of folders', async () => {
    const viewer: Viewer = { persona: 'partner', partnerId: DEMO_PARTNER }
    const spread = [
      ...docs.filter(d => d.partner_id === DEMO_PARTNER).slice(0, 4),
      ...docs.filter(d => d.partner_id !== DEMO_PARTNER).slice(0, 4),
      ...evidence.filter(e => e.path).slice(0, 4).map(e => ({ id: e.id, partner_id: e.partner_id, path: e.path })),
    ]
    expect(spread.length).toBeGreaterThan(6)

    for (const d of spread) {
      const predicted = canOpen(viewer, d.path)
      const { data } = await supabase.storage.from(BUCKET).createSignedUrl(d.path!, 60)
      expect(!!data?.signedUrl, `${d.path}: check said ${predicted}, bucket said ${!!data?.signedUrl}`)
        .toBe(predicted)
    }
  })
})
