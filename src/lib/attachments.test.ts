import { describe, it, expect } from 'vitest'
import {
  ACCEPTED, ACCEPT_ATTRIBUTE, MAX_BYTES, MAX_FILES, acceptedLabel,
  validateFile, validateSet, guessKind, storagePath, safeName,
  scanNote, canOpen, canWithdraw, sizeOf, disputePath, refundPath,
} from './attachments'
import type { Attachment } from './attachments'

const file = (over: Partial<{ name: string; type: string; size: number }> = {}) => ({
  name: 'parcel.jpg', type: 'image/jpeg', size: 240_000, ...over,
})

function attachment(over: Partial<Attachment> = {}): Attachment {
  return {
    id: 'ATT-1', ticket_id: 'SUP-9001', path: 'u1/SUP-9001/1-parcel.jpg',
    filename: 'parcel.jpg', mime: 'image/jpeg', bytes: 240_000, kind: 'evidence',
    caption: null, uploaded_by: 'priya.raman@example.com', user_id: 'u1',
    uploaded_at: '2026-08-01T09:00:00Z', scan: 'clean', sort_order: 1, ...over,
  }
}

describe('what may be attached', () => {
  it('takes a photograph of the thing that went wrong', () => {
    expect(validateFile(file()).ok).toBe(true)
  })

  it('takes a PDF and a log', () => {
    expect(validateFile(file({ name: 'invoice.pdf', type: 'application/pdf' })).ok).toBe(true)
    expect(validateFile(file({ name: 'router.log', type: 'text/plain' })).ok).toBe(true)
  })

  /* Browsers disagree about HEIC and some send no type at all, so the extension
     is a fallback rather than a second opinion. */
  it('takes a file whose type the browser would not name', () => {
    expect(validateFile(file({ name: 'IMG_4021.HEIC', type: '' })).ok).toBe(true)
    expect(validateFile(file({ name: 'shot.PNG', type: '' })).ok).toBe(true)
  })

  it('refuses a kind it cannot store, and says what to do instead', () => {
    const c = validateFile(file({ name: 'clip.mov', type: 'video/quicktime' }))
    expect(c.ok).toBe(false)
    if (!c.ok) {
      expect(c.reason).toMatch(/not a kind of file we can take/)
      expect(c.reason).toMatch(/describe it in the message/)
    }
  })

  it('refuses one that is too big, and names both figures', () => {
    const c = validateFile(file({ size: MAX_BYTES + 1 }))
    expect(c.ok).toBe(false)
    if (!c.ok) {
      expect(c.reason).toMatch(/parcel\.jpg is 10 MB/)
      expect(c.reason).toMatch(/the limit is 10 MB/)
      expect(c.reason).toMatch(/a video is not/)
    }
  })

  it('refuses an empty file rather than storing nothing', () => {
    const c = validateFile(file({ size: 0 }))
    expect(c.ok).toBe(false)
    if (!c.ok) expect(c.reason).toMatch(/is empty/)
  })

  it('refuses the same file twice', () => {
    const c = validateFile(file(), [{ filename: 'parcel.jpg', bytes: 240_000 }])
    expect(c.ok).toBe(false)
    if (!c.ok) expect(c.reason).toMatch(/already attached/)
  })

  /* Same name, different size, is a second photograph — cameras name every one
     of them IMG_0001. */
  it('allows the same name at a different size', () => {
    expect(validateFile(file(), [{ filename: 'parcel.jpg', bytes: 500 }]).ok).toBe(true)
  })

  it('stops at the limit on how many', () => {
    const already = Array.from({ length: MAX_FILES }, (_, i) => ({ filename: `p${i}.jpg`, bytes: 10 }))
    const c = validateFile(file(), already)
    expect(c.ok).toBe(false)
    if (!c.ok) expect(c.reason).toMatch(/Remove one first/)
  })

  it('checks a whole set at once', () => {
    expect(validateSet([file(), file({ name: 'b.png', type: 'image/png' })]).ok).toBe(true)
    expect(validateSet(Array.from({ length: 9 }, (_, i) => file({ name: `p${i}.jpg` }))).ok).toBe(false)
    expect(validateSet([file({ name: 'x.exe', type: 'application/x-msdownload' })]).ok).toBe(false)
  })

  it('offers the picker a list that matches what the bucket takes', () => {
    for (const a of ACCEPTED) expect(ACCEPT_ATTRIBUTE).toContain(a.mime)
    expect(acceptedLabel()).toMatch(/Photos, PDFs and text logs/)
  })
})

describe('what a file appears to be', () => {
  it('reads a screenshot from its name', () => {
    expect(guessKind({ name: 'Screenshot 2026-08-01.png', type: 'image/png' })).toBe('screenshot')
    expect(guessKind({ name: 'screen-grab.png', type: 'image/png' })).toBe('screenshot')
  })

  it('calls a PDF a document and a photo evidence', () => {
    expect(guessKind({ name: 'invoice.pdf', type: 'application/pdf' })).toBe('document')
    expect(guessKind({ name: 'receipt.png', type: 'image/png' })).toBe('document')
    expect(guessKind({ name: 'IMG_4021.jpg', type: 'image/jpeg' })).toBe('evidence')
  })

  it('falls back to other rather than guessing', () => {
    expect(guessKind({ name: 'router.log', type: 'text/plain' })).toBe('other')
  })
})

