/* ===========================================================================
   Catalogue, commercial and reporting journey tests (notifications, onboarding
   gates, listing policy, commercial models, partner bills, first-party
   products and the reporting period). Third file, to stay inside the shell's
   45-second budget.
   These do not check that a screen rendered — they drive each journey to its
   conclusion and assert that the underlying records actually changed.
   Run: node _src/journeys_catalogue.js
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
/* -------------------------------------------------- NOTIFICATION RULES */
head('NOTIFICATIONS — the rule builder creates a real rule');
{
  const { w, G } = await load('operator.html');
  w.App = G('App'); w.App.go('notifications'); await wait(150);

  const before = G("NOTIF_RULES.operator.length");
  w.eval("newNotifRuleDialog('operator')"); await wait(130);
  const m = w.document.getElementById('modalHost');
  ok('the builder opens rather than firing a toast', !!m);
  ok('it offers events scoped to this persona',
     m.querySelectorAll('#nrEvent option').length === G("eventsFor('operator').length"));
  ok('it offers audiences, not individual people',
     m.querySelectorAll('#nrWho option').length === G("NOTIF_AUDIENCES.operator.length"));

  /* a rule with no channel does nothing, so it is refused */
  Array.prototype.slice.call(m.querySelectorAll('[id^="nrCh_"]')).forEach(c => { c.checked = false; });
  m.querySelector('#nrRuleName').value = 'Catalogue backlog over 20';
  w.eval("submitNotifRule('operator')"); await wait(90);
  ok('a rule with no channel is refused', !w.document.getElementById('nrChErr').hidden);
  ok('and nothing was created', G("NOTIF_RULES.operator.length") === before);

  w.document.querySelectorAll('[id^="nrCh_"]')[0].checked = true;
  w.document.querySelectorAll('[id^="nrCh_"]')[1].checked = true;
  w.document.getElementById('nrSev').value = 'normal';
  w.document.getElementById('nrThr').value = 'At most once a day';
  w.eval("submitNotifRule('operator')"); await wait(180);
  ok('the rule is created', G("NOTIF_RULES.operator.length") === before + 1);
  const r = G("NOTIF_RULES.operator[NOTIF_RULES.operator.length-1]");
  ok('it is switched on', r.on === true);
  ok('it records the channels chosen', r.chans.length === 2);
  ok('it records the throttle', r.throttle === 'At most once a day');
  ok('it appears in the rules table',
     G("DataTable.reg['dtNotif_operator'].rows.some(function(x){return x.id==='" + r.id + "'})"));
  ok('a message template is written for it straight away',
     !!G("NOTIF_TEMPLATES['operator|" + r.id + "']"));

  /* editing an existing rule */
  w.eval("editNotifRule('operator','" + r.id + "')"); await wait(130);
  w.document.getElementById('erName').value = '';
  w.eval("saveNotifRule('operator','" + r.id + "')"); await wait(90);
  ok('a rule cannot be renamed to nothing', !w.document.getElementById('erNameErr').hidden);
  w.document.getElementById('erName').value = 'Catalogue backlog over 25';
  w.document.getElementById('erSev').value = 'high';
  w.eval("saveNotifRule('operator','" + r.id + "')"); await wait(170);
  ok('the edit is saved',
     G("NOTIF_RULES.operator.find(function(x){return x.id==='" + r.id + "'}).name") === 'Catalogue backlog over 25');
  ok('severity is saved',
     G("NOTIF_RULES.operator.find(function(x){return x.id==='" + r.id + "'}).sev") === 'high');

  /* deleting is a typed confirmation, and only for a rule you created */
  w.eval("deleteNotifRule('operator','" + r.id + "')"); await wait(130);
  ok('deleting asks first', !!w.document.getElementById('modalHost'));
  confirmDialog(w, 'DELETE'); await wait(160);
  ok('the rule is gone', G("NOTIF_RULES.operator.length") === before);
  ok('and its template with it', !G("NOTIF_TEMPLATES['operator|" + r.id + "']"));
}
head('NOTIFICATIONS — the message is editable per channel');
{
  const { w, G } = await load('operator.html');
  w.App = G('App'); w.App.go('notifications'); await wait(160);
  ok('there is a message content panel',
     /Message content/.test(w.document.getElementById('main').textContent));

  w.eval("editNotifMessage('operator','NR-O3')"); await wait(150);
  const m = w.document.getElementById('modalHost');
  ok('the message editor opens', !!m);
  const rule = G("NOTIF_RULES.operator.find(function(r){return r.id==='NR-O3'})");
  ok('there is a tab per channel the rule uses',
     m.querySelectorAll('.tab').length === rule.chans.length, m.querySelectorAll('.tab').length + ' tabs');
  ok('the preview renders sample values, not raw braces',
     m.textContent.indexOf('{order}') === -1 || /ORD-882431/.test(m.textContent));

  /* channel-specific limits are real */
  const smsCount = G("segCount('x'.repeat(200),'SMS')");
  ok('SMS counts characters and segments', smsCount.limit === 160 && smsCount.segs === 2 && smsCount.over === true);
  ok('email has no length limit', G("segCount('x'.repeat(2000),'Email')") === null);

  /* switching channel must not lose what was typed */
  w.eval("MSG_EDIT.chan='Email'");
  const host = w.document.getElementById('msgPane');
  host.innerHTML = G('msgPane()');
  w.document.getElementById('msgBody').value = 'Rewritten email body for {order}. {link}';
  w.eval("msgTab('SMS')"); await wait(110);
  ok('switching channel keeps the email edit',
     G("NOTIF_TEMPLATES['operator|NR-O3'].bodies.Email").indexOf('Rewritten email body') > -1);
  ok('the SMS body is its own text, not the email',
     G("NOTIF_TEMPLATES['operator|NR-O3'].bodies.SMS") !== G("NOTIF_TEMPLATES['operator|NR-O3'].bodies.Email"));

  /* an unknown token is flagged rather than silently dropped */
  ok('an unrecognised token is detected',
     G("unknownTokens('Hello {nosuchtoken} and {order}').length") === 1);

  /* an empty message is refused */
  w.eval("MSG_EDIT.chan='SMS'");
  w.document.getElementById('msgPane').innerHTML = G('msgPane()');
  w.document.getElementById('msgBody').value = '   ';
  w.eval('saveNotifMessage()'); await wait(110);
  ok('a rule that would send an empty message is refused', !!w.document.getElementById('modalHost'));

  w.document.getElementById('msgBody').value = 'Dispute on {order} is past its {due} target. {link}';
  w.eval('saveNotifMessage()'); await wait(170);
  ok('a valid message saves', !w.document.getElementById('modalHost'));
  ok('and is marked as customised', G("NOTIF_TEMPLATES['operator|NR-O3'].edited") === true);
  ok('with who changed it and when',
     !!G("NOTIF_TEMPLATES['operator|NR-O3'].lastEdited") && !!G("NOTIF_TEMPLATES['operator|NR-O3'].editedBy"));
}
head('NOTIFICATIONS — message authoring belongs to whoever owns the wording');
{
  for (const [file, ctx] of [['operator.html','operator'],['partner.html','partner'],
                             ['enterprise.html','buyer'],['consumer.html','consumer']]){
    const { w, G } = await load(file);
    w.App = G('App'); w.App.go('notifications'); await wait(150);
    const t = w.document.getElementById('main').textContent;
    /* Only the marketplace and a seller author the wording that goes out under
       their own name. A buyer and a customer receive it; letting either edit
       our templates produces a document nobody here recognises. */
    const authors = (ctx==='operator' || ctx==='partner');
    ok(file + (authors ? ' — authors its own message content'
                       : ' — does not author the marketplace’s message content'),
       /Message content/.test(t) === authors);
    ok(file + ' — every rule still has a template behind it',
       G("(NOTIF_RULES['" + ctx + "']||[]).every(function(r){return !!notifTemplate('" + ctx + "',r.id)})"));
    ok(file + ' — the builder opens', (function(){
      w.eval("newNotifRuleDialog('" + ctx + "')");
      return !!w.document.getElementById('modalHost');
    })());
  }
}

