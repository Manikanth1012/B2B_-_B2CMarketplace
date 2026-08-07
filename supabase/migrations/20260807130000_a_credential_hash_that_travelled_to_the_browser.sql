/* The integration record was readable in full, and "in full" included
 * `secret_hash`.
 *
 * An integration test caught it: `select *` on `channel_integration` returned
 * the sha256 of every gateway credential to the browser. A hash is not a
 * secret, but it is the thing a secret is checked against — hand it out and a
 * weak credential is offline-crackable, and there is no reason a screen ever
 * needs it. The screen shows the last four characters and the date it was set,
 * which is everything a desk needs to answer "which key is loaded".
 *
 * Fixing this in the query would only fix the query. Any other caller —
 * a future screen, a script, somebody in the API console — would get the hash
 * again. So the grant is narrowed instead: `authenticated` may select every
 * column of this table except that one. `set_channel_secret` and `test_channel`
 * are security definer and keep working, which is the only access the hash
 * needs.
 */

revoke select on public.channel_integration from authenticated;

grant select (
  channel_id, endpoint, port, auth_mode, auth_user,
  secret_hint, secret_set_on,
  sender_registry, sender_ref, sender_ok, dlr_url,
  timeout_ms, retry_attempts, retry_backoff, retry_after_ms,
  failover_id, status, last_test_at, last_test_ms, last_test_note,
  note, updated_at
) on public.channel_integration to authenticated;

/* Writes stay whole-table: a form saves the address and the retry policy, and
   the hash is not among the columns any form sends. */
grant insert, update, delete on public.channel_integration to authenticated;

do $$
declare
  has_hash boolean;
begin
  select bool_or(a.attname = 'secret_hash') into has_hash
    from information_schema.column_privileges p
    join pg_attribute a on a.attname = p.column_name
    join pg_class c on c.oid = a.attrelid and c.relname = 'channel_integration'
   where p.table_name = 'channel_integration'
     and p.grantee = 'authenticated'
     and p.privilege_type = 'SELECT';
  if coalesce(has_hash, false) then
    raise exception 'authenticated can still read secret_hash';
  end if;

  /* And the columns a screen actually needs must still be readable, or the
     fix has broken the thing it was protecting. */
  if not exists (
    select 1 from information_schema.column_privileges
     where table_name = 'channel_integration' and grantee = 'authenticated'
       and privilege_type = 'SELECT' and column_name = 'secret_hint') then
    raise exception 'the hint is what the screen shows and it is no longer readable';
  end if;
end $$;
