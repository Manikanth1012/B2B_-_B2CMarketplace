/* ===========================================================================
   Audit trail tests: append-only behaviour, per-role read scoping, redaction of
   personal data, refusal for roles with no audit access, and live actions
   writing entries. Fifth file, to stay inside the shell's 45-second budget.
   These do not check that a screen rendered — they drive each journey to its
   conclusion and assert that the underlying records actually changed.
   Run: node _src/journeys_audit.js
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

/* --------------------------------------------------- AUDIT — EXISTENCE */
head('AUDIT — every persona has a trail, reachable from the rail');
{
  for (const [file, ctx, label] of [
    ['operator.html','operator','Audit log'],
    ['partner.html','partner','Audit log'],
    ['enterprise.html','buyer','Audit log'],
    ['consumer.html','consumer','Account activity']
  ]){
    const { w, G } = await load(file);
    w.App = G('App');
    const ids = Array.from(w.document.querySelectorAll('.nav-item')).map(b => b.id.replace('nav_',''));
    ok(file + ' — audit is in the rail', ids.indexOf('audit') > -1);
    w.App.go('audit'); await wait(180);
    const t = w.document.getElementById('main').textContent;
    ok(file + ' — the screen renders', t.indexOf(label) > -1);
    ok(file + ' — it is seeded with history', G("AUDIT_LOG['" + ctx + "'].length") > 0);
    ok(file + ' — it states the retention period', /retained|Retention/.test(t));
    ok(file + ' — it declares the log is append-only', /append-only/i.test(t));
  }
}

/* --------------------------------------------------- AUDIT — SCOPING */
head('AUDIT — what you can read depends on your role, not your seniority');
{
  const { w, G } = await load('operator.html');
  w.App = G('App'); w.App.go('audit'); await wait(190);

  const total = G("AUDIT_LOG.operator.length");
  const setRole = r => w.eval("orgUsers('operator').filter(u=>u.you)[0].role='" + r + "'");

  setRole('OR-ADMIN');
  const admin = G("auditRows('operator').length");
  ok('the marketplace admin sees the whole trail', admin === total, admin + ' of ' + total);
  ok('and every category', G("auditMyScope('operator').cats.length") === G('AUDIT_CATEGORIES.length'));

  setRole('OR-CAT');
  const cat = G("auditRows('operator').length");
  ok('a catalogue reviewer sees materially less', cat < admin, cat + ' of ' + total);
  ok('and cannot see settlement at all',
     G("auditRows('operator').every(function(e){return e.cat!=='Settlement'})"));
  ok('and cannot see access changes',
     G("auditRows('operator').every(function(e){return e.cat!=='Access'})"));

  setRole('OR-FIN');
  ok('a settlement approver sees settlement', 
     G("auditRows('operator').some(function(e){return e.cat==='Settlement'})"));
  ok('but not onboarding',
     G("auditRows('operator').every(function(e){return e.cat!=='Onboarding'})"));

  setRole('OR-SUP');
  ok('a support agent sees only orders and catalogue',
     G("auditRows('operator').every(function(e){return e.cat==='Orders'||e.cat==='Catalogue'})"));

  /* every role sees a different slice — otherwise the scoping is decorative */
  const counts = ['OR-ADMIN','OR-ONB','OR-CAT','OR-FIN','OR-SUP','OR-READ'].map(r => {
    setRole(r); return G("auditRows('operator').length");
  });
  ok('the six operator roles do not all see the same thing',
     new Set(counts).size >= 4, counts.join('/'));

  setRole('OR-ADMIN');
}
head('AUDIT — a role with no audit access is refused, not shown an empty table');
{
  const { w, G } = await load('operator.html');
  w.App = G('App');
  w.eval("orgUsers('operator').filter(u=>u.you)[0].role='XX-NOTHING'");
  w.App.go('audit'); await wait(180);
  const t = w.document.getElementById('main').textContent;
  ok('access is refused outright', /cannot read the audit log/i.test(t));
  ok('and it explains why rather than showing zero rows', /does not carry audit access|Ask an administrator/i.test(t));
  ok('no table is rendered at all', !w.document.querySelector('#main .tbl'));
  ok('the scope helper returns nothing', G("auditMyScope('operator')") === null);
  ok('and the row helper returns an empty set', G("auditRows('operator').length") === 0);
}

