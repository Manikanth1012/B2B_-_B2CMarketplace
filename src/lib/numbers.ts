/* Numbers, SIMs and eSIM profiles.
 *
 * The design position, which the whole module is built around: ICCID, IMSI and
 * MSISDN belong to the BSS. The marketplace holds the blocks it reserved and
 * the numbers it allocated out of them, and nothing else. There is no row per
 * free number — a block of 100,000 is 100,000 rows of nothing, and the moment
 * it exists it is a second answer to "is this number free" that will disagree
 * with the system that actually knows.
 *
 * Free is arithmetic. The screen says so rather than implying a register.
 *
 * No Supabase here.
 */

export type NumberKind = 'msisdn' | 'iccid' | 'imsi' | 'eid'
export type Purpose = 'retail' | 'enterprise' | 'iot' | 'test'
export type NumberState = 'reserved' | 'assigned' | 'suspended' | 'quarantine' | 'released'
export type EsimState = 'released' | 'downloaded' | 'installed' | 'enabled' | 'disabled' | 'deleted'

export interface ResourceSystem {
  id: string
  name: string
  resources: string[]
  interface: string
  mode: 'real-time' | 'batch' | 'delegated'
  sync_state: 'healthy' | 'degraded' | 'down'
  last_sync: string | null
  /* Null where nobody measures it. Zero is a claim; "not measured" is the
     truth, and a dashboard that prints 0 ms has said something false. */
  latency_ms: number | null
  note: string | null
}

export interface NumberRange {
  id: string
  kind: NumberKind
  system_id: string
  market: string
  purpose: Purpose
  range_from: string
  range_to: string
  size: number
  /* What the owning system has actually promised. Planning against the block
     size is planning against numbers we do not have. */
  reserved: number
  expires_on: string | null
  status: 'active' | 'expiring' | 'exhausted' | 'released'
  note: string | null
  claimed_on: string
}

export interface RangeUse {
  range_id: string
  kind: NumberKind
  market: string
  purpose: Purpose
  system_id: string
  range_from: string
  range_to: string
  size: number
  reserved: number
  expires_on: string | null
  status: NumberRange['status']
  assigned: number
  suspended: number
  quarantine: number
  held: number
  free: number
  used_pct: number
}

export interface NumberResource {
  id: string
  kind: NumberKind
  value: string
  range_id: string
  market: string
  purpose: Purpose
  state: NumberState
  user_id: string | null
  account_id: string | null
  /* The device it is fitted to. This is the join that makes a shipped sensor
     reachable — a serial the warehouse already tracks, with the SIM in it. */
  stock_serial: string | null
  holder_name: string | null
  paired_with: string | null
  order_ref: string | null
  plan: string | null
  bss_ref: string | null
  assigned_on: string | null
  activated_on: string | null
  suspended_on: string | null
  released_on: string | null
  reusable_from: string | null
  note: string | null
}

/** From `number_holder`, which resolves the id into a name. A user id does not
    answer "whose number is this". */
export interface HeldNumber extends NumberResource {
  holder: string | null
  device: string | null
  device_order: string | null
}

export interface EsimProfile {
  iccid: string
  eid: string | null
  resource_id: string | null
  state: EsimState
  smdp: string
  activation_code: string | null
  released_on: string
  changed_on: string | null
  note: string | null
}

export const KIND_LABEL: Record<NumberKind, string> = {
  msisdn: 'Mobile number',
  iccid: 'SIM',
  imsi: 'IMSI',
  eid: 'eSIM identifier',
}

export const PURPOSE_LABEL: Record<Purpose, string> = {
  retail: 'Retail customers',
  enterprise: 'Enterprise accounts',
  iot: 'IoT and M2M',
  test: 'Testing',
}

export const STATE_LABEL: Record<NumberState, string> = {
  reserved: 'Held',
  assigned: 'In use',
  suspended: 'Suspended',
  quarantine: 'In quarantine',
  released: 'Released',
}

export const STATE_TONE: Record<NumberState, string> = {
  reserved: 'pending',
  assigned: 'active',
  suspended: 'paused',
  quarantine: 'sunset',
  released: 'retired',
}

/* The states SGP.22 defines, in the order it defines them. Rendering them in
   any other order invites somebody to read the list as a menu. */
export const ESIM_ORDER: EsimState[] = [
  'released', 'downloaded', 'installed', 'enabled', 'disabled', 'deleted',
]

export const ESIM_LABEL: Record<EsimState, string> = {
  released: 'Released to the device',
  downloaded: 'Downloaded',
  installed: 'Installed',
  enabled: 'Enabled',
  disabled: 'Disabled',
  deleted: 'Deleted',
}

/* ---- Reading a block ------------------------------------------------------- */

/** Utilisation against what was reserved, never against the block size. A block
    of 10,000 with 500 reserved and 500 assigned is full, and reporting it as 5%
    is how a team runs out of numbers on a Friday. */
