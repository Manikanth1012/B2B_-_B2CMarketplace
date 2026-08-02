-- What chasing an unpaid bill actually consists of.
--
-- Collections showed which ladder a case was running on and gave nobody a way
-- to see what that ladder was, let alone change it. The steps were an array
-- inside a click handler — `['Soft retry', 'Soft reminder', …]` — and the rules
-- were five sentences in a bulleted list underneath, which is documentation of
-- a thing rather than the thing.
--
-- That matters more here than on most screens. A dunning ladder decides when a
-- customer is cut off, and the audiences are not comparable: a retail customer
-- suspended on day 14 usually churns and takes more with them than the
-- receivable was worth; an enterprise invoice at day 35 is nearly always a
-- purchase order in transit; a seller must never be suspended at all, because
-- taking their listings down strands buyers who are mid-order — the money is
-- withheld from settlement instead.
--
-- Nor is one ladder per audience enough. A Platinum retail customer of six
-- years and a Bronze account three weeks old are not the same collections
-- problem, and treating them alike is how a marketplace loses the customer it
-- least wanted to.
--
-- So: a ladder per audience, an optional ladder per tier that overrides it, and
-- the steps as rows. Which ladder a case runs on stays resolved from the
-- account rather than chosen by a collector — that was already true and is the
-- reason this is configuration rather than a free-text field.

/* ============================================== one vocabulary for three === */

/* `operator_dunning_cases` said 'seller' where the rest of the marketplace —
   personas, bill templates, category audiences — says 'partner'. Two words for
   one audience across two screens is a rename waiting to be got wrong, and
   this migration is the moment it costs least. */
update operator_dunning_cases set account_type = 'partner' where account_type = 'seller';
update operator_dunning_cases set ladder = 'partner' where ladder = 'seller';

/* ==================================================== the ladders ========= */

create table if not exists dunning_ladders (
  id          text primary key,
  name        text not null,
  audience    text not null check (audience in ('consumer', 'enterprise', 'partner')),
  /* Null is the audience default. A value overrides it for accounts at that
     tier — which is the whole point: a Platinum customer is chased differently
     from a Bronze one, or the tier means nothing where it matters most. */
  tier        text,

  /* Days past the due date before the ladder starts at all. */
  grace_days  integer not null default 0,
  /* The day service is interrupted. Null is never, which is not an oversight:
     it is the correct answer for a seller and for a strategic account. */
  suspend_on_day integer,
  /* For a seller. Their listings stay up and the money is held back instead. */
  withhold_settlement boolean not null default false,
  /* A promise to pay pauses the ladder where it stands rather than resetting
     it, so a broken promise resumes rather than restarts. */
  pause_on_promise boolean not null default true,

  note        text not null default '',
  system      boolean not null default false,
  updated_by  text,
  updated_on  date,
  sort_order  integer not null default 0
);

/* One default per audience, one override per tier. Both as indexes rather than
   as a check in the form, because a second default is not a validation error,
   it is two answers to "what happens to this account". */
create unique index if not exists dunning_ladder_default_idx
  on dunning_ladders(audience) where tier is null;
create unique index if not exists dunning_ladder_tier_idx
  on dunning_ladders(audience, tier) where tier is not null;

create table if not exists dunning_steps (
  id         text primary key,
  ladder_id  text not null references dunning_ladders(id) on delete cascade,
  step_no    integer not null,
  name       text not null,
  /* Days past due this step fires on. Ascending with step_no, asserted below —
     a ladder that chases on day 10 and then day 3 is not a ladder. */
  day        integer not null,
  channel    text not null check (channel in
              ('automatic', 'sms', 'email', 'in-app', 'call', 'letter', 'settlement')),
  action     text not null check (action in
              ('retry', 'remind', 'warn', 'final', 'suspend', 'withhold', 'refer', 'review')),
  note       text not null default '',
  unique (ladder_id, step_no)
);

/* ------------------------------------------------------------ the six ---- */

