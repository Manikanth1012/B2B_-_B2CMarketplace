// Static demo data for the Partner persona — Nimbus Sensors
// Mirrors the prototype's PMAP['PTR-1004'] partner

/* Kept in step with the `partners` row it names. It had drifted badly — India
   for a company registered in Munich, Gold for a Silver-tier seller, and
   Security for a marketplace they have only applied to — and every screen that
   read it repeated the drift. Screens that can read the database now do; this
   is what is left for the two that cannot yet. */
export const PARTNER_PROFILE = {
  id: 'PTR-1004',
  name: 'Nimbus Sensors',
  contact: 'Rajesh Kumar',
  tier: 'Silver',
  joined: 'Sep 2024',
  rating: 4.6,
  country: 'Germany',
  verticals: ['iot', 'device'] as string[],
  status: 'active',
}

export const PARTNER_LISTINGS = [
  { id: 'SKU-NB-AQ1', name: 'Nimbus Air Quality Sensor', cat: 'Sensors', v: 'iot', price: 189, model: 'oneoff', comm: 12, rating: 4.5, reviews: 128, stock: 'in', status: 'live', listed: '15 Sep 2024' },
  { id: 'SKU-NB-OC1', name: 'Nimbus Occupancy Sensor', cat: 'Sensors', v: 'iot', price: 145, model: 'oneoff', comm: 12, rating: 4.7, reviews: 84, stock: 'in', status: 'live', listed: '15 Sep 2024' },
  { id: 'SKU-NB-CC1', name: 'Cold-Chain Starter Bundle', cat: 'Bundles', v: 'iot', price: 599, model: 'oneoff', comm: 12, rating: 4.8, reviews: 56, stock: 'low', status: 'live', listed: '02 Oct 2024' },
  { id: 'SKU-NB-VPN1', name: 'Nimbus VPN Gateway', cat: 'Security', v: 'security', price: 29, model: 'monthly', comm: 18, rating: null, reviews: 0, stock: 'in', status: 'pending', listed: '22 Jul 2026' },
  { id: 'SKU-NB-MDR1', name: 'Nimbus MDR Service', cat: 'Security', v: 'security', price: 49, model: 'monthly', comm: 18, rating: null, reviews: 0, stock: 'in', status: 'pending', listed: '22 Jul 2026' },
]

export const PARTNER_ORDERS = [
  { id: 'ORD-880519', name: 'Cold-Chain Starter Bundle', buyer: 'Aventa Communications', buyerType: 'Enterprise', qty: 25, gross: 14975, comm: 1797, stage: 2, stages: ['Placed', 'Packed', 'In transit', 'Delivered'], placed: '24 Jul 2026', v: 'iot', channel: 'Direct', failed: false },
  { id: 'ORD-880487', name: 'Nimbus Air Quality Sensor', buyer: 'Priya Raman', buyerType: 'Consumer', qty: 3, gross: 567, comm: 68, stage: 3, stages: ['Placed', 'Packed', 'In transit', 'Delivered'], placed: '20 Jul 2026', v: 'iot', channel: 'Marketplace', failed: false },
  { id: 'ORD-880445', name: 'Nimbus Occupancy Sensor', buyer: 'SmartBuild Ltd', buyerType: 'Enterprise', qty: 12, gross: 1740, comm: 209, stage: 1, stages: ['Placed', 'Packed', 'In transit', 'Delivered'], placed: '19 Jul 2026', v: 'iot', channel: 'Direct', failed: false },
  { id: 'ORD-880401', name: 'Cold-Chain Starter Bundle', buyer: 'GlobalCold Logistics', buyerType: 'Enterprise', qty: 8, gross: 4792, comm: 575, stage: 0, stages: ['Placed', 'Packed', 'In transit', 'Delivered'], placed: '18 Jul 2026', v: 'iot', channel: 'Marketplace', failed: false },
  { id: 'ORD-880388', name: 'Nimbus Air Quality Sensor', buyer: 'GreenCity Corp', buyerType: 'Enterprise', qty: 50, gross: 9450, comm: 1134, stage: 3, stages: ['Placed', 'Packed', 'In transit', 'Delivered'], placed: '15 Jul 2026', v: 'iot', channel: 'Direct', failed: true },
]

