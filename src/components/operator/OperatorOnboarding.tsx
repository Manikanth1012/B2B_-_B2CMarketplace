import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import {
  SectionCard, EmptyState, Btn, Modal, FormField, TextArea, TextInput, Select, toast,
} from './shared'
import { CircleAlert as AlertCircle, Clock } from 'lucide-react'
import { clearGate, loadOnboarding } from '../../lib/onboardingRepo'
import type { OnboardingSnapshot } from '../../lib/onboardingRepo'
import { loadPartnerDirectory } from '../../lib/partnerRepo'
import { matchesSearch } from '../../lib/partnerDirectory'
import type { PartnerDirectoryRow } from '../../lib/partnerRepo'
import { canClearGate, gateIdFor, GATES, SLA_DAYS, deriveTaskState, journeyProgress } from '../../lib/onboarding'
import type { JourneyStep } from '../../lib/onboarding'
import { TechChecklist } from '../TechChecklist'
import { JourneyRail, GateDetail, Callout } from '../OnboardingJourney'
import type { Viewer } from '../../lib/evidence'

const OPERATOR: Viewer = { persona: 'operator' }

const PARTNER_TYPES = ['Content provider', 'Device OEM', 'Insurance', 'IoT hardware', 'Reseller', 'Security ISV']

/* Only sellers with an application still running belong in a queue. A partner
   that went live in 2024 sitting on a chase list is how an onboarding desk
   learns to ignore its own queue — so live and suspended sellers are reachable
   here (their journey is the record of how they came through) but they are not
   what the screen opens on. */
const IN_FLIGHT = ['onboarding', 'review', 'rejected']

