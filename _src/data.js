/* ===========================================================================
   Synthetic dataset — Enterprise Self-Care prototype.
   Deterministic (seeded) so every persona file shows the same account state
   and every derived metric reconciles. No real customer data.
   =========================================================================== */

function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}
const rnd = mulberry32(20260725);
const pick = arr => arr[Math.floor(rnd()*arr.length)];
const ri   = (a,b)=> a+Math.floor(rnd()*(b-a+1));
const rf   = (a,b,d)=> +(a+rnd()*(b-a)).toFixed(d==null?1:d);
const chance = p => rnd()<p;

const OPERATOR = { name:'Kestrel Telecom', brand:'Kestrel Business', region:'EU-West' };
const ENT = {
  id:'ENT-100482', name:'Meridian Logistics Group', legal:'Meridian Logistics Group B.V.',
  segment:'Enterprise — Transport & Logistics', since:'11 Mar 2021', tier:'Platinum',
  hq:'Rotterdam, Netherlands', vat:'NL8241 7739 B01', currency:'€',
  contractRef:'MSA-2021-0447', contractEnds:'31 Mar 2027', billingCycle:'Monthly, 1st',
  paymentTerms:'Net 30', primaryContact:'Anneke Visser', csm:'Ruben Oyelaran'
};

const FIRST=['Anneke','Ruben','Sofia','Mateo','Lars','Priya','Tomas','Elin','Idris','Nadia','Jonas','Meera','Felix','Katarina','Omar','Ingrid','Diego','Hanna','Viktor','Amara','Pieter','Yara','Stefan','Lotte','Karim','Freya','Bruno','Sanne','Elias','Zofia','Marek','Nour','Joost','Ada','Dmitri','Isabel','Kwame','Britt','Rafael','Maja'];
const LAST =['Visser','Oyelaran','Almeida','Berg','Novak','Sharma','Kowalski','Lindqvist','Haddad','Petrov','Jansen','Rao','Weber','Ilves','Farah','Sorensen','Moreau','Kaur','Dvorak','Okonkwo','de Vries','Nasr','Bakker','Meyer','Tahir','Larsen','Costa','Smit','Ruiz','Zielinski'];

const TEAMS = [
  {id:'T-01', name:'Field operations',        cc:'CC-4100', region:'Benelux'},
  {id:'T-02', name:'Fleet & dispatch',        cc:'CC-4200', region:'Benelux'},
  {id:'T-03', name:'Corporate HQ',            cc:'CC-1000', region:'Netherlands'},
  {id:'T-04', name:'Sales & account teams',   cc:'CC-3300', region:'EU-West'},
  {id:'T-05', name:'Warehouse — Antwerp',     cc:'CC-4400', region:'Belgium'},
  {id:'T-06', name:'IT & infrastructure',     cc:'CC-2200', region:'Netherlands'}
];
const TEAM_W = [0.30,0.22,0.13,0.17,0.12,0.06];

const PLANS = [
  {id:'PL-BIZ-25',  name:'Business Mobile 25', data:25,  voice:'Unlimited', sms:2000, price:19.90, roam:'EU roam-like-home'},
  {id:'PL-BIZ-60',  name:'Business Mobile 60', data:60,  voice:'Unlimited', sms:'Unlimited', price:27.50, roam:'EU + UK'},
  {id:'PL-BIZ-UNL', name:'Business Unlimited', data:null, voice:'Unlimited', sms:'Unlimited', price:41.00, roam:'Global 60 GB'},
  {id:'PL-IOT-5',   name:'Fleet IoT 5',        data:5,   voice:'—', sms:200,  price:6.40,  roam:'EU'},
  {id:'PL-M2M-1',   name:'Telematics M2M 1',   data:1,   voice:'—', sms:100,  price:2.10,  roam:'EU'}
];
const PLAN_W=[0.34,0.26,0.10,0.20,0.10];
const DEVICES=['Samsung Galaxy S24','iPhone 15','iPhone 14','Pixel 8','Samsung XCover 7','Zebra TC22 (rugged)','Teltonika FMB920','CradlePoint R980'];

