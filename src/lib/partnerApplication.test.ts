import { describe, it, expect } from 'vitest'
import {
  answered, optionsOf, splitMulti, joinMulti, toggleMulti,
  stepsOf, outstanding, canSubmit, progress, resumeAt,
  validateStart, looksLikeReference, looksLikeCode, normaliseCode,
  CODE_ALPHABET, CODE_LENGTH,
  deskQueue, waitingDays, canAccept, answerSheet,
} from './partnerApplication'
import type { FieldSpec, StartDraft, Answers, DeskApplication } from './partnerApplication'

const MARKETS = [{ code: 'IN' }, { code: 'AE' }, { code: 'KE' }]

function field(over: Partial<FieldSpec> = {}): FieldSpec {
  return {
    id: 'apply-volume', gate_id: 'apply', label: 'Expected orders per month',
    hint: null, kind: 'number', options: null, required: true, sort_order: 30, ...over,
  }
}

/* Two gates, four required questions and one optional — small enough to reason
   about and big enough that "all of them" and "the ones on this gate" are
   different answers. */
const FORM: FieldSpec[] = [
  field({ id: 'a1', gate_id: 'apply', label: 'Markets', kind: 'multichoice', options: 'India,Kenya', sort_order: 10 }),
  field({ id: 'a2', gate_id: 'apply', label: 'Volume', sort_order: 20 }),
  field({ id: 'a3', gate_id: 'apply', label: 'Website', required: false, kind: 'text', sort_order: 30 }),
  field({ id: 'k1', gate_id: 'kyc', label: 'Registration number', kind: 'text', sort_order: 40 }),
  field({ id: 'k2', gate_id: 'kyc', label: 'Owners over 25%', kind: 'longtext', sort_order: 50 }),
]

function draft(over: Partial<StartDraft> = {}): StartDraft {
  return {
    email: 'ops@kestrel.example', phone: '+91 80 4000 0000', company: 'Kestrel Devices',
    contact_name: 'R Menon', country: 'IN', kind: 'Reseller', ...over,
  }
}

describe('what counts as answered', () => {
  it('treats blank, spaces and absent as the same thing', () => {
    /* The single most load-bearing definition here. If these three ever differ,
       a form reports itself complete because somebody pressed space. */
    expect(answered(undefined)).toBe(false)
    expect(answered(null)).toBe(false)
    expect(answered('')).toBe(false)
    expect(answered('   ')).toBe(false)
    expect(answered('\n\t ')).toBe(false)
  })

  it('accepts anything with a character in it, including a bare no', () => {
    /* "false" is an answer to "have you been sanctioned?". Treating a falsy
       string as unanswered would hold the gate on every honest no. */
    expect(answered('false')).toBe(true)
    expect(answered('0')).toBe(true)
    expect(answered('x')).toBe(true)
  })
})

describe('choices', () => {
  it('reads the option list off the field, trimming what the table holds', () => {
    expect(optionsOf({ options: 'India, United Arab Emirates ,Kenya' }))
      .toEqual(['India', 'United Arab Emirates', 'Kenya'])
  })

  it('has no options where there is no list, rather than one empty option', () => {
    expect(optionsOf({ options: null })).toEqual([])
    expect(optionsOf({ options: '' })).toEqual([])
  })

  it('round-trips a multi-select through the single string it is stored as', () => {
    const stored = joinMulti(['India', 'Kenya'])
    expect(splitMulti(stored)).toEqual(['India', 'Kenya'])
  })

  it('adds and removes without disturbing the rest', () => {
    let v = ''
    v = toggleMulti(v, 'India')
    v = toggleMulti(v, 'Kenya')
    expect(splitMulti(v)).toEqual(['India', 'Kenya'])
    v = toggleMulti(v, 'India')
    expect(splitMulti(v)).toEqual(['Kenya'])
  })

  it('leaves nothing behind when the last one is removed', () => {
    /* An emptied multi-select has to be indistinguishable from never answered,
       or it satisfies a required question with no selections in it. */
    const v = toggleMulti(toggleMulti('', 'India'), 'India')
    expect(answered(v)).toBe(false)
  })
})