export function utilisation(u: RangeUse): number {
  if (u.reserved <= 0) return 0
  return Math.round(((u.reserved - u.free) / u.reserved) * 1000) / 10
}

/** What the screen has to say about a block, in the order somebody needs it.
    A reservation about to lapse matters more than one that is nearly full,
    because losing the block loses the numbers already in it. */
export type BlockAlarm =
  | { level: 'none' }
  | { level: 'warn' | 'danger'; why: string }

export function blockAlarm(u: RangeUse, today = new Date()): BlockAlarm {
  if (u.status === 'released') return { level: 'none' }

  if (u.expires_on) {
    const days = Math.round((new Date(u.expires_on).getTime() - today.getTime()) / 86400000)
    if (days < 0) {
      return { level: 'danger', why: `The reservation lapsed on ${u.expires_on}. The owning system can take these numbers back.` }
    }
    if (days <= 90) {
      return {
        level: days <= 30 ? 'danger' : 'warn',
        why: `The reservation runs out in ${days} day${days === 1 ? '' : 's'}, on ${u.expires_on}${
          u.assigned > 0 ? ` — ${u.assigned.toLocaleString('en-US')} numbers in it are in use` : ''}.`,
      }
    }
  }

  const used = utilisation(u)
  if (used >= 95) return { level: 'danger', why: `${used}% of the reservation is allocated. Claim more before it runs out.` }
  if (used >= 80) return { level: 'warn', why: `${used}% of the reservation is allocated.` }
  return { level: 'none' }
}

/** The sentence under a block. It has to say that free is arithmetic rather
    than a list, or the screen implies a register the marketplace does not
    have and should not have. */
export function blockLine(u: RangeUse): string {
  return `${u.range_from}–${u.range_to} · ${u.size.toLocaleString('en-US')} in the block, `
    + `${u.reserved.toLocaleString('en-US')} reserved from ${u.system_id}, `
    + `${(u.reserved - u.free).toLocaleString('en-US')} allocated. `
    + `Free is the remainder, not a list held here.`
}

/* ---- Reading a number ------------------------------------------------------ */

/** Who or what has this number. A person, an account, or a device on an order —
    and where it is a device, the device is the answer, not the account. */
export function heldBy(n: HeldNumber): string {
  if (n.state === 'quarantine') {
    return `Nobody — released${n.released_on ? ` on ${n.released_on}` : ''}, and not reissuable until ${n.reusable_from ?? 'a date nobody recorded'}`
  }
  if (n.state === 'released') return 'Nobody'
  if (n.stock_serial) {
    return `${n.device ?? 'a device'} ${n.stock_serial}${n.holder ? `, at ${n.holder}` : ''}${
      n.device_order ? `, from ${n.device_order}` : ''}`
  }
  return n.holder ?? 'Assigned, and the directory cannot name the holder'
}

/** Whether a number can be reissued today. A released MSISDN handed straight
    back to the pool sends the previous holder's calls to the next one, so
    ninety days is the rule and the screen states the date. */
export function reusable(n: NumberResource, today = new Date()): boolean {
  if (n.state !== 'quarantine' && n.state !== 'released') return false
  if (!n.reusable_from) return false
  return new Date(n.reusable_from) <= today
}

/** What kind of thing somebody typed into the box. Support reads out whatever
    the customer has in front of them and does not know which it is. */
export function lookupKind(q: string): NumberKind | 'order' | 'serial' | 'name' | null {
  const s = q.trim().replace(/[\s+-]/g, '')
  if (!s) return null
  if (/^ORD/i.test(q.trim())) return 'order'
  if (/^89\d{17,18}$/.test(s)) return 'iccid'
  if (/^89\d{30}$/.test(s)) return 'eid'
  if (/^\d{9,13}$/.test(s)) return 'msisdn'
  if (/^[A-Z][A-Z0-9]{2,}-\d+$/i.test(q.trim())) return 'serial'
  if (/^35\d{13}$/.test(s)) return 'serial'
  return 'name'
}

/* An M2M number is not a retail number. India's M2M series is thirteen digits
   precisely so a module's number cannot be handed to a handset, and a screen
   that lets somebody pick the wrong block issues a number that will not
   register. */
export function purposeFits(purpose: Purpose, target: 'person' | 'account' | 'device'): boolean {
  if (target === 'device') return purpose === 'iot' || purpose === 'enterprise'
  if (target === 'person') return purpose === 'retail' || purpose === 'enterprise'
  return purpose === 'enterprise' || purpose === 'iot'
}

export type Check = { ok: true; note?: string } | { ok: false; reason: string }