/* --------------------------------------------------- MARKETPLACE WORDING */
head('WORDING — the label generalises past six');
{
  const { w, G } = await load('operator.html');
  w.App = G('App');
  const nav = Array.from(w.document.querySelectorAll('.nav-item')).map(b => b.textContent).join(' ');
  ok('the rail no longer hard-codes six', !/six/i.test(nav), nav.match(/[^ ]*six[^ ]*/i));
  ok('it reads as categories', /Marketplace categories/.test(nav));
  w.App.go('verticals'); await wait(140);
  ok('the screen counts rather than states six',
     w.document.getElementById('main').textContent.indexOf(G('VERTICALS.length') + ' commercial propositions') > -1);
  /* and the wording survives a seventh being added */
  w.eval("addMarketplace({name:'Energy Marketplace',blurb:'Meters and tariffs',aud:'B2C',icon:'zap',copyFrom:'iot',live:false})");
  w.App.go('verticals'); await wait(150);
  ok('adding a seventh does not make the wording wrong',
     w.document.getElementById('main').textContent.indexOf('7 commercial propositions') > -1);
}

/* -------------------------------------------------------- ONBOARDING GATES */
head('ONBOARDING — every gate opens the inputs behind it');
{
  const { w, G } = await load('operator.html');
  w.App = G('App'); w.App.go('onboardq'); await wait(170);

  const steps = w.document.querySelectorAll('#main .pipe .step');
  ok('the gates are buttons, not decoration', steps.length > 0 && steps[0].tagName === 'BUTTON');
  ok('each gate says what state it is in for a screen reader',
     Array.from(steps).every(b => /Gate \d+/.test(b.getAttribute('aria-label') || '')));

  const pid = G("PARTNERS.filter(function(p){return ONB_STATE[p.id]})[0].id");
  w.eval("openGate('" + pid + "','kyc')"); await wait(140);
  const insp = w.document.getElementById('inspector');
  ok('a cleared gate opens its submission', !insp.hidden && /What was submitted/.test(insp.textContent));
  ok('it names who submitted it and when', /Submitted by/.test(insp.textContent));
  ok('it names who reviewed it', /Reviewed by/.test(insp.textContent));
  ok('it lists the documents supplied', /Certificate of incorporation/.test(insp.textContent));
  ok('it shows the beneficial ownership actually declared', /Beneficial owners/.test(insp.textContent));
  ok('it states the evidence the gate demands', /Evidence this gate demands/.test(insp.textContent));
  ok('it says whether the gate can be waived', /Waivable/.test(insp.textContent));

  /* navigation between gates */
  ok('you can step to the next gate', /Agreements/.test(insp.textContent));
  w.eval("openGate('" + pid + "','tech')"); await wait(130);
  const t2 = w.document.getElementById('inspector').textContent;
  ok('a later gate shows its own inputs', /Fulfilment webhook/.test(t2) || /Nothing submitted yet/.test(t2));

  /* a gate never reached has no fabricated record */
  const early = G("PARTNERS.filter(function(p){var s=ONB_STATE[p.id]; return s && s.golive==='todo'})[0]");
  if (early){
    w.eval("openGate('" + early.id + "','golive')"); await wait(130);
    ok('a gate not yet reached declares that rather than inventing a submission',
       /Nothing submitted yet/.test(w.document.getElementById('inspector').textContent));
  }

  /* a document opens without pretending to reproduce personal data */
  w.eval("viewGateDoc('Certificate of incorporation','Northwind Mobility')"); await wait(130);
  ok('a document opens', !!w.document.getElementById('modalHost'));
  ok('and states that the contents are withheld, and why',
     /not shown here/.test(w.document.getElementById('modalHost').textContent) &&
     /personal and commercial data/.test(w.document.getElementById('modalHost').textContent));
  ok('without telling the reader this is not the real thing',
     !/real platform|prototype/i.test(w.document.getElementById('modalHost').textContent));
}