describe('the form, grouped into gates', () => {
  it('keeps the gates in the order the questions are asked', () => {
    expect(stepsOf(FORM, {}).map(s => s.gate_id)).toEqual(['apply', 'kyc'])
  })

  it('groups regardless of what order the rows arrive in', () => {
    const shuffled = [FORM[3], FORM[1], FORM[4], FORM[0], FORM[2]]
    const steps = stepsOf(shuffled, {})
    expect(steps.map(s => s.gate_id)).toEqual(['apply', 'kyc'])
    expect(steps[0].fields.map(f => f.id)).toEqual(['a1', 'a2', 'a3'])
  })

  it('counts only the required questions towards a gate being done', () => {
    const steps = stepsOf(FORM, { a1: 'India', a2: '400' })
    expect(steps[0].required).toBe(2)
    expect(steps[0].answered).toBe(2)
    /* a3 is optional and blank, and the gate is finished anyway. */
    expect(steps[0].done).toBe(true)
  })

  it('does not call a gate done on a blank required answer', () => {
    expect(stepsOf(FORM, { a1: 'India', a2: '  ' })[0].done).toBe(false)
  })
})

describe('what is outstanding', () => {
  it('lists them in the order they are asked', () => {
    expect(outstanding(FORM, { a2: '400' }).map(f => f.id)).toEqual(['a1', 'k1', 'k2'])
  })

  it('never lists an optional question', () => {
    const all: Answers = { a1: 'India', a2: '400', k1: 'U1234', k2: 'One owner' }
    expect(outstanding(FORM, all)).toEqual([])
  })
})

describe('submitting', () => {
  const complete: Answers = { a1: 'India', a2: '400', k1: 'U1234', k2: 'One owner' }

  it('is allowed once every required question is answered', () => {
    expect(canSubmit(FORM, complete)).toEqual({ ok: true })
  })

  it('names the first thing outstanding rather than just refusing', () => {
    const out = canSubmit(FORM, { a2: '400' })
    expect(out.ok).toBe(false)
    expect(out.ok === false && out.reason).toMatch(/3 questions are still outstanding, starting with: Markets/)
  })

  it('says "one" rather than "1 questions"', () => {
    const out = canSubmit(FORM, { ...complete, k2: '' })
    expect(out.ok === false && out.reason).toMatch(/^One question is still outstanding: Owners over 25%/)
  })

  it('refuses on an empty form rather than calling it complete', () => {
    /* The one state where "nothing outstanding" does not mean "everything
       answered" — a form that failed to load has no required questions, so
       every other check here would wave it straight through. */
    const out = canSubmit([], complete)
    expect(out.ok).toBe(false)
    expect(out.ok === false && out.reason).toMatch(/has not loaded/)
  })
})

describe('progress', () => {
  it('counts required questions, not gates', () => {
    /* Seven gates of wildly different sizes make a gate count a misleading
       number: finishing the four-question finance gate is not one seventh. */
    expect(progress(FORM, { a1: 'India' })).toEqual({ required: 4, answered: 1, pct: 25 })
  })

  it('is zero rather than NaN on a form with nothing required', () => {
    expect(progress([field({ required: false })], {}).pct).toBe(0)
  })
})

describe('where somebody coming back is put', () => {
  it('lands on the first gate with something outstanding, not the furthest reached', () => {
    /* Somebody who skipped question a1 and filled in the KYC gate wants to be
       put back in front of a1. */
    const steps = stepsOf(FORM, { a2: '400', k1: 'U1234', k2: 'One owner' })
    expect(resumeAt(steps)).toBe(0)
  })

  it('lands on the last gate when everything is answered — that is where submit is', () => {
    const steps = stepsOf(FORM, { a1: 'India', a2: '400', k1: 'U1234', k2: 'One owner' })
    expect(resumeAt(steps)).toBe(1)
  })

  it('does not return -1 on an empty form', () => {
    expect(resumeAt([])).toBe(0)
  })
})

