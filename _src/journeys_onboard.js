/* ===========================================================================
   Onboarding capture, settlement detail and masking, and product artwork.
   Nineteenth file.
   Run: node _src/journeys_onboard.js
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

/* ------------------------------------------------------------ TASK SCOPE */
head('TASKS — a task belongs to a partner, and follows that partner’s gates');
{
  const { w, G, errs } = await load('operator.html');
  w.App = G('App'); w.App.go('onboardq'); await wait(340);
  ok('the queue renders', errs.length === 0, errs[0]);

  ok('every task names the partner it belongs to',
     G("ONB_TASKS.every(function(t){return !!t.partnerId && !!PMAP[t.partnerId]})"));
  ok('every partner has a full ladder rather than a stray task',
     G("PARTNERS.every(function(p){return onbTasksFor(p.id).length>0})"));

  /* The defect this exists to remove: a live seller holding open tasks. */
  ok('a partner with no application in flight has nothing outstanding',
     G("PARTNERS.filter(function(p){return !ONB_STATE[p.id]})" +
       ".every(function(p){return onbTasksFor(p.id).every(function(t){return t.status==='done'})})"));
  ok('and every closed task records who closed it',
     G("ONB_TASKS.filter(function(t){return t.status==='done'})" +
       ".every(function(t){return !!t.closedBy})"));
  ok('and when', G("ONB_TASKS.filter(function(t){return t.status==='done'})" +
       ".every(function(t){return !!t.closedOn})"));

  /* A gate not yet reached owes nobody anything. */
  ok('tasks on a gate not yet reached are not started, not open',
     G("(function(){var st=ONB_STATE['PTR-1012'];" +
       "return ONB_STEPS.filter(function(g){return st[g.id]==='todo'})" +
       ".every(function(g){return onbTasksFor('PTR-1012',g.id)" +
       ".every(function(t){return t.status==='notstarted'})})})()") === true);
  ok('tasks on the gate the seller is actually on are open',
     G("onbTasksFor('PTR-1012','finance').every(function(t){return t.status==='pending'})"));

  /* The chase list only contains people who can be chased. */
  const out = G('onbTasksOutstanding()');
  ok('the outstanding list is not empty', out.length > 0);
  ok('and contains only sellers still onboarding',
     G("onbTasksOutstanding().every(function(t){return !!ONB_STATE[t.partnerId]})"));
  ok('the queue names the partner on every row',
     /Partner/.test(w.document.getElementById('main').textContent));

  /* A cleared gate closes its tasks. */
  const before = G("onbTasksFor('PTR-1013','agree').filter(function(t){return t.status==='pending'}).length");
  ok('the gate in flight has open tasks before it clears', before > 0);
  w.eval("advanceGate('PTR-1013')"); await wait(240);
  const ev = w.document.getElementById('agEvid');
  if (ev) ev.value = 'Countersigned schedule on file.';
  confirmDialog(w); await wait(300);
  ok('clearing a gate closes its tasks',
     G("onbTasksFor('PTR-1013','agree').every(function(t){return t.status==='done'})"));
  ok('and names who closed them',
     G("onbTasksFor('PTR-1013','agree').every(function(t){return !!t.closedBy})"));
  ok('the next gate opens its own',
     G("onbTasksFor('PTR-1013','finance').some(function(t){return t.status==='pending'})"));
}

head('TASKS — a cleared gate says cleared, not open');
{
  const { w, G } = await load('operator.html');
  w.App = G('App'); w.App.go('onboardq'); await wait(320);
  w.eval("openGate('PTR-1001','finance')"); await wait(300);
  const t = (w.document.getElementById('inspector').textContent || '').replace(/\s+/g, ' ');
  const tasks = t.split('Tasks on this gate')[1] || '';
  ok('a live partner’s cleared gate shows no open task', !/\bOpen\b/.test(tasks));
  ok('it says the gate is cleared', /Cleared\./.test(tasks));
  ok('and each task names who closed it', /closed by/.test(tasks));

  w.eval('closeInspector()'); await wait(100);
  w.eval("openGate('PTR-1012','finance')"); await wait(300);
  const t2 = (w.document.getElementById('inspector').textContent || '').replace(/\s+/g, ' ');
  const tasks2 = t2.split('Tasks on this gate')[1] || '';
  ok('the seller actually on that gate does show open tasks', /Open/.test(tasks2));
  ok('and is told this is the gate they are on', /gate the seller is on/.test(tasks2));
}