function weighted(arr,w){const r=rnd();let a=0;for(let i=0;i<arr.length;i++){a+=w[i];if(r<=a)return arr[i];}return arr[arr.length-1];}

const ADDONS=[
  {id:'AD-D20', name:'20 GB data booster', price:12.00, term:'One-off, current cycle', taken:41},
  {id:'AD-D50', name:'50 GB data booster', price:24.00, term:'One-off, current cycle', taken:12},
  {id:'AD-ROW', name:'Rest-of-world roaming 10 GB', price:29.00, term:'30 days', taken:8},
  {id:'AD-INT', name:'International call bundle', price:9.00, term:'Monthly, recurring', taken:23},
  {id:'AD-SIP', name:'Static IP (per line)', price:4.50, term:'Monthly, recurring', taken:6},
  {id:'AD-MDM', name:'Device management seat', price:2.80, term:'Monthly, recurring', taken:118}
];

/* ------------------------------- users/lines ----------------------------- */
const USERS=[];
const USED_EMAIL={};
for(let i=0;i<148;i++){
  const fn=pick(FIRST), ln=pick(LAST);
  let base=(fn[0]+'.'+ln.replace(/[^A-Za-z]/g,'')).toLowerCase(), e=base+'@gmail.com', n=1;
  while(USED_EMAIL[e]){ n++; e=base+n+'@gmail.com'; }
  USED_EMAIL[e]=1;
  const team=weighted(TEAMS,TEAM_W);
  const plan=weighted(PLANS,PLAN_W);
  const isM2M = plan.id==='PL-IOT-5'||plan.id==='PL-M2M-1';
  const status = chance(.86)?'active':chance(.5)?'suspended':chance(.55)?'invited':'deactivated';
  const allow = plan.data;
  const used  = status==='active' ? (allow==null ? rf(20,180) : rf(allow*0.15, allow*(chance(.14)?1.28:0.96))) : (status==='suspended'? rf(0.4,4):null);
  USERS.push({
    id:'U-'+String(1000+i),
    name:isM2M ? ('Unit '+String(4100+i)+' · '+team.name.split(' ')[0]) : (fn+' '+ln),
    email:isM2M ? '—' : e,
    phone:'+31 6 '+ri(10,99)+' '+ri(100,999)+' '+ri(10,99),
    msisdn:'+3162'+String(1000000+i*37%9000000).slice(0,7),
    teamId:team.id, teamName:team.name, cc:team.cc,
    role: 'User',
    status:status,
    planId:plan.id, planName:plan.name, planPrice:plan.price,
    simType: isM2M ? 'M2M SIM' : (chance(.42)?'eSIM':'Physical SIM'),
    iccid:'8931'+String(ri(100000000000000,999999999999999)),
    device: isM2M ? pick(['Teltonika FMB920','CradlePoint R980']) : pick(DEVICES.slice(0,6)),
    dataAllowGb: allow,
    dataUsedGb: used,
    voiceMin: isM2M ? null : (status==='active'? ri(12,940):null),
    smsCount: status==='active'? ri(0,180):null,
    roamingGb: (status==='active'&&chance(.22))? rf(0.2,7.5,2):0,
    lastActive: status==='active' ? pick(['2 min ago','14 min ago','1 h ago','3 h ago','Yesterday','2 d ago']) : (status==='invited'?'Never':'—'),
    joined: (2021+ri(0,4))+'-'+String(ri(1,12)).padStart(2,'0')+'-'+String(ri(1,28)).padStart(2,'0'),
    mfa: chance(.71)
  });
}
/* Team leaders + admins are promoted from the active population */
const LEADS={};
TEAMS.forEach(t=>{
  const c=USERS.filter(u=>u.teamId===t.id && u.status==='active' && u.email!=='—');
  const lead=c[0]; if(lead){ lead.role='Team leader'; t.leadId=lead.id; t.leadName=lead.name; LEADS[t.id]=lead; }
});
const ADMIN = USERS.find(u=>u.teamId==='T-03'&&u.status==='active'&&u.email!=='—');
if(ADMIN){ ADMIN.role='Enterprise admin'; ADMIN.name='Anneke Visser'; ADMIN.email='a.visser@gmail.com'; }
const ADMIN2 = USERS.filter(u=>u.teamId==='T-06'&&u.status==='active'&&u.email!=='—')[0];
if(ADMIN2){ ADMIN2.role='Enterprise admin'; }

