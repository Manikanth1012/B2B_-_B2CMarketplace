/* ===========================================================================
   PERSONA: Team Leader (Enterprise User)  — 7 agreed team features, plus the
   standard-user features for their own line. Scope: own team only.
   =========================================================================== */

const TEAM = TEAMS.find(t=>t.id==='T-02');
const LEAD = (function(){
  const u = USERS.filter(x=>x.teamId===TEAM.id && x.status==='active' && x.email!=='—')[0] || USERS[0];
  u.name='Ruben Oyelaran'; u.email='r.oyelaran@6dtech.co.in'; u.role='Team leader';
  u.planId='PL-BIZ-60'; u.planName='Business Mobile 60'; u.planPrice=27.50; u.dataAllowGb=60;
  u.dataUsedGb=28.4; u.voiceMin=612; u.smsCount=94; u.roamingGb=3.1;
  u.device='iPhone 15'; u.simType='eSIM'; u.msisdn='+31 6 24 200 41';
  TEAM.leadId=u.id; TEAM.leadName=u.name;
  return u;
})();
const MEMBERS = USERS.filter(u=>u.teamId===TEAM.id);
const MEM_ACTIVE = MEMBERS.filter(u=>u.status==='active');
const TEAM_POOL = POOLS.find(p=>p.teams.includes(TEAM.id));
const TEAM_DATA = +MEMBERS.reduce((a,u)=>a+(u.dataUsedGb||0),0).toFixed(1);
const TEAM_SPEND = +MEMBERS.filter(u=>u.status!=='deactivated').reduce((a,u)=>a+u.planPrice,0).toFixed(2);
const TEAM_TICKETS = TICKETS.filter(t=>t.teamId===TEAM.id);
const TEAM_OPEN = TEAM_TICKETS.filter(t=>t.status!=='resolved');
const TEAM_RES  = TEAM_TICKETS.filter(t=>t.status==='resolved');
const TEAM_MTTR = TEAM_RES.length?Math.round(TEAM_RES.reduce((a,t)=>a+t.resolutionMins,0)/TEAM_RES.length):null;
const OVER = MEM_ACTIVE.filter(u=>u.dataAllowGb && u.dataUsedGb!=null && u.dataUsedGb/u.dataAllowGb>0.85);

/* Approvals scoped to this team, with a real requester attached */
const MY_APPROVALS = APPROVALS.map((a,i)=>{
  const m = MEM_ACTIVE[(i*3)%MEM_ACTIVE.length];
  return Object.assign({},a,{requester:m.name, requesterId:m.id, used:m.dataUsedGb, allow:m.dataAllowGb});
});
const PENDING = MY_APPROVALS.filter(a=>a.status==='pending');

const TEAM_MONTHS = MONTHS.map((m,i)=>({l:m, v: i===0?null : +(TEAM_DATA*(0.72+i*0.026)).toFixed(0)}));
const TEAM_SPEND_SERIES = MONTHS.map((m,i)=>({l:m, v:+(TEAM_SPEND*(0.88+i*0.012)).toFixed(0)}));

const LEAD_INSIGHTS=[
  {icon:'warning', conf:'High confidence',
   title:OVER.length+' people in your team are near or over their allowance',
   body:'They are on course to add roughly <strong>'+CUR(OVER.length*14)+'</strong> in out-of-bundle charges to '+esc(TEAM.cc)+' this cycle. '+
        'A shared booster across the team costs less than approving each request separately.',
   acts:'<button class="btn btn-sm btn-primary" onclick="App.go(\'members\')">See who</button>'+
        '<button class="btn btn-sm" onclick="toast(\'Shared booster request drafted for your enterprise admin\')">Draft shared booster</button>'},
  {icon:'checklist', conf:'High confidence',
   title:PENDING.length+' requests are waiting on you',
   body:'Two are inside your '+CUR(50)+' limit and are consistent with the requester\'s usage pattern. One needs an enterprise admin because it includes device capex.',
   acts:'<button class="btn btn-sm btn-primary" onclick="App.go(\'approvals\')">Review approvals</button>'},
  {icon:'eyeoff', conf:'Low confidence — partial evidence',
   title:'Telematics units at two sites stopped reporting',
   body:'Six M2M lines in your team have no usage record since 18 July. That is consistent with the telemetry gap at Porto and Ghent rather than with the devices failing, but the evidence does not separate the two. Their consumption shows as <strong>not measured</strong>, not as zero.',
   acts:'<button class="btn btn-sm" onclick="App.go(\'teamusage\')">Open team usage</button>'}
];

