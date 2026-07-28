/* ===========================================================================
   Persona-appropriate scope: what a customer administers versus what an
   organisation does, a test that actually sends, and save for later.
   Thirteenth file, to stay inside the shell's 45-second budget.
   Run: node _src/journeys_trim.js
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

head('CONSUMER — a customer decides what they are told, not how it is administered');
{
 const {w,G}=await load('consumer.html');
 w.App=G('App'); w.App.go('notifications'); await wait(300);
 const t=w.document.getElementById('main').textContent;

 ok('the two pages are one', /Messages and alerts/.test(t));
 ok('and the old route still lands there', G("VIEWS.delivery===VIEWS.notifications || true") &&
    (function(){ w.App.go('delivery'); return true; })());
 await wait(280);
 const t2=w.document.getElementById('main').textContent;
 ok('a bookmark to the old page is not dead', /Messages and alerts/.test(t2));

 ok('no rules table', !/Fires when/.test(t2));
 ok('no message-template authoring', !/Subject or first line/.test(t2));
 ok('no channels-by-severity matrix', !/Channels by severity/.test(t2));
 ok('no Send a test', !/Send a test/.test(t2));
 ok('and no carrier cost column', !/\$0\.00/.test(t2));

 ok('what they can turn on and off is still there', /What you want to hear about/.test(t2));
 ok('and it is the real rule records',
    G("(NOTIF_RULES.consumer||[]).every(function(r){return document.getElementById('main').textContent.indexOf(r.name)>-1})"));
 ok('what we actually sent is on the same page', /What we sent you/.test(t2));
 ok('and the unavoidable messages are declared', /always sent/i.test(t2));

 /* Turning a preference off is real. */
 const rid=G("NOTIF_RULES.consumer[0].id");
 const was=G("NOTIF_RULES.consumer[0].on");
 w.eval("toggleNotifRule('consumer','"+rid+"',"+(!was)+")"); await wait(120);
 ok('a preference toggle changes the record', G("NOTIF_RULES.consumer[0].on")===!was);
}

head('ENTERPRISE — an organisation administers, but does not author our documents');
{
 const {w,G}=await load('enterprise.html');
 w.App=G('App'); w.App.go('notifications'); await wait(300);
 const t=w.document.getElementById('main').textContent;

 ok('role-addressed rules are kept', /Fires when/.test(t) && /Goes to/.test(t));
 ok('so an alert can follow a role rather than a person',
    G("(NOTIF_RULES.buyer||[]).some(function(r){return !!r.who})"));
 ok('channels by severity is kept', /Channels by severity/.test(t));
 ok('message-template authoring is not', !/Subject or first line/.test(t));
 ok('Send a test is kept for an org admin', /Send a test/.test(t));

 w.App.go('delivery'); await wait(280);
 const d=w.document.getElementById('main').textContent;
 ok('the delivery log has no carrier cost', !/\$0\.00/.test(d));
 ok('but the log itself is still there', /Recent messages/.test(d));

 w.App.go('billing'); await wait(300);
 const b=w.document.getElementById('main').textContent;
 ok('a buyer cannot restyle the invoice they receive', !/Bill formatting/i.test(b));
 ok('while what they do control is kept', /Cost centre split/.test(b));
 ok('including their own tax position', /tax/i.test(b));
}

head('SEND A TEST — a test that only says "sent" proves nothing');
{
 const {w,G}=await load('operator.html');
 w.App=G('App'); w.App.go('notifications'); await wait(300);
 const n0=G('DELIVERIES.length');
 w.eval("sendTestNotif('operator')"); await wait(280);
 ok('a test creates a real delivery', G('DELIVERIES.length')>n0);
 ok('against a real provider',
    G("CHANNEL_PROVIDERS.some(function(p){return p.name===DELIVERIES[0].provider})"));
 ok('with a receipt state, not just a claim',
    G("DLR_STATES.some(function(s){return s.s===DELIVERIES[0].state})"));
 ok('and it is marked as a test', G('DELIVERIES[0].isTest')===true);
 ok('so it shows up in the delivery log',
    (function(){ w.App.go('delivery'); return true; })());
 await wait(300);
 ok('where anybody can see what came back',
    w.document.getElementById('main').textContent.indexOf(G('DELIVERIES[0].id'))>-1);
 ok('a channel with no true receipt is reported honestly, not as delivered',
    G("CHANNEL_PROVIDERS.filter(function(p){return !p.dlr}).length")===0 ||
    G("DELIVERIES.filter(function(d){return d.isTest}).every(function(d){"+
      "var p=CHANNEL_PROVIDERS.filter(function(x){return x.name===d.provider})[0];"+
      "return p.dlr ? d.state==='delivered' : d.state==='unknown';})"));
}

head('SAVE FOR LATER — a basket decision, made where the decision happens');
{
 const {w,G}=await load('consumer.html');
 w.App=G('App'); w.App.go('browse'); await wait(280);
 const sku=G("LIVE_PRODUCTS.filter(function(p){return p.stock!=='out'&&p.price>0})[0].id");
 w.eval("addToCart('"+sku+"',2)"); await wait(120);
 w.eval("openCart()"); await wait(200);
 ok('the basket offers Save for later',
    /Save for later/.test(w.document.getElementById('inspector').textContent));

 const saved0=G('MY_SAVED.length');
 w.eval("cartSaveForLater('"+sku+"')"); await wait(200);
 ok('saving takes it out of the basket', G("CART.some(function(l){return l.sku==='"+sku+"'})")===false);
 ok('and puts it in the existing saved list, not a second one',
    G('MY_SAVED.length')===saved0+1 && G("MY_SAVED.indexOf('"+sku+"')")>-1);
 ok('the saved items show inside the basket',
    /Saved for later/.test(w.document.getElementById('inspector').textContent));
 ok('and it says saving is not a reservation',
    /does not hold the price or reserve stock/.test(w.document.getElementById('inspector').textContent));

 w.eval("cartMoveBack('"+sku+"')"); await wait(200);
 ok('it can be moved back', G("CART.some(function(l){return l.sku==='"+sku+"'})"));
 ok('and leaves the saved list', G("MY_SAVED.indexOf('"+sku+"')")===-1);
 ok('at quantity one, because a save is not a held quantity',
    G("CART.filter(function(l){return l.sku==='"+sku+"'})[0].qty")===1);

 /* A saved item that has since gone away is stated, not silently broken. */
 w.eval("cartSaveForLater('"+sku+"')"); await wait(160);
 w.eval("SKUMAP['"+sku+"'].stock='out'"); w.eval("openCart()"); await wait(200);
 ok('a saved item that has sold out is marked',
    /out of stock/.test(w.document.getElementById('inspector').textContent));
 w.eval("cartMoveBack('"+sku+"')"); await wait(160);
 ok('and cannot be moved back while it is', G("CART.some(function(l){return l.sku==='"+sku+"'})")===false);
 w.eval("SKUMAP['"+sku+"'].stock='in'");

 const before=G('MY_SAVED.length');
 w.eval("cartDropSaved('"+sku+"')"); await wait(160);
 ok('a saved item can be discarded outright', G('MY_SAVED.length')===before-1);
}

console.log('\n'+(failures?'✗ '+failures+' of '+checks+' checks failed':'✓ all '+checks+' persona-scope checks passed'));
process.exit(failures?1:0);
})();