/* Deliberate telemetry gap: six telematics units stopped reporting on 18 Jul.
   Their consumption is null — never zero — so the UI must declare it. */
const GAP_LINES = USERS.filter(u=>u.teamId==='T-02' && u.simType==='M2M SIM' && u.status==='active').slice(0,6);
if(GAP_LINES.length<6){
  USERS.filter(u=>u.teamId==='T-02' && u.status==='active' && u.email==='—')
       .slice(0,6-GAP_LINES.length).forEach(u=>GAP_LINES.push(u));
}
GAP_LINES.forEach(u=>{ u.dataUsedGb=null; u.voiceMin=null; u.smsCount=null; u.lastActive='18 Jul'; u.telemetryGap=true; });

TEAMS.forEach(t=>{
  const m=USERS.filter(u=>u.teamId===t.id);
  t.members=m.length;
  t.active=m.filter(u=>u.status==='active').length;
  t.dataUsedGb=+m.reduce((a,u)=>a+(u.dataUsedGb||0),0).toFixed(1);
  t.spend=+m.filter(u=>u.status!=='deactivated').reduce((a,u)=>a+u.planPrice,0).toFixed(2);
  if(!t.leadName){ t.leadName=null; }
});

/* ------------------------------ shared pools -----------------------------
   Allowances are sized to clean 256 GB blocks around the observed draw, so the
   headline percentages below are computed, not asserted. */
const POOLS=[
  {id:'PO-01', name:'Field operations pool',  teams:['T-01','T-05'], target:0.94, policy:'Auto-top-up at 90%', topup:'256 GB blocks'},
  {id:'PO-02', name:'Fleet telematics pool',  teams:['T-02'],        target:0.61, policy:'Hard stop at 100%', topup:'Manual'},
  {id:'PO-03', name:'Corporate & sales pool', teams:['T-03','T-04'], target:0.48, policy:'Notify at 80%', topup:'128 GB blocks'}
];
POOLS.forEach(p=>{
  p.usedGb=+USERS.filter(u=>p.teams.includes(u.teamId)).reduce((a,u)=>a+(u.dataUsedGb||0),0).toFixed(1);
  p.allowGb=Math.max(256, Math.ceil(p.usedGb/p.target/128)*128);
  p.pct=+(p.usedGb/p.allowGb*100).toFixed(1);
  p.members=USERS.filter(u=>p.teams.includes(u.teamId)&&u.status==='active').length;
  delete p.target;
});

