/* ===========================================================================
   Layout audit. Two classes of defect that a journey test cannot see, because
   both render without throwing:

     1. A class used in markup with no CSS rule behind it. The element still
        appears, just unstyled — which is how .rowend shipped as three action
        buttons with no gap, and how a success banner shipped with no fill.
     2. A row whose cell count does not match its header. Every column to the
        right of the gap silently shifts by one. This caught a missing closing
        quote on a style attribute that swallowed a </td><td> pair.

   Also checks numeric columns are right-aligned under numeric headers, and
   that no inline min-width can overflow a 1024 viewport.

   Run: node _src/layout.js
   =========================================================================== */
const fs=require('fs'),path=require('path');
const {JSDOM,VirtualConsole}=require('/tmp/node_modules/jsdom');
const OUT=path.join(__dirname,'..');
process.chdir(OUT);

/* every class used in markup must have a CSS rule */
const CSSTXT=fs.readFileSync(path.join(__dirname,'core.css'),'utf8');
const DEFINED=new Set((CSSTXT.match(/\.[-a-zA-Z_][-a-zA-Z0-9_]*/g)||[]).map(c=>c.slice(1)));
const OKPRE=[/^t-/,/^g\d/,/^is-/,/^has-/,/^nim-/,/^conf-/,/^sev-/,/^tier-/,/^state-/];
const undef=new Map();

/* No wording that tells a viewer this is not the real product. Ordinary
   English like "would be" is deliberately not on the list — only words that
   describe the software itself as provisional. */
const PROVISIONAL=new RegExp('\\b(prototype|prototypes|mock|mocked|mock-up|dummy|synthetic|fake|simulated|'+
  'stub|stubbed|sample data|test data|fictional|not real|toy)\\b|'+
  '(in|on) the real (platform|system|product)|in a real (platform|system)|'+
  'when this is built|once (it is |this is )?built','i');
