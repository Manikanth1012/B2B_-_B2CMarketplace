/* Help for this screen, on every screen.
 *
 * `articleForView(persona, view)` looks an article up by the screen it belongs
 * to, and 19 of the 71 screens had one. On the other 52 the help button opened
 * a dialog that said "There is no article for this screen yet" — a control
 * present on every header, answering nothing five times out of six.
 *
 * The gap was not evenly spread. The screens that had articles were the ones
 * written first: dashboards, onboarding, settlement. Everything added since —
 * markets, wallets, the ledger, revenue share, refunds, rewards, notifications,
 * every enterprise marketplace — arrived without one, because nothing failed
 * when it did.
 *
 * These are written from what each screen actually does rather than from its
 * title, which is why they name the rules: that a threshold is a chosen figure
 * in the account's own money, that approving is ordering, that a settlement
 * line carries the rate it was frozen at. A help article that only restates the
 * heading is the same empty dialog with more words in it.
 */

insert into kb_articles
  (id, persona, kind, title, mins, updated, view, roles, tags, summary, body, status, sort_order, personas, audience_note, audience_ids)
values

/* ------------------------------------------------------------- consumer -- */

('KB-C07', 'consumer', 'concept', 'What a product page is telling you', 2, '04 Aug 2026', 'product', '{}', '{"shopping"}',
 'Price, seller, stock and what the rating is counted from.',
 '[["Who is selling it","Every item names its seller. The marketplace settles with them; support comes through one queue whoever that is."],
   ["The price you see","The price for the market you are shopping in, chosen for that market rather than converted from another. Switching market changes it because it is a different price, not a different sum."],
   ["Stock","In stock, low, or out. Out of stock offers to tell you when it returns rather than letting you order something nobody can send."],
   ["Ratings","Counted from reviews left by people who bought it here. The number in brackets is how many, which is the part worth reading."]]'::jsonb,
 'published', 7, '{"consumer"}', '', '{}'),

('KB-C08', 'consumer', 'howto', 'Checking out, and what you are charged', 3, '04 Aug 2026', 'checkout', '{}', '{"ordering","billing"}',
 'Delivery, tax, and the figure that actually leaves your account.',
 '[["The total","Items, then delivery, then tax at your market''s rate under its own name — GST, VAT or the local equivalent. The total is the sum of what is shown, with nothing added afterwards."],
   ["Delivery address","Taken from your address book. A new one can be added here and is saved for next time."],
   ["What is charged","One charge, in the currency shown. The order stores that currency, so the bill you download later says the same figure rather than a re-converted one."],
   ["If something is out of stock","The basket says so before you pay. Nothing that cannot be sent is ordered."]]'::jsonb,
 'published', 8, '{"consumer"}', '', '{}'),

('KB-C09', 'consumer', 'concept', 'How reward points work', 2, '04 Aug 2026', 'rewards', '{}', '{"rewards"}',
 'What earns them, what they are worth, and when a tier changes.',
 '[["Earning","Points come from orders that completed. A refunded order takes its points back with it, which is why a balance can go down."],
   ["Tiers","Bronze, Silver and Gold, set by what you have spent over the qualifying period. The screen shows the distance to the next one rather than only the badge."],
   ["Spending them","Applied against an order at checkout. The value is fixed by the operator and shown before you commit."],
   ["Expiry","Points sitting unused expire on the published schedule. The rewards screen names the next date that affects you."]]'::jsonb,
 'published', 9, '{"consumer"}', '', '{}'),

('KB-C10', 'consumer', 'start', 'Finding an answer here', 2, '04 Aug 2026', 'kb', '{}', '{"help"}',
 'How this knowledge base is arranged and what to do when it does not answer.',
 '[["Arranged by what you are doing","Filter by kind — getting started, how-to, policy, fixing something — or search the titles and summaries."],
   ["Written for you","You see the articles published to shoppers. Sellers, businesses and the marketplace desk each have their own set."],
   ["Was it useful","Every article takes a yes or no and a reason. It goes to whoever owns the words, not to a public page — it is a work queue, not a review."],
   ["If it is not here","Raise a ticket from Support. Attach a screenshot; it reaches the same queue with the article you were reading noted against it."]]'::jsonb,
 'published', 10, '{"consumer"}', '', '{}'),

/* ------------------------------------------------------------- operator -- */

('KB-O11', 'operator', 'howto', 'The seller directory', 3, '04 Aug 2026', 'op-partners', '{"OR-ADMIN","OR-ONB"}', '{"partners"}',
 'Finding a seller, reading their record, and what each state means.',
 '[["What a row is","One seller, with the state of their account, the markets they sell in and the categories they are eligible for."],
   ["States","Onboarding, active, suspended, closed. Suspension stops new orders and leaves settlement running, because money already owed is still owed."],
   ["Their record","Opening a seller shows their onboarding gates, documents, categories, commission plan and bill history in one place rather than five screens."],
   ["Changing one","Category eligibility and lifecycle state are changed here and written to the audit log with who did it."]]'::jsonb,
 'published', 11, '{"operator"}', '', '{}'),

('KB-O12', 'operator', 'concept', 'Inventory and warehouses', 3, '04 Aug 2026', 'op-inventory', '{"OR-CAT","OR-SUP"}', '{"inventory"}',
 'Where stock figures come from and why a listing can be live with none.',
 '[["What is counted","Stock per product per warehouse. The storefront shows the total across warehouses that serve that market."],
   ["Reconciled against the catalogue","Every inventory row names a product that exists and calls it what the catalogue calls it. A row that does not is a fault, not a variant."],
   ["Live with no stock","Allowed, and shown as out of stock to shoppers with the option to be notified. Taking the listing down instead loses the demand signal."],
   ["Services have none","A subscription or a plan is not stocked. Those rows carry no quantity and are not counted as missing."]]'::jsonb,
 'published', 12, '{"operator"}', '', '{}'),

