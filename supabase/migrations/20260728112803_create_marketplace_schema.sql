/*
# Telecom Marketplace — Core Schema

1. New Tables
- `categories` — the six marketplace segments (Consumer, Partner, IoT, Security, Device, Digital Content)
- `partners` — sellers on the marketplace (ISVs, OEMs, content providers, resellers)
- `products` — listings across all segments with pricing, fulfillment, and inventory
- `cart_items` — shopping cart for browsing users (single-tenant, no auth)
- `orders` — placed orders
- `order_items` — line items within orders
- `subscriptions` — active recurring subscriptions for users

2. Security
- All tables use RLS with `TO anon, authenticated` since this is a no-auth storefront app.
- Cart and orders are shared (single-tenant demo), so policies allow full CRUD for anon.

3. Notes
- Products carry segment-specific attributes as JSONB (specs) for flexibility.
- Products reference partners via foreign key; first-party products have null partner.
- Cart items reference products; quantity is capped at available stock.
- Orders track fulfillment pipeline state per line item.
*/

-- Categories (marketplace segments)
CREATE TABLE IF NOT EXISTS categories (
  id text PRIMARY KEY,
  name text NOT NULL,
  audience text NOT NULL,
  icon text NOT NULL DEFAULT 'package',
  blurb text,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

-- Partners (sellers)
CREATE TABLE IF NOT EXISTS partners (
  id text PRIMARY KEY,
  name text NOT NULL,
  type text NOT NULL,
  country text,
  tier text DEFAULT 'Bronze',
  status text NOT NULL DEFAULT 'live',
  rating numeric DEFAULT 0,
  contact text,
  email text,
  joined text,
  created_at timestamptz DEFAULT now()
);

-- Products (listings)
CREATE TABLE IF NOT EXISTS products (
  id text PRIMARY KEY,
  category_id text NOT NULL REFERENCES categories(id),
  sub_category text,
  name text NOT NULL,
  partner_id text REFERENCES partners(id),
  seller text NOT NULL,
  price numeric NOT NULL DEFAULT 0,
  was_price numeric,
  cost numeric DEFAULT 0,
  model text NOT NULL DEFAULT 'oneoff',
  fulfil text NOT NULL DEFAULT 'instant',
  rating numeric,
  reviews int DEFAULT 0,
  stock text NOT NULL DEFAULT 'in',
  status text NOT NULL DEFAULT 'live',
  listed text,
  description text,
  tags text[] DEFAULT '{}',
  comm numeric DEFAULT 0,
  badge text,
  unit text,
  specs jsonb DEFAULT '{}',
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

-- Cart items (single-tenant, no auth)
CREATE TABLE IF NOT EXISTS cart_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id text NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  quantity int NOT NULL DEFAULT 1,
  created_at timestamptz DEFAULT now()
);

-- Orders
CREATE TABLE IF NOT EXISTS orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_ref text NOT NULL,
  status text NOT NULL DEFAULT 'placed',
  total numeric NOT NULL DEFAULT 0,
  subtotal numeric NOT NULL DEFAULT 0,
  tax numeric NOT NULL DEFAULT 0,
  discount numeric NOT NULL DEFAULT 0,
  payment_method text,
  buyer_name text,
  buyer_email text,
  shipping_address jsonb,
  created_at timestamptz DEFAULT now()
);

-- Order items
CREATE TABLE IF NOT EXISTS order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id text NOT NULL,
  product_name text NOT NULL,
  price numeric NOT NULL,
  quantity int NOT NULL DEFAULT 1,
  fulfil text NOT NULL DEFAULT 'instant',
  status text NOT NULL DEFAULT 'placed'
);

-- Subscriptions (active recurring services)
CREATE TABLE IF NOT EXISTS subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id text NOT NULL REFERENCES products(id),
  product_name text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  auto_renew boolean NOT NULL DEFAULT true,
  started_at timestamptz DEFAULT now(),
  next_renewal date,
  price numeric NOT NULL DEFAULT 0
);

-- Enable RLS on all tables
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE partners ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE cart_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;

-- Policies for categories (read-only, public)
DROP POLICY IF EXISTS "anon_read_categories" ON categories;
CREATE POLICY "anon_read_categories" ON categories FOR SELECT TO anon, authenticated USING (true);

-- Policies for partners (read-only, public)
DROP POLICY IF EXISTS "anon_read_partners" ON partners;
CREATE POLICY "anon_read_partners" ON partners FOR SELECT TO anon, authenticated USING (true);

-- Policies for products (read-only, public)
DROP POLICY IF EXISTS "anon_read_products" ON products;
CREATE POLICY "anon_read_products" ON products FOR SELECT TO anon, authenticated USING (true);

-- Policies for cart_items (full CRUD, single-tenant)
DROP POLICY IF EXISTS "anon_select_cart" ON cart_items;
CREATE POLICY "anon_select_cart" ON cart_items FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_cart" ON cart_items;
CREATE POLICY "anon_insert_cart" ON cart_items FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_cart" ON cart_items;
CREATE POLICY "anon_update_cart" ON cart_items FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_cart" ON cart_items;
CREATE POLICY "anon_delete_cart" ON cart_items FOR DELETE TO anon, authenticated USING (true);

-- Policies for orders (full CRUD, single-tenant)
DROP POLICY IF EXISTS "anon_select_orders" ON orders;
CREATE POLICY "anon_select_orders" ON orders FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_orders" ON orders;
CREATE POLICY "anon_insert_orders" ON orders FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_orders" ON orders;
CREATE POLICY "anon_update_orders" ON orders FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_orders" ON orders;
CREATE POLICY "anon_delete_orders" ON orders FOR DELETE TO anon, authenticated USING (true);

-- Policies for order_items (full CRUD, single-tenant)
DROP POLICY IF EXISTS "anon_select_order_items" ON order_items;
CREATE POLICY "anon_select_order_items" ON order_items FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_order_items" ON order_items;
CREATE POLICY "anon_insert_order_items" ON order_items FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_order_items" ON order_items;
CREATE POLICY "anon_update_order_items" ON order_items FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_order_items" ON order_items;
CREATE POLICY "anon_delete_order_items" ON order_items FOR DELETE TO anon, authenticated USING (true);

-- Policies for subscriptions (full CRUD, single-tenant)
DROP POLICY IF EXISTS "anon_select_subscriptions" ON subscriptions;
CREATE POLICY "anon_select_subscriptions" ON subscriptions FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_subscriptions" ON subscriptions;
CREATE POLICY "anon_insert_subscriptions" ON subscriptions FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_subscriptions" ON subscriptions;
CREATE POLICY "anon_update_subscriptions" ON subscriptions FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_subscriptions" ON subscriptions;
CREATE POLICY "anon_delete_subscriptions" ON subscriptions FOR DELETE TO anon, authenticated USING (true);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id);
CREATE INDEX IF NOT EXISTS idx_products_status ON products(status);
CREATE INDEX IF NOT EXISTS idx_products_partner ON products(partner_id);
CREATE INDEX IF NOT EXISTS idx_cart_product ON cart_items(product_id);
CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);