export function validateAssignment(a: {
  kind?: NumberKind; market?: string; purpose?: Purpose
  user_id?: string | null; account_id?: string | null; stock_serial?: string | null
}): Check {
  if (!a.kind) return { ok: false, reason: 'Say what kind of resource this is.' }
  if (!a.market) return { ok: false, reason: 'A number is allocated in a market. Its shape depends on which.' }
  if (!a.purpose) return { ok: false, reason: 'Say what the number is for — the blocks are not interchangeable.' }

  const holders = [a.user_id, a.account_id].filter(Boolean).length
  if (holders === 0) {
    return { ok: false, reason: 'A number belongs to a person or to an account. One with neither belongs to nobody.' }
  }
  if (holders > 1) {
    return { ok: false, reason: 'A number belongs to one person or one account, not both — two holders is two answers.' }
  }
  if (a.stock_serial && a.purpose === 'retail') {
    return {
      ok: false,
      reason: 'A retail number is held by a person, not fitted to a warehouse unit. Use an IoT or enterprise block.',
    }
  }
  if (a.stock_serial && !purposeFits(a.purpose, 'device')) {
    return { ok: false, reason: `A ${PURPOSE_LABEL[a.purpose].toLowerCase()} block cannot be fitted to a device.` }
  }
  if (a.purpose === 'iot' && !a.stock_serial) {
    return {
      ok: true,
      note: 'No device named. An M2M number with nothing to put it in is a number nobody can use — worth saying which sensor this is for.',
    }
  }
  return { ok: true }
}

/* ---- eSIM ------------------------------------------------------------------ */

/* The SM-DP+ owns these states and the marketplace observes them. Forward only,
   except enable and disable, which really do go both ways on a handset. */
const ESIM_NEXT: Record<EsimState, EsimState[]> = {
  released: ['downloaded', 'deleted'],
  downloaded: ['installed', 'deleted'],
  installed: ['enabled', 'deleted'],
  enabled: ['disabled', 'deleted'],
  disabled: ['enabled', 'deleted'],
  deleted: [],
}

export const esimNext = (from: EsimState): EsimState[] => ESIM_NEXT[from]

export function canMoveProfile(from: EsimState, to: EsimState): Check {
  if (from === to) return { ok: false, reason: `The profile is already ${ESIM_LABEL[to].toLowerCase()}.` }
  if (!ESIM_NEXT[from].includes(to)) {
    return {
      ok: false,
      reason: `SGP.22 does not allow ${ESIM_LABEL[from].toLowerCase()} to go to ${ESIM_LABEL[to].toLowerCase()}. A profile that skips a state is not one.`,
    }
  }
  if (to === 'deleted') {
    return { ok: true, note: 'Deleting a profile is unrecoverable. The device needs a new one issued, not this one restored.' }
  }
  return { ok: true }
}

/** How far along the standard's ladder a profile is, for a progress rail. */
export const esimStep = (s: EsimState): number => ESIM_ORDER.indexOf(s)

/* ---- Reading the estate ---------------------------------------------------- */

/** What is out there, grouped the way somebody asks about it: how many numbers
    are working, how many are on devices, how many are waiting to come back. */
export function estate(numbers: readonly HeldNumber[]): {
  inUse: number; onDevices: number; suspended: number; quarantined: number; people: number; accounts: number
} {
  return {
    inUse: numbers.filter(n => n.state === 'assigned').length,
    onDevices: numbers.filter(n => n.state === 'assigned' && n.stock_serial).length,
    suspended: numbers.filter(n => n.state === 'suspended').length,
    quarantined: numbers.filter(n => n.state === 'quarantine').length,
    people: new Set(numbers.filter(n => n.user_id).map(n => n.user_id)).size,
    accounts: new Set(numbers.filter(n => n.account_id).map(n => n.account_id)).size,
  }
}

/** A device with a SIM and no number is a device nobody can reach. A count of
    SIMs would report it as connected. */
export function unreachable(numbers: readonly HeldNumber[]): HeldNumber[] {
  const numbered = new Set(
    numbers.filter(n => n.kind === 'msisdn' && n.stock_serial).map(n => n.stock_serial))
  return numbers.filter(n => n.kind === 'iccid' && n.stock_serial && !numbered.has(n.stock_serial))
}

/** What a system is claiming, and whether anybody has checked lately. A system
    that has not synced since yesterday is reporting yesterday. */
export function systemLine(s: ResourceSystem, now = new Date()): string {
  if (!s.last_sync) return 'Never synced, so nothing here has been confirmed against it'
  const mins = Math.round((now.getTime() - new Date(s.last_sync).getTime()) / 60000)
  const age = mins < 60 ? `${mins} minutes ago`
    : mins < 1440 ? `${Math.round(mins / 60)} hours ago`
    : `${Math.round(mins / 1440)} days ago`
  const latency = s.latency_ms == null
    ? 'latency is not measured on this interface'
    : `${s.latency_ms} ms`
  return `${s.interface} · ${s.mode} · synced ${age} · ${latency}`
}
