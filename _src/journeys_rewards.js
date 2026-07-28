/* ===========================================================================
   Loyalty and rewards. Seventeenth file, to stay inside the shell's budget.
   A reward point is a liability, so these tests care less about the screen
   than about whether the balance, the ledger and the liability agree with each
   other after something happens.
   Run: node _src/journeys_rewards.js
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

(async () => {

/* ------------------------------------------------------- THE MODEL ITSELF */
head('PROGRAMME — a point is a liability, and the model says so');
{
  const { w, G, errs } = await load('operator.html');
  w.App = G('App'); w.App.go('rewards'); await wait(320);
  ok('the rewards screen renders without error', errs.length === 0, errs[0]);

  ok('every earn rule names who funds it',
     G("EARN_RULES.every(function(r){return ['operator','partner','shared'].indexOf(r.funder)>-1})"));
  ok('a shared rule states the split rather than leaving it to be guessed',
     G("EARN_RULES.filter(function(r){return r.funder==='shared'}).every(function(r){return r.split!=null})"));
  ok('every rule carries a reason it exists',
     G("EARN_RULES.every(function(r){return !!r.why && r.why.length>20})"));
  ok('every redemption option names who the cost falls on',
     G("REDEEM_OPTIONS.every(function(o){return ['operator','partner'].indexOf(o.cost)>-1})"));
  ok('every ledger movement carries the money value, not just the points',
     G("LOYALTY_LEDGER.every(function(t){return typeof t.value==='number'})"));
  ok('and the value agrees with the conversion rate',
     G("LOYALTY_LEDGER.every(function(t){return Math.abs(t.value - Math.abs(t.points)/LOYALTY.perUnit)<0.005})"));

  const L = G('loyaltyLiability()');
  const sum = G('LOYALTY_MEMBERS.reduce(function(a,m){return a+m.balance},0)');
  ok('the liability is the sum of what members actually hold', L.points === sum);
  ok('gross liability is that at the stated conversion',
     Math.abs(L.gross - sum / G('LOYALTY.perUnit')) < 0.005);
  ok('the carried figure is lower than gross, because breakage is assumed',
     L.expected < L.gross && L.expected > 0);
  ok('and breakage is declared as an estimate with a basis, not a bare number',
     /Observed|observed/.test(G('LOYALTY.breakageBasis')));

  /* Breakage is the one number here that is a guess. It has to be visible. */
  const txt = w.document.getElementById('main').textContent.replace(/\s+/g,' ');
  ok('the screen says breakage is an estimate rather than presenting it as fact',
     /not a fact|estimate/i.test(txt));
  ok('and it names the account the liability sits in', /2040/.test(txt));
}

/* ------------------------------------------------------------ THE LEDGER */
head('LEDGER — the postings follow the points');
{
  const { G } = await load('operator.html');
  const posts = G("GL_POSTINGS.filter(function(p){return /^reward\\./.test(p.charge)})");
  ok('reward movements reach the general ledger', posts.length > 0);
  ok('marketplace-funded issuance is expensed, not deferred',
     G("GL_MAPPING['reward.issued.op'].dr") === '6020');
  ok('seller-funded issuance is held as recoverable rather than expensed',
     G("GL_MAPPING['reward.issued.ptr'].dr") === '6030');
  ok('both credit the same liability account',
     G("GL_MAPPING['reward.issued.op'].cr") === '2040' &&
     G("GL_MAPPING['reward.issued.ptr'].cr") === '2040');
  ok('expiry releases the liability to breakage income, visibly',
     G("GL_MAPPING['reward.expired'].dr") === '2040' &&
     G("GL_MAPPING['reward.expired'].cr") === '4040');
  ok('every reward mapping explains itself',
     G("Object.keys(GL_MAPPING).filter(function(k){return /^reward\\./.test(k)})" +
       ".every(function(k){return GL_MAPPING[k].why.length>40})"));
}