('KB-O13', 'operator', 'howto', 'Tickets and the SLA clock', 3, '04 Aug 2026', 'op-tickets', '{"OR-SUP"}', '{"support"}',
 'How a ticket is picked up, what stops the clock, and what breaches look like.',
 '[["The queue","Oldest first within priority. Priority comes from the audience and the kind of problem, not from who shouted."],
   ["Taking one","Picking a ticket assigns it to you and starts your response clock. It is visible to the raiser."],
   ["What stops the clock","A reply to the raiser. Waiting on them pauses it; waiting on us does not."],
   ["Breaches","A ticket past its target is marked rather than hidden, and stays marked after it is closed. That is the record the SLA report is drawn from."]]'::jsonb,
 'published', 13, '{"operator"}', '', '{}'),

('KB-O14', 'operator', 'policy', 'Dunning rules', 3, '04 Aug 2026', 'op-dunning', '{"OR-FIN"}', '{"billing","policy"}',
 'What happens to an unpaid invoice, and how the ladder differs by audience.',
 '[["A ladder per audience","Shoppers, sellers and business accounts are chased differently, because a consumer card failing and a business account on Net 30 are not the same event."],
   ["Steps","Each step is a wait, a message and an action — remind, warn, restrict, suspend. The wait is in days from the due date."],
   ["Tier matters","A higher tier can carry a longer ladder. That is a commercial decision and it is recorded as one."],
   ["Changing a ladder","Applies to cases entering it from now on. Cases already part-way through keep the ladder they started under, so nobody is suspended by a rule written after their invoice."]]'::jsonb,
 'published', 14, '{"operator"}', '', '{}'),

('KB-O15', 'operator', 'concept', 'The developer portal', 2, '04 Aug 2026', 'op-developer', '{"OR-ADMIN"}', '{"integration"}',
 'Keys, webhooks and what a seller can reach through the API.',
 '[["Keys","Issued per seller and shown once. A key that is lost is replaced, not recovered."],
   ["Scope","A key reaches only that seller''s own listings, orders and settlements. There is no key that reads the whole marketplace."],
   ["Webhooks","Order and settlement events, retried on failure with the attempt history kept so a missed delivery can be told from one never sent."],
   ["Sandbox","A separate environment with its own keys and its own data. Nothing in it reaches real buyers."]]'::jsonb,
 'published', 15, '{"operator"}', '', '{}'),

('KB-O16', 'operator', 'howto', 'Promotions', 3, '04 Aug 2026', 'op-promotions', '{"OR-CAT","OR-FIN"}', '{"pricing"}',
 'Who a promotion applies to, who pays for it, and when it stops.',
 '[["Scope","A promotion names the audience, the markets and the products it covers. Anything outside is untouched."],
   ["Who funds it","Marketplace-funded or seller-funded, and it is recorded, because settlement has to know whose margin the discount came out of."],
   ["Dates","Start and end are in the market''s own time. A promotion that has ended is kept rather than deleted — orders placed under it reference it."],
   ["Overlaps","Two promotions covering one product do not stack. The one better for the buyer applies and the screen says which."]]'::jsonb,
 'published', 16, '{"operator"}', '', '{}'),

('KB-O17', 'operator', 'howto', 'Storefront banners', 2, '04 Aug 2026', 'op-banners', '{"OR-CAT"}', '{"storefront"}',
 'Slots, artwork and where each banner actually appears.',
 '[["Slots","Each surface has a fixed set of slots. A banner belongs to a slot rather than floating, so the storefront cannot end up with two heroes or none."],
   ["Artwork","Uploaded per banner with its own alt text. Alt text is not optional — the banner is a link and a link with no name is unusable to anybody not looking at it."],
   ["Audience","A banner is published to shoppers, businesses or both. The signed-out landing page shows the ones published to everybody."],
   ["Scheduling","A banner with dates appears and disappears on them. One with none is live until it is taken down."]]'::jsonb,
 'published', 17, '{"operator"}', '', '{}'),

('KB-O18', 'operator', 'concept', 'Notification channels', 2, '04 Aug 2026', 'op-channels', '{"OR-ADMIN"}', '{"notifications"}',
 'Email, SMS and in-app — what each is for and what happens when one fails.',
 '[["Channels","Email, SMS and in-app. A channel is configured once here and referenced by every rule, so a sender address is changed in one place."],
   ["Fallback","A rule can name a fallback channel. If the first fails to send, the fallback is tried and both attempts are recorded."],
   ["Quiet hours","Set per channel in the recipient''s own market time. A quiet-hours message waits; it is not dropped."],
   ["Failures","A send that fails is visible with its reason. Silence is the failure mode this screen exists to prevent."]]'::jsonb,
 'published', 18, '{"operator"}', '', '{}'),

('KB-O19', 'operator', 'howto', 'Notification rules and templates', 3, '04 Aug 2026', 'op-notifications', '{"OR-ADMIN"}', '{"notifications"}',
 'What triggers a message, who receives it, and how the wording is edited.',
 '[["A rule","An event, an audience, a channel and a template. Changing any one of the four changes who hears what."],
   ["Recipients","By role rather than by name, so a message follows the job when somebody leaves. A rule with no matching recipient is flagged rather than silently sending nothing."],
   ["Templates","Edited here with the fields the event supplies. A template referencing a field the event does not carry is refused at save, not at send."],
   ["History","Every send is kept with its channel and outcome. That is what answers whether somebody was told."]]'::jsonb,
 'published', 19, '{"operator"}', '', '{}'),

