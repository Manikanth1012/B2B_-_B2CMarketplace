-- Notifications: what the platform says, to whom, where, and what it said.
--
-- There were two half-answers. `operator_channels` described the gateways —
-- Route Mobile, SES, FCM — with throughput and cost, and nothing said which
-- message went down which. `consumer_notifications` held eight toggles for one
-- customer, with the event written as free text and no template behind it. A
-- seller and an enterprise buyer had nothing at all, and nobody could see what
-- had actually been sent.
--
-- Five things, kept apart on purpose:
--
--   kinds      the shape of a message. An SMS that reads like an email is a
--              wasted segment, so the limit lives on the kind.
--   events     the things that can happen. One catalogue, shared by every
--              persona, so "an order failed" means the same thing everywhere.
--   rules      persona + event -> who hears about it, on which kinds, how
--              often. The operator's to configure.
--   templates  what is actually said, per rule per kind.
--   preferences  the recipient's own choice, which is the only thing they can
--              change. A mandatory rule can be moved between channels but not
--              turned off — silence on a failed payment is not a preference.
--
-- And a log, because a notification nobody can prove was sent is a notification
-- the recipient is entitled to say never arrived.

/* ================================================================= kinds === */

create table if not exists notification_kinds (
  id            text primary key,
  label         text not null,
  /* Null means no practical limit. Everywhere else it is the reason the same
     message has to be written twice. */
  max_chars     integer,
  /* What the platform needs to hold before it can use this at all. */
  needs         text not null check (needs in ('email', 'phone', 'device', 'none')),
  note          text not null,
  sort_order    integer not null default 0
);

insert into notification_kinds (id, label, max_chars, needs, note, sort_order) values
  ('inapp',    'In-app',   240,  'none',
   'Shown in the console. Free, instant, and only seen by somebody who is already looking.', 1),
  ('email',    'Email',    null, 'email',
   'The only kind that carries a document, a table or a link somebody will still find next week.', 2),
  ('push',     'Push',     120,  'device',
   'Fast and easy to ignore. No true delivery receipt — acceptance by the device is all there is.', 3),
  ('sms',      'SMS',      160,  'phone',
   'Reaches a phone with no app and no signal-free excuse. Costs money per segment, so it is worth rationing.', 4),
  ('whatsapp', 'WhatsApp', 1024, 'phone',
   'Reads like a conversation and is answered like one, which is a commitment as much as a channel.', 5)
on conflict (id) do update set
  label = excluded.label, max_chars = excluded.max_chars,
  needs = excluded.needs, note = excluded.note;

/* Which gateway carries which kind. Without it the channel catalogue is a list
   of vendors nobody can connect to a message. */
alter table operator_channels add column if not exists kind text references notification_kinds(id);

update operator_channels set kind = case
  when name ilike 'SMS%'      then 'sms'
  when name ilike 'Email%'    then 'email'
  when name ilike 'Push%'     then 'push'
  when name ilike 'WhatsApp%' then 'whatsapp'
end where kind is null;

/* ================================================================ events === */

create table if not exists notification_events (
  id          text primary key,
  label       text not null,
  description text not null,
  /* Who this can be told to. One catalogue rather than four, so "an order
     failed" means the same thing on every console. */
  personas    text[] not null,
  category    text not null,
  sort_order  integer not null default 0
);

insert into notification_events (id, label, description, personas, category, sort_order) values
  ('order.placed',     'An order is placed',              'A buyer commits to a purchase.',                          array['operator','partner','enterprise','consumer'], 'Orders', 1),
  ('order.stage',      'An order changes stage',          'Packed, in transit, delivered — each move on the rail.',  array['enterprise','consumer'], 'Orders', 2),
  ('order.failed',     'An order fails to fulfil',        'Fulfilment failed at some stage. It will not settle until it completes.', array['operator','partner','enterprise','consumer'], 'Orders', 3),
  ('order.delivered',  'An order completes',              'Everything on the order is delivered or activated.',      array['partner','enterprise','consumer'], 'Orders', 4),
  ('listing.decided',  'A listing is approved or rejected','The catalogue desk has decided on a submission.',        array['operator','partner'], 'Catalogue', 10),
  ('listing.policyfail','An automated policy check fails','A submitted listing broke a rule before a human saw it.',  array['operator'], 'Catalogue', 11),
  ('partner.gatefail', 'A seller fails an onboarding gate','Due diligence, agreements or the technical gate stopped.', array['operator'], 'Onboarding', 20),
  ('partner.golive',   'A seller goes live',              'A storefront opens to buyers for the first time.',        array['operator','partner'], 'Onboarding', 21),
  ('onboarding.task',  'An onboarding task is assigned',  'A gate opened with something for you to do.',             array['partner'], 'Onboarding', 22),
  ('settlement.ready', 'A settlement run is ready',       'A period closed and statements are waiting for approval.', array['operator'], 'Money', 30),
  ('settlement.paid',  'A payout lands',                  'Money has left the payout account.',                      array['partner'], 'Money', 31),
  ('statement.ready',  'A statement is produced',         'A closed period has been worked out and is readable.',    array['partner'], 'Money', 32),
  ('invoice.issued',   'An invoice or bill is issued',    'A charge has been raised against the account.',           array['enterprise','consumer'], 'Money', 33),
  ('payment.failed',   'A payment fails',                 'A charge was declined. Service may stop if it is not fixed.', array['enterprise','consumer'], 'Money', 34),
  ('refund.decided',   'A refund is decided',             'Somebody agreed, part-agreed or declined a refund request.', array['partner','enterprise','consumer'], 'Money', 35),
  ('dispute.raised',   'A dispute is raised',             'A buyer has claimed against an order.',                   array['operator','partner'], 'Disputes', 40),
  ('dispute.sla',      'A dispute passes its target',     'Nobody answered inside the window and the clock has run out.', array['operator','partner'], 'Disputes', 41),
  ('approval.pending', 'A requisition needs approval',    'Somebody on the account wants to buy above a threshold.', array['enterprise','consumer'], 'Approvals', 50),
  ('approval.decided', 'A requisition is decided',        'Approved or declined, with the reason.',                  array['enterprise','consumer'], 'Approvals', 51),
  ('sub.renewing',     'A subscription is about to renew','Notice before money is taken again.',                     array['enterprise','consumer'], 'Subscriptions', 60),
  ('sub.pricechange',  'A price changes on something held','A seller changed the price of a subscription you hold.', array['enterprise','consumer'], 'Subscriptions', 61),
  ('doc.expiring',     'A compliance document expires',   'Something on file lapses within 60 days.',                array['partner'], 'Compliance', 70),
  ('cap.reached',      'A spend cap is reached',          'A member or cost centre hit its limit.',                  array['enterprise','consumer'], 'Approvals', 71),
  ('digest.weekly',    'The weekly digest',               'Everything that happened, once, on a Monday morning.',    array['operator','partner','enterprise','consumer'], 'Digest', 90)
