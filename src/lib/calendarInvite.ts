// RFC 5545 calendar text for a demo slot or a quote's expiry. Pure: no supabase,
// no DOM. The browser-side download lives in components/enquiries/downloadIcs.ts.

export const DEFAULT_DEMO_MINUTES = 30
const CRLF = '\r\n'
const PRODID = '-//Aventa//Marketplace enquiries//EN'

/** Escapes TEXT values: backslash, semicolon, comma, newline. */
export function escapeText(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r\n|\r|\n/g, '\\n')
}

/** Folds a content line at 75 octets, continuing with CRLF + space, never inside a UTF-8 character. */
export function foldLine(line: string): string {
  const enc = new TextEncoder()
  if (enc.encode(line).length <= 75) return line
  const out: string[] = []
  let cur = ''
  let curLen = 0
  let limit = 75
  for (const ch of line) {
    const n = enc.encode(ch).length
    if (curLen + n > limit) { out.push(cur); cur = ''; curLen = 0; limit = 74 }
    cur += ch; curLen += n
  }
  if (cur) out.push(cur)
  return out.join(CRLF + ' ')
}

const p2 = (x: number) => String(x).padStart(2, '0')

/** 20261112T093000Z */
export function utcStamp(d: Date): string {
  return `${d.getUTCFullYear()}${p2(d.getUTCMonth() + 1)}${p2(d.getUTCDate())}T${p2(d.getUTCHours())}${p2(d.getUTCMinutes())}${p2(d.getUTCSeconds())}Z`
}

/** 20261112 from YYYY-MM-DD, optionally some days on (calendar arithmetic, in UTC). */
export function dateValue(ymd: string, addDays = 0): string {
  const t = Date.parse(ymd + 'T00:00:00Z')
  if (Number.isNaN(t)) throw new Error('Not a calendar date: ' + ymd)
  const d = new Date(t + addDays * 86_400_000)
  return `${d.getUTCFullYear()}${p2(d.getUTCMonth() + 1)}${p2(d.getUTCDate())}`
}

export interface InviteBase {
  enquiryId: string
  /** The enquiry's updated_at; it makes SEQUENCE grow whenever the enquiry changes. */
  updatedAt: string
  summary: string
  description?: string
  location?: string
  /** When the file is made; injectable for tests. */
  now?: Date
}

const sequence = (updatedAt: string) => {
  const t = Date.parse(updatedAt)
  return Number.isNaN(t) ? 0 : Math.floor(t / 60_000)
}

function wrap(props: string[]): string {
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', `PRODID:${PRODID}`, 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'BEGIN:VEVENT', ...props, 'END:VEVENT', 'END:VCALENDAR']
    .map(foldLine).join(CRLF) + CRLF
}

function common(b: InviteBase): string[] {
  return [
    `UID:${b.enquiryId}@aventa.marketplace`,
    `SEQUENCE:${sequence(b.updatedAt)}`,
    `DTSTAMP:${utcStamp(b.now ?? new Date())}`,
  ]
}

function tail(b: InviteBase): string[] {
  const out = [`SUMMARY:${escapeText(b.summary)}`]
  if (b.description) out.push(`DESCRIPTION:${escapeText(b.description)}`)
  if (b.location) out.push(`LOCATION:${escapeText(b.location)}`)
  return out
}

/** A timed event from an ISO instant, in UTC. */
export function demoInvite(b: InviteBase & { startsAt: string; minutes?: number }): string {
  const s = new Date(b.startsAt)
  if (Number.isNaN(s.getTime())) throw new Error('Not a time: ' + b.startsAt)
  const e = new Date(s.getTime() + (b.minutes ?? DEFAULT_DEMO_MINUTES) * 60_000)
  return wrap([...common(b), `DTSTART:${utcStamp(s)}`, `DTEND:${utcStamp(e)}`, ...tail(b)])
}

/** An all-day reminder on the quote's valid-until date (DTEND is the next day, exclusive). */
export function quoteExpiryInvite(b: InviteBase & { validUntil: string }): string {
  return wrap([...common(b), `DTSTART;VALUE=DATE:${dateValue(b.validUntil)}`, `DTEND;VALUE=DATE:${dateValue(b.validUntil, 1)}`, 'TRANSP:TRANSPARENT', ...tail(b)])
}