describe('where the bytes go', () => {
  /* The first folder is what the storage policy keys on. Anything else is
     refused by the bucket rather than by good manners. */
  it('puts the file in the uploader’s own folder', () => {
    const p = storagePath('u1', 'SUP-9001', 'My Parcel Photo.JPG')
    expect(p.startsWith('u1/SUP-9001/')).toBe(true)
    expect(p).toMatch(/my-parcel-photo\.jpg$/)
  })

  it('makes a name that survives a URL', () => {
    expect(safeName('Invoice #42 (final).PDF')).toBe('invoice-42-final.pdf')
    expect(safeName('../../etc/passwd')).toBe('passwd')
    expect(safeName('C:\\Users\\me\\parcel.jpg')).toBe('parcel.jpg')
    expect(safeName('.gitignore')).toBe('gitignore')
    expect(safeName('a'.repeat(200) + '.png')).toMatch(/^a{60}\.png$/)
  })
})

describe('what is said about a file nobody has scanned', () => {
  it('does not imply a clean file it has no reason to believe is clean', () => {
    const n = scanNote('pending')
    expect(n.tone).toBe('warn')
    expect(n.text).toMatch(/Not scanned yet/)
  })

  it('says plainly when one is blocked, and will not open it', () => {
    expect(scanNote('blocked').tone).toBe('bad')
    expect(canOpen(attachment({ scan: 'blocked' }))).toBe(false)
    expect(canOpen(attachment({ scan: 'clean' }))).toBe(true)
    expect(canOpen(attachment({ path: null }))).toBe(false)
  })

  it('is quiet once it has passed', () => {
    expect(scanNote('clean')).toEqual({ tone: 'ok', text: 'Scanned' })
  })
})

describe('taking a file back', () => {
  const me = { user_id: 'u1' }
  const fresh = { messages: [{ who: 'Priya', text: 'It never arrived', when: '' }] }
  const answered = { messages: [fresh.messages[0], { who: 'Desk', text: 'Looking into it', when: '' }] }

  it('allows it before the desk has replied', () => {
    const c = canWithdraw(attachment(), me, fresh)
    expect(c.ok).toBe(true)
    if (c.ok) expect(c.note).toMatch(/will be removed and not kept/)
  })

  it('refuses it afterwards — that is editing the record', () => {
    const c = canWithdraw(attachment(), me, answered)
    expect(c.ok).toBe(false)
    if (!c.ok) expect(c.reason).toMatch(/stays on the record/)
  })

  it('refuses somebody else’s file', () => {
    expect(canWithdraw(attachment({ user_id: 'u2' }), me, fresh).ok).toBe(false)
    expect(canWithdraw(attachment(), null, fresh).ok).toBe(false)
  })
})

describe('sizes', () => {
  it('reads the way a file manager reads', () => {
    expect(sizeOf(240_000)).toBe('240 kB')
    expect(sizeOf(1_200_000)).toBe('1.2 MB')
    expect(sizeOf(900)).toBe('900 B')
    expect(sizeOf(0)).toBe('—')
    expect(sizeOf(Number.NaN)).toBe('—')
  })
})

describe('where a dispute’s evidence goes', () => {
  it('files it under the dispute, not the uploader', () => {
    /* The other way round from a ticket, on purpose: a dispute is an argument
       with at least three interested parties, and filing it under whoever
       clicked upload means their colleague cannot open their own company's
       photograph. */
    const p = disputePath('DSP-2201', 'Sealed carton.JPEG')
    expect(p.startsWith('DSP-2201/')).toBe(true)
    expect(p).toMatch(/sealed-carton\.jpeg$/)
  })

  it('keeps two uploads of one filename apart', () => {
    const a = disputePath('DSP-2201', 'photo.jpg')
    const b = disputePath('DSP-2201', 'photo.jpg')
    expect(a.split('/')[1]).toMatch(/^\d+-photo\.jpg$/)
    expect(b.split('/')[1]).toMatch(/^\d+-photo\.jpg$/)
  })

  it('defeats traversal in an evidence filename too', () => {
    expect(disputePath('DSP-2201', '../../etc/passwd')).toMatch(/^DSP-2201\/\d+-passwd$/)
  })
})

describe('where a refund’s evidence goes', () => {
  it('files it under the uploader, like a ticket and unlike a dispute', () => {
    /* The storage policy on this bucket keys on the first segment being
       auth.uid(). A refund has two sides, but each uploads under their own id
       and reads the other's through the table's policies — putting the refund
       id first would need its own storage policy and would let anyone who
       guessed a refund id write into it. */
    const uid = '11111111-2222-3333-4444-555555555555'
    const p = refundPath(uid, 'RFN-4K2J9', 'Cracked casing.HEIC')
    expect(p.startsWith(`${uid}/RFN-4K2J9/`)).toBe(true)
    expect(p).toMatch(/cracked-casing\.heic$/)
  })

  it('keeps two uploads of one filename apart', () => {
    const uid = 'abc'
    const p = refundPath(uid, 'RFN-4K2J9', 'photo.jpg')
    expect(p.split('/')[2]).toMatch(/^\d+-photo\.jpg$/)
  })

  it('defeats traversal in a refund filename too', () => {
    expect(refundPath('abc', 'RFN-1', '../../etc/passwd'))
      .toMatch(/^abc\/RFN-1\/\d+-passwd$/)
  })

  it('never lets the filename climb out of the uploader’s folder', () => {
    /* The segment count is the invariant the storage policy depends on: three
       parts, the first of them the uploader. A name that added a slash would
       change which folder the object landed in. */
    const p = refundPath('abc', 'RFN-1', 'a/b/c/evil.png')
    expect(p.split('/')).toHaveLength(3)
    expect(p.split('/')[0]).toBe('abc')
  })
})
