/* ===========================================================================
   PERSONA: Operator Admin — self-care monitoring only.
   Deliberately narrow. Contracts, opportunities, pricing and lifecycle live in
   the Enterprise Billing/CRM, which is a separate system. Everything commercial
   is shown as out of scope with a hand-off, never as a broken feature.
   =========================================================================== */

const AGENT = {name:'Lena Fischer', role:'Operator support — Tier 2', team:'Enterprise care desk, EU-West'};
let FOCUS = ENTERPRISES[0];                 /* the account currently in support context */

const CRM_LINK = '<button class="btn btn-sm" onclick="crmHandoff()">'+ICO('external',13)+'Open in Enterprise CRM</button>';
function crmHandoff(){
  openModal('<div class="modal-head">'+ICO('external',18)+'<div class="grow"><h3 class="t-sub">This lives in the Enterprise CRM</h3>'+
    '<div class="t-small muted">Self-care and the Enterprise Billing/CRM are separate systems by design.</div></div>'+
    '<button class="iconbtn" onclick="closeModal()" aria-label="Close">'+ICO('x',16)+'</button></div>'+
    '<div class="modal-body stack">'+
      '<p class="t-body" style="margin:0">Your self-care login is scoped to what the customer can see and do for themselves: service state, usage, invoices, tickets, and account and user state. '+
      'It exists so you can resolve issues and give oversight — not to manage the commercial relationship.</p>'+
      '<div class="impact"><strong>Handled in the Enterprise CRM, not here</strong><ul>'+
        '<li>Contracts, amendments and renewal dates</li>'+
        '<li>Pricing, discounts and rate-card negotiation</li>'+
        '<li>Opportunities, quotes and the sales pipeline</li>'+
        '<li>Credit control, collections and write-offs</li>'+
        '<li>Account lifecycle — onboarding, migration, termination</li></ul></div>'+
      '<div class="field"><label for="crmRef">Account reference to carry across</label>'+
      '<input class="inp" id="crmRef" value="'+esc(FOCUS.id)+'" readonly></div>'+
    '</div>'+
    '<div class="modal-foot"><span class="t-tiny muted grow">Opening the CRM records an access entry against this account.</span>'+
    '<button class="btn btn-quiet" onclick="closeModal()">Stay here</button>'+
    '<button class="btn btn-primary" onclick="closeModal();toast(\'Enterprise CRM opened in a new tab for '+esc(FOCUS.id)+'\')" data-autofocus>Open CRM</button></div>',
    {label:'Open in Enterprise CRM'});
}

/* Support context must be justified — the customer sees it in their audit log. */
function enterContext(id){
  const e=ENTERPRISES.find(x=>x.id===id); if(!e) return;
  confirmAction({
    title:'Enter support context for '+e.name, subtitle:e.id+' · '+e.segment, risk:'normal',
    confirmLabel:'Enter support context',
    body:'<div class="field"><label for="ctxWhy">Reason for access</label><select class="inp" id="ctxWhy" data-autofocus>'+
      '<option>Responding to an open ticket</option><option>Inbound call from the customer</option>'+
      '<option>Proactive check on a service incident</option><option>Billing query raised by the customer</option></select></div>'+
      '<div class="field" style="margin-top:12px"><label for="ctxRef">Ticket or interaction reference</label>'+
      '<input class="inp" id="ctxRef" placeholder="e.g. TCK-59120 or INT-40218"></div>',
    impact:['You see exactly what the customer sees — nothing more, nothing hidden from them.',
            'The access is written to <strong>the customer\'s own audit log</strong> with your name and reason.',
            'You cannot change plans, pay invoices or delete users. Support actions are limited to reissuing access and raising tickets.',
            'The context expires after 60 minutes of inactivity.'],
    footNote:'Access without a stated reason is not possible on enterprise accounts.',
    onConfirm:()=>{ FOCUS=e; toast('Support context: '+e.name+' — logged to their audit trail'); App.go('account'); }
  });
}

const OPS_INSIGHTS=[
  {icon:'trenddown', conf:'High confidence',
   title:'Volta Mobility has not signed in for 11 days',
   body:'Self-care adoption is <strong>19%</strong> against a portfolio median above 60%, and 2,960 lines are being managed by ticket instead of self-service. That is roughly <strong>38 avoidable contacts a month</strong> on the care desk.',
   acts:'<button class="btn btn-sm" onclick="enterContext(\'ENT-101455\')">Open account</button>'+
        '<button class="btn btn-sm" onclick="toast(\'Adoption outreach queued for the account manager\')">Flag to account manager</button>'},
  {icon:'support', conf:'High confidence',
   title:'Karstadt Retail is driving a third of your open tickets',
   body:'14 of your '+ENTERPRISES.reduce((a,e)=>a+e.openTickets,0)+' open tickets come from one account, and 9 of them are variations of the same eSIM activation problem. A single fix at the profile-issuance step would close most of them.',
   acts:'<button class="btn btn-sm" onclick="App.go(\'tickets\')">See the cluster</button>'},
  {icon:'eyeoff', conf:'Low confidence — partial evidence',
   title:'Adoption cannot be measured for one account',
   body:'Baltic Marine Services has generated no self-care session records this period, so its adoption figure is <strong>not measured</strong>. It is left blank rather than reported as low engagement, which would be a different claim.',
   acts:'<button class="btn btn-sm" onclick="App.go(\'adoption\')">Open adoption</button>'}
];

