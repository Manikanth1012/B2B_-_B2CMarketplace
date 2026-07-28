/* ===========================================================================
   Documents and billing: the PDF writer, the bill template system, and every
   download button in every persona. Tenth file, to stay inside the shell's
   45-second budget.
   Eighth file, to stay inside the shell's 45-second budget.
   These do not check that a screen rendered — they drive each journey to its
   conclusion and assert that the underlying records actually changed.
   Run: node _src/journeys_billing.js
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
/* ------------------------------------------------------- DOWNLOADS ------ */
head('DOWNLOADS — every one of them produces a real file');
{
  const { w, G } = await load('operator.html');
  w.App = G('App'); await wait(200);
  /* Intercept the download rather than write to disk. */
  w.eval("window.__cap=null; downloadFile=function(n,d,m){window.__cap={name:n,len:(d.length||0),"+
         "mime:m,bin:(d instanceof Uint8Array),head:(d instanceof Uint8Array)?"+
         "String.fromCharCode.apply(null,d.slice(0,8)):String(d).slice(0,8)};return true;};");

  const cases=[
    ['downloadStatementPdf(SETTLEMENTS[0])','settlement statement','application/pdf'],
    ['downloadGateDocPdf("Certificate of incorporation","Northwind Mobility")','onboarding document','application/pdf'],
    ['downloadSellerBill(SETTLEMENTS[0].id)','seller bill','application/pdf'],
    ['downloadApiSpec(API_PRODUCTS[0].id)','OpenAPI description','application/json'],
    ['downloadSamplePayload()','sample payload','application/json'],
    ['bulkTemplate("bulk-listing")','bulk template','text/csv']
  ];
  for(const [call,label,mime] of cases){
    w.eval('window.__cap=null'); w.eval(call); await wait(140);
    const c=G('window.__cap');
    ok(label+' produces a file', !!c && c.len>400, c? c.len+' bytes':'nothing');
    ok(label+' carries the right type', !!c && c.mime===mime, c?c.mime:'-');
  }

  w.eval('window.__cap=null'); w.eval('downloadStatementPdf(SETTLEMENTS[0])'); await wait(160);
  const pdf=G('window.__cap');
  ok('a PDF is delivered as bytes, not as text', pdf.bin===true);
  ok('and begins with a PDF header', /^%PDF-1\./.test(pdf.head));
  ok('the brand artwork is embedded rather than redrawn',
     G('typeof BRAND_IMG!=="undefined" && !!BRAND_IMG.sixd && !!BRAND_IMG.operator'));
}
head('BILL — a document somebody would recognise as a bill');
{
  const { w, G } = await load('enterprise.html');
  w.App = G('App'); w.App.go('billing'); await wait(240);
  w.eval("window.__cap=null; window.__pdf=null;"+
         "downloadFile=function(n,d,m){window.__cap={name:n,len:d.length,mime:m};"+
         "window.__pdf=String.fromCharCode.apply(null,d.slice(0,d.length));return true;};");
  w.eval('downloadEnterpriseBill(entInvoices()[0])'); await wait(320);

  const cap=G('window.__cap'), body=G('window.__pdf');
  ok('the bill downloads', !!cap && cap.len>10000, cap?cap.len+' bytes':'nothing');
  ok('it runs to more than one page', (body.match(/\/Type \/Page[^s]/g)||[]).length>1);
  ok('both logos are embedded as images', (body.match(/\/Subtype \/Image/g)||[]).length>=2);
  ok('with transparency preserved', /\/SMask/.test(body));

  /* the sections a bill is expected to carry */
  for(const [needle,label] of [
    ['Consolidated bill','a title'],
    ['BILLED TO','who it is for'],
    ['Amount due','the headline figure'],
    ['Subscriptions and recurring charges','the recurring stack'],
    ['Taxation','a tax breakdown'],
    ['Summary','a summary'],
    ['How to pay','payment instructions'],
    ['Terms and conditions','terms'],
    ['Payment slip','a detachable slip'],
    ['GSTIN','the issuer tax registration']
  ]) ok('the bill carries '+label, body.indexOf(needle)>-1);

  ok('a zero credit is not written as minus zero', body.indexOf('-$0.00')===-1);
  ok('and the issuer is named on it', body.indexOf('Aventa Telecom Services Limited')>-1);
}