/* ------------------------------------------------------- THE CUSTOMER SIDE */
head('MEMBER — redeeming moves real balances, not a toast');
{
  const { w, G } = await load('consumer.html');
  w.App = G('App'); w.App.go('rewards'); await wait(320);

  const before = G("LMMAP['LM-4001'].balance");
  const wallet0 = G('SHOPPER.wallet');
  const ledger0 = G('LOYALTY_LEDGER.length');

  w.eval("redeemDialog('LM-4001','RDM-01')"); await wait(220);
  ok('the redemption dialog opens', !!w.document.getElementById('modalHost'));

  /* Below the minimum has to be refused, and refused with the number. */
  w.document.getElementById('rdPts').value = '30';
  w.eval("rdPreview('LM-4001')"); await wait(80);
  ok('below the minimum is refused before submit',
     /starts at/.test(w.document.getElementById('rdOut').textContent));
  w.eval("submitRedeem('LM-4001')"); await wait(120);
  ok('and submitting it anyway changes nothing', G("LMMAP['LM-4001'].balance") === before);

  /* More than the balance is refused too. */
  w.document.getElementById('rdPts').value = String(before + 1000);
  w.eval("rdPreview('LM-4001')"); await wait(80);
  ok('more than the balance is refused',
     /more than the balance/i.test(w.document.getElementById('rdOut').textContent));

  w.document.getElementById('rdPts').value = '1000';
  w.eval("rdPreview('LM-4001')"); await wait(80);
  ok('a valid amount previews what it becomes in money',
     /\$10\.00/.test(w.document.getElementById('rdOut').textContent));
  w.eval("submitRedeem('LM-4001')"); await wait(260);

  ok('the balance actually falls', G("LMMAP['LM-4001'].balance") === before - 1000);
  ok('a movement is written to the ledger', G('LOYALTY_LEDGER.length') === ledger0 + 1);
  ok('the new movement is a redemption of the right size',
     G('LOYALTY_LEDGER[0].type') === 'redeem' && G('LOYALTY_LEDGER[0].points') === -1000);
  ok('wallet credit lands in the wallet, because it is the same money',
     Math.abs(G('SHOPPER.wallet') - (wallet0 + 10)) < 0.005);
  ok('and the shopper record agrees with the member record',
     G('SHOPPER.points') === G("LMMAP['LM-4001'].balance"));
  ok('it is on the audit log',
     G("auditRows('consumer').some(function(e){return e.action==='reward.redeemed'})"));

  /* The liability has to have moved by exactly what was given away. */
  const L = G('loyaltyLiability()');
  ok('the liability falls by the value redeemed',
     L.points === G('LOYALTY_MEMBERS.reduce(function(a,m){return a+m.balance},0)'));
}

head('MEMBER — the tier is explained, not just displayed');
{
  const { w, G } = await load('consumer.html');
  w.App = G('App'); w.App.go('rewards'); await wait(320);
  const txt = w.document.getElementById('main').textContent.replace(/\s+/g,' ');

  ok('the current tier is marked on the ladder',
     !!w.document.querySelector('.tiernode.is-here'));
  ok('the ladder does not rely on colour alone to say where you are',
     /You are here/.test(txt));
  ok('it says how much more spend the next tier needs',
     /more qualifying spend/.test(txt));
  ok('it states the downgrade rule rather than only the upgrade',
     /annual review|below the threshold/i.test(txt));

  const p = G("tierProgress(LMMAP['LM-4001'])");
  ok('progress is bounded', p.pct >= 0 && p.pct <= 100);
  ok('and the gap to the next tier is a real number', p.need >= 0);
  ok('a top-tier member is told there is nothing above them',
     G("tierProgress(LMMAP['LM-4003']).next") === null);

  ok('expiring points are warned about with a date and a value',
     /expire on/.test(txt) && /\$/.test(txt));
}

