/* Applying to sell, from the outside.
 *
 * The seven gates were already here and already worked — and every one of them
 * was scoped to a partner that exists. "Apply to sell" opened the sign-in
 * screen, which a stranger has no credentials for, so the journey started one
 * step after the point people actually arrive.
 *
 * This is that step. A visitor gives an email address and a contact number, is
 * issued a reference and an access code, and answers what each of the seven
 * gates will be assessed on. Nothing is a login: there is no account until the
 * onboarding desk accepts the application and makes a partner from it.
 *
 * Two things the shape of this screen is deciding.
 *
 * Answers are saved when a field is left, not when the step is finished. The
 * entire reason this exists is that somebody can close the tab — and the gate
 * they were part-way through is the gate they will be part-way through when the
 * phone rings.
 *
 * The questions come from `partner_application_fields`. There is no list of
 * questions in this file. A question the desk adds appears here, counts towards
 * the progress and blocks submission, and cannot end up in one of those and not
 * the others.
 */
import { useState, useEffect, useCallback } from 'react'
import {
  Check, ChevronLeft, ChevronRight, Copy, KeyRound, Loader, Send, ArrowLeft,
} from 'lucide-react'
import { Btn, FormField, TextInput, TextArea, Select, toast } from '../operator/shared'
import { Callout } from '../OnboardingJourney'
import { GATES, SLA_DAYS } from '../../lib/onboarding'
import {
  stepsOf, outstanding, canSubmit, progress, resumeAt, validateStart,
  optionsOf, splitMulti, toggleMulti, looksLikeReference,
} from '../../lib/partnerApplication'
import type {
  Answers, Application, Credentials, FieldSpec, StartDraft,
} from '../../lib/partnerApplication'
import {
  loadFields, loadMarkets, startApplication, resumeApplication, saveAnswer, submitApplication,
} from '../../lib/partnerApplicationRepo'

const SELLER_KINDS = [
  'Reseller', 'IoT hardware', 'Device OEM', 'Security ISV', 'Content provider', 'Insurance',
]

const BLANK: StartDraft = {
  email: '', phone: '', company: '', contact_name: '', country: '', kind: '',
}

type Stage = 'start' | 'resume' | 'issued' | 'form' | 'done'