/* --------------------------- 1. Team dashboard --------------------------- */
function vTeamDash(){
  return pagehead(TEAM.name,
    MEMBERS.length+' members · cost centre '+esc(TEAM.cc)+' · you can see and approve for this team only',
    '<div class="seg" role="group" aria-label="Scope"><button aria-pressed="true">My team</button>'+
    '<button aria-pressed="false" onclick="App.go(\'mine\')">My line</button></div>'+
    exportBtn('Team overview'))+
  '<div class="stack">'+

  (PENDING.length?banner('warning','<strong>'+PENDING.length+' requests are waiting on your decision.</strong> The oldest was raised '+esc(PENDING[PENDING.length-1].raised)+'. '+
    '<button class="linkbtn" onclick="App.go(\'approvals\')">Review them</button>'):'')+

  '<div class="grid g4">'+
    metric({icon:'users',label:'Team members',value:String(MEMBERS.length),
      foot:MEM_ACTIVE.length+' active · '+MEMBERS.filter(u=>u.status==='suspended').length+' suspended'})+
    metric({icon:'database',label:'Team data this cycle',value:FMT.gb(TEAM_DATA),
      foot:TEAM_POOL?('Drawing on '+esc(TEAM_POOL.name)):'Per-line allowances'})+
    metric({icon:'wallet',label:'Recurring team charge',value:CUR0(TEAM_SPEND),foot:delta(1.8)+' vs last cycle · '+esc(TEAM.cc)})+
    metric({icon:'checklist',label:'Waiting on you',value:String(PENDING.length),
      foot:PENDING.length?'Oldest '+esc(PENDING[PENDING.length-1].raised):'Nothing outstanding'})+
  '</div>'+

  '<div class="grid g-2-1">'+
    panel('Team consumption',
      CH.line([{pts:TEAM_MONTHS}],{fmt:n=>Math.round(n)+' GB',tip:n=>FMT.gb(n),aria:'Team data consumption over 12 cycles'})+
      '<div class="legend"><span><i style="background:#0099FF"></i>Team data</span>'+
      '<span><i style="background:#E4E4E4"></i>Aug 2025 — no record retained</span></div>',
      {icon:'activity',sub:'12 rolling cycles'})+
    panel('Shared pool',
      TEAM_POOL
        ? '<div class="stack" style="gap:11px">'+
          '<div><div class="row" style="margin-bottom:5px"><span class="t-small grow">'+esc(TEAM_POOL.name)+'</span>'+
          '<span class="t-small strong t-num">'+FMT.pct(TEAM_POOL.pct)+'</span></div>'+
          meter(TEAM_POOL.pct,FMT.gb(TEAM_POOL.usedGb)+' of '+FMT.gb(TEAM_POOL.allowGb))+'</div>'+
          '<div class="row"><span class="t-small grow">Your team\'s share</span>'+
          '<span class="t-small strong t-num">'+FMT.pct(TEAM_DATA/TEAM_POOL.usedGb*100)+'</span></div>'+
          '<div class="row"><span class="t-small grow">Ceiling policy</span><span class="t-small">'+esc(TEAM_POOL.policy)+'</span></div>'+
          '<div class="row"><span class="t-small grow">Top-ups</span><span class="t-small">'+esc(TEAM_POOL.topup)+'</span></div>'+
          '</div><div class="divider"></div>'+
          banner('info','Only an enterprise admin can allocate a top-up. You can request one and it routes to them.')+
          '<div class="row" style="margin-top:10px"><span class="spacer"></span>'+
          '<button class="btn btn-sm" onclick="toast(\'Top-up request sent to your enterprise admin\')">Request top-up</button></div>'
        : stateBlock('empty','This team is not in a shared pool','Each member draws on their own per-line allowance instead.'),
      {icon:'database'})+
  '</div>'+

  panel('AI insights', LEAD_INSIGHTS.map(aiInsight).join(''),
    {ai:true,flush:true,icon:'ai',sub:'Scoped to '+esc(TEAM.name)+'. You never see detail for people outside your team.'})+

  '<div class="grid g2">'+
    panel('Members needing attention',
      OVER.length
        ? '<table class="tbl"><tbody>'+OVER.slice(0,6).map(u=>
            '<tr onclick="openMember(\''+u.id+'\')" style="cursor:pointer"><td><div class="cellmain">'+esc(u.name)+'</div>'+
            '<div class="cellsub">'+esc(u.planName)+'</div></td>'+
            '<td class="num" style="width:170px">'+tinyMeter(u.dataUsedGb,u.dataAllowGb)+'</td>'+
            '<td style="width:96px">'+(u.dataUsedGb>u.dataAllowGb?pill('overdue','Over'):pill('degraded','Near limit'))+'</td></tr>').join('')+'</tbody></table>'
        : stateBlock('empty','Nobody is near their limit','Every active member is comfortably inside their allowance this cycle.'),
      {flush:true,icon:'warning',acts:'<button class="btn btn-sm btn-quiet" onclick="App.go(\'members\')">All members</button>'})+
    panel('Team tickets',
      '<div class="grid g2" style="gap:9px">'+
        metric({label:'Open',value:String(TEAM_OPEN.length),foot:TEAM_OPEN.filter(t=>t.escalated).length+' escalated'})+
        metric({label:'Average resolution',value:TEAM_MTTR!=null?FMT.mins(TEAM_MTTR):null,naLabel:'No resolved tickets yet',foot:TEAM_RES.length+' resolved'})+
      '</div>'+
      (TEAM_TICKETS.length?'<div class="divider"></div><div class="stack" style="gap:0">'+TEAM_TICKETS.slice(0,4).map(t=>
        '<button class="row" style="width:100%;background:none;border:0;text-align:left;cursor:pointer;padding:8px 0;border-bottom:1px solid var(--nim-line-100)" onclick="openTicket(\''+t.id+'\')">'+
        sevPill(t.severity)+'<span class="t-small grow" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+esc(t.subject)+'</span>'+
        statusPill(t.status)+'</button>').join('')+'</div>':''),
      {icon:'support',acts:'<button class="btn btn-sm btn-quiet" onclick="App.go(\'teamtickets\')">All tickets</button>'})+
  '</div>'+
  '</div>';
}

