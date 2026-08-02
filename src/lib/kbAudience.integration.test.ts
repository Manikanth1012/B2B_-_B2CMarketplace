/* Touches the live Supabase project. Owns only rows it creates.
 *
 * `kb.ts` says who may read a piece of the knowledge base. Until now the
 * database said nothing at all: `public_read_kb_articles` allowed any published
 * article to anybody, and `read_kb_faqs` was `using (true)` — every question,
 * drafts included, readable by anyone including a signed-out visitor. Persona
 * scoping happened in the client, which makes it a display preference rather
 * than a rule.
 *
 * So these assertions are the ones that matter: they read as each persona and
 * check what actually comes back over the wire, rather than what the screen
 * chooses to draw.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { supabase } from './supabase'
import { signIn, signOut } from './authRepo'
import { loadKb } from './kbRepo'
import { saveFaq, loadKbAdmin } from './kbAdminRepo'
import { visibleTo } from './kb'
import type { KbFaq } from './kb'

const OPERATOR = { email: 'anika.sharma@aventa.com', password: 'operator123' }
const PARTNER = { email: 'rajesh.kumar@nimbussensors.com', password: 'partner123' }
const CONSUMER = { email: 'priya.raman@example.com', password: 'demo1234' }

const DEMO_PARTNER = 'PTR-1004'
/* The seeded question addressed to the demo seller alone. */
const ADDRESSED = 'FAQ-NIMBUS-COLDCHAIN'
const MINE = 'FAQ-TEST-ADDRESSED'
const THEIRS = 'FAQ-TEST-SOMEBODY-ELSE'

let otherPartner = ''

const drop = async (id: string) => { await supabase.from('kb_faqs').delete().eq('id', id) }

beforeAll(async () => {
  await signIn(OPERATOR.email, OPERATOR.password)
  const { data } = await supabase.from('partners').select('id').neq('id', DEMO_PARTNER).limit(1)
  otherPartner = ((data ?? []) as { id: string }[])[0]?.id ?? ''
  expect(otherPartner, 'no second seller to address something away from').toBeTruthy()
  await drop(MINE); await drop(THEIRS)
})

afterAll(async () => {
  await signOut(); await signIn(OPERATOR.email, OPERATOR.password)
  await drop(MINE); await drop(THEIRS)
  await signOut()
})

/* ------------------------------------------------- what the seed carries --- */

describe('the seeded arrangement', () => {
  it('carries exactly one question addressed to a named reader, so this is exercised', async () => {
    const book = await loadKbAdmin()
    const addressed = book.faqs.filter(f => (f.audience_ids ?? []).length > 0)
    expect(addressed.length, 'nothing is addressed to anybody, so none of this is tested')
      .toBeGreaterThan(0)
    expect(addressed.some(f => f.id === ADDRESSED)).toBe(true)
  })

  it('offers the operator somebody to address things to', async () => {
    const book = await loadKbAdmin()
    expect(book.readers.length).toBeGreaterThan(3)
    expect(book.readers.some(r => r.persona === 'partner')).toBe(true)
    expect(book.readers.some(r => r.persona === 'enterprise')).toBe(true)
    expect(book.readers.some(r => r.persona === 'consumer')).toBe(true)
  })
})

/* -------------------------------------------------------- writing them --- */

describe('as the operator, addressing a question', () => {
  it('writes one for the demo seller and one for somebody else', async () => {
    const mine = await saveFaq({
      id: MINE, actor: 'Integration suite', articles: [],
      draft: {
        question: 'Integration: is this addressed to me?',
        answer: 'It is addressed to the demo seller alone.',
        personas: ['partner'], audience_ids: [DEMO_PARTNER],
        topic: 'Integration test', status: 'published', article_id: null,
      },
    })
    expect(mine.ok ? '' : mine.reason).toBe('')

    const theirs = await saveFaq({
      id: THEIRS, actor: 'Integration suite', articles: [],
      draft: {
        question: 'Integration: is this addressed to somebody else?',
        answer: 'It is addressed to a different seller.',
        personas: ['partner'], audience_ids: [otherPartner],
        topic: 'Integration test', status: 'published', article_id: null,
      },
    })
    expect(theirs.ok ? '' : theirs.reason).toBe('')
  })

  /* The guard's rule, attempted rather than assumed. */
  it('is refused a reader who is not in any of the chosen audiences', async () => {
    const res = await saveFaq({
      id: 'FAQ-TEST-IMPOSSIBLE', actor: 'Integration suite', articles: [],
      draft: {
        question: 'Integration: can this reach anybody?',
        answer: 'It cannot — a seller id on a question published to retail customers.',
        personas: ['consumer'], audience_ids: [DEMO_PARTNER],
        topic: 'Integration test', status: 'published', article_id: null,
      },
    })
    expect(res.ok, 'a question was addressed to somebody who could never read it').toBe(false)
    await drop('FAQ-TEST-IMPOSSIBLE')
  })
})