/* --------------------------------------------------- BILL TEMPLATES ----- */
head('BILL TEMPLATES — a bill is configuration, not a hard-coded layout');
{
  const { w, G } = await load('operator.html');
  w.App = G('App'); w.App.go('billing'); await wait(270);
  const t = w.document.getElementById('main').textContent;

  ok('templates are managed from billing configuration', /Bill templates/.test(t));
  ok('there is more than one', G('BILL_TEMPLATES.length') >= 5);
  ok('each audience has a template assigned', /Which template each audience gets/.test(t));
  ok('sections are switchable', G('BILL_SECTIONS.length') > 10);
  ok('four of them cannot be switched off',
     G('BILL_SECTIONS.filter(function(s){return s.locked}).length') === 4);
  ok('and the locked ones are the ones that make it a bill',
     G("BILL_SECTIONS.filter(function(s){return s.locked}).map(function(s){return s.id}).sort().join()")
       === 'masthead,parties,summary,tax');

  w.eval("billTemplateDialog('BT-CON')"); await wait(240);
  ok('a template opens for editing', !!w.document.getElementById('btName'));
  ok('locked sections are disabled in the editor', !!w.document.querySelector('.btSec[disabled]'));
  w.eval("document.getElementById('btAud').value='partner'; btPreview()"); await wait(140);
  ok('an advert on a seller document is questioned',
     /did not ask to be sold to/.test(w.document.getElementById('btWarn').textContent));
  ok('a payment slip on a self-billing invoice is called backwards',
     /backwards/.test(w.document.getElementById('btWarn').textContent));
  w.eval('closeModal()'); await wait(110);

  const n0 = G('BILL_TEMPLATES.length');
  w.eval("duplicateBillTemplate('BT-CON')"); await wait(230);
  ok('a template can be duplicated', G('BILL_TEMPLATES.length') === n0 + 1);
  const nid = G('BILL_TEMPLATES[BILL_TEMPLATES.length-1].id');
  ok('and the copy is not built in', G("BTMAP['" + nid + "'].system") === false);
  w.eval("assignBillTemplate('consumer','" + nid + "')"); await wait(150);
  ok('assigning it changes what that audience gets', G('BILL_TEMPLATE_ASSIGN.consumer') === nid);
  ok('and the change is audited',
     G("AUDIT_LOG.operator.some(function(e){return e.action==='bill.template'})"));
  w.eval("assignBillTemplate('consumer','BT-CON')"); await wait(120);

  w.eval("window.__b=null; downloadFile=function(nm,d){window.__b=String.fromCharCode.apply(null,d.slice(0,d.length));return true;}");
  w.eval("previewBillTemplate('BT-MIN')"); await wait(330);
  const mini = G('window.__b');
  ok('a template can be previewed as a real document', !!mini && mini.indexOf('%PDF') === 0);
  ok('the compact template drops the terms', mini.indexOf('Terms and conditions') === -1);
  ok('and drops the payment slip', mini.indexOf('Payment slip') === -1);
  ok('but keeps every locked section',
     mini.indexOf('BILLED TO') > -1 && mini.indexOf('BILL FROM') > -1 &&
     mini.indexOf('Taxation') > -1 && mini.indexOf('Summary') > -1);
}
head('BILLS — a PDF in every persona, not a CSV');
{
  const cases=[
    ['consumer.html','consumer','downloadConsumerBill(MY_BILLS[0])',       true,  true],
    ['enterprise.html','enterprise','downloadEnterpriseBill(entInvoices()[0])', true,  false],
    ['partner.html','partner','downloadSellerBill(partnerBills(ME_P.id)[0].id)', false, false]
  ];
  for (const [file, aud, call, wantSlip, wantAd] of cases){
    const { w, G } = await load(file);
    w.App = G('App'); await wait(210);
    w.eval("window.__b=null; downloadFile=function(nm,d){window.__b={name:nm,txt:(d instanceof Uint8Array)?String.fromCharCode.apply(null,d.slice(0,d.length)):String(d)};return true;}");
    w.eval(call); await wait(340);
    const b = G('window.__b');
    ok(aud + ' downloads a PDF, not a data file', !!b && b.txt.indexOf('%PDF') === 0);
    ok(aud + ' — both parties are named in full',
       b.txt.indexOf('BILLED TO') > -1 && b.txt.indexOf('BILL FROM') > -1);
    ok(aud + ' — the issuer carries its tax registration', b.txt.indexOf('GSTIN') > -1);
    ok(aud + ' — support contact is on the document',
       b.txt.indexOf('Questions about this bill') > -1);
    ok(aud + ' — the taxation breakdown is present', b.txt.indexOf('Taxation') > -1);
    ok(aud + ' — both logos are embedded',
       (b.txt.match(/\/Subtype \/Image/g) || []).length >= 2);
    ok(aud + (wantSlip ? ' — carries a payment slip' : ' — carries no payment slip, correctly'),
       (b.txt.indexOf('Payment slip') > -1) === wantSlip);
    ok(aud + (wantAd ? ' — carries one advert' : ' — carries no advert, correctly'),
       (b.txt.indexOf('While you are here') > -1) === wantAd);
  }
}
head('BILLS — tax is a percentage, and an advert knows when to stay away');
{
  const { w, G } = await load('consumer.html');
  w.App = G('App'); await wait(210);
  w.eval("window.__b=null; downloadFile=function(nm,d){window.__b=String.fromCharCode.apply(null,d.slice(0,d.length));return true;}");
  w.eval("downloadConsumerBill(MY_BILLS[0])"); await wait(330);
  const txt = G('window.__b');
  const tax = (txt.match(/\(Tax\)[\s\S]{0,200}?\(\$([\d,.]+)\)/) || [])[1];
  const rec = G("MY_SUBS.filter(function(s){return s.status==='active'}).reduce(function(a,s){return a+s.price},0)");
  const base = rec + G('MY_BILLS[0].oneoff');
  const expect = +(base * (G('taxRate()') / 100)).toFixed(2);
  ok('tax is computed from a percentage, not a fraction',
     Math.abs(parseFloat(String(tax).replace(/,/g,'')) - expect) < 0.05,
     tax + ' vs ' + expect);

  ok('an advert appears on an ordinary bill', txt.indexOf('While you are here') > -1);
  ok('but never on one chasing money',
     G("billAdvert({status:'overdue'})") === null && G("billAdvert({dunning:true})") === null);
  ok('and the bill slot exists to place it in',
     G("BANNER_SLOTS.some(function(s){return s.id==='bill'})"));
  ok('with the reason it is constrained stated',
     G("BANNER_SLOTS.filter(function(s){return s.id==='bill'})[0].note").indexOf('not a billboard') > -1);
}