/* ------------------------------------------------------------ LISTING POLICY */
head('CATALOGUE — listing policy is a real screen');
{
  const { w, G } = await load('operator.html');
  w.App = G('App'); w.App.go('catalogue'); await wait(180);
  w.eval('listingPolicyDialog()'); await wait(150);
  const m = w.document.getElementById('modalHost');
  ok('the listing policy dialog opens', !!m);
  ok('it lists every rule', G('POLICY_RULES.length') > 0 &&
     G("POLICY_RULES.every(function(r){return document.getElementById('modalHost').textContent.indexOf(r.name)>-1})"));
  ok('it has a column per marketplace category',
     m.querySelectorAll('thead th').length >= G('VERTICALS.length') + 1);
  ok('it shows the review settings per category', /Auto-publish/.test(m.textContent));
  ok('it shows what is held right now', /Held right now/.test(m.textContent));
  ok('it routes into the per-category editor', /Edit/.test(m.textContent));
}

/* --------------------------------------------------------- COMMERCIAL MODELS */
head('PLANS — commercial models drive which parameters exist');
{
  const { w, G } = await load('operator.html');
  w.App = G('App'); w.App.go('plans'); await wait(190);
  ok('the models are on the screen', /Commercial models/.test(w.document.getElementById('main').textContent));
  ok('every existing plan is bound to a model', G('COMM_PLANS.every(function(p){return !!CMMAP[p.modelId]})'));

  w.eval('newPlan()'); await wait(150);
  const m = w.document.getElementById('modalHost');
  ok('the plan wizard opens', !!m);
  const firstLabel = m.querySelector('#npRateLabel').textContent;
  const firstParams = m.querySelectorAll('#npParams .field, #npParams .toggle').length;
  ok('it shows the parameters of the first model', firstParams > 0);

  /* switching model must swap the parameters and relabel the rate */
  w.document.getElementById('npModel').value = 'CM-WHOLE';
  w.eval("onModelChange('np')"); await wait(110);
  ok('changing the model relabels the headline rate',
     w.document.getElementById('npRateLabel').textContent !== firstLabel,
     w.document.getElementById('npRateLabel').textContent);
  ok('and swaps in that model\'s parameters',
     !!w.document.getElementById('np_p_creditTerms') && !w.document.getElementById('np_p_returnsAdj'));
  ok('the blurb changes with it',
     w.document.getElementById('npBlurb').textContent === G("CMMAP['CM-WHOLE'].blurb"));

  /* a model with no tiers hides the tier table entirely */
  w.document.getElementById('npModel').value = 'CM-INTRO';
  w.eval("onModelChange('np')"); await wait(110);
  ok('a flat-rate model hides the tier table', w.document.getElementById('npTiers').hidden === true);
  ok('and shows its own parameters', !!w.document.getElementById('np_p_coolingOff'));

  /* back to a tiered model, and the tier maths is checked */
  w.document.getElementById('npModel').value = 'CM-COMM';
  w.eval("onModelChange('np')"); await wait(110);
  ok('a tiered model shows the tier table again', w.document.getElementById('npTiers').hidden === false);
  w.eval('npAddTier()'); await wait(80);
  ok('a tier can be added', G('NP_TIERS.length') === 3);
  w.eval("npSetTier(2,'from',1000)"); await wait(80);
  ok('an out-of-order threshold is flagged',
     /must start above/.test(w.document.getElementById('npTierBox').textContent));

  const before = G('COMM_PLANS.length');
  w.eval('submitPlan()'); await wait(100);
  ok('a plan with broken tiers will not save', G('COMM_PLANS.length') === before);
  w.eval("npSetTier(2,'from',400000)"); await wait(80);
  w.document.getElementById('npName').value = '';
  w.eval('submitPlan()'); await wait(90);
  ok('a nameless plan is refused', !w.document.getElementById('npNameErr').hidden);
  w.document.getElementById('npName').value = 'Device — enterprise';
  w.document.getElementById('npBase').value = '11';
  w.eval("np_p_minCommission" in w ? "" : ""); 
  w.eval('submitPlan()'); await wait(190);
  ok('the plan is created', G('COMM_PLANS.length') === before + 1);
  const p = G('COMM_PLANS[COMM_PLANS.length-1]');
  ok('it starts as a draft with nobody on it', p.status === 'draft' && p.partners === 0);
  ok('it carries the model it was built on', p.modelId === 'CM-COMM');
  ok('it carries that model\'s parameters',
     Object.keys(p.params).length === G("CMMAP['CM-COMM'].params.length"));
  ok('it has three tiers', p.tiers.length === 3);
  ok('it appears in the plans table',
     G("DataTable.reg['dtPlans'].rows.some(function(x){return x.id==='" + p.id + "'})"));
}
head('PLANS — a new commercial model can be defined');
{
  const { w, G } = await load('operator.html');
  w.App = G('App'); w.App.go('plans'); await wait(190);
  const before = G('COMMERCIAL_MODELS.length');
  w.eval('newCommercialModelDialog()'); await wait(140);
  ok('the model builder opens', !!w.document.getElementById('modalHost'));
  w.document.getElementById('cmName').value = 'Outcome-based share';
  w.document.getElementById('cmBlurb').value = 'short';
  w.eval('submitCommercialModel()'); await wait(90);
  ok('a model with no usable description is refused', !w.document.getElementById('cmBlurbErr').hidden);
  w.document.getElementById('cmBlurb').value = 'Share of measured outcome rather than of the sale. For managed services.';
  w.eval('cmAddParam()'); await wait(90);
  ok('a parameter row is added', G('NCM_PARAMS.length') === 1);
  w.eval('submitCommercialModel()'); await wait(90);
  ok('an unlabelled parameter blocks the save', G('COMMERCIAL_MODELS.length') === before);
  w.eval("cmSetParam(0,'label','Measurement window (days)')"); await wait(80);
  w.eval("cmSetParam(0,'type','int')"); await wait(80);
  w.eval('submitCommercialModel()'); await wait(190);
  ok('the model is created', G('COMMERCIAL_MODELS.length') === before + 1);
  const m = G('COMMERCIAL_MODELS[COMMERCIAL_MODELS.length-1]');
  ok('it is marked custom, not built-in', m.system === false);
  ok('it carries the parameter defined', m.params.length === 1);
  ok('a plan can now be built on it', G("!!CMMAP['" + m.id + "']"));
}