/* ------------------------------------------------- OPERATOR-LED CAPTURE */
head('CAPTURE — the desk can record everything the seller would have typed');
{
  const { w, G, errs } = await load('operator.html');
  w.App = G('App'); w.App.go('onboardq'); await wait(320);
  w.eval('operatorOnboardDialog()'); await wait(250);
  ok('the capture opens without error', errs.length === 0, errs[0]);
  ok('it is stepped rather than one long form', G('OO_STEPS.length') >= 4);
  ok('and the first step asks for the company', !!w.document.getElementById('ooName'));

  set(w, 'ooName', 'Halcyon Networks');
  set(w, 'ooCountry', 'India');
  set(w, 'ooReg', 'U72200KA2021PTC099887');
  w.eval('ooGo(1)'); await wait(200);
  ok('values survive a step change', G("OO['ooName']") === 'Halcyon Networks');

  set(w, 'ooContact', 'Rohit Sharma');
  set(w, 'ooEmail', 'rohit@6dtech.co.in');
  set(w, 'ooPhone', '+91 80 4111 9000');
  const cb = w.document.querySelector('.ooV'); if (cb) cb.checked = true;
  w.eval('ooGo(2)'); await wait(220);

  /* The form asks for the thing the person is holding. */
  const localLbl = (w.document.querySelector('label[for=ooLocal]') || {}).textContent || '';
  const taxLbl = (w.document.querySelector('label[for=ooTaxId]') || {}).textContent || '';
  ok('the clearing code is named for the country, not called "bank code"', localLbl === 'IFSC', localLbl);
  ok('and so is the tax identifier', taxLbl === 'PAN', taxLbl);
  ok('there is a field for the account number', !!w.document.getElementById('ooAcct'));
  ok('and for SWIFT/BIC', !!w.document.getElementById('ooSwift'));
  ok('and the account is asked for twice', !!w.document.getElementById('ooAcct2'));

  set(w, 'ooHolder', 'Halcyon Networks Private Limited');
  set(w, 'ooBank', 'HDFC Bank');
  set(w, 'ooAcct', '501000123456789');
  set(w, 'ooAcct2', '501000999999999');
  set(w, 'ooLocal', 'HDFC0000521');
  set(w, 'ooSwift', 'HDFCINBB');
  set(w, 'ooTaxId', 'AAACH1234K');
  set(w, 'ooTreaty', '31 Mar 2028');
  w.eval('ooGo(3)'); await wait(200);
  ok('the documents step lists what each gate expects',
     w.document.querySelectorAll('.docrow').length >= 6);
  ok('and every one of them can take a file, not just a tick',
     w.document.querySelectorAll('.ooFile').length ===
     w.document.querySelectorAll('.docrow').length);
  ok('the file control names the formats a gate can actually read',
     /pdf/.test((w.document.querySelector('.ooFile')||{}).accept || ''));
  ok('it says a tick is not evidence',
     /tick without a file/i.test(w.document.getElementById('modalHost').textContent));

  w.eval("ooTakeFile({files:[{name:'incorporation.pdf',size:1450000}]," +
    "getAttribute:function(a){return a==='data-doc'?'Certificate of incorporation':'kyc'}})");
  await wait(240);
  ok('attaching a file records its name, type and size',
     G("OO.files['Certificate of incorporation'].name") === 'incorporation.pdf' &&
     G("OO.files['Certificate of incorporation'].type") === 'PDF' &&
     G("OO.files['Certificate of incorporation'].size") === '1.4 MB');
  ok('and the row shows it is held', w.document.querySelectorAll('.docrow.is-held').length === 1);

  w.eval('ooGo(4)'); await wait(220);
  const review = w.document.getElementById('modalHost').textContent.replace(/\s+/g, ' ');
  ok('the review masks the account rather than reprinting it', /•••• 6789/.test(review));
  ok('and masks the tax identifier too', /AA••••4K/.test(review));
  ok('it says plainly that only the application gate clears',
     /only one this clears/i.test(review));

  const n0 = G('PARTNERS.length');
  set(w, 'ooWhy', 'Signed at the enterprise desk on 24 Jul.');
  w.eval('saveOperatorOnboard()'); await wait(220);
  ok('a mismatched account number blocks the save', G('PARTNERS.length') === n0);
  ok('and it sends you back to the step that is wrong', G('OO.step') === 2);

  set(w, 'ooAcct2', '501000123456789');
  w.eval('ooGo(4)'); await wait(200);
  set(w, 'ooWhy', 'Signed at the enterprise desk on 24 Jul.');
  w.eval('saveOperatorOnboard()'); await wait(340);
  ok('a complete capture creates the partner', G('PARTNERS.length') === n0 + 1);

  const pid = G('PARTNERS[PARTNERS.length-1].id');
  ok('the settlement instruction is stored', G("!!PARTNER_BANK['" + pid + "']"));
  ok('but it is explicitly not verified', G("PARTNER_BANK['" + pid + "'].verified") === false);
  ok('the application gate closed its tasks',
     G("onbTasksFor('" + pid + "','apply').every(function(t){return t.status==='done'})"));
  ok('KYC opened its own',
     G("onbTasksFor('" + pid + "','kyc').some(function(t){return t.status==='pending'})"));
  ok('an attached document closes the task that would have chased it',
     G("onbTasksFor('" + pid + "','kyc').filter(function(t){return t.key==='inc'})[0].status") === 'done');
  ok('and the closure names the file rather than saying "on file"',
     /incorporation\.pdf/.test(
       G("onbTasksFor('" + pid + "','kyc').filter(function(t){return t.key==='inc'})[0].closedBy")));
  ok('the submission carries the real file size, not a placeholder',
     /1\.4 MB/.test(G("JSON.stringify(ONB_SUBMISSIONS['" + pid + "'].apply.docs)")));
  ok('and an unticked one stays open',
     G("onbTasksFor('" + pid + "','kyc').filter(function(t){return t.key==='ubo'})[0].status") === 'pending');
  ok('the finance submission records the detail masked',
     /••••/.test(G("JSON.stringify(ONB_SUBMISSIONS['" + pid + "'].finance.fields)")));
  ok('and leaves the finance gate unclear',
     G("ONB_STATE['" + pid + "'].finance") === 'todo');
  ok('recording the account is on the audit log',
     G("auditRows('operator').some(function(e){return e.action==='bank.recorded'})"));
}

