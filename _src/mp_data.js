/* ===========================================================================
   Telecom Marketplace — synthetic dataset.
   Deterministic, shared by all four persona files, so GMV, commission,
   settlement and order counts reconcile whichever portal you open.

   Scope guardrail: catalogue-driven commerce only. No SD-WAN, no MPLS,
   no CPQ / configure-price-quote journeys anywhere in this dataset.
   =========================================================================== */

function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}
const rnd = mulberry32(20260725);
const pick = a => a[Math.floor(rnd()*a.length)];
const ri = (a,b)=> a+Math.floor(rnd()*(b-a+1));
const rf = (a,b,d)=> +(a+rnd()*(b-a)).toFixed(d==null?1:d);
const chance = p => rnd()<p;

/* --------------------------------- platform ------------------------------ */
const MP = {
  name:'Marketplace',
  operator:'Aventa Telecom',            /* white-label operator running the marketplace */
  platform:'6D Marketplace',
  region:'India · UAE · Kenya',
  currency:'$',
  /* The symbol alone is ambiguous across the regions this runs in, so anywhere
     a bare number is typed rather than read, the code is shown too. */
  currencyCode:'USD',
  since:'Launched Mar 2024'
};

/* -------------------------- the six marketplaces -------------------------- */
const VERTICALS = [
  {id:'consumer', name:'Consumer Marketplace',        aud:'B2C',                  icon:'smartphone',
   blurb:'Mobile plans, devices, OTT and insurance for retail customers'},
  {id:'partner',  name:'Partner Marketplace',         aud:'B2B2X',                icon:'group',
   blurb:'Partner onboarding and white-label reselling of the full catalogue'},
  {id:'iot',      name:'IoT Marketplace',             aud:'Enterprise',           icon:'cpu',
   blurb:'IoT SIMs, sensors, trackers and device + connectivity bundles'},
  {id:'security', name:'Security Marketplace',        aud:'Enterprise',           icon:'shield',
   blurb:'Managed firewall, MDR, VPN and endpoint protection'},
  {id:'device',   name:'Device Marketplace',          aud:'Consumer & Enterprise',icon:'monitor',
   blurb:'Phones, routers, CPE, tablets and accessories'},
  {id:'content',  name:'Digital Content Marketplace', aud:'Consumer',             icon:'play',
   blurb:'Streaming, gaming, music and cloud subscriptions'}
];
const VMAP = {}; VERTICALS.forEach(v=>VMAP[v.id]=v);

/* -------------------------------- partners -------------------------------- */
/* status: live | onboarding | review | suspended | rejected                   */
const PARTNERS = [
  {id:'PTR-1001', name:'StreamNova Media',      type:'Content provider', verticals:['content'],           country:'Singapore', tier:'Gold',     status:'live',       joined:'12 Apr 2024', rating:4.6, plan:'CP-CONTENT-STD', contact:'Wei Lin Tan'},
  {id:'PTR-1002', name:'Kestrel Devices',       type:'Device OEM',       verticals:['device','consumer'], country:'India',     tier:'Platinum', status:'live',       joined:'02 Mar 2024', rating:4.4, plan:'CP-DEVICE-VOL', contact:'Anil Mehra'},
  {id:'PTR-1003', name:'Sentinel Cyber',        type:'Security ISV',     verticals:['security'],          country:'UAE',       tier:'Gold',     status:'live',       joined:'18 Jun 2024', rating:4.8, plan:'CP-SEC-SAAS',   contact:'Farah Al Hashimi'},
  {id:'PTR-1004', name:'Nimbus Sensors',        type:'IoT hardware',     verticals:['iot','device'],      country:'Germany',   tier:'Silver',   status:'live',       joined:'27 Sep 2024', rating:4.1, plan:'CP-IOT-STD',    contact:'Katrin Boehm'},
  {id:'PTR-1005', name:'PlayForge Games',       type:'Content provider', verticals:['content'],           country:'Poland',    tier:'Silver',   status:'live',       joined:'05 Nov 2024', rating:4.3, plan:'CP-CONTENT-STD',contact:'Marek Zielinski'},
  {id:'PTR-1006', name:'Aegis Assurance',       type:'Insurance',        verticals:['consumer'],          country:'India',     tier:'Gold',     status:'live',       joined:'14 Jan 2025', rating:4.0, plan:'CP-INS-STD',    contact:'Divya Rao'},
  {id:'PTR-1007', name:'Halo Audio',            type:'Content provider', verticals:['content'],           country:'Sweden',    tier:'Silver',   status:'live',       joined:'22 Feb 2025', rating:4.5, plan:'CP-CONTENT-STD',contact:'Elin Lindqvist'},
  {id:'PTR-1008', name:'Volta Routers',         type:'Device OEM',       verticals:['device','iot'],      country:'Taiwan',    tier:'Silver',   status:'live',       joined:'09 Apr 2025', rating:3.9, plan:'CP-DEVICE-VOL', contact:'Chen Yu Hsu'},
  {id:'PTR-1009', name:'Beacon Reseller Co',    type:'Reseller',         verticals:['partner'],           country:'Kenya',     tier:'Gold',     status:'live',       joined:'30 May 2025', rating:4.2, plan:'CP-RESELL-T2',  contact:'Amara Okonkwo'},
  {id:'PTR-1010', name:'ClearVault Cloud',      type:'Security ISV',     verticals:['security','content'],country:'UK',        tier:'Silver',   status:'live',       joined:'11 Aug 2025', rating:4.4, plan:'CP-SEC-SAAS',   contact:'Idris Haddad'},
  {id:'PTR-1011', name:'TrackWise Telematics',  type:'IoT hardware',     verticals:['iot'],               country:'India',     tier:'Bronze',   status:'live',       joined:'19 Jan 2026', rating:3.7, plan:'CP-IOT-STD',    contact:'Sanjay Iyer'},
  {id:'PTR-1012', name:'Northwind Mobility',    type:'Reseller',         verticals:['partner','consumer'],country:'UAE',       tier:'Bronze',   status:'onboarding', joined:'—',           rating:null,plan:'CP-RESELL-T3',  contact:'Yara Nasr'},
  {id:'PTR-1013', name:'Lumen Wearables',       type:'Device OEM',       verticals:['device'],            country:'Vietnam',   tier:'Bronze',   status:'review',     joined:'—',           rating:null,plan:'CP-DEVICE-STD', contact:'Tran Minh Duc'},
  {id:'PTR-1014', name:'Orbital Connect',       type:'IoT hardware',     verticals:['iot'],               country:'Brazil',    tier:'Bronze',   status:'rejected',   joined:'—',           rating:null,plan:null,            contact:'Rafael Costa'},
  {id:'PTR-1015', name:'Vertex Endpoint',       type:'Security ISV',     verticals:['security'],          country:'Israel',    tier:'Silver',   status:'suspended',  joined:'03 Dec 2024', rating:3.2, plan:'CP-SEC-SAAS',   contact:'Noa Barak'}
];
const PMAP={}; PARTNERS.forEach(p=>PMAP[p.id]=p);
/* Every seller has a named contact, so every seller has an address to write to.
   Without one a reminder has nowhere to go and the screen cannot say who it
   went to — which is most of the point of showing it before it is sent. */
PARTNERS.forEach(p=>{
  if(p.email) return;
  const parts=p.contact.toLowerCase().replace(/[^a-z ]/g,'').split(/\s+/);
  const local=(parts[0]||'x')[0]+'.'+(parts[parts.length-1]||'contact');
  /* Same deterministic split as everywhere else in the dataset. */
  let h=0; for(const ch of local) h=(h*31+ch.charCodeAt(0))>>>0;
  p.email = local+'@'+(h%2 ? 'gmail.com' : '6dtech.co.in');
});
let LIVE_PARTNERS = PARTNERS.filter(p=>p.status==='live');

/* --------------------------- onboarding journey --------------------------- */
/* The B2B2X partner onboarding funnel, seven gates. Every partner sits on one. */
const ONB_STEPS = [
  {id:'apply',    name:'Application',        desc:'Company details, verticals, expected volume'},
  {id:'kyc',      name:'KYC & due diligence',desc:'Registration, beneficial ownership, sanctions screening'},
  {id:'agree',    name:'Agreements',         desc:'Marketplace terms, DPA and commission schedule, e-signed'},
  {id:'finance',  name:'Bank & tax',         desc:'Settlement account, tax residency, withholding'},
  {id:'tech',     name:'Technical readiness',desc:'Catalogue feed or portal upload, fulfilment webhook, sandbox order'},
  {id:'assure',   name:'Compliance review',  desc:'Security questionnaire, content policy, sample listing audit'},
  {id:'golive',   name:'Go-live',            desc:'Storefront enabled, first listings published'}
];
/* Northwind Mobility is mid-journey — the walk-through case. */
const ONB_STATE = {
  'PTR-1012':{apply:'done',kyc:'done',agree:'done',finance:'now',tech:'todo',assure:'todo',golive:'todo',
              started:'08 Jul 2026', sla:'5 working days', owner:'Marketplace onboarding desk'},
  'PTR-1013':{apply:'done',kyc:'done',agree:'now',finance:'todo',tech:'todo',assure:'todo',golive:'todo',
              started:'16 Jul 2026', sla:'5 working days', owner:'Marketplace onboarding desk'},
  'PTR-1014':{apply:'done',kyc:'fail',agree:'todo',finance:'todo',tech:'todo',assure:'todo',golive:'todo',
              started:'21 Jun 2026', sla:'5 working days', owner:'Marketplace onboarding desk'}
};
/* Onboarding tasks.

   These were one flat list, which meant a partner that went live two years ago
   showed the tasks of whichever seller happened to be mid-application. A task
   belongs to a partner and to a gate, and its state follows that partner's
   progress: cleared gate → done, with who closed it and when; current gate →
   open; a gate not yet reached → not started. Anything else is a screen telling
   an operator to chase somebody who finished long ago.

   Seeded after PARTNERS and ONB_STATE exist — see seedOnbTasks() below. */
const ONB_TASKS = [];

/* What each gate asks for. The same template for everybody, because the gate
   is the same for everybody; only the state differs. */
const ONB_TASK_TEMPLATE = {
  apply: [
    {key:'form',  title:'Application form submitted',
     detail:'Company details, target marketplace categories and expected monthly volume.',
     owner:'Partner', days:14},
    {key:'contact', title:'Primary contact confirmed',
     detail:'A named person who can sign, with a working address on the company domain.',
     owner:'Partner', days:14}
  ],
  kyc: [
    {key:'inc',   title:'Certificate of incorporation',
     detail:'Verified against the register in the country of registration.',
     owner:'Partner', days:5},
    {key:'ubo',   title:'Beneficial ownership declaration',
     detail:'Everyone holding over 25%, with identification for each.',
     owner:'Partner', days:5},
    {key:'screen',title:'Sanctions and PEP screening',
     detail:'OFAC, EU, UN and HMT lists, plus adverse media.',
     owner:'Marketplace', days:2}
  ],
  agree: [
    {key:'terms', title:'Marketplace terms e-signed',
     detail:'Version 4.2, signed by someone with authority to bind the company.',
     owner:'Partner', days:5},
    {key:'dpa',   title:'Data processing agreement',
     detail:'Standard contractual clauses, with sub-processors declared.',
     owner:'Partner', days:5},
    {key:'sched', title:'Commission schedule counter-signed',
     detail:'The plan the seller will actually settle on, signed by both sides.',
     owner:'Marketplace', days:3}
  ],
  finance: [
    {key:'bank',  title:'Settlement bank account verified',
     detail:'Two micro-deposits are sent to the nominated account. The amounts have to be '+
            'confirmed before any money moves in the other direction.',
     owner:'Partner', days:3},
    {key:'tax',   title:'Tax residency certificate',
     detail:'A valid certificate applies the treaty withholding rate. Without one, the statutory '+
            'rate is withheld at source.',
     owner:'Partner', days:3}
  ],
  tech: [
    {key:'feed',  title:'Catalogue method agreed',
     detail:'API feed or portal upload, with the update frequency stated.',
     owner:'Partner', days:5},
    {key:'hook',  title:'Fulfilment webhook reachable',
     detail:'Responds to a signed test call over TLS inside the timeout.',
     owner:'Partner', days:5},
    {key:'sbx',   title:'Sandbox order completed end to end',
     detail:'One order placed, fulfilled and settled in sandbox before anything is sold for real.',
     owner:'Partner', days:5}
  ],
  assure: [
    {key:'sec',   title:'Security questionnaire',
     detail:'52-question baseline covering data handling, retention and sub-processors.',
     owner:'Partner', days:8},
    {key:'policy',title:'Content and listing policy acknowledged',
     detail:'Including the category rules that apply to what they intend to sell.',
     owner:'Partner', days:8},
    {key:'audit', title:'Sample listing audit',
     detail:'Three listings reviewed against the policy before the storefront opens.',
     owner:'Marketplace', days:4}
  ],
  golive: [
    {key:'store', title:'Storefront enabled',
     detail:'The seller becomes visible to buyers in the categories they were approved for.',
     owner:'Marketplace', days:1},
    {key:'first', title:'First listings published',
     detail:'At least one live listing, so the storefront is not an empty shop.',
     owner:'Partner', days:2}
  ]
};

/* Who signs a marketplace-owned task off, by gate. */
const ONB_TASK_CLOSER = {
  apply:'Lena Fischer', kyc:'Ruben Oyelaran', agree:'Ruben Oyelaran', finance:'Ruben Oyelaran',
  tech:'Tomas Novak', assure:'Farah Al Hashimi', golive:'Lena Fischer'
};

/* ------------------------------ commission plans -------------------------- */
/* Settlement plans: how gross order value is split between partner, marketplace
   and taxes, plus the payout schedule.                                        */
const COMM_PLANS = [
  {id:'CP-CONTENT-STD', name:'Digital content — standard', vertical:'content',  model:'Revenue share',
   base:22, tiers:[{from:0,rate:22},{from:50000,rate:19},{from:150000,rate:16}],
   fees:'Payment processing 1.9% + $0.20', cycle:'Monthly, net 15', hold:'7 days', partners:3},
  {id:'CP-DEVICE-VOL',  name:'Device — volume',            vertical:'device',   model:'Commission on sale',
   base:9,  tiers:[{from:0,rate:9},{from:250000,rate:7.5},{from:750000,rate:6}],
   fees:'Payment processing 1.9% + $0.20 · logistics at cost', cycle:'Monthly, net 30', hold:'14 days (returns window)', partners:2},
  {id:'CP-DEVICE-STD',  name:'Device — standard',          vertical:'device',   model:'Commission on sale',
   base:12, tiers:[{from:0,rate:12}],
   fees:'Payment processing 1.9% + $0.20 · logistics at cost', cycle:'Monthly, net 30', hold:'14 days (returns window)', partners:1},
  {id:'CP-SEC-SAAS',    name:'Security — subscription',    vertical:'security', model:'Recurring revenue share',
   base:18, tiers:[{from:0,rate:18},{from:100000,rate:15}],
   fees:'Payment processing 1.9%', cycle:'Monthly, net 15', hold:'None', partners:3},
  {id:'CP-IOT-STD',     name:'IoT — hardware + connectivity', vertical:'iot',   model:'Split: hardware commission, connectivity wholesale',
   base:11, tiers:[{from:0,rate:11},{from:200000,rate:9}],
   fees:'Payment processing 1.9% + $0.20', cycle:'Monthly, net 30', hold:'14 days', partners:3},
  {id:'CP-INS-STD',     name:'Insurance — introducer',     vertical:'consumer', model:'Introducer commission on premium',
   base:15, tiers:[{from:0,rate:15}],
   fees:'None', cycle:'Monthly, net 30', hold:'Cooling-off 14 days', partners:1},
  {id:'CP-RESELL-T2',   name:'Reseller — tier 2',          vertical:'partner',  model:'Wholesale discount off list',
   base:14, tiers:[{from:0,rate:14},{from:120000,rate:17}],
   fees:'None — reseller invoices the end customer', cycle:'Monthly, net 30', hold:'None', partners:1},
  {id:'CP-RESELL-T3',   name:'Reseller — tier 3 (entry)',  vertical:'partner',  model:'Wholesale discount off list',
   base:10, tiers:[{from:0,rate:10},{from:60000,rate:12}],
   fees:'None — reseller invoices the end customer', cycle:'Monthly, net 30', hold:'None', partners:1}
];
const CPMAP={}; COMM_PLANS.forEach(c=>CPMAP[c.id]=c);

/* -------------------------------- catalogue ------------------------------- */
/* fulfil: instant | esim | shipped | provisioned | activation
   model : oneoff | monthly | annual | usage                                    */
function P(o){ return o; }
const PRODUCTS = [
  /* ---- Consumer: mobile plans, insurance, bundles ---- */
  P({id:'SKU-2001', v:'consumer', cat:'Mobile plans', name:'Aventa Freedom 50 GB', partner:null, seller:'Aventa Telecom',
     price:18.00, model:'monthly', fulfil:'esim', rating:4.3, reviews:2140, stock:'in', status:'live', listed:'02 Mar 2024',
     desc:'50 GB data, unlimited calls and SMS, 5G, no contract. Activates on eSIM in about two minutes.',
     tags:['5G','No contract','eSIM'], comm:0, badge:'Bestseller'}),
  P({id:'SKU-2002', v:'consumer', cat:'Mobile plans', name:'Aventa Freedom Unlimited', partner:null, seller:'Aventa Telecom',
     price:27.00, model:'monthly', fulfil:'esim', rating:4.5, reviews:1663, stock:'in', status:'live', listed:'02 Mar 2024',
     desc:'Unlimited data with 5G, 30 GB roaming across 42 countries, hotspot included.',
     tags:['5G','Unlimited','Roaming'], comm:0}),
  P({id:'SKU-2003', v:'consumer', cat:'Mobile plans', name:'Travel eSIM — 10 GB, 30 days', partner:null, seller:'Aventa Telecom',
     price:14.50, model:'oneoff', fulfil:'esim', rating:4.1, reviews:884, stock:'in', status:'live', listed:'18 Sep 2024',
     desc:'Data-only travel plan covering 62 destinations. QR delivered instantly, no roaming bill shock.',
     tags:['Travel','Data only','Instant'], comm:0}),
  P({id:'SKU-2004', v:'consumer', cat:'Insurance', name:'Device Protect — screen and theft', partner:'PTR-1006', seller:'Aegis Assurance',
     price:6.90, model:'monthly', fulfil:'activation', rating:3.8, reviews:412, stock:'in', status:'live', listed:'14 Jan 2025',
     desc:'Accidental damage, screen repair and theft cover for one handset. Two claims per year, $49 excess.',
     tags:['Insurance','Cancel anytime'], comm:15}),
  P({id:'SKU-2005', v:'consumer', cat:'Insurance', name:'Travel Cover Lite', partner:'PTR-1006', seller:'Aegis Assurance',
     price:11.00, model:'oneoff', fulfil:'instant', rating:4.0, reviews:187, stock:'in', status:'live', listed:'03 Mar 2025',
     desc:'Single-trip medical and baggage cover up to $250,000, bought alongside a travel eSIM.',
     tags:['Insurance','Travel'], comm:15}),
  P({id:'SKU-2006', v:'consumer', cat:'Bundles', name:'Unlimited + Streaming duo', partner:null, seller:'Aventa Telecom',
     price:34.00, was:41.00, model:'monthly', fulfil:'esim', rating:4.6, reviews:731, stock:'in', status:'live', listed:'11 Nov 2025',
     desc:'Freedom Unlimited with any two streaming subscriptions of your choice, billed as one line.',
     tags:['Bundle','Save $7'], comm:0, badge:'Bundle'}),

  /* ---- Digital content: OTT, gaming, music, cloud ---- */
  P({id:'SKU-3001', v:'content', cat:'Streaming', name:'StreamNova Premium 4K', partner:'PTR-1001', seller:'StreamNova Media',
     price:12.99, model:'monthly', fulfil:'instant', rating:4.6, reviews:5820, stock:'in', status:'live', listed:'12 Apr 2024',
     desc:'4K HDR streaming on four screens, offline downloads, no advertising.',
     tags:['4K','4 screens','Ad-free'], comm:22, badge:'Bestseller'}),
  P({id:'SKU-3002', v:'content', cat:'Streaming', name:'StreamNova Standard', partner:'PTR-1001', seller:'StreamNova Media',
     price:7.99, model:'monthly', fulfil:'instant', rating:4.2, reviews:3104, stock:'in', status:'live', listed:'12 Apr 2024',
     desc:'Full catalogue in HD on two screens, with limited advertising.',
     tags:['HD','2 screens'], comm:22}),
  P({id:'SKU-3003', v:'content', cat:'Gaming', name:'PlayForge Cloud Gaming', partner:'PTR-1005', seller:'PlayForge Games',
     price:9.99, model:'monthly', fulfil:'instant', rating:4.3, reviews:2266, stock:'in', status:'live', listed:'05 Nov 2024',
     desc:'Over 400 titles streamed to phone, tablet or TV. No console needed; 5G recommended.',
     tags:['Cloud gaming','400+ titles'], comm:22}),
  P({id:'SKU-3004', v:'content', cat:'Gaming', name:'PlayForge Season Pass', partner:'PTR-1005', seller:'PlayForge Games',
     price:24.99, model:'oneoff', fulfil:'instant', rating:4.0, reviews:640, stock:'in', status:'live', listed:'19 Feb 2025',
     desc:'Ninety days of premium titles plus in-game currency, redeemed by code.',
     tags:['90 days','Code delivery'], comm:22}),
  P({id:'SKU-3005', v:'content', cat:'Music', name:'Halo Music Family', partner:'PTR-1007', seller:'Halo Audio',
     price:14.99, model:'monthly', fulfil:'instant', rating:4.5, reviews:4111, stock:'in', status:'live', listed:'22 Feb 2025',
     desc:'Lossless audio for up to six people, offline listening, shared library.',
     tags:['Lossless','6 people'], comm:22}),
  P({id:'SKU-3006', v:'content', cat:'Music', name:'Halo Music Solo', partner:'PTR-1007', seller:'Halo Audio',
     price:8.99, model:'monthly', fulfil:'instant', rating:4.4, reviews:2903, stock:'in', status:'live', listed:'22 Feb 2025',
     desc:'Lossless audio for one listener with offline downloads.',
     tags:['Lossless'], comm:22}),
  P({id:'SKU-3007', v:'content', cat:'Cloud storage', name:'ClearVault Personal 2 TB', partner:'PTR-1010', seller:'ClearVault Cloud',
     price:6.49, model:'monthly', fulfil:'instant', rating:4.4, reviews:988, stock:'in', status:'live', listed:'11 Aug 2025',
     desc:'Two terabytes of encrypted storage with automatic phone backup and version history.',
     tags:['Encrypted','2 TB'], comm:22}),
  P({id:'SKU-3008', v:'content', cat:'Streaming', name:'StreamNova Sports Add-on', partner:'PTR-1001', seller:'StreamNova Media',
     price:5.99, model:'monthly', fulfil:'instant', rating:3.6, reviews:402, stock:'in', status:'pending', listed:'21 Jul 2026',
     desc:'Live league coverage as an add-on to any StreamNova subscription.',
     tags:['Live sport','Add-on'], comm:22}),

  /* ---- Devices: phones, routers, CPE, tablets, wearables ---- */
  P({id:'SKU-4001', v:'device', cat:'Phones', name:'Kestrel K9 Pro 256 GB', partner:'PTR-1002', seller:'Kestrel Devices',
     price:749.00, was:829.00, model:'oneoff', fulfil:'shipped', rating:4.5, reviews:1204, stock:'in', status:'live', listed:'02 Mar 2024',
     desc:'6.7-inch 120 Hz display, triple camera, 5G, 5,000 mAh. Trade-in accepted at checkout.',
     tags:['5G','256 GB','Trade-in'], comm:9, badge:'Bestseller'}),
  P({id:'SKU-4002', v:'device', cat:'Phones', name:'Kestrel K9 Lite 128 GB', partner:'PTR-1002', seller:'Kestrel Devices',
     price:349.00, model:'oneoff', fulfil:'shipped', rating:4.2, reviews:2841, stock:'in', status:'live', listed:'02 Mar 2024',
     desc:'6.4-inch display, dual camera, 5G, two-day battery. Available on 24-month instalments.',
     tags:['5G','Instalments'], comm:9}),
  P({id:'SKU-4003', v:'device', cat:'Phones', name:'Kestrel K7 64 GB', partner:'PTR-1002', seller:'Kestrel Devices',
     price:169.00, model:'oneoff', fulfil:'shipped', rating:3.9, reviews:3320, stock:'low', status:'live', listed:'02 Mar 2024',
     desc:'Entry 4G handset with a 6.1-inch screen and 5,000 mAh battery.',
     tags:['4G','Entry'], comm:9}),
  P({id:'SKU-4004', v:'device', cat:'Routers', name:'Volta Mesh Wi-Fi 6 (3-pack)', partner:'PTR-1008', seller:'Volta Routers',
     price:229.00, model:'oneoff', fulfil:'shipped', rating:4.1, reviews:611, stock:'in', status:'live', listed:'09 Apr 2025',
     desc:'Whole-home mesh covering up to 500 m², app-managed, WPA3.',
     tags:['Wi-Fi 6','Mesh'], comm:9}),
  P({id:'SKU-4005', v:'device', cat:'CPE', name:'Volta 5G Fixed Wireless CPE', partner:'PTR-1008', seller:'Volta Routers',
     price:319.00, model:'oneoff', fulfil:'shipped', rating:4.0, reviews:288, stock:'in', status:'live', listed:'09 Apr 2025',
     desc:'Outdoor-rated 5G receiver with Gigabit Ethernet, for premises without fibre.',
     tags:['5G','FWA','Outdoor'], comm:9}),
  P({id:'SKU-4006', v:'device', cat:'Tablets', name:'Kestrel Tab 11 LTE', partner:'PTR-1002', seller:'Kestrel Devices',
     price:279.00, model:'oneoff', fulfil:'shipped', rating:4.0, reviews:497, stock:'in', status:'live', listed:'16 Jul 2025',
     desc:'11-inch tablet with LTE, 128 GB and a detachable keyboard option.',
     tags:['LTE','128 GB'], comm:9}),
  P({id:'SKU-4007', v:'device', cat:'Wearables', name:'Lumen Watch Active', partner:'PTR-1013', seller:'Lumen Wearables',
     price:139.00, model:'oneoff', fulfil:'shipped', rating:null, reviews:0, stock:'in', status:'pending', listed:'19 Jul 2026',
     desc:'eSIM smartwatch with heart-rate and SpO2 sensing, 7-day battery.',
     tags:['eSIM','7-day battery'], comm:12}),
  P({id:'SKU-4008', v:'device', cat:'Accessories', name:'Kestrel 45 W GaN charger', partner:'PTR-1002', seller:'Kestrel Devices',
     price:29.00, model:'oneoff', fulfil:'shipped', rating:4.3, reviews:1560, stock:'out', status:'live', listed:'02 Mar 2024',
     desc:'Compact dual-port charger with USB-C power delivery.',
     tags:['45 W','USB-C'], comm:9}),

  /* ---- IoT: SIMs, sensors, trackers, gateways, bundles ---- */
  P({id:'SKU-5001', v:'iot', cat:'IoT SIM plans', name:'IoT Connect 500 MB', partner:null, seller:'Aventa Telecom',
     price:1.40, model:'monthly', fulfil:'provisioned', rating:4.2, reviews:96, stock:'in', status:'live', listed:'02 Mar 2024',
     desc:'500 MB per SIM per month, private APN, IMEI lock, pooled across the estate. Minimum 25 SIMs.',
     tags:['Private APN','Pooled','Min 25'], comm:0, unit:'per SIM'}),
  P({id:'SKU-5002', v:'iot', cat:'IoT SIM plans', name:'IoT Connect 2 GB', partner:null, seller:'Aventa Telecom',
     price:3.10, model:'monthly', fulfil:'provisioned', rating:4.3, reviews:74, stock:'in', status:'live', listed:'02 Mar 2024',
     desc:'2 GB per SIM per month with global roaming across 38 networks and pooled allowance.',
     tags:['Global','Pooled'], comm:0, unit:'per SIM'}),
  P({id:'SKU-5003', v:'iot', cat:'Sensors', name:'Nimbus Cold-chain sensor', partner:'PTR-1004', seller:'Nimbus Sensors',
     price:84.00, model:'oneoff', fulfil:'shipped', rating:4.4, reviews:212, stock:'in', status:'live', listed:'27 Sep 2024',
     desc:'Battery temperature and humidity logger for refrigerated transport. Five-year cell, IP67.',
     tags:['IP67','5-year battery'], comm:11}),
  P({id:'SKU-5004', v:'iot', cat:'Sensors', name:'Nimbus Occupancy sensor', partner:'PTR-1004', seller:'Nimbus Sensors',
     price:52.00, model:'oneoff', fulfil:'shipped', rating:4.0, reviews:143, stock:'in', status:'live', listed:'27 Sep 2024',
     desc:'People-counting sensor for facilities, privacy-preserving with no imaging.',
     tags:['No imaging','Facilities'], comm:11}),
  P({id:'SKU-5005', v:'iot', cat:'Trackers', name:'TrackWise Asset Tracker Pro', partner:'PTR-1011', seller:'TrackWise Telematics',
     price:96.00, model:'oneoff', fulfil:'shipped', rating:3.7, reviews:64, stock:'in', status:'live', listed:'19 Jan 2026',
     desc:'GPS and cell-ID tracker with three-year battery, geofence alerts, ruggedised housing.',
     tags:['GPS','Geofence','3-year'], comm:11}),
  P({id:'SKU-5006', v:'iot', cat:'Bundles', name:'Cold-chain starter — 25 sensors + connectivity', partner:'PTR-1004', seller:'Nimbus Sensors',
     price:2450.00, model:'oneoff', fulfil:'shipped', rating:4.5, reviews:38, stock:'in', status:'live', listed:'04 Feb 2025',
     desc:'Twenty-five cold-chain sensors, 25 IoT SIMs on 500 MB pooled, dashboard access for 12 months.',
     tags:['Bundle','25 units','12 months'], comm:11, badge:'Bundle'}),
  P({id:'SKU-5007', v:'iot', cat:'Gateways', name:'Volta IoT Gateway LTE-M', partner:'PTR-1008', seller:'Volta Routers',
     price:188.00, model:'oneoff', fulfil:'shipped', rating:4.1, reviews:57, stock:'low', status:'live', listed:'12 Jun 2025',
     desc:'LTE-M and NB-IoT gateway with Modbus and MQTT bridging, DIN-rail mount.',
     tags:['LTE-M','NB-IoT','MQTT'], comm:11}),
  P({id:'SKU-5008', v:'iot', cat:'Bundles', name:'Fleet telematics starter — 50 trackers', partner:'PTR-1011', seller:'TrackWise Telematics',
     price:4800.00, model:'oneoff', fulfil:'shipped', rating:3.8, reviews:12, stock:'in', status:'live', listed:'02 Mar 2026',
     desc:'Fifty asset trackers with 50 IoT SIMs and twelve months of fleet dashboard.',
     tags:['Bundle','50 units'], comm:11}),

  /* ---- Security: firewall, MDR, VPN, endpoint, email ---- */
  P({id:'SKU-6001', v:'security', cat:'Managed firewall', name:'Sentinel Managed Firewall — Standard', partner:'PTR-1003', seller:'Sentinel Cyber',
     price:24.00, model:'monthly', fulfil:'provisioned', rating:4.7, reviews:186, stock:'in', status:'live', listed:'18 Jun 2024',
     desc:'Cloud-managed next-generation firewall per site, with policy management and monthly reporting.',
     tags:['NGFW','Per site','Managed'], comm:18, unit:'per site', badge:'Bestseller'}),
  P({id:'SKU-6002', v:'security', cat:'MDR', name:'Sentinel MDR — 24/7', partner:'PTR-1003', seller:'Sentinel Cyber',
     price:9.50, model:'monthly', fulfil:'provisioned', rating:4.8, reviews:141, stock:'in', status:'live', listed:'18 Jun 2024',
     desc:'Managed detection and response with a 24/7 SOC, 15-minute triage target and quarterly threat review.',
     tags:['SOC 24/7','15-min triage'], comm:18, unit:'per endpoint'}),
  P({id:'SKU-6003', v:'security', cat:'VPN / ZTNA', name:'Sentinel Secure Access (ZTNA)', partner:'PTR-1003', seller:'Sentinel Cyber',
     price:6.20, model:'monthly', fulfil:'provisioned', rating:4.6, reviews:203, stock:'in', status:'live', listed:'07 Oct 2024',
     desc:'Zero-trust remote access replacing legacy VPN concentrators. Device posture checks included.',
     tags:['Zero trust','Per user'], comm:18, unit:'per user'}),
  P({id:'SKU-6004', v:'security', cat:'Endpoint', name:'Vertex Endpoint Protect', partner:'PTR-1015', seller:'Vertex Endpoint',
     price:4.80, model:'monthly', fulfil:'provisioned', rating:3.2, reviews:88, stock:'in', status:'suspended', listed:'03 Dec 2024',
     desc:'Endpoint protection with ransomware rollback and USB control.',
     tags:['EDR','Per endpoint'], comm:18, unit:'per endpoint'}),
  P({id:'SKU-6005', v:'security', cat:'Email security', name:'ClearVault Mail Defence', partner:'PTR-1010', seller:'ClearVault Cloud',
     price:3.40, model:'monthly', fulfil:'provisioned', rating:4.3, reviews:117, stock:'in', status:'live', listed:'11 Aug 2025',
     desc:'Phishing and impersonation protection with attachment sandboxing and 30-day message retention.',
     tags:['Anti-phishing','Sandbox'], comm:18, unit:'per mailbox'}),
  P({id:'SKU-6006', v:'security', cat:'Bundles', name:'SMB Security Essentials — 25 seats', partner:'PTR-1003', seller:'Sentinel Cyber',
     price:389.00, was:436.00, model:'monthly', fulfil:'provisioned', rating:4.6, reviews:52, stock:'in', status:'live', listed:'15 Mar 2026',
     desc:'Managed firewall for one site, MDR and secure access for twenty-five people, billed as one subscription.',
     tags:['Bundle','25 seats'], comm:18, badge:'Bundle'}),

  /* ---- Partner marketplace: reseller enablement ---- */
  P({id:'SKU-7001', v:'partner', cat:'Reseller packs', name:'White-label storefront', partner:null, seller:'Aventa Telecom',
     price:249.00, model:'monthly', fulfil:'provisioned', rating:4.2, reviews:31, stock:'in', status:'live', listed:'30 May 2025',
     desc:'Branded marketplace storefront on your own domain, drawing on the full Aventa catalogue with your own margin.',
     tags:['White-label','Own domain'], comm:0}),
  P({id:'SKU-7002', v:'partner', cat:'Reseller packs', name:'Wholesale connectivity pack — 500 lines', partner:null, seller:'Aventa Telecom',
     price:3900.00, model:'monthly', fulfil:'provisioned', rating:4.0, reviews:18, stock:'in', status:'live', listed:'30 May 2025',
     desc:'Five hundred mobile lines at wholesale rate for resale under your own brand and tariff.',
     tags:['Wholesale','500 lines'], comm:0}),
  P({id:'SKU-7003', v:'partner', cat:'Enablement', name:'Partner API and sandbox access', partner:null, seller:'Aventa Telecom',
     price:0, model:'monthly', fulfil:'provisioned', rating:4.4, reviews:44, stock:'in', status:'live', listed:'30 May 2025',
     desc:'Catalogue, ordering and settlement APIs with a sandbox tenant. Included with every live partner agreement.',
     tags:['API','Sandbox','Included'], comm:0})
];
const SKUMAP={}; PRODUCTS.forEach(p=>SKUMAP[p.id]=p);
let LIVE_PRODUCTS = PRODUCTS.filter(p=>p.status==='live');

/* ------------------- §4.67 what a product depends on ----------------------
   Some things in a catalogue cannot be bought on their own, and some cannot
   be held together. An add-on with nothing to attach to, two tiers of the
   same subscription on one account, a sensor with no connectivity — each of
   those is an order that will be taken and then fail somewhere downstream,
   at a refund desk or in provisioning.

   Three relationships, and they are not the same thing:

     requires   a hard dependency. Either an eligible companion is already
                held, or it is in the same basket. Nothing else clears it.
     excludes   cannot be held at the same time. Usually two tiers of one
                service, or a bundle that already contains the item.
     worksWith  a recommendation and nothing more. It never blocks a purchase
                and it is never phrased as though it might.

   Every rule carries `why` in the seller's own words. A refusal that does not
   say what would fix it is worse than no refusal at all, because the shopper
   is left guessing at a rule they cannot see. */
const PROD_RULES = {
  'SKU-3008': {
    requires:{anyOf:['SKU-3001','SKU-3002'],
      why:'Sports is added to a StreamNova subscription. On its own there is nothing for it to be added to.'}},
  'SKU-3004': {
    requires:{anyOf:['SKU-3003'],
      why:'The season pass unlocks content inside PlayForge Cloud Gaming and does not stream on its own.'},
    worksWith:[{sku:'SKU-4004', why:'A wired-quality connection to the console room — cloud gaming is the '+
      'first thing a weak signal spoils.'}]},
  'SKU-3001': {
    excludes:[{sku:'SKU-3002',
      why:'One StreamNova tier per household. Premium already carries everything Standard does.'},
      {sku:'SKU-2006',
      why:'The Unlimited + Streaming duo already includes StreamNova Premium at the bundled price.'}]},
  'SKU-3002': {
    excludes:[{sku:'SKU-3001',
      why:'One StreamNova tier per household. Moving up to Premium replaces Standard rather than adding to it.'}]},
  'SKU-3005': {
    excludes:[{sku:'SKU-3006',
      why:'Family already covers six people. Solo on the same account would be billed twice for one listener.'}]},
  'SKU-3006': {
    excludes:[{sku:'SKU-3005',
      why:'Solo is a single seat within Family. Holding both bills the same listener twice.'}]},
  'SKU-2001': {
    excludes:[{sku:'SKU-2002',
      why:'One Aventa plan per line. Changing plan is a switch, not a second subscription.'},
      {sku:'SKU-2006',
      why:'The duo already carries Aventa Freedom Unlimited on this line.'}]},
  'SKU-2002': {
    excludes:[{sku:'SKU-2001',
      why:'One Aventa plan per line. Changing plan is a switch, not a second subscription.'},
      {sku:'SKU-2006',
      why:'The duo already carries Aventa Freedom Unlimited on this line.'}]},
  'SKU-2006': {
    bundleOf:['SKU-2002','SKU-3001'],
    excludes:[{sku:'SKU-2002', why:'The duo already includes Unlimited — you would be paying for it twice.'},
      {sku:'SKU-3001', why:'The duo already includes StreamNova Premium 4K.'},
      {sku:'SKU-2001', why:'One Aventa plan per line, and the duo carries Unlimited.'}]},
  'SKU-2004': {
    requires:{anyOf:['SKU-4001','SKU-4002','SKU-4003','SKU-4006','SKU-4007'],
      why:'Cover attaches to a device bought here, within 30 days of delivery. There is no way to '+
        'underwrite a handset the marketplace has never seen.'}},
  'SKU-2005': {
    requires:{anyOf:['SKU-2003','SKU-2001','SKU-2002'],
      why:'Travel cover is sold alongside an Aventa line or a travel eSIM — the policy is written against '+
        'the number that travels.'}},
  'SKU-5003': {
    requires:{anyOf:['SKU-5001','SKU-5002','SKU-5006'],
      why:'A sensor with no IoT connectivity plan reports to nothing. Either plan carries it.'},
    worksWith:[{sku:'SKU-5007', why:'The LTE-M gateway backhauls a site of sensors over one connection '+
      'instead of one plan per sensor.'}]},
  'SKU-5004': {
    requires:{anyOf:['SKU-5001','SKU-5002','SKU-5006'],
      why:'A sensor with no IoT connectivity plan reports to nothing. Either plan carries it.'}},
  'SKU-5005': {
    requires:{anyOf:['SKU-5001','SKU-5002','SKU-5008'],
      why:'The tracker reports over cellular — without a connectivity plan it records a journey nobody sees.'}},
  /* A bundle names what it contains. The exclusion is deliberately one-way:
     holding the bundle blocks buying the part again, but holding the part
     does not block the bundle — that direction is an upgrade, and the buyer
     is told at the basket which standalone it replaces. */
  'SKU-5006': {
    bundleOf:['SKU-5001','SKU-5003'],
    excludes:[{sku:'SKU-5001',
      why:'The starter already includes connectivity for all 25 sensors.'}]},
  'SKU-6002': {
    requires:{anyOf:['SKU-6001','SKU-6004'],
      why:'The 24/7 team monitors something. Without a managed firewall or endpoint agent in place there '+
        'is no telemetry to watch.'},
    worksWith:[{sku:'SKU-6003', why:'Most of what MDR escalates is an access anomaly, and ZTNA is where '+
      'you act on it.'}]},
  'SKU-6006': {
    bundleOf:['SKU-6004','SKU-6005'],
    excludes:[{sku:'SKU-6004',
      why:'Endpoint Protect for 25 seats is already inside the Essentials bundle.'},
      {sku:'SKU-6005', why:'Mail Defence is already inside the Essentials bundle.'}]},
  'SKU-4001': {
    worksWith:[{sku:'SKU-2004', why:'Screen and theft cover, added within 30 days of delivery.'},
      {sku:'SKU-4008', why:'The K9 Pro charges at 45 W — the bundled 18 W brick takes three times as long.'}]},
  'SKU-4005': {
    worksWith:[{sku:'SKU-4004', why:'The CPE brings the signal in; the mesh carries it past one room.'}]},
  'SKU-7002': {
    requires:{anyOf:['SKU-7003'],
      why:'Wholesale lines are ordered and activated over the partner API. Sandbox access has to be in '+
        'place before the first order can be raised.'}}
};
function prodRule(sku){ return PROD_RULES[sku] || null; }
/* Which side of the marketplace is looking. Each persona's view file is the
   only one loaded in its own page, so it sets this once at the top and every
   rule check below reads the right set of holdings without being told. */
let BUY_CTX = 'consumer';
function setBuyCtx(c){ BUY_CTX = c; }
/* Which SKUs a buyer already holds, by persona. Cancelled and paused count —
   a paused subscription still occupies the slot and still bills on resume. */
function heldSkus(who){
  const src = (who||BUY_CTX)==='enterprise'
    ? (typeof ENT_SUBS!=='undefined' ? ENT_SUBS : [])
    : (typeof MY_SUBS!=='undefined' ? MY_SUBS : []);
  return src.filter(s=>s.status!=='cancelled').map(s=>s.sku);
}
/* Evaluate one SKU against what is held and what is already in the basket.
   Returns what is wrong and, for a hard dependency, exactly what would fix
   it — a rule the shopper cannot act on is a dead end dressed as an error. */
function eligibility(sku, opts){
  opts = opts || {};
  const rule = prodRule(sku);
  const out = {ok:true, blocks:[], notes:[], rule:rule};
  if(!rule) return out;
  /* A clash the buyer has already been told about and accepted is a switch,
     not a conflict. One Aventa plan per line is right when somebody tries to
     hold two; it is wrong when they are changing from one to the other, and
     that is a decision the caller states rather than one inferred here. */
  const waived = opts.replaces ? [].concat(opts.replaces) : [];
  const held = opts.held || heldSkus(opts.who);
  const basket = opts.basket ||
    (typeof CART!=='undefined' ? CART.map(l=>l.sku) : []);
  const have = held.concat(basket.filter(s=>s!==sku));

  if(rule.requires){
    const met = rule.requires.anyOf.filter(id=>have.indexOf(id)>-1);
    if(!met.length){
      out.ok=false;
      out.blocks.push({kind:'requires', why:rule.requires.why,
        need:rule.requires.anyOf.filter(id=>SKUMAP[id]),
        heldNone:true});
    } else {
      out.notes.push({kind:'met', sku:met[0],
        why:'Covered by '+((SKUMAP[met[0]]||{}).name||met[0])+
          (held.indexOf(met[0])>-1 ? ' on your account.' : ' in this basket.')});
    }
  }
  (rule.excludes||[]).forEach(x=>{
    if(waived.indexOf(x.sku)>-1){
      out.notes.push({kind:'switch', sku:x.sku,
        why:'Replaces '+((SKUMAP[x.sku]||{}).name||x.sku)+
          ', which closes when this one activates.'});
      return;
    }
    if(have.indexOf(x.sku)>-1){
      out.ok=false;
      out.blocks.push({kind:'excludes', why:x.why, clash:x.sku,
        where: held.indexOf(x.sku)>-1 ? 'account' : 'basket'});
    }
  });
  (rule.worksWith||[]).forEach(w=>{
    if(have.indexOf(w.sku)===-1 && SKUMAP[w.sku]) out.notes.push({kind:'with', sku:w.sku, why:w.why});
  });
  return out;
}
/* Products whose rules mention this one — so a bundle can say what it replaces
   and a base plan can say what attaches to it. */
/* What a buyer already holds that this product would replace — the basis of
   a plan change rather than a refusal. */
function wouldReplace(sku, who){
  const held = heldSkus(who);
  return ((prodRule(sku)||{}).excludes||[])
    .filter(x=>held.indexOf(x.sku)>-1)
    .map(x=>x.sku);
}
function dependants(sku){
  return Object.keys(PROD_RULES).filter(id=>{
    const r=PROD_RULES[id];
    return (r.requires && r.requires.anyOf.indexOf(sku)>-1);
  });
}
/* ------------------- §4.69 waiting for something to come back -------------
   Out of stock ends the journey unless the buyer can leave a marker. The
   marker is a record with a channel on it, because "we will let you know"
   without saying how is a promise nobody can hold anyone to. */
const RESTOCK_WATCH = [
  {id:'WCH-3001', sku:'SKU-4004', who:'consumer', name:'Priya Raman',
   channel:'SMS', to:'+91 98860 41127', since:'19 Jul 2026', notified:null},
  /* Deliberately on something that has since come back, so the list shows a
     row the buyer can act on rather than only rows they can wait on. */
  {id:'WCH-3002', sku:'SKU-4004', who:'enterprise', name:'Arun Deshpande',
   channel:'Email', to:'arun.deshpande@brightlinefoods.com', since:'14 Jul 2026', notified:null},
  {id:'WCH-3003', sku:'SKU-5003', who:'enterprise', name:'Meera Nathan',
   channel:'Email', to:'meera.nathan@brightlinefoods.com', since:'02 Jul 2026',
   notified:'21 Jul 2026'}
];
let WCH_SEQ = 3003;
function watchesFor(who){
  return RESTOCK_WATCH.filter(w=>w.who===(who||BUY_CTX));
}
function watching(sku, who){
  return RESTOCK_WATCH.some(w=>w.sku===sku && w.who===(who||BUY_CTX) && !w.notified);
}
function addWatch(sku, channel, to, name){
  if(watching(sku)) return null;
  const w={id:'WCH-'+(++WCH_SEQ), sku, who:BUY_CTX, name:name||'—',
    channel:channel||'Email', to:to||'—', since:TODAY, notified:null};
  RESTOCK_WATCH.push(w);
  return w;
}
function dropWatch(id){
  const i=RESTOCK_WATCH.findIndex(w=>w.id===id);
  if(i>-1) RESTOCK_WATCH.splice(i,1);
}
function watchersOf(sku){ return RESTOCK_WATCH.filter(w=>w.sku===sku && !w.notified); }
function ruleCount(){
  return Object.keys(PROD_RULES).reduce((a,id)=>{
    const r=PROD_RULES[id];
    return a + (r.requires?1:0) + (r.excludes||[]).length + (r.worksWith||[]).length;
  },0);
}

/* --------------------------------- orders --------------------------------- */
/* Order pipeline differs by fulfilment type — the UI must reflect that. */
const PIPELINES = {
  instant:     ['Placed','Payment authorised','Entitlement issued','Active'],
  esim:        ['Placed','Payment authorised','Profile issued','Activated'],
  shipped:     ['Placed','Payment authorised','Packed','In transit','Delivered'],
  provisioned: ['Placed','Approved','Provisioning','Configured','Live'],
  activation:  ['Placed','Payment authorised','Policy issued','Active']
};
/* A stage tracker that cannot say what a stage means, when it happened, who did
   it or what would prove it is decoration. Every stage carries its own record.
   `gap` is the usual number of hours from the stage before it, which is what
   lets a not-yet-reached stage say something more useful than nothing. */
const STAGE_INFO = {
  'Placed': {who:'The buyer', sys:'Order capture', gap:0,
    what:'The basket was committed and an order number was issued. Nothing has been charged and nothing '+
         'has moved yet — this is only the record that the buyer asked.',
    ev:'The order record, what was in the basket and the price the buyer agreed to'},
  'Payment authorised': {who:'The payment provider', sys:'Payments', gap:1,
    what:'The amount was held against the instrument the buyer used. Held, not taken — the money is '+
         'captured when the thing is actually delivered.',
    ev:'Authorisation code from the acquirer and the last four digits of the instrument'},
  'Approved': {who:'The buyer’s own approver', sys:'Enterprise approvals', gap:14,
    what:'The order was above the buying limit of the person who raised it, so it went to whoever holds '+
         'that limit and they released it.',
    ev:'Who approved it, the limit that applied and the time they released it'},
  'Entitlement issued': {who:'The seller’s platform', sys:'Entitlements', gap:1,
    what:'The right to use the thing was written against the account. This is the moment it becomes usable.',
    ev:'The entitlement identifier and the account it was written against'},
  'Profile issued': {who:'The SM-DP+', sys:'eSIM — GSMA SGP.22', gap:1,
    what:'An eSIM profile was prepared and an activation code released for the device to download.',
    ev:'ICCID, matching ID and the SM-DP+ address the device will fetch from'},
  'Policy issued': {who:'The policy function', sys:'PCF', gap:1,
    what:'The plan’s rules — allowance, speed and priority — were installed against the subscriber.',
    ev:'The policy identifier and the rules that were installed'},
  'Packed': {who:'The warehouse', sys:'Warehouse', gap:6,
    what:'Stock was picked against the order and sealed. From here the order has a physical parcel '+
         'attached to it and a serial range that belongs to this buyer.',
    ev:'The pick list, the serial or ICCID range allocated and which warehouse packed it'},
  'In transit': {who:'The carrier', sys:'Carrier', gap:8,
    what:'The carrier took custody. Tracking is live from this point and every scan is recorded against '+
         'the order.',
    ev:'Carrier, tracking number and the scans recorded so far'},
  'Delivered': {who:'The carrier', sys:'Carrier', gap:40,
    what:'The parcel reached the address and was accepted. The order closes here and the seller is paid '+
         'on this event, not on despatch.',
    ev:'Proof of delivery, who accepted it and the time of the final scan'},
  'Provisioning': {who:'The seller’s platform', sys:'Fulfilment', gap:4,
    what:'The service is being built against the account. Nothing is usable yet and nothing is charged yet.',
    ev:'The provisioning job reference and the account it is building against'},
  'Configured': {who:'The seller’s platform', sys:'Fulfilment', gap:18,
    what:'The options the buyer chose were applied. The service exists but has not been handed over.',
    ev:'The options applied and the configuration set they came from'},
  'Activated': {who:'The network', sys:'Network', gap:2,
    what:'The profile was downloaded and the line came up. It is live on the device now.',
    ev:'The first attach on the network and the device it attached from'},
  'Active': {who:'The platform', sys:'Billing', gap:1,
    what:'The service is live and the billing clock has started. Charges from this moment appear on the '+
         'next bill.',
    ev:'The activation time and the first billing period it falls into'},
  'Live': {who:'The platform', sys:'Billing', gap:2,
    what:'Handed over to the buyer and running. Support and SLA cover start here, not at order.',
    ev:'The handover time and the SLA that now applies'}
};

const ORDERS=[];
(function buildOrders(){
  const buyers=['Priya Raman','Arun Deshpande','Meera Nathan','Sofia Almeida','Idris Haddad','Lotte Bakker',
                'Tomas Novak','Amara Okonkwo','Yara Nasr','Felix Weber','Nadia Petrov','Joost Bakker'];
  const entBuyers=['Brightline Foods','Brightline Foods','Brightline Foods','Harbourpoint Retail','Cadence Health'];
  /* Order mix mirrors a real marketplace: consumer and content generate most of
     the order count at low value, while IoT, security and device generate most of
     the gross value on far fewer orders. */
  const POOL=[];
  LIVE_PRODUCTS.filter(x=>x.price>0).forEach(x=>{
    const weight = (x.v==='content'||x.v==='consumer') ? 9 : (x.v==='device' ? 3 : 2);
    for(let k=0;k<weight;k++) POOL.push(x);
  });
  for(let i=0;i<2600;i++){
    const p=pick(POOL);
    const isEnt = ['iot','security'].includes(p.v) || (p.v==='device'&&chance(.3));
    const qty = p.unit ? ri(10,120) : (p.v==='device'? ri(1,3) : 1);
    const gross=+(p.price*qty).toFixed(2);
    const stages=PIPELINES[p.fulfil];
    let stage = weighted([stages.length-1, stages.length-1, ri(1,stages.length-1)],[0.55,0.2,0.25]);
    const failed = chance(.05);
    ORDERS.push({
      id:'ORD-'+(880400+i*3),
      sku:p.id, name:p.name, v:p.v, cat:p.cat,
      seller:p.seller, partnerId:p.partner,
      buyer: isEnt ? pick(entBuyers) : pick(buyers),
      buyerType: isEnt ? 'Enterprise' : 'Consumer',
      qty, unit:p.unit||null, gross,
      comm:+(gross*(p.comm/100)).toFixed(2),
      model:p.model, fulfil:p.fulfil,
      stages, stage: failed?1:stage, failed,
      placed: pick(['Today 09:12','Today 11:48','Yesterday','2 d ago','3 d ago','5 d ago','1 w ago','2 w ago','3 w ago']),
      channel: isEnt ? 'Enterprise portal' : pick(['Consumer web','Consumer app','Partner storefront']),
      pay: isEnt ? 'Invoice, net 30' : pick(['Card','Bill to mobile','Wallet'])
    });
  }
})();
function weighted(arr,w){const r=rnd();let a=0;for(let i=0;i<arr.length;i++){a+=w[i];if(r<=a)return arr[i];}return arr[arr.length-1];}
let ORD_OPEN = ORDERS.filter(o=>o.stage < o.stages.length-1 && !o.failed);
let ORD_FAIL = ORDERS.filter(o=>o.failed);
let ORD_DONE = ORDERS.filter(o=>o.stage===o.stages.length-1 && !o.failed);

/* ------------------------------ GMV by vertical --------------------------- */
let GMV_BY_V = {};
VERTICALS.forEach(v=>{ GMV_BY_V[v.id]=+ORDERS.filter(o=>o.v===v.id).reduce((a,o)=>a+o.gross,0).toFixed(2); });
let GMV = +Object.values(GMV_BY_V).reduce((a,b)=>a+b,0).toFixed(2);
let COMMISSION = +ORDERS.reduce((a,o)=>a+o.comm,0).toFixed(2);
let TAKE_RATE = +(COMMISSION/GMV*100).toFixed(1);

/* -------------------------- settlement statements ------------------------- */
/* One statement per live partner per period. Net payout is computed, never
   asserted: gross less commission, fees and withholding.                          */
const PERIODS=['Jul 2026','Jun 2026','May 2026'];
const SETTLEMENTS=[];
PERIODS.forEach((per,pi)=>{
  LIVE_PARTNERS.forEach(ptr=>{
    const own=ORDERS.filter(o=>o.partnerId===ptr.id);
    const base=own.reduce((a,o)=>a+o.gross,0) * (pi===0?1:(pi===1?0.92:0.86));
    if(base<=0) return;
    const plan=CPMAP[ptr.plan]||COMM_PLANS[0];
    const gross=+base.toFixed(2);
    const commission=+(gross*plan.base/100).toFixed(2);
    const fees=+(gross*0.019 + own.length*0.20).toFixed(2);
    const wht=+(ptr.country==='Brazil'||ptr.country==='Vietnam' ? (gross-commission)*0.10 : 0).toFixed(2);
    const refunds=+(chance(.4)? gross*rf(0.004,0.02,4) : 0).toFixed(2);
    SETTLEMENTS.push({
      id:'STM-'+per.slice(0,3).toUpperCase()+'-'+ptr.id.slice(4),
      period:per, partnerId:ptr.id, partner:ptr.name, plan:plan.id, planName:plan.name,
      orders:own.length, gross, commission, fees, wht, refunds,
      net:+(gross-commission-fees-wht-refunds).toFixed(2),
      status: pi===0 ? (chance(.5)?'pending':'approved') : 'paid',
      due: pi===0 ? '15 Aug 2026' : '15 '+per.replace(/\d{4}/,'2026'),
      paidOn: pi===0 ? null : ('1'+ri(2,5)+' '+per),
      /* Who released the money and when. Without it an approved statement
         cannot say anything more useful than "approved". */
      approvedBy: null, approvedOn: null,
      method: ptr.country==='India'?'NEFT':ptr.country==='Kenya'?'SWIFT':'SEPA'
    });
    const st=SETTLEMENTS[SETTLEMENTS.length-1];
    if(st.status!=='pending'){
      st.approvedBy=['Ruben Oyelaran','Ananya Krishnan'][ri(0,1)];
      st.approvedOn=st.paidOn || ('0'+ri(4,9)+' '+per);
    }
  });
});
let SET_PENDING = SETTLEMENTS.filter(s=>s.status==='pending');
let PAYOUT_DUE = +SETTLEMENTS.filter(s=>s.status!=='paid').reduce((a,s)=>a+s.net,0).toFixed(2);

/* ------------------------------ listing queue ----------------------------- */
const LISTING_QUEUE = [
  {id:'LQ-701', sku:'SKU-3008', name:'StreamNova Sports Add-on', partner:'StreamNova Media', v:'content',
   submitted:'21 Jul 2026', age:'4 days', check:'Content rights evidence attached', risk:'low',
   issue:null, price:5.99},
  {id:'LQ-702', sku:'SKU-4007', name:'Lumen Watch Active', partner:'Lumen Wearables', v:'device',
   submitted:'19 Jul 2026', age:'6 days', check:'Awaiting radio type-approval certificate', risk:'medium',
   issue:'Type approval missing for two of three target markets', price:139.00},
  {id:'LQ-703', sku:'SKU-9901', name:'PlayForge Loot Crate', partner:'PlayForge Games', v:'content',
   submitted:'23 Jul 2026', age:'2 days', check:'Policy check — randomised paid rewards', risk:'high',
   issue:'Randomised paid rewards breach marketplace policy 7.4 in two markets', price:4.99},
  {id:'LQ-704', sku:'SKU-9902', name:'Nimbus Air Quality sensor', partner:'Nimbus Sensors', v:'iot',
   submitted:'24 Jul 2026', age:'1 day', check:'Standard hardware listing', risk:'low', issue:null, price:71.00},
  {id:'LQ-705', sku:'SKU-9903', name:'Beacon Reseller — bundled data pack', partner:'Beacon Reseller Co', v:'partner',
   submitted:'24 Jul 2026', age:'1 day', check:'Margin floor check', risk:'medium',
   issue:'Proposed retail price sits below the wholesale floor by $1.20', price:11.80}
];

/* ------------------------------- disputes --------------------------------- */
const DISPUTES = [
  {id:'DSP-330', order:'ORD-880463', buyer:'Meera Nathan', partner:'Kestrel Devices', v:'device',
   reason:'Item not as described', amount:349.00, raised:'2 d ago', status:'open', sla:'3 of 5 days used', owner:'Marketplace'},
  {id:'DSP-331', order:'ORD-880519', buyer:'Brightline Foods', partner:'Nimbus Sensors', v:'iot',
   reason:'Partial delivery — 3 of 25 sensors missing', amount:252.00, raised:'4 d ago', status:'partner', sla:'4 of 5 days used', owner:'Partner'},
  {id:'DSP-332', order:'ORD-880428', buyer:'Arun Deshpande', partner:'StreamNova Media', v:'content',
   reason:'Duplicate subscription charge', amount:12.99, raised:'6 d ago', status:'resolved', sla:'Closed in 2 days', owner:'Marketplace'},
  {id:'DSP-333', order:'ORD-880477', buyer:'Sofia Almeida', partner:'Vertex Endpoint', v:'security',
   reason:'Service not provisioned after 72 hours', amount:240.00, raised:'8 d ago', status:'escalated', sla:'Breached', owner:'Marketplace'},
  {id:'DSP-334', order:'ORD-880505', buyer:'Lotte Bakker', partner:'Aegis Assurance', v:'consumer',
   reason:'Claim declined — cover dispute', amount:6.90, raised:'11 d ago', status:'resolved', sla:'Closed in 6 days', owner:'Partner'}
];

/* ---------------------- consumer shopper (B2C persona) -------------------- */
const SHOPPER = {
  name:'Priya Raman', id:'CUS-449021', msisdn:'+91 98860 41127', city:'Bengaluru',
  since:'Customer since Jun 2024', tier:'Gold', wallet:42.60, points:3180,
  payment:'Bill to mobile · card ending 4419'
};
const MY_SUBS = [
  {id:'SUB-9101', sku:'SKU-3001', name:'StreamNova Premium 4K', seller:'StreamNova Media', v:'content',
   price:12.99, cycle:'Monthly', next:'02 Aug 2026', started:'02 Nov 2024', status:'active', autoRenew:true},
  {id:'SUB-9102', sku:'SKU-3005', name:'Halo Music Family', seller:'Halo Audio', v:'content',
   price:14.99, cycle:'Monthly', next:'11 Aug 2026', started:'11 Mar 2025', status:'active', autoRenew:true},
  {id:'SUB-9103', sku:'SKU-2001', name:'Aventa Freedom 50 GB', seller:'Aventa Telecom', v:'consumer',
   price:18.00, cycle:'Monthly', next:'01 Aug 2026', started:'14 Jun 2024', status:'active', autoRenew:true},
  {id:'SUB-9104', sku:'SKU-2004', name:'Device Protect — screen and theft', seller:'Aegis Assurance', v:'consumer',
   price:6.90, cycle:'Monthly', next:'14 Aug 2026', started:'14 Jan 2025', status:'active', autoRenew:true},
  {id:'SUB-9105', sku:'SKU-3003', name:'PlayForge Cloud Gaming', seller:'PlayForge Games', v:'content',
   price:9.99, cycle:'Monthly', next:'—', started:'20 Feb 2026', status:'cancelled', autoRenew:false, ends:'19 Aug 2026'},
  {id:'SUB-9106', sku:'SKU-3007', name:'ClearVault Personal 2 TB', seller:'ClearVault Cloud', v:'content',
   price:6.49, cycle:'Monthly', next:'—', started:'08 Jan 2026', status:'paused', autoRenew:false, resumes:'01 Sep 2026'}
];
let MY_ORDERS = ORDERS.filter(o=>o.buyer==='Priya Raman').slice(0,6);

/* ---------------------- enterprise buyer (B2B persona) -------------------- */
const BUYER = {
  company:'Brightline Foods', id:'ORG-77120', legal:'Brightline Foods Pvt Ltd',
  who:'Arun Deshpande', role:'Procurement lead', sites:14, staff:840,
  budgetYear:180000, budgetSpent:118420.55, terms:'Invoice, net 30', approver:'Meera Nathan (Finance director)',
  policy:'Purchases above $2,000 need finance approval. Security purchases also need an IT sign-off.'
};
const ENT_SUBS = [
  {id:'ESB-201', sku:'SKU-6001', name:'Sentinel Managed Firewall — Standard', seller:'Sentinel Cyber', v:'security',
   unit:'per site', qty:14, price:24.00, monthly:336.00, renews:'01 Oct 2026', status:'active', seatsUsed:14, seatsTotal:14, pending:0},
  {id:'ESB-202', sku:'SKU-6002', name:'Sentinel MDR — 24/7', seller:'Sentinel Cyber', v:'security',
   unit:'per endpoint', qty:620, price:9.50, monthly:5890.00, renews:'01 Oct 2026', status:'active', seatsUsed:588, seatsTotal:620, pending:12},
  {id:'ESB-203', sku:'SKU-6003', name:'Sentinel Secure Access (ZTNA)', seller:'Sentinel Cyber', v:'security',
   unit:'per user', qty:410, price:6.20, monthly:2542.00, renews:'01 Oct 2026', status:'active', seatsUsed:377, seatsTotal:410, pending:0},
  {id:'ESB-204', sku:'SKU-5001', name:'IoT Connect 500 MB', seller:'Aventa Telecom', v:'iot',
   unit:'per SIM', qty:340, price:1.40, monthly:476.00, renews:'Rolling', status:'active', seatsUsed:331, seatsTotal:340, pending:0},
  {id:'ESB-205', sku:'SKU-6005', name:'ClearVault Mail Defence', seller:'ClearVault Cloud', v:'security',
   unit:'per mailbox', qty:840, price:3.40, monthly:2856.00, renews:'01 Jan 2027', status:'active', seatsUsed:812, seatsTotal:840, pending:0},
  {id:'ESB-206', sku:'SKU-6004', name:'Vertex Endpoint Protect', seller:'Vertex Endpoint', v:'security',
   unit:'per endpoint', qty:120, price:4.80, monthly:576.00, renews:'—', status:'suspended', seatsUsed:0, seatsTotal:120, pending:0,
   note:'Seller suspended by the marketplace on 11 Jul. Service continues to contract end; no renewal offered.'}
];
let ENT_MRC = +ENT_SUBS.filter(s=>s.status==='active').reduce((a,s)=>a+s.monthly,0).toFixed(2);

const APPROVALS = [
  {id:'APR-5501', item:'Cold-chain starter — 25 sensors + connectivity', sku:'SKU-5006', v:'iot',
   amount:2450.00, requester:'Ravi Krishnan (Logistics)', raised:'Today 08:40', need:'Finance approval',
   reason:'Cold-chain compliance for the new Pune depot', status:'pending', policy:'Above the $2,000 threshold'},
  {id:'APR-5502', item:'Sentinel MDR — 60 additional endpoints', sku:'SKU-6002', v:'security',
   amount:570.00, requester:'Neha Kulkarni (IT)', raised:'Yesterday', need:'IT sign-off',
   reason:'New starters at the Hyderabad office', status:'pending', policy:'Security purchase — IT sign-off required'},
  {id:'APR-5503', item:'Volta 5G Fixed Wireless CPE ×6', sku:'SKU-4005', v:'device',
   amount:1914.00, requester:'Ravi Krishnan (Logistics)', raised:'2 d ago', need:'None — within policy',
   reason:'Backup connectivity for six depots without fibre', status:'approved', policy:'Below the $2,000 threshold'},
  {id:'APR-5504', item:'Fleet telematics starter — 50 trackers', sku:'SKU-5008', v:'iot',
   amount:4800.00, requester:'Ravi Krishnan (Logistics)', raised:'1 w ago', need:'Finance approval',
   reason:'Trailer tracking pilot', status:'rejected', policy:'Deferred to next budget year'}
];
let APR_PENDING = APPROVALS.filter(a=>a.status==='pending');

/* ------------------------------ notifications ----------------------------- */
const CUR = n => n==null ? null : MP.currency + Math.abs(n).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
const CUR0= n => n==null ? null : MP.currency + Math.round(n).toLocaleString('en-US');


/* ---------------------------------------------------------------------------
   Derived collections are recomputed after every state change, so a completed
   journey is visible everywhere it should be rather than only where it started.
   --------------------------------------------------------------------------- */
function recomputeDerived(){
  LIVE_PARTNERS = PARTNERS.filter(p=>p.status==='live');
  LIVE_PRODUCTS = PRODUCTS.filter(p=>p.status==='live');
  ORD_OPEN  = ORDERS.filter(o=>o.stage < o.stages.length-1 && !o.failed);
  ORD_FAIL  = ORDERS.filter(o=>o.failed);
  ORD_DONE  = ORDERS.filter(o=>o.stage===o.stages.length-1 && !o.failed);
  GMV_BY_V  = {};
  VERTICALS.forEach(v=>{ GMV_BY_V[v.id]=+ORDERS.filter(o=>o.v===v.id).reduce((a,o)=>a+o.gross,0).toFixed(2); });
  GMV        = +Object.values(GMV_BY_V).reduce((a,b)=>a+b,0).toFixed(2);
  COMMISSION = +ORDERS.reduce((a,o)=>a+o.comm,0).toFixed(2);
  TAKE_RATE  = +(COMMISSION/GMV*100).toFixed(1);
  SET_PENDING= SETTLEMENTS.filter(s=>s.status==='pending');
  PAYOUT_DUE = +SETTLEMENTS.filter(s=>s.status!=='paid').reduce((a,s)=>a+s.net,0).toFixed(2);
  APR_PENDING= APPROVALS.filter(a=>a.status==='pending');
  ENT_MRC    = +ENT_SUBS.filter(s=>s.status==='active').reduce((a,s)=>a+s.monthly,0).toFixed(2);
  MY_ORDERS  = ORDERS.filter(o=>o.buyer==='Priya Raman').slice(0,8);
}

/* ===========================================================================
   ROLES, USERS AND NOTIFICATION RULES
   Every portal has an administration surface. The shape is the same — roles,
   a permission grid, a user directory, notification rules — but the content is
   specific to who is being administered.
   =========================================================================== */

/* level in the grid: 2 = full, 1 = scoped, 0 = not permitted */
const ORG_ROLES = {
  operator:[
    {id:'OR-ADMIN', name:'Marketplace admin',    scope:'Whole platform', system:true,
     perms:['partners.invite','partners.suspend','gates.clear','catalogue.decide','plans.edit','settlement.approve','disputes.decide','users.manage']},
    {id:'OR-ONB',   name:'Onboarding desk',      scope:'Applications only', system:true,
     perms:['partners.invite','gates.clear','partners.view','tasks.chase']},
    {id:'OR-CAT',   name:'Catalogue reviewer',   scope:'Listings only', system:true,
     perms:['catalogue.decide','catalogue.view','partners.view']},
    {id:'OR-FIN',   name:'Settlement approver',  scope:'Money only', system:true,
     perms:['settlement.approve','settlement.view','disputes.view','plans.view']},
    {id:'OR-SUP',   name:'Order operations',     scope:'Orders and disputes', system:false,
     perms:['orders.intervene','disputes.decide','partners.view','catalogue.view']},
    /* The desk that answers a ticket is not the desk that reroutes an order.
       Conflating them gave a first-line agent the ability to intervene in
       fulfilment, which is a bigger permission than answering a question. */
    {id:'OR-TKT',   name:'Support desk',         scope:'Tickets and SLA', system:false,
     perms:['tickets.answer','tickets.escalate','orders.view','partners.view','catalogue.view']},
    {id:'OR-WH',    name:'Warehouse and inventory', scope:'Stock, sites and routing', system:false,
     perms:['inventory.adjust','warehouse.config','routing.edit','sim.assign','orders.view']},
    {id:'OR-COL',   name:'Collections',          scope:'Arrears and recovery', system:false,
     perms:['dunning.act','dunning.view','notes.raise','settlement.view','partners.view']},
    {id:'OR-TAX',   name:'Tax and compliance',   scope:'Tax, certificates and the ledger', system:false,
     perms:['tax.config','cert.record','gl.map','settlement.view','audit.read']},
    {id:'OR-MKT',   name:'Growth and promotions', scope:'Offers, banners and rewards', system:false,
     perms:['promo.edit','banner.publish','reward.rule','catalogue.view']},
    {id:'OR-SEC',   name:'Security administrator', scope:'Access, sessions and audit', system:true,
     perms:['users.manage','roles.edit','sessions.end','audit.read','audit.export']},
    {id:'OR-INT',   name:'Integrations',         scope:'APIs, events and channels', system:false,
     perms:['api.registry','events.edit','channels.config','partners.view']},
    {id:'OR-READ',  name:'Read only',            scope:'Whole platform, view', system:false,
     perms:['partners.view','catalogue.view','settlement.view','disputes.view']}
  ],
  partner:[
    {id:'PR-OWNER', name:'Seller admin',         scope:'Whole seller account', system:true,
     perms:['listings.publish','orders.fulfil','settlement.view','settlement.query','onboarding.act','users.manage','plan.view']},
    {id:'PR-CAT',   name:'Catalogue manager',    scope:'Listings only', system:true,
     perms:['listings.publish','listings.draft','plan.view']},
    {id:'PR-FUL',   name:'Fulfilment operator',  scope:'Orders only', system:true,
     perms:['orders.fulfil','orders.view','disputes.respond']},
    {id:'PR-FIN',   name:'Finance',              scope:'Settlement only', system:true,
     perms:['settlement.view','settlement.query','plan.view']},
    {id:'PR-SUP',   name:'Support',              scope:'Disputes only', system:false,
     perms:['disputes.respond','orders.view']}
  ],
  buyer:[
    {id:'BY-PROC',  name:'Procurement lead',     scope:'Whole organisation', system:true,
     perms:['catalogue.buy','requisition.raise','requisition.approve<2000','subs.manage','users.manage','billing.view']},
    {id:'BY-FIN',   name:'Finance approver',     scope:'Approvals and billing', system:true,
     perms:['requisition.approve','billing.view','billing.pay','policy.edit']},
    {id:'BY-IT',    name:'IT approver',          scope:'Security purchases', system:true,
     perms:['requisition.signoff.security','subs.manage','catalogue.view']},
    {id:'BY-REQ',   name:'Requester',            scope:'Own requisitions', system:true,
     perms:['catalogue.buy','requisition.raise','orders.view.own']},
    {id:'BY-LIC',   name:'Licence manager',      scope:'Seats only', system:false,
     perms:['subs.manage','subs.assign','catalogue.view']},
    {id:'BY-READ',  name:'Read only',            scope:'Organisation, view', system:false,
     perms:['catalogue.view','orders.view','billing.view']}
  ],
  consumer:[
    {id:'CO-OWNER', name:'Account owner',        scope:'Everything on the account', system:true,
     perms:['buy.any','subs.manage','billing.view','billing.pay','members.manage','caps.set']},
    {id:'CO-ADULT', name:'Adult member',         scope:'Own line, within a cap', system:true,
     perms:['buy.within-cap','subs.manage.own','orders.view.own']},
    {id:'CO-YOUNG', name:'Young person',         scope:'Own line, approval needed', system:true,
     perms:['buy.request','orders.view.own']},
    {id:'CO-VIEW',  name:'View only',            scope:'Sees the bill, buys nothing', system:false,
     perms:['billing.view','orders.view']}
  ]
};

/* Capability grid. Columns follow the role order above. */
const PERM_GRID = {
  /* One column per role, in the order they appear in ORG_ROLES.operator:
     admin · onboarding · catalogue · settlement · order ops · support desk ·
     warehouse · collections · tax · growth · security · integrations · read. */
  operator:[
    ['Invite and suspend partners',        2,1,0,0,0,0,0,0,0,0,0,0,0],
    ['Clear an onboarding gate',           2,2,0,0,0,0,0,0,0,0,0,0,0],
    ['Approve or reject a listing',        2,0,2,0,0,0,0,0,0,0,0,0,0],
    ['Moderate a customer review',         2,0,2,0,0,1,0,0,0,1,0,0,0],
    ['Edit a commission plan',             2,0,0,1,0,0,0,0,0,0,0,0,0],
    ['Approve a settlement run',           2,0,0,2,0,0,0,0,0,0,0,0,0],
    ['Raise a credit or debit note',       2,0,0,2,0,0,0,2,0,0,0,0,0],
    ['Decide a refund the marketplace owns',2,0,0,2,1,1,0,0,0,0,0,0,0],
    ['Act on an arrears case',             2,0,0,1,0,0,0,2,0,0,0,0,0],
    ['Write off a debt',                   2,0,0,2,0,0,0,1,0,0,0,0,0],
    ['Intervene on a failed order',        2,0,0,0,2,0,1,0,0,0,0,0,0],
    ['Decide a dispute',                   2,0,0,1,2,0,0,0,0,0,0,0,0],
    ['Answer and escalate a ticket',       2,0,0,0,1,2,0,0,0,0,0,0,0],
    ['Adjust stock on hand',               2,0,0,0,0,0,2,0,0,0,0,0,0],
    ['Configure a warehouse',              2,0,0,0,0,0,2,0,0,0,0,0,0],
    ['Change fulfilment routing',          2,0,0,0,1,0,2,0,0,0,0,0,0],
    ['Assign SIM or number ranges',        2,0,0,0,0,0,2,0,0,0,0,0,0],
    ['Change tax configuration',           2,0,0,1,0,0,0,0,2,0,0,0,0],
    ['Record a tax residency certificate', 2,0,0,1,0,0,0,0,2,0,0,0,0],
    ['Change a general ledger mapping',    2,0,0,1,0,0,0,0,2,0,0,0,0],
    ['See a settlement account in full',   2,0,0,2,0,0,0,0,0,0,0,0,0],
    ['Publish a promotion or banner',      2,0,1,0,0,0,0,0,0,2,0,0,0],
    ['Change a reward earn rule',          2,0,0,1,0,0,0,0,0,2,0,0,0],
    ['Adjust a member reward balance',     2,0,0,1,0,1,0,0,0,2,0,0,0],
    ['Register or retire a partner API',   2,0,0,0,0,0,0,0,0,0,0,2,0],
    ['Make a marketplace event mandatory', 2,0,0,0,0,0,0,0,0,0,0,2,0],
    ['Configure a delivery channel',       2,0,0,0,0,1,0,0,0,1,0,2,0],
    ['Manage operator users and roles',    2,0,0,0,0,0,0,0,0,0,2,0,0],
    ['End somebody else’s session',        2,0,0,0,0,0,0,0,0,0,2,0,0],
    ['Read the audit log',                 2,1,1,1,1,1,1,1,2,1,2,1,1],
    ['Export the audit log',               2,0,0,0,0,0,0,0,1,0,2,0,0],
    ['View everything',                    2,2,2,2,2,2,2,2,2,2,2,2,2]
  ],
  partner:[
    ['Create and submit a listing',        2,2,0,0,0],
    ['Withdraw a live listing',            2,2,0,0,0],
    ['Mark an order dispatched',           2,0,2,0,0],
    ['Respond to a dispute',               2,0,1,0,2],
    ['View settlement statements',         2,0,0,2,0],
    ['Query a settlement statement',       2,0,0,2,0],
    ['Act on onboarding tasks',            2,0,0,0,0],
    ['Manage team members and roles',      2,0,0,0,0],
    ['Read the audit log',                 2,1,1,1,1]
  ],
  buyer:[
    ['Browse the business catalogue',      2,1,2,2,2,1],
    ['Raise a requisition',                2,0,0,2,0,0],
    ['Approve under the threshold',        2,2,0,0,0,0],
    ['Approve at or above the threshold',  0,2,0,0,0,0],
    ['Sign off a security purchase',       0,0,2,0,0,0],
    ['Assign and change licence seats',    2,0,2,0,2,0],
    ['View and pay invoices',              1,2,0,0,0,1],
    ['Edit the approval policy',           0,2,0,0,0,0],
    ['Manage users and roles',             2,0,0,0,0,0],
    ['Read the audit log',                 2,1,1,1,1,1]
  ],
  consumer:[
    ['Buy anything on the account',        2,0,0,0],
    ['Buy within a monthly cap',           2,2,0,0],
    ['Request something for approval',     2,2,2,0],
    ['Start or cancel a subscription',     2,1,0,0],
    ['See the whole bill',                 2,0,0,2],
    ['Pay the bill',                       2,0,0,0],
    ['Add or remove people',               2,0,0,0],
    ['Set spend caps',                     2,0,0,0],
    ['Read the account activity log',      2,1,1,1]
  ]
};

const ORG_USERS = {
  operator:[
    {id:'OU-01', name:'Ananya Krishnan',  email:'a.krishnan@6dtech.co.in',  role:'OR-ADMIN', status:'active',  lastActive:'Now',        mfa:true,  joined:'02 Mar 2024', you:true},
    {id:'OU-02', name:'Lena Fischer',     email:'l.fischer@6dtech.co.in',   role:'OR-ONB',   status:'active',  lastActive:'12 min ago', mfa:true,  joined:'14 Apr 2024'},
    {id:'OU-03', name:'Tomas Novak',      email:'t.novak@gmail.com',     role:'OR-CAT',   status:'active',  lastActive:'1 h ago',    mfa:true,  joined:'03 Jun 2024'},
    {id:'OU-04', name:'Ruben Oyelaran',   email:'r.oyelaran@6dtech.co.in',  role:'OR-FIN',   status:'active',  lastActive:'3 h ago',    mfa:true,  joined:'19 Sep 2024'},
    {id:'OU-05', name:'Farah Al Hashimi', email:'f.hashimi@6dtech.co.in',   role:'OR-SUP',   status:'active',  lastActive:'26 min ago', mfa:false, joined:'11 Jan 2025'},
    {id:'OU-06', name:'Marek Zielinski',  email:'m.zielinski@gmail.com', role:'OR-SUP',   status:'active',  lastActive:'Yesterday',  mfa:true,  joined:'07 Mar 2025'},
    {id:'OU-07', name:'Divya Rao',        email:'d.rao@gmail.com',       role:'OR-READ',  status:'active',  lastActive:'4 d ago',    mfa:true,  joined:'22 Aug 2025'},
    {id:'OU-08', name:'Chen Yu Hsu',      email:'c.hsu@gmail.com',       role:'OR-CAT',   status:'invited', lastActive:'Never',      mfa:false, joined:'21 Jul 2026'},
    {id:'OU-09', name:'Noa Barak',        email:'n.barak@6dtech.co.in',     role:'OR-SUP',   status:'suspended',lastActive:'6 w ago',   mfa:false, joined:'30 May 2025',
     note:'Suspended pending an access review after leaving the care desk.'},
    /* A role nobody holds is a role nobody maintains, so every one of them has
       somebody in it — and the split between them is the point. */
    {id:'OU-10', name:'Priyanka Shetty',  email:'p.shetty@6dtech.co.in',   role:'OR-TKT',   status:'active',  lastActive:'8 min ago',  mfa:true,  joined:'04 Feb 2025'},
    {id:'OU-11', name:'Kwame Mensah',     email:'k.mensah@gmail.com',      role:'OR-TKT',   status:'active',  lastActive:'41 min ago', mfa:true,  joined:'17 Jun 2025'},
    {id:'OU-12', name:'Ravi Shankar',     email:'r.shankar@6dtech.co.in',  role:'OR-WH',    status:'active',  lastActive:'2 h ago',    mfa:true,  joined:'09 May 2024'},
    {id:'OU-13', name:'Layla Haddad',     email:'l.haddad@gmail.com',      role:'OR-WH',    status:'active',  lastActive:'5 h ago',    mfa:true,  joined:'23 Oct 2024'},
    {id:'OU-14', name:'Sofia Almeida',    email:'s.almeida@6dtech.co.in',  role:'OR-COL',   status:'active',  lastActive:'35 min ago', mfa:true,  joined:'12 Nov 2024'},
    {id:'OU-15', name:'Renu Iyer',        email:'r.iyer@6dtech.co.in',     role:'OR-COL',   status:'active',  lastActive:'Yesterday',  mfa:true,  joined:'02 Feb 2025'},
    {id:'OU-16', name:'Tomas Alvarez',    email:'t.alvarez@gmail.com',     role:'OR-TAX',   status:'active',  lastActive:'1 h ago',    mfa:true,  joined:'14 Mar 2024'},
    {id:'OU-17', name:'Aisha Rahman',     email:'a.rahman@6dtech.co.in',   role:'OR-MKT',   status:'active',  lastActive:'19 min ago', mfa:true,  joined:'08 Jan 2025'},
    {id:'OU-18', name:'Joost Bakker',     email:'j.bakker@gmail.com',      role:'OR-MKT',   status:'active',  lastActive:'3 d ago',    mfa:false, joined:'21 Apr 2025'},
    /* Two people in the security role, because one is a single point of
       failure on the one role that can restore everybody else's access. */
    {id:'OU-19', name:'Miriam Osei',      email:'m.osei@6dtech.co.in',     role:'OR-SEC',   status:'active',  lastActive:'22 min ago', mfa:true,  joined:'01 Mar 2024'},
    {id:'OU-20', name:'Henrik Lund',      email:'h.lund@6dtech.co.in',     role:'OR-SEC',   status:'active',  lastActive:'Yesterday',  mfa:true,  joined:'15 Sep 2024'},
    {id:'OU-21', name:'Wei Lin Tan',      email:'w.tan@gmail.com',         role:'OR-INT',   status:'active',  lastActive:'54 min ago', mfa:true,  joined:'27 Jul 2024'},
    {id:'OU-22', name:'Gabriel Rossi',    email:'g.rossi@6dtech.co.in',    role:'OR-INT',   status:'invited', lastActive:'Never',      mfa:false, joined:'24 Jul 2026'},
    {id:'OU-23', name:'Amara Okonkwo',    email:'a.okonkwo@gmail.com',     role:'OR-READ',  status:'active',  lastActive:'1 w ago',    mfa:true,  joined:'11 Dec 2024'}
  ],
  partner:[
    {id:'PU-01', name:'Katrin Boehm',   email:'k.boehm@gmail.com',  role:'PR-OWNER', status:'active',  lastActive:'Now',       mfa:true,  joined:'27 Sep 2024', you:true},
    {id:'PU-02', name:'Jonas Weber',    email:'j.weber@6dtech.co.in',  role:'PR-CAT',   status:'active',  lastActive:'2 h ago',   mfa:true,  joined:'04 Oct 2024'},
    {id:'PU-03', name:'Ingrid Sorensen',email:'i.sorensen@6dtech.co.in',role:'PR-FUL',  status:'active',  lastActive:'18 min ago',mfa:false, joined:'04 Oct 2024'},
    {id:'PU-04', name:'Felix Meyer',    email:'f.meyer@gmail.com',  role:'PR-FIN',   status:'active',  lastActive:'Yesterday', mfa:true,  joined:'12 Feb 2025'},
    {id:'PU-05', name:'Hanna Ilves',    email:'h.ilves@gmail.com',  role:'PR-SUP',   status:'active',  lastActive:'3 d ago',   mfa:false, joined:'08 Jun 2025'},
    {id:'PU-06', name:'Lars Berg',      email:'l.berg@6dtech.co.in',   role:'PR-FUL',   status:'invited', lastActive:'Never',     mfa:false, joined:'23 Jul 2026'}
  ],
  buyer:[
    {id:'BU-01', name:'Arun Deshpande', email:'a.deshpande@6dtech.co.in', role:'BY-PROC', status:'active',  lastActive:'Now',        mfa:true,  joined:'14 Feb 2024', you:true},
    {id:'BU-02', name:'Meera Nathan',   email:'m.nathan@6dtech.co.in',    role:'BY-FIN',  status:'active',  lastActive:'40 min ago', mfa:true,  joined:'14 Feb 2024'},
    {id:'BU-03', name:'Neha Kulkarni',  email:'n.kulkarni@6dtech.co.in',  role:'BY-IT',   status:'active',  lastActive:'2 h ago',    mfa:true,  joined:'03 Apr 2024'},
    {id:'BU-04', name:'Ravi Krishnan',  email:'r.krishnan@gmail.com',  role:'BY-REQ',  status:'active',  lastActive:'Today 08:40',mfa:false, joined:'19 Jun 2024'},
    {id:'BU-05', name:'Sanjay Iyer',    email:'s.iyer@6dtech.co.in',      role:'BY-LIC',  status:'active',  lastActive:'Yesterday',  mfa:true,  joined:'02 Sep 2024'},
    {id:'BU-06', name:'Priyanka Shet',  email:'p.shet@gmail.com',      role:'BY-REQ',  status:'active',  lastActive:'5 d ago',    mfa:false, joined:'11 Nov 2024'},
    {id:'BU-07', name:'Anil Menon',     email:'a.menon@gmail.com',     role:'BY-READ', status:'active',  lastActive:'2 w ago',    mfa:true,  joined:'14 Feb 2024'},
    {id:'BU-08', name:'Deepa Suresh',   email:'d.suresh@gmail.com',    role:'BY-REQ',  status:'invited', lastActive:'Never',      mfa:false, joined:'24 Jul 2026'}
  ],
  consumer:[
    {id:'CU-01', name:'Priya Raman',   email:'priya.raman@6dtech.co.in',  role:'CO-OWNER', status:'active',  lastActive:'Now',       mfa:true,  joined:'14 Jun 2024', you:true,  cap:null, spent:0},
    {id:'CU-02', name:'Vikram Raman',  email:'v.raman@gmail.com',      role:'CO-ADULT', status:'active',  lastActive:'1 h ago',   mfa:true,  joined:'14 Jun 2024', cap:40, spent:22.99},
    {id:'CU-03', name:'Aditi Raman',   email:'aditi.r@gmail.com',      role:'CO-YOUNG', status:'active',  lastActive:'Yesterday', mfa:false, joined:'02 Feb 2025', cap:15, spent:9.99},
    {id:'CU-04', name:'Lakshmi Raman', email:'l.raman@gmail.com',      role:'CO-VIEW',  status:'active',  lastActive:'1 w ago',   mfa:false, joined:'02 Feb 2025', cap:0,  spent:0},
    {id:'CU-05', name:'Rohan Raman',   email:'rohan.r@gmail.com',      role:'CO-YOUNG', status:'invited', lastActive:'Never',     mfa:false, joined:'24 Jul 2026', cap:15, spent:0}
  ]
};

/* Notification rules. `on` is live state — the toggles change it. */
const NOTIF_RULES = {
  operator:[
    {id:'NR-O1', name:'Listing breaches policy',      event:'An automated policy check fails on a submitted listing', chans:['In-app','Email'],        who:'Catalogue reviewers', on:true,  last:'18 min ago', sev:'high'},
    {id:'NR-O2', name:'KYC failure',                  event:'A partner fails due diligence at the KYC gate',          chans:['In-app','Email'],        who:'Onboarding desk',     on:true,  last:'Yesterday',  sev:'high'},
    {id:'NR-O3', name:'Dispute SLA breach',           event:'A dispute passes its 5-day resolution target',           chans:['In-app','Email','SMS'],  who:'Support and admins',  on:true,  last:'1 h ago',    sev:'high'},
    {id:'NR-O4', name:'Settlement run ready',         event:'A period closes and statements are ready to approve',    chans:['Email'],                 who:'Settlement approvers',on:true,  last:'3 h ago',    sev:'normal'},
    {id:'NR-O5', name:'Order fulfilment failed',      event:'An order fails at any pipeline stage',                   chans:['In-app'],                who:'Support agents',      on:true,  last:'22 min ago', sev:'normal'},
    {id:'NR-O6', name:'Onboarding SLA at risk',       event:'An application passes 80% of its 12-day target',         chans:['In-app','Email'],        who:'Onboarding desk',     on:true,  last:'2 d ago',    sev:'normal'},
    {id:'NR-O7', name:'Partner GMV milestone',        event:'A partner crosses a commission tier threshold',          chans:['Email'],                 who:'Marketplace admins',  on:false, last:'Never',      sev:'low'},
    {id:'NR-O8', name:'Weekly marketplace digest',    event:'Every Monday at 07:00',                                  chans:['Email'],                 who:'All operator staff',  on:true,  last:'Monday',     sev:'low'}
  ],
  partner:[
    {id:'NR-P1', name:'New order',                    event:'A buyer places an order against one of your listings',   chans:['In-app','Email'],        who:'Fulfilment operators',on:true,  last:'9 min ago',  sev:'normal'},
    {id:'NR-P2', name:'Order failed',                 event:'Fulfilment fails and the order will not settle',         chans:['In-app','Email','SMS'],  who:'Seller admin, fulfilment', on:true, last:'2 h ago', sev:'high'},
    {id:'NR-P3', name:'Listing decision',             event:'The marketplace approves or rejects a listing',          chans:['In-app','Email'],        who:'Catalogue managers',  on:true,  last:'3 d ago',    sev:'normal'},
    {id:'NR-P4', name:'Settlement statement ready',   event:'A statement is produced for a closed period',            chans:['Email'],                 who:'Finance',             on:true,  last:'5 h ago',    sev:'normal'},
    {id:'NR-P5', name:'Onboarding task assigned',     event:'A gate opens with a task owned by you',                  chans:['In-app','Email'],        who:'Seller admin',        on:true,  last:'25 min ago', sev:'high'},
    {id:'NR-P6', name:'Dispute raised',               event:'A buyer disputes one of your orders',                    chans:['In-app','Email'],        who:'Support',             on:true,  last:'4 d ago',    sev:'high'},
    {id:'NR-P7', name:'Document expiring',            event:'A compliance document expires within 60 days',           chans:['Email'],                 who:'Seller admin',        on:true,  last:'Yesterday',  sev:'normal'},
    {id:'NR-P8', name:'Low stock',                    event:'A physical listing drops below its reorder point',       chans:['In-app'],                who:'Fulfilment operators',on:false, last:'Never',      sev:'low'}
  ],
  buyer:[
    {id:'NR-B1', name:'Requisition needs approval',   event:'A requisition lands above a policy threshold',           chans:['In-app','Email'],        who:'Finance and IT approvers', on:true, last:'Today 08:40', sev:'high'},
    {id:'NR-B2', name:'Requisition decided',          event:'Your requisition is approved or declined',               chans:['In-app','Email'],        who:'The requester',       on:true,  last:'Yesterday',  sev:'normal'},
    {id:'NR-B3', name:'Order provisioned',            event:'A seller confirms a service is live',                    chans:['In-app'],                who:'Requester and IT',    on:true,  last:'2 d ago',    sev:'normal'},
    {id:'NR-B4', name:'Invoice due or overdue',       event:'3 days before the due date, and on the day it passes',   chans:['Email','SMS'],           who:'Finance approvers',   on:true,  last:'2 h ago',    sev:'high'},
    {id:'NR-B5', name:'Seller suspended',             event:'A seller you hold a subscription with is suspended',     chans:['In-app','Email'],        who:'Procurement and IT',  on:true,  last:'35 min ago', sev:'high'},
    {id:'NR-B6', name:'Licence utilisation',          event:'Assigned seats pass 90% or fall below 60% of licensed',  chans:['Email'],                 who:'Licence managers',    on:true,  last:'1 w ago',    sev:'normal'},
    {id:'NR-B7', name:'Renewal approaching',          event:'30 days before a subscription renews',                   chans:['Email'],                 who:'Procurement lead',    on:true,  last:'3 w ago',    sev:'normal'},
    {id:'NR-B8', name:'Budget threshold',             event:'Committed spend passes 80% of the annual budget',        chans:['In-app','Email'],        who:'Procurement and finance', on:false, last:'Never',  sev:'normal'}
  ],
  consumer:[
    {id:'NR-C1', name:'Order and delivery updates',   event:'Every time an order changes stage',                      chans:['Push','SMS'],            who:'You',                 on:true,  last:'20 min ago', sev:'normal'},
    {id:'NR-C2', name:'Delivery problem',             event:'A delivery attempt fails or is delayed',                 chans:['Push','SMS','Email'],    who:'You',                 on:true,  last:'2 h ago',    sev:'high'},
    {id:'NR-C3', name:'Before a subscription renews', event:'3 days before any subscription renews',                  chans:['Push','Email'],          who:'You',                 on:true,  last:'Yesterday',  sev:'normal'},
    {id:'NR-C4', name:'Price change on a subscription',event:'A seller changes the price of something you hold',      chans:['Email'],                 who:'You',                 on:true,  last:'Never',      sev:'high'},
    {id:'NR-C5', name:'A household member asks to buy',event:'Someone on your account needs your approval',           chans:['Push'],                  who:'Account owner',       on:true,  last:'4 d ago',    sev:'normal'},
    {id:'NR-C6', name:'Spend cap reached',            event:'A member reaches their monthly cap',                     chans:['Push','Email'],          who:'Account owner',       on:true,  last:'2 w ago',    sev:'normal'},
    {id:'NR-C7', name:'Bill ready',                   event:'Your monthly bill is issued',                            chans:['Push','Email'],          who:'You',                 on:true,  last:'01 Jul',     sev:'normal'},
    {id:'NR-C8', name:'Offers and recommendations',   event:'Deals picked from what you already have',                chans:['Push','Email'],          who:'You',                 on:false, last:'Never',      sev:'low'}
  ]
};

const NOTIF_PREFS = {
  operator:{digest:'Daily digest at 08:00', quiet:'None — operations run 24/7', escalate:true},
  partner: {digest:'Off — send every alert', quiet:'21:00 to 07:00 except failures', escalate:true},
  buyer:   {digest:'Daily digest at 08:00', quiet:'19:00 to 08:00 except overdue invoices', escalate:false},
  consumer:{digest:'Off — send every alert', quiet:'22:00 to 07:00 except delivery problems', escalate:false}
};

const NOTIF_LOG = {
  operator:[
    {when:'18 min ago', rule:'Listing breaches policy', to:'Catalogue reviewers (2)', chan:'In-app, Email', state:'delivered'},
    {when:'1 h ago',    rule:'Dispute SLA breach',      to:'Support and admins (4)',  chan:'In-app, Email, SMS', state:'delivered'},
    {when:'3 h ago',    rule:'Settlement run ready',    to:'Settlement approvers (1)',chan:'Email', state:'delivered'},
    {when:'Yesterday',  rule:'KYC failure',             to:'Onboarding desk (2)',     chan:'In-app, Email', state:'delivered'},
    {when:'2 d ago',    rule:'Onboarding SLA at risk',  to:'Onboarding desk (2)',     chan:'Email', state:'bounced'}
  ],
  partner:[
    {when:'9 min ago',  rule:'New order',               to:'Fulfilment operators (2)',chan:'In-app, Email', state:'delivered'},
    {when:'25 min ago', rule:'Onboarding task assigned',to:'Katrin Boehm',            chan:'In-app, Email', state:'delivered'},
    {when:'2 h ago',    rule:'Order failed',            to:'Seller admin, fulfilment (3)', chan:'In-app, Email, SMS', state:'delivered'},
    {when:'5 h ago',    rule:'Settlement statement ready', to:'Felix Meyer',          chan:'Email', state:'delivered'},
    {when:'Yesterday',  rule:'Document expiring',       to:'Katrin Boehm',            chan:'Email', state:'delivered'}
  ],
  buyer:[
    {when:'35 min ago', rule:'Seller suspended',        to:'Procurement and IT (2)',  chan:'In-app, Email', state:'delivered'},
    {when:'Today 08:40',rule:'Requisition needs approval', to:'Meera Nathan',         chan:'In-app, Email', state:'delivered'},
    {when:'2 h ago',    rule:'Invoice due or overdue',  to:'Finance approvers (1)',   chan:'Email, SMS', state:'delivered'},
    {when:'2 d ago',    rule:'Order provisioned',       to:'Ravi Krishnan',           chan:'In-app', state:'delivered'},
    {when:'1 w ago',    rule:'Licence utilisation',     to:'Sanjay Iyer',             chan:'Email', state:'delivered'}
  ],
  consumer:[
    {when:'20 min ago', rule:'Order and delivery updates', to:'You',                  chan:'Push, SMS', state:'delivered'},
    {when:'2 h ago',    rule:'Delivery problem',        to:'You',                     chan:'Push, SMS, Email', state:'delivered'},
    {when:'Yesterday',  rule:'Before a subscription renews', to:'You',                chan:'Push, Email', state:'delivered'},
    {when:'4 d ago',    rule:'A household member asks to buy', to:'Priya Raman',      chan:'Push', state:'delivered'},
    {when:'2 w ago',    rule:'Spend cap reached',       to:'Priya Raman',             chan:'Push, Email', state:'delivered'}
  ]
};

/* ===========================================================================
   CONSUMER ACCOUNT RECORDS
   Everything the account screens act on. These are mutable — the screens
   change them and the changes persist for the rest of the session.
   =========================================================================== */
const MY_PAYMENTS = [
  {id:'PM-1', kind:'Bill to mobile', detail:'+91 98860 41127', holder:'Priya Raman',
   expires:null, primary:true,  status:'active', added:'14 Jun 2024'},
  {id:'PM-2', kind:'Visa',           detail:'•••• 4419',      holder:'P Raman',
   expires:'09/2028', primary:false, status:'active', added:'02 Nov 2024'},
  {id:'PM-3', kind:'Mastercard',     detail:'•••• 8871',      holder:'P Raman',
   expires:'03/2026', primary:false, status:'expired', added:'19 Mar 2024'}
];
const MY_ADDRESSES = [
  {id:'AD-1', label:'Home',  line1:'42 Rustom Bagh, HAL Old Airport Road', city:'Bengaluru',
   pin:'560017', phone:'+91 98860 41127', notes:'Leave with the security desk if out', default:true},
  {id:'AD-2', label:'Work',  line1:'Prestige Tech Park, Marathahalli', city:'Bengaluru',
   pin:'560103', phone:'+91 98860 41127', notes:'Reception, tower B, 09:00 to 18:00', default:false}
];
const MY_PREFS = {
  offers:true, orderUpdates:true, partnerMarketing:false,
  lang:'English', tz:'Asia/Kolkata (IST)', units:'GB', dark:false, reduceMotion:true, assistant:true
};
const MY_SAVED = ['SKU-4004'];
const MY_DATA_REQUESTS = [];
const MY_CLOSURE = {requested:false, effective:null};
const MY_WALLET_LOG = [
  {when:'02 Jul 2026', what:'Top-up from Visa •••• 4419', amount:25.00},
  {when:'18 Jun 2026', what:'Refund — PlayForge Season Pass', amount:24.99},
  {when:'11 Jun 2026', what:'Spent on StreamNova Premium', amount:-12.99}
];

/* Trade-in valuations. Deliberately a fixed grid, not a quote engine. */
const TRADEIN = {
  models:[
    {id:'TI-1', name:'Kestrel K9 Pro 256 GB',  good:310, fair:225, poor:120},
    {id:'TI-2', name:'Kestrel K9 Lite 128 GB', good:140, fair:95,  poor:45},
    {id:'TI-3', name:'Kestrel K7 64 GB',       good:60,  fair:38,  poor:15},
    {id:'TI-4', name:'Other or older handset', good:40,  fair:25,  poor:10}
  ],
  conditions:[
    {id:'good', name:'Good',  desc:'Powers on, no cracks, screen unmarked, battery holds a day'},
    {id:'fair', name:'Fair',  desc:'Powers on, light scuffs or a small scratch, battery weaker'},
    {id:'poor', name:'Poor',  desc:'Powers on but cracked, dented or heavily worn'}
  ]
};
let TRADEIN_CREDIT = 0;

/* Coverage lookup. A handful of real answers plus an honest miss. */
const COVERAGE = {
  '560017':{area:'HAL Old Airport Road, Bengaluru', fiveG:'Excellent', fourG:'Excellent', indoor:'Strong', note:null},
  '560103':{area:'Marathahalli, Bengaluru',         fiveG:'Good',      fourG:'Excellent', indoor:'Strong', note:null},
  '560001':{area:'Bengaluru GPO',                   fiveG:'Good',      fourG:'Excellent', indoor:'Variable',
            note:'Older buildings in this area report weaker indoor 5G. A Wi-Fi calling handset is worth having.'},
  '400001':{area:'Fort, Mumbai',                    fiveG:'Excellent', fourG:'Excellent', indoor:'Strong', note:null},
  '110001':{area:'Connaught Place, Delhi',          fiveG:'Excellent', fourG:'Excellent', indoor:'Strong', note:null},
  '682001':{area:'Ernakulam, Kochi',                fiveG:null,        fourG:'Good',      indoor:'Variable',
            note:'5G has not been surveyed here yet, so we will not claim a level for it.'}
};

/* ===========================================================================
   SECURITY, BILL FORMATTING AND PER-PARTNER BILLING
   =========================================================================== */

/* Password and session state per user. Kept separate from the profile so it is
   obvious that nothing here is a credential — only its metadata. */
Object.keys(ORG_USERS).forEach(ctx=>{
  ORG_USERS[ctx].forEach((u,i)=>{
    u.pwdChanged   = u.status==='invited' ? null : ['12 Jun 2026','04 Mar 2026','21 Jan 2026','09 Nov 2025','17 Aug 2025'][i%5];
    u.mustReset    = false;
    u.pwdStrength  = ['strong','strong','fair','strong','weak','fair','strong','strong','fair'][i%9];
    u.sessions     = u.status==='active' ? (i%3===0?2:1) : 0;
    u.lastReset    = null;
  });
});
const PWD_POLICY = {
  minLength:12, mixedCase:true, number:true, symbol:true,
  reuse:'Cannot match the last 5', expiry:'No forced expiry — rotation on suspicion only',
  lockout:'5 failed attempts locks the account for 15 minutes',
  mfa:'Required for anyone who can approve, pay or manage users'
};

/* How documents are rendered. Two contexts: what the marketplace issues to
   partners (self-billing) and what a buyer receives. */
/* BILL_FORMAT is gone: document formatting now lives on the template, so a
   numbering pattern and a document title cannot disagree about one bill. */

/* Per-partner billing. A plan sets the default; a partner can be overridden,
   and the override is what actually runs. */
const PARTNER_BILLING = {};
PARTNERS.forEach(p=>{
  const plan = p.plan ? CPMAP[p.plan] : null;
  PARTNER_BILLING[p.id] = {
    partnerId:p.id,
    cycle:      plan ? plan.cycle.split(',')[0].trim() : 'Monthly',
    terms:      plan ? (plan.cycle.split(',')[1]||' net 30').trim() : 'net 30',
    holdback:   plan ? plan.hold : 'None',
    minPayout:  50,
    currency:   'USD',
    method:     p.country==='India'?'NEFT':p.country==='Kenya'?'SWIFT':'SEPA',
    selfBill:   true,
    override:   false,
    note:       null
  };
});
/* Three partners genuinely differ from their plan default. */
if(PARTNER_BILLING['PTR-1002']) Object.assign(PARTNER_BILLING['PTR-1002'],
  {cycle:'Fortnightly', terms:'net 14', minPayout:250, override:true,
   note:'Negotiated at contract. High volume, so a shorter cycle reduces their working-capital exposure.'});
if(PARTNER_BILLING['PTR-1011']) Object.assign(PARTNER_BILLING['PTR-1011'],
  {holdback:'30 days', minPayout:100, override:true,
   note:'Newest partner and lowest rating. Extended holdback until the returns pattern is established.'});
if(PARTNER_BILLING['PTR-1014']) Object.assign(PARTNER_BILLING['PTR-1014'],
  {selfBill:false, override:true, note:'Rejected at KYC — no settlement configuration is active.'});
const BILL_CYCLES = ['Weekly','Fortnightly','Monthly','Quarterly'];
const BILL_TERMS  = ['net 7','net 14','net 15','net 30','net 45'];
const BILL_HOLD   = ['None','7 days','14 days (returns window)','30 days'];

/* ===========================================================================
   MARKETPLACE POLICY
   Each vertical carries its own catalogue rules. They are the reason a listing
   is approved or held, so they belong next to the marketplace, not in a wiki.
   =========================================================================== */
VERTICALS.forEach(v=>{ v.enabled = true; v.status = 'live'; });

/* How a rule is actually checked. The distinction matters commercially: an
   automated rule costs nothing per listing, a manual one consumes reviewer
   time, and a document rule stalls until the seller uploads something. */
const RULE_CHECKS = [
  {id:'auto',   label:'Automated',      detail:'Evaluated by the platform at submission. No reviewer time.'},
  {id:'doc',    label:'Document',       detail:'Blocks until the seller supplies evidence, then a reviewer accepts it.'},
  {id:'manual', label:'Manual',         detail:'A reviewer judges it. Costs queue time on every listing it applies to.'},
  {id:'extern', label:'External check', detail:'Calls a third party — screening, registry lookup, attestation validation.'}
];
const RULE_BASIS = ['Regulatory','Commercial','Trust and safety','Operational'];

/* The rule catalogue. Authored on the Listing rules screen; applied per
   category in VERTICAL_POLICY. A rule is retired, never deleted — historical
   review decisions reference it and would otherwise become unreadable. */
const POLICY_RULES = [
  {id:'PR-01', name:'Content and age rating',    desc:'A listing must declare an age rating recognised in every market it is sold in.',
   check:'doc',    basis:'Regulatory',       owner:'Trust and safety', evidence:'Age rating certificate per market',
   blocks:true,  appeal:true,  added:'02 Mar 2024', status:'active'},
  {id:'PR-02', name:'Randomised paid rewards',   desc:'Paid loot boxes and randomised rewards are prohibited where local law treats them as gambling.',
   check:'manual', basis:'Regulatory',       owner:'Legal',            evidence:'Mechanic description and market list',
   blocks:true,  appeal:false, added:'02 Mar 2024', status:'active'},
  {id:'PR-03', name:'Price floor',               desc:'A retail price may not sit below the wholesale floor for the same item.',
   check:'auto',   basis:'Commercial',       owner:'Commercial',       evidence:'None — computed from the price record',
   blocks:true,  appeal:true,  added:'02 Mar 2024', status:'active'},
  {id:'PR-04', name:'Type approval',             desc:'Radio equipment needs a valid type-approval certificate for each target market.',
   check:'doc',    basis:'Regulatory',       owner:'Compliance',       evidence:'Type-approval certificate per market',
   blocks:true,  appeal:false, added:'02 Mar 2024', status:'active'},
  {id:'PR-05', name:'Data processing terms',     desc:'Anything processing customer data needs a signed DPA before it may list.',
   check:'doc',    basis:'Regulatory',       owner:'Legal',            evidence:'Countersigned DPA',
   blocks:true,  appeal:false, added:'02 Mar 2024', status:'active'},
  {id:'PR-06', name:'Security attestation',      desc:'Security products need an independent attestation no older than 12 months.',
   check:'doc',    basis:'Trust and safety', owner:'Security',         evidence:'SOC 2 Type II or ISO 27001 certificate',
   blocks:true,  appeal:true,  added:'19 Apr 2024', status:'active'},
  {id:'PR-07', name:'Fulfilment SLA',            desc:'The seller commits to a stated dispatch or provisioning window.',
   check:'auto',   basis:'Operational',      owner:'Operations',       evidence:'None — read from the listing',
   blocks:true,  appeal:true,  added:'02 Mar 2024', status:'active'},
  {id:'PR-08', name:'Returns window',            desc:'A physical item carries a returns window of at least the statutory minimum.',
   check:'auto',   basis:'Regulatory',       owner:'Legal',            evidence:'None — read from the listing',
   blocks:true,  appeal:false, added:'02 Mar 2024', status:'active'},
  {id:'PR-09', name:'Rights evidence',           desc:'Content listings must evidence distribution rights for each market.',
   check:'doc',    basis:'Regulatory',       owner:'Legal',            evidence:'Distribution agreement or rights letter',
   blocks:true,  appeal:false, added:'02 Mar 2024', status:'active'},
  {id:'PR-10', name:'Sanctions screening',       desc:'The seller and its beneficial owners are screened before any listing goes live.',
   check:'extern', basis:'Regulatory',       owner:'Compliance',       evidence:'Screening result, refreshed every 90 days',
   blocks:true,  appeal:false, added:'02 Mar 2024', status:'active',
   locked:'Sanctions screening cannot be turned off or downgraded to a warning in any category. It is not a marketplace policy choice.'},
  {id:'PR-11', name:'Accessibility statement',   desc:'Software listings sold to enterprise buyers must carry an accessibility conformance statement.',
   check:'doc',    basis:'Commercial',       owner:'Product',          evidence:'VPAT or EN 301 549 statement',
   blocks:false, appeal:true,  added:'11 Jul 2026', status:'draft',
   note:'Drafted after three enterprise tenders asked for it. Not yet applied to any category.'}
];
const RULE_MAP = {}; POLICY_RULES.forEach(r=>RULE_MAP[r.id]=r);

/* enforce | warn | off — a rule that only warns still shows on the review. */
const VERTICAL_POLICY = {
  consumer:{review:'Automated with spot check', autoPublish:true,  returns:'14 days', slaHours:48,
            priceFloor:true, ratingRequired:false, minRating:3.0, maxListingsPerSeller:250,
            rules:{'PR-01':'warn','PR-03':'enforce','PR-05':'enforce','PR-07':'enforce','PR-08':'enforce','PR-10':'enforce'}},
  partner: {review:'Manual — every listing', autoPublish:false, returns:'Contractual', slaHours:72,
            priceFloor:true, ratingRequired:false, minRating:3.5, maxListingsPerSeller:60,
            rules:{'PR-03':'enforce','PR-05':'enforce','PR-07':'enforce','PR-10':'enforce'}},
  iot:     {review:'Manual — every listing', autoPublish:false, returns:'30 days', slaHours:120,
            priceFloor:false, ratingRequired:false, minRating:3.0, maxListingsPerSeller:120,
            rules:{'PR-04':'enforce','PR-05':'enforce','PR-07':'enforce','PR-08':'warn','PR-10':'enforce'}},
  security:{review:'Manual — every listing', autoPublish:false, returns:'Not applicable', slaHours:96,
            priceFloor:false, ratingRequired:true,  minRating:4.0, maxListingsPerSeller:40,
            rules:{'PR-05':'enforce','PR-06':'enforce','PR-07':'enforce','PR-10':'enforce'}},
  device:  {review:'Automated with spot check', autoPublish:true,  returns:'14 days', slaHours:48,
            priceFloor:true, ratingRequired:false, minRating:3.0, maxListingsPerSeller:400,
            rules:{'PR-03':'enforce','PR-04':'enforce','PR-07':'enforce','PR-08':'enforce','PR-10':'enforce'}},
  content: {review:'Manual — every listing', autoPublish:false, returns:'Not applicable', slaHours:24,
            priceFloor:false, ratingRequired:true,  minRating:3.0, maxListingsPerSeller:180,
            rules:{'PR-01':'enforce','PR-02':'enforce','PR-05':'enforce','PR-09':'enforce','PR-10':'enforce'}}
};
const POLICY_LEVELS = ['off','warn','enforce'];

/* Onboarding gate policy — what each gate demands and who owns it. */
const GATE_POLICY = {};
/* Five working days end to end. The gates that are a decision on evidence
   already supplied clear the same day; only the ones that need somebody to do
   work carry a day of their own. A ladder whose targets sum to more than the
   published SLA is a promise the process cannot keep. */
[['apply','Marketplace onboarding desk',0,false,['Registered company name','Trading address','Marketplaces applied for','Expected monthly volume']],
 ['kyc','Risk and compliance',2,true,['Certificate of incorporation','Beneficial ownership over 25%','Sanctions and PEP screening','Adverse media check']],
 ['agree','Legal',1,true,['Marketplace terms, e-signed','Data processing agreement','Commission schedule acknowledged']],
 ['finance','Finance',1,true,['Settlement bank account','Bank verification (penny test)','Tax residency certificate','Withholding declaration']],
 ['tech','Platform engineering',1,false,['Catalogue feed or portal upload','Fulfilment webhook reachable','One successful sandbox order']],
 ['assure','Risk and compliance',0,true,['Security questionnaire','Content policy acknowledgement','Sample listing audit']],
 ['golive','Marketplace onboarding desk',0,false,['Storefront enabled','At least one listing published']]
].forEach(g=>{
  GATE_POLICY[g[0]] = {gate:g[0], owner:g[1], slaDays:g[2], dualControl:g[3], evidence:g[4],
                       autoAdvance:false, waivable:g[0]!=='kyc' && g[0]!=='agree'};
});
const GATE_OWNERS = ['Marketplace onboarding desk','Risk and compliance','Legal','Finance','Platform engineering'];

/* Queries raised against a listing under review. */
const LISTING_QUERIES = [
  {id:'LQ-Q-401', sku:'SKU-4007', partner:'Lumen Wearables', subject:'Type approval evidence',
   asked:'20 Jul 2026', due:'24 Jul 2026', status:'overdue', by:'Tomas Novak',
   body:'Type-approval certificates are attached for India only. Please supply the equivalent for UAE and Kenya, or withdraw those two markets from the listing.'}
];

/* ===========================================================================
   TAX
   The marketplace is merchant of record in some places and not others. That
   single fact drives who charges the tax, who remits it and what the invoice
   has to say — so it is configuration, not a constant.
   =========================================================================== */
const TAX_REGIMES = [
  {id:'TX-IN', country:'India',          label:'GST',  rate:18, mor:true,
   reg:'29AABCS1429B1ZQ', scheme:'GST — marketplace as e-commerce operator',
   tcs:1.0, tcsNote:'TCS at 1% on net taxable supplies, deposited by the 10th',
   placeOfSupply:'Recipient location', digital:'OIDAR rules apply to overseas content sellers', status:'active'},
  {id:'TX-AE', country:'United Arab Emirates', label:'VAT', rate:5, mor:true,
   reg:'100234567800003', scheme:'VAT — standard rated',
   tcs:0, tcsNote:null, placeOfSupply:'Recipient location', digital:'Reverse charge for B2B', status:'active'},
  {id:'TX-SG', country:'Singapore',      label:'GST',  rate:9, mor:true,
   reg:'M90372814X', scheme:'GST — Overseas Vendor Registration',
   tcs:0, tcsNote:null, placeOfSupply:'Recipient location', digital:'OVR applies to imported digital services', status:'active'},
  {id:'TX-KE', country:'Kenya',          label:'VAT',  rate:16, mor:false,
   reg:'P051234567M', scheme:'VAT — seller is merchant of record',
   tcs:0, tcsNote:null, placeOfSupply:'Supplier location', digital:'Digital Service Tax at 1.5% on gross', status:'active'},
  {id:'TX-DE', country:'Germany',        label:'VAT',  rate:19, mor:true,
   reg:'DE312345678', scheme:'VAT — OSS return',
   tcs:0, tcsNote:null, placeOfSupply:'Recipient location', digital:'One Stop Shop filing', status:'active'},
  {id:'TX-BR', country:'Brazil',         label:'ICMS/ISS', rate:null, mor:false,
   reg:null, scheme:'Not yet registered — sellers invoice directly',
   tcs:0, tcsNote:null, placeOfSupply:'Supplier location', digital:'Municipal ISS varies by city', status:'pending'}
];
/* Withholding on partner payouts, by partner tax certificate status. */
const TAX_CERTS = {};
PARTNERS.forEach(p=>{
  const treaty = !['Brazil','Vietnam'].includes(p.country);
  TAX_CERTS[p.id] = {
    partnerId:p.id, country:p.country,
    certOnFile: treaty, expires: treaty ? '31 Mar 2027' : null,
    withholding: treaty ? 0 : 10,
    note: treaty ? null : 'No valid treaty certificate — statutory 10% withheld until one is filed',
    /* Chasing history, so the next person can see what was already said and
       when rather than sending a fourth identical reminder. */
    lastChased: treaty ? null : '18 Jul 2026',
    chaseCount: treaty ? 0 : 2
  };
});
const TAX_SETTINGS = {
  pricesIncludeTax:true,
  showTaxSeparately:true,
  b2bReverseCharge:true,
  roundingLevel:'Line',
  invoiceLanguage:'English',
  filingCalendar:'Monthly, by the 20th'
};
/* What the enterprise buyer declares about itself. */
const BUYER_TAX = {
  registration:'29AABCB4455N1Z8',
  regType:'GSTIN',
  placeOfSupply:'Karnataka, India',
  exempt:false,
  exemptCert:null,
  reverseCharge:false,
  poRequired:true,
  costCentreOnInvoice:true
};

/* How the buyer pays us.

   A buyer is the mirror of a seller: we do not pay them, they pay us, so what
   they hold is a payment instruction and a credit position rather than a
   settlement account. The mandate reference is still masked — it is a direct
   debit authority, and anyone holding it can quote it. */
const BUYER_BILLING = {
  method:'Direct debit',
  bank:'HDFC Bank — Bengaluru, MG Road',
  holder:'Brightline Foods Pvt Ltd',
  mandate:'HDFC0004417290',
  mandateSignedOn:'11 Apr 2024',
  mandateSignedBy:'Meera Nathan (Finance director)',
  account:'50100221187345',
  localLabel:'IFSC', localCode:'HDFC0000521',
  fallback:'Bank transfer against the invoice, quoting the invoice number',
  terms:'Invoice, net 30',
  creditLimit:250000,
  creditUsed:118420.55,
  currency:'USD',
  billingContact:'accounts.payable@6dtech.co.in',
  invoiceDelivery:'Email, PDF plus a UBL 2.1 attachment',
  verified:true, verifiedOn:'12 Apr 2024', verifiedBy:'Ruben Oyelaran'
};

/* What was checked when the account was opened. A buyer's onboarding is a
   credit and compliance decision, not a seven-gate supply-side application, so
   it is recorded as its own short list rather than borrowed from the seller. */
const BUYER_ONBOARDING = [
  {id:'BO-1', name:'Company verification', on:'02 Apr 2024', by:'Lena Fischer', state:'done',
   detail:'Verified against the India company register. CIN and registered address matched.',
   docs:[['Certificate of incorporation','PDF','1.2 MB']]},
  {id:'BO-2', name:'Tax registration', on:'03 Apr 2024', by:'Ruben Oyelaran', state:'done',
   detail:'GSTIN validated with the authority. Place of supply set from the registered address, which is '+
          'what decides the rate on every invoice we raise.',
   docs:[['GST registration certificate','PDF','0.4 MB']]},
  {id:'BO-3', name:'Credit assessment', on:'05 Apr 2024', by:'Ruben Oyelaran', state:'done',
   detail:'Limit of $250,000 on net 30, set from two years of filed accounts and a trade reference. '+
          'Reviewed annually and on any request that would take the balance past the limit.',
   docs:[['Filed accounts FY2023','PDF','2.8 MB'],['Trade reference','PDF','0.2 MB']]},
  {id:'BO-4', name:'Direct debit mandate', on:'11 Apr 2024', by:'Meera Nathan', state:'done',
   detail:'Signed by a person with authority to bind the company. Payments are collected on the due date '+
          'of each invoice and nothing is collected outside an invoice.',
   docs:[['Signed mandate','PDF','0.3 MB']]},
  {id:'BO-5', name:'Purchase order policy', on:'11 Apr 2024', by:'Arun Deshpande', state:'done',
   detail:'A purchase order number is required on every invoice. An invoice without one is rejected by '+
          'the buyer’s accounts payable, so the marketplace refuses to raise one.',
   docs:[]},
  {id:'BO-6', name:'Annual credit review', on:'Due 05 Apr 2027', by:'—', state:'due',
   detail:'The limit is re-assessed each year against filed accounts. Nothing changes until it is done.',
   docs:[]}
];

/* The buyer's approval policy, as a record rather than as prose on a screen. */
const APPROVAL_POLICY = {
  threshold: 2000,
  securitySignOff: true,
  duplicateFlag: true,
  autoApproveRenewals: false,
  selfApprove: false,
  delegateLimit: 5000,
  matrix: [
    {what:'Raise a requisition',                    who:'Any named buyer'},
    {what:'Approve below the threshold',            who:'Procurement lead'},
    {what:'Approve at or above the threshold',      who:'Finance director'},
    {what:'Sign off a security purchase',           who:'IT lead'},
    {what:'Change this policy',                     who:'Finance director'}
  ]
};

/* ===========================================================================
   NOTIFICATION MESSAGE TEMPLATES
   The rule decides when to speak. The template decides what is said, and it
   differs by channel — an SMS that reads like an email is a wasted segment.
   =========================================================================== */
const NOTIF_TOKENS = [
  {t:'{partner}',   d:'Seller name'},        {t:'{buyer}',   d:'Buyer or account name'},
  {t:'{order}',     d:'Order reference'},    {t:'{listing}', d:'Listing name'},
  {t:'{amount}',    d:'Money value, formatted'},
  {t:'{marketplace}',d:'Marketplace name'},  {t:'{gate}',    d:'Onboarding gate'},
  {t:'{due}',       d:'Due date'},           {t:'{reason}',  d:'Reason given'},
  {t:'{link}',      d:'Deep link into the portal'},
  {t:'{recipient}', d:'Name of the person receiving it'}
];
const CHANNEL_LIMITS = {'SMS':160,'Push':120,'In-app':240,'Email':null,'WhatsApp':1024};

/* Defaults are written per channel rather than one string reused everywhere. */
const NOTIF_TEMPLATES = {};
(function seedTemplates(){
  const byId = {
    'NR-O1':{subject:'Listing held — policy check failed',
             email:'Hello {recipient},\n\n{listing} from {partner} failed an automated policy check on {marketplace}.\n\nReason: {reason}\n\nIt is held and will not publish until a reviewer clears it.\n\n{link}',
             short:'{listing} from {partner} failed a policy check and is held. {link}'},
    'NR-O2':{subject:'KYC failed for {partner}',
             email:'Hello {recipient},\n\n{partner} did not clear the {gate} gate.\n\nReason: {reason}\n\nThe application is stopped. They may reapply with corrected documentation.\n\n{link}',
             short:'{partner} failed KYC. Application stopped. {link}'},
    'NR-O3':{subject:'Dispute past its resolution target',
             email:'Hello {recipient},\n\nA dispute on {order} passed its 5-day resolution target on {due}.\n\n{link}',
             short:'Dispute on {order} is past its {due} target. {link}'},
    'NR-O4':{subject:'{marketplace} settlement run is ready to approve',
             email:'Hello {recipient},\n\nThe period has closed and statements totalling {amount} are ready for approval.\n\nNothing pays out until the run is approved.\n\n{link}',
             short:'Settlement run ready — {amount} awaiting approval. {link}'},
    'NR-P1':{subject:'New order {order}',
             email:'Hello {recipient},\n\n{buyer} has ordered {listing} for {amount}.\n\nFulfil it by {due} to stay inside your service commitment.\n\n{link}',
             short:'New order {order} — {listing}, {amount}. Fulfil by {due}.'},
    'NR-P2':{subject:'Order {order} failed to fulfil',
             email:'Hello {recipient},\n\nFulfilment failed on {order} ({listing}).\n\nReason: {reason}\n\nThe order will not settle until it completes.\n\n{link}',
             short:'URGENT: {order} failed to fulfil. It will not settle. {link}'}
  };
  Object.keys(NOTIF_RULES).forEach(ctx=>{
    NOTIF_RULES[ctx].forEach(r=>{
      const seed = byId[r.id];
      const key = ctx+'|'+r.id;
      NOTIF_TEMPLATES[key] = {
        ruleId:r.id, ctx:ctx,
        subject: seed ? seed.subject : r.name,
        bodies: {
          'Email':  seed ? seed.email : 'Hello {recipient},\n\n'+r.name+'.\n\n'+r.event+'.\n\n{link}',
          'In-app': seed ? seed.short : r.name+' — '+r.event+'. {link}',
          'SMS':    seed ? seed.short : r.name+'. {link}',
          'Push':   seed ? seed.short : r.name+'. {link}',
          'WhatsApp': seed ? seed.short : r.name+'. {link}'
        },
        edited:false, lastEdited:null, editedBy:null
      };
    });
  });
})();
const NOTIF_EVENTS = [
  {id:'listing.submitted',  label:'A listing is submitted for review',        ctx:['operator']},
  {id:'listing.decided',    label:'A listing is approved or rejected',        ctx:['operator','partner']},
  {id:'listing.policyfail', label:'An automated policy check fails',          ctx:['operator']},
  {id:'partner.gatefail',   label:'A partner fails an onboarding gate',       ctx:['operator']},
  {id:'partner.golive',     label:'A partner goes live',                      ctx:['operator','partner']},
  {id:'order.placed',       label:'An order is placed',                       ctx:['operator','partner','buyer','consumer']},
  {id:'order.failed',       label:'An order fails at any pipeline stage',     ctx:['operator','partner','buyer','consumer']},
  {id:'order.delivered',    label:'An order completes',                       ctx:['partner','buyer','consumer']},
  {id:'settlement.ready',   label:'A settlement run is ready to approve',     ctx:['operator']},
  {id:'settlement.paid',    label:'A payout lands',                           ctx:['partner']},
  {id:'dispute.raised',     label:'A dispute is raised',                      ctx:['operator','partner']},
  {id:'dispute.sla',        label:'A dispute passes its resolution target',   ctx:['operator','partner']},
  {id:'approval.pending',   label:'A requisition needs approval',             ctx:['buyer']},
  {id:'approval.decided',   label:'A requisition is approved or declined',    ctx:['buyer']},
  {id:'sub.renewing',       label:'A subscription is about to renew',         ctx:['buyer','consumer']},
  {id:'invoice.issued',     label:'An invoice is issued',                     ctx:['buyer','consumer']},
  {id:'payment.failed',     label:'A payment fails',                          ctx:['buyer','consumer']},
  {id:'digest.weekly',      label:'Every Monday at 07:00',                    ctx:['operator','partner','buyer','consumer']}
];
const NOTIF_AUDIENCES = {
  operator:['Catalogue reviewers','Onboarding desk','Settlement approvers','Support agents','Marketplace admins','All operator staff'],
  partner: ['Seller admin','Fulfilment operators','Catalogue managers','Finance contacts','Everyone at this seller'],
  buyer:   ['Requesters','Approvers','Finance','IT','Everyone on this account'],
  consumer:['Just me','Everyone on this account']
};
const NOTIF_THROTTLE = ['Every time','At most once an hour','At most once a day','Digest — once a day','Digest — weekly'];

/* ===========================================================================
   ONBOARDING SUBMISSIONS
   What the partner actually typed and uploaded at each gate. Without this a
   gate is a coloured dot; with it, it is auditable.
   =========================================================================== */
const ONB_SUBMISSIONS = {};
(function seedSubmissions(){
  const byGate = {
    apply: p=>({
      fields:[['Registered company name', p.name+(p.country==='India'?' Private Limited':' Ltd')],
              ['Trading name', p.name],
              ['Country of registration', p.country],
              ['Company registration number', 'REG-'+p.id.slice(4)+'-'+(p.country==='India'?'KA':'XX')],
              ['Business type', p.type],
              ['Marketplaces applied for', p.verticals.map(v=>VMAP[v]?VMAP[v].name:v).join(', ')],
              ['Expected monthly volume', '$'+(40+p.id.charCodeAt(7)%60)+',000'],
              ['Primary contact', p.contact],
              ['Contact email', p.email || (p.contact.split(' ')[0].toLowerCase()+'@'+p.name.split(' ')[0].toLowerCase()+'.example')]],
      docs:[]
    }),
    kyc: p=>({
      fields:[['Legal entity verified against', p.country+' company register'],
              ['Beneficial owners over 25%', p.contact+' (54%), '+(p.country==='India'?'Meera Nathan':'Institutional holding')+' (31%)'],
              ['Sanctions screening', 'No match — OFAC, EU, UN, HMT'],
              ['PEP screening', 'No match'],
              ['Adverse media', p.status==='rejected' ? 'Two articles found — under review' : 'Nothing material found'],
              ['Screening provider', 'ComplyAdvantage']],
      docs:[['Certificate of incorporation','PDF','1.4 MB'],
            ['Beneficial ownership declaration','PDF','０.3 MB'.replace('０','0')],
            ['Director passport (redacted)','PDF','0.9 MB']]
    }),
    agree: p=>({
      fields:[['Marketplace terms', 'Version 4.2, e-signed'],
              ['Signed by', p.contact],
              ['Data processing agreement', 'Signed — standard contractual clauses'],
              ['Commission schedule', (CPMAP[p.plan]||{}).name || 'Not yet assigned'],
              ['Governing law', 'Singapore'],
              ['Notice period', '30 days either side']],
      docs:[['Marketplace terms — countersigned','PDF','2.1 MB'],
            ['Data processing agreement','PDF','0.7 MB'],
            ['Commission schedule','PDF','0.4 MB']]
    }),
    finance: p=>({
      fields:[['Settlement bank', p.country==='India'?'HDFC Bank':p.country==='Kenya'?'Equity Bank':'Deutsche Bank'],
              ['Account holder', p.name],
              ['Account (masked)', '•••• '+(4000+p.id.charCodeAt(6)*7%5999)],
              ['Verification', 'Micro-deposit matched'],
              ['Settlement currency', 'USD'],
              ['Tax residency', p.country],
              ['Treaty certificate', ['Brazil','Vietnam'].includes(p.country)?'Not supplied — statutory withholding applies':'On file, valid to 31 Mar 2027'],
              ['Withholding', ['Brazil','Vietnam'].includes(p.country)?'10%':'Nil under treaty']],
      docs:[['Bank verification letter','PDF','0.5 MB'],
            ['Tax residency certificate','PDF','0.6 MB']]
    }),
    tech: p=>({
      fields:[['Catalogue method', p.type==='Content provider'?'API feed, hourly':'Portal upload'],
              ['Fulfilment webhook', 'https://api.'+p.name.split(' ')[0].toLowerCase()+'.example/marketplace/fulfil'],
              ['Webhook reachability', 'Responds in 240 ms, TLS 1.3'],
              ['Sandbox order', 'ORD-SBX-0091 — completed end to end'],
              ['Retry policy accepted', 'Yes — 3 attempts, exponential backoff'],
              ['Integration contact', p.contact]],
      docs:[['Sandbox order log','TXT','0.1 MB']]
    }),
    assure: p=>({
      fields:[['Security questionnaire', 'Completed — 48 of 52 controls in place'],
              ['Gaps declared', 'No formal pen-test in the last 12 months'],
              ['Content policy acknowledgement', 'Accepted'],
              ['Sample listing audit', '3 listings reviewed, no issues'],
              ['Data residency', p.country==='Germany'?'EU only':'No restriction declared']],
      docs:[['Security questionnaire','XLSX','0.8 MB'],
            ['ISO 27001 certificate','PDF','1.1 MB']]
    }),
    golive: p=>({
      fields:[['Storefront enabled', 'Yes'],
              ['First listings published', String(PRODUCTS.filter(x=>x.partner===p.id).length)],
              ['Go-live date', p.joined],
              ['Assigned commission plan', (CPMAP[p.plan]||{}).name || 'Not assigned']],
      docs:[]
    })
  };
  const reviewers = {apply:'Lena Fischer', kyc:'Ruben Oyelaran', agree:'Ruben Oyelaran',
                     finance:'Ruben Oyelaran', tech:'Tomas Novak', assure:'Farah Al Hashimi',
                     golive:'Lena Fischer'};
  const dates = ['08 Jul 2026','10 Jul 2026','13 Jul 2026','15 Jul 2026','18 Jul 2026','21 Jul 2026','24 Jul 2026'];

  PARTNERS.forEach(p=>{
    const st = ONB_STATE[p.id];
    ONB_SUBMISSIONS[p.id] = {};
    ONB_STEPS.forEach((g,i)=>{
      const state = st ? (st[g.id]||'todo') : 'done';
      if(state==='todo') return;                 /* nothing submitted yet */
      const built = byGate[g.id](p);
      ONB_SUBMISSIONS[p.id][g.id] = {
        gate:g.id, state:state,
        submittedBy:p.contact, submittedOn:dates[i]||'24 Jul 2026',
        reviewedBy: state==='done' ? reviewers[g.id] : null,
        reviewedOn: state==='done' ? (dates[i+1]||'25 Jul 2026') : null,
        decision: state==='done' ? 'Cleared' : state==='fail' ? 'Failed' : 'Under review',
        note: state==='fail' ? 'Beneficial ownership could not be verified against the register.' : null,
        fields:built.fields, docs:built.docs
      };
    });
  });
})();

/* Build one task per gate item per partner, and let the partner's own gate
   state decide what each one says. */
(function seedOnbTasks(){
  const dates = {apply:'08 Jul 2026', kyc:'10 Jul 2026', agree:'13 Jul 2026', finance:'15 Jul 2026',
                 tech:'18 Jul 2026', assure:'21 Jul 2026', golive:'24 Jul 2026'};
  const dueIn = d => d<=1 ? 'Today' : d<=3 ? 'In '+d+' days' : 'In '+d+' days';
  let seq = 4400;
  PARTNERS.forEach(p=>{
    const st = ONB_STATE[p.id];
    ONB_STEPS.forEach(g=>{
      /* No live application means the partner came through long ago; every gate
         is history. */
      const gs = st ? (st[g.id]||'todo') : 'done';
      (ONB_TASK_TEMPLATE[g.id]||[]).forEach(t=>{
        seq += 1;
        const isMarket = t.owner==='Marketplace';
        let status, due, closedBy=null, closedOn=null;
        if(gs==='done'){
          status='done'; due='—';
          closedBy = isMarket ? ONB_TASK_CLOSER[g.id] : p.contact;
          closedOn = st ? (dates[g.id]||p.joined||'24 Jul 2026') : (p.joined||'—');
        } else if(gs==='fail'){
          /* A failed gate is not a to-do list. One item is the reason it failed
             and the rest never got their turn. */
          status = t.key==='screen'||t.key==='ubo' ? 'blocked' : 'notstarted';
          due = t.key==='screen'||t.key==='ubo' ? 'Overdue' : '—';
        } else if(gs==='now'){
          status = isMarket ? 'pending' : 'pending';
          due = dueIn(t.days);
        } else {
          status='notstarted'; due='—';
        }
        ONB_TASKS.push({
          id:'OB-'+seq, partnerId:p.id, partner:p.name, step:g.id, key:t.key,
          title:t.title, detail:t.detail, owner:t.owner,
          due:due, status:status, closedBy:closedBy, closedOn:closedOn
        });
      });
    });
  });
})();
/* Everything on a gate for one partner. Never the whole platform's tasks. */
function onbTasksFor(pid, gid){
  return ONB_TASKS.filter(t=>t.partnerId===pid && (!gid || t.step===gid));
}
/* Only sellers with an application still running have anything to chase. */
function onbTasksOutstanding(){
  return ONB_TASKS.filter(t=>t.status!=='done' && t.status!=='notstarted' &&
    ONB_STATE[t.partnerId]);
}

/* ---------------------------- settlement details -------------------------- */
/* What a country actually calls its local clearing code, so the form asks for
   the thing the person is holding rather than a generic "bank code". */
const BANK_CODES = {
  'India'      :{local:'IFSC',            localEg:'HDFC0001234', tax:'PAN',  taxEg:'AAACH1234K', iban:false},
  'UAE'        :{local:'Routing code',    localEg:'302620122',   tax:'TRN',  taxEg:'100123456700003', iban:true},
  'Kenya'      :{local:'Bank/branch code',localEg:'068-000',     tax:'KRA PIN', taxEg:'P051234567X', iban:false},
  'Singapore'  :{local:'Bank/branch code',localEg:'7171-001',    tax:'UEN',  taxEg:'201812345K', iban:false},
  'Germany'    :{local:'Bankleitzahl',    localEg:'50010517',    tax:'USt-IdNr', taxEg:'DE123456789', iban:true},
  'Poland'     :{local:'Sort code',       localEg:'10201026',    tax:'NIP',  taxEg:'PL5252445767', iban:true},
  'Brazil'     :{local:'Agência/conta',   localEg:'0001 / 12345-6', tax:'CNPJ', taxEg:'12.345.678/0001-95', iban:false},
  'Vietnam'    :{local:'Branch code',     localEg:'79204001',    tax:'MST',  taxEg:'0312345678', iban:false},
  'United Kingdom':{local:'Sort code',    localEg:'04-00-04',    tax:'VAT',  taxEg:'GB123456789', iban:true},
  'United States' :{local:'ACH routing',  localEg:'021000021',   tax:'EIN',  taxEg:'12-3456789', iban:false}
};
const DEFAULT_BANK_CODE = {local:'Local clearing code', localEg:'—', tax:'Tax identifier', taxEg:'—', iban:true};
function bankCodeFor(country){ return BANK_CODES[country] || DEFAULT_BANK_CODE; }

/* A settlement instruction, held once per partner.

   The full account number exists here because the platform has to pay somebody,
   but nothing in the interface prints it. Screens ask for `maskAcct()` and get
   the last four; the only way to see the rest is a deliberate act by a finance
   role that writes an audit entry naming who looked and why. An account number
   on a screen anybody can shoulder-surf is a fraud waiting for an opportunity. */
const PARTNER_BANK = {};
(function seedBanks(){
  const banks = {'India':'HDFC Bank','UAE':'Emirates NBD','Kenya':'Equity Bank',
                 'Singapore':'DBS Bank','Germany':'Deutsche Bank','Poland':'PKO Bank Polski',
                 'Brazil':'Itaú Unibanco','Vietnam':'Techcombank'};
  const swift = {'India':'HDFCINBB','UAE':'EBILAEAD','Kenya':'EQBLKENA','Singapore':'DBSSSGSG',
                 'Germany':'DEUTDEFF','Poland':'BPKOPLPW','Brazil':'ITAUBRSP','Vietnam':'VTCBVNVX'};
  const r = mulberry32(556677);
  PARTNERS.forEach(p=>{
    const c = bankCodeFor(p.country);
    const acct = String(Math.floor(r()*9e11)+1e11);
    PARTNER_BANK[p.id] = {
      partnerId:p.id,
      holder:p.name + (p.country==='India' ? ' Private Limited' : ' Ltd'),
      bank: banks[p.country] || 'Standard Chartered',
      branch: p.country==='India' ? 'Bengaluru — Residency Road' :
              p.country==='UAE'   ? 'Dubai — Sheikh Zayed Road'  : 'Head office',
      account: acct,
      localLabel: c.local,
      localCode: c.localEg,
      swift: swift[p.country] || 'SCBLGB2L',
      iban: c.iban ? (p.country==='Germany'?'DE89':'AE07')+'3704'+acct.slice(0,10) : null,
      currency:'USD',
      taxLabel: c.tax,
      taxId: c.taxEg,
      residency: p.country,
      treaty: ['Brazil','Vietnam'].indexOf(p.country)>-1
        ? {onFile:false, expires:null, withholding:'10% statutory — no certificate on file'}
        : {onFile:true,  expires:'31 Mar 2027', withholding:'Nil under treaty'},
      verified: ONB_STATE[p.id] ? false : true,
      verifiedOn: ONB_STATE[p.id] ? null : (p.joined||null),
      verifiedBy: ONB_STATE[p.id] ? null : 'Ruben Oyelaran',
      method:'Two micro-deposits matched'
    };
  });
})();

/* ===========================================================================
   COMMERCIAL MODELS
   A plan is a model plus its parameters. Different models need different
   parameters, so the form has to change with the model rather than showing
   every field to everyone.
   =========================================================================== */
const COMMERCIAL_MODELS = [
  {id:'CM-COMM', name:'Commission on sale', system:true,
   blurb:'The marketplace keeps a percentage of each completed sale. The default for physical goods.',
   rateLabel:'Commission (%)', rateUnit:'%', tiers:true, tierBasis:'Trailing 12-month gross value',
   params:[{k:'returnsAdj', label:'Deduct commission back on returns', type:'bool', def:true},
           {k:'minCommission', label:'Minimum commission per order', type:'money', def:0.5},
           {k:'logistics', label:'Logistics recharge', type:'choice', def:'At cost',
            options:['None','At cost','Flat per order','Included in commission']}]},
  {id:'CM-REV',  name:'Revenue share', system:true,
   blurb:'A share of the revenue recognised in the period, not of the transaction. Suits content.',
   rateLabel:'Marketplace share (%)', rateUnit:'%', tiers:true, tierBasis:'Trailing 12-month net revenue',
   params:[{k:'recognition', label:'Revenue recognised', type:'choice', def:'On collection',
            options:['On collection','On invoice','Straight-line over the term']},
           {k:'chargebacks', label:'Share of chargebacks borne by the seller (%)', type:'pct', def:100}]},
  {id:'CM-RREV', name:'Recurring revenue share', system:true,
   blurb:'A share of each renewal for as long as the subscription lives. Suits SaaS and security.',
   rateLabel:'Share of each renewal (%)', rateUnit:'%', tiers:true, tierBasis:'Trailing 12-month recurring revenue',
   params:[{k:'firstTerm', label:'Share on the first term (%)', type:'pct', def:20},
           {k:'renewalStep', label:'Share steps down after (months)', type:'int', def:12},
           {k:'churnClaw', label:'Claw back on cancellation inside (days)', type:'int', def:30}]},
  {id:'CM-WHOLE',name:'Wholesale discount off list', system:true,
   blurb:'The reseller buys at a discount and sets its own retail price. The marketplace never sees the end price.',
   rateLabel:'Discount off list (%)', rateUnit:'%', tiers:true, tierBasis:'Trailing 12-month purchase value',
   params:[{k:'priceFloor', label:'Enforce a retail price floor', type:'bool', def:true},
           {k:'creditTerms', label:'Credit terms', type:'choice', def:'net 30',
            options:['Prepay','net 14','net 30','net 45']},
           {k:'creditLimit', label:'Credit limit', type:'money', def:50000}]},
  {id:'CM-INTRO',name:'Introducer commission', system:true,
   blurb:'A one-off fee for an introduction. The marketplace has no part in fulfilment or service.',
   rateLabel:'Commission on first premium (%)', rateUnit:'%', tiers:false, tierBasis:null,
   params:[{k:'coolingOff', label:'Cooling-off period (days)', type:'int', def:14},
           {k:'clawback', label:'Claw back if cancelled inside the cooling-off period', type:'bool', def:true},
           {k:'trail', label:'Trail commission on renewal (%)', type:'pct', def:0}]},
  {id:'CM-SPLIT',name:'Split: hardware commission, connectivity wholesale', system:true,
   blurb:'Two rates in one plan. Hardware settles as commission, connectivity as wholesale. Suits IoT bundles.',
   rateLabel:'Hardware commission (%)', rateUnit:'%', tiers:true, tierBasis:'Trailing 12-month hardware gross',
   params:[{k:'connectivityRate', label:'Connectivity wholesale discount (%)', type:'pct', def:25},
           {k:'bundleAttribution', label:'Attribute a bundle to', type:'choice', def:'Hardware',
            options:['Hardware','Connectivity','Split by value']},
           {k:'simActivationFee', label:'SIM activation fee per line', type:'money', def:1.2}]},
  {id:'CM-FLAT', name:'Flat listing fee', system:true,
   blurb:'A fixed fee per listing per period regardless of sales. Rarely right on its own, but useful alongside a low commission.',
   rateLabel:'Fee per listing per month', rateUnit:'$', tiers:false, tierBasis:null,
   params:[{k:'freeListings', label:'Listings included at no charge', type:'int', def:10},
           {k:'alsoCommission', label:'Also take a commission (%)', type:'pct', def:2}]}
];
const CMMAP = {}; COMMERCIAL_MODELS.forEach(m=>CMMAP[m.id]=m);
/* Bind the existing plans to a model and give them parameter values. */
COMM_PLANS.forEach(p=>{
  const m = COMMERCIAL_MODELS.find(x=>x.name===p.model)
         || COMMERCIAL_MODELS.find(x=>p.model.indexOf(x.name)===0)
         || CMMAP['CM-COMM'];
  p.modelId = m.id;
  p.params = {};
  m.params.forEach(pr=>{ p.params[pr.k]=pr.def; });
  p.status = p.status || 'active';
});

/* ===========================================================================
   THE OPERATOR'S OWN BSS CATALOGUE
   First-party products the operator already sells. The marketplace pulls from
   here rather than asking anyone to retype a tariff.
   =========================================================================== */
const TELCO_CATALOGUE = [
  {id:'TP-MOB-050', name:'Freedom 50 GB',           family:'Mobile postpaid', type:'Plan',    rc:22.00, nrc:0,    unit:'per line/mo', spec:'50 GB, unlimited voice and SMS, 5G'},
  {id:'TP-MOB-100', name:'Freedom 100 GB',          family:'Mobile postpaid', type:'Plan',    rc:29.00, nrc:0,    unit:'per line/mo', spec:'100 GB, unlimited voice and SMS, 5G, roaming pass'},
  {id:'TP-MOB-UNL', name:'Freedom Unlimited',       family:'Mobile postpaid', type:'Plan',    rc:39.00, nrc:0,    unit:'per line/mo', spec:'Unlimited data, fair-use 300 GB, 5G SA'},
  {id:'TP-MOB-PRE', name:'Prepaid 20 GB pack',      family:'Mobile prepaid',  type:'Plan',    rc:9.00,  nrc:0,    unit:'per 28 days', spec:'20 GB, 300 minutes, 28-day validity'},
  {id:'TP-ESM-TRV', name:'Travel eSIM — 10 GB',     family:'eSIM',            type:'Plan',    rc:14.00, nrc:0,    unit:'per 30 days', spec:'10 GB across 62 countries, GSMA SGP.22 profile'},
  {id:'TP-FBB-300', name:'Fibre 300 Mbps',          family:'Fixed broadband', type:'Plan',    rc:26.00, nrc:35.00,unit:'per month',   spec:'300/100 Mbps, unlimited, router included'},
  {id:'TP-FBB-1G',  name:'Fibre 1 Gbps',            family:'Fixed broadband', type:'Plan',    rc:41.00, nrc:35.00,unit:'per month',   spec:'1000/300 Mbps, unlimited, Wi-Fi 6 router'},
  {id:'TP-IOT-SIM', name:'IoT data SIM — 500 MB',   family:'IoT connectivity',type:'Plan',    rc:1.10,  nrc:2.00, unit:'per SIM/mo',  spec:'500 MB, NB-IoT and LTE-M, private APN'},
  {id:'TP-IOT-POOL',name:'IoT pooled data — 50 GB', family:'IoT connectivity',type:'Plan',    rc:48.00, nrc:0,    unit:'per pool/mo', spec:'50 GB shared across the estate, overage $1.10/GB'},
  {id:'TP-VAS-CLD', name:'Cloud backup 200 GB',     family:'Value added',     type:'Service', rc:4.50,  nrc:0,    unit:'per account/mo', spec:'200 GB, versioned, in-country storage'},
  {id:'TP-VAS-SEC', name:'Mobile security',         family:'Value added',     type:'Service', rc:2.50,  nrc:0,    unit:'per line/mo', spec:'Malware and phishing protection on mobile'},
  {id:'TP-VAS-INS', name:'Device protection',       family:'Value added',     type:'Service', rc:6.00,  nrc:0,    unit:'per device/mo', spec:'Accidental damage and theft, one claim a year'},
  {id:'TP-ADD-ROM', name:'Roaming day pass',        family:'Add-on',          type:'Add-on',  rc:0,     nrc:5.00, unit:'per day',     spec:'Use your home allowance abroad for 24 hours'},
  {id:'TP-ADD-DAT', name:'Data top-up 10 GB',       family:'Add-on',          type:'Add-on',  rc:0,     nrc:7.00, unit:'one-off',     spec:'10 GB added to the current cycle'},
  {id:'TP-ADD-INT', name:'International minutes 100',family:'Add-on',         type:'Add-on',  rc:4.00,  nrc:0,    unit:'per month',   spec:'100 minutes to 40 destinations'},
  {id:'TP-EQP-RTR', name:'Wi-Fi 6 mesh router',     family:'Equipment',       type:'Hardware',rc:0,     nrc:79.00,unit:'one-off',     spec:'Dual-band mesh, two nodes'},
  {id:'TP-EQP-CPE', name:'5G fixed-wireless CPE',   family:'Equipment',       type:'Hardware',rc:0,     nrc:189.00,unit:'one-off',    spec:'Outdoor 5G CPE with PoE injector'}
];
const TCMAP = {}; TELCO_CATALOGUE.forEach(t=>TCMAP[t.id]=t);
const TELCO_FAMILIES = Array.from(new Set(TELCO_CATALOGUE.map(t=>t.family)));
/* Bundle discount rules the operator already publishes. */
const BUNDLE_RULES = {
  perComponent: 4,        /* % off per extra component            */
  maxDiscount: 18,        /* capped, because margin is not infinite */
  minComponents: 2,
  maxComponents: 6
};

/* ===========================================================================
   TRAILING HISTORY
   Order-level detail is held for 90 days. Beyond that the prototype keeps
   monthly aggregates, which is how most BSS estates actually work — and it
   means the 12-month view is a real number rather than the 90-day one
   multiplied by four.

   The most recent three months are computed from the live ORDERS set, so the
   two views reconcile instead of contradicting each other.
   =========================================================================== */
const HISTORY_MONTHS = ['Aug 2025','Sep 2025','Oct 2025','Nov 2025','Dec 2025','Jan 2026',
                        'Feb 2026','Mar 2026','Apr 2026','May 2026','Jun 2026','Jul 2026'];
const HISTORY = [];
(function buildHistory(){
  /* The live set is the trailing 90 days — the last three months. Split it by
     month with a mild upward trend so the recent months are not identical. */
  const liveGross = ORDERS.reduce((a,o)=>a+o.gross,0);
  const liveComm  = ORDERS.reduce((a,o)=>a+o.comm,0);
  const liveCount = ORDERS.length;
  const recentSplit = [0.30, 0.33, 0.37];          /* May, Jun, Jul */
  /* Older months are smaller — the marketplace has been growing. */
  const olderShape = [0.52,0.55,0.58,0.63,0.71,0.66,0.69,0.74,0.79,0,0,0];

  HISTORY_MONTHS.forEach((mo,i)=>{
    const recentIdx = i - 9;                        /* 9,10,11 -> 0,1,2 */
    let gross, comm, orders;
    if(recentIdx >= 0){
      gross  = +(liveGross * recentSplit[recentIdx]).toFixed(2);
      comm   = +(liveComm  * recentSplit[recentIdx]).toFixed(2);
      orders = Math.round(liveCount * recentSplit[recentIdx]);
    } else {
      const f = olderShape[i] * recentSplit[2];
      gross  = +(liveGross * f).toFixed(2);
      comm   = +(liveComm  * f).toFixed(2);
      orders = Math.round(liveCount * f);
    }
    HISTORY.push({month:mo, gross:gross, commission:comm, orders:orders,
                  detail: recentIdx>=0 ? 'order level' : 'monthly aggregate'});
  });
  /* Force the last three to sum exactly to the live set — rounding otherwise
     leaves a few dollars between the two views, which is the kind of thing a
     finance person spots in a demo. */
  const rec = HISTORY.slice(9);
  const dg = +(liveGross - rec.reduce((a,h)=>a+h.gross,0)).toFixed(2);
  const dc = +(liveComm  - rec.reduce((a,h)=>a+h.commission,0)).toFixed(2);
  const dn = liveCount - rec.reduce((a,h)=>a+h.orders,0);
  HISTORY[11].gross      = +(HISTORY[11].gross + dg).toFixed(2);
  HISTORY[11].commission = +(HISTORY[11].commission + dc).toFixed(2);
  HISTORY[11].orders     = HISTORY[11].orders + dn;
})();

/* Per-partner history, on the same shape, reconciling to that partner's live orders. */
const PARTNER_HISTORY = {};
PARTNERS.forEach(p=>{
  const own = ORDERS.filter(o=>o.partnerId===p.id);
  const g = own.reduce((a,o)=>a+o.gross,0);
  const c = own.reduce((a,o)=>a+o.comm,0);
  const scale = HISTORY.map(h=>h.gross).reduce((a,b)=>a+b,0);
  PARTNER_HISTORY[p.id] = HISTORY.map((h,i)=>({
    month:h.month,
    gross: +(g * (h.gross/(scale||1)) * (scale/(HISTORY.slice(9).reduce((a,x)=>a+x.gross,0)||1))).toFixed(2),
    orders: Math.round(own.length * (h.gross/(HISTORY.slice(9).reduce((a,x)=>a+x.gross,0)||1))),
    commission: +(c * (h.gross/(HISTORY.slice(9).reduce((a,x)=>a+x.gross,0)||1))).toFixed(2),
    detail: h.detail
  }));
});

/* ===========================================================================
   PRODUCT MEDIA
   A listing is several images, sometimes a video and sometimes a document.
   One image is primary — the one that appears on the card and in search.
   =========================================================================== */
const MEDIA_RULES = {
  minImages: 3, maxImages: 8,
  minPx: 1200, maxMb: 5,
  imageTypes: ['JPG','PNG','WEBP'],
  videoMaxSec: 120, videoMaxMb: 60,
  docTypes: ['PDF'],
  altRequired: true
};
const MEDIA_KINDS = [
  {id:'image', label:'Image',    icon:'monitor', note:'Shown on the card and in the gallery'},
  {id:'video', label:'Video',    icon:'play',    note:'Up to 2 minutes, plays in the gallery'},
  {id:'doc',   label:'Document', icon:'file',    note:'Datasheet, manual or certificate — offered as a download'}
];
/* Existing listings carry a small media set so the manager is never empty. */
const PRODUCT_MEDIA = {};
(function seedMedia(){
  const shots = ['Front','Angle','In use','Packaging','Detail'];
  PRODUCTS.forEach((p,i)=>{
    if(p.price===0) return;
    const n = 2 + (i % 3);
    const items = [];
    for(let k=0;k<n;k++){
      items.push({
        id:'MD-'+p.id.replace('SKU-','')+'-'+(k+1),
        kind:'image', name:p.name.split(' ').slice(0,2).join('-').toLowerCase()+'-'+(k+1)+'.jpg',
        alt:shots[k%shots.length]+' view of '+p.name,
        px:'1600×1600', mb:(0.6+k*0.3).toFixed(1), primary:k===0, shot:shots[k%shots.length]
      });
    }
    if(i%4===0){
      items.push({id:'MD-'+p.id.replace('SKU-','')+'-V', kind:'video',
        name:p.name.split(' ')[0].toLowerCase()+'-overview.mp4',
        alt:'90-second overview of '+p.name, px:'1920×1080', mb:'22.4', secs:90, primary:false});
    }
    if(p.v==='iot' || p.v==='device' || p.v==='security'){
      items.push({id:'MD-'+p.id.replace('SKU-','')+'-D', kind:'doc',
        name:p.name.split(' ')[0].toLowerCase()+'-datasheet.pdf',
        alt:'Technical datasheet', px:null, mb:'1.2', primary:false});
    }
    PRODUCT_MEDIA[p.id]=items;
  });
})();

/* ===========================================================================
   PARTNER INTEGRATIONS
   The seller's own endpoints. The marketplace calls these; it never asks the
   seller to poll. Auth, retry and a delivery log are part of the contract,
   not an afterthought, because a webhook without them is a guess.
   =========================================================================== */
/* ---------------------------------------------------------------------------
   INBOUND: the marketplace events a partner is notified of.

   These are marketplace scenarios, not generic webhooks. Each one names the
   moment in the commercial lifecycle at which the seller's own system has to
   learn something, and whether the marketplace considers it mandatory for the
   fulfilment models that seller uses.
   ------------------------------------------------------------------------- */
const API_EVENTS = [
  /* --- order lifecycle --- */
  {id:'order.created',        label:'Order placed',              group:'Order',        required:true,
   models:['activation','logistics','provisioning','digital','seat'],
   note:'Fired the moment a buyer pays. Your acknowledgement starts the fulfilment clock.'},
  {id:'order.amended',        label:'Order amended',             group:'Order',        required:true,
   models:['logistics','seat'],
   note:'Quantity or delivery detail changed before dispatch. Ignoring it ships the wrong thing.'},
  {id:'order.cancelled',      label:'Order cancelled',           group:'Order',        required:true,
   models:['activation','logistics','provisioning','digital','seat'],
   note:'Cancelled before fulfilment completed. Stop work and release any stock you held.'},
  {id:'order.returned',       label:'Return authorised',         group:'Order',        required:false,
   models:['logistics'],
   note:'A return has been approved and stock is coming back to you.'},
  {id:'fulfilment.requested', label:'Fulfilment requested',      group:'Order',        required:true,
   models:['provisioning','activation'],
   note:'The marketplace asks you to activate or provision. This is the call that matters most.'},
  {id:'fulfilment.overdue',   label:'Fulfilment overdue',        group:'Order',        required:false,
   models:['activation','logistics','provisioning'],
   note:'Your stated window has passed without a completion. Sent before the buyer is told.'},

  /* --- subscription lifecycle --- */
  {id:'subscription.activated',label:'Subscription activated',   group:'Subscription', required:true,
   models:['seat','digital','provisioning'],
   note:'A recurring service has started. Begin the entitlement.'},
  {id:'subscription.renewed',  label:'Subscription renewed',     group:'Subscription', required:true,
   models:['seat','digital','provisioning'],
   note:'The next term has been paid for. Extend the entitlement rather than re-provisioning.'},
  {id:'subscription.changed',  label:'Plan or seat count changed',group:'Subscription',required:true,
   models:['seat','digital'],
   note:'An upgrade, downgrade or seat change, with the effective date and the pro-ration already applied.'},
  {id:'subscription.suspended',label:'Subscription suspended',   group:'Subscription', required:true,
   models:['seat','digital','provisioning'],
   note:'Non-payment, dispute or buyer request. Suspend the entitlement; do not delete it.'},
  {id:'subscription.resumed',  label:'Subscription resumed',     group:'Subscription', required:true,
   models:['seat','digital','provisioning'],
   note:'Whatever caused the suspension has cleared. Restore without a new activation.'},
  {id:'subscription.cancelled',label:'Subscription cancelled',   group:'Subscription', required:true,
   models:['seat','digital','provisioning'],
   note:'Ends at the end of the paid period, not immediately. The payload carries the end date.'},
  {id:'subscription.expiring', label:'Renewal approaching',      group:'Subscription', required:false,
   models:['seat','digital'],
   note:'Thirty days out. Useful if you want to reach the customer before the marketplace does.'},

  /* --- catalogue --- */
  {id:'catalogue.decision',   label:'Listing approved or rejected',group:'Catalogue',  required:false,
   models:[], note:'The outcome of a catalogue review, with the rule cited and the reason given.'},
  {id:'catalogue.pull',       label:'Catalogue pull',            group:'Catalogue',    required:false,
   models:[], note:'The marketplace asks your system for the current catalogue and prices.'},
  {id:'stock.check',          label:'Stock availability check',  group:'Catalogue',    required:false,
   models:['logistics'], note:'Called before checkout on high-value items to avoid overselling.'},
  {id:'price.changed',        label:'Operator changed a price',  group:'Catalogue',    required:false,
   models:[], note:'A marketplace-funded discount was applied to your listing. Your margin is unaffected.'},

  /* --- money --- */
  {id:'settlement.ready',     label:'Statement ready',           group:'Finance',      required:false,
   models:[], note:'A self-billing statement has been issued against you.'},
  {id:'settlement.paid',      label:'Payout sent',               group:'Finance',      required:false,
   models:[], note:'Funds have left the marketplace for your account.'},
  {id:'payment.failed',       label:'Customer payment failed',   group:'Finance',      required:false,
   models:['seat','digital','provisioning'],
   note:'Sent when dunning starts, not when service stops. Nothing is suspended before day 14.'},
  {id:'refund.issued',        label:'Refund issued',             group:'Finance',      required:false,
   models:[], note:'A refund has been made to the buyer and will be recovered on your next statement.'},
  {id:'refund.requested',     label:'Refund requested',          group:'Adjustment',   required:true,
   models:['activation','logistics','provisioning','digital','seat'],
   note:'A customer wants their money back on your product. You have 48 hours to decide before the '+
        'marketplace decides for you — and the money comes off your settlement either way.'},
  {id:'refund.escalated',     label:'Refund escalated',          group:'Adjustment',   required:false,
   models:['activation','logistics','provisioning','digital','seat'],
   note:'A customer has challenged your decline. The marketplace is now deciding and can overrule you.'},
  {id:'refund.overturned',    label:'Refund decision overturned',group:'Adjustment',   required:false,
   models:['activation','logistics','provisioning','digital','seat'],
   note:'The marketplace reversed your decline on escalation. Reconcile the entitlement your side.'},
  {id:'note.issued',          label:'Credit or debit note issued',group:'Adjustment',  required:true,
   models:['activation','logistics','provisioning','digital','seat'],
   note:'An adjustment has been raised against your account and will land on the next statement. '+
        'Post it to your ledger before the run closes, or your reconciliation will break.'},
  {id:'note.voided',          label:'Note voided',               group:'Adjustment',   required:false,
   models:[], note:'An adjustment was withdrawn before it settled. Reverse whatever you posted for it.'},

  /* --- support --- */
  {id:'dispute.raised',       label:'Dispute raised',            group:'Support',      required:false,
   models:[], note:'A buyer has disputed an order you fulfilled. Evidence is requested with a deadline.'},
  {id:'ticket.assigned',      label:'Ticket assigned to you',    group:'Support',      required:false,
   models:[], note:'A support case has been routed to the seller rather than to the marketplace desk.'}
];
const EVMAP={}; API_EVENTS.forEach(e=>EVMAP[e.id]=e);
const EVENT_GROUPS = ['Order','Subscription','Catalogue','Finance','Adjustment','Support'];

/* The fulfilment models an event can be made mandatory for. A seller inherits
   the models of the categories it sells in, which is how "required" stops
   being a blanket rule and starts being specific to that seller. */
const FULFIL_MODELS = [
  {id:'activation',   label:'Activation',   note:'Service switched on against an existing line.'},
  {id:'esim',         label:'eSIM',         note:'Profile issued to a device.'},
  {id:'logistics',    label:'Physical',     note:'Something is picked, packed and shipped.'},
  {id:'provisioning', label:'Provisioned',  note:'Configured on a network or platform before use.'},
  {id:'digital',      label:'Digital',      note:'Entitlement granted immediately.'},
  {id:'seat',         label:'Seat-based',   note:'Licences assigned and reassigned over a term.'}
];

/* An event is a published contract. It is deprecated, never deleted, because
   registered endpoints reference it and a subscription to an id nobody can
   look up cannot be diagnosed. */
const EVENT_STATES = ['draft','active','deprecated'];

/* Defaults for events that predate the editor. */
API_EVENTS.forEach(e=>{
  if(e.status===undefined)  e.status='active';
  if(e.pii===undefined)     e.pii = /order|subscription|payment|dispute|ticket/.test(e.id);
  if(e.since===undefined)   e.since='02 Mar 2024';
  if(e.payload===undefined) e.payload = ['id','occurredAt','idempotencyKey'].concat(
    e.group==='Order' ? ['order.id','order.lines[]','order.totals','buyer.reference']
  : e.group==='Subscription' ? ['subscription.id','subscription.state','effectiveDate','term']
  : e.group==='Finance' ? ['statement.id','amount','currency','period']
  : e.group==='Catalogue' ? ['listing.sku','decision','reason']
  : ['case.id','subject','deadline']);
});

const API_AUTH = ['OAuth 2.0 client credentials','API key header','HMAC signature','mTLS','None'];
const API_RETRY = ['None — fire and forget','3 attempts, exponential backoff','5 attempts, exponential backoff','Until acknowledged, up to 24 h'];

/* This seller's registered endpoints. The failing one is the reason its
   Security Marketplace application is stuck at the technical gate. */
const MY_ENDPOINTS = [
  {id:'EP-01', name:'Fulfilment', url:'https://api.sentinelcyber.example/marketplace/fulfil',
   method:'POST', events:['order.created','order.cancelled','provision.request'],
   auth:'OAuth 2.0 client credentials', authDetail:'client_id sc-mkt-prod · token endpoint /oauth/token',
   retry:'3 attempts, exponential backoff', timeoutMs:5000, enabled:true,
   env:'Production', health:'failing', lastCall:'22 min ago', successRate:41,
   note:'Returning HTTP 500 on retry. Three of the last five sandbox callbacks failed.'},
  {id:'EP-02', name:'Catalogue sync', url:'https://api.sentinelcyber.example/marketplace/catalogue',
   method:'GET', events:['catalogue.pull'],
   auth:'API key header', authDetail:'X-Api-Key, rotated 90-daily',
   retry:'3 attempts, exponential backoff', timeoutMs:8000, enabled:true,
   env:'Production', health:'healthy', lastCall:'14 min ago', successRate:100, note:null},
  {id:'EP-03', name:'Finance notifications', url:'https://hooks.sentinelcyber.example/finance',
   method:'POST', events:['settlement.ready','settlement.paid'],
   auth:'HMAC signature', authDetail:'SHA-256 over the raw body, shared secret',
   retry:'5 attempts, exponential backoff', timeoutMs:5000, enabled:true,
   env:'Production', health:'healthy', lastCall:'3 h ago', successRate:99, note:null},
  {id:'EP-04', name:'Sandbox fulfilment', url:'https://sandbox.sentinelcyber.example/marketplace/fulfil',
   method:'POST', events:['order.created','order.cancelled'],
   auth:'API key header', authDetail:'X-Api-Key, sandbox key',
   retry:'3 attempts, exponential backoff', timeoutMs:5000, enabled:false,
   env:'Sandbox', health:'unknown', lastCall:'Never', successRate:null,
   note:'Registered but not enabled. Enable it to run the sandbox order the technical gate asks for.'}
];
/* What the marketplace actually sent, and what came back. */
const API_LOG = [
  {id:'CALL-8841', ep:'EP-01', event:'order.created', when:'22 min ago', status:503, ms:5002,
   attempt:3, outcome:'failed', detail:'Upstream timeout after 5,002 ms'},
  {id:'CALL-8840', ep:'EP-01', event:'order.created', when:'23 min ago', status:500, ms:812,
   attempt:2, outcome:'failed', detail:'Internal Server Error, empty body'},
  {id:'CALL-8839', ep:'EP-01', event:'order.created', when:'24 min ago', status:500, ms:790,
   attempt:1, outcome:'failed', detail:'Internal Server Error, empty body'},
  {id:'CALL-8836', ep:'EP-02', event:'catalogue.pull', when:'14 min ago', status:200, ms:246,
   attempt:1, outcome:'ok', detail:'38 listings returned'},
  {id:'CALL-8830', ep:'EP-01', event:'order.created', when:'2 h ago', status:200, ms:311,
   attempt:1, outcome:'ok', detail:'Accepted, fulfilment reference SC-99213'},
  {id:'CALL-8822', ep:'EP-03', event:'settlement.ready', when:'3 h ago', status:200, ms:180,
   attempt:1, outcome:'ok', detail:'Acknowledged'},
  {id:'CALL-8810', ep:'EP-01', event:'provision.request', when:'Yesterday', status:200, ms:428,
   attempt:1, outcome:'ok', detail:'Provisioning started, ref SC-99180'}
];
/* Inbound credentials — what the seller uses to call the marketplace. */
const MY_API_KEYS = [
  {id:'KEY-01', label:'Production — order status updates', prefix:'mk_live_7f2a', created:'12 Sep 2024',
   lastUsed:'9 min ago', scopes:['orders:write','catalogue:read'], status:'active'},
  {id:'KEY-02', label:'Sandbox', prefix:'mk_test_31c8', created:'12 Sep 2024',
   lastUsed:'21 Jul 2026', scopes:['orders:write','catalogue:read','catalogue:write'], status:'active'},
  {id:'KEY-03', label:'Old CI key', prefix:'mk_live_a904', created:'02 Mar 2024',
   lastUsed:'11 Feb 2026', scopes:['catalogue:read'], status:'revoked'}
];
const API_SCOPES = ['orders:read','orders:write','catalogue:read','catalogue:write','settlement:read','disputes:write'];

/* ===========================================================================
   COST, LIST AND SALE PRICE
   Three numbers, not one. Cost is the floor nobody may discount through; list
   is what the listing is worth; sale is what is being charged today. The gap
   between sale and cost is the only discount headroom that exists, and every
   promotion in the engine below is capped by it.
   =========================================================================== */
(function seedCosts(){
  /* Cost as a share of price varies by what is being sold — hardware is thin,
     digital content is not. These are the shares a category actually runs at. */
  const costShare = {device:0.78, iot:0.64, security:0.42, content:0.55, consumer:0.61, partner:0.70};
  PRODUCTS.forEach(p=>{
    if(p.price<=0){ p.cost=0; p.list=0; p.sale=0; return; }
    const share = costShare[p.v] || 0.65;
    p.cost = +(p.price*share).toFixed(2);
    p.list = p.was || +(p.price*(p.badge==='Bundle'?1.12:1.06)).toFixed(2);
    p.sale = p.price;                       /* what is charged today */
    p.floorPct = +((1 - p.cost/p.price)*100).toFixed(1);   /* headroom before cost */
  });
})();
/* First-party components carry their own cost too, so a bundle discount can be
   floored properly rather than at an arbitrary percentage. */
TELCO_CATALOGUE.forEach(t=>{
  const share = t.family==='Equipment' ? 0.80
              : t.family==='Value added' ? 0.38
              : t.family==='Add-on' ? 0.45 : 0.58;
  t.costRc  = +(t.rc*share).toFixed(2);
  t.costNrc = +(t.nrc*share).toFixed(2);
});

/* ===========================================================================
   DISCOUNT RULES
   A promotion is conditions plus an effect plus a budget. Conditions are
   evaluated against the actual basket, so a rule that does not apply says why
   rather than silently doing nothing.
   =========================================================================== */
const DISCOUNT_CONDITIONS = [
  {id:'cartValue',  label:'Cart value at or above',   type:'money',  unit:'$',      group:'Basket'},
  {id:'cartItems',  label:'Items in the basket',      type:'int',    unit:'items',  group:'Basket'},
  {id:'category',   label:'Marketplace category',     type:'vertical',              group:'Basket'},
  {id:'timeOfDay',  label:'Time of day between',      type:'timeRange',             group:'Timing'},
  {id:'daysOfWeek', label:'Days of the week',         type:'days',                  group:'Timing'},
  {id:'window',     label:'Runs between',             type:'dateRange',             group:'Timing'},
  {id:'audience',   label:'Buyer type',               type:'audience',              group:'Who'},
  {id:'firstOrder', label:'First order on the account',type:'bool',                 group:'Who'},
  {id:'tier',       label:'Loyalty tier at least',    type:'tier',                  group:'Who'},
  {id:'contract',   label:'Contracted enterprise only',type:'bool',                 group:'Who'}
];
const DISCOUNT_EFFECTS = [
  {id:'pct',      label:'Percentage off',         unit:'%'},
  {id:'amount',   label:'Fixed amount off',       unit:'$'},
  {id:'freeMonths', label:'Months free on a subscription', unit:'months'},
  {id:'shipping', label:'Free delivery',          unit:null}
];
const DAYS = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
const AUDIENCES = ['Consumer','Enterprise','Partner reseller','Everyone'];

const DISCOUNT_RULES = [
  {id:'DR-01', name:'Evening data hour', on:true, priority:10,
   blurb:'Digital content bought between 20:00 and 23:00 — fills the quiet hours before the late peak.',
   effect:{type:'pct', value:12},
   conditions:{timeOfDay:{from:'20:00', to:'23:00'}, category:['content'], audience:'Consumer'},
   stack:false, budget:{cap:8000, used:3140}, window:{from:'01 Jul 2026', to:'30 Sep 2026'},
   uses:412, revenue:26840},
  {id:'DR-02', name:'Basket over $200', on:true, priority:20,
   blurb:'8% off once a consumer basket passes $200. Pushes the second item into the cart.',
   effect:{type:'pct', value:8},
   conditions:{cartValue:200, audience:'Consumer'},
   stack:true, budget:{cap:15000, used:9420}, window:{from:'01 Jun 2026', to:'31 Dec 2026'},
   uses:688, revenue:71200},
  {id:'DR-03', name:'Enterprise volume — 25 seats', on:true, priority:15,
   blurb:'10% off security subscriptions at 25 seats or more. Matches what the sales desk was discounting by hand.',
   effect:{type:'pct', value:10},
   conditions:{cartItems:25, category:['security'], audience:'Enterprise', contract:true},
   stack:false, budget:{cap:40000, used:18600}, window:{from:'01 Apr 2026', to:'31 Mar 2027'},
   uses:31, revenue:214300},
  {id:'DR-04', name:'Weekend device delivery', on:true, priority:30,
   blurb:'Free delivery on devices ordered Saturday or Sunday.',
   effect:{type:'shipping', value:0},
   conditions:{daysOfWeek:['Sat','Sun'], category:['device'], audience:'Everyone'},
   stack:true, budget:{cap:5000, used:1180}, window:{from:'01 Jul 2026', to:'31 Aug 2026'},
   uses:214, revenue:0},
  {id:'DR-05', name:'First order welcome', on:true, priority:5,
   blurb:'$15 off a first order. Deliberately small — it buys a trial, not a habit.',
   effect:{type:'amount', value:15},
   conditions:{firstOrder:true, cartValue:40, audience:'Consumer'},
   stack:false, budget:{cap:12000, used:11640}, window:{from:'01 Jan 2026', to:'31 Dec 2026'},
   uses:776, revenue:48900},
  {id:'DR-06', name:'Reseller launch support', on:false, priority:25,
   blurb:'Two months free on connectivity for a reseller in its first quarter. Paused pending margin review.',
   effect:{type:'freeMonths', value:2},
   conditions:{audience:'Partner reseller', category:['partner']},
   stack:false, budget:{cap:20000, used:4200}, window:{from:'01 May 2026', to:'31 Jul 2026'},
   uses:6, revenue:31800}
];
const DRMAP = {}; DISCOUNT_RULES.forEach(r=>DRMAP[r.id]=r);
/* The clock the engine evaluates against. Adjustable so a demo can show a
   time-of-day rule firing without waiting until eight in the evening. */
const CLOCK = {hhmm:'14:20', day:'Sat', date:'25 Jul 2026'};

/* ===========================================================================
   AUDIT TRAIL
   An audit log that can be edited is not an audit log. Entries are append-only:
   there is no update path and no delete path anywhere in this codebase, and
   the UI says so rather than leaving it to be assumed.

   Visibility is scoped by role, not by portal. A support agent seeing a
   settlement approval, or one seller seeing another's onboarding, would be a
   data breach dressed up as transparency.
   =========================================================================== */

/* Every auditable action, with the category that governs who may read it and
   whether the entry carries personal data. */
const AUDIT_ACTIONS = {
  /* ---- authentication (M20) ---- */
  'auth.signin':        {label:'Signed in',                    cat:'Access',   sev:'info',   pii:true},
  'auth.signout':       {label:'Signed out',                   cat:'Access',   sev:'info',   pii:true},
  'auth.failed':        {label:'Sign-in refused',              cat:'Security', sev:'warn',   pii:true},
  'auth.stepup':        {label:'Re-authenticated',             cat:'Security', sev:'notice'},
  'auth.session.end':   {label:'Session ended',                cat:'Security', sev:'notice'},
  /* ---- number management (M20) ---- */
  'num.reserve':        {label:'Numbers reserved',             cat:'Orders',   sev:'notice'},
  'num.assign':         {label:'ICCID assigned',               cat:'Orders',   sev:'notice'},
  'num.release':        {label:'ICCID released',               cat:'Orders',   sev:'notice'},
  'num.recon':          {label:'Number reconciliation run',    cat:'Governance',sev:'notice'},
  'num.corrected':      {label:'Corrected to match the NMS',   cat:'Governance',sev:'warn'},
  'esim.profile':       {label:'eSIM profile state changed',   cat:'Orders',   sev:'notice'},
  /* ---- channel delivery (M20) ---- */
  'ntf.resend':         {label:'Message resent',               cat:'Governance',sev:'notice'},
  'ntf.provider':       {label:'Channel provider changed',     cat:'Governance',sev:'warn'},
  'ntf.failover':       {label:'Channel failed over',          cat:'Governance',sev:'warn'},
  /* ---- listing rule catalogue (M22) ---- */
  'policy.rule':        {label:'Listing rule changed',        cat:'Catalogue', sev:'notice'},
  /* ---- partner API registry (M27) ---- */
  'api.test':           {label:'Partner endpoint tested',      cat:'Governance', sev:'notice'},
  'api.endpoint':       {label:'Partner endpoint changed',     cat:'Governance', sev:'warn'},
  'api.event':          {label:'Marketplace event changed',     cat:'Governance', sev:'warn'},
  'api.product':        {label:'API published or versioned',     cat:'Governance', sev:'notice'},
  'bill.template':      {label:'Bill template changed',          cat:'Commercial', sev:'notice'},
  'dunning.ladder':     {label:'Dunning ladder changed',         cat:'Commercial', sev:'warn'},
  'channel.config':     {label:'Channel configuration changed',  cat:'Governance', sev:'warn'},
  'api.key':            {label:'API credentials requested',      cat:'Access', sev:'warn'},
  'note.raised':        {label:'Credit or debit note raised',     cat:'Commercial', sev:'warn'},
  'note.state':         {label:'Credit or debit note updated',    cat:'Commercial', sev:'warn'},
  'note.policy':        {label:'Note policy changed',             cat:'Commercial', sev:'warn'},
  'refund.decided':     {label:'Refund decided',                  cat:'Commercial', sev:'warn'},
  'refund.requested':   {label:'Refund requested',                cat:'Commercial', sev:'info'},
  'reward.redeemed':    {label:'Reward points redeemed',          cat:'Account', sev:'info'},
  'reward.adjusted':    {label:'Reward balance adjusted by hand',  cat:'Commercial', sev:'warn'},
  'reward.rule':        {label:'Reward earn rule changed',         cat:'Commercial', sev:'warn'},
  'reward.policy':      {label:'Reward programme settings changed', cat:'Commercial', sev:'warn'},
  'wallet.adjusted':    {label:'Wallet balance adjusted',        cat:'Commercial', sev:'high'},
  'wallet.policy':      {label:'Wallet policy changed',          cat:'Commercial', sev:'warn'},
  'reward.redeem':      {label:'Redemption option changed',        cat:'Commercial', sev:'warn'},
  'reward.tier':        {label:'Reward tier changed',              cat:'Commercial', sev:'warn'},
  'bank.revealed':      {label:'Settlement detail shown in full',   cat:'Settlement', sev:'high', pii:true},
  'bank.recorded':      {label:'Settlement instruction recorded',   cat:'Settlement', sev:'warn'},
  'notif.rule':         {label:'Alert preference changed',           cat:'Account', sev:'info'},
  'gl.mapping':         {label:'GL posting rule changed',        cat:'Settlement', sev:'warn'},
  'gl.close':           {label:'Accounting period closed',       cat:'Settlement', sev:'notice'},
  'wh.config':          {label:'Warehouse or stock mapping changed', cat:'Orders',  sev:'warn'},
  /* ---- bulk update (M21) ---- */
  'bulk.apply':         {label:'Bulk update applied',          cat:'Governance',sev:'notice'},
  /* ---- partner lifecycle ---- */
  'partner.invited':      {label:'Partner invited',            cat:'Onboarding',  sev:'info'},
  'partner.gate.cleared': {label:'Onboarding gate cleared',    cat:'Onboarding',  sev:'notice'},
  'partner.gate.failed':  {label:'Onboarding gate failed',     cat:'Onboarding',  sev:'notice', pii:true},
  'partner.golive':       {label:'Partner went live',          cat:'Onboarding',  sev:'notice'},
  'partner.suspended':    {label:'Partner suspended',          cat:'Onboarding',  sev:'high'},
  'gatepolicy.changed':   {label:'Gate policy changed',        cat:'Governance',  sev:'high'},
  /* ---- catalogue ---- */
  'listing.submitted':    {label:'Listing submitted',          cat:'Catalogue',   sev:'info'},
  'listing.approved':     {label:'Listing approved',           cat:'Catalogue',   sev:'notice'},
  'listing.rejected':     {label:'Listing rejected',           cat:'Catalogue',   sev:'notice'},
  'listing.suspended':    {label:'Listing suspended',          cat:'Catalogue',   sev:'high'},
  'listing.paused':       {label:'Listing paused by seller',   cat:'Catalogue',   sev:'info'},
  'listing.priced':       {label:'Listing price changed',      cat:'Catalogue',   sev:'notice'},
  'listing.queried':      {label:'Seller queried on a listing',cat:'Catalogue',   sev:'info'},
  'policy.changed':       {label:'Catalogue policy changed',   cat:'Governance',  sev:'high'},
  'category.created':     {label:'Marketplace category created',cat:'Governance', sev:'high'},
  'category.closed':      {label:'Marketplace category closed',cat:'Governance',  sev:'high'},
  /* ---- commercial ---- */
  'plan.created':         {label:'Commission plan created',    cat:'Commercial',  sev:'notice'},
  'plan.rate.changed':    {label:'Commission rate changed',    cat:'Commercial',  sev:'high'},
  'model.created':        {label:'Commercial model created',   cat:'Commercial',  sev:'notice'},
  'billing.override':     {label:'Partner bill cycle overridden',cat:'Commercial',sev:'high'},
  'billformat.changed':   {label:'Bill format changed',        cat:'Commercial',  sev:'notice'},
  'promo.created':        {label:'Promotion created',          cat:'Commercial',  sev:'notice'},
  'promo.changed':        {label:'Promotion changed',          cat:'Commercial',  sev:'notice'},
  'promo.deleted':        {label:'Promotion deleted',          cat:'Commercial',  sev:'high'},
  /* ---- money ---- */
  'settlement.approved':  {label:'Settlement run approved',    cat:'Settlement',  sev:'high'},
  'statement.approved':   {label:'Statement approved',         cat:'Settlement',  sev:'notice'},
  'payout.sent':          {label:'Payout released',            cat:'Settlement',  sev:'high'},
  'tax.changed':          {label:'Tax configuration changed',  cat:'Settlement',  sev:'high'},
  'cert.recorded':        {label:'Tax certificate recorded',   cat:'Settlement',  sev:'notice', pii:true},
  /* ---- orders ---- */
  'order.placed':         {label:'Order placed',               cat:'Orders',      sev:'info'},
  'stock.watched':        {label:'Restock alert requested',     cat:'Orders',      sev:'info'},
  'stock.unwatched':      {label:'Restock alert cancelled',     cat:'Orders',      sev:'info'},
  'order.intervened':     {label:'Order intervention',         cat:'Orders',      sev:'notice'},
  'order.cancelled':      {label:'Order cancelled',            cat:'Orders',      sev:'notice'},
  'requisition.approved': {label:'Requisition approved',       cat:'Orders',      sev:'notice'},
  'requisition.declined': {label:'Requisition declined',       cat:'Orders',      sev:'notice'},
  'dispute.resolved':     {label:'Dispute resolved',           cat:'Orders',      sev:'notice'},
  /* ---- access and security ---- */
  'user.invited':         {label:'User invited',               cat:'Access',      sev:'notice', pii:true},
  'user.removed':         {label:'User removed',               cat:'Access',      sev:'high',   pii:true},
  'user.role.changed':    {label:'User role changed',          cat:'Access',      sev:'high',   pii:true},
  'role.created':         {label:'Role created',               cat:'Access',      sev:'high'},
  'role.perm.changed':    {label:'Role permission changed',    cat:'Access',      sev:'high'},
  'password.changed':     {label:'Password changed',           cat:'Security',    sev:'notice', pii:true},
  'password.reset':       {label:'Password reset forced',      cat:'Security',    sev:'high',   pii:true},
  'mfa.disabled':         {label:'Multi-factor disabled',      cat:'Security',    sev:'high',   pii:true},
  'session.revoked':      {label:'Other sessions signed out',  cat:'Security',    sev:'notice', pii:true},
  'apikey.created':       {label:'API key created',            cat:'Security',    sev:'high'},
  'apikey.revoked':       {label:'API key revoked',            cat:'Security',    sev:'high'},
  'endpoint.changed':     {label:'Integration endpoint changed',cat:'Security',   sev:'notice'},
  'audit.viewed':         {label:'Audit log viewed',           cat:'Governance',  sev:'info'},
  'export.taken':         {label:'Data exported',              cat:'Governance',  sev:'notice'},
  'doc.viewed':           {label:'Onboarding document viewed', cat:'Governance',  sev:'notice', pii:true},
  /* ---- account (consumer) ---- */
  'profile.changed':      {label:'Profile details changed',    cat:'Account',     sev:'info',   pii:true},
  'payment.added':        {label:'Payment method added',       cat:'Account',     sev:'notice', pii:true},
  'payment.removed':      {label:'Payment method removed',     cat:'Account',     sev:'notice', pii:true},
  'address.changed':      {label:'Address changed',            cat:'Account',     sev:'info',   pii:true},
  'data.requested':       {label:'Data export requested',      cat:'Account',     sev:'notice', pii:true},
  'closure.requested':    {label:'Account closure requested',  cat:'Account',     sev:'high',   pii:true},
  'cap.changed':          {label:'Spend cap changed',          cat:'Account',     sev:'notice'}
};
const AUDIT_CATEGORIES = ['Onboarding','Catalogue','Commercial','Settlement','Orders','Access','Security','Governance','Account'];

/* Which categories a role may read. A role absent from this map may not read
   the audit log at all — the screen is not merely empty, it is refused. */
const AUDIT_SCOPE = {
  operator:{
    'OR-ADMIN':{cats:AUDIT_CATEGORIES,                                              pii:true,  all:true},
    'OR-ONB'  :{cats:['Onboarding','Governance'],                                   pii:true,  all:false},
    'OR-CAT'  :{cats:['Catalogue','Governance'],                                    pii:false, all:false},
    'OR-FIN'  :{cats:['Settlement','Commercial','Governance'],                      pii:false, all:false},
    'OR-SUP'  :{cats:['Orders','Catalogue'],                                        pii:false, all:false},
    'OR-TKT'  :{cats:['Orders','Account'],                                          pii:true,  all:false},
    'OR-WH'   :{cats:['Orders'],                                                    pii:false, all:false},
    'OR-COL'  :{cats:['Commercial','Settlement','Orders'],                          pii:false, all:false},
    'OR-TAX'  :{cats:['Settlement','Commercial','Governance'],                      pii:false, all:false},
    'OR-MKT'  :{cats:['Catalogue','Commercial'],                                    pii:false, all:false},
    /* Security reads everything including personal data — that is the job, and
       it is why the role is small and its own actions are logged too. */
    'OR-SEC'  :{cats:AUDIT_CATEGORIES,                                              pii:true,  all:true},
    'OR-INT'  :{cats:['Catalogue','Governance','Access'],                           pii:false, all:false},
    'OR-READ' :{cats:['Onboarding','Catalogue','Commercial','Settlement','Orders'], pii:false, all:false}
  },
  partner:{
    'PR-OWNER':{cats:['Onboarding','Catalogue','Commercial','Settlement','Orders','Access','Security','Governance'], pii:true,  all:false},
    'PR-CAT'  :{cats:['Catalogue'],                                                 pii:false, all:false},
    'PR-FUL'  :{cats:['Orders'],                                                    pii:false, all:false},
    'PR-FIN'  :{cats:['Settlement','Commercial'],                                   pii:false, all:false},
    'PR-SUP'  :{cats:['Orders'],                                                    pii:false, all:false}
  },
  buyer:{
    /* Account events belong to the account administrator. Without this an
       entry is written that nobody in the organisation may ever read, which
       is a hole rather than a control. The same reasoning adds Settlement:
       whoever can change the payment instruction has to be able to read that
       they changed it. */
    'BY-PROC' :{cats:['Orders','Access','Security','Governance','Commercial','Account','Settlement'],
                pii:true, all:false},
    'BY-FIN'  :{cats:['Orders','Commercial','Settlement','Governance'],             pii:false, all:false},
    'BY-IT'   :{cats:['Orders','Security'],                                         pii:false, all:false},
    'BY-REQ'  :{cats:['Orders'],                                                    pii:false, all:false},
    'BY-DEPT' :{cats:['Orders'],                                                    pii:false, all:false},
    'BY-VIEW' :{cats:['Orders'],                                                    pii:false, all:false}
  },
  consumer:{
    'CO-OWNER':{cats:['Account','Orders','Access','Security','Commercial'],         pii:true,  all:false},
    'CO-ADULT':{cats:['Orders'],                                                    pii:false, all:false},
    'CO-TEEN' :{cats:['Orders'],                                                    pii:false, all:false},
    'CO-VIEW' :{cats:['Orders'],                                                    pii:false, all:false}
  }
};
const AUDIT_RETENTION = {
  operator:'7 years — financial and regulatory records',
  partner :'7 years, mirrored from the marketplace record',
  buyer   :'7 years — procurement and approval evidence',
  consumer:'25 months, or until the account closes plus 30 days'
};

/* Seeded history. Deliberately mixed: routine entries, a few that matter, and
   a couple that an auditor would stop on. */
const AUDIT_LOG = {operator:[], partner:[], buyer:[], consumer:[]};
(function seedAudit(){
  const ip=n=>'10.'+(20+n%9)+'.'+(1+n%40)+'.'+(2+n%200);
  const add=(ctx,e,i)=>{
    const meta=AUDIT_ACTIONS[e.action]||{label:e.action,cat:'Governance',sev:'info'};
    AUDIT_LOG[ctx].push(Object.assign({
      id:'AUD-'+ctx.slice(0,2).toUpperCase()+'-'+(9000+AUDIT_LOG[ctx].length),
      cat:meta.cat, sev:meta.sev, pii:!!meta.pii, label:meta.label,
      ip:ip(i), ua:'Chrome 141 · Windows', result:'ok', before:null, after:null
    }, e));
  };
  /* ---------------- operator ---------------- */
  [
    {when:'25 Jul 2026 09:41', actor:'Ananya Krishnan', role:'OR-ADMIN', action:'settlement.approved',
     object:'Jul 2026 run', detail:'15 statements released for the 15 Aug cycle',
     before:'pending', after:'approved', amount:644805.12},
    {when:'25 Jul 2026 09:12', actor:'Ruben Oyelaran', role:'OR-FIN', action:'statement.approved',
     object:'STM-JUL-1003', detail:'Sentinel Cyber · net $33,095.54', before:'pending', after:'approved'},
    {when:'25 Jul 2026 08:55', actor:'Tomas Novak', role:'OR-CAT', action:'listing.queried',
     object:'SKU-4007 Lumen Watch Active', detail:'Type approval missing for UAE and Kenya; listing held'},
    {when:'24 Jul 2026 17:20', actor:'Ananya Krishnan', role:'OR-ADMIN', action:'plan.rate.changed',
     object:'CP-DEVICE-VOL', detail:'Base rate 9% to 8.5%, effective next period, 30-day notice sent',
     before:'9%', after:'8.5%'},
    {when:'24 Jul 2026 16:02', actor:'Ananya Krishnan', role:'OR-ADMIN', action:'partner.suspended',
     object:'PTR-1014 Vertex Endpoint', detail:'Provisioning SLA breached on 9 of 12 orders',
     before:'live', after:'suspended'},
    {when:'24 Jul 2026 14:48', actor:'Lena Fischer', role:'OR-ONB', action:'partner.gate.cleared',
     object:'PTR-1012 Northwind Mobility · Agreements', detail:'Terms and DPA countersigned',
     before:'now', after:'done'},
    {when:'24 Jul 2026 11:31', actor:'Farah Al Hashimi', role:'OR-SUP', action:'order.intervened',
     object:'ORD-881204', detail:'Refunded and re-provisioned after third fulfilment failure'},
    {when:'23 Jul 2026 15:10', actor:'Ruben Oyelaran', role:'OR-FIN', action:'tax.changed',
     object:'TX-KE Kenya', detail:'Merchant of record moved to the seller',
     before:'marketplace', after:'seller'},
    {when:'23 Jul 2026 10:04', actor:'Ananya Krishnan', role:'OR-ADMIN', action:'role.perm.changed',
     object:'OR-SUP Support agent', detail:'Decide a dispute: scoped to full',
     before:'scoped', after:'full'},
    {when:'22 Jul 2026 18:22', actor:'Noa Barak', role:'OR-SUP', action:'audit.viewed',
     object:'Audit log', detail:'Filtered to Orders, 14 entries read', result:'ok'},
    {when:'22 Jul 2026 18:19', actor:'Noa Barak', role:'OR-SUP', action:'settlement.approved',
     object:'STM-JUL-1007', detail:'Attempted outside role scope', result:'denied'},
    {when:'21 Jul 2026 09:37', actor:'Ananya Krishnan', role:'OR-ADMIN', action:'user.invited',
     object:'c.hsu@gmail.com', detail:'Invited as Catalogue reviewer'},
    {when:'20 Jul 2026 13:55', actor:'Lena Fischer', role:'OR-ONB', action:'doc.viewed',
     object:'PTR-1012 · Certificate of incorporation', detail:'Viewed during KYC review'},
    {when:'19 Jul 2026 16:40', actor:'Ananya Krishnan', role:'OR-ADMIN', action:'gatepolicy.changed',
     object:'Bank & tax gate', detail:'Target reduced from 3 to 2 working days',
     before:'3 days', after:'2 days'},
    {when:'18 Jul 2026 12:08', actor:'Ruben Oyelaran', role:'OR-FIN', action:'export.taken',
     object:'Settlement register', detail:'30 records, CSV, unfiltered'}
  ].forEach((e,i)=>add('operator',e,i));

  /* ---------------- partner (Sentinel Cyber) ---------------- */
  [
    {when:'25 Jul 2026 09:14', actor:'Marketplace', role:'—', action:'statement.approved',
     object:'SB-2026-1003-1042', detail:'Jul 2026 statement approved · net $33,095.54'},
    {when:'25 Jul 2026 08:02', actor:'Farah Al Hashimi', role:'PR-OWNER', action:'endpoint.changed',
     object:'EP-01 Fulfilment', detail:'Retry policy 3 attempts, timeout 5,000 ms',
     before:'5 attempts', after:'3 attempts'},
    {when:'24 Jul 2026 16:44', actor:'Marketplace', role:'—', action:'listing.queried',
     object:'SKU-4007', detail:'Type approval evidence requested; reply due 30 Jul'},
    {when:'24 Jul 2026 11:20', actor:'Amir Haddad', role:'PR-FUL', action:'order.intervened',
     object:'ORD-881922', detail:'Marked dispatched after webhook failure'},
    {when:'23 Jul 2026 14:05', actor:'Farah Al Hashimi', role:'PR-OWNER', action:'listing.priced',
     object:'SKU-6001 Sentinel MDR Essentials', detail:'Sale price 336.00 to 323.00',
     before:'$336.00', after:'$323.00'},
    {when:'22 Jul 2026 10:31', actor:'Farah Al Hashimi', role:'PR-OWNER', action:'apikey.created',
     object:'mk_live_7f2a••••', detail:'Scopes orders:write, catalogue:read'},
    {when:'21 Jul 2026 09:55', actor:'Marketplace', role:'—', action:'partner.gate.cleared',
     object:'Security Marketplace · Bank & tax', detail:'Existing settlement account reused',
     before:'now', after:'done'},
    {when:'20 Jul 2026 15:12', actor:'Priya Sundar', role:'PR-FIN', action:'settlement.approved',
     object:'STM-JUN-1003', detail:'Queried, then accepted', result:'ok'},
    {when:'19 Jul 2026 11:47', actor:'Farah Al Hashimi', role:'PR-OWNER', action:'user.role.changed',
     object:'Amir Haddad', detail:'Support to Fulfilment operator',
     before:'PR-SUP', after:'PR-FUL'},
    {when:'18 Jul 2026 08:30', actor:'Farah Al Hashimi', role:'PR-OWNER', action:'password.changed',
     object:'Own account', detail:'Other sessions signed out'}
  ].forEach((e,i)=>add('partner',e,i));

  /* ---------------- enterprise buyer (Brightline Foods) ---------------- */
  [
    {when:'25 Jul 2026 10:22', actor:'Rohan Iyer', role:'BY-FIN', action:'requisition.approved',
     object:'REQ-4471', detail:'Sentinel MDR, 40 seats · $12,920.00', amount:12920},
    {when:'25 Jul 2026 09:08', actor:'Deepa Menon', role:'BY-PROC', action:'order.placed',
     object:'ORD-882431', detail:'Cold-chain sensors, 24 units'},
    {when:'24 Jul 2026 17:35', actor:'Rohan Iyer', role:'BY-FIN', action:'requisition.declined',
     object:'REQ-4468', detail:'Trailer tracking pilot deferred to next budget year'},
    {when:'24 Jul 2026 15:12', actor:'Rohan Iyer', role:'BY-FIN', action:'promo.changed',
     object:'Approval policy', detail:'Finance threshold $2,000 to $5,000',
     before:'$2,000', after:'$5,000'},
    {when:'23 Jul 2026 13:40', actor:'Sanjay Rao', role:'BY-IT', action:'requisition.approved',
     object:'REQ-4465', detail:'Security sign-off on endpoint protection'},
    {when:'22 Jul 2026 11:18', actor:'Deepa Menon', role:'BY-PROC', action:'user.invited',
     object:'k.pillai@gmail.com', detail:'Invited as Requester with a $500 cap'},
    {when:'21 Jul 2026 16:50', actor:'Deepa Menon', role:'BY-PROC', action:'cap.changed',
     object:'Nikhil Varma', detail:'Monthly cap $250 to $1,000', before:'$250', after:'$1,000'},
    {when:'20 Jul 2026 09:25', actor:'Rohan Iyer', role:'BY-FIN', action:'export.taken',
     object:'Invoices', detail:'5 records, CSV'},
    {when:'19 Jul 2026 14:02', actor:'Deepa Menon', role:'BY-PROC', action:'role.perm.changed',
     object:'BY-REQ Requester', detail:'Raise a requisition: none to full',
     before:'none', after:'full'}
  ].forEach((e,i)=>add('buyer',e,i));

  /* ---------------- consumer (Priya Raman's household) ---------------- */
  [
    {when:'25 Jul 2026 08:14', actor:'Priya Raman', role:'CO-OWNER', action:'order.placed',
     object:'ORD-882610', detail:'StreamNova Premium subscription started'},
    {when:'24 Jul 2026 20:41', actor:'Arun Raman', role:'CO-ADULT', action:'order.placed',
     object:'ORD-882588', detail:'Data top-up 10 GB · within monthly cap'},
    {when:'24 Jul 2026 19:03', actor:'Priya Raman', role:'CO-OWNER', action:'cap.changed',
     object:'Meera Raman', detail:'Monthly cap $20 to $35', before:'$20', after:'$35'},
    {when:'23 Jul 2026 21:30', actor:'Priya Raman', role:'CO-OWNER', action:'payment.added',
     object:'Card ending 4417', detail:'Set as the default payment method'},
    {when:'22 Jul 2026 18:12', actor:'Meera Raman', role:'CO-TEEN', action:'order.placed',
     object:'REQ-C-118', detail:'Game purchase above cap · sent to the account owner', result:'held'},
    {when:'21 Jul 2026 12:44', actor:'Priya Raman', role:'CO-OWNER', action:'address.changed',
     object:'Home', detail:'Delivery address updated'},
    {when:'20 Jul 2026 10:05', actor:'Priya Raman', role:'CO-OWNER', action:'password.changed',
     object:'Own account', detail:'Other sessions signed out'},
    {when:'18 Jul 2026 16:22', actor:'Priya Raman', role:'CO-OWNER', action:'data.requested',
     object:'DSR-2026-0412', detail:'Copy of my data requested · due 17 Aug 2026'}
  ].forEach((e,i)=>add('consumer',e,i));
})();

/* ===========================================================================
   LOGIN AND STOREFRONT BANNERS  (PRD §4.3 · ORD)
   Operator-managed promotional frames on the storefront. Deliberately modelled
   as a small ad server rather than a hard-coded hero image: slots, targeting,
   scheduling, weighting and measurement, because "put a picture on the login
   page" becomes exactly that within a quarter.
   =========================================================================== */
const BANNER_SLOTS = [
  {id:'login',    label:'Login screen',      w:'1200×360', max:3,
   note:'Seen before sign-in, so no personal targeting is possible — only locale and device.'},
  {id:'home-hero',label:'Storefront hero',   w:'1600×420', max:4,
   note:'First thing after sign-in. Personal targeting available.'},
  {id:'home-strip',label:'Storefront strip', w:'1200×200', max:6,
   note:'Below the fold on the storefront home.'},
  {id:'category', label:'Category header',   w:'1200×220', max:4,
   note:'Top of a marketplace category page.'},
  {id:'bill',     label:'Bill insert',       w:'1200×260', max:3,
   note:'Printed on the bill itself. Read by everyone who opens it, so it must be relevant to what they '+
        'already buy rather than a general campaign — a bill is not a billboard.'}
];
/* Who a banner is aimed at. Pre-login targeting is deliberately impoverished. */
const BANNER_AUDIENCES = ['Everyone','Signed out only','Consumer','Enterprise','Partner reseller',
                          'New customers','Existing customers','Lapsed customers'];
const BANNER_STATES = ['draft','scheduled','live','ended','paused'];

/* The artwork motifs a banner can carry. Drawn, not photographed: a licence we
   do not have and an image that dates the moment a handset is refreshed. */
const AD_MOTIFS = [
  {id:'twophones',   label:'Two handsets',        note:'Adding a line, porting in, anything about a second device.'},
  {id:'shieldphone', label:'Handset and shield',  note:'Insurance, device cover, protection.'},
  {id:'racklock',    label:'Rack and padlock',    note:'Business connectivity and managed security.'},
  {id:'tradein',     label:'Trade-in exchange',   note:'Upgrades and exchanges.'},
  {id:'night',       label:'Screen at night',     note:'Off-peak data, streaming, entertainment.'},
  {id:'coldchain',   label:'Refrigerated lorry',  note:'IoT, telemetry, logistics.'},
  {id:'parcel',      label:'Parcel',              note:'Welcome offers and anything that arrives.'},
  {id:'festival',    label:'Festival lights',     note:'Seasonal and regional campaigns.'},
  {id:'certificate', label:'Certificate',         note:'Attestation, compliance, accreditation.'},
  {id:'referral',    label:'Two people',          note:'Referral and advocacy.'},
  {id:'storefront',  label:'Shopfront',           note:'Partner storefronts and marketplace launches.'}
];
const BANNERS = [
  /* Bill inserts. Relevant to what the reader already buys, because a bill is
     not a billboard — and never shown on a bill that is chasing money. */
  {id:'BN-B1', slot:'bill', name:'Add a second line', headline:'Add a second line for $9 a month',
   sub:'Same data pool, same bill. Cancel any time.', cta:'Add a line', target:'consumer',
   audience:'Everyone', from:'01 Jul 2026', to:'31 Dec 2026', weight:50,
   state:'live', accent:'#0D47A1', art:'twophones', alt:'Two handsets side by side',
   impressions:0, clicks:0, orders:0, revenue:0, promo:null, locale:'All', device:'All'},
  {id:'BN-B2', slot:'bill', name:'Device protection', headline:'Cover your handset from $6.90 a month',
   sub:'Screen, theft and accidental damage. Add it to this bill.', cta:'See cover', target:'consumer',
   audience:'Everyone', from:'01 Jul 2026', to:'30 Sep 2026', weight:40,
   state:'live', accent:'#00695C', art:'shieldphone', alt:'A handset with a shield motif',
   impressions:0, clicks:0, orders:0, revenue:0, promo:null, locale:'All', device:'All'},
  {id:'BN-01', slot:'login', name:'Business 5G + Managed Firewall',
   headline:'Get 10% off Managed Firewall with Business 5G',
   sub:'Bundle connectivity and security on one bill. Ends 31 Aug.',
   cta:'See the bundle', target:'security', audience:'Signed out only',
   from:'01 Jul 2026', to:'31 Aug 2026', weight:60, state:'live',
   accent:'#0D47A1', art:'racklock', alt:'Office network rack with a security padlock motif',
   impressions:184320, clicks:5122, orders:214, revenue:186400,
   promo:'DR-03', locale:'All', device:'All'},
  {id:'BN-02', slot:'login', name:'Trade in and upgrade',
   headline:'Your old handset is worth up to $310',
   sub:'Trade in when you upgrade. Instant quote, credit off at checkout.',
   cta:'Get a quote', target:'device', audience:'Signed out only',
   from:'15 Jun 2026', to:'30 Sep 2026', weight:40, state:'live',
   accent:'#00695C', art:'tradein', alt:'Two handsets side by side, one older',
   impressions:122900, clicks:6890, orders:388, revenue:141200,
   promo:null, locale:'All', device:'Mobile'},
  {id:'BN-03', slot:'home-hero', name:'Evening data hour',
   headline:'12% off streaming, 8pm to 11pm',
   sub:'Every evening this quarter, on every content subscription.',
   cta:'Browse content', target:'content', audience:'Consumer',
   from:'01 Jul 2026', to:'30 Sep 2026', weight:70, state:'live',
   accent:'#4A148C', art:'night', alt:'A sofa lit by a television at night',
   impressions:96410, clicks:9120, orders:1204, revenue:26840,
   promo:'DR-01', locale:'All', device:'All'},
  {id:'BN-04', slot:'home-hero', name:'IoT starter for logistics',
   headline:'Cold-chain sensors, connectivity included',
   sub:'24 sensors, a pooled data plan and a dashboard. One order.',
   cta:'See the bundle', target:'iot', audience:'Enterprise',
   from:'01 Jun 2026', to:'31 Dec 2026', weight:30, state:'live',
   accent:'#1B5E20', art:'coldchain', alt:'Refrigerated lorry with a sensor overlay',
   impressions:14280, clicks:1032, orders:31, revenue:214300,
   promo:null, locale:'All', device:'Desktop'},
  {id:'BN-05', slot:'home-strip', name:'First order welcome',
   headline:'$15 off your first order',
   sub:'On anything over $40. One per account.',
   cta:'Start shopping', target:null, audience:'New customers',
   from:'01 Jan 2026', to:'31 Dec 2026', weight:100, state:'live',
   accent:'#E65100', art:'parcel', alt:'A wrapped parcel on a doorstep',
   impressions:41200, clicks:3980, orders:776, revenue:48900,
   promo:'DR-05', locale:'All', device:'All'},
  {id:'BN-06', slot:'login', name:'Diwali device sale',
   headline:'Up to 20% off handsets',
   sub:'Selected models. Festival pricing.',
   cta:'Shop devices', target:'device', audience:'Signed out only',
   from:'20 Oct 2026', to:'05 Nov 2026', weight:80, state:'scheduled',
   accent:'#B71C1C', art:'festival', alt:'Handsets arranged with festival lights',
   impressions:0, clicks:0, orders:0, revenue:0,
   promo:null, locale:'India', device:'All'},
  {id:'BN-07', slot:'category', name:'Security attestation drive',
   headline:'Every security listing is independently attested',
   sub:'Look for the badge. Attestations are no older than 12 months.',
   cta:'Why it matters', target:'security', audience:'Enterprise',
   from:'01 May 2026', to:'30 Jun 2026', weight:50, state:'ended',
   accent:'#37474F', art:'certificate', alt:'A certificate with a verification mark',
   impressions:22140, clicks:640, orders:0, revenue:0,
   promo:null, locale:'All', device:'All'},
  {id:'BN-08', slot:'home-strip', name:'Refer a business',
   headline:'Refer a business, both get a month free',
   sub:'On any security or IoT subscription.',
   cta:'Refer someone', target:null, audience:'Existing customers',
   from:'01 Aug 2026', to:'31 Oct 2026', weight:50, state:'paused',
   accent:'#455A64', art:'referral', alt:'Two handshakes overlapping',
   impressions:8100, clicks:210, orders:4, revenue:9600,
   promo:null, locale:'All', device:'All'},
  /* Deliberately imperfect: live, with no measurement configured. */
  {id:'BN-09', slot:'category', name:'Partner storefront launch',
   headline:'Beacon Reseller is now on the marketplace',
   sub:'Wholesale data packs for East Africa.',
   cta:'See the storefront', target:'partner', audience:'Everyone',
   from:'10 Jul 2026', to:'31 Aug 2026', weight:40, state:'live',
   accent:'#5D4037', art:'storefront', alt:'A shopfront sign being raised',
   impressions:null, clicks:null, orders:null, revenue:null,
   promo:null, locale:'Kenya', device:'All'}
];
const BNMAP = {}; BANNERS.forEach(b=>BNMAP[b.id]=b);
const BANNER_RULES = {
  maxPerSlot:'A slot shows one banner at a time, chosen by weight among those eligible.',
  preLogin:'Nothing personal may be used before sign-in — no name, no history, no segment.',
  measurement:'A banner with no measurement is not a campaign, it is decoration.',
  accessibility:'Alt text is mandatory. A banner is an image with a message; an undescribed one is a blank space.'
};

/* ===========================================================================
   INVENTORY  (INV · epics INV-BE-001, INV-FE-001)
   Stock was a display field. It is now a ledger: on hand, reserved, available,
   with a movement history and reservations that expire. Availability shown to
   a buyer is derived from it, so the storefront cannot promise what the
   warehouse does not have.
   =========================================================================== */
/* A warehouse is a real place with an address, a contact and a cut-off. A
   record without those cannot raise a shipping label or answer a phone call
   about a late delivery, so none of them are optional. */
const WH_TYPES = [
  {id:'own',       label:'Own distribution centre', note:'Operated by the marketplace. Stock is ours to count.'},
  {id:'3pl',       label:'Third-party logistics',   note:'Operated under contract. Their WMS is authoritative.'},
  {id:'dropship',  label:'Seller drop-ship',        note:'The seller ships from their own stock. We report what they report.'},
  {id:'forward',   label:'Forward stocking',        note:'Small holding near demand, replenished from a hub.'},
  {id:'returns',   label:'Returns centre',          note:'Inbound only. Grades, refurbishes and restocks.'}
];
const WAREHOUSES = [
  {id:'WH-BLR', name:'Bengaluru DC', code:'BLR01', type:'own', status:'active',
   lines:['Plot 42, KIADB Industrial Area','Bommasandra, Bengaluru 560099'],
   country:'India', tz:'IST', cutoff:'16:00 IST',
   contact:'Ravi Shankar', phone:'+91 80 4111 2200', email:'blr.dc@6dtech.co.in',
   capacity:12000, serves:['IN'], categories:['device','iot'], gstin:'29AAECA1234F1Z5',
   opened:'02 Mar 2024'},
  {id:'WH-DXB', name:'Dubai hub', code:'DXB01', type:'3pl', status:'active',
   lines:['Warehouse 14, Jebel Ali Free Zone','Dubai'],
   country:'UAE', tz:'GST', cutoff:'15:00 GST',
   contact:'Layla Haddad', phone:'+971 4 887 3300', email:'dxb.hub@6dtech.co.in',
   capacity:6000, serves:['AE','SA','KW'], categories:['device','iot'], gstin:'TRN 100472839100003',
   opened:'19 Apr 2024', operator:'Agility Logistics'},
  {id:'WH-SIN', name:'Singapore hub', code:'SIN01', type:'3pl', status:'active',
   lines:['3 Changi South Street 2','Singapore 486548'],
   country:'Singapore', tz:'SGT', cutoff:'17:00 SGT',
   contact:'Wei Lin Tan', phone:'+65 6543 8800', email:'sin.hub@6dtech.co.in',
   capacity:4500, serves:['SG','MY','ID'], categories:['device'], gstin:'GST M9-0012345-6',
   opened:'11 Sep 2025', operator:'YCH Group'},
  {id:'WH-DRP', name:'Seller drop-ship', code:'DROP', type:'dropship', status:'active',
   lines:['No marketplace premises — shipped by the seller'],
   country:'—', tz:'—', cutoff:'Seller controlled',
   contact:'Seller fulfilment desk', phone:'—', email:'fulfilment@6dtech.co.in',
   capacity:null, serves:['All'], categories:['device','iot','security'], gstin:null,
   opened:'02 Mar 2024',
   note:'Capacity is not measured here — the stock is not ours and the count is the seller\u2019s.'},
  {id:'WH-RET', name:'Returns and refurb', code:'RET01', type:'returns', status:'active',
   lines:['Plot 11, KIADB Industrial Area','Bommasandra, Bengaluru 560099'],
   country:'India', tz:'IST', cutoff:'14:00 IST',
   contact:'Anjali Desai', phone:'+91 80 4111 2280', email:'returns@6dtech.co.in',
   capacity:2000, serves:['IN'], categories:['device'], gstin:'29AAECA1234F1Z5',
   opened:'07 Feb 2026'}
];
const WHMAP={}; WAREHOUSES.forEach(w=>WHMAP[w.id]=w);

/* Routing. Which warehouse serves an order, decided by category and market
   rather than by whoever is nearest to the person picking. */
const WH_ROUTING = [
  {id:'RT-01', priority:1, category:'device',   market:'IN',  warehouse:'WH-BLR',
   why:'Domestic handsets ship from the domestic DC. No customs, next-day reach.'},
  {id:'RT-02', priority:2, category:'device',   market:'AE',  warehouse:'WH-DXB',
   why:'Free-zone stock avoids re-import duty on a Gulf delivery.'},
  {id:'RT-03', priority:3, category:'device',   market:'SG',  warehouse:'WH-SIN',
   why:'Regional hub for South-East Asia.'},
  {id:'RT-04', priority:4, category:'iot',      market:'All', warehouse:'WH-BLR',
   why:'SIM and sensor kits are configured before dispatch, and only Bengaluru does that.'},
  {id:'RT-05', priority:5, category:'security', market:'All', warehouse:'WH-DRP',
   why:'Security hardware ships from the ISV. We never hold it.'},
  {id:'RT-99', priority:99, category:'Any',     market:'All', warehouse:'WH-DRP',
   why:'Fallback. If nothing else matches, the seller ships it — stated rather than silently failing.'}
];
const HOLD_TTL_MIN = 30;   /* soft-hold time to live, INV-BE-001-04 */

/* Only physical things carry stock. A subscription does not run out. */
const INVENTORY = {};
(function seedInventory(){
  const wh=['WH-BLR','WH-DXB','WH-SIN'];
  PRODUCTS.forEach((p,i)=>{
    const physical = p.fulfil==='shipped' || (p.v==='iot' && /sensor|tracker|gateway/i.test(p.name));
    if(!physical) return;
    const onHand = p.stock==='out' ? 0 : p.stock==='low' ? [3,5,7,9][i%4] : [42,68,120,215,340][i%5];
    const reserved = onHand ? Math.min(onHand, [0,2,4,6][i%4]) : 0;
    INVENTORY[p.id]={
      sku:p.id, name:p.name, seller:p.seller, partnerId:p.partner||null, v:p.v,
      warehouse: p.partner ? 'WH-DRP' : wh[i%3],
      onHand:onHand, reserved:reserved, reorderAt:[6,10,15,25][i%4],
      onOrder: onHand<=[6,10,15,25][i%4] ? [24,50,100][i%3] : 0,
      dueIn: onHand<=[6,10,15,25][i%4] ? ['31 Jul 2026','07 Aug 2026','14 Aug 2026'][i%3] : null,
      unitCost:p.cost||0, backorder: p.v==='iot',
      lastCount:['18 Jul 2026','21 Jul 2026','24 Jul 2026'][i%3]
    };
  });
})();
/* SIM pool — a different shape of inventory (INV-BE-001-02). */
const SIM_POOL = {
  total:12000, available:8420, reserved:640, activated:2810, retired:130,
  batches:[
    {id:'BAT-2026-04', loaded:'02 Apr 2026', count:5000, type:'eSIM',    available:3120},
    {id:'BAT-2026-06', loaded:'11 Jun 2026', count:5000, type:'Physical', available:4180},
    {id:'BAT-2026-07', loaded:'09 Jul 2026', count:2000, type:'eSIM',    available:1120}
  ],
  lowAt:1500
};
/* Logical resource pools (INV-BE-001-03) — capacity that is allocated, not shipped. */
const RESOURCE_POOLS = [
  {id:'RP-DATA', name:'IoT pooled data', unit:'GB/month', capacity:50000, allocated:38400, alertAt:80},
  {id:'RP-SEAT', name:'MDR analyst seats', unit:'seats',  capacity:900,   allocated:764,   alertAt:80},
  {id:'RP-CLD',  name:'Cloud backup',     unit:'TB',      capacity:1200,  allocated:642,   alertAt:80}
];
/* Movements. Append-only, like the audit trail, for the same reason. */
const STOCK_MOVES = [];
const RESERVATIONS = [];
(function seedMoves(){
  const skus=Object.keys(INVENTORY).slice(0,6);
  const kinds=[
    ['receipt','Goods received','+'],
    ['dispatch','Order dispatched','-'],
    ['count','Stock count adjustment','±'],
    ['return','Customer return','+'],
    ['damage','Written off — damaged','-']
  ];
  skus.forEach((sku,i)=>{
    for(let k=0;k<3;k++){
      const kind=kinds[(i+k)%kinds.length];
      const qty=kind[2]==='-' ? -[1,2,4][k%3] : [6,12,24][k%3];
      STOCK_MOVES.push({
        id:'MOV-'+(4400+STOCK_MOVES.length), sku:sku, name:INVENTORY[sku].name,
        kind:kind[0], label:kind[1], qty:qty,
        when:['24 Jul 2026','22 Jul 2026','19 Jul 2026','16 Jul 2026'][(i+k)%4],
        by:['Warehouse — Bengaluru','Fulfilment automation','Anil Mehra','Returns desk'][(i+k)%4],
        ref: kind[0]==='dispatch' ? 'ORD-'+(881000+i*13+k) : null,
        note: kind[0]==='count' ? 'Cycle count variance reconciled' : null
      });
    }
  });
})();

/* ===========================================================================
   PARTNER PORTAL BRANDING  (PMP · PRD §4.1, epic PMP-FE-001-03)
   The seller's own console, in the seller's own livery. Deliberately scoped:
   branding applies to the partner's console only. It never touches the
   storefront a buyer sees, because that is the operator's surface and a
   marketplace where every seller restyles the checkout is not a marketplace.
   =========================================================================== */
const BRAND_PRESETS = [
  {id:'default',  name:'Marketplace default', primary:'#0099FF', accent:'#EE743B', rail:'#0D1B4B'},
  {id:'sentinel', name:'Sentinel navy',       primary:'#1B5E8C', accent:'#D97706', rail:'#10263A'},
  {id:'forest',   name:'Forest',              primary:'#2E7D52', accent:'#B45309', rail:'#12301F'},
  {id:'plum',     name:'Plum',                primary:'#6D3F9E', accent:'#C2410C', rail:'#2A1740'},
  {id:'graphite', name:'Graphite',            primary:'#455A64', accent:'#C2410C', rail:'#1C262B'}
];
/* Which cards a seller may show or hide on their own dashboard. */
const BRAND_WIDGETS = [
  {id:'gmv',        label:'Gross merchandise value',  group:'Commercial', locked:false},
  {id:'orders',     label:'Orders to fulfil',         group:'Operations', locked:true,
   why:'Fulfilment obligations cannot be hidden — an unseen order is still an order.'},
  {id:'settlement', label:'Settlement due',           group:'Commercial', locked:false},
  {id:'listings',   label:'Live listings',            group:'Catalogue',  locked:false},
  {id:'onboarding', label:'Onboarding progress',      group:'Operations', locked:true,
   why:'An application in flight has deadlines against it.'},
  {id:'insights',   label:'AARYA insights',           group:'Insight',    locked:false},
  {id:'chart',      label:'Gross value by month',     group:'Insight',    locked:false},
  {id:'disputes',   label:'Open disputes',            group:'Operations', locked:true,
   why:'A dispute has an SLA and a counterparty waiting.'},
  {id:'integr',     label:'Integration health',       group:'Technical',  locked:false}
];
const MY_BRAND = {
  preset:'default',
  primary:'#0099FF', accent:'#EE743B', rail:'#0D1B4B',
  theme:'light',
  logo:null, logoAlt:'',
  displayName:'',                /* falls back to the legal name */
  widgets:{gmv:true, orders:true, settlement:true, listings:true, onboarding:true,
           insights:true, chart:true, disputes:true, integr:true},
  applied:false, lastChanged:null, changedBy:null
};

/* ===========================================================================
   TICKETING AND SLA  (SUP · epics SUP-BE-001, SUP-FE-001)
   Disputes were the only case type. This is the general queue: categories,
   priorities, an SLA clock that stops when the ball is in the requester's
   court, and escalation that is automatic rather than remembered.
   =========================================================================== */
const TICKET_CATEGORIES = [
  {id:'provisioning', label:'Provisioning failure', group:'Technical', firstMin:60,  resolveHr:8,  owner:'Support agents'},
  {id:'billing',      label:'Billing query',        group:'Finance',   firstMin:240, resolveHr:48, owner:'Settlement approvers'},
  {id:'settlement',   label:'Settlement dispute',   group:'Finance',   firstMin:240, resolveHr:120,owner:'Settlement approvers'},
  {id:'integration',  label:'Integration problem',  group:'Technical', firstMin:120, resolveHr:24, owner:'Platform engineering'},
  {id:'catalogue',    label:'Listing or catalogue', group:'Commercial',firstMin:480, resolveHr:72, owner:'Catalogue reviewers'},
  {id:'account',      label:'Account and access',   group:'Admin',     firstMin:120, resolveHr:24, owner:'Marketplace admins'},
  {id:'delivery',     label:'Delivery or returns',  group:'Operations',firstMin:120, resolveHr:48, owner:'Support agents'},
  {id:'other',        label:'Something else',       group:'Admin',     firstMin:480, resolveHr:72, owner:'Support agents'}
];
const TCATMAP={}; TICKET_CATEGORIES.forEach(c=>TCATMAP[c.id]=c);
/* Priority multiplies the category target rather than replacing it, so a
   P1 billing query is still slower than a P1 outage — which is correct. */
const TICKET_PRIORITIES = [
  {id:'P1', label:'Urgent — service is down', mult:0.25, note:'Something a customer cannot work around'},
  {id:'P2', label:'High — materially blocked', mult:0.5,  note:'A workaround exists but is costly'},
  {id:'P3', label:'Normal',                    mult:1,    note:'The default'},
  {id:'P4', label:'Low — when convenient',     mult:2,    note:'Questions and requests'}
];
const TPRIMAP={}; TICKET_PRIORITIES.forEach(p=>TPRIMAP[p.id]=p);
const TICKET_STATES = ['new','open','waiting','escalated','resolved','closed'];

const TICKETS = [];
(function seedTickets(){
  const rows=[
    {ctx:'partner', cat:'integration', pri:'P1', state:'escalated',
     subject:'Fulfilment webhook returning 500 on every retry',
     raisedBy:'Farah Al Hashimi', org:'Sentinel Cyber', raised:'24 Jul 2026 09:12',
     assignee:'Tomas Novak', assigneeRole:'OR-CAT', ageHr:29, firstReplyMin:38, waitedHr:0,
     escalatedTo:'Platform engineering lead', escalatedAt:'25 Jul 2026 09:12',
     ref:'EP-01',
     thread:[
       {who:'Farah Al Hashimi', side:'requester', when:'24 Jul 09:12',
        text:'Three of five sandbox callbacks are returning HTTP 500 with an empty body. This is blocking our Security Marketplace go-live at the technical gate.'},
       {who:'Tomas Novak', side:'agent', when:'24 Jul 09:50',
        text:'Thanks — reproduced from our side. The retries are hitting your endpoint 800ms apart; your logs may show them as duplicates. Can you confirm the endpoint is idempotent on the order reference?'},
       {who:'Farah Al Hashimi', side:'requester', when:'24 Jul 14:20',
        text:'It is idempotent. The 500 is coming from our auth layer rejecting the second token in the window.'},
       {who:'—', side:'system', when:'25 Jul 09:12',
        text:'Escalated automatically — first-response target met but the 24-hour resolution target has passed.'}
     ]},
    {ctx:'partner', cat:'settlement', pri:'P2', state:'waiting',
     subject:'Withholding applied on the June statement',
     raisedBy:'Priya Sundar', org:'Sentinel Cyber', raised:'22 Jul 2026 11:04',
     assignee:'Ruben Oyelaran', assigneeRole:'OR-FIN', ageHr:75, firstReplyMin:96, waitedHr:52,
     escalatedTo:null, escalatedAt:null, ref:'STM-JUN-1003',
     thread:[
       {who:'Priya Sundar', side:'requester', when:'22 Jul 11:04',
        text:'The June statement shows 10% withheld. We filed a treaty certificate in March.'},
       {who:'Ruben Oyelaran', side:'agent', when:'22 Jul 12:40',
        text:'The certificate on file expired on 11 Jan 2026. Withholding resumed automatically at that point. If you send the renewed certificate we will release it from the next run — we cannot restate a statement already issued, but you can reclaim the withheld amount from the authority directly.'},
       {who:'—', side:'system', when:'22 Jul 12:40', text:'Waiting on the requester — the SLA clock is paused.'}
     ]},
    {ctx:'buyer', cat:'provisioning', pri:'P1', state:'open',
     subject:'24 cold-chain sensors delivered but not reporting',
     raisedBy:'Deepa Menon', org:'Brightline Foods', raised:'25 Jul 2026 08:40',
     assignee:'Farah Al Hashimi', assigneeRole:'OR-SUP', ageHr:6, firstReplyMin:22, waitedHr:0,
     escalatedTo:null, escalatedAt:null, ref:'ORD-882431',
     thread:[
       {who:'Deepa Menon', side:'requester', when:'25 Jul 08:40',
        text:'All 24 units at the Pune depot show as delivered and activated, but none has sent telemetry.'},
       {who:'Farah Al Hashimi', side:'agent', when:'25 Jul 09:02',
        text:'SIM profiles are active and attached. No data sessions since activation, which usually means the APN on the device rather than the connectivity. Sending the depot the provisioning sheet now.'}
     ]},
    {ctx:'buyer', cat:'billing', pri:'P3', state:'resolved',
     subject:'Invoice INV-2026-0613 does not show the cost centre split',
     raisedBy:'Rohan Iyer', org:'Brightline Foods', raised:'19 Jul 2026 14:15',
     assignee:'Ruben Oyelaran', assigneeRole:'OR-FIN', ageHr:26, firstReplyMin:145, waitedHr:0,
     escalatedTo:null, escalatedAt:null, ref:'INV-2026-0613', resolved:'20 Jul 2026 16:30',
     resolution:'Cost-centre breakdown was switched off in the buyer invoice preferences. Turned on; reissued.',
     thread:[
       {who:'Rohan Iyer', side:'requester', when:'19 Jul 14:15',
        text:'Finance need the split by cost centre and it is not on this one.'},
       {who:'Ruben Oyelaran', side:'agent', when:'19 Jul 16:40',
        text:'It was disabled in your invoice preferences. I have enabled it and reissued 0613.'},
       {who:'Rohan Iyer', side:'requester', when:'20 Jul 16:30', text:'Received, thank you.'}
     ]},
    {ctx:'consumer', cat:'delivery', pri:'P2', state:'open',
     subject:'Handset marked delivered but nothing arrived',
     raisedBy:'Priya Raman', org:'Personal account', raised:'24 Jul 2026 18:22',
     assignee:'Marek Zielinski', assigneeRole:'OR-SUP', ageHr:20, firstReplyMin:64, waitedHr:0,
     escalatedTo:null, escalatedAt:null, ref:'ORD-882588',
     thread:[
       {who:'Priya Raman', side:'requester', when:'24 Jul 18:22',
        text:'Tracking says delivered at 14:10 but there is no parcel and no card.'},
       {who:'Marek Zielinski', side:'agent', when:'24 Jul 19:26',
        text:'Carrier proof of delivery has no signature. I have opened a claim and a replacement is authorised — it does not wait on the claim outcome.'}
     ]},
    {ctx:'consumer', cat:'account', pri:'P3', state:'new',
     subject:'Cannot set a spend cap for my daughter',
     raisedBy:'Priya Raman', org:'Personal account', raised:'25 Jul 2026 13:05',
     assignee:null, assigneeRole:null, ageHr:1, firstReplyMin:null, waitedHr:0,
     escalatedTo:null, escalatedAt:null, ref:null,
     thread:[
       {who:'Priya Raman', side:'requester', when:'25 Jul 13:05',
        text:'The cap saves but her screen still shows the old figure.'}
     ]},
    {ctx:'partner', cat:'catalogue', pri:'P3', state:'closed',
     subject:'Listing rejected — evidence was attached',
     raisedBy:'Farah Al Hashimi', org:'Sentinel Cyber', raised:'11 Jul 2026 10:00',
     assignee:'Tomas Novak', assigneeRole:'OR-CAT', ageHr:52, firstReplyMin:210, waitedHr:8,
     escalatedTo:null, escalatedAt:null, ref:'SKU-6004', resolved:'13 Jul 2026 14:00',
     resolution:'Attestation had been uploaded against the wrong SKU. Relinked and approved.',
     thread:[
       {who:'Farah Al Hashimi', side:'requester', when:'11 Jul 10:00',
        text:'Rejected for a missing attestation that we uploaded on the 8th.'},
       {who:'Tomas Novak', side:'agent', when:'11 Jul 13:30',
        text:'It was attached to SKU-6001, not 6004. Relinked and approved.'}
     ]},
    {ctx:'operator', cat:'integration', pri:'P2', state:'open',
     subject:'Catalogue pull timing out for Volta Routers',
     raisedBy:'Tomas Novak', org:'Aventa Telecom', raised:'25 Jul 2026 07:30',
     assignee:'Tomas Novak', assigneeRole:'OR-CAT', ageHr:7, firstReplyMin:12, waitedHr:0,
     escalatedTo:null, escalatedAt:null, ref:'PTR-1008',
     thread:[
       {who:'Tomas Novak', side:'agent', when:'25 Jul 07:30',
        text:'Their catalogue endpoint is taking over 8 seconds and timing out. Raised internally before chasing the seller.'}
     ]}
  ];
  rows.forEach((r,i)=>{
    const c=TCATMAP[r.cat], p=TPRIMAP[r.pri];
    const firstTarget=Math.round(c.firstMin*p.mult);
    const resolveTarget=Math.round(c.resolveHr*p.mult);
    /* Time spent waiting on the requester does not count against the target. */
    const workedHr=Math.max(0, r.ageHr-(r.waitedHr||0));
    TICKETS.push(Object.assign({
      id:'TKT-'+(6100+i),
      firstTargetMin:firstTarget, resolveTargetHr:resolveTarget,
      workedHr:workedHr,
      firstBreached: r.firstReplyMin!=null ? r.firstReplyMin>firstTarget : (workedHr*60)>firstTarget,
      resolveBreached: (r.state==='resolved'||r.state==='closed') ? false : workedHr>resolveTarget,
      watchers:[], internal:[]
    }, r));
  });
  /* One internal note, to show they are separate from the thread. */
  TICKETS[0].internal.push({who:'Tomas Novak', when:'24 Jul 10:05',
    text:'Their auth layer issues a token per request and rejects the second within the window. This is their bug, but we should document the retry cadence — we have had three of these.'});
})();
const SLA_ESCALATION = [
  {at:'First response target passed', to:'Team lead', note:'Nobody has replied yet'},
  {at:'Half the resolution target',   to:'Team lead', note:'Warning only, no reassignment'},
  {at:'Resolution target passed',     to:'Function lead', note:'Automatic, and the requester is told'},
  {at:'Twice the resolution target',  to:'Head of operations', note:'Reviewed daily until closed'}
];

/* ===========================================================================
   CUSTOMER REVIEWS  (CAT · epics CAT-BE-001-08, CAT-FE-001-03)
   Ratings were a static number. Reviews are now records: written only by
   someone who bought the thing, moderated before publication, answerable by
   the seller, and aggregated from what is actually published.
   =========================================================================== */
const REVIEW_STATES = ['pending','published','rejected'];
const REVIEW_REASONS = [
  'Contains personal data','Abusive or discriminatory','Not about this product',
  'Promotes a competitor','Appears to be incentivised','Duplicate'
];
const REVIEWS = [];
(function seedReviews(){
  const seeds=[
    /* The demo seller carries a realistic spread, including poor reviews that
       have not been answered — that is the state the Reviews screen exists to
       make visible, and a screen that only shows praise proves nothing. */
    ['SKU-5003',5,'Held calibration through a heatwave','Forty units across three depots, no drift over six weeks of 44-degree afternoons. The gateway pairing was the only fiddly part.','Brightline Foods','24 Jul 2026','published',null],
    ['SKU-5003',4,'Good sensor, poor documentation','Hardware is solid. The setup guide assumes you already know their platform, so budget an afternoon of guessing.','Meridian Foods','21 Jul 2026','published',
     {by:'Nimbus Sensors', when:'22 Jul 2026', text:'Fair, and we have heard it before. A rewritten guide with a worked example goes out next month; we will email it to you directly.'}],
    ['SKU-5003',2,'Two of the batch failed inside a fortnight','Eighteen of twenty are fine. Two stopped reporting on day nine and day twelve. Replacements came quickly but I now check every reading.','Harbourpoint Retail','20 Jul 2026','published',null],
    ['SKU-5003',5,'Cheaper than the incumbent and just as good','Swapped out a well-known brand at half the unit cost. No regrets after two months.','Cadence Health','16 Jul 2026','published',null],
    ['SKU-5004',4,'Accurate once you place it properly','Counts are within one or two of the door sensor. Mount it too high and it under-reports; that is not in the manual.','Northwind Mobility','23 Jul 2026','published',null],
    ['SKU-5004',1,'Would not pair with our gateway','Spent three days on it. Support answered on day two and told me the firmware needed a downgrade, which is not something I should have to discover.','Volta Logistics','22 Jul 2026','published',null],
    ['SKU-5004',5,'Battery life as claimed','Eighteen months quoted, and the first cohort is at eleven with plenty left.','Meridian Foods','14 Jul 2026','published',null],
    ['SKU-5004',3,'Fine, unremarkable','Does what it says. Nothing about it made me want to write this until the reminder email.','Harbourpoint Retail','11 Jul 2026','published',
     {by:'Nimbus Sensors', when:'12 Jul 2026', text:'Unremarkable is what we are aiming for in a sensor. Thank you for taking the time.'}],
    ['SKU-5006',5,'The bundle is the right way to buy this','Sensors, SIMs and the pooled plan on one order and one invoice. Buying the pieces separately last year took a fortnight of purchase orders.','Brightline Foods','25 Jul 2026','published',null],
    ['SKU-5006',2,'Connectivity was not active on arrival','Hardware arrived on time. The SIMs took another nine days to provision and nobody could tell me why. The kit sat in a box.','Meridian Foods','19 Jul 2026','published',null],
    ['SKU-5006',4,'Good value, plan the rollout','Twenty-five units is more installation than it sounds. Worth it, but do not promise a same-week go-live.','Cadence Health','13 Jul 2026','published',null],
    ['SKU-5006',5,'Second order in six months','First deployment paid for itself in spoilage we did not have. Ordering another twenty-five.','Northwind Mobility','08 Jul 2026','published',null],
    ['SKU-5003',4,'Solid replacement programme','One unit failed and the replacement was with me in two days, no argument.','Volta Logistics','26 Jul 2026','pending',null],
    ['SKU-6001',5,'Set up in an afternoon','Rolled out to 40 seats without touching a firewall rule. The onboarding call was worth taking.','Cadence Health','23 Jul 2026','published',null],
    ['SKU-6001',4,'Solid, reporting is thin','Detection has been reliable. The monthly report is a PDF when it should be a dashboard.','Brightline Foods','19 Jul 2026','published',
     {by:'Sentinel Cyber', when:'20 Jul 2026', text:'Fair. A live dashboard is in the next release; we will let existing customers in first.'}],
    ['SKU-4001',5,'Exactly as described','Arrived next day, unlocked, battery health as stated.','Priya Raman','21 Jul 2026','published',null],
    ['SKU-4001',2,'Charger was missing','Handset itself is fine but the box had no charger and support took two days.','Arun Deshpande','18 Jul 2026','published',
     {by:'Kestrel Devices', when:'19 Jul 2026', text:'Sorry — a packing error on that batch. A charger has been sent and the batch has been re-checked.'}],
    ['SKU-3001',5,'Worth it for the 4K tier','Four screens, no buffering on a 50 GB plan.','Meera Nathan','22 Jul 2026','published',null],
    ['SKU-3001',3,'Good, but the price went up','Content is fine. The increase in June was not well communicated.','Lotte Bakker','16 Jul 2026','published',null],
    ['SKU-5001',4,'Does the job','Coverage is better than the router it replaced. Setup app is clunky.','Idris Haddad','20 Jul 2026','published',null],
    ['SKU-6004',5,'No complaints','Straightforward VPN, no drop-outs in three weeks.','Harbourpoint Retail','24 Jul 2026','pending',null],
    ['SKU-4001',1,'Call me on 98450 11288 and I will explain','Terrible, ring me.','Felix Weber','25 Jul 2026','pending',null],
    ['SKU-3001',5,'Better than StreamRival which is rubbish','Much better than the competitor.','Nadia Petrov','25 Jul 2026','pending',null]
  ];
  seeds.forEach((r,i)=>{
    REVIEWS.push({
      id:'REV-'+(3200+i), sku:r[0], stars:r[1], title:r[2], body:r[3],
      author:r[4], when:r[5], state:r[6], response:r[7],
      verified:true, orderRef:'ORD-'+(880500+i*17),
      helpful:[12,4,9,2,15,3,6,0,0,0][i],
      flagged:r[6]==='pending' && i>7,
      moderatedBy:r[6]==='published'?'Marek Zielinski':null,
      moderatedOn:r[6]==='published'?r[5]:null, rejectReason:null
    });
  });
})();
/* Aggregate from published reviews only. A pending review must not move a
   rating — that would make moderation pointless. */
/* Older reviews are not modelled individually — reproducing thousands of them
   would be filler. Each product therefore carries a historical count and the
   modelled reviews are blended into it, so the headline figure and the list a
   buyer can actually read never contradict each other. */
function recomputeRatings(){
  if(typeof PRODUCTS==='undefined') return;
  PRODUCTS.forEach(p=>{
    if(p.histReviews===undefined){
      p.histReviews = p.reviews || 0;
      p.histRating  = p.rating;
    }
    const pub=REVIEWS.filter(r=>r.sku===p.id && r.state==='published');
    const n = p.histReviews + pub.length;
    if(!n){ p.rating=null; p.reviews=0; return; }
    const histTotal = (p.histRating!=null ? p.histRating*p.histReviews : 0);
    const newTotal  = pub.reduce((a,r)=>a+r.stars,0);
    p.rating = +((histTotal+newTotal)/n).toFixed(1);
    p.reviews = n;
  });
}
recomputeRatings();

/* ===========================================================================
   MARKETPLACE DEVELOPER PORTAL  (APG · epics APG-BE-001, APG-FE-001)
   The reverse of §4.13. Those were the seller's endpoints that we call; these
   are the marketplace's own APIs that others call, with plans, quotas and
   metered billing behind them.
   =========================================================================== */
/* ---------------------------------------------------------------------------
   OUTBOUND: the APIs the marketplace extends to its partners.

   This is integration access, not a product line. A seller already has the
   right to read its own catalogue, take its own orders and pull its own
   settlement — the API is simply a second way to do what the console already
   lets it do. Nothing here is sold, metered for revenue, or upsold.

   Rate limits exist to protect the platform, not to create a paywall.
   ------------------------------------------------------------------------- */
const API_ENVS = [
  {id:'sandbox', label:'Sandbox', base:'https://sandbox.api.aventa.example',
   data:'Test records only, never live ones. Reset every Sunday 02:00 UTC.',
   commitment:'No availability commitment, and no notice before a reset.',
   gate:'Open to any onboarded partner from the technical gate onward.'},
  {id:'production', label:'Production', base:'https://api.aventa.example',
   data:'Live. Every call is against real records and is audited.',
   commitment:'99.5% monthly. Incidents are posted to the status page.',
   gate:'Granted when the technical gate is cleared and a sandbox order has completed end to end.'}
];

const API_PRODUCTS = [
  {id:'AP-CAT', name:'Catalogue', version:'v2', spec:'TMF620',
   blurb:'Read the marketplace catalogue and maintain your own listings — offerings, prices, media, availability.',
   scopes:['catalogue:read','catalogue:write'], methods:14, envs:['sandbox','production'], status:'ga',
   audience:'Sellers',
   why:'So a seller with a thousand SKUs does not maintain them twice.',
   note:'Availability is read live from the stock ledger. A cached copy will oversell.'},
  {id:'AP-ORD', name:'Orders', version:'v2', spec:'TMF622',
   blurb:'Retrieve the orders placed against your listings, acknowledge them, and report fulfilment progress.',
   scopes:['orders:read','orders:write'], methods:11, envs:['sandbox','production'], status:'ga',
   audience:'Sellers',
   why:'The core integration. Everything else is optional; this is not.',
   note:'Writes are idempotent on a key. A retried acknowledgement never creates a second one.'},
  {id:'AP-SUB', name:'Subscriptions', version:'v1', spec:'TMF637',
   blurb:'Read subscription state and post renewals, suspensions, resumptions and cancellations you have effected.',
   scopes:['subscriptions:read','subscriptions:write'], methods:9, envs:['sandbox','production'], status:'ga',
   audience:'Sellers',
   why:'A recurring service changes state in the seller\u2019s system first. This is how the marketplace hears about it.',
   note:'State transitions are validated. A renewal on a cancelled subscription is refused rather than absorbed.'},
  {id:'AP-INV', name:'Inventory', version:'v1', spec:'TMF685',
   blurb:'Post stock levels and reservations so the storefront stops promising what you cannot ship.',
   scopes:['inventory:read','inventory:write'], methods:6, envs:['sandbox','production'], status:'ga',
   audience:'Sellers',
   why:'The alternative is a nightly file and a day of overselling.',
   note:'A level below what is already reserved is refused, exactly as it is in the console.'},
  {id:'AP-SET', name:'Settlement', version:'v1', spec:'TMF678',
   blurb:'Pull your statements, payout records and deduction lines for reconciliation.',
   scopes:['settlement:read'], methods:5, envs:['sandbox','production'], status:'ga',
   audience:'Sellers',
   why:'Finance teams reconcile from a file, not from a screen.',
   note:null},
  {id:'AP-ADJ', name:'Adjustments and refunds', version:'v1', spec:'TMF666 / TMF678',
   blurb:'Read the credit and debit notes raised against you, dispute one, and decide the refund requests '+
         'raised by customers on your products.',
   scopes:['notes:read','notes:dispute','refunds:read','refunds:decide'], methods:9,
   envs:['sandbox','production'], status:'ga', audience:'Sellers',
   why:'A refund decision has a '+ '48-hour clock on it. A seller with any volume cannot make those in a '+
       'browser, and if they do not make them the marketplace makes them instead.',
   note:'Deciding a refund is idempotent on the request id. Retrying an approval never refunds twice. '+
        'A decline without a reason is rejected by the API exactly as it is by the console.'},
  /* Buyer-side integration. A procurement team does not browse a storefront;
     they raise a requisition in their own system and expect it to reach us. */
  {id:'AP-BCAT', name:'Buyer catalogue', version:'v1', spec:'TMF620',
   blurb:'Read the catalogue as your account sees it \u2014 your contracted prices, your entitlements, '+
         'and nothing you are not permitted to buy.',
   scopes:['catalogue:read'], methods:6, envs:['sandbox','production'], status:'ga',
   audience:'Enterprise buyers',
   why:'A procurement system that shows list price when the account has a negotiated one produces a '+
       'requisition that fails at approval, every time.',
   note:'Prices are resolved per account. Caching them across accounts will show one customer another '+
        'customer\u2019s rate.'},
  {id:'AP-BORD', name:'Buyer ordering', version:'v1', spec:'TMF622',
   blurb:'Raise a requisition, track it through approval, and read fulfilment status back into your ERP.',
   scopes:['orders:read','orders:create'], methods:8, envs:['sandbox','production'], status:'ga',
   audience:'Enterprise buyers',
   why:'The order originates in the buyer\u2019s system. Re-keying it into ours is where the quantity '+
       'goes wrong.',
   note:'An order raised here is subject to your own approval policy exactly as one raised in the portal is. '+
        'The API is not a way around the threshold, and an attempt to use it as one is refused and recorded.'},
  {id:'AP-BFIN', name:'Invoices and statements', version:'v1', spec:'TMF666 / TMF678',
   blurb:'Pull invoices, credit notes and remittance detail straight into accounts payable.',
   scopes:['billing:read'], methods:5, envs:['sandbox','production'], status:'ga',
   audience:'Enterprise buyers',
   why:'AP reconciles from a file. A PDF in an inbox is a person retyping numbers.',
   note:'Line detail follows the same cost-centre breakdown you set on the billing screen.'},
  {id:'AP-PTY', name:'Party', version:'v1', spec:'TMF632',
   blurb:'Maintain the organisation and contact records you are authorised to see.',
   scopes:['party:read','party:write'], methods:7, envs:['sandbox','production'], status:'beta',
   audience:'Sellers and enterprise buyers',
   why:'Keeps contact details current without a support ticket.',
   note:'Beta — the address model is expected to change once DPDP guidance lands.'},
  {id:'AP-EVT', name:'Event subscriptions', version:'v1', spec:'TMF688 / AsyncAPI',
   blurb:'Subscribe to marketplace events rather than polling for them.',
   scopes:['events:subscribe'], methods:4, envs:['sandbox','production'], status:'preview',
   audience:'Sellers',
   why:'Polling for order changes wastes both sides\u2019 capacity.',
   note:'Preview. Delivery is at-least-once, so handlers must be idempotent.'}
];
const APIPMAP={}; API_PRODUCTS.forEach(a=>APIPMAP[a.id]=a);
/* Access tiers. Not price bands — entitlements. Which tier a partner holds
   follows from where it is in onboarding and what it sells, and it changes
   when that changes. Rate and quota are protection limits: a runaway
   integration should degrade its own throughput, not the marketplace. */
const API_TIERS = [
  {id:'TR-SBX', name:'Sandbox only', env:'sandbox',
   rate:'10 req/s', quota:'50,000 calls a month',
   scopes:['catalogue:read','orders:read','subscriptions:read','inventory:write'],
   who:'Any partner from the technical gate onward.',
   commitment:'None. The sandbox may be reset without notice.',
   products:['AP-CAT','AP-ORD','AP-SUB','AP-INV','AP-PTY']},
  {id:'TR-SELL', name:'Live seller', env:'production',
   rate:'50 req/s', quota:'1,000,000 calls a month',
   scopes:['catalogue:read','catalogue:write','orders:read','orders:write',
           'subscriptions:read','subscriptions:write','inventory:read','inventory:write','settlement:read'],
   who:'Granted on go-live. It is the seller’s own data, so it carries no charge and no meter against revenue.',
   commitment:'99.5% monthly.',
   products:['AP-CAT','AP-ORD','AP-SUB','AP-INV','AP-SET','AP-PTY']},
  {id:'TR-HIVOL', name:'High volume', env:'production',
   rate:'200 req/s', quota:'10,000,000 calls a month',
   scopes:['catalogue:read','catalogue:write','orders:read','orders:write','subscriptions:read',
           'subscriptions:write','inventory:read','inventory:write','settlement:read','events:subscribe'],
   who:'Sellers above roughly 50,000 orders a month, on request. The limit moves; the entitlement does not.',
   commitment:'99.5% monthly, with a named contact.',
   products:['AP-CAT','AP-ORD','AP-SUB','AP-INV','AP-SET','AP-PTY','AP-EVT']},
  {id:'TR-BUY', name:'Enterprise buyer', env:'production',
   rate:'50 req/s', quota:'1,000,000 calls a month',
   scopes:['catalogue:read','orders:read','orders:write','party:read','party:write'],
   who:'Buyers integrating their own procurement system.',
   commitment:'99.5% monthly.',
   products:['AP-CAT','AP-ORD','AP-PTY']}
];
const API_PLANS = API_TIERS;   /* older references */
const APLMAP={}; API_TIERS.forEach(p=>APLMAP[p.id]=p);
const API_CONSUMERS = [
  {id:'AC-01', name:'Sentinel Cyber', kind:'Seller', plan:'PL-PRT', apps:2,
   calls30d:412300, quota:1000000, errors:0.4, p95:212, since:'12 Sep 2024', status:'active'},
  {id:'AC-02', name:'Brightline Foods', kind:'Enterprise buyer', plan:'PL-ENT', apps:1,
   calls30d:2840000, quota:10000000, errors:0.1, p95:180, since:'04 Feb 2025', status:'active'},
  {id:'AC-03', name:'Northbridge Systems', kind:'Integrator', plan:'PL-STD', apps:3,
   calls30d:1240000, quota:1000000, errors:1.9, p95:640, since:'19 Nov 2025', status:'active',
   note:'Over quota this period and running the highest error rate on the platform.'},
  {id:'AC-04', name:'Kestrel Devices', kind:'Seller', plan:'PL-PRT', apps:1,
   calls30d:88400, quota:1000000, errors:0.2, p95:198, since:'02 Mar 2024', status:'active'},
  {id:'AC-05', name:'Loom Analytics', kind:'Integrator', plan:'PL-SBX', apps:1,
   calls30d:6100, quota:50000, errors:0.0, p95:224, since:'21 Jul 2026', status:'trial'}
];

/* ===========================================================================
   CATALOGUE — VERSIONING AND CONTRACT PRICING  (CAT-BE-001-11, -12)
   =========================================================================== */
const LISTING_VERSIONS = {};
(function seedVersions(){
  /* Every partner listing carries a history, so whichever seller is loaded in
     the demo has one. A listing nobody has changed still has version 1. */
  const picks=PRODUCTS.filter(p=>p.partner);
  picks.forEach((p,i)=>{
    LISTING_VERSIONS[p.id]=[
      {v:1, when:p.listed, by:p.seller, change:'First published',
       fields:{price:+(p.price*1.08).toFixed(2), desc:p.desc, status:'live'}, active:false},
      {v:2, when:'12 Jun 2026', by:p.seller, change:'Price reduced and description rewritten',
       fields:{price:+(p.price*1.03).toFixed(2), desc:p.desc, status:'live'}, active:false},
      {v:3, when:'08 Jul 2026', by:p.seller, change:'Current',
       fields:{price:p.price, desc:p.desc, status:p.status}, active:true}
    ].slice(0, 2+(i%2));
    LISTING_VERSIONS[p.id][LISTING_VERSIONS[p.id].length-1].active=true;
  });
})();
/* Contract prices beat list price for a named account. */
const CONTRACT_PRICES = [
  {id:'CP-01', sku:'SKU-6001', account:'Brightline Foods', accountId:'ACC-BLF',
   price:284.00, from:'01 Apr 2026', to:'31 Mar 2027', minQty:25, agreed:'Rohan Iyer',
   note:'Negotiated at renewal against a 25-seat commitment.'},
  {id:'CP-02', sku:'SKU-6001', account:'Cadence Health', accountId:'ACC-CDH',
   price:298.00, from:'01 Jun 2026', to:'31 May 2027', minQty:15, agreed:'Procurement',
   note:null},
  {id:'CP-03', sku:'SKU-1001', account:'Brightline Foods', accountId:'ACC-BLF',
   price:18.50, from:'01 Jan 2026', to:'31 Dec 2026', minQty:200, agreed:'Deepa Menon',
   note:'Fleet tariff across 240 lines.'},
  {id:'CP-04', sku:'SKU-5001', account:'Harbourpoint Retail', accountId:'ACC-HBP',
   price:0, from:'01 Aug 2026', to:'31 Jul 2027', minQty:50, agreed:'Pending signature',
   note:'Price not agreed — the record exists so the discount does not get applied early.'}
];

/* ===========================================================================
   WMS  (INV — the warehouse behind the ledger)
   =========================================================================== */
const WMS_LINKS = [
  {id:'WMS-RET', warehouse:'WH-RET', system:'Manhattan Active', mode:'API',
   endpoint:'https://wms-ret.aventa.example/v2', lastSync:'25 Jul 2026 08:55',
   drift:6, status:'drift', carriers:['Bluedart'], cutoff:'14:00 IST',
   note:'Returns drift more than forward stock because a unit is counted when it is booked in and again '+
        'when it is graded. The physical grade is the one that decides whether it can be sold again.'},
  {id:'WMS-BLR', warehouse:'WH-BLR', system:'Manhattan Active', mode:'API',
   endpoint:'https://wms-blr.aventa.example/v2', lastSync:'25 Jul 2026 09:40',
   drift:0, status:'healthy', carriers:['Bluedart','Delhivery'], cutoff:'16:00 IST'},
  {id:'WMS-DXB', warehouse:'WH-DXB', system:'Blue Yonder', mode:'API',
   endpoint:'https://wms-dxb.aventa.example/v1', lastSync:'25 Jul 2026 09:12',
   drift:3, status:'drift', carriers:['Aramex','DHL'], cutoff:'15:00 GST',
   note:'Three lines disagree with our ledger. Physical count wins; a reconciliation is queued.'},
  {id:'WMS-SIN', warehouse:'WH-SIN', system:'Manhattan Active', mode:'API',
   endpoint:'https://wms-sin.aventa.example/v2', lastSync:'25 Jul 2026 08:55',
   drift:0, status:'healthy', carriers:['SingPost','DHL'], cutoff:'17:00 SGT'},
  {id:'WMS-DRP', warehouse:'WH-DRP', system:'Seller drop-ship', mode:'Seller webhook',
   endpoint:'Per-seller fulfilment endpoint', lastSync:'Continuous',
   drift:null, status:'delegated', carriers:['Seller controlled'], cutoff:'Seller controlled',
   note:'No warehouse of ours. Stock accuracy is the seller\'s and is only as good as their feed.'}
];
/* A shipment says what is moving, under which purchase order, from whom and
   to whom. A record without a consignor and a consignee cannot be chased, and
   the person chasing it is usually not the person who booked it. */
const SHIPMENTS = [
  {id:'SHP-4411', order:'ORD-882431', po:'PO-BLF-20419', wms:'WMS-BLR', warehouse:'WH-BLR',
   carrier:'Bluedart', tracking:'BD881204471', label:'Generated 25 Jul 09:44',
   state:'in transit', eta:'27 Jul 2026', units:24, weight:'18.4 kg',
   fromName:'Bengaluru DC', fromLines:['Plot 42, KIADB Industrial Area','Bommasandra, Bengaluru 560099'],
   seller:'Nimbus Sensors', sellerId:'PTR-1004',
   toName:'Brightline Foods — Pune plant', toContact:'Deepa Menon',
   toLines:['Gate 3, MIDC Chakan Phase II','Pune 410501, Maharashtra'], toPhone:'+91 20 6721 4400',
   incoterm:'DAP', service:'Surface, 2 days'},
  {id:'SHP-4409', order:'ORD-882388', po:'PO-CDH-7741', wms:'WMS-BLR', warehouse:'WH-BLR',
   carrier:'Delhivery', tracking:'DL771029934', label:'Generated 24 Jul 15:02',
   state:'delivered', eta:'25 Jul 2026', units:1, weight:'0.4 kg',
   fromName:'Bengaluru DC', fromLines:['Plot 42, KIADB Industrial Area','Bommasandra, Bengaluru 560099'],
   seller:'Kestrel Devices', sellerId:'PTR-1002',
   toName:'Cadence Health', toContact:'Arun Pillai',
   toLines:['4th floor, Prestige Tech Park','Bengaluru 560103'], toPhone:'+91 80 4455 1200',
   incoterm:'DAP', service:'Express, next day', pod:'Signed by A Pillai, 25 Jul 11:14'},
  {id:'SHP-4402', order:'ORD-882201', po:'PO-HPR-3318', wms:'WMS-DXB', warehouse:'WH-DXB',
   carrier:'Aramex', tracking:'AR40012288', label:'Generated 23 Jul 11:20',
   state:'exception', eta:'—', units:2, weight:'1.1 kg',
   fromName:'Dubai hub', fromLines:['Warehouse 14, Jebel Ali Free Zone','Dubai'],
   seller:'Kestrel Devices', sellerId:'PTR-1002',
   toName:'Harbourpoint Retail', toContact:'Yusuf Rahman',
   toLines:['Shop 22, Al Wahda Mall','Abu Dhabi'], toPhone:'+971 2 445 9900',
   incoterm:'DDP', service:'Express',
   note:'Held at customs — commercial invoice value queried. Buyer has been told.'},
  {id:'SHP-4398', order:'ORD-882140', po:'PO-NWL-9902', wms:'WMS-SIN', warehouse:'WH-SIN',
   carrier:'DHL', tracking:'DH556120043', label:'Generated 22 Jul 08:30',
   state:'delivered', eta:'24 Jul 2026', units:8, weight:'6.2 kg',
   fromName:'Singapore hub', fromLines:['3 Changi South Street 2','Singapore 486548'],
   seller:'Nimbus Sensors', sellerId:'PTR-1004',
   toName:'Northwind Logistics — Johor', toContact:'Siti Aminah',
   toLines:['Lot 18, Taman Perindustrian','Johor Bahru 81100, Malaysia'], toPhone:'+60 7 559 2100',
   incoterm:'DAP', service:'Surface', pod:'Signed by S Aminah, 24 Jul 09:40'}
];

/* ===========================================================================
   AUDIT INTEGRITY  (ADM — hash chain and SIEM export)
   =========================================================================== */
const AUDIT_SEAL = {
  algorithm:'SHA-256 over the canonical entry plus the previous hash',
  anchoring:'Daily root written to append-only object storage with object lock',
  lastSealed:'25 Jul 2026 00:05', lastRoot:'a91f4c2e7b08d5136ff2c9a4e77b1d0c93af5628',
  entriesSealed:14820, verified:true, lastVerified:'25 Jul 2026 06:00',
  gaps:0, note:null
};
const SIEM_TARGETS = [
  {id:'SI-01', name:'Splunk Cloud', kind:'HTTP Event Collector', dest:'https://http-inputs.aventa.splunkcloud.example',
   filter:'All categories', lastDelivery:'25 Jul 2026 09:58', backlog:0, status:'healthy',
   note:'Outside the control of the people it audits, which is the point.'},
  {id:'SI-02', name:'Regulator archive', kind:'SFTP, daily batch', dest:'sftp://archive.regulator.example/aventa',
   filter:'Settlement and Access only', lastDelivery:'25 Jul 2026 00:30', backlog:0, status:'healthy',
   note:'Retained seven years under the operator licence.'},
  {id:'SI-03', name:'Security data lake', kind:'Kinesis', dest:'aventa-sec-audit',
   filter:'Security and Governance', lastDelivery:'24 Jul 2026 22:14', backlog:1840, status:'lagging',
   note:'Backlog since a credential rotation on the 24th. Nothing lost — the stream replays.'}
];

/* ===========================================================================
   DUNNING  (ORD — the collections path)
   =========================================================================== */
const DUNNING_CASES = [
  {id:'DUN-201', ctx:'consumer', account:'Priya Raman', accountId:'ACC-PR', amount:41.98,
   invoice:'INV-C-88213', failed:'22 Jul 2026', reason:'Card expired', step:3, nextAt:'26 Jul 2026',
   attempts:2, method:'Card ending 4417', state:'in dunning', promiseToPay:null,
   sellerId:'PTR-1004', sellerName:'Nimbus Sensors', bundleId:null, bundleName:null,
   vertical:'consumer', productCat:'Mobile plans',
   note:'Card expiry is the most common cause and the easiest to fix — the notice says exactly that.'},
  {id:'DUN-202', ctx:'buyer', account:'Brightline Foods', accountId:'ACC-BLF', amount:14520.00,
   invoice:'INV-2026-0613', failed:'16 Jul 2026', reason:'Invoice overdue, net 30 passed',
   step:5, nextAt:'30 Jul 2026', attempts:0, method:'Invoice, net 30', state:'restricted',
   promiseToPay:'31 Jul 2026',
   sellerId:'PTR-1004', sellerName:'Nimbus Sensors', bundleId:'BND-IOT-STARTER',
   bundleName:'IoT starter bundle', vertical:'iot', productCat:'IoT SIM plans',
   note:'Promise to pay recorded by finance. The ladder is paused until that date, then resumes where it stopped.'},
  {id:'DUN-203', ctx:'consumer', account:'Arun Deshpande', accountId:'ACC-AD', amount:12.99,
   invoice:'INV-C-88190', failed:'09 Jul 2026', reason:'Insufficient funds', step:6, nextAt:'08 Aug 2026',
   attempts:4, method:'Card ending 2201', state:'suspended', promiseToPay:null,
   sellerId:'PTR-1004', sellerName:'Nimbus Sensors', bundleId:null, bundleName:null,
   vertical:'content', productCat:'Streaming', note:null},
  {id:'DUN-204', ctx:'buyer', account:'Harbourpoint Retail', accountId:'ACC-HBP', amount:2380.00,
   invoice:'INV-2026-0588', failed:'24 Jul 2026', reason:'Direct debit returned', step:2,
   nextAt:'27 Jul 2026', attempts:1, method:'Direct debit', state:'in dunning', promiseToPay:null,
   sellerId:'PTR-1001', sellerName:'Kestrel Devices', bundleId:'BND-FLEET-PRO',
   bundleName:'Fleet tracking pro', vertical:'iot', productCat:'Trackers', note:null}
];

/* ===========================================================================
   REVENUE PROJECTION
   A forecast is a claim about the future and should carry its method and its
   error. Each persona gets the projection that is actually theirs, built from
   its own trailing series, with the assumptions stated and last quarter's
   accuracy shown so the reader can judge how much to trust it.
   =========================================================================== */
const FORECAST_METHOD = {
  basis:'Trailing 12-month series, seasonally naive with a linear trend',
  horizon:6,
  bandPct:18,
  note:'The band is one standard deviation of the last six months of forecast error, not a confidence interval.',
  lastQuarter:{forecast:0, actual:0, errPct:0}
};
const SEASONALITY = [
  {m:'Aug', f:0.97},{m:'Sep', f:1.02},{m:'Oct', f:1.09},{m:'Nov', f:1.14},
  {m:'Dec', f:1.21},{m:'Jan', f:0.92}
];

/* ==========================================================================
   M20 — AUTHENTICATION (IAM), NUMBER MANAGEMENT (INV), CHANNEL DELIVERY (NTF)
   ========================================================================== */

/* ---------------------------------------------------------------- AUTH ---
   Everything here is in memory. There is no server, so a "password check"
   compares a string. What is real is the *behaviour* around it: lockout,
   step-up, session lifecycle, SSO precedence and the audit consequences. */
const AUTH_POLICY = {
  lockoutAfter:5,
  lockoutMins:15,
  sessionIdleMins:30,
  sessionMaxHours:12,
  mfaRequiredFor:['OR-ADMIN','OR-FIN','PR-OWNER','PR-FIN','BY-ADMIN','BY-FIN'],
  reauthFor:['Approve a settlement run','Change a payout bank account','Grant or revoke a role',
             'Export data containing personal information','Rotate an API key'],
  passwordless:true,
  note:'A lockout counts failures per account, not per IP. Counting per IP protects the '+
       'attacker with a botnet and punishes the office behind one address.'
};

/* SSO. Where an identity provider is enforced for a domain, local passwords
   stop working for that domain — otherwise SSO is a suggestion, not a control. */
const IDP_CONFIG = {
  operator:{enabled:true,  protocol:'SAML 2.0', idp:'Microsoft Entra ID', domain:'aventa.example',
            enforced:false, jit:true,  groupMap:true,  lastMeta:'12 Jul 2026', certExpires:'04 Mar 2027',
            note:'Not yet enforced. Until it is, the local password remains a way in, and it is the weakest one.'},
  partner: {enabled:true,  protocol:'OIDC',     idp:'Okta',               domain:'nimbus-sensors.example',
            enforced:false, jit:true,  groupMap:false, lastMeta:'28 Jun 2026', certExpires:'19 Jan 2027'},
  buyer:   {enabled:true,  protocol:'SAML 2.0', idp:'Ping Identity',      domain:'brightlinefoods.example',
            enforced:true,  jit:false, groupMap:true,  lastMeta:'03 Jul 2026', certExpires:'22 Nov 2026'},
  consumer:{enabled:false, protocol:'—',        idp:'—',                  domain:'—',
            enforced:false, jit:false, groupMap:false, lastMeta:'—', certExpires:'—',
            note:'Retail accounts authenticate locally or by passkey. There is no enterprise IdP behind a consumer.'}
};

const MFA_METHODS = [
  {id:'passkey', label:'Passkey',            detail:'Device-bound, phishing-resistant', strength:'strongest', phishResistant:true},
  {id:'totp',    label:'Authenticator app',  detail:'Six-digit code, 30-second window', strength:'strong',    phishResistant:false},
  {id:'sms',     label:'SMS code',           detail:'Six-digit code by text',           strength:'weakest',   phishResistant:false,
   warn:'SIM-swap and interception make this the weakest option. It is offered because some users have nothing else, not because it is good.'}
];

/* Sign-in credentials for the accounts modelled here. The password field on
   the sign-in card carries the value as its placeholder, so nothing needs to
   be printed on screen. */
const DEMO_CREDS = {
  operator:{user:'a.krishnan@6dtech.co.in',            pass:'demo',  mfa:'totp',    code:'314159'},
  partner: {user:'k.boehm@gmail.com',       pass:'demo',  mfa:'passkey', code:'—'},
  /* SSO is enforced on this domain, so there is no local password to print.
     Showing one would contradict the control the buyer's own IT team set. */
  buyer:   {user:'m.nathan@6dtech.co.in',     pass:null,    mfa:'sso',     code:'—', ssoOnly:true},
  consumer:{user:'ananya.k@gmail.com',                 pass:'demo',  mfa:'none',    code:'—'}
};

const SESSIONS = {
  operator:[
    {id:'SES-O-01', device:'Chrome 128 · Windows 11', ip:'103.21.44.18',  loc:'Bengaluru, IN',
     started:'Today 08:12', last:'Now',        mfa:'Authenticator app', current:true},
    {id:'SES-O-02', device:'Safari · iPhone 15',      ip:'103.21.44.190', loc:'Bengaluru, IN',
     started:'Yesterday 19:40', last:'2 h ago', mfa:'Passkey', current:false},
    {id:'SES-O-03', device:'Firefox 130 · macOS',     ip:'88.202.14.6',   loc:'Frankfurt, DE',
     started:'22 Jul 09:05', last:'3 d ago',   mfa:'Authenticator app', current:false,
     flag:'Signed in from a country you do not normally use.'}
  ],
  partner:[
    {id:'SES-P-01', device:'Chrome 128 · macOS',      ip:'93.184.61.22',  loc:'Munich, DE',
     started:'Today 07:55', last:'Now', mfa:'Passkey', current:true},
    {id:'SES-P-02', device:'Edge 128 · Windows 11',   ip:'93.184.61.40',  loc:'Munich, DE',
     started:'24 Jul 08:30', last:'Yesterday', mfa:'Passkey', current:false}
  ],
  buyer:[
    {id:'SES-B-01', device:'Chrome 128 · Windows 11', ip:'196.20.11.7',   loc:'Dublin, IE',
     started:'Today 08:40', last:'Now', mfa:'Authenticator app', current:true}
  ],
  consumer:[
    {id:'SES-C-01', device:'Safari · iPhone 15',      ip:'49.207.8.144',  loc:'Bengaluru, IN',
     started:'Today 07:20', last:'Now', mfa:'None', current:true},
    {id:'SES-C-02', device:'Chrome · Android 15',     ip:'49.207.9.2',    loc:'Bengaluru, IN',
     started:'19 Jul 21:10', last:'6 d ago', mfa:'None', current:false}
  ]
};

/* Sign-in history. Failures are kept as carefully as successes — a log that
   only records what worked cannot show you an attack. */
const LOGIN_EVENTS = {
  operator:[
    {when:'Today 08:12',    who:'a.krishnan@6dtech.co.in', ip:'103.21.44.18', result:'success', method:'Password + authenticator'},
    {when:'Today 08:11',    who:'a.krishnan@6dtech.co.in', ip:'103.21.44.18', result:'mfa-failed', method:'Authenticator code rejected'},
    {when:'Yesterday 22:04',who:'n.barak@6dtech.co.in',    ip:'45.9.148.203', result:'blocked', method:'Account suspended',
     note:'Six attempts in four minutes from an address never seen on this account.'},
    {when:'Yesterday 19:40',who:'a.krishnan@6dtech.co.in', ip:'103.21.44.190',result:'success', method:'Passkey'},
    {when:'24 Jul 11:02',   who:'t.novak@gmail.com',    ip:'88.202.14.6',  result:'success', method:'SSO — Microsoft Entra ID'}
  ],
  partner:[
    {when:'Today 07:55',    who:'k.boehm@gmail.com', ip:'93.184.61.22', result:'success', method:'Passkey'},
    {when:'24 Jul 08:30',   who:'k.boehm@gmail.com', ip:'93.184.61.40', result:'success', method:'Password + passkey'},
    {when:'23 Jul 16:19',   who:'f.meyer@gmail.com', ip:'93.184.61.40', result:'locked',  method:'Five failed passwords',
     note:'Unlocked by the seller admin after a call.'}
  ],
  buyer:[
    {when:'Today 08:40',    who:'m.nathan@6dtech.co.in', ip:'196.20.11.7', result:'success', method:'SSO — Ping Identity'},
    {when:'Yesterday 08:36',who:'m.nathan@6dtech.co.in', ip:'196.20.11.7', result:'success', method:'SSO — Ping Identity'},
    {when:'23 Jul 14:22',   who:'j.okonjo@gmail.com', ip:'41.203.7.88', result:'denied',  method:'Local password refused',
     note:'SSO is enforced for this domain, so the local password path is closed.'}
  ],
  consumer:[
    {when:'Today 07:20',    who:'ananya.k@gmail.com', ip:'49.207.8.144', result:'success', method:'Password'},
    {when:'19 Jul 21:10',   who:'ananya.k@gmail.com', ip:'49.207.9.2',   result:'success', method:'Password'}
  ]
};

/* Runtime auth state. Set by the login gate, read by the shell. */
const AUTH = {signedIn:false, ctx:null, user:null, failures:0, lockedUntil:null, method:null, step:'creds'};

/* ------------------------------------------- NUMBER MANAGEMENT (BSS) ---
   ICCID, IMSI and MSISDN are NOT owned here. They live in the operator's
   Number Management / Logical Inventory system. The marketplace holds a
   reservation and an assignment reference against an order; the NMS holds
   the resource and its true state. Same seam as the WMS in §4.24: where the
   two disagree, the system of record wins and we adjust.
   Aligned to TMF639 Resource Inventory and TMF652 Resource Order. */
const NUMBER_SYSTEMS = [
  {id:'NMS-CORE', name:'Aventa Number Management', vendor:'BSS Logical Inventory', kind:'MSISDN + IMSI',
   api:'TMF639 / TMF652', mode:'real-time', status:'connected', lastSync:'4 min ago', latencyMs:212, authoritative:true},
  {id:'NMS-SIM',  name:'SIM & eUICC Registry',     vendor:'SM-DP+ / SM-SR',        kind:'ICCID + EID',
   api:'GSMA SGP.22 ES2+', mode:'real-time', status:'connected', lastSync:'9 min ago', latencyMs:486, authoritative:true},
  {id:'NMS-MVNO', name:'Partner MVNO range pool',  vendor:'Wholesale partner',     kind:'MSISDN range',
   api:'SFTP batch file',  mode:'batch',     status:'degraded',  lastSync:'19 h ago', latencyMs:null, authoritative:true,
   note:'Batch file did not arrive this morning. Reservations against this pool are being held, not confirmed.'}
];

/* Ranges reserved from the NMS. We hold the reservation; the NMS holds the numbers. */
const NUM_RANGES = [
  {id:'RNG-01', system:'NMS-CORE', kind:'MSISDN', from:'+91 88000 10000', to:'+91 88000 19999',
   size:10000, reserved:2400, assigned:1876, expires:'30 Sep 2026', purpose:'IoT connectivity'},
  {id:'RNG-02', system:'NMS-CORE', kind:'MSISDN', from:'+91 88000 40000', to:'+91 88000 44999',
   size:5000,  reserved:1200, assigned:308,  expires:'31 Dec 2026', purpose:'Consumer eSIM'},
  {id:'RNG-03', system:'NMS-MVNO', kind:'MSISDN', from:'+49 176 5510000', to:'+49 176 5512999',
   size:3000,  reserved:900,  assigned:612,  expires:'31 Aug 2026', purpose:'Partner MVNO — Nimbus'},
  {id:'RNG-04', system:'NMS-SIM',  kind:'IMSI',   from:'404861000100000', to:'404861000149999',
   size:50000, reserved:12000,assigned:2810, expires:'—',           purpose:'Pooled across all SIM products'}
];

/* SGP.22 profile lifecycle for an eSIM. The marketplace observes it; the
   SM-DP+ owns it. Ordering matters — a profile cannot be enabled before it
   is installed, and we must not render a state the standard does not have. */
const ESIM_STATES = [
  {s:'released',   label:'Released',   detail:'Profile created at the SM-DP+ and matched to an EID', final:false},
  {s:'downloaded', label:'Downloaded', detail:'Profile pulled onto the device eUICC',                final:false},
  {s:'installed',  label:'Installed',  detail:'Profile present on the eUICC but not active',         final:false},
  {s:'enabled',    label:'Enabled',    detail:'Profile is the active subscription on the device',    final:false},
  {s:'disabled',   label:'Disabled',   detail:'Installed and inactive; can be re-enabled',           final:false},
  {s:'deleted',    label:'Deleted',    detail:'Removed from the eUICC. Not recoverable.',            final:true}
];

const ICCID_STATES = ['available','reserved','assigned','activated','suspended','retired'];

/* A working sample, not the whole inventory. 12,000 ICCIDs do not belong in a
   browser, and a screen that pretends to hold them all is a lie about where
   the data lives. This is what a search against the NMS returns. */
const ICCIDS = [];
(function seedIccids(){
  const r = mulberry32(778899);
  /* Bind to real orders that actually carry a SIM: IoT connectivity and consumer
     eSIM. The demo seller's own orders come first so its screen is not empty —
     an empty screen in a demo reads as a missing feature, not as no data. */
  const mine   = ORDERS.filter(o=>o.partnerId==='PTR-1004' && o.v==='iot');
  const others = ORDERS.filter(o=>(o.v==='iot'||/eSIM|SIM/i.test(o.name||'')) && o.partnerId!=='PTR-1004');
  const orders = mine.slice(0,6).concat(others.slice(0,18));
  const mk = (i)=>{
    const esim = i%2===0;
    const iccid = '8991' + String(4010000000 + i*7919).padStart(15,'0').slice(0,15);
    const imsi  = '4048610001' + String(10000+i).slice(-5);
    const st = i<6 ? 'available' : i<10 ? 'reserved' : i<20 ? 'activated' : i<23 ? 'assigned' : i<25 ? 'suspended' : 'retired';
    const ord = (st==='assigned'||st==='activated') ? (orders[(i-10)%Math.max(orders.length,1)]||orders[0]||null) : null;
    return {
      iccid, imsi,
      msisdn: (st==='available') ? null : '+91 88000 ' + String(10000 + i*13).slice(0,5),
      type: esim?'eSIM':'Physical',
      eid: esim ? '89049032' + String(1000000000000000 + i*104729).slice(0,24) : null,
      profile: esim ? (st==='activated'?'enabled': st==='assigned'?'installed': st==='reserved'?'released':null) : null,
      state: st,
      batch: ['BAT-2026-04','BAT-2026-06','BAT-2026-07'][i%3],
      range: esim ? 'RNG-02' : 'RNG-01',
      order: ord ? ord.id : null,
      account: ord ? (ord.buyer||ord.customer||null) : null,
      system: esim ? 'NMS-SIM' : 'NMS-CORE',
      updated: ['4 min ago','1 h ago','Today 09:12','Yesterday','23 Jul','21 Jul'][i%6],
      sync: (i===7||i===18) ? 'drift' : 'in-sync'
    };
  };
  for(let i=0;i<26;i++) ICCIDS.push(mk(i));
  /* Two deliberate disagreements with the NMS, so reconciliation has something
     to find. The NMS is right; we are stale. */
  ICCIDS[7].nmsState  = 'assigned';
  ICCIDS[7].driftNote = 'NMS shows this assigned to an order we have not received.';
  ICCIDS[18].nmsState = 'suspended';
  ICCIDS[18].driftNote= 'Suspended in the NMS for non-payment; still shown active here.';
  void r;
})();

const NUM_RECON = {
  lastRun:'Today 06:00', scope:'ICCID, IMSI and MSISDN across three systems',
  checked:12000, drift:2, corrected:0,
  rule:'The Number Management system is the record of truth for ICCID, IMSI and MSISDN. '+
       'Where the marketplace disagrees, the marketplace is corrected — never the other way round.'
};

/* ------------------------------------------------ CHANNEL DELIVERY ---
   Templates and rules already exist (§4.14). This is the transport: who
   carries the message, what came back, and what happens when it does not. */
const CHANNEL_PROVIDERS = [
  {id:'CP-SMS-1',  chan:'SMS',      name:'Route Mobile',        proto:'SMPP 3.4',        sender:'AVENTA',
   role:'primary',  tps:120, cost:0.0062, cur:'USD', status:'healthy',  success:98.4, dlr:true,  region:'IN, AE, KE'},
  {id:'CP-SMS-2',  chan:'SMS',      name:'Sinch',               proto:'REST v1',         sender:'AVENTA',
   role:'failover', tps:80,  cost:0.0074, cur:'USD', status:'healthy',  success:98.9, dlr:true,  region:'Global'},
  {id:'CP-EM-1',   chan:'Email',    name:'Amazon SES',          proto:'SMTP + API',      sender:'no-reply@gmail.com',
   role:'primary',  tps:200, cost:0.0001, cur:'USD', status:'healthy',  success:99.2, dlr:true,  region:'Global',
   spf:true, dkim:true, dmarc:'quarantine'},
  {id:'CP-WA-1',   chan:'WhatsApp', name:'Meta Cloud API',      proto:'Graph v20',       sender:'+91 80000 60000',
   role:'primary',  tps:40,  cost:0.0088, cur:'USD', status:'degraded', success:94.1, dlr:true,  region:'IN, ID, BR',
   note:'Template approval queue is running long, so new templates cannot be used yet.'},
  {id:'CP-PUSH-1', chan:'Push',     name:'Firebase / APNs',     proto:'FCM HTTP v1',     sender:'Aventa app',
   role:'primary',  tps:500, cost:0,      cur:'USD', status:'healthy',  success:91.7, dlr:false, region:'Global',
   note:'No true delivery receipt — the platform confirms acceptance, not that the phone showed it.'},
  {id:'CP-INAPP',  chan:'In-app',   name:'Platform',            proto:'Internal',        sender:'—',
   role:'primary',  tps:1000,cost:0,      cur:'USD', status:'healthy',  success:100,  dlr:true,  region:'—'}
];

/* DLR states. Named as the transports name them, because renaming them
   loses the ability to reconcile with a carrier's own report. */
const DLR_STATES = [
  {s:'queued',    label:'Queued',        final:false, detail:'Accepted by us, not yet handed to the provider'},
  {s:'submitted', label:'Submitted',     final:false, detail:'Handed to the provider, no receipt yet'},
  {s:'sent',      label:'Sent',          final:false, detail:'Provider passed it to the carrier'},
  {s:'delivered', label:'Delivered',     final:true,  detail:'Carrier confirmed handset receipt'},
  {s:'read',      label:'Read',          final:true,  detail:'Recipient opened it. WhatsApp and Email only.'},
  {s:'failed',    label:'Failed',        final:true,  detail:'Rejected or undeliverable. Carries a reason code.'},
  {s:'expired',   label:'Expired',       final:true,  detail:'Validity period elapsed before the handset was reachable'},
  {s:'unknown',   label:'No receipt',    final:true,  detail:'Provider supports no receipt for this channel'}
];

const RETRY_POLICY = {
  attempts:3, backoff:[60, 300, 1800], unit:'seconds',
  failoverAfter:2,
  neverRetry:['invalid-number','unsubscribed','blocked','template-rejected'],
  note:'A hard rejection is never retried. Retrying an invalid number three times '+
       'produces three charges and no message.'
};

const DLR_CODES = {
  'invalid-number':'Number not in a valid format or not allocated',
  'unsubscribed':'Recipient opted out of this category',
  'blocked':'Carrier blocked the sender or the content',
  'template-rejected':'Template not approved by the channel',
  'handset-off':'Handset unreachable within the validity period',
  'quota':'Provider throughput limit reached',
  'mailbox-full':'Recipient mailbox rejected the message'
};

/* Individual sends. This is the record a support agent opens when a customer
   says "I never got the message". */
const DELIVERIES = [];
(function seedDeliveries(){
  const rows = [
    ['operator','NR-O1','Email',   'reviewers@gmail.com',  'delivered',1,null,'Today 09:41'],
    ['operator','NR-O3','SMS',     '+91 98450 22118',           'delivered',1,null,'Today 08:12'],
    ['operator','NR-O2','Email',   'onboarding@6dtech.co.in', 'failed',   3,'mailbox-full','Today 07:55'],
    ['operator','NR-O4','WhatsApp','+91 98450 22118',           'read',     1,null,'Yesterday 18:20'],
    ['operator','NR-O5','SMS',     '+254 712 004 118',          'expired',  3,'handset-off','Yesterday 14:02'],
    ['partner', 'NR-P1','Email',   'k.boehm@gmail.com','delivered',1,null,'Today 09:02'],
    ['partner', 'NR-P2','Push',    'Aventa app · iPhone 15',    'unknown',  1,null,'Today 08:44'],
    ['partner', 'NR-P3','SMS',     '+49 176 5510442',           'delivered',2,null,'Yesterday 21:15'],
    ['partner', 'NR-P4','SMS',     '+49 176 5510999',           'failed',   1,'invalid-number','23 Jul 11:40'],
    ['buyer',   'NR-B1','Email',   'm.nathan@6dtech.co.in','delivered',1,null,'Today 08:41'],
    ['buyer',   'NR-B2','Email',   'finance@gmail.com', 'delivered',1,null,'Yesterday 09:10'],
    ['buyer',   'NR-B3','SMS',     '+353 86 220 4471',          'sent',     1,null,'Today 09:50'],
    ['consumer','NR-C1','SMS',     '+91 98860 41120',           'delivered',1,null,'Today 07:22'],
    ['consumer','NR-C2','WhatsApp','+91 98860 41120',           'failed',   1,'template-rejected','Yesterday 16:30'],
    ['consumer','NR-C3','Push',    'Aventa app · Android',      'unknown',  1,null,'Yesterday 12:05']
  ];
  rows.forEach((r,i)=>{
    const chan=r[2];
    const prov=CHANNEL_PROVIDERS.filter(p=>p.chan===chan)[0];
    DELIVERIES.push({
      id:'MSG-'+String(90140+i),
      ctx:r[0], rule:r[1], chan:chan, to:r[3], state:r[4], attempts:r[5], code:r[6], when:r[7],
      provider:prov?prov.name:'—',
      cost:prov? +(prov.cost*r[5]).toFixed(4) : 0,
      segments: chan==='SMS' ? 1 : null
    });
  });
})();

const CHANNEL_SPEND = {
  period:'July 2026 to date',
  lines:[
    {chan:'SMS',      sent:184620, cost:1144.64, failed:2951},
    {chan:'Email',    sent:902410, cost:90.24,   failed:7219},
    {chan:'WhatsApp', sent:41208,  cost:362.63,  failed:2431},
    {chan:'Push',     sent:611940, cost:0,       failed:50791},
    {chan:'In-app',   sent:288104, cost:0,       failed:0}
  ],
  note:'Push failures are overwhelmingly stale tokens from uninstalled apps. They cost nothing '+
       'and are not worth chasing, which is why they are reported separately rather than folded '+
       'into a single platform-wide delivery rate.'
};

/* ==========================================================================
   M21 — BULK UPDATE
   --------------------------------------------------------------------------
   Positions taken, because each is a decision:
   · Bulk UPDATES existing records. It never creates and never deletes.
     Creating a thousand records from a spreadsheet is a different, riskier
     operation and it does not belong behind the same button.
   · A dry run is mandatory. You cannot commit a file you have not seen the
     effect of.
   · A bad row is rejected on its own. Rejecting four thousand good rows
     because three are wrong is not a safety feature, it is a tantrum.
   · Every rule the single-record path enforces is enforced here too. Bulk is
     not a way around the cost floor.
   ========================================================================== */

const BULK_LIMITS = {maxRows:5000, maxErrPct:20,
  note:'A file where more than '+20+'% of rows fail is refused outright — that is a wrong '+
       'file or a wrong template, not a set of typos, and importing the good fifth of it makes a mess '+
       'that is harder to unpick than a re-upload.'};

/* Each set names the collection, the key that identifies a row, and only the
   fields that may be changed. A field absent from this list cannot be set by
   a spreadsheet however it is spelled in the header. */
const BULK_SETS = {
  operator:[
    {id:'bulk-listing', label:'Listings — price and status', noun:'listings',
     key:'id', keyLabel:'SKU',
     source:'PRODUCTS', scope:'Every listing in the catalogue',
     fields:[
       {k:'sale',   label:'Sale price',  type:'money', rule:'floor'},
       {k:'status', label:'Status',      type:'enum',  values:['live','paused','draft']},
       {k:'comm',   label:'Commission %',type:'pct',   min:0, max:40}
     ],
     why:'Repricing a category or pausing a seller’s range is the single most common bulk job in a marketplace.'},
    {id:'bulk-partner', label:'Partners — status and plan', noun:'partners',
     key:'id', keyLabel:'Partner ID',
     source:'PARTNERS', scope:'Every onboarded partner',
     fields:[
       {k:'status', label:'Status', type:'enum', values:['active','suspended','onboarding','review']},
       {k:'plan',   label:'Commission plan', type:'text'},
       {k:'tier',   label:'Tier', type:'enum', values:['Platinum','Gold','Silver','Bronze']}
     ],
     why:'Tier reviews and plan migrations happen to a whole cohort at once, at the end of a quarter.'},
    {id:'bulk-iccid', label:'SIMs — state', noun:'SIM records',
     key:'iccid', keyLabel:'ICCID',
     source:'ICCIDS', scope:'Sampled SIM records',
     fields:[{k:'state', label:'State', type:'enum', values:['available','reserved','retired']}],
     why:'Retiring a bad batch is a bulk job by nature.',
     caution:'This changes our copy only. The Number Management system is the record of truth and is not written to '+
             'by a spreadsheet — a bulk file that could rewrite the BSS would be a hole, not a feature.'},
    {id:'bulk-user', label:'Users — role and status', noun:'users',
     key:'id', keyLabel:'User ID',
     source:'ORG_USERS.operator', scope:'Users in this organisation',
     fields:[
       {k:'role',   label:'Role',   type:'role'},
       {k:'status', label:'Status', type:'enum', values:['active','suspended','invited']}
     ],
     why:'Joiners, movers and leavers arrive from HR as a list, not one at a time.',
     caution:'You cannot change your own role or status in a bulk file. Removing your own access by spreadsheet '+
             'is the one mistake nobody can undo for you.'},
    {id:'bulk-banner', label:'Banners — state and weight', noun:'banners',
     key:'id', keyLabel:'Banner ID',
     source:'BANNERS', scope:'All storefront banners',
     fields:[
       {k:'state',  label:'State',  type:'enum', values:['live','paused','draft','ended']},
       {k:'weight', label:'Weight', type:'int', min:0, max:100}
     ],
     why:'A campaign switchover is a dozen banners changing state at the same minute.'}
  ],
  partner:[
    {id:'bulk-mylisting', label:'My listings — pricing', noun:'listings',
     key:'id', keyLabel:'SKU',
     source:'MY_LISTINGS', scope:'Only your own listings',
     fields:[
       {k:'sale',   label:'Sale price', type:'money', rule:'floor'},
       {k:'cost',   label:'Cost price', type:'money', rule:'cost'},
       {k:'status', label:'Status',     type:'enum', values:['live','paused','draft']}
     ],
     why:'A supplier price change lands as a spreadsheet and has to reach every affected line the same day.',
     caution:'A sale price below cost is rejected row by row. The floor is enforced in the pricing engine, '+
             'so a spreadsheet cannot go under it.'},
    {id:'bulk-stock', label:'Stock — on hand and reorder point', noun:'stock lines',
     key:'sku', keyLabel:'SKU',
     source:'MY_INVENTORY', scope:'Your stock lines',
     fields:[
       {k:'onHand',    label:'On hand',      type:'int', min:0, rule:'stock'},
       {k:'reorderAt', label:'Reorder point',type:'int', min:0}
     ],
     why:'A stock count comes back from the warehouse as a file.',
     caution:'A count below what is already reserved is rejected. We cannot un-promise stock a customer has bought.'}
  ],
  buyer:[
    {id:'bulk-buyer-user', label:'Users — role, cost centre and status', noun:'users',
     key:'id', keyLabel:'User ID',
     source:'ORG_USERS.buyer', scope:'Users on this account',
     fields:[
       {k:'role',   label:'Role',   type:'role'},
       {k:'status', label:'Status', type:'enum', values:['active','suspended','invited']}
     ],
     why:'Procurement onboards a department at a time, from an HR extract.',
     caution:'You cannot change your own role or status in a bulk file.'}
  ],
  consumer:[
    {id:'bulk-sub', label:'Subscriptions — auto-renew', noun:'subscriptions',
     key:'id', keyLabel:'Subscription',
     source:'MY_SUBS', scope:'Your own subscriptions',
     fields:[{k:'autoRenew', label:'Auto-renew', type:'bool'}],
     why:'Turning auto-renew off across several subscriptions before a review date is the one bulk job a '+
         'retail account genuinely has.',
     caution:'Bulk is deliberately thin here, and cancelling is not offered in it. A retail account with six '+
             'subscriptions does not need a CSV pipeline, and a bulk cancel is a mistake nobody can undo for you. '+
             'Turning auto-renew off is reversible; cancelling is not.'}
  ]
};

const BULK_JOBS = [
  {id:'BLK-4412', ctx:'operator', set:'bulk-listing', file:'q3-reprice-device.csv',
   when:'23 Jul 2026 11:04', by:'Tomas Novak', rows:184, applied:181, rejected:3, mode:'CSV',
   note:'Three rows below the cost floor were rejected and re-sent the same afternoon.'},
  {id:'BLK-4409', ctx:'operator', set:'bulk-partner', file:'—',
   when:'19 Jul 2026 16:20', by:'Ananya Krishnan', rows:12, applied:12, rejected:0, mode:'Common update',
   note:'Twelve partners moved to the Q3 tiered plan in one action.'},
  {id:'BLK-4402', ctx:'partner', set:'bulk-mylisting', file:'supplier-increase-jul.csv',
   when:'17 Jul 2026 09:41', by:'Felix Meyer', rows:38, applied:35, rejected:3, mode:'CSV',
   note:'Three rows would have priced below cost and were refused.'},
  {id:'BLK-4398', ctx:'buyer', set:'bulk-buyer-user', file:'hr-joiners-jul.csv',
   when:'15 Jul 2026 08:15', by:'Meera Nathan', rows:22, applied:22, rejected:0, mode:'CSV',
   note:'Monthly HR extract.'}
];

/* ==========================================================================
   M24 — KNOWLEDGE BASE AND GUIDED TUTORIALS
   --------------------------------------------------------------------------
   Positions taken:
   · An article names the screen it is about and can open it. Help that
     describes a screen without taking you there is a manual, not help.
   · Articles are scoped by role. A reader whose role cannot perform the
     action is told who can, rather than being walked to a button that is not
     there.
   · A tour drives the actual application. Annotated screenshots go stale the
     moment the screen changes; a tour that navigates cannot.
   · Every article carries when it was last reviewed, and one past its review
     date says so rather than looking current.
   · Usefulness is counted honestly. An article nobody has rated shows no
     score rather than a flattering default.
   · Every article ends with a way to raise a ticket, pre-filled with the
     article it came from, because the ones that fail are the ones worth
     knowing about.
   ========================================================================== */

const KB_KINDS = [
  {id:'start',   label:'Getting started', icon:'play'},
  {id:'howto',   label:'How to',          icon:'checklist'},
  {id:'concept', label:'How it works',    icon:'info'},
  {id:'policy',  label:'Rules and limits',icon:'shield'},
  {id:'fix',     label:'When it goes wrong', icon:'warning'}
];
const KB_STALE_DAYS = 180;

/* A tour is a sequence of stops. Each names a view and what to look at there.
   Running one navigates the application. */
const KB_TOURS = {
  operator:[
    {id:'TR-O1', title:'Take a seller from application to first sale', mins:6,
     why:'The path most new operators are asked to walk on day one.',
     stops:[
      {view:'onboardq', at:'Partner onboarding', say:'Seven gates. The funnel shows where applications actually stall, which is almost never where people assume.'},
      {view:'onboardq', at:'A single application', say:'Open one. Every gate keeps what the seller submitted, so a decision can be re-read months later.'},
      {view:'rules',    at:'Listing rules', say:'What every listing is checked against. Set the level per category in the matrix.'},
      {view:'catalogue',at:'Catalogue queue', say:'Their first listing lands here. Approving it publishes; rejecting it returns a reason the seller can act on.'},
      {view:'plans',    at:'Commission plans', say:'What the marketplace earns on that sale, and under which commercial model.'},
      {view:'settlements',at:'Settlement runs', say:'And what the seller is paid, less commission, fees, withholding and refunds.'}]},
    {id:'TR-O2', title:'Understand where the money goes', mins:5,
     why:'Gross value is not revenue, and settlement is not profit. This is the chain between them.',
     stops:[
      {view:'home',     at:'Marketplace overview', say:'Gross value across every category. The projection states its method and how wrong it was last quarter.'},
      {view:'plans',    at:'Commission plans', say:'Seven commercial models. Changing the model changes which parameters even apply.'},
      {view:'promotions',at:'Promotions', say:'Discount rules, and the floor no rule may cross. The engine clamps at cost, not the rule author.'},
      {view:'tax',      at:'Tax configuration', say:'Who is merchant of record decides who owes the tax. That is a commercial decision before it is a tax one.'},
      {view:'settlements',at:'Settlement runs', say:'The statement reconciles to order lines. Approving it is the point of no return, so it asks twice.'},
      {view:'collections',at:'Collections', say:'And when a payment fails, the ladder that recovers it without manufacturing churn.'}]},
    {id:'TR-O3', title:'Prove the platform is governable', mins:4,
     why:'The questions an auditor or a security reviewer will ask, and where each is answered.',
     stops:[
      {view:'users',   at:'Users', say:'Who has access, with what role, and whether their second factor is on.'},
      {view:'roles',   at:'Roles configuration', say:'What each role may do, as a grid rather than as prose.'},
      {view:'audit',   at:'Audit log', say:'Append-only, hash-chained, streamed to a SIEM outside the control of the people it audits.'},
      {view:'bulk',    at:'Bulk updates', say:'Mass change with a mandatory dry run, per-row rejection, and one audit entry per job.'}]}
  ],
  partner:[
    {id:'TR-P1', title:'Get your first listing live', mins:5,
     why:'From an approved account to a published SKU.',
     stops:[
      {view:'onboarding', at:'Onboarding', say:'Clear every gate first. A listing cannot publish while a gate is open.'},
      {view:'newlisting', at:'New listing', say:'Six steps. Media and alt text are required before submission, not after.'},
      {view:'newlisting', at:'Pricing and commission', say:'Cost, list and sale are three separate numbers. The margin stack shows what is left after everyone takes their cut.'},
      {view:'integrations', at:'Integrations', say:'Point fulfilment at an endpoint, or orders wait for someone to open the portal.'},
      {view:'listings',  at:'My listings', say:'It appears here once submitted, and moves to live when the catalogue team clears it.'}]},
    {id:'TR-P2', title:'Understand what you actually get paid', mins:4,
     why:'The gap between a sale price and a bank credit, itemised.',
     stops:[
      {view:'plan',       at:'Settlement plan', say:'Your commercial model and the rate that applies to each category.'},
      {view:'settlement', at:'Settlement', say:'The statement reconciles to your orders. Every deduction is named.'},
      {view:'home',       at:'Dashboard', say:'The settlement projection is a forecast with a stated method, not a payment schedule.'},
      {view:'tickets',    at:'Support tickets', say:'If a statement looks wrong, raise it here. Settlement queries have their own SLA.'}]}
  ],
  buyer:[
    {id:'TR-B1', title:'Buy something that needs approval', mins:4,
     why:'The requisition path, end to end, including what happens when it is refused.',
     stops:[
      {view:'browse',    at:'Catalogue', say:'Contract prices apply automatically where your account has one.'},
      {view:'browse', open:'openCart()', at:'Basket', say:'Above your threshold this becomes a requisition rather than an order.'},
      {view:'approvals', at:'Approvals', say:'Who approves, in what order, and what happens if they do not.'},
      {view:'orders',    at:'Orders', say:'Approved requisitions become orders here, with their fulfilment state.'}]},
    {id:'TR-B2', title:'Set the account up for a department', mins:4,
     why:'Users, what they may spend, and who signs it off.',
     stops:[
      {view:'users',   at:'Users', say:'Add people, or load a department at once from an HR extract.'},
      {view:'roles',   at:'Roles configuration', say:'What each role may buy and approve.'},
      {view:'bulk',    at:'Bulk updates', say:'A joiners file changes many users at once, with a dry run first.'},
      {view:'contracts', at:'Contract pricing', say:'Negotiated prices for this account, and the rule that an unsigned one is recorded but never charged.'}]}
  ],
  consumer:[
    {id:'TR-C1', title:'Find something and buy it', mins:3,
     why:'The shortest path through the storefront.',
     stops:[
      {view:'browse', at:'Browse', say:'Compare up to three side by side. Availability is read from real stock, not a label.'},
      {view:'browse', open:'openCart()', at:'Basket', say:'Tax is shown as included or added, never both. Promotions state what applied and what did not.'},
      {view:'orders', at:'Orders', say:'Track it here. A physical item shows carrier and tracking.'}]},
    {id:'TR-C2', title:'Look after your account', mins:3,
     why:'Subscriptions, payments and who else can get in.',
     stops:[
      {view:'subs',    at:'Subscriptions', say:'Pause, cancel or restart. Auto-renew can be changed for several at once.'},
      {view:'account', at:'My details', say:'If a payment fails you are told here, and told plainly what has and has not stopped.'},
      {view:'auth',    at:'Sign-in and devices', say:'Every device signed in to this account, and how to end one you do not recognise.'}]}
  ]
};

/* Articles. `roles` limits who the how-to is actionable for; everyone can read
   it, but a reader who cannot act is told so and told who can. */
const KB_ARTICLES = {
  operator:[
    {id:'KB-O01', kind:'start', title:'What this console is for', mins:3, updated:'18 Jul 2026', view:'home',
     tags:['overview'],
     summary:'The operator runs the marketplace: who may sell, what may be listed, what it costs to sell, and who gets paid.',
     body:[
      ['The four jobs','Supply — deciding who sells and what they may list. Commercials — commission, promotions, tax and settlement. Operations — orders, inventory, numbers and support. Governance — access, audit and the rules themselves.'],
      ['What the operator does not do','You do not price a seller’s product for them, and you do not fulfil their orders. The marketplace sets the floor and the rules; the seller sets the price inside them.'],
      ['Where the numbers come from','Every figure on the overview reconciles to the order register. Gross value equals the sum of the categories and the sum of order gross. If a number here disagrees with a statement, the statement is right and this is a bug worth raising.']]},
    {id:'KB-O02', kind:'howto', title:'Onboard a seller through the seven gates', mins:5, updated:'21 Jul 2026',
     view:'onboardq', roles:['OR-ADMIN','OR-ONB'], tags:['partners','onboarding','kyc'],
     summary:'Invite, verify, and clear a seller to trade — and what to do when a gate fails.',
     body:[
      ['Before you start','Have the seller’s legal entity name and the email of the person who can sign. An invitation names a recipient; it is not a generic link.'],
      ['The gates','Application, KYC and beneficial ownership, sanctions screening, commercial terms, technical readiness, catalogue readiness, go-live. Each has an owner and a target in working days.'],
      ['Clearing a gate','Open the application and the gate. Every submission the seller made is kept in full, so you are deciding on the evidence rather than on a summary.'],
      ['When a gate fails','Failing KYC stops the application. It is not a rejection of the company — they may reapply with corrected documentation. Say which document and why, because "failed KYC" tells them nothing they can act on.'],
      ['Dual control','Some gates require a second approver. That is set in the gate policy, not per application, so it cannot be waived case by case.']]},
    {id:'KB-O03', kind:'howto', title:'Review a listing and decide it', mins:4, updated:'19 Jul 2026',
     view:'catalogue', roles:['OR-ADMIN','OR-CAT'], tags:['catalogue','review'],
     summary:'What the queue is checking, and how to reject in a way the seller can act on.',
     body:[
      ['What is automatic and what is not','Automated rules are already evaluated when a listing reaches you. Your job is the ones a machine cannot judge.'],
      ['Reading the checklist','A rule set to enforce has already blocked publication. A rule set to warn is on your list but did not block — you decide.'],
      ['Rejecting well','Name the rule, name the evidence that is missing, and say what would clear it. A rejection the seller cannot act on comes straight back as a support ticket.'],
      ['Asking rather than rejecting','If it is a question rather than a failure, use Ask the partner. It keeps the listing in the queue instead of restarting the clock.']]},
    {id:'KB-O04', kind:'policy', title:'How listing rules work', mins:4, updated:'26 Jul 2026',
     view:'rules', roles:['OR-ADMIN','OR-CAT'], tags:['rules','policy'],
     summary:'Rules are authored once and applied per category at three levels.',
     body:[
      ['Three levels','Enforce blocks publication. Warn appears on the reviewer’s checklist but does not block. Off removes the check entirely, which is a decision worth being deliberate about.'],
      ['Author once, apply many times','A rule carries what it requires, how it is checked, who owns it and what evidence it needs. The matrix then decides where it applies.'],
      ['What a rule costs','An automated rule costs nothing per listing. A manual one costs about nine reviewer minutes on every listing it touches — on a four-hundred-listing category that is sixty hours a pass. The editor states the figure before you save.'],
      ['Locked rules','Sanctions screening is fixed at enforce everywhere. It is not a marketplace policy choice.'],
      ['Retiring','Retire rather than delete. Past decisions cite the rule, and retiring it is not an amnesty — listings already rejected under it stay rejected.']]},
    {id:'KB-O05', kind:'concept', title:'Commission, commercial models and the cost floor', mins:5, updated:'20 Jul 2026',
     view:'plans', roles:['OR-ADMIN','OR-FIN'], tags:['commercial','pricing'],
     summary:'Seven models, and the one limit none of them may cross.',
     body:[
      ['Model first, parameters second','Changing the commercial model changes which parameters apply. A revenue-share plan and a fixed-fee plan do not share a rate field.'],
      ['The cost floor','No discount, promotion, bundle or override may take a line below cost. The clamp is in the pricing engine, not in rule authoring, so it cannot be written around.'],
      ['Who funds a discount','Each seller sets how much of their margin the marketplace may spend. Beyond that, the discount is marketplace-funded and attributed as such.'],
      ['Reading a margin stack','Sale, less commission, less payment and per-order fees, equals settled. Less cost equals margin. Where fees exceed margin, that is flagged rather than shown as a healthy settlement.']]},
    {id:'KB-O06', kind:'howto', title:'Approve a settlement run', mins:4, updated:'22 Jul 2026',
     view:'settlements', roles:['OR-ADMIN','OR-FIN'], tags:['settlement','money'],
     summary:'What to check before you release money, and why it asks twice.',
     body:[
      ['Read the statement, not the total','Open a statement before approving. It reconciles to order lines; the total on its own tells you nothing about whether it is right.'],
      ['What is deducted','Commission, payment fees, per-order fees, withholding tax and refunds. Each is a line, not a lump.'],
      ['Second check','Approval asks you to re-authenticate. An unattended screen that is already signed in should not be able to release a payment run.'],
      ['After approval','It is the point of no return in this flow. A correction after approval is an adjustment on the next run, not an edit to this one.']]},
    {id:'KB-O07', kind:'concept', title:'Numbers and SIMs come from the BSS', mins:4, updated:'26 Jul 2026',
     view:'numbers', roles:['OR-ADMIN','OR-SUP'], tags:['inventory','sim','bss'],
     summary:'ICCID, IMSI and MSISDN are not held here. This screen queries the Number Management system.',
     body:[
      ['Who owns what','The operator’s Number Management and Logical Inventory systems own the resources. The marketplace holds a reservation and an assignment reference against an order.'],
      ['Why not both','A second register of numbers guarantees two answers to the same question, and the wrong one will be the one somebody quotes to a customer.'],
      ['Reconciliation','Runs nightly. Where we disagree with the BSS, we are corrected. Nothing here writes to the BSS — not a screen, not a bulk file.'],
      ['eSIM states','Released, downloaded, installed, enabled, disabled, deleted. These are the SGP.22 states; the SM-DP+ owns them and we observe them. Assignment creates a profile in released — it is not installed until the device fetches it.']]},
    {id:'KB-O08', kind:'fix', title:'A message did not arrive', mins:3, updated:'26 Jul 2026',
     view:'delivery', roles:['OR-ADMIN','OR-SUP'], tags:['notifications','support'],
     summary:'How to answer "I never got the message" from one screen.',
     body:[
      ['Find it','Message delivery, then search the recipient. Every send carries its provider, attempts, reason code and cost.'],
      ['Read the state','Delivered means the carrier confirmed handset receipt. Sent means the provider passed it on and nothing has come back yet. No receipt means the channel cannot tell us — push, for example, confirms acceptance, not display.'],
      ['Hard versus soft','An invalid number, an opt-out, a carrier block or an unapproved template will never succeed. Retrying produces another charge and no message. Fix the underlying record instead.'],
      ['Soft failures','Handset off or a provider limit reached will retry with backoff and fail over to the standby provider after two attempts.']]},
    {id:'KB-O09', kind:'policy', title:'Who can read the audit log', mins:3, updated:'24 Jul 2026',
     view:'audit', roles:['OR-ADMIN'], tags:['governance','audit'],
     summary:'Read scope is by role, and it is deliberately narrow.',
     body:[
      ['No edit path','There is no way to change or delete an entry, for anyone. A log that can be edited is not evidence.'],
      ['Scoped, not open','A support agent seeing a settlement approval, or one seller seeing another’s onboarding, would be a data breach dressed up as transparency.'],
      ['Redaction','Personal data is redacted rather than the entry hidden — the reader should still know an event occurred. Your own actions are never redacted from you.'],
      ['Integrity','Entries are hash-chained and anchored daily to object-locked storage. Verification can be run on demand, and the run is itself recorded.']]},
    {id:'KB-O10', kind:'howto', title:'Change many records at once', mins:4, updated:'26 Jul 2026',
     view:'bulk', roles:['OR-ADMIN','OR-CAT','OR-FIN'], tags:['bulk','efficiency'],
     summary:'A file for different values, a common update for the same value.',
     body:[
      ['Which door','If every record gets the same value, use a common update. If each needs a different one, use a file. A common update pretending to be a spreadsheet is how the wrong price reaches a whole category.'],
      ['Always a dry run','Nothing is written until you have seen, row by row, what would change. Download the template — it comes pre-filled with current values, so an edit is a diff rather than a retype.'],
      ['Rejections','A bad row is rejected on its own and the rest still apply. A file failing more than a fifth of its rows is refused outright: that is a wrong file, not a set of typos.'],
      ['What bulk cannot do','It updates. It never creates and never deletes. It cannot price below cost, and it cannot change your own role or status.']]}
  ],
  partner:[
    {id:'KB-P01', kind:'start', title:'Selling here: the short version', mins:3, updated:'18 Jul 2026', view:'home',
     tags:['overview'],
     summary:'Listing is free. You pay commission only when something sells.',
     body:[
      ['The deal','No listing fee and no shelf rent. Commission applies on a sale, at the rate in your settlement plan.'],
      ['What you control','Your price above the floor, your stock, your fulfilment, your media, and your own console’s branding.'],
      ['What the marketplace controls','Which categories you may sell in, the rules every listing is checked against, the checkout, and the settlement documents.'],
      ['Getting paid','On your billing cycle, less commission, fees, withholding and refunds. Every deduction is itemised on the statement.']]},
    {id:'KB-P02', kind:'howto', title:'Create a listing that passes review first time', mins:5, updated:'25 Jul 2026',
     view:'newlisting', roles:['PR-OWNER','PR-CAT'], tags:['catalogue','listing'],
     summary:'The six steps, and the three things that cause most rejections.',
     body:[
      ['Media is not optional','A minimum number of images, one marked primary, and alt text on every item. Submission is blocked until all three are satisfied — a listing nobody can read is a listing some buyers cannot buy.'],
      ['Three prices','Cost is what it costs you. List is the reference price. Sale is what a buyer pays today. Cost is never shown to a buyer, and a sale price at or below cost is refused.'],
      ['Declarations','Sign all four before submitting. Unsigned declarations do not block submission, but the review will come back to you for them, which costs you a day.'],
      ['Fulfilment','Point it at an endpoint. Left on manual, every order waits for a human to open the portal.'],
      ['The category cap','Each category limits how many live listings one seller may hold. The wizard shows your remaining headroom when you choose the category.']]},
    {id:'KB-P03', kind:'concept', title:'What you actually get paid', mins:4, updated:'22 Jul 2026',
     view:'settlement', roles:['PR-OWNER','PR-FIN'], tags:['settlement','money'],
     summary:'From sale price to bank credit, itemised.',
     body:[
      ['The chain','Sale price, less commission, less payment fees, less per-order fees, less withholding tax, less refunds, equals the settled amount.'],
      ['Withholding','Where it applies it is a tax obligation, not a marketplace charge. The certificate is on the statement.'],
      ['Your margin','Settled less your cost. If commission and fees exceed your margin, the margin stack in the listing wizard says so before you publish rather than after.'],
      ['Querying a statement','Raise it from the statement itself so the query carries the reference. Settlement queries have their own resolution target.']]},
    {id:'KB-P04', kind:'howto', title:'Make orders fulfil themselves', mins:4, updated:'24 Jul 2026',
     view:'integrations', roles:['PR-OWNER','PR-OPS'], tags:['api','fulfilment'],
     summary:'Register an endpoint, subscribe to events, and check coverage.',
     body:[
      ['We call you','The marketplace calls your endpoint; you never poll us.'],
      ['Authentication','Unauthenticated endpoints are not accepted. Order payloads carry buyer data.'],
      ['Test before you rely on it','Send a test call from the console. A failing endpoint means orders are not acknowledged, and that shows on your listings.'],
      ['Coverage','A required event with no enabled endpoint is reported as unhandled. It is not queued and not retried later — it simply does not arrive.'],
      ['Retries','Delivery is retried with backoff. Persistent failure marks the endpoint unhealthy, which is visible to the catalogue team.']]},
    {id:'KB-P05', kind:'policy', title:'Stock, reservations and overselling', mins:3, updated:'23 Jul 2026',
     view:'inventory', roles:['PR-OWNER','PR-OPS'], tags:['inventory'],
     summary:'Availability is on hand less reserved, and the storefront reads it.',
     body:[
      ['What a buyer sees','On hand less reserved. Not on hand. That is why a basket cannot promise stock the warehouse does not have.'],
      ['Reservations expire','A hold that is not converted releases back to the pool after its window, so an abandoned basket does not sterilise stock.'],
      ['Counts','A stock count below what is already reserved is refused, in the screen and in a bulk file. We cannot un-promise stock a customer has bought.'],
      ['Adjustments','Every movement is a record with a reason. A silent correction destroys the audit value of the ledger.']]},
    {id:'KB-P06', kind:'howto', title:'Put your own branding on this console', mins:3, updated:'25 Jul 2026',
     view:'branding', roles:['PR-OWNER'], tags:['branding'],
     summary:'Your livery here, and why it stops here.',
     body:[
      ['What you can change','Display name, logo with alt text, colours, light or dark, and which dashboard cards you see.'],
      ['Contrast is checked','A palette below WCAG AA cannot be applied. You are told which colour fails and by how much.'],
      ['Three cards cannot be hidden','Orders to fulfil, onboarding progress and open disputes. Hiding an obligation does not remove it.'],
      ['Where it stops','Your console is yours. Listings carry your name and logo inside the marketplace layout. The storefront, checkout and settlement documents stay in the marketplace’s livery — a checkout that restyles per seller erodes the trust buyers come for.']]},
    {id:'KB-P07', kind:'fix', title:'My listing was rejected', mins:3, updated:'24 Jul 2026',
     view:'listings', roles:['PR-OWNER','PR-CAT'], tags:['catalogue','troubleshooting'],
     summary:'Read the rule, fix the evidence, resubmit.',
     body:[
      ['Find the reason','Open the listing. The decision names the rule and what was missing.'],
      ['Common causes','Missing alt text; a sale price at or below cost; an expired certificate; a market you are not onboarded into.'],
      ['Resubmitting','Fix and resubmit — it re-enters the queue. Resubmitting unchanged will be rejected again with the same reason.'],
      ['If you disagree','Some rules are appealable and some are not; the decision says which. Where it is, raise a ticket citing the listing.']]},
    {id:'KB-P08', kind:'concept', title:'Version history and rolling back a price', mins:3, updated:'26 Jul 2026',
     view:'listings', roles:['PR-OWNER','PR-CAT'], tags:['catalogue','pricing'],
     summary:'Every published change is kept, and a rollback moves forward.',
     body:[
      ['Why it is kept','A pricing dispute is only resolvable from a record of what a buyer could have seen on a given date.'],
      ['Rollback','Reverting creates a new version carrying the earlier values. The intervening versions stay. History is never rewritten.'],
      ['What changed','The history shows the difference between consecutive versions field by field, not merely that something changed.']]},
    {id:'KB-P09', kind:'howto', title:'Deciding a refund request', mins:4, updated:'26 Jul 2026',
     view:'refunds', roles:['PR-OWNER','PR-FIN'], tags:['refunds','money','sla'],
     summary:'You have 48 hours. Silence costs you the decision, not the money.',
     body:[
      ['Whose call it is','Yours, on anything you sold directly. The marketplace decides on its own products, on '+
       'anything inside a bundle it assembled, and on anything you leave unanswered past the SLA.'],
      ['The clock','48 hours from the request. After that the marketplace answers on your behalf \u2014 and it is '+
       'still recovered from your settlement. Not answering does not save you the money; it only costs you '+
       'the say in it.'],
      ['A decline needs a reason','One sentence that a customer could read back to you. A decline without one '+
       'gets escalated, and then somebody with less information than you decides it.'],
      ['Part refunds','Allowed, and they need the difference explained. "Refunded three of twelve units, the '+
       'other nine were delivered" is a decision. A number with no explanation reads as arbitrary.'],
      ['What is never worth arguing','A duplicate charge and a non-delivery are auto-approved below the '+
       'threshold precisely because arguing about them costs more than the refund.']]},
    {id:'KB-P10', kind:'concept', title:'Credit and debit notes on your statement', mins:4, updated:'26 Jul 2026',
     view:'notes', roles:['PR-OWNER','PR-FIN'], tags:['settlement','money'],
     summary:'An adjustment to a settlement already struck \u2014 and what to do if it is wrong.',
     body:[
      ['What a note is','A correction between the marketplace and you, after a settlement has been struck. '+
       'A credit reduces what you owe us; a debit increases it. No customer is involved and no card is touched.'],
      ['When it applies','On your next statement. It does not move money on its own, which is why it has to be '+
       'raised before the run closes.'],
      ['Disputing one','If it is wrong, dispute it rather than paying it. A disputed note does not settle while '+
       'it is open, so it cannot be quietly deducted while the argument runs.'],
      ['Post it before the run','Put the note into your own ledger when it is issued, not when it settles. '+
       'Reconciling a statement against books that have not seen the adjustment is where most settlement '+
       'queries come from.']]},
    {id:'KB-P11', kind:'concept', title:'Chasing your own customers', mins:5, updated:'26 Jul 2026',
     view:'collections', roles:['PR-OWNER','PR-FIN'], tags:['collections','dunning','money'],
     summary:'You pace what you sold directly. The marketplace paces bundles, and what you owe it.',
     body:[
      ['You were given a ladder','At onboarding, chosen from the category you sell in. Run it as it stands, '+
       'edit it, or add more \u2014 what recovers money from a games subscriber is not what recovers it from a '+
       'fleet installer.'],
      ['Where yours does not apply','Anything sold inside a bundle the marketplace assembled runs on the '+
       'marketplace ladder, whatever you have set. One customer, one bill, therefore one suspension date. Two '+
       'ladders on one balance produce two dates and the customer believes whichever arrived first.'],
      ['What you owe us','Commission and fees run on the marketplace ladder. A debtor does not set the terms of '+
       'their own recovery, and that includes you.'],
      ['The marketplace can see yours','Every ladder you publish is visible to us, with how far it has drifted '+
       'from the default we gave you. That is not supervision for its own sake \u2014 when a customer complains '+
       'about being chased, we have to be able to answer.'],
      ['A step that reaches nobody','If a channel is switched off, any step relying only on it is marked as not '+
       'sending. A ladder can look complete and be doing nothing.']]}
  ],
  buyer:[
    {id:'KB-B01', kind:'start', title:'How buying here works', mins:3, updated:'19 Jul 2026', view:'home',
     tags:['overview'],
     summary:'One catalogue, many sellers, one invoice and one set of approvals.',
     body:[
      ['One relationship','You contract with the marketplace, not with each seller. One invoice, one set of terms, one place to dispute.'],
      ['Approvals','Above your threshold a basket becomes a requisition. Who approves is set by policy, not per order.'],
      ['Contract pricing','Where your account has a negotiated price it applies automatically. Everyone else sees list.'],
      ['Your own branding','This portal carries your livery rather than the marketplace’s, because it is your people using it.']]},
    {id:'KB-B02', kind:'howto', title:'Raise and track a requisition', mins:4, updated:'21 Jul 2026',
     view:'approvals', roles:['BY-ADMIN','BY-BUY'], tags:['ordering','approvals'],
     summary:'What triggers approval, who sees it, and what happens if nobody acts.',
     body:[
      ['What triggers it','Basket value above the threshold for your role, or any item in a controlled category.'],
      ['Who approves','Set in the approval policy — by value band, by cost centre, or both. A requisition can need more than one.'],
      ['If nobody acts','It escalates on the policy timer. It does not quietly expire, and the requester is told.'],
      ['Refusal','A refusal carries a reason. The basket is preserved so it can be amended and resubmitted rather than rebuilt.']]},
    {id:'KB-B03', kind:'concept', title:'Contract pricing on your account', mins:3, updated:'26 Jul 2026',
     view:'contracts', roles:['BY-ADMIN','BY-FIN'], tags:['pricing','commercial'],
     summary:'Negotiated prices, minimum quantities and the unsigned rule.',
     body:[
      ['Scope','A contract price binds your account only. It does not leak to another buyer.'],
      ['Minimum quantity','Below the minimum, list price applies. That is the deal, not a fault.'],
      ['Unsigned prices','A negotiated price that is not signed is recorded and shown, but never charged. Recording the number before signature is useful; charging it is not.'],
      ['Expiry','A term that has ended stops applying without the record being deleted, so the history stays readable.']]},
    {id:'KB-B04', kind:'howto', title:'Onboard a department at once', mins:3, updated:'26 Jul 2026',
     view:'bulk', roles:['BY-ADMIN'], tags:['users','bulk'],
     summary:'Load an HR extract instead of adding people one at a time.',
     body:[
      ['Template first','Download it pre-filled with your current users, edit the rows that change, and upload.'],
      ['Dry run','You see every change before anything is written. Bad rows are rejected individually with the reason.'],
      ['What it will not do','It updates existing users; it does not create or delete. And you cannot change your own role or status in a file.']]},
    {id:'KB-B05', kind:'concept', title:'Invoices, cost centres and disputes', mins:4, updated:'22 Jul 2026',
     view:'billing', roles:['BY-ADMIN','BY-FIN'], tags:['billing'],
     summary:'One consolidated invoice, split the way your finance team needs it.',
     body:[
      ['Consolidation','Purchases across sellers arrive on one invoice on your cycle.'],
      ['Cost centres','Lines carry the cost centre of the requester, so the split does not have to be reconstructed later.'],
      ['Tax','Whether tax is included or added is stated, and shown once — never both ways on the same document.'],
      ['Disputing a line','Dispute the line rather than the invoice. It keeps the rest payable and the dispute specific.']]},
    {id:'KB-B06', kind:'fix', title:'Something has not arrived', mins:3, updated:'23 Jul 2026',
     view:'orders', roles:['BY-ADMIN','BY-BUY'], tags:['orders','troubleshooting'],
     summary:'Where to look before raising a ticket, and what the ticket needs.',
     body:[
      ['Check the pipeline','Open the order. Each fulfilment type has its own stages, and the stalled one is named.'],
      ['Physical items','Carrier and tracking are on the order. A carrier exception is shown as an exception, not as a shipment that is quietly late.'],
      ['Digital and provisioned items','A failed activation shows the reason from the seller’s system rather than a generic failure.'],
      ['Raising it','Raise from the order so the ticket carries the reference. Priority is set by impact, not by who is asking.']]}
  ],
  consumer:[
    {id:'KB-C01', kind:'start', title:'Getting started', mins:2, updated:'20 Jul 2026', view:'home',
     tags:['overview'],
     summary:'What you can buy here and how it reaches you.',
     body:[
      ['One place','Plans, handsets, insurance, security and content, from the operator and from partners, on one account and one bill.'],
      ['How things arrive','A handset ships. A plan or an eSIM activates. Content and security are switched on. The order tells you which and how far along it is.'],
      ['Paying','Card, wallet or on your operator bill where that is available to you.']]},
    {id:'KB-C02', kind:'howto', title:'Compare before you buy', mins:2, updated:'26 Jul 2026',
     view:'browse', tags:['shopping'],
     summary:'Up to three side by side, on the things that differ.',
     body:[
      ['How','Tick compare on a product card. The tray keeps your picks while you keep browsing.'],
      ['Three at a time','A table wide enough to need scrolling stops being a comparison.'],
      ['What the highlight means','It marks the best value in that row only. It is arithmetic on one dimension, not a recommendation — the dimension that matters is yours to choose.']]},
    {id:'KB-C03', kind:'howto', title:'Manage a subscription', mins:2, updated:'24 Jul 2026',
     view:'subs', tags:['subscriptions'],
     summary:'Pause, cancel, restart, or turn auto-renew off across several at once.',
     body:[
      ['Pause versus cancel','Pausing keeps your settings and your place. Cancelling ends it at the end of the paid period — you keep what you have paid for.'],
      ['Auto-renew','Turning it off is reversible and does not cancel anything. You can change it on several subscriptions at once.'],
      ['What it will cost','The projection on this screen is a forecast of your current commitments, not a bill.']]},
    {id:'KB-C04', kind:'fix', title:'A payment failed', mins:2, updated:'26 Jul 2026',
     view:'account', tags:['billing','troubleshooting'],
     summary:'What happens next, and how long you have.',
     body:[
      ['You are told','A failure appears on your account with the amount, the date and the reason.'],
      ['Nothing stops immediately','Service continues while we retry. Nothing is suspended before day fourteen.'],
      ['Expired cards','A retry against an expired card cannot succeed. Update the card rather than waiting for another attempt.'],
      ['If you need time','A promise to pay pauses the reminders until the date you choose.']]},
    {id:'KB-C05', kind:'howto', title:'Write a review', mins:2, updated:'25 Jul 2026',
     view:'orders', tags:['reviews'],
     summary:'Who can review, what is checked, and how long it takes.',
     body:[
      ['Who','Only someone who bought the item on this account.'],
      ['Moderation','Reviews are checked for content, not for sentiment. A negative review is not a reason to reject one, and every rejection reason is recorded against the moderator.'],
      ['Timing','A pending review does not move the rating — otherwise moderation would be pointless.'],
      ['Seller replies','A seller may respond publicly. They cannot edit or remove your review.']]},
    {id:'KB-C06', kind:'policy', title:'Who else can get into this account', mins:2, updated:'26 Jul 2026',
     view:'auth', tags:['security'],
     summary:'Devices, sessions and what to do if one looks wrong.',
     body:[
      ['Your devices','Every device signed in is listed with where and when. An unusual location is flagged.'],
      ['Ending one','Ending a session signs that device out immediately. It does not change your password — if the password is what leaked, change that too.'],
      ['Sharing','People you add to the account can be given a spend cap. What each may do is on the account access screen.']]}
  ]
};

/* Ratings are counted, not invented. An article nobody has rated shows no
   score rather than a flattering default. */
const KB_RATINGS = {};

/* ---------------------------------------------------------- BILL TERMS ---
   The small print that goes on the face of a bill. Kept as data because the
   wording is a commercial and regulatory decision, not a layout one. */
const BILL_ISSUER = {
  name:'Aventa Telecom Services Limited',
  addr:['Aventa House, 26 Bannerghatta Road', 'Bengaluru 560076, Karnataka, India'],
  tax:'GSTIN 29AAECA1234F1Z5', cin:'CIN U64200KA2018PTC112233',
  email:'billing@gmail.com', phone:'+91 80 4000 6000',
  bank:{name:'HDFC Bank, Bengaluru', acct:'50200 0421 88710', ifsc:'HDFC0000512', swift:'HDFCINBB'}
};
const BILL_SMALLPRINT = [
  'Payment is due by the date shown on the face of this bill. Amounts are stated in the billing currency and include tax where indicated.',
  'Late payment may attract interest at 1.5% per month or the maximum permitted by law, whichever is lower, calculated daily from the due date.',
  'Queries must be raised within 30 days of the issue date. Raising a query on a line does not suspend the obligation to pay the balance of the bill.',
  'Recurring charges are billed in advance for the period stated. Usage and one-off charges are billed in arrears.',
  'A part-month arising from an activation, upgrade or cancellation is pro-rated to the day.',
  'Tax is charged at the rate in force on the issue date. Where the marketplace is merchant of record, tax is collected and remitted by the issuer named above.',
  'Where a purchase was made from a partner seller, the contract for that item is with the issuer as merchant of record unless the line states otherwise.',
  'Suspension for non-payment follows the collections schedule and does not occur before day 14 after the due date.',
  'Personal data on this bill is processed under the privacy notice published at aventa.example/privacy and retained for seven years as required by tax law.',
  'This bill is issued electronically and is valid without signature.'
];

/* ==========================================================================
   M25 — DATA DEPTH
   --------------------------------------------------------------------------
   The reconciling core — products, orders, settlements — is left exactly as it
   is, because GMV, category totals and statement net all tie to it and any
   addition there would break the reconciliation the whole build rests on.
   What grows here is the operational surface: the queues, logs, cases and
   records that made screens look sparse.

   Generated from the same seeded generator, so the dataset stays deterministic
   and two people looking at the same screen see the same rows.
   ========================================================================== */
(function deepen(){
  const r = mulberry32(430717);
  const pick = a => a[Math.floor(r()*a.length)];
  const int  = (lo,hi) => lo+Math.floor(r()*(hi-lo+1));
  const money= (lo,hi) => +(lo+r()*(hi-lo)).toFixed(2);
  const day  = () => pick(['18 Jul 2026','19 Jul 2026','20 Jul 2026','21 Jul 2026','22 Jul 2026',
                           '23 Jul 2026','24 Jul 2026','25 Jul 2026']);
  const ago  = () => pick(['12 min ago','40 min ago','2 h ago','5 h ago','9 h ago','Yesterday',
                           '2 d ago','3 d ago','4 d ago','6 d ago']);
  /* slugify lives in the shared layer, which loads after this file. */
  const slug = x => String(x).toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
  const people = {
    operator:['Ananya Krishnan','Lena Fischer','Tomas Novak','Ruben Oyelaran','Farah Al Hashimi','Marek Zielinski','Divya Rao'],
    partner :['Katrin Boehm','Felix Meyer','Ingrid Sandvik','Pavel Horak'],
    buyer   :['Meera Nathan','Rohan Iyer','Deepa Menon','Joseph Okonjo'],
    consumer:['Ananya Krishnan','Priya Raman','Amara Okonkwo','Sanjay Bose','Wei Lin Tan']
  };

  /* ------------------------------------------------------------- tickets --- */
  const tSubj = [
    ['integration','Webhook retries arriving out of order','Order events for the same order land in the wrong sequence when we retry.'],
    ['integration','Sandbox token expires in 60 seconds','The documented window is 15 minutes. Sandbox behaves differently from production.'],
    ['billing','Withholding applied twice on one statement','The July statement deducts withholding on lines that already carried it in June.'],
    ['billing','Invoice shows tax added on a tax-inclusive price','Line 4 looks like tax on tax. Please confirm which figure is the net.'],
    ['catalogue','Listing held for alt text that is present','Every image has alt text but the submission still blocks.'],
    ['catalogue','Category cap reached earlier than expected','We hold 38 live listings and the cap says 40, but the wizard refuses.'],
    ['order','Provisioning stalled at activation','Twelve orders sat at activation overnight with no error returned.'],
    ['order','Handset delivered to the wrong site','Carrier scanned it at the Pune office rather than Bengaluru.'],
    ['account','Cannot add a user with an external domain','SSO is enforced, and the contractor is not in our directory.'],
    ['account','MFA reset needed for a departing admin','They still hold the only passkey on the finance role.'],
    ['inventory','Stock count disagrees with the warehouse','Our count says 210, the WMS says 186 on the same SKU.'],
    ['inventory','SIM batch shows retired but is on the shelf','BAT-2026-04 was marked retired in error.'],
    ['other','Report export times out over 90 days','The CSV never arrives when the range is a full quarter.'],
    ['other','Portal branding reverts after sign-out','Colours reset to default on the next session.']
  ];
  const tStates=['new','open','waiting','escalated','resolved','closed'];
  const roleFor={integration:'OR-SUP',billing:'OR-FIN',catalogue:'OR-CAT',order:'OR-SUP',
                 account:'OR-ADMIN',inventory:'OR-SUP',other:'OR-SUP'};
  for(let i=0;i<26;i++){
    const t=pick(tSubj);
    const ctx=pick(['operator','partner','buyer','consumer']);
    const pri=pick(['P1','P2','P2','P3','P3','P4']);
    const st=pick(tStates);
    const tgt=(TICKET_PRIORITIES.filter(p=>p.id===pri)[0]||{});
    const rt=tgt.resolveHr||tgt.resolveTargetHr||24;
    const fm=tgt.firstMin||tgt.firstTargetMin||120;
    const done=(st==='resolved'||st==='closed');
    const worked=done?int(1,Math.max(2,Math.round(rt*0.8))):int(1,Math.round(rt*1.5));
    const who=pick(people[ctx]||people.operator);
    const agent=pick(people.operator);
    const esc_=(st==='escalated');
    TICKETS.push({
      id:'TKT-'+(6108+i),
      firstTargetMin:fm, resolveTargetHr:rt, workedHr:worked,
      firstBreached:r()<0.22, resolveBreached: !done && worked>rt,
      watchers:[],
      internal: r()<0.4 ? [{who:agent, when:day().slice(0,6)+' '+int(9,18)+':'+String(int(0,59)).padStart(2,'0'),
        text:pick(['Reproduced on the sandbox. Raising with the platform team.',
                   'Third report of this shape in a fortnight - worth a knowledge-base article.',
                   'Waiting on the seller to confirm the endpoint secret was rotated.',
                   'Not a defect: the cap counts paused listings. Explaining rather than changing it.'])}] : [],
      ctx:ctx, cat:t[0], pri:pri, state:st,
      subject:t[1],
      raisedBy:who,
      org: ctx==='partner' ? pick(PARTNERS).name : ctx==='buyer' ? 'Brightline Foods'
           : ctx==='consumer' ? 'Personal account' : 'Aventa Telecom',
      raised: day()+' '+String(int(8,19)).padStart(2,'0')+':'+String(int(0,59)).padStart(2,'0'),
      assignee: st==='new' ? null : agent,
      assigneeRole: st==='new' ? null : roleFor[t[0]]||'OR-SUP',
      ageHr:int(2,180),
      firstReplyMin: st==='new' ? null : int(4,300),
      waitedHr: st==='waiting' ? int(2,60) : 0,
      escalatedTo: esc_ ? pick(['Platform engineering','Settlement desk','Catalogue lead']) : null,
      escalatedAt: esc_ ? day()+' '+int(9,18)+':'+String(int(0,59)).padStart(2,'0') : null,
      ref: r()<0.5 ? pick(ORDERS).id : null,
      thread:[
        {who:who, side:'requester', when:day().slice(0,6)+' '+int(8,12)+':'+String(int(0,59)).padStart(2,'0'), text:t[2]},
        {who:agent, side:'agent', when:day().slice(0,6)+' '+int(12,18)+':'+String(int(0,59)).padStart(2,'0'),
         text:pick(['Thanks - reproducing this now. I will come back within the target.',
                    'I can see the record. The behaviour is expected, and here is why it looks wrong.',
                    'Escalating to the team that owns this. You will be told when it moves.',
                    'Fixed. Please confirm at your end and I will close it.'])}
      ].concat(done?[{who:agent, side:'agent', when:day().slice(0,6)+' '+int(15,19)+':'+String(int(0,59)).padStart(2,'0'),
         text:pick(['Root cause was a stale endpoint secret. Rotated and confirmed by test call.',
                    'Behaviour is correct; the documentation was wrong and has been corrected.',
                    'Adjustment raised on the next settlement run. Statement annotated.',
                    'Carrier reprocessed the delivery. Replacement despatched at our cost.'])}]:[])
    });
  }

  /* -------------------------------------------------------------- reviews --- */
  const rTexts=[
    [5,'Does exactly what it says','Rolled out across three sites in a morning. No surprises on the bill either.'],
    [4,'Solid, one rough edge','Works well. The mobile app is a step behind the web console.'],
    [5,'Support made the difference','Had one provisioning issue and it was fixed inside the hour.'],
    [3,'Fine, not remarkable','Does the job. Priced about right, nothing that made me recommend it.'],
    [2,'Setup took longer than promised','Two days of back and forth on certificates before it activated.'],
    [4,'Good value at this tier','Cheaper than the incumbent for the same coverage.'],
    [5,'Reliable for eight months now','Not one unplanned outage since we switched.'],
    [1,'Did not work with our hardware','Compatibility list said it would. It did not, and the returns process was slow.'],
    [4,'Straightforward billing','One invoice for everything is the main reason we stayed.'],
    [5,'Better than the bundled option','Faster activation and clearer reporting than what came with the plan.'],
    [3,'Reporting is thin','The service is fine but I cannot get the export I need.'],
    [4,'Would buy again','Second site now running on it.']
  ];
  const buyersR=['Cadence Health','Brightline Foods','Harbourpoint Retail','Northwind Logistics','Priya Raman',
                 'Amara Okonkwo','Sanjay Bose','Meridian Foods','Wei Lin Tan','Kestrel Fleet','Orbital Freight'];
  const skus=PRODUCTS.filter(p=>p.status==='live').map(p=>p.id);
  for(let i=0;i<36;i++){
    const t=pick(rTexts);
    const st=r()<0.80?'published':(r()<0.6?'pending':'rejected');
    REVIEWS.push({
      id:'REV-'+(3210+i), sku:pick(skus), stars:t[0], title:t[1], body:t[2],
      author:pick(buyersR), when:day(), state:st,
      response: (st==='published'&&r()<0.3) ? pick([
        'Thank you — the reporting export you mention is on the roadmap for the next quarter.',
        'Sorry about the certificate delay. We have shortened that step since.',
        'Glad it landed well. Do reach out if you add a fourth site.']) : null,
      verified:true, orderRef:pick(ORDERS).id, helpful:int(0,24), flagged:r()<0.06,
      moderatedBy: st==='pending'?null:pick(people.operator),
      moderatedOn: st==='pending'?null:day(),
      rejectReason: st==='rejected'
        ? pick(['Names an individual employee.','Contains a competitor price comparison we cannot verify.',
                'Duplicate of an earlier review from the same order.']) : null
    });
  }
  if(typeof recomputeRatings==='function') recomputeRatings();

  /* ------------------------------------------------------------- disputes --- */
  const dReasons=['Item not as described','Not delivered','Service never activated','Charged twice',
                  'Cancelled but still billed','Faulty on arrival','Wrong quantity shipped'];
  for(let i=0;i<10;i++){
    const o=pick(ORDERS);
    DISPUTES.push({
      id:'DSP-'+(336+i), order:o.id, buyer:o.buyer||pick(buyersR), partner:o.seller,
      v:o.v, reason:pick(dReasons), amount:+(o.gross||money(20,900)).toFixed(2),
      raised:ago(), status:pick(['open','open','evidence','resolved','rejected']),
      sla:pick(['1 of 5 days used','2 of 5 days used','3 of 5 days used','4 of 5 days used','Closed']),
      owner:pick(['Marketplace','Seller','Buyer'])
    });
  }

  /* ------------------------------------------------- catalogue queue -------- */
  const qChecks=[
    ['Content rights evidence attached','low',null],
    ['Type approval missing for two markets','high','No certificate for UAE or Kenya'],
    ['Price below the wholesale floor','high','Sale price is under cost on three variants'],
    ['Alt text missing on two images','medium','Two of six images have no description'],
    ['DPA not countersigned','high','Signed by the seller only'],
    ['Security attestation expired','high','SOC 2 report is 14 months old'],
    ['Returns window shorter than statutory','medium','7 days offered where 14 is required'],
    ['Age rating absent for one market','medium','No rating supplied for India'],
    ['Fulfilment endpoint unreachable','high','Test call returned 502 twice'],
    ['All automated checks passed','low',null]
  ];
  for(let i=0;i<11;i++){
    const p=pick(PRODUCTS.filter(x=>x.partner));
    const c=pick(qChecks);
    LISTING_QUEUE.push({
      id:'LQ-'+(706+i), sku:p.id, name:p.name, partner:p.seller, v:p.v,
      submitted:day(), age:int(1,9)+' days', check:c[0], risk:c[1], issue:c[2],
      price:p.price
    });
  }

  /* --------------------------------------------------- seller queries ------- */
  const qs=[
    ['Type approval evidence','Certificates cover India only. Supply the equivalent for the other markets or withdraw them.'],
    ['Cost price looks wrong','The declared cost is above the sale price on two variants, which cannot be right.'],
    ['Missing datasheet','The listing references a datasheet that is not attached.'],
    ['Clarify the coverage claim','The description says nationwide. Confirm which circles are actually covered.'],
    ['Returns policy conflict','Your terms say 7 days; the category requires 14. Which applies?'],
    ['Confirm the SLA you can hold','The listing commits to 4 hours. Your last quarter averaged 9.'],
    ['Attestation renewal date','When is the replacement SOC 2 expected?']
  ];
  for(let i=0;i<7;i++){
    const p=pick(PRODUCTS.filter(x=>x.partner));
    const q=pick(qs);
    LISTING_QUERIES.push({
      id:'LQ-Q-'+(402+i), sku:p.id, partner:p.seller, subject:q[0],
      asked:day(), due:day(), status:pick(['open','open','answered','overdue']),
      by:pick(people.operator), body:q[1]
    });
  }

  /* ------------------------------------------------------------ shipments --- */
  const carriers=['Bluedart','DHL','Aramex','Delhivery','FedEx'];
  for(let i=0;i<11;i++){
    const o=pick(ORDERS.filter(x=>x.fulfil==='logistics'||x.v==='device'));
    const wh=pick(WAREHOUSES.filter(x=>x.type!=='returns'));
    const buyer=pick(['Brightline Foods','Harbourpoint Retail','Northwind Logistics','Cadence Health',
                      'Meridian Foods','Priya Raman','Amara Okonkwo']);
    const st=pick(['in transit','in transit','delivered','delivered','packed','exception']);
    SHIPMENTS.push({
      id:'SHP-'+(4415+i), order:o?o.id:'ORD-880400',
      po:'PO-'+pick(['BLF','HPR','NWL','CDH','MRF'])+'-'+int(1000,9999),
      wms:'WMS-'+wh.id.slice(3), warehouse:wh.id,
      carrier:pick(carriers), tracking:pick(['BD','DL','AR','DE','FX'])+String(int(100000000,999999999)),
      label:'Generated '+day(), state:st,
      eta:day(), units:int(1,40), weight:(r()*30+0.4).toFixed(1)+' kg',
      fromName:wh.name, fromLines:(wh.lines||[]).slice(),
      seller:(o&&o.seller)||pick(PARTNERS).name, sellerId:(o&&o.partnerId)||null,
      toName:buyer, toContact:pick(['Deepa Menon','Yusuf Rahman','Siti Aminah','Arun Pillai','Rhea Kulkarni']),
      toLines:[pick(['Gate 3, MIDC Chakan Phase II','Unit 9, Peenya Industrial Estate',
                     'Shop 22, Al Wahda Mall','Lot 18, Taman Perindustrian']),
               pick(['Pune 410501, India','Bengaluru 560058, India','Abu Dhabi, UAE','Johor Bahru, Malaysia'])],
      toPhone:'+'+pick(['91 20 ','91 80 ','971 2 ','60 7 '])+String(int(1000000,9999999)),
      incoterm:pick(['DAP','DDP','EXW']), service:pick(['Surface, 2 days','Express, next day','Economy, 5 days']),
      pod: st==='delivered' ? 'Signed on '+day() : null
    });
  }

  /* ------------------------------------------------------ contract prices --- */
  const accts=[['Brightline Foods','ACC-BLF'],['Harbourpoint Retail','ACC-HPR'],
               ['Northwind Logistics','ACC-NWL'],['Cadence Health','ACC-CDH']];
  for(let i=0;i<10;i++){
    const p=pick(PRODUCTS.filter(x=>x.price>40));
    const a=pick(accts);
    const disc=0.72+r()*0.2;
    CONTRACT_PRICES.push({
      id:'CP-'+String(5+i).padStart(2,'0'), sku:p.id, account:a[0], accountId:a[1],
      price:+(p.price*disc).toFixed(2), from:'01 Apr 2026', to:pick(['31 Mar 2027','30 Sep 2026','31 Dec 2026']),
      minQty:pick([10,25,50,100,250]), agreed:pick(people.buyer),
      signed: r()<0.75,
      note:pick(['Negotiated at renewal against a volume commitment.',
                 'Agreed during the tender; countersignature outstanding.',
                 'Matched to the incumbent price to win the migration.',
                 'Three-year term with an annual volume review.'])
    });
  }

  /* -------------------------------------------------------------- dunning --- */
  const dReason=['Card expired','Insufficient funds','Card blocked by issuer','Mandate cancelled',
                 'Bank transfer not received','3-D Secure not completed'];
  for(let i=0;i<9;i++){
    const ctx=pick(['consumer','consumer','buyer','partner']);
    const step=int(1,6);
    /* Which seller's product the money relates to, and whether it was sold
       inside a bundle the operator assembled. The second one decides who
       sets the pacing, so it is recorded on the case rather than inferred. */
    const sel=pick(PARTNERS);
    /* What was actually sold, so the ladder can be resolved from the product
       rather than from the customer type alone. */
    const own=LIVE_PRODUCTS.filter(x=>x.partner===sel.id);
    const prod=own.length?pick(own):pick(LIVE_PRODUCTS);
    const bnd = (ctx!=='partner' && r()<0.35)
      ? pick([['BND-IOT-STARTER','IoT starter bundle'],
              ['BND-FLEET-PRO','Fleet tracking pro'],
              ['BND-SEC-ESS','Security essentials']]) : null;
    DUNNING_CASES.push({
      id:'DUN-'+(205+i), ctx:ctx,
      account: ctx==='buyer'?'Brightline Foods': ctx==='partner'?pick(PARTNERS).name:pick(people.consumer),
      accountId:'ACC-'+String(int(100,999)),
      amount:money(12,4200), invoice:'INV-'+pick(['C','B','P'])+'-'+int(80000,89999),
      failed:day(), reason:pick(dReason), step:step,
      nextAt:day(), attempts:int(1,3), method:pick(['Card ending 4417','Card ending 8802','Direct debit','Bank transfer']),
      state: step>=5?'suspended':step>=4?'restricted':'in dunning',
      promiseToPay: r()<0.2 ? day() : null,
      vertical: prod ? prod.v : 'consumer',
      productCat: prod ? prod.cat : 'Mobile plans',
      sellerId: sel.id, sellerName: sel.name,
      bundleId: bnd ? bnd[0] : null, bundleName: bnd ? bnd[1] : null,
      note:pick(['Card expiry is the most common cause and the easiest to fix.',
                 'Customer contacted us first — flag for a softer tone on the next step.',
                 'Second failure this quarter on the same instrument.',
                 'Finance says the transfer was sent; awaiting the bank reference.'])
    });
  }

  /* -------------------------------------------------------- API consumers --- */
  const cons=[['Kestrel Devices','Seller'],['Nimbus Sensors','Seller'],['Brightline Foods','Buyer'],
              ['Harbourpoint Retail','Buyer'],['ClearVault','Seller'],['Orbital Connect','Seller'],
              ['Meridian Foods','Buyer']];
  cons.forEach((c,i)=>{
    const quota=pick([250000,500000,1000000,2000000]);
    API_CONSUMERS.push({
      id:'AC-'+String(6+i).padStart(2,'0'), name:c[0], kind:c[1], plan:pick(API_PLANS).id,
      apps:int(1,4), calls30d:Math.round(quota*(0.15+r()*1.1)), quota:quota,
      errors:+(r()*2.4).toFixed(1), p95:int(90,860),
      since:pick(['04 Feb 2025','19 Jun 2024','30 Nov 2025','22 Mar 2026']),
      status:pick(['active','active','active','suspended'])
    });
  });

  /* ------------------------------------------------------------- banners ---- */
  const bn=[
    ['home-strip','Refurbished handsets','Certified refurbished, 12-month warranty','From $189 with 24-month trade-in','Shop refurbished','device'],
    ['category','IoT starter bundle',' 50 SIMs, one pooled plan','No connection fee before 30 September','See the bundle','iot'],
    ['home-hero','Managed detection and response','Round-the-clock monitoring from $9.50 a seat','Onboarded in five working days','Talk to security','security'],
    ['home-strip','Family entertainment pack','Three streaming services, one bill','Save 22% against buying separately','Build the pack','content'],
    ['login','Switch and keep your number','Port in and get two months half price','Ends 30 September','See the offer','consumer'],
    ['category','Partner storefronts','Sell to enterprise buyers without building a shop','Listing is free; commission on a sale','Apply to sell','partner'],
    ['home-strip','Backup and recovery','Cloud backup priced per terabyte','No egress fee on restore','Compare tiers','security']
  ];
  bn.forEach((b,i)=>{
    BANNERS.push({
      id:'BN-'+String(10+i).padStart(2,'0'), slot:b[0], name:b[1], headline:b[2], sub:b[3], cta:b[4],
      target:b[5], audience:pick(['Everyone','Signed out only','Returning buyers','Enterprise accounts']),
      from:'01 Jul 2026', to:pick(['31 Aug 2026','30 Sep 2026','31 Dec 2026']),
      weight:int(20,80), state:pick(['live','live','paused','draft']),
      accent:pick(['#0D47A1','#00695C','#4527A0','#BF360C']),
      art:({iot:'coldchain', security:'racklock', content:'night', device:'tradein',
            consumer:'twophones', partner:'storefront'})[b[5]] || 'twophones',
      alt:b[1]+' promotional artwork',
      impressions:int(4000,180000), clicks:int(60,4200), orders:int(2,240), revenue:money(400,68000),
      promo:null, locale:pick(['All','IN','AE','KE','DE']), device:pick(['All','Mobile','Desktop'])
    });
  });

  /* ----------------------------------------------------------- deliveries --- */
  const rules=Object.keys(NOTIF_TEMPLATES||{});
  for(let i=0;i<45;i++){
    const chan=pick(['SMS','Email','Email','Push','WhatsApp','In-app']);
    const prov=CHANNEL_PROVIDERS.filter(p=>p.chan===chan)[0];
    const hard=pick(['invalid-number','unsubscribed','blocked','template-rejected']);
    const soft=pick(['handset-off','quota','mailbox-full']);
    const state=pick(['delivered','delivered','delivered','delivered','sent','read','failed','expired','unknown']);
    const attempts= state==='failed'?int(1,3): state==='expired'?3:1;
    DELIVERIES.push({
      id:'MSG-'+(90160+i), ctx:pick(['operator','partner','buyer','consumer']),
      rule: rules.length?pick(rules):'NR-O1', chan:chan,
      to: chan==='Email' ? pick(['ops@6dtech.co.in','k.boehm@gmail.com','finance@gmail.com','ananya.k@gmail.com'])
        : chan==='Push' ? 'Aventa app · '+pick(['iPhone 15','Pixel 9','Galaxy S24'])
        : '+'+pick(['91 98450 ','49 176 55','353 86 22','254 712 0'])+String(int(10000,99999)),
      state:state, attempts:attempts,
      code: state==='failed'?hard: state==='expired'?soft:null,
      when: pick(['Today 09:'+int(10,59),'Today 08:'+int(10,59),'Yesterday '+int(10,22)+':'+int(10,59),
                  day()+' '+int(8,20)+':'+int(10,59)]),
      provider: prov?prov.name:'Platform',
      cost: prov? +(prov.cost*attempts).toFixed(4) : 0,
      segments: chan==='SMS'?int(1,2):null
    });
  }

  /* ---------------------------------------------------------------- ICCIDs -- */
  (function(){
    const base=ICCIDS.length;
    for(let i=0;i<34;i++){
      const esim=r()<0.55;
      const st=pick(['available','available','reserved','assigned','activated','activated','suspended','retired']);
      const ord=(st==='assigned'||st==='activated') ? pick(ORDERS.filter(o=>o.v==='iot'||o.v==='consumer')) : null;
      ICCIDS.push({
        iccid:'8991'+String(4020000000+ (base+i)*6151).padStart(15,'0').slice(0,15),
        imsi:'4048610002'+String(20000+base+i).slice(-5),
        msisdn: st==='available'?null:'+91 88000 '+String(20000+(base+i)*7).slice(0,5),
        type: esim?'eSIM':'Physical',
        eid: esim ? '89049032'+String(2000000000000000+(base+i)*97531).slice(0,24) : null,
        profile: esim ? (st==='activated'?'enabled': st==='assigned'?'installed': st==='reserved'?'released':null) : null,
        state:st, batch:pick(SIM_POOL.batches).id, range: esim?'RNG-02':'RNG-01',
        order: ord?ord.id:null, account: ord?(ord.buyer||ord.customer||null):null,
        system: esim?'NMS-SIM':'NMS-CORE',
        updated: ago(), sync:'in-sync'
      });
    }
  })();

  /* ------------------------------------------------------------ bulk jobs --- */
  const setsFor={operator:['bulk-listing','bulk-partner','bulk-iccid','bulk-user','bulk-banner'],
                 partner:['bulk-mylisting','bulk-stock'], buyer:['bulk-buyer-user'], consumer:['bulk-sub']};
  for(let i=0;i<10;i++){
    const ctx=pick(['operator','operator','partner','buyer']);
    const rows=int(6,420), rej=r()<0.45?int(1,Math.max(1,Math.round(rows*0.06))):0;
    BULK_JOBS.push({
      id:'BLK-'+(4380+i), ctx:ctx, set:pick(setsFor[ctx]),
      file: r()<0.7 ? pick(['q3-reprice.csv','joiners-july.csv','stock-count-blr.csv','tier-review.csv',
                            'campaign-switchover.csv','supplier-increase.csv']) : '—',
      when:day()+' '+int(8,18)+':'+int(10,59), by:pick(people[ctx]||people.operator),
      rows:rows, applied:rows-rej, rejected:rej,
      mode: r()<0.7?'CSV':'Common update',
      note: rej? rej+' row'+(rej===1?'':'s')+' rejected against the rules and re-sent the same day.'
                : 'Applied without rejections.'
    });
  }

  /* ------------------------------------------------------------ audit log --- */
  (function(){
    const acts=Object.keys(AUDIT_ACTIONS);
    ['operator','partner','buyer','consumer'].forEach(ctx=>{
      const scope=AUDIT_SCOPE[ctx]||{};
      const roles=Object.keys(scope);
      /* Only categories that can legitimately occur in this context. A
         consumer's log containing a settlement approval is not thin data, it
         is wrong data — and it would make the role-scoping screen lie. */
      const allowed={};
      roles.forEach(rid=>{ (scope[rid].cats||[]).forEach(c=>{ allowed[c]=1; }); });
      const okActs=acts.filter(a=>allowed[AUDIT_ACTIONS[a].cat]);
      if(!okActs.length) return;
      const n = ctx==='operator'?46: ctx==='consumer'?20:30;
      for(let i=0;i<n;i++){
        const a=pick(okActs), meta=AUDIT_ACTIONS[a];
        (AUDIT_LOG[ctx]=AUDIT_LOG[ctx]||[]).push({
          id:'AUD-'+ctx.slice(0,2).toUpperCase()+'-'+(9200+i),
          when:day()+' '+String(int(7,20)).padStart(2,'0')+':'+String(int(0,59)).padStart(2,'0'),
          actor:pick(people[ctx]||people.operator),
          role: roles.length?pick(roles):'—',
          action:a, label:meta.label, cat:meta.cat, sev:meta.sev, pii:!!meta.pii,
          object:pick(['Nimbus Sensors','SKU-4001','Jul 2026 run','Katrin Boehm','BN-03','TKT-6102',
                       'Brightline Foods','ORD-880451','RNG-02','AP-CAT']),
          detail:pick(['Changed through the console.','Applied after a second approval.',
                       'Automatic, on the schedule.','Corrected after a reconciliation run.',
                       'Requested by the account owner.']),
          before:null, after:null,
          ip:'10.'+int(10,60)+'.'+int(1,250)+'.'+int(1,250),
          ua:pick(['Chrome 141 · Windows','Safari 18 · macOS','Firefox 130 · Linux','Chrome 141 · Android']),
          result:pick(['ok','ok','ok','denied'])
        });
      }
      AUDIT_LOG[ctx].sort((x,y)=> (y.when||'').localeCompare(x.when||''));
    });
  })();

  /* ------------------------------------------------- notification history --- */
  ['operator','partner','buyer','consumer'].forEach(ctx=>{
    const rules=(NOTIF_RULES[ctx]||[]);
    for(let i=0;i<14;i++){
      if(!rules.length) break;
      const rr=pick(rules);
      (NOTIF_LOG[ctx]=NOTIF_LOG[ctx]||[]).push({
        when:ago(), rule:rr.name,
        to:pick(['Catalogue reviewers (2)','Support and admins (4)','Settlement approvers (1)',
                 'Onboarding desk (2)','Felix Meyer','Meera Nathan','You']),
        chan:pick(['In-app','Email','In-app, Email','Email, SMS','In-app, Email, SMS','WhatsApp']),
        state:pick(['delivered','delivered','delivered','delivered','bounced','suppressed'])
      });
    }
  });

  /* ------------------------------------------------------- stock movements -- */
  (function(){
    const skus=Object.keys(INVENTORY);
    if(!skus.length) return;
    for(let i=0;i<40;i++){
      const k=pick(skus);
      STOCK_MOVES.push({
        id:'MOV-'+(9000+i), sku:k, name:(INVENTORY[k]||{}).name||k,
        kind:pick(['receipt','dispatch','dispatch','reservation','release','adjustment','count']),
        qty:int(1,60), when:day()+' '+int(8,19)+':'+String(int(0,59)).padStart(2,'0'),
        by:pick(people.operator.concat(people.partner)),
        why:pick(['Purchase order received','Order dispatched','Held for a basket','Hold expired',
                  'Corrected to the physical count','Cycle count','Damaged in transit, written off'])
      });
    }
  })();

})();

/* ==========================================================================
   M27 — PARTNER API REGISTRY (operator side)
   --------------------------------------------------------------------------
   The seller registers its endpoints in its own console. The operator has to
   see all of them at once: which partners will hear about an order, which
   will not, which are failing, and which required events have nowhere to go.

   An unhandled required event is not queued and not retried later. It simply
   does not arrive — which is why the gap has to be visible from here rather
   than discovered when a customer complains.
   ========================================================================== */

const PARTNER_ENDPOINTS = [];
(function seedPartnerEndpoints(){
  const r = mulberry32(556677);
  const pick = a => a[Math.floor(r()*a.length)];
  const int  = (lo,hi) => lo+Math.floor(r()*(hi-lo+1));

  /* Which events a seller needs follows from how it fulfils, not from taste. */
  const modelFor = v => v==='device' ? 'logistics'
                     : v==='iot'     ? 'provisioning'
                     : v==='content' ? 'digital'
                     : v==='security'? 'seat'
                     : 'activation';

  const host = name => name.toLowerCase().replace(/[^a-z0-9]+/g,'')+'.example';

  PARTNERS.forEach((p,pi)=>{
    if(p.status==='onboarding' && r()<0.5) return;          /* not yet integrated */
    const models = (p.verticals||[]).map(modelFor);
    const need = API_EVENTS.filter(e=>e.required && e.models.some(m=>models.indexOf(m)>-1));
    /* Most partners cover their required events. A few do not, deliberately. */
    const gap = r()<0.28;
    const covered = gap ? need.slice(0, Math.max(1,need.length-int(1,2))) : need;
    const extras  = API_EVENTS.filter(e=>!e.required && r()<0.28);

    const groups = {};
    covered.concat(extras).forEach(e=>{ (groups[e.group]=groups[e.group]||[]).push(e.id); });

    Object.keys(groups).forEach((g,gi)=>{
      const failing = (p.id==='PTR-1003' && g==='Order') ? true : r()<0.12;
      const prod = p.status==='live';
      PARTNER_ENDPOINTS.push({
        id:'PEP-'+String(101+PARTNER_ENDPOINTS.length),
        partnerId:p.id, partner:p.name,
        name:g==='Order'?'Order and fulfilment'
            :g==='Subscription'?'Subscription lifecycle'
            :g==='Catalogue'?'Catalogue sync'
            :g==='Finance'?'Finance notifications':'Support notifications',
        url:'https://'+(prod?'api':'sandbox')+'.'+host(p.name)+'/marketplace/'+g.toLowerCase(),
        method:'POST',
        events:groups[g],
        auth:pick(['OAuth 2.0 client credentials','HMAC signature','mTLS','API key header']),
        retry:pick(['3 attempts, exponential backoff','5 attempts, exponential backoff']),
        timeoutMs:pick([3000,5000,8000]),
        env: prod?'Production':'Sandbox',
        enabled: !(p.status==='suspended'),
        health: failing?'failing':(r()<0.14?'degraded':'healthy'),
        lastCall: pick(['4 min ago','18 min ago','1 h ago','3 h ago','Yesterday','2 d ago']),
        successRate: failing?int(28,62):(r()<0.14?int(86,96):int(97,100)),
        p95: int(120,1400),
        registered: pick(['02 Mar 2024','19 Apr 2024','11 Sep 2025','07 Feb 2026','21 Jun 2026']),
        verifiedBy: pick(['Tomas Novak','Lena Fischer','Ananya Krishnan']),
        note: failing ? 'Returning HTTP 500 on retry. Orders are not being acknowledged.'
            : (gi===0 && gap) ? 'Registered before the subscription events existed; never extended.' : null
      });
    });
    void pi;
  });
})();

/* What the marketplace does when an endpoint will not answer. Policy, not
   per-partner configuration, so a failing integration cannot negotiate. */
const CALLBACK_POLICY = {
  attempts:5, backoff:'1 min, 5 min, 30 min, 2 h, 6 h',
  unhealthyAfter:'3 consecutive failures',
  suspendAfter:'24 hours unhealthy on a required event',
  onSuspend:'Orders route to manual fulfilment and the seller is told. Listings stay live.',
  never:'A required event that has no endpoint at all is not queued and not retried later. It does not arrive.',
  signature:'Every call is signed. The seller verifies the signature over the raw body before trusting it.'
};

/* Calls the marketplace has made to partners. The operator's evidence when a
   seller says they were never told. */
const CALLBACK_LOG = [];
(function seedCallbacks(){
  const r = mulberry32(778811);
  const pick = a => a[Math.floor(r()*a.length)];
  const int  = (lo,hi) => lo+Math.floor(r()*(hi-lo+1));
  for(let i=0;i<48;i++){
    const ep = PARTNER_ENDPOINTS[Math.floor(r()*PARTNER_ENDPOINTS.length)];
    if(!ep) break;
    const bad = ep.health==='failing' ? r()<0.62 : r()<0.08;
    const attempts = bad?int(2,5):1;
    CALLBACK_LOG.push({
      id:'CB-'+(70120+i),
      endpoint:ep.id, partner:ep.partner, partnerId:ep.partnerId,
      event:pick(ep.events), ref:'ORD-'+int(880400,883000),
      when: pick(['Today 09:'+int(10,59),'Today 08:'+int(10,59),'Yesterday '+int(9,22)+':'+int(10,59),
                  '24 Jul '+int(9,20)+':'+int(10,59),'23 Jul '+int(9,20)+':'+int(10,59)]),
      attempts:attempts,
      status: bad ? pick(['failed','failed','timed out']) : 'acknowledged',
      code: bad ? pick([500,502,503,408,401]) : 200,
      ms: bad ? int(3000,9000) : int(90,1200),
      outcome: bad ? pick(['Routed to manual fulfilment.','Retrying — 2 attempts left.',
                           'Seller notified; endpoint marked unhealthy.'])
                   : 'Acknowledged by the seller.'
    });
  }
})();

/* ==========================================================================
   M30 — API VERSIONS AND SUBSCRIPTIONS
   --------------------------------------------------------------------------
   A published API is a contract. Two things follow, and both were missing:

   · It has a version history, and a breaking change is a new major version
     rather than an edit to the one people already call.
   · Somebody is on the other end of it. Which consumer holds which version,
     in which environment, with which scopes, is the question you have to
     answer before you can deprecate anything.
   ========================================================================== */

const API_VER_STATES = [
  {id:'current',    label:'Current',    note:'What a new integration should build against.'},
  {id:'supported',  label:'Supported',  note:'Still fully supported. No new features land here.'},
  {id:'deprecated', label:'Deprecated', note:'Works, but has a sunset date. Consumers are being moved off.'},
  {id:'sunset',     label:'Sunset',     note:'Withdrawn. Calls are refused with a pointer to the successor.'}
];

const API_VERSIONS = {};
(function seedVersions(){
  const V = (v,st,rel,breaking,changes,sunset) =>
    ({version:v, status:st, released:rel, breaking:!!breaking, changes:changes, sunset:sunset||null});

  API_VERSIONS['AP-BCAT'] = [
    V('v1','current','06 May 2026',false,
      ['First release. Catalogue read with contract pricing resolved per account.',
       'Entitlement filtering: an account never sees a category it is not permitted to buy.'])
  ];
  API_VERSIONS['AP-BORD'] = [
    V('v1','current','06 May 2026',false,
      ['First release. Create a requisition, read its approval state, read fulfilment progress.',
       'An order above the account threshold returns 202 with an approval reference, not 201. '+
       'Treating that as a failure is the most common integration mistake.'])
  ];
  API_VERSIONS['AP-BFIN'] = [
    V('v1','current','06 May 2026',false,
      ['First release. Invoices, credit notes and remittance detail.',
       'Line detail follows the cost-centre breakdown configured on the billing screen.'])
  ];
  API_VERSIONS['AP-ADJ'] = [
    V('v1','current','14 Apr 2026',false,
      ['First release. Read credit and debit notes, dispute one, read and decide refund requests.',
       'Decisions are idempotent on the request id, so a retried approval never refunds twice.',
       'A decline without a reason is rejected, exactly as it is in the console.'])
  ];
  API_VERSIONS['AP-CAT'] = [
    V('v1','deprecated','02 Mar 2024',false,
      ['First release. Offerings, prices and availability, read only.'],'31 Dec 2026'),
    V('v2','current','11 Sep 2025',true,
      ['Writes added, so a seller can maintain listings through the API.',
       'BREAKING: price moved from a scalar to a {amount, currency} object.',
       'Media collection added with alt text as a required field.'])
  ];
  API_VERSIONS['AP-ORD'] = [
    V('v1','sunset','02 Mar 2024',false,
      ['First release.'],'30 Jun 2026'),
    V('v2','current','19 Apr 2025',true,
      ['BREAKING: idempotency key is now required on every write.',
       'Fulfilment progress can be reported incrementally rather than once.',
       'Cancellation reason codes added.'])
  ];
  API_VERSIONS['AP-SUB'] = [
    V('v1','current','07 Feb 2026',false,
      ['First release. Read state; post renewals, suspensions, resumptions and cancellations.'])
  ];
  API_VERSIONS['AP-INV'] = [
    V('v1','current','21 Jun 2026',false,
      ['First release. Levels and reservations.'])
  ];
  API_VERSIONS['AP-SET'] = [
    V('v1','current','02 Mar 2024',false,
      ['First release. Statements, payouts and deduction lines.'])
  ];
  API_VERSIONS['AP-PTY'] = [
    V('v1','current','30 Nov 2025',false,
      ['Beta. The address model is expected to change once DPDP guidance lands.'])
  ];
  API_VERSIONS['AP-EVT'] = [
    V('v1','current','21 Jun 2026',false,
      ['Preview. Delivery is at-least-once, so handlers must be idempotent.'])
  ];
})();

/* Who subscribes to what. One row per consumer per API, because a consumer
   can be on v1 of one API and v2 of another and usually is. */
const API_SUBSCRIPTIONS = [];
(function seedSubs(){
  const r = mulberry32(313771);
  const pick = a => a[Math.floor(r()*a.length)];
  const int  = (lo,hi) => lo+Math.floor(r()*(hi-lo+1));
  API_CONSUMERS.forEach(c=>{
    const tier = APLMAP[c.plan] || API_TIERS[0];
    (tier.products||[]).forEach(apid=>{
      if(r()<0.28) return;                        /* entitled, not using it */
      const vers = API_VERSIONS[apid]||[];
      const live = vers.filter(v=>v.status!=='sunset');
      if(!live.length) return;
      /* Most consumers are current. Some are not, which is the point. */
      const v = r()<0.72 ? (live.filter(x=>x.status==='current')[0]||live[live.length-1])
                         : pick(live);
      API_SUBSCRIPTIONS.push({
        id:'AS-'+String(100+API_SUBSCRIPTIONS.length),
        consumer:c.id, consumerName:c.name, kind:c.kind,
        api:apid, version:v.version, env:tier.env,
        scopes:(APIPMAP[apid]||{scopes:[]}).scopes.filter(()=>r()<0.85),
        since:pick(['12 Sep 2024','04 Feb 2025','19 Nov 2025','02 Mar 2026','21 Jun 2026']),
        calls30d:int(400, Math.max(1000, Math.round(c.calls30d/3))),
        lastCall:pick(['6 min ago','2 h ago','Yesterday','3 d ago'])
      });
    });
  });
})();

/* ==========================================================================
   M31 — BILL TEMPLATES
   --------------------------------------------------------------------------
   A bill is the most-read document the marketplace produces, and the only one
   many customers ever see. It was hard-coded. It is now a template: a named
   set of sections, an accent, a terms set and an advertising slot, assigned by
   audience and overridable per partner.

   Sections are switchable because the audiences genuinely differ. A consumer
   bill needs a payment slip and an advert; a self-billing invoice to a seller
   needs neither and would look absurd carrying them.
   ========================================================================== */

const BILL_SECTIONS = [
  {id:'masthead',  label:'Masthead and logos',       note:'Issuing operator and platform marks.', locked:true},
  {id:'parties',   label:'Billed to and bill from',  note:'Both parties, with address and contact.', locked:true},
  {id:'hero',      label:'Amount due panel',         note:'The figure, large, near the top.'},
  {id:'subs',      label:'Subscriptions and recurring', note:'Itemised by service, seller, quantity and rate.'},
  {id:'usage',     label:'Usage and one-off charges',note:'Anything billed in arrears.'},
  {id:'credits',   label:'Credits and adjustments',  note:'Shown even when nil, so nobody wonders.'},
  {id:'tax',       label:'Taxation breakdown',       note:'Component, rate, taxable base and tax.', locked:true},
  {id:'summary',   label:'Summary and total',        note:'Reconciles every block above.', locked:true},
  {id:'payments',  label:'Payments received',        note:'What has already been paid this period.'},
  {id:'howtopay',  label:'How to pay',               note:'Bank detail and the reference to quote.'},
  {id:'support',   label:'Support and contact',      note:'Who to call, and by when a query must be raised.'},
  {id:'advert',    label:'Advertisement',            note:'One relevant offer. Never on a dunning or final notice.'},
  {id:'terms',     label:'Terms and conditions',     note:'Numbered, two columns.'},
  {id:'slip',      label:'Payment slip',             note:'Detachable, below a tear line.'}
];

/* Provider support. On the bill because a bill is where people look when
   something is wrong with a bill. */
const BILL_SUPPORT = {
  phone:'+91 80 4000 6000', hours:'Mon to Sat, 09:00–20:00 IST',
  email:'billing@gmail.com', portal:'aventa.example/help',
  disputeWindow:'30 days from the issue date',
  note:'Raising a query on one line does not suspend the obligation to pay the rest of the bill.',
  escalation:'Unresolved after 10 working days: billing.escalations@gmail.com'
};

const BILL_TEMPLATES = [
  {id:'BT-CON', name:'Consumer standard', audience:'consumer', accent:'#0D47A1',
   docTitle:'Your monthly bill', system:true,
   sections:['masthead','parties','hero','subs','usage','credits','tax','summary','payments',
             'howtopay','support','advert','terms','slip'],
   note:'The full retail bill. Carries the advert and the payment slip.'},
  {id:'BT-ENT', name:'Enterprise consolidated', audience:'enterprise', accent:'#1B5E20',
   docTitle:'Consolidated bill', system:true,
   sections:['masthead','parties','hero','subs','usage','credits','tax','summary','payments',
             'howtopay','support','terms','slip'],
   note:'One invoice across every seller. No advert — a procurement team did not ask for one.'},
  {id:'BT-PTR', name:'Seller self-billing', audience:'partner', accent:'#4527A0',
   docTitle:'Self-billing invoice', system:true,
   sections:['masthead','parties','hero','usage','credits','tax','summary','support','terms'],
   note:'Raised by the marketplace on the seller’s behalf. No payment slip: we pay them, not the reverse.'},
  {id:'BT-MIN', name:'Compact — totals only', audience:'any', accent:'#37474F',
   docTitle:'Bill', system:false,
   sections:['masthead','parties','hero','tax','summary','howtopay','support'],
   note:'One page. For accounts that reconcile from the data file and want the document short.'},
  {id:'BT-REG', name:'Regulator format (India)', audience:'any', accent:'#B71C1C',
   docTitle:'Tax invoice', system:false,
   sections:['masthead','parties','hero','subs','usage','credits','tax','summary','payments',
             'howtopay','support','terms'],
   note:'Tax invoice wording, no advertising, every charge itemised. Used where the regulator requires it.'}
];
/* Document formatting belongs to the template, not to a separate object.
   Two screens each holding half the answer is how a numbering pattern and a
   document title end up disagreeing on the same bill. */
const BILL_FORMAT_DEFAULTS = {
  numbering:'INV-{YYYY}-{SEQ}', nextSeq:1001, dateFormat:'DD MMM YYYY',
  currency:'USD', taxLabel:'GST / VAT', rounding:'Half up, 2 decimal places',
  language:'English', logo:true,
  remittance:'Paid by bank transfer to the account on file. Quote the document reference.',
  footer:'Issued by Aventa Telecom. Queries within 30 days of the issue date.'
};
BILL_TEMPLATES.forEach(t=>{
  Object.keys(BILL_FORMAT_DEFAULTS).forEach(k=>{ if(t[k]===undefined) t[k]=BILL_FORMAT_DEFAULTS[k]; });
});
const BTMAP={}; BILL_TEMPLATES.forEach(t=>BTMAP[t.id]=t);
/* Sensible per-template overrides. */
Object.assign(BTMAP['BT-CON'], {numbering:'BILL-{YYYY}-{SEQ}', nextSeq:88214, taxLabel:'GST',
  remittance:'Pay online, by card on file, or by bank transfer quoting the bill number.'});
Object.assign(BTMAP['BT-ENT'], {numbering:'INV-{YYYY}-{SEQ}', nextSeq:715, taxLabel:'VAT / GST',
  remittance:'Payable by bank transfer within the agreed terms. Quote the invoice number.'});
Object.assign(BTMAP['BT-PTR'], {numbering:'SB-{YYYY}-{PARTNER}-{SEQ}', nextSeq:1042, taxLabel:'GST / VAT',
  remittance:'Self-billing agreement in place; the seller does not raise an invoice.'});
Object.assign(BTMAP['BT-REG'], {numbering:'TI-{YYYY}-{SEQ}', nextSeq:401, taxLabel:'GST',
  language:'English and Hindi'});

/* Which template each audience gets, and any per-partner override. */
const BILL_TEMPLATE_ASSIGN = {
  consumer:'BT-CON', enterprise:'BT-ENT', partner:'BT-PTR',
  overrides:{ 'PTR-1003':'BT-REG' }
};

/* Billing identity for each counterparty. A bill without a registered address
   and a named contact is not a document anybody's finance team can process. */
const BILL_PARTIES = {
  consumer:{
    name:'Ananya Krishnan', lines:['Flat 14B, Prestige Elms','Bengaluru 560008, Karnataka'],
    contact:'ananya.k@gmail.com', phone:'+91 98860 41120', ref:'AV-4471902', tax:null},
  enterprise:{
    name:'Brightline Foods Limited', lines:['Finance Shared Services','12 Harcourt Street','Dublin D02 XY45, Ireland'],
    contact:'Meera Nathan · accounts.payable@gmail.com', phone:'+353 1 486 2200',
    ref:'ACC-BLF-0041', tax:'VAT IE6389047T'},
  partner:{
    name:'Sentinel Cyber GmbH', lines:['Landsberger Allee 104','10369 Berlin, Germany'],
    contact:'Priya Sundar · finance@gmail.com', phone:'+49 30 5557 2200',
    ref:'PTR-1003', tax:'USt-IdNr DE318442901'}
};

/* The consumer's own bill history. */
const MY_BILLS = [
  {id:'BILL-2026-07', period:'July 2026',     issued:'01 Aug 2026', due:'15 Aug 2026', oneoff:129.00, status:'open'},
  {id:'BILL-2026-06', period:'June 2026',     issued:'01 Jul 2026', due:'15 Jul 2026', oneoff:0,      status:'paid'},
  {id:'BILL-2026-05', period:'May 2026',      issued:'01 Jun 2026', due:'15 Jun 2026', oneoff:349.00, status:'paid'},
  {id:'BILL-2026-04', period:'April 2026',    issued:'01 May 2026', due:'15 May 2026', oneoff:0,      status:'paid'},
  {id:'BILL-2026-03', period:'March 2026',    issued:'01 Apr 2026', due:'15 Apr 2026', oneoff:24.00,  status:'paid'}
];

/* ==========================================================================
   M32 — DUNNING LADDERS PER CUSTOMER TYPE
   --------------------------------------------------------------------------
   One ladder for every account was wrong. A consumer owing forty dollars on an
   expired card and an enterprise owing fourteen thousand under a signed
   contract are not the same collections problem, and chasing them the same way
   loses the first to churn and insults the second.

   A ladder is selected by customer type and, where it matters, by value band.
   Steps are ordered by day; the engine reads the ladder, so changing one
   changes behaviour rather than documentation.
   ========================================================================== */

/* Channels are managed, not hard-coded. A dunning step picks from whatever is
   enabled, so switching a channel off removes it everywhere at once rather
   than leaving a ladder pointing at something the platform no longer sends. */
const CHANNELS = [
  {id:'silent',  label:'Silent',            kind:'none',      enabled:true,  system:true,  transport:null,
   note:'No contact. Used for a background retry — a customer does not need to be told we tried.'},
  {id:'inapp',   label:'In-app',            kind:'digital',   enabled:true,  system:true,  transport:'In-app',
   note:'Seen only when they next sign in, so never the only channel on a step that matters.'},
  {id:'email',   label:'Email',             kind:'digital',   enabled:true,  system:true,  transport:'Email',
   note:'The record channel. Cheap, evidenced, and ignorable.'},
  {id:'push',    label:'Push',              kind:'digital',   enabled:true,  system:false, transport:'Push',
   note:'No true delivery receipt. Confirms acceptance, not that anybody saw it.'},
  {id:'sms',     label:'SMS',               kind:'telecom',   enabled:true,  system:false, transport:'SMS',
   note:'Read quickly and costs real money. Reserve it for steps that need reading.'},
  {id:'whatsapp',label:'WhatsApp',          kind:'telecom',   enabled:true,  system:false, transport:'WhatsApp',
   note:'Template approval required before a new message can be sent.'},
  {id:'call',    label:'Outbound call',     kind:'human',     enabled:true,  system:false, transport:null,
   note:'Expensive and effective. Worth it above a threshold, wasteful below one.'},
  {id:'manager', label:'Account manager',   kind:'human',     enabled:true,  system:false, transport:null,
   note:'A named person who already knows the account. Only exists for contracted customers.'},
  {id:'letter',  label:'Letter',            kind:'physical',  enabled:true,  system:false, transport:null,
   note:'Slow, and in several jurisdictions the only form that counts as formal notice.'},
  {id:'voicebot',label:'Automated voice',   kind:'telecom',   enabled:false, system:false, transport:null,
   note:'Disabled. Reads as a scam call to most people and damages more than it recovers.'}
];
const CHMAP={}; CHANNELS.forEach(c=>CHMAP[c.id]=c);
const CHANNEL_KINDS = [
  {id:'digital', label:'Digital',  note:'Sent by the platform at effectively no marginal cost.'},
  {id:'telecom', label:'Telecom',  note:'Carried by a provider and billed per message. Cost is real.'},
  {id:'human',   label:'Human',    note:'Consumes somebody\u2019s time. The most expensive thing we can spend.'},
  {id:'physical',label:'Physical', note:'Printed and posted. Days of lead time, and the only formal notice in some jurisdictions.'},
  {id:'none',    label:'No contact',note:'A step that happens without telling anybody.'}
];
const DUN_ACTIONS = [
  {id:'retry',     label:'Retry the payment',       terminal:false, service:'Unaffected'},
  {id:'notify',    label:'Tell the customer',       terminal:false, service:'Unaffected'},
  {id:'remind',    label:'Retry, then remind',      terminal:false, service:'Unaffected'},
  {id:'final',     label:'Final notice',            terminal:false, service:'Unaffected'},
  {id:'manager',   label:'Account manager contacts them', terminal:false, service:'Unaffected'},
  {id:'restrict',  label:'Restrict new purchases',  terminal:false, service:'Existing services keep running'},
  {id:'suspend',   label:'Suspend the service',     terminal:false, service:'Suspended, data retained 30 days'},
  {id:'legal',     label:'Refer to collections',    terminal:true,  service:'Suspended'},
  {id:'terminate', label:'Terminate and write off', terminal:true,  service:'Terminated'}
];
const DUN_SEGMENTS = [
  {id:'consumer',   label:'Consumer',          note:'Retail accounts. Small balances, high churn sensitivity.'},
  {id:'enterprise', label:'Enterprise buyer',  note:'Contracted accounts with a named contact and a purchase order.'},
  {id:'partner',    label:'Seller',            note:'Owes the marketplace commission and fees.'},
  {id:'smb',        label:'Small business',    note:'Between the two — card on file, but a business relationship.'}
];

/* Ladders. Ordered by day within each. */
const DUNNING_LADDERS = [
  {id:'DL-CON', name:'Consumer standard', segment:'consumer', minAmount:0, maxAmount:null,
   status:'active', system:true, owner:'operator', ownerId:null, scope:'segment', scopeId:null,
   why:'Small balances recovered mostly by fixing a card. Service is protected because involuntary churn '+
       'costs more than the receivable.',
   steps:[
     {at:0,  action:'retry',     channels:['silent']},
     {at:1,  action:'notify',    channels:['email','push']},
     {at:3,  action:'remind',    channels:['email','sms']},
     {at:7,  action:'final',     channels:['email','sms']},
     {at:10, action:'restrict',  channels:['inapp','email']},
     {at:14, action:'suspend',   channels:['email','sms']},
     {at:30, action:'terminate', channels:['email','letter']}
   ]},
  {id:'DL-ENT', name:'Enterprise contracted', segment:'enterprise', minAmount:0, maxAmount:null,
   status:'active', system:true, owner:'operator', ownerId:null, scope:'segment', scopeId:null,
   why:'A missed invoice on a contracted account is usually a purchase-order problem, not a refusal to pay. '+
       'Suspending an enterprise service over an accounts-payable delay damages a relationship worth far more '+
       'than the invoice.',
   steps:[
     {at:0,  action:'notify',    channels:['email']},
     {at:5,  action:'remind',    channels:['email']},
     {at:14, action:'manager',   channels:['manager','call']},
     {at:30, action:'final',     channels:['email','sms','call']},
     {at:45, action:'restrict',  channels:['email','manager']},
     {at:60, action:'suspend',   channels:['letter','email']},
     {at:90, action:'legal',     channels:['letter']}
   ]},
  {id:'DL-SMB', name:'Small business', segment:'smb', minAmount:0, maxAmount:null,
   status:'active', system:true, owner:'operator', ownerId:null, scope:'segment', scopeId:null,
   why:'A card on file like a consumer, a business cash-flow cycle like an enterprise. Paced between the two.',
   steps:[
     {at:0,  action:'retry',     channels:['silent']},
     {at:2,  action:'notify',    channels:['email']},
     {at:7,  action:'remind',    channels:['email','sms']},
     {at:14, action:'final',     channels:['email','sms']},
     {at:21, action:'restrict',  channels:['inapp','email']},
     {at:30, action:'suspend',   channels:['email','sms']},
     {at:60, action:'legal',     channels:['letter']}
   ]},
  {id:'DL-PTR', name:'Seller owing the marketplace', segment:'partner', minAmount:0, maxAmount:null,
   status:'active', system:true, owner:'operator', ownerId:null, scope:'segment', scopeId:null,
   why:'A seller in debt is still fulfilling orders for buyers. Withholding settlement recovers the money '+
       'without taking their listings down and stranding a customer mid-order.',
   steps:[
     {at:0,  action:'notify',    channels:['email']},
     {at:7,  action:'remind',    channels:['email']},
     {at:14, action:'manager',   channels:['manager','call']},
     {at:21, action:'final',     channels:['email','sms']},
     {at:30, action:'restrict',  channels:['email','manager']},
     {at:60, action:'legal',     channels:['letter']}
   ]},
  {id:'DL-HIGH', name:'High value — consumer', segment:'consumer', minAmount:500, maxAmount:null,
   status:'active', system:false, owner:'operator', ownerId:null, scope:'segment', scopeId:null,
   why:'A retail balance above $500 is worth a phone call before it is worth a suspension.',
   steps:[
     {at:0,  action:'retry',     channels:['silent']},
     {at:1,  action:'notify',    channels:['email','push']},
     {at:5,  action:'remind',    channels:['email','sms','call']},
     {at:12, action:'final',     channels:['email','sms','call']},
     {at:21, action:'restrict',  channels:['inapp','email']},
     {at:30, action:'suspend',   channels:['email','sms']},
     {at:60, action:'legal',     channels:['letter']}
   ]}

,

  /* ---------------------------------------------------------------------
     Category ladders. A customer type is a blunt instrument: a $40 balance
     behaves very differently depending on whether it is a games subscription
     or the connectivity under a customer's cold store. These sit between the
     plain customer-type ladder and the seller's own, and the more specific
     scope wins — product category beats marketplace category beats segment.
     --------------------------------------------------------------------- */
  {id:'DL-V-IOT', name:'IoT — any customer type', segment:null, minAmount:0, maxAmount:null,
   status:'active', system:false, owner:'operator', ownerId:null, scope:'vertical', scopeId:'iot',
   why:'Connectivity under a deployed sensor estate is load-bearing. Suspending it stops an operation '+
       'rather than an entertainment, so the notices run longer and the escalation is a call, not a cut-off.',
   steps:[
     {at:0,  action:'retry',     channels:['silent']},
     {at:2,  action:'notify',    channels:['email']},
     {at:7,  action:'remind',    channels:['email','sms']},
     {at:15, action:'manager',   channels:['manager','call']},
     {at:25, action:'final',     channels:['email','sms']},
     {at:40, action:'restrict',  channels:['email','inapp']},
     {at:60, action:'suspend',   channels:['email','sms','call']},
     {at:100,action:'legal',     channels:['letter']}
   ]},
  {id:'DL-V-SEC', name:'Security — any customer type', segment:null, minAmount:0, maxAmount:null,
   status:'active', system:false, owner:'operator', ownerId:null, scope:'vertical', scopeId:'security',
   why:'Withdrawing a security service over an unpaid invoice leaves a customer exposed and leaves us '+
       'arguing about who was responsible for the breach. Nothing is suspended before a named conversation '+
       'and a written notice have both happened.',
   steps:[
     {at:0,  action:'notify',    channels:['email']},
     {at:5,  action:'remind',    channels:['email']},
     {at:15, action:'manager',   channels:['manager','call']},
     {at:30, action:'final',     channels:['email','letter']},
     {at:55, action:'restrict',  channels:['email','manager']},
     {at:95, action:'legal',     channels:['letter']}
   ]},
  {id:'DL-V-CON', name:'Digital content — any customer type', segment:null, minAmount:0, maxAmount:null,
   status:'active', system:false, owner:'operator', ownerId:null, scope:'vertical', scopeId:'content',
   why:'A lapsed content subscription is trivially replaced by a competitor, so the window between a failed '+
       'charge and a cancelled card decides the whole relationship. Fast, light, and short.',
   steps:[
     {at:0,  action:'retry',     channels:['silent']},
     {at:1,  action:'notify',    channels:['inapp','email']},
     {at:3,  action:'remind',    channels:['email','push']},
     {at:7,  action:'final',     channels:['email','sms']},
     {at:12, action:'restrict',  channels:['inapp','email']},
     {at:18, action:'suspend',   channels:['email']},
     {at:40, action:'terminate', channels:['email']}
   ]},
  {id:'DL-V-DEV', name:'Devices — any customer type', segment:null, minAmount:0, maxAmount:null,
   status:'active', system:false, owner:'operator', ownerId:null, scope:'vertical', scopeId:'device',
   why:'A device is already in the customer\u2019s hands, so the balance is real debt rather than a lapsed '+
       'service. That justifies a firmer pace \u2014 but the handset keeps working, because bricking hardware '+
       'somebody has partly paid for invites a regulator.',
   steps:[
     {at:0,  action:'retry',     channels:['silent']},
     {at:2,  action:'notify',    channels:['email','sms']},
     {at:7,  action:'remind',    channels:['email','sms']},
     {at:14, action:'final',     channels:['email','sms','call']},
     {at:25, action:'restrict',  channels:['email','inapp']},
     {at:60, action:'legal',     channels:['letter']}
   ]},

  /* Product-category ladders. The narrowest scope, and the one that should be
     used sparingly: every extra ladder is another thing that has to be right. */
  {id:'DL-C-SIM', name:'IoT SIM plans', segment:null, minAmount:0, maxAmount:null,
   status:'active', system:false, owner:'operator', ownerId:null, scope:'category', scopeId:'IoT SIM plans',
   why:'Suspending a SIM plan detaches an entire estate at once and the customer cannot bring it back '+
       'themselves. It is the single most damaging thing collections can do on this platform, so it happens '+
       'last and only after somebody has spoken to a human.',
   steps:[
     {at:0,  action:'notify',    channels:['email']},
     {at:7,  action:'remind',    channels:['email','sms']},
     {at:18, action:'manager',   channels:['manager','call']},
     {at:35, action:'final',     channels:['email','sms','call']},
     {at:55, action:'restrict',  channels:['email','manager']},
     {at:90, action:'suspend',   channels:['letter','email','call']},
     {at:130,action:'legal',     channels:['letter']}
   ]},
  {id:'DL-C-INS', name:'Insurance', segment:null, minAmount:0, maxAmount:null,
   status:'active', system:false, owner:'operator', ownerId:null, scope:'category', scopeId:'Insurance',
   why:'A lapsed policy is not a lapsed subscription \u2014 the customer is uninsured and usually does not '+
       'know it. Regulation in most of our markets requires written notice before cover ends, and it is the '+
       'right thing to do in the ones where it does not.',
   steps:[
     {at:0,  action:'retry',     channels:['silent']},
     {at:1,  action:'notify',    channels:['email','sms']},
     {at:5,  action:'remind',    channels:['email','sms','call']},
     {at:12, action:'final',     channels:['email','letter']},
     {at:30, action:'terminate', channels:['letter','email','sms']}
   ]},
  {id:'DL-C-STR', name:'Streaming', segment:null, minAmount:0, maxAmount:null,
   status:'active', system:false, owner:'operator', ownerId:null, scope:'category', scopeId:'Streaming',
   why:'The lowest-value and most replaceable thing we sell. Three touches and it either recovers or it does '+
       'not; a fourth costs more than the subscription is worth.',
   steps:[
     {at:0,  action:'retry',     channels:['silent']},
     {at:1,  action:'notify',    channels:['inapp','push']},
     {at:4,  action:'final',     channels:['email']},
     {at:10, action:'suspend',   channels:['email']},
     {at:30, action:'terminate', channels:['email']}
   ]}
];

/* How a ladder's reach is described, narrowest first. The order in this array
   IS the precedence, so adding a scope means deciding where it sits rather
   than leaving that to whichever filter happens to run. */
const LADDER_SCOPES = [
  {id:'category', label:'Product category',
   note:'The narrowest. Use sparingly \u2014 every extra ladder is another thing that has to stay right.'},
  {id:'vertical', label:'Marketplace category',
   note:'What the thing is. A $40 balance behaves differently for a games subscription and a cold store.'},
  {id:'segment',  label:'Customer type only',
   note:'The fallback. Always present, so nothing is ever left unchased.'}
];
const DLMAP={}; DUNNING_LADDERS.forEach(l=>DLMAP[l.id]=l);

/* Who sets the pacing on a given receivable. Stated once here so the operator
   console, the seller console and the tests all read the same rule. */
const DUN_GOVERNANCE = {
  ownBusiness:'A seller sets the pacing for receivables on products they sell directly. It is their revenue, '+
              'their customer and their commercial judgement.',
  bundled:'Anything sold inside a bundle the operator assembled is governed by the operator ladder, whatever '+
          'the seller has configured. The marketplace is merchant of record on a bundle, the customer receives '+
          'one bill for it, and two ladders chasing one balance would produce two different suspension dates '+
          'for the same money.',
  marketplaceDebt:'What a seller owes the marketplace in commission and fees always runs on the operator ladder. '+
                  'A debtor does not set the terms of their own recovery.'
};

/* ==========================================================================
   M37 — CREDIT AND DEBIT NOTES, AND CUSTOMER REFUNDS
   --------------------------------------------------------------------------
   Two adjacent things that people confuse, kept apart here on purpose.

   A credit or debit note is between the MARKETPLACE and a SELLER. It corrects
   a settlement that has already been struck — commission charged at the wrong
   rate, an SLA penalty, an agreed goodwill contribution. The operator raises
   it; the seller sees it as a line on their next statement. No customer is
   involved and no money moves to a card.

   A refund is between a CUSTOMER and the party that sold to them. The money
   goes back to the instrument that paid. Who decides is not the marketplace's
   choice to make for a third-party product: it is the seller's revenue being
   given back, so the seller approves it. The marketplace approves only what it
   sold itself — first-party products and bundles it assembled — and steps in
   on a third-party refund only where a rule it published says it must.
   ========================================================================== */

const NOTE_TYPES = [
  {id:'credit', label:'Credit note', sign:-1,
   effect:'Reduces what the seller owes us, or increases what we owe them.',
   note:'Raised when we have overcharged, or when we have agreed to carry a cost the seller would otherwise bear.'},
  {id:'debit',  label:'Debit note',  sign:+1,
   effect:'Increases what the seller owes us.',
   note:'Raised when a charge was missed or a penalty falls due. Harder to justify, so it needs a reason and an approver.'}
];
const NTMAP={}; NOTE_TYPES.forEach(t=>NTMAP[t.id]=t);

const NOTE_REASONS = [
  {id:'comm-rate',   type:'credit', label:'Commission charged at the wrong rate',
   note:'Our error. Correct it in full and do not net it against anything else.'},
  {id:'goodwill',    type:'credit', label:'Goodwill contribution',
   note:'We are absorbing a cost the seller would otherwise carry, usually to keep a buyer.'},
  {id:'promo-share', type:'credit', label:'Agreed promotion funding',
   note:'A discount the marketplace committed to fund. Belongs on a note, not hidden in the commission line.'},
  {id:'overcharge',  type:'credit', label:'Fee billed twice',
   note:'A duplicate charge. Reverse the whole amount, not the net.'},
  {id:'sla-penalty', type:'debit',  label:'SLA penalty',
   note:'A fulfilment or response commitment was missed. The penalty must be in the contract to be raised.'},
  {id:'chargeback',  type:'debit',  label:'Chargeback recovered',
   note:'A buyer’s bank reversed a payment on the seller’s product. The loss follows the sale.'},
  {id:'undercharge', type:'debit',  label:'Fee not billed',
   note:'A charge that should have been raised in an earlier period. Say which period.'},
  {id:'damage',      type:'debit',  label:'Damage or loss in our custody',
   note:'Only where the marketplace held the stock. If it never reached our warehouse this is the wrong instrument.'}
];

/* What the operator can configure. A note is a financial instrument, so the
   controls that matter are who may raise one, above what value it needs a
   second pair of eyes, and how it lands in the ledger. */
const NOTE_POLICY = {
  prefixCredit:'CN-2026-', prefixDebit:'DN-2026-', nextSeq:41,
  autoApproveBelow:250,
  secondApprovalAbove:5000,
  requireReason:true,
  requireEvidenceAbove:1000,
  taxTreatment:'Tax is restated on the note at the rate that applied to the original charge, not today’s rate.',
  glCredit:'4010', glDebit:'4010', glClearing:'2010',
  settleOn:'Next statement',
  note:'A note never moves money on its own. It changes the balance that the next settlement run pays or collects, '+
       'which is why it has to be raised before the run closes.',
  voidWindowDays:30
};

const NOTE_STATES = [
  {s:'draft',    label:'Draft',            final:false, note:'Not visible to the seller yet.'},
  {s:'pending',  label:'Awaiting approval',final:false, note:'Above the threshold, so a second approver is required.'},
  {s:'issued',   label:'Issued',           final:false, note:'The seller can see it. It applies at the next settlement run.'},
  {s:'applied',  label:'Applied',          final:true,  note:'Settled. It appears as a line on a statement that has been paid.'},
  {s:'void',     label:'Voided',           final:true,  note:'Cancelled before it settled. The reason is retained.'},
  {s:'disputed', label:'Disputed',         final:false, note:'The seller has challenged it. It does not settle while open.'}
];

const CREDIT_NOTES = [
  {id:'CN-2026-0031', type:'credit', partnerId:'PTR-1002', amount:1284.40, tax:231.19, reason:'comm-rate',
   period:'Jun 2026', raised:'02 Jul 2026', by:'Renu Iyer', approver:'Tomas Alvarez', state:'applied',
   ref:'SET-2026-06-1002', evidence:'Rate card v4 vs applied rate',
   detail:'Commission applied at 12% against a contracted 9.5% for the whole of June. Corrected in full.'},
  {id:'CN-2026-0032', type:'debit',  partnerId:'PTR-1008', amount:640.00, tax:115.20, reason:'sla-penalty',
   period:'Jun 2026', raised:'04 Jul 2026', by:'Renu Iyer', approver:'Tomas Alvarez', state:'applied',
   ref:'Contract cl. 8.2', evidence:'Fulfilment SLA report, 14 breaches',
   detail:'Dispatch SLA missed on 14 orders against a contractual cap of 5 in a rolling month.'},
  {id:'CN-2026-0033', type:'credit', partnerId:'PTR-1004', amount:310.00, tax:55.80, reason:'promo-share',
   period:'Jun 2026', raised:'08 Jul 2026', by:'Renu Iyer', approver:null, state:'issued',
   ref:'PROMO-IOT-SUM26', evidence:'Campaign approval, 11 Jun',
   detail:'Half of the summer IoT promotion discount, funded by the marketplace as agreed at launch.'},
  {id:'CN-2026-0034', type:'debit',  partnerId:'PTR-1011', amount:89.99, tax:16.20, reason:'chargeback',
   period:'Jul 2026', raised:'11 Jul 2026', by:'Renu Iyer', approver:null, state:'issued',
   ref:'ORD-881377', evidence:'Issuer reason code 4855',
   detail:'Buyer’s bank reversed the payment for goods not received. The loss follows the sale.'},
  {id:'CN-2026-0035', type:'credit', partnerId:'PTR-1001', amount:7420.00, tax:1335.60, reason:'overcharge',
   period:'May 2026', raised:'14 Jul 2026', by:'Renu Iyer', approver:null, state:'pending',
   ref:'SET-2026-05-1001', evidence:'Duplicate platform fee lines, May run',
   detail:'The platform fee was billed twice in the May run. Above the second-approval threshold, so it waits.'},
  {id:'CN-2026-0036', type:'credit', partnerId:'PTR-1003', amount:175.00, tax:31.50, reason:'goodwill',
   period:'Jul 2026', raised:'17 Jul 2026', by:'Amelia Nkosi', approver:'Auto', state:'issued',
   ref:'TKT-4419', evidence:null,
   detail:'Marketplace absorbed the seller’s share of a service credit given to keep an enterprise buyer.'},
  {id:'CN-2026-0037', type:'debit',  partnerId:'PTR-1009', amount:2180.00, tax:392.40, reason:'undercharge',
   period:'Apr 2026', raised:'19 Jul 2026', by:'Renu Iyer', approver:null, state:'disputed',
   ref:'SET-2026-04-1009', evidence:'Reseller tier recalculation',
   detail:'Tier-2 reseller fees were not applied in April. The seller says the tier change took effect in May.'},
  {id:'CN-2026-0038', type:'credit', partnerId:'PTR-1010', amount:96.50, tax:17.37, reason:'comm-rate',
   period:'Jul 2026', raised:'21 Jul 2026', by:'Renu Iyer', approver:'Auto', state:'issued',
   ref:'SET-2026-07-1010', evidence:null,
   detail:'Rounding difference on a mid-month rate change. Below the auto-approval threshold.'},
  {id:'CN-2026-0039', type:'debit',  partnerId:'PTR-1005', amount:420.00, tax:75.60, reason:'damage',
   period:'Jul 2026', raised:'22 Jul 2026', by:'Priyanka Bose', approver:null, state:'draft',
   ref:'WH-BLR-01', evidence:'Goods-in inspection, 20 Jul',
   detail:'Not yet issued — checking whether the damage happened before the goods reached our warehouse.'},
  {id:'CN-2026-0040', type:'credit', partnerId:'PTR-1006', amount:1050.00, tax:189.00, reason:'promo-share',
   period:'Jul 2026', raised:'24 Jul 2026', by:'Renu Iyer', approver:'Tomas Alvarez', state:'issued',
   ref:'PROMO-INS-Q3', evidence:'Campaign approval, 01 Jul',
   detail:'Marketplace share of the Q3 insurance bundle promotion.'}
];
const CNMAP={}; CREDIT_NOTES.forEach(n=>CNMAP[n.id]=n);

/* ------------------------------------------------------------- refunds --- */

const REFUND_STATES = [
  {s:'requested', label:'Requested',        final:false, who:'Customer',
   note:'Waiting on whoever sold it. The clock is running against the response SLA.'},
  {s:'approved',  label:'Approved',         final:false, who:'Seller or marketplace',
   note:'Agreed. The money is queued to the original instrument.'},
  {s:'refunded',  label:'Refunded',         final:true,  who:'Platform',
   note:'Money returned. It appears as a deduction on the seller’s next statement.'},
  {s:'declined',  label:'Declined',         final:true,  who:'Seller or marketplace',
   note:'Refused with a reason. It stands unless the response SLA picks it up.'},
  {s:'escalated', label:'Escalated',        final:false, who:'System',
   note:'The response SLA passed with the request unresolved. The marketplace decides it now — '+
        'nobody had to ask for that.'},
  {s:'partial',   label:'Partly refunded',  final:true,  who:'Seller or marketplace',
   note:'Less than the full amount, with the difference explained.'}
];
const RFMAP={}; REFUND_STATES.forEach(r=>RFMAP[r.s]=r);

const REFUND_REASONS = [
  {id:'not-received',   label:'Never arrived',              evidence:'Tracking or activation record'},
  {id:'faulty',         label:'Faulty or not as described',  evidence:'Photograph or fault report'},
  {id:'not-activated',  label:'Service never activated',     evidence:'Provisioning log'},
  {id:'duplicate',      label:'Charged twice',               evidence:'Both charge references'},
  {id:'cancelled',      label:'Cancelled within the window',  evidence:'Cancellation timestamp'},
  {id:'unauthorised',   label:'I did not authorise this',    evidence:'Account access review'},
  {id:'changed-mind',   label:'Changed my mind',             evidence:'None required inside the window'}
];

/* The window and who decides, by category. A digital entitlement already
   consumed cannot be un-consumed, so the windows are not the same. */
const REFUND_WINDOWS = [
  {vertical:'device',   days:14, note:'Distance-selling return period. Unopened, or faulty at any point in warranty.'},
  {vertical:'iot',      days:14, note:'Hardware follows the device window. Connectivity is pro-rated from the cancellation date.'},
  {vertical:'content',  days:14, note:'Full refund while unused. Once streamed or downloaded, the entitlement is consumed.'},
  {vertical:'security', days:30, note:'Managed services are refundable pro-rata for the unused term.'},
  {vertical:'consumer', days:14, note:'Statutory cooling-off. Usage-based charges already incurred are not refundable.'},
  {vertical:'partner',  days:14, note:'Whatever the reseller published, floored at the statutory minimum.'}
];
const REFUND_POLICY = {
  sellerSlaHours:48,
  autoApproveBelow:25,
  autoApproveReasons:['duplicate','not-received'],
  escalateAfterHours:72,
  /* Escalation is a clock, not a button. A customer who has to know to press
     something to get a fair hearing is a customer we have quietly failed. */
  escalationRule:'A request still unresolved '+72+' hours after it was raised is escalated to the marketplace '+
    'automatically, and so is a decline the seller cannot evidence. The customer does not ask for this and '+
    'cannot be penalised for not knowing to.',
  marketplaceDecidesWhen:'The product is first-party, the sale was inside a bundle the marketplace assembled, '+
    'the seller has not answered within the SLA, or the escalation clock has run out on the request.',
  fundedBy:'The seller whose product it was. A refund the marketplace grants against a seller’s product is '+
    'still recovered from that seller’s settlement, and the reason is recorded so it can be argued about.',
  note:'Money returns to the instrument that paid. We do not offer store credit in place of a refund a customer '+
    'is entitled to, because that converts a legal obligation into a marketing one.'
};

const REFUNDS = [
  {id:'RFN-3201', order:'ORD-881204', ctx:'consumer', customer:'Priya Raman', sellerId:'PTR-1002',
   sellerName:'Kestrel Devices', bundleId:null, firstParty:false, item:'Kestrel K7 handset',
   amount:389.00, currency:'USD', reason:'faulty', requested:'19 Jul 2026', state:'refunded',
   decidedBy:'Anil Mehra (Kestrel Devices)', decided:'20 Jul 2026', slaHours:19,
   evidence:'Photographs of the cracked display, courier condition report',
   note:'Approved by the seller inside a day. Handset returned to the Bengaluru warehouse.'},
  {id:'RFN-3202', order:'ORD-881311', ctx:'consumer', customer:'Arun Deshpande', sellerId:'PTR-1005',
   sellerName:'PlayForge Games', bundleId:null, firstParty:false, item:'PlayForge Season Pass',
   amount:24.99, currency:'USD', reason:'changed-mind', requested:'22 Jul 2026', state:'declined',
   decidedBy:'Marek Zielinski (PlayForge Games)', decided:'23 Jul 2026', slaHours:26,
   evidence:'Entitlement shows 14 hours of play',
   note:'Declined because the entitlement was consumed. The customer has been told how to escalate.'},
  {id:'RFN-3203', order:'ORD-881402', ctx:'buyer', customer:'Brightline Foods', sellerId:'PTR-1004',
   sellerName:'Nimbus Sensors', bundleId:'BND-IOT-STARTER', firstParty:false,
   item:'IoT starter bundle — 50 SIMs', amount:1740.00, currency:'USD', reason:'not-activated',
   requested:'23 Jul 2026', state:'requested', decidedBy:null, decided:null, slaHours:null,
   evidence:'Provisioning log shows 50 SIMs never attached',
   note:'Sold inside a marketplace bundle, so the marketplace decides rather than the seller.'},
  {id:'RFN-3204', order:'ORD-881288', ctx:'consumer', customer:'Meera Krishnan', sellerId:'PTR-1007',
   sellerName:'Halo Audio', bundleId:null, firstParty:false, item:'Halo Audio annual',
   amount:59.00, currency:'USD', reason:'duplicate', requested:'24 Jul 2026', state:'refunded',
   decidedBy:'Auto', decided:'24 Jul 2026', slaHours:0,
   evidence:'Charges AUTH-77120 and AUTH-77121, four seconds apart',
   note:'Auto-approved. A duplicate charge is never a judgement call.'},
  {id:'RFN-3205', order:'ORD-881350', ctx:'buyer', customer:'Harbourpoint Retail', sellerId:'PTR-1003',
   sellerName:'Sentinel Cyber', bundleId:null, firstParty:false, item:'Sentinel MDR — 40 seats',
   amount:2400.00, currency:'USD', reason:'cancelled', requested:'21 Jul 2026', state:'escalated',
   decidedBy:null, decided:null, slaHours:96,
   evidence:'Cancellation email timestamped inside the 30-day window',
   escalatedAt:'24 Jul 2026 11:00', escalatedWhy:'Unresolved 96 hours after it was raised, past the 72-hour clock',
   note:'The seller declined on the grounds the term had started, then let it sit. The clock ran out and it '+
        'came to us on its own.'},
  {id:'RFN-3206', order:'ORD-881419', ctx:'consumer', customer:'Ravi Menon', sellerId:null,
   sellerName:'Marketplace', bundleId:null, firstParty:true, item:'Aventa 5G Unlimited — first month',
   amount:34.00, currency:'USD', reason:'not-received', requested:'24 Jul 2026', state:'approved',
   decidedBy:'Amelia Nkosi (Marketplace)', decided:'25 Jul 2026', slaHours:14,
   evidence:'No successful attach on the network in the billing month',
   note:'First-party product, so the marketplace both decides and funds it.'},
  {id:'RFN-3207', order:'ORD-881433', ctx:'consumer', customer:'Sanya Kapoor', sellerId:'PTR-1004',
   sellerName:'Nimbus Sensors', bundleId:null, firstParty:false, item:'Nimbus door sensor pack',
   amount:78.50, currency:'USD', reason:'faulty', requested:'25 Jul 2026', state:'requested',
   decidedBy:null, decided:null, slaHours:null,
   evidence:'Two of four sensors fail to pair',
   note:'Sold direct by the seller, so the seller decides. Response SLA runs out on 27 July.'},
  {id:'RFN-3208', order:'ORD-881207', ctx:'buyer', customer:'Meridian Foods', sellerId:'PTR-1008',
   sellerName:'Volta Routers', bundleId:null, firstParty:false, item:'Volta VR-200 × 12',
   amount:1680.00, currency:'USD', reason:'not-received', requested:'20 Jul 2026', state:'partial',
   decidedBy:'Chen Yu Hsu (Volta Routers)', decided:'22 Jul 2026', slaHours:41,
   evidence:'Courier delivered 9 of 12; three signed for at the wrong dock',
   note:'Three units refunded, nine kept. The difference is explained on the credit line.'},
  {id:'RFN-3209', order:'ORD-881441', ctx:'consumer', customer:'Daniel Osei', sellerId:'PTR-1001',
   sellerName:'StreamNova Media', bundleId:null, firstParty:false, item:'StreamNova Premium — annual',
   amount:96.00, currency:'USD', reason:'unauthorised', requested:'25 Jul 2026', state:'requested',
   decidedBy:null, decided:null, slaHours:null,
   evidence:'Sign-in from an unrecognised device the day before the charge',
   note:'Treated as a security matter first. The account has been locked pending the seller’s answer.'},
  {id:'RFN-3210', order:'ORD-881368', ctx:'buyer', customer:'Brightline Foods', sellerId:null,
   sellerName:'Marketplace', bundleId:'BND-FLEET-PRO', firstParty:false, item:'Fleet tracking pro — 20 units',
   amount:3120.00, currency:'USD', reason:'faulty', requested:'18 Jul 2026', state:'declined',
   decidedBy:'Tomas Alvarez (Marketplace)', decided:'21 Jul 2026', slaHours:68,
   evidence:'Specification sheet matches what was delivered',
   note:'Bundle, so the marketplace decided. Declined, with the specification difference set out in writing.'}
];
const RFNMAP={}; REFUNDS.forEach(r=>RFNMAP[r.id]=r);

/* ==========================================================================
   M36 — DEFAULT LADDER PROFILES BY CATEGORY
   --------------------------------------------------------------------------
   A seller should not have to invent a collections policy on their first day.
   Onboarding gives them a starting ladder chosen from the category they sell
   in, because what recovers money from a games subscriber is not what recovers
   it from a fleet telematics installer. They can run it untouched, edit it, or
   add ladders of their own — and whatever they end up with is visible to the
   operator, because a marketplace that cannot see how its sellers chase its
   shared customers cannot answer a complaint about it.
   ========================================================================== */
const LADDER_PROFILES = [
  {id:'LP-CONSUMER', vertical:'consumer', name:'Retail subscriber',
   why:'Small recurring balances on a card. Most failures are an expired card, and the customer fixes it '+
       'within a day of being told. Chasing harder loses the subscription rather than recovering the month.',
   ladders:[
     {suffix:'CON', name:'Retail subscriber', segment:'consumer', steps:[
       {at:0,  action:'retry',     channels:['silent']},
       {at:1,  action:'notify',    channels:['email','push']},
       {at:4,  action:'remind',    channels:['email','sms']},
       {at:9,  action:'final',     channels:['email','sms']},
       {at:14, action:'restrict',  channels:['inapp','email']},
       {at:21, action:'suspend',   channels:['email','sms']},
       {at:45, action:'terminate', channels:['email','letter']}]}]},

  {id:'LP-CONTENT', vertical:'content', name:'Content subscriber',
   why:'A lapsed content subscription is trivially re-acquired by the competition, so the window between '+
       'a failed charge and a cancelled card is where the whole relationship is decided. Fast, light, and '+
       'no service interruption until the point it is clearly not coming back.',
   ladders:[
     {suffix:'CON', name:'Content subscriber', segment:'consumer', steps:[
       {at:0,  action:'retry',     channels:['silent']},
       {at:1,  action:'notify',    channels:['inapp','email']},
       {at:3,  action:'remind',    channels:['email','push']},
       {at:7,  action:'final',     channels:['email','sms']},
       {at:12, action:'restrict',  channels:['inapp','email']},
       {at:18, action:'suspend',   channels:['email']},
       {at:40, action:'terminate', channels:['email']}]}]},

  {id:'LP-DEVICE', vertical:'device', name:'Device instalment',
   why:'A device is already in the customer\u2019s hands, so the balance is real debt rather than a lapsed '+
       'service. That justifies a firmer pace than a subscription — but the handset keeps working, because '+
       'bricking hardware somebody has partly paid for invites a regulator.',
   ladders:[
     {suffix:'CON', name:'Instalment — consumer', segment:'consumer', steps:[
       {at:0,  action:'retry',     channels:['silent']},
       {at:2,  action:'notify',    channels:['email','sms']},
       {at:7,  action:'remind',    channels:['email','sms']},
       {at:14, action:'final',     channels:['email','sms','call']},
       {at:25, action:'restrict',  channels:['email','inapp']},
       {at:60, action:'legal',     channels:['letter']}]},
     {suffix:'SMB', name:'Instalment — business', segment:'smb', steps:[
       {at:0,  action:'notify',    channels:['email']},
       {at:7,  action:'remind',    channels:['email']},
       {at:20, action:'manager',   channels:['manager','call']},
       {at:35, action:'final',     channels:['email','sms']},
       {at:75, action:'legal',     channels:['letter']}]}]},

  {id:'LP-IOT', vertical:'iot', name:'IoT deployment',
   why:'Connectivity under a deployed sensor estate is load-bearing. Suspending it stops a customer\u2019s '+
       'operation, not their entertainment, so the pace is slow and human — and the escalation is a named '+
       'call rather than a cut-off.',
   ladders:[
     {suffix:'CON', name:'IoT direct — small account', segment:'consumer', steps:[
       {at:0,  action:'retry',     channels:['silent']},
       {at:2,  action:'notify',    channels:['email']},
       {at:6,  action:'remind',    channels:['email','sms']},
       {at:12, action:'final',     channels:['email','sms']},
       {at:20, action:'restrict',  channels:['inapp','email']},
       {at:35, action:'suspend',   channels:['email','sms']},
       {at:75, action:'legal',     channels:['letter']}]},
     {suffix:'SMB', name:'IoT direct — installers', segment:'smb', steps:[
       {at:0,  action:'notify',    channels:['email']},
       {at:7,  action:'remind',    channels:['email']},
       {at:18, action:'manager',   channels:['manager','call']},
       {at:30, action:'final',     channels:['email','sms']},
       {at:45, action:'restrict',  channels:['email']},
       {at:70, action:'suspend',   channels:['email','sms']},
       {at:110,action:'legal',     channels:['letter']}]}]},

  {id:'LP-SECURITY', vertical:'security', name:'Managed security',
   why:'Withdrawing a security service over an unpaid invoice leaves a customer exposed and leaves us '+
       'arguing about who was responsible for the breach. Nothing is suspended before a named conversation '+
       'and a written notice have both happened.',
   ladders:[
     {suffix:'SMB', name:'Managed security — business', segment:'smb', steps:[
       {at:0,  action:'notify',    channels:['email']},
       {at:5,  action:'remind',    channels:['email']},
       {at:15, action:'manager',   channels:['manager','call']},
       {at:30, action:'final',     channels:['email','letter']},
       {at:50, action:'restrict',  channels:['email','manager']},
       {at:90, action:'legal',     channels:['letter']}]}]},

  {id:'LP-PARTNER', vertical:'partner', name:'Reseller downstream',
   why:'A reseller\u2019s end customers are not ours, but the service under them is. The pace matches a '+
       'business relationship, and the reseller\u2019s account manager is involved before anything is cut.',
   ladders:[
     {suffix:'SMB', name:'Downstream business account', segment:'smb', steps:[
       {at:0,  action:'notify',    channels:['email']},
       {at:6,  action:'remind',    channels:['email','sms']},
       {at:16, action:'manager',   channels:['manager','call']},
       {at:28, action:'final',     channels:['email','sms']},
       {at:42, action:'restrict',  channels:['email']},
       {at:70, action:'suspend',   channels:['email','sms']},
       {at:100,action:'legal',     channels:['letter']}]}]}
];
const LPMAP={}; LADDER_PROFILES.forEach(p=>LPMAP[p.id]=p);

/* Which profile a partner gets. Their first vertical is the one they sell most
   in, and it is what onboarding asked them for. */
function profileForVertical(v){
  return LADDER_PROFILES.filter(p=>p.vertical===v)[0] || LPMAP['LP-CONSUMER'];
}

/* Onboarding runs this. It is idempotent, so re-running it on a partner who
   already has ladders adds nothing and overwrites nothing they have edited. */
function seedPartnerLadders(partner){
  if(!partner) return [];
  const existing=DUNNING_LADDERS.filter(l=>l.owner==='partner' && l.ownerId===partner.id);
  if(existing.length) return existing;
  const prof=profileForVertical((partner.verticals||['consumer'])[0]);
  const made=[];
  prof.ladders.forEach(t=>{
    const id='DL-'+partner.id.replace('PTR-','P')+'-'+t.suffix;
    const l={id:id, name:t.name, segment:t.segment, minAmount:0, maxAmount:null,
             status:'active', system:false, owner:'partner', ownerId:partner.id,
             scope:'segment', scopeId:null,
             fromProfile:prof.id, seededOn:partner.joined||'\u2014', edited:false,
             why:prof.why,
             steps:t.steps.map(s=>({at:s.at, action:s.action, channels:s.channels.slice()}))};
    DUNNING_LADDERS.push(l); DLMAP[id]=l; made.push(l);
  });
  return made;
}
PARTNERS.filter(p=>p.status==='live').forEach(seedPartnerLadders);

/* Nimbus has been trading long enough to have changed theirs. Recording the
   edit is what lets the operator see drift from the published default. */
(function(){
  const l=DLMAP['DL-P1004-SMB'];
  if(!l) return;
  l.name='Nimbus direct — installers';
  l.edited=true; l.editedOn='03 Mar 2026';
  l.why='Installers invoice their own clients before they pay us, so a late payment is usually a cash-flow '+
        'gap of a few weeks rather than a bad debt. We give them longer than the marketplace default and '+
        'call them at day 18 instead of writing again.';
  l.steps=[{at:0,  action:'notify',   channels:['email']},
           {at:7,  action:'remind',   channels:['email']},
           {at:18, action:'manager',  channels:['manager','call']},
           {at:34, action:'final',    channels:['email','sms']},
           {at:52, action:'restrict', channels:['email']},
           {at:80, action:'suspend',  channels:['email','sms']},
           {at:120,action:'legal',    channels:['letter']}];
})();

/* Kept so older references and the seeded cases still resolve. */
const DUNNING_LADDER = DLMAP['DL-CON'].steps.map((s,i)=>({
  step:i+1, at:'Day '+s.at,
  action:(DUN_ACTIONS.filter(a=>a.id===s.action)[0]||{}).label||s.action,
  channels:(s.channels||[]).slice(),
  service:(DUN_ACTIONS.filter(a=>a.id===s.action)[0]||{}).service||'Unaffected'
}));

/* ===========================================================================
   §4.63  WALLETS — STORED VALUE

   A wallet balance is money the platform is holding for somebody else. Like a
   reward point it is a liability from the moment it is credited, but unlike a
   point it is real money that in most jurisdictions the holder can ask back.
   That difference is the whole design: points expire, wallet balances go
   dormant and are escheated or returned, never quietly absorbed.
   ======================================================================== */

const WALLET_POLICY = {
  name:'Marketplace wallet',
  maxBalance:2000,
  minTopUp:5,
  /* Money in, and where each source comes from. */
  sources:[
    {id:'topup',  label:'Top-up from a card or bank', note:'The customer’s own money. Refundable on request.'},
    {id:'refund', label:'Refund paid to the wallet',  note:'Only where the customer chose it over the original instrument.'},
    {id:'reward', label:'Reward redemption',          note:'Points converted to credit. Not refundable as cash.'},
    {id:'goodwill',label:'Goodwill credit',           note:'Issued by support. Marketing spend, not the customer’s money.'}
  ],
  /* Two pots, because they are legally different and mixing them is how a
     platform ends up refunding its own promotional credit as cash. */
  cashRefundable:'Top-ups and refunds paid to the wallet are the customer’s money and are returned on '+
    'request, to the instrument that funded them.',
  nonRefundable:'Reward redemptions and goodwill credit are not the customer’s money and are not returned '+
    'as cash. They are spendable in the marketplace and that is all.',
  dormancyMonths:24,
  dormancyNote:'A wallet with no movement for 24 months is flagged. The holder is written to, and the '+
    'balance is returned or escheated according to the rules where they live. It is never absorbed as income.',
  liabilityAccount:'2050',
  breakageAccount:'4050',
  status:'live'
};

const WALLETS = [];
const WALLET_LEDGER = [];
(function seedWallets(){
  const r = mulberry32(884422);
  const holders = [
    ['CUS-449021','Priya Raman','consumer'],
    ['CUS-449118','Arun Deshpande','consumer'],
    ['CUS-449204','Meera Krishnan','consumer'],
    ['CUS-449377','Daniel Osei','consumer'],
    ['CUS-449512','Sanya Kapoor','consumer'],
    ['CUS-449640','Ravi Menon','consumer'],
    ['CUS-449771','Lotte Bakker','consumer'],
    ['ORG-77120','Brightline Foods','enterprise'],
    ['ORG-77208','Harbourpoint Retail','enterprise']
  ];
  const spendOn = ['StreamNova Premium','Halo Music Family','PlayForge Season Pass',
                   'Aegis Screen Cover','Travel eSIM — 10 GB','Kestrel 45 W charger'];
  let seq = 5100;
  holders.forEach((h,i)=>{
    const [party,name,kind]=h;
    const cash = +( (r()*90)+5 ).toFixed(2);
    const promo= +( (r()*24) ).toFixed(2);
    /* Dormancy is a real state, so one account is actually in it. */
    const dormant = i===6;
    const w = {
      id:'WAL-'+(4100+i*3), party, name, kind,
      cash:+cash.toFixed(2), promo:+promo.toFixed(2),
      balance:+(cash+promo).toFixed(2),
      opened:['14 Jun 2024','02 Sep 2024','21 Mar 2024','11 May 2026','08 Jan 2025',
              '19 Feb 2025','03 Aug 2023','05 Apr 2024','19 Aug 2024'][i],
      lastMove: dormant ? '02 Sep 2023' : ['24 Jul 2026','22 Jul 2026','20 Jul 2026','25 Jul 2026',
              '25 Jul 2026','24 Jul 2026','02 Sep 2023','22 Jul 2026','14 Jul 2026'][i],
      state: dormant ? 'dormant' : 'active',
      note: dormant ? 'No movement for 22 months. Written to on 04 Jul 2026; no reply yet.' : null
    };
    WALLETS.push(w);

    const push=(when,src,what,amount,pot)=>{
      seq+=1;
      WALLET_LEDGER.push({id:'WTX-'+seq, wallet:w.id, party, name, when,
        source:src, what, amount:+amount.toFixed(2), pot:pot||'cash'});
    };
    push(w.opened,'topup','Opened with a card top-up', 20, 'cash');
    if(i%3===0) push('11 Jun 2026','refund','Refund paid to the wallet — PlayForge Season Pass', 24.99,'cash');
    if(i%2===0) push('21 Jun 2026','reward','Reward points redeemed for credit', 12.00,'promo');
    if(i===1)   push('05 Jul 2026','goodwill','Goodwill after a delivery failure', 10.00,'promo');
    push('02 Jul 2026','topup','Top-up from a saved card', 25, 'cash');
    push('11 Jun 2026','spend','Spent on '+spendOn[i%spendOn.length], -12.99,'cash');
    if(i===2) push('20 Jul 2026','spend','Spent on Halo Music Family', -14.99,'cash');
  });
})();
const WALMAP={}; WALLETS.forEach(w=>{WALMAP[w.id]=w; WALMAP[w.party]=w;});
/* The shopper's balance and the operator's record are the same obligation seen
   from two sides. Two numbers that can disagree is the defect this avoids. */
(function reconcileShopperWallet(){
  const w = WALMAP[SHOPPER.id];
  if(!w) return;
  SHOPPER.wallet = w.balance;
  MY_WALLET_LOG.length = 0;
  WALLET_LEDGER.filter(t=>t.wallet===w.id).forEach(t=>{
    MY_WALLET_LOG.push({when:t.when, what:t.what, amount:t.amount});
  });
})();
function walletFor(party){ return WALMAP[party]||null; }
function walletLedgerFor(id){ return WALLET_LEDGER.filter(t=>t.wallet===id); }
/* What the platform is holding, split by whose money it actually is. */
function walletLiability(){
  const cash =+WALLETS.reduce((a,w)=>a+w.cash,0).toFixed(2);
  const promo=+WALLETS.reduce((a,w)=>a+w.promo,0).toFixed(2);
  const dormant=WALLETS.filter(w=>w.state==='dormant');
  return {cash, promo, total:+(cash+promo).toFixed(2),
          dormant:dormant.length,
          dormantValue:+dormant.reduce((a,w)=>a+w.balance,0).toFixed(2),
          accounts:WALLETS.length};
}

/* ===========================================================================
   §4.53  LOYALTY AND REWARDS

   A reward point is a liability, not a marketing feature. The moment it is
   issued the platform owes something, and the only honest way to run one is to
   record who funded each point, what it is worth, when it dies, and how much of
   the outstanding balance will realistically be claimed.

   Four roles, four different questions:
     · the customer asks what they have and what it buys
     · the seller asks what issuing points on their products is costing them
     · the operator asks what the programme owes and who funded it
     · the enterprise buyer asks what the organisation earned and who may spend it

   Aligned to TM Forum SID Loyalty (Party Loyalty / Loyalty Account / Loyalty
   Transaction) and TMF632/TMF666 for the account-side postings.
   ======================================================================== */

const LOYALTY = {
  name:'Aventa Rewards',
  unit:'points',
  /* 100 points buys one unit of currency. Stated once and used everywhere, so
     the value of a point cannot drift between two screens. */
  perUnit:100,
  minRedeem:100,
  /* Rolling expiry from the date each point was earned, not from last activity.
     Last-activity expiry quietly never expires anything for an active customer,
     which sounds generous until the liability is added up. */
  expiryMonths:24,
  roundingNote:'Points are earned on the net amount after discount and before tax, rounded down. '+
    'Rounding up would have the platform paying for arithmetic.',
  /* The share of issued points historically never redeemed. It reduces the
     liability carried, and it is an estimate — so it is labelled as one. */
  breakage:0.185,
  breakageBasis:'Observed on points issued Jul 2024 – Jun 2025 and now past expiry',
  liabilityAccount:'2040',
  fundingNote:'Every earn rule names who pays for the points it issues. Operator-funded points are '+
    'marketing spend. Partner-funded points are recovered on the partner’s next settlement.',
  status:'live', launched:'Mar 2024'
};
const PT = n => (n==null? null : Math.round(n).toLocaleString('en-US')+' pts');
/* What a points balance is actually worth in money. */
const PTVAL = n => (n==null? null : n/LOYALTY.perUnit);

const LOYALTY_TIERS = [
  {id:'bronze',   name:'Bronze',   order:1, qualifySpend:0,    multiplier:1.0, colour:'#8D6E63',
   benefits:['Earn 1 point per $1 spent','Points valid for 24 months'],
   note:'Where every account starts. No qualification and nothing to lose.'},
  {id:'silver',   name:'Silver',   order:2, qualifySpend:600,  multiplier:1.25, colour:'#90A4AE',
   benefits:['Earn 1.25 points per $1','Free delivery on device orders','Early access to content offers'],
   note:'Reached on $600 of qualifying spend in a rolling twelve months.'},
  {id:'gold',     name:'Gold',     order:3, qualifySpend:1800, multiplier:1.5, colour:'#C8A200',
   benefits:['Earn 1.5 points per $1','Free delivery on everything','Priority support queue',
             'Double points one weekend a quarter'],
   note:'Reached on $1,800 of qualifying spend in a rolling twelve months.'},
  {id:'platinum', name:'Platinum', order:4, qualifySpend:4500, multiplier:2.0, colour:'#455A64',
   benefits:['Earn 2 points per $1','Free next-day delivery','Named account contact',
             'Points never expire while the tier is held','Annual device trade-in bonus'],
   note:'Reached on $4,500 of qualifying spend in a rolling twelve months.'}
];
const TIERMAP={}; LOYALTY_TIERS.forEach(t=>{TIERMAP[t.id]=t; TIERMAP[t.name]=t;});
const TIER_POLICY = {
  window:'Rolling 12 months',
  upgrade:'Immediate, on the order that crosses the threshold',
  /* A tier taken away the day a customer dips below the line is a tier nobody
     trusts. One full period of grace, stated up front. */
  downgrade:'At the annual review, and only if qualifying spend has been below the threshold for a full '+
    'twelve months. A member is told sixty days before it happens.',
  graceDays:60,
  note:'Qualifying spend excludes tax, delivery and anything later refunded.'
};

/* Who pays for a point. This is the whole argument in one field. */
const FUNDERS = [
  {id:'operator', label:'Marketplace', note:'Marketing spend. Hits the operator’s promotions budget.'},
  {id:'partner',  label:'Seller',      note:'Recovered on the seller’s next settlement, itemised.'},
  {id:'shared',   label:'Shared',      note:'Split at the rate on the rule. Both sides see their half.'}
];

const EARN_RULES = [
  {id:'ERN-01', name:'Base earn — everything',        scope:'all',      scopeId:null,
   rate:1.0, funder:'operator', split:null, status:'active', from:'01 Mar 2024', to:null,
   capPerOrder:null, capPerMonth:null, audience:'all',
   why:'The floor. Without it a tier multiplier has nothing to multiply.'},
  {id:'ERN-02', name:'Digital content — double earn', scope:'vertical', scopeId:'content',
   rate:2.0, funder:'shared', split:50, status:'active', from:'01 Apr 2026', to:'30 Sep 2026',
   capPerOrder:500, capPerMonth:2000, audience:'all',
   why:'Content has the highest margin and the weakest repeat rate, so it is the cheapest place to buy loyalty.'},
  {id:'ERN-03', name:'Device trade-in bonus',         scope:'vertical', scopeId:'device',
   rate:1.0, funder:'partner', split:null, status:'active', from:'01 Jan 2026', to:null,
   capPerOrder:1500, capPerMonth:null, audience:'all', bonus:750,
   why:'The OEM funds it because the trade-in is what makes the next handset sale happen.'},
  {id:'ERN-04', name:'IoT volume accelerator',        scope:'vertical', scopeId:'iot',
   rate:0.5, funder:'operator', split:null, status:'active', from:'01 Feb 2026', to:null,
   capPerOrder:null, capPerMonth:5000, audience:'enterprise',
   why:'Enterprise IoT spend is large and repeatable, so a small rate is enough and a monthly cap is essential.'},
  {id:'ERN-05', name:'Security first purchase',       scope:'vertical', scopeId:'security',
   rate:1.0, funder:'partner', split:null, status:'active', from:'15 May 2026', to:'31 Dec 2026',
   capPerOrder:2000, capPerMonth:null, audience:'enterprise', firstOnly:true,
   why:'Security is a considered purchase with a long cycle. The seller funds the first one to shorten it.'},
  {id:'ERN-06', name:'Kestrel handset launch',        scope:'partner',  scopeId:'PTR-1002',
   rate:3.0, funder:'partner', split:null, status:'active', from:'01 Jul 2026', to:'31 Aug 2026',
   capPerOrder:3000, capPerMonth:null, audience:'consumer',
   why:'A launch window the OEM is paying for. It ends when the launch does, which is why it has an end date.'},
  {id:'ERN-07', name:'Weekend double points — Gold+', scope:'all',      scopeId:null,
   rate:2.0, funder:'operator', split:null, status:'scheduled', from:'01 Aug 2026', to:'03 Aug 2026',
   capPerOrder:1000, capPerMonth:null, audience:'gold+',
   why:'A tier benefit that has to actually happen, otherwise the tier page is a promise nobody kept.'},
  {id:'ERN-09', name:'Nimbus sensor starter pack',    scope:'partner',  scopeId:'PTR-1004',
   rate:2.5, funder:'partner', split:null, status:'active', from:'01 Jun 2026', to:'30 Sep 2026',
   capPerOrder:1200, capPerMonth:null, audience:'all',
   why:'A sensor is bought once and then bought again for every site. The seller funds the first one to '+
       'get the second.'},
  {id:'ERN-10', name:'Nimbus gateway attach',         scope:'partner',  scopeId:'PTR-1004',
   rate:2.0, funder:'shared', split:40, status:'pending', from:'01 Aug 2026', to:'31 Oct 2026',
   capPerOrder:800, capPerMonth:null, audience:'enterprise',
   why:'Gateways sell alongside sensors and rarely on their own. Proposed 60/40 with the marketplace '+
       'because both sides gain from the attach.'},
  {id:'ERN-08', name:'Insurance attach',              scope:'vertical', scopeId:'consumer',
   rate:1.5, funder:'shared', split:60, status:'paused', from:'01 May 2026', to:null,
   capPerOrder:400, capPerMonth:null, audience:'consumer',
   why:'Paused while the insurer reviews its share. Paused, not deleted — the history matters at reconciliation.'}
];
const ERNMAP={}; EARN_RULES.forEach(r=>ERNMAP[r.id]=r);

/* What points can be turned back into. Each option has a real cost to someone. */
/* Where a redemption actually settles.

   A point is a liability against this marketplace, so it has to be discharged
   against something this marketplace controls — a balance it holds, an invoice
   it raises, or an item in its own catalogue. An option fulfilled by a third
   party converts a liability the platform created in points into a debt it
   has to settle in cash, to somebody who never agreed to the programme. That
   is why `settles` is a field and not a comment: the editor refuses to publish
   an option that lands outside. */
const REDEEM_KINDS = [
  {k:'wallet',   label:'Marketplace wallet credit',        settles:'inside',  icon:'wallet',
   note:'Credit on the marketplace account, spendable on anything in the catalogue.'},
  {k:'bill',     label:'Credit on a marketplace invoice',  settles:'inside',  icon:'file',
   note:'Applied to the next invoice this marketplace raises against the account.'},
  {k:'basket',   label:'Discount at checkout',             settles:'inside',  icon:'package',
   note:'Taken off a basket in this marketplace at the moment of payment.'},
  {k:'voucher',  label:'Seller voucher, in-marketplace',   settles:'inside',  icon:'tag',
   note:'Spendable only against that seller’s own listings here. The seller funds it.'},
  {k:'tradein',  label:'Trade-in top-up',                  settles:'inside',  icon:'refresh',
   note:'Added to a trade-in valuation against a device bought here.'},
  {k:'delivery', label:'Delivery upgrade',                 settles:'inside',  icon:'send',
   note:'Applied to the shipping line of a marketplace order.'},
  {k:'external', label:'Fulfilled outside the marketplace',settles:'outside', icon:'ban',
   note:'A third party honours it, so the platform owes cash for a liability it created in points. '+
        'Not permitted on a live option.'}
];
const RKMAP={}; REDEEM_KINDS.forEach(k=>RKMAP[k.k]=k);
const redeemSettlesInside = o => ((RKMAP[o.kind]||{}).settles) === 'inside';

const REDEEM_OPTIONS = [
  {id:'RDM-01', name:'Wallet credit',            kind:'wallet',  min:100,  step:100,
   valuePer:1.00, cost:'operator', audience:'consumer', status:'active',
   desc:'100 points becomes $1.00 of wallet credit, spendable on anything in the marketplace.',
   why:'The plainest option, and the one that keeps the money inside the marketplace.'},
  {id:'RDM-02', name:'Credit on the next bill',  kind:'bill',    min:500,  step:500,
   valuePer:1.05, cost:'operator', audience:'all', status:'active',
   desc:'500 points becomes $5.25 off the next invoice — a 5% premium over wallet credit.',
   why:'Worth slightly more because a bill credit costs the platform nothing in payment fees.'},
  {id:'RDM-03', name:'Seller voucher',           kind:'voucher', min:1000, step:1000,
   valuePer:1.20, cost:'partner',  audience:'all', status:'active',
   desc:'1,000 points becomes a $12.00 voucher against that seller’s own listings here.',
   why:'The best rate, because the seller funds it to pull the customer back to their own catalogue.'},
  {id:'RDM-04', name:'Device trade-in top-up',   kind:'tradein', min:2000, step:1000,
   valuePer:1.30, cost:'partner',  audience:'consumer', status:'active',
   desc:'2,000 points adds $26.00 to a trade-in valuation on a device bought here.',
   why:'The highest rate on the board, and it only pays out against a sale the OEM wanted anyway.'},
  {id:'RDM-05', name:'Points off at checkout',   kind:'basket',  min:200,  step:100,
   valuePer:1.00, cost:'operator', audience:'all', status:'active',
   desc:'200 points takes $2.00 off the basket at payment, without a trip to the wallet first.',
   why:'The step that loses people is the one between earning and spending. This removes it.'},
  {id:'RDM-06', name:'Next-day delivery',        kind:'delivery',min:400,  step:400,
   valuePer:1.15, cost:'operator', audience:'all', status:'active',
   desc:'400 points upgrades the shipping line on a marketplace order.',
   why:'Cheap to us at the margin and worth more than its cost to somebody who needs it tomorrow.'},
  {id:'RDM-07', name:'Airport lounge pass',      kind:'external',min:15000, step:15000,
   valuePer:1.10, cost:'operator', audience:'consumer', status:'retired',
   desc:'15,000 points for a single lounge visit, honoured by a third party.',
   why:'Retired. Fulfilled outside the marketplace, so every redemption turned a points liability into '+
       'a cash invoice from a lounge operator. Redemption was also under 0.2%.'},
  {id:'RDM-08', name:'Donate to Digital Access', kind:'external',min:500,  step:500,
   valuePer:1.00, cost:'operator', audience:'all', status:'retired',
   desc:'500 points funded one month of connectivity for a student through an external fund.',
   why:'Retired for the same reason as the lounge pass — the value left the marketplace as cash. '+
       'Worth reinstating as a first-party catalogue item rather than a transfer to a third party.'}
];
const RDMMAP={}; REDEEM_OPTIONS.forEach(o=>RDMMAP[o.id]=o);

const LOYALTY_TXN_TYPES = [
  {t:'earn',    label:'Earned',      sign:1,  note:'Points issued against an order. Funded by whoever the rule names.'},
  {t:'bonus',   label:'Bonus',       sign:1,  note:'A one-off award outside the earn rules. Always has a named reason.'},
  {t:'redeem',  label:'Redeemed',    sign:-1, note:'Points exchanged for something. The liability is released here.'},
  {t:'expire',  label:'Expired',     sign:-1, note:'Points that reached 24 months unredeemed. Released to breakage.'},
  {t:'reverse', label:'Reversed',    sign:-1, note:'Points clawed back because the order behind them was refunded.'},
  {t:'adjust',  label:'Adjusted',    sign:0,  note:'A manual correction. Requires a reason and is always in the audit log.'}
];
const LTXMAP={}; LOYALTY_TXN_TYPES.forEach(x=>LTXMAP[x.t]=x);

/* Members. Consumers and enterprise organisations both hold an account, because
   an organisation that spends six figures and earns nothing notices. */
const LOYALTY_MEMBERS = [
  {id:'LM-4001', party:'CUS-449021', name:'Priya Raman',        kind:'consumer',
   tier:'gold',     balance:3180, joined:'14 Jun 2024', qualify12m:2140.55, lifetimeEarned:9420,
   lifetimeRedeemed:6240, expiringSoon:420, expiringOn:'30 Sep 2026', lastActivity:'25 Jul 2026'},
  {id:'LM-4002', party:'CUS-449118', name:'Arun Deshpande',     kind:'consumer',
   tier:'silver',   balance:1145, joined:'02 Sep 2024', qualify12m:812.40, lifetimeEarned:2960,
   lifetimeRedeemed:1815, expiringSoon:0, expiringOn:null, lastActivity:'22 Jul 2026'},
  {id:'LM-4003', party:'CUS-449204', name:'Meera Krishnan',     kind:'consumer',
   tier:'platinum', balance:11840, joined:'21 Mar 2024', qualify12m:5310.00, lifetimeEarned:24680,
   lifetimeRedeemed:12840, expiringSoon:0, expiringOn:null, lastActivity:'24 Jul 2026'},
  {id:'LM-4004', party:'CUS-449377', name:'Daniel Osei',        kind:'consumer',
   tier:'bronze',   balance:260, joined:'11 May 2026', qualify12m:196.00, lifetimeEarned:260,
   lifetimeRedeemed:0, expiringSoon:0, expiringOn:null, lastActivity:'25 Jul 2026'},
  {id:'LM-4005', party:'CUS-449512', name:'Sanya Kapoor',       kind:'consumer',
   tier:'silver',   balance:1890, joined:'08 Jan 2025', qualify12m:1024.75, lifetimeEarned:4110,
   lifetimeRedeemed:2220, expiringSoon:610, expiringOn:'31 Aug 2026', lastActivity:'25 Jul 2026'},
  {id:'LM-4101', party:'ORG-77120', name:'Brightline Foods',    kind:'enterprise',
   tier:'platinum', balance:74250, joined:'05 Apr 2024', qualify12m:118420.55, lifetimeEarned:186400,
   lifetimeRedeemed:112150, expiringSoon:8400, expiringOn:'31 Oct 2026', lastActivity:'24 Jul 2026'},
  {id:'LM-4102', party:'ORG-77208', name:'Harbourpoint Retail', kind:'enterprise',
   tier:'gold',     balance:21630, joined:'19 Aug 2024', qualify12m:38940.00, lifetimeEarned:54200,
   lifetimeRedeemed:32570, expiringSoon:0, expiringOn:null, lastActivity:'21 Jul 2026'},
  {id:'LM-4103', party:'ORG-77341', name:'Cadence Health',      kind:'enterprise',
   tier:'silver',   balance:6480, joined:'02 Feb 2025', qualify12m:14210.80, lifetimeEarned:16900,
   lifetimeRedeemed:10420, expiringSoon:0, expiringOn:null, lastActivity:'18 Jul 2026'}
];
const LMMAP={}; LOYALTY_MEMBERS.forEach(m=>{LMMAP[m.id]=m; LMMAP[m.party]=m;});

/* The ledger. Every movement, with the rule and the funder attached, because a
   points balance nobody can explain is a balance nobody can defend. */
const LOYALTY_LEDGER = [];
(function seedLedger(){
  /* member, date, type, points, ref, rule, funder, sellerId, note.
     sellerId is carried on the row rather than inferred from the order, because
     a seller reading their own reward cost should not depend on an order lookup
     that may have been archived. */
  const rows = [
    /* Priya Raman — the consumer persona's own account */
    ['LM-4001','25 Jul 2026','earn',   210,'ORD-881433','ERN-01','operator',null,      'Aegis Screen Cover — $140.00 at 1.5× Gold'],
    ['LM-4001','24 Jul 2026','redeem',-1500,'RDM-01',null,      'operator',null,       'Redeemed for $15.00 of wallet credit'],
    ['LM-4001','22 Jul 2026','earn',   840,'ORD-881311','ERN-02','shared','PTR-1005',  'PlayForge Season Pass — double earn on content'],
    ['LM-4001','19 Jul 2026','reverse',-585,'ORD-881204','ERN-01','operator',null,     'Kestrel K7 refunded — the points went back with the money'],
    ['LM-4001','19 Jul 2026','earn',   585,'ORD-881204','ERN-01','operator',null,      'Kestrel K7 handset — $389.00 at 1.5× Gold'],
    ['LM-4001','12 Jul 2026','bonus',  500,null,        null,    'operator',null,      'Goodwill after a delivery failure on ORD-880912'],
    ['LM-4001','04 Jul 2026','earn',   1890,'ORD-880788','ERN-06','partner','PTR-1002','Kestrel launch window — 3× on a $420.00 order'],
    ['LM-4001','28 Jun 2026','expire', -320,null,        null,    'operator',null,     'Earned Jun 2024, unredeemed at 24 months'],
    ['LM-4001','21 Jun 2026','redeem',-2400,'RDM-03',null,      'partner','PTR-1001',  'Seller voucher with StreamNova Media — $28.80'],
    ['LM-4001','15 Jun 2026','earn',   960,'ORD-880451','ERN-01','operator',null,      'Travel Cover Lite — annual premium'],
    /* Meera Krishnan — the high-value consumer */
    ['LM-4003','24 Jul 2026','earn',   1240,'ORD-881288','ERN-01','operator',null,     'Halo Music Family — Platinum 2×'],
    ['LM-4003','20 Jul 2026','redeem',-4000,'RDM-04',null,      'partner','PTR-1002',  'Trade-in top-up on a Kestrel K7 — $52.00'],
    ['LM-4003','11 Jul 2026','earn',   3600,'ORD-880940','ERN-06','partner','PTR-1002','Kestrel launch window'],
    /* Sanya Kapoor */
    ['LM-4005','25 Jul 2026','earn',   145,'ORD-881441','ERN-01','operator',null,      'Nimbus sensor pack'],
    ['LM-4005','16 Jul 2026','adjust', 300,null,        null,    'operator',null,      'Correction — ERN-02 cap applied twice on 14 Jul'],
    /* Daniel Osei — new member */
    ['LM-4004','25 Jul 2026','earn',   96,'ORD-881441','ERN-01','operator',null,       'First order on the account'],
    ['LM-4004','18 May 2026','bonus',  164,null,        null,    'operator',null,      'Joining bonus'],
    /* Brightline Foods — the enterprise persona's own account */
    ['LM-4101','24 Jul 2026','earn',   4210,'ORD-881402','ERN-04','operator',null,     'Nimbus IoT SIMs — enterprise accelerator'],
    ['LM-4101','22 Jul 2026','redeem',-25000,'RDM-02',null,     'operator',null,       'Credit on invoice INV-2026-0613 — $262.50'],
    ['LM-4101','18 Jul 2026','earn',   9600,'ORD-881207','ERN-05','partner','PTR-1003','Sentinel MDR first purchase — seller funded'],
    ['LM-4101','09 Jul 2026','earn',   2840,'ORD-880996','ERN-04','operator',null,     'IoT connectivity — monthly cap reached'],
    ['LM-4101','01 Jul 2026','expire', -1200,null,       null,    'operator',null,     'Earned Jun 2024, unredeemed at 24 months'],
    /* Harbourpoint Retail */
    ['LM-4102','21 Jul 2026','earn',   3120,'ORD-881350','ERN-05','partner','PTR-1003','Sentinel MDR — 40 seats'],
    ['LM-4102','14 Jul 2026','redeem',-12000,'RDM-02',null,     'operator',null,       'Credit on invoice INV-2026-0598 — $126.00'],
    /* Cadence Health */
    ['LM-4103','18 Jul 2026','earn',   1640,'ORD-881118','ERN-04','operator',null,     'IoT connectivity renewal'],
    /* Nimbus Sensors funds an accessory promotion of its own */
    ['LM-4005','09 Jul 2026','earn',   680,'ORD-881044','ERN-03','partner','PTR-1004', 'Nimbus tracker trade-in bonus'],
    ['LM-4002','17 Jul 2026','earn',   420,'ORD-881122','ERN-02','shared','PTR-1005',  'PlayForge content — double earn, shared 50/50'],
    ['LM-4002','05 Jul 2026','redeem',-1000,'RDM-03',null,      'partner','PTR-1005',  'PlayForge voucher — $12.00'],
    /* Nimbus Sensors funds two rules of its own, so the seller console has a
       real cost line to argue with rather than a single stray row. */
    ['LM-4101','23 Jul 2026','earn',   1200,'ORD-881402','ERN-09','partner','PTR-1004','Nimbus starter pack — cap reached on a $640 order'],
    ['LM-4103','19 Jul 2026','earn',   940,'ORD-881118','ERN-09','partner','PTR-1004', 'Nimbus sensor pack — 2.5× seller funded'],
    ['LM-4002','14 Jul 2026','earn',   525,'ORD-881090','ERN-09','partner','PTR-1004', 'Nimbus tracker — consumer purchase'],
    ['LM-4003','08 Jul 2026','earn',   1200,'ORD-880977','ERN-09','partner','PTR-1004','Nimbus starter pack — cap reached'],
    ['LM-4005','02 Jul 2026','reverse',-380,'ORD-880902','ERN-09','partner','PTR-1004','Order returned within 14 days — the points went back with it'],
    ['LM-4005','01 Jul 2026','earn',   380,'ORD-880902','ERN-09','partner','PTR-1004', 'Nimbus tracker pack'],
    ['LM-4102','27 Jun 2026','earn',   1200,'ORD-880844','ERN-09','partner','PTR-1004','Nimbus sensor rollout — cap reached'],
    ['LM-4101','24 Jun 2026','redeem',-3000,'RDM-03',null,      'partner','PTR-1004',  'Nimbus voucher against a gateway order — $36.00']
  ];
  rows.forEach((r,i)=>{
    const [member,when,type,points,ref,rule,funder,sellerId,note]=r;
    LOYALTY_LEDGER.push({
      id:'LTX-'+(70100+i*3), member, when, type, points,
      ref:ref||null, ruleId:rule||null, funder, sellerId:sellerId||null,
      /* What the movement was worth in money, which is what the ledger and the
         liability account actually care about. */
      value:+(Math.abs(points)/LOYALTY.perUnit).toFixed(2),
      note
    });
  });
})();
const LTXFOR = m => LOYALTY_LEDGER.filter(t=>t.member===m);

/* Outstanding liability, which is the number a finance director asks for first. */
function loyaltyLiability(){
  const outstanding = LOYALTY_MEMBERS.reduce((a,m)=>a+m.balance,0);
  const gross = +(outstanding/LOYALTY.perUnit).toFixed(2);
  const expected = +(gross*(1-LOYALTY.breakage)).toFixed(2);
  const byFunder = {operator:0, partner:0, shared:0};
  LOYALTY_LEDGER.filter(t=>t.points>0).forEach(t=>{ byFunder[t.funder]=(byFunder[t.funder]||0)+t.points; });
  return {points:outstanding, gross, expected,
          breakageValue:+(gross-expected).toFixed(2), byFunder};
}

/* An enterprise account decides internally who may spend what it earned. */
const ENT_REWARD_POLICY = {
  redeemRole:'Finance director',
  raiseRole:'Any named buyer',
  autoApplyToInvoice:true,
  allocateToCostCentre:true,
  minRedeem:5000,
  note:'Rewards earned by the organisation belong to the organisation. A named buyer can propose a '+
    'redemption; only finance can take the credit, because it lands on an invoice.',
  costCentres:['Operations','IT','Retail estate','Logistics','Head office']
};

/* Which of the seller's own products issued points, and what it cost them. This
   is the only view of the programme a seller is entitled to — their own. */
function loyaltyForPartner(pid){
  const mine = LOYALTY_LEDGER.filter(t=>t.sellerId===pid);
  const issued  = mine.filter(t=>t.points>0).reduce((a,t)=>a+t.points,0);
  const clawed  = mine.filter(t=>t.type==='reverse').reduce((a,t)=>a+Math.abs(t.points),0);
  const redeemed= mine.filter(t=>t.type==='redeem').reduce((a,t)=>a+Math.abs(t.points),0);
  /* A shared rule only costs the seller its share, and the seller is entitled
     to see which half is theirs rather than the whole number. */
  const shareOf = t => {
    const r = t.ruleId? ERNMAP[t.ruleId] : null;
    return (t.funder==='shared' && r && r.split!=null) ? (100-r.split)/100 : 1;
  };
  const cost = mine.filter(t=>t.points>0)
    .reduce((a,t)=>a+(t.points/LOYALTY.perUnit)*shareOf(t),0);
  /* Redemptions the seller funds are a second, separate bill — a voucher or a
     trade-in top-up costs them at the moment it is spent, not when it was earned. */
  const burnCost = mine.filter(t=>t.type==='redeem')
    .reduce((a,t)=>{ const o=RDMMAP[t.ref]; return a+Math.abs(t.points)/LOYALTY.perUnit*((o&&o.valuePer)||1); },0);
  return {rows:mine, issued, clawed, redeemed, shareOf,
          cost:+cost.toFixed(2), burnCost:+burnCost.toFixed(2),
          total:+(cost+burnCost).toFixed(2)};
}

/* ==========================================================================
   M33 — GENERAL LEDGER: ACCOUNTS, MAPPING AND POSTINGS
   --------------------------------------------------------------------------
   Every charge the marketplace raises has to land somewhere in the ledger, and
   a marketplace is harder than a shop: most of the money passing through does
   not belong to it. Gross value collected on a seller's behalf is a liability,
   not revenue. Only commission and fees are earned.

   Getting that wrong overstates revenue by roughly the size of the marketplace,
   which is why the mapping is configuration with a stated rule rather than
   something buried in a posting routine.
   ========================================================================== */

const GL_TYPES = ['Asset','Liability','Revenue','Expense','Equity','Tax','Contra'];

const GL_ACCOUNTS = [
  {code:'1010', name:'Bank — collections',            type:'Asset',     note:'Money received from buyers.'},
  {code:'1020', name:'Bank — payouts',                type:'Asset',     note:'Account settlements are paid from.'},
  {code:'1100', name:'Accounts receivable',           type:'Asset',     note:'Invoiced and not yet collected.'},
  {code:'1190', name:'Allowance for doubtful debt',   type:'Contra',    note:'Against receivables in dunning.'},
  {code:'2010', name:'Seller payable — clearing',     type:'Liability', note:'Gross collected on a seller’s behalf. Not ours.'},
  {code:'2020', name:'Seller payable — approved',     type:'Liability', note:'Settlement approved, not yet paid.'},
  {code:'2100', name:'Deferred revenue',              type:'Liability', note:'Billed in advance, not yet earned.'},
  {code:'2200', name:'Output tax payable',            type:'Tax',       note:'Tax collected, owed to the authority.'},
  {code:'2210', name:'Withholding tax payable',       type:'Tax',       note:'Withheld from a seller, owed to the authority.'},
  {code:'4010', name:'Commission revenue',            type:'Revenue',   note:'What the marketplace actually earns.'},
  {code:'4020', name:'Listing and platform fees',     type:'Revenue',   note:'Fixed fees under a commercial model.'},
  {code:'4030', name:'Advertising revenue',           type:'Revenue',   note:'Paid placement, where sold.'},
  {code:'4900', name:'Refunds and allowances',        type:'Contra',    note:'Against revenue, never netted silently.'},
  {code:'5010', name:'Payment processing costs',      type:'Expense',   note:'Acquirer and gateway fees.'},
  {code:'5020', name:'Channel delivery costs',        type:'Expense',   note:'SMS, WhatsApp and email spend.'},
  {code:'5030', name:'Bad debt written off',          type:'Expense',   note:'Recognised when a case terminates.'},
  {code:'6010', name:'Marketplace-funded discount',   type:'Expense',   note:'Discount the marketplace paid for, not the seller.'},
  /* A point issued is a promise to give something away later, so it is a
     liability from the moment it is earned rather than a cost when it is spent. */
  {code:'2040', name:'Reward points liability',       type:'Liability', note:'Points issued and not yet redeemed or expired.'},
  {code:'6020', name:'Reward points — marketplace',   type:'Expense',   note:'Points the marketplace funded. Marketing spend.'},
  {code:'6030', name:'Reward points — recoverable',   type:'Asset',     note:'Points a seller funded, recovered on their settlement.'},
  {code:'4040', name:'Reward breakage',               type:'Revenue',   note:'Liability released when points expire unredeemed.'},
  /* Stored value is somebody else's money until they spend it. */
  {code:'2050', name:'Customer wallet liability',     type:'Liability', note:'Balances held on behalf of customers.'},
  {code:'4050', name:'Wallet breakage',               type:'Revenue',   note:'Released only where a dormant balance is legally forfeit.'}
];
GL_ACCOUNTS.forEach(a=>{ a.system=true; });   /* shipped chart — extendable, not removable */
const GLMAP={}; GL_ACCOUNTS.forEach(a=>GLMAP[a.code]=a);

/* Charge types. Each is a thing that can happen commercially. */
const GL_CHARGES = [
  {id:'order.gross',      label:'Order collected from buyer',      group:'Order'},
  {id:'order.commission', label:'Commission earned on an order',   group:'Order'},
  {id:'order.tax',        label:'Tax collected on an order',       group:'Order'},
  {id:'order.refund',     label:'Refund to a buyer',               group:'Order'},
  {id:'note.credit',      label:'Credit note to a seller',         group:'Adjustment'},
  {id:'note.debit',       label:'Debit note to a seller',          group:'Adjustment'},
  {id:'fee.listing',      label:'Fixed platform or listing fee',   group:'Fees'},
  {id:'fee.payment',      label:'Payment processing cost',         group:'Fees'},
  {id:'fee.perorder',     label:'Per-order fee charged to seller', group:'Fees'},
  {id:'settle.approved',  label:'Settlement approved',             group:'Settlement'},
  {id:'settle.paid',      label:'Settlement paid out',             group:'Settlement'},
  {id:'settle.withheld',  label:'Withholding tax retained',        group:'Settlement'},
  {id:'reward.issued.op', label:'Points issued — marketplace funded',group:'Rewards'},
  {id:'reward.issued.ptr',label:'Points issued — seller funded',    group:'Rewards'},
  {id:'reward.redeemed',  label:'Points redeemed',                  group:'Rewards'},
  {id:'reward.expired',   label:'Points expired — breakage',        group:'Rewards'},
  {id:'reward.recovered', label:'Seller share recovered',           group:'Rewards'},
  {id:'sub.billed',       label:'Subscription billed in advance',  group:'Subscription'},
  {id:'sub.earned',       label:'Subscription revenue recognised', group:'Subscription'},
  {id:'promo.funded',     label:'Marketplace-funded discount',     group:'Commercial'},
  {id:'ad.revenue',       label:'Advertising placement sold',      group:'Commercial'},
  {id:'dun.provision',    label:'Doubtful debt provision raised',  group:'Collections'},
  {id:'dun.writeoff',     label:'Debt written off',                group:'Collections'},
  {id:'ntf.cost',         label:'Channel delivery cost',           group:'Operations'}
];
const GL_CHARGE_GROUPS = ['Order','Fees','Settlement','Subscription','Commercial','Adjustment','Collections','Operations','Rewards'];

/* The mapping. Debit and credit per charge, with the reasoning where it is
   not obvious — and it is usually not obvious. */
const GL_MAPPING = {
  'order.gross':      {dr:'1010', cr:'2010', why:'Gross collected belongs to the seller until settlement. Booking it to revenue would overstate income by the size of the marketplace.'},
  'order.commission': {dr:'2010', cr:'4010', why:'Commission moves out of the seller’s clearing balance and becomes ours. This is the only line that is genuinely revenue.'},
  'order.tax':        {dr:'2010', cr:'2200', why:'Tax is never revenue. It is collected on the authority’s behalf.'},
  'order.refund':     {dr:'4900', cr:'1010', why:'A refund is a contra against revenue, shown separately rather than netted into it.'},
  'note.credit':      {dr:'4010', cr:'2010', why:'A credit note gives commission back. It reduces our revenue and increases what the seller is owed, which is a liability until the run pays it.'},
  'note.debit':       {dr:'2010', cr:'4010', why:'A debit note takes more from the seller\u2019s clearing balance into our revenue. It is the one adjustment that increases income, so it carries the heaviest approval.'},
  'fee.listing':      {dr:'1100', cr:'4020', why:'Invoiced to the seller, earned by us.'},
  'fee.payment':      {dr:'5010', cr:'1010', why:'A real cost to the marketplace, not a deduction from the seller unless the plan says so.'},
  'fee.perorder':     {dr:'2010', cr:'4020', why:'Deducted from what we owe the seller.'},
  'settle.approved':  {dr:'2010', cr:'2020', why:'Approval fixes the amount. It moves from an estimate to a payable.'},
  'settle.paid':      {dr:'2020', cr:'1020', why:'The payable is discharged when the money leaves.'},
  'reward.issued.op': {dr:'6020', cr:'2040', why:'A point the marketplace funded is spend now and an obligation now. Waiting until redemption would flatter every period until someone spends them all at once.'},
  'reward.issued.ptr':{dr:'6030', cr:'2040', why:'A point the seller funded is still our obligation to the customer, but it is recoverable from the seller, so it sits as an asset rather than an expense.'},
  'reward.redeemed':  {dr:'2040', cr:'2010', why:'Redemption discharges the obligation. The value moves to whatever the customer took — here, the clearing balance that funds it.'},
  'reward.expired':   {dr:'2040', cr:'4040', why:'Points that died unredeemed release the liability. This is breakage, and it is real income — which is exactly why it is booked visibly rather than netted against the expense.'},
  'reward.recovered': {dr:'2010', cr:'6030', why:'The seller’s share comes off their settlement, clearing the recoverable.'},
  'wallet.topup':     {dr:'1010', cr:'2050', why:'Money arrives in the bank and the platform owes it straight back. A top-up is never revenue, however long it sits there.'},
  'wallet.spend':     {dr:'2050', cr:'2010', why:'Spending discharges the obligation to the customer and creates one to the seller. The money never became ours in between.'},
  'wallet.goodwill':  {dr:'6020', cr:'2050', why:'Goodwill credit is marketing spend the moment it is issued, and a liability at the same moment. It is not the customer’s money and is never refunded as cash.'},
  'wallet.refundout': {dr:'2050', cr:'1020', why:'The customer asked for their money back. Only the cash pot can go this way.'},
  'wallet.dormant':   {dr:'2050', cr:'4050', why:'Released only where a dormant balance is legally forfeit. Everywhere else it is returned or escheated, and this line is not used.'},
  'settle.withheld':  {dr:'2010', cr:'2210', why:'Withheld from the seller and owed to the authority, not kept by us.'},
  'sub.billed':       {dr:'1100', cr:'2100', why:'Billing in advance creates an obligation, not income.'},
  'sub.earned':       {dr:'2100', cr:'4010', why:'Revenue is recognised as the service is delivered, not when it is invoiced.'},
  'promo.funded':     {dr:'6010', cr:'2010', why:'A marketplace-funded discount is our cost. The seller is still owed their full share.'},
  'ad.revenue':       {dr:'1100', cr:'4030', why:'Earned by us outright.'},
  'dun.provision':    {dr:'5030', cr:'1190', why:'Provision is raised when recovery becomes doubtful, not when it fails.'},
  'dun.writeoff':     {dr:'1190', cr:'1100', why:'The write-off consumes the provision already raised.'},
  'ntf.cost':         {dr:'5020', cr:'1010', why:'Operating cost of talking to customers.'}
};

const GL_PERIODS = [
  {id:'2026-05', label:'May 2026',  status:'closed', closedOn:'04 Jun 2026', closedBy:'Ruben Oyelaran'},
  {id:'2026-06', label:'June 2026', status:'closed', closedOn:'03 Jul 2026', closedBy:'Ruben Oyelaran'},
  {id:'2026-07', label:'July 2026', status:'open',   closedOn:null, closedBy:null}
];

/* Postings. Generated from real records, so the ledger reconciles to the
   order register rather than being invented alongside it. */
const GL_POSTINGS = [];
(function postLedger(){
  let seq=90001;
  const push=(charge, amount, ref, when, period)=>{
    const m=GL_MAPPING[charge]; if(!m || !amount) return;
    GL_POSTINGS.push({
      id:'JE-'+(seq++), charge:charge, amount:+(+amount).toFixed(2),
      dr:m.dr, cr:m.cr, ref:ref, when:when||'25 Jul 2026', period:period||'2026-07',
      source:'automatic'
    });
  };
  /* A representative slice of the order register rather than all 2,600 —
     enough to reconcile and few enough to read. */
  ORDERS.slice(0,60).forEach(o=>{
    const tax=+(o.gross*0.18/1.18).toFixed(2);
    push('order.gross',      o.gross, o.id);
    push('order.tax',        tax,     o.id);
    push('order.commission', o.comm,  o.id);
    if(o.failed) push('order.refund', o.gross, o.id);
  });
  SETTLEMENTS.slice(0,10).forEach(s=>{
    push('settle.approved', s.net,      s.id);
    push('settle.withheld', s.withheld, s.id);
    if(s.status==='paid') push('settle.paid', s.net, s.id);
  });
  DUNNING_CASES.slice(0,6).forEach(d=>{
    push('dun.provision', d.amount, d.id);
    if(d.state==='suspended') push('dun.writeoff', d.amount, d.id);
  });
  /* Notes and refunds only post once they have actually landed. A draft or a
     pending note has no place in the ledger — it is a proposal, not a fact. */
  CREDIT_NOTES.filter(n=>n.state==='issued'||n.state==='applied').forEach(n=>{
    push(n.type==='credit'?'note.credit':'note.debit', n.amount, n.id, n.raised);
  });
  REFUNDS.filter(r=>r.state==='refunded'||r.state==='partial').forEach(r=>{
    push('order.refund', r.amount, r.id, r.decided);
  });
  CHANNEL_SPEND.lines.forEach(l=>{ if(l.cost) push('ntf.cost', l.cost, l.chan); });
  /* The reward programme posts like anything else, because a liability nobody
     books is a liability nobody manages. */
  WALLET_LEDGER.forEach(t=>{
    const v=Math.abs(t.amount);
    if(t.source==='spend')          push('wallet.spend', v, t.id, t.when);
    else if(t.source==='goodwill')  push('wallet.goodwill', v, t.id, t.when);
    else if(t.source==='reward')    push('reward.redeemed', v, t.id, t.when);
    else                            push('wallet.topup', v, t.id, t.when);
  });
  LOYALTY_LEDGER.forEach(t=>{
    const v=t.value;
    if(t.type==='earn'||t.type==='bonus')
      push(t.funder==='partner'?'reward.issued.ptr':'reward.issued.op', v, t.id, t.when);
    else if(t.type==='redeem') push('reward.redeemed', v, t.id, t.when);
    else if(t.type==='expire') push('reward.expired',  v, t.id, t.when);
    else if(t.type==='reverse') push(t.funder==='partner'?'reward.issued.ptr':'reward.issued.op', -v, t.id, t.when);
  });
  push('ad.revenue', 4820.00, 'Q3 placements');
  push('fee.listing', 1200.00, 'Platform fees Jul');
})();