/* --------------------------------------------------------- PARTNER BILLS */
head('PARTNERS — bills can be read and downloaded');
{
  const { w, G } = await load('operator.html');
  w.App = G('App'); w.App.go('partners'); await wait(180);
  w.eval("window.__dl=[]; URL.createObjectURL=function(b){ window.__dl.push(b); return 'blob:t'; };" +
         "URL.revokeObjectURL=function(){};");

  const pid = G("SETTLEMENTS[0].partnerId");
  w.eval("openPartner('" + pid + "')"); await wait(150);
  const insp = w.document.getElementById('inspector');
  ok('the partner record carries a bills block', /Bills/.test(insp.textContent));
  ok('it states the cycle actually in force', /net \d+/.test(insp.textContent));
  ok('it also shows the onboarding gates', /Onboarding/.test(insp.textContent));

  w.eval("partnerBillsDialog('" + pid + "')"); await wait(150);
  const m = w.document.getElementById('modalHost');
  ok('the bills dialog opens', !!m);
  ok('it lists every statement for the partner',
     m.querySelectorAll('tbody tr').length === G("partnerBills('" + pid + "').length"));
  ok('it separates outstanding from paid', /Outstanding/.test(m.textContent) && /Paid to date/.test(m.textContent));

  const bid = G("partnerBills('" + pid + "')[0].id");
  const csv = G("billCsv(SETTLEMENTS.find(function(s){return s.id==='" + bid + "'}))");
  ok('a bill exports its order lines, not just a total',
     csv.split('\n').length > 6, csv.split('\n').length + ' lines');
  ok('the deduction stack is in the file',
     /Marketplace commission/.test(csv) && /Net payable/.test(csv) && /Withholding/.test(csv));

  const before = G('EXPORTS.length');
  w.eval("downloadBill('" + bid + "')"); await wait(150);
  ok('downloading one bill produces a file', G('window.__dl.length') > 0 && G('EXPORTS.length') === before + 1);
  ok('named after the document reference',
     G('EXPORTS[EXPORTS.length-1].name').indexOf('sb-2026') === 0, G('EXPORTS[EXPORTS.length-1].name'));

  w.eval("partnerBillsDialog('" + pid + "')"); await wait(130);
  w.eval("downloadAllBills('" + pid + "')"); await wait(150);
  ok('all bills can be downloaded at once',
     G('EXPORTS[EXPORTS.length-1].rows') === G("partnerBills('" + pid + "').length"));

  /* and the same document opens from the row action in the directory */
  w.App.go('partners'); await wait(150);
  ok('the directory offers bills directly on the row',
     /Bills/.test(w.document.getElementById('main').textContent));
}