/* -------------------------------------------------------------- MASKING */
head('MASKING — the record holds the number, the screens hold a mask');
{
  const { w, G } = await load('operator.html');
  w.App = G('App'); w.App.go('onboardq'); await wait(320);

  ok('every partner has a settlement instruction on file',
     G("PARTNERS.every(function(p){return !!PARTNER_BANK[p.id]})"));
  ok('a masked account shows only the last four',
     G("maskAcct('501000123456789')") === '•••• 6789');
  ok('a tax identifier keeps its jurisdiction prefix and nothing else',
     G("maskTaxId('AAACH1234K')") === 'AA••••4K');
  ok('a missing value is declared rather than shown blank',
     G("maskAcct('')") === '*Not supplied*');
  ok('a BIC is not masked, because it identifies a bank and not an account',
     /is not masked/.test(G("bankSummary('PTR-1001')")));

  w.eval("openGate('PTR-1001','finance')"); await wait(300);
  const insp = w.document.getElementById('inspector').textContent;
  const full = G("PARTNER_BANK['PTR-1001'].account");
  ok('the gate shows the settlement instruction', /Settlement instruction/.test(insp));
  ok('and the full account number is nowhere on the screen', insp.indexOf(full) === -1);
  ok('the mask is', insp.indexOf(full.slice(-4)) > -1);

  /* Revealing is a deliberate, reasoned, logged act. */
  w.eval('closeInspector()'); await wait(120);
  /* The seeded history already contains reveals — this control has been used
     before. So count the change rather than the existence. */
  const reveals0 = G("auditRows('operator').filter(function(e){return e.action==='bank.revealed'}).length");
  w.eval("revealBank('PTR-1001')"); await wait(240);
  const m = w.document.getElementById('modalHost');
  ok('revealing asks for a reason first', !!m && /Why you need it/.test(m.textContent));
  confirmDialog(w); await wait(200);
  ok('and refuses without one, without throwing the dialog away',
     !!w.document.getElementById('modalHost') &&
     G("auditRows('operator').filter(function(e){return e.action==='bank.revealed'}).length") === reveals0);
  ok('it says why it refused, in the dialog rather than a toast that vanishes',
     /reason is required/i.test((w.document.getElementById('cfmErr')||{textContent:''}).textContent));
  set(w, 'rbWhy', 'Reconciling a returned payment on SET-2026-07');
  confirmDialog(w); await wait(280);
  ok('with a reason it shows the number',
     (w.document.getElementById('modalHost') || {textContent:''}).textContent.indexOf(full) > -1);
  ok('and writes an audit entry naming the reason',
     G("auditRows('operator').some(function(e){return e.action==='bank.revealed' && " +
       "/Reconciling/.test(e.detail||'')})"));
  ok('at high severity, because it is personal data',
     G("auditRows('operator').filter(function(e){return e.action==='bank.revealed'})[0].sev") === 'high');
}

/* ------------------------------------------------------- THE SELLER SIDE */
head('SELLER — a seller can see and correct what we hold about them');
{
  const { w, G, errs } = await load('partner.html');
  w.App = G('App'); w.App.go('profile'); await wait(420);
  const txt = w.document.getElementById('main').textContent.replace(/\s+/g, ' ');
  ok('the profile renders', errs.length === 0, errs[0]);

  ok('the settlement account is on their own details page', /Settlement account/.test(txt));
  ok('their tax position too', /Tax position/.test(txt));
  ok('and what they submitted at each gate', /What you submitted at onboarding/.test(txt));
  ok('a gate card is drawn for every gate with a record',
     w.document.querySelectorAll('.modcard').length === G("Object.keys(ONB_SUBMISSIONS[ME_P.id]).length"));
  ok('their own account is masked to them as well', /••••/.test(txt));
  ok('and the full number is not in the page',
     txt.indexOf(G('PARTNER_BANK[ME_P.id].account')) === -1);
  ok('the withholding consequence is spelled out, not just the state',
     /withheld|Withholding/.test(txt));

  /* Changing where money goes is the change most worth attacking. */
  const live = G('PARTNER_BANK[ME_P.id].account');
  w.eval('changeBankDialog(ME_P.id)'); await wait(240);
  ok('the change dialog opens', !!w.document.getElementById('modalHost'));
  ok('and warns that nothing is paid to it until it is verified',
     /until it is verified/i.test(w.document.getElementById('modalHost').textContent));

  set(w, 'cbBank', 'ICICI Bank');
  set(w, 'cbAcct', '777000111222');
  set(w, 'cbAcct2', '777000999');
  w.eval('submitBankChange(ME_P.id)'); await wait(160);
  ok('a mistyped confirmation is caught',
     /do not match/.test(w.document.getElementById('cbOut').textContent));
  set(w, 'cbAcct2', '777000111222');
  w.eval('submitBankChange(ME_P.id)'); await wait(160);
  ok('and a change with no reason is refused',
     /Say why/.test(w.document.getElementById('cbOut').textContent));
  set(w, 'cbWhy', 'Moved banking provider on 20 Jul.');
  w.eval('submitBankChange(ME_P.id)'); await wait(300);
  ok('the request is recorded', G('!!PARTNER_BANK[ME_P.id].pending'));
  ok('but payouts stay on the account already verified',
     G('PARTNER_BANK[ME_P.id].account') === live);
  ok('and the change is audited with both masks',
     G("auditRows('partner').some(function(e){return e.action==='bank.recorded' && /••••/.test(e.after||'')})"));

  /* A certificate with no expiry cannot be checked, so it is not accepted. */
  w.eval('uploadTreatyDialog(ME_P.id)'); await wait(220);
  confirmDialog(w); await wait(180);
  ok('a treaty certificate with no expiry is refused',
     G('PARTNER_BANK[ME_P.id].treaty.expires') !== '');
  set(w, 'tcExp', '31 Mar 2029');
  confirmDialog(w); await wait(260);
  ok('one with an expiry is recorded',
     G('PARTNER_BANK[ME_P.id].treaty.expires') === '31 Mar 2029');
  ok('and it says the rate changes after review, not on save',
     /pending marketplace review/i.test(G('PARTNER_BANK[ME_P.id].treaty.withholding')));
}

