# Project Context — 6D Telecom Marketplace

## Overview
A telecom marketplace web app built with React + Vite + Supabase. It has four personas:
1. **Consumer** — browse products, add to cart, checkout, view orders/subscriptions/rewards/account
2. **Operator** — admin console for managing the marketplace (12 screens)
3. **Partner / Seller** — onboard products, manage orders, view settlement, performance dashboard
4. **Enterprise Buyer** — B2B procurement of IoT, security and device products with approval workflow

## Tech Stack
- **Frontend**: React 18, TypeScript, Vite
- **Backend**: Supabase (Postgres + RLS)
- **Icons**: lucide-react
- **Styling**: CSS variables (brand navy + teal accent), inline styles + global.css

## How to Switch Personas
- Login screen presents four persona cards: Consumer, Operator, Partner, Enterprise
- Consumer: email `consumer@demo.com` / `demo123`
- Operator: email `admin@6dtelecom.com` / `admin123`
- Partner: email `rajesh.kumar@nimbussensors.com` / `partner123`
- Enterprise: email `vikram.shah@smartbuild.in` / `enterprise123`

## Operator Console Screens (all database-backed with CRUD)

| Screen | What You Can Do |
|--------|----------------|
| Dashboard | View KPIs, approve pending settlements (individual or all) |
| Partner Onboarding | Add partners, click gates to review, add notes, clear gates (auto-advances) |
| Catalogue Review | Approve/reject (with reason), edit, delete, add listings; live margin calc |
| Settlement Runs | Approve, reject (disputed), view gross-to-net breakdown, create new |
| Inventory & WMS | Add/edit/delete stock lines + warehouses; auto-calc available stock |
| Tickets & SLA | Reply, assign, escalate, resolve, delete, create new tickets |
| Collections (Dunning) | Advance ladder steps, record promise-to-pay, close, create new |
| Promotions | Create, edit, pause/resume, delete |
| Storefront Banners | Create, edit, pause/activate, delete |
| Channels | Create, edit, enable/disable, delete notification channels |
| Roles & Users | Create/edit roles w/ capability matrix, invite/edit/remove users |
| Developer Portal | Publish/edit/delete APIs, add/remove subscriptions |
| Audit Trail | Filter by category, view hash-chained integrity log |

## Partner Console Screens

| Screen | What You Can Do |
|--------|----------------|
| Dashboard | KPIs, recent orders, settlement summary, performance charts |
| Onboarding | Multi-step seller onboarding with compliance gates |
| Listings | Manage product listings, add new, edit pricing |
| Orders | View and fulfil orders from enterprise/consumer buyers |
| Settlement | View settlement statements, gross-to-net breakdown |
| Performance | Sales analytics, rating breakdown, category performance |
| Integrations | API keys, webhook configuration |
| Support | Customer support tickets |
| Team & Roles | Team members and role management |
| Audit Log | Account-scoped activity log |
| Profile | Seller profile and business details |

## Enterprise Buyer Screens

| Screen | What You Can Do |
|--------|----------------|
| Dashboard | Procurement KPIs (monthly committed, budget used, approvals waiting, orders in flight), spend charts, marketplace tiles, pending approvals + recent orders summary |
| Approvals | Review pending requisitions with requester reason and policy, approve or decline with confirmation modal |
| Browse Catalogue | Filterable product grid with marketplace/category facets, sort, search, add to requisition |
| IoT Marketplace | View held IoT subscriptions (SIMs, sensors), browse listings by category |
| Security Marketplace | View security stack (MDR, ZTNA, endpoint), suspended seller warning, browse listings |
| Device Marketplace | View standard device list, browse phones/routers/tablets/CPE |
| Orders | All purchase orders with fulfilment stage tracking, failed order flags |
| Subscriptions | Active/suspended subscriptions with seat assignment meters, renewal dates, unassigned seat count |
| Team & Roles | Team members with roles and MFA status |
| Audit Log | Account-scoped procurement activity log |
| My Details | Contact info, procurement settings (approval threshold, IT sign-off policy, payment terms) |

## Cross-Persona Connections
- Enterprise orders reference the same order IDs visible in the Partner console (e.g. ORD-880519 cold-chain bundle from Nimbus Sensors)
- Enterprise subscriptions reference products from Partner sellers (Nimbus Sensors, Sentinel Cyber, CloudPath, 6D Telecom, Aventa)
- Operator catalogue review approves listings that appear in both Consumer and Enterprise browse grids
- Partner settlement statements reflect orders placed by Enterprise buyers

## Database (Supabase)
- Migrations in `supabase/migrations/`
- RLS enabled on all tables
- Key tables: `products`, `cart_items`, `orders`, `operator_profile`, `operator_tickets`, `settlement_statements`, `onboarding_gates`, `operator_catalogue`, `operator_inventory`, `operator_warehouses`, `operator_dunning`, `operator_promotions`, `operator_banners`, `operator_channels`, `operator_roles`, `operator_users`, `operator_developer_apis`, `operator_developer_subscriptions`, `operator_audit`

## File Structure
```
src/
  App.tsx              — main app, persona switching, routing
  types/index.ts       — TypeScript types
  types/view.ts        — View, OperatorView, PartnerView, EnterpriseView, Persona types
  lib/supabase.ts      — Supabase client
  lib/images.ts        — Image helpers
  styles/global.css    — Global styles + CSS variables
  components/          — Consumer-facing components (Header, Hero, ProductGrid, etc.)
  components/operator/ — All 12 operator screens + shared.tsx (Btn, Modal, Table, etc.)
  components/partner/  — All partner screens + data.ts
  components/enterprise/ — EnterpriseShell, EnterpriseDashboard, EnterpriseBrowse, EnterpriseViews, EnterpriseMisc, data.ts
```

## Recent Changes
- Added Enterprise Buyer as fourth persona with full procurement workflow
- Enterprise login card on LoginScreen (teal accent, Building2 icon)
- EnterpriseShell with sidebar nav (Dashboard, Approvals, Browse, IoT, Security, Devices, Orders, Subscriptions, Team, Audit, Profile)
- Enterprise data model: profile, subscriptions, orders, approvals, catalogue — all referencing Partner sellers and Operator order IDs
- Approvals workflow with approve/decline confirmation modal and policy thresholds ($2,000 finance approval, IT sign-off for security)
- Suspended seller warning (Vertex Endpoint) with replacement guidance (Sentinel MDR)
- Budget tracking with spend-by-month and spend-by-marketplace visualisations
- Fixed duplicate export in LoginScreen.tsx
- Fixed type errors in OperatorDunning, OperatorPromotions, OperatorChannels, OperatorInventory (parseFloat fallbacks returning string instead of number)
- Fixed null-safety in OperatorRoles (assigned_count check)
- All operator screens have full CRUD wired to Supabase
