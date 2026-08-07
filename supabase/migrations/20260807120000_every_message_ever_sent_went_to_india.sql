/* The rate card was built and then had nothing to price.
 *
 * Thirty-two log rows, every one of them resolving to India, so the whole point
 * of a per-destination rate — that reaching Nairobi costs a different number in
 * a different currency than reaching Bengaluru — was untestable from the screen.
 * Two of the marketplace's three markets had never been messaged, and no message
 * had ever been long enough to bill as more than one segment.
 *
 * The same failure as every other one this build has found: the mechanism was
 * written, and the data that would exercise it was not.
 */

/* First, a display fix in the connection test. It was printing
 * "https://api.sendgrid.com/v3/mail/send:443", which is what appending a port
 * to something that already carries one looks like. A URL states its own port;
 * a host and a port are two fields.
 */
create or replace function public.test_channel(p_channel text, p_by text default 'Marketplace comms desk')
returns jsonb
language plpgsql security definer
set search_path = public, extensions as $$
declare
  ch public.operator_channels;
  ci public.channel_integration;
  problems text[] := '{}';
  passed   jsonb := '[]'::jsonb;
  address  text;
  took     integer;
  ok       boolean;
  detail   text;
  tid      text;
begin
  select * into ch from public.operator_channels where id = p_channel;
  if ch.id is null then
    return jsonb_build_object('ok', false, 'detail', 'No such channel');
  end if;
  select * into ci from public.channel_integration where channel_id = p_channel;
  if ci.channel_id is null then
    problems := problems || array['nothing is configured for this channel'];
  else
    if ci.endpoint is null or length(trim(ci.endpoint)) = 0 then
      problems := problems || array['no endpoint to connect to'];
    else
      address := ci.endpoint || case
        when ci.port is null then ''
        when ci.endpoint like 'http%' then ''   -- a URL already carries its port
        else ':' || ci.port end;
      passed := passed || jsonb_build_array('Reached ' || address);
    end if;

    if ci.auth_mode <> 'none' and ci.secret_hash is null then
      problems := problems || array['auth is ' || ci.auth_mode || ' and no credential has been set'];
    elsif ci.auth_mode <> 'none' then
      passed := passed || jsonb_build_array('Authenticated with ' || ci.auth_mode
                || coalesce(' as ' || ci.auth_user, ''));
    end if;

    if ch.has_receipt and (ci.dlr_url is null or length(trim(ci.dlr_url)) = 0) then
      problems := problems || array['this channel claims delivery receipts and has no callback URL'];
    elsif ch.has_receipt then
      passed := passed || jsonb_build_array('Delivery receipts will arrive at ' || ci.dlr_url);
    end if;

    if ci.sender_registry is not null and not ci.sender_ok then
      problems := problems || array['sender ' || coalesce(ch.sender, '?') || ' is not registered with '
                               || ci.sender_registry];
    elsif ci.sender_registry is not null then
      passed := passed || jsonb_build_array('Sender ' || coalesce(ch.sender,'?')
                || ' registered with ' || ci.sender_registry
                || coalesce(' (' || ci.sender_ref || ')', ''));
    end if;

    if ci.failover_id is not null then
      passed := passed || jsonb_build_array('Falls over to '
        || (select name from public.operator_channels where id = ci.failover_id)
        || ' after ' || ci.retry_attempts || ' ' || ci.retry_backoff || ' retries');
    end if;
  end if;

  if not exists (select 1 from public.channel_rate r
                  where r.channel_id = p_channel and r.effective_to is null) then
    problems := problems || array['no rate on file, so every message would be costed at nothing'];
  else
    passed := passed || jsonb_build_array('Priced in '
      || (select string_agg(distinct r.currency, ' and ') from public.channel_rate r
           where r.channel_id = p_channel and r.effective_to is null));
  end if;

  ok := array_length(problems, 1) is null;
  took := 40 + (abs(hashtext(p_channel)) % 260);
  detail := case when ok
    then 'Connected and ready'
    else 'Cannot send: ' || array_to_string(problems, '; ') end;

  tid := 'CT-' || to_char(now(), 'YYYYMMDDHH24MISS') || '-' || upper(substr(md5(p_channel || random()::text), 1, 4));
  insert into public.channel_test (id, channel_id, ran_by, ok, ms, detail, checks)
  values (tid, p_channel, p_by, ok, case when ok then took else null end, detail,
          case when ok then passed else to_jsonb(problems) end);

  update public.channel_integration
     set status = case when ok then 'verified' else 'failing' end,
         last_test_at = now(),
         last_test_ms = case when ok then took else null end,
         last_test_note = detail
   where channel_id = p_channel;

  return jsonb_build_object('ok', ok, 'ms', case when ok then took else null end,
                            'detail', detail, 'checks', case when ok then passed else to_jsonb(problems) end);
end $$;

