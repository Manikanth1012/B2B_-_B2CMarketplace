import { describe, it, expect } from 'vitest'
import { buildPdf, widthOf, wrap, encodeText, encodeMeta, Sheet, A4, MARGIN } from './pdf'
import type { Page } from './pdf'

const read = (bytes: Uint8Array) => String.fromCharCode(...bytes)

describe('measuring text', () => {
  it('measures a string against the real Helvetica widths', () => {
    /* 'M' is 833/1000 em and 'i' is 222; a font that measured them the same
       would right-align every money column wrongly and nothing would say so. */
    expect(widthOf('M', 10)).toBeCloseTo(8.33, 2)
    expect(widthOf('i', 10)).toBeCloseTo(2.22, 2)
    expect(widthOf('Mi', 10)).toBeCloseTo(10.55, 2)
  })

  it('measures bold wider than regular where it is wider', () => {
    expect(widthOf('n', 10, 'bold')).toBeGreaterThan(widthOf('n', 10, 'regular'))
  })

  it('gives every digit the same width, so figures line up', () => {
    const widths = [...'0123456789'].map(d => widthOf(d, 10))
    expect(new Set(widths).size).toBe(1)
  })

  it('scales with the point size', () => {
    expect(widthOf('Hello', 20)).toBeCloseTo(widthOf('Hello', 10) * 2, 3)
  })

  it('knows the punctuation the marketplace’s own prose uses', () => {
    for (const ch of '—·–…£') expect(widthOf(ch, 10)).toBeGreaterThan(0)
  })
})

describe('wrapping', () => {
  it('breaks on spaces to fit the column', () => {
    const lines = wrap('the quick brown fox jumps over the lazy dog', 60, 9)
    expect(lines.length).toBeGreaterThan(1)
    for (const l of lines) expect(widthOf(l, 9)).toBeLessThanOrEqual(60)
  })

  it('keeps a short string on one line', () => {
    expect(wrap('Total due', 200, 9)).toEqual(['Total due'])
  })

  /* A reference number chopped in half is worse than a line that runs a little
     wide — the first is unusable and the second is untidy. */
  it('lets a single unbreakable word overrun rather than cutting it', () => {
    expect(wrap('SB-2026-1003-1042', 10, 9)).toEqual(['SB-2026-1003-1042'])
  })

  it('survives an empty string', () => {
    expect(wrap('   ', 100, 9)).toEqual([''])
  })

  it('loses no words', () => {
    const text = 'Payment is due by the date shown on the face of this document'
    expect(wrap(text, 80, 8).join(' ')).toBe(text)
  })
})

describe('encoding a string into a content stream', () => {
  /* Unescaped, a bracket in a seller's name ends the string early and the rest
     of the page becomes PDF operators. */
  it('escapes the characters that would end the string', () => {
    expect(encodeText('Kestrel (Devices)')).toBe('Kestrel \\(Devices\\)')
    expect(encodeText('a\\b')).toBe('a\\\\b')
  })

  it('writes the punctuation this marketplace uses as WinAnsi octal', () => {
    expect(encodeText('a — b')).toBe('a \\227 b')
    expect(encodeText('a · b')).toBe('a \\267 b')
  })

  /* A missing glyph in a legal document is worse than an approximate one. */
  it('transliterates what WinAnsi has no room for', () => {
    expect(encodeText('See offers →')).toBe('See offers ->')
  })

  it('marks anything genuinely unrepresentable rather than dropping it', () => {
    expect(encodeText('日')).toBe('?')
  })

  it('drops control characters', () => {
    expect(encodeText('ab')).toBe('ab')
  })
})

