/* A PDF writer, in about as little as a PDF can honestly be written.
 *
 * A bill is a document, and a document that arrives as a .txt is a document
 * nobody can file, print or forward to their accounts department. The bills
 * here were plain text and the invoices were CSV — a spreadsheet of a legal
 * document, which is a different thing from the document.
 *
 * There is no PDF library in this project and this is not a good enough reason
 * to add one: `jspdf` is a third of a megabyte on a bundle that is already too
 * big, to lay out text in two fonts. What a bill needs is text at a position,
 * a rule, a filled rectangle and right-aligned figures. That is a few hundred
 * lines of PDF 1.4, it has no dependency to age, and — being pure — it can be
 * tested without a browser.
 *
 * What this deliberately does not do: images, embedded fonts, transparency,
 * compression. The standard-14 fonts are guaranteed present in every reader,
 * so an uncompressed content stream in Helvetica is a file that opens
 * everywhere and can be read in a text editor when something goes wrong.
 */

export const A4 = { width: 595.28, height: 841.89 }
export const MARGIN = 48

export type Font = 'regular' | 'bold'

export interface TextOp {
  kind: 'text'
  x: number
  y: number
  text: string
  size: number
  font: Font
  /* Right-aligned at `x` rather than starting there. Money columns are unusable
     any other way. */
  align?: 'left' | 'right' | 'centre'
  colour?: [number, number, number]
}

export interface LineOp {
  kind: 'line'
  x1: number; y1: number; x2: number; y2: number
  width?: number
  colour?: [number, number, number]
  dashed?: boolean
}

export interface RectOp {
  kind: 'rect'
  x: number; y: number; w: number; h: number
  fill: [number, number, number]
}

export type Op = TextOp | LineOp | RectOp
export type Page = Op[]

/* ------------------------------------------------------------- metrics --- */

/* Standard-14 Helvetica widths, in units of 1/1000 em. Needed for right
   alignment and for wrapping; without them every figure column is ragged. */
const HELV = ' 278!278"355#556$556%889&667\'191(333)333*389+584,278-333.278/278'
const HELV_DIGITS = 556
const HELV_UPPER = 'A667B667C722D722E667F611G778H722I278J500K667L556M833N722O778P667Q778R722S667T611U722V667W944X667Y667Z611'
const HELV_LOWER = 'a556b556c500d556e556f278g556h556i222j222k500l222m833n556o556p556q556r333s500t278u556v500w722x500y500z500'
const HELV_PUNCT = ':278;278<584=584>584?556@1015[278\\278]278^469_556`333{334|260}334~584'

const BOLD = ' 278!333"474#556$556%889&722\'238(333)333*389+584,278-333.278/278'
const BOLD_UPPER = 'A722B722C722D722E667F611G778H722I278J556K722L611M833N722O778P667Q778R722S667T611U722V667W944X667Y667Z611'
const BOLD_LOWER = 'a556b611c556d611e556f333g611h611i278j278k556l278m889n611o611p611q611r389s556t333u611v556w778x556y556z500'
const BOLD_PUNCT = ':333;333<584=584>584?611@975[333\\278]333^584_556`333{389|280}389~584'

function table(...chunks: string[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const chunk of chunks) {
    /* Each entry is one character followed by its three-digit width, except
       '@' and a couple of others which are four. Parsed by scanning rather
       than by a fixed stride. */
    let i = 0
    while (i < chunk.length) {
      const ch = chunk[i]
      let j = i + 1
      let digits = ''
      while (j < chunk.length && chunk[j] >= '0' && chunk[j] <= '9') { digits += chunk[j]; j++ }
      out[ch] = Number(digits)
      i = j
    }
  }
  return out
}

const WIDTHS: Record<Font, Record<string, number>> = {
  regular: table(HELV, HELV_UPPER, HELV_LOWER, HELV_PUNCT),
  bold: table(BOLD, BOLD_UPPER, BOLD_LOWER, BOLD_PUNCT),
}

for (const f of ['regular', 'bold'] as const) {
  for (const d of '0123456789') WIDTHS[f][d] = HELV_DIGITS
  /* The handful of non-ASCII characters this marketplace's prose actually
     uses. Anything else falls back to the width of a lowercase n, which is
     wrong by a hair rather than by a column. */
  Object.assign(WIDTHS[f], {
    '—': 1000, '–': 556, '·': 278, '…': 1000, '£': 556, '€': 556,
    '‘': 222, '’': 222, '“': 333, '”': 333, '→': 1000,
  })
}

export function widthOf(text: string, size: number, font: Font = 'regular'): number {
  let units = 0
  for (const ch of text) units += WIDTHS[font][ch] ?? WIDTHS[font].n ?? 556
  return (units * size) / 1000
}

/**
 * Break a string to fit a column.
 *
 * Breaks on spaces, and lets a single word longer than the column overrun
 * rather than chopping it mid-syllable — a broken reference number is worse
 * than a slightly wide line.
 */