/* -------------------------- 1. Portfolio overview ------------------------ */
function vPortfolio(){
  const tot=ENTERPRISES.reduce((a,e)=>({u:a.u+e.users,l:a.l+e.lines,t:a.t+e.openTickets,b:a.b+e.balance}),{u:0,l:0,t:0,b:0});
  return pagehead('Enterprise self-care — portfolio',
    ENTERPRISES.length+' accounts in your care queue · '+FMT.num(tot.l)+' lines · this view is scoped to self-care only',
    '<div class="seg" role="group" aria-label="Queue"><button aria-pressed="true">My queue</button>'+
    '<button aria-pressed="false" onclick="toast(\'All EU-West accounts\')">All EU-West</button></div>'+
    exportBtn('Portfolio'))+
  '<div class="stack">'+

  banner('info','<strong>This login is scoped to self-care.</strong> You can see and assist with what the customer can see and do for themselves — service state, usage, invoices, tickets, and account and user state. '+
    'Contracts, pricing, opportunities and account lifecycle are handled in the Enterprise Billing/CRM. '+
    '<button class="linkbtn" onclick="crmHandoff()">What lives where</button>')+

  '<div class="grid g4">'+
    metric({icon:'building',label:'Accounts in queue',value:String(ENTERPRISES.length),
      foot:ENTERPRISES.filter(e=>e.health!=='healthy').length+' need attention'})+
    metric({icon:'users',label:'Enterprise users',value:FMT.num(tot.u),foot:FMT.num(tot.l)+' lines under management'})+
    metric({icon:'support',label:'Open tickets',value:String(tot.t),
      foot:Math.max.apply(null,ENTERPRISES.map(e=>e.openTickets))+' of them from a single account'})+
    metric({icon:'gauge',label:'Median self-care adoption',value:(function(){var a=ENTERPRISES.filter(e=>e.id!=='ENT-100077').map(e=>e.adoption).sort((x,y)=>x-y);return Math.round((a[(a.length>>1)-1]+a[a.length>>1])/2)+'%';})(),
      foot:pill('partial','1 account not measured')})+
  '</div>'+

  panel('AI insights', OPS_INSIGHTS.map(aiInsight).join(''),
    {ai:true,flush:true,icon:'ai',
     sub:'Derived from self-care telemetry only. Commercial performance is not visible to this login.'})+

  panel('Accounts', dt('dtPortfolio',{
    rows:ENTERPRISES, noun:'accounts', pageSize:10, sortKey:'openTickets', sortDir:'desc', onRow:"enterContext('$ID')",
    searchFields:['id','name','segment','csm'], searchPlaceholder:'Search account, ID or segment',
    chips:[{key:'health',options:[{label:'Healthy',value:'healthy'},{label:'Needs attention',value:'attention'},{label:'At risk',value:'risk'}]}],
    actions:exportBtn('Account list'),
    columns:[
      {key:'name',label:'Account',render:r=>'<div class="cellmain">'+esc(r.name)+'</div><div class="cellsub t-num">'+esc(r.id)+' · '+esc(r.segment)+'</div>'},
      {key:'users',label:'Users',align:'right',render:r=>'<span class="t-num">'+FMT.num(r.users)+'</span>'},
      {key:'lines',label:'Lines',align:'right',render:r=>'<span class="t-num">'+FMT.num(r.lines)+'</span>'},
      {key:'sites',label:'Sites',align:'right',render:r=>'<span class="t-num">'+r.sites+'</span>'},
      {key:'adoption',label:'Self-care adoption',align:'right',width:'160px',
        render:r=>r.id==='ENT-100077'?meter(null,null,{naLabel:'Not measured'}):meter(r.adoption)},
      {key:'openTickets',label:'Open tickets',align:'right',render:r=>r.openTickets
        ? '<span class="t-num'+(r.openTickets>8?'" style="color:var(--nim-danger-fg)':'')+'">'+r.openTickets+'</span>'
        : '<span class="dim">None</span>'},
      {key:'balance',label:'Balance due',align:'right',render:r=>r.balance?'<span class="t-num">'+CUR(r.balance)+'</span>':'<span class="dim">Settled</span>'},
      {key:'lastLogin',label:'Last sign-in',render:r=>esc(r.lastLogin)},
      {key:'health',label:'Health',render:r=>healthPill(r.health)},
      {key:'__acts',label:'',sort:false,render:r=>'<button class="btn btn-sm btn-quiet" onclick="event.stopPropagation();enterContext(\''+r.id+'\')">Assist</button>'}
    ]}),{flush:true,icon:'building',
    sub:'Health is a self-care signal — sign-in recency, ticket load and unpaid balance. It is not a commercial health score.'})+
  '</div>';
}

/* --------------------- 2. Account in support context --------------------- */
function vAccount(){
  const isMeridian = FOCUS.id===ENT.id;
  return pagehead(FOCUS.name+' — self-care view',
    esc(FOCUS.id)+' · '+esc(FOCUS.segment)+' · you are in support context, and the customer can see that you are',
    '<button class="btn" onclick="App.go(\'portfolio\')">'+ICO('chevleft',13)+'Back to queue</button>'+
    CRM_LINK+
    '<button class="btn btn-primary" onclick="opsTicket()">'+ICO('plus',14)+'Raise on behalf</button>')+
  '<div class="stack">'+

  banner('warning','<strong>Support context is active.</strong> '+esc(AGENT.name)+' · reason: responding to an open ticket. '+
    'This session is recorded in the customer\'s audit log and expires after 60 minutes of inactivity. '+
    '<button class="linkbtn" onclick="toast(\'Support context ended\');App.go(\'portfolio\')">End context</button>')+

  (!isMeridian
    ? panel(null, stateBlock('unavailable','Detailed self-care telemetry is not loaded for this account',
        'A full record set is available for '+esc(ENT.name)+'. Select that account from the queue to walk the complete support journey.',
        '<button class="btn btn-sm btn-primary" onclick="enterContext(\''+ENT.id+'\')">Switch to '+esc(ENT.name)+'</button>'), {flush:true})
    :
  '<div class="grid g4">'+
    metric({icon:'users',label:'Users',value:FMT.num(KPI.users),
      foot:KPI.activeUsers+' active · '+KPI.invited+' never signed in'})+
    metric({icon:'network',label:'Sites online',value:KPI.sitesOnline+' / '+KPI.sites,
      foot:SITE_DOWN.length+' down · '+SITE_DEG.length+' degraded'})+
    metric({icon:'invoice',label:'Balance due',value:CUR(KPI.balanceDue),foot:INV_OPEN.length+' unsettled · 1 overdue'})+
    metric({icon:'support',label:'Open tickets',value:String(KPI.openTickets),
      foot:TICKETS.filter(t=>t.escalated&&t.status!=='resolved').length+' escalated to Tier 2'})+
  '</div>'+

  banner('danger','<strong>'+esc(SITE_DOWN[0].name)+' ('+esc(SITE_DOWN[0].id)+') is down</strong> — incident INC-88214, raised 12 minutes ago at Tier 2. '+
    'The customer has been notified automatically and can see the same state in their own portal.')+

  '<div class="grid g-2-1">'+
    panel('What the customer is seeing right now',
      '<div class="stack" style="gap:0">'+
      [['Field operations pool at '+FMT.pct(POOLS[0].pct),'Usage threshold alert fired 1 h ago','danger'],
       ['Invoice '+INVOICES[1].id+' overdue by 4 days','Billing alert fired 3 h ago','danger'],
       [SITE_DOWN[0].name+' down','Service alert fired 12 min ago','danger'],
       ['Paris hub latency above SLA','Service alert fired yesterday','warning'],
       [KPI.pendingApprovals+' requests awaiting a decision','Approval queue','warning']]
      .map(r=>'<div class="row" style="padding:9px 0;border-bottom:1px solid var(--nim-line-100)">'+
        '<span style="color:var(--nim-'+r[2]+'-fg);flex:0 0 auto">'+ICO(r[2]==='danger'?'alert':'warning',15)+'</span>'+
        '<div class="grow"><div class="t-small strong">'+esc(r[0])+'</div><div class="t-tiny muted">'+esc(r[1])+'</div></div></div>').join('')+
      '</div>'+
      '<div class="divider"></div>'+
      '<div class="t-tiny muted">Seeing the customer\'s own alert state first is usually faster than asking them to describe the problem.</div>',
      {icon:'bell'})+
    panel('Account facts',
      '<dl class="deflist" style="grid-template-columns:120px 1fr">'+
        '<dt>Account</dt><dd class="t-num">'+esc(ENT.id)+'</dd>'+
        '<dt>Legal entity</dt><dd>'+esc(ENT.legal)+'</dd>'+
        '<dt>Segment</dt><dd>'+esc(ENT.segment)+'</dd>'+
        '<dt>Primary contact</dt><dd>'+esc(ENT.primaryContact)+'</dd>'+
        '<dt>Account manager</dt><dd>'+esc(ENT.csm)+'</dd>'+
        '<dt>Last sign-in</dt><dd>'+esc(FOCUS.lastLogin)+'</dd>'+
        '<dt>Self-care adoption</dt><dd>'+FMT.pct(FOCUS.adoption)+' of users active in 30 days</dd>'+
        '<dt>Contract and pricing</dt><dd><span class="nodata">Held in the Enterprise CRM</span></dd>'+
        '<dt>Credit status</dt><dd><span class="nodata">Held in the Enterprise CRM</span></dd>'+
      '</dl>'+
      '<div class="divider"></div>'+CRM_LINK,
      {icon:'building'})+
  '</div>'+

  '<div class="grid g2">'+
    panel('Usage the customer can see',
      CH.line([{pts:USAGE_DATA}],{fmt:n=>Math.round(n/1000)+' TB',tip:n=>FMT.gb(n),aria:'Customer data consumption'})+
      '<div class="legend"><span><i style="background:#0099FF"></i>Data consumed</span>'+
      '<span><i style="background:#E4E4E4"></i>Aug 2025 — outside the retention window</span></div>',
      {icon:'activity',acts:'<button class="btn btn-sm btn-quiet" onclick="App.go(\'usage\')">Open usage</button>'})+
    panel('Service state',
      '<table class="tbl"><tbody>'+
      SITES.filter(s=>s.status!=='online').concat(SITE_NOTEL).slice(0,6).map(s=>
        '<tr onclick="openSite(\''+s.id+'\')" style="cursor:pointer"><td><div class="cellmain">'+esc(s.name)+'</div>'+
        '<div class="cellsub t-num">'+esc(s.id)+' · '+esc(s.city)+'</div></td>'+
        '<td class="num" style="width:130px">'+(s.utilPct==null?meter(null,null,{naLabel:'No telemetry'}):meter(s.utilPct))+'</td>'+
        '<td style="width:104px">'+statusPill(s.status)+'</td></tr>').join('')+
      '</tbody></table>',
      {flush:true,icon:'network',acts:'<button class="btn btn-sm btn-quiet" onclick="App.go(\'services\')">All services</button>'})+
  '</div>')+
  '</div>';
}