export function ApplyToSell({ onLeave, onSignIn }: {
  onLeave: () => void
  onSignIn: () => void
}) {
  const [stage, setStage] = useState<Stage>('start')
  const [fields, setFields] = useState<FieldSpec[]>([])
  const [markets, setMarkets] = useState<{ code: string; name: string }[]>([])
  const [draft, setDraft] = useState<StartDraft>(BLANK)
  const [creds, setCreds] = useState<Credentials | null>(null)
  const [app, setApp] = useState<Application | null>(null)
  const [answers, setAnswers] = useState<Answers>({})
  const [step, setStep] = useState(0)
  const [busy, setBusy] = useState(false)
  /* Which fields are in flight, so a slow save shows on the field it belongs to
     rather than as one spinner for the whole page. */
  const [saving, setSaving] = useState<Set<string>>(new Set())
  const [resumeForm, setResumeForm] = useState({ reference: '', code: '' })

  useEffect(() => {
    void loadFields().then(setFields)
    void loadMarkets().then(setMarkets)
  }, [])

  const steps = stepsOf(fields, answers)
  const done = progress(fields, answers)

  const save = useCallback(async (field: string, value: string, reached?: number) => {
    if (!creds) return
    setSaving(s => new Set(s).add(field))
    const res = await saveAnswer({
      reference: creds.reference, code: creds.access_code, field, value, reached,
    })
    setSaving(s => { const n = new Set(s); n.delete(field); return n })
    /* A failed save is the one thing an applicant must not miss — they will
       carry on typing into a form that is no longer recording anything. */
    if (!res.ok) toast(res.reason, 'error')
  }, [creds])

  const begin = async () => {
    const check = validateStart(draft, markets)
    if (!check.ok) { toast(check.reason, 'error'); return }
    setBusy(true)
    const res = await startApplication(draft)
    setBusy(false)
    if (!res.ok) { toast(res.reason, 'error'); return }
    setCreds(res.value)
    setApp(null)
    setAnswers({})
    setStep(0)
    setStage('issued')
  }

  const resume = async () => {
    if (!looksLikeReference(resumeForm.reference)) {
      toast('A reference looks like APP-2026-0007. Check the one you were given.', 'error')
      return
    }
    setBusy(true)
    const res = await resumeApplication(resumeForm.reference, resumeForm.code)
    setBusy(false)
    if (!res.ok) { toast(res.reason, 'error'); return }
    setCreds({ reference: res.value.application.reference, access_code: resumeForm.code })
    setApp(res.value.application)
    setAnswers(res.value.answers)
    setStep(resumeAt(stepsOf(fields, res.value.answers)))
    setStage(res.value.application.state === 'draft' ? 'form' : 'done')
  }

  const submit = async () => {
    if (!creds) return
    const check = canSubmit(fields, answers)
    if (!check.ok) { toast(check.reason, 'error'); return }
    setBusy(true)
    const res = await submitApplication(creds.reference, creds.access_code)
    setBusy(false)
    if (!res.ok) { toast(res.reason, 'error'); return }
    setStage('done')
  }

  const set = (field: FieldSpec, value: string) =>
    setAnswers(a => ({ ...a, [field.id]: value }))

  return (
    <div style={{ background: 'var(--bg-alt)', minHeight: '70vh' }}>
      <div className="container" style={{ paddingTop: '32px', paddingBottom: '56px', maxWidth: '900px' }}>
        <button onClick={onLeave} style={{
          background: 'none', border: 'none', padding: 0, cursor: 'pointer', marginBottom: '18px',
          display: 'inline-flex', alignItems: 'center', gap: '6px',
          fontSize: 'var(--text-sm)', color: 'var(--text-secondary)',
        }}>
          <ArrowLeft size={15} /> Back to the partner page
        </button>

        {stage === 'start' && (
          <StartForm
            draft={draft} markets={markets} busy={busy}
            onChange={setDraft} onBegin={begin}
            onResume={() => setStage('resume')} onSignIn={onSignIn}
          />
        )}

        {stage === 'resume' && (
          <ResumeForm
            form={resumeForm} busy={busy}
            onChange={setResumeForm} onResume={resume} onBack={() => setStage('start')}
          />
        )}

        {stage === 'issued' && creds && (
          <Issued creds={creds} email={draft.email} onContinue={() => setStage('form')} />
        )}

        {stage === 'form' && creds && (
          <>
            <header style={{ marginBottom: '20px' }}>
              <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 800, color: 'var(--text)' }}>
                {app?.company ?? draft.company}
              </h1>
              <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)', marginTop: '4px' }}>
                {creds.reference} · {done.answered} of {done.required} answered · saved as you go
              </p>
            </header>

            <GateRail steps={steps} at={step} onGo={setStep} />

            <StepCard
              step={steps[step]} index={step} total={steps.length}
              answers={answers} saving={saving}
              onSet={set}
              onSave={(f, v) => void save(f.id, v, step + 1)}
              onBack={() => setStep(n => Math.max(0, n - 1))}
              onNext={() => setStep(n => Math.min(steps.length - 1, n + 1))}
              onSubmit={submit}
              onLeaveForNow={() => setStage('done')}
              busy={busy}
              missing={outstanding(fields, answers)}
              creds={creds}
            />
          </>
        )}

        {stage === 'done' && creds && (
          <Finished creds={creds} submitted={app?.state !== 'draft' || done.answered === done.required} />
        )}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------- starting -- */

