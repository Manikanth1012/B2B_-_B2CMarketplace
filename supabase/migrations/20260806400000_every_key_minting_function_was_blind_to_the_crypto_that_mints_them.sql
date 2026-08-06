/* Every key-minting function was blind to the crypto that mints them.
 *
 * `register_application`, `rotate_credential` and `decide_production_access`
 * all declare `set search_path = public`. That is right for the reason it was
 * written — a security-definer function that inherits the caller's search path
 * can be made to call the caller's tables instead of the marketplace's. But it
 * is a *replacement*, not an addition, and pgcrypto lives in `extensions` on
 * this deployment. So the moment any of them reached `gen_random_bytes`,
 * `gen_salt` or `crypt`, Postgres could not see the function.
 *
 * None of this showed up when the migrations ran. Their assertions execute in a
 * session whose own search path already includes `extensions`, so `mint_secret`
 * worked there and every check passed. It only failed where it mattered: a
 * seller pressing "Register and issue sandbox keys" in the browser got
 *
 *     function gen_random_bytes(integer) does not exist
 *
 * which is the same fault this marketplace keeps producing — the function was
 * written, the screen was built, and the path the persona actually takes was
 * never walked. A migration that asserts against itself is not a test of the
 * thing a user does.
 *
 * The fix is to name both schemas. `public, extensions` still pins the path —
 * a caller cannot inject their own schema ahead of it — while letting the
 * crypto be found. `mint_secret` had no `search_path` at all and inherited
 * whatever its caller had, which is how it appeared to work in one place and
 * not the other; it gets the same explicit path so it behaves identically
 * wherever it is called from.
 */

begin;

alter function mint_secret(text)                        set search_path = public, extensions;
alter function register_application(text, text, text, text) set search_path = public, extensions;
alter function subscribe_application(text, text, text, text[], text) set search_path = public, extensions;
alter function decide_production_access(text, boolean, text)  set search_path = public, extensions;
alter function rotate_credential(text, int)             set search_path = public, extensions;
alter function revoke_credential(text, text)            set search_path = public, extensions;
alter function sandbox_call(text, text, jsonb)          set search_path = public, extensions;

do $$
declare
  missing text;
begin
  /* Every function that touches pgcrypto must be able to see it. Reading the
     stored setting rather than calling the function, because calling it from
     here would pass for the same reason it passed before. */
  select string_agg(p.proname, ', ') into missing
    from pg_proc p
   where p.proname in ('mint_secret', 'register_application', 'decide_production_access',
                       'rotate_credential', 'sandbox_call')
     and not coalesce(array_to_string(p.proconfig, ',') like '%search_path=public, extensions%', false);
  if missing is not null then
    raise exception 'these still cannot see pgcrypto: %', missing;
  end if;
end $$;

commit;
