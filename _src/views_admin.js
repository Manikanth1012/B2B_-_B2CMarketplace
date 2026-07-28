/* ===========================================================================
   PERSONA: Enterprise Admin  (19 agreed features)
   =========================================================================== */

const ROLES=[
  {id:'R-ADM', name:'Enterprise admin', users:USERS.filter(u=>u.role==='Enterprise admin').length,
   scope:'Whole account', perms:['users.manage','roles.assign','services.manage','sim.manage','billing.pay','pools.allocate','orders.raise','tickets.escalate','settings.manage'], system:true},
  {id:'R-LEAD',name:'Team leader', users:USERS.filter(u=>u.role==='Team leader').length,
   scope:'Own team only', perms:['team.view','usage.view.team','addons.approve<=50','tickets.raise','reports.team'], system:true},
  {id:'R-USER',name:'Standard user', users:USERS.filter(u=>u.role==='User').length,
   scope:'Own line only', perms:['self.view','addons.request','tickets.raise','sim.request-swap'], system:true},
  {id:'R-FIN', name:'Finance viewer', users:2, scope:'Billing only',
   perms:['invoices.view','invoices.download','payments.manage','chargeback.view'], system:false},
  {id:'R-NET', name:'Network operator (read)', users:3, scope:'Connectivity only',
   perms:['sites.view','circuits.view','tickets.raise'], system:false}
];

const PERM_MATRIX=[
  ['Invite and deactivate users',      1,0,0,0,0],
  ['Assign roles and delegate access', 1,0,0,0,0],
  ['Create and edit teams',            1,0,0,0,0],
  ['Suspend or resume a mobile line',  1,2,0,0,0],
  ['Order or swap a SIM / eSIM',       1,2,2,0,0],
  ['Change plans and buy add-ons',     1,2,2,0,0],
  ['Allocate shared data pools',       1,0,0,0,0],
  ['View account-wide usage',          1,2,0,1,0],
  ['View and download invoices',       1,0,0,1,0],
  ['Pay invoices and manage methods',  1,0,0,1,0],
  ['Manage SD-WAN and MPLS services',  1,0,0,0,2],
  ['Raise and escalate tickets',       1,1,1,0,1],
  ['Change account settings',          1,0,0,0,0]
];

/* Lines that used under 40% of their allowance — the right-sizing candidate set.
   Every figure quoted in the insight below is derived from this, not asserted. */
const UNDER = USERS.filter(u=>u.status==='active'&&u.dataAllowGb&&u.dataUsedGb!=null&&u.dataUsedGb/u.dataAllowGb<0.4);
const RIGHTSIZE_SAVING = +(UNDER.length*7.6).toFixed(2);

const ADMIN_INSIGHTS=[
  {icon:'trendup', conf:'High confidence',
   title:'Field operations pool will exhaust 9 days before cycle end',
   body:'Consumption is running at <strong>'+FMT.dec(POOLS[0].usedGb/22,1)+' GB/day</strong> against '+POOLS[0].allowGb+' GB. At this rate the pool is empty around <strong>22 Jul</strong>. Two 256 GB top-ups would cover the gap at '+CUR(2*38)+', against an estimated '+CUR(214)+' in out-of-bundle charges if left alone.',
   acts:'<button class="btn btn-sm btn-primary" onclick="App.go(\'pools\')">Review pool</button>'+
        '<button class="btn btn-sm" onclick="toast(\'Two 256 GB top-ups queued for your approval\')">Queue 2 top-ups</button>'},
  {icon:'wallet', conf:'High confidence',
   title:UNDER.length+' lines are on a plan larger than they use',
   body:'Across three cycles, '+UNDER.length+' lines used under 40% of their allowance. Moving them to the next plan down saves an estimated <strong>'+CUR(RIGHTSIZE_SAVING)+' per month</strong> with no observed impact on their usage pattern.',
   acts:'<button class="btn btn-sm" onclick="App.go(\'plans\')">See the lines</button>'+
        '<button class="btn btn-sm" onclick="toast(\'Right-sizing plan drafted — 31 lines, awaiting your approval\')">Draft right-sizing</button>'},
  {icon:'warning', conf:'Medium confidence',
   title:SITE_DOWN[0].name+' has failed twice in 30 days',
   body:SITE_DOWN[0].id+' is currently down and previously flapped on 04 Jul. Both events correlate with the primary carrier tail. A second link at this site would remove the single point of failure for 3 depots that route through it.',
   acts:'<button class="btn btn-sm" onclick="App.go(\'network\')">Open site</button>'+
        '<button class="btn btn-sm" onclick="toast(\'Diversity quote requested from Kestrel Telecom\')">Request diversity quote</button>'},
  {icon:'eyeoff', conf:'Low confidence — partial evidence',
   title:'Roaming spend cannot be attributed for 2 sites',
   body:'Porto and Ghent have not reported usage telemetry since 18 Jul, so their share of '+CUR(1840)+' in roaming charges is <strong>not measured</strong>. This is shown as unattributed in chargeback rather than distributed by estimate.',
   acts:'<button class="btn btn-sm" onclick="App.go(\'chargeback\')">Open chargeback</button>'}
];

/* ------------------------------- 1. Dashboard ---------------------------- */
function vDashboard(){
  const alerts=[
    {kind:'danger', ico:'warning', t:SITE_DOWN[0].name+' ('+SITE_DOWN[0].id+') is down', s:'Operator incident INC-88214 · 12 min ago', a:'network'},
    {kind:'danger', ico:'database', t:'Field operations pool at '+FMT.pct(POOLS[0].pct), s:'Auto-top-up policy is armed at 90%', a:'pools'},
    {kind:'warning',ico:'invoice', t:'Invoice '+INVOICES[1].id+' is overdue', s:CUR(INVOICES[1].amount)+' · 4 days past due', a:'invoices'},
    {kind:'warning',ico:'checklist',t:KPI.pendingApprovals+' requests await a decision', s:'2 within team-leader limits, 1 needs you', a:'orders'}
  ];
  return pagehead('Account overview',
    esc(ENT.name)+' · '+esc(ENT.id)+' · '+esc(ENT.segment)+' — real-time view across '+KPI.lines+' lines and '+KPI.sites+' connectivity sites',
    '<div class="seg" role="group" aria-label="Reporting period">'+
      '<button aria-pressed="false" onclick="toast(\'Period set to last 7 days\')">7 d</button>'+
      '<button aria-pressed="true">This cycle</button>'+
      '<button aria-pressed="false" onclick="toast(\'Period set to last 12 months\')">12 mo</button></div>'+
    exportBtn('Account overview'))+

  '<div class="stack">'+

  banner('danger','<strong>'+SITE_DOWN.length+' site is down and '+SITE_DEG.length+' are degraded.</strong> '+esc(SITE_DOWN[0].name)+' has been unreachable for 12 minutes; the operator has raised INC-88214. Depot traffic is failing over to Cologne with an added 18 ms. '+
    '<button class="linkbtn" onclick="App.go(\'network\')">Open connectivity</button>')+

  '<div class="grid g4">'+
    metric({icon:'users', label:'Active users', value:FMT.num(KPI.activeUsers),
      foot:delta(4)+' vs last cycle · '+KPI.invited+' invited, '+KPI.suspended+' suspended'})+
    metric({icon:'database', label:'Pooled data consumed', value:FMT.pct(KPI.poolPct),
      foot:FMT.gb(KPI.dataUsedGb)+' of '+FMT.gb(KPI.dataAllowGb)+' · day 22 of 31'})+
    metric({icon:'wallet', label:'Recurring monthly charge', value:CUR0(KPI.mrc),
      foot:delta(2.4)+' vs last cycle · '+KPI.lines+' billable lines'})+
    metric({icon:'gauge', label:'Service availability (30 d)', value:null, naLabel:'Partial — '+(KPI.sites-SITE_REPORTING.length)+' sites unreported',
      foot:pill('partial',SITE_REPORTING.length+' of '+KPI.sites+' sites reporting')})+
  '</div>'+

  '<div class="grid g-2-1">'+
    panel('Data consumption against pooled allowance',
      CH.line([{pts:USAGE_DATA},{pts:MONTHS.map(m=>({l:m,v:KPI.dataAllowGb/1}))}],
        {fmt:n=>Math.round(n/1000)+' TB', tip:n=>FMT.gb(n), aria:'Monthly pooled data consumption against allowance'})+
      '<div class="legend"><span><i style="background:#0099FF"></i>Consumed</span>'+
      '<span><span class="dash"></span>Pooled allowance</span>'+
      '<span><i style="background:#E4E4E4"></i>Aug 2025 — no record retained</span></div>',
      {icon:'activity', sub:'12 rolling cycles · GB'})+

    panel('Service health',
      '<div class="stack" style="gap:9px">'+
      [['Mobile',KPI.lines+' lines','online'],['SD-WAN',SITES.filter(s=>s.type==='SD-WAN').length+' sites',SITE_DOWN.length?'down':'online'],
       ['MPLS',SITES.filter(s=>s.type==='MPLS').length+' circuits','degraded'],['Fixed voice','Not contracted','unavailable']]
      .map(r=>'<div class="row"><span class="grow t-small">'+esc(r[0])+'<span class="dim"> · '+esc(r[1])+'</span></span>'+
        (r[2]==='unavailable'?'<span class="nodata">Not contracted</span>':statusPill(r[2]))+'</div>').join('')+
      '</div><div class="divider"></div>'+
      '<div class="stack" style="gap:8px">'+
        '<div class="row"><span class="t-small grow">Sites online</span><span class="t-small strong t-num">'+KPI.sitesOnline+' / '+KPI.sites+'</span></div>'+
        meter(KPI.sitesOnline/KPI.sites*100)+
        '<div class="row"><span class="t-small grow">Open tickets</span><span class="t-small strong t-num">'+KPI.openTickets+'</span></div>'+
        '<div class="row"><span class="t-small grow">Mean time to resolve</span><span class="t-small strong t-num">'+FMT.mins(KPI.mttr)+'</span></div>'+
        '<div class="row"><span class="t-small grow">Resolved within SLA</span><span class="t-small strong t-num">'+FMT.pct(KPI.slaOk)+'</span></div>'+
      '</div>',
      {icon:'activity'})+
  '</div>'+

  panel('AI insights',
    ADMIN_INSIGHTS.map(aiInsight).join(''),
    {ai:true, flush:true, icon:'ai', sub:'Generated from this account\'s usage, billing and service records. Recommendations require your approval before anything changes.',
     acts:'<button class="btn btn-sm" onclick="toast(\'Insight feed refreshed\')">'+ICO('refresh',13)+'Refresh</button>'})+

  '<div class="grid g2">'+
    panel('Alerts requiring attention',
      '<div class="stack" style="gap:0">'+alerts.map(a=>
        '<div class="row" style="padding:9px 0;border-bottom:1px solid var(--nim-line-100)">'+
        '<span style="color:var(--nim-'+(a.kind==='danger'?'danger':'warning')+'-fg);flex:0 0 auto">'+ICO(a.ico,15)+'</span>'+
        '<div class="grow"><div class="t-small strong">'+esc(a.t)+'</div><div class="t-tiny muted">'+esc(a.s)+'</div></div>'+
        '<button class="btn btn-sm" onclick="App.go(\''+a.a+'\')">Open</button></div>').join('')+'</div>',
      {icon:'bell', acts:'<button class="btn btn-sm btn-quiet" onclick="App.go(\'alerts\')">Alert rules</button>'})+

    panel('Spend by cost centre — this cycle',
      CH.stack(TEAMS.map(t=>({label:t.name+' · '+t.cc, parts:[t.spend]})).sort((a,b)=>b.parts[0]-a.parts[0]),
        {names:['Recurring charge'], fmt:n=>CUR0(n)})+
      '<div class="divider"></div>'+
      '<div class="row"><span class="t-small muted grow">Unattributed — telemetry gap at 2 sites</span><span class="t-small">'+NOTMEASURED()+'</span></div>',
      {icon:'pie', acts:'<button class="btn btn-sm btn-quiet" onclick="App.go(\'chargeback\')">Chargeback</button>'})+
  '</div>'+
  '</div>';
}