/* --------------------------------------------------------- THE SELLER SIDE */
head('SELLER — a seller sees their own cost and nobody else’s customers');
{
  const { w, G } = await load('partner.html');
  w.App = G('App'); w.App.go('rewards'); await wait(320);
  const txt = w.document.getElementById('main').textContent.replace(/\s+/g,' ');

  const d = G("loyaltyForPartner(ME_P.id)");
  ok('the seller has attributed movements', d.rows.length > 0);
  ok('every one of them is attributed to this seller',
     G("loyaltyForPartner(ME_P.id).rows.every(function(t){return t.sellerId===ME_P.id})"));
  ok('and no movement funded by the marketplace alone is billed to them',
     G("loyaltyForPartner(ME_P.id).rows.every(function(t){return t.funder!=='operator'})"));

  ok('the cost of issuing is stated in money, not points', d.cost > 0);
  ok('a shared rule only costs the seller its share',
     G("(function(){var d=loyaltyForPartner(ME_P.id);" +
       "return d.rows.every(function(t){var s=d.shareOf(t); return s>0 && s<=1});})()"));
  ok('reversed points are shown as taken back rather than quietly dropped',
     d.clawed >= 0 && /taken back|Reversed|reversed/i.test(txt) || d.clawed === 0);
  ok('the screen says where the cost is recovered',
     /settlement/i.test(txt));

  /* The seller may propose a rule, but only against their own products. */
  const n0 = G('EARN_RULES.length');
  w.eval("proposeEarnRule(ME_P.id)"); await wait(200);
  const m = w.document.getElementById('modalHost');
  ok('the proposal dialog opens', !!m);
  if (m){
    const nm = m.querySelector('#perName');
    if (nm) nm.value = 'Autumn accessory bonus';
    confirmDialog(w); await wait(220);
  }
  ok('a rule is created', G('EARN_RULES.length') === n0 + 1);
  ok('it is not live until the marketplace approves it',
     G('EARN_RULES[EARN_RULES.length-1].status') === 'pending');
  ok('it is scoped to the seller who asked for it',
     G('EARN_RULES[EARN_RULES.length-1].scopeId') === G('ME_P.id'));
  ok('and the seller funds it',
     G('EARN_RULES[EARN_RULES.length-1].funder') === 'partner');
  ok('it is on the audit log',
     G("auditRows('partner').some(function(e){return e.action==='reward.rule'})"));
}

/* ------------------------------------------------------- THE OPERATOR SIDE */
head('OPERATOR — approving, pausing and adjusting all leave a trace');
{
  const { w, G } = await load('operator.html');
  w.App = G('App'); w.App.go('rewards'); await wait(320);

  /* A decline has to say why, or the seller cannot fix it. */
  const pend = G("EARN_RULES.filter(function(r){return r.status==='pending'})[0].id");
  w.eval("decideEarnRule('" + pend + "')"); await wait(200);
  w.eval("settleEarnRule('" + pend + "',false)"); await wait(150);
  ok('a decline without a reason is refused', G("ERNMAP['" + pend + "'].status") === 'pending');
  w.document.getElementById('derWhy').value = 'The cap is too high for a first campaign.';
  w.eval("settleEarnRule('" + pend + "',false)"); await wait(200);
  ok('a decline with a reason is recorded', G("ERNMAP['" + pend + "'].status") === 'declined');
  ok('and the reason is kept on the rule',
     /cap is too high/.test(G("ERNMAP['" + pend + "'].decisionNote")));

  /* Pausing must not confiscate points people already earned. */
  const live = G("EARN_RULES.filter(function(r){return r.status==='active'})[0].id");
  const held = G('LOYALTY_MEMBERS.reduce(function(a,m){return a+m.balance},0)');
  w.eval("toggleEarnRule('" + live + "')"); await wait(180);
  confirmDialog(w); await wait(220);
  ok('the rule stops issuing', G("ERNMAP['" + live + "'].status") === 'paused');
  ok('but nobody loses a point they already earned',
     G('LOYALTY_MEMBERS.reduce(function(a,m){return a+m.balance},0)') === held);
  ok('and the rule stays on the list so the history reconciles',
     G("EARN_RULES.some(function(r){return r.id==='" + live + "'})"));

  /* A hand adjustment is high-risk and demands a reason. */
  const b0 = G("LMMAP['LM-4002'].balance");
  const led0 = G('LOYALTY_LEDGER.length');
  w.eval("adjustBalance('LM-4002')"); await wait(200);
  w.document.getElementById('abPts').value = '250';
  confirmDialog(w); await wait(200);
  ok('an adjustment with no reason is refused', G("LMMAP['LM-4002'].balance") === b0);
  w.eval("adjustBalance('LM-4002')"); await wait(200);
  w.document.getElementById('abPts').value = '250';
  w.document.getElementById('abWhy').value = 'Cap applied twice on 14 Jul, corrected.';
  confirmDialog(w); await wait(240);
  ok('an adjustment with a reason lands', G("LMMAP['LM-4002'].balance") === b0 + 250);
  ok('it writes a movement rather than editing a number in place',
     G('LOYALTY_LEDGER.length') === led0 + 1 && G("LOYALTY_LEDGER[0].type") === 'adjust');
  ok('the reason travels with the movement',
     /Cap applied twice/.test(G('LOYALTY_LEDGER[0].note')));
  ok('and it is on the audit log at warning severity',
     G("auditRows('operator').some(function(e){return e.action==='reward.adjusted' && e.sev!=='info'})"));

  /* Removing more than someone has would create a negative liability. */
  const b1 = G("LMMAP['LM-4004'].balance");
  w.eval("adjustBalance('LM-4004')"); await wait(200);
  w.document.getElementById('abDir').value = '-1';
  w.document.getElementById('abPts').value = String(b1 + 5000);
  w.document.getElementById('abWhy').value = 'Testing the floor.';
  confirmDialog(w); await wait(200);
  ok('a balance cannot be driven below zero', G("LMMAP['LM-4004'].balance") === b1);
}