/* ------------------------- 3. Users and account state -------------------- */
function vOpsUsers(){
  return pagehead('Users and account state',
    'Read-only view of who exists on '+esc(ENT.id)+' and what state they are in. Support actions are limited to reissuing access.',
    exportBtn('User state')+
    '<button class="btn" onclick="crmHandoff()">'+ICO('external',13)+'Commercial view</button>')+
  '<div class="stack">'+
  banner('warning','<strong>You cannot change this customer\'s users.</strong> Inviting, suspending, deactivating and role changes are the enterprise admin\'s to make. '+
    'You can resend an invitation, reissue a one-time code and clear a locked sign-in — nothing else.')+
  '<div class="grid g4">'+
    metric({icon:'users',label:'Users',value:FMT.num(KPI.users),foot:KPI.activeUsers+' active'})+
    metric({icon:'mail',label:'Invited, never signed in',value:String(KPI.invited),foot:'Common cause of “I have no access” calls'})+
    metric({icon:'pause',label:'Suspended',value:String(KPI.suspended),foot:'Suspended by the customer, not by us'})+
    metric({icon:'shield',label:'Without MFA',value:String(USERS.filter(u=>!u.mfa&&u.status==='active').length),
      foot:'Customer policy requires MFA for billing roles only'})+
  '</div>'+
  panel(null, dt('dtOpsUsers',{
    rows:USERS, noun:'users', pageSize:12, sortKey:'name', idKey:'id', onRow:"opsUser('$ID')",
    searchFields:['name','email','msisdn','teamName','id'], searchPlaceholder:'Search name, email or number',
    chips:[{key:'status',options:[{label:'Active',value:'active'},{label:'Invited',value:'invited'},
      {label:'Suspended',value:'suspended'},{label:'Deactivated',value:'deactivated'}]}],
    actions:exportBtn('User state'),
    columns:[
      {key:'name',label:'User',render:r=>'<div class="row" style="gap:8px"><span class="avatar" aria-hidden="true">'+esc(FMT.initials(r.name))+'</span>'+
        '<div><div class="cellmain">'+esc(r.name)+'</div><div class="cellsub">'+esc(r.email)+'</div></div></div>'},
      {key:'teamName',label:'Team',render:r=>esc(r.teamName)},
      {key:'role',label:'Role',render:r=>r.role==='Enterprise admin'?pill('info','Enterprise admin'):r.role==='Team leader'?pill('partial','Team leader'):'<span class="t-small muted">Standard user</span>'},
      {key:'msisdn',label:'Number',render:r=>'<span class="t-num">'+esc(r.msisdn)+'</span>'},
      {key:'mfa',label:'MFA',render:r=>r.mfa?pill('success','On'):pill('warning','Off')},
      {key:'lastActive',label:'Last active',render:r=>r.lastActive==='Never'?'<span class="nodata">Never signed in</span>':esc(r.lastActive)},
      {key:'status',label:'State',render:r=>statusPill(r.status)},
      {key:'__acts',label:'',sort:false,render:r=>'<button class="btn btn-sm btn-quiet" onclick="event.stopPropagation();opsUser(\''+r.id+'\')">Assist</button>'}
    ]}),{flush:true})+
  '</div>';
}
function opsUser(id){
  const u=USERS.find(x=>x.id===id); if(!u) return;
  openInspector(
    '<div class="insp-head"><span class="avatar" style="width:36px;height:36px;font-size:13px" aria-hidden="true">'+esc(FMT.initials(u.name))+'</span>'+
      '<div class="grow"><div class="row" style="gap:6px">'+statusPill(u.status)+(u.mfa?pill('success','MFA on'):pill('warning','MFA off'))+'</div>'+
      '<h3 class="t-sub" style="margin-top:5px">'+esc(u.name)+'</h3>'+
      '<div class="t-small muted">'+esc(u.email)+' · '+esc(u.id)+'</div></div>'+
      '<button class="iconbtn" onclick="closeInspector()" aria-label="Close">'+ICO('x',16)+'</button></div>'+
    '<div class="insp-body stack">'+
      banner('info','You are seeing exactly what this user sees in their own portal. Nothing is hidden from them, and nothing extra is exposed to you.')+
      '<dl class="deflist">'+
        '<dt>Team</dt><dd>'+esc(u.teamName)+' ('+esc(u.cc)+')</dd>'+
        '<dt>Role</dt><dd>'+esc(u.role)+'</dd>'+
        '<dt>Number</dt><dd class="t-num">'+esc(u.msisdn)+'</dd>'+
        '<dt>SIM</dt><dd>'+esc(u.simType)+'</dd>'+
        '<dt>Plan</dt><dd>'+esc(u.planName)+'</dd>'+
        '<dt>Data this cycle</dt><dd>'+(u.dataUsedGb==null?NOTMEASURED():FMT.gb(u.dataUsedGb)+(u.dataAllowGb?' of '+u.dataAllowGb+' GB':''))+'</dd>'+
        '<dt>Last sign-in</dt><dd>'+(u.lastActive==='Never'?'<span class="nodata">Never signed in</span>':esc(u.lastActive))+'</dd>'+
        '<dt>Invited</dt><dd>'+esc(u.joined)+'</dd>'+
      '</dl>'+
      (u.status==='invited'?banner('warning','<strong>This user has never completed verification.</strong> The invitation was sent '+esc(u.joined)+'. '+
        'Reissuing it is usually enough; if the identifier itself is wrong, only the enterprise admin can correct it.'):'')+
      '<div class="divider"></div><h4 class="t-sub">Access events</h4>'+
      '<ul class="timeline">'+
        '<li class="tl-primary"><div class="tl-when">Today 09:41</div><div class="tl-what">One-time code delivered to '+esc(u.email)+'</div><div class="tl-who">Notification service</div></li>'+
        '<li class="tl-danger"><div class="tl-when">Today 09:39</div><div class="tl-what">Two incorrect code entries — 3 attempts remain before the code is invalidated</div><div class="tl-who">Verification service</div></li>'+
        '<li class="tl-primary"><div class="tl-when">Today 09:37</div><div class="tl-what">Sign-in started from Rotterdam, NL</div><div class="tl-who">'+esc(u.name)+'</div></li>'+
      '</ul>'+
    '</div>'+
    '<div class="insp-foot">'+
      '<button class="btn btn-quiet" onclick="closeInspector()">Close</button><div class="spacer"></div>'+
      '<button class="btn btn-sm" onclick="toast(\'One-time code reissued to '+esc(u.email)+'\')">Reissue code</button>'+
      '<button class="btn btn-sm" onclick="toast(\'Sign-in lock cleared\')">Clear lock</button>'+
      '<button class="btn btn-sm btn-primary" onclick="opsTicket()">Raise ticket</button>'+
    '</div>','User '+u.name);
}

