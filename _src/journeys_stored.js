/* ===========================================================================
   Operator roles, stored value, and media view/download. Twentieth file.
   Run: node _src/journeys_stored.js
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
function confirmDialog(w){
  const m = w.document.getElementById('modalHost');
  if (!m) return false;
  const go = m.querySelector('#cfmGo');
  if (!go || go.disabled) return false;
  go.click();
  return true;
}
const set = (w, id, v) => { const e = w.document.getElementById(id); if (e) { e.value = v; return true; } return false; };

(async () => {

/* ------------------------------------------------------------------ ROLES */
head('ROLES — the operator has a role for every job the console can do');
{
  const { w, G, errs } = await load('operator.html');
  w.App = G('App'); w.App.go('roles'); await wait(480);
  ok('the roles screen renders', errs.length === 0, errs[0]);

  const roles = G('ORG_ROLES.operator');
  ok('there are roles for the operational jobs, not just the commercial ones',
     roles.length >= 12, String(roles.length));
  ['OR-WH','OR-TKT','OR-COL','OR-TAX','OR-MKT','OR-SEC','OR-INT'].forEach(id => {
    ok('there is a ' + id + ' role', roles.some(r => r.id === id));
  });

  /* A grid that is not rectangular silently mis-reads every permission after
     the short row. */
  ok('every capability row has a cell for every role',
     G("PERM_GRID.operator.every(function(r){return r.length===ORG_ROLES.operator.length+1})"));
  ok('the matrix covers the screens that exist, not just the original six',
     G('PERM_GRID.operator.length') >= 28);
  ['Adjust stock on hand','Answer and escalate a ticket','Act on an arrears case',
   'Record a tax residency certificate','Change a reward earn rule',
   'Register or retire a partner API','See a settlement account in full'].forEach(cap => {
    ok('the matrix governs "' + cap + '"',
       G("PERM_GRID.operator.some(function(r){return r[0]===" + JSON.stringify(cap) + "})"));
  });

  /* A role nobody can read the log for is a role whose actions vanish. */
  ok('every role has an audit scope',
     G("ORG_ROLES.operator.every(function(r){return !!AUDIT_SCOPE.operator[r.id]})"));
  ok('and every role has somebody in it',
     G("ORG_ROLES.operator.every(function(r){return roleUsers('operator',r.id).length>0})"));
  ok('two people hold the security role, because one is a single point of failure',
     G("roleUsers('operator','OR-SEC').length") >= 2);

  /* Separation that matters: the desk that answers a ticket is not the desk
     that reroutes an order or moves money. */
  const capRow = n => G("PERM_GRID.operator.filter(function(r){return r[0]===" +
    JSON.stringify(n) + "})[0]");
  const col = id => G("ORG_ROLES.operator.map(function(r){return r.id}).indexOf('" + id + "')") + 1;
  ok('the support desk cannot intervene in fulfilment',
     capRow('Intervene on a failed order')[col('OR-TKT')] === 0);
  ok('nor approve a settlement run',
     capRow('Approve a settlement run')[col('OR-TKT')] === 0);
  ok('the warehouse role cannot approve money',
     capRow('Approve a settlement run')[col('OR-WH')] === 0);
  ok('but it can change routing, which is its job',
     capRow('Change fulfilment routing')[col('OR-WH')] === 2);
  ok('only the admin and finance can see a settlement account in full',
     capRow('See a settlement account in full').slice(1)
       .filter(function(v){ return v === 2; }).length === 2);
  ok('managing users is held by two roles at most',
     capRow('Manage operator users and roles').slice(1)
       .filter(function(v){ return v === 2; }).length <= 2);
  ok('read-only can do exactly nothing but read',
     capRow('Invite and suspend partners')[col('OR-READ')] === 0 &&
     capRow('View everything')[col('OR-READ')] === 2);

  /* A dozen columns is wider than a screen, so the label has to stay put. */
  const grid = w.document.querySelector('#main table.permgrid');
  ok('the matrix is drawn', !!grid);
  ok('and the capability column is pinned so the rows stay readable',
     !!grid && grid.querySelectorAll('td.pinned').length === G('PERM_GRID.operator.length'));
  ok('the reader is told it scrolls', /scroll sideways/.test(w.document.getElementById('main').textContent));
}

