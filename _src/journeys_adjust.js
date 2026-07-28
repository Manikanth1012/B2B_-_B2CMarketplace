/* ===========================================================================
   Channels, seller-governed collections, credit and debit notes, and refunds.
   Eleventh file, to stay inside the shell's 45-second budget.
   These do not check that a screen rendered — they drive each journey to its
   conclusion and assert that the underlying records actually changed.
   Run: node _src/journeys_adjust.js
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

/* ---------------------------------------------------------------- CHANNELS */
head('CHANNELS — a channel is managed, not hard-coded');
{
  const { w, G } = await load('operator.html');
  w.App = G('App'); w.App.go('delivery'); await wait(230);

  ok('every ladder step names channel ids rather than a prose combination',
     G("DUNNING_LADDERS.every(function(l){return l.steps.every(function(s){return Array.isArray(s.channels)})})"));
  ok('no step still carries the old single-channel field',
     G("DUNNING_LADDERS.every(function(l){return l.steps.every(function(s){return s.channel===undefined})})"));
  ok('a disabled channel ships in the master so the reason survives',
     G("CHANNELS.some(function(c){return !c.enabled})"));

  const n0 = G('CHANNELS.length');
  w.eval("channelDialog(null)"); await wait(120);
  w.eval("document.getElementById('chName').value='Postcard'");
  w.eval("document.getElementById('chKind').value='physical'");
  w.eval("document.getElementById('chNote').value='Cheap physical contact for a soft first notice.'");
  w.eval("saveChannel(null)"); await wait(240);
  ok('a new channel is added', G('CHANNELS.length') === n0 + 1);
  ok('and is immediately selectable on a ladder step',
     G("chanOn().some(function(c){return c.label==='Postcard'})"));

  /* A digital channel with no transport would accept messages and send nothing. */
  w.eval("channelDialog(null)"); await wait(120);
  w.eval("document.getElementById('chName').value='Fax'");
  w.eval("document.getElementById('chKind').value='digital'");
  w.eval("document.getElementById('chTrans').value=''");
  const n1 = G('CHANNELS.length');
  w.eval("saveChannel(null)"); await wait(150);
  ok('a digital channel with no transport is refused', G('CHANNELS.length') === n1);
  ok('and it says why',
     /needs a transport/.test(w.document.getElementById('chWarn').textContent));

  /* A duplicate name makes every ladder ambiguous. */
  w.eval("document.getElementById('chName').value='Email'");
  w.eval("document.getElementById('chKind').value='physical'");
  w.eval("saveChannel(null)"); await wait(150);
  ok('a duplicate channel name is refused', G('CHANNELS.length') === n1);
  w.eval("closeModal()"); await wait(80);

  /* Disabling something a ladder uses has to be confronted, not silent. */
  ok('SMS is in use by ladder steps', G("chanUsage('sms').steps") > 0);
  w.eval("toggleChannel('sms')"); await wait(150);
  ok('disabling a channel in use asks first', G("CHMAP['sms'].enabled") === true);
  ok('and names the ladders that would break',
     /Affected ladders/.test(w.document.getElementById('modalHost').textContent));
  confirmDialog(w); await wait(220);
  ok('confirming actually disables it', G("CHMAP['sms'].enabled") === false);
  ok('a step that has lost one of two channels is flagged as degraded, not broken',
     G("DUNNING_LADDERS.some(function(l){return l.steps.some(function(s){return !!stepDegraded(s)})})"));
  ok('a step still sending on its other channel is not called dark',
     G("DUNNING_LADDERS.every(function(l){return l.steps.every(function(s){" +
       "return !(stepDark(s) && s.channels.indexOf('email')>=0)})})"));
  w.eval("chanSetEnabled('sms',true)"); await wait(180);
  ok('re-enabling clears both flags',
     G("DUNNING_LADDERS.every(function(l){return l.steps.every(function(s){" +
       "return !stepDark(s) && !stepDegraded(s)})})"));
}

