/* ===========================================================================
   Inventory, ticketing, reviews and partner branding. Seventh file, to stay
   inside the shell's 45-second budget.
   These do not check that a screen rendered — they drive each journey to its
   conclusion and assert that the underlying records actually changed.
   Run: node _src/journeys_ops.js
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


/* ------------------------------------------------------------- INVENTORY */
head('INVENTORY — stock is a ledger, not a display field');
{
  const { w, G } = await load('operator.html');
  w.App = G('App'); w.App.go('inventory'); await wait(230);
  const t = w.document.getElementById('main').textContent;

  ok('the inventory console exists', /Inventory/.test(t));
  ok('only physical lines are stocked', G('Object.keys(INVENTORY).length') > 0 &&
     G('Object.keys(INVENTORY).length') < G('PRODUCTS.length'));
  ok('available is on hand less reserved, everywhere',
     G("Object.keys(INVENTORY).every(function(k){return invAvailable(k)===Math.max(0,INVENTORY[k].onHand-INVENTORY[k].reserved)})"));
  ok('it explains why a line can read out of stock with units present',
     /less what is reserved/.test(t));
  ok('capacity pools are inventory too', /Capacity pools/.test(t));

  /* an adjustment is a movement, and movements are append-only */
  const sku = G('Object.keys(INVENTORY)[0]');
  const before = G("INVENTORY['" + sku + "'].onHand");
  const moves = G('STOCK_MOVES.length');
  w.eval("adjustStockDialog('" + sku + "')"); await wait(160);
  w.document.getElementById('asQty').value = '-4';
  w.document.getElementById('asNote').value = 'Cycle count variance';
  confirmDialog(w); await wait(200);
  ok('an adjustment changes on hand', G("INVENTORY['" + sku + "'].onHand") === before - 4);
  ok('and appends a movement', G('STOCK_MOVES.length') === moves + 1);
  ok('the movement records who and why', !!G('STOCK_MOVES[0].by') && !!G('STOCK_MOVES[0].note'));
  ok('and it is audited', G("AUDIT_LOG.operator.some(function(e){return /on hand/.test(e.before||'')})"));

  /* receiving is the only way units enter */
  const oh = G("INVENTORY['" + sku + "'].onHand");
  w.eval("receiveStockDialog('','" + sku + "')"); await wait(160);
  w.document.getElementById('rsQty').value = '0';
  w.eval('submitReceive()'); await wait(100);
  ok('receiving zero units is refused', !w.document.getElementById('rsQtyErr').hidden);
  w.document.getElementById('rsQty').value = '30';
  w.document.getElementById('rsRef').value = 'PO-99120';
  w.eval('submitReceive()'); await wait(200);
  ok('a real receipt increases on hand', G("INVENTORY['" + sku + "'].onHand") === oh + 30);

  /* the SIM pool is inventory with a lifecycle */
  w.eval('simPoolDialog()'); await wait(170);
  const sm = w.document.getElementById('modalHost');
  ok('the SIM pool opens', /SIM pool/.test(sm.textContent));
  ok('it models a lifecycle rather than a count', /Retired/.test(sm.textContent));
  ok('and does not print ten thousand identifiers', /not listed here/.test(sm.textContent));
}
head('INVENTORY — the storefront cannot promise what the warehouse lacks');
{
  const { w, G } = await load('consumer.html');
  w.App = G('App'); await wait(190);
  const sku = G("Object.keys(INVENTORY).filter(function(k){return SKUMAP[k]})[0]");

  w.eval("CART.length=0; INVENTORY['" + sku + "'].onHand=2; INVENTORY['" + sku + "'].reserved=0;");
  w.eval("addToCart('" + sku + "'); addToCart('" + sku + "'); addToCart('" + sku + "')"); await wait(160);
  ok('the basket is capped at what is available',
     G("(CART.find(function(l){return l.sku==='" + sku + "'})||{}).qty") === 2);

  w.eval("INVENTORY['" + sku + "'].onHand=0; CART.length=0;");
  w.eval("addToCart('" + sku + "')"); await wait(140);
  ok('an out-of-stock line cannot be added at all', G('CART.length') === 0);
  ok('and the buyer label says so', G("invBuyerLabel('" + sku + "').tone") === 'bad');

  w.eval("INVENTORY['" + sku + "'].onHand=4; INVENTORY['" + sku + "'].reserved=0; INVENTORY['" + sku + "'].reorderAt=10;");
  ok('a low line tells the buyer how few are left', /Only 4 left/.test(G("invBuyerLabel('" + sku + "').text")));

  /* reserved units are physically present but not sellable */
  w.eval("INVENTORY['" + sku + "'].onHand=5; INVENTORY['" + sku + "'].reserved=5;");
  ok('fully reserved stock reads as out of stock', G("invState('" + sku + "')") === 'out');
  ok('even though units are on hand', G("INVENTORY['" + sku + "'].onHand") === 5);
}
head('INVENTORY — a seller sees only its own stock');
{
  const { w, G } = await load('partner.html');
  w.App = G('App'); w.App.go('inventory'); await wait(230);
  ok('the seller has an inventory screen', /Inventory/.test(w.document.getElementById('main').textContent));
  ok('scoped to its own lines',
     G("DataTable.reg['dtInv'].rows.every(function(r){return r.partnerId===ME_P.id})"));
  ok('and that is fewer than the whole marketplace',
     G("DataTable.reg['dtInv'].rows.length") < G('Object.keys(INVENTORY).length'));
}