/* ---------------------------------------------------------------- WALLETS */
head('WALLETS — stored value is somebody else’s money, and the operator can see it');
{
  const { w, G, errs } = await load('operator.html');
  w.App = G('App'); w.App.go('wallets'); await wait(520);
  const txt = w.document.getElementById('main').textContent.replace(/\s+/g, ' ');
  ok('the operator has a wallet screen at all', errs.length === 0 && /wallet/i.test(txt), errs[0]);

  const L = G('walletLiability()');
  ok('the liability is the sum of the balances',
     Math.abs(L.total - G('WALLETS.reduce(function(a,x){return a+x.balance},0)')) < 0.005);
  ok('and it is split by whose money it is',
     Math.abs(L.cash + L.promo - L.total) < 0.005 && L.cash > 0 && L.promo > 0);
  ok('the screen says a balance is never income', /never income/.test(txt));
  ok('it says which part is refundable', /refundable on request/i.test(txt));
  ok('and which part is not', /not refundable/i.test(txt));
  ok('dormancy is a real state, not a note', L.dormant >= 1);
  ok('and the screen refuses to call a dormant balance income',
     /never absorbed as income|not absorbed as income/i.test(txt));

  /* It posts like everything else. */
  ok('wallet movements reach the general ledger',
     G("GL_POSTINGS.filter(function(p){return /^wallet\\./.test(p.charge)}).length") > 0);
  ok('a top-up is a liability, not revenue',
     G("GL_MAPPING['wallet.topup'].cr") === '2050');
  ok('and the mapping says why in full',
     G("GL_MAPPING['wallet.topup'].why").length > 60);
  ok('goodwill credit is marketing spend the moment it is issued',
     G("GL_MAPPING['wallet.goodwill'].dr") === '6020');

  /* Returning a balance returns only what was theirs. */
  const wid = G("WALLETS.filter(function(x){return x.cash>0 && x.promo>0})[0].id");
  const promo = G("WALMAP['" + wid + "'].promo");
  w.eval("returnWallet('" + wid + "')"); await wait(240);
  ok('returning a balance warns that issued credit does not go back',
     /never their money/.test(w.document.getElementById('modalHost').textContent));
  confirmDialog(w); await wait(280);
  ok('the holder’s money leaves', G("WALMAP['" + wid + "'].cash") === 0);
  ok('the credit we issued stays', Math.abs(G("WALMAP['" + wid + "'].balance") - promo) < 0.005);
  ok('and a movement records it',
     G("WALLET_LEDGER[0].source") === 'refundout' && G('WALLET_LEDGER[0].amount') < 0);
  ok('it is audited at high severity',
     G("auditRows('operator').some(function(e){return e.action==='wallet.adjusted' && e.sev==='high'})"));

  /* Adjusting has to say which pot, or promotional credit gets refunded as cash. */
  const w2 = G("WALLETS.filter(function(x){return x.state==='active'})[0].id");
  const b0 = G("WALMAP['" + w2 + "'].balance");
  w.eval("adjustWallet('" + w2 + "')"); await wait(240);
  ok('the adjustment asks which pot',
     !!w.document.getElementById('awPot'));
  ok('and says why that matters',
     /refunded as cash/.test(w.document.getElementById('modalHost').textContent));
  confirmDialog(w); await wait(160);
  ok('an adjustment with no reason is refused',
     Math.abs(G("WALMAP['" + w2 + "'].balance") - b0) < 0.005);
  set(w, 'awAmt', '99999');
  set(w, 'awWhy', 'Testing the ceiling.');
  confirmDialog(w); await wait(160);
  ok('and one past the ceiling is refused, with the reason for the ceiling',
     /somebody else’s money sitting on our books/.test(
       (w.document.getElementById('cfmErr') || {textContent:''}).textContent));
  set(w, 'awAmt', '10');
  confirmDialog(w); await wait(300);
  ok('a sound adjustment lands', Math.abs(G("WALMAP['" + w2 + "'].balance") - (b0 + 10)) < 0.005);
}

