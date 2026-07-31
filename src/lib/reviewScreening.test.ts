import { describe, it, expect } from 'vitest'
import {
  screen, screenAll, triage, similarity, normalise, screeningSummary, DUPLICATE_AT,
} from './reviewScreening'
import type { ScreenableReview } from './reviewScreening'

const rev = (over: Partial<ScreenableReview> & Pick<ScreenableReview, 'id'>): ScreenableReview => ({
  product_id: 'SKU-4001', rating: 5, title: 'Good', author: 'Rohan Raman',
  body: 'Solid build and the battery lasts a full day of heavy use.',
  submitted: '2026-07-20', status: 'pending', ...over,
})

const codes = (r: ScreenableReview, corpus: ScreenableReview[] = [], extra = {}) =>
  screen(r, { corpus, ...extra }).flags.map(f => f.code)

describe('normalise and similarity', () => {
  it('treats punctuation and case as noise', () => {
    expect(normalise('Great — REALLY great!!!')).toBe('great really great')
  })

  it('scores identical text 1 and unrelated text near 0', () => {
    expect(similarity('the battery lasts all day', 'the battery lasts all day')).toBe(1)
    expect(similarity('the battery lasts all day', 'screen cracked in the box')).toBeLessThan(0.2)
  })

  it('is unmoved by punctuation, which is how duplicates disguise themselves', () => {
    expect(similarity('Battery lasts all day.', 'battery lasts all day!!!')).toBe(1)
  })

  it('does not collide two people praising the same thing differently', () => {
    const a = 'The battery easily lasts a full working day for me'
    const b = 'Screen is bright and the camera in low light is excellent'
    expect(similarity(a, b)).toBeLessThan(DUPLICATE_AT)
  })

  it('is zero against empty text rather than dividing by nothing', () => {
    expect(similarity('', 'anything at all')).toBe(0)
  })
})

describe('duplication', () => {
  it('catches the same person reviewing one product twice', () => {
    const first = rev({ id: 'REV-1', title: 'Happy with it' })
    const second = rev({ id: 'REV-2', body: 'A completely different opinion written out at length here.' })
    const flags = codes(second, [first])
    expect(flags).toContain('dup-author-product')
    expect(screen(second, { corpus: [first] }).flags[0].suggests).toBe('Duplicate')
  })

  it('catches the same text pasted onto a different product', () => {
    const first = rev({ id: 'REV-1', product_id: 'SKU-4002' })
    const second = rev({ id: 'REV-2', product_id: 'SKU-4001' })
    expect(codes(second, [first])).toContain('dup-text-self')
  })

  it('catches two different people posting one paragraph', () => {
    const first = rev({ id: 'REV-1', author: 'A. Buyer', product_id: 'SKU-4002' })
    const second = rev({ id: 'REV-2', author: 'B. Buyer', product_id: 'SKU-4001' })
    const flags = codes(second, [first])
    expect(flags).toContain('dup-text-other')
    /* The distinction is worth keeping: one is laziness, the other is a farm. */
    expect(flags).not.toContain('dup-text-self')
  })

  it('does not flag a review against itself', () => {
    const only = rev({ id: 'REV-1' })
    expect(codes(only, [only])).not.toContain('dup-text-self')
  })

  it('leaves two genuine reviews of one product alone', () => {
    const a = rev({ id: 'REV-1', author: 'A. Buyer', body: 'Battery easily lasts a full working day for me.' })
    const b = rev({ id: 'REV-2', author: 'B. Buyer', body: 'Screen is bright and low-light photos are excellent.' })
    expect(codes(b, [a])).toEqual([])
  })
})

describe('junk text', () => {
  it('catches a mashed keyboard', () => {
    expect(codes(rev({ id: 'R', body: 'aaaaaaaaaaa great product yes' }))).toContain('junk-run')
  })

  it('catches a long run of consonants', () => {
    expect(codes(rev({ id: 'R', body: 'this is sdfghjkltr and nothing else' }))).toContain('junk-gibberish')
  })

  it('flags a review that clears the length rule but says nothing', () => {
    const flags = codes(rev({ id: 'R', body: 'it is fine i guess' }))
    expect(flags).toContain('thin')
    /* Thin is a judgement call, not a refusal. */
    expect(screen(rev({ id: 'R', body: 'it is fine i guess' }), { corpus: [] }).recommendation).toBe('read closely')
  })

  it('leaves ordinary prose alone', () => {
    expect(codes(rev({ id: 'R' }))).toEqual([])
  })

  it('does not mistake a real word for gibberish', () => {
    /* "strengths" has a long consonant run but a vowel inside the token. */
    expect(codes(rev({ id: 'R', body: 'Its strengths are the screen and the battery life overall.' }))).toEqual([])
  })
})

describe('shouting', () => {
  it('notes all-capitals without treating it as a refusal', () => {
    const r = rev({ id: 'R', body: 'THIS PRODUCT IS COMPLETELY FINE AND I AM HAPPY WITH IT' })
    const s = screen(r, { corpus: [] })
    expect(s.flags.map(f => f.code)).toContain('shouting')
    expect(s.flags.find(f => f.code === 'shouting')!.severity).toBe('note')
  })

  it('ignores a short capitalised phrase, because acronyms exist', () => {
    expect(codes(rev({ id: 'R', body: 'The 5G SA works well on my line here.' }))).not.toContain('shouting')
  })
})