/* --------------------------- sites, links, circuits ---------------------- */
const CITIES=[['Rotterdam','NL'],['Amsterdam','NL'],['Antwerp','BE'],['Brussels','BE'],['Duisburg','DE'],['Hamburg','DE'],['Lyon','FR'],['Paris','FR'],['Milan','IT'],['Barcelona','ES'],['Madrid','ES'],['Warsaw','PL'],['Prague','CZ'],['Vienna','AT'],['Zurich','CH'],['Gothenburg','SE'],['Copenhagen','DK'],['Dublin','IE'],['Manchester','UK'],['Porto','PT'],['Utrecht','NL'],['Eindhoven','NL'],['Ghent','BE'],['Cologne','DE'],['Bordeaux','FR'],['Naples','IT']];
const SITES=CITIES.map((c,i)=>{
  const type = i<18?'SD-WAN':'MPLS';
  const st = i===4?'down' : (i===7||i===13)?'degraded' : chance(.9)?'online':'degraded';
  const telemetryGap = (i===19||i===22);          /* Porto and Ghent: deliberately unmeasured */
  return {
    id:(type==='SD-WAN'?'SDW-':'MPL-')+String(101+i),
    name:c[0]+' '+(type==='SD-WAN'?((i%3===0||i===4)?'DC':'depot'):'hub'),
    city:c[0], country:c[1], type,
    status:st, noTelemetry:telemetryGap,
    bwMbps: type==='SD-WAN'? pick([100,200,500,1000]) : pick([50,100,200]),
    utilPct: telemetryGap? null : (st==='down'?null: rf(18,st==='degraded'?93:78)),
    latencyMs: telemetryGap? null : (st==='down'?null: rf(4,st==='degraded'?68:26)),
    lossPct: telemetryGap? null : (st==='down'?null: rf(0,st==='degraded'?2.4:0.25,2)),
    uptime30: st==='down'? 91.4 : st==='degraded'? rf(97.2,99.1,2) : rf(99.5,99.99,2),
    links: type==='SD-WAN'? (chance(.6)?2:1) : 1,
    policy: type==='SD-WAN'? pick(['Business-critical first','Voice priority','Balanced','Cost-optimised']) : 'CoS gold',
    lastChange: pick(['3 d ago','9 d ago','2 w ago','1 mo ago','6 w ago'])
  };
});
const SITE_DOWN = SITES.filter(s=>s.status==='down');
const SITE_DEG  = SITES.filter(s=>s.status==='degraded');
const SITE_NOTEL= SITES.filter(s=>s.noTelemetry);
const SITE_REPORTING = SITES.filter(s=>s.utilPct!=null);

/* ------------------------------- usage series ---------------------------- */
const MONTHS=['Aug','Sep','Oct','Nov','Dec','Jan','Feb','Mar','Apr','May','Jun','Jul'];
const USAGE_DATA = MONTHS.map((m,i)=>({l:m, v: i===0?null : +(2180+i*96+ (i%3)*70 + rnd()*160).toFixed(0)}));  /* Aug has no record */
const USAGE_VOICE= MONTHS.map((m,i)=>({l:m, v: i===0?null : ri(41000,58000)}));
const SPEND      = MONTHS.map((m,i)=>({l:m, v: +(9100+i*180+(i%4)*260+rnd()*320).toFixed(0)}));
const BUDGET     = MONTHS.map(m=>({l:m, v:11500}));

/* -------------------------------- invoices ------------------------------- */
const INV_PERIODS=['Jul 2026','Jun 2026','May 2026','Apr 2026','Mar 2026','Feb 2026','Jan 2026','Dec 2025','Nov 2025','Oct 2025','Sep 2025','Aug 2025'];
const INVOICES=INV_PERIODS.map((p,i)=>{
  const amt=+(SPEND[SPEND.length-1-i]?SPEND[SPEND.length-1-i].v:9800);
  const status = i===0?'open' : i===1?'overdue' : 'paid';
  return {
    id:'INV-2026-'+String(4180-i*3),
    period:p,
    issued:'01 '+p, due:(status==='open'?'31 ':'30 ')+p,
    amount:amt,
    recurring:+(amt*0.71).toFixed(2), usage:+(amt*0.19).toFixed(2), oneoff:+(amt*0.06).toFixed(2), tax:+(amt*0.04).toFixed(2),
    status,
    method: status==='paid'?pick(['SEPA direct debit','Bank transfer']):'—',
    paidOn: status==='paid'?('1'+ri(2,8)+' '+p):null,
    lines: ri(9,15)
  };
});
const INV_OPEN = INVOICES.filter(i=>i.status!=='paid');
const BAL_DUE = +INV_OPEN.reduce((a,i)=>a+i.amount,0).toFixed(2);

const PAY_METHODS=[
  {id:'PM-1', kind:'SEPA direct debit', detail:'NL91 •••• •••• 7723', holder:'Meridian Logistics Group B.V.', primary:true,  status:'active', expires:'—'},
  {id:'PM-2', kind:'Corporate card',    detail:'Visa •••• 4419',      holder:'A. Visser',                     primary:false, status:'active', expires:'09/2028'},
  {id:'PM-3', kind:'Corporate card',    detail:'Amex •••• 1006',      holder:'Finance dept',                  primary:false, status:'expired',expires:'02/2026'}
];

