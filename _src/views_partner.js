/* ===========================================================================
   PERSONA: Partner / Seller — the B2B2X supply side.
   Partner onboarding, product onboarding, order status, settlement plans
   and payouts. 6D-branded operator platform.
   =========================================================================== */

const ME_P    = PMAP['PTR-1004'];                    /* Nimbus Sensors — live seller */
const MY_PLAN = CPMAP[ME_P.plan];
let MY_LIST, MY_ORD, MY_STM, MY_GMV, MY_COMM, MY_OPEN, MY_FAIL, MY_DUE, MY_DISP;
/* This seller's own trailing history, used by the period switch. */
function MY_HIST(){ return PARTNER_HISTORY[ME_P.id] || HISTORY; }

/* Recomputed before every render, so anything an action changed shows up. */
/* Branding is re-applied after every render so it survives navigation. */
function AFTER_RENDER(){ if(typeof brandApply==='function') brandApply(); }
function refreshPartner(){
  MY_LIST = PRODUCTS.filter(p=>p.partner===ME_P.id);
  MY_ORD  = ORDERS.filter(o=>o.partnerId===ME_P.id);
  MY_STM  = SETTLEMENTS.filter(s=>s.partnerId===ME_P.id);
  MY_GMV  = +MY_ORD.reduce((a,o)=>a+o.gross,0).toFixed(2);
  MY_COMM = +MY_ORD.reduce((a,o)=>a+o.comm,0).toFixed(2);
  MY_OPEN = MY_ORD.filter(o=>o.stage < o.stages.length-1 && !o.failed);
  MY_FAIL = MY_ORD.filter(o=>o.failed);
  MY_DUE  = +MY_STM.filter(s=>s.status!=='paid').reduce((a,s)=>a+s.net,0).toFixed(2);
  MY_DISP = DISPUTES.filter(d=>d.partner===ME_P.name);
}
refreshPartner();
function BEFORE_RENDER(){ refreshPartner(); }

/* Their original onboarding — complete — and a live application to add a
   second marketplace. Both are shown, because partners expand more often
   than they join. */
/* One working week, Monday to Friday. */
const MY_ONB_DONE = {
  apply:'09 Sep 2024', kyc:'11 Sep 2024', agree:'12 Sep 2024', finance:'12 Sep 2024',
  tech:'13 Sep 2024', assure:'13 Sep 2024', golive:'13 Sep 2024'
};
const MY_ONB_NEW = {
  target:'Security Marketplace', targetV:'security', ref:'ONB-8842',
  started:'14 Jul 2026', sla:'5 working days', elapsed:'3 working days', live:false,
  state:{apply:'done', kyc:'done', agree:'done', finance:'done', tech:'now', assure:'todo', golive:'todo'}
};
const MY_ONB_TASKS = [
  {id:'OB-9101', step:'tech', title:'Publish a sandbox test order',
   detail:'Place one end-to-end order in sandbox so fulfilment and settlement can be verified before go-live in the new marketplace.',
   owner:'You', due:'In 2 days', status:'pending'},
  {id:'OB-9102', step:'tech', title:'Fulfilment webhook returning 500 on retry',
   detail:'Three of five sandbox callbacks failed. Until the endpoint is stable, order status will not update automatically.',
   owner:'You', due:'Today', status:'blocked'},
  {id:'OB-9103', step:'assure', title:'Security questionnaire',
   detail:'42-question baseline covering data handling, retention and sub-processors. Opens once the technical gate closes.',
   owner:'You', due:'Not started', status:'notstarted'},
  {id:'OB-9104', step:'agree', title:'Security marketplace addendum signed',
   detail:'Addendum to the master agreement extending your listing rights to the Security Marketplace.',
   owner:'Both', due:'—', status:'done'},
  {id:'OB-9105', step:'finance', title:'Settlement account reused',
   detail:'Existing verified account carried over from your IoT onboarding. No new verification needed.',
   owner:'Marketplace', due:'—', status:'done'}
];

const P_INSIGHTS=[
  {icon:'warning', conf:'High confidence', src:'Read: your open orders and fulfilment webhook log',
   title:'Your webhook is blocking the Security marketplace go-live',
   body:'Three of five sandbox fulfilment callbacks returned HTTP 500 on retry. The technical gate cannot close until five consecutive callbacks succeed. '+
        'At 3 of 5 working days elapsed, this is now the only thing between you and go-live.',
   acts:'<button class="btn btn-sm btn-primary" onclick="App.go(\'onboarding\')">Open the gate</button>'+
        '<button class="btn btn-sm" onclick="toast(\'Callback log opened — last 5 attempts\')">See callback log</button>'},
  {icon:'trendup', conf:'High confidence', src:'Read: your 12-month order history and listing ratings',
   title:'Your bundle outsells its parts three to one',
   body:'The cold-chain starter bundle accounts for a large share of your gross value on a fraction of the order count. '+
        'Sensors sold individually convert at a much lower rate against the same listing traffic.',
   acts:'<button class="btn btn-sm" onclick="App.go(\'performance\')">See the numbers</button>'+
        '<button class="btn btn-sm" onclick="App.go(\'newlisting\')">Draft a second bundle</button>'},
  (function(){
    const next = MY_PLAN.tiers.find(t=>t.from>MY_GMV);
    return next
      ? {icon:'wallet', conf:'Medium confidence', src:'Read: your settlement statements and commission plan',
         title:'You are '+CUR0(next.from-MY_GMV)+' from the next commission tier',
         body:'Your plan drops from '+MY_PLAN.base+'% to '+next.rate+'% above '+CUR0(next.from)+' of trailing gross value. '+
              'At your current run-rate that is reachable this quarter — but the estimate assumes the run-rate holds, and a slow month pushes it out.',
         acts:'<button class="btn btn-sm" onclick="App.go(\'plan\')">See the tiers</button>'}
      : {icon:'wallet', conf:'High confidence', src:'Read: your settlement statements and commission plan',
         title:'You are on the best commission tier this plan offers',
         body:'Trailing gross value of <strong>'+CUR0(MY_GMV)+'</strong> puts you above every tier threshold on '+esc(MY_PLAN.name)+', so you are already paying the lowest rate the plan allows. '+
              'Anything better would need a different plan, not more volume.',
         acts:'<button class="btn btn-sm" onclick="App.go(\'plan\')">See the tiers</button>'+
              '<button class="btn btn-sm" onclick="requestTier()">Request a plan review</button>'};
  })()
];

/* ------------------------------ 1. Dashboard ------------------------------ */
function vPHome(){
  return pagehead('Seller dashboard',
    esc(ME_P.name)+' · '+esc(ME_P.id)+' · '+esc(ME_P.tier)+' partner since '+esc(ME_P.joined)+
    ' · selling in '+ME_P.verticals.map(v=>esc(vName(v).replace(' Marketplace',''))).join(' and '),
    periodTabs()+
    exportBtn('Seller summary','sellerSummary'))+
  '<div class="stack">'+

  banner('warning','<strong>Your Security Marketplace application is stuck at the technical gate.</strong> '+
    MY_ONB_NEW.elapsed+' of '+MY_ONB_NEW.sla+' elapsed, and the fulfilment webhook is failing on retry. '+
    '<button class="linkbtn" onclick="App.go(\'onboarding\')">Open onboarding</button>')+

  /* Which marketplaces this seller is actually in. It was only discoverable
     from the dropdown on the new-listing wizard, which is no place to learn
     what your own account is approved for. */
  myMarketplacesStrip()+

  periodNote(MY_HIST())+
  /* Cards the seller has chosen to see. Three are locked on. */
  (function(){
    const on=id=>MY_BRAND.widgets[id]!==false;
    const cards=[];
    if(on('gmv')) cards.push((function(){
      const t=periodTotals(MY_HIST());
      return metric({icon:'wallet',label:'Gross merchandise value',value:CUR0(t.gross),
        foot:periodFoot(MY_HIST(),'gross',FMT.num(t.orders)+' orders')});
    })());
    if(on('orders')) cards.push(metric({icon:'orders',label:'Orders to fulfil',value:String(MY_OPEN.length),
      foot:MY_FAIL.length?MY_FAIL.length+' failed and need action':'Nothing overdue'}));
    if(on('settlement')) cards.push(metric({icon:'invoice',label:'Settlement due to you',value:CUR(MY_DUE),
      foot:'Next payout '+esc(MY_STM[0]?MY_STM[0].due:'—')}));
    if(on('listings')) cards.push(metric({icon:'package',label:'Live listings',
      value:MY_LIST.filter(l=>l.status==='live').length+' of '+MY_LIST.length,
      foot:MY_LIST.filter(l=>l.status==='pending').length+' awaiting marketplace review'}));
    return cards.length ? '<div class="grid g'+Math.min(4,cards.length)+'">'+cards.join('')+'</div>' : '';
  })()+

  '<div class="grid g-2-1">'+
    panel('Gross value by listing',
      CH.bars(MY_LIST.filter(l=>l.status==='live').map(l=>({
        l:l.name.split(' ').slice(0,2).join(' '),
        v:+MY_ORD.filter(o=>o.sku===l.id).reduce((a,o)=>a+o.gross,0).toFixed(0)})),
        {fmt:n=>CUR0(n),tip:n=>CUR(n),aria:'Gross value by listing'}),
      {icon:'chart', sub:'Last 90 days · gross order value before commission'})+
    panel('Where your money goes',
      splitBar(1000,MY_PLAN)+
      '<div class="divider"></div>'+
      '<div class="stack" style="gap:8px">'+
        '<div class="row"><span class="t-small grow">Your plan</span><span class="t-small strong">'+esc(MY_PLAN.name)+'</span></div>'+
        '<div class="row"><span class="t-small grow">Commission</span><span class="t-small strong t-num">'+MY_PLAN.base+'%</span></div>'+
        '<div class="row"><span class="t-small grow">Payout cycle</span><span class="t-small strong">'+esc(MY_PLAN.cycle)+'</span></div>'+
        '<div class="row"><span class="t-small grow">Holdback</span><span class="t-small strong">'+esc(MY_PLAN.hold)+'</span></div>'+
      '</div>'+
      '<button class="btn btn-sm btn-quiet" style="margin-top:11px" onclick="App.go(\'plan\')">Full settlement plan</button>',
      {icon:'wallet', sub:'Illustrated on a '+CUR0(1000)+' sale'})+
  '</div>'+

  (MY_BRAND.widgets.chart===false ? '' :
    forecastPanel({series:MY_HIST(), title:'Settlement projection',
      label:'Projected gross value',
      sub:'Your own orders. What settles to you is this less commission, fees and any withholding.',
      assumptions:[
        'Your current live listings only. One awaiting review contributes nothing until it is approved.',
        'Commission is '+MY_PLAN.base+'% under '+esc(MY_PLAN.name)+'. Crossing a volume tier lowers it, so gross and settlement do not move together.',
        'It assumes your fulfilment holds — a failed order is gross value that never settles.',
        '<strong>It is not a payment schedule.</strong> Your cycle is '+esc(MY_PLAN.cycle)+' with a '+esc(MY_PLAN.hold)+' holdback.'
      ]}))+

  (MY_BRAND.widgets.insights===false ? '' :
    panel('AI insights', P_INSIGHTS.map(aiInsight).join(''),
      {ai:true, flush:true, icon:'ai',
       sub:'Based on your own listings, orders and settlement records. Nothing about other sellers is visible to you.'}))+

  '<div class="grid g2">'+
    panel('Orders needing you',
      (MY_OPEN.length||MY_FAIL.length)
        ? '<table class="tbl"><tbody>'+MY_FAIL.concat(MY_OPEN).slice(0,6).map(o=>
            '<tr onclick="openOrder(\''+o.id+'\',{showComm:true})" style="cursor:pointer">'+
            '<td><div class="cellmain t-num">'+esc(o.id)+'</div><div class="cellsub">'+esc(o.name)+'</div></td>'+
            '<td class="num" style="width:96px">'+CUR(o.gross)+'</td>'+
            '<td style="width:130px">'+orderStatePill(o)+'</td></tr>').join('')+'</tbody></table>'
        : stateBlock('empty','Nothing waiting','Every order is fulfilled and settled.'),
      {flush:true,icon:'orders',acts:'<button class="btn btn-sm btn-quiet" onclick="App.go(\'orders\')">All orders</button>'})+
    panel('Seller rating',
      '<div class="row" style="gap:14px;align-items:center">'+
        '<div><div class="m-value" style="font-size:30px">'+ME_P.rating.toFixed(1)+'</div>'+
        '<div class="stars" aria-hidden="true">'+SH('star',13)+SH('star',13)+SH('star',13)+SH('star',13)+SH('starO',13)+'</div></div>'+
        '<div class="stack grow" style="gap:5px">'+
        [5,4,3,2,1].map((n,i)=>'<div class="meterline"><span class="t-tiny" style="width:12px">'+n+'</span>'+
          '<div class="meter"><span style="width:'+[62,24,8,4,2][i]+'%"></span></div>'+
          '<span class="mv">'+[62,24,8,4,2][i]+'%</span></div>').join('')+
        '</div>'+
      '</div><div class="divider"></div>'+
      '<div class="stack" style="gap:7px">'+
        '<div class="row"><span class="t-small grow">Dispatch on time</span><span class="t-small strong">96%</span></div>'+
        '<div class="row"><span class="t-small grow">Dispute rate</span><span class="t-small strong">'+
          (MY_ORD.length?(MY_DISP.length/MY_ORD.length*100).toFixed(1):'0')+'%</span></div>'+
        '<div class="row"><span class="t-small grow">Returns</span><span class="t-small strong">2.1%</span></div>'+
        '<div class="row"><span class="t-small grow">Response time</span><span class="t-small strong">4 h median</span></div>'+
      '</div>',{icon:'thumbsup'})+
  '</div>'+
  '</div>';
}

