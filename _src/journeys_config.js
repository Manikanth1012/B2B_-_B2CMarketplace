/* ===========================================================================
   Configuration-surface journey tests (roles, passwords, listings, settlement
   documents and billing). Split from journeys.js to stay inside the shell's
   time budget.
   These do not check that a screen rendered — they drive each journey to its
   conclusion and assert that the underlying records actually changed.
   Run: node _src/journeys_config.js
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

/* ------------------------------------------------- ROLES AND PERMISSIONS */
head('ADMIN — roles configuration is a real editor, not a read-only grid');
{
  const { w, G } = await load('operator.html');
  w.App = G('App'); w.App.go('roles'); await wait(105);

  ok('roles page renders its own screen', /Roles configuration/.test(w.document.getElementById('main').textContent));
  const before = G('orgRoles("operator").length');
  const cellsBefore = G('PERM_GRID.operator[0].slice(1).join(",")');

  /* cycle one permission cell: none -> scoped -> full -> none */
  w.eval("cyclePerm('operator',0,0)"); await wait(60);
  ok('a permission cell actually changes the grid',
     G('PERM_GRID.operator[0].slice(1).join(",")') !== cellsBefore);

  /* create a role */
  w.eval("createRoleDialog('operator')"); await wait(105);
  const m = w.document.getElementById('modalHost');
  ok('the create-role dialog opens', !!m);
  m.querySelector('#nrName').value = 'Settlement reviewer';
  m.querySelector('#nrScope').value = 'Settlement only';
  w.eval("submitRole('operator')"); await wait(105);
  ok('a new role is created', G('orgRoles("operator").length') === before + 1);
  ok('every capability row gains a column for it',
     G('PERM_GRID.operator.every(r=>r.length===orgRoles("operator").length+1)'));
  const nr = G('orgRoles("operator")[orgRoles("operator").length-1]');
  ok('the new role is custom, not built-in', nr.system !== true);
  ok('it starts with nobody in it', G('roleUsers("operator","'+nr.id+'").length') === 0);

  /* a built-in role in use cannot simply be deleted */
  const sys = G('orgRoles("operator").filter(r=>r.system)[0]');
  w.eval("deleteRoleDialog('operator','"+sys.id+"')"); await wait(105);
  const dm = w.document.getElementById('modalHost');
  const blocked = !dm || !dm.querySelector('#cfmGo') || dm.querySelector('#cfmGo').disabled ||
                  /cannot|assigned|in use/i.test(dm.textContent);
  ok('a role that is assigned or built-in cannot be deleted outright', blocked);
}

/* ------------------------------------------------ PASSWORDS AND SECURITY */
head('ADMIN — password, MFA and session control');
{
  const { w, G } = await load('partner.html');
  w.App = G('App'); w.App.go('team'); await wait(120);

  ok('the users screen carries a security panel',
     /sign-in and security/i.test(w.document.getElementById('main').textContent));

  const me = G('orgUsers("partner").filter(u=>u.you)[0]');
  const wasChanged = me.pwdChanged;

  w.eval("changePasswordDialog('partner','"+me.id+"')"); await wait(105);
  const m = w.document.getElementById('modalHost');
  ok('the change-password dialog opens', !!m);

  /* a weak password must be refused */
  m.querySelector('#cpOld').value = 'whatever';
  m.querySelector('#cpNew').value = 'short';
  m.querySelector('#cpAgain').value = 'short';
  w.eval("submitPassword('partner','"+me.id+"')"); await wait(80);
  ok('a password below policy is refused',
     !!w.document.getElementById('modalHost') &&
     !w.document.getElementById('cpNewErr').hidden);

  /* a mismatch must be refused too */
  w.document.getElementById('cpNew').value = 'Corr3ct-Horse!Battery';
  w.document.getElementById('cpAgain').value = 'Corr3ct-Horse!Batter';
  w.eval("submitPassword('partner','"+me.id+"')"); await wait(80);
  ok('a mismatched confirmation is refused',
     !!w.document.getElementById('modalHost') &&
     !w.document.getElementById('cpAgainErr').hidden);

  /* now a valid one */
  w.document.getElementById('cpAgain').value = 'Corr3ct-Horse!Battery';
  w.eval("submitPassword('partner','"+me.id+"')"); await wait(120);
  const after = G('orgUsers("partner").filter(u=>u.you)[0]');
  ok('the dialog closes on a valid password', !w.document.getElementById('modalHost'));
  ok('the password date moves to today', after.pwdChanged !== wasChanged && /2026/.test(after.pwdChanged));
  ok('strength is recorded as strong', after.pwdStrength === 'strong');
  ok('other sessions are signed out', after.sessions === 1);

  /* forcing a reset on someone else */
  const other = G('orgUsers("partner").filter(u=>!u.you && u.status==="active")[0]');
  w.eval("forceResetUser('partner','"+other.id+"')"); await wait(105);
  ok('forcing a reset asks for confirmation first', !!w.document.getElementById('modalHost'));
  confirmDialog(w, 'RESET'); await wait(105);
  ok('the user is flagged as needing a reset',
     G('orgUsers("partner").find(u=>u.id==="'+other.id+'").mustReset') === true);
  ok('their sessions are cleared', G('orgUsers("partner").find(u=>u.id==="'+other.id+'").sessions') === 0);

  /* turning MFA off is treated as a downgrade */
  const mfaUser = G('orgUsers("partner").filter(u=>u.mfa)[0]');
  if (mfaUser){
    w.eval("toggleMfa('partner','"+mfaUser.id+"',false)"); await wait(105);
    ok('turning MFA off requires confirmation', !!w.document.getElementById('modalHost'));
    confirmDialog(w, 'OFF'); await wait(105);
    ok('MFA is actually turned off once confirmed',
       G('orgUsers("partner").find(u=>u.id==="'+mfaUser.id+'").mfa') === false);
  }
}

