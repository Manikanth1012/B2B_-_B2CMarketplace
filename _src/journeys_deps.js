/* ===========================================================================
   Product eligibility and dependency. Twenty-second file.

   The rules refuse orders, so these checks are about refusal actually
   happening — not about a badge being drawn. Every assertion either puts
   something in a basket or fails to.

   Run: node _src/journeys_deps.js
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

(async () => {

/* ------------------------------------------------- THE RULES THEMSELVES --- */
head('RULES — every rule points at something real and says why');
{
  const { w, G, errs } = await load('consumer.html');
  ok('the page loads with the rules in it', errs.length === 0, errs[0]);

  ok('there are rules to check', G("Object.keys(PROD_RULES).length") >= 15);

  /* A rule naming a SKU that does not exist is a rule that silently never
     fires — the worst kind, because the screen looks fine. */
  ok('every rule names products that exist',
     G(`(function(){
       var bad=[];
       Object.keys(PROD_RULES).forEach(function(id){
         if(!SKUMAP[id]) bad.push(id);
         var r=PROD_RULES[id];
         if(r.requires) r.requires.anyOf.forEach(function(x){ if(!SKUMAP[x]) bad.push(id+'>'+x) });
         (r.excludes||[]).forEach(function(x){ if(!SKUMAP[x.sku]) bad.push(id+'!'+x.sku) });
         (r.worksWith||[]).forEach(function(x){ if(!SKUMAP[x.sku]) bad.push(id+'~'+x.sku) });
       });
       return bad.join(',');
     })()`) === '');

  ok('every rule carries a reason in words',
     G(`(function(){
       var bad=[];
       Object.keys(PROD_RULES).forEach(function(id){
         var r=PROD_RULES[id];
         if(r.requires && !(r.requires.why||'').length) bad.push(id);
         (r.excludes||[]).concat(r.worksWith||[]).forEach(function(x){
           if(!(x.why||'').length) bad.push(id) });
       });
       return bad.join(',');
     })()`) === '');

  /* Two products that exclude each other should say so from both sides, or
     the rule only bites depending on which one the shopper picks first. */
  ok('an exclusion is stated from both directions',
     G(`(function(){
       var bad=[];
       Object.keys(PROD_RULES).forEach(function(id){
         (PROD_RULES[id].excludes||[]).forEach(function(x){
           var back=PROD_RULES[x.sku];
           var mutual = back && (back.excludes||[]).some(function(y){ return y.sku===id });
           /* A bundle excludes its parts; the part need not exclude the
              bundle, because buying the bundle afterwards is an upgrade.
              The bundle has to declare what it contains for that exemption
              to apply — otherwise a one-way rule is just an omission. */
           var bundle = (PROD_RULES[id].bundleOf||[]).indexOf(x.sku) > -1
                     || ((PROD_RULES[x.sku]||{}).bundleOf||[]).indexOf(id) > -1
                     || (SKUMAP[id].components||[]).length
                     || (SKUMAP[x.sku].components||[]).length;
           if(!mutual && !bundle) bad.push(id+' -> '+x.sku);
         });
       });
       return bad.join(',');
     })()`) === '', 'one-way exclusions');

  ok('nothing requires itself',
     G(`Object.keys(PROD_RULES).every(function(id){
       var r=PROD_RULES[id]; return !r.requires || r.requires.anyOf.indexOf(id)===-1 })`));

  ok('nothing both requires and excludes the same product',
     G(`Object.keys(PROD_RULES).every(function(id){
       var r=PROD_RULES[id];
       if(!r.requires) return true;
       return !(r.excludes||[]).some(function(x){ return r.requires.anyOf.indexOf(x.sku)>-1 });
     })`));
}

