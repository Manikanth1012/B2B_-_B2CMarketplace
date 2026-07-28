/* ===========================================================================
   PERSONA: Enterprise End User  (10 agreed features)
   Scope: own line only. Nothing account-wide is visible or actionable.
   =========================================================================== */

const ME = (function(){
  const u = USERS.filter(x=>x.status==='active' && x.email!=='—' && x.teamId==='T-01' && x.dataAllowGb)[0] || USERS[0];
  u.name='Joost Bakker'; u.email='j.bakker@gmail.com'; u.role='User';
  u.planId='PL-BIZ-25'; u.planName='Business Mobile 25'; u.planPrice=19.90; u.dataAllowGb=25;
  u.dataUsedGb=21.6; u.voiceMin=418; u.smsCount=63; u.roamingGb=2.4;
  u.device='Samsung XCover 7'; u.simType='eSIM'; u.msisdn='+31 6 24 118 07';
  return u;
})();
const MY_TEAM = TEAMS.find(t=>t.id===ME.teamId);
const MY_POOL = POOLS.find(p=>p.teams.includes(ME.teamId));
const MY_TICKETS = TICKETS.slice(0,6).map((t,i)=>Object.assign({},t,{openedBy:ME.name, teamName:MY_TEAM.name,
  status:['open','inprogress','resolved','resolved','resolved','pending'][i]}));
const MY_OPEN = MY_TICKETS.filter(t=>t.status!=='resolved');
const MY_RES  = MY_TICKETS.filter(t=>t.status==='resolved');
const MY_MTTR = MY_RES.length?Math.round(MY_RES.reduce((a,t)=>a+(t.resolutionMins||0),0)/MY_RES.length):null;

const MY_DAILY = ['1','3','5','7','9','11','13','15','17','19','21'].map((d,i)=>
  ({l:d, v:+(0.55+i*0.16+(i%3)*0.12).toFixed(2)}));
const MY_MONTHS = MONTHS.map((m,i)=>({l:m, v: i<2?null : +(12+i*0.85+(i%4)*1.4).toFixed(1)}));

const MY_REQUESTS=[
  {id:'REQ-8841', item:'20 GB data booster', cost:12.00, raised:'Today 08:52', status:'pending', with:'Ruben Oyelaran (team leader)', note:'Depot survey week'},
  {id:'REQ-8830', item:'International call bundle', cost:9.00, raised:'2 d ago', status:'approved', with:'Ruben Oyelaran (team leader)', note:'Supplier calls to TR'},
  {id:'REQ-8812', item:'50 GB data booster', cost:24.00, raised:'4 d ago', status:'rejected', with:'Ruben Oyelaran (team leader)', note:'Duplicate of REQ-8802'},
  {id:'REQ-8798', item:'eSIM re-issue (new device)', cost:0, raised:'3 w ago', status:'completed', with:'Kestrel Telecom', note:'Device replaced'}
];

const AVAILABLE_ADDONS = ADDONS.filter(a=>a.price<=25);

const USER_INSIGHTS=[
  {icon:'warning', conf:'High confidence',
   title:'You will run out of data around 27 July',
   body:'You have used <strong>'+FMT.gb(ME.dataUsedGb)+' of '+ME.dataAllowGb+' GB</strong> on day 22 of 31. Your average is '+FMT.dec(ME.dataUsedGb/22,2)+' GB/day, which lands you at about 30 GB by cycle end. '+
        'A 20 GB booster at '+CUR(12)+' covers the gap; without it the overage is charged at '+CUR(4.50)+' per GB.',
   acts:'<button class="btn btn-sm btn-primary" onclick="App.go(\'addons\')">See boosters</button>'+
        '<button class="btn btn-sm" onclick="requestAddon(\'AD-D20\')">Request 20 GB</button>'},
  {icon:'globe', conf:'Medium confidence',
   title:'Roaming is a quarter of your data this cycle',
   body:FMT.gb(ME.roamingGb)+' of your '+FMT.gb(ME.dataUsedGb)+' came from Germany and Belgium between 14 and 19 July. Your plan roams like home in the EU, so this is not charged separately — but it does draw from the same allowance.',
   acts:'<button class="btn btn-sm" onclick="App.go(\'usage\')">Break it down</button>'},
  {icon:'smartphone', conf:'Low confidence — partial evidence',
   title:'Two data drops at the Antwerp depot',
   body:'Your line lost its data session twice on 19 July at the same location. Three other lines in your team show the same pattern. This may be a depot Wi-Fi handover issue rather than a network fault, but there is <strong>not enough evidence</strong> to conclude either way.',
   acts:'<button class="btn btn-sm" onclick="raiseMyTicket()">Report it</button>'}
];

