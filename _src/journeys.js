/* ===========================================================================
   End-to-end journey tests.
   These do not check that a screen rendered — they drive each journey to its
   conclusion and assert that the underlying records actually changed.
   Run: node _src/journeys.js
   =========================================================================== */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('/tmp/node_modules/jsdom');

const OUT = path.join(__dirname, '..');
let failures = 0, checks = 0;

function load(file){
  const vc = new VirtualConsole();
  const errs = [];
  vc.on('jsdomError', e => errs.push(e.message));
  const dom = new JSDOM(fs.readFileSync(path.join(OUT, file), 'utf8'),
    { runScripts:'dangerously', virtualConsole:vc, pretendToBeVisual:true, url:'http://localhost/' });
  /* The prototype now has a real sign-in gate, so the harness signs in the way
     a person would rather than reaching behind it. Auth itself is exercised
     properly in journeys_final.js. */
  return new Promise(res => setTimeout(() => {
    try { if(!dom.window.eval('AUTH.signedIn')) dom.window.eval('finishLogin("Test harness")'); } catch(e){}
    setTimeout(() => res({ w: dom.window, G: n => dom.window.eval(n), errs }), 200);
  }, 260));
}
const wait = ms => new Promise(r => setTimeout(r, ms));

function ok(label, cond, detail){
  checks++;
  if (cond) { console.log('   ✓ ' + label); }
  else { failures++; console.log('   ✗ ' + label + (detail ? '  — ' + detail : '')); }
}
function head(t){ console.log('\n' + t); }

/* Confirm dialogs gate every real mutation, so the tests click through them
   exactly as a person would rather than calling the handler directly. */
function confirmDialog(w, typeWord){
  const m = w.document.getElementById('modalHost');
  if (!m) return false;
  if (typeWord){
    const inp = m.querySelector('#cfmType');
    if (inp){ inp.value = typeWord; inp.dispatchEvent(new w.Event('input')); }
  }
  const go = m.querySelector('#cfmGo');
  if (!go || go.disabled) return false;
  go.click();
  return true;
}

