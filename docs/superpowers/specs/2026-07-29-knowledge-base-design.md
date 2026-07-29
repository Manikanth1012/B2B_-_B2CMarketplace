# Knowledge base — "How things work" — design

**Date:** 29 Jul 2026
**Branch:** `Claude`
**Status:** awaiting review

Sub-project 2 of the marketplace port. Brings the prototype's help centre into all four React
consoles.

---

## 1. Why

The prototype has a help centre in every persona. The React app has none — zero matches in `src/`
for knowledge base, help centre or articles.

| | Consumer | Partner | Operator | Enterprise |
|---|---|---|---|---|
| Nav label | **How things work** | Knowledge base | Knowledge base | Knowledge base |
| Articles | 6 | 11 | 10 | 6 (key `buyer`) |
| Walkthroughs | 2 | 2 | 3 | 2 |

33 articles, 9 walkthroughs. Source: `_src/mp_data.js` — `KB_ARTICLES` (line 4086), `KB_TOURS`
(4007), `KB_KINDS` (3996).

The value is the prose. It explains *why* a rule exists, not which button to press — why the
technical gate cannot be waived, why gross collected is a liability rather than revenue. That is
the part a demo audience asks about and the part nobody can reconstruct from the screens.

---

## 2. Scope: two phases

This contains one genuinely separate subsystem. Phase 1 is a content surface: read a table, render
it, link out. Phase 2 is a **navigation driver** — nine tours that must drive four shells, each
with its own view union (`View`, `OperatorView`, `PartnerView`, `EnterpriseView`), where some stops
open a drawer rather than a screen. In the prototype a basket stop carried `open:'openCart()'`
precisely because `basket` is not a view.

| Phase | Contents |
|---|---|
| **1 (this spec)** | Migration + all 33 articles + 9 tours seeded, list/reader in all four consoles, contextual help, raise-a-ticket, validator |
| **2 (later spec)** | The walkthrough driver that makes the 9 tours navigate |

Phase 1 delivers what was asked — "How things work" present in all four personas — and ships
reviewed rather than waiting behind the hardest part. Tours are **seeded in Phase 1** so the
content is captured once; they are simply not yet playable.

---

## 3. Storage

Supabase, per the decision. Two tables.

```sql
kb_articles (
  id text PK, persona text, kind text, title text, mins int, updated text,
  view text,            -- React view id, or NULL (see §7)
  roles text[], tags text[], summary text,
  body jsonb,           -- [[heading, prose], ...] exactly as the prototype holds it
  status text NOT NULL DEFAULT 'published',   -- 'published' | 'held'
  sort_order int
)

kb_tours (
  id text PK, persona text, title text, mins int,
  stops jsonb,          -- [{label, view, open?}, ...]
  status text NOT NULL DEFAULT 'held',        -- all tours start held until Phase 2
  sort_order int
)
```

`body` stays `jsonb` rather than becoming a paragraphs table: the shape is an ordered list of
`[heading, prose]` pairs, it is never queried piecewise, and a table would add a join for nothing.

`persona` uses the app's own vocabulary — `consumer` / `partner` / `operator` / `enterprise`. The
prototype's fourth key is `buyer`; the extractor maps it.

RLS follows this project's convention: `anon` SELECT/INSERT/UPDATE/DELETE with `USING (true)`.
Recorded as a project-wide risk already; not changed here.

### The seed is generated, not typed

33 articles of prose transcribed by hand is where errors hide. A build-time extractor
(`_src/extract-kb.cjs`) reads `_src/mp_data.js` and emits the migration's INSERT statements. The
prose is copied, never retyped. The extractor is committed so the port is reproducible and
reviewable.

---

## 4. Data access

`src/lib/kbRepo.ts` — the only module touching Supabase for the knowledge base, matching how
`onboardingRepo.ts` owns onboarding.

```ts
loadArticles(persona: Persona): Promise<KbArticle[]>   // published only
loadTours(persona: Persona): Promise<KbTour[]>         // published only — returns [] in Phase 1,
                                                       // since every tour is seeded 'held'.
                                                       // Written now so Phase 2 flips status, not code.
articleForView(persona: Persona, view: string): Promise<KbArticle | null>
raiseContentFeedback(args: {
  article: KbArticle; persona: Persona; actor: string; org: string; note: string
}): Promise<{ ok: true; ticketId: string } | { ok: false; reason: string }>
```

Reads check `.error` and surface a load failure distinctly from an empty result — the lesson from
`loadOnboarding`, where a failed read rendered as "nothing outstanding".

---

## 5. UI

One `src/components/KnowledgeBase.tsx` rendered by all four consoles. Persona changes the nav
label and the article set, nothing else:

- **Consumer:** "How things work"
- **Partner / Operator / Enterprise:** "Knowledge base"

That split is the prototype's and is deliberate — a retail customer asks how things work; an
operator opens a knowledge base.

The screen is a list with filter-by-kind, filter-by-tag and search, plus a reader that renders
`body` as headed sections with the read time and last-reviewed date shown. `KB_KINDS` (5 kinds)
ports as a constant, not a table — it is a fixed vocabulary.

New view ids: `kb` (consumer), `op-kb`, `pt-kb`, `en-kb`. Added to the four unions in
`src/types/view.ts` and to each shell's nav.

---

## 6. Contextual help