function StartForm({ draft, markets, busy, onChange, onBegin, onResume, onSignIn }: {
  draft: StartDraft
  markets: { code: string; name: string }[]
  busy: boolean
  onChange: (d: StartDraft) => void
  onBegin: () => void
  onResume: () => void
  onSignIn: () => void
}) {
  const set = (over: Partial<StartDraft>) => onChange({ ...draft, ...over })
  return (
    <>
      <h1 style={{ fontSize: 'var(--text-3xl)', fontWeight: 800, color: 'var(--text)' }}>
        Apply to sell on the marketplace
      </h1>
      <p style={{ fontSize: 'var(--text-md)', color: 'var(--text-secondary)', marginTop: '10px', lineHeight: 1.6 }}>
        Seven gates, {SLA_DAYS} working days end to end. You need an email address and a
        contact number to begin — everything else can be filled in over as many sittings as
        you like.
      </p>

      <div style={{
        background: 'white', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)',
        padding: '22px', marginTop: '22px',
      }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '4px 18px' }}>
          <FormField label="Registered company name" required>
            <TextInput value={draft.company} onChange={e => set({ company: e.target.value })}
                       placeholder="As it appears on the certificate of incorporation" />
          </FormField>
          <FormField label="What you sell" required hint="Decides which evidence the KYC gate asks for">
            <Select value={draft.kind} onChange={e => set({ kind: e.target.value })}>
              <option value="">Choose one</option>
              {SELLER_KINDS.map(k => <option key={k} value={k}>{k}</option>)}
            </Select>
          </FormField>
          <FormField label="Your name" required>
            <TextInput value={draft.contact_name} onChange={e => set({ contact_name: e.target.value })} />
          </FormField>
          <FormField label="Where the company is registered" required>
            <Select value={draft.country} onChange={e => set({ country: e.target.value })}>
              <option value="">Choose one</option>
              {markets.map(m => <option key={m.code} value={m.code}>{m.name}</option>)}
            </Select>
          </FormField>
          <FormField label="Email" required hint="Where the desk comes back to you, and half of how you get back in">
            <TextInput type="email" value={draft.email} onChange={e => set({ email: e.target.value })} />
          </FormField>
          <FormField label="Contact number" required hint="KYC is a phone call, not an email thread">
            <TextInput value={draft.phone} onChange={e => set({ phone: e.target.value })}
                       placeholder="+91 80 4000 0000" />
          </FormField>
        </div>

        <div style={{ marginTop: '14px' }}>
          <Callout tone="info" title="You are not creating an account">
            There is no password. You will be given a reference and an access code, and those
            two things plus your email are what bring you back to a half-finished application.
            An account is issued once the onboarding desk accepts you — not before.
          </Callout>
        </div>

        <div style={{ display: 'flex', gap: '10px', marginTop: '18px', flexWrap: 'wrap' }}>
          <Btn variant="primary" onClick={onBegin} disabled={busy}>
            {busy ? 'Starting…' : 'Start the application'}
          </Btn>
          <Btn variant="secondary" onClick={onResume}><KeyRound size={14} /> Resume one</Btn>
        </div>
      </div>

      <GateExplainer />

      <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)', marginTop: '20px' }}>
        Already selling here?{' '}
        <button onClick={onSignIn} style={{
          background: 'none', border: 'none', padding: 0, cursor: 'pointer',
          color: 'var(--brand-accent-dark)', fontWeight: 700, fontSize: 'var(--text-sm)',
        }}>Sign in to your seller console</button>.
      </p>
    </>
  )
}

/* What the seven gates are, before somebody commits to filling anything in.
   Read straight off `GATES` — the same constant the operator's rail, the SLA
   and the onboarding screens are built on, so this cannot describe a process
   the marketplace does not run. */
function GateExplainer() {
  return (
    <div style={{ marginTop: '28px' }}>
      <h2 style={{ fontSize: 'var(--text-lg)', fontWeight: 800, color: 'var(--text)' }}>
        What you will be asked for
      </h2>
      <ol style={{ listStyle: 'none', margin: '14px 0 0', padding: 0, display: 'grid', gap: '8px' }}>
        {GATES.map((g, i) => (
          <li key={g.id} style={{
            background: 'white', border: '1px solid var(--border)',
            borderRadius: 'var(--radius-md)', padding: '12px 14px',
            display: 'flex', gap: '12px', alignItems: 'flex-start',
          }}>
            <span style={{
              width: '24px', height: '24px', borderRadius: '50%', flexShrink: 0,
              background: 'var(--bg-alt)', color: 'var(--text-secondary)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '11px', fontWeight: 800,
            }}>{i + 1}</span>
            <span>
              <span style={{ display: 'block', fontSize: 'var(--text-sm)', fontWeight: 700, color: 'var(--text)' }}>
                {g.name}
                <span style={{ fontWeight: 400, color: 'var(--text-tertiary)' }}>
                  {' · '}{g.owner}{g.targetDays === 0 ? ' · same day' : ` · ${g.targetDays}d`}
                </span>
              </span>
              <span style={{ display: 'block', fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', marginTop: '2px', lineHeight: 1.5 }}>
                {g.what}
              </span>
            </span>
          </li>
        ))}
      </ol>
    </div>
  )
}

/* --------------------------------------------------------------- resume -- */

function ResumeForm({ form, busy, onChange, onResume, onBack }: {
  form: { reference: string; code: string }
  busy: boolean
  onChange: (f: { reference: string; code: string }) => void
  onResume: () => void
  onBack: () => void
}) {
  return (
    <>
      <h1 style={{ fontSize: 'var(--text-3xl)', fontWeight: 800, color: 'var(--text)' }}>
        Pick up where you left off
      </h1>
      <p style={{ fontSize: 'var(--text-md)', color: 'var(--text-secondary)', marginTop: '10px' }}>
        The reference and access code you were given when you started.
      </p>
      <div style={{
        background: 'white', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)',
        padding: '22px', marginTop: '20px', maxWidth: '520px',
      }}>
        <FormField label="Reference" required hint="Looks like APP-2026-0007">
          <TextInput value={form.reference} autoCapitalize="characters"
                     onChange={e => onChange({ ...form, reference: e.target.value })} />
        </FormField>
        <FormField label="Access code" required hint="Twelve characters, no zeros and no letter O">
          <TextInput value={form.code} autoCapitalize="characters"
                     onChange={e => onChange({ ...form, code: e.target.value })} />
        </FormField>
        <div style={{ display: 'flex', gap: '10px', marginTop: '12px' }}>
          <Btn variant="primary" onClick={onResume} disabled={busy}>
            {busy ? 'Looking…' : 'Continue'}
          </Btn>
          <Btn variant="secondary" onClick={onBack}>Start a new one instead</Btn>
        </div>
        <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginTop: '14px', lineHeight: 1.5 }}>
          Lost the code? There is no self-service reset — the onboarding desk withdraws the
          application and you start again, which is deliberate: an access code that could be
          reset from an email address alone would be no protection at all.
        </p>
      </div>
    </>
  )
}

