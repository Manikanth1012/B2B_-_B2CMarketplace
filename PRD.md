# Product Requirements Document (PRD): B2B/B2C Telecom Marketplace

## 1. Document Control
* **Version**: 4.0  
* **Date**: July 2026  
* **Status**: Draft — sections 4.8 to 4.69 and section 7 added from the working build  
* **Author**: AI Coding Assistant (Antigravity)  
* **Target Audience**: Platform Owner (Telecom Operator), Product Managers, Developers, and Partners  

### 1.1 Revision History

| Version | Date | Change |
|---|---|---|
| **4.2** | **Jul 2026** | Added §4.69 Notify me on an out-of-stock product, on both buy sides. |
| **4.1** | **Jul 2026** | Added §4.67 Product eligibility and dependency, §4.68 Plan change as a switch. Partner Documents given the full width, settlement invoice action unified across both tables. |
| **4.0** | **Jul 2026** | Added §4.62 Media view and download, §4.63 Wallets, §4.64 Action columns, §4.65 Fulfilment routing as configuration, §4.66 Operator roles. Tax display corrected, bill sketch driven by its sections, product artwork in media, out-of-stock tiles dimmed. |
| **3.9** | **Jul 2026** | Added §4.56 Settlement detail and masking, §4.57 Product artwork, §4.58 What a seller can see and correct, §4.59 What a buyer holds. Onboarding tasks scoped per partner. |
| **3.8** | **Jul 2026** | §4.53 extended — redemption constrained to settle inside the marketplace, and both the redemption catalogue and the tier ladder made operator-editable with ladder-coherence guards. |
| **3.7** | **Jul 2026** | Added §4.52 Order stage detail, §4.53 Loyalty and rewards, §4.54 Refund escalation by SLA, §4.55 Theme. |
| 1.7 | Jul 2026 | Six marketplace segments, TMF matrix, seven functional components |
| **2.9** | **Jul 2026** | Added §4.39 Dunning ladders per customer type and §4.40 General ledger. Merged bill formatting into the template so one record holds one document's settings. |
| **2.8** | **Jul 2026** | Rewrote §4.35 as a template system: multiple operator-managed bill templates with switchable sections, party and support contact blocks, an advertising insert, and PDF bills in every persona. |
| **2.7** | **Jul 2026** | Added API authoring, version lifecycle and the subscription matrix to §4.21. |
| **2.6** | **Jul 2026** | Made the marketplace event catalogue configurable (§4.36), with a blast-radius preview before a mandatory event is saved. |
| **2.5** | **Jul 2026** | **Corrected §4.21.** The developer portal is partner integration access, not API monetisation. Added §4.36 Partner API registry, §4.37 Integration milestone in onboarding, §4.38 Operator-led onboarding. |
| **2.4** | **Jul 2026** | Added §4.35 Documents and statements — real generated PDFs including a full bill template with embedded brand artwork. Operational dataset deepened three to fourfold. |
| **2.3** | **Jul 2026** | Added §4.34 Knowledge base and guided walkthroughs, in all four portals. |
| **2.2** | **Jul 2026** | Added §4.32 Listing rule catalogue and §4.33 Per-seller listing cap, closing two controls that were displayed but not configurable or not enforced. |
| **2.1** | **Jul 2026** | **Closed the remaining three gaps and added bulk update.** Added §4.28 Authentication, sessions and SSO, §4.29 Number Management and Logical Inventory integration, §4.30 Channel delivery and receipts, §4.31 Bulk update. Every front-end gap in §7 is now closed. |
| **2.0** | **Jul 2026** | **Closed the last five build gaps and added forecasting.** Added §4.21 Marketplace developer portal, §4.22 Listing versioning and contract pricing, §4.23 Product comparison, §4.24 Warehouse system integration, §4.25 Audit integrity and SIEM export, §4.26 Dunning and collections, §4.27 Revenue and spend projection. Updated §7 to reflect what is now built. |
| **1.9** | **Jul 2026** | **Closed six of the gaps listed in v1.8 §7.2.** Added §4.15 Audit trail with role-scoped visibility, §4.16 Storefront advertising, §4.17 Inventory, §4.18 Ticketing and SLA, §4.19 Customer reviews, §4.20 Partner portal branding. Updated §7 to reflect what is now built. |
| 1.8 | Jul 2026 | **Aligned to the working prototype.** Added §4.8 Cost-price floor & three-tier pricing, §4.9 Conditional discount rules engine, §4.10 Tax & merchant of record, §4.11 Commercial models & partner billing cycles, §4.12 Onboarding gate policy, §4.13 Partner outbound integrations, §4.14 Reporting periods & export. Added §7 Prototype implementation status with traceability. Extended §4.2 (media, cost floor), §4.4 (self-billing, per-partner cycles) and §4.7 (roles matrix, credential security, notification templates). |

> **Companion documents**: `epics_and_stories.md` (v1.26) carries the EPIC and story breakdown. `CONTEXT.md` carries the build milestones, decisions and constraints — read that first if you are picking this work up cold or on a different model.

---

## 2. Product Overview & Strategic Goals

### 2.1 Executive Summary
The B2B/B2C Telecom Marketplace is a unified digital commerce, loyalty, and orchestration platform that enables a Telecom Operator to act as a multi-segment digital aggregator. The platform is structured around **six marketplace segments**: Consumer, Partner, IoT, Security, Device, and Digital Content — each serving distinct customer personas with tailored catalogs, fulfillment models, and checkout flows. By combining Partner-listed offerings with the Operator's core network capabilities (connectivity, SIM management, carrier billing, and IoT platform), the marketplace delivers a single-storefront experience catering to **B2C Individual Consumers**, **B2B SMBs**, and **B2B Enterprise** buyers.

### 2.2 Key Objectives
- **B2B & B2C Aggregated Storefront & Shopping Cart**: Provide a dynamic storefront and shopping cart supporting B2C retail checkout flows alongside B2B corporate purchase flows.
- **TMF Open API Compliance**: Align core services with industry-standard TM Forum Open APIs to enable seamless integration with existing telecom OSS/BSS, CRM, and Partner portals.
- **TMF-Compliant Partnerships & Loyalty**: Utilize standard TMF models for partnership types (TMF668), promotion/coupon management (TMF736), loyalty programs (TMF737), and point account ledgers (TMF738).
- **UPC Product Federation**: Establish automated product federation and synchronization protocols between the Operator's Centralized UPC (Unified Product Catalog) and the Marketplace Catalog backend to maintain a single source of truth for operator offerings.
- **Flexible Customer Promotion & Pricing Controls**:
  - Enable partners to configure **Discount Coupons & Vouchers** specifically for their items.
  - Enable partners to define **Minimum and Maximum sellable price guardrails** to prevent unauthorized discounts.
  - Enable the operator to configure **Discount/Coupons for cross-product bundles**.
- **Self-Service Branding & Customization**: Allow partners to manage portal branding (logos, brand colors, dark/light themes, and custom dashboard cards/widgets).
- **Comprehensive Media & Data Sheets**: Allow partners to upload showcase images, product manuals, and technical data sheets, giving purchased customers exclusive access to download manuals post-checkout.
- **Retail Engagements (Login Banners & Reviews)**: Feature advertisement banners on customer login screens, and enable customers to submit ratings and feedback for purchased products.
- **Governance & Layout Auditing**: Give Operator Admins tools to customize bill/invoice templates, manage global roles, audit settlements, and generate reports across all personas.
- **Multi-Segment Catalog Architecture**: Organize the marketplace storefront into named segments so customers land on a focused, relevant catalog view based on their profile (Consumer, IoT Enterprise, Security, Device, Digital Content).

### 2.3 Marketplace Segments

The marketplace is organized into six business segments. Each segment has a primary audience, product scope, and fulfillment model:

| Segment | Audience | Primary Products | Fulfillment Model |
|---|---|---|---|
| **Consumer Marketplace** | B2C Individuals | Mobile plans, handsets, OTT subscriptions, insurance | Digital activation + BSS billing / Physical device delivery |
| **Partner Marketplace** | B2B2X (All) | Partner-listed apps & services across all segments | n8n webhook provisioning per partner |
| **IoT Marketplace** | B2B Enterprises | SIMs, sensors, device bundles, IoT connectivity packs | SIM provisioning via OMS + device shipping |
| **Security Marketplace** | B2B Enterprise | Firewall-as-a-Service, MDR subscriptions, VPN licenses | Digital license activation via n8n / partner API |
| **Device Marketplace** | B2C & B2B Enterprise | Smartphones, routers, CPE (Customer Premises Equipment) | Physical shipment fulfilment + logistics integration |
| **Digital Content Marketplace** | B2C Individuals | OTT streaming, gaming titles, music subscriptions | Instant digital code / access token delivery |

> **Note on Physical Fulfillment**: The **Device Marketplace** and physical goods in the **Consumer** and **IoT Marketplaces** require integration with a Logistics/Warehouse Management System (WMS) for shipping label generation, delivery tracking, and returns management. This is treated as an external system integration within the ORD component.

---

## 3. User Personas & Journeys

The marketplace supports four primary user categories, each with distinct portals, dashboards, and operational journeys:

```
                  ┌───────────────────────────────────────────┐
                  │        B2B/B2C Marketplace Portal         │
                  └─────┬───────────────────┬───────────┬─────┘
                        │                   │           │
      ┌─────────────────▼───┐     ┌─────────▼─────────┐ │
      │   Platform Owner    │     │ Partner/Provider  │ │
      │      (Operator)     │     │      (Seller)     │ │
      └─────────────────────┘     └───────────────────┘ │
                                                        │
                                    ┌───────────────────▼───┐
                                    │       Customers       │
                                    │ ┌───────────────────┐ │
                                    │ │   B2C Retailer    │ │
                                    │ ├───────────────────┤ │
                                    │ │   B2B (SMB/Ent)   │ │
                                    │ └───────────────────┘ │
                                    └───────────────────────┘
```

### 3.1 Platform Owner / Admin (Telecom Operator)
The Platform Owner operates the marketplace infrastructure, defines commercial rules, manages partner settlement, monitors support cases, and audits system health.

#### Key Journeys & Reporting:
1. **User & Role Management**: Configure global system roles and manage administrative access (e.g. Operator Admin, Operations Agent, Finance Auditor).
2. **Catalog Approval & UPC Federation**: Approve partner listing details, set up automated UPC sync parameters, check federated telecom pricing, and audit the unified product catalog database.
3. **Bill Layout Customization**: Customize bill/invoice templates (updating headers, brand logos, section ordering, footers) via a visual builder.
4. **Promotion & Campaign Management**: Configure global discounts and coupon codes (TMF736) targeting specific retail segments, B2B user categories, or Operator-Partner bundled offerings.
5. **Platform Analytics & Reporting**: Access dashboards showing total gross sales, commission earnings, payment methods share, active partner count, customer churn risk, and support queue SLA breaches.

### 3.2 Partners / App Providers
App Providers are independent software vendors (ISVs), developers, or media providers who want to monetize their products through the Operator's distribution channels.

#### Key Journeys & Reporting:
1. **Partner Portal Branding & Theme settings**: Configure portal colors, select dark or light theme modes, upload partner brand logos, and customize layout cards on their provider dashboard.
2. **User & Role Management**: Partner managers invite users and assign granular roles (e.g. Partner Admin, Developer, Finance Officer).
3. **Product Catalog & Media Configuration**: Publish products, upload showcase images, define **Min to Max sellable price boundaries**, configure pricing plans, and upload technical datasheets and product manuals.
4. **Listing Approval Tracking**: Submit listings and pricing plans for Operator approval. Track submission status (Draft ➔ Under Review ➔ Approved/Rejected).
5. **Partner Sales & Dispute Reports**: Access dashboard reports containing total app downloads, subscription MRR (Monthly Recurring Revenue), transaction lists, settlement payout statements, and ongoing support case dispute statuses.

### 3.3 B2C Customers (Individual Consumers)
B2C Customers represent retail buyers seeking personal software, streaming packages, games, mobile data top-ups, and connectivity add-ons.

#### Key Journeys & Reporting:
1. **Social Login & Ad Banners**: Securely access the portal via social login, encountering customized advertisement banners highlighting promo bundles, loyalty milestones, or new partner apps.
2. **Retail Catalog Browsing & Rating**: Discover streaming, mobile games, and security apps. Read product manuals after checkout, write product reviews, and rate items (1-5 stars).
3. **Shopping Cart & Promotion Redemption**: Add items to a shopping cart, apply promotional discount codes (TMF736), and view loyalty point balances.
4. **Instant Retail Checkout**: Choose payment methods including Credit Cards, Debit Cards, Net Banking, or Direct Carrier Billing (DCB).
5. **Customer Dashboard**: View active digital subscriptions, billing history, and earned loyalty point balances (TMF738). Submit case tickets for digital delivery failures.

### 3.4 B2B Customers (SMBs & Enterprises)
B2B Customers represent business accounts purchasing services across the **Partner, IoT, Security, and Device marketplace segments**. All purchasing is cart-based — there is no CPQ or lengthy quoting cycle. Products include SaaS licenses, productivity suites, firewall/MDR/VPN security subscriptions, IoT SIM packs with sensor bundles, business routers/CPE, and connectivity add-ons.

#### Key Journeys & Reporting:
1. **Corporate User & Role Management**: Corporate IT Admins manage employee access, create department profiles, and assign purchasing permissions (IT Admin, Department Manager, Software Purchaser, Device Requester).
2. **SMB Self-Service Checkout**: Browse the B2B catalog segments (Security, IoT, Device), select plans or device quantities, apply business promo codes, and check out via the Shopping Cart using corporate card or operator postpaid billing link.
3. **Enterprise Cart Checkout with Corporate Account**: Enterprise buyers add digital services or device orders to cart, link their corporate billing account (TMF666), optionally attach a Purchase Order (PO) number, and submit. The order is invoiced to the corporate account.
4. **IoT Fleet Management**: After activating an IoT SIM pack or sensor bundle, Enterprise IT Admins manage SIM lifecycle states (Active, Suspended, Terminated), view device telemetry, and top-up data quotas.
5. **License & Device Assignment**: Allocate software licenses to employees, assign CPE/routers to branch sites, and track deployment status per subscription or shipment.
6. **Enterprise Spend Dashboard**: Reporting on software license utilization, IoT device spend, security subscription renewals, and device hardware orders.

---

## 4. Product Features & Functional Requirements

The marketplace capabilities are split into seven core functional components.

### 4.1 Component 1: Partner & Partnership Management (PMP)
- **Partner Registration & KYB**: Multi-step portal to upload business registration documents, tax certificates, and banking details.
- **Partner Branding Customization**: Allows partners to customize their portal theme:
  - Upload partner brand logos.
  - Set brand colors (Primary, Accent).
  - Select dark mode vs. light mode layout styles.
  - Toggle dashboard layout widgets/cards (e.g. show sales charts, hide technical webhook status logs).
