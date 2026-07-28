/* ===========================================================================
   Administration and presentation journey tests. Split from journeys.js when the
   combined suite outgrew the shell's 45-second budget.
   These do not check that a screen rendered — they drive each journey to its
   conclusion and assert that the underlying records actually changed.
   Run: node _src/journeys_admin.js
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
head('ADMINISTRATION — every persona can manage users, roles and notifications');
{
  const cases = [
    ['operator.html',   'operator', 'users',         'notifications'],
    ['partner.html',    'partner',  'team',          'notifications'],
    ['enterprise.html', 'buyer',    'users',         'notifications'],
    ['consumer.html',   'consumer', 'access',        'notifications']
  ];
  for (const [file, ctx, userView, notifView] of cases){
    const { w, G } = await load(file);
    w.App = G('App');

    /* --- the screens exist and are reachable from the rail --- */
    const navIds = Array.from(w.document.querySelectorAll('.nav-item')).map(b => b.id.replace('nav_',''));
    ok(file + ' — has a users and roles screen in the rail', navIds.indexOf(userView) > -1);
    ok(file + ' — has a notifications screen in the rail', navIds.indexOf(notifView) > -1);

    w.App.go(userView); await wait(105);
    const main = () => w.document.getElementById('main').textContent;
    ok(file + ' — the roles table lists every role',
       G("orgRoles('"+ctx+"').every(function(r){return document.getElementById('main').textContent.indexOf(r.name)>-1})"));
    /* the capability grid lives on its own configuration screen now */
    w.App.go('roles'); await wait(105);
    ok(file + ' — the permission grid renders a row per capability',
       G("PERM_GRID['"+ctx+"'].length") > 0 &&
       G("PERM_GRID['"+ctx+"'].every(function(r){return document.getElementById('main').textContent.indexOf(r[0])>-1})"));
    w.App.go(userView); await wait(105);

    /* --- inviting a user --- */
    const before = G("orgUsers('"+ctx+"').length");
    w.eval("inviteOrgUserDialog('"+ctx+"')"); await wait(105);
    w.eval('submitOrgInvite("'+ctx+'")'); await wait(105);
    ok(file + ' — an invite with no details is refused', G("orgUsers('"+ctx+"').length") === before);
    ok(file + ' — the email error is shown', w.document.getElementById('iuEmailErr').hidden === false);

    w.document.getElementById('iuName').value  = 'Test Person';
    w.document.getElementById('iuEmail').value = 'test.person@example.com';
    const roleSel = w.document.getElementById('iuRole');
    const targetRole = roleSel.options[roleSel.options.length - 1].value;
    roleSel.value = targetRole;
    w.eval('submitOrgInvite("'+ctx+'")'); await wait(105);
    ok(file + ' — a valid invite creates a user', G("orgUsers('"+ctx+"').length") === before + 1);
    const nu = "orgUsers('"+ctx+"')[orgUsers('"+ctx+"').length-1]";
    ok(file + ' — the new user is invited, not active', G(nu + '.status') === 'invited');
    ok(file + ' — the chosen role is applied', G(nu + '.role') === targetRole);
    /* With a full directory a new invitee lands on whichever page their name
       falls on, so the screen names them above the table instead of leaving
       them to be hunted for. */
    ok(file + ' — the screen names who was just invited', /Test Person/.test(main()));
    ok(file + ' — and says where the link went', /test\.person@example\.com/.test(main()));
    ok(file + ' — the role filter can reach every role',
       G("(function(){var t=_dt['dtOrgUsers_"+ctx+"'];" +
         "return (t.cfg.chips||[]).some(function(c){return c.key==='role' && " +
         "c.options.length===orgRoles('"+ctx+"').length})})()") === true);

    /* --- changing a role --- */
    const id = G(nu + '.id');
    const otherRole = G("orgRoles('"+ctx+"').filter(function(r){return r.id!=='"+targetRole+"'})[0].id");
    w.eval("changeRoleDialog('"+ctx+"','"+id+"')"); await wait(105);
    const sel = w.document.getElementById('crRole');
    ok(file + ' — the role dialog offers every role', sel && sel.options.length === G("orgRoles('"+ctx+"').length"));
    sel.value = otherRole;
    confirmDialog(w); await wait(105);
    ok(file + ' — the role actually changes',
       G("orgUsers('"+ctx+"').find(function(u){return u.id==='"+id+"'}).role") === otherRole);

    /* --- removing a user needs the confirmation word --- */
    w.eval("removeOrgUserDialog('"+ctx+"','"+id+"')"); await wait(105);
    const go = w.document.querySelector('#cfmGo');
    ok(file + ' — removal starts disabled', go && go.disabled);
    confirmDialog(w, 'REMOVE'); await wait(105);
    ok(file + ' — the user is removed',
       G("orgUsers('"+ctx+"').find(function(u){return u.id==='"+id+"'}).status") === 'removed');
    ok(file + ' — and drops out of the directory', !/Test Person/.test(main()));

    /* --- you cannot remove yourself --- */
    const me = G("(orgUsers('"+ctx+"').filter(function(u){return u.you})[0]||{}).id");
    if (me){
      w.eval("openOrgUser('"+ctx+"','"+me+"')"); await wait(105);
      const footText = w.document.querySelector('#inspector .insp-foot').textContent;
      ok(file + ' — your own account offers no remove action', /cannot remove yourself/i.test(footText));
      w.eval('closeInspector()');
    }

    /* --- notification rules --- */
    w.App.go(notifView); await wait(105);
    ok(file + ' — every rule is listed',
       G("NOTIF_RULES['"+ctx+"'].every(function(r){return document.getElementById('main').textContent.indexOf(r.name)>-1})"));
    const ruleId = G("NOTIF_RULES['"+ctx+"'][0].id");
    const was = G("NOTIF_RULES['"+ctx+"'][0].on");
    w.eval("toggleNotifRule('"+ctx+"','"+ruleId+"',"+(!was)+")"); await wait(80);
    ok(file + ' — a rule toggle changes state',
       G("NOTIF_RULES['"+ctx+"'].find(function(r){return r.id==='"+ruleId+"'}).on") === !was);
    w.eval("setNotifPref('"+ctx+"','digest','Weekly digest, Monday 08:00')"); await wait(60);
    ok(file + ' — a delivery preference persists', G("NOTIF_PREFS['"+ctx+"'].digest") === 'Weekly digest, Monday 08:00');
  }
}

