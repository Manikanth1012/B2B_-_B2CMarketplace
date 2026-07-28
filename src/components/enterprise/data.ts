// Enterprise buyer demo data — SmartBuild Ltd

export const ENTERPRISE_PROFILE = {
  id: 'ENT-2007',
  company: 'SmartBuild Ltd',
  contact: 'Vikram Shah',
  approver: 'Meera Iyer (CFO)',
  sites: 4,
  staff: 320,
  terms: 'Net 30 · contract pricing on most lines',
  budgetYear: 480000,
  budgetSpent: 298400,
}

export const ENTERPRISE_SUBS = [
  { id: 'SUB-01', sku: 'SKU-6002', name: 'Sentinel MDR Service', seller: 'Sentinel Cyber', v: 'security', qty: 620, seatsUsed: 555, seatsTotal: 620, monthly: 12400, price: 20, unit: 'per endpoint/mo', renews: '31 Dec 2026', status: 'active' },
  { id: 'SUB-02', sku: 'SKU-6004', name: 'Vertex Endpoint Protect', seller: 'Vertex Security', v: 'security', qty: 120, seatsUsed: 0, seatsTotal: 120, monthly: 780, price: 6.5, unit: 'per endpoint/mo', renews: '30 Sep 2026', status: 'suspended' },
  { id: 'SUB-03', sku: 'SKU-6006', name: 'CloudZTNA Zero Trust Access', seller: 'CloudPath', v: 'security', qty: 280, seatsUsed: 240, seatsTotal: 280, monthly: 4200, price: 15, unit: 'per user/mo', renews: '31 Mar 2027', status: 'active' },
  { id: 'SUB-04', sku: 'SKU-3001', name: '6D Connect IoT SIM 100-pack', seller: '6D Telecom', v: 'iot', qty: 100, seatsUsed: 87, seatsTotal: 100, monthly: 900, price: 9, unit: 'per SIM/mo', renews: '31 Dec 2026', status: 'active' },
  { id: 'SUB-05', sku: 'SKU-3003', name: 'Nimbus Air Quality Monitor (sub)', seller: 'Nimbus Sensors', v: 'iot', qty: 25, seatsUsed: 19, seatsTotal: 25, monthly: 375, price: 15, unit: 'per sensor/mo', renews: '31 May 2027', status: 'active' },
]

export const ENTERPRISE_ORDERS = [
  { id: 'ORD-880519', name: 'Cold-Chain Starter Bundle', seller: 'Nimbus Sensors', v: 'iot', qty: 25, gross: 14975, placed: '24 Jul 2026', stage: 2, stages: ['Placed', 'Packed', 'In transit', 'Delivered'], failed: false },
  { id: 'ORD-880487', name: 'Nimbus Air Quality Sensor', seller: 'Nimbus Sensors', v: 'iot', qty: 3, gross: 567, placed: '20 Jul 2026', stage: 3, stages: ['Placed', 'Packed', 'In transit', 'Delivered'], failed: false },
  { id: 'ORD-880445', name: 'Nimbus Occupancy Sensor', seller: 'Nimbus Sensors', v: 'iot', qty: 12, gross: 1740, placed: '19 Jul 2026', stage: 1, stages: ['Placed', 'Packed', 'In transit', 'Delivered'], failed: false },
  { id: 'ORD-880401', name: 'Sentinel MDR Service', seller: 'Sentinel Cyber', v: 'security', qty: 50, gross: 1000, placed: '15 Jul 2026', stage: 3, stages: ['Placed', 'Provisioned', 'Active', 'Delivered'], failed: false },
  { id: 'ORD-880388', name: 'Nimbus Air Quality Sensor', seller: 'Nimbus Sensors', v: 'iot', qty: 50, gross: 9450, placed: '12 Jul 2026', stage: 3, stages: ['Placed', 'Packed', 'In transit', 'Delivered'], failed: true },
]

export const ENTERPRISE_APPROVALS = [
  { id: 'REQ-301', item: 'CloudZTNA seat expansion (50 seats)', sku: 'SKU-6006', v: 'security', requester: 'Vikram Shah', raised: '26 Jul 2026', amount: 750, need: 'IT sign-off', reason: 'New Pune site needs zero-trust access for 50 additional staff starting August', policy: 'Security purchase — IT sign-off required regardless of value' },
  { id: 'REQ-302', item: 'Nimbus Cold-Chain Bundle (10 units)', sku: 'SKU-NB-CC1', v: 'iot', requester: 'Anita Rao', raised: '25 Jul 2026', amount: 5990, need: 'Finance approval', reason: 'Mumbai depot expansion — need 10 cold-chain monitoring kits for the new cold storage facility', policy: 'Above $2,000 threshold — finance approval required' },
  { id: 'REQ-303', item: '6D Connect SIM 100-pack (annual)', sku: 'SKU-3001', v: 'iot', requester: 'Vikram Shah', raised: '24 Jul 2026', amount: 10800, need: 'Finance approval', reason: 'Annual renewal with 100 additional SIMs for fleet tracking expansion', policy: 'Above $2,000 threshold — finance approval required' },
]