/* ---------------------------- 4. Service status -------------------------- */
function vOpsServices(){
  return pagehead('Service state',
    'What the customer sees about their own connectivity. Provisioning and change execution happen in your OSS, not here.',
    exportBtn('Service state')+
    '<button class="btn btn-primary" onclick="opsTicket()">'+ICO('plus',14)+'Raise on behalf</button>')+
  '<div class="stack">'+
  banner('danger','<strong>'+esc(SITE_DOWN[0].name)+' ('+esc(SITE_DOWN[0].id)+') is down.</strong> Incident INC-88214 is open at Tier 2. The customer was alerted automatically 12 minutes ago — you do not need to tell them it happened, only what you are doing about it.')+
  '<div class="grid g4">'+
    metric({icon:'network',label:'Sites online',value:KPI.sitesOnline+' / '+KPI.sites,foot:SITE_DOWN.length+' down · '+SITE_DEG.length+' degraded'})+
    metric({icon:'clock',label:'Availability, 30 days',value:FMT.pct(SITES.reduce((a,s)=>a+s.uptime30,0)/SITES.length),
      foot:'Contracted floor 99.5%'})+
    metric({icon:'eyeoff',label:'Sites without telemetry',value:String(SITE_NOTEL.length),
      foot:pill('partial','Reported as not measured')})+
    metric({icon:'smartphone',label:'Mobile lines',value:FMT.num(KPI.lines),foot:KPI.suspended+' suspended by the customer'})+
  '</div>'+
  panel('Sites and circuits', dt('dtOpsSites',{
    rows:SITES, noun:'sites', pageSize:12, sortKey:'status', onRow:"openSite('$ID')",
    searchFields:['id','name','city','country','type'], searchPlaceholder:'Search site, city or ID',
    chips:[{key:'status',options:[{label:'Down',value:'down'},{label:'Degraded',value:'degraded'},{label:'Online',value:'online'}]},
           {key:'type',options:[{label:'SD-WAN',value:'SD-WAN'},{label:'MPLS',value:'MPLS'}]}],
    actions:exportBtn('Site state'),
    columns:[
      {key:'name',label:'Site',render:r=>'<div class="cellmain">'+esc(r.name)+'</div><div class="cellsub t-num">'+esc(r.id)+' · '+esc(r.city)+', '+esc(r.country)+'</div>'},
      {key:'type',label:'Service',render:r=>r.type==='SD-WAN'?pill('info','SD-WAN'):pill('partial','MPLS')},
      {key:'bwMbps',label:'Bandwidth',align:'right',render:r=>'<span class="t-num">'+r.bwMbps+' Mbps</span>'},
      {key:'utilPct',label:'Utilisation',align:'right',width:'150px',render:r=>r.utilPct==null?meter(null,null,{naLabel:'Not measured'}):meter(r.utilPct)},
      {key:'latencyMs',label:'Latency',align:'right',render:r=>r.latencyMs==null?NOTMEASURED():'<span class="t-num">'+FMT.dec(r.latencyMs,1)+' ms</span>'},
      {key:'uptime30',label:'Uptime 30 d',align:'right',render:r=>'<span class="t-num">'+FMT.dec(r.uptime30,2)+'%</span>'},
      {key:'status',label:'State',render:r=>statusPill(r.status)},
      {key:'__acts',label:'',sort:false,render:r=>'<button class="btn btn-sm btn-quiet" onclick="event.stopPropagation();openSite(\''+r.id+'\')">Inspect</button>'}
    ]}),{flush:true,icon:'network'})+
  '</div>';
}