('KB-O20', 'operator', 'policy', 'Roles and users', 3, '04 Aug 2026', 'op-roles', '{"OR-ADMIN"}', '{"security","policy"}',
 'What a role grants, who can change one, and what is written down.',
 '[["Roles grant screens and actions","Not data. A role that can open settlement can open all of it; there is no half-visible ledger."],
   ["Changing a role","Takes effect on the person''s next request. They are told, and the change is in the audit log with who made it."],
   ["The last administrator","Cannot be demoted or removed. An account nobody can administer is an account nobody can fix."],
   ["Invitations","An invitation names the role before it is accepted, so nobody joins and then discovers what they can do."]]'::jsonb,
 'published', 20, '{"operator"}', '', '{}'),

('KB-O21', 'operator', 'howto', 'Moderating reviews', 3, '04 Aug 2026', 'op-reviews', '{"OR-SUP","OR-CAT"}', '{"reviews"}',
 'What is screened, what is published, and what the seller can see.',
 '[["What arrives","Reviews from buyers who bought the product here. Nothing else can be written, which is most of the moderation done before it starts."],
   ["Screening","Held for a decision if it trips the screen. Publishing and rejecting both record who decided and why."],
   ["The seller''s view","A seller sees reviews of their own products, published or held, and can reply once published. They cannot remove one."],
   ["Not the same as feedback","A review is a buyer''s opinion of a product, published to other buyers. Content feedback is a reader''s opinion of our words and is never published."]]'::jsonb,
 'published', 21, '{"operator"}', '', '{}'),

('KB-O22', 'operator', 'concept', 'Content feedback', 2, '04 Aug 2026', 'op-feedback', '{"OR-SUP"}', '{"content"}',
 'Which page is failing, for whom, and in what way.',
 '[["Not a satisfaction score","The useful output is which page is failing and how, because that is a ticket somebody can pick up. A percentage is not."],
   ["Ranked by readers let down","By the number of unhappy readers rather than by percentage — one unhappy reader out of one is nought per cent helpful and is not the problem."],
   ["Themes carry a remedy","Each complaint kind names what to do about it. Counting problems without naming the fix produces a report, not work."],
   ["By persona","The same article failing sellers and shoppers is a different problem from one failing only sellers, so who complained is kept."]]'::jsonb,
 'published', 22, '{"operator"}', '', '{}'),

('KB-O23', 'operator', 'concept', 'Wallets', 2, '04 Aug 2026', 'op-wallets', '{"OR-FIN"}', '{"money"}',
 'Whose money the marketplace is holding, and what may move it.',
 '[["What a wallet is","A balance the marketplace holds for somebody — a shopper, a seller or a business account — in one named currency."],
   ["What moves it","Refunds in, spends out, top-ups and settlement. Every movement is a ledger entry with a reference to what caused it."],
   ["No bare adjustments","A balance is not typed in. It is the sum of its movements, which is what makes it reconcilable."],
   ["Currency","A wallet holds one currency. An account trading in two has two wallets rather than one converted balance."]]'::jsonb,
 'published', 23, '{"operator"}', '', '{}'),

('KB-O24', 'operator', 'howto', 'Refunds', 3, '04 Aug 2026', 'op-refunds', '{"OR-FIN","OR-SUP"}', '{"money","support"}',
 'Who asks, who decides, and where the money comes from.',
 '[["Raised against an order line","Not against an order. A parcel arriving damaged is one line, and refunding the whole order would be refunding things that arrived fine."],
   ["The decision","Approve, decline or part-refund, each with a reason the buyer sees. A decline with no reason is not accepted."],
   ["Where it goes","Back to the original payment method, or to the wallet if that is no longer reachable. The choice is recorded."],
   ["The seller''s side","A refund on a settled line is recovered from the next settlement run and appears on their statement as its own entry, not as a smaller sale."]]'::jsonb,
 'published', 24, '{"operator"}', '', '{}'),

('KB-O25', 'operator', 'policy', 'Reward rules', 3, '04 Aug 2026', 'op-rewards', '{"OR-FIN"}', '{"rewards","policy"}',
 'Earn rates, tiers, and who pays for the points.',
 '[["Earn rates","Set per audience and tier. A rate change applies to orders placed after it, never retrospectively — points already earned were earned under the rule of the day."],
   ["Tiers","Thresholds are chosen figures in a named currency, not converted from another market''s. A tier boundary in rupees is a rupee decision."],
   ["Who funds them","Marketplace or seller, recorded per rule, because settlement has to know."],
   ["Proposals","A rule change is proposed and approved rather than saved directly. The screen shows what it would have done to the last period before anybody agrees to it."]]'::jsonb,
 'published', 25, '{"operator"}', '', '{}'),

('KB-O26', 'operator', 'concept', 'The general ledger', 4, '04 Aug 2026', 'op-ledger', '{"OR-FIN"}', '{"money"}',
 'The chart of accounts, how marketplace events map onto it, and what a period close does.',
 '[["Chart of accounts","The accounts every marketplace event posts to. It is edited here and nowhere else."],
   ["Mapping","Each event kind — a sale, a commission, a refund, a settlement — names the accounts it debits and credits. An unmapped event is held rather than posted to a default."],
   ["Balances","Per account per currency. Nothing is summed across currencies, because a total in no currency answers no question."],
   ["Closing a period","Freezes it. Entries after a close land in the next period with a reference back, rather than reopening a period somebody has already reported on."]]'::jsonb,
 'published', 26, '{"operator"}', '', '{}'),