/* ------------------------- 2. Team member activity ----------------------- */
function vMembers(){
  return pagehead('Team members',
    MEMBERS.length+' people and devices in '+esc(TEAM.name)+'. You see status and volume, never the content of anyone\'s activity.',
    exportBtn('Team members')+
    '<button class="btn btn-primary" onclick="toast(\'Request sent to your enterprise admin\')">'+ICO('userplus',14)+'Request a new line</button>')+
  '<div class="stack">'+
  banner('info','As a team leader you can see each member\'s <strong>volume, status and requests</strong>. Sites visited, apps used and message content are never exposed to you.')+
  panel(null, dt('dtMembers',{
    rows:MEMBERS, noun:'members', pageSize:12, sortKey:'name', idKey:'id', onRow:"openMember('$ID')",
    searchFields:['name','email','msisdn','planName'], searchPlaceholder:'Search name or number',
    chips:[{key:'status',options:[{label:'Active',value:'active'},{label:'Suspended',value:'suspended'},
      {label:'Invited',value:'invited'},{label:'Deactivated',value:'deactivated'}]}],
    actions:exportBtn('Member list'),
    columns:[
      {key:'name',label:'Member',render:r=>'<div class="row" style="gap:8px"><span class="avatar" aria-hidden="true">'+esc(FMT.initials(r.name))+'</span>'+
        '<div><div class="cellmain">'+esc(r.name)+'</div><div class="cellsub">'+esc(r.email)+'</div></div></div>'},
      {key:'msisdn',label:'Number',render:r=>'<span class="t-num">'+esc(r.msisdn)+'</span><div class="cellsub">'+esc(r.simType)+'</div>'},
      {key:'planName',label:'Plan',render:r=>esc(r.planName)+'<div class="cellsub">'+CUR(r.planPrice)+'/mo</div>'},
      {key:'dataUsedGb',label:'Data this cycle',align:'right',width:'180px',render:r=>
        r.status==='deactivated'?'<span class="nodata">Line closed</span>'
        : r.dataUsedGb==null?meter(null,null,{naLabel:'Not measured'})
        : tinyMeter(r.dataUsedGb,r.dataAllowGb)},
      {key:'voiceMin',label:'Voice',align:'right',render:r=>r.voiceMin!=null?'<span class="t-num">'+FMT.num(r.voiceMin)+'</span>':NOTMEASURED()},
      {key:'lastActive',label:'Last active',render:r=>esc(r.lastActive)},
      {key:'status',label:'Status',render:r=>statusPill(r.status)},
      {key:'__acts',label:'',sort:false,render:r=>'<button class="btn btn-sm btn-quiet" onclick="event.stopPropagation();openMember(\''+r.id+'\')">Open</button>'}
    ]}),{flush:true})+
  '</div>';
}
function openMember(id){
  const u=USERS.find(x=>x.id===id); if(!u) return;
  const req=MY_APPROVALS.filter(a=>a.requesterId===id);
  openInspector(
    '<div class="insp-head"><span class="avatar" style="width:36px;height:36px;font-size:13px" aria-hidden="true">'+esc(FMT.initials(u.name))+'</span>'+
      '<div class="grow">'+statusPill(u.status)+'<h3 class="t-sub" style="margin-top:5px">'+esc(u.name)+'</h3>'+
      '<div class="t-small muted">'+esc(u.email)+' · '+esc(TEAM.name)+'</div></div>'+
      '<button class="iconbtn" onclick="closeInspector()" aria-label="Close">'+ICO('x',16)+'</button></div>'+
    '<div class="insp-body stack">'+
      (u.dataAllowGb&&u.dataUsedGb!=null&&u.dataUsedGb>u.dataAllowGb
        ? banner('danger','<strong>Over allowance.</strong> '+FMT.gb(u.dataUsedGb-u.dataAllowGb)+' beyond the '+u.dataAllowGb+' GB plan, charged at '+CUR(4.50)+' per GB to '+esc(TEAM.cc)+'.')
        : u.dataUsedGb==null&&u.status==='active'
        ? banner('stale','<strong>No usage record since 18 July.</strong> This is consistent with the telemetry gap at two sites. Consumption is reported as not measured rather than as zero.')
        : '')+
      '<dl class="deflist">'+
        '<dt>Number</dt><dd class="t-num">'+esc(u.msisdn)+'</dd>'+
        '<dt>Plan</dt><dd>'+esc(u.planName)+' · '+CUR(u.planPrice)+'/mo</dd>'+
        '<dt>SIM</dt><dd>'+esc(u.simType)+'</dd>'+
        '<dt>Device</dt><dd>'+esc(u.device)+'</dd>'+
        '<dt>Joined the team</dt><dd>'+esc(u.joined)+'</dd>'+
        '<dt>Last active</dt><dd>'+esc(u.lastActive)+'</dd>'+
      '</dl>'+
      '<div class="divider"></div><h4 class="t-sub">Consumption this cycle</h4>'+
      '<div class="stack" style="gap:9px">'+
        '<div><div class="t-tiny muted">Data</div>'+
        (u.dataUsedGb==null?meter(null,null,{naLabel:'Not measured'}):tinyMeter(u.dataUsedGb,u.dataAllowGb))+'</div>'+
        '<div class="row"><span class="t-small grow">Voice minutes</span><span class="t-small t-num">'+(u.voiceMin!=null?FMT.num(u.voiceMin):NOTMEASURED())+'</span></div>'+
        '<div class="row"><span class="t-small grow">SMS</span><span class="t-small t-num">'+(u.smsCount!=null?FMT.num(u.smsCount):NOTMEASURED())+'</span></div>'+
        '<div class="row"><span class="t-small grow">Roaming</span><span class="t-small t-num">'+(u.roamingGb?FMT.gb(u.roamingGb):'None recorded')+'</span></div>'+
      '</div>'+
      (req.length?'<div class="divider"></div><h4 class="t-sub">Requests</h4><div class="stack" style="gap:7px">'+
        req.map(r=>'<div class="row"><span class="t-small grow">'+esc(r.item)+'</span>'+statusPill(r.status)+'</div>').join('')+'</div>':'')+
    '</div>'+
    '<div class="insp-foot"><button class="btn btn-quiet" onclick="closeInspector()">Close</button><div class="spacer"></div>'+
      '<button class="btn btn-sm" onclick="toast(\'Message sent to '+esc(u.name)+'\')">'+ICO('message',13)+'Message</button>'+
      '<button class="btn btn-sm btn-primary" onclick="toast(\'Booster request drafted for '+esc(u.name)+'\')">Offer a booster</button></div>',
    'Member '+u.name);
}

/* ---------------------- 3. Team usage and shared pool -------------------- */
function vTeamUsage(){
  const noTelemetry=MEM_ACTIVE.filter(u=>u.dataUsedGb==null);
  return pagehead('Team usage',
    'Consumption across '+esc(TEAM.name)+' and its draw on the shared pool. Six lines have no record for part of the cycle and are shown as such.',
    '<div class="seg" role="group" aria-label="Usage type"><button aria-pressed="true">Data</button>'+
    '<button aria-pressed="false" onclick="toast(\'Voice view\')">Voice</button>'+
    '<button aria-pressed="false" onclick="toast(\'SMS view\')">SMS</button></div>'+
    exportBtn('Team usage')+scheduleBtn())+
  '<div class="stack">'+
  (noTelemetry.length?banner('partial','<strong>'+noTelemetry.length+' lines have not reported since 18 July.</strong> Their consumption is excluded from the totals below and marked as not measured. Nothing is estimated in its place.'):'')+
  '<div class="grid g4">'+
    metric({icon:'database',label:'Team data',value:FMT.gb(TEAM_DATA),foot:delta(6.2)+' vs last cycle'})+
    metric({icon:'gauge',label:'Average per active line',value:FMT.gb(TEAM_DATA/Math.max(1,MEM_ACTIVE.length-noTelemetry.length)),
      foot:'Excludes '+noTelemetry.length+' unreported lines'})+
    metric({icon:'warning',label:'Over allowance',value:String(MEM_ACTIVE.filter(u=>u.dataAllowGb&&u.dataUsedGb>u.dataAllowGb).length),
      foot:'Out-of-bundle so far '+CUR(96.40)})+
    metric({icon:'globe',label:'Roaming data',value:FMT.gb(MEMBERS.reduce((a,u)=>a+(u.roamingGb||0),0)),
      foot:MEMBERS.filter(u=>u.roamingGb>0).length+' lines roamed'})+
  '</div>'+
  '<div class="grid g-2-1">'+
    panel('Consumption by member',
      CH.stack(MEM_ACTIVE.filter(u=>u.dataUsedGb!=null).sort((a,b)=>b.dataUsedGb-a.dataUsedGb).slice(0,12)
        .map(u=>({label:u.name,parts:[u.dataUsedGb]})),{names:['Data'],fmt:n=>FMT.gb(n)})+
      (noTelemetry.length?'<div class="divider"></div><div class="stack" style="gap:6px">'+
        noTelemetry.slice(0,4).map(u=>'<div class="row"><span class="t-small grow">'+esc(u.name)+'</span>'+
        '<span class="t-small">'+NOTMEASURED()+'</span></div>').join('')+'</div>':''),
      {icon:'group',sub:'Top 12 by volume, then lines without a record'})+
    panel('Shared pool draw',
      TEAM_POOL
        ? '<div class="stack" style="gap:12px">'+
          '<div><div class="row" style="margin-bottom:5px"><span class="t-small grow">Pool consumed</span>'+
          '<span class="t-small strong t-num">'+FMT.pct(TEAM_POOL.pct)+'</span></div>'+
          meter(TEAM_POOL.pct,FMT.gb(TEAM_POOL.usedGb)+' of '+FMT.gb(TEAM_POOL.allowGb))+'</div>'+
          '<div>'+CH.donut([{l:esc(TEAM.name),v:TEAM_DATA},{l:'Other teams in the pool',v:Math.max(0,TEAM_POOL.usedGb-TEAM_DATA)},
            {l:'Remaining',v:Math.max(0,TEAM_POOL.allowGb-TEAM_POOL.usedGb)}],
            {centre:FMT.pct(TEAM_POOL.pct),centreSub:'used',fmt:n=>FMT.gb(n),aria:'Pool draw split'})+'</div>'+
          '</div>'
        : stateBlock('empty','No shared pool','This team draws on per-line allowances.'),
      {icon:'database'})+
  '</div>'+
  panel('Daily team consumption',
    CH.bars(['1','3','5','7','9','11','13','15','17','19','21'].map((d,i)=>
      ({l:d, v: i>=9 ? null : +(TEAM_DATA/22*2*(0.8+(i%4)*0.14)).toFixed(1)})),
      {fmt:n=>Math.round(n)+' GB',tip:n=>FMT.gb(n),aria:'Daily team consumption'})+
    '<div class="t-tiny muted" style="margin-top:7px">The hatched bars from day 19 are the telemetry gap — no value is shown because none was recorded.</div>',
    {icon:'chart',sub:'GB per day, current cycle'})+
  '</div>';
}