/* -------------------------------------------------------------- TICKETING */
head('TICKETING — a queue with an SLA that stops when we are not the blocker');
{
  const { w, G } = await load('operator.html');
  w.App = G('App'); w.App.go('tickets'); await wait(230);
  const t = w.document.getElementById('main').textContent;

  ok('the queue exists', /Support tickets/.test(t));
  ok('every ticket is listed', G('DataTable.reg["dtTkt"].rows.length') === G('TICKETS.length'));
  ok('the escalation ladder is stated', /Escalation ladder/.test(t));
  ok('and that escalation is automatic', /automatic/i.test(t));

  ok('priority multiplies the category target rather than replacing it',
     G("Math.round(TCATMAP.billing.resolveHr*TPRIMAP.P1.mult)") >
     G("Math.round(TCATMAP.provisioning.resolveHr*TPRIMAP.P1.mult)"));
  ok('a waiting ticket excludes the paused hours from worked time',
     G("TICKETS.filter(function(t){return t.state==='waiting'})[0].workedHr") <
     G("TICKETS.filter(function(t){return t.state==='waiting'})[0].ageHr"));
  ok('and the screen explains why that matters',
     /waiting on the requester does not count/i.test(t));

  const esc1 = G("TICKETS.filter(function(t){return t.state==='escalated'})[0].id");
  w.eval("openTicket('" + esc1 + "')"); await wait(170);
  let insp = w.document.getElementById('inspector');
  ok('an escalated ticket says who it went to', /Escalated to/.test(insp.textContent));
  ok('the conversation is threaded', insp.querySelectorAll('.tktmsg').length > 1);
  ok('internal notes are visible to an agent', /Internal notes/.test(insp.textContent));
  ok('and marked as not visible to the requester', /Not visible to the requester/.test(insp.textContent));

  const th = G("TICKETS.find(function(t){return t.id==='" + esc1 + "'}).thread.length");
  w.document.getElementById('tkReply').value = 'Documented the retry cadence for other sellers.';
  w.eval("replyTicket('" + esc1 + "')"); await wait(200);
  ok('a reply is appended to the thread',
     G("TICKETS.find(function(t){return t.id==='" + esc1 + "'}).thread.length") === th + 1);

  w.eval("openTicket('" + esc1 + "')"); await wait(160);
  w.eval("resolveTicket('" + esc1 + "')"); await wait(160);
  w.document.getElementById('trWhat').value = 'ok';
  confirmDialog(w); await wait(150);
  ok('a resolution with no explanation is refused',
     G("TICKETS.find(function(t){return t.id==='" + esc1 + "'}).state") === 'escalated');
  w.eval("resolveTicket('" + esc1 + "')"); await wait(160);
  w.document.getElementById('trWhat').value = 'Their auth layer rejected the second token in the retry window.';
  confirmDialog(w); await wait(210);
  ok('with an explanation it resolves',
     G("TICKETS.find(function(t){return t.id==='" + esc1 + "'}).state") === 'resolved');
  ok('and the resolution is kept against the ticket',
     !!G("TICKETS.find(function(t){return t.id==='" + esc1 + "'}).resolution"));
  ok('resolving is audited', G("AUDIT_LOG.operator.some(function(e){return /TKT-/.test(e.object||'')})"));
}
head('TICKETING — raising one, and who can see it');
{
  const { w, G } = await load('operator.html');
  w.App = G('App'); w.App.go('tickets'); await wait(220);
  const before = G('TICKETS.length');
  w.eval("newTicketDialog('operator')"); await wait(170);
  w.eval("submitTicket('operator')"); await wait(110);
  ok('a ticket with no subject is refused', !w.document.getElementById('ntSubjectErr').hidden);
  w.document.getElementById('ntSubject').value = 'Catalogue feed slow for Volta';
  w.eval("submitTicket('operator')"); await wait(110);
  ok('a one-word ticket is refused', !w.document.getElementById('ntBodyErr').hidden);
  ok('and nothing was created', G('TICKETS.length') === before);
  w.document.getElementById('ntBody').value = 'Endpoint takes over 8 seconds and times out on the hourly pull.';
  w.eval("submitTicket('operator')"); await wait(210);
  ok('a complete ticket is raised', G('TICKETS.length') === before + 1);
  ok('it starts as new and unassigned', G('TICKETS[0].state') === 'new' && !G('TICKETS[0].assignee'));
  ok('with targets computed from category and priority', G('TICKETS[0].resolveTargetHr') > 0);

  w.eval('slaPolicyDialog()'); await wait(170);
  const m = w.document.getElementById('modalHost');
  ok('the SLA policy is documented', /How the clock works/.test(m.textContent));
  ok('including that reassignment does not restart it', /does not restart it/.test(m.textContent));
}
{
  for (const [file, ctx] of [['partner.html','partner'],['enterprise.html','buyer'],['consumer.html','consumer']]){
    const { w, G } = await load(file);
    w.App = G('App'); w.App.go('tickets'); await wait(210);
    ok(file + ' — has a support screen',
       /Support|Help/.test(w.document.getElementById('main').textContent));
    ok(file + ' — sees only its own tickets',
       G("tktVisible('" + ctx + "').every(function(t){return t.ctx==='" + ctx + "'})"));
    ok(file + ' — which is fewer than the whole queue',
       G("tktVisible('" + ctx + "').length") < G('TICKETS.length'));
  }
}

