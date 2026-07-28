const PEXELS = 'https://images.pexels.com/photos'
const Q = '?auto=compress&cs=tinysrgb&w=600'
const Q_HERO = '?auto=compress&cs=tinysrgb&w=1280'

// Verified Pexels photo URLs — all return HTTP 200
export const PRODUCT_IMAGES: Record<string, string> = {
  // Consumer — mobile plans
  'SKU-2001': `${PEXELS}/47261/pexels-photo-47261.jpeg${Q}`,
  'SKU-2002': `${PEXELS}/4226140/pexels-photo-4226140.jpeg${Q}`,
  'SKU-2003': `${PEXELS}/5763034/pexels-photo-5763034.jpeg${Q}`,
  // Consumer — insurance
  'SKU-2004': `${PEXELS}/4370375/pexels-photo-4370375.jpeg${Q}`,
  'SKU-2005': `${PEXELS}/5380642/pexels-photo-5380642.jpeg${Q}`,
  // Consumer — bundles
  'SKU-2006': `${PEXELS}/3784221/pexels-photo-3784221.jpeg${Q}`,

  // Digital content — streaming
  'SKU-3001': `${PEXELS}/2881229/pexels-photo-2881229.jpeg${Q}`,
  'SKU-3002': `${PEXELS}/3165335/pexels-photo-3165335.jpeg${Q}`,
  // Gaming
  'SKU-3003': `${PEXELS}/4348404/pexels-photo-4348404.jpeg${Q}`,
  'SKU-3004': `${PEXELS}/1181271/pexels-photo-1181271.jpeg${Q}`,
  // Music
  'SKU-3005': `${PEXELS}/1334597/pexels-photo-1334597.jpeg${Q}`,
  'SKU-3006': `${PEXELS}/1647946/pexels-photo-1647946.jpeg${Q}`,
  // Cloud storage
  'SKU-3007': `${PEXELS}/5474028/pexels-photo-5474028.jpeg${Q}`,
  // Sports add-on
  'SKU-3008': `${PEXELS}/274506/pexels-photo-274506.jpeg${Q}`,

  // Devices — phones
  'SKU-4001': `${PEXELS}/699122/pexels-photo-699122.jpeg${Q}`,
  'SKU-4002': `${PEXELS}/47261/pexels-photo-47261.jpeg${Q}`,
  'SKU-4003': `${PEXELS}/356056/pexels-photo-356056.jpeg${Q}`,
  // Routers
  'SKU-4004': `${PEXELS}/4226140/pexels-photo-4226140.jpeg${Q}`,
  // CPE
  'SKU-4005': `${PEXELS}/3483098/pexels-photo-3483098.jpeg${Q}`,
  // Tablets
  'SKU-4006': `${PEXELS}/1334597/pexels-photo-1334597.jpeg${Q}`,
  // Wearables
  'SKU-4007': `${PEXELS}/4370375/pexels-photo-4370375.jpeg${Q}`,
  // Accessories
  'SKU-4008': `${PEXELS}/270404/pexels-photo-270404.jpeg${Q}`,

  // IoT — SIM plans
  'SKU-5001': `${PEXELS}/207580/pexels-photo-207580.jpeg${Q}`,
  'SKU-5002': `${PEXELS}/7988099/pexels-photo-7988099.jpeg${Q}`,
  // Sensors
  'SKU-5003': `${PEXELS}/7994435/pexels-photo-7994435.jpeg${Q}`,
  'SKU-5004': `${PEXELS}/5380642/pexels-photo-5380642.jpeg${Q}`,
  // Trackers
  'SKU-5005': `${PEXELS}/1148203/pexels-photo-1148203.jpeg${Q}`,
  // Bundles
  'SKU-5006': `${PEXELS}/5474028/pexels-photo-5474028.jpeg${Q}`,
  // Gateways
  'SKU-5007': `${PEXELS}/3483098/pexels-photo-3483098.jpeg${Q}`,
  'SKU-5008': `${PEXELS}/1181271/pexels-photo-1181271.jpeg${Q}`,

  // Security — firewall
  'SKU-6001': `${PEXELS}/60504/pexels-photo-60504.jpeg${Q}`,
  // MDR
  'SKU-6002': `${PEXELS}/3784221/pexels-photo-3784221.jpeg${Q}`,
  // VPN
  'SKU-6003': `${PEXELS}/4348404/pexels-photo-4348404.jpeg${Q}`,
  // Endpoint
  'SKU-6004': `${PEXELS}/2881229/pexels-photo-2881229.jpeg${Q}`,
  // Email security
  'SKU-6005': `${PEXELS}/3165335/pexels-photo-3165335.jpeg${Q}`,
  // Bundles
  'SKU-6006': `${PEXELS}/4226140/pexels-photo-4226140.jpeg${Q}`,

  // Partner
  'SKU-7001': `${PEXELS}/5380642/pexels-photo-5380642.jpeg${Q}`,
  'SKU-7002': `${PEXELS}/7988099/pexels-photo-7988099.jpeg${Q}`,
  'SKU-7003': `${PEXELS}/5474028/pexels-photo-5474028.jpeg${Q}`,
}

// Category hero images
export const CATEGORY_IMAGES: Record<string, string> = {
  consumer: `${PEXELS}/47261/pexels-photo-47261.jpeg${Q}`,
  partner: `${PEXELS}/5380642/pexels-photo-5380642.jpeg${Q}`,
  iot: `${PEXELS}/7994435/pexels-photo-7994435.jpeg${Q}`,
  security: `${PEXELS}/60504/pexels-photo-60504.jpeg${Q}`,
  device: `${PEXELS}/699122/pexels-photo-699122.jpeg${Q}`,
  content: `${PEXELS}/2881229/pexels-photo-2881229.jpeg${Q}`,
}

// Hero section background
export const HERO_IMAGE = `${PEXELS}/207580/pexels-photo-207580.jpeg${Q_HERO}`

export function getProductImage(productId: string): string {
  return PRODUCT_IMAGES[productId] || `${PEXELS}/356056/pexels-photo-356056.jpeg${Q}`
}

export function getCategoryImage(categoryId: string): string {
  return CATEGORY_IMAGES[categoryId] || `${PEXELS}/356056/pexels-photo-356056.jpeg${Q}`
}
