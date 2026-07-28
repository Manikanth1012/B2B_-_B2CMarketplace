export interface Category {
  id: string
  name: string
  audience: string
  icon: string
  blurb: string
  sort_order: number
}

export interface Partner {
  id: string
  name: string
  type: string
  country: string
  tier: string
  status: string
  rating: number
  contact: string
  email: string
  joined: string
}

export interface Product {
  id: string
  category_id: string
  sub_category: string
  name: string
  partner_id: string | null
  seller: string
  price: number
  was_price: number | null
  cost: number
  model: string
  fulfil: string
  rating: number | null
  reviews: number
  stock: string
  status: string
  listed: string
  description: string
  tags: string[]
  comm: number
  badge: string | null
  unit: string | null
  specs: Record<string, string>
  sort_order: number
}

export interface CartItem {
  id: string
  product_id: string
  quantity: number
  created_at: string
  product?: Product
}

export interface Order {
  id: string
  order_ref: string
  status: string
  total: number
  subtotal: number
  tax: number
  discount: number
  payment_method: string | null
  buyer_name: string | null
  buyer_email: string | null
  shipping_address: Record<string, string> | null
  created_at: string
}

export interface OrderItem {
  id: string
  order_id: string
  product_id: string
  product_name: string
  price: number
  quantity: number
  fulfil: string
  status: string
}

export interface Subscription {
  id: string
  product_id: string
  product_name: string
  status: string
  auto_renew: boolean
  started_at: string
  next_renewal: string | null
  price: number
}