/* --------------------------- 5. Usage oversight -------------------------- */
function vOpsUsage(){
  return pagehead('Usage oversight',
    'The customer\'s own consumption view, read-only. Useful for settling “why is my bill high” before it becomes a dispute.',
    exportBtn('Usage'))+
  '<div class="stack">'+
  '<div class="grid g4">'+
    metric({icon:'database',label:'Data this cycle',value:FMT.gb(KPI.dataUsedGb),foot:FMT.pct(KPI.poolPct)+' of pooled allowance'})+
    metric({icon:'warning',label:'Lines over allowance',value:String(USERS.filter(u=>u.dataAllowGb&&u.dataUsedGb>u.dataAllowGb).length),
      foot:'Out of bundle '+CUR(486.20)+' so far'})+
    metric({icon:'globe',label:'Roaming data',value:FMT.gb(USERS.reduce((a,u)=>a+(u.roamingGb||0),0)),
      foot:CUR(1840)+' unattributed — 2 sites without telemetry'})+
    metric({icon:'gauge',label:'Pool headroom',value:FMT.gb(KPI.dataAllowGb-KPI.dataUsedGb),foot:'9 days of cycle remain'})+
  '</div>'+
  banner('partial','<strong>'+CUR(1840)+' of roaming charges cannot be attributed to a cost centre.</strong> Porto and Ghent stopped reporting on 18 July. '+
    'If the customer queries it, the honest answer is that the detail records have not arrived — not that the charge is wrong.')+
  '<div class="grid g-2-1">'+
    panel('Consumption trend',
      CH.line([{pts:USAGE_DATA}],{fmt:n=>Math.round(n/1000)+' TB',tip:n=>FMT.gb(n),aria:'Data consumption over 12 cycles'})+
      '<div class="legend"><span><i style="background:#0099FF"></i>Data consumed</span>'+
      '<span><i style="background:#E4E4E4"></i>Aug 2025 — outside the customer\'s 12-month retention window</span></div>',
      {icon:'activity'})+
    panel('Pools',
      '<div class="stack" style="gap:13px">'+POOLS.map(p=>
        '<div><div class="row" style="margin-bottom:5px"><span class="t-small grow">'+esc(p.name)+'</span>'+
        '<span class="t-small strong t-num">'+FMT.pct(p.pct)+'</span></div>'+
        meter(p.pct,FMT.gb(p.usedGb)+' / '+FMT.gb(p.allowGb))+'</div>').join('')+'</div>'+
      '<div class="divider"></div>'+
      '<div class="t-tiny muted">Only the customer\'s enterprise admin can allocate a top-up. You can raise it as a recommendation on a ticket.</div>',
      {icon:'database'})+
  '</div>'+
  panel('Top consumers',
    '<table class="tbl"><thead><tr><th>User</th><th>Team</th><th>Plan</th><th class="num">Data</th><th class="num">Roaming</th></tr></thead><tbody>'+
    USERS.filter(u=>u.dataUsedGb!=null).sort((a,b)=>b.dataUsedGb-a.dataUsedGb).slice(0,10).map(u=>
      '<tr><td class="cellmain">'+esc(u.name)+'</td><td>'+esc(u.teamName)+'</td><td>'+esc(u.planName)+'</td>'+
      '<td class="num">'+FMT.gb(u.dataUsedGb)+'</td><td class="num">'+(u.roamingGb?FMT.gb(u.roamingGb):'<span class="dim">—</span>')+'</td></tr>').join('')+
    '</tbody></table>',{flush:true,icon:'trendup'})+
  '</div>';
}

/* -------------------------- 6. Billing oversight ------------------------- */
function vOpsBilling(){
  return pagehead('Billing oversight',
    'What the customer sees on their invoices. Credit control, disputes over commercial terms and write-offs are handled in the Enterprise CRM.',
    CRM_LINK+exportBtn('Invoice history'))+
  '<div class="stack">'+
  banner('warning','<strong>Read-only.</strong> You can see invoices and explain charge lines. You cannot take payment, issue a credit, or change payment terms from this login. '+
    '<button class="linkbtn" onclick="crmHandoff()">Where those live</button>')+
  '<div class="grid g4">'+
    metric({icon:'wallet',label:'Balance due',value:CUR(KPI.balanceDue),foot:INV_OPEN.length+' unsettled'})+
    metric({icon:'alert',label:'Overdue',value:CUR(INVOICES[1].amount),foot:'4 days past due · '+esc(INVOICES[1].id)})+
    metric({icon:'checkcircle',label:'Payment record',value:'11 of 12',foot:'Settled within terms, trailing 12 cycles'})+
    metric({icon:'flag',label:'Open disputes',value:null,naLabel:'None recorded',foot:'Disputes are raised in the CRM'})+
  '</div>'+
  panel('Invoices', dt('dtOpsInv',{
    rows:INVOICES, noun:'invoices', pageSize:12, sortKey:'id', sortDir:'desc', onRow:"openInvoice('$ID')",
    searchFields:['id','period','status'], searchPlaceholder:'Search invoice or period',
    chips:[{key:'status',options:[{label:'Paid',value:'paid'},{label:'Open',value:'open'},{label:'Overdue',value:'overdue'}]}],
    columns:[
      {key:'id',label:'Invoice',render:r=>'<div class="cellmain t-num">'+esc(r.id)+'</div><div class="cellsub">'+r.lines+' charge lines</div>'},
      {key:'period',label:'Period',render:r=>esc(r.period)},
      {key:'due',label:'Due',render:r=>esc(r.due)},
      {key:'recurring',label:'Recurring',align:'right',render:r=>'<span class="t-num">'+CUR(r.recurring)+'</span>'},
      {key:'usage',label:'Usage',align:'right',render:r=>'<span class="t-num">'+CUR(r.usage)+'</span>'},
      {key:'amount',label:'Total',align:'right',render:r=>'<span class="t-num cellmain">'+CUR(r.amount)+'</span>'},
      {key:'status',label:'Status',render:r=>statusPill(r.status)},
      {key:'__acts',label:'',sort:false,render:r=>'<button class="btn btn-sm btn-quiet" onclick="event.stopPropagation();openInvoice(\''+r.id+'\')">Explain</button>'}
    ]}),{flush:true,icon:'invoice',
    sub:'Opening an invoice shows the same charge breakdown the customer sees, so your explanation matches their screen.'})+
  '</div>';
}

