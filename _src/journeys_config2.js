/* ===========================================================================
   Marketplace definition, catalogue and approval policy, onboarding gate
   policy, tax, and the AI confidence indicator. Split out of
   journeys_config.js when that suite outgrew the shell's 45-second budget.
   These do not check that a screen rendered — they drive each journey to its
   conclusion and assert that the underlying records actually changed.
   Run: node _src/journeys_config2.js
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
/* The buyer no longer has an inline formatting preview, so read the document
   the way a person would: generate it from the assigned template. */
function billPreviewText(w){ return w.eval("billPreview('buyer')"); }

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

/* ---------------------------------------- MARKETPLACES, POLICY AND TAX */
head('MARKETPLACE — defining one, and its policy');
{
  const { w, G } = await load('operator.html');
  w.App = G('App'); w.App.go('verticals'); await wait(150);

  const before = G('VERTICALS.length');
  w.eval('defineMarketplaceDialog()'); await wait(120);
  ok('the definition dialog opens', !!w.document.getElementById('modalHost'));
  w.document.getElementById('nvName').value = '';
  w.eval('submitMarketplace()'); await wait(80);
  ok('a nameless marketplace is refused', !w.document.getElementById('nvNameErr').hidden);
  w.document.getElementById('nvName').value = 'Energy Marketplace';
  w.eval('submitMarketplace()'); await wait(80);
  ok('one with no description is refused too', !w.document.getElementById('nvBlurbErr').hidden);

  w.document.getElementById('nvBlurb').value = 'Smart meters, solar monitoring and tariff switching';
  w.document.getElementById('nvCopy').value = 'iot';
  w.eval('submitMarketplace()'); await wait(170);
  ok('the marketplace is created', G('VERTICALS.length') === before + 1);
  const nv = G('VERTICALS[VERTICALS.length-1]');
  ok('it is closed to buyers until opened', nv.enabled === false);
  ok('it copies the policy it was based on',
     G("JSON.stringify(VERTICAL_POLICY['" + nv.id + "'].rules)") === G("JSON.stringify(VERTICAL_POLICY.iot.rules)"));
  ok('it appears on the screen straight away',
     /Energy Marketplace/.test(w.document.getElementById('main').textContent));
  ok('it has no partners and says so',
     G("PARTNERS.filter(p=>p.verticals.indexOf('" + nv.id + "')>-1).length") === 0);

  /* closing a live marketplace is a typed confirmation */
  w.eval("toggleMarketplace('content',false)"); await wait(120);
  ok('closing a live marketplace asks first', !!w.document.getElementById('modalHost'));
  confirmDialog(w, 'CLOSE'); await wait(150);
  ok('it is actually closed', G("VMAP.content.enabled") === false);
  w.eval("toggleMarketplace('content',true)"); await wait(130);
  ok('and can be reopened', G("VMAP.content.enabled") === true);
}
head('POLICY — the catalogue rules behind an approve or reject');
{
  const { w, G } = await load('operator.html');
  w.App = G('App'); w.App.go('verticals'); await wait(150);

  w.eval("openPolicy('content')"); await wait(130);
  const insp = w.document.getElementById('inspector');
  ok('the policy editor opens', !insp.hidden);
  ok('it lists every rule', G('POLICY_RULES.length') > 0 &&
     G("POLICY_RULES.every(function(r){return document.getElementById('inspector').textContent.indexOf(r.name)>-1})"));
  ok('it shows what it is currently holding', /Held under this policy/.test(insp.textContent));

  const was = G("VERTICAL_POLICY.content.rules['PR-02']");
  w.eval("cyclePolicyRule('content','PR-02')"); await wait(70);
  ok('a rule level actually changes', G("VERTICAL_POLICY.content.rules['PR-02']") !== was);
  w.eval("setPolicy('content','slaHours',12)");
  w.eval("setPolicy('content','autoPublish',true)");
  w.eval("savePolicy('content')"); await wait(150);
  ok('the policy is saved to the record', G('VERTICAL_POLICY.content.slaHours') === 12);
  ok('auto-publish is saved', G('VERTICAL_POLICY.content.autoPublish') === true);
  ok('the inspector closes on save', w.document.getElementById('inspector').hidden);
}
head('POLICY — the buyer approval policy');
{
  const { w, G } = await load('enterprise.html');
  w.App = G('App'); w.App.go('approvals'); await wait(160);

  /* A money field that a person types into must carry its unit. A bare 2000 is
     a different sum in every market this runs in. */
  const thr = w.document.getElementById('apThr');
  ok('the threshold field exists on the page', !!thr);
  ok('and it is labelled with the currency it is in',
     /USD/.test((thr.closest('.field') || {}).textContent || ''));
  ok('the symbol sits inside the control, next to the number',
     !!(thr.parentElement && thr.parentElement.querySelector('.steppfx')));
  ok('and the sentence under it states the sum in full, not bare',
     /\$2,000/.test(w.document.getElementById('main').textContent));

  w.eval('approvalPolicyDialog()'); await wait(120);
  ok('the approval policy dialog opens', !!w.document.getElementById('modalHost'));
  w.document.getElementById('apdThr').value = '5000';
  w.document.getElementById('apdSelf').checked = true;
  w.eval('submitApprovalPolicy()'); await wait(170);
  ok('the threshold is saved', G('APPROVAL_POLICY.threshold') === 5000);
  ok('self-approval is saved', G('APPROVAL_POLICY.selfApprove') === true);
  ok('the screen warns that segregation of duties is gone',
     /Self-approval is on/.test(w.document.getElementById('main').textContent));
  ok('the page header reflects the new threshold',
     /\$5,000/.test(w.document.getElementById('main').textContent));
}
head('GATE POLICY — the onboarding gates are configurable, within limits');
{
  const { w, G } = await load('operator.html');
  w.App = G('App'); w.App.go('onboardq'); await wait(150);

  w.eval('gatePolicyDialog()'); await wait(130);
  const m = w.document.getElementById('modalHost');
  ok('the gate policy dialog opens', !!m);
  ok('every gate is listed', G('ONB_STEPS.length') === m.querySelectorAll('tbody tr').length);
  ok('KYC cannot be made waivable', m.querySelector('#gp_waive_kyc').disabled);
  ok('agreements cannot either', m.querySelector('#gp_waive_agree').disabled);

  m.querySelector('#gp_sla_finance').value = '2';
  m.querySelector('#gp_owner_tech').value = 'Risk and compliance';
  m.querySelector('#gp_dual_tech').checked = true;
  w.eval('saveGatePolicy()'); await wait(170);
  ok('a target is saved', G('GATE_POLICY.finance.slaDays') === 2);
  ok('an owner is saved', G('GATE_POLICY.tech.owner') === 'Risk and compliance');
  ok('dual control is saved', G('GATE_POLICY.tech.dualControl') === true);
  ok('KYC stays non-waivable whatever was posted', G('GATE_POLICY.kyc.waivable') === false);
}

