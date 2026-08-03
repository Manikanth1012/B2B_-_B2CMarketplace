-- One more sentence, and the reason I did not find it.
--
-- `20260802300000_the_threshold_in_the_prose.sql` swept the business account's
-- stored prose for dollar figures and ended with an assertion over seven text
-- columns. It passed. The credit-limit sentence on `enterprise_onboarding` was
-- not one of the seven:
--
--   "A limit of $120,000 on net 30, set from two years of filed accounts and one
--    trade reference."
--
-- against a limit that is now ₹1,00,00,000.
--
-- That is the third time in this run of migrations that an assertion has been
-- given a hand-written range and passed over the set I chose rather than the set
-- that exists — first a list of two function names that missed
-- `reverse_movement`, then a list of seven columns that missed this. The check
-- at the foot of this file walks `information_schema` instead: every text column
-- on every table whose name starts `enterprise_`, found rather than listed, so
-- the next column somebody adds is covered before it is added.

/* The sentence, rewritten from the limit actually on file. */
update enterprise_onboarding o set
  detail = regexp_replace(o.detail, '\$[0-9,]+(\.[0-9]+)?',
                          money_text(b.credit_limit, b.currency), 'g')
  from enterprise_billing b
 where b.account_id = o.account_id and o.detail ~ '\$[0-9]';

/* -------------------------------------------------------- sanity checks -- */
do $$
declare
  col   record;
  hits  integer;
  found text := '';
  looked integer := 0;
begin
  /* Every text column on every enterprise table, discovered rather than
     remembered. */
  for col in
    select c.table_name, c.column_name
      from information_schema.columns c
      join information_schema.tables t
        on t.table_schema = c.table_schema and t.table_name = c.table_name
     where c.table_schema = 'public'
       and t.table_type = 'BASE TABLE'
       and c.table_name like 'enterprise\_%'
       and c.data_type in ('text', 'character varying')
  loop
    execute format('select count(*) from %I where %I ~ ''\$[0-9]''',
                   col.table_name, col.column_name) into hits;
    looked := looked + 1;
    if hits > 0 then
      found := found || format('%s.%s (%s rows); ', col.table_name, col.column_name, hits);
    end if;
  end loop;

  if found <> '' then
    raise exception 'these stored sentences still quote dollars: %', found;
  end if;

  /* And it had something to walk. A loop over an empty list reports clean for
     the wrong reason, which is the whole subject of this migration. */
  if looked < 20 then
    raise exception 'only % text columns were searched — the sweep is not finding them', looked;
  end if;

  raise notice 'searched % text columns across the business tables', looked;
end $$;