/* ------------------------------------------------------- LADDER GOVERNANCE */
head('COLLECTIONS — who sets the pacing');
{
  const { w, G } = await load('partner.html');
  w.App = G('App'); w.App.go('collections'); await wait(240);
  const t = w.document.getElementById('main').textContent;

  ok('the seller has a collections screen at all', t.length > 800);
  ok('every live partner was given a ladder at onboarding',
     G("PARTNERS.filter(function(p){return p.status==='live'}).every(function(p){return partnerLadders(p.id).length>0})"));
  ok('the seeded ladders name the profile they came from',
     G("DUNNING_LADDERS.filter(function(l){return l.owner==='partner'}).every(function(l){return !!l.fromProfile})"));
  ok('a bundled case is governed by the marketplace, not the seller',
     G("DUNNING_CASES.filter(function(c){return c.bundleId}).every(function(c){return dunGovernor(c).owner==='operator'})"));
  ok('and the reason given is the bundle',
     G("dunGovernor(DUNNING_CASES.filter(function(c){return c.bundleId})[0]).reason") === 'bundled');
  ok('a direct sale is governed by the seller',
     G("dunGovernor({sellerId:'PTR-1004',bundleId:null,ctx:'consumer',amount:40}).owner") === 'partner');
  ok('what a seller owes the marketplace is never theirs to pace',
     G("dunGovernor({ctx:'partner',sellerId:'PTR-1004',amount:900}).owner") === 'operator');
  ok('the screen says so on the page', /marketplace sets it for/i.test(t));

  /* A seller may edit their own ladder. */
  const own = G("partnerLadders(ME_P.id)[0].id");
  w.eval("ladderDialog('" + own + "','" + G('ME_P.id') + "')"); await wait(150);
  ok('a seller can open their own ladder for editing', G('window.__LADRO') === false);
  w.eval("closeModal()"); await wait(80);

  /* But not the marketplace one that overrides it. */
  w.eval("ladderDialog('DL-CON','" + G('ME_P.id') + "')"); await wait(150);
  ok('a marketplace ladder opens read-only for a seller', G('window.__LADRO') === true);
  ok('and it says the marketplace owns it',
     /only the marketplace can change it/.test(w.document.getElementById('modalHost').textContent));
  const before = G("DLMAP['DL-CON'].steps.length");
  w.eval("saveLadder('DL-CON')"); await wait(150);
  ok('a save on a read-only ladder is refused',
     G("DLMAP['DL-CON'].steps.length") === before);
  w.eval("closeModal()"); await wait(80);
}

/* ------------------------------------------------------ LADDER VALIDATION */
head('LADDER VALIDATION — a step can be well sequenced and still reach nobody');
{
  const { w, G } = await load('operator.html');
  w.App = G('App'); w.App.go('collections'); await wait(240);
  ok('the operator can see what sellers did with the default',
     /Seller ladders/.test(w.document.getElementById('main').textContent));
  ok('drift from the published default is visible',
     G("DUNNING_LADDERS.some(function(l){return l.owner==='partner'&&l.edited})"));

  w.eval("ladderDialog('DL-CON')"); await wait(150);
  w.eval("window.__LAD[3].channels=[]"); w.eval("ldPreview()"); await wait(80);
  ok('a step with no channel is called out',
     /has no channel/.test(w.document.getElementById('ldWarn').textContent));
  w.eval("window.__LAD[3].channels=['inapp']"); w.eval("ldPreview()"); await wait(80);
  ok('a final notice sent only where they must come looking is called out',
     /has to come looking/.test(w.document.getElementById('ldWarn').textContent));
  w.eval("closeModal()"); await wait(80);
}

