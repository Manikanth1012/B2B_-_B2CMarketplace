/* ===========================================================================
   Commerce journey tests: product media, partner integrations, the cost and
   sale price model, per-component bundle discounts and the discount rules
   engine. Fourth file, to stay inside the shell's 45-second budget.
   These do not check that a screen rendered — they drive each journey to its
   conclusion and assert that the underlying records actually changed.
   Run: node _src/journeys_commerce.js
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

/* ------------------------------------------------------------ PRODUCT MEDIA */
head('MEDIA — a listing carries several images, not one placeholder');
{
  const { w, G } = await load('partner.html');
  w.App = G('App'); w.App.go('newlisting'); await wait(170);
  w.eval('NL.step=1'); w.App.go('newlisting'); await wait(170);

  ok('the media manager is on the details step',
     /Media/.test(w.document.getElementById('main').textContent));
  ok('it starts empty and says so', G('NL.media.length') === 0 &&
     /No media yet/.test(w.document.getElementById('main').textContent));

  w.eval("nlMediaAdd('image')"); await wait(90);
  ok('the first image is primary automatically', G('NL.media[0].primary') === true);
  w.eval("nlMediaAdd('image')"); await wait(90);
  ok('the second is not', G('NL.media[1].primary') === false);
  ok('it says how many more images are needed',
     /1 more image is needed/.test(w.document.getElementById('main').textContent));

  w.eval("nlMediaAdd('image'); nlMediaAdd('video'); nlMediaAdd('doc')"); await wait(110);
  ok('images, a video and a document can all be attached',
     G("NL.media.filter(function(m){return m.kind==='video'}).length") === 1 &&
     G("NL.media.filter(function(m){return m.kind==='doc'}).length") === 1);
  w.eval("nlMediaAdd('video')"); await wait(90);
  ok('only one video is allowed', G("NL.media.filter(function(m){return m.kind==='video'}).length") === 1);

  ok('media with no alt text is not complete', G('mediaSummary(NL.media).ok') === false);
  ok('and it says how many are undescribed', G('mediaSummary(NL.media).noAlt') === 5);
  w.eval("NL.media.forEach(function(m,i){ nlMediaAlt(m.id,'View '+(i+1)); })"); await wait(110);
  ok('with alt text on every item it is complete', G('mediaSummary(NL.media).ok') === true);

  const ids = G('NL.media.map(function(m){return m.id})');
  w.eval("nlMediaMove('" + ids[0] + "',1)"); await wait(90);
  ok('an item can be reordered', G('NL.media[0].id') === ids[1]);
  w.eval("nlMediaPrimary('" + ids[2] + "')"); await wait(90);
  ok('the primary image can be changed',
     G('NL.media.filter(function(m){return m.primary}).length') === 1 &&
     G('NL.media.find(function(m){return m.primary}).id') === ids[2]);
  w.eval("nlMediaRemove('" + ids[2] + "')"); await wait(100);
  ok('removing the primary promotes another rather than leaving none',
     G('NL.media.filter(function(m){return m.primary}).length') === 1);

  for (let i = 0; i < 10; i++) w.eval("nlMediaAdd('image')");
  await wait(120);
  ok('images are capped at the marketplace maximum',
     G("NL.media.filter(function(m){return m.kind==='image'}).length") === G('MEDIA_RULES.maxImages'));

  /* existing listings already carry media, so the gallery is never empty */
  ok('existing listings have media too', Object.keys(G('PRODUCT_MEDIA')).length > 20);
  w.eval("openProduct(MY_LIST[0].id,{showComm:true,mode:'seller'})"); await wait(140);
  ok('the product inspector shows the gallery',
     /Media/.test(w.document.getElementById('inspector').textContent));
}