- **TMF Compliance**: Align partner entity registration with **TMF760 (Partner Management)**, party details with **TMF632 (Party Management)**, partner roles with **TMF669 (Party Role Management)**, partnership types and configurations with **TMF668 (Partnership Management)**, and contract uploads with **TMF667 (Document Management)** and **TMF651 (Agreement Management)**.
- **Partner Vetting Pipeline**: Operator Admin dashboard to approve, reject, or request information updates from registering partners.

### 4.2 Component 2: Product & Catalog Management (CAT)
- **Segment-Based Catalog Taxonomy**: The marketplace catalog is organized by the six marketplace segments (Consumer, Partner, IoT, Security, Device, Digital Content). Each segment has dedicated category trees, product attributes, and segment-specific display templates (e.g., Device listings show storage/color specs; IoT listings show SIM type, network band, data allowance).
- **Listing Tool & Price Configuration**: Partner interface to write descriptions, configure pricing plans, and link documentation. Supports flat, seat-based, usage-based, and one-time device purchase price models.
- **IoT-Specific Catalog Attributes**: IoT Marketplace product listings include additional attributes: SIM type (eSIM, physical), network band (LTE/5G/NB-IoT), data bundle size, supported sensor protocol (MQTT, CoAP), and bulk SIM order quantities.
- **Device Catalog Attributes**: Device Marketplace listings include SKU/model, storage/RAM/color variants, stock availability status, compatibility flags (e.g. locked/unlocked), and estimated delivery time.
- **Catalog Media & Documents Upload**: Enables partners to upload:
  - Showcase product images (JPG, PNG) for catalog storefront slides.
  - Product manuals and data sheets (PDF, DOCX) that are locked until purchased.
- **Multi-Media Listing Manager**: A listing carries **several** media items, not one. Requirements:
  - Minimum 3 and maximum 8 images per listing; exactly one **primary** image, which drives the product card and search result.
  - At most one video per listing (2 minutes, 60 MB), plus datasheets and manuals as documents.
  - Gallery order is author-controlled and is the order buyers see.
  - **Alt text is mandatory on every media item.** A listing cannot be submitted while any item is undescribed — an inaccessible listing is unsellable to part of the addressable market, and this is also a WCAG 2.2 AA obligation.
  - Removing the primary image promotes the next image automatically; a gallery is never left without a primary.
- **Customer Ratings & Product Feedback**: Allows buyers to rate products (1-5 stars) and write text reviews.
  - Ratings are aggregated to display averages on the catalog storefront search grids.
  - Partners can view feedback details on their product dashboards.
- **Min/Max Pricing Guardrails**: Enables partners to define a minimum and maximum sellable price limit per plan. See **§4.8** for the cost-price floor, which sits beneath these guardrails and cannot be overridden by anyone — partner, operator or promotion.
- **Product Catalog Federation**: Synchronizes catalog specifications, offerings, categories, and eligibility rules with the Operator's core **Centralized Unified Product Catalog (UPC)**.
- **Product & Price Approval Workflow**: State machine governing the publication of products and price plans.
- **Cross-Partner Bundling Engine**: Operator interface to bundle Partner Service A + Partner Service B + Operator Connectivity at a discounted rate (e.g., a Security bundle = Firewall license + 5G SIM + Managed Detection & Response subscription), handling split-settlement attributes.

### 4.3 Component 3: Order, Shopping Cart, & Subscription Lifecycle (ORD)
- **TMF Shopping Cart**: Provide a full-featured cart aligned with **TMF663 (Shopping Cart Management)** supporting adding, updating, and removing cart items, cart validations, and proration estimations.
- **TMF Order Compliance**: Manage order submissions and status tracking using **TMF622 (Product Order Management)**.
- **Segment-Aware Order Routing**: Upon order placement, the order engine inspects the product segment and routes fulfillment accordingly:
  - **Digital Services / Security / Digital Content**: Trigger n8n partner provisioning webhook for license activation or digital code delivery.
  - **IoT SIMs & Connectivity**: Dispatch TMF664 Resource Order to the Operator's core OMS for SIM provisioning and activation.
  - **Physical Devices (Consumer devices, Routers, CPE, IoT sensor bundles)**: Trigger Logistics/WMS integration for shipment label generation, dispatch, and delivery tracking. Customers receive a shipment tracking reference.
- **Customer Login Page Ad Banners**: Storefront login screen includes dynamic banner frames. Operator Admins can upload marketing graphics to run promotional campaigns (e.g. "Get 10% off Managed Firewall with Business 5G").
- **B2C & B2B Checkout Paths — both Shopping Cart driven**:
  - **B2C retail checkout (Consumer / Digital Content)**: Social login, select plan or device, add to cart, checkout via credit card, debit card, mobile wallet, or Direct Carrier Billing (DCB). Physical device orders capture a delivery address.
  - **B2B SMB checkout (Partner / Security / Device)**: Business login, select service or device, add to cart, checkout via corporate card or operator postpaid billing link. Device orders capture a site delivery address.
  - **B2B Enterprise checkout (IoT / Security / Device)**: Add IoT packs, security subscriptions, or device orders to cart, link corporate billing account (TMF666), optionally attach PO number, submit. No CPQ or multi-step quoting required.

### 4.4 Component 4: Billing, Payments, Loyalty & Promotion Engine (BIL)
- **Marketplace Ledger & Invoicing**: Generate detailed monthly billing line items detailing every purchased item, active subscriptions, and prorated changes.
- **TMF Billing & Account Compliance**: Align billing accounts with **TMF666 (Account Management)**, customer invoicing with **TMF678 (Customer Bill Management)**, payment records with **TMF676 (Payment Management)**, and payment profile setups with **TMF670 (Payment Methods)**.
- **Detailed Payment Options**: Storefront checkouts support credit cards, debit cards, direct carrier bills (append to telecom bill), direct debit/net banking, promo account credits, and loyalty point redemptions.
- **Operator Bill Template Editor**: Console interface for Operator Admins to customize customer-facing bills. Admin can rearrange layout panels, insert operator brand logos, customize headers/footers, and edit tax item formats.
- **Promotion & Discount Engine (TMF736)**:
  - **Partner Product Coupons**: Coupons configured by partners that apply discounts specifically to their own products.
  - **Operator Bundle Coupons**: Coupons configured by operators that apply discounts across combined packages.
- **Loyalty Program & Point Ledgers (TMF737 / TMF738)**:
  - **Loyalty Programs (TMF737)**: Define rules, loyalty tiers, and campaigns.
  - **Loyalty Point Accounts (TMF738)**: Track point balance ledgers per customer profile. Handle points accrual and points redemption.
- **Telecom BSS Integration Sync**: A middleware layer that connects to Operator BSS to verify credit limits, post charges to the customer's postpaid mobile/broadband bill, and deduct balances from prepaid accounts in real-time.
- **Automated Settlement & Payouts**: Calculate monthly revenue sharing (gross sales minus operator cut). Auto-generate payout sheets and match transaction logs against partner invoices.

### 4.5 Component 5: AI Orchestration & Automation Engine (AI)
The marketplace leverages AI models and external orchestration tools to simplify operations, drive engagement, and automate setups. Details are categorized below:

#### Category A: AI-Driven Customer & Operations Support (Agentic Support)
- **AI Buying Assistant (Customer Portal)**: Natural-language chatbot that answers queries like *"I have a 10-person logistics team, what apps and mobile plans do I need?"* and compiles a pre-loaded cart.
- **Partner Catalog Optimizer (Partner Portal)**: Evaluates partner listings and provides recommendations to improve product titles, descriptions, and pricing structures based on top-performing catalog competitors.
- **Operator Billing dispute Assistant (Admin Portal)**: Reviews customer refund/dispute requests, checks usage logs, and suggests draft resolutions to human admins.

#### Category B: Intelligent Commerce & Recommendations (Analytics & Bundling)
- **Predictive Churn Engine**: Models user subscription activity, API consumption, and billing history to flag accounts with high churn risk.
- **Intelligent Bundle Generator**: Suggests custom bundles to the Platform Operator based on customer purchase patterns (e.g., HR apps combined with cloud storage).

#### Category C: External Workflow Orchestration & API Mapping (n8n Integration)
- **n8n Provisioning Connectors**: Triggers standardized n8n workflows for order provisioning, subscription updates, and deprovisioning.
- **Natural Language to Workflow Creator**: Lets partners describe provisioning steps in plain text. The AI creates a draft JSON blueprint for import into n8n.
- **Usage Data Harvester (n8n Webhooks)**: Listens to usage streams from partners (e.g., API hits, SaaS usage ticks), aggregates them hourly, and formats them for the B2B marketplace usage-billing engine.

### 4.6 Component 6: Support, Ticketing, & Dispute Management (SUP)
- **Ticketing & Support Engine**: Internal and external ticketing platform for handling platform questions, technical issues, and billing disputes.
- **Partner Support Cases**: Portal interface for partners to raise settlement dispute cases, technical integration tickets, or account requests to the Operator Admin.
- **Customer Support Cases**: Customer ticket wizard to submit provisioning failure reports, payment errors, or subscription bugs.
- **SLA Tracker**: Track time-to-respond and time-to-resolve metrics per support category with automated escalation alerts to Admin Managers.

### 4.7 Component 7: Admin Governance & Security (ADM)
- **TMF Privacy Compliance**: Provide fine-grained access control and privacy preference storage using **TMF644 (Privacy Management)**.
- **Role-Based Access Control (RBAC)**: Support granular system operations permissions tied to user identities.
- **Roles Configuration Matrix**: A dedicated configuration surface in **every portal** (operator, partner, enterprise buyer, consumer account), not just the operator console. Requirements:
  - An editable capability matrix; each cell cycles **none → scoped → full**. *Scoped* means the role may act, but only inside its own boundary.
  - Roles can be created from nothing or cloned from an existing role; a new role becomes a matrix column immediately with nobody assigned.
  - **Built-in roles may be edited but not deleted**, because work is routed to them by name. A custom role that is still assigned cannot be deleted either — the system must name who holds it and route the admin to reassign them.
  - Permission changes take effect at the holder's next sign-in and the UI must say so.
- **Credential & Session Security**: In every portal — password age and strength, MFA state, open-session count, and the policy stated in full on screen. Requirements:
  - Self-service password change refuses sub-policy and mismatched entries, scores strength live, and signs out other sessions.
  - Administrators may send a reset link or force a reset; a forced reset requires typed confirmation, flags the account and clears its sessions.
  - Disabling MFA requires typed confirmation, because it is a downgrade.
  - **Scheduled rotation is deliberately not required.** Forced periodic changes push users toward weaker, patterned passwords; rotation on suspicion does not. The rationale is stated on screen.
- **Audit Logging**: Store history of portal configurations, API requests, state machine updates, and checkout transactions.

---

## 4A. Extended Functional Requirements

The following requirements emerged during prototype construction. They are numbered as extensions of §4 and map to the same seven components.

### 4.8 Three-Tier Pricing & the Cost-Price Floor (CAT / BIL)

A listing carries **three prices, not one**:

| Field | Meaning | Who sets it | Visibility |
|---|---|---|---|
| **Cost price** | What the item costs the seller | Partner (or operator for first-party) | Never shown to a buyer |
| **List price** | The undiscounted worth of the listing | Partner | Shown struck through when sale price is lower |
| **Sale price** | What a buyer pays today | Partner | Shown |

Requirements:

- The listing wizard shows the full margin stack — sale price, marketplace commission, payment and per-order fees, what settles to the seller, cost, and **margin actually left** — and **refuses a listing priced at or below cost**.
- Where commission and fees exceed the margin, the system warns explicitly rather than showing a healthy-looking positive settlement figure.
- **Discount headroom** is defined as `sale − cost`. It is the only discount capacity that exists anywhere in the platform.
- The partner separately declares **how much of that headroom the marketplace may use** — none, a quarter, half, or down to cost. The UI states the resulting lowest price a promotion could reach. Beyond the allowed share, the marketplace funds the discount from its own margin.
- **The cost floor is absolute.** No promotion, bundle, operator override or negotiated price may take a line below its cost price. This is enforced in the pricing engine, not by the person authoring the rule.

### 4.9 Conditional Discount Rules Engine (BIL — extends TMF736)

The promotion engine in §4.4 is extended from coupon codes to **conditional rules evaluated against the live basket**.

A promotion is **conditions + an effect + a budget**.

**Conditions** (all optional, all combinable):

| Group | Condition |
|---|---|
| Basket | Cart value at or above *n*; item count at or above *n*; marketplace category is one of *set* |
| Timing | Time of day between *hh:mm* and *hh:mm* (windows may cross midnight); days of the week; date range |
| Who | Buyer type (Consumer / Enterprise / Partner reseller / Everyone); first order on the account; loyalty tier at least *t*; contracted enterprises only |

**Effects**: percentage off · fixed amount off · *n* months free on a subscription · free delivery.

Behavioural requirements:

1. **Explain the negative.** The system must show not only which promotions applied but **which did not and why**, in the buyer's own terms — "runs 20:00–23:00, it is 14:20", "basket is $120.00, needs $200.00". A promotion that silently fails to fire is the single hardest thing to diagnose in a commerce stack.
2. **Stacking is explicit.** Non-stacking rules compete and the largest wins; the suppressed ones are reported. Stacking rules are added on top of whichever non-stacking rule won.
3. **Priority** decides which non-stacking rule wins on a tie; lower runs first.
4. **Budget caps are hard.** A rule that has spent its budget stops discounting rather than overspending. It does not switch itself off — and the console must warn that to a buyer, a live-but-exhausted promotion is indistinguishable from one silently withdrawn.
5. **The cost floor applies twice** — per rule against the eligible lines, and again against the whole basket.
6. Discounts apply to **recurring lines as well as one-off lines**, allocated in proportion to what each contributes.
7. Discounts are applied **before tax**, because tax follows the price actually charged.
8. A **basket simulator** and an adjustable demo clock are required so a time-of-day rule can be demonstrated and tested at any hour.

### 4.10 Tax Configuration & Merchant of Record (BIL)

Tax is configuration per jurisdiction, not a global rate.

- Per jurisdiction: tax label (GST/VAT/etc.), standard rate, registration number, scheme, place-of-supply rule, digital-services treatment, and status.
- **Merchant of record** is the fact everything follows from. Where the marketplace is MoR it charges and remits the tax and issues the invoice; where the seller is, the marketplace invoices only its commission and the seller invoices the buyer. Changing it mid-period splits the return, so it is a period-boundary decision.
- A jurisdiction **cannot be set active without a registration number**.
- Jurisdiction-specific obligations are modelled: TCS on Indian marketplace supplies, OVR in Singapore, OSS filing in the EU, DST in Kenya.
- **Partner withholding** follows the tax residency certificate. No valid certificate means statutory withholding; recording one releases it from the next run. The system states that withholding is remitted **in the partner's name**, not retained by the marketplace.
- Display settings: tax-inclusive or tax-exclusive consumer pricing, tax shown separately, B2B reverse charge, rounding level (line/invoice/order), filing calendar. The storefront and checkout must read from this configuration — **tax must be backed out of a tax-inclusive price, never added on top of it**.
- The enterprise buyer states its own registration (GSTIN/VAT/TRN), place of supply, PO requirement and exemption status, and is told plainly whether input credit is claimable.

