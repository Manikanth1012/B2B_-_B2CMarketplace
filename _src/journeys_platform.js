/* ===========================================================================
   Platform and commercial depth: developer portal, revenue projection, dunning,
   WMS, audit sealing, listing versions, contract pricing and comparison.
   Eighth file, to stay inside the shell's 45-second budget.
   These do not check that a screen rendered — they drive each journey to its
   conclusion and assert that the underlying records actually changed.
   Run: node _src/journeys_platform.js
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

/* ------------------------------------------------------- DEVELOPER PORTAL */
head('DEVELOPER PORTAL — the marketplace publishes its own APIs');
{
  const { w, G } = await load('operator.html');
  w.App = G('App'); w.App.go('devportal'); await wait(240);
  const t = w.document.getElementById('main').textContent;

  ok('the developer portal exists', /Developer portal/.test(t));
  ok('APIs are published with a standard against each',
     G("API_PRODUCTS.every(function(a){return !!a.spec})"));
  ok('beta and preview are labelled rather than hidden',
     G("API_PRODUCTS.some(function(a){return a.status!=='ga'})") && /Beta|Preview/i.test(t));
  ok('integrations are listed with their access tier',
     G('DataTable.reg["dtApiCon"].rows.length') === G('API_CONSUMERS.length'));
  ok('it is framed as integration access, not a product line',
     /integration access, not a product line/.test(t));
  ok('and states that nothing here is sold or metered against revenue',
     /Nothing here is sold or metered against revenue/.test(t));
  ok('rate limits are explained as protection', /stop one runaway integration degrading/.test(t));
  ok('the portal carries no price anywhere', !/\$\d|per month|MRR|overage/i.test(t));

  w.eval('apiTiersDialog()'); await wait(180);
  const pm = w.document.getElementById('modalHost');
  ok('tiers are entitlements rather than price bands', /Entitlements, not price bands/.test(pm.textContent));
  ok('each tier states its rate limit and quota', /Rate limit/.test(pm.textContent));
  ok('exceeding a limit slows a partner rather than cutting them off',
     /does not cut them off/.test(pm.textContent));
  ok('and a seller pays nothing for its own data', /pays nothing for access to its own/.test(pm.textContent));
  ok('no tier carries a price', G("API_TIERS.every(function(t){return t.price===undefined})"));
  w.eval('closeModal()'); await wait(90);

  w.eval('apiEnvDialog()'); await wait(180);
  const em = w.document.getElementById('modalHost');
  ok('both environments are documented', /Sandbox/.test(em.textContent) && /Production/.test(em.textContent));
  ok('sandbox is declared as reset weekly with no commitment',
     /no availability commitment/.test(em.textContent) && /reset/i.test(em.textContent));
  ok('production is earned by completing a sandbox order end to end',
     /Production is earned/.test(em.textContent));
  w.eval('closeModal()'); await wait(90);

  w.eval('apiDocsDialog()'); await wait(180);
  ok('the reference shows a real request and response',
     /productOffering/.test(w.document.getElementById('modalHost').textContent));
  w.eval("document.getElementById('adApi').value='AP-ORD'; apiDocsShow()"); await wait(140);
  ok('switching API changes the reference',
     /productOrder/.test(w.document.getElementById('modalHost').textContent));
  ok('idempotency is documented on a write API',
     /Idempotency/.test(w.document.getElementById('modalHost').textContent));
  w.eval('closeModal()'); await wait(90);
}