('KB-O27', 'operator', 'policy', 'Revenue share', 3, '04 Aug 2026', 'op-revshare', '{"OR-FIN"}', '{"money","policy"}',
 'Commission plans, what they apply to, and when a change takes effect.',
 '[["A plan","A commission rate per category, held against a seller tier. A seller is on exactly one plan at a time."],
   ["What it applies to","The line value before tax and after any marketplace-funded discount. Seller-funded discounts come off the seller''s side, which is why who funded a promotion is recorded."],
   ["Changing a plan","Effective from a date. Orders before it settle at the old rate — a settlement that re-rates history is one nobody can reconcile."],
   ["Published before listing","A seller sees their commission before they list anything. That is the point of the plan being a record rather than a negotiation."]]'::jsonb,
 'published', 27, '{"operator"}', '', '{}'),

('KB-O28', 'operator', 'howto', 'Bill and invoice templates', 3, '04 Aug 2026', 'op-billtemplates', '{"OR-FIN"}', '{"billing"}',
 'Building the document a buyer downloads, and what it must carry.',
 '[["One template per audience","A shopper''s bill and a business invoice are different documents with different legal content, so they are different templates."],
   ["Fields","Dragged from what the bill actually holds. A template cannot reference a field the document does not carry — that is refused at save."],
   ["Tax","Named as the market names it and shown at the rate frozen on the bill, not the rate today."],
   ["Preview","Rendered against a specimen record so the layout is checked against real content rather than against placeholder text."]]'::jsonb,
 'published', 28, '{"operator"}', '', '{}'),

('KB-O29', 'operator', 'concept', 'Markets and currencies', 4, '04 Aug 2026', 'op-markets', '{"OR-ADMIN","OR-FIN"}', '{"money","markets"}',
 'What a market decides, which currencies it takes, and who may sell where.',
 '[["A market decides three things","The currencies it trades in, its tax rate, and what that tax is called. They move together, which is why they are one record."],
   ["More than one currency","A market can take several. The first is its default; the rest are offered to buyers there and accepted by the guards on orders and requisitions."],
   ["Rates","Dated. A figure converted for a limit test is converted at the fix in force on the day of the thing being tested, not today''s."],
   ["Who sells where","A seller is granted markets. A grant that is withdrawn stops new listings and leaves existing orders and settlements alone."]]'::jsonb,
 'published', 29, '{"operator"}', '', '{}'),

('KB-O30', 'operator', 'howto', 'Your own details', 2, '04 Aug 2026', 'op-profile', '{}', '{"account"}',
 'Your name, your sign-in, and the security settings on it.',
 '[["Your details","Name and contact address, which is what appears against decisions you make in the audit log."],
   ["Password","Changed here with your current one. A change signs out your other sessions."],
   ["Two-factor","Enrolled here. A role that requires it cannot be held without it, and the screen says so before you are moved to one."],
   ["Sessions","Where you are signed in, with the ability to end any of them."]]'::jsonb,
 'published', 30, '{"operator"}', '', '{}'),

('KB-O31', 'operator', 'start', 'Running the knowledge base', 3, '04 Aug 2026', 'op-kb', '{"OR-SUP","OR-ADMIN"}', '{"content"}',
 'Writing articles, choosing who sees them, and reading the feedback.',
 '[["Per persona","An article is published to one or more audiences. A seller article and a shopper article on the same subject are two articles, because the reader is different."],
   ["Contextual help","An article can name the screen it belongs to. That is what the help button on that screen opens, so naming it is what makes the button useful."],
   ["Held and published","Held articles are drafts nobody outside the desk can reach. Publishing is a decision with a name against it."],
   ["Feedback","Every article takes a yes or no from its readers. Content feedback ranks what to fix; it is a work queue, not a score."]]'::jsonb,
 'published', 31, '{"operator"}', '', '{}'),

/* -------------------------------------------------------------- partner -- */

('KB-P12', 'partner', 'start', 'Getting through onboarding', 4, '04 Aug 2026', 'pt-onboarding', '{"PR-OWNER"}', '{"onboarding"}',
 'The seven gates, what each needs, and what is holding yours up.',
 '[["Seven gates, in order","Each one has to be passed before the next opens. The rail shows where you are and what the next gate wants."],
   ["Documents","Each gate names the documents it needs. An uploaded document is checked by the desk, and a rejection says what was wrong rather than only that it was refused."],
   ["Categories","Some categories need more than the base set — the extra documents appear once you ask for that category."],
   ["Five working days","The published target from a complete submission. Incomplete submissions do not start the clock, which is why the rail shows what is outstanding."]]'::jsonb,
 'published', 12, '{"partner"}', '', '{}'),

('KB-P13', 'partner', 'howto', 'Your orders', 3, '04 Aug 2026', 'pt-orders', '{"PR-OPS"}', '{"ordering"}',
 'What arrives, what you have to do, and by when.',
 '[["An order line is yours","You see lines for your own products. An order spanning several sellers reaches each of you as your own part of it."],
   ["Acceptance","Accept or reject with a reason. A rejection releases the buyer to order elsewhere rather than leaving them waiting."],
   ["Dispatch","Marking dispatched carries a tracking reference. That is what the buyer sees and what the SLA is measured against."],
   ["Cancellations","A buyer can cancel before dispatch. After it, it becomes a return and goes through refunds."]]'::jsonb,
 'published', 13, '{"partner"}', '', '{}'),