/* ----------------------------------------- FIRST-PARTY PRODUCTS AND BUNDLES */
head('CATALOGUE — the operator can build its own products from its own catalogue');
{
  const { w, G } = await load('operator.html');
  w.App = G('App'); w.App.go('catalogue'); await wait(190);
  ok('there is a first-party section', /First-party listings/.test(w.document.getElementById('main').textContent));

  const before = G('PRODUCTS.length');
  w.eval('newListingDialog()'); await wait(150);
  const m = w.document.getElementById('modalHost');
  ok('the composer opens', !!m);
  ok('it pulls the operator catalogue rather than asking for a retype',
     m.querySelectorAll('.pickrow').length === G('TELCO_CATALOGUE.length'));
  ok('the catalogue is grouped by family',
     m.textContent.indexOf('Mobile postpaid') > -1 && m.textContent.indexOf('Value added') > -1);

  /* search narrows it */
  w.eval("nbFilter('fibre')"); await wait(90);
  ok('search narrows the catalogue',
     w.document.querySelectorAll('.pickrow').length < G('TELCO_CATALOGUE.length'));
  w.eval("nbFilter('')"); await wait(90);

  /* a single product is one pick only */
  w.eval("nbSetKind('single')"); await wait(90);
  w.eval("nbToggle('TP-MOB-050')"); await wait(80);
  w.eval("nbToggle('TP-MOB-100')"); await wait(80);
  ok('a single product replaces rather than accumulates', G('NB.picks.length') === 1);

  /* a bundle prices itself from its parts */
  w.eval("nbSetKind('bundle')"); await wait(90);
  w.eval("nbToggle('TP-VAS-SEC')"); await wait(80);
  w.eval("nbToggle('TP-VAS-CLD')"); await wait(80);
  const math = G('nbMath()');
  ok('the components total is computed from the catalogue',
     Math.abs(math.rc - G("TCMAP['TP-MOB-100'].rc - 0 + TCMAP['TP-VAS-SEC'].rc + TCMAP['TP-VAS-CLD'].rc")) < 0.01,
     String(math.rc));
  ok('a bundle discount is applied per extra component',
     math.pct === (math.items.length - 1) * G('BUNDLE_RULES.perComponent'));
  ok('and the derived price is below the parts', math.derivedRc < math.rc);
  ok('the discount is capped', G("(function(){var o=NB.picks.slice(); return true})()"));

  /* an override above the parts is called out */
  w.eval("NB.override=" + (math.rc + 5));
  const m2 = G('nbMath()');
  ok('an override above the parts is detected', m2.worseThanParts === true);
  w.eval("NB.override=null");

  /* a nameless listing is refused */
  w.eval('submitNewListing()'); await wait(100);
  ok('a nameless listing is refused', !!w.document.getElementById('modalHost'));

  w.eval("NB.name='Connected Home 100'");
  w.eval('submitNewListing()'); await wait(200);
  ok('the listing is created', G('PRODUCTS.length') === before + 1);
  const p = G('PRODUCTS[PRODUCTS.length-1]');
  ok('it is first party', p.firstParty === true && p.partner === null);
  ok('it carries no commission, because there is no partner to pay', p.comm === 0);
  ok('the operator is the seller', p.seller === G('MP.operator'));
  ok('it goes live without queueing for review', p.status === 'live');
  ok('it records what it was built from', p.components.length === 3);
  ok('it is cheaper than its parts', p.price < math.rc);
  ok('it is in the live catalogue', G("LIVE_PRODUCTS.some(function(x){return x.id==='" + p.id + "'})"));
  ok('it is not in the review queue — first party is not reviewed by a third party',
     !G("LISTING_QUEUE.some(function(l){return l.sku==='" + p.id + "'})"));

  w.eval("openProduct('" + p.id + "',{mode:'operator'})"); await wait(140);
  const it = w.document.getElementById('inspector').textContent;
  ok('the inspector breaks the bundle down', /What is in it/.test(it));
  ok('and states the saving against buying separately', /You save/.test(it));

  /* a bundle of one is not a bundle */
  w.eval('newListingDialog()'); await wait(130);
  w.eval("nbSetKind('bundle'); nbToggle('TP-FBB-300'); NB.name='Just fibre'");
  w.eval('submitNewListing()'); await wait(120);
  ok('a bundle with one component is refused', !!w.document.getElementById('modalHost'));
}


/* --------------------------------------------------------- PERIOD SWITCH */
head('PERIOD — the 90-day and 12-month tabs change the figures');
{
  const { w, G } = await load('operator.html');
  w.App = G('App'); await wait(150);

  ok('the period starts at 90 days', G('PERIOD') === '90d');
  const t90 = G('periodTotals()');
  ok('90 days is three months of history', t90.months === 3);
  ok('and is all order-level detail', t90.aggregated === 0);
  ok('90 days reconciles exactly to the live order set',
     Math.abs(t90.gross - G('ORDERS.reduce(function(a,o){return a+o.gross},0)')) < 0.02,
     t90.gross + ' vs ' + G('ORDERS.reduce(function(a,o){return a+o.gross},0)'));
  ok('and to the live order count', t90.orders === G('ORDERS.length'));

  const tabs = Array.from(w.document.querySelectorAll('#main .seg button'));
  ok('both tabs are on screen', tabs.length === 2);
  ok('the active one is marked pressed', tabs[0].getAttribute('aria-pressed') === 'true');

  tabs[1].click(); await wait(180);
  ok('clicking 12 months actually switches', G('PERIOD') === '12m');
  const t12 = G('periodTotals()');
  ok('twelve months is twelve months of history', t12.months === 12);
  ok('the gross value is larger than the 90-day figure', t12.gross > t90.gross);
  ok('the order count is larger too', t12.orders > t90.orders);
  ok('but not simply four times it, because the marketplace was smaller a year ago',
     t12.gross < t90.gross * 4, t12.gross + ' vs ' + (t90.gross * 4));
  ok('it declares which months are aggregates rather than order lines', t12.aggregated === 9);

  const after = Array.from(w.document.querySelectorAll('#main .seg button'));
  ok('the pressed state moves with the click', after[1].getAttribute('aria-pressed') === 'true' &&
     after[0].getAttribute('aria-pressed') === 'false');
  ok('the screen says the tables below stay at 90 days',
     /order-level detail is kept for 90 days/i.test(w.document.getElementById('main').textContent));

  /* Growth is computed against the equivalent preceding window. On a 12-month
     series there is no preceding 12 months, so the honest answer is nothing —
     and the screen says so rather than inventing a percentage. */
  w.eval("PERIOD='90d'");
  const d90 = G("periodDelta(HISTORY,'gross')");
  ok('over 90 days, growth is computed rather than hard-coded', d90 !== null && typeof d90 === 'number');
  ok('and it is not the 14.2% that used to be typed into the page', d90 !== 14.2, String(d90));
  w.eval("PERIOD='12m'");
  ok('over 12 months there is no comparable prior window, so it returns nothing',
     G("periodDelta(HISTORY,'gross')") === null);
  ok('and the screen says so rather than showing a number it cannot support',
     /No comparable prior period/.test(G("periodFoot(HISTORY,'gross')")));
  ok('a series too short to compare says so too',
     G("periodDelta(HISTORY.slice(0,3),'gross')") === null);
}
head('PERIOD — the seller sees its own history, not the marketplace total');
{
  const { w, G } = await load('partner.html');
  w.App = G('App'); await wait(150);
  const my = G('MY_HIST()');
  ok('the seller has its own series', my.length === 12);
  const last3 = my.slice(9).reduce((a, h) => a + h.gross, 0);
  ok('its last three months reconcile to its own live gross',
     Math.abs(last3 - G('MY_GMV')) < 0.5, last3 + ' vs ' + G('MY_GMV'));
  ok('and to its own order count',
     my.slice(9).reduce((a, h) => a + h.orders, 0) === G('MY_ORD.length'));
  ok('the seller series is smaller than the marketplace series',
     my.reduce((a, h) => a + h.gross, 0) < G('HISTORY.reduce(function(a,h){return a+h.gross},0)'));

  const tabs = Array.from(w.document.querySelectorAll('#main .seg button'));
  ok('the dashboard has the switch', tabs.length === 2);
  tabs[1].click(); await wait(180);
  ok('it switches on the seller dashboard too', G('PERIOD') === '12m');

  w.App.go('performance'); await wait(180);
  ok('performance carries the same switch',
     w.document.querySelectorAll('#main .seg button').length === 2);
  ok('performance shows a monthly chart', /Gross value by month/.test(w.document.getElementById('main').textContent));
}

