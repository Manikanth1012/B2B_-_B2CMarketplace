/* The onboarding journey, as a rail rather than seven boxes in a row.
 *
 * What was there before drew each gate as an equal-width tile carrying its name,
 * owner, target and two warning labels, and that was all a gate ever said. The
 * three questions people actually bring to this screen — where is this seller,
 * what is holding them up, and what did they send us — could none of them be
 * answered from it.
 *
 * So the rail carries progress and time, and everything else moves into the
 * gate itself: what was submitted, what was attached, and each thing the gate
 * demands ticked against what arrived. Shared by both consoles, because the
 * operator deciding and the seller waiting must be looking at one record.
 */

import {
  CircleCheck as CheckCircle, Clock, Circle, CircleAlert as AlertCircle,
  FileText, Users,
} from 'lucide-react'
import type { JourneyStep } from '../lib/onboarding'
import { evidenceChecklist, journeyProgress } from '../lib/onboarding'
import { EvidenceLink } from './EvidenceLink'
import type { Viewer } from '../lib/evidence'
import { fmtDate } from './operator/shared'

type Tone = 'cleared' | 'current' | 'failed' | 'pending'

const TONE: Record<Tone, { ring: string; fill: string; ink: string; label: string }> = {
  cleared: { ring: 'var(--success)', fill: 'var(--success-bg)', ink: 'var(--success)', label: 'Cleared' },
  current: { ring: 'var(--info)',    fill: 'var(--info-bg)',    ink: 'var(--info)',    label: 'Under review' },
  failed:  { ring: 'var(--danger)',  fill: 'var(--danger-bg)',  ink: 'var(--danger)',  label: 'Failed' },
  pending: { ring: 'var(--border)',  fill: 'var(--bg-alt)',     ink: 'var(--text-tertiary)', label: 'Not reached' },
}

const toneOf = (status: string): Tone =>
  status === 'cleared' ? 'cleared' : status === 'current' ? 'current' : status === 'failed' ? 'failed' : 'pending'

function StepIcon({ tone, n }: { tone: Tone; n: number }) {
  if (tone === 'cleared') return <CheckCircle size={18} />
  if (tone === 'current') return <Clock size={18} />
  if (tone === 'failed') return <AlertCircle size={18} />
  return <span style={{ fontSize: '11px', fontWeight: 800 }}>{n}</span>
}

/* ----------------------------------------------------------------- rail --- */

export function JourneyRail({ steps, selected, onSelect }: {
  steps: JourneyStep[]
  selected: string | null
  onSelect: (step: JourneyStep) => void
}) {
  const progress = journeyProgress(steps)
  if (steps.length === 0) return null

  return (
    <div>
      {/* One line saying where the seller is, before any of the detail. */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'baseline', marginBottom: '14px' }}>
        <strong style={{ fontSize: 'var(--text-sm)', color: 'var(--text)' }}>
          {progress.cleared} of {progress.total} gates cleared
        </strong>
        <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
          {progress.failed
            ? `Stopped at ${progress.failed.gate.name}. The application does not continue from here.`
            : progress.complete
            ? 'Every gate cleared. This is the record of how the seller came through.'
            : progress.current
            ? `Waiting on ${progress.current.gate.name}, owned by ${progress.current.gate.owner}.`
            : 'No gate is open.'}
        </span>
      </div>

      {/* The rail. Horizontal on a wide screen, and it wraps rather than
          squeezing seven tiles into a phone. */}
      <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexWrap: 'wrap', gap: '2px' }}>
        {steps.map((s, i) => {
          const tone = toneOf(s.row.status)
          const t = TONE[tone]
          const active = selected === s.row.id
          return (
            <li key={s.row.id} style={{ flex: '1 1 130px', minWidth: '130px' }}>
              <button
                onClick={() => onSelect(s)}
                aria-current={active ? 'step' : undefined}
                style={{
                  width: '100%', height: '100%', textAlign: 'left', cursor: 'pointer',
                  padding: '11px 12px', borderRadius: 'var(--radius-md)',
                  background: active ? 'white' : t.fill,
                  border: `1px solid ${active ? 'var(--brand-navy)' : t.ring}`,
                  boxShadow: active ? 'var(--shadow-md)' : 'none',
                  display: 'flex', flexDirection: 'column', gap: '5px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: t.ink }}>
                  <StepIcon tone={tone} n={i + 1} />
                  <span style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                    {t.label}
                  </span>
                </div>
                <div style={{ fontSize: 'var(--text-xs)', fontWeight: 700, color: 'var(--text)', lineHeight: 1.3 }}>
                  {s.gate.name}
                </div>
                {/* Time is the thing a funnel is judged on, so the rail carries
                    it rather than the gate's owner and flags, which are the
                    same on every seller and read once. */}
                <div style={{ fontSize: '10px', color: s.overTarget ? 'var(--danger)' : 'var(--text-tertiary)', fontWeight: s.overTarget ? 700 : 400 }}>
                  {s.elapsedDays !== null
                    ? s.elapsedDays === 0
                      ? 'Same day'
                      : `${s.elapsedDays}d against ${s.row.target_days}d target`
                    : s.row.status === 'current'
                    ? `Target ${s.row.target_days === 0 ? 'same day' : `${s.row.target_days}d`}`
                    : '—'}
                </div>
              </button>
            </li>
          )
        })}
      </ol>
    </div>
  )
}