on conflict (id) do update set
  label = excluded.label, description = excluded.description,
  personas = excluded.personas, category = excluded.category, sort_order = excluded.sort_order;

/* ================================================================= rules === */

create table if not exists notification_rules (
  id         text primary key,
  persona    text not null check (persona in ('operator', 'partner', 'enterprise', 'consumer')),
  event_id   text not null references notification_events(id) on delete cascade,
  name       text not null,
  /* Who at the recipient's organisation hears it. "Everyone" is a decision,
     not a default. */
  audience   text not null,
  kinds      text[] not null,
  throttle   text not null,
  severity   text not null check (severity in ('high', 'normal', 'low')),
  enabled    boolean not null default true,
  /* The recipient may choose where it reaches them but not whether it does.
     Silence on a failed payment or a delivery that is not coming is not a
     preference anybody should be allowed to set. */
  mandatory  boolean not null default false,
  why        text not null,
  last_sent  text,
  sort_order integer not null default 0
);

create index if not exists notification_rules_persona_idx on notification_rules(persona, enabled);

/* A rule has to reach somebody by some means. */
alter table notification_rules drop constraint if exists notification_rules_kinds_check;
alter table notification_rules add constraint notification_rules_kinds_check
  check (array_length(kinds, 1) >= 1);

/* A rule can only be sent to a persona the event applies to. */
create or replace function guard_rule_persona() returns trigger
language plpgsql as $$
begin
  if not exists (select 1 from notification_events e
                  where e.id = new.event_id and new.persona = any(e.personas)) then
    raise exception 'the % event does not apply to the % persona', new.event_id, new.persona;
  end if;
  return new;
end $$;

drop trigger if exists notification_rules_persona_guard on notification_rules;
create trigger notification_rules_persona_guard before insert or update on notification_rules
  for each row execute function guard_rule_persona();