export function OperatorOnboarding() {
  const [dir, setDir] = useState<PartnerDirectoryRow[]>([])
  const [dirError, setDirError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [showAll, setShowAll] = useState(false)
  const [queueSearch, setQueueSearch] = useState('')
  const [partnerId, setPartnerId] = useState<string | null>(null)
  const [snap, setSnap] = useState<OnboardingSnapshot | null>(null)
  const [selectedGate, setSelectedGate] = useState<string | null>(null)
  const [addPartnerModal, setAddPartnerModal] = useState(false)
  const [newPartner, setNewPartner] = useState({ name: '', type: '', contact: '', email: '', country: '' })

  const refreshDirectory = useCallback(async () => {
    const d = await loadPartnerDirectory()
    setDir(d.rows)
    setDirError(d.loadError ?? null)
    return d.rows
  }, [])

  useEffect(() => {
    refreshDirectory().then(rows => {
      const first = rows.find(r => IN_FLIGHT.includes(r.status)) ?? rows[0]
      if (first) setPartnerId(first.id)
      setLoading(false)
    })
  }, [refreshDirectory])

  const reloadJourney = useCallback(async (id: string) => {
    const s = await loadOnboarding(id)
    setSnap(s)
    /* Follow the seller: land on the gate somebody has to act on, not on
       whichever one happened to be open before. */
    const p = journeyProgress(s.journey)
    setSelectedGate((p.failed ?? p.current ?? s.journey[s.journey.length - 1])?.row.id ?? null)
  }, [])

  useEffect(() => { if (partnerId) void reloadJourney(partnerId) }, [partnerId, reloadJourney])

  if (loading) return <div style={{ textAlign: 'center', padding: '40px' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>

  const inFlight = dir.filter(r => IN_FLIGHT.includes(r.status))
  /* Searchable once the list is every seller rather than the three in flight —
     a scroll through a hundred names is not a queue. */
  const queue = (showAll ? dir : inFlight)
    .filter(r => matchesSearch(r, queueSearch))
  const active = dir.find(r => r.id === partnerId) ?? null
  const step = snap?.journey.find(s => s.row.id === selectedGate) ?? null
  const stepIndex = snap && step ? snap.journey.findIndex(s => s.row.id === step.row.id) : -1
  const previous = snap && stepIndex > 0 ? snap.journey[stepIndex - 1] : null

  const handleClear = async (gate: JourneyStep, evidence: string) => {
    const res = await clearGate({
      gateId: gate.row.id, partnerId: gate.row.partner_id, evidence,
      actor: 'Marketplace onboarding desk',
    })
    if (!res.ok) { toast(res.reason, 'error'); return }
    toast(`${gate.gate.name} cleared for ${active?.name ?? gate.row.partner_id}`)
    if (res.auditWarning) toast(res.auditWarning, 'error')
    await Promise.all([refreshDirectory(), reloadJourney(gate.row.partner_id)])
  }

  const handleNote = async (gate: JourneyStep, note: string) => {
    const { error } = await supabase.from('onboarding_gates').update({ notes: note }).eq('id', gate.row.id)
    if (error) { toast(`The note could not be saved: ${error.message}`, 'error'); return }
    toast('Note saved')
    await reloadJourney(gate.row.partner_id)
  }

  const handleAddPartner = async () => {
    if (!newPartner.name.trim()) { toast('Partner name is required', 'error'); return }
    if (!newPartner.type) { toast('Partner type is required', 'error'); return }
    const id = `PTR-${String(Date.now()).slice(-4)}`
    const { error: pErr } = await supabase.from('partners').insert({
      id, name: newPartner.name, type: newPartner.type, status: 'onboarding',
      country: newPartner.country || null, contact: newPartner.contact || null,
      /* Every seller starts at the entry tier and is promoted from there. The
         database defaults this too; naming it here keeps the insert readable
         rather than depending on a default to be correct. */
      email: newPartner.email || null, joined: '—', tier: 'Bronze', tier_id: 'bronze',
    })
    if (pErr) { toast(`Could not create the partner: ${pErr.message}`, 'error'); return }

    const base = dir.length * 10
    const { error: gErr } = await supabase.from('onboarding_gates').insert(GATES.map((g, i) => ({
      id: `og-${id}-${g.id}`, partner_id: id, gate_name: g.name, gate_order: g.order,
      status: g.order === 1 ? 'current' : 'pending',
      owner: g.owner, target_days: g.targetDays, dual_control: g.dualControl, waivable: g.waivable,
      submitted_by: null, submitted_at: null, reviewed_by: null, reviewed_at: null,
      evidence: [], notes: `Desk-created application for ${newPartner.name}`,
      sort_order: base + i + 1,
    })))
    if (gErr) { toast(`The partner was created but its gates were not: ${gErr.message}`, 'error'); return }

    /* The gate ladder is the same for everybody, so the task ladder is too.
       Creating one without the other leaves a seller with gates nobody can act
       on and a desk with nothing to chase. */
    const { error: tErr } = await supabase.from('onboarding_tasks').insert(
      TASK_LADDER.map(t => ({
        id: `OB-${id.slice(4)}-${t.gate}-${t.key}`, partner_id: id, gate_id: t.gate,
        title: t.title, detail: t.detail, owner: t.owner,
        due: t.gate === 'apply' ? (t.days <= 1 ? 'Today' : `In ${t.days} days`) : null,
        closed_by: null, closed_at: null,
      })),
    )
    if (tErr) toast(`The application opened, but its task list did not: ${tErr.message}`, 'error')

    toast(`${newPartner.name} opened at the application gate`)
    setNewPartner({ name: '', type: '', contact: '', email: '', country: '' })
    setAddPartnerModal(false)
    await refreshDirectory()
    setPartnerId(id)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '16px', flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 800, color: 'var(--text)' }}>Partner onboarding</h1>
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)', marginTop: '4px' }}>
            Seven gates, {SLA_DAYS} working days end to end · {inFlight.length} application{inFlight.length === 1 ? '' : 's'} in flight
          </p>
        </div>
        <Btn onClick={() => setAddPartnerModal(true)}>Onboard one yourself</Btn>
      </div>

      {dirError && <Callout tone="danger" title="Some of this screen did not load">{dirError}</Callout>}

      <Callout tone="info">
        Gates are sequential by design: no seller reaches the technical gate before KYC and agreements clear.
        The order is what keeps a rejected partner from ever touching production.
      </Callout>

      <FunnelSummary rows={dir} />

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(220px, 300px) 1fr', gap: '20px', alignItems: 'start' }}
           className="onb-split">
        {/* The queue. Applications in flight first, because that is the only
            list anybody owes anything on. */}
        <SectionCard
          title={showAll ? 'All sellers' : 'Applications in flight'}
          subtitle={showAll ? `${queue.length} of ${dir.length} sellers` : `${inFlight.length} of ${dir.length} sellers`}
          action={
            <button onClick={() => setShowAll(v => !v)} style={{
              fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--brand-navy)',
              background: 'none', border: 'none', cursor: 'pointer',
            }}>{showAll ? 'In flight only' : 'Show all'}</button>
          }
        >
          {showAll && (
            <div style={{ padding: '11px 16px', borderBottom: '1px solid var(--border-light)' }}>
              <input
                value={queueSearch}
                onChange={e => setQueueSearch(e.target.value)}
                placeholder="Search seller, id or country"
                style={{
                  width: '100%', padding: '6px 10px', borderRadius: 'var(--radius)',
                  border: '1px solid var(--border)', fontSize: 'var(--text-xs)', outline: 'none', color: 'var(--text)',
                }}
              />
            </div>
          )}
          {queue.length === 0 ? (
            <EmptyState message={queueSearch ? 'No seller matches that' : 'No applications in flight'} />
          ) : (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, maxHeight: '620px', overflowY: 'auto' }}>
              {queue.map(r => (
                <li key={r.id}>
                  <button
                    onClick={() => setPartnerId(r.id)}
                    style={{
                      width: '100%', textAlign: 'left', padding: '11px 16px', cursor: 'pointer',
                      background: r.id === partnerId ? 'var(--info-bg)' : 'white',
                      borderLeft: `3px solid ${r.id === partnerId ? 'var(--brand-navy)' : 'transparent'}`,
                      borderTop: 'none', borderRight: 'none', borderBottom: '1px solid var(--border-light)',
                    }}
                  >
                    <div style={{ fontSize: 'var(--text-sm)', fontWeight: 700, color: 'var(--text)' }}>{r.name}</div>
                    <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginTop: '1px' }}>
                      {r.id} · {r.country || '—'} · {r.type}
                    </div>
                    <div style={{ fontSize: '11px', marginTop: '3px', display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: 700, color: r.status === 'rejected' ? 'var(--danger)' : r.status === 'live' ? 'var(--success)' : 'var(--info)' }}>
                        {r.status}
                      </span>
                      <span style={{ color: 'var(--text-tertiary)' }}>
                        {r.clearedGates}/{r.totalGates} gates{r.currentGate ? ` · ${r.currentGate}` : ''}
                      </span>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', minWidth: 0 }}>
          {!snap || !active ? <SectionCard title="Journey"><EmptyState message="Choose a seller" /></SectionCard> : (
            <>
              <SectionCard
                title={active.name}
                subtitle={`${active.id} · contact ${active.contact || '—'}${active.email ? ` <${active.email}>` : ''}${active.categories.length ? ` · applied for ${active.categories.join(', ')}` : ''}`}
              >
                <div style={{ padding: '18px 20px' }}>
                  {snap.loadError
                    ? <Callout tone="danger" title="This journey did not load">{snap.loadError}</Callout>
                    : snap.journey.length === 0
                    ? <EmptyState message="This seller has no onboarding record" />
                    : <JourneyRail steps={snap.journey} selected={selectedGate} onSelect={s => setSelectedGate(s.row.id)} />}
                </div>
              </SectionCard>

              {step && (
                <SectionCard title={step.gate.name} subtitle="Everything this gate was decided on">
                  <div style={{ padding: '18px 20px' }}>
                    <GateDetail step={step} previous={previous} viewer={OPERATOR}>
                      <GateActions
                        step={step}
                        snap={snap}
                        onClear={ev => handleClear(step, ev)}
                        onNote={n => handleNote(step, n)}
                      />
                    </GateDetail>
                  </div>
                </SectionCard>
              )}

              <OpenTasks snap={snap} />
            </>
          )}
        </div>
      </div>

      <Modal open={addPartnerModal} onClose={() => setAddPartnerModal(false)} title="Open an application yourself"
        footer={<><Btn variant="secondary" size="sm" onClick={() => setAddPartnerModal(false)}>Cancel</Btn>
                  <Btn size="sm" disabled={!newPartner.name.trim() || !newPartner.type} onClick={handleAddPartner}>Open it</Btn></>}>
        <FormField label="Partner name" required>
          <TextInput value={newPartner.name} onChange={e => setNewPartner({ ...newPartner, name: e.target.value })} placeholder="e.g. Acme IoT Solutions" />
        </FormField>
        <FormField label="Partner type" required>
          <Select value={newPartner.type} onChange={e => setNewPartner({ ...newPartner, type: e.target.value })}>
            <option value="">Select a type…</option>
            {PARTNER_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </Select>
        </FormField>
        <FormField label="Contact person">
          <TextInput value={newPartner.contact} onChange={e => setNewPartner({ ...newPartner, contact: e.target.value })} placeholder="Full name" />
        </FormField>
        <FormField label="Email">
          <TextInput value={newPartner.email} onChange={e => setNewPartner({ ...newPartner, email: e.target.value })} placeholder="contact@partner.com" />
        </FormField>
        <FormField label="Country">
          <TextInput value={newPartner.country} onChange={e => setNewPartner({ ...newPartner, country: e.target.value })} placeholder="e.g. India" />
        </FormField>
        <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
          This records a desk-created application. It opens at the application gate with the full task ladder —
          every gate still has to clear, and the categories the seller may sell in are granted when it does.
        </p>
      </Modal>
    </div>
  )
}

/* ---------------------------------------------------------- gate actions -- */

function GateActions({ step, snap, onClear, onNote }: {
  step: JourneyStep
  snap: OnboardingSnapshot
  onClear: (evidence: string) => void
  onNote: (note: string) => void
}) {
  const [note, setNote] = useState(step.row.notes ?? '')
  const [evidence, setEvidence] = useState('')

  useEffect(() => { setNote(step.row.notes ?? ''); setEvidence('') }, [step.row.id, step.row.notes])

  const verdict = canClearGate(
    { ...step.row, status: step.row.status },
    snap.gates,
    snap.tech,
  )
  const isTech = gateIdFor(step.row) === 'tech'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', borderTop: '1px solid var(--border-light)', paddingTop: '16px' }}>
      {isTech && <TechChecklist tech={snap.tech} mode="operator" />}

      {!verdict.ok && <Callout tone="warning" title="This gate cannot be cleared from here">{verdict.reason}</Callout>}

      <FormField label="Note on this gate">
        <TextArea value={note} onChange={e => setNote(e.target.value)} placeholder="Anything the next reviewer needs to know" />
      </FormField>

      {verdict.ok && (
        <FormField label="Evidence you reviewed" required
          hint="Name what you checked and where it sits. This is written to the audit trail under your account.">
          <TextArea value={evidence} onChange={e => setEvidence(e.target.value)}
                    placeholder="e.g. Certificate of incorporation matched against the Germany register on 30 Jul" />
        </FormField>
      )}

      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        <Btn variant="secondary" size="sm" disabled={!note.trim() || note === (step.row.notes ?? '')}
             onClick={() => onNote(note)}>Save note</Btn>
        <Btn variant="success" size="sm" disabled={!verdict.ok || !evidence.trim()}
             onClick={() => onClear(evidence)}>Clear this gate</Btn>
      </div>

      <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', margin: 0 }}>
        Gates cannot be un-cleared. A seller that should not have progressed is suspended instead.
        {isTech && ' No override exists for the technical gate.'}
      </p>
    </div>
  )
}