(async () => {

/* ------------------------------------------------------------------ PARTNER */
head('PARTNER — onboarding a second marketplace, end to end');
{
  const { w, G, errs } = await load('partner.html');
  if (errs.length) { ok('loads without error', false, errs[0]); }

  const gateName = () => { const g = G('onbCurrentGate(MY_ONB_NEW.state)'); return g ? g.id : null; };
  ok('starts at the technical gate', gateName() === 'tech', 'got ' + gateName());
  ok('compliance questionnaire is locked', G("onbTaskById('OB-9103').status") === 'notstarted');
  ok('security is not yet a marketplace it can list in', G("ME_P.verticals.indexOf('security')") === -1);

  w.eval("resolveOnbTask('OB-9102')"); await wait(105);   // fix the failing webhook
  ok('webhook task closes', G("onbTaskById('OB-9102').status") === 'done');
  ok('gate does not clear while a sibling task is open', gateName() === 'tech');

  w.eval("resolveOnbTask('OB-9101')"); await wait(105);   // publish the sandbox order
  ok('technical gate clears once every task on it is done', G("MY_ONB_NEW.state.tech") === 'done');
  ok('compliance review opens', gateName() === 'assure');
  ok('questionnaire unlocks automatically', G("onbTaskById('OB-9103').status") === 'pending');

  w.eval("resolveOnbTask('OB-9103')"); await wait(105);
  ok('compliance gate clears', G("MY_ONB_NEW.state.assure") === 'done');
  ok('go-live becomes the open gate', gateName() === 'golive');

  w.eval('onbGoLive()'); await wait(80);
  ok('go-live asks for confirmation', !!w.document.getElementById('modalHost'));
  confirmDialog(w); await wait(105);
  ok('every gate is now cleared', G('onbComplete(MY_ONB_NEW.state)') === true);
  ok('partner is live in the new marketplace', G('MY_ONB_NEW.live') === true);
  ok('security is now listable', G("ME_P.verticals.indexOf('security')") > -1);

  head('PARTNER — product onboarding creates a real listing');
  const before = G('PRODUCTS.length');
  const qBefore = G('LISTING_QUEUE.length');
  w.eval("NL.step=0; nlSetVertical('security');"); await wait(105);
  ok('the new marketplace is selectable in the wizard', G('NL.v') === 'security');
  w.eval("NL.name='Sentinel Edge Sensor Guard'; NL.price='38.50'; NL.desc='Endpoint hardening for industrial sensors.';");
  w.eval("NL.decl=[true,true,true,true]; NL.step=5;"); await wait(105);

  /* A listing with no media cannot be submitted — that is the rule, so the
     test proves it before satisfying it. */
  w.eval('submitListing()'); await wait(90);
  ok('a listing with no media cannot be submitted', !w.document.getElementById('modalHost'));
  ok('and it sends you back to the media step', G('NL.step') === 1);

  w.eval("NL.media=[]; nlMediaAdd('image'); nlMediaAdd('image'); nlMediaAdd('image');"); await wait(105);
  w.eval("NL.step=5"); 
  w.eval('submitListing()'); await wait(90);
  ok('media with no alt text is still refused', !w.document.getElementById('modalHost'));

  w.eval("NL.media.forEach(function(m,i){ m.alt='View '+(i+1)+' of the sensor guard'; });");
  w.eval("NL.step=5"); await wait(90);
  w.eval('submitListing()'); await wait(90);
  confirmDialog(w); await wait(120);
  ok('a product record is created', G('PRODUCTS.length') === before + 1);
  ok('it lands in the operator review queue', G('LISTING_QUEUE.length') === qBefore + 1);
  ok('it is pending, not live', G("PRODUCTS[PRODUCTS.length-1].status") === 'pending');
  ok('it appears in the seller’s own listings', G("MY_LIST.filter(function(l){return l.name==='Sentinel Edge Sensor Guard'}).length") === 1);
  ok('the wizard resets after submission', G('NL.name') === '' && G('NL.step') === 0);
  ok('and the media goes with the listing, not into the bin',
     (G('PRODUCT_MEDIA[PRODUCTS[PRODUCTS.length-1].id]') || []).length === 3);

  head('PARTNER — advancing an order moves it down the pipeline');
  const oid = G("(MY_ORD.filter(function(o){return !o.failed && o.stage < o.stages.length-1})[0]||{}).id");
  if (oid){
    const st = G("ORDERS.find(function(o){return o.id==='"+oid+"'}).stage");
    w.eval("advanceOrder('"+oid+"')"); await wait(80);
    confirmDialog(w); await wait(105);
    ok('order advances one stage', G("ORDERS.find(function(o){return o.id==='"+oid+"'}).stage") === st + 1);
  } else { ok('an advanceable order exists', false); }
}

/* ----------------------------------------------------------------- CONSUMER */
head('CONSUMER — basket to order to subscription');
{
  const { w, G, errs } = await load('consumer.html');
  if (errs.length) ok('loads without error', false, errs[0]);

  const ordBefore = G('ORDERS.length'), subBefore = G('MY_SUBS.length');
  w.eval("addToCart('SKU-4001')");                 // a shipped handset
  w.eval("addToCart('SKU-3001')");                 // a monthly subscription
  ok('basket holds both items', G('CART.length') === 2);
  ok('basket badge updates', w.document.getElementById('cartCount').textContent === '2');

  w.eval('openCart()'); await wait(80);
  w.eval('checkout()'); await wait(80);
  ok('checkout asks for confirmation', !!w.document.getElementById('modalHost'));
  confirmDialog(w); await wait(105);

  ok('two orders are created', G('ORDERS.length') === ordBefore + 2);
  ok('a subscription starts for the recurring item', G('MY_SUBS.length') === subBefore + 1);
  ok('the new subscription is active', G("MY_SUBS[0].status") === 'active');
  ok('basket is emptied', G('CART.length') === 0);
  ok('the new order shows in My orders', G("MY_ORDERS.filter(function(o){return o.isNew}).length") >= 1);
  ok('the one-off order is on the shipped pipeline',
     G("ORDERS.filter(function(o){return o.isNew && o.sku==='SKU-4001'})[0].stages.length") === 5);

  head('CONSUMER — cancelling a subscription');
  const sid = G("MY_SUBS.filter(function(s){return s.status==='active'})[0].id");
  w.eval("cancelSub('"+sid+"')"); await wait(80);
  confirmDialog(w); await wait(105);
  ok('subscription is cancelled', G("MY_SUBS.find(function(s){return s.id==='"+sid+"'}).status") === 'cancelled');
  ok('auto-renew is off', G("MY_SUBS.find(function(s){return s.id==='"+sid+"'}).autoRenew") === false);

  head('CONSUMER — pausing a subscription');
  const pid = G("MY_SUBS.filter(function(s){return s.status==='active'})[0].id");
  w.eval("pauseSub('"+pid+"')"); await wait(80);
  confirmDialog(w); await wait(105);
  ok('subscription is paused', G("MY_SUBS.find(function(s){return s.id==='"+pid+"'}).status") === 'paused');
}

/* --------------------------------------------------------------- ENTERPRISE */
head('ENTERPRISE — requisition to approval to order');
{
  const { w, G, errs } = await load('enterprise.html');
  if (errs.length) ok('loads without error', false, errs[0]);

  const aprBefore = G('APPROVALS.length'), ordBefore = G('ORDERS.length');
  w.eval("addToCart('SKU-6002', 60)");             // security, needs IT sign-off
  w.eval('checkout()'); await wait(80);
  confirmDialog(w); await wait(105);

  ok('a requisition is raised', G('APPROVALS.length') === aprBefore + 1);
  ok('it is pending, not ordered', G('APPROVALS[0].status') === 'pending');
  ok('no order exists yet', G('ORDERS.length') === ordBefore);
  ok('policy names the security rule', /IT sign-off/.test(G('APPROVALS[0].need')));

  const rid = G('APPROVALS[0].id');
  w.eval("decideReq('"+rid+"', true)"); await wait(80);
  confirmDialog(w); await wait(105);
  ok('requisition is approved', G("APPROVALS.find(function(a){return a.id==='"+rid+"'}).status") === 'approved');
  ok('an order is created on approval', G('ORDERS.length') === ordBefore + 1);
  ok('the order is on the provisioning pipeline',
     G("ORDERS.filter(function(o){return o.isNew})[0].stages.join('|')") === 'Placed|Approved|Provisioning|Configured|Live');
  ok('seats are added to the existing subscription',
     G("ENT_SUBS.find(function(s){return s.sku==='SKU-6002'}).qty") === 680);
  ok('budget consumed reflects the purchase', G('BUYER.budgetSpent') > 118420.55);

  head('ENTERPRISE — a within-policy purchase orders straight away');
  const a2 = G('APPROVALS.length'), o2 = G('ORDERS.length');
  w.eval("addToCart('SKU-4005', 2)");              // devices, under the threshold
  w.eval('checkout()'); await wait(80);
  confirmDialog(w); await wait(105);
  ok('requisition auto-approves within policy', G('APPROVALS.length') === a2 + 1 && G('APPROVALS[0].status') === 'approved');
  ok('the order is placed immediately', G('ORDERS.length') === o2 + 1);

  head('ENTERPRISE — declining a requisition places nothing');
  const a3 = G('APPROVALS.length'), o3 = G('ORDERS.length');
  w.eval("addToCart('SKU-5006', 1)");              // $2,450 bundle, needs finance
  w.eval('checkout()'); await wait(80);
  confirmDialog(w); await wait(105);
  const rid3 = G('APPROVALS[0].id');
  w.eval("decideReq('"+rid3+"', false)"); await wait(80);
  confirmDialog(w); await wait(105);
  ok('requisition is rejected', G("APPROVALS.find(function(a){return a.id==='"+rid3+"'}).status") === 'rejected');
  ok('no order is created on a decline', G('ORDERS.length') === o3);
}

/* ----------------------------------------------------------------- OPERATOR */
head('OPERATOR — clearing gates takes a partner live');
{
  const { w, G, errs } = await load('operator.html');
  if (errs.length) ok('loads without error', false, errs[0]);

  const pid = 'PTR-1012';                          // Northwind Mobility, mid-journey
  ok('partner starts in onboarding', G("PMAP['"+pid+"'].status") === 'onboarding');

  /* The technical gate is verified rather than reviewed, so the walk-through
     has to do what an operator would: register the endpoints, then prove them
     with a sandbox order. Clearing gates alone no longer reaches go-live, and
     that is the point of the milestone. */
  let guard = 0;
  while (G("onbCurrentGate(ONB_STATE['"+pid+"'])") && guard++ < 14){
    const gate = G("(onbCurrentGate(ONB_STATE['"+pid+"'])||{}).id");
    if (gate === 'tech' && !G("techReady('"+pid+"')")){
      /* cover every required event, authenticated, then run the sandbox */
      w.eval("(function(){var need=pepRequiredFor('"+pid+"');"+
             "PARTNER_ENDPOINTS.push({id:'PEP-T1',partnerId:'"+pid+"',partner:PMAP['"+pid+"'].name,"+
             "name:'Order and fulfilment',url:'https://api.northwind.example/marketplace',method:'POST',"+
             "events:need.map(function(e){return e.id}),auth:'OAuth 2.0 client credentials',"+
             "retry:'3 attempts, exponential backoff',timeoutMs:5000,env:'Sandbox',enabled:true,"+
             "health:'healthy',lastCall:'Never',successRate:null,p95:0,registered:TODAY,"+
             "verifiedBy:'Test',note:null});})()");
      await wait(60);
      ok('registering endpoints alone does not open the gate', G("techReady('"+pid+"')") === false);
      w.eval("runSandboxOrder('"+pid+"')"); await wait(90);
      confirmDialog(w); await wait(140);
      ok('the sandbox order completes end to end', G("SANDBOX_RUNS['"+pid+"'].state") === 'passed');
      ok('and only then is the integration proved', G("techReady('"+pid+"')") === true);
    }
    w.eval("advanceGate('"+pid+"')"); await wait(60);
    if (!confirmDialog(w)) break;
    await wait(105);
  }
  ok('every gate is cleared', G("onbComplete(ONB_STATE['"+pid+"'])") === true);
  ok('partner becomes live', G("PMAP['"+pid+"'].status") === 'live');
  ok('partner joins the live directory', G("LIVE_PARTNERS.filter(function(p){return p.id==='"+pid+"'}).length") === 1);

  head('OPERATOR — catalogue governance');
  const qBefore = G('LISTING_QUEUE.length'), liveBefore = G('LIVE_PRODUCTS.length');
  const lq = G("LISTING_QUEUE.filter(function(l){return l.risk==='low'})[0].id");
  w.eval("decideListing('"+lq+"', true)"); await wait(80);
  confirmDialog(w); await wait(105);
  ok('approved listing leaves the queue', G('LISTING_QUEUE.length') === qBefore - 1);
  ok('approved listing is published live', G('LIVE_PRODUCTS.length') === liveBefore + 1);

  const bad = G("LISTING_QUEUE.filter(function(l){return l.risk==='high'})[0]");
  ok('a policy-breaching listing is still in the queue', !!bad);
  w.eval("reviewListing('"+G("LISTING_QUEUE.filter(function(l){return l.risk==='high'})[0].id")+"')"); await wait(105);
  const approveBtn = Array.from(w.document.querySelectorAll('#inspector .insp-foot button'))
    .find(b => /Approve/.test(b.textContent));
  ok('approve is disabled on a policy breach', approveBtn && approveBtn.disabled);
  w.eval('closeInspector()');

  const rq = G('LISTING_QUEUE.length');
  const rej = G("LISTING_QUEUE[LISTING_QUEUE.length-1].id");
  w.eval("decideListing('"+rej+"', false)"); await wait(80);
  confirmDialog(w); await wait(105);
  ok('rejected listing leaves the queue', G('LISTING_QUEUE.length') === rq - 1);

  head('OPERATOR — approving the settlement run');
  const pend = G('SET_PENDING.length');
  ok('the run has pending statements', pend > 0);
  w.eval('approveRun()'); await wait(80);
  confirmDialog(w, 'APPROVE'); await wait(105);
  ok('pending statements are approved', G('SET_PENDING.length') === 0);
  ok('nothing is marked paid before the cycle date',
     G("SETTLEMENTS.filter(function(s){return s.period===PERIODS[0] && s.status==='paid'}).length") === 0);

  head('OPERATOR — resolving a dispute');
  const did = G("DISPUTES.filter(function(d){return d.status!=='resolved'})[0].id");
  w.eval("resolveDispute('"+did+"')"); await wait(80);
  confirmDialog(w); await wait(105);
  ok('dispute is resolved', G("DISPUTES.find(function(d){return d.id==='"+did+"'}).status") === 'resolved');
}

/* --------------------------------------------------- SECONDARY ACTIONS */
head('CONSUMER — restarting a cancelled subscription, and rebooking a failed delivery');
{
  const { w, G } = await load('consumer.html');
  const cid = G("MY_SUBS.filter(function(s){return s.status==='cancelled'})[0].id");
  w.eval("reactivateSub('"+cid+"')"); await wait(80);
  confirmDialog(w); await wait(105);
  ok('cancelled subscription restarts', G("MY_SUBS.find(function(s){return s.id==='"+cid+"'}).status") === 'active');
  ok('auto-renew comes back on', G("MY_SUBS.find(function(s){return s.id==='"+cid+"'}).autoRenew") === true);

  const fid = G("(ORDERS.filter(function(o){return o.failed && o.buyer===SHOPPER.name})[0]||ORDERS.filter(function(o){return o.failed})[0]).id");
  const stg = G("ORDERS.find(function(o){return o.id==='"+fid+"'}).stage");
  w.eval("rebookDelivery('"+fid+"')"); await wait(80);
  confirmDialog(w); await wait(105);
  ok('failed order is no longer failed', G("ORDERS.find(function(o){return o.id==='"+fid+"'}).failed") === false);
  ok('it moves on down the pipeline', G("ORDERS.find(function(o){return o.id==='"+fid+"'}).stage") > stg);
}

head('ENTERPRISE — assigning and changing licence seats');
{
  const { w, G } = await load('enterprise.html');
  const sid = G("ENT_SUBS.filter(function(s){return s.status==='active' && s.seatsTotal>s.seatsUsed})[0].id");
  const used = G("ENT_SUBS.find(function(s){return s.id==='"+sid+"'}).seatsUsed");
  w.eval("assignSeats('"+sid+"')"); await wait(80);
  confirmDialog(w); await wait(105);
  ok('seats are assigned', G("ENT_SUBS.find(function(s){return s.id==='"+sid+"'}).seatsUsed") > used);

  const tot = G("ENT_SUBS.find(function(s){return s.id==='"+sid+"'}).seatsTotal");
  w.eval("changeSeats('"+sid+"')"); await wait(80);
  const box = w.document.getElementById('csCount');
  if (box){ box.value = String(tot + 40); }
  confirmDialog(w); await wait(105);
  ok('licence count changes', G("ENT_SUBS.find(function(s){return s.id==='"+sid+"'}).seatsTotal") === tot + 40);
  ok('monthly charge follows the licence count',
     Math.abs(G("ENT_SUBS.find(function(s){return s.id==='"+sid+"'}).monthly") -
              G("ENT_SUBS.find(function(s){return s.id==='"+sid+"'}).qty * ENT_SUBS.find(function(s){return s.id==='"+sid+"'}).price")) < 0.01);
}

head('OPERATOR — intervening on a failed order');
{
  const { w, G } = await load('operator.html');
  const fid = G('ORD_FAIL[0].id');
  w.eval("intervene('"+fid+"')"); await wait(80);
  confirmDialog(w); await wait(105);
  ok('the order is recovered', G("ORDERS.find(function(o){return o.id==='"+fid+"'}).failed") === false);
  ok('the failed count drops', G("ORD_FAIL.filter(function(o){return o.id==='"+fid+"'}).length") === 0);
}

/* ------------------------------------------------------ INTERACTION DETAILS */
head('INTERACTION — typing must not lose focus or characters');
{
  const { w, G } = await load('consumer.html');
  w.App = G('App'); w.App.go('browse'); await wait(105);
  const box = w.document.getElementById('browseQ');
  ok('the browse search box exists', !!box);
  box.focus();
  for (const ch of 'kestrel'){
    const el = w.document.getElementById('browseQ');
    el.value += ch;
    el.dispatchEvent(new w.Event('input'));
    await wait(170);          /* the search box hands focus back at 125ms */
  }
  const after = w.document.getElementById('browseQ');
  ok('every character survives', G('BROWSE.q') === 'kestrel', 'got "' + G('BROWSE.q') + '"');
  ok('focus stays in the search box', w.document.activeElement === after);
  ok('results actually filter', G('browseResults().length') < G('shopCatalogue().length'));
}

head('INTERACTION — the product wizard keeps what you typed');
{
  const { w, G } = await load('partner.html');
  w.App = G('App'); w.App.go('newlisting'); await wait(105);
  w.eval('NL.step=1'); w.App.go('newlisting'); await wait(105);
  const name = w.document.getElementById('nlName');
  name.focus(); name.value = 'Nimbus Air Quality sensor';
  name.dispatchEvent(new w.Event('input'));
  await wait(105);
  ok('the name field holds focus while typing', w.document.activeElement === w.document.getElementById('nlName'));
  ok('the model captured the name', G('NL.name') === 'Nimbus Air Quality sensor');

  w.eval('NL.step=2'); w.App.go('newlisting'); await wait(105);
  const price = w.document.getElementById('nlPrice');
  price.focus(); price.value = '71'; price.dispatchEvent(new w.Event('input'));
  await wait(105);
  ok('the price field holds focus while typing', w.document.activeElement === w.document.getElementById('nlPrice'));
  ok('the commission split updates live', /Partner/.test(w.document.getElementById('nlSplitHost').textContent));

  w.eval('NL.step=5'); w.App.go('newlisting'); await wait(105);
  ok('the review step shows what was entered', /Nimbus Air Quality sensor/.test(w.document.getElementById('main').textContent));
}

head('SAFEGUARD — an incomplete listing cannot be submitted');
{
  const { w, G } = await load('partner.html');
  w.App = G('App');
  const before = G('PRODUCTS.length');
  w.eval("NL.name=''; NL.price=''; NL.step=5;");
  w.eval('submitListing()'); await wait(105);
  ok('submission is blocked without a name and price', G('PRODUCTS.length') === before);
  ok('the wizard sends you back to the missing step', G('NL.step') === 1);
}

head('OPERATOR — inviting a partner names a recipient and creates a record');
{
  const { w, G } = await load('operator.html');
  const before = G('PARTNERS.length'), qBefore = G('ONB_TASKS.length');

  w.eval('invitePartnerDialog()'); await wait(105);
  ok('the dialog asks for a recipient', !!w.document.getElementById('ipEmail'));

  w.eval('submitInvite()'); await wait(105);
  ok('submitting empty is refused', G('PARTNERS.length') === before);
  ok('the company name error shows', w.document.getElementById('ipNameErr').hidden === false);
  ok('the email error shows', w.document.getElementById('ipEmailErr').hidden === false);
  ok('the marketplace error shows', w.document.getElementById('ipVErr').hidden === false);

  const set = (id,v)=>{ const e=w.document.getElementById(id); e.value=v; };
  set('ipName','Northlight Sensors GmbH'); set('ipContact','Katrin Vogel');
  set('ipEmail','not-an-email');
  w.eval('submitInvite()'); await wait(105);
  ok('a malformed email is refused', G('PARTNERS.length') === before);
  ok('the email error is still shown', w.document.getElementById('ipEmailErr').hidden === false);

  set('ipEmail','k.vogel@northlight.example');
  w.document.querySelector('.ipV[value="iot"]').checked = true;
  w.eval('submitInvite()'); await wait(105);

  ok('a partner record is created', G('PARTNERS.length') === before + 1);
  const np = 'PARTNERS[PARTNERS.length-1]';
  ok('it records who the invitation went to', G(np+'.email') === 'k.vogel@northlight.example');
  ok('it records the named contact', G(np+'.contact') === 'Katrin Vogel');
  ok('it starts in onboarding', G(np+'.status') === 'onboarding');
  ok('it sits at the application gate', G("ONB_STATE["+np+".id].apply") === 'now');
  /* An invited seller gets the whole task ladder, not one stray item — a queue
     showing one task for a new partner and eighteen for an old one is not one
     anybody can plan against. */
  const nid = G(np + '.id');
  ok('the full task ladder is raised for the new seller',
     G('ONB_TASKS.length') > qBefore + 1 &&
     G("onbTasksFor('" + nid + "').length") === G('ONB_TASKS.length') - qBefore);
  ok('only the application gate is open on it',
     G("onbTasksFor('" + nid + "').filter(function(t){return t.status==='pending'})" +
       ".every(function(t){return t.step==='apply'})"));
  ok('and everything past it is not started, not overdue',
     G("onbTasksFor('" + nid + "').filter(function(t){return t.step!=='apply'})" +
       ".every(function(t){return t.status==='notstarted'})"));
  ok('the first task is owned by the partner',
     G("onbTasksFor('" + nid + "','apply')[0].owner") === 'Partner');
  ok('the task names the recipient',
     /k\.vogel@northlight\.example/.test(G("onbTasksFor('" + nid + "','apply')[0].detail")));
  ok('it appears in the onboarding queue', /Northlight Sensors/.test(w.document.getElementById('main').textContent));
  ok('the queue shows the recipient on screen', /k\.vogel@northlight\.example/.test(w.document.getElementById('main').textContent));

  const id = G(np+'.id');
  w.eval("doResendInvite('"+id+"')"); await wait(80);
  ok('resend names the address it goes to', /k\.vogel@northlight\.example/.test(w.document.getElementById('modalHost').textContent));
  confirmDialog(w); await wait(105);
  ok('the invitation date is refreshed', G("PMAP['"+id+"'].invited") === G('TODAY'));

  let guard=0;
  while (G("onbCurrentGate(ONB_STATE['"+id+"'])") && guard++ < 14){
    const gate = G("(onbCurrentGate(ONB_STATE['"+id+"'])||{}).id");
    if (gate === 'tech' && !G("techReady('"+id+"')")){
      w.eval("(function(){var need=pepRequiredFor('"+id+"');"+
             "PARTNER_ENDPOINTS.push({id:'PEP-T2',partnerId:'"+id+"',partner:PMAP['"+id+"'].name,"+
             "name:'Order and fulfilment',url:'https://api.northlight.example/marketplace',method:'POST',"+
             "events:need.map(function(e){return e.id}),auth:'HMAC signature',"+
             "retry:'3 attempts, exponential backoff',timeoutMs:5000,env:'Sandbox',enabled:true,"+
             "health:'healthy',lastCall:'Never',successRate:null,p95:0,registered:TODAY,"+
             "verifiedBy:'Test',note:null});})()");
      await wait(60);
      w.eval("runSandboxOrder('"+id+"')"); await wait(90);
      confirmDialog(w); await wait(140);
    }
    w.eval("advanceGate('"+id+"')"); await wait(60);
    if (!confirmDialog(w)) break;
    await wait(105);
  }
  ok('an invited partner must also prove its integration', G("SANDBOX_RUNS['"+id+"'].state") === 'passed');
  ok('the invited partner can then be taken all the way to live', G("PMAP['"+id+"'].status") === 'live');
}

head('PARTNER — applying to add another marketplace');
{
  const { w, G } = await load('partner.html');
  w.App = G('App');
  w.eval('addMarketplaceDialog()'); await wait(105);
  ok('an open application blocks a second one',
     /One application at a time/.test(w.document.getElementById('modalHost').textContent));
  w.eval('closeModal()'); await wait(80);

  /* clear the in-flight application, then apply for a genuinely new marketplace */
  w.eval("resolveOnbTask('OB-9102')"); await wait(105);
  w.eval("resolveOnbTask('OB-9101')"); await wait(105);
  w.eval("resolveOnbTask('OB-9103')"); await wait(105);
  w.eval('onbGoLive()'); await wait(80); confirmDialog(w); await wait(105);
  ok('the first application completed', G('MY_ONB_NEW.live') === true);

  w.eval('addMarketplaceDialog()'); await wait(105);
  const radio = w.document.querySelector('input[name="amV"]');
  ok('marketplaces it is not in are offered', !!radio);
  const chosen = radio.value;
  w.eval('startMarketplaceApplication()'); await wait(105);
  ok('a new application starts', G('MY_ONB_NEW.targetV') === chosen);
  ok('KYC carries over rather than repeating', G('MY_ONB_NEW.state.kyc') === 'done');
  ok('the settlement account carries over', G('MY_ONB_NEW.state.finance') === 'done');
  ok('it opens at the agreements gate', G('onbCurrentGate(MY_ONB_NEW.state).id') === 'agree');
  ok('the addendum task is the open one', G("MY_ONB_TASKS.filter(function(t){return t.status==='pending'}).length") === 1);

  w.eval("resolveOnbTask('OB-9201')"); await wait(105);
  ok('signing the addendum opens the technical gate', G('onbCurrentGate(MY_ONB_NEW.state).id') === 'tech');
  ok('the next task unlocks automatically', G("onbTaskById('OB-9202').status") === 'pending');
}

head('SAFEGUARD — cancelling a dialog changes nothing');
{
  const { w, G } = await load('operator.html');
  const before = JSON.stringify({
    q:G('LISTING_QUEUE.length'), p:G('LIVE_PRODUCTS.length'), s:G('SET_PENDING.length'),
    d:G("DISPUTES.filter(function(d){return d.status!=='resolved'}).length")
  });
  const lq = G("LISTING_QUEUE.filter(function(l){return l.risk==='low'})[0].id");
  w.eval("decideListing('"+lq+"', true)"); await wait(80);
  w.eval('closeModal()'); await wait(105);
  w.eval('approveRun()'); await wait(80);
  w.eval('closeModal()'); await wait(105);
  const did = G("DISPUTES.filter(function(d){return d.status!=='resolved'})[0].id");
  w.eval("resolveDispute('"+did+"')"); await wait(80);
  w.eval('closeModal()'); await wait(105);
  const after = JSON.stringify({
    q:G('LISTING_QUEUE.length'), p:G('LIVE_PRODUCTS.length'), s:G('SET_PENDING.length'),
    d:G("DISPUTES.filter(function(d){return d.status!=='resolved'}).length")
  });
  ok('dismissing three dialogs mutates nothing', before === after, before + ' vs ' + after);
}

head('SAFEGUARD — a high-risk action needs the confirmation word typed');
{
  const { w, G } = await load('operator.html');
  const pend = G('SET_PENDING.length');
  w.eval('approveRun()'); await wait(105);
  const go = w.document.querySelector('#cfmGo');
  ok('confirm starts disabled', go && go.disabled);
  go.click(); await wait(105);
  ok('clicking it while disabled does nothing', G('SET_PENDING.length') === pend);
  confirmDialog(w, 'APPROVE'); await wait(105);
  ok('typing the word enables it', G('SET_PENDING.length') === 0);
}

/* ------------------------------------------------- ROLES AND NOTIFICATIONS */
console.log('\n' + (failures ? '✗ ' + failures + ' of ' + checks + ' checks failed'
                             : '✓ all ' + checks + ' journey checks passed'));
process.exit(failures ? 1 : 0);

})();