/* ------------------------------------------------------- the credentials -- */

function Issued({ creds, email, onContinue }: {
  creds: Credentials; email: string; onContinue: () => void
}) {
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`${creds.reference} / ${creds.access_code}`)
      toast('Reference and code copied')
    } catch {
      /* Clipboard access is refused in plenty of ordinary situations — an
         insecure origin, a locked-down browser. The code is on the screen
         either way, so this says so rather than failing silently. */
      toast('Your browser would not let the page copy. They are on screen — write them down.', 'info')
    }
  }
  return (
    <>
      <h1 style={{ fontSize: 'var(--text-3xl)', fontWeight: 800, color: 'var(--text)' }}>
        Write these down
      </h1>
      <p style={{ fontSize: 'var(--text-md)', color: 'var(--text-secondary)', marginTop: '10px', lineHeight: 1.6 }}>
        These two things and the email address you gave are how you get back into this
        application. They are shown once.
      </p>

      <div style={{
        background: 'white', border: '2px solid var(--brand-navy)', borderRadius: 'var(--radius-md)',
        padding: '22px', marginTop: '20px',
      }}>
        <Field label="Reference" value={creds.reference} />
        <Field label="Access code" value={creds.access_code} />
        <Field label="Email" value={email} />
        <div style={{ display: 'flex', gap: '10px', marginTop: '18px', flexWrap: 'wrap' }}>
          <Btn variant="secondary" onClick={copy}><Copy size={14} /> Copy</Btn>
          <Btn variant="primary" onClick={onContinue}>
            Start answering <ChevronRight size={14} />
          </Btn>
        </div>
      </div>

      <div style={{ marginTop: '16px' }}>
        <Callout tone="warning" title="In a live marketplace these would be emailed and texted to you">
          This prototype has no mail sender, so they are on screen instead. The code is stored
          in the clear and never expires, which is fine for a demonstration and is not what you
          would ship — it wants hashing, an expiry and an attempt counter first.
        </Callout>
      </div>
    </>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ marginBottom: '12px' }}>
      <div style={{ fontSize: 'var(--text-xs)', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-tertiary)', fontWeight: 700 }}>
        {label}
      </div>
      <div style={{ fontSize: 'var(--text-xl)', fontWeight: 800, color: 'var(--text)', fontFamily: 'ui-monospace, monospace', letterSpacing: '0.04em', wordBreak: 'break-all' }}>
        {value}
      </div>
    </div>
  )
}

/* ----------------------------------------------------------------- rail -- */

