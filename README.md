# Telecom Marketplace — persona prototypes

Working HTML for a telecom marketplace platform spanning the marketplace categories you specified, built to the **nim-ui-design-system-v2** visual contract on one consistent synthetic dataset.

Open `index.html` and pick a persona. Every file is self-contained — no server, no build step, no network dependency except the Poppins webfont, which falls back to system sans-serif offline.

The React application in `src/` is a separate thing from those prototypes and does need a server — see **[Running the React app](#running-the-react-app)**.

| File | Persona | Brand | Marketplaces covered | Screens |
|---|---|---|---|---|
| `consumer.html` | Priya Raman — consumer shopper | 6D | Consumer, Device, Digital content | 10 |
| `partner.html` | Nimbus Sensors — partner / seller | 6D | Partner, IoT, Device | 11 |
| `operator.html` | Ananya Krishnan — marketplace operator | 6D | All six | 11 |
| `enterprise.html` | Brightline Foods — enterprise buyer | Neutral / white-label | IoT, Security, Device | 11 |

---

## Running the React app

Vite + React + TypeScript against a hosted Supabase project. There is no local
database — the app talks to Supabase directly.

**Run every command from the repository root**, the folder holding `package.json`.
Running `npm run dev` from your home directory fails with *"Could not read
package.json"*; that is the wrong working directory, not a broken install.

```bash
git clone https://github.com/Manikanth1012/B2B_-_B2CMarketplace.git
cd B2B_-_B2CMarketplace
npm install
cp .env.example .env      # then fill in the two values
npm run dev               # http://localhost:5173
```

Node 18 or newer.

### Windows PowerShell

PowerShell refuses to run `npm.ps1` under the default execution policy:

```
npm : File C:\Program Files\nodejs\npm.ps1 cannot be loaded because
running scripts is disabled on this system.
```

Two ways past it. Either allow locally-created scripts for your own account, once:

```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

…or leave the policy alone and call the batch shim instead, which is not affected:

```powershell
npm.cmd install
npm.cmd run dev
```

`cmd.exe` and Git Bash are unaffected either way.

### Environment

`.env` is gitignored, so every clone needs its own — copy `.env.example` and fill in
`VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` from **Project Settings → API** in
the Supabase dashboard. Both are read at build time, so **restart the dev server**
after editing; a page refresh will not pick them up. A blank page with *"Missing
Supabase environment variables"* in the console means this file.

### Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Dev server on :5173 |
| `npm run build` | Type-check and build to `dist/` (untracked — build where you serve) |
| `npm test` | Unit tests — no network |
| `npm run test:integration` | Integration tests **against the live project** |

`npm run test:integration` signs in as the seeded demo personas and writes to the
real database. It cleans up after itself, but do not point it at anything you would
mind it touching.

### Serving it

`dist/` is build output and is not in the repository, so a checkout is not
servable on its own — build it first, on the machine that serves it:

```
npm ci && npm run build     # with the VITE_* variables set
```

They are needed at build time rather than run time: Vite inlines
`import.meta.env.VITE_*` into the bundle, so a build made without them produces
an app that throws on boot.

---

## The marketplace categories

| Marketplace | Audience | What sells there | Listings |
|---|---|---|---|
| Consumer | B2C | Mobile plans, eSIM, insurance, bundles | 6 |
| Partner | B2B2X | White-label storefronts, wholesale packs, API and sandbox access | 3 |
| IoT | Enterprise | IoT SIM plans, sensors, trackers, gateways, device + connectivity bundles | 8 |
| Security | Enterprise | Managed firewall, MDR, VPN / ZTNA, endpoint, email security | 6 |
| Device | Consumer & Enterprise | Phones, routers, CPE, tablets, wearables, accessories | 8 |
| Digital content | Consumer | Streaming, gaming, music, cloud storage | 8 |

**Explicitly out of scope, and verified absent:** SD-WAN, MPLS and any configure-price-quote journey. A build-time check greps the whole catalogue for those terms and fails if any appear. Enterprise buying is catalogue-driven with an approval workflow — a requisition, not a quote.

---

## The demo dataset

One deterministic dataset shared by all four files, so every figure reconciles whichever portal you open.

- **Aventa Telecom** — a fictional white-label operator running the marketplace across India, UAE and Kenya
- 15 partners: 11 live, 1 onboarding, 1 in review, 1 suspended, 1 rejected at KYC
- 39 listings, 36 live, 3 in the review queue
- 2,600 orders · **$711,109 GMV** · $66,304 commission · **9.3% blended take rate**
- 8 commission plans with volume tiers · 30 settlement statements across 3 periods
- 5 disputes, 5 listings awaiting catalogue review, 59 failed orders

All synthetic. Fictional operator, partner and buyer names throughout.

---

## The journeys work end to end

These are stateful, not click-throughs. Every action mutates the shared dataset, and the change appears wherever it should — including in the other three portals, which read the same records.

**Partner onboarding — seven gates.** `partner.html → Onboarding`. The partner is mid-way through adding a second marketplace. Resolve the failing fulfilment webhook, then the sandbox order: the technical gate only closes when *both* tasks on it are done, at which point compliance review opens and the security questionnaire unlocks automatically — it is locked until then. Answer it, then publish. The partner goes live, gains the Security Marketplace, the nav badge clears, and the new marketplace becomes selectable in the listing wizard.

**Product onboarding.** `partner.html → New listing`. Six steps. Typing a price recalculates the commission split live without stealing focus from the field. Submitting creates a real product record and a real review-queue entry — open `operator.html → Catalogue` and it is waiting there. Submitting without a name or a price is refused and returns you to whichever step is incomplete.

**Catalogue governance.** `operator.html → Catalogue`. Approving publishes the listing to the live catalogue; rejecting marks it rejected and removes it from the queue. The listing that breaches content policy 7.4 has Approve disabled — reject or query only.

**Consumer purchase.** `consumer.html`. Add a handset and a streaming subscription, then check out. Two orders are created on their correct pipelines — five stages for the shipped handset, four for the instant entitlement — and a subscription starts and appears under Subscriptions. Cancel it and access runs to the paid-to date with auto-renew off; pause it and billing stops; restart it and it comes back. A failed delivery can be rebooked and re-enters the pipeline.

**Enterprise requisition.** `enterprise.html`. A basket becomes a requisition, not an order. MDR seats trigger IT sign-off; a $2,450 bundle triggers finance approval; anything under the threshold with no security in it orders immediately. Approving in `Approvals` places the order, adds seats to the existing subscription, and moves budget consumed. Declining places nothing. Seats can be assigned and licence counts changed, with the monthly charge following.

**Inviting a partner.** `operator.html → Partner onboarding → Invite a partner`. The form asks who the invitation goes to and will not submit without a company name, a named contact, a valid email and at least one marketplace. Sending it creates a real partner record at the application gate, raises a task owned by them, and the toast names the recipient. The queue row shows who it went to and when, and offers Resend rather than a generic chase.

**Operator onboarding queue.** `operator.html → Partner onboarding`. Clear Northwind Mobility's gates one at a time; clearing the last one takes the partner live and adds them to the partner directory. An invited partner can be driven the same way.

**A partner adding a second marketplace.** `partner.html → Onboarding → Add a marketplace`. Only one application runs at a time, so the dialog explains what is blocking if one is open. Once clear, applying for a new marketplace carries KYC and the verified settlement account over and opens at the agreements gate — an existing partner does not repeat due diligence.

**Settlement run.** `operator.html → Settlement runs`. Approving the run requires typing APPROVE. Statements move to approved and stay unpaid until the cycle date, because approving is not paying. Individual statements can be approved on their own.

**Reading the invoice before the money moves.** Any statement row opens the **self-billing invoice** itself: document reference on the configured numbering pattern, the period and terms actually in force for that partner, every SKU that sold with order and unit counts, the deduction stack from gross to net, and the tax treatment. The order lines reconcile to the statement gross to the cent — that is the point of the screen. Approval sits inside the document rather than beside a row, and a statement with an open dispute shows the approve button disabled with the reason, because held is a state, not an oversight. The same document is what the partner sees under their own Settlement screen.

**Product media.** *Details and media* in the listing wizard is a real media manager: several images plus a video and a datasheet, with a primary image that drives the card and search result, drag-order via move controls, and per-item alt text. Alt text is **required** — a listing nobody can read is a listing some buyers cannot buy — and a listing cannot be submitted until every item has it and there are at least three images. One video per listing, eight images maximum. Placeholders are labelled by shot rather than filled with stock photography, because a stock image pretending to be the seller's product is worse than an honest gap. Media travels with the listing on submit instead of being discarded, and every existing listing already carries a set so the gallery is never empty.

**Partner integrations.** A new screen where the seller registers the endpoints the marketplace calls. Eleven events across fulfilment, catalogue, finance and support; per-endpoint method, URL, authentication, retry policy and timeout; and a coverage table that says which events have no enabled endpoint and are therefore simply not reaching anyone. Plain HTTP is refused because order payloads carry buyer data, and an unauthenticated production endpoint is refused outright. **Send a test call** is a first-class action and its outcome follows the endpoint's real state — the failing one fails, which is the point. The call log shows every attempt with its status, latency and body, so "we never received it" has an answer. Inbound API keys are managed alongside, scoped and revocable. The listing wizard's fulfilment step then picks which endpoint an order calls, and warns before publication if that endpoint is disabled or failing.

**Cost, list and sale price.** Three numbers rather than one. Cost is the floor, list is what the listing is worth, sale is what is charged today. The wizard shows the full stack — sale, commission, fees, what settles, cost, and the margin actually left — and refuses a listing priced at or below cost. The seller also chooses how far the marketplace may discount their price, from *none* to *down to cost*, and the screen states the lowest figure a promotion could reach as a result.

**Per-component bundle discounts.** In the operator's bundle composer each component now has its own discount, hard-capped at that component's own cost. Asking for more is clipped rather than accepted. The standing bundle rule applies on top, the blended margin is shown, and an override below the cost of the parts is **raised to cost on save** rather than merely flagged.

**The discount engine.** Promotions are conditions plus an effect plus a budget, and they genuinely evaluate: time of day (with a window that may cross midnight), day of week, date range, cart value, item count, marketplace category, buyer type, first order, and contracted-enterprise-only. Six ship, including an evening content hour, a basket-over-$200 rule and an enterprise 25-seat volume rule. The screen shows what applies **and what does not, with the reason** — "runs 20:00–23:00, it is 14:20" rather than silence. Non-stacking rules compete and the largest wins; stacking rules add on top. A rule that has spent its budget stops discounting rather than overspending, and the screen points out that to a buyer this is indistinguishable from a withdrawn offer. Above all, **no promotion may sell below cost**: every rule is floored at the cost of the goods it touches, and the total is floored again at the basket's cost. A demo clock lets a time-of-day rule be shown at two in the afternoon, and a basket simulator lets you change value, category, buyer and time and watch the rules fire. Discounts reach the consumer basket and the enterprise requisition, apply to recurring lines as well as one-off ones, and come off before tax — because tax follows the price actually charged.

**The reporting period actually switches.** The 90-day / 12-month tabs were decoration. There is now a trailing 12-month series behind them, and the last three months of it sum **exactly** to the live order set — so the two views reconcile instead of contradicting each other. Switching changes the totals, the growth comparison and the monthly chart. The 12-month figure is not the 90-day one multiplied by four: the marketplace was smaller a year ago, and the shape shows it. The screen states that order-level detail is kept for 90 days and everything before that is a monthly aggregate, so the tables below stay at 90 days whatever the tab says. Growth is computed against the equivalent preceding window; over 12 months there is no preceding 12 months, so it says *No comparable prior period* rather than inventing a percentage. The seller sees its own series, reconciling to its own gross and its own order count.

**The partner's onboarding Guide.** A real document: every gate with its owner, target in working days, whether it needs two reviewers, and the evidence it asks for, with the seller's current gate marked. It ends with the five things that actually catch sellers out — including that KYC and Agreements cannot be waived, so raising it with an account manager will not help.

**The partner's own application.** Each of the seven gates on *Application to join the Security Marketplace* opens what was submitted at it: why the seller applied and the volume they projected, the beneficial ownership carried over, the reused settlement account and treaty certificate, and at the open technical gate the actual webhook URL with the HTTP 500 failure stated rather than hidden. Gates carried over from the original onboarding are labelled as such and explain that an existing partner does not repeat due diligence. A gate not yet open says so instead of showing an empty form.

**Onboarding gates open their inputs.** Every gate 1–7 on the onboarding queue is a button. Opening one shows what the partner actually submitted at it — registered name and beneficial ownership at KYC, the signed terms and DPA at Agreements, the masked settlement account and treaty certificate at Bank & tax, the webhook URL and sandbox order at Technical readiness — plus who submitted it, who reviewed it, the evidence the gate demands with each item ticked or not, and whether the gate is waivable. Documents open in a viewer that states plainly that contents are not reproduced, because they are personal data. A gate not yet reached says so rather than inventing a submission. The same history is on the partner record for partners who are already live.

**Listing policy.** `operator.html → Catalogue → Listing policy` is a real grid: every rule against every marketplace category, showing enforce / warn / off and how many listings each is holding, plus the review settings per category and a route into the per-category editor.

**Commercial models.** A plan is a **model plus its parameters**, and the model decides which parameters exist. Switching the model in the plan wizard relabels the headline rate, swaps the parameter block, and hides the tier table entirely for a flat-rate model — so a wholesale plan is never asked about cooling-off periods and an introducer plan is never asked about logistics recharge. Seven models ship; **New commercial model** lets you define an eighth with its own parameter list, and it becomes selectable in the wizard without leaving it. Tier thresholds must increase or the plan will not save. New plans are created as drafts with nobody on them, and cloning a plan actually clones it.

**The seller's own bills.** *Previous bills* on the settlement screen opens every statement the seller has ever been paid against, split into outstanding and paid. Download is real: a CSV of the order lines and the gross-to-net deduction stack, named after the document reference. All statements can be pulled in one file. The operator-only route into settlement runs is not offered to a seller.

**Partner bills.** The partner record carries a bills block — cycle and terms in force, what is outstanding, and the recent statements. **See all** opens every statement for that partner split into outstanding and paid, each openable as the self-billing invoice and downloadable. A bill download is a CSV of its order lines *and* the gross-to-net deduction stack, because a partner reconciling a payout needs the lines, not a picture of a total. All statements can be pulled in one file, and the partner directory offers **Bills** straight from the row.

**First-party products and bundles.** `operator.html → Catalogue → Create a product or bundle`. The composer pulls the operator's own BSS catalogue — 17 products across mobile postpaid, prepaid, eSIM, fixed broadband, IoT connectivity, value-added services, add-ons and equipment — so nobody retypes a tariff. Pick components and the price is **derived**: 4% off per extra component, capped at 18%. You can override it, but an override at or above the parts is called out, because a buyer can do that arithmetic. A bundle with one component is refused. What is created is a first-party listing — sold by the operator, no partner, no commission, no settlement — and it goes live without queueing, since the operator is the reviewer. The product inspector breaks the bundle into its components and states the saving against buying separately.

**Defining a marketplace.** `operator.html → Marketplaces → Define a marketplace`. It will not submit without a name and a line of storefront copy. A new marketplace starts **closed to buyers**, with a policy copied from whichever existing one you base it on, and with nobody in it — the screen says so rather than showing an encouraging zero. The toggle on each card is real: closing a live marketplace needs CLOSE typed and states what happens to live listings, to recurring orders that keep billing, and to the sellers in it.

**Catalogue policy.** Each marketplace carries its own rules — ten of them, each set to enforce, warn or off. Enforce blocks publication; warn still appears on the reviewer's checklist but does not block. The editor shows what the policy is currently holding, and the listing review inspector links straight to the policy behind the check it just failed.

**Asking the seller a question.** `operator.html → Catalogue → review a listing → Ask the partner`. It names who the query goes to, pre-fills the issue, and refuses to send a query with no actual ask in it. Sending it records a real query against the listing with a due date in working days, and offers to hold the listing so the delay is attributed to the seller rather than to your desk. The next reviewer sees the open query at the top of the inspector.

**Gate policy.** `operator.html → Partner onboarding → Gate policy`. Owner, target days and dual control are editable per gate. KYC and Agreements cannot be made waivable — the dialog explains that a waiver there is not a shortcut, it is an unsigned counterparty — and the toggles are disabled rather than merely ignored.

**Redirection that lands filtered.** Each marketplace card links through to its partners, its catalogue and its commission plans with the filter already applied, and says so. A partner sits in several marketplaces at once, so the partner directory filters on membership rather than on a field match.

**The account menu.** The avatar in the top bar was the most-clicked dead control in the prototype. It now opens a real menu: My details, change password, sign-in and security, notification preferences, and what your role may do. **My details** is a working screen in all four portals — name, job title, contact, time zone, date format, and cover while you are away. Saving refuses an empty name or a malformed email, writes to the user record, and updates the top bar rather than leaving the old name in the header. Marking yourself away without a delegate says plainly that work will simply wait; setting one routes it, and coming back clears it.

**Tax configuration.** `operator.html → Tax configuration`. Six jurisdictions, each with its own rate, registration number, place-of-supply rule and — the fact everything else follows from — whether the **marketplace or the seller is merchant of record**. A jurisdiction cannot be set active without a registration number. Brazil is deliberately left unregistered so the screen has something honest to declare. Partner withholding is driven by tax certificates: no valid treaty certificate means statutory withholding, recording one releases it from the next run, and the screen states that withholding is remitted in the partner's name rather than kept. The buyer states its own GSTIN and sees whether input credit is claimable; the seller sees the withholding on its own payouts; the consumer storefront reads tax-inclusive or tax-exclusive from the same configuration, and the basket maths no longer adds tax on top of a price that already contains it.

**Export writes a file.** Every Export button opens a dialog that names the columns, offers what-is-on-screen versus everything, and offers CSV or JSON — then generates the file in the browser and downloads it. Values come from the record rather than the rendered HTML, so a status exports as its code and not as the text inside a chip; action columns are dropped; commas, quotes and newlines are escaped properly. If the view is filtered the dialog says how many records are hidden. Screens that are charts rather than lists register their own data set, so the marketplace overview exports the figures behind the chart — and separates third-party from first-party GMV rather than reporting a 0% take rate on revenue the operator already keeps in full.

**Billing configuration.** `operator.html → Billing configuration`. Two things that are usually scattered sit together. **Bill formatting** — document title, template, numbering pattern with `{YYYY}`/`{PARTNER}`/`{SEQ}` tokens, date format, tax label, rounding, remittance wording and footer — renders a live paper-like preview as you type, and the pattern flows straight through to real statement references. **Bill cycle by partner** is the one that matters: the commission plan sets a default, but the partner record is what actually runs, and three partners here differ from their plan. Changing a cycle away from the plan default will not save without a stated reason, so an override always carries the answer to "why is this one different". Resetting puts the partner back on the plan and drops the now-meaningless note. The enterprise buyer gets the same formatting panel for its own invoices — PO requirement, split by seller, break down by cost centre — and the partner sees their cycle read-only, with the negotiated reason if theirs is an override.

**Users — in every persona.** Each portal has a user directory showing role, MFA state, password age and strength. The roles differ because the job differs: the operator separates the onboarding desk from the settlement approver; the partner separates catalogue from fulfilment from finance; the buyer's roles mirror its own approval policy, so a requester cannot approve their own requisition. On the consumer account the same screen is **household access** — members, their role and a monthly spend cap, with anything over the cap routed to the account owner.

**Roles configuration — its own screen in every persona.** The capability matrix is editable: every cell cycles none → scoped → full and writes straight to the role. Roles can be created from nothing or cloned from an existing one, and a new role immediately becomes a column in the matrix with nobody in it. Built-in roles can be edited but not deleted, because the platform routes work to them by name; a custom role that is still assigned cannot be deleted either — the dialog lists who holds it and sends you to reassign them first.

**Passwords, MFA and sessions.** Every persona has a security panel: password age and strength, an MFA toggle, an open-session count, and the policy stated in full next to it. Changing your own password refuses anything below policy, refuses a mismatched confirmation, scores strength live, and signs out other sessions. On someone else's account an admin can send a reset link or force a reset — force needs RESET typed, flags the account, and clears their sessions. Turning MFA off needs OFF typed, because it is a downgrade and should feel like one. Rotation on a schedule is deliberately not required, and the screen says why.

Inviting refuses a malformed email and will not submit without a name. The new person lands as **Invited** with no permissions in effect until they accept. Changing a role states that it takes effect at their next sign-in and warns you if you are changing your own. Removing needs REMOVE typed, and you cannot remove yourself — that action is absent, not disabled.

**Notification rules — in every persona.** Rules address a **role**, not a person, so moving someone between roles changes what they are told without anyone editing a rule. **New rule** is a working builder: pick the event (scoped to what that persona can actually see), the audience, the channels, the severity and the throttle. A rule with no channel is refused, because it would do nothing. It is created switched on, with a default message already written, and it appears in the table immediately. Existing rules open for editing, and a rule you created can be deleted with DELETE typed — the dialog points out that switching it off is usually what you meant.

**Notification message content — per rule, per channel.** Every rule has editable wording with a tab per channel, because an SMS is not a shortened email. Merge tokens are click-to-insert and the preview substitutes sample values rather than showing braces; an unrecognised token is flagged instead of being silently dropped. SMS counts characters and segments against the 160-character limit and says when it will split. Switching channel keeps what you typed. An empty message is refused. Each row records whether the wording is default or customised, by whom and when, and there is a reset.

**Notification rules — how they behave.** Rules address a **role**, not a person, so moving someone between roles changes what they are told without anyone editing a rule. Toggles are live and say who stops being alerted. SMS is reserved for urgent severity so it keeps meaning something. Quiet hours have a stated exception per persona, and the delivery log shows a bounced address being retired after two retries.

**My details — every control changes a record.** `consumer.html → My details`. Saving refuses an empty name or a malformed email. Cards validate the number, the expiry and the security code, keep only the last four digits, and enforce that exactly one method is the default — the last working method cannot be removed. Wallet top-ups credit the balance and write to a history; reward points redeem into wallet credit at a stated rate and reset to zero. Addresses have a full add / edit / set-default / delete cycle with a six-digit PIN check, and a default always survives a deletion. A data request records a reference and a 30-day due date. Closing the account is scheduled 30 days out, states what happens to subscriptions, in-flight orders, wallet balance and household members, and can be stopped from the banner it puts on the screen.

**Storefront tools are real too.** The coverage checker returns a survey for known PIN codes, says *Not surveyed* where a network has not been measured, and admits it has no data for an unknown code rather than inventing a level. Trade-in quotes by model and condition, records the credit and takes it off the basket total. The bundle builder applies a stated rule — 5% per subscription capped at 15% — refuses a fourth subscription and a bundle with none, and drops the real items into the basket.

**Order pipelines differ by fulfilment type**, because pretending otherwise is what makes a prototype feel fake. eSIM: placed → authorised → profile issued → activated. Shipped: placed → authorised → packed → in transit → delivered. Provisioned: placed → approved → provisioning → configured → live.

---

## Journey tests

```bash
node _src/journeys.js             # 271 checks — the buying, selling and governance journeys
node _src/journeys_config.js      # 204 checks — roles, passwords, export, profile, billing and tax
node _src/journeys_catalogue.js   # 193 checks — notifications, onboarding, catalogue, plans and reporting
node _src/journeys_commerce.js    # 112 checks — media, integrations, pricing and the discount engine
```

780 checks that drive each journey to its conclusion and assert the records actually changed — not that a screen rendered. They click through the confirmation dialogs exactly as a person would.

They also cover the things that make a prototype feel broken: that typing in a search box does not lose characters or focus, that the wizard keeps what you entered, that dismissing a dialog changes nothing, and that a high-risk action stays disabled until the confirmation word is typed.

Writing them found three genuine bugs worth noting:

1. **Confirmation dialogs read their own form fields after the dialog had been removed from the DOM**, so anything typed into a dialog — a licence count, a business reason, an intervention outcome — was silently discarded. Values are now captured before teardown and passed to the handler.
2. **"Invite a partner" was a dead-end toast** claiming an invitation had been sent without ever asking who to send it to. It is now a validated form that creates a real partner record and names the recipient.
3. **The gate machine reopened gates that were already cleared.** A partner adding a second marketplace carries KYC and bank verification over; advancing past the agreements gate was pushing them back into a finance gate they had already passed.
4. **Every status chip rendered as a `?` box** on machines without a symbol fallback font, because the shapes were typed as Unicode dingbats that Poppins does not carry. Now SVG, with a test that catches any regression.
5. **`pill('neutral', …)` had no entry in the status map**, so it silently fell through to the "unavailable" style — which is where several of those `?` marks were coming from.
6. **The top bar wrapped instead of truncating.** At common widths the organisation name, the environment chips and the persona's name all wrapped onto extra lines and overflowed a 52px row. It is now a strict single-line flex row where everything truncates, with a defined drop order as width runs out: environment name, then the persona's text, then the breadcrumb trail. The freshness chip also flipped to "Stale" after 45 seconds, which made a healthy header look broken during a demo; it now shows the age of the data, only marks it stale after five minutes, and is a working refresh button.
7. **The confidence chip on every AI insight rendered as a tall empty box.** It was a flex child with the default `align-items: stretch`, so a 10px label was stretched to the full height of the card and read as an unlabelled outline. It is now a proper chip pinned to the top of the insight, carrying a three-bar meter as well as the word, so the level survives monochrome. Every insight also now states which record sets it read.
8. **The basket added tax on top of a tax-inclusive price.** Shelf prices are configured as tax-inclusive, but the checkout was computing `price × 18%` and adding it, overstating every total by the tax on the tax. Tax is now derived from the configured jurisdiction and backed out of an inclusive price rather than added to it.
9. **Cached tables kept their original row array.** Tables are cached so a person's sort, search and page survive a re-render — but the cache was also holding the rows captured on first render, so a record created by any journey never appeared in the table it belonged to. Rows now refresh on every render while the view state is preserved. This one was affecting every table in every persona.

```bash
node _src/smoke.js partner.html    # render check: every screen, every control
```

Both require `npm install jsdom`.

---

## Where the design contract shows up

**Governance has consequences.** Approve is disabled on a listing that breaches content policy 7.4. A suspended seller's enterprise customer is told their 120 licences will not renew, on the screen where they manage them. A commission rate change carries a 30-day notice, a no-retrospective-application rule, and a note that partners on a signed schedule may have a termination right.

**Missing data is declared, never invented.** Cold-chain sensors show as delivered but have sent no telemetry — utilisation renders as *Not measured*, not zero, because those are different claims. Roughly a fifth of partner-channel GMV cannot be attributed to a campaign and is reported as unattributed rather than assigned by inference. One partner's adoption figure is left blank rather than shown as 0%.

**AI is confined and sourced.** Orange appears only on AI surfaces and never as a filled CTA. Every insight carries a confidence label, including *Low confidence — partial evidence* where the data genuinely does not settle the question. Every assistant answer cites which record sets it read.

**State never depends on colour alone.** Status chips carry a shape, meters carry a diagonal pattern above 75% and 90%, and the six marketplace category badges each carry their own icon — so a vertical is identifiable in monochrome.

**Shapes are SVG, not Unicode.** They were originally typed as dingbats — U+25C9, U+25B2, U+25D0, U+2713 and so on. Poppins carries no glyph for any of them, so on a machine without a symbol fallback font every status chip rendered as a `?` box. All of them are now inline SVG. A test walks every screen of every persona and fails if a single dingbat character reaches the DOM.

**Partner tiers are a category, not a state.** Platinum, Gold, Silver and Bronze previously borrowed the informational, warning and neutral state colours, which made Gold read as a caution and Bronze as disabled. They now have their own four-colour palette and four distinct shapes — star, diamond, hexagon, square — all clearing AA on their own tint.

**Accessibility.** Skip link, semantic landmarks, keyboard-operable sortable headers, focus trapping and restoration in dialogs, `prefers-reduced-motion` honoured, ARIA live regions on toasts, accessible names on every icon-only control. Validated at 1920, 1440, 1280 and 1024 with no overlap, clipping or horizontal overflow. Every colour pair used for text clears WCAG 2.2 AA.

---

## Branding

As requested: the **operator, consumer and partner** portals carry 6D brand identity — the approved 6D wordmark in the rail on brand navy `#0D1B4B` chrome. The **enterprise buyer** portal is neutral and carries **no 6D mark at all**, so it demos as genuinely white-label. A test asserts that gating both ways.

The mark ships at `assets/brand/`:

| File | Use | SHA-256 |
|---|---|---|
| `6d-logo-white.png` | Dark rails and the launcher header | `1aee8800…78b7a` |
| `6d-logo.png` | Light surfaces, if needed | `3b0835ac…0cee0a` |

Neither hash matches the one recorded in the nim-ui-design-system-v2 skill, which refers to a different file. These are the assets you supplied, used as-is and never reconstructed in text, CSS or SVG. Worth confirming with the UI-1 owner that they are the approved versions.

Brand identity is applied to the application chrome only. The workspace surface stays on the nim contract tokens in every portal, so switching brand does not change density, type, state colour or behaviour — which is the point of a white-label platform.

Two notes worth raising before this goes in front of anyone:

1. **6D Energy Orange `#F4651F` is deliberately absent.** It sits within a few points of the contract's AI-only accent `#EE743B`, and the contract states orange is not a primary CTA colour and must not dominate. Using the brand orange for buttons would make AI surfaces indistinguishable from ordinary ones.
2. **Primary buttons fill with `--nim-primary-600`, not `-500`.** White on `primary-500` measures 3.00:1 against a 4.5:1 requirement. `primary-500` keeps its contract role as the link, selection and focus-ring colour.

The official 6D mark renders only from the approved asset at `assets/brand/6d-logo-white.png`. It is never reconstructed in text, CSS or SVG. The asset is not bundled — drop the approved PNG into `assets/brand/` and it appears in every portal with no code change.

---

## Rebuilding

`_src/` holds the editable source.

```
_src/core.css          Design system — nim tokens, shell, tables, states, commerce components, brand themes
_src/icons.js          Lucide icon set, inlined (ISC)
_src/core.js           App shell, router, DataTable, charts, dialogs, basket, AI assistant
_src/mp_data.js        Seeded marketplace dataset shared by all four personas
_src/mp_shared.js      Product cards, order pipeline, basket, settlement split — and the state layer
_src/journeys.js       End-to-end journey tests
_src/smoke.js          Per-persona render tests
_src/views_*.js        Per-persona screens
```

```bash
python3 _src/build.py                # rebuild everything, and fail on a scope violation
python3 _src/build.py partner.html   # rebuild one
node _src/journeys.js                # 83 end-to-end journey checks
node _src/smoke.js partner.html      # render check for one persona
```

`mp_shared.js` also holds the state layer — order creation, requisitions, the onboarding gate machine, listing publication and settlement approval. Those functions are what the journey tests exercise.

---

## Earlier work

An Enterprise Self-Care prototype set — built from a different PRD before the marketplace scope was clear — is kept under `selfcare/` with its own README. It is not part of this deliverable and shares none of this dataset.

---

## Suggested companions

A **click-through demo script** mapping each screen to the marketplace vertical it evidences; a **TMF Open API mapping** binding these screens to TMF620 product catalogue, TMF632 party management, TMF637 product inventory, TMF666 account and TMF678 billing, so the prototype doubles as an integration brief; and a **competitive one-pager** positioning this against Mirakl, AppDirect and the Salesforce/ServiceNow build-your-own route, which is the comparison that actually gets asked in the room.

Sources consulted for marketplace patterns: [Netcracker on B2B2X digital marketplaces](https://www.netcracker.com/blog/view-all/digital-marketplaces-seizing-the-b2b2x-opportunity.html) · [STL Partners on B2B2X marketplaces](https://stlpartners.com/articles/enterprise/b2b2x-marketplaces-what-why-and-how/) · [Mirakl seller platform](https://www.mirakl.com/ecosystem/sellers) · [AppDirect / Deutsche Telekom Business Marketplace](https://www.appdirect.com/customers/deutsche-telekom) · [Vodafone Business Marketplace](https://marketplaceshowhome.vodafone.com/) · [CSG on profitable partner ecosystems](https://www.csgi.com/insights/profitable-partner-ecosystems-for-telecos) · [TM Forum TMF620 Product Catalogue API](https://www.tmforum.org/oda/open-apis/directory/product-catalog-management-api-TMF620/v5.0)