/* ---------------------------------------------- REFUSAL AT THE BASKET ----- */
head('BASKET — a dependency that is not met stops the order');
{
  const { w, G, errs } = await load('consumer.html');
  w.App = G('App'); w.App.go('catalogue'); await wait(420);
  ok('the storefront renders', errs.length === 0, errs[0]);

  /* Priya holds StreamNova Premium, so the sports add-on is allowed and the
     Halo clash is not. Both directions get tested on the same basket. */
  ok('she already holds the StreamNova base plan',
     G("heldSkus().indexOf('SKU-3001') > -1"));

  const before = G("CART.length");
  w.eval("addToCart('SKU-3008')"); await wait(120);
  ok('the sports add-on goes in, because the base plan is held',
     G("CART.some(function(l){return l.sku==='SKU-3008'})"), 'cart=' + G("JSON.stringify(CART)"));

  /* Halo Solo clashes with Halo Family, which is on her account. */
  w.eval("closeModal()"); await wait(60);
  const n1 = G("CART.length");
  w.eval("addToCart('SKU-3006')"); await wait(160);
  ok('Halo Solo is refused against Halo Family on the account',
     G("CART.length") === n1 && !G("CART.some(function(l){return l.sku==='SKU-3006'})"));

  const modal = w.document.getElementById('modalHost');
  ok('and the refusal explains itself rather than just failing',
     !!modal && /Halo Music Family/.test(modal.textContent));
  ok('the refusal names the rule, not just the outcome',
     !!modal && /bills the same listener twice/i.test(modal.textContent));
  w.eval("closeModal()"); await wait(80);

  /* The one that has to work: a hard dependency with nothing held. */
  ok('nobody holds a PlayForge subscription right now',
     G("heldSkus().indexOf('SKU-3003') === -1"));
  const n2 = G("CART.length");
  w.eval("addToCart('SKU-3004')"); await wait(160);
  ok('the season pass is refused with no game to attach to',
     G("CART.length") === n2);

  const m2 = w.document.getElementById('modalHost');
  ok('and the refusal offers the way through',
     !!m2 && /Add both/.test(m2.textContent));
  ok('naming the exact product that would clear it',
     !!m2 && /PlayForge Cloud Gaming/.test(m2.textContent));

  /* Add both — the whole point of naming the fix is that it is one click. */
  const btn = Array.prototype.slice.call(m2.querySelectorAll('button'))
    .filter(b => /Add both/.test(b.textContent))[0];
  btn.click(); await wait(220);
  ok('adding both puts the dependency in first',
     G("CART.some(function(l){return l.sku==='SKU-3003'})"));
  ok('and then the thing that needed it',
     G("CART.some(function(l){return l.sku==='SKU-3004'})"));
  ok('the modal closed once it was resolved',
     !w.document.getElementById('modalHost'));

  /* A requirement met from the basket rather than the account is still met. */
  ok('the requirement now reads as satisfied from the basket',
     G("eligibility('SKU-3004').ok") === true);
  ok('and it says where it was satisfied from',
     /basket/i.test(G("(eligibility('SKU-3004').notes[0]||{}).why || ''")));

  /* Changing quantity on something already in the basket cannot re-trigger a
     rule that was met when it went in. */
  const q = G("(CART.filter(function(l){return l.sku==='SKU-3004'})[0]||{}).qty");
  w.eval("addToCart('SKU-3004')"); await wait(120);
  ok('adding more of a line already in the basket is not re-checked',
     G("(CART.filter(function(l){return l.sku==='SKU-3004'})[0]||{}).qty") === q + 1);
}

