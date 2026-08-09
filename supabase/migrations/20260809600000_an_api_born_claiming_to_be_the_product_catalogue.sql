/* Every API published through the operator's form was born as TMF620.
 *
 * "Publish an API" opened with `standard: 'TMF620'` already filled into a free
 * text box. TMF620 is Product Catalog Management. A shipping API, a payment
 * API, an API for something TM Forum has never standardised — all of them
 * arrive on this screen claiming to be the product catalogue, and stay that
 * way unless whoever is publishing notices a field that already looks
 * answered. A default on an identity claim is not a convenience; it is a
 * wrong answer nobody was asked for.
 *
 * This build has already paid for it once. `20260806500000` found the
 * Inventory API published as **TMF685**, which is Resource Pool Management —
 * a real number for a different API. The right one was TMF687 Stock
 * Management, and the only reason anybody found out is that somebody went
 * looking for the specification file and there wasn't one under that number.
 *
 * A free text box also makes "TMF620", "tmf620", "TMF-620" and "TMF 620" into
 * four standards. Nothing groups, nothing joins, and a developer searching the
 * portal for the catalogue API finds whichever spelling they guessed.
 *
 * So the register becomes a table, and the claim is checked against it.
 *
 * What is deliberately NOT done: constraining `standard` to the register.
 * Not every API a marketplace publishes has a TM Forum standard behind it —
 * two of the seven here are 6D's own implementations — and forcing those into
 * a number would be the TMF685 mistake with more ceremony. The rule is
 * narrower and it is the one the incident actually calls for: *if you name a
 * TMF number, it has to be a TMF number that exists.*
 */

begin;

create table if not exists tmf_standard (
  /* The number as TM Forum writes it, which is the form everything else in
     this schema already uses. Normalisation happens on the way in, so that
     'tmf 620' cannot become a second row for the same standard. */
  code       text primary key,
  name       text not null,
  /* Which of TM Forum's Open API domains it sits in. Not decoration: it is
     what tells somebody publishing a settlement API that they are looking in
     the wrong part of the register. */
  domain     text not null,
  note       text,
  constraint tmf_standard_code_shape check (code ~ '^TMF[0-9]{3}$')
);

alter table tmf_standard enable row level security;

/* Readable by anyone signed in — it is a published register, not a secret,
   and the seller-facing portal names standards too. Writable by nobody
   through the API: TM Forum publishes the register, this marketplace does
   not, and a new entry belongs in a migration where it can be reviewed. */
drop policy if exists tmf_standard_read on tmf_standard;
create policy tmf_standard_read on tmf_standard for select to authenticated using (true);

/* The subset of TM Forum's Open API register a marketplace of this shape
   plausibly publishes against, plus every number already in use here. It is
   not the whole register and does not pretend to be — an API against a
   standard not listed gets a row added in a migration, which is a review
   step rather than an obstacle. */
insert into tmf_standard (code, name, domain) values
  ('TMF620', 'Product Catalog Management',        'Product'),
  ('TMF621', 'Trouble Ticket',                    'Customer'),
  ('TMF622', 'Product Ordering',                  'Product'),
  ('TMF632', 'Party Management',                  'Party'),
  ('TMF633', 'Service Catalog Management',        'Service'),
  ('TMF634', 'Resource Catalog Management',       'Resource'),
  ('TMF635', 'Usage Management',                  'Revenue'),
  ('TMF637', 'Product Inventory Management',      'Product'),
  ('TMF638', 'Service Inventory Management',      'Service'),
  ('TMF639', 'Resource Inventory Management',     'Resource'),
  ('TMF641', 'Service Ordering',                  'Service'),
  ('TMF645', 'Service Qualification',             'Service'),
  ('TMF646', 'Appointment',                       'Customer'),
  ('TMF648', 'Quote Management',                  'Product'),
  ('TMF651', 'Agreement Management',              'Party'),
  ('TMF663', 'Shopping Cart',                     'Product'),
  ('TMF666', 'Account Management',                'Revenue'),
  ('TMF667', 'Document Management',               'Party'),
  ('TMF669', 'Party Role Management',             'Party'),
  ('TMF670', 'Payment Method',                    'Revenue'),
  ('TMF671', 'Promotion Management',              'Product'),
  ('TMF672', 'User Roles and Permissions',        'Party'),
  ('TMF673', 'Geographic Address Management',     'Common'),
  ('TMF674', 'Geographic Site Management',        'Common'),
  ('TMF675', 'Geographic Location',               'Common'),
  ('TMF676', 'Payment Management',                'Revenue'),
  ('TMF677', 'Usage Consumption',                 'Revenue'),
  ('TMF678', 'Customer Bill Management',          'Revenue'),
  ('TMF679', 'Product Offering Qualification',    'Product'),
  ('TMF680', 'Recommendation',                    'Product'),
  ('TMF681', 'Communication Management',          'Customer'),
  ('TMF683', 'Party Interaction Management',      'Party'),
  ('TMF685', 'Resource Pool Management',          'Resource'),
  ('TMF687', 'Stock Management',                  'Resource'),
  ('TMF688', 'Event Management',                  'Common'),
  ('TMF697', 'Work Order Management',             'Resource'),
  ('TMF699', 'Sales Management',                  'Customer'),
  ('TMF700', 'Shipping Order',                    'Product'),
  ('TMF701', 'Process Flow Management',           'Common')
