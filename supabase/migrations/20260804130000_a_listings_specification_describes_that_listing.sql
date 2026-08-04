/*
  # A listing's specification describes that listing

  The business catalogue's detail view now shows `products.specs`, and the first
  listing opened made the problem obvious: the Kestrel K7, described as an
  "entry 4G handset with a 6.1-inch screen", specifies a 6.7-inch AMOLED at
  120 Hz on 5G SA/NSA. So does the K9 Lite, described at 6.4 inches. All three
  handsets carry one identical specification block copied from the flagship.

  Ten spec blocks are shared by more than one listing. Some of those sharings
  are correct — three sensors in one family really do have the same operating
  range and ingress rating — and this migration leaves those alone. What it
  fixes is every case where the specification contradicts the description
  beside it, because a buyer comparing two listings on a spec table that is the
  same table twice cannot tell them apart, and the one who orders on it gets a
  different thing from the one they read about.

  1. The three handsets
     K9 Pro keeps the flagship block, which was always its own. K9 Lite and K7
     get specifications matching what they are sold as.

  2. The three mobile plans
     Freedom 50 GB, Freedom Unlimited and the travel eSIM shared one block that
     mentioned neither an allowance nor a destination count, so nothing on the
     page distinguished a 50 GB contract plan from a 10 GB travel eSIM.

  3. Streaming, gaming and reseller tiers
     Standard was specified at 4K on four screens while its description says HD
     on two; the sports add-on carried the base tier's block; the loot crate
     carried the cloud-gaming block; the season pass likewise. The two Halo
     tiers differed by six seats and shared a block saying "Seats: Six".

  4. The watch
     Described at seven days, specified at nine. Seven is what the listing
     promises, so nine is what has to go — a specification a buyer can hold you
     to is the one you would rather be conservative in.

  Every change is a spec catching up with the sentence a buyer already reads.
  No description is edited to match a spec, because the description is what was
  sold.
*/

/* ------------------------------------------------------------ handsets --- */

update products set specs = jsonb_build_object(
  'Screen',   '6.4 in AMOLED, 90 Hz',
  'Network',  '5G SA/NSA',
  'Battery',  '5000 mAh — two days typical',
  'Charging', '25 W wired',
  'Camera',   'Dual: 50 MP main + 8 MP ultra-wide',
  'SIM',      'Dual eSIM + nano',
  'Warranty', '24 months'
) where id = 'SKU-4002';

update products set specs = jsonb_build_object(
  'Screen',   '6.1 in IPS, 60 Hz',
  'Network',  '4G LTE Cat-6',
  'Battery',  '5000 mAh',
  'Charging', '15 W wired',
  'Camera',   'Single: 13 MP',
  'SIM',      'Dual nano',
  'Warranty', '24 months'
) where id = 'SKU-4003';

/* The K9 Pro's description names a triple camera and its block never did. */
update products set specs = specs || jsonb_build_object(
  'Camera', 'Triple: 50 MP main + 12 MP ultra-wide + 10 MP telephoto'
) where id = 'SKU-4001';

/* -------------------------------------------------------------- plans ---- */

update products set specs = jsonb_build_object(
  'Allowance', '50 GB a month',
  'Calls and SMS', 'Unlimited in-market',
  'Network',   '5G where available',
  'Contract',  '30-day rolling',
  'Roaming',   'India, UAE and Kenya included',
  'Tethering', 'Included'
) where id = 'SKU-2001';

update products set specs = jsonb_build_object(
  'Allowance', 'Unlimited',
  'Fair use',  'Unlimited at 5 Mbps after 100 GB',
  'Calls and SMS', 'Unlimited in-market',
  'Network',   '5G where available',
  'Contract',  '30-day rolling',
  'Roaming',   '30 GB across 42 countries',
  'Tethering', 'Included'
) where id = 'SKU-2002';

update products set specs = jsonb_build_object(
  'Allowance',    '10 GB, data only',
  'Valid for',    '30 days from activation',
  'Destinations', '62',
  'Delivery',     'QR code, issued instantly',
  'Network',      '5G where available',
  'Contract',     'None — it expires'
) where id = 'SKU-2003';

/* ---------------------------------------------------------- streaming ---- */

update products set specs = jsonb_build_object(
  'Quality',   'Up to 1080p HD',
  'Screens',   'Two at once',
  'Profiles',  'Six',
  'Downloads', 'Yes, 10 titles',
  'Advertising', 'Limited breaks',
  'Contract',  '30-day rolling'
) where id = 'SKU-3002';

update products set specs = jsonb_build_object(
  'Quality',   'Up to 1080p60',
  'Coverage',  'Live league fixtures',
  'Requires',  'Any StreamNova subscription',
  'Screens',   'Two at once',
  'Contract',  '30-day rolling'
) where id = 'SKU-3008';

/* ------------------------------------------------------------- gaming ---- */

update products set specs = jsonb_build_object(
  'Runs for',  'Ninety days',
  'Includes',  'Premium title rotation plus in-game currency',
  'Redeemed',  'By code, once',
  'Devices',   'Console, PC, mobile',
  'Contract',  'None — it expires'
) where id = 'SKU-3004';