describe('personal data and promotion', () => {
  it('catches an email address', () => {
    const flags = codes(rev({ id: 'R', body: 'Message me on rohan.raman@example.com for a better deal.' }))
    expect(flags).toContain('contact-email')
  })

  it('catches a phone number', () => {
    expect(codes(rev({ id: 'R', body: 'Call me on +91 98765 43210 about this one.' }))).toContain('contact-phone')
  })

  it('catches a link and suggests the competitor reason', () => {
    const s = screen(rev({ id: 'R', body: 'Much cheaper over at www.someshop.com honestly.' }), { corpus: [] })
    const link = s.flags.find(f => f.code === 'link')
    expect(link).toBeTruthy()
    expect(link!.suggests).toBe('Promotes a competitor')
  })

  it('names a rival seller when it sees one', () => {
    const s = screen(
      rev({ id: 'R', body: 'Nimbus Sensors do a better version of this for less money.' }),
      { corpus: [], otherSellers: ['Nimbus Sensors', 'Sentinel Cyber'] },
    )
    const flag = s.flags.find(f => f.code === 'competitor')
    expect(flag?.evidence).toBe('Nimbus Sensors')
  })

  it('does not flag a seller name that is too short to be distinctive', () => {
    expect(codes(rev({ id: 'R', body: 'It is a good product and I am happy.' }), [], { otherSellers: ['Co'] }))
      .not.toContain('competitor')
  })

  it('reads the title as well as the body — hiding a number in the headline still hides it', () => {
    expect(codes(rev({ id: 'R', title: 'Ring me on +91 98765 43210' }))).toContain('contact-phone')
  })
})

describe('rating against text', () => {
  it('flags five stars describing something broken', () => {
    expect(codes(rev({ id: 'R', rating: 5, body: 'Arrived broken and it was a complete waste of money.' })))
      .toContain('mismatch-high')
  })

  it('flags one star describing something excellent', () => {
    expect(codes(rev({ id: 'R', rating: 1, body: 'Absolutely brilliant and I would recommend it to anyone.' })))
      .toContain('mismatch-low')
  })

  it('leaves a mixed review alone, because mixed reviews are the honest ones', () => {
    const body = 'The screen is excellent though the battery is disappointing after a year.'
    expect(codes(rev({ id: 'R', rating: 3, body }))).not.toContain('mismatch-high')
  })

  it('does not flag a high rating that mentions a fixed problem alongside praise', () => {
    const body = 'It arrived faulty but support was excellent and I would recommend them.'
    expect(codes(rev({ id: 'R', rating: 5, body }))).not.toContain('mismatch-high')
  })
})

describe('purchase verification', () => {
  it('flags a review of something the author never bought', () => {
    expect(codes(rev({ id: 'R', product_id: 'SKU-9999' }), [], { purchasedByAuthor: ['SKU-4001'] }))
      .toContain('unverified')
  })

  it('says nothing when the purchase history is unknown', () => {
    /* Unknown is not the same as "did not buy", and flagging it would put a
       warning on every review whenever the orders query failed. */
    expect(codes(rev({ id: 'R', product_id: 'SKU-9999' }))).not.toContain('unverified')
  })
})

describe('recommendation', () => {
  it('recommends refusing anything serious', () => {
    expect(screen(rev({ id: 'R', body: 'aaaaaaaaaa' }), { corpus: [] }).recommendation).toBe('refuse')
  })

  it('recommends a close read for anything merely suspect', () => {
    expect(screen(rev({ id: 'R', body: 'fine i suppose yes' }), { corpus: [] }).recommendation).toBe('read closely')
  })

  it('passes a clean review', () => {
    const s = screen(rev({ id: 'R' }), { corpus: [] })
    expect(s.recommendation).toBe('looks fine')
    expect(s.worst).toBeNull()
  })

  it('reports the worst flag first, so one line is enough to decide', () => {
    const r = rev({ id: 'R', body: 'CALL ME ON +91 98765 43210 IT IS COMPLETELY FINE HONESTLY' })
    const s = screen(r, { corpus: [] })
    expect(s.flags[0].severity).toBe('serious')
    expect(s.worst).toBe('serious')
  })
})

describe('screenAll and triage', () => {
  const clean = rev({ id: 'R-clean', author: 'A', submitted: '2026-07-01' })
  const junk = rev({ id: 'R-junk', author: 'B', submitted: '2026-07-20', body: 'zzzzzzzzzz' })
  const thin = rev({ id: 'R-thin', author: 'C', submitted: '2026-07-10', body: 'ok fine yes' })

  it('screens every review against the whole corpus by default', () => {
    const out = screenAll([clean, junk, thin])
    expect(out.size).toBe(3)
    expect(out.get('R-junk')!.worst).toBe('serious')
    expect(out.get('R-clean')!.worst).toBeNull()
  })

  it('compares against published reviews too, not only the queue', () => {
    const published = rev({ id: 'R-pub', author: 'Z', product_id: 'SKU-4002', status: 'published' })
    const copycat = rev({ id: 'R-copy', author: 'Y', product_id: 'SKU-4001' })
    const out = screenAll([copycat], { corpus: [published, copycat] })
    expect(out.get('R-copy')!.flags.map(f => f.code)).toContain('dup-text-other')
  })

  it('orders worst first, then by who has waited longest', () => {
    const screenings = screenAll([clean, junk, thin])
    expect(triage([clean, junk, thin], screenings).map(r => r.id))
      .toEqual(['R-junk', 'R-thin', 'R-clean'])
  })

  it('counts the queue for the summary line', () => {
    expect(screeningSummary(screenAll([clean, junk, thin])))
      .toEqual({ total: 3, serious: 1, suspect: 1, clean: 1 })
  })
})
