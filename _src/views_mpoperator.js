/* ===========================================================================
   PERSONA: Marketplace operator — the platform side.
   Partner onboarding governance, catalogue governance, commission and
   settlement plan design, settlement runs, order operations, disputes.
   6D-branded operator console.
   =========================================================================== */

const OPS = {name:'Ananya Krishnan', role:'Marketplace operations', org:MP.operator};
function BEFORE_RENDER(){ recomputeDerived(); }
/* A filter handed over from another screen is applied after the table has
   rendered, then cleared so it does not stick to the next visit. */
function AFTER_RENDER(){
  if(!PENDING_FILTER) return;
  const f=PENDING_FILTER; PENDING_FILTER=null;
  const t=DataTable.reg[f.table];
  if(!t) return;
  t.filters={}; t.setFilter(f.key,f.value);
  const label = f.key==='__v'||f.key==='v'||f.key==='vertical' ? vName(f.value) : f.value;
  toast('Showing '+esc(label)+' only — clear the filter to see everything');
}

const O_INSIGHTS=[
  {icon:'route', conf:'High confidence', src:'Read: 12 onboarding applications, gate timestamps, ONB_STATE',
   title:'Onboarding stalls at the finance gate, not at KYC',
   body:'Across the last twelve applications, the <strong>Bank &amp; tax</strong> gate accounts for the majority of elapsed time — micro-deposit verification plus chasing tax residency certificates. '+
        'KYC, the gate everyone assumes is slowest, clears in about two days.',
   acts:'<button class="btn btn-sm btn-primary" onclick="App.go(\'onboardq\')">Open the queue</button>'+
        '<button class="btn btn-sm" onclick="toast(\'Instant bank verification evaluation started\')">Evaluate instant verification</button>'},
  {icon:'warning', conf:'High confidence', src:'Read: listing queue, marketplace policy 7.4, target market list',
   title:'One listing in the queue breaches policy 7.4',
   body:'PlayForge Loot Crate offers randomised paid rewards, which is prohibited in two of the markets it targets. Approving it as submitted would expose the marketplace, not just the partner.',
   acts:'<button class="btn btn-sm btn-primary" onclick="App.go(\'catalogue\')">Review the listing</button>'},
  {icon:'wallet', conf:'Medium confidence', src:'Read: 2,600 orders, 8 commission plans, tier history',
   title:'Take rate is drifting down as partners cross tiers',
   body:'Blended take rate is <strong>'+TAKE_RATE+'%</strong>. Two partners crossed into lower commission tiers this quarter, which is the plan working as designed — but it means volume growth has to outpace the tier step to hold revenue flat.',
   acts:'<button class="btn btn-sm" onclick="App.go(\'plans\')">Review plans</button>'},
  {icon:'eyeoff', conf:'Low confidence — partial evidence', src:'Read: order channel field on partner-storefront orders — 21% null',
   title:'Attribution is incomplete for partner-storefront orders',
   body:'Orders placed through reseller storefronts carry the reseller as the channel but not always the originating campaign. Roughly a fifth of partner-channel GMV cannot be attributed to a source, and is reported as <strong>unattributed</strong> rather than assigned by inference.',
   acts:'<button class="btn btn-sm" onclick="App.go(\'verticals\')">Open marketplace categories</button>'}
];

/* ------------------------------ 1. Overview ------------------------------- */
function vOHome(){
  return pagehead('Marketplace overview',
    esc(MP.operator)+' · '+esc(MP.region)+' · '+PARTNERS.length+' partners across '+VERTICALS.length+' marketplaces · '+esc(MP.since),
    periodTabs()+
    exportBtn('Marketplace overview','opsOverview'))+
  '<div class="stack">'+

  banner('warning','<strong>'+LISTING_QUEUE.length+' listings and '+PARTNERS.filter(p=>['onboarding','review'].includes(p.status)).length+
    ' partner applications are waiting on you.</strong> One listing breaches content policy and one application failed KYC. '+
    '<button class="linkbtn" onclick="App.go(\'catalogue\')">Catalogue queue</button> · '+
    '<button class="linkbtn" onclick="App.go(\'onboardq\')">Onboarding queue</button>')+

  periodNote()+
  '<div class="grid g4">'+
    (function(){
      const t=periodTotals();
      return metric({icon:'wallet',label:'Gross merchandise value',value:CUR0(t.gross),
        foot:periodFoot(HISTORY,'gross',FMT.num(t.orders)+' orders')})+
      metric({icon:'pie',label:'Marketplace revenue',value:CUR0(t.commission),
        foot:'Blended take rate '+(t.gross?(t.commission/t.gross*100).toFixed(1):'0')+'%'});
    })()+
    metric({icon:'group',label:'Live partners',value:String(LIVE_PARTNERS.length),
      foot:PARTNERS.filter(p=>['onboarding','review'].includes(p.status)).length+' onboarding · '+PARTNERS.filter(p=>p.status==='suspended').length+' suspended'})+
    metric({icon:'invoice',label:'Payouts due',value:CUR0(PAYOUT_DUE),foot:SET_PENDING.length+' statements awaiting approval'})+
  '</div>'+

  panel('Marketplace categories', verticalTiles('App.go(\'verticals\')'),
    {icon:'dashboard', sub:'One platform, one settlement engine, six commercial propositions'})+

  panel('Gross value by month',
    periodChart(HISTORY)+
    '<div class="divider"></div>'+
    '<div class="row wrap" style="gap:20px">'+
      (function(){
        const t=periodTotals();
        const avg=t.months?+(t.gross/t.months).toFixed(0):0;
        const best=periodSlice(HISTORY).slice().sort((a,b)=>b.gross-a.gross)[0];
        return '<div><div class="t-tiny muted">Average month</div>'+
          '<div class="t-sub t-num">'+CUR0(avg)+'</div></div>'+
        '<div><div class="t-tiny muted">Best month</div>'+
          '<div class="t-sub t-num">'+CUR0(best.gross)+'</div>'+
          '<div class="t-tiny muted">'+esc(best.month)+'</div></div>'+
        '<div><div class="t-tiny muted">Orders</div>'+
          '<div class="t-sub t-num">'+FMT.num(t.orders)+'</div></div>'+
        '<div class="grow"></div>'+
        '<div style="max-width:340px"><div class="t-tiny muted">Where the numbers come from</div>'+
          '<div class="t-small">'+(t.aggregated
            ? t.aggregated+' months are monthly aggregates; the most recent 3 are computed from the '+
              FMT.num(ORDERS.length)+' orders held at line level.'
            : 'All '+t.months+' months are computed from orders held at line level.')+'</div></div>';
      })()+
    '</div>',
    {icon:'chart', sub:'The two views reconcile: the last three months of the 12-month series sum exactly to the 90-day figure.'})+

  '<div class="grid g-2-1">'+
    panel('Order count against gross value',
      CH.bars(VERTICALS.map(v=>({l:v.name.split(' ')[0],v:ORDERS.filter(o=>o.v===v.id).length})),
        {h:150,fmt:n=>Math.round(n),tip:n=>n+' orders',aria:'Order count by marketplace'})+
      '<div class="t-tiny muted" style="margin:9px 0 4px">Orders</div>'+
      CH.bars(VERTICALS.map(v=>({l:v.name.split(' ')[0],v:Math.round(GMV_BY_V[v.id])})),
        {h:150,fmt:n=>CUR0(n),tip:n=>CUR(n),aria:'Gross merchandise value by marketplace'})+
      '<div class="t-tiny muted" style="margin-top:4px">Gross value</div>'+
      '<div class="divider"></div>'+
      '<div class="t-small">The two charts invert. <strong>Consumer and digital content</strong> generate '+
      Math.round(ORDERS.filter(o=>o.v==='consumer'||o.v==='content').length/ORDERS.length*100)+'% of orders but '+
      Math.round((GMV_BY_V.consumer+GMV_BY_V.content)/GMV*100)+'% of gross value. '+
      '<strong>IoT, security and devices</strong> are the reverse. That shapes everything downstream — support load follows order count, '+
      'settlement risk follows gross value.</div>',
      {icon:'chart'})+
    panel('Revenue mix',
      CH.donut(VERTICALS.map(v=>({l:v.name.replace(' Marketplace',''),
        v:Math.round(ORDERS.filter(o=>o.v===v.id).reduce((a,o)=>a+o.comm,0))})).filter(x=>x.v>0),
        {centre:CUR0(COMMISSION),centreSub:'commission',fmt:n=>CUR0(n),aria:'Commission by marketplace'}),
      {icon:'pie'})+
  '</div>'+

  forecastPanel({series:HISTORY, title:'Revenue projection',
    label:'Projected gross merchandise value',
    sub:'Whole marketplace. Commission follows GMV at the blended take rate.',
    assumptions:[
      'The partner mix stays as it is. One large seller going live or leaving moves this more than the trend does.',
      'Seasonality is carried from the trailing series — the Q4 uplift is in the numbers, not assumed.',
      'Commission is projected at the current blended take rate of '+TAKE_RATE+'%, which falls as partners cross tiers.',
      '<strong>It excludes anything not yet sold.</strong> A new marketplace category contributes nothing here until it has orders.'
    ]})+

  panel('AI insights', O_INSIGHTS.map(aiInsight).join(''),
    {ai:true, flush:true, icon:'ai',
     sub:'Derived from onboarding, catalogue, order and settlement records. Recommendations need your approval before anything changes.'})+

  '<div class="grid g3">'+
    panel('Onboarding queue',
      '<div class="stack" style="gap:0">'+PARTNERS.filter(p=>['onboarding','review','rejected'].includes(p.status)).map(p=>{
        const st=ONB_STATE[p.id]||{};
        const cleared=Object.values(st).filter(v=>v==='done').length;
        return '<button class="row" style="width:100%;text-align:left;background:none;border:0;cursor:pointer;padding:9px 0;border-bottom:1px solid var(--nim-line-100)" '+
        'onclick="openPartner(\''+p.id+'\')">'+
        '<div class="grow"><div class="t-small strong">'+esc(p.name)+'</div>'+
        '<div class="t-tiny muted">'+esc(p.country)+' · '+cleared+' of '+ONB_STEPS.length+' gates</div></div>'+
        partnerPill(p.status)+'</button>';
      }).join('')+'</div>'+
      '<button class="btn btn-sm btn-quiet" style="margin-top:9px" onclick="App.go(\'onboardq\')">Open queue</button>',
      {icon:'route'})+
    panel('Catalogue queue',
      '<div class="stack" style="gap:0">'+LISTING_QUEUE.slice(0,4).map(l=>
        '<button class="row" style="width:100%;text-align:left;background:none;border:0;cursor:pointer;padding:9px 0;border-bottom:1px solid var(--nim-line-100)" '+
        'onclick="reviewListing(\''+l.id+'\')">'+
        '<div class="grow"><div class="t-small strong">'+esc(l.name)+'</div>'+
        '<div class="t-tiny muted">'+esc(l.partner)+' · '+esc(l.age)+'</div></div>'+
        (l.risk==='high'?pill('down','Policy'):l.risk==='medium'?pill('degraded','Check'):pill('active','Routine'))+'</button>').join('')+'</div>'+
      '<button class="btn btn-sm btn-quiet" style="margin-top:9px" onclick="App.go(\'catalogue\')">Open queue</button>',
      {icon:'checklist'})+
    panel('Exceptions',
      '<div class="stack" style="gap:9px">'+
      [['Failed orders',ORD_FAIL.length,'orderops'],['Open disputes',DISPUTES.filter(d=>d.status!=='resolved').length,'disputes'],
       ['Suspended partners',PARTNERS.filter(p=>p.status==='suspended').length,'partners'],
       ['Statements awaiting approval',SET_PENDING.length,'settlements']].map(r=>
      '<div class="row"><span class="t-small grow">'+esc(r[0])+'</span>'+
      '<span class="t-small strong t-num">'+r[1]+'</span>'+
      '<button class="btn btn-sm btn-quiet" onclick="App.go(\''+r[2]+'\')">Open</button></div>').join('')+
      '</div>',{icon:'alert'})+
  '</div>'+
  '</div>';
}

/* Cross-screen navigation that lands on a filtered view rather than a list the
   person then has to filter themselves. */
let PENDING_FILTER = null;
function goFiltered(view,tableId,key,value){
  PENDING_FILTER = {table:tableId, key:key, value:value};
  App.go(view);
}
function goPartners(vid){ goFiltered('partners','dtPartners','__v',vid); }
function goCatalogue(vid){ goFiltered('catalogue','dtCat','v',vid); }
function goPlans(vid){ goFiltered('plans','dtPlans','vertical',vid); }

/* ---------------------------- 2. The marketplaces ------------------------- */
function vVerticals(){
  return pagehead('Marketplace categories',
    VERTICALS.length+' commercial propositions on one platform. Each has its own catalogue rules, commission plans and audience.',
    exportBtn('Marketplaces','opsOverview')+
    /* Reachable without opening a category first. The rules are shared across
       categories, so burying the only route inside one category's inspector
       made them look category-specific and, to anyone not scrolling, absent. */
    '<button class="btn" onclick="App.go(\'rules\')">'+ICO('checklist',14)+'Listing rules</button>'+
    '<button class="btn btn-primary" onclick="defineMarketplaceDialog()">'+ICO('plus',14)+'Define a marketplace</button>')+
  '<div class="stack">'+
  banner('partial','About a fifth of Partner Marketplace gross value cannot be attributed to an originating campaign. It is reported as <strong>unattributed</strong> rather than inferred, so channel performance for resellers is directionally right but not exact.')+
  VERTICALS.map(v=>{
    const prods=PRODUCTS.filter(p=>p.v===v.id);
    const ords=ORDERS.filter(o=>o.v===v.id);
    const ptrs=PARTNERS.filter(p=>p.verticals.includes(v.id));
    const plans=COMM_PLANS.filter(c=>c.vertical===v.id);
    const comm=ords.reduce((a,o)=>a+o.comm,0);
    return '<section class="panel"><div class="panel-head">'+
      '<span class="vico cat-'+v.id+'" style="width:28px;height:28px;border-radius:6px;display:grid;place-items:center;border:1px solid currentColor">'+ICO(v.icon,15)+'</span>'+
      '<div class="grow"><h2 class="t-section">'+esc(v.name)+'</h2>'+
      '<div class="t-tiny muted">'+esc(v.blurb)+'</div></div>'+
      '<span class="cat cat-'+v.id+'">'+esc(v.aud)+'</span>'+
      (v.enabled?'':pill('paused','Closed to buyers'))+
      '<label class="toggle"><input type="checkbox" '+(v.enabled?'checked':'')+
        ' onchange="toggleMarketplace(\''+v.id+'\',this.checked)">'+
      '<span class="track"></span><span class="sr-only">Open '+esc(v.name)+' to buyers</span></label>'+
      '</div><div class="panel-body">'+
      '<div class="grid g4" style="gap:12px">'+
        metric({label:'Listings',value:prods.filter(p=>p.status==='live').length+' of '+prods.length,foot:prods.filter(p=>p.status==='pending').length+' in review'})+
        metric({label:'Gross value',value:CUR0(GMV_BY_V[v.id]),foot:ords.length+' orders'})+
        metric({label:'Marketplace revenue',value:comm?CUR0(comm):null,naLabel:'First-party only',
          foot:comm?'Take rate '+(comm/GMV_BY_V[v.id]*100).toFixed(1)+'%':'No commission — sold direct'})+
        metric({label:'Partners',value:String(ptrs.length),foot:plans.length+' commission plan'+(plans.length===1?'':'s')})+
      '</div>'+
      '<div class="divider"></div>'+
      '<div class="row wrap" style="gap:8px">'+
        '<span class="t-tiny muted grow">Categories: '+esc(Array.from(new Set(prods.map(p=>p.cat))).join(' · ')||'none yet')+'</span>'+
        '<button class="btn btn-sm btn-quiet" onclick="goPartners(\''+v.id+'\')">'+ICO('group',13)+
          (ptrs.length?ptrs.length+' partner'+(ptrs.length===1?'':'s'):'No partners yet')+'</button>'+
        '<button class="btn btn-sm btn-quiet" onclick="goCatalogue(\''+v.id+'\')">Catalogue</button>'+
        '<button class="btn btn-sm btn-quiet" onclick="goPlans(\''+v.id+'\')">Commission plans</button>'+
        '<button class="btn btn-sm" onclick="openPolicy(\''+v.id+'\')">'+ICO('shield',13)+'Policy</button>'+
      '</div></div></section>';
  }).join('')+
  '</div>';
}

/* -------------------------- 3. Partner onboarding queue ------------------- */
function vOnboardQ(){
  const queue=PARTNERS.filter(p=>['onboarding','review','rejected'].includes(p.status) ||
    (ONB_STATE[p.id] && onbComplete(ONB_STATE[p.id])));
  const funnel=[
    {step:'Application', n:34, days:0.4},
    {step:'KYC & due diligence', n:31, days:2.1},
    {step:'Agreements', n:28, days:3.4},
    {step:'Bank & tax', n:24, days:6.8},
    {step:'Technical readiness', n:21, days:4.2},
    {step:'Compliance review', n:19, days:2.6},
    {step:'Go-live', n:18, days:0.6}
  ];
  return pagehead('Partner onboarding',
    queue.length+' applications in flight · median time to go-live 21 days against a 12-working-day target',
    '<button class="btn" onclick="gatePolicyDialog()">'+ICO('settings',13)+'Gate policy</button>'+
    '<button class="btn" onclick="operatorOnboardDialog()">'+ICO('userplus',13)+'Onboard one yourself</button>'+
    '<button class="btn btn-primary" onclick="invitePartnerDialog()">'+ICO('mail',14)+'Invite a partner</button>')+
  '<div class="stack">'+
  banner('info','Gates are sequential by design: no partner reaches the technical gate before KYC and agreements clear. The order is what keeps a rejected partner from ever touching production.')+
  '<div class="grid g4">'+
    metric({icon:'route',label:'In flight',value:String(queue.length),foot:PARTNERS.filter(p=>p.status==='onboarding').length+' active · '+PARTNERS.filter(p=>p.status==='review').length+' in review'})+
    metric({icon:'clock',label:'Median to go-live',value:'6 working days',foot:'Target 5 working days'})+
    metric({icon:'checkcircle',label:'Completion rate',value:'53%',foot:'18 of 34 applications reached go-live'})+
    metric({icon:'ban',label:'Rejected',value:String(PARTNERS.filter(p=>p.status==='rejected').length),foot:'All at the KYC gate'})+
  '</div>'+
  panel('Where applications stall',
    '<div class="tablewrap"><table class="tbl"><thead><tr><th>Gate</th><th class="num">Reached</th><th class="num">Drop-off</th>'+
    '<th class="num">Median days in gate</th><th style="width:220px">Time in gate</th></tr></thead><tbody>'+
    funnel.map((f,i)=>{
      const prev=i?funnel[i-1].n:f.n;
      const drop=prev-f.n;
      const worst=Math.max.apply(null,funnel.map(x=>x.days));
      return '<tr><td class="cellmain">'+esc(f.step)+'</td><td class="num t-num">'+f.n+'</td>'+
      '<td class="num t-num">'+(drop?SH('minus',11)+drop:'<span class="dim">—</span>')+'</td>'+
      '<td class="num t-num">'+f.days.toFixed(1)+'</td>'+
      '<td>'+meter(f.days/worst*100, f.days.toFixed(1)+' d')+'</td></tr>';
    }).join('')+'</tbody></table></div>',
    {flush:true,icon:'chart',sub:'Bank &amp; tax is the longest gate — micro-deposit verification plus chasing tax certificates'})+
  panel('Applications in flight',
    queue.map(p=>{
      const st=ONB_STATE[p.id]||{};
      const cleared=Object.values(st).filter(v=>v==='done').length;
      const failed=Object.values(st).some(v=>v==='fail');
      return '<div style="padding:13px 12px;border-bottom:1px solid var(--nim-line-100)">'+
        '<div class="row wrap" style="gap:12px;align-items:flex-start;margin-bottom:11px">'+
          '<div class="grow"><div class="row" style="gap:6px">'+partnerPill(p.status)+
            '<span class="tag">'+esc(p.type)+'</span>'+p.verticals.map(vBadge).join('')+'</div>'+
          '<div class="t-sub" style="margin-top:5px">'+esc(p.name)+'</div>'+
          '<div class="t-small muted">'+esc(p.id)+' · '+esc(p.country)+' · contact '+esc(p.contact)+
            (p.email?' &lt;'+esc(p.email)+'&gt;':'')+
            (st.started?' · started '+esc(st.started):'')+'</div>'+
          (p.invited?'<div class="t-tiny muted" style="margin-top:3px">'+ICO('mail',11)+
            ' Invitation sent to '+esc(p.email||p.contact)+' on '+esc(p.invited)+
            ' by '+esc(p.invitedBy||'the onboarding desk')+'</div>':'')+
          '</div>'+
          '<div style="text-align:right;flex:0 0 auto">'+
            '<div class="t-sub t-num">'+cleared+' / '+ONB_STEPS.length+'</div>'+
            '<div class="t-tiny muted">gates cleared</div></div>'+
        '</div>'+
        '<div class="pipe">'+ONB_STEPS.map((s,i)=>{
          const v=st[s.id]||'todo';
          const cls=v==='done'?'done':v==='now'?'now':v==='fail'?'fail':'todo';
          const sub=(ONB_SUBMISSIONS[p.id]||{})[s.id];
          return '<button class="step '+cls+'" onclick="openGate(\''+p.id+'\',\''+s.id+'\')" '+
            'aria-label="Gate '+(i+1)+', '+esc(s.name)+' — '+esc(gateStateName(v))+
            (sub?'. Submitted '+esc(sub.submittedOn):'. Nothing submitted yet')+'">'+
            '<div class="dot" aria-hidden="true">'+(v==='done'?SH('check',11):v==='fail'?SH('bang',11):(i+1))+'</div>'+
            '<div class="lbl">'+esc(s.name)+'</div></button>';
        }).join('')+'</div>'+
        '<div class="t-tiny muted" style="margin-top:-4px;margin-bottom:8px">'+
          'Open any gate to read exactly what was submitted at it.</div>'+
        /* The integration milestone is shown where the decision is made, not
           on a separate screen the person clearing the gate may never open. */
        (st.tech==='now'
          ? '<div style="margin:0 0 10px">'+
              (techReady(p.id)
                ? banner('success','<strong>Integration proved.</strong> All four checks pass, so the technical '+
                    'gate can be cleared.')
                : banner('warning','<strong>Integration not proved yet.</strong> '+
                    TECH_CHECKS.filter(c=>!techStatus(p.id).checks[c.id]).length+' of '+TECH_CHECKS.length+
                    ' checks outstanding. The gate will refuse until they pass.'))+
              '<div class="rowend" style="margin-top:8px">'+
                '<button class="btn btn-sm" onclick="openTechMilestone(\''+p.id+'\')">Integration milestone</button>'+
              '</div></div>'
          : '')+
        '<div class="divider"></div>'+
        '<div class="row wrap">'+
          '<span class="t-tiny muted grow">'+(failed
            ? 'Failed at KYC — beneficial ownership could not be verified against the register.'
            : 'Waiting on the partner. The marketplace has nothing outstanding.')+'</span>'+
          '<button class="btn btn-sm btn-quiet" onclick="openPartner(\''+p.id+'\')">Partner detail</button>'+
          (failed
            ? '<button class="btn btn-sm" onclick="toast(\'Reapplication invited — the partner may submit corrected documents\')">Invite reapplication</button>'
            : onbComplete(st)
            ? '<span class="t-tiny muted">Live — nothing left to clear</span>'
            : (p.invited && (ONB_STATE[p.id]||{}).apply==='now'
                ? '<button class="btn btn-sm" onclick="doResendInvite(\''+p.id+'\')">Resend invitation</button>'
                : '<button class="btn btn-sm" onclick="toast(\'Reminder sent to '+esc(p.contact)+
                  (p.email?' at '+esc(p.email):'')+'\')">Chase</button>')+
              '<button class="btn btn-sm btn-primary" onclick="advanceGate(\''+p.id+'\')">Clear '+
              esc(((onbCurrentGate(st)||{}).name||'gate').toLowerCase())+'</button>')+
        '</div></div>';
    }).join(''),
    {flush:true,icon:'route'})+
  (function(){
    /* Only sellers with an application still running owe anybody anything. A
       partner that went live in 2024 appearing on a chase list is how an
       onboarding desk learns to ignore its own queue. */
    const open=(typeof onbTasksOutstanding==='function')? onbTasksOutstanding() : [];
    return panel('Open onboarding tasks', open.length? dt('dtOnbTasks',{
      rows:open, noun:'tasks', pageSize:8, toolbar:false, sortKey:'status',
      columns:[
        {key:'partner',label:'Partner',render:r=>'<div class="cellmain">'+esc(r.partner||'')+'</div>'+
          '<div class="cellsub t-num">'+esc(r.partnerId)+'</div>'},
        {key:'title',label:'Task',render:r=>'<div class="cellmain">'+esc(r.title)+'</div><div class="cellsub">'+esc(r.detail)+'</div>'},
        {key:'step',label:'Gate',render:r=>'<span class="tag">'+esc((ONB_STEPS.find(s=>s.id===r.step)||{}).name||r.step)+'</span>'},
        {key:'owner',label:'Owner',render:r=>r.owner==='Partner'?pill('inprogress','Partner'):pill('info','Marketplace')},
        {key:'due',label:'Due',render:r=>esc(r.due)},
        {key:'status',label:'State',render:r=>onbTaskPill(r)},
        {key:'__acts',label:'',sort:false,render:r=>'<span class="rowend">'+
          '<button class="btn btn-sm btn-quiet" onclick="openGate(\''+r.partnerId+'\',\''+r.step+
            '\')">Open gate</button>'+
          '<button class="btn btn-sm" onclick="toast(\'Reminder sent to '+esc(r.partner||'the partner')+
            '\')">Chase</button></span>'}
      ]})
      : stateBlock('empty','Nothing outstanding',
          'Every seller with an application in flight has cleared what this gate asks of them. Partners '+
          'already live are not chased — their tasks closed when their gates did.'),
      {flush:!!open.length, icon:'inbox',
       sub: open.length? open.length+' across '+
              (new Set(open.map(t=>t.partnerId))).size+' seller'+
              ((new Set(open.map(t=>t.partnerId))).size===1?'':'s')+' still onboarding'
            : 'No seller is waiting on anything'});
  })()+
  '</div>';
}
function doResendInvite(id){
  const p=PMAP[id]; if(!p) return;
  confirmAction({
    title:'Resend the invitation to '+p.name, subtitle:p.contact+' · '+(p.email||'no address on file'),
    risk:'normal', confirmLabel:'Resend to '+(p.email||p.contact),
    impact:['A fresh application link is emailed to <strong>'+esc(p.email||p.contact)+'</strong>.',
            'The previous link stops working immediately.',
            'The 14-day window restarts from today.',
            'The resend is recorded against the partner record.'],
    onConfirm:()=>{ resendInvite(id); recomputeDerived();
      toast('Invitation resent to '+(p.email||p.contact)+' — link valid for 14 days'); App.go('onboardq'); }
  });
}
function advanceGate(id){
  const p=PMAP[id], st=ONB_STATE[id]||{};
  const cur=ONB_STEPS.find(s=>st[s.id]==='now');
  /* The technical gate is verified, not asserted. Clearing it on a promise is
     how a seller reaches go-live with an integration nobody has run. */
  if(cur && cur.id==='tech' && !techReady(id)){
    const t=techStatus(id);
    const out=TECH_CHECKS.filter(c=>!t.checks[c.id]);
    openModal('<div class="modal-head">'+ICO('lock',18)+
      '<div class="grow"><h3 class="t-sub">Technical readiness is not proved yet</h3>'+
      '<div class="t-small muted">'+esc(p.name)+' · '+out.length+' of '+TECH_CHECKS.length+' checks outstanding</div></div>'+
      '<button class="iconbtn" onclick="closeModal()" aria-label="Close">'+ICO('x',16)+'</button></div>'+
      '<div class="modal-body stack">'+
        banner('danger','<strong>This gate cannot be cleared by review.</strong> Each check is verified by the '+
          'marketplace against the seller\'s own endpoints. A seller who goes live on an unproved integration '+
          'produces a customer-facing failure on day one.')+
        '<ul class="ticklist">'+out.map(c=>'<li>'+ICO('warning',14)+'<div class="grow">'+
          '<strong>'+esc(c.label)+'</strong><div class="t-small muted">'+esc(c.why)+'</div></div></li>').join('')+
        '</ul>'+
        banner('info','Register the endpoints, test each one, then run the sandbox order. All three are on the '+
          'integration milestone panel in this record.')+
      '</div>'+
      '<div class="modal-foot"><span class="t-tiny muted grow">No override exists for this gate</span>'+
        '<button class="btn btn-quiet" onclick="closeModal()">Close</button>'+
        '<button class="btn btn-primary" onclick="closeModal();openTechMilestone(\''+id+'\')">Open the milestone</button></div>',
      {wide:true,label:'Technical readiness'});
    return;
  }
  confirmAction({
    title:'Clear the '+(cur?cur.name.toLowerCase():'current')+' gate for '+p.name,
    subtitle:p.id+' · '+p.country, risk:'normal', confirmLabel:'Clear gate',
    body:'<div class="field"><label for="agEvid">Evidence reviewed</label><textarea class="inp" id="agEvid" data-autofocus '+
      'placeholder="What you checked and where the evidence sits"></textarea></div>',
    impact:['The partner moves to the next gate and is notified immediately.',
            'Your identity and the evidence note are written to the onboarding audit trail.',
            'Clearing the final gate publishes the partner\'s storefront and makes their listings orderable.',
            'Gates cannot be un-cleared — a partner that should not have progressed must be suspended instead.'],
    footNote:'Only clear a gate you have personally reviewed the evidence for.',
    onConfirm:()=>{
      const me=((typeof orgUsers==='function'&&(orgUsers('operator').filter(u=>u.you)[0]||{}).name)||
                'Marketplace onboarding desk');
      const next = onbClearGate(st);
      /* A cleared gate cannot keep open tasks, and the gate that becomes
         current has to actually start asking for things. */
      if(cur && typeof closeTasksForGate==='function') closeTasksForGate(p.id, cur.id, me);
      if(next){
        if(typeof openTasksForGate==='function') openTasksForGate(p.id, next.id);
        toast(p.name+' — '+(cur?cur.name.toLowerCase():'gate')+' cleared, '+next.name.toLowerCase()+' now open');
      } else {
        partnerGoLive(p);
        if(typeof closeTasksForGate==='function')
          ONB_STEPS.forEach(g=>closeTasksForGate(p.id, g.id, me));
        toast(p.name+' has cleared every gate and is now live on the marketplace');
      }
      recomputeDerived();
      App.go('onboardq');
    }
  });
}