/* ---------------------------------------------------------------- NOTES */
head('CREDIT AND DEBIT NOTES — between the marketplace and a seller only');
{
  const { w, G } = await load('operator.html');
  w.App = G('App'); w.App.go('notes'); await wait(240);
  const n0 = G('CREDIT_NOTES.length');

  w.eval("noteDialog(null)"); await wait(140);
  w.eval("document.getElementById('cnType').value='debit'"); w.eval("cnReasons()"); await wait(80);
  ok('the reasons change with the type',
     G("document.getElementById('cnReason').options.length") ===
     G("NOTE_REASONS.filter(function(r){return r.type==='debit'}).length"));

  /* No amount, no note. */
  w.eval("saveNote()"); await wait(100);
  ok('a note with no amount is refused', G('CREDIT_NOTES.length') === n0);

  /* Above the evidence threshold a reference is mandatory. */
  w.eval("document.getElementById('cnAmt').value='3000'");
  w.eval("document.getElementById('cnDetail').value='SLA breached on 20 orders.'");
  w.eval("saveNote()"); await wait(100);
  ok('a large note with no reference is refused', G('CREDIT_NOTES.length') === n0);
  ok('and it says a reference is required',
     /reference is required/.test(w.document.getElementById('cnWarn').textContent));

  w.eval("document.getElementById('cnRef').value='Contract cl. 8.2'");
  w.eval("saveNote()"); await wait(240);
  ok('a complete note is raised', G('CREDIT_NOTES.length') === n0 + 1);
  const nid = G('CREDIT_NOTES[CREDIT_NOTES.length-1].id');
  ok('below the second-approval threshold it is issued outright',
     G("CNMAP['" + nid + "'].state") === 'issued');
  ok('it is numbered as a debit note', /^DN-/.test(nid));

  /* Above the threshold, one signature is not enough. */
  w.eval("noteDialog(null)"); await wait(140);
  w.eval("document.getElementById('cnType').value='credit'"); w.eval("cnReasons()"); await wait(60);
  w.eval("document.getElementById('cnAmt').value='9000'");
  w.eval("document.getElementById('cnRef').value='SET-2026-06-1001'");
  w.eval("document.getElementById('cnDetail').value='Platform fee billed twice in the June run.'");
  w.eval("saveNote()"); await wait(240);
  const big = G('CREDIT_NOTES[CREDIT_NOTES.length-1].id');
  ok('above the threshold it waits for a second approver',
     G("CNMAP['" + big + "'].state") === 'pending');
  w.eval("approveNote('" + big + "')"); await wait(200);
  ok('approving issues it', G("CNMAP['" + big + "'].state") === 'issued');
  ok('and records who approved it', G("CNMAP['" + big + "'].approver") === 'You');

  /* The policy cannot be set to something incoherent. */
  w.eval("notePolicyDialog()"); await wait(140);
  w.eval("document.getElementById('npAuto').value='9000'");
  w.eval("document.getElementById('npSecond').value='100'");
  const secBefore = G('NOTE_POLICY.secondApprovalAbove');
  w.eval("saveNotePolicy()"); await wait(120);
  ok('a second-approval threshold below the auto-approval one is refused',
     G('NOTE_POLICY.secondApprovalAbove') === secBefore);
  w.eval("closeModal()"); await wait(80);

  /* A note posts to the ledger the way the mapping says. */
  ok('a credit note gives revenue back rather than creating it',
     G("GL_MAPPING['note.credit'].dr") === '4010');
  ok('a debit note is the only adjustment that increases revenue',
     G("GL_MAPPING['note.debit'].cr") === '4010');
  ok('and neither posts before it has actually landed',
     G("GL_POSTINGS.filter(function(p){return p.charge==='note.credit'||p.charge==='note.debit'}).length") ===
     G("CREDIT_NOTES.filter(function(n){return (n.state==='issued'||n.state==='applied')&&!n.isNew}).length"));
}

/* --------------------------------------------------------- NOTE DISPUTE */
head('NOTE DISPUTE — a challenged note does not quietly settle');
{
  const { w, G } = await load('partner.html');
  w.App = G('App'); w.App.go('notes'); await wait(240);
  const mine = G("CREDIT_NOTES.filter(function(n){return n.partnerId===ME_P.id&&n.state==='issued'})[0]");
  if (mine){
    const id = G("CREDIT_NOTES.filter(function(n){return n.partnerId===ME_P.id&&n.state==='issued'})[0].id");
    w.eval("disputeNote('" + id + "')"); await wait(140);
    w.eval("document.getElementById('dnWhy').value='The promotion was funded by us, not the marketplace.'");
    confirmDialog(w); await wait(220);
    ok('a seller can dispute a note', G("CNMAP['" + id + "'].state") === 'disputed');
    ok('and their reason is kept', /promotion was funded/.test(G("CNMAP['" + id + "'].dispute")));
  } else {
    ok('a seller has a note to dispute', false, 'no issued note found for the demo seller');
  }
}