update products set specs = jsonb_build_object(
  'Contents',  'Randomised, drawn at purchase',
  'Redeemed',  'By code, once',
  'Devices',   'Console, PC, mobile',
  'Refunds',   'Not refundable once drawn',
  'Contract',  'None — a single purchase'
) where id = 'SKU-3009';

/* -------------------------------------------------------------- music ---- */

update products set specs = jsonb_build_object(
  'Seats',    'One',
  'Quality',  'Lossless up to 24-bit',
  'Offline',  'Unlimited downloads',
  'Contract', '30-day rolling'
) where id = 'SKU-3006';

/* ---------------------------------------------------------- reseller ----- */

update products set specs = jsonb_build_object(
  'Lines',        'Five hundred',
  'Rated at',     'Wholesale, resold on your own tariff',
  'Branding',     'White label',
  'Support',      'Tier 1 by the reseller',
  'Provisioning', 'Partner API',
  'Contract',     '12 months'
) where id = 'SKU-7002';

update products set specs = jsonb_build_object(
  'Lines',        'Five hundred, data only',
  'Rated at',     'Wholesale, resold on your own tariff',
  'Branding',     'White label',
  'Support',      'Tier 1 by the reseller',
  'Provisioning', 'Partner API',
  'Contract',     '12 months'
) where id = 'SKU-7004';

/* --------------------------------------------------------- IoT connect --- */

update products set specs = jsonb_build_object(
  'Allowance',  '500 MB per SIM per month, pooled',
  'Minimum',    '25 SIMs',
  'Network',    'NB-IoT / LTE-M',
  'Coverage',   'India, UAE, Kenya',
  'Security',   'Private APN with IMEI lock',
  'Activation', 'API or portal',
  'Contract',   '12 months'
) where id = 'SKU-5001';

update products set specs = jsonb_build_object(
  'Allowance',  '2 GB per SIM per month, pooled',
  'Network',    'NB-IoT / LTE-M',
  'Roaming',    '38 networks',
  'Coverage',   'India, UAE, Kenya',
  'Activation', 'API or portal',
  'Contract',   '12 months'
) where id = 'SKU-5002';

/* ---------------------------------------------------------- insurance ---- */

/* Device cover and travel cover shared one block, so the travel policy claimed
   to cover accidental damage to a handset. It also quoted "$29 per claim" on a
   marketplace whose default market is India — the description already says the
   excess is set per market, which is the true and currency-free statement. */
update products set specs = jsonb_build_object(
  'Cover',       'Accidental damage, screen repair and theft',
  'Applies to',  'One handset, named on the policy',
  'Claims',      'Two in twelve months',
  'Excess',      'Set for your market, shown before you confirm',
  'Cooling-off', '14 days',
  'Underwriter', 'Aegis Assurance'
) where id = 'SKU-2004';

update products set specs = jsonb_build_object(
  'Cover',       'Medical and baggage, single trip',
  'Applies to',  'One traveller, bought alongside a travel eSIM',
  'Sum insured', 'Set for your market, shown before you confirm',
  'Excess',      'Set for your market, shown before you confirm',
  'Cooling-off', '14 days',
  'Underwriter', 'Aegis Assurance'
) where id = 'SKU-2005';

/* -------------------------------------------------------------- other ---- */

/* Sold as seven days, specified as nine. Seven is the promise. */
update products set specs = specs || jsonb_build_object('Battery', '7 days typical')
 where id = 'SKU-4007';

/* The sensors legitimately share an environmental block — same family, same
   cell, same enclosure — but each measures something different, and nothing on
   the page said which. */
update products set specs = specs || jsonb_build_object('Measures', 'Temperature and relative humidity', 'Ingress', 'IP67')
 where id = 'SKU-5003';
update products set specs = specs || jsonb_build_object('Measures', 'People count, no imaging')
 where id = 'SKU-5004';
update products set specs = specs || jsonb_build_object('Measures', 'PM2.5, PM10 and CO₂')
 where id = 'SKU-5009';

do $$
declare
  n integer;
  r record;
begin
  /* No two listings whose descriptions differ may still carry an identical
     specification, unless they are the sensor family that genuinely shares one
     — and those now differ on `Measures`. */
  select count(*) into n from (
    select specs::text from products
     where specs is not null and specs::text <> '{}'
       and category_id in ('device', 'consumer', 'content', 'partner')
     group by 1 having count(*) > 1
  ) x;
  if n > 0 then
    raise exception '% specification blocks are still shared by two listings that are not the same thing', n;
  end if;

  /* The three handsets are the case that started this. Each screen size in the
     spec has to appear in the description that sells it. */
  for r in select id, description, specs->>'Screen' as screen from products
            where id in ('SKU-4001', 'SKU-4002', 'SKU-4003') loop
    if r.screen is null then
      raise exception '% has no screen in its specification', r.id;
    end if;
    if position(split_part(r.screen, ' ', 1) in r.description) = 0 then
      raise exception '% is specified at % and described as "%"', r.id, r.screen, r.description;
    end if;
  end loop;

  /* Every enterprise listing carries a specification, because the business
     catalogue's detail view now shows one and an empty panel on a listing
     somebody is about to requisition is worse than no panel. */
  select count(*) into n from products
   where 'enterprise' = any(audiences) and status = 'live'
     and (specs is null or specs::text = '{}');
  if n > 0 then
    raise exception '% live business listings have no specification', n;
  end if;
end $$;