describe('starting an application', () => {
  it('accepts a complete one', () => {
    expect(validateStart(draft(), MARKETS)).toEqual({ ok: true })
  })

  it('asks for a company name, a contact and a country', () => {
    expect(validateStart(draft({ company: '  ' }), MARKETS).ok).toBe(false)
    expect(validateStart(draft({ contact_name: '' }), MARKETS).ok).toBe(false)
    expect(validateStart(draft({ country: '' }), MARKETS).ok).toBe(false)
    expect(validateStart(draft({ kind: '' }), MARKETS).ok).toBe(false)
  })

  it('catches a typo in the email without being clever about it', () => {
    expect(validateStart(draft({ email: 'ops@kestrel' }), MARKETS).ok).toBe(false)
    expect(validateStart(draft({ email: 'ops.kestrel.example' }), MARKETS).ok).toBe(false)
    /* And lets through the shapes a regex is tempted to reject. An address
       turned away here is an applicant turned away. */
    expect(validateStart(draft({ email: "o'brien+sales@sub.domain.co.uk" }), MARKETS).ok).toBe(true)
  })

  it('accepts a phone number however it is punctuated', () => {
    for (const phone of ['+91 80 4000 0000', '(020) 7946 0958', '+254-20-1234567', '00971 4 123 4567']) {
      expect(validateStart(draft({ phone }), MARKETS).ok, phone).toBe(true)
    }
  })

  it('refuses something that is not a phone number', () => {
    expect(validateStart(draft({ phone: 'call me' }), MARKETS).ok).toBe(false)
    expect(validateStart(draft({ phone: '12345' }), MARKETS).ok).toBe(false)
  })

  it('refuses a country the marketplace does not operate in', () => {
    const out = validateStart(draft({ country: 'GB' }), MARKETS)
    expect(out.ok).toBe(false)
    expect(out.ok === false && out.reason).toMatch(/does not operate there/)
  })

  it('does not refuse every country when the market list has not loaded', () => {
    /* The screen calls this before and after the markets arrive. Refusing on an
       empty list would mean the form rejects a valid country for as long as the
       network takes, and the database still has the last word. */
    expect(validateStart(draft({ country: 'IN' }), []).ok).toBe(true)
  })
})

describe('the queue the desk works', () => {
  const app = (over: Partial<DeskApplication> = {}): DeskApplication => ({
    id: 'APP-2026-0001', email: 'a@b.test', phone: '+91 80 4000 0000',
    company: 'Kestrel Devices', contact_name: 'R Menon', country: 'IN', kind: 'Reseller',
    state: 'submitted', reached: 7,
    started: '2026-07-01T09:00:00Z', last_saved: '2026-07-02T09:00:00Z',
    submitted_on: '2026-07-02T09:00:00Z', partner_id: null, ...over,
  })

  it('separates what is owed from what is not', () => {
    /* A draft is nobody's turn. Mixing the two makes a queue where most rows
       are things nobody is waiting on, which is how a desk learns to ignore
       its own queue. */
    const q = deskQueue([
      app({ id: 'A', state: 'submitted' }),
      app({ id: 'B', state: 'draft', submitted_on: null }),
      app({ id: 'C', state: 'accepted', partner_id: 'PTR-1016' }),
      app({ id: 'D', state: 'withdrawn' }),
    ])
    expect(q.waiting.map(a => a.id)).toEqual(['A'])
    expect(q.drafts.map(a => a.id)).toEqual(['B'])
    expect(q.decided.map(a => a.id).sort()).toEqual(['C', 'D'])
  })

  it('puts the longest wait at the top', () => {
    const q = deskQueue([
      app({ id: 'new', submitted_on: '2026-07-20T09:00:00Z' }),
      app({ id: 'old', submitted_on: '2026-07-02T09:00:00Z' }),
    ])
    expect(q.waiting.map(a => a.id)).toEqual(['old', 'new'])
  })

  it('counts the days somebody has been waiting', () => {
    const now = new Date('2026-07-09T09:00:00Z')
    expect(waitingDays(app({ submitted_on: '2026-07-02T09:00:00Z' }), now)).toBe(7)
    expect(waitingDays(app({ submitted_on: '2026-07-09T08:00:00Z' }), now)).toBe(0)
  })

  it('has no waiting time for something that was never sent', () => {
    expect(waitingDays(app({ state: 'draft', submitted_on: null }))).toBeNull()
    expect(waitingDays(app({ submitted_on: 'not a date' }))).toBeNull()
  })
})