/* ---------------------------------------------------------- THE BUYER SIDE */
head('BUYER — a buyer pays us, so what they hold is a payment instruction');
{
  const { w, G, errs } = await load('enterprise.html');
  w.App = G('App'); w.App.go('profile'); await wait(460);
  const txt = w.document.getElementById('main').textContent.replace(/\s+/g, ' ');
  ok('the profile renders', errs.length === 0, errs[0]);

  ok('how they pay is on their own details page', /How you pay us/.test(txt));
  ok('so is the credit position', /Credit position/.test(txt));
  ok('so is the tax registration', /Tax registration/.test(txt));
  ok('and what was checked when the account was opened',
     /What was checked when the account was opened/.test(txt));
  ok('it is a payment instruction, not a settlement account — a buyer is not paid',
     !/Settlement account/.test(txt));

  ok('the account number is masked', txt.indexOf(G('BUYER_BILLING.account')) === -1);
  ok('and so is the direct debit mandate, which is worth quoting on its own',
     txt.indexOf(G('BUYER_BILLING.mandate')) === -1);
  ok('the tax registration is masked too', txt.indexOf(G('BUYER_TAX.registration')) === -1);
  ok('the credit headroom is stated rather than left to be worked out',
     /Headroom/.test(txt));
  ok('and what happens at the limit is stated', /A requisition that would take the balance past it/.test(txt));

  /* Changing a payment instruction is the change most worth attacking. */
  const live = G('BUYER_BILLING.account');
  w.eval('changeBuyerMandate()'); await wait(240);
  ok('the change dialog opens', !!w.document.getElementById('modalHost'));
  confirmDialog(w); await wait(150);
  ok('an empty bank is refused in the dialog rather than by a vanishing toast',
     /Name the bank/.test((w.document.getElementById('cfmErr')||{textContent:''}).textContent));
  set(w, 'bmBank', 'ICICI Bank');
  set(w, 'bmAcct', '111222333');
  set(w, 'bmAcct2', '111222999');
  confirmDialog(w); await wait(150);
  ok('a mistyped confirmation is caught',
     /do not match/.test(w.document.getElementById('cfmErr').textContent));
  set(w, 'bmAcct2', '111222333');
  confirmDialog(w); await wait(150);
  ok('and a change with no reason is refused',
     /Say why/.test(w.document.getElementById('cfmErr').textContent));
  set(w, 'bmWhy', 'Moved banking provider.');
  confirmDialog(w); await wait(280);
  ok('the request is recorded', G('!!BUYER_BILLING.pending'));
  ok('but collections stay on the mandate in force', G('BUYER_BILLING.account') === live);
  ok('and it is audited at high severity',
     G("auditRows('buyer').some(function(e){return e.action==='bank.recorded' && e.sev==='high'})"));

  /* Tax changes forward, never backward. */
  w.eval('editBuyerTaxDialog()'); await wait(240);
  ok('the tax dialog says it applies from the next invoice, not backwards',
     /not applied backwards/i.test(w.document.getElementById('modalHost').textContent));
  set(w, 'btReg', '');
  confirmDialog(w); await wait(150);
  ok('a blank registration is refused, with the consequence named',
     /input credit cannot be claimed/.test(w.document.getElementById('cfmErr').textContent));
  set(w, 'btReg', '29AABCB4455N1Z9');
  confirmDialog(w); await wait(260);
  ok('a valid registration saves', G('BUYER_TAX.registration') === '29AABCB4455N1Z9');
  ok('and it is audited with both sides masked',
     G("auditRows('buyer').some(function(e){return e.action==='tax.changed' && /•/.test(e.after||'')})"));
}

/* -------------------------------------------------- CONSUMER ALERT CHANNELS */
head('ALERTS — a customer picks the subject and the channel, not a rule engine');
{
  const { w, G, errs } = await load('consumer.html');
  w.App = G('App'); w.App.go('notifications'); await wait(460);
  const m = w.document.getElementById('main');
  ok('the screen renders', errs.length === 0, errs[0]);

  const rows = m.querySelectorAll('.prefrow');
  ok('every subject has a row', rows.length === G('NOTIF_RULES.consumer.length'));
  ok('and every row offers the channels', m.querySelectorAll('.chanchip').length === rows.length * 3);
  ok('a chip says whether it is on without relying on colour',
     Array.prototype.some.call(m.querySelectorAll('.chanchip'),
       c => c.getAttribute('aria-pressed') === 'true'));
  ok('the toggle is still there alongside the channels',
     m.querySelectorAll('.prefrow .toggle').length === rows.length);

  const before = G('NOTIF_RULES.consumer[0].chans.length');
  w.eval("toggleAlertChannel('NR-C1','Email')"); await wait(200);
  ok('adding a channel changes the record', G('NOTIF_RULES.consumer[0].chans.length') === before + 1);
  ok('and the order stays stable so the row does not reshuffle',
     G("JSON.stringify(NOTIF_RULES.consumer[0].chans)") === '["Push","SMS","Email"]');
  w.eval("toggleAlertChannel('NR-C1','Email')"); await wait(180);
  ok('removing one changes it back', G('NOTIF_RULES.consumer[0].chans.length') === before);

  /* Agreeing to be told and leaving nowhere to tell you is not a choice. */
  w.eval("toggleAlertChannel('NR-C1','Push')"); await wait(160);
  ok('a subject can be reduced to one channel', G('NOTIF_RULES.consumer[0].chans.length') === 1);
  w.eval("toggleAlertChannel('NR-C1','SMS')"); await wait(160);
  ok('but the last channel cannot be removed while the subject is on',
     G('NOTIF_RULES.consumer[0].chans.length') === 1);

  /* Some subjects are not optional, and the screen says so. */
  const must = G("NOTIF_RULES.consumer.filter(function(r){return r.sev==='high'})[0].id");
  const wasOn = G("NOTIF_RULES.consumer.filter(function(r){return r.id==='" + must + "'})[0].on");
  w.eval("toggleConsumerAlert('" + must + "',false)"); await wait(200);
  ok('a subject we are required to send cannot be switched off',
     G("NOTIF_RULES.consumer.filter(function(r){return r.id==='" + must + "'})[0].on") === wasOn);
  ok('and the screen says which those are',
     /Always sent/.test(w.document.getElementById('main').textContent));
  ok('but its channel is still the customer’s to choose',
     G("NOTIF_RULES.consumer.filter(function(r){return r.id==='" + must + "'})[0].chans.length") > 1);

  ok('an optional one can still be turned off',
     G("(function(){var r=NOTIF_RULES.consumer.filter(function(x){return x.sev==='low'})[0];" +
       "toggleConsumerAlert(r.id,false); return r.on===false})()") === true);
  ok('a preference change is on the account activity log',
     G("auditRows('consumer').some(function(e){return e.action==='notif.rule'})"));

  ok('the customer is still not shown a rule engine',
     !/Message content|Channels by severity|Send a test/i.test(
       w.document.getElementById('main').textContent));
}