('KB-P14', 'partner', 'concept', 'Your settlement plan', 3, '04 Aug 2026', 'pt-plan', '{"PR-FIN","PR-OWNER"}', '{"money"}',
 'The cycle you are on, the commission you pay, and when it changes.',
 '[["The cycle","How often a run happens and how long after it the money moves. Both are published, so a payment can be predicted rather than chased."],
   ["Commission","Per category, from the plan your tier is on. It is visible before you list anything."],
   ["Tier","Set by trading history against published thresholds. Moving tier moves your plan from a stated date, not retrospectively."],
   ["Changes","A plan change names the date it applies from. Orders before it settle at the old rate."]]'::jsonb,
 'published', 14, '{"partner"}', '', '{}'),

('KB-P15', 'partner', 'concept', 'Your performance', 3, '04 Aug 2026', 'pt-performance', '{"PR-OWNER","PR-OPS"}', '{"performance"}',
 'What is measured, over what window, and what it affects.',
 '[["What is measured","Acceptance, dispatch time, cancellation rate, return rate and review score. Each against a published target."],
   ["The window","A rolling period, stated on the screen. A single bad week is visible without being permanent."],
   ["What it affects","Tier, and therefore commission and settlement cycle. The link is stated rather than implied."],
   ["Disputes","A measure you believe is wrong is disputed from here, with the orders in question attached."]]'::jsonb,
 'published', 15, '{"partner"}', '', '{}'),

('KB-P16', 'partner', 'howto', 'Getting support', 2, '04 Aug 2026', 'pt-support', '{}', '{"support"}',
 'Raising a ticket, what to attach, and what happens next.',
 '[["One queue","Seller tickets reach the marketplace desk. There is no separate route for different kinds of problem."],
   ["Attachments","Screenshots and documents can be attached and are visible to whoever picks it up. A ticket with the evidence on it is answered once rather than three times."],
   ["Priority","From the kind of problem, not from how it is worded. Anything stopping you trading is treated as such."],
   ["Tracking","Every reply is on the ticket. You are notified through whichever channels you have turned on."]]'::jsonb,
 'published', 16, '{"partner"}', '', '{}'),

('KB-P17', 'partner', 'howto', 'Refunds and returns', 3, '04 Aug 2026', 'pt-refunds', '{"PR-OPS","PR-FIN"}', '{"money"}',
 'What you are asked to agree to, and how it reaches your settlement.',
 '[["Raised against a line","One line of one order. A buyer returning one item of three does not refund the other two."],
   ["Your say","You see the reason and the evidence and can dispute it. A dispute is decided by the desk, and the decision carries a reason."],
   ["Your money","An agreed refund on a settled line is recovered on the next run and appears on your statement as its own entry rather than as a smaller sale."],
   ["Commission","Recovered proportionally. A refunded sale costs you no commission."]]'::jsonb,
 'published', 17, '{"partner"}', '', '{}'),

('KB-P18', 'partner', 'concept', 'Rewards on your products', 2, '04 Aug 2026', 'pt-rewards', '{"PR-FIN"}', '{"rewards"}',
 'When points are marketplace-funded and when they come out of your margin.',
 '[["Who funds them","Each rule says. Marketplace-funded points cost you nothing; seller-funded ones appear on your settlement as a deduction."],
   ["Your cost","Shown per rule before it applies to your listings, in your own settlement currency."],
   ["Tiers","A buyer''s tier can change the earn rate. The screen shows what each tier costs you rather than an average."],
   ["Refunds","Points earned on a refunded order are taken back, and so is the cost to you."]]'::jsonb,
 'published', 18, '{"partner"}', '', '{}'),

('KB-P19', 'partner', 'howto', 'Your notifications', 2, '04 Aug 2026', 'pt-notifications', '{}', '{"notifications"}',
 'What you are told about, through which channel, and how to change it.',
 '[["What you are told about","Orders, settlement, catalogue decisions, onboarding and tickets. Each can be turned on or off independently."],
   ["Channels","Email, SMS and in-app per kind. Turning all three off for a kind means you will not hear about it, which the screen says plainly."],
   ["Cannot be turned off","Anything that stops you trading — a suspension, a failed settlement — reaches you regardless."],
   ["History","Everything sent to you, with when and through what. That is what settles whether you were told."]]'::jsonb,
 'published', 19, '{"partner"}', '', '{}'),

('KB-P20', 'partner', 'policy', 'Your team', 2, '04 Aug 2026', 'pt-team', '{"PR-OWNER"}', '{"security"}',
 'Who is on your seller account and what each of them may do.',
 '[["Roles","Owner, catalogue, operations and finance. A role grants screens and actions, and the list is shown before you assign one."],
   ["Inviting","An invitation names the role. It expires if unaccepted rather than sitting open indefinitely."],
   ["The last owner","Cannot be removed or demoted. An account nobody owns is one nobody can recover."],
   ["Changes are logged","Every role change is in your audit log with who made it and when."]]'::jsonb,
 'published', 20, '{"partner"}', '', '{}'),

('KB-P21', 'partner', 'concept', 'Your audit log', 2, '04 Aug 2026', 'pt-audit', '{"PR-OWNER"}', '{"security"}',
 'What is recorded about your account, and what it is for.',
 '[["What is recorded","Sign-ins, role changes, listing submissions and decisions, settlement acknowledgements and document uploads."],
   ["Who","The person, not the company. That is the point of the record."],
   ["Not editable","Entries cannot be changed or removed by anybody, including the marketplace desk. A log that can be edited answers nothing."],
   ["Retention","Kept for the published period and exportable while it is."]]'::jsonb,
 'published', 21, '{"partner"}', '', '{}'),