/* --------------------------------------- SELLER VS BUYER PRODUCT ACTIONS */
head('LISTINGS — the seller and the operator get seller actions, not a basket');
{
  const { w, G } = await load('partner.html');
  w.App = G('App'); w.App.go('listings'); await wait(120);
  const sku = G('MY_LIST[0].id');
  w.eval("openProduct('"+sku+"',{showComm:true,mode:'seller'})"); await wait(105);
  const foot = w.document.querySelector('#inspector .insp-foot');
  ok('the seller sees a listing inspector', !!foot);
  ok('there is no Add to basket on a seller\'s own listing', !/basket/i.test(foot.textContent));
  ok('the seller can edit the listing', /Edit listing/i.test(foot.textContent));
  ok('the seller can see the orders on it', /Orders on this listing/i.test(foot.textContent));

  /* pausing a live listing stops new orders */
  const live = G('MY_LIST.filter(l=>l.status==="live")[0]');
  if (live){
    w.eval("pauseListingDialog('"+live.id+"')"); await wait(105);
    ok('pausing asks first', !!w.document.getElementById('modalHost'));
    confirmDialog(w); await wait(120);
    ok('the listing is actually paused', G('SKUMAP["'+live.id+'"].status') === 'paused');
    w.eval("resumeListing('"+live.id+"')"); await wait(105);
    ok('and can be resumed', G('SKUMAP["'+live.id+'"].status') === 'live');
  }

  /* editing a price changes the record and the money split */
  const target = G('MY_LIST[0].id');
  const oldPrice = G('SKUMAP["'+target+'"].price');
  w.eval("editListingDialog('"+target+"')"); await wait(105);
  const em = w.document.getElementById('modalHost');
  ok('the edit dialog opens', !!em);
  em.querySelector('#elPrice').value = '0';
  w.eval("saveListingEdit('"+target+"')"); await wait(80);
  ok('a zero price is refused', !!w.document.getElementById('modalHost'));
  w.document.getElementById('elPrice').value = String(Math.round(oldPrice) + 7);
  w.eval("saveListingEdit('"+target+"')"); await wait(120);
  ok('a valid price is saved to the record',
     G('SKUMAP["'+target+'"].price') === Math.round(oldPrice) + 7,
     'got ' + G('SKUMAP["'+target+'"].price'));
}
{
  const { w, G } = await load('operator.html');
  w.App = G('App'); w.App.go('catalogue'); await wait(120);
  const sku = G('LIVE_PRODUCTS.filter(p=>p.partner)[0].id');
  w.eval("openProduct('"+sku+"',{showComm:true,mode:'operator'})"); await wait(105);
  const foot = w.document.querySelector('#inspector .insp-foot');
  ok('the operator gets governance actions, not a basket', !!foot && !/basket/i.test(foot.textContent));
  ok('the operator can open the seller behind the listing', /Open the seller/i.test(foot.textContent));

  w.eval("suspendListingDialog('"+sku+"')"); await wait(105);
  ok('suspension is typed-confirmation gated', !!w.document.getElementById('modalHost'));
  confirmDialog(w, 'SUSPEND'); await wait(120);
  ok('the listing is suspended on the record', G('SKUMAP["'+sku+'"].status') === 'suspended');
  ok('a suspended listing drops out of the live set',
     G('LIVE_PRODUCTS.filter(p=>p.id==="'+sku+'").length') === 0);
  w.eval("reinstateListing('"+sku+"')"); await wait(105);
  ok('and can be reinstated', G('SKUMAP["'+sku+'"].status') === 'live');
}