/* --------------------------------------------------------- INTEGRATIONS */
head('INTEGRATIONS — the seller registers the APIs the marketplace calls');
{
  const { w, G } = await load('partner.html');
  w.App = G('App'); w.App.go('integrations'); await wait(200);
  const t = w.document.getElementById('main').textContent;

  ok('the integrations screen exists', /Integrations/.test(t));
  ok('it lists the registered endpoints', G('DataTable.reg["dtEp"].rows.length') === G('MY_ENDPOINTS.length'));
  ok('it flags the failing one', /is failing/.test(t));
  ok('it shows which events reach the seller', /Which events reach you/.test(t));
  ok('it shows the call log', /Recent calls/.test(t));
  ok('an event with no endpoint is declared unhandled or unused',
     /Nothing registered/.test(t) || /Not used/.test(t));

  w.eval("openEndpoint('EP-01')"); await wait(150);
  const insp = w.document.getElementById('inspector');
  ok('an endpoint opens with its auth and retry policy',
     /OAuth 2.0/.test(insp.textContent) && /exponential backoff/.test(insp.textContent));
  ok('and the payload the marketplace actually sends', /order.created/.test(insp.textContent));
  ok('and the failures against it', /500/.test(insp.textContent));

  /* a test call reflects the endpoint's real state */
  w.eval("testEndpoint('EP-01')"); await wait(150);
  ok('a test call can be sent', !!w.document.getElementById('modalHost'));
  w.eval('runEndpointTest("EP-01")'); await wait(650);
  ok('the broken endpoint fails the test',
     /HTTP 500/.test(w.document.getElementById('tcResult').textContent));
  w.eval('closeModal()'); await wait(90);
  w.eval("testEndpoint('EP-02')"); await wait(140);
  w.eval('runEndpointTest("EP-02")'); await wait(650);
  ok('a healthy endpoint passes',
     /HTTP 200/.test(w.document.getElementById('tcResult').textContent));
  ok('and the call is written to the log', G("API_LOG[0].id").indexOf('CALL-T') === 0);
  w.eval('closeModal()'); await wait(90);

  /* validation on registering a new one */
  const before = G('MY_ENDPOINTS.length');
  w.eval('newEndpointDialog()'); await wait(150);
  w.eval('submitEndpoint(null)'); await wait(100);
  ok('a nameless endpoint is refused', !w.document.getElementById('epNameErr').hidden);
  w.document.getElementById('epName').value = 'Returns handler';
  w.document.getElementById('epUrl').value = 'http://insecure.example/hook';
  w.eval('submitEndpoint(null)'); await wait(100);
  ok('plain HTTP is refused, because payloads carry buyer data',
     !w.document.getElementById('epUrlErr').hidden);
  w.document.getElementById('epUrl').value = 'https://api.sentinelcyber.example/returns';
  w.eval('submitEndpoint(null)'); await wait(100);
  ok('an endpoint with no events is refused', !w.document.getElementById('epEvErr').hidden);
  w.document.querySelectorAll('.epEv')[2].checked = true;
  w.document.getElementById('epAuth').value = 'None';
  w.eval('submitEndpoint(null)'); await wait(110);
  ok('an unauthenticated production endpoint is refused', G('MY_ENDPOINTS.length') === before);
  w.document.getElementById('epAuth').value = 'HMAC signature';
  w.eval('submitEndpoint(null)'); await wait(200);
  ok('with auth it registers', G('MY_ENDPOINTS.length') === before + 1);
  ok('and it starts disabled rather than live',
     G('MY_ENDPOINTS[MY_ENDPOINTS.length-1].enabled') === false);

  /* the wizard can point a listing at an endpoint */
  w.App.go('newlisting'); await wait(160);
  w.eval("NL.step=3"); w.App.go('newlisting'); await wait(170);
  ok('the fulfilment step offers the registered endpoints',
     /Fulfilment API/.test(w.document.getElementById('main').textContent));
  w.eval("nlSetEndpoint('EP-01')"); await wait(150);
  ok('choosing a failing endpoint warns before publication',
     /is failing/.test(w.document.getElementById('main').textContent));
  w.eval("nlSetEndpoint('')"); await wait(150);
  ok('manual fulfilment is an explicit choice, and says what it costs',
     /Manual fulfilment/.test(w.document.getElementById('main').textContent));

  /* inbound keys */
  w.App.go('integrations'); await wait(160);
  w.eval('apiKeysDialog()'); await wait(150);
  ok('inbound API keys are managed too', !!w.document.getElementById('modalHost'));
  ok('a key is shown by prefix only',
     /mk_live_/.test(w.document.getElementById('modalHost').textContent));
}