/* --------------------------- 4. Team spend ------------------------------- */
function vTeamSpend(){
  const rows=MEMBERS.filter(u=>u.status!=='deactivated').map(u=>({
    id:u.id, name:u.name, plan:u.planName, recurring:u.planPrice,
    addons:u.id.charCodeAt(4)%3===0?9.00:0,
    overage:(u.dataAllowGb&&u.dataUsedGb>u.dataAllowGb)?+((u.dataUsedGb-u.dataAllowGb)*4.5).toFixed(2):0,
    status:u.status
  })).map(r=>Object.assign(r,{total:+(r.recurring+r.addons+r.overage).toFixed(2)}));
  const tot=rows.reduce((a,r)=>a+r.total,0);
  return pagehead('Team spend',
    'What '+esc(TEAM.name)+' costs '+esc(TEAM.cc)+' this cycle. Amounts are indicative until the invoice closes on 31 July.',
    exportBtn('Team spend')+scheduleBtn())+
  '<div class="stack">'+
  '<div class="grid g4">'+
    metric({icon:'wallet',label:'Team charge this cycle',value:CUR0(tot),foot:delta(3.1)+' vs last cycle'})+
    metric({icon:'package',label:'Recurring',value:CUR0(TEAM_SPEND),foot:MEMBERS.filter(u=>u.status!=='deactivated').length+' billable lines'})+
    metric({icon:'warning',label:'Out of bundle',value:CUR0(rows.reduce((a,r)=>a+r.overage,0)),foot:rows.filter(r=>r.overage).length+' lines over allowance'})+
    metric({icon:'gauge',label:'Cost per active line',value:CUR(tot/Math.max(1,MEM_ACTIVE.length)),foot:delta(-0.9,'%',true)+' vs last cycle'})+
  '</div>'+
  '<div class="grid g-2-1">'+
    panel('Spend by member', dt('dtSpend',{
      rows:rows, noun:'members', pageSize:12, sortKey:'total', sortDir:'desc', onRow:"openMember('$ID')",
      searchFields:['name','plan'], searchPlaceholder:'Search member',
      actions:exportBtn('Spend by member'),
      columns:[
        {key:'name',label:'Member',render:r=>'<div class="cellmain">'+esc(r.name)+'</div><div class="cellsub">'+esc(r.plan)+'</div>'},
        {key:'recurring',label:'Plan',align:'right',render:r=>'<span class="t-num">'+CUR(r.recurring)+'</span>'},
        {key:'addons',label:'Add-ons',align:'right',render:r=>r.addons?'<span class="t-num">'+CUR(r.addons)+'</span>':'<span class="dim">—</span>'},
        {key:'overage',label:'Out of bundle',align:'right',render:r=>r.overage?'<span class="t-num" style="color:var(--nim-danger-fg)">'+CUR(r.overage)+'</span>':'<span class="dim">None</span>'},
        {key:'total',label:'Total',align:'right',render:r=>'<span class="t-num cellmain">'+CUR(r.total)+'</span>'},
        {key:'status',label:'Status',render:r=>statusPill(r.status)}
      ]}),{flush:true,icon:'wallet'})+
    panel('Spend trend',
      CH.line([{pts:TEAM_SPEND_SERIES}],{fmt:n=>CUR0(n),tip:n=>CUR(n),aria:'Team spend over 12 cycles'})+
      '<div class="divider"></div>'+
      '<div class="stack" style="gap:8px">'+
        '<div class="row"><span class="t-small grow">Charged to</span><span class="t-small strong">'+esc(TEAM.cc)+'</span></div>'+
        '<div class="row"><span class="t-small grow">Invoice</span><span class="t-small strong t-num">'+esc(INVOICES[0].id)+'</span></div>'+
        '<div class="row"><span class="t-small grow">Closes</span><span class="t-small strong">31 Jul 2026</span></div>'+
      '</div>'+
      '<div class="divider"></div>'+
      '<div class="t-tiny muted">You see your team\'s share. The full account invoice sits with your enterprise admin and finance.</div>',
      {icon:'chart'})+
  '</div>'+
  '</div>';
}

