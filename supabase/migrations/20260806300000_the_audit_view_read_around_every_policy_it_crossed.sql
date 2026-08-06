/* The audit view read around every policy it crossed.
 *
 * `market_consistency` was created without `security_invoker`, which in
 * Postgres means it runs with its owner's rights and ignores row-level
 * security on all nine tables it reads. It was granted to `authenticated`.
 *
 * So any signed-in customer could have selected from it and read other
 * people's order references and names, every seller's settlement figures, and
 * every enterprise account's invoices — through a view whose whole purpose is
 * to be reassuringly empty. An empty result today is not a defence: the view
 * returns rows precisely when something is wrong, which is when the detail is
 * most worth reading and least fit to be public.
 *
 * `security_invoker = on` makes it read as whoever queries it. The operator's
 * own policies already reach all nine tables, so the marketplace console sees
 * exactly what it saw before; a customer now sees the same view resolve against
 * their own rows and find nothing, which is the correct answer to a question
 * they should not be able to ask on anybody else's behalf.
 */

begin;

alter view market_consistency set (security_invoker = on);

do $$
declare opts text[];
begin
  select reloptions into opts from pg_class where relname = 'market_consistency';
  if opts is null or not ('security_invoker=on' = any(opts)) then
    raise exception 'the audit view still reads with its owner''s rights';
  end if;
end $$;

commit;