function GateRail({ steps, at, onGo }: {
  steps: ReturnType<typeof stepsOf>
  at: number
  onGo: (i: number) => void
}) {
  return (
    <ol style={{ listStyle: 'none', margin: '0 0 18px', padding: 0, display: 'flex', flexWrap: 'wrap', gap: '2px' }}>
      {steps.map((s, i) => {
        const gate = GATES.find(g => g.id === s.gate_id)
        const active = i === at
        return (
          <li key={s.gate_id} style={{ flex: '1 1 118px', minWidth: '118px' }}>
            {/* Every gate is reachable, not just the next one. An applicant who
                needs a number from finance can jump there and come back —
                locking the steps would make them abandon instead. */}
            <button
              onClick={() => onGo(i)}
              aria-current={active ? 'step' : undefined}
              style={{
                width: '100%', height: '100%', textAlign: 'left', cursor: 'pointer',
                padding: '10px 11px', borderRadius: 'var(--radius-md)',
                background: active ? 'white' : s.done ? 'var(--success-bg)' : 'var(--bg-alt)',
                border: `1px solid ${active ? 'var(--brand-navy)' : s.done ? 'var(--success)' : 'var(--border)'}`,
                boxShadow: active ? 'var(--shadow-md)' : 'none',
                display: 'flex', flexDirection: 'column', gap: '4px',
              }}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: '5px', color: s.done ? 'var(--success)' : 'var(--text-tertiary)' }}>
                {s.done ? <Check size={13} /> : <span style={{ fontSize: '11px', fontWeight: 800 }}>{i + 1}</span>}
                <span style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  {s.done ? 'Done' : `${s.answered}/${s.required}`}
                </span>
              </span>
              <span style={{ fontSize: 'var(--text-xs)', fontWeight: 700, color: 'var(--text)', lineHeight: 1.3 }}>
                {gate?.name ?? s.gate_id}
              </span>
            </button>
          </li>
        )
      })}
    </ol>
  )
}

/* ------------------------------------------------------------- one step -- */

function StepCard({
  step, index, total, answers, saving, onSet, onSave,
  onBack, onNext, onSubmit, onLeaveForNow, busy, missing, creds,
}: {
  step: ReturnType<typeof stepsOf>[number] | undefined
  index: number
  total: number
  answers: Answers
  saving: Set<string>
  onSet: (f: FieldSpec, v: string) => void
  onSave: (f: FieldSpec, v: string) => void
  onBack: () => void
  onNext: () => void
  onSubmit: () => void
  onLeaveForNow: () => void
  busy: boolean
  missing: FieldSpec[]
  creds: Credentials
}) {
  if (!step) {
    return <Callout tone="info" title="Loading the form">The questions are on their way.</Callout>
  }
  const gate = GATES.find(g => g.id === step.gate_id)
  const last = index === total - 1

  return (
    <div style={{
      background: 'white', border: '1px solid var(--border)',
      borderRadius: 'var(--radius-md)', padding: '22px',
    }}>
      <h2 style={{ fontSize: 'var(--text-xl)', fontWeight: 800, color: 'var(--text)' }}>
        {index + 1}. {gate?.name ?? step.gate_id}
      </h2>
      {gate && (
        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', marginTop: '4px', lineHeight: 1.5 }}>
          {gate.what} <span style={{ color: 'var(--text-tertiary)' }}>Assessed by {gate.owner}.</span>
        </p>
      )}

      <div style={{ marginTop: '16px' }}>
        {step.fields.map(f => (
          <Question key={f.id} field={f} value={answers[f.id] ?? ''}
                    saving={saving.has(f.id)}
                    onSet={v => onSet(f, v)} onSave={v => onSave(f, v)} />
        ))}
      </div>

      {last && missing.length > 0 && (
        <div style={{ marginTop: '8px' }}>
          <Callout tone="warning" title={`${missing.length} still outstanding before this can go to the desk`}>
            {missing.slice(0, 6).map(f => f.label).join('; ')}
            {missing.length > 6 ? `; and ${missing.length - 6} more.` : '.'}
          </Callout>
        </div>
      )}

      <div style={{
        display: 'flex', gap: '10px', marginTop: '20px', paddingTop: '16px',
        borderTop: '1px solid var(--border-light)', flexWrap: 'wrap', alignItems: 'center',
      }}>
        <Btn variant="secondary" onClick={onBack} disabled={index === 0}>
          <ChevronLeft size={14} /> Back
        </Btn>
        {last ? (
          <Btn variant="primary" onClick={onSubmit} disabled={busy || missing.length > 0}>
            <Send size={14} /> {busy ? 'Sending…' : 'Send to the onboarding desk'}
          </Btn>
        ) : (
          <Btn variant="primary" onClick={onNext}>Next <ChevronRight size={14} /></Btn>
        )}
        <span style={{ flex: 1 }} />
        {/* Not a save button — everything is already saved. It is a way out
            that tells them what they need to come back with, which is the
            question somebody leaving actually has. */}
        <button onClick={onLeaveForNow} style={{
          background: 'none', border: 'none', padding: 0, cursor: 'pointer',
          fontSize: 'var(--text-sm)', color: 'var(--text-secondary)',
        }}>
          Finish later — {creds.reference}
        </button>
      </div>
    </div>
  )
}

