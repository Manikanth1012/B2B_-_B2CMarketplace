/* Two screens with a help button and nothing behind it.
 *
 * The coverage check found them: `operator/op-numbers` and
 * `enterprise/en-numbers`. The operator one was worse than an oversight — an
 * article was written for it and inserted under `KB-O26`, which the ledger
 * article already had, so the guarded insert correctly did nothing and the
 * whole thing vanished without an error. A `where not exists` on the id it was
 * about to take is a no-op that looks exactly like a success.
 *
 * A help button that opens an empty dialog is worse than no help button. The
 * customer has been told help exists and then shown that it does not.
 */

insert into public.kb_articles
  (id, persona, kind, title, mins, updated, view, roles, tags, summary, body, status, sort_order, personas)
values
  ('KB-O32', 'operator', 'concept', 'Numbers, SIMs and eSIM profiles', 4,
   to_char(current_date, 'DD Mon YYYY'), 'op-numbers',
   /* The same roles the inventory article carries, because the two screens are
      read by the same desks. */
   array['OR-CAT','OR-SUP'], array['numbers','sim','esim','iot'],
   'What the marketplace holds about numbers, and what it deliberately does not.',
   jsonb_build_array(
     jsonb_build_array('A query, not a register',
       'The BSS owns every MSISDN and IMSI, the SIM vendor owns the ICCIDs and the SM-DP+ owns the eSIM profiles. The marketplace holds the blocks it reserved and the numbers it allocated out of them — never a row per free number. A second list of what is free would disagree with the system that actually knows, and the disagreement surfaces as a customer who cannot make a call. Free is arithmetic: the reservation, less what has gone out of it.'),
     jsonb_build_array('Utilisation is against the reservation',
       'Not against the block size. A block of 10,000 with 500 reserved and 500 assigned is full, and reporting it as 5% used is how a team runs out of numbers on a Friday.'),
     jsonb_build_array('The blocks are not interchangeable',
       'An Indian M2M number is thirteen digits and a retail one is ten, and the series are separate precisely so a module''s number cannot be handed to a handset. The assignment form offers only blocks that could serve the request; anything else issues a number that will not register.'),
     jsonb_build_array('A personal line needs a network identity',
       'A marketplace account is not a network subscription. Somebody can sign up, buy a router and never be a telco customer, and a number and a SIM belong to a subscriber — which starts with an identity check the marketplace does not do. The allocation refuses where no telco identity is linked, and refuses a customer under 18 in their own name. Device connectivity bought with an IoT product is a different thing and is not gated by either rule.'),
     jsonb_build_array('A number belongs to one holder',
       'A person or an account, never both — two holders is two answers. Where the number is fitted to a device, the device is the answer to "whose is this": the account is context and the sensor is what somebody is asking about.'),
     jsonb_build_array('Releasing goes to quarantine',
       'Ninety days. A released mobile number handed straight back into the pool sends the previous holder''s calls to whoever gets it next. The screen shows the date it becomes reusable and will not reissue before then.'),
     jsonb_build_array('eSIM profiles follow SGP.22',
       'Released, downloaded, installed, enabled, disabled, deleted — those six and no others. A profile is created released, because claiming it is installed asserts something only the handset knows. Recording a step here records what the SM-DP+ reported; it does not cause it. Deletion is unrecoverable.'),
     jsonb_build_array('A device with a SIM and no number',
       'Reported at the top of the screen. A count of SIMs would report that device as connected; it is a brick until somebody allocates it a number.')
   ),
   'published', 32, array['operator']),

  ('KB-B21', 'enterprise', 'concept', 'Your numbers and SIMs', 3,
   to_char(current_date, 'DD Mon YYYY'), 'en-numbers',
   array['BY-ADMIN','BY-FIN'], array['numbers','sim','iot','devices'],
   'Which SIM is in which device, and what you can change yourself.',
   jsonb_build_array(
     jsonb_build_array('Grouped by device, not by number',
       'A gateway with a SIM and a number in it is one thing on a wall, not two rows in a table. Each row is a device you bought: the sensor, its serial, the SIM fitted to it, the number it answers on, the plan and the order it arrived on.'),
     jsonb_build_array('The serial is how you tell us which one',
       'When something stops reporting, the serial on the label is what identifies it to support. It is the same serial our warehouse despatched, so we can tell you which batch it came from and when.'),
     jsonb_build_array('A SIM with no number is flagged',
       'It means nothing can reach that device. A count of SIMs would call it connected. Raise a ticket and the marketplace will allocate a number.'),
     jsonb_build_array('Changing a number is not self-service',
       'Suspending and releasing are done by the marketplace. Releasing puts a number into a ninety-day quarantine before anybody else can have it, which is not a button worth having on a page where somebody is looking a serial up.'),
     jsonb_build_array('Lines on the account are separate',
       'Voice lines held by the company are listed apart from device connectivity, because they are bought and billed differently.')
   ),
   'published', 21, array['enterprise'])
on conflict (id) do nothing;

do $$
declare
  bad text;
begin
  /* The failure this migration exists to fix: an article inserted under an id
     somebody else already had, guarded by a `where not exists` that made the
     no-op look like a success. So the check is that the article is on the view
     it was written for, not merely that the row exists. */
  select string_agg(v, ', ') into bad from (values ('op-numbers'), ('en-numbers')) as t(v)
   where not exists (
     select 1 from public.kb_articles a
      where a.view = t.v and a.status = 'published'
        and a.title is not null and jsonb_array_length(a.body) >= 3);
  if bad is not null then raise exception 'still no help for: %', bad; end if;

  /* And nothing was overwritten on the way in. */
  if (select view from public.kb_articles where id = 'KB-O26') <> 'op-ledger' then
    raise exception 'the ledger article was displaced';
  end if;
end $$;