insert into notification_rules (id, persona, event_id, name, audience, kinds, throttle,
                                severity, enabled, mandatory, why, last_sent, sort_order) values
  -- operator
  ('NR-O1', 'operator', 'listing.policyfail', 'Listing breaches policy', 'Catalogue reviewers',
   array['inapp','email'], 'Every time', 'high', true, false,
   'A held listing is a seller waiting and a buyer not buying. It is the cheapest thing on this list to fix quickly.', '18 min ago', 1),
  ('NR-O2', 'operator', 'partner.gatefail', 'A seller fails an onboarding gate', 'Onboarding desk',
   array['inapp','email'], 'Every time', 'high', true, false,
   'A failed gate stops an application dead. Somebody has to tell the seller why, and it will not be automatic.', 'Yesterday', 2),
  ('NR-O3', 'operator', 'dispute.sla', 'Dispute past its target', 'Support and admins',
   array['inapp','email','sms'], 'Every time', 'high', true, true,
   'The clock has already run out on a customer. SMS because it is the one alert nobody may miss by being away from a desk.', '1 h ago', 3),
  ('NR-O4', 'operator', 'settlement.ready', 'Settlement run ready to approve', 'Settlement approvers',
   array['email'], 'Every time', 'normal', true, true,
   'Nothing pays out until somebody approves the run, so a missed alert is every seller paid late.', '3 h ago', 4),
  ('NR-O5', 'operator', 'order.failed', 'An order failed to fulfil', 'Support agents',
   array['inapp'], 'At most once an hour', 'normal', true, false,
   'In-app and throttled: individually minor, and a per-order alert on a bad afternoon is noise nobody reads.', '22 min ago', 5),
  ('NR-O6', 'operator', 'digest.weekly', 'Weekly marketplace digest', 'All operator staff',
   array['email'], 'Digest — weekly', 'low', true, false,
   'The one place the whole week is visible to people who do not open the console daily.', 'Monday', 6),

  -- partner
  ('NR-P1', 'partner', 'order.placed', 'A new order', 'Fulfilment operators',
   array['inapp','email'], 'Every time', 'normal', true, false,
   'The clock on your fulfilment commitment starts at the order, not when you notice it.', '9 min ago', 10),
  ('NR-P2', 'partner', 'order.failed', 'An order failed to fulfil', 'Seller admin and fulfilment',
   array['inapp','email','sms'], 'Every time', 'high', true, true,
   'A failed order does not settle. You cannot be allowed to find that out on the statement.', '2 h ago', 11),
  ('NR-P3', 'partner', 'listing.decided', 'A listing decision', 'Catalogue managers',
   array['inapp','email'], 'Every time', 'normal', true, false,
   'An approval means you can sell; a rejection means you have work. Both need saying.', '3 d ago', 12),
  ('NR-P4', 'partner', 'statement.ready', 'Your statement is ready', 'Finance contacts',
   array['email'], 'Every time', 'normal', true, false,
   'To the finance address rather than the sign-in one, because the person who reads a statement is rarely the person who signs in.', '5 h ago', 13),
  ('NR-P5', 'partner', 'settlement.paid', 'A payout has landed', 'Finance contacts',
   array['email'], 'Every time', 'normal', true, false,
   'Money moving is the one event a seller reconciles against their own bank statement.', '5 d ago', 14),
  ('NR-P6', 'partner', 'dispute.raised', 'A buyer has disputed an order', 'Seller admin',
   array['inapp','email'], 'Every time', 'high', true, true,
   'A dispute you do not answer inside the window is decided without you, so this one cannot be switched off.', '4 d ago', 15),
  ('NR-P7', 'partner', 'doc.expiring', 'A compliance document is expiring', 'Seller admin',
   array['email'], 'At most once a day', 'normal', true, false,
   'A lapsed certificate stops a payout or resumes withholding, weeks after the moment it could have been renewed cheaply.', 'Yesterday', 16),
  ('NR-P8', 'partner', 'refund.decided', 'A refund on your product was decided', 'Seller admin',
   array['inapp'], 'Digest — once a day', 'normal', true, false,
   'Each one is small and the cost lands on the settlement anyway, so a daily digest is enough.', '2 d ago', 17),

  -- enterprise
  ('NR-B1', 'enterprise', 'approval.pending', 'A requisition needs approval', 'Finance and IT approvers',
   array['inapp','email'], 'Every time', 'high', true, false,
   'Somebody is blocked until this is answered, and they can see that they are.', 'Today 08:40', 20),
  ('NR-B2', 'enterprise', 'approval.decided', 'A requisition was decided', 'The requester',
   array['inapp','email'], 'Every time', 'normal', true, false,
   'To the person who raised it, not the approver — they already know.', 'Yesterday', 21),
  ('NR-B3', 'enterprise', 'order.failed', 'An order failed to provision', 'Procurement and IT',
   array['inapp','email'], 'Every time', 'high', true, true,
   'A service somebody is expecting is not there. Both the buyer and the people who will be asked about it need it.', '35 min ago', 22),
  ('NR-B4', 'enterprise', 'payment.failed', 'A payment failed', 'Finance approvers',
   array['email','sms'], 'Every time', 'high', true, true,
   'Service stops if this is not fixed, so it goes to a phone as well as an inbox and cannot be turned off.', '2 h ago', 23),
  ('NR-B5', 'enterprise', 'invoice.issued', 'An invoice is issued', 'Finance approvers',
   array['email'], 'Every time', 'normal', true, false,
   'Finance pays from a document, so it is emailed rather than shown in the console.', '2 d ago', 24),
  ('NR-B6', 'enterprise', 'sub.renewing', 'A subscription is renewing', 'Procurement lead',
   array['email'], 'Every time', 'normal', true, true,
   'Notice before money is taken again is the whole point. It is not the sort of thing an account may opt out of.', '3 w ago', 25),
  ('NR-B7', 'enterprise', 'cap.reached', 'A cost centre hit its cap', 'Procurement and finance',
   array['inapp','email'], 'At most once a day', 'normal', true, false,
   'The alert that stops a surprise at the end of a quarter rather than reporting one.', '1 w ago', 26),
  ('NR-B8', 'enterprise', 'digest.weekly', 'Weekly account digest', 'Everyone on this account',
   array['email'], 'Digest — weekly', 'low', false, false,
   'Off by default. An account this size generates enough email without a summary of it.', 'Never', 27),

  -- consumer
  ('NR-C1', 'consumer', 'order.stage', 'Order and delivery updates', 'You',
   array['push','sms'], 'Every time', 'normal', true, false,
   'The updates people actually want, and the reason they stop opening the app to check.', '20 min ago', 30),
  ('NR-C2', 'consumer', 'order.failed', 'A delivery problem', 'You',
   array['push','sms','email'], 'Every time', 'high', true, true,
   'Something you are waiting for is not coming. Not telling you is not a preference we offer.', '2 h ago', 31),
  ('NR-C3', 'consumer', 'sub.renewing', 'Before a subscription renews', 'You',
   array['push','email'], 'Every time', 'normal', true, true,
   'Three days before money leaves your account. Renewing something silently is how a subscription becomes a complaint.', 'Yesterday', 32),
  ('NR-C4', 'consumer', 'sub.pricechange', 'A price change on something you hold', 'You',
   array['email'], 'Every time', 'high', true, true,
   'A price rise you were not told about is the one people cancel over, and in most markets telling you is the law.', 'Never', 33),
  ('NR-C5', 'consumer', 'approval.pending', 'Somebody on your account wants to buy', 'Account owner',
   array['push'], 'Every time', 'normal', true, false,
   'They are waiting on you, and a push is the fastest way to unblock them.', '4 d ago', 34),
  ('NR-C6', 'consumer', 'cap.reached', 'A spend cap was reached', 'Account owner',
   array['push','email'], 'Every time', 'normal', true, false,
   'The cap did its job. This is the part where you decide whether to raise it.', '2 w ago', 35),
  ('NR-C7', 'consumer', 'invoice.issued', 'Your bill is ready', 'You',
   array['push','email'], 'Every time', 'normal', true, false,
   'Before it is taken, not after.', '01 Jul', 36),
  ('NR-C8', 'consumer', 'refund.decided', 'A refund was decided', 'You',
   array['push','email'], 'Every time', 'high', true, true,
   'You asked for money back. Whether the answer is yes or no, you are owed it.', '3 d ago', 37)
on conflict (id) do update set
  name = excluded.name, audience = excluded.audience, kinds = excluded.kinds,
  throttle = excluded.throttle, severity = excluded.severity,
  enabled = excluded.enabled, mandatory = excluded.mandatory, why = excluded.why;

/* ============================================================= templates === */

create table if not exists notification_templates (
  id        text primary key,
  rule_id   text not null references notification_rules(id) on delete cascade,
  kind_id   text not null references notification_kinds(id) on delete cascade,
  subject   text not null,
  body      text not null,
  edited_by text,
  edited_on date,
  unique (rule_id, kind_id)
);

create index if not exists notification_templates_rule_idx on notification_templates(rule_id);

/* Written per kind rather than one string reused everywhere: an SMS that reads
   like an email is a wasted segment, and an email that reads like an SMS tells
   nobody what to do next. Defaults are generated for every rule and kind so a
   rule can never fire with nothing to say; the ones worth writing by hand are
   overwritten below. */
insert into notification_templates (id, rule_id, kind_id, subject, body)
select r.id || '-' || k.id, r.id, k.id, r.name,
       case when k.max_chars is null
         then 'Hello {recipient},' || E'\n\n' || r.name || '.' || E'\n\n' ||
              e.description || E'\n\n' || '{link}'
         else r.name || ' — ' || e.description || ' {link}' end