### 4.11 Commercial Models & Partner Billing Cycles (BIL)

**Commercial models.** A commission plan is a **model plus its parameters**, and the model determines which parameters exist. Seven models are defined: commission on sale, revenue share, recurring revenue share, wholesale discount off list, introducer commission, split hardware/connectivity, and flat listing fee. Requirements:

- Selecting a model in the plan builder **relabels the headline rate, swaps the parameter set, and hides the tier table entirely for a flat-rate model** — a wholesale plan is never asked about cooling-off periods, and an introducer plan is never asked about logistics recharge.
- New models can be defined with their own parameter list (type, label, default) and become immediately selectable.
- Volume tier thresholds must strictly increase or the plan is ambiguous and must not save.
- Changing the model on an existing plan is a **new plan, not an edit** — partners signed a schedule against the original.
- Plans are created as drafts with nobody assigned and have no effect until a partner is attached.

**Partner billing cycles.** The commission plan sets a default cycle; the **partner record is what actually runs**. Per partner: cycle, payment terms, holdback, minimum payout, settlement currency, payment method, and self-billing on/off. An override from the plan default **will not save without a stated reason**, because an override with no reason is how a cycle silently drifts.

**Bill formatting.** Document title, template, numbering pattern with `{YYYY}` / `{PARTNER}` / `{SEQ}` tokens, date format, tax label, rounding, remittance wording, footer, and logo — with a live document preview. The numbering pattern must flow through to real statement references.

**Self-billing invoice.** Every settlement statement is readable as the document the partner is paid against, before approval: document reference, period and terms in force, every SKU sold with order and unit counts, the full gross-to-net deduction stack, and the tax treatment. **Order lines must reconcile to the statement gross exactly.** A statement with an open dispute cannot be approved and must say why. Download produces the order lines plus the deduction stack, not an image of a total.

### 4.12 Onboarding Gate Policy (PMP)

Partner onboarding runs as **seven sequential gates**: Application → KYC & due diligence → Agreements → Bank & tax → Technical readiness → Compliance review → Go-live.

- Gates are **sequential by design** and do not overlap. This is what prevents an application reaching production before due diligence clears.
- Each gate is configurable: owner, target in working days, dual-control requirement, evidence list, and waivability.
- **KYC and Agreements can never be made waivable.** A waiver there is not a shortcut, it is an unsigned counterparty. The controls must be disabled, not merely ignored on save.
- Every gate must expose **the submission behind it** — the fields declared, documents supplied, who submitted, who reviewed, and the evidence checklist ticked or not. A gate not yet reached says so rather than presenting an empty form.
- Onboarding documents contain personal data. The document viewer must state that contents are not reproduced, and in production must be access-logged, watermarked with the viewer's identity, and never bulk-downloadable.
- **An existing partner adding a further marketplace category carries KYC and its verified settlement account over** and opens at the agreements gate. Carried-over gates must be labelled as such and explain that an existing partner does not repeat due diligence.
- Only one category application may be in flight at a time.

### 4.13 Partner Outbound Integrations (CAT / ORD — extends webhook settings)

**The marketplace calls the partner; the partner never polls.** That contract only works if the endpoint, its authentication, its retry policy and its failures are all visible to the partner in one place.

- Partners register endpoints against a defined event catalogue spanning **fulfilment** (order created, cancelled, return authorised, provisioning requested, suspend/resume), **catalogue** (listing decision, catalogue pull, stock check), **finance** (statement ready, payout sent) and **support** (dispute raised). Order created and order cancelled are mandatory.
- Per endpoint: method, URL, environment (production/sandbox), authentication (OAuth 2.0 client credentials, API key header, HMAC signature, mTLS, none), credential reference, retry policy, and timeout.
- **Plain HTTP must be refused** — order payloads carry buyer data. **An unauthenticated production endpoint must be refused outright**; "none" is acceptable only on sandbox.
- A **coverage view** names any required event with no enabled endpoint, and states that such an event is not queued and not retried later — it simply does not arrive.
- **Send a test call** is a first-class action, not a settings-page afterthought, and its outcome must reflect the endpoint's real state.
- A **delivery log** records every attempt with event, attempt number, HTTP status, latency and response detail. This is the record that settles "we never received it".
- Retry exhaustion falls back to portal fulfilment, and **the seller's service commitment keeps running** — a broken webhook does not pause the SLA, and the UI must say so.
- Inbound API keys (partner → marketplace) are scoped, prefix-displayed, shown once on creation, and revocable with immediate effect.
- A listing selects which registered endpoint its orders call, and the wizard must warn before publication if that endpoint is disabled or failing.

### 4.14 Reporting Periods, Notification Content & Export (ADM / NTF)

**Reporting periods.** Dashboards support a 90-day and a 12-month view. Requirements: the two views must **reconcile** — the most recent three months of the trailing series sum exactly to the 90-day figure. Order-level detail is retained for 90 days; earlier months are monthly aggregates, and the UI must declare which is which rather than implying uniform granularity. Growth is computed against the **equivalent preceding window**; where no comparable window exists the system says so rather than inventing a percentage.

**Notification message content.** Beyond the rules in §4.4 and Component NTF, the **message itself** is configurable per rule **per channel** — an SMS is not a shortened email. Requirements: merge tokens with click-to-insert and a preview that substitutes sample values; unrecognised tokens flagged rather than silently dropped; SMS character and segment counting against the 160-character limit; channel switching must not lose unsaved text; an empty message is refused; each template records whether it is default or customised, by whom and when, and can be reset.

**Export.** Every export must produce a **file**, not a confirmation message. Requirements: a dialog naming the columns to be written; a scope choice between the filtered on-screen view and the complete set, stating how many records are hidden; CSV and JSON formats; values taken from the **record**, not the rendered HTML, so a status exports as its code rather than as a chip's label; action columns omitted; commas, quotes and newlines escaped correctly. Screens that are charts rather than lists must register the data set behind the chart so they remain exportable.

### 4.15 Audit Trail (ADM)

Every consequential action is recorded. The trail is **append-only** — there is no edit path and no delete path for any role, including the platform owner, because a log that can be changed is not evidence.

- Around fifty auditable actions across onboarding, catalogue, commercial, settlement, orders, access, security, governance and account categories.
- Each entry records actor, role, action, object, before and after values, outcome, timestamp and session.
- **A refused attempt is recorded as carefully as a success.** Someone trying to act outside their role is the interesting event.
- **Read access is scoped by role, not by portal.** A support agent seeing a settlement approval, or one seller seeing another's onboarding, would be a data breach dressed up as transparency. A role with no audit categories is **refused the screen**, not shown an empty table.
- Where a role lacks personal-data access the entry is **redacted, not hidden** — the reader still sees that something happened and when. **Your own actions are never redacted from you.**
- Reading the audit log is itself audited, and is itself a permission in the roles matrix.
- Retention is stated per portal. The prototype is honest that a production trail needs hash-chained append-only storage and export to a SIEM outside the control of those it audits.

### 4.16 Storefront Advertising (ORD — PRD §4.3 login banners, expanded)

Modelled as a small ad server rather than a hard-coded hero image, because that is what "put a picture on the login page" becomes within a quarter.

- Four slots: login screen, storefront hero, storefront strip, category header — each with a stated size, a cap and its own targeting capability.
- Targeting on audience, region, device and date range, with a share-of-voice weight; one banner shows per slot at a time, chosen by weight among those eligible.
- **The login slot is seen before sign-in, so nothing personal is available there** — only locale and device. Anything more would mean identifying someone who has not identified themselves.
- **Sellers cannot buy placement.** Slots are allocated by the operator, not sold, and the console says so.
- Alt text is mandatory. Impressions, clicks, click-through and attributed revenue per banner; a live banner with no measurement is flagged as decoration rather than a campaign.
- Attributed revenue is same-session only and is labelled an upper bound — a buyer who was going to buy anyway still clicks.
- Buyers get a **"why am I seeing this"** explanation naming the audience, and stating that browsing is not profiled.

### 4.17 Inventory (INV)

Stock was a display field. It is now a ledger.

- Per line: on hand, reserved, **available (on hand less reserved)**, reorder point, inbound quantity and due date, warehouse, unit cost and last count date.
- **Availability shown to a buyer is derived from the ledger**, so the storefront cannot promise what the warehouse does not have. A line fully reserved against orders in flight reads as out of stock while units are physically present, and the UI explains why.
- Adding to a basket is **capped at availability**; an out-of-stock line is refused rather than discovered at fulfilment.
- Soft holds at basket, hard reservation at payment, decrement at dispatch — so a cancellation before shipping returns the units rather than losing them.
- Append-only movement ledger: receipts, dispatches, counts, returns, write-offs, transfers, each with actor, reason and reference.
- SIM pool as inventory with a lifecycle — available, reserved, activated, retired — with batch loading. Retired profiles cannot be reissued.
- Logical capacity pools (pooled data, analyst seats, cloud storage) with utilisation alerts, because capacity that runs out is inventory in every sense that matters.
- Sellers see only their own stock; the operator sees everything.

### 4.18 Ticketing and SLA (SUP)

Disputes were the only case type. This is the general queue.

- Eight categories, each with its own first-response and resolution targets and an owning function. Four priorities, which **multiply the category target rather than replacing it** — a P1 billing query is still slower than a P1 outage, which is correct.
- **The SLA clock pauses while the ticket is waiting on the requester** and resumes when they reply. Without that, the queue metric measures how quickly customers answer us.
- Reassignment does not restart the clock. Escalation does not restart the clock. Resolving a breached ticket does not remove the breach from the record.
- A four-step escalation ladder that fires **automatically** — a ladder depending on someone noticing works on quiet days only. The requester is told when a ticket is escalated.
- Threaded conversation with agent, requester and system entries; internal notes marked as not visible to the requester.
- A resolution requires an explanation. Tickets are visible only within the raising organisation; the operator sees all.

### 4.19 Customer Reviews (CAT)

- **Only a verified buyer may review**, checked against orders rather than taken on trust. One review per buyer per product.
- Star rating, headline and body, with minimum lengths — a one-word review helps nobody.
- **Moderated before publication**, with a light automated check for personal data that prompts a human rather than deciding.
- **Reviews are checked for content, not sentiment.** A one-star review describing a real problem is published; rejecting for negativity is not a permitted reason, and every rejection reason is recorded against the moderator.
- Sellers may reply publicly and cannot remove a review.
- Aggregate ratings blend the historical count with published reviews. **A pending review does not move a rating** — otherwise moderation would be pointless — and the UI states how many older reviews are counted but not individually reproduced.

### 4.20 Partner Portal Branding (PMP — PRD §4.1)

- Display name, logo with mandatory alt text, colour presets or custom primary/accent/navigation colours, and light or dark theme.
- **Contrast is checked, not trusted.** A palette below WCAG AA cannot be applied, and the seller is told which colour fails and by how much.
- Dashboard card selection, with **three cards that cannot be hidden** — orders to fulfil, onboarding progress and open disputes — each with the reason stated, because hiding them does not make the work go away.
- **Scope is stated explicitly**: the seller's console is theirs; listings carry their name and logo in the marketplace's layout; the storefront, checkout and settlement documents stay in the marketplace's livery. A checkout that restyles per seller erodes the trust the marketplace exists to provide.

---

### 4.21 Developer Portal — Partner Integration Access (APG)

The marketplace publishes APIs so that partners can integrate rather than log in. **This is access, not a product line.** A seller already has the right to read its own catalogue, take its own orders, post its own stock and pull its own settlement — the API is a second way to do what the console already allows. Nothing here is sold, metered against revenue, or upsold.

- **Seven API products**, each mirroring something the console already does: Catalogue (TMF620), Orders (TMF622), **Subscriptions (TMF637)**, **Inventory (TMF685)**, Settlement (TMF678), Party (TMF632) and Event subscriptions (TMF688 / AsyncAPI). Each declares the standard it implements and its lifecycle state; beta and preview are labelled rather than quietly published.
- **Two environments.** *Sandbox* — test records only, reset weekly, no availability commitment, open from the technical gate onward. *Production* — live records, every call audited, 99.5% monthly.
- **Production is earned, not requested.** It is granted when the technical gate clears and one sandbox order has completed end to end (§4.37). That single requirement removes most go-live failures.
- **Access tiers are entitlements, not price bands** — Sandbox only, Live seller, High volume, Enterprise buyer. Which tier a partner holds follows from where it is in onboarding and what it sells, and changes when that changes. **No tier carries a price.**
- **Rate limits protect the platform, not a paywall.** Exceeding one sheds and queues at the edge and tells the partner; it never cuts a seller's order flow off, because that turns a capacity problem into a customer-facing failure.
- The seller sees the same thing from its side: its current tier, environment, base URL, scopes granted, and what still stands between it and production.

**APIs are authored, versioned and subscribed to.**

- **An API is published from the console**: identifier, name, the standard it implements, who it is for, what it does, **why it exists**, scopes, method count, environments and lifecycle state. If the "why" cannot be answered in one line, the API probably should not be published. An identifier is fixed once published — it appears in every base URL.
- **Every API carries a version history with a changelog.** A version with no changelog is refused, because a version nobody can diff is not a version.
- **A breaking change is a new major version, never an edit.** The consumers already calling the current version did not agree to a correction landing underneath them. The editor states this and the dialog distinguishes additive from breaking, warning that a breaking change means consumers migrate deliberately — they are not moved for them.
- **Four version states**: current, supported, deprecated (with a mandatory sunset date), sunset. **Deprecating names the consumers still on it**, and the screen flags any subscription left on a version past its prime — a sunset date nobody has been moved off is a date you will end up moving.
- **A subscription matrix** shows APIs down the side and consumers across, with the version each is on and deprecated versions in amber, backed by a filterable table of every subscription with scopes, environment, volume and start date.
- An API with **no subscribers at all** is flagged: either nobody needs it yet, or it was published without a partner asking for it.

### 4.22 Listing Versioning and Contract Pricing (CAT)

- **Every listing carries a version history.** Price, description, media and commercial terms are versioned; exactly one version is live at a time; a listing nobody has changed still has version 1.
- **A rollback creates a new version rather than deleting one.** History is never rewritten — the record of what a buyer could have seen on a given date is what makes a pricing dispute resolvable.
- The history states **what changed between two consecutive versions**, field by field, not merely that a change occurred.
- **Contract pricing** binds an account, a SKU, a negotiated price, a minimum quantity and a term. It applies to that account only; every other buyer sees list.
- **An unsigned contract price is recorded but not applied.** Recording the negotiated number before signature is useful; charging it is not. The buyer sees the record, the status and the rule.
- Contract price interacts with the discount engine at the floor defined in §4.8 — a contract price below cost is refused at authoring, not at checkout.