/* ---------------------------------------------------- REVENUE PROJECTION */
head('PROJECTION — a forecast that carries its method and its error');
{
  const { w, G } = await load('operator.html');
  w.App = G('App'); await wait(210);

  const f = G('forecastFrom(HISTORY)');
  ok('it projects six months', f.points.length === 6);
  ok('every point has a band around it',
     f.points.every(function(p){ return p.low < p.point && p.point < p.high; }));
  ok('the totals bracket the central case', f.low < f.total && f.total < f.high);
  ok('seasonality is applied, not flat',
     new Set(f.points.map(function(p){ return p.seasonal; })).size > 1);
  ok('it compares against the equivalent trailing window', typeof f.growth === 'number');

  const acc = G('forecastAccuracy(HISTORY)');
  ok('accuracy is measured by backtest, not asserted',
     !!acc && typeof acc.errPct === 'number' && acc.actual > 0);
  ok('and it is a real error, not zero', Math.abs(acc.errPct) > 0);

  const t = w.document.getElementById('main').textContent;
  ok('the operator sees a revenue projection', /Revenue projection/.test(t));
  ok('the method is stated on the panel', /Method\./.test(t));
  ok('last quarter\'s error is stated', /How wrong this method was/.test(t));
  ok('and the assumptions are listed', /partner mix stays as it is/.test(t));
  ok('it warns against pasting the number into a board pack', /board pack/.test(t));
}
head('PROJECTION — each persona is shown its own');
{
  const { w: wp, G: Gp } = await load('partner.html');
  wp.App = Gp('App'); wp.App.go('home'); await wait(240);
  ok('the seller sees a settlement projection',
     /Settlement projection/.test(wp.document.getElementById('main').textContent));
  ok('built from its own series, not the marketplace total',
     Gp("MY_HIST().reduce(function(a,h){return a+h.gross},0)") <
     Gp("HISTORY.reduce(function(a,h){return a+h.gross},0)"));
  ok('and it says the projection is not a payment schedule',
     /not a payment schedule/.test(wp.document.getElementById('main').textContent));

  const { w: we, G: Ge } = await load('enterprise.html');
  we.App = Ge('App'); we.App.go('home'); await wait(240);
  ok('the buyer sees a spend projection, not a revenue one',
     /Spend projection/.test(we.document.getElementById('main').textContent));
  ok('and it names what is excluded',
     /does not include anything sitting in approvals/.test(we.document.getElementById('main').textContent));
  ok('with the annual budget stated against it',
     /Budget is/.test(we.document.getElementById('main').textContent));

  const { w: wc, G: Gc } = await load('consumer.html');
  wc.App = Gc('App'); wc.App.go('subs'); await wait(240);
  ok('the consumer sees what their commitments will cost',
     /What this will cost you/.test(wc.document.getElementById('main').textContent));
  ok('and is told plainly it is not a bill',
     /This is not a bill/.test(wc.document.getElementById('main').textContent));
}

/* ------------------------------------------------------------- DUNNING */
head('DUNNING — a collections ladder that does not cut people off on day three');
{
  const { w, G } = await load('operator.html');
  w.App = G('App'); w.App.go('collections'); await wait(240);
  const t = w.document.getElementById('main').textContent;

  ok('the collections screen exists', /Collections/.test(t));
  ok('every case is listed', G('DataTable.reg["dtDun"].rows.length') === G('DUNNING_CASES.length'));
  ok('the ladder has seven steps', G('DUNNING_LADDER.length') === 7);
  ok('service is untouched until day 14',
     G("DUNNING_LADDER.filter(function(s){return /Suspend/.test(s.action)})[0].at") === 'Day 14');

  w.eval('dunningLadderDialog()'); await wait(180);
  const lm = w.document.getElementById('modalHost');
  ok('the ladder is documented and names itself',
     /Consumer standard/.test(lm.textContent) && /Day 0/.test(lm.textContent));
  ok('and lets you switch to another customer type\u2019s ladder', !!w.document.getElementById('dlPick'));
  ok('and explains why service is not cut early', /costs more in churn/.test(lm.textContent));
  ok('a promise resumes rather than restarts the ladder', /from where it stopped/.test(lm.textContent));
  w.eval('closeModal()'); await wait(90);

  /* an expired card cannot be recovered by retrying, and the system says so */
  const exp = G("DUNNING_CASES.filter(function(d){return /expired/i.test(d.reason)})[0].id");
  const att = G("DUNNING_CASES.find(function(d){return d.id==='" + exp + "'}).attempts");
  w.eval("retryDunning('" + exp + "')"); await wait(200);
  ok('retrying an expired card does not pretend to succeed',
     G("DUNNING_CASES.find(function(d){return d.id==='" + exp + "'}).state") !== 'recovered');
  ok('but the attempt is still recorded',
     G("DUNNING_CASES.find(function(d){return d.id==='" + exp + "'}).attempts") === att + 1);
  ok('and it is audited',
     G("AUDIT_LOG.operator.some(function(e){return /payment retry/i.test(e.detail||'')})"));

  /* a promise pauses the ladder at the current step */
  const run = G("DUNNING_CASES.filter(function(d){return !d.promiseToPay && d.state!=='recovered'})[0]");
  if (run){
    const step = run.step;
    w.eval("promiseToPay('" + run.id + "')"); await wait(180);
    confirmDialog(w); await wait(210);
    const after = G("DUNNING_CASES.find(function(d){return d.id==='" + run.id + "'})");
    ok('a promise to pay is recorded', !!after.promiseToPay);
    ok('and the ladder holds its position rather than resetting', after.step === step);
  }
}
{
  const { w, G } = await load('consumer.html');
  w.App = G('App'); w.App.go('account'); await wait(240);
  ok('a consumer with a failed payment is told on their own account',
     /payment of/.test(w.document.getElementById('main').textContent) || G('myDunning().length') === 0);
  if (G('myDunning().length')){
    ok('and told what has and has not been interrupted',
     /Nothing has been interrupted|cannot make new purchases|service is suspended/i
       .test(w.document.getElementById('main').textContent));
  }
}