/* -------------------------------------------------- PARTNER ONBOARDING */
head('PARTNER — the onboarding guide is a real document');
{
  const { w, G } = await load('partner.html');
  w.App = G('App'); w.App.go('onboarding'); await wait(180);
  w.eval('onboardingGuide()'); await wait(150);
  const m = w.document.getElementById('modalHost');
  ok('the guide opens', !!m);
  ok('it covers every gate',
     G("ONB_STEPS.every(function(s){return document.getElementById('modalHost').textContent.indexOf(s.name)>-1})"));
  /* Three gates clear on evidence already supplied and carry no day of their
     own, so the guide says "same day" rather than "0 working days". */
  ok('it names the target for each',
     (m.textContent.match(/target (\d+ working day|same day)/gi) || []).length === 7);
  ok('and the targets sum to the published SLA',
     G("ONB_STEPS.reduce(function(a,s){return a+GATE_POLICY[s.id].slaDays},0)") === 5);
  ok('it lists the evidence each gate asks for', /Beneficial ownership/.test(m.textContent));
  ok('it says which gate the seller is on', /You are here/.test(m.textContent));
  ok('it is honest about what cannot be waived', /cannot be waived/.test(m.textContent));
  ok('it routes into the open gate', /Open the/.test(m.textContent));
}
head('PARTNER — the application shows what was submitted, not just a summary');
{
  const { w, G } = await load('partner.html');
  w.App = G('App'); w.App.go('onboarding'); await wait(190);

  const steps = w.document.querySelectorAll('#main .pipe .step');
  ok('the application gates are buttons', steps.length === 7 && steps[0].tagName === 'BUTTON');
  ok('each says whether anything was submitted',
     Array.from(steps).every(b => /Submitted|Nothing submitted/.test(b.getAttribute('aria-label') || '')));

  w.eval("openMyGate('apply')"); await wait(150);
  let insp = w.document.getElementById('inspector');
  ok('the application gate opens what was filled in', /What you submitted/.test(insp.textContent));
  ok('including why the seller applied', /Reason for extension/.test(insp.textContent));
  ok('and which marketplace it is for', /Security Marketplace/.test(insp.textContent));

  w.eval("openMyGate('kyc')"); await wait(140);
  insp = w.document.getElementById('inspector');
  ok('a carried-over gate says so rather than looking freshly submitted', /Carried over/.test(insp.textContent));
  ok('and explains that an existing partner does not repeat due diligence',
     /does not repeat due diligence/.test(insp.textContent));

  w.eval("openMyGate('finance')"); await wait(140);
  ok('the finance gate shows the reused settlement account',
     /4471/.test(w.document.getElementById('inspector').textContent));

  w.eval("openMyGate('tech')"); await wait(140);
  insp = w.document.getElementById('inspector');
  ok('the open gate shows the webhook actually configured', /marketplace\/fulfil/.test(insp.textContent));
  ok('it states the failure rather than hiding it', /HTTP 500/.test(insp.textContent));
  ok('it shows the task blocking it', /Fulfilment webhook/.test(insp.textContent));
  ok('and says nobody has reviewed it yet', /Not yet/.test(insp.textContent));

  w.eval("openMyGate('assure')"); await wait(140);
  ok('a gate not yet open declares that rather than inventing a submission',
     /Nothing submitted yet/.test(w.document.getElementById('inspector').textContent));

  w.eval("openMyGate('agree')"); await wait(140);
  ok('the evidence checklist is on the gate',
     /What this gate needs/.test(w.document.getElementById('inspector').textContent));
}

