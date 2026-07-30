import { useState } from 'react'
import { Store, ChevronLeft, ChevronRight, Check } from 'lucide-react'
import { SectionCard, FormField, TextInput, TextArea, Select, Btn, toast } from '../operator/shared'
import { PARTNER_PROFILE, PARTNER_PLAN, VERTICAL_NAMES } from './data'

const STEPS = ['Marketplace and type', 'Details and media', 'Pricing and commission', 'Fulfilment', 'Compliance', 'Review and submit']

export function PartnerNewListing() {
  const [step, setStep] = useState(0)
  const [vertical, setVertical] = useState('iot')
  const [name, setName] = useState('')
  const [desc, setDesc] = useState('')
  const [price, setPrice] = useState('')
  const [cost, setCost] = useState('')
  const [model, setModel] = useState('oneoff')

  const priceNum = parseFloat(price) || 0
  const costNum = parseFloat(cost) || 0
  const comm = +(priceNum * PARTNER_PLAN.base / 100).toFixed(2)
  const fee = +(priceNum * 0.019 + 0.20).toFixed(2)
  const net = +(priceNum - comm - fee).toFixed(2)
  const margin = costNum > 0 ? +(net - costNum).toFixed(2) : net

  const handleSubmit = () => {
    if (!name.trim() || priceNum <= 0) {
      toast('A listing needs a name and a price before it can be submitted', 'error')
      return
    }
    toast(`${name} submitted — now in the marketplace review queue`)
    setStep(0)
    setName('')
    setPrice('')
    setCost('')
    setDesc('')
  }

  const bodies: React.ReactNode[] = [
    // Step 0: Marketplace and type
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
        <FormField label="Which marketplace">
          <Select value={vertical} onChange={e => setVertical(e.target.value)}>
            {PARTNER_PROFILE.verticals.map(v => <option key={v} value={v}>{VERTICAL_NAMES[v] || v}</option>)}
          </Select>
        </FormField>
        <FormField label="Category" hint="Auto-detected from your existing catalogue">
          <Select>
            <option>Sensors</option>
            <option>Bundles</option>
            <option>Security</option>
          </Select>
        </FormField>
      </div>
      <div>
        <label style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--text)', marginBottom: '8px', display: 'block' }}>Listing type</label>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          {[
            ['Single product', 'One SKU, one price'],
            ['Bundle', 'Several items sold as one'],
            ['Subscription', 'Recurring, cancellable'],
          ].map((t, i) => (
            <label key={t[0]} style={{ display: 'flex', gap: '8px', alignItems: 'flex-start', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '9px 11px', flex: '1 1 0', cursor: 'pointer' }}>
              <input type="radio" name="nlType" defaultChecked={i === 0} style={{ marginTop: '2px' }} />
              <div>
                <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600 }}>{t[0]}</div>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>{t[1]}</div>
              </div>
            </label>
          ))}
        </div>
      </div>
    </div>,

    // Step 1: Details
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <FormField label="Listing name" hint="Buyers search this text. Avoid marketing language and model codes only you use.">
        <TextInput value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Nimbus Air Quality sensor" />
      </FormField>
      <FormField label="Description" hint="Two to four sentences. Claims about performance need evidence at the compliance gate.">
        <TextArea value={desc} onChange={e => setDesc(e.target.value)} placeholder="What it does, what is in the box, what it needs to work" />
      </FormField>
      <FormField label="Search tags" hint="Up to eight, comma separated.">
        <TextInput placeholder="IP67, 5-year battery, LoRaWAN" />
      </FormField>
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
          <span style={{ fontSize: 'var(--text-sm)', fontWeight: 600 }}>Media</span>
          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>1 to 6 images · 800px minimum · up to 5 MB each</span>
        </div>
        <div style={{ border: '2px dashed var(--border)', borderRadius: 'var(--radius-md)', padding: '24px', textAlign: 'center', background: 'var(--bg-alt)' }}>
          <Store size={24} style={{ color: 'var(--text-tertiary)', margin: '0 auto' }} />
          <div style={{ fontSize: 'var(--text-sm)', marginTop: '8px', color: 'var(--text-secondary)' }}>Drop files here, or add one:</div>
          <div style={{ display: 'flex', gap: '7px', justifyContent: 'center', marginTop: '10px' }}>
            <Btn variant="secondary" size="sm" onClick={() => toast('Image added — describe it before you submit')}>Add image</Btn>
            <Btn variant="secondary" size="sm" onClick={() => toast('Video added')}>Add video</Btn>
          </div>
        </div>
      </div>
    </div>,

    // Step 2: Pricing
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px' }}>
        <FormField label="Cost price (USD)" hint="What it costs you. Nothing may be discounted below this.">
          <TextInput type="number" value={cost} onChange={e => setCost(e.target.value)} placeholder="0.00" />
        </FormField>
        <FormField label="List price" hint="The undiscounted price.">
          <TextInput type="number" placeholder="0.00" />
        </FormField>
        <FormField label="Sale price (USD)" hint="What a buyer pays today.">
          <TextInput type="number" value={price} onChange={e => setPrice(e.target.value)} placeholder="0.00" />
        </FormField>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px' }}>
        <FormField label="Billing">
          <Select value={model} onChange={e => setModel(e.target.value)}>
            <option value="oneoff">One-off purchase</option>
            <option value="monthly">Monthly subscription</option>
            <option value="annual">Annual subscription</option>
          </Select>
        </FormField>
        <FormField label="Minimum order quantity">
          <TextInput type="number" defaultValue="1" style={{ width: '80px' }} />
        </FormField>
        <FormField label="Discount the operator may apply" hint="How far the marketplace may cut your price in a promotion.">
          <Select>
            <option>None — my price is my price</option>
            <option>Up to a quarter of my margin</option>
            <option>Up to half my margin</option>
            <option>Down to my cost price</option>
          </Select>
        </FormField>
      </div>
      {priceNum > 0 && (
        <div style={{ padding: '16px', borderRadius: 'var(--radius-md)', background: 'var(--bg-alt)', border: '1px solid var(--border)' }}>
          <div style={{ fontSize: 'var(--text-sm)', fontWeight: 700, marginBottom: '12px' }}>What you receive on each sale</div>
          <div style={{ display: 'flex', height: '28px', borderRadius: 'var(--radius)', overflow: 'hidden', marginBottom: '12px' }}>
            <div style={{ width: `${(net / priceNum) * 100}%`, background: 'var(--brand-navy)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontSize: 'var(--text-xs)', fontWeight: 600 }}>
              You ${fmt(net)}
            </div>
            <div style={{ width: `${(comm / priceNum) * 100}%`, background: '#5E4B9B', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontSize: 'var(--text-xs)', fontWeight: 600 }}>
              Comm
            </div>
            <div style={{ width: `${(fee / priceNum) * 100}%`, background: '#B8A4E8' }} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: 'var(--text-sm)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: 'var(--text-tertiary)' }}>Sale price</span><span style={{ fontWeight: 600 }}>${fmt(priceNum)}</span></div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: 'var(--text-tertiary)' }}>Commission at {PARTNER_PLAN.base}%</span><span>less ${fmt(comm)}</span></div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: 'var(--text-tertiary)' }}>Payment and per-order fees</span><span>less ${fmt(fee)}</span></div>
            <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: '8px', borderTop: '1px solid var(--border)' }}><span style={{ fontWeight: 700 }}>{costNum > 0 ? 'Your margin' : 'Settles to you'}</span><span style={{ fontWeight: 800 }}>${fmt(margin)}</span></div>
          </div>
        </div>
      )}
    </div>,

    // Step 3: Fulfilment
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <FormField label="How is it delivered">
        <Select>
          <option>Shipped by you</option>
          <option>Instant digital delivery</option>
          <option>Provisioned by you after order</option>
        </Select>
      </FormField>
      <div>
        <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600, marginBottom: '10px' }}>Buyers will see this pipeline:</div>
        <div style={{ display: 'flex', gap: '0', alignItems: 'flex-start' }}>
          {['Placed', 'Packed', 'In transit', 'Delivered'].map((s, i) => (
            <div key={s} style={{ flex: '1 1 0', minWidth: '100px', textAlign: 'center' }}>
              <div style={{
                width: '28px', height: '28px', borderRadius: '50%', margin: '0 auto 6px',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 'var(--text-xs)', fontWeight: 700,
                background: i === 0 ? 'var(--success-bg)' : 'var(--bg-alt)',
                color: i === 0 ? 'var(--success)' : 'var(--text-tertiary)',
                border: i === 0 ? '2px solid var(--success)' : '2px solid var(--border)',
              }}>
                {i === 0 ? <Check size={14} /> : i + 1}
              </div>
              <div style={{ fontSize: 'var(--text-xs)' }}>{s}</div>
            </div>
          ))}
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
        <FormField label="Dispatch target" hint="Missing this target repeatedly affects your seller rating.">
          <Select>
            <option>Same working day</option>
            <option>Next working day</option>
            <option>Within 3 working days</option>
          </Select>
        </FormField>
        <FormField label="Returns window">
          <Select>
            <option>14 days (marketplace standard)</option>
            <option>30 days</option>
            <option>Not applicable — digital entitlement</option>
          </Select>
        </FormField>
      </div>
      <FormField label="Fulfilment API endpoint" hint="Which of your endpoints the marketplace calls when an order is placed.">
        <Select>
          <option value="">Manual — no API call, I will work from the portal</option>
          <option>Fulfilment Webhook · Sandbox · api.nimbus-sensors.example/fulfil/callback</option>
        </Select>
      </FormField>
    </div>,

    // Step 4: Compliance
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div>
        <label style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--text)', marginBottom: '8px', display: 'block' }}>Markets</label>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          {['India', 'UAE', 'Kenya', 'Singapore', 'Germany'].map(m => (
            <label key={m} style={{ display: 'flex', gap: '6px', alignItems: 'center', border: '1px solid var(--border)', borderRadius: '20px', padding: '5px 11px', cursor: 'pointer' }}>
              <input type="checkbox" defaultChecked={m === 'India' || m === 'UAE'} />
              <span style={{ fontSize: 'var(--text-sm)' }}>{m}</span>
            </label>
          ))}
        </div>
      </div>
      <div>
        <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600, marginBottom: '10px' }}>Declarations</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '9px' }}>
          {[
            ['Radio type approval held for every selected market', 'Required for anything that transmits'],
            ['Product complies with local safety and labelling rules', 'Evidence may be requested at review'],
            ['No randomised paid rewards or loot mechanics', 'Marketplace policy 7.4'],
            ['Personal data handling disclosed in the listing', 'Where the product collects any'],
          ].map((d, i) => (
            <label key={i} style={{ display: 'flex', gap: '8px', alignItems: 'flex-start', cursor: 'pointer' }}>
              <input type="checkbox" style={{ marginTop: '2px' }} />
              <div>
                <div style={{ fontSize: 'var(--text-sm)' }}>{d[0]}</div>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>{d[1]}</div>
              </div>
            </label>
          ))}
        </div>
      </div>
      <div style={{ padding: '12px 16px', borderRadius: 'var(--radius-md)', background: 'var(--info-bg)', border: '1px solid var(--info)', fontSize: 'var(--text-sm)', color: 'var(--info)' }}>
        Declarations are checked at review. A listing that clears review but is later found non-compliant is delisted and the sales are reversed.
      </div>
    </div>,

    // Step 5: Review
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
      <div>
        <div style={{ fontSize: 'var(--text-sm)', fontWeight: 700, marginBottom: '10px' }}>Preview</div>
        <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', overflow: 'hidden', maxWidth: '300px' }}>
          <div style={{ height: '120px', background: 'var(--bg-alt)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Store size={32} style={{ color: 'var(--text-tertiary)' }} />
          </div>
          <div style={{ padding: '12px' }}>
            <div style={{ fontWeight: 600, fontSize: 'var(--text-sm)' }}>{name || 'Untitled listing'}</div>
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginTop: '2px' }}>{PARTNER_PROFILE.name}</div>
            <div style={{ fontWeight: 700, marginTop: '8px' }}>{priceNum ? `$${fmt(priceNum)}` : '—'}</div>
          </div>
        </div>
      </div>
      <div>
        <div style={{ fontSize: 'var(--text-sm)', fontWeight: 700, marginBottom: '10px' }}>Summary</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: 'var(--text-sm)' }}>
          <SummaryRow label="Marketplace" value={VERTICAL_NAMES[vertical] || vertical} />
          <SummaryRow label="Price" value={priceNum ? `$${fmt(priceNum)}${model === 'monthly' ? ' per month' : ''}` : 'Not set'} />
          <SummaryRow label="Commission" value={`${PARTNER_PLAN.base}% · ${priceNum ? `$${fmt(comm)}` : '—'}`} />
          <SummaryRow label="You receive" value={priceNum ? `$${fmt(net)}` : '—'} />
          <SummaryRow label="Fulfilment" value="Shipped by you" />
        </div>
        <div style={{ marginTop: '16px', padding: '12px', borderRadius: 'var(--radius)', background: 'var(--warning-bg)', border: '1px solid var(--warning)', fontSize: 'var(--text-xs)', color: 'var(--warning)' }}>
          <strong>After you submit:</strong> The catalogue team reviews within one working day. You are told why if it is rejected, and can resubmit. Listing is free — you pay {PARTNER_PLAN.base}% commission only when it sells.
        </div>
      </div>
    </div>,
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div>
        <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 800, color: 'var(--text)' }}>New Listing</h1>
        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)', marginTop: '4px' }}>
          Product onboarding — six steps from category to submission. Nothing is published until the marketplace clears it.
        </p>
      </div>

      {/* Wizard rail */}
      <div style={{ display: 'flex', border: '1px solid var(--border)', borderRadius: 'var(--radius)', overflow: 'hidden', background: 'white' }}>
        {STEPS.map((st, i) => (
          <div key={st} style={{
            flex: '1 1 0', padding: '10px 12px', fontSize: 'var(--text-sm)',
            display: 'flex', gap: '8px', alignItems: 'center',
            borderRight: i < STEPS.length - 1 ? '1px solid var(--border)' : 'none',
            color: i < step ? 'var(--success)' : i === step ? 'var(--brand-navy)' : 'var(--text-tertiary)',
            background: i === step ? 'var(--bg-alt)' : 'transparent',
            fontWeight: i === step ? 600 : 400,
          }}>
            <span style={{
              width: '20px', height: '20px', borderRadius: '50%',
              border: '1px solid', display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '10px', flexShrink: 0,
              borderColor: i < step ? 'var(--success)' : i === step ? 'var(--brand-navy)' : 'var(--border)',
              background: i < step ? 'var(--success-bg)' : i === step ? 'var(--brand-navy)' : 'transparent',
              color: i < step ? 'var(--success)' : i === step ? 'white' : 'var(--text-tertiary)',
            }}>
              {i < step ? <Check size={10} /> : i + 1}
            </span>
            {st}
          </div>
        ))}
      </div>

      <SectionCard title={STEPS[step]} subtitle={`Step ${step + 1} of ${STEPS.length}`}>
        <div style={{ padding: '20px' }}>
          {bodies[step]}
        </div>
      </SectionCard>

      <div style={{ display: 'flex', alignItems: 'center' }}>
        <Btn variant="secondary" disabled={step === 0} onClick={() => setStep(step - 1)}>
          <ChevronLeft size={14} /> Back
        </Btn>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginRight: '12px' }}>
          {step === STEPS.length - 1 ? 'Submitting sends this to the catalogue team' : 'Your progress is saved as you go'}
        </span>
        {step === STEPS.length - 1
          ? <Btn variant="primary" onClick={handleSubmit}>Submit for review</Btn>
          : <Btn variant="primary" onClick={() => setStep(step + 1)}>Continue <ChevronRight size={14} /></Btn>}
      </div>
    </div>
  )
}

function fmt(n: number) { return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) }

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
      <span style={{ color: 'var(--text-tertiary)' }}>{label}</span>
      <span style={{ fontWeight: 600 }}>{value}</span>
    </div>
  )
}
