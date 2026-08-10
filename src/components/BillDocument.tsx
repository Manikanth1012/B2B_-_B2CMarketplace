import type { Template, BillFacts } from '../lib/billTemplate'
import { blocksFor, money } from '../lib/billTemplate'
import { ClearanceStamp } from './ClearanceStamp'
import type { Regime, ClearanceRecord } from '../lib/einvoice'

/* A bill, drawn from the sections its template carries.
 *
 * One renderer, used twice. The operator's template editor puts it beside the
 * checkboxes, because a list of sixteen switches is a form nobody can check
 * their own work against — ticking "Payment slip" has to make a payment slip
 * appear. The customer's Bills tab puts it behind View, and gets the same
 * document.
 *
 * That sharing is the point rather than a saving. If the editor drew its own
 * approximation, the operator would be configuring one document and the
 * customer would be reading another, and nothing on either screen would say
 * so.
 */

export function BillDocument(
  { template, ids, facts, reference, clearance }: {
    /* No 'currency': the document is denominated by the row it is raised from,
       which `facts` carries. The template only decides how it looks. */
    template: Pick<Template, 'doc_title' | 'accent' | 'tax_label' | 'logo' |
      'show_order_lines' | 'remittance' | 'footer' | 'audience' | 'language'>
    ids: readonly string[]
    facts: BillFacts | null
    /* What this template would put on its next document. The bill supplies
       every other figure, but not this one: the reference is the field the
       editor is actively changing, so showing the old bill's would be showing
       the one thing the operator did not ask about. */
    reference?: string
    /* The statutory registration, where the market has one. Not a section and
       not switchable: a template decides how the document looks, and no
       template gets to leave an IRN off an Indian invoice — without it the
       document is not a tax invoice and the customer cannot claim against it.
       Absent (or null) where nothing has been registered, which the stamp
       itself renders as a warning rather than as silence. */
    clearance?: { regime: Regime | null; record: ClearanceRecord | null }
  },
) {
  if (!facts) {
    return (
      <div style={box}>
        <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', textAlign: 'center', padding: '32px 12px' }}>
          No document on file for this audience to preview against.
        </p>
      </div>
    )
  }

  const showing = new Set(blocksFor(ids, facts))
  const on = (id: string) => showing.has(id)
  const accent = template.accent || '#0D47A1'
  const forSeller = template.audience === 'partner'
  const net = facts.total - facts.tax

  return (
    <div style={box} aria-label="Document preview">
      {on('masthead') && (
        <div style={{
          display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
          gap: '12px', paddingBottom: '10px', borderBottom: `2px solid ${accent}`,
        }}>
          {template.logo && (
            <div style={{ fontWeight: 800, fontSize: 'var(--text-sm)', color: accent, letterSpacing: '-0.01em' }}>
              {facts.billedFrom.mark}
            </div>
          )}
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontWeight: 700, fontSize: 'var(--text-sm)', color: 'var(--text)' }}>
              {template.doc_title || 'Invoice'}
            </div>
            <div style={tiny}>{template.language}</div>
          </div>
        </div>
      )}

      {on('parties') && (
        <>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 16px', margin: '10px 0', ...tiny }}>
            <span>Reference <strong style={num}>{reference ?? facts.reference}</strong></span>
            <span>Issued <strong>{facts.issued}</strong></span>
            <span>Due <strong>{facts.due}</strong></span>
            <span>Currency <strong>{facts.currency}</strong></span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '10px' }}>
            <Party heading={forSeller ? 'Self-billed for' : 'Billed to'}
              name={facts.billedTo.name} lines={facts.billedTo.lines}
              extra={[facts.billedTo.ref && `Account ${facts.billedTo.ref}`,
                facts.billedTo.contact, facts.billedTo.tax].filter(Boolean) as string[]} />
            <Party heading={forSeller ? 'Raised by' : 'Bill from'}
              name={facts.billedFrom.name} lines={facts.billedFrom.lines}
              extra={facts.billedFrom.tax ? [facts.billedFrom.tax] : []} />
          </div>
        </>
      )}

      {on('hero') && (
        <div style={{
          background: `${accent}12`, border: `1px solid ${accent}33`, borderRadius: '6px',
          padding: '10px 12px', margin: '10px 0',
          display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '8px',
        }}>
          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', fontWeight: 600 }}>
            {forSeller ? 'Net payable to seller' : 'Amount due'}
          </span>
          <strong style={{ ...num, fontSize: 'var(--text-xl)', color: accent }}>{facts.currencyMark}{money(facts.total)}</strong>
          <span style={tiny}>{forSeller ? `for ${facts.due}` : `by ${facts.due}`}</span>
        </div>
      )}

      {/* Line detail off is what makes a compact template compact — and it is
          worth saying so on the face of the document rather than leaving a gap
          where the charges were. */}
      {!template.show_order_lines && (on('subs') || on('usage')) ? (
        <Line label="Charges for the period — line detail suppressed on this template" amount={net} mark={facts.currencyMark} />
      ) : (
        <>
          {on('subs') && facts.lines.map((l, i) => (
            <Line key={`s${i}`} label={l.label} detail={l.detail} amount={l.amount} mark={facts.currencyMark} />
          ))}
          {on('usage') && facts.usage.map((l, i) => (
            <Line key={`u${i}`} label={l.label} detail={l.detail} amount={l.amount} mark={facts.currencyMark} />
          ))}
        </>
      )}

      {on('credits') && (
        <Line label="Credits and adjustments" detail={facts.credits === 0 ? 'None this period' : undefined}
          amount={facts.credits} mark={facts.currencyMark} />
      )}

      {on('rewards') && facts.rewards && (
        <div style={{ ...blockStyle, background: 'var(--bg-alt)' }}>
          <strong style={blockHead}>Reward points</strong>
          <div style={{ ...tiny, display: 'flex', gap: '14px', flexWrap: 'wrap' }}>
            <span>Earned this period <strong style={num}>{facts.rewards.earned.toLocaleString()}</strong></span>
            <span>Redeemed this period <strong style={num}>{facts.rewards.redeemed.toLocaleString()}</strong></span>
            <span>Balance carried forward <strong style={num}>{facts.rewards.balance.toLocaleString()}</strong></span>
          </div>
        </div>
      )}

      {on('tax') && (
        <Total label={`${facts.taxLabel}${facts.taxRate ? ` at ${facts.taxRate}%` : ''}`} amount={facts.tax} mark={facts.currencyMark} />
      )}

      {on('summary') && (
        <>
          <Total label="Net" amount={net} mark={facts.currencyMark} />
          <Total label={forSeller ? 'Net payable to seller' : 'Total due'} amount={facts.total} grand accent={accent} mark={facts.currencyMark} />
        </>
      )}

      {on('payments') && <Line label="Paid this period" amount={-facts.paid} mark={facts.currencyMark} />}

      {/* Inside the section list, not beside it.
       *
          This used to render on `clearance &&` — a prop the customer's own bill
          view passed and the template preview did not, so the stamp appeared on
          one of the four renditions of a document and on none of the three a
          Kenyan customer actually files: not the PDF, not the plain-text
          download, not the operator's preview. It was also not a section, so
          the operator had no way to see it existed or where it sat.

          `facts.clearance` is now the same reduction all four read, and `on`
          is the same section switch as every block around it. The `clearance`
          prop stays for the live record's own detail — status, failure, the
          scannable QR — which is more than the printed document carries. */}
      {on('fiscal') && facts.clearance.length > 0 && (
        clearance
          ? <ClearanceStamp regime={clearance.regime} record={clearance.record} compact />
          : (
            <div style={blockStyle}>
              <strong style={blockHead}>Fiscal clearance</strong>
              <div style={tiny}>
                {facts.clearance.map(c => (
                  <div key={c.label}>
                    {c.label} <strong style={c.mono ? num : undefined}>{c.value}</strong>
                  </div>
                ))}
                {facts.verifyUrl && facts.verifyUrl !== 'signed' && (
                  <div style={{ marginTop: 3 }}>Verify at {facts.verifyUrl}</div>
                )}
              </div>
            </div>
          )
      )}

      {on('howtopay') && (
        <div style={blockStyle}>
          <strong style={blockHead}>How to pay</strong>
          <div style={tiny}>
            {facts.howToPay}
            <br />Quote <strong style={num}>{facts.payRef}</strong>.
          </div>
        </div>
      )}

      {on('support') && facts.support && (
        <div style={blockStyle}>
          <strong style={blockHead}>Questions about this bill</strong>
          <div style={tiny}>
            {[facts.support.phone, facts.support.hours].filter(Boolean).join(' · ')}
            <br />{[facts.support.email, facts.support.portal].filter(Boolean).join(' · ')}
            <br />Queries must be raised within {facts.support.window}.
          </div>
        </div>
      )}

      {on('advert') && facts.advert && (
        <div style={{
          ...blockStyle,
          background: `${facts.advert.accent}12`, borderLeft: `3px solid ${facts.advert.accent}`,
        }}>
          <strong style={{ ...blockHead, color: facts.advert.accent }}>{facts.advert.title}</strong>
          <div style={tiny}>
            {facts.advert.subtitle}
            {facts.advert.subtitle && <br />}
            <strong>{facts.advert.cta} →</strong>
            <br />Drawn from the live storefront banners. Never printed on a dunning or final notice.
          </div>
        </div>
      )}

      {on('terms') && facts.terms.length > 0 && (
        <div style={blockStyle}>
          <strong style={blockHead}>Terms</strong>
          <ol style={{ ...tiny, paddingLeft: '16px', margin: 0 }}>
            {facts.terms.map((t, i) => <li key={i}>{t}</li>)}
          </ol>
        </div>
      )}

      {on('slip') && (
        <div style={{ marginTop: '12px', paddingTop: '10px', borderTop: '1px dashed var(--border)' }}>
          <div style={{ ...tiny, textAlign: 'center', marginBottom: '6px' }}>detach below this line</div>
          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
            gap: '8px', border: '1px solid var(--border)', borderRadius: '4px', padding: '8px 10px',
          }}>
            <span style={tiny}>Payment slip · <strong style={num}>{facts.payRef}</strong></span>
            <strong style={num}>{facts.currencyMark}{money(facts.total)}</strong>
          </div>
        </div>
      )}

      {(template.remittance || template.footer) && (
        <div style={{ ...tiny, marginTop: '12px', paddingTop: '8px', borderTop: '1px solid var(--border-light)' }}>
          {template.footer}
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------- fragments -- */

function Party({ heading, name, lines, extra }: {
  heading: string; name: string; lines: string[]; extra: string[]
}) {
  return (
    <div>
      <div style={{ ...tiny, textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 700 }}>{heading}</div>
      <div style={{ fontSize: 'var(--text-xs)', fontWeight: 700, color: 'var(--text)' }}>{name}</div>
      {lines.filter(Boolean).map((l, i) => <div key={i} style={tiny}>{l}</div>)}
      {extra.map((l, i) => <div key={`x${i}`} style={tiny}>{l}</div>)}
    </div>
  )
}

function Line({ label, detail, amount, mark }: { label: string; detail?: string; amount: number; mark: string }) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', gap: '10px',
      padding: '5px 0', borderBottom: '1px solid var(--border-light)',
    }}>
      <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>
        {label}{detail && <span style={{ color: 'var(--text-tertiary)' }}> · {detail}</span>}
      </span>
      <span style={{ ...num, fontSize: 'var(--text-xs)', whiteSpace: 'nowrap' }}>{mark}{money(amount)}</span>
    </div>
  )
}