/* ---------------------------- invite a partner ---------------------------- */
/* Sending an invitation needs a recipient, so the form asks for one and will not
   submit without it. The toast afterwards names who it went to. */
function invitePartnerDialog(){
  const types=['Content provider','Device OEM','Security ISV','IoT hardware','Insurance','Reseller'];
  openModal('<div class="modal-head">'+ICO('userplus',18)+'<div class="grow"><h3 class="t-sub">Invite a partner</h3>'+
    '<div class="t-small muted">They receive an application link by email and appear in your onboarding queue at the application gate.</div></div>'+
    '<button class="iconbtn" onclick="closeModal()" aria-label="Close">'+ICO('x',16)+'</button></div>'+
    '<div class="modal-body stack">'+
      '<div class="grid g2">'+
        '<div class="field"><label for="ipName">Company name</label>'+
          '<input class="inp" id="ipName" placeholder="e.g. Northlight Sensors GmbH" data-autofocus>'+
          '<div class="err" id="ipNameErr" hidden>'+ICO('alert',12)+'A company name is required.</div></div>'+
        '<div class="field"><label for="ipCountry">Country of registration</label>'+
          '<select class="inp" id="ipCountry">'+
          ['India','UAE','Kenya','Singapore','Germany','UK','Poland','Sweden','Taiwan','Vietnam','Brazil','Israel']
            .map(c=>'<option>'+esc(c)+'</option>').join('')+'</select></div>'+
      '</div>'+
      '<div class="grid g2">'+
        '<div class="field"><label for="ipContact">Contact name</label>'+
          '<input class="inp" id="ipContact" placeholder="Who signs the agreement">'+
          '<div class="err" id="ipContactErr" hidden>'+ICO('alert',12)+'A named contact is required — the invitation is addressed to a person.</div></div>'+
        '<div class="field"><label for="ipEmail">Contact email</label>'+
          '<input class="inp" id="ipEmail" placeholder="name@6dtech.co.in" inputmode="email">'+
          '<div class="err" id="ipEmailErr" hidden>'+ICO('alert',12)+'A valid email address is required — this is where the application link is sent.</div></div>'+
      '</div>'+
      '<div class="field"><label for="ipType">Partner type</label><select class="inp" id="ipType">'+
        types.map(t=>'<option>'+esc(t)+'</option>').join('')+'</select></div>'+
      '<div class="field"><label>Marketplaces they may list in</label>'+
        '<div class="row wrap" style="gap:8px;margin-top:4px">'+VERTICALS.map(v=>
        '<label class="checkline" style="border:1px solid var(--nim-line-200);border-radius:20px;padding:5px 11px">'+
        '<input type="checkbox" class="ipV" value="'+v.id+'">'+esc(v.name.replace(' Marketplace',''))+'</label>').join('')+'</div>'+
        '<div class="err" id="ipVErr" hidden>'+ICO('alert',12)+'Pick at least one marketplace — it decides which commission plans apply.</div></div>'+
      '<div class="field"><label for="ipPlan">Settlement plan to offer</label><select class="inp" id="ipPlan">'+
        '<option value="">Decide at the agreements gate</option>'+
        COMM_PLANS.map(c=>'<option value="'+c.id+'">'+esc(c.name)+' — '+c.base+'%</option>').join('')+'</select>'+
        '<div class="hint">Can be left open; the plan is fixed when the commission schedule is signed.</div></div>'+
      '<div class="impact"><strong>What the invitation does</strong><ul>'+
        '<li>An application link is emailed to the address above and expires in 14 days.</li>'+
        '<li>The partner appears in your onboarding queue immediately, at the <strong>application</strong> gate, owned by them.</li>'+
        '<li>They cannot list, order or be paid until every gate is cleared.</li>'+
        '<li>Nothing is charged, and no commercial commitment is made by sending it.</li></ul></div>'+
    '</div>'+
    '<div class="modal-foot"><span class="t-tiny muted grow">You can resend or withdraw the invitation from the queue.</span>'+
    '<button class="btn btn-quiet" onclick="closeModal()">Cancel</button>'+
    '<button class="btn btn-primary" id="ipGo" onclick="submitInvite()">Send invitation</button></div>',
    {wide:true,label:'Invite a partner'});
}
function submitInvite(){
  const g=id=>document.getElementById(id);
  const name=(g('ipName').value||'').trim();
  const contact=(g('ipContact').value||'').trim();
  const email=(g('ipEmail').value||'').trim();
  const vs=Array.prototype.slice.call(document.querySelectorAll('.ipV')).filter(c=>c.checked).map(c=>c.value);
  const okEmail=/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(email);

  g('ipNameErr').hidden=!!name;      g('ipName').setAttribute('aria-invalid', !name);
  g('ipContactErr').hidden=!!contact;g('ipContact').setAttribute('aria-invalid', !contact);
  g('ipEmailErr').hidden=okEmail;    g('ipEmail').setAttribute('aria-invalid', !okEmail);
  g('ipVErr').hidden=vs.length>0;
  if(!name||!contact||!okEmail||!vs.length){
    (!name?g('ipName'):!contact?g('ipContact'):!okEmail?g('ipEmail'):g('ipName')).focus();
    return;
  }
  const spec={name:name, contact:contact, email:email, country:g('ipCountry').value,
              type:g('ipType').value, verticals:vs, plan:g('ipPlan').value||null,
              invitedBy:OPS.name};
  closeModal();
  const p=invitePartner(spec);
  toast('Invitation sent to '+spec.contact+' at '+spec.email+' — '+p.name+' ('+p.id+') is in the queue at the application gate');
  App.go('onboardq');
}

/* ------------------------------ 4. Partners ------------------------------- */
function vPartners(){
  return pagehead('Partners',
    PARTNERS.length+' partners · '+LIVE_PARTNERS.length+' live, '+
    PARTNERS.filter(p=>['onboarding','review'].includes(p.status)).length+' onboarding, '+
    PARTNERS.filter(p=>p.status==='suspended').length+' suspended',
    exportBtn('Partner directory','dtPartners')+
    '<button class="btn btn-primary" onclick="invitePartnerDialog()">'+ICO('userplus',14)+'Invite a partner</button>')+
  '<div class="stack">'+
  banner('warning','<strong>Vertex Endpoint is suspended.</strong> Provisioning SLA breached on 9 of 12 orders. Existing subscriptions run to contract end; no new listings or orders are accepted. Buyers on that service have been told.')+
  panel(null, dt('dtPartners',{
    rows:PARTNERS, noun:'partners', pageSize:12, sortKey:'name', idKey:'id', onRow:"openPartner('$ID')",
    searchFields:['id','name','type','country','contact'], searchPlaceholder:'Search partner, type or country',
    filterFns:{'__v':(r,v)=>r.verticals.indexOf(v)>-1},
    chips:[{key:'__v',options:VERTICALS.map(v=>({label:v.name.replace(' Marketplace',''),value:v.id}))},
      {key:'status',options:[{label:'Live',value:'live'},{label:'Onboarding',value:'onboarding'},
      {label:'In review',value:'review'},{label:'Suspended',value:'suspended'},{label:'Rejected',value:'rejected'}]},
      {key:'tier',options:[{label:'Platinum',value:'Platinum'},{label:'Gold',value:'Gold'},{label:'Silver',value:'Silver'},{label:'Bronze',value:'Bronze'}]}],
    actions:exportBtn('Partners'),
    columns:[
      {key:'name',label:'Partner',render:r=>'<div class="cellmain">'+esc(r.name)+'</div><div class="cellsub t-num">'+esc(r.id)+' · '+esc(r.type)+'</div>'},
      {key:'verticals',label:'Marketplaces',sort:false,exp:r=>r.verticals.map(v=>vName(v)).join('; '),
       render:r=>'<div class="row wrap" style="gap:4px">'+r.verticals.map(vBadge).join('')+'</div>'},
      {key:'country',label:'Country',render:r=>esc(r.country)},
      {key:'contact',label:'Contact',render:r=>'<div class="cellmain">'+esc(r.contact)+'</div>'+
        (r.email?'<div class="cellsub">'+esc(r.email)+'</div>':'')},
      {key:'tier',label:'Tier',render:r=>tierPill(r.tier)},
      {key:'plan',label:'Settlement plan',render:r=>r.plan?'<span class="t-small">'+esc(CPMAP[r.plan].name)+'</span><div class="cellsub">'+CPMAP[r.plan].base+'%</div>':'<span class="nodata">Not assigned</span>'},
      {key:'rating',label:'Rating',align:'right',render:r=>r.rating!=null?'<span class="t-num">'+r.rating.toFixed(1)+'</span>':'<span class="nodata">No ratings</span>'},
      {key:'status',label:'State',render:r=>partnerPill(r.status)},
      /* A seller with no settlement history has no bills to show, so the slot
         is filled rather than left to shift Open along the column. */
      {key:'__acts',label:'',sort:false,render:r=>actionCell(
        SETTLEMENTS.some(s=>s.partnerId===r.id)
          ? '<button class="btn btn-sm btn-quiet" onclick="event.stopPropagation();partnerBillsDialog(\''+
            r.id+'\')">Bills</button>'
          : actionHeld('No bills yet',''),
        '<button class="btn btn-sm btn-quiet" onclick="event.stopPropagation();openPartner(\''+r.id+
          '\')">Open</button>',
        {width:'62px'})}
    ]}),{flush:true})+
  '<div class="grid g2">'+
    panel('Partners by marketplace',
      CH.bars(VERTICALS.map(v=>({l:v.name.split(' ')[0],v:PARTNERS.filter(p=>p.verticals.includes(v.id)).length})),
        {h:170,fmt:n=>Math.round(n),tip:n=>n+' partners',aria:'Partners by marketplace'}),{icon:'chart'})+
    panel('Tier distribution',
      CH.donut(['Platinum','Gold','Silver','Bronze'].map(t=>({l:t,v:PARTNERS.filter(p=>p.tier===t).length})),
        {centre:String(PARTNERS.length),centreSub:'partners',fmt:n=>n+' partners',aria:'Partner tier distribution'}),{icon:'pie'})+
  '</div>'+
  '</div>';
}

/* Listings the operator sells itself, composed from its own BSS catalogue. */
function firstPartyPanel(){
  const own=PRODUCTS.filter(p=>!p.partner);
  const bundles=own.filter(p=>p.components && p.components.length>1);
  const gmv=+ORDERS.filter(o=>!o.partnerId).reduce((a,o)=>a+o.gross,0).toFixed(2);
  return panel('First-party listings', dt('dtFP',{
    rows:own, noun:'listings', pageSize:8, sortKey:'listed', sortDir:'desc', idKey:'id',
    onRow:"openProduct('$ID',{mode:'operator'})",
    searchFields:['id','name','cat'], searchPlaceholder:'Search first-party listing',
    actions:exportBtn('First-party listings','dtFP'),
    emptyTitle:'Nothing sold first party yet',
    emptyBody:'Products the operator sells itself are composed from the operator catalogue.',
    emptyAction:'<button class="btn btn-sm btn-primary" onclick="newListingDialog()">Create one</button>',
    columns:[
      {key:'name',label:'Listing',render:r=>'<div class="cellmain">'+esc(r.name)+
        (r.components&&r.components.length>1?' '+pill('info','Bundle'):'')+'</div>'+
        '<div class="cellsub t-num">'+esc(r.id)+' · '+esc(r.cat)+'</div>'},
      {key:'v',label:'Category',render:r=>vBadge(r.v)},
      {key:'__comp',label:'Built from',sort:false,
       exp:r=>(r.components||[]).map(c=>c.name+(c.qty>1?' x'+c.qty:'')).join('; ')||'Not composed',
       render:r=>r.components&&r.components.length
         ? '<div class="tagset">'+r.components.slice(0,3).map(c=>'<span class="tag">'+esc(c.name)+
           (c.qty>1?' ×'+c.qty:'')+'</span>').join('')+
           (r.components.length>3?'<span class="tag">and '+(r.components.length-3)+' more</span>':'')+'</div>'
         : '<span class="dim">Not composed from the catalogue</span>'},
      {key:'price',label:'Price',align:'right',render:r=>'<span class="t-num cellmain">'+CUR(r.price)+'</span>'+
        '<div class="cellsub">'+(r.model==='monthly'?'per month':'one-off')+'</div>'},
      {key:'discountPct',label:'Bundle saving',align:'right',render:r=>r.discountPct
        ? '<span class="t-num">'+r.discountPct+'%</span>' : '<span class="dim">—</span>'},
      {key:'status',label:'State',render:r=>statusPill(r.status)},
      {key:'__acts',label:'',sort:false,render:r=>
        '<button class="btn btn-sm btn-quiet" onclick="event.stopPropagation();openProduct(\''+r.id+'\',{mode:\'operator\'})">Open</button>'}
    ]}),
    {flush:true, icon:'package',
     sub:own.length+' listings, '+bundles.length+' of them bundles · '+
       (gmv?CUR0(gmv)+' gross, all of which the operator keeps':'no orders yet')+
       '. First party means no partner, no commission and no settlement.',
     acts:'<button class="btn btn-sm" onclick="newListingDialog()">'+ICO('plus',13)+'Create</button>'});
}

/* ------------------------- 5. Catalogue governance ------------------------ */
function vCatalogue(){
  return pagehead('Catalogue',
    LISTING_QUEUE.length+' listings awaiting review · '+LIVE_PRODUCTS.length+' live across '+VERTICALS.length+
      ' categories · '+PRODUCTS.filter(p=>!p.partner).length+' sold first party',
    '<button class="btn" onclick="listingPolicyDialog()">'+ICO('file',13)+'Listing policy</button>'+
    exportBtn('Catalogue','dtCat')+
    '<button class="btn btn-primary" onclick="newListingDialog()">'+ICO('plus',14)+'Create a product or bundle</button>')+
  '<div class="stack">'+
  banner('danger','<strong>One listing in the queue breaches policy 7.4.</strong> PlayForge Loot Crate offers randomised paid rewards, prohibited in two of its target markets. Approving it as submitted exposes the marketplace, not just the partner.')+
  '<div class="grid g4">'+
    metric({icon:'inbox',label:'Awaiting review',value:String(LISTING_QUEUE.length),
      foot:LISTING_QUEUE.filter(l=>l.risk!=='low').length+' need a policy or certification check'})+
    metric({icon:'clock',label:'Median review time',value:'11 h',foot:'Target one working day'})+
    metric({icon:'checkcircle',label:'Approval rate',value:'86%',foot:'Rejections are mostly missing evidence'})+
    metric({icon:'package',label:'Live listings',value:String(LIVE_PRODUCTS.length),
      foot:PRODUCTS.filter(p=>p.status==='suspended').length+' suspended with their seller'})+
  '</div>'+
  panel('Review queue',
    LISTING_QUEUE.map(l=>
      '<div style="padding:13px 12px;border-bottom:1px solid var(--nim-line-100)">'+
      '<div class="row wrap" style="gap:12px;align-items:flex-start">'+
        '<span class="cartthumb">'+ICO(VICON[l.v],20)+'</span>'+
        '<div class="grow"><div class="row" style="gap:6px">'+vBadge(l.v)+
          (l.risk==='high'?pill('down','Policy breach'):l.risk==='medium'?pill('degraded','Needs a check'):pill('active','Routine'))+
          '<span class="tag">'+esc(l.age)+' in queue</span></div>'+
        '<div class="t-sub" style="margin-top:5px">'+esc(l.name)+'</div>'+
        '<div class="t-small muted">'+esc(l.partner)+' · '+esc(l.sku)+' · submitted '+esc(l.submitted)+'</div>'+
        '<div class="t-small" style="margin-top:6px">'+esc(l.check)+'</div>'+
        (l.issue?'<div class="t-small" style="margin-top:5px;color:var(--nim-danger-fg)">'+ICO('alert',12)+' '+esc(l.issue)+'</div>':'')+
        '</div>'+
        '<div style="text-align:right;flex:0 0 auto"><div class="t-sub t-num">'+CUR(l.price)+'</div></div>'+
      '</div>'+
      '<div class="divider"></div>'+
      '<div class="row wrap"><span class="t-tiny muted grow">Decisions are visible to the partner with the reason you give.</span>'+
        '<button class="btn btn-sm btn-quiet" onclick="reviewListing(\''+l.id+'\')">Full review</button>'+
        '<button class="btn btn-sm btn-danger" onclick="decideListing(\''+l.id+'\',false)">Reject</button>'+
        '<button class="btn btn-sm btn-primary" onclick="decideListing(\''+l.id+'\',true)"'+(l.risk==='high'?' disabled':'')+'>Approve</button>'+
      '</div></div>').join(''),
    {flush:true,icon:'checklist',
     acts:'<span class="t-tiny muted">Approve is disabled on a known policy breach</span>'})+
  firstPartyPanel()+
  panel('Live catalogue', dt('dtCat',{
    rows:PRODUCTS, noun:'listings', pageSize:12, sortKey:'name', idKey:'id', onRow:"openProduct('$ID',{showComm:true,mode:'operator'})",
    searchFields:['id','name','cat','seller'], searchPlaceholder:'Search listing, SKU or seller',
    chips:[{key:'v',options:VERTICALS.map(v=>({label:v.name.replace(' Marketplace',''),value:v.id}))},
           {key:'status',options:[{label:'Live',value:'live'},{label:'In review',value:'pending'},{label:'Suspended',value:'suspended'}]}],
    actions:exportBtn('Catalogue'),
    columns:[
      {key:'name',label:'Listing',render:r=>'<div class="cellmain">'+esc(r.name)+'</div><div class="cellsub t-num">'+esc(r.id)+' · '+esc(r.cat)+'</div>'},
      {key:'v',label:'Marketplace',render:r=>vBadge(r.v)},
      {key:'seller',label:'Seller',render:r=>esc(r.seller)+(r.partner?'':'<div class="cellsub">first party</div>')},
      {key:'price',label:'Price',align:'right',render:r=>'<span class="t-num">'+CUR(r.price)+'</span>'},
      {key:'comm',label:'Commission',align:'right',render:r=>r.comm?'<span class="t-num">'+r.comm+'%</span>':'<span class="dim">—</span>'},
      {key:'rating',label:'Rating',align:'right',render:r=>r.rating!=null?'<span class="t-num">'+r.rating.toFixed(1)+'</span>':'<span class="nodata">None</span>'},
      {key:'status',label:'State',render:r=>statusPill(r.status)},
      {key:'__acts',label:'',sort:false,render:r=>r.status==='live'
        ? '<button class="btn btn-sm btn-quiet" onclick="event.stopPropagation();toast(\'Delist requires a reason and notifies the seller\')">Delist</button>'
        : ''}
    ]}),{flush:true,icon:'package'})+
  depRulesPanel()+
  '</div>';
}
/* ----------------- what the catalogue refuses to sell together ------------
   These rules stop orders being taken, so they cannot live only in a data
   file. The operator sees every one, what it is enforced against, and how
   often it has actually turned a buyer away. */