/* ------------------------------------------------- COST AND SALE PRICE */
head('PRICING — cost, list and sale, and what is actually left');
{
  const { w, G } = await load('partner.html');
  w.App = G('App'); w.App.go('newlisting'); await wait(170);
  w.eval('NL.step=2'); w.App.go('newlisting'); await wait(170);
  const t = w.document.getElementById('main').textContent;
  ok('there is a cost price field', /Cost price/.test(t));
  ok('a list price field', /List price/.test(t));
  ok('and a sale price field', /Sale price/.test(t));
  ok('and a control for how far the operator may discount', /Discount the operator may apply/.test(t));

  w.eval("NL.price='100'; NL.cost='120'"); w.App.go('newlisting'); await wait(170);
  ok('cost above sale price is called out',
     /Cost is at or above the sale price/.test(w.document.getElementById('main').textContent));

  w.eval("NL.price='100'; NL.cost='40'; NL.opFloorPct=50"); w.App.go('newlisting'); await wait(170);
  const t2 = w.document.getElementById('main').textContent;
  ok('the margin stack is shown', /Your margin/.test(t2));
  ok('and the discount headroom', /Discount headroom is/.test(t2));
  ok('with the lowest price a promotion could reach', /the lowest a promotion could take this is/.test(t2));

  /* a listing priced below cost cannot be submitted */
  w.eval("NL.name='Test listing'; NL.price='100'; NL.cost='150'; NL.step=5"); await wait(110);
  w.eval('submitListing()'); await wait(120);
  ok('a listing priced below cost is refused', !w.document.getElementById('modalHost'));
  ok('and it sends you back to pricing', G('NL.step') === 2);

  /* existing listings carry a cost so the engine has a floor to work with */
  ok('every priced listing has a cost',
     G('PRODUCTS.filter(function(p){return p.price>0 && p.cost==null}).length') === 0);
  ok('and the cost is below the price',
     G('PRODUCTS.filter(function(p){return p.price>0 && p.cost>=p.price}).length') === 0);
}

/* ------------------------------------------ BUNDLE DISCOUNTS AT THE FLOOR */
head('BUNDLES — the operator may discount per component, never below cost');
{
  const { w, G } = await load('operator.html');
  w.App = G('App'); w.App.go('catalogue'); await wait(200);
  w.eval('newListingDialog()'); await wait(150);
  w.eval("nbToggle('TP-MOB-100'); nbToggle('TP-VAS-SEC'); nbToggle('TP-VAS-CLD')"); await wait(120);

  const m0 = G('nbMath()');
  ok('the composer knows what the components cost', m0.cost > 0 && m0.cost < m0.rc);
  ok('and shows the margin', m0.margin > 0);

  const maxD = G("nbMaxDisc(TCMAP['TP-MOB-100'])");
  ok('each component has a maximum discount, derived from its own cost', maxD > 0 && maxD < 100);
  w.eval("nbSetDisc('TP-MOB-100'," + (maxD + 25) + ")"); await wait(110);
  ok('a discount beyond that is clipped rather than accepted',
     G("NB.picks.find(function(p){return p.id==='TP-MOB-100'}).disc") === maxD);

  w.eval("nbSetDisc('TP-MOB-100',10)"); await wait(110);
  const m1 = G('nbMath()');
  ok('a per-component discount reduces the derived price', m1.derivedRc < m0.derivedRc);
  ok('and is reported separately from the bundle rule', m1.lineDisc > 0 && m1.pct === m0.pct);
  ok('the margin falls with it', m1.margin < m0.margin);

  /* an override below cost is clamped, not merely flagged */
  w.eval("NB.override=" + (m1.cost - 5)); await wait(90);
  const m2 = G('nbMath()');
  ok('an override below cost is raised to cost', m2.floored === true && m2.price === m2.cost);
  ok('and the requested figure is kept so the screen can say what happened',
     m2.requested < m2.cost);

  w.eval("NB.override=null; NB.name='Connected Home Pro'"); await wait(90);
  const before = G('PRODUCTS.length');
  w.eval('submitNewListing()'); await wait(220);
  ok('the bundle is created', G('PRODUCTS.length') === before + 1);
  const p = G('PRODUCTS[PRODUCTS.length-1]');
  ok('it is priced above its cost', p.price > p.cost);
  ok('and records the discount applied to each component',
     p.components.some(function(c){ return c.disc === 10; }));
}