### 4.23 Product Comparison (CAT)

- Buyers may compare up to **three** products side by side — price, rating, availability, fulfilment, seller and term.
- **Three is a deliberate cap.** A comparison table wide enough to need scrolling stops being a comparison.
- The most favourable cell in each row is highlighted, and the table **states that the highlight is not a recommendation** — it is arithmetic on one dimension, and the dimension that matters is the buyer's to choose.
- Each column can be added to the basket directly, so the comparison ends in a decision rather than a dead end.

### 4.24 Warehouse System Integration (INV)

- Each warehouse in §4.17 is bound to a **warehouse management system** with its own sync state, last-sync time and mode (real-time, batch, or delegated).
- **Drop-ship is declared as delegated, not measured.** Where the seller ships from their own stock, the marketplace reports what the seller reports and says so, rather than presenting a figure it cannot verify.
- **Drift between the WMS count and the marketplace ledger is surfaced, not reconciled silently.** Where they disagree, **the physical count wins** and the ledger is adjusted with a movement record — a silent correction destroys the audit value of the ledger.
- **Shipments** carry carrier, tracking reference and status, and a carrier exception is shown as an exception rather than as an in-transit shipment that is quietly late.

### 4.25 Audit Integrity and SIEM Export (ADM)

Extends §4.15 from append-only-by-behaviour to append-only-by-evidence.

- Every audit entry is **hash-chained** to its predecessor. Altering an entry breaks every hash after it.
- The chain head is **anchored daily to object-locked storage**, so a compromise of the application cannot silently rewrite yesterday.
- **The point is detection, not prevention.** A permission stops the people who respect permissions; a chain makes tampering by anyone — including an administrator — detectable after the fact.
- **Verification is available on demand**, reports the number of entries checked and any gaps, and **is itself written to the audit log**. An integrity check nobody can see having run is not a control.
- Entries are **streamed to external SIEM destinations** (Splunk, Sentinel, an S3 archive). A destination running behind is flagged with its lag rather than shown as healthy.
- **The external copy is the control that matters.** An audit trail held only in the system being audited is evidence of good intent, not of what happened.

### 4.26 Dunning and Collections (ORD)

- A **seven-step ladder** runs from a soft retry through reminders, a final notice, suspension and referral, each step with a defined day, channel and action.
- **Service is not interrupted until day 14.** Suspending on day three collects a little cash and loses the customer; involuntary churn costs more than the receivable.
- **A retry against an expired card never succeeds.** The system records the attempt, declares the reason, and asks for a new instrument instead of burning the ladder on retries that cannot work.
- **A promise to pay pauses the ladder where it stands and resumes from there** if broken. Restarting the ladder rewards a broken promise with a fresh set of reminders.
- The consumer sees the failure on their own account, **told plainly what has and has not been interrupted** — a dunning notice that does not say whether service still works generates a support call.
- Cases carry amount, age, attempt count, reason and the responsible collector, and every action is audited under §4.15.

### 4.27 Revenue and Spend Projection (ADM / BIL)

Every persona is shown a forward view built from its own history, never from the marketplace total.

| Persona | Projection | Framed as |
|---|---|---|
| Operator | Revenue projection (GMV and commission) | Planning input, explicitly *not* a board-pack figure |
| Partner | Settlement projection | Explicitly *not* a payment schedule |
| Enterprise | Spend projection against annual budget | Excludes anything still in approvals, stated |
| Consumer | What current commitments will cost | Explicitly *not* a bill |

- Method is **linear trend over the trailing six months, adjusted by a seasonal index, with a confidence band**. The panel **states the method** rather than presenting a number of unexplained provenance.
- **Accuracy is measured, not asserted.** The same method is backtested — forecasting the last three months from the prior nine — and the resulting error is printed on the panel. A forecast that will not say how wrong it was last quarter is a decoration.
- Assumptions are listed (partner mix, no category launch or withdrawal, no pricing change), because a forecast is only as good as the conditions under which it holds.

---

### 4.28 Authentication, Sessions and Single Sign-On (IAM)

The marketplace has a real gate. Nothing behind it renders until a session exists.

- **Local credentials, TOTP, passkey and SMS** are all supported. Passkeys are marked phishing-resistant; **SMS is labelled the weakest option** with the reason given, because it is offered to users who have nothing else, not because it is good.
- **MFA is mandatory for roles that move money or change access** and cannot be waived by those roles for themselves.
- **Lockout counts failures per account, not per address.** Counting per address protects an attacker with a botnet and punishes an office behind one IP.
- **Failures are logged as carefully as successes**, distinguished by kind — password rejected, code rejected, locked, blocked, refused — and written to the audit trail at a severity matching the event.
- **Single sign-on, where enforced for a domain, closes the local password path for that domain.** An enforced identity provider that still accepts a password enforces nothing. The login screen for such a domain offers no password field at all.
- **Certificate expiry is surfaced as an operational risk.** When an SSO signing certificate lapses, every sign-in on that domain stops at once — the most common cause of a self-inflicted outage in enterprise identity.
- **Step-up re-authentication** is required before a defined list of sensitive actions — settlement approval, changing a payout bank account, granting or revoking a role, exporting personal data, rotating an API key. A signed-in screen left unattended must not be able to move money on its own.
- **Sessions** are listed with device, location, address, start, last-seen and the method used. Unusual locations are flagged. Ending a session signs that device out and **is stated not to be a password change** — if the password is what leaked, that must be changed too.
- Signing out drops the current session only and returns to the gate.

### 4.29 Number Management and Logical Inventory Integration (INV)

**ICCID, IMSI and MSISDN are not owned by the marketplace.** They live in the operator's Number Management and Logical Inventory systems in the BSS. The marketplace holds a reservation and an assignment reference against an order; the BSS holds the resource and its true state.

- Standards: **TMF639 Resource Inventory**, **TMF652 Resource Order**, **GSMA SGP.22 ES2+** for the eUICC side.
- Systems are registered individually with the resource types they own, their interface, sync mode (real-time, batch), sync state and measured latency. **Latency that is not measured says so** rather than showing zero.
- A **degraded system holds reservations rather than confirming them.** A held reservation is honest; a confirmed one the marketplace cannot back is not.
- **Reserved ranges** carry from, to, size, reserved, assigned, expiry and purpose. **Utilisation is measured against reserved, not against range size** — measuring against the whole range flatters the figure and hides the moment a reservation is about to run out.
- **The ICCID screen is a query result, not the inventory.** A pool of twelve thousand SIMs does not belong in a browser, and a screen that loads it all implies the marketplace holds them.
- **Assignment goes through TMF652.** For an eSIM, assignment creates a profile at the SM-DP+ in `released` state. It is **not** claimed as installed or enabled — those are the device's transitions to make.
- The **SGP.22 lifecycle** is rendered with the states the standard defines and no others. Inventing a friendlier state would make the screen unreconcilable with the SM-DP+ report.
- **Release deletes the eSIM profile and says that a deleted profile cannot be recovered.**
- **Reconciliation runs nightly.** Where the marketplace and the BSS disagree, **the BSS is right and the marketplace is corrected — never the other way round.** No bulk file and no reconciliation job writes to the BSS.
- A seller sees **allocations against its own orders**, never the pool. Browsing unassigned stock is not a seller function.

### 4.30 Channel Delivery and Receipts (NTF)

Templates, tokens and rules are covered in §4.14. This is the transport.

- **Providers are registered per channel** with protocol (SMPP 3.4, REST, SMTP/API, Graph, FCM HTTP v1), sender identity, throughput, unit cost, measured success rate, region and whether the channel returns a delivery receipt at all.
- **Primary and failover are distinguished**, and failover is automatic after a defined number of attempts.
- **Push has no true delivery receipt.** The platform confirms acceptance, not that a handset displayed anything. Its rate is reported separately and **is not averaged into a platform-wide delivery figure** — averaging a measured number with an unmeasurable one produces a number that means nothing.
- **Delivery states keep the transports' own names** — queued, submitted, sent, delivered, read, failed, expired, no receipt. Renaming them into something friendlier would make the log impossible to reconcile against a carrier's own report, which is the only reason anybody opens it.
- **Retry policy**: three attempts with 60 / 300 / 1800-second backoff, failover after two. **Hard rejections are never retried** — invalid number, unsubscribed, blocked, template rejected. Retrying an invalid number three times produces three charges and no message.
- Resending a hard rejection is possible but **warns that it will fail the same way and points at the underlying record instead**; the override is audited at warning severity.
- **Cost is reported per channel, per message and per thousand.** Stale push tokens from uninstalled apps are separated out rather than folded into a failure rate, because they cost nothing and are not worth chasing.
- Each persona sees **only its own traffic** and is not shown provider commercials.

### 4.31 Bulk Update (ADM)

Available to every persona, scoped to what that persona may already change one at a time.

- **Two doors, one engine.** A CSV changes different values on many records; a common update sets the same value on a chosen set. Both run through the same validator, the same dry run and the same commit, so a rule cannot be enforced on one path and forgotten on the other.
- **Bulk updates existing records. It never creates and never deletes.** Creating a thousand records from a spreadsheet is a different, riskier operation and does not belong behind the same button.
- **A dry run is mandatory.** Nothing is written until the operator has seen, row by row, what would change — old value and new value against each field.
- **A bad row is rejected on its own.** Holding back four thousand good rows because three are wrong is not a safety feature. A file where **more than 20% of rows fail is refused outright**, because that is a wrong file rather than a set of typos.
- **Every rule the single-record path enforces is enforced here.** A sale price below cost is refused; a stock count below what is already reserved is refused; a role outside the account is refused; an enum outside its permitted set is refused with the permitted values named.
- **You cannot change your own role or status in a bulk file.** Removing your own access by spreadsheet is the one mistake nobody can undo for you.
- **A blank cell leaves a value alone.** An unrecognised column is reported and ignored — silently accepting a column nobody defined is how a spreadsheet quietly overwrites the wrong field.
- **Templates download pre-filled with current values**, so an edit is a diff rather than a retype.
- **A job is one audit entry, not one per row.** A four-thousand-row import that writes four thousand entries buries every other event of that day. The entry names the job and the counts; the job keeps the rows.
- **Nothing is preselected in a common update.** A bulk action that starts with everything ticked is a bulk action waiting to go wrong.
- **Scope is deliberately uneven.** The operator gets five sets; a retail account gets one, and **bulk cancel is not offered** — turning auto-renew off is reversible, cancelling is not.

---

### 4.32 Listing Rule Catalogue (CAT)

§4.2 sets a rule's **level** per category. This section covers authoring the rules themselves.

- Each rule declares **what it requires**, **how it is checked**, **why it exists**, **who owns it** and **what evidence** the seller must supply. A rule with no owner is a rule nobody maintains.
- **Four check types**, and the choice is a cost decision, not a formality: *automated* (no reviewer time), *external* (no reviewer time but a third-party dependency, so submissions queue rather than fail if it is down), *document* (about four reviewer minutes, blocks until evidence arrives), *manual* (about nine reviewer minutes on every listing it touches).
- **The editor states the reviewer cost before you save it.** Nine minutes across a four-hundred-listing category is sixty hours per pass — a headcount decision rather than a policy tweak.
- The **rule × category matrix** puts every rule against every category in one grid, each cell cycling off, warn, enforce. Without it, answering "where does this rule apply" means opening six inspectors.
- **Some rules are not the marketplace's to soften.** Sanctions screening is locked at enforce in every category; a screen that lets an operator switch it off implies they may.
- A new rule is **created as a draft and applies nowhere** until it is placed in the matrix.
- **An active rule applied to no category is flagged**, because a rule switched on nowhere checks nothing while still looking like a control.
- A rule is **retired, never deleted**. Historical review decisions cite it, and a decision citing a rule nobody can look up cannot be audited. Retiring removes it from every category and from new submissions, but **listings already rejected under it stay rejected — retirement is not an amnesty**.

### 4.33 Per-Seller Listing Cap (CAT)

- Each category carries a **maximum number of live listings one seller may hold** — tightest where vetting is heaviest (Security 40, Partner 60) and loosest where it is automated (Device 400, Consumer 250).
- **Live and paused count against the cap; withdrawn and rejected do not.** A paused listing still occupies a slot the seller can restore in one click. Counting rejections would mean a seller could never recover from a bad submission.
- **Enforced at submission and in the bulk path**, not merely recorded. The wizard shows remaining headroom when the seller picks the category, warns at five slots left, and blocks at zero with the count and the cap stated.
- The listing wizard's review step states which number this listing will be — "this will be 41 of 120 permitted IoT listings" — so the seller is never surprised at the end.

---

### 4.34 Knowledge Base and Guided Walkthroughs (SUP)

Every portal carries its own help centre, written for what that persona actually does.

- **Articles are scoped to the persona**, not filtered from one shared library. The operator gets ten covering onboarding, catalogue review, rules, commission, settlement, numbering, delivery, audit and bulk; the seller eight on listing, settlement, fulfilment, stock and branding; the buyer six on requisitions, contract pricing, bulk users and invoices; the consumer six on buying, subscriptions, payments, reviews and account security.
- **Five kinds** — getting started, how to, how it works, rules and limits, and when it goes wrong — filterable, with a full-text search across titles, summaries, tags and body.
- **An article names the screen it is about and can open it.** Help that describes a screen without taking you there is a manual.
- **Articles are role-scoped for action, not for reading.** Anyone may read any article; a reader whose role cannot perform the task is told so and told which role can, rather than being walked toward a button that is not on their screen.
- **Guided walkthroughs drive the application.** Each stop navigates to the screen it describes — or opens the drawer, where the step is a drawer rather than a screen. Annotated screenshots go stale the moment a screen changes; navigation cannot. Closing a walkthrough leaves the user where it left them.
- **Contextual help follows the user.** A help control in the top bar opens the article for the screen currently open. Where nothing covers that screen, it says so and opens the catalogue rather than failing silently.
- **Review dates are declared.** An article past its review window is marked as needing review rather than sitting there looking current.
- **Usefulness is counted, not invented.** An article nobody has rated shows no score rather than a flattering default.
- **Every article ends in a route to support**, pre-filled with the article it came from — the articles that fail are the ones worth knowing about, and an anonymous "was this helpful" click does not tell you which one.

---

### 4.35 Documents, Statements and Bill Templates (BIL)

Every download produces a real file. A button that yields a toast, or an empty file, teaches the user that the buttons are decorative.

- **A PDF writer is built into the platform layer** — no library, no service call. Documents carry selectable text, correct pagination, running headers and page numbers.
- **Brand artwork is embedded, not redrawn.** The approved marks are decoded once at build time into an image stream and an alpha mask, and placed in the document as images.
- **Documents are built from the record on screen**, so what downloads is what the person is looking at.

**The bill is a template system, not a layout.** A bill is the most-read document the marketplace produces and, for many customers, the only one they ever see.