function depRulesPanel(){
  const rows=[];
  Object.keys(PROD_RULES).forEach(sku=>{
    const p=SKUMAP[sku]; if(!p) return;
    const r=PROD_RULES[sku];
    if(r.requires) rows.push({sku, name:p.name, v:p.v, kind:'requires',
      other:r.requires.anyOf.filter(id=>SKUMAP[id]).map(id=>SKUMAP[id].name).join(' or '),
      why:r.requires.why});
    (r.excludes||[]).forEach(x=>{ if(SKUMAP[x.sku]) rows.push({sku, name:p.name, v:p.v,
      kind:'excludes', other:SKUMAP[x.sku].name, why:x.why}); });
    (r.worksWith||[]).forEach(x=>{ if(SKUMAP[x.sku]) rows.push({sku, name:p.name, v:p.v,
      kind:'worksWith', other:SKUMAP[x.sku].name, why:x.why}); });
  });
  const label={requires:'Requires', excludes:'Cannot be held with', worksWith:'Suggested with'};
  return panel('Product dependencies',
    banner('info','<strong>A requires or excludes rule stops an order being taken.</strong> '+
      'A suggestion never does — it is shown on the product and nothing more. Changing a rule '+
      'affects new baskets only; anything already ordered under the old rule stands.')+
    '<div class="tablewrap" style="margin-top:11px"><table class="tbl"><thead><tr>'+
      '<th>Product</th><th style="width:120px">Marketplace</th>'+
      '<th style="width:170px">Relationship</th><th>Against</th>'+
      '<th style="width:110px">Enforced</th></tr></thead><tbody>'+
    rows.map(r=>'<tr><td class="cellmain">'+esc(r.name)+
      '<div class="cellsub t-num">'+esc(r.sku)+'</div></td>'+
      '<td>'+vBadge(r.v)+'</td>'+
      '<td><div class="t-small strong">'+esc(label[r.kind])+'</div>'+
      '<div class="cellsub">'+esc(r.why)+'</div></td>'+
      '<td class="t-small">'+esc(r.other)+'</td>'+
      '<td>'+(r.kind==='worksWith'
        ? pill('neutral','Advice only')
        : pill('active','Blocks the order'))+'</td></tr>').join('')+
    '</tbody></table></div>',
    {flush:false, icon:'layers',
     sub:rows.filter(r=>r.kind!=='worksWith').length+' rules block an order · '+
       rows.filter(r=>r.kind==='worksWith').length+' are advice only · '+
       Object.keys(PROD_RULES).length+' products carry at least one'});
}
function reviewListing(id){
  const l=LISTING_QUEUE.find(x=>x.id===id); if(!l) return;
  openInspector(
    '<div class="insp-head">'+ICO(VICON[l.v],18)+'<div class="grow">'+
      '<div class="row" style="gap:6px">'+vBadge(l.v)+
      (l.risk==='high'?pill('down','Policy breach'):l.risk==='medium'?pill('degraded','Needs a check'):pill('active','Routine'))+'</div>'+
      '<h3 class="t-sub" style="margin-top:5px">'+esc(l.name)+'</h3>'+
      '<div class="t-small muted">'+esc(l.partner)+' · '+esc(l.sku)+'</div></div>'+
      '<button class="iconbtn" onclick="closeInspector()" aria-label="Close">'+ICO('x',16)+'</button></div>'+
    '<div class="insp-body stack">'+
      (l.issue?banner('danger','<strong>'+esc(l.issue)+'</strong>'):'')+
      '<dl class="deflist">'+
        '<dt>Submitted</dt><dd>'+esc(l.submitted)+' ('+esc(l.age)+' in queue)</dd>'+
        '<dt>Marketplace</dt><dd>'+esc(vName(l.v))+'</dd>'+
        '<dt>Proposed price</dt><dd>'+CUR(l.price)+'</dd>'+
        '<dt>Review focus</dt><dd>'+esc(l.check)+'</dd>'+
        '<dt>Risk</dt><dd>'+(l.risk==='high'?'High — policy':l.risk==='medium'?'Medium — evidence':'Low — routine')+'</dd>'+
      '</dl>'+
      (function(){
        const q=LISTING_QUERIES.filter(x=>x.sku===l.sku && x.status!=='closed')[0];
        return q ? banner(q.status==='overdue'?'warning':'info',
          '<strong>Query with the seller since '+esc(q.asked)+'.</strong> '+esc(q.subject)+
          ' — reply due '+esc(q.due)+(q.status==='overdue'?', now overdue':'')+'.'+
          '<div class="t-tiny" style="margin-top:5px">'+esc(q.body)+'</div>') : '';
      })()+
      '<div class="divider"></div>'+
      '<div class="row"><h4 class="t-sub grow">Automated checks</h4>'+
        '<button class="btn btn-sm btn-quiet" onclick="closeInspector();openPolicy(\''+l.v+'\')">'+
        ICO('shield',13)+'Policy for '+esc(vName(l.v))+'</button></div>'+
      '<table class="tbl"><tbody>'+
      [['Duplicate detection','pass','No near-duplicate in the catalogue'],
       ['Prohibited terms','pass','No flagged terms in the description'],
       ['Image quality','pass','4 images, all above 1200×1200'],
       ['Price floor', l.issue&&/floor/.test(l.issue)?'fail':'pass', l.issue&&/floor/.test(l.issue)?'Below the wholesale floor':'Above the floor'],
       ['Policy 7.4 — randomised rewards', l.risk==='high'?'fail':'pass', l.risk==='high'?'Loot mechanic detected in the description':'Not applicable'],
       ['Certification evidence', l.risk==='medium'&&/approval/.test(l.check)?'fail':'pass',
        l.risk==='medium'&&/approval/.test(l.check)?'Type approval missing for 2 markets':'On file']]
      .map(c=>'<tr><td class="cellmain">'+esc(c[0])+'</td>'+
      '<td style="width:88px">'+(c[1]==='pass'?pill('approved','Pass'):pill('rejected','Fail'))+'</td>'+
      '<td class="t-small">'+esc(c[2])+'</td></tr>').join('')+'</tbody></table>'+
    '</div>'+
    '<div class="insp-foot"><button class="btn btn-quiet" onclick="closeInspector()">Close</button><div class="spacer"></div>'+
      '<button class="btn btn-sm" onclick="askPartnerDialog(\''+l.id+'\')">'+ICO('support',13)+'Ask the partner</button>'+
      '<button class="btn btn-sm btn-danger" onclick="decideListing(\''+l.id+'\',false)">Reject</button>'+
      '<button class="btn btn-sm btn-primary" '+(l.risk==='high'?'disabled':'')+' onclick="decideListing(\''+l.id+'\',true)">Approve</button>'+
    '</div>','Listing review '+l.name);
}
function decideListing(id,approve){
  const l=LISTING_QUEUE.find(x=>x.id===id); if(!l) return;
  closeInspector();
  confirmAction({
    title:(approve?'Approve ':'Reject ')+l.name, subtitle:l.partner+' · '+vName(l.v)+' · '+CUR(l.price),
    risk:approve?'normal':'normal', confirmLabel:approve?'Approve and publish':'Reject',
    body:'<div class="field"><label for="dlWhy">Reason (shown to the partner and kept in the audit trail)</label>'+
      '<textarea class="inp" id="dlWhy" data-autofocus placeholder="'+(approve?'Optional':'Required — be specific so they can fix it')+'"></textarea></div>',
    impact:approve
      ? ['The listing publishes immediately and becomes orderable in '+esc(vName(l.v))+'.',
         'Commission is set by the partner\'s settlement plan, not by this listing.',
         'The partner is notified and it appears in their listings as live.',
         'If it is later found non-compliant it is delisted and completed sales are reversed.']
      : ['Nothing publishes. The partner is told why and can resubmit.',
         'The rejection and your reason are kept against the partner record.',
         'Repeated rejections for the same cause count toward a partner review.'],
    footNote:approve?'Approving a listing makes the marketplace a party to how it is sold.':'Be specific — vague rejections generate a second submission with the same problem.',
    onConfirm:()=>{
      if(approve){ publishListing(l); toast(l.name+' approved — live in '+vName(l.v)); }
      else { rejectListing(l); toast(l.name+' rejected — '+l.partner+' notified with your reason','warn'); }
      App.go('catalogue');
    }
  });
}

/* ---------------------- 6. Commission and settlement plans ---------------- */
function vPlans(){
  return pagehead('Commission and settlement plans',
    COMM_PLANS.length+' plans across '+new Set(COMM_PLANS.map(c=>c.vertical)).size+' marketplaces · blended take rate '+TAKE_RATE+'%',
    exportBtn('Plans','dtPlans')+
    '<button class="btn" onclick="newCommercialModelDialog()">'+ICO('file',13)+'New commercial model</button>'+
    '<button class="btn btn-primary" onclick="newPlan()">'+ICO('plus',14)+'New plan</button>')+
  '<div class="stack">'+
  banner('info','Plans are assigned to partners, not to listings. That keeps commission predictable for a seller across their whole catalogue and stops per-listing rate negotiation.')+
  '<div class="grid g4">'+
    metric({icon:'file',label:'Active plans',value:String(COMM_PLANS.length),foot:'Covering '+COMM_PLANS.reduce((a,c)=>a+c.partners,0)+' partner assignments'})+
    metric({icon:'pie',label:'Blended take rate',value:TAKE_RATE+'%',foot:delta(-0.4,'pp',true)+' as partners cross tiers'})+
    metric({icon:'wallet',label:'Commission earned',value:CUR0(COMMISSION),foot:'On '+CUR0(GMV)+' gross value'})+
    metric({icon:'invoice',label:'Payouts due',value:CUR0(PAYOUT_DUE),foot:SET_PENDING.length+' statements to approve'})+
  '</div>'+
  commercialModelsPanel()+
  panel('Plans', dt('dtPlans',{
    rows:COMM_PLANS, noun:'plans', pageSize:10, sortKey:'vertical',
    onRow:"openPlan('$ID')", idKey:'id',
    searchFields:['id','name','model'], searchPlaceholder:'Search plan or model',
    chips:[{key:'vertical',options:VERTICALS.map(v=>({label:v.name.replace(' Marketplace',''),value:v.id}))}],
    actions:exportBtn('Commission plans','dtPlans'),
    columns:[
      {key:'name',label:'Plan',render:r=>'<div class="cellmain">'+esc(r.name)+
        (r.status==='draft'?' '+pill('neutral','Draft'):'')+'</div><div class="cellsub t-num">'+esc(r.id)+'</div>'},
      {key:'vertical',label:'Marketplace',render:r=>vBadge(r.vertical)},
      {key:'model',label:'Model',render:r=>'<span class="t-small">'+esc(r.model)+'</span>'},
      {key:'base',label:'Base rate',align:'right',render:r=>'<span class="t-num cellmain">'+r.base+'%</span>'},
      {key:'tiers',label:'Tiers',sort:false,render:r=>'<div class="tagset">'+r.tiers.map(t=>'<span class="tag">'+t.rate+'%</span>').join('')+'</div>'},
      {key:'cycle',label:'Payout cycle',render:r=>'<span class="t-small">'+esc(r.cycle)+'</span>'},
      {key:'hold',label:'Holdback',render:r=>'<span class="t-small">'+esc(r.hold)+'</span>'},
      {key:'partners',label:'Partners',align:'right',render:r=>'<span class="t-num">'+r.partners+'</span>'},
      {key:'__acts',label:'',sort:false,render:r=>'<button class="btn btn-sm btn-quiet" onclick="event.stopPropagation();openPlan(\''+r.id+'\')">Open</button>'}
    ]}),{flush:true,icon:'file'})+
  '<div class="grid g2">'+
    panel('Rate by marketplace',
      CH.bars(VERTICALS.map(v=>{
        const ps=COMM_PLANS.filter(c=>c.vertical===v.id);
        return {l:v.name.split(' ')[0], v: ps.length? +(ps.reduce((a,c)=>a+c.base,0)/ps.length).toFixed(1) : null};
      }),{h:180,fmt:n=>n.toFixed(0)+'%',tip:n=>n+'%',aria:'Average commission rate by marketplace'})+
      '<div class="t-tiny muted" style="margin-top:7px">Hatched bars are marketplaces with no partner plan — first-party products carry no commission.</div>',
      {icon:'chart'})+
    panel('What a sale looks like',
      '<div class="field" style="margin-bottom:11px"><label for="plPick">Plan</label>'+
      '<select class="inp" id="plPick" onchange="PLAN_DEMO=this.value;App.go(\'plans\')">'+
      COMM_PLANS.map(c=>'<option value="'+c.id+'"'+(PLAN_DEMO===c.id?' selected':'')+'>'+esc(c.name)+'</option>').join('')+
      '</select></div>'+
      splitBar(1000,CPMAP[PLAN_DEMO]||COMM_PLANS[0]),
      {icon:'wallet',sub:'Illustrated on a '+CUR0(1000)+' sale'})+
  '</div>'+
  '</div>';
}
let PLAN_DEMO='CP-CONTENT-STD';
function commercialModelsPanel(){
  return panel('Commercial models',
    '<div class="tablewrap"><table class="tbl"><thead><tr>'+
      '<th style="min-width:220px">Model</th><th class="num">Plans</th><th class="num">Partners</th>'+
      '<th>Headline rate</th><th>Tiers on</th><th class="num">Parameters</th><th></th></tr></thead><tbody>'+
    COMMERCIAL_MODELS.map(m=>{
      const plans=COMM_PLANS.filter(p=>p.modelId===m.id);
      const ptrs=plans.reduce((a,p)=>a+p.partners,0);
      return '<tr><td><div class="cellmain">'+esc(m.name)+
        (m.system?'':' '+pill('info','Custom'))+'</div>'+
        '<div class="cellsub">'+esc(m.blurb)+'</div></td>'+
        '<td class="num t-num">'+plans.length+'</td>'+
        '<td class="num t-num">'+ptrs+'</td>'+
        '<td class="t-small">'+esc(m.rateLabel)+'</td>'+
        '<td class="t-small">'+(m.tiers?esc(m.tierBasis):'<span class="dim">Flat rate</span>')+'</td>'+
        '<td class="num t-num">'+m.params.length+'</td>'+
        '<td class="acts"><button class="btn btn-sm btn-quiet" onclick="openCommercialModel(\''+m.id+'\')">Open</button></td>'+
      '</tr>';
    }).join('')+'</tbody></table></div>',
    {flush:true, icon:'file',
     sub:'A plan is a model plus its parameters. The model decides which parameters a plan even has — which is why '+
         'a wholesale plan is never asked about cooling-off periods.',
     acts:'<button class="btn btn-sm" onclick="newCommercialModelDialog()">'+ICO('plus',13)+'New model</button>'});
}
function openCommercialModel(id){
  const m=CMMAP[id]; if(!m) return;
  const plans=COMM_PLANS.filter(p=>p.modelId===id);
  openInspector(
    '<div class="insp-head">'+ICO('file',18)+'<div class="grow">'+
      '<div class="row" style="gap:6px">'+(m.system?pill('neutral','Built-in'):pill('info','Custom'))+
        (m.tiers?pill('active','Tiered'):pill('neutral','Flat rate'))+'</div>'+
      '<h3 class="t-sub" style="margin-top:5px">'+esc(m.name)+'</h3>'+
      '<div class="t-small muted t-num">'+esc(m.id)+'</div></div>'+
      '<button class="iconbtn" onclick="closeInspector()" aria-label="Close">'+ICO('x',16)+'</button></div>'+
    '<div class="insp-body stack">'+
      '<p class="t-body" style="margin:0">'+esc(m.blurb)+'</p>'+
      '<dl class="deflist">'+
        '<dt>Headline rate</dt><dd>'+esc(m.rateLabel)+'</dd>'+
        '<dt>Tiers</dt><dd>'+(m.tiers?esc(m.tierBasis):'Not tiered — one rate throughout')+'</dd>'+
        '<dt>Plans using it</dt><dd>'+plans.length+'</dd>'+
        '<dt>Partners affected</dt><dd>'+plans.reduce((a,p)=>a+p.partners,0)+'</dd>'+
      '</dl>'+
      '<div class="divider"></div><h4 class="t-sub">Parameters a plan on this model needs</h4>'+
      (m.params.length
        ? '<table class="tbl"><tbody>'+m.params.map(pr=>
            '<tr><td><div class="cellmain">'+esc(pr.label)+'</div>'+
            '<div class="cellsub t-num">'+esc(pr.k)+' · '+esc(pr.type)+'</div></td>'+
            '<td class="num" style="width:110px"><span class="t-small">default '+
            esc(pr.type==='bool'?(pr.def?'yes':'no'):String(pr.def))+'</span></td></tr>').join('')+'</tbody></table>'
        : '<div class="t-small nodata">None beyond the headline rate.</div>')+
      (plans.length
        ? '<div class="divider"></div><h4 class="t-sub">Plans on this model</h4>'+
          '<table class="tbl"><tbody>'+plans.map(p=>
            '<tr onclick="openPlan(\''+p.id+'\')" style="cursor:pointer">'+
            '<td class="cellmain">'+esc(p.name)+'</td>'+
            '<td class="num" style="width:70px">'+p.base+(m.rateUnit==='$'?'':'%')+'</td>'+
            '<td class="num" style="width:88px">'+p.partners+' partners</td></tr>').join('')+'</tbody></table>'
        : '<div class="divider"></div><div class="t-small nodata">No plan uses this model yet.</div>')+
    '</div>'+
    '<div class="insp-foot"><button class="btn btn-quiet" onclick="closeInspector()">Close</button>'+
      '<div class="spacer"></div>'+
      '<button class="btn btn-sm btn-primary" onclick="closeInspector();newPlan()">Create a plan on it</button></div>',
    'Model '+m.name);
}

function openPlan(id){
  const p=CPMAP[id]; if(!p) return;
  const ptrs=PARTNERS.filter(x=>x.plan===id);
  openInspector(
    '<div class="insp-head">'+ICO('file',18)+'<div class="grow">'+vBadge(p.vertical)+
      '<h3 class="t-sub" style="margin-top:5px">'+esc(p.name)+'</h3>'+
      '<div class="t-small muted">'+esc(p.id)+' · '+esc(p.model)+'</div></div>'+
      '<button class="iconbtn" onclick="closeInspector()" aria-label="Close">'+ICO('x',16)+'</button></div>'+
    '<div class="insp-body stack">'+
      (p.status==='draft'?banner('info','<strong>Draft.</strong> This plan has nobody on it and settles nothing until '+
        'you assign a partner to it.'):'')+
      '<div class="t-small muted">'+esc((CMMAP[p.modelId]||{}).blurb||'')+'</div>'+
      '<dl class="deflist">'+
        '<dt>Commercial model</dt><dd>'+esc((CMMAP[p.modelId]||{}).name||p.model)+'</dd>'+
        '<dt>'+esc((CMMAP[p.modelId]||{}).rateLabel||'Base rate')+'</dt><dd>'+p.base+
          ((CMMAP[p.modelId]||{}).rateUnit==='$'?'':'%')+'</dd>'+
        '<dt>Fees</dt><dd>'+esc(p.fees)+'</dd>'+
        '<dt>Payout cycle</dt><dd>'+esc(p.cycle)+'</dd>'+
        '<dt>Holdback</dt><dd>'+esc(p.hold)+'</dd>'+
        '<dt>Assigned to</dt><dd>'+ptrs.length+' partner'+(ptrs.length===1?'':'s')+'</dd>'+
      '</dl>'+
      (function(){
        const m=CMMAP[p.modelId];
        if(!m||!m.params.length) return '';
        return '<div class="divider"></div>'+
          '<div class="row" style="margin-bottom:7px"><h4 class="t-sub grow">Model parameters</h4>'+
          '<button class="btn btn-sm btn-quiet" onclick="editPlanParams(\''+p.id+'\')">Edit</button></div>'+
          '<div class="stack" style="gap:6px">'+m.params.map(pr=>{
            const v=(p.params||{})[pr.k];
            const shown = pr.type==='bool' ? (v?'Yes':'No')
                        : pr.type==='money' ? CUR(v||0)
                        : pr.type==='pct' ? (v||0)+'%'
                        : String(v==null?'—':v);
            return '<div class="row"><span class="t-small grow">'+esc(pr.label)+'</span>'+
                   '<span class="t-small strong">'+esc(shown)+'</span></div>';
          }).join('')+'</div>';
      })()+
      (p.tiers.length>1
        ? '<div class="divider"></div><h4 class="t-sub">Tiers</h4>'+
          '<div class="t-tiny muted" style="margin-bottom:6px">'+
          esc((CMMAP[p.modelId]||{}).tierBasis||'Trailing 12-month gross value')+'</div>'
        : '<div class="divider"></div><h4 class="t-sub">Tiers</h4>'+
          '<div class="t-tiny muted" style="margin-bottom:6px">Flat rate — this model does not tier.</div>')+
      '<table class="tbl"><thead><tr><th>Threshold</th><th class="num">Rate</th></tr></thead><tbody>'+
      p.tiers.map((t,i)=>{const n=p.tiers[i+1];
        return '<tr><td>'+(t.from===0?'Up to '+CUR0(n?n.from:0):n?CUR0(t.from)+' to '+CUR0(n.from):'Above '+CUR0(t.from))+'</td>'+
        '<td class="num t-num">'+t.rate+'%</td></tr>';}).join('')+'</tbody></table>'+
      '<div class="divider"></div><h4 class="t-sub">On a '+CUR0(1000)+' sale</h4>'+splitBar(1000,p)+
      (ptrs.length?'<div class="divider"></div><h4 class="t-sub">Partners on this plan</h4>'+
        '<table class="tbl"><tbody>'+ptrs.map(x=>'<tr onclick="openPartner(\''+x.id+'\')" style="cursor:pointer">'+
        '<td class="cellmain">'+esc(x.name)+'</td><td style="width:92px">'+partnerPill(x.status)+'</td></tr>').join('')+'</tbody></table>':'')+
    '</div>'+
    '<div class="insp-foot"><button class="btn btn-quiet" onclick="closeInspector()">Close</button><div class="spacer"></div>'+
      '<button class="btn btn-sm" onclick="clonePlan(\''+p.id+'\')">Clone</button>'+
      '<button class="btn btn-sm btn-primary" onclick="editPlan(\''+p.id+'\')">Edit rates</button></div>','Plan '+p.name);
}
function editPlan(id){
  const p=CPMAP[id];
  closeInspector();
  confirmAction({
    title:'Change the rates on '+p.name, subtitle:p.partners+' partners are on this plan', risk:'high',
    confirmLabel:'Schedule rate change', requireType:'CHANGE',
    body:'<div class="grid g2">'+
      '<div class="field"><label for="epBase">Base rate (%)</label><input class="inp" id="epBase" value="'+p.base+'" inputmode="decimal"></div>'+
      '<div class="field"><label for="epFrom">Effective from</label><select class="inp" id="epFrom">'+
        '<option selected>Start of next settlement period</option><option>Start of next quarter</option></select></div></div>'+
      '<div class="field" style="margin-top:12px"><label for="epWhy">Reason</label>'+
      '<textarea class="inp" id="epWhy" placeholder="Kept in the plan history and shared with affected partners"></textarea></div>',
    impact:['<strong>'+p.partners+' partner'+(p.partners===1?'':'s')+'</strong> on this plan are affected.',
            'Rates never apply retrospectively — the change takes effect from the start of the next settlement period.',
            'Every affected partner is notified 30 days ahead, as the marketplace terms require.',
            'Partners on a signed commercial schedule may have a right to terminate on a rate increase. Legal should see anything above two points.'],
    footNote:'Rate changes are the single most disputed thing a marketplace does. Document the reason.',
    onConfirm:()=>toast('Rate change scheduled — 30-day notice sent to '+p.partners+' partners','warn')
  });
}
function newPlan(){
  const first=COMMERCIAL_MODELS[0];
  NP_TIERS=[{from:0,rate:15},{from:100000,rate:13}];
  openModal('<div class="modal-head">'+ICO('plus',18)+'<div class="grow"><h3 class="t-sub">New commission plan</h3>'+
    '<div class="t-small muted">A plan is a commercial model plus its parameters. Partners hold one plan per marketplace.</div></div>'+
    '<button class="iconbtn" onclick="closeModal()" aria-label="Close">'+ICO('x',16)+'</button></div>'+
    '<div class="modal-body stack">'+
      '<div class="grid g2">'+
        '<div class="field"><label for="npName">Plan name</label>'+
          '<input class="inp" id="npName" placeholder="e.g. Security — enterprise" data-autofocus>'+
          '<div class="err" id="npNameErr" hidden>'+ICO('alert',12)+'A plan needs a name partners will see on their statement.</div></div>'+
        '<div class="field"><label for="npV">Marketplace category</label><select class="inp" id="npV">'+
          VERTICALS.map(v=>'<option value="'+v.id+'">'+esc(v.name)+'</option>').join('')+'</select></div>'+
      '</div>'+

      '<div class="field"><label for="npModel">Commercial model</label>'+
        '<div class="row" style="gap:8px">'+
          '<select class="inp" id="npModel" onchange="onModelChange(\'np\')" style="flex:1 1 auto">'+
          COMMERCIAL_MODELS.map(m=>'<option value="'+m.id+'">'+esc(m.name)+'</option>').join('')+'</select>'+
          '<button class="btn btn-sm" onclick="newCommercialModelDialog()">'+ICO('plus',13)+'New model</button>'+
        '</div>'+
        '<div class="hint" id="npBlurb">'+esc(first.blurb)+'</div></div>'+

      '<div class="grid g3">'+
        '<div class="field"><label for="npBase"><span id="npRateLabel">'+esc(first.rateLabel)+'</span></label>'+
          '<input class="inp" id="npBase" value="15" inputmode="decimal" oninput="npSyncBase()">'+
          '<div class="err" id="npBaseErr" hidden>'+ICO('alert',12)+'A rate above zero is required.</div></div>'+
        '<div class="field"><label for="npCycle">Payout cycle</label><select class="inp" id="npCycle">'+
          BILL_CYCLES.map(c=>'<option'+(c==='Monthly'?' selected':'')+'>'+esc(c)+'</option>').join('')+'</select></div>'+
        '<div class="field"><label for="npTerms">Terms</label><select class="inp" id="npTerms">'+
          BILL_TERMS.map(t=>'<option'+(t==='net 30'?' selected':'')+'>'+esc(t)+'</option>').join('')+'</select></div>'+
      '</div>'+
      '<div class="grid g2">'+
        '<div class="field"><label for="npHold">Holdback</label><select class="inp" id="npHold">'+
          BILL_HOLD.map(h=>'<option'+(h==='14 days (returns window)'?' selected':'')+'>'+esc(h)+'</option>').join('')+'</select></div>'+
        '<div class="field"><label for="npFees">Fees passed on</label>'+
          '<input class="inp" id="npFees" value="Payment processing 1.9% + $0.20"></div>'+
      '</div>'+

      '<div><div class="t-small strong" style="margin-bottom:7px">Parameters for this model</div>'+
        '<div id="npParams">'+modelParamsHtml(first.id,{},'np_p_')+'</div></div>'+

      '<div id="npTiers"'+(first.tiers?'':' hidden')+'>'+
        '<div class="row" style="margin-bottom:6px"><span class="t-small strong grow">Volume tiers</span>'+
        '<button class="btn btn-sm" onclick="npAddTier()">'+ICO('plus',13)+'Add a tier</button></div>'+
        '<div id="npTierBox">'+npTierTable()+'</div>'+
        '<div class="t-tiny muted" id="npTierBasis" style="margin-top:6px">Tiers are evaluated on '+
          esc(String(first.tierBasis||'').toLowerCase())+', recalculated monthly.</div></div>'+

      '<div class="impact"><strong>Before you save</strong><ul>'+
        '<li>A plan with no partners assigned has no effect until you assign one.</li>'+
        '<li>Rates cannot be applied retrospectively — a new plan starts at the next settlement period.</li>'+
        '<li>Changing the model later is a new plan, not an edit. Partners signed a schedule against this one.</li></ul></div>'+
    '</div>'+
    '<div class="modal-foot"><span class="t-tiny muted grow">Saved as a draft until you assign a partner.</span>'+
    '<button class="btn btn-quiet" onclick="closeModal()">Cancel</button>'+
    '<button class="btn btn-primary" onclick="submitPlan()">Create plan</button></div>',
    {wide:true,label:'New commission plan'});
}
let NP_TIERS=[];
function npTierTable(){
  return '<table class="tbl"><thead><tr><th>From trailing gross</th><th class="num">Rate</th><th></th></tr></thead><tbody>'+
    NP_TIERS.map((t,i)=>'<tr>'+
      '<td>'+(i===0
        ? '<span class="t-num">'+CUR0(0)+'</span> <span class="t-tiny muted">base</span>'
        : '<input class="inp inp-sm" type="number" min="1" step="1000" value="'+t.from+
          '" style="width:130px" onchange="npSetTier('+i+',\'from\',this.value)" aria-label="Tier '+(i+1)+' threshold">')+'</td>'+
      '<td class="num"><input class="inp inp-sm" type="number" min="0" max="100" step="0.5" value="'+t.rate+
        '" style="width:80px" onchange="npSetTier('+i+',\'rate\',this.value)" aria-label="Tier '+(i+1)+' rate">%</td>'+
      '<td class="acts">'+(i===0?'<span class="t-tiny muted">Base</span>'
        :'<button class="btn btn-sm btn-quiet" onclick="npRemoveTier('+i+')">Remove</button>')+'</td>'+
    '</tr>').join('')+'</tbody></table>'+
    (function(){
      const bad=NP_TIERS.some((t,i)=>i>0 && t.from<=NP_TIERS[i-1].from);
      return bad ? '<div class="hint hint-bad" style="margin-top:6px">'+ICO('alert',12)+
        ' Each tier must start above the one before it, or the plan is ambiguous.</div>' : '';
    })();
}
function npRedrawTiers(){ const b=$('#npTierBox'); if(b) b.innerHTML=npTierTable(); }
function npSetTier(i,k,v){
  const n=parseFloat(v)||0;
  NP_TIERS[i][k]=n;
  npRedrawTiers();
}
function npAddTier(){
  const last=NP_TIERS[NP_TIERS.length-1]||{from:0,rate:15};
  NP_TIERS.push({from:(last.from||0)+100000, rate:Math.max(0,+(last.rate-2).toFixed(1))});
  npRedrawTiers();
}
function npRemoveTier(i){ if(i===0) return; NP_TIERS.splice(i,1); npRedrawTiers(); }
function npSyncBase(){
  const v=parseFloat(($('#npBase')||{}).value);
  if(!isNaN(v) && NP_TIERS.length){ NP_TIERS[0].rate=v; npRedrawTiers(); }
}
function submitPlan(){
  const g=id=>document.getElementById(id);
  const name=(g('npName').value||'').trim();
  const base=parseFloat(g('npBase').value);
  const badName=!name, badBase=!(base>0);
  g('npNameErr').hidden=!badName; g('npBaseErr').hidden=!badBase;
  if(badName||badBase){ (badName?g('npName'):g('npBase')).focus(); return; }
  const modelId=g('npModel').value;
  const m=CMMAP[modelId];
  if(m.tiers){
    const bad=NP_TIERS.some((t,i)=>i>0 && t.from<=NP_TIERS[i-1].from);
    if(bad){ toast('Tier thresholds must increase — fix them before saving','warn'); return; }
  }
  const spec={name:name, vertical:g('npV').value, modelId:modelId, base:base,
              cycle:g('npCycle').value+', '+g('npTerms').value, hold:g('npHold').value,
              fees:(g('npFees').value||'').trim()||'None',
              tiers:m.tiers?NP_TIERS.slice():[{from:0,rate:base}],
              params:readModelParams(modelId,'np_p_')};
  closeModal();
  const p=addPlan(spec);
  App.go(App.view);
  toast(p.name+' created as a draft — '+m.name.toLowerCase()+' at '+p.base+
        (m.rateUnit==='%'?'%':'')+', no partners assigned yet');
}
function addPlan(spec){
  SEQ.plan=(SEQ.plan||0)+1;
  const m=CMMAP[spec.modelId];
  const id='CP-NEW-'+SEQ.plan;
  const p={id:id, name:spec.name, vertical:spec.vertical, model:m.name, modelId:m.id,
           base:spec.base, tiers:spec.tiers, fees:spec.fees, cycle:spec.cycle, hold:spec.hold,
           partners:0, params:spec.params, status:'draft', isNew:true};
  COMM_PLANS.push(p); CPMAP[id]=p;
  recomputeDerived();
  return p;
}