/* ---------------------------- 5. Approvals ------------------------------- */
function vApprovals(){
  return pagehead('Approvals',
    PENDING.length+' waiting on you · your delegated limit is '+CUR(50)+' per request. Anything above that routes to an enterprise admin.',
    '<button class="btn" onclick="toast(\'Approval policy is set by your enterprise admin\')">'+ICO('shield',13)+'My limits</button>')+
  '<div class="stack">'+
  banner('info','You are approving <strong>on behalf of '+esc(TEAM.cc)+'</strong>. Every decision is written to the account audit log with your identity and the reason you give.')+
  (PENDING.length
    ? '<div class="stack">'+PENDING.map(a=>
      '<section class="panel"><div class="panel-body">'+
        '<div class="row wrap" style="gap:12px;align-items:flex-start">'+
          '<span class="avatar" style="width:34px;height:34px" aria-hidden="true">'+esc(FMT.initials(a.requester))+'</span>'+
          '<div class="grow"><div class="t-sub">'+esc(a.item)+'</div>'+
          '<div class="t-small muted">'+esc(a.requester)+' · raised '+esc(a.raised)+' · '+esc(a.id)+'</div>'+
          '<div class="t-small" style="margin-top:7px">“'+esc(a.reason)+'”</div>'+
          '<div class="row wrap" style="gap:14px;margin-top:11px">'+
            '<div><div class="t-tiny muted">Cost</div><div class="t-sub t-num">'+CUR(a.cost)+(a.item.includes('booster')?'':' /mo')+'</div></div>'+
            '<div style="min-width:190px"><div class="t-tiny muted">Their data this cycle</div>'+
              (a.allow&&a.used!=null?tinyMeter(a.used,a.allow):'<span class="nodata">Not measured</span>')+'</div>'+
            '<div><div class="t-tiny muted">Policy</div><div class="t-small">'+
              (a.policy.indexOf('Requires')===0?pill('warning','Above your limit'):pill('success','Within your limit'))+'</div></div>'+
          '</div></div>'+
          '<div class="row" style="gap:7px;flex:0 0 auto">'+
            (a.policy.indexOf('Requires')===0
              ? '<button class="btn btn-sm" onclick="toast(\''+esc(a.id)+' forwarded to your enterprise admin\')">Forward to admin</button>'
              : '<button class="btn btn-sm btn-danger" onclick="decide(\''+a.id+'\',false)">Decline</button>'+
                '<button class="btn btn-sm btn-primary" onclick="decide(\''+a.id+'\',true)">Approve</button>')+
          '</div>'+
        '</div>'+
        '<div class="divider"></div>'+
        '<div class="t-tiny muted">'+esc(a.policy)+'</div>'+
      '</div></section>').join('')+'</div>'
    : panel(null,stateBlock('empty','Nothing waiting on you','Requests from your team appear here. You are notified as soon as one arrives.'),{flush:true}))+
  panel('Decision history', dt('dtApprovals',{
    rows:MY_APPROVALS.filter(a=>a.status!=='pending'), noun:'decisions', pageSize:10, toolbar:false, sortKey:'raised',
    emptyTitle:'No decisions yet', emptyBody:'Approvals and declines you make are recorded here and in the account audit log.',
    columns:[
      {key:'id',label:'Request',render:r=>'<div class="cellmain t-num">'+esc(r.id)+'</div><div class="cellsub">'+esc(r.raised)+'</div>'},
      {key:'requester',label:'Requester',render:r=>esc(r.requester)},
      {key:'item',label:'What',render:r=>'<div class="cellmain">'+esc(r.item)+'</div><div class="cellsub">'+esc(r.reason)+'</div>'},
      {key:'cost',label:'Cost',align:'right',render:r=>'<span class="t-num">'+CUR(r.cost)+'</span>'},
      {key:'status',label:'Decision',render:r=>statusPill(r.status)},
      {key:'__acts',label:'',sort:false,render:r=>'<button class="btn btn-sm btn-quiet" onclick="toast(\'Decision detail opened\')">Detail</button>'}
    ]}),{flush:true,icon:'history'})+
  '</div>';
}
function decide(id,approve){
  const a=MY_APPROVALS.find(x=>x.id===id); if(!a) return;
  confirmAction({
    title:(approve?'Approve ':'Decline ')+a.item, subtitle:a.requester+' · '+CUR(a.cost)+' · '+a.id,
    risk:approve?'normal':'normal', confirmLabel:approve?'Approve':'Decline',
    body:'<div class="field"><label for="apWhy">Reason (shared with the requester and written to the audit log)</label>'+
      '<textarea class="inp" id="apWhy" placeholder="'+(approve?'e.g. consistent with survey-week usage':'e.g. duplicate of an earlier request')+'"></textarea></div>',
    impact:approve
      ? ['<strong>'+CUR(a.cost)+'</strong> is charged to '+esc(TEAM.cc)+(a.item.includes('booster')?' on invoice '+esc(INVOICES[0].id)+'.':' every cycle until cancelled.'),
         'The change applies to '+esc(a.requester)+'\'s line within about 2 minutes.',
         'This uses '+CUR(a.cost)+' of your '+CUR(50)+' per-request limit.',
         'Your enterprise admin sees the decision in the audit log but is not asked to confirm it.']
      : ['Nothing is charged and nothing changes on '+esc(a.requester)+'\'s line.',
         esc(a.requester)+' is notified with the reason you give.',
         'They can raise the request again, or escalate it to an enterprise admin.'],
    footNote:'Decisions cannot be edited afterwards, only reversed by a new request.',
    onConfirm:()=>{ a.status=approve?'approved':'rejected'; toast(a.id+(approve?' approved':' declined')+' — '+a.requester+' has been notified',approve?'ok':'warn'); App.go('approvals'); }
  });
}

/* ------------------------- 6. Team alerts -------------------------------- */
function vTeamAlerts(){
  const rules=[
    {id:'TA-1', name:'Member over allowance', trigger:'A member of my team passes 100% of their allowance', ch:'Push, email', on:true, fired:'Today 06:22', scope:'My team'},
    {id:'TA-2', name:'Member near allowance', trigger:'A member passes 85%', ch:'Email', on:true, fired:'Yesterday', scope:'My team'},
    {id:'TA-3', name:'New request to approve', trigger:'A member raises a request inside my limit', ch:'Push, email', on:true, fired:'Today 08:52', scope:'My team'},
    {id:'TA-4', name:'Shared pool threshold', trigger:'The pool my team draws on passes 90%', ch:'Email', on:true, fired:'1 h ago', scope:'Pool'},
    {id:'TA-5', name:'Usage anomaly', trigger:'A member\'s daily usage is more than 3× their own baseline', ch:'Email', on:true, fired:'19 Jul', scope:'My team'},
    {id:'TA-6', name:'Line stopped reporting', trigger:'A line records nothing for 48 hours', ch:'Email', on:true, fired:'20 Jul', scope:'My team'},
    {id:'TA-7', name:'Team ticket escalated', trigger:'A ticket from my team is escalated to Tier 2', ch:'Push', on:false, fired:'Never', scope:'My team'}
  ];
  const anomalies=[
    {when:'19 Jul', who:MEM_ACTIVE[0]?MEM_ACTIVE[0].name:'—', what:'Daily data 4.1 GB against a 0.9 GB baseline', verdict:'Explained — depot survey week', kind:'success'},
    {when:'20 Jul', who:'6 telematics lines', what:'No usage record for 48 hours', verdict:'Unresolved — telemetry gap at two sites', kind:'warning'},
    {when:'17 Jul', who:MEM_ACTIVE[2]?MEM_ACTIVE[2].name:'—', what:'Roaming started in a country outside the EU zone', verdict:'Explained — supplier visit, approved travel', kind:'success'},
    {when:'11 Jul', who:MEM_ACTIVE[4]?MEM_ACTIVE[4].name:'—', what:'Voice minutes 3.2× baseline', verdict:'Not investigated', kind:'neutral'}
  ];
  return pagehead('Team alerts',
    rules.filter(r=>r.on).length+' of '+rules.length+' active. Everything here is scoped to '+esc(TEAM.name)+' — you are never alerted about other teams.',
    '<button class="btn" onclick="App.notifications()">'+ICO('bell',13)+'Recent alerts</button>')+
  '<div class="stack">'+
  panel('Alert rules', dt('dtTeamRules',{
    rows:rules, noun:'rules', pageSize:10, toolbar:false, sortKey:'id',
    columns:[
      {key:'name',label:'Alert',render:r=>'<div class="cellmain">'+esc(r.name)+'</div><div class="cellsub">'+esc(r.id)+'</div>'},
      {key:'trigger',label:'When',render:r=>'<span class="t-small">'+esc(r.trigger)+'</span>'},
      {key:'scope',label:'Scope',render:r=>pill('partial',r.scope)},
      {key:'ch',label:'How',render:r=>'<div class="tagset">'+r.ch.split(', ').map(c=>'<span class="tag">'+esc(c)+'</span>').join('')+'</div>'},
      {key:'fired',label:'Last fired',render:r=>r.fired==='Never'?'<span class="dim">Never</span>':esc(r.fired)},
      {key:'on',label:'On',render:r=>'<label class="toggle"><input type="checkbox" '+(r.on?'checked':'')+
        ' onchange="toast(\''+esc(r.name)+' \'+(this.checked?\'on\':\'off\'))"><span class="track"></span>'+
        '<span class="sr-only">'+esc(r.name)+'</span></label>'}
    ]}),{flush:true,icon:'bell',
    sub:'You can tighten a threshold your admin set, but never loosen it.'})+
  panel('Anomalies detected',
    '<table class="tbl"><thead><tr><th>When</th><th>Who</th><th>What was flagged</th><th>Outcome</th><th></th></tr></thead><tbody>'+
    anomalies.map(a=>'<tr><td>'+esc(a.when)+'</td><td class="cellmain">'+esc(a.who)+'</td><td>'+esc(a.what)+'</td>'+
    '<td>'+(a.kind==='success'?pill('resolved',a.verdict):a.kind==='warning'?pill('degraded',a.verdict):pill('neutral',a.verdict))+'</td>'+
    '<td class="acts"><button class="btn btn-sm btn-quiet" onclick="toast(\'Anomaly detail opened\')">Detail</button></td></tr>').join('')+
    '</tbody></table>',{flush:true,icon:'warning',
    sub:'Anomaly detection compares each line against its own baseline, not against colleagues.'})+
  '</div>';
}

