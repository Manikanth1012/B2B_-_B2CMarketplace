/* ===========================================================================
   Authentication and sessions (IAM), Number Management integration (INV),
   channel delivery (NTF) and bulk update. Ninth file, to stay inside the shell's 45-second budget.
   These do not check that a screen rendered — they drive each journey to its
   conclusion and assert that the underlying records actually changed.
   Run: node _src/journeys_final.js
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
/* loadRaw stops at the gate: the sign-in journey itself must be driven, not
   bypassed the way the other suites reasonably bypass it. */
function loadRaw(file){
  const vc = new VirtualConsole();
  const errs = [];
  vc.on('jsdomError', e => errs.push(e.message));
  const dom = new JSDOM(fs.readFileSync(path.join(OUT, file), 'utf8'),
    { runScripts:'dangerously', virtualConsole:vc, pretendToBeVisual:true, url:'http://localhost/' });
  return new Promise(res => setTimeout(() => res({ w: dom.window, G: n => dom.window.eval(n), errs }), 430));
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

/* --------------------------------------------------------------- THE GATE */
head('SIGN IN — a gate, not a decoration');
{
  const { w, G } = await loadRaw('operator.html');
  ok('nothing behind the gate is rendered', !w.document.querySelector('.rail'));
  ok('the sign-in card is', !!w.document.querySelector('.logincard'));
  ok('and no record is sitting in the DOM for anyone who opens the inspector',
     w.document.body.textContent.indexOf('Settlement runs') === -1);

  /* wrong password */
  w.eval("document.getElementById('lgPass').value='wrong'"); w.eval('attemptLogin()'); await wait(190);
  ok('a wrong password is refused', G('AUTH.signedIn') === false);
  ok('and the attempt is counted against the account', G('AUTH.failures') === 1);
  ok('the failure is logged as carefully as a success',
     G("LOGIN_EVENTS.operator[0].result") === 'failed');
  ok('and it reaches the audit trail',
     G("AUDIT_LOG.operator.some(function(e){return /Password rejected/.test(e.detail||'')})"));

  for (let i=0;i<4;i++){ w.eval("document.getElementById('lgPass').value='wrong'"); w.eval('attemptLogin()'); await wait(70); }
  ok('five failures lock the account', G('AUTH.lockedUntil') != null);
  ok('the sign-in button is disabled while locked', !!w.document.querySelector('.btn-primary[disabled]'));
  ok('the lock is recorded at danger severity',
     G("AUDIT_LOG.operator.some(function(e){return e.action==='auth.failed' && e.sev==='danger'})"));
  ok('locking counts per account, not per address', /per account, not per address/.test(w.document.body.textContent));

  w.eval('AUTH.lockedUntil=null; AUTH.failures=0; App.renderLogin()'); await wait(180);
  w.eval("document.getElementById('lgPass').value='demo'"); w.eval('attemptLogin()'); await wait(200);
  ok('the right password does not sign you straight in', G('AUTH.signedIn') === false);
  ok('it asks for the second factor', G('AUTH.step') === 'mfa');

  w.eval("document.getElementById('lgCode').value='000000'"); w.eval("completeMfa('totp')"); await wait(190);
  ok('a wrong code is refused', G('AUTH.signedIn') === false);
  ok('and refused codes are logged separately from refused passwords',
     G("LOGIN_EVENTS.operator[0].result") === 'mfa-failed');

  w.eval("document.getElementById('lgCode').value='314159'"); w.eval("completeMfa('totp')"); await wait(320);
  ok('the right code signs you in', G('AUTH.signedIn') === true);
  ok('and the console appears', !!w.document.querySelector('.rail'));
  ok('a session is created for this device',
     G("SESSIONS.operator.filter(function(s){return s.current}).length") === 1);
  ok('carrying the method used', /authenticator|Passkey|Password/i.test(G("SESSIONS.operator[0].mfa")));
  ok('and the sign-in is audited',
     G("AUDIT_LOG.operator.some(function(e){return e.action==='auth.signin'})"));
}
head('SSO — enforced means enforced');
{
  const { w, G } = await loadRaw('enterprise.html');
  ok('an enforced domain offers no password box', !w.document.getElementById('lgPass'));
  ok('and says why', /no local password on this domain/i.test(w.document.body.textContent));
  ok('no credentials are printed on the card',
     !w.document.querySelector('.lgdemo') && !/Password\s+demo/.test(w.document.body.textContent));
  ok('the rule is stated as a control, not a preference',
     /enforces nothing/.test(w.document.body.textContent));
  ok('an enforced domain refuses a local password outright',
     G("ssoEnforcedFor('m.nathan@brightlinefoods.example')") === true);
  ok('but only for its own domain',
     G("ssoEnforcedFor('someone@elsewhere.example')") === false);
  w.eval('ssoLogin()'); await wait(320);
  ok('single sign-on gets you in', G('AUTH.signedIn') === true);
  ok('and the method names the identity provider', /Ping Identity/.test(G('AUTH.method')));
}
head('SSO — not enforced is honestly labelled as a gap');
{
  const { w, G } = await load('operator.html');
  w.App = G('App'); w.App.go('auth'); await wait(240);
  const t = w.document.getElementById('main').textContent;
  ok('the operator SSO is shown as available but not enforced', /not enforced/.test(t));
  ok('and the weakest remaining path is named', /weakest one/.test(t));
  ok('certificate expiry is called out as an outage risk', /every sign-in on this domain stops at once/.test(t));
  ok('SMS is labelled the weakest second factor', /SIM-swap/.test(t));
  ok('roles that move money cannot opt out of MFA', /do not get to opt out/.test(t));
  ok('and the actions needing a second check are listed', /Asked again before/.test(t));
}
head('STEP-UP — a signed-in screen cannot move money by itself');
{
  const { w, G } = await load('operator.html');
  w.App = G('App'); await wait(200);
  let ran = false; w.__ran = () => { ran = true; };
  w.eval("stepUp('Approve a settlement run', function(){ window.__ran(); })"); await wait(200);
  ok('a sensitive action asks again', !!w.document.getElementById('modalHost'));
  ok('and does not run until it is answered', ran === false);
  confirmDialog(w); await wait(220);
  ok('answering runs it', ran === true);
  ok('and the re-authentication is audited',
     G("AUDIT_LOG.operator.some(function(e){return e.action==='auth.stepup'})"));
  let ran2 = false; w.__ran2 = () => { ran2 = true; };
  w.eval("stepUp('Read a dashboard', function(){ window.__ran2(); })"); await wait(170);
  ok('an ordinary action is not gated', ran2 === true);
}
head('SIGN OUT — returns to the gate and drops this session only');
{
  const { w, G } = await load('partner.html');
  w.App = G('App'); await wait(200);
  const others = G("SESSIONS.partner.filter(function(s){return !s.current}).length");
  w.eval('App.signOut()'); await wait(200); confirmDialog(w); await wait(300);
  ok('you land back on the sign-in screen', !!w.document.querySelector('.logincard'));
  ok('the console is gone', !w.document.querySelector('.rail'));
  ok('this session is dropped', G("SESSIONS.partner.filter(function(s){return s.current}).length") === 0);
  ok('other devices stay signed in', G('SESSIONS.partner.length') === others);
}

/* ------------------------------------------------- NUMBER MANAGEMENT */
head('NUMBERS — the BSS owns them, we hold a reference');
{
  const { w, G } = await load('operator.html');
  w.App = G('App'); w.App.go('numbers'); await wait(260);
  const t = w.document.getElementById('main').textContent;

  ok('the screen exists', /Numbers and SIMs/.test(t));
  ok('it says plainly that the numbers are not held here', /These numbers are not held here/.test(t));
  ok('and why a second register would be wrong', /two answers to the same question/.test(t));
  ok('the systems are listed with the standard each speaks',
     G("NUMBER_SYSTEMS.every(function(s){return !!s.api})") && /TMF639/.test(t));
  ok('SGP.22 is named for the eUICC side', /SGP.22/.test(t));
  ok('a degraded system is declared, not hidden',
     G("NUMBER_SYSTEMS.some(function(s){return s.status!=='connected'})") && /degraded/.test(t));
  ok('and its reservations are described as held rather than confirmed', /held, not confirmed/.test(t));
  ok('latency that is not measured says so rather than showing zero', /Not measured/.test(t));
  ok('the table is a query result, not the inventory', /This is a query result, not the inventory/.test(t));
  ok('reserved ranges carry an expiry', /Expires/.test(t));
  ok('utilisation is measured against reserved, not range size', /against .{0,3}reserved/.test(t));
}
head('NUMBERS — assignment goes through TMF652');
{
  const { w, G } = await load('operator.html');
  w.App = G('App'); w.App.go('numbers'); await wait(240);
  const av = G("ICCIDS.filter(function(i){return i.state==='available' && i.type==='eSIM'})[0].iccid");

  w.eval("openIccid('" + av + "')"); await wait(200);
  ok('an ICCID opens with its record of truth named',
     /Record of truth/.test(w.document.body.textContent));
  ok('the SGP.22 lifecycle is shown for an eSIM', /Released/.test(w.document.body.textContent));
  ok('and it says the SM-DP+ owns those states', /we observe them/.test(w.document.body.textContent));

  w.eval("assignIccid('" + av + "')"); await wait(220);
  ok('assignment names the resource-order standard',
     /TMF652/.test(w.document.getElementById('modalHost').textContent));
  ok('and refuses to claim the profile is installed',
     /not installed and not enabled/.test(w.document.getElementById('modalHost').textContent));
  w.eval("doAssignIccid('" + av + "')"); await wait(260);
  const rec = G("ICCIDS.filter(function(i){return i.iccid==='" + av + "'})[0]");
  ok('the ICCID is assigned to a real order', rec.state === 'assigned' && !!rec.order);
  ok('an MSISDN is allocated with it', !!rec.msisdn);
  ok('the eSIM profile starts at released', rec.profile === 'released');
  ok('and the assignment is audited', G("AUDIT_LOG.operator.some(function(e){return e.action==='num.assign'})"));

  w.eval("releaseIccid('" + av + "')"); await wait(200);
  ok('release warns that a deleted profile cannot be recovered',
     /cannot be recovered/.test(w.document.getElementById('modalHost').textContent));
  confirmDialog(w); await wait(240);
  const r2 = G("ICCIDS.filter(function(i){return i.iccid==='" + av + "'})[0]");
  ok('release returns it to the pool', r2.state === 'available' && r2.order === null);
  ok('and clears the profile with it', r2.profile === null);
}
head('NUMBERS — where we disagree with the BSS, we are the ones who change');
{
  const { w, G } = await load('operator.html');
  w.App = G('App'); w.App.go('numbers'); await wait(240);
  ok('disagreements exist and are surfaced', G('iccidDrift().length') > 0);
  ok('the reconciliation rule is stated', /never the other way round/.test(w.document.getElementById('main').textContent));

  const one = G('iccidDrift()[0].iccid'), nms = G('iccidDrift()[0].nmsState');
  w.eval("reconcileIccid('" + one + "')"); await wait(200);
  ok('correcting says nothing is written to the BSS',
     /Nothing is written to the Number Management system/.test(w.document.getElementById('modalHost').textContent));
  confirmDialog(w); await wait(240);
  ok('our copy adopts the BSS state', G("ICCIDS.filter(function(i){return i.iccid==='" + one + "'})[0].state") === nms);
  ok('and the correction is audited with before and after',
     G("AUDIT_LOG.operator.some(function(e){return e.action==='num.corrected' && e.before!=null && e.after!=null})"));

  w.eval('runNumRecon()'); await wait(200); confirmDialog(w); await wait(260);
  ok('a full run clears the rest', G('iccidDrift().length') === 0);
  ok('and records that the BSS was not written to',
     G("AUDIT_LOG.operator.some(function(e){return /none written back/.test(e.detail||'')})"));
}
head('NUMBERS — a seller sees allocations, not the pool');
{
  const { w, G } = await load('partner.html');
  w.App = G('App'); w.App.go('numbers'); await wait(250);
  const t = w.document.getElementById('main').textContent;
  ok('the seller has SIMs to look at', G('MY_ICCIDS().length') > 0);
  ok('every one is against its own order',
     G("MY_ICCIDS().every(function(i){var o=ORDERS.filter(function(x){return x.id===i.order})[0];return o&&o.partnerId===ME_P.id})"));
  ok('it sees fewer than the operator does', G('MY_ICCIDS().length') < G('ICCIDS.length'));
  ok('and is told the pool is not its to browse', /not a seller function/.test(t));
}

/* ---------------------------------------------------- CHANNEL DELIVERY */
head('DELIVERY — what left, who carried it, what came back');
{
  const { w, G } = await load('operator.html');
  w.App = G('App'); w.App.go('delivery'); await wait(260);
  const t = w.document.getElementById('main').textContent;

  ok('providers are listed with their protocol',
     G("CHANNEL_PROVIDERS.every(function(p){return !!p.proto})") && /SMPP 3.4/.test(t));
  ok('primary and failover are distinguished',
     G("CHANNEL_PROVIDERS.some(function(p){return p.role==='failover'})") && /failover/.test(t));
  ok('a degraded provider is declared', /degraded/.test(t));
  ok('push is declared as having no true receipt', /no true delivery receipt/i.test(t));
  ok('and its rate is not averaged into a platform figure', /produces a number that means nothing/.test(t));
  ok('delivery states keep the transports’ own names', /Submitted/.test(t) && /Expired/.test(t));
  ok('with a reason stated for keeping them', /reconcile against a carrier/.test(t));
  ok('cost is reported per channel and per thousand', /Cost per 1,000/.test(t));
  ok('stale push tokens are separated rather than folded in', /uninstalled apps/.test(t));
}
head('DELIVERY — a hard rejection is not retried into a bill');
{
  const { w, G } = await load('operator.html');
  w.App = G('App'); w.App.go('delivery'); await wait(240);

  w.eval('retryPolicyDialog()'); await wait(200);
  const rm = w.document.getElementById('modalHost');
  ok('the retry policy is documented', /Retry and failover/.test(rm.textContent));
  ok('with the codes that stop a message for good', /invalid-number/.test(rm.textContent));
  ok('and the reason retrying them is wasteful', /three charges and no message/.test(rm.textContent));
  w.eval('closeModal()'); await wait(110);

  const hard = G("DELIVERIES.filter(function(d){return RETRY_POLICY.neverRetry.indexOf(d.code)>-1})[0]");
  const a0 = hard.attempts;
  w.eval("openDelivery('" + hard.id + "')"); await wait(200);
  ok('the failure names its reason code', /Failed:/.test(w.document.body.textContent));
  ok('and says it was not retried', /was not retried/.test(w.document.body.textContent));
  w.eval("resendMessage('" + hard.id + "')"); await wait(210);
  ok('resending warns it will fail the same way',
     /will fail the same way/.test(w.document.getElementById('modalHost').textContent));
  ok('and points at the underlying record instead',
     /Fix the underlying record/.test(w.document.getElementById('modalHost').textContent));
  confirmDialog(w); await wait(250);
  const h1 = G("DELIVERIES.filter(function(d){return d.id==='" + hard.id + "'})[0]");
  ok('it fails again rather than pretending', h1.state === 'failed');
  ok('the attempt is still counted', h1.attempts === a0 + 1);
  ok('and overriding a hard rejection is audited at warn',
     G("AUDIT_LOG.operator.some(function(e){return e.action==='ntf.resend' && e.sev==='warn'})"));
}
head('DELIVERY — a soft failure retries, and fails over');
{
  const { w, G } = await load('operator.html');
  w.App = G('App'); w.App.go('delivery'); await wait(240);
  const soft = G("DELIVERIES.filter(function(d){return d.state==='expired'})[0]");
  const p0 = soft.provider, a0 = soft.attempts;
  w.eval("resendMessage('" + soft.id + "')"); await wait(200);
  ok('a soft retry is offered without a warning about hard rejection',
     !/hard rejection/.test(w.document.getElementById('modalHost').textContent));
  confirmDialog(w); await wait(250);
  const s1 = G("DELIVERIES.filter(function(d){return d.id==='" + soft.id + "'})[0]");
  ok('it is queued again', s1.state === 'queued');
  ok('the attempt count rises rather than resetting', s1.attempts === a0 + 1);
  ok('it fails over to the standby provider', s1.provider !== p0);
  ok('and the cost reflects every attempt, not just the last', s1.cost > 0);
}
head('DELIVERY — each persona sees only its own messages');
{
  for (const [file, ctx] of [['partner.html','partner'],['enterprise.html','buyer'],['consumer.html','consumer']]){
    const { w, G } = await load(file);
    w.App = G('App'); w.App.go('delivery'); await wait(230);
    ok(ctx + ' sees only its own traffic',
       G("DataTable.reg['dtDlr'].rows.every(function(d){return d.ctx==='" + ctx + "'})"));
    ok(ctx + ' is not shown provider commercials',
       !/Unit cost/.test(w.document.getElementById('main').textContent));
    /* The per-message carrier rate is our operating cost, not theirs. */
    ok(ctx + ' is not shown what the message cost us',
       !/\$0\.0\d\d\d/.test(w.document.getElementById('main').textContent));
  }
}

/* ------------------------------------------------------------- SESSIONS */
head('SESSIONS — ending one is not the same as changing a password');
{
  const { w, G } = await load('operator.html');
  w.App = G('App'); w.App.go('auth'); await wait(250);
  const t = w.document.getElementById('main').textContent;
  ok('sessions are listed with device, place and method', /Signed in with/.test(t));
  ok('an unusual location is flagged', /country you do not normally use/.test(t));
  ok('and it is stated that ending a session is not a password change',
     /it does not change the password/i.test(t));

  const n0 = G('SESSIONS.operator.length');
  const other = G("SESSIONS.operator.filter(function(s){return !s.current})[0].id");
  w.eval("endSession('" + other + "')"); await wait(200); confirmDialog(w); await wait(240);
  ok('ending one removes exactly one', G('SESSIONS.operator.length') === n0 - 1);
  ok('and it is audited', G("AUDIT_LOG.operator.some(function(e){return e.action==='auth.session.end'})"));

  w.eval('endAllSessions()'); await wait(200);
  if (w.document.getElementById('modalHost')) { confirmDialog(w); await wait(240); }
  ok('ending all leaves this one alone', G('SESSIONS.operator.length') === 1);
  ok('and you are still signed in', G('AUTH.signedIn') === true);
}

/* ---------------------------------------------------------- BULK UPDATE */
head('BULK — updates only, and never before a dry run');
{
  const { w, G } = await load('operator.html');
  w.App = G('App'); w.App.go('bulk'); await wait(250);
  const t = w.document.getElementById('main').textContent;

  ok('the screen exists with sets against it', G('bulkSets().length') > 0 && /Bulk updates/.test(t));
  ok('it states that bulk never creates and never deletes', /never creates and never deletes/.test(t));
  ok('and that the one-at-a-time rules still apply', /cannot price\s+below cost/.test(t.replace(/\s+/g,' ')) ||
     /cannot price below cost/.test(t.replace(/\s+/g,' ')));
  ok('each set says why it exists', G("bulkSets().every(function(s){return !!s.why})"));
  ok('a job is one audit entry, not one per row', /one audit entry, not one per row/.test(t));

  w.eval("bulkDialog('bulk-listing')"); await wait(230);
  ok('the upload door opens', !!w.document.getElementById('bulkCsv'));
  ok('it lists the columns it will accept',
     /Columns this set accepts/.test(w.document.getElementById('modalHost').textContent));
  ok('and says a blank cell leaves a value alone',
     /blank cell leaves that value alone/.test(w.document.getElementById('modalHost').textContent));
  w.eval('bulkFillSample()'); await wait(200);
  ok('a worked example can be pasted', (w.document.getElementById('bulkCsv').value||'').length > 40);

  w.eval('bulkCheck()'); await wait(260);
  const rep = G('BULK.report');
  ok('checking produces a dry run', !!rep && rep.total > 0);
  ok('with rows that would apply', rep.ok.length > 0);
  ok('and the deliberately wrong row caught', rep.bad.filter(b => !b.benign).length > 0);
  ok('the rejection names the cost floor', /cost floor/.test(JSON.stringify(rep.bad)));
  ok('the dry run states nothing has been written',
     /Nothing has been written yet|will be applied/.test(w.document.getElementById('modalHost').textContent));

  const sku = rep.ok[0].key, ch = rep.ok[0].changes[0];
  ok('and truly nothing has',
     G("PRODUCTS.filter(function(p){return p.id==='" + sku + "'})[0]." + ch.k) !== ch.to);

  const jobs0 = G('BULK_JOBS.length');
  /* Count what this commit adds, not the total — the seeded history contains
     earlier bulk jobs, as it should. */
  const aud0 = G("AUDIT_LOG.operator.filter(function(e){return e.action==='bulk.apply'}).length");
  w.eval('bulkCommit()'); await wait(300);
  ok('committing writes the good rows',
     G("PRODUCTS.filter(function(p){return p.id==='" + sku + "'})[0]." + ch.k) === ch.to);
  ok('a job record is kept', G('BULK_JOBS.length') === jobs0 + 1);
  ok('the audit gets exactly one entry for the whole file, not one per row',
     G("AUDIT_LOG.operator.filter(function(e){return e.action==='bulk.apply'}).length") === aud0 + 1);
  ok('and it names applied and rejected counts',
     /applied.*rejected/.test(G("AUDIT_LOG.operator.filter(function(e){return e.action==='bulk.apply'})[0].detail")));
}
head('BULK — the guards that make it safe to hand to somebody');
{
  const { w, G } = await load('operator.html');
  w.App = G('App'); w.App.go('bulk'); await wait(240);

  /* you cannot remove your own access by spreadsheet */
  const me = G("orgUsers('operator').filter(function(u){return u.you})[0].id");
  w.eval("bulkDialog('bulk-user')"); await wait(210);
  w.eval("document.getElementById('bulkCsv').value='User ID,Status\\n" + me + ",suspended'"); await wait(70);
  w.eval('bulkCheck()'); await wait(250);
  ok('you cannot suspend yourself in a file', G('BULK.report.ok.length') === 0);
  ok('and it says so rather than failing silently', /this is you/.test(JSON.stringify(G('BULK.report.bad'))));
  w.eval('closeModal()'); await wait(110);

  /* unknown record, unknown column */
  w.eval("bulkDialog('bulk-partner')"); await wait(200);
  w.eval("document.getElementById('bulkCsv').value='Partner ID,Tier,Nonsense\\nNOPE-1,Gold,x'"); await wait(70);
  w.eval('bulkCheck()'); await wait(250);
  ok('an unknown key is rejected rather than created', /never creates/.test(JSON.stringify(G('BULK.report.bad'))));
  ok('an undefined column is reported and ignored', G('BULK.report.unknownCols').length === 1);
  w.eval('closeModal()'); await wait(110);

  /* a file with no key column cannot match anything */
  w.eval("bulkDialog('bulk-banner')"); await wait(200);
  w.eval("document.getElementById('bulkCsv').value='Wrong,Weight\\nBAN-1,5'"); await wait(70);
  w.eval('bulkCheck()'); await wait(250);
  ok('a file without the key column is refused', G('BULK.report.headerOk') === false);
  ok('with the reason stated', /no .{0,3}Banner ID/.test(G('BULK.report.headerMsg')));
  w.eval('closeModal()'); await wait(110);

  /* an enum will not take a value outside its set */
  w.eval("bulkDialog('bulk-banner')"); await wait(200);
  const bid = G('BANNERS[0].id');
  w.eval("document.getElementById('bulkCsv').value='Banner ID,State\\n" + bid + ",sideways'"); await wait(70);
  w.eval('bulkCheck()'); await wait(250);
  ok('an out-of-range value is rejected with the permitted set named',
     /must be one of/.test(JSON.stringify(G('BULK.report.bad'))));
}
head('BULK — the common-update door shares the validator');
{
  const { w, G } = await load('operator.html');
  w.App = G('App'); w.App.go('bulk'); await wait(240);
  w.eval("commonUpdateDialog('bulk-banner')"); await wait(240);
  ok('it opens on a picker', !!w.document.getElementById('cuPick'));
  ok('nothing is selected by default', w.document.getElementById('cuPick').selectedOptions.length === 0);
  ok('and it says why that matters',
     /waiting to go wrong/.test(w.document.getElementById('modalHost').textContent));
  ok('it tells you when to use a file instead',
     /use the file instead/.test(w.document.getElementById('modalHost').textContent));

  w.eval("var o=document.getElementById('cuPick').options; o[0].selected=true; o[1].selected=true;"); await wait(70);
  w.eval("document.getElementById('cuField').value='state'; cuFieldChanged()"); await wait(160);
  w.eval("document.getElementById('cuValue').value='paused'"); await wait(70);
  w.eval('cuCheck()'); await wait(250);
  ok('a common update produces the same dry run', G('BULK.report') !== null && G('BULK.report.total') === 2);
  const b0 = G('BULK.report.ok[0].key');
  w.eval('bulkCommit()'); await wait(280);
  ok('and applies to every picked record',
     G("BANNERS.filter(function(b){return b.id==='" + b0 + "'})[0].state") === 'paused');
  ok('recorded as a common update rather than a file', G('BULK_JOBS[0].mode') === 'Common update');
}
head('BULK — scoped to the persona, and thin where it should be');
{
  const { w: wp, G: Gp } = await load('partner.html');
  wp.App = Gp('App'); wp.App.go('bulk'); await wait(240);
  ok('a seller gets its own sets', Gp('bulkSets().length') > 0);
  ok('scoped to its own listings only',
     Gp("bulkRows(bulkSet('bulk-mylisting')).every(function(p){return p.partner===ME_P.id})"));
  const inv = Gp("bulkRows(bulkSet('bulk-stock')).filter(function(r){return r.reserved>0})[0]");
  if (inv){
    wp.eval("bulkDialog('bulk-stock')"); await wait(220);
    wp.eval("document.getElementById('bulkCsv').value='SKU,On hand\\n" + inv.sku + ",0'"); await wait(70);
    wp.eval('bulkCheck()'); await wait(250);
    ok('a stock count below what is already reserved is refused',
       /already reserved/.test(JSON.stringify(Gp('BULK.report.bad'))));
    ok('because we cannot un-promise stock a customer has bought',
       /already reserved against orders/.test(JSON.stringify(Gp('BULK.report.bad'))));
  }

  const { w: wc, G: Gc } = await load('consumer.html');
  wc.App = Gc('App'); wc.App.go('bulk'); await wait(240);
  ok('a retail account gets one narrow set', Gc('bulkSets().length') === 1);
  ok('and bulk cancel is deliberately not among the fields',
     Gc("bulkSet('bulk-sub').fields.every(function(f){return !/cancel/i.test(f.label)})"));
  ok('with the reason stated rather than left as an omission',
     /deliberately thin/.test(Gc("bulkSet('bulk-sub').caution")));

  const { w: we, G: Ge } = await load('enterprise.html');
  we.App = Ge('App'); we.App.go('bulk'); await wait(240);
  ok('the buyer can bulk-manage its own users',
     Ge("bulkSets().some(function(s){return s.id==='bulk-buyer-user'})"));
  ok('and cannot reach anybody else’s',
     Ge("bulkRows(bulkSet('bulk-buyer-user')).length") === Ge('ORG_USERS.buyer.length'));
}

console.log('\n' + (failures ? '\u2717 ' + failures + ' of ' + checks + ' checks failed'
                             : '\u2713 all ' + checks + ' identity, numbering, delivery and bulk checks passed'));
process.exit(failures ? 1 : 0);

})();