/* ------------------------------------------------------------ the queue --- */

function FunnelSummary({ rows }: { rows: PartnerDirectoryRow[] }) {
  /* Counted from the records on screen rather than typed in, so the panel
     cannot claim a funnel the data does not have. */
  const byGate = GATES.map(g => ({
    gate: g,
    here: rows.filter(r => r.currentGate === g.name).length,
    cleared: rows.filter(r => r.clearedGates >= g.order).length,
  }))
  const live = rows.filter(r => r.status === 'live').length
  const rejected = rows.filter(r => r.status === 'rejected').length

  return (
    <SectionCard title="Where applications stand"
                 subtitle={`${rows.length} sellers on record · ${live} live · ${rejected} stopped`}>
      <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: '7px' }}>
        {byGate.map(({ gate, here, cleared }) => (
          <div key={gate.id} style={{ display: 'flex', alignItems: 'center', gap: '12px', fontSize: 'var(--text-xs)' }}>
            <span style={{ flex: '0 0 150px', color: 'var(--text)', fontWeight: 600 }}>{gate.name}</span>
            <div style={{ flex: 1, height: '8px', background: 'var(--bg-alt)', borderRadius: '4px', overflow: 'hidden', minWidth: '60px' }}>
              <div style={{
                width: `${rows.length ? (cleared / rows.length) * 100 : 0}%`, height: '100%',
                background: 'var(--brand-navy)', borderRadius: '4px',
              }} />
            </div>
            <span style={{ flex: '0 0 96px', textAlign: 'right', color: 'var(--text-tertiary)' }}>
              {cleared} cleared
            </span>
            <span style={{ flex: '0 0 86px', textAlign: 'right', color: here ? 'var(--info)' : 'var(--text-tertiary)', fontWeight: here ? 700 : 400 }}>
              {here ? `${here} here now` : '—'}
            </span>
          </div>
        ))}
      </div>
    </SectionCard>
  )
}

