/* ===========================================================================
   Theme. Eighteenth file.

   A dark theme is not decoration — every semantic colour has to still be
   readable at night, or the warnings quietly stop working. These checks read
   the tokens out of the built stylesheet and compute the real WCAG ratios
   rather than trusting that the palette looks about right.
   Run: node _src/journeys_theme.js
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

/* ---- WCAG 2.2 relative luminance and contrast ---- */
function lum(hex){
  const h = hex.trim().replace('#','');
  const v = h.length === 3 ? h.split('').map(c=>c+c).join('') : h;
  const p = [0,2,4].map(i => parseInt(v.substr(i,2),16)/255)
    .map(c => c <= 0.03928 ? c/12.92 : Math.pow((c+0.055)/1.055, 2.4));
  return 0.2126*p[0] + 0.7152*p[1] + 0.0722*p[2];
}
function contrast(a,b){
  const l = [lum(a), lum(b)].sort((x,y)=>y-x);
  return (l[0]+0.05)/(l[1]+0.05);
}
/* Pull a token block out of the stylesheet text. */
function tokens(css, selector){
  const i = css.indexOf(selector);
  if (i < 0) return null;
  const open = css.indexOf('{', i), close = css.indexOf('}', open);
  const body = css.slice(open+1, close);
  const out = {};
  body.split(';').forEach(line => {
    const m = line.match(/(--[a-z0-9-]+)\s*:\s*(#[0-9A-Fa-f]{3,8})\s*$/);
    if (m) out[m[1]] = m[2];
  });
  return out;
}

(async () => {

const css = fs.readFileSync(path.join(__dirname, 'core.css'), 'utf8');
const light = tokens(css, ':root{');
const dark  = tokens(css, 'html[data-theme="dark"]{');

head('TOKENS — the dark theme is a re-picked palette, not an inversion');
{
  ok('a dark token block exists', !!dark && Object.keys(dark).length > 15);
  ok('it redefines the neutral surfaces', !!(dark['--nim-surface-0'] && dark['--nim-surface-50']));
  ok('it redefines the ink scale', !!(dark['--nim-ink-900'] && dark['--nim-ink-600']));
  ok('it is not a literal inversion — the base is not pure black',
     lum(dark['--nim-surface-0']) > 0.005);
  ok('nor is the brightest ink pure white, which would halate',
     dark['--nim-ink-900'].toUpperCase() !== '#FFFFFF');
  ok('surfaces still step, so elevation reads',
     lum(dark['--nim-surface-50']) > lum(dark['--nim-surface-0']) &&
     lum(dark['--nim-surface-100']) > lum(dark['--nim-surface-50']));
  ok('every semantic pair is re-picked rather than inherited',
     ['danger','warning','success','info','stale','partial','unavailable']
       .every(k => dark['--nim-'+k+'-fg'] && dark['--nim-'+k+'-bg']));
}

head('CONTRAST — body text meets WCAG 2.2 AA in both themes');
{
  [['light',light],['dark',dark]].forEach(([name,t]) => {
    ['--nim-ink-900','--nim-ink-700','--nim-ink-600'].forEach(ink => {
      ['--nim-surface-0','--nim-surface-50','--nim-surface-100'].forEach(sf => {
        const r = contrast(t[ink], t[sf]);
        ok(name+': '+ink.replace('--nim-','')+' on '+sf.replace('--nim-','')+' reaches 4.5:1',
           r >= 4.5, r.toFixed(2));
      });
    });
  });
}

head('CONTRAST — a warning nobody can read at night is not a warning');
{
  [['light',light],['dark',dark]].forEach(([name,t]) => {
    ['danger','warning','success','info','stale','partial','unavailable'].forEach(k => {
      const r = contrast(t['--nim-'+k+'-fg'], t['--nim-'+k+'-bg']);
      ok(name+': '+k+' text on its own background reaches 4.5:1', r >= 4.5, r.toFixed(2));
    });
  });
}

head('CONTRAST — anything sitting on a primary fill');
{
  [['light',light],['dark',dark]].forEach(([name,t]) => {
    const r = contrast(t['--nim-on-primary'], t['--nim-primary-600']);
    ok(name+': the label on a primary button reaches 4.5:1', r >= 4.5, r.toFixed(2));
  });
  ok('the label colour is a token, not a hard-coded white',
     /--nim-on-primary/.test(css) &&
     !/\.btn-primary\{[^}]*color:#FFFFFF/.test(css));
  ok('the focus halo inner ring follows the surface rather than staying white',
     !!dark['--nim-focus-ring'] &&
     dark['--nim-focus-ring'].toUpperCase() !== '#FFFFFF');
}

head('CONTRAST — the AI accent stays legible without becoming a CTA');
{
  [['light',light],['dark',dark]].forEach(([name,t]) => {
    /* The orange is a stroke, not a text colour. What has to pass at 4.5 is
       the ink actually used on the AI surface. */
    const r = contrast(t['--nim-ai-ink'], t['--nim-ai-surface']);
    ok(name+': AI text on the AI surface reaches 4.5:1', r >= 4.5, r.toFixed(2));
  });
  /* The literal may appear where the token is defined and nowhere else. */
  const once = (lit) => (css.match(new RegExp(lit,'g'))||[]).length;
  ok('AI text is a token rather than a colour typed into eight rules',
     once('#8A3D12') === 1 && (css.match(/var\(--nim-ai-ink\)/g)||[]).length >= 3);
  ok('and the AI border colour is a token too, so it inverts with the theme',
     once('#F6C7AC') === 1 && (css.match(/var\(--nim-ai-line\)/g)||[]).length > 2);
  ok('the AI accent stays distinct from the primary colour in both themes',
     light['--nim-ai-orange-500'] !== light['--nim-primary-500'] &&
     dark['--nim-ai-orange-500']  !== dark['--nim-primary-500']);
}

head('SWITCH — it is where a person would look, and it remembers');
{
  for (const f of ['consumer.html','partner.html','enterprise.html']){
    const { w, G, errs } = await load(f);
    ok(f+' renders with the theme layer in place', errs.length === 0, errs[0]);

    const btn = w.document.getElementById('themeBtn');
    ok(f+' has a theme control in the top bar', !!btn);
    ok(f+' the control says what it will do, not just what it is',
       /Switch to the/.test((btn && btn.getAttribute('aria-label')) || ''));

    const start = w.document.documentElement.getAttribute('data-theme');
    ok(f+' a theme is applied on load rather than left unset',
       start === 'light' || start === 'dark');

    w.eval('THEME.toggle()'); await wait(150);
    const after = w.document.documentElement.getAttribute('data-theme');
    ok(f+' toggling changes the theme', after !== start);
    ok(f+' and the choice is remembered',
       G("(function(){try{return localStorage.getItem('nim.theme')}catch(e){return null}})()") === after);
    ok(f+' the control relabels itself for the new direction',
       new RegExp('Currently ' + after).test(
         (w.document.getElementById('themeBtn')||{getAttribute:()=>''}).getAttribute('aria-label')));

    /* Once chosen, the operating system no longer overrides it. */
    ok(f+' a chosen theme stops following the operating system',
       G('THEME.isAuto()') === false);
    ok(f+' switching back also sticks',
       (function(){ w.eval('THEME.toggle()'); return w.document.documentElement
         .getAttribute('data-theme') === start; })());
  }
}

head('SWITCH — a console with no control does not drift into the dark');
{
  const { w, G } = await load('operator.html');
  ok('the operator console has no theme control',
     !w.document.getElementById('themeBtn'));
  ok('and it is pinned to light rather than following the operating system',
     w.document.documentElement.getAttribute('data-theme') === 'light');
  ok('the lock is explicit in the app config, not an accident',
     G('THEME.locked') === true);
  ok('and asking for the current theme still answers light',
     G('THEME.current()') === 'light');
}

head('PAPER — a document preview is a light island in either theme');
{
  ok('the preview has its own paper token', /--nim-paper/.test(css));
  ok('and the paper stays light in the dark theme',
     lum(dark['--nim-paper']) > 0.6);
  ok('its ink is fixed locally so it does not invert with the page',
     /\.doc-preview\{[^}]*--nim-ink-900:#1D1D1D/.test(css.replace(/\s+/g,'').replace(/\/\*.*?\*\//g,'')) ||
     /--nim-ink-900:#1D1D1D/.test(css.slice(css.indexOf('.doc-preview{'),
                                            css.indexOf('.doc-preview{')+700)));
}

head('SCREENS — the theme does not break a page it was not designed against');
{
  const { w, errs } = await load('consumer.html');
  w.eval("THEME.set('dark')"); await wait(150);
  for (const v of ['home','orders','rewards','refunds','subs','bills']){
    w.eval('App.go("'+v+'")'); await wait(180);
    const m = w.document.getElementById('main');
    ok('consumer '+v+' still renders in the dark theme',
       !!m && m.textContent.replace(/\s+/g,'').length > 60);
  }
  ok('and nothing threw while it did', errs.length === 0, errs[0]);
}

console.log('\n' + (failures ? '✗ ' + failures + ' of ' + checks + ' checks failed'
                             : '✓ all ' + checks + ' theme checks passed'));
process.exit(failures ? 1 : 0);

})();