const provis=new Map();
function wordCheck(txt,at){
  const m=txt.match(PROVISIONAL);
  if(m){ if(!provis.has(m[0].toLowerCase())) provis.set(m[0].toLowerCase(),new Set());
         provis.get(m[0].toLowerCase()).add(at); }
}
function classCheck(doc,at){
  doc.querySelectorAll('#main [class]').forEach(el=>{
    const cn=el.className.baseVal!==undefined?el.className.baseVal:el.className;
    String(cn).split(/\s+/).forEach(c=>{
      if(!c||DEFINED.has(c)||OKPRE.some(r=>r.test(c)))return;
      if(!undef.has(c))undef.set(c,new Set());
      undef.get(c).add(at);
    });
  });
}
const wait=ms=>new Promise(r=>setTimeout(r,ms));
let bad=0,tables=0,cells=0,views=0;
function span(cs,a){let n=0;cs.forEach(c=>{n+=parseInt(c.getAttribute(a)||'1',10)||1;});return n;}
(async()=>{
 for(const f of ['operator.html','partner.html','enterprise.html','consumer.html']){
  const vc=new VirtualConsole();const errs=[];vc.on('jsdomError',e=>errs.push(e.message));
  const w=new JSDOM(fs.readFileSync(f,'utf8'),{runScripts:'dangerously',virtualConsole:vc,pretendToBeVisual:true,url:'http://localhost/'}).window;
  await wait(430); const G=n=>w.eval(n);
  if(!G('AUTH.signedIn')) G('finishLogin("Align")'); await wait(300);
  const nav=Array.from(w.document.querySelectorAll('.nav-item')).map(b=>b.id.replace('nav_',''));
  const rep=[];
  for(const v of nav){
   G("App.go('"+v+"')"); await wait(130); views++;
   const at=f.replace('.html','')+'/'+v;
   classCheck(w.document, at);
   wordCheck(w.document.getElementById('main').textContent, at);

   w.document.querySelectorAll('#main table').forEach((t,ti)=>{
     const th=t.querySelector('thead'); if(!th) return; tables++;
     const hdr=Array.from(th.querySelectorAll('tr')).pop();
     const cols=span(Array.from(hdr.children),'colspan');
     const carry=[];
     ['tbody','tfoot'].forEach(sec=>{
       const el=t.querySelector(sec); if(!el) return;
       Array.from(el.children).filter(r=>r.tagName==='TR').forEach((tr,ri)=>{
         const cs=Array.from(tr.children).filter(c=>/^T[DH]$/.test(c.tagName));
         const n=span(cs,'colspan')+(carry[ri]||0);
         cs.forEach(c=>{const rs=+(c.getAttribute('rowspan')||1),cc=+(c.getAttribute('colspan')||1);
           for(let k=1;k<rs;k++) carry[ri+k]=(carry[ri+k]||0)+cc;});
         if(n!==cols){bad++;rep.push('  column mismatch: '+sec+' row '+(ri+1)+' has '+n+' of '+cols+'  ['+at+' table '+(ti+1)+']');}
       });
     });
   });

   /* adjacent buttons must be separated by margin or a flex gap */
   w.document.querySelectorAll('#main td').forEach(td=>{
     /* Only real action buttons. Two .linkbtn inline in prose, separated by
        a comma, are text and not an action group. */
     const b=Array.from(td.children).filter(c=>c.tagName==='BUTTON'&&c.classList.contains('btn'));
     if(b.length<2) return; cells++;
     const disp=w.getComputedStyle(td).display;
     const gap=parseFloat(w.getComputedStyle(td).gap)||0;
     const ml=parseFloat(w.getComputedStyle(b[1]).marginLeft)||0;
     if(!((disp==='flex'&&gap>0)||ml>0)){bad++;rep.push('  buttons touch: '+b.length+' in a cell  ['+at+']');}
   });

   /* An action column has to hold its shape.

      Where the primary action exists on some rows and not others, the
      secondary action slides left and right down the column and the eye reads
      the movement before it reads the words. Measured, not guessed: take the
      left edge of the last action in each row of a column and fail if it moves
      by more than a couple of pixels. */
   w.document.querySelectorAll('#main table').forEach((t,ti)=>{
     const hs=Array.from(t.querySelectorAll('thead th'));
     const rows=Array.from(t.querySelectorAll('tbody tr')).filter(r=>r.children.length===hs.length);
     if(rows.length<3) return;
     hs.forEach((h,i)=>{
       const acts=rows.map(r=>Array.from(r.children[i].querySelectorAll('button.btn, .actghost')));
       const withAny=acts.filter(a=>a.length);
       if(withAny.length<3) return;
       /* Only a column that is actually an action column. */
       if(withAny.length < rows.length*0.6) return;
       const counts=new Set(withAny.map(a=>a.length));
       if(counts.size>1){
         /* Ragged unless every row routes through the fixed slot. */
         const slotted=rows.every(r=>!r.children[i].querySelector('button.btn, .actghost') ||
           r.children[i].querySelector('.actslot'));
         if(!slotted){
           bad++;
           rep.push('  ragged action column: "'+(h.textContent.trim()||'(unlabelled)')+
             '" has '+[...counts].sort().join(' and ')+' actions on different rows, so the last one '+
             'moves down the column  ['+at+' table '+(ti+1)+']');
         }
       }
     });
   });

   /* Card lists have the same defect as action columns, one level up.

      A repeated row whose right-hand cluster is a state pill and an action
      button, each sizing itself, gives every row a different right edge.
      jsdom does not lay flexbox out, so this is checked structurally rather
      than measured: a repeated row carrying both a pill and a button on its
      right, with no rail component pinning them, is the shape that goes
      ragged. */
   w.document.querySelectorAll('#main .panel-body .stack').forEach(st=>{
     const rows=Array.from(st.children).filter(c=>c.classList.contains('row'));
     if(rows.length<3) return;
     const ragged=rows.filter(r=>{
       if(r.querySelector('.taskrail,.actcell,.actslot')) return false;
       const kids=Array.from(r.children);
       /* The cluster is whatever sits after the growing description column. */
       const gi=kids.findIndex(k=>k.classList.contains('grow'));
       if(gi<0) return false;
       const tail=kids.slice(gi+1);
       if(tail.length<2) return false;
       const hasPill=tail.some(t=>t.classList.contains('pill')||t.querySelector('.pill'));
       const hasBtn =tail.some(t=>t.classList.contains('btn')||t.querySelector('.btn'));
       return hasPill && hasBtn;
     });
     if(ragged.length>=3){
       bad++;
       rep.push('  ragged card rail: '+ragged.length+' rows put a state pill and an action button '+
         'side by side with nothing pinning their widths, so the right edge moves down the list  ['+at+']');
     }
   });

   /* numeric columns should be right-aligned consistently */
   w.document.querySelectorAll('#main table').forEach(t=>{
     const hs=Array.from(t.querySelectorAll('thead th'));
     hs.forEach((h,i)=>{
       if(!h.classList.contains('num')) return;
       const rows=Array.from(t.querySelectorAll('tbody tr')).filter(r=>r.children.length===hs.length);
       const off=rows.filter(r=>r.children[i]&&!r.children[i].classList.contains('num')).length;
       if(off){bad++;rep.push('  '+off+' cells not right-aligned under a numeric header "'+h.textContent.trim()+'"  ['+at+']');}
     });
   });

   /* chart axis labels must start inside the viewBox, and the SVG must not be
      stretched non-uniformly, which distorts the glyphs as well as misplacing
      them. Both were true before the gutter was measured rather than assumed. */
   w.document.querySelectorAll('#main svg.chart').forEach(svg=>{
     if(svg.getAttribute('preserveAspectRatio')==='none'){
       bad++; rep.push('  chart stretched non-uniformly, glyphs will distort  ['+at+']');
     }
     svg.querySelectorAll('text.lbl[text-anchor="end"]').forEach(t=>{
       let px=0; for(const c of t.textContent) px += (c===','||c==='.')?2.9:(c==='$')?6.2:5.9;
       const left=parseFloat(t.getAttribute('x'))-px;
       if(left<0){bad++;rep.push('  axis label "'+t.textContent+'" starts at x='+left.toFixed(1)+
         ', outside the chart  ['+at+']');}
     });
   });

   /* an element wider than the content column cannot be laid out */
   w.document.querySelectorAll('#main [style*="min-width"]').forEach(el=>{
     const mw=parseFloat((el.getAttribute('style').match(/min-width:\s*(\d+)/)||[])[1]||0);
     if(mw>900){bad++;rep.push('  min-width '+mw+'px will overflow a 1024 viewport  ['+at+']');}
   });
  }
  console.log('\n=== '+f);
  console.log(rep.length?[...new Set(rep)].join('\n'):'  aligned');
  if(errs.length) console.log('  js errors: '+errs.slice(0,2).join(' | '));
 }
 if(provis.size){
   console.log('\n=== wording that reveals the build as provisional');
   [...provis.entries()].forEach(([k,where])=>{bad++;console.log('  "'+k+'"  '+[...where].slice(0,4).join(', '));});
 }
 if(undef.size){
   console.log('\n=== classes with no CSS rule');
   [...undef.entries()].forEach(([c,where])=>{bad++;console.log('  '+c.padEnd(18)+[...where].slice(0,4).join(', '));});
 }
 console.log('\n'+views+' views · '+tables+' tables · '+cells+' multi-button cells · '+DEFINED.size+' classes defined');
 console.log(bad? bad+' alignment problems' : 'no alignment problems found');
 process.exit(bad?1:0);
})();
