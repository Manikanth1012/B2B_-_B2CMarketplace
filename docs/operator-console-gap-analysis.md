# Operator console — prototype vs React

**Date:** 29 Jul 2026 · **Branch:** `Claude`

Measured, not estimated. Prototype nav extracted from `operator.html`; React screens from
`src/components/operator/` and `src/types/view.ts`.

**Prototype: 35 operator screens. React: 13. Missing: 22.**

(The prototype's nav definition yields 45 entries; ten of those are theme options, media kinds and
knowledge-base article kinds rather than screens.)

---

## 1. What exists in both

Thirteen screens are present. All except the audit log perform real writes against Supabase —
`OperatorAudit` is read-only, which is correct for an append-only log.

| Prototype | React | Writes (insert/update/delete) |
|---|---|---|
| Marketplace | `op-dashboard` | 0 / 1 / 0 |
| Partner onboarding | `op-onboarding` | 2 / 1 / 0 |
| Catalogue | `op-catalogue` | 1 / 3 / 1 |
| Settlement runs | `op-settlement` | 1 / 2 / 1 |
| Inventory | `op-inventory` | 2 / 2 / 2 |
| Support tickets | `op-tickets` | 1 / 4 / 1 |
| Collections | `op-dunning` | 1 / 3 / 1 |
| Developer portal | `op-developer` | 2 / 1 / 2 |
| Promotions | `op-promotions` | 1 / 2 / 1 |
| Banners | `op-banners` | 1 / 2 / 1 |
| Message delivery | `op-channels` | 1 / 2 / 1 |
| Roles configuration | `op-roles` | 2 / 2 / 2 |
| Audit log | `op-audit` | 0 / 0 / 0 (read-only by design) |

**These are present but shallower than the prototype.** The prototype's catalogue screen also
carries listing versioning, media management and the listing-rules matrix; its roles screen carries
a thirty-two row capability matrix across thirteen roles. The React equivalents cover the core
CRUD, not the governance depth. Depth is not quantified per screen in this document — presence is.

---

## 2. What is missing — 22 screens

Grouped by the job they do, not by nav order.

### Commercial — 6 missing

| Screen | What the prototype does |
|---|---|
| **Commission plans** | Seven commercial models with model-driven parameters; three-tier pricing with an absolute cost floor |
| **Billing configuration** | Fourteen switchable bill sections, five templates, per-audience assignment with per-partner override |
| **Tax configuration** | Six jurisdictions, merchant of record, tax backed out of inclusive prices |
| **General ledger** | Chart of accounts, seventeen charge types each mapped to a debit and credit, trial balance that must net to zero |
| **Credit and debit notes** | Marketplace-to-seller adjustments with approval thresholds and a second-approver ceiling |
| **Refunds** | Customer-to-seller money return, with the ownership rule about who decides |

### Catalogue governance — 3 missing

| Screen | What the prototype does |
|---|---|
| **Listing rules** | Ten policy rules, each with how it is checked, why it exists, who owns it and what evidence it needs; a rule × category matrix |
| **Reviews** | Moderation for content rather than sentiment, seller replies, aggregates blending historical counts with published reviews |
| **Marketplace categories** | The six categories with computed counts, per-category policy and listing caps |

### Customer value — 2 missing

| Screen | What the prototype does |
|---|---|
| **Rewards** | Tiers on rolling twelve-month spend, earn rules each naming a funder, a redemption catalogue, and a liability with a stated breakage assumption |
| **Wallets** | Stored value as a liability with two pots — the holder's own money and credit the platform issued — because refunding promotional credit as cash is the failure that distinction prevents |

### Operations — 4 missing

| Screen | What the prototype does |
|---|---|
| **Order operations** | The order register and interventions |
| **Disputes** | Dispute handling distinct from the general ticket queue |
| **Numbers and SIMs** | ICCID/IMSI/MSISDN federated from the BSS, reserved ranges, the eSIM profile lifecycle |
| **Bulk updates** | CSV upload and common update through one validator, mandatory dry run, per-row rejection |

### Platform and admin — 7 missing

| Screen | What the prototype does |
|---|---|
| **Partners** | The partner register, separate from the onboarding funnel |
| **Partner APIs** | Inbound endpoint registry and the event coverage matrix |
| **Users** | User directory, separate from the roles matrix |
| **Sign-in and sessions** | Session listing and revocation, sign-in history, step-up re-authentication |
| **Notification rules** | Rule builder and per-channel message templates |
| **Knowledge base** | 10 operator articles — **plan already written**, see below |
| **My details** | The operator's own profile |

---

## 3. On the three you named

All three are genuinely absent as capabilities. The words appear in the codebase, which is
misleading:

- **Listing rules** — zero occurrences anywhere in `src/`.
- **Reviews** — appears only as a *count* on a product card (`ProductCard.tsx:107`,
  `product.reviews`) and as a tab label in `ProductDetail.tsx:25`. There is no moderation queue, no
  seller reply, no aggregate blending.
- **Wallets** — appears only as a *balance figure* (`AccountView.tsx:263`) and a spend-cap input.
  There is no ledger, no two-pot model, no dormancy state, no operator view.

A number rendered on a screen is not the capability behind it.

---

## 4. Already in flight

| Item | Status |
|---|---|
| Partner onboarding spine | Built and reviewed — `docs/superpowers/specs/2026-07-28-onboarding-spine-design.md` |
| Knowledge base (10 operator articles) | Plan written, not executed — `docs/superpowers/plans/2026-07-29-knowledge-base-phase1.md` |

---

## 5. Suggested order

Sequenced by what unblocks what, and by how visible the gap is in a demo.

1. **Catalogue governance** — Listing rules, Reviews, Marketplace categories. The catalogue screen
   already exists, so these deepen a surface rather than starting a new one, and "what may be sold
   here and on what terms" is the marketplace's central question.
2. **Customer value** — Rewards and Wallets. Both are already *referenced* in the consumer UI as
   bare numbers with nothing behind them, which is the most exposed kind of gap.
3. **Commercial** — Commission plans, then the ledger and tax. Largest cluster; the ledger depends
   on charge types the other screens define.
4. **Operations and admin** — the remainder.

Each cluster is its own spec and plan, in the pattern already used for the onboarding spine.