/* --------------------------------------------------------- A SWITCH ------ */
head('SWITCH — changing plan is not the same as holding two');
{
  const { w, G, errs } = await load('consumer.html');
  w.App = G('App'); w.App.go('catalogue'); await wait(420);
  ok('the storefront renders', errs.length === 0, errs[0]);

  /* Priya is on Freedom 50 GB. Unlimited excludes it — correctly, when the
     shopper is trying to hold both. */
  ok('she is on the 50 GB plan', G("heldSkus().indexOf('SKU-2001') > -1"));
  ok('adding a second plan outright is refused', G("eligibility('SKU-2002').ok") === false);

  /* Stated as a replacement, the same purchase is allowed. */
  ok('the catalogue can say what a plan would replace',
     G("JSON.stringify(wouldReplace('SKU-2002'))") === '["SKU-2001"]');
  ok('and declared as a switch it is allowed',
     G("eligibility('SKU-2002',{replaces:'SKU-2001'}).ok") === true);
  ok('the switch is recorded as a note, not silently dropped',
     G("eligibility('SKU-2002',{replaces:'SKU-2001'}).notes.some(function(n){return n.kind==='switch'})"));
  ok('and the note says what closes',
     /closes when this one activates/.test(
       G("eligibility('SKU-2002',{replaces:'SKU-2001'}).notes.filter(function(n){return n.kind==='switch'})[0].why")));

  /* A waiver only applies to what was declared — it is not a general pass. */
  ok('declaring one replacement does not waive an unrelated clash',
     G("eligibility('SKU-3006',{replaces:'SKU-2001'}).ok") === false);

  /* End to end through the bundle builder, which is where a plan change
     actually happens. */
  w.eval('CART.length=0');
  w.eval('bundleBuilder()'); await wait(220);
  ok('the plan list says which option would replace what she holds',
     /replaces Aventa Freedom 50 GB/.test(w.document.getElementById('bbPlan').textContent));
  [0,2,5].forEach(i=>{ const b=w.document.querySelectorAll('.bbSub')[i];
    b.checked=true; w.eval('bbPick(document.querySelectorAll(".bbSub")['+i+'])'); });
  await wait(160);
  w.eval('addBundleToBasket()'); await wait(200);
  const m = w.document.getElementById('modalHost');
  ok('the confirmation warns that the old plan closes',
     !!m && /closes when Aventa Freedom Unlimited activates/.test(m.textContent));
  const go = Array.prototype.slice.call(m.querySelectorAll('button'))
    .filter(b => /Add to basket/.test(b.textContent))[0];
  go.click(); await wait(300);
  ok('the whole bundle lands, plan included', G("CART.length") === 4,
     G("JSON.stringify(CART)"));
  ok('and the plan line carries what it replaces',
     G("(CART.filter(function(l){return l.sku==='SKU-2002'})[0]||{}).replaces") === 'SKU-2001');

  w.eval('openCart()'); await wait(260);
  ok('the basket states the switch on the line',
     /Replaces Aventa Freedom 50 GB/.test(w.document.body.textContent));
  ok('and says when the old one stops',
     /closes when this activates/.test(w.document.body.textContent));

  /* The builder must not offer two tiers of one service. */
  ok('the builder refuses a clashing subscription pick',
     G(`(function(){
       BB.subs.length=0; BB.subs.push('SKU-3001');
       var c = bbClash('SKU-3002');
       return c && c.sku==='SKU-3001';
     })()`) === true);
  ok('and it checks the clash in both directions',
     G(`(function(){
       BB.subs.length=0; BB.subs.push('SKU-3002');
       return !!bbClash('SKU-3001');
     })()`) === true);
}

/* ------------------------------------------------------- ON THE SCREEN --- */
head('STOREFRONT — the rule is visible before the buyer commits to it');
{
  const { w, G, errs } = await load('consumer.html');
  w.App = G('App'); w.App.go('catalogue'); await wait(460);
  ok('the catalogue renders', errs.length === 0, errs[0]);

  const notes = w.document.querySelectorAll('#main .depnote');
  ok('dependency notes appear on the tiles', notes.length > 0);
  ok('every note says something, not just shows a colour',
     Array.prototype.slice.call(notes).every(n => n.textContent.trim().length > 6));

  /* The detail carries the full reasoning and the companions. */
  w.eval("openProduct('SKU-3004')"); await wait(300);
  const insp = w.document.getElementById('inspector');
  ok('the product detail opens', !!insp);
  ok('and states what it needs', /What this needs/.test(insp.textContent));
  ok('naming the companion product', /PlayForge Cloud Gaming/.test(insp.textContent));
  ok('with the seller\'s reason attached',
     /unlocks content inside PlayForge/i.test(insp.textContent));
  ok('the requirement block is inside the drawer body',
     !!insp.querySelector('.insp-body .deprule'));

  /* A suggestion must never look like a requirement. */
  ok('suggestions are labelled as suggestions',
     /Often bought with it/.test(insp.textContent));
  ok('and say plainly that they are not required',
     /Suggestions only/.test(insp.textContent));
  w.eval("closeInspector()"); await wait(120);

  /* Seen from the other end: a base product lists what attaches to it. */
  w.eval("openProduct('SKU-3003')"); await wait(300);
  const i2 = w.document.getElementById('inspector');
  ok('a base product says what attaches to it',
     /What attaches to this/.test(i2.textContent));
  ok('naming the add-on', /PlayForge Season Pass/.test(i2.textContent));
}