head('WALLETS — the customer and the operator are looking at one balance');
{
  const { G } = await load('consumer.html');
  ok('the shopper balance comes from the same record',
     G('SHOPPER.wallet') === G('WALMAP[SHOPPER.id].balance'));
  ok('and so does their statement',
     G('MY_WALLET_LOG.length') ===
     G("WALLET_LEDGER.filter(function(t){return t.wallet===WALMAP[SHOPPER.id].id}).length"));
  ok('every line in it has a real amount',
     G("MY_WALLET_LOG.every(function(l){return typeof l.amount==='number' && !!l.what})"));
}

head('WALLETS — the policy cannot be set to something incoherent');
{
  const { w, G } = await load('operator.html');
  w.App = G('App'); w.App.go('wallets'); await wait(480);
  w.eval('walletPolicyDialog()'); await wait(240);
  ok('the policy dialog opens', !!w.document.getElementById('modalHost'));
  ok('it says why the ceiling exists at all',
     /unlicensed deposit-taker/.test(w.document.getElementById('modalHost').textContent));

  const max0 = G('WALLET_POLICY.maxBalance');
  set(w, 'wpMin', '5000'); set(w, 'wpMax', '100');
  w.eval('saveWalletPolicy()'); await wait(160);
  ok('a minimum top-up above the ceiling is refused',
     G('WALLET_POLICY.maxBalance') === max0 &&
     /Nobody could top up/.test(w.document.getElementById('wpOut').textContent));

  set(w, 'wpMin', '5'); set(w, 'wpMax', '3000'); set(w, 'wpDorm', '2');
  w.eval('saveWalletPolicy()'); await wait(160);
  ok('a dormancy window under six months is refused',
     G('WALLET_POLICY.maxBalance') === max0 &&
     /between purchases/.test(w.document.getElementById('wpOut').textContent));

  set(w, 'wpDorm', '18');
  w.eval('saveWalletPolicy()'); await wait(280);
  ok('a coherent policy saves', G('WALLET_POLICY.maxBalance') === 3000);
  ok('and it is audited',
     G("auditRows('operator').some(function(e){return e.action==='wallet.policy'})"));
}

/* ------------------------------------------------------------------ MEDIA */
head('MEDIA — every item can be opened and taken away');
{
  const { w, G, errs } = await load('consumer.html');
  w.URL.createObjectURL = () => 'blob:x';
  w.URL.revokeObjectURL = () => {};
  const sku = G("PRODUCTS.filter(function(p){return (PRODUCT_MEDIA[p.id]||[]).length>2})[0].id");
  w.eval("openProduct('" + sku + "')"); await wait(420);
  const ins = w.document.getElementById('inspector');
  ok('the product opens', errs.length === 0 && !!ins, errs[0]);

  const items = ins.querySelectorAll('.mediaitem');
  ok('the media list is drawn', items.length > 2);
  ok('every item offers a view',
     Array.prototype.filter.call(ins.querySelectorAll('.mediaacts button'),
       b => /viewMedia/.test(b.getAttribute('onclick') || '')).length === items.length);
  ok('and every item offers a download',
     Array.prototype.filter.call(ins.querySelectorAll('.mediaacts button'),
       b => /downloadMedia/.test(b.getAttribute('onclick') || '')).length === items.length);
  ok('an image thumbnail is the artwork, not a category glyph',
     ins.querySelectorAll('.mthumb.has-art .partsvg').length > 0);

  const mid = G("PRODUCT_MEDIA['" + sku + "'][0].id");
  w.eval("viewMedia('" + mid + "','" + sku + "')"); await wait(280);
  const m = w.document.getElementById('modalHost');
  ok('viewing shows the item, not just its name', !!m && !!m.querySelector('.mediastage .partsvg'));
  ok('with the metadata beside it', /Dimensions/.test(m.textContent) && /Description/.test(m.textContent));
  w.eval('closeModal()'); await wait(120);

  /* A video's clip is not held here, and the screen says so instead of
     offering an empty file. */
  const vid = G("(PRODUCT_MEDIA['" + sku + "'].filter(function(x){return x.kind==='video'})[0]||{}).id");
  if (vid) {
    w.eval("viewMedia('" + vid + "','" + sku + "')"); await wait(260);
    const mv = w.document.getElementById('modalHost');
    ok('a video says what is actually held', /still the catalogue uses/.test(mv.textContent));
    ok('and offers that rather than an empty clip', /Download the still/.test(mv.textContent));
    w.eval('closeModal()'); await wait(120);
  }

  /* The download is a real file. */
  const orig = w.document.createElement.bind(w.document);
  w.eval('window.__dl=null');
  w.document.createElement = t => {
    const el = orig(t);
    if (t === 'a') el.click = function(){ w.__dl = el.download; };
    return el;
  };
  w.eval("downloadMedia('" + mid + "','" + sku + "')"); await wait(260);
  ok('downloading an image writes a real file', /\.svg$/.test(G('window.__dl') || ''));
  ok('named after the item', /aventa|kestrel|nimbus|volta|sentinel|playforge|halo|clearvault|iot|travel|lumen|trackwise|vertex|aegis|smb|fleet|cold|white|partner/i
     .test(G('window.__dl') || ''), G('window.__dl'));
  /* A shopper taking a copy of a public catalogue image is not an auditable
     event. Inside a console it is, because there the media belongs to a seller. */
  ok('a shopper’s download is not logged as a governance event',
     !G("auditRows('consumer').some(function(e){return /Downloaded from the listing media/.test(e.detail||'')})"));
}

