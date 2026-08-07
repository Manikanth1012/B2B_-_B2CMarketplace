import { describe, it, expect } from 'vitest'
import {
  KIND_LABEL, PURPOSE_LABEL, STATE_LABEL, ESIM_ORDER, ESIM_LABEL,
  utilisation, blockAlarm, blockLine, heldBy, reusable, lookupKind,
  purposeFits, validateAssignment, esimNext, canMoveProfile, esimStep,
  estate, unreachable, systemLine,
} from './numbers'
import type { RangeUse, HeldNumber, ResourceSystem } from './numbers'

const use = (over: Partial<RangeUse> = {}): RangeUse => ({
  range_id: 'RNG-IN-M2M', kind: 'msisdn', market: 'IN', purpose: 'iot', system_id: 'SYS-BSS',
  range_from: '8912345600000', range_to: '8912345609999', size: 10000, reserved: 4000,
  expires_on: null, status: 'active', assigned: 105, suspended: 0, quarantine: 0, held: 0,
  free: 3895, used_pct: 2.6, ...over,
})

const n = (over: Partial<HeldNumber> = {}): HeldNumber => ({
  id: 'MSISDN-8912345600001', kind: 'msisdn', value: '8912345600001', range_id: 'RNG-IN-M2M',
  market: 'IN', purpose: 'iot', state: 'assigned', user_id: null, account_id: 'ENT-2007',
  stock_serial: null, holder_name: null, paired_with: null, order_ref: null, plan: null,
  bss_ref: 'TMF652-ABC', assigned_on: '2026-07-01', activated_on: '2026-07-01',
  suspended_on: null, released_on: null, reusable_from: null, note: null,
  holder: 'SmartBuild Ltd', device: null, device_order: null, ...over,
})

describe('reading a block', () => {
  it('measures against what was reserved, never against the block size', () => {
    /* 10,000 in the block, 500 reserved, 500 allocated. That block is full,
       and reporting it as 5% is how a team runs out of numbers on a Friday. */
    expect(utilisation(use({ size: 10000, reserved: 500, free: 0 }))).toBe(100)
    expect(utilisation(use({ size: 10000, reserved: 500, free: 250 }))).toBe(50)
  })

  it('is not a division by nothing when nothing is reserved', () => {
    expect(utilisation(use({ reserved: 0, free: 0 }))).toBe(0)
  })

  it('says free is arithmetic rather than a list held here', () => {
    const line = blockLine(use())
    expect(line).toContain('reserved from SYS-BSS')
    expect(line).toContain('not a list held here')
  })
})

describe('what needs attention', () => {
  const today = new Date('2026-08-07')

  it('is quiet about a block with room and time', () => {
    expect(blockAlarm(use(), today).level).toBe('none')
  })

  it('warns before a reservation lapses, not after', () => {
    const a = blockAlarm(use({ expires_on: '2026-09-30' }), today)
    expect(a.level).toBe('warn')
    if (a.level !== 'none') expect(a.why).toContain('54 days')
  })

  it('escalates inside a month, and says how many numbers are at stake', () => {
    const a = blockAlarm(use({ expires_on: '2026-08-20', assigned: 105 }), today)
    expect(a.level).toBe('danger')
    if (a.level !== 'none') expect(a.why).toContain('105 numbers in it are in use')
  })

  it('says plainly when a reservation has already gone', () => {
    const a = blockAlarm(use({ expires_on: '2026-07-01' }), today)
    expect(a.level).toBe('danger')
    if (a.level !== 'none') expect(a.why).toContain('lapsed')
  })

  it('warns on a block that is nearly allocated out', () => {
    expect(blockAlarm(use({ reserved: 1000, free: 150 }), today).level).toBe('warn')
    expect(blockAlarm(use({ reserved: 1000, free: 20 }), today).level).toBe('danger')
  })

  it('has nothing to say about a block already given back', () => {
    expect(blockAlarm(use({ status: 'released', reserved: 100, free: 0 }), today).level).toBe('none')
  })
})