/* ------------------------ 2. Partner onboarding journey ------------------- */
function vPOnboarding(){
  const st=MY_ONB_NEW.state;
  const openTasks=MY_ONB_TASKS.filter(t=>t.status!=='done');
  const docs=myDocs();
  return pagehead('Onboarding',
    'Your original onboarding and any application to add a marketplace, with every gate and who owns it.',
    '<button class="btn" onclick="onboardingGuide()">'+ICO('file',13)+'Guide</button>'+
    '<button class="btn btn-primary" onclick="addMarketplaceDialog()">'+ICO('plus',14)+'Add a marketplace</button>')+
  '<div class="stack">'+

  (function(){
    const cur=onbCurrentGate(MY_ONB_NEW.state);
    if(MY_ONB_NEW.live)
      return banner('info','<strong>You are live in the '+esc(MY_ONB_NEW.target)+'.</strong> Your storefront is open there and you can publish listings into it. '+
        '<button class="linkbtn" onclick="App.go(\'newlisting\')">Create a listing</button>');
    if(!cur)
      return banner('info','<strong>Every gate is cleared.</strong> The '+esc(MY_ONB_NEW.target)+' is ready to open — publish when you are. '+
        '<button class="linkbtn" onclick="onbGoLive()">Go live now</button>');
    return banner('warning','<strong>'+esc(MY_ONB_NEW.target)+' application '+esc(MY_ONB_NEW.ref)+' is at the '+
      esc(cur.name.toLowerCase())+' gate.</strong> '+esc(MY_ONB_NEW.elapsed)+' of '+esc(MY_ONB_NEW.sla)+' used. '+
      MY_ONB_TASKS.filter(t=>t.step===cur.id&&t.status!=='done').length+' task'+
      (MY_ONB_TASKS.filter(t=>t.step===cur.id&&t.status!=='done').length===1?' is':'s are')+
      ' yours; the marketplace is not waiting on anything.');
  })()+

  panel('Application to join '+MY_ONB_NEW.target,
    '<div class="pipe">'+ONB_STEPS.map((s,i)=>{
      const v=st[s.id];
      const cls = v==='done'?'done':v==='now'?'now':v==='fail'?'fail':'todo';
      const sub=MY_ONB_SUB[s.id];
      return '<button class="step '+cls+'" onclick="openMyGate(\''+s.id+'\')" '+
        'aria-label="Gate '+(i+1)+', '+esc(s.name)+' — '+esc(gateStateName(v))+
        (sub&&!sub.notStarted?'. Submitted '+esc(sub.submittedOn)+'. Open to read it':'. Nothing submitted yet')+'">'+
        '<div class="dot" aria-hidden="true">'+
        (v==='done'?SH('check',11):v==='fail'?SH('bang',11):(i+1))+'</div><div class="lbl">'+esc(s.name)+'</div>'+
        '<div class="when">'+(v==='done'?'Cleared':v==='now'?'You are here':v==='fail'?'Blocked':'Not started')+'</div></button>';
    }).join('')+'</div>'+
    '<div class="t-tiny muted" style="margin-top:-2px">Open any gate to read exactly what was submitted at it.</div>'+
    '<div class="divider"></div>'+
    '<div class="grid g3">'+
      metric({icon:'clock',label:'Elapsed',value:MY_ONB_NEW.elapsed,foot:'Target '+MY_ONB_NEW.sla})+
      metric({icon:'checklist',label:'Gates cleared',value:onbCleared(st)+' of '+ONB_STEPS.length,
        foot:onbCurrentGate(st)?(onbCurrentGate(st).name+' is open'):'All gates cleared'})+
      metric({icon:'user',label:'Waiting on',
        value: MY_ONB_NEW.live ? 'Nobody' : onbCurrentGate(st) ? 'You' : 'You — go live',
        foot: MY_ONB_NEW.live ? 'Live in the '+MY_ONB_NEW.target : openTasks.length+' open tasks'})+
    '</div>'+
    (!MY_ONB_NEW.live && !onbCurrentGate(st)
      ? '<div class="divider"></div><div class="row"><span class="t-small muted grow">'+
        'Every gate is cleared. Publishing opens your storefront in the '+esc(MY_ONB_NEW.target)+'.</span>'+
        '<button class="btn btn-primary" onclick="onbGoLive()">'+ICO('zap',14)+'Publish and go live</button></div>'
      : ''),
    {icon:'route', sub:'Reference '+MY_ONB_NEW.ref+' · started '+MY_ONB_NEW.started})+

  panel('What each gate needs',
    '<div class="tablewrap"><table class="tbl"><thead><tr><th style="width:180px">Gate</th><th>What it checks</th><th style="width:130px">State</th><th style="width:120px">Owner</th></tr></thead><tbody>'+
    ONB_STEPS.map(s=>{
      const v=st[s.id];
      return '<tr><td class="cellmain">'+esc(s.name)+'</td><td>'+esc(s.desc)+'</td>'+
      '<td>'+(v==='done'?pill('approved','Cleared'):v==='now'?pill('inprogress','Open'):v==='fail'?pill('rejected','Blocked'):pill('neutral','Not started'))+'</td>'+
      '<td class="t-small">'+(v==='done'?'—':v==='now'?'You':'Marketplace')+'</td></tr>';
    }).join('')+'</tbody></table></div>',{flush:true,icon:'checklist'})+

  panel('Your tasks',
    '<div class="stack" style="gap:0">'+MY_ONB_TASKS.map(t=>
      '<div class="row" style="align-items:flex-start;gap:11px;padding:11px 0;border-bottom:1px solid var(--nim-line-100)">'+
      '<span style="flex:0 0 auto;color:var(--nim-'+(t.status==='done'?'success':t.status==='blocked'?'danger':'warning')+'-fg)">'+
        ICO(t.status==='done'?'checkcircle':t.status==='blocked'?'alert':'clock',16)+'</span>'+
      '<div class="grow"><div class="row" style="gap:7px"><span class="t-small strong">'+esc(t.title)+'</span>'+
        '<span class="tag">'+esc((ONB_STEPS.find(s=>s.id===t.step)||{}).name||t.step)+'</span></div>'+
      '<div class="t-tiny muted" style="margin-top:3px">'+esc(t.detail)+'</div></div>'+
      /* One right-hand rail with fixed slots. State and action each had their
         own width before, so the right edge of every row landed somewhere
         different and the owner line hung under whichever was wider. */
      '<div class="taskrail">'+
        '<span class="trstate">'+
          (t.status==='done'?pill('approved','Done'):t.status==='blocked'?pill('down','Blocked'):
           t.status==='notstarted'?pill('off','Not started'):pill('pending','Due '+t.due))+
        '</span>'+
        '<span class="tract">'+
          (t.status==='blocked'||t.status==='pending'
            ? '<button class="btn btn-sm btn-primary" onclick="onbTask(\''+t.id+'\')">Resolve</button>'
            : t.status==='notstarted'
            ? '<button class="btn btn-sm" disabled title="Opens when the previous gate clears">Locked</button>'
            : '<button class="btn btn-sm btn-quiet" onclick="onbTask(\''+t.id+'\')">View</button>')+
        '</span>'+
        '<span class="trowner">Owner: '+esc(t.owner)+'</span>'+
      '</div>'+
      '</div>').join('')+'</div>',
    {flush:true,icon:'inbox',sub:openTasks.length+' open · the marketplace cannot progress the gate until these close'})+

  /* Documents runs the full width. Four columns and a two-action rail inside
     a half-width grid cell left the actions wrapping under the state, which
     is what made the column look ragged — and three panels in a two-column
     grid left the third stranded beside dead space. */
    panel('Documents',
      '<div class="tablewrap"><table class="tbl"><thead><tr><th>Document</th>'+
      '<th style="width:150px">Gate</th>'+
      '<th style="width:120px">Provided</th><th style="width:150px">Validity</th>'+
      '<th style="width:150px">State</th><th style="width:250px"></th></tr></thead><tbody>'+
      docs.map(d=>'<tr><td class="cellmain">'+esc(d.name)+'</td>'+
      '<td class="t-small">'+esc((ONB_STEPS.find(g=>g.id===d.gate)||{}).name||d.gate)+'</td>'+
      '<td>'+esc(d.when)+'</td>'+
      '<td class="t-small'+(d.status==='expiring'?' strong':' muted')+'">'+
        esc(d.exp==='—' ? 'No expiry' : d.exp)+'</td>'+
      '<td>'+(d.status==='verified'?pill('approved','Verified')
        :d.status==='expiring'?pill('degraded','Expiring')
        :d.status==='pending'?pill('pending','With the marketplace')
        :pill('off','Missing'))+'</td>'+
      '<td>'+actionCell(
        (d.status==='verified'||d.status==='expiring')
          ? '<button class="btn btn-sm btn-quiet" onclick="viewMyDoc('+
            JSON.stringify(d.name).replace(/"/g,'&quot;')+')">View</button>'
          : actionHeld('Nothing on file',''),
        d.status==='missing'
          ? '<button class="btn btn-sm btn-primary" onclick="uploadMyDoc('+
            JSON.stringify(d.name).replace(/"/g,'&quot;')+')">Upload</button>'
          : d.status==='expiring'
            ? '<button class="btn btn-sm" onclick="uploadMyDoc('+
              JSON.stringify(d.name).replace(/"/g,'&quot;')+',true)">Renew</button>'
            : actionDone('Verified', d.when),
        {width:'104px'})+'</td></tr>').join('')+
      '</tbody></table></div>'+
      '<div class="pad">'+
      banner('warning','Your <strong>tax residency certificate expires on 11 Sep 2026</strong>. Without a valid certificate, 10% is withheld from every payout at source.')+
      '</div>',
      {flush:true,icon:'file',
       sub:docs.filter(d=>d.status==='verified').length+' verified · '+
         docs.filter(d=>d.status==='expiring').length+' expiring · '+
         docs.filter(d=>d.status==='missing').length+' not yet supplied'})+

  '<div class="grid g2">'+
    panel('Marketplaces you already hold',
      '<div class="stack" style="gap:0">'+
      ME_P.verticals.filter(v=>v!==MY_ONB_NEW.targetV).map(v=>{
        const n=MY_LIST.filter(p=>p.v===v.id||p.v===v).length;
        const nm=vName(v);
        return '<div class="row" style="gap:11px;padding:10px 0;border-bottom:1px solid var(--nim-line-100)">'+
          '<span style="flex:0 0 auto;color:var(--nim-success-fg)">'+ICO('checkcircle',16)+'</span>'+
          '<div class="grow"><div class="t-small strong">'+esc(nm)+'</div>'+
          '<div class="t-tiny muted">Cleared every gate on '+esc(MY_ONB_DONE.golive)+
          ' · '+(n? n+' listing'+(n===1?'':'s')+' published' : 'nothing listed yet')+'</div></div>'+
          '<div class="taskrail"><span class="trstate">'+pill('approved','Live')+'</span>'+
          '<span class="tract"><button class="btn btn-sm btn-quiet" onclick="App.go(\'listings\')">'+
          'Listings</button></span></div>'+
        '</div>';
      }).join('')+'</div>'+
      banner('info','<strong>A new marketplace reuses what you have already cleared.</strong> Your '+
        'company verification, agreements and settlement account carry over — only what is specific to '+
        'the new category is asked for again, which is why an addition takes days rather than weeks.'),
      {icon:'layers',
       sub:ME_P.verticals.filter(v=>v!==MY_ONB_NEW.targetV).length+' approved · '+
         (MY_ONB_NEW.targetV? '1 more in flight' : 'no application in flight')})+
    panel('Your original onboarding',
      '<ul class="timeline">'+ONB_STEPS.map(s=>
        '<li class="tl-success"><div class="tl-when">'+esc(MY_ONB_DONE[s.id])+'</div>'+
        '<div class="tl-what">'+esc(s.name)+' cleared</div>'+
        '<div class="tl-who">'+esc(s.desc)+'</div></li>').join('')+'</ul>'+
      '<div class="divider"></div>'+
      '<div class="row"><span class="t-small muted grow">Total time from application to go-live</span>'+
      '<span class="t-small strong">4 working days</span></div>'+
      '<div class="row"><span class="t-small muted grow">Marketplaces you can list in</span>'+
      '<span class="t-small strong">'+ME_P.verticals.length+'</span></div>',
      {icon:'history',sub:'Completed 13 Sep 2024 · kept for audit'})+
  '</div>'+
  '</div>';
}
/* --- the onboarding machine: tasks close gates, gates open the next one --- */
function onbTaskById(id){ return MY_ONB_TASKS.find(x=>x.id===id); }
function onbGateTasksDone(step){
  return MY_ONB_TASKS.filter(t=>t.step===step).every(t=>t.status==='done');
}
/* Closing every task on the open gate clears it and opens the next. */
function onbSyncGates(){
  let moved=null;
  const cur = onbCurrentGate(MY_ONB_NEW.state);
  if(cur && onbGateTasksDone(cur.id)){
    moved = onbClearGate(MY_ONB_NEW.state);
    if(moved){
      MY_ONB_TASKS.filter(t=>t.step===moved.id && t.status==='notstarted')
                  .forEach(t=>{ t.status='pending'; t.due='In 5 days'; });
    }
  }
  return moved;
}
function resolveOnbTask(id){
  const t = onbTaskById(id); if(!t) return;
  t.status='done'; t.due='—';
  const opened = onbSyncGates();
  refreshPartner();
  if(opened){
    toast('Gate cleared — '+opened.name.toLowerCase()+' is now open','ok');
  } else if(onbCurrentGate(MY_ONB_NEW.state)===null && !MY_ONB_NEW.live){
    toast('Every gate cleared — you can go live','ok');
  } else {
    toast(t.title+' resolved');
  }
  App.go('onboarding');
}
function onbGoLive(){
  confirmAction({
    title:'Go live in the '+MY_ONB_NEW.target, subtitle:MY_ONB_NEW.ref+' · every gate cleared',
    risk:'normal', confirmLabel:'Publish and go live',
    impact:['Your storefront opens in the '+esc(MY_ONB_NEW.target)+' and buyers can find your listings there.',
            'You can create listings in that marketplace immediately — the option appears in the new-listing wizard.',
            'Commission follows your existing settlement plan; no new plan is assigned.',
            'The marketplace publishes your seller profile and rating in the new marketplace.'],
    footNote:'Going live is reversible — you can pause a marketplace from your seller profile.',
    onConfirm:()=>{
      onbClearGate(MY_ONB_NEW.state);            /* closes go-live itself */
      MY_ONB_NEW.state.golive='done';
      MY_ONB_NEW.live=true;
      if(ME_P.verticals.indexOf(MY_ONB_NEW.targetV)===-1) ME_P.verticals.push(MY_ONB_NEW.targetV);
      recomputeDerived(); refreshPartner();
      toast('You are live in the '+MY_ONB_NEW.target+' — you can list there now');
      App.go('onboarding');
    }
  });
}
/* --------------------- applying to add another marketplace ---------------- */
/* An existing live partner does not repeat KYC or bank verification — those
   carry over. What they do need is an addendum, a technical check in the new
   marketplace and a fresh compliance review. */
function addMarketplaceDialog(){
  const cur = onbCurrentGate(MY_ONB_NEW.state);
  if(cur && !MY_ONB_NEW.live){
    openModal('<div class="modal-head">'+ICO('info',18)+'<div class="grow"><h3 class="t-sub">One application at a time</h3>'+
      '<div class="t-small muted">Your '+esc(MY_ONB_NEW.target)+' application is still open.</div></div>'+
      '<button class="iconbtn" onclick="closeModal()" aria-label="Close">'+ICO('x',16)+'</button></div>'+
      '<div class="modal-body stack">'+
        '<p class="t-body" style="margin:0">Application <strong>'+esc(MY_ONB_NEW.ref)+'</strong> for the '+
        esc(MY_ONB_NEW.target)+' is at the <strong>'+esc(cur.name.toLowerCase())+'</strong> gate. '+
        'The marketplace only runs one application per partner at a time, so that compliance reviews cannot overlap.</p>'+
        '<div class="impact"><strong>To move it on</strong><ul>'+
          MY_ONB_TASKS.filter(t=>t.step===cur.id&&t.status!=='done').map(t=>'<li>'+esc(t.title)+'</li>').join('')+
        '</ul></div>'+
      '</div>'+
      '<div class="modal-foot"><span class="t-tiny muted grow">You can withdraw the open application from your seller profile.</span>'+
      '<button class="btn btn-primary" onclick="closeModal()" data-autofocus>Back to onboarding</button></div>',
      {label:'One application at a time'});
    return;
  }
  const avail = VERTICALS.filter(v=>ME_P.verticals.indexOf(v.id)===-1);
  if(!avail.length){
    openModal('<div class="modal-head">'+ICO('checkcircle',18)+'<div class="grow"><h3 class="t-sub">You are in every marketplace</h3></div>'+
      '<button class="iconbtn" onclick="closeModal()" aria-label="Close">'+ICO('x',16)+'</button></div>'+
      '<div class="modal-body"><p class="t-body" style="margin:0">'+esc(ME_P.name)+' is onboarded into all '+
      VERTICALS.length+' marketplaces, so there is nothing left to apply for.</p></div>'+
      '<div class="modal-foot"><button class="btn btn-primary" onclick="closeModal()" data-autofocus>Close</button></div>',
      {label:'Already in every marketplace'});
    return;
  }
  openModal('<div class="modal-head">'+ICO('plus',18)+'<div class="grow"><h3 class="t-sub">Apply to add a marketplace</h3>'+
    '<div class="t-small muted">Your KYC and settlement account carry over. You will need an addendum, a technical check and a compliance review.</div></div>'+
    '<button class="iconbtn" onclick="closeModal()" aria-label="Close">'+ICO('x',16)+'</button></div>'+
    '<div class="modal-body stack">'+
      '<div class="field"><label>Which marketplace</label><div class="stack" style="gap:8px;margin-top:4px">'+
      avail.map((v,i)=>'<label class="checkline" style="border:1px solid var(--nim-line-200);border-radius:6px;padding:9px 11px">'+
        '<input type="radio" name="amV" value="'+v.id+'" '+(i===0?'checked':'')+'>'+
        '<span><span class="t-small strong">'+esc(v.name)+'</span> <span class="cat cat-'+v.id+'">'+esc(v.aud)+'</span>'+
        '<br><span class="t-tiny muted">'+esc(v.blurb)+'</span></span></label>').join('')+'</div></div>'+
      '<div class="field"><label for="amWhy">What you plan to list there</label>'+
      '<textarea class="inp" id="amWhy" placeholder="The onboarding desk uses this to decide which policy checks apply"></textarea></div>'+
      '<div class="impact"><strong>What carries over, and what does not</strong><ul>'+
        '<li><strong>Carries over:</strong> KYC and due diligence, your verified settlement account, your tax status.</li>'+
        '<li><strong>Needed again:</strong> a marketplace addendum to your agreement, a technical check with a sandbox order in the new marketplace, and a fresh compliance review.</li>'+
        '<li>Target is 5 working days. Nothing is charged during the application.</li></ul></div>'+
    '</div>'+
    '<div class="modal-foot"><span class="t-tiny muted grow">Only one application runs at a time.</span>'+
    '<button class="btn btn-quiet" onclick="closeModal()">Cancel</button>'+
    '<button class="btn btn-primary" onclick="startMarketplaceApplication()" data-autofocus>Submit application</button></div>',
    {wide:true,label:'Apply to add a marketplace'});
}
function startMarketplaceApplication(){
  const sel=document.querySelector('input[name="amV"]:checked');
  const vid=sel?sel.value:null;
  const v=VMAP[vid]; if(!v){ closeModal(); return; }
  closeModal();
  SEQ.obt+=1;
  MY_ONB_NEW.target=v.name; MY_ONB_NEW.targetV=v.id;
  MY_ONB_NEW.ref='ONB-'+(8842+SEQ.obt-9500);
  MY_ONB_NEW.started=TODAY; MY_ONB_NEW.elapsed='0 working days'; MY_ONB_NEW.live=false;
  MY_ONB_NEW.state={apply:'done', kyc:'done', agree:'now', finance:'done',
                    tech:'todo', assure:'todo', golive:'todo'};
  MY_ONB_TASKS.length=0;
  MY_ONB_TASKS.push(
    {id:'OB-9201', step:'agree', title:esc(v.name)+' addendum to sign',
     detail:'An addendum extending your listing rights to the '+v.name+'. Sent to '+ME_P.contact+' for e-signature.',
     owner:'You', due:'In 3 days', status:'pending'},
    {id:'OB-9202', step:'tech', title:'Sandbox order in the new marketplace',
     detail:'Place one end-to-end order in the '+v.name+' sandbox so fulfilment and settlement can be verified.',
     owner:'You', due:'Opens when the addendum is signed', status:'notstarted'},
    {id:'OB-9203', step:'assure', title:'Compliance review for '+esc(v.name),
     detail:'Policy and content checks specific to this marketplace. Your security questionnaire carries over.',
     owner:'You', due:'Opens after the technical gate', status:'notstarted'},
    {id:'OB-9204', step:'kyc', title:'KYC carried over',
     detail:'Verified during your original onboarding in Sep 2024. No further checks needed.',
     owner:'Marketplace', due:'—', status:'done'},
    {id:'OB-9205', step:'finance', title:'Settlement account reused',
     detail:'Existing verified account carried over. No new verification needed.',
     owner:'Marketplace', due:'—', status:'done'}
  );
  refreshPartner();
  toast('Application '+MY_ONB_NEW.ref+' submitted for the '+v.name+' — addendum sent to '+ME_P.contact);
  App.go('onboarding');
}

function onbTask(id){
  const t=onbTaskById(id); if(!t) return;
  const gate=(ONB_STEPS.find(s=>s.id===t.step)||{}).name||t.step;
  openModal('<div class="modal-head">'+ICO(t.status==='blocked'?'alert':'clock',18)+
    '<div class="grow"><h3 class="t-sub">'+esc(t.title)+'</h3>'+
    '<div class="t-small muted">'+esc(gate)+' · owner '+esc(t.owner)+'</div></div>'+
    '<button class="iconbtn" onclick="closeModal()" aria-label="Close">'+ICO('x',16)+'</button></div>'+
    '<div class="modal-body stack">'+
      '<p class="t-body" style="margin:0">'+esc(t.detail)+'</p>'+
      (t.id==='OB-9102'
        ? '<div class="tablewrap"><table class="tbl"><thead><tr><th>Attempt</th><th>Endpoint</th><th>Response</th></tr></thead><tbody>'+
          [['1','/fulfil/callback','200 OK'],['2','/fulfil/callback','200 OK'],['3','/fulfil/callback','500 Internal Server Error'],
           ['4','/fulfil/callback','500 Internal Server Error'],['5','/fulfil/callback','500 Internal Server Error']].map(r=>
          '<tr><td class="t-num">'+r[0]+'</td><td class="t-num t-small">'+r[1]+'</td>'+
          '<td>'+(r[2]==='200 OK'?pill('approved',r[2]):pill('rejected',r[2]))+'</td></tr>').join('')+
          '</tbody></table></div>'+
          '<div class="field"><label for="obUrl">Fulfilment webhook URL</label>'+
          '<input class="inp" id="obUrl" value="https://api.nimbus-sensors.example/fulfil/callback"></div>'
        : t.id==='OB-9103'
        ? '<div class="stack" style="gap:9px">'+
          [['Where is customer data stored?','EU (Frankfurt)'],
           ['Do you use sub-processors?','Yes — 2 declared'],
           ['Retention period for order data','24 months'],
           ['Do you hold ISO 27001 or SOC 2?','ISO 27001, valid to 2028']].map(q=>
          '<div class="row"><span class="t-small grow">'+esc(q[0])+'</span><span class="t-small strong">'+esc(q[1])+'</span></div>').join('')+
          '<div class="t-tiny muted">38 further questions answered from your existing IoT onboarding and carried over automatically.</div>'+
          '</div>'
        : '<div class="field"><label for="obNote">Notes for the onboarding desk</label><textarea class="inp" id="obNote"></textarea></div>')+
      '<div class="impact"><strong>What happens when this closes</strong><ul>'+
        (t.step==='tech'
          ? '<li>The technical gate closes once every task on it is done.</li>'+
            '<li>Compliance review then opens and the security questionnaire becomes available to you.</li>'
          : t.step==='assure'
          ? '<li>Compliance review closes and go-live becomes available.</li>'+
            '<li>Your listings in the new marketplace can then be published.</li>'
          : '<li>The gate closes and the next one opens.</li>')+
        '<li>Nothing is charged during onboarding.</li></ul></div>'+
    '</div>'+
    '<div class="modal-foot"><span class="t-tiny muted grow">'+
      (t.status==='done'?'Already complete.':'Resolving this updates the gate immediately.')+'</span>'+
    '<button class="btn btn-quiet" onclick="closeModal()">Cancel</button>'+
    (t.id==='OB-9102'
      ? '<button class="btn" onclick="toast(\'Test callback sent — 200 OK\')">Send test callback</button>'+
        '<button class="btn btn-primary" onclick="closeModal();resolveOnbTask(\''+t.id+'\')" data-autofocus>Save and retry</button>'
      : '<button class="btn btn-primary" '+(t.status==='done'?'disabled':'')+
        ' onclick="closeModal();resolveOnbTask(\''+t.id+'\')" data-autofocus>'+
        (t.id==='OB-9103'?'Submit questionnaire':'Mark as done')+'</button>')+
    '</div>',{wide:true,label:t.title});
}

/* ------------------------------ 3. My listings ---------------------------- */
function vPListings(){
  return pagehead('My listings',
    MY_LIST.length+' products across '+new Set(MY_LIST.map(l=>l.v)).size+' marketplaces · '+
    MY_LIST.filter(l=>l.status==='live').length+' live, '+MY_LIST.filter(l=>l.status==='pending').length+' in review',
    '<button class="btn" onclick="toast(\'Bulk upload — CSV or catalogue feed\')">'+ICO('download',13)+'Bulk upload</button>'+
    '<button class="btn btn-primary" onclick="App.go(\'newlisting\')">'+ICO('plus',14)+'New listing</button>')+
  '<div class="stack">'+
  banner('info','Listings go live once the marketplace clears them. Standard review is one working day; anything with a policy or certification question takes longer and you will see why here.')+
  panel(null, dt('dtPList',{
    rows:MY_LIST, noun:'listings', pageSize:10, sortKey:'name', idKey:'id',
    onRow:"openProduct('$ID',{showComm:true,mode:'seller'})",
    searchFields:['id','name','cat','v'], searchPlaceholder:'Search listing or SKU',
    chips:[{key:'status',options:[{label:'Live',value:'live'},{label:'In review',value:'pending'},{label:'Draft',value:'draft'}]},
           {key:'v',options:ME_P.verticals.map(v=>({label:vName(v).replace(' Marketplace',''),value:v}))}],
    actions:exportBtn('Listings'),
    columns:[
      {key:'name',label:'Listing',render:r=>'<div class="row" style="gap:9px">'+
        '<span class="cartthumb" style="width:34px;height:34px">'+ICO(VICON[r.v],15)+'</span>'+
        '<div><div class="cellmain">'+esc(r.name)+'</div><div class="cellsub t-num">'+esc(r.id)+' · '+esc(r.cat)+'</div></div></div>'},
      {key:'v',label:'Marketplace',render:r=>vBadge(r.v)},
      {key:'price',label:'Price',align:'right',render:r=>'<span class="t-num cellmain">'+CUR(r.price)+'</span>'+
        (r.model==='monthly'?'<div class="cellsub">per month</div>':'')},
      {key:'comm',label:'Commission',align:'right',render:r=>'<span class="t-num">'+r.comm+'%</span>'+
        '<div class="cellsub">'+CUR(r.price*r.comm/100)+'</div>'},
      {key:'rating',label:'Rating',render:r=>r.rating!=null?ratingEl(r):'<span class="nodata">No reviews</span>'},
      {key:'stock',label:'Availability',render:r=>stockEl(r)},
      {key:'status',label:'State',render:r=>statusPill(r.status)},
      {key:'__acts',label:'',sort:false,render:r=>r.status==='pending'
        ? '<button class="btn btn-sm btn-quiet" onclick="event.stopPropagation();toast(\'Review status: with the catalogue team, submitted '+esc(r.listed)+'\')">Status</button>'
        : '<button class="btn btn-sm btn-quiet" onclick="event.stopPropagation();App.go(\'newlisting\')">Edit</button>'}
    ]}),{flush:true})+
  '</div>';
}

/* -------------------------- 4. Product onboarding ------------------------- */
const NL = {step:0, v:'iot', cat:'Sensors', name:'', price:'', model:'oneoff', fulfil:'shipped',
            desc:'', markets:['India','UAE'], decl:[false,false,false,false],
            media:[], tags:'', endpoint:'EP-01', sla:'Next working day', returns:'14 days (marketplace standard)',
            cost:'', list:'', allowOpDiscount:true, opFloorPct:0};
let NL_MEDIA_SEQ = 0;
function nlCats(v){ return Array.from(new Set(PRODUCTS.filter(p=>p.v===v).map(p=>p.cat))); }
function nlSetVertical(v){ NL.v=v; const c=nlCats(v); if(c.indexOf(NL.cat)===-1) NL.cat=c[0]||''; App.go('newlisting'); }
function nlToggleMarket(m){ const i=NL.markets.indexOf(m); if(i>-1) NL.markets.splice(i,1); else NL.markets.push(m); }
function nlPrice(){ return parseFloat(NL.price)||0; }
function nlCost(){ return parseFloat(NL.cost)||0; }
function nlList(){ return parseFloat(NL.list)||0; }
function nlSetOpFloor(v){ NL.opFloorPct=parseInt(v,10)||0; nlRefreshSplit(); }
/* Cost, commission, fees and what is actually left — the number that decides
   whether a listing is worth having, and the only honest basis for a discount. */
function nlSplitHtml(){
  const price=nlPrice(), cost=nlCost(), list=nlList();
  if(price<=0)
    return banner('info','Enter a sale price and this shows what the marketplace takes, what it costs you, and what '+
      'is actually left.');
  const comm=+(price*MY_PLAN.base/100).toFixed(2);
  const fee=+(price*0.019+0.20).toFixed(2);
  const net=+(price-comm-fee).toFixed(2);
  const margin=+(net-cost).toFixed(2);
  const marginPct = price? +(margin/price*100).toFixed(1) : 0;
  const headroom = Math.max(0, +(price-cost).toFixed(2));
  const allowed = +(headroom*(NL.opFloorPct/100)).toFixed(2);
  const bad = cost>0 && cost>=price;
  const thin = !bad && margin<=0;

  return '<h4 class="t-sub" style="margin-bottom:9px">What you receive on each sale</h4>'+
    splitBar(price,MY_PLAN)+
    '<div class="totals" style="margin-top:12px">'+
      (list>price?'<span class="lbl">List price</span><span class="val">'+CUR(list)+
        ' <span class="t-tiny muted">'+(+((list-price)/list*100).toFixed(0))+'% off</span></span>':'')+
      '<span class="lbl">Sale price</span><span class="val">'+CUR(price)+'</span>'+
      '<span class="lbl">Marketplace commission at '+MY_PLAN.base+'%</span><span class="val">less '+CUR(comm)+'</span>'+
      '<span class="lbl">Payment and per-order fees</span><span class="val">less '+CUR(fee)+'</span>'+
      '<span class="lbl">Settles to you</span><span class="val">'+CUR(net)+'</span>'+
      (cost>0?'<span class="lbl">Your cost</span><span class="val">less '+CUR(cost)+'</span>':'')+
      '<span class="grand-lbl">'+(cost>0?'Your margin':'Settles to you')+'</span>'+
      '<span class="val grand">'+CUR(cost>0?margin:net)+
        (cost>0?' <span class="t-tiny muted">'+marginPct+'%</span>':'')+'</span>'+
    '</div>'+
    (bad
      ? banner('danger','<strong>Cost is at or above the sale price.</strong> Every order would lose money before the '+
        'marketplace has taken anything. This listing cannot be submitted.')
      : thin
      ? banner('warning','<strong>Commission and fees take more than your margin.</strong> At '+CUR(price)+' you settle '+
        CUR(net)+' against a cost of '+CUR(cost)+'. Raise the price or reconsider the listing.')
      : cost>0
      ? banner('info','<strong>Discount headroom is '+CUR(headroom)+'.</strong> '+
        (NL.opFloorPct
          ? 'You are allowing the marketplace up to <strong>'+CUR(allowed)+'</strong> of it ('+NL.opFloorPct+'%), '+
            'so the lowest a promotion could take this is '+CUR(+(price-allowed).toFixed(2))+'. '+
            'The marketplace funds anything beyond what you allow.'
          : 'You are allowing the marketplace none of it, so no promotion will change this price.'))
      : banner('info','Enter a cost price and this will show your margin and how far the marketplace may discount.'));
}
/* Updates only the split, so typing a price never steals focus from the field. */
function nlRefreshSplit(){ const h=document.getElementById('nlSplitHost'); if(h) h.innerHTML=nlSplitHtml(); }
function nlReset(){ NL.step=0; NL.name=''; NL.price=''; NL.cost=''; NL.list=''; NL.desc=''; NL.tags='';
  NL.decl=[false,false,false,false]; NL.media=[]; NL.opFloorPct=0; }
function vPNewListing(){
  const steps=['Marketplace and type','Details and media','Pricing and commission','Fulfilment','Compliance','Review and submit'];
  const s=NL.step;
  const price=parseFloat(NL.price)||0;
  const commRate=MY_PLAN.base;

  const body = [
    /* 0 — marketplace and type */
    /* Headroom against the per-category cap, shown at the point the seller
       picks the category rather than at submit, when it is too late to matter. */
    capPanel(ME_P.id, NL.v)+
    '<div class="grid g2">'+
      '<div class="field"><label for="nlV">Which marketplace</label><select class="inp" id="nlV" onchange="nlSetVertical(this.value)">'+
        ME_P.verticals.map(v=>'<option value="'+v+'"'+(NL.v===v?' selected':'')+'>'+esc(vName(v))+'</option>').join('')+
        (ME_P.verticals.indexOf(MY_ONB_NEW.targetV)===-1
          ? '<option disabled>'+esc(MY_ONB_NEW.target)+' — pending onboarding</option>' : '')+
        '</select>'+
        '<div class="hint">You can only list in marketplaces you have been onboarded into.</div></div>'+
      '<div class="field"><label for="nlCat">Category</label><select class="inp" id="nlCat" onchange="NL.cat=this.value">'+
        nlCats(NL.v).map(c=>'<option'+(NL.cat===c?' selected':'')+'>'+esc(c)+'</option>').join('')+'</select></div>'+
    '</div>'+
    '<div class="divider"></div>'+
    '<div class="field"><label>Listing type</label><div class="row wrap" style="gap:10px;margin-top:4px">'+
      [['Single product','One SKU, one price'],['Bundle','Several items sold as one'],['Subscription','Recurring, cancellable']].map((t,i)=>
      '<label class="checkline" style="border:1px solid var(--nim-line-200);border-radius:6px;padding:9px 11px;flex:1 1 0">'+
      '<input type="radio" name="nlType" '+(i===0?'checked':'')+'>'+
      '<span><span class="t-small strong">'+esc(t[0])+'</span><br><span class="t-tiny muted">'+esc(t[1])+'</span></span></label>').join('')+
    '</div></div>',

    /* 1 — details */
    '<div class="field"><label for="nlName">Listing name</label>'+
      '<input class="inp" id="nlName" value="'+esc(NL.name)+'" placeholder="e.g. Nimbus Air Quality sensor" oninput="NL.name=this.value">'+
      '<div class="hint">Buyers search this text. Avoid marketing language and model codes only you use.</div></div>'+
    '<div class="field"><label for="nlDesc">Description</label>'+
      '<textarea class="inp" id="nlDesc" placeholder="What it does, what is in the box, what it needs to work" oninput="NL.desc=this.value">'+esc(NL.desc)+'</textarea>'+
      '<div class="hint">Two to four sentences. Claims about performance need evidence at the compliance gate.</div></div>'+
    '<div class="field"><label for="nlTags">Search tags</label>'+
      '<input class="inp" id="nlTags" value="'+esc(NL.tags)+'" placeholder="IP67, 5-year battery, LoRaWAN" '+
      'oninput="NL.tags=this.value">'+
      '<div class="hint">Up to eight, comma separated.</div></div>'+
    '<div class="divider"></div>'+
    '<div class="row" style="margin-bottom:8px"><h4 class="t-sub grow">Media</h4>'+
      '<span class="t-tiny muted">'+MEDIA_RULES.minImages+' to '+MEDIA_RULES.maxImages+' images · '+
      MEDIA_RULES.minPx+'px minimum · up to '+MEDIA_RULES.maxMb+' MB each</span></div>'+
    '<div id="nlMediaHost">'+nlMediaHtml()+'</div>',

    /* 2 — pricing */
    '<div class="grid g3">'+
      '<div class="field"><label for="nlCost">Cost price ('+MP.currency+')</label>'+
        '<input class="inp" id="nlCost" value="'+esc(NL.cost)+'" placeholder="0.00" inputmode="decimal" '+
        'oninput="NL.cost=this.value;nlRefreshSplit()">'+
        '<div class="hint">What it costs you. Nothing on the marketplace may be discounted below this — not a '+
        'promotion, not the operator, not a sales negotiation.</div>'+
        '<div class="err" id="nlCostErr" hidden>'+ICO('alert',12)+'Cost must be below the sale price.</div></div>'+
      '<div class="field"><label for="nlList">List price</label>'+
        '<input class="inp" id="nlList" value="'+esc(NL.list)+'" placeholder="0.00" inputmode="decimal" '+
        'oninput="NL.list=this.value;nlRefreshSplit()">'+
        '<div class="hint">The undiscounted price. Shown struck through when the sale price is lower.</div></div>'+
      '<div class="field"><label for="nlPrice">Sale price ('+MP.currency+')</label>'+
        '<input class="inp" id="nlPrice" value="'+esc(NL.price)+'" placeholder="0.00" inputmode="decimal" '+
        'oninput="NL.price=this.value;nlRefreshSplit()">'+
        '<div class="hint">What a buyer pays today.</div></div>'+
    '</div>'+
    '<div class="grid g3">'+
      '<div class="field"><label for="nlModel">Billing</label><select class="inp" id="nlModel" onchange="NL.model=this.value;App.go(\'newlisting\')">'+
        '<option value="oneoff"'+(NL.model==='oneoff'?' selected':'')+'>One-off purchase</option>'+
        '<option value="monthly"'+(NL.model==='monthly'?' selected':'')+'>Monthly subscription</option>'+
        '<option value="annual"'+(NL.model==='annual'?' selected':'')+'>Annual subscription</option></select></div>'+
      '<div class="field"><label for="nlMin">Minimum order quantity</label>'+
        '<div class="stepper"><button type="button" onclick="var i=this.nextElementSibling;i.value=Math.max(1,+i.value-1)">'+SH('minus',11)+'</button>'+
        '<input value="1" aria-label="Minimum order quantity"><button type="button" onclick="var i=this.previousElementSibling;i.value=+i.value+1">+</button></div></div>'+
      '<div class="field"><label for="nlOpFloor">Discount the operator may apply</label>'+
        '<select class="inp" id="nlOpFloor" onchange="nlSetOpFloor(this.value)">'+
        [['0','None — my price is my price'],['25','Up to a quarter of my margin'],
         ['50','Up to half my margin'],['100','Down to my cost price']]
        .map(o=>'<option value="'+o[0]+'"'+(String(NL.opFloorPct)===o[0]?' selected':'')+'>'+o[1]+'</option>').join('')+
        '</select>'+
        '<div class="hint">How far the marketplace may cut your price in a promotion or a bundle. It pays you the '+
        'difference — but only up to what you allow here.</div></div>'+
    '</div>'+
    '<div class="divider"></div>'+
    '<div id="nlSplitHost">'+nlSplitHtml()+'</div>'+
    '<div class="divider"></div>'+
    '<div class="row"><span class="t-small muted grow">Your plan is '+esc(MY_PLAN.name)+' at '+commRate+'%. '+
      'Commission is set by your plan, not per listing.</span>'+
      '<button class="btn btn-sm btn-quiet" onclick="App.go(\'plan\')">See the plan</button></div>',

    /* 3 — fulfilment */
    '<div class="field"><label for="nlFul">How is it delivered</label><select class="inp" id="nlFul" onchange="NL.fulfil=this.value;App.go(\'newlisting\')">'+
      '<option value="shipped"'+(NL.fulfil==='shipped'?' selected':'')+'>Shipped by you</option>'+
      '<option value="instant"'+(NL.fulfil==='instant'?' selected':'')+'>Instant digital delivery</option>'+
      '<option value="provisioned"'+(NL.fulfil==='provisioned'?' selected':'')+'>Provisioned by you after order</option></select></div>'+
    '<div class="divider"></div>'+
    '<h4 class="t-sub" style="margin-bottom:9px">Buyers will see this pipeline</h4>'+
    '<div class="pipe">'+PIPELINES[NL.fulfil].map((st,i)=>
      '<div class="step '+(i===0?'done':i===1?'now':'todo')+'"><div class="dot" aria-hidden="true">'+(i===0?SH('check',11):(i+1))+'</div>'+
      '<div class="lbl">'+esc(st)+'</div></div>').join('')+'</div>'+
    '<div class="divider"></div>'+
    '<div class="grid g2">'+
      '<div class="field"><label for="nlSla">Dispatch or provisioning target</label><select class="inp" id="nlSla">'+
        '<option>Same working day</option><option selected>Next working day</option><option>Within 3 working days</option></select>'+
        '<div class="hint">Missing this target repeatedly affects your seller rating and can suspend the listing.</div></div>'+
      '<div class="field"><label for="nlRet">Returns window</label><select class="inp" id="nlRet">'+
        '<option selected>14 days (marketplace standard)</option><option>30 days</option>'+
        '<option>Not applicable — digital entitlement</option></select></div>'+
    '</div>'+
    '<div class="divider"></div>'+
    '<h4 class="t-sub" style="margin-bottom:4px">Fulfilment API</h4>'+
    '<div class="t-small muted" style="margin-bottom:9px">Which of your endpoints the marketplace calls when an order '+
      'is placed against this listing. Without one, orders arrive in the portal and you fulfil them by hand.</div>'+
    '<div class="field"><label for="nlEp">Endpoint</label>'+
      '<select class="inp" id="nlEp" onchange="nlSetEndpoint(this.value)">'+
      '<option value="">Manual — no API call, I will work from the portal</option>'+
      MY_ENDPOINTS.map(e=>'<option value="'+e.id+'"'+(NL.endpoint===e.id?' selected':'')+'>'+
        esc(e.name)+' · '+esc(e.env)+' · '+esc(e.url.replace(/^https:\/\//,''))+'</option>').join('')+
      '</select></div>'+
    (function(){
      const ep=MY_ENDPOINTS.find(e=>e.id===NL.endpoint);
      if(!ep){
        return banner('info','<strong>Manual fulfilment.</strong> Every order will wait for someone to open the portal. '+
          'That is fine at low volume and expensive at any other.');
      }
      const bits='<dl class="deflist">'+
        '<dt>Endpoint</dt><dd><span class="epurl">'+esc(ep.method)+' '+esc(ep.url)+'</span></dd>'+
        '<dt>Authentication</dt><dd>'+esc(ep.auth)+'</dd>'+
        '<dt>Retries</dt><dd>'+esc(ep.retry)+' · '+ep.timeoutMs+' ms timeout</dd>'+
        '<dt>Events sent</dt><dd>'+ep.events.map(ev=>esc((API_EVENTS.find(x=>x.id===ev)||{}).label||ev)).join(', ')+'</dd>'+
        '<dt>Health</dt><dd>'+epHealthPill(ep)+
          (ep.successRate!=null?' <span class="t-tiny muted">'+ep.successRate+'% of recent calls succeeded</span>':'')+'</dd>'+
      '</dl>';
      const warn = !ep.enabled
        ? banner('warning','<strong>'+esc(ep.name)+' is registered but not enabled.</strong> Orders on this listing would '+
            'not reach it. <button class="linkbtn" onclick="App.go(\'integrations\')">Enable it</button>')
        : ep.health==='failing'
        ? banner('danger','<strong>'+esc(ep.name)+' is failing.</strong> '+esc(ep.note||'')+' Publishing a listing against a '+
            'broken endpoint means orders you cannot fulfil, which costs you the rating and the money. '+
            '<button class="linkbtn" onclick="App.go(\'integrations\')">Fix the endpoint</button>')
        : '';
      return bits+warn;
    })()+
    '<div class="row" style="margin-top:10px"><span class="t-tiny muted grow">Endpoints are registered once and reused '+
      'across listings.</span>'+
      '<button class="btn btn-sm" onclick="App.go(\'integrations\')">'+ICO('plug',13)+'Manage endpoints</button></div>',

    /* 4 — compliance */
    '<div class="field"><label for="nlMkt">Markets</label>'+
      '<div class="row wrap" style="gap:8px;margin-top:4px">'+
      ['India','UAE','Kenya','Singapore','Germany'].map(m=>
      '<label class="checkline" style="border:1px solid var(--nim-line-200);border-radius:20px;padding:5px 11px">'+
      '<input type="checkbox" '+(NL.markets.includes(m)?'checked':'')+' onchange="nlToggleMarket(\''+m+'\')">'+
      esc(m)+'</label>').join('')+'</div>'+
      '<div class="hint">Each market has its own certification and consumer-law requirements.</div></div>'+
    '<div class="divider"></div>'+
    '<h4 class="t-sub" style="margin-bottom:9px">Declarations</h4>'+
    '<div class="stack" style="gap:9px">'+
      [['Radio type approval held for every selected market','Required for anything that transmits'],
       ['Product complies with local safety and labelling rules','Evidence may be requested at review'],
       ['No randomised paid rewards or loot mechanics','Marketplace policy 7.4'],
       ['Personal data handling disclosed in the listing','Where the product collects any']].map((d,i)=>
      '<label class="checkline"><input type="checkbox" '+(NL.decl[i]?'checked':'')+
      ' onchange="NL.decl['+i+']=this.checked"><span><span class="t-small">'+esc(d[0])+'</span><br>'+
      '<span class="t-tiny muted">'+esc(d[1])+'</span></span></label>').join('')+
    '</div>'+
    '<div class="divider"></div>'+
    banner('info','Declarations are checked at review. A listing that clears review but is later found non-compliant is delisted and the sales are reversed.'),

    /* 5 — review */
    '<div class="grid g2">'+
      '<div><h4 class="t-sub" style="margin-bottom:9px">Preview</h4>'+
        '<div class="pgrid cols2" style="grid-template-columns:minmax(0,1fr)">'+
        productCard({id:'SKU-NEW', v:NL.v, cat:NL.cat, name:NL.name||'Untitled listing', seller:ME_P.name, partner:ME_P.id,
          price:price, model:NL.model, fulfil:NL.fulfil, rating:null, reviews:0, stock:'in', status:'draft',
          desc:NL.desc||'No description yet.', tags:[]}, {cta:'<span class="t-tiny muted" style="margin-left:auto">Preview</span>'})+
        '</div></div>'+
      '<div><h4 class="t-sub" style="margin-bottom:9px">Summary</h4>'+
        '<dl class="deflist">'+
          '<dt>Marketplace</dt><dd>'+esc(vName(NL.v))+'</dd>'+
          '<dt>Category</dt><dd>'+esc(NL.cat)+'</dd>'+
          '<dt>Price</dt><dd>'+(price?CUR(price)+(NL.model==='monthly'?' per month':''):'<span class="nodata">Not set</span>')+'</dd>'+
          '<dt>Commission</dt><dd>'+commRate+'% · '+(price?CUR(price*commRate/100):'—')+'</dd>'+
          '<dt>You receive</dt><dd>'+(price?CUR(price-price*commRate/100-price*0.019):'—')+'</dd>'+
          '<dt>Fulfilment</dt><dd>'+esc(fulfilLabel(NL.fulfil))+'</dd>'+
          '<dt>Markets</dt><dd>'+esc(NL.markets.join(', '))+'</dd>'+
        '</dl>'+
        '<div class="divider"></div>'+
        '<div class="impact"><strong>After you submit</strong><ul>'+
          '<li>The catalogue team reviews within one working day.</li>'+
          '<li>You are told why if it is rejected, and can resubmit.</li>'+
          '<li>Nothing is charged for listing — you pay commission only on sales.</li></ul></div>'+
      '</div>'+
    '</div>'
  ][s];

  return pagehead('New listing',
    'Product onboarding — six steps from category to submission. Nothing is published until the marketplace clears it.',
    '<button class="btn btn-quiet" onclick="App.go(\'listings\')">Cancel</button>'+
    '<button class="btn" onclick="toast(\'Draft saved — resume from My listings\')">Save draft</button>')+
  '<div class="stack">'+
  '<div class="wizrail">'+steps.map((st,i)=>
    '<div class="st '+(i<s?'done':i===s?'now':'')+'"><span class="n">'+(i<s?SH('check',10):(i+1))+'</span>'+esc(st)+'</div>').join('')+'</div>'+
  panel(steps[s], body, {icon:'package', sub:'Step '+(s+1)+' of '+steps.length})+
  '<div class="row">'+
    '<button class="btn" '+(s===0?'disabled':'')+' onclick="NL.step--;App.go(\'newlisting\')">'+ICO('chevleft',13)+'Back</button>'+
    '<div class="spacer"></div>'+
    '<span class="t-tiny muted">'+(s===steps.length-1?'Submitting sends this to the catalogue team':'Your progress is saved as you go')+'</span>'+
    (s===steps.length-1
      ? '<button class="btn btn-primary" onclick="submitListing()">Submit for review</button>'
      : '<button class="btn btn-primary" onclick="NL.step++;App.go(\'newlisting\')">Continue'+ICO('chevright',13)+'</button>')+
  '</div>'+
  '</div>';
}
function submitListing(){
  if(!NL.name.trim() || nlPrice()<=0){
    toast('A listing needs a name and a price before it can be submitted','warn');
    NL.step = !NL.name.trim() ? 1 : 2; App.go('newlisting'); return;
  }
  if(nlCost()>0 && nlCost()>=nlPrice()){
    toast('Cost price is at or above the sale price — every order would lose money','warn');
    NL.step=2; App.go('newlisting'); return;
  }
  /* The per-category cap. Checked before the media gate so a seller who has no
     slot left is not asked to finish the media first. */
  const cb=capBreach(ME_P.id, NL.v, 1);
  if(cb){
    toast(capMessage(cb),'warn');
    NL.step=1; App.go('newlisting'); return;
  }
  const ms=mediaSummary(NL.media);
  if(!ms.ok){
    toast(ms.short
      ? ms.short+' more image'+(ms.short===1?' is':'s are')+' needed — the minimum is '+MEDIA_RULES.minImages
      : ms.noAlt+' media item'+(ms.noAlt===1?'':'s')+' still need alt text','warn');
    NL.step=1; App.go('newlisting'); return;
  }
  confirmAction({
    title:'Submit '+NL.name+' for review', subtitle:vName(NL.v)+' · '+NL.cat+' · '+CUR(nlPrice()), risk:'normal',
    confirmLabel:'Submit for review',
    impact:[(function(){
              const ms=mediaSummary(NL.media);
              return ms.images+' image'+(ms.images===1?'':'s')+
                (ms.videos?', a video':'')+(ms.docs?', '+ms.docs+' document'+(ms.docs===1?'':'s'):'')+
                ' go with it, all described.';
            })(),
            (function(){
              const ep=MY_ENDPOINTS.find(e=>e.id===NL.endpoint);
              if(!ep) return 'Fulfilment is <strong>manual</strong> — every order waits for someone to open the portal.';
              if(!ep.enabled) return '<strong>'+esc(ep.name)+' is not enabled</strong>, so orders would fall through to the portal.';
              if(ep.health==='failing') return '<strong>'+esc(ep.name)+' is currently failing.</strong> Orders on this listing will not be acknowledged until it is fixed.';
              return 'Orders call <strong>'+esc(ep.name)+'</strong> automatically.';
            })(),
            (function(){
              const cap=listingCap(NL.v), held=listingsHeld(ME_P.id,NL.v);
              return cap==null ? 'No listing limit applies to this category.'
                : 'This will be '+(held+1)+' of '+cap+' permitted '+vName(NL.v)+' listings.';
            })(),
            'The catalogue team reviews within one working day.',
            'Your declarations are checked against the evidence on file. Anything missing comes back to you.',
            'Once live, it is visible to every buyer in '+esc(NL.markets.join(', '))+'.',
            'Listing is free — you pay '+MY_PLAN.base+'% commission only when it sells.',
            NL.decl.every(Boolean) ? 'All four declarations are signed.'
              : '<strong>'+NL.decl.filter(x=>!x).length+' declaration'+(NL.decl.filter(x=>!x).length===1?' is':'s are')+
                ' unsigned</strong> — the review will come back to you for them.'],
    footNote:'You can withdraw a listing at any time before it goes live.',
    onConfirm:()=>{
      const p = createListing({
        v:NL.v, cat:NL.cat, name:NL.name, partner:ME_P.id, seller:ME_P.name,
        price:nlPrice(), model:NL.model, fulfil:NL.fulfil, desc:NL.desc,
        tags:NL.markets.slice(), comm:MY_PLAN.base,
        media:NL.media.slice(), endpoint:NL.endpoint,
        cost:nlCost(), list:nlList()||nlPrice(), opFloorPct:NL.opFloorPct
      });
      nlReset(); refreshPartner();
      toast(p.name+' submitted — '+p.id+' is now in the marketplace review queue');
      App.go('listings');
    }
  });
}

/* --------------------------- 5. Orders and fulfilment --------------------- */
function vPOrders(){
  return pagehead('Orders',
    MY_ORD.length+' orders · '+MY_OPEN.length+' to fulfil'+(MY_FAIL.length?' · '+MY_FAIL.length+' failed':''),
    '<button class="btn" onclick="toast(\'Bulk dispatch — upload tracking numbers as CSV\')">'+ICO('checklist',13)+'Bulk dispatch</button>'+
    exportBtn('Orders','dtPOrders'))+
  '<div class="stack">'+
  (MY_FAIL.length?banner('danger','<strong>'+MY_FAIL.length+' order'+(MY_FAIL.length===1?'':'s')+' failed at fulfilment.</strong> '+
    'These do not settle until they are resolved, and they count against your dispatch-on-time rate.'):'')+
  '<div class="grid g4">'+
    metric({icon:'orders',label:'To fulfil',value:String(MY_OPEN.length),foot:'Dispatch target: next working day'})+
    metric({icon:'checkcircle',label:'Completed',value:String(MY_ORD.filter(o=>o.stage===o.stages.length-1&&!o.failed).length),foot:'Last 90 days'})+
    metric({icon:'alert',label:'Failed',value:String(MY_FAIL.length),foot:MY_FAIL.length?'Action needed':'None'})+
    metric({icon:'wallet',label:'Value to settle',value:CUR0(MY_ORD.filter(o=>!o.failed).reduce((a,o)=>a+o.gross-o.comm,0)),foot:'Net of commission, before fees'})+
  '</div>'+
  panel(null, dt('dtPOrders',{
    rows:MY_ORD, noun:'orders', pageSize:12, sortKey:'id', sortDir:'desc',
    onRow:"openOrder('$ID',{showComm:true})",
    searchFields:['id','name','buyer','cat'], searchPlaceholder:'Search order, buyer or product',
    chips:[{key:'buyerType',options:[{label:'Consumer',value:'Consumer'},{label:'Enterprise',value:'Enterprise'}]},
           {key:'v',options:ME_P.verticals.map(v=>({label:vName(v).replace(' Marketplace',''),value:v}))}],
    actions:exportBtn('Orders'),
    columns:[
      {key:'id',label:'Order',render:r=>'<div class="cellmain t-num">'+esc(r.id)+'</div><div class="cellsub">'+esc(r.placed)+'</div>'},
      {key:'name',label:'Product',render:r=>'<div class="cellmain">'+esc(r.name)+'</div><div class="cellsub">'+esc(r.cat)+'</div>'},
      {key:'buyer',label:'Buyer',render:r=>esc(r.buyer)+'<div class="cellsub">'+esc(r.buyerType)+' · '+esc(r.channel)+'</div>'},
      {key:'qty',label:'Qty',align:'right',render:r=>'<span class="t-num">'+r.qty+'</span>'},
      {key:'gross',label:'Gross',align:'right',render:r=>'<span class="t-num cellmain">'+CUR(r.gross)+'</span>'},
      {key:'comm',label:'Commission',align:'right',render:r=>'<span class="t-num">less '+CUR(r.comm)+'</span>'},
      {key:'stage',label:'Status',render:r=>orderStatePill(r)},
      {key:'__acts',label:'',sort:false,render:r=>r.failed
        ? '<button class="btn btn-sm btn-primary" onclick="event.stopPropagation();toast(\'Redelivery arranged\')">Resolve</button>'
        : r.stage<r.stages.length-1
        ? '<button class="btn btn-sm btn-primary" onclick="event.stopPropagation();advanceOrder(\''+r.id+'\')">'+
          esc(r.stages[r.stage+1])+'</button>'
        : '<button class="btn btn-sm btn-quiet" onclick="event.stopPropagation();openOrder(\''+r.id+'\',{showComm:true})">View</button>'}
    ]}),{flush:true})+
  '</div>';
}
function advanceOrder(id){
  const o=ORDERS.find(x=>x.id===id); if(!o) return;
  const next=o.stages[o.stage+1];
  confirmAction({
    title:'Mark '+o.id+' as '+next.toLowerCase(), subtitle:o.name+' · '+o.buyer, risk:'normal',
    confirmLabel:'Confirm '+next.toLowerCase(),
    body: next==='In transit'
      ? '<div class="grid g2"><div class="field"><label for="adCar">Carrier</label><select class="inp" id="adCar" data-autofocus>'+
        '<option>Bluedart</option><option>Delhivery</option><option>DHL</option></select></div>'+
        '<div class="field"><label for="adTrk">Tracking number</label><input class="inp" id="adTrk" placeholder="Required"></div></div>'
      : '<div class="field"><label for="adNote">Note for the buyer (optional)</label><textarea class="inp" id="adNote" data-autofocus></textarea></div>',
    impact:['The buyer is notified immediately and sees the new stage in their order tracker.',
            'This order becomes eligible for settlement once it reaches <strong>'+esc(o.stages[o.stages.length-1])+'</strong>'+
              (MY_PLAN.hold!=='None'?' plus the '+esc(MY_PLAN.hold)+' holdback.':'.'),
            'Your dispatch-on-time rate is measured from order placement to this step.'],
    footNote:'Stages cannot be reversed — raise a dispute instead if something is wrong.',
    onConfirm:()=>{
      if(next==='In transit'||next==='Packed'){
        if(typeof dispatchStock==='function') dispatchStock(o.sku,o.qty,o.id);
      }
      o.stage++; toast(o.id+' marked as '+next.toLowerCase()); App.go('orders'); }
  });
}

/* --------------------------- 6. Settlement and payouts -------------------- */
function vPSettlement(){
  const cur=MY_STM[0];
  return pagehead('Settlement',
    'What you are owed, how it was worked out, and when it lands. Plan: '+esc(MY_PLAN.name)+' · '+esc(MY_PLAN.cycle),
    exportBtn('Settlement statements','dtPStm')+
    '<button class="btn" onclick="partnerBillsDialog(\''+ME_P.id+'\')">'+ICO('invoice',13)+'Previous bills</button>'+
    '<button class="btn" onclick="App.go(\'plan\')">'+ICO('file',13)+'Settlement plan</button>')+
  '<div class="stack">'+
  '<div class="grid g4">'+
    metric({icon:'wallet',label:'Due to you',value:CUR(MY_DUE),foot:cur?('Payout '+esc(cur.due)+' by '+esc(cur.method)):'—'})+
    metric({icon:'trendup',label:'Gross this period',value:cur?CUR0(cur.gross):null,naLabel:'No orders yet',foot:cur?cur.orders+' orders':''})+
    metric({icon:'pie',label:'Effective commission',value:cur?FMT.pct(cur.commission/cur.gross*100):null,naLabel:'Not measured',
      foot:'Plan rate '+MY_PLAN.base+'%'})+
    metric({icon:'clock',label:'Holdback',value:MY_PLAN.hold==='None'?'None':MY_PLAN.hold,foot:'Released after the returns window'})+
  '</div>'+

  (cur? panel('Current statement — '+cur.period,
    '<div class="grid g-2-1">'+
      '<div>'+
        '<div class="splitbar" role="img" aria-label="Settlement split">'+
          '<span class="s-partner" style="width:'+(cur.net/cur.gross*100)+'%">You '+CUR0(cur.net)+'</span>'+
          '<span class="s-operator" style="width:'+(cur.commission/cur.gross*100)+'%">Commission</span>'+
          '<span class="s-fee" style="width:'+Math.max(6,(cur.fees+cur.refunds+cur.wht)/cur.gross*100)+'%">Fees</span>'+
        '</div>'+
        '<div class="totals" style="margin-top:12px">'+
          '<span class="lbl">Gross order value ('+cur.orders+' orders)</span><span class="val">'+CUR(cur.gross)+'</span>'+
          '<span class="lbl">Marketplace commission — '+esc(MY_PLAN.name)+' at '+MY_PLAN.base+'%</span><span class="val">less '+CUR(cur.commission)+'</span>'+
          '<span class="lbl">Payment processing and per-order fees</span><span class="val">less '+CUR(cur.fees)+'</span>'+
          '<span class="lbl">Refunds and chargebacks</span><span class="val">'+(cur.refunds?SH('minus',11)+CUR(cur.refunds):'None')+'</span>'+
          '<span class="lbl">Withholding tax</span><span class="val">'+(cur.wht?SH('minus',11)+CUR(cur.wht):'None — treaty rate applied')+'</span>'+
          '<span class="grand-lbl">Net payout</span><span class="val grand">'+CUR(cur.net)+'</span>'+
        '</div>'+
      '</div>'+
      '<div class="stack" style="gap:11px">'+
        '<div class="row"><span class="t-small grow">Statement</span><span class="t-small strong t-num">'+esc(cur.id)+'</span></div>'+
        '<div class="row"><span class="t-small grow">State</span>'+statusPill(cur.status)+'</div>'+
        '<div class="row"><span class="t-small grow">Payout date</span><span class="t-small strong">'+esc(cur.due)+'</span></div>'+
        '<div class="row"><span class="t-small grow">Method</span><span class="t-small strong">'+esc(cur.method)+'</span></div>'+
        '<div class="row"><span class="t-small grow">Account</span><span class="t-small strong t-num">•••• 4471</span></div>'+
        '<div class="divider"></div>'+
        banner(cur.status==='pending'?'warning':'info',
          cur.status==='pending'
            ? '<strong>Awaiting marketplace approval.</strong> Statements are approved after the returns window closes, then paid on the cycle date.'
            : '<strong>Approved.</strong> Payment is released on the cycle date; funds usually clear within two working days.')+
        '<button class="btn btn-sm btn-primary" onclick="openStatement(\''+cur.id+'\')">'+ICO('invoice',13)+'View the invoice</button>'+
        '<button class="btn btn-sm" onclick="downloadBill(\''+cur.id+'\')">'+ICO('download',13)+'Download this statement</button>'+
        '<button class="btn btn-sm" onclick="disputeSettlement()">Query this statement</button>'+
      '</div>'+
    '</div>',{icon:'invoice'}) : '')+

  panel('Statement history', dt('dtPStm',{
    rows:MY_STM, noun:'statements', pageSize:10, toolbar:false, sortKey:'period', sortDir:'desc',
    idKey:'id', onRow:"openStatement('$ID')",
    columns:[
      {key:'period',label:'Period',render:r=>'<div class="cellmain">'+esc(r.period)+'</div><div class="cellsub t-num">'+esc(r.id)+'</div>'},
      {key:'orders',label:'Orders',align:'right',render:r=>'<span class="t-num">'+r.orders+'</span>'},
      {key:'gross',label:'Gross',align:'right',render:r=>'<span class="t-num">'+CUR(r.gross)+'</span>'},
      {key:'commission',label:'Commission',align:'right',render:r=>'<span class="t-num">less '+CUR(r.commission)+'</span>'},
      {key:'fees',label:'Fees',align:'right',render:r=>'<span class="t-num">less '+CUR(r.fees)+'</span>'},
      {key:'refunds',label:'Refunds',align:'right',render:r=>r.refunds?'<span class="t-num">less '+CUR(r.refunds)+'</span>':'<span class="dim">—</span>'},
      {key:'net',label:'Net payout',align:'right',render:r=>'<span class="t-num cellmain">'+CUR(r.net)+'</span>'},
      {key:'status',label:'State',render:r=>statusPill(r.status)},
      {key:'__acts',label:'',sort:false,render:r=>
        '<button class="btn btn-sm btn-quiet" onclick="event.stopPropagation();openStatement(\''+r.id+'\')">View</button>'+
        '<button class="btn btn-sm btn-quiet" onclick="event.stopPropagation();downloadBill(\''+r.id+'\')" '+
        'aria-label="Download the '+esc(r.period)+' statement">'+ICO('download',13)+'</button>'}
    ]}),{flush:true,icon:'history',
      sub:'Every statement you have ever been paid against. Open one to read the invoice, or download it as a CSV of '+
          'its order lines and the deduction stack.',
      acts:exportBtn('Statement history','dtPStm')+
        '<button class="btn btn-sm" onclick="downloadAllBills(\''+ME_P.id+'\')">'+ICO('download',13)+
        'Download all '+MY_STM.length+'</button>'})+

  panel('Reconciliation',
    '<div class="grid g2"><div class="stack" style="gap:9px">'+
      [['Orders in the period', MY_ORD.length],
       ['Orders excluded — not yet delivered', MY_OPEN.length],
       ['Orders excluded — failed fulfilment', MY_FAIL.length],
       ['Orders in this statement', cur?cur.orders:0]].map(r=>
      '<div class="row"><span class="t-small grow">'+esc(r[0])+'</span><span class="t-small strong t-num">'+r[1]+'</span></div>').join('')+
    '</div><div class="stack" style="gap:9px">'+
      '<div class="t-small">Anything not delivered by the cycle cut-off rolls into the next statement rather than being estimated. '+
      'Failed orders never settle at all.</div>'+
      '<div class="row"><span class="t-small grow">Value rolling to next period</span>'+
      '<span class="t-small strong t-num">'+CUR(MY_OPEN.reduce((a,o)=>a+o.gross,0))+'</span></div>'+
      '<div class="row"><span class="t-small grow">Value that will never settle</span>'+
      '<span class="t-small strong t-num">'+CUR(MY_FAIL.reduce((a,o)=>a+o.gross,0))+'</span></div>'+
    '</div></div>',{icon:'checklist'})+
  '</div>';
}
function disputeSettlement(){
  openModal('<div class="modal-head">'+ICO('flag',18)+'<div class="grow"><h3 class="t-sub">Query a settlement statement</h3>'+
    '<div class="t-small muted">Goes to marketplace finance. The payout is not held while a query is open unless you ask for it to be.</div></div>'+
    '<button class="iconbtn" onclick="closeModal()" aria-label="Close">'+ICO('x',16)+'</button></div>'+
    '<div class="modal-body stack">'+
      '<div class="field"><label for="qsWhat">What looks wrong</label><select class="inp" id="qsWhat" data-autofocus>'+
        '<option>Commission rate applied</option><option>An order is missing</option>'+
        '<option>A refund I do not recognise</option><option>Withholding tax deducted</option>'+
        '<option>Fees higher than expected</option></select></div>'+
      '<div class="field"><label for="qsRef">Order reference (if it is about one order)</label><input class="inp" id="qsRef" placeholder="ORD-…"></div>'+
      '<div class="field"><label for="qsDet">Detail</label><textarea class="inp" id="qsDet" placeholder="What you expected and what you see"></textarea></div>'+
      '<label class="checkline"><input type="checkbox"> Hold the payout until this is resolved</label>'+
    '</div>'+
    '<div class="modal-foot"><span class="t-tiny muted grow">Finance responds within two working days.</span>'+
    '<button class="btn btn-quiet" onclick="closeModal()">Cancel</button>'+
    '<button class="btn btn-primary" onclick="closeModal();toast(\'Query raised — QRY-2214\')">Raise query</button></div>',
    {label:'Query a settlement statement'});
}

/* --------------------------- 7. Settlement plan --------------------------- */
function vPPlan(){
  const p=MY_PLAN;
  return pagehead('Settlement plan',
    esc(p.name)+' · '+esc(p.model)+' · applies to every listing you sell in '+esc(vName(p.vertical)),
    '<button class="btn" onclick="downloadPlanPdf(MY_PLAN, ME_P.name)">'+ICO('download',13)+'Download schedule</button>'+
    '<button class="btn btn-primary" onclick="requestTier()">Request a tier review</button>')+
  '<div class="stack">'+
  banner('info','Commission is set by your plan, not by individual listings. Tiers are applied to trailing twelve-month gross value and are recalculated on the first of each month.')+
  '<div class="grid g4">'+
    metric({icon:'pie',label:'Current rate',value:p.base+'%',foot:esc(p.model)})+
    metric({icon:'trendup',label:'Trailing GMV',value:CUR0(MY_GMV),foot:'Rolling 12 months'})+
    metric({icon:'calendar',label:'Payout cycle',value:p.cycle.split(',')[0],foot:esc(p.cycle.split(',')[1]||'')})+
    metric({icon:'clock',label:'Holdback',value:p.hold==='None'?'None':p.hold.split('(')[0],foot:'Protects against returns'})+
  '</div>'+
  '<div class="grid g-2-1">'+
    panel('Commission tiers',
      '<table class="tbl"><thead><tr><th>Trailing 12-month gross</th><th class="num">Commission</th><th class="num">You keep</th><th>State</th></tr></thead><tbody>'+
      p.tiers.map((t,i)=>{
        const next=p.tiers[i+1];
        const active = MY_GMV>=t.from && (!next || MY_GMV<next.from);
        return '<tr'+(active?' class="is-selected"':'')+'><td class="cellmain">'+
          (t.from===0?'Up to '+CUR0(next?next.from:'—'):next?CUR0(t.from)+' to '+CUR0(next.from):'Above '+CUR0(t.from))+'</td>'+
          '<td class="num t-num">'+t.rate+'%</td><td class="num t-num">'+(100-t.rate).toFixed(1)+'%</td>'+
          '<td>'+(active?pill('active','Your tier'):MY_GMV>=t.from?pill('neutral','Passed'):pill('neutral','Not reached'))+'</td></tr>';
      }).join('')+'</tbody></table>'+
      '<div class="divider"></div>'+
      (p.tiers[1]&&MY_GMV<p.tiers[1].from
        ? '<div class="stack" style="gap:7px"><div class="row"><span class="t-small grow">Progress to '+p.tiers[1].rate+'%</span>'+
          '<span class="t-small strong t-num">'+CUR0(MY_GMV)+' of '+CUR0(p.tiers[1].from)+'</span></div>'+
          meter(MY_GMV/p.tiers[1].from*100)+
          '<div class="t-tiny muted">At the next tier, the same '+CUR0(1000)+' sale would return '+
          CUR(1000-1000*p.tiers[1].rate/100-19)+' instead of '+CUR(1000-1000*p.base/100-19)+'.</div></div>'
        : ''),
      {flush:false,icon:'chart'})+
    panel('Plan terms',
      '<dl class="deflist" style="grid-template-columns:120px 1fr">'+
        '<dt>Plan</dt><dd>'+esc(p.id)+'</dd>'+
        '<dt>Model</dt><dd>'+esc(p.model)+'</dd>'+
        '<dt>Base rate</dt><dd>'+p.base+'%</dd>'+
        '<dt>Fees</dt><dd>'+esc(p.fees)+'</dd>'+
        '<dt>Cycle</dt><dd>'+esc(p.cycle)+'</dd>'+
        '<dt>Holdback</dt><dd>'+esc(p.hold)+'</dd>'+
        '<dt>Currency</dt><dd>'+MP.currency+' — settled in USD</dd>'+
        '<dt>Withholding</dt><dd>Treaty rate applied while your tax certificate is valid</dd>'+
      '</dl>'+
      '<div class="divider"></div>'+
      '<h4 class="t-sub" style="margin-bottom:9px">On a '+CUR0(1000)+' sale</h4>'+
      splitBar(1000,p),
      {icon:'file'})+
  '</div>'+
  (function(){
    const b=PARTNER_BILLING[ME_P.id]; if(!b) return '';
    const F=BTMAP[BILL_TEMPLATE_ASSIGN.partner];
    const row=(k,v,sub)=>'<div class="row"><div class="grow"><div class="t-small">'+esc(k)+'</div>'+
      (sub?'<div class="t-tiny muted">'+sub+'</div>':'')+'</div>'+
      '<div class="t-small strong" style="text-align:right;max-width:55%">'+v+'</div></div>';
    return panel('Your bill cycle',
      '<div class="grid g2"><div class="stack" style="gap:9px">'+
        row('Cycle', esc(b.cycle)+', '+esc(b.terms), b.override?'Negotiated — not the plan default':'Plan default')+
        row('Holdback', b.holdback==='None'?'None':esc(b.holdback), 'Released after the returns window closes')+
        row('Minimum payout', CUR(b.minPayout), 'Below this the balance rolls into the next cycle')+
        row('Method', esc(b.method)+' · '+esc(b.currency), 'Account ending 4471')+
        row('Invoicing', b.selfBill?'Self-billed by the marketplace':'You raise the invoice',
            b.selfBill?esc(F.taxNote):'Send to settlement@gmail.com within 30 days')+
        (b.override?'<div class="divider"></div>'+banner('info','<strong>Why yours differs:</strong> '+esc(b.note)):'')+
      '</div><div>'+
        '<div class="t-small strong" style="margin-bottom:8px">What your invoice looks like</div>'+
        billPreview('operator')+
      '</div></div>',
      {icon:'clock', sub:'Set by the marketplace. A change takes effect from the next run, not the one already accruing.',
       acts:'<button class="btn btn-sm" onclick="disputeSettlement()">Query the cycle</button>'});
  })()+
  partnerTaxPanel(ME_P.id)+
  panel('Other plans on this marketplace',
    '<table class="tbl"><thead><tr><th>Plan</th><th>Marketplace</th><th>Model</th><th class="num">Base rate</th><th>Cycle</th><th>Partners</th></tr></thead><tbody>'+
    COMM_PLANS.map(c=>'<tr'+(c.id===p.id?' class="is-selected"':'')+'>'+
    '<td><div class="cellmain">'+esc(c.name)+'</div><div class="cellsub t-num">'+esc(c.id)+'</div></td>'+
    '<td>'+vBadge(c.vertical)+'</td><td class="t-small">'+esc(c.model)+'</td>'+
    '<td class="num t-num">'+c.base+'%</td><td class="t-small">'+esc(c.cycle)+'</td>'+
    '<td class="t-num">'+c.partners+'</td></tr>').join('')+'</tbody></table>',
    {flush:true,icon:'group',sub:'Shown so you can see where your plan sits. Rates are set by marketplace policy, not negotiated per partner.'})+
  '</div>';
}
registerExport('sellerSummary',()=>({
  columns:[{key:'measure',label:'Measure'},{key:'value',label:'Value'},{key:'basis',label:'Basis'}],
  rows:[
    {measure:'Live listings',            value:MY_LIST.filter(l=>l.status==='live').length, basis:'Published across your marketplaces'},
    {measure:'Listings in review',       value:MY_LIST.filter(l=>l.status!=='live').length, basis:'Awaiting a marketplace decision'},
    {measure:'Orders',                   value:MY_ORD.length,        basis:'All time on this seller account'},
    {measure:'Open orders',              value:MY_OPEN,              basis:'Not yet at the final pipeline stage'},
    {measure:'Failed fulfilments',       value:MY_FAIL,              basis:'Stalled and needing intervention'},
    {measure:'Gross merchandise value',  value:+MY_GMV.toFixed(2),   basis:'USD, before commission and fees'},
    {measure:'Marketplace commission',   value:+MY_COMM.toFixed(2),  basis:'USD, per '+MY_PLAN.name},
    {measure:'Settlement due to you',    value:+MY_DUE.toFixed(2),   basis:'USD, unpaid statements'},
    {measure:'Open disputes',            value:MY_DISP.filter(d=>d.status!=='resolved').length, basis:'Raised against your orders'}
  ]
}));
registerExport('sellerPerformance',()=>({
  columns:[{key:'listing',label:'Listing'},{key:'sku',label:'SKU'},{key:'marketplace',label:'Marketplace'},
           {key:'orders',label:'Orders'},{key:'gross',label:'Gross (USD)'},{key:'commission',label:'Commission (USD)'},
           {key:'rating',label:'Rating'},{key:'status',label:'Status'}],
  rows:MY_LIST.map(l=>{
    const own=ORDERS.filter(o=>o.sku===l.id);
    return {listing:l.name, sku:l.id, marketplace:vName(l.v), orders:own.length,
            gross:+own.reduce((a,o)=>a+o.gross,0).toFixed(2),
            commission:+own.reduce((a,o)=>a+o.comm,0).toFixed(2),
            rating: l.rating==null ? 'Not rated' : l.rating,
            status:l.status};
  })
}));
function requestTier(){
  confirmAction({title:'Request a tier review', subtitle:'Current rate '+MY_PLAN.base+'% · trailing GMV '+CUR0(MY_GMV),
    risk:'normal', confirmLabel:'Send request',
    body:'<div class="field"><label for="trWhy">Why you think a review is warranted</label>'+
      '<textarea class="inp" id="trWhy" data-autofocus placeholder="e.g. committed volume from a new bundle, exclusivity, seasonal peak"></textarea></div>',
    impact:['Partner management reviews within five working days.',
            'Tier changes are applied from the start of the next settlement period, never retrospectively.',
            'A review can confirm your current tier as well as move it.'],
    onConfirm:()=>toast('Tier review requested — reference TRV-118')});
}

/* ------------------------------ 8. Performance ---------------------------- */
function vPPerformance(){
  const live=MY_LIST.filter(l=>l.status==='live');
  return pagehead('Performance',
    'How your listings convert and where the gross value comes from. Your data only — no other seller is visible to you.',
    exportBtn('Performance','sellerPerformance')+
    periodTabs())+
  '<div class="stack">'+
  periodNote(MY_HIST())+
  (function(){
    const t=periodTotals(MY_HIST());
    const views=Math.round(18402*(t.months/3));
    return '<div class="grid g4">'+
      metric({icon:'eye',label:'Listing views',value:FMT.num(views),foot:periodFoot(MY_HIST(),'orders')})+
      metric({icon:'orders',label:'Orders',value:FMT.num(t.orders),
        foot:'Conversion '+(views?(t.orders/views*100).toFixed(2):'0')+'%'})+
      metric({icon:'wallet',label:'Average order value',value:t.orders?CUR0(t.gross/t.orders):null,
        naLabel:'No orders yet', foot:'Bundles lift this materially'})+
      metric({icon:'undo',label:'Return rate',value:'2.1%',foot:'Marketplace median for hardware is 3.4%'})+
    '</div>';
  })()+
  (MY_BRAND.widgets.chart===false ? '' :
  forecastPanel({series:MY_HIST(), title:'Settlement projection',
    label:'Projected gross value',
    sub:'Your own orders. What settles to you is this less commission, fees and any withholding.',
    assumptions:[
      'Your current listings only. A listing awaiting review contributes nothing until it is live.',
      'Commission is '+MY_PLAN.base+'% under '+esc(MY_PLAN.name)+'. Crossing a volume tier lowers it, so gross and settlement do not move together.',
      'It assumes your fulfilment holds. A failed order is gross value that never settles.',
      '<strong>Not a payment schedule.</strong> Your cycle is '+esc(MY_PLAN.cycle)+' with a '+esc(MY_PLAN.hold)+' holdback.'
    ]})+
  panel('Gross value by month',
    periodChart(MY_HIST()),
    {icon:'chart',
     sub:'Your own orders only. The last three months are computed from order lines; anything earlier is a monthly aggregate.'}))+
  '<div class="grid g2">'+
    panel('Gross value by listing',
      CH.bars(live.map(l=>({l:l.name.split(' ').slice(0,2).join(' '),
        v:+MY_ORD.filter(o=>o.sku===l.id).reduce((a,o)=>a+o.gross,0).toFixed(0)})),
        {fmt:n=>CUR0(n),tip:n=>CUR(n),aria:'Gross value by listing'}),{icon:'chart'})+
    panel('Orders by marketplace',
      CH.donut(ME_P.verticals.map(v=>({l:vName(v).replace(' Marketplace',''),v:MY_ORD.filter(o=>o.v===v).length})),
        {centre:String(MY_ORD.length),centreSub:'orders',fmt:n=>n+' orders',aria:'Orders by marketplace'}),{icon:'pie'})+
  '</div>'+
  panel('Listing detail',
    '<div class="tablewrap"><table class="tbl"><thead><tr><th>Listing</th><th class="num">Views</th><th class="num">Orders</th>'+
    '<th class="num">Conversion</th><th class="num">Gross</th><th class="num">Commission</th><th class="num">Net to you</th></tr></thead><tbody>'+
    live.map((l,i)=>{
      const os=MY_ORD.filter(o=>o.sku===l.id);
      const g=os.reduce((a,o)=>a+o.gross,0), c=os.reduce((a,o)=>a+o.comm,0);
      const views=[6200,4100,3300,2600,2202][i%5];
      return '<tr onclick="openProduct(\''+l.id+'\',{showComm:true,mode:\'seller\'})" style="cursor:pointer">'+
      '<td><div class="cellmain">'+esc(l.name)+'</div><div class="cellsub">'+esc(l.cat)+'</div></td>'+
      '<td class="num t-num">'+FMT.num(views)+'</td><td class="num t-num">'+os.length+'</td>'+
      '<td class="num t-num">'+(os.length?(os.length/views*100).toFixed(2)+'%':'<span class="dim">—</span>')+'</td>'+
      '<td class="num t-num">'+CUR(g)+'</td><td class="num t-num">less '+CUR(c)+'</td>'+
      '<td class="num t-num cellmain">'+CUR(g-c-g*0.019)+'</td></tr>';
    }).join('')+'</tbody></table></div>',{flush:true,icon:'checklist'})+
  (function(){
    /* Reads the real review records rather than a fixed distribution, and
       hands off to the Reviews screen rather than raising a toast. */
    const rv=myReviews(ME_P.id), pub=rv.filter(r=>r.state==='published');
    const open=pub.filter(r=>r.stars<=2 && !r.response);
    const avg=pub.length? +(pub.reduce((a,r)=>a+r.stars,0)/pub.length).toFixed(1) : null;
    const dist=reviewDist(pub);
    const max=Math.max.apply(null, dist.map(d=>d.c).concat([1]));
    return panel('Reviews',
      (open.length
        ? banner('warning','<strong>'+open.length+' review'+(open.length===1?'':'s')+
          ' at two stars or below '+(open.length===1?'has':'have')+' no reply.</strong> The reply is the only '+
          'part of a poor review you control, and every later buyer reads it.')
        : '')+
      '<div class="grid g2" style="gap:18px;align-items:start">'+
        '<div class="row" style="gap:16px;align-items:center">'+
          '<div style="text-align:center;flex:0 0 auto">'+
            '<div style="font-size:30px;font-weight:600;line-height:1">'+
              (avg!=null? avg.toFixed(1) : '<span class="nodata t-small">Not measured</span>')+'</div>'+
            (avg!=null? starRow(Math.round(avg),13) : '')+
            '<div class="t-tiny muted" style="margin-top:4px">'+
              (pub.length? pub.length+' published' : 'No published reviews')+'</div>'+
          '</div>'+
          '<div class="stack grow" style="gap:6px">'+dist.map(d=>
            '<div class="revbar"><span class="revbar-n">'+d.n+'</span>'+SH('star',11)+
            '<div class="bar grow"><span style="width:'+(d.c/max*100).toFixed(1)+'%"></span></div>'+
            '<span class="revbar-c t-num">'+d.c+'</span></div>').join('')+'</div>'+
        '</div>'+
        '<div class="stack" style="gap:9px">'+
          (pub.filter(r=>r.stars<=3).length
            ? '<div class="t-small strong">The most recent criticism</div>'+
              '<div class="t-small muted">\u201c'+
              esc(pub.filter(r=>r.stars<=3)[0].body.slice(0,150))+
              (pub.filter(r=>r.stars<=3)[0].body.length>150?'\u2026':'')+'\u201d</div>'+
              '<div class="t-tiny muted">'+esc(pub.filter(r=>r.stars<=3)[0].author)+' on '+
              esc((SKUMAP[pub.filter(r=>r.stars<=3)[0].sku]||{name:''}).name)+'</div>'
            : '<div class="t-small muted">Nothing below four stars has been published. That is worth '+
              'noticing, and worth not assuming will continue.</div>')+
          '<div class="row" style="gap:8px;margin-top:2px">'+
            '<button class="btn btn-sm btn-primary" onclick="App.go(\'reviews\')">'+
              ICO('message',13)+'Open reviews</button>'+
            (open.length
              ? '<button class="btn btn-sm" onclick="App.go(\'reviews\')">Reply to '+open.length+
                ' outstanding</button>' : '')+
          '</div>'+
        '</div>'+
      '</div>',
      {icon:'thumbsup', sub: pub.length? 'Verified purchases only, checked for content and never for sentiment'
                                       : 'Nothing published yet'});
  })()+
  '</div>';
}

/* --------------------------- 9. Disputes and support ---------------------- */
function vPSupport(){
  return pagehead('Disputes and support',
    MY_DISP.filter(d=>d.status!=='resolved').length+' open · disputes are held against settlement until they close',
    '<button class="btn" onclick="AI.open()">'+ICO('ai',13)+'Ask the assistant</button>'+
    '<button class="btn btn-primary" onclick="toast(\'Support request form opened\')">'+ICO('plus',14)+'Contact the marketplace</button>')+
  '<div class="stack">'+
  (MY_DISP.length
    ? MY_DISP.map(d=>
      '<section class="panel"><div class="panel-body">'+
        '<div class="row wrap" style="gap:12px;align-items:flex-start">'+
          '<div class="grow"><div class="row" style="gap:6px">'+statusPill(d.status)+vBadge(d.v)+
            (d.sla==='Breached'?pill('breached','SLA breached'):pill('neutral',d.sla))+'</div>'+
          '<div class="t-sub" style="margin-top:5px">'+esc(d.reason)+'</div>'+
          '<div class="t-small muted">'+esc(d.id)+' · order '+esc(d.order)+' · raised by '+esc(d.buyer)+' '+esc(d.raised)+'</div></div>'+
          '<div style="text-align:right;flex:0 0 auto"><div class="t-sub t-num">'+CUR(d.amount)+'</div>'+
          '<div class="t-tiny muted">held from settlement</div></div>'+
        '</div>'+
        '<div class="divider"></div>'+
        '<div class="row wrap"><span class="t-tiny muted grow">Owner: '+esc(d.owner)+
          (d.owner==='Partner'?' — the marketplace is waiting on you':'')+'</span>'+
        (d.status==='resolved'
          ? '<button class="btn btn-sm btn-quiet" onclick="toast(\'Resolution detail opened\')">See outcome</button>'
          : '<button class="btn btn-sm" onclick="toast(\'Evidence upload opened\')">Upload evidence</button>'+
            '<button class="btn btn-sm btn-primary" onclick="toast(\'Response sent to the marketplace\')">Respond</button>')+
        '</div>'+
      '</div></section>').join('')
    : panel(null,stateBlock('empty','No disputes','Buyer disputes against your orders would appear here.'),{flush:true}))+
  panel('Help and policies',
    '<div class="grid g3">'+
    [['Seller policies','What can and cannot be listed, and why listings get rejected','file'],
     ['Fulfilment standards','Dispatch targets, tracking requirements and what counts as late','orders'],
     ['Settlement rules','Cycles, holdbacks, refunds, withholding and disputes','wallet']].map(c=>
    '<div class="card"><div class="card-head">'+ICO(c[2],15)+'<div class="grow"><div class="t-sub">'+esc(c[0])+'</div></div></div>'+
    '<div class="card-body"><div class="t-small muted">'+esc(c[1])+'</div>'+
    '<button class="btn btn-sm" style="margin-top:11px" onclick="toast(\''+esc(c[0])+' opened\')">Read</button></div></div>').join('')+
    '</div>',{icon:'support'})+
  '</div>';
}

/* ------------------- 10. Team and roles (seller account) ------------------ */
function vPTeam(){
  return usersView({
    ctx:'partner', title:'Team and roles', userNoun:'team member',
    inviteLabel:'Invite a colleague', dirTitle:'Your team',
    roleSub:'Only the seller admin can publish listings and act on onboarding. Fulfilment and finance are deliberately separate.',
    mfaNote:'Required for anyone who can see settlement',
    banner:banner('info','These are people at <strong>'+esc(ME_P.name)+'</strong>, not marketplace staff. '+
      'The marketplace never sees your team list; it only sees which of you acted on an order.')
  });
}

/* ---------------------- 16. Support tickets ------------------------------- */
function vPTickets(){
  return ticketsView({ctx:'partner', title:'Support tickets'});
}

/* ---------------------- 14. Inventory ------------------------------------- */
function vPInventory(){
  return inventoryView({partnerId:ME_P.id, title:'Inventory',
    showSim:false, showPools:false});
}

/* ---------------------- 13. Audit log ------------------------------------- */
function vPAudit(){
  return auditView({ctx:'partner', title:'Audit log',
    banner:banner('info','<strong>Your account only.</strong> This is what happened on '+esc(ME_P.name)+' — your '+
      'people, your listings, your orders, and what the marketplace did to you. No other seller appears here, and '+
      'you do not appear in theirs. Entries cannot be edited or deleted by anyone, including the marketplace.')});
}

/* ---------------------- 12. My details ------------------------------------ */
function vPProfile(){
  return myDetailsView({ctx:'partner', org:ME_P.name,
    delegateNote:'A delegate can act on orders and answer disputes for you. They cannot publish a listing or change '+
      'your settlement account.'})+
  /* Everything the seller handed over at onboarding, in the place they would
     look for it. A seller who cannot see what the marketplace holds about them
     cannot correct it, and cannot answer their own auditor. */
  sellerComplianceView(ME_P.id);
}

/* ---------------------- 10b. Roles configuration -------------------------- */
function vPRoles(){
  return rolesView({
    ctx:'partner', title:'Roles configuration',
    banner:banner('info','These roles are yours alone — the marketplace never sees them. '+
      'What it does see is which of your people acted on an order, so keep fulfilment and finance in different hands.')
  });
}

/* ---------------------- 11. Notification rules (seller) ------------------- */
function vPNotif(){
  return notifView({
    ctx:'partner', title:'Notifications',
    scopeNote:'scoped to '+esc(ME_P.name)+' — nothing about other sellers reaches you',
    quietNote:'Failed orders and onboarding blockers always come through.',
    escalateLabel:'Escalate an unacknowledged failed order to the seller admin after 30 minutes',
    prefScope:'your whole team', sentCount:'96',
    banner:banner('info','Rules address a <strong>role on your team</strong>. A new fulfilment operator starts receiving order alerts the moment you assign them the role.')
  });
}

/* --------------------------------- collections --------------------------- */
function vPCollections(){
  return dunningView({ctx:'partner', partnerId:ME_P.id, title:'Collections'});
}

/* ------------------------------- registration ---------------------------- */
function vPRefunds(){ return refundsView({ctx:'partner', partnerId:ME_P.id, title:'Refund requests'}); }
function vPNotes(){ return notesView({partnerId:ME_P.id, title:'Credit and debit notes'}); }
function vPReviews(){ return sellerReviewsView(ME_P.id); }
function vPRewards(){ return rewardsSellerView(ME_P.id); }
const VIEWS={
  rewards:vPRewards, collections:vPCollections, refunds:vPRefunds, notes:vPNotes, reviews:vPReviews,
  help:vPHelp,
  bulk:vPBulk,
  numbers:vPNumbers,
  delivery:vPDelivery,
  auth:vPAuth,
  home:vPHome, onboarding:vPOnboarding, listings:vPListings, newlisting:vPNewListing,
  orders:vPOrders, settlement:vPSettlement, plan:vPPlan, performance:vPPerformance,
  support:vPSupport, tickets:vPTickets, integrations:vPIntegrations, inventory:vPInventory,
  team:vPTeam, roles:vPRoles, notifications:vPNotif, audit:vPAudit,
  branding:vPBranding, profile:vPProfile
};

App.init({
  brand:'6d',
  orgCtx:'partner', profileView:'profile', securityView:'team',
  profileSub:'Name, contact, time zone and cover while you are away',
  signedIn:'today at 07:58',
  product:'Partner Console', tier:'6D Marketplace · '+MP.operator,
  env:'Partner portal',
  persona:{name:ME_P.contact, role:'Seller operations', org:ME_P.name},
  searchScope:'your listings and orders', alertCount:3,
  notifications:[
    {when:'25 min ago', text:'Sandbox fulfilment callback failed for the third time — Security marketplace go-live is blocked', source:'Onboarding · technical gate', kind:'danger', read:false},
    {when:'2 h ago', text:'A delivery failed on ORD-880519 — 3 of 25 sensors reported missing', source:'Orders', kind:'danger', read:false},
    {when:'5 h ago', text:'Your Jul 2026 settlement statement is ready for review', source:'Settlement', kind:'info', read:false},
    {when:'Yesterday', text:'Your tax residency certificate expires on 11 Sep 2026', source:'Onboarding · documents', kind:'warning', read:true},
    {when:'3 d ago', text:'Nimbus Occupancy sensor passed catalogue review and is now live', source:'Listings', kind:'success', read:true}
  ],
  footNote:ME_P.id+' · '+ME_P.tier+' partner',
  aiName:'Partner assistant',
  aiGreeting:'I can answer questions about your listings, orders, onboarding and settlement. I only see <strong>'+esc(ME_P.name)+'</strong> — no other seller\'s data.'+
    '<div class="src">Sources: your listings, orders, settlement statements, onboarding record.</div>',
  aiSuggestions:['Why is my go-live blocked?','What will my next payout be?','Which listing performs best?','How do I reach the next commission tier?'],
  nav:[
    {label:'Overview', items:[{id:'home', label:'Dashboard', icon:'dashboard'}]},
    {label:'Onboarding', items:[
      {id:'onboarding', label:'Onboarding', icon:'route',
       count:()=>MY_ONB_TASKS.filter(t=>t.status!=='done'&&t.status!=='notstarted').length}]},
    {label:'Catalogue', items:[
      {id:'listings', label:'My listings', icon:'package', count:()=>MY_LIST.length},
      {id:'newlisting', label:'New listing', icon:'plus'}]},
    {label:'Trade', items:[
      {id:'numbers', label:'SIMs on my orders', icon:'sim', count:()=>MY_ICCIDS().length},
      {id:'inventory', label:'Inventory', icon:'package',
       count:()=>Object.keys(INVENTORY).filter(k=>INVENTORY[k].partnerId===ME_P.id &&
         (invState(k)==='low'||invState(k)==='out')).length},
      {id:'orders', label:'Orders', icon:'orders', count:()=>MY_OPEN.length+MY_FAIL.length},
      {id:'settlement', label:'Settlement', icon:'wallet'},
      {id:'plan', label:'Settlement plan', icon:'file'}]},
    {label:'Insight', items:[
      {id:'performance', label:'Performance', icon:'chart'},
      {id:'support', label:'Disputes and support', icon:'support',
       count:()=>MY_DISP.filter(d=>d.status!=='resolved').length},
      {id:'tickets', label:'Support tickets', icon:'inbox',
       count:()=>tktVisible('partner').filter(t=>['new','open','waiting','escalated'].indexOf(t.state)>-1).length},
      {id:'integrations', label:'Integrations', icon:'plug',
       count:()=>MY_ENDPOINTS.filter(e=>e.enabled && e.health==='failing').length},
      {id:'reviews', label:'Reviews', icon:'thumbsup',
       count:()=>myReviews(ME_P.id).filter(r=>r.state==='published'&&r.stars<=2&&!r.response).length},
      {id:'refunds', label:'Refund requests', icon:'refresh',
       count:()=>REFUNDS.filter(r=>r.sellerId===ME_P.id && r.state==='requested' &&
         refundApprover(r).owner==='partner').length},
      {id:'notes', label:'Credit and debit notes', icon:'file',
       count:()=>CREDIT_NOTES.filter(n=>n.partnerId===ME_P.id && n.state==='issued').length},
      {id:'rewards', label:'Rewards', icon:'zap',
       count:()=>loyaltyForPartner(ME_P.id).rows.length},
      {id:'collections', label:'Collections', icon:'wallet',
       count:()=>DUNNING_CASES.filter(d=>(d.sellerId===ME_P.id && dunSegmentOf(d)!=='partner') ||
         (dunSegmentOf(d)==='partner' && d.account===ME_P.name)).filter(d=>d.state!=='recovered').length}]},
    {label:'Account', items:[
      {id:'team', label:'Your team', icon:'shield',
       count:()=>orgUsers('partner').filter(u=>u.status!=='removed').length},
      {id:'bulk', label:'Bulk updates', icon:'upload', count:()=>bulkSets().length},
      {id:'roles', label:'Roles configuration', icon:'key', count:()=>orgRoles('partner').length},
      {id:'auth', label:'Sign-in and sessions', icon:'lock', count:()=>(SESSIONS.partner||[]).length},
      {id:'notifications', label:'Notifications', icon:'bell'},
      {id:'delivery', label:'Message delivery', icon:'zap',
       count:()=>DELIVERIES.filter(d=>d.ctx==='partner'&&(d.state==='failed'||d.state==='expired')).length},
      {id:'help', label:'Knowledge base', icon:'file', count:()=>(KB_ARTICLES.partner||[]).length},
      {id:'audit', label:'Audit log', icon:'history',
       count:()=>auditRows('partner').filter(e=>e.sev==='high').length},
      {id:'branding', label:'Branding', icon:'eye'},
      {id:'profile', label:'My details', icon:'user'}]}
  ],
  searchIndex:[
    {k:'Screen',t:'Seller dashboard',v:'home'},{k:'Screen',t:'Collections and dunning ladders',v:'collections'},{k:'Screen',t:'Refund requests from customers',v:'refunds'},{k:'Screen',t:'Credit and debit notes',v:'notes'},{k:'Screen',t:'Reviews and replies',v:'reviews'},{k:'Screen',t:'Partner onboarding journey',v:'onboarding'},
    {k:'Screen',t:'My listings',v:'listings'},{k:'Screen',t:'Product onboarding — new listing',v:'newlisting'},
    {k:'Screen',t:'Orders and fulfilment',v:'orders'},{k:'Screen',t:'Settlement and payouts',v:'settlement'},
    {k:'Screen',t:'Settlement plan and commission tiers',v:'plan'},{k:'Screen',t:'Performance',v:'performance'},
    {k:'Screen',t:'Disputes and support',v:'support'},
    {k:'Task',t:'Fulfilment webhook failing in sandbox',v:'onboarding'},
    {k:'Task',t:'Tax residency certificate expiring',v:'onboarding'},
    {k:'Screen',t:'Team and roles',v:'team'},
    {k:'Screen',t:'Notification rules',v:'notifications'}
  ],
  aiAnswer(q){
    if(/go.?live|block|onboard|webhook|stuck/.test(q))
      return 'Your <strong>Security Marketplace</strong> application ('+esc(MY_ONB_NEW.ref)+') is held at the technical gate.'+
        '<table><tr><th>Gate</th><th>State</th></tr>'+
        ONB_STEPS.map(s=>'<tr><td>'+esc(s.name)+'</td><td>'+
        (MY_ONB_NEW.state[s.id]==='done'?'Cleared':MY_ONB_NEW.state[s.id]==='now'?'Open — you':'Not started')+'</td></tr>').join('')+'</table>'+
        'The blocker is specific: three of five sandbox fulfilment callbacks returned HTTP 500 on retry. Five consecutive successes close the gate automatically.'+
        '<div class="src">Sources: onboarding record, sandbox callback log.</div>';
    if(/payout|settle|paid|money|owed/.test(q)){
      const c=MY_STM[0];
      return c ? 'Your next payout is <strong>'+CUR(c.net)+'</strong> on '+esc(c.due)+' by '+esc(c.method)+'.'+
        '<table><tr><th>Line</th><th>Amount</th></tr>'+
        '<tr><td>Gross ('+c.orders+' orders)</td><td>'+CUR(c.gross)+'</td></tr>'+
        '<tr><td>Commission at '+MY_PLAN.base+'%</td><td>less '+CUR(c.commission)+'</td></tr>'+
        '<tr><td>Fees</td><td>less '+CUR(c.fees)+'</td></tr>'+
        (c.refunds?'<tr><td>Refunds</td><td>less '+CUR(c.refunds)+'</td></tr>':'')+
        '<tr><td><strong>Net</strong></td><td><strong>'+CUR(c.net)+'</strong></td></tr></table>'+
        CUR(MY_OPEN.reduce((a,o)=>a+o.gross,0))+' of undelivered orders rolls into the next statement rather than being estimated into this one.'+
        '<div class="src">Sources: settlement statement '+esc(c.id)+', order records, your plan.</div>'
        : 'No settlement statement has been produced for you yet.<div class="src">Sources: settlement records.</div>';
    }
    if(/best|perform|sell|conver/.test(q)){
      const rows=MY_LIST.filter(l=>l.status==='live').map(l=>({n:l.name, g:MY_ORD.filter(o=>o.sku===l.id).reduce((a,o)=>a+o.gross,0)}))
        .sort((a,b)=>b.g-a.g).slice(0,4);
      return 'By gross value over the last 90 days:'+
        '<table><tr><th>Listing</th><th>Gross</th></tr>'+
        rows.map(r=>'<tr><td>'+esc(r.n)+'</td><td>'+CUR(r.g)+'</td></tr>').join('')+'</table>'+
        'The pattern worth acting on: bundles carry a much higher average order value than the same items sold individually, on similar listing traffic.'+
        '<div class="src">Sources: your order records, listing view counts.</div>';
    }
    if(/tier|commission|rate|%/.test(q))
      return 'You are on <strong>'+esc(MY_PLAN.name)+'</strong> at '+MY_PLAN.base+'%.'+
        '<table><tr><th>Trailing 12-month gross</th><th>Rate</th></tr>'+
        MY_PLAN.tiers.map((t,i)=>{const n=MY_PLAN.tiers[i+1];
          return '<tr><td>'+(t.from===0?'Up to '+CUR0(n?n.from:0):n?CUR0(t.from)+'–'+CUR0(n.from):'Above '+CUR0(t.from))+'</td><td>'+t.rate+'%</td></tr>';}).join('')+
        '</table>'+
        (MY_PLAN.tiers[1]? 'You are at '+CUR0(MY_GMV)+', so '+CUR0(MY_PLAN.tiers[1].from-MY_GMV)+' short of '+MY_PLAN.tiers[1].rate+'%. '+
          'That estimate assumes your current run-rate holds — I cannot predict a slow month.' : '')+
        '<div class="src">Sources: your plan schedule, trailing GMV.</div>';
    return null;
  }
});

/* ===========================================================================
   THIS SELLER'S OWN APPLICATION — what was actually submitted at each gate
   =========================================================================== */
const MY_ONB_SUB = {
  apply:{
    submittedBy:ME_P.contact, submittedOn:'14 Jul 2026',
    reviewedBy:'Marketplace onboarding desk', reviewedOn:'15 Jul 2026',
    fields:[['Marketplace applied for','Security Marketplace'],
            ['Existing marketplaces', ME_P.verticals.map(v=>vName(v)).join(', ')],
            ['Reason for extension','Existing MDR and VPN catalogue already sold direct; want it on the marketplace'],
            ['Expected monthly volume','$68,000'],
            ['Listings planned at launch','6'],
            ['Target markets','India, UAE, Singapore'],
            ['Primary contact', ME_P.contact]],
    docs:[], carried:false
  },
  kyc:{
    submittedBy:'Carried over', submittedOn:'09 Sep 2024',
    reviewedBy:'Risk and compliance', reviewedOn:'15 Jul 2026',
    fields:[['Status','Carried over from your original onboarding'],
            ['Entity verified','Yes — '+ME_P.name+', verified 09 Sep 2024'],
            ['Beneficial ownership','Unchanged since last review'],
            ['Sanctions rescreen','Run 15 Jul 2026 — no match'],
            ['Adverse media rescreen','Run 15 Jul 2026 — nothing material']],
    docs:[['Certificate of incorporation','PDF','1.4 MB'],
          ['Beneficial ownership declaration','PDF','0.3 MB']],
    carried:true
  },
  agree:{
    submittedBy:ME_P.contact, submittedOn:'18 Jul 2026',
    reviewedBy:'Legal', reviewedOn:'18 Jul 2026',
    fields:[['Security marketplace addendum','Signed 18 Jul 2026'],
            ['Signed by', ME_P.contact],
            ['Master agreement','Unchanged — v4.1, signed 09 Sep 2024'],
            ['Commission schedule','Security — subscription, 18% base'],
            ['Listing rights','Extended to the Security Marketplace']],
    docs:[['Security marketplace addendum','PDF','0.6 MB']],
    carried:false
  },
  finance:{
    submittedBy:'Carried over', submittedOn:'13 Sep 2024',
    reviewedBy:'Finance', reviewedOn:'19 Jul 2026',
    fields:[['Status','Existing verified account reused — no new verification'],
            ['Settlement account','•••• 4471, verified 13 Sep 2024'],
            ['Settlement currency','USD'],
            ['Tax residency', ME_P.country],
            ['Treaty certificate','On file, expires 11 Sep 2026'],
            ['Withholding','Nil under treaty while the certificate is valid']],
    docs:[['Bank verification letter','PDF','0.5 MB'],
          ['Tax residency certificate','PDF','0.6 MB']],
    carried:true
  },
  tech:{
    submittedBy:ME_P.contact, submittedOn:'21 Jul 2026',
    reviewedBy:null, reviewedOn:null,
    fields:[['Catalogue method','API feed, hourly'],
            ['Fulfilment webhook','https://api.sentinelcyber.example/marketplace/fulfil'],
            ['Webhook status','Failing — 3 of 5 sandbox callbacks returned HTTP 500'],
            ['Sandbox order','Not yet completed end to end'],
            ['Retry policy','3 attempts, exponential backoff — accepted'],
            ['Integration contact', ME_P.contact]],
    docs:[['Sandbox callback log','TXT','0.2 MB']],
    carried:false
  },
  assure:{ notStarted:true },
  golive:{ notStarted:true }
};
function openMyGate(gid){
  const step=ONB_STEPS.find(s=>s.id===gid); if(!step) return;
  const v=MY_ONB_NEW.state[gid]||'todo';
  const sub=MY_ONB_SUB[gid];
  const pol=GATE_POLICY[gid]||{};
  const idx=ONB_STEPS.indexOf(step);
  const prev=idx>0?ONB_STEPS[idx-1]:null, next=idx<ONB_STEPS.length-1?ONB_STEPS[idx+1]:null;
  const tasks=MY_ONB_TASKS.filter(t=>t.step===gid);
  const real = sub && !sub.notStarted;

  openInspector(
    '<div class="insp-head">'+ICO('route',18)+'<div class="grow">'+
      '<div class="row" style="gap:6px">'+gatePill(v)+'<span class="tag">Gate '+(idx+1)+' of '+ONB_STEPS.length+'</span>'+
      (real&&sub.carried?pill('info','Carried over'):'')+'</div>'+
      '<h3 class="t-sub" style="margin-top:5px">'+esc(step.name)+'</h3>'+
      '<div class="t-small muted">'+esc(MY_ONB_NEW.target)+' · '+esc(MY_ONB_NEW.ref)+'</div></div>'+
      '<button class="iconbtn" onclick="closeInspector()" aria-label="Close">'+ICO('x',16)+'</button></div>'+
    '<div class="insp-body stack">'+
      '<p class="t-body" style="margin:0">'+esc(step.desc)+'</p>'+

      (real && sub.carried
        ? banner('info','<strong>Carried over from your original onboarding.</strong> You did not have to submit this '+
          'again — an existing partner does not repeat due diligence. It was rescreened rather than redone.')
        : '')+
      (!real
        ? banner('info','<strong>Nothing submitted yet.</strong> This gate opens once '+
          (prev?esc(prev.name).toLowerCase():'the previous gate')+' clears.')
        : '')+

      '<dl class="deflist">'+
        '<dt>State</dt><dd>'+esc(gateStateName(v))+'</dd>'+
        '<dt>Owned by</dt><dd>'+esc(pol.owner||'Marketplace onboarding desk')+'</dd>'+
        '<dt>Target</dt><dd>'+slaWords(pol.slaDays)+'</dd>'+
        (real?'<dt>Submitted</dt><dd>'+esc(sub.submittedBy)+' on '+esc(sub.submittedOn)+'</dd>':'')+
        (real?'<dt>Reviewed</dt><dd>'+(sub.reviewedBy
          ? esc(sub.reviewedBy)+' on '+esc(sub.reviewedOn)
          : '<span class="nodata">Not yet — the marketplace is waiting on you</span>')+'</dd>':'')+
      '</dl>'+

      (real
        ? '<div class="divider"></div><h4 class="t-sub">What you submitted</h4>'+
          '<div class="tablewrap"><table class="tbl"><tbody>'+
          sub.fields.map(f=>'<tr><td style="width:42%"><span class="t-small muted">'+esc(f[0])+'</span></td>'+
            '<td><span class="t-small strong">'+esc(f[1])+'</span></td></tr>').join('')+
          '</tbody></table></div>'
        : '')+

      (real && sub.docs.length
        ? '<div class="divider"></div><h4 class="t-sub">Documents</h4>'+
          '<div class="stack" style="gap:7px">'+sub.docs.map(d=>
            '<div class="row" style="gap:9px"><span class="cartthumb" style="width:30px;height:30px">'+ICO('file',14)+'</span>'+
            '<div class="grow"><div class="t-small strong">'+esc(d[0])+'</div>'+
            '<div class="t-tiny muted">'+esc(d[1])+' · '+esc(d[2])+'</div></div>'+
            '<button class="btn btn-sm btn-quiet" onclick="viewGateDoc('+JSON.stringify(d[0]).replace(/"/g,'&quot;')+
              ','+JSON.stringify(ME_P.name).replace(/"/g,'&quot;')+')">View</button></div>').join('')+'</div>'
        : '')+

      '<div class="divider"></div><h4 class="t-sub">What this gate needs</h4>'+
      '<ul class="ticklist">'+(pol.evidence||[]).map(e=>{
        const got = real && (sub.fields.some(f=>f[0].toLowerCase().indexOf(e.toLowerCase().split(' ')[0])>-1) ||
                             sub.docs.some(d=>d[0].toLowerCase().indexOf(e.toLowerCase().split(' ')[0])>-1));
        return '<li>'+(got?SH('check',11):SH('dash',11))+' '+esc(e)+
               (got?'':' <span class="t-tiny muted">— outstanding</span>')+'</li>';
      }).join('')+'</ul>'+

      (tasks.length
        ? '<div class="divider"></div><h4 class="t-sub">Your tasks on this gate</h4>'+
          '<div class="stack" style="gap:8px">'+tasks.map(t=>
            '<div class="row" style="gap:9px"><div class="grow"><div class="t-small strong">'+esc(t.title)+'</div>'+
            '<div class="t-tiny muted">'+esc(t.detail)+'</div></div>'+
            (t.status==='done'?pill('approved','Done'):t.status==='blocked'?pill('down','Blocked'):
             t.status==='notstarted'?pill('neutral','Locked'):pill('pending','Open'))+
            (t.status!=='done'&&t.status!=='notstarted'
              ? '<button class="btn btn-sm btn-primary" onclick="closeInspector();resolveOnbTask(\''+t.id+'\')">Resolve</button>'
              : '')+
            '</div>').join('')+'</div>'
        : '')+

      '<div class="divider"></div>'+
      '<div class="row wrap" style="gap:7px">'+
        (prev?'<button class="btn btn-sm btn-quiet" onclick="openMyGate(\''+prev.id+'\')">'+ICO('chevleft',13)+esc(prev.name)+'</button>':'')+
        '<div class="spacer"></div>'+
        (next?'<button class="btn btn-sm btn-quiet" onclick="openMyGate(\''+next.id+'\')">'+esc(next.name)+ICO('chevright',13)+'</button>':'')+
      '</div>'+
    '</div>'+
    '<div class="insp-foot"><button class="btn btn-quiet" onclick="closeInspector()">Close</button>'+
      '<div class="spacer"></div>'+
      (real?'<button class="btn btn-sm" onclick="toast(\''+esc(step.name)+' submission downloaded as PDF\')">'+
        ICO('download',13)+'Download</button>':'')+
    '</div>', step.name+' — '+MY_ONB_NEW.target);
}

/* --------------------------- the onboarding guide ------------------------- */
function onboardingGuide(){
  const cur=onbCurrentGate(MY_ONB_NEW.state);
  openModal('<div class="modal-head">'+ICO('file',18)+'<div class="grow"><h3 class="t-sub">Onboarding guide</h3>'+
    '<div class="t-small muted">What each gate asks for, who owns it, and how long it should take</div></div>'+
    '<button class="iconbtn" onclick="closeModal()" aria-label="Close">'+ICO('x',16)+'</button></div>'+
    '<div class="modal-body stack">'+
      banner('info','<strong>Gates run in order and do not overlap.</strong> That is deliberate: it is what stops an '+
        'application reaching production before due diligence has cleared. It also means the only gate worth working '+
        'on is the open one — everything after it is locked until it clears.')+

      '<div class="stack" style="gap:0">'+ONB_STEPS.map((s,i)=>{
        const pol=GATE_POLICY[s.id]||{};
        const v=MY_ONB_NEW.state[s.id]||'todo';
        const isNow=cur&&cur.id===s.id;
        return '<div style="display:flex;gap:12px;padding:12px 0;'+
          (i<ONB_STEPS.length-1?'border-bottom:1px solid var(--nim-line-100);':'')+'">'+
          '<div style="flex:0 0 26px;height:26px;border-radius:50%;display:grid;place-items:center;'+
            'font-size:11px;font-weight:600;'+
            (v==='done'?'background:var(--nim-success-bg);color:var(--nim-success-fg)':
             isNow?'background:var(--nim-primary-600);color:#FFF':
             'background:var(--nim-surface-100);color:var(--nim-ink-600)')+'">'+
            (v==='done'?SH('check',11):(i+1))+'</div>'+
          '<div class="grow"><div class="row" style="gap:7px"><span class="t-small strong grow">'+esc(s.name)+'</span>'+
            (isNow?pill('pending','You are here'):v==='done'?pill('approved','Cleared'):pill('neutral','Locked'))+'</div>'+
          '<div class="t-small muted" style="margin-top:2px">'+esc(s.desc)+'</div>'+
          '<div class="t-tiny muted" style="margin-top:5px">'+esc(pol.owner||'Marketplace')+' · target '+
            slaWords(pol.slaDays)+
            (pol.dualControl?' · two reviewers':'')+'</div>'+
          '<ul class="ticklist" style="margin-top:7px">'+(pol.evidence||[]).map(e=>
            '<li>'+SH('dot',10)+' '+esc(e)+'</li>').join('')+'</ul>'+
          '</div>'+
          '<div style="flex:0 0 auto">'+
            '<button class="btn btn-sm btn-quiet" onclick="closeModal();openMyGate(\''+s.id+'\')">Open</button></div>'+
        '</div>';
      }).join('')+'</div>'+

      '<div class="divider"></div>'+
      '<div class="t-small strong" style="margin-bottom:6px">Things that catch sellers out</div>'+
      '<ul class="ticklist">'+[
        'KYC and Agreements cannot be waived. There is no route round them, so raising it with your account manager will not help.',
        'A second marketplace carries KYC and your settlement account over. You do not repeat due diligence.',
        'The technical gate is where most applications stall — usually a fulfilment webhook that works once and fails on retry.',
        'The clock keeps running while a task sits with you. It only pauses when the marketplace is reviewing.',
        'Going live is your decision, not ours. Every gate can be clear and your storefront still closed until you publish.'
      ].map(t=>'<li>'+SH('dot',10)+' '+esc(t)+'</li>').join('')+'</ul>'+
    '</div>'+
    '<div class="modal-foot"><span class="t-tiny muted grow">Median time to go-live across the marketplace is 21 days.</span>'+
      '<button class="btn btn-quiet" onclick="closeModal()">Close</button>'+
      (cur?'<button class="btn btn-primary" onclick="closeModal();openMyGate(\''+cur.id+'\')">Open the '+
        esc(cur.name.toLowerCase())+' gate</button>':'')+'</div>',
    {wide:true,label:'Onboarding guide'});
}

/* ===========================================================================
   MEDIA IN THE LISTING WIZARD
   =========================================================================== */
function nlMediaHtml(){
  const s=mediaSummary(NL.media);
  const full = s.images >= MEDIA_RULES.maxImages;
  return mediaStatus(NL.media)+
    /* Draw the artwork for whatever the seller is actually listing, so the
       thumbnails are a picture of it rather than a category glyph. */
    mediaList(NL.media,{editable:true, onAlt:'nlMediaAlt', onMove:'nlMediaMove',
                        onPrimary:'nlMediaPrimary', onRemove:'nlMediaRemove',
                        product:{id:'NL-draft', name:NL.name||'New listing',
                                 v:NL.v, cat:NL.cat||''}})+
    '<div class="dropzone'+(full?' is-full':'')+'" style="margin-top:10px">'+
      ICO('image',20)+
      '<div class="t-small" style="margin-top:6px">'+
        (full
          ? 'You have the maximum of '+MEDIA_RULES.maxImages+' images. Remove one to add another.'
          : 'Drop files here, or add one:')+
      '</div>'+
      (full ? '' :
      '<div class="row" style="gap:7px;justify-content:center;margin-top:9px">'+
        MEDIA_KINDS.map(k=>'<button class="btn btn-sm" onclick="nlMediaAdd(\''+k.id+'\')">'+
          ICO(k.icon,13)+'Add '+esc(k.label.toLowerCase())+'</button>').join('')+
      '</div>')+
      '<div class="t-tiny muted" style="margin-top:8px">'+
        esc(MEDIA_RULES.imageTypes.join(', '))+' · '+MEDIA_RULES.minPx+'×'+MEDIA_RULES.minPx+' minimum · '+
        'video up to '+MEDIA_RULES.videoMaxSec+'s · datasheets as '+esc(MEDIA_RULES.docTypes.join('/'))+
      '</div>'+
    '</div>'+
    '<div class="t-tiny muted" style="margin-top:8px">'+
      'The primary image is what appears on the product card and in search results. Order is the gallery order. '+
      'Alt text is required — it is what a screen reader announces and what shows if an image fails to load.</div>';
}
function nlMediaRedraw(){
  const h=document.getElementById('nlMediaHost');
  if(h) h.innerHTML=nlMediaHtml();
}
/* No file system in a prototype, so a "file" is a plausible record. The
   validation, ordering and alt-text rules are the real part. */
function nlMediaAdd(kind){
  const imgs=NL.media.filter(m=>m.kind==='image').length;
  if(kind==='image' && imgs>=MEDIA_RULES.maxImages){
    toast('Maximum '+MEDIA_RULES.maxImages+' images','warn'); return;
  }
  if(kind==='video' && NL.media.some(m=>m.kind==='video')){
    toast('One video per listing — buyers do not watch two','warn'); return;
  }
  NL_MEDIA_SEQ++;
  const base=(NL.name||'listing').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')||'listing';
  const shots=['Front','Angle','In use','Packaging','Detail','Scale','Ports','Box contents'];
  const item = kind==='image'
    ? {id:'NM-'+NL_MEDIA_SEQ, kind:'image', name:base+'-'+(imgs+1)+'.jpg',
       alt:'', px:'1600×1600', mb:(0.7+imgs*0.2).toFixed(1),
       shot:shots[imgs%shots.length], primary:imgs===0}
    : kind==='video'
    ? {id:'NM-'+NL_MEDIA_SEQ, kind:'video', name:base+'-overview.mp4',
       alt:'', px:'1920×1080', mb:'18.6', secs:75, primary:false}
    : {id:'NM-'+NL_MEDIA_SEQ, kind:'doc', name:base+'-datasheet.pdf',
       alt:'', px:null, mb:'1.1', primary:false};
  NL.media.push(item);
  nlMediaRedraw();
  toast(item.name+' added — describe it before you submit');
}
function nlMediaAlt(id,v){
  const m=NL.media.find(x=>x.id===id); if(!m) return;
  const wasEmpty=!String(m.alt||'').trim();
  m.alt=v;
  /* Only redraw when the error state actually flips, so typing keeps focus. */
  if(wasEmpty !== !String(v||'').trim()) nlMediaRedraw();
}
function nlMediaMove(id,d){
  const i=NL.media.findIndex(x=>x.id===id);
  const j=i+d;
  if(i<0 || j<0 || j>=NL.media.length) return;
  const t=NL.media[i]; NL.media[i]=NL.media[j]; NL.media[j]=t;
  nlMediaRedraw();
}
function nlMediaPrimary(id){
  const m=NL.media.find(x=>x.id===id); if(!m || m.kind!=='image') return;
  NL.media.forEach(x=>{ x.primary=false; });
  m.primary=true;
  nlMediaRedraw();
  toast(m.name+' is now the card image');
}
function nlMediaRemove(id){
  const i=NL.media.findIndex(x=>x.id===id); if(i<0) return;
  const was=NL.media[i];
  NL.media.splice(i,1);
  /* Never leave a gallery with no primary. */
  if(was.primary){
    const firstImg=NL.media.find(x=>x.kind==='image');
    if(firstImg) firstImg.primary=true;
  }
  nlMediaRedraw();
  toast(was.name+' removed'+(was.primary&&NL.media.some(x=>x.primary)
    ? ' — '+NL.media.find(x=>x.primary).name+' is now the card image' : ''));
}
function nlSetEndpoint(id){ NL.endpoint=id||null; App.go('newlisting'); }

/* ===========================================================================
   12. INTEGRATIONS — the seller's own APIs
   The marketplace calls the seller; the seller never polls. That only works
   if the endpoint, its auth, its retry policy and its failures are all visible
   in one place, which is what this screen is.
   =========================================================================== */
function epHealthPill(ep){
  if(!ep.enabled) return pill('neutral','Disabled');
  return ep.health==='healthy' ? pill('active','Healthy')
       : ep.health==='failing' ? pill('down','Failing')
       : pill('neutral','Not yet called');
}
function epFor(id){ return MY_ENDPOINTS.find(e=>e.id===id); }
function epCoverage(){
  const required=API_EVENTS.filter(e=>e.required);
  const covered=required.filter(e=>MY_ENDPOINTS.some(x=>x.enabled && x.events.indexOf(e.id)>-1));
  return {required:required, covered:covered, missing:required.filter(e=>covered.indexOf(e)===-1)};
}
/* The seller's side of the developer portal: what the marketplace offers them,
   which environment they hold, and what still stands between them and
   production. Sits above their own endpoint registry. */
function myApiAccessPanel(){
  const t=techStatus(ME_P.id);
  const tier=API_TIERS.filter(x=>x.env===(ME_P.status==='active'?'production':'sandbox'))[0]||API_TIERS[0];
  const env=API_ENVS.filter(e=>e.id===tier.env)[0]||API_ENVS[0];
  const done=TECH_CHECKS.filter(c=>t.checks[c.id]).length;
  return panel('Your API access',
    banner('info','<strong>The API is a second way to do what this console already lets you do.</strong> '+
      'Reading your catalogue, taking your orders, posting stock and pulling your settlement carry no charge — '+
      'it is your own data. Rate limits are there to stop one integration degrading the platform, not to sell you '+
      'a bigger one.')+
    dl([['Current tier', esc(tier.name)],
        ['Environment', esc(env.label)+' — <code class="epurl">'+esc(env.base)+'</code>'],
        ['Rate limit', esc(tier.rate)],
        ['Monthly quota', esc(tier.quota)],
        ['Availability', esc(env.commitment)],
        ['Scopes granted', tier.scopes.map(x=>'<span class="tag">'+esc(x)+'</span>').join(' ')]])+
    (tier.env==='sandbox'
      ? banner('warning','<strong>You are on sandbox.</strong> '+esc(env.data)+' Production is granted when the '+
        'technical gate clears — '+done+' of '+TECH_CHECKS.length+' checks pass today.')
      : banner('success','<strong>You have production access.</strong> Every call is against real records and is '+
        'audited against your account.'))+
    '<h4 class="t-sub">What you can call</h4>'+
    '<div class="tablewrap"><table class="tbl"><thead><tr><th>API</th><th>Standard</th>'+
      '<th class="num">Methods</th><th>State</th></tr></thead><tbody>'+
    API_PRODUCTS.filter(a=>tier.products.indexOf(a.id)>-1).map(a=>'<tr>'+
      '<td><div class="cellmain">'+esc(a.name)+'</div><div class="cellsub">'+esc(a.blurb)+'</div></td>'+
      '<td class="t-small">'+esc(a.spec)+'</td>'+
      '<td class="num t-num">'+a.methods+'</td>'+
      '<td>'+(a.status==='ga'?pill('ok','General release')
             :a.status==='beta'?pill('warn','Beta'):pill('','Preview'))+'</td></tr>').join('')+
    '</tbody></table></div>'+
    '<div class="rowend">'+
      '<button class="btn btn-sm" onclick="downloadSamplePayload()">Sample payload</button>'+
      '<button class="btn btn-sm" onclick="apiEnvDialog()">Sandbox and production</button>'+
      '<button class="btn btn-sm" onclick="apiTiersDialog()">Access tiers</button>'+
    '</div>',
    {icon:'code', sub:tier.name+' · '+env.label});
}

/* The four checks that stand between this seller and go-live. */
function myTechMilestonePanel(){
  if(ME_P.status==='active') return '';
  return techGatePanel(ME_P.id);
}

function vPIntegrations(){
  const live=MY_ENDPOINTS.filter(e=>e.enabled);
  const failing=MY_ENDPOINTS.filter(e=>e.enabled && e.health==='failing');
  const cov=epCoverage();
  const recent=API_LOG.slice(0,7);

  return pagehead('Integrations',
    MY_ENDPOINTS.length+' endpoints registered, '+live.length+' enabled · the marketplace calls you, you never poll',
    exportBtn('Endpoints','dtEp')+
    '<button class="btn" onclick="apiKeysDialog()">'+ICO('key',13)+'API keys</button>'+
    '<button class="btn btn-primary" onclick="newEndpointDialog()">'+ICO('plus',14)+'Add an endpoint</button>')+
  '<div class="stack">'+
  myApiAccessPanel()+
  myTechMilestonePanel()+

  (failing.length
    ? banner('danger','<strong>'+esc(failing[0].name)+' is failing.</strong> '+esc(failing[0].note||'')+
      ' Until it responds, orders routed to it will not be acknowledged and your Security Marketplace application '+
      'stays at the technical gate. '+
      '<button class="linkbtn" onclick="testEndpoint(\''+failing[0].id+'\')">Send a test call</button>')
    : cov.missing.length
    ? banner('warning','<strong>'+cov.missing.length+' required event has no enabled endpoint.</strong> '+
      cov.missing.map(e=>esc(e.label)).join(', ')+' would go unhandled.')
    : banner('success','<strong>Every required event has a healthy endpoint.</strong> Nothing is falling through.'))+

  '<div class="grid g4">'+
    metric({icon:'plug',label:'Endpoints enabled',value:live.length+' of '+MY_ENDPOINTS.length,
      foot:MY_ENDPOINTS.filter(e=>e.env==='Sandbox').length+' sandbox'})+
    metric({icon:'checklist',label:'Required events covered',value:cov.covered.length+' of '+cov.required.length,
      foot:cov.missing.length?cov.missing.map(e=>e.label).join(', '):'Order created, cancelled — both handled'})+
    metric({icon:'activity',label:'Call success, last 7',
      value:FMT.pct(API_LOG.filter(l=>l.outcome==='ok').length/API_LOG.length*100),
      foot:API_LOG.filter(l=>l.outcome!=='ok').length+' failed, all on one endpoint'})+
    metric({icon:'clock',label:'Median response',
      value:(function(){const ms=API_LOG.filter(l=>l.outcome==='ok').map(l=>l.ms).sort((a,b)=>a-b);
        return ms.length?ms[Math.floor(ms.length/2)]+' ms':null;})(),
      naLabel:'No successful calls', foot:'Timeout is 5,000 ms'})+
  '</div>'+

  panel('Your endpoints', dt('dtEp',{
    rows:MY_ENDPOINTS, noun:'endpoints', pageSize:10, toolbar:false, sortKey:'name', idKey:'id',
    onRow:"openEndpoint('$ID')",
    columns:[
      {key:'name',label:'Endpoint',render:r=>'<div class="cellmain">'+esc(r.name)+'</div>'+
        '<div class="cellsub epurl">'+esc(r.method)+' '+esc(r.url)+'</div>'},
      {key:'env',label:'Environment',render:r=>r.env==='Production'?pill('active','Production'):pill('info','Sandbox')},
      {key:'events',label:'Events',sort:false,exp:r=>r.events.join('; '),
       render:r=>'<div class="tagset">'+r.events.slice(0,2).map(e=>
        '<span class="tag">'+esc((API_EVENTS.find(x=>x.id===e)||{}).label||e)+'</span>').join('')+
        (r.events.length>2?'<span class="tag">and '+(r.events.length-2)+' more</span>':'')+'</div>'},
      {key:'auth',label:'Auth',render:r=>'<span class="t-small">'+esc(r.auth)+'</span>'},
      {key:'successRate',label:'Success',align:'right',render:r=>r.successRate==null
        ? '<span class="nodata">Not called</span>'
        : '<span class="t-num'+(r.successRate<90?' cellmain':'')+'">'+r.successRate+'%</span>'},
      {key:'lastCall',label:'Last call',render:r=>r.lastCall==='Never'?'<span class="dim">Never</span>':esc(r.lastCall)},
      {key:'health',label:'Health',render:r=>epHealthPill(r)},
      {key:'enabled',label:'On',render:r=>'<label class="toggle"><input type="checkbox" '+(r.enabled?'checked':'')+
        ' onchange="event.stopPropagation();toggleEndpoint(\''+r.id+'\',this.checked)"><span class="track"></span>'+
        '<span class="sr-only">Enable '+esc(r.name)+'</span></label>'},
      {key:'__acts',label:'',sort:false,render:r=>
        '<button class="btn btn-sm btn-quiet" onclick="event.stopPropagation();testEndpoint(\''+r.id+'\')">Test</button>'+
        '<button class="btn btn-sm btn-quiet" onclick="event.stopPropagation();editEndpoint(\''+r.id+'\')">Edit</button>'}
    ]}),
    {flush:true, icon:'plug',
     sub:'One endpoint can serve several events. Splitting fulfilment from finance is usually worth it — they fail for '+
         'different reasons and are owned by different teams.'})+

  panel('Which events reach you',
    '<div class="tablewrap"><table class="tbl"><thead><tr>'+
      '<th style="min-width:230px">Event</th><th>Group</th><th>Handled by</th><th style="width:110px">State</th>'+
    '</tr></thead><tbody>'+
    API_EVENTS.map(ev=>{
      const eps=MY_ENDPOINTS.filter(e=>e.events.indexOf(ev.id)>-1);
      const on=eps.filter(e=>e.enabled);
      return '<tr><td><div class="cellmain">'+esc(ev.label)+
        (ev.required?' '+pill('overdue','Required'):'')+'</div>'+
        '<div class="cellsub">'+esc(ev.note)+'</div></td>'+
        '<td><span class="tag">'+esc(ev.group)+'</span></td>'+
        '<td>'+(eps.length
          ? eps.map(e=>'<button class="linkbtn" onclick="openEndpoint(\''+e.id+'\')">'+esc(e.name)+'</button>'+
            (e.enabled?'':' <span class="t-tiny muted">(off)</span>')).join(', ')
          : '<span class="nodata">Nothing registered</span>')+'</td>'+
        '<td>'+(on.length?pill('active','Delivered'):ev.required?pill('overdue','Unhandled'):pill('neutral','Not used'))+'</td>'+
      '</tr>';
    }).join('')+'</tbody></table></div>',
    {flush:true, icon:'checklist',
     sub:'An event with no enabled endpoint is not queued and not retried later — it simply does not reach you.'})+

  panel('Recent calls', dt('dtApiLog',{
    rows:API_LOG, noun:'calls', pageSize:10, toolbar:false, sortKey:'id', sortDir:'desc', idKey:'id',
    onRow:"openApiCall('$ID')",
    columns:[
      {key:'when',label:'When',render:r=>esc(r.when)},
      {key:'ep',label:'Endpoint',render:r=>esc((epFor(r.ep)||{}).name||r.ep)},
      {key:'event',label:'Event',render:r=>'<span class="t-small">'+
        esc((API_EVENTS.find(x=>x.id===r.event)||{}).label||r.event)+'</span>'},
      {key:'attempt',label:'Attempt',align:'right',render:r=>'<span class="t-num">'+r.attempt+'</span>'},
      {key:'status',label:'Response',align:'right',render:r=>'<span class="t-num'+
        (r.outcome==='ok'?'':' cellmain')+'">'+r.status+'</span>'},
      {key:'ms',label:'Took',align:'right',render:r=>'<span class="t-num">'+FMT.num(r.ms)+' ms</span>'},
      {key:'outcome',label:'Outcome',render:r=>r.outcome==='ok'?pill('approved','Accepted'):pill('rejected','Failed')},
      {key:'detail',label:'Detail',render:r=>'<span class="t-small">'+esc(r.detail)+'</span>'}
    ]}),
    {flush:true, icon:'history',
     sub:'Every call the marketplace made to you, with the response it got. This is the log to open before saying '+
         '"we never received it".',
     acts:exportBtn('API call log','dtApiLog')})+
  '</div>';
}

/* --------------------------- endpoint detail ------------------------------ */
function samplePayload(ev){
  const body = ev==='order.created' ? {
      event:'order.created', id:'evt_01J8ZQ', sent:'2026-07-25T09:14:22Z',
      order:{ref:'ORD-882431', placed:'2026-07-25T09:14:20Z', marketplace:'security',
             buyer:{type:'enterprise', name:'Brightline Foods', country:'IN'},
             lines:[{sku:'SKU-6001', name:'Sentinel MDR Essentials', qty:40, unit:323.00, currency:'USD'}],
             gross:12920.00, currency:'USD', fulfilBy:'2026-07-29T17:00:00Z'},
      callback:'https://api.aventa.example/v1/orders/ORD-882431/status'
    } : ev==='settlement.ready' ? {
      event:'settlement.ready', id:'evt_01J8ZR', sent:'2026-07-25T06:00:00Z',
      statement:{ref:'SB-2026-1003-1042', period:'Jul 2026', gross:41344.00,
                 commission:7441.92, fees:806.54, net:33095.54, currency:'USD', due:'2026-08-15'}
    } : {
      event:ev, id:'evt_01J8ZS', sent:'2026-07-25T09:14:22Z',
      note:'Payload shape depends on the event. See the integration guide.'
    };
  return JSON.stringify(body,null,2);
}
function openEndpoint(id){
  const ep=epFor(id); if(!ep) return;
  const calls=API_LOG.filter(l=>l.ep===id);
  const fails=calls.filter(l=>l.outcome!=='ok');
  openInspector(
    '<div class="insp-head">'+ICO('plug',18)+'<div class="grow">'+
      '<div class="row" style="gap:6px">'+epHealthPill(ep)+
        (ep.env==='Sandbox'?pill('info','Sandbox'):pill('active','Production'))+'</div>'+
      '<h3 class="t-sub" style="margin-top:5px">'+esc(ep.name)+'</h3>'+
      '<div class="t-small muted epurl">'+esc(ep.method)+' '+esc(ep.url)+'</div></div>'+
      '<button class="iconbtn" onclick="closeInspector()" aria-label="Close">'+ICO('x',16)+'</button></div>'+
    '<div class="insp-body stack">'+
      (ep.note?banner(ep.health==='failing'?'danger':'info','<strong>'+esc(ep.note)+'</strong>'):'')+
      '<dl class="deflist">'+
        '<dt>Authentication</dt><dd>'+esc(ep.auth)+'<div class="t-tiny muted">'+esc(ep.authDetail||'')+'</div></dd>'+
        '<dt>Retries</dt><dd>'+esc(ep.retry)+'</dd>'+
        '<dt>Timeout</dt><dd>'+FMT.num(ep.timeoutMs)+' ms</dd>'+
        '<dt>Success rate</dt><dd>'+(ep.successRate==null
          ? '<span class="nodata">Never called</span>' : ep.successRate+'% of recent calls')+'</dd>'+
        '<dt>Last call</dt><dd>'+esc(ep.lastCall)+'</dd>'+
      '</dl>'+
      '<div class="divider"></div><h4 class="t-sub">Events sent here</h4>'+
      '<div class="stack" style="gap:7px">'+ep.events.map(e=>{
        const ev=API_EVENTS.find(x=>x.id===e)||{label:e,note:''};
        return '<div><div class="t-small strong">'+esc(ev.label)+
          ' <span class="t-tiny muted t-num">'+esc(e)+'</span></div>'+
          '<div class="t-tiny muted">'+esc(ev.note)+'</div></div>';
      }).join('')+'</div>'+
      '<div class="divider"></div><h4 class="t-sub">What we send</h4>'+
      '<div class="codeblock">'+esc(samplePayload(ep.events[0]))+'</div>'+
      '<div class="t-tiny muted">Respond 2xx within '+FMT.num(ep.timeoutMs)+' ms to acknowledge. Anything else is '+
        'retried per your policy, then surfaced in the portal for manual fulfilment.</div>'+
      (calls.length
        ? '<div class="divider"></div><h4 class="t-sub">Last calls</h4>'+
          '<table class="tbl"><tbody>'+calls.slice(0,5).map(c=>
            '<tr><td><div class="cellmain">'+esc((API_EVENTS.find(x=>x.id===c.event)||{}).label||c.event)+'</div>'+
            '<div class="cellsub">'+esc(c.when)+' · attempt '+c.attempt+'</div></td>'+
            '<td class="num" style="width:72px"><span class="t-num">'+c.status+'</span></td>'+
            '<td style="width:92px">'+(c.outcome==='ok'?pill('approved','Accepted'):pill('rejected','Failed'))+'</td>'+
            '</tr>').join('')+'</tbody></table>'+
          (fails.length?'<div class="t-tiny muted" style="margin-top:6px">'+fails.length+' of the last '+calls.length+
            ' failed. '+esc(fails[0].detail)+'</div>':'')
        : '')+
    '</div>'+
    '<div class="insp-foot"><button class="btn btn-quiet" onclick="closeInspector()">Close</button>'+
      '<div class="spacer"></div>'+
      '<button class="btn btn-sm" onclick="testEndpoint(\''+ep.id+'\')">'+ICO('send',13)+'Send a test call</button>'+
      '<button class="btn btn-sm btn-primary" onclick="closeInspector();editEndpoint(\''+ep.id+'\')">Edit</button>'+
    '</div>','Endpoint '+ep.name);
}
function openApiCall(id){
  const c=API_LOG.find(x=>x.id===id); if(!c) return;
  const ep=epFor(c.ep);
  openInspector(
    '<div class="insp-head">'+ICO('code',18)+'<div class="grow">'+
      '<div class="row" style="gap:6px">'+(c.outcome==='ok'?pill('approved','Accepted'):pill('rejected','Failed'))+
      '<span class="tag t-num">HTTP '+c.status+'</span></div>'+
      '<h3 class="t-sub" style="margin-top:5px">'+esc((API_EVENTS.find(x=>x.id===c.event)||{}).label||c.event)+'</h3>'+
      '<div class="t-small muted t-num">'+esc(c.id)+' · '+esc(c.when)+'</div></div>'+
      '<button class="iconbtn" onclick="closeInspector()" aria-label="Close">'+ICO('x',16)+'</button></div>'+
    '<div class="insp-body stack">'+
      '<dl class="deflist">'+
        '<dt>Endpoint</dt><dd>'+esc(ep?ep.name:c.ep)+'<div class="t-tiny muted epurl">'+
          esc(ep?ep.url:'')+'</div></dd>'+
        '<dt>Attempt</dt><dd>'+c.attempt+' of '+(ep?ep.retry:'—')+'</dd>'+
        '<dt>Response</dt><dd class="t-num">HTTP '+c.status+' in '+FMT.num(c.ms)+' ms</dd>'+
        '<dt>Detail</dt><dd>'+esc(c.detail)+'</dd>'+
      '</dl>'+
      '<div class="divider"></div><h4 class="t-sub">Request body</h4>'+
      '<div class="codeblock">'+esc(samplePayload(c.event))+'</div>'+
      (c.outcome!=='ok'
        ? banner('warning','<strong>What happens next.</strong> This attempt failed, so the marketplace retried per your '+
          'policy. Once retries are exhausted the order appears in your portal for manual fulfilment and the clock '+
          'keeps running — a failed webhook does not pause your service commitment.')
        : '')+
    '</div>'+
    '<div class="insp-foot"><button class="btn btn-quiet" onclick="closeInspector()">Close</button>'+
      '<div class="spacer"></div>'+
      (ep?'<button class="btn btn-sm btn-primary" onclick="closeInspector();testEndpoint(\''+ep.id+'\')">'+
        'Replay against '+esc(ep.name)+'</button>':'')+
    '</div>','Call '+c.id);
}

/* --------------------------- add and edit --------------------------------- */
function endpointForm(ep){
  ep=ep||{};
  const evs={};
  API_EVENTS.forEach(e=>{ (evs[e.group]=evs[e.group]||[]).push(e); });
  return '<div class="grid g2">'+
      '<div class="field"><label for="epName">Name</label>'+
        '<input class="inp" id="epName" value="'+esc(ep.name||'')+'" data-autofocus '+
        'placeholder="What this endpoint is for, in your words">'+
        '<div class="err" id="epNameErr" hidden>'+ICO('alert',12)+'An endpoint needs a name you will recognise later.</div></div>'+
      '<div class="field"><label for="epEnv">Environment</label><select class="inp" id="epEnv">'+
        ['Production','Sandbox'].map(o=>'<option'+(ep.env===o?' selected':'')+'>'+o+'</option>').join('')+'</select></div>'+
    '</div>'+
    '<div class="grid g-1-3">'+
      '<div class="field"><label for="epMethod">Method</label><select class="inp" id="epMethod">'+
        ['POST','PUT','GET'].map(o=>'<option'+(ep.method===o?' selected':'')+'>'+o+'</option>').join('')+'</select></div>'+
      '<div class="field"><label for="epUrl">URL</label>'+
        '<input class="inp epurl" id="epUrl" value="'+esc(ep.url||'')+'" placeholder="https://api.yourdomain.example/marketplace/fulfil">'+
        '<div class="err" id="epUrlErr" hidden>'+ICO('alert',12)+
          'An HTTPS URL is required. Plain HTTP is refused — order payloads carry buyer data.</div></div>'+
    '</div>'+
    '<div class="grid g2">'+
      '<div class="field"><label for="epAuth">Authentication</label><select class="inp" id="epAuth">'+
        API_AUTH.map(o=>'<option'+(ep.auth===o?' selected':'')+'>'+esc(o)+'</option>').join('')+'</select>'+
        '<div class="hint">None is accepted only on sandbox.</div></div>'+
      '<div class="field"><label for="epAuthDetail">Credential reference</label>'+
        '<input class="inp" id="epAuthDetail" value="'+esc(ep.authDetail||'')+'" '+
        'placeholder="Client id, header name or key id — never the secret itself">'+
        '<div class="hint">Secrets are held in the vault and never displayed once saved.</div></div>'+
    '</div>'+
    '<div class="grid g2">'+
      '<div class="field"><label for="epRetry">Retry policy</label><select class="inp" id="epRetry">'+
        API_RETRY.map(o=>'<option'+(ep.retry===o?' selected':'')+'>'+esc(o)+'</option>').join('')+'</select></div>'+
      '<div class="field"><label for="epTimeout">Timeout (ms)</label>'+
        '<input class="inp" id="epTimeout" type="number" min="500" max="30000" step="500" '+
        'value="'+(ep.timeoutMs||5000)+'">'+
        '<div class="hint">We wait this long for a 2xx. Longer is not safer — it just delays the retry.</div></div>'+
    '</div>'+
    '<div><div class="t-small strong" style="margin-bottom:7px">Events to send here</div>'+
      Object.keys(evs).map(g=>
        '<div style="margin-bottom:9px"><div class="t-tiny muted" style="margin-bottom:4px">'+esc(g)+'</div>'+
        '<div class="stack" style="gap:5px">'+evs[g].map(e=>
          '<label class="checkline"><input type="checkbox" class="epEv" value="'+e.id+'" '+
          ((ep.events||[]).indexOf(e.id)>-1?'checked':'')+'>'+
          '<span><span class="t-small">'+esc(e.label)+(e.required?' — required':'')+'</span><br>'+
          '<span class="t-tiny muted">'+esc(e.note)+'</span></span></label>').join('')+'</div></div>').join('')+
      '<div class="err" id="epEvErr" hidden>'+ICO('alert',12)+
        'Pick at least one event, or this endpoint is never called.</div></div>';
}
function newEndpointDialog(){
  openModal('<div class="modal-head">'+ICO('plug',18)+'<div class="grow"><h3 class="t-sub">Add an endpoint</h3>'+
    '<div class="t-small muted">Where the marketplace should call you, and what it should tell you about.</div></div>'+
    '<button class="iconbtn" onclick="closeModal()" aria-label="Close">'+ICO('x',16)+'</button></div>'+
    '<div class="modal-body stack">'+
      endpointForm({env:'Production',method:'POST',auth:API_AUTH[0],retry:API_RETRY[1],timeoutMs:5000,events:[]})+
      '<div class="impact"><strong>How this works</strong><ul>'+
        '<li>The marketplace calls you. You never poll — there is no order queue to drain.</li>'+
        '<li>Respond 2xx to acknowledge. Anything else is retried per your policy.</li>'+
        '<li>When retries are exhausted the order appears in your portal for manual fulfilment, and your service '+
          'commitment keeps running. A broken webhook is your problem to notice, which is why the log is on this screen.</li>'+
        '<li>A new endpoint starts disabled. Test it, then enable it.</li></ul></div>'+
    '</div>'+
    '<div class="modal-foot"><span class="t-tiny muted grow">Registered endpoints are reusable across listings.</span>'+
      '<button class="btn btn-quiet" onclick="closeModal()">Cancel</button>'+
      '<button class="btn btn-primary" onclick="submitEndpoint(null)">Add endpoint</button></div>',
    {wide:true,label:'Add an endpoint'});
}
function editEndpoint(id){
  const ep=epFor(id); if(!ep) return;
  closeInspector();
  openModal('<div class="modal-head">'+ICO('plug',18)+'<div class="grow"><h3 class="t-sub">'+esc(ep.name)+'</h3>'+
    '<div class="t-small muted t-num">'+esc(ep.id)+' · '+esc(ep.env)+'</div></div>'+
    '<button class="iconbtn" onclick="closeModal()" aria-label="Close">'+ICO('x',16)+'</button></div>'+
    '<div class="modal-body stack">'+
      endpointForm(ep)+
      (MY_ENDPOINTS.filter(e=>e.enabled).length===1 && ep.enabled
        ? banner('warning','<strong>This is your only enabled endpoint.</strong> Disabling it sends every order to the '+
          'portal for manual handling.')
        : '')+
    '</div>'+
    '<div class="modal-foot">'+
      '<button class="btn btn-quiet" onclick="closeModal()">Cancel</button>'+
      '<button class="btn btn-sm btn-danger" onclick="deleteEndpoint(\''+id+'\')">Delete</button>'+
      '<div class="spacer"></div>'+
      '<button class="btn btn-sm" onclick="closeModal();testEndpoint(\''+id+'\')">Test</button>'+
      '<button class="btn btn-primary" onclick="submitEndpoint(\''+id+'\')">Save</button></div>',
    {wide:true,label:'Edit '+ep.name});
}
function submitEndpoint(id){
  const g=k=>document.getElementById(k);
  const name=(g('epName').value||'').trim();
  const url=(g('epUrl').value||'').trim();
  const events=Array.prototype.slice.call(document.querySelectorAll('.epEv')).filter(c=>c.checked).map(c=>c.value);
  const badName=!name;
  const badUrl=!/^https:\/\/[^\s]+\.[^\s]+/.test(url);
  const badEv=!events.length;
  g('epNameErr').hidden=!badName; g('epUrlErr').hidden=!badUrl; g('epEvErr').hidden=!badEv;
  if(badName||badUrl||badEv){ (badName?g('epName'):badUrl?g('epUrl'):g('epEv')||g('epUrl')).focus(); return; }
  const auth=g('epAuth').value, env=g('epEnv').value;
  if(auth==='None' && env==='Production'){
    toast('Unauthenticated endpoints are not accepted in production — order payloads carry buyer data','warn');
    return;
  }
  const data={name:name, url:url, method:g('epMethod').value, env:env, auth:auth,
              authDetail:(g('epAuthDetail').value||'').trim(),
              retry:g('epRetry').value, timeoutMs:parseInt(g('epTimeout').value,10)||5000,
              events:events};
  closeModal();
  if(id){
    const ep=epFor(id);
    Object.assign(ep,data);
    App.go(App.view);
    toast(ep.name+' saved — '+events.length+' event'+(events.length===1?'':'s')+', '+esc(ep.retry).toLowerCase());
  } else {
    const ep=addEndpoint(data);
    App.go(App.view);
    toast(ep.name+' added and left disabled. Send a test call, then enable it.');
  }
}
function addEndpoint(data){
  SEQ.endpoint=(SEQ.endpoint||0)+1;
  const ep=Object.assign({id:'EP-N'+SEQ.endpoint, enabled:false, health:'unknown',
                          lastCall:'Never', successRate:null, note:null, isNew:true}, data);
  MY_ENDPOINTS.push(ep);
  return ep;
}
function toggleEndpoint(id,on){
  const ep=epFor(id); if(!ep) return;
  if(!on){
    const stillCovered = API_EVENTS.filter(e=>e.required)
      .every(e=>MY_ENDPOINTS.some(x=>x!==ep && x.enabled && x.events.indexOf(e.id)>-1));
    confirmAction({
      title:'Disable '+ep.name, subtitle:ep.events.length+' events · '+ep.env,
      risk:stillCovered?'normal':'high', confirmLabel:'Disable',
      impact:[stillCovered
                ? 'Another enabled endpoint still covers the required events.'
                : '<strong>No other endpoint covers the required events.</strong> Orders will arrive only in the portal, and someone has to watch it.',
              'Calls already in flight finish. Nothing is queued for later.',
              'Listings pointed at this endpoint fall back to manual fulfilment.',
              'Your service commitment is unaffected — the clock keeps running.'],
      onConfirm:()=>{ ep.enabled=false; App.go(App.view);
        toast(ep.name+' disabled — orders now go to the portal','warn'); }
    });
    App.go(App.view);   /* restore the toggle until the dialog is answered */
    return;
  }
  ep.enabled=true;
  App.go(App.view);
  toast(ep.name+' enabled'+(ep.health==='failing'?' — but it is still failing. Test it before you rely on it.':''));
}
function deleteEndpoint(id){
  const ep=epFor(id); if(!ep) return;
  closeModal();
  const used=NL.endpoint===id;
  confirmAction({
    title:'Delete '+ep.name, subtitle:esc(ep.url),
    risk:'high', confirmLabel:'Delete the endpoint', requireType:'DELETE',
    impact:['The marketplace stops calling this URL immediately.',
            used?'A listing in your draft wizard points at it and will fall back to manual fulfilment.'
                :'Any listing pointed at it falls back to manual fulfilment.',
            'The call history stays — deleting an endpoint does not rewrite what was already sent.',
            'If you only want it quiet, disable it instead.'],
    onConfirm:()=>{
      const i=MY_ENDPOINTS.indexOf(ep);
      if(i>-1) MY_ENDPOINTS.splice(i,1);
      if(NL.endpoint===id) NL.endpoint=null;
      App.go(App.view);
      toast(ep.name+' deleted','warn');
    }
  });
}
/* A test call is the only way to know whether an endpoint works, so it is a
   first-class action rather than buried in a settings page. */
function testEndpoint(id){
  const ep=epFor(id); if(!ep) return;
  const ev=ep.events[0]||'order.created';
  closeInspector();
  openModal('<div class="modal-head">'+ICO('send',18)+'<div class="grow"><h3 class="t-sub">Test '+esc(ep.name)+'</h3>'+
    '<div class="t-small muted epurl">'+esc(ep.method)+' '+esc(ep.url)+'</div></div>'+
    '<button class="iconbtn" onclick="closeModal()" aria-label="Close">'+ICO('x',16)+'</button></div>'+
    '<div class="modal-body stack">'+
      '<div class="field"><label for="tcEvent">Event to simulate</label><select class="inp" id="tcEvent" data-autofocus>'+
        (ep.events.length?ep.events:['order.created']).map(e=>'<option value="'+e+'"'+(e===ev?' selected':'')+'>'+
          esc((API_EVENTS.find(x=>x.id===e)||{}).label||e)+'</option>').join('')+'</select></div>'+
      '<div><div class="t-small strong" style="margin-bottom:6px">Body we will send</div>'+
        '<div class="codeblock">'+esc(samplePayload(ev))+'</div></div>'+
      banner('info','A test call carries <strong>test</strong> in the event id and a reference that begins '+
        '<span class="t-num">ORD-TEST</span>. Nothing is charged, no buyer exists, and your fulfilment system should '+
        'recognise it and stop. If it does not, that is worth knowing before a real order arrives.')+
      '<div id="tcResult"></div>'+
    '</div>'+
    '<div class="modal-foot"><span class="t-tiny muted grow">Test calls are not retried.</span>'+
      '<button class="btn btn-quiet" onclick="closeModal()">Close</button>'+
      '<button class="btn btn-primary" id="tcGo" onclick="runEndpointTest(\''+id+'\')">Send the test call</button></div>',
    {wide:true,label:'Test '+ep.name});
}
function runEndpointTest(id){
  const ep=epFor(id); if(!ep) return;
  const box=document.getElementById('tcResult');
  const btn=document.getElementById('tcGo');
  if(btn){ btn.disabled=true; btn.textContent='Calling…'; }
  if(box) box.innerHTML='<div class="t-small muted">Calling '+esc(ep.url)+'…</div>';
  /* The outcome follows the endpoint's real state rather than being random —
     a demo where the broken endpoint sometimes passes teaches the wrong thing. */
  setTimeout(()=>{
    const ok = ep.health!=='failing';
    const ms = ok ? 180+Math.round(ep.timeoutMs/24) : ep.timeoutMs;
    const status = ok ? 200 : 500;
    SEQ.call=(SEQ.call||0)+1;
    API_LOG.unshift({id:'CALL-T'+SEQ.call, ep:ep.id, event:(document.getElementById('tcEvent')||{}).value||ep.events[0],
      when:'Just now', status:status, ms:ms, attempt:1, outcome:ok?'ok':'failed',
      detail: ok ? 'Test accepted — your system acknowledged it' : 'Internal Server Error, empty body'});
    ep.lastCall='Just now';
    if(ok && ep.health==='unknown') ep.health='healthy';
    const box2=document.getElementById('tcResult');
    if(box2){
      box2.innerHTML = ok
        ? banner('success','<strong>HTTP 200 in '+ms+' ms.</strong> Your endpoint acknowledged the test. '+
            'It is safe to enable and point listings at.')
        : banner('danger','<strong>HTTP 500 after '+FMT.num(ms)+' ms.</strong> '+esc(ep.note||'The endpoint did not accept the call.')+
            ' Until this returns 2xx, orders routed here will fall through to manual fulfilment.');
    }
    const b=document.getElementById('tcGo');
    if(b){ b.disabled=false; b.textContent='Send another'; }
    toast(ok ? ep.name+' responded 200 in '+ms+' ms' : ep.name+' failed with HTTP 500', ok?undefined:'warn');
  },420);
}

/* --------------------------- inbound API keys ----------------------------- */
function apiKeysDialog(){
  openModal('<div class="modal-head">'+ICO('key',18)+'<div class="grow"><h3 class="t-sub">API keys</h3>'+
    '<div class="t-small muted">What you use to call the marketplace — order status, catalogue and settlement reads.</div></div>'+
    '<button class="iconbtn" onclick="closeModal()" aria-label="Close">'+ICO('x',16)+'</button></div>'+
    '<div class="modal-body stack">'+
      banner('info','These are the reverse of your endpoints. Your endpoints are how we reach you; these keys are how '+
        'you reach us — chiefly to push an order to <span class="t-num">delivered</span> once you have fulfilled it.')+
      '<div class="tablewrap"><table class="tbl"><thead><tr><th>Key</th><th>Scopes</th>'+
        '<th>Created</th><th>Last used</th><th>State</th><th></th></tr></thead><tbody>'+
      MY_API_KEYS.map(k=>'<tr><td><div class="cellmain">'+esc(k.label)+'</div>'+
        '<div class="cellsub t-num">'+esc(k.prefix)+'••••••••</div></td>'+
        '<td><div class="tagset">'+k.scopes.map(sc=>'<span class="tag t-num">'+esc(sc)+'</span>').join('')+'</div></td>'+
        '<td class="t-small">'+esc(k.created)+'</td>'+
        '<td class="t-small">'+esc(k.lastUsed)+'</td>'+
        '<td>'+(k.status==='active'?pill('active','Active'):pill('rejected','Revoked'))+'</td>'+
        '<td class="acts">'+(k.status==='active'
          ? '<button class="btn btn-sm btn-quiet" onclick="revokeApiKey(\''+k.id+'\')">Revoke</button>'
          : '<span class="t-tiny muted">—</span>')+'</td></tr>').join('')+
      '</tbody></table></div>'+
      '<div class="t-tiny muted">A key is shown once, when it is created. We store a hash, so a lost key is replaced '+
        'rather than recovered.</div>'+
    '</div>'+
    '<div class="modal-foot"><span class="t-tiny muted grow">'+
      MY_API_KEYS.filter(k=>k.status==='active').length+' active keys.</span>'+
      '<button class="btn btn-quiet" onclick="closeModal()">Close</button>'+
      '<button class="btn btn-primary" onclick="createApiKey()">'+ICO('plus',14)+'Create a key</button></div>',
    {wide:true,label:'API keys'});
}
function createApiKey(){
  closeModal();
  confirmAction({
    title:'Create an API key', subtitle:'Shown once. Store it before you close the dialog.',
    confirmLabel:'Create the key',
    body:'<div class="field"><label for="akLabel">What it is for</label>'+
      '<input class="inp" id="akLabel" data-autofocus placeholder="e.g. Production order updates"></div>'+
      '<div class="field"><label>Scopes</label><div class="stack" style="gap:5px;margin-top:4px">'+
      API_SCOPES.map((sc,i)=>'<label class="checkline"><input type="checkbox" id="akSc_'+i+'" value="'+esc(sc)+'" '+
        (sc==='orders:write'||sc==='catalogue:read'?'checked':'')+'> <span class="t-num t-small">'+esc(sc)+'</span></label>').join('')+
      '</div></div>',
    impact:['The key is displayed once and never again — we keep only a hash.',
            'Scope it to what the integration actually needs. A read-only key cannot be used to change an order.',
            'Revoking is immediate and cannot be undone.'],
    onConfirm:(v)=>{
      const label=(v&&v.akLabel||'').trim()||'Untitled key';
      const scopes=API_SCOPES.filter((sc,i)=>v&&v['akSc_'+i]);
      SEQ.key=(SEQ.key||0)+1;
      const k={id:'KEY-N'+SEQ.key, label:label, prefix:'mk_live_'+Math.random().toString(36).slice(2,6),
               created:TODAY, lastUsed:'Never', scopes:scopes.length?scopes:['orders:write'], status:'active'};
      MY_API_KEYS.unshift(k);
      App.go(App.view);
      toast(label+' created — '+k.prefix+'•••• · copy it now, it will not be shown again');
    }
  });
}
function revokeApiKey(id){
  const k=MY_API_KEYS.find(x=>x.id===id); if(!k) return;
  closeModal();
  confirmAction({
    title:'Revoke '+k.label, subtitle:k.prefix+'•••• · last used '+k.lastUsed,
    risk:'high', confirmLabel:'Revoke the key', requireType:'REVOKE',
    impact:['Any system still using this key starts failing immediately.',
            k.lastUsed==='Never'||/ago|min|h /.test(k.lastUsed)
              ? '<strong>It was used recently</strong>, so something is almost certainly still using it.'
              : 'It has not been used for a while, which is usually a sign it is safe to revoke.',
            'This cannot be undone. Create a replacement first if the integration is live.'],
    onConfirm:()=>{ k.status='revoked'; App.go(App.view); toast(k.label+' revoked','warn'); }
  });
}

/* ===========================================================================
   15. BRANDING — the seller's own console  (PMP · PRD §4.1)
   =========================================================================== */
/* Contrast is checked rather than trusted. A seller picking their corporate
   yellow should be told it fails, not discover it from a complaint. */
function hexLum(h){
  h=String(h||'').replace('#','');
  if(h.length!==6) return 1;
  const c=[0,2,4].map(i=>{
    const v=parseInt(h.substr(i,2),16)/255;
    return v<=0.03928 ? v/12.92 : Math.pow((v+0.055)/1.055,2.4);
  });
  return 0.2126*c[0]+0.7152*c[1]+0.0722*c[2];
}
function contrast(a,b){
  const la=hexLum(a), lb=hexLum(b);
  return +(((Math.max(la,lb)+0.05)/(Math.min(la,lb)+0.05))).toFixed(2);
}
function contrastVerdict(c,large){
  const need=large?3:4.5;
  return c>=7 ? {pill:pill('active','AAA · '+c+':1'), ok:true}
       : c>=need ? {pill:pill('approved','AA · '+c+':1'), ok:true}
       : {pill:pill('rejected','Fails · '+c+':1'), ok:false};
}
function brandApply(){
  const b=MY_BRAND;
  let st=document.getElementById('brandStyle');
  if(!st){ st=document.createElement('style'); st.id='brandStyle'; document.head.appendChild(st); }
  if(!b.applied){ st.textContent=''; document.body.removeAttribute('data-partner-theme'); return; }
  st.textContent =
    ':root{--nim-primary-500:'+b.primary+';--nim-primary-600:'+b.primary+';'+
      '--brand-rail:'+b.rail+';--nim-ai-orange-500:'+b.accent+';}'+
    '.btn-primary{background:'+b.primary+';border-color:'+b.primary+'}'+
    '.nav-item[aria-current="page"]{border-left-color:'+b.primary+'}';
  document.body.setAttribute('data-partner-theme', b.theme);
}
function vPBranding(){
  const b=MY_BRAND;
  const cPrimary=contrast(b.primary,'#FFFFFF');
  const cRail=contrast('#FFFFFF',b.rail);
  const vp=contrastVerdict(cPrimary,false), vr=contrastVerdict(cRail,false);
  const hidden=BRAND_WIDGETS.filter(w=>!b.widgets[w.id]);
  const locked=BRAND_WIDGETS.filter(w=>w.locked);

  return pagehead('Branding',
    'Your console, in your livery. This does not change what buyers see.',
    '<button class="btn" onclick="resetBrand()">Reset to marketplace default</button>'+
    '<button class="btn btn-primary" onclick="saveBrand()">'+ICO('check',14)+'Apply</button>')+
  '<div class="stack">'+

  banner('info','<strong>This styles your console only.</strong> The storefront a buyer sees stays in the '+
    'marketplace\'s own livery — a checkout that restyles itself per seller is not a marketplace, it is a '+
    'collection of shops that happen to share a domain. Your name and logo do appear on your listings and on '+
    'the order confirmations your buyers receive.')+

  '<div class="grid g-2-1">'+
    panel('Identity',
      '<div class="grid g2">'+
        '<div class="field"><label for="brName">Display name</label>'+
          '<input class="inp" id="brName" value="'+esc(b.displayName)+'" placeholder="'+esc(ME_P.name)+'" '+
          'oninput="MY_BRAND.displayName=this.value">'+
          '<div class="hint">Shown in your console header. Buyers always see your registered name, '+
          '<strong>'+esc(ME_P.name)+'</strong>, on listings and invoices.</div></div>'+
        '<div class="field"><label for="brTheme">Theme</label>'+
          '<select class="inp" id="brTheme" onchange="MY_BRAND.theme=this.value;App.go(\'branding\')">'+
          [['light','Light'],['dark','Dark']].map(o=>'<option value="'+o[0]+'"'+
            (b.theme===o[0]?' selected':'')+'>'+o[1]+'</option>').join('')+'</select>'+
          '<div class="hint">Applies to your console for everyone on your team who has not overridden it.</div></div>'+
      '</div>'+
      '<div class="divider"></div>'+
      '<div class="field"><label>Logo</label>'+
        '<div class="dropzone'+(b.logo?' is-full':'')+'">'+
          ICO('image',20)+
          '<div class="t-small" style="margin-top:6px">'+
            (b.logo ? esc(b.logo)+' — uploaded' : 'Drop a logo, or add one:')+'</div>'+
          '<div class="row" style="gap:7px;justify-content:center;margin-top:9px">'+
            '<button class="btn btn-sm" onclick="brandAddLogo()">'+ICO('upload',13)+
              (b.logo?'Replace':'Add a logo')+'</button>'+
            (b.logo?'<button class="btn btn-sm btn-quiet" onclick="brandRemoveLogo()">Remove</button>':'')+
          '</div>'+
          '<div class="t-tiny muted" style="margin-top:8px">SVG or PNG · at least 240px wide · transparent background</div>'+
        '</div></div>'+
      (b.logo
        ? '<div class="field" style="margin-top:10px"><label for="brAlt">Logo alt text</label>'+
          '<input class="inp" id="brAlt" value="'+esc(b.logoAlt)+'" '+
          'placeholder="e.g. Sentinel Cyber logo" oninput="MY_BRAND.logoAlt=this.value">'+
          (String(b.logoAlt||'').trim()?'':'<div class="err" hidden="false">'+ICO('alert',12)+
            'Required before the logo can be applied.</div>')+'</div>'
        : '')+
      '<div class="divider"></div>'+
      '<div class="field"><label for="brPreset">Colour preset</label>'+
        '<select class="inp" id="brPreset" onchange="brandPreset(this.value)">'+
        BRAND_PRESETS.map(p=>'<option value="'+p.id+'"'+(b.preset===p.id?' selected':'')+'>'+
          esc(p.name)+'</option>').join('')+
        '<option value="custom"'+(b.preset==='custom'?' selected':'')+'>Custom</option></select></div>'+
      '<div class="grid g3">'+
        '<div class="field"><label for="brPrimary">Primary</label>'+
          '<input class="inp" id="brPrimary" type="color" value="'+esc(b.primary)+'" '+
          'onchange="brandColour(\'primary\',this.value)"></div>'+
        '<div class="field"><label for="brAccent">Accent</label>'+
          '<input class="inp" id="brAccent" type="color" value="'+esc(b.accent)+'" '+
          'onchange="brandColour(\'accent\',this.value)"></div>'+
        '<div class="field"><label for="brRail">Navigation</label>'+
          '<input class="inp" id="brRail" type="color" value="'+esc(b.rail)+'" '+
          'onchange="brandColour(\'rail\',this.value)"></div>'+
      '</div>',
      {icon:'settings'})+

    panel('Contrast',
      '<div class="stack" style="gap:11px">'+
        '<div class="row"><div class="grow"><div class="t-small strong">White text on your primary</div>'+
          '<div class="t-tiny muted">Buttons and links in your console</div></div>'+vp.pill+'</div>'+
        '<div class="row"><div class="grow"><div class="t-small strong">White text on your navigation</div>'+
          '<div class="t-tiny muted">The left rail</div></div>'+vr.pill+'</div>'+
      '</div>'+
      (vp.ok && vr.ok
        ? banner('success','<strong>Both pass WCAG 2.2 AA.</strong> Your palette is legible for everyone on '+
          'your team, including anyone with low vision.')
        : banner('danger','<strong>This palette fails the accessibility floor.</strong> A colour below 4.5:1 for '+
          'body text is unreadable for a meaningful number of people. It cannot be applied — pick a darker '+
          'primary or a lighter one and let the platform invert the text.'))+
      '<div class="divider"></div>'+
      '<div class="t-small strong" style="margin-bottom:7px">Preview</div>'+
      '<div style="border:1px solid var(--nim-border);border-radius:8px;overflow:hidden">'+
        '<div style="background:'+esc(b.rail)+';color:#FFF;padding:10px 12px;font-size:12px;font-weight:500">'+
          esc(b.displayName||ME_P.name)+'</div>'+
        '<div style="padding:12px;background:var(--nim-surface-0)">'+
          '<div class="t-small" style="margin-bottom:9px">A button in your palette:</div>'+
          '<span class="btn btn-primary" style="background:'+esc(b.primary)+';border-color:'+esc(b.primary)+
            ';pointer-events:none">Publish listing</span>'+
          '<div class="t-tiny muted" style="margin-top:9px">Accent is reserved for AARYA surfaces and never '+
          'becomes a filled button, whatever colour you choose.</div>'+
        '</div>'+
      '</div>',
      {icon:'eye'})+
  '</div>'+

  panel('Dashboard cards',
    '<p class="t-body" style="margin:0 0 11px">Choose what your team sees first. Three cards cannot be hidden, '+
    'because hiding them does not make the work go away.</p>'+
    '<div class="grid g2">'+
      ['Commercial','Operations','Catalogue','Insight','Technical'].filter(g=>
        BRAND_WIDGETS.some(w=>w.group===g)).map(g=>
      '<div><div class="t-tiny muted" style="margin-bottom:6px">'+esc(g)+'</div>'+
      '<div class="stack" style="gap:6px">'+BRAND_WIDGETS.filter(w=>w.group===g).map(w=>
        '<label class="checkline'+(w.locked?' is-locked':'')+'">'+
        '<input type="checkbox" '+(b.widgets[w.id]?'checked':'')+(w.locked?' disabled':'')+
        ' onchange="brandWidget(\''+w.id+'\',this.checked)">'+
        '<span><span class="t-small">'+esc(w.label)+'</span>'+
        (w.locked?'<br><span class="t-tiny muted">'+esc(w.why)+'</span>':'')+'</span></label>').join('')+
      '</div></div>').join('')+
    '</div>'+
    '<div class="divider"></div>'+
    '<div class="row"><span class="t-small muted grow">'+
      (hidden.length?hidden.length+' card'+(hidden.length===1?'':'s')+' hidden · ':'')+
      locked.length+' cannot be hidden</span></div>',
    {icon:'dashboard'})+

  panel('Scope',
    '<div class="tablewrap"><table class="tbl"><thead><tr><th>Surface</th><th>Whose branding</th>'+
      '<th>Why</th></tr></thead><tbody>'+
    [['Your console','Yours','It is your workspace and your team uses it all day.'],
     ['Your listings','Marketplace, with your name and logo','Buyers compare listings side by side; inconsistent styling makes that harder, not easier.'],
     ['Storefront and checkout','Marketplace','A checkout that restyles per seller erodes the trust the marketplace exists to provide.'],
     ['Order confirmations','Marketplace, with your name','The buyer bought from the marketplace and is told who fulfils it.'],
     ['Settlement documents','Marketplace','Self-billing documents are issued by the marketplace on your behalf.']]
    .map(r=>'<tr><td class="cellmain">'+esc(r[0])+'</td><td class="t-small">'+esc(r[1])+
      '</td><td class="t-small muted">'+esc(r[2])+'</td></tr>').join('')+
    '</tbody></table></div>',
    {flush:true, icon:'shield',
     sub:'Stated plainly because the first question every seller asks is how far the branding goes.'})+

  (b.applied
    ? '<div class="t-tiny muted">Applied '+esc(b.lastChanged||'—')+
      (b.changedBy?' by '+esc(b.changedBy):'')+'.</div>'
    : '')+
  '</div>';
}
function brandPreset(id){
  if(id==='custom'){ MY_BRAND.preset='custom'; App.go('branding'); return; }
  const p=BRAND_PRESETS.find(x=>x.id===id); if(!p) return;
  Object.assign(MY_BRAND,{preset:id, primary:p.primary, accent:p.accent, rail:p.rail});
  App.go('branding');
}
function brandColour(k,v){ MY_BRAND[k]=v; MY_BRAND.preset='custom'; App.go('branding'); }
function brandWidget(id,on){
  const w=BRAND_WIDGETS.find(x=>x.id===id);
  if(w&&w.locked){ toast(w.why,'warn'); App.go('branding'); return; }
  MY_BRAND.widgets[id]=on;
  App.go('branding');
}
function brandAddLogo(){
  MY_BRAND.logo=(ME_P.name.split(' ')[0].toLowerCase())+'-logo.svg';
  App.go('branding');
  toast(MY_BRAND.logo+' added — describe it before you apply');
}
function brandRemoveLogo(){ MY_BRAND.logo=null; MY_BRAND.logoAlt=''; App.go('branding'); }
function saveBrand(){
  const b=MY_BRAND;
  const cP=contrast(b.primary,'#FFFFFF'), cR=contrast('#FFFFFF',b.rail);
  if(cP<4.5 || cR<4.5){
    toast('This palette fails WCAG AA — '+(cP<4.5?'primary is '+cP+':1':'navigation is '+cR+':1')+
      ', and 4.5:1 is the floor for body text','warn');
    return;
  }
  if(b.logo && !String(b.logoAlt||'').trim()){
    toast('Describe the logo before applying it — it is an image carrying your identity','warn');
    return;
  }
  b.applied=true;
  b.lastChanged=TODAY;
  b.changedBy=(orgUsers('partner').filter(u=>u.you)[0]||{}).name||'You';
  brandApply();
  audit('promo.changed',{object:'Portal branding',
    detail:'Theme '+b.theme+' · primary '+b.primary+(b.logo?' · logo '+b.logo:''),
    before:'marketplace default', after:(b.preset==='custom'?'custom palette':b.preset)});
  App.go('branding');
  toast('Branding applied to your console');
}
function resetBrand(){
  confirmAction({
    title:'Reset to the marketplace default', subtitle:'Your console returns to standard styling',
    confirmLabel:'Reset',
    impact:['Colours, theme and logo return to the marketplace default.',
            'Hidden dashboard cards come back.',
            'Nothing a buyer sees changes, because none of this was ever visible to them.'],
    onConfirm:()=>{
      const d=BRAND_PRESETS[0];
      Object.assign(MY_BRAND,{preset:'default', primary:d.primary, accent:d.accent, rail:d.rail,
        theme:'light', logo:null, logoAlt:'', displayName:'', applied:false});
      BRAND_WIDGETS.forEach(w=>{ MY_BRAND.widgets[w.id]=true; });
      brandApply();
      App.go('branding');
      toast('Reset to the marketplace default');
    }
  });
}

/* --------------------- NUMBERS, DELIVERY AND SIGN-IN (M20) --------------- */
/* A seller sees only the SIMs sitting against its own orders. The pool
   belongs to the operator; a seller has no business browsing it. */
function MY_ICCIDS(){
  /* Every order of ours that carries a SIM, not only the ones still open —
     a fulfilment query that hides completed orders cannot answer "which SIM
     did that customer get". */
  const mine = new Set(ORDERS.filter(o=>o.partnerId===ME_P.id).map(o=>o.id));
  return ICCIDS.filter(i=>i.order && mine.has(i.order));
}
function vPNumbers(){
  const rows=MY_ICCIDS();
  return '<div class="stack">'+
    pagehead('SIMs on my orders',
      'The SIMs allocated to orders you are fulfilling. The pool itself belongs to the operator.',
      exportBtn('My SIM records','dtIccid'))+
    banner('info','<strong>You see allocations, not the pool.</strong> ICCID, IMSI and MSISDN live in the '+
      'operator\u2019s Number Management system. What is shown here is what has been assigned to your orders — '+
      'browsing unassigned stock is not a seller function.')+
    (rows.length
      ? panel('Allocated to you', iccidTable(rows,'dtIccid'), {icon:'sim', sub:rows.length+' records'})
      : panel('Allocated to you', banner('info','No SIM-bearing orders are open against your listings right now.'),
              {icon:'sim'}))+
  '</div>';
}
function vPDelivery(){
  return deliveryView({title:'Message delivery', rows:DELIVERIES.filter(d=>d.ctx==='partner'),
                       providers:false, spend:false, channelsEditable:false, cost:false});
}
function vPAuth(){ return vAuth(); }

/* --------------------- BULK UPDATE (M21) -------------------------------- */
function vPBulk(){ return bulkView({title:'Bulk updates'}); }

/* --------------------- KNOWLEDGE BASE (M24) ----------------------------- */
function vPHelp(){ return kbView(); }


/* -------------------- the seller's own compliance documents ----------------
   Held on the module so View, Renew and Upload change a real record rather
   than raising a toast about one. */
const MY_DOCS = [
  {name:'Certificate of incorporation',    status:'verified', when:'02 Sep 2024', exp:'—',
   kind:'PDF', size:'1.4 MB', gate:'kyc'},
  {name:'Beneficial ownership declaration',status:'verified', when:'02 Sep 2024', exp:'—',
   kind:'PDF', size:'0.3 MB', gate:'kyc'},
  {name:'Marketplace terms v4.1 (signed)', status:'verified', when:'12 Sep 2024', exp:'—',
   kind:'PDF', size:'2.1 MB', gate:'agree'},
  {name:'Data processing agreement',       status:'verified', when:'12 Sep 2024', exp:'—',
   kind:'PDF', size:'0.7 MB', gate:'agree'},
  {name:'Security marketplace addendum',   status:'verified', when:'18 Jul 2026', exp:'—',
   kind:'PDF', size:'0.4 MB', gate:'agree'},
  {name:'Bank account verification',       status:'verified', when:'12 Sep 2024', exp:'—',
   kind:'PDF', size:'0.5 MB', gate:'finance'},
  {name:'Tax residency certificate',       status:'expiring', when:'11 Jan 2026',
   exp:'Expires 11 Sep 2026', kind:'PDF', size:'0.6 MB', gate:'finance'},
  {name:'Security questionnaire (Security marketplace)', status:'missing', when:'—',
   exp:'Required before compliance review', kind:'XLSX', size:'—', gate:'assure'}
];
function myDocs(){
  /* The questionnaire follows the task rather than being asserted twice. */
  const t=onbTaskById('OB-9103');
  const q=MY_DOCS.filter(d=>/questionnaire/i.test(d.name))[0];
  if(q && t && t.status==='done' && q.status==='missing'){
    q.status='verified'; q.when=TODAY; q.size='0.8 MB';
  }
  return MY_DOCS;
}
function myDoc(name){ return MY_DOCS.filter(d=>d.name===name)[0]||null; }
function viewMyDoc(name){
  const d=myDoc(name); if(!d) return;
  openModal('<div class="modal-head">'+ICO('file',18)+'<div class="grow">'+
      '<h3 class="t-sub">'+esc(d.name)+'</h3>'+
      '<div class="t-small muted">'+esc(d.kind)+' · '+esc(d.size)+' · '+
      esc((ONB_STEPS.find(g=>g.id===d.gate)||{}).name||d.gate)+' gate</div></div>'+
      '<button class="iconbtn" onclick="closeModal()" aria-label="Close">'+ICO('x',16)+'</button></div>'+
    '<div class="modal-body stack">'+
      (d.status==='expiring'
        ? banner('warning','<strong>'+esc(d.exp)+'.</strong> Withholding resumes on the first settlement '+
          'run after that date, on its own. Renewing before it lapses is the only way to avoid it — nothing '+
          'is refunded afterwards by the marketplace.')
        : banner('info','<strong>Verified on '+esc(d.when)+'.</strong> This is the copy the marketplace '+
          'holds and reads at the gate.'))+
      '<div class="doc-preview" style="min-height:180px">'+
        '<div class="doc-head"><div class="doc-logo">'+esc(ME_P.name)+'</div>'+
        '<div class="doc-title">'+esc(d.name)+'</div></div>'+
        '<div class="doc-meta"><span>Provided <strong>'+esc(d.when)+'</strong></span>'+
        '<span>Gate <strong>'+esc((ONB_STEPS.find(g=>g.id===d.gate)||{}).name||d.gate)+'</strong></span>'+
        (d.exp!=='—'?'<span>Validity <strong>'+esc(d.exp)+'</strong></span>':'')+'</div>'+
        '<div class="doc-block">The contents are withheld here. This document carries personal data on '+
        'named individuals and commercially sensitive information, so the record shows what was supplied '+
        'and when rather than reproducing it on screen.</div>'+
      '</div>'+
    '</div>'+
    '<div class="modal-foot"><button class="btn btn-quiet" onclick="closeModal()">Close</button>'+
      '<div class="spacer"></div>'+
      '<button class="btn btn-sm" onclick="downloadGateDocPdf('+
        JSON.stringify(d.name).replace(/"/g,'&quot;')+','+
        JSON.stringify(ME_P.name).replace(/"/g,'&quot;')+')">'+ICO('download',13)+'Download</button>'+
      (d.status==='expiring'
        ? '<button class="btn btn-primary" onclick="closeModal();uploadMyDoc('+
          JSON.stringify(d.name).replace(/"/g,'&quot;')+',true)">Renew it</button>' : '')+
    '</div>', {wide:true, label:d.name});
}
function uploadMyDoc(name, renewing){
  const d=myDoc(name); if(!d) return;
  const needsExpiry=/certificate|addendum/i.test(d.name);
  openModal('<div class="modal-head">'+ICO('upload',18)+'<div class="grow">'+
      '<h3 class="t-sub">'+(renewing?'Renew ':'Upload ')+esc(d.name)+'</h3>'+
      '<div class="t-small muted">'+esc((ONB_STEPS.find(g=>g.id===d.gate)||{}).name||d.gate)+
      ' gate'+(renewing?' · '+esc(d.exp):'')+'</div></div>'+
      '<button class="iconbtn" onclick="closeModal()" aria-label="Close">'+ICO('x',16)+'</button></div>'+
    '<div class="modal-body stack">'+
      banner('info','<strong>Uploading does not clear the gate.</strong> The marketplace reads what you '+
        'send and decides. What changes here is that they have something to read.')+
      '<div class="field"><label for="udFile">The file</label>'+
        '<label class="dropzone" style="cursor:pointer;display:block">'+ICO('upload',20)+
        '<div class="t-small" style="margin-top:6px" id="udName">Choose a PDF, image or spreadsheet</div>'+
        '<input type="file" id="udFile" accept=".pdf,.png,.jpg,.jpeg,.xlsx,.docx" style="display:none" '+
        'onchange="udPick(this)"></label></div>'+
      (needsExpiry
        ? '<div class="field"><label for="udExp">Valid to</label>'+
          '<input class="inp" id="udExp" placeholder="31 Mar 2028">'+
          '<div class="hint">A document with no expiry date cannot be checked before it lapses.</div></div>'
        : '')+
      '<div id="udOut"></div>'+
    '</div>'+
    '<div class="modal-foot"><button class="btn btn-quiet" onclick="closeModal()">Cancel</button>'+
      '<div class="spacer"></div>'+
      '<button class="btn btn-primary" onclick="submitMyDoc('+
        JSON.stringify(d.name).replace(/"/g,'&quot;')+')">'+
      (renewing?'Send the renewal':'Send it')+'</button></div>',
    {wide:true, label:(renewing?'Renew ':'Upload ')+d.name});
}
let _udFile=null;
function udPick(input){
  const f=(input.files&&input.files[0])||null;
  _udFile = f ? {name:f.name, size:f.size} : null;
  const el=document.getElementById('udName');
  if(el) el.textContent = f ? f.name+' · '+(f.size>1048576
    ? (f.size/1048576).toFixed(1)+' MB' : Math.max(1,Math.round(f.size/1024))+' KB')
    : 'Choose a PDF, image or spreadsheet';
}
function submitMyDoc(name){
  const d=myDoc(name); if(!d) return;
  const out=document.getElementById('udOut');
  const expEl=document.getElementById('udExp');
  if(!_udFile){
    if(out) out.innerHTML=banner('danger','<strong>Choose a file first.</strong> Marking a document as '+
      'sent without sending one only moves the problem to the gate.');
    return; }
  if(expEl && !String(expEl.value||'').trim()){
    if(out) out.innerHTML=banner('danger','<strong>A document with no expiry date cannot be checked.</strong> '+
      'Without one nobody knows when the cover lapses, including you.');
    return; }
  d.status='pending';
  d.when=TODAY;
  d.size=_udFile.size>1048576 ? (_udFile.size/1048576).toFixed(1)+' MB'
                              : Math.max(1,Math.round(_udFile.size/1024))+' KB';
  d.kind=(String(_udFile.name).split('.').pop()||'PDF').toUpperCase();
  if(expEl) d.exp='Expires '+String(expEl.value).trim();
  if(typeof audit==='function') audit('doc.viewed',{object:d.name,
    detail:'Uploaded by the seller as '+_udFile.name+' — awaiting review at the '+
      ((ONB_STEPS.find(g=>g.id===d.gate)||{}).name||d.gate)+' gate'});
  _udFile=null;
  closeModal();
  toast(d.name+' sent — the marketplace reviews it at the '+
    ((ONB_STEPS.find(g=>g.id===d.gate)||{}).name||d.gate).toLowerCase()+' gate');
  App.go(App.view);
}

/* ------------------- the marketplaces this seller is in --------------------
   Approved, applied for, and the ones they are not in — stated together,
   because "which marketplaces am I allowed to list in" is the first question
   a seller has and it was answerable only from a dropdown in a wizard. */
function myMarketplacesStrip(){
  const mine=ME_P.verticals.slice();
  const applying=MY_ONB_NEW.targetV;
  const live=mine.filter(v=>v!==applying);
  return panel('Where you sell',
    '<div class="mktstrip">'+VERTICALS.map(v=>{
      const held=live.indexOf(v.id)>-1;
      const pending=applying===v.id;
      const n=MY_LIST.filter(p=>p.v===v.id).length;
      const cls=held?'is-held':pending?'is-pending':'is-out';
      return '<div class="mktcard '+cls+'">'+
        '<span class="mktico">'+ICO(v.icon,18)+'</span>'+
        '<div class="grow"><div class="t-small strong">'+esc(v.name.replace(' Marketplace',''))+'</div>'+
        '<div class="t-tiny muted">'+esc(v.aud)+'</div></div>'+
        (held
          ? '<span class="mktstate">'+pill('active','Approved')+
            '<span class="t-tiny muted">'+(n? n+' listing'+(n===1?'':'s') : 'nothing listed yet')+'</span></span>'
          : pending
            ? '<span class="mktstate">'+pill('pending','Applying')+
              '<span class="t-tiny muted">'+esc(MY_ONB_NEW.elapsed)+' of '+esc(MY_ONB_NEW.sla)+'</span></span>'
            : '<span class="mktstate">'+pill('off','Not applied')+
              '<button class="linkbtn t-tiny" onclick="App.go(\'onboarding\')">Apply</button></span>')+
      '</div>';
    }).join('')+'</div>',
    {icon:'layers',
     sub:live.length+' approved'+(applying?' · 1 application in flight':'')+
       ' · a listing can only be published into a marketplace you are approved for'});
}