describe('the file itself', () => {
  const simple: Page[] = [[
    { kind: 'text', x: 50, y: 50, text: 'Hello', size: 12, font: 'bold' },
    { kind: 'line', x1: 50, y1: 60, x2: 200, y2: 60 },
    { kind: 'rect', x: 50, y: 70, w: 100, h: 20, fill: [240, 240, 240] },
  ]]

  it('starts with a PDF header and ends with the end marker', () => {
    const out = read(buildPdf(simple))
    expect(out.startsWith('%PDF-1.4')).toBe(true)
    expect(out.trimEnd().endsWith('%%EOF')).toBe(true)
  })

  it('declares one page for one page', () => {
    expect(read(buildPdf(simple))).toContain('/Count 1')
    expect(read(buildPdf([simple[0], simple[0], simple[0]]))).toContain('/Count 3')
  })

  it('carries the text that was asked for', () => {
    expect(read(buildPdf(simple))).toContain('(Hello) Tj')
  })

  it('asks for the two standard fonts, in the encoding it writes', () => {
    const out = read(buildPdf(simple))
    expect(out).toContain('/BaseFont /Helvetica ')
    expect(out).toContain('/BaseFont /Helvetica-Bold')
    expect(out).toContain('/WinAnsiEncoding')
  })

  it('carries the title into the document properties', () => {
    expect(read(buildPdf(simple, { title: 'Your monthly bill' }))).toContain('(Your monthly bill)')
  })

  /* The Info dictionary is read as PDFDocEncoding, not WinAnsi, so the escape
     that draws an em dash on the page draws a S-caron in the title bar. */
  it('writes the title in an encoding the title bar reads', () => {
    const out = read(buildPdf(simple, { title: 'Self-billing invoice — SB-2026-1004-1042' }))
    expect(out).toContain('(Self-billing invoice - SB-2026-1004-1042)')
    expect(out).not.toContain('\\227) /Producer')
  })

  it('escapes brackets in the title too', () => {
    expect(encodeMeta('Kestrel (Devices)')).toBe('Kestrel \\(Devices\\)')
  })

  /* The cross-reference table is a table of byte offsets. If the offsets are
     wrong the file opens in some readers and not others, which is the worst
     kind of wrong — it looks fine until somebody else opens it. */
  it('writes a cross-reference offset that lands on the object it names', () => {
    const bytes = buildPdf(simple)
    const out = read(bytes)
    const xrefAt = Number(/startxref\s+(\d+)/.exec(out)![1])
    expect(out.slice(xrefAt, xrefAt + 4)).toBe('xref')

    const rows = out.slice(xrefAt).split('\n').slice(2)
      .filter(r => / 00000 n/.test(r))
      .map(r => Number(r.slice(0, 10)))
    expect(rows.length).toBeGreaterThan(3)
    rows.forEach((off, i) => {
      expect(out.slice(off, off + String(i + 1).length + 6), `object ${i + 1}`)
        .toBe(`${i + 1} 0 obj`)
    })
  })

  /* Every byte has to be a byte. Encoding as UTF-8 would shift every offset
     after the first non-ASCII character. */
  it('emits one byte per character, whatever was written', () => {
    const withDash: Page[] = [[{ kind: 'text', x: 50, y: 50, text: 'a — b', size: 10, font: 'regular' }]]
    const bytes = buildPdf(withDash)
    for (const b of bytes) expect(b).toBeLessThan(256)
    expect(read(bytes)).toContain('\\227')
  })

  it('declares a stream length that matches the stream', () => {
    const out = read(buildPdf(simple))
    const m = /<< \/Length (\d+) >>\nstream\n([\s\S]*?)\nendstream/.exec(out)!
    expect(m[2].length).toBe(Number(m[1]))
  })

  it('draws in the PDF’s own coordinate space, with the origin at the foot', () => {
    /* Asked for y=50 from the top; the stream should place it near the top of
       an 841-point page, not fifty points off the bottom. */
    const out = read(buildPdf(simple))
    const td = /([\d.]+) ([\d.]+) Td/.exec(out)!
    expect(Number(td[2])).toBeCloseTo(A4.height - 50, 1)
  })
})

describe('the sheet', () => {
  it('starts inside the margin and moves down as it writes', () => {
    const s = new Sheet()
    const top = s.y
    expect(top).toBeGreaterThanOrEqual(MARGIN)
    s.line('one')
    expect(s.y).toBeGreaterThan(top)
  })

  it('right-aligns the figure in a row', () => {
    const s = new Sheet()
    s.row('Total due', '$231.73')
    const value = s.pages[0].find(o => o.kind === 'text' && o.text === '$231.73')
    expect(value).toBeTruthy()
    if (value?.kind === 'text') {
      expect(value.align).toBe('right')
      expect(value.x).toBe(s.right)
    }
  })

  /* Every hand-written PDF layout gets the page break wrong at the foot of the
     first page. It is written once, here. */
  it('starts a new page rather than writing off the bottom of this one', () => {
    const s = new Sheet()
    for (let i = 0; i < 200; i++) s.line(`row ${i}`)
    expect(s.pages.length).toBeGreaterThan(1)
    for (const page of s.pages) {
      for (const op of page) {
        if (op.kind === 'text') expect(op.y).toBeLessThanOrEqual(A4.height - MARGIN + 1)
      }
    }
  })

  it('wraps a paragraph inside the column', () => {
    const s = new Sheet()
    s.paragraph('Payment is due by the date shown on the face of this document, and queries must be raised within thirty days of the issue date. Raising a query on one line does not suspend the obligation to pay the rest of the bill, and paying the rest does not weaken the query.')
    const lines = s.pages[0].filter(o => o.kind === 'text')
    expect(lines.length).toBeGreaterThan(1)
    for (const l of lines) {
      if (l.kind === 'text') expect(widthOf(l.text, l.size)).toBeLessThanOrEqual(s.right - s.left + 1)
    }
  })

  it('draws a rule across the column', () => {
    const s = new Sheet()
    s.rule()
    const rule = s.pages[0].find(o => o.kind === 'line')
    expect(rule).toBeTruthy()
    if (rule?.kind === 'line') {
      expect(rule.x1).toBe(s.left)
      expect(rule.x2).toBe(s.right)
    }
  })
})