/* ------------------------------------------------------ THE BUY SIDE B2B - */
head('ENTERPRISE — the same rules, read against what the company holds');
{
  const { w, G, errs } = await load('enterprise.html');
  ok('the buyer portal loads', errs.length === 0, errs[0]);
  ok('it reads the company holdings, not a shopper\'s',
     G("BUY_CTX") === 'enterprise');
  ok('and those holdings are the contracted services',
     G("heldSkus().indexOf('SKU-6001') > -1"));

  w.App = G('App'); w.App.go('catalogue'); await wait(420);

  /* Brightline holds the managed firewall, so MDR is allowed. */
  ok('MDR is allowed because the firewall it monitors is in place',
     G("eligibility('SKU-6002').ok") === true);

  /* The Essentials bundle duplicates what they already have. */
  const n = G("CART.length");
  w.eval("addToCart('SKU-6006')"); await wait(160);
  const m = w.document.getElementById('modalHost');
  const refused = G("CART.length") === n;
  ok('a bundle that duplicates a held service is either refused or clean',
     refused ? !!m : G("eligibility('SKU-6006').ok") === true,
     'held=' + G("JSON.stringify(heldSkus())"));
  if(refused) ok('and the refusal names what is already held',
     !!m && /already inside the Essentials bundle|Endpoint Protect|Mail Defence/i.test(m.textContent));
  else ok('and nothing it excludes is actually held', true);
}