/* ------------------------------------------------- DISCOUNT RULES ENGINE */
head('PROMOTIONS — conditions that actually evaluate');
{
  const { w, G } = await load('operator.html');
  w.App = G('App'); w.App.go('promotions'); await wait(210);
  const t = w.document.getElementById('main').textContent;
  ok('the promotions screen exists', /Promotions/.test(t));
  ok('it lists the rules', G('DataTable.reg["dtPromo"].rows.length') === G('DISCOUNT_RULES.length'));
  ok('it shows which would apply right now', /What is running right now/.test(t));
  ok('and it states the cost floor as a guarantee', /No promotion may sell below cost/.test(t));

  const con = "basketFrom([{sku:'a',v:'content',price:120,qty:1,model:'monthly',cost:66}]," +
              "{audience:'Consumer',firstOrder:false,tier:'Gold',contract:false})";

  /* time of day */
  w.eval("CLOCK.hhmm='14:20'; CLOCK.day='Sat'");
  let ev = G("evalDiscounts(" + con + ")");
  let r1 = ev.results.filter(function(r){ return r.rule.id === 'DR-01'; })[0];
  ok('a time-of-day rule does not fire outside its window', r1.applies === false);
  ok('and it says why, with the current time', /20:00/.test(r1.why) && /14:20/.test(r1.why));
  w.eval("CLOCK.hhmm='21:00'");
  ev = G("evalDiscounts(" + con + ")");
  r1 = ev.results.filter(function(r){ return r.rule.id === 'DR-01'; })[0];
  ok('inside the window it fires', r1.applies === true && r1.amount > 0);
  ok('and the amount is the stated percentage', Math.abs(r1.amount - 120 * 0.12) < 0.02);

  /* day of week */
  w.eval("CLOCK.day='Wed'");
  const dev = G("evalDiscounts(basketFrom([{sku:'a',v:'device',price:260,qty:1,model:'oneoff',cost:150}]," +
                "{audience:'Consumer',firstOrder:false,tier:'Gold',contract:false}))");
  const r4 = dev.results.filter(function(r){ return r.rule.id === 'DR-04'; })[0];
  ok('a weekend rule does not fire on a Wednesday', r4.applies === false);
  ok('and names the days it does run', /Sat/.test(r4.why));

  /* cart value */
  const small = G("evalDiscounts(basketFrom([{sku:'a',v:'device',price:120,qty:1,model:'oneoff',cost:80}]," +
                  "{audience:'Consumer',firstOrder:false,tier:'Gold',contract:false}))");
  const r2small = small.results.filter(function(r){ return r.rule.id === 'DR-02'; })[0];
  ok('a cart-value rule does not fire below the threshold', r2small.applies === false);
  ok('and says the gap in money, not in jargon', /\$200/.test(r2small.why));

  /* audience */
  const ent = G("evalDiscounts(basketFrom([{sku:'a',v:'security',price:323,qty:40,model:'monthly',cost:140}]," +
                "{audience:'Enterprise',firstOrder:false,tier:null,contract:true}))");
  const r3 = ent.results.filter(function(r){ return r.rule.id === 'DR-03'; })[0];
  ok('an enterprise volume rule fires for an enterprise basket', r3.applies === true);
  const con2 = G("evalDiscounts(basketFrom([{sku:'a',v:'security',price:323,qty:40,model:'monthly',cost:140}]," +
                 "{audience:'Consumer',firstOrder:false,tier:'Gold',contract:false}))");
  ok('and not for a consumer one',
     con2.results.filter(function(r){ return r.rule.id === 'DR-03'; })[0].applies === false);

  /* the cost floor is the whole point */
  const thin = G("evalDiscounts(basketFrom([{sku:'a',v:'device',price:260,qty:1,model:'oneoff',cost:255}]," +
                 "{audience:'Consumer',firstOrder:false,tier:'Gold',contract:false}))");
  ok('a thin-margin basket has almost no headroom', thin.headroom === 5);
  /* Each rule floors itself first, so by the time they are summed the total is
     already at the headroom. The per-rule record is where the clipping shows. */
  const thinHit = thin.results.filter(function(r){ return r.rule.id === 'DR-02'; })[0];
  ok('the rule wanted more than the margin allowed', thinHit.raw > thinHit.amount,
     thinHit.raw + ' wanted, ' + thinHit.amount + ' given');
  ok('and it records that it was floored at cost', thinHit.flooredAtCost === true);
  ok('the engine gave only the headroom', thin.total === thin.headroom);
  ok('so the basket can never be sold below cost', thin.total <= thin.headroom);

  /* budget */
  const spent = G("DISCOUNT_RULES.filter(function(r){return r.budget && r.budget.used>=r.budget.cap})");
  w.eval("DRMAP['DR-02'].budget.used = DRMAP['DR-02'].budget.cap");
  const broke = G("evalDiscounts(basketFrom([{sku:'a',v:'device',price:400,qty:1,model:'oneoff',cost:200}]," +
                  "{audience:'Consumer',firstOrder:false,tier:'Gold',contract:false}))");
  ok('a rule with no budget left stops giving',
     broke.results.filter(function(r){ return r.rule.id === 'DR-02'; })[0].applies === false);
  ok('and says the budget is the reason',
     /budget/.test(broke.results.filter(function(r){ return r.rule.id === 'DR-02'; })[0].why));
  w.eval("DRMAP['DR-02'].budget.used = 9420");

  /* stacking */
  w.eval("CLOCK.hhmm='21:00'; CLOCK.day='Sat'");
  const both = G("evalDiscounts(basketFrom([{sku:'a',v:'content',price:300,qty:1,model:'monthly',cost:120}]," +
                 "{audience:'Consumer',firstOrder:false,tier:'Gold',contract:false}))");
  ok('a stacking rule adds on top of a non-stacking one',
     both.applied.length > 1 && both.applied.some(function(a){ return a.rule.stack; }));
  ok('only one non-stacking rule is used',
     both.applied.filter(function(a){ return !a.rule.stack; }).length <= 1);
}
head('PROMOTIONS — creating one, and the simulator');
{
  const { w, G } = await load('operator.html');
  w.App = G('App'); w.App.go('promotions'); await wait(200);

  const before = G('DISCOUNT_RULES.length');
  w.eval('newPromoDialog()'); await wait(150);
  ok('the builder opens', !!w.document.getElementById('modalHost'));
  w.eval('submitPromo(null)'); await wait(100);
  ok('a nameless promotion is refused', !w.document.getElementById('prNameErr').hidden);
  w.document.getElementById('prName').value = 'Lunchtime device hour';
  w.document.getElementById('prBlurb').value = 'short';
  w.eval('submitPromo(null)'); await wait(100);
  ok('one with no stated purpose is refused', !w.document.getElementById('prBlurbErr').hidden);
  w.document.getElementById('prBlurb').value = 'Moves device stock in the midday lull between the two peaks.';
  w.document.getElementById('prValue').value = '0';
  w.eval('submitPromo(null)'); await wait(110);
  ok('a promotion that gives nothing is refused', G('DISCOUNT_RULES.length') === before);
  w.document.getElementById('prValue').value = '95';
  w.eval('submitPromo(null)'); await wait(110);
  ok('an absurd percentage is refused', G('DISCOUNT_RULES.length') === before);

  w.document.getElementById('prValue').value = '7';
  w.document.getElementById('prFrom').value = '12:00';
  w.document.getElementById('prTo').value = '14:00';
  w.document.querySelectorAll('.prCat')[4].checked = true;   /* device */
  w.eval('submitPromo(null)'); await wait(220);
  ok('a valid promotion is created', G('DISCOUNT_RULES.length') === before + 1);
  const r = G('DISCOUNT_RULES[DISCOUNT_RULES.length-1]');
  ok('it is live straight away', r.on === true);
  ok('it captured the time window', r.conditions.timeOfDay.from === '12:00');
  ok('and the category', (r.conditions.category || []).indexOf('device') > -1);

  /* it evaluates like any other rule */
  w.eval("CLOCK.hhmm='13:00'");
  let ev = G("evalDiscounts(basketFrom([{sku:'a',v:'device',price:200,qty:1,model:'oneoff',cost:100}]," +
             "{audience:'Consumer',firstOrder:false,tier:'Gold',contract:false}))");
  ok('the new rule fires inside its window',
     ev.results.filter(function(x){ return x.rule.id === r.id; })[0].applies === true);
  w.eval("CLOCK.hhmm='17:00'");
  ev = G("evalDiscounts(basketFrom([{sku:'a',v:'device',price:200,qty:1,model:'oneoff',cost:100}]," +
         "{audience:'Consumer',firstOrder:false,tier:'Gold',contract:false}))");
  ok('and not outside it',
     ev.results.filter(function(x){ return x.rule.id === r.id; })[0].applies === false);

  /* the simulator */
  w.eval('promoSimulator()'); await wait(160);
  ok('the simulator opens', !!w.document.getElementById('modalHost'));
  ok('it shows both what applies and what does not',
     /Not applied/.test(w.document.getElementById('modalHost').textContent));
  w.eval("simSet('value',600)"); await wait(140);
  ok('changing the basket re-evaluates',
     /Buyer pays/.test(w.document.getElementById('modalHost').textContent));

  /* editing keeps the spend history */
  w.eval("closeModal(); editPromo('DR-02')"); await wait(160);
  const used = G("DRMAP['DR-02'].budget.used");
  w.document.getElementById('prValue').value = '9';
  w.eval("submitPromo('DR-02')"); await wait(200);
  ok('an edit saves', G("DRMAP['DR-02'].effect.value") === 9);
  ok('and does not reset the spend already given', G("DRMAP['DR-02'].budget.used") === used);
}
head('PROMOTIONS — the buyer sees them, and the maths reconciles');
{
  const { w, G } = await load('consumer.html');
  w.App = G('App');
  w.eval("CLOCK.hhmm='21:00'; CLOCK.day='Sat'; CART.length=0; addToCart('SKU-3001'); addToCart('SKU-4001')");
  await wait(150);

  const t = G('cartTotals()');
  ok('a promotion reaches the consumer basket', t.promoOff > 0);
  ok('the basket knows it is a consumer basket', G('cartBasket().audience') === 'Consumer');
  ok('one-off and recurring both reconcile after the discount',
     Math.abs((t.once - t.promoOnce) - t.gross) < 0.02 &&
     Math.abs((t.monthList - t.promoMonth) - t.month) < 0.02);
  ok('the discount never exceeds the headroom', t.promoOff <= G('cartDiscounts().headroom') + 0.01);

  w.eval('openCart()'); await wait(160);
  const insp = w.document.getElementById('inspector');
  ok('the basket names the offers applied', /Offers/.test(insp.textContent));
  ok('and says why others did not apply', /Not applied/.test(insp.textContent));
}
{
  const { w, G } = await load('enterprise.html');
  w.App = G('App');
  w.eval("CART.length=0; addToCart('SKU-6001'); CART[0].qty=40;"); await wait(150);
  ok('an enterprise basket is recognised as enterprise', G('cartBasket().audience') === 'Enterprise');
  const ev = G('cartDiscounts()');
  ok('the enterprise volume rule applies to it',
     ev.applied.some(function(a){ return a.rule.id === 'DR-03'; }));
  const t = G('cartTotals()');
  ok('a discount on a subscription reduces the monthly charge, not just the one-off',
     t.promoMonth > 0 && t.month < t.monthList);
}

