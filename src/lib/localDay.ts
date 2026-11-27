/* A timestamp's day in the operator's own time zone, as YYYY-MM-DD: the form a
   native date input reads and writes, and the day the screen shows the row on.
   Slicing the stored ISO string gives the UTC day, which for an operator east
   of UTC loses the first hours of a local day and for one west of UTC gains them. */
export function localDay(ts: string): string {
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return ''
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** True when the timestamp's local day is within from..to; an empty bound is open. */
export function inLocalRange(ts: string, from: string, to: string): boolean {
  if (!from && !to) return true
  const day = localDay(ts)
  return (!from || day >= from) && (!to || day <= to)
}