/* ------------------------------------ SETTLEMENT DOCUMENT BEFORE APPROVAL */
head('SETTLEMENT — the invoice can be read before the money moves');
{
  const { w, G } = await load('operator.html');
  w.App = G('App'); w.App.go('settlements'); await wait(120);

  const st = G('SETTLEMENTS.filter(s=>s.status==="pending")[0]');
  ok('there is a pending statement to review', !!st);

  w.eval("openStatement('"+st.id+"')"); await wait(120);
  const insp = w.document.getElementById('inspector');
  ok('the statement opens as a document', !!insp && /Self-billing invoice/i.test(insp.textContent));
  ok('it carries a document reference', /SB-2026-/.test(insp.textContent));
  ok('it lists what sold', /What sold/i.test(insp.textContent));
  ok('it itemises the deductions', /Marketplace commission/i.test(insp.textContent) &&
                                   /Withholding tax/i.test(insp.textContent));
  ok('it shows the tax treatment', /Tax/.test(insp.textContent));

  /* the lines must reconcile to the statement gross — this is the whole point */
  const lineTotal = G('stmLines(SETTLEMENTS.find(s=>s.id==="'+st.id+'")).reduce((a,l)=>a+l.gross,0)');
  ok('the order lines reconcile to the statement gross',
     Math.abs(lineTotal - st.gross) < 0.02, lineTotal + ' vs ' + st.gross);

  /* held statements must not be approvable from the document */
  const heldOne = G('SETTLEMENTS.filter(s=>s.status==="pending" && stmHeld(s).length)[0]');
  if (heldOne){
    w.eval("openStatement('"+heldOne.id+"')"); await wait(105);
    const b = Array.from(w.document.querySelectorAll('#inspector .insp-foot button'))
      .filter(x => /Approve/i.test(x.textContent))[0];
    ok('a statement with an open dispute cannot be approved from the document', !b || b.disabled);
  }

  /* approving from the document changes the record */
  const clean = G('SETTLEMENTS.filter(s=>s.status==="pending" && !stmHeld(s).length)[0]');
  if (clean){
    w.eval("openStatement('"+clean.id+"')"); await wait(105);
    const btn = Array.from(w.document.querySelectorAll('#inspector .insp-foot button'))
      .filter(x => /Approve/i.test(x.textContent))[0];
    ok('a clean statement offers approval from inside the document', !!btn && !btn.disabled);
    if (btn){ btn.click(); await wait(120); }
    ok('approving it changes the statement state',
       G('SETTLEMENTS.find(s=>s.id==="'+clean.id+'").status') === 'approved');
    ok('the inspector closes on approval', w.document.getElementById('inspector').hidden === true);
  }
}