head('ADMINISTRATION — the consumer account carries spend caps');
{
  const { w, G } = await load('consumer.html');
  w.App = G('App'); w.App.go('access'); await wait(105);
  ok('household members have caps', G("orgUsers('consumer').some(function(u){return u.cap!=null})"));
  const capped = G("orgUsers('consumer').filter(function(u){return u.cap && !u.you})[0].id");
  w.eval("setSpendCapDialog('consumer','"+capped+"')"); await wait(105);
  const sel = w.document.getElementById('scCap');
  ok('the cap dialog offers a no-purchase option', !!sel && Array.from(sel.options).some(o => o.value === '0'));
  sel.value = '60';
  confirmDialog(w); await wait(105);
  ok('the cap is applied', G("orgUsers('consumer').find(function(u){return u.id==='"+capped+"'}).cap") === 60);
}

/* --------------------------------------------------- CONSUMER MY DETAILS */
head('CONSUMER — every control on My details does something');
{
  const { w, G } = await load('consumer.html');
  w.App = G('App'); w.App.go('account'); await wait(105);
  const main = () => w.document.getElementById('main').textContent;
  const set = (id,v)=>{ const e=w.document.getElementById(id); e.value=v; };

  /* profile */
  set('acName',''); w.eval('saveProfile()'); await wait(105);
  ok('saving with an empty name is refused', w.document.getElementById('acNameErr').hidden === false);
  set('acName','Priya R Raman'); set('acMail','not-an-email'); w.eval('saveProfile()'); await wait(105);
  ok('a malformed email is refused', w.document.getElementById('acMailErr').hidden === false);
  set('acMail','priya.r@example.com'); w.eval('saveProfile()'); await wait(105);
  ok('the profile saves', G('SHOPPER.name') === 'Priya R Raman' && G('SHOPPER.email') === 'priya.r@example.com');
  ok('the header picks up the new name', /Priya R Raman/.test(w.document.querySelector('.persona-name').textContent));

  /* preferences */
  const wasOffers = G('MY_PREFS.offers');
  w.eval("setPref('offers'," + (!wasOffers) + ")"); await wait(60);
  ok('a preference toggle persists', G('MY_PREFS.offers') === !wasOffers);

  /* payment methods */
  const payBefore = G('MY_PAYMENTS.length');
  w.eval('addCard()'); await wait(105);
  w.eval('submitCard()'); await wait(105);
  ok('an empty card is refused', G('MY_PAYMENTS.length') === payBefore);
  ok('the card-number error shows', w.document.getElementById('pcNumErr').hidden === false);
  set('pcNum','4111111111111111'); set('pcExp','01/24'); set('pcCvc','12');
  w.eval('submitCard()'); await wait(105);
  ok('an expired date is refused', w.document.getElementById('pcExpErr').hidden === false);
  ok('a short security code is refused', w.document.getElementById('pcCvcErr').hidden === false);
  set('pcExp','11/29'); set('pcCvc','123');
  w.document.getElementById('pcDef').checked = true;
  w.eval('submitCard()'); await wait(105);
  ok('a valid card is added', G('MY_PAYMENTS.length') === payBefore + 1);
  ok('only the last four digits are kept', /1111/.test(G('MY_PAYMENTS[MY_PAYMENTS.length-1].detail')) &&
     !/4111111111111111/.test(JSON.stringify(G('MY_PAYMENTS'))));
  ok('it became the default', G('MY_PAYMENTS[MY_PAYMENTS.length-1].primary') === true);
  ok('only one method is the default', G('MY_PAYMENTS.filter(function(m){return m.primary}).length') === 1);
  ok('the new card appears on screen', /1111/.test(main()));

  const newId = G('MY_PAYMENTS[MY_PAYMENTS.length-1].id');
  const other = G("MY_PAYMENTS.filter(function(m){return m.id!=='"+newId+"' && m.status==='active'})[0].id");
  w.eval("makePrimary('"+other+"')"); await wait(105);
  ok('changing the default moves it', G("MY_PAYMENTS.find(function(m){return m.id==='"+other+"'}).primary") === true);
  ok('the previous default is cleared', G("MY_PAYMENTS.find(function(m){return m.id==='"+newId+"'}).primary") === false);

  w.eval("removePayment('"+newId+"')"); await wait(105);
  confirmDialog(w); await wait(105);
  ok('a card can be removed', G("MY_PAYMENTS.filter(function(m){return m.id==='"+newId+"'}).length") === 0);

  /* wallet and points */
  const wal = G('SHOPPER.wallet'), logLen = G('MY_WALLET_LOG.length');
  w.eval('topUpWallet()'); await wait(105);
  const amt = w.document.getElementById('twAmt'); amt.value = '50';
  confirmDialog(w); await wait(105);
  ok('a wallet top-up credits the balance', G('SHOPPER.wallet') === +(wal + 50).toFixed(2));
  ok('and is written to the wallet history', G('MY_WALLET_LOG.length') === logLen + 1);

  const pts = G('SHOPPER.points'), wal2 = G('SHOPPER.wallet');
  w.eval('redeemPoints()'); await wait(105);
  confirmDialog(w); await wait(105);
  ok('points redeem into wallet credit', G('SHOPPER.wallet') === +(wal2 + pts/100).toFixed(2));
  ok('and the points balance resets', G('SHOPPER.points') === 0);
  w.eval('redeemPoints()'); await wait(105);
  ok('redeeming with no points is refused', !w.document.getElementById('modalHost'));

  /* addresses */
  const adrBefore = G('MY_ADDRESSES.length');
  w.eval('editAddress()'); await wait(105);
  w.eval('saveAddress(null)'); await wait(105);
  ok('an address with no detail is refused', G('MY_ADDRESSES.length') === adrBefore);
  ok('the PIN error shows', w.document.getElementById('adPinErr').hidden === false);
  set('adLabel',"Mum's place"); set('adLine','7 Church Street'); set('adPin','12345');
  w.eval('saveAddress(null)'); await wait(105);
  ok('a five-digit PIN is refused', G('MY_ADDRESSES.length') === adrBefore);
  set('adPin','560025'); w.document.getElementById('adDef').checked = true;
  w.eval('saveAddress(null)'); await wait(105);
  ok('a valid address is added', G('MY_ADDRESSES.length') === adrBefore + 1);
  ok('it became the default', G('MY_ADDRESSES[MY_ADDRESSES.length-1].default') === true);
  ok('only one address is the default', G('MY_ADDRESSES.filter(function(a){return a.default}).length') === 1);
  ok('it appears on screen', /Mum/.test(main()));

  const aid = G('MY_ADDRESSES[MY_ADDRESSES.length-1].id');
  w.eval("editAddress('"+aid+"')"); await wait(105);
  ok('editing pre-fills the existing values', w.document.getElementById('adLine').value === '7 Church Street');
  set('adLabel','Family home'); w.eval("saveAddress('"+aid+"')"); await wait(105);
  ok('the edit is saved', G("MY_ADDRESSES.find(function(a){return a.id==='"+aid+"'}).label") === 'Family home');

  const firstOther = G("MY_ADDRESSES.filter(function(a){return a.id!=='"+aid+"'})[0].id");
  w.eval("makeDefaultAddress('"+firstOther+"')"); await wait(105);
  ok('the default address can be moved', G("MY_ADDRESSES.find(function(a){return a.id==='"+firstOther+"'}).default") === true);

  w.eval("deleteAddress('"+aid+"')"); await wait(105);
  confirmDialog(w); await wait(105);
  ok('an address can be deleted', G("MY_ADDRESSES.filter(function(a){return a.id==='"+aid+"'}).length") === 0);
  ok('a default always survives', G('MY_ADDRESSES.filter(function(a){return a.default}).length') === 1);

  /* saved items */
  const savedBefore = G('MY_SAVED.length');
  w.eval("saveItem('SKU-4002')"); await wait(80);
  ok('an item can be saved', G('MY_SAVED.length') === savedBefore + 1);
  w.eval("saveItem('SKU-4002')"); await wait(80);
  ok('saving the same item twice does not duplicate it', G('MY_SAVED.length') === savedBefore + 1);
  w.eval("unsaveItem('SKU-4002')"); await wait(105);
  ok('a saved item can be removed', G('MY_SAVED.length') === savedBefore);

  /* privacy */
  const dsr = G('MY_DATA_REQUESTS.length');
  w.eval('requestMyData()'); await wait(105);
  confirmDialog(w); await wait(105);
  ok('a data request is recorded with a due date', G('MY_DATA_REQUESTS.length') === dsr + 1 &&
     !!G('MY_DATA_REQUESTS[0].due'));

  w.eval('closeAccount()'); await wait(105);
  const go = w.document.querySelector('#cfmGo');
  ok('closing the account starts disabled', go && go.disabled);
  confirmDialog(w, 'CLOSE'); await wait(105);
  ok('closure is scheduled, not immediate', G('MY_CLOSURE.requested') === true && !!G('MY_CLOSURE.effective'));
  ok('the screen warns about it', /scheduled to close/.test(main()));
  w.eval('cancelClosure()'); await wait(105);
  ok('closure can be stopped', G('MY_CLOSURE.requested') === false);
}