from notification_rules r
  join notification_events e on e.id = r.event_id
  join notification_kinds k on k.id = any(r.kinds)
on conflict (id) do nothing;

update notification_templates set
  subject = 'Order {order} failed to fulfil',
  body = 'Hello {recipient},' || E'\n\n' ||
         'Fulfilment failed on {order} ({listing}) for {buyer}.' || E'\n\n' ||
         'Reason: {reason}' || E'\n\n' ||
         'The order will not settle until it completes, so this is worth doing before it is worth explaining.' || E'\n\n' ||
         '{link}'
where rule_id = 'NR-P2' and kind_id = 'email';

update notification_templates set
  subject = 'Order {order} failed', body = 'URGENT: {order} failed to fulfil and will not settle. {link}'
where rule_id = 'NR-P2' and kind_id = 'sms';

update notification_templates set
  subject = 'A refund on {order} is being decided by you',
  body = 'Hello {recipient},' || E'\n\n' ||
         '{buyer} has asked for {amount} back on {order} ({listing}).' || E'\n\n' ||
         'Reason given: {reason}' || E'\n\n' ||
         'You have until {due} to answer. If nobody does, the marketplace decides it and the cost still comes off your settlement.' || E'\n\n' ||
         '{link}'
where rule_id = 'NR-P6' and kind_id = 'email';

update notification_templates set
  subject = 'Your {marketplace} statement for {due} is ready',
  body = 'Hello {recipient},' || E'\n\n' ||
         'Your statement is worked out and readable, showing {amount} payable.' || E'\n\n' ||
         'Every figure on it is the sum of the order lines behind it, and you can check them yourself before it is approved.' || E'\n\n' ||
         '{link}'
where rule_id = 'NR-P4' and kind_id = 'email';

update notification_templates set
  subject = 'We could not take your payment',
  body = 'Hello {recipient},' || E'\n\n' ||
         'The payment of {amount} for {listing} was declined.' || E'\n\n' ||
         'Nothing has stopped yet. Updating the card by {due} keeps everything running; after that the service pauses.' || E'\n\n' ||
         '{link}'
where rule_id = 'NR-B4' and kind_id = 'email';

update notification_templates set
  subject = 'Payment failed', body = 'Payment of {amount} declined. Service pauses on {due} unless it is fixed. {link}'
where rule_id = 'NR-B4' and kind_id = 'sms';

update notification_templates set
  subject = '{listing} renews on {due}',
  body = 'Hello {recipient},' || E'\n\n' ||
         '{listing} renews on {due} and {amount} will be taken from your usual payment method.' || E'\n\n' ||
         'Nothing to do if that suits. Cancelling before then stops the charge entirely.' || E'\n\n' ||
         '{link}'
where rule_id = 'NR-C3' and kind_id = 'email';

update notification_templates set
  subject = 'Renewing soon', body = '{listing} renews {due} — {amount}. Cancel before then to stop it. {link}'
where rule_id = 'NR-C3' and kind_id = 'push';

update notification_templates set
  subject = 'The price of {listing} is changing',
  body = 'Hello {recipient},' || E'\n\n' ||
         '{partner} is changing the price of {listing} to {amount} from {due}.' || E'\n\n' ||
         'You are being told before it happens so the decision is yours. Cancelling before {due} means you are never charged the new price.' || E'\n\n' ||
         '{link}'
where rule_id = 'NR-C4' and kind_id = 'email';

update notification_templates set
  subject = '{marketplace} settlement run is ready to approve',
  body = 'Hello {recipient},' || E'\n\n' ||
         'The period has closed and statements totalling {amount} are ready for approval.' || E'\n\n' ||
         'Nothing pays out until the run is approved, so every seller is waiting on this.' || E'\n\n' ||
         '{link}'
where rule_id = 'NR-O4' and kind_id = 'email';

update notification_templates set
  subject = 'Dispute on {order} is past its target',
  body = 'Dispute on {order} passed its target on {due}. The marketplace decides it now. {link}'
where rule_id = 'NR-O3' and kind_id = 'sms';

/* =========================================================== preferences === */

/* The only thing a recipient can change. Scoped either to a person or to a
   whole seller account, because "who at your company hears this" is a company
   decision and "which of my devices" is not. */
create table if not exists notification_preferences (
  id         text primary key,
  rule_id    text not null references notification_rules(id) on delete cascade,
  scope      text not null check (scope in ('user', 'partner')),
  user_id    uuid references auth.users(id) on delete cascade,
  partner_id text references partners(id) on delete cascade,
  enabled    boolean not null default true,
  /* Which of the rule's kinds they want it on. A subset — a recipient cannot
     add a channel the rule does not use, because there is no template for it. */
  kinds      text[] not null,
  updated_on date,
  unique (rule_id, user_id, partner_id)
);

create index if not exists notification_prefs_user_idx on notification_preferences(user_id);
create index if not exists notification_prefs_partner_idx on notification_preferences(partner_id);

alter table notification_preferences drop constraint if exists notification_preferences_scope_check;
alter table notification_preferences add constraint notification_preferences_scope_check
  check ((scope = 'user' and user_id is not null and partner_id is null)
      or (scope = 'partner' and partner_id is not null and user_id is null));

/**
 * The two things a preference may not do.
 *
 * A mandatory rule can be moved between channels but not switched off — silence
 * on a failed payment or a delivery that is not coming is not a preference
 * anybody should be able to set, and offering it is how a platform ends up
 * defending itself in front of a regulator. And a recipient cannot pick a kind
 * the rule does not carry, because there is no template for it and it would
 * send nothing.
 */