describe('who has a number', () => {
  it('names an account', () => {
    expect(heldBy(n())).toBe('SmartBuild Ltd')
  })

  it('answers with the device where there is one, not with the account', () => {
    /* "Whose is this SIM" is answered by the sensor it is in. The account is
       context; the device is the answer. */
    const line = heldBy(n({
      stock_serial: 'SKU5007-0000012', device: 'Volta IoT Gateway LTE-M',
      device_order: 'ORD-882091', holder: 'SmartBuild Ltd',
    }))
    expect(line).toContain('Volta IoT Gateway LTE-M')
    expect(line).toContain('SKU5007-0000012')
    expect(line).toContain('ORD-882091')
    expect(line).toContain('SmartBuild Ltd')
  })

  it('says a quarantined number belongs to nobody, and when it comes back', () => {
    const line = heldBy(n({ state: 'quarantine', released_on: '2026-08-01', reusable_from: '2026-10-30' }))
    expect(line).toContain('Nobody')
    expect(line).toContain('2026-10-30')
  })

  it('does not pretend to know a holder it cannot name', () => {
    expect(heldBy(n({ holder: null }))).toContain('cannot name the holder')
  })

  it('will not reissue a number inside its quarantine', () => {
    const today = new Date('2026-09-01')
    expect(reusable(n({ state: 'quarantine', reusable_from: '2026-10-30' }), today)).toBe(false)
    expect(reusable(n({ state: 'quarantine', reusable_from: '2026-08-01' }), today)).toBe(true)
    /* And an assigned number is never reusable, whatever date is on it. */
    expect(reusable(n({ state: 'assigned', reusable_from: '2020-01-01' }), today)).toBe(false)
  })
})

describe('finding one', () => {
  it('recognises what somebody read out', () => {
    expect(lookupKind('8912345600001')).toBe('msisdn')
    expect(lookupKind('+91 98765 00001')).toBe('msisdn')
    expect(lookupKind('8991012000000000001')).toBe('iccid')
    expect(lookupKind('ORD-882091')).toBe('order')
    expect(lookupKind('SKU5007-0000012')).toBe('serial')
    expect(lookupKind('SmartBuild')).toBe('name')
    expect(lookupKind('  ')).toBeNull()
  })
})

