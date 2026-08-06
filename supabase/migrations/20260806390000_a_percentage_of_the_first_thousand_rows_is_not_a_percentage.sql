/* A percentage of the first thousand rows is not a percentage.
 *
 * Both developer-portal screens computed their figures — call volume, success
 * rate, average round trip, busiest day — by fetching rows from `api_call_log`
 * and counting them in the browser. PostgREST caps a response at a thousand
 * rows. There are more than a thousand calls. So the operator's traffic panel
 * read "Across 1,000 recorded calls" under a heading claiming to describe all
 * of them, and every percentage beneath it was computed from whichever
 * thousand came back first.
 *
 * It is the same fault as a stored total with no rows behind it, arriving from
 * the other direction: rows with no total behind them. The answer is the same.
 * Aggregate in the database, where the aggregate can see everything.
 *
 * `api_call_rollup` is one row per application, environment, version, status
 * code and day. That is small enough to fetch whole — a few hundred rows for
 * this marketplace — and every figure the screens show is a sum over it rather
 * than a count of what fitted in a page. The busiest day, which is the number a
 * daily quota is actually compared against, becomes computable at all; from a
 * truncated sample it was not.
 */

begin;

create or replace view api_call_rollup
with (security_invoker = on) as
select
  l.application_id,
  l.environment,
  l.version_id,
  l.api_id,
  l.status_code,
  l.called_at::date as on_day,
  count(*)::int     as calls,
  /* Summed rather than averaged here: an average of averages weighted by
     nothing is not the average. The caller divides by `calls`. */
  sum(l.ms)::bigint as total_ms
from api_call_log l
group by 1, 2, 3, 4, 5, 6;

grant select on api_call_rollup to authenticated;

do $$
declare rollup_total bigint; log_total bigint;
begin
  select sum(calls) into rollup_total from api_call_rollup;
  select count(*)   into log_total    from api_call_log;
  if rollup_total is distinct from log_total then
    raise exception 'the rollup accounts for % calls and the log holds %', rollup_total, log_total;
  end if;
end $$;

commit;
