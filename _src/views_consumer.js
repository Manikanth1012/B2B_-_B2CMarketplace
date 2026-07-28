/* ===========================================================================
   PERSONA: Consumer shopper — B2C storefront
   Covers Consumer, Device and Digital Content marketplaces.
   6D-branded operator storefront.
   =========================================================================== */

const BROWSE = {v:null, cat:null, q:'', sort:'popular', maxPrice:null, fulfil:null, minRating:null};

function shopVerticals(){ return ['consumer','device','content']; }
function shopCatalogue(){ return LIVE_PRODUCTS.filter(p=>shopVerticals().includes(p.v)); }

function browseResults(){
  let r=shopCatalogue();
  if(BROWSE.v) r=r.filter(p=>p.v===BROWSE.v);
  if(BROWSE.cat) r=r.filter(p=>p.cat===BROWSE.cat);
  if(BROWSE.fulfil) r=r.filter(p=>p.fulfil===BROWSE.fulfil);
  if(BROWSE.maxPrice!=null) r=r.filter(p=>p.price<=BROWSE.maxPrice);
  if(BROWSE.minRating!=null) r=r.filter(p=>p.rating!=null && p.rating>=BROWSE.minRating);
  if(BROWSE.q){ const q=BROWSE.q.toLowerCase();
    r=r.filter(p=>(p.name+' '+p.desc+' '+p.seller+' '+p.cat+' '+(p.tags||[]).join(' ')).toLowerCase().includes(q)); }
  const s=BROWSE.sort;
  r=r.slice().sort((a,b)=>
    s==='priceup'? a.price-b.price :
    s==='pricedown'? b.price-a.price :
    s==='rating'? (b.rating||0)-(a.rating||0) :
    s==='new'? (b.listed>a.listed?1:-1) :
    (b.reviews||0)-(a.reviews||0));
  return r;
}
function setBrowse(k,val){
  BROWSE[k] = (String(BROWSE[k])===String(val) && k!=='sort' && k!=='q') ? null : val;
  if(k==='v') BROWSE.cat=null;
  App.go('browse');
}
function browseReset(){ BROWSE.v=BROWSE.cat=BROWSE.fulfil=BROWSE.maxPrice=BROWSE.minRating=null; BROWSE.q=''; App.go('browse'); }
function goVertical(v){ browseReset(); BROWSE.v=v; App.go('browse'); }

/* ------------------------------- 1. Storefront ---------------------------- */
/* Consumer insights are computed from this account, so they change when the
   account does rather than being three fixed sentences. */
function C_INSIGHTS(){
  const active=MY_SUBS.filter(s=>s.status==='active');
  const monthly=active.reduce((a,s)=>a+s.price,0);
  const dup=(function(){
    const byCat={};
    active.forEach(s=>{ (byCat[s.v]=byCat[s.v]||[]).push(s); });
    return Object.keys(byCat).filter(k=>byCat[k].length>1).map(k=>byCat[k])[0]||null;
  })();
  const unused=active.filter(s=>s.lastUsed==null);
  const out=[];

  out.push({icon:'wallet', conf:'High confidence',
    src:'Read: your '+active.length+' active subscriptions and their prices',
    title:'You are committed to '+CUR(monthly)+' a month',
    body:'Across '+active.length+' subscription'+(active.length===1?'':'s')+', that is <strong>'+CUR(monthly*12)+
         '</strong> a year. All of it is cancellable, and cancelling still leaves you access to the paid-to date.',
    acts:'<button class="btn btn-sm" onclick="App.go(\'subs\')">Review them</button>'});

  if(dup){
    out.push({icon:'warning', conf:'Medium confidence',
      src:'Read: your subscriptions grouped by marketplace — not by what you actually watch',
      title:'Two '+esc(vName(dup[0].v).replace(' Marketplace','').toLowerCase())+' subscriptions overlap',
      body:'<strong>'+esc(dup[0].name)+'</strong> and <strong>'+esc(dup[1].name)+'</strong> sit in the same category. '+
           'They may well not overlap in content — this is based on category, not on what you watch — but it is worth a look.',
      acts:'<button class="btn btn-sm" onclick="App.go(\'subs\')">Compare them</button>'});
  }

  out.push({icon:'zap', conf:'High confidence',
    src:'Read: your points balance and the redemption rate',
    title:FMT.num(SHOPPER.points)+' points is '+CUR(SHOPPER.points/100)+' of credit',
    body:'Points do not expire on this account, but they also earn nothing sitting there. They can be redeemed to '+
         'wallet credit and spent anywhere in the marketplace.',
    acts:'<button class="btn btn-sm" onclick="redeemPoints()">Redeem</button>'});

  out.push({icon:'eyeoff', conf:'Low confidence — partial evidence',
    src:'Read: subscription records only. This account has no viewing or usage telemetry.',
    title:'We cannot tell you what you are not using',
    body:'Usage is <strong>not measured</strong> on this account, so nothing here can tell you which subscription you '+
         'have stopped watching. '+(unused.length? unused.length+' of them have never reported any activity at all — '+
         'which may mean unused, or may simply mean not measured.' : 'Guessing from billing alone would be dressing up a hunch as advice.'),
    acts:'<button class="btn btn-sm" onclick="App.go(\'subs\')">See what you pay for</button>'});

  return out;
}

function vShopHome(){
  const best=shopCatalogue().filter(p=>p.badge==='Bestseller');
  const bundles=shopCatalogue().filter(p=>p.badge==='Bundle');
  const newIn=shopCatalogue().slice().sort((a,b)=>b.listed>a.listed?1:-1).slice(0,4);
  const activeSubs=MY_SUBS.filter(s=>s.status==='active');
  return pagehead('Hello, '+SHOPPER.name.split(' ')[0],
    esc(MP.operator)+' marketplace · '+esc(SHOPPER.tier)+' member · '+FMT.num(SHOPPER.points)+' points ('+CUR(SHOPPER.points/100)+' to spend)',
    '<button class="btn" onclick="App.go(\'subs\')">'+ICO('refresh',13)+'My subscriptions</button>'+
    '<button class="btn btn-primary" onclick="App.go(\'browse\')">'+ICO('search',14)+'Browse everything</button>')+
  '<div class="stack">'+

  banner('info','Your <strong>Aventa Freedom 50 GB</strong> plan renews on 01 Aug. Anything you buy here can be added to that bill instead of paying by card.')+

  bannerSlot('home-hero',{audience:'Consumer', signedIn:true,
    newCustomer:(typeof MY_ORDERS!=='undefined' && MY_ORDERS.length===0)})+

  panel('Shop by category', verticalTiles('goVertical(\'$V\')'),
    {icon:'dashboard', sub:VERTICALS.length+' categories on one account, one basket and one bill'})+

  '<div class="grid g-2-1">'+
    panel('Popular right now',
      '<div class="pgrid cols3">'+best.concat(shopCatalogue().filter(p=>!p.badge).slice(0,3)).slice(0,6).map(p=>productCard(p,{desc:false})).join('')+'</div>',
      {icon:'trendup', acts:'<button class="btn btn-sm btn-quiet" onclick="BROWSE.sort=\'popular\';App.go(\'browse\')">See all</button>'})+
    panel('Your subscriptions',
      activeSubs.length
        ? '<div class="stack" style="gap:0">'+activeSubs.slice(0,4).map(s=>
            '<div class="row" style="padding:9px 0;border-bottom:1px solid var(--nim-line-100)">'+
            '<span class="cartthumb" style="width:34px;height:34px">'+ICO(VICON[s.v],15)+'</span>'+
            '<div class="grow"><div class="t-small strong">'+esc(s.name)+'</div>'+
            '<div class="t-tiny muted">Renews '+esc(s.next)+'</div></div>'+
            '<div class="t-small strong t-num">'+CUR(s.price)+'</div></div>').join('')+'</div>'+
          '<div class="divider"></div>'+
          '<div class="row"><span class="t-small muted grow">Total monthly</span>'+
          '<span class="t-sub t-num">'+CUR(activeSubs.reduce((a,s)=>a+s.price,0))+'</span></div>'+
          '<button class="btn btn-sm btn-quiet" style="margin-top:9px" onclick="App.go(\'subs\')">Manage</button>'
        : stateBlock('empty','No subscriptions yet','Streaming, music, gaming and insurance all appear here once you subscribe.'),
      {icon:'refresh'})+
  '</div>'+

  panel('What AARYA noticed',
    C_INSIGHTS().map(aiInsight).join(''),
    {ai:true, flush:true, icon:'ai',
     sub:'Worked out from your own account only. Nothing here is based on anyone else\'s data.'})+

  bannerSlot('home-strip',{audience:'Consumer', signedIn:true,
    newCustomer:(typeof MY_ORDERS!=='undefined' && MY_ORDERS.length===0)},{compact:true})+

  panel('Bundles — cheaper together',
    '<div class="pgrid cols3">'+bundles.map(p=>productCard(p)).join('')+
    '<article class="pcard" style="border-style:dashed;justify-content:center">'+
      '<div class="pbody" style="text-align:center;align-items:center;justify-content:center">'+
      ICO('package',22)+'<h3 class="ptitle">Build your own</h3>'+
      '<div class="pdesc">Pick a plan, a device and up to three subscriptions and we price it as one bundle.</div>'+
      '<button class="btn btn-sm" style="margin-top:8px" onclick="bundleBuilder()">Start</button></div>'+
    '</article></div>',
    {icon:'package', sub:'Bundle pricing is applied at checkout, and each item can still be cancelled on its own'})+

  '<div class="grid g2">'+
    panel('New in', '<div class="pgrid cols2">'+newIn.slice(0,2).map(p=>productCard(p,{desc:false})).join('')+'</div>',{icon:'zap'})+
    panel('Recent orders',
      MY_ORDERS.length
        ? '<div class="stack" style="gap:0">'+MY_ORDERS.slice(0,3).map(o=>
            '<button class="row" style="width:100%;text-align:left;background:none;border:0;cursor:pointer;padding:9px 0;border-bottom:1px solid var(--nim-line-100)" '+
            'onclick="openOrder(\''+o.id+'\')">'+
            '<span class="cartthumb" style="width:34px;height:34px">'+ICO(VICON[o.v],15)+'</span>'+
            '<div class="grow"><div class="t-small strong">'+esc(o.name)+'</div>'+
            '<div class="t-tiny muted">'+esc(o.id)+' · '+esc(o.placed)+'</div></div>'+
            orderStatePill(o)+'</button>').join('')+'</div>'+
          '<button class="btn btn-sm btn-quiet" style="margin-top:9px" onclick="App.go(\'orders\')">All orders</button>'
        : stateBlock('empty','No orders yet','Your orders and their delivery status show up here.'),
      {icon:'orders'})+
  '</div>'+
  '</div>';
}

