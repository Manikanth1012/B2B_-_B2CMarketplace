/* Headless smoke test: load a persona file, walk every nav item, exercise the
   interactive surfaces, and fail loudly on any JS error or empty render. */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('/tmp/node_modules/jsdom');

const file = process.argv[2];
const errors = [];
const vc = new VirtualConsole();
vc.on('jsdomError', e => errors.push('jsdomError: ' + (e.stack || e.message)));
vc.on('error', (...a) => errors.push('console.error: ' + a.join(' ')));

const html = fs.readFileSync(file, 'utf8');
const dom = new JSDOM(html, { runScripts: 'dangerously', virtualConsole: vc, pretendToBeVisual: true, url: 'http://localhost/' });
const w = dom.window;

function wait(ms){ return new Promise(r => setTimeout(r, ms)); }

(async () => {
  await wait(400);
  if (errors.length) { console.log('LOAD ERRORS:\n' + errors.join('\n')); process.exit(1); }

  /* Sign in through the gate before walking the shell. */
  if (!w.eval('AUTH.signedIn')) {
    const card = w.document.querySelector('.logincard');
    if (!card) { console.log('FAIL: no login screen rendered'); process.exit(1); }
    w.eval('finishLogin("Smoke harness")');
    await wait(300);
  }

  // top-level `const` lives in the global lexical scope, not on `window`
  const G = n => w.eval(n);
  w.App = G('App'); w.AI = G('AI'); w.DataTable = G('DataTable');
  w.closeModal = G('closeModal'); w.closeInspector = G('closeInspector');

  const navIds = Array.from(w.document.querySelectorAll('.nav-item')).map(b => b.id.replace('nav_',''));
  if (!navIds.length) { console.log('FAIL: no nav rendered'); process.exit(1); }

  const report = [];
  for (const id of navIds) {
    w.App.go(id);
    await wait(160);
    const main = w.document.getElementById('main');
    const txt = (main.textContent || '').trim();
    const hasScope = /not part of the agreed scope/.test(txt);
    report.push([id, txt.length, main.querySelectorAll('table').length, main.querySelectorAll('svg').length, hasScope ? 'OUT-OF-SCOPE' : 'ok']);
    if (txt.length < 220 || hasScope) errors.push('view "' + id + '" rendered ' + txt.length + ' chars' + (hasScope ? ' (out of scope)' : ''));
  }

  // exercise every table control on the last view + a data-heavy view
  const probe = navIds.find(x => /user|line|site|invoice|ticket|account|enterprise/.test(x)) || navIds[1] || navIds[0];
  w.App.go(probe); await wait(160);
  const tables = Object.values(w.DataTable.reg);
  for (const t of tables) {
    try { t.sort(t.cfg.columns[0].key); t.setQ('a'); t.clear(); t.go(1); t.go(-1); }
    catch (e) { errors.push('table ' + t.id + ': ' + e.message); }
  }

  // exercise every onclick handler that opens a dialog/inspector
  w.App.go(navIds[0]); await wait(160);
  const clickables = Array.from(w.document.querySelectorAll('#main button[onclick], #main .linkbtn'));
  let clicked = 0;
  for (const b of clickables.slice(0, 40)) {
    try { b.click(); clicked++; if (w.closeModal) w.closeModal(true); if (w.closeInspector) w.closeInspector(); }
    catch (e) { errors.push('click "' + (b.textContent||'').trim().slice(0,40) + '": ' + e.message); }
  }

  // AI assistant
  try { w.AI.open(); await wait(60); (w.App.cfg.aiSuggestions||[]).forEach(s => w.AI.send(s)); await wait(900); w.AI.close(); }
  catch (e) { errors.push('AI: ' + e.message); }

  // notifications drawer + global search
  try { w.App.notifications(); w.closeInspector(); } catch (e) { errors.push('notifications: ' + e.message); }
  try {
    const gi = w.document.getElementById('gsearchInput');
    gi.value = 'inv'; gi.dispatchEvent(new w.Event('input')); await wait(60);
    const res = w.document.getElementById('gres');
    if (res.hidden) errors.push('global search produced no panel');
    gi.value = 'zzzznomatch'; gi.dispatchEvent(new w.Event('input')); await wait(60);
    if (!/No match/.test(res.textContent)) errors.push('global search empty state missing');
  } catch (e) { errors.push('search: ' + e.message); }

  console.log(path.basename(file) + '  —  ' + navIds.length + ' views, ' + clicked + ' controls exercised');
  console.log(report.map(r => '  ' + r[0].padEnd(14) + String(r[1]).padStart(7) + ' chars  ' + r[2] + ' tables  ' + r[3] + ' svg  ' + r[4]).join('\n'));
  if (errors.length) { console.log('\nERRORS (' + errors.length + '):\n' + errors.slice(0,25).join('\n')); process.exit(1); }
  console.log('\nPASS');
  process.exit(0);
})();