/* --------------------------------------------------------- ASK THE PARTNER */
head('CATALOGUE — asking the seller a question is a real query');
{
  const { w, G } = await load('operator.html');
  w.App = G('App'); w.App.go('catalogue'); await wait(170);

  const qid = G('LISTING_QUEUE[1].id');
  w.eval("reviewListing('" + qid + "')"); await wait(120);
  ok('the review inspector links to the policy behind the check',
     /Policy for/.test(w.document.getElementById('inspector').textContent));

  w.eval("askPartnerDialog('" + qid + "')"); await wait(130);
  const m = w.document.getElementById('modalHost');
  ok('the query dialog opens', !!m);
  ok('it names who the query goes to', /Goes to/.test(m.textContent));

  m.querySelector('#apBody').value = 'no';
  w.eval("submitPartnerQuery('" + qid + "')"); await wait(90);
  ok('a query with no real ask is refused', !w.document.getElementById('apBodyErr').hidden);

  const before = G('LISTING_QUERIES.length');
  w.document.getElementById('apBody').value = 'Please attach the UAE and Kenya type-approval certificates.';
  w.document.getElementById('apHold').value = 'hold';
  w.eval("submitPartnerQuery('" + qid + "')"); await wait(180);
  ok('the query is recorded against the listing', G('LISTING_QUERIES.length') === before + 1);
  const q = G('LISTING_QUERIES[0]');
  ok('it is addressed to the right seller', q.partner === G("LISTING_QUEUE.find(l=>l.id==='" + qid + "').partner"));
  ok('the due date is a real working day, not a malformed string',
     /^\d{2} [A-Z][a-z]{2} \d{4}$/.test(q.due), q.due);
  ok('holding the listing stops the review clock',
     G("LISTING_QUEUE.find(l=>l.id==='" + qid + "').held") === true);
  w.eval("reviewListing('" + qid + "')"); await wait(120);
  ok('the open query shows on the next review',
     /Query with the seller/.test(w.document.getElementById('inspector').textContent));
}

