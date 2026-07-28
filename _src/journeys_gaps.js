/* ===========================================================================
   The four consistency gaps found by the cross-persona audit: arrears seen by
   the party being chased, a reviewer's own reviews, buyer integration, and
   seller guidance for the screens that hold a clock and money.
   Fourteenth file, to stay inside the shell's 45-second budget.
   Run: node _src/journeys_gaps.js
   =========================================================================== */
const fs=require('fs'),path=require('path');
const {JSDOM,VirtualConsole}=require('/tmp/node_modules/jsdom');
const OUT=path.join(__dirname,'..');
let failures=0,checks=0;
function load(f){const vc=new VirtualConsole();
 const dom=new JSDOM(fs.readFileSync(path.join(OUT,f),'utf8'),
  {runScripts:'dangerously',virtualConsole:vc,pretendToBeVisual:true,url:'http://localhost/'});
 return new Promise(r=>setTimeout(()=>{try{if(!dom.window.eval('AUTH.signedIn'))dom.window.eval('finishLogin("T")');}catch(e){}
  setTimeout(()=>r({w:dom.window,G:n=>dom.window.eval(n)}),200);},260));}
const wait=ms=>new Promise(r=>setTimeout(r,ms));
function ok(l,c,d){checks++;if(c)console.log('   ✓ '+l);else{failures++;console.log('   ✗ '+l+(d?'  — '+d:''));}}
function head(t){console.log('\n'+t);}
function confirmDialog(w,typeWord){
  const m=w.document.getElementById('modalHost'); if(!m) return false;
  if(typeWord){const i=m.querySelector('#cfmType'); if(i){i.value=typeWord;i.dispatchEvent(new w.Event('input'));}}
  const go=m.querySelector('#cfmGo'); if(!go||go.disabled) return false; go.click(); return true;}