('KB-P22', 'partner', 'howto', 'Reviews of your products', 2, '04 Aug 2026', 'pt-reviews', '{"PR-CAT","PR-OPS"}', '{"reviews"}',
 'Where they come from, what you can do about one, and what you cannot.',
 '[["Who can write one","Somebody who bought the product here. That is checked before it is written, not after."],
   ["Replying","You can reply once a review is published. Your reply is public and carries your seller name."],
   ["You cannot remove one","A review you disagree with is reported to the desk with a reason. The decision is theirs and it carries a reason back."],
   ["Held reviews","A review being screened is visible to you but not to buyers. Nothing is hidden from you that is said about you."]]'::jsonb,
 'published', 22, '{"partner"}', '', '{}'),

('KB-P23', 'partner', 'howto', 'Your seller details', 2, '04 Aug 2026', 'pt-profile', '{"PR-OWNER","PR-FIN"}', '{"account"}',
 'Company details, bank details, contacts and documents.',
 '[["Company details","Legal name, registration and addresses. These are what appear on your settlement statements, so a change is checked by the desk."],
   ["Bank details","Where settlement is paid. A change pauses the next run until it is verified — that pause is deliberate."],
   ["Contacts","Who is contacted about what. A contact kind with nobody against it is flagged rather than silently unrouted."],
   ["Documents","Everything you have provided, with its state and expiry. An expiring document is chased before it lapses."]]'::jsonb,
 'published', 23, '{"partner"}', '', '{}'),

('KB-P24', 'partner', 'start', 'Using the seller knowledge base', 2, '04 Aug 2026', 'pt-kb', '{}', '{"help"}',
 'What is written for sellers and how to ask for what is not.',
 '[["Written for sellers","You see the articles published to sellers. Shoppers and business buyers have their own, which is why an answer here may differ from one they were given."],
   ["Contextual help","The question mark in the header opens the article for the screen you are on, when there is one."],
   ["Feedback","Yes or no and a reason on every article. It reaches whoever owns the words and is never published."],
   ["If it is not here","Raise a ticket from Support. It reaches the same desk."]]'::jsonb,
 'published', 24, '{"partner"}', '', '{}'),

/* ----------------------------------------------------------- enterprise -- */

('KB-B07', 'enterprise', 'howto', 'Buying from the business catalogue', 3, '04 Aug 2026', 'en-browse', '{"BY-BUY","BY-ADMIN"}', '{"ordering"}',
 'Adding to a requisition, what the basket will and will not mix, and what raising it does.',
 '[["Adding","Add collects lines into one requisition. The count in the header is what is in it, and it follows you between the marketplace screens."],
   ["One currency","A requisition is settled in one currency. Changing the currency picker re-prices what you have collected at the new market''s own prices rather than converting them."],
   ["One kind of commitment","A one-off purchase and a monthly subscription are approved differently, so they cannot share a requisition. Raise them separately."],
   ["Raising is not ordering","Raising writes a requisition. Confirming it on Approvals is what places the order — including when it is within policy and nobody else has to sign."]]'::jsonb,
 'published', 7, '{"enterprise"}', '', '{}'),

('KB-B08', 'enterprise', 'concept', 'The IoT marketplace', 2, '04 Aug 2026', 'en-iot', '{"BY-BUY"}', '{"catalogue"}',
 'Connectivity, sensors and gateways, and what you already hold.',
 '[["What is here","SIM plans, sensors, trackers, gateways and the bundles that combine them, from the sellers approved for business accounts."],
   ["What you already hold","Your live subscriptions in this vertical are listed first, so a duplicate order is obvious before it is raised."],
   ["Pooled plans","A pooled allowance is shared across the estate rather than per device. The overage rate is a price and is set per market."],
   ["Approval","The same threshold as everywhere else on the account. IoT is not a special case unless your policy makes it one."]]'::jsonb,
 'published', 8, '{"enterprise"}', '', '{}'),

('KB-B09', 'enterprise', 'policy', 'The security marketplace', 2, '04 Aug 2026', 'en-security', '{"BY-BUY","BY-ADMIN"}', '{"catalogue","approvals"}',
 'Why security purchases are treated differently from everything else.',
 '[["IT sign-off","If your policy has it on, anything from this marketplace needs IT sign-off whatever it costs — the value threshold is a separate, additional test."],
   ["It applies to the whole requisition","One security item in a mixed requisition makes the whole thing a security purchase. That is deliberate: the sign-off is about what is being bought, not how much of it."],
   ["Your own policy","This is your account''s rule, not a marketplace one. It is set on the approval policy and can be turned off."],
   ["Who signs","Whoever on your account holds IT sign-off. Finance approval is not a substitute for it."]]'::jsonb,
 'published', 9, '{"enterprise"}', '', '{}'),

('KB-B10', 'enterprise', 'concept', 'The device marketplace', 2, '04 Aug 2026', 'en-devices', '{"BY-BUY"}', '{"catalogue"}',
 'Handsets, routers and accessories for the estate.',
 '[["What is here","Phones, tablets, routers, fixed wireless and accessories approved for business purchase."],
   ["Priced for your market","Contract pricing where your account has it, in the currency you are invoiced in."],
   ["Quantity","Fleet quantities are normal here. The requisition carries the number, and the approver sees the line total rather than only the unit price."],
   ["Delivery","To the addresses on your account. A new site is added on your account details before it can be ordered to."]]'::jsonb,
 'published', 10, '{"enterprise"}', '', '{}'),

('KB-B11', 'enterprise', 'concept', 'Your subscriptions', 3, '04 Aug 2026', 'en-subs', '{"BY-ADMIN","BY-FIN"}', '{"subscriptions"}',
 'What is running, what it costs a month, and what renews when.',
 '[["What is listed","Every live and suspended subscription on the account, with the seller, the licensed quantity and the monthly cost."],
   ["Seats","Licensed against assigned. Idle seats are shown because they are the commonest thing to be paying for and not using."],
   ["Renewals","The date each renews. A renewal inside the policy''s auto-approve window can go through without a fresh requisition if your policy allows it."],
   ["Suspended","A suspended subscription is not assignable and is still billed unless it was cancelled. The screen distinguishes the two."]]'::jsonb,
 'published', 11, '{"enterprise"}', '', '{}'),