/* ------------------------------------------------------------- ARTWORK */
head('ARTWORK — a catalogue tile shows the product, not a generic glyph');
{
  const { w, G, errs } = await load('consumer.html');
  w.App = G('App'); w.App.go('browse'); await wait(420);
  const m = w.document.getElementById('main');
  ok('the storefront renders', errs.length === 0, errs[0]);

  ok('every tile carries a drawing', m.querySelectorAll('.pmedia .partsvg').length > 0);
  ok('and none is left as a bare category glyph',
     m.querySelectorAll('.pmedia .glyph').length === 0);
  ok('every product in the catalogue resolves to a drawing that exists',
     G("PRODUCTS.every(function(p){return !!PROD_ART[prodArtKey(p)]})"));

  /* The point of a picture is telling one thing from another. */
  const kinds = G("(function(){var s={};PRODUCTS.forEach(function(p){s[prodArtKey(p)]=1});" +
    "return Object.keys(s).length})()");
  ok('the catalogue uses many distinct drawings, not three', kinds >= 15, String(kinds));
  ok('a handset and a tablet are drawn differently',
     G("prodArtKey({name:'Kestrel K9 Pro 256 GB',cat:'Phones',v:'device'})") !==
     G("prodArtKey({name:'Kestrel Tab 11 LTE',cat:'Tablets',v:'device'})"));
  ok('a mesh pack and a fixed-wireless CPE are drawn differently',
     G("prodArtKey({name:'Volta Mesh Wi-Fi 6 (3-pack)',cat:'Routers',v:'device'})") !==
     G("prodArtKey({name:'Volta 5G Fixed Wireless CPE',cat:'Routers',v:'device'})"));

  ok('each drawing describes itself to a screen reader',
     Array.prototype.every.call(m.querySelectorAll('.pmedia .partsvg'),
       s => /^Illustration of /.test(s.getAttribute('aria-label') || '')));
  ok('and is marked as an image rather than left as decoration',
     Array.prototype.every.call(m.querySelectorAll('.pmedia .partsvg'),
       s => s.getAttribute('role') === 'img'));

  /* Deterministic, so a tile does not change colour when the list re-renders. */
  const a1 = G("productArt(PRODUCTS[0],118)").replace(/pa\d+/g, 'X');
  const a2 = G("productArt(PRODUCTS[0],118)").replace(/pa\d+/g, 'X');
  ok('the same product draws the same way every time', a1 === a2);

  /* The card footer overflow that pushed the action off the tile. */
  const css = fs.readFileSync(path.join(__dirname, 'core.css'), 'utf8');
  ok('the card footer is allowed to wrap rather than overflow',
     /\.pfoot\{[^}]*flex-wrap:wrap/.test(css.replace(/\s*\n\s*/g, '')));
  ok('and the price block is allowed to shrink',
     /\.pfoot > \.row\{[^}]*min-width:0/.test(css.replace(/\s*\n\s*/g, '')));
}

/* ------------------------------------------------------------ THE BASKET */
head('BASKET — saved items sit inside the drawer, whatever else is in it');
{
  const { w, G, errs } = await load('consumer.html');
  await wait(120);
  /* The close tag for the totals block used to be emitted unconditionally, so
     an empty basket closed the drawer body early and the saved list rendered
     outside it with no padding. Both states have to be checked. */
  for (const state of ['with items', 'empty']){
    if (state === 'with items'){
      w.eval("addToCart('SKU-4001',1);cartSaveForLater('SKU-4001')");
    } else {
      w.eval('CART.length=0');
    }
    w.eval('openCart()'); await wait(280);
    const body  = w.document.querySelector('#inspector .insp-body');
    const saved = w.document.querySelector('#inspector .cartline.is-saved');
    const head4 = Array.prototype.filter.call(w.document.querySelectorAll('#inspector h4'),
      h => /Saved for later/.test(h.textContent))[0];
    ok(state + ': the saved heading is inside the drawer body', !!head4 && body.contains(head4));
    ok(state + ': and so are the saved lines', !!saved && body.contains(saved));
    ok(state + ': the drawer body is not closed twice',
       w.document.querySelectorAll('#inspector > .insp-body').length === 1);
    w.eval('closeInspector()'); await wait(100);
  }
  ok('and nothing threw while doing it', errs.length === 0, errs[0]);
}

/* ---------------------------------------------------------- ACTION COLUMNS */
head('COLUMNS — an action column holds its shape when the primary action does not');
{
  const { w, G, errs } = await load('operator.html');
  w.App = G('App'); w.App.go('settlements'); await wait(420);
  const t = w.document.querySelectorAll('#main table')[0];
  const rows = Array.prototype.slice.call(t.querySelectorAll('tbody tr'));
  ok('the run table renders rows', rows.length > 3, errs[0]);

  const cells = rows.map(r => r.children[r.children.length - 1]);
  ok('every row has the fixed primary slot',
     cells.every(c => c.querySelectorAll('.actslot').length === 1));
  ok('a pending row holds the real action',
     cells.some(c => /Review and approve/.test(c.textContent)));
  ok('an approved row fills the slot rather than leaving a gap',
     cells.some(c => c.querySelector('.actghost')));
  /* Filled, not greyed. A disabled "Review and approve" reads as "not yet";
     this reads as "already done, by this person, on this date". */
  ok('and it says what happened instead of greying out the action',
     cells.some(c => { const g = c.querySelector('.actghost');
       return g && /Reviewed and approved|Paid/.test(g.textContent)
              && !/>Review and approve</.test(g.innerHTML); }));
  ok('and it names who released it',
     cells.some(c => { const g = c.querySelector('.actghost');
       return g && /Reviewed and approved/.test(g.textContent)
              && /\d/.test((g.querySelector('.agsub')||{}).textContent || ''); }));
  ok('the filled slot is inert — no button, no tab stop',
     cells.every(c => { const g = c.querySelector('.actghost');
       return !g || (g.tagName !== 'BUTTON' && !g.hasAttribute('tabindex') && !g.getAttribute('onclick')); }));
  ok('View invoice is present on every row', cells.every(c => /View invoice/.test(c.textContent)));

  /* The whole point: the secondary action stops moving. Measured, not assumed. */
  const lefts = cells.map(c => {
    const b = c.querySelector('button.btn');
    return b ? b.offsetLeft : null;
  }).filter(x => x !== null);
  ok('the secondary action starts in the same place on every row',
     new Set(lefts).size <= 1, JSON.stringify(lefts.slice(0, 6)));

  /* The register below the run is the same statement seen from further away,
     so it offers the same column. One screen, one answer. */
  const reg = w.document.querySelectorAll('#main table')[1];
  const rrows = Array.prototype.slice.call(reg.querySelectorAll('tbody tr'));
  const rcells = rrows.map(r => r.children[r.children.length - 1]);
  ok('the register renders rows too', rrows.length > 3);
  ok('and every one of them can open its invoice',
     rcells.every(c => /View invoice/.test(c.textContent)));
  ok('a paid row in the register is filled, not empty',
     rcells.some(c => { const g = c.querySelector('.actghost');
       return g && /Paid/.test(g.textContent); }));
  ok('and both tables build that slot from one function',
     G("typeof settleActionSlot") === 'function');

  /* And the audit that catches the whole class of defect is wired in. */
  const audit = fs.readFileSync(path.join(__dirname, 'layout.js'), 'utf8');
  ok('the layout audit detects a ragged action column at all',
     /ragged action column/.test(audit));
}

