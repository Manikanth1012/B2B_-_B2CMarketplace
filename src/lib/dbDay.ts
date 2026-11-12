// "Today" the way the database judges it: the UTC calendar date. The database
// runs in UTC and accept_quote compares valid_until with current_date, so an
// on-screen expiry judgement must not use the browser's own calendar. Pure: no
// supabase import, a Date is always passed in.

const p2 = (x: number) => String(x).padStart(2, '0')

/** The database's calendar date, YYYY-MM-DD (UTC). */
export function dbToday(now: Date = new Date()): string {
  return `${now.getUTCFullYear()}-${p2(now.getUTCMonth() + 1)}-${p2(now.getUTCDate())}`
}

/** The viewer's own calendar date, YYYY-MM-DD. */
export function viewerToday(now: Date = new Date()): string {
  return `${now.getFullYear()}-${p2(now.getMonth() + 1)}-${p2(now.getDate())}`
}

/** True when the viewer's calendar date is not the database's (within a day of midnight UTC in their zone). */
export function dayDiffersFromDb(now: Date = new Date()): boolean {
  return viewerToday(now) !== dbToday(now)
}

/** A quote stays valid through its valid-until date; it is expired from the next database day. */
export function isPastDbDay(date: string | null, now: Date = new Date()): boolean {
  return date !== null && date < dbToday(now)
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** A YYYY-MM-DD date as "12 Nov 2026", read as a calendar date (never shifted by the viewer's zone). */
export function fmtDbDate(date: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  if (!m) return date
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1] ?? m[2]} ${m[1]}`
}

/** "12 Nov 2026", with " (UTC)" added only where the viewer's day and the database's could differ. */
export function validUntilLabel(date: string, now: Date = new Date()): string {
  return fmtDbDate(date) + (dayDiffersFromDb(now) ? ' (UTC)' : '')
}