('KB-B12', 'enterprise', 'howto', 'Refunds on the account', 3, '04 Aug 2026', 'en-refunds', '{"BY-FIN","BY-ADMIN"}', '{"money"}',
 'Asking for one, who decides, and where the money lands.',
 '[["Raised against a line","One line of one order, with a reason and any evidence. The rest of the order is untouched."],
   ["Who decides","The marketplace desk, with the seller''s response on the record. You see both."],
   ["Where it goes","To the account wallet or back against the invoice, depending on whether that invoice has settled. The screen says which before you ask."],
   ["Timing","Against the published target. A refund past it is marked, and it stays marked once resolved."]]'::jsonb,
 'published', 12, '{"enterprise"}', '', '{}'),

('KB-B13', 'enterprise', 'concept', 'Billing and invoices', 4, '04 Aug 2026', 'en-billing', '{"BY-FIN"}', '{"billing"}',
 'What an invoice covers, the currency it is in, and what a purchase order changes.',
 '[["What is on one","The lines settled in that period, with the order and requisition each came from. An invoice is reconcilable to the requisition that authorised it."],
   ["Currency","The invoice carries its own currency and the rate frozen when it was raised. It does not move if rates do."],
   ["Purchase orders","If your account requires one, no requisition can be raised without it and it appears on the invoice. That is why the requisition panel asks."],
   ["Terms","Your agreed terms, shown on the invoice. An overdue invoice enters the dunning ladder for business accounts, which is slower than the consumer one and still finite."]]'::jsonb,
 'published', 13, '{"enterprise"}', '', '{}'),

('KB-B14', 'enterprise', 'concept', 'The account wallet', 2, '04 Aug 2026', 'en-wallet', '{"BY-FIN"}', '{"money"}',
 'Money the marketplace holds for you, and what moves it.',
 '[["What it holds","A balance in one named currency. An account trading in two currencies has a wallet for each rather than one converted figure."],
   ["What goes in","Refunds and top-ups. Each is a movement with a reference to what caused it."],
   ["What comes out","Applied against invoices or orders. The balance is the sum of its movements — it is never simply set."],
   ["Who can move it","Finance roles on your account. The audit log records every movement with a name against it."]]'::jsonb,
 'published', 14, '{"enterprise"}', '', '{}'),

('KB-B15', 'enterprise', 'concept', 'Business rewards', 2, '04 Aug 2026', 'en-rewards', '{"BY-FIN","BY-ADMIN"}', '{"rewards"}',
 'How an account earns, and who the points belong to.',
 '[["The account earns, not the buyer","Points accrue to the company. An individual raising a requisition does not accumulate a personal balance from company spend."],
   ["Earn rates","Set for business accounts and by tier, against published thresholds in a named currency."],
   ["Spending","Applied against an invoice. The value is fixed and shown before it is used."],
   ["Refunds","Points from a refunded order are taken back with it."]]'::jsonb,
 'published', 15, '{"enterprise"}', '', '{}'),

('KB-B16', 'enterprise', 'howto', 'Getting support', 2, '04 Aug 2026', 'en-support', '{}', '{"support"}',
 'Raising a ticket for the account and what happens to it.',
 '[["One queue","Business tickets reach the marketplace desk with your account named, whichever seller the order was with."],
   ["Attachments","Screenshots, delivery notes and invoices can be attached and are visible to whoever picks it up."],
   ["Priority","From the kind of problem. Anything stopping the account trading is treated as such."],
   ["Who can see it","Colleagues on your account with a support or admin role, so a ticket does not disappear when the person who raised it is away."]]'::jsonb,
 'published', 16, '{"enterprise"}', '', '{}'),

('KB-B17', 'enterprise', 'howto', 'Notifications for the account', 2, '04 Aug 2026', 'en-notifications', '{"BY-ADMIN"}', '{"notifications"}',
 'Who is told what, and how to change it without silencing something important.',
 '[["By role","Approval requests go to approvers, invoices to finance, delivery updates to whoever raised the requisition. Routing follows the role, so it survives somebody leaving."],
   ["Channels","Email, SMS and in-app per kind. Turning all three off for a kind means nobody hears about it, and the screen says so."],
   ["Cannot be turned off","Approval requests waiting on you, and anything that stops the account trading."],
   ["History","Everything sent, to whom and through what. That is what answers whether an approver was told."]]'::jsonb,
 'published', 17, '{"enterprise"}', '', '{}'),

('KB-B18', 'enterprise', 'policy', 'Team and roles', 3, '04 Aug 2026', 'en-team', '{"BY-ADMIN"}', '{"security","approvals"}',
 'Who may raise, who may approve, and why those are separate.',
 '[["Raising and approving are different","A role can raise without approving, approve without raising, or neither. Viewer does neither and is a real role."],
   ["Approval limits","An approver can carry a value ceiling, set in the account''s own currency. Above it, it goes to somebody who can."],
   ["Separation of duties","You cannot approve a requisition you raised, unless your policy allows self-approval. Confirming your own within-policy purchase is placing an order rather than signing one off, and that is always allowed."],
   ["The last administrator","Cannot be removed. An account nobody administers is one nobody can fix."]]'::jsonb,
 'published', 18, '{"enterprise"}', '', '{}'),