/* -------------------------------------------------------------- REFUNDS */
head('REFUNDS — the party who sold it decides');
{
  const { w, G } = await load('partner.html');
  w.App = G('App'); w.App.go('refunds'); await wait(240);
  const t = w.document.getElementById('main').textContent;

  ok('a first-party refund is the marketplace’s call',
     G("refundApprover(REFUNDS.filter(function(r){return r.firstParty})[0]).owner") === 'operator');
  ok('a bundled refund is the marketplace’s call',
     G("refundApprover(REFUNDS.filter(function(r){return r.bundleId})[0]).owner") === 'operator');
  ok('a direct sale is the seller’s call',
     G("refundApprover({sellerId:'PTR-1004',firstParty:false,bundleId:null,state:'requested'}).owner") === 'partner');
  ok('an escalated decline moves to the marketplace',
     G("refundApprover({sellerId:'PTR-1004',firstParty:false,bundleId:null,state:'escalated'}).owner") === 'operator');
  ok('the seller is told what they fund but do not decide',
     /funded by you/i.test(t) || /Decided by the marketplace/i.test(t));

  /* The seller decides one of their own. */
  const own = G("REFUNDS.filter(function(r){return r.sellerId===ME_P.id&&r.state==='requested'&&" +
                "refundApprover(r).owner==='partner'})[0].id");
  w.eval("refundDecide('" + own + "')"); await wait(150);
  w.eval("document.getElementById('rdWhat').value='decline'"); w.eval("rdAmt()"); await wait(60);
  w.eval("saveRefundDecision('" + own + "')"); await wait(140);
  ok('a decline with no reason is refused', G("RFNMAP['" + own + "'].state") === 'requested');
  ok('and it says why a reason matters',
     /needs a reason/.test(w.document.getElementById('rdWarn').textContent));

  w.eval("document.getElementById('rdWhat').value='partial'"); w.eval("rdAmt()"); await wait(60);
  w.eval("document.getElementById('rdAmount').value='" + G("RFNMAP['" + own + "'].amount") + "'");
  w.eval("document.getElementById('rdWhy').value='Two of four sensors replaced.'");
  w.eval("saveRefundDecision('" + own + "')"); await wait(140);
  ok('a part refund for the full amount is refused', G("RFNMAP['" + own + "'].state") === 'requested');

  w.eval("document.getElementById('rdAmount').value='30'");
  w.eval("saveRefundDecision('" + own + "')"); await wait(240);
  ok('a valid part refund is recorded', G("RFNMAP['" + own + "'].state") === 'partial');
  ok('the amount refunded is the part, not the whole', G("RFNMAP['" + own + "'].refundedAmount") === 30);
  ok('and it names who decided', /Nimbus Sensors/.test(G("RFNMAP['" + own + "'].decidedBy")));
}