- **Fourteen switchable sections**: masthead and logos, both parties, amount-due panel, subscriptions and recurring, usage and one-off, credits and adjustments, taxation, summary, payments received, how to pay, support and contact, advertisement, terms and conditions, payment slip.
- **Four cannot be switched off** — masthead, both parties, taxation and the reconciling summary. A document without them is not a bill, whatever it is called.
- **Multiple templates, managed by the operator**: create, duplicate, configure, preview and delete. Built-in templates can be reconfigured but not deleted, because an audience with no template has no bill. Five ship by default — Consumer standard, Enterprise consolidated, Seller self-billing, Compact totals-only, and a Regulator format.
- **Assigned per audience, overridable per partner.** The default for consumer, enterprise and seller bills is set on the billing configuration screen; a named partner can be pinned to a different template.
- **The editor pushes back.** An advert on an enterprise or seller document, a payment slip on a self-billing invoice (the marketplace pays the seller, not the reverse), a slip without payment instructions, or a bill with no support block each raise a specific objection.
- **Preview generates a real document** on that template, so a change can be seen rather than imagined.
- **Both parties in full** — registered name, address, tax registration, named contact and telephone on each side, plus issue date, due date, terms and status.
- **Provider support is on the bill**, because a bill is where people look when something is wrong with a bill: telephone with hours, email, portal, the dispute window, and the escalation address if it is unresolved.
- **One relevant advertisement**, drawn from a dedicated bill slot in the advertising engine. **Never on a bill that is chasing money** — selling to somebody in arrears reads as tone-deaf, and on a final notice as predatory.
- **Ten numbered terms** set in two columns, and a **detachable payment slip** below a tear line.
- **PDF in every persona.** Consumer bills, enterprise consolidated invoices, seller self-billing invoices and settlement statements all produce a formatted document; the CSV remains alongside it, because finance reconciles from the data and pays from the document.
- **Zero is written as zero.** A credit of nothing is `$0.00`, never `-$0.00`.

### 4.36 Partner API Registry (APG — inbound)

The counterpart of §4.21. That publishes what the marketplace offers; this records what each partner exposes back, so the marketplace can tell them an order arrived, a subscription renewed or a payment failed.

- **The marketplace calls the partner; the partner never polls.** Each seller registers its endpoints in its own console, and the operator sees the whole estate in one place.
- **Twenty-three marketplace events across five groups** — Order (placed, amended, cancelled, returned, fulfilment requested, fulfilment overdue), **Subscription (activated, renewed, plan or seat change, suspended, resumed, cancelled, renewal approaching)**, Catalogue, Finance (statement, payout, customer payment failed, refund) and Support.
- **Required is relative to how a seller fulfils.** A subscription event is mandatory for a seat-based service and meaningless for a one-off shipment, so the coverage matrix marks it *not applicable* rather than as a gap.
- **A coverage matrix answers the one question the operator cannot otherwise answer**: if this event fires tonight, who hears about it and who does not.
- **An unhandled required event is not queued and not retried later — it does not arrive.** That is why gaps are counted on the screen rather than discovered when a customer complains.
- **Callback policy is platform-wide, not per partner**: five attempts with stated backoff, unhealthy after three consecutive failures, suspended after 24 hours unhealthy on a required event. **Suspension stops the calling, not the selling** — listings stay live and orders route to manual fulfilment, because taking a seller off sale for their webhook outage punishes the buyer.
- Every call out is logged with event, reference, attempts, response code and outcome — the evidence when a seller says they were never told.

**The event catalogue is configuration, not a property of the platform.** Each event is authored: id, label, what it means to the seller, group, payload fields, whether it carries personal data, whether it is mandatory, and which fulfilment models it applies to.

- **Marking an event mandatory is the decision that matters.** It creates no work for the marketplace — it puts every seller without an endpoint for it out of compliance the moment it is saved. The editor therefore computes that blast radius live, names the affected sellers, and shows it **before** the save rather than after.
- **A published id is never editable.** An endpoint subscribes to the string.
- **Three states.** A *draft* is published to nobody, cannot be subscribed to, and — the subtle one — **creates no compliance gap**, because an event nobody can hear cannot oblige anybody. *Active* is published. *Deprecated* is still delivered to endpoints already subscribed, offered to nobody new, and ceases to be mandatory.
- **Deprecated, never deleted.** A subscription pointing at an id nobody can look up cannot be diagnosed.
- An event that is **mandatory with no subscribers**, or **mandatory with no fulfilment model** (and therefore mandatory for nobody), is flagged on the screen.

### 4.37 Integration as a Tested Onboarding Milestone (PMP / APG)

API registration belongs **inside** onboarding, not beside it. The technical readiness gate is not a review of what the seller claims; it is four things the marketplace verifies for itself:

1. an endpoint registered for **every event their fulfilment model requires**;
2. **authentication on every endpoint** — order payloads carry buyer data, so an unauthenticated endpoint is a data leak with a URL;
3. **a signed test call acknowledged** on each endpoint — registration proves intent, an acknowledgement proves it works;
4. **one sandbox order carried end to end** — created, acknowledged, fulfilled, settled.

- **The gate cannot be cleared until all four hold, and there is no override.** A seller who reaches go-live on an unproved integration produces a customer-facing failure on day one, and the person who cleared the gate caused it.
- The milestone is shown **where the decision is made** — on the onboarding record — not on a separate screen the reviewer may never open.
- **The sandbox run reports where it failed, step by step**, and the gate reads the latest run rather than the best one.
- The onboarding desk may register endpoints **on the seller's behalf**, but a plaintext URL is refused and an untested endpoint still fails the milestone.

### 4.38 Operator-Led Onboarding (PMP)

Not every seller self-serves. A large one negotiated in a meeting room, an acquisition, or a partner without the appetite for a portal — the desk captures the same detail on their behalf.

- The same fields a self-serving seller would supply: legal entity, registration number, country, contact, categories, expected volume, commission plan, bank, tax residency and a fulfilment endpoint if they already have one.
- **The same gates.** Capturing the application skips the typing, never the verification — KYC opens immediately and agreements, bank and tax, and the integration milestone all still have to clear. An onboarding path that also skipped the checks would be a way round the controls rather than a convenience.
- **A reason is mandatory.** An operator-created application must be explicable a year later, so the desk records why it did this rather than the seller, and the submission is readable at the gate exactly like a self-served one.
- The record is marked as desk-created and attributed, and the creation is audited.

---

### 4.39 Dunning Ladders per Customer Type (ORD)

One ladder for every account was wrong. A consumer owing $42 on an expired card and an enterprise owing $14,520 under a signed contract are not the same collections problem, and chasing them identically loses the first to churn and insults the second.

- **A ladder per customer type**: consumer, small business, enterprise buyer and seller, plus **value bands** — a retail balance above $500 is worth a phone call before it is worth a suspension.
- **Which ladder a case runs on is resolved from the account, not chosen by a collector.** The most specific match wins: a band that fits beats a plain segment, so a high-value account is paced differently without anybody remembering to move it.
- **The pacing genuinely differs.** A consumer is suspended at day 14; a contracted enterprise not before day 60, because a missed invoice there is usually a purchase-order delay. **A seller is never suspended at all** — settlement is withheld instead, because taking their listings down strands a buyer mid-order.
- **A step editor** with day, action and channel, ordered by day on save regardless of entry order.
- **The editor refuses the mistakes that cost money or customers**: suspending a consumer before day 14, suspending a contracted enterprise early, a ladder with no terminal step (a case that never ends), a ladder that restricts or suspends without ever telling the customer, and two steps on the same day.
- **A ladder must state why it is paced that way.** A collections policy that cannot explain itself gets overridden case by case until it means nothing.
- **A change applies from a live case's next step, never retrospectively.** Nobody is jumped forward or suspended earlier than the step they have already reached.
- A ladder with live cases **cannot be retired**, and retiring is not deleting, so a past case still names a ladder that can be looked up.

### 4.40 General Ledger — Configuration, Mapping and Postings (BIL)

Every charge has to land somewhere, and a marketplace is harder than a shop: **most of the money passing through it is not its revenue.**

- **A chart of accounts** across asset, liability, revenue, expense, tax and contra.
- **Seventeen charge types** grouped by order, fees, settlement, subscription, commercial, collections and operations — each mapped to a debit and a credit account **with the reasoning recorded**, because a mapping nobody can defend at audit is one that gets changed under pressure and never changed back.
- **The accounting judgement that matters**: gross collected on a seller's behalf credits a **liability**, not revenue. Only commission, platform fees and advertising are earned. Booking gross to revenue would overstate income by roughly the size of the marketplace. Tax collected credits a tax account and is never revenue; a refund is a **contra** against revenue rather than a silent netting.
- **The screen separates what passed through from what was earned**, and reports both.
- **Postings are generated from the order register and settlement runs**, so the ledger reconciles to them rather than being invented alongside them.
- **A trial balance that must net to zero.** Every posting is a debit and a credit of the same amount, so the two columns must agree — arithmetic rather than opinion, and the check that catches a broken mapping before a close does.
- **A mapping change cannot post to the same account on both sides** (that posts nothing) and **cannot be saved without a stated reason**. Existing entries are never rewritten: a ledger that restates itself is not a ledger.
- **Period close is blocked while the columns disagree.** After close, a correction is a journal in the next period, never an edit to a closed one.

### 4.41 Warehouse Configuration and Shipment Provenance (WMS)

- **Warehouses are configured, not assumed.** Type, address, timezone, despatch cutoff, capacity, the countries and categories they serve, and the tax registration that makes an invoice valid from that site.
- **Routing rules map inventory to a warehouse** by category and destination, so a listing does not promise next-day delivery from a site that does not stock it.
- **Every shipment names its purchase order, who despatched it and who receives it.** A shipment record without those cannot be chased, and the person chasing it is rarely the person who booked it.
- **A drop-ship site is declared as delegated rather than measured.** The stock is not ours and the count is the seller's, so reporting a capacity figure for it would be inventing one.
- **Returns are a warehouse with a system link like any other.** Returned stock that sits in no ledger is stock nobody can sell. Returns drift more than forward stock, because a unit is counted when booked in and again when graded — and the physical grade is what decides whether it can be sold again.

### 4.42 Channels (NTF)

A **channel** is what the customer experiences. A **provider** is what carries it. Keeping them apart is what lets a carrier be replaced without a single dunning ladder or notification rule changing.

- **A managed channel master** rather than a hard-coded list of combinations: name, type (digital, telecom, human, physical, no contact), the transport that carries it, and a note on when to reach for it.
- **A dunning step names channel ids**, so switching a channel off removes it from every ladder at once instead of leaving steps promising something the platform will not send.
- **Disabling a channel a ladder uses must be confronted.** The dialog names the affected ladders before it will proceed; it does not rewrite them, because what replaces a channel is a decision somebody has to make.
- **Two failure modes are distinguished.** A step whose channels are *all* off is **dark** — it runs and reaches nobody. A step that has lost *one* of two is **degraded** — it still sends, so nothing looks broken, but it is no longer reaching people the way the policy was written. The second is the more common and the more dangerous, and it is named on screen.
- **A digital or telecom channel cannot be created without a transport**, and two channels cannot share a name, because either makes every ladder ambiguous.
- **A disabled channel stays listed rather than being deleted**, so the reason a ladder once used one is still readable.
- **Channels are the operator's to manage.** Sellers see the list read-only; customers do not see it at all.

### 4.43 Collections Ownership Between Marketplace and Seller (BIL)

Three rules, in order, and the first that matches wins:

1. **Money a seller owes the marketplace runs on the operator ladder.** A debtor does not set the terms of their own recovery.
2. **Anything sold inside an operator-assembled bundle runs on the operator ladder**, whatever the seller has configured. One merchant of record, one bill, therefore one suspension date — two ladders chasing one balance produce two dates and the customer believes whichever arrived first.
3. **Everything else the seller sold directly is the seller's to pace.** It is their revenue and their relationship.

- **Every seller is given a ladder at onboarding**, chosen from the **category profile** they sell in — retail subscriber, content subscriber, device instalment, IoT deployment, managed security, or reseller downstream. What recovers money from a games subscriber is not what recovers it from a fleet installer, and a seller should not have to invent a collections policy on their first day.
- **They may run it as provided, edit it, or add more.** Seeding is idempotent: it never overwrites what a seller has changed.
- **A seller ladder that does not cover a segment falls back to the marketplace default** rather than silently leaving a case unchased.
- **Whatever a seller ends up with is visible to the operator**, with **drift against the published default** shown — a seller who has doubled every interval is telling us their customers are not like the ones the default was written for. A marketplace that cannot see how its sellers chase a shared customer cannot answer a complaint about it.
- **A seller may read the marketplace ladders that override theirs, and may not change them.** The pacing that overrides yours is the thing you most need to be able to predict.
- **Collections in the seller console separates three things**: cases they pace, cases the marketplace paces on their behalf, and what they themselves owe the marketplace. Adding those into one reassuring total would hide the only one they can act on.

### 4.44 Credit and Debit Notes, and Customer Refunds (BIL)

Two adjacent instruments, deliberately kept apart.

**A credit or debit note is between the marketplace and a seller.** It corrects a settlement already struck — commission at the wrong rate, an SLA penalty, agreed promotion funding. No customer, no card, no money moving on its own; it changes the balance the next run pays or collects, which is why it has to be raised before the run closes.

- **Configurable thresholds**: auto-approved below a floor (making somebody sign for a $12 rounding difference teaches them to sign without reading), a **second approver** above a ceiling, and **evidence mandatory** above a middle band. The second-approval threshold cannot be set below the auto-approval one.
- **A debit note is the only adjustment on the platform that increases our own revenue**, which is why it carries the heaviest justification and the highest audit severity.
- **A seller can dispute a note, and a disputed note does not settle while it is open** — it cannot be quietly deducted while the argument continues.
- **Voiding is available for a fixed window.** After that the only correction is an opposing note, which leaves both on the record — usually the more honest outcome anyway.
- **GL treatment**: a credit note debits revenue and credits the seller clearing liability; a debit note does the reverse. Neither posts until it has actually landed — a draft or pending note is a proposal, not a fact.

**A refund is between a customer and whoever sold to them.** Money returns to the instrument that paid; store credit is not offered in place of a refund a customer is entitled to, because that converts a legal obligation into a marketing one.

- **The owning seller approves refunds on their own products.** It is their revenue being handed back, so it is their decision — and it is recovered from their settlement either way.
- **The marketplace decides** where the product is first-party, where the sale was inside a bundle it assembled, where the seller has not answered within the response SLA, or where a customer has escalated a decline. The marketplace can overrule a seller on escalation.
- **Silence costs the seller the decision, not the money.** Past the SLA the marketplace answers and still recovers from the seller's settlement.
- **Auto-approval for the things that are never a judgement call** — a duplicate charge, a non-delivery, or an amount below a floor where arguing costs more than refunding. The record states *every* reason that applied, not just the first.
- **A decline requires a written reason**, and a part refund requires an explanation of the difference. A decline without a reason gets escalated and then decided by somebody with less information.
- **Refund windows are published per category**, because a digital entitlement already consumed cannot be un-consumed. A fault does not expire with the window.
- **API surface**: `AP-ADJ` (TMF666 / TMF678) lets a seller read notes, dispute one, and decide refunds programmatically — a 48-hour clock is not something a seller with volume can service in a browser. Decisions are **idempotent on the request id**, so a retried approval never refunds twice, and a decline without a reason is rejected by the API exactly as it is by the console. Events `refund.requested` and `note.issued` are **mandatory**; `refund.escalated`, `refund.overturned` and `note.voided` are optional.