/* --------------------- define a new commercial model ---------------------- */
function newCommercialModelDialog(){
  NCM_PARAMS=[];
  openModal('<div class="modal-head">'+ICO('file',18)+'<div class="grow"><h3 class="t-sub">New commercial model</h3>'+
    '<div class="t-small muted">A model defines how money is shared and which parameters a plan then needs.</div></div>'+
    '<button class="iconbtn" onclick="closeModal()" aria-label="Close">'+ICO('x',16)+'</button></div>'+
    '<div class="modal-body stack">'+
      '<div class="grid g2">'+
        '<div class="field"><label for="cmName">Model name</label>'+
          '<input class="inp" id="cmName" data-autofocus placeholder="e.g. Outcome-based revenue share">'+
          '<div class="err" id="cmNameErr" hidden>'+ICO('alert',12)+'A model needs a name.</div></div>'+
        '<div class="field"><label for="cmRate">What the headline rate is called</label>'+
          '<input class="inp" id="cmRate" value="Marketplace share (%)"></div>'+
      '</div>'+
      '<div class="field"><label for="cmBlurb">When to use it</label>'+
        '<textarea class="inp" id="cmBlurb" rows="2" placeholder="One sentence a commercial manager can act on"></textarea>'+
        '<div class="err" id="cmBlurbErr" hidden>'+ICO('alert',12)+
          'Say when this model is the right one. A model nobody can place is a model nobody uses.</div></div>'+
      '<div class="grid g2">'+
        '<div class="field"><label for="cmUnit">Rate is expressed in</label><select class="inp" id="cmUnit">'+
          '<option value="%">A percentage</option><option value="$">A money amount</option></select></div>'+
        '<div class="field"><label for="cmBasis">Tier basis</label><select class="inp" id="cmBasis">'+
          '<option value="">No tiers — one flat rate</option>'+
          '<option>Trailing 12-month gross value</option><option>Trailing 12-month net revenue</option>'+
          '<option>Trailing 12-month recurring revenue</option><option>Trailing 12-month purchase value</option>'+
          '<option>Units sold in the period</option></select></div>'+
      '</div>'+
      '<div><div class="row" style="margin-bottom:6px"><span class="t-small strong grow">Parameters a plan on this model needs</span>'+
        '<button class="btn btn-sm" onclick="cmAddParam()">'+ICO('plus',13)+'Add a parameter</button></div>'+
        '<div id="cmParamBox">'+cmParamTable()+'</div></div>'+
      '<div class="impact"><strong>Why models are separate from plans</strong><ul>'+
        '<li>A plan on this model asks only for the parameters listed above, so a wholesale plan never asks about cooling-off periods.</li>'+
        '<li>Existing plans are untouched. A model is only used by plans created after it.</li>'+
        '<li>Built-in models cannot be deleted because signed schedules reference them by name.</li></ul></div>'+
    '</div>'+
    '<div class="modal-foot"><span class="t-tiny muted grow">'+COMMERCIAL_MODELS.length+' models exist today.</span>'+
      '<button class="btn btn-quiet" onclick="closeModal()">Cancel</button>'+
      '<button class="btn btn-primary" onclick="submitCommercialModel()">Create model</button></div>',
    {wide:true,label:'New commercial model'});
}
let NCM_PARAMS=[];
function cmParamTable(){
  if(!NCM_PARAMS.length){
    return '<div class="t-tiny muted" style="padding:9px 0">No parameters yet. A model can have none — a flat '+
      'percentage with no conditions is a legitimate model, just an unusual one.</div>';
  }
  return '<table class="tbl"><thead><tr><th>Label</th><th style="width:130px">Type</th>'+
    '<th style="width:110px">Default</th><th></th></tr></thead><tbody>'+
    NCM_PARAMS.map((p,i)=>'<tr>'+
      '<td><input class="inp inp-sm" value="'+esc(p.label)+'" onchange="cmSetParam('+i+',\'label\',this.value)" '+
        'aria-label="Parameter '+(i+1)+' label"></td>'+
      '<td><select class="inp inp-sm" onchange="cmSetParam('+i+',\'type\',this.value)" aria-label="Parameter type">'+
        [['pct','Percentage'],['money','Money'],['int','Whole number'],['bool','Yes or no'],['choice','Choice']]
        .map(o=>'<option value="'+o[0]+'"'+(p.type===o[0]?' selected':'')+'>'+o[1]+'</option>').join('')+'</select></td>'+
      '<td><input class="inp inp-sm" value="'+esc(String(p.def))+'" onchange="cmSetParam('+i+',\'def\',this.value)" '+
        'aria-label="Parameter default"></td>'+
      '<td class="acts"><button class="btn btn-sm btn-quiet" onclick="cmRemoveParam('+i+')">Remove</button></td>'+
    '</tr>').join('')+'</tbody></table>';
}
function cmRedrawParams(){ const b=$('#cmParamBox'); if(b) b.innerHTML=cmParamTable(); }
function cmAddParam(){
  NCM_PARAMS.push({k:'p'+(NCM_PARAMS.length+1), label:'', type:'pct', def:0});
  cmRedrawParams();
  /* Focus the label of the row just added, so a keyboard user can type straight
     into it. Guarded, because the table redraws asynchronously in some hosts. */
  const rows=document.querySelectorAll('#cmParamBox tbody tr');
  const last=rows[rows.length-1];
  const first=last && last.querySelector('input');
  if(first) first.focus();
}
function cmSetParam(i,k,v){
  if(k==='def'){
    const t=NCM_PARAMS[i].type;
    NCM_PARAMS[i].def = t==='bool' ? /true|yes|on/i.test(v) : t==='choice' ? v : (parseFloat(v)||0);
  } else {
    NCM_PARAMS[i][k]=v;
    if(k==='label') NCM_PARAMS[i].k = 'p'+(i+1)+'_'+String(v).toLowerCase().replace(/[^a-z0-9]+/g,'').slice(0,12);
    if(k==='type') NCM_PARAMS[i].def = v==='bool' ? false : v==='choice' ? 'Option A' : 0;
  }
  cmRedrawParams();
}
function cmRemoveParam(i){ NCM_PARAMS.splice(i,1); cmRedrawParams(); }
function submitCommercialModel(){
  const g=id=>document.getElementById(id);
  const name=(g('cmName').value||'').trim();
  const blurb=(g('cmBlurb').value||'').trim();
  const badName=!name, badBlurb=blurb.length<10;
  g('cmNameErr').hidden=!badName; g('cmBlurbErr').hidden=!badBlurb;
  if(badName||badBlurb){ (badName?g('cmName'):g('cmBlurb')).focus(); return; }
  const unnamed=NCM_PARAMS.filter(p=>!String(p.label).trim());
  if(unnamed.length){ toast('Every parameter needs a label — an unlabelled field is unusable','warn'); return; }
  const basis=g('cmBasis').value;
  const spec={name:name, blurb:blurb, rateLabel:(g('cmRate').value||'').trim()||'Rate',
              rateUnit:g('cmUnit').value, tierBasis:basis||null, tiers:!!basis,
              params:NCM_PARAMS.map(p=>({k:p.k,label:p.label,type:p.type,def:p.def,
                                         options:p.type==='choice'?['Option A','Option B']:undefined}))};
  closeModal();
  const m=addCommercialModel(spec);
  /* If the plan wizard is still behind this dialog, select the new model in it. */
  const sel=$('#npModel');
  if(sel){
    sel.innerHTML=COMMERCIAL_MODELS.map(x=>'<option value="'+x.id+'"'+(x.id===m.id?' selected':'')+
      '>'+esc(x.name)+'</option>').join('');
    onModelChange('np');
  } else {
    App.go(App.view);
  }
  toast(m.name+' created — '+m.params.length+' parameter'+(m.params.length===1?'':'s')+
        (m.tiers?', tiered':', flat rate'));
}
function addCommercialModel(spec){
  SEQ.model=(SEQ.model||0)+1;
  const id='CM-NEW'+SEQ.model;
  const m={id:id, name:spec.name, system:false, blurb:spec.blurb,
           rateLabel:spec.rateLabel, rateUnit:spec.rateUnit,
           tiers:spec.tiers, tierBasis:spec.tierBasis, params:spec.params||[], isNew:true};
  COMMERCIAL_MODELS.push(m); CMMAP[id]=m;
  return m;
}

/* --------------------------- edit an existing plan ------------------------ */
function editPlanParams(id){
  const p=CPMAP[id]; if(!p) return;
  const m=CMMAP[p.modelId]||CMMAP['CM-COMM'];
  closeInspector();
  openModal('<div class="modal-head">'+ICO('file',18)+'<div class="grow"><h3 class="t-sub">'+esc(p.name)+' — parameters</h3>'+
    '<div class="t-small muted">'+esc(m.name)+' · '+p.partners+' partner'+(p.partners===1?'':'s')+' on this plan</div></div>'+
    '<button class="iconbtn" onclick="closeModal()" aria-label="Close">'+ICO('x',16)+'</button></div>'+
    '<div class="modal-body stack">'+
      '<div class="t-small muted">'+esc(m.blurb)+'</div>'+
      (m.params.length
        ? modelParamsHtml(m.id,p.params,'ep_p_')
        : '<div class="t-small nodata">This model has no parameters beyond the headline rate.</div>')+
      banner('info','Parameters take effect from the next settlement period. They are not the rate — changing the rate '+
        'needs 30 days notice and is done from <em>Edit rates</em>.')+
    '</div>'+
    '<div class="modal-foot"><button class="btn btn-quiet" onclick="closeModal()">Cancel</button>'+
      '<div class="spacer"></div>'+
      '<button class="btn btn-primary" onclick="savePlanParams(\''+id+'\')">Save parameters</button></div>',
    {wide:true,label:p.name+' parameters'});
}
function savePlanParams(id){
  const p=CPMAP[id]; if(!p) return;
  p.params=readModelParams(p.modelId,'ep_p_');
  closeModal(); App.go(App.view);
  toast(p.name+' parameters saved — effective from the next settlement period');
}
function clonePlan(id){
  const src=CPMAP[id]; if(!src) return;
  const p=addPlan({name:src.name+' (copy)', vertical:src.vertical, modelId:src.modelId,
                   base:src.base, cycle:src.cycle, hold:src.hold, fees:src.fees,
                   tiers:src.tiers.map(t=>({from:t.from,rate:t.rate})),
                   params:Object.assign({},src.params)});
  closeInspector(); App.go(App.view);
  toast(p.name+' created as a draft with nobody assigned');
}

/* --------------------------- 7. Settlement runs --------------------------- */
function vSettlements(){
  const byPeriod={};
  SETTLEMENTS.forEach(s=>{ (byPeriod[s.period]=byPeriod[s.period]||[]).push(s); });
  const cur=byPeriod[PERIODS[0]]||[];
  const curGross=cur.reduce((a,s)=>a+s.gross,0);
  const curComm=cur.reduce((a,s)=>a+s.commission,0);
  const curNet=cur.reduce((a,s)=>a+s.net,0);
  return pagehead('Settlement runs',
    SETTLEMENTS.length+' statements across '+PERIODS.length+' periods · '+CUR0(PAYOUT_DUE)+' due to partners',
    exportBtn('Settlement register','dtStm')+
    '<button class="btn btn-primary" onclick="approveRun()">'+ICO('checkcircle',14)+'Approve '+PERIODS[0]+' run</button>')+
  '<div class="stack">'+
  banner('warning','<strong>'+SET_PENDING.length+' statements in the '+PERIODS[0]+' run are awaiting approval.</strong> Nothing pays out until the run is approved. Statements with an open dispute are held automatically. '+
    'Open any row to read the self-billing invoice — order lines, deductions and tax — before you approve it.')+
  '<div class="grid g4">'+
    metric({icon:'wallet',label:'Gross in run',value:CUR0(curGross),foot:PERIODS[0]+' · '+cur.length+' partners'})+
    metric({icon:'pie',label:'Marketplace commission',value:CUR0(curComm),foot:'Effective '+(curComm/curGross*100).toFixed(1)+'%'})+
    metric({icon:'invoice',label:'Net to partners',value:CUR0(curNet),foot:'After commission, fees and withholding'})+
    metric({icon:'clock',label:'Payout date',value:'15 Aug',foot:'Monthly cycle, net 15 and net 30'})+
  '</div>'+
  panel(PERIODS[0]+' run',
    '<div class="splitbar" style="height:30px" role="img" aria-label="Run split">'+
      '<span class="s-partner" style="width:'+(curNet/curGross*100)+'%">Partners '+CUR0(curNet)+'</span>'+
      '<span class="s-operator" style="width:'+(curComm/curGross*100)+'%">Commission '+CUR0(curComm)+'</span>'+
      '<span class="s-fee" style="width:'+Math.max(6,(curGross-curNet-curComm)/curGross*100)+'%">Fees</span>'+
    '</div>'+
    '<div class="divider"></div>'+
    dt('dtRun',{
      rows:cur, noun:'statements', pageSize:10, toolbar:false, sortKey:'net', sortDir:'desc',
      idKey:'id', onRow:"openStatement('$ID')",
      columns:[
        {key:'partner',label:'Partner',render:r=>'<div class="cellmain">'+esc(r.partner)+'</div><div class="cellsub t-num">'+esc(r.id)+'</div>'},
        {key:'planName',label:'Plan',render:r=>'<span class="t-small">'+esc(r.planName)+'</span>'},
        {key:'orders',label:'Orders',align:'right',render:r=>'<span class="t-num">'+r.orders+'</span>'},
        {key:'gross',label:'Gross',align:'right',render:r=>'<span class="t-num">'+CUR(r.gross)+'</span>'},
        {key:'commission',label:'Commission',align:'right',render:r=>'<span class="t-num">'+CUR(r.commission)+'</span>'},
        {key:'wht',label:'Withholding',align:'right',render:r=>r.wht?'<span class="t-num">'+CUR(r.wht)+'</span>':'<span class="dim">—</span>'},
        {key:'net',label:'Net payout',align:'right',render:r=>'<span class="t-num cellmain">'+CUR(r.net)+'</span>'},
        {key:'method',label:'Method',render:r=>'<span class="t-small">'+esc(r.method)+'</span>'},
        {key:'status',label:'State',render:r=>statusPill(r.status)},
        /* The approve action only exists on a pending row, so the slot beside
           it is filled rather than left empty — otherwise View invoice walks
           left and right down the column. */
        {key:'__acts',label:'',sort:false,render:r=>actionCell(
          '<button class="btn btn-sm btn-quiet" onclick="event.stopPropagation();openStatement(\''+r.id+
            '\')">View invoice</button>',
          settleActionSlot(r))}
      ]}),
    {flush:false,icon:'wallet'})+
  panel('All statements', dt('dtStm',{
    rows:SETTLEMENTS, noun:'statements', pageSize:12, sortKey:'period', sortDir:'desc',
    idKey:'id', onRow:"openStatement('$ID')",
    searchFields:['id','partner','period','planName'], searchPlaceholder:'Search statement, partner or period',
    chips:[{key:'status',options:[{label:'Pending',value:'pending'},{label:'Approved',value:'approved'},{label:'Paid',value:'paid'}]},
           {key:'period',options:PERIODS.map(p=>({label:p,value:p}))}],
    actions:exportBtn('Statements'),
    columns:[
      {key:'period',label:'Period',render:r=>'<div class="cellmain">'+esc(r.period)+'</div><div class="cellsub t-num">'+esc(r.id)+'</div>'},
      {key:'partner',label:'Partner',render:r=>esc(r.partner)},
      {key:'orders',label:'Orders',align:'right',render:r=>'<span class="t-num">'+r.orders+'</span>'},
      {key:'gross',label:'Gross',align:'right',render:r=>'<span class="t-num">'+CUR(r.gross)+'</span>'},
      {key:'commission',label:'Commission',align:'right',render:r=>'<span class="t-num">'+CUR(r.commission)+'</span>'},
      {key:'net',label:'Net',align:'right',render:r=>'<span class="t-num cellmain">'+CUR(r.net)+'</span>'},
      {key:'paidOn',label:'Paid',render:r=>r.paidOn?esc(r.paidOn):'<span class="dim">Not yet</span>'},
      {key:'status',label:'State',render:r=>statusPill(r.status)},
      /* The same column as the run above. A statement you can open in one
         table and not in the other is the same screen disagreeing with
         itself, and the register is where an auditor looks first. */
      {key:'__acts',label:'',sort:false,render:r=>actionCell(
        '<button class="btn btn-sm btn-quiet" onclick="event.stopPropagation();openStatement(\''+r.id+
          '\')">View invoice</button>',
        settleActionSlot(r))}
    ]}),{flush:true,icon:'history'})+
  '</div>';
}
function approveStatement(id){
  const st=SETTLEMENTS.find(x=>x.id===id); if(!st) return;
  st.status='approved'; recomputeDerived(); closeInspector();
  toast(st.partner+' — '+st.period+' approved for '+CUR(st.net));
  App.go('settlements');
}
function approveRun(){
  const cur=SETTLEMENTS.filter(s=>s.period===PERIODS[0]);
  const net=cur.reduce((a,s)=>a+s.net,0);
  confirmAction({
    title:'Approve the '+PERIODS[0]+' settlement run', subtitle:cur.length+' statements · '+CUR(net)+' to partners',
    risk:'high', confirmLabel:'Approve run', requireType:'APPROVE',
    impact:['<strong>'+CUR(net)+'</strong> is released to '+cur.length+' partners on the cycle date.',
            'Statements with an open dispute are held back automatically and roll into the next run.',
            'Withholding is applied where a valid tax certificate is not on file — two partners are affected this period.',
            'Approval is recorded against your identity and cannot be reversed once payment files are generated.'],
    footNote:'Payment files go to the bank at 17:00 on the cycle date. Anything wrong must be caught before then.',
    onConfirm:()=>{
      const n=approveSettlementRun(PERIODS[0]);
      toast(n+' statement'+(n===1?'':'s')+' approved — '+CUR0(net)+' scheduled for 15 Aug');
      App.go('settlements');
    }
  });
}

/* ------------------------- 8. Order operations ---------------------------- */
function vOrderOps(){
  return pagehead('Order operations',
    ORDERS.length+' orders · '+ORD_OPEN.length+' in flight · '+ORD_FAIL.length+' failed and needing intervention',
    exportBtn('Order register','dtOps')+
    '<button class="btn" onclick="toast(\'Exception rules opened\')">'+ICO('settings',13)+'Exception rules</button>')+
  '<div class="stack">'+
  (ORD_FAIL.length?banner('danger','<strong>'+ORD_FAIL.length+' orders failed.</strong> These never settle and count against the seller\'s fulfilment rating. '+
    'The buyer has been notified in every case.'):'')+
  '<div class="grid g4">'+
    metric({icon:'orders',label:'Orders',value:String(ORDERS.length),foot:CUR0(GMV)+' gross value'})+
    metric({icon:'clock',label:'In flight',value:String(ORD_OPEN.length),foot:'Across '+new Set(ORD_OPEN.map(o=>o.seller)).size+' sellers'})+
    metric({icon:'alert',label:'Failed',value:String(ORD_FAIL.length),foot:CUR0(ORD_FAIL.reduce((a,o)=>a+o.gross,0))+' of value at risk'})+
    metric({icon:'checkcircle',label:'Completed',value:String(ORD_DONE.length),foot:(ORD_DONE.length/ORDERS.length*100).toFixed(0)+'% of orders'})+
  '</div>'+
  '<div class="grid g2">'+
    panel('Orders by marketplace',
      CH.bars(VERTICALS.map(v=>({l:v.name.split(' ')[0],v:ORDERS.filter(o=>o.v===v.id).length})),
        {h:180,fmt:n=>Math.round(n),tip:n=>n+' orders',aria:'Orders by marketplace'}),{icon:'chart'})+
    panel('Failure reasons',
      ORD_FAIL.length
        ? CH.donut([{l:'Delivery attempt failed',v:Math.ceil(ORD_FAIL.length*0.5)},
                    {l:'Payment declined',v:Math.floor(ORD_FAIL.length*0.3)},
                    {l:'Provisioning not confirmed',v:ORD_FAIL.length-Math.ceil(ORD_FAIL.length*0.5)-Math.floor(ORD_FAIL.length*0.3)}]
                    .filter(x=>x.v>0),
            {centre:String(ORD_FAIL.length),centreSub:'failed',fmt:n=>n+' orders',aria:'Failure reasons'})
        : stateBlock('empty','No failures','Every order completed its pipeline.'),
      {icon:'pie'})+
  '</div>'+
  panel(null, dt('dtOps',{
    rows:ORDERS, noun:'orders', pageSize:12, sortKey:'id', sortDir:'desc', onRow:"openOrder('$ID',{showComm:true})",
    searchFields:['id','name','buyer','seller','cat'], searchPlaceholder:'Search order, buyer, seller or product',
    chips:[{key:'v',options:VERTICALS.map(v=>({label:v.name.replace(' Marketplace',''),value:v.id}))},
           {key:'buyerType',options:[{label:'Consumer',value:'Consumer'},{label:'Enterprise',value:'Enterprise'}]}],
    actions:exportBtn('Orders'),
    columns:[
      {key:'id',label:'Order',render:r=>'<div class="cellmain t-num">'+esc(r.id)+'</div><div class="cellsub">'+esc(r.placed)+'</div>'},
      {key:'name',label:'Product',render:r=>'<div class="cellmain">'+esc(r.name)+'</div><div class="cellsub">'+esc(r.cat)+'</div>'},
      {key:'v',label:'Marketplace',render:r=>vBadge(r.v)},
      {key:'seller',label:'Seller',render:r=>esc(r.seller)},
      {key:'buyer',label:'Buyer',render:r=>esc(r.buyer)+'<div class="cellsub">'+esc(r.buyerType)+'</div>'},
      {key:'gross',label:'Gross',align:'right',render:r=>'<span class="t-num cellmain">'+CUR(r.gross)+'</span>'},
      {key:'comm',label:'Commission',align:'right',render:r=>r.comm?'<span class="t-num">'+CUR(r.comm)+'</span>':'<span class="dim">—</span>'},
      {key:'stage',label:'Status',render:r=>orderStatePill(r)},
      {key:'__acts',label:'',sort:false,render:r=>r.failed
        ? '<button class="btn btn-sm btn-primary" onclick="event.stopPropagation();intervene(\''+r.id+'\')">Intervene</button>'
        : ''}
    ]}),{flush:true})+
  '</div>';
}

function intervene(id){
  const o=ORDERS.find(x=>x.id===id); if(!o) return;
  confirmAction({
    title:'Intervene on '+o.id, subtitle:o.name+' · '+o.seller+' · '+CUR(o.gross), risk:'normal',
    confirmLabel:'Apply the outcome',
    body:'<div class="field"><label for="ivWhat">Outcome</label><select class="inp" id="ivWhat" data-autofocus>'+
      '<option value="retry">Retry fulfilment — put it back in the pipeline</option>'+
      '<option value="cancel">Cancel and refund the buyer</option></select></div>'+
      '<div class="field" style="margin-top:12px"><label for="ivWhy">Note (visible to buyer and seller)</label>'+
      '<textarea class="inp" id="ivWhy"></textarea></div>',
    impact:['A retried order re-enters the pipeline at <strong>'+esc(o.stages[o.stage])+'</strong> and can settle normally.',
            'A cancelled order refunds the buyer and never settles — '+CUR(o.gross)+' leaves the seller\'s statement.',
            'Either way both parties are notified with your note.',
            'The intervention is recorded against '+esc(o.seller)+'\'s fulfilment record.'],
    onConfirm:(vals)=>{
      const retry=((vals||{}).ivWhat||'retry')==='retry';
      if(retry){ o.failed=false; o.stage=Math.min(o.stage+1,o.stages.length-1); }
      else { o.failed=false; o.cancelled=true; o.gross=0; o.comm=0; o.stage=o.stages.length-1; }
      recomputeDerived();
      toast(retry ? o.id+' retried — back in the pipeline' : o.id+' cancelled and refunded');
      App.go('orderops');
    }
  });
}