/* ------------------------------ 1. Dashboard ----------------------------- */
function vMyDashboard(){
  const pctUsed=ME.dataUsedGb/ME.dataAllowGb*100;
  return pagehead('Hello, '+ME.name.split(' ')[0],
    esc(MY_TEAM.name)+' · '+esc(ENT.name)+' · your line '+esc(ME.msisdn)+' — day 22 of a 31-day cycle',
    '<button class="btn" onclick="raiseMyTicket()">'+ICO('support',13)+'Get help</button>'+
    '<button class="btn btn-primary" onclick="App.go(\'addons\')">'+ICO('plus',14)+'Add data</button>')+
  '<div class="stack">'+

  banner('warning','<strong>You are '+FMT.pct(pctUsed)+' through your data allowance with 9 days left.</strong> At your current rate you run out around 27 July. '+
    '<button class="linkbtn" onclick="requestAddon(\'AD-D20\')">Request a 20 GB booster</button>')+

  '<div class="grid g4">'+
    metric({icon:'database',label:'Data used',value:FMT.gb(ME.dataUsedGb),foot:'of '+ME.dataAllowGb+' GB · '+FMT.pct(pctUsed)})+
    metric({icon:'phone',label:'Voice minutes',value:FMT.num(ME.voiceMin),foot:'Unlimited on your plan'})+
    metric({icon:'message',label:'SMS sent',value:FMT.num(ME.smsCount),foot:'of 2,000 included'})+
    metric({icon:'globe',label:'Roaming data',value:FMT.gb(ME.roamingGb),foot:'DE and BE · roam-like-home'})+
  '</div>'+

  '<div class="grid g-2-1">'+
    panel('Your data this cycle',
      CH.line([{pts:MY_DAILY}],{fmt:n=>FMT.dec(n,1)+' GB',tip:n=>FMT.gb(n),aria:'Daily data consumption this cycle'})+
      '<div class="divider"></div>'+
      meter(ME.dataUsedGb/ME.dataAllowGb*100, FMT.gb(ME.dataUsedGb)+' of '+ME.dataAllowGb+' GB used')+
      '<div class="t-tiny muted" style="margin-top:7px">Projected at cycle end: about 30 GB. Anything above 25 GB is charged at '+CUR(4.50)+' per GB unless you add a booster.</div>',
      {icon:'activity',sub:'Day 1 to 21 · GB per day',
       acts:'<div class="seg" role="group" aria-label="Range"><button aria-pressed="true">This cycle</button>'+
            '<button aria-pressed="false" onclick="toast(\'12-month view\')">12 mo</button></div>'})+

    panel('Your service',
      '<div class="stack" style="gap:10px">'+
      '<div class="row"><span class="t-small grow">Mobile line</span>'+statusPill('active')+'</div>'+
      '<div class="row"><span class="t-small grow">Depot connectivity (Antwerp)</span>'+statusPill('degraded')+'</div>'+
      '<div class="row"><span class="t-small grow">Roaming</span>'+statusPill('active')+'</div>'+
      '<div class="row"><span class="t-small grow">Voicemail</span><span class="nodata">Not provisioned</span></div>'+
      '</div><div class="divider"></div>'+
      banner('warning','The Antwerp depot circuit is degraded. Your mobile line is unaffected; depot Wi-Fi may be slow.')+
      '<div class="divider"></div>'+
      '<dl class="deflist" style="grid-template-columns:96px 1fr">'+
        '<dt>Number</dt><dd class="t-num">'+esc(ME.msisdn)+'</dd>'+
        '<dt>Plan</dt><dd>'+esc(ME.planName)+'</dd>'+
        '<dt>SIM</dt><dd>'+esc(ME.simType)+'</dd>'+
        '<dt>Device</dt><dd>'+esc(ME.device)+'</dd>'+
      '</dl>',{icon:'smartphone'})+
  '</div>'+

  panel('AI insights', USER_INSIGHTS.map(aiInsight).join(''),
    {ai:true,flush:true,icon:'ai',
     sub:'Based on your own line only. Nothing here is shared with your colleagues.'})+

  '<div class="grid g3">'+
    panel('Your requests',
      '<div class="stack" style="gap:0">'+MY_REQUESTS.slice(0,3).map(r=>
        '<div class="row" style="padding:9px 0;border-bottom:1px solid var(--nim-line-100)">'+
        '<div class="grow"><div class="t-small strong">'+esc(r.item)+'</div>'+
        '<div class="t-tiny muted">'+esc(r.raised)+' · with '+esc(r.with)+'</div></div>'+
        statusPill(r.status)+'</div>').join('')+'</div>'+
      '<button class="btn btn-sm btn-quiet" style="margin-top:9px" onclick="App.go(\'addons\')">All requests</button>',
      {icon:'checklist'})+
    panel('Your tickets',
      '<div class="grid g2" style="gap:9px">'+
        metric({label:'Open',value:String(MY_OPEN.length),foot:MY_OPEN.filter(t=>t.escalated).length+' escalated'})+
        metric({label:'Avg. resolution',value:MY_MTTR!=null?FMT.mins(MY_MTTR):null,naLabel:'No history yet',foot:MY_RES.length+' resolved'})+
      '</div>'+
      '<button class="btn btn-sm btn-quiet" style="margin-top:9px" onclick="App.go(\'tickets\')">Open support</button>',
      {icon:'support'})+
    panel('Plans you could move to',
      '<div class="stack" style="gap:8px">'+PLANS.filter(p=>p.id!==ME.planId&&p.data!==1&&p.data!==5).map(p=>
        '<div class="row"><div class="grow"><div class="t-small strong">'+esc(p.name)+'</div>'+
        '<div class="t-tiny muted">'+(p.data==null?'Unlimited data':p.data+' GB')+' · '+CUR(p.price)+'/mo</div></div>'+
        '<button class="btn btn-sm" onclick="requestPlan(\''+p.id+'\')">Request</button></div>').join('')+'</div>'+
      '<div class="t-tiny muted" style="margin-top:9px">Plan changes need approval from your team leader.</div>',
      {icon:'package'})+
  '</div>'+
  '</div>';
}

/* ----------------------------- 2. My services ---------------------------- */
function vMyServices(){
  return pagehead('My services',
    'Everything provisioned against your identity. Anything you cannot change yourself shows who to ask.',
    '<button class="btn" onclick="raiseMyTicket()">'+ICO('support',13)+'Report a problem</button>')+
  '<div class="stack">'+
  '<div class="grid g2">'+
    panel('Mobile line',
      '<div class="row" style="margin-bottom:12px">'+statusPill('active')+
        '<span class="t-small muted grow">Activated '+esc(ME.joined)+'</span></div>'+
      '<dl class="deflist">'+
        '<dt>Number</dt><dd class="t-num">'+esc(ME.msisdn)+'</dd>'+
        '<dt>Plan</dt><dd>'+esc(ME.planName)+'<div class="t-tiny muted">'+ME.dataAllowGb+' GB data · unlimited voice · 2,000 SMS</div></dd>'+
        '<dt>Roaming</dt><dd>EU roam-like-home</dd>'+
        '<dt>Charged to</dt><dd>'+esc(MY_TEAM.name)+' ('+esc(MY_TEAM.cc)+')</dd>'+
        '<dt>Monthly cost</dt><dd>'+CUR(ME.planPrice)+' <span class="t-tiny muted">— billed to your employer, not to you</span></dd>'+
      '</dl>'+
      '<div class="divider"></div>'+
      '<div class="row wrap"><button class="btn btn-sm" onclick="App.go(\'sim\')">Manage SIM</button>'+
      '<button class="btn btn-sm" onclick="App.go(\'addons\')">Add-ons</button>'+
      '<button class="btn btn-sm" onclick="requestPlan(\'PL-BIZ-60\')">Request a plan change</button></div>',
      {icon:'smartphone'})+
    panel('Connectivity you use',
      '<div class="stack" style="gap:0">'+
      [['Antwerp depot','SD-WAN · 500 Mbps','degraded','Shared site — managed by IT'],
       ['Rotterdam DC','SD-WAN · 1000 Mbps','online','Shared site — managed by IT'],
       ['Remote access VPN','Always-on client','online','Managed by IT'],
       ['Fixed desk line','—','unavailable','Not assigned to you']]
      .map(r=>'<div class="row" style="padding:10px 0;border-bottom:1px solid var(--nim-line-100)">'+
        '<div class="grow"><div class="t-small strong">'+esc(r[0])+'</div><div class="t-tiny muted">'+esc(r[1])+' · '+esc(r[3])+'</div></div>'+
        (r[2]==='unavailable'?'<span class="nodata">Not assigned</span>':statusPill(r[2]))+'</div>').join('')+'</div>'+
      '<div class="divider"></div>'+
      banner('info','Site connectivity is provisioned for your whole team. Only an enterprise admin can change it — raise a ticket and it routes to them automatically.'),
      {icon:'network'})+
  '</div>'+
  panel('Add-ons active on your line',
    '<table class="tbl"><thead><tr><th>Add-on</th><th>Term</th><th class="num">Cost</th><th>Since</th><th>Status</th><th></th></tr></thead><tbody>'+
    '<tr><td class="cellmain">International call bundle</td><td>Monthly, recurring</td><td class="num t-num">'+CUR(9)+'</td><td>2 days ago</td><td>'+statusPill('active')+'</td>'+
    '<td class="acts"><button class="btn btn-sm btn-quiet" onclick="cancelAddon()">Cancel</button></td></tr>'+
    '<tr><td class="cellmain">Device management seat</td><td>Monthly, recurring</td><td class="num t-num">'+CUR(2.80)+'</td><td>Since activation</td><td>'+statusPill('active')+'</td>'+
    '<td class="acts"><span class="t-tiny muted">Mandatory</span></td></tr>'+
    '</tbody></table>',{flush:true,icon:'plus'})+
  '</div>';
}
function cancelAddon(){
  confirmAction({title:'Cancel international call bundle', subtitle:CUR(9)+' per month · active since 2 days ago', risk:'normal',
    confirmLabel:'Cancel add-on',
    impact:['Calls outside the EU revert to the standard per-minute rate from the start of the next cycle.',
            'The '+CUR(9)+' charge stops after the current cycle — this cycle is still billed in full.',
            'Your team leader is notified because they approved the original request.'],
    footNote:'You can request it again at any time.',
    onConfirm:()=>toast('Add-on cancelled from 01 Aug 2026','warn')});
}