(async()=>{

head('ARREARS — the party being chased can see what happens next');
{
 const {w,G}=await load('consumer.html');
 w.App=G('App'); w.App.go('bills'); await wait(320);
 const t=w.document.getElementById('main').textContent.replace(/\s+/g,' ');
 ok('a customer in arrears is told', /A payment did not go through/.test(t));
 ok('the reason is given, not just the amount', /Card expired|Insufficient|blocked|Mandate/i.test(t));
 ok('the next step carries a date', /On \d/.test(t));
 ok('and the consequence is named in plain words',
    /the service stops|will not be able to buy|final notice|remind/i.test(t));
 ok('they are told it is fixable', /takes about a minute|Update the payment method/i.test(t));
 ok('the arrears they see are only their own',
    G("myArrears('consumer').every(function(d){return d.account===SHOPPER.name})"));
 ok('and not every consumer case on the platform',
    G("myArrears('consumer').length") < G("DUNNING_CASES.filter(function(c){return c.ctx==='consumer'}).length"));

 /* The whole ladder, forwards, from the debtor's side. */
 w.eval("arrearsHelp('consumer')"); await wait(200);
 const m=w.document.getElementById('modalHost').textContent;
 ok('they can see the whole sequence ahead', /What happens from here/.test(m));
 ok('with their own position marked', /You are here/.test(m));
 ok('and it says nothing happens unannounced', /without you being told first/.test(m));
 w.eval("closeModal()"); await wait(80);

 /* Asking for time is real. */
 const id=G("myArrears('consumer')[0].id");
 w.eval("askForTime('"+id+"')"); await wait(200);
 w.eval("document.getElementById('ptpWhen').value='12 Aug 2026'");
 confirmDialog(w); await wait(240);
 ok('a promise to pay is recorded', G("DUNNING_CASES.filter(function(d){return d.id==='"+id+"'})[0].promiseToPay")==='12 Aug 2026');
 w.App.go('bills'); await wait(300);
 ok('and the screen then says nothing happens until then',
    /Nothing until/.test(w.document.getElementById('main').textContent));

 /* Paying clears it. */
 w.eval("payArrears('"+id+"')"); await wait(200);
 confirmDialog(w); await wait(240);
 ok('paying closes the case', G("DUNNING_CASES.filter(function(d){return d.id==='"+id+"'})[0].state")==='recovered');
 ok('and it drops out of their arrears', G("myArrears('consumer').some(function(d){return d.id==='"+id+"'})")===false);
}
{
 const {w,G}=await load('enterprise.html');
 w.App=G('App'); w.App.go('billing'); await wait(320);
 const t=w.document.getElementById('main').textContent.replace(/\s+/g,' ');
 ok('a buyer in arrears sees the schedule, not just "overdue"', /Overdue invoices/.test(t));
 ok('with a dated next step', /On \d/.test(t));
 ok('they see only their own company’s balances',
    G("myArrears('buyer').every(function(d){return d.account===BUYER.company})"));
 ok('a recorded promise to pay is honoured on screen',
    G("myArrears('buyer').some(function(d){return d.promiseToPay})") ?
      /Nothing until/.test(t) : true);
 ok('and they are told a disputed amount is not chased', /disputed balance is not chased/.test(t));
}

head('REVIEWS — the person who wrote it can see it');
{
 const {w,G}=await load('consumer.html');
 w.App=G('App'); w.App.go('account'); await wait(320);
 const t=w.document.getElementById('main').textContent;
 ok('a reviewer can see their own reviews', /Reviews you have written/.test(t));
 ok('reading only their own',
    G("myAuthoredReviews(SHOPPER.name).every(function(r){return r.author===SHOPPER.name})"));
 ok('and they have some', G("myAuthoredReviews(SHOPPER.name).length")>0);
 ok('they are offered things they bought but have not reviewed',
    G("myReviewablePurchases(SHOPPER.name).length")>0);
 ok('and never something already reviewed',
    G("(function(){var d={};myAuthoredReviews(SHOPPER.name).forEach(function(r){d[r.sku]=1});"+
      "return myReviewablePurchases(SHOPPER.name).every(function(o){return !d[o.sku]})})()"));

 /* A rejected review can be rewritten — the moderation flow promises this. */
 w.eval("REVIEWS[0].author=SHOPPER.name; REVIEWS[0].state='rejected'; REVIEWS[0].rejectReason='Names an individual'");
 w.App.go('account'); await wait(300);
 ok('a rejected review says why', /Names an individual/.test(w.document.getElementById('main').textContent));
 const rid=G("REVIEWS[0].id");
 w.eval("rewriteReview('"+rid+"')"); await wait(200);
 w.eval("document.getElementById('rwBody').value='Short'");
 confirmDialog(w); await wait(160);
 ok('a one-line rewrite is refused', G("REVIEWS.filter(function(r){return r.id==='"+rid+"'})[0].state")==='rejected');
 w.eval("rewriteReview('"+rid+"')"); await wait(200);
 w.eval("document.getElementById('rwBody').value='Rewritten without naming the engineer who attended.'");
 confirmDialog(w); await wait(240);
 ok('a proper rewrite goes back for a check', G("REVIEWS.filter(function(r){return r.id==='"+rid+"'})[0].state")==='pending');
 ok('and the old rejection reason is cleared', G("REVIEWS.filter(function(r){return r.id==='"+rid+"'})[0].rejectReason")===null);

 /* Challenging a rejection reaches somebody else. */
 w.eval("REVIEWS[0].state='rejected'; REVIEWS[0].rejectReason='Not constructive'");
 w.eval("challengeRejection('"+rid+"')"); await wait(200);
 w.eval("document.getElementById('chWhy').value='It was critical, which is not the same as unconstructive.'");
 confirmDialog(w); await wait(240);
 ok('a rejection can be challenged', !!G("REVIEWS.filter(function(r){return r.id==='"+rid+"'})[0].challenge"));
 ok('and it goes back into the queue', G("REVIEWS.filter(function(r){return r.id==='"+rid+"'})[0].state")==='pending');
}
{
 const {w,G}=await load('enterprise.html');
 w.App=G('App'); w.App.go('orders'); await wait(320);
 ok('a buyer sees their own reviews too',
    /Reviews you have written/.test(w.document.getElementById('main').textContent));
 ok('authored as the company', G("myAuthoredReviews(BUYER.company).length")>0);
}

head('BUYER INTEGRATION — an audience with a door');
{
 const {w,G}=await load('enterprise.html');
 w.App=G('App'); w.App.go('integration'); await wait(320);
 const t=w.document.getElementById('main').textContent.replace(/\s+/g,' ');
 ok('the buyer has an integration screen at all', /Reach the marketplace from your own systems/.test(t));
 ok('every buyer-audienced API is reachable from it',
    G("API_PRODUCTS.filter(function(p){return /buyer/i.test(p.audience)}).every(function(p){"+
      "return document.getElementById('main').textContent.indexOf(p.name)>-1})"));
 ok('no seller-only API leaks into it',
    G("buyerApis().every(function(p){return /buyer/i.test(p.audience)})"));
 ok('every one carries a version history',
    G("buyerApis().every(function(p){return (API_VERSIONS[p.id]||[]).length>0})"));

 /* The constraint that matters. */
 ok('an API order is bound by the buyer’s own approval policy',
    /follows your approval policy/.test(t));
 ok('and the threshold is stated', t.indexOf(G("CUR0(APPROVAL_POLICY.threshold)"))>-1);
 ok('it says the API is not a way around it', /not a route around your own threshold/.test(t));
 ok('contract pricing is resolved per account, and the caching trap is named',
    /another customer/.test(t) || /Caching/.test(t));
 ok('sandbox comes before production',
    G("buyerApis().every(function(p){return p.envs.indexOf('sandbox')===0})"));

 w.eval("buyerApiDetail('AP-BORD')"); await wait(200);
 const insp=w.document.getElementById('inspector').textContent;
 ok('the detail explains what an approval response looks like', /202|approval reference/i.test(insp));
 w.eval("closeInspector()"); await wait(80);

 w.eval("buyerKeyDialog()"); await wait(200);
 ok('credentials are issued to a named person, not an organisation',
    /named person/.test(w.document.getElementById('modalHost').textContent));
 confirmDialog(w); await wait(220);
 ok('and requesting them is audited',
    G("auditRows('buyer').some(function(e){return /credential/i.test(e.label+e.detail)})"));
}

head('SELLER GUIDANCE — the screens with a clock and money on them');
{
 const {w,G}=await load('partner.html');
 const titles=G("(KB_ARTICLES.partner||[]).map(function(a){return a.title}).join(' | ')");
 ok('refunds are documented', /refund/i.test(titles));
 ok('credit and debit notes are documented', /note/i.test(titles));
 ok('collections are documented', /chasing/i.test(titles));
 ok('the refund article states the clock',
    G("(KB_ARTICLES.partner||[]).filter(function(a){return /refund/i.test(a.title)})[0].body"+
      ".some(function(b){return /48 hours/.test(b[1])})"));
 ok('and that silence costs the decision, not the money',
    G("(KB_ARTICLES.partner||[]).filter(function(a){return /refund/i.test(a.title)})[0].body"+
      ".some(function(b){return /does not save you the money/.test(b[1])})"));
 ok('the collections article states the bundle override',
    G("(KB_ARTICLES.partner||[]).filter(function(a){return /chasing/i.test(a.title)})[0].body"+
      ".some(function(b){return /one suspension date/.test(b[1])})"));
 ok('every new article points at a real screen',
    G("(KB_ARTICLES.partner||[]).every(function(a){return !a.view || !!VIEWS[a.view]})"));
 w.App=G('App'); w.App.go('help'); await wait(300);
 ok('and they are reachable from the knowledge base',
    /Deciding a refund request/.test(w.document.getElementById('main').textContent));
}

console.log('\n'+(failures?'✗ '+failures+' of '+checks+' checks failed':'✓ all '+checks+' consistency-gap checks passed'));
process.exit(failures?1:0);
})();
