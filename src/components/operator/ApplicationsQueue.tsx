/* What came in through the public forms, and what the desk does about it.
 *
 * Both forms. A seller applying through "Apply to sell" and a company asking
 * for an account through "Open a business account" arrive in the same queue and
 * are decided by the same person; accepting the first creates a partner with
 * seven gates, accepting the second creates an enterprise account with six, and
 * the code has branched on `kind_of` for both since the business form shipped.
 *
 * Every string on this screen said sellers, though — the card was subtitled
 * "What came in through Apply to sell" and the empty state sent you to the
 * partner page. An operator looking for a pending company would not have opened
 * it, and with the table empty would have concluded the feature did not exist.
 *
 * The screen this sits on already had a queue — of partners part-way through
 * their gates. That is the step *after* this one: those sellers exist, hold a
 * partner id, and have a journey to chase. An application has none of that. It
 * is somebody who filled in a form, and until a person accepts it there is no
 * partner record at all.
 *
 * The two are deliberately not merged into one list. A row you can chase and a
 * row you have to decide about are different work, and the decision is the one
 * with nobody else able to do it.
 *
 * Accepting is a single call. It creates the partner, seven gates with the
 * first open, the task ladder, the markets asked for, the contacts and a
 * lifecycle event — in one transaction, because the desk-created path beside it
 * does three of those from the browser and can leave a partner with no gates.
 */
import { useState, useEffect, useCallback } from 'react'
import { Check as CheckIcon, Clock, FileText, Inbox, X, CircleAlert as AlertIcon } from 'lucide-react'
import {
  SectionCard, EmptyState, Btn, Modal, FormField, TextArea, StatusPill, toast,
} from './shared'
import { Callout } from '../OnboardingJourney'
import { GATES } from '../../lib/onboarding'
import {
  loadDeskApplications, loadFields, loadDocumentKinds, acceptApplication, withdrawApplication,
} from '../../lib/partnerApplicationRepo'
import {
  deskQueue, waitingDays, canAccept, answerSheet, progress, sizeOf,
  applicationStages, stageSummary,
} from '../../lib/partnerApplication'
import type {
  Answers, DeskApplication, DocumentKind, FieldSpec, UploadedDocument,
} from '../../lib/partnerApplication'
import { openEvidence } from '../../lib/evidenceRepo'

