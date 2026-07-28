/* ===========================================================================
   Warehouses, shipments and bill templates. Sixteenth file, to stay
   inside the shell's 45-second budget.
   These do not check that a screen rendered — they drive each journey to its
   conclusion and assert that the underlying records actually changed.
   Run: node _src/journeys_wms.js
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
head('WAREHOUSES — a real place, with an address and somebody to call');
{
  const { w, G } = await load('operator.html');
  w.App = G('App'); w.App.go('inventory'); await wait(300);
  const t = w.document.getElementById('main').textContent;

  ok('warehouses can be configured', /Warehouses/.test(t) && /New warehouse/.test(t));
  ok('every one has an address, unless it is drop-ship',
     G("WAREHOUSES.every(function(x){return x.type==='dropship'||(x.lines||[]).length>0})"));
  ok('every one names somebody to call', G("WAREHOUSES.every(function(x){return !!x.contact})"));
  ok('and states a dispatch cut-off', G("WAREHOUSES.every(function(x){return !!x.cutoff})"));
  ok('fulfilment routing decides which one serves an order', /Fulfilment routing/.test(t));
  ok('with an explicit fallback rather than a silent failure',
     G("WH_ROUTING.some(function(r){return r.category==='Any'})"));
  ok('and a returns centre is never in outbound routing',
     G("WH_ROUTING.every(function(r){return (WHMAP[r.warehouse]||{}).type!=='returns'})"));
  ok('stock is mapped to a warehouse', /What is held where/.test(t));
  ok('and every stock line resolves to a real one',
     G("Object.keys(INVENTORY).every(function(k){return !!WHMAP[INVENTORY[k].warehouse]})"));

  const n0 = G('WAREHOUSES.length');
  w.eval('warehouseDialog(null)'); await wait(240);
  w.eval("document.getElementById('whName').value='Chennai DC'");
  w.eval("document.getElementById('whCode').value='MAA01'");
  w.eval('saveWarehouse(null)'); await wait(180);
  ok('a warehouse with no address is refused', G('WAREHOUSES.length') === n0);
  w.eval("document.getElementById('whLines').value='Plot 9, Oragadam\\nChennai 602105'");
  w.eval('saveWarehouse(null)'); await wait(180);
  ok('one with nobody to call is refused', G('WAREHOUSES.length') === n0);
  w.eval("document.getElementById('whContact').value='Meena Iyer'");
  w.eval('saveWarehouse(null)'); await wait(260);
  ok('a complete record is created', G('WAREHOUSES.length') === n0 + 1);
  ok('holding nothing until stock is mapped to it', G("whSkus('WH-MAA').length") === 0);
  ok('and the creation is audited',
     G("AUDIT_LOG.operator.some(function(e){return e.action==='wh.config'})"));

  w.eval("warehouseDialog('WH-DRP')"); await wait(230);
  ok('drop-ship states the stock is not ours to count',
     /not ours/.test(w.document.getElementById('whWarn').textContent));
  w.eval('closeModal()'); await wait(110);
}
head('WAREHOUSES — stock moves leave a trail, and a full one cannot be closed');
{
  const { w, G } = await load('operator.html');
  w.App = G('App'); w.App.go('inventory'); await wait(290);

  const sku = G("Object.keys(INVENTORY).filter(function(k){return !INVENTORY[k].reserved})[0]");
  const from = G("INVENTORY['" + sku + "'].warehouse");
  w.eval("remapSku('" + sku + "')"); await wait(230);
  ok('moving stock names where it is and what is reserved',
     /Currently at/.test(w.document.getElementById('modalHost').textContent));
  w.eval("doRemapSku('" + sku + "')"); await wait(180);
  ok('a move with no reason is refused', G("INVENTORY['" + sku + "'].warehouse") === from);
  w.eval("document.getElementById('rmWhy').value='Consolidating Gulf stock into Dubai'");
  w.eval("doRemapSku('" + sku + "')"); await wait(260);
  ok('the stock moves', G("INVENTORY['" + sku + "'].warehouse") !== from);
  ok('and it is a movement record, not a silent edit',
     G("STOCK_MOVES.some(function(m){return m.kind==='transfer' && m.sku==='" + sku + "'})"));

  const busy = G("WAREHOUSES.filter(function(x){return whUnits(x.id)>0})[0].id");
  w.eval("closeWarehouse('" + busy + "')"); await wait(220);
  ok('closing a warehouse with stock warns that it strands it',
     /does not evaporate/.test(w.document.getElementById('modalHost').textContent));
  confirmDialog(w); await wait(240);
  ok('and it is refused', G("WHMAP['" + busy + "'].status") === 'active');
}
head('SHIPMENTS — under which order, from whom, to whom');
{
  const { w, G } = await load('operator.html');
  w.App = G('App'); w.App.go('inventory'); await wait(290);
  const t = w.document.getElementById('main').textContent;

  ok('every shipment names a purchase order', G('SHIPMENTS.every(function(s){return !!s.po})'));
  ok('and the marketplace order it fulfils', G('SHIPMENTS.every(function(s){return !!s.order})'));
  ok('and who despatched it', G('SHIPMENTS.every(function(s){return !!s.fromName})'));
  ok('and on whose behalf', G('SHIPMENTS.every(function(s){return !!s.seller})'));
  ok('and who receives it', G('SHIPMENTS.every(function(s){return !!s.toName})'));
  ok('with a delivery address', G('SHIPMENTS.every(function(s){return (s.toLines||[]).length>0})'));
  ok('the table shows the purchase order and both parties',
     /Purchase order/.test(t) && /From/.test(t) && /To/.test(t));

  w.eval("openShipment('" + G('SHIPMENTS[0].id') + "')"); await wait(230);
  const ins = w.document.querySelector('.insp-body').textContent;
  ok('a shipment opens with both parties in full',
     /Shipped from/.test(ins) && /Shipped to/.test(ins));
  ok('carrying the incoterm', /Incoterm/.test(ins));
  ok('and a contact at the receiving end',
     G('SHIPMENTS.filter(function(s){return !!s.toContact}).length') > 0);
}
head('BILL FORMATTER — saving the settings creates a listed template');
{
  const { w, G } = await load('operator.html');
  w.App = G('App'); w.App.go('billing'); await wait(270);
  ok('the formatter offers to save a template',
     /Save as a template/.test(w.document.getElementById('main').textContent));

  const n0 = G('BILL_TEMPLATES.length');
  w.eval("saveAsTemplate(BILL_TEMPLATE_ASSIGN.partner,'partner')"); await wait(240);
  ok('it says the original is left alone',
     /is left exactly as it is/.test(w.document.getElementById('modalHost').textContent));
  w.eval("document.getElementById('stName').value='Seller self-billing — Gulf'");
  w.eval("doSaveAsTemplate(BILL_TEMPLATE_ASSIGN.partner,'partner')"); await wait(270);
  ok('a new template is created', G('BILL_TEMPLATES.length') === n0 + 1);
  ok('and appears in the list',
     G("BILL_TEMPLATES.some(function(x){return x.name==='Seller self-billing — Gulf'})"));
  ok('assigned to that audience straight away',
     G("BTMAP[BILL_TEMPLATE_ASSIGN.partner].name") === 'Seller self-billing — Gulf');
  ok('while the built-in it came from is untouched', G("BTMAP['BT-PTR'].name") === 'Seller self-billing');
  ok('and it is not marked as built in', G("BTMAP[BILL_TEMPLATE_ASSIGN.partner].system") === false);
}

console.log('\n' + (failures ? '\u2717 ' + failures + ' of ' + checks + ' checks failed'
                             : '\u2713 all ' + checks + ' warehouse and document checks passed'));
process.exit(failures ? 1 : 0);

})();
