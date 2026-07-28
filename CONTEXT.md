# Project Context — 6D Telecom Marketplace

## Overview
A telecom marketplace web app built with React + Vite + Supabase. It has two personas:
1. **Consumer** — browse products, add to cart, checkout, view orders/subscriptions/rewards/account
2. **Operator** — admin console for managing the marketplace (12 screens)

## Tech Stack
- **Frontend**: React 18, TypeScript, Vite
- **Backend**: Supabase (Postgres + RLS)
- **Icons**: lucide-react
- **Styling**: CSS variables (brand navy + teal accent), inline styles + global.css

## How to Switch Personas
- A visible **"Operator Console"** button in the consumer header (top-right, teal button)
- From operator, click **"Switch to Consumer"** in the sidebar footer or profile dropdown

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

## Database (Supabase)
- Migrations in `supabase/migrations/`
- RLS enabled on all tables
- Key tables: `products`, `cart_items`, `orders`, `operator_profile`, `operator_tickets`, `settlement_statements`, `onboarding_gates`, `operator_catalogue`, `operator_inventory`, `operator_warehouses`, `operator_dunning`, `operator_promotions`, `operator_banners`, `operator_channels`, `operator_roles`, `operator_users`, `operator_developer_apis`, `operator_developer_subscriptions`, `operator_audit`

## File Structure
```
src/
  App.tsx              — main app, persona switching, routing
  types/index.ts       — TypeScript types
  types/view.ts        — View & OperatorView types
  lib/supabase.ts      — Supabase client
  lib/images.ts        — Image helpers
  styles/global.css    — Global styles + CSS variables
  components/          — Consumer-facing components (Header, Hero, ProductGrid, etc.)
  components/operator/ — All 12 operator screens + shared.tsx (Btn, Modal, Table, etc.)
```

## Recent Changes
- Fixed type errors in OperatorDunning, OperatorPromotions, OperatorChannels, OperatorInventory (parseFloat fallbacks returning string instead of number)
- Fixed null-safety in OperatorRoles (assigned_count check)
- Added visible "Operator Console" button to consumer header (was only in account dropdown)
- All operator screens have full CRUD wired to Supabase
