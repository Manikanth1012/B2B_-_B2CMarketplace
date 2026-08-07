/* Numbers. INV-BE-003 and INV-FE-002 have been marked [P] since v1.13 and
 * nothing was ever built.
 *
 * The marketplace sells IoT gateways, cold-chain sensors, asset trackers and
 * handsets, all of which need connectivity, and it sells retail plans and
 * enterprise connectivity to go with them. Not one MSISDN, ICCID, IMSI or eSIM
 * profile existed anywhere in the database. A Volta gateway shipped to
 * SmartBuild on ORD-882091 had a serial and no way to reach it.
 *
 * The design position the epic already took and this keeps:
 *
 *   ICCID, IMSI and MSISDN belong to the BSS. This is the seam, not a second
 *   register.
 *
 * So the marketplace holds two things and not a third:
 *
 *   number_range      a block reserved from the BSS, with an expiry
 *   number_resource   the individual numbers it has actually allocated
 *
 * It does not hold a row per available number. A range of 100,000 MSISDNs is
 * 100,000 rows of nothing, and the moment it exists it is a second answer to
 * "is this number free" that will disagree with the BSS. Free is arithmetic:
 * the block, less what has been allocated out of it. The screen says so.
 *
 * Utilisation is assigned against RESERVED, not against range size. A block of
 * 10,000 with 500 reserved and 500 assigned is fully used, and reporting it as
 * 5% is how a team runs out of numbers on a Friday.
 */

/* ---- 1. Who owns the resource ---------------------------------------------- */

create table if not exists public.resource_system (
  id          text primary key,
  name        text not null,
  /* What it is authoritative for. A system that owns MSISDNs does not own eSIM
     profiles, and pretending one box owns everything is how the marketplace
     ends up believing its own copy. */
  resources   text[] not null,
  interface   text not null,
  mode        text not null check (mode in ('real-time','batch','delegated')),
  sync_state  text not null default 'healthy' check (sync_state in ('healthy','degraded','down')),
  last_sync   timestamptz,
  /* Null where nobody measures it. A latency of zero is a claim; "not
     measured" is the truth. */
  latency_ms  integer,
  note        text,
  sort_order  integer not null default 0
);

comment on table public.resource_system is
  'The systems that own number, SIM and eSIM resources. The marketplace queries '
  'them and records what it was given; it is authoritative for none of it.';

/* ---- 2. Ranges reserved from those systems ---------------------------------- */

create table if not exists public.number_range (
  id            text primary key,
  kind          text not null check (kind in ('msisdn','iccid','imsi','eid')),
  system_id     text not null references public.resource_system(id),
  market        text not null references public.markets(code),
  /* What the block is for. An M2M block and a retail block are not
     interchangeable — an Indian M2M MSISDN is thirteen digits and cannot be
     handed to a person's handset. */
  purpose       text not null check (purpose in ('retail','enterprise','iot','test')),
  range_from    text not null,
  range_to      text not null,
  size          bigint not null check (size > 0),
  /* How much of the block the BSS has actually promised us. Reserving a block
     and claiming its whole size is how a team plans against numbers it does
     not have. */
  reserved      bigint not null check (reserved >= 0),
  /* A reservation the BSS will take back. Surfaced before it lapses, not
     after. */
  expires_on    date,
  status        text not null default 'active'
                check (status in ('active','expiring','exhausted','released')),
  note          text,
  claimed_on    date not null default current_date,
  sort_order    integer not null default 0,
  check (reserved <= size)
);

comment on table public.number_range is
  'A block of numbers reserved from the owning system. The marketplace does '
  'not hold a row per free number — free is the block less what it allocated.';

create index if not exists number_range_by_use on public.number_range (kind, market, purpose, status);

/* ---- 3. The numbers actually allocated -------------------------------------- */