insert into dunning_ladders (id, name, audience, tier, grace_days, suspend_on_day,
                             withhold_settlement, note, system, updated_by, updated_on, sort_order) values
  ('DL-CON', 'Retail — standard', 'consumer', null, 3, 14, false,
   'The default retail ladder. Suspension at day 14 and not before: involuntary churn costs more than the receivable.',
   true, 'Anika Sharma', '2026-08-01', 1),

  ('DL-CON-GOLD', 'Retail — Gold', 'consumer', 'gold', 5, 21, false,
   'A longer rope for a customer who has earned one. Same steps, later, and a human call before the final notice.',
   false, 'Anika Sharma', '2026-08-01', 2),

  ('DL-CON-PLAT', 'Retail — Platinum', 'consumer', 'platinum', 7, 30, false,
   'Retention comes before recovery on this tier. Care rings before anything automated escalates.',
   false, 'Anika Sharma', '2026-08-01', 3),

  ('DL-ENT', 'Business — standard', 'enterprise', null, 5, 60, false,
   'A missed business invoice is usually a purchase order in transit, so the ladder is slow and the first steps go to accounts payable rather than to the buyer.',
   true, 'Anika Sharma', '2026-08-01', 4),

  ('DL-ENT-STRAT', 'Business — Strategic', 'enterprise', 'org-platinum', 10, null, false,
   'Never suspended. A strategic account in arrears is an account management conversation, and cutting service off mid-contract is not one.',
   false, 'Anika Sharma', '2026-08-01', 5),

  ('DL-PTR', 'Seller — standard', 'partner', null, 0, null, true,
   'A seller is never suspended: taking listings down strands buyers who are mid-order. Settlement is withheld against the debt instead.',
   true, 'Anika Sharma', '2026-08-01', 6),

  ('DL-PTR-PLAT', 'Seller — Platinum', 'partner', 'platinum', 14, null, true,
   'Two weeks before anything is withheld. A platinum seller''s cash flow is the marketplace''s supply.',
   false, 'Anika Sharma', '2026-08-01', 7)
on conflict (id) do update set
  name = excluded.name, note = excluded.note, grace_days = excluded.grace_days,
  suspend_on_day = excluded.suspend_on_day;