/* --------------------------------------------------- REFUND ESCALATION */
head('REFUND ESCALATION — the clock does it, not the customer');
{
  const { w, G } = await load('consumer.html');
  w.App = G('App'); w.App.go('refunds'); await wait(240);

  ok('the customer is never offered an Escalate control',
     !/>Escalate</.test(w.document.getElementById('main').innerHTML));

  /* A decline the seller cannot evidence does not get to stand on their say-so. */
  const dec = G("REFUNDS.filter(function(r){return r.ctx==='consumer'&&r.state==='declined'})[0].id");
  w.eval("RFNMAP['" + dec + "'].evidence=null");
  ok('an unevidenced decline is due for escalation',
     G("refundEscalationDue(RFNMAP['" + dec + "'])") === true);
  w.eval("refundSlaSweep()"); await wait(120);
  ok('the SLA escalates it with no customer action', G("RFNMAP['" + dec + "'].state") === 'escalated');
  ok('and it records why the platform did it',
     /evidence/i.test(G("RFNMAP['" + dec + "'].escalatedWhy")));
  ok('and the marketplace now owns the decision',
     G("refundApprover(RFNMAP['" + dec + "']).owner") === 'operator');
  ok('the reason given no longer credits the customer',
     !/customer escalated/i.test(G("refundApprover(RFNMAP['" + dec + "']).why")));

  /* A request inside the window is left alone — the clock is a limit, not a trigger. */
  const fresh = G("REFUNDS.filter(function(r){return r.state==='requested'})[0].id");
  ok('a request still inside the window is not swept',
     G("refundEscalationDue(RFNMAP['" + fresh + "'])") === false);
  ok('and the customer is told how long is left',
     G("refundEscalationIn(RFNMAP['" + fresh + "'])") > 0);

  /* Auto-approval exists for the things that are never a judgement call. */
  const n0 = G('REFUNDS.length');
  w.eval("refundRequestDialog()"); await wait(150);
  w.eval("document.getElementById('rqReason').value='duplicate'"); w.eval("rqPreview()"); await wait(60);
  w.eval("submitRefundRequest()"); await wait(240);
  ok('a request is created', G('REFUNDS.length') === n0 + 1);
  ok('a duplicate charge is refunded without a human',
     G('REFUNDS[REFUNDS.length-1].state') === 'refunded');
  ok('and it gives every reason that applied, not just the first',
     /never a judgement call/.test(G('REFUNDS[REFUNDS.length-1].note')));

  w.eval("refundRequestDialog()"); await wait(150);
  w.eval("document.getElementById('rqReason').value='faulty'"); w.eval("rqPreview()"); await wait(60);
  w.eval("submitRefundRequest()"); await wait(240);
  const last = G('REFUNDS[REFUNDS.length-1]');
  ok('a judgement call goes to whoever sold it',
     G('REFUNDS[REFUNDS.length-1].state') === 'requested' ||
     G('REFUNDS[REFUNDS.length-1].amount') < G('REFUND_POLICY.autoApproveBelow'));
}

/* ------------------------------------------------------------ REFUND SLA */
head('REFUND POLICY — the marketplace cannot take over before the seller’s time is up');
{
  const { w, G } = await load('operator.html');
  w.App = G('App'); w.App.go('refunds'); await wait(240);
  w.eval("refundPolicyDialog()"); await wait(140);
  const before = G('REFUND_POLICY.sellerSlaHours');
  w.eval("document.getElementById('rpSla').value='72'");
  w.eval("document.getElementById('rpTake').value='24'");
  w.eval("saveRefundPolicy()"); await wait(120);
  ok('taking over before the SLA expires is refused', G('REFUND_POLICY.sellerSlaHours') === before);
  ok('and it says why',
     /still entitled to make/.test(w.document.getElementById('rpWarn').textContent));
  w.eval("document.getElementById('rpTake').value='96'");
  w.eval("saveRefundPolicy()"); await wait(220);
  ok('a coherent policy saves', G('REFUND_POLICY.sellerSlaHours') === 72);

  ok('the adjustments API is published to sellers',
     G("API_PRODUCTS.some(function(p){return p.id==='AP-ADJ'&&p.status==='ga'})"));
  ok('refund.requested is a required event, not an optional one',
     G("API_EVENTS.filter(function(e){return e.id==='refund.requested'})[0].required") === true);
  ok('a note being issued is notified too',
     G("API_EVENTS.some(function(e){return e.id==='note.issued'})"));
  ok('and the sandbox exists before production',
     G("API_PRODUCTS.filter(function(p){return p.id==='AP-ADJ'})[0].envs.indexOf('sandbox')") === 0);
}

console.log('\n' + (failures ? '✗ ' + failures + ' of ' + checks + ' checks failed'
                             : '✓ all ' + checks + ' adjustment checks passed'));
process.exit(failures ? 1 : 0);

})();