export const PARTNER_SETTLEMENTS = [
  { id: 'STM-2026-07', period: 'Jul 2026', orders: 42, gross: 31424, commission: 3771, fees: 620, refunds: 0, net: 27033, status: 'pending', due: '15 Aug 2026', method: 'Bank transfer (USD)' },
  { id: 'STM-2026-06', period: 'Jun 2026', orders: 38, gross: 28190, commission: 3383, fees: 560, refunds: 189, net: 24058, status: 'paid', due: '15 Jul 2026', method: 'Bank transfer (USD)' },
  { id: 'STM-2026-05', period: 'May 2026', orders: 35, gross: 26745, commission: 3209, fees: 530, refunds: 0, net: 23006, status: 'paid', due: '15 Jun 2026', method: 'Bank transfer (USD)' },
  { id: 'STM-2026-04', period: 'Apr 2026', orders: 31, gross: 24180, commission: 2902, fees: 480, refunds: 0, net: 20798, status: 'paid', due: '15 May 2026', method: 'Bank transfer (USD)' },
]

export const PARTNER_PLAN = {
  id: 'CP-IOT-12',
  name: 'IoT Marketplace Standard',
  model: 'Tiered commission',
  base: 12,
  cycle: 'Monthly, 15th of month',
  hold: '14 days (returns window)',
  fees: '1.9% + $0.20 per order',
  tiers: [
    { from: 0, rate: 12 },
    { from: 50000, rate: 10 },
    { from: 150000, rate: 8 },
  ],
}

// Still consumed by PartnerDashboard.tsx and PartnerIntegrations.tsx (out of
// scope for this task). Left in place rather than deleted: those screens are
// not part of the shared onboarding record this task wires up, and removing
// their data would break unrelated, currently-working screens.
export const ONB_TASKS = [
  { id: 'OB-9101', step: 'tech', title: 'Publish a sandbox test order', detail: 'Place one end-to-end order in sandbox so fulfilment and settlement can be verified before go-live.', owner: 'You', due: 'In 2 days', status: 'pending' },
  { id: 'OB-9102', step: 'tech', title: 'Fulfilment webhook returning 500 on retry', detail: 'Three of five sandbox callbacks failed. Until the endpoint is stable, order status will not update automatically.', owner: 'You', due: 'Today', status: 'blocked' },
  { id: 'OB-9103', step: 'assure', title: 'Security questionnaire', detail: '42-question baseline covering data handling, retention and sub-processors.', owner: 'You', due: 'Not started', status: 'notstarted' },
  { id: 'OB-9104', step: 'agree', title: 'Security marketplace addendum signed', detail: 'Addendum to the master agreement extending your listing rights.', owner: 'Both', due: '—', status: 'done' },
  { id: 'OB-9105', step: 'finance', title: 'Settlement account reused', detail: 'Existing verified account carried over from your IoT onboarding.', owner: 'Marketplace', due: '—', status: 'done' },
]

export const PARTNER_ENDPOINTS = [
  { id: 'EP-01', name: 'Fulfilment Webhook', env: 'Sandbox', url: 'https://api.nimbus-sensors.example/fulfil/callback', method: 'POST', auth: 'HMAC-SHA256', retry: '3 attempts, exponential backoff', timeoutMs: 5000, enabled: true, health: 'failing', successRate: 40, events: ['order.created', 'order.cancelled'], note: '3 of 5 sandbox callbacks returned HTTP 500 on retry' },
  { id: 'EP-02', name: 'Stock Sync API', env: 'Sandbox', url: 'https://api.nimbus-sensors.example/stock/sync', method: 'GET', auth: 'Bearer token', retry: '2 attempts', timeoutMs: 3000, enabled: true, health: 'healthy', successRate: 100, events: ['stock.update'], note: '' },
  { id: 'EP-03', name: 'Catalogue Feed', env: 'Sandbox', url: 'https://api.nimbus-sensors.example/catalogue/feed', method: 'GET', auth: 'API key', retry: '1 attempt', timeoutMs: 10000, enabled: false, health: 'healthy', successRate: null, events: ['catalogue.sync'], note: '' },
]

export const PARTNER_DISPUTES = [
  { id: 'DSP-2201', reason: '3 of 25 sensors reported missing on delivery', order: 'ORD-880519', buyer: 'Aventa Communications', raised: '25 Jul 2026', amount: 1797, status: 'open', sla: 'Within SLA', owner: 'Partner', v: 'iot' },
]

export const VERTICAL_NAMES: Record<string, string> = {
  iot: 'IoT Marketplace',
  security: 'Security Marketplace',
  consumer: 'Consumer Marketplace',
  device: 'Device Marketplace',
  content: 'Content Marketplace',
}