/* --------------------------------------------- BILLING CONFIGURATION */
head('BILLING — formatting and per-partner cycles');
{
  const { w, G } = await load('operator.html');
  w.App = G('App'); w.App.go('billing'); await wait(140);
  const main = w.document.getElementById('main');
  ok('bill formatting is on screen', /Bill formatting/i.test(main.textContent));
  ok('a live document preview is rendered', !!w.document.querySelector('#billPreview .doc-preview'));
  ok('per-partner cycles are on screen', /Bill cycle by partner/i.test(main.textContent));

  /* changing the numbering pattern must change the preview */
  const before = w.document.querySelector('#billPreview').textContent;
  w.document.getElementById('bf_numbering').value = 'XX-{YYYY}-{SEQ}';
  w.eval("saveBillFormat('operator')"); await wait(105);
  ok('the numbering pattern flows through to the document',
     w.document.querySelector('#billPreview').textContent !== before &&
     /XX-2026-/.test(w.document.querySelector('#billPreview').textContent));
  ok('and through to a real statement',
     /^XX-2026-/.test(G('stmDocNo(SETTLEMENTS[0])')), G('stmDocNo(SETTLEMENTS[0])'));

  /* Choosing a template is now an assignment, not a field on a separate
     settings object — formatting and sections live on the same record. */
  ok('the panel edits the template that audience actually uses',
     /These settings belong to the template/.test(w.document.getElementById('main').textContent));
  w.eval("assignBillTemplate('partner','BT-MIN')"); w.App.go('billing'); await wait(140);
  ok('assigning the compact template drops the itemised sections',
     G("billHas(BTMAP['BT-MIN'],'subs')") === false &&
     G("BILL_TEMPLATE_ASSIGN.partner") === 'BT-MIN');
  ok('but keeps the sections that make it a bill',
     G("['masthead','parties','tax','summary'].every(function(x){return billHas(BTMAP['BT-MIN'],x)})"));
  w.eval("assignBillTemplate('partner','BT-PTR')"); w.App.go('billing'); await wait(130);

  /* an override needs a stated reason */
  const plain = G('Object.keys(PARTNER_BILLING).filter(k=>!PARTNER_BILLING[k].override)[0]');
  w.eval("editPartnerBilling('"+plain+"')"); await wait(105);
  const m = w.document.getElementById('modalHost');
  ok('the per-partner cycle dialog opens', !!m);
  const planCycle = G('PARTNER_BILLING["'+plain+'"].cycle');
  m.querySelector('#pbCycle').value = planCycle === 'Weekly' ? 'Quarterly' : 'Weekly';
  m.querySelector('#pbNote').value = '';
  w.eval("savePartnerBilling('"+plain+"','"+planCycle+"','"+G('PARTNER_BILLING["'+plain+'"].terms')+"')");
  await wait(80);
  ok('an override without a reason is refused',
     !!w.document.getElementById('modalHost') &&
     !w.document.getElementById('pbNoteErr').hidden);
  ok('and nothing was written to the record',
     G('PARTNER_BILLING["'+plain+'"].cycle') === planCycle);

  w.document.getElementById('pbNote').value = 'Trial of a shorter cycle for a high-volume seller.';
  w.eval("savePartnerBilling('"+plain+"','"+planCycle+"','"+G('PARTNER_BILLING["'+plain+'"].terms')+"')");
  await wait(140);
  ok('with a reason it saves', !w.document.getElementById('modalHost'));
  ok('the cycle actually changes on the partner record',
     G('PARTNER_BILLING["'+plain+'"].cycle') !== planCycle);
  ok('and it is flagged as an override', G('PARTNER_BILLING["'+plain+'"].override') === true);
  ok('with the reason kept against it',
     /high-volume/.test(G('PARTNER_BILLING["'+plain+'"].note') || ''));

  /* resetting puts it back on the plan */
  w.eval("editPartnerBilling('"+plain+"')"); await wait(105);
  w.eval("resetPartnerBilling('"+plain+"')"); await wait(120);
  ok('resetting clears the override', G('PARTNER_BILLING["'+plain+'"].override') === false);
  ok('and drops the now-meaningless reason', G('PARTNER_BILLING["'+plain+'"].note') === null);
}
{
  const { w, G } = await load('enterprise.html');
  w.App = G('App'); w.App.go('billing'); await wait(140);
  const bt = w.document.getElementById('main').textContent;
  /* A buyer receives the marketplace's invoice; they do not restyle it. What
     they legitimately control is how their own AP department needs it. */
  ok('the buyer cannot restyle the document they receive', !/Bill formatting/i.test(bt));
  ok('but they do control their own invoice handling', /Purchase order/i.test(bt));
  ok('including whether it breaks down by cost centre', /cost centre/i.test(bt));
  ok('and their own tax position', /Place of supply/i.test(bt));
  w.eval("setBuyerTax('poRequired',false)"); await wait(120);
  ok('turning off the PO requirement is recorded', G('BUYER_TAX.poRequired') === false);
  ok('and the document follows the buyer, not a second copy on the template',
     !/\bPO\b/.test(billPreviewText(w)));
  w.eval("setBuyerTax('poRequired',true)"); await wait(80);
  ok('turning it back on restores it', /\bPO\b/.test(billPreviewText(w)));
}
{
  const { w, G } = await load('partner.html');
  w.App = G('App'); w.App.go('plan'); await wait(140);
  const t = w.document.getElementById('main').textContent;
  ok('the seller can see the cycle they are actually on', /Your bill cycle/i.test(t));
  ok('and whether it differs from the plan',
     /Plan default/i.test(t) || /Negotiated/i.test(t));
}