head('COLUMNS — a list of checkboxes wraps instead of running off the page');
{
  const { w, G, errs } = await load('operator.html');
  w.App = G('App'); w.App.go('billing'); await wait(460);
  ok('the billing configuration renders', errs.length === 0, errs[0]);

  const grid = w.document.querySelector('#main .checkgrid');
  ok('the section list is a grid, not a single nowrap row', !!grid &&
     w.getComputedStyle(grid).display === 'grid');
  ok('it has every section in it', !!grid &&
     grid.querySelectorAll('.checkline').length === G('BILL_SECTIONS.length'));
  ok('the columns are sized to fit rather than fixed',
     /auto-fill/.test(w.getComputedStyle(grid).gridTemplateColumns));

  /* The single-row picker keeps its own class, so the two cannot drift back
     into sharing one. */
  ok('no checkbox list is borrowing the single-row picker',
     !w.document.querySelector('#main .pickrow > .checkline'));

  w.eval("billTemplateDialog(BILL_TEMPLATES[0].id)"); await wait(320);
  const g2 = w.document.querySelector('#modalHost .checkgrid');
  ok('the template editor uses the same grid', !!g2);
  ok('with the same sections', !!g2 &&
     g2.querySelectorAll('.checkline').length === G('BILL_SECTIONS.length'));
  ok('and none of them escapes the dialog',
     !!g2 && Array.prototype.every.call(g2.querySelectorAll('.checkline'),
       el => el.offsetLeft + el.offsetWidth <= g2.offsetWidth + 2));
  w.eval('closeModal()'); await wait(120);
}

/* -------------------------------------------------------- BILL TEMPLATES */
head('TEMPLATES — the sketch follows the sections, or the whole panel is decoration');
{
  const { w, G, errs } = await load('operator.html');
  w.App = G('App'); w.App.go('billing'); await wait(460);
  ok('the billing configuration renders', errs.length === 0, errs[0]);

  const pv = () => (w.document.getElementById('billPreview') || {textContent:''})
    .textContent.replace(/\s+/g, ' ');
  ok('the sketch is drawn', pv().length > 40);
  ok('and it starts with the support block the template asks for',
     /Questions about this bill/.test(pv()));

  const tid = G("BTMAP[BILL_TEMPLATE_ASSIGN['partner']].id");
  w.eval("toggleBillSection('" + tid + "','support',false,'operator')"); await wait(220);
  ok('switching a section off removes it from the sketch',
     !/Questions about this bill/.test(pv()));
  ok('and the record changed with it',
     G("billHas(BTMAP['" + tid + "'],'support')") === false);

  w.eval("toggleBillSection('" + tid + "','slip',true,'operator')"); await wait(220);
  ok('switching one on adds it', /detach below this line/.test(pv()));
  ok('the panel redraws in place rather than reloading the screen',
     !!w.document.getElementById('billPreview'));
  ok('and the change is marked unsaved',
     !(w.document.getElementById('billDirty') || {hidden:true}).hidden);

  /* A locked section is not a suggestion. */
  ok('the four locked sections are always present',
     G("BILL_SECTIONS.filter(function(s){return s.locked})" +
       ".every(function(s){return billHas(BTMAP['" + tid + "'],s.id)})"));

  /* The creation dialog draws the same sketch from the live form. */
  const tpl0 = G('BILL_TEMPLATES.length');
  w.eval('billTemplateDialog(null)'); await wait(320);
  const sk = () => (w.document.getElementById('btSketch') || {textContent:''})
    .textContent.replace(/\s+/g, ' ');
  ok('a new template shows a sketch too', sk().length > 40);

  const before = sk();
  const terms = Array.prototype.filter.call(w.document.querySelectorAll('.btSec'),
    c => c.value === 'terms')[0];
  terms.checked = !terms.checked;
  w.eval('btPreview()'); await wait(140);
  ok('ticking a section in the dialog redraws the sketch', sk() !== before);

  const advert = Array.prototype.filter.call(w.document.querySelectorAll('.btSec'),
    c => c.value === 'advert')[0];
  advert.checked = true; w.eval('btPreview()'); await wait(140);
  ok('and the section that was ticked is the one that appeared',
     /One relevant offer/.test(sk()));

  set(w, 'btTitle', 'Tax invoice');
  w.eval('btPreview()'); await wait(140);
  ok('the sketch follows the typed fields, not only the checkboxes',
     /Tax invoice/.test(sk()));

  /* It draws from the form, not from anything saved — nothing has been saved. */
  ok('nothing is committed while previewing', G('BILL_TEMPLATES.length') === tpl0);
  w.eval('closeModal()'); await wait(120);
}