### 4.45 Ladder Scope — Marketplace and Product Category (BIL)

A customer type is a blunt instrument. A $40 balance behaves very differently depending on whether it is a games subscription or the connectivity under a customer's cold store, so a ladder now declares **what it applies to** as well as **who**.

Three scopes, and the array that defines them **is** the precedence, so adding a scope means deciding where it sits rather than leaving that to whichever filter happens to run:

1. **Product category** — the narrowest. Used sparingly, because every extra ladder is another thing that has to stay right.
2. **Marketplace category** — what the thing is.
3. **Customer type only** — the fallback, always present, so nothing is ever left unchased.

- **A category ladder carries no customer type**, because "a default for this product category" means all of them. A ladder that *does* name a customer type is more specific and wins at the same scope; within a scope, the value band with the highest floor wins.
- **Shipped defaults**: IoT, security, digital content and devices at marketplace-category level; IoT SIM plans, insurance and streaming at product-category level. Each states its reasoning — suspending a SIM plan detaches an entire estate the customer cannot restore themselves, so it happens last and only after somebody has spoken to a human; a lapsed insurance policy leaves somebody uninsured who usually does not know it, so written notice is required.
- **A case records what was sold**, not just who bought it, so the ladder is resolved from the product rather than inferred.
- **What a seller owes the marketplace never uses a category ladder.** That debt is commission and fees, not a product; pacing it like a handset instalment would be a category error with real consequences.
- **The case inspector states which ladder applied and why.** A collector who cannot see why a case is paced the way it is starts overriding it, and then the policy means nothing.
- **A scoped ladder cannot be saved without naming its category**, and a category ladder does not count as cover when checking that every customer type has a base.

### 4.46 Seller Reviews (CAT)

The seller previously saw a summary of invented percentages and a button that raised a toast. It now reads the real records.

- **Rating distribution from published reviews**, drawn relative to the seller's most common rating rather than to a hundred, so a small number of reviews does not read as a wall of nothing.
- **Unanswered poor reviews are surfaced first** — the reply is the only part of a bad review a seller controls, and every later buyer reads it. A per-listing table shows which listings have a reply outstanding.
- **Replies are public, permanent and posted under the seller name.** A one-line brush-off is refused: it reads worse than silence.
- **Rejected reviews are shown with their reason**, and the screen states that rejecting a review for being critical is not a permitted reason and is itself audited.
- **A review awaiting moderation cannot be replied to**, and the screen says whose queue it is in.

### 4.47 Promotional Artwork (ORD)

Ad banners rendered a raw filename in an artwork tile — a missing asset with a label on it, which is worse than no artwork.

- **Eleven drawn vector motifs** — two handsets, handset and shield, rack and padlock, trade-in, screen at night, refrigerated lorry, parcel, festival lights, certificate, two people, shopfront — inheriting the banner accent colour.
- **Drawn rather than photographed.** Stock imagery needs a licence we do not have and dates the moment a handset is refreshed.
- **The operator picks a motif from a list with a plain-language note on what each depicts**, and the preview redraws live. Nobody types a path.
- **Every motif carries the banner's alt text on the SVG itself**, so a screen reader gets the description rather than a decorative blank.
- Filenames remain in the **media manager**, where a filename is the correct thing to show.

### 4.48 Persona Scope — What a Role Administers (ALL)

A capability belongs to the role accountable for it, not to every role that could technically use it.

- **The customer console holds no administration.** No rule table, no message templates, no channels-by-severity matrix, no "Send a test". A retail customer needs *stop texting me about offers* to be easy to find, and every one of those panels made it harder. Notifications and Messages we sent you are **one page**, because "what I want to be told" and "what you actually sent me" are one question asked in two directions.
- **The enterprise buyer keeps role-addressed rules** — an organisation genuinely administers alerting, and a rule addressed to a role follows people as roles change. It does **not** author the marketplace's message templates: two parties editing one document is how a customer quotes wording nobody recognises.
- **The per-message carrier cost is operator-only.** It is what the marketplace pays a carrier, not a line a recipient is entitled to. Likewise the **DLR-state glossary** — an operator reconciles "submitted" against "sent"; a customer does not.
- **Bill formatting belongs to the issuer.** A buyer receives the marketplace's invoice; restyling it would produce two parties holding different versions of one legal record. What a buyer *does* control — PO requirement, cost-centre breakdown, tax position — sits on their own AP panel, and the invoice reads from there rather than a second copy on the template.
- **A retired screen identifier keeps working as a route alias**, so a bookmark or an in-page link to a merged page does not silently no-op.

### 4.49 Arrears — The Debtor's Own View (BIL)

The operator and the seller both had a Collections screen. The two parties actually being chased had nothing.

This is deliberately **not** the collections screen with a filter. A collector wants a queue, a value and a next action; a debtor wants four things, in this order: what is owed, why it failed, **what happens next and when**, and how to stop it.

- **The next step carries a date and a plain-English consequence** — "on 30 July the service stops", not "you are at step 5".
- **The whole ladder ahead, told forwards**, with their own position marked. Hiding it is what makes a suspension feel arbitrary when it arrives.
- **Ask for time** records a promise to pay: nothing happens until the date given, then it resumes from where it stopped rather than restarting.
- **Paying clears the case** and says what that restores.
- Card expiry and similar are surfaced as *fixable in about a minute*, because most arrears are an expired instrument rather than an inability to pay.

### 4.50 A Reviewer's Own Reviews (CAT)

The operator moderates, the seller replies, and the author could see none of it — while the moderation flow promised the reviewer would be told and could rewrite.

- **Every review they wrote**, with its state and the seller's public reply.
- **A rejection shows its reason**, and offers two routes: rewrite it, or challenge the decision. A challenge goes to somebody other than the original moderator, and the screen restates that rejecting a review for being critical is not a permitted reason and is itself audited.
- **Things they bought but have not reviewed** are offered, never something already reviewed.
- **Take it down** removes it from the rating and takes any seller reply with it.

### 4.51 Buyer Integration (API)

`AP-PTY` was published to "sellers and enterprise buyers" while the buyer console had no door to it. A procurement team does not browse a storefront — a requisition starts in their ERP.

- **Three buyer APIs added**: `AP-BCAT` (TMF620, catalogue with contract pricing resolved per account), `AP-BORD` (TMF622, raise a requisition and track it), `AP-BFIN` (TMF666/TMF678, invoices and remittance into AP).
- **The constraint that matters is built, not assumed**: an order raised through the API is subject to the buyer's **own approval policy**, identically. Above the threshold it returns an approval reference rather than an order. The API is not a route around a customer's finance function, and an attempt to use it as one is refused and recorded.
- **Contract pricing is resolved per account**, and the caching trap is named on screen: a cached response reused across accounts shows one customer another customer's rate — a contractual problem, not a bug.
- **Credentials are issued to a named person**, not an organisation, because whoever holds them can raise requisitions as the company.
- Sandbox carries contract prices, so a connector is proved against the numbers the buyer will actually see rather than against list.

### 4.52 Order Stage Detail (ORD)

The fulfilment tracker drew five stages and said nothing about any of them. A stage that looks like a control and opens nothing is worse than a stage that looks like a label, because the person clicks and concludes the screen is broken.

- Every stage in the tracker is now a real control that opens the record behind it: **what the stage means, who performs it, which system is the source of record, when it happened, and what evidence would prove it**.
- A stage not yet reached **says so**, and states the typical duration for that kind of order while explicitly refusing to present it as a commitment. Timing is drawn from per-stage norms, not invented dates.
- Stage semantics are declared once in `STAGE_INFO` and cover every label any pipeline can produce; a regression check fails the build if a pipeline gains a stage with no record behind it.
- **The affordance and the handler must agree.** The same component draws onboarding gates (which open a submission) and the listing wizard's preview pipeline (which opens nothing). Clickable styling is scoped to elements that are actually buttons, and a test asserts both directions.

### 4.53 Loyalty and Rewards (BIL / CVM)

Rewards existed as one number on the consumer dashboard. A points programme is a **liability**, and the only honest way to run one is to record who funded each point, what it is worth, when it dies, and how much of the outstanding balance will realistically be claimed. Aligned to TM Forum SID Loyalty (Party Loyalty / Loyalty Account / Loyalty Transaction).

**The model.** A programme record (conversion rate, expiry window, minimum redemption, breakage assumption and its basis, liability account); four tiers with rolling twelve-month qualifying spend and earn multipliers; earn rules each naming a **funder** — marketplace, seller, or a stated split; a redemption catalogue where the rate differs *because* the funder differs; a per-member ledger of every earn, bonus, redemption, expiry, reversal and adjustment; and member accounts for consumers **and organisations**.

**Four roles, four questions.**

- **Customer** — balance, what it is worth, tier position with the gap to the next one, what is expiring and when, the redemption catalogue with what they cannot yet afford shown as a shortfall rather than hidden, and every movement on the account.
- **Seller** — points issued on *their* products, what issuing cost them, what redemptions against them cost, and what will be recovered on the next settlement. A shared rule costs them only their share, and the share is shown. They may **propose** a seller-funded rule; it issues nothing until the marketplace approves it, and it cannot be scoped to anyone else's products.
- **Operator** — gross liability, the liability carried after breakage, redemption rate, issuance by funder, the full earn-rule and redemption catalogue, tier configuration, every member account, and every movement. Approving, pausing and adjusting are all separately audited.
- **Enterprise buyer** — what the organisation earned on its spend, and **who inside the organisation may spend it**. A named buyer proposes; only finance takes the credit, because it lands on an invoice. Redemptions can be allocated to a cost centre.

**Redemption settles inside the marketplace.** Every fulfilment kind declares where it lands, and the editor refuses to publish one that lands outside. The reasoning is not squeamishness about partners: a point is a liability against *this* platform, so it has to be discharged against a balance the platform holds, an invoice it raises, or an item in its own catalogue. An option a third party honours converts a liability created in points into cash owed to somebody who never joined the programme. Six live kinds — wallet credit, invoice credit, discount at checkout, in-marketplace seller voucher, trade-in top-up and delivery upgrade. Two externally fulfilled options ship **retired**, with that as the recorded reason, because deleting them would lose the history of having offered them.

**The catalogue and the tiers are operator-editable.**

- **Redemption options** — add, edit, retire and reinstate. Guards: a minimum at or above the programme floor, a minimum that is a whole number of steps, a value above zero, a mandatory member-facing description and a mandatory justification for the rate. The preview states what the minimum becomes in money, where it settles, and the premium or discount against plain wallet credit — an option worth *less* than the wallet is flagged, because a member reading carefully will just use the wallet. Retiring never reverses a redemption or moves a balance, and an externally fulfilled option cannot be reinstated as it stands.
- **Tiers** — add, edit and remove. The ladder must climb in both directions at once: **thresholds and earn rates rise together**, or a tier asks members to spend more for less. Two tiers cannot share a threshold, because placement would then depend on list order. A multiplier below 1× is refused. The entry tier's qualifying spend is fixed at zero — every account has to land somewhere. **A tier holding members cannot be removed**, only renamed or re-priced. Rung order is *derived from the threshold*, never typed, so the ladder cannot be drawn in one sequence and evaluated in another. The preview grounds the change in the members who exist: how many already qualify, and what the multiplier adds to the liability on a representative order.

**Rules the build enforces rather than states.**

1. **A point is a liability the moment it is issued**, not a cost when it is spent. Marketplace-funded issuance is expensed to 6020; seller-funded issuance is held as recoverable at 6030; both credit 2040.
2. **Expiry releases the liability to breakage income at 4040, visibly.** Netting breakage against the expense hides the one number that makes a programme look cheaper than it is.
3. **Breakage is labelled an estimate with its basis on the screen**, and an assumption above 60% is refused — that is not an assumption, it is a way of not carrying the liability.
4. **Pausing a rule never confiscates points already earned.** Issuance stops; balances do not move.
5. **A decline on a seller's proposal requires a reason**, because the seller has to be able to fix it.
6. **A hand adjustment requires a reason and cannot drive a balance below zero.** There is no approval step, which is precisely why the reason is mandatory.
7. **Changing the value of a point is a balance-sheet act.** The dialog states the new liability, the size of the move, and that existing balances will buy less, before anything is saved.
8. **A seller never sees the customer behind a movement**, and never sees the programme-wide liability.

**Correcting a latent defect found while wiring this.** Four audit actions were writing to a category (`Configuration`) that appears in no role's read scope — every one of those entries was invisible to everybody. They were re-categorised, a seller's owner was given read access to commercial entries against their own account, and a customer was given read access to a redemption taken off their own balance.

### 4.54 Refund Escalation by SLA (BIL)

Escalation was a button the customer had to know to press. A customer who must know to press something in order to get a fair hearing is a customer the platform has quietly failed.

- **The Escalate control is gone from the customer's view entirely.** Escalation is a clock.
- A request still unresolved **72 hours** after it was raised is escalated to the marketplace automatically, and so is **a decline the seller cannot evidence**.
- The customer is told what the clock is doing — a declined request states that it stands unless the SLA picks it up; an open one shows roughly how long is left, and says it happens on its own.
- Every escalated record carries **why** the platform escalated it and when. The reason no longer credits a customer action that no longer exists.
- The customer keeps a support route, which is a ticket, not an escalation. The two are not the same thing and the screen does not pretend they are.

### 4.55 Theme (ALL)

A dark theme on the consumer, seller and enterprise portals. The marketplace console is pinned to light — a console with no switch must not silently follow the operating system, or it goes dark with nothing to turn it back.

- **Not an inversion.** Inverting a palette produces pure black behind pure white, which on an operational screen read for hours is worse than the light one. Surfaces lift from a near-black base so elevation still reads, the brightest ink stops short of white to cut halation, and **every semantic pair was re-picked against its own dark background** rather than dimmed.
- **A warning that fails contrast in the dark is a warning nobody sees at night.** All seven semantic pairs, three ink levels against three surfaces, the AI accent and the primary-button label are asserted at WCAG 2.2 AA (4.5:1) in both themes by computing the real ratios from the shipped tokens.
- Two defects surfaced and were fixed while doing it: white on the primary fill fails at 2.86:1 in dark and 3.0:1 on light chips — the label colour became a token; and the focus halo's inner ring was a hard-coded white that read as an outline on a dark screen.
- A document preview stays a **light island** in either theme, because paper is not dark.
- The theme follows the operating system until the person chooses, and their choice then wins and is remembered. Asking again every session is how a preference stops being one.


### 4.56 Settlement Detail and Masking (BIL / SEC)