create or replace function guard_preference() returns trigger
language plpgsql as $$
declare r record;
begin
  select mandatory, kinds, name into r from notification_rules where id = new.rule_id;
  if r is null then
    raise exception 'no such notification rule: %', new.rule_id;
  end if;
  if r.mandatory and not new.enabled then
    raise exception '% cannot be switched off. Choose where it reaches you instead.', r.name;
  end if;
  if not (new.kinds <@ r.kinds) then
    raise exception '% is not sent on every channel you picked — there is no template for it', r.name;
  end if;
  if array_length(new.kinds, 1) is null and new.enabled then
    raise exception '% is on but has nowhere to go. Pick a channel or switch it off.', r.name;
  end if;
  /* Stamped on every change, and on an insert that does not state its own date.
     A client never sends one, so it always gets today; the seed below states
     when these choices were actually made, and stamping over it would tell
     every recipient they changed their preferences this morning. */
  if tg_op = 'UPDATE' or new.updated_on is null then
    new.updated_on := current_date;
  end if;
  return new;
end $$;

drop trigger if exists notification_preferences_guard on notification_preferences;
create trigger notification_preferences_guard before insert or update on notification_preferences
  for each row execute function guard_preference();

/* The demo customer's choices, carried over from the eight toggles that used to
   live in `consumer_notifications`. Offers were off; everything else was on. */
insert into notification_preferences (id, rule_id, scope, user_id, enabled, kinds, updated_on)
select 'NP-' || r.id, r.id, 'user',
       (select id from auth.users where email = 'priya.raman@example.com'),
       case when r.id = 'NR-C1' then true else true end,
       case when r.id = 'NR-C1' then array['push'] else r.kinds end,
       '2026-07-12'
from notification_rules r
where r.persona = 'consumer'
on conflict (id) do nothing;

/* The demo seller's, set at the company level: who at Nimbus hears what. */
insert into notification_preferences (id, rule_id, scope, partner_id, enabled, kinds, updated_on)
select 'NP-1004-' || r.id, r.id, 'partner', 'PTR-1004',
       case when r.id = 'NR-P8' then false else true end,
       case when r.id = 'NR-P1' then array['email'] else r.kinds end,
       '2026-07-19'
from notification_rules r
where r.persona = 'partner'
on conflict (id) do nothing;

insert into notification_preferences (id, rule_id, scope, user_id, enabled, kinds, updated_on)
select 'NP-ENT-' || r.id, r.id, 'user',
       (select id from auth.users where email = 'vikram.shah@smartbuild.in'),
       r.enabled,
       case when r.id = 'NR-B7' then array['email'] else r.kinds end,
       '2026-07-22'
from notification_rules r
where r.persona = 'enterprise'
on conflict (id) do nothing;

/* ================================================================== log === */

/* What was actually sent. A notification nobody can prove was sent is one the
   recipient is entitled to say never arrived — and on a failed payment or a
   price rise, that argument has a regulator in it. */
create table if not exists notification_log (
  id         text primary key,
  rule_id    text references notification_rules(id) on delete set null,
  kind_id    text not null references notification_kinds(id),
  channel_id text references operator_channels(id),
  persona    text not null check (persona in ('operator', 'partner', 'enterprise', 'consumer')),
  recipient  text not null,
  user_id    uuid references auth.users(id) on delete set null,
  partner_id text references partners(id) on delete set null,
  subject    text not null,
  body       text not null,
  sent_at    timestamptz not null,
  state      text not null check (state in ('queued', 'sent', 'delivered', 'failed', 'suppressed')),
  /* Why it failed, or why it was never sent at all. A suppressed message with
     no reason on it is indistinguishable from a bug. */
  detail     text,
  cost       numeric(8,4) not null default 0,
  ref        text
);

create index if not exists notification_log_user_idx on notification_log(user_id, sent_at desc);
create index if not exists notification_log_partner_idx on notification_log(partner_id, sent_at desc);
create index if not exists notification_log_state_idx on notification_log(state, sent_at desc);

alter table notification_log drop constraint if exists notification_log_detail_check;
alter table notification_log add constraint notification_log_detail_check
  check (state not in ('failed', 'suppressed') or detail is not null);

do $$
declare
  u_consumer uuid := (select id from auth.users where email = 'priya.raman@example.com');
  u_ent      uuid := (select id from auth.users where email = 'vikram.shah@smartbuild.in');
