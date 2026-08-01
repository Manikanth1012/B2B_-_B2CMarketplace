/* Touches the live Supabase project, including storage.
 *
 * Two claims. A ticket attachment is private — the person who raised it and the
 * desk, nobody else, and the bucket enforces that rather than the screen. A
 * knowledge base asset is the opposite: published, fetchable by a stranger, and
 * actually there rather than a row pointing at nothing.
 *
 * Everything written here is undone in the same file.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { supabase } from './supabase'
import { signIn, signOut } from './authRepo'
import { attachFile, loadAttachments, openLink, withdrawAttachment } from './attachmentRepo'
import { validateFile, storagePath, MAX_BYTES } from './attachments'
import type { Attachment } from './attachments'
import { loadKb, assetUrl } from './kbRepo'
import { assetsFor, assetsByKind } from './kb'

const CONSUMER = { email: 'priya.raman@example.com', password: 'demo1234' }
const OTHER = { email: 'vikram.shah@smartbuild.in', password: 'enterprise123' }
const OPERATOR = { email: 'anika.sharma@aventa.com', password: 'operator123' }

/* A one-pixel PNG, small enough to be quick and real enough to be a file. */
const PNG = Uint8Array.from(atob(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
), c => c.charCodeAt(0))

function pngFile(name = 'parcel.png'): File {
  return new File([PNG], name, { type: 'image/png' })
}

let ticketId = ''
let attached: Attachment | null = null

describe('a customer attaching evidence to their own ticket', () => {
  beforeAll(async () => {
    await signIn(CONSUMER.email, CONSUMER.password)
    const { data: session } = await supabase.auth.getUser()
    ticketId = `SUP-TEST-${Date.now()}`
    const { error } = await supabase.from('support_tickets').insert({
      id: ticketId, subject: 'Integration test — parcel not delivered',
      category: 'Logistics', priority: 'P3', status: 'new', persona: 'consumer',
      opened_by: CONSUMER.email, org: 'Retail customer', sla_mins: 480,
      user_id: session.user?.id ?? null,
      messages: [{ who: 'Priya Raman', when: new Date().toISOString(), text: 'It never arrived.' }],
    })
    expect(error, error?.message).toBeNull()
  })

  /* No cleanup here. A describe's afterAll runs before the next describe
     starts, so tidying up at this point would delete the ticket the isolation
     and desk-side blocks below are about to look for — and both would pass by
     finding nothing, which is the wrong reason. It happens at the foot of the
     file instead. */
  afterAll(async () => { await signOut() })

  it('accepts a photograph and records what it is', async () => {
    const res = await attachFile({ ticketId, file: pngFile(), caption: 'The box as it arrived' })
    expect(res.ok, res.ok ? '' : res.reason).toBe(true)
    attached = res.attachment!

    expect(attached.ticket_id).toBe(ticketId)
    expect(attached.filename).toBe('parcel.png')
    expect(attached.bytes).toBe(PNG.length)
    expect(attached.caption).toBe('The box as it arrived')
  })

  /* Nobody marks their own upload clean. The trigger stamps it whatever the
     client sent. */
  it('does not let the uploader declare their own file scanned', async () => {
    expect(attached!.scan).toBe('pending')

    const { data } = await supabase.from('support_attachments')
      .update({ scan: 'clean' }).eq('id', attached!.id).select('scan')
    const after = await loadAttachments(ticketId)
    expect(after.find(a => a.id === attached!.id)!.scan).toBe('pending')
    void data
  })

  it('gives back a link that opens, and it is signed rather than public', async () => {
    const url = await openLink(attached!)
    expect(url).toBeTruthy()
    expect(url).toMatch(/token=/)

    const res = await fetch(url!)
    expect(res.status).toBe(200)
    expect(Number(res.headers.get('content-length'))).toBe(PNG.length)
  })

  it('refuses a file kind the bucket does not take', async () => {
    const bad = new File([PNG], 'payload.exe', { type: 'application/x-msdownload' })
    const local = validateFile(bad, [])
    expect(local.ok).toBe(false)

    /* And the bucket refuses it too, which is the part that matters. */
    const { data: session } = await supabase.auth.getUser()
    const path = storagePath(session.user!.id, ticketId, 'payload.exe')
    const up = await supabase.storage.from('ticket-attachments')
      .upload(path, bad, { contentType: 'application/x-msdownload' })
    expect(up.error, 'the bucket accepted an executable').not.toBeNull()
  })

  it('will not let a file be written outside the uploader’s own folder', async () => {
    const up = await supabase.storage.from('ticket-attachments')
      .upload(`somebody-else/${ticketId}/sneaky.png`, pngFile(), { contentType: 'image/png' })
    expect(up.error, 'a file landed in another user’s folder').not.toBeNull()
  })

  it('will not let an attachment be moved onto a different ticket', async () => {
    const { data, error } = await supabase.from('support_attachments')
      .update({ ticket_id: 'SUP-9001' }).eq('id', attached!.id).select('id')
    expect(error !== null || (data ?? []).length === 0).toBe(true)

    const after = await loadAttachments(ticketId)
    expect(after.some(a => a.id === attached!.id), 'the attachment left its ticket').toBe(true)
  })

  it('lets the customer take it back while the desk has not replied', async () => {
    const extra = await attachFile({ ticketId, file: pngFile('second.png') })
    expect(extra.ok, extra.ok ? '' : extra.reason).toBe(true)

    const res = await withdrawAttachment({
      attachment: extra.attachment!, ticket: { messages: [{}] },
    })
    expect(res.ok, res.ok ? '' : res.reason).toBe(true)
    expect((await loadAttachments(ticketId)).some(a => a.id === extra.attachment!.id)).toBe(false)
  })

  it('refuses a file bigger than the bucket takes, before it is sent', () => {
    const c = validateFile({ name: 'huge.png', type: 'image/png', size: MAX_BYTES + 1 })
    expect(c.ok).toBe(false)
  })
})