/* ------------------------------- 3. My usage ----------------------------- */
function vMyUsage(){
  const pct=ME.dataUsedGb/ME.dataAllowGb*100;
  return pagehead('My usage',
    'Your consumption against your own allowance. Colleagues cannot see this; your team leader sees totals, not detail.',
    '<div class="seg" role="group" aria-label="Usage type"><button aria-pressed="true">Data</button>'+
    '<button aria-pressed="false" onclick="toast(\'Voice view\')">Voice</button>'+
    '<button aria-pressed="false" onclick="toast(\'SMS view\')">SMS</button></div>'+
    exportBtn('My usage'))+
  '<div class="stack">'+
  '<div class="grid g4">'+
    metric({icon:'database',label:'Data used',value:FMT.gb(ME.dataUsedGb),foot:meter(pct,FMT.pct(pct))})+
    metric({icon:'gauge',label:'Daily average',value:FMT.dec(ME.dataUsedGb/22,2)+' GB',foot:'Over 22 days'})+
    metric({icon:'trendup',label:'Projected at cycle end',value:'about 30 GB',foot:'<span class="delta down">'+SH('up',11)+'5 GB over allowance</span>'})+
    metric({icon:'wallet',label:'Estimated overage',value:CUR(22.50),foot:'At '+CUR(4.50)+' per GB, if unchanged'})+
  '</div>'+
  '<div class="grid g-2-1">'+
    panel('Daily consumption',
      CH.bars(MY_DAILY.map(d=>({l:d,v:d.v})),{fmt:n=>FMT.dec(n,1),tip:n=>FMT.gb(n),aria:'Daily data consumption'})+
      '<div class="t-tiny muted" style="margin-top:7px">The 14–19 July peak lines up with the Antwerp depot survey, when your device was tethering.</div>',
      {icon:'chart',sub:'GB per day, current cycle'})+
    panel('Where it went',
      CH.donut([{l:'Mobile data, home network',v:ME.dataUsedGb-ME.roamingGb-4.2},{l:'Roaming — DE, BE',v:ME.roamingGb},{l:'Tethering',v:4.2}],
        {centre:FMT.dec(ME.dataUsedGb,1),centreSub:'GB',fmt:n=>FMT.gb(n),aria:'Data split by source'}),
      {icon:'pie'})+
  '</div>'+
  '<div class="grid g2">'+
    panel('12-cycle history',
      CH.line([{pts:MY_MONTHS}],{fmt:n=>Math.round(n)+' GB',tip:n=>FMT.gb(n),aria:'Data usage over 12 cycles'})+
      '<div class="legend"><span><i style="background:#0099FF"></i>Your data</span>'+
      '<span><i style="background:#E4E4E4"></i>Aug–Sep 2025 — before your line was activated</span></div>',{icon:'history'})+
    panel('Voice and SMS',
      '<div class="stack" style="gap:14px">'+
        '<div><div class="row" style="margin-bottom:5px"><span class="t-small grow">Voice minutes</span>'+
        '<span class="t-small strong t-num">'+FMT.num(ME.voiceMin)+'</span></div>'+
        '<div class="t-tiny muted">Unlimited on Business Mobile 25 — no cap to show</div></div>'+
        '<div><div class="row" style="margin-bottom:5px"><span class="t-small grow">SMS</span>'+
        '<span class="t-small strong t-num">'+ME.smsCount+' of 2,000</span></div>'+meter(ME.smsCount/2000*100)+'</div>'+
        '<div><div class="row" style="margin-bottom:5px"><span class="t-small grow">Premium and international SMS</span>'+
        '<span class="t-small strong">'+NOTMEASURED()+'</span></div>'+
        '<div class="t-tiny muted">Your operator does not itemise these until the cycle closes</div></div>'+
      '</div>',{icon:'phone'})+
  '</div>'+
  '</div>';
}