/* ------------------------------------------------- NAVIGATION COMPLETENESS */
head('NAVIGATION — every persona can reach the configuration surfaces');
{
  for (const [file, expect] of [
    ['operator.html',   ['users','roles','notifications','billing']],
    ['partner.html',    ['team','roles','notifications']],
    ['enterprise.html', ['users','roles','notifications','billing']],
    ['consumer.html',   ['access','roles','notifications','account']]
  ]){
    const { w, G } = await load(file);
    const ids = Array.from(w.document.querySelectorAll('.nav-item')).map(b => b.id.replace('nav_',''));
    const missing = expect.filter(e => ids.indexOf(e) === -1);
    ok(file + ' — reaches ' + expect.join(', '), missing.length === 0, 'missing ' + missing.join(', '));
  }
}



/* ---------------------------------------------------- EXPORT IS A REAL FILE */
head('EXPORT — a file, not a toast');
{
  const { w, G } = await load('operator.html');
  w.App = G('App'); w.App.go('partners'); await wait(140);

  /* capture what the browser is asked to download */
  w.eval("window.__dl=[]; URL.createObjectURL=function(b){ window.__dl.push(b); return 'blob:test'; };" +
         "URL.revokeObjectURL=function(){};");

  w.eval("exportDialog('Partner directory','dtPartners')"); await wait(120);
  const m = w.document.getElementById('modalHost');
  ok('the export dialog opens rather than firing a toast', !!m);
  ok('it names the columns that will be written', /Marketplaces/.test(m.textContent));
  ok('it offers a scope choice', !!m.querySelector('#exScope'));
  ok('it offers a format choice', !!m.querySelector('#exFmt'));

  const csv = G("buildCsv(exportSource('dtPartners'),'all')");
  const lines = csv.trim().split('\n');
  ok('the CSV has a header row and one row per record',
     lines.length === G('PARTNERS.length') + 1, lines.length + ' lines');
  ok('action columns are not exported', !/^.*,,/.test(lines[0]) && !/Open/.test(lines[0]));
  ok('a multi-value column is written as readable names, not ids',
     /Device Marketplace/.test(csv), lines[2]);
  ok('a value containing a comma is quoted', G('csvCell("Acme, Inc")') === '"Acme, Inc"',
     G('csvCell("Acme, Inc")'));
  ok('an embedded quote is escaped, not dropped',
     G('csvCell(String.fromCharCode(34)+"no"+String.fromCharCode(34)).split(String.fromCharCode(34)).length') === 7);
  ok('a newline inside a value cannot break the row',
     G('csvCell("line one\\nline two")').indexOf('\n') === -1);

  /* a filtered view exports only what is on screen */
  G("DataTable.reg['dtPartners'].setQ('India')"); await wait(110);
  const v = G("exportSource('dtPartners').view.length"), a = G("exportSource('dtPartners').all.length");
  ok('a filtered table exports fewer rows than it holds', v < a, v + ' of ' + a);
  const viewCsv = G("buildCsv(exportSource('dtPartners'),'view')");
  ok('the filtered export matches the filtered view',
     viewCsv.trim().split('\n').length === v + 1);

  /* the download actually happens */
  const before = G('EXPORTS.length');
  w.eval("exportDialog('Partner directory','dtPartners')"); await wait(120);
  w.document.getElementById('exScope').value = 'all';
  w.eval("runExport('Partner directory','dtPartners')"); await wait(140);
  ok('a blob is handed to the browser to save', G('window.__dl.length') > 0);
  ok('the export is recorded', G('EXPORTS.length') === before + 1);
  ok('the file is named after the data and the date',
     /^partner-directory-\d{2}-jul-2026\.csv$/.test(G('EXPORTS[EXPORTS.length-1].name')),
     G('EXPORTS[EXPORTS.length-1].name'));

  /* JSON is a real alternative, not a label */
  const json = G("buildJson(exportSource('dtPartners'),'all')");
  let parsed = null;
  try { parsed = JSON.parse(json); } catch(e){}
  ok('the JSON export parses', !!parsed && parsed.length === G('PARTNERS.length'));

  /* a screen with no table still exports its figures */
  w.App.go('home'); await wait(140);
  const set = G("exportSource('opsOverview')");
  ok('a summary screen exports the figures behind it', !!set && set.all.length === G('VERTICALS.length'));
  ok('it does not report a 0% take rate on first-party revenue',
     G("exportSource('opsOverview').all.every(r=>r.takeRate!==0)"));
}