/* --------------------------------------------------------- WMS AND SEALING */
head('WMS — the ledger is ours, the warehouse is not');
{
  const { w, G } = await load('operator.html');
  w.App = G('App'); w.App.go('inventory'); await wait(250);
  const t = w.document.getElementById('main').textContent;

  ok('warehouse systems are shown', /Warehouse systems/.test(t));
  ok('every warehouse has a link record', G('WMS_LINKS.length') === G('WAREHOUSES.length'));
  ok('drift against the ledger is surfaced', /disagrees with our ledger/.test(t));
  ok('and the physical count is stated to win', /physical count wins/.test(t));
  ok('drop-ship is declared as delegated, not measured',
     G("WMS_LINKS.some(function(l){return l.status==='delegated'})") && /Delegated/.test(t));
  ok('shipments carry a carrier and tracking', /Carrier and tracking/.test(t));
  ok('and a carrier exception is visible', /Exception/.test(t));
}
head('AUDIT — tamper-evidence and export beyond our own control');
{
  const { w, G } = await load('operator.html');
  w.App = G('App'); w.App.go('audit'); await wait(250);
  const t = w.document.getElementById('main').textContent;

  ok('the hash chain is described', /Hash chain/.test(t));
  ok('with a daily anchor to object-locked storage', /object lock/i.test(t));
  ok('it explains why a chain beats a permission', /detectable/.test(t));
  ok('SIEM destinations are listed', G('SIEM_TARGETS.length') > 0 && /Splunk/.test(t));
  ok('a lagging destination is flagged rather than hidden',
     G("SIEM_TARGETS.some(function(x){return x.status!=='healthy'})") && /behind by/.test(t));
  ok('and it says why an external copy matters', /outside the control/.test(t));

  w.eval('verifyAuditChain()'); await wait(180);
  ok('verification asks first', !!w.document.getElementById('modalHost'));
  confirmDialog(w); await wait(220);
  ok('the chain verifies', G('AUDIT_SEAL.verified') === true && G('AUDIT_SEAL.gaps') === 0);
  ok('and the verification is itself logged',
     G("AUDIT_LOG.operator.some(function(e){return /Audit chain/.test(e.object||'')})"));
}