/* --------------------------------------------------------- reading them --- */

describe('as the seller it is addressed to', () => {
  beforeAll(async () => { await signOut(); await signIn(PARTNER.email, PARTNER.password) })
  afterAll(async () => { await signOut(); await signIn(OPERATOR.email, OPERATOR.password) })

  it('gets the question written for them', async () => {
    const snap = await loadKb('partner')
    expect(snap.faqs.map(f => f.id)).toContain(MINE)
  })

  it('does not get the one written for another seller', async () => {
    const snap = await loadKb('partner')
    expect(snap.faqs.map(f => f.id),
      'a seller read a question addressed to a different seller').not.toContain(THEIRS)
  })

  it('still gets the questions addressed to nobody in particular', async () => {
    const snap = await loadKb('partner')
    const general = snap.faqs.filter(f => (f.audience_ids ?? []).length === 0)
    expect(general.length, 'narrowing swallowed the general questions too').toBeGreaterThan(0)
  })

  /* The narrowing is the database's, not the client's — asked directly, with
     no filtering of our own, so a client-side-only rule would fail here. */
  it('cannot see it by asking the table directly', async () => {
    const { data } = await supabase.from('kb_faqs').select('id')
    const ids = ((data ?? []) as { id: string }[]).map(r => r.id)
    expect(ids, 'RLS handed over a question addressed to somebody else').not.toContain(THEIRS)
    expect(ids).toContain(MINE)
  })

  it('cannot read another audience\'s articles at all', async () => {
    const { data } = await supabase.from('kb_articles').select('id,personas')
    const rows = (data ?? []) as { id: string; personas: string[] }[]
    expect(rows.length).toBeGreaterThan(0)
    const leaked = rows.filter(r => !r.personas.includes('partner'))
    expect(leaked.map(r => r.id), 'a seller was handed articles published to other audiences').toEqual([])
  })

  it('cannot read a draft', async () => {
    const { data } = await supabase.from('kb_faqs').select('id,status')
    const held = ((data ?? []) as { status: string }[]).filter(r => r.status !== 'published')
    expect(held, 'drafts are readable again').toEqual([])
  })
})

describe('as a retail customer', () => {
  beforeAll(async () => { await signOut(); await signIn(CONSUMER.email, CONSUMER.password) })
  afterAll(async () => { await signOut(); await signIn(OPERATOR.email, OPERATOR.password) })

  it('gets nothing that was written for sellers', async () => {
    const { data } = await supabase.from('kb_faqs').select('id,personas')
    const rows = (data ?? []) as { id: string; personas: string[] }[]
    expect(rows.length, 'a customer sees no questions at all').toBeGreaterThan(0)
    expect(rows.filter(r => !r.personas.includes('consumer')).map(r => r.id)).toEqual([])
    expect(rows.map(r => r.id)).not.toContain(ADDRESSED)
  })
})

describe('signed out', () => {
  beforeAll(async () => { await signOut() })
  afterAll(async () => { await signIn(OPERATOR.email, OPERATOR.password) })

  /* A visitor with no persona is treated as a retail customer, which is what
     the public help pages are. Before this migration they could read the
     operator's own articles. */
  it('reads the public help and nothing else', async () => {
    const { data } = await supabase.from('kb_articles').select('id,personas,status')
    const rows = (data ?? []) as { id: string; personas: string[]; status: string }[]
    expect(rows.length, 'the public help pages went dark').toBeGreaterThan(0)
    expect(rows.filter(r => !r.personas.includes('consumer')).map(r => r.id),
      'a signed-out visitor was handed staff articles').toEqual([])
    expect(rows.filter(r => r.status !== 'published')).toEqual([])
  })
})

/* --------------------------------------- the two statements of one rule --- */

describe('the client rule and the database rule agree', () => {
  it('predicts exactly what the seller is given', async () => {
    /* The operator holds every row, so this is the whole book. */
    const book = await loadKbAdmin()
    const predicted = book.faqs
      .filter((f: KbFaq) => visibleTo(f, 'partner', [DEMO_PARTNER]))
      .map(f => f.id).sort()

    await signOut(); await signIn(PARTNER.email, PARTNER.password)
    const snap = await loadKb('partner')
    const actual = snap.faqs.map(f => f.id).sort()
    await signOut(); await signIn(OPERATOR.email, OPERATOR.password)

    expect(actual, 'the form and the database disagree about who may read what')
      .toEqual(predicted)
  })
})