Operator-led onboarding collected a company name and a free-text field called "Bank", which left the finance gate with nothing to verify and the desk discovering that a week later.

**Capture.** The dialog is now a five-step wizard mirroring the gates: company, contacts and categories, settlement, documents, reason and review. Settlement asks for what the person is actually holding — account holder, bank, branch, account number **typed twice**, the local clearing code *named for the country* (IFSC, sort code, ACH routing, Bankleitzahl, agência/conta), SWIFT/BIC, IBAN where the country uses one, settlement currency, tax residency, the country's own tax identifier (PAN, TRN, GSTIN, UEN, CNPJ) and the treaty certificate expiry. `BANK_CODES` drives the labels from the country picked on step one.

**Documents are attached, not ticked.** A tick records a claim; the gate that needs the document still has nothing to read. Each of the eight expected documents takes a real file, and the record keeps its name, type and size. Attaching one closes the task that would otherwise have chased the seller for it — and says which file closed it. It does not clear the gate, because somebody still has to read what was attached.

**Masking.** The record holds the number because the platform has to pay somebody; nothing in the interface prints it. Screens call `maskAcct()` and get the last four. A tax identifier keeps its two-character jurisdiction prefix — that is not the secret. **A BIC is not masked and the screen says why**: it identifies a bank, not an account. Revealing the full detail is a separate act: restricted to the finance role, requires a written reason, shows once, and writes a high-severity audit entry naming who looked and why.

**Capture is not verification.** A recorded account lands `verified: false`, the finance submission is written at state `todo`, and the screen says two micro-deposits still have to be matched before a settlement run will pay to it.

### 4.57 Product Artwork (CAT)

A grid of identical Lucide glyphs read as a wireframe and lost the one thing a picture is for — telling a handset from a tablet before you read the title.

Twenty-four drawn illustrations, chosen by category and then by a keyword in the product name for the cases a category cannot separate: a mesh pack and a fixed-wireless CPE both sit under "Routers"; a kit of twenty-five sensors is a kit, not a sensor. Colour comes from the marketplace category so the grid still groups by eye, with a per-product accent derived deterministically from the product id so twelve handsets are not twelve identical tiles, and a tile does not change colour when the list re-renders. Every drawing carries `role="img"` and a described label.

**These are illustrations, not photographs, and that is a decision rather than a limitation.** The build is one self-contained offline file per persona, so there is nothing to fetch at runtime; and photography of devices the marketplace does not own is somebody else's copyright. If real photography is wanted for a specific demo, the drawings are a single function call and can be swapped for assets dropped into a folder.

Two related layout defects were fixed with it. The card footer had no room to shrink, so on any product with a struck-through sale price and a tax note the action was pushed past the edge of the card. And in the basket drawer the closing tag for the totals block was emitted unconditionally, so an **empty** basket closed the drawer body early and the *Saved for later* list rendered outside it with no padding — visible as text running off the left edge of the panel.

### 4.58 What a Seller Can See and Correct (PMP)

A seller who cannot see what the marketplace holds about them cannot correct it and cannot answer their own auditor. Their own details page now carries the settlement account (masked, with the same audited reveal), the tax position with the **consequence** spelled out rather than the state alone, and every gate they cleared with the fields and documents it was cleared on.

**Changing where money is paid is the change most worth attacking**, so it does not take effect on save. The account number is typed twice, a reason is required, the request is recorded as `pending`, two micro-deposits go out, payouts keep running to the account already verified, and the change is audited at high severity with both numbers masked.

### 4.59 What a Buyer Holds (BIL)

The mirror of the seller, and deliberately not a copy of it: **we do not pay a buyer, they pay us.** So the enterprise details page carries a payment instruction rather than a settlement account — method, bank, account, direct debit mandate reference, what happens if a collection fails, terms, and where invoices are sent. The mandate reference is masked too, because it is enough for somebody to quote convincingly.

Alongside it: the **credit position** (limit, committed, headroom, and what actually happens at the limit — held for finance, not refused), the **tax registration** with the point that place of supply comes from the registered address and not the delivery address, and the six checks the account was opened on with their documents. Changing the mandate goes for verification while collections continue on the one in force. Changing the registration applies from the next invoice and says so — an invoice already issued was correct when it was raised, and is credited and reissued rather than edited.

### 4.60 Onboarding Tasks Belong to a Partner (PMP)

The task list was one flat array, so opening any gate on any partner showed the same tasks — a seller live since 2024 displayed the in-flight applicant's open chasers. Every task now belongs to a partner and to a gate, and its state follows that partner's progress: a cleared gate's tasks are **done with who closed them and when**, the current gate's are open with a due date, and a gate not yet reached is *not started* rather than overdue. Clearing a gate closes its tasks and opens the next gate's. The operator's chase list contains only sellers with an application still running — a partner that went live two years ago appearing on it is how a desk learns to ignore its own queue.

### 4.61 Alert Channels for a Customer (NTF)

The consumer notification screen listed the channels for each subject as read-only tags. Each subject now carries the three channels as toggles beside the on/off switch. Two rules the build holds: a subject that is still on **cannot be reduced to no channels** — agreeing to be told and leaving nowhere to tell you is not a choice — and subjects the platform is required to send (a failed payment, a price rise on something already held) have the switch fixed on while the **channel stays the customer's to choose**. The screen says which those are.


### 4.62 Media — View and Download (CAT)

A media list you can only read the filename of is a list of claims. Every item now opens and every item downloads something real: an **image leaves as the artwork itself** (SVG, so it scales), a **document as a PDF** through the writer the rest of the platform uses, and a **video as its still** — because the still is what the marketplace actually holds, and putting an empty file on somebody's disk would be worse than saying so. The viewer shows the item at size with its dimensions, weight, shot and description beside it. A shopper taking a copy of a public catalogue image is deliberately **not** audited; inside a console the same download is, because there the media belongs to a seller.

Image thumbnails throughout the media manager now render the product's own drawn artwork rather than a category glyph. A video or a document keeps its own mark — a handset drawing next to a PDF would be worse than a glyph.

### 4.63 Wallets — Stored Value (BIL)

The customer had a wallet; the operator had no view of it at all. A wallet balance is **money the platform is holding for somebody else** — like a reward point it is a liability the moment it is credited, but unlike a point it is real money the holder can generally ask back.

**Two pots, because they are legally different.** Top-ups and refunds paid to the wallet are the customer's own money and are returned on request to the instrument that funded them. Reward redemptions and goodwill credit are not their money and are not returned as cash. Every screen states which is which, and returning a balance returns **only the refundable pot**, saying so before it happens rather than quietly paying out less than the figure on screen.

**Dormancy is a state, not a note.** A wallet with no movement for the configured window is flagged, the holder is written to, and the balance is returned or escheated. It is never absorbed as income — the ledger has a breakage account for it, and the mapping says the line is only used where a balance is legally forfeit.

**Postings.** A top-up debits the bank and credits 2050 — never revenue, however long it sits there. Spending discharges the obligation to the customer and creates one to the seller. Goodwill credit is marketing spend at the moment of issue *and* a liability at the same moment.

**Guards on the policy.** A minimum top-up above the ceiling is refused, a dormancy window under six months is refused (it catches people who are simply between purchases), and lowering the ceiling below existing balances warns that nothing is clawed back. The ceiling exists because a high one turns the platform into an unlicensed deposit-taker in some jurisdictions, and the dialog says so.

The consumer's balance and statement are now **derived from the same records** the operator reads, so the two cannot disagree.

### 4.64 Action Columns (ALL)

Where a primary action existed on some rows and not others, the secondary action slid left and right down the column and the eye read the movement before it read the words. The primary slot is now always drawn: on a row where the action is unavailable it holds a **non-interactive marker saying what happened instead** — *Approved 06 Jul*, *Paid*, *Time agreed* — which is more useful than a gap and more honest than a greyed-out button implying the action might return.

The layout audit gained a detector for the whole class of defect: it measures the last action in each row of a column and fails the build if it moves. That found five more instances beyond the settlement table. A narrow column opts out via a compact mode, because a fixed slot in a cramped cell forces the pair apart until they stack.

Two related defects fixed alongside: `confirmAction` closed its dialog *before* running validation, so any dialog validating in its handler threw away everything the person typed and left them a toast on an empty screen — it now takes a `validate(vals)` that runs while the dialog is open; and a checkbox list was borrowing the single-row picker class, inheriting a nowrap flex that pushed the last options off the page.

### 4.65 Fulfilment Routing as Configuration (WMS)

The routing table was read-only, which made it look like a property of the platform rather than a decision somebody took. Rules can now be added, edited, reordered and removed, and **the order is the logic** — first match wins, so position matters as much as contents.