export function wrap(text: string, width: number, size: number, font: Font = 'regular'): string[] {
  const words = text.split(/\s+/).filter(Boolean)
  if (!words.length) return ['']
  const lines: string[] = []
  let line = ''
  for (const w of words) {
    const candidate = line ? `${line} ${w}` : w
    if (line && widthOf(candidate, size, font) > width) { lines.push(line); line = w }
    else line = candidate
  }
  if (line) lines.push(line)
  return lines
}

/* ------------------------------------------------------------ encoding --- */

/* WinAnsi is what the standard-14 fonts are asked for below. These are the
   characters outside Latin-1 that the marketplace's own prose uses; anything
   still unmapped is transliterated rather than dropped, because a missing
   character in a legal document is worse than an approximate one. */
const WINANSI: Record<string, number> = {
  '€': 0x80, '‚': 0x82, 'ƒ': 0x83, '„': 0x84, '…': 0x85,
  '†': 0x86, '‡': 0x87, '‰': 0x89, '‹': 0x8B,
  '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95,
  '–': 0x96, '—': 0x97, '™': 0x99, '›': 0x9B,
}

const TRANSLITERATE: Record<string, string> = { '→': '->', '←': '<-', '✓': 'v', '×': 'x' }

export function encodeText(text: string): string {
  let out = ''
  for (const ch of text) {
    const swap = TRANSLITERATE[ch]
    if (swap) { out += swap; continue }
    const win = WINANSI[ch]
    if (win !== undefined) { out += `\\${win.toString(8).padStart(3, '0')}`; continue }
    const code = ch.codePointAt(0)!
    if (ch === '\\' || ch === '(' || ch === ')') { out += `\\${ch}`; continue }
    if (code < 32) continue
    if (code <= 255) {
      out += code < 127 ? ch : `\\${code.toString(8).padStart(3, '0')}`
      continue
    }
    /* Outside WinAnsi entirely — a question mark is a visible sign that
       something was lost, which beats a silent gap. */
    out += '?'
  }
  return out
}

/**
 * A string for the document properties, rather than for the page.
 *
 * The Info dictionary is read as PDFDocEncoding, not WinAnsi, so the octal
 * escape that draws an em dash on the page draws a Š in the title bar. Rather
 * than carry a second encoding table for metadata nobody reads closely, this
 * reduces to ASCII — a hyphen where an em dash was, which is what a filename
 * and a window title want anyway.
 */
export function encodeMeta(text: string): string {
  let out = ''
  for (const ch of text) {
    const code = ch.codePointAt(0)!
    if (ch === '\\' || ch === '(' || ch === ')') { out += `\\${ch}`; continue }
    if (code < 32) continue
    if (code < 127) { out += ch; continue }
    out += ({ '—': '-', '–': '-', '·': '-', '’': "'", '‘': "'", '“': '"', '”': '"', '…': '...' } as Record<string, string>)[ch] ?? ''
  }
  return out.replace(/\s+/g, ' ').trim()
}

/* ------------------------------------------------------------- writing --- */

function rgb(c: [number, number, number] | undefined): string {
  const [r, g, b] = c ?? [0, 0, 0]
  return `${(r / 255).toFixed(3)} ${(g / 255).toFixed(3)} ${(b / 255).toFixed(3)}`
}

function streamFor(ops: Page): string {
  const out: string[] = []
  for (const op of ops) {
    if (op.kind === 'rect') {
      out.push(`q ${rgb(op.fill)} rg ${op.x.toFixed(2)} ${(A4.height - op.y - op.h).toFixed(2)} ${op.w.toFixed(2)} ${op.h.toFixed(2)} re f Q`)
    } else if (op.kind === 'line') {
      const y1 = A4.height - op.y1
      const y2 = A4.height - op.y2
      out.push(
        `q ${rgb(op.colour)} RG ${(op.width ?? 0.6).toFixed(2)} w`
        + (op.dashed ? ' [3 2] 0 d' : '')
        + ` ${op.x1.toFixed(2)} ${y1.toFixed(2)} m ${op.x2.toFixed(2)} ${y2.toFixed(2)} l S Q`)
    } else {
      const w = widthOf(op.text, op.size, op.font)
      const x = op.align === 'right' ? op.x - w : op.align === 'centre' ? op.x - w / 2 : op.x
      out.push(
        `BT /${op.font === 'bold' ? 'F2' : 'F1'} ${op.size} Tf ${rgb(op.colour)} rg`
        + ` ${x.toFixed(2)} ${(A4.height - op.y).toFixed(2)} Td (${encodeText(op.text)}) Tj ET`)
    }
  }
  return out.join('\n')
}

/**
 * The file itself.
 *
 * Built as a string and then encoded byte-for-byte as latin1, because a PDF's
 * cross-reference table is a table of byte offsets: encoding as UTF-8 would
 * shift every offset after the first non-ASCII character and produce a file
 * that opens in some readers and not others. `encodeText` has already reduced
 * every string to bytes below 256, so latin1 is lossless here.
 */