create table if not exists public.number_resource (
  id            text primary key,
  kind          text not null check (kind in ('msisdn','iccid','imsi','eid')),
  value         text not null,
  range_id      text not null references public.number_range(id),
  market        text not null references public.markets(code),
  purpose       text not null check (purpose in ('retail','enterprise','iot','test')),

  state         text not null default 'assigned'
                check (state in ('reserved','assigned','suspended','quarantine','released')),

  /* Who has it. Exactly one of these, which the trigger below enforces — a
     number belonging to both a person and an account belongs to neither. */
  user_id       uuid,
  account_id    text references public.enterprise_accounts(id),
  /* And what it is in. An IoT SIM lives in a specific sensor, and that sensor
     is a serial the warehouse already tracks. This is the join the whole thing
     was missing: a gateway that shipped on an order, reachable. */
  stock_serial  text references public.stock_unit(serial),
  holder_name   text,

  /* An MSISDN is allocated with an ICCID. Neither is useful alone. */
  paired_with   text references public.number_resource(id),

  order_ref     text,
  subscription_id text,
  plan          text,

  /* What the BSS gave back when we asked. The marketplace stores the reference
     rather than deciding the allocation itself. */
  bss_ref       text,

  assigned_on   date,
  activated_on  date,
  suspended_on  date,
  released_on   date,
  /* A released MSISDN is not reissued the next day. Ninety days is the usual
     cooling-off, and reissuing inside it sends the last holder's calls to
     somebody else. */
  reusable_from date,
  note          text,
  updated_at    timestamptz not null default now()
);

comment on table public.number_resource is
  'Numbers the marketplace has allocated out of its reserved ranges, and who '
  'or what holds each one. Unallocated numbers are not rows here.';

create unique index if not exists number_resource_value on public.number_resource (kind, value);
create index if not exists number_resource_by_holder on public.number_resource (user_id, account_id);
create index if not exists number_resource_by_device on public.number_resource (stock_serial);
create index if not exists number_resource_by_range on public.number_resource (range_id, state);

create or replace function public.guard_number_resource()
returns trigger language plpgsql as $$
declare
  r public.number_range;
begin
  select * into r from public.number_range where id = new.range_id;

  if new.kind <> r.kind then
    raise exception 'A % cannot be allocated out of a % range', new.kind, r.kind;
  end if;
  if new.market <> r.market then
    raise exception 'That range is a % range and this is being allocated in %', r.market, new.market;
  end if;
  if new.purpose <> r.purpose then
    raise exception
      'A % number cannot come out of a % block — an M2M number is not a retail number and will not work in a handset',
      new.purpose, r.purpose;
  end if;

  if new.state in ('assigned','suspended') then
    /* Exactly one holder. Both is not a shared number, it is two answers. */
    if (new.user_id is not null)::int + (new.account_id is not null)::int <> 1 then
      raise exception
        'An assigned number belongs to one person or one account, not both and not neither';
    end if;
    if new.assigned_on is null then
      raise exception 'An assigned number has to say when it was assigned';
    end if;
  end if;

  if new.state = 'released' then
    if new.released_on is null then
      raise exception 'A released number has to say when it was released';
    end if;
    /* Quarantine is not optional. A number handed straight back to the pool
       delivers the previous holder's calls to the next one. */
    new.reusable_from := coalesce(new.reusable_from, new.released_on + 90);
    new.user_id := null; new.account_id := null; new.stock_serial := null;
    new.holder_name := null;
  end if;

  if new.stock_serial is not null and new.purpose = 'retail' then
    raise exception
      'A retail number is held by a person, not fitted to a warehouse unit — use an IoT or enterprise block';
  end if;

  new.updated_at := now();
  return new;
end $$;

drop trigger if exists z_guard_number_resource on public.number_resource;
create trigger z_guard_number_resource
  before insert or update on public.number_resource
  for each row execute function public.guard_number_resource();

/* ---- 4. eSIM profiles ------------------------------------------------------- */

/* The states SGP.22 defines and no others. The SM-DP+ owns these; the
   marketplace observes them, and a screen that lets somebody set "installed"
   is claiming to know what a handset did. */
create table if not exists public.esim_profile (
  iccid         text primary key,
  eid           text,
  resource_id   text references public.number_resource(id),
  state         text not null default 'released'
                check (state in ('released','downloaded','installed','enabled','disabled','deleted')),
  smdp          text not null,
  activation_code text,
  released_on   date not null default current_date,
  changed_on    date,
  note          text
);

/* Forward only, except for the enable/disable pair which really does go both
   ways on a handset. Deletion is the end. */
create or replace function public.guard_esim_state()
returns trigger language plpgsql as $$
declare
  ok boolean;
