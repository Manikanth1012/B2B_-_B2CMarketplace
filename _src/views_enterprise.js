/* ===========================================================================
   PERSONA: Enterprise buyer — B2B procurement side of the marketplace.
   Covers IoT, Security and Device marketplaces. Catalogue-driven buying with
   an approval workflow — no configure-price-quote, no bespoke engineering.
   Neutral / white-label brand, as requested.
   =========================================================================== */

const EB = {v:null, cat:null, q:'', sort:'popular'};
function entVerticals(){ return ['iot','security','device']; }
function entCatalogue(){ return LIVE_PRODUCTS.filter(p=>entVerticals().includes(p.v)); }
function entResults(){
  let r=entCatalogue();
  if(EB.v) r=r.filter(p=>p.v===EB.v);
  if(EB.cat) r=r.filter(p=>p.cat===EB.cat);
  if(EB.q){ const q=EB.q.toLowerCase();
    r=r.filter(p=>(p.name+' '+p.desc+' '+p.seller+' '+p.cat+' '+(p.tags||[]).join(' ')).toLowerCase().includes(q)); }
  return r.slice().sort((a,b)=>
    EB.sort==='priceup'? a.price-b.price : EB.sort==='pricedown'? b.price-a.price :
    EB.sort==='rating'? (b.rating||0)-(a.rating||0) : (b.reviews||0)-(a.reviews||0));
}
function setEB(k,v){ EB[k]=(String(EB[k])===String(v)&&k!=='sort'&&k!=='q')?null:v; if(k==='v') EB.cat=null; App.go('browse'); }
function ebReset(){ EB.v=EB.cat=null; EB.q=''; App.go('browse'); }
function goEntVertical(v){ ebReset(); EB.v=v; App.go('browse'); }

let BUDGET_LEFT = +(BUYER.budgetYear-BUYER.budgetSpent).toFixed(2);
function BEFORE_RENDER(){
  recomputeDerived();
  BUDGET_LEFT = +(BUYER.budgetYear-BUYER.budgetSpent).toFixed(2);
}

const E_INSIGHTS=[
  {icon:'warning', conf:'High confidence', src:'Read: your subscriptions, seat assignments and renewal dates',
   title:'You hold 120 licences on a suspended seller',
   body:'Vertex Endpoint was suspended by the marketplace on 11 Jul for repeated provisioning failures. Your <strong>Vertex Endpoint Protect</strong> subscription runs to contract end but <strong>will not renew</strong>. '+
        'Sentinel MDR covers the same endpoints and you already hold it for 620 of them.',
   acts:'<button class="btn btn-sm btn-primary" onclick="App.go(\'subs\')">Review the subscription</button>'+
        '<button class="btn btn-sm" onclick="openProduct(\'SKU-6002\')">Compare Sentinel MDR</button>'},
  {icon:'wallet', conf:'High confidence', src:'Read: your orders, budget consumed and approval history',
   title:'You are paying for 65 unassigned seats',
   body:'Across MDR, ZTNA and mail defence, <strong>65 licensed seats</strong> are unassigned — about '+CUR(65*6.5)+' a month. '+
        'Seat counts step in blocks, so some slack is unavoidable, but this is more than one block on two of the three.',
   acts:'<button class="btn btn-sm btn-primary" onclick="App.go(\'subs\')">Manage seats</button>'},
  {icon:'checklist', conf:'Medium confidence', src:'Read: your subscriptions and the security catalogue',
   title:APR_PENDING.length+' requisitions are waiting on an approver',
   body:'One needs finance because it is above the '+CUR0(2000)+' threshold; one needs IT because it is a security purchase. Median approval time on this account is 1.4 days.',
   acts:'<button class="btn btn-sm btn-primary" onclick="App.go(\'approvals\')">Open approvals</button>'},
  {icon:'eyeoff', conf:'Low confidence — partial evidence', src:'Read: device telemetry — 19 of 120 sensors have reported nothing',
   title:'Sensor utilisation cannot be confirmed for the Pune depot',
   body:'The 25 cold-chain sensors ordered in May show as delivered, but no telemetry has reached the dashboard. That is consistent with either an un-commissioned install or a reporting gap, and the evidence does not separate the two. Utilisation is reported as <strong>not measured</strong>, not as zero.',
   acts:'<button class="btn btn-sm" onclick="App.go(\'orders\')">Check the order</button>'}
];

/* ------------------------------ 1. Dashboard ------------------------------ */
function vEHome(){
  return pagehead('Procurement dashboard',
    esc(BUYER.company)+' · '+esc(BUYER.id)+' · '+BUYER.sites+' sites, '+FMT.num(BUYER.staff)+' staff · '+esc(BUYER.terms),
    '<button class="btn" onclick="App.go(\'approvals\')">'+ICO('checklist',13)+'Approvals ('+APR_PENDING.length+')</button>'+
    '<button class="btn btn-primary" onclick="App.go(\'browse\')">'+ICO('search',14)+'Browse the catalogue</button>')+
  '<div class="stack">'+

  banner('danger','<strong>Vertex Endpoint has been suspended by the marketplace.</strong> Your 120 endpoint licences run to contract end and will not renew. '+
    'You need a replacement decision before that date. '+
    '<button class="linkbtn" onclick="App.go(\'subs\')">See the subscription</button>')+

  bannerSlot('home-hero',{audience:'Enterprise', signedIn:true})+

  '<div class="grid g4">'+
    metric({icon:'wallet',label:'Committed monthly',value:CUR0(ENT_MRC),foot:ENT_SUBS.filter(s=>s.status==='active').length+' active subscriptions'})+
    metric({icon:'pie',label:'Budget used',value:FMT.pct(BUYER.budgetSpent/BUYER.budgetYear*100),
      foot:CUR0(BUYER.budgetSpent)+' of '+CUR0(BUYER.budgetYear)+' · '+CUR0(BUDGET_LEFT)+' left'})+
    metric({icon:'checklist',label:'Awaiting approval',value:String(APR_PENDING.length),
      foot:CUR0(APR_PENDING.reduce((a,x)=>a+x.amount,0))+' of requests'})+
    metric({icon:'orders',label:'Orders in flight',value:String(ORDERS.filter(o=>o.buyer===BUYER.company&&o.stage<o.stages.length-1).length),
      foot:'Provisioning and delivery'})+
  '</div>'+

  panel('Buy from', verticalTiles('goEntVertical(\'$V\')'),
    {icon:'dashboard',
     sub:'Your account can buy from the IoT, Security and Device marketplaces. Consumer and content marketplaces are not enabled for business accounts.'})+

  '<div class="grid g-2-1">'+
    panel('Spend against budget',
      CH.line([{pts:['Aug','Sep','Oct','Nov','Dec','Jan','Feb','Mar','Apr','May','Jun','Jul'].map((m,i)=>
                 ({l:m, v: Math.round(BUYER.budgetSpent/12*(0.8+i*0.035))}))},
               {pts:['Aug','Sep','Oct','Nov','Dec','Jan','Feb','Mar','Apr','May','Jun','Jul'].map(m=>
                 ({l:m, v: Math.round(BUYER.budgetYear/12)}))}],
        {fmt:n=>CUR0(n),tip:n=>CUR(n),aria:'Monthly spend against budget'})+
      '<div class="legend"><span><i style="background:#0099FF"></i>Actual spend</span>'+
      '<span><span class="dash"></span>Monthly budget '+CUR0(BUYER.budgetYear/12)+'</span></div>',
      {icon:'chart', sub:'Financial year to date'})+
    panel('Spend by marketplace',
      CH.donut(entVerticals().map(v=>({l:vName(v).replace(' Marketplace',''),
        v:Math.round(ENT_SUBS.filter(s=>s.v===v&&s.status==='active').reduce((a,s)=>a+s.monthly,0))})).filter(x=>x.v>0),
        {centre:CUR0(ENT_MRC),centreSub:'per month',fmt:n=>CUR0(n),aria:'Monthly spend by marketplace'})+
      '<div class="divider"></div>'+
      '<div class="row"><span class="t-small muted grow">Device purchases are one-off, not in this split</span>'+
      '<span class="t-small strong t-num">'+CUR0(ORDERS.filter(o=>o.buyer===BUYER.company&&o.v==='device').reduce((a,o)=>a+o.gross,0))+'</span></div>',
      {icon:'pie'})+
  '</div>'+

  forecastPanel({series:entSpendSeries(), title:'Spend projection',
    label:'Projected spend',
    sub:'Your committed run rate plus the one-off pattern of the last twelve months.',
    assumptions:[
      'Existing subscriptions renew on their current seat counts. A seat change moves this immediately.',
      'It does not include anything sitting in approvals — '+APR_PENDING.length+' requisition'+
        (APR_PENDING.length===1?'':'s')+' worth '+CUR0(APR_PENDING.reduce(function(a,x){return a+x.amount},0))+
        ' would add to it.',
      'Contract prices are applied where they exist, so the figure is what you will be invoiced, not list.',
      '<strong>Budget is '+CUR0(BUYER.budgetYear)+' for the year with '+CUR0(BUDGET_LEFT)+' left.</strong> '+
        'If the projection exceeds that, the conversation is worth having now rather than in Q4.'
    ]})+

  panel('AI insights', E_INSIGHTS.map(aiInsight).join(''),
    {ai:true, flush:true, icon:'ai',
     sub:'Based on your own subscriptions, orders and seat assignments. No other buyer\'s data is visible to you.'})+

  '<div class="grid g2">'+
    panel('Waiting on an approver',
      APR_PENDING.length
        ? '<div class="stack" style="gap:0">'+APR_PENDING.map(a=>
            '<div class="row" style="padding:10px 0;border-bottom:1px solid var(--nim-line-100)">'+
            '<span class="cartthumb" style="width:34px;height:34px">'+ICO(VICON[a.v],15)+'</span>'+
            '<div class="grow"><div class="t-small strong">'+esc(a.item)+'</div>'+
            '<div class="t-tiny muted">'+esc(a.requester)+' · '+esc(a.raised)+' · '+esc(a.need)+'</div></div>'+
            '<div class="t-small strong t-num">'+CUR(a.amount)+'</div></div>').join('')+'</div>'+
          '<button class="btn btn-sm btn-quiet" style="margin-top:9px" onclick="App.go(\'approvals\')">Open approvals</button>'
        : stateBlock('empty','Nothing waiting','Requisitions needing sign-off would appear here.'),
      {icon:'checklist'})+
    panel('Provisioning and delivery',
      '<div class="stack" style="gap:0">'+ORDERS.filter(o=>o.buyer===BUYER.company).slice(0,4).map(o=>
        '<button class="row" style="width:100%;text-align:left;background:none;border:0;cursor:pointer;padding:10px 0;border-bottom:1px solid var(--nim-line-100)" '+
        'onclick="openOrder(\''+o.id+'\')">'+
        '<span class="cartthumb" style="width:34px;height:34px">'+ICO(VICON[o.v],15)+'</span>'+
        '<div class="grow"><div class="t-small strong">'+esc(o.name)+'</div>'+
        '<div class="t-tiny muted">'+esc(o.id)+' · '+esc(o.seller)+'</div></div>'+
        orderStatePill(o)+'</button>').join('')+'</div>'+
      '<button class="btn btn-sm btn-quiet" style="margin-top:9px" onclick="App.go(\'orders\')">All orders</button>',
      {icon:'orders'})+
  '</div>'+
  '</div>';
}

