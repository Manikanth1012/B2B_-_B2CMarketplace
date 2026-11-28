import { useEffect, useState } from 'react'
import { Download, Pencil, Search } from 'lucide-react'
import { Btn, DateRangeFilter, EmptyState, FieldRow, FilterBar, FormField, Id, Modal, PageHeader, RowActions, Select, StatusPill, Table, TableRow, Td, TextArea, TextInput, ToastHost, daysBefore, isoDay, toast } from './operator/shared'
import { Callout } from './OnboardingJourney'
import { Dialog, Drawer, Dropdown, KpiCard, KpiRow, Skeleton, Spinner, StatusBadge, Tabs, Toggle } from './ui'
import { AreaChart, BarChart, ColumnChart, DonutChart, LineChart, Sparkline, categoryColour, compactNumber } from './ui/charts'
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
const CHART_TOKENS = ['chart-1', 'chart-2', 'chart-3', 'chart-4', 'chart-5', 'chart-6']
const MONTHS = ['Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov']
const MARKETS = [
  { key: 'consumer', label: 'Consumer', orders: 1061, gross: 109510, commission: 9331 },
  { key: 'partner', label: 'Partner', orders: 40, gross: 49180, commission: 4576 },
  { key: 'iot', label: 'IoT', orders: 188, gross: 196720, commission: 18384 },
  { key: 'security', label: 'Security', orders: 115, gross: 156847, commission: 14612 },
  { key: 'device', label: 'Device', orders: 401, gross: 167486, commission: 15528 },
  { key: 'content', label: 'Content', orders: 795, gross: 31363, commission: 3871 },
]
const LOG = [
  { id: 'INV-2026-0779', account: 'Northwind Traders', period: 'Oct 2026', status: 'paid', date: '02 Nov 2026', total: 41871.56, note: 'Settled in two parts after the September dispute was closed in the seller\'s favour.' },
  { id: 'INV-2026-0781', account: 'Contoso Supply', period: 'Oct 2026', status: 'pending', date: '04 Nov 2026', total: 980.0, note: 'Waiting for the purchase order number.' },
]
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
  const [q, setQ] = useState('')
  const [jobStatus, setJobStatus] = useState('all')
  const [failuresOnly, setFailuresOnly] = useState(false)
  const today = isoDay(new Date())
  const [range, setRange] = useState({ from: daysBefore(today, 13), to: today })
  const [unit, setUnit] = useState('')
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
          <KpiCard variant="ops" label="Open tickets" value="23" tone="warning" delta={{ text: 'No change', direction: 'flat' }} context="Across all queues" />
          <KpiCard variant="risk" label="Overdue invoices" value="7" delta={{ text: '+2 this week', direction: 'down' }} context="Needs follow-up" />
        </div>
      </section>


      <section className="ds__section" aria-labelledby="ds-pagehead">
        <h2 id="ds-pagehead">Page header</h2>
        <div className="ds__card">
          <PageHeader level={2} title="Settlement statements" description="What each seller is owed for a period, and what has been paid."
            actions={<><Btn variant="secondary"><Download size={16} aria-hidden /> Export</Btn><Btn>New statement</Btn></>} />
        </div>
      </section>

      <section className="ds__section" aria-labelledby="ds-tdkinds">
        <h2 id="ds-tdkinds">Table cells and row actions</h2>
        <p className="ds__lead">Only figures are right-aligned (<code>kind="num"</code> or <code>right</code>); ids, statuses and dates are left and never wrap; names clamp to two lines with the whole text on hover. The actions column has a hidden heading; past two actions the rest go under More.</p>
        <Table headers={['Statement', 'Account', 'Period', 'Status', 'Issued', 'Total', 'Note', 'Actions']}>
          {LOG.map(r => (
            <tr key={r.id}>
              <Td kind="id"><Id>{r.id}</Id></Td>
              <Td clamp>{r.account}</Td>
              <Td kind="date">{r.period}</Td>
              <Td kind="status"><StatusPill status={r.status} /></Td>
              <Td kind="date">{r.date}</Td>
              <Td kind="num">{money(r.total)}</Td>
              <Td clamp>{r.note}</Td>
              <Td>
                <RowActions label={r.id} actions={[
                  { label: 'View', onClick: () => toast(`Opened ${r.id}`, 'info') },
                  { label: 'Edit', icon: <Pencil size={14} aria-hidden />, onClick: () => toast(`Editing ${r.id}`, 'info') },
                  { label: 'Download PDF', onClick: () => toast('Downloaded', 'success') },
                  { label: 'Void', variant: 'danger', onClick: () => toast(`Voided ${r.id}`, 'error') },
                ]} />
              </Td>
            </tr>
          ))}
        </Table>
      </section>

      <section className="ds__section" aria-labelledby="ds-filterbar">
        <h2 id="ds-filterbar">Filter bar</h2>
        <FilterBar search={{ value: q, onChange: setQ, placeholder: 'Search jobs', ariaLabel: 'Search jobs' }}
          summary={`14 nights and 140 runs match${q ? ` "${q}"` : ''}`}
          actions={<Btn variant="secondary">Export</Btn>}>
          <Select aria-label="Status" value={jobStatus} onChange={e => setJobStatus(e.target.value)}>
            <option value="all">All statuses</option><option value="ok">OK</option><option value="failed">Failed</option>
          </Select>
          <Toggle checked={failuresOnly} onChange={setFailuresOnly} label="Failures only" />
        </FilterBar>
        <h3>Date range</h3>
        <FilterBar>
          <DateRangeFilter from={range.from} to={range.to} onChange={setRange} today={today} quickLabel={n => `${n} nights`} />
        </FilterBar>
      </section>

      <section className="ds__section" aria-labelledby="ds-fieldrow">
        <h2 id="ds-fieldrow">Field row</h2>
        <p className="ds__lead">A field and its buttons on one line: the buttons sit on the input at 40px, even when written <code>size="sm"</code>.</p>
        <FieldRow>
          <FormField label="Search"><TextInput value={unit} onChange={e => setUnit(e.target.value)} placeholder="A serial, an order or a customer" /></FormField>
          <Btn size="sm"><Search size={14} aria-hidden /> Search</Btn>
          <Btn variant="secondary" size="sm" onClick={() => setUnit('')}>Clear</Btn>
        </FieldRow>
        <h3>Compact field</h3>
        <div className="ds__field"><FormField compact label="No bottom margin"><TextInput placeholder="Compact" /></FormField></div>
      </section>

      <section className="ds__section" aria-labelledby="ds-kpirow">
        <h2 id="ds-kpirow">KPI row with breakdown</h2>
        <KpiRow label="Credit">
          <KpiCard variant="money" label="Owed and committed" unit="USD" value="$412,880" breakdown={[{ label: 'EUR', value: '€86,140' }, { label: 'GBP', value: '£12,400' }, { label: 'INR', value: '₹1,240,000' }]} context="Across 38 accounts" />
          <KpiCard variant="ops" label="Applications" value="12" status="3 need a decision today" context="Last 30 days" />
          <KpiCard variant="money" label="Customer money held" unit="USD" value="$18,200" tone="danger" status="Refundable on request" />
          <KpiCard variant="risk" label="Overdue invoices" value="7" status="2 over 60 days" delta={{ text: '+2 this week', direction: 'down' }} context="Needs follow-up" />
          <KpiCard label="Orders" value="2,600" delta={{ text: '+4% vs last month', direction: 'up' }} context="All marketplaces" series={[12, 14, 13, 17, 16, 19, 21]} />
        </KpiRow>
      </section>

      <section className="ds__section" aria-labelledby="ds-charts">
        <h2 id="ds-charts">Charts</h2>
        <p className="ds__lead">Six categorical slots from the tokens; a marketplace always takes the same one (<code>categoryColour(key)</code>). Each slot is at least 3:1 against white and canvas, the floor for a non-text mark. One unit per axis; a legend only when more than one series shares a plot.</p>
        <div className="ds__swatches">{CHART_TOKENS.map(t => <Swatch key={t} token={t} />)}</div>
        <div className="ds__charts">
          <div className="ds__card">
            <ColumnChart caption="Gross value by month" label="Gross merchandise value by month" yLabel="Gross value"
              data={MONTHS.map((m, i) => ({ label: m, value: [61200, 70400, 66800, 82100, 79600, 91300][i], muted: i < 2, note: i < 2 ? 'monthly aggregate' : undefined }))} />
          </div>
          <div className="ds__card">
            <BarChart caption="Commission by marketplace" label="Commission by marketplace, ranked" share
              data={MARKETS.map(m => ({ label: m.label, value: m.commission, key: m.key }))} />
          </div>
          <div className="ds__card">
            <ColumnChart caption="Orders by marketplace" label="Orders by marketplace" yLabel="Orders" format={n => n.toLocaleString('en-US')} tickFormat={compactNumber}
              data={MARKETS.map(m => ({ label: m.label, value: m.orders, key: m.key }))} />
          </div>
          <div className="ds__card">
            <LineChart caption="Orders and returns" label="Orders and returns by month" yLabel="Orders" labels={MONTHS} format={n => n.toLocaleString('en-US')}
              series={[{ key: 'orders', label: 'Orders', values: [380, 402, 395, 441, 430, 468] }, { key: 'returns', label: 'Returns', values: [22, 25, 19, null, 27, 24] }]} />
          </div>
          <div className="ds__card">
            <AreaChart caption="Gross value trend" label="Gross value trend by month" labels={MONTHS}
              series={[{ key: 'gross', label: 'Gross value', values: [61200, 70400, 66800, 82100, 79600, 91300] }]} />
          </div>
          <div className="ds__card">
            <DonutChart caption="Seller tiers" label="Sellers by tier" centre="64" centreSub="sellers" format={n => `${n}`}
              data={[{ label: 'Gold', value: 9, colour: categoryColour('gold') }, { label: 'Silver', value: 21, key: 'silver' }, { label: 'Bronze', value: 34, key: 'bronze' }]} />
          </div>
          <div className="ds__card">
            <h3>Sparkline</h3>
            <div className="ds__spark"><Sparkline values={[4, 6, 5, 8, 7, 10, 12]} label="Up from 4 to 12 over seven months" /></div>
          </div>
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