/* ------------------------------------------------------------ inspector --- */

export function GateDetail({ step, previous, viewer, children }: {
  step: JourneyStep
  previous: JourneyStep | null
  /* Who is looking, so a document row can offer a button that works rather
     than one that fails at the bucket. */
  viewer: Viewer
  /* The console's own controls — clearing, notes, the technical checklist. The
     record is the same on both sides; only what you can do with it differs. */
  children?: React.ReactNode
}) {
  const tone = toneOf(step.row.status)
  const t = TONE[tone]
  const sub = step.submission
  const checklist = evidenceChecklist(step)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
      <div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center', marginBottom: '6px' }}>
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: '5px', padding: '2px 10px',
            borderRadius: 'var(--radius-full)', fontSize: 'var(--text-xs)', fontWeight: 700,
            background: t.fill, color: t.ink,
          }}>
            <StepIcon tone={tone} n={step.gate.order} />{t.label}
          </span>
          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
            Gate {step.gate.order} of 7 · {step.gate.owner}
          </span>
        </div>
        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', margin: 0 }}>{step.gate.what}</p>
      </div>

      {step.row.status === 'failed' && sub?.note && (
        <Callout tone="danger" title="Why this gate failed">{sub.note}</Callout>
      )}

      {step.row.status === 'pending' && (
        <Callout tone="info" title="Nothing submitted yet">
          This gate opens once {previous ? previous.gate.name.toLowerCase() : 'the previous gate'} clears.
          There is no partial record to read.
        </Callout>
      )}

      {/* The facts about the gate itself: who owns it, how long it is allowed
          to take, and whether it can be waived at all. */}
      <Facts rows={[
        ['Target', step.row.target_days === 0 ? 'Same day' : `${step.row.target_days} working day${step.row.target_days === 1 ? '' : 's'}`],
        ['Controls', [
          step.row.dual_control ? 'Dual control required' : 'Single reviewer',
          step.row.waivable ? 'Waivable, with a recorded reason' : 'Not waivable — this gate is the basis for trading with the seller',
        ].join(' · ')],
        ...(step.row.submitted_by ? [['Submitted by', `${step.row.submitted_by} on ${fmtDate(step.row.submitted_at)}`] as [string, string]] : []),
        ['Reviewed by', step.row.reviewed_by ? `${step.row.reviewed_by} on ${fmtDate(step.row.reviewed_at)}` : 'Not yet reviewed'],
        ...(step.elapsedDays !== null
          ? [['Took', step.elapsedDays === 0
              ? 'Decided the same day'
              : `${step.elapsedDays} day${step.elapsedDays === 1 ? '' : 's'}${step.overTarget ? ' — past target' : ''}`] as [string, string]]
          : []),
      ]} />

      {sub && sub.fields.length > 0 && (
        <section>
          <SubHead icon={<FileText size={14} />} title="What was submitted" />
          <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
            {sub.fields.map(([label, value], i) => (
              <div key={label} style={{
                display: 'flex', gap: '12px', padding: '9px 12px', flexWrap: 'wrap',
                borderTop: i === 0 ? 'none' : '1px solid var(--border-light)',
                background: i % 2 ? 'var(--bg-alt)' : 'white',
              }}>
                <span style={{ flex: '0 0 42%', minWidth: '150px', fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>{label}</span>
                <span style={{ flex: 1, fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--text)', wordBreak: 'break-word' }}>{value}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      <section>
        <SubHead icon={<FileText size={14} />} title="Documents" />
        {step.documents.length === 0 ? (
          <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', margin: 0 }}>
            {sub ? 'No documents were attached to this gate.' : 'Nothing has been attached yet.'}
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {step.documents.map(d => (
              <div key={d.id} style={{
                display: 'flex', alignItems: 'center', gap: '10px', padding: '9px 11px',
                border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', background: 'white',
              }}>
                <span style={{
                  width: 30, height: 30, flexShrink: 0, borderRadius: 'var(--radius-sm)',
                  background: 'var(--bg-alt)', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: 'var(--text-tertiary)',
                }}><FileText size={15} /></span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 'var(--text-xs)', fontWeight: 700, color: 'var(--text)' }}>{d.name}</div>
                  <div style={{ fontSize: '10px', color: 'var(--text-tertiary)' }}>
                    {d.kind} · {d.size}{d.uploaded_by ? ` · ${d.uploaded_by}` : ''}
                  </div>
                </div>
                <EvidenceLink viewer={viewer} doc={d} />
              </div>
            ))}
          </div>
        )}
        {step.documents.length > 0 && (
          <p style={{ fontSize: '10px', color: 'var(--text-tertiary)', margin: '8px 0 0' }}>
            These carry named individuals' personal data and a company's banking details. Links are
            short-lived and opening one is recorded against your account.
          </p>
        )}
      </section>

      {/* What the gate demands, against what arrived. A text match, not a
          verdict — a tick means "the submission mentions this, read it", never
          "this is proved". Saying so on the screen matters: a reviewer who
          reads a row of green ticks as a pass is not reviewing anything. */}
      <section>
        <SubHead icon={<Users size={14} />} title="Evidence this gate demands" />
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '5px' }}>
          {checklist.map(({ demand, seen }) => (
            <li key={demand} style={{ display: 'flex', gap: '8px', alignItems: 'flex-start', fontSize: 'var(--text-xs)' }}>
              <span style={{ flexShrink: 0, marginTop: '1px', color: seen ? 'var(--success)' : 'var(--text-tertiary)' }}>
                {seen ? <CheckCircle size={14} /> : <Circle size={14} />}
              </span>
              <span style={{ color: seen ? 'var(--text)' : 'var(--text-secondary)' }}>
                {demand}
                {!seen && <span style={{ color: 'var(--text-tertiary)' }}> — nothing above mentions this</span>}
              </span>
            </li>
          ))}
        </ul>
        <p style={{ fontSize: '10px', color: 'var(--text-tertiary)', margin: '8px 0 0' }}>
          A tick means the submission names it, not that it is satisfied. Nothing here reads a document —
          that is what you are for.
        </p>
      </section>

      {children}
    </div>
  )
}

/* ------------------------------------------------------------- pieces ----- */

function SubHead({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px', color: 'var(--text)' }}>
      {icon}
      <h4 style={{ fontSize: 'var(--text-sm)', fontWeight: 700, margin: 0 }}>{title}</h4>
    </div>
  )
}

function Facts({ rows }: { rows: [string, string][] }) {
  return (
    <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '5px 14px' }}>
      {rows.map(([k, v]) => (
        <div key={k} style={{ display: 'contents' }}>
          <dt style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', whiteSpace: 'nowrap' }}>{k}</dt>
          <dd style={{ fontSize: 'var(--text-xs)', color: 'var(--text)', margin: 0 }}>{v}</dd>
        </div>
      ))}
    </dl>
  )
}

export function Callout({ tone, title, children }: {
  tone: 'info' | 'danger' | 'warning' | 'success'
  title?: string
  children: React.ReactNode
}) {
  const map = {
    info:    { bg: 'var(--info-bg)',    ink: 'var(--info)',    line: 'var(--info)' },
    danger:  { bg: 'var(--danger-bg)',  ink: 'var(--danger)',  line: 'var(--danger)' },
    warning: { bg: 'var(--warning-bg)', ink: 'var(--warning)', line: 'var(--warning)' },
    success: { bg: 'var(--success-bg)', ink: 'var(--success)', line: 'var(--success)' },
  }[tone]
  return (
    <div style={{
      padding: '10px 12px', borderRadius: 'var(--radius-md)',
      background: map.bg, borderLeft: `3px solid ${map.line}`,
      fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', lineHeight: 1.5,
    }}>
      {title && <strong style={{ color: map.ink, display: 'block', marginBottom: '2px' }}>{title}</strong>}
      {children}
    </div>
  )
}