/* -------------------------------- 2. Browse ------------------------------- */
function vBrowse(){
  /* Category header slot — the same ad server, a different frame. */
  const all=shopCatalogue();
  const res=browseResults();
  const cats=Array.from(new Set((BROWSE.v?all.filter(p=>p.v===BROWSE.v):all).map(p=>p.cat)));
  const filtering = BROWSE.v||BROWSE.cat||BROWSE.q||BROWSE.fulfil||BROWSE.maxPrice!=null||BROWSE.minRating!=null;

  const facet=(title,body)=>'<div class="facet"><h4>'+esc(title)+'</h4><div class="opts">'+body+'</div></div>';
  const opt=(label,active,onclick,count)=>
    '<label class="checkline"><input type="checkbox" '+(active?'checked':'')+' onchange="'+onclick+'">'+
    '<span>'+esc(label)+'</span>'+(count!=null?'<span class="cnt">'+count+'</span>':'')+'</label>';

  return pagehead(BROWSE.v?vName(BROWSE.v):'Browse the marketplace',
    res.length+' of '+all.length+' listings'+(filtering?' · filtered':'')+' · sold by '+
      new Set(res.map(p=>p.seller)).size+' sellers',
    '<div class="gsearch" style="width:260px;margin:0;position:relative">'+ICO('search',14)+
      '<input class="inp" id="browseQ" style="padding-left:30px" placeholder="Search listings" value="'+esc(BROWSE.q)+'" '+
      'oninput="searchRerender(this,function(v){BROWSE.q=v},\'browse\')" aria-label="Search listings"></div>'+
    '<select class="inp" style="width:170px" aria-label="Sort" onchange="BROWSE.sort=this.value;App.go(\'browse\')">'+
      [['popular','Most popular'],['rating','Highest rated'],['priceup','Price: low to high'],
       ['pricedown','Price: high to low'],['new','Newest']].map(o=>
      '<option value="'+o[0]+'"'+(BROWSE.sort===o[0]?' selected':'')+'>'+o[1]+'</option>').join('')+'</select>')+

  (BROWSE.v ? '<div style="margin-bottom:14px">'+
    bannerSlot('category',{audience:'Consumer', signedIn:true},{compact:true})+'</div>' : '')+
  compareTray()+

  '<div class="grid" style="grid-template-columns:238px minmax(0,1fr);gap:14px">'+
    '<aside class="facets" aria-label="Filters">'+
      '<div class="facet"><div class="row"><h4 style="margin:0" class="grow">Filters</h4>'+
        (filtering?'<button class="linkbtn" onclick="browseReset()">Clear all</button>':'')+'</div></div>'+
      facet('Marketplace', shopVerticals().map(v=>
        opt(vName(v).replace(' Marketplace',''), BROWSE.v===v, 'setBrowse(\'v\',\''+v+'\')', all.filter(p=>p.v===v).length)).join(''))+
      facet('Category', cats.map(c=>
        opt(c, BROWSE.cat===c, 'setBrowse(\'cat\',\''+c.replace(/'/g,"\\'")+'\')',
          all.filter(p=>p.cat===c&&(!BROWSE.v||p.v===BROWSE.v)).length)).join(''))+
      facet('Delivery', [['instant','Instant digital'],['esim','eSIM'],['shipped','Shipped'],['activation','Activated on account']].map(f=>
        opt(f[1], BROWSE.fulfil===f[0], 'setBrowse(\'fulfil\',\''+f[0]+'\')', all.filter(p=>p.fulfil===f[0]).length)).join(''))+
      facet('Price', [[15,'Under '+CUR0(15)],[50,'Under '+CUR0(50)],[300,'Under '+CUR0(300)],[1000,'Under '+CUR0(1000)]].map(pr=>
        opt(pr[1], BROWSE.maxPrice===pr[0], 'setBrowse(\'maxPrice\','+pr[0]+')')).join(''))+
      facet('Rating', [[4.5,'4.5 and up'],[4,'4.0 and up'],[3.5,'3.5 and up']].map(r=>
        opt(r[1], BROWSE.minRating===r[0], 'setBrowse(\'minRating\','+r[0]+')')).join(''))+
    '</aside>'+

    '<div>'+
      (filtering?'<div class="row wrap" style="gap:6px;margin-bottom:12px">'+
        (BROWSE.v?'<button class="filterchip" aria-pressed="true" onclick="setBrowse(\'v\',\''+BROWSE.v+'\')">'+esc(vName(BROWSE.v).replace(' Marketplace',''))+''+SH('cross',10)+'</button>':'')+
        (BROWSE.cat?'<button class="filterchip" aria-pressed="true" onclick="setBrowse(\'cat\',\''+esc(BROWSE.cat)+'\')">'+esc(BROWSE.cat)+''+SH('cross',10)+'</button>':'')+
        (BROWSE.fulfil?'<button class="filterchip" aria-pressed="true" onclick="setBrowse(\'fulfil\',\''+BROWSE.fulfil+'\')">'+esc(fulfilLabel(BROWSE.fulfil))+''+SH('cross',10)+'</button>':'')+
        (BROWSE.maxPrice!=null?'<button class="filterchip" aria-pressed="true" onclick="setBrowse(\'maxPrice\','+BROWSE.maxPrice+')">Under '+CUR0(BROWSE.maxPrice)+''+SH('cross',10)+'</button>':'')+
        (BROWSE.minRating!=null?'<button class="filterchip" aria-pressed="true" onclick="setBrowse(\'minRating\','+BROWSE.minRating+')">'+BROWSE.minRating+'+'+SH('cross',10)+'</button>':'')+
        (BROWSE.q?'<button class="filterchip" aria-pressed="true" onclick="BROWSE.q=\'\';App.go(\'browse\')">“'+esc(BROWSE.q)+'”'+SH('cross',10)+'</button>':'')+
      '</div>':'')+
      (res.length
        ? '<div class="pgrid">'+res.map(p=>productCard(p,{desc:false})).join('')+'</div>'
        : panel(null, stateBlock('filtered','Nothing matches those filters',
            'Your filters exclude all '+all.length+' listings in this marketplace. Loosen one to see results.',
            '<button class="btn btn-sm btn-primary" onclick="browseReset()">Clear filters</button>'), {flush:true}))+
    '</div>'+
  '</div>';
}

/* ---------------------------- 3. Mobile and eSIM -------------------------- */
function vPlans(){
  const plans=LIVE_PRODUCTS.filter(p=>p.cat==='Mobile plans');
  const rows=[['Data','50 GB','Unlimited','10 GB'],
              ['Network','5G','5G','4G/5G'],
              ['Calls and SMS','Unlimited','Unlimited','Data only'],
              ['Roaming','EU + 8','30 GB in 42 countries','62 destinations'],
              ['Hotspot','Yes','Yes','Yes'],
              ['Contract','None','None','30 days'],
              ['Delivery','eSIM, ~2 min','eSIM, ~2 min','eSIM, ~2 min']];
  return pagehead('Mobile plans and eSIM',
    'Plans activate on eSIM in about two minutes. Nothing here has a lock-in period.',
    '<button class="btn" onclick="coverageCheck()">'+ICO('pin',13)+'Check coverage</button>'+
    '<button class="btn btn-primary" onclick="goVertical(\'consumer\')">All consumer listings</button>')+
  '<div class="stack">'+
  banner('info','Already with us? Changing plan keeps your number and your eSIM — the new allowance applies from your next bill date.')+
  '<div class="pgrid cols3">'+plans.map(p=>productCard(p)).join('')+'</div>'+
  panel('Compare',
    '<div class="tablewrap"><table class="tbl"><thead><tr><th style="min-width:150px"></th>'+
    plans.map(p=>'<th style="text-align:center">'+esc(p.name)+'<div class="cellsub" style="font-weight:400">'+CUR(p.price)+(p.model==='monthly'?'/mo':'')+'</div></th>').join('')+
    '</tr></thead><tbody>'+
    rows.map(r=>'<tr><td class="cellmain">'+esc(r[0])+'</td>'+
      r.slice(1).map(c=>'<td style="text-align:center">'+esc(c)+'</td>').join('')+'</tr>').join('')+
    '<tr><td></td>'+plans.map(p=>'<td style="text-align:center"><button class="btn btn-sm btn-primary" onclick="addToCart(\''+p.id+'\')">Choose</button></td>').join('')+'</tr>'+
    '</tbody></table></div>',{flush:true,icon:'checklist'})+
  panel('Add insurance to your plan',
    '<div class="pgrid cols2">'+LIVE_PRODUCTS.filter(p=>p.cat==='Insurance').map(p=>productCard(p)).join('')+'</div>',
    {icon:'shield', sub:'Underwritten by Aegis Assurance, sold through the marketplace. Cancel any time.'})+
  '</div>';
}

/* ---------------------------- 4. Digital content -------------------------- */
function vContent(){
  const byCat={};
  LIVE_PRODUCTS.filter(p=>p.v==='content').forEach(p=>{ (byCat[p.cat]=byCat[p.cat]||[]).push(p); });
  const mine=MY_SUBS.filter(s=>s.v==='content');
  return pagehead('Digital content',
    'Streaming, gaming, music and cloud from '+new Set(LIVE_PRODUCTS.filter(p=>p.v==='content').map(p=>p.seller)).size+
    ' partners. Everything is charged to your mobile bill and cancellable in one tap.',
    '<button class="btn" onclick="App.go(\'subs\')">'+ICO('refresh',13)+'My subscriptions ('+mine.filter(s=>s.status==='active').length+')</button>'+
    '<button class="btn btn-primary" onclick="addToCart(\'SKU-2006\')">Get the streaming bundle</button>')+
  '<div class="stack">'+
  banner('info','<strong>Two subscriptions with Freedom Unlimited saves '+CUR(7)+' a month.</strong> Pick any two and the bundle price applies automatically at checkout. '+
    '<button class="linkbtn" onclick="openProduct(\'SKU-2006\')">See the bundle</button>')+
  Object.keys(byCat).map(cat=>
    panel(cat, '<div class="pgrid cols3">'+byCat[cat].map(p=>productCard(p,{desc:false})).join('')+'</div>',
      {icon:cat==='Streaming'?'play':cat==='Gaming'?'zap':cat==='Music'?'message':'database',
       sub:byCat[cat].length+' listing'+(byCat[cat].length===1?'':'s')})).join('')+
  panel('Already subscribed',
    mine.length
      ? '<table class="tbl"><thead><tr><th>Subscription</th><th>Seller</th><th class="num">Price</th><th>Renews</th><th>Status</th><th></th></tr></thead><tbody>'+
        mine.map(s=>'<tr><td class="cellmain">'+esc(s.name)+'</td><td>'+esc(s.seller)+'</td>'+
        '<td class="num t-num">'+CUR(s.price)+'</td><td>'+esc(s.next)+'</td><td>'+statusPill(s.status)+'</td>'+
        '<td class="acts"><button class="btn btn-sm btn-quiet" onclick="manageSub(\''+s.id+'\')">Manage</button></td></tr>').join('')+
        '</tbody></table>'
      : stateBlock('empty','Nothing subscribed yet','Pick something above and it starts straight away.'),
    {flush:true,icon:'refresh'})+
  '</div>';
}

/* -------------------------------- 5. Devices ------------------------------ */
function vDevices(){
  const d=LIVE_PRODUCTS.filter(p=>p.v==='device');
  const byCat={}; d.forEach(p=>{ (byCat[p.cat]=byCat[p.cat]||[]).push(p); });
  return pagehead('Devices',
    d.length+' listings from '+new Set(d.map(p=>p.seller)).size+' sellers · phones, routers, CPE, tablets and accessories',
    '<button class="btn" onclick="tradeInDialog()">'+ICO('swap',13)+'Trade in a device</button>'+
    '<button class="btn btn-primary" onclick="goVertical(\'device\')">Browse with filters</button>')+
  '<div class="stack">'+
  banner('info','Buy a handset outright, or spread it over 24 months on your mobile bill with nothing to pay upfront. Instalments are shown on each product page.')+
  Object.keys(byCat).map(cat=>
    panel(cat, '<div class="pgrid">'+byCat[cat].map(p=>productCard(p,{desc:false})).join('')+'</div>',
      {icon:cat==='Phones'?'smartphone':cat==='Routers'||cat==='CPE'?'wifi':cat==='Wearables'?'clock':'package'})).join('')+
  '</div>';
}

/* -------------------------------- 6. Orders ------------------------------- */
function vOrders(){
  const mine=MY_ORDERS;
  return pagehead('My orders',
    mine.length+' orders · track delivery, activation and provisioning in one place',
    exportBtn('My orders','myOrders'))+
  '<div class="stack">'+
  (mine.filter(o=>o.failed).length
    ? banner('danger','<strong>One order needs your attention.</strong> A delivery attempt failed and the parcel is waiting at the depot. '+
      '<button class="linkbtn" onclick="openOrder(\''+mine.filter(o=>o.failed)[0].id+'\')">Sort it out</button>')
    : '')+
  (mine.length
    ? mine.map(o=>
      '<section class="panel"><div class="panel-body">'+
        '<div class="row wrap" style="gap:12px;align-items:flex-start;margin-bottom:12px">'+
          '<span class="cartthumb">'+ICO(VICON[o.v],20)+'</span>'+
          '<div class="grow"><div class="row" style="gap:6px">'+orderStatePill(o)+vBadge(o.v)+'</div>'+
          '<div class="t-sub" style="margin-top:5px">'+esc(o.name)+'</div>'+
          '<div class="t-small muted">'+esc(o.id)+' · placed '+esc(o.placed)+' · '+esc(o.seller)+'</div></div>'+
          '<div style="text-align:right;flex:0 0 auto"><div class="t-sub t-num">'+CUR(o.gross)+'</div>'+
          '<div class="t-tiny muted">'+esc(o.pay)+'</div></div>'+
        '</div>'+
        pipeline(o)+
        '<div class="divider"></div>'+
        '<div class="row wrap"><span class="t-tiny muted grow">'+esc(fulfilLabel(o.fulfil))+'</span>'+
        '<button class="btn btn-sm btn-quiet" onclick="openOrder(\''+o.id+'\')">Details</button>'+
        (o.failed?'<button class="btn btn-sm btn-primary" onclick="rebookDelivery(\''+o.id+'\')">Rebook delivery</button>'
                 :'<button class="btn btn-sm" onclick="toast(\'Support request opened\')">Get help</button>')+
        '</div>'+
      '</div></section>').join('')
    : panel(null,stateBlock('empty','No orders yet','Everything you buy shows here with live tracking.',
        '<button class="btn btn-sm btn-primary" onclick="App.go(\'home\')">Start shopping</button>'),{flush:true}))+
  '</div>';
}

/* ----------------------------- 7. Subscriptions --------------------------- */
function vSubs(){
  const act=MY_SUBS.filter(s=>s.status==='active');
  const monthly=act.reduce((a,s)=>a+s.price,0);
  return pagehead('My subscriptions',
    act.length+' active · '+CUR(monthly)+' a month across '+new Set(act.map(s=>s.seller)).size+' sellers, all on one bill',
    exportBtn('Subscriptions','mySubs')+
    '<button class="btn btn-primary" onclick="App.go(\'content\')">'+ICO('plus',14)+'Add a subscription</button>')+
  '<div class="stack">'+
  '<div class="grid g4">'+
    metric({icon:'refresh',label:'Active subscriptions',value:String(act.length),foot:'Across '+new Set(act.map(s=>s.v)).size+' marketplaces'})+
    metric({icon:'wallet',label:'Monthly total',value:CUR(monthly),foot:'Billed with your mobile plan on the 1st'})+
    metric({icon:'calendar',label:'Next renewal',value:'01 Aug',foot:'Aventa Freedom 50 GB · '+CUR(18)})+
    metric({icon:'trendup',label:'Bundle saving available',value:CUR(7),foot:'By moving two of these into the duo bundle'})+
  '</div>'+
  forecastPanel({series:conSpendSeries(), title:'What this will cost you',
    label:'Projected spend', money:true,
    sub:'Your active subscriptions carried forward, plus the one-off buying pattern of the last year.',
    assumptions:[
      'Everything currently active keeps renewing. Cancelling one takes it out from the paid-to date.',
      'It includes the occasional one-off — top-ups and content — at the rate you have been buying them.',
      'A price rise by a seller is not predicted. You are told 30 days before one takes effect.',
      '<strong>This is not a bill.</strong> It is what your current commitments would come to if nothing changes.'
    ]})+

  banner('info','You are paying for <strong>StreamNova Premium</strong> and <strong>Halo Music Family</strong> separately. Moving both into the Unlimited + Streaming duo saves '+CUR(7)+' a month. '+
    '<button class="linkbtn" onclick="openProduct(\'SKU-2006\')">Look at the bundle</button>')+
  MY_SUBS.map(s=>{
    const p=SKUMAP[s.sku];
    return '<section class="panel"><div class="panel-body">'+
      '<div class="row wrap" style="gap:12px;align-items:flex-start">'+
        '<span class="cartthumb">'+ICO(VICON[s.v],20)+'</span>'+
        '<div class="grow"><div class="row" style="gap:6px">'+statusPill(s.status)+vBadge(s.v)+
          (s.autoRenew?pill('info','Auto-renews'):pill('neutral','No auto-renew'))+'</div>'+
        '<div class="t-sub" style="margin-top:5px">'+esc(s.name)+'</div>'+
        '<div class="t-small muted">'+esc(s.seller)+' · started '+esc(s.started)+' · '+esc(s.id)+'</div>'+
        (s.status==='cancelled'?'<div class="t-small" style="margin-top:6px;color:var(--nim-warning-fg)">Access continues until '+esc(s.ends)+', then stops. Nothing more will be charged.</div>':'')+
        (s.status==='paused'?'<div class="t-small" style="margin-top:6px;color:var(--nim-warning-fg)">Paused. Billing resumes '+esc(s.resumes)+' unless you cancel first.</div>':'')+
        '</div>'+
        '<div style="text-align:right;flex:0 0 auto"><div class="t-sub t-num">'+CUR(s.price)+'</div>'+
        '<div class="t-tiny muted">'+(s.status==='active'?'renews '+esc(s.next):'not billing')+'</div></div>'+
      '</div>'+
      '<div class="divider"></div>'+
      '<div class="row wrap">'+
        '<span class="t-tiny muted grow">'+(p?esc(p.desc):'')+'</span>'+
        (s.status==='active'
          ? '<button class="btn btn-sm btn-quiet" onclick="openProduct(\''+s.sku+'\')">View listing</button>'+
            '<button class="btn btn-sm" onclick="pauseSub(\''+s.id+'\')">Pause</button>'+
            '<button class="btn btn-sm btn-danger" onclick="cancelSub(\''+s.id+'\')">Cancel</button>'
          : '<button class="btn btn-sm btn-primary" onclick="reactivateSub(\''+s.id+'\')">Reactivate</button>')+
      '</div>'+
    '</div></section>';
  }).join('')+
  '</div>';
}
function manageSub(id){ const s=MY_SUBS.find(x=>x.id===id); if(s) { App.go('subs'); } }
function reactivateSub(id){
  const s=MY_SUBS.find(x=>x.id===id); if(!s) return;
  confirmAction({title:'Restart '+s.name, subtitle:CUR(s.price)+' a month · '+s.seller, risk:'normal',
    confirmLabel:'Restart at '+CUR(s.price)+'/mo',
    impact:['Billing restarts today at '+CUR(s.price)+' a month and renews until you cancel.',
            'Access is restored within about two minutes.',
            s.status==='cancelled' ? 'Your profile and history with '+esc(s.seller)+' are restored if still within 90 days of cancelling.'
                                   : 'Your paused profile and history come back untouched.',
            'Promotional pricing from your original signup no longer applies.'],
    onConfirm:()=>{ s.status='active'; s.autoRenew=true; s.next='25 Aug 2026'; delete s.ends; delete s.resumes;
      toast(s.name+' restarted — next renewal '+s.next); App.go('subs'); }});
}
function rebookDelivery(id){
  const o=ORDERS.find(x=>x.id===id); if(!o) return;
  confirmAction({title:'Rebook delivery for '+o.id, subtitle:o.name+' · '+o.seller, risk:'normal',
    confirmLabel:'Rebook for tomorrow',
    body:'<div class="field"><label for="rbWhen">Delivery window</label><select class="inp" id="rbWhen" data-autofocus>'+
      '<option>Tomorrow, 09:00–13:00</option><option>Tomorrow, 13:00–18:00</option>'+
      '<option>Saturday, 09:00–13:00</option><option>Hold at the depot for collection</option></select></div>',
    impact:['The carrier reattempts on the window you pick.',
            'The parcel is held at the depot for 7 days; after that it returns to '+esc(o.seller)+' and you are refunded.',
            'You get an SMS an hour before the driver arrives.'],
    onConfirm:()=>{ o.failed=false; o.stage=Math.min(o.stage+1,o.stages.length-1); recomputeDerived();
      toast('Redelivery booked — '+o.id+' is back in transit'); App.go('orders'); }});
}
function pauseSub(id){
  const s=MY_SUBS.find(x=>x.id===id);
  confirmAction({title:'Pause '+s.name, subtitle:CUR(s.price)+' a month · '+s.seller, risk:'normal', confirmLabel:'Pause for 1 month',
    body:'<div class="field"><label for="psLen">Pause for</label><select class="inp" id="psLen" data-autofocus>'+
      '<option>1 month</option><option>2 months</option><option>3 months</option></select></div>',
    impact:['Billing stops immediately — nothing is charged while paused.',
            'Access to '+esc(s.name)+' stops at the same time.',
            'Your account, profiles and history are kept and come back when it resumes.',
            'It restarts automatically at '+CUR(s.price)+' a month unless you cancel before then.'],
    footNote:'You can resume early at any point.',
    onConfirm:()=>{ s.status='paused'; s.resumes='01 Sep 2026'; s.autoRenew=false; toast(s.name+' paused'); App.go('subs'); }});
}
function cancelSub(id){
  const s=MY_SUBS.find(x=>x.id===id);
  confirmAction({title:'Cancel '+s.name, subtitle:CUR(s.price)+' a month · sold by '+s.seller, risk:'high',
    confirmLabel:'Cancel subscription',
    body:'<div class="field"><label for="csWhy">Why are you cancelling? (optional)</label><select class="inp" id="csWhy" data-autofocus>'+
      '<option>Too expensive</option><option>Not using it enough</option><option>Found it cheaper elsewhere</option>'+
      '<option>Technical problems</option><option>Prefer not to say</option></select></div>',
    impact:['You keep access until <strong>'+esc(s.next)+'</strong>, the end of the period you have already paid for.',
            'Nothing further is charged after that date.',
            'Your profile and history with '+esc(s.seller)+' are kept for 90 days if you come back.',
            'If this subscription is part of a bundle, the bundle discount stops and the remaining items return to their standard price.'],
    footNote:'You can resubscribe at any time, though promotional pricing may not still be available.',
    onConfirm:()=>{ s.status='cancelled'; s.autoRenew=false; s.ends=s.next; s.next='—';
      toast(s.name+' cancelled — access until '+s.ends,'warn'); App.go('subs'); }});
}

/* -------------------------------- 8. Account ------------------------------ */
/* Every control on this screen changes a record. Nothing here is a toast that
   pretends something happened. */
/* If the household has a failed payment, say so before anything else. */
function myDunning(){
  return (typeof DUNNING_CASES!=='undefined')
    ? DUNNING_CASES.filter(function(d){return d.ctx==='consumer' && d.account===SHOPPER.name && d.state!=='recovered'})
    : [];
}
function vAccount(){
  const monthly = MY_SUBS.filter(s=>s.status==='active').reduce((a,s)=>a+s.price,0);
  const pay = MY_PAYMENTS.filter(p=>p.status!=='removed');
  const addr = MY_ADDRESSES;

  return pagehead('My details',
    esc(SHOPPER.name)+' · '+esc(SHOPPER.id)+' · '+esc(SHOPPER.since),
    '<button class="btn" onclick="App.go(\'access\')">'+ICO('shield',13)+'Account access</button>'+
    '<button class="btn btn-primary" onclick="saveProfile()">Save changes</button>')+
  '<div class="stack">'+

  (function(){
    const d=myDunning()[0];
    if(!d) return '';
    return banner('danger','<strong>A payment of '+CUR(d.amount)+' failed on '+esc(d.failed)+'.</strong> '+
      esc(d.reason)+'. '+(d.state==='suspended'
        ? 'Your service is suspended and your data is kept for 30 days.'
        : d.state==='restricted'
        ? 'You cannot make new purchases until it is settled; what you already have keeps working.'
        : 'Nothing has been interrupted. Updating the card below fixes it.')+
      ' <button class="linkbtn" onclick="openDunning(\''+d.id+'\')">See what happens next</button>');
  })()+
  (MY_CLOSURE.requested
    ? banner('danger','<strong>This account is scheduled to close on '+esc(MY_CLOSURE.effective)+'.</strong> '+
      'Everything still works until then, and every subscription is cancelled on that date. '+
      '<button class="linkbtn" onclick="cancelClosure()">Stop the closure</button>')
    : '')+

  '<div class="grid g4">'+
    metric({icon:'wallet',label:'Wallet balance',value:CUR(SHOPPER.wallet),
      foot:'<button class="linkbtn" onclick="topUpWallet()">Top up</button>'})+
    metric({icon:'zap',label:'Reward points',value:FMT.num(SHOPPER.points),
      foot:'Worth '+CUR(SHOPPER.points/100)+' · <button class="linkbtn" onclick="redeemPoints()">Redeem</button>'})+
    metric({icon:'refresh',label:'Monthly commitments',value:CUR(monthly),
      foot:MY_SUBS.filter(s=>s.status==='active').length+' subscriptions'})+
    metric({icon:'orders',label:'Orders placed',value:String(MY_ORDERS.length),foot:'Lifetime on this account'})+
  '</div>'+

  '<div class="grid g2">'+
    panel('Your details',
      '<div class="grid g2">'+
        '<div class="field"><label for="acName">Name</label>'+
          '<input class="inp" id="acName" value="'+esc(SHOPPER.name)+'">'+
          '<div class="err" id="acNameErr" hidden>'+ICO('alert',12)+'A name is required.</div></div>'+
        '<div class="field"><label for="acMob">Mobile</label>'+
          '<input class="inp" id="acMob" value="'+esc(SHOPPER.msisdn)+'" disabled>'+
          '<div class="hint">Your number is your account identity. '+
          '<button class="linkbtn" onclick="changeNumberInfo()">Why can I not change it?</button></div></div>'+
        '<div class="field"><label for="acMail">Email</label>'+
          '<input class="inp" id="acMail" value="'+esc(SHOPPER.email||'priya.raman@6dtech.co.in')+'">'+
          '<div class="err" id="acMailErr" hidden>'+ICO('alert',12)+'A valid email is required — receipts go there.</div></div>'+
        '<div class="field"><label for="acCity">City</label><input class="inp" id="acCity" value="'+esc(SHOPPER.city)+'"></div>'+
      '</div>'+
      '<div class="divider"></div>'+
      '<h4 class="t-sub" style="margin-bottom:9px">What we may contact you about</h4>'+
      '<div class="stack" style="gap:10px">'+
        '<label class="toggle"><input type="checkbox" '+(MY_PREFS.offers?'checked':'')+
          ' onchange="setPref(\'offers\',this.checked)"><span class="track"></span>Offers and recommendations</label>'+
        '<label class="toggle"><input type="checkbox" '+(MY_PREFS.orderUpdates?'checked':'')+
          ' onchange="setPref(\'orderUpdates\',this.checked)"><span class="track"></span>Order and delivery updates</label>'+
        '<label class="toggle"><input type="checkbox" '+(MY_PREFS.partnerMarketing?'checked':'')+
          ' onchange="setPref(\'partnerMarketing\',this.checked)"><span class="track"></span>Marketing from sellers you buy from</label>'+
      '</div>'+
      '<div class="divider"></div>'+
      '<div class="grid g3">'+
        '<div class="field"><label for="acLang">Language</label><select class="inp" id="acLang" onchange="setPref(\'lang\',this.value)">'+
          ['English'].map(o=>'<option'+(MY_PREFS.lang===o?' selected':'')+'>'+esc(o)+'</option>').join('')+'</select></div>'+
        '<div class="field"><label for="acTz">Time zone</label><select class="inp" id="acTz" onchange="setPref(\'tz\',this.value)">'+
          ['Asia/Kolkata (IST)','Asia/Dubai (GST)','Europe/London (GMT)'].map(o=>
          '<option'+(MY_PREFS.tz===o?' selected':'')+'>'+esc(o)+'</option>').join('')+'</select></div>'+
        '<div class="field"><label for="acUnit">Data units</label><select class="inp" id="acUnit" onchange="setPref(\'units\',this.value)">'+
          ['GB','MB'].map(o=>'<option'+(MY_PREFS.units===o?' selected':'')+'>'+esc(o)+'</option>').join('')+'</select></div>'+
      '</div>'+
      '<div class="divider"></div>'+
      '<h4 class="t-sub" style="margin-bottom:9px">Sign-in and security</h4>'+
      securityRows('consumer')+
      '<div class="row wrap" style="gap:18px;margin-top:12px">'+
        '<label class="toggle"><input type="checkbox" '+(MY_PREFS.dark?'checked':'')+
          ' onchange="setPref(\'dark\',this.checked)"><span class="track"></span>Dark theme</label>'+
        '<label class="toggle"><input type="checkbox" '+(MY_PREFS.reduceMotion?'checked':'')+
          ' onchange="setPref(\'reduceMotion\',this.checked)"><span class="track"></span>Reduce motion</label>'+
        '<label class="toggle"><input type="checkbox" '+(MY_PREFS.assistant?'checked':'')+
          ' onchange="setPref(\'assistant\',this.checked)"><span class="track"></span>Show the assistant</label>'+
      '</div>',
      {icon:'user'})+

    panel('How you pay',
      '<table class="tbl"><tbody>'+pay.map(m=>
        '<tr><td><div class="cellmain">'+esc(m.kind)+(m.detail?' '+esc(m.detail):'')+'</div>'+
        '<div class="cellsub">'+esc(m.holder)+(m.expires?' · expires '+esc(m.expires):'')+' · added '+esc(m.added)+'</div></td>'+
        '<td style="width:96px">'+(m.primary?pill('info','Default'):m.status==='expired'?pill('down','Expired'):pill('active','Active'))+'</td>'+
        '<td class="acts">'+
          (m.primary
            ? '<span class="t-tiny muted">Used first at checkout</span>'
            : (m.status==='expired'
                ? '<button class="btn btn-sm" onclick="replaceCard(\''+m.id+'\')">Replace</button>'
                : '<button class="btn btn-sm btn-quiet" onclick="makePrimary(\''+m.id+'\')">Make default</button>')+
              '<button class="btn btn-sm btn-quiet" onclick="removePayment(\''+m.id+'\')">Remove</button>')+
        '</td></tr>').join('')+
        '<tr><td><div class="cellmain">Wallet</div><div class="cellsub">Credit from refunds, trade-ins and top-ups</div></td>'+
        '<td style="width:96px" class="t-num strong">'+CUR(SHOPPER.wallet)+'</td>'+
        '<td class="acts"><button class="btn btn-sm btn-quiet" onclick="showWalletLog()">History</button>'+
        '<button class="btn btn-sm" onclick="topUpWallet()">Top up</button></td></tr>'+
      '</tbody></table>'+
      '<div class="row" style="margin-top:11px"><span class="t-tiny muted grow">'+
        'A default is always required, so the last remaining method cannot be removed.</span>'+
      '<button class="btn btn-sm btn-primary" onclick="addCard()">'+ICO('plus',13)+'Add a card</button></div>',
      {icon:'wallet'})+
  '</div>'+

  panel('Delivery addresses',
    (addr.length
      ? '<div class="grid g2">'+addr.map(a=>
        '<div class="card"><div class="card-head">'+ICO('pin',15)+
          '<div class="grow"><div class="t-sub">'+esc(a.label)+'</div>'+
          '<div class="t-tiny muted">'+esc(a.phone)+'</div></div>'+
          (a.default?pill('info','Default'):'')+'</div>'+
        '<div class="card-body"><div class="t-small">'+esc(a.line1)+'<br>'+esc(a.city)+' '+esc(a.pin)+'</div>'+
        (a.notes?'<div class="t-tiny muted" style="margin-top:6px">'+ICO('info',11)+' '+esc(a.notes)+'</div>':'')+
        '<div class="divider"></div>'+
        '<div class="row wrap">'+
          (a.default?'<span class="t-tiny muted grow">Used unless you pick another at checkout</span>'
                    :'<button class="btn btn-sm btn-quiet grow" style="justify-content:flex-start" onclick="makeDefaultAddress(\''+a.id+'\')">Make default</button>')+
          '<button class="btn btn-sm btn-quiet" onclick="editAddress(\''+a.id+'\')">Edit</button>'+
          (addr.length>1?'<button class="btn btn-sm btn-quiet" onclick="deleteAddress(\''+a.id+'\')">Delete</button>':'')+
        '</div></div></div>').join('')+'</div>'
      : stateBlock('empty','No delivery address yet','Add one and it will be offered at checkout for anything physical.'))+
    '<div class="row" style="margin-top:12px"><span class="t-tiny muted grow">'+
      'Sellers of physical goods see the address you pick at checkout, and nothing else about you.</span>'+
    '<button class="btn btn-sm btn-primary" onclick="editAddress()">'+ICO('plus',13)+'Add an address</button></div>',
    {icon:'pin'})+

  myReviewsPanel(SHOPPER.name)+

  panel('Saved for later',
    (MY_SAVED.length
      ? '<div class="pgrid cols3">'+MY_SAVED.map(sk=>{
          const pr=SKUMAP[sk]; if(!pr) return '';
          /* Remove has to survive the item going out of stock, so the buy
             action is composed rather than replaced wholesale. */
          return productCard(pr,{desc:false, keepCta:true,
            cta:stockCta(pr)+
                '<button class="btn btn-sm btn-quiet" onclick="event.stopPropagation();unsaveItem(\''+pr.id+'\')">Remove</button>'});
        }).join('')+'</div>'
      : stateBlock('empty','Nothing saved','Anything you save from a product page waits here.',
          '<button class="btn btn-sm btn-primary" onclick="App.go(\'browse\')">Browse the marketplace</button>')),
    {icon:'flag', sub:MY_SAVED.length+' item'+(MY_SAVED.length===1?'':'s')+' · saving does not reserve stock or hold a price'})+

  watchPanel()+

  panel('Privacy',
    '<div class="grid g2"><div class="stack" style="gap:9px">'+
      [['Your name and delivery address','Shared with sellers you buy physical goods from','info'],
       ['Your email','Shared with subscription sellers so they can create your account','info'],
       ['Your mobile number','Never shared with sellers','success'],
       ['What you browse','Never shared with sellers','success']]
      .map(r=>'<div class="row"><div class="grow"><div class="t-small">'+esc(r[0])+'</div>'+
        '<div class="t-tiny muted">'+esc(r[1])+'</div></div>'+
        (r[2]==='info'?pill('info','Shared'):pill('success','Never'))+'</div>').join('')+
    '</div><div class="stack" style="gap:11px">'+
      (MY_DATA_REQUESTS.length
        ? '<div class="stack" style="gap:7px">'+MY_DATA_REQUESTS.map(d=>
            '<div class="row"><div class="grow"><div class="t-small strong">'+esc(d.kind)+'</div>'+
            '<div class="t-tiny muted">Raised '+esc(d.raised)+' · '+esc(d.ref)+'</div></div>'+
            pill('inprogress','Due '+d.due)+'</div>').join('')+'</div>'
        : '<div class="t-small">You can ask for a copy of everything held about you. We have 30 days to answer, '+
          'and the copy arrives as a download link to your registered email.</div>')+
      '<div class="row wrap">'+
        '<button class="btn btn-sm" onclick="requestMyData()">Request my data</button>'+
        (MY_CLOSURE.requested
          ? '<button class="btn btn-sm btn-primary" onclick="cancelClosure()">Stop the closure</button>'
          : '<button class="btn btn-sm btn-danger" onclick="closeAccount()">Close my account</button>')+
      '</div>'+
    '</div></div>',{icon:'lock'})+
  '</div>';
}

/* ------------------------------ profile actions --------------------------- */
function saveProfile(){
  const g=id=>document.getElementById(id);
  const name=(g('acName').value||'').trim();
  const mail=(g('acMail').value||'').trim();
  const okMail=/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(mail);
  g('acNameErr').hidden=!!name; g('acName').setAttribute('aria-invalid',!name);
  g('acMailErr').hidden=okMail; g('acMail').setAttribute('aria-invalid',!okMail);
  if(!name||!okMail){ (!name?g('acName'):g('acMail')).focus(); toast('Fix the highlighted fields first','warn'); return; }
  SHOPPER.name=name; SHOPPER.email=mail; SHOPPER.city=(g('acCity').value||'').trim()||SHOPPER.city;
  const pn=document.querySelector('.persona-name'); if(pn) pn.textContent=SHOPPER.name;
  const av=document.querySelector('.persona .avatar'); if(av) av.textContent=FMT.initials(SHOPPER.name);
  toast('Saved — receipts now go to '+SHOPPER.email);
  App.go('account');
}
function setPref(key,val){
  MY_PREFS[key]=val;
  const label={offers:'Offers and recommendations',orderUpdates:'Order and delivery updates',
    partnerMarketing:'Seller marketing',dark:'Dark theme',reduceMotion:'Reduced motion',assistant:'The assistant'}[key];
  if(key==='assistant'){ const d=document.querySelector('.ai-dock'); if(d) d.style.display=val?'':'none'; }
  toast(label ? label+' '+(val?'on':'off') : 'Preference saved');
}
function changeNumberInfo(){
  openModal('<div class="modal-head">'+ICO('info',18)+'<div class="grow"><h3 class="t-sub">Changing your number</h3></div>'+
    '<button class="iconbtn" onclick="closeModal()" aria-label="Close">'+ICO('x',16)+'</button></div>'+
    '<div class="modal-body stack">'+
      '<p class="t-body" style="margin:0">Your mobile number identifies this account, carries your bill-to-mobile payments '+
      'and is how household members are linked to you. Changing it is a network operation, not a profile edit.</p>'+
      '<div class="impact"><strong>How it is done</strong><ul>'+
        '<li>Keep the same number and move it to a new SIM — that is a SIM swap, from the plan screen.</li>'+
        '<li>Move to a different number — that is a port or a new line, and the account follows you.</li>'+
        '<li>Either way your orders, subscriptions and wallet balance stay with the account.</li></ul></div>'+
    '</div>'+
    '<div class="modal-foot"><button class="btn btn-quiet" onclick="closeModal()">Close</button><div class="spacer"></div>'+
    '<button class="btn btn-primary" onclick="closeModal();App.go(\'plans\')" data-autofocus>Go to plans</button></div>',
    {label:'Changing your number'});
}

/* ----------------------------- payment methods ---------------------------- */
function addCard(){
  openModal('<div class="modal-head">'+ICO('wallet',18)+'<div class="grow"><h3 class="t-sub">Add a card</h3>'+
    '<div class="t-small muted">Stored with the payment processor, not on this account. We keep the last four digits only.</div></div>'+
    '<button class="iconbtn" onclick="closeModal()" aria-label="Close">'+ICO('x',16)+'</button></div>'+
    '<div class="modal-body stack">'+
      '<div class="field"><label for="pcNum">Card number</label>'+
        '<input class="inp" id="pcNum" inputmode="numeric" placeholder="4111 1111 1111 1111" data-autofocus>'+
        '<div class="err" id="pcNumErr" hidden>'+ICO('alert',12)+'Enter a card number of at least 13 digits.</div></div>'+
      '<div class="grid g3">'+
        '<div class="field"><label for="pcExp">Expiry</label><input class="inp" id="pcExp" placeholder="MM/YY">'+
          '<div class="err" id="pcExpErr" hidden>'+ICO('alert',12)+'Use MM/YY, and not a date in the past.</div></div>'+
        '<div class="field"><label for="pcCvc">Security code</label><input class="inp" id="pcCvc" inputmode="numeric" placeholder="123">'+
          '<div class="err" id="pcCvcErr" hidden>'+ICO('alert',12)+'3 or 4 digits.</div></div>'+
        '<div class="field"><label for="pcName">Name on card</label><input class="inp" id="pcName" placeholder="'+esc(SHOPPER.name)+'"></div>'+
      '</div>'+
      '<label class="checkline"><input type="checkbox" id="pcDef"> Make this my default payment method</label>'+
      '<div class="impact"><strong>Before you add it</strong><ul>'+
        '<li>A small authorisation is placed and released to check the card is live.</li>'+
        '<li>Nothing is charged now — the card is only used when you buy something.</li>'+
        '<li>You can remove it at any time, as long as one method remains.</li></ul></div>'+
    '</div>'+
    '<div class="modal-foot"><span class="t-tiny muted grow">Card details are handled by the payment provider and are never stored on the marketplace.</span>'+
    '<button class="btn btn-quiet" onclick="closeModal()">Cancel</button>'+
    '<button class="btn btn-primary" onclick="submitCard()">Add card</button></div>',
    {wide:true,label:'Add a card'});
}
function submitCard(){
  const g=id=>document.getElementById(id);
  const num=(g('pcNum').value||'').replace(/\s+/g,'');
  const exp=(g('pcExp').value||'').trim();
  const cvc=(g('pcCvc').value||'').trim();
  const okNum=/^\d{13,19}$/.test(num);
  const m=exp.match(/^(\d{2})\/(\d{2})$/);
  const okExp=!!m && +m[1]>=1 && +m[1]<=12 && (2000+ +m[2])*100 + +m[1] >= 202607;
  const okCvc=/^\d{3,4}$/.test(cvc);
  g('pcNumErr').hidden=okNum; g('pcNum').setAttribute('aria-invalid',!okNum);
  g('pcExpErr').hidden=okExp; g('pcExp').setAttribute('aria-invalid',!okExp);
  g('pcCvcErr').hidden=okCvc; g('pcCvc').setAttribute('aria-invalid',!okCvc);
  if(!okNum||!okExp||!okCvc){ (!okNum?g('pcNum'):!okExp?g('pcExp'):g('pcCvc')).focus(); return; }
  const def=g('pcDef').checked;
  const holder=(g('pcName').value||'').trim()||SHOPPER.name;
  closeModal();
  const kind = num[0]==='4' ? 'Visa' : num[0]==='5' ? 'Mastercard' : 'Card';
  SEQ.pm=(SEQ.pm||3)+1;
  const card={id:'PM-'+SEQ.pm, kind:kind, detail:'•••• '+num.slice(-4), holder:holder,
              expires:exp, primary:false, status:'active', added:TODAY, isNew:true};
  MY_PAYMENTS.push(card);
  if(def){ MY_PAYMENTS.forEach(x=>x.primary=false); card.primary=true; }
  toast(kind+' ending '+num.slice(-4)+' added'+(def?' and set as default':''));
  App.go('account');
}
function makePrimary(id){
  const m=MY_PAYMENTS.find(x=>x.id===id); if(!m) return;
  if(m.status==='expired'){ toast('An expired card cannot be made the default','warn'); return; }
  MY_PAYMENTS.forEach(x=>x.primary=false); m.primary=true;
  toast(m.kind+' '+m.detail+' is now your default');
  App.go('account');
}
function removePayment(id){
  const m=MY_PAYMENTS.find(x=>x.id===id); if(!m) return;
  const remaining=MY_PAYMENTS.filter(x=>x.id!==id && x.status==='active');
  if(!remaining.length){
    toast('This is your only working payment method — add another before removing it','warn'); return;
  }
  confirmAction({
    title:'Remove '+m.kind+' '+m.detail, subtitle:m.holder+(m.expires?' · expires '+m.expires:''),
    risk:'normal', confirmLabel:'Remove',
    impact:[
      'It can no longer be used at checkout.',
      m.primary ? '<strong>This is your default.</strong> '+esc(remaining[0].kind+' '+remaining[0].detail)+' becomes the default instead.'
                : 'Your default is unchanged.',
      MY_SUBS.filter(x=>x.status==='active').length
        ? 'Your '+MY_SUBS.filter(x=>x.status==='active').length+' active subscriptions will renew against the default method.'
        : 'No subscriptions depend on it.',
      'Nothing already paid is affected.'
    ],
    onConfirm:()=>{
      const wasPrimary=m.primary;
      MY_PAYMENTS.splice(MY_PAYMENTS.indexOf(m),1);
      if(wasPrimary){ const n=MY_PAYMENTS.find(x=>x.status==='active'); if(n) n.primary=true; }
      toast(m.kind+' '+m.detail+' removed');
      App.go('account');
    }
  });
}
function replaceCard(id){
  const m=MY_PAYMENTS.find(x=>x.id===id); if(!m) return;
  toast('Add the new card, then remove the expired one');
  addCard();
}
function topUpWallet(){
  confirmAction({
    title:'Top up your wallet', subtitle:'Balance '+CUR(SHOPPER.wallet),
    risk:'normal', confirmLabel:'Top up',
    body:'<div class="grid g2">'+
      '<div class="field"><label for="twAmt">Amount</label><select class="inp" id="twAmt" data-autofocus>'+
        ['10','25','50','100'].map(v=>'<option value="'+v+'"'+(v==='25'?' selected':'')+'>'+CUR(+v)+'</option>').join('')+
        '</select></div>'+
      '<div class="field"><label for="twFrom">From</label><select class="inp" id="twFrom">'+
        MY_PAYMENTS.filter(x=>x.status==='active'&&x.kind!=='Bill to mobile').map(x=>
        '<option>'+esc(x.kind+' '+x.detail)+'</option>').join('')+
        '<option>Bill to mobile</option></select></div></div>',
    impact:['Wallet credit is spent before any card at checkout.',
            'It never expires and is refundable to the original method on request.',
            'Topping up is not a purchase — nothing is bought until you check out.'],
    onConfirm:(vals)=>{
      const amt=+((vals||{}).twAmt||25);
      SHOPPER.wallet=+(SHOPPER.wallet+amt).toFixed(2);
      MY_WALLET_LOG.unshift({when:TODAY, what:'Top-up from '+((vals||{}).twFrom||'card'), amount:amt});
      toast('Wallet topped up by '+CUR(amt)+' — balance '+CUR(SHOPPER.wallet));
      App.go('account');
    }
  });
}
function showWalletLog(){
  openInspector(
    '<div class="insp-head">'+ICO('wallet',18)+'<div class="grow"><h3 class="t-sub">Wallet</h3>'+
      '<div class="t-small muted">Balance '+CUR(SHOPPER.wallet)+'</div></div>'+
      '<button class="iconbtn" onclick="closeInspector()" aria-label="Close">'+ICO('x',16)+'</button></div>'+
    '<div class="insp-body">'+
      (MY_WALLET_LOG.length
        ? '<table class="tbl"><tbody>'+MY_WALLET_LOG.map(l=>
          '<tr><td><div class="cellmain">'+esc(l.what)+'</div><div class="cellsub">'+esc(l.when)+'</div></td>'+
          '<td class="num t-num '+(l.amount>0?'':'')+'" style="width:100px;color:'+
            (l.amount>0?'var(--nim-success-fg)':'var(--nim-ink-900)')+'">'+
            (l.amount>0?'+':'')+CUR(l.amount)+'</td></tr>').join('')+'</tbody></table>'
        : stateBlock('empty','No wallet activity','Top-ups, refunds and spend appear here.'))+
    '</div>'+
    '<div class="insp-foot"><button class="btn btn-quiet" onclick="closeInspector()">Close</button><div class="spacer"></div>'+
    '<button class="btn btn-sm btn-primary" onclick="closeInspector();topUpWallet()">Top up</button></div>','Wallet');
}
function redeemPoints(){
  if(SHOPPER.points<100){ toast('You need at least 100 points to redeem','warn'); return; }
  const worth=+(SHOPPER.points/100).toFixed(2);
  confirmAction({
    title:'Redeem '+FMT.num(SHOPPER.points)+' points', subtitle:'Worth '+CUR(worth)+' as wallet credit',
    risk:'normal', confirmLabel:'Redeem for '+CUR(worth),
    impact:['Points convert to wallet credit at 100 points to '+CUR(1)+'.',
            'Wallet credit is spent before any card at checkout.',
            'Redeeming resets your points to zero — it is all or nothing.',
            'You keep earning points on everything you buy afterwards.'],
    footNote:'Redemption cannot be reversed.',
    onConfirm:()=>{
      SHOPPER.wallet=+(SHOPPER.wallet+worth).toFixed(2);
      MY_WALLET_LOG.unshift({when:TODAY, what:'Redeemed '+FMT.num(SHOPPER.points)+' reward points', amount:worth});
      SHOPPER.points=0;
      toast('Redeemed — '+CUR(worth)+' added to your wallet');
      App.go('account');
    }
  });
}

/* -------------------------------- addresses ------------------------------- */
function editAddress(id){
  const a = id ? MY_ADDRESSES.find(x=>x.id===id) : null;
  const isNew = !a;
  openModal('<div class="modal-head">'+ICO('pin',18)+'<div class="grow"><h3 class="t-sub">'+
    (isNew?'Add an address':'Edit '+esc(a.label))+'</h3>'+
    '<div class="t-small muted">Used for anything physical. Digital items and eSIMs do not need one.</div></div>'+
    '<button class="iconbtn" onclick="closeModal()" aria-label="Close">'+ICO('x',16)+'</button></div>'+
    '<div class="modal-body stack">'+
      '<div class="grid g2">'+
        '<div class="field"><label for="adLabel">Label</label>'+
          '<input class="inp" id="adLabel" data-autofocus value="'+esc(a?a.label:'')+'" placeholder="Home, Work, Mum\'s place">'+
          '<div class="err" id="adLabelErr" hidden>'+ICO('alert',12)+'Give it a name so you can pick it at checkout.</div></div>'+
        '<div class="field"><label for="adPhone">Contact number for the courier</label>'+
          '<input class="inp" id="adPhone" value="'+esc(a?a.phone:SHOPPER.msisdn)+'"></div>'+
      '</div>'+
      '<div class="field"><label for="adLine">Address</label>'+
        '<input class="inp" id="adLine" value="'+esc(a?a.line1:'')+'" placeholder="Flat, building, street">'+
        '<div class="err" id="adLineErr" hidden>'+ICO('alert',12)+'A street address is required.</div></div>'+
      '<div class="grid g2">'+
        '<div class="field"><label for="adCity">City</label><input class="inp" id="adCity" value="'+esc(a?a.city:SHOPPER.city)+'"></div>'+
        '<div class="field"><label for="adPin">PIN code</label>'+
          '<input class="inp" id="adPin" inputmode="numeric" value="'+esc(a?a.pin:'')+'" placeholder="560017">'+
          '<div class="err" id="adPinErr" hidden>'+ICO('alert',12)+'A six-digit PIN code is required for delivery.</div></div>'+
      '</div>'+
      '<div class="field"><label for="adNotes">Delivery notes (optional)</label>'+
        '<textarea class="inp" id="adNotes" placeholder="Where to leave it, gate codes, best times">'+esc(a?(a.notes||''):'')+'</textarea></div>'+
      '<label class="checkline"><input type="checkbox" id="adDef" '+((a&&a.default)||isNew&&!MY_ADDRESSES.length?'checked':'')+
        '> Make this my default delivery address</label>'+
    '</div>'+
    '<div class="modal-foot"><span class="t-tiny muted grow">Sellers see only the address you pick at checkout.</span>'+
    '<button class="btn btn-quiet" onclick="closeModal()">Cancel</button>'+
    '<button class="btn btn-primary" onclick="saveAddress('+(a?"'"+a.id+"'":'null')+')">'+
      (isNew?'Add address':'Save changes')+'</button></div>',
    {wide:true,label:isNew?'Add an address':'Edit address'});
}
function saveAddress(id){
  const g=x=>document.getElementById(x);
  const label=(g('adLabel').value||'').trim();
  const line1=(g('adLine').value||'').trim();
  const pin=(g('adPin').value||'').trim();
  const okPin=/^\d{6}$/.test(pin);
  g('adLabelErr').hidden=!!label; g('adLabel').setAttribute('aria-invalid',!label);
  g('adLineErr').hidden=!!line1;  g('adLine').setAttribute('aria-invalid',!line1);
  g('adPinErr').hidden=okPin;     g('adPin').setAttribute('aria-invalid',!okPin);
  if(!label||!line1||!okPin){ (!label?g('adLabel'):!line1?g('adLine'):g('adPin')).focus(); return; }
  const rec={label:label, line1:line1, city:(g('adCity').value||'').trim(),
             pin:pin, phone:(g('adPhone').value||'').trim(), notes:(g('adNotes').value||'').trim()};
  const def=g('adDef').checked;
  closeModal();
  let a=id?MY_ADDRESSES.find(x=>x.id===id):null;
  if(a){ Object.assign(a,rec); }
  else { SEQ.addr=(SEQ.addr||2)+1; a=Object.assign({id:'AD-'+SEQ.addr, default:false, isNew:true},rec); MY_ADDRESSES.push(a); }
  if(def){ MY_ADDRESSES.forEach(x=>x.default=false); a.default=true; }
  else if(!MY_ADDRESSES.some(x=>x.default)) a.default=true;
  toast(id ? a.label+' updated' : a.label+' added'+(a.default?' and set as default':''));
  App.go('account');
}
function makeDefaultAddress(id){
  const a=MY_ADDRESSES.find(x=>x.id===id); if(!a) return;
  MY_ADDRESSES.forEach(x=>x.default=false); a.default=true;
  toast(a.label+' is now your default delivery address');
  App.go('account');
}
function deleteAddress(id){
  const a=MY_ADDRESSES.find(x=>x.id===id); if(!a) return;
  if(MY_ADDRESSES.length<2){ toast('Keep at least one address for physical deliveries','warn'); return; }
  confirmAction({
    title:'Delete '+a.label, subtitle:a.line1+', '+a.city+' '+a.pin, risk:'normal', confirmLabel:'Delete address',
    impact:[
      'It stops appearing at checkout.',
      a.default ? '<strong>This is your default.</strong> '+esc(MY_ADDRESSES.filter(x=>x.id!==id)[0].label)+' becomes the default instead.'
                : 'Your default is unchanged.',
      'Orders already on their way are not affected — the courier keeps the address they were given.'
    ],
    onConfirm:()=>{
      const wasDef=a.default;
      MY_ADDRESSES.splice(MY_ADDRESSES.indexOf(a),1);
      if(wasDef && MY_ADDRESSES.length) MY_ADDRESSES[0].default=true;
      toast(a.label+' deleted');
      App.go('account');
    }
  });
}

/* ------------------------------ saved for later --------------------------- */
function saveItem(sku){
  if(MY_SAVED.indexOf(sku)>-1){ toast('Already saved'); return; }
  MY_SAVED.push(sku);
  toast((SKUMAP[sku]?SKUMAP[sku].name:'Item')+' saved — find it under My details');
}
function unsaveItem(sku){
  const i=MY_SAVED.indexOf(sku); if(i<0) return;
  MY_SAVED.splice(i,1);
  toast('Removed from your saved items');
  App.go(App.view);
}

/* ------------------------------ privacy actions --------------------------- */
function requestMyData(){
  confirmAction({
    title:'Request a copy of your data', subtitle:'Sent to '+esc(SHOPPER.email||'your registered email'),
    risk:'normal', confirmLabel:'Request my data',
    body:'<div class="field"><label for="drWhat">What to include</label><select class="inp" id="drWhat" data-autofocus>'+
      '<option>Everything held about me</option><option>Orders and billing only</option>'+
      '<option>Usage and service records only</option></select></div>',
    impact:['We have <strong>30 days</strong> to answer, and usually take under five.',
            'It arrives as a download link to your registered email, valid for 7 days.',
            'The copy covers what the marketplace holds. Each seller you have bought from holds their own record, and the copy lists who they are so you can ask them directly.',
            'Requesting a copy changes nothing about your account.'],
    onConfirm:(vals)=>{
      SEQ.dsr=(SEQ.dsr||0)+1;
      MY_DATA_REQUESTS.unshift({ref:'DSR-'+(4400+SEQ.dsr), kind:(vals||{}).drWhat||'Everything held about me',
        raised:TODAY, due:'24 Aug 2026'});
      toast('Request raised — reference DSR-'+(4400+SEQ.dsr)+', due 24 Aug 2026');
      App.go('account');
    }
  });
}
function closeAccount(){
  const subs=MY_SUBS.filter(s=>s.status==='active');
  const open=MY_ORDERS.filter(o=>o.stage<o.stages.length-1);
  confirmAction({
    title:'Close your account', subtitle:esc(SHOPPER.name)+' · '+esc(SHOPPER.id),
    risk:'high', confirmLabel:'Schedule closure', requireType:'CLOSE',
    body:'<div class="field"><label for="caWhy">Why are you closing it? (optional)</label>'+
      '<select class="inp" id="caWhy" data-autofocus><option>Moving to another provider</option>'+
      '<option>Too expensive</option><option>Not using it</option><option>Prefer not to say</option></select></div>',
    impact:[
      'Closure takes effect in <strong>30 days</strong>. Until then everything keeps working and you can stop it at any point.',
      subs.length ? '<strong>'+subs.length+' active subscriptions</strong> ('+CUR(subs.reduce((a,s)=>a+s.price,0))+' a month) are cancelled on that date.'
                  : 'You have no active subscriptions.',
      open.length ? '<strong>'+open.length+' orders are still in flight.</strong> They will be delivered before closure.'
                  : 'No orders are in flight.',
      SHOPPER.wallet>0 ? 'Your wallet balance of '+CUR(SHOPPER.wallet)+' is refunded to your default payment method.'
                       : 'Your wallet is empty, so there is nothing to refund.',
      'Household members on this account lose access on the same date.',
      'Order and billing records are kept for the period tax law requires, then deleted.'
    ],
    footNote:'Type CLOSE to confirm. You have 30 days to change your mind.',
    onConfirm:()=>{
      MY_CLOSURE.requested=true; MY_CLOSURE.effective='24 Aug 2026';
      toast('Closure scheduled for 24 Aug 2026 — you can stop it any time before then','warn');
      App.go('account');
    }
  });
}
function cancelClosure(){
  MY_CLOSURE.requested=false; MY_CLOSURE.effective=null;
  toast('Closure cancelled — your account and subscriptions continue as normal');
  App.go('account');
}

/* --------------------- 9. Account access (household) ---------------------- */
function vAccess(){
  const people=orgUsers('consumer').filter(u=>u.status!=='removed');
  const capped=people.filter(u=>u.cap);
  return usersView({
    ctx:'consumer', title:'Account access', userNoun:'person',
    inviteLabel:'Add someone', dirTitle:'People on this account', showCap:true,
    roleSub:'Only the account owner can pay the bill or change what anyone else is allowed to spend.',
    mfaNote:'Recommended for anyone who can buy',
    banner:banner('info','Everyone here shares one bill and one basket history, but each person only sees their own orders. '+
      capped.length+' '+(capped.length===1?'person has':'people have')+' a monthly spend cap; anything above it comes to you to approve.')
  });
}

registerExport('myOrders',()=>({
  columns:[{key:'id',label:'Order'},{key:'name',label:'Item'},{key:'seller',label:'Seller'},
           {key:'marketplace',label:'Marketplace'},{key:'qty',label:'Quantity'},{key:'gross',label:'Paid (USD)'},
           {key:'placed',label:'Placed'},{key:'stageName',label:'Stage'},{key:'pay',label:'Payment'}],
  rows:MY_ORDERS.map(o=>({id:o.id, name:o.name, seller:o.seller, marketplace:vName(o.v), qty:o.qty,
    gross:o.gross, placed:o.placed, stageName:o.stages[o.stage], pay:o.pay}))
}));
registerExport('mySubs',()=>({
  columns:[{key:'name',label:'Subscription'},{key:'seller',label:'Seller'},{key:'marketplace',label:'Marketplace'},
           {key:'price',label:'Monthly (USD)'},{key:'renews',label:'Renews'},{key:'status',label:'Status'}],
  rows:MY_SUBS.map(s=>({name:s.name, seller:s.seller, marketplace:vName(s.v), price:s.price,
    renews:s.renews, status:s.status}))
}));

/* What this household is committed to, projected forward. */
function conSpendSeries(){
  const m=MY_SUBS.filter(function(s){return s.status==='active'}).reduce(function(a,s){return a+s.price},0);
  return HISTORY.map(function(h,i){
    return {month:h.month, orders:h.orders, gross:+((m*(0.9+i*0.018))+(i%4===0?38:0)).toFixed(2)};
  });
}

/* --------------------- 9b. What each person can do ------------------------ */
function vConRoles(){
  return rolesView({
    ctx:'consumer', title:'What each person can do',
    banner:banner('info','You are the account owner, so only you can change these. '+
      'Everyone on the account shares one bill — this grid is how you decide who can add to it.')
  });
}

/* ----------------------- 9d. Help ----------------------------------------- */
function vConTickets(){
  return ticketsView({ctx:'consumer', title:'Help'});
}

/* ----------------------- 9c. Account activity ----------------------------- */
function vConAudit(){
  return auditView({ctx:'consumer', title:'Account activity',
    banner:banner('info','<strong>Everything that has happened on this account.</strong> Who bought what, who '+
      'changed a spend cap, when a password was changed. As the account owner you see all of it; everyone else on '+
      'the account sees only their own orders. Nothing here can be deleted, including by you — which is the point '+
      'of it.')});
}

/* ----------------------- 10. Notification preferences --------------------- */
/* A customer decides what they are told and how. They do not administer rules,
   author message templates, or reason about severity-to-channel mapping —
   those are the marketplace's job, and putting them on a retail account makes
   the simple choice ("stop texting me about offers") harder to find.
   The two pages are merged because "what I want to be told" and "what you
   actually sent me" are one question to a person, asked in two directions. */
function vConNotif(){
  return notifView({
    ctx:'consumer', title:'Messages and alerts',
    channels:['Push','Email','SMS'],
    scopeNote:'what you get told, and how',
    quietNote:'A failed delivery still comes through at night — everything else waits until morning.',
    escalateLabel:'Text me as well if I have not opened an urgent alert within an hour',
    prefScope:'you only', canCreate:false, sentCount:'21',
    rules:false, messages:false, severity:false, test:false, recent:false,
    banner:banner('info','Two of these are about other people on your account — approval requests and spend caps. '+
      'Turn them off and household purchases go through without reaching you. '+
      '<button class="linkbtn" onclick="App.go(\'access\')">See who is on the account</button>'),
    append: consumerAlertPrefsPanel() +
      deliveryView({title:null, heading:false, logTitle:'What we sent you',
        rows:DELIVERIES.filter(d=>d.ctx==='consumer'),
        providers:false, spend:false, channels:false, cost:false, states:false})
  });
}

/* What a customer can actually turn on and off, in their own words. Built from
   the same rule records the marketplace administers, so this is a plain-English
   view of a real thing rather than a second set of switches that agree with
   nothing. */
function consumerAlertPrefsPanel(){
  const rules=NOTIF_RULES.consumer||[];
  const chans=['Push','SMS','Email'];
  return panel('What you want to hear about',
    '<p class="t-small">Pick what reaches you and how it reaches you. A switch turns the whole subject '+
    'off; the channels next to it decide where the ones you keep are sent.</p>'+
    '<div class="stack" style="gap:2px">'+rules.map(r=>{
      const must=alertIsMandatory(r);
      return '<div class="prefrow">'+
        '<span class="grow"><span class="t-small strong">'+esc(r.name)+'</span>'+
          '<span class="cellsub">'+esc(r.event)+'</span>'+
          (must?'<span class="cellsub t-tiny">Always sent — we are required to tell you</span>':'')+
        '</span>'+
        '<span class="chanpick" role="group" aria-label="Channels for '+esc(r.name)+'">'+
          chans.map(c=>{
            const on=(r.chans||[]).indexOf(c)>-1;
            const only=on && (r.chans||[]).length===1;
            return '<button type="button" class="chanchip'+(on?' is-on':'')+'" '+
              'aria-pressed="'+on+'" '+
              (must&&only?'disabled title="This has to reach you somewhere" ':'')+
              'onclick="toggleAlertChannel(\''+r.id+'\',\''+c+'\')">'+
              (on?SH('check',10):SH('dash',10))+esc(c)+'</button>';
          }).join('')+
        '</span>'+
        '<span class="toggle"><input type="checkbox"'+(r.on?' checked':'')+(must?' disabled':'')+
          ' onchange="toggleConsumerAlert(\''+r.id+'\',this.checked)"'+
          ' aria-label="'+esc(r.name)+'"><span class="track"></span></span>'+
      '</div>';
    }).join('')+'</div>'+
    '<p class="t-small muted" style="margin-top:10px">Anything about a payment failing or your service '+
      'being interrupted is always sent, whatever is set here \u2014 you would want to know, and in most '+
      'places we have to tell you. Those subjects still let you choose the channel, as long as one is '+
      'left on.</p>',
    {icon:'bell',
     sub:rules.filter(r=>r.on).length+' of '+rules.length+' on · '+
       chans.map(c=>c+' '+rules.filter(r=>r.on&&(r.chans||[]).indexOf(c)>-1).length).join(' · ')});
}
/* Some subjects are not optional. A price rise on something you already pay for
   and a delivery that failed are both things a person is entitled to be told,
   so the switch is fixed on and only the channel is theirs to choose. */
function alertIsMandatory(r){ return r.sev==='high'; }
function toggleConsumerAlert(id,on){
  const r=(NOTIF_RULES.consumer||[]).find(x=>x.id===id); if(!r) return;
  if(alertIsMandatory(r)){
    toast(r.name+' cannot be turned off — pick where it reaches you instead','warn');
    App.go(App.view); return;
  }
  r.on=!!on;
  toast(r.name+(r.on?' on':' off'), r.on?'ok':'warn');
  App.go(App.view);
}
function toggleAlertChannel(id,chan){
  const r=(NOTIF_RULES.consumer||[]).find(x=>x.id===id); if(!r) return;
  r.chans=(r.chans||[]).slice();
  const i=r.chans.indexOf(chan);
  if(i>-1){
    /* Removing the last channel on a subject that is still on means agreeing to
       be told and then giving us nowhere to tell you. */
    if(r.chans.length===1){
      toast(alertIsMandatory(r)
        ? r.name+' has to reach you somewhere — pick another channel first'
        : r.name+' would have nowhere to go. Turn the whole subject off instead.','warn');
      return;
    }
    r.chans.splice(i,1);
    toast(r.name+' will no longer come by '+chan.toLowerCase());
  } else {
    r.chans.push(chan);
    /* Keep them in a consistent order so the row does not reshuffle as you click. */
    const order=['Push','SMS','Email','In-app'];
    r.chans.sort((x,y)=>order.indexOf(x)-order.indexOf(y));
    toast(r.name+' will also come by '+chan.toLowerCase());
  }
  if(typeof audit==='function') audit('notif.rule',{object:r.name,
    after:r.chans.join(', '), detail:'Channels changed by the account holder'});
  App.go(App.view);
}

/* ------------------------------- registration ---------------------------- */
function vConRefunds(){ return refundsView({ctx:'consumer', title:'Refunds'}); }
function vConRewards(){ return rewardsMemberView({memberId:'LM-4001', ctx:'consumer'}); }
const VIEWS={
  refunds:vConRefunds, rewards:vConRewards,
  bills:vConBills,
  help:vConHelp,
  bulk:vConBulk,
  delivery:vConDelivery,
  auth:vConAuth,
  home:vShopHome, browse:vBrowse, plans:vPlans, content:vContent, devices:vDevices,
  orders:vOrders, subs:vSubs, access:vAccess, roles:vConRoles, notifications:vConNotif,
  audit:vConAudit, tickets:vConTickets, account:vAccount
};
function BEFORE_RENDER(){ recomputeDerived(); }
function AFTER_RENDER(){ updateCartBadge(); }

App.init({
  brand:'6d',
  /* Messages we sent you was merged into Messages and alerts. */
  aliases:{delivery:'notifications'}, cart:true,
  orgCtx:'consumer', profileView:'account', securityView:'access',
  profileSub:'Contact, payment, addresses and privacy',
  signedIn:'today at 08:05',
  product:'Aventa Marketplace', tier:'Powered by 6D Marketplace',
  env:'Consumer storefront',
  persona:{name:SHOPPER.name, role:SHOPPER.tier+' member', org:MP.operator},
  searchScope:'the marketplace', alertCount:2,
  notifications:[
    {when:'20 min ago', text:'Your Kestrel K9 Pro is out for delivery — arriving today before 18:00', source:'Order updates', kind:'info', read:false},
    {when:'2 h ago', text:'A delivery attempt failed — the parcel is at the Marathahalli depot', source:'Order updates', kind:'danger', read:false},
    {when:'Yesterday', text:'StreamNova Premium renews on 02 Aug at '+CUR(12.99), source:'Subscriptions', kind:'info', read:true},
    {when:'3 d ago', text:'You have '+FMT.num(SHOPPER.points)+' points — worth '+CUR(SHOPPER.points/100)+' off your next order', source:'Rewards', kind:'success', read:true}
  ],
  footNote:SHOPPER.id+' · '+SHOPPER.city,
  aiName:'Shopping assistant',
  aiGreeting:'I can help you find something, compare plans, or work out whether a bundle is actually cheaper for you.'+
    '<div class="src">Sources: marketplace catalogue, your subscriptions, your order history.</div>',
  aiSuggestions:['Would a bundle save me money?','Which plan suits my usage?','Where is my order?','Cheapest way to get 4K streaming'],
  nav:[
    {label:'Shop', items:[
      {id:'home', label:'Storefront', icon:'dashboard'},
      {id:'browse', label:'Browse all', icon:'search', count:shopCatalogue().length},
      {id:'plans', label:'Mobile and eSIM', icon:'smartphone'},
      {id:'devices', label:'Devices', icon:'monitor'},
      {id:'content', label:'Digital content', icon:'play'}]},
    {label:'My stuff', items:[
      {id:'orders', label:'My orders', icon:'orders', count:()=>MY_ORDERS.length},
      {id:'refunds', label:'Refunds', icon:'refresh',
       count:()=>REFUNDS.filter(r=>r.ctx==='consumer' && r.state==='requested').length},
      {id:'subs', label:'Subscriptions', icon:'refresh', count:()=>MY_SUBS.filter(s=>s.status==='active').length},
      {id:'rewards', label:'Rewards', icon:'zap', count:()=>LTXFOR('LM-4001').length}]},
    {label:'Account', items:[
      {id:'access', label:'Account access', icon:'shield',
       count:()=>orgUsers('consumer').filter(u=>u.status!=='removed').length},
      {id:'bulk', label:'Change several at once', icon:'upload', count:()=>bulkSets().length},
      {id:'roles', label:'What each person can do', icon:'key', count:()=>orgRoles('consumer').length},
      {id:'auth', label:'Sign-in and devices', icon:'lock', count:()=>(SESSIONS.consumer||[]).length},
      {id:'notifications', label:'Messages and alerts', icon:'bell',
       count:()=>DELIVERIES.filter(d=>d.ctx==='consumer'&&(d.state==='failed'||d.state==='expired')).length},
      {id:'tickets', label:'Help', icon:'support',
       count:()=>tktVisible('consumer').filter(t=>['new','open','waiting','escalated'].indexOf(t.state)>-1).length},
      {id:'help', label:'How things work', icon:'file', count:()=>(KB_ARTICLES.consumer||[]).length},
      {id:'audit', label:'Account activity', icon:'history',
       count:()=>auditRows('consumer').filter(e=>e.sev==='high').length},
      {id:'bills', label:'Bills', icon:'invoice', count:()=>MY_BILLS.filter(b=>b.status!=='paid').length},
      {id:'account', label:'My details', icon:'user'}]}
  ],
  searchIndex: shopCatalogue().slice(0,14).map(p=>({k:VMAP[p.v].aud, t:p.name+' — '+CUR(p.price), v:'browse'}))
    .concat([{k:'Screen',t:'My orders and delivery tracking',v:'orders'},
             {k:'Screen',t:'Rewards, points and tier',v:'rewards'},
             {k:'Screen',t:'My subscriptions',v:'subs'},
             {k:'Screen',t:'Mobile plans and eSIM',v:'plans'},
             {k:'Screen',t:'Account, payment and privacy',v:'account'},
             {k:'Screen',t:'Account access and household members',v:'access'},
             {k:'Screen',t:'Notification preferences',v:'notifications'}]),
  aiAnswer(q){
    if(/bundle|save|cheaper|money/.test(q))
      return 'Yes, in your case. You pay separately for three things that the duo bundle covers:'+
        '<table><tr><th>Now</th><th>Monthly</th></tr>'+
        '<tr><td>Aventa Freedom 50 GB</td><td>'+CUR(18)+'</td></tr>'+
        '<tr><td>StreamNova Premium 4K</td><td>'+CUR(12.99)+'</td></tr>'+
        '<tr><td>Halo Music Family</td><td>'+CUR(14.99)+'</td></tr>'+
        '<tr><td><strong>Total</strong></td><td><strong>'+CUR(45.98)+'</strong></td></tr></table>'+
        'The <strong>Unlimited + Streaming duo</strong> is '+CUR(34)+' and includes any two subscriptions — so '+CUR(11.98)+' less, '+
        'and you move from 50 GB to unlimited data. The catch: it has to be two, not three, so a third subscription is charged on top.'+
        '<div class="src">Sources: your subscriptions, bundle catalogue, current tariff.</div>';
    if(/plan|usage|data|which.*plan/.test(q))
      return 'You are on <strong>Freedom 50 GB</strong> and have used between 31 and 44 GB in each of the last three months — so you are close to the ceiling but have not gone over.'+
        '<br><br>Freedom Unlimited at '+CUR(27)+' would remove the risk for '+CUR(9)+' more a month. Whether that is worth it depends on how much a slowdown at month-end would bother you. '+
        'If you take the duo bundle it becomes the cheaper option anyway.'+
        '<div class="src">Sources: your last three bills, plan catalogue.</div>';
    if(/order|where|deliver|track/.test(q)){
      const o=MY_ORDERS[0];
      return o ? 'Your most recent order is <strong>'+esc(o.id)+'</strong> — '+esc(o.name)+', placed '+esc(o.placed)+'.'+
        '<br><br>Status: <strong>'+esc(o.stages[o.stage])+'</strong>'+(o.failed?' — a delivery attempt failed and it is waiting at the depot. You can rebook from My orders.':'.')+
        '<div class="src">Sources: your order history, carrier tracking feed.</div>'
        : 'You have no orders on this account yet.<div class="src">Sources: your order history.</div>';
    }
    if(/4k|stream|watch|tv/.test(q))
      return 'Cheapest route to 4K streaming, from what is on the marketplace today:'+
        '<table><tr><th>Option</th><th>Monthly</th></tr>'+
        '<tr><td>StreamNova Premium 4K on its own</td><td>'+CUR(12.99)+'</td></tr>'+
        '<tr><td>Inside the Unlimited + Streaming duo</td><td>effectively '+CUR(8)+'</td></tr></table>'+
        'You already hold Premium 4K, so the saving comes from moving it into the bundle rather than buying anything new.'+
        '<div class="src">Sources: content catalogue, bundle pricing, your subscriptions.</div>';
    return null;
  }
});

/* ===========================================================================
   Storefront tools that were placeholders — now real flows.
   =========================================================================== */

/* ------------------------------ coverage check ---------------------------- */
function coverageCheck(){
  openModal('<div class="modal-head">'+ICO('pin',18)+'<div class="grow"><h3 class="t-sub">Check coverage</h3>'+
    '<div class="t-small muted">Enter a PIN code. Where a network has not been surveyed we say so rather than guess.</div></div>'+
    '<button class="iconbtn" onclick="closeModal()" aria-label="Close">'+ICO('x',16)+'</button></div>'+
    '<div class="modal-body stack">'+
      '<div class="field"><label for="cvPin">PIN code</label>'+
        '<div class="row" style="gap:8px"><input class="inp" id="cvPin" inputmode="numeric" placeholder="560017" '+
        'data-autofocus style="max-width:180px" onkeydown="if(event.key===\'Enter\'){event.preventDefault();runCoverage()}">'+
        '<button class="btn" onclick="runCoverage()">Check</button></div>'+
        '<div class="err" id="cvErr" hidden>'+ICO('alert',12)+'Enter a six-digit PIN code.</div>'+
        '<div class="hint">Try 560017, 560103, 400001, 110001 or 682001.</div></div>'+
      '<div id="cvResult"></div>'+
    '</div>'+
    '<div class="modal-foot"><span class="t-tiny muted grow">Coverage is indicative. Buildings, floors and handsets all change what you actually get.</span>'+
    '<button class="btn btn-quiet" onclick="closeModal()">Close</button></div>',
    {wide:true,label:'Check coverage'});
}
function runCoverage(){
  const el=document.getElementById('cvPin');
  const pin=(el.value||'').trim();
  const okPin=/^\d{6}$/.test(pin);
  document.getElementById('cvErr').hidden=okPin;
  el.setAttribute('aria-invalid',!okPin);
  const host=document.getElementById('cvResult');
  if(!okPin){ host.innerHTML=''; el.focus(); return; }
  const c=COVERAGE[pin];
  const lvl=v=>v==null
    ? '<span class="nodata">Not surveyed</span>'
    : v==='Excellent'?pill('active','Excellent'):v==='Good'?pill('open','Good')
      :v==='Variable'?pill('degraded','Variable'):pill('neutral',v);
  host.innerHTML = c
    ? '<div class="divider"></div>'+
      '<div class="row" style="margin-bottom:10px">'+ICO('pin',15)+
      '<div class="grow"><div class="t-sub">'+esc(c.area)+'</div>'+
      '<div class="t-tiny muted">PIN '+esc(pin)+'</div></div></div>'+
      '<table class="tbl"><tbody>'+
      '<tr><td class="cellmain">5G</td><td style="width:130px">'+lvl(c.fiveG)+'</td></tr>'+
      '<tr><td class="cellmain">4G</td><td>'+lvl(c.fourG)+'</td></tr>'+
      '<tr><td class="cellmain">Indoor signal</td><td>'+lvl(c.indoor)+'</td></tr>'+
      '</tbody></table>'+
      (c.note?'<div style="margin-top:11px">'+banner(c.fiveG==null?'partial':'warning',esc(c.note))+'</div>':'')+
      '<div class="row" style="margin-top:12px"><span class="t-tiny muted grow">Happy with this?</span>'+
      '<button class="btn btn-sm btn-primary" onclick="closeModal();App.go(\'plans\')">See plans</button></div>'
    : '<div class="divider"></div>'+
      stateBlock('unavailable','No survey data for '+esc(pin),
        'We have not surveyed this PIN code, so we will not put a coverage level against it. '+
        'A travel eSIM or a 30-day rolling plan lets you test it without committing.',
        '<button class="btn btn-sm" onclick="closeModal();openProduct(\'SKU-2003\')">Look at the travel eSIM</button>');
}

/* --------------------------------- trade-in ------------------------------- */
function tradeInDialog(){
  openModal('<div class="modal-head">'+ICO('swap',18)+'<div class="grow"><h3 class="t-sub">Trade in a device</h3>'+
    '<div class="t-small muted">Pick the handset and its condition to see what it is worth as credit.</div></div>'+
    '<button class="iconbtn" onclick="closeModal()" aria-label="Close">'+ICO('x',16)+'</button></div>'+
    '<div class="modal-body stack">'+
      '<div class="field"><label for="tiModel">Which handset</label>'+
        '<select class="inp" id="tiModel" data-autofocus onchange="quoteTradeIn()">'+
        TRADEIN.models.map(m=>'<option value="'+m.id+'">'+esc(m.name)+'</option>').join('')+'</select></div>'+
      '<div class="field"><label>Condition</label><div class="stack" style="gap:8px;margin-top:4px">'+
        TRADEIN.conditions.map((c,i)=>
        '<label class="checkline" style="border:1px solid var(--nim-line-200);border-radius:6px;padding:9px 11px">'+
        '<input type="radio" name="tiCond" value="'+c.id+'" '+(i===0?'checked':'')+' onchange="quoteTradeIn()">'+
        '<span><span class="t-small strong">'+esc(c.name)+'</span><br>'+
        '<span class="t-tiny muted">'+esc(c.desc)+'</span></span></label>').join('')+'</div></div>'+
      '<div id="tiQuote"></div>'+
    '</div>'+
    '<div class="modal-foot"><span class="t-tiny muted grow">The final value is confirmed when we receive the handset.</span>'+
    '<button class="btn btn-quiet" onclick="closeModal()">Cancel</button>'+
    '<button class="btn btn-primary" onclick="acceptTradeIn()">Accept the quote</button></div>',
    {wide:true,label:'Trade in a device'});
  quoteTradeIn();
}
function tradeInValue(){
  const m=TRADEIN.models.find(x=>x.id===(document.getElementById('tiModel')||{}).value)||TRADEIN.models[0];
  const c=(document.querySelector('input[name="tiCond"]:checked')||{}).value||'good';
  return {model:m, cond:c, value:m[c]};
}
function quoteTradeIn(){
  const host=document.getElementById('tiQuote'); if(!host) return;
  const q=tradeInValue();
  host.innerHTML='<div class="divider"></div>'+
    '<div class="row" style="align-items:baseline;gap:10px">'+
      '<div><div class="t-tiny muted">Quoted value</div><div class="price">'+CUR(q.value)+'</div></div>'+
      '<div class="grow t-tiny muted">'+esc(q.model.name)+' in '+
      esc(TRADEIN.conditions.find(c=>c.id===q.cond).name.toLowerCase())+' condition</div>'+
    '</div>'+
    '<div class="impact" style="margin-top:11px"><strong>How it works</strong><ul>'+
      '<li>The credit is applied to your next order, or to your wallet if you are not buying today.</li>'+
      '<li>We send a prepaid envelope. You have 14 days to post it.</li>'+
      '<li>If the handset arrives in worse condition than quoted, we re-quote and you can decline and have it back.</li>'+
      '<li>Wipe the device first — we cannot return data once it is processed.</li></ul></div>';
}
function acceptTradeIn(){
  const q=tradeInValue();
  closeModal();
  confirmAction({
    title:'Accept '+CUR(q.value)+' for your '+q.model.name, subtitle:'Condition: '+
      TRADEIN.conditions.find(c=>c.id===q.cond).name,
    risk:'normal', confirmLabel:'Accept and send me an envelope',
    impact:['<strong>'+CUR(q.value)+'</strong> is held as trade-in credit and applied to your next order.',
            'A prepaid envelope arrives in 2 to 3 working days; you have 14 days to post the handset.',
            'The quote is provisional until we inspect it. A different condition means a new quote you can refuse.',
            'Back out at any point before posting and the credit simply disappears.'],
    onConfirm:()=>{
      TRADEIN_CREDIT=+(TRADEIN_CREDIT+q.value).toFixed(2);
      toast(CUR(q.value)+' trade-in credit added — it comes off your next order');
      App.go(App.view);
    }
  });
}

/* ------------------------------ bundle builder ---------------------------- */
const BB = {plan:'SKU-2002', device:null, subs:[]};
function bundleBuilder(){
  const plans=LIVE_PRODUCTS.filter(p=>p.cat==='Mobile plans');
  const devices=LIVE_PRODUCTS.filter(p=>p.cat==='Phones');
  const subs=LIVE_PRODUCTS.filter(p=>p.v==='content'&&p.model==='monthly');
  openModal('<div class="modal-head">'+ICO('package',18)+'<div class="grow"><h3 class="t-sub">Build your own bundle</h3>'+
    '<div class="t-small muted">A plan, optionally a handset, and up to three subscriptions. The discount grows with each subscription.</div></div>'+
    '<button class="iconbtn" onclick="closeModal()" aria-label="Close">'+ICO('x',16)+'</button></div>'+
    '<div class="modal-body stack">'+
      '<div class="field"><label for="bbPlan">Plan</label><select class="inp" id="bbPlan" data-autofocus onchange="BB.plan=this.value;quoteBundle()">'+
        plans.map(p=>{
          const rep=wouldReplace(p.id).map(id=>(SKUMAP[id]||{}).name).filter(Boolean);
          return '<option value="'+p.id+'"'+(BB.plan===p.id?' selected':'')+'>'+esc(p.name)+' — '+
            CUR(p.price)+'/mo'+(rep.length?' · replaces '+esc(rep[0]):'')+'</option>';
        }).join('')+
        '</select></div>'+
      '<div class="field"><label for="bbDev">Handset (optional)</label><select class="inp" id="bbDev" onchange="BB.device=this.value||null;quoteBundle()">'+
        '<option value="">No handset — keep the one I have</option>'+
        devices.map(p=>'<option value="'+p.id+'"'+(BB.device===p.id?' selected':'')+'>'+esc(p.name)+' — '+CUR(p.price)+'</option>').join('')+
        '</select></div>'+
      '<div class="field"><label>Subscriptions — pick up to three</label>'+
        '<div class="stack" style="gap:7px;margin-top:4px;max-height:190px;overflow:auto">'+
        subs.map(p=>'<label class="checkline" style="border:1px solid var(--nim-line-200);border-radius:6px;padding:8px 10px">'+
        '<input type="checkbox" class="bbSub" value="'+p.id+'" '+(BB.subs.indexOf(p.id)>-1?'checked':'')+' onchange="bbPick(this)">'+
        '<span class="grow"><span class="t-small strong">'+esc(p.name)+'</span> '+
        '<span class="t-tiny muted">'+esc(p.seller)+'</span></span>'+
        '<span class="t-small t-num">'+CUR(p.price)+'</span></label>').join('')+'</div></div>'+
      '<div id="bbQuote"></div>'+
    '</div>'+
    '<div class="modal-foot"><span class="t-tiny muted grow">Each item can still be cancelled on its own afterwards.</span>'+
    '<button class="btn btn-quiet" onclick="closeModal()">Cancel</button>'+
    '<button class="btn btn-primary" onclick="addBundleToBasket()">Add the bundle to my basket</button></div>',
    {wide:true,label:'Build your own bundle'});
  quoteBundle();
}
function bbPick(el){
  const v=el.value;
  if(el.checked){
    if(BB.subs.length>=3){ el.checked=false; toast('Three subscriptions is the most a bundle can hold','warn'); return; }
    /* The builder has to obey the same rules as the basket. It used to let
       two tiers of one service be picked together, and the basket then
       refused the second — so the bundle quietly came out one item short of
       what was quoted. Refused at the point of choice, with the reason. */
    const clash = bbClash(v);
    if(clash){
      el.checked=false;
      toast(SKUMAP[v].name+' cannot be bundled with '+SKUMAP[clash.sku].name+' — '+clash.why,'warn');
      return;
    }
    BB.subs.push(v);
  } else {
    const i=BB.subs.indexOf(v); if(i>-1) BB.subs.splice(i,1);
  }
  quoteBundle();
}
/* Does this candidate clash with the plan or a subscription already picked?
   Checked in both directions, because an exclusion may be stated on either
   side of the pair. */
function bbClash(v){
  const picked = [BB.plan].concat(BB.subs).filter(Boolean);
  const mine = (prodRule(v)||{}).excludes || [];
  for(const x of mine) if(picked.indexOf(x.sku)>-1 && SKUMAP[x.sku]) return x;
  for(const id of picked){
    const theirs = (prodRule(id)||{}).excludes || [];
    for(const x of theirs) if(x.sku===v) return {sku:id, why:x.why};
  }
  return null;
}
function bundleMath(){
  const items=[];
  if(BB.plan && SKUMAP[BB.plan]) items.push(SKUMAP[BB.plan]);
  BB.subs.forEach(id=>{ if(SKUMAP[id]) items.push(SKUMAP[id]); });
  const monthly=items.reduce((a,p)=>a+p.price,0);
  const oneoff=BB.device&&SKUMAP[BB.device] ? SKUMAP[BB.device].price : 0;
  /* Discount is a stated rule, not a mystery: 5% per subscription, capped at 15%. */
  const pct=Math.min(15, BB.subs.length*5);
  const save=+(monthly*pct/100).toFixed(2);
  return {items, monthly:+monthly.toFixed(2), oneoff, pct, save, net:+(monthly-save).toFixed(2)};
}
function quoteBundle(){
  const host=document.getElementById('bbQuote'); if(!host) return;
  const m=bundleMath();
  host.innerHTML='<div class="divider"></div>'+
    '<div class="totals">'+
      '<span class="lbl">Monthly, at list price</span><span class="val">'+CUR(m.monthly)+'</span>'+
      '<span class="lbl">Bundle discount — '+m.pct+'% for '+BB.subs.length+' subscription'+(BB.subs.length===1?'':'s')+'</span>'+
      '<span class="val">'+(m.save?'less '+CUR(m.save):CUR(0))+'</span>'+
      '<span class="grand-lbl">Monthly with the bundle</span><span class="val grand">'+CUR(m.net)+'</span>'+
      (m.oneoff?'<span class="lbl" style="padding-top:8px">Handset, one-off</span>'+
                '<span class="val" style="padding-top:8px">'+CUR(m.oneoff)+'</span>':'')+
    '</div>'+
    (BB.subs.length<3
      ? '<div class="t-tiny muted" style="margin-top:9px">Adding one more subscription takes the discount to '+
        Math.min(15,(BB.subs.length+1)*5)+'%.</div>'
      : '<div class="t-tiny muted" style="margin-top:9px">You are at the maximum discount.</div>');
}
function addBundleToBasket(){
  const m=bundleMath();
  if(!BB.subs.length){ toast('A bundle needs at least one subscription to earn a discount','warn'); return; }
  closeModal();
  confirmAction({
    title:'Add your bundle', subtitle:CUR(m.net)+' a month'+(m.oneoff?' plus '+CUR(m.oneoff)+' for the handset':''),
    risk:'normal', confirmLabel:'Add to basket',
    body:'<table class="tbl"><tbody>'+m.items.map(p=>
      '<tr><td class="cellmain">'+esc(p.name)+'</td><td class="cellsub">'+esc(p.seller)+'</td>'+
      '<td class="num t-num">'+CUR(p.price)+'</td></tr>').join('')+
      (m.oneoff?'<tr><td class="cellmain">'+esc(SKUMAP[BB.device].name)+'</td><td class="cellsub">one-off</td>'+
      '<td class="num t-num">'+CUR(m.oneoff)+'</td></tr>':'')+'</tbody></table>',
    impact:[].concat(
           /* Changing plan inside a bundle is a switch, and the buyer is told
              so before they agree rather than after the old line stops. */
           wouldReplace(BB.plan).map(id=>
             'Your '+((SKUMAP[id]||{}).name||id)+' closes when '+
             SKUMAP[BB.plan].name+' activates. One plan per line, so this is a '+
             'change of plan and not a second subscription.'),
           ['The '+m.pct+'% discount applies for as long as all '+BB.subs.length+
            ' subscriptions stay active — drop one and the rest return to list price.',
            'Each item is still billed and cancelled separately; the bundle is a discount, not a contract.',
            'Digital items start immediately. A handset ships next working day.']),
    onConfirm:()=>{
      /* The plan carries what it replaces; the buyer just read and accepted
         it in the impact list above. */
      const rep=wouldReplace(BB.plan);
      m.items.forEach(p=>addToCart(p.id, 1,
        p.id===BB.plan && rep.length ? {replaces:rep[0]} : null));
      if(BB.device) addToCart(BB.device);
      BB.subs=[]; BB.device=null;
      toast('Bundle added — '+CUR(m.save)+' a month off while all of it stays active');
      openCart();
    }
  });
}

/* --------------------- DELIVERY AND SIGN-IN (M20) ------------------------ */
/* Kept as a redirect: the two pages are now one, and a bookmark should not
   land on a dead route. */
function vConDelivery(){ return vConNotif(); }
function vConAuth(){ return vAuth(); }

/* --------------------- BULK UPDATE (M21) -------------------------------- */
function vConBulk(){ return bulkView({title:'Change several at once'}); }

/* --------------------- KNOWLEDGE BASE (M24) ----------------------------- */
function vConHelp(){ return kbView(); }

/* --------------------- BILLS (M31) -------------------------------------- */
function conBillTotal(b){
  const rec=MY_SUBS.filter(s=>s.status==='active').reduce((a,s)=>a+(s.price||0),0);
  const base=rec+(b.oneoff||0);
  const r=((typeof taxRate==='function')?taxRate():18)/100;
  return {rec:rec, base:base, tax:+(base*r).toFixed(2), total:+(base*(1+r)).toFixed(2)};
}
function vConBills(){
  const open=MY_BILLS.filter(b=>b.status!=='paid');
  const due=open.reduce((a,b)=>a+conBillTotal(b).total,0);
  return '<div class="stack">'+
    pagehead('Bills',
      'Every charge on one bill, whoever you bought from.',
      exportBtn('Bills','dtConBills'))+
    (open.length
      ? banner('info','<strong>'+CUR(due)+' due by '+esc(open[0].due)+'.</strong> Your subscriptions renew on '+
        'the same cycle, so the recurring part rarely changes.')
      : banner('success','Nothing outstanding.'))+
    /* A failed payment goes above the bill list, not below it. Somebody whose
       service is about to stop is not here to read a statement. */
    arrearsPanel('consumer')+
    panel('Your bills', dt('dtConBills',{
      rows:MY_BILLS.slice(), noun:'bills', pageSize:8, idKey:'id',
      actions:exportBtn('Bills','dtConBills'),
      columns:[
        {key:'id',label:'Bill',render:r=>'<div class="cellmain t-num">'+esc(r.id)+'</div>'+
          '<div class="cellsub">'+esc(r.period)+'</div>'},
        {key:'issued',label:'Issued',render:r=>esc(r.issued)},
        {key:'due',label:'Due',render:r=>esc(r.due)},
        {key:'__rec',label:'Subscriptions',align:'right',sort:false,
          render:r=>'<span class="t-num">'+CUR(conBillTotal(r).rec)+'</span>'},
        {key:'oneoff',label:'One-off',align:'right',
          render:r=>r.oneoff?'<span class="t-num">'+CUR(r.oneoff)+'</span>':'<span class="dim">—</span>'},
        {key:'__tax',label:'Tax',align:'right',sort:false,
          render:r=>'<span class="t-num">'+CUR(conBillTotal(r).tax)+'</span>'},
        {key:'__tot',label:'Total',align:'right',sort:false,
          render:r=>'<span class="t-num cellmain">'+CUR(conBillTotal(r).total)+'</span>'},
        {key:'status',label:'State',render:r=>r.status==='paid'?pill('paid'):pill('open','Due')},
        {key:'__acts',label:'',sort:false,render:r=>
          '<button class="btn btn-sm btn-quiet" onclick="event.stopPropagation();downloadConsumerBill('+
            'MY_BILLS.filter(function(x){return x.id===\''+r.id+'\'})[0])">PDF</button>'+
          '<button class="btn btn-sm btn-quiet" onclick="event.stopPropagation();downloadConBillCsv(\''+r.id+'\')">CSV</button>'}
      ]}),{flush:true,icon:'invoice',
        sub:'The PDF is the document; the CSV is the data behind it'})+
    panel('What is on every bill',
      '<p class="t-small muted">Your active subscriptions, anything bought outright in the period, tax, and '+
      'any credit owed to you. Tax is shown once — where the shelf price already includes it, the net is the '+
      'price with the tax taken back out rather than added on top.</p>'+
      '<ul class="ticklist">'+MY_SUBS.filter(s=>s.status==='active').map(s=>
        '<li>'+ICO('refresh',14)+'<div class="grow"><strong>'+esc(s.name)+'</strong>'+
        '<div class="t-tiny muted">'+esc(s.seller)+' · '+esc(s.cycle)+'</div></div>'+
        '<span class="t-num">'+CUR(s.price)+'</span></li>').join('')+'</ul>',
      {icon:'refresh', sub:MY_SUBS.filter(s=>s.status==='active').length+' active subscriptions'})+
  '</div>';
}
function downloadConBillCsv(id){
  const b=MY_BILLS.filter(x=>x.id===id)[0]; if(!b) return;
  const t=conBillTotal(b);
  const rows=[['Item','Seller','Amount']]
    .concat(MY_SUBS.filter(s=>s.status==='active').map(s=>[s.name,s.seller,s.price]))
    .concat(b.oneoff?[['One-off purchases','Various',b.oneoff]]:[])
    .concat([['Tax','',t.tax],['Total','',t.total]]);
  downloadFile(id+'.csv', rows.map(r=>r.join(',')).join('\n'), 'text/csv');
  toast(id+'.csv downloaded');
}