('KB-B19', 'enterprise', 'concept', 'Your audit log', 2, '04 Aug 2026', 'en-audit', '{"BY-ADMIN","BY-FIN"}', '{"security"}',
 'What is recorded about the account and what it answers.',
 '[["What is recorded","Requisitions raised and decided, policy changes, role changes, wallet movements and sign-ins."],
   ["Who","The person, with the role they held at the time. A role that changed later does not rewrite what they could do then."],
   ["Not editable","No one can alter or remove an entry, including the marketplace desk."],
   ["What it is for","Answering who approved what, on what figure, under which policy. Each entry carries the policy note that applied on the day."]]'::jsonb,
 'published', 19, '{"enterprise"}', '', '{}'),

('KB-B20', 'enterprise', 'start', 'Using the business knowledge base', 2, '04 Aug 2026', 'en-kb', '{}', '{"help"}',
 'What is written for business accounts and how to ask for what is not.',
 '[["Written for business buyers","You see the articles published to business accounts. Shoppers and sellers have their own set."],
   ["Contextual help","The question mark in the header opens the article for the screen you are on."],
   ["Feedback","Yes or no and a reason on every article. It goes to whoever owns the words and is never published."],
   ["If it is not here","Raise a ticket from Support. It reaches the same desk."]]'::jsonb,
 'published', 20, '{"enterprise"}', '', '{}')

on conflict (id) do nothing;

/* --------------------------------------------------------- what is true -- */

do $$
declare
  v_missing text;
  n int;
  /* Every screen the app can be on, taken from `src/types/view.ts`. Written out
     because the database cannot read the TypeScript — which is exactly why the
     coverage drifted in the first place, and why the integration test asserts
     this list against the union types rather than trusting it. */
  v_screens text[][] := array[
    ['consumer','home'],['consumer','category'],['consumer','product'],['consumer','checkout'],
    ['consumer','orders'],['consumer','subscriptions'],['consumer','rewards'],['consumer','account'],
    ['consumer','kb'],
    ['operator','op-dashboard'],['operator','op-onboarding'],['operator','op-partners'],
    ['operator','op-catalogue'],['operator','op-settlement'],['operator','op-inventory'],
    ['operator','op-tickets'],['operator','op-dunning'],['operator','op-developer'],
    ['operator','op-promotions'],['operator','op-banners'],['operator','op-channels'],
    ['operator','op-notifications'],['operator','op-roles'],['operator','op-audit'],
    ['operator','op-reviews'],['operator','op-feedback'],['operator','op-wallets'],
    ['operator','op-refunds'],['operator','op-rewards'],['operator','op-ledger'],
    ['operator','op-revshare'],['operator','op-billtemplates'],['operator','op-markets'],
    ['operator','op-profile'],['operator','op-kb'],
    ['partner','pt-dashboard'],['partner','pt-onboarding'],['partner','pt-listings'],
    ['partner','pt-newlisting'],['partner','pt-orders'],['partner','pt-settlement'],
    ['partner','pt-plan'],['partner','pt-performance'],['partner','pt-integrations'],
    ['partner','pt-support'],['partner','pt-refunds'],['partner','pt-rewards'],
    ['partner','pt-notifications'],['partner','pt-team'],['partner','pt-audit'],
    ['partner','pt-reviews'],['partner','pt-profile'],['partner','pt-kb'],
    ['enterprise','en-dashboard'],['enterprise','en-browse'],['enterprise','en-iot'],
    ['enterprise','en-security'],['enterprise','en-devices'],['enterprise','en-approvals'],
    ['enterprise','en-orders'],['enterprise','en-subs'],['enterprise','en-refunds'],
    ['enterprise','en-billing'],['enterprise','en-wallet'],['enterprise','en-rewards'],
    ['enterprise','en-support'],['enterprise','en-notifications'],['enterprise','en-team'],
    ['enterprise','en-audit'],['enterprise','en-profile'],['enterprise','en-kb']
  ];
  i int;
begin
  /* Ranged over the screens rather than counted, so the failure names the one
     that is missing instead of saying the total is wrong. */
  for i in 1 .. array_length(v_screens, 1) loop
    select count(*) into n from kb_articles
    where persona = v_screens[i][1] and view = v_screens[i][2] and status = 'published';
    if n = 0 then
      v_missing := coalesce(v_missing || ', ', '') || v_screens[i][1] || '/' || v_screens[i][2];
    end if;
  end loop;

  if v_missing is not null then
    raise exception 'these screens still have no help article: %', v_missing;
  end if;

  /* And the list itself is not empty, because a loop over nothing reports
     nothing missing. */
  if array_length(v_screens, 1) < 60 then
    raise exception 'the screen list has only % entries, so this checked almost nothing', array_length(v_screens, 1);
  end if;

  /* No article points at a screen that does not exist. A typo in `view` is a
     help button that stays broken while the coverage check passes. */
  select count(*) into n from kb_articles a
  where a.view is not null
    and not exists (
      select 1 from generate_subscripts(v_screens, 1) s
      where v_screens[s][1] = a.persona and v_screens[s][2] = a.view
    );
  if n > 0 then
    raise exception '% articles name a screen that does not exist', n;
  end if;

  /* Every new article has something in it. An empty body renders a dialog as
     unhelpful as the one this replaces. */
  select count(*) into n from kb_articles
  where status = 'published' and (body is null or jsonb_array_length(body) < 3);
  if n > 0 then
    raise exception '% published articles have fewer than three sections', n;
  end if;

  select count(*) into n from kb_articles where status = 'published' and coalesce(summary, '') = '';
  if n > 0 then
    raise exception '% published articles have no summary', n;
  end if;
end $$;