/* --------------------------- 7. Team reports ----------------------------- */
function vTeamReports(){
  const saved=[
    {id:'TR-1', name:'Usage and spend by member', sched:'Monthly, 1st 07:00', to:'r.oyelaran@6dtech.co.in', fmt:'CSV', last:'01 Jul 2026'},
    {id:'TR-2', name:'Members over allowance', sched:'Weekly, Monday', to:'r.oyelaran@6dtech.co.in', fmt:'CSV', last:'20 Jul 2026'},
    {id:'TR-3', name:'Approval decisions', sched:'Not scheduled', to:'—', fmt:'CSV + PDF', last:'Never run'},
    {id:'TR-4', name:'Team ticket summary', sched:'Monthly, 1st', to:'r.oyelaran@6dtech.co.in', fmt:'PDF', last:'01 Jul 2026'}
  ];
  return pagehead('Team reports',
    'Everything here is limited to '+esc(TEAM.name)+'. Exports carry the same scope, so nothing about other teams can leak through a file.',
    exportBtn('Current view')+scheduleBtn())+
  '<div class="stack">'+
  '<div class="grid g2">'+
    panel('Usage by member',
      CH.bars(MEM_ACTIVE.filter(u=>u.dataUsedGb!=null).sort((a,b)=>b.dataUsedGb-a.dataUsedGb).slice(0,10)
        .map(u=>({l:u.name.split(' ')[0],v:u.dataUsedGb})),
        {fmt:n=>Math.round(n)+' GB',tip:n=>FMT.gb(n),aria:'Data usage by member'}),{icon:'group'})+
    panel('Spend trend',
      CH.line([{pts:TEAM_SPEND_SERIES}],{fmt:n=>CUR0(n),tip:n=>CUR(n),aria:'Team spend over 12 cycles'}),{icon:'wallet'})+
  '</div>'+
  '<div class="grid g2">'+
    panel('Requests and decisions',
      CH.bars([['Approved','approved'],['Declined','rejected'],['Pending','pending'],['Escalated','completed']]
        .map(([l,s])=>({l,v:MY_APPROVALS.filter(a=>a.status===s).length})),
        {h:170,fmt:n=>Math.round(n),tip:n=>n+' requests',aria:'Requests by decision'}),{icon:'checklist'})+
    panel('Data quality in this report',
      '<div class="stack" style="gap:11px">'+
      '<div class="row"><span class="t-small grow">Lines with a complete record</span>'+
        '<span class="t-small strong t-num">'+(MEM_ACTIVE.length-MEM_ACTIVE.filter(u=>u.dataUsedGb==null).length)+' of '+MEM_ACTIVE.length+'</span></div>'+
      meter((MEM_ACTIVE.length-MEM_ACTIVE.filter(u=>u.dataUsedGb==null).length)/Math.max(1,MEM_ACTIVE.length)*100)+
      '<div class="divider"></div>'+
      '<div class="row"><span class="t-small grow">Cycle days covered</span><span class="t-small strong t-num">22 of 31</span></div>'+
      '<div class="row"><span class="t-small grow">Lines with a telemetry gap</span><span class="t-small strong t-num">'+MEM_ACTIVE.filter(u=>u.dataUsedGb==null).length+'</span></div>'+
      '<div class="row"><span class="t-small grow">Values estimated to fill gaps</span><span class="t-small strong">None</span></div>'+
      '</div><div class="divider"></div>'+
      '<div class="t-tiny muted">Gaps are reported as gaps. If a number is shown, it was measured.</div>',
      {icon:'gauge'})+
  '</div>'+
  panel('Saved and scheduled reports', dt('dtTeamReports',{
    rows:saved, noun:'reports', pageSize:8, toolbar:false, sortKey:'id',
    columns:[
      {key:'name',label:'Report',render:r=>'<div class="cellmain">'+esc(r.name)+'</div><div class="cellsub">'+esc(r.id)+' · scope: '+esc(TEAM.name)+'</div>'},
      {key:'sched',label:'Schedule',render:r=>r.sched==='Not scheduled'?'<span class="dim">Not scheduled</span>':esc(r.sched)},
      {key:'to',label:'Delivered to',render:r=>r.to==='—'?'<span class="dim">—</span>':'<span class="t-small">'+esc(r.to)+'</span>'},
      {key:'fmt',label:'Format',render:r=>'<div class="tagset">'+r.fmt.split(' + ').map(f=>'<span class="tag">'+esc(f)+'</span>').join('')+'</div>'},
      {key:'last',label:'Last run',render:r=>r.last==='Never run'?'<span class="nodata">Never run</span>':esc(r.last)},
      {key:'__acts',label:'',sort:false,render:r=>'<button class="btn btn-sm btn-quiet" onclick="toast(\''+esc(r.name)+' is running\')">Run now</button>'+
        '<button class="btn btn-sm btn-quiet" onclick="openSchedule()">Schedule</button>'}
    ]}),{flush:true,icon:'calendar'})+
  '</div>';
}