/* --------------------------------------------------- AUDIT — REDACTION */
head('AUDIT — personal data is redacted, not hidden');
{
  const { w, G } = await load('operator.html');
  w.App = G('App');
  w.eval("orgUsers('operator').filter(u=>u.you)[0].role='OR-CAT'");
  w.App.go('audit'); await wait(190);

  const piiVisible = G("auditVisible('operator').filter(function(e){return e.pii}).length");
  const redacted = G("auditRows('operator').filter(function(e){return e.redacted}).length");
  ok('a role without personal-data access still sees that the event happened', piiVisible > 0);
  /* Everything personal is redacted except your own actions — you already
     know what you did, and hiding it from you helps nobody. */
  const ownPii = G("(function(){var me=orgUsers('operator').filter(function(u){return u.you})[0]||{};"+
    "return auditVisible('operator').filter(function(e){return e.pii && e.actor===me.name}).length;})()");
  ok('but the actor and object are redacted', redacted === piiVisible - ownPii,
     redacted + ' redacted, ' + piiVisible + ' pii, ' + ownPii + ' my own');
  ok('and my own actions are never redacted from me', ownPii === 0 || redacted < piiVisible);
  ok('the redacted row keeps its timestamp and category',
     G("auditRows('operator').filter(function(e){return e.redacted}).every(function(e){return !!e.when && !!e.cat})"));
  ok('and says why it is withheld',
     /Details withheld/.test(G("auditRows('operator').filter(function(e){return e.redacted})[0].detail")));

  /* Category scope is applied before redaction, so an entry in a category the
     role cannot read is absent entirely rather than redacted. Prove that. */
  w.eval("logAudit('operator','password.changed',{actor:'Someone Else',role:'OR-ADMIN'," +
         "object:'Their account',detail:'Outside a catalogue reviewer scope'})");
  await wait(90);
  ok('an entry in an unreadable category is absent, not merely redacted',
     G("auditRows('operator').filter(function(e){return e.object==='Their account'}).length") === 0);

  /* Within a readable category, your own entry is never redacted from you. */
  w.eval("logAudit('operator','doc.viewed',{actor:orgUsers('operator').filter(u=>u.you)[0].name," +
         "role:'OR-CAT',object:'PTR-1012 · Certificate',detail:'Opened during my own review'})");
  await wait(90);
  const mine = G("auditRows('operator').filter(function(e){return String(e.object).indexOf('Certificate')>-1})[0]");
  ok('your own entry is never redacted from you, even where the category carries personal data',
     !!mine && !mine.redacted, mine ? String(mine.redacted) : 'entry not visible');

  /* but the same kind of entry about somebody else is */
  w.eval("logAudit('operator','doc.viewed',{actor:'Lena Fischer',role:'OR-ONB'," +
         "object:'PTR-1013 · Passport',detail:'Opened during KYC'})");
  await wait(90);
  const theirs = G("auditRows('operator').filter(function(e){return String(e.detail).indexOf('withheld')>-1})[0]");
  ok('the same kind of entry about someone else is redacted', !!theirs);

  /* an admin sees the unredacted version of the same entries */
  w.eval("orgUsers('operator').filter(u=>u.you)[0].role='OR-ADMIN'");
  ok('an admin with personal-data access sees them in full',
     G("auditRows('operator').filter(function(e){return e.redacted}).length") === 0);
}