function Total({ label, amount, grand, accent, mark }: {
  mark: string
  label: string; amount: number; grand?: boolean; accent?: string
}) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', gap: '10px',
      padding: grand ? '7px 0' : '4px 0',
      borderTop: grand ? '2px solid var(--border)' : 'none',
      fontWeight: grand ? 800 : 600,
      color: grand ? (accent ?? 'var(--text)') : 'var(--text-secondary)',
      fontSize: grand ? 'var(--text-sm)' : 'var(--text-xs)',
    }}>
      <span>{label}</span><span style={num}>{mark}{money(amount)}</span>
    </div>
  )
}

/* ---------------------------------------------------------------- styles -- */

const box: React.CSSProperties = {
  background: 'white', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)',
  padding: '16px 18px', boxShadow: 'var(--shadow-sm)',
}
const tiny: React.CSSProperties = { fontSize: '11px', color: 'var(--text-tertiary)', lineHeight: 1.5 }
const num: React.CSSProperties = { fontVariantNumeric: 'tabular-nums', color: 'var(--text)' }
const blockStyle: React.CSSProperties = {
  margin: '8px 0', padding: '8px 10px', borderRadius: '4px',
  background: 'var(--bg-alt)',
}
const blockHead: React.CSSProperties = {
  display: 'block', fontSize: 'var(--text-xs)', color: 'var(--text)', marginBottom: '2px',
}