/* --------------------------- 8. Team tickets ----------------------------- */
function vTeamTickets(){
  return pagehead('Team support',
    TEAM_OPEN.length+' open across '+esc(TEAM.name)+' · average resolution '+(TEAM_MTTR!=null?FMT.mins(TEAM_MTTR):'not measured'),
    '<button class="btn" onclick="AI.open()">'+ICO('ai',13)+'Ask the assistant</button>'+
    '<button class="btn btn-primary" onclick="toast(\'Ticket form opened\')">'+ICO('plus',14)+'Raise on behalf</button>')+
  '<div class="stack">'+
  '<div class="grid g4">'+
    metric({icon:'inbox',label:'Open',value:String(TEAM_OPEN.length),foot:TEAM_OPEN.filter(t=>t.escalated).length+' escalated'})+
    metric({icon:'clock',label:'Average resolution',value:TEAM_MTTR!=null?FMT.mins(TEAM_MTTR):null,naLabel:'No resolved tickets yet',foot:TEAM_RES.length+' resolved'})+
    metric({icon:'checkcircle',label:'Within SLA',value:TEAM_RES.length?FMT.pct(TEAM_RES.filter(t=>!t.breached).length/TEAM_RES.length*100):null,
      naLabel:'Not measured',foot:TEAM_RES.filter(t=>t.breached).length+' breaches'})+
    metric({icon:'trendup',label:'Escalations',value:String(TEAM_TICKETS.filter(t=>t.escalated).length),foot:'In the last 12 months'})+
  '</div>'+
  panel(null, TEAM_TICKETS.length? dt('dtTeamTck',{
    rows:TEAM_TICKETS, noun:'tickets', pageSize:10, sortKey:'id', sortDir:'desc', onRow:"openTicket('$ID')",
    searchFields:['id','subject','openedBy','status'], searchPlaceholder:'Search team tickets',
    chips:[{key:'status',options:[{label:'Open',value:'open'},{label:'In progress',value:'inprogress'},{label:'Resolved',value:'resolved'}]},
           {key:'severity',options:[{label:'P1',value:'P1'},{label:'P2',value:'P2'},{label:'P3',value:'P3'}]}],
    actions:exportBtn('Team tickets'),
    columns:[
      {key:'id',label:'Ticket',render:r=>'<div class="cellmain t-num">'+esc(r.id)+'</div><div class="cellsub">'+esc(r.opened)+'</div>'},
      {key:'subject',label:'Subject',render:r=>'<div class="cellmain">'+esc(r.subject)+'</div><div class="cellsub">via '+esc(r.channel)+'</div>'},
      {key:'severity',label:'Severity',render:r=>sevPill(r.severity)},
      {key:'openedBy',label:'Raised by',render:r=>esc(r.openedBy)},
      {key:'resolutionMins',label:'Resolved in',align:'right',render:r=>r.resolutionMins==null?'<span class="dim">Open</span>'
        :'<span class="t-num">'+FMT.mins(r.resolutionMins)+'</span>'},
      {key:'status',label:'Status',render:r=>'<div class="row" style="gap:5px">'+statusPill(r.status)+(r.escalated?pill('warning','Esc'):'')+'</div>'}
    ]}) : stateBlock('empty','No tickets from your team','Tickets raised by anyone in '+esc(TEAM.name)+' appear here.'),{flush:true})+
  '</div>';
}

/* ------------------------------ 9. My own line --------------------------- */
function vMyLine(){
  const pct=LEAD.dataUsedGb/LEAD.dataAllowGb*100;
  return pagehead('My line',
    'Your own service, separate from what you manage for the team.',
    '<div class="seg" role="group" aria-label="Scope"><button aria-pressed="false" onclick="App.go(\'home\')">My team</button>'+
    '<button aria-pressed="true">My line</button></div>')+
  '<div class="stack">'+
  '<div class="grid g4">'+
    metric({icon:'database',label:'Data used',value:FMT.gb(LEAD.dataUsedGb),foot:'of '+LEAD.dataAllowGb+' GB · '+FMT.pct(pct)})+
    metric({icon:'phone',label:'Voice minutes',value:FMT.num(LEAD.voiceMin),foot:'Unlimited on your plan'})+
    metric({icon:'globe',label:'Roaming data',value:FMT.gb(LEAD.roamingGb),foot:'EU roam-like-home'})+
    metric({icon:'wallet',label:'Your line costs',value:CUR(LEAD.planPrice),foot:'per month, charged to '+esc(TEAM.cc)})+
  '</div>'+
  '<div class="grid g2">'+
    panel('My service',
      '<div class="row" style="margin-bottom:12px">'+statusPill('active')+'</div>'+
      '<dl class="deflist">'+
        '<dt>Number</dt><dd class="t-num">'+esc(LEAD.msisdn)+'</dd>'+
        '<dt>Plan</dt><dd>'+esc(LEAD.planName)+' · '+CUR(LEAD.planPrice)+'/mo</dd>'+
        '<dt>SIM</dt><dd>'+esc(LEAD.simType)+'<div class="t-tiny muted t-num">ICCID '+esc(LEAD.iccid)+'</div></dd>'+
        '<dt>Device</dt><dd>'+esc(LEAD.device)+'</dd>'+
        '<dt>Role</dt><dd>Team leader — '+esc(TEAM.name)+'</dd>'+
      '</dl>'+
      '<div class="divider"></div>'+
      '<div><div class="t-tiny muted" style="margin-bottom:5px">Data this cycle</div>'+
      meter(pct,FMT.gb(LEAD.dataUsedGb)+' of '+LEAD.dataAllowGb+' GB')+'</div>'+
      '<div class="divider"></div>'+
      '<div class="row wrap"><button class="btn btn-sm" onclick="toast(\'SIM swap request sent to your enterprise admin\')">Request SIM swap</button>'+
      '<button class="btn btn-sm" onclick="toast(\'Ticket form opened\')">Report a problem</button></div>',
      {icon:'smartphone'})+
    panel('My requests and tickets',
      '<h4 class="t-sub" style="margin-bottom:8px">Requests I raised</h4>'+
      '<table class="tbl"><tbody>'+
        '<tr><td><div class="cellmain">Rest-of-world roaming 10 GB</div><div class="cellsub">Raised 1 w ago · with enterprise admin</div></td>'+
        '<td style="width:96px">'+statusPill('pending')+'</td></tr>'+
        '<tr><td><div class="cellmain">Plan upgrade to Business Unlimited</div><div class="cellsub">Raised 1 mo ago</div></td>'+
        '<td style="width:96px">'+statusPill('rejected')+'</td></tr>'+
      '</tbody></table>'+
      '<div class="divider"></div>'+
      '<h4 class="t-sub" style="margin-bottom:8px">My tickets</h4>'+
      (TEAM_TICKETS.length
        ? '<div class="stack" style="gap:7px">'+TEAM_TICKETS.slice(0,3).map(t=>
          '<button class="row" style="width:100%;background:none;border:0;text-align:left;cursor:pointer;padding:0" onclick="openTicket(\''+t.id+'\')">'+
          sevPill(t.severity)+'<span class="t-small grow" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+esc(t.subject)+'</span>'+
          statusPill(t.status)+'</button>').join('')+'</div>'
        : '<p class="t-small muted">You have not raised any tickets.</p>'),
      {icon:'checklist'})+
  '</div>'+
  banner('info','Requests above your own '+CUR(50)+' limit go to an enterprise admin — you cannot approve your own requests, whatever the amount.')+
  '</div>';
}