/* -------------------------- 7. Support queue ----------------------------- */
function vOpsTickets(){
  const cluster=TICKETS.filter(t=>/eSIM|SIM swap|activat/i.test(t.subject));
  return pagehead('Support queue',
    KPI.openTickets+' open on '+esc(ENT.id)+' · portfolio-wide you have '+ENTERPRISES.reduce((a,e)=>a+e.openTickets,0)+' across '+ENTERPRISES.length+' accounts',
    '<div class="seg" role="group" aria-label="Queue scope"><button aria-pressed="true">This account</button>'+
    '<button aria-pressed="false" onclick="toast(\'Portfolio queue\')">Whole portfolio</button></div>'+
    '<button class="btn btn-primary" onclick="opsTicket()">'+ICO('plus',14)+'Raise on behalf</button>')+
  '<div class="stack">'+
  (cluster.length>2?banner('info','<strong>'+cluster.length+' tickets on this account describe the same eSIM activation problem.</strong> Treating them as one cluster is usually faster than working them individually. '+
    '<button class="linkbtn" onclick="toast(\'Cluster grouped — a single Tier 2 investigation covers all '+cluster.length+'\')">Group as one investigation</button>'):'')+
  '<div class="grid g4">'+
    metric({icon:'inbox',label:'Open on this account',value:String(KPI.openTickets),
      foot:TICKETS.filter(t=>t.status!=='resolved'&&t.severity==='P1').length+' at P1'})+
    metric({icon:'trendup',label:'Escalated to Tier 2',value:String(TICKETS.filter(t=>t.escalated&&t.status!=='resolved').length),foot:'Yours to progress'})+
    metric({icon:'clock',label:'Mean time to resolve',value:FMT.mins(KPI.mttr),foot:'This account, trailing 12 months'})+
    metric({icon:'checkcircle',label:'Within SLA',value:FMT.pct(KPI.slaOk),foot:T_RES.filter(t=>t.breached).length+' breaches'})+
  '</div>'+
  panel(null, dt('dtOpsTck',{
    rows:TICKETS, noun:'tickets', pageSize:12, sortKey:'severity', onRow:"openTicket('$ID')",
    searchFields:['id','subject','openedBy','teamName','owner'], searchPlaceholder:'Search ticket, subject or requester',
    chips:[{key:'status',options:[{label:'Open',value:'open'},{label:'In progress',value:'inprogress'},
      {label:'Pending',value:'pending'},{label:'Resolved',value:'resolved'}]},
      {key:'severity',options:[{label:'P1',value:'P1'},{label:'P2',value:'P2'},{label:'P3',value:'P3'},{label:'P4',value:'P4'}]}],
    actions:exportBtn('Ticket queue'),
    columns:[
      {key:'id',label:'Ticket',render:r=>'<div class="cellmain t-num">'+esc(r.id)+'</div><div class="cellsub">'+esc(r.opened)+'</div>'},
      {key:'subject',label:'Subject',render:r=>'<div class="cellmain">'+esc(r.subject)+'</div><div class="cellsub">via '+esc(r.channel)+'</div>'},
      {key:'severity',label:'Severity',render:r=>sevPill(r.severity)},
      {key:'openedBy',label:'Raised by',render:r=>esc(r.openedBy)+'<div class="cellsub">'+esc(r.teamName)+'</div>'},
      {key:'owner',label:'Owner',render:r=>'<span class="t-small">'+esc(r.owner)+'</span>'},
      {key:'slaMins',label:'SLA target',align:'right',render:r=>'<span class="t-num">'+FMT.mins(r.slaMins)+'</span>'},
      {key:'status',label:'Status',render:r=>'<div class="row" style="gap:5px">'+statusPill(r.status)+(r.breached?pill('breached','Breached'):'')+'</div>'},
      {key:'__acts',label:'',sort:false,render:r=>'<button class="btn btn-sm btn-quiet" onclick="event.stopPropagation();openTicket(\''+r.id+'\')">Work</button>'}
    ]}),{flush:true})+
  '</div>';
}
function opsTicket(){
  openModal('<div class="modal-head">'+ICO('support',18)+'<div class="grow"><h3 class="t-sub">Raise a ticket on behalf of the customer</h3>'+
    '<div class="t-small muted">The ticket appears in the customer\'s own support screen, attributed to you.</div></div>'+
    '<button class="iconbtn" onclick="closeModal()" aria-label="Close">'+ICO('x',16)+'</button></div>'+
    '<div class="modal-body stack">'+
      '<div class="grid g2">'+
        '<div class="field"><label for="otAcct">Account</label><input class="inp" id="otAcct" value="'+esc(FOCUS.name)+' ('+esc(FOCUS.id)+')" readonly></div>'+
        '<div class="field"><label for="otFor">On behalf of</label><select class="inp" id="otFor" data-autofocus>'+
          '<option>'+esc(ENT.primaryContact)+' (enterprise admin)</option>'+
          USERS.filter(u=>u.status==='active'&&u.email!=='—').slice(0,6).map(u=>'<option>'+esc(u.name)+'</option>').join('')+
        '</select></div>'+
      '</div>'+
      '<div class="field"><label for="otSubj">Subject</label><input class="inp" id="otSubj" placeholder="Describe the problem as the customer would recognise it"></div>'+
      '<div class="grid g2">'+
        '<div class="field"><label for="otSev">Severity</label><select class="inp" id="otSev">'+
          '<option>P1 — site or many users down (4 h)</option><option selected>P2 — degraded (8 h)</option>'+
          '<option>P3 — single line (1 day)</option><option>P4 — question (2 days)</option></select></div>'+
        '<div class="field"><label for="otQ">Route to</label><select class="inp" id="otQ">'+
          '<option>Tier 1 — enterprise care</option><option selected>Tier 2 — enterprise care</option>'+
          '<option>Network operations</option><option>Billing operations</option></select></div>'+
      '</div>'+
      '<div class="field"><label for="otDet">What you have established so far</label><textarea class="inp" id="otDet"></textarea></div>'+
      '<div class="impact"><strong>Visible to the customer</strong><ul>'+
        '<li>The ticket, its severity and every update you post.</li>'+
        '<li>Your name and team as the raiser.</li>'+
        '<li>An entry in their audit log showing you acted on their account.</li></ul></div>'+
    '</div>'+
    '<div class="modal-foot"><span class="t-tiny muted grow">Internal notes are not available on customer-visible tickets.</span>'+
    '<button class="btn btn-quiet" onclick="closeModal()">Cancel</button>'+
    '<button class="btn btn-primary" onclick="closeModal();toast(\'Ticket TCK-59226 raised on behalf of the customer\')">Raise ticket</button></div>',
    {wide:true,label:'Raise a ticket on behalf'});
}