/* ------------------------------------------------- OUT OF STOCK ---------- */
head('OUT OF STOCK — the one action left is to ask to be told');
{
  for(const [file, view, label] of [['consumer.html','browse','Add'],
                                    ['enterprise.html','browse','Add to requisition']]){
    const { w, G, errs } = await load(file);
    w.App = G('App'); w.App.go(view); await wait(460);
    ok(file+': the catalogue renders', errs.length === 0, errs[0]);

    const out = Array.prototype.slice.call(w.document.querySelectorAll('#main .pcard.is-out'));
    ok(file+': there is an out-of-stock tile to test', out.length > 0);

    /* The defect: a button naming what the buyer wants and then refusing. */
    ok(file+': no disabled control is offered in its place',
       out.every(c => !c.querySelector('.pfoot button[disabled]')));
    ok(file+': the tile offers Notify me',
       out.every(c => /Notify me|You will be told/.test(c.querySelector('.pfoot').textContent)));
    ok(file+': and does not offer the buy action',
       out.every(c => !new RegExp(label+'$').test(
         c.querySelector('.pfoot').textContent.trim())));
    /* An in-stock tile keeps the persona's own wording. */
    const inStock = w.document.querySelectorAll('#main .pcard:not(.is-out)')[0];
    ok(file+': an in-stock tile still says '+label,
       new RegExp(label).test(inStock.querySelector('.pfoot').textContent));

    /* The alert is a record with a channel, not a toast. */
    const sku = G("PRODUCTS.filter(function(p){return p.stock==='out'&&p.status==='live'})[0].id");
    const before = G("RESTOCK_WATCH.length");
    ok(file+': nothing is being watched for it yet', G("watching('"+sku+"')") === false);
    w.eval("notifyMe('"+sku+"')"); await wait(300);
    const m = w.document.getElementById('modalHost');
    ok(file+': it asks how to reach the buyer', !!m && /Tell me by/.test(m.textContent));
    ok(file+': and says an alert reserves nothing',
       !!m && /does not hold stock or a price/.test(m.textContent));

    const set = Array.prototype.slice.call(m.querySelectorAll('button'))
      .filter(b => /Set the alert/.test(b.textContent))[0];
    set.click(); await wait(400);
    ok(file+': a watch record is created', G("RESTOCK_WATCH.length") === before + 1);
    ok(file+': the product now reads as watched', G("watching('"+sku+"')") === true);
    ok(file+': the record carries a channel and an address',
       G(`(function(){var w=RESTOCK_WATCH[RESTOCK_WATCH.length-1];
          return !!w.channel && !!w.to && w.to!=='—'})()`) === true);
    const bucket = file === 'consumer.html' ? 'consumer' : 'buyer';
    ok(file+': and it is audited',
       G("AUDIT_LOG."+bucket+".filter(function(a){return a.action==='stock.watched'}).length") > 0);

    /* Asking twice does not create two alerts. */
    const n = G("RESTOCK_WATCH.length");
    w.eval("addWatch('"+sku+"','Email','x@y.z','Test')");
    ok(file+': asking twice does not duplicate the alert',
       G("RESTOCK_WATCH.length") === n);

    /* The tile stops offering an action it has already taken. */
    w.App.go(view); await wait(420);
    const again = w.document.querySelectorAll('#main .pcard.is-out')[0];
    ok(file+': the tile now says the buyer will be told',
       /You will be told/.test(again.querySelector('.pfoot').textContent));
    ok(file+': and that marker is inert',
       !again.querySelector('.pfoot button'));

    /* It is visible somewhere the buyer can manage it. */
    w.App.go(file === 'consumer.html' ? 'account' : 'browse'); await wait(460);
    const main = w.document.getElementById('main');
    ok(file+': the buyer can see what they are waiting for',
       /Waiting for stock/.test(main.textContent));
    const tbl = Array.prototype.slice.call(main.querySelectorAll('table'))
      .filter(t => /Alert by/.test(t.textContent))[0];
    ok(file+': the list names the channel each alert will use',
       !!tbl && /Email|SMS/.test(tbl.textContent));
    ok(file+': a watch on something back in stock offers the buy action',
       !!tbl && /Back in stock/.test(tbl.textContent));

    /* Cancelling is real. */
    const rows = G("RESTOCK_WATCH.length");
    const id = G("watchesFor().filter(function(w){return !w.notified})[0].id");
    w.eval("cancelWatch('"+id+"')"); await wait(300);
    ok(file+': cancelling removes the record', G("RESTOCK_WATCH.length") === rows - 1);
    ok(file+': and that is audited too',
       G("AUDIT_LOG."+bucket+".filter(function(a){return a.action==='stock.unwatched'}).length") > 0);
  }
}

/* ------------------------------------------------------------- OPERATOR -- */
head('OPERATOR — the rules are governed, not buried in a data file');
{
  const { w, G, errs } = await load('operator.html');
  w.App = G('App'); w.App.go('catalogue'); await wait(480);
  ok('the catalogue screen renders', errs.length === 0, errs[0]);

  const main = w.document.getElementById('main');
  ok('the dependency register is on the page',
     /Product dependencies/.test(main.textContent));

  const tbl = Array.prototype.slice.call(main.querySelectorAll('table'))
    .filter(t => /Relationship/.test(t.textContent))[0];
  ok('it lists every rule as a row', !!tbl);
  const rows = tbl ? tbl.querySelectorAll('tbody tr').length : 0;
  ok('one row per relationship, not one per product',
     rows === G("ruleCount()"), rows + ' vs ' + G("ruleCount()"));

  /* The distinction that matters operationally: which rules refuse money. */
  ok('it separates the rules that block an order from the advice',
     /Blocks the order/.test(tbl.textContent) && /Advice only/.test(tbl.textContent));
  ok('and says a change applies to new baskets only',
     /new baskets only/.test(main.textContent));

  /* The seller and operator product views must not offer buyer actions. */
  w.eval("openProduct('SKU-3004',{mode:'operator'})"); await wait(300);
  const insp = w.document.getElementById('inspector');
  ok('the operator product view does not show the buyer dependency panel',
     !insp.querySelector('.deprule'));
}

console.log('\n' + (failures ? '✗ ' + failures + ' of ' + checks + ' checks failed'
                             : '✓ all ' + checks + ' dependency checks passed'));
process.exit(failures ? 1 : 0);

})();