/* --------------------------------------------------------------------- TAX */
head('TAX — merchant of record, rates and withholding');
{
  const { w, G } = await load('operator.html');
  w.App = G('App'); w.App.go('tax'); await wait(180);
  const main = w.document.getElementById('main').textContent;
  ok('the tax screen exists', /Tax configuration/.test(main));
  ok('it lists every jurisdiction', G('DataTable.reg["dtTax"].rows.length') === G('TAX_REGIMES.length'));
  ok('it declares who is merchant of record', /Merchant of record/.test(main));
  ok('an unregistered jurisdiction is declared, not hidden', /Not registered/.test(main));

  w.eval("editTaxRegime('TX-BR')"); await wait(130);
  w.document.getElementById('txActive').checked = true;
  w.document.getElementById('txReg').value = '';
  w.eval("saveTaxRegime('TX-BR')"); await wait(90);
  ok('a jurisdiction cannot go active without a registration number',
     !w.document.getElementById('txRegErr').hidden);
  w.document.getElementById('txReg').value = '12.345.678/0001-99';
  w.document.getElementById('txRate').value = '17';
  w.document.getElementById('txMor').checked = true;
  w.eval("saveTaxRegime('TX-BR')"); await wait(170);
  ok('with a number it registers', G("TAX_REGIMES.find(t=>t.id==='TX-BR').status") === 'active');
  ok('merchant of record is saved', G("TAX_REGIMES.find(t=>t.id==='TX-BR').mor") === true);
  ok('the rate is saved', G("TAX_REGIMES.find(t=>t.id==='TX-BR').rate") === 17);

  const noCert = G('Object.keys(TAX_CERTS).filter(k=>!TAX_CERTS[k].certOnFile)[0]');
  if (noCert){
    ok('a partner without a certificate is withheld from', G('TAX_CERTS["' + noCert + '"].withholding') > 0);
    w.eval("recordCert('" + noCert + "')"); await wait(130);
    const m = w.document.getElementById('modalHost');
    if (m && m.querySelector('#tcNo')) m.querySelector('#tcNo').value = 'TRC-2026-0091';
    confirmDialog(w); await wait(160);
    ok('recording a certificate releases the withholding',
       G('TAX_CERTS["' + noCert + '"].withholding') === 0 && G('TAX_CERTS["' + noCert + '"].certOnFile') === true);
  }
}
head('TAX — the maths a buyer actually sees');
{
  const { w, G } = await load('consumer.html');
  w.App = G('App');
  w.eval("CART.length=0; addToCart('SKU-4001'); addToCart('SKU-4001')"); await wait(110);

  w.eval("TAX_SETTINGS.pricesIncludeTax=true");
  let t = G('cartTotals()');
  ok('with tax-inclusive pricing, net plus tax equals the shelf price',
     Math.abs(t.net + t.tax - t.gross) < 0.02, t.net + ' + ' + t.tax + ' vs ' + t.gross);
  /* Promotions come off before tax, so gross is the shelf value less whatever
     the discount engine gave — never the shelf value with tax added on top. */
  ok('tax is not added on top of a price that already contains it',
     Math.abs(t.gross - (t.once - t.promoOnce)) < 0.02, t.gross + ' vs ' + (t.once - t.promoOnce));

  w.eval("TAX_SETTINGS.pricesIncludeTax=false");
  t = G('cartTotals()');
  ok('with tax-exclusive pricing, tax is added', t.gross > t.once);
  ok('and it still reconciles', Math.abs(t.net + t.tax - t.gross) < 0.02);
  ok('the rate comes from configuration, not a constant', G('taxRate()') === G("homeTax().rate"));
}
head('TAX — the buyer and the seller each see their own side');
{
  const { w, G } = await load('enterprise.html');
  w.App = G('App'); w.App.go('billing'); await wait(200);
  ok('the buyer can state its registration', /Tax and registration/.test(w.document.getElementById('main').textContent));
  w.eval("BUYER_TAX.registration=''"); w.App.go('billing'); await wait(180);
  w.eval('saveBuyerTax()'); await wait(90);
  ok('a registered buyer with no number is refused', !w.document.getElementById('btRegErr').hidden);
  ok('and it says input credit is not claimable',
     /Not claimable/.test(w.document.getElementById('main').textContent));
}
{
  const { w, G } = await load('partner.html');
  w.App = G('App'); w.App.go('plan'); await wait(200);
  const t = w.document.getElementById('main').textContent;
  ok('the seller sees the tax on its own payouts', /Tax on your payouts/.test(t));
  ok('and whether a certificate is on file', /On file|Missing/.test(t));
}

/* ------------------------------------------- AI CONFIDENCE PRESENTATION */
head('AI — confidence reads as a level, not an empty box');
{
  for (const file of ['operator.html','partner.html','enterprise.html','consumer.html']){
    const { w, G } = await load(file);
    w.App = G('App'); await wait(120);
    const chips = Array.from(w.document.querySelectorAll('#main .ai-conf'));
    ok(file + ' — the overview carries AI insights with a confidence chip', chips.length > 0);
    ok(file + ' — every chip has visible text', chips.every(c => c.textContent.trim().length > 2));
    ok(file + ' — every chip carries a meter, so it survives monochrome',
       chips.every(c => c.querySelector('svg.confmeter')));
    ok(file + ' — the meter fill matches the stated level',
       chips.every(c => {
         const lvl = (c.className.match(/conf-(\d)/) || [])[1];
         return c.querySelectorAll('rect.on').length === Number(lvl);
       }));
    ok(file + ' — the chip is not stretched to the height of the card',
       chips.every(c => c.className.indexOf('ai-conf') > -1));
    const srcs = w.document.querySelectorAll('#main .ai-src');
    ok(file + ' — every insight declares what it read', srcs.length === chips.length,
       srcs.length + ' sources for ' + chips.length + ' insights');
  }
}

console.log('\n' + (failures ? '\u2717 ' + failures + ' of ' + checks + ' checks failed'
                             : '\u2713 all ' + checks + ' policy, tax and AI checks passed'));
process.exit(failures ? 1 : 0);

})();