/* --------------------------------------------------- DUNNING LADDERS ---- */
head('DUNNING — a ladder per customer type, resolved from the account');
{
  const { w, G } = await load('operator.html');
  w.App = G('App'); w.App.go('collections'); await wait(280);
  const t = w.document.getElementById('main').textContent;

  ok('ladders are configurable from Collections', /Dunning ladders/.test(t));
  ok('there is more than one', G('DUNNING_LADDERS.length') >= 5);
  ok('every customer type has a base ladder',
     G("DUN_SEGMENTS.every(function(s){return DUNNING_LADDERS.some(function(l){"+
       "return l.segment===s.id && (l.minAmount||0)===0 && l.status==='active'})})"));
  ok('each carries a stated rationale', G("DUNNING_LADDERS.every(function(l){return !!l.why})"));

  /* resolution, not selection */
  ok('a consumer resolves to the consumer ladder',
     G("ladderFor({ctx:'consumer',amount:41.98}).segment") === 'consumer');
  ok('an enterprise resolves to the enterprise ladder',
     G("ladderFor({ctx:'buyer',amount:14520}).segment") === 'enterprise');
  ok('a seller resolves to its own', G("ladderFor({ctx:'partner',amount:900}).segment") === 'partner');
  ok('the most specific band wins for a high-value consumer',
     G("ladderFor({ctx:'consumer',amount:900}).id") === 'DL-HIGH');
  ok('and an ordinary balance is unaffected by it',
     G("ladderFor({ctx:'consumer',amount:40}).id") === 'DL-CON');

  /* the pacing differs where it should */
  ok('an enterprise is suspended far later than a consumer',
     G("ladderSuspendDay(DLMAP['DL-ENT'])") > G("ladderSuspendDay(DLMAP['DL-CON'])"));
  ok('a seller is never suspended — settlement is withheld instead',
     G("ladderSuspendDay(DLMAP['DL-PTR'])") === null);
  ok('every active ladder reaches an end',
     G("DUNNING_LADDERS.filter(function(l){return l.status==='active'}).every(ladderTerminal)"));
  ok('a case names the ladder it is running on', /Consumer standard|Enterprise contracted/.test(t));
}
head('DUNNING — the editor refuses the mistakes that cost money or customers');
{
  const { w, G } = await load('operator.html');
  w.App = G('App'); w.App.go('collections'); await wait(260);

  w.eval("ladderDialog('DL-CON')"); await wait(250);
  ok('the editor opens with the steps loaded', G('window.__LAD.length') === 7);
  w.eval("closeModal()"); await wait(80);

  /* The warning only makes sense on a ladder something is actually running on.
     Since sellers now govern their own direct receivables, the marketplace
     consumer ladder can legitimately be empty — so pick one that is not. */
  const busy = G("DUNNING_LADDERS.filter(function(l){return ladderCases(l.id).length>0})[0].id");
  w.eval("ladderDialog('" + busy + "')"); await wait(250);
  ok('a ladder with live cases warns they follow it from their next step',
     /from their next step/.test(w.document.getElementById('modalHost').textContent));
  w.eval("closeModal()"); await wait(80);
  w.eval("ladderDialog('DL-CON')"); await wait(250);

  w.eval("ldSet(5,'at',3)"); await wait(150);
  ok('suspending a consumer on day 3 is challenged',
     /Involuntary churn/.test(w.document.getElementById('ldWarn').textContent));
  w.eval("ldSet(5,'at',14)"); await wait(130);

  w.eval("window.__LAD=window.__LAD.filter(function(s){return s.action!=='terminate'}); ldRenderSteps()");
  await wait(150);
  ok('a ladder with no terminal step is challenged',
     /never ends/.test(w.document.getElementById('ldWarn').textContent));
  w.eval("saveLadder('DL-CON')"); await wait(170);
  ok('and cannot be saved', G("DLMAP['DL-CON'].steps.length") === 7);

  w.eval("window.__LAD=window.__LAD.filter(function(s){return ['notify','remind','final'].indexOf(s.action)<0});"+
         "ldRenderSteps()"); await wait(150);
  ok('a ladder that never tells the customer is challenged',
     /Nothing tells the customer/.test(w.document.getElementById('ldWarn').textContent));
  w.eval('closeModal()'); await wait(120);

  const n0 = G('DUNNING_LADDERS.length');
  w.eval("duplicateLadder('DL-ENT')"); await wait(230);
  ok('a ladder can be duplicated', G('DUNNING_LADDERS.length') === n0 + 1);
  const nid = G('DUNNING_LADDERS[DUNNING_LADDERS.length-1].id');
  w.eval("retireLadder('" + nid + "')"); await wait(210); confirmDialog(w); await wait(240);
  ok('an unused ladder can be retired', G("DLMAP['" + nid + "'].status") === 'retired');
  ok('and the change is audited',
     G("AUDIT_LOG.operator.some(function(e){return e.action==='dunning.ladder'})"));

  w.eval("retireLadder('DL-CON')"); await wait(190);
  ok('a ladder with live cases on it cannot be retired', G("DLMAP['DL-CON'].status") === 'active');

  w.eval('ladderDialog(null)'); await wait(240);
  w.eval("document.getElementById('ldName').value='Public sector'");
  w.eval("document.getElementById('ldSeg').value='enterprise'");
  w.eval('saveLadder(null)'); await wait(180);
  ok('a ladder with no stated rationale is refused', G('DUNNING_LADDERS.length') === n0 + 1);
  w.eval("document.getElementById('ldWhy').value='Public bodies pay on a statutory cycle; chasing earlier achieves nothing.'");
  w.eval("window.__LAD=[{at:90,action:'legal',channel:'Letter'},{at:0,action:'notify',channel:'Email'},"+
         "{at:30,action:'remind',channel:'Email'}]");
  w.eval('saveLadder(null)'); await wait(270);
  ok('a complete one is created', G('DUNNING_LADDERS.length') === n0 + 2);
  ok('and its steps are stored in day order regardless of entry order',
     G('DUNNING_LADDERS[DUNNING_LADDERS.length-1].steps[0].at') === 0 &&
     G('DUNNING_LADDERS[DUNNING_LADDERS.length-1].steps[2].at') === 90);
}