/* --------------------------------- orders -------------------------------- */
const ORDER_TYPES=['New mobile line','SIM swap','Plan upgrade','Plan downgrade','Add-on purchase','New SD-WAN site','MPLS bandwidth change','Line termination','eSIM activation'];
const ORDERS=[];
for(let i=0;i<26;i++){
  const u=pick(USERS);
  const st=weighted(['completed','inprogress','pending','rejected'],[0.5,0.24,0.2,0.06]);
  ORDERS.push({
    id:'ORD-'+String(78210+i*7),
    type:pick(ORDER_TYPES),
    subject:u.name, teamName:u.teamId?TEAMS.find(t=>t.id===u.teamId).name:'—',
    raisedBy: chance(.55)?'Anneke Visser':pick(Object.values(LEADS)).name,
    raised: pick(['Today','Yesterday','2 d ago','4 d ago','1 w ago','2 w ago','3 w ago']),
    status:st,
    eta: st==='completed'?'—':pick(['Today 17:00','Tomorrow','In 2 working days','In 5 working days']),
    value:+rf(0,340,2)
  });
}

/* -------------------------------- tickets -------------------------------- */
const TSUBJ=['Data session drops on depot Wi-Fi handover','SD-WAN link flapping at Duisburg DC','Invoice line item disputed — roaming charge','SIM swap not activating','MPLS latency above agreed SLA','User cannot receive OTP','Bulk line suspension request','eSIM QR code expired','Pooled data exhausted early','Static IP not reachable','Number porting stuck','Device unable to register on network'];
const TICKETS=[];
for(let i=0;i<34;i++){
  const st=weighted(['resolved','inprogress','open','pending'],[0.55,0.2,0.17,0.08]);
  const sev=weighted(['P1','P2','P3','P4'],[0.07,0.23,0.45,0.25]);
  const slaMap={P1:240,P2:480,P3:1440,P4:2880};
  const res= st==='resolved' ? ri(35, slaMap[sev]*(chance(.16)?1.6:0.8)) : null;
  const u=pick(USERS);
  TICKETS.push({
    id:'TCK-'+String(59120+i*3),
    subject:pick(TSUBJ),
    severity:sev, status:st,
    openedBy:u.name, teamId:u.teamId, teamName:TEAMS.find(t=>t.id===u.teamId).name,
    opened:pick(['Today 09:14','Today 11:40','Yesterday 16:02','2 d ago','4 d ago','1 w ago','2 w ago','3 w ago']),
    slaMins:slaMap[sev],
    resolutionMins:res,
    breached: res!=null && res>slaMap[sev],
    escalated: chance(.18),
    owner: chance(.5)?'Kestrel Telecom — Tier 2':'Kestrel Telecom — Tier 1',
    channel: pick(['Self-care portal','AI assistant','Email','Phone'])
  });
}
/* Ensure the SLA record is not artificially perfect — some resolutions overran. */
TICKETS.filter(t=>t.status==='resolved').forEach((t,i)=>{
  if(i%6===2){ t.resolutionMins=Math.round(t.slaMins*(1.14+(i%4)*0.22)); t.breached=true; }
});

const T_OPEN=TICKETS.filter(t=>t.status!=='resolved');
const T_RES =TICKETS.filter(t=>t.status==='resolved');
const MTTR  = T_RES.length ? Math.round(T_RES.reduce((a,t)=>a+t.resolutionMins,0)/T_RES.length) : null;
const SLA_OK= T_RES.length ? Math.round(T_RES.filter(t=>!t.breached).length/T_RES.length*100) : null;