/* --------------------------- 4. My SIM and device ------------------------ */
function vMySim(){
  return pagehead('SIM and device',
    'View your SIM profile and request a swap. Swaps are executed by the operator after identity verification.',
    '<button class="btn btn-primary" onclick="requestSwap()">'+ICO('swap',14)+'Request SIM swap</button>')+
  '<div class="stack">'+
  '<div class="grid g2">'+
    panel('SIM profile',
      '<div class="row" style="margin-bottom:12px">'+pill('info','eSIM')+statusPill('active')+'</div>'+
      '<dl class="deflist">'+
        '<dt>ICCID</dt><dd class="t-num">'+esc(ME.iccid)+'</dd>'+
        '<dt>Number</dt><dd class="t-num">'+esc(ME.msisdn)+'</dd>'+
        '<dt>Profile state</dt><dd>Downloaded and enabled</dd>'+
        '<dt>Activated</dt><dd>'+esc(ME.joined)+'</dd>'+
        '<dt>PUK</dt><dd><span class="nodata">Hidden — reveal requires a one-time code</span> '+
          '<button class="linkbtn" onclick="toast(\'One-time code sent to your registered email\')">Reveal</button></dd>'+
      '</dl>'+
      '<div class="divider"></div>'+
      '<div class="row wrap"><button class="btn btn-sm" onclick="toast(\'A fresh QR code is valid for 72 hours\')">'+ICO('monitor',13)+'Re-issue QR code</button>'+
      '<button class="btn btn-sm btn-danger" onclick="reportLost()">Report lost or stolen</button></div>',
      {icon:'sim'})+
    panel('Device',
      '<dl class="deflist">'+
        '<dt>Model</dt><dd>'+esc(ME.device)+'</dd>'+
        '<dt>Managed</dt><dd>Yes — enrolled in device management</dd>'+
        '<dt>OS</dt><dd>Android 14</dd>'+
        '<dt>Last seen on network</dt><dd>'+esc(ME.lastActive)+'</dd>'+
        '<dt>Battery health</dt><dd>'+NOTMEASURED()+'<div class="t-tiny muted">Not reported by the management agent</div></dd>'+
      '</dl>'+
      '<div class="divider"></div>'+
      banner('info','Your employer manages this device. IT can enforce policy and wipe work data, but cannot see your personal apps or content.'),
      {icon:'smartphone'})+
  '</div>'+
  panel('SIM history',
    '<ul class="timeline">'+
      '<li class="tl-success"><div class="tl-when">'+esc(ME.joined)+'</div><div class="tl-what">eSIM profile downloaded and enabled on '+esc(ME.device)+'</div><div class="tl-who">You</div></li>'+
      '<li class="tl-primary"><div class="tl-when">3 weeks ago</div><div class="tl-what">Profile re-issued after device replacement (REQ-8798)</div><div class="tl-who">Kestrel Telecom</div></li>'+
      '<li class="tl-primary"><div class="tl-when">3 weeks ago</div><div class="tl-what">Identity verified by one-time code before re-issue</div><div class="tl-who">Verification service</div></li>'+
    '</ul>',{icon:'history'})+
  '</div>';
}
function requestSwap(){
  openModal('<div class="modal-head">'+ICO('swap',18)+'<div class="grow"><h3 class="t-sub">Request a SIM swap</h3>'+
    '<div class="t-small muted">Your request goes to your enterprise admin, then to '+esc(OPERATOR.name)+'.</div></div>'+
    '<button class="iconbtn" onclick="closeModal()" aria-label="Close">'+ICO('x',16)+'</button></div>'+
    '<div class="modal-body stack">'+
      '<div class="field"><label for="swWhy">Why do you need a swap</label><select class="inp" id="swWhy" data-autofocus>'+
        '<option>New device</option><option>SIM is faulty</option><option>Device lost or stolen</option><option>Moving from physical SIM to eSIM</option></select></div>'+
      '<div class="field"><label for="swNote">Anything else we should know</label><textarea class="inp" id="swNote" placeholder="Optional"></textarea></div>'+
      '<div class="impact"><strong>What happens next</strong><ul>'+
        '<li>Your enterprise admin approves or declines — usually within a working day.</li>'+
        '<li>You verify your identity with a one-time code before the swap runs.</li>'+
        '<li>Your number stops working for up to 15 minutes during the swap.</li></ul></div>'+
    '</div>'+
    '<div class="modal-foot"><span class="t-tiny muted grow">No charge for the first swap in a 12-month period.</span>'+
    '<button class="btn btn-quiet" onclick="closeModal()">Cancel</button>'+
    '<button class="btn btn-primary" onclick="closeModal();toast(\'Swap request sent to your enterprise admin\')">Send request</button></div>',
    {label:'Request a SIM swap'});
}
function reportLost(){
  confirmAction({title:'Report this device lost or stolen', subtitle:ME.msisdn+' · '+ME.device, risk:'high',
    confirmLabel:'Suspend my line now', requireType:'SUSPEND',
    impact:['Your line is suspended <strong>immediately</strong> — no calls, SMS or data.',
            'The eSIM profile is disabled so it cannot be used on another device.',
            'Your enterprise admin and team leader are notified at once.',
            'Work data on the device is wiped by device management within 15 minutes.',
            'Only an enterprise admin can resume the line afterwards.'],
    footNote:'Do this only if the device is genuinely lost or stolen.',
    onConfirm:()=>toast('Line suspended and admin notified','warn')});
}

/* --------------------------- 5. Add-ons and requests --------------------- */
function vAddons(){
  return pagehead('Add-ons and requests',
    'Buy what falls inside the limit your admin set for you; anything above goes to your team leader for approval.',
    '<button class="btn btn-primary" onclick="requestAddon()">'+ICO('plus',14)+'New request</button>')+
  '<div class="stack">'+
  banner('info','Your self-service limit is <strong>'+CUR(25)+' per cycle</strong>. You have used '+CUR(9)+' of it. Requests above the limit are approved by '+esc(MY_TEAM.leadName||'your team leader')+'.')+
  '<div class="grid g3">'+AVAILABLE_ADDONS.map(a=>
    '<div class="card"><div class="card-head">'+ICO(a.name.includes('data')?'database':a.name.includes('roaming')?'globe':'phone',15)+
    '<div class="grow"><div class="t-sub">'+esc(a.name)+'</div><div class="t-tiny muted">'+esc(a.term)+'</div></div></div>'+
    '<div class="card-body"><div class="row" style="align-items:baseline"><span class="t-page t-num">'+CUR(a.price)+'</span>'+
    '<span class="t-tiny muted grow">'+(a.price<=25?'within your limit':'needs approval')+'</span></div>'+
    '<button class="btn '+(a.price<=25?'btn-primary':'')+' btn-sm" style="width:100%;justify-content:center;margin-top:11px" '+
    'onclick="requestAddon(\''+a.id+'\')">'+(a.price<=25?'Buy now':'Request approval')+'</button></div></div>').join('')+'</div>'+
  panel('Your requests', dt('dtMyReq',{
    rows:MY_REQUESTS, noun:'requests', pageSize:8, toolbar:false, sortKey:'id', sortDir:'desc',
    columns:[
      {key:'id',label:'Request',render:r=>'<div class="cellmain t-num">'+esc(r.id)+'</div><div class="cellsub">'+esc(r.raised)+'</div>'},
      {key:'item',label:'What',render:r=>'<div class="cellmain">'+esc(r.item)+'</div><div class="cellsub">'+esc(r.note)+'</div>'},
      {key:'cost',label:'Cost',align:'right',render:r=>r.cost?'<span class="t-num">'+CUR(r.cost)+'</span>':'<span class="dim">No charge</span>'},
      {key:'with',label:'With',render:r=>'<span class="t-small">'+esc(r.with)+'</span>'},
      {key:'status',label:'Status',render:r=>statusPill(r.status)},
      {key:'__acts',label:'',sort:false,render:r=>r.status==='pending'
        ? '<button class="btn btn-sm btn-quiet" onclick="toast(\'Reminder sent to your team leader\')">Nudge</button>'
        : r.status==='rejected' ? '<button class="btn btn-sm btn-quiet" onclick="toast(\'Reason: duplicate of REQ-8802\')">Why?</button>' : ''}
    ]}),{flush:true,icon:'checklist'})+
  '</div>';
}
function requestAddon(id){
  const a=ADDONS.find(x=>x.id===id)||ADDONS[0];
  const within=a.price<=25;
  confirmAction({
    title:within?('Buy '+a.name):('Request '+a.name), subtitle:CUR(a.price)+' · '+a.term,
    risk:'normal', confirmLabel:within?('Buy for '+CUR(a.price)):'Send for approval',
    body:'<div class="field"><label for="raWhy">Reason (helps your team leader decide)</label>'+
      '<textarea class="inp" id="raWhy" placeholder="e.g. depot survey week, expecting heavy tethering"></textarea></div>',
    impact:within
      ? ['The '+esc(a.name)+' is active within about 2 minutes.',
         CUR(a.price)+' is charged to '+esc(MY_TEAM.cc)+' — your employer, not you.',
         'This uses '+CUR(a.price)+' of your '+CUR(25)+' self-service limit for this cycle.',
         'Your team leader sees it in their team spend, but does not need to approve it.']
      : ['Nothing is charged until '+esc(MY_TEAM.leadName||'your team leader')+' approves.',
         'They see your reason, your current usage and the cost.',
         'Typical decision time on this account is under 4 hours.'],
    footNote:within?'Boosters apply to the current cycle only and do not roll over.':'You will be notified either way.',
    onConfirm:()=>toast(within?(a.name+' is active on your line'):'Request sent to '+(MY_TEAM.leadName||'your team leader'))
  });
}
function requestPlan(id){
  const p=PLANS.find(x=>x.id===id)||PLANS[1];
  confirmAction({title:'Request a move to '+p.name, subtitle:(p.data==null?'Unlimited data':p.data+' GB')+' · '+CUR(p.price)+'/mo',
    risk:'normal', confirmLabel:'Send for approval',
    body:'<div class="field"><label for="rpWhy">Why do you need this plan</label>'+
      '<textarea class="inp" id="rpWhy" placeholder="e.g. regular roaming to DE and FR"></textarea></div>',
    impact:['Your monthly cost changes from '+CUR(ME.planPrice)+' to '+CUR(p.price)+' — charged to '+esc(MY_TEAM.cc)+'.',
            'Upgrades apply immediately; downgrades wait until the start of the next cycle.',
            esc(MY_TEAM.leadName||'Your team leader')+' decides, and an enterprise admin is notified.'],
    onConfirm:()=>toast('Plan change request sent')});
}