export function buildPdf(pages: Page[], meta: { title: string; author?: string } = { title: 'Document' }): Uint8Array {
  const objects: string[] = []
  const add = (body: string) => { objects.push(body); return objects.length }

  /* Reserve 1 for the catalogue and 2 for the page tree, which have to know
     ids that do not exist yet. */
  objects.push('', '')

  const fontRegular = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>')
  const fontBold = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>')

  const pageIds: number[] = []
  for (const ops of pages) {
    const stream = streamFor(ops)
    const contentId = add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`)
    pageIds.push(add(
      '<< /Type /Page /Parent 2 0 R'
      + ` /MediaBox [0 0 ${A4.width} ${A4.height}]`
      + ` /Resources << /Font << /F1 ${fontRegular} 0 R /F2 ${fontBold} 0 R >> >>`
      + ` /Contents ${contentId} 0 R >>`))
  }

  const infoId = add(
    `<< /Title (${encodeMeta(meta.title)}) /Producer (Aventa Marketplace)`
    + (meta.author ? ` /Author (${encodeMeta(meta.author)})` : '') + ' >>')

  objects[0] = '<< /Type /Catalog /Pages 2 0 R >>'
  objects[1] = `<< /Type /Pages /Kids [${pageIds.map(id => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`

  let body = '%PDF-1.4\n'
  const offsets: number[] = []
  objects.forEach((obj, i) => {
    offsets.push(body.length)
    body += `${i + 1} 0 obj\n${obj}\nendobj\n`
  })

  const xref = body.length
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const off of offsets) body += `${String(off).padStart(10, '0')} 00000 n \n`
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info ${infoId} 0 R >>\n`
    + `startxref\n${xref}\n%%EOF\n`

  const bytes = new Uint8Array(body.length)
  for (let i = 0; i < body.length; i++) bytes[i] = body.charCodeAt(i) & 0xff
  return bytes
}

/* ---------------------------------------------------------- the cursor --- */

/**
 * A page that knows how far down it has got.
 *
 * Every layout that writes a PDF by hand ends up tracking a y and a page
 * break, and every one of them gets the break wrong at the bottom of the
 * first page. It is written once here.
 */
export class Sheet {
  readonly pages: Page[] = [[]]
  y = MARGIN + 14
  readonly left = MARGIN
  readonly right = A4.width - MARGIN

  private get page(): Page { return this.pages[this.pages.length - 1] }

  /** Start a new page if the next `needed` points would run off this one. */
  room(needed: number): void {
    if (this.y + needed <= A4.height - MARGIN) return
    this.pages.push([])
    this.y = MARGIN + 14
  }

  text(text: string, opts: Partial<Omit<TextOp, 'kind' | 'text'>> = {}): void {
    this.page.push({
      kind: 'text', text,
      x: opts.x ?? this.left, y: opts.y ?? this.y,
      size: opts.size ?? 9, font: opts.font ?? 'regular',
      align: opts.align, colour: opts.colour,
    })
  }

  /** Text, and move down. The common case. */
  line(text: string, opts: Partial<Omit<TextOp, 'kind' | 'text'>> & { gap?: number } = {}): void {
    const size = opts.size ?? 9
    this.room(size + 4)
    this.text(text, opts)
    this.y += opts.gap ?? size + 3
  }

  /** A label on the left and a figure right-aligned at the margin. */
  row(label: string, value: string, opts: { size?: number; font?: Font; colour?: [number, number, number] } = {}): void {
    const size = opts.size ?? 9
    this.room(size + 5)
    this.text(label, { size, font: opts.font, colour: opts.colour })
    this.text(value, { x: this.right, align: 'right', size, font: opts.font, colour: opts.colour })
    this.y += size + 5
  }

  rule(opts: { colour?: [number, number, number]; width?: number; dashed?: boolean; gap?: number } = {}): void {
    this.room(6)
    this.page.push({
      kind: 'line', x1: this.left, y1: this.y, x2: this.right, y2: this.y,
      colour: opts.colour, width: opts.width, dashed: opts.dashed,
    })
    this.y += opts.gap ?? 8
  }

  band(height: number, fill: [number, number, number]): void {
    this.room(height + 4)
    this.page.push({ kind: 'rect', x: this.left, y: this.y - 3, w: this.right - this.left, h: height, fill })
  }

  gap(n = 8): void { this.y += n }

  /** Wrapped prose across the full column. */
  paragraph(text: string, opts: { size?: number; colour?: [number, number, number]; font?: Font } = {}): void {
    const size = opts.size ?? 8
    for (const l of wrap(text, this.right - this.left, size, opts.font ?? 'regular')) {
      this.line(l, { size, colour: opts.colour, font: opts.font, gap: size + 2.5 })
    }
  }
}

/** Turn a finished sheet into something a browser will download. */
export function pdfBlob(pages: Page[], meta: { title: string; author?: string }): Blob {
  return new Blob([buildPdf(pages, meta) as unknown as BlobPart], { type: 'application/pdf' })
}