/* ------------------------------------------------ ORDER STAGE DETAIL */
head('ORDER STAGES \u2014 every stage in the tracker has a record behind it');
{
  const { w, G } = await load('consumer.html');
  w.App = G('App'); w.App.go('orders'); await wait(320);
  const main = w.document.getElementById('main');
  const steps = Array.from(main.querySelectorAll('.pipe .step'));

  ok('the tracker draws stages', steps.length > 0);
  ok('every stage is a real control, not link-looking text',
     steps.every(function(s){ return s.tagName === 'BUTTON'; }));
  ok('and every one of them is wired to something',
     steps.every(function(s){ return /openOrderStage\(/.test(s.getAttribute('onclick') || ''); }));
  ok('each stage names itself to a screen reader',
     steps.every(function(s){ return /Open this stage/.test(s.getAttribute('aria-label') || ''); }));

  /* Every label the pipelines can produce must have a record, or the affordance
     is back to being a lie for that one order. */
  const orphans = G("Object.keys(PIPELINES).reduce(function(a,k){" +
    "PIPELINES[k].forEach(function(s){ if(!STAGE_INFO[s] && a.indexOf(s)<0) a.push(s); }); return a; },[])");
  ok('no pipeline stage is missing its record', orphans.length === 0);

  steps[0].dispatchEvent(new w.MouseEvent('click', { bubbles: true })); await wait(260);
  const mo = w.document.getElementById('modalHost');
  ok('clicking a stage opens something', !!mo);
  const txt = mo ? mo.textContent.replace(/\s+/g, ' ') : '';
  ok('it says who does that stage', /Who does this stage/.test(txt));
  ok('it says what would prove it happened', /What proves it/.test(txt));
  ok('it says what comes next', /Next/.test(txt));
  ok('and it does not claim a stage it cannot evidence', !/undefined/.test(txt));

  w.eval('closeModal()'); await wait(120);
  const todo = steps.find(function(s){ return / todo/.test(' ' + s.className); });
  if (todo) {
    todo.dispatchEvent(new w.MouseEvent('click', { bubbles: true })); await wait(240);
    const t2 = (w.document.getElementById('modalHost') || {}).textContent || '';
    ok('a stage not yet reached says so rather than inventing a date',
       /has not been reached/.test(t2.replace(/\s+/g, ' ')));
    ok('and it refuses to turn a typical duration into a promise',
       /not a commitment/.test(t2.replace(/\s+/g, ' ')));
    w.eval('closeModal()'); await wait(100);
  }

  /* The same component draws onboarding gates and, in the listing wizard, a
     preview of a pipeline that belongs to nobody yet. Whichever it is drawing,
     button and handler have to agree: clickable means something opens, and
     something opens only if it is clickable. */
  const { w: pw, G: pG } = await load('partner.html');
  pw.App = pG('App'); pw.App.go('onboarding'); await wait(320);
  const gates = Array.from(pw.document.getElementById('main').querySelectorAll('.pipe .step'));
  ok('onboarding gates are drawn', gates.length > 0);
  ok('every clickable gate actually opens the submission behind it',
     gates.every(function(s){
       return s.tagName !== 'BUTTON' || /openMyGate\(/.test(s.getAttribute('onclick') || ''); }));

  pw.eval("NL.step=3"); pw.App.go('newlisting'); await wait(340);
  const prev = Array.from(pw.document.getElementById('main').querySelectorAll('.pipe .step'));
  ok('the wizard previews the pipeline a buyer would see', prev.length > 0);
  ok('the wizard preview stages carry no handler, because they open nothing',
     prev.every(function(s){ return !s.getAttribute('onclick'); }));
  ok('and so they are not drawn as controls',
     prev.every(function(s){ return s.tagName !== 'BUTTON'; }));
}

console.log('\n' + (failures ? '\u2717 ' + failures + ' of ' + checks + ' checks failed'
                             : '\u2713 all ' + checks + ' commerce checks passed'));
process.exit(failures ? 1 : 0);

})();