head('CONSUMER — storefront tools are real, not placeholders');
{
  const { w, G } = await load('consumer.html');
  w.App = G('App');

  /* coverage */
  w.eval('coverageCheck()'); await wait(105);
  w.document.getElementById('cvPin').value = '99';
  w.eval('runCoverage()'); await wait(100);
  ok('a short PIN is refused', w.document.getElementById('cvErr').hidden === false);
  w.document.getElementById('cvPin').value = '560017';
  w.eval('runCoverage()'); await wait(105);
  ok('a known PIN returns a survey', /HAL Old Airport Road/.test(w.document.getElementById('cvResult').textContent));
  w.document.getElementById('cvPin').value = '682001';
  w.eval('runCoverage()'); await wait(105);
  ok('an unsurveyed network says so rather than guessing',
     /Not surveyed/.test(w.document.getElementById('cvResult').textContent));
  w.document.getElementById('cvPin').value = '999999';
  w.eval('runCoverage()'); await wait(105);
  ok('an unknown PIN admits it has no data',
     /No survey data/.test(w.document.getElementById('cvResult').textContent));
  w.eval('closeModal()');

  /* trade-in */
  ok('trade-in credit starts at zero', G('TRADEIN_CREDIT') === 0);
  w.eval('tradeInDialog()'); await wait(105);
  ok('a quote appears immediately', /Quoted value/.test(w.document.getElementById('tiQuote').textContent));
  const goodQuote = G('tradeInValue().value');
  w.document.querySelector('input[name="tiCond"][value="poor"]').checked = true;
  w.eval('quoteTradeIn()'); await wait(100);
  ok('a worse condition quotes less', G('tradeInValue().value') < goodQuote);
  w.eval('acceptTradeIn()'); await wait(105);
  confirmDialog(w); await wait(105);
  ok('accepting records the credit', G('TRADEIN_CREDIT') > 0);
  w.eval("addToCart('SKU-4001')"); await wait(80);
  ok('the credit comes off the basket total', G('cartTotals().credit') > 0);
  /* Prices are tax-inclusive by configuration, so the credit comes off the
     gross — adding tax on top of an inclusive price would double-count it. */
  ok('and reduces what is due today',
     G('cartTotals().dueNow') === +(G('cartTotals().gross') - G('cartTotals().credit')).toFixed(2),
     G('cartTotals().dueNow') + ' vs ' + (G('cartTotals().gross') - G('cartTotals().credit')));
  /* Promotions come off before tax, so gross is the shelf value less whatever
     the engine gave — never the shelf value plus tax on top of it. */
  ok('tax is not added on top of a tax-inclusive shelf price',
     Math.abs(G('cartTotals().gross') - (G('cartTotals().once') - G('cartTotals().promoOnce'))) < 0.02,
     G('cartTotals().gross') + ' vs ' + (G('cartTotals().once') - G('cartTotals().promoOnce')));
  w.eval('CART.length=0');

  /* bundle builder */
  w.eval('bundleBuilder()'); await wait(105);
  ok('the builder opens with a plan chosen', !!w.document.getElementById('bbPlan').value);
  w.eval('addBundleToBasket()'); await wait(105);
  ok('a bundle with no subscriptions is refused', G('CART.length') === 0);
  const boxes = Array.from(w.document.querySelectorAll('.bbSub'));
  const pick = i => { boxes[i].checked = true;
    return w.eval('bbPick(document.querySelectorAll(".bbSub")['+i+'])'); };
  pick(0); await wait(80);                       /* StreamNova Premium */
  ok('one subscription earns 5%', G('bundleMath().pct') === 5);

  /* Index 1 is StreamNova Standard — the other tier of what is already
     picked. The builder has to refuse it here, or the basket refuses it
     later and the bundle silently comes out short of the quote. */
  pick(1); await wait(80);
  ok('a second tier of the same service is refused in the builder',
     G('BB.subs.indexOf("SKU-3002")') === -1, G('JSON.stringify(BB.subs)'));
  ok('and the checkbox does not stay ticked on a refusal',
     boxes[1].checked === false);
  ok('the quote does not move on a refused pick', G('bundleMath().pct') === 5);

  pick(2); await wait(80);                       /* PlayForge */
  pick(5); await wait(80);                       /* ClearVault */
  ok('three compatible subscriptions reach the 15% cap',
     G('bundleMath().pct') === 15, G('JSON.stringify(BB.subs)'));
  pick(3); await wait(80);                       /* Halo Family — a fourth */
  ok('a fourth is refused', G('BB.subs.length') === 3);
  ok('the discount is real money', G('bundleMath().save') > 0 &&
     G('bundleMath().net') === +(G('bundleMath().monthly') - G('bundleMath().save')).toFixed(2));
  w.eval('addBundleToBasket()'); await wait(105);
  confirmDialog(w); await wait(105);
  ok('the bundle lands in the basket', G('CART.length') === 4);
}