A `?` control in each shell's top bar opens the article whose `view` matches the current screen.

When the current screen has no article, it **says so and opens the catalogue** rather than doing
nothing. That was the prototype's rule and it is the right one: a control that silently no-ops
teaches people the feature is broken.

---

## 7. Articles whose screen does not exist

Measured against the React app: of 33 articles, **18 bind to an existing React view**, 7 need a
mapping written, and **8 describe capabilities the React app does not have** — partner branding,
refunds, credit notes and collections; operator listing rules, number management and bulk update;
buyer contracts.

Those 8 are seeded with `status='held'`. The prose is preserved, nothing in the UI shows them, and
switching one on when its screen lands is a one-row update.

The 7 needing a mapping are resolved during implementation by completing `PROTO_VIEW_MAP`. Any that
turn out to have no React counterpart join the held set. So the published count is **18 + however
many of the 7 resolve**, and held is **8 + the remainder** — the two always sum to 33. The
implementation reports the final split rather than assuming it.

The reasoning: a help centre that documents screens a person cannot find undermines confidence in
the articles that are correct. Holding them costs nothing and loses nothing.

A `PROTO_VIEW_MAP` in the extractor maps prototype view ids to React ones
(`onboardq` → `op-onboarding`, `settlements` → `op-settlement`, and so on). Where a prototype view
has no React counterpart the article is emitted `held` with `view = NULL`.

---

## 8. Raise a ticket — "Content feedback"

Every published article carries a control that raises a ticket about the article itself.

**All of them write to `operator_tickets`**, whoever raises it, with `org` set to the raiser's
organisation and `subject` pre-filled from the article title. The **operator gets no control** —
they are the queue; they would be raising a ticket with themselves.

Category is **`Content feedback`**, distinct from the six service categories already in that table
(Access, Billing, Catalogue, Finance, Logistics, Provisioning).

Service tickets and content feedback are different work: a different owner (whoever maintains the
content, not provisioning or finance), a different urgency, and a different resolution — you fix
the article, not the customer's account. Keeping them apart also stops documentation feedback
inflating the operator's service-volume and SLA-breach figures.

### The operator's screen has to honour the split

The category on the row is not enough on its own. `OperatorTickets.tsx:25` filters by **status
only**, and the headline counts at `:101` — open, breached, escalated — count every row regardless
of category. Landing content feedback in that table without changing the screen would inflate
exactly the numbers this separation exists to protect.

So Phase 1 also gives that screen a category-aware split:

- the headline counts cover **service tickets only**
- a separate tab or filter shows **Content feedback**, with its own count
- the existing status filter continues to work inside whichever set is selected

This is a small change to one file, and without it the rationale above is unmet.

### Why not the raiser's own ticket table

`consumer_tickets` and `operator_tickets` are **disconnected sets**, verified against the live
database:

| Table | Sample |
|---|---|
| `operator_tickets` | `tk-001` "SIM activation failed…", `org: Consumer` |
| `consumer_tickets` | `TCK-59120` "Delivery attempt failed…" |

No overlap. Priya's support tab shows four tickets the operator cannot see; the operator's queue
holds two `Consumer` tickets Priya cannot see. Same defect class as the duplicated `ORD-880519`.

So writing a consumer's content feedback to `consumer_tickets` would mean the operator never sees
it — contradicting the requirement that it land on the operator console.

**The raiser does not get a tracking list.** Raising shows a confirmation carrying the ticket id.
This is a feedback signal, not a support case the raiser needs to follow. Repairing the ticket-table
split is real work and belongs in its own sub-project, not inside a help-centre phase.

---

## 9. Role scoping

Anyone may **read** any article. Where an article's `roles[]` excludes the reader, it states which
role can perform the action. Reading is never gated.

This is the prototype's explicit choice: role-scoped for action, not for reading. Someone trying to
understand why they cannot do something is exactly the person who needs the article.

---

## 10. Testing

Vitest, extending the existing suite.

**Unit — pure functions, no database.** Filtering by kind and tag, search matching, the
prototype→React view mapping, and `kbKind` fallback for an unknown kind.

**The validator.** A test that fails the build if any `published` article has a `view` that is not
a real view id for its persona, or if any tour stop points at a view that does not exist. The
equivalent check caught two faults on the prototype's first run.

**Integration — one test.** Seeds a throwaway article, raises content feedback from it, asserts a
row lands in `operator_tickets` with category `Content feedback` and the right `org`, then tears
down. It owns only rows it creates.

**Acceptance:** "How things work" opens in the consumer console and "Knowledge base" in the other
three; every published article's contextual-help binding resolves; a seller raising content
feedback produces a `Content feedback` row in the operator's queue that a service-ticket filter
excludes.

---

## 11. Out of scope

- **The walkthrough driver** — Phase 2.
- **Repairing the ticket-table split** (`consumer_tickets` vs `operator_tickets`) — real, recorded
  in §8, its own sub-project.
- **Migrating the partner's "Disputes & Support" screen**, which reads the static
  `PARTNER_DISPUTES` array. A seller's content feedback reaches the operator but will not appear on
  the seller's own support screen. Same class as the half-migrated partner console already recorded
  in `CONTEXT.md`.
- **An operator authoring UI** for articles. Storage is a table, so it is possible later; nothing
  asks for it now, and a help article editable without review is a support risk.
- **Article ratings.** The prototype counted them; not requested here.
