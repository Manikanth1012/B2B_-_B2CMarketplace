/* Bank details on file for a gate nobody opened.
 *
 * Two applicants hold a settlement account on the marketplace's record for a
 * gate they have not reached:
 *
 *   Lumen Wearables is at Agreements; Bank & tax is the gate after it.
 *   Orbital Connect failed KYC at gate two and was rejected. It never got
 *   within three gates of being asked for an account.
 *
 * The seed gave every partner bank details regardless of where they had got
 * to, which made the onboarding rail describe a journey the rest of the record
 * contradicted — and, worse, meant the marketplace was holding an account
 * number for a company it had refused. Nobody asked those two for one. Not
 * asking and having it anyway is the version of this that matters.
 *
 * So the rows go, and a trigger stops it recurring. Details may be written
 * once the gate is open — `current` — because that is when the applicant is
 * asked for them, and the gate clears after they are checked, not before.
 */

begin;

delete from partner_bank b
 where exists (
   select 1 from onboarding_gates g
    where g.partner_id = b.partner_id
      and g.gate_name = 'Bank & tax'
      and g.status = 'pending'
 );

create or replace function guard_bank_before_its_gate()
returns trigger language plpgsql set search_path = public as $fn$
declare gate_state text;
begin
  select status into gate_state from onboarding_gates
   where partner_id = new.partner_id and gate_name = 'Bank & tax';

  /* A partner with no ladder at all is one of the originals, which predate
     onboarding being modelled. Nothing to check against. */
  if gate_state is null then return new; end if;

  if gate_state = 'pending' then
    raise exception 'Bank details cannot be held for % — the Bank & tax gate has not opened yet, so nobody has asked for them.',
      new.partner_id;
  end if;

  return new;
end $fn$;

drop trigger if exists z_guard_bank_before_its_gate on partner_bank;
create trigger z_guard_bank_before_its_gate
  before insert or update on partner_bank
  for each row execute function guard_bank_before_its_gate();

do $$
declare n int;
begin
  select count(*) into n from partner_bank b
   join onboarding_gates g on g.partner_id = b.partner_id and g.gate_name = 'Bank & tax'
   where g.status = 'pending';
  if n > 0 then raise exception '% sellers still have an account on file for a gate they never reached', n; end if;

  /* And the clean-up must not have taken the money away from anybody trading. */
  select count(*) into n from partners p
   where p.status in ('live', 'suspended')
     and not exists (select 1 from partner_bank b where b.partner_id = p.id);
  if n > 0 then raise exception '% trading sellers now have nowhere to be paid', n; end if;
end $$;

commit;