/* ------------------------------------------------------------------ TAX */
head('TAX — one document, not two overlapping statements of the same figure');
{
  const { w, G, errs } = await load('operator.html');
  w.App = G('App'); w.App.go('tax'); await wait(440);
  ok('the tax screen renders', errs.length === 0, errs[0]);
  const pv = () => w.document.querySelector('#main .doc-preview')
    .textContent.replace(/\s+/g, ' ');
  const times = (t, re) => (t.match(re) || []).length;

  /* Inclusive prices, broken out. Net and tax, each once, and they add up. */
  w.eval("TAX_SETTINGS.pricesIncludeTax=true;setTaxSetting('showTaxSeparately',true)");
  await wait(240);
  let t = pv();
  ok('an inclusive price is shown gross on the line', /\$48\.38/.test(t));
  ok('the tax figure appears exactly once', times(t, /\$7\.38/g) === 1);
  ok('and the net is stated so the reader can add it up', /Net of GST.*\$41\.00/.test(t));
  ok('the total matches the line price on an inclusive display',
     times(t, /\$48\.38/g) === 2);

  /* Inclusive, not broken out. One figure, and no tax amount at all. */
  w.eval("setTaxSetting('showTaxSeparately',false)"); await wait(240);
  t = pv();
  ok('with the split off, the price stands alone', !/\$7\.38/.test(t));
  ok('and it says the tax is inside it', /included in the price shown/.test(t));

  /* Exclusive. The tax is added, so it is its own line by definition. */
  w.eval("setTaxSetting('pricesIncludeTax',false)"); await wait(360);
  t = pv();
  ok('an exclusive price is shown net on the line', /\$41\.00/.test(t));
  ok('the tax is added as its own line, once', times(t, /\$7\.38/g) === 1);
  ok('and the total is the sum', /Total.*\$48\.38/.test(t));
  ok('it says plainly that shelf and till differ',
     /on the shelf and pays/.test(t));

  /* The setting that no longer means anything says so rather than sitting
     there looking operable. */
  ok('the split rule knows when it is moot', G('taxSplitApplies()') === false);
  const sw = Array.prototype.filter.call(w.document.querySelectorAll('#main .toggle'),
    l => /Break the price/.test(l.textContent))[0];
  ok('the switch is present but disabled', !!sw && sw.querySelector('input').disabled);
  ok('and it explains why rather than just greying out',
     !!sw && /Nothing to break out/.test(sw.textContent));

  w.eval("setTaxSetting('pricesIncludeTax',true)"); await wait(340);
  ok('turning inclusive back on makes the switch operable again',
     G('taxSplitApplies()') === true);
}

head('TAX — a certificate row opens its record, and a chase shows its words');
{
  const { w, G, errs } = await load('operator.html');
  w.App = G('App'); w.App.go('tax'); await wait(460);
  ok('the tax screen renders', errs.length === 0, errs[0]);

  const tbl = Array.prototype.filter.call(w.document.querySelectorAll('#main table'),
    x => /Tax residency/.test(x.textContent))[0];
  ok('the certificate table is drawn', !!tbl);
  const r0 = tbl.querySelector('tbody tr');
  ok('a row opens the record behind it',
     /openPartnerTax/.test(r0.getAttribute('onclick') || ''));
  ok('and the action column holds its shape',
     Array.prototype.every.call(tbl.querySelectorAll('tbody tr'),
       r => r.children[r.children.length - 1].querySelectorAll('.actslot').length === 1));

  /* The record says what withholding actually does to the seller. */
  const missing = G("Object.keys(TAX_CERTS).filter(function(k){return !TAX_CERTS[k].certOnFile})[0]");
  w.eval("openPartnerTax('" + missing + "')"); await wait(300);
  let ins = w.document.getElementById('inspector').textContent.replace(/\s+/g, ' ');
  ok('a missing certificate states the rate withheld', /withheld at source/.test(ins));
  ok('and that the marketplace cannot waive it', /cannot waive it/.test(ins));
  ok('and that filing one is never retrospective', /never retrospectively/.test(ins));
  ok('it names who we would write to', /Who we would write to/.test(ins));
  ok('and how many times they have been asked', /Times asked/.test(ins));

  w.eval('closeInspector()'); await wait(120);
  const held = G("Object.keys(TAX_CERTS).filter(function(k){return TAX_CERTS[k].certOnFile})[0]");
  w.eval("openPartnerTax('" + held + "')"); await wait(300);
  ins = w.document.getElementById('inspector').textContent.replace(/\s+/g, ' ');
  ok('a valid certificate says nothing is withheld', /Nothing is withheld/.test(ins));
  ok('and warns that it resumes on its own at expiry', /resumes on its own/.test(ins));
  w.eval('closeInspector()'); await wait(120);

  /* The chase shows the words before it sends them. */
  w.eval("chaseCert('" + held + "')"); await wait(300);
  const m = w.document.getElementById('modalHost');
  ok('asking for a renewal previews the message', !!m);
  const box = w.document.getElementById('ccBody');
  ok('the body is shown in full and can be edited', !!box && box.value.length > 200);
  ok('it is addressed to the named contact by name',
     !!box && new RegExp('Dear ' + G("PMAP['" + held + "'].contact")).test(box.value));
  ok('it says what happens if the certificate lapses',
     !!box && /withheld at source/.test(box.value));
  ok('and that the seller reclaims it from the authority, not from us',
     !!box && /rather than from us/.test(box.value));
  ok('the recipient address is shown before sending',
     /@/.test(m.textContent));
  ok('and so is when they were last asked', /Not asked before|Last asked/.test(m.textContent));

  /* Sending produces a real delivery, not a toast. */
  const dl0 = G('DELIVERIES.length');
  box.value = '';
  w.eval("sendCertReminder('" + held + "')"); await wait(180);
  ok('an empty message is refused',
     G('DELIVERIES.length') === dl0 &&
     /not a reminder/.test((w.document.getElementById('ccOut') || {textContent:''}).textContent));
  box.value = 'Please send the renewed certificate before it expires.';
  w.eval("sendCertReminder('" + held + "')"); await wait(300);
  ok('sending writes a real delivery record', G('DELIVERIES.length') === dl0 + 1);
  ok('with the recipient on it',
     G('DELIVERIES[0].to') === G("(PMAP['" + held + "'].email || PMAP['" + held + "'].contact)"));
  ok('the chase is counted against the certificate',
     G("TAX_CERTS['" + held + "'].chaseCount") >= 1 &&
     !!G("TAX_CERTS['" + held + "'].lastChased"));
  ok('and it is on the audit log',
     G("auditRows('operator').some(function(e){return /Renewal reminder sent/.test(e.detail||'')})"));
}

