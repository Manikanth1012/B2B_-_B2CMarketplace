/* A bill as a PDF, laid out from the template the operator assigned.
 *
 * The fourth rendition of one document, and the reason they are all driven by
 * `blocksFor` rather than each deciding for itself: the operator's preview,
 * the customer's screen, the plain-text fallback and this. A section switched
 * off in the template screen has to disappear from all four, or the template
 * screen is a description of something else.
 *
 * Sections come out in the catalogue's own order, not in the order they were
 * ticked — a bill where the total precedes the charges is not a bill.
 */
import { Sheet, pdfBlob, widthOf, wrap } from './pdf'
import type { Page } from './pdf'
import { blocksFor, money } from './billTemplate'
import type { BillFacts, Template, Section } from './billTemplate'

const INK: [number, number, number] = [17, 24, 39]
const MUTED: [number, number, number] = [107, 114, 128]
const RULE: [number, number, number] = [226, 232, 240]
const WASH: [number, number, number] = [246, 248, 251]

/** '#0D47A1' → [13, 71, 161]. Falls back to the marketplace navy. */
export function hex(colour: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(colour.trim())
  if (!m) return [13, 71, 161]
  const n = parseInt(m[1], 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/**
 * The document.
 *
 * Returns pages rather than a file, so a test can look at what was laid out
 * instead of parsing a binary back.
 */
export function billPages(
  facts: BillFacts,
  template: Template,
  ids: readonly string[],
  sections: readonly Section[],
): Page[] {
  const showing = new Set(blocksFor(ids, facts))
  const order = sections.filter(s => showing.has(s.id)).map(s => s.id)
  const accent = hex(template.accent)
  const s = new Sheet()
  const forSeller = template.audience === 'partner'
  const net = facts.total - facts.tax

  const half = (s.right - s.left) / 2

  for (const id of order) {
    switch (id) {
      case 'masthead': {
        if (template.logo) s.text(facts.billedFrom.mark, { size: 15, font: 'bold', colour: accent })
        s.text(template.doc_title, { x: s.right, align: 'right', size: 12, font: 'bold', colour: INK })
        s.y += 15
        s.text(template.language, { x: s.right, align: 'right', size: 7, colour: MUTED })
        s.y += 8
        s.rule({ colour: accent, width: 1.6, gap: 14 })
        break
      }

      case 'parties': {
        const meta = [
          `Reference  ${facts.reference}`,
          `Issued  ${facts.issued}`,
          `Due  ${facts.due}`,
          /* The bill's own currency. The template's is the default a new bill is
             raised in; this one is what this bill was actually charged in. */
          `Currency  ${facts.currency}`,
        ]
        s.line(meta.join('     '), { size: 8, colour: MUTED })
        s.gap(6)

        const top = s.y
        const put = (x: number, heading: string, name: string, rest: string[]) => {
          let y = top
          s.text(heading.toUpperCase(), { x, y, size: 6.5, font: 'bold', colour: MUTED })
          y += 10
          s.text(name, { x, y, size: 9, font: 'bold', colour: INK })
          y += 11
          for (const r of rest.filter(Boolean)) {
            for (const l of wrap(r, half - 12, 7.5)) { s.text(l, { x, y, size: 7.5, colour: MUTED }); y += 9.5 }
          }
          return y
        }
        const leftEnd = put(s.left, forSeller ? 'Self-billed for' : 'Billed to',
          facts.billedTo.name,
          [...(facts.billedTo.ref ? [`Account ${facts.billedTo.ref}`] : []),
            ...facts.billedTo.lines, facts.billedTo.contact, facts.billedTo.tax ?? ''])
        const rightEnd = put(s.left + half, forSeller ? 'Raised by' : 'Bill from',
          facts.billedFrom.name, [...facts.billedFrom.lines, facts.billedFrom.tax ?? ''])
        s.y = Math.max(leftEnd, rightEnd) + 6
        break
      }

      case 'hero': {
        s.room(40)
        s.band(34, WASH)
        s.text(forSeller ? 'Net payable to seller' : 'Amount due',
          { x: s.left + 10, y: s.y + 13, size: 8, font: 'bold', colour: MUTED })
        s.text(`${facts.currencyMark}${money(facts.total)}`,
          { x: s.right - 10, y: s.y + 17, align: 'right', size: 17, font: 'bold', colour: accent })
        s.text(forSeller ? `for ${facts.due}` : `by ${facts.due}`,
          { x: s.left + 10, y: s.y + 25, size: 7.5, colour: MUTED })
        s.y += 44
        break
      }

      case 'subs':
        if (!template.show_order_lines) {
          s.row('Charges for the period — line detail suppressed on this template', mk(facts, net))
          break
        }
        for (const l of facts.lines) charge(s, l.label, l.detail, l.amount, facts.currencyMark)
        break

      case 'usage':
        if (!template.show_order_lines) break
        for (const l of facts.usage) charge(s, l.label, l.detail, l.amount, facts.currencyMark)
        break

      case 'credits':
        charge(s, 'Credits and adjustments', facts.credits === 0 ? 'None this period' : '', facts.credits, facts.currencyMark)
        break

      case 'rewards': {
        if (!facts.rewards) break
        s.gap(4)
        s.room(34)
        s.band(30, WASH)
        s.text('Reward points', { x: s.left + 10, y: s.y + 11, size: 8, font: 'bold', colour: INK })
        s.text(
          `Earned this period ${facts.rewards.earned.toLocaleString()}`
          + `      Redeemed this period ${facts.rewards.redeemed.toLocaleString()}`
          + `      Balance carried forward ${facts.rewards.balance.toLocaleString()}`,
          { x: s.left + 10, y: s.y + 22, size: 7.5, colour: MUTED })
        s.y += 40
        break
      }

      case 'tax':
        s.row(`${facts.taxLabel}${facts.taxRate ? ` at ${facts.taxRate}%` : ''}`, mk(facts, facts.tax),
          { size: 8.5, colour: MUTED })
        break

      case 'summary':
        s.rule({ colour: RULE, gap: 6 })
        s.row('Net', mk(facts, net), { size: 8.5, colour: MUTED })
        s.rule({ colour: INK, width: 1, gap: 7 })
        s.row(forSeller ? 'Net payable to seller' : 'Total due', mk(facts, facts.total),
          { size: 11, font: 'bold', colour: accent })
        s.gap(4)
        break

      case 'payments':
        charge(s, 'Paid this period', '', -facts.paid, facts.currencyMark)
        break

      case 'howtopay':
        block(s, 'How to pay', [facts.howToPay, `Quote ${facts.payRef}.`])
        break

      case 'paylink':
        block(s, 'Pay online', [`aventa.com/pay/${facts.reference}`])
        break

      case 'support':
        if (!facts.support) break
        block(s, 'Questions about this bill', [
          [facts.support.phone, facts.support.hours].filter(Boolean).join('  ·  '),
          [facts.support.email, facts.support.portal].filter(Boolean).join('  ·  '),
          `Queries must be raised within ${facts.support.window}.`,
        ])
        break

      case 'advert':
        if (!facts.advert) break
        block(s, facts.advert.title, [
          ...(facts.advert.subtitle ? [facts.advert.subtitle] : []),
          `${facts.advert.cta} →`,
        ], hex(facts.advert.accent))
        break

      /* Under the total it stamps. Nothing where no clearance was due — an
         empty heading reads as a stamp that failed rather than one that was
         never required, and two of the three markets here require none. */
      case 'fiscal': {
        if (facts.clearance.length === 0) break
        s.gap(4)
        s.line('Fiscal clearance', { size: 8, font: 'bold', colour: INK })
        for (const c of facts.clearance) s.row(c.label, c.value, { size: 7.5, colour: MUTED })
        if (facts.verifyUrl && facts.verifyUrl !== 'signed') {
          s.paragraph(`Verify at ${facts.verifyUrl}`, { size: 7, colour: MUTED })
        } else if (facts.verifyUrl === 'signed') {
          s.paragraph('Signed QR printed on the document.', { size: 7, colour: MUTED })
        }
        s.gap(4)
        break
      }

      case 'terms': {
        if (!facts.terms.length) break
        s.gap(4)
        s.line('Terms', { size: 8, font: 'bold', colour: INK })
        facts.terms.forEach((t, i) => s.paragraph(`${i + 1}. ${t}`, { size: 7, colour: MUTED }))
        s.gap(4)
        break
      }

      /* Written by an operator against this one template, so it is matched on
         the section row rather than on a name in this switch. */
      default: {
        const own = sections.find(x => x.id === id)
        if (own?.custom && own.heading && own.body) {
          s.gap(4)
          s.line(own.heading, { size: 8, font: 'bold', colour: INK })
          s.paragraph(own.body, { size: 7, colour: MUTED })
          s.gap(4)
        }
        break
      }

      case 'slip': {
        /* Label above the rule, not on it. A scissors line with words through
           it is the sort of thing that survives review and then arrives in a
           customer's letterbox. */
        s.gap(12)
        s.line('detach below this line',
          { x: s.left + (s.right - s.left) / 2, align: 'centre', size: 6.5, colour: MUTED, gap: 5 })
        s.rule({ colour: MUTED, dashed: true, gap: 12 })
        s.row(`Payment slip  ·  ${facts.payRef}`, mk(facts, facts.total), { size: 9, font: 'bold' })
        break
      }
    }
  }

  if (template.footer) {
    s.gap(8)
    s.rule({ colour: RULE, gap: 6 })
    s.paragraph(template.footer, { size: 7, colour: MUTED })
  }

  /* Page x of y, once the count is known. Numbering a document nobody can tell
     is complete is the sort of omission a finance team notices first. */
  const total = s.pages.length
  s.pages.forEach((page, i) => {
    page.push({
      kind: 'text', text: `${facts.reference}   ·   Page ${i + 1} of ${total}`,
      x: (595.28) / 2, y: 841.89 - 30, size: 6.5, font: 'regular',
      align: 'centre', colour: MUTED,
    })
  })

  return s.pages
}

/** An amount with the document's own mark in front of it. */
const mk = (facts: BillFacts, amount: number): string => `${facts.currencyMark}${money(amount)}`

function charge(s: Sheet, label: string, detail: string, amount: number, mark: string): void {
  const text = detail ? `${label}  ·  ${detail}` : label
  const figure = `${mark}${money(amount)}`
  /* Wrapped against the space left by the figure, so a long line name never
     runs underneath its own amount. The mark is part of that width — measuring
     without it is how "KSh 1,818,247.31" ends up overlapping its own label. */
  const room = s.right - s.left - widthOf(figure, 8.5) - 20
  const lines = wrap(text, room, 8.5)
  s.room(lines.length * 11 + 4)
  const top = s.y
  lines.forEach((l, i) => s.text(l, { y: top + i * 11, size: 8.5, colour: i === 0 ? INK : MUTED }))
  s.text(figure, { x: s.right, y: top, align: 'right', size: 8.5, colour: INK })
  s.y = top + lines.length * 11 + 3
  s.rule({ colour: RULE, gap: 4 })
}

function block(s: Sheet, heading: string, lines: string[], colour = INK): void {
  s.gap(4)
  s.room(20 + lines.length * 10)
  s.line(heading, { size: 8, font: 'bold', colour })
  for (const l of lines.filter(Boolean)) s.paragraph(l, { size: 7.5, colour: MUTED })
  s.gap(3)
}

/** The document, as a file a browser will download. */
export function billPdf(
  facts: BillFacts, template: Template, ids: readonly string[], sections: readonly Section[],
): Blob {
  return pdfBlob(billPages(facts, template, ids, sections), {
    title: `${template.doc_title} — ${facts.reference}`,
    author: facts.billedFrom.name,
  })
}

export function pdfNameFor(facts: BillFacts): string {
  return `${facts.reference}.pdf`
}

/** Hand a blob to the browser as a download. One place, so the cleanup is not forgotten. */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