head('MEDIA — inside a console the same download is recorded');
{
  const { w, G } = await load('partner.html');
  w.URL.createObjectURL = () => 'blob:x';
  w.URL.revokeObjectURL = () => {};
  w.App = G('App'); w.App.go('listings'); await wait(360);
  const sku = G("MY_LIST.filter(function(p){return (PRODUCT_MEDIA[p.id]||[]).length})[0].id");
  const mid = G("PRODUCT_MEDIA['" + sku + "'][0].id");
  const orig2 = w.document.createElement.bind(w.document);
  w.document.createElement = t => {
    const el = orig2(t);
    if (t === 'a') el.click = function(){};
    return el;
  };
  w.eval("downloadMedia('" + mid + "','" + sku + "')"); await wait(260);
  ok('a seller downloading their own media is recorded',
     G("auditRows('partner').some(function(e){return /Downloaded from the listing media/.test(e.detail||'')})"));
}

head('CATALOGUE — an out-of-stock tile recedes, and says why');
{
  const { w, G, errs } = await load('consumer.html');
  w.App = G('App'); w.App.go('browse'); await wait(480);
  const m = w.document.getElementById('main');
  ok('the storefront renders', errs.length === 0, errs[0]);

  const outN = G("shopCatalogue().filter(function(p){return p.stock==='out'}).length");
  ok('the catalogue has something out of stock to show', outN > 0);
  ok('every out-of-stock tile is dimmed',
     m.querySelectorAll('.pcard.is-out').length === outN);
  ok('and no in-stock tile is', m.querySelectorAll('.pcard.is-out').length ===
     Array.prototype.filter.call(m.querySelectorAll('.pcard'),
       c => /Out of stock/.test(c.textContent)).length);

  const c = m.querySelector('.pcard.is-out');
  /* The contract is that state is never carried by colour alone. */
  ok('it says so in words, not only in grey', !!c && /Out of stock/.test(c.textContent));
  ok('a screen reader is told before the name', !!c &&
     /out of stock/.test(c.getAttribute('aria-label') || ''));
  /* The buy action is gone, but what replaces it is live. A disabled button
     labelled Notify me named the thing the buyer wanted and then refused to
     do it, which is worse than offering nothing. */
  ok('the buy action is not offered',
     !!c && !/>\s*Add\s*</.test(c.querySelector('.pfoot').innerHTML));
  ok('what replaces it is a working control, not a greyed-out one',
     !!c && !c.querySelector('.pfoot .btn[disabled]'));
  ok('the button says what it does instead', !!c && /Notify me/.test(c.textContent));
  ok('and pressing it does something',
     !!c && /notifyMe\(/.test(c.querySelector('.pfoot').innerHTML));

  /* Where the record knows when it is coming back, the tile says. */
  ok('a back-ordered line states when it is due, if the record knows',
     G("(function(){var s=PRODUCTS.filter(function(p){return p.stock==='out'})[0];" +
       "var e=invEta(s.id); return e===null || /due/.test(e)})()") === true);
}

console.log('\n' + (failures ? '✗ ' + failures + ' of ' + checks + ' checks failed'
                             : '✓ all ' + checks + ' roles, wallet, media and catalogue checks passed'));
process.exit(failures ? 1 : 0);

})();