/* ------------------------------------------------------ GENERAL LEDGER -- */
head('LEDGER — most of the money passing through is not revenue');
{
  const { w, G } = await load('operator.html');
  w.App = G('App'); w.App.go('ledger'); await wait(290);
  const t = w.document.getElementById('main').textContent;

  ok('the ledger exists', /General ledger/.test(t));
  ok('with a chart of accounts', G('GL_ACCOUNTS.length') >= 15);
  ok('every charge type is mapped', G("GL_CHARGES.filter(function(c){return !GL_MAPPING[c.id]}).length") === 0);
  ok('and every mapping records why it posts that way',
     G("Object.keys(GL_MAPPING).every(function(k){return !!GL_MAPPING[k].why})"));
  ok('postings are generated from the order register', G('GL_POSTINGS.length') > 100);

  /* the accounting judgement that matters in a marketplace */
  ok('gross collected credits a liability, not revenue', G("GL_MAPPING['order.gross'].cr") === '2010');
  ok('and the screen says why that matters', /overstate income/.test(t));
  ok('commission is the line that credits revenue',
     G("glAcct(GL_MAPPING['order.commission'].cr).type") === 'Revenue');
  ok('tax collected credits a tax account, never revenue',
     G("glAcct(GL_MAPPING['order.tax'].cr).type") === 'Tax');
  ok('a refund is a contra rather than a netting',
     G("glAcct(GL_MAPPING['order.refund'].dr).type") === 'Contra');
  ok('what was earned is separated from what passed through',
     /Passed through/.test(t) && /Actually earned/.test(t));
  ok('and earned is materially smaller',
     G('glEarned("2026-07").revenue') < G('glEarned("2026-07").gross') * 0.4);

  /* the check that catches a broken mapping */
  ok('the trial balance balances', G('glTrialBalance("2026-07").balanced') === true);
  ok('debits equal credits to the cent',
     Math.abs(G('glTrialBalance("2026-07").dr') - G('glTrialBalance("2026-07").cr')) < 0.01);
}
head('LEDGER — the mapping is defensible, and a closed period stays closed');
{
  const { w, G } = await load('operator.html');
  w.App = G('App'); w.App.go('ledger'); await wait(270);

  w.eval("glMappingDialog('order.commission')"); await wait(240);
  ok('a mapping opens for configuration', !!w.document.getElementById('glDr'));
  ok('it carries the rationale', /Commission moves out/.test(w.document.getElementById('modalHost').textContent));
  ok('and states that existing postings are not rewritten',
     /not rewritten/.test(w.document.getElementById('modalHost').textContent));

  w.eval("document.getElementById('glCr').value='2010'");
  w.eval("saveGlMapping('order.commission')"); await wait(180);
  ok('the same account on both sides is refused', G("GL_MAPPING['order.commission'].cr") === '4010');

  w.eval("document.getElementById('glCr').value='4020'");
  w.eval("document.getElementById('glWhy').value=''");
  w.eval("saveGlMapping('order.commission')"); await wait(180);
  ok('a mapping with no stated reason is refused', G("GL_MAPPING['order.commission'].cr") === '4010');

  w.eval("document.getElementById('glWhy').value='Reclassified to platform fees under the new commercial model.'");
  w.eval("saveGlMapping('order.commission')"); await wait(250);
  ok('a defended change is accepted', G("GL_MAPPING['order.commission'].cr") === '4020');
  ok('and audited with before and after',
     G("AUDIT_LOG.operator.some(function(e){return e.action==='gl.mapping' && e.before && e.after})"));

  w.App.go('ledger'); await wait(240);
  w.eval('glCloseDialog()'); await wait(230);
  ok('closing states whether the columns agree',
     /Debits and credits agree|out of balance/i.test(w.document.getElementById('modalHost').textContent));
  confirmDialog(w); await wait(260);
  ok('the period closes', G("GL_PERIODS.filter(function(p){return p.id==='2026-07'})[0].status") === 'closed');
  ok('recording who closed it and when',
     !!G("GL_PERIODS.filter(function(p){return p.id==='2026-07'})[0].closedBy") &&
     !!G("GL_PERIODS.filter(function(p){return p.id==='2026-07'})[0].closedOn"));
  ok('and the screen states that a correction is a journal, not an edit',
     /never an edit to a closed one/.test(w.document.getElementById('main').textContent));
}

