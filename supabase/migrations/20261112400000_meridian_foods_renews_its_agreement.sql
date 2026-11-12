/*
 * Meridian Foods renews its agreement.
 *
 * ENT-2012's first agreement, CTR-2012-01, ran from 1 Sep 2025 to 31 Aug 2026
 * and does not roll over. Nobody renewed it, so since 1 Sep 2026 the account
 * has had nothing in force: it cannot raise a requisition, and the register
 * says a trading account is buying on nobody's authority.
 *
 * This records the renewal an operator would make in the console
 * (`renew_contract`), dated the day it is made rather than backdated over the
 * gap: the lapse happened, and the register should say so. CTR-2012-02 runs
 * from 12 Nov 2026 to 11 Nov 2027 on the same terms, currency, value and
 * signatory; CTR-2012-01 is pointed at it and, being past its term, reads
 * superseded.
 *
 * It also removes CTR-2012-03 ("Another", signed by "x", titled "y", no signed
 * copy): debris from the contracts integration test. That test's last step
 * tries to renew an agreement already renewed and expects a refusal; on a run
 * where the earlier step had failed, the call succeeded instead, and the
 * clean-up only knew about CTR-2012-02. Removed only if it is exactly that row
 * and nothing points at it. The test now works from whatever is in force and
 * cleans up both ids it uses.
 *
 * The signed copy is a file, which SQL cannot write. The row points at
 * `ENT-2012/contracts/CTR-2012-02.pdf`; `scripts/make-agreement-copy.ts`
 * (operator sign-in) writes and uploads it afterwards.
 *
 * Idempotent, one transaction, ends with a self-check.
 */

begin;

do $$
begin
  if not exists (select 1 from public.enterprise_contract
                  where id = 'CTR-2012-01' and account_id = 'ENT-2012' and ends_on = date '2026-08-31') then
    raise exception 'CTR-2012-01 is not the Meridian Foods agreement ending 31 Aug 2026 this file expects';
  end if;
  if exists (select 1 from public.enterprise_contract where id = 'CTR-2012-03'
              and not (title = 'Another' and signed_by = 'x' and document_path is null)) then
    raise exception 'CTR-2012-03 is not the test debris this file removes; look at it before going on';
  end if;
end $$;

/* The debris, and only if nothing refers to it. */
delete from public.enterprise_contract c
 where c.id = 'CTR-2012-03' and c.title = 'Another' and c.signed_by = 'x' and c.document_path is null
   and not exists (select 1 from public.enterprise_contract o where o.superseded_by = c.id)
   and not exists (select 1 from public.enterprise_contract_amendment a where a.contract_id = c.id);

/* The renewal: what renew_contract writes, plus the signed copy's path. */
insert into public.enterprise_contract (
  id, account_id, title, signed_on, starts_on, ends_on, terms, currency,
  auto_renew, notice_days, term_value, signed_by, signed_title, countersigned_by,
  document_name, document_path, state, note, sort_order)
select 'CTR-2012-02', c.account_id, 'Master services agreement 2026–2027',
       date '2026-11-12', date '2026-11-12', date '2027-11-11', c.terms, c.currency,
       false, 30, c.term_value, c.signed_by, c.signed_title, 'Anika Sharma',
       'CTR-2012-02.pdf', 'ENT-2012/contracts/CTR-2012-02.pdf', 'active',
       'Renewed after a lapse. The first term ended on 31 Aug 2026 without a renewal in place, so purchasing on account was paused from 1 Sep 2026 until this term began.',
       c.sort_order + 1
  from public.enterprise_contract c
 where c.id = 'CTR-2012-01'
on conflict (id) do nothing;

update public.enterprise_contract
   set superseded_by = 'CTR-2012-02',
       state = case when current_date > ends_on then 'superseded' else state end
 where id = 'CTR-2012-01' and superseded_by is null;

/* ============================================================ self-check === */

do $$
declare n int;
begin
  if public.contract_in_force('ENT-2012') is distinct from 'CTR-2012-02' then
    raise exception 'Meridian Foods holds % in force, not CTR-2012-02', coalesce(public.contract_in_force('ENT-2012'), 'nothing');
  end if;
  if exists (select 1 from public.enterprise_contract where id = 'CTR-2012-03') then
    raise exception 'CTR-2012-03 is still in the register';
  end if;
  if not exists (select 1 from public.enterprise_contract
                  where id = 'CTR-2012-01' and superseded_by = 'CTR-2012-02' and state = 'superseded') then
    raise exception 'CTR-2012-01 does not read superseded by CTR-2012-02';
  end if;

  select count(*) into n from (
    select account_id from public.enterprise_contract
     where state = 'active' and current_date between starts_on and ends_on
     group by account_id having count(*) > 1) t;
  if n <> 0 then raise exception '% accounts hold more than one live agreement', n; end if;

  select count(*) into n from public.enterprise_accounts a
   where a.status = 'active' and public.contract_in_force(a.id) is null;
  if n <> 0 then raise exception '% trading accounts have nothing in force', n; end if;
end $$;

commit;
