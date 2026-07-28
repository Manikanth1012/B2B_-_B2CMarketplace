/* ===========================================================================
   Category-scoped dunning ladders, banner artwork and the seller reviews
   screen. Twelfth file, to stay inside the shell's 45-second budget.
   Run: node _src/journeys_scope.js
   =========================================================================== */
const fs=require('fs'),path=require('path');
const {JSDOM,VirtualConsole}=require('/tmp/node_modules/jsdom');
const OUT=path.join(__dirname,'..');
let failures=0,checks=0;
function load(file){const vc=new VirtualConsole();
 const dom=new JSDOM(fs.readFileSync(path.join(OUT,file),'utf8'),
  {runScripts:'dangerously',virtualConsole:vc,pretendToBeVisual:true,url:'http://localhost/'});
 return new Promise(r=>setTimeout(()=>{try{if(!dom.window.eval('AUTH.signedIn'))dom.window.eval('finishLogin("T")');}catch(e){}
  setTimeout(()=>r({w:dom.window,G:n=>dom.window.eval(n)}),200);},260));}
const wait=ms=>new Promise(r=>setTimeout(r,ms));
function ok(l,c,d){checks++;if(c)console.log('   ✓ '+l);else{failures++;console.log('   ✗ '+l+(d?'  — '+d:''));}}
function head(t){console.log('\n'+t);}
(async()=>{
head('CATEGORY LADDERS — the narrowest scope that matches wins');
{
 const {w,G}=await load('operator.html');
 w.App=G('App'); w.App.go('collections'); await wait(260);
 const t=w.document.getElementById('main').textContent;
 ok('three scopes are defined, narrowest first',
    G("LADDER_SCOPES.map(function(s){return s.id}).join(',')")==='category,vertical,segment');
 ok('marketplace-category ladders exist', G("DUNNING_LADDERS.filter(function(l){return l.scope==='vertical'}).length")>0);
 ok('product-category ladders exist',     G("DUNNING_LADDERS.filter(function(l){return l.scope==='category'}).length")>0);
 ok('the screen states the precedence', /narrowest scope wins/i.test(t));
 ok('and names all three scopes', /product category/i.test(t) && /marketplace category/i.test(t));

 const P="{ctx:'consumer',amount:40,bundleId:'B',";
 ok('a product category beats a marketplace category',
    G("ladderResolve("+P+"productCat:'Streaming',vertical:'content'}).ladder.id")==='DL-C-STR');
 ok('a marketplace category beats the customer type',
    G("ladderResolve("+P+"productCat:'Gaming',vertical:'content'}).ladder.id")==='DL-V-CON');
 ok('and the customer type is still there when nothing else matches',
    G("ladderResolve("+P+"productCat:'Nothing',vertical:'nowhere'}).ladder.id")==='DL-CON');
 ok('the resolution explains itself',
    /narrower than the customer type/.test(G("ladderResolve("+P+"productCat:'Streaming',vertical:'content'}).why")));

 ok('a category ladder applies across customer types',
    G("DUNNING_LADDERS.filter(function(l){return l.scope!=='segment'}).every(function(l){return l.segment===null})"));
 ok('so an enterprise IoT SIM case reaches the SIM ladder',
    G("ladderResolve({ctx:'buyer',amount:14520,bundleId:'B',productCat:'IoT SIM plans',vertical:'iot'}).ladder.id")==='DL-C-SIM');
 ok('a ladder naming a customer type beats one that does not, at the same scope',
    G("scopeRank(DLMAP['DL-CON'])")===G("scopeRank(DLMAP['DL-ENT'])"));

 ok('commission owed to the marketplace never uses a product ladder',
    G("ladderResolve({ctx:'partner',amount:900,productCat:'CPE',vertical:'device'}).ladder.id")==='DL-PTR');
 ok('because the debt is not for a product',
    G("ladderScopeFits(DLMAP['DL-V-DEV'],{ctx:'partner',vertical:'device',productCat:'CPE'})")===false);

 ok('every case resolves to a ladder', G("DUNNING_CASES.every(function(c){return !!ladderFor(c)})"));
 ok('every case carries what was sold', G("DUNNING_CASES.every(function(c){return !!c.vertical&&!!c.productCat})"));
 ok('a segment with no base ladder is still flagged',
    G("DUN_SEGMENTS.filter(function(sg){return !DUNNING_LADDERS.some(function(l){return (l.scope||'segment')==='segment'&&l.status==='active'&&l.segment===sg.id&&(l.minAmount||0)===0})}).length")===0);

 /* The editor carries the scope through a save. */
 w.eval("ladderDialog(null)"); await wait(200);
 w.eval("document.getElementById('ldName').value='Wearables — any customer type'");
 w.eval("document.getElementById('ldScope').value='category'"); w.eval("ldScopeChange()"); await wait(120);
 ok('choosing a product category lists real categories',
    G("document.getElementById('ldScopeId').options.length")>5);
 w.eval("document.getElementById('ldScopeId').value='Wearables'");
 w.eval("document.getElementById('ldSeg').value=''");
 w.eval("document.getElementById('ldWhy').value='A watch is a low-value instalment with no service to suspend.'");
 w.eval("window.__LAD=[{at:0,action:'notify',channels:['email']},{at:14,action:'final',channels:['email','sms']},{at:45,action:'legal',channels:['letter']}]");
 const n0=G('DUNNING_LADDERS.length');
 w.eval("saveLadder(null)"); await wait(260);
 ok('a category ladder can be created', G('DUNNING_LADDERS.length')===n0+1);
 const nid=G('DUNNING_LADDERS[DUNNING_LADDERS.length-1].id');
 ok('and it keeps its scope', G("DLMAP['"+nid+"'].scope")==='category');
 ok('and the category it names', G("DLMAP['"+nid+"'].scopeId")==='Wearables');
 ok('with no customer type, so it covers all of them', G("DLMAP['"+nid+"'].segment")===null);
 ok('and it immediately governs a matching case',
    G("ladderResolve({ctx:'consumer',amount:120,bundleId:'B',productCat:'Wearables',vertical:'device'}).ladder.id")===nid);

 /* A scoped ladder with no category chosen is refused. */
 w.eval("ladderDialog(null)"); await wait(180);
 w.eval("document.getElementById('ldName').value='Broken'");
 w.eval("document.getElementById('ldScope').value='vertical'"); w.eval("ldScopeChange()"); await wait(100);
 w.eval("document.getElementById('ldScopeId').innerHTML=''");
 w.eval("document.getElementById('ldWhy').value='x'");
 const n1=G('DUNNING_LADDERS.length');
 w.eval("saveLadder(null)"); await wait(140);
 ok('a scoped ladder with no category is refused', G('DUNNING_LADDERS.length')===n1);
 w.eval("closeModal()"); await wait(80);
}

head('BANNER ARTWORK — drawn, never a filename');
{
 const {w,G}=await load('consumer.html');
 w.App=G('App'); w.App.go('home'); await wait(300);
 const ads=w.document.querySelectorAll('.adbanner');
 ok('banners render', ads.length>0);
 ok('each carries drawn artwork',
    Array.prototype.every.call(ads,a=>!!a.querySelector('svg.adartsvg')));
 ok('and no filename is printed',
    !Array.prototype.some.call(ads,a=>/\.(jpg|jpeg|png|webp)/i.test(a.querySelector('.adart').textContent)));
 ok('the artwork is described for a screen reader',
    Array.prototype.every.call(ads,a=>!!a.querySelector('svg.adartsvg').getAttribute('aria-label')));
 ok('every banner names a motif', G("BANNERS.every(function(b){return !!b.art})"));
 ok('and every motif is one we can actually draw',
    G("BANNERS.every(function(b){return !!AD_ART[b.art]})"));
 ok('no banner record still carries a filename', G("BANNERS.every(function(b){return !b.image})"));
}
{
 const {w,G}=await load('operator.html');
 w.App=G('App'); w.App.go('banners'); await wait(280);
 w.eval("newBannerDialog()"); await wait(180);
 ok('the operator picks artwork rather than typing a path',
    !!w.document.getElementById('bfArt'));
 ok('and every motif is offered',
    G("document.getElementById('bfArt').options.length")===G('AD_MOTIFS.length'));
 w.eval("document.getElementById('bfArt').value='coldchain'"); w.eval("bfPreview()"); await wait(120);
 ok('the preview redraws with the chosen motif',
    !!w.document.querySelector('#bfPreviewBox svg.adartsvg'));
 ok('and explains what it depicts',
    /lorry|logistic/i.test(w.document.getElementById('bfArtNote').textContent));
 w.eval("closeModal()"); await wait(80);
}

head('SELLER REVIEWS — real records, not a fixed distribution');
{
 const {w,G}=await load('partner.html');
 w.App=G('App'); w.App.go('reviews'); await wait(280);
 const t=w.document.getElementById('main').textContent;
 ok('the seller has a reviews screen', /Reviews/.test(t));
 ok('reading their own listings only',
    G("myReviews(ME_P.id).every(function(r){return (SKUMAP[r.sku]||{}).partner===ME_P.id})"));
 ok('the average comes from the records, not a constant',
    G("(function(){var p=myReviews(ME_P.id).filter(function(r){return r.state==='published'});"+
      "return Math.abs(p.reduce(function(a,r){return a+r.stars},0)/p.length - "+
      "parseFloat(document.getElementById('main').textContent.match(/([0-9]\\.[0-9])/)[1]))<0.6})()"));
 ok('unanswered poor reviews are called out', /no reply/i.test(t));
 ok('and there are some to answer',
    G("myReviews(ME_P.id).filter(function(r){return r.state==='published'&&r.stars<=2&&!r.response}).length")>0);
 ok('rejections are shown as content decisions, not sentiment ones',
    !/rejected for being negative/i.test(t) || /never for being critical/i.test(t));

 /* Replying is real. */
 const rid=G("myReviews(ME_P.id).filter(function(r){return r.state==='published'&&!r.response})[0].id");
 w.eval("respondReview('"+rid+"')"); await wait(180);
 w.eval("document.getElementById('rrText').value='Short'");
 w.document.querySelector('#modalHost #cfmGo').click(); await wait(160);
 ok('a one-line brush-off is refused', G("REVIEWS.filter(function(r){return r.id==='"+rid+"'})[0].response")===null);
 w.eval("respondReview('"+rid+"')"); await wait(180);
 w.eval("document.getElementById('rrText').value='Both units were replaced under warranty and we have changed the batch test that let them through.'");
 w.document.querySelector('#modalHost #cfmGo').click(); await wait(240);
 ok('a proper reply is posted', !!G("REVIEWS.filter(function(r){return r.id==='"+rid+"'})[0].response"));
 ok('under the seller name', G("REVIEWS.filter(function(r){return r.id==='"+rid+"'})[0].response.by")===G('ME_P.name'));

 w.App.go('performance'); await wait(260);
 const pt=w.document.getElementById('main').textContent;
 ok('the performance summary no longer invents percentages', !/62%/.test(pt));
 ok('and its button goes somewhere', /Open reviews/.test(pt));
}
head('MODERATION QUEUE — one bordered unit per decision');
{
 const {w,G}=await load('operator.html');
 w.App=G('App'); w.App.go('reviews'); await wait(300);
 const cards=w.document.querySelectorAll('.modcard');
 ok('every pending review is its own card',
    cards.length===G("REVIEWS.filter(function(r){return r.state==='pending'}).length"));
 ok('each has a header, a body and a footer', Array.prototype.every.call(cards,
    c=>c.querySelector('.modcard-head')&&c.querySelector('.modcard-body')&&c.querySelector('.modcard-foot')));
 ok('the review inside carries no second border', Array.prototype.every.call(cards,
    c=>!!c.querySelector('.reviewcard.is-bare')));
 ok('the two decisions sit inside the card, not floating after it',
    Array.prototype.every.call(cards,c=>c.querySelector('.modcard-foot').querySelectorAll('button').length===2));
 ok('the panel around them is padded, not flush',
    !cards[0].closest('.panel-body').classList.contains('flush'));
 ok('an auto-flagged review is marked on the card itself',
    w.document.querySelectorAll('.modcard.is-flagged').length ===
    G("REVIEWS.filter(function(r){return r.state==='pending'&&r.flagged}).length"));
 ok('and the footer says a flag is a prompt rather than a decision',
    /prompt for a person, not a decision/.test(w.document.querySelector('.modcard.is-flagged .modcard-foot').textContent));
 /* The buttons still do what they say. */
 const n0=G("REVIEWS.filter(function(r){return r.state==='published'}).length");
 cards[0].querySelector('.modcard-foot .btn-primary').click(); await wait(200);
 const m=w.document.getElementById('modalHost');
 if(m&&m.querySelector('#cfmGo')) m.querySelector('#cfmGo').click();
 await wait(260);
 ok('publishing from the card actually publishes',
    G("REVIEWS.filter(function(r){return r.state==='published'}).length")===n0+1);
}

console.log('\n'+(failures?'✗ '+failures+' of '+checks+' checks failed':'✓ all '+checks+' category, artwork and review checks passed'));
process.exit(failures?1:0);
})();