/* ------------------------- 8. Adoption and engagement -------------------- */
function vAdoption(){
  const rows=ENTERPRISES.map(e=>Object.assign({},e,{
    adoption: e.id==='ENT-100077'?null:e.adoption,
    selfServed: e.id==='ENT-100077'?null:Math.round(e.adoption*0.9),
    ticketsPerK: e.lines?+(e.openTickets/e.lines*1000).toFixed(1):null
  }));
  return pagehead('Self-care adoption',
    'How much each account does for itself. Low adoption is the leading indicator of avoidable contact on the care desk.',
    exportBtn('Adoption')+scheduleBtn())+
  '<div class="stack">'+
  banner('partial','<strong>Adoption is not measured for 1 account.</strong> Baltic Marine Services has generated no self-care session records this period. '+
    'That is left blank rather than reported as 0%, because no sessions and no engagement are different claims.')+
  '<div class="grid g2">'+
    panel('Adoption by account',
      CH.bars(rows.map(e=>({l:e.name.split(' ')[0],v:e.adoption})),
        {fmt:n=>Math.round(n)+'%',tip:n=>n+'%',max:100,aria:'Self-care adoption by account'})+
      '<div class="t-tiny muted" style="margin-top:7px">The hatched bar is the account with no session records — not a zero.</div>',
      {icon:'chart'})+
    panel('Ticket load against adoption',
      '<div class="stack" style="gap:12px">'+rows.slice(0,6).map(e=>
        '<div><div class="row" style="margin-bottom:5px"><span class="t-small grow">'+esc(e.name)+'</span>'+
        '<span class="t-tiny muted t-num">'+(e.ticketsPerK!=null?e.ticketsPerK+' tickets / 1k lines':'—')+'</span></div>'+
        (e.adoption==null?meter(null,null,{naLabel:'Not measured'}):meter(e.adoption,FMT.pct(e.adoption)+' adoption'))+'</div>').join('')+
      '</div><div class="divider"></div>'+
      '<div class="t-tiny muted">Accounts below 40% adoption generate roughly three times the ticket load per thousand lines.</div>',
      {icon:'gauge'})+
  '</div>'+
  panel('Engagement detail', dt('dtAdoption',{
    rows:rows, noun:'accounts', pageSize:10, toolbar:false, sortKey:'adoption', sortDir:'desc', onRow:"enterContext('$ID')",
    columns:[
      {key:'name',label:'Account',render:r=>'<div class="cellmain">'+esc(r.name)+'</div><div class="cellsub t-num">'+esc(r.id)+'</div>'},
      {key:'users',label:'Users',align:'right',render:r=>'<span class="t-num">'+FMT.num(r.users)+'</span>'},
      {key:'adoption',label:'Adoption',align:'right',width:'160px',
        render:r=>r.adoption==null?meter(null,null,{naLabel:'Not measured'}):meter(r.adoption)},
      {key:'selfServed',label:'Self-served actions',align:'right',
        render:r=>r.selfServed==null?NOTMEASURED():'<span class="t-num">'+r.selfServed+'%</span>'},
      {key:'openTickets',label:'Open tickets',align:'right',render:r=>'<span class="t-num">'+r.openTickets+'</span>'},
      {key:'lastLogin',label:'Last sign-in',render:r=>esc(r.lastLogin)},
      {key:'csm',label:'Account manager',render:r=>'<span class="t-small">'+esc(r.csm)+'</span>'},
      {key:'health',label:'Health',render:r=>healthPill(r.health)}
    ]}),{flush:true,icon:'users'})+
  '</div>';
}

/* ----------------------- 9. Operator access transparency ----------------- */
function vOpsAudit(){
  const rows=[
    {id:'OA-4401', when:'Now', who:AGENT.name, acct:'Meridian Logistics Group', what:'Entered support context', why:'Responding to an open ticket', ref:'TCK-59120', visible:true},
    {id:'OA-4400', when:'Yesterday 16:04', who:'Tomas Novak', acct:'Meridian Logistics Group', what:'Viewed invoice INV-2026-4177', why:'Billing query raised by the customer', ref:'INT-40218', visible:true},
    {id:'OA-4399', when:'Yesterday 11:22', who:AGENT.name, acct:'Karstadt Retail Group', what:'Reissued a one-time code', why:'Inbound call from the customer', ref:'INT-40201', visible:true},
    {id:'OA-4398', when:'2 d ago 09:15', who:'Ruben Oyelaran', acct:'Volta Mobility BV', what:'Viewed user list', why:'Proactive check on a service incident', ref:'INC-88190', visible:true},
    {id:'OA-4397', when:'3 d ago 14:47', who:AGENT.name, acct:'Aviro Health Partners', what:'Raised a ticket on behalf', why:'Inbound call from the customer', ref:'TCK-59088', visible:true},
    {id:'OA-4396', when:'4 d ago 10:02', who:'Lena Fischer', acct:'Orion Facility Care', what:'Cleared a sign-in lock', why:'Responding to an open ticket', ref:'TCK-59041', visible:true}
  ];
  return pagehead('Operator access log',
    'Every time operator staff enter a customer\'s self-care view, it is recorded here and in the customer\'s own audit log.',
    exportBtn('Access log'))+
  '<div class="stack">'+
  banner('info','Access transparency is symmetric by design. There is no operator action on this surface that the customer cannot see in their own audit log. '+
    'That is what makes it safe to give support staff a live view.')+
  '<div class="grid g4">'+
    metric({icon:'eye',label:'Contexts entered, 7 days',value:'34',foot:'Across '+ENTERPRISES.length+' accounts'})+
    metric({icon:'lock',label:'Without a stated reason',value:'0',foot:'A reason is required by the system'})+
    metric({icon:'shield',label:'Actions taken',value:'11',foot:'All within the support-action allowlist'})+
    metric({icon:'ban',label:'Blocked attempts',value:'2',foot:'Payment and plan change — not permitted here'})+
  '</div>'+
  panel(null, dt('dtOpsAudit',{
    rows:rows, noun:'entries', pageSize:12, sortKey:'when',
    searchFields:['who','acct','what','why','ref'], searchPlaceholder:'Search actor, account or reference',
    columns:[
      {key:'when',label:'When',width:'150px',render:r=>'<span class="cellmain">'+esc(r.when)+'</span>'},
      {key:'who',label:'Operator staff',render:r=>'<div class="cellmain">'+esc(r.who)+'</div><div class="cellsub">Enterprise care desk</div>'},
      {key:'acct',label:'Account',render:r=>esc(r.acct)},
      {key:'what',label:'Action',render:r=>esc(r.what)},
      {key:'why',label:'Stated reason',render:r=>'<span class="t-small">'+esc(r.why)+'</span>'},
      {key:'ref',label:'Reference',render:r=>'<span class="t-num t-small">'+esc(r.ref)+'</span>'},
      {key:'visible',label:'Customer sees it',render:r=>pill('success','Yes')}
    ]}),{flush:true,icon:'history'})+
  panel('What this login cannot do',
    '<div class="grid g2"><div class="stack" style="gap:9px">'+
      [['Pay an invoice or issue a credit','Enterprise CRM'],['Change a plan or buy an add-on','Customer or CRM'],
       ['Invite, suspend or delete a user','Enterprise admin'],['Allocate a shared data pool','Enterprise admin']]
      .map(r=>'<div class="row"><span class="t-small grow">'+esc(r[0])+'</span>'+pill('neutral',r[1])+'</div>').join('')+
    '</div><div class="stack" style="gap:9px">'+
      [['Negotiate pricing or terms','Enterprise CRM'],['Approve a team request','Team leader or admin'],
       ['See message or call content','Nobody — never collected'],['Export the customer\'s user list','Enterprise admin']]
      .map(r=>'<div class="row"><span class="t-small grow">'+esc(r[0])+'</span>'+pill('neutral',r[1])+'</div>').join('')+
    '</div></div>'+
    '<div class="divider"></div>'+
    '<div class="t-tiny muted">Attempting one of these produces a clear hand-off rather than a permissions error, so it is obvious where the capability actually lives.</div>',
    {icon:'lock'})+
  '</div>';
}