/* -------------------------------------- VERSIONS, CONTRACTS, COMPARISON */
head('CATALOGUE — versions, contract prices and comparison');
{
  const { w, G } = await load('partner.html');
  w.App = G('App'); w.App.go('listings'); await wait(230);

  const sku = G("Object.keys(LISTING_VERSIONS).filter(function(k){return SKUMAP[k]&&SKUMAP[k].partner===ME_P.id})[0]");
  ok('listings carry a version history', !!sku && G("versionsFor('" + sku + "').length") > 1);
  ok('exactly one version is live',
     G("versionsFor('" + sku + "').filter(function(v){return v.active}).length") === 1);

  const before = G("versionsFor('" + sku + "').length");
  const price = G("SKUMAP['" + sku + "'].price");
  w.eval("versionDialog('" + sku + "')"); await wait(190);
  ok('the history opens', !!w.document.getElementById('modalHost'));
  ok('and shows what changed between the last two',
     /What changed between/.test(w.document.getElementById('modalHost').textContent));

  w.eval("rollbackVersion('" + sku + "',1)"); await wait(190);
  confirmDialog(w); await wait(230);
  ok('a rollback creates a new version rather than deleting any',
     G("versionsFor('" + sku + "').length") === before + 1);
  ok('the earliest version is still there', G("versionsFor('" + sku + "')[0].v") === 1);
  ok('and the live price changed', G("SKUMAP['" + sku + "'].price") !== price);
  ok('the rollback is audited',
     G("AUDIT_LOG.partner.some(function(e){return /Rolled back/.test(e.detail||'')})"));
}
{
  const { w, G } = await load('enterprise.html');
  w.App = G('App'); w.App.go('contracts'); await wait(240);
  const t = w.document.getElementById('main').textContent;

  ok('the buyer sees its contract prices', /Contract pricing/.test(t));
  ok('scoped to its own account',
     G("DataTable.reg['dtContract'].rows.every(function(c){return c.account===BUYER.company})"));
  ok('a minimum quantity is stated against each', /Minimum/.test(t));
  ok('and an unsigned price is recorded without being applied',
     /not signed is recorded without a/.test(t));
  ok('a contract price beats list for that account only',
     G("contractPriceFor('SKU-6001','Brightline Foods')") !== null &&
     G("contractPriceFor('SKU-6001','Someone Else')") === null);
  ok('and an unpriced record does not resolve to a discount',
     G("contractPriceFor('SKU-5001','Harbourpoint Retail')") === null);
}
{
  const { w, G } = await load('consumer.html');
  w.App = G('App');
  w.eval("BROWSE.v='device'"); w.App.go('browse'); await wait(240);
  const skus = G("browseResults().slice(0,4).map(function(p){return p.id})");

  ok('product cards carry a compare toggle', !!w.document.querySelector('.comparebtn'));
  w.eval("COMPARE=[]; compareToggle('" + skus[0] + "'); compareToggle('" + skus[1] + "')"); await wait(190);
  ok('picks appear in a tray', !!w.document.querySelector('.comparetray') && G('COMPARE.length') === 2);
  w.eval("compareToggle('" + skus[2] + "'); compareToggle('" + skus[3] + "')"); await wait(180);
  ok('comparison is capped at three', G('COMPARE.length') === 3);

  w.eval('compareDialog()'); await wait(200);
  const m = w.document.getElementById('modalHost');
  ok('the comparison opens', !!m);
  ok('with a column per item', m.querySelectorAll('thead th').length === 4);
  ok('it compares price, rating and availability',
     /Price/.test(m.textContent) && /Rating/.test(m.textContent) && /Availability/.test(m.textContent));
  ok('each column can be added to the basket', m.querySelectorAll('tfoot button').length === 3);
  ok('and the highlighted cell is not sold as a recommendation',
     /not a recommendation/.test(m.textContent));
}

head('DATA — the operational surface has enough in it to look real');
{
  const { w, G } = await load('operator.html');
  w.App = G('App'); await wait(200);
  const min={TICKETS:25,REVIEWS:35,DISPUTES:12,LISTING_QUEUE:12,SHIPMENTS:12,
             CONTRACT_PRICES:12,DUNNING_CASES:10,API_CONSUMERS:10,BANNERS:14,
             DELIVERIES:50,ICCIDS:50,BULK_JOBS:12,STOCK_MOVES:40,EXPORTS:5};
  Object.keys(min).forEach(k=>{
    ok(k.toLowerCase()+' has depth', G(k+'.length')>=min[k], G(k+'.length')+' of '+min[k]);
  });
  ok('the audit log is deep enough to page', G('AUDIT_LOG.operator.length')>40);

  /* and the reconciliation the whole dataset rests on is untouched */
  ok('GMV still reconciles to the order register',
     G('+ORDERS.reduce(function(a,o){return a+o.gross},0).toFixed(2)') === 711108.93);
  ok('and still equals the sum of the categories',
     Math.abs(G('VERTICALS.reduce(function(a,v){return a+ORDERS.filter(function(o){return o.v===v.id})'+
       '.reduce(function(b,o){return b+o.gross},0)},0)') - 711108.93) < 0.01);

  /* an audit entry that could not happen in that console is a data defect */
  ['partner','buyer','consumer'].forEach(ctx=>{
    ok(ctx+' audit entries stay inside categories that context can produce',
       G("(function(){var sc=AUDIT_SCOPE['"+ctx+"']||{},ok={};"+
         "Object.keys(sc).forEach(function(r){(sc[r].cats||[]).forEach(function(c){ok[c]=1;});});"+
         "return (AUDIT_LOG['"+ctx+"']||[]).every(function(e){return ok[e.cat];});})()"));
  });
}