Guards: a **returns centre is never offered as a destination** (its stock has not been graded, so picking from it sends a customer somebody else's return), nor is a closed site; a duplicate category-and-market pair is refused rather than creating a rule that can never be reached; a rule shadowed by one above it is warned about *before* saving; the fallback cannot be removed and its category and market are fixed; and removing a rule states which rule its orders will fall to. Priority is derived from position, never typed, so the table cannot be drawn in one order and evaluated in another.

The warehouse panels also stopped rendering at two-thirds width in the middle of the page: they were being spliced in with `.replace('</div>', …)`, which hits the **first** closing tag, not the last.

### 4.66 Operator Roles (ADM)

Six roles covered a fraction of the console. Seven were added for the jobs the platform actually contains — **warehouse and inventory, support desk, collections, tax and compliance, growth and promotions, security administration, integrations** — and the capability matrix grew from ten rows to thirty-two, covering stock, routing, tickets, arrears, certificates, the ledger, rewards, the API registry and channels.

The separations that matter are enforced in the grid: the desk that answers a ticket cannot intervene in fulfilment or approve a settlement run; the warehouse role can change routing but not release money; only two roles can see a settlement account in full; two people hold the security role, because one is a single point of failure on the only role that can restore everybody else's access. Every new role has an audit scope and somebody in it — a role nobody holds is a role nobody maintains.

Thirteen columns is wider than a screen, so the matrix scrolls with the **capability column pinned**. A grid of ticks whose row labels have scrolled away is worse than no grid.


### 4.67 Product Eligibility and Dependency (CAT, ORD)

The catalogue would sell anything to anybody. An add-on with nothing to attach to, two tiers of one subscription on the same account, a sensor with no connectivity plan — each of those is an order the platform takes and then cannot fulfil, surfacing later as a refund, a failed provisioning job or a double bill. Twenty products now carry rules, in three kinds that are deliberately not the same thing:

| Relationship | Effect | Example |
|---|---|---|
| **Requires** | Blocks the order unless an eligible companion is held or in the same basket | StreamNova Sports needs a StreamNova base plan; Device Protect needs a handset bought here within 30 days; a Nimbus sensor needs an IoT Connect plan |
| **Excludes** | Blocks the order while the clashing item is held | One Aventa plan per line; Halo Family and Halo Solo; the Essentials bundle and the standalone Endpoint Protect it contains |
| **Works with** | Never blocks anything; shown on the product and nothing more | A 45 W charger with the K9 Pro; ZTNA alongside MDR |

Every rule carries a **reason in the seller's own words**, and the reason is what the buyer sees. A refusal that does not say what would fix it is a dead end dressed as an error, so a blocked add names the companion and offers **Add both** in one action. A requirement satisfied from the basket counts the same as one satisfied from the account, and says which.

Enforcement is at `addToCart`, so it holds for the consumer storefront and the enterprise requisition alike — the buy side differs only in which holdings are read (`ENT_SUBS` for a company, `MY_SUBS` for a shopper). Changing quantity on a line already in the basket is exempt: a rule met when the line went in cannot be broken by ordering more of it.

The operator sees every rule in a register under Catalogue, split by whether it **blocks an order** or is **advice only**, with the note that a change applies to new baskets only. Rules that stop revenue cannot live only in a data file.

Bundles declare what they contain (`bundleOf`), which makes the exclusion asymmetry legible: holding the bundle blocks buying the part again, but holding the part does not block the bundle, because that direction is an upgrade.

### 4.68 A Plan Change Is a Switch, Not a Second Subscription (ORD)

Enforcing "one Aventa plan per line" immediately broke the bundle builder, and the break was the useful part: a shopper on Freedom 50 GB building a bundle around Unlimited was refused, when what they were actually doing was **changing plan**. Both readings of the same rule are correct depending on intent, and intent is not something to infer.

So intent is declared. `addToCart(sku, qty, {replaces})` waives the exclusion **against that named product only** — declaring one replacement does not waive an unrelated clash. The waiver is recorded as a note rather than dropped silently, the plan list marks which option *replaces* what is held, the confirmation states that the old plan closes when the new one activates, and the basket line carries and displays what it replaces. The buyer reads the consequence before agreeing, not on the following bill.

The builder was also letting two tiers of one service be picked together and the basket then refused the second, so the bundle came out one item short of the quote it had just shown. `bbClash()` checks both directions at the point of choice.


### 4.69 Out of Stock Is Not the End of the Journey (ORD, NTF)

Out of stock ended the journey on both buy sides, in two different ways. The consumer tile drew a button labelled **Notify me** and disabled it — naming the thing the buyer wants and then refusing to do it, which is worse than offering nothing. The enterprise tile was worse still: it went on offering **Add to requisition** on a product that could not be supplied, because the catalogue passed its own buy action and `productCard` had no say in the matter. The product detail closed the same journey with a disabled *Out of stock* button, which only repeated what the badge already said.

**Notify me** is now a real control on both sides, and it creates a record rather than a toast. The dialog asks **how** — email or SMS, with the actual address shown, because "we will let you know" without saying how is a promise nobody can hold anyone to — states the seller's expected return date where inventory knows one while making clear the alert fires on arrival rather than on that date, and says plainly that an alert **reserves neither stock nor a price**. Setting it is audited (`stock.watched`), as is cancelling it (`stock.unwatched`).

A caller may still pass its own buy wording via `addLabel`, but it no longer gets to override what happens when there is nothing to buy — `productCard` decides that from the record. Asking twice does not create two alerts, and a product already watched shows an inert *You will be told* marker instead of an action that has been taken.

**Waiting for stock** lists what the buyer is owed, one row per alert, with the channel and address each will use: still out of stock (cancellable), back in stock (with the buy action, worded per persona), or closed with the date the buyer was told. Save for later composes the two actions rather than replacing them, so an item going out of stock does not cost the buyer the ability to remove it.


## 5. Architectural & Integration Blueprint

```
 ┌────────────────────────────────────────────────────────┐
 │                      Centralized UPC                   │
 └──────────────────────────┬─────────────────────────────┘
                            │ (TMF620 Catalog Federation Sync)
                            ▼
 ┌────────────────────────────────────────────────────────┐
 │                  B2B/B2C Marketplace                   │
 │   ┌───────────────┐ ┌──────────────┐ ┌──────────────┐  │
 │   │  Core Portal  │ │ Catalog Mgmt │ │  Promo Mgmt  │  │
 │   └───────┬───────┘ └──────┬───────┘ └──────┬───────┘  │
 │           │ (TMF632/669)   │ (TMF620)       │ (TMF736) │
 │   ┌───────▼───────┐ ┌──────▼───────┐ └──────┬───────┘  │
 │   │ Billing & Set │ │ Order Engine │────────┘          │
 │   └───────┬───────┘ └──────┬───────┘                   │
 │    (TMF666/678/670)        │ (TMF663/622)              │
 └───────────┼────────────────┼───────────────────────────┘
             │                │
     ┌───────▼───────┐        │ (TMF664 Resource Orders)
     │  Legacy BSS   │        ▼
     │  Billing/LED  │  ┌───────────┐
     └───────┬───────┘  │ Telecom   │
             │          │ Core OMS  │
             ▼          └───────────┘
     ┌───────────────┐  ┌───────────┐
     │Loyalty Engine │  │    n8n    │
     │(TMF737/738)   │  │Orchestrator
     └───────────────┘  └─────┬─────┘
                              │
                  ┌───────────┴───────────┐
                  ▼                       ▼
            ┌───────────┐           ┌───────────┐
            │Partner App│           │Partner App│
            └───────────┘           └───────────┘
```

### 5.1 TMF Open API Reference Integration Matrix

| API Spec | Name | Implementation Context within Marketplace |
|----------|------|------------------------------------------|
| **TMF760** | Partner Management | Handles partner company registration, onboarding, and business details. |
| **TMF668** | Partnership Management | Governs business relationships, partnership agreements, and partner status codes. |
| **TMF632** | Party Management | Manages customer organizational entities, sub-accounts, and contact profiles. |
| **TMF669** | Party Role Management | Grants platform roles (Operator, Partner, Customer SMB, Customer Retail B2C, Corporate IT Admin). |
| **TMF620** | Product Catalog Management | Configures partner listings, pricing plans, min/max price limits, product images, and UPC federations. |
| **TMF663** | Shopping Cart Management | Stores ongoing shopping cart items, performs pricing validation, and applies discounts. |
| **TMF736** | Promotion Management | Governs coupons, marketing campaigns, partner/operator discounts, and login ad banners. |
| **TMF737** | Loyalty Program Management | Standardizes loyalty programs, loyalty tiers, rules, and promotional campaigns. |
| **TMF738** | Loyalty Point Account Mgmt | Manages loyalty account point balances, tracks accrual credits, and processes checkout point burns. |
| **TMF622** | Product Order Management | Standardizes order creation, cancellation, and processing lifecycle. |
| **TMF664** | Resource Order Management | Triggers provisioning requests to external operator network systems or legacy enterprise OMS. |
| **TMF666** | Account Management | Governs billing account registration, limits, status, and corporate billing structures. |
| **TMF678** | Customer Bill Management | Manages the generation of itemized invoices and billing statements. |
| **TMF676** | Payment Management | Processes charge settlements, credit/debit card payments, and records transactions. |
| **TMF670** | Payment Method | Registers and manages customer payment instruments (cards, bank accounts, carrier bills). |
| **TMF651** | Agreement Management | Controls partner-operator SLA contracts, revenue splits, and enterprise custom terms. |
| **TMF667** | Document Management | Stores uploaded partner KYB documentation, enterprise agreements, product manuals, and datasheets. |
| **TMF644** | Privacy Management | Captures and enforces GDPR consent, marketing preferences, and data privacy policies. |

---

## 6. Non-Functional & Security Requirements

- **Tenant Isolation**: Strict access controls ensuring Customer A cannot view Customer B's details, and Partner X has zero access to Partner Y's pricing lists or order logs.
- **Security & Compliance**: Conform to GDPR, SOC2, and local telecom regulatory requirements. Encrypt all PII and financial credentials at rest and in transit (TLS 1.3).
- **Scalability**: Designed as microservices using containerized environments (Kubernetes) to support scaling during high-traffic campaign retail windows.
- **Availability**: Target 99.9% uptime for the storefront and subscription checkout engines.
- **Accessibility**: WCAG 2.2 AA across all four portals. State must never be conveyed by colour alone; every status indicator carries a shape as well as a hue. Keyboard operability, focus management in dialogs, `prefers-reduced-motion`, and accessible names on icon-only controls are mandatory, not enhancements.
- **Data Honesty**: Where a figure is not measured, the interface must say *Not measured* rather than render zero — they are different claims. Unattributable revenue is reported as unattributed rather than assigned by inference. A growth figure with no comparable prior window says so.

---

## 7. Prototype Implementation Status

A working front-end prototype accompanies this document in the same folder. It is a **demonstrable, self-contained UI over a synthetic dataset** — four portals, no back end, no network calls. It exists to make this PRD reviewable and to de-risk estimation, not to be production software.

### 7.1 What has been built

| Portal | File | Screens | Brand |
|---|---|---|---|
| Consumer storefront (B2C) | `consumer.html` | 18 | 6D |
| Partner / seller console (B2B2X) | `partner.html` | 23 | 6D |
| Marketplace operator console | `operator.html` | 31 | 6D |
| Enterprise buyer portal | `enterprise.html` | 20 | Neutral / white-label |

Entry point: `index.html`. Design contract: **nim-ui-design-system-v2** (6D ONE UI).

### 7.2 Coverage against the seven components

| Component | Front-end status | Notes |
|---|---|---|
| **PMP** — Partner Management | **Demonstrated** | 7-gate funnel, gate policy editor, per-gate submissions, second-category application with KYC carry-over, partner invitation, **portal branding customiser** (§4.20). |
| **CAT** — Catalog & Bundling | **Demonstrated** | 6-step listing wizard, multi-media manager, three-tier pricing, per-category policy (10 rules × 3 levels), review queue with seller queries, operator first-party product and bundle composition from the BSS catalogue, review submission and moderation (§4.19), **listing version history with rollback, account contract pricing and three-way product comparison** (§4.22, §4.23). UPC federation remains **modelled as a local catalogue**, not integrated. |
| **ORD** — Order, Cart & Subscription | **Demonstrated** | Cart and checkout, 5 fulfilment pipelines, enterprise requisition and approval policy, subscription pause/cancel/restart, seat assignment, failed-order intervention, storefront advertising (§4.16), **seven-step dunning ladder with promise-to-pay and consumer-side notice** (§4.26). |
| **BIL** — Billing, Settlement & Loyalty | **Demonstrated** | Self-billing invoice reconciling to order lines, settlement run approval, bill formatting, per-partner cycles, commercial models, tax and merchant of record, conditional discount engine. Loyalty is **points balance and redemption only** — TMF737 programme/tier definition is not built. |
| **AI** — AI & n8n | **Partially demonstrated** | AARYA assistant with scripted deterministic answers, confidence levels and declared sources. n8n orchestration, NL-to-workflow and usage harvesting are **not built**. |
| **SUP** — Support & Cases | **Demonstrated** | Disputes with evidence and resolution, the full ticketing lifecycle with SLA clocks, pausing and automatic escalation (§4.18), and a **per-persona knowledge base with guided walkthroughs that drive the console** (§4.34). |
| **ADM** — Governance & Security | **Demonstrated** | Roles matrix in all four portals, users directory, credential and session security, notification rules and message templates, export engine, reporting periods, audit trail with role-scoped visibility (§4.15), hash-chained integrity with on-demand verification and SIEM streaming (§4.25), per-persona revenue and spend projection with measured backtest error (§4.27), and **bulk update with a mandatory dry run, per-row rejection and the single-record rules enforced identically** (§4.31). |
| **INV** — Inventory | **Demonstrated** | Stock ledger with reservations, holds and movements; SIM pool and resource pools; warehouse system links with drift detection and shipment tracking (§4.17, §4.24); **Number Management / Logical Inventory integration with ICCID, IMSI and MSISDN federated from the BSS, TMF639/TMF652 assignment and the SGP.22 profile lifecycle** (§4.29). |
| **IAM** — Identity & Access | **Demonstrated** | Roles, permissions and password policy, plus a **real sign-in gate** — credentials, TOTP, passkey, per-account lockout, enforced SSO that closes the local password path, step-up re-authentication before sensitive actions, and session listing and revocation (§4.28). No server backs it; the behaviours and the audit consequences are the real part. |
| **APG** — API Gateway & Developer Portal | **Demonstrated** | **Outbound**: seven API products across sandbox and production, entitlement-based access tiers with no pricing, reference documentation with idempotency rules (§4.21). **Inbound**: a registry of every partner's endpoints with a coverage matrix over 23 marketplace events, callback policy, test calls and a call log (§4.36). Integration is a **tested onboarding milestone** that blocks go-live (§4.37). |
| **NTF** — Notifications | **Demonstrated** | Rule builder, role-addressed rules, per-channel message templates with token preview and SMS segment counting, plus the **transport layer — providers with protocol and cost, primary and failover, DLR state machine, retry and hard-rejection rules, per-message reason codes and channel spend** (§4.30). No message physically leaves the browser. |

### 7.3 Traceability

| PRD section | Prototype surface | Automated coverage |
|---|---|---|
| §4.1, §4.12 | `operator.html` → Partner onboarding; `partner.html` → Onboarding | `journeys.js`, `journeys_catalogue.js` |
| §4.2, §4.8 | `partner.html` → New listing; `operator.html` → Catalogue | `journeys_commerce.js` |
| §4.3 | `consumer.html` → Basket; `enterprise.html` → Approvals | `journeys.js` |
| §4.4, §4.9, §4.10, §4.11 | `operator.html` → Settlement runs, Promotions, Billing, Tax | `journeys_config.js`, `journeys_commerce.js` |
| §4.5 | AARYA panel, all portals | `journeys_config.js` |
| §4.7, §4.14 | Users / Roles / Notifications, all portals | `journeys_config.js`, `journeys_catalogue.js` |
| §4.13 | `partner.html` → Integrations | `journeys_commerce.js` |
| §4.15, §4.25 | Audit log, all portals; `operator.html` → Audit integrity | `journeys_audit.js`, `journeys_platform.js` |
| §4.16 | Login banners, all portals; `operator.html` → Banners | `journeys_audit.js` |
| §4.17, §4.24 | `operator.html` / `partner.html` → Inventory | `journeys_ops.js`, `journeys_platform.js` |
| §4.18 | Tickets, all portals | `journeys_ops.js` |
| §4.19 | `consumer.html` → product page; `operator.html` → Reviews | `journeys_ops.js` |
| §4.20 | `partner.html` → Branding | `journeys_ops.js` |
| §4.21 | `operator.html` → Developer portal | `journeys_platform.js` |
| §4.22 | `partner.html` → Listings (versions); `enterprise.html` → Contracts | `journeys_platform.js` |
| §4.23 | `consumer.html` → Browse (compare tray) | `journeys_platform.js` |
| §4.26 | `operator.html` → Collections; `consumer.html` → My details | `journeys_platform.js` |
| §4.27 | Dashboard of all four portals | `journeys_platform.js` |
| §4.28 | Sign-in gate and Sign-in and sessions, all portals | `journeys_final.js` |
| §4.29 | `operator.html` → Numbers and SIMs; `partner.html` → SIMs on my orders | `journeys_final.js` |
| §4.30 | Message delivery, all portals | `journeys_final.js` |
| §4.31 | Bulk updates, all portals | `journeys_final.js` |
| §4.32 | `operator.html` → Listing rules | `journeys_catalogue.js` |
| §4.33 | `partner.html` → New listing; category policy inspector | `journeys_catalogue.js` |
| §4.34 | Knowledge base and top-bar help, all portals | `journeys_ops.js` |
| §4.35 | Every download button, all portals | `journeys_platform.js` |
| §4.36 | `operator.html` → Partner APIs | `journeys_platform.js` |
| §4.37 | `operator.html` → Partner onboarding; `partner.html` → Integrations | `journeys.js`, `journeys_platform.js` |
| §4.38 | `operator.html` → Partner onboarding | `journeys_platform.js` |

**1,604 automated checks** across ten suites, plus a per-persona render walk. They drive each journey to its conclusion and assert the underlying record changed — not that a screen rendered. The suites are split by area only so each stays inside the runner's time budget.

```bash
npm install jsdom
node _src/journeys.js             # 120 core journey checks
node _src/journeys_admin.js       # 155 administration checks
node _src/journeys_config.js      # 204 configuration checks
node _src/journeys_catalogue.js   # 246 catalogue, rule-catalogue, policy-inspector and reporting checks
node _src/journeys_commerce.js    # 112 commerce checks
node _src/journeys_audit.js       # 133 audit and advertising checks
node _src/journeys_ops.js         # 140 inventory, ticketing, review, branding, knowledge-base checks
node _src/journeys_platform.js    # 205 developer portal, API versions, partner APIs, event catalogue, integration milestone
node _src/journeys_billing.js     # 129 the PDF writer, bill templates, dunning ladders, the ledger
node _src/journeys_final.js       # 156 authentication, numbering, delivery, bulk checks
node _src/smoke.js partner.html   # render walk
node _src/layout.js               # class, column, chart, alignment and wording audit across all 85 views
```

### 7.4 Scope explicitly excluded from the prototype

- **SD-WAN, MPLS and CPQ-driven enterprise WAN products.** Excluded at the Platform Owner's direction. A build-time guardrail fails the build if these terms reappear in the catalogue.
- **Any back end.** No server, no database, no network calls. State is in memory and resets on reload.
- **Real payments, real tax filing, real PDF generation, real file storage.** CSV export is genuine; PDF is acknowledged as a stub. Media items are metadata records — the validation and ordering rules are the real part.
- **A back end for authentication.** The gate, the lockout, the step-up and the session lifecycle are all real behaviours; the credential check itself is a string comparison, and demo credentials are printed on the sign-in card because hiding them during a demo helps nobody.
- **Writing to the BSS.** The Number Management integration reads and reconciles. Nothing in the prototype — not a screen, not a bulk file — writes to the operator's Number Management system.
- **Actually sending a message.** The delivery states, receipts, retry rules and costs are modelled; no SMS, email or push physically leaves the browser.

### 7.5 Synthetic dataset

One deterministic seeded dataset (mulberry32, seed 20260725) shared by all four portals so the personas reconcile against each other: 6 categories, 15 partners, 39 products, 2,600 orders, 30 settlement statements, 8 commission plans across 7 commercial models, 10 catalogue policy rules, 6 promotions, 6 tax jurisdictions, 17 operator BSS products, 12 months of trailing history, 4 warehouses with a stock ledger, 8 tickets under SLA, 10 reviews, 9 banners, 5 published APIs with 5 consumers, 4 contract prices, 4 dunning cases, a versioned history against every partner listing, 3 Number Management systems with 26 sampled ICCIDs, 6 channel providers with 15 tracked messages, and 9 bulk-update sets.

**Reconciliation is the point.** GMV of $711,109 equals the sum of the categories and the sum of order gross; settlement net equals gross less commission, fees, withholding and refunds across all 30 statements; the last three months of the 12-month series equal the 90-day figure exactly.