function OpenTasks({ snap }: { snap: OnboardingSnapshot }) {
  const rows = snap.tasks
    .map(t => ({ task: t, state: deriveTaskState(t, snap.gates) }))
    .filter(r => r.state === 'open' || r.state === 'blocked')

  return (
    <SectionCard title="What this gate is waiting for"
                 subtitle={rows.length ? `${rows.length} outstanding` : 'Nothing outstanding'}>
      {rows.length === 0 ? (
        <div style={{ padding: '16px 20px' }}>
          <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', margin: 0 }}>
            Nothing is owed on this seller. Their tasks closed when their gates did — a partner already
            live is never chased.
          </p>
        </div>
      ) : (
        <div style={{ padding: '14px 20px', display: 'flex', flexDirection: 'column', gap: '9px' }}>
          {rows.map(({ task, state }) => (
            <div key={task.id} style={{
              display: 'flex', gap: '10px', alignItems: 'flex-start', padding: '10px 11px',
              border: '1px solid var(--border)', borderRadius: 'var(--radius-md)',
              background: state === 'blocked' ? 'var(--danger-bg)' : 'white',
            }}>
              <span style={{ flexShrink: 0, marginTop: '1px', color: state === 'blocked' ? 'var(--danger)' : 'var(--info)' }}>
                {state === 'blocked' ? <AlertCircle size={15} /> : <Clock size={15} />}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 'var(--text-xs)', fontWeight: 700, color: 'var(--text)' }}>{task.title}</div>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginTop: '1px' }}>{task.detail}</div>
              </div>
              <div style={{ flexShrink: 0, textAlign: 'right' }}>
                <div style={{ fontSize: '11px', fontWeight: 700, color: task.owner === 'Marketplace' ? 'var(--brand-navy)' : 'var(--text-secondary)' }}>
                  {task.owner === 'Marketplace' ? 'Us' : 'The seller'}
                </div>
                {task.due && <div style={{ fontSize: '11px', color: state === 'blocked' ? 'var(--danger)' : 'var(--text-tertiary)' }}>{task.due}</div>}
              </div>
            </div>
          ))}
        </div>
      )}
    </SectionCard>
  )
}