/* -------------------------------------------- PARTNER API REGISTRY ------ */
head('PARTNER APIs — the inbound side, and who hears about what');
{
  const { w, G } = await load('operator.html');
  w.App = G('App'); w.App.go('partnerapis'); await wait(260);
  const t = w.document.getElementById('main').textContent;

  ok('the registry exists', /Partner APIs/.test(t));
  ok('it states the direction of the integration', /never polls/.test(t));
  ok('endpoints are recorded across the estate',
     G('DataTable.reg["dtPep"].rows.length') === G('PARTNER_ENDPOINTS.length'));
  ok('every endpoint belongs to a real partner',
     G("PARTNER_ENDPOINTS.every(function(e){return !!PMAP[e.partnerId]})"));
  ok('the coverage matrix answers who hears about what', /Who hears about what/.test(t));
  ok('a required event with no endpoint is counted rather than discovered later',
     /required event/i.test(t) && G('typeof pepAllGaps==="function"'));
  ok('the callback log is the evidence when a seller says they were never told',
     G('DataTable.reg["dtCb"].rows.length') > 0 && /never told/.test(t));

  w.eval('pepEventsDialog()'); await wait(200);
  const em = w.document.getElementById('modalHost');
  ok('the order lifecycle is covered', /Order placed/.test(em.textContent));
  ok('the subscription lifecycle is covered',
     /Subscription renewed/.test(em.textContent) && /Subscription suspended/.test(em.textContent));
  ok('required is relative to how a seller fulfils', /Required is relative/.test(em.textContent));
  w.eval('closeModal()'); await wait(110);

  w.eval('pepPolicyDialog()'); await wait(200);
  const pm = w.document.getElementById('modalHost');
  ok('the retry and suspension policy is documented', /Marked unhealthy after/.test(pm.textContent));
  ok('an unhandled required event is stated not to be queued', /not queued and not retried/.test(pm.textContent));
  ok('suspension stops the calling, not the selling', /stops the calling, not the selling/.test(pm.textContent));
  w.eval('closeModal()'); await wait(110);

  const bad = G("PARTNER_ENDPOINTS.filter(function(x){return x.health==='failing'})[0]");
  const n0 = G('CALLBACK_LOG.length');
  w.eval("pepTest('" + bad.id + "')"); await wait(200); confirmDialog(w); await wait(240);
  ok('a test call against a failing endpoint is recorded', G('CALLBACK_LOG.length') === n0 + 1);
  ok('and fails honestly rather than reporting success', G("CALLBACK_LOG[0].status") !== 'acknowledged');
  ok('the test is audited', G("AUDIT_LOG.operator.some(function(e){return e.action==='api.test'})"));
}
head('DEVELOPER PORTAL — access, not a product line');
{
  const { w, G } = await load('partner.html');
  w.App = G('App'); w.App.go('integrations'); await wait(250);
  const t = w.document.getElementById('main').textContent;
  ok('the seller sees its own API access', /Your API access/.test(t));
  ok('with the environment it actually holds', /Sandbox|Production/.test(t));
  ok('and is told its own data carries no charge', /it is your own data/.test(t));
  ok('the seller sees no price anywhere', !/\$\d|per month|overage/i.test(t));
}