/* ------------------------------------------------------------ PROFILE MENU */
head('PROFILE — the avatar opens an account menu that works');
{
  for (const [file, ctx, target] of [
    ['operator.html','operator','profile'],
    ['partner.html','partner','profile'],
    ['enterprise.html','buyer','profile'],
    ['consumer.html','consumer','account']
  ]){
    const { w, G } = await load(file);
    w.App = G('App');
    const btn = w.document.getElementById('personaBtn');
    ok(file + ' — the avatar is a button', !!btn);
    btn.click(); await wait(110);
    const menu = w.document.getElementById('profileMenu');
    ok(file + ' — it opens a menu', !!menu && !menu.hidden);
    ok(file + ' — the menu names the signed-in person',
       menu.textContent.indexOf(G('App.cfg.persona.name')) > -1);
    menu.querySelectorAll('.pm-item')[0].click(); await wait(140);
    ok(file + ' — My details goes to a real screen', w.App.view === target, 'went to ' + w.App.view);
    ok(file + ' — the menu closes behind it', w.document.getElementById('profileMenu').hidden);
  }
}
head('PROFILE — editing your own details changes the record');
{
  const { w, G } = await load('partner.html');
  w.App = G('App'); w.App.go('profile'); await wait(150);

  w.document.getElementById('mpName').value = '';
  w.eval("saveMyProfile('partner')"); await wait(80);
  ok('an empty name is refused', !w.document.getElementById('mpNameErr').hidden);

  w.document.getElementById('mpName').value = 'Farah A Hashimi';
  w.document.getElementById('mpMail').value = 'not-an-email';
  w.eval("saveMyProfile('partner')"); await wait(80);
  ok('a malformed email is refused', !w.document.getElementById('mpMailErr').hidden);

  w.document.getElementById('mpMail').value = 'farah@sentinelcyber.example';
  w.document.getElementById('mpTz').value = 'Asia/Dubai (GST)';
  w.eval("saveMyProfile('partner')"); await wait(150);
  ok('the name is written to the user record',
     G("orgUsers('partner').filter(u=>u.you)[0].name") === 'Farah A Hashimi');
  ok('the email is written too',
     G("orgUsers('partner').filter(u=>u.you)[0].email") === 'farah@sentinelcyber.example');
  ok('the top bar updates rather than keeping the old name',
     w.document.querySelector('.persona-name').textContent === 'Farah A Hashimi');
  ok('the time zone preference sticks', G("myProfile('partner').timezone") === 'Asia/Dubai (GST)');

  /* cover while away */
  w.eval("setOutOfOffice('partner',true)"); await wait(140);
  ok('marking yourself away is recorded', G("myProfile('partner').outOfOffice") === true);
  ok('the screen says nobody is covering yet',
     /No delegate is set/.test(w.document.getElementById('main').textContent));
  const peer = G("orgUsers('partner').filter(u=>!u.you && u.status==='active')[0].id");
  w.eval("setDelegate('partner','" + peer + "')"); await wait(140);
  ok('a delegate is recorded', G("myProfile('partner').delegate") === peer);
  w.eval("setOutOfOffice('partner',false)"); await wait(120);
  ok('coming back clears the delegate', G("myProfile('partner').delegate") === null);
}

/* -------------------------------------------------- MARKETPLACES AND POLICY */console.log('\n' + (failures ? '\u2717 ' + failures + ' of ' + checks + ' checks failed'
                             : '\u2713 all ' + checks + ' configuration checks passed'));
process.exit(failures ? 1 : 0);

})();