/* The task ladder a desk-created application opens with. The same list the
   migration seeds every other seller from — one gate, one set of asks. */
const TASK_LADDER: { gate: string; key: string; title: string; detail: string; owner: string; days: number }[] = [
  { gate: 'apply', key: 'form', title: 'Application form submitted', detail: 'Company details, target marketplace categories and expected monthly volume.', owner: 'Partner', days: 14 },
  { gate: 'apply', key: 'contact', title: 'Primary contact confirmed', detail: 'A named person who can sign, with a working address on the company domain.', owner: 'Partner', days: 14 },
  { gate: 'kyc', key: 'inc', title: 'Certificate of incorporation', detail: 'Verified against the register in the country of registration.', owner: 'Partner', days: 5 },
  { gate: 'kyc', key: 'ubo', title: 'Beneficial ownership declaration', detail: 'Everyone holding over 25%, with identification for each.', owner: 'Partner', days: 5 },
  { gate: 'kyc', key: 'screen', title: 'Sanctions and PEP screening', detail: 'OFAC, EU, UN and HMT lists, plus adverse media.', owner: 'Marketplace', days: 2 },
  { gate: 'agree', key: 'terms', title: 'Marketplace terms e-signed', detail: 'Version 4.2, signed by someone with authority to bind the company.', owner: 'Partner', days: 5 },
  { gate: 'agree', key: 'dpa', title: 'Data processing agreement', detail: 'Standard contractual clauses, with sub-processors declared.', owner: 'Partner', days: 5 },
  { gate: 'agree', key: 'sched', title: 'Commission schedule counter-signed', detail: 'The plan the seller will actually settle on, signed by both sides.', owner: 'Marketplace', days: 3 },
  { gate: 'finance', key: 'bank', title: 'Settlement bank account verified', detail: 'Two micro-deposits are sent to the nominated account. The amounts have to be confirmed before any money moves in the other direction.', owner: 'Partner', days: 3 },
  { gate: 'finance', key: 'tax', title: 'Tax residency certificate', detail: 'A valid certificate applies the treaty withholding rate. Without one, the statutory rate is withheld at source.', owner: 'Partner', days: 3 },
  { gate: 'tech', key: 'feed', title: 'Catalogue method agreed', detail: 'API feed or portal upload, with the update frequency stated.', owner: 'Partner', days: 5 },
  { gate: 'tech', key: 'hook', title: 'Fulfilment webhook reachable', detail: 'Responds to a signed test call over TLS inside the timeout.', owner: 'Partner', days: 5 },
  { gate: 'tech', key: 'sbx', title: 'Sandbox order completed end to end', detail: 'One order placed, fulfilled and settled in sandbox before anything is sold for real.', owner: 'Partner', days: 5 },
  { gate: 'assure', key: 'sec', title: 'Security questionnaire', detail: '52-question baseline covering data handling, retention and sub-processors.', owner: 'Partner', days: 8 },
  { gate: 'assure', key: 'policy', title: 'Content and listing policy acknowledged', detail: 'Including the category rules that apply to what they intend to sell.', owner: 'Partner', days: 8 },
  { gate: 'assure', key: 'audit', title: 'Sample listing audit', detail: 'Three listings reviewed against the policy before the storefront opens.', owner: 'Marketplace', days: 4 },
  { gate: 'golive', key: 'store', title: 'Storefront enabled', detail: 'The seller becomes visible to buyers in the categories they were approved for.', owner: 'Marketplace', days: 1 },
  { gate: 'golive', key: 'first', title: 'First listings published', detail: 'At least one live listing, so the storefront is not an empty shop.', owner: 'Partner', days: 2 },
]