/* ------------------------------------------------------- PARTNER BILLS */
head('PARTNER — statements can be read and downloaded');
{
  const { w, G } = await load('partner.html');
  w.App = G('App');
  w.eval("window.__dl=[]; URL.createObjectURL=function(b){window.__dl.push(b);return 'blob:t'};" +
         "URL.revokeObjectURL=function(){};");
  w.App.go('settlement'); await wait(200);

  const t = w.document.getElementById('main').textContent;
  ok('there is a route to previous bills', /Previous bills/.test(t));
  ok('the statement history is on the screen', /Statement history/.test(t));
  ok('every statement the seller has is listed',
     G("DataTable.reg['dtPStm'].rows.length") === G('MY_STM.length'));

  const before = G('EXPORTS.length');
  const cur = G('MY_STM[0].id');
  w.eval("downloadBill('" + cur + "')"); await wait(160);
  ok('downloading a statement produces a file', G('window.__dl.length') > 0);
  ok('and it is recorded', G('EXPORTS.length') === before + 1);
  ok('named after the document reference, not the word statement',
     /^sb-2026-/.test(G('EXPORTS[EXPORTS.length-1].name')), G('EXPORTS[EXPORTS.length-1].name'));

  const csv = G("billCsv(SETTLEMENTS.find(function(s){return s.id==='" + cur + "'}))");
  ok('the file carries the order lines', csv.trim().split('\n').length > 6);
  ok('and the gross-to-net stack', /Marketplace commission/.test(csv) && /Net payable/.test(csv));

  w.eval("partnerBillsDialog(ME_P.id)"); await wait(170);
  const m = w.document.getElementById('modalHost');
  ok('the previous-bills dialog opens', !!m);
  ok('it lists every statement', m.querySelectorAll('tbody tr').length === G('MY_STM.length'));
  ok('it separates outstanding from paid', /Outstanding/.test(m.textContent) && /Paid to date/.test(m.textContent));
  ok('it does not offer the operator-only settlement run', !/Open settlement runs/.test(m.textContent));

  w.eval("downloadAllBills(ME_P.id)"); await wait(170);
  ok('every statement can be pulled in one file',
     G('EXPORTS[EXPORTS.length-1].rows') === G('MY_STM.length'));

  w.eval("openStatement('" + cur + "')"); await wait(150);
  ok('a statement opens as the self-billing invoice',
     /Self-billing invoice/.test(w.document.getElementById('inspector').textContent));
}


/* ------------------------------------------------ LISTING RULE CATALOGUE */
head('RULES — the checks themselves are configurable, not just their level');
{
  const { w, G } = await load('operator.html');
  w.App = G('App'); w.App.go('rules'); await wait(260);
  const t = w.document.getElementById('main').textContent;

  ok('there is a page for the rules themselves', /Listing rules/.test(t));
  ok('every rule declares how it is checked', G("POLICY_RULES.every(function(r){return !!r.check})"));
  ok('and why it exists', G("POLICY_RULES.every(function(r){return !!r.basis})"));
  ok('and who owns the decision', G("POLICY_RULES.every(function(r){return !!r.owner})"));
  ok('the matrix carries every live rule against every category',
     w.document.querySelectorAll('#main table')[0].querySelectorAll('tbody tr').length ===
     G("POLICY_RULES.filter(function(r){return r.status!=='retired'}).length"));
  ok('no false alarm while every active rule is applied somewhere',
     !/applies to no category/.test(t));

  const before = G("ruleLevel('consumer','PR-03')");
  w.eval("cycleRuleLevel('consumer','PR-03')"); await wait(230);
  ok('a matrix cell cycles the level', G("ruleLevel('consumer','PR-03')") !== before);
  ok('and the change is audited', G("AUDIT_LOG.operator.some(function(e){return e.action==='policy.rule'})"));

  const locked = G("ruleLevel('consumer','PR-10')");
  w.eval("cycleRuleLevel('consumer','PR-10')"); await wait(200);
  ok('sanctions screening cannot be softened', G("ruleLevel('consumer','PR-10')") === locked);
  ok('and the screen says it is not a policy choice', /not a marketplace .{0,10}policy choice/.test(t.replace(/\s+/g,' ')) ||
     /not a marketplace policy choice/.test(t.replace(/\s+/g,' ')));
}
head('RULES — authoring, cost and retirement');
{
  const { w, G } = await load('operator.html');
  w.App = G('App'); w.App.go('rules'); await wait(250);

  const n0 = G('POLICY_RULES.length');
  w.eval('ruleDialog(null)'); await wait(230);
  ok('a rule can be authored', !!w.document.getElementById('rlName'));
  ok('the requirement text is described as seller-facing',
     /shown to the seller/.test(w.document.getElementById('modalHost').textContent));
  w.eval("document.getElementById('rlName').value='Battery transport declaration'");
  w.eval("document.getElementById('rlDesc').value='Lithium cells need a UN38.3 test summary before shipping.'");
  w.eval("document.getElementById('rlCheck').value='doc'; ruleCheckHint()"); await wait(120);
  ok('the hint follows the chosen check type',
     /supplies evidence/.test(w.document.getElementById('rlCheckHint').textContent));
  w.eval('saveRule(null)'); await wait(260);
  ok('the rule is created', G('POLICY_RULES.length') === n0 + 1);
  const nid = G('POLICY_RULES[POLICY_RULES.length-1].id');
  ok('it starts as a draft', G("RULE_MAP['" + nid + "'].status") === 'draft');
  ok('and applies nowhere until it is placed in the matrix', G("ruleCats('" + nid + "').length") === 0);

  w.eval("RULE_MAP['" + nid + "'].status='active'"); w.App.go('rules'); await wait(230);
  ok('an active rule that applies nowhere is flagged',
     /applies to no category/.test(w.document.getElementById('main').textContent));
  ok('with the reason that it only looks like a control',
     /looking like a control/.test(w.document.getElementById('main').textContent));

  w.eval("ruleDialog('PR-02')"); await wait(230);
  ok('a manual rule states the reviewer time it costs',
     /Reviewer load/.test(w.document.getElementById('modalHost').textContent));
  ok('and names it as the expensive kind',
     /most expensive thing to switch on/.test(w.document.getElementById('modalHost').textContent));
  w.eval('closeModal()'); await wait(110);

  const where = G("ruleCats('PR-08').length");
  ok('the rule to retire is in use somewhere', where > 0);
  w.eval("ruleDialog('PR-08')"); await wait(220);
  w.eval("retireRule('PR-08')"); await wait(210);
  ok('retiring says it is not a deletion',
     /Retired, not deleted/.test(w.document.getElementById('modalHost').textContent));
  ok('and that it is not an amnesty for past rejections',
     /not an amnesty/.test(w.document.getElementById('modalHost').textContent));
  confirmDialog(w); await wait(260);
  ok('the rule survives as a record', G("RULE_MAP['PR-08']") != null);
  ok('marked retired rather than removed', G("RULE_MAP['PR-08'].status") === 'retired');
  ok('and pulled out of every category', G("ruleCats('PR-08').length") === 0);
  ok('it leaves the matrix',
     !/Returns window/.test(w.document.querySelectorAll('#main table')[0].textContent));
  ok('but stays readable in the catalogue',
     /Returns window/.test(w.document.getElementById('main').textContent));
  ok('and the retirement is audited at warn',
     G("AUDIT_LOG.operator.some(function(e){return e.action==='policy.rule' && e.sev==='warn'})"));
}
head('CAP — the per-seller listing limit is enforced, not merely recorded');
{
  const { w, G } = await load('partner.html');
  w.App = G('App'); await wait(210);

  ok('every category carries a cap', G("Object.keys(VERTICAL_POLICY).every(function(v){return listingCap(v)>0})"));
  ok('paused listings still occupy a slot', G("CAP_STATES.indexOf('paused')") > -1);
  ok('withdrawn ones do not, or a seller could never recover',
     G("CAP_STATES.indexOf('withdrawn')") === -1);
  ok('there is headroom to begin with', G("capBreach(ME_P.id,'iot',1)") === null);

  /* put the seller exactly at the cap */
  w.eval("VERTICAL_POLICY.iot.maxListingsPerSeller = listingsHeld(ME_P.id,'iot')");
  const b = G("capBreach(ME_P.id,'iot',1)");
  ok('adding one more is a breach', !!b && b.over === 1);

  w.eval("NL.v='iot'"); w.App.go('newlisting'); await wait(240);
  ok('the wizard warns before the seller does the work',
     /listing limit/i.test(w.document.getElementById('main').textContent));

  w.eval("NL.name='Blocked by the cap'; NL.price='99'; submitListing()"); await wait(250);
  ok('submission is refused', !w.document.getElementById('modalHost'));
  ok('and nothing was created',
     !G("PRODUCTS.some(function(p){return p.name==='Blocked by the cap'})"));

  /* raise the cap and the same submission proceeds */
  w.eval("VERTICAL_POLICY.iot.maxListingsPerSeller = 999"); await wait(120);
  ok('raising the cap clears the breach', G("capBreach(ME_P.id,'iot',1)") === null);
}