describe('whether the desk can accept one', () => {
  const complete: Answers = { a1: 'India', a2: '400', k1: 'U1234', k2: 'One owner' }
  const app = (over: Partial<DeskApplication> = {}): DeskApplication => ({
    id: 'APP-2026-0001', email: 'a@b.test', phone: '+91 80 4000 0000',
    company: 'Kestrel Devices', contact_name: 'R Menon', country: 'IN', kind: 'Reseller',
    state: 'submitted', reached: 7,
    started: '2026-07-01T09:00:00Z', last_saved: '2026-07-02T09:00:00Z',
    submitted_on: '2026-07-02T09:00:00Z', partner_id: null, ...over,
  })

  it('accepts a complete one that has been sent', () => {
    expect(canAccept(app(), FORM, complete)).toEqual({ ok: true })
  })

  it('refuses one still being filled in', () => {
    const out = canAccept(app({ state: 'draft' }), FORM, complete)
    expect(out.ok).toBe(false)
    expect(out.ok === false && out.reason).toMatch(/still being filled in/)
  })

  it('refuses one already accepted, and names the partner it became', () => {
    const out = canAccept(app({ state: 'accepted', partner_id: 'PTR-1016' }), FORM, complete)
    expect(out.ok === false && out.reason).toMatch(/already partner PTR-1016/)
  })

  it('refuses a submitted one that is missing an answer the form now wants', () => {
    /* The case the state alone cannot tell you about: the desk adds a question
       after somebody submitted, and a submitted application really is
       incomplete. Checked against the form as it stands, not as it stood. */
    const out = canAccept(app(), FORM, { a1: 'India', a2: '400', k1: 'U1234' })
    expect(out.ok).toBe(false)
    expect(out.ok === false && out.reason).toMatch(/sent before "Owners over 25%" was on the form/)
  })
})

describe('the answer sheet the desk reads', () => {
  it('is grouped by gate, in the order the gates are assessed', () => {
    const sheet = answerSheet(FORM, { a1: 'India' })
    expect(sheet.map(g => g.gate_id)).toEqual(['apply', 'kyc'])
  })

  it('keeps unanswered questions rather than dropping them', () => {
    /* A blank the reviewer cannot see is a blank they cannot ask about. */
    const sheet = answerSheet(FORM, { a1: 'India' })
    const apply = sheet[0].rows
    expect(apply.map(r => r.field.id)).toEqual(['a1', 'a2', 'a3'])
    expect(apply.find(r => r.field.id === 'a2')!.value).toBeNull()
  })

  it('reports a blank answer as absent, not as an empty string', () => {
    const sheet = answerSheet(FORM, { a1: '   ' })
    expect(sheet[0].rows[0].value).toBeNull()
  })
})

describe('the reference and the code', () => {
  it('recognises a reference and rejects what is not one', () => {
    expect(looksLikeReference('APP-2026-0007')).toBe(true)
    expect(looksLikeReference(' app-2026-0007 ')).toBe(true)
    expect(looksLikeReference('APP-2026-7')).toBe(false)
    expect(looksLikeReference('PTR-1009')).toBe(false)
    expect(looksLikeReference('')).toBe(false)
  })

  it('forgives the case and the spacing somebody types a code with', () => {
    expect(normaliseCode(' tp4f-2pnd 9hv8 ')).toBe('TP4F2PND9HV8')
  })

  it('does not invent a character for one that cannot be in a code', () => {
    /* The alphabet excludes 0 and O, 1 and I and L, so a typed 0 has nothing it
       could have been meant as. Mapping it to something would be guessing, and
       the guess would silently fail against a real code anyway. */
    expect(normaliseCode('TP4F2PND9HV0')).toBe('TP4F2PND9HV0')
    expect(looksLikeCode('TP4F2PND9HV0')).toBe(false)
  })

  it('knows the shape of a real code', () => {
    expect(looksLikeCode('TP4F2PND9HV8')).toBe(true)
    expect(looksLikeCode('TP4F2PND9HV')).toBe(false)
    expect(looksLikeCode('')).toBe(false)
  })

  it('describes the alphabet the database actually generates from', () => {
    /* This constant exists only to check against. If the two ever disagree,
       every code the database issues fails the client's own shape test — so
       the excluded characters are asserted rather than trusted. */
    for (const ch of '01OIL') expect(CODE_ALPHABET.includes(ch), ch).toBe(false)
    expect(CODE_LENGTH).toBe(12)
    expect(CODE_ALPHABET.length).toBe(31)
  })
})