/* -------------------------------- approvals ------------------------------ */
const APPROVALS=[
  {id:'APR-3301', who:'Field operations', requester:null, item:'20 GB data booster', reason:'Depot survey week — expect overage', cost:12.00, raised:'Today 08:52', status:'pending', policy:'Within your delegated limit (€50)'},
  {id:'APR-3302', who:null, requester:null, item:'Plan upgrade — Business Mobile 25 to 60', reason:'Frequent roaming to DE/FR', cost:7.60, raised:'Today 07:31', status:'pending', policy:'Within your delegated limit (€50)'},
  {id:'APR-3303', who:null, requester:null, item:'New mobile line + rugged device', reason:'New starter, Antwerp warehouse', cost:19.90, raised:'Yesterday 15:12', status:'pending', policy:'Requires enterprise admin — device capex'},
  {id:'APR-3304', who:null, requester:null, item:'International call bundle', reason:'Supplier calls to TR/AE', cost:9.00, raised:'2 d ago', status:'approved', policy:'Within your delegated limit (€50)'},
  {id:'APR-3305', who:null, requester:null, item:'50 GB data booster', reason:'Tethering for site survey', cost:24.00, raised:'4 d ago', status:'rejected', policy:'Duplicate of APR-3298'}
];

/* --------------------------------- audit --------------------------------- */
const AUDIT=[
  {when:'Today 11:42', who:'Anneke Visser', role:'Enterprise admin', what:'Suspended line +31 6 24 118 07 (M. Kowalski) — device reported lost', kind:'danger', ip:'145.94.x.x'},
  {when:'Today 10:07', who:'Anneke Visser', role:'Enterprise admin', what:'Allocated 256 GB top-up to Field operations pool', kind:'primary', ip:'145.94.x.x'},
  {when:'Today 09:15', who:'AARYA assistant', role:'AI (acted on approval)', what:'Raised ticket TCK-59120 on behalf of J. Bakker', kind:'primary', ip:'—'},
  {when:'Yesterday 17:31', who:'Ruben Oyelaran', role:'Team leader — Fleet & dispatch', what:'Approved add-on request APR-3304 (€9.00/mo)', kind:'success', ip:'145.94.x.x'},
  {when:'Yesterday 16:04', who:'Kestrel Telecom — Tier 2', role:'Operator (self-care view)', what:'Viewed invoice INV-2026-4177 in support context', kind:'primary', ip:'operator'},
  {when:'Yesterday 14:20', who:'Anneke Visser', role:'Enterprise admin', what:'Invited 4 users to Warehouse — Antwerp', kind:'primary', ip:'145.94.x.x'},
  {when:'2 d ago 09:58', who:'System', role:'Policy engine', what:'Auto-top-up triggered on Field operations pool at 90%', kind:'primary', ip:'—'},
  {when:'3 d ago 13:11', who:'Anneke Visser', role:'Enterprise admin', what:'Changed SD-WAN policy on Lyon depot to “Voice priority”', kind:'primary', ip:'145.94.x.x'},
  {when:'4 d ago 08:02', who:'Finance dept', role:'Enterprise admin', what:'Paid invoice INV-2026-4174 (€10,842.00) by SEPA direct debit', kind:'success', ip:'145.94.x.x'},
  {when:'1 w ago 15:44', who:'Anneke Visser', role:'Enterprise admin', what:'Deactivated 2 users following offboarding', kind:'danger', ip:'145.94.x.x'}
];

/* ------------------------------ notifications ---------------------------- */
const NOTIFS=[
  {when:'12 min ago', text:'Duisburg DC link is down — operator incident INC-88214 raised automatically', source:'Service health · SDW-105', kind:'danger', read:false},
  {when:'1 h ago',    text:'Field operations pool has passed 90% of its '+(POOLS[0].allowGb/1024).toFixed(1)+' TB allowance', source:'Usage threshold rule', kind:'danger', read:false},
  {when:'3 h ago',    text:'Invoice INV-2026-4177 is overdue by 4 days (€'+FMTX(INVOICES[1].amount)+')', source:'Billing', kind:'danger', read:false},
  {when:'Yesterday',  text:'Paris hub latency has been above the agreed SLA for 6 hours', source:'Service health · MPL-108', kind:'warning', read:true},
  {when:'Yesterday',  text:'3 add-on requests are waiting on a team-leader decision', source:'Approvals', kind:'warning', read:true},
  {when:'2 d ago',    text:'Scheduled maintenance on the Antwerp depot circuit, Sat 02:00–04:00 CET', source:'Operator maintenance', kind:'info', read:true}
];
function FMTX(n){return Math.round(n).toLocaleString('en-US')}