/* ------------------------------------------- INTEGRATION MILESTONE ------ */
head('ONBOARDING — the integration is a tested milestone, not a promise');
{
  const { w, G } = await load('operator.html');
  w.App = G('App'); await wait(210);

  ok('the milestone has four verifiable checks', G('TECH_CHECKS.length') === 4);
  const pid = G("Object.keys(ONB_STATE)[0]");
  w.eval("var _s=ONB_STATE['" + pid + "']; _s.apply='done'; _s.kyc='done'; _s.agree='done';"+
         "_s.finance='done'; _s.tech='now';"); await wait(90);
  ok('this partner has not proved its integration', G("techReady('" + pid + "')") === false);

  w.App.go('onboardq'); await wait(250);
  ok('the milestone is shown where the decision is made',
     /Integration not proved|Integration proved/.test(w.document.getElementById('main').textContent));

  w.eval("advanceGate('" + pid + "')"); await wait(240);
  const gm = w.document.getElementById('modalHost');
  ok('the technical gate refuses to clear on review alone', /cannot be cleared by review/.test(gm.textContent));
  ok('and states that no override exists', /No override exists/.test(gm.textContent));
  ok('the gate did not advance', G("ONB_STATE['" + pid + "'].tech") === 'now');
  w.eval('closeModal()'); await wait(120);

  /* register, and it is still not enough */
  w.eval("registerPartnerEndpoint('" + pid + "')"); await wait(220);
  w.eval("document.getElementById('peName').value='Order and fulfilment'");
  w.eval("document.getElementById('peUrl').value='http://insecure.example/orders'");
  w.eval("savePartnerEndpoint('" + pid + "')"); await wait(180);
  ok('a plaintext endpoint is refused because payloads carry buyer data',
     !!w.document.getElementById('peUrl'));
  w.eval("document.getElementById('peUrl').value='https://api.seller.example/orders'");
  w.eval("savePartnerEndpoint('" + pid + "')"); await wait(250);
  ok('an https endpoint registers', G("pepFor('" + pid + "').length") > 0);
  ok('registration alone does not satisfy the milestone', G("techReady('" + pid + "')") === false);
  ok('because nothing has acknowledged a test call yet',
     G("techStatus('" + pid + "').checks.tested") === false);

  w.eval("runSandboxOrder('" + pid + "')"); await wait(210); confirmDialog(w); await wait(280);
  ok('the sandbox run is recorded and cannot be edited', !!G("SANDBOX_RUNS['" + pid + "']"));
  ok('its result decides the gate, not an opinion',
     G("SANDBOX_RUNS['" + pid + "'].state==='passed'") === G("techStatus('" + pid + "').checks.sandbox"));
  ok('and a run that failed leaves the gate shut',
     G("SANDBOX_RUNS['" + pid + "'].state") === 'passed' || G("techReady('" + pid + "')") === false);
}
head('ONBOARDING — the desk can do it, but cannot skip anything');
{
  const { w, G } = await load('operator.html');
  w.App = G('App'); w.App.go('onboardq'); await wait(240);
  ok('the desk can onboard a partner itself',
     /Onboard one yourself/.test(w.document.getElementById('main').textContent));

  w.eval('operatorOnboardDialog()'); await wait(230);
  const om = w.document.getElementById('modalHost');
  ok('the capture is stepped, mirroring the gates it feeds', G('OO_STEPS.length') >= 4);
  ok('it starts with the company', !!w.document.getElementById('ooName'));
  ok('and says plainly that it clears nothing', /clears nothing/.test(om.textContent));

  const n0 = G('PARTNERS.length');
  w.eval("document.getElementById('ooName').value='Vantage Mobility Ltd'");
  w.eval("document.getElementById('ooCountry').value='India'");
  w.eval('ooGo(1)'); await wait(200);
  ok('the second step asks who we deal with and what they sell',
     !!w.document.getElementById('ooContact') && !!w.document.getElementById('ooEmail') &&
     !!w.document.getElementById('ooEp'));
  w.eval("document.getElementById('ooContact').value='Rhea Kulkarni'");
  w.eval("document.getElementById('ooEmail').value='r.kulkarni@6dtech.co.in'");
  w.eval("document.querySelectorAll('.ooV')[0].checked=true");
  w.eval('ooGo(2)'); await wait(200);
  ok('the settlement step asks for a real account, not a free-text bank name',
     !!w.document.getElementById('ooAcct') && !!w.document.getElementById('ooLocal') &&
     !!w.document.getElementById('ooSwift') && !!w.document.getElementById('ooTaxId'));

  w.eval('saveOperatorOnboard()'); await wait(200);
  ok('a reason is required before the desk may create one', G('PARTNERS.length') === n0);

  w.eval('ooGo(4)'); await wait(200);
  w.eval("document.getElementById('ooWhy').value='Negotiated at the enterprise desk; contract signed 22 Jul'");
  w.eval('saveOperatorOnboard()'); await wait(300);
  ok('the partner is created', G('PARTNERS.length') === n0 + 1);
  const np = G('PARTNERS[PARTNERS.length-1].id');
  ok('the application gate is captured as done', G("ONB_STATE['" + np + "'].apply") === 'done');
  ok('KYC opens rather than being skipped', G("ONB_STATE['" + np + "'].kyc") === 'now');
  ok('nothing beyond the application is cleared',
     G("['agree','finance','tech','assure','golive'].every(function(k){return ONB_STATE['" + np + "'][k]==='todo'})"));
  ok('the submission is readable a year later', !!G("ONB_SUBMISSIONS['" + np + "'].apply"));
  ok('it records who captured it on whose behalf',
     /on behalf of/.test(G("ONB_SUBMISSIONS['" + np + "'].apply.submittedBy")));
  ok('and why the desk did it rather than the seller',
     G("ONB_SUBMISSIONS['" + np + "'].apply.fields.some(function(f){return /because/i.test(f[0])})"));
  ok('the new partner still has to prove its integration', G("techReady('" + np + "')") === false);
  ok('and the creation is audited',
     G("AUDIT_LOG.operator.some(function(e){return /on the seller/.test(e.detail||'')})"));
}