export function ApplicationsQueue({ onAccepted }: {
  /* The parent owns the partner directory and the journey panel below, so an
     accept has to tell it rather than reload the world from in here. */
  onAccepted: (partnerId: string) => void | Promise<void>
}) {
  const [apps, setApps] = useState<DeskApplication[]>([])
  const [answers, setAnswers] = useState<Record<string, Answers>>({})
  const [documents, setDocuments] = useState<Record<string, UploadedDocument[]>>({})
  const [fields, setFields] = useState<FieldSpec[]>([])
  const [kinds, setKinds] = useState<DocumentKind[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [openId, setOpenId] = useState<string | null>(null)
  const [deciding, setDeciding] = useState<{ app: DeskApplication; accept: boolean } | null>(null)

  const reload = useCallback(async () => {
    /* Both kinds, because the queue holds both. Filtering per row rather than
       loading one set and rendering the other kind against it — a business
       application read through the seller form reports every question missing. */
    const [desk, sellerF, bizF, sellerK, bizK] = await Promise.all([
      loadDeskApplications(),
      loadFields('seller'), loadFields('business'),
      loadDocumentKinds('seller'), loadDocumentKinds('business'),
    ])
    const f = [...sellerF, ...bizF]
    const k = [...sellerK, ...bizK]
    setApps(desk.applications)
    setAnswers(desk.answers)
    setDocuments(desk.documents)
    setFields(f)
    setKinds(k)
    setLoadError(desk.loadError ?? null)
    setLoading(false)
  }, [])

  useEffect(() => { void reload() }, [reload])

  if (loading) {
    return (
      <SectionCard title="Applications" subtitle="Sellers and businesses, in the order they have been waiting">
        <div style={{ padding: '28px', textAlign: 'center' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>
      </SectionCard>
    )
  }

  const q = deskQueue(apps)
  const open = apps.find(a => a.id === openId) ?? null

  return (
    <>
      <SectionCard
        title="Applications"
        /* Counts all three groups. It used to read the first two only, so a
           queue holding five decided applications and nothing live announced
           "Nothing has come in through Apply to sell yet" directly above them. */
        subtitle={
          apps.length === 0
            ? 'Nothing has come in from either form yet'
            : [
                q.waiting.length ? `${q.waiting.length} waiting on the desk` : 'Nothing waiting on the desk',
                q.drafts.length ? `${q.drafts.length} still being filled in` : null,
                q.decided.length ? `${q.decided.length} decided` : null,
              ].filter(Boolean).join(' · ')
        }
      >
        {loadError && (
          <div style={{ padding: '14px 16px' }}>
            <Callout tone="danger" title="The queue did not load">{loadError}</Callout>
          </div>
        )}

        {apps.length === 0 ? (
          <EmptyState message="No applications. Sellers apply from the partner page under Apply to sell; companies from Open a business account." />
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(260px, 340px) 1fr', gap: '0', alignItems: 'stretch' }}
               className="onb-split">
            <div style={{ borderRight: '1px solid var(--border-light)', maxHeight: '520px', overflowY: 'auto' }}>
              <Group title="Waiting on the desk" icon={<Inbox size={13} />} rows={q.waiting}
                     openId={openId} onOpen={setOpenId} fields={fields} answers={answers}
                     kinds={kinds} documents={documents} empty="Nothing to decide" />
              <Group title="Still being filled in" icon={<Clock size={13} />} rows={q.drafts}
                     openId={openId} onOpen={setOpenId} fields={fields} answers={answers}
                     kinds={kinds} documents={documents} empty="Nobody part-way through" />
              <Group title="Decided" icon={<CheckIcon size={13} />} rows={q.decided}
                     openId={openId} onOpen={setOpenId} fields={fields} answers={answers}
                     kinds={kinds} documents={documents} empty="Nothing decided yet" />
            </div>

            <div style={{ padding: '16px', minWidth: 0 }}>
              {open
                ? <Detail app={open} fields={fields} answers={answers[open.id] ?? {}}
                          kinds={kinds} documents={documents[open.id] ?? []}
                          onDecide={accept => setDeciding({ app: open, accept })} />
                : <EmptyState message="Pick an application to read what they sent" />}
            </div>
          </div>
        )}
      </SectionCard>

      {deciding && (
        <DecideModal
          app={deciding.app} accept={deciding.accept}
          fields={fields} answers={answers[deciding.app.id] ?? {}}
          kinds={kinds} documents={documents[deciding.app.id] ?? []}
          onClose={() => setDeciding(null)}
          onDone={async (partnerId) => {
            setDeciding(null)
            await reload()
            if (partnerId) await onAccepted(partnerId)
          }}
        />
      )}
    </>
  )
}

/* ---------------------------------------------------------------- the list -- */

function Group({ title, icon, rows, openId, onOpen, fields, answers, kinds, documents, empty }: {
  title: string
  icon: React.ReactNode
  rows: DeskApplication[]
  openId: string | null
  onOpen: (id: string) => void
  fields: FieldSpec[]
  answers: Record<string, Answers>
  kinds: DocumentKind[]
  documents: Record<string, UploadedDocument[]>
  empty: string
}) {
  return (
    <div>
      <div style={{
        display: 'flex', alignItems: 'center', gap: '6px',
        padding: '9px 16px', background: 'var(--bg-alt)',
        borderBottom: '1px solid var(--border-light)',
        fontSize: '10px', fontWeight: 800, textTransform: 'uppercase',
        letterSpacing: '0.06em', color: 'var(--text-tertiary)',
      }}>
        {icon} {title} <span style={{ marginLeft: 'auto' }}>{rows.length}</span>
      </div>
      {rows.length === 0 ? (
        <div style={{ padding: '12px 16px', fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>{empty}</div>
      ) : rows.map(a => {
        const mine = fields.filter(f => f.kind_of === a.kind_of)
        const myKinds = kinds.filter(k => k.kind_of === a.kind_of)
        const p = progress(mine, answers[a.id] ?? {}, myKinds, documents[a.id] ?? [])
        const days = waitingDays(a)
        return (
          <button key={a.id} onClick={() => onOpen(a.id)}
            style={{
              width: '100%', textAlign: 'left', padding: '11px 16px', cursor: 'pointer',
              background: a.id === openId ? 'var(--info-bg)' : 'white',
              border: 'none', borderBottom: '1px solid var(--border-light)',
              borderLeft: `3px solid ${a.id === openId ? 'var(--brand-navy)' : 'transparent'}`,
            }}>
            <div style={{ fontWeight: 700, fontSize: 'var(--text-sm)', color: 'var(--text)' }}>{a.company}</div>
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginTop: '2px' }}>
              {a.id} · {a.kind_of === 'business' ? 'business' : 'seller'} · {a.kind} · {a.country}
            </div>
            <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginTop: '3px' }}>
              {a.state === 'accepted' ? `Now ${a.partner_id}`
                : a.state === 'withdrawn' ? 'Withdrawn'
                /* Days waiting is the number a desk is judged on, so it is the
                   one on the row. Completeness matters for a draft, where the
                   question is whether they are nearly there. */
                : a.state === 'submitted'
                  ? days === null ? 'Sent' : days === 0 ? 'Sent today' : `Waiting ${days}d`
                  : `${p.answered} of ${p.required} answered`}
            </div>
          </button>
        )
      })}
    </div>
  )
}

/* -------------------------------------------------------------- one of them -- */

function Detail({ app, fields, answers, kinds, documents, onDecide }: {
  app: DeskApplication
  fields: FieldSpec[]
  answers: Answers
  kinds: DocumentKind[]
  documents: UploadedDocument[]
  onDecide: (accept: boolean) => void
}) {
  /* This application's own questions and documents. The queue holds both kinds
     and reading one through the other's form reports everything missing. */
  const mine = fields.filter(f => f.kind_of === app.kind_of)
  const myKinds = kinds.filter(k => k.kind_of === app.kind_of)
  const sheet = answerSheet(mine, answers, myKinds, documents)
  const allowed = canAccept(app, mine, answers, myKinds, documents)
  const p = progress(mine, answers, myKinds, documents)

  /* Signed, short-lived and served by the same helper every other document on
     the marketplace goes through — the applicant's files land in the `evidence`
     bucket precisely so there is one way to open one. */
  const openDocument = async (file: UploadedDocument) => {
    const res = await openEvidence({ persona: 'operator' }, { path: file.path, name: file.name, id: file.id })
    if (!res.url) { toast(res.error ?? 'That file could not be opened.', 'error'); return }
    window.open(res.url, '_blank', 'noopener')
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div>
          <h3 style={{ fontSize: 'var(--text-lg)', fontWeight: 800, color: 'var(--text)' }}>{app.company}</h3>
          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginTop: '3px' }}>
            {app.id} · {app.contact_name} · {app.email} · {app.phone}
          </div>
        </div>
        <StatusPill status={
          app.state === 'accepted' ? 'approved'
            : app.state === 'withdrawn' ? 'rejected'
            : app.state === 'submitted' ? 'pending' : 'draft'} />
      </div>

      {/* The same rail the seller journeys use, so one reader holds one picture
          of the pipeline. Before this the desk had a gate rail after acceptance
          and a form dump before it, and had to translate between them. */}
      <ApplicationRail app={app} filled={p} />

      {app.state === 'accepted' && (
        <div style={{ marginTop: '12px' }}>
          <Callout tone="success" title={`Accepted — now ${app.partner_id ?? app.account_id}`}>
            {app.kind_of === 'business'
              ? 'The account exists with its six onboarding steps open at company verification, and no credit limit until the credit assessment clears.'
              : 'The partner exists with its seven gates open at the application gate. Its journey is in the panel below.'}
          </Callout>
        </div>
      )}
      {app.state === 'draft' && (
        <div style={{ marginTop: '12px' }}>
          <Callout tone="info" title={`${p.answered} of ${p.required} answered, and not sent yet`}>
            Nothing is owed on this one. It appears here so the desk can see who is part-way
            through, not so anybody chases it — the applicant comes back with their own reference.
          </Callout>
        </div>
      )}

      <div style={{ marginTop: '16px' }}>
        {sheet.map(g => {
          const gate = GATES.find(x => x.id === g.gate_id)
          return (
            <div key={g.gate_id} style={{ marginBottom: '18px' }}>
              <div style={{
                fontSize: '10px', fontWeight: 800, textTransform: 'uppercase',
                letterSpacing: '0.06em', color: 'var(--text-tertiary)',
                borderBottom: '1px solid var(--border-light)', paddingBottom: '5px', marginBottom: '8px',
              }}>
                {gate?.name ?? g.gate_id}
                {gate && <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>
                  {' · '}{gate.owner}
                </span>}
              </div>
              {g.rows.map(({ field, value }) => (
                <div key={field.id} style={{ display: 'flex', gap: '12px', padding: '4px 0', fontSize: 'var(--text-sm)' }}>
                  <div style={{ flex: '0 0 42%', color: 'var(--text-secondary)' }}>{field.label}</div>
                  <div style={{ flex: 1, minWidth: 0, color: value ? 'var(--text)' : 'var(--text-tertiary)', whiteSpace: 'pre-wrap' }}>
                    {/* A required blank is a problem and an optional one is not,
                        so they do not read the same. */}
                    {value ?? (field.required ? 'Not answered' : 'Left blank')}
                  </div>
                </div>
              ))}

              {/* The paperwork this gate is a decision on. Missing ones are
                  listed rather than omitted — a document that is not there is
                  the reason to send an application back, and a reviewer cannot
                  ask for what the screen never mentions. */}
              {g.documents.map(({ kind, file }) => (
                <div key={kind.id} style={{ display: 'flex', gap: '12px', padding: '4px 0', fontSize: 'var(--text-sm)', alignItems: 'baseline' }}>
                  <div style={{ flex: '0 0 42%', color: 'var(--text-secondary)', display: 'flex', gap: '6px', alignItems: 'baseline' }}>
                    <FileText size={12} style={{ flexShrink: 0, opacity: 0.6 }} />
                    <span>{kind.label}</span>
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    {file ? (
                      <button
                        onClick={() => void openDocument(file)}
                        style={{
                          background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                          color: 'var(--brand-accent-dark)', fontWeight: 700,
                          fontSize: 'var(--text-sm)', textAlign: 'left',
                        }}>
                        {file.name} <span style={{ fontWeight: 400, color: 'var(--text-tertiary)' }}>· {sizeOf(file.bytes)}</span>
                      </button>
                    ) : (
                      <span style={{ color: kind.required ? 'var(--danger)' : 'var(--text-tertiary)' }}>
                        {kind.required ? 'Not supplied' : 'Not applicable'}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )
        })}
      </div>

      {(app.state === 'submitted' || app.state === 'draft') && (
        <div style={{
          display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap',
          paddingTop: '14px', borderTop: '1px solid var(--border-light)',
        }}>
          <Btn variant="success" size="sm" disabled={!allowed.ok} onClick={() => onDecide(true)}>
            <CheckIcon size={13} /> Accept and open the gates
          </Btn>
          <Btn variant="danger" size="sm" onClick={() => onDecide(false)}>
            <X size={13} /> Withdraw
          </Btn>
          {!allowed.ok && (
            <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', flex: 1, minWidth: '200px' }}>
              {allowed.reason}
            </span>
          )}
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------- the decision -- */

function DecideModal({ app, accept, fields, answers, kinds, documents, onClose, onDone }: {
  app: DeskApplication
  accept: boolean
  fields: FieldSpec[]
  answers: Answers
  kinds: DocumentKind[]
  documents: UploadedDocument[]
  onClose: () => void
  onDone: (partnerId: string | null) => Promise<void>
}) {
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const markets = (answers['apply-markets'] ?? '').split(',').map(s => s.trim()).filter(Boolean)
  const mine = fields.filter(f => f.kind_of === app.kind_of)
  const myKinds = kinds.filter(k => k.kind_of === app.kind_of)
  const allowed = canAccept(app, mine, answers, myKinds, documents)

  const go = async () => {
    setBusy(true)
    if (accept) {
      const res = await acceptApplication(app.id, note)
      setBusy(false)
      if (!res.ok) { toast(res.reason, 'error'); return }
      toast(`${app.company} accepted as ${res.value.partner_id}`)
      /* Only a seller has a journey in the panel below. Handing an account id
         to the partner directory would select a row that is not in it. */
      await onDone(app.kind_of === 'business' ? null : res.value.partner_id)
    } else {
      const res = await withdrawApplication(app.id, note)
      setBusy(false)
      if (!res.ok) { toast(res.reason, 'error'); return }
      toast(`${app.id} withdrawn`)
      await onDone(null)
    }
  }

  return (
    <Modal open onClose={onClose}
      title={accept ? `Accept ${app.company}` : `Withdraw ${app.id}`}
      footer={<>
        <Btn variant="secondary" size="sm" onClick={onClose}>Cancel</Btn>
        <Btn variant={accept ? 'success' : 'danger'} size="sm" onClick={go}
             disabled={busy || (accept && !allowed.ok) || (!accept && !note.trim())}>
          {busy ? 'Saving…' : accept ? 'Accept and open the gates' : 'Withdraw it'}
        </Btn>
      </>}>
      {accept ? (
        <Callout tone="warning" title={app.kind_of === 'business'
          ? 'This creates the account — there is no separate step'
          : 'This creates the partner — there is no separate step'}>
          <ul style={{ margin: '4px 0 0 16px' }}>
            {app.kind_of === 'business' ? (<>
              <li>{app.company} becomes an account with status <strong>onboarding</strong>, so it cannot buy yet.</li>
              <li>All six onboarding steps open, with company verification current.</li>
              <li>
                No credit limit and no budget. Both are set at the credit assessment — accepting
                is not agreeing what they asked for.
              </li>
              <li>Terms open at Net 30 whatever they asked for, and move after the assessment.</li>
              <li>An approval policy opens on the threshold they asked for, unreviewed.</li>
            </>) : (<>
              <li>{app.company} becomes a seller with status <strong>onboarding</strong>.</li>
              <li>All seven gates open, with the application gate current and already submitted.</li>
              <li>The task ladder opens behind them, dated only on the gate that is open.</li>
              <li>
                {markets.length
                  ? `${markets.join(', ')} recorded as requested — not approved. That happens at the compliance gate.`
                  : 'No markets were asked for, so none are recorded.'}
              </li>
              <li>Their email and number go on the partner record as contacts, unverified.</li>
            </>)}
            <li>
              {documents.length
                ? `${documents.length} uploaded document${documents.length === 1 ? '' : 's'} move onto the partner, filed under the gate that reads each one.`
                : 'No documents were uploaded, so the gates open with nothing attached.'}
            </li>
          </ul>
        </Callout>
      ) : (
        <Callout tone="info" title="Nothing is created, and the applicant starts again">
          Withdrawing closes {app.id}. The reference and access code stop working, and the address
          on it becomes free to apply with again — which is the only route back, because there is
          no way to reset an access code.
        </Callout>
      )}

      <FormField
        label={accept ? 'Note for the record' : 'Why it is being withdrawn'}
        required={!accept}
        hint={accept
          ? 'Optional. Goes on the application gate and on the partner’s lifecycle history.'
          : 'Required — an application closed with no reason cannot be explained to the person who filled it in.'}>
        <TextArea rows={3} value={note} onChange={e => setNote(e.target.value)}
                  placeholder={accept
                    ? 'Anything worth recording about why this one was let through'
                    : 'What was wrong with it'} />
      </FormField>

      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', display: 'flex', gap: '6px', alignItems: 'flex-start' }}>
        <FileText size={13} style={{ flexShrink: 0, marginTop: '1px' }} />
        <span>
          {app.contact_name} · {app.email} · {app.phone}
          {app.submitted_on ? ` · sent ${new Date(app.submitted_on).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}` : ''}
        </span>
      </div>
    </Modal>
  )
}

/* ------------------------------------------------------------ the rail -- */

const RAIL_TONE: Record<string, { ring: string; fill: string; ink: string; label: string }> = {
  cleared: { ring: 'var(--success)', fill: 'var(--success-bg)', ink: 'var(--success)', label: 'Cleared' },
  current: { ring: 'var(--info)', fill: 'var(--info-bg)', ink: 'var(--info)', label: 'Waiting' },
  failed: { ring: 'var(--danger)', fill: 'var(--danger-bg)', ink: 'var(--danger)', label: 'Stopped' },
  pending: { ring: 'var(--border)', fill: 'var(--bg-alt)', ink: 'var(--text-tertiary)', label: 'Not reached' },
}

function ApplicationRail({ app, filled }: {
  app: DeskApplication
  filled: { answered: number; required: number }
}) {
  const stages = applicationStages(app, filled, waitingDays(app))
  const summary = stageSummary(stages)

  return (
    <div style={{ margin: '16px 0 4px' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'baseline', marginBottom: '10px' }}>
        <strong style={{ fontSize: 'var(--text-sm)', color: 'var(--text)' }}>
          {summary.cleared} of {summary.total} stages cleared
        </strong>
        <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>{summary.says}</span>
      </div>

      <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexWrap: 'wrap', gap: '2px' }}>
        {stages.map((st, i) => {
          const t = RAIL_TONE[st.tone]
          return (
            <li key={st.id} style={{ flex: '1 1 130px', minWidth: '130px' }}>
              <div style={{
                height: '100%', padding: '11px 12px', borderRadius: 'var(--radius-md)',
                border: `1px solid ${t.ring}`, background: t.fill,
              }}>
                <div style={{
                  display: 'flex', alignItems: 'center', gap: '6px', color: t.ink,
                  fontSize: '10px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.06em',
                }}>
                  {st.tone === 'cleared' ? <CheckIcon size={14} />
                    : st.tone === 'current' ? <Clock size={14} />
                    : st.tone === 'failed' ? <AlertIcon size={14} />
                    : <span style={{ fontSize: '11px', fontWeight: 800 }}>{i + 1}</span>}
                  {t.label}
                </div>
                <div style={{ fontSize: 'var(--text-sm)', fontWeight: 700, color: 'var(--text)', marginTop: '4px' }}>
                  {st.name}
                </div>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginTop: '2px' }}>
                  {st.note}
                </div>
              </div>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