/* ------------------------------ 6. My charges ---------------------------- */
function vMyInvoices(){
  const rows=INVOICES.slice(0,6).map((v,i)=>({
    id:v.id, period:v.period, plan:ME.planPrice,
    addons:i<3?9.00:0, usage:i===0?0:+(2+i*1.4).toFixed(2),
    total:+(ME.planPrice+(i<3?9:0)+(i===0?0:2+i*1.4)).toFixed(2), status:v.status
  }));
  return pagehead('My charges',
    'What your line costs your employer. These charges are settled by '+esc(ENT.legal)+' — nothing here is payable by you.',
    exportBtn('My charges'))+
  '<div class="stack">'+
  banner('info','You do not pay these charges. They are shown so you can see the cost of your line and check anything that looks wrong before your team leader does.')+
  '<div class="grid g4">'+
    metric({icon:'wallet',label:'Your line, this cycle',value:CUR(ME.planPrice+9),foot:'Plan '+CUR(ME.planPrice)+' + add-ons '+CUR(9)})+
    metric({icon:'database',label:'Estimated overage',value:CUR(22.50),foot:'If you stay on your current rate'})+
    metric({icon:'building',label:'Charged to',value:esc(MY_TEAM.cc),foot:esc(MY_TEAM.name)})+
    metric({icon:'trendup',label:'12-cycle average',value:CUR(rows.reduce((a,r)=>a+r.total,0)/rows.length),foot:'Your line only'})+
  '</div>'+
  panel('Charge history', dt('dtMyInv',{
    rows:rows, noun:'cycles', pageSize:8, toolbar:false, sortKey:'id', sortDir:'desc',
    columns:[
      {key:'period',label:'Cycle',render:r=>'<div class="cellmain">'+esc(r.period)+'</div><div class="cellsub t-num">'+esc(r.id)+'</div>'},
      {key:'plan',label:'Plan',align:'right',render:r=>'<span class="t-num">'+CUR(r.plan)+'</span>'},
      {key:'addons',label:'Add-ons',align:'right',render:r=>r.addons?'<span class="t-num">'+CUR(r.addons)+'</span>':'<span class="dim">—</span>'},
      {key:'usage',label:'Out of bundle',align:'right',render:r=>r.usage?'<span class="t-num">'+CUR(r.usage)+'</span>':'<span class="dim">None</span>'},
      {key:'total',label:'Total',align:'right',render:r=>'<span class="t-num cellmain">'+CUR(r.total)+'</span>'},
      {key:'status',label:'Account invoice',render:r=>statusPill(r.status)},
      {key:'__acts',label:'',sort:false,render:()=>'<button class="btn btn-sm btn-quiet" onclick="disputeCharge()">Query a charge</button>'}
    ]}),{flush:true,icon:'invoice'})+
  '</div>';
}
function disputeCharge(){
  openModal('<div class="modal-head">'+ICO('flag',18)+'<div class="grow"><h3 class="t-sub">Query a charge</h3>'+
    '<div class="t-small muted">This opens a ticket against the charge and notifies your team leader.</div></div>'+
    '<button class="iconbtn" onclick="closeModal()" aria-label="Close">'+ICO('x',16)+'</button></div>'+
    '<div class="modal-body stack">'+
      '<div class="field"><label for="dqWhat">Which charge</label><select class="inp" id="dqWhat" data-autofocus>'+
        '<option>Out-of-bundle data '+CUR(8.60)+'</option><option>International call bundle '+CUR(9)+'</option>'+
        '<option>Roaming data</option><option>Something else</option></select></div>'+
      '<div class="field"><label for="dqWhy">What looks wrong</label><textarea class="inp" id="dqWhy" placeholder="Be specific — dates, amounts, what you expected"></textarea></div>'+
    '</div>'+
    '<div class="modal-foot"><span class="t-tiny muted grow">Queried charges stay payable until the query is resolved.</span>'+
    '<button class="btn btn-quiet" onclick="closeModal()">Cancel</button>'+
    '<button class="btn btn-primary" onclick="closeModal();toast(\'Query raised — TCK-59224\')">Raise query</button></div>',
    {label:'Query a charge'});
}