export const ENTERPRISE_CATALOGUE = [
  { id: 'SKU-3001', name: '6D Connect IoT SIM 100-pack', cat: 'IoT SIM plans', v: 'iot', price: 900, model: 'monthly', seller: '6D Telecom', rating: 4.2, reviews: 45, stock: 'in', desc: '100 IoT SIMs with shared data pool, NB-IoT and LTE-M', status: 'live' },
  { id: 'SKU-3002', name: 'Nimbus Air Quality Sensor', cat: 'Sensors', v: 'iot', price: 189, model: 'oneoff', seller: 'Nimbus Sensors', rating: 4.5, reviews: 128, stock: 'in', desc: 'Indoor air quality monitor with PM2.5, CO2 and VOC', status: 'live' },
  { id: 'SKU-3003', name: 'Nimbus Occupancy Sensor', cat: 'Sensors', v: 'iot', price: 145, model: 'oneoff', seller: 'Nimbus Sensors', rating: 4.7, reviews: 84, stock: 'in', desc: 'PIR-based occupancy detection with LoRaWAN', status: 'live' },
  { id: 'SKU-3004', name: 'Nimbus Cold-Chain Starter Bundle', cat: 'Bundles', v: 'iot', price: 599, model: 'oneoff', seller: 'Nimbus Sensors', rating: 4.8, reviews: 56, stock: 'low', desc: '5 sensors + gateway + dashboard, cold-chain monitoring kit', status: 'live' },
  { id: 'SKU-6001', name: 'Sentinel Managed Firewall', cat: 'Managed firewall', v: 'security', price: 450, model: 'monthly', seller: 'Sentinel Cyber', rating: 4.3, reviews: 32, stock: 'in', desc: 'Next-gen firewall with 24/7 SOC monitoring', status: 'live' },
  { id: 'SKU-6002', name: 'Sentinel MDR Service', cat: 'MDR', v: 'security', price: 20, model: 'monthly', seller: 'Sentinel Cyber', rating: 4.6, reviews: 67, stock: 'in', desc: 'Managed detection and response per endpoint', status: 'live' },
  { id: 'SKU-6003', name: 'Vertex Endpoint Protect', cat: 'Endpoint', v: 'security', price: 6.5, model: 'monthly', seller: 'Vertex Security', rating: 3.8, reviews: 41, stock: 'out', desc: 'EDR with automated threat response', status: 'live' },
  { id: 'SKU-6004', name: 'CloudZTNA Zero Trust Access', cat: 'VPN / ZTNA', v: 'security', price: 15, model: 'monthly', seller: 'CloudPath', rating: 4.4, reviews: 28, stock: 'in', desc: 'Zero-trust network access per user per month', status: 'live' },
  { id: 'SKU-7001', name: 'Aventa Business Router Pro', cat: 'Routers', v: 'device', price: 320, model: 'oneoff', seller: 'Aventa', rating: 4.5, reviews: 90, stock: 'in', desc: 'Dual-WAN business router with 5G fallback', status: 'live' },
  { id: 'SKU-7002', name: 'Aventa Field Tablet 10"', cat: 'Tablets', v: 'device', price: 449, model: 'oneoff', seller: 'Aventa', rating: 4.2, reviews: 55, stock: 'in', desc: 'Rugged 10-inch tablet for field teams', status: 'live' },
  { id: 'SKU-7003', name: 'Aventa CPE Mini', cat: 'CPE', v: 'device', price: 89, model: 'oneoff', seller: 'Aventa', rating: 4.0, reviews: 120, stock: 'in', desc: 'Compact customer premises equipment', status: 'live' },
  { id: 'SKU-7004', name: 'Aventa Desk Phone', cat: 'Phones', v: 'device', price: 129, model: 'oneoff', seller: 'Aventa', rating: 4.3, reviews: 75, stock: 'in', desc: 'VoIP desk phone with colour display', status: 'live' },
]

export const APPROVAL_POLICY = {
  threshold: 2000,
  securitySignOff: true,
}

export const VERTICAL_NAMES: Record<string, string> = {
  iot: 'IoT Marketplace',
  security: 'Security Marketplace',
  device: 'Device Marketplace',
  consumer: 'Consumer Marketplace',
  content: 'Content Marketplace',
}