/* ---------------------------------------------------------------- REVIEWS */
head('REVIEWS — only buyers write them, and a person checks them');
{
  const { w, G } = await load('consumer.html');
  w.App = G('App'); await wait(200);

  const bought = G('MY_ORDERS[0].sku');
  const notBought = G("PRODUCTS.filter(function(p){return !MY_ORDERS.some(function(o){return o.sku===p.id})})[0].id");
  ok('a buyer may review what they bought', G("canReview('" + bought + "').ok") === true);
  ok('and may not review what they did not', G("canReview('" + notBought + "').ok") === false);
  w.eval("writeReviewDialog('" + notBought + "')"); await wait(140);
  ok('the dialog will not even open for an unbought item', !w.document.getElementById('modalHost'));

  const before = G('REVIEWS.length');
  w.eval("writeReviewDialog('" + bought + "')"); await wait(180);
  ok('it opens for a verified buyer', !!w.document.getElementById('modalHost'));
  w.eval('submitReview()'); await wait(110);
  ok('a review with no rating is refused', !w.document.getElementById('nrStarsErr').hidden);
  w.eval('setReviewStars(4)'); await wait(90);
  w.eval('submitReview()'); await wait(110);
  ok('a review with no headline is refused', !w.document.getElementById('nrTitleErr').hidden);
  w.document.getElementById('nrTitle').value = 'Does what it says';
  w.document.getElementById('nrBody').value = 'short';
  w.eval('submitReview()'); await wait(110);
  ok('a one-word review is refused', !w.document.getElementById('nrBodyErr').hidden);
  ok('and nothing was created', G('REVIEWS.length') === before);

  w.document.getElementById('nrBody').value = 'Used it for three weeks on the depot run and it has not dropped once.';
  w.eval('submitReview()'); await wait(220);
  ok('a complete review is submitted', G('REVIEWS.length') === before + 1);
  ok('it is pending, not published', G('REVIEWS[0].state') === 'pending');
  ok('marked as a verified purchase with the order behind it',
     G('REVIEWS[0].verified') === true && !!G('REVIEWS[0].orderRef'));
  ok('the same buyer cannot review it twice', G("canReview('" + bought + "').ok") === false);

  /* a pending review must not move a rating */
  const sku2 = G('REVIEWS[0].sku');
  const shown = G("SKUMAP['" + sku2 + "'].reviews");
  const pubCount = G("REVIEWS.filter(function(r){return r.sku==='" + sku2 + "' && r.state==='published'}).length");
  const hist = G("SKUMAP['" + sku2 + "'].histReviews");
  ok('the headline count is historical plus published, excluding pending',
     shown === hist + pubCount, shown + ' vs ' + hist + '+' + pubCount);
}
head('REVIEWS — moderation is about content, not sentiment');
{
  const { w, G } = await load('operator.html');
  w.App = G('App'); w.App.go('reviews'); await wait(240);
  const t = w.document.getElementById('main').textContent;

  ok('the moderation queue exists', /Reviews/.test(t));
  ok('it states that rejecting for negativity is not permitted', /not a permitted reason/.test(t));
  ok('pending reviews are shown for a decision',
     G("REVIEWS.filter(function(r){return r.state==='pending'}).length") > 0);

  const pend = G("REVIEWS.filter(function(r){return r.state==='pending'})[0]");
  const sku = pend.sku;
  const before = G("SKUMAP['" + sku + "'].reviews");
  w.eval("moderateReview('" + pend.id + "',true)"); await wait(170);
  confirmDialog(w); await wait(210);
  ok('publishing changes the state',
     G("REVIEWS.find(function(r){return r.id==='" + pend.id + "'}).state") === 'published');
  ok('and the aggregate moves with it', G("SKUMAP['" + sku + "'].reviews") === before + 1);
  ok('moderation is audited',
     G("AUDIT_LOG.operator.some(function(e){return /review/i.test(e.object||'')})"));

  const pend2 = G("REVIEWS.filter(function(r){return r.state==='pending'})[0]");
  if (pend2){
    w.eval("moderateReview('" + pend2.id + "',false)"); await wait(170);
    confirmDialog(w); await wait(210);
    const r = G("REVIEWS.find(function(x){return x.id==='" + pend2.id + "'})");
    ok('a rejection records a reason', r.state === 'rejected' && !!r.rejectReason);
    ok('and the reason is one of the permitted ones',
       G('REVIEW_REASONS').indexOf(r.rejectReason) > -1);
  }
}

