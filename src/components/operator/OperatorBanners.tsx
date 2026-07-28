import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import type { OperatorBanner } from '../../types'
import { SectionCard, Table, Td, StatusPill, EmptyState, fmtInt, fmtMoney } from './shared'

export function OperatorBanners() {
  const [banners, setBanners] = useState<OperatorBanner[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.from('operator_banners').select('*').order('sort_order').then(({ data }) => {
      if (data) setBanners(data as OperatorBanner[])
      setLoading(false)
    })
  }, [])

  if (loading) return <div style={{ textAlign: 'center', padding: '40px' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>

  const totalImpressions = banners.reduce((s, b) => s + b.impressions, 0)
  const totalClicks = banners.reduce((s, b) => s + b.clicks, 0)
  const totalRevenue = banners.reduce((s, b) => s + b.revenue, 0)
  const ctr = totalImpressions > 0 ? (totalClicks / totalImpressions * 100).toFixed(2) : '0'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div>
        <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 800, color: 'var(--text)' }}>Storefront Banners</h1>
        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)', marginTop: '4px' }}>
          {banners.length} banners · {fmtInt(totalImpressions)} impressions · {ctr}% CTR · ${fmtMoney(totalRevenue)} attributed revenue
        </p>
      </div>

      <SectionCard title="Banner Slots" subtitle="Login · Storefront hero · Storefront strip · Category header. Sellers cannot buy placement.">
        {banners.length === 0 ? <EmptyState message="No banners configured" /> : (
          <Table headers={['Slot', 'Title', 'Audience', 'Region', 'Weight', 'Impressions', 'Clicks', 'CTR', 'Revenue', 'Status']}>
            {banners.map(b => {
              const ctr = b.impressions > 0 ? (b.clicks / b.impressions * 100).toFixed(2) : '0'
              return (
                <tr key={b.id}>
                  <Td>{b.slot}</Td>
                  <Td>{b.title}</Td>
                  <Td right>{b.audience}</Td>
                  <Td right>{b.region}</Td>
                  <Td right>{b.weight}</Td>
                  <Td right>{fmtInt(b.impressions)}</Td>
                  <Td right>{fmtInt(b.clicks)}</Td>
                  <Td right>{ctr}%</Td>
                  <Td right>${fmtMoney(b.revenue)}</Td>
                  <Td right><StatusPill status={b.status} /></Td>
                </tr>
              )
            })}
          </Table>
        )}
      </SectionCard>
    </div>
  )
}