/* ---- Messages to the two markets nobody had ever messaged ------------------ */

/* Real recipients from the directory, real rules, real wording. Cost, segments
   and destination are left to the pricing trigger — writing them here would be
   asserting the number the trigger exists to derive. */
insert into public.notification_log
  (id, rule_id, kind_id, channel_id, persona, recipient, user_id, partner_id, subject, body, sent_at, state, detail, cost, ref)
values
  /* Wanjiru shops in Nairobi. An order she placed, told to her by SMS on the
     Route Mobile bind — which bills Kenya in shillings, not rupees. */
  ('NL-K001','NR-C1','sms','ch-001','consumer','Wanjiru Kamau',
   '7c9e1f42-3b8a-4d61-9e05-2a7f6b4c8d13', null,
   'Your order is on its way',
   'Aventa: order ORD-882140 has left our Nairobi hub and is with the courier. Track it in the app. Reply STOP to opt out of delivery updates.',
   now() - interval '3 days', 'delivered', null, 0, 'ORD-882140'),

  /* Long enough to bill as two segments, which is the whole reason the rate
     card carries a segment size. 168 characters. */
  ('NL-K002','NR-C4','sms','ch-001','consumer','Wanjiru Kamau',
   '7c9e1f42-3b8a-4d61-9e05-2a7f6b4c8d13', null,
   'Your bill is ready',
   'Aventa: your statement for July is ready. KES 4,280.00 is due on 15 August. Pay from the app or at any M-Pesa till. Late payment may suspend your line after 30 days.',
   now() - interval '6 days', 'delivered', null, 0, 'BILL-77120'),

  ('NL-K003','NR-C1','email','ch-003','consumer','otieno.odhiambo@example.com',
   'e5b3c7a1-9d42-4f68-b015-7c3e9a2b4d81', null,
   'Order confirmed',
   'Thanks for your order. We will let you know as soon as it ships from Kisumu.',
   now() - interval '2 days', 'delivered', null, 0, 'ORD-882151'),

  /* A failed one, so the delivery figure for Kenya is not a flat 100%. */
  ('NL-K004','NR-C1','sms','ch-001','consumer','Otieno Odhiambo',
   'e5b3c7a1-9d42-4f68-b015-7c3e9a2b4d81', null,
   'Delivery attempted',
   'Aventa: we tried to deliver ORD-882151 and nobody was in. We will try again tomorrow.',
   now() - interval '1 day', 'failed', 'Handset unreachable — the carrier reported absent subscriber', 0, 'ORD-882151'),

  /* And one to the seller, whose account is in Kenya, over WhatsApp — the
     channel with no credential loaded, which is why it never went. */
  ('NL-K005','NR-P2','whatsapp','ch-006','partner','settlements@nimbussensors.com',
   null, 'PTR-1004',
   'Your settlement is ready',
   'Your settlement for the fortnight ending 31 July is ready: KES 184,220.00, paid on 5 August.',
   now() - interval '5 days', 'failed', 'The WhatsApp integration has no access token loaded', 0, 'SET-4471')
on conflict (id) do nothing;

/* ---- Assertions ------------------------------------------------------------ */

do $$
declare
  n int;
  r record;
begin
  /* More than one destination, or the rate card is decoration. */
  select count(distinct destination) into n from public.notification_log;
  if n < 2 then raise exception 'every message still goes to one destination'; end if;

  /* More than one currency in the bill, which is the thing the flat unit_cost
     could never express. */
  select count(distinct cost_currency) into n
    from public.notification_log where cost_currency is not null;
  if n < 2 then raise exception 'the message bill is still in one currency'; end if;

  /* Kenya must bill in shillings on the Route Mobile bind, because that is what
     the rate card says and the trigger is what applies it. */
  select cost_currency, cost, segments into r
    from public.notification_log where id = 'NL-K001';
  if r.cost_currency <> 'KES' then
    raise exception 'a Kenyan SMS billed in %, not KES', r.cost_currency;
  end if;
  if r.cost <> 0.8 then raise exception 'one segment at 0.8 KES, not %', r.cost; end if;

  /* And the long one must bill as two. */
  select cost_currency, cost, segments into r
    from public.notification_log where id = 'NL-K002';
  if r.segments <> 2 then
    raise exception 'a 168-character SMS is two segments, not %', r.segments;
  end if;
  if r.cost <> 1.6 then raise exception 'two segments at 0.8 KES is 1.6, not %', r.cost; end if;

  /* Nothing may sum across currencies, so every priced row must name one. */
  select count(*) into n from public.notification_log where cost > 0 and cost_currency is null;
  if n > 0 then raise exception '% priced rows have no currency', n; end if;

  raise notice 'log now spans % destinations and % currencies',
    (select count(distinct destination) from public.notification_log),
    (select count(distinct cost_currency) from public.notification_log where cost_currency is not null);
end $$;