/* ------------------------------ 7. My tickets ---------------------------- */
function vMyTickets(){
  return pagehead('Support',
    MY_OPEN.length+' open · your average resolution time is '+(MY_MTTR!=null?FMT.mins(MY_MTTR):'not measured yet'),
    '<button class="btn" onclick="AI.open()">'+ICO('ai',13)+'Ask the assistant</button>'+
    '<button class="btn btn-primary" onclick="raiseMyTicket()">'+ICO('plus',14)+'Raise a ticket</button>')+
  '<div class="stack">'+
  '<div class="grid g4">'+
    metric({icon:'inbox',label:'Open',value:String(MY_OPEN.length),foot:MY_OPEN.filter(t=>t.escalated).length+' escalated'})+
    metric({icon:'checkcircle',label:'Resolved',value:String(MY_RES.length),foot:'In the last 12 months'})+
    metric({icon:'clock',label:'Average resolution',value:MY_MTTR!=null?FMT.mins(MY_MTTR):null,naLabel:'Not measured yet',foot:'Your tickets only'})+
    metric({icon:'ai',label:'Solved without a ticket',value:'7',foot:'By the assistant, last 12 months'})+
  '</div>'+
  panel(null, dt('dtMyTck',{
    rows:MY_TICKETS, noun:'tickets', pageSize:10, sortKey:'id', sortDir:'desc', onRow:"openTicket('$ID')",
    searchFields:['id','subject','status'], searchPlaceholder:'Search your tickets',
    chips:[{key:'status',options:[{label:'Open',value:'open'},{label:'In progress',value:'inprogress'},{label:'Resolved',value:'resolved'}]}],
    columns:[
      {key:'id',label:'Ticket',render:r=>'<div class="cellmain t-num">'+esc(r.id)+'</div><div class="cellsub">'+esc(r.opened)+'</div>'},
      {key:'subject',label:'Subject',render:r=>'<div class="cellmain">'+esc(r.subject)+'</div><div class="cellsub">via '+esc(r.channel)+'</div>'},
      {key:'severity',label:'Severity',render:r=>sevPill(r.severity)},
      {key:'owner',label:'With',render:r=>'<span class="t-small">'+esc(r.owner)+'</span>'},
      {key:'resolutionMins',label:'Resolved in',align:'right',render:r=>r.status==='resolved'&&r.resolutionMins!=null?'<span class="t-num">'+FMT.mins(r.resolutionMins)+'</span>':'<span class="dim">Open</span>'},
      {key:'status',label:'Status',render:r=>statusPill(r.status)},
      {key:'__acts',label:'',sort:false,render:r=>'<button class="btn btn-sm btn-quiet" onclick="event.stopPropagation();openTicket(\''+r.id+'\')">Open</button>'}
    ]}),{flush:true})+
  panel('Escalation history',
    '<ul class="timeline">'+
      '<li class="tl-danger"><div class="tl-when">2 weeks ago</div><div class="tl-what">'+esc(MY_TICKETS[0].id)+' escalated to Tier 2 after no update in 4 hours</div><div class="tl-who">Automatic escalation policy</div></li>'+
      '<li class="tl-success"><div class="tl-when">2 weeks ago</div><div class="tl-what">Resolved by Tier 2 — depot access point firmware updated</div><div class="tl-who">Kestrel Telecom — Tier 2</div></li>'+
      '<li class="tl-primary"><div class="tl-when">2 months ago</div><div class="tl-what">Escalated by your team leader on your behalf</div><div class="tl-who">'+esc(MY_TEAM.leadName||'Team leader')+'</div></li>'+
    '</ul>',{icon:'trendup'})+
  '</div>';
}
function raiseMyTicket(){
  openModal('<div class="modal-head">'+ICO('support',18)+'<div class="grow"><h3 class="t-sub">Raise a ticket</h3>'+
    '<div class="t-small muted">Goes to '+esc(OPERATOR.name)+' support. Your team leader can see it but does not need to approve it.</div></div>'+
    '<button class="iconbtn" onclick="closeModal()" aria-label="Close">'+ICO('x',16)+'</button></div>'+
    '<div class="modal-body stack">'+
      banner('info','The assistant already resolves most of these. <button class="linkbtn" onclick="closeModal();AI.open()">Try it first</button>')+
      '<div class="field"><label for="mtWhat">What is wrong</label><select class="inp" id="mtWhat" data-autofocus>'+
        '<option>No data or very slow data</option><option>Cannot make or receive calls</option>'+
        '<option>SIM or eSIM problem</option><option>Roaming not working</option>'+
        '<option>A charge looks wrong</option><option>Cannot sign in</option><option>Something else</option></select></div>'+
      '<div class="field"><label for="mtWhen">When did it start</label><select class="inp" id="mtWhen">'+
        '<option>Just now</option><option selected>Today</option><option>Yesterday</option><option>Over a week ago</option></select></div>'+
      '<div class="field"><label for="mtDet">Tell us more</label><textarea class="inp" id="mtDet" placeholder="Where you were, what you were doing, anything you already tried"></textarea></div>'+
      '<label class="checkline"><input type="checkbox" checked> Attach diagnostics from my device (signal, network, last errors)</label>'+
    '</div>'+
    '<div class="modal-foot"><span class="t-tiny muted grow">Target response for this type: 1 working day.</span>'+
    '<button class="btn btn-quiet" onclick="closeModal()">Cancel</button>'+
    '<button class="btn btn-primary" onclick="closeModal();toast(\'Ticket TCK-59225 raised — target 1 working day\')">Raise ticket</button></div>',
    {wide:true,label:'Raise a ticket'});
}