/* ------------------------------ 9. Disputes ------------------------------- */
function vDisputes(){
  const open=DISPUTES.filter(d=>d.status!=='resolved');
  return pagehead('Disputes and refunds',
    open.length+' open · '+CUR0(open.reduce((a,d)=>a+d.amount,0))+' held from settlement while they run',
    '<button class="btn" onclick="toast(\'Dispute policy opened\')">'+ICO('file',13)+'Dispute policy</button>'+
    exportBtn('Disputes','dtDisp'))+
  '<div class="stack">'+
  (DISPUTES.filter(d=>d.sla==='Breached').length
    ? banner('danger','<strong>One dispute has breached its resolution SLA.</strong> DSP-333 has run 8 days against a 5-day target. '+
      'The buyer is entitled to escalate and the marketplace carries the refund if the partner does not respond.')
    : '')+
  '<div class="grid g4">'+
    metric({icon:'flag',label:'Open disputes',value:String(open.length),foot:open.filter(d=>d.owner==='Marketplace').length+' with us · '+open.filter(d=>d.owner==='Partner').length+' with the partner'})+
    metric({icon:'wallet',label:'Value held',value:CUR0(open.reduce((a,d)=>a+d.amount,0)),foot:'Withheld from partner settlement'})+
    metric({icon:'clock',label:'Median resolution',value:'3.2 days',foot:'Target 5 days'})+
    metric({icon:'pie',label:'Dispute rate',value:(DISPUTES.length/ORDERS.length*100).toFixed(1)+'%',foot:'Of all orders in the period'})+
  '</div>'+
  panel('Disputes', dt('dtDisp',{
    rows:DISPUTES, noun:'disputes', pageSize:10, sortKey:'raised',
    searchFields:['id','order','buyer','partner','reason'], searchPlaceholder:'Search dispute, order, buyer or partner',
    chips:[{key:'status',options:[{label:'Open',value:'open'},{label:'With partner',value:'partner'},
      {label:'Escalated',value:'escalated'},{label:'Resolved',value:'resolved'}]}],
    actions:exportBtn('Disputes'),
    columns:[
      {key:'id',label:'Dispute',render:r=>'<div class="cellmain t-num">'+esc(r.id)+'</div><div class="cellsub t-num">'+esc(r.order)+'</div>'},
      {key:'reason',label:'Reason',render:r=>'<div class="cellmain">'+esc(r.reason)+'</div><div class="cellsub">raised '+esc(r.raised)+'</div>'},
      {key:'v',label:'Marketplace',render:r=>vBadge(r.v)},
      {key:'buyer',label:'Buyer',render:r=>esc(r.buyer)},
      {key:'partner',label:'Seller',render:r=>esc(r.partner)},
      {key:'amount',label:'Value',align:'right',render:r=>'<span class="t-num cellmain">'+CUR(r.amount)+'</span>'},
      {key:'sla',label:'SLA',render:r=>r.sla==='Breached'?pill('breached','Breached'):
        /Closed/.test(r.sla)?pill('approved',r.sla):pill('pending',r.sla)},
      {key:'owner',label:'Owner',render:r=>r.owner==='Partner'?pill('inprogress','Partner'):pill('info','Marketplace')},
      {key:'status',label:'State',render:r=>statusPill(r.status)},
      {key:'__acts',label:'',sort:false,render:r=>r.status==='resolved'
        ? '<button class="btn btn-sm btn-quiet" onclick="toast(\'Outcome opened\')">Outcome</button>'
        : '<button class="btn btn-sm btn-primary" onclick="resolveDispute(\''+r.id+'\')">Decide</button>'}
    ]}),{flush:true,icon:'flag'})+
  panel('Who carries the cost',
    '<div class="grid g2"><div class="stack" style="gap:9px">'+
    [['Item not as described','Seller','Refund taken from the seller\'s settlement'],
     ['Partial or non-delivery','Seller','Refund plus a fulfilment strike against the seller'],
     ['Duplicate or incorrect charge','Marketplace','Payment error — the marketplace refunds and reconciles'],
     ['Service not provisioned','Seller','Escalates to a partner review after three in a quarter'],
     ['Buyer changed their mind','Buyer','Within the returns window, return shipping at the buyer\'s cost']]
    .map(r=>'<div class="row" style="align-items:flex-start"><div class="grow"><div class="t-small strong">'+esc(r[0])+'</div>'+
      '<div class="t-tiny muted">'+esc(r[2])+'</div></div>'+
      (r[1]==='Seller'?pill('inprogress','Seller'):r[1]==='Marketplace'?pill('info','Marketplace'):pill('neutral','Buyer'))+'</div>').join('')+
    '</div><div class="stack" style="gap:11px">'+
      '<div class="t-small">The allocation matters because it decides whose settlement is debited. Getting it wrong is the fastest way to lose a partner\'s trust in the platform.</div>'+
      '<div class="divider"></div>'+
      '<div class="row"><span class="t-small grow">Refunds charged to sellers this period</span><span class="t-small strong t-num">'+
        CUR(SETTLEMENTS.filter(s=>s.period===PERIODS[0]).reduce((a,s)=>a+s.refunds,0))+'</span></div>'+
      '<div class="row"><span class="t-small grow">Refunds absorbed by the marketplace</span><span class="t-small strong t-num">'+CUR(12.99)+'</span></div>'+
    '</div></div>',{icon:'checklist'})+
  '</div>';
}
function resolveDispute(id){
  const d=DISPUTES.find(x=>x.id===id); if(!d) return;
  confirmAction({
    title:'Decide '+d.id, subtitle:d.reason+' · '+CUR(d.amount)+' · '+d.partner, risk:'normal',
    confirmLabel:'Record decision',
    body:'<div class="field"><label for="rdOut">Outcome</label><select class="inp" id="rdOut" data-autofocus>'+
      '<option>Refund the buyer in full — charged to the seller</option>'+
      '<option>Refund the buyer in full — absorbed by the marketplace</option>'+
      '<option>Partial refund</option><option>Reject the dispute — seller upheld</option></select></div>'+
      '<div class="field" style="margin-top:12px"><label for="rdWhy">Reason (shared with both parties)</label>'+
      '<textarea class="inp" id="rdWhy" placeholder="What the evidence showed"></textarea></div>',
    impact:['<strong>'+CUR(d.amount)+'</strong> is released from hold and settled according to the outcome you choose.',
            'Both the buyer and '+esc(d.partner)+' are notified with your reason.',
            'A decision against the seller counts toward their fulfilment record; three in a quarter triggers a partner review.',
            'Decisions can be appealed once, within 14 days.'],
    footNote:'Decide on evidence, not on which party is larger.',
    onConfirm:()=>{ d.status='resolved'; d.sla='Closed today'; d.owner='Marketplace'; recomputeDerived();
      toast(d.id+' resolved — both parties notified'); App.go('disputes'); }
  });
}

/* ------------------- 10. Users and roles (operator staff) ----------------- */
function vOpsUsers(){
  return usersView({
    ctx:'operator', title:'Users and roles', userNoun:'user',
    inviteLabel:'Invite a user', dirTitle:'Operator staff',
    roleSub:'Separation of duties is the point: the desk that clears a gate cannot also approve the money that follows it.',
    mfaNote:'Required for anyone who can approve a payout',
    banner:banner('warning','<strong>One account is suspended pending an access review</strong> and one invitation has been outstanding since 21 Jul. '+
      'Both are the kind of thing an auditor asks about first.')
  });
}

/* Screens that are charts rather than lists still export the real figures. */
registerExport('opsOverview',()=>({
  columns:[{key:'marketplace',label:'Marketplace'},{key:'audience',label:'Audience'},
           {key:'partners',label:'Partners'},{key:'listings',label:'Listings'},
           {key:'orders',label:'Orders'},{key:'gmv',label:'GMV (USD)'},
           {key:'thirdPartyGmv',label:'Third-party GMV (USD)'},
           {key:'firstPartyGmv',label:'First-party GMV (USD)'},
           {key:'commission',label:'Commission on third party (USD)'},
           {key:'takeRate',label:'Take rate on third party %'}],
  /* First-party revenue carries no commission because the operator already
     keeps all of it. Reporting a blended take rate would understate the
     business, so the two are separated rather than averaged. */
  rows:VERTICALS.map(v=>{
    const own=ORDERS.filter(o=>o.v===v.id);
    const tp=own.filter(o=>o.partnerId), fp=own.filter(o=>!o.partnerId);
    const tpGmv=+tp.reduce((a,o)=>a+o.gross,0).toFixed(2);
    const comm=+tp.reduce((a,o)=>a+o.comm,0).toFixed(2);
    return {marketplace:v.name, audience:v.aud,
            partners:PARTNERS.filter(p=>p.verticals.indexOf(v.id)>-1).length,
            listings:PRODUCTS.filter(p=>p.v===v.id).length,
            orders:own.length,
            gmv:+own.reduce((a,o)=>a+o.gross,0).toFixed(2),
            thirdPartyGmv:tpGmv,
            firstPartyGmv:+fp.reduce((a,o)=>a+o.gross,0).toFixed(2),
            commission:comm,
            takeRate: tpGmv ? +(comm/tpGmv*100).toFixed(2) : 'No third-party sales'};
  })
}));

/* --------------------- 9c. Tax configuration ------------------------------ */
function vOpsTax(){
  return pagehead('Tax configuration',
    TAX_REGIMES.filter(t=>t.status==='active').length+' jurisdictions registered · '+
    'merchant of record decides who charges and who remits',
    exportBtn('Tax registrations','dtTax')+
    '<button class="btn" onclick="App.go(\'billing\')">'+ICO('invoice',13)+'Billing configuration</button>')+
  taxRegimeView();
}

/* --------------------- 9b. Billing configuration -------------------------- */
function vOpsBilling(){
  const rows = partnerBillingRows();
  const over = rows.filter(r=>r.override);
  const byCycle = {};
  rows.forEach(r=>{ byCycle[r.cycle]=(byCycle[r.cycle]||0)+1; });
  const selfBill = rows.filter(r=>r.selfBill).length;
  return pagehead('Billing configuration',
    'How settlement documents are rendered, and what cycle each partner is actually billed on',
    exportBtn('Billing configuration','dtPBill')+
    '<button class="btn" onclick="App.go(\'settlements\')">'+ICO('wallet',13)+'Settlement runs</button>')+
  '<div class="stack">'+
  billTemplatesPanel()+


  banner('info','<strong>The plan sets a default; the partner record is what runs.</strong> '+
    over.length+' of '+rows.length+' partners sit on an override, so reading the plan alone will tell you the wrong payout date for '+
    over.map(r=>esc(r.name)).join(', ')+'.')+

  '<div class="grid g4">'+
    metric({icon:'clock',label:'Cycles in use',value:String(Object.keys(byCycle).length),
      foot:Object.keys(byCycle).map(c=>c.toLowerCase()+' '+byCycle[c]).join(' · ')})+
    metric({icon:'flag',label:'Overrides',value:String(over.length),
      foot:over.length?'Each has a recorded reason':'Everyone is on their plan default'})+
    metric({icon:'invoice',label:'Self-billing',value:String(selfBill)+' of '+rows.length,
      foot:'The marketplace raises the invoice for these partners'})+
    metric({icon:'file',label:'Next document number',value:BTMAP[BILL_TEMPLATE_ASSIGN.partner].numbering
      .replace('{YYYY}','2026').replace('{PARTNER}','····').replace('{SEQ}',String(BTMAP[BILL_TEMPLATE_ASSIGN.partner].nextSeq)),
      foot:'Pattern is editable below'})+
  '</div>'+

  billFormatPanel('operator')+
  billingCycleView()+
  panel('Tax',
    '<div class="row wrap" style="gap:14px">'+
      '<div class="grow"><div class="t-small">Tax registration, merchant-of-record status and partner withholding are '+
      'configured separately, because they change by jurisdiction rather than by partner.</div>'+
      '<div class="t-tiny muted" style="margin-top:5px">'+
      TAX_REGIMES.filter(t=>t.status==='active').length+' registered · '+
      Object.keys(TAX_CERTS).filter(k=>!TAX_CERTS[k].certOnFile).length+' partners without a tax certificate</div></div>'+
      '<button class="btn" onclick="App.go(\'tax\')">'+ICO('globe',13)+'Open tax configuration</button>'+
    '</div>',{icon:'globe'})+

  panel('What the cycles cost you',
    '<div class="stack" style="gap:9px">'+
    BILL_CYCLES.filter(c=>byCycle[c]).map(c=>{
      const n=byCycle[c], pct=n/rows.length*100;
      return '<div><div class="row"><span class="t-small grow">'+esc(c)+'</span>'+
        '<span class="t-num t-small">'+n+' partner'+(n===1?'':'s')+'</span></div>'+
        '<div class="bar" style="margin-top:4px"><span style="width:'+pct.toFixed(0)+'%"></span></div></div>';
    }).join('')+
    '</div>'+
    '<div class="divider"></div>'+
    '<p class="t-small muted" style="margin:0">Shorter cycles are a working-capital transfer from the marketplace to the '+
    'partner, not a free courtesy. Fortnightly settlement roughly doubles the number of payment files, reconciliations and '+
    'failure points for the same revenue — which is why it is worth knowing exactly who is on one and why.</p>',
    {icon:'chart'})+
  '</div>';
}

/* --------------------- 18. Reviews ---------------------------------------- */
function vOpsReviews(){ return reviewQueueView(); }

/* --------------------- 17. Support tickets -------------------------------- */
function vOpsTickets(){
  return ticketsView({ctx:'operator', title:'Support tickets'});
}

/* --------------------- 16. Inventory -------------------------------------- */
function vOpsInventory(){
  /* Warehouse configuration sits above the stock, because a stock line has to
     be held somewhere before the number means anything. */
  return inventoryView({title:'Inventory', showSim:true, showPools:true,
    append: warehousePanel()+whRoutingPanel()+stockMapPanel()+wmsPanel()});
}

/* --------------------- 13. Audit log -------------------------------------- */
function vOpsAudit(){
  return auditView({ctx:'operator', title:'Audit log', extra:auditIntegrityPanel(),
    banner:banner('info','<strong>The audit trail is append-only.</strong> No administrator, and no platform owner, '+
      'can edit or delete an entry — a log that can be changed is not evidence. Reading it is itself recorded, '+
      'including this visit. What you can read is decided by your role, not by your seniority.')});
}

/* --------------------- 12. My details ------------------------------------- */
function vOpsProfile(){
  return myDetailsView({ctx:'operator', org:MP.operator,
    delegateNote:'A delegate can clear gates and review listings in your place. They cannot approve a settlement run — '+
      'that authority does not delegate, because it is the one that moves money.'});
}

/* --------------------- 10b. Roles configuration --------------------------- */
function vOpsRoles(){
  return rolesView({
    ctx:'operator', title:'Roles configuration',
    banner:banner('warning','<strong>Separation of duties is the control an auditor tests first.</strong> '+
      'The desk that clears an onboarding gate must not also be able to approve the settlement run that follows it. '+
      'The grid below is where that separation is either kept or quietly lost.')
  });
}

/* --------------------- 11. Notification rules (platform) ------------------ */
function vOpsNotif(){
  return notifView({
    ctx:'operator', title:'Notification rules',
    scopeNote:'these govern what the whole operations team is told, not just you',
    quietNote:'Operations run around the clock, so quiet hours are off by default here.',
    escalateLabel:'Escalate an unacknowledged urgent alert to a marketplace admin after 30 minutes',
    prefScope:'every operator user', sentCount:'412',
    banner:banner('info','Rules address a <strong>role</strong>, not a person. Moving someone between roles changes what they are told without anyone editing a rule.')
  });
}

/* ------------------------------- registration ---------------------------- */
function vOpsNotes(){ return notesView({title:'Credit and debit notes'}); }
function vOpsRefunds(){ return refundsView({ctx:'operator', title:'Refunds'}); }
function vOpsRewards(){ return rewardsOperatorView(); }
function vOpsWallets(){ return walletsOperatorView(); }
const VIEWS={
  rewards:vOpsRewards, wallets:vOpsWallets, notes:vOpsNotes, refunds:vOpsRefunds,
  ledger:vOpsLedger,
  partnerapis:vOpsPartnerApis,
  help:vOpsHelp,
  rules:vOpsRules,
  bulk:vOpsBulk,
  home:vOHome, verticals:vVerticals, onboardq:vOnboardQ, partners:vPartners,
  catalogue:vCatalogue, plans:vPlans, settlements:vSettlements, orderops:vOrderOps,
  disputes:vDisputes, tickets:vOpsTickets, reviews:vOpsReviews, promotions:vPromotions,
  devportal:vDevPortal, collections:vOpsCollections, banners:vBanners, inventory:vOpsInventory,
  billing:vOpsBilling, tax:vOpsTax,
  numbers:vOpsNumbers, delivery:vOpsDelivery, auth:vOpsAuth,
  users:vOpsUsers, roles:vOpsRoles, audit:vOpsAudit,
  notifications:vOpsNotif, profile:vOpsProfile
};

App.init({
  /* Light only. The theme switch was asked for on the three portals a
     customer-side person lives in, not on the marketplace console. */
  theme:false,
  brand:'6d',
  orgCtx:'operator', profileView:'profile', securityView:'users',
  profileSub:'Name, contact, time zone and cover while you are away',
  signedIn:'today at 08:41',
  product:'Marketplace Operations', tier:'6D Marketplace · '+MP.operator,
  env:'Operator console',
  persona:{name:OPS.name, role:OPS.role, org:MP.operator},
  searchScope:'the marketplace', alertCount:4,
  notifications:[
    {when:'18 min ago', text:'PlayForge Loot Crate submitted — flagged as a policy 7.4 breach in two markets', source:'Catalogue queue', kind:'danger', read:false},
    {when:'1 h ago', text:'DSP-333 has breached its 5-day resolution SLA', source:'Disputes', kind:'danger', read:false},
    {when:'3 h ago', text:SET_PENDING.length+' statements in the '+PERIODS[0]+' run are awaiting approval', source:'Settlement', kind:'warning', read:false},
    {when:'Yesterday', text:'Orbital Connect failed KYC — beneficial ownership could not be verified', source:'Onboarding', kind:'warning', read:true},
    {when:'2 d ago', text:'Vertex Endpoint suspended — provisioning SLA breached on 9 of 12 orders', source:'Partners', kind:'danger', read:true}
  ],
  footNote:MP.region,
  aiName:'AARYA assistant',
  aiGreeting:'I can answer questions about partners, listings, orders, settlement and the onboarding funnel across every marketplace category.'+
    '<div class="src">Sources: partner records, catalogue, order register, settlement statements, onboarding audit trail.</div>',
  aiSuggestions:['Where does onboarding stall?','What is in the catalogue queue?','How much do we pay out this run?','Which partners are at risk?'],
  nav:[
    {label:'Overview', items:[
      {id:'home', label:'Marketplace', icon:'dashboard'},
      {id:'verticals', label:'Marketplace categories', icon:'layers', count:()=>VERTICALS.length}]},
    {label:'Supply', items:[
      {id:'onboardq', label:'Partner onboarding', icon:'route',
       count:()=>PARTNERS.filter(p=>['onboarding','review'].includes(p.status)).length},
      {id:'partners', label:'Partners', icon:'group', count:()=>PARTNERS.length},
      {id:'catalogue', label:'Catalogue', icon:'package', count:()=>LISTING_QUEUE.length},
      {id:'rules', label:'Listing rules', icon:'checklist',
       count:()=>POLICY_RULES.filter(r=>r.status==='active').length},
      {id:'reviews', label:'Reviews', icon:'star',
       count:()=>REVIEWS.filter(r=>r.state==='pending').length}]},
    {label:'Commercials', items:[
      {id:'plans', label:'Commission plans', icon:'file', count:()=>COMM_PLANS.length},
      {id:'settlements', label:'Settlement runs', icon:'wallet', count:()=>SET_PENDING.length},
      {id:'notes', label:'Credit and debit notes', icon:'file',
       count:()=>CREDIT_NOTES.filter(n=>n.state==='pending'||n.state==='disputed').length},
      {id:'refunds', label:'Refunds', icon:'refresh',
       count:()=>REFUNDS.filter(r=>refundApprover(r).owner==='operator' &&
         (r.state==='requested'||r.state==='escalated')).length},
      {id:'promotions', label:'Promotions', icon:'zap', count:()=>DISCOUNT_RULES.filter(r=>r.on).length},
      {id:'rewards', label:'Rewards', icon:'star',
       count:()=>EARN_RULES.filter(r=>r.status==='pending').length},
      {id:'wallets', label:'Wallets', icon:'wallet',
       count:()=>WALLETS.filter(w=>w.state==='dormant').length},
      {id:'collections', label:'Collections', icon:'wallet',
       count:()=>DUNNING_CASES.filter(d=>d.state!=='recovered').length},
      {id:'banners', label:'Banners', icon:'monitor', count:()=>BANNERS.filter(b=>b.state==='live').length},
      {id:'ledger', label:'General ledger', icon:'chart',
       count:()=>GL_CHARGES.filter(c=>!GL_MAPPING[c.id]).length},
      {id:'billing', label:'Billing configuration', icon:'invoice',
       count:()=>Object.keys(PARTNER_BILLING).filter(k=>PARTNER_BILLING[k].override).length},
      {id:'devportal', label:'Developer portal', icon:'code', count:()=>API_PRODUCTS.length},
      {id:'partnerapis', label:'Partner APIs', icon:'plug',
       count:()=>PARTNER_ENDPOINTS.filter(e=>e.health==='failing').length},
      {id:'tax', label:'Tax configuration', icon:'globe',
       count:()=>TAX_REGIMES.filter(t=>t.status!=='active').length +
                 Object.keys(TAX_CERTS).filter(k=>!TAX_CERTS[k].certOnFile).length}]},
    {label:'Operations', items:[
      {id:'numbers', label:'Numbers and SIMs', icon:'sim',
       count:()=>iccidDrift().length},
      {id:'inventory', label:'Inventory', icon:'package',
       count:()=>Object.keys(INVENTORY).filter(k=>invState(k)==='low'||invState(k)==='out').length},
      {id:'orderops', label:'Order operations', icon:'orders', count:()=>ORD_FAIL.length},
      {id:'disputes', label:'Disputes', icon:'flag', count:()=>DISPUTES.filter(d=>d.status!=='resolved').length},
      {id:'tickets', label:'Support tickets', icon:'support',
       count:()=>TICKETS.filter(t=>['new','open','waiting','escalated'].indexOf(t.state)>-1).length}]},
    {label:'Administration', items:[
      {id:'bulk', label:'Bulk updates', icon:'upload', count:()=>bulkSets().length},
      {id:'users', label:'Users', icon:'shield', count:()=>orgUsers('operator').filter(u=>u.status!=='removed').length},
      {id:'roles', label:'Roles configuration', icon:'key', count:()=>orgRoles('operator').length},
      {id:'delivery', label:'Message delivery', icon:'zap',
       count:()=>DELIVERIES.filter(d=>d.state==='failed'||d.state==='expired').length},
      {id:'auth', label:'Sign-in and sessions', icon:'lock',
       count:()=>(SESSIONS.operator||[]).length},
      {id:'notifications', label:'Notification rules', icon:'bell',
       count:()=>NOTIF_RULES.operator.filter(r=>!r.on).length},
      {id:'help', label:'Knowledge base', icon:'file', count:()=>(KB_ARTICLES.operator||[]).length},
      {id:'audit', label:'Audit log', icon:'history',
       count:()=>auditRows('operator').filter(e=>e.sev==='high').length},
      {id:'profile', label:'My details', icon:'user'}]}
  ],
  searchIndex:[
    {k:'Screen',t:'Marketplace overview and revenue',v:'home'},{k:'Screen',t:'Marketplace categories',v:'verticals'},
    {k:'Screen',t:'Partner onboarding queue and gates',v:'onboardq'},{k:'Screen',t:'Partner directory',v:'partners'},
    {k:'Screen',t:'Catalogue governance and listing review',v:'catalogue'},
    {k:'Screen',t:'Commission and settlement plans',v:'plans'},{k:'Screen',t:'Settlement runs and payouts',v:'settlements'},
    {k:'Screen',t:'Order operations and exceptions',v:'orderops'},{k:'Screen',t:'Disputes and refunds',v:'disputes'},
    {k:'Alert',t:'PlayForge Loot Crate — policy 7.4 breach',v:'catalogue'},
    {k:'Alert',t:'Orbital Connect — failed KYC',v:'onboardq'},
    {k:'Alert',t:'Vertex Endpoint — suspended',v:'partners'},
    {k:'Screen',t:'Users and roles for operator staff',v:'users'},
    {k:'Screen',t:'Notification rules',v:'notifications'}
  ],
  aiAnswer(q){
    if(/onboard|stall|slow|funnel|gate/.test(q))
      return 'Onboarding stalls at <strong>Bank &amp; tax</strong>, not at KYC.'+
        '<table><tr><th>Gate</th><th>Median days</th></tr>'+
        '<tr><td>Application</td><td>0.4</td></tr><tr><td>KYC &amp; due diligence</td><td>2.1</td></tr>'+
        '<tr><td>Agreements</td><td>3.4</td></tr><tr><td><strong>Bank &amp; tax</strong></td><td><strong>6.8</strong></td></tr>'+
        '<tr><td>Technical readiness</td><td>4.2</td></tr><tr><td>Compliance review</td><td>2.6</td></tr>'+
        '<tr><td>Go-live</td><td>0.6</td></tr></table>'+
        'The cause is micro-deposit verification plus chasing tax residency certificates. Instant bank verification would take roughly five days out of a 21-day median.'+
        '<div class="src">Sources: onboarding audit trail, last 34 applications.</div>';
    if(/catalogue|listing|queue|review|policy/.test(q))
      return LISTING_QUEUE.length+' listings are awaiting review.'+
        '<table><tr><th>Listing</th><th>Risk</th></tr>'+
        LISTING_QUEUE.map(l=>'<tr><td>'+esc(l.name)+'<br><span style="color:#666">'+esc(l.partner)+'</span></td><td>'+
        (l.risk==='high'?'Policy breach':l.risk==='medium'?'Needs a check':'Routine')+'</td></tr>').join('')+'</table>'+
        'One is a hard stop: <strong>PlayForge Loot Crate</strong> uses randomised paid rewards, prohibited under policy 7.4 in two of its target markets. Approval is disabled on it for that reason.'+
        '<div class="src">Sources: catalogue queue, automated policy checks, market rule set.</div>';
    if(/payout|settle|run|pay/.test(q)){
      const cur=SETTLEMENTS.filter(s=>s.period===PERIODS[0]);
      return 'The <strong>'+PERIODS[0]+'</strong> run covers '+cur.length+' partners.'+
        '<table><tr><th>Line</th><th>Amount</th></tr>'+
        '<tr><td>Gross order value</td><td>'+CUR(cur.reduce((a,s)=>a+s.gross,0))+'</td></tr>'+
        '<tr><td>Marketplace commission</td><td>'+CUR(cur.reduce((a,s)=>a+s.commission,0))+'</td></tr>'+
        '<tr><td>Fees and withholding</td><td>'+CUR(cur.reduce((a,s)=>a+s.fees+s.wht,0))+'</td></tr>'+
        '<tr><td><strong>Net to partners</strong></td><td><strong>'+CUR(cur.reduce((a,s)=>a+s.net,0))+'</strong></td></tr></table>'+
        SET_PENDING.length+' statements still need approval, and statements with an open dispute are held automatically.'+
        '<div class="src">Sources: settlement register, dispute holds, partner tax status.</div>';
    }
    if(/risk|suspend|problem|partner.*at risk|worst/.test(q))
      return 'Three partners need attention, for different reasons:'+
        '<table><tr><th>Partner</th><th>Why</th></tr>'+
        '<tr><td>Vertex Endpoint</td><td>Suspended — provisioning SLA breached on 9 of 12 orders</td></tr>'+
        '<tr><td>Orbital Connect</td><td>Rejected at KYC — beneficial ownership unverifiable</td></tr>'+
        '<tr><td>TrackWise Telematics</td><td>Lowest seller rating on the platform at 3.7, and newest</td></tr></table>'+
        'Vertex is the one with buyer impact: enterprise customers hold live subscriptions on a suspended seller, and those run to contract end with no renewal path.'+
        '<div class="src">Sources: partner records, fulfilment history, KYC outcomes, seller ratings.</div>';
    return null;
  }
});