describe('somebody else’s ticket', () => {
  beforeAll(async () => { await signIn(OTHER.email, OTHER.password) })
  afterAll(async () => { await signOut() })

  it('cannot see the attachment at all', async () => {
    const rows = await loadAttachments(ticketId)
    expect(rows, 'another persona can read a customer’s evidence').toEqual([])
  })

  it('cannot fetch the file even knowing its path', async () => {
    expect(attached!.path).toBeTruthy()
    const { data, error } = await supabase.storage
      .from('ticket-attachments').createSignedUrl(attached!.path!, 60)
    /* Either refused outright or handed back nothing. What must not happen is a
       working link to somebody else's photograph. */
    if (!error && data?.signedUrl) {
      const res = await fetch(data.signedUrl)
      expect(res.status).toBeGreaterThanOrEqual(400)
    } else {
      expect(error).not.toBeNull()
    }
  })

  it('cannot attach anything to it either', async () => {
    const res = await attachFile({ ticketId, file: pngFile('intruder.png') })
    expect(res.ok).toBe(false)
  })
})

describe('the desk working the ticket', () => {
  beforeAll(async () => { await signIn(OPERATOR.email, OPERATOR.password) })
  afterAll(async () => { await signOut() })

  it('can see what the customer sent', async () => {
    const rows = await loadAttachments(ticketId)
    expect(rows.length).toBeGreaterThan(0)
    expect(rows[0].filename).toBe('parcel.png')
  })

  it('can open it', async () => {
    const rows = await loadAttachments(ticketId)
    const url = await openLink(rows[0])
    expect(url).toBeTruthy()
    expect((await fetch(url!)).status).toBe(200)
  })
})

/* ------------------------------------------------------------ the manuals -- */

describe('the knowledge base carries real documents', () => {
  beforeAll(async () => { await signOut() })

  it('hangs manuals, datasheets, videos and templates off the articles', async () => {
    const snap = await loadKb('enterprise')
    expect(snap.loadError).toBeUndefined()
    expect(snap.assets.length).toBeGreaterThan(0)

    const kinds = new Set(snap.assets.map(a => a.kind))
    expect(kinds.has('manual')).toBe(true)
    expect(kinds.has('datasheet')).toBe(true)
    expect(kinds.has('video')).toBe(true)
    expect(kinds.has('template')).toBe(true)
  })

  it('only hands back assets for articles this persona can read', async () => {
    const snap = await loadKb('enterprise')
    const ids = new Set(snap.articles.map(a => a.id))
    expect(snap.assets.every(a => ids.has(a.article_id))).toBe(true)
  })

  /* The point of the whole feature: the download button produces the document. */
  it('serves every file to a visitor who is not signed in', async () => {
    const snap = await loadKb('enterprise')
    for (const a of snap.assets) {
      const url = assetUrl(a)
      expect(url, `${a.id} has nowhere to download from`).toBeTruthy()

      const res = await fetch(url!)
      expect(res.status, `${a.id} (${a.title}) did not download`).toBe(200)
      expect(res.headers.get('content-type')).toContain(a.mime.split('/')[0])

      /* And the size printed under the button is the size that arrives. */
      if (a.bytes) expect(Number(res.headers.get('content-length'))).toBe(a.bytes)
    }
  })

  it('groups an article’s files the way the panel renders them', async () => {
    const snap = await loadKb('enterprise')
    const sensor = assetsFor(snap.assets, 'KB-B06')
    expect(sensor.length).toBe(3)

    const groups = assetsByKind(sensor)
    expect(groups.map(g => g.kind)).toEqual(['manual', 'datasheet', 'video'])
    expect(groups.every(g => g.assets.length > 0)).toBe(true)
  })

  it('gives the consumer knowledge base something too', async () => {
    const snap = await loadKb('consumer')
    expect(snap.assets.length).toBeGreaterThan(0)
  })
})

/* Now that everything has looked at it, take the test ticket away — bytes and
   all. An attachment left in the bucket is somebody's storage bill. */
describe('tidying up', () => {
  beforeAll(async () => { await signIn(OPERATOR.email, OPERATOR.password) })
  afterAll(async () => { await signOut() })

  it('removes the ticket, its attachments and the files behind them', async () => {
    const rows = await loadAttachments(ticketId)
    for (const a of rows) {
      if (a.path) await supabase.storage.from('ticket-attachments').remove([a.path])
    }
    await supabase.from('support_attachments').delete().eq('ticket_id', ticketId)
    await supabase.from('support_tickets').delete().eq('id', ticketId)

    expect(await loadAttachments(ticketId)).toEqual([])
    const { data } = await supabase.from('support_tickets').select('id').eq('id', ticketId)
    expect(data ?? []).toEqual([])
  })
})