/* --------------------------------------------------------------- BRANDING */
head('BRANDING — the seller styles their console, not the checkout');
{
  const { w, G } = await load('partner.html');
  w.App = G('App'); w.App.go('branding'); await wait(230);
  const t = w.document.getElementById('main').textContent;

  ok('the branding screen exists', /Branding/.test(t));
  ok('it states the scope explicitly', /Storefront and checkout/.test(t));
  ok('and why the checkout is off limits', /not a marketplace/.test(t));

  w.eval("brandColour('primary','#FFEB3B')"); await wait(180);
  ok('a low-contrast palette is flagged',
     /fails the accessibility floor/i.test(w.document.getElementById('main').textContent));
  const applied0 = G('MY_BRAND.applied');
  w.eval('saveBrand()'); await wait(150);
  ok('and cannot be applied', G('MY_BRAND.applied') === applied0);

  w.eval("brandPreset('sentinel')"); await wait(180);
  ok('a preset passes contrast', G("contrast(MY_BRAND.primary,'#FFFFFF')") >= 4.5);

  w.eval('brandAddLogo()'); await wait(150);
  w.eval('saveBrand()'); await wait(150);
  ok('a logo without alt text cannot be applied', G('MY_BRAND.applied') === false);
  w.eval("MY_BRAND.logoAlt='Sentinel Cyber logo'");
  w.eval('saveBrand()'); await wait(200);
  ok('with alt text it applies', G('MY_BRAND.applied') === true);
  ok('and injects a scoped stylesheet', !!w.document.getElementById('brandStyle'));
  ok('the change is audited',
     G("AUDIT_LOG.partner.some(function(e){return /branding/i.test(e.object||'')})"));

  /* three cards cannot be hidden */
  const was = G('MY_BRAND.widgets.orders');
  w.eval("brandWidget('orders',false)"); await wait(150);
  ok('a locked dashboard card cannot be hidden', G('MY_BRAND.widgets.orders') === was);
  ok('and the reason is given', !!G("BRAND_WIDGETS.filter(function(x){return x.id==='orders'})[0].why"));
  w.eval("brandWidget('gmv',false)"); await wait(150);
  ok('an unlocked card can be hidden', G('MY_BRAND.widgets.gmv') === false);
  w.App.go('home'); await wait(210);
  ok('and the dashboard honours it',
     !/Gross merchandise value/.test(w.document.getElementById('main').textContent));

  w.App.go('branding'); await wait(190);
  w.eval('resetBrand()'); await wait(150);
  confirmDialog(w); await wait(210);
  ok('reset returns to the marketplace default', G('MY_BRAND.applied') === false);
  ok('and restores the hidden cards', G('MY_BRAND.widgets.gmv') === true);
}