begin
  delete from notification_log where id like 'NL-%';

  insert into notification_log (id, rule_id, kind_id, channel_id, persona, recipient,
                                user_id, partner_id, subject, body, sent_at, state, detail, cost, ref) values
    -- the customer
    ('NL-9001', 'NR-C1', 'push', 'ch-005', 'consumer', 'Priya Raman', u_consumer, null,
     'Out for delivery', 'Nimbus Occupancy sensor is out for delivery today. Track it in the app.',
     '2026-07-31 07:12+00', 'delivered', null, 0, 'ORD-881044'),
    ('NL-9002', 'NR-C7', 'email', 'ch-003', 'consumer', 'priya.raman@example.com', u_consumer, null,
     'Your July bill is ready', 'Hello Priya, your bill for July is $84.60 and will be taken on 05 Aug.',
     '2026-07-30 06:00+00', 'delivered', null, 0.0001, 'BILL-2026-07'),
    ('NL-9003', 'NR-C3', 'push', 'ch-005', 'consumer', 'Priya Raman', u_consumer, null,
     'Renewing soon', 'StreamNova Premium 4K renews 03 Aug — $12.99. Cancel before then to stop it.',
     '2026-07-30 09:30+00', 'delivered', null, 0, 'SUB-4411'),
    ('NL-9004', 'NR-C1', 'sms', 'ch-001', 'consumer', '+91 98860 41127', u_consumer, null,
     'Delivery update', 'Your order ORD-881044 was delivered at 11:20.',
     '2026-07-29 05:50+00', 'suppressed',
     'The customer turned SMS off for delivery updates on 12 Jul. Sent on push only.', 0, 'ORD-881044'),
    ('NL-9005', 'NR-C8', 'email', 'ch-003', 'consumer', 'priya.raman@example.com', u_consumer, null,
     'A refund on ORD-881044 was decided',
     'Hello Priya, your refund of $42.00 was agreed in full and is on its way back to the card that paid.',
     '2026-07-02 10:15+00', 'delivered', null, 0.0001, 'RFN-3203'),
    ('NL-9006', 'NR-C2', 'sms', 'ch-001', 'consumer', '+91 98860 41127', u_consumer, null,
     'Delivery problem', 'Delivery of ORD-880788 was attempted and failed. We will retry tomorrow.',
     '2026-07-25 12:40+00', 'failed',
     'Handset unreachable for 24 hours; the gateway gave up after three attempts. Fell back to email.', 0.0045, 'ORD-880788'),

    -- the seller
    ('NL-9101', 'NR-P2', 'sms', 'ch-001', 'partner', '+49 172 664 1180', null, 'PTR-1004',
     'Order failed', 'URGENT: ORD-881489 failed to fulfil and will not settle.',
     '2026-07-28 16:02+00', 'suppressed',
     'The escalation number on file has never been verified, and nothing is sent to an unverified contact.', 0, 'ORD-881489'),
    ('NL-9102', 'NR-P2', 'email', 'ch-003', 'partner', 'rajesh.kumar@nimbussensors.com', null, 'PTR-1004',
     'Order ORD-881489 failed to fulfil',
     'Hello Rajesh, fulfilment failed on ORD-881489 (Nimbus Cold-chain sensor) for Brightline Foods. Two units short on a delivery of eight.',
     '2026-07-28 16:02+00', 'delivered', null, 0.0001, 'ORD-881489'),
    ('NL-9103', 'NR-P6', 'email', 'ch-003', 'partner', 'katrin.boehm@nimbussensors.com', null, 'PTR-1004',
     'A refund on ORD-881502 is being decided by you',
     'Hello Katrin, Sanya Kapoor has asked for $142.00 back on ORD-881502. You have until 01 Aug to answer.',
     '2026-07-30 08:05+00', 'delivered', null, 0.0001, 'RFN-3220'),
    ('NL-9104', 'NR-P4', 'email', 'ch-003', 'partner', 'settlements@nimbussensors.com', null, 'PTR-1004',
     'Your statement for Jul 2026 is ready',
     'Hello, your statement is worked out and shows $22,482.85 payable. Every figure is the sum of the order lines behind it.',
     '2026-07-31 05:00+00', 'delivered', null, 0.0001, 'ss-1004-202607'),
    ('NL-9105', 'NR-P7', 'email', 'ch-003', 'partner', 'settlements@nimbussensors.com', null, 'PTR-1004',
     'A compliance document is expiring',
     'Hello, your tax residency certificate expires on 15 Sep 2026. After that the statutory rate is withheld at source automatically.',
     '2026-07-30 05:00+00', 'delivered', null, 0.0001, 'PTR-1004'),
    ('NL-9106', 'NR-P1', 'inapp', null, 'partner', 'Fulfilment operators', null, 'PTR-1004',
     'A new order', 'Brightline Foods ordered Cold-chain starter — 25 sensors + connectivity for $2,295.00.',
     '2026-07-24 09:14+00', 'delivered', null, 0, 'ORD-880519'),

    -- the enterprise buyer
    ('NL-9201', 'NR-B4', 'sms', 'ch-001', 'enterprise', '+91 98450 11200', u_ent, null,
     'Payment failed', 'Payment of $1,740.00 declined. Service pauses on 05 Aug unless it is fixed.',
     '2026-07-29 14:22+00', 'delivered', null, 0.0045, 'INV-2026-0781'),
    ('NL-9202', 'NR-B4', 'email', 'ch-003', 'enterprise', 'vikram.shah@smartbuild.in', u_ent, null,
     'We could not take your payment',
     'Hello Vikram, the payment of $1,740.00 for the IoT estate rollout was declined. Nothing has stopped yet.',
     '2026-07-29 14:22+00', 'delivered', null, 0.0001, 'INV-2026-0781'),
    ('NL-9203', 'NR-B1', 'inapp', null, 'enterprise', 'Finance and IT approvers', u_ent, null,
     'A requisition needs approval',
     'Anita Desai raised a requisition for $4,820.00, which is above the $2,000 approval threshold.',
     '2026-07-31 08:40+00', 'delivered', null, 0, 'REQ-5512'),
    ('NL-9204', 'NR-B6', 'email', 'ch-003', 'enterprise', 'vikram.shah@smartbuild.in', u_ent, null,
     'Sentinel MDR — 24/7 renews on 12 Aug',
     'Hello Vikram, this renews on 12 Aug and $2,375.00 will be taken from the account on file.',
     '2026-07-13 06:00+00', 'delivered', null, 0.0001, 'SUB-7781'),
    ('NL-9205', 'NR-B7', 'email', 'ch-003', 'enterprise', 'vikram.shah@smartbuild.in', u_ent, null,
     'A cost centre hit its cap',
     'Hello Vikram, the Retail estate cost centre has reached 100% of its quarterly cap.',
     '2026-07-23 07:00+00', 'delivered', null, 0.0001, 'CC-RETAIL'),
    ('NL-9206', 'NR-B8', 'email', 'ch-003', 'enterprise', 'vikram.shah@smartbuild.in', u_ent, null,
     'Weekly account digest', 'Everything that happened on the SmartBuild account last week.',
     '2026-07-27 06:00+00', 'suppressed',
     'The weekly digest is switched off on this account. Nothing was sent.', 0, 'DIGEST-2026-W30'),

    -- the operator
    ('NL-9301', 'NR-O4', 'email', 'ch-003', 'operator', 'settlements@aventa.com', null, null,
     'Aventa settlement run is ready to approve',
     'The period has closed and statements totalling $221,714.05 are ready for approval. Nothing pays out until the run is approved.',
     '2026-07-31 04:00+00', 'delivered', null, 0.0001, '2026-07'),
    ('NL-9302', 'NR-O3', 'sms', 'ch-001', 'operator', '+91 80 4111 2200', null, null,
     'Dispute past its target', 'Dispute on ORD-881350 passed its target on 23 Jul. The marketplace decides it now.',
     '2026-07-25 11:00+00', 'delivered', null, 0.0045, 'RFN-3227'),
    ('NL-9303', 'NR-O1', 'inapp', null, 'operator', 'Catalogue reviewers', null, null,
     'Listing breaches policy', 'Nimbus VPN Gateway failed the type-approval check and is held.',
     '2026-07-31 07:42+00', 'delivered', null, 0, 'SKU-NB-VPN1'),
    ('NL-9304', 'NR-O5', 'inapp', null, 'operator', 'Support agents', null, null,
     'An order failed to fulfil', 'Four orders failed in the last hour, all on the same seller endpoint.',
     '2026-07-31 07:38+00', 'delivered', null, 0, 'ORD-881489'),
    ('NL-9305', 'NR-O2', 'email', 'ch-004', 'operator', 'onboarding@aventa.com', null, null,
     'A seller failed an onboarding gate',
     'Orbital Connect did not clear the KYC gate. Beneficial ownership could not be verified against the register.',
     '2026-07-30 13:20+00', 'delivered', null, 0.0002, 'PTR-1014'),
    ('NL-9306', 'NR-O6', 'email', 'ch-003', 'operator', 'everyone@aventa.com', null, null,
     'Weekly marketplace digest', 'Last week across the marketplace, in one email.',
     '2026-07-27 06:00+00', 'sent',
     null, 0.0001, 'DIGEST-2026-W30');