head('PRESENTATION — no missing-glyph boxes, and the right brand on the right portal');
{
  const DING = /[\u2190-\u21FF\u2300-\u23FF\u25A0-\u25FF\u2600-\u27BF\u0900-\u097F]/;
  for (const [file, brand] of [['consumer.html','6d'],['partner.html','6d'],['operator.html','6d'],['enterprise.html','neutral']]){
    const { w, G } = await load(file);
    w.App = G('App');
    let dings = 0, noShape = 0, screens = 0;
    const navIds = Array.from(w.document.querySelectorAll('.nav-item')).map(b => b.id.replace('nav_',''));
    for (const id of navIds){
      w.App.go(id); await wait(105); screens++;
      const main = w.document.getElementById('main');
      if (DING.test(main.textContent)) dings++;
      main.querySelectorAll('.pill, .tier').forEach(el => { if (!el.querySelector('svg')) noShape++; });
    }
    ok(file + ' — no dingbat characters on any of its ' + screens + ' screens', dings === 0, dings + ' screens affected');
    ok(file + ' — every status and tier chip carries an SVG shape', noShape === 0, noShape + ' without one');
    const img = w.document.querySelector('.rail-brand img.brand-mark');
    if (brand === '6d'){
      ok(file + ' — carries the approved 6D mark', !!img && /6d-logo-white\.png$/.test(img.getAttribute('src')));
    } else {
      ok(file + ' — white-label portal carries no 6D mark', !img);
    }
  }
}

head('PRESENTATION — tiers are a category, not a state');
{
  const { w, G } = await load('operator.html');
  w.App = G('App'); w.App.go('partners'); await wait(105);
  const chips = Array.from(w.document.querySelectorAll('#main .tier'));
  ok('tier chips render', chips.length > 0);
  const classes = new Set(chips.map(c => (c.className.match(/tier-(\w+)/) || [])[1]));
  ok('all four tiers have their own colour class', ['platinum','gold','silver','bronze'].every(t => classes.has(t)),
     Array.from(classes).join(','));
  ok('no tier reuses a state colour', chips.every(c => !/pill-/.test(c.className)));
  const shapes = new Set(chips.map(c => (c.querySelector('svg path,svg rect') || {}).outerHTML));
  ok('each tier has a distinct shape, so it survives monochrome', shapes.size >= 4, shapes.size + ' distinct');
}



console.log('\n' + (failures ? '✗ ' + failures + ' of ' + checks + ' checks failed'
                             : '✓ all ' + checks + ' administration checks passed'));
process.exit(failures ? 1 : 0);

})();