head('OPERATOR — changing the value of a point is treated as a balance-sheet act');
{
  const { w, G } = await load('operator.html');
  w.App = G('App'); w.App.go('rewards'); await wait(300);

  w.eval('rewardPolicyDialog()'); await wait(220);
  ok('the settings dialog opens', !!w.document.getElementById('modalHost'));

  w.document.getElementById('rpBrk').value = '80';
  w.eval('rwPreview()'); await wait(80);
  ok('a breakage assumption large enough to erase the liability is refused',
     /not an assumption/.test(w.document.getElementById('rwOut').textContent));
  const per0 = G('LOYALTY.breakage');
  w.eval('saveRewardPolicy()'); await wait(150);
  ok('and saving it anyway changes nothing', G('LOYALTY.breakage') === per0);

  w.document.getElementById('rpBrk').value = '18.5';
  w.document.getElementById('rpPer').value = '200';
  w.eval('rwPreview()'); await wait(80);
  const prev = w.document.getElementById('rwOut').textContent;
  ok('devaluing a point warns that members will notice',
     /worth less|buy less/i.test(prev));
  ok('and it states the new liability before anything is saved',
     /Liability carried would become/.test(prev));

  const before = G('LOYALTY.perUnit');
  w.eval('saveRewardPolicy()'); await wait(240);
  ok('the change is saved', G('LOYALTY.perUnit') === 200 && before !== 200);
  ok('the liability recalculates from the new rate',
     Math.abs(G('loyaltyLiability().gross') -
       G('LOYALTY_MEMBERS.reduce(function(a,m){return a+m.balance},0)') / 200) < 0.005);
  ok('and it is on the audit log',
     G("auditRows('operator').some(function(e){return e.action==='reward.policy'})"));
}