/* --------------------- 8. My notifications and alerts -------------------- */
function vMyAlerts(){
  const mine=[
    {id:'MA-1', name:'Data allowance warnings', trigger:'At 80% and again at 100% of my allowance', ch:'Push, email', on:true, fired:'Today 06:22'},
    {id:'MA-2', name:'Request decisions', trigger:'When a request of mine is approved or declined', ch:'Push, email', on:true, fired:'2 d ago'},
    {id:'MA-3', name:'Ticket updates', trigger:'When support updates one of my tickets', ch:'Push, email', on:true, fired:'Yesterday'},
    {id:'MA-4', name:'Roaming started', trigger:'When my line registers on a network abroad', ch:'Push', on:true, fired:'19 Jul'},
    {id:'MA-5', name:'Service problems at my sites', trigger:'When a site I use is degraded or down', ch:'Push', on:true, fired:'12 min ago'},
    {id:'MA-6', name:'Monthly usage summary', trigger:'On the 1st of each cycle', ch:'Email', on:false, fired:'Never'}
  ];
  return pagehead('Notifications',
    'What you get told about, and how. These settings apply to you only.',
    '<button class="btn" onclick="App.notifications()">'+ICO('bell',13)+'Recent alerts</button>')+
  '<div class="stack">'+
  panel('My alerts', dt('dtMyAlerts',{
    rows:mine, noun:'alerts', pageSize:8, toolbar:false, sortKey:'id',
    columns:[
      {key:'name',label:'Alert',render:r=>'<div class="cellmain">'+esc(r.name)+'</div>'},
      {key:'trigger',label:'When',render:r=>'<span class="t-small">'+esc(r.trigger)+'</span>'},
      {key:'ch',label:'How',render:r=>'<div class="tagset">'+r.ch.split(', ').map(c=>'<span class="tag">'+esc(c)+'</span>').join('')+'</div>'},
      {key:'fired',label:'Last sent',render:r=>r.fired==='Never'?'<span class="dim">Never</span>':esc(r.fired)},
      {key:'on',label:'On',render:r=>'<label class="toggle"><input type="checkbox" '+(r.on?'checked':'')+
        ' onchange="toast(\''+esc(r.name)+' \'+(this.checked?\'on\':\'off\'))"><span class="track"></span>'+
        '<span class="sr-only">'+esc(r.name)+'</span></label>'}
    ]}),{flush:true,icon:'bell'})+
  '<div class="grid g2">'+
    panel('Quiet hours',
      '<div class="stack" style="gap:11px">'+
      '<label class="toggle"><input type="checkbox" checked><span class="track"></span>Mute non-urgent alerts overnight</label>'+
      '<div class="grid g2">'+
        '<div class="field"><label for="qhFrom">From</label><select class="inp" id="qhFrom"><option selected>22:00</option><option>23:00</option></select></div>'+
        '<div class="field"><label for="qhTo">Until</label><select class="inp" id="qhTo"><option selected>07:00</option><option>08:00</option></select></div>'+
      '</div>'+
      '<div class="hint t-tiny muted">Service outages at your sites always come through, quiet hours or not.</div>'+
      '</div><div class="divider"></div>'+
      '<div class="row"><span class="spacer"></span><button class="btn btn-primary" onclick="toast(\'Quiet hours saved\')">Save</button></div>',
      {icon:'clock'})+
    panel('What your employer can see',
      '<div class="stack" style="gap:9px">'+
      [['Your total data, voice and SMS volume','Yes','info'],
       ['Which sites and countries you used data in','Yes','info'],
       ['Your requests and their reasons','Yes','info'],
       ['Websites or apps you used','No','success'],
       ['Message and call content','No','success'],
       ['Your personal apps on a managed device','No','success']]
      .map(r=>'<div class="row"><span class="t-small grow">'+esc(r[0])+'</span>'+
        (r[1]==='Yes'?pill('info','Visible'):pill('success','Never'))+'</div>').join('')+
      '</div><div class="divider"></div>'+
      '<div class="t-tiny muted">Under GDPR you can ask for a copy of everything held about you. '+
      '<button class="linkbtn" onclick="toast(\'Data request raised — you will hear back within 30 days\')">Request my data</button></div>',
      {icon:'lock'})+
  '</div>'+
  '</div>';
}

/* --------------------------- 9. Profile and preferences ------------------ */
function vMyProfile(){
  return pagehead('My profile',
    'Your details, sign-in and preferences. Some fields are set by your employer and cannot be changed here.',
    '<button class="btn btn-primary" onclick="toast(\'Profile saved\')">Save changes</button>')+
  '<div class="stack">'+
  '<div class="grid g2">'+
    panel('Details',
      '<div class="row" style="margin-bottom:14px"><span class="avatar" style="width:44px;height:44px;font-size:15px" aria-hidden="true">'+esc(FMT.initials(ME.name))+'</span>'+
      '<div><div class="t-sub">'+esc(ME.name)+'</div><div class="t-small muted">'+esc(MY_TEAM.name)+' · '+esc(ENT.name)+'</div></div></div>'+
      '<div class="grid g2">'+
        '<div class="field"><label for="mpName">Name</label><input class="inp" id="mpName" value="'+esc(ME.name)+'" disabled>'+
        '<div class="hint">Set by your employer\'s directory.</div></div>'+
        '<div class="field"><label for="mpEmail">Work email</label><input class="inp" id="mpEmail" value="'+esc(ME.email)+'" disabled></div>'+
        '<div class="field"><label for="mpPhone">Contact number</label><input class="inp" id="mpPhone" value="'+esc(ME.phone)+'"></div>'+
        '<div class="field"><label for="mpAlt">Recovery email</label><input class="inp" id="mpAlt" placeholder="Personal address for one-time codes"></div>'+
      '</div>',{icon:'user'})+
    panel('Sign-in and security',
      '<div class="stack" style="gap:11px">'+
      '<div class="row"><div class="grow"><div class="t-small strong">Sign-in method</div>'+
        '<div class="t-tiny muted">One-time code to '+esc(ME.email)+' or '+esc(ME.msisdn)+'</div></div>'+pill('active','Passwordless')+'</div>'+
      '<div class="row"><div class="grow"><div class="t-small strong">Multi-factor authentication</div>'+
        '<div class="t-tiny muted">Required by your employer for this account</div></div>'+pill('success','On')+'</div>'+
      '<div class="row"><div class="grow"><div class="t-small strong">Session timeout</div>'+
        '<div class="t-tiny muted">Set by your employer</div></div><span class="t-small">30 minutes idle</span></div>'+
      '</div><div class="divider"></div>'+
      '<h4 class="t-sub" style="margin-bottom:8px">Signed-in devices</h4>'+
      '<table class="tbl"><tbody>'+
      '<tr><td><div class="cellmain">'+esc(ME.device)+'</div><div class="cellsub">Rotterdam, NL · this device</div></td><td>'+pill('active','Now')+'</td><td class="acts"><span class="t-tiny muted">Current</span></td></tr>'+
      '<tr><td><div class="cellmain">Chrome on Windows</div><div class="cellsub">Antwerp, BE · 3 days ago</div></td><td>'+pill('neutral','Idle')+'</td>'+
      '<td class="acts"><button class="btn btn-sm btn-quiet" onclick="toast(\'Session ended\')">Sign out</button></td></tr>'+
      '</tbody></table>',{icon:'shield'})+
  '</div>'+
  panel('Preferences',
    '<div class="grid g3">'+
      '<div class="field"><label for="mpLang">Language</label><select class="inp" id="mpLang"><option selected>English</option></select>'+
      '<div class="hint">More languages arrive with the multi-region rollout.</div></div>'+
      '<div class="field"><label for="mpTz">Time zone</label><select class="inp" id="mpTz"><option selected>Europe/Amsterdam (CET)</option><option>Europe/Brussels</option></select></div>'+
      '<div class="field"><label for="mpUnit">Data units</label><select class="inp" id="mpUnit"><option selected>GB</option><option>MB</option></select></div>'+
    '</div><div class="divider"></div>'+
    '<div class="row wrap" style="gap:18px">'+
      '<label class="toggle"><input type="checkbox"><span class="track"></span>Dark theme</label>'+
      '<label class="toggle"><input type="checkbox" checked><span class="track"></span>Reduce motion</label>'+
      '<label class="toggle"><input type="checkbox" checked><span class="track"></span>Show the AI assistant</label>'+
    '</div>',{icon:'settings'})+
  '</div>';
}