/* ===========================================================================
   14. PROMOTIONS — the discount rules engine
   Conditions, an effect and a budget. The cost floor is enforced by the engine
   rather than by whoever writes the rule, so a promotion cannot sell below
   cost however it is configured.
   =========================================================================== */
function drEffectLabel(r){
  const e=r.effect;
  return e.type==='pct'        ? e.value+'% off'
       : e.type==='amount'     ? CUR(e.value)+' off'
       : e.type==='freeMonths' ? e.value+' month'+(e.value===1?'':'s')+' free'
       : 'Free delivery';
}
function drCondSummary(r){
  const c=r.conditions||{}, bits=[];
  if(c.cartValue)  bits.push('basket over '+CUR0(c.cartValue));
  if(c.cartItems)  bits.push(c.cartItems+'+ items');
  if(c.category)   bits.push(c.category.map(v=>vName(v).replace(' Marketplace','')).join(' or '));
  if(c.timeOfDay)  bits.push(c.timeOfDay.from+'–'+c.timeOfDay.to);
  if(c.daysOfWeek) bits.push(c.daysOfWeek.join('/'));
  if(c.audience && c.audience!=='Everyone') bits.push(c.audience.toLowerCase());
  if(c.firstOrder) bits.push('first order');
  if(c.contract)   bits.push('contracted only');
  if(c.tier)       bits.push(c.tier+'+ tier');
  return bits.length?bits.join(' · '):'No conditions — applies to everything';
}
function drBudgetBar(r){
  if(!r.budget) return '<span class="dim">No cap</span>';
  const pct=Math.min(100, r.budget.used/r.budget.cap*100);
  return '<div style="min-width:120px"><div class="bar"><span style="width:'+pct.toFixed(0)+'%"></span></div>'+
    '<div class="t-tiny muted" style="margin-top:3px">'+CUR0(r.budget.used)+' of '+CUR0(r.budget.cap)+
    (pct>=100?' — exhausted':'')+'</div></div>';
}
function vPromotions(){
  const on=DISCOUNT_RULES.filter(r=>r.on);
  const spend=DISCOUNT_RULES.reduce((a,r)=>a+(r.budget?r.budget.used:0),0);
  const cap=DISCOUNT_RULES.reduce((a,r)=>a+(r.budget?r.budget.cap:0),0);
  const revenue=DISCOUNT_RULES.reduce((a,r)=>a+r.revenue,0);
  const exhausted=DISCOUNT_RULES.filter(r=>r.on && r.budget && r.budget.used>=r.budget.cap);

  return pagehead('Promotions',
    on.length+' of '+DISCOUNT_RULES.length+' rules are live · '+CUR0(spend)+' of '+CUR0(cap)+' committed',
    exportBtn('Promotions','dtPromo')+
    '<button class="btn" onclick="promoSimulator()">'+ICO('activity',13)+'Test a basket</button>'+
    '<button class="btn btn-primary" onclick="newPromoDialog()">'+ICO('plus',14)+'New promotion</button>')+
  '<div class="stack">'+

  (exhausted.length
    ? banner('warning','<strong>'+esc(exhausted[0].name)+' has spent its budget.</strong> It is still switched on but '+
      'no longer discounts anything — which looks to a buyer exactly like a promotion that has been withdrawn '+
      'without saying so. Raise the cap or turn it off.')
    : banner('info','<strong>No promotion may sell below cost.</strong> The engine floors every discount at the cost '+
      'price of the goods in the basket, so a badly written rule loses margin but never money.'))+

  '<div class="grid g4">'+
    metric({icon:'zap',label:'Live promotions',value:String(on.length),
      foot:DISCOUNT_RULES.filter(r=>!r.on).length+' paused'})+
    metric({icon:'wallet',label:'Discount given',value:CUR0(spend),
      foot:FMT.pct(spend/cap*100)+' of the committed budget'})+
    metric({icon:'trendup',label:'Revenue on discounted orders',value:CUR0(revenue),
      foot:'Gross value of baskets that used a promotion'})+
    metric({icon:'pie',label:'Effective discount',value:revenue?FMT.pct(spend/revenue*100):null,
      naLabel:'Nothing redeemed', foot:'Discount as a share of the revenue it moved'})+
  '</div>'+

  panel('Rules', dt('dtPromo',{
    rows:DISCOUNT_RULES, noun:'promotions', pageSize:10, sortKey:'priority', idKey:'id',
    onRow:"openPromo('$ID')",
    searchFields:['id','name','blurb'], searchPlaceholder:'Search a promotion',
    chips:[{key:'on',options:[{label:'Live',value:true},{label:'Paused',value:false}]}],
    actions:exportBtn('Promotions','dtPromo'),
    columns:[
      {key:'name',label:'Promotion',render:r=>'<div class="cellmain">'+esc(r.name)+'</div>'+
        '<div class="cellsub">'+esc(r.blurb)+'</div>'},
      {key:'__effect',label:'Gives',sort:false,exp:r=>drEffectLabel(r),
       render:r=>'<span class="pill pill-info">'+SH('diamond')+esc(drEffectLabel(r))+'</span>'},
      {key:'__cond',label:'When',sort:false,exp:r=>drCondSummary(r),
       render:r=>'<span class="t-small">'+esc(drCondSummary(r))+'</span>'},
      {key:'priority',label:'Priority',align:'right',render:r=>'<span class="t-num">'+r.priority+'</span>'},
      {key:'stack',label:'Stacks',render:r=>r.stack?pill('active','Yes'):pill('neutral','No')},
      {key:'__budget',label:'Budget',sort:false,exp:r=>r.budget?r.budget.used+' of '+r.budget.cap:'',
       render:r=>drBudgetBar(r)},
      {key:'uses',label:'Used',align:'right',render:r=>'<span class="t-num">'+FMT.num(r.uses)+'</span>'},
      {key:'on',label:'Live',render:r=>'<label class="toggle"><input type="checkbox" '+(r.on?'checked':'')+
        ' onchange="event.stopPropagation();togglePromo(\''+r.id+'\',this.checked)"><span class="track"></span>'+
        '<span class="sr-only">'+esc(r.name)+'</span></label>'}
    ]}),
    {flush:true, icon:'zap',
     sub:'Priority decides which non-stacking rule wins when several match. Lower runs first. A stacking rule is '+
         'added on top of whichever non-stacking rule won.'})+

  panel('What is running right now',
    '<div class="row wrap" style="gap:14px;margin-bottom:11px">'+
      '<div class="field" style="max-width:150px"><label for="clkTime">Evaluate as if the time is</label>'+
        '<input class="inp" id="clkTime" type="time" value="'+esc(CLOCK.hhmm)+'" onchange="setClock(\'hhmm\',this.value)">'+
        '</div>'+
      '<div class="field" style="max-width:130px"><label for="clkDay">and the day is</label>'+
        '<select class="inp" id="clkDay" onchange="setClock(\'day\',this.value)">'+
        DAYS.map(d=>'<option'+(CLOCK.day===d?' selected':'')+'>'+d+'</option>').join('')+'</select></div>'+
      '<div class="grow"><div class="t-tiny muted" style="margin-top:22px">A time-of-day rule cannot be checked at two '+
        'in the afternoon. Set the clock forward and the table below re-evaluates against it.</div></div>'+
    '</div>'+
    '<div class="tablewrap"><table class="tbl"><thead><tr><th>Promotion</th><th>Would apply now</th>'+
      '<th>Why not</th></tr></thead><tbody>'+
    (function(){
      const basket=basketFrom(
        [{sku:'SKU-3001', v:'content', price:120, qty:1, model:'monthly', cost:66},
         {sku:'SKU-4001', v:'device',  price:180, qty:1, model:'oneoff',  cost:140}],
        {audience:'Consumer', firstOrder:false, tier:'Gold', contract:false});
      return evalDiscounts(basket).results.map(r=>
        '<tr><td class="cellmain">'+esc(r.rule.name)+'</td>'+
        '<td>'+(r.applies?pill('active','Yes — '+CUR(r.amount)):pill('neutral','No'))+'</td>'+
        '<td class="t-small">'+(r.applies?'<span class="dim">—</span>':esc(r.why))+'</td></tr>').join('');
    })()+
    '</tbody></table></div>'+
    '<div class="t-tiny muted" style="margin-top:8px">Evaluated against a sample consumer basket: one streaming '+
      'subscription at '+CUR(120)+' and one device at '+CUR(180)+'.</div>',
    {icon:'clock'})+
  '</div>';
}
function setClock(k,v){ CLOCK[k]=v; App.go('promotions'); }
function togglePromo(id,on){
  const r=DRMAP[id]; if(!r) return;
  r.on=on; App.go(App.view);
  toast(r.name+(on?' is live — it applies to the next matching basket':' paused — no new baskets will get it'));
}
function openPromo(id){
  const r=DRMAP[id]; if(!r) return;
  const c=r.conditions||{};
  const left=r.budget?Math.max(0,r.budget.cap-r.budget.used):null;
  openInspector(
    '<div class="insp-head">'+ICO('zap',18)+'<div class="grow">'+
      '<div class="row" style="gap:6px">'+(r.on?pill('active','Live'):pill('neutral','Paused'))+
      '<span class="pill pill-info">'+SH('diamond')+esc(drEffectLabel(r))+'</span>'+
      (r.stack?pill('info','Stacks'):pill('neutral','Does not stack'))+'</div>'+
      '<h3 class="t-sub" style="margin-top:5px">'+esc(r.name)+'</h3>'+
      '<div class="t-small muted t-num">'+esc(r.id)+' · priority '+r.priority+'</div></div>'+
      '<button class="iconbtn" onclick="closeInspector()" aria-label="Close">'+ICO('x',16)+'</button></div>'+
    '<div class="insp-body stack">'+
      '<p class="t-body" style="margin:0">'+esc(r.blurb)+'</p>'+
      (r.budget && r.budget.used>=r.budget.cap
        ? banner('warning','<strong>Budget exhausted.</strong> This rule is switched on but gives nothing. To a buyer '+
          'that is indistinguishable from a withdrawn offer.') : '')+
      '<div class="divider"></div><h4 class="t-sub">Conditions</h4>'+
      '<div class="tablewrap"><table class="tbl"><tbody>'+
        (c.cartValue?'<tr><td class="t-small muted">Basket value</td><td class="t-small strong">at or above '+CUR(c.cartValue)+'</td></tr>':'')+
        (c.cartItems?'<tr><td class="t-small muted">Items</td><td class="t-small strong">'+c.cartItems+' or more</td></tr>':'')+
        (c.category?'<tr><td class="t-small muted">Category</td><td>'+c.category.map(v=>vBadge(v)).join(' ')+'</td></tr>':'')+
        (c.timeOfDay?'<tr><td class="t-small muted">Time of day</td><td class="t-small strong">'+
          esc(c.timeOfDay.from)+' to '+esc(c.timeOfDay.to)+'</td></tr>':'')+
        (c.daysOfWeek?'<tr><td class="t-small muted">Days</td><td class="t-small strong">'+esc(c.daysOfWeek.join(', '))+'</td></tr>':'')+
        (c.audience?'<tr><td class="t-small muted">Buyer</td><td class="t-small strong">'+esc(c.audience)+'</td></tr>':'')+
        (c.firstOrder?'<tr><td class="t-small muted">First order</td><td class="t-small strong">Yes</td></tr>':'')+
        (c.contract?'<tr><td class="t-small muted">Contract</td><td class="t-small strong">Contracted enterprises only</td></tr>':'')+
        '<tr><td class="t-small muted">Runs</td><td class="t-small strong">'+esc(r.window.from)+' to '+esc(r.window.to)+'</td></tr>'+
      '</tbody></table></div>'+
      '<div class="divider"></div><h4 class="t-sub">Budget</h4>'+
      drBudgetBar(r)+
      (left!=null?'<div class="t-tiny muted" style="margin-top:6px">'+CUR0(left)+' left. When it runs out the rule '+
        'stops discounting rather than overspending.</div>':'')+
      '<div class="divider"></div><h4 class="t-sub">Performance</h4>'+
      '<div class="totals">'+
        '<span class="lbl">Times used</span><span class="val">'+FMT.num(r.uses)+'</span>'+
        '<span class="lbl">Discount given</span><span class="val">'+CUR(r.budget?r.budget.used:0)+'</span>'+
        '<span class="lbl">Revenue on those baskets</span><span class="val">'+CUR(r.revenue)+'</span>'+
        '<span class="grand-lbl">Effective discount</span><span class="val grand">'+
          (r.revenue?FMT.pct((r.budget?r.budget.used:0)/r.revenue*100):'—')+'</span>'+
      '</div>'+
      (r.revenue && r.budget && r.budget.used/r.revenue > 0.14
        ? banner('warning','<strong>This is an expensive promotion.</strong> It is giving away '+
          FMT.pct(r.budget.used/r.revenue*100)+' of the revenue it moves. Worth asking whether those baskets would '+
          'have converted anyway.')
        : '')+
    '</div>'+
    '<div class="insp-foot"><button class="btn btn-quiet" onclick="closeInspector()">Close</button>'+
      '<div class="spacer"></div>'+
      '<button class="btn btn-sm" onclick="closeInspector();promoSimulator(\''+r.id+'\')">Test it</button>'+
      '<button class="btn btn-sm btn-primary" onclick="closeInspector();editPromo(\''+r.id+'\')">Edit</button>'+
    '</div>','Promotion '+r.name);
}

/* --------------------------- create and edit ------------------------------ */
function promoForm(r){
  r=r||{}; const c=r.conditions||{}; const e=r.effect||{type:'pct',value:10};
  return '<div class="grid g2">'+
      '<div class="field"><label for="prName">Name</label>'+
        '<input class="inp" id="prName" value="'+esc(r.name||'')+'" data-autofocus '+
        'placeholder="What the finance team will call it in a review">'+
        '<div class="err" id="prNameErr" hidden>'+ICO('alert',12)+'A promotion needs a name.</div></div>'+
      '<div class="field"><label for="prPriority">Priority</label>'+
        '<input class="inp" id="prPriority" type="number" min="1" max="99" value="'+(r.priority||20)+'">'+
        '<div class="hint">Lower runs first. Decides which non-stacking rule wins.</div></div>'+
    '</div>'+
    '<div class="field"><label for="prBlurb">What it is for</label>'+
      '<textarea class="inp" id="prBlurb" rows="2" placeholder="One sentence. Someone will read this in six months and need to know why it exists.">'+
      esc(r.blurb||'')+'</textarea>'+
      '<div class="err" id="prBlurbErr" hidden>'+ICO('alert',12)+
        'Say what it is for. An unexplained promotion is one nobody dares turn off.</div></div>'+

    '<div class="divider"></div><div class="t-small strong" style="margin-bottom:7px">What it gives</div>'+
    '<div class="grid g2">'+
      '<div class="field"><label for="prEffect">Effect</label><select class="inp" id="prEffect" onchange="prEffectChange()">'+
        DISCOUNT_EFFECTS.map(x=>'<option value="'+x.id+'"'+(e.type===x.id?' selected':'')+'>'+esc(x.label)+'</option>').join('')+
        '</select></div>'+
      '<div class="field"><label for="prValue"><span id="prValueLabel">Value</span></label>'+
        '<input class="inp" id="prValue" type="number" min="0" step="1" value="'+(e.value||0)+'">'+
        '<div class="hint" id="prValueHint">The engine floors this at the cost of the goods, so a large number '+
        'cannot sell below cost — it just gives away all the margin.</div></div>'+
    '</div>'+
    '<label class="checkline"><input type="checkbox" id="prStack" '+(r.stack?'checked':'')+
      '> Can stack with other promotions</label>'+

    '<div class="divider"></div><div class="t-small strong" style="margin-bottom:7px">When it applies</div>'+
    '<div class="grid g2">'+
      '<div class="field"><label for="prCartValue">Basket value at or above</label>'+
        '<input class="inp" id="prCartValue" type="number" min="0" step="10" value="'+(c.cartValue||'')+'" '+
        'placeholder="Any"></div>'+
      '<div class="field"><label for="prCartItems">Items in the basket</label>'+
        '<input class="inp" id="prCartItems" type="number" min="0" step="1" value="'+(c.cartItems||'')+'" '+
        'placeholder="Any"></div>'+
    '</div>'+
    '<div class="field"><label>Marketplace category</label><div class="row wrap" style="gap:8px;margin-top:4px">'+
      VERTICALS.map(v=>'<label class="checkline" style="border:1px solid var(--nim-line-200);border-radius:20px;padding:5px 11px">'+
      '<input type="checkbox" class="prCat" value="'+v.id+'" '+((c.category||[]).indexOf(v.id)>-1?'checked':'')+'>'+
      esc(v.name.replace(' Marketplace',''))+'</label>').join('')+'</div>'+
      '<div class="hint">Leave all unticked to apply to every category.</div></div>'+
    '<div class="grid g3">'+
      '<div class="field"><label for="prFrom">From (time of day)</label>'+
        '<input class="inp" id="prFrom" type="time" value="'+esc(c.timeOfDay?c.timeOfDay.from:'')+'"></div>'+
      '<div class="field"><label for="prTo">To</label>'+
        '<input class="inp" id="prTo" type="time" value="'+esc(c.timeOfDay?c.timeOfDay.to:'')+'">'+
        '<div class="hint">Leave both blank for all day. A window may cross midnight.</div></div>'+
      '<div class="field"><label for="prAud">Buyer type</label><select class="inp" id="prAud">'+
        AUDIENCES.map(a=>'<option'+((c.audience||'Everyone')===a?' selected':'')+'>'+esc(a)+'</option>').join('')+
        '</select></div>'+
    '</div>'+
    '<div class="field"><label>Days of the week</label><div class="row wrap" style="gap:8px;margin-top:4px">'+
      DAYS.map(d=>'<label class="checkline" style="border:1px solid var(--nim-line-200);border-radius:20px;padding:5px 11px">'+
      '<input type="checkbox" class="prDay" value="'+d+'" '+((c.daysOfWeek||[]).indexOf(d)>-1?'checked':'')+'>'+
      d+'</label>').join('')+'</div>'+
      '<div class="hint">Leave all unticked for every day.</div></div>'+
    '<div class="row wrap" style="gap:18px">'+
      '<label class="checkline"><input type="checkbox" id="prFirst" '+(c.firstOrder?'checked':'')+
        '> First order on the account only</label>'+
      '<label class="checkline"><input type="checkbox" id="prContract" '+(c.contract?'checked':'')+
        '> Contracted enterprises only</label>'+
    '</div>'+

    '<div class="divider"></div><div class="t-small strong" style="margin-bottom:7px">Budget and dates</div>'+
    '<div class="grid g3">'+
      '<div class="field"><label for="prCap">Budget cap</label>'+
        '<input class="inp" id="prCap" type="number" min="0" step="500" value="'+(r.budget?r.budget.cap:10000)+'">'+
        '<div class="hint">Discounting stops when this is spent.</div></div>'+
      '<div class="field"><label for="prWFrom">Runs from</label>'+
        '<input class="inp" id="prWFrom" value="'+esc(r.window?r.window.from:TODAY)+'"></div>'+
      '<div class="field"><label for="prWTo">Runs to</label>'+
        '<input class="inp" id="prWTo" value="'+esc(r.window?r.window.to:'31 Dec 2026')+'"></div>'+
    '</div>';
}
function prEffectChange(){
  const t=($('#prEffect')||{}).value;
  const l=$('#prValueLabel'), h=$('#prValueHint'), v=$('#prValue');
  const def=DISCOUNT_EFFECTS.find(x=>x.id===t)||{};
  if(l) l.textContent = t==='pct' ? 'Percentage off'
                      : t==='amount' ? 'Amount off ('+MP.currency+')'
                      : t==='freeMonths' ? 'Months free' : 'Not applicable';
  if(v) v.disabled = t==='shipping';
  if(h) h.textContent = t==='shipping'
    ? 'Free delivery is a flat waiver — no value to set.'
    : t==='freeMonths'
    ? 'Applied to the recurring lines only. A basket with nothing recurring will not match.'
    : 'The engine floors this at the cost of the goods, so a large number cannot sell below cost.';
}
function newPromoDialog(){
  openModal('<div class="modal-head">'+ICO('zap',18)+'<div class="grow"><h3 class="t-sub">New promotion</h3>'+
    '<div class="t-small muted">Conditions, an effect and a budget. The cost floor is enforced for you.</div></div>'+
    '<button class="iconbtn" onclick="closeModal()" aria-label="Close">'+ICO('x',16)+'</button></div>'+
    '<div class="modal-body stack">'+
      promoForm(null)+
      '<div class="impact"><strong>How the engine treats it</strong><ul>'+
        '<li>No promotion may take a basket below the cost of the goods in it. That is a floor in the engine, not a rule you can write around.</li>'+
        '<li>Non-stacking rules compete — the largest wins and the rest are suppressed.</li>'+
        '<li>A stacking rule is added on top of whichever non-stacking rule won.</li>'+
        '<li>When the budget is spent the rule stops discounting. It does not overspend and it does not switch itself off.</li></ul></div>'+
    '</div>'+
    '<div class="modal-foot"><span class="t-tiny muted grow">Created live. Turn it off if you want to stage it.</span>'+
      '<button class="btn btn-quiet" onclick="closeModal()">Cancel</button>'+
      '<button class="btn btn-primary" onclick="submitPromo(null)">Create promotion</button></div>',
    {wide:true,label:'New promotion'});
  prEffectChange();
}
function editPromo(id){
  const r=DRMAP[id]; if(!r) return;
  openModal('<div class="modal-head">'+ICO('zap',18)+'<div class="grow"><h3 class="t-sub">'+esc(r.name)+'</h3>'+
    '<div class="t-small muted t-num">'+esc(r.id)+' · used '+FMT.num(r.uses)+' times</div></div>'+
    '<button class="iconbtn" onclick="closeModal()" aria-label="Close">'+ICO('x',16)+'</button></div>'+
    '<div class="modal-body stack">'+
      promoForm(r)+
      banner('info','Changes apply to the next basket evaluated. Orders already placed under this promotion are '+
        'unaffected — a discount already given is not clawed back.')+
    '</div>'+
    '<div class="modal-foot">'+
      '<button class="btn btn-quiet" onclick="closeModal()">Cancel</button>'+
      '<button class="btn btn-sm btn-danger" onclick="deletePromo(\''+id+'\')">Delete</button>'+
      '<div class="spacer"></div>'+
      '<button class="btn btn-primary" onclick="submitPromo(\''+id+'\')">Save</button></div>',
    {wide:true,label:'Edit '+r.name});
  prEffectChange();
}
function readPromoForm(){
  const g=k=>document.getElementById(k);
  const num=k=>{ const v=(g(k)||{}).value; return v===''||v==null?null:(parseFloat(v)||0); };
  const cats=Array.prototype.slice.call(document.querySelectorAll('.prCat')).filter(c=>c.checked).map(c=>c.value);
  const days=Array.prototype.slice.call(document.querySelectorAll('.prDay')).filter(c=>c.checked).map(c=>c.value);
  const from=(g('prFrom')||{}).value, to=(g('prTo')||{}).value;
  const cond={};
  if(num('prCartValue')) cond.cartValue=num('prCartValue');
  if(num('prCartItems')) cond.cartItems=num('prCartItems');
  if(cats.length) cond.category=cats;
  if(from && to) cond.timeOfDay={from:from,to:to};
  if(days.length) cond.daysOfWeek=days;
  if(g('prAud').value!=='Everyone') cond.audience=g('prAud').value;
  if(g('prFirst').checked) cond.firstOrder=true;
  if(g('prContract').checked) cond.contract=true;
  return {
    name:(g('prName').value||'').trim(),
    blurb:(g('prBlurb').value||'').trim(),
    priority:parseInt(g('prPriority').value,10)||20,
    effect:{type:g('prEffect').value, value:num('prValue')||0},
    conditions:cond, stack:g('prStack').checked,
    budget:{cap:num('prCap')||0, used:0},
    window:{from:(g('prWFrom').value||'').trim(), to:(g('prWTo').value||'').trim()}
  };
}
function submitPromo(id){
  const g=k=>document.getElementById(k);
  const d=readPromoForm();
  const badName=!d.name, badBlurb=d.blurb.length<10;
  g('prNameErr').hidden=!badName; g('prBlurbErr').hidden=!badBlurb;
  if(badName||badBlurb){ (badName?g('prName'):g('prBlurb')).focus(); return; }
  if(d.effect.type!=='shipping' && !(d.effect.value>0)){
    toast('A promotion that gives nothing is not a promotion','warn'); return;
  }
  if(d.effect.type==='pct' && d.effect.value>90){
    toast('Above 90% the engine will floor almost every basket at cost — set a realistic figure','warn'); return;
  }
  closeModal();
  if(id){
    const r=DRMAP[id];
    const used=r.budget?r.budget.used:0;
    Object.assign(r,d);
    r.budget.used=used;                       /* spend already given is not reset by an edit */
    App.go(App.view);
    toast(r.name+' saved — applies to the next basket evaluated');
  } else {
    const r=addPromo(d);
    App.go(App.view);
    toast(r.name+' created and live — '+drEffectLabel(r)+' when '+drCondSummary(r).toLowerCase());
  }
}
function addPromo(d){
  SEQ.promo=(SEQ.promo||0)+1;
  const r=Object.assign({id:'DR-N'+SEQ.promo, on:true, uses:0, revenue:0, isNew:true}, d);
  DISCOUNT_RULES.push(r); DRMAP[r.id]=r;
  return r;
}
function deletePromo(id){
  const r=DRMAP[id]; if(!r) return;
  closeModal();
  confirmAction({
    title:'Delete '+r.name, subtitle:FMT.num(r.uses)+' uses · '+CUR0(r.budget?r.budget.used:0)+' given',
    risk:'high', confirmLabel:'Delete the promotion', requireType:'DELETE',
    impact:['It stops applying to new baskets immediately.',
            'Orders already placed under it keep their discount — nothing is clawed back.',
            'The spend history goes with it, so the finance record of '+CUR0(r.budget?r.budget.used:0)+' is lost.',
            'Pausing it keeps the history. Deleting is for rules that should never have existed.'],
    onConfirm:()=>{
      const i=DISCOUNT_RULES.indexOf(r);
      if(i>-1) DISCOUNT_RULES.splice(i,1);
      delete DRMAP[id];
      App.go(App.view);
      toast(r.name+' deleted','warn');
    }
  });
}