/* --------------------------------- 2. Users ------------------------------ */
function vUsers(){
  return pagehead('Users',
    KPI.users+' people and devices on this account · '+KPI.activeUsers+' active, '+KPI.invited+' invited, '+KPI.suspended+' suspended, '+
    USERS.filter(u=>u.status==='deactivated').length+' deactivated',
    '<button class="btn" onclick="toast(\'Bulk import — upload a CSV of up to 500 users\')">'+ICO('download',13)+'Bulk import</button>'+
    '<button class="btn btn-primary" onclick="inviteUser()">'+ICO('userplus',14)+'Invite user</button>')+
  panel(null, dt('dtUsers',{
    rows:USERS, noun:'users', idKey:'id', pageSize:12, sortKey:'name',
    searchFields:['name','email','msisdn','teamName','planName','id'],
    searchPlaceholder:'Search name, email, number',
    onRow:"openUserDetail('$ID')",
    chips:[{key:'status',options:[
      {label:'Active',value:'active',count:KPI.activeUsers},
      {label:'Invited',value:'invited',count:KPI.invited},
      {label:'Suspended',value:'suspended',count:KPI.suspended},
      {label:'Deactivated',value:'deactivated',count:USERS.filter(u=>u.status==='deactivated').length}]},
      {key:'role',options:[{label:'Admins',value:'Enterprise admin'},{label:'Team leaders',value:'Team leader'}]}],
    actions:exportBtn('User list'),
    columns:[
      {key:'name',label:'User',render:r=>'<div class="row" style="gap:8px"><span class="avatar" aria-hidden="true">'+esc(FMT.initials(r.name))+'</span>'+
        '<div><div class="cellmain">'+esc(r.name)+'</div><div class="cellsub">'+esc(r.email)+'</div></div></div>'},
      {key:'teamName',label:'Team',render:r=>esc(r.teamName)+'<div class="cellsub">'+esc(r.cc)+'</div>'},
      {key:'role',label:'Role',render:r=>r.role==='Enterprise admin'?pill('info','Enterprise admin'):r.role==='Team leader'?pill('partial','Team leader'):'<span class="t-small muted">Standard user</span>'},
      {key:'msisdn',label:'Mobile number',render:r=>'<span class="t-num">'+esc(r.msisdn)+'</span><div class="cellsub">'+esc(r.simType)+'</div>'},
      {key:'planName',label:'Plan',render:r=>esc(r.planName)},
      {key:'dataUsedGb',label:'Data this cycle',align:'right',width:'170px',render:r=>r.status==='deactivated'?'<span class="nodata">Line closed</span>':tinyMeter(r.dataUsedGb,r.dataAllowGb)},
      {key:'status',label:'Status',render:r=>statusPill(r.status)},
      {key:'__acts',label:'',sort:false,render:r=>'<button class="btn btn-sm btn-quiet" onclick="event.stopPropagation();openUserDetail(\''+r.id+'\')">Manage</button>'}
    ]}),{flush:true});
}
function openUserDetail(id){
  const u=USERS.find(x=>x.id===id); if(!u) return;
  const t=TEAMS.find(x=>x.id===u.teamId);
  const uTickets=TICKETS.filter(x=>x.openedBy===u.name);
  openInspector(
    '<div class="insp-head"><span class="avatar" style="width:36px;height:36px;font-size:13px" aria-hidden="true">'+esc(FMT.initials(u.name))+'</span>'+
      '<div class="grow"><div class="row" style="gap:6px">'+statusPill(u.status)+(u.mfa?pill('success','MFA on'):pill('warning','MFA off'))+'</div>'+
      '<h3 class="t-sub" style="margin-top:5px">'+esc(u.name)+'</h3>'+
      '<div class="t-small muted">'+esc(u.email)+' · '+esc(u.id)+'</div></div>'+
      '<button class="iconbtn" onclick="closeInspector()" aria-label="Close">'+ICO('x',16)+'</button></div>'+
    '<div class="insp-body stack">'+
      (u.status==='invited'?banner('info','Invitation sent '+esc(u.joined)+'. The user has not completed OTP verification yet, so no line is active.'):'')+
      '<dl class="deflist">'+
        '<dt>Team</dt><dd>'+esc(u.teamName)+' ('+esc(u.cc)+')'+(t&&t.leadName?'<div class="t-tiny muted">Leader: '+esc(t.leadName)+'</div>':'')+'</dd>'+
        '<dt>Role</dt><dd>'+esc(u.role)+'</dd>'+
        '<dt>Mobile number</dt><dd class="t-num">'+esc(u.msisdn)+'</dd>'+
        '<dt>SIM</dt><dd>'+esc(u.simType)+'<div class="t-tiny muted t-num">ICCID '+esc(u.iccid)+'</div></dd>'+
        '<dt>Device</dt><dd>'+esc(u.device)+'</dd>'+
        '<dt>Plan</dt><dd>'+esc(u.planName)+' · '+CUR(u.planPrice)+'/mo</dd>'+
        '<dt>Joined</dt><dd>'+esc(u.joined)+'</dd>'+
        '<dt>Last active</dt><dd>'+esc(u.lastActive)+'</dd>'+
      '</dl>'+
      '<div class="divider"></div>'+
      '<h4 class="t-sub">Consumption this cycle</h4>'+
      '<div class="stack" style="gap:9px">'+
        '<div><div class="t-tiny muted">Data</div>'+tinyMeter(u.dataUsedGb,u.dataAllowGb)+'</div>'+
        '<div class="row"><span class="t-small grow">Voice minutes</span><span class="t-small t-num">'+(u.voiceMin!=null?FMT.num(u.voiceMin):NOTMEASURED())+'</span></div>'+
        '<div class="row"><span class="t-small grow">SMS</span><span class="t-small t-num">'+(u.smsCount!=null?FMT.num(u.smsCount):NOTMEASURED())+'</span></div>'+
        '<div class="row"><span class="t-small grow">Roaming data</span><span class="t-small t-num">'+(u.roamingGb?FMT.gb(u.roamingGb):'None recorded')+'</span></div>'+
      '</div>'+
      '<div class="divider"></div>'+
      '<h4 class="t-sub">Tickets raised</h4>'+
      (uTickets.length? '<div class="stack" style="gap:7px">'+uTickets.slice(0,4).map(x=>
        '<button class="row" style="width:100%;background:none;border:0;text-align:left;cursor:pointer;padding:0" onclick="openTicket(\''+x.id+'\')">'+
        sevPill(x.severity)+'<span class="t-small grow" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+esc(x.subject)+'</span>'+statusPill(x.status)+'</button>').join('')+'</div>'
        : '<p class="t-small muted">No tickets raised by this user.</p>')+
    '</div>'+
    '<div class="insp-foot">'+
      '<button class="btn btn-quiet" onclick="closeInspector()">Close</button><div class="spacer"></div>'+
      '<button class="btn btn-sm" onclick="toast(\'Password-less sign-in link sent to '+esc(u.email)+'\')">Send sign-in link</button>'+
      (u.status==='active'
        ? '<button class="btn btn-sm" onclick="suspendUser(\''+u.id+'\')">'+ICO('pause',13)+'Suspend line</button>'+
          '<button class="btn btn-sm btn-danger" onclick="deactivateUser(\''+u.id+'\')">Deactivate</button>'
        : u.status==='suspended'
        ? '<button class="btn btn-sm btn-primary" onclick="resumeUser(\''+u.id+'\')">'+ICO('play',13)+'Resume line</button>'
        : '<button class="btn btn-sm" onclick="toast(\'Invitation resent\')">Resend invite</button>')+
    '</div>','User '+u.name);
}
function suspendUser(id){
  const u=USERS.find(x=>x.id===id);
  confirmAction({title:'Suspend line for '+u.name, subtitle:u.msisdn+' · '+u.planName, risk:'normal', confirmLabel:'Suspend line',
    impact:['Voice, SMS and data stop immediately on <strong>'+esc(u.msisdn)+'</strong>.',
            'The number is held for 90 days and can be resumed by any enterprise admin.',
            'Recurring charges continue at '+CUR(u.planPrice)+'/mo unless you also downgrade the plan.',
            'The user is notified by email and their device shows no service.'],
    footNote:'Reversible. Resume restores service within 5 minutes.',
    onConfirm:()=>{u.status='suspended';u.dataUsedGb=u.dataUsedGb; closeInspector(); _dt.dtUsers&&_dt.dtUsers.redraw(); toast('Line suspended for '+u.name,'warn');}});
}
function resumeUser(id){
  const u=USERS.find(x=>x.id===id);
  u.status='active'; closeInspector(); _dt.dtUsers&&_dt.dtUsers.redraw(); toast('Line resumed for '+u.name);
}
function deactivateUser(id){
  const u=USERS.find(x=>x.id===id);
  confirmAction({title:'Deactivate '+u.name, subtitle:'This closes the account and releases the line', risk:'high',
    confirmLabel:'Deactivate user', requireType:'DEACTIVATE',
    impact:['The self-care account is closed and all sessions are ended.',
            'Line <strong>'+esc(u.msisdn)+'</strong> is scheduled for cease at the end of the current cycle.',
            'The number cannot be recovered after 30 days.',
            'Any add-ons on this line are cancelled; usage already incurred is still billed.',
            u.role!=='User' ? '<strong>This user holds the '+esc(u.role)+' role.</strong> Reassign it first or the team loses its approver.' : 'No delegated permissions are affected.'],
    footNote:'Irreversible after 30 days.',
    onConfirm:()=>{u.status='deactivated';u.dataUsedGb=null; closeInspector(); _dt.dtUsers&&_dt.dtUsers.redraw(); toast('User deactivated — line ceases at cycle end','warn');}});
}
function inviteUser(){
  openModal('<div class="modal-head">'+ICO('userplus',18)+'<div class="grow"><h3 class="t-sub">Invite user</h3>'+
    '<div class="t-small muted">The user receives a one-time code at this address or number and sets up their own access.</div></div>'+
    '<button class="iconbtn" onclick="closeModal()" aria-label="Close">'+ICO('x',16)+'</button></div>'+
    '<div class="modal-body stack">'+
      '<div class="wizrail"><div class="st now"><span class="n">1</span>Identity</div><div class="st"><span class="n">2</span>Team and role</div>'+
      '<div class="st"><span class="n">3</span>Service</div></div>'+
      '<div class="grid g2">'+
        '<div class="field"><label for="ivName">Full name</label><input class="inp" id="ivName" placeholder="e.g. Sanne Bakker" data-autofocus></div>'+
        '<div class="field"><label for="ivEmail">Work email</label><input class="inp" id="ivEmail" placeholder="name@6dtech.co.in" '+
          'oninput="document.getElementById(\'ivErr\').hidden = /^[^@\\s]+@meridianlog\\.com$/.test(this.value)||this.value===\'\'; this.setAttribute(\'aria-invalid\', !document.getElementById(\'ivErr\').hidden)">'+
          '<div class="err" id="ivErr" hidden>'+ICO('alert',12)+'Must be a verified meridianlog.com address. Other domains need a domain claim first.</div></div>'+
      '</div>'+
      '<div class="grid g2">'+
        '<div class="field"><label for="ivTeam">Team</label><select class="inp" id="ivTeam">'+TEAMS.map(t=>'<option>'+esc(t.name)+'</option>').join('')+'</select></div>'+
        '<div class="field"><label for="ivRole">Role</label><select class="inp" id="ivRole"><option selected>Standard user</option><option>Team leader</option><option>Enterprise admin</option><option>Finance viewer</option></select>'+
        '<div class="hint">Roles are defined under Roles and access.</div></div>'+
      '</div>'+
      '<div class="grid g2">'+
        '<div class="field"><label for="ivPlan">Plan</label><select class="inp" id="ivPlan">'+PLANS.map(p=>'<option>'+esc(p.name)+' — '+CUR(p.price)+'/mo</option>').join('')+'</select></div>'+
        '<div class="field"><label for="ivSim">SIM type</label><select class="inp" id="ivSim"><option selected>eSIM — activate by QR</option><option>Physical SIM — ship to depot</option></select></div>'+
      '</div>'+
      '<label class="checkline"><input type="checkbox" checked> Require multi-factor authentication at first sign-in</label>'+
      '<label class="checkline"><input type="checkbox"> Allow this user to buy add-ons up to '+CUR(25)+' per cycle without approval</label>'+
    '</div>'+
    '<div class="modal-foot"><span class="t-tiny muted grow">Adds '+CUR(19.90)+'/mo to '+esc(ENT.id)+' from activation.</span>'+
    '<button class="btn btn-quiet" onclick="closeModal()">Cancel</button>'+
    '<button class="btn btn-primary" onclick="closeModal();toast(\'Invitation sent — the user has 72 hours to verify\')">Send invitation</button></div>',
    {wide:true,label:'Invite user'});
}

/* --------------------------- 3. Roles and access ------------------------- */
function vRoles(){
  const lvl=v=>v===1?'<span class="pill pill-success" title="Full">'+SH('check')+'Full</span>'
              :v===2?'<span class="pill pill-partial" title="Scoped">'+SH('half')+'Scoped</span>'
              :'<span class="dim" title="Not permitted">—</span>';
  return pagehead('Roles and access',
    'Delegated permissions across '+KPI.users+' identities. Changes take effect at the next sign-in and are written to the audit log.',
    '<button class="btn" onclick="App.go(\'audit\')">'+ICO('history',13)+'Access history</button>'+
    '<button class="btn btn-primary" onclick="toast(\'Custom role builder opened\')">'+ICO('plus',14)+'Create role</button>')+
  '<div class="stack">'+
  banner('info','Two roles are delegated by design: <strong>team leaders</strong> approve add-ons up to '+CUR(50)+' for their own team, and <strong>finance viewers</strong> see billing without touching services. Everything else needs an enterprise admin.')+
  panel('Roles', dt('dtRoles',{
    rows:ROLES, noun:'roles', pageSize:10, toolbar:false, sortKey:'name',
    columns:[
      {key:'name',label:'Role',render:r=>'<div class="cellmain">'+esc(r.name)+'</div><div class="cellsub">'+esc(r.id)+(r.system?' · built-in':' · custom')+'</div>'},
      {key:'scope',label:'Data scope',render:r=>esc(r.scope)},
      {key:'users',label:'Assigned',align:'right',render:r=>'<span class="t-num">'+r.users+'</span>'},
      {key:'perms',label:'Permissions',sort:false,render:r=>'<div class="tagset">'+r.perms.slice(0,4).map(p=>'<span class="tag">'+esc(p)+'</span>').join('')+
        (r.perms.length>4?'<span class="tag">+'+(r.perms.length-4)+'</span>':'')+'</div>'},
      {key:'__acts',label:'',sort:false,render:r=>r.system
        ? '<button class="btn btn-sm btn-quiet" onclick="toast(\'Built-in roles can be cloned, not edited\')">Clone</button>'
        : '<button class="btn btn-sm">Edit</button>'}
    ]}),{flush:true,icon:'shield'})+
  panel('Permission matrix',
    '<div class="tablewrap"><table class="tbl"><thead><tr><th style="min-width:260px">Capability</th>'+
    ROLES.map(r=>'<th style="text-align:center">'+esc(r.name)+'</th>').join('')+'</tr></thead><tbody>'+
    PERM_MATRIX.map(row=>'<tr><td class="cellmain">'+esc(row[0])+'</td>'+
      row.slice(1).map(v=>'<td style="text-align:center">'+lvl(v)+'</td>').join('')+'</tr>').join('')+
    '</tbody></table></div>',
    {flush:true,icon:'key',sub:'Scoped means the role may act only within its own team or service domain.'})+
  panel('Delegation policy',
    '<div class="grid g2">'+
      '<div class="stack" style="gap:11px">'+
        '<label class="toggle"><input type="checkbox" checked><span class="track"></span>Team leaders may approve add-ons within a spend limit</label>'+
        '<div class="row" style="gap:9px;padding-left:40px"><span class="t-small muted">Limit per request</span>'+
          '<div class="stepper"><button type="button" onclick="var i=this.nextElementSibling;i.value=Math.max(0,+i.value-5)">'+SH('minus',11)+'</button>'+
          '<input value="50" aria-label="Approval limit in euro"><button type="button" onclick="var i=this.previousElementSibling;i.value=+i.value+5">+</button></div>'+
          '<span class="t-small muted">'+esc(ENT.currency)+' per cycle</span></div>'+
        '<label class="toggle"><input type="checkbox" checked><span class="track"></span>Standard users may request, but never self-approve</label>'+
        '<label class="toggle"><input type="checkbox"><span class="track"></span>Allow team leaders to suspend lines in their own team</label>'+
        '<label class="toggle"><input type="checkbox" checked><span class="track"></span>Require MFA for every role with billing access</label>'+
      '</div>'+
      '<div class="stack" style="gap:11px">'+
        '<div class="field"><label for="ssoMode">Sign-in method</label><select class="inp" id="ssoMode">'+
          '<option selected>OTP to email or mobile (passwordless)</option><option>SAML SSO — Meridian Entra ID</option><option>OTP with SSO fallback</option></select>'+
          '<div class="hint">Both registration and login converge on the same OTP service.</div></div>'+
        '<div class="field"><label for="sessTo">Idle session timeout</label><select class="inp" id="sessTo">'+
          '<option>15 minutes</option><option selected>30 minutes</option><option>60 minutes</option></select></div>'+
        '<div class="field"><label for="otpWin">OTP validity window</label><select class="inp" id="otpWin">'+
          '<option selected>1 minute</option><option>2 minutes</option><option>5 minutes</option></select>'+
          '<div class="hint">Resend cooldown 30 s · max 3 resends · max 5 incorrect entries.</div></div>'+
      '</div>'+
    '</div>'+
    '<div class="divider"></div><div class="row"><span class="t-tiny muted grow">Policy changes are logged and take effect at the next sign-in.</span>'+
    '<button class="btn btn-primary" onclick="toast(\'Delegation policy saved\')">Save policy</button></div>',
    {icon:'settings'})+
  '</div>';
}

/* ------------------------------- 4. Teams -------------------------------- */
function vTeams(){
  return pagehead('Teams',
    TEAMS.length+' teams mapped to cost centres. Team leaders inherit visibility and approval rights over their own members only.',
    '<button class="btn btn-primary" onclick="toast(\'Team builder opened\')">'+ICO('plus',14)+'Create team</button>')+
  '<div class="grid g-1-2">'+
    panel('Structure',
      '<ul class="tree"><li><div class="tnode" aria-selected="true">'+ICO('building',14)+'<span>'+esc(ENT.name)+'</span><span class="tcount">'+KPI.users+'</span></div>'+
      '<ul>'+TEAMS.map(t=>'<li><div class="tnode" onclick="openTeam(\''+t.id+'\')">'+ICO('group',14)+'<span>'+esc(t.name)+'</span><span class="tcount">'+t.members+'</span></div></li>').join('')+
      '</ul></li></ul>',{icon:'folder',sub:'Click a team to inspect'})+
    panel('Teams', dt('dtTeams',{
      rows:TEAMS, noun:'teams', pageSize:10, toolbar:false, sortKey:'name', onRow:"openTeam('$ID')",
      columns:[
        {key:'name',label:'Team',render:r=>'<div class="cellmain">'+esc(r.name)+'</div><div class="cellsub">'+esc(r.cc)+' · '+esc(r.region)+'</div>'},
        {key:'leadName',label:'Team leader',render:r=>r.leadName?esc(r.leadName):'<span class="nodata">Not assigned</span>'},
        {key:'members',label:'Members',align:'right',render:r=>'<span class="t-num">'+r.members+'</span><div class="cellsub">'+r.active+' active</div>'},
        {key:'dataUsedGb',label:'Data this cycle',align:'right',render:r=>'<span class="t-num">'+FMT.gb(r.dataUsedGb)+'</span>'},
        {key:'spend',label:'Recurring',align:'right',render:r=>'<span class="t-num">'+CUR(r.spend)+'</span>'},
        {key:'__acts',label:'',sort:false,render:r=>'<button class="btn btn-sm btn-quiet" onclick="event.stopPropagation();openTeam(\''+r.id+'\')">Open</button>'}
      ]}),{flush:true,icon:'group'})+
  '</div>';
}
function openTeam(id){
  const t=TEAMS.find(x=>x.id===id); if(!t) return;
  const members=USERS.filter(u=>u.teamId===id);
  const pool=POOLS.find(p=>p.teams.includes(id));
  openInspector(
    '<div class="insp-head">'+ICO('group',18)+'<div class="grow"><h3 class="t-sub">'+esc(t.name)+'</h3>'+
      '<div class="t-small muted">'+esc(t.cc)+' · '+esc(t.region)+' · '+t.members+' members</div></div>'+
      '<button class="iconbtn" onclick="closeInspector()" aria-label="Close">'+ICO('x',16)+'</button></div>'+
    '<div class="insp-body stack">'+
      (t.leadName?'':banner('warning','<strong>No team leader assigned.</strong> Requests from this team escalate straight to an enterprise admin.'))+
      '<dl class="deflist">'+
        '<dt>Team leader</dt><dd>'+(t.leadName?esc(t.leadName):'<span class="nodata">Not assigned</span>')+'</dd>'+
        '<dt>Cost centre</dt><dd>'+esc(t.cc)+'</dd>'+
        '<dt>Recurring charge</dt><dd>'+CUR(t.spend)+' / month</dd>'+
        '<dt>Data this cycle</dt><dd>'+FMT.gb(t.dataUsedGb)+'</dd>'+
        '<dt>Shared pool</dt><dd>'+(pool?esc(pool.name)+' ('+FMT.pct(pool.pct)+' used)':'<span class="nodata">Not pooled</span>')+'</dd>'+
      '</dl>'+
      '<div class="divider"></div><h4 class="t-sub">Members</h4>'+
      '<table class="tbl"><tbody>'+members.slice(0,10).map(u=>
        '<tr><td><div class="cellmain">'+esc(u.name)+'</div><div class="cellsub">'+esc(u.planName)+'</div></td>'+
        '<td class="num" style="width:120px">'+(u.dataUsedGb!=null?FMT.gb(u.dataUsedGb):NOTMEASURED())+'</td>'+
        '<td style="width:96px">'+statusPill(u.status)+'</td></tr>').join('')+'</tbody></table>'+
      (members.length>10?'<div class="t-tiny muted">Showing 10 of '+members.length+'.</div>':'')+
    '</div>'+
    '<div class="insp-foot"><button class="btn btn-quiet" onclick="closeInspector()">Close</button><div class="spacer"></div>'+
      '<button class="btn btn-sm" onclick="toast(\'Member picker opened\')">Add members</button>'+
      '<button class="btn btn-sm btn-primary" onclick="toast(\'Team leader assignment saved\')">Assign leader</button></div>','Team '+t.name);
}

/* ---------------------- 5. Mobile lines & services ----------------------- */
function vLines(){
  const lines=USERS.filter(u=>u.status!=='deactivated');
  return pagehead('Mobile lines',
    lines.length+' billable lines · '+KPI.esim+' on eSIM · bulk actions apply to every selected line at once',
    '<button class="btn" onclick="bulkLineAction()">'+ICO('checklist',13)+'Bulk action</button>'+
    '<button class="btn btn-primary" onclick="App.go(\'orders\')">'+ICO('plus',14)+'Order line</button>')+
  panel(null, dt('dtLines',{
    rows:lines, noun:'lines', pageSize:12, sortKey:'msisdn', idKey:'id', onRow:"openUserDetail('$ID')",
    searchFields:['name','msisdn','iccid','planName','teamName'], searchPlaceholder:'Search number, ICCID, user',
    chips:[{key:'status',options:[{label:'Active',value:'active'},{label:'Suspended',value:'suspended'},{label:'Invited',value:'invited'}]},
           {key:'simType',options:[{label:'eSIM',value:'eSIM'},{label:'Physical SIM',value:'Physical SIM'},{label:'M2M',value:'M2M SIM'}]}],
    actions:exportBtn('Line inventory'),
    columns:[
      {key:'msisdn',label:'Number',render:r=>'<div class="cellmain t-num">'+esc(r.msisdn)+'</div><div class="cellsub">'+esc(r.simType)+'</div>'},
      {key:'name',label:'Assigned to',render:r=>esc(r.name)+'<div class="cellsub">'+esc(r.teamName)+'</div>'},
      {key:'planName',label:'Plan',render:r=>esc(r.planName)+'<div class="cellsub">'+CUR(r.planPrice)+'/mo</div>'},
      {key:'dataUsedGb',label:'Data',align:'right',width:'160px',render:r=>tinyMeter(r.dataUsedGb,r.dataAllowGb)},
      {key:'roamingGb',label:'Roaming',align:'right',render:r=>r.roamingGb?'<span class="t-num">'+FMT.gb(r.roamingGb)+'</span>':'<span class="dim">—</span>'},
      {key:'device',label:'Device',render:r=>'<span class="t-small">'+esc(r.device)+'</span>'},
      {key:'status',label:'Status',render:r=>statusPill(r.status)},
      {key:'__acts',label:'',sort:false,render:r=>r.status==='active'
        ? '<button class="btn btn-sm btn-quiet" onclick="event.stopPropagation();suspendUser(\''+r.id+'\')">Suspend</button>'
        : r.status==='suspended' ? '<button class="btn btn-sm btn-quiet" onclick="event.stopPropagation();resumeUser(\''+r.id+'\')">Resume</button>' : ''}
    ]}),{flush:true});
}
function bulkLineAction(){
  openModal('<div class="modal-head">'+ICO('checklist',18)+'<div class="grow"><h3 class="t-sub">Bulk line action</h3>'+
    '<div class="t-small muted">Select a target set, then an action. Nothing is applied until you confirm the impact summary.</div></div>'+
    '<button class="iconbtn" onclick="closeModal()" aria-label="Close">'+ICO('x',16)+'</button></div>'+
    '<div class="modal-body stack">'+
      '<div class="field"><label for="blSet">Target set</label><select class="inp" id="blSet" data-autofocus>'+
        '<option>Team — Warehouse — Antwerp ('+TEAMS[4].members+' lines)</option>'+
        '<option>Plan — Business Mobile 60</option><option>Lines with no usage for 60 days</option>'+
        '<option>Upload a list of numbers</option></select></div>'+
      '<div class="field"><label for="blAct">Action</label><select class="inp" id="blAct">'+
        '<option>Suspend</option><option>Resume</option><option>Change plan</option><option>Apply add-on</option><option>Move to another cost centre</option></select></div>'+
      '<div class="impact"><strong>Estimated impact</strong><ul>'+
        '<li>'+TEAMS[4].members+' lines affected across 1 cost centre ('+esc(TEAMS[4].cc)+').</li>'+
        '<li>Recurring charge changes by '+CUR(-TEAMS[4].spend)+' from the next cycle.</li>'+
        '<li>Affected users are notified by email and in-app.</li></ul></div>'+
    '</div>'+
    '<div class="modal-foot"><span class="t-tiny muted grow">A dry run lists every line without changing anything.</span>'+
    '<button class="btn btn-quiet" onclick="closeModal()">Cancel</button>'+
    '<button class="btn" onclick="toast(\'Dry run complete — 41 lines would change\')">Dry run</button>'+
    '<button class="btn btn-primary" onclick="closeModal();toast(\'Bulk action queued — you will be notified when it completes\')">Apply</button></div>',
    {wide:true,label:'Bulk line action'});
}

/* ---------------------------- 6. SIM and eSIM ---------------------------- */
function vSims(){
  const stock=[
    {id:'ST-ESIM', kind:'eSIM profiles', avail:340, allocated:KPI.esim, low:false, note:'Downloaded on demand from the operator SM-DP+'},
    {id:'ST-SIM3', kind:'Physical SIM — triple cut', avail:62, allocated:USERS.filter(u=>u.simType==='Physical SIM').length, low:true, note:'Held at Rotterdam depot'},
    {id:'ST-M2M', kind:'M2M industrial SIM', avail:118, allocated:USERS.filter(u=>u.simType==='M2M SIM').length, low:false, note:'Held at Antwerp warehouse'}
  ];
  return pagehead('SIM and eSIM',
    'Order, activate, suspend and swap SIM profiles. eSIM activation is issued as a QR code or an activation code, valid for 72 hours.',
    '<button class="btn" onclick="toast(\'SIM stock order raised with Kestrel Telecom\')">'+ICO('package',13)+'Order stock</button>'+
    '<button class="btn btn-primary" onclick="simSwap()">'+ICO('swap',14)+'SIM swap</button>')+
  '<div class="stack">'+
  banner('warning','<strong>Physical SIM stock is low.</strong> 62 blanks remain at Rotterdam against an average draw of 34 per month. Lead time from the operator is 5 working days.')+
  '<div class="grid g3">'+ stock.map(s=>
    '<div class="metric"><div class="m-label">'+ICO('sim',14)+esc(s.kind)+'</div>'+
    '<div class="m-value">'+s.avail+'</div>'+
    '<div class="m-foot">'+(s.low?pill('degraded','Low stock'):pill('active','In stock'))+' · '+s.allocated+' allocated</div>'+
    '<div class="t-tiny muted" style="margin-top:6px">'+esc(s.note)+'</div></div>').join('')+'</div>'+
  panel('SIM inventory', dt('dtSims',{
    rows:USERS.filter(u=>u.status!=='deactivated'), noun:'SIMs', pageSize:12, sortKey:'iccid',
    searchFields:['iccid','msisdn','name','simType'], searchPlaceholder:'Search ICCID or number',
    chips:[{key:'simType',options:[{label:'eSIM',value:'eSIM'},{label:'Physical',value:'Physical SIM'},{label:'M2M',value:'M2M SIM'}]}],
    actions:exportBtn('SIM inventory'),
    columns:[
      {key:'iccid',label:'ICCID',render:r=>'<span class="t-num cellmain">'+esc(r.iccid)+'</span>'},
      {key:'simType',label:'Type',render:r=>r.simType==='eSIM'?pill('info','eSIM'):r.simType==='M2M SIM'?pill('partial','M2M'):'<span class="t-small">Physical</span>'},
      {key:'msisdn',label:'Number',render:r=>'<span class="t-num">'+esc(r.msisdn)+'</span>'},
      {key:'name',label:'Assigned to',render:r=>esc(r.name)},
      {key:'device',label:'Device',render:r=>'<span class="t-small">'+esc(r.device)+'</span>'},
      {key:'status',label:'Status',render:r=>statusPill(r.status)},
      {key:'__acts',label:'',sort:false,render:r=>'<button class="btn btn-sm btn-quiet" onclick="simSwap(\''+r.id+'\')">Swap</button>'}
    ]}),{flush:true,icon:'sim'})+
  '</div>';
}
function simSwap(id){
  const u=id?USERS.find(x=>x.id===id):null;
  openModal('<div class="modal-head">'+ICO('swap',18)+'<div class="grow"><h3 class="t-sub">SIM swap</h3>'+
    '<div class="t-small muted">Moves a number to a new SIM profile. Identity verification is mandatory before the swap is executed.</div></div>'+
    '<button class="iconbtn" onclick="closeModal()" aria-label="Close">'+ICO('x',16)+'</button></div>'+
    '<div class="modal-body stack">'+
      '<div class="wizrail"><div class="st done"><span class="n">'+SH('check',10)+'</span>Line</div><div class="st now"><span class="n">2</span>New profile</div>'+
      '<div class="st"><span class="n">3</span>Verification</div></div>'+
      '<div class="grid g2">'+
        '<div class="field"><label for="swLine">Line</label><input class="inp" id="swLine" value="'+(u?esc(u.msisdn+' — '+u.name):'')+'" placeholder="Search number or user" data-autofocus></div>'+
        '<div class="field"><label for="swType">New SIM type</label><select class="inp" id="swType"><option selected>eSIM — issue QR code</option><option>Physical SIM from depot stock</option></select></div>'+
      '</div>'+
      '<div class="field"><label for="swReason">Reason</label><select class="inp" id="swReason">'+
        '<option>Device replaced</option><option selected>Device lost or stolen</option><option>SIM faulty</option><option>Moving to eSIM</option></select></div>'+
      '<div class="impact impact-danger"><strong>Fraud controls</strong><ul>'+
        '<li>The old profile is disabled the moment the new one registers on the network.</li>'+
        '<li>A one-time code is sent to the enterprise admin, not to the affected line.</li>'+
        '<li>Inbound calls and SMS are unavailable for up to 15 minutes during the swap.</li>'+
        '<li>The swap is written to the audit log with your identity and IP.</li></ul></div>'+
    '</div>'+
    '<div class="modal-foot"><span class="t-tiny muted grow">Swaps on lost or stolen devices are treated as high risk.</span>'+
    '<button class="btn btn-quiet" onclick="closeModal()">Cancel</button>'+
    '<button class="btn btn-primary" onclick="closeModal();toast(\'Verification code sent to a.visser@gmail.com\',\'warn\')">Send verification</button></div>',
    {wide:true,label:'SIM swap'});
}

/* ------------------------- 7. SD-WAN, MPLS network ----------------------- */
function vNetwork(){
  const sel=SITES[4];
  return pagehead('Connectivity',
    SITES.filter(s=>s.type==='SD-WAN').length+' SD-WAN sites and '+SITES.filter(s=>s.type==='MPLS').length+' MPLS circuits. '+
    'Telemetry is unavailable at '+SITE_NOTEL.length+' sites and is reported as such rather than estimated.',
    '<button class="btn" onclick="toast(\'Change window request sent to Kestrel Telecom\')">'+ICO('calendar',13)+'Request change</button>'+
    '<button class="btn btn-primary" onclick="App.go(\'orders\')">'+ICO('plus',14)+'New site</button>')+
  '<div class="stack">'+
  banner('danger','<strong>'+esc(sel.name)+' ('+esc(sel.id)+') is down.</strong> Detected 12 minutes ago. Traffic for 3 depots is failing over to Cologne, adding roughly 18 ms. Operator incident INC-88214 is open at Tier 2.')+
  '<div class="grid g4">'+
    metric({icon:'network',label:'Sites online',value:KPI.sitesOnline+' / '+KPI.sites,foot:SITE_DOWN.length+' down · '+SITE_DEG.length+' degraded'})+
    metric({icon:'zap',label:'Aggregate contracted bandwidth',value:FMT.num(SITES.reduce((a,s)=>a+s.bwMbps,0))+' Mbps',foot:'Across '+SITES.length+' access circuits'})+
    metric({icon:'gauge',label:'Median latency',value:null,naLabel:'Partial — '+(KPI.sites-SITE_REPORTING.length)+' sites not reporting',foot:pill('partial',SITE_REPORTING.length+' of '+KPI.sites+' sites')})+
    metric({icon:'clock',label:'Availability (30 d)',value:FMT.pct(SITES.reduce((a,s)=>a+s.uptime30,0)/SITES.length),foot:'Contracted floor 99.5% · '+esc(ENT.contractRef)})+
  '</div>'+
  panel('Topology — Benelux core and depots', networkTopology(),
    {icon:'route',flush:true,sub:'Simplified view. Link style shows state so it does not rely on colour alone.'})+
  panel('Sites and circuits', dt('dtSites',{
    rows:SITES, noun:'sites', pageSize:12, sortKey:'name', onRow:"openSite('$ID')",
    searchFields:['id','name','city','country','type'], searchPlaceholder:'Search site, city or ID',
    chips:[{key:'type',options:[{label:'SD-WAN',value:'SD-WAN'},{label:'MPLS',value:'MPLS'}]},
           {key:'status',options:[{label:'Online',value:'online'},{label:'Degraded',value:'degraded'},{label:'Down',value:'down'}]}],
    actions:exportBtn('Site inventory'),
    columns:[
      {key:'name',label:'Site',render:r=>'<div class="cellmain">'+esc(r.name)+'</div><div class="cellsub">'+esc(r.id)+' · '+esc(r.city)+', '+esc(r.country)+'</div>'},
      {key:'type',label:'Service',render:r=>r.type==='SD-WAN'?pill('info','SD-WAN'):pill('partial','MPLS')},
      {key:'bwMbps',label:'Bandwidth',align:'right',render:r=>'<span class="t-num">'+r.bwMbps+' Mbps</span><div class="cellsub">'+r.links+' link'+(r.links>1?'s':'')+'</div>'},
      {key:'utilPct',label:'Utilisation',align:'right',width:'150px',render:r=>r.utilPct==null?meter(null,null,{naLabel:'Not measured'}):meter(r.utilPct)},
      {key:'latencyMs',label:'Latency',align:'right',render:r=>r.latencyMs==null?NOTMEASURED():'<span class="t-num">'+FMT.dec(r.latencyMs,1)+' ms</span>'},
      {key:'lossPct',label:'Loss',align:'right',render:r=>r.lossPct==null?NOTMEASURED():'<span class="t-num">'+FMT.dec(r.lossPct,2)+'%</span>'},
      {key:'uptime30',label:'Uptime 30 d',align:'right',render:r=>'<span class="t-num">'+FMT.dec(r.uptime30,2)+'%</span>'},
      {key:'status',label:'Status',render:r=>statusPill(r.status)}
    ]}),{flush:true,icon:'network'})+
  '</div>';
}
function networkTopology(){
  const core=[{x:340,y:36,l:'Kestrel core — Amsterdam',w:190}];
  const nodes=[
    {x:60,y:140,l:'Rotterdam DC',s:'online'},{x:220,y:140,l:'Amsterdam depot',s:'online'},
    {x:380,y:140,l:'Antwerp depot',s:'online'},{x:540,y:140,l:'Duisburg DC',s:'down'},
    {x:700,y:140,l:'Cologne depot',s:'online'},
    {x:60,y:246,l:'Lyon depot',s:'online'},{x:220,y:246,l:'Paris hub',s:'degraded'},
    {x:380,y:246,l:'Milan hub',s:'online'},{x:540,y:246,l:'Warsaw hub',s:'online'},
    {x:700,y:246,l:'Porto depot',s:'nodata'}
  ];
  const pillFor=s=>s==='down'?'Down':s==='degraded'?'Degraded':s==='nodata'?'No telemetry':'Online';
  let links='';
  nodes.forEach(n=>{
    const cls=n.s==='down'?'link down':n.s==='degraded'?'link deg':'link';
    links+='<path class="'+cls+'" d="M'+(n.x+62)+' '+n.y+' C '+(n.x+62)+' '+(n.y-46)+', 435 '+(n.y-46)+', 435 62"/>';
  });
  const rects=nodes.map(n=>'<g class="node"><rect x="'+n.x+'" y="'+n.y+'" width="124" height="46" rx="6"'+
    (n.s==='down'?' stroke="#B3261E" stroke-width="2"':n.s==='degraded'?' stroke="#8A5300" stroke-width="2" stroke-dasharray="4 3"':n.s==='nodata'?' stroke="#8D8D8D" stroke-dasharray="2 3"':'')+'/>'+
    '<text x="'+(n.x+10)+'" y="'+(n.y+19)+'" style="font-weight:600">'+esc(n.l)+'</text>'+
    '<text x="'+(n.x+10)+'" y="'+(n.y+34)+'" style="fill:#666">'+esc(pillFor(n.s))+'</text></g>').join('');
  return '<div class="topo"><svg viewBox="0 0 840 320" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Network topology: 8 sites online, 1 degraded, 1 down, 1 without telemetry">'+
    links+
    '<g class="node sel"><rect x="'+core[0].x+'" y="'+core[0].y+'" width="'+core[0].w+'" height="46" rx="6"/>'+
    '<text x="'+(core[0].x+12)+'" y="'+(core[0].y+20)+'" style="font-weight:600">'+esc(core[0].l)+'</text>'+
    '<text x="'+(core[0].x+12)+'" y="'+(core[0].y+35)+'" style="fill:#666">Dual-homed · CoS gold</text></g>'+
    rects+'</svg>'+
    '<div class="topo-legend"><span>── Healthy link</span><span style="color:var(--nim-warning-fg)">– – Degraded</span>'+
    '<span style="color:var(--nim-danger-fg)">·· Down</span><span style="color:var(--nim-unavailable-fg)">·· No telemetry</span></div></div>';
}
function openSite(id){
  const s=SITES.find(x=>x.id===id); if(!s) return;
  openInspector(
    '<div class="insp-head">'+ICO('network',18)+'<div class="grow"><div class="row" style="gap:6px">'+statusPill(s.status)+
      (s.type==='SD-WAN'?pill('info','SD-WAN'):pill('partial','MPLS'))+'</div>'+
      '<h3 class="t-sub" style="margin-top:5px">'+esc(s.name)+'</h3>'+
      '<div class="t-small muted">'+esc(s.id)+' · '+esc(s.city)+', '+esc(s.country)+'</div></div>'+
      '<button class="iconbtn" onclick="closeInspector()" aria-label="Close">'+ICO('x',16)+'</button></div>'+
    '<div class="insp-body stack">'+
      (s.status==='down'?banner('danger','Unreachable for 12 minutes. Operator incident <strong>INC-88214</strong> at Tier 2. Failover to Cologne is carrying the traffic.'):'')+
      (s.utilPct==null?banner('stale','<strong>No telemetry since 18 Jul.</strong> Utilisation, latency and loss are shown as not measured. They are never estimated.'):'')+
      '<dl class="deflist">'+
        '<dt>Contracted bandwidth</dt><dd class="t-num">'+s.bwMbps+' Mbps</dd>'+
        '<dt>Access links</dt><dd>'+s.links+(s.links>1?' (diverse)':' (single — no diversity)')+'</dd>'+
        '<dt>Traffic policy</dt><dd>'+esc(s.policy)+'</dd>'+
        '<dt>Utilisation</dt><dd>'+(s.utilPct==null?NOTMEASURED():FMT.pct(s.utilPct))+'</dd>'+
        '<dt>Latency</dt><dd>'+(s.latencyMs==null?NOTMEASURED():FMT.dec(s.latencyMs,1)+' ms')+'</dd>'+
        '<dt>Packet loss</dt><dd>'+(s.lossPct==null?NOTMEASURED():FMT.dec(s.lossPct,2)+'%')+'</dd>'+
        '<dt>Uptime, 30 days</dt><dd class="t-num">'+FMT.dec(s.uptime30,2)+'%</dd>'+
        '<dt>Last change</dt><dd>'+esc(s.lastChange)+'</dd>'+
      '</dl>'+
      '<div class="divider"></div><h4 class="t-sub">Utilisation, last 12 hours</h4>'+
      (s.utilPct==null
        ? '<div class="chart-empty">Not measured — the site has not reported since 18 Jul</div>'
        : CH.line([{pts:['12:00','14:00','16:00','18:00','20:00','22:00','00:00','02:00','04:00','06:00','08:00','10:00'].map((l,i)=>
            ({l,v: s.status==='down'&&i>8 ? null : +(s.utilPct*(0.6+0.5*Math.sin(i/2))).toFixed(1)}))}],
            {h:150,fmt:n=>Math.round(n)+'%',tip:n=>n+'%',aria:'Utilisation over 12 hours'}))+
      (s.status==='down'?'<div class="t-tiny muted" style="margin-top:6px">The gap at the right of the series is the current outage — no data is invented for it.</div>':'')+
    '</div>'+
    '<div class="insp-foot"><button class="btn btn-quiet" onclick="closeInspector()">Close</button><div class="spacer"></div>'+
      '<button class="btn btn-sm" onclick="toast(\'Diagnostics started — results in about 2 minutes\')">Run diagnostics</button>'+
      '<button class="btn btn-sm btn-primary" onclick="toast(\'Ticket raised against '+esc(s.id)+'\')">Raise ticket</button></div>','Site '+s.name);
}

/* --------------------------- 8. Plans and add-ons ------------------------ */
function vPlans(){
  const counts={}; USERS.forEach(u=>{counts[u.planId]=(counts[u.planId]||0)+1;});
  const under=UNDER;
  return pagehead('Plans and add-ons',
    'Plan mix across '+KPI.lines+' lines. Upgrades apply immediately; downgrades take effect at the start of the next cycle.',
    '<button class="btn" onclick="App.go(\'reports\')">'+ICO('chart',13)+'Plan analytics</button>'+
    '<button class="btn btn-primary" onclick="changePlanBulk()">'+ICO('package',14)+'Change plans</button>')+
  '<div class="stack">'+
  banner('info','<strong>'+under.length+' lines used under 40% of their allowance for three cycles.</strong> Right-sizing them is projected to save '+CUR(UNDER.length*7.6)+' per month. '+
    '<button class="linkbtn" onclick="changePlanBulk()">Review right-sizing</button>')+
  '<div class="grid g-2-1">'+
    panel('Plans in use', dt('dtPlans',{
      rows:PLANS.map(p=>Object.assign({},p,{lines:counts[p.id]||0, mrc:+((counts[p.id]||0)*p.price).toFixed(2)})),
      noun:'plans', pageSize:8, toolbar:false, sortKey:'lines', sortDir:'desc',
      columns:[
        {key:'name',label:'Plan',render:r=>'<div class="cellmain">'+esc(r.name)+'</div><div class="cellsub">'+esc(r.id)+' · '+esc(r.roam)+'</div>'},
        {key:'data',label:'Data',align:'right',render:r=>r.data==null?'<span class="t-small">Unlimited</span>':'<span class="t-num">'+r.data+' GB</span>'},
        {key:'voice',label:'Voice',render:r=>esc(r.voice)},
        {key:'price',label:'Price',align:'right',render:r=>'<span class="t-num">'+CUR(r.price)+'</span>'},
        {key:'lines',label:'Lines',align:'right',render:r=>'<span class="t-num cellmain">'+r.lines+'</span>'},
        {key:'mrc',label:'Monthly charge',align:'right',render:r=>'<span class="t-num">'+CUR(r.mrc)+'</span>'},
        {key:'__acts',label:'',sort:false,render:r=>'<button class="btn btn-sm btn-quiet" onclick="toast(\'Plan detail sheet opened\')">Detail</button>'}
      ]}),{flush:true,icon:'package'})+
    panel('Plan mix', CH.donut(PLANS.map(p=>({l:p.name,v:counts[p.id]||0})),
      {centre:String(KPI.lines),centreSub:'lines',fmt:n=>n+' lines',aria:'Plan mix by line count'}),{icon:'pie'})+
  '</div>'+
  panel('Add-ons', dt('dtAddons',{
    rows:ADDONS, noun:'add-ons', pageSize:8, toolbar:false, sortKey:'taken', sortDir:'desc',
    columns:[
      {key:'name',label:'Add-on',render:r=>'<div class="cellmain">'+esc(r.name)+'</div><div class="cellsub">'+esc(r.id)+'</div>'},
      {key:'term',label:'Term',render:r=>esc(r.term)},
      {key:'price',label:'Price',align:'right',render:r=>'<span class="t-num">'+CUR(r.price)+'</span>'},
      {key:'taken',label:'Active on',align:'right',render:r=>'<span class="t-num">'+r.taken+' lines</span>'},
      {key:'__acts',label:'',sort:false,render:r=>'<button class="btn btn-sm" onclick="toast(\''+esc(r.name)+' — choose target lines\')">Apply to lines</button>'}
    ]}),{flush:true,icon:'plus',
    sub:'Standard users may request add-ons; team leaders approve up to '+CUR(50)+'; anything above needs an enterprise admin.'})+
  '</div>';
}
function changePlanBulk(){
  const under=UNDER;
  confirmAction({
    title:'Right-size '+under.length+' lines', subtitle:'Business Mobile 60 down to Business Mobile 25 where usage stayed under 40% for three cycles',
    risk:'normal', confirmLabel:'Schedule for next cycle',
    body:'<div class="tablewrap" style="max-height:190px;overflow:auto"><table class="tbl"><tbody>'+
      under.slice(0,8).map(u=>'<tr><td><div class="cellmain">'+esc(u.name)+'</div><div class="cellsub">'+esc(u.teamName)+'</div></td>'+
      '<td class="num">'+FMT.gb(u.dataUsedGb)+' of '+u.dataAllowGb+' GB</td><td class="num">'+CUR(-7.60)+'</td></tr>').join('')+
      '</tbody></table></div>'+(under.length>8?'<div class="t-tiny muted" style="margin-top:6px">Showing 8 of '+under.length+'.</div>':''),
    impact:['Recurring charge falls by <strong>'+CUR(UNDER.length*7.6)+' per month</strong> from the next cycle.',
            'Allowance drops from 60 GB to 25 GB on these lines. Three of them peaked above 25 GB once in the last year.',
            'Affected users and their team leaders are notified 7 days before the change.',
            'Downgrades never apply mid-cycle, so this cycle is billed at the current rate.'],
    footNote:'Reversible until the change window opens on the 1st.',
    onConfirm:()=>toast(under.length+' plan changes scheduled for 01 Aug 2026')
  });
}

/* --------------------------- 9. Shared data pools ------------------------ */
function vPools(){
  return pagehead('Shared data pools',
    'Pooled allowances let teams draw from a common bucket instead of per-line allowances. Policies decide what happens at the ceiling.',
    '<button class="btn" onclick="toast(\'Pool policy editor opened\')">'+ICO('settings',13)+'Policies</button>'+
    '<button class="btn btn-primary" onclick="allocatePool()">'+ICO('database',14)+'Allocate top-up</button>')+
  '<div class="stack">'+
  banner('danger','<strong>Field operations pool is at '+FMT.pct(POOLS[0].pct)+'.</strong> At the current daily rate it exhausts around 22 Jul, nine days before the cycle ends. The auto-top-up policy is armed but has not fired yet.')+
  '<div class="grid g3">'+POOLS.map(p=>
    '<div class="metric"><div class="m-label">'+ICO('database',14)+esc(p.name)+'</div>'+
    '<div class="m-value">'+FMT.pct(p.pct)+'</div>'+
    '<div style="margin-top:9px">'+meter(p.pct,FMT.gb(p.usedGb)+' of '+FMT.gb(p.allowGb))+'</div>'+
    '<div class="m-foot">'+p.members+' lines · '+esc(p.policy)+'</div></div>').join('')+'</div>'+
  panel('Pools', dt('dtPools',{
    rows:POOLS, noun:'pools', pageSize:8, toolbar:false, sortKey:'pct', sortDir:'desc',
    columns:[
      {key:'name',label:'Pool',render:r=>'<div class="cellmain">'+esc(r.name)+'</div><div class="cellsub">'+esc(r.id)+' · '+r.teams.map(t=>esc(TEAMS.find(x=>x.id===t).name)).join(', ')+'</div>'},
      {key:'members',label:'Lines',align:'right',render:r=>'<span class="t-num">'+r.members+'</span>'},
      {key:'allowGb',label:'Allowance',align:'right',render:r=>'<span class="t-num">'+FMT.gb(r.allowGb)+'</span>'},
      {key:'usedGb',label:'Consumed',align:'right',width:'190px',render:r=>meter(r.pct,FMT.gb(r.usedGb))},
      {key:'policy',label:'Ceiling policy',render:r=>esc(r.policy)},
      {key:'topup',label:'Top-up',render:r=>esc(r.topup)},
      {key:'__acts',label:'',sort:false,render:r=>'<button class="btn btn-sm" onclick="allocatePool(\''+r.id+'\')">Top up</button>'}
    ]}),{flush:true,icon:'database'})+
  panel('Draw by team — this cycle',
    CH.stack(TEAMS.filter(t=>POOLS.some(p=>p.teams.includes(t.id)))
      .map(t=>({label:t.name,parts:[t.dataUsedGb]})).sort((a,b)=>b.parts[0]-a.parts[0]),
      {names:['Consumed'],fmt:n=>FMT.gb(n)}),
    {icon:'chart',sub:'Teams not attached to a pool draw against their own per-line allowances.'})+
  '</div>';
}
function allocatePool(id){
  const p=POOLS.find(x=>x.id===id)||POOLS[0];
  confirmAction({
    title:'Allocate top-up to '+p.name, subtitle:'Currently '+FMT.gb(p.usedGb)+' of '+FMT.gb(p.allowGb)+' consumed ('+FMT.pct(p.pct)+')',
    risk:'normal', confirmLabel:'Allocate top-up',
    body:'<div class="grid g2">'+
      '<div class="field"><label for="tuSize">Top-up size</label><select class="inp" id="tuSize" data-autofocus>'+
        '<option>128 GB — '+CUR(19)+'</option><option selected>256 GB — '+CUR(38)+'</option><option>512 GB — '+CUR(72)+'</option></select></div>'+
      '<div class="field"><label for="tuWhen">Apply</label><select class="inp" id="tuWhen"><option selected>Immediately</option><option>At 95% consumption</option><option>Start of next cycle</option></select></div></div>'+
      '<div class="field" style="margin-top:12px"><label for="tuCap">Cap automatic top-ups per cycle</label>'+
      '<div class="stepper"><button type="button" onclick="var i=this.nextElementSibling;i.value=Math.max(0,+i.value-1)">'+SH('minus',11)+'</button>'+
      '<input value="2" aria-label="Maximum automatic top-ups"><button type="button" onclick="var i=this.previousElementSibling;i.value=+i.value+1">+</button></div></div>',
    impact:['Adds <strong>256 GB</strong> to the pool ceiling for the current cycle only.',
            'One-off charge of '+CUR(38)+' appears on invoice '+INVOICES[0].id+'.',
            'Out-of-bundle charges are avoided for an estimated 9 days of consumption.',
            'The '+p.members+' lines in this pool are not notified — allowance changes are silent to users.'],
    footNote:'Top-ups do not roll over to the next cycle.',
    onConfirm:()=>{ p.allowGb+=256; p.pct=+(p.usedGb/p.allowGb*100).toFixed(1); toast('256 GB allocated to '+p.name); App.go('pools'); }
  });
}

/* ------------------------- 10. Usage monitoring -------------------------- */
function vUsage(){
  const top=USERS.filter(u=>u.dataUsedGb!=null).sort((a,b)=>b.dataUsedGb-a.dataUsedGb).slice(0,10);
  return pagehead('Usage',
    'Data, voice and SMS across every line on '+esc(ENT.id)+'. One record is missing from Aug 2025 and is shown as a gap, not as zero.',
    '<div class="seg" role="group" aria-label="Usage dimension">'+
      '<button aria-pressed="true">Data</button><button aria-pressed="false" onclick="toast(\'Voice view\')">Voice</button>'+
      '<button aria-pressed="false" onclick="toast(\'SMS view\')">SMS</button></div>'+
    exportBtn('Usage detail')+scheduleBtn())+
  '<div class="stack">'+
  '<div class="grid g4">'+
    metric({icon:'database',label:'Data consumed',value:FMT.gb(KPI.dataUsedGb),foot:delta(8.4)+' vs same day last cycle'})+
    metric({icon:'phone',label:'Voice minutes',value:FMT.num(USAGE_VOICE[USAGE_VOICE.length-1].v),foot:delta(-3.1)+' vs last cycle'})+
    metric({icon:'globe',label:'Roaming data',value:FMT.gb(USERS.reduce((a,u)=>a+(u.roamingGb||0),0)),foot:USERS.filter(u=>u.roamingGb>0).length+' lines roamed'})+
    metric({icon:'warning',label:'Lines over allowance',value:String(USERS.filter(u=>u.dataAllowGb&&u.dataUsedGb>u.dataAllowGb).length),
      foot:'Out-of-bundle charge so far '+CUR(486.20)})+
  '</div>'+
  panel('Consumption trend',
    CH.line([{pts:USAGE_DATA}],{fmt:n=>Math.round(n/1000)+' TB',tip:n=>FMT.gb(n),aria:'Data consumption over 12 cycles'})+
    '<div class="legend"><span><i style="background:#0099FF"></i>Data consumed</span>'+
    '<span><i style="background:#E4E4E4"></i>Aug 2025 — no usage record retained for this account</span></div>',
    {icon:'activity',acts:'<button class="btn btn-sm btn-quiet" onclick="toast(\'Switched to daily granularity\')">Daily</button>'})+
  '<div class="grid g2">'+
    panel('Top consumers this cycle',
      '<table class="tbl"><tbody>'+top.map((u,i)=>
        '<tr onclick="openUserDetail(\''+u.id+'\')" style="cursor:pointer"><td style="width:26px" class="dim t-num">'+(i+1)+'</td>'+
        '<td><div class="cellmain">'+esc(u.name)+'</div><div class="cellsub">'+esc(u.teamName)+' · '+esc(u.planName)+'</div></td>'+
        '<td class="num" style="width:160px">'+tinyMeter(u.dataUsedGb,u.dataAllowGb)+'</td></tr>').join('')+'</tbody></table>',
      {flush:true,icon:'trendup'})+
    panel('Consumption by team',
      CH.stack(TEAMS.map(t=>({label:t.name,parts:[t.dataUsedGb]})).sort((a,b)=>b.parts[0]-a.parts[0]),
        {names:['Data'],fmt:n=>FMT.gb(n)}),{icon:'group'})+
  '</div>'+
  '</div>';
}

/* --------------------------- 11. Billing, invoices ----------------------- */
function vInvoices(){
  return pagehead('Invoices',
    esc(ENT.paymentTerms)+' · billed '+esc(ENT.billingCycle)+' · balance outstanding '+CUR(KPI.balanceDue),
    '<button class="btn" onclick="toast(\'Dispute form opened\')">'+ICO('flag',13)+'Raise dispute</button>'+
    exportBtn('Invoice history')+
    (INV_OPEN.length?'<button class="btn btn-primary" onclick="payInvoice(\''+INV_OPEN[INV_OPEN.length-1].id+'\')">'+ICO('wallet',14)+'Pay '+CUR0(KPI.balanceDue)+'</button>':''))+
  '<div class="stack">'+
  banner('danger','<strong>'+INVOICES[1].id+' is 4 days overdue.</strong> '+CUR(INVOICES[1].amount)+' was due '+esc(INVOICES[1].due)+'. Late-payment terms under '+esc(ENT.contractRef)+' start at day 7. '+
    '<button class="linkbtn" onclick="payInvoice(\''+INVOICES[1].id+'\')">Pay now</button>')+
  '<div class="grid g4">'+
    metric({icon:'wallet',label:'Balance outstanding',value:CUR(KPI.balanceDue),foot:INV_OPEN.length+' unsettled invoices'})+
    metric({icon:'invoice',label:'Current cycle to date',value:CUR(INVOICES[0].amount),foot:'Estimate · closes 31 Jul'})+
    metric({icon:'trendup',label:'Average monthly charge',value:CUR0(SPEND.reduce((a,s)=>a+s.v,0)/SPEND.length),foot:'Trailing 12 cycles'})+
    metric({icon:'checkcircle',label:'Payment record',value:'On time',foot:'11 of 12 settled within terms'})+
  '</div>'+
  panel('Charge trend against budget',
    CH.line([{pts:SPEND},{pts:BUDGET}],{fmt:n=>CUR0(n),tip:n=>CUR(n),aria:'Monthly charge against budget'})+
    '<div class="legend"><span><i style="background:#0099FF"></i>Invoiced</span><span><span class="dash"></span>Budget '+CUR0(11500)+'</span></div>',
    {icon:'chart'})+
  panel('Invoice history', dt('dtInv',{
    rows:INVOICES, noun:'invoices', pageSize:12, sortKey:'id', sortDir:'desc', onRow:"openInvoice('$ID')",
    searchFields:['id','period','status'], searchPlaceholder:'Search invoice or period',
    chips:[{key:'status',options:[{label:'Paid',value:'paid'},{label:'Open',value:'open'},{label:'Overdue',value:'overdue'}]}],
    columns:[
      {key:'id',label:'Invoice',render:r=>'<div class="cellmain t-num">'+esc(r.id)+'</div><div class="cellsub">'+r.lines+' charge lines</div>'},
      {key:'period',label:'Period',render:r=>esc(r.period)},
      {key:'issued',label:'Issued',render:r=>esc(r.issued)},
      {key:'due',label:'Due',render:r=>esc(r.due)},
      {key:'recurring',label:'Recurring',align:'right',render:r=>'<span class="t-num">'+CUR(r.recurring)+'</span>'},
      {key:'usage',label:'Usage',align:'right',render:r=>'<span class="t-num">'+CUR(r.usage)+'</span>'},
      {key:'amount',label:'Total',align:'right',render:r=>'<span class="t-num cellmain">'+CUR(r.amount)+'</span>'},
      {key:'status',label:'Status',render:r=>statusPill(r.status)},
      {key:'__acts',label:'',sort:false,render:r=>r.status==='paid'
        ? '<button class="btn btn-sm btn-quiet" onclick="event.stopPropagation();toast(\'PDF downloaded\')">PDF</button>'
        : '<button class="btn btn-sm btn-primary" onclick="event.stopPropagation();payInvoice(\''+r.id+'\')">Pay</button>'}
    ]}),{flush:true,icon:'invoice'})+
  '</div>';
}

/* ---------------------- 12. Payments and methods ------------------------- */
function vPayments(){
  const hist=INVOICES.filter(i=>i.status==='paid').slice(0,8);
  return pagehead('Payments',
    'Settlement history and the methods this account can be charged against. One method must always be primary.',
    '<button class="btn btn-primary" onclick="toast(\'Add payment method — bank verification required\')">'+ICO('plus',14)+'Add method</button>')+
  '<div class="stack">'+
  banner('warning','<strong>One stored card has expired.</strong> Amex •••• 1006 expired 02/2026 and can no longer be charged. Remove it or replace it to keep a backup method available.')+
  '<div class="grid g3">'+PAY_METHODS.map(m=>
    '<div class="card"><div class="card-head">'+ICO(m.kind==='SEPA direct debit'?'wallet':'invoice',15)+
    '<div class="grow"><div class="t-sub">'+esc(m.kind)+'</div><div class="t-tiny muted t-num">'+esc(m.detail)+'</div></div>'+
    (m.primary?pill('info','Primary'):m.status==='expired'?pill('down','Expired'):pill('active','Active'))+'</div>'+
    '<div class="card-body"><dl class="deflist" style="grid-template-columns:96px 1fr">'+
      '<dt>Holder</dt><dd>'+esc(m.holder)+'</dd><dt>Expires</dt><dd>'+esc(m.expires)+'</dd></dl>'+
    '<div class="row" style="margin-top:11px">'+
      (m.primary?'<span class="t-tiny muted grow">Used for automatic collection</span>':
        m.status==='expired'?'<button class="btn btn-sm btn-danger grow" onclick="toast(\'Method removed\')">Remove</button>':
        '<button class="btn btn-sm grow" onclick="toast(\''+esc(m.detail)+' set as primary\')">Make primary</button>')+
    '</div></div></div>').join('')+'</div>'+
  panel('Settlement history', dt('dtPay',{
    rows:hist.map(i=>({id:i.id,period:i.period,paidOn:i.paidOn,method:i.method,amount:i.amount,status:'completed'})),
    noun:'payments', pageSize:8, toolbar:false, sortKey:'id', sortDir:'desc',
    columns:[
      {key:'paidOn',label:'Settled',render:r=>esc(r.paidOn)},
      {key:'id',label:'Against invoice',render:r=>'<span class="cellmain t-num">'+esc(r.id)+'</span><div class="cellsub">'+esc(r.period)+'</div>'},
      {key:'method',label:'Method',render:r=>esc(r.method)},
      {key:'amount',label:'Amount',align:'right',render:r=>'<span class="t-num cellmain">'+CUR(r.amount)+'</span>'},
      {key:'status',label:'Status',render:r=>statusPill('completed')},
      {key:'__acts',label:'',sort:false,render:()=>'<button class="btn btn-sm btn-quiet" onclick="toast(\'Remittance advice downloaded\')">Advice</button>'}
    ]}),{flush:true,icon:'wallet'})+
  panel('Automatic collection',
    '<div class="grid g2"><div class="stack" style="gap:11px">'+
      '<label class="toggle"><input type="checkbox" checked><span class="track"></span>Collect automatically on the due date</label>'+
      '<label class="toggle"><input type="checkbox" checked><span class="track"></span>Retry a failed collection after 3 working days</label>'+
      '<label class="toggle"><input type="checkbox"><span class="track"></span>Fall back to the backup method if the primary fails</label>'+
    '</div><div class="stack" style="gap:11px">'+
      '<div class="field"><label for="payAlert">Notify before collection</label><select class="inp" id="payAlert">'+
        '<option>1 day before</option><option selected>3 days before</option><option>7 days before</option></select></div>'+
      '<div class="field"><label for="payTo">Billing contacts</label><input class="inp" id="payTo" value="finance@gmail.com; a.visser@gmail.com"></div>'+
    '</div></div><div class="divider"></div>'+
    '<div class="row"><span class="t-tiny muted grow">Changes apply from the next collection run.</span>'+
    '<button class="btn btn-primary" onclick="toast(\'Collection settings saved\')">Save</button></div>',{icon:'settings'})+
  '</div>';
}

/* -------------------------- 13. Cost allocation -------------------------- */
function vChargeback(){
  const rows=TEAMS.map(t=>{
    const share=t.spend/KPI.mrc;
    return {cc:t.cc, team:t.name, lines:t.members, recurring:t.spend,
      usage:+(INVOICES[0].usage*share).toFixed(2), oneoff:+(INVOICES[0].oneoff*share).toFixed(2),
      total:+(t.spend+INVOICES[0].usage*share+INVOICES[0].oneoff*share).toFixed(2), data:t.dataUsedGb};
  });
  const attributed=rows.reduce((a,r)=>a+r.total,0);
  return pagehead('Cost allocation',
    'Charges split by cost centre for the current cycle. Anything that cannot be attributed from evidence is reported as unattributed, never spread by estimate.',
    exportBtn('Chargeback')+scheduleBtn()+
    '<button class="btn btn-primary" onclick="toast(\'Chargeback posted to the finance system\')">'+ICO('external',14)+'Post to ERP</button>')+
  '<div class="stack">'+
  banner('partial','<strong>'+CUR(1840)+' of roaming charges cannot be attributed.</strong> Porto and Ghent stopped reporting usage telemetry on 18 Jul. Those charges sit in an unattributed bucket until the sites report or the operator supplies detail records.')+
  '<div class="grid g4">'+
    metric({icon:'wallet',label:'Attributed this cycle',value:CUR0(attributed),foot:FMT.pct(attributed/(attributed+1840)*100)+' of total charge'})+
    metric({icon:'eyeoff',label:'Unattributed',value:CUR0(1840),foot:pill('partial','2 sites without telemetry')})+
    metric({icon:'building',label:'Cost centres',value:String(TEAMS.length),foot:'Mapped to '+esc(ENT.legal)})+
    metric({icon:'gauge',label:'Cost per active line',value:CUR(attributed/KPI.lines),foot:delta(-1.8,'%',true)+' vs last cycle'})+
  '</div>'+
  panel('Split by cost centre', dt('dtCb',{
    rows:rows, noun:'cost centres', pageSize:10, toolbar:false, sortKey:'total', sortDir:'desc',
    columns:[
      {key:'cc',label:'Cost centre',render:r=>'<div class="cellmain t-num">'+esc(r.cc)+'</div><div class="cellsub">'+esc(r.team)+'</div>'},
      {key:'lines',label:'Lines',align:'right',render:r=>'<span class="t-num">'+r.lines+'</span>'},
      {key:'data',label:'Data',align:'right',render:r=>'<span class="t-num">'+FMT.gb(r.data)+'</span>'},
      {key:'recurring',label:'Recurring',align:'right',render:r=>'<span class="t-num">'+CUR(r.recurring)+'</span>'},
      {key:'usage',label:'Usage',align:'right',render:r=>'<span class="t-num">'+CUR(r.usage)+'</span>'},
      {key:'oneoff',label:'One-off',align:'right',render:r=>'<span class="t-num">'+CUR(r.oneoff)+'</span>'},
      {key:'total',label:'Total',align:'right',render:r=>'<span class="t-num cellmain">'+CUR(r.total)+'</span>'},
      {key:'__acts',label:'',sort:false,render:r=>'<button class="btn btn-sm btn-quiet" onclick="toast(\'Charge detail for '+esc(r.cc)+'\')">Detail</button>'}
    ]}),{flush:true,icon:'pie',
    acts:'<span class="pill pill-partial">'+SH('half')+CUR(1840)+' unattributed</span>'})+
  '</div>';
}

/* ------------------------ 14. Orders and requests ------------------------ */
function vOrders(){
  return pagehead('Orders and requests',
    KPI.pendingOrders+' in flight · every order carries an expected completion date supplied by the operator',
    '<button class="btn" onclick="App.go(\'tickets\')">'+ICO('support',13)+'Raise ticket instead</button>'+
    '<button class="btn btn-primary" onclick="newOrder()">'+ICO('plus',14)+'New order</button>')+
  '<div class="stack">'+
  '<div class="grid g4">'+
    metric({icon:'orders',label:'In flight',value:String(KPI.pendingOrders),foot:ORDERS.filter(o=>o.status==='pending').length+' awaiting approval'})+
    metric({icon:'checkcircle',label:'Completed, 90 days',value:String(ORDERS.filter(o=>o.status==='completed').length),foot:'Average 3.4 working days'})+
    metric({icon:'clock',label:'Longest open',value:'11 days',foot:'ORD-78287 · new SD-WAN site, Naples'})+
    metric({icon:'ban',label:'Rejected',value:String(ORDERS.filter(o=>o.status==='rejected').length),foot:'All duplicates of existing orders'})+
  '</div>'+
  panel(null, dt('dtOrders',{
    rows:ORDERS, noun:'orders', pageSize:12, sortKey:'id', sortDir:'desc',
    searchFields:['id','type','subject','raisedBy','teamName'], searchPlaceholder:'Search order, type or requester',
    chips:[{key:'status',options:[{label:'Pending',value:'pending'},{label:'In progress',value:'inprogress'},
      {label:'Completed',value:'completed'},{label:'Rejected',value:'rejected'}]}],
    actions:exportBtn('Order history'),
    columns:[
      {key:'id',label:'Order',render:r=>'<div class="cellmain t-num">'+esc(r.id)+'</div><div class="cellsub">'+esc(r.raised)+'</div>'},
      {key:'type',label:'Type',render:r=>esc(r.type)},
      {key:'subject',label:'Subject',render:r=>esc(r.subject)+'<div class="cellsub">'+esc(r.teamName)+'</div>'},
      {key:'raisedBy',label:'Requested by',render:r=>esc(r.raisedBy)},
      {key:'value',label:'Monthly impact',align:'right',render:r=>r.value?'<span class="t-num">'+CUR(r.value)+'</span>':'<span class="dim">—</span>'},
      {key:'eta',label:'Expected',render:r=>esc(r.eta)},
      {key:'status',label:'Status',render:r=>statusPill(r.status)},
      {key:'__acts',label:'',sort:false,render:r=>r.status==='pending'
        ? '<button class="btn btn-sm btn-primary" onclick="toast(\''+esc(r.id)+' approved and sent to the operator\')">Approve</button>'
        : '<button class="btn btn-sm btn-quiet" onclick="toast(\'Order timeline opened\')">Track</button>'}
    ]}),{flush:true})+
  '</div>';
}
function newOrder(){
  openModal('<div class="modal-head">'+ICO('orders',18)+'<div class="grow"><h3 class="t-sub">New order</h3>'+
    '<div class="t-small muted">Orders are submitted to '+esc(OPERATOR.name)+' and tracked to completion in this screen.</div></div>'+
    '<button class="iconbtn" onclick="closeModal()" aria-label="Close">'+ICO('x',16)+'</button></div>'+
    '<div class="modal-body stack">'+
      '<div class="field"><label for="ordType">What do you need</label><select class="inp" id="ordType" data-autofocus>'+
        ORDER_TYPES.map(t=>'<option>'+esc(t)+'</option>').join('')+'</select></div>'+
      '<div class="grid g2">'+
        '<div class="field"><label for="ordFor">For</label><select class="inp" id="ordFor">'+
          TEAMS.map(t=>'<option>'+esc(t.name)+'</option>').join('')+'</select></div>'+
        '<div class="field"><label for="ordQty">Quantity</label>'+
          '<div class="stepper"><button type="button" onclick="var i=this.nextElementSibling;i.value=Math.max(1,+i.value-1)">'+SH('minus',11)+'</button>'+
          '<input value="1" aria-label="Quantity"><button type="button" onclick="var i=this.previousElementSibling;i.value=+i.value+1">+</button></div></div>'+
      '</div>'+
      '<div class="field"><label for="ordWhen">Needed by</label><input class="inp" id="ordWhen" type="date" value="2026-08-14"></div>'+
      '<div class="field"><label for="ordNote">Context for the operator</label><textarea class="inp" id="ordNote" placeholder="Anything that helps the provisioning team"></textarea></div>'+
      '<div class="impact"><strong>Before you submit</strong><ul>'+
        '<li>Recurring charges start on the activation date, not the order date.</li>'+
        '<li>Standard lead time for this type is 3–5 working days.</li>'+
        '<li>The order is visible to your operator support team in their self-care view.</li></ul></div>'+
    '</div>'+
    '<div class="modal-foot"><span class="t-tiny muted grow">You can cancel without charge until the operator accepts.</span>'+
    '<button class="btn btn-quiet" onclick="closeModal()">Cancel</button>'+
    '<button class="btn btn-primary" onclick="closeModal();toast(\'Order ORD-78291 submitted to Kestrel Telecom\')">Submit order</button></div>',
    {wide:true,label:'New order'});
}

/* --------------------------- 15. Support tickets ------------------------- */
function vTickets(){
  return pagehead('Support',
    KPI.openTickets+' open · mean time to resolve '+FMT.mins(KPI.mttr)+' · '+FMT.pct(KPI.slaOk)+' of resolved tickets met their SLA target',
    '<button class="btn" onclick="AI.open()">'+ICO('ai',13)+'Ask the assistant first</button>'+
    '<button class="btn btn-primary" onclick="raiseTicket()">'+ICO('plus',14)+'Raise ticket</button>')+
  '<div class="stack">'+
  '<div class="grid g4">'+
    metric({icon:'inbox',label:'Open tickets',value:String(KPI.openTickets),
      foot:TICKETS.filter(t=>t.status!=='resolved'&&t.severity==='P1').length+' at P1 · '+TICKETS.filter(t=>t.escalated&&t.status!=='resolved').length+' escalated'})+
    metric({icon:'clock',label:'Mean time to resolve',value:FMT.mins(KPI.mttr),foot:delta(-9,'%',true)+' vs last quarter'})+
    metric({icon:'checkcircle',label:'Resolved within SLA',value:FMT.pct(KPI.slaOk),foot:T_RES.filter(t=>t.breached).length+' breaches in the period'})+
    metric({icon:'ai',label:'Deflected by the assistant',value:'34%',foot:'Of conversations that would otherwise open a ticket'})+
  '</div>'+
  panel(null, dt('dtTickets',{
    rows:TICKETS, noun:'tickets', pageSize:12, sortKey:'id', sortDir:'desc', onRow:"openTicket('$ID')",
    searchFields:['id','subject','openedBy','teamName','owner'], searchPlaceholder:'Search ticket, subject or requester',
    chips:[{key:'status',options:[{label:'Open',value:'open'},{label:'In progress',value:'inprogress'},
      {label:'Pending',value:'pending'},{label:'Resolved',value:'resolved'}]},
      {key:'severity',options:[{label:'P1',value:'P1'},{label:'P2',value:'P2'},{label:'P3',value:'P3'},{label:'P4',value:'P4'}]}],
    actions:exportBtn('Ticket history'),
    columns:[
      {key:'id',label:'Ticket',render:r=>'<div class="cellmain t-num">'+esc(r.id)+'</div><div class="cellsub">'+esc(r.opened)+'</div>'},
      {key:'subject',label:'Subject',render:r=>'<div class="cellmain">'+esc(r.subject)+'</div><div class="cellsub">'+esc(r.channel)+'</div>'},
      {key:'severity',label:'Severity',render:r=>sevPill(r.severity)},
      {key:'openedBy',label:'Raised by',render:r=>esc(r.openedBy)+'<div class="cellsub">'+esc(r.teamName)+'</div>'},
      {key:'owner',label:'Owner',render:r=>'<span class="t-small">'+esc(r.owner)+'</span>'},
      {key:'resolutionMins',label:'Resolved in',align:'right',render:r=>r.resolutionMins==null?'<span class="dim">Open</span>'
        :'<span class="t-num'+(r.breached?'" style="color:var(--nim-danger-fg)':'')+'">'+FMT.mins(r.resolutionMins)+'</span>'},
      {key:'status',label:'Status',render:r=>'<div class="row" style="gap:5px">'+statusPill(r.status)+(r.escalated?pill('warning','Esc'):'')+'</div>'},
      {key:'__acts',label:'',sort:false,render:r=>'<button class="btn btn-sm btn-quiet" onclick="event.stopPropagation();openTicket(\''+r.id+'\')">Open</button>'}
    ]}),{flush:true})+
  '</div>';
}
function raiseTicket(){
  openModal('<div class="modal-head">'+ICO('support',18)+'<div class="grow"><h3 class="t-sub">Raise a ticket</h3>'+
    '<div class="t-small muted">Severity drives the SLA target and the routing queue at '+esc(OPERATOR.name)+'.</div></div>'+
    '<button class="iconbtn" onclick="closeModal()" aria-label="Close">'+ICO('x',16)+'</button></div>'+
    '<div class="modal-body stack">'+
      banner('info','Before you continue: the assistant resolves about a third of these without a ticket. <button class="linkbtn" onclick="closeModal();AI.open()">Try the assistant</button>')+
      '<div class="field"><label for="tkSubj">Subject</label><input class="inp" id="tkSubj" placeholder="Describe the problem in one line" data-autofocus></div>'+
      '<div class="grid g2">'+
        '<div class="field"><label for="tkSev">Severity</label><select class="inp" id="tkSev">'+
          '<option>P1 — service down for a site or many users (4 h)</option>'+
          '<option selected>P2 — degraded, workaround exists (8 h)</option>'+
          '<option>P3 — single user or line affected (1 day)</option>'+
          '<option>P4 — question or change request (2 days)</option></select></div>'+
        '<div class="field"><label for="tkArea">Affected service</label><select class="inp" id="tkArea">'+
          '<option>Mobile line</option><option>SD-WAN site</option><option>MPLS circuit</option><option>Billing or invoice</option><option>Self-care access</option></select></div>'+
      '</div>'+
      '<div class="field"><label for="tkDet">Detail</label><textarea class="inp" id="tkDet" placeholder="What happened, when it started, what you have already tried"></textarea></div>'+
      '<label class="checkline"><input type="checkbox"> Escalate immediately to Tier 2 (P1 and P2 only)</label>'+
    '</div>'+
    '<div class="modal-foot"><span class="t-tiny muted grow">Attach diagnostics after the ticket is created.</span>'+
    '<button class="btn btn-quiet" onclick="closeModal()">Cancel</button>'+
    '<button class="btn btn-primary" onclick="closeModal();toast(\'Ticket TCK-59223 raised — P2, target 8 h\')">Raise ticket</button></div>',
    {wide:true,label:'Raise a ticket'});
}

/* -------------------- 16. Notifications and alert rules ------------------ */
function vAlerts(){
  const rules=[
    {id:'AR-01', name:'Pooled data threshold', trigger:'Any pool passes 80% and again at 90%', to:'Enterprise admins, team leaders', ch:'Email, in-app', on:true, fired:'1 h ago'},
    {id:'AR-02', name:'Line over allowance', trigger:'A line exceeds 100% of its own allowance', to:'The user and their team leader', ch:'In-app', on:true, fired:'Today 06:22'},
    {id:'AR-03', name:'Invoice due', trigger:'3 days before the due date, and on the due date', to:'Billing contacts', ch:'Email', on:true, fired:'3 d ago'},
    {id:'AR-04', name:'Invoice overdue', trigger:'Any invoice passes its due date', to:'Billing contacts, enterprise admins', ch:'Email, SMS', on:true, fired:'3 h ago'},
    {id:'AR-05', name:'Site down', trigger:'Any SD-WAN or MPLS site becomes unreachable', to:'Enterprise admins, IT team', ch:'Email, SMS, in-app', on:true, fired:'12 min ago'},
    {id:'AR-06', name:'Latency above SLA', trigger:'Latency exceeds the contracted target for 30 minutes', to:'IT team', ch:'In-app', on:true, fired:'Yesterday'},
    {id:'AR-07', name:'Roaming spend', trigger:'Roaming charges pass '+CUR(500)+' in a cycle', to:'Enterprise admins', ch:'Email', on:false, fired:'Never'},
    {id:'AR-08', name:'Dormant line', trigger:'A line records no usage for 60 days', to:'Enterprise admins', ch:'Email', on:false, fired:'Never'},
    {id:'AR-09', name:'Planned maintenance', trigger:'Operator publishes a maintenance window', to:'Enterprise admins, IT team', ch:'Email, in-app', on:true, fired:'2 d ago'}
  ];
  return pagehead('Notifications and alerts',
    rules.filter(r=>r.on).length+' of '+rules.length+' rules are active. Alerts are scoped so team leaders only receive what concerns their own team.',
    '<button class="btn" onclick="App.notifications()">'+ICO('bell',13)+'Recent alerts</button>'+
    '<button class="btn btn-primary" onclick="toast(\'Alert rule builder opened\')">'+ICO('plus',14)+'New rule</button>')+
  '<div class="stack">'+
  panel('Alert rules', dt('dtRules',{
    rows:rules, noun:'rules', pageSize:10, toolbar:false, sortKey:'id',
    columns:[
      {key:'name',label:'Rule',render:r=>'<div class="cellmain">'+esc(r.name)+'</div><div class="cellsub">'+esc(r.id)+'</div>'},
      {key:'trigger',label:'Trigger',render:r=>'<span class="t-small">'+esc(r.trigger)+'</span>'},
      {key:'to',label:'Recipients',render:r=>'<span class="t-small">'+esc(r.to)+'</span>'},
      {key:'ch',label:'Channels',render:r=>'<div class="tagset">'+r.ch.split(', ').map(c=>'<span class="tag">'+esc(c)+'</span>').join('')+'</div>'},
      {key:'fired',label:'Last fired',render:r=>r.fired==='Never'?'<span class="dim">Never</span>':esc(r.fired)},
      {key:'on',label:'State',render:r=>'<label class="toggle"><input type="checkbox" '+(r.on?'checked':'')+
        ' onchange="toast(\''+esc(r.name)+' \'+(this.checked?\'enabled\':\'disabled\'))"><span class="track"></span>'+
        '<span class="sr-only">'+esc(r.name)+'</span></label>'}
    ]}),{flush:true,icon:'bell'})+
  '<div class="grid g2">'+
    panel('Delivery preferences',
      '<div class="stack" style="gap:11px">'+
      '<div class="field"><label for="alDigest">Digest instead of individual emails</label><select class="inp" id="alDigest">'+
        '<option>Off — send every alert</option><option selected>Daily digest at 08:00 CET</option><option>Weekly digest, Monday 08:00</option></select></div>'+
      '<div class="field"><label for="alQuiet">Quiet hours</label><select class="inp" id="alQuiet">'+
        '<option>None</option><option selected>22:00–07:00 except P1</option><option>22:00–07:00 including P1</option></select>'+
        '<div class="hint">Site-down alerts always bypass quiet hours.</div></div>'+
      '<label class="checkline"><input type="checkbox" checked> Send a weekly usage summary to team leaders</label>'+
      '<label class="checkline"><input type="checkbox" checked> Notify me when the AI assistant acts on an approval</label>'+
      '</div><div class="divider"></div>'+
      '<div class="row"><span class="t-tiny muted grow">Applies to your identity only.</span>'+
      '<button class="btn btn-primary" onclick="toast(\'Preferences saved\')">Save</button></div>',{icon:'settings'})+
    panel('Threshold tuning',
      '<div class="stack" style="gap:14px">'+
      ['Pooled data — first warning','Pooled data — second warning','Roaming spend per cycle','Line dormancy'].map((l,i)=>
        '<div><div class="row" style="margin-bottom:5px"><span class="t-small grow">'+esc(l)+'</span>'+
        '<span class="t-small strong t-num">'+['80%','90%',CUR(500),'60 days'][i]+'</span></div>'+
        meter([80,90,50,60][i])+'</div>').join('')+
      '</div><div class="divider"></div>'+
      '<div class="t-tiny muted">Thresholds are per account. Team leaders can tighten but never loosen them for their own team.</div>',{icon:'gauge'})+
  '</div>'+
  '</div>';
}

/* -------------------------- 17. Reports and analytics -------------------- */
function vReports(){
  const saved=[
    {id:'RP-01', name:'Monthly usage by cost centre', last:'01 Jul 2026', sched:'Monthly, 1st 07:00', to:'finance@gmail.com', fmt:'CSV + PDF'},
    {id:'RP-02', name:'Lines over allowance', last:'22 Jul 2026', sched:'Weekly, Monday', to:'a.visser@gmail.com', fmt:'CSV'},
    {id:'RP-03', name:'Service availability by site', last:'01 Jul 2026', sched:'Monthly, 1st', to:'it-ops@6dtech.co.in', fmt:'PDF'},
    {id:'RP-04', name:'Ticket SLA performance', last:'01 Jul 2026', sched:'Monthly, 1st', to:'a.visser@gmail.com', fmt:'CSV + PDF'},
    {id:'RP-05', name:'Dormant line review', last:'Never run', sched:'Not scheduled', to:'—', fmt:'CSV'}
  ];
  return pagehead('Reports and analytics',
    'Build a view, then export it or put it on a schedule. Scheduled reports run in the account time zone (CET).',
    exportBtn('Current view')+scheduleBtn()+
    '<button class="btn btn-primary" onclick="toast(\'Report builder opened\')">'+ICO('plus',14)+'Build report</button>')+
  '<div class="stack">'+
  '<div class="grid g2">'+
    panel('Spend against budget, 12 cycles',
      CH.line([{pts:SPEND},{pts:BUDGET}],{fmt:n=>CUR0(n),tip:n=>CUR(n),aria:'Spend against budget'})+
      '<div class="legend"><span><i style="background:#0099FF"></i>Invoiced</span><span><span class="dash"></span>Budget</span></div>',{icon:'chart'})+
    panel('Ticket volume by severity',
      CH.bars(['P1','P2','P3','P4'].map(s=>({l:s,v:TICKETS.filter(t=>t.severity===s).length})),
        {h:180,fmt:n=>Math.round(n),tip:n=>n+' tickets',aria:'Ticket volume by severity'}),{icon:'support'})+
  '</div>'+
  '<div class="grid g2">'+
    panel('Data consumption by team',
      CH.bars(TEAMS.map(t=>({l:t.name.split(' ')[0],v:t.dataUsedGb})),
        {h:180,fmt:n=>Math.round(n)+' GB',tip:n=>FMT.gb(n),aria:'Data consumption by team'}),{icon:'group'})+
    panel('Availability by site type',
      '<div class="stack" style="gap:14px">'+
      [['SD-WAN sites',SITES.filter(s=>s.type==='SD-WAN')],['MPLS circuits',SITES.filter(s=>s.type==='MPLS')]].map(([lbl,set])=>{
        const avg=set.reduce((a,s)=>a+s.uptime30,0)/set.length;
        return '<div><div class="row" style="margin-bottom:5px"><span class="t-small grow">'+esc(lbl)+' ('+set.length+')</span>'+
          '<span class="t-small strong t-num">'+FMT.dec(avg,2)+'%</span></div>'+meter(avg,'Contracted floor 99.5%')+'</div>';
      }).join('')+
      '<div><div class="row" style="margin-bottom:5px"><span class="t-small grow">Sites without telemetry</span>'+
      '<span class="t-small strong">'+SITE_NOTEL.length+'</span></div>'+
      meter(null,null,{naLabel:'Not measured'})+'</div>'+
      '</div>',{icon:'gauge'})+
  '</div>'+
  panel('Saved and scheduled reports', dt('dtReports',{
    rows:saved, noun:'reports', pageSize:8, toolbar:false, sortKey:'id',
    columns:[
      {key:'name',label:'Report',render:r=>'<div class="cellmain">'+esc(r.name)+'</div><div class="cellsub">'+esc(r.id)+'</div>'},
      {key:'sched',label:'Schedule',render:r=>r.sched==='Not scheduled'?'<span class="dim">Not scheduled</span>':esc(r.sched)},
      {key:'to',label:'Delivered to',render:r=>r.to==='—'?'<span class="dim">—</span>':'<span class="t-small">'+esc(r.to)+'</span>'},
      {key:'fmt',label:'Format',render:r=>'<div class="tagset">'+r.fmt.split(' + ').map(f=>'<span class="tag">'+esc(f)+'</span>').join('')+'</div>'},
      {key:'last',label:'Last run',render:r=>r.last==='Never run'?'<span class="nodata">Never run</span>':esc(r.last)},
      {key:'__acts',label:'',sort:false,render:r=>'<button class="btn btn-sm btn-quiet" onclick="toast(\''+esc(r.name)+' is running\')">Run now</button>'+
        '<button class="btn btn-sm btn-quiet" onclick="openSchedule()">Schedule</button>'}
    ]}),{flush:true,icon:'calendar'})+
  '</div>';
}

/* --------------------- 18. Company profile and settings ------------------ */
function vProfile(){
  return pagehead('Company profile',
    esc(ENT.legal)+' · account '+esc(ENT.id)+' · customer since '+esc(ENT.since),
    '<button class="btn" onclick="toast(\'Change request sent to your account manager\')">Request a change</button>'+
    '<button class="btn btn-primary" onclick="toast(\'Profile saved\')">Save changes</button>')+
  '<div class="stack">'+
  banner('info','Commercial terms — contract, pricing, discounts and renewal — are managed by '+esc(OPERATOR.name)+' in their enterprise CRM, not here. This screen covers the operational details you control yourself.')+
  '<div class="grid g2">'+
    panel('Company details',
      '<div class="grid g2">'+
        '<div class="field"><label for="cpName">Legal entity</label><input class="inp" id="cpName" value="'+esc(ENT.legal)+'" disabled>'+
        '<div class="hint">Locked. Changing the legal entity requires a contract amendment.</div></div>'+
        '<div class="field"><label for="cpTrade">Trading name</label><input class="inp" id="cpTrade" value="'+esc(ENT.name)+'"></div>'+
        '<div class="field"><label for="cpVat">VAT number</label><input class="inp" id="cpVat" value="'+esc(ENT.vat)+'" disabled></div>'+
        '<div class="field"><label for="cpSeg">Segment</label><input class="inp" id="cpSeg" value="'+esc(ENT.segment)+'" disabled></div>'+
      '</div><div class="divider"></div>'+
      '<div class="field"><label for="cpHq">Registered address</label><textarea class="inp" id="cpHq">Wilhelminakade 179\n3072 AP '+esc(ENT.hq)+'</textarea></div>',
      {icon:'building'})+
    panel('Contacts and preferences',
      '<div class="grid g2">'+
        '<div class="field"><label for="cpPrim">Primary contact</label><input class="inp" id="cpPrim" value="'+esc(ENT.primaryContact)+'"></div>'+
        '<div class="field"><label for="cpBill">Billing contact</label><input class="inp" id="cpBill" value="finance@gmail.com"></div>'+
        '<div class="field"><label for="cpTech">Technical contact</label><input class="inp" id="cpTech" value="it-ops@6dtech.co.in"></div>'+
        '<div class="field"><label for="cpTz">Time zone</label><select class="inp" id="cpTz"><option selected>Europe/Amsterdam (CET)</option><option>Europe/London</option><option>UTC</option></select></div>'+
        '<div class="field"><label for="cpLang">Language</label><select class="inp" id="cpLang"><option selected>English</option></select>'+
        '<div class="hint">Additional languages arrive with the multi-region rollout.</div></div>'+
        '<div class="field"><label for="cpCur">Billing currency</label><input class="inp" id="cpCur" value="EUR (€)" disabled></div>'+
      '</div>'+
      '<div class="divider"></div>'+
      '<div class="t-label" style="margin-bottom:7px">Brand accent for this account</div>'+
      '<div class="swatches" role="group" aria-label="Brand accent">'+
        ['#0099FF','#0578BE','#00676B','#5E4B9B','#146C43'].map((c,i)=>
        '<button class="swatch" style="background:'+c+'" aria-pressed="'+(i===0)+'" aria-label="Accent '+(i+1)+'" '+
        'onclick="$$(\'.swatch\').forEach(function(s){s.setAttribute(\'aria-pressed\',\'false\')});this.setAttribute(\'aria-pressed\',\'true\');toast(\'Accent applied to this account\')"></button>').join('')+
      '</div>',
      {icon:'user'})+
  '</div>'+
  '<div class="grid g2">'+
    panel('Contract and service reference',
      '<dl class="deflist">'+
        '<dt>Master agreement</dt><dd class="t-num">'+esc(ENT.contractRef)+'</dd>'+
        '<dt>Term ends</dt><dd>'+esc(ENT.contractEnds)+'</dd>'+
        '<dt>Billing cycle</dt><dd>'+esc(ENT.billingCycle)+'</dd>'+
        '<dt>Payment terms</dt><dd>'+esc(ENT.paymentTerms)+'</dd>'+
        '<dt>Account tier</dt><dd>'+pill('info',ENT.tier)+'</dd>'+
        '<dt>Account manager</dt><dd>'+esc(ENT.csm)+' · '+esc(OPERATOR.name)+'</dd>'+
        '<dt>Commercial terms</dt><dd><span class="nodata">Held in the operator CRM</span></dd>'+
      '</dl>',{icon:'file'})+
    panel('Data and compliance',
      '<div class="stack" style="gap:11px">'+
      '<div class="field"><label for="cpRes">Data residency</label><select class="inp" id="cpRes"><option selected>European Union — Frankfurt and Amsterdam</option><option>United Kingdom</option></select>'+
      '<div class="hint">Residency is fixed per region and cannot be changed without a migration.</div></div>'+
      '<div class="field"><label for="cpRet">Usage record retention</label><select class="inp" id="cpRet"><option>6 months</option><option selected>12 months</option><option>24 months</option></select>'+
      '<div class="hint">Records outside the window are purged, which is why Aug 2025 shows a gap rather than a value.</div></div>'+
      '<label class="checkline"><input type="checkbox" checked> Pseudonymise user identifiers in exported reports</label>'+
      '<label class="checkline"><input type="checkbox" checked> Require an audit reason when viewing another user\'s usage detail</label>'+
      '</div><div class="divider"></div>'+
      '<div class="row wrap" style="gap:6px"><span class="tag">GDPR</span><span class="tag">ISO/IEC 27001</span><span class="tag">SOC 2 Type II</span><span class="tag">eIDAS</span></div>',
      {icon:'lock'})+
  '</div>'+
  '</div>';
}

/* ------------------------------- 19. Audit log --------------------------- */
function vAudit(){
  const rows=AUDIT.map((a,i)=>Object.assign({id:'AU-'+(9000+i)},a));
  return pagehead('Audit log',
    'Every change to users, services, billing and settings, including actions taken by the operator in their self-care view and by the AI assistant.',
    exportBtn('Audit log')+
    '<button class="btn" onclick="toast(\'Retention: 24 months, immutable\')">'+ICO('lock',13)+'Retention</button>')+
  '<div class="stack">'+
  banner('info','Entries are immutable and retained for 24 months. Operator actions carry an <strong>Operator</strong> marker so you can tell them apart from your own team\'s changes.')+
  panel(null, dt('dtAudit',{
    rows:rows, noun:'entries', pageSize:12, sortKey:'when',
    searchFields:['who','what','role','when'], searchPlaceholder:'Search actor or action',
    chips:[{key:'kind',options:[{label:'Changes',value:'primary'},{label:'Destructive',value:'danger'},{label:'Approvals',value:'success'}]}],
    columns:[
      {key:'when',label:'When',width:'150px',render:r=>'<span class="cellmain">'+esc(r.when)+'</span>'},
      {key:'who',label:'Actor',render:r=>'<div class="cellmain">'+esc(r.who)+'</div><div class="cellsub">'+esc(r.role)+'</div>'},
      {key:'what',label:'Action',render:r=>esc(r.what)},
      {key:'kind',label:'Type',render:r=>r.kind==='danger'?pill('danger','Destructive'):r.kind==='success'?pill('approved'):pill('info','Change')},
      {key:'ip',label:'Source',render:r=>r.ip==='operator'?pill('partial','Operator'):r.ip==='—'?'<span class="dim">System</span>':'<span class="t-num t-small">'+esc(r.ip)+'</span>'}
    ]}),{flush:true,icon:'history'})+
  '</div>';
}

/* ------------------------------- registration ---------------------------- */
const VIEWS={
  dashboard:vDashboard, users:vUsers, roles:vRoles, teams:vTeams, lines:vLines, sims:vSims,
  network:vNetwork, plans:vPlans, pools:vPools, usage:vUsage, invoices:vInvoices, payments:vPayments,
  chargeback:vChargeback, orders:vOrders, tickets:vTickets, alerts:vAlerts, reports:vReports,
  profile:vProfile, audit:vAudit
};

App.init({
  product:'Enterprise Self-Care', tier:'6D ONE UI · '+OPERATOR.brand,
  env:'Production · EU-West',
  persona:{name:'Anneke Visser', role:'Enterprise admin', org:ENT.name},
  searchScope:ENT.name, alertCount:3, notifications:NOTIFS,
  footNote:ENT.id+' · '+ENT.tier+' account',
  aiName:'AARYA assistant',
  aiGreeting:'I can answer questions about usage, billing, services and tickets for <strong>'+esc(ENT.name)+'</strong>. I only act on your account after you approve the action.'+
    '<div class="src">Sources: usage records, billing records, service inventory, ticket history.</div>',
  aiSuggestions:['Why is the field operations pool running out?','Which lines are over their allowance?','What is on the overdue invoice?','Show me sites without telemetry'],
  nav:[
    {label:'Overview', items:[{id:'dashboard', label:'Dashboard', icon:'dashboard'}]},
    {label:'Users and access', items:[
      {id:'users', label:'Users', icon:'users', count:KPI.users},
      {id:'roles', label:'Roles and access', icon:'shield'},
      {id:'teams', label:'Teams', icon:'group', count:TEAMS.length}]},
    {label:'Services', items:[
      {id:'lines', label:'Mobile lines', icon:'smartphone', count:KPI.lines},
      {id:'sims', label:'SIM and eSIM', icon:'sim'},
      {id:'network', label:'Connectivity', icon:'network', count:KPI.sites},
      {id:'plans', label:'Plans and add-ons', icon:'package'},
      {id:'pools', label:'Shared data pools', icon:'database'}]},
    {label:'Usage and spend', items:[
      {id:'usage', label:'Usage', icon:'activity'},
      {id:'chargeback', label:'Cost allocation', icon:'pie'},
      {id:'reports', label:'Reports', icon:'chart'}]},
    {label:'Billing', items:[
      {id:'invoices', label:'Invoices', icon:'invoice', count:INV_OPEN.length},
      {id:'payments', label:'Payments', icon:'wallet'}]},
    {label:'Operations', items:[
      {id:'orders', label:'Orders and requests', icon:'orders', count:KPI.pendingOrders},
      {id:'tickets', label:'Support', icon:'support', count:KPI.openTickets}]},
    {label:'Account', items:[
      {id:'alerts', label:'Notifications', icon:'bell'},
      {id:'profile', label:'Company profile', icon:'building'},
      {id:'audit', label:'Audit log', icon:'history'}]}
  ],
  searchIndex:[
    {k:'Screen',t:'Dashboard and AI insights',v:'dashboard'},{k:'Screen',t:'Users',v:'users'},
    {k:'Screen',t:'Roles and access control',v:'roles'},{k:'Screen',t:'Teams',v:'teams'},
    {k:'Screen',t:'Mobile lines',v:'lines'},{k:'Screen',t:'SIM and eSIM management',v:'sims'},
    {k:'Screen',t:'SD-WAN and MPLS connectivity',v:'network'},{k:'Screen',t:'Plans and add-ons',v:'plans'},
    {k:'Screen',t:'Shared data pools',v:'pools'},{k:'Screen',t:'Usage monitoring',v:'usage'},
    {k:'Screen',t:'Invoices and billing',v:'invoices'},{k:'Screen',t:'Payments and methods',v:'payments'},
    {k:'Screen',t:'Cost allocation and chargeback',v:'chargeback'},{k:'Screen',t:'Orders and requests',v:'orders'},
    {k:'Screen',t:'Support and ticketing',v:'tickets'},{k:'Screen',t:'Notifications and alerts',v:'alerts'},
    {k:'Screen',t:'Reports and analytics',v:'reports'},{k:'Screen',t:'Company profile',v:'profile'},
    {k:'Screen',t:'Audit log',v:'audit'},
    {k:'Site',t:'Duisburg DC — SDW-105 (down)',v:'network'},{k:'Pool',t:'Field operations pool (94%)',v:'pools'},
    {k:'Invoice',t:INVOICES[1].id+' — overdue',v:'invoices'},{k:'User',t:'Anneke Visser',v:'users'}
  ],
  aiAnswer(q){
    if(/pool|allowance|running out|exhaust/.test(q))
      return 'The <strong>field operations pool</strong> is at '+FMT.pct(POOLS[0].pct)+' — '+FMT.gb(POOLS[0].usedGb)+' of '+FMT.gb(POOLS[0].allowGb)+' on day 22 of 31.'+
        '<table><tr><th>Driver</th><th>Share</th></tr><tr><td>Depot survey week (14–19 Jul)</td><td>38%</td></tr>'+
        '<tr><td>Tethering on rugged devices</td><td>24%</td></tr><tr><td>Normal baseline</td><td>38%</td></tr></table>'+
        'Two 256 GB top-ups cost '+CUR(76)+' against roughly '+CUR(214)+' of out-of-bundle charges if you leave it. Shall I queue them for your approval?'+
        '<div class="src">Sources: pooled usage records, plan catalogue, out-of-bundle rate card.</div>';
    if(/over.*(allowance|limit)|overage/.test(q)){
      const o=USERS.filter(u=>u.dataAllowGb&&u.dataUsedGb>u.dataAllowGb).slice(0,5);
      return o.length+' lines are over their own allowance this cycle.'+
        '<table><tr><th>User</th><th>Used</th><th>Allowance</th></tr>'+o.map(u=>'<tr><td>'+esc(u.name)+'</td><td>'+FMT.gb(u.dataUsedGb)+'</td><td>'+u.dataAllowGb+' GB</td></tr>').join('')+'</table>'+
        'Out-of-bundle charges so far are '+CUR(486.20)+'.<div class="src">Sources: per-line usage records, rate card.</div>';
    }
    if(/overdue|invoice|bill|pay/.test(q))
      return 'Invoice <strong>'+INVOICES[1].id+'</strong> for '+esc(INVOICES[1].period)+' is 4 days overdue at '+CUR(INVOICES[1].amount)+'.'+
        '<table><tr><th>Component</th><th>Amount</th></tr><tr><td>Recurring</td><td>'+CUR(INVOICES[1].recurring)+'</td></tr>'+
        '<tr><td>Usage and overage</td><td>'+CUR(INVOICES[1].usage)+'</td></tr><tr><td>One-off</td><td>'+CUR(INVOICES[1].oneoff)+'</td></tr>'+
        '<tr><td>VAT</td><td>'+CUR(INVOICES[1].tax)+'</td></tr></table>'+
        'Late-payment terms under '+esc(ENT.contractRef)+' begin at day 7.<div class="src">Sources: billing records, master agreement metadata.</div>';
    if(/telemetry|not measured|unavailable|missing/.test(q))
      return 'Two sites have not reported since 18 Jul: <strong>Porto depot</strong> and <strong>Ghent depot</strong>. Their utilisation, latency and loss are shown as <em>not measured</em> — I will not estimate them. '+
        'The consequence is that '+CUR(1840)+' of roaming charges sits unattributed in cost allocation.'+
        '<div class="src">Sources: service inventory, telemetry ingest log, chargeback ledger.</div>';
    if(/down|outage|duisburg|site/.test(q))
      return '<strong>Duisburg DC (SDW-105)</strong> has been down for 12 minutes. Operator incident INC-88214 is open at Tier 2. Three depots are failing over to Cologne with about 18 ms of added latency. '+
        'This is the second failure in 30 days on the same carrier tail.<div class="src">Sources: service health, incident feed, 30-day event history.</div>';
    if(/save|cost|reduce|optimi/.test(q))
      return 'Two savings are supported by evidence: right-sizing 31 under-used lines ('+CUR(31*7.6)+'/month) and cancelling 6 dormant device-management seats ('+CUR(16.80)+'/month). '+
        'A third — consolidating the Antwerp and Ghent circuits — I cannot quantify because Ghent has no telemetry.'+
        '<div class="src">Sources: three cycles of per-line usage, add-on ledger, service inventory.</div>';
    return null;
  }
});