insert into dunning_steps (id, ladder_id, step_no, name, day, channel, action, note) values
  /* Retail — standard. Fast, cheap channels first; a person only near the end. */
  ('DS-CON-1', 'DL-CON', 1, 'Soft retry',        3,  'automatic', 'retry',  'Re-present the instrument on file. No message is sent — most failures are transient.'),
  ('DS-CON-2', 'DL-CON', 2, 'Soft reminder',     5,  'sms',       'remind', 'A reminder with a payment link. No mention of suspension yet.'),
  ('DS-CON-3', 'DL-CON', 3, 'Second reminder',   8,  'email',     'remind', 'The bill attached, and how to query a line without holding the rest of the payment.'),
  ('DS-CON-4', 'DL-CON', 4, 'Third reminder',    11, 'in-app',    'warn',   'On the account banner. Names the date service is interrupted.'),
  ('DS-CON-5', 'DL-CON', 5, 'Final notice',      13, 'sms',       'final',  'Twenty-four hours'' notice, which is the minimum that is fair.'),
  ('DS-CON-6', 'DL-CON', 6, 'Suspend',           14, 'automatic', 'suspend','Outgoing service stops. Incoming calls and emergency numbers do not.'),
  ('DS-CON-7', 'DL-CON', 7, 'Refer',             45, 'letter',    'refer',  'Referred with the full correspondence history attached.'),

  /* Retail — Gold. The same shape, later, with a call before the final notice. */
  ('DS-CONG-1', 'DL-CON-GOLD', 1, 'Soft retry',      5,  'automatic', 'retry',  'Re-present the instrument on file.'),
  ('DS-CONG-2', 'DL-CON-GOLD', 2, 'Soft reminder',   8,  'sms',       'remind', 'A reminder with a payment link.'),
  ('DS-CONG-3', 'DL-CON-GOLD', 3, 'Second reminder', 12, 'email',     'remind', 'The bill attached, with the tier''s support number on it.'),
  ('DS-CONG-4', 'DL-CON-GOLD', 4, 'Courtesy call',   16, 'call',      'review', 'Priority queue. Usually a card that expired, and usually fixed on the call.'),
  ('DS-CONG-5', 'DL-CON-GOLD', 5, 'Final notice',    19, 'email',     'final',  'Two days'' notice.'),
  ('DS-CONG-6', 'DL-CON-GOLD', 6, 'Suspend',         21, 'automatic', 'suspend','Outgoing service stops.'),

  /* Retail — Platinum. Care rings before anything automated escalates. */
  ('DS-CONP-1', 'DL-CON-PLAT', 1, 'Soft retry',      7,  'automatic', 'retry',  'Re-present the instrument on file.'),
  ('DS-CONP-2', 'DL-CON-PLAT', 2, 'Courtesy call',   10, 'call',      'review', 'Before any reminder goes out. Retention comes before recovery on this tier.'),
  ('DS-CONP-3', 'DL-CON-PLAT', 3, 'Written summary', 15, 'email',     'remind', 'What is outstanding and what was discussed on the call.'),
  ('DS-CONP-4', 'DL-CON-PLAT', 4, 'Account review',  22, 'call',      'review', 'Held by the retention team, not by collections.'),
  ('DS-CONP-5', 'DL-CON-PLAT', 5, 'Final notice',    27, 'email',     'final',  'Three days'' notice.'),
  ('DS-CONP-6', 'DL-CON-PLAT', 6, 'Suspend',         30, 'automatic', 'suspend','Outgoing service stops.'),

  /* Business — standard. To accounts payable, not to the buyer. */
  ('DS-ENT-1', 'DL-ENT', 1, 'Statement of account', 5,  'email',  'remind', 'To accounts payable. Most of these are a purchase order that has not cleared.'),
  ('DS-ENT-2', 'DL-ENT', 2, 'Second reminder',      15, 'email',  'remind', 'Copied to the named billing contact on the account.'),
  ('DS-ENT-3', 'DL-ENT', 3, 'Collector call',       25, 'call',   'review', 'Ask what is blocking it. A promise to pay recorded here pauses the ladder.'),
  ('DS-ENT-4', 'DL-ENT', 4, 'Credit hold',          35, 'in-app', 'warn',   'No new orders against the account. Existing service is untouched.'),
  ('DS-ENT-5', 'DL-ENT', 5, 'Final notice',         50, 'letter', 'final',  'On paper, to the registered address, naming the suspension date.'),
  ('DS-ENT-6', 'DL-ENT', 6, 'Suspend',              60, 'automatic', 'suspend', 'Service interrupted. Sixty days is the contractual floor.'),
  ('DS-ENT-7', 'DL-ENT', 7, 'Refer',                90, 'letter', 'refer',  'Referred with the contract and the full correspondence history.'),

  /* Business — Strategic. Nothing is ever cut off. */
  ('DS-ENTS-1', 'DL-ENT-STRAT', 1, 'Account manager notified', 10, 'in-app', 'review', 'Their account manager hears about it before the customer does.'),
  ('DS-ENTS-2', 'DL-ENT-STRAT', 2, 'Statement of account',     20, 'email',  'remind', 'To accounts payable, copied to the account manager.'),
  ('DS-ENTS-3', 'DL-ENT-STRAT', 3, 'Joint review',             45, 'call',   'review', 'Account management and finance, together, with the customer.'),
  ('DS-ENTS-4', 'DL-ENT-STRAT', 4, 'Credit hold',              75, 'in-app', 'warn',   'No new orders. Existing service continues — this tier is never suspended.'),

  /* Seller — standard. Withheld, never suspended. */
  ('DS-PTR-1', 'DL-PTR', 1, 'Debt notice',           1,  'email',      'remind',   'What is owed and which settlement it will come out of.'),
  ('DS-PTR-2', 'DL-PTR', 2, 'Commission recovery',   7,  'settlement', 'withhold', 'Netted off the next settlement run. Listings stay up.'),
  ('DS-PTR-3', 'DL-PTR', 3, 'Full withhold',         21, 'settlement', 'withhold', 'The whole settlement is held until the debt clears.'),
  ('DS-PTR-4', 'DL-PTR', 4, 'Account review',        45, 'call',       'review',   'Whether this seller continues on the marketplace. Not a suspension.'),

  /* Seller — Platinum. Two weeks before anything is held. */
  ('DS-PTRP-1', 'DL-PTR-PLAT', 1, 'Debt notice',         14, 'email',      'remind',   'Their cash flow is the marketplace''s supply; the notice comes first and alone.'),
  ('DS-PTRP-2', 'DL-PTR-PLAT', 2, 'Partner manager call', 21, 'call',      'review',   'Before anything is withheld.'),
  ('DS-PTRP-3', 'DL-PTR-PLAT', 3, 'Commission recovery',  35, 'settlement', 'withhold','Netted off the next settlement run.'),
  ('DS-PTRP-4', 'DL-PTR-PLAT', 4, 'Account review',       60, 'call',       'review',  'Whether this seller continues on the marketplace.')
on conflict (id) do update set
  name = excluded.name, day = excluded.day, channel = excluded.channel,
  action = excluded.action, note = excluded.note;