describe('allocating', () => {
  it('refuses a number that belongs to nobody', () => {
    const r = validateAssignment({ kind: 'msisdn', market: 'IN', purpose: 'retail' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toContain('belongs to nobody')
  })

  it('refuses a number that belongs to two holders', () => {
    const r = validateAssignment({
      kind: 'msisdn', market: 'IN', purpose: 'enterprise',
      user_id: 'u1', account_id: 'ENT-2007',
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toContain('two answers')
  })

  it('refuses a retail number fitted to a warehouse unit', () => {
    /* A retail block is for people. Putting one in a sensor issues a number
       out of the wrong series. */
    const r = validateAssignment({
      kind: 'iccid', market: 'IN', purpose: 'retail',
      account_id: 'ENT-2007', stock_serial: 'SKU5007-0000012',
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toContain('held by a person')
  })

  it('allows an M2M SIM in a device', () => {
    expect(validateAssignment({
      kind: 'iccid', market: 'IN', purpose: 'iot',
      account_id: 'ENT-2007', stock_serial: 'SKU5007-0000012',
    }).ok).toBe(true)
  })

  it('notes an M2M number with nothing to put it in', () => {
    const r = validateAssignment({ kind: 'msisdn', market: 'IN', purpose: 'iot', account_id: 'ENT-2007' })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.note).toContain('nobody can use')
  })

  it('knows which blocks suit which target', () => {
    expect(purposeFits('retail', 'device')).toBe(false)
    expect(purposeFits('iot', 'device')).toBe(true)
    expect(purposeFits('iot', 'person')).toBe(false)
    expect(purposeFits('retail', 'person')).toBe(true)
  })

  it('insists on a market, because the shape depends on it', () => {
    const r = validateAssignment({ kind: 'msisdn', purpose: 'retail', user_id: 'u1' })
    expect(r.ok).toBe(false)
  })
})

describe('eSIM profiles', () => {
  it('walks the ladder the standard defines and no other', () => {
    expect(ESIM_ORDER).toEqual(['released', 'downloaded', 'installed', 'enabled', 'disabled', 'deleted'])
    expect(esimNext('released')).toEqual(['downloaded', 'deleted'])
    expect(esimNext('deleted')).toEqual([])
  })

  it('refuses a profile that skips a state', () => {
    /* Claiming a released profile is enabled asserts something only the
       handset knows. */
    const r = canMoveProfile('released', 'enabled')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toContain('SGP.22 does not allow')
  })

  it('lets enable and disable go both ways, because on a handset they do', () => {
    expect(canMoveProfile('enabled', 'disabled').ok).toBe(true)
    expect(canMoveProfile('disabled', 'enabled').ok).toBe(true)
  })

  it('says deleting is unrecoverable', () => {
    const r = canMoveProfile('enabled', 'deleted')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.note).toContain('unrecoverable')
  })

  it('will not move a deleted profile anywhere', () => {
    expect(canMoveProfile('deleted', 'enabled').ok).toBe(false)
  })

  it('places a state on the ladder for a progress rail', () => {
    expect(esimStep('released')).toBe(0)
    expect(esimStep('enabled')).toBe(3)
  })

  it('has a word for every state', () => {
    for (const s of ESIM_ORDER) expect(ESIM_LABEL[s]).toBeTruthy()
  })
})

describe('the estate', () => {
  const rows = [
    n({ id: '1', state: 'assigned', account_id: 'ENT-2007', stock_serial: 'S1', kind: 'iccid' }),
    n({ id: '2', state: 'assigned', account_id: 'ENT-2007', stock_serial: 'S1', kind: 'msisdn' }),
    n({ id: '3', state: 'assigned', account_id: null, user_id: 'u1' }),
    n({ id: '4', state: 'quarantine', account_id: null, reusable_from: '2026-11-01' }),
    n({ id: '5', state: 'suspended', account_id: 'ENT-2012' }),
  ]

  it('counts what is working, what is on a device and what is waiting', () => {
    const e = estate(rows)
    expect(e.inUse).toBe(3)
    expect(e.onDevices).toBe(2)
    expect(e.quarantined).toBe(1)
    expect(e.suspended).toBe(1)
    expect(e.people).toBe(1)
    expect(e.accounts).toBe(2)
  })

  it('finds a device with a SIM and no number', () => {
    /* A count of SIMs would report it as connected. It is a brick. */
    const dark = unreachable([
      n({ id: 'a', kind: 'iccid', stock_serial: 'S9' }),
      n({ id: 'b', kind: 'iccid', stock_serial: 'S1' }),
      n({ id: 'c', kind: 'msisdn', stock_serial: 'S1' }),
    ])
    expect(dark.map(d => d.stock_serial)).toEqual(['S9'])
  })
})

describe('the systems behind it', () => {
  const s = (over: Partial<ResourceSystem> = {}): ResourceSystem => ({
    id: 'SYS-BSS', name: 'Aventa BSS', resources: ['msisdn'],
    interface: 'TMF639', mode: 'real-time', sync_state: 'healthy',
    last_sync: '2026-08-07T09:00:00Z', latency_ms: 180, note: null, ...over,
  })

  it('declares a latency nobody measures rather than printing a zero', () => {
    /* A file drop has no latency to report, and 0 ms is a claim. */
    expect(systemLine(s({ latency_ms: null }), new Date('2026-08-07T09:10:00Z')))
      .toContain('latency is not measured')
    expect(systemLine(s(), new Date('2026-08-07T09:10:00Z'))).toContain('180 ms')
  })

  it('says how stale the answer is', () => {
    expect(systemLine(s(), new Date('2026-08-07T09:10:00Z'))).toContain('10 minutes ago')
    expect(systemLine(s(), new Date('2026-08-08T09:00:00Z'))).toContain('1 days ago')
  })

  it('says plainly when nobody has ever checked', () => {
    expect(systemLine(s({ last_sync: null }))).toContain('Never synced')
  })

  it('has a word for every kind and purpose', () => {
    for (const k of ['msisdn', 'iccid', 'imsi', 'eid'] as const) expect(KIND_LABEL[k]).toBeTruthy()
    for (const p of ['retail', 'enterprise', 'iot', 'test'] as const) expect(PURPOSE_LABEL[p]).toBeTruthy()
    for (const st of ['reserved', 'assigned', 'suspended', 'quarantine', 'released'] as const) {
      expect(STATE_LABEL[st]).toBeTruthy()
    }
  })
})