/* -------------------------------------------------------------- INVENTORY */
head('INVENTORY — the warehouse panels sit on the page, not inside another one');
{
  const { w, G, errs } = await load('operator.html');
  w.App = G('App'); w.App.go('inventory'); await wait(620);
  ok('the inventory screen renders', errs.length === 0, errs[0]);

  const main  = w.document.getElementById('main');
  const stack = main.querySelector('.stack');
  const panels = Array.prototype.slice.call(main.querySelectorAll('.panel'));
  ok('every panel is drawn', panels.length >= 7);
  /* They used to be spliced in by replacing the first '</div>', which put them
     inside whichever container happened to close first. */
  ok('and every one is a direct child of the page stack',
     panels.every(p => p.parentElement === stack));
  ok('no panel is nested inside another',
     panels.every(p => !p.parentElement.closest('.panel')));
  const names = panels.map(p => (p.querySelector('.t-section') || {textContent:''}).textContent);
  ok('the warehouse panels are there', names.indexOf('Warehouses') > -1 &&
     names.indexOf('Fulfilment routing') > -1 && names.indexOf('What is held where') > -1);
  ok('and they come after the stock, because stock has to be held somewhere',
     names.indexOf('Warehouses') > names.indexOf('Stock'));
}

head('ROUTING — the rules are configuration, and the order is the logic');
{
  const { w, G } = await load('operator.html');
  w.App = G('App'); w.App.go('inventory'); await wait(600);
  const main = w.document.getElementById('main');

  ok('a rule can be added', /routingRuleDialog\(\)/.test(main.innerHTML));
  ok('and each one edited', /routingRuleDialog\('/.test(main.innerHTML));
  ok('the order can be changed, because first match wins',
     /moveRoutingRule\('/.test(main.innerHTML));
  ok('the panel says the order is the logic',
     /First matching rule wins/.test(main.textContent));

  /* A returns centre holds ungraded stock. It can never be an outbound target. */
  ok('a returns centre is not offered as a destination',
     G("(function(){routingRuleDialog();" +
       "var o=[].slice.call(document.querySelectorAll('#rrWh option'));" +
       "var bad=o.filter(function(x){return (WHMAP[x.value]||{}).type==='returns'});" +
       "closeModal();return bad.length})()") === 0);
  ok('nor is a closed one',
     G("(function(){routingRuleDialog();" +
       "var o=[].slice.call(document.querySelectorAll('#rrWh option'));" +
       "var bad=o.filter(function(x){return (WHMAP[x.value]||{}).status!=='active'});" +
       "closeModal();return bad.length})()") === 0);

  w.eval('routingRuleDialog()'); await wait(240);
  set(w, 'rrCat', 'device'); set(w, 'rrMkt', 'IN');
  w.eval('rrPreview()'); await wait(120);
  ok('a rule shadowed by one above it is warned about',
     /already matches the same orders/.test(w.document.getElementById('rrOut').textContent));

  const n0 = G('WH_ROUTING.length');
  w.eval('saveRoutingRule(null)'); await wait(160);
  ok('a rule with no stated reason is refused', G('WH_ROUTING.length') === n0);
  set(w, 'rrWhy', 'Duplicate of an existing rule.');
  w.eval('saveRoutingRule(null)'); await wait(160);
  ok('and a duplicate of an existing category and market is refused too',
     G('WH_ROUTING.length') === n0 &&
     /already routes/.test(w.document.getElementById('rrOut').textContent));

  set(w, 'rrCat', 'content'); set(w, 'rrMkt', 'KE');
  w.eval('rrPreview()'); await wait(120);
  ok('a rule nothing shadows says where those orders would ship from',
     /would ship from/.test(w.document.getElementById('rrOut').textContent));
  set(w, 'rrWhy', 'Kenyan content fulfils from Bengaluru.');
  w.eval('saveRoutingRule(null)'); await wait(300);
  ok('a coherent rule is created', G('WH_ROUTING.length') === n0 + 1);
  ok('the fallback is still last', G("WH_ROUTING.slice().sort(function(a,b){" +
     "return a.priority-b.priority}).pop().category") === 'Any');
  ok('and the order is renumbered from position, never typed',
     G("(function(){var r=WH_ROUTING.filter(function(x){return x.priority<99})" +
       ".sort(function(a,b){return a.priority-b.priority});" +
       "return r.every(function(x,i){return x.priority===i+1})})()") === true);
  ok('it is on the audit log',
     G("auditRows('operator').some(function(e){return /Routing rule created/.test(e.detail||'')})"));

  /* Without a fallback an unmatched order has nowhere to go. */
  const fb = G("WH_ROUTING.filter(function(x){return x.category==='Any'&&x.market==='All'})[0].id");
  w.eval("removeRoutingRule('" + fb + "')"); await wait(180);
  ok('the fallback cannot be removed',
     G("WH_ROUTING.some(function(x){return x.id==='" + fb + "'})"));

  /* Removing a real rule says where its orders land instead. */
  const victim = G("WH_ROUTING.filter(function(x){return x.priority<99})[0].id");
  w.eval("removeRoutingRule('" + victim + "')"); await wait(220);
  const m = w.document.getElementById('modalHost');
  ok('removing one warns where its orders fall to',
     !!m && /fall to the next rule that matches/.test(m.textContent));
  ok('and names the rule that would take them',
     !!m && /would then ship from/.test(m.textContent));
  confirmDialog(w); await wait(260);
  ok('the rule is removed', !G("WH_ROUTING.some(function(x){return x.id==='" + victim + "'})"));
  ok('and the remaining order stays contiguous',
     G("(function(){var r=WH_ROUTING.filter(function(x){return x.priority<99})" +
       ".sort(function(a,b){return a.priority-b.priority});" +
       "return r.every(function(x,i){return x.priority===i+1})})()") === true);
}

console.log('\n' + (failures ? '✗ ' + failures + ' of ' + checks + ' checks failed'
                             : '✓ all ' + checks + ' onboarding, billing and artwork checks passed'));
process.exit(failures ? 1 : 0);

})();