/* ============================== which ladder a case is actually running === */

alter table operator_dunning_cases add column if not exists tier text;
alter table operator_dunning_cases add column if not exists ladder_id text
  references dunning_ladders(id);

/* The demo cases get the tier their account actually holds, so the resolution
   below is doing real work rather than agreeing with itself. */
update operator_dunning_cases c set tier = m.tier
  from loyalty_members m
 where c.account_type = 'consumer' and lower(m.name) = lower(c.account_name);

/**
 * The ladder an account runs on.
 *
 * Resolved, never chosen. A collector picking the gentle ladder for the
 * customer who shouted loudest is the failure mode this whole table exists to
 * prevent, so the answer is a function of the account and nothing else.
 */
create or replace function dunning_ladder_for(p_audience text, p_tier text)
returns text language sql stable as $$
  select id from dunning_ladders
   where audience = p_audience and (tier = p_tier or tier is null)
   order by (tier is null)          -- an exact tier beats the default
   limit 1;
$$;

update operator_dunning_cases
   set ladder_id = dunning_ladder_for(account_type, tier),
       ladder    = account_type;

/* ==================================================== RLS and the guard === */

alter table dunning_ladders enable row level security;
alter table dunning_steps   enable row level security;

do $$
declare t text;
begin
  foreach t in array array['dunning_ladders', 'dunning_steps'] loop
    execute format('drop policy if exists "operator_all_%1$s" on %1$I', t);
    execute format('drop policy if exists "read_%1$s" on %1$I', t);
    execute format($f$create policy "operator_all_%1$s" on %1$I for all to authenticated
                        using (current_persona() = 'operator')
                        with check (current_persona() = 'operator')$f$, t);
    /* Everybody reads. A customer in arrears is entitled to know what happens
       next and when, and the account banner says so. */
    execute format($f$create policy "read_%1$s" on %1$I for select to anon, authenticated
                        using (true)$f$, t);
  end loop;
end $$;

/**
 * What a ladder may not be made into.
 *
 * Three things RLS cannot say. A seller cannot be suspended — that is not a
 * preference, it is the difference between withholding money and stranding a
 * buyer mid-order. A ladder somebody is being chased on cannot be deleted out
 * from under them. And a default cannot be removed, because an audience with
 * no ladder is an audience nobody chases and nobody tells.
 */
create or replace function guard_dunning() returns trigger
language plpgsql security definer set search_path = public as $$
declare aud text; n integer; who text;
begin
  if current_persona() is null then
    return case tg_op when 'DELETE' then old else new end;
  end if;

  if tg_table_name = 'dunning_steps' and tg_op in ('INSERT', 'UPDATE') then
    select audience into aud from dunning_ladders where id = new.ladder_id;
    if aud = 'partner' and new.action = 'suspend' then
      raise exception 'A seller is never suspended. Taking their listings down strands buyers who are mid-order — withhold the settlement instead.';
    end if;
    if new.day < 0 then
      raise exception 'A step cannot fire before the bill is due.';
    end if;
    return new;
  end if;

  if tg_table_name = 'dunning_ladders' and tg_op = 'DELETE' then
    /* The parent going is not a step being removed; that is decided here. */
    if old.system then
      raise exception '% ships with the marketplace and is the default for its audience. It can be edited but not deleted.', old.name;
    end if;
    if old.tier is null then
      raise exception '% is the default for every % account. Point that audience at another ladder before removing this one.', old.name, old.audience;
    end if;
    select count(*) into n from operator_dunning_cases where ladder_id = old.id;
    if n > 0 then
      raise exception '% accounts are being chased on % right now. Move them before deleting it.', n, old.name;
    end if;
    return old;
  end if;

  if tg_table_name = 'dunning_ladders' and tg_op in ('INSERT', 'UPDATE') then
    if new.audience = 'partner' and new.suspend_on_day is not null then
      raise exception 'A seller ladder cannot carry a suspension day. Settlement is withheld instead.';
    end if;
    if new.grace_days < 0 then
      raise exception 'Grace cannot be negative — that would start chasing before the bill was due.';
    end if;
    if new.suspend_on_day is not null and new.suspend_on_day <= new.grace_days then
      raise exception 'Service would be cut off at day %, inside the % days of grace this ladder promises.',
        new.suspend_on_day, new.grace_days;
    end if;
  end if;

  return new;
end $$;