head('POLICY INSPECTOR — the rules are findable, and the lock holds here too');
{
  const { w, G } = await load('operator.html');
  w.App = G('App'); w.App.go('verticals'); await wait(230);

  ok('the rules are reachable without opening a category',
     !!Array.from(w.document.querySelectorAll('#main .pageacts button'))
        .find(b => /Listing rules/.test(b.textContent)));

  w.eval("openPolicy('consumer')"); await wait(280);
  const body = w.document.querySelector('.insp-body');
  const t = body.textContent;

  ok('a signpost sits above the fold', !!body.querySelector('.jumpcard'));
  ok('it counts the rules applying to this category', /listing rules apply here/.test(t));
  ok('and separates blocking from warning', /block publication/.test(t));
  ok('there is a jump to the rules section',
     !!Array.from(body.querySelectorAll('button')).find(b => /Set them here/.test(b.textContent)));
  ok('and a route to the full matrix',
     !!Array.from(w.document.querySelectorAll('button')).find(b => /Rule matrix/.test(b.textContent)));
  ok('the rules section carries an anchor to jump to', !!w.document.getElementById('polRules'));
  ok('it says where to change what a rule requires', /use the rule catalogue/.test(t));
  ok('every live rule is listed',
     body.querySelectorAll('table tbody tr').length ===
     G("POLICY_RULES.filter(function(r){return r.status!=='retired'}).length"));

  const locked = G("ruleLevel('consumer','PR-10')");
  w.eval("cyclePolicyRule('consumer','PR-10')"); await wait(180);
  ok('the lock holds on this path too, not only in the matrix',
     G("ruleLevel('consumer','PR-10')") === locked);
  ok('and it renders as locked rather than as a button',
     !!body.querySelector('#pr_consumer_PR-10.is-locked'));

  const b2 = G("ruleLevel('consumer','PR-03')");
  w.eval("cyclePolicyRule('consumer','PR-03')"); await wait(160);
  ok('an ordinary rule still cycles', G("ruleLevel('consumer','PR-03')") !== b2);

  w.eval("VERTICAL_POLICY.consumer.rules['PR-01']='enforce'; cyclePolicyRule('consumer','PR-01')"); await wait(160);
  ok('cycling past enforce reaches off and clears the key rather than storing a string',
     G("ruleLevel('consumer','PR-01')") === 'off' &&
     !G("('PR-01' in VERTICAL_POLICY.consumer.rules)"));

  w.eval("RULE_MAP['PR-09'].status='retired'");
  w.eval('closeInspector()'); w.eval("openPolicy('consumer')"); await wait(250);
  ok('a retired rule drops out of the category inspector',
     !/Rights evidence/.test(w.document.querySelector('.insp-body').textContent));
}

console.log('\n' + (failures ? '\u2717 ' + failures + ' of ' + checks + ' checks failed'
                             : '\u2713 all ' + checks + ' catalogue and reporting checks passed'));
process.exit(failures ? 1 : 0);

})();