/* ------------------------------------------------------- KNOWLEDGE BASE */
head('KNOWLEDGE BASE — scoped to the persona, and it drives the console');
{
  for (const [file, ctx, term] of [['operator.html','operator','settlement'],
                                   ['partner.html','partner','settlement'],
                                   ['enterprise.html','buyer','approval'],
                                   ['consumer.html','consumer','subscription']]){
    const { w, G } = await load(file);
    w.App = G('App'); w.App.go('help'); await wait(240);
    const t = w.document.getElementById('main').textContent;
    const p = file.replace('.html','');

    ok(p + ' has a knowledge base', /Knowledge base|How things work/.test(t) && G('kbAll().length') > 0);
    ok(p + ' is scoped to its own persona', G('kbCtx()') === ctx);
    ok(p + ' offers guided walkthroughs', G('kbTours().length') > 0);

    /* every reference resolves — an article or a stop pointing at a screen
       that does not exist in this console is a dead end, not help */
    ok(p + ' — every article names a screen that exists here',
       G("kbAll().filter(function(a){return a.view && !App.findView(a.view)}).length") === 0);
    ok(p + ' — every walkthrough stop resolves',
       G("(function(){var n=0;kbTours().forEach(function(t){t.stops.forEach(function(s){if(!App.findView(s.view))n++;});});return n;})()") === 0);

    w.eval("kbSetQ('" + term + "')"); await wait(150);
    const m = G('kbMatches().length');
    ok(p + ' — search narrows rather than clears', m > 0 && m < G('kbAll().length'));
    w.eval("kbSetQ('zzzznothing')"); w.App.go('help'); await wait(180);
    ok(p + ' — a search with no hits says so and offers a way out',
       /Nothing matches/.test(w.document.getElementById('main').textContent));
    w.eval("KB.q=''; KB.kind='all'"); w.App.go('help'); await wait(160);
  }
}
head('KNOWLEDGE BASE — the reader is honest about scope and about ratings');
{
  const { w, G } = await load('operator.html');
  w.App = G('App'); w.App.go('help'); await wait(230);

  const id = G('kbAll()[0].id');
  w.eval("kbOpen('" + id + "')"); await wait(210);
  const body = w.document.querySelector('.insp-body');
  ok('an article opens in the inspector', !!body);
  ok('it can open the screen it describes', /Open the screen this is about/.test(body.textContent));
  ok('an unrated article shows no score rather than a flattering default',
     /Not yet rated/.test(body.textContent));
  ok('and says why that is the choice', /flattering default/.test(body.textContent));

  w.eval("kbRate('" + id + "',true)"); await wait(210);
  ok('a rating is counted', G("KB_RATINGS['" + id + "'].up") === 1);
  ok('and reported as a real proportion of real readers',
     /Useful to 100% of 1 reader/.test(w.document.querySelector('.insp-body').textContent));

  /* role scoping: readable by all, actionable by some */
  const gated = G("kbAll().filter(function(a){return a.roles&&a.roles.length})[0].id");
  w.eval("orgUsers('operator').filter(function(u){return u.you})[0].role='OR-READ'"); await wait(80);
  w.eval("kbOpen('" + gated + "')"); await wait(210);
  const b2 = w.document.querySelector('.insp-body');
  ok('a reader whose role cannot act is told so', /Your role cannot do this/.test(b2.textContent));
  ok('and told which role can, rather than left guessing', /It is .+ rather than hunting/.test(b2.textContent.replace(/\s+/g,' ')));
  ok('but the article is still readable', b2.textContent.length > 300);

  /* the failure path is the useful one */
  w.eval("kbTicketFrom('" + id + "')"); await wait(260);
  ok('"this did not help" opens a ticket', !!w.document.getElementById('modalHost'));
  ok('pre-filled with the article it came from',
     /Help article did not answer it/.test((w.document.getElementById('ntSubject')||{}).value||''));
  w.eval('closeModal()'); await wait(110);
}
head('KNOWLEDGE BASE — a walkthrough moves the console, and help follows you');
{
  const { w, G } = await load('operator.html');
  w.App = G('App'); w.App.go('help'); await wait(230);

  const tour = G('kbTours()[0]');
  w.eval("kbStartTour('" + tour.id + "')"); await wait(250);
  ok('a walkthrough opens', !!w.document.getElementById('modalHost'));
  ok('it shows position in the sequence',
     /Step 1 of /.test(w.document.getElementById('modalHost').textContent));
  ok('and navigates to the first stop rather than describing it', G('App.view') === tour.stops[0].view);

  w.eval('kbTourStep(1)'); await wait(240);
  ok('advancing moves the console with it', G('App.view') === tour.stops[1].view);
  w.eval('kbEndTour()'); await wait(160);
  ok('closing leaves you where it left you', G('App.view') === tour.stops[1].view);
  ok('and does not trap you in a dialog', !w.document.getElementById('modalHost'));

  /* contextual help from the top bar */
  const v = G("kbAll().filter(function(a){return a.view && App.findView(a.view)})[0].view");
  w.App.go(v); await wait(190);
  w.eval('App.help()'); await wait(220);
  ok('the top-bar help answers for the screen you are on',
     !!w.document.querySelector('.insp-body') || !!w.document.getElementById('modalHost'));
  w.eval('closeInspector(); closeModal()'); await wait(120);

  /* a screen with no article says so rather than dumping you in a search box */
  const bare = G("(function(){var ids=[];App.cfg.nav.forEach(function(g){g.items.forEach(function(i){if(!kbForView(i.id).length)ids.push(i.id);});});return ids[0]||null;})()");
  if (bare){
    w.App.go(bare); await wait(170);
    w.eval('App.help()'); await wait(220);
    ok('an uncovered screen sends you to the catalogue instead of failing silently',
       G('App.view') === 'help');
  }
}

/* ------------------------------------------ WAREHOUSES AND SHIPMENTS ---- */

console.log('\n' + (failures ? '\u2717 ' + failures + ' of ' + checks + ' checks failed'
                             : '\u2713 all ' + checks + ' operations checks passed'));
process.exit(failures ? 1 : 0);

})();