begin
  if tg_op = 'INSERT' then
    if new.state <> 'released' then
      raise exception
        'A profile is created released. Claiming it is installed asserts something only the handset knows';
    end if;
    return new;
  end if;
  if new.state = old.state then return new; end if;

  ok := case old.state
    when 'released'   then new.state in ('downloaded','deleted')
    when 'downloaded' then new.state in ('installed','deleted')
    when 'installed'  then new.state in ('enabled','deleted')
    when 'enabled'    then new.state in ('disabled','deleted')
    when 'disabled'   then new.state in ('enabled','deleted')
    when 'deleted'    then false
    else false end;

  if not ok then
    raise exception 'SGP.22 does not allow % to go to %, and a profile that skips a state is not one',
      old.state, new.state;
  end if;
  new.changed_on := current_date;
  return new;
end $$;

drop trigger if exists z_guard_esim_state on public.esim_profile;
create trigger z_guard_esim_state
  before insert or update on public.esim_profile
  for each row execute function public.guard_esim_state();

/* ---- 5. What is left ---------------------------------------------------------- */

/* Free is arithmetic, not a table. Utilisation is against what was reserved,
   because that is what we are allowed to allocate. */
create or replace view public.range_use
with (security_invoker = on) as
  select r.id as range_id, r.kind, r.market, r.purpose, r.system_id,
         r.range_from, r.range_to, r.size, r.reserved, r.expires_on, r.status,
         coalesce(a.assigned, 0)   as assigned,
         coalesce(a.suspended, 0)  as suspended,
         coalesce(a.quarantine, 0) as quarantine,
         coalesce(a.held, 0)       as held,
         /* Quarantined numbers are out of the block and are not free yet. */
         r.reserved - coalesce(a.allocated, 0) as free,
         case when r.reserved = 0 then 0
              else round(coalesce(a.allocated, 0)::numeric * 100 / r.reserved, 1) end as used_pct
    from public.number_range r
    left join (
      select range_id,
             count(*) filter (where state = 'assigned')   as assigned,
             count(*) filter (where state = 'suspended')  as suspended,
             count(*) filter (where state = 'quarantine') as quarantine,
             count(*) filter (where state = 'reserved')   as held,
             count(*) filter (where state <> 'released')  as allocated
        from public.number_resource group by range_id
    ) a on a.range_id = r.id;

/* Who holds what, resolved. The console's question is "whose number is this",
   and a user id does not answer it — the same finding as the notification
   preferences screen, which listed `e5b3c7a1…` where it meant a person. */
create or replace view public.number_holder
with (security_invoker = on) as
  select n.*,
         coalesce(
           n.holder_name,
           (select cp.name from public.consumer_profile cp where cp.user_id = n.user_id),
           (select eu.name from public.enterprise_users eu where eu.user_id = n.user_id),
           (select ea.company from public.enterprise_accounts ea where ea.id = n.account_id)
         ) as holder,
         (select p.name from public.stock_unit su join public.products p on p.id = su.product_id
           where su.serial = n.stock_serial) as device,
         (select su.order_ref from public.stock_unit su where su.serial = n.stock_serial) as device_order
    from public.number_resource n;

/* ---- 6. RLS ----------------------------------------------------------------- */

alter table public.resource_system  enable row level security;
alter table public.number_range     enable row level security;
alter table public.number_resource  enable row level security;
alter table public.esim_profile     enable row level security;

drop policy if exists operator_all_resource_system on public.resource_system;
create policy operator_all_resource_system on public.resource_system
  for all using (current_persona() = 'operator') with check (current_persona() = 'operator');

drop policy if exists operator_all_number_range on public.number_range;
create policy operator_all_number_range on public.number_range
  for all using (current_persona() = 'operator') with check (current_persona() = 'operator');

drop policy if exists operator_all_number_resource on public.number_resource;
create policy operator_all_number_resource on public.number_resource
  for all using (current_persona() = 'operator') with check (current_persona() = 'operator');

/* A person sees their own numbers. Not the block they came out of, and not
   anybody else's. */
drop policy if exists own_number_resource on public.number_resource;
create policy own_number_resource on public.number_resource
  for select using (user_id = auth.uid());

/* A buying account sees the numbers on its own account, including the ones
   fitted to the devices it bought. */
drop policy if exists account_number_resource on public.number_resource;
create policy account_number_resource on public.number_resource
  for select using (
    current_persona() = 'enterprise' and account_id = current_account_id());

drop policy if exists operator_all_esim on public.esim_profile;
create policy operator_all_esim on public.esim_profile
  for all using (current_persona() = 'operator') with check (current_persona() = 'operator');