/* ------------------------------- registration ---------------------------- */
const VIEWS={
  portfolio:vPortfolio, account:vAccount, users:vOpsUsers, services:vOpsServices,
  usage:vOpsUsage, billing:vOpsBilling, tickets:vOpsTickets, adoption:vAdoption, access:vOpsAudit
};

App.init({
  product:'Enterprise Self-Care', tier:'6D ONE UI · Operator view',
  env:'Production · EU-West · support context',
  persona:{name:AGENT.name, role:AGENT.role, org:OPERATOR.name},
  searchScope:'the self-care portfolio', alertCount:3,
  notifications:[
    {when:'12 min ago', text:'Meridian Logistics — Duisburg DC down, INC-88214 opened at Tier 2', source:'Service incidents', kind:'danger', read:false},
    {when:'40 min ago', text:'Karstadt Retail — 3 new tickets, all eSIM activation', source:'Support queue', kind:'danger', read:false},
    {when:'2 h ago', text:'Volta Mobility has not signed in for 11 days — adoption 19%', source:'Adoption monitoring', kind:'warning', read:false},
    {when:'Yesterday', text:'Baltic Marine Services produced no self-care session records this period', source:'Adoption monitoring', kind:'info', read:true}
  ],
  footNote:'Self-care scope only',
  aiName:'AARYA assistant',
  aiGreeting:'I can answer questions about the self-care surface of the accounts in your queue — service state, usage, invoices, tickets and adoption. '+
    'I have no access to contracts, pricing or the commercial pipeline; those live in the Enterprise CRM.'+
    '<div class="src">Sources: self-care telemetry, ticket queue, invoice records, service inventory.</div>',
  aiSuggestions:['Which accounts need attention?','Why is Karstadt generating so many tickets?','What is wrong at Meridian right now?','Which accounts have no adoption data?'],
  nav:[
    {label:'Portfolio', items:[
      {id:'portfolio', label:'Accounts', icon:'building', count:ENTERPRISES.length},
      {id:'adoption', label:'Adoption', icon:'gauge'}]},
    {label:'Account in context', items:[
      {id:'account', label:'Self-care overview', icon:'dashboard'},
      {id:'users', label:'Users and state', icon:'users'},
      {id:'services', label:'Service state', icon:'network'},
      {id:'usage', label:'Usage oversight', icon:'activity'},
      {id:'billing', label:'Billing oversight', icon:'invoice'}]},
    {label:'Care desk', items:[
      {id:'tickets', label:'Support queue', icon:'support', count:KPI.openTickets},
      {id:'access', label:'Operator access log', icon:'history'}]}
  ],
  searchIndex:[
    {k:'Screen',t:'Portfolio of enterprise accounts',v:'portfolio'},{k:'Screen',t:'Self-care adoption',v:'adoption'},
    {k:'Screen',t:'Account self-care overview',v:'account'},{k:'Screen',t:'Users and account state',v:'users'},
    {k:'Screen',t:'Service state and incidents',v:'services'},{k:'Screen',t:'Usage oversight',v:'usage'},
    {k:'Screen',t:'Billing oversight',v:'billing'},{k:'Screen',t:'Support queue',v:'tickets'},
    {k:'Screen',t:'Operator access log',v:'access'},
    {k:'Account',t:'Meridian Logistics Group — needs attention',v:'portfolio'},
    {k:'Account',t:'Volta Mobility BV — at risk, 19% adoption',v:'portfolio'},
    {k:'Incident',t:'INC-88214 — Duisburg DC down',v:'services'}
  ],
  aiAnswer(q){
    if(/attention|risk|worst|problem account|need/.test(q))
      return 'Three accounts in your queue need attention, for different reasons:'+
        '<table><tr><th>Account</th><th>Why</th></tr>'+
        '<tr><td>Volta Mobility BV</td><td>19% adoption, no sign-in for 11 days, '+CUR(18740.55)+' outstanding</td></tr>'+
        '<tr><td>Karstadt Retail Group</td><td>14 open tickets, 9 of them the same eSIM problem</td></tr>'+
        '<tr><td>Meridian Logistics Group</td><td>Site down, pool near exhaustion, 1 overdue invoice</td></tr></table>'+
        'Meridian is the most urgent operationally; Volta is the one most likely to churn on service experience.'+
        '<div class="src">Sources: self-care telemetry, ticket queue, invoice status, sign-in records.</div>';
    if(/karstadt|cluster|many ticket|esim/.test(q))
      return '<strong>Karstadt Retail Group</strong> has 14 open tickets. Nine describe the same failure at the eSIM profile-issuance step — the customer scans the QR code and the profile never installs.'+
        '<br><br>Working them as one Tier 2 investigation rather than fourteen individual tickets is the faster path, and it gives the customer one answer instead of fourteen partial ones.'+
        '<div class="src">Sources: ticket queue, subject clustering, eSIM issuance logs.</div>';
    if(/meridian|wrong|now|down|incident/.test(q))
      return 'Three things are live on <strong>Meridian Logistics Group</strong> right now:'+
        '<table><tr><th>Issue</th><th>State</th></tr>'+
        '<tr><td>Duisburg DC (SDW-105) down</td><td>INC-88214, Tier 2, 12 min</td></tr>'+
        '<tr><td>Field operations pool at '+FMT.pct(POOLS[0].pct)+'</td><td>Customer action needed</td></tr>'+
        '<tr><td>Invoice '+INVOICES[1].id+' overdue</td><td>4 days, '+CUR(INVOICES[1].amount)+'</td></tr></table>'+
        'The customer has already been alerted about all three, so the useful thing to lead with is what you are doing about the outage.'+
        '<div class="src">Sources: incident feed, pool records, invoice status, customer alert log.</div>';
    if(/adoption|not measured|no data|session/.test(q))
      return '<strong>Baltic Marine Services</strong> has produced no self-care session records this period, so its adoption figure is <em>not measured</em>.'+
        '<br><br>I have deliberately not reported that as 0%. No sessions recorded and no engagement are different claims, and only one of them is supported by the data. '+
        'The likely explanations are a session-ingest gap or genuine non-use, and the evidence here does not separate them.'+
        '<div class="src">Sources: self-care session records, ingest health log.</div>';
    if(/contract|pricing|discount|renewal|commercial|opportunit/.test(q))
      return 'I cannot answer that from this login. Contracts, pricing, discounts, renewals and the sales pipeline live in the <strong>Enterprise Billing/CRM</strong>, which is a separate system from self-care.'+
        '<br><br>What I can tell you is everything on the self-care surface: service state, usage, invoices as the customer sees them, tickets, and account and user state.'+
        '<div class="src">Scope boundary: operator self-care login.</div>';
    return null;
  }
});