/* --------------------------------------------------- AUDIT — APPEND ONLY */
head('AUDIT — append-only, and the actions that write to it');
{
  const { w, G } = await load('operator.html');
  w.App = G('App'); w.App.go('audit'); await wait(190);

  ok('there is no update path in the API surface', G("typeof window.updateAuditEntry") === 'undefined');
  ok('and no delete path', G("typeof window.deleteAuditEntry") === 'undefined');

  const before = G('AUDIT_LOG.operator.length');
  w.eval("audit('policy.changed',{object:'Digital Content Marketplace',detail:'unit test'})"); await wait(80);
  ok('a logged action appends an entry', G('AUDIT_LOG.operator.length') === before + 1);
  ok('newest first', G("AUDIT_LOG.operator[0].object") === 'Digital Content Marketplace');
  ok('the entry carries an actor', !!G("AUDIT_LOG.operator[0].actor"));
  ok('a category derived from the action', G("AUDIT_LOG.operator[0].cat") === 'Governance');
  ok('and a session record', !!G("AUDIT_LOG.operator[0].ip"));

  /* real journeys write real entries */
  const n0 = G('AUDIT_LOG.operator.length');
  w.App.go('verticals'); await wait(170);
  w.eval("openPolicy('content')"); await wait(140);
  w.eval("setPolicy('content','slaHours',18); savePolicy('content')"); await wait(180);
  ok('saving a catalogue policy is audited', G('AUDIT_LOG.operator.length') > n0);
  ok('with the category it applied to',
     G("AUDIT_LOG.operator[0].action") === 'policy.changed');

  const n1 = G('AUDIT_LOG.operator.length');
  w.App.go('users'); await wait(180);
  const other = G("orgUsers('operator').filter(function(u){return !u.you && u.status==='active'})[0]");
  w.eval("forceResetUser('operator','" + other.id + "')"); await wait(140);
  confirmDialog(w, 'RESET'); await wait(170);
  ok('forcing a password reset is audited', G('AUDIT_LOG.operator.length') > n1);
  ok('and recorded as a significant action',
     G("AUDIT_LOG.operator.filter(function(e){return e.action==='password.reset'})[0].sev") === 'high');
  ok('with the before and after state',
     G("AUDIT_LOG.operator.filter(function(e){return e.action==='password.reset'})[0].after") === 'reset required');

  /* export is audited too */
  const n2 = G('AUDIT_LOG.operator.length');
  w.eval("window.__dl=[]; URL.createObjectURL=function(b){window.__dl.push(b);return 'blob:t'};" +
         "URL.revokeObjectURL=function(){};");
  w.App.go('partners'); await wait(180);
  w.eval("exportDialog('Partner directory','dtPartners')"); await wait(130);
  w.eval("runExport('Partner directory','dtPartners')"); await wait(170);
  ok('taking an export is audited', G('AUDIT_LOG.operator.length') > n2);
  ok('recording how many records left the building',
     /records/.test(G("AUDIT_LOG.operator.filter(function(e){return e.action==='export.taken'})[0].detail")));
}

/* --------------------------------------------------- AUDIT — THE ENTRY */
head('AUDIT — an entry answers who, what, before, after and from where');
{
  const { w, G } = await load('operator.html');
  w.App = G('App'); w.App.go('audit'); await wait(190);

  const id = G("AUDIT_LOG.operator.find(function(e){return e.before!=null}).id");
  w.eval("openAuditEntry('operator','" + id + "')"); await wait(150);
  const insp = w.document.getElementById('inspector');
  ok('the entry opens', !insp.hidden);
  ok('it names the actor and their role', /Actor/.test(insp.textContent));
  ok('it shows what changed, before and after', /What changed/.test(insp.textContent));
  ok('it records the session it came from', /Session/.test(insp.textContent));
  ok('and states that entries cannot be edited or deleted',
     /cannot be edited or deleted/.test(insp.textContent));

  /* a refused attempt is recorded as carefully as a success */
  const denied = G("AUDIT_LOG.operator.filter(function(e){return e.result==='denied'})[0]");
  ok('a refused attempt is in the trail', !!denied);
  w.eval("openAuditEntry('operator','" + denied.id + "')"); await wait(140);
  ok('and the entry says the action was refused',
     /was refused/.test(w.document.getElementById('inspector').textContent));
  ok('and that nothing changed',
     /Nothing changed/.test(w.document.getElementById('inspector').textContent));

  /* an entry outside your scope cannot be opened directly */
  w.eval("orgUsers('operator').filter(u=>u.you)[0].role='OR-SUP'");
  w.eval("closeInspector()"); await wait(80);
  const settle = G("AUDIT_LOG.operator.filter(function(e){return e.cat==='Settlement'})[0].id");
  w.eval("openAuditEntry('operator','" + settle + "')"); await wait(140);
  ok('an out-of-scope entry cannot be opened by id',
     w.document.getElementById('inspector').hidden === true);
}