/* ----------------------------- derived headline -------------------------- */
const KPI = {
  users: USERS.length,
  activeUsers: USERS.filter(u=>u.status==='active').length,
  suspended: USERS.filter(u=>u.status==='suspended').length,
  invited: USERS.filter(u=>u.status==='invited').length,
  lines: USERS.filter(u=>u.status!=='deactivated').length,
  esim: USERS.filter(u=>u.simType==='eSIM').length,
  sites: SITES.length,
  sitesOnline: SITES.filter(s=>s.status==='online').length,
  dataUsedGb:+USERS.reduce((a,u)=>a+(u.dataUsedGb||0),0).toFixed(1),
  dataAllowGb: POOLS.reduce((a,p)=>a+p.allowGb,0),
  mrc:+USERS.filter(u=>u.status!=='deactivated').reduce((a,u)=>a+u.planPrice,0).toFixed(2),
  openTickets:T_OPEN.length,
  mttr:MTTR, slaOk:SLA_OK,
  balanceDue:BAL_DUE,
  pendingApprovals:APPROVALS.filter(a=>a.status==='pending').length,
  pendingOrders:ORDERS.filter(o=>o.status!=='completed'&&o.status!=='rejected').length
};
KPI.poolPct=+(KPI.dataUsedGb/KPI.dataAllowGb*100).toFixed(1);

/* -------------------- operator-side portfolio (self-care scope) ---------- */
const ENTERPRISES=[
  {id:'ENT-100482', name:'Meridian Logistics Group', segment:'Transport & logistics', users:KPI.users, lines:KPI.lines, sites:KPI.sites,
   health:'attention', openTickets:KPI.openTickets, balance:BAL_DUE, lastLogin:'8 min ago', adoption:78, csm:'Ruben Oyelaran'},
  {id:'ENT-100311', name:'Nordwind Energie AG', segment:'Utilities', users:612, lines:704, sites:41,
   health:'healthy', openTickets:3, balance:0, lastLogin:'34 min ago', adoption:91, csm:'Ruben Oyelaran'},
  {id:'ENT-100904', name:'Aviro Health Partners', segment:'Healthcare', users:288, lines:301, sites:12,
   health:'healthy', openTickets:1, balance:0, lastLogin:'2 h ago', adoption:64, csm:'Lena Fischer'},
  {id:'ENT-101220', name:'Karstadt Retail Group', segment:'Retail', users:1140, lines:1287, sites:96,
   health:'attention', openTickets:14, balance:41280.00, lastLogin:'Yesterday', adoption:52, csm:'Lena Fischer'},
  {id:'ENT-100077', name:'Baltic Marine Services', segment:'Maritime', users:96, lines:142, sites:7,
   health:'healthy', openTickets:0, balance:0, lastLogin:'3 d ago', adoption:38, csm:'Ruben Oyelaran'},
  {id:'ENT-101455', name:'Volta Mobility BV', segment:'Automotive', users:204, lines:2960, sites:5,
   health:'risk', openTickets:9, balance:18740.55, lastLogin:'11 d ago', adoption:19, csm:'Tomas Novak'},
  {id:'ENT-100638', name:'Helvetia Insurance Ops', segment:'Financial services', users:430, lines:448, sites:18,
   health:'healthy', openTickets:2, balance:0, lastLogin:'1 h ago', adoption:83, csm:'Tomas Novak'},
  {id:'ENT-101019', name:'Orion Facility Care', segment:'Facilities', users:760, lines:812, sites:33,
   health:'attention', openTickets:6, balance:9214.00, lastLogin:'5 h ago', adoption:47, csm:'Lena Fischer'}
];

/* Currency helper bound to the account */
const CUR = n => n==null ? null : ENT.currency + Math.abs(n).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
const CUR0= n => n==null ? null : ENT.currency + Math.round(n).toLocaleString('en-US');