function Question({ field, value, saving, onSet, onSave }: {
  field: FieldSpec
  value: string
  saving: boolean
  onSet: (v: string) => void
  onSave: (v: string) => void
}) {
  /* `FormField` takes a string label, so the in-flight mark sits in the corner
     of the field rather than inside the label. Per field and not per page: a
     single spinner somewhere else does not tell you which answer is still in
     the air. */
  return (
    <div style={{ position: 'relative' }}>
      {saving && (
        <span style={{
          position: 'absolute', right: 0, top: '2px', display: 'inline-flex',
          alignItems: 'center', gap: '4px',
          fontSize: '10px', color: 'var(--text-tertiary)',
        }}>
          <Loader size={11} /> saving
        </span>
      )}
      <FormField label={field.label} required={field.required} hint={field.hint ?? undefined}>
        {field.kind === 'longtext' ? (
          <TextArea rows={3} value={value}
                    onChange={e => onSet(e.target.value)} onBlur={e => onSave(e.target.value)} />
        ) : field.kind === 'boolean' ? (
          /* Yes and no, both explicit. A single checkbox cannot tell "no" from
             "not answered yet", and on a sanctions declaration that difference
             is the whole question. */
          <div style={{ display: 'flex', gap: '8px' }}>
            {['Yes', 'No'].map(opt => (
              <button key={opt} onClick={() => { onSet(opt); onSave(opt) }}
                      aria-pressed={value === opt}
                      style={chip(value === opt)}>{opt}</button>
            ))}
          </div>
        ) : field.kind === 'multichoice' ? (
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            {optionsOf(field).map(opt => {
              const on = splitMulti(value).includes(opt)
              return (
                <button key={opt}
                        onClick={() => { const next = toggleMulti(value, opt); onSet(next); onSave(next) }}
                        aria-pressed={on} style={chip(on)}>{opt}</button>
              )
            })}
          </div>
        ) : field.kind === 'choice' ? (
          <Select value={value} onChange={e => { onSet(e.target.value); onSave(e.target.value) }}>
            <option value="">Choose one</option>
            {optionsOf(field).map(o => <option key={o} value={o}>{o}</option>)}
          </Select>
        ) : (
          <TextInput
            type={field.kind === 'number' ? 'number' : field.kind === 'date' ? 'date'
              : field.kind === 'email' ? 'email' : 'text'}
            value={value}
            onChange={e => onSet(e.target.value)}
            onBlur={e => onSave(e.target.value)}
          />
        )}
      </FormField>
    </div>
  )
}

function chip(on: boolean): React.CSSProperties {
  return {
    padding: '6px 14px', borderRadius: 'var(--radius-full)', cursor: 'pointer',
    border: `1px solid ${on ? 'var(--brand-navy)' : 'var(--border)'}`,
    background: on ? 'var(--brand-navy)' : 'white',
    color: on ? 'white' : 'var(--text)',
    fontSize: 'var(--text-sm)', fontWeight: 700,
  }
}

/* --------------------------------------------------------------- the end -- */

function Finished({ creds, submitted }: { creds: Credentials; submitted: boolean }) {
  return (
    <>
      <h1 style={{ fontSize: 'var(--text-3xl)', fontWeight: 800, color: 'var(--text)' }}>
        {submitted ? 'It is with the onboarding desk' : 'Saved'}
      </h1>
      <p style={{ fontSize: 'var(--text-md)', color: 'var(--text-secondary)', marginTop: '10px', lineHeight: 1.6 }}>
        {submitted
          ? `Reference ${creds.reference}. The desk works to ${SLA_DAYS} working days end to end, and will come back to you on the email and number you gave. KYC starts with a phone call.`
          : `Reference ${creds.reference}. Everything you have answered is saved. Come back with that reference and your access code whenever you like — nothing expires.`}
      </p>
      <div style={{
        background: 'white', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)',
        padding: '20px', marginTop: '20px', maxWidth: '520px',
      }}>
        <Field label="Reference" value={creds.reference} />
        <Field label="Access code" value={creds.access_code} />
      </div>
    </>
  )
}