/* --------------------------------------------------- AUDIT — VISIBILITY MAP */
head('AUDIT — the visibility model is explained, not assumed');
{
  const { w, G } = await load('operator.html');
  w.App = G('App'); w.App.go('audit'); await wait(190);
  w.eval("auditScopeDialog('operator')"); await wait(160);
  const m = w.document.getElementById('modalHost');
  ok('the visibility map opens', !!m);
  ok('every role is listed', G("orgRoles('operator').every(function(r){" +
     "return document.getElementById('modalHost').textContent.indexOf(r.name)>-1})"));
  ok('every category is a column',
     G("AUDIT_CATEGORIES.every(function(c){" +
       "return document.getElementById('modalHost').textContent.indexOf(c)>-1})"));
  ok('it marks which row is you', /— you/.test(m.textContent));
  ok('it states that a role with no categories is refused', /refused, not shown empty/.test(m.textContent));
  ok('that redaction is used rather than hiding', /redacted, not hidden/i.test(m.textContent));
  ok('and that your own actions are never redacted from you', /never redacted from you/i.test(m.textContent));
}

/* --------------------------------------------------- AUDIT — PER PERSONA */
head('AUDIT — each portal sees only its own trail');
{
  const { w: wp, G: Gp } = await load('partner.html');
  wp.App = Gp('App'); wp.App.go('audit'); await wait(190);
  ok('the seller sees its own account only',
     /Your account only/.test(wp.document.getElementById('main').textContent));
  ok('and no other seller appears in it',
     Gp("AUDIT_LOG.partner.every(function(e){return String(e.object).indexOf('Kestrel')===-1})"));
  ok('a fulfilment operator sees only order entries', (function(){
     wp.eval("orgUsers('partner').filter(u=>u.you)[0].role='PR-FUL'");
     return Gp("auditRows('partner').every(function(e){return e.cat==='Orders'})");
  })());

  const { w: we, G: Ge } = await load('enterprise.html');
  we.App = Ge('App'); we.App.go('audit'); await wait(190);
  ok('the buyer sees approvals as evidence',
     Ge("AUDIT_LOG.buyer.some(function(e){return e.action==='requisition.approved'})"));
  ok('a requester sees only their own orders category', (function(){
     we.eval("orgUsers('buyer').filter(u=>u.you)[0].role='BY-REQ'");
     return Ge("auditRows('buyer').every(function(e){return e.cat==='Orders'})");
  })());

  const { w: wc, G: Gc } = await load('consumer.html');
  wc.App = Gc('App'); wc.App.go('audit'); await wait(190);
  ok('the household owner sees everything on the account',
     Gc("auditRows('consumer').length") === Gc("AUDIT_LOG.consumer.length"));
  ok('a teen on the account sees only orders', (function(){
     wc.eval("orgUsers('consumer').filter(u=>u.you)[0].role='CO-TEEN'");
     return Gc("auditRows('consumer').every(function(e){return e.cat==='Orders'})");
  })());
  ok('and materially fewer of them',
     Gc("auditRows('consumer').length") < Gc("AUDIT_LOG.consumer.length"));
}

/* --------------------------------------------------- AUDIT — PERMISSION ROW */
head('AUDIT — reading the log is itself a permission in the roles matrix');
{
  for (const [file, ctx] of [['operator.html','operator'],['partner.html','partner'],
                             ['enterprise.html','buyer'],['consumer.html','consumer']]){
    const { w, G } = await load(file);
    w.App = G('App'); w.App.go('roles'); await wait(180);
    ok(file + ' — the matrix carries an audit-read capability',
       G("PERM_GRID['" + ctx + "'].some(function(r){return /audit|activity log/i.test(r[0])})"));
    ok(file + ' — and it is on screen',
       /audit log|activity log/i.test(w.document.getElementById('main').textContent));
  }
}