/* -------------------------------- 2. Browse ------------------------------- */
function vEBrowse(){
  const all=entCatalogue(), res=entResults();
  const cats=Array.from(new Set((EB.v?all.filter(p=>p.v===EB.v):all).map(p=>p.cat)));
  const filtering=EB.v||EB.cat||EB.q;
  const opt=(label,active,onclick,count)=>
    '<label class="checkline"><input type="checkbox" '+(active?'checked':'')+' onchange="'+onclick+'">'+
    '<span>'+esc(label)+'</span>'+(count!=null?'<span class="cnt">'+count+'</span>':'')+'</label>';
  return pagehead(EB.v?vName(EB.v):'Business catalogue',
    res.length+' of '+all.length+' listings approved for business accounts · sold by '+new Set(res.map(p=>p.seller)).size+' sellers',
    '<div class="gsearch" style="width:250px;margin:0;position:relative">'+ICO('search',14)+
      '<input class="inp" id="browseQ" style="padding-left:30px" placeholder="Search the catalogue" value="'+esc(EB.q)+'" '+
      'oninput="searchRerender(this,function(v){EB.q=v},\'browse\')" aria-label="Search the catalogue"></div>'+
    '<select class="inp" style="width:160px" aria-label="Sort" onchange="EB.sort=this.value;App.go(\'browse\')">'+
      [['popular','Most popular'],['rating','Highest rated'],['priceup','Price: low to high'],['pricedown','Price: high to low']].map(o=>
      '<option value="'+o[0]+'"'+(EB.sort===o[0]?' selected':'')+'>'+o[1]+'</option>').join('')+'</select>')+
  '<div class="stack">'+
  banner('info','Everything here is pre-approved for business purchase. Anything above '+CUR0(2000)+' needs finance approval before the order is placed; security purchases also need IT sign-off.')+
  '<div class="grid" style="grid-template-columns:230px minmax(0,1fr);gap:14px">'+
    '<aside class="facets" aria-label="Filters">'+
      '<div class="facet"><div class="row"><h4 style="margin:0" class="grow">Filters</h4>'+
        (filtering?'<button class="linkbtn" onclick="ebReset()">Clear all</button>':'')+'</div></div>'+
      '<div class="facet"><h4>Marketplace</h4><div class="opts">'+entVerticals().map(v=>
        opt(vName(v).replace(' Marketplace',''), EB.v===v, 'setEB(\'v\',\''+v+'\')', all.filter(p=>p.v===v).length)).join('')+'</div></div>'+
      '<div class="facet"><h4>Category</h4><div class="opts">'+cats.map(c=>
        opt(c, EB.cat===c, 'setEB(\'cat\',\''+c.replace(/'/g,"\\'")+'\')',
          all.filter(p=>p.cat===c&&(!EB.v||p.v===EB.v)).length)).join('')+'</div></div>'+
      '<div class="facet"><h4>Approval needed</h4><div class="opts">'+
        '<label class="checkline"><input type="checkbox" disabled checked><span>Within policy (under '+CUR0(2000)+')</span></label>'+
        '<label class="checkline"><input type="checkbox" disabled><span>Finance approval</span></label>'+
        '<label class="checkline"><input type="checkbox" disabled><span>IT sign-off (security)</span></label>'+
      '</div></div>'+
    '</aside>'+
    '<div>'+
      (res.length
        /* Out of stock replaces the requisition action with Notify me —
           productCard handles that, and addLabel keeps the wording right
           on the buy side of this portal. */
        ? '<div class="pgrid cols3">'+res.map(p=>productCard(p,{desc:false,
            addLabel:'Add to requisition'})).join('')+'</div>'
        : panel(null, stateBlock('filtered','Nothing matches those filters',
            'Your filters exclude all '+all.length+' business listings.',
            '<button class="btn btn-sm btn-primary" onclick="ebReset()">Clear filters</button>'),{flush:true}))+
      /* What the company is already waiting on, so a buyer does not set the
         same alert twice or chase a colleague's. */
      watchPanel({addLabel:'Add to requisition'})+
    '</div>'+
  '</div>'+
  '</div>';
}

/* ------------------------------- 3. IoT ----------------------------------- */
function vEIot(){
  const items=LIVE_PRODUCTS.filter(p=>p.v==='iot');
  const byCat={}; items.forEach(p=>{ (byCat[p.cat]=byCat[p.cat]||[]).push(p); });
  const sub=ENT_SUBS.find(s=>s.v==='iot');
  return pagehead('IoT Marketplace',
    items.length+' listings · SIM plans, sensors, trackers, gateways and bundles from '+new Set(items.map(p=>p.seller)).size+' sellers',
    '<button class="btn" onclick="App.go(\'subs\')">'+ICO('sim',13)+'My connectivity</button>'+
    '<button class="btn btn-primary" onclick="goEntVertical(\'iot\')">Browse with filters</button>')+
  '<div class="stack">'+
  (sub? panel('What you already run',
    '<div class="grid g4" style="gap:12px">'+
      metric({label:'IoT SIMs',value:FMT.num(sub.qty),foot:sub.seatsUsed+' active on the network'})+
      metric({label:'Monthly',value:CUR(sub.monthly),foot:CUR(sub.price)+' '+sub.unit})+
      metric({label:'Sensors delivered',value:'25',foot:'Cold-chain, Pune depot, May 2026'})+
      metric({label:'Sensor utilisation',value:null,naLabel:'Not measured',foot:pill('partial','No telemetry received')})+
    '</div>'+
    '<div class="divider"></div>'+
    banner('partial','The 25 cold-chain sensors show as delivered but no telemetry has reached the dashboard. That is either an un-commissioned install or a reporting gap — the evidence does not say which, so utilisation is reported as not measured rather than zero.'),
    {icon:'cpu'}) : '')+
  Object.keys(byCat).map(cat=>
    panel(cat,'<div class="pgrid cols3">'+byCat[cat].map(p=>productCard(p,{desc:false,
      cta:'<button class="btn btn-sm btn-primary" style="margin-left:auto" onclick="event.stopPropagation();addToCart(\''+p.id+'\')">Add</button>'})).join('')+'</div>',
      {icon:cat==='IoT SIM plans'?'sim':cat==='Sensors'?'cpu':cat==='Trackers'?'pin':cat==='Gateways'?'server':'package',
       sub:cat==='Bundles'?'Hardware, connectivity and dashboard priced as one line':''})).join('')+
  '</div>';
}

/* ------------------------------ 4. Security ------------------------------- */
function vESecurity(){
  const items=LIVE_PRODUCTS.filter(p=>p.v==='security');
  const byCat={}; items.forEach(p=>{ (byCat[p.cat]=byCat[p.cat]||[]).push(p); });
  const mine=ENT_SUBS.filter(s=>s.v==='security');
  return pagehead('Security Marketplace',
    items.length+' listings · managed firewall, MDR, VPN and ZTNA, endpoint and email security',
    '<button class="btn" onclick="App.go(\'subs\')">'+ICO('shield',13)+'My security stack</button>'+
    '<button class="btn btn-primary" onclick="goEntVertical(\'security\')">Browse with filters</button>')+
  '<div class="stack">'+
  banner('warning','<strong>Security purchases need IT sign-off</strong> regardless of value, on top of the usual finance threshold. That is your own policy, not a marketplace rule.')+
  panel('Your security stack',
    '<div class="tablewrap"><table class="tbl"><thead><tr><th>Service</th><th>Seller</th><th class="num">Licensed</th>'+
    '<th style="width:190px">Assigned</th><th class="num">Monthly</th><th>Renews</th><th>State</th></tr></thead><tbody>'+
    mine.map(s=>'<tr onclick="openProduct(\''+s.sku+'\')" style="cursor:pointer">'+
      '<td><div class="cellmain">'+esc(s.name)+'</div><div class="cellsub">'+esc(s.unit)+'</div></td>'+
      '<td>'+esc(s.seller)+'</td><td class="num t-num">'+FMT.num(s.qty)+'</td>'+
      '<td>'+(s.status==='suspended'? '<span class="nodata">Not assignable</span>'
        : meter(s.seatsUsed/s.seatsTotal*100, s.seatsUsed+' / '+s.seatsTotal))+'</td>'+
      '<td class="num t-num">'+CUR(s.monthly)+'</td><td>'+esc(s.renews)+'</td>'+
      '<td>'+statusPill(s.status)+'</td></tr>').join('')+
    '</tbody></table></div>',
    {flush:true,icon:'shield',
     acts:'<span class="t-tiny muted">'+CUR(mine.filter(s=>s.status==='active').reduce((a,s)=>a+s.monthly,0))+' per month</span>'})+
  Object.keys(byCat).map(cat=>
    panel(cat,'<div class="pgrid cols3">'+byCat[cat].map(p=>productCard(p,{desc:false,
      cta:'<button class="btn btn-sm btn-primary" style="margin-left:auto" onclick="event.stopPropagation();addToCart(\''+p.id+'\')">Add</button>'})).join('')+'</div>',
      {icon:cat==='Managed firewall'?'shield':cat==='MDR'?'eye':cat==='VPN / ZTNA'?'lock':cat==='Email security'?'mail':'package'})).join('')+
  '</div>';
}

/* ------------------------------- 5. Devices ------------------------------- */
function vEDevices(){
  const items=LIVE_PRODUCTS.filter(p=>p.v==='device');
  return pagehead('Device Marketplace',
    items.length+' listings · phones, routers, CPE, tablets and accessories for business',
    '<button class="btn" onclick="toast(\'Standard device list opened\')">'+ICO('checklist',13)+'Our standard list</button>'+
    '<button class="btn btn-primary" onclick="goEntVertical(\'device\')">Browse with filters</button>')+
  '<div class="stack">'+
  banner('info','Devices are bought outright on invoice, net 30. Bulk orders above 20 units are dispatched from the seller\'s warehouse directly to the site you nominate.')+
  panel('Your standard list',
    '<div class="pgrid cols3">'+items.filter(p=>['Phones','Routers','CPE'].includes(p.cat)).map(p=>productCard(p,{desc:false,
      cta:'<button class="btn btn-sm btn-primary" style="margin-left:auto" onclick="event.stopPropagation();addToCart(\''+p.id+'\')">Add</button>'})).join('')+'</div>',
    {icon:'monitor',sub:'Approved by IT for issue to staff and sites'})+
  panel('Everything else',
    '<div class="pgrid cols3">'+items.filter(p=>!['Phones','Routers','CPE'].includes(p.cat)).map(p=>productCard(p,{desc:false,
      cta:'<button class="btn btn-sm btn-primary" style="margin-left:auto" onclick="event.stopPropagation();addToCart(\''+p.id+'\')">Add</button>'})).join('')+'</div>',
    {icon:'package'})+
  '</div>';
}

/* ------------------------------ 6. Approvals ------------------------------ */
function vEApprovals(){
  return pagehead('Approvals',
    APR_PENDING.length+' waiting · purchases at or above '+CUR0(APPROVAL_POLICY.threshold)+
      ' need finance approval'+(APPROVAL_POLICY.securitySignOff?', security purchases also need IT sign-off':''),
    exportBtn('Approval decisions','dtApr')+
    '<button class="btn" onclick="approvalPolicyDialog()">'+ICO('shield',13)+'Policy</button>')+
  '<div class="stack">'+
  banner('info','Approvers see the requester\'s reason, the cost and what the account already holds — so a duplicate request is obvious before it is approved.')+
  (APR_PENDING.length
    ? APR_PENDING.map(a=>
      '<section class="panel"><div class="panel-body">'+
        '<div class="row wrap" style="gap:12px;align-items:flex-start">'+
          '<span class="cartthumb">'+ICO(VICON[a.v],20)+'</span>'+
          '<div class="grow"><div class="row" style="gap:6px">'+vBadge(a.v)+
            (a.need==='None — within policy'?pill('active','Within policy'):pill('pending',a.need))+'</div>'+
          '<div class="t-sub" style="margin-top:5px">'+esc(a.item)+'</div>'+
          '<div class="t-small muted">'+esc(a.id)+' · '+esc(a.requester)+' · raised '+esc(a.raised)+'</div>'+
          '<div class="t-small" style="margin-top:7px">“'+esc(a.reason)+'”</div>'+
          '<div class="t-tiny muted" style="margin-top:6px">'+esc(a.policy)+'</div></div>'+
          '<div style="text-align:right;flex:0 0 auto"><div class="t-sub t-num">'+CUR(a.amount)+'</div>'+
          '<div class="t-tiny muted">'+(SKUMAP[a.sku]&&SKUMAP[a.sku].model==='monthly'?'per month':'one-off')+'</div></div>'+
        '</div>'+
        '<div class="divider"></div>'+
        '<div class="row wrap"><span class="t-tiny muted grow">Approver: '+esc(BUYER.approver)+'</span>'+
          '<button class="btn btn-sm btn-quiet" onclick="openProduct(\''+a.sku+'\')">See the listing</button>'+
          '<button class="btn btn-sm btn-danger" onclick="decideReq(\''+a.id+'\',false)">Decline</button>'+
          '<button class="btn btn-sm btn-primary" onclick="decideReq(\''+a.id+'\',true)">Approve and order</button>'+
        '</div>'+
      '</div></section>').join('')
    : panel(null,stateBlock('empty','Nothing waiting','Requisitions above your policy thresholds land here.'),{flush:true}))+
  panel('Decision history', dt('dtApr',{
    rows:APPROVALS.filter(a=>a.status!=='pending'), noun:'decisions', pageSize:10, toolbar:false, sortKey:'raised',
    emptyTitle:'No decisions yet', emptyBody:'Approvals and declines are recorded here.',
    columns:[
      {key:'id',label:'Request',render:r=>'<div class="cellmain t-num">'+esc(r.id)+'</div><div class="cellsub">'+esc(r.raised)+'</div>'},
      {key:'item',label:'Item',render:r=>'<div class="cellmain">'+esc(r.item)+'</div><div class="cellsub">'+esc(r.reason)+'</div>'},
      {key:'v',label:'Marketplace',render:r=>vBadge(r.v)},
      {key:'requester',label:'Requester',render:r=>esc(r.requester)},
      {key:'amount',label:'Value',align:'right',render:r=>'<span class="t-num cellmain">'+CUR(r.amount)+'</span>'},
      {key:'policy',label:'Policy',render:r=>'<span class="t-small">'+esc(r.policy)+'</span>'},
      {key:'status',label:'Decision',render:r=>statusPill(r.status)}
    ]}),{flush:true,icon:'history'})+
  panel('Approval policy',
    '<div class="grid g2"><div class="stack" style="gap:11px">'+
      '<div class="field"><label for="apThr">Finance approval threshold ('+esc(MP.currencyCode)+')</label>'+
        '<div class="stepper"><button type="button" onclick="bumpThreshold(-500)" aria-label="Lower the threshold">'+SH('minus',11)+'</button>'+
        /* A money field with no unit on it is an invitation to read it in the
           wrong currency, which on a threshold means approving what should
           have been stopped. */
        '<span class="steppfx" aria-hidden="true">'+esc(MP.currency)+'</span>'+
        '<input id="apThr" value="'+APPROVAL_POLICY.threshold+'" '+
        'aria-label="Finance approval threshold in '+esc(MP.currencyCode)+'" '+
        'onchange="setApprovalPolicy(\'threshold\',parseInt(this.value,10)||0)">'+
        '<button type="button" onclick="bumpThreshold(500)" aria-label="Raise the threshold">+</button></div>'+
        '<div class="hint">Requisitions at or above '+CUR0(APPROVAL_POLICY.threshold)+' go to '+
        esc(BUYER.approver)+'. '+
        (function(){
          const n=APPROVALS.filter(a=>a.amount>=APPROVAL_POLICY.threshold).length;
          return n+' of the '+APPROVALS.length+' requisitions on record would have needed it.';
        })()+'</div></div>'+
      '<label class="toggle"><input type="checkbox" '+(APPROVAL_POLICY.securitySignOff?'checked':'')+
        ' onchange="setApprovalPolicy(\'securitySignOff\',this.checked)"><span class="track"></span>'+
        'Security purchases always need IT sign-off</label>'+
      '<label class="toggle"><input type="checkbox" '+(APPROVAL_POLICY.duplicateFlag?'checked':'')+
        ' onchange="setApprovalPolicy(\'duplicateFlag\',this.checked)"><span class="track"></span>'+
        'Flag a requisition that duplicates something we already hold</label>'+
      '<label class="toggle"><input type="checkbox" '+(APPROVAL_POLICY.autoApproveRenewals?'checked':'')+
        ' onchange="setApprovalPolicy(\'autoApproveRenewals\',this.checked)"><span class="track"></span>'+
        'Auto-approve renewals of existing subscriptions</label>'+
      '<label class="toggle"><input type="checkbox" '+(APPROVAL_POLICY.selfApprove?'checked':'')+
        ' onchange="setApprovalPolicy(\'selfApprove\',this.checked)"><span class="track"></span>'+
        'Allow an approver to approve their own requisition</label>'+
      (APPROVAL_POLICY.selfApprove
        ? banner('warning','<strong>Self-approval is on.</strong> One person can now raise and approve the same spend. '+
          'That is the control most audits test first.')
        : '')+
    '</div><div class="stack" style="gap:9px">'+
      '<div class="t-small strong">Who can do what</div>'+
      APPROVAL_POLICY.matrix.map(r=>
      '<div class="row"><span class="t-small grow">'+esc(r.what)+'</span>'+
      '<span class="t-small strong">'+esc(r.who)+'</span></div>').join('')+
      '<div class="divider"></div>'+
      '<div class="t-tiny muted">These names are roles, not people. Changing who holds a role in '+
      '<button class="linkbtn" onclick="App.go(\'roles\')">roles configuration</button> changes who a requisition routes to.</div>'+
    '</div></div>'+
    '<div class="divider"></div>'+
    '<div class="row"><span class="t-tiny muted grow">Policy changes apply to new requisitions only. '+
      APR_PENDING.length+' already in flight keep the policy they were raised under.</span>'+
    '<button class="btn btn-primary" onclick="saveApprovalPolicy()">Save policy</button></div>',
    {icon:'shield'})+
  '</div>';
}
function setApprovalPolicy(key,val){
  APPROVAL_POLICY[key]=val;
  App.go(App.view);
}
function bumpThreshold(d){
  APPROVAL_POLICY.threshold = Math.max(0, APPROVAL_POLICY.threshold + d);
  App.go(App.view);
}
function saveApprovalPolicy(){
  const P=APPROVAL_POLICY;
  const affected=APPROVALS.filter(a=>a.status==='pending' && a.amount>=P.threshold).length;
  toast('Approval policy saved — threshold '+CUR0(P.threshold)+
    (P.securitySignOff?', IT sign-off on security':', no IT sign-off')+
    (affected?' · '+affected+' pending requisition'+(affected===1?'':'s')+' unaffected':''));
}
/* A policy editor that only lives on the screen is not a policy. The same
   record opens as a dialog from the page header. */
function approvalPolicyDialog(){
  const P=APPROVAL_POLICY;
  openModal('<div class="modal-head">'+ICO('shield',18)+'<div class="grow"><h3 class="t-sub">Approval policy</h3>'+
    '<div class="t-small muted">'+esc(BUYER.company)+' · applies to every requisition raised from now on</div></div>'+
    '<button class="iconbtn" onclick="closeModal()" aria-label="Close">'+ICO('x',16)+'</button></div>'+
    '<div class="modal-body stack">'+
      '<div class="grid g2">'+
        '<div class="field"><label for="apdThr">Finance approval threshold (USD)</label>'+
          '<input class="inp" id="apdThr" type="number" min="0" step="500" value="'+P.threshold+'" data-autofocus></div>'+
        '<div class="field"><label for="apdDel">Delegate approval limit (USD)</label>'+
          '<input class="inp" id="apdDel" type="number" min="0" step="500" value="'+P.delegateLimit+'">'+
          '<div class="hint">A delegate cannot approve above this, whatever the approver\'s own limit.</div></div>'+
      '</div>'+
      '<label class="checkline"><input type="checkbox" id="apdSec" '+(P.securitySignOff?'checked':'')+
        '> Security purchases need IT sign-off regardless of value</label>'+
      '<label class="checkline"><input type="checkbox" id="apdDup" '+(P.duplicateFlag?'checked':'')+
        '> Flag a requisition that duplicates something already held</label>'+
      '<label class="checkline"><input type="checkbox" id="apdRen" '+(P.autoApproveRenewals?'checked':'')+
        '> Auto-approve renewals of existing subscriptions</label>'+
      '<label class="checkline"><input type="checkbox" id="apdSelf" '+(P.selfApprove?'checked':'')+
        '> Allow an approver to approve their own requisition</label>'+
      '<div class="impact"><strong>What this changes</strong><ul>'+
        '<li>Only requisitions raised after you save follow the new policy.</li>'+
        '<li>'+APR_PENDING.length+' requisition'+(APR_PENDING.length===1?'':'s')+' already waiting keep the policy they were raised under.</li>'+
        '<li>Segregation of duties is what makes this policy worth anything — self-approval removes it.</li></ul></div>'+
    '</div>'+
    '<div class="modal-foot"><span class="t-tiny muted grow">Only the finance director may change this.</span>'+
      '<button class="btn btn-quiet" onclick="closeModal()">Cancel</button>'+
      '<button class="btn btn-primary" onclick="submitApprovalPolicy()">Save policy</button></div>',
    {wide:true,label:'Approval policy'});
}
function submitApprovalPolicy(){
  const g=id=>document.getElementById(id);
  const P=APPROVAL_POLICY;
  P.threshold=Math.max(0,parseInt(g('apdThr').value,10)||0);
  P.delegateLimit=Math.max(0,parseInt(g('apdDel').value,10)||0);
  P.securitySignOff=g('apdSec').checked;
  P.duplicateFlag=g('apdDup').checked;
  P.autoApproveRenewals=g('apdRen').checked;
  P.selfApprove=g('apdSelf').checked;
  closeModal(); App.go(App.view);
  saveApprovalPolicy();
}

function decideReq(id,approve){
  const a=APPROVALS.find(x=>x.id===id); if(!a) return;
  const p=SKUMAP[a.sku];
  confirmAction({
    title:(approve?'Approve ':'Decline ')+a.item, subtitle:a.requester+' · '+CUR(a.amount)+' · '+a.id,
    risk:'normal', confirmLabel:approve?'Approve and place the order':'Decline',
    body:(a.lines&&a.lines.length>1
        ? '<div class="tablewrap" style="max-height:170px;overflow:auto;margin-bottom:12px"><table class="tbl"><tbody>'+
          a.lines.map(l=>'<tr><td class="cellmain">'+esc(l.name)+'</td><td class="num">×'+l.qty+'</td>'+
          '<td class="num">'+CUR(l.price*l.qty)+'</td></tr>').join('')+'</tbody></table></div>' : '')+
      '<div class="field"><label for="drWhy">Reason (shared with the requester)</label>'+
      '<textarea class="inp" id="drWhy" data-autofocus placeholder="'+(approve?'Optional':'Required')+'"></textarea></div>',
    impact:approve
      ? ['The order is placed with <strong>'+esc(p?p.seller:'the seller')+'</strong> immediately — this is not a quote.',
         (p&&p.model==='monthly'?CUR(a.amount)+' is added to your monthly commitment and appears on the next invoice.'
                                :CUR(a.amount)+' is invoiced on '+esc(BUYER.terms)+'.'),
         'Budget remaining drops to '+CUR0(BUDGET_LEFT-a.amount)+' for the financial year.',
         esc(a.requester)+' is notified and can track provisioning in their orders.']
      : ['No order is placed and nothing is charged.',
         esc(a.requester)+' is told why and can revise and resubmit.',
         'The decision is kept against the requisition record.'],
    footNote:approve?'Approving places a real order — there is no separate confirmation step.':'',
    onConfirm:()=>{
      a.status=approve?'approved':'rejected';
      if(approve){
        const made=fulfilRequisition(a);
        toast(a.id+' approved — '+made.length+' order'+(made.length===1?'':'s')+' placed with the seller');
      } else {
        recomputeDerived();
        toast(a.id+' declined — nothing ordered, requester notified','warn');
      }
      App.go('approvals');
    }
  });
}

/* ------------------------ enterprise checkout override --------------------
   A business basket becomes a requisition, not an order. It only becomes an
   order once the policy that applies to it has been satisfied.
   ------------------------------------------------------------------------- */
function checkout(){
  const t=cartTotals();
  const total=t.once+t.month;
  const needsFinance = total>=2000;
  const hasSecurity = CART.some(l=>SKUMAP[l.sku].v==='security');
  const sellers=Array.from(new Set(CART.map(l=>SKUMAP[l.sku].seller)));
  const lineCount=CART.length;
  closeInspector();
  confirmAction({
    title:'Submit requisition', subtitle:CUR(t.once)+' one-off'+(t.month?' · '+CUR(t.month)+'/mo recurring':''),
    risk:'normal', confirmLabel:(needsFinance||hasSecurity)?'Submit for approval':'Place the order',
    body:'<div class="grid g2">'+
      '<div class="field"><label for="rqCc">Cost centre</label><select class="inp" id="rqCc" data-autofocus>'+
        '<option>CC-2200 · IT and infrastructure</option><option>CC-4100 · Logistics</option>'+
        '<option>CC-1000 · Corporate</option></select></div>'+
      '<div class="field"><label for="rqSite">Deliver or provision to</label><select class="inp" id="rqSite">'+
        '<option>Pune depot</option><option>Bengaluru head office</option><option>Hyderabad office</option>'+
        '<option>All 14 sites</option></select></div></div>'+
      '<div class="field" style="margin-top:12px"><label for="rqWhy">Business reason</label>'+
      '<textarea class="inp" id="rqWhy" placeholder="Why this is needed — approvers read this first"></textarea></div>',
    impactTitle:(needsFinance||hasSecurity)?'This needs approval before it becomes an order':'This is within your policy',
    impact:[
      'Basket spans <strong>'+sellers.length+' seller'+(sellers.length===1?'':'s')+'</strong> — '+esc(sellers.join(', '))+'. Each fulfils separately.',
      needsFinance ? 'Total is at or above '+CUR0(2000)+', so <strong>'+esc(BUYER.approver)+'</strong> must approve.' : 'Total is below the '+CUR0(2000)+' finance threshold.',
      hasSecurity ? 'Contains a security purchase, so <strong>IT sign-off</strong> is also required regardless of value.' : 'No security items — no IT sign-off needed.',
      t.month ? 'Recurring items add '+CUR(t.month)+' a month to your committed spend until cancelled.' : 'One-off purchase only — nothing recurring.',
      'Invoiced on '+esc(BUYER.terms)+' against '+esc(BUYER.legal)+'.'
    ],
    footNote:'Median approval time on this account is 1.4 days.',
    onConfirm:(vals)=>{
      const req=createRequisition({reason:(vals||{}).rqWhy});
      if(req.status==='pending'){
        toast('Requisition '+req.id+' submitted — waiting on '+req.need.toLowerCase());
        App.go('approvals');
      } else {
        toast('Within policy — '+lineCount+' order'+(lineCount===1?'':'s')+' placed straight away');
        App.go('orders');
      }
    }
  });
}

/* ------------------------------- 7. Orders -------------------------------- */
function vEOrders(){
  const mine=ORDERS.filter(o=>o.buyer===BUYER.company);
  const open=mine.filter(o=>o.stage<o.stages.length-1&&!o.failed);
  return pagehead('Orders',
    FMT.num(mine.length)+' orders · '+open.length+' in provisioning or delivery · invoiced on '+esc(BUYER.terms),
    exportBtn('Orders','dtEOrd'))+
  '<div class="stack">'+
  '<div class="grid g4">'+
    metric({icon:'orders',label:'Orders',value:String(mine.length),foot:CUR0(mine.reduce((a,o)=>a+o.gross,0))+' total value'})+
    metric({icon:'clock',label:'In flight',value:String(open.length),foot:'Provisioning and delivery'})+
    metric({icon:'checkcircle',label:'Completed',value:String(mine.filter(o=>o.stage===o.stages.length-1&&!o.failed).length),foot:'This financial year'})+
    metric({icon:'group',label:'Sellers',value:String(new Set(mine.map(o=>o.seller)).size),foot:'One invoice covers all of them'})+
  '</div>'+
  (mine.length
    ? mine.slice(0,8).map(o=>
      '<section class="panel"><div class="panel-body">'+
        '<div class="row wrap" style="gap:12px;align-items:flex-start;margin-bottom:12px">'+
          '<span class="cartthumb">'+ICO(VICON[o.v],20)+'</span>'+
          '<div class="grow"><div class="row" style="gap:6px">'+orderStatePill(o)+vBadge(o.v)+'</div>'+
          '<div class="t-sub" style="margin-top:5px">'+esc(o.name)+'</div>'+
          '<div class="t-small muted">'+esc(o.id)+' · '+esc(o.seller)+' · placed '+esc(o.placed)+' · '+o.qty+
            (o.unit?' '+esc(o.unit.replace('per ',''))+(o.qty>1?'s':''):' unit'+(o.qty>1?'s':''))+'</div></div>'+
          '<div style="text-align:right;flex:0 0 auto"><div class="t-sub t-num">'+CUR(o.gross)+'</div>'+
          '<div class="t-tiny muted">'+esc(o.pay)+'</div></div>'+
        '</div>'+
        pipeline(o)+
        '<div class="divider"></div>'+
        '<div class="row wrap"><span class="t-tiny muted grow">'+esc(fulfilLabel(o.fulfil))+'</span>'+
        '<button class="btn btn-sm btn-quiet" onclick="openOrder(\''+o.id+'\')">Details</button>'+
        '<button class="btn btn-sm" onclick="toast(\'Support request raised against '+esc(o.id)+'\')">Get help</button></div>'+
      '</div></section>').join('')+
      (mine.length>8 ? panel(null, dt('dtEOrd',{
        rows:mine.slice(8), noun:'earlier orders', pageSize:12, sortKey:'id', sortDir:'desc', onRow:"openOrder('$ID')",
        searchFields:['id','name','seller','cat'], searchPlaceholder:'Search earlier orders',
        chips:[{key:'v',options:entVerticals().map(v=>({label:vName(v).replace(' Marketplace',''),value:v}))}],
        columns:[
          {key:'id',label:'Order',render:r=>'<div class="cellmain t-num">'+esc(r.id)+'</div><div class="cellsub">'+esc(r.placed)+'</div>'},
          {key:'name',label:'Product',render:r=>'<div class="cellmain">'+esc(r.name)+'</div><div class="cellsub">'+esc(r.cat)+'</div>'},
          {key:'v',label:'Marketplace',render:r=>vBadge(r.v)},
          {key:'seller',label:'Seller',render:r=>esc(r.seller)},
          {key:'qty',label:'Qty',align:'right',render:r=>'<span class="t-num">'+r.qty+'</span>'},
          {key:'gross',label:'Value',align:'right',render:r=>'<span class="t-num cellmain">'+CUR(r.gross)+'</span>'},
          {key:'stage',label:'Status',render:r=>orderStatePill(r)}
        ]}), {flush:true, icon:'history', sub:'Everything older than the eight most recent orders'}) : '')
    : panel(null,stateBlock('empty','No orders yet','Approved requisitions become orders and appear here.'),{flush:true}))+
  /* A buyer reviews too. Their reviews carry more weight than a consumer's,
     because a fleet of forty is a harder test than a single unit. */
  myReviewsPanel(BUYER.company)+
  '</div>';
}

/* --------------------- 8. Subscriptions and licences ---------------------- */
function vESubs(){
  const act=ENT_SUBS.filter(s=>s.status==='active');
  const unassigned=act.reduce((a,s)=>a+(s.seatsTotal-s.seatsUsed),0);
  return pagehead('Subscriptions and licences',
    act.length+' active · '+CUR(ENT_MRC)+' a month · '+unassigned+' seats licensed but unassigned',
    exportBtn('Subscriptions','entSubs')+
    '<button class="btn btn-primary" onclick="App.go(\'browse\')">'+ICO('plus',14)+'Add a service</button>')+
  '<div class="stack">'+
  banner('danger','<strong>Vertex Endpoint Protect will not renew.</strong> The seller was suspended by the marketplace on 11 Jul for repeated provisioning failures. Your 120 licences run to contract end. '+
    '<button class="linkbtn" onclick="openProduct(\'SKU-6002\')">Compare Sentinel MDR</button>')+
  '<div class="grid g4">'+
    metric({icon:'refresh',label:'Active subscriptions',value:String(act.length),foot:'Across '+new Set(act.map(s=>s.v)).size+' marketplaces'})+
    metric({icon:'wallet',label:'Monthly commitment',value:CUR(ENT_MRC),foot:CUR0(ENT_MRC*12)+' annualised'})+
    metric({icon:'users',label:'Seats unassigned',value:String(unassigned),foot:'About '+CUR0(unassigned*6.5)+' a month'})+
    metric({icon:'calendar',label:'Next renewal',value:'01 Oct',foot:'Three Sentinel services renew together'})+
  '</div>'+
  ENT_SUBS.map(s=>
    '<section class="panel"><div class="panel-body">'+
      '<div class="row wrap" style="gap:12px;align-items:flex-start">'+
        '<span class="cartthumb">'+ICO(VICON[s.v],20)+'</span>'+
        '<div class="grow"><div class="row" style="gap:6px">'+statusPill(s.status)+vBadge(s.v)+
          (s.pending?pill('pending',s.pending+' seats pending'):'')+'</div>'+
        '<div class="t-sub" style="margin-top:5px">'+esc(s.name)+'</div>'+
        '<div class="t-small muted">'+esc(s.seller)+' · '+FMT.num(s.qty)+' '+esc(s.unit.replace('per ',''))+'s · '+
          CUR(s.price)+' '+esc(s.unit)+' · renews '+esc(s.renews)+'</div>'+
        (s.note?'<div class="t-small" style="margin-top:7px;color:var(--nim-danger-fg)">'+esc(s.note)+'</div>':'')+
        '</div>'+
        '<div style="text-align:right;flex:0 0 auto"><div class="t-sub t-num">'+CUR(s.monthly)+'</div>'+
        '<div class="t-tiny muted">per month</div></div>'+
      '</div>'+
      (s.status==='active'
        ? '<div class="divider"></div>'+
          '<div class="row" style="gap:14px;flex-wrap:wrap">'+
            '<div style="flex:1 1 300px;min-width:220px">'+
              '<div class="row" style="margin-bottom:5px"><span class="t-small grow">Seats assigned</span>'+
              '<span class="t-small strong t-num">'+s.seatsUsed+' of '+s.seatsTotal+
                (s.pending?' · '+s.pending+' pending':'')+'</span></div>'+
              '<div class="seatbar" role="img" aria-label="'+s.seatsUsed+' of '+s.seatsTotal+' seats assigned">'+
                '<span class="used" style="width:'+(s.seatsUsed/s.seatsTotal*100)+'%"></span>'+
                (s.pending?'<span class="pend" style="width:'+(s.pending/s.seatsTotal*100)+'%"></span>':'')+
              '</div>'+
              '<div class="t-tiny muted" style="margin-top:5px">'+(s.seatsTotal-s.seatsUsed-s.pending)+' unassigned — '+
                CUR((s.seatsTotal-s.seatsUsed-s.pending)*s.price)+' a month</div>'+
            '</div>'+
            '<div class="row" style="gap:7px;align-items:flex-end">'+
              '<button class="btn btn-sm btn-quiet" onclick="openProduct(\''+s.sku+'\')">Listing</button>'+
              '<button class="btn btn-sm" onclick="assignSeats(\''+s.id+'\')">Assign seats</button>'+
              '<button class="btn btn-sm" onclick="changeSeats(\''+s.id+'\')">Change licence count</button>'+
            '</div>'+
          '</div>'
        : '<div class="divider"></div><div class="row"><span class="t-tiny muted grow">No action available on a suspended seller\'s subscription.</span>'+
          '<button class="btn btn-sm btn-primary" onclick="App.go(\'security\')">Find a replacement</button></div>')+
    '</div></section>').join('')+
  '</div>';
}
function assignSeats(id){
  const s=ENT_SUBS.find(x=>x.id===id); if(!s) return;
  const spare=s.seatsTotal-s.seatsUsed;
  if(spare<=0){ toast('Every licence on '+s.name+' is already assigned','warn'); return; }
  confirmAction({title:'Assign seats — '+s.name, subtitle:spare+' unassigned of '+s.seatsTotal, risk:'normal',
    confirmLabel:'Assign', 
    body:'<div class="grid g2">'+
      '<div class="field"><label for="asGroup">Assign to</label><select class="inp" id="asGroup" data-autofocus>'+
        '<option>Pune depot — new starters</option><option>Hyderabad office</option>'+
        '<option>All unassigned staff</option></select></div>'+
      '<div class="field"><label for="asN">How many</label>'+
        '<div class="stepper"><button type="button" onclick="var i=this.nextElementSibling;i.value=Math.max(1,+i.value-5)">'+SH('minus',11)+'</button>'+
        '<input id="asN" value="'+Math.min(spare,10)+'" aria-label="Seats to assign">'+
        '<button type="button" onclick="var i=this.previousElementSibling;i.value=+i.value+5">+</button></div></div></div>',
    impact:['Assigned seats are provisioned by '+esc(s.seller)+', usually within a working day.',
            'Nothing is charged — you already pay for these licences whether they are assigned or not.',
            'Unassigning later frees the seat immediately for someone else.'],
    onConfirm:(vals)=>{
      const n=Math.min(spare, Math.max(1, parseInt((vals||{}).asN,10)||1));
      s.seatsUsed+=n; s.pending=Math.max(0,(s.pending||0)-n);
      recomputeDerived();
      toast(n+' seat'+(n===1?'':'s')+' assigned on '+s.name);
      App.go('subs');
    }});
}
function changeSeats(id){
  const s=ENT_SUBS.find(x=>x.id===id); if(!s) return;
  const spare=s.seatsTotal-s.seatsUsed;
  confirmAction({
    title:'Change licence count — '+s.name, subtitle:s.seatsTotal+' licensed, '+s.seatsUsed+' assigned · '+CUR(s.price)+' '+s.unit,
    risk:'normal', confirmLabel:'Request the change',
    body:'<div class="grid g2">'+
      '<div class="field"><label for="csNew">New licence count</label>'+
        '<div class="stepper"><button type="button" onclick="var i=this.nextElementSibling;i.value=Math.max(0,+i.value-10)">'+SH('minus',11)+'</button>'+
        '<input id="csCount" value="'+s.seatsTotal+'" aria-label="Licence count"><button type="button" onclick="var i=this.previousElementSibling;i.value=+i.value+10">+</button></div></div>'+
      '<div class="field"><label for="csWhen">Effective</label><select class="inp" id="csWhen">'+
        '<option>Immediately (pro-rated)</option><option selected>At the next renewal</option></select></div></div>',
    impact:[
      'You currently pay for <strong>'+spare+' unassigned seat'+(spare===1?'':'s')+'</strong> — about '+CUR(spare*s.price)+' a month.',
      'Reductions take effect at renewal unless you choose immediate, which is pro-rated by the seller.',
      'Increases are provisioned by '+esc(s.seller)+' and are usually live within a working day.',
      'A change above '+CUR0(2000)+' a month goes to '+esc(BUYER.approver)+' for approval first.'
    ],
    footNote:'Licence counts step in blocks on some services — the seller confirms the achievable number.',
    onConfirm:(vals)=>{
      const n=Math.max(s.seatsUsed, parseInt((vals||{}).csCount,10)||s.seatsTotal);
      const delta=n-s.seatsTotal;
      s.qty=n; s.seatsTotal=n; s.monthly=+(n*s.price).toFixed(2);
      recomputeDerived();
      toast(delta>0 ? delta+' licences added — '+s.seller+' is provisioning them'
                    : delta<0 ? Math.abs(delta)+' licences released at the next renewal'
                    : 'No change to the licence count');
      App.go('subs');
    }
  });
}

/* ------------------------------- 9. Billing ------------------------------- */
/* Hoisted so the bill generator can find the record behind the row. */
let ENT_INVOICES=null;
function entInvoices(){
  if(ENT_INVOICES) return ENT_INVOICES;
  ENT_INVOICES=[
    {id:'INV-2026-0714', period:'Jul 2026', issued:'01 Aug 2026', due:'31 Aug 2026', recurring:ENT_MRC, oneoff:2450.00, status:'open'},
    {id:'INV-2026-0613', period:'Jun 2026', issued:'01 Jul 2026', due:'31 Jul 2026', recurring:ENT_MRC, oneoff:1914.00, status:'overdue'},
    {id:'INV-2026-0512', period:'May 2026', issued:'01 Jun 2026', due:'30 Jun 2026', recurring:ENT_MRC-576, oneoff:4800.00, status:'paid'},
    {id:'INV-2026-0411', period:'Apr 2026', issued:'01 May 2026', due:'31 May 2026', recurring:ENT_MRC-576, oneoff:0, status:'paid'},
    {id:'INV-2026-0310', period:'Mar 2026', issued:'01 Apr 2026', due:'30 Apr 2026', recurring:ENT_MRC-576, oneoff:389.00, status:'paid'}
  ].map(i=>Object.assign(i,{tax:+((i.recurring+i.oneoff)*0.18).toFixed(2),
                            total:+((i.recurring+i.oneoff)*1.18).toFixed(2)}));
  return ENT_INVOICES;
}
function vEBilling(){
  const inv=entInvoices();
  const due=inv.filter(i=>i.status!=='paid').reduce((a,i)=>a+i.total,0);
  return pagehead('Billing',
    'One invoice covers every seller on the marketplace · '+esc(BUYER.terms)+' · '+CUR(due)+' outstanding',
    exportBtn('Invoices','dtEInv')+

    '<button class="btn btn-primary" onclick="toast(\'Payment initiated — remittance advice will follow\')">'+ICO('wallet',14)+'Pay '+CUR0(due)+'</button>')+
  '<div class="stack">'+
  banner('danger','<strong>'+inv[1].id+' is overdue.</strong> '+CUR(inv[1].total)+' was due '+esc(inv[1].due)+'. Late payment can suspend new orders across every seller on the account.')+
  /* What is actually scheduled against that overdue balance, with dates. A
     warning that says "can suspend" without saying when is not a warning. */
  arrearsPanel('buyer')+
  '<div class="grid g4">'+
    metric({icon:'wallet',label:'Outstanding',value:CUR(due),foot:inv.filter(i=>i.status!=='paid').length+' unsettled invoices'})+
    metric({icon:'refresh',label:'Recurring per month',value:CUR(ENT_MRC),foot:ENT_SUBS.filter(s=>s.status==='active').length+' subscriptions'})+
    metric({icon:'pie',label:'Budget used',value:FMT.pct(BUYER.budgetSpent/BUYER.budgetYear*100),
      foot:CUR0(BUDGET_LEFT)+' of '+CUR0(BUYER.budgetYear)+' left'})+
    metric({icon:'group',label:'Sellers on one invoice',value:String(new Set(ENT_SUBS.map(s=>s.seller)).size),
      foot:'Consolidated by the marketplace'})+
  '</div>'+
  panel('Invoices', dt('dtEInv',{
    rows:inv, noun:'invoices', pageSize:10, toolbar:false, sortKey:'id', sortDir:'desc',
    columns:[
      {key:'id',label:'Invoice',render:r=>'<div class="cellmain t-num">'+esc(r.id)+'</div><div class="cellsub">'+esc(r.period)+'</div>'},
      {key:'issued',label:'Issued',render:r=>esc(r.issued)},
      {key:'due',label:'Due',render:r=>esc(r.due)},
      {key:'recurring',label:'Subscriptions',align:'right',render:r=>'<span class="t-num">'+CUR(r.recurring)+'</span>'},
      {key:'oneoff',label:'One-off',align:'right',render:r=>r.oneoff?'<span class="t-num">'+CUR(r.oneoff)+'</span>':'<span class="dim">—</span>'},
      {key:'tax',label:'Tax',align:'right',render:r=>'<span class="t-num">'+CUR(r.tax)+'</span>'},
      {key:'total',label:'Total',align:'right',render:r=>'<span class="t-num cellmain">'+CUR(r.total)+'</span>'},
      {key:'status',label:'State',render:r=>r.status==='overdue'?pill('overdue'):statusPill(r.status)},
      {key:'__acts',label:'',sort:false,render:r=>actionCell(
        '<button class="btn btn-sm btn-quiet" onclick="event.stopPropagation();downloadEnterpriseBill('+
          'entInvoices().filter(function(x){return x.id===\''+r.id+'\'})[0])">Bill</button>',
        r.status==='paid'
          ? actionDone('Paid', r.paidOn||'')
          : '<button class="btn btn-sm btn-primary" onclick="event.stopPropagation();toast(\''+esc(r.id)+
            ' payment initiated\')">Pay</button>',
        {width:'86px'})}
    ]}),{flush:true,icon:'invoice'})+
  '<div class="grid g2">'+
    panel('This month by seller',
      '<table class="tbl"><thead><tr><th>Seller</th><th>Marketplace</th><th class="num">Monthly</th><th class="num">Share</th></tr></thead><tbody>'+
      Array.from(new Set(ENT_SUBS.filter(s=>s.status==='active').map(s=>s.seller))).map(sel=>{
        const v=ENT_SUBS.filter(s=>s.seller===sel&&s.status==='active');
        const amt=v.reduce((a,s)=>a+s.monthly,0);
        return '<tr><td class="cellmain">'+esc(sel)+'</td><td>'+vBadge(v[0].v)+'</td>'+
        '<td class="num t-num">'+CUR(amt)+'</td><td class="num t-num">'+FMT.pct(amt/ENT_MRC*100)+'</td></tr>';
      }).join('')+'</tbody></table>',
      {flush:true,icon:'group',
       sub:'The marketplace settles each seller separately — you receive and pay one invoice'})+
    panel('Cost centre split',
      CH.stack([{label:'CC-2200 · IT and infrastructure',parts:[ENT_MRC*0.72]},
                {label:'CC-4100 · Logistics',parts:[ENT_MRC*0.19]},
                {label:'CC-1000 · Corporate',parts:[ENT_MRC*0.09]}],
        {names:['Monthly'],fmt:n=>CUR0(n)})+
      '<div class="divider"></div>'+
      '<div class="row"><span class="t-small muted grow">Unallocated — device purchases without a cost centre</span>'+
      '<span class="t-small">'+NA('Not allocated')+'</span></div>',
      {icon:'pie'})+
  '</div>'+
  /* Bill formatting belongs to whoever issues the document. A buyer receives
     the marketplace's invoice; letting them restyle it would produce two
     parties holding different versions of the same legal record. What they
     legitimately control — where it goes and how it is broken down — lives in
     the delivery and cost-centre panels above. */
  buyerTaxPanel()+
  '</div>';
}

/* --------------------- 10. Users and roles (the buyer org) ---------------- */
function vEUsers(){
  return usersView({
    ctx:'buyer', title:'Users and roles', userNoun:'user',
    inviteLabel:'Invite a user', dirTitle:'People at '+BUYER.company,
    roleSub:'Roles mirror the approval policy: a requester cannot approve their own requisition, and only finance can approve above the threshold.',
    mfaNote:'Required for anyone who can approve or pay',
    banner:banner('info','Roles here decide who can raise, who can approve and who can only look. '+
      'They are the same roles the approval policy refers to, so changing a role changes who a requisition routes to. '+
      '<button class="linkbtn" onclick="App.go(\'approvals\')">See the policy</button>')
  });
}

registerExport('entSubs',()=>({
  columns:[{key:'name',label:'Subscription'},{key:'sku',label:'SKU'},{key:'seller',label:'Seller'},
           {key:'marketplace',label:'Marketplace'},{key:'seats',label:'Seats'},{key:'used',label:'Seats assigned'},
           {key:'monthly',label:'Monthly (USD)'},{key:'renews',label:'Renews'},{key:'status',label:'Status'}],
  rows:ENT_SUBS.map(s=>({name:s.name, sku:s.sku, seller:s.seller, marketplace:vName(s.v),
    seats:s.seats==null?'Not seat based':s.seats, used:s.used==null?'Not seat based':s.used,
    monthly:s.monthly, renews:s.renews, status:s.status}))
}));

/* Spend projection, built from this buyer's own committed run rate. */
function entSpendSeries(){
  return HISTORY.map(function(h,i){
    return {month:h.month, orders:h.orders,
            gross:+((ENT_MRC*(0.86+i*0.022)) + (i%3===0?2450:0)).toFixed(2)};
  });
}

/* -------------------- 15. Contract pricing -------------------------------- */
function vEContracts(){
  const mine=CONTRACT_PRICES.filter(c=>c.account===BUYER.company);
  const saving=mine.filter(c=>c.price).reduce((a,c)=>{
    const p=SKUMAP[c.sku]; return a+(p?(p.price-c.price)*c.minQty:0); },0);
  return pagehead('Contract pricing',
    mine.length+' negotiated price'+(mine.length===1?'':'s')+' · '+esc(BUYER.company),
    exportBtn('Contract pricing','dtContract'))+
  '<div class="stack">'+
  banner('info','<strong>These prices apply to your account only</strong>, and only at or above the stated minimum '+
    'quantity. Below it you pay list. They are checked at checkout automatically — there is no code to enter and '+
    'nothing to claim afterwards. A price that has been discussed but <strong>not signed is recorded without a '+
    'figure and is not applied</strong>, so nothing is discounted early by accident.')+
  '<div class="grid g3">'+
    metric({icon:'file',label:'Negotiated prices',value:String(mine.length),
      foot:mine.filter(c=>!c.price).length?mine.filter(c=>!c.price).length+' awaiting signature':'All active'})+
    metric({icon:'wallet',label:'Saving at minimum volume',value:saving?CUR0(saving):null,
      naLabel:'Nothing agreed yet', foot:'Against list price, at the committed quantities'})+
    metric({icon:'clock',label:'Earliest expiry',
      value:mine.length?mine.slice().sort(function(a,b){return a.to<b.to?-1:1})[0].to:null,
      naLabel:'None', foot:'Renegotiate before this, not after'})+
  '</div>'+
  contractPricingPanel({account:BUYER.company, title:'Your negotiated prices'})+
  '</div>';
}

/* -------------------- 14. Support tickets --------------------------------- */
function vETickets(){
  return ticketsView({ctx:'buyer', title:'Support'});
}

/* -------------------- 13. Audit log --------------------------------------- */
function vEAudit(){
  return auditView({ctx:'buyer', title:'Audit log',
    banner:banner('info','<strong>Who approved what, and when.</strong> This is the evidence trail behind your '+
      'procurement: requisitions raised and decided, spend caps changed, roles granted. It is append-only, so it '+
      'is defensible in an internal audit. What you can read depends on your role.')});
}

/* -------------------- 12. My details -------------------------------------- */
function vEProfile(){
  return myDetailsView({ctx:'buyer', org:BUYER.company,
    delegateNote:'A delegate can approve requisitions up to your own limit while you are away. Anything above it still '+
      'escalates — a delegation does not raise a threshold.'})+
  buyerBillingView();
}

/* A buyer is the mirror of a seller. We do not pay them, they pay us, so what
   they hold here is a payment instruction, a tax registration and a credit
   position — not a settlement account. The mandate reference is still masked,
   because a direct debit authority is worth quoting to somebody. */
function buyerBillingView(){
  const b=BUYER_BILLING, t=BUYER_TAX;
  const head=+(b.creditUsed/b.creditLimit*100).toFixed(1);
  return panel('How you pay us',
    (b.verified
      ? banner('info','<strong>Mandate verified on '+esc(b.verifiedOn)+' by '+esc(b.verifiedBy)+'.</strong> '+
        'Collections run on the due date of each invoice, and nothing is collected outside one.')
      : banner('warning','<strong>The mandate is not verified.</strong> Invoices fall due for manual '+
        'payment until it is.'))+
    dl([['Method', b.method],
        ['Bank', b.bank],
        ['Account holder', b.holder],
        ['Account number', '<span class="t-num">'+maskAcct(b.account)+'</span>'],
        [b.localLabel, '<span class="t-num">'+maskTail(b.localCode,3)+'</span>'],
        ['Mandate reference', '<span class="t-num">'+maskTail(b.mandate,4)+'</span>'],
        ['Mandate signed', b.mandateSignedOn+' by '+b.mandateSignedBy],
        ['If a collection fails', b.fallback],
        ['Payment terms', b.terms],
        ['Invoices sent to', b.billingContact],
        ['Invoice format', b.invoiceDelivery]])+
    '<div class="row wrap" style="gap:8px;margin-top:9px">'+
      '<span class="t-tiny muted grow">Masked here on purpose. Showing the whole mandate is a separate, '+
        'logged action.</span>'+
      (typeof mayRevealBank==='function' && mayRevealBank()
        ? '<button class="btn btn-sm" onclick="revealBuyerBilling()">'+ICO('eye',13)+'Show in full</button>'
        : '<span class="t-tiny muted">'+ICO('lock',12)+' Finance role only</span>')+
    '</div>',
    {icon:'wallet',
     acts:'<button class="btn btn-sm btn-primary" onclick="changeBuyerMandate()">'+ICO('settings',13)+
       'Change how you pay</button>'})+

  panel('Credit position',
    meter(head, CUR0(b.creditUsed)+' of '+CUR0(b.creditLimit))+
    dl([['Limit', CUR0(b.creditLimit)+' on '+b.terms],
        ['Committed', CUR0(b.creditUsed)],
        ['Headroom', CUR0(b.creditLimit-b.creditUsed)],
        ['What happens at the limit', 'A requisition that would take the balance past it is held, not '+
          'refused. Finance is told and can release it against an early payment.'],
        ['Reviewed', 'Annually, and on any request that would cross the limit']]),
    {icon:'chart'})+

  panel('Tax registration',
    banner('info','<strong>Your place of supply decides the rate on every invoice we raise.</strong> It '+
      'comes from the registered address, not the delivery address, which is why changing a site does not '+
      'change the tax.')+
    dl([[t.regType, '<span class="t-num">'+maskTaxId(t.registration)+'</span>'],
        ['Place of supply', t.placeOfSupply],
        ['Reverse charge', t.reverseCharge? 'Applies — you account for the tax' : 'Does not apply'],
        ['Exempt', t.exempt? 'Yes — certificate '+(t.exemptCert||'on file') : 'No'],
        ['Purchase order required on every invoice', t.poRequired? 'Yes' : 'No'],
        ['Cost centre shown on invoice lines', t.costCentreOnInvoice? 'Yes' : 'No']]),
    {icon:'file',
     acts:'<button class="btn btn-sm" onclick="editBuyerTaxDialog()">'+ICO('settings',13)+
       'Update registration</button>'})+

  panel('What was checked when the account was opened',
    '<p class="t-small">A buying account is a credit and compliance decision. This is the record it was '+
    'opened on, and the same one our finance desk reads.</p>'+
    '<div class="stack" style="gap:9px">'+BUYER_ONBOARDING.map(c=>
      '<section class="modcard"><div class="modcard-head">'+
        '<div class="grow"><div class="t-sub">'+esc(c.name)+'</div>'+
        '<div class="t-tiny muted">'+(c.state==='done'
          ? esc(c.on)+' · '+esc(c.by) : esc(c.on))+'</div></div>'+
        (c.state==='done'? pill('approved','Complete') : pill('pending','Due'))+'</div>'+
      '<div class="modcard-body">'+
        '<p class="t-small" style="margin:0">'+esc(c.detail)+'</p>'+
        (c.docs.length
          ? '<div class="divider"></div><div class="stack" style="gap:6px">'+c.docs.map(dd=>
              '<div class="row" style="gap:9px">'+
              '<span class="cartthumb" style="width:28px;height:28px">'+ICO('file',13)+'</span>'+
              '<div class="grow"><div class="t-small strong">'+esc(dd[0])+'</div>'+
              '<div class="t-tiny muted">'+esc(dd[1])+' · '+esc(dd[2])+'</div></div>'+
              '<button class="btn btn-sm btn-quiet" onclick="viewGateDoc('+
                JSON.stringify(dd[0]).replace(/"/g,'&quot;')+','+
                JSON.stringify(BUYER.company).replace(/"/g,'&quot;')+')">View</button></div>').join('')+
            '</div>'
          : '')+
      '</div></section>').join('')+'</div>',
    {icon:'checklist',
     sub:BUYER_ONBOARDING.filter(c=>c.state==='done').length+' of '+BUYER_ONBOARDING.length+' complete'});
}
function revealBuyerBilling(){
  const b=BUYER_BILLING;
  confirmAction({title:'Show the full payment instruction',
    subtitle:BUYER.company+' · '+b.bank, risk:'high', confirmLabel:'Show it once',
    body:banner('warning','<strong>This is logged with your name against it.</strong> A direct debit '+
      'mandate reference is enough for somebody to quote it convincingly.')+
      '<div class="field"><label for="rvWhy">Why you need it</label>'+
      '<input class="inp" id="rvWhy" placeholder="Reconciling a returned collection on INV-2026-0613" '+
      'data-autofocus></div>',
    impact:['The account number and mandate reference are shown once.',
            'Closing the panel hides them again.',
            '<strong>An entry naming you and your reason goes to the audit log.</strong>'],
    validate:(v)=>((v&&v.rvWhy)||'').trim() ? null
      : '<strong>A reason is required.</strong> An unexplained look at a payment instruction is the one '+
        'nobody can defend afterwards.',
    onConfirm:(v)=>{
      if(typeof audit==='function') audit('bank.revealed',{object:BUYER.company,
        detail:((v&&v.rvWhy)||'').trim(), sev:'high'});
      openModal('<div class="modal-head">'+ICO('lock',18)+'<div class="grow">'+
          '<h3 class="t-sub">Payment instruction — '+esc(BUYER.company)+'</h3>'+
          '<div class="t-small muted">Shown once · logged</div></div>'+
          '<button class="iconbtn" onclick="closeModal()" aria-label="Close">'+ICO('x',16)+'</button></div>'+
        '<div class="modal-body stack">'+
          dl([['Account holder', b.holder],['Bank', b.bank],
              ['Account number','<span class="t-num">'+esc(b.account)+'</span>'],
              [b.localLabel,'<span class="t-num">'+esc(b.localCode)+'</span>'],
              ['Mandate reference','<span class="t-num">'+esc(b.mandate)+'</span>']])+
          banner('info','<strong>Closing this hides it again.</strong>')+
        '</div><div class="modal-foot"><div class="spacer"></div>'+
        '<button class="btn btn-primary" onclick="closeModal()">Done</button></div>',
        {wide:true,label:'Payment instruction'});
    }});
}
function changeBuyerMandate(){
  const b=BUYER_BILLING;
  confirmAction({title:'Change how you pay',
    subtitle:'Currently '+b.method+' · '+maskAcct(b.account),
    risk:'high', confirmLabel:'Submit for verification',
    body:banner('warning','<strong>A new mandate does not take effect on save.</strong> It is verified '+
      'with the bank first. Invoices already issued keep collecting on the mandate in force when they '+
      'were raised, so nothing falls between the two.')+
      '<div class="grid g2">'+
        '<div class="field"><label for="bmMethod">Method</label><select class="inp" id="bmMethod">'+
          ['Direct debit','Bank transfer against the invoice','Corporate card']
            .map(x=>'<option'+(b.method===x?' selected':'')+'>'+esc(x)+'</option>').join('')+
          '</select></div>'+
        '<div class="field"><label for="bmBank">Bank</label>'+
          '<input class="inp" id="bmBank" placeholder="'+esc(b.bank)+'" data-autofocus></div>'+
        '<div class="field"><label for="bmAcct">Account number</label>'+
          '<input class="inp" id="bmAcct" placeholder="Digits only"></div>'+
        '<div class="field"><label for="bmAcct2">Confirm the account number</label>'+
          '<input class="inp" id="bmAcct2" placeholder="Type it again"></div>'+
      '</div>'+
      '<div class="field"><label for="bmWhy">Why it is changing</label>'+
        '<input class="inp" id="bmWhy" placeholder="Moved banking to a new provider"></div>',
    impact:['The request goes to the marketplace finance desk for verification.',
            'Collections continue on the current mandate until the new one is confirmed.',
            'Your finance director is told, whoever raised the change.'],
    validate:(v)=>{
      const a=((v&&v.bmAcct)||'').replace(/\s+/g,''), a2=((v&&v.bmAcct2)||'').replace(/\s+/g,'');
      if(!((v&&v.bmBank)||'').trim()) return '<strong>Name the bank.</strong>';
      if(!a) return '<strong>Enter the account number.</strong>';
      if(a!==a2) return '<strong>The two account numbers do not match.</strong> This is the one field '+
        'where a typo collects from the wrong account.';
      if(!((v&&v.bmWhy)||'').trim()) return '<strong>Say why it is changing.</strong> An unexplained '+
        'change of payment instruction is the shape every takeover attempt takes.';
      return null;
    },
    onConfirm:(v)=>{
      const a=((v&&v.bmAcct)||'').replace(/\s+/g,'');
      BUYER_BILLING.pending={method:v.bmMethod, bank:v.bmBank, account:a, why:v.bmWhy,
        requestedOn:TODAY};
      if(typeof audit==='function') audit('bank.recorded',{object:BUYER.company,
        before:maskAcct(b.account), after:maskAcct(a),
        detail:'Payment instruction change requested — '+v.bmWhy, sev:'high'});
      toast('Sent for verification — collections stay on the current mandate until it is confirmed');
      App.go(App.view);
    }});
}
function editBuyerTaxDialog(){
  const t=BUYER_TAX;
  confirmAction({title:'Update the tax registration',
    subtitle:t.regType+' · '+t.placeOfSupply, risk:'normal', confirmLabel:'Save',
    body:banner('warning','<strong>This changes the rate on every invoice we raise from the next one.</strong> '+
      'It is not applied backwards — an invoice already issued is a document that was correct when it '+
      'was raised, and it is credited and reissued rather than edited.')+
      '<div class="grid g2">'+
        '<div class="field"><label for="btReg">'+esc(t.regType)+'</label>'+
          '<input class="inp" id="btReg" value="'+esc(t.registration)+'" data-autofocus></div>'+
        '<div class="field"><label for="btPos">Place of supply</label>'+
          '<input class="inp" id="btPos" value="'+esc(t.placeOfSupply)+'"></div>'+
      '</div>'+
      '<label class="checkline"><input type="checkbox" id="btPo"'+(t.poRequired?' checked':'')+
        '> Require a purchase order number on every invoice</label>'+
      '<label class="checkline"><input type="checkbox" id="btCc"'+(t.costCentreOnInvoice?' checked':'')+
        '> Show the cost centre on every invoice line</label>',
    impact:['The next invoice we raise uses the new registration and place of supply.',
            'Invoices already issued are unchanged — they were correct when raised.',
            'Turning the purchase order requirement off means an invoice can be raised without one, '+
              'which your accounts payable may then reject.'],
    validate:(v)=>((v&&v.btReg)||'').trim() ? null
      : '<strong>A registration number is required.</strong> Without it the invoice is not compliant '+
        'and your input credit cannot be claimed.',
    onConfirm:(v)=>{
      const before=t.registration;
      t.registration=((v&&v.btReg)||'').trim();
      t.placeOfSupply=((v&&v.btPos)||'').trim()||t.placeOfSupply;
      t.poRequired=!!(v&&v.btPo);
      t.costCentreOnInvoice=!!(v&&v.btCc);
      if(typeof audit==='function') audit('tax.changed',{object:BUYER.company,
        before:maskTaxId(before), after:maskTaxId(t.registration),
        detail:'Place of supply '+t.placeOfSupply+' · PO required '+(t.poRequired?'yes':'no')});
      toast('Tax registration saved — it applies from the next invoice');
      App.go(App.view);
    }});
}

/* -------------------- 10b. Roles configuration ---------------------------- */
function vERoles(){
  return rolesView({
    ctx:'buyer', title:'Roles configuration',
    banner:banner('info','These roles are what the approval policy refers to by name, so a change here changes who a '+
      'requisition routes to. A requester still cannot approve their own request, whatever the grid says. '+
      '<button class="linkbtn" onclick="App.go(\'approvals\')">See the policy</button>')
  });
}

/* -------------------- 11. Notification rules (the buyer org) -------------- */
function vENotif(){
  return notifView({
    ctx:'buyer', title:'Notifications',
    scopeNote:'scoped to '+esc(BUYER.company)+' · rules address roles, so they follow people as roles change',
    quietNote:'Overdue invoices and seller suspensions always come through.',
    escalateLabel:'Escalate a requisition that has waited more than 2 working days',
    prefScope:'everyone in the organisation', sentCount:'73',
    /* An enterprise administers its own alerting — rules addressed to roles
       follow people as roles change, which is the point. It does not author
       the marketplace's message templates: two parties editing one document
       is how a customer ends up quoting wording nobody here recognises. */
    messages:false,
    banner:banner('warning','<strong>Budget threshold alerts are off.</strong> Committed spend is at '+
      FMT.pct(BUYER.budgetSpent/BUYER.budgetYear*100)+' of the annual budget — turning that rule on would have told you at 80%.')
  });
}

/* ------------------------------- registration ---------------------------- */
function vERefunds(){ return refundsView({ctx:'buyer', title:'Refunds'}); }
function vEIntegration(){ return buyerIntegrationView(); }
function vERewards(){ return rewardsMemberView({memberId:'LM-4101', ctx:'buyer'}); }
const VIEWS={
  rewards:vERewards, refunds:vERefunds, integration:vEIntegration,
  help:vEHelp,
  bulk:vEBulk,
  delivery:vEDelivery,
  auth:vEAuth,
  home:vEHome, browse:vEBrowse, iot:vEIot, security:vESecurity, devices:vEDevices,
  approvals:vEApprovals, orders:vEOrders, subs:vESubs, billing:vEBilling,
  users:vEUsers, roles:vERoles, notifications:vENotif, audit:vEAudit,
  tickets:vETickets, contracts:vEContracts, profile:vEProfile
};
function AFTER_RENDER(){ updateCartBadge(); }

/* Dependency checks read the buyer's holdings, and this side of the
   marketplace holds contracted services rather than personal subscriptions. */
setBuyCtx('enterprise');

App.init({
  brand:'neutral', cart:true,
  orgCtx:'buyer', profileView:'profile', securityView:'users',
  profileSub:'Name, contact, time zone and cover while you are away',
  signedIn:'today at 09:12',
  product:'Business Marketplace', tier:'White-label · '+MP.operator,
  env:'Enterprise buyer portal',
  persona:{name:BUYER.who, role:BUYER.role, org:BUYER.company},
  searchScope:'the business catalogue', alertCount:3,
  notifications:[
    {when:'35 min ago', text:'Vertex Endpoint was suspended by the marketplace — your 120 licences will not renew', source:'Subscriptions', kind:'danger', read:false},
    {when:'2 h ago', text:'Invoice INV-2026-0613 is overdue', source:'Billing', kind:'danger', read:false},
    {when:'Today 08:40', text:'Ravi Krishnan raised a '+CUR(2450)+' requisition needing finance approval', source:'Approvals', kind:'warning', read:false},
    {when:'Yesterday', text:'25 cold-chain sensors delivered to the Pune depot — no telemetry received yet', source:'Orders', kind:'warning', read:true}
  ],
  footNote:BUYER.id+' · '+BUYER.sites+' sites',
  aiName:'Procurement assistant',
  aiGreeting:'I can help with what you already hold, what it costs, and what is waiting for approval. I only see <strong>'+esc(BUYER.company)+'</strong>.'+
    '<div class="src">Sources: your subscriptions, orders, approvals, invoices, seat assignments.</div>',
  aiSuggestions:['Where are we wasting licence spend?','What happens to our Vertex subscription?','What is waiting on approval?','How much of the budget is left?'],
  nav:[
    {label:'Overview', items:[{id:'home', label:'Dashboard', icon:'dashboard'}]},
    {label:'Buy', items:[
      {id:'browse', label:'Catalogue', icon:'search', count:()=>entCatalogue().length},
      {id:'iot', label:'IoT', icon:'cpu'},
      {id:'security', label:'Security', icon:'shield'},
      {id:'devices', label:'Devices', icon:'monitor'}]},
    {label:'Govern', items:[
      {id:'approvals', label:'Approvals', icon:'checklist', count:()=>APR_PENDING.length},
      {id:'orders', label:'Orders', icon:'orders', count:()=>ORDERS.filter(o=>o.buyer===BUYER.company).length},
      {id:'refunds', label:'Refunds', icon:'refresh',
       count:()=>REFUNDS.filter(r=>r.ctx==='buyer' && (r.state==='requested'||r.state==='escalated')).length}]},
    {label:'Run', items:[
      {id:'subs', label:'Subscriptions', icon:'refresh', count:()=>ENT_SUBS.filter(s=>s.status==='active').length},
      {id:'billing', label:'Billing', icon:'invoice'},
      {id:'integration', label:'Integration', icon:'plug', count:()=>buyerApis().length},
      {id:'rewards', label:'Rewards', icon:'zap', count:()=>LTXFOR('LM-4101').length},
      {id:'contracts', label:'Contract pricing', icon:'file',
       count:()=>CONTRACT_PRICES.filter(c=>c.account===BUYER.company).length},
      {id:'tickets', label:'Support', icon:'support',
       count:()=>tktVisible('buyer').filter(t=>['new','open','waiting','escalated'].indexOf(t.state)>-1).length}]},
    {label:'Administration', items:[
      {id:'users', label:'Users', icon:'shield',
       count:()=>orgUsers('buyer').filter(u=>u.status!=='removed').length},
      {id:'bulk', label:'Bulk updates', icon:'upload', count:()=>bulkSets().length},
      {id:'roles', label:'Roles configuration', icon:'key', count:()=>orgRoles('buyer').length},
      {id:'auth', label:'Sign-in and sessions', icon:'lock', count:()=>(SESSIONS.buyer||[]).length},
      {id:'notifications', label:'Notifications', icon:'bell'},
      {id:'delivery', label:'Message delivery', icon:'zap',
       count:()=>DELIVERIES.filter(d=>d.ctx==='buyer'&&(d.state==='failed'||d.state==='expired')).length},
      {id:'help', label:'Knowledge base', icon:'file', count:()=>(KB_ARTICLES.buyer||[]).length},
      {id:'audit', label:'Audit log', icon:'history',
       count:()=>auditRows('buyer').filter(e=>e.sev==='high').length},
      {id:'profile', label:'My details', icon:'user'}]}
  ],
  searchIndex:entCatalogue().slice(0,12).map(p=>({k:VMAP[p.v].name.replace(' Marketplace',''), t:p.name+' — '+CUR(p.price), v:'browse'}))
    .concat([{k:'Screen',t:'Approvals and requisition policy',v:'approvals'},
             {k:'Screen',t:'Rewards earned on organisation spend',v:'rewards'},
             {k:'Screen',t:'Subscriptions and licence seats',v:'subs'},
             {k:'Screen',t:'Consolidated billing',v:'billing'},
             {k:'Screen',t:'Orders and provisioning',v:'orders'},
             {k:'Screen',t:'Users and roles',v:'users'},
             {k:'Screen',t:'Notification rules',v:'notifications'}]),
  aiAnswer(q){
    if(/waste|unassigned|seat|licence|license|saving/.test(q)){
      const act=ENT_SUBS.filter(s=>s.status==='active');
      return 'You are paying for seats nobody holds:'+
        '<table><tr><th>Service</th><th>Unassigned</th><th>Monthly</th></tr>'+
        act.filter(s=>s.seatsTotal>s.seatsUsed).map(s=>'<tr><td>'+esc(s.name)+'</td><td>'+(s.seatsTotal-s.seatsUsed)+'</td>'+
        '<td>'+CUR((s.seatsTotal-s.seatsUsed)*s.price)+'</td></tr>').join('')+'</table>'+
        'That is roughly '+CUR(act.reduce((a,s)=>a+(s.seatsTotal-s.seatsUsed)*s.price,0))+' a month. '+
        'Some slack is unavoidable because licences step in blocks, but MDR and ZTNA are both more than one block over.'+
        '<div class="src">Sources: your subscriptions, seat assignment records.</div>';
    }
    if(/vertex|suspend|renew|replace/.test(q))
      return '<strong>Vertex Endpoint Protect</strong> — 120 endpoints at '+CUR(4.80)+' each, '+CUR(576)+' a month.'+
        '<br><br>The marketplace suspended Vertex Endpoint on 11 Jul after provisioning failed on 9 of 12 orders. Practically:'+
        '<table><tr><th>What</th><th>When</th></tr>'+
        '<tr><td>Service continues</td><td>To contract end</td></tr>'+
        '<tr><td>Renewal offered</td><td>No</td></tr>'+
        '<tr><td>New seats</td><td>Not available</td></tr></table>'+
        'You already hold <strong>Sentinel MDR</strong> on 620 endpoints at '+CUR(9.50)+' each. Extending it to these 120 costs '+CUR(1140)+' a month — '+
        'more than Vertex, though MDR is a different service with a 24/7 SOC rather than endpoint protection alone.'+
        '<div class="src">Sources: your subscriptions, marketplace partner status, security catalogue.</div>';
    if(/approv|waiting|requisition|pending/.test(q))
      return APR_PENDING.length+' requisitions are waiting.'+
        '<table><tr><th>Item</th><th>Value</th><th>Needs</th></tr>'+
        APR_PENDING.map(a=>'<tr><td>'+esc(a.item)+'<br><span style="color:#666">'+esc(a.requester)+'</span></td>'+
        '<td>'+CUR(a.amount)+'</td><td>'+esc(a.need)+'</td></tr>').join('')+'</table>'+
        'The '+CUR(2450)+' cold-chain order is the one holding up the Pune depot commissioning.'+
        '<div class="src">Sources: approval queue, requisition records, policy thresholds.</div>';
    if(/budget|spend|left|remaining/.test(q))
      return 'You have used <strong>'+CUR(BUYER.budgetSpent)+'</strong> of a '+CUR(BUYER.budgetYear)+' budget — '+
        FMT.pct(BUYER.budgetSpent/BUYER.budgetYear*100)+', with '+CUR(BUDGET_LEFT)+' left.'+
        '<br><br>Committed recurring spend is '+CUR(ENT_MRC)+' a month. If nothing changes, subscriptions alone consume '+
        CUR(ENT_MRC*3)+' of what remains over the next quarter, leaving '+CUR(BUDGET_LEFT-ENT_MRC*3)+' for anything new.'+
        '<div class="src">Sources: invoice history, active subscriptions, budget record.</div>';
    return null;
  }
});

/* --------------------- DELIVERY AND SIGN-IN (M20) ------------------------ */
function vEDelivery(){
  return deliveryView({title:'Message delivery', rows:DELIVERIES.filter(d=>d.ctx==='buyer'),
                       providers:false, spend:false, channels:false, cost:false});
}
function vEAuth(){ return vAuth(); }

/* --------------------- BULK UPDATE (M21) -------------------------------- */
function vEBulk(){ return bulkView({title:'Bulk updates'}); }

/* --------------------- KNOWLEDGE BASE (M24) ----------------------------- */
function vEHelp(){ return kbView(); }

