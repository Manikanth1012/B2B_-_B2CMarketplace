# Spec 20: global bill sections, and adverts on bills

The user raised this on 2026-11-28, with a screenshot of Finance › Bill Templates:

> "I cannot see page to configure the mandatory/optional sections of the template at global level. Also do not see
> the place for banner/advertisement."

The user asked Claude to take the decisions; the decisions taken are recorded below.

## Today

- The section catalogue is global (`invoice_sections`, 16 rows: id, label, note, `locked`, `audiences[]`, sort order).
  It was seeded in `20260801800000_bill_templates.sql` and has no screen: only migrations change it.
- Four sections are `locked`, meaning mandatory on every template: masthead, parties, tax and summary.
  `validateTemplate` and the database refuse a template without them.
- `advert` ("one relevant offer, drawn from the storefront banners; never on a dunning or final notice") is consumer
  only. Nothing chooses which banner a bill carries, for which market or audience, or for how long.

## Decisions

### 1. A "Sections" tab on Bill Templates (global section rules)

- A table of every section, with these columns:
  - section (label and note);
  - **Rule**: Required by law / Mandatory / Optional;
  - **Offered to** (consumer, enterprise, seller);
  - templates using it;
  - order.

  Row action: Edit, which opens a drawer.
- **Three levels of rule.** `locked` becomes `rule`:
  - `statutory`: masthead, parties, tax, summary. Shown as "Required by law" and never editable; a tax document
    without them is not a bill.
  - `mandatory`: the operator requires it on every template offered that audience.
  - `optional`.

  The operator can move a non-statutory section between mandatory and optional, and can change its label, its note
  and the audiences it is offered to. The section *kinds* stay fixed, because each one has rendering code behind it.
  New kinds are code, not configuration, and the screen says so.
- **Making a section mandatory when some templates lack it.** The save shows the list of those templates and offers
  "Add to the N templates" in the same action. It never leaves a template invalid silently. If a template must not
  take the section (for example an advert on an enterprise template), the audience rule wins: mandatory applies
  only to templates whose audience the section is offered to.
- **Removing an audience** from a section that templates of that audience use is refused, with the template names.
- Every change is audited (`operator_audit_log`). Only the operator can write.
- Order is a drag handle plus Up/Down buttons, so it works from the keyboard, and it sets the default order for new
  templates. Existing templates keep their own order.

### 2. Adverts on bills (a "Bill adverts" tab)

- **Data.** A `bill_adverts` table with one row per placement:
  - `banner_id`, pointing to `operator_banners`, so the picture, alt text, headline and link are the storefront
    banner's own and nothing is duplicated;
  - `market` (or all);
  - `audience` (consumer only by default; enterprise is allowed with the existing warning, seller never);
  - `starts_on` / `ends_on`;
  - `priority`;
  - `enabled`;
  - created and edited by and on.
- **Which advert a bill carries.** The `advert` section prints the highest-priority enabled placement live on the
  bill's date for its market and audience, or nothing if there is none.
  - It is **never** printed on a dunning notice, a final notice or a bill with an overdue balance. This rule is
    enforced in the function that picks the advert, not left to the template.
  - A retired or paused banner drops out by itself.
- **The screen.** A table of placements (banner thumbnail, market, audience, dates, priority, state) with Add,
  Edit and Pause; pausing replaces delete, and every action is audited. A preview shows "a bill dated D for market M
  would carry …". The template preview on the Templates tab shows the advert that would actually print.

## Not changing

- Templates, assignments, references, issuers and statutory clearance.
- The four statutory sections.
- Every existing template keeps the sections it has. The migration maps `locked = true` to `statutory` and every
  other section to `optional`, which is exactly today's behaviour.

## Tests

- **Migration self-check:**
  - the mapping, with no template changed;
  - a statutory section cannot be made optional (dry run);
  - mandatory together with "add to templates";
  - the advert pick: date window, market, priority, never on dunning.
- **Unit tests:** the rules, and the advert pick as a pure function.
- **DOM tests:** the Sections tab edit drawer, and the Bill adverts add and pause actions.

## Order

On its own branch, `bill-sections-adverts`, right after spec 19 (its screens) and before the follow-ups for specs
13, 14 and 17. The migration goes to the user to apply.
