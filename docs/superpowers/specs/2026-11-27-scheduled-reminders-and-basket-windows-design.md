# Spec 19: scheduled reminders (n−x / n+x) and configurable basket windows

The user asked for this on 2026-11-27, with a screenshot of the operator Baskets screen:

> "Basket validity/clearing should be configurable instead of hard coded days. Also reminder/notification rules should
> be available as n-1, n-2 type of configurations on the channels/message notifications are sent."

They chose **general, baskets first**: scheduled offsets belong to notification rules. Any dated event can use them,
and baskets are the first to.

## Today

- **Basket windows are hard-coded** in `20261113200000_a_basket_is_kept_and_watched.sql`, in the screen text and in the
  help text:
  - pending: changed in the last 7 days;
  - abandoned: untouched for 7 days or more;
  - cleared: untouched for 90 days, by the nightly `baskets` job.
- **Reminders are manual.** The operator presses "Remind" (`remind_basket_owner`). It is in-app only and allowed at
  most once a day. The time is recorded in `cart_reminders` / `requisition_baskets.reminded_at`.
- **Notifications fire on events, not on dates.** The tables are:
  - `notification_kinds`: the channels (email, SMS, WhatsApp, in-app and so on);
  - `notification_events`;
  - `notification_rules`: event → channels, audience, throttle, mandatory;
  - `notification_templates`: one per rule × channel;
  - `notification_log`.

## Design

### 1. Basket windows are settings

- **Table.** A `basket_settings` row per market, plus a default row:
  - `pending_days` (default 7);
  - `abandoned_after_days` (default 7);
  - `clear_after_days` (default 90).
- **Constraints:**
  - `abandoned_after_days >= pending_days`;
  - `clear_after_days > abandoned_after_days`;
  - each value is between 1 and 365.
- **Writes:** the operator only, and every change is audited.
- **Readers:** the nightly baskets job, the Baskets screen states, the screen description and the help text all read
  these settings. A shopper's basket takes its market's row, and a business basket takes its account's home market
  row.
- **Screen:** "Basket rules" settings (a drawer from the Baskets page header, in the Channels pattern). Saving shows
  what changes, for example "12 baskets become abandoned, 3 would be cleared tonight".

### 2. Scheduled notification rules (offsets against a dated event)

- **Dated events.** `notification_events` gains `anchor` (nullable). An event that has an anchor is a dated event,
  meaning a date the nightly run can compute per subject. The first set:

  | Event | Anchor date | Audience |
  |---|---|---|
  | `basket.abandoned` | last change + abandoned_after_days | shopper / business basket owner |
  | `basket.clearing` | the night the basket is cleared: day of last change + clear_after_days + 1 (matches the nightly cut, so "clears tomorrow" at n−1 is true) | shopper / business basket owner |
  | `invoice.due` | invoice due date | business buyer (finance) |
  | `subscription.renewal` | next renewal date | consumer / business |
  | `agreement.notice` | agreement notice deadline | business buyer, seller |
  | `quote.expiry` | quote valid-until | business buyer |

- **Steps.** A rule on a dated event has **steps** in `notification_rule_steps`:
  - `offset_days`: −30…+30, where n−1 is one day before, n+0 is the day and n+2 is two days after;
  - `kinds`: a subset of the rule's channels;
  - `template_id` per channel, written per step, for example "Your basket clears tomorrow";
  - `enabled`.

  Rules on ordinary (non-dated) events keep working exactly as now.
- **Sending.** A new nightly job, `reminders` (the eleventh), does the following for each enabled step:
  - finds the subjects whose anchor + offset is **today** (UTC);
  - skips any subject already sent for this step and anchor date (`notification_schedule_log`, unique per subject,
    step and anchor date, so a re-run never sends twice);
  - respects the rule's throttle, mandatory flag and the recipient's channel preferences;
  - writes `notification_log` rows the same way the event path does. Real delivery still waits for the provider the
    user has not chosen; until then the rows are logged and in-app messages show.
- **Placeholders.** Templates can use `{anchor_date}` and `{days_left}` as well as the event's own fields. This ties
  in with the planned placeholder catalogue.
- **Seed data.** Default steps for baskets:
  - `basket.abandoned` n+0: in-app;
  - `basket.clearing` n−7: email;
  - `basket.clearing` n−1: email + WhatsApp.

  These are all **disabled** until the operator turns them on. Nothing starts sending by itself.

### 3. Operator screens

- **Notifications › Rules.** A rule on a dated event shows a "Schedule" section with a table of steps:
  - offset, shown as "7 days before" / "on the day" / "2 days after", with the n−7 form beside it;
  - channels;
  - template;
  - on/off;
  - row actions: edit, duplicate, remove.

  A step whose template is missing for a chosen channel is flagged, and the rule cannot be enabled until it is fixed.
- **Baskets page:**
  - the header description reads the settings, for example "Pending: changed in the last 7 days…";
  - "Last reminder" shows the latest sent step, manual or scheduled;
  - the manual "Remind" stays.
- **Scheduled jobs.** The new job shows there with its counts (sent, skipped as already sent, skipped by preference).

## Decisions taken during review (2026-11-28)

- **Job order.** `reminders` runs **first** in the nightly run, before the agreement, subscription and basket jobs
  move or remove the dates it reads. The other ten jobs keep their relative order.
- **Offsets after the date** (n+x, x > 0) are refused for `subscription.renewal`, `agreement.notice` and
  `basket.clearing`, because once the date passes the subject renews, is superseded or is cleared. n+0 stays
  allowed.
- **Throttle** is applied per rule, recipient and subject, counted in days. A message suppressed for lack of a
  gateway does not count toward it. A throttled reminder is retried and never lost.
- **Seeds are four rules**, not one per event, because a rule has one persona: shopper and business, abandoned and
  clearing. All of them are off.
- **`pending_days` is display only.** It sets the Pending/Abandoned labels; the nightly clearing uses
  `clear_after_days`.

## What does not change

- The manual Remind action and its once-a-day limit.
- Event-driven rules.
- Every default value. The seeded settings equal today's 7 / 7 / 90, so nothing moves until the operator changes a
  number.

## Tests

- **Unit tests:**
  - offset maths, including "n−1 from a clearing date";
  - settings validation;
  - step labels.
- **Migration tests:**
  - structure;
  - the nightly job is in `run_nightly`;
  - the job is idempotent through the unique log.
- **Live integration test:** a dry run in a rolled-back block shows that a basket at n−1 gets exactly one log row,
  and a second run gets none.
- **DOM tests:**
  - the settings drawer;
  - the rule schedule editor.

## Order

This comes after the bundle per-line prices and the spec 18 group 1 work now in flight, on its own branch
(`scheduled-reminders`). It merges only once reviewed clean. The migration is handed to the user to apply.