head('EVENTS — the catalogue is configuration, not a property of the platform');
{
  const { w, G } = await load('operator.html');
  w.App = G('App'); w.App.go('partnerapis'); await wait(270);
  const t = w.document.getElementById('main').textContent;

  ok('the event catalogue is editable from Partner APIs', /Marketplace events/.test(t) && /New event/.test(t));
  ok('every event carries a lifecycle state', G("API_EVENTS.every(function(e){return !!e.status})"));
  ok('and a payload contract', G("API_EVENTS.every(function(e){return (e.payload||[]).length>0})"));
  ok('it states what making one mandatory costs', /out of compliance the moment it is saved/.test(t));

  /* gap detection has to actually find partners — a filter on the wrong
     status silently returns nothing and every count reads zero */
  ok('gap detection resolves against live partners', G('pepAllGaps().length') > 0);

  w.eval("eventDialog('subscription.renewed')"); await wait(240);
  ok('an event opens for configuration', !!w.document.getElementById('evLabel'));
  ok('a published id cannot be edited', !!w.document.querySelector('#evId[disabled]'));
  ok('it lists who subscribes today', /Who subscribes today/.test(w.document.getElementById('modalHost').textContent));

  w.eval("document.getElementById('evReq').checked=false; evPreviewImpact()"); await wait(120);
  ok('optional means nobody is out of compliance',
     /nothing is out of compliance/.test(w.document.getElementById('evImpact').textContent));
  w.eval("document.getElementById('evReq').checked=true;"+
         "document.querySelectorAll('.evM').forEach(function(c){c.checked=false}); evPreviewImpact()"); await wait(120);
  ok('mandatory with no fulfilment model is mandatory for nobody',
     /mandatory for nobody/.test(w.document.getElementById('evImpact').textContent));
  w.eval('closeModal()'); await wait(110);

  const n0 = G('API_EVENTS.length');
  w.eval('eventDialog(null)'); await wait(230);
  w.eval("document.getElementById('evId').value='NotAnId'");
  w.eval("document.getElementById('evLabel').value='x'");
  w.eval("document.getElementById('evNote').value='y'");
  w.eval('saveEvent(null)'); await wait(170);
  ok('a malformed event id is refused', G('API_EVENTS.length') === n0);

  w.eval("document.getElementById('evId').value='subscription.upgraded'");
  w.eval("document.getElementById('evLabel').value='Subscription upgraded'");
  w.eval("document.getElementById('evNote').value='The buyer moved to a larger plan. Apply the new entitlement from the effective date.'");
  w.eval("document.querySelectorAll('.evM')[5].checked=true");
  w.eval("document.getElementById('evReq').checked=true; evPreviewImpact()"); await wait(130);
  ok('a new mandatory event states its blast radius before saving',
     /out of compliance/.test(w.document.getElementById('evImpact').textContent));
  w.eval('saveEvent(null)'); await wait(250);
  ok('the event is created', G('API_EVENTS.length') === n0 + 1);
  ok('as a draft, published to nobody', G("EVMAP['subscription.upgraded'].status") === 'draft');
  ok('and a draft creates no compliance gap yet',
     G("pepAllGaps().every(function(g){return g.gaps.every(function(x){return x.id!=='subscription.upgraded'})})"));

  w.eval("eventDialog('subscription.upgraded')"); await wait(210);
  w.eval("activateEvent('subscription.upgraded')"); await wait(210);
  ok('publishing names the sellers it makes non-compliant',
     /non-compliant|immediately/.test(w.document.getElementById('modalHost').textContent));
  confirmDialog(w); await wait(250);
  ok('it is published', G("EVMAP['subscription.upgraded'].status") === 'active');
  ok('and the change is audited', G("AUDIT_LOG.operator.some(function(e){return e.action==='api.event'})"));

  const subs = G("evSubscribers('order.returned').length");
  w.eval("eventDialog('order.returned')"); await wait(210);
  w.eval("deprecateEvent('order.returned')"); await wait(210);
  ok('deprecating explains it is not a deletion',
     /Deprecated, not deleted/.test(w.document.getElementById('modalHost').textContent));
  confirmDialog(w); await wait(250);
  ok('the event survives as a record', !!G("EVMAP['order.returned']"));
  ok('marked deprecated rather than removed', G("EVMAP['order.returned'].status") === 'deprecated');
  ok('it stops being mandatory, so nobody is non-compliant for it',
     G("EVMAP['order.returned'].required") === false);
  ok('but existing subscribers keep receiving it', G("evSubscribers('order.returned').length") === subs);
}