end $$;

/* ================================================================== RLS === */

alter table notification_kinds       enable row level security;
alter table notification_events      enable row level security;
alter table notification_rules       enable row level security;
alter table notification_templates   enable row level security;
alter table notification_preferences enable row level security;
alter table notification_log         enable row level security;

drop policy if exists "read_notification_kinds"        on notification_kinds;
drop policy if exists "operator_all_notification_kinds" on notification_kinds;
drop policy if exists "read_notification_events"       on notification_events;
drop policy if exists "operator_all_notification_events" on notification_events;
drop policy if exists "persona_read_notification_rules" on notification_rules;
drop policy if exists "operator_all_notification_rules" on notification_rules;
drop policy if exists "persona_read_notification_templates" on notification_templates;
drop policy if exists "operator_all_notification_templates" on notification_templates;
drop policy if exists "operator_all_notification_prefs" on notification_preferences;
drop policy if exists "own_notification_prefs"          on notification_preferences;
drop policy if exists "partner_notification_prefs"      on notification_preferences;
drop policy if exists "operator_read_notification_log"  on notification_log;
drop policy if exists "own_notification_log"            on notification_log;
drop policy if exists "partner_notification_log"        on notification_log;

/* The vocabulary is public to anybody signed in: a recipient choosing where a
   message reaches them has to be able to read what the channels are. */
create policy "read_notification_kinds" on notification_kinds
  for select to anon, authenticated using (true);
create policy "operator_all_notification_kinds" on notification_kinds for all to authenticated
  using (current_persona() = 'operator') with check (current_persona() = 'operator');

create policy "read_notification_events" on notification_events
  for select to authenticated using (true);
create policy "operator_all_notification_events" on notification_events for all to authenticated
  using (current_persona() = 'operator') with check (current_persona() = 'operator');

/* A recipient sees the rules aimed at their own persona and no others. The
   operator's internal alerting is not a seller's business, and vice versa. */
create policy "persona_read_notification_rules" on notification_rules
  for select to authenticated using (persona = current_persona());
create policy "operator_all_notification_rules" on notification_rules for all to authenticated
  using (current_persona() = 'operator') with check (current_persona() = 'operator');

/* Templates follow their rule. Showing a recipient what they will actually be
   sent is the point of having them written down. */
create policy "persona_read_notification_templates" on notification_templates
  for select to authenticated using (
    exists (select 1 from notification_rules r
             where r.id = notification_templates.rule_id and r.persona = current_persona()));
create policy "operator_all_notification_templates" on notification_templates for all to authenticated
  using (current_persona() = 'operator') with check (current_persona() = 'operator');

/* Preferences are the one thing a recipient owns outright. The operator can
   read them — somebody has to be able to answer "why did they not get it" — but
   the trigger above still refuses to switch off a mandatory rule, whoever asks. */
create policy "operator_all_notification_prefs" on notification_preferences for all to authenticated
  using (current_persona() = 'operator') with check (current_persona() = 'operator');

create policy "own_notification_prefs" on notification_preferences
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "partner_notification_prefs" on notification_preferences
  for all to authenticated
  using (scope = 'partner' and partner_id = current_partner_id())
  with check (scope = 'partner' and partner_id = current_partner_id());

/* History is read-only to everybody. Nobody edits what was sent. */
create policy "operator_read_notification_log" on notification_log
  for select to authenticated using (current_persona() = 'operator');
create policy "own_notification_log" on notification_log
  for select to authenticated using (user_id = auth.uid());
create policy "partner_notification_log" on notification_log
  for select to authenticated using (partner_id = current_partner_id());

/* ------------------------------------------------------ sanity assertions -- */
do $$
declare n integer;
begin
  /* Every rule can be sent. A rule with no template for a kind it uses would
     fire and say nothing. */
  select count(*) into n
    from notification_rules r, unnest(r.kinds) k
   where not exists (select 1 from notification_templates t
                      where t.rule_id = r.id and t.kind_id = k);
  if n > 0 then
    raise exception '% rule/channel pairs have no template — the rule would fire and say nothing', n;
  end if;

  /* And every template belongs to a channel its rule actually uses. */
  select count(*) into n from notification_templates t
    join notification_rules r on r.id = t.rule_id
   where not (t.kind_id = any(r.kinds));
  if n > 0 then
    raise exception '% templates are written for a channel their rule does not use', n;
  end if;

  /* A rule may only be aimed at a persona its event applies to. */
  select count(*) into n from notification_rules r
    join notification_events e on e.id = r.event_id
   where not (r.persona = any(e.personas));
  if n > 0 then
    raise exception '% rules send an event to a persona it does not apply to', n;
  end if;

  /* A short-form template that does not fit its channel is a message that
     arrives cut in half. */
  select count(*) into n from notification_templates t
    join notification_kinds k on k.id = t.kind_id
   where k.max_chars is not null and length(t.body) > k.max_chars;
  if n > 0 then
    raise exception '% templates are longer than the channel they are written for', n;
  end if;

  /* No preference may switch off something mandatory. The trigger enforces it
     on write; this catches anything seeded around it. */
  select count(*) into n from notification_preferences p
    join notification_rules r on r.id = p.rule_id
   where r.mandatory and not p.enabled;
  if n > 0 then
    raise exception '% preferences switch off a mandatory notification', n;
  end if;

  /* And none may name a channel its rule does not carry. */
  select count(*) into n from notification_preferences p
    join notification_rules r on r.id = p.rule_id
   where not (p.kinds <@ r.kinds);
  if n > 0 then
    raise exception '% preferences pick a channel their rule cannot send on', n;
  end if;

  /* Every persona has something to look at, or one of the four preference
     screens is empty. */
  select count(distinct persona) into n from notification_rules;
  if n <> 4 then
    raise exception 'only % personas have notification rules', n;
  end if;

  /* Every delivery kind has a gateway behind it, or a rule using it sends into
     nothing. */
  select count(*) into n from notification_kinds k
   where k.id <> 'inapp'
     and not exists (select 1 from operator_channels c where c.kind = k.id and c.enabled);
  if n > 0 then
    raise exception '% delivery channels have no gateway configured behind them', n;
  end if;

  /* The log has to carry the cases the history screen exists to explain: one
     that failed and one that was deliberately not sent. */
  select count(*) into n from notification_log where state = 'failed';
  if n < 1 then raise exception 'nothing in the notification log ever failed'; end if;
  select count(*) into n from notification_log where state = 'suppressed';
  if n < 2 then raise exception 'the log has no suppressed messages to explain'; end if;