/* ------------------------------- registration ---------------------------- */
const VIEWS={
  home:vMyDashboard, services:vMyServices, usage:vMyUsage, sim:vMySim,
  addons:vAddons, charges:vMyInvoices, tickets:vMyTickets, alerts:vMyAlerts, profile:vMyProfile
};

App.init({
  product:'Enterprise Self-Care', tier:'6D ONE UI · '+OPERATOR.brand,
  env:'Production · EU-West',
  persona:{name:ME.name, role:'Enterprise user', org:ENT.name},
  searchScope:'my services', alertCount:2,
  notifications:[
    {when:'6 h ago', text:'You have used 80% of your data allowance', source:'My alerts · data threshold', kind:'danger', read:false},
    {when:'12 min ago', text:'Antwerp depot connectivity is degraded — your mobile line is unaffected', source:'Service status', kind:'warning', read:false},
    {when:'2 d ago', text:'Your international call bundle request was approved by Ruben Oyelaran', source:'Requests', kind:'success', read:true},
    {when:'19 Jul', text:'Your line started roaming in Germany — EU roam-like-home applies', source:'My alerts · roaming', kind:'info', read:true}
  ],
  footNote:ME.msisdn+' · '+MY_TEAM.name,
  aiName:'AARYA assistant',
  aiGreeting:'Hello '+esc(ME.name.split(' ')[0])+'. I can help with your line, your usage, your bill and any problem you are having. I only see your own data.'+
    '<div class="src">Sources: your usage records, your requests, your ticket history, service status for sites you use.</div>',
  aiSuggestions:['Why is my data running out?','How do I get more data?','Is there a problem at my depot?','What does my line cost?'],
  nav:[
    {label:'Overview', items:[{id:'home', label:'Dashboard', icon:'dashboard'}]},
    {label:'My services', items:[
      {id:'services', label:'My services', icon:'smartphone'},
      {id:'usage', label:'My usage', icon:'activity'},
      {id:'sim', label:'SIM and device', icon:'sim'},
      {id:'addons', label:'Add-ons and requests', icon:'package', count:MY_REQUESTS.filter(r=>r.status==='pending').length}]},
    {label:'Billing', items:[{id:'charges', label:'My charges', icon:'invoice'}]},
    {label:'Help', items:[
      {id:'tickets', label:'Support', icon:'support', count:MY_OPEN.length}]},
    {label:'Account', items:[
      {id:'alerts', label:'Notifications', icon:'bell'},
      {id:'profile', label:'My profile', icon:'user'}]}
  ],
  searchIndex:[
    {k:'Screen',t:'My dashboard',v:'home'},{k:'Screen',t:'My services',v:'services'},
    {k:'Screen',t:'My usage and data',v:'usage'},{k:'Screen',t:'SIM and device',v:'sim'},
    {k:'Screen',t:'Add-ons, boosters and requests',v:'addons'},{k:'Screen',t:'My charges',v:'charges'},
    {k:'Screen',t:'Support and tickets',v:'tickets'},{k:'Screen',t:'Notifications',v:'alerts'},
    {k:'Screen',t:'My profile and preferences',v:'profile'},
    {k:'Action',t:'Buy a data booster',v:'addons'},{k:'Action',t:'Request a SIM swap',v:'sim'},
    {k:'Action',t:'Report my device lost',v:'sim'}
  ],
  aiAnswer(q){
    if(/data|running out|allowance|out of/.test(q))
      return 'You have used <strong>'+FMT.gb(ME.dataUsedGb)+' of '+ME.dataAllowGb+' GB</strong> on day 22 of 31 — that is '+FMT.pct(ME.dataUsedGb/ME.dataAllowGb*100)+'.'+
        '<table><tr><th>Where it went</th><th>GB</th></tr><tr><td>Home network</td><td>'+FMT.dec(ME.dataUsedGb-ME.roamingGb-4.2,1)+'</td></tr>'+
        '<tr><td>Roaming (DE, BE)</td><td>'+FMT.dec(ME.roamingGb,1)+'</td></tr><tr><td>Tethering</td><td>4.2</td></tr></table>'+
        'At your current rate you finish the cycle around 30 GB. A 20 GB booster costs '+CUR(12)+' and is inside your self-service limit, so you can buy it yourself.'+
        '<div class="src">Sources: your daily usage records, plan catalogue, your spend limit.</div>';
    if(/more data|booster|top.?up|add.?on/.test(q))
      return 'Two options are inside your '+CUR(25)+' limit, so no approval is needed:'+
        '<table><tr><th>Add-on</th><th>Cost</th></tr><tr><td>20 GB data booster</td><td>'+CUR(12)+'</td></tr>'+
        '<tr><td>International call bundle</td><td>'+CUR(9)+' (already active)</td></tr></table>'+
        'The 50 GB booster at '+CUR(24)+' also fits, but you have already used '+CUR(9)+' of your limit this cycle, so it would need '+esc(MY_TEAM.leadName||'your team leader')+' to approve.'+
        '<div class="src">Sources: add-on catalogue, your spend limit, your active add-ons.</div>';
    if(/depot|site|problem|slow|outage|antwerp/.test(q))
      return 'Yes — the <strong>Antwerp depot</strong> circuit is degraded right now. Latency is above target and the operator has it open at Tier 1. '+
        'Your <em>mobile</em> line is not affected, so if you are on 4G you should be fine; depot Wi-Fi will feel slow.'+
        '<br><br>Your line also recorded two data drops there on 19 July. Three colleagues show the same pattern, but there is not enough evidence yet to say whether that is the same cause.'+
        '<div class="src">Sources: service status for sites you use, your session records.</div>';
    if(/cost|bill|charge|pay|price/.test(q))
      return 'Your line costs <strong>'+CUR(ME.planPrice+9)+' this cycle</strong> — '+CUR(ME.planPrice)+' for Business Mobile 25 and '+CUR(9)+' for the international call bundle. '+
        'If your data carries on at the current rate, expect about '+CUR(22.50)+' of out-of-bundle charges on top.'+
        '<br><br>All of it is charged to '+esc(MY_TEAM.cc)+' — '+esc(ENT.legal)+' pays, not you.'+
        '<div class="src">Sources: your charge history, current cycle usage, rate card.</div>';
    if(/sim|swap|lost|stolen|esim/.test(q))
      return 'You are on an <strong>eSIM</strong>, ICCID ending '+esc(ME.iccid.slice(-6))+', enabled on your '+esc(ME.device)+'.'+
        '<br><br>If the device is lost or stolen, use <em>Report lost or stolen</em> on the SIM screen — it suspends the line immediately and disables the profile. '+
        'For a routine swap to a new device, request one and your enterprise admin approves it, usually within a working day.'+
        '<div class="src">Sources: your SIM profile, SIM history, account policy.</div>';
    return null;
  }
});