drop trigger if exists dunning_steps_guard on dunning_steps;
create trigger dunning_steps_guard before insert or update on dunning_steps
  for each row execute function guard_dunning();

drop trigger if exists dunning_ladders_guard on dunning_ladders;
create trigger dunning_ladders_guard before insert or update or delete on dunning_ladders
  for each row execute function guard_dunning();

/* ------------------------------------------------------- sanity checks -- */
do $$
declare n integer; s text;
begin
  /* Every audience has a default, or somebody is in arrears and nobody is
     chasing them. */
  select string_agg(a, ', ') into s from unnest(array['consumer','enterprise','partner']) a
   where not exists (select 1 from dunning_ladders l where l.audience = a and l.tier is null);
  if s is not null then raise exception 'these audiences have no default ladder: %', s; end if;

  /* No ladder chases in an order that goes backwards. */
  select string_agg(l.name || ' step ' || b.step_no, ', ') into s
    from dunning_steps a
    join dunning_steps b on b.ladder_id = a.ladder_id and b.step_no = a.step_no + 1
    join dunning_ladders l on l.id = a.ladder_id
   where b.day < a.day;
  if s is not null then raise exception 'these steps fire before the step before them: %', s; end if;

  /* No step fires inside the grace the ladder promises. */
  select string_agg(l.name || ' — ' || st.name, ', ') into s
    from dunning_steps st join dunning_ladders l on l.id = st.ladder_id
   where st.day < l.grace_days;
  if s is not null then raise exception 'these steps fire inside their own grace period: %', s; end if;

  /* A seller is never suspended. Asserted, because it is the one rule here
     whose violation strands somebody else's customer. */
  select count(*) into n from dunning_steps st
    join dunning_ladders l on l.id = st.ladder_id
   where l.audience = 'partner' and st.action = 'suspend';
  if n > 0 then raise exception '% seller steps suspend a seller', n; end if;

  /* Where a ladder says it suspends, a step actually does, and on that day. */
  select string_agg(l.name, ', ') into s from dunning_ladders l
   where l.suspend_on_day is not null
     and not exists (select 1 from dunning_steps st
                      where st.ladder_id = l.id and st.action = 'suspend' and st.day = l.suspend_on_day);
  if s is not null then raise exception 'these ladders promise a suspension day no step carries out: %', s; end if;

  /* And a ladder with no suspension day does not smuggle one into a step. */
  select string_agg(l.name, ', ') into s from dunning_ladders l
    join dunning_steps st on st.ladder_id = l.id and st.action = 'suspend'
   where l.suspend_on_day is null;
  if s is not null then raise exception 'these ladders say they never suspend and then do: %', s; end if;

  /* A higher tier is never chased harder than the default. That is the whole
     reason tiers are here, and it is easy to break by editing one number. */
  select string_agg(t.name, ', ') into s
    from dunning_ladders t join dunning_ladders d
      on d.audience = t.audience and d.tier is null
   where t.tier is not null
     and (t.grace_days < d.grace_days
          or (t.suspend_on_day is not null and d.suspend_on_day is not null
              and t.suspend_on_day < d.suspend_on_day));
  if s is not null then raise exception 'these tier ladders are harsher than their own default: %', s; end if;

  /* Every case is on a ladder, and on one written for its audience. */
  select count(*) into n from operator_dunning_cases where ladder_id is null;
  if n > 0 then raise exception '% cases are running on no ladder at all', n; end if;

  select count(*) into n from operator_dunning_cases c
    join dunning_ladders l on l.id = c.ladder_id
   where l.audience <> c.account_type;
  if n > 0 then raise exception '% cases are on a ladder written for another audience', n; end if;

  /* The vocabulary is one vocabulary. */
  select count(*) into n from operator_dunning_cases where account_type = 'seller';
  if n > 0 then raise exception '% cases still say "seller" where everything else says "partner"', n; end if;

  /* And the resolution prefers the tier over the default. */
  if dunning_ladder_for('consumer', 'platinum') <> 'DL-CON-PLAT' then
    raise exception 'a platinum retail customer does not resolve to the platinum ladder';
  end if;
  if dunning_ladder_for('consumer', 'bronze') <> 'DL-CON' then
    raise exception 'a bronze retail customer does not fall back to the default ladder';
  end if;
  if dunning_ladder_for('partner', null) <> 'DL-PTR' then
    raise exception 'a seller with no tier does not resolve to the seller default';
  end if;
end $$;