head('CHART OF ACCOUNTS — a code can be added, and the traps are enforced');
{
  const { w, G } = await load('operator.html');
  w.App = G('App'); w.App.go('ledger'); await wait(280);
  ok('the chart can be extended', /Add an account/.test(w.document.getElementById('main').textContent));
  ok('and it says an unmapped account never receives a posting',
     /sit at zero forever|no charge mapped/.test(w.document.getElementById('main').textContent));

  const n0 = G('GL_ACCOUNTS.length');
  w.eval("glAccountDialog(null)"); await wait(150);

  /* The leading digit is a convention every report groups on. */
  w.eval("document.getElementById('glCode').value='4444'");
  w.eval("document.getElementById('glType').value='Expense'");
  w.eval("document.getElementById('glName').value='Misfiled'");
  w.eval("document.getElementById('glNote').value='Something'");
  w.eval("saveGlAccount(null)"); await wait(120);
  ok('a code outside its type range is refused', G('GL_ACCOUNTS.length') === n0);
  ok('and it says which range the type belongs in',
     /conventionally starts with/.test(w.document.getElementById('glWarn').textContent));

  w.eval("document.getElementById('glCode').value='4010'");
  w.eval("document.getElementById('glType').value='Revenue'");
  w.eval("saveGlAccount(null)"); await wait(120);
  ok('a duplicate code is refused', G('GL_ACCOUNTS.length') === n0);
  ok('naming what already holds it',
     /already Commission revenue/.test(w.document.getElementById('glWarn').textContent));

  w.eval("document.getElementById('glCode').value='5040'");
  w.eval("document.getElementById('glType').value='Expense'");
  w.eval("document.getElementById('glNote').value=''");
  w.eval("saveGlAccount(null)"); await wait(120);
  ok('an account with no description is refused', G('GL_ACCOUNTS.length') === n0);

  w.eval("document.getElementById('glNote').value='Issuer fees on reversed payments.'");
  w.eval("document.getElementById('glName').value='Chargeback fees'");
  w.eval("saveGlAccount(null)"); await wait(250);
  ok('a well-formed account is added', G('GL_ACCOUNTS.length') === n0 + 1);
  ok('and is immediately selectable for a mapping', G("!!GLMAP['5040']"));
  ok('it is flagged as holding nothing yet', G("glAccountUse('5040').charges") === 0);

  /* Removal is only safe while nothing points at it. */
  w.eval("removeGlAccount('5040')"); await wait(150);
  confirmDialog(w); await wait(220);
  ok('an unused account can be removed', G('GL_ACCOUNTS.length') === n0);
  const before = G('GL_ACCOUNTS.length');
  w.eval("removeGlAccount('4010')"); await wait(150);
  ok('an account carrying postings cannot be', G('GL_ACCOUNTS.length') === before);
  ok('and the shipped chart is marked built in', G("GLMAP['4010'].system") === true);
}

console.log('\n' + (failures ? '\u2717 ' + failures + ' of ' + checks + ' checks failed'
                             : '\u2713 all ' + checks + ' document and billing checks passed'));
process.exit(failures ? 1 : 0);

})();