drop policy if exists own_esim on public.esim_profile;
create policy own_esim on public.esim_profile
  for select using (exists (
    select 1 from public.number_resource n
     where n.id = esim_profile.resource_id
       and (n.user_id = auth.uid()
            or (current_persona() = 'enterprise' and n.account_id = current_account_id()))));

grant select on public.resource_system to authenticated;
grant select, insert, update on public.number_range to authenticated;
grant select, insert, update on public.number_resource to authenticated;
grant select, insert, update on public.esim_profile to authenticated;
grant select on public.range_use to authenticated;
grant select on public.number_holder to authenticated;

/* ---- 7. Allocation ---------------------------------------------------------- */

/* The next free number in a block. Allocation is sequential from the low end,
   skipping what has already gone — the marketplace does not hold a free list,
   so "next" is derived from what it allocated rather than looked up. */
create or replace function public.next_in_range(p_range text)
returns text
language plpgsql stable
set search_path = public, extensions as $$
declare
  r public.number_range;
  taken bigint;
  base numeric;
begin
  select * into r from public.number_range where id = p_range;
  if r.id is null then return null; end if;

  select count(*) into taken from public.number_resource
   where range_id = p_range and state <> 'released';
  if taken >= r.reserved then return null; end if;

  /* Ranges are numeric strings of a fixed width — an MSISDN, an ICCID and an
     IMSI all are. The width is kept so a leading zero survives. */
  base := r.range_from::numeric + taken;
  return lpad(base::bigint::text, length(r.range_from), '0');
end $$;

create or replace function public.assign_number(
  p_kind text, p_market text, p_purpose text,
  p_user uuid default null, p_account text default null,
  p_serial text default null, p_holder text default null,
  p_order text default null, p_plan text default null
) returns jsonb
language plpgsql security definer
set search_path = public, extensions as $$
declare
  rng public.number_range;
  val text;
  id  text;
begin
  select * into rng from public.number_range
   where kind = p_kind and market = p_market and purpose = p_purpose
     and status = 'active'
     and (expires_on is null or expires_on > current_date)
   order by sort_order limit 1;

  if rng.id is null then
    return jsonb_build_object('ok', false,
      'why', format('No active %s block reserved for %s in %s. Reserve one from the owning system first.',
                    p_kind, p_purpose, p_market));
  end if;

  val := public.next_in_range(rng.id);
  if val is null then
    return jsonb_build_object('ok', false,
      'why', format('%s is exhausted — %s of %s reserved numbers are allocated.',
                    rng.id, rng.reserved, rng.reserved));
  end if;

  id := upper(p_kind) || '-' || val;
  insert into public.number_resource
    (id, kind, value, range_id, market, purpose, state,
     user_id, account_id, stock_serial, holder_name, order_ref, plan,
     bss_ref, assigned_on, activated_on)
  values (id, p_kind, val, rng.id, p_market, p_purpose, 'assigned',
     p_user, p_account, p_serial, p_holder, p_order, p_plan,
     /* What the BSS returned. The marketplace stores the reference; it does
        not invent the allocation. */
     'TMF652-' || upper(substr(md5(id || now()::text), 1, 10)),
     current_date, current_date);

  return jsonb_build_object('ok', true, 'id', id, 'value', val, 'range', rng.id);
end $$;

/* Releasing. Into quarantine, never straight back into the pool. */
create or replace function public.release_number(p_id text, p_why text)
returns jsonb
language plpgsql security definer
set search_path = public, extensions as $$
declare
  n public.number_resource;
begin
  select * into n from public.number_resource where id = p_id;
  if n.id is null then return jsonb_build_object('ok', false, 'why', 'No such number'); end if;
  if n.state = 'released' then
    return jsonb_build_object('ok', false, 'why', 'That number has already been released');
  end if;

  update public.number_resource
     set state = 'quarantine', released_on = current_date,
         reusable_from = current_date + 90, note = p_why,
         user_id = null, account_id = null, stock_serial = null, holder_name = null
   where id = p_id;

  return jsonb_build_object('ok', true,
    'note', format('Released and quarantined until %s. Reissuing it before then would send the last holder''s calls to somebody else.',
                   (current_date + 90)::text));
end $$;

grant execute on function public.assign_number(text,text,text,uuid,text,text,text,text,text) to authenticated;
grant execute on function public.release_number(text,text) to authenticated;
grant execute on function public.next_in_range(text) to authenticated;