/* --------------------------- the simulator -------------------------------- */
let SIM = {value:250, items:2, v:'content', audience:'Consumer', first:false, contract:false};
function promoSimulator(focusId){
  SIM.focus=focusId||null;
  openModal(simHtml(), {wide:true, label:'Test a basket'});
}
function simHtml(){
  const cost=+(SIM.value*0.62).toFixed(2);
  const basket=basketFrom(
    [{sku:'SIM-1', v:SIM.v, price:+(SIM.value/SIM.items).toFixed(2), qty:SIM.items,
      model: SIM.v==='content'||SIM.v==='security' ? 'monthly':'oneoff',
      cost:+(SIM.value*0.62/SIM.items).toFixed(2)}],
    {audience:SIM.audience, firstOrder:SIM.first, tier:'Gold', contract:SIM.contract});
  const ev=evalDiscounts(basket);
  return '<div class="modal-head">'+ICO('activity',18)+'<div class="grow"><h3 class="t-sub">Test a basket</h3>'+
      '<div class="t-small muted">Change the basket and watch which promotions fire, and which do not and why.</div></div>'+
      '<button class="iconbtn" onclick="closeModal()" aria-label="Close">'+ICO('x',16)+'</button></div>'+
    '<div class="modal-body stack">'+
      '<div class="grid g3">'+
        '<div class="field"><label for="simVal">Basket value</label>'+
          '<input class="inp" id="simVal" type="number" min="0" step="10" value="'+SIM.value+'" '+
          'onchange="simSet(\'value\',parseFloat(this.value)||0)"></div>'+
        '<div class="field"><label for="simItems">Items</label>'+
          '<input class="inp" id="simItems" type="number" min="1" step="1" value="'+SIM.items+'" '+
          'onchange="simSet(\'items\',parseInt(this.value,10)||1)"></div>'+
        '<div class="field"><label for="simV">Category</label><select class="inp" id="simV" '+
          'onchange="simSet(\'v\',this.value)">'+
          VERTICALS.map(v=>'<option value="'+v.id+'"'+(SIM.v===v.id?' selected':'')+'>'+
            esc(v.name.replace(' Marketplace',''))+'</option>').join('')+'</select></div>'+
      '</div>'+
      '<div class="grid g3">'+
        '<div class="field"><label for="simAud">Buyer</label><select class="inp" id="simAud" '+
          'onchange="simSet(\'audience\',this.value)">'+
          ['Consumer','Enterprise','Partner reseller'].map(a=>'<option'+(SIM.audience===a?' selected':'')+
            '>'+esc(a)+'</option>').join('')+'</select></div>'+
        '<div class="field"><label for="simTime">Time</label>'+
          '<input class="inp" id="simTime" type="time" value="'+esc(CLOCK.hhmm)+'" '+
          'onchange="CLOCK.hhmm=this.value;simRedraw()"></div>'+
        '<div class="field"><label for="simDay">Day</label><select class="inp" id="simDay" '+
          'onchange="CLOCK.day=this.value;simRedraw()">'+
          DAYS.map(d=>'<option'+(CLOCK.day===d?' selected':'')+'>'+d+'</option>').join('')+'</select></div>'+
      '</div>'+
      '<div class="row wrap" style="gap:18px">'+
        '<label class="checkline"><input type="checkbox" '+(SIM.first?'checked':'')+
          ' onchange="simSet(\'first\',this.checked)"> First order on the account</label>'+
        '<label class="checkline"><input type="checkbox" '+(SIM.contract?'checked':'')+
          ' onchange="simSet(\'contract\',this.checked)"> Contracted enterprise</label>'+
      '</div>'+
      '<div class="divider"></div>'+
      '<div class="totals">'+
        '<span class="lbl">Basket</span><span class="val">'+CUR(basket.value)+'</span>'+
        '<span class="lbl">Cost of the goods</span><span class="val">'+CUR(cost)+'</span>'+
        '<span class="lbl">Maximum discount before cost</span><span class="val">'+CUR(ev.headroom)+'</span>'+
        discountLines(ev)+
        '<span class="grand-lbl">Buyer pays</span><span class="val grand">'+CUR(+(basket.value-ev.total).toFixed(2))+'</span>'+
      '</div>'+
      '<div class="divider"></div>'+
      discountWhyPanel(ev)+
    '</div>'+
    '<div class="modal-foot"><span class="t-tiny muted grow">Nothing here is charged or recorded.</span>'+
      '<button class="btn btn-primary" onclick="closeModal()">Done</button></div>';
}
function simSet(k,v){ SIM[k]=v; simRedraw(); }
function simRedraw(){
  const host=$('#modalHost');
  if(host) host.innerHTML=simHtml();
}

/* ===========================================================================
   15. BANNERS — login and storefront advertising  (PRD §4.3 · ORD)
   =========================================================================== */
function vBanners(){
  const live=BANNERS.filter(b=>b.state==='live');
  const imp=BANNERS.reduce((a,b)=>a+(b.impressions||0),0);
  const clk=BANNERS.reduce((a,b)=>a+(b.clicks||0),0);
  const rev=BANNERS.reduce((a,b)=>a+(b.revenue||0),0);
  const unmeasured=BANNERS.filter(b=>b.state==='live' && b.impressions==null);
  const noAlt=BANNERS.filter(b=>!String(b.alt||'').trim());

  return pagehead('Banners',
    live.length+' live across '+BANNER_SLOTS.length+' slots · '+FMT.num(imp)+' impressions, '+
      FMT.num(clk)+' clicks',
    exportBtn('Banners','dtBanner')+
    '<button class="btn" onclick="bannerSlotsDialog()">'+ICO('layers',13)+'Slots</button>'+
    '<button class="btn btn-primary" onclick="newBannerDialog()">'+ICO('plus',14)+'New banner</button>')+
  '<div class="stack">'+

  (unmeasured.length
    ? banner('warning','<strong>'+unmeasured.length+' live banner'+(unmeasured.length===1?' has':'s have')+
      ' no measurement.</strong> '+esc(unmeasured[0].name)+' is taking a slot and telling you nothing about whether '+
      'it works. A banner without impressions and clicks is decoration, not a campaign.')
    : noAlt.length
    ? banner('danger','<strong>'+noAlt.length+' banner has no alt text.</strong> A banner is an image carrying a '+
      'message; undescribed, it is a blank space to anyone using a screen reader.')
    : banner('info','<strong>Advertising here is operator-run.</strong> Sellers cannot buy placement — the slot is '+
      'chosen by weight among eligible banners, not sold. That is worth stating, because the first question a '+
      'partner asks is whether they can pay to be at the top.'))+

  '<div class="grid g4">'+
    metric({icon:'monitor',label:'Live banners',value:String(live.length),
      foot:BANNERS.filter(b=>b.state==='scheduled').length+' scheduled · '+
           BANNERS.filter(b=>b.state==='paused').length+' paused'})+
    metric({icon:'eye',label:'Impressions',value:FMT.num(imp),foot:'Across every slot, all time'})+
    metric({icon:'activity',label:'Click-through',value:imp?FMT.pct(clk/imp*100):null,
      naLabel:'Not measured', foot:FMT.num(clk)+' clicks'})+
    metric({icon:'wallet',label:'Attributed revenue',value:rev?CUR0(rev):null,
      naLabel:'Not attributed',
      foot:'Orders that followed a click, within the session'})+
  '</div>'+

  panel('Banners', dt('dtBanner',{
    rows:BANNERS, noun:'banners', pageSize:10, sortKey:'slot', idKey:'id',
    onRow:"openBanner('$ID')",
    searchFields:['id','name','headline','audience'], searchPlaceholder:'Search banner, headline or audience',
    chips:[{key:'slot',options:BANNER_SLOTS.map(s=>({label:s.label,value:s.id}))},
           {key:'state',options:BANNER_STATES.map(s=>({label:s.charAt(0).toUpperCase()+s.slice(1),value:s}))}],
    actions:exportBtn('Banners','dtBanner'),
    columns:[
      {key:'name',label:'Banner',render:r=>'<div class="cellmain">'+esc(r.name)+'</div>'+
        '<div class="cellsub">'+esc(r.headline)+'</div>'},
      {key:'slot',label:'Slot',render:r=>'<span class="tag">'+
        esc((BANNER_SLOTS.find(s=>s.id===r.slot)||{}).label||r.slot)+'</span>'},
      {key:'audience',label:'Shown to',render:r=>'<div class="t-small">'+esc(r.audience)+'</div>'+
        (r.locale!=='All'||r.device!=='All'
          ? '<div class="cellsub">'+esc([r.locale!=='All'?r.locale:'',r.device!=='All'?r.device:'']
              .filter(Boolean).join(' · '))+'</div>' : '')},
      {key:'from',label:'Runs',render:r=>'<div class="t-small">'+esc(r.from)+'</div>'+
        '<div class="cellsub">to '+esc(r.to)+'</div>'},
      {key:'weight',label:'Weight',align:'right',render:r=>'<span class="t-num">'+r.weight+'</span>'},
      {key:'impressions',label:'Impressions',align:'right',render:r=>r.impressions==null
        ? '<span class="nodata">Not measured</span>' : '<span class="t-num">'+FMT.num(r.impressions)+'</span>'},
      {key:'__ctr',label:'CTR',align:'right',sort:false,exp:r=>bnCtr(r),
       render:r=>{const c=bnCtr(r); return c==null?'<span class="nodata">—</span>'
         :'<span class="t-num'+(c>=4?' cellmain':'')+'">'+c+'%</span>';}},
      {key:'revenue',label:'Revenue',align:'right',render:r=>r.revenue==null
        ? '<span class="nodata">Not attributed</span>'
        : r.revenue ? '<span class="t-num">'+CUR0(r.revenue)+'</span>' : '<span class="dim">—</span>'},
      {key:'state',label:'State',render:r=>bnState(r)},
      {key:'__acts',label:'',sort:false,render:r=>
        '<button class="btn btn-sm btn-quiet" onclick="event.stopPropagation();toggleBanner(\''+r.id+'\')">'+
        (r.state==='live'?'Pause':r.state==='paused'?'Resume':'Preview')+'</button>'}
    ]}),
    {flush:true, icon:'monitor',
     sub:'Within a slot, one banner shows at a time, chosen by weight among those eligible. Weight is a share of '+
         'voice, not a priority — two live banners at 50 each split the slot evenly. Sellers cannot buy placement: '+
         'slots are allocated by the operator, not sold.'})+

  panel('What each slot is showing right now',
    '<div class="stack" style="gap:14px">'+BANNER_SLOTS.map(s=>{
      const pool=BANNERS.filter(b=>b.slot===s.id && b.state==='live');
      const shown=pool.length?pool.slice().sort((a,b)=>b.weight-a.weight)[0]:null;
      return '<div>'+
        '<div class="row" style="margin-bottom:6px"><span class="t-small strong grow">'+esc(s.label)+
          ' <span class="t-tiny muted">'+esc(s.w)+'</span></span>'+
          '<span class="t-tiny muted">'+pool.length+' eligible of '+s.max+' slots</span></div>'+
        '<div class="t-tiny muted" style="margin-bottom:7px">'+esc(s.note)+'</div>'+
        (shown
          ? '<div class="adpreview">'+bannerEl(shown,{compact:true,showWhy:false})+'</div>'
          : '<div class="t-small nodata" style="padding:10px 0">Nothing live in this slot — the frame collapses '+
            'rather than showing an empty box.</div>')+
      '</div>';
    }).join('')+'</div>',
    {icon:'layers'})+

  panel('Measurement',
    '<div class="grid g2"><div>'+
      '<div class="tablewrap"><table class="tbl"><thead><tr><th>Banner</th>'+
        '<th class="num">Impressions</th><th class="num">Clicks</th><th class="num">CTR</th>'+
        '<th class="num">Orders</th><th class="num">Revenue</th></tr></thead><tbody>'+
      BANNERS.filter(b=>b.impressions).sort((a,b)=>(bnCtr(b)||0)-(bnCtr(a)||0)).map(b=>
        '<tr><td class="cellmain">'+esc(b.name)+'</td>'+
        '<td class="num t-num">'+FMT.num(b.impressions)+'</td>'+
        '<td class="num t-num">'+FMT.num(b.clicks)+'</td>'+
        '<td class="num t-num">'+bnCtr(b)+'%</td>'+
        '<td class="num t-num">'+FMT.num(b.orders||0)+'</td>'+
        '<td class="num t-num">'+(b.revenue?CUR0(b.revenue):'<span class="dim">—</span>')+'</td></tr>').join('')+
      '</tbody></table></div>'+
    '</div><div>'+
      '<div class="t-small strong" style="margin-bottom:7px">How to read this</div>'+
      '<p class="t-small" style="margin:0 0 9px;line-height:1.6">Attributed revenue is the value of orders placed '+
      'in the same session after a click. It is <strong>not</strong> proof the banner caused the order — a buyer '+
      'who was going to buy anyway still clicks. Treat it as an upper bound.</p>'+
      '<p class="t-small" style="margin:0;line-height:1.6">The evening data hour banner has the highest '+
      'click-through and the lowest revenue per click, which is what a low-value, high-volume category looks like. '+
      'The IoT banner is the reverse. Ranking banners by revenue alone would retire the wrong one.</p>'+
    '</div></div>',
    {icon:'chart'})+
  '</div>';
}
function toggleBanner(id){
  const b=BNMAP[id]; if(!b) return;
  if(b.state==='live'){ b.state='paused'; audit('promo.changed',{object:'Banner '+b.name, detail:'Paused'});
    App.go(App.view); toast(b.name+' paused — the slot falls to the next eligible banner'); return; }
  if(b.state==='paused'){ b.state='live'; audit('promo.changed',{object:'Banner '+b.name, detail:'Resumed'});
    App.go(App.view); toast(b.name+' is live again'); return; }
  openBanner(id);
}
function openBanner(id){
  const b=BNMAP[id]; if(!b) return;
  const slot=BANNER_SLOTS.find(s=>s.id===b.slot)||{};
  const ctr=bnCtr(b);
  const rpc=(b.clicks&&b.revenue)?+(b.revenue/b.clicks).toFixed(2):null;
  openInspector(
    '<div class="insp-head">'+ICO('monitor',18)+'<div class="grow">'+
      '<div class="row" style="gap:6px">'+bnState(b)+'<span class="tag">'+esc(slot.label||b.slot)+'</span>'+
      (b.promo?pill('info','Linked offer'):'')+'</div>'+
      '<h3 class="t-sub" style="margin-top:5px">'+esc(b.name)+'</h3>'+
      '<div class="t-small muted t-num">'+esc(b.id)+' · weight '+b.weight+'</div></div>'+
      '<button class="iconbtn" onclick="closeInspector()" aria-label="Close">'+ICO('x',16)+'</button></div>'+
    '<div class="insp-body stack">'+
      bannerEl(b,{compact:true,showWhy:false})+
      (b.impressions==null
        ? banner('warning','<strong>No measurement on this banner.</strong> It is occupying a slot and reporting '+
          'nothing. Either instrument it or take it down.')
        : '')+
      '<dl class="deflist">'+
        '<dt>Slot</dt><dd>'+esc(slot.label||b.slot)+' <span class="t-tiny muted">'+esc(slot.w||'')+'</span></dd>'+
        '<dt>Shown to</dt><dd>'+esc(b.audience)+'</dd>'+
        '<dt>Region</dt><dd>'+esc(b.locale)+'</dd>'+
        '<dt>Device</dt><dd>'+esc(b.device)+'</dd>'+
        '<dt>Runs</dt><dd>'+esc(b.from)+' to '+esc(b.to)+'</dd>'+
        '<dt>Links to</dt><dd>'+(b.target?esc(vName(b.target)):'<span class="nodata">Nowhere in particular</span>')+'</dd>'+
        '<dt>Linked offer</dt><dd>'+(b.promo&&DRMAP[b.promo]
          ? '<button class="linkbtn" onclick="closeInspector();openPromo(\''+b.promo+'\')">'+
            esc(DRMAP[b.promo].name)+'</button>'
          : '<span class="nodata">None — advertising only</span>')+'</dd>'+
        '<dt>Alt text</dt><dd>'+(String(b.alt||'').trim()
          ? esc(b.alt) : '<span style="color:var(--nim-danger-fg)">Missing — required before it may run</span>')+'</dd>'+
      '</dl>'+
      (b.impressions
        ? '<div class="divider"></div><h4 class="t-sub">Performance</h4>'+
          '<div class="totals">'+
            '<span class="lbl">Impressions</span><span class="val">'+FMT.num(b.impressions)+'</span>'+
            '<span class="lbl">Clicks</span><span class="val">'+FMT.num(b.clicks)+'</span>'+
            '<span class="lbl">Click-through</span><span class="val">'+ctr+'%</span>'+
            '<span class="lbl">Orders in session after a click</span><span class="val">'+FMT.num(b.orders||0)+'</span>'+
            '<span class="grand-lbl">Attributed revenue</span><span class="val grand">'+
              (b.revenue?CUR0(b.revenue):'—')+'</span>'+
          '</div>'+
          (rpc?'<div class="t-tiny muted" style="margin-top:6px">'+CUR(rpc)+' per click. Attribution is '+
            'same-session only and is an upper bound — a buyer who was going to buy anyway still clicks.</div>':'')
        : '')+
    '</div>'+
    '<div class="insp-foot"><button class="btn btn-quiet" onclick="closeInspector()">Close</button>'+
      '<div class="spacer"></div>'+
      (b.state==='live'
        ? '<button class="btn btn-sm" onclick="closeInspector();toggleBanner(\''+b.id+'\')">Pause</button>'
        : b.state==='paused'
        ? '<button class="btn btn-sm" onclick="closeInspector();toggleBanner(\''+b.id+'\')">Resume</button>' : '')+
      '<button class="btn btn-sm btn-primary" onclick="closeInspector();editBanner(\''+b.id+'\')">Edit</button>'+
    '</div>','Banner '+b.name);
}
function bannerSlotsDialog(){
  openModal('<div class="modal-head">'+ICO('layers',18)+'<div class="grow"><h3 class="t-sub">Banner slots</h3>'+
    '<div class="t-small muted">Where a banner can appear, and what each slot may know about the viewer</div></div>'+
    '<button class="iconbtn" onclick="closeModal()" aria-label="Close">'+ICO('x',16)+'</button></div>'+
    '<div class="modal-body stack">'+
      banner('warning','<strong>The login slot is seen before sign-in.</strong> Nothing personal is available there '+
        '— no name, no history, no segment. Only locale and device. Any targeting beyond that would mean '+
        'identifying someone who has not yet identified themselves.')+
      '<div class="tablewrap"><table class="tbl"><thead><tr><th>Slot</th><th>Size</th>'+
        '<th class="num">Max</th><th class="num">Live</th><th>Targeting available</th></tr></thead><tbody>'+
      BANNER_SLOTS.map(s=>{
        const n=BANNERS.filter(b=>b.slot===s.id&&b.state==='live').length;
        return '<tr><td><div class="cellmain">'+esc(s.label)+'</div>'+
          '<div class="cellsub">'+esc(s.note)+'</div></td>'+
          '<td class="t-num t-small">'+esc(s.w)+'</td>'+
          '<td class="num t-num">'+s.max+'</td>'+
          '<td class="num t-num'+(n>s.max?' cellmain':'')+'">'+n+'</td>'+
          '<td>'+(s.id==='login'
            ? pill('warning','Locale and device only')
            : pill('active','Account type'))+'</td></tr>';
      }).join('')+'</tbody></table></div>'+
      '<div class="impact"><strong>Rules that hold in every slot</strong><ul>'+
        '<li>'+esc(BANNER_RULES.maxPerSlot)+'</li>'+
        '<li>'+esc(BANNER_RULES.preLogin)+'</li>'+
        '<li>'+esc(BANNER_RULES.measurement)+'</li>'+
        '<li>'+esc(BANNER_RULES.accessibility)+'</li>'+
        '<li>Sellers cannot buy placement. Slots are allocated by the operator, not sold.</li></ul></div>'+
    '</div>'+
    '<div class="modal-foot"><button class="btn btn-primary" onclick="closeModal()">Close</button></div>',
    {wide:true,label:'Banner slots'});
}