/* --------------------------------------------------- BANNERS (PRD 4.3) */
head('BANNERS — operator-managed storefront advertising');
{
  const { w, G } = await load('operator.html');
  w.App = G('App'); w.App.go('banners'); await wait(220);
  const t = w.document.getElementById('main').textContent;

  ok('the banners console exists', /Banners/.test(t));
  ok('every banner is listed', G('DataTable.reg["dtBanner"].rows.length') === G('BANNERS.length'));
  ok('there is a slot for the login screen', G("BANNER_SLOTS.some(function(s){return s.id==='login'})"));
  ok('each slot shows what it is currently serving',
     w.document.querySelectorAll('#main .adbanner').length === G('BANNER_SLOTS.length'));
  ok('it states that sellers cannot buy placement', /cannot buy placement/.test(t));

  /* an unmeasured live banner is called out rather than tolerated */
  ok('a live banner with no measurement is flagged', /no measurement/.test(t));
  ok('and the unmeasured one is identifiable',
     G("BANNERS.some(function(b){return b.state==='live' && b.impressions==null})"));

  /* pre-login honesty */
  w.eval('bannerSlotsDialog()'); await wait(160);
  const sm = w.document.getElementById('modalHost');
  ok('the slots dialog explains the pre-login limitation', /before sign-in/.test(sm.textContent));
  ok('and that only locale and device are available there', /locale and device/i.test(sm.textContent));
  w.eval('closeModal()'); await wait(80);
}
head('BANNERS — creating one, with the rules enforced');
{
  const { w, G } = await load('operator.html');
  w.App = G('App'); w.App.go('banners'); await wait(210);

  const before = G('BANNERS.length');
  w.eval('newBannerDialog()'); await wait(160);
  ok('the builder opens', !!w.document.getElementById('modalHost'));

  w.eval('submitBanner(null)'); await wait(100);
  ok('a nameless banner is refused', !w.document.getElementById('bfNameErr').hidden);
  w.document.getElementById('bfName').value = 'Winter data push';
  w.eval('submitBanner(null)'); await wait(100);
  ok('a banner with no headline is refused', !w.document.getElementById('bfHeadErr').hidden);
  w.document.getElementById('bfHead').value = 'Double data all winter';
  w.eval('submitBanner(null)'); await wait(100);
  ok('a banner with no alt text is refused', !w.document.getElementById('bfAltErr').hidden);
  ok('and nothing was created', G('BANNERS.length') === before);

  w.document.getElementById('bfAlt').value = 'Snow scene with a phone showing a data meter';
  w.eval('bfPreview()'); await wait(80);
  ok('the preview reflects what is typed',
     /Double data all winter/.test(w.document.getElementById('bfPreviewBox').textContent));

  w.eval('submitBanner(null)'); await wait(200);
  ok('a complete banner is created', G('BANNERS.length') === before + 1);
  const b = G('BANNERS[BANNERS.length-1]');
  ok('it is created as a draft, not live', b.state === 'draft');
  ok('with its counters at zero rather than absent', b.impressions === 0 && b.clicks === 0);
  ok('and its creation is audited',
     G("AUDIT_LOG.operator.some(function(e){return e.action==='promo.created' && /Winter data push/.test(e.object)})"));

  /* going live is a deliberate act with stated consequences */
  w.eval("editBanner('" + b.id + "')"); await wait(160);
  w.eval("publishBanner('" + b.id + "')"); await wait(160);
  ok('setting it live asks for confirmation first', !!w.document.getElementById('modalHost'));
  ok('and states the share of voice it will take',
     /share of voice|only live banner/.test(w.document.getElementById('modalHost').textContent));
  confirmDialog(w); await wait(190);
  ok('it is then live', G("BNMAP['" + b.id + "'].state") === 'live');
  ok('and that is audited too',
     G("AUDIT_LOG.operator.some(function(e){return e.after==='live'})"));
}
head('BANNERS — eligibility is a real selection, not a fixed image');
{
  const { w, G } = await load('operator.html');
  w.App = G('App'); await wait(160);

  const out = G("bnEligible('login',{signedIn:false}).length");
  const inn = G("bnEligible('login',{signedIn:true,audience:'Consumer'}).length");
  ok('signed-out visitors see the signed-out banners', out > 0);
  ok('and signed-in visitors do not see those same ones', inn < out, inn + ' vs ' + out);

  ok('an enterprise hero excludes consumer-only banners',
     G("bnEligible('home-hero',{signedIn:true,audience:'Enterprise'}).every(function(b){return b.audience!=='Consumer'})"));
  ok('a consumer hero excludes enterprise-only banners',
     G("bnEligible('home-hero',{signedIn:true,audience:'Consumer'}).every(function(b){return b.audience!=='Enterprise'})"));
  ok('a scheduled banner is not yet eligible',
     G("bnEligible('login',{signedIn:false}).every(function(b){return b.state==='live'})"));
  ok('a paused banner is not eligible',
     G("bnEligible('home-strip',{signedIn:true,audience:'Consumer'}).every(function(b){return b.state!=='paused'})"));
  ok('an existing customer does not see the first-order offer',
     G("bnEligible('home-strip',{signedIn:true,audience:'Consumer',newCustomer:false})" +
       ".every(function(b){return b.audience!=='New customers'})"));
  ok('but a new customer does',
     G("bnEligible('home-strip',{signedIn:true,audience:'Consumer',newCustomer:true})" +
       ".some(function(b){return b.audience==='New customers'})"));

  /* pausing frees the slot rather than blanking it */
  w.App.go('banners'); await wait(190);
  const poolBefore = G("bnEligible('login',{signedIn:false}).length");
  w.eval("toggleBanner('BN-01')"); await wait(170);
  ok('pausing removes it from the pool', G("bnEligible('login',{signedIn:false}).length") === poolBefore - 1);
  ok('and the state is paused, not deleted', G("BNMAP['BN-01'].state") === 'paused');
  w.eval("toggleBanner('BN-01')"); await wait(170);
  ok('resuming puts it back', G("BNMAP['BN-01'].state") === 'live');
}
head('BANNERS — the buyer sees them, and is told why');
{
  const { w, G } = await load('consumer.html');
  w.App = G('App'); await wait(200);

  ok('the storefront carries a banner', w.document.querySelectorAll('#main .adbanner').length > 0);
  const imp = G("BNMAP['BN-03'].impressions");
  ok('an impression is counted on render', imp > 96410, String(imp));

  w.eval("bannerWhy('BN-03')"); await wait(160);
  const m = w.document.getElementById('modalHost');
  ok('the buyer can ask why they are seeing it', !!m);
  ok('it names the audience it was aimed at', /Consumer/.test(m.textContent));
  ok('it says whether an offer is attached', /Linked offer/.test(m.textContent));
  ok('and states that browsing is not profiled', /does not profile/.test(m.textContent));
  w.eval('closeModal()'); await wait(80);

  const c0 = G("BNMAP['BN-03'].clicks");
  w.eval("bannerClick('BN-03')"); await wait(160);
  ok('a click is counted', G("BNMAP['BN-03'].clicks") === c0 + 1);
  ok('and it navigates somewhere relevant', w.App.view === 'browse');

  /* a banner carries its alt text for a screen reader */
  ok('every banner has alt text',
     G("BANNERS.every(function(b){return String(b.alt||'').trim().length>0})"));
}
{
  const { w, G } = await load('enterprise.html');
  w.App = G('App'); await wait(200);
  ok('the enterprise portal carries its own banner', w.document.querySelectorAll('#main .adbanner').length > 0);
  ok('and it is not a consumer banner',
     G("bnEligible('home-hero',{signedIn:true,audience:'Enterprise'})[0].audience") !== 'Consumer');
}
console.log('\n' + (failures ? '\u2717 ' + failures + ' of ' + checks + ' checks failed'
                             : '\u2713 all ' + checks + ' audit checks passed'));
process.exit(failures ? 1 : 0);

})();
