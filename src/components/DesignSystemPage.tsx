import { useEffect, useState } from 'react'
import { Search } from 'lucide-react'
import { Btn, EmptyState, FormField, Modal, Select, StatusPill, Table, TableRow, Td, TextArea, TextInput, ToastHost, toast } from './operator/shared'
import { Callout } from './OnboardingJourney'
import { Dialog, Drawer, Dropdown, KpiCard, Skeleton, Spinner, StatusBadge, Tabs, Toggle } from './ui'
import { contrast } from '../lib/contrast'

/* The reference page for the design system: every shared component in every
   state, with local demo state only. Standalone (no auth, no data, not in any
   navigation) and excluded from the design guardrail scan. */

const COLOUR_TOKENS = [
  'ink-900', 'ink-800', 'slate-600', 'slate-500', 'control-border', 'slate-300', 'slate-200', 'slate-100', 'canvas', 'surface',
  'indigo-600', 'indigo-700', 'indigo-50', 'teal-700', 'orange-500', 'orange-600', 'orange-700', 'orange-50',
  'success', 'success-bg', 'warning', 'warning-bg', 'danger', 'danger-bg', 'info', 'info-bg',
]
const TYPE_SCALE = [
  { name: 'Title', size: 'var(--fs-title)', weight: 'var(--fw-title)', note: '24 / 650 / -0.02em' },
  { name: 'Section', size: 'var(--fs-section)', weight: 'var(--fw-section)', note: '16 / 600' },
  { name: 'Card', size: 'var(--fs-card)', weight: 'var(--fw-card)', note: '14 / 600' },
  { name: 'Body', size: 'var(--fs-body)', weight: 'var(--fw-body)', note: '14 / 400' },
  { name: 'Table', size: 'var(--fs-table)', weight: 400, note: '13' },
  { name: 'Meta', size: 'var(--fs-meta)', weight: 400, note: '12' },
]
const SPACES = ['space-1', 'space-2', 'space-3', 'space-4', 'space-6', 'space-8', 'space-12', 'space-16']
const RADII = ['radius-sm', 'radius', 'radius-md', 'radius-lg', 'radius-xl']
const SHADOWS = ['shadow-sm', 'shadow-md', 'shadow-lg', 'shadow-popover', 'shadow-modal']
const COUNTRIES = ['Australia', 'Brazil', 'Canada', 'Denmark', 'Egypt', 'France', 'Ghana', 'India', 'Japan', 'Kenya', 'Mexico']
const ROWS = [
  { id: 'a', name: 'Northwind Traders', status: 'active', total: 12840 },
  { id: 'b', name: 'Contoso Supply', status: 'pending', total: 4210 },
  { id: 'c', name: 'Fabrikam Freight', status: 'failed', total: 980 },
]

function Swatch({ token }: { token: string }) {
  const [hex, setHex] = useState('')
  useEffect(() => {
    setHex(getComputedStyle(document.documentElement).getPropertyValue(`--${token}`).trim())
  }, [token])
  const ok = /^#[0-9a-f]{6}$/i.test(hex)
  const onWhite = ok ? contrast(hex, '#FFFFFF') : 0
  const onInk = ok ? contrast(hex, '#1D1729') : 0
  /* The label on the chip is whichever of white or ink reads better. */
  const label = onWhite >= onInk ? 'var(--surface)' : 'var(--ink-800)'
  return (
    <div className="ds__swatch">
      <div className="ds__chip" style={{ background: `var(--${token})`, color: label }}>Aa</div>
      <div className="ds__swatch-meta">
        <span className="ds__swatch-name">--{token}</span>
        <code>{hex || '…'}</code>
        {ok && <div>{onWhite.toFixed(2)}:1 as text on white · {onInk.toFixed(2)}:1 on ink</div>}
      </div>
    </div>
  )
}