on conflict (code) do update
  set name = excluded.name, domain = excluded.domain;

/* The number that started it, kept in the register with the reason attached.
   Somebody reaching for TMF685 for a stock API is making the exact mistake
   this marketplace already made, and the register is where they will look. */
update tmf_standard
   set note = 'Resource pools — not stock on hand. The Inventory API here was published '
              'against this number by mistake and corrected to TMF687 Stock Management.'
 where code = 'TMF685';

/* ---- The claim, checked ---------------------------------------------------- */

create or replace function public.check_named_standard()
returns trigger language plpgsql as $$
declare v_code text; v_name text;
begin
  /* Anything that does not look like a TMF number is somebody's own API and
     is left alone. 'TMF688 / AsyncAPI' is a real published value here — one
     standard plus a transport — so the check reads every number in the string
     rather than requiring the whole of it to be one. */
  for v_code in
    select distinct 'TMF' || m[1]
      from regexp_matches(new.standard, 'TMF[ -]?([0-9]{3})', 'gi') as m
  loop
    select name into v_name from public.tmf_standard where code = v_code;
    if v_name is null then
      raise exception
        '% is not a TM Forum Open API. Nothing in the register carries that number, '
        'and an API published against one that does not exist is an API whose '
        'specification nobody can look up — which is how the Inventory API spent '
        'a year claiming TMF685. Add it to tmf_standard first, or name what this '
        'actually is.', v_code;
    end if;
  end loop;

  return new;
end $$;

drop trigger if exists z_check_named_standard on public.operator_apis;
create trigger z_check_named_standard
  before insert or update of standard on public.operator_apis
  for each row execute function public.check_named_standard();

/* ---- What has to be true --------------------------------------------------- */

do $$
declare n int; bad text;
begin
  select count(*) into n from public.tmf_standard;
  if n < 30 then raise exception 'the register holds only % standards', n; end if;

  /* Every number already published has to be in the register, or the guard
     that is now on the table would refuse a row the table already holds — a
     rule nothing can satisfy is worse than no rule. */
  select string_agg(format('%s claims %s', id, standard), '; ') into bad
    from public.operator_apis a
   where exists (
     select 1 from regexp_matches(a.standard, 'TMF[ -]?([0-9]{3})', 'gi') m(g)
      where not exists (select 1 from public.tmf_standard s
                         where s.code = 'TMF' || m.g[1]));
  if bad is not null then
    raise exception 'published APIs name standards the register does not hold: %', bad;
  end if;

  /* And the specifications agree with the APIs that carry them. A spec filed
     under TMF687 hanging off an API that says TMF685 is the same defect one
     table along. */
  select string_agg(format('%s: api says %s, spec says %s', s.id, a.standard, s.tmf), '; ')
    into bad
    from public.api_specs s
    join public.operator_apis a on a.id = s.api_id
   where s.tmf !~ '^TMF[0-9]{3}$' or position(s.tmf in a.standard) = 0;
  if bad is not null then
    raise exception 'a specification is filed under a number its API does not claim: %', bad;
  end if;

  /* The guard has to actually refuse. A control nobody has tried to break is
     a sentence in a migration, not a rule — this build has found that same
     shape often enough to stop taking it on trust. */
  begin
    insert into public.operator_apis (id, name, standard, audience, description, why)
    values ('AP-ZZTEST', 'Guard probe', 'TMF999', 'Sellers', 'x', 'x');
    bad := 'it was accepted';
  exception when others then
    /* Refused is not enough — refused BY THIS GUARD is the claim. A missing
       column would refuse it too and would pass a test that only checks that
       something went wrong. */
    bad := case when sqlerrm like '%not a TM Forum Open API%' then null else sqlerrm end;
  end;
  delete from public.operator_apis where id = 'AP-ZZTEST';
  if bad is not null then
    raise exception 'a made-up TMF number did not meet the guard: %', bad;
  end if;

  /* And it has to let through the thing it is not about: an API with no TM
     Forum standard behind it. Two of the seven here are 6D's own. */
  begin
    insert into public.operator_apis (id, name, standard, audience, description, why)
    values ('AP-ZZTEST', 'Guard probe', '6D internal', 'Sellers', 'x', 'x');
    bad := null;
  exception when others then
    bad := sqlerrm;
  end;
  delete from public.operator_apis where id = 'AP-ZZTEST';
  if bad is not null then
    raise exception 'an API that never claimed a TM Forum standard was refused: %', bad;
  end if;
end $$;

commit;