end $$;

/* ------------------------------------------------- the log and the rules -- */

/* A rule whose `last_sent` says "3 d ago" while the delivery history has never
   heard of it is a screen contradicting itself in two places a page apart. The
   rows below are the messages those rules claim to have sent; the assertion at
   the end refuses to let the two drift apart again. */
do $$
declare
  u_consumer uuid := (select id from auth.users where email = 'priya.raman@example.com');
  u_ent      uuid := (select id from auth.users where email = 'vikram.shah@smartbuild.in');
  n integer;
begin
  delete from notification_log where id like 'NL-8%';

  insert into notification_log (id, rule_id, kind_id, channel_id, persona, recipient,
                                user_id, partner_id, subject, body, sent_at, state, detail, cost, ref) values
    ('NL-8101', 'NR-P3', 'email', 'ch-003', 'partner', 'katrin.boehm@nimbussensors.com', null, 'PTR-1004',
     'A listing decision',
     'Hello Katrin, Nimbus Occupancy sensor — 20 pack was approved and is live in the catalogue.',
     '2026-07-28 10:30+00', 'delivered', null, 0.0001, 'SKU-NB-OCC20'),
    ('NL-8102', 'NR-P5', 'email', 'ch-003', 'partner', 'settlements@nimbussensors.com', null, 'PTR-1004',
     'A payout has landed',
     'Hello, $19,884.12 for the June period has left the payout account and should reach you within two working days.',
     '2026-07-26 06:15+00', 'delivered', null, 0.0001, 'ss-1004-202606'),
    ('NL-8103', 'NR-P8', 'inapp', null, 'partner', 'Seller admin', null, 'PTR-1004',
     'A refund on your product was decided',
     'Two refunds on your products were decided yesterday, costing $184.00 against your next settlement.',
     '2026-07-29 06:00+00', 'delivered', null, 0, 'RFN-DIGEST-0729'),

    ('NL-8201', 'NR-B2', 'email', 'ch-003', 'enterprise', 'anita.desai@smartbuild.in', u_ent, null,
     'A requisition was decided',
     'Hello Anita, your requisition for $1,240.00 was approved by Vikram Shah. It has gone to the seller.',
     '2026-07-30 11:05+00', 'delivered', null, 0.0001, 'REQ-5498'),
    ('NL-8202', 'NR-B3', 'inapp', null, 'enterprise', 'Procurement and IT', u_ent, null,
     'An order failed to provision',
     'Sentinel MDR could not be provisioned on four sites — the tenant identifier was rejected by the seller.',
     '2026-07-31 08:05+00', 'delivered', null, 0, 'ORD-881517'),
    ('NL-8203', 'NR-B5', 'email', 'ch-003', 'enterprise', 'vikram.shah@smartbuild.in', u_ent, null,
     'An invoice is issued',
     'Hello Vikram, invoice INV-2026-0779 for $6,420.00 covering July usage is attached and due on 20 Aug.',
     '2026-07-29 06:00+00', 'delivered', null, 0.0001, 'INV-2026-0779'),

    ('NL-8301', 'NR-C5', 'push', 'ch-005', 'consumer', 'Priya Raman', u_consumer, null,
     'Somebody on your account wants to buy',
     'Arjun asked to buy a Nimbus Occupancy sensor for $64.00. Approve or decline in the app.',
     '2026-07-27 15:20+00', 'delivered', null, 0, 'REQ-2210'),
    ('NL-8302', 'NR-C6', 'push', 'ch-005', 'consumer', 'Priya Raman', u_consumer, null,
     'A spend cap was reached',
     'The household spend cap of $200 for July has been reached. Nothing further can be bought until you raise it.',
     '2026-07-17 09:45+00', 'delivered', null, 0, 'CAP-HOUSEHOLD');

  /* Two ways of saying when something last went out must not disagree. */
  select count(*) into n from notification_rules r
   where r.last_sent is not null and r.last_sent <> 'Never'
     and not exists (select 1 from notification_log l where l.rule_id = r.id);
  if n > 0 then
    raise exception '% rules claim a last-sent date the delivery history has never heard of', n;
  end if;

  /* And the other way round: a rule with a message in the history did send
     something, so it cannot also claim it never has. */
  select count(*) into n from notification_rules r
   where coalesce(r.last_sent, 'Never') = 'Never'
     and exists (select 1 from notification_log l where l.rule_id = r.id
                  and l.state in ('sent', 'delivered'));
  if n > 0 then
    raise exception '% rules say they have never sent anything, but the history has a delivered message from them', n;
  end if;

  /* A logged message has to be one its rule could actually have sent. */
  select count(*) into n from notification_log l
    join notification_rules r on r.id = l.rule_id
   where not (l.kind_id = any(r.kinds)) or l.persona <> r.persona;
  if n > 0 then
    raise exception '% logged messages went out on a channel or to a persona their rule does not use', n;
  end if;
end $$;