export function DesignSystemPage() {
  const [tab, setTab] = useState('one')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const [selected, setSelected] = useState('b')
  const [checked, setChecked] = useState(true)
  const [radio, setRadio] = useState('a')
  const [toggle, setToggle] = useState(true)
  const [dialog, setDialog] = useState(false)
  const [modal, setModal] = useState(false)
  const [drawer, setDrawer] = useState(false)
  const [loading, setLoading] = useState(false)
  const rows = [...ROWS].sort((x, y) => (sortDir === 'asc' ? 1 : -1) * x.name.localeCompare(y.name))
  const money = (n: number) => `$${n.toLocaleString('en-US')}`

  useEffect(() => { document.title = 'Design system' }, [])

  return (
    <main className="ds">
      <h1>Design system</h1>
      <p className="ds__lead">Tokens and shared components as they render today. Reuse before inventing: if it is not here, check <code>src/components/ui</code> and <code>operator/shared.tsx</code> first.</p>

      <section className="ds__section" aria-labelledby="ds-colour">
        <h2 id="ds-colour">Colour</h2>
        <div className="ds__swatches">{COLOUR_TOKENS.map(t => <Swatch key={t} token={t} />)}</div>
      </section>

      <section className="ds__section" aria-labelledby="ds-type">
        <h2 id="ds-type">Type scale</h2>
        <div className="ds__type">
          {TYPE_SCALE.map(t => (
            <div key={t.name} style={{ fontSize: t.size, fontWeight: t.weight as number }}>{t.name} <span style={{ fontSize: 'var(--fs-meta)', fontWeight: 400, color: 'var(--text-secondary)' }}>{t.note}</span></div>
          ))}
          <div style={{ fontSize: 'var(--fs-kpi)', fontWeight: 'var(--fw-kpi)', fontVariantNumeric: 'var(--nums)' }}>KPI 1,234,567.89 <span style={{ fontSize: 'var(--fs-meta)', fontWeight: 400, color: 'var(--text-secondary)' }}>24 / 650 tabular</span></div>
        </div>
      </section>

      <section className="ds__section" aria-labelledby="ds-space">
        <h2 id="ds-space">Spacing, radius and shadow</h2>
        <h3>Spacing</h3>
        <div className="ds__stack">
          {SPACES.map(s => (
            <div key={s} className="ds__row"><code style={{ width: 96 }}>--{s}</code><div className="ds__space" style={{ width: `var(--${s})` }} /></div>
          ))}
        </div>
        <h3>Radius</h3>
        <div className="ds__row">{RADII.map(r => <div key={r} className="ds__box" style={{ borderRadius: `var(--${r})` }}>{r}</div>)}</div>
        <h3>Shadow</h3>
        <div className="ds__row">{SHADOWS.map(s => <div key={s} className="ds__box" style={{ boxShadow: `var(--${s})`, border: 'none' }}>{s}</div>)}</div>
      </section>

      <section className="ds__section" aria-labelledby="ds-buttons">
        <h2 id="ds-buttons">Buttons</h2>
        <div className="ds__row">
          {(['primary', 'secondary', 'tertiary', 'danger', 'success', 'accent'] as const).map(v => <Btn key={v} variant={v}>{v}</Btn>)}
        </div>
        <h3>Small</h3>
        <div className="ds__row">
          {(['primary', 'secondary', 'tertiary', 'danger'] as const).map(v => <Btn key={v} variant={v} size="sm">{v}</Btn>)}
        </div>
        <h3>Icon, loading, disabled</h3>
        <div className="ds__row">
          <Btn variant="secondary" icon aria-label="Search"><Search size={16} aria-hidden /></Btn>
          <Btn loading={loading} onClick={() => { setLoading(true); window.setTimeout(() => setLoading(false), 1500) }}>{loading ? 'Saving' : 'Click to load'}</Btn>
          <Btn disabled>Disabled</Btn>
          <Btn variant="secondary" disabled>Disabled</Btn>
        </div>
      </section>

      <section className="ds__section" aria-labelledby="ds-inputs">
        <h2 id="ds-inputs">Inputs</h2>
        <div className="ds__grid">
          <FormField label="Default"><TextInput placeholder="Type here" /></FormField>
          <FormField label="With hint" hint="Tab into this field to see the focus ring."><TextInput defaultValue="Focus me" /></FormField>
          <div>
            <FormField label="With error" required>
              <TextInput defaultValue="not-an-email" aria-invalid="true" aria-describedby="ds-err" />
            </FormField>
            <p id="ds-err" role="alert" style={{ color: 'var(--danger)', fontSize: 'var(--fs-meta)', margin: 'var(--space-1) 0 0' }}>Enter a valid email address.</p>
          </div>
          <FormField label="Search">
            <span style={{ position: 'relative', display: 'block' }}>
              <Search size={16} aria-hidden style={{ position: 'absolute', left: 12, top: 12, color: 'var(--text-tertiary)' }} />
              <TextInput placeholder="Search accounts" style={{ paddingLeft: 36 }} />
            </span>
          </FormField>
          <FormField label="Disabled"><TextInput disabled defaultValue="Read only" /></FormField>
          <FormField label="Notes"><TextArea rows={3} placeholder="A longer note" /></FormField>
        </div>
      </section>

      <section className="ds__section" aria-labelledby="ds-dropdown">
        <h2 id="ds-dropdown">Dropdown</h2>
        <div className="ds__grid">
          <FormField label="Short list"><Select defaultValue="b"><option value="a">Alpha</option><option value="b">Bravo</option><option value="c">Charlie</option></Select></FormField>
          <FormField label="More than eight options (search)">
            <Dropdown defaultValue="">
              <option value="">Choose a country</option>
              {COUNTRIES.map(c => <option key={c} value={c}>{c}</option>)}
            </Dropdown>
          </FormField>
          <FormField label="Disabled"><Select disabled defaultValue="a"><option value="a">Alpha</option></Select></FormField>
        </div>
      </section>

      <section className="ds__section" aria-labelledby="ds-choice">
        <h2 id="ds-choice">Checkbox, radio and toggle</h2>
        <div className="ds__row">
          <label className="ds__row"><input type="checkbox" checked={checked} onChange={e => setChecked(e.target.checked)} /> Checkbox</label>
          <label className="ds__row"><input type="checkbox" disabled /> Disabled</label>
          <label className="ds__row"><input type="radio" name="ds-r" checked={radio === 'a'} onChange={() => setRadio('a')} /> Radio A</label>
          <label className="ds__row"><input type="radio" name="ds-r" checked={radio === 'b'} onChange={() => setRadio('b')} /> Radio B</label>
          <Toggle checked={toggle} onChange={setToggle} label="Toggle" />
          <Toggle checked={false} onChange={() => undefined} label="Disabled toggle" disabled />
          <Spinner size={20} label="Loading" />
        </div>
      </section>

      <section className="ds__section" aria-labelledby="ds-tabs">
        <h2 id="ds-tabs">Tabs</h2>
        <Tabs ariaLabel="Demo tabs" value={tab} onChange={setTab} panelIdPrefix="ds-panel-"
          tabs={[{ id: 'one', label: 'Overview' }, { id: 'two', label: 'Activity', count: 4 }, { id: 'three', label: 'Locked', disabled: true }]} />
        <div className="ds__panel" id={`ds-panel-${tab}`} role="tabpanel">Showing the {tab} panel.</div>
      </section>

      <section className="ds__section" aria-labelledby="ds-table">
        <h2 id="ds-table">Table</h2>
        <Table headers={[
          { label: 'Account', sort: { active: true, dir: sortDir, onSort: () => setSortDir(d => (d === 'asc' ? 'desc' : 'asc')) } },
          'Status', { label: 'Total', align: 'right' }, 'Action']}>
          {rows.map(r => (
            <TableRow key={r.id} selected={selected === r.id} onClick={() => setSelected(r.id)}>
              <Td>{r.name}</Td>
              <Td><StatusPill status={r.status} /></Td>
              <Td right>{money(r.total)}</Td>
              <Td><Btn variant="tertiary" size="sm" onClick={e => { e.stopPropagation(); toast(`Opened ${r.name}`, 'info') }}>View</Btn></Td>
            </TableRow>
          ))}
        </Table>
      </section>

      <section className="ds__section" aria-labelledby="ds-status">
        <h2 id="ds-status">Status</h2>
        <div className="ds__row">
          {(['success', 'warning', 'danger', 'info', 'neutral'] as const).map(t => <StatusBadge key={t} tone={t}>{t}</StatusBadge>)}
          <StatusBadge tone="info" icon={null}>No dot</StatusBadge>
        </div>
      </section>

      <section className="ds__section" aria-labelledby="ds-kpi">
        <h2 id="ds-kpi">KPI</h2>
        <div className="ds__grid">
          <KpiCard variant="money" label="Revenue" unit="USD" value="$128,400" delta={{ text: '+8.2% vs last month', direction: 'up' }} context="Settled this month" series={[4, 6, 5, 8, 7, 10, 12]} />
          <KpiCard variant="ops" label="Open tickets" value="23" delta={{ text: 'No change', direction: 'flat' }} context="Across all queues" />
          <KpiCard variant="risk" label="Overdue invoices" value="7" delta={{ text: '+2 this week', direction: 'down' }} context="Needs follow-up" />
        </div>
      </section>

      <section className="ds__section" aria-labelledby="ds-callout">
        <h2 id="ds-callout">Callouts</h2>
        <div className="ds__stack">
          <Callout tone="info" title="Info">A neutral heads-up.</Callout>
          <Callout tone="success" title="Success">That worked.</Callout>
          <Callout tone="warning" title="Warning">Check this before continuing.</Callout>
          <Callout tone="danger" title="Danger">Something needs fixing.</Callout>
        </div>
      </section>

      <section className="ds__section" aria-labelledby="ds-overlays">
        <h2 id="ds-overlays">Toast, dialog and drawer</h2>
        <div className="ds__row">
          <Btn variant="secondary" onClick={() => toast('Saved', 'success')}>Success toast</Btn>
          <Btn variant="secondary" onClick={() => toast('Something went wrong', 'error')}>Error toast</Btn>
          <Btn variant="secondary" onClick={() => toast('For your information', 'info')}>Info toast</Btn>
          <Btn variant="secondary" onClick={() => setDialog(true)}>Open dialog</Btn>
          <Btn variant="secondary" onClick={() => setModal(true)}>Open modal</Btn>
          <Btn variant="secondary" onClick={() => setDrawer(true)}>Open drawer</Btn>
        </div>
        <Dialog open={dialog} onClose={() => setDialog(false)} title="Dialog title" footer={<Btn onClick={() => setDialog(false)}>Done</Btn>}>
          A shared dialog with a focus trap. Escape closes it.
        </Dialog>
        <Modal open={modal} onClose={() => setModal(false)} title="Modal title" footer={<Btn onClick={() => setModal(false)}>Done</Btn>}>
          The console modal, built on Dialog.
        </Modal>
        <Drawer open={drawer} onClose={() => setDrawer(false)} title="Drawer title" description="A right-hand panel." footer={<Btn onClick={() => setDrawer(false)}>Close</Btn>}>
          Drawer body content.
        </Drawer>
      </section>

      <section className="ds__section" aria-labelledby="ds-loading">
        <h2 id="ds-loading">Skeleton and empty state</h2>
        <div className="ds__grid">
          <div className="ds__card"><Skeleton lines={3} /></div>
          <div className="ds__card"><Skeleton block height={96} /></div>
          <div className="ds__card"><EmptyState title="Nothing here yet" message="Items you add will show up in this list." action={<Btn size="sm">Add an item</Btn>} /></div>
        </div>
      </section>
      <ToastHost />
    </main>
  )
}