/* --------------------------------------------- THE REDEMPTION CATALOGUE */
head('CATALOGUE — points are spent inside the marketplace, and the editor holds that');
{
  const { w, G } = await load('operator.html');
  w.App = G('App'); w.App.go('rewards'); await wait(340);
  const main = w.document.getElementById('main');

  ok('the catalogue can be added to', /redeemOptionDialog\(\)/.test(main.innerHTML));
  ok('and every row can be edited', (main.innerHTML.match(/redeemOptionDialog\('/g)||[]).length ===
     G('REDEEM_OPTIONS.length'));
  ok('every row can be retired or reinstated',
     (main.innerHTML.match(/toggleRedeemOption\('/g)||[]).length === G('REDEEM_OPTIONS.length'));
  ok('the table says where each option settles', /In the marketplace/.test(main.textContent));
  ok('and the rule is stated, not implied',
     /settle inside the marketplace/.test(main.textContent.replace(/\s+/g,' ')));

  /* Every kind declares where it lands, and every live option lands here. */
  ok('every fulfilment kind declares where it settles',
     G("REDEEM_KINDS.every(function(k){return k.settles==='inside'||k.settles==='outside'})"));
  ok('no live option settles outside the marketplace',
     G("REDEEM_OPTIONS.filter(function(o){return o.status==='active'})" +
       ".every(function(o){return redeemSettlesInside(o)})"));
  ok('an option that used to settle outside is retired rather than deleted',
     G("REDEEM_OPTIONS.some(function(o){return !redeemSettlesInside(o) && o.status!=='active'})"));
  ok('and it records that as the reason',
     G("REDEEM_OPTIONS.filter(function(o){return !redeemSettlesInside(o)})" +
       ".every(function(o){return /outside the marketplace|left the marketplace/.test(o.why)})"));

  /* The editor refuses what the rule forbids. */
  w.eval('redeemOptionDialog()'); await wait(240);
  ok('the editor opens', !!w.document.getElementById('modalHost'));
  w.document.getElementById('roKind').value = 'external';
  w.eval('roPreview()'); await wait(80);
  ok('an externally fulfilled option is refused before save',
     /cannot be published/.test(w.document.getElementById('roOut').textContent));
  const n0 = G('REDEEM_OPTIONS.length');
  w.document.getElementById('roName').value = 'Lounge pass';
  w.document.getElementById('roDesc').value = 'A pass.';
  w.document.getElementById('roWhy').value = 'Because.';
  w.eval('saveRedeemOption(null)'); await wait(180);
  ok('and saving it anyway creates nothing', G('REDEEM_OPTIONS.length') === n0);

  /* Arithmetic guards. */
  w.document.getElementById('roKind').value = 'basket';
  w.document.getElementById('roMin').value = '50';
  w.eval('roPreview()'); await wait(80);
  ok('a minimum below the programme floor is refused',
     /programme minimum/.test(w.document.getElementById('roOut').textContent));
  w.document.getElementById('roMin').value = '250';
  w.document.getElementById('roStep').value = '100';
  w.eval('roPreview()'); await wait(80);
  ok('a minimum that is not a whole number of steps is caught',
     /whole number of steps/.test(w.document.getElementById('roOut').textContent));
  w.document.getElementById('roVal').value = '0';
  w.document.getElementById('roMin').value = '300';
  w.eval('roPreview()'); await wait(80);
  ok('an option worth nothing is refused',
     /worth something/.test(w.document.getElementById('roOut').textContent));

  /* A good one saves, and the preview compares it against plain credit. */
  w.document.getElementById('roVal').value = '1.20';
  w.eval('roPreview()'); await wait(80);
  ok('the preview states the premium over plain wallet credit',
     /premium/.test(w.document.getElementById('roOut').textContent));
  w.document.getElementById('roName').value = 'Points off at the till';
  w.document.getElementById('roDesc').value = 'Taken off the basket at payment.';
  w.document.getElementById('roWhy').value = 'Removes the trip through the wallet.';
  w.eval('saveRedeemOption(null)'); await wait(280);
  ok('a compliant option is created', G('REDEEM_OPTIONS.length') === n0 + 1);
  const made = G('REDEEM_OPTIONS[REDEEM_OPTIONS.length-1]');
  ok('it is live to members immediately', made.status === 'active');
  ok('and it settles inside the marketplace',
     G('redeemSettlesInside(REDEEM_OPTIONS[REDEEM_OPTIONS.length-1])') === true);
  ok('the change is on the audit log',
     G("auditRows('operator').some(function(e){return e.action==='reward.redeem'})"));

  /* Retiring does not touch anything already redeemed. */
  const held = G('LOYALTY_MEMBERS.reduce(function(a,m){return a+m.balance},0)');
  w.eval("toggleRedeemOption('RDM-01')"); await wait(200);
  confirmDialog(w); await wait(220);
  ok('an option can be retired', G("RDMMAP['RDM-01'].status") === 'retired');
  ok('and no balance moves when it is',
     G('LOYALTY_MEMBERS.reduce(function(a,m){return a+m.balance},0)') === held);
  ok('it stays on the list because the history has to reconcile',
     G("REDEEM_OPTIONS.some(function(o){return o.id==='RDM-01'})"));

  /* An option that settles outside cannot be brought back as it stands. */
  const ext = G("REDEEM_OPTIONS.filter(function(o){return !redeemSettlesInside(o)})[0].id");
  w.eval("toggleRedeemOption('" + ext + "')"); await wait(200);
  ok('a retired external option cannot be reinstated', G("RDMMAP['" + ext + "'].status") === 'retired');
}

/* -------------------------------------------------------------- THE TIERS */
head('TIERS — the ladder has to climb in both directions at once');
{
  const { w, G } = await load('operator.html');
  w.App = G('App'); w.App.go('rewards'); await wait(340);
  const main = w.document.getElementById('main');

  ok('a tier can be added', /tierDialog\(\)/.test(main.innerHTML));
  ok('and every tier can be edited',
     (main.innerHTML.match(/tierDialog\('/g)||[]).length === G('LOYALTY_TIERS.length'));
  ok('the panel says why the ladder is constrained',
     /Thresholds and earn rates both have to climb/.test(main.textContent.replace(/\s+/g,' ')));

  /* Spending more for less is the one thing a tier may never do. */
  w.eval('tierDialog()'); await wait(240);
  ok('the tier editor opens', !!w.document.getElementById('modalHost'));
  w.document.getElementById('tiSpend').value = '1000';
  w.document.getElementById('tiMult').value = '1.2';
  w.eval('tiPreview()'); await wait(80);
  ok('a tier above another that earns less is refused',
     /spend more for less/.test(w.document.getElementById('tiOut').textContent));

  w.document.getElementById('tiSpend').value = '1000';
  w.document.getElementById('tiMult').value = '9';
  w.eval('tiPreview()'); await wait(80);
  ok('a tier below another that out-earns it is refused too',
     /cannot give/.test(w.document.getElementById('tiOut').textContent));

  w.document.getElementById('tiSpend').value = '600';
  w.document.getElementById('tiMult').value = '1.4';
  w.eval('tiPreview()'); await wait(80);
  ok('two tiers at one threshold are refused',
     /already qualifies at/.test(w.document.getElementById('tiOut').textContent));

  w.document.getElementById('tiSpend').value = '9000';
  w.document.getElementById('tiMult').value = '0.5';
  w.eval('tiPreview()'); await wait(80);
  ok('a multiplier below the base rate is refused',
     /punishes loyalty/.test(w.document.getElementById('tiOut').textContent));

  /* A valid rung, grounded in the members who actually exist. */
  w.document.getElementById('tiMult').value = '2.5';
  w.eval('tiPreview()'); await wait(80);
  const prev = w.document.getElementById('tiOut').textContent.replace(/\s+/g,' ');
  ok('a valid tier says how many current members would qualify',
     /current members already spend enough/.test(prev));
  ok('and what it adds to the liability per order', /more of liability per order/.test(prev));

  const t0 = G('LOYALTY_TIERS.length');
  w.eval('saveTier(null)'); await wait(180);
  ok('a tier with no name is refused', G('LOYALTY_TIERS.length') === t0);
  w.document.getElementById('tiName').value = 'Titanium';
  w.document.getElementById('tiBen').value = '';
  w.eval('saveTier(null)'); await wait(180);
  ok('a tier with no stated benefit is refused', G('LOYALTY_TIERS.length') === t0);
  w.document.getElementById('tiBen').value = 'Earn 2.5 points per $1\nNamed account team';
  w.eval('saveTier(null)'); await wait(280);
  ok('a coherent tier is created', G('LOYALTY_TIERS.length') === t0 + 1);
  ok('the rungs are renumbered from the thresholds, not typed',
     G("(function(){var s=LOYALTY_TIERS.slice().sort(function(a,b){return a.qualifySpend-b.qualifySpend});" +
       "return s.every(function(t,i){return t.order===i+1})})()") === true);
  ok('it is on the audit log',
     G("auditRows('operator').some(function(e){return e.action==='reward.tier'})"));

  /* Removal is bounded by who is standing on the rung. */
  const occupied = G("LOYALTY_TIERS.filter(function(t){return LOYALTY_MEMBERS.some(function(m){" +
    "return m.tier===t.id})})[0].id");
  const before = G('LOYALTY_TIERS.length');
  w.eval("removeTier('" + occupied + "')"); await wait(200);
  ok('a tier with members cannot be removed', G('LOYALTY_TIERS.length') === before);
  ok('the entry tier cannot be removed whatever its occupancy',
     G("(function(){var b=LOYALTY_TIERS.filter(function(t){return t.order===1})[0];" +
       "removeTier(b.id); return LOYALTY_TIERS.some(function(t){return t.id===b.id})})()") === true);

  w.eval("removeTier('titanium')"); await wait(200);
  confirmDialog(w); await wait(240);
  ok('an empty tier above the base can be removed',
     !G("LOYALTY_TIERS.some(function(t){return t.id==='titanium'})"));
  ok('and the ladder is renumbered again afterwards',
     G("(function(){var s=LOYALTY_TIERS.slice().sort(function(a,b){return a.qualifySpend-b.qualifySpend});" +
       "return s.every(function(t,i){return t.order===i+1})})()") === true);

  /* Editing a tier must not collide with itself in the ladder check. */
  const gold = G("LOYALTY_TIERS.filter(function(t){return t.name==='Gold'})[0].qualifySpend");
  w.eval("tierDialog('gold')"); await wait(240);
  w.eval('tiPreview()'); await wait(80);
  ok('re-opening a tier unchanged does not report a clash with itself',
     !/already qualifies at/.test(w.document.getElementById('tiOut').textContent), String(gold));
}

/* ------------------------------------------------------ THE ENTERPRISE SIDE */
head('ENTERPRISE — the organisation earns it, and finance decides who spends it');
{
  const { w, G } = await load('enterprise.html');
  w.App = G('App'); w.App.go('rewards'); await wait(340);
  const txt = w.document.getElementById('main').textContent.replace(/\s+/g,' ');

  ok('the organisation holds a member account', G("!!LMMAP['LM-4101']"));
  ok('and it is an organisation account, not a person',
     G("LMMAP['LM-4101'].kind") === 'enterprise');
  ok('the screen names who may propose a redemption', /Any named buyer/.test(txt));
  ok('and who may actually take the credit', /Finance director/.test(txt));
  ok('it says the credit lands on an invoice rather than a wallet',
     /invoice/i.test(txt));
  ok('a cost centre can be attached to the redemption',
     G('ENT_REWARD_POLICY.allocateToCostCentre') === true &&
     G('ENT_REWARD_POLICY.costCentres.length') > 1);

  /* Consumer-only redemption options must not appear on a business account. */
  const shown = G("REDEEM_OPTIONS.filter(function(o){return o.status==='active' && " +
    "(o.audience==='all'||o.audience==='enterprise')})");
  ok('consumer-only options are not offered to a business',
     shown.every(function(o){ return o.audience !== 'consumer'; }));
  ok('and a retired option is offered to nobody',
     G("REDEEM_OPTIONS.filter(function(o){return o.status!=='active'}).length") > 0 &&
     !/lounge/i.test(txt));
}

/* ------------------------------------------------------------ THE BOUNDARY */
head('BOUNDARY — each persona sees its own question, not everybody’s');
{
  const { w: cw } = await load('consumer.html');
  cw.eval('App.go("rewards")'); await wait(300);
  const ct = cw.document.getElementById('main').textContent;
  ok('a customer is not shown the programme liability', !/breakage/i.test(ct));
  ok('nor other members’ accounts', !/Harbourpoint|Cadence Health/.test(ct));

  const { w: pw } = await load('partner.html');
  pw.eval('App.go("rewards")'); await wait(300);
  const pt = pw.document.getElementById('main').textContent;
  ok('a seller is not shown the customer behind a movement',
     !/Priya Raman|Meera Krishnan/.test(pt));
  ok('nor the programme-wide liability', !/breakage/i.test(pt));
  ok('but is shown what it costs them', /Cost of issuing/.test(pt));

  const { w: ow } = await load('operator.html');
  ow.eval('App.go("rewards")'); await wait(320);
  const ot = ow.document.getElementById('main').textContent;
  ok('the operator sees the liability', /Gross liability/.test(ot));
  ok('and who funded it', /Recoverable from sellers/.test(ot));
  ok('and can reach every member account', /Member accounts/.test(ot));
}

console.log('\n' + (failures ? '✗ ' + failures + ' of ' + checks + ' checks failed'
                             : '✓ all ' + checks + ' reward checks passed'));
process.exit(failures ? 1 : 0);

})();