/* --------------------------- create and edit ------------------------------ */
function bannerForm(b){
  b=b||{};
  return '<div class="grid g2">'+
      '<div class="field"><label for="bfName">Internal name</label>'+
        '<input class="inp" id="bfName" value="'+esc(b.name||'')+'" data-autofocus '+
        'placeholder="What the marketing team will call it in a review">'+
        '<div class="err" id="bfNameErr" hidden>'+ICO('alert',12)+'A banner needs a name you will recognise later.</div></div>'+
      '<div class="field"><label for="bfSlot">Slot</label><select class="inp" id="bfSlot" onchange="bfPreview()">'+
        BANNER_SLOTS.map(s=>'<option value="'+s.id+'"'+(b.slot===s.id?' selected':'')+'>'+
          esc(s.label)+' · '+esc(s.w)+'</option>').join('')+'</select>'+
        '<div class="hint" id="bfSlotHint">'+esc((BANNER_SLOTS.find(s=>s.id===(b.slot||'login'))||{}).note||'')+'</div></div>'+
    '</div>'+
    '<div class="field"><label for="bfHead">Headline</label>'+
      '<input class="inp" id="bfHead" value="'+esc(b.headline||'')+'" maxlength="60" '+
      'placeholder="One line. This is the whole message." oninput="bfPreview()">'+
      '<div class="hint">Up to 60 characters. Longer than that and nobody reads it.</div>'+
      '<div class="err" id="bfHeadErr" hidden>'+ICO('alert',12)+'A banner with no headline says nothing.</div></div>'+
    '<div class="field"><label for="bfSub">Supporting line</label>'+
      '<input class="inp" id="bfSub" value="'+esc(b.sub||'')+'" maxlength="110" '+
      'placeholder="The condition, the deadline, or the detail" oninput="bfPreview()"></div>'+
    '<div class="grid g3">'+
      '<div class="field"><label for="bfCta">Button text</label>'+
        '<input class="inp" id="bfCta" value="'+esc(b.cta||'See the offer')+'" oninput="bfPreview()"></div>'+
      '<div class="field"><label for="bfTarget">Sends the buyer to</label><select class="inp" id="bfTarget">'+
        '<option value="">Nowhere in particular</option>'+
        VERTICALS.map(v=>'<option value="'+v.id+'"'+(b.target===v.id?' selected':'')+'>'+esc(v.name)+'</option>').join('')+
        '</select></div>'+
      '<div class="field"><label for="bfAccent">Accent</label><select class="inp" id="bfAccent" onchange="bfPreview()">'+
        [['#0D47A1','Blue'],['#4A148C','Purple'],['#1B5E20','Green'],['#E65100','Orange'],
         ['#B71C1C','Red'],['#00695C','Teal'],['#37474F','Slate']]
        .map(c=>'<option value="'+c[0]+'"'+(b.accent===c[0]?' selected':'')+'>'+c[1]+'</option>').join('')+'</select></div>'+
    '</div>'+
    '<div class="grid g2">'+
      '<div class="field"><label for="bfArt">Artwork</label><select class="inp" id="bfArt" onchange="bfPreview()">'+
        AD_MOTIFS.map(m=>'<option value="'+m.id+'"'+((b.art||'twophones')===m.id?' selected':'')+'>'+
          esc(m.label)+'</option>').join('')+'</select>'+
        '<div class="hint">Drawn, not photographed. Stock imagery needs a licence we do not have and dates '+
        'the moment a handset is refreshed.</div></div>'+
      '<div class="field"><label>What it looks like</label>'+
        '<div class="artpick" id="bfArtNote">'+esc((AD_MOTIFS.filter(m=>m.id===(b.art||'twophones'))[0]||{}).note||'')+
        '</div></div>'+
    '</div>'+
    '<div class="field"><label for="bfAlt">Alt text</label>'+
      '<input class="inp" id="bfAlt" value="'+esc(b.alt||'')+'" '+
      'placeholder="Describe the artwork for someone who cannot see it">'+
      '<div class="hint">Required. A banner is an image carrying a message; undescribed it is a blank space.</div>'+
      '<div class="err" id="bfAltErr" hidden>'+ICO('alert',12)+'Alt text is required before a banner may run.</div></div>'+
    '<div class="divider"></div>'+
    '<div class="grid g3">'+
      '<div class="field"><label for="bfAud">Shown to</label><select class="inp" id="bfAud">'+
        BANNER_AUDIENCES.map(a=>'<option'+((b.audience||'Everyone')===a?' selected':'')+'>'+esc(a)+'</option>').join('')+
        '</select></div>'+
      '<div class="field"><label for="bfLocale">Region</label><select class="inp" id="bfLocale">'+
        ['All','India','UAE','Singapore','Kenya','Germany'].map(l=>'<option'+((b.locale||'All')===l?' selected':'')+
          '>'+l+'</option>').join('')+'</select></div>'+
      '<div class="field"><label for="bfDevice">Device</label><select class="inp" id="bfDevice">'+
        ['All','Mobile','Desktop'].map(d=>'<option'+((b.device||'All')===d?' selected':'')+'>'+d+'</option>').join('')+
        '</select></div>'+
    '</div>'+
    '<div class="grid g3">'+
      '<div class="field"><label for="bfFrom">Runs from</label>'+
        '<input class="inp" id="bfFrom" value="'+esc(b.from||TODAY)+'"></div>'+
      '<div class="field"><label for="bfTo">Runs to</label>'+
        '<input class="inp" id="bfTo" value="'+esc(b.to||'31 Dec 2026')+'"></div>'+
      '<div class="field"><label for="bfWeight">Share of voice</label>'+
        '<input class="inp" id="bfWeight" type="number" min="1" max="100" value="'+(b.weight||50)+'">'+
        '<div class="hint">Relative weight within the slot, not a priority.</div></div>'+
    '</div>'+
    '<div class="field"><label for="bfPromo">Linked offer</label><select class="inp" id="bfPromo">'+
      '<option value="">None — this advertises, it does not discount</option>'+
      DISCOUNT_RULES.map(r=>'<option value="'+r.id+'"'+(b.promo===r.id?' selected':'')+'>'+esc(r.name)+'</option>').join('')+
      '</select>'+
      '<div class="hint">A linked offer applies automatically at checkout. Advertising a discount that does not '+
      'exist is the fastest way to a complaint.</div></div>'+
    '<div><div class="t-small strong" style="margin-bottom:7px">Preview</div>'+
      '<div class="adpreview" id="bfPreviewBox">'+bannerEl(Object.assign({
        headline:b.headline||'Your headline here', sub:b.sub||'The supporting line',
        cta:b.cta||'See the offer', accent:b.accent||'#0D47A1',
        target:b.target||null, art:b.art||'twophones', alt:b.alt||''
      },{id:'preview'}),{compact:true,showWhy:false})+'</div></div>';
}
function bfPreview(){
  const g=k=>document.getElementById(k);
  const box=g('bfPreviewBox'); if(!box) return;
  const slot=g('bfSlot')?g('bfSlot').value:'login';
  const hint=g('bfSlotHint');
  if(hint) hint.textContent=(BANNER_SLOTS.find(s=>s.id===slot)||{}).note||'';
  box.innerHTML=bannerEl({
    id:'preview',
    headline:(g('bfHead')&&g('bfHead').value)||'Your headline here',
    sub:(g('bfSub')&&g('bfSub').value)||'The supporting line',
    cta:(g('bfCta')&&g('bfCta').value)||'See the offer',
    accent:(g('bfAccent')&&g('bfAccent').value)||'#0D47A1',
    target:(g('bfTarget')&&g('bfTarget').value)||null,
    art:(g('bfArt')&&g('bfArt').value)||'twophones', alt:(g('bfAlt')&&g('bfAlt').value)||''
  },{compact:true,showWhy:false});
  const note=g('bfArtNote');
  if(note) note.textContent=(AD_MOTIFS.filter(m=>m.id===((g('bfArt')||{}).value||'twophones'))[0]||{}).note||'';
}
function newBannerDialog(){
  openModal('<div class="modal-head">'+ICO('monitor',18)+'<div class="grow"><h3 class="t-sub">New banner</h3>'+
    '<div class="t-small muted">A slot, a message, an audience and a date range.</div></div>'+
    '<button class="iconbtn" onclick="closeModal()" aria-label="Close">'+ICO('x',16)+'</button></div>'+
    '<div class="modal-body stack">'+
      bannerForm(null)+
      '<div class="impact"><strong>Before it runs</strong><ul>'+
        '<li>It is created as a <strong>draft</strong>. Nothing appears on the storefront until you set it live.</li>'+
        '<li>Alt text is required — a banner without it cannot be published.</li>'+
        '<li>Impressions and clicks are counted from the moment it goes live. A banner you cannot measure is one you cannot defend.</li>'+
        '<li>On the login slot, only region and device apply. Everything else is ignored before sign-in.</li></ul></div>'+
    '</div>'+
    '<div class="modal-foot"><span class="t-tiny muted grow">Sellers cannot buy placement.</span>'+
      '<button class="btn btn-quiet" onclick="closeModal()">Cancel</button>'+
      '<button class="btn btn-primary" onclick="submitBanner(null)">Create as draft</button></div>',
    {wide:true,label:'New banner'});
}
function editBanner(id){
  const b=BNMAP[id]; if(!b) return;
  openModal('<div class="modal-head">'+ICO('monitor',18)+'<div class="grow"><h3 class="t-sub">'+esc(b.name)+'</h3>'+
    '<div class="t-small muted t-num">'+esc(b.id)+' · '+esc(b.state)+'</div></div>'+
    '<button class="iconbtn" onclick="closeModal()" aria-label="Close">'+ICO('x',16)+'</button></div>'+
    '<div class="modal-body stack">'+
      bannerForm(b)+
      (b.impressions
        ? banner('info','This banner has '+FMT.num(b.impressions)+' impressions against it. Editing the message '+
          'does not reset the counters, so the before-and-after will be mixed together in the numbers.')
        : '')+
    '</div>'+
    '<div class="modal-foot">'+
      '<button class="btn btn-quiet" onclick="closeModal()">Cancel</button>'+
      '<div class="spacer"></div>'+
      (b.state==='draft'||b.state==='paused'
        ? '<button class="btn btn-sm" onclick="publishBanner(\''+id+'\')">Save and set live</button>' : '')+
      '<button class="btn btn-primary" onclick="submitBanner(\''+id+'\')">Save</button></div>',
    {wide:true,label:'Edit '+b.name});
}
function readBannerForm(){
  const g=k=>document.getElementById(k);
  return {
    name:(g('bfName').value||'').trim(), slot:g('bfSlot').value,
    headline:(g('bfHead').value||'').trim(), sub:(g('bfSub').value||'').trim(),
    cta:(g('bfCta').value||'').trim()||'See the offer',
    target:g('bfTarget').value||null, accent:g('bfAccent').value,
    art:(g('bfArt')&&g('bfArt').value)||'twophones',
    alt:(g('bfAlt').value||'').trim(),
    audience:g('bfAud').value, locale:g('bfLocale').value, device:g('bfDevice').value,
    from:(g('bfFrom').value||'').trim(), to:(g('bfTo').value||'').trim(),
    weight:parseInt(g('bfWeight').value,10)||50,
    promo:g('bfPromo').value||null
  };
}
function validateBanner(d){
  const g=k=>document.getElementById(k);
  const badName=!d.name, badHead=!d.headline, badAlt=!d.alt;
  g('bfNameErr').hidden=!badName; g('bfHeadErr').hidden=!badHead; g('bfAltErr').hidden=!badAlt;
  if(badName||badHead||badAlt){ (badName?g('bfName'):badHead?g('bfHead'):g('bfAlt')).focus(); return false; }
  return true;
}
function submitBanner(id){
  const d=readBannerForm();
  if(!validateBanner(d)) return;
  closeModal();
  if(id){
    const b=BNMAP[id];
    Object.assign(b,d);
    audit('promo.changed',{object:'Banner '+b.name, detail:'Message or targeting edited'});
    App.go(App.view);
    toast(b.name+' saved');
  } else {
    const b=addBanner(d);
    App.go(App.view);
    toast(b.name+' created as a draft — set it live when you are ready');
  }
}
function addBanner(d){
  SEQ.banner=(SEQ.banner||0)+1;
  const b=Object.assign({id:'BN-N'+SEQ.banner, state:'draft', art:'twophones',
    impressions:0, clicks:0, orders:0, revenue:0, isNew:true}, d);
  BANNERS.push(b); BNMAP[b.id]=b;
  audit('promo.created',{object:'Banner '+b.name,
    detail:(BANNER_SLOTS.find(s=>s.id===b.slot)||{}).label+' · '+b.audience});
  return b;
}
function publishBanner(id){
  const d=readBannerForm();
  if(!validateBanner(d)) return;
  const b=BNMAP[id]; if(!b) return;
  Object.assign(b,d);
  const pool=BANNERS.filter(x=>x.slot===b.slot&&x.state==='live'&&x.id!==b.id);
  const slot=BANNER_SLOTS.find(s=>s.id===b.slot)||{};
  closeModal();
  confirmAction({
    title:'Set '+b.name+' live', subtitle:(slot.label||b.slot)+' · shown to '+b.audience,
    confirmLabel:'Set it live',
    impact:['It appears on the storefront immediately, to everyone matching <strong>'+esc(b.audience)+'</strong>.',
            pool.length
              ? 'It joins '+pool.length+' other live banner'+(pool.length===1?'':'s')+' in this slot and takes a '+
                Math.round(b.weight/(b.weight+pool.reduce((a,x)=>a+x.weight,0))*100)+'% share of voice.'
              : 'It is the only live banner in this slot, so it shows every time.',
            b.promo && DRMAP[b.promo]
              ? 'The linked offer <strong>'+esc(DRMAP[b.promo].name)+'</strong> applies automatically at checkout.'
              : 'No offer is linked, so nothing is discounted — this advertises only.',
            'Impressions and clicks start counting now.'],
    onConfirm:()=>{
      b.state='live';
      audit('promo.changed',{object:'Banner '+b.name, detail:'Set live in '+(slot.label||b.slot),
        before:'draft', after:'live'});
      App.go(App.view);
      toast(b.name+' is live');
    }
  });
}

/* ===========================================================================
   19. DEVELOPER PORTAL  (APG · the marketplace's own APIs)
   =========================================================================== */
function apiStatePill(s){
  return s==='ga'?pill('active','GA'):s==='beta'?pill('degraded','Beta'):pill('info','Preview');
}
function vDevPortal(){
  const calls=API_CONSUMERS.reduce((a,c)=>a+c.calls30d,0);
  const prod=API_CONSUMERS.filter(c=>(APLMAP[c.plan]||{}).env==='production');
  const sbx=API_CONSUMERS.filter(c=>(APLMAP[c.plan]||{}).env==='sandbox');
  const noisy=API_CONSUMERS.filter(c=>c.errors>1.5);
  const beta=API_PRODUCTS.filter(a=>a.status!=='ga');

  return pagehead('Developer portal',
    'The APIs the marketplace extends to its partners, so they can do through an integration what they can already do in their console.',
    exportBtn('API access','dtApiCon')+
    '<button class="btn btn-sm" onclick="apiTiersDialog()">Access tiers</button>'+
    '<button class="btn btn-sm" onclick="apiEnvDialog()">Sandbox and production</button>'+
    '<button class="btn btn-sm" onclick="apiDocsDialog()">'+ICO('code',13)+'API reference</button>'+
    '<button class="btn btn-sm btn-primary" onclick="apiDialog(null)">'+ICO('plus',14)+'Publish an API</button>')+

  '<div class="stack">'+
  banner('info','<strong>This is integration access, not a product line.</strong> A seller already has the right '+
    'to read its own catalogue, take its own orders and pull its own settlement — the API is a second way to do '+
    'what the console already allows. Nothing here is sold or metered against revenue. Rate limits exist to stop '+
    'one runaway integration degrading the platform for everybody else, and they are stated so a partner can '+
    'design around them.')+

  '<div class="grid g4">'+
    metric({icon:'code',label:'APIs published',value:String(API_PRODUCTS.length),
      foot:beta.length? beta.length+' not yet general release':'All at general release'})+
    metric({icon:'plug',label:'Partners integrated',value:String(prod.length),
      foot:sbx.length+' still in sandbox'})+
    metric({icon:'activity',label:'Calls in 30 days',value:FMT.num(calls),
      foot:'Across every partner and environment'})+
    metric({icon:'warning',label:'Integrations to look at',value:String(noisy.length),
      foot:noisy.length? 'Error rate above 1.5%':'None above 1.5%'})+
  '</div>'+

  panel('What is published',
    '<div class="tablewrap"><table class="tbl"><thead><tr><th style="min-width:200px">API</th><th>Standard</th>'+
      '<th>For</th><th>Environments</th><th class="num">Methods</th><th>Scopes</th><th>State</th></tr></thead><tbody>'+
    API_PRODUCTS.map(a=>'<tr>'+
      '<td><div class="cellmain">'+esc(a.name)+' <span class="t-tiny muted">'+esc(a.version)+'</span></div>'+
        '<div class="cellsub">'+esc(a.blurb)+'</div>'+
        (a.why?'<div class="cellsub">'+esc(a.why)+'</div>':'')+'</td>'+
      '<td class="t-small">'+esc(a.spec)+'</td>'+
      '<td class="t-small">'+esc(a.audience||'Sellers')+'</td>'+
      '<td class="t-small">'+a.envs.map(e=>esc((API_ENVS.filter(x=>x.id===e)[0]||{}).label||e)).join(', ')+'</td>'+
      '<td class="num t-num">'+a.methods+'</td>'+
      '<td class="t-tiny">'+a.scopes.map(x=>'<span class="tag">'+esc(x)+'</span>').join(' ')+'</td>'+
      '<td>'+(a.status==='ga'?pill('ok','General release')
             :a.status==='beta'?pill('warn','Beta'):pill('','Preview'))+'</td></tr>'+
      (a.note?'<tr><td colspan="7" class="t-tiny muted">'+esc(a.note)+'</td></tr>':'')).join('')+
    '</tbody></table></div>'+
    (beta.length?banner('warning','<strong>'+beta.map(b=>esc(b.name)).join(' and ')+
      ' are not at general release.</strong> They are labelled rather than quietly published, because an '+
      'integration built on a contract that is still moving is a support cost deferred, not avoided.'):''),
    {icon:'code', sub:API_PRODUCTS.length+' APIs · every one of them mirrors something the console already does'})+

  apiVersionsPanel()+

  apiSubMatrixPanel()+

  panel('Who is integrated',
    dt('dtApiCon',{
      rows:API_CONSUMERS.slice(), noun:'integrations', pageSize:10, idKey:'id',
      searchFields:['name','kind','plan'], searchPlaceholder:'Search partner or buyer',
      chips:[{key:'status',options:[{label:'Active',value:'active'},{label:'Suspended',value:'suspended'}]}],
      actions:exportBtn('API access','dtApiCon'),
      columns:[
        {key:'name',label:'Who',render:r=>'<div class="cellmain">'+esc(r.name)+'</div>'+
          '<div class="cellsub">'+esc(r.kind)+' · integrating since '+esc(r.since)+'</div>'},
        {key:'plan',label:'Access tier',render:r=>{
          const t=APLMAP[r.plan]||{};
          return '<div class="cellmain">'+esc(t.name||r.plan)+'</div>'+
                 '<div class="cellsub">'+esc(t.env==='sandbox'?'Sandbox':'Production')+' · '+esc(t.rate||'')+'</div>';}},
        {key:'apps',label:'Apps',align:'right',render:r=>'<span class="t-num">'+r.apps+'</span>'},
        {key:'calls30d',label:'Calls, 30 days',align:'right',sort:true,
          render:r=>'<span class="t-num">'+FMT.num(r.calls30d)+'</span>'},
        {key:'errors',label:'Errors',align:'right',sort:true,render:r=>
          '<span class="t-num'+(r.errors>1.5?' cellmain':'')+'">'+r.errors.toFixed(1)+'%</span>'},
        {key:'p95',label:'p95',align:'right',render:r=>'<span class="t-num">'+r.p95+' ms</span>'},
        {key:'status',label:'State',render:r=>r.status==='active'?pill('ok','Active'):pill('warn','Suspended')}
      ]}),
    {flush:true, icon:'group',
     sub:'A partner in sandbox has not cleared the technical gate yet — that is the sequence, not a delay'})+

  (noisy.length? panel('Integrations worth a conversation',
    '<ul class="ticklist">'+noisy.map(c=>
      '<li>'+ICO('warning',15)+'<div class="grow"><strong>'+esc(c.name)+'</strong> — '+c.errors.toFixed(1)+
      '% of calls fail, p95 '+c.p95+' ms'+
      '<div class="t-small muted">'+esc(c.note||'Worth a look before it becomes a support case. A failing '+
      'integration usually means a contract misunderstanding, not a broken platform.')+'</div></div></li>').join('')+
    '</ul>'+
    banner('info','Throughput is never cut to enforce a commercial term, because there is no commercial term here '+
      'to enforce. It is cut only to protect the platform, and only after the partner has been told.'),
    {icon:'activity', sub:noisy.length+' above 1.5% errors'}) : '')+

  '</div>';
}

function apiEnvDialog(){
  openModal('<div class="modal-head">'+ICO('server',18)+'<div class="grow"><h3 class="t-sub">Sandbox and production</h3>'+
    '<div class="t-small muted">Two environments, and the step between them</div></div>'+
    '<button class="iconbtn" onclick="closeModal()" aria-label="Close">'+ICO('x',16)+'</button></div>'+
    '<div class="modal-body stack">'+
      API_ENVS.map(e=>'<div>'+
        '<h4 class="t-sub" style="margin:0 0 5px">'+esc(e.label)+'</h4>'+
        dl([['Base URL','<code class="epurl">'+esc(e.base)+'</code>'],
            ['Data',esc(e.data)],
            ['Availability',esc(e.commitment)],
            ['Who gets it',esc(e.gate)]])+'</div>').join('<div class="divider"></div>')+
      banner('info','<strong>Production is earned, not requested.</strong> A partner reaches it by clearing the '+
        'technical gate and completing one sandbox order end to end. That single requirement removes most of the '+
        'go-live failures, because the integration has already been proved against a real flow.')+
      banner('warning','<strong>The sandbox is reset weekly and carries no availability commitment.</strong> '+
        'Said plainly rather than implied by omission, so nobody builds a demo on it the day before a launch.'),
    '</div>'+
    '<div class="modal-foot"><span class="t-tiny muted grow">Applies to every published API</span>'+
      '<button class="btn btn-primary" onclick="closeModal()" data-autofocus>Close</button></div>',
    {wide:true,label:'Environments'});
}

function apiTiersDialog(){
  openModal('<div class="modal-head">'+ICO('layers',18)+'<div class="grow"><h3 class="t-sub">Access tiers</h3>'+
    '<div class="t-small muted">Entitlements, not price bands</div></div>'+
    '<button class="iconbtn" onclick="closeModal()" aria-label="Close">'+ICO('x',16)+'</button></div>'+
    '<div class="modal-body stack">'+
      banner('info','<strong>Which tier a partner holds follows from where it is in onboarding and what it sells.</strong> '+
        'It changes when that changes. There is nothing to buy and nothing to negotiate.')+
      '<div class="tablewrap"><table class="tbl"><thead><tr><th>Tier</th><th>Environment</th>'+
        '<th>Rate limit</th><th>Quota</th><th>Availability</th></tr></thead><tbody>'+
      API_TIERS.map(t=>'<tr>'+
        '<td><div class="cellmain">'+esc(t.name)+'</div><div class="cellsub">'+esc(t.who)+'</div></td>'+
        '<td class="t-small">'+esc(t.env==='sandbox'?'Sandbox':'Production')+'</td>'+
        '<td class="t-small t-num">'+esc(t.rate)+'</td>'+
        '<td class="t-small t-num">'+esc(t.quota)+'</td>'+
        '<td class="t-small">'+esc(t.commitment)+'</td></tr>'+
        '<tr><td colspan="5" class="t-tiny muted">Scopes: '+t.scopes.map(x=>esc(x)).join(', ')+'</td></tr>').join('')+
      '</tbody></table></div>'+
      banner('warning','<strong>Exceeding the rate limit slows a partner down; it does not cut them off.</strong> '+
        'Requests are queued and shed at the edge, and the partner is told. Cutting a seller’s order flow to '+
        'enforce a limit turns a capacity problem into a customer-facing failure.')+
      banner('info','A seller pays nothing for access to its own catalogue, its own orders or its own settlement. '+
        'Charging for that would tax the sellers who automate — the ones who cost the marketplace least to serve.'),
    '</div>'+
    '<div class="modal-foot"><span class="t-tiny muted grow">Limits are protection, not packaging</span>'+
      '<button class="btn btn-primary" onclick="closeModal()" data-autofocus>Close</button></div>',
    {wide:true,label:'Access tiers'});
}

function apiDocsDialog(){
  const a=API_PRODUCTS[0];
  openModal('<div class="modal-head">'+ICO('code',18)+'<div class="grow"><h3 class="t-sub">API reference</h3>'+
    '<div class="t-small muted">'+API_PRODUCTS.length+' APIs · OpenAPI and AsyncAPI specifications</div></div>'+
    '<button class="iconbtn" onclick="closeModal()" aria-label="Close">'+ICO('x',16)+'</button></div>'+
    '<div class="modal-body stack">'+
      '<div class="field"><label for="adApi">API</label><select class="inp" id="adApi" onchange="apiDocsShow()">'+
        API_PRODUCTS.map(x=>'<option value="'+x.id+'">'+esc(x.name)+' '+esc(x.version)+' · '+esc(x.spec)+
          '</option>').join('')+'</select></div>'+
      '<div id="adBody">'+apiDocsBody(a.id)+'</div>'+
    '</div>'+
    '<div class="modal-foot"><span class="t-tiny muted grow">Specifications are downloadable and machine-readable.</span>'+
      '<button class="btn btn-quiet" onclick="closeModal()">Close</button>'+
      '<button class="btn" onclick="downloadSamplePayload()">'+ICO('download',14)+'Sample payload</button>'+
      '<button class="btn btn-primary" onclick="downloadApiSpec(document.getElementById(\'adApi\').value)">'+
      ICO('download',14)+'Download the spec</button></div>',
    {wide:true,label:'API reference'});
}
function apiDocsShow(){
  const id=($('#adApi')||{}).value;
  const b=$('#adBody'); if(b) b.innerHTML=apiDocsBody(id);
}
function apiDocsBody(id){
  const a=APIPMAP[id]||API_PRODUCTS[0];
  const sample = a.id==='AP-CAT'
    ? 'GET /v2/productOffering?category=security&limit=20\nAuthorization: Bearer {token}\n\n200 OK\n{\n  "totalCount": 6,\n  "items": [\n    {\n      "id": "SKU-6001",\n      "name": "Sentinel MDR Essentials",\n      "seller": "Sentinel Cyber",\n      "price": { "amount": 323.00, "currency": "USD", "unit": "seat/month" },\n      "availability": "in_stock",\n      "rating": 4.7\n    }\n  ]\n}'
    : a.id==='AP-ORD'
    ? 'POST /v2/productOrder\nAuthorization: Bearer {token}\nIdempotency-Key: {uuid}\n\n{\n  "account": "ACC-BLF",\n  "items": [ { "sku": "SKU-6001", "qty": 40 } ],\n  "poNumber": "PO-2026-BLF-0044"\n}\n\n201 Created\n{ "id": "ORD-882431", "state": "acknowledged", "total": 12920.00 }'
    : 'GET /v1/'+a.name.split(' ')[0].toLowerCase()+'\nAuthorization: Bearer {token}\n\n200 OK\n{ "items": [ ... ] }';
  return '<div class="stack">'+
    '<div class="t-small">'+esc(a.blurb)+'</div>'+
    (a.note?banner('info','<strong>Worth knowing.</strong> '+esc(a.note)):'')+
    '<dl class="deflist">'+
      '<dt>Standard</dt><dd>'+esc(a.spec)+'</dd>'+
      '<dt>Version</dt><dd>'+esc(a.version)+' · '+esc(a.status.toUpperCase())+'</dd>'+
      '<dt>Methods</dt><dd>'+a.methods+'</dd>'+
      '<dt>Scopes required</dt><dd>'+a.scopes.map(s=>'<span class="tag t-num">'+esc(s)+'</span>').join(' ')+'</dd>'+
      '<dt>Sandbox</dt><dd>'+(a.sandbox?'Available, with no availability commitment':'Not available')+'</dd>'+
      '<dt>Authentication</dt><dd>OAuth 2.0 client credentials</dd>'+
      '<dt>Idempotency</dt><dd>'+(a.id==='AP-ORD'
        ? 'Required on writes. A repeated key returns the original result rather than a second order.'
        : 'Not applicable — reads only')+'</dd>'+
    '</dl>'+
    '<div><div class="t-small strong" style="margin-bottom:6px">Example</div>'+
    '<div class="codeblock">'+esc(sample)+'</div></div>'+
  '</div>';
}

/* ===========================================================================
   20. COLLECTIONS  (ORD · dunning)
   =========================================================================== */
function vOpsCollections(){
  return dunningView({ctx:'operator', title:'Collections'});
}

/* --------------------- 24. NUMBERS, DELIVERY AND SIGN-IN (M20) ----------- */
function vOpsNumbers(){ return numberInventoryView({title:'Numbers and SIMs'}); }
function vOpsDelivery(){ return deliveryView({title:'Message delivery'}); }
function vOpsAuth(){ return vAuth(); }

/* --------------------- BULK UPDATE (M21) -------------------------------- */
function vOpsBulk(){ return bulkView({title:'Bulk updates'}); }

/* --------------------- 25. LISTING RULE CATALOGUE (M22) ----------------- */
function vOpsRules(){ return ruleCatalogueView(); }

/* --------------------- KNOWLEDGE BASE (M24) ----------------------------- */
function vOpsHelp(){ return kbView(); }

/* --------------------- 26. PARTNER API REGISTRY (M27) ------------------- */
function vOpsPartnerApis(){ return vPartnerApis(); }

/* --------------------- 27. TECHNICAL MILESTONE (M28) -------------------- */
/* The integration milestone in full, opened from the onboarding record. */
function openTechMilestone(pid){
  const p=PMAP[pid]||{name:pid};
  openInspector(
    '<div class="insp-head">'+ICO('plug',18)+'<div class="grow"><h3 class="t-sub">Integration milestone</h3>'+
      '<div class="t-small muted">'+esc(p.name)+' · technical readiness gate</div></div>'+
      '<button class="iconbtn" onclick="closeInspector()" aria-label="Close">'+ICO('x',16)+'</button></div>'+
    '<div class="insp-body stack">'+
      banner('info','API registration is part of onboarding, not a task beside it. A seller reaches go-live only '+
        'once the marketplace has called their endpoints and been answered.')+
      techGatePanel(pid)+
      sandboxRunPanel(pid)+
    '</div>', p.name+' · integration');
}

/* --------------------- 28. GENERAL LEDGER (M33) ------------------------- */
function vOpsLedger(){ return vGeneralLedger(); }