head('APIs — publishing, versioning, and who is on which version');
{
  const { w, G } = await load('operator.html');
  w.App = G('App'); w.App.go('devportal'); await wait(280);
  const t = w.document.getElementById('main').textContent;

  ok('an API can be published from here', /Publish an API/.test(t));
  ok('versions are shown per API', /Versions and who is on them/.test(t));
  ok('and a subscription matrix says who calls what', /Who calls what/.test(t));
  ok('every API carries a version history', G("API_PRODUCTS.every(function(a){return apiVersions(a.id).length>0})"));
  ok('every version carries a changelog',
     G("API_PRODUCTS.every(function(a){return apiVersions(a.id).every(function(v){return (v.changes||[]).length>0})})"));
  ok('subscriptions record consumer, version and environment',
     G("API_SUBSCRIPTIONS.length>0 && API_SUBSCRIPTIONS.every(function(s){return s.consumer&&s.version&&s.env})"));
  ok('a consumer left on a withdrawn version is surfaced',
     /past its prime|current or supported/.test(t));

  const n0 = G('API_PRODUCTS.length');
  w.eval('apiDialog(null)'); await wait(230);
  ok('the authoring dialog opens', !!w.document.getElementById('apName'));
  ok('it asks why the API exists', !!w.document.getElementById('apWhy'));
  w.eval("document.getElementById('apId').value='nope'");
  w.eval("document.getElementById('apName').value='Usage'");
  w.eval("document.getElementById('apBlurb').value='Read metered usage against a subscription.'");
  w.eval("document.getElementById('apScopes').value='usage:read'");
  w.eval('saveApi(null)'); await wait(180);
  ok('a malformed identifier is refused', G('API_PRODUCTS.length') === n0);
  w.eval("document.getElementById('apId').value='AP-USG'");
  w.eval('saveApi(null)'); await wait(260);
  ok('a well-formed one publishes', G('API_PRODUCTS.length') === n0 + 1);
  ok('starting at v1 with a changelog',
     G("apiCurrent('AP-USG')") === 'v1' && G("apiVersions('AP-USG')[0].changes.length") > 0);

  w.eval("apiVersionsDialog('AP-CAT')"); await wait(230);
  ok('the version history states that a breaking change is a new version',
     /never an edit/.test(w.document.getElementById('modalHost').textContent));
  w.eval("newApiVersionDialog('AP-CAT')"); await wait(230);
  ok('the next version number is proposed', G("document.getElementById('avNum').value") === 'v3');
  w.eval("document.getElementById('avBreak').checked=true; avPreview()"); await wait(120);
  ok('a breaking change warns that consumers migrate deliberately',
     /migrate deliberately/.test(w.document.getElementById('avNote').textContent));
  w.eval("document.getElementById('avPrev').value='deprecated'; avPreview()"); await wait(120);
  ok('and deprecating the previous version still warns the clock has started',
     /starts the clock/.test(w.document.getElementById('avNote').textContent));

  w.eval("saveApiVersion('AP-CAT')"); await wait(180);
  ok('a version with no changelog is refused', G("apiVersions('AP-CAT').length") === 2);
  w.eval("document.getElementById('avChanges').value='BREAKING: availability moved to its own resource.'");
  w.eval("saveApiVersion('AP-CAT')"); await wait(180);
  ok('deprecating without a sunset date is refused', G("apiVersions('AP-CAT').length") === 2);
  w.eval("document.getElementById('avSunset').value='31 Dec 2027'");
  w.eval("saveApiVersion('AP-CAT')"); await wait(270);
  ok('the version is added', G("apiVersions('AP-CAT').length") === 3);
  ok('and becomes current', G("apiCurrent('AP-CAT')") === 'v3');
  ok('the previous one is deprecated and carries the date',
     G("apiVersions('AP-CAT')[1].status") === 'deprecated' && !!G("apiVersions('AP-CAT')[1].sunset"));
  ok('nothing was deleted', G("apiVersions('AP-CAT')[0].version") === 'v1');
  ok('and the version change is audited',
     G("AUDIT_LOG.operator.some(function(e){return e.action==='api.product'})"));

  w.eval("apiVersionsDialog('AP-SET')"); await wait(210);
  w.eval("deprecateApiVersion('AP-SET','v1')"); await wait(220);
  ok('deprecating a version names who is on it',
     /call this version|costs nothing/.test(w.document.getElementById('modalHost').textContent));
  w.eval("document.getElementById('dvSunset').value='30 Jun 2027'");
  confirmDialog(w); await wait(250);
  ok('it is deprecated rather than removed',
     G("apiVersions('AP-SET')[0].status") === 'deprecated' && G("apiVersions('AP-SET').length") === 1);
}

console.log('\n' + (failures ? '✗ ' + failures + ' of ' + checks + ' checks failed'
                             : '✓ all ' + checks + ' platform checks passed'));
process.exit(failures ? 1 : 0);

})();