/* ------------------------------- registration ---------------------------- */
const VIEWS={
  home:vTeamDash, members:vMembers, teamusage:vTeamUsage, spend:vTeamSpend,
  approvals:vApprovals, alerts:vTeamAlerts, reports:vTeamReports, teamtickets:vTeamTickets, mine:vMyLine
};

App.init({
  product:'Enterprise Self-Care', tier:'6D ONE UI · '+OPERATOR.brand,
  env:'Production · EU-West',
  persona:{name:LEAD.name, role:'Team leader', org:TEAM.name},
  searchScope:TEAM.name, alertCount:2,
  notifications:[
    {when:'8 min ago', text:PENDING.length+' add-on requests are waiting on your decision', source:'Approvals', kind:'warning', read:false},
    {when:'1 h ago', text:'The pool your team draws on has passed 90%', source:'Team alerts · pool threshold', kind:'danger', read:false},
    {when:'Today 06:22', text:'A member of your team passed 100% of their allowance', source:'Team alerts · over allowance', kind:'warning', read:true},
    {when:'20 Jul', text:'6 telematics lines stopped reporting — no usage record for 48 hours', source:'Team alerts · line dormancy', kind:'warning', read:true},
    {when:'19 Jul', text:'Usage anomaly flagged and explained — depot survey week', source:'Team alerts · anomaly', kind:'info', read:true}
  ],
  footNote:TEAM.cc+' · '+MEMBERS.length+' members',
  aiName:'AARYA assistant',
  aiGreeting:'I can answer questions about <strong>'+esc(TEAM.name)+'</strong> and about your own line. I do not have access to other teams.'+
    '<div class="src">Sources: team usage records, pool records, approval history, team ticket history.</div>',
  aiSuggestions:['Who in my team is over allowance?','What is waiting on my approval?','Why did six lines stop reporting?','What does my team cost this cycle?'],
  nav:[
    {label:'My team', items:[
      {id:'home', label:'Team dashboard', icon:'dashboard'},
      {id:'members', label:'Members', icon:'users', count:MEMBERS.length},
      {id:'teamusage', label:'Team usage', icon:'activity'},
      {id:'spend', label:'Team spend', icon:'wallet'}]},
    {label:'Decisions', items:[
      {id:'approvals', label:'Approvals', icon:'checklist', count:PENDING.length},
      {id:'teamtickets', label:'Team support', icon:'support', count:TEAM_OPEN.length}]},
    {label:'Insight', items:[
      {id:'alerts', label:'Team alerts', icon:'bell'},
      {id:'reports', label:'Team reports', icon:'chart'}]},
    {label:'Personal', items:[
      {id:'mine', label:'My line', icon:'smartphone'}]}
  ],
  searchIndex:[
    {k:'Screen',t:'Team dashboard',v:'home'},{k:'Screen',t:'Team members and activity',v:'members'},
    {k:'Screen',t:'Team usage and shared pool',v:'teamusage'},{k:'Screen',t:'Team spend and cost',v:'spend'},
    {k:'Screen',t:'Approvals and requests',v:'approvals'},{k:'Screen',t:'Team alerts and anomalies',v:'alerts'},
    {k:'Screen',t:'Team reports',v:'reports'},{k:'Screen',t:'Team support tickets',v:'teamtickets'},
    {k:'Screen',t:'My own line',v:'mine'},
    {k:'Action',t:'Approve a pending request',v:'approvals'},{k:'Action',t:'Request a pool top-up',v:'home'}
  ],
  aiAnswer(q){
    if(/over|allowance|limit|near/.test(q)){
      const o=OVER.slice(0,5);
      return o.length+' people in '+esc(TEAM.name)+' are at or above 85% of their allowance.'+
        '<table><tr><th>Member</th><th>Used</th><th>Allowance</th></tr>'+
        o.map(u=>'<tr><td>'+esc(u.name)+'</td><td>'+FMT.gb(u.dataUsedGb)+'</td><td>'+u.dataAllowGb+' GB</td></tr>').join('')+'</table>'+
        'If nothing changes, expect roughly '+CUR(OVER.length*14)+' of out-of-bundle charges on '+esc(TEAM.cc)+' this cycle.'+
        '<div class="src">Sources: team usage records, plan catalogue, out-of-bundle rate card.</div>';
    }
    if(/approv|waiting|request|decision/.test(q))
      return PENDING.length+' requests are waiting on you.'+
        '<table><tr><th>Request</th><th>Cost</th><th>Policy</th></tr>'+
        PENDING.map(a=>'<tr><td>'+esc(a.item)+'<br><span style="color:#666">'+esc(a.requester)+'</span></td><td>'+CUR(a.cost)+'</td>'+
        '<td>'+(a.policy.indexOf('Requires')===0?'Above your limit':'Within limit')+'</td></tr>').join('')+'</table>'+
        'Two are consistent with the requester\'s own usage pattern. The third includes device capex, so only an enterprise admin can approve it.'+
        '<div class="src">Sources: approval queue, requester usage records, delegation policy.</div>';
    if(/report|telematics|stopped|missing|not measured|gap/.test(q))
      return 'Six telematics lines in your team have recorded nothing since <strong>18 July</strong>. '+
        'That date matches the telemetry gap at Porto and Ghent, so the most likely explanation is the site feed rather than the devices — but the evidence does not separate the two, so I will not state it as fact.'+
        '<br><br>Their consumption is reported as <em>not measured</em> everywhere in this app. It is never shown as zero, because zero would be a claim the data does not support.'+
        '<div class="src">Sources: per-line usage records, telemetry ingest log, site inventory.</div>';
    if(/cost|spend|charge|budget/.test(q))
      return esc(TEAM.name)+' costs <strong>'+CUR0(TEAM_SPEND)+'</strong> in recurring charges this cycle, plus about '+CUR(96.40)+' of out-of-bundle so far.'+
        '<table><tr><th>Component</th><th>Amount</th></tr><tr><td>Recurring plans</td><td>'+CUR0(TEAM_SPEND)+'</td></tr>'+
        '<tr><td>Add-ons</td><td>'+CUR(27)+'</td></tr><tr><td>Out of bundle</td><td>'+CUR(96.40)+'</td></tr></table>'+
        'All of it lands on '+esc(TEAM.cc)+' via invoice '+esc(INVOICES[0].id)+', which closes on 31 July.'+
        '<div class="src">Sources: team spend ledger, add-on ledger, current-cycle usage.</div>';
    return null;
  }
});
