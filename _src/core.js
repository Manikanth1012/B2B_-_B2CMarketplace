/* ===========================================================================
   6D ONE UI — application runtime for the Enterprise Self-Care prototype.
   No framework, no CDN. Everything runs from this file.
   =========================================================================== */

/* ------------------------------- helpers -------------------------------- */
const $  = (s,r)=> (r||document).querySelector(s);
const $$ = (s,r)=> Array.prototype.slice.call((r||document).querySelectorAll(s));
const esc = s => String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

const FMT = {
  num  : n => n==null ? null : n.toLocaleString('en-US'),
  dec  : (n,d)=> n==null ? null : n.toLocaleString('en-US',{minimumFractionDigits:d,maximumFractionDigits:d}),
  money: (n,cur)=> n==null ? null : (cur||'$') + Math.abs(n).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}),
  money0:(n,cur)=> n==null ? null : (cur||'$') + Math.round(n).toLocaleString('en-US'),
  gb   : n => n==null ? null : (n>=1024 ? (n/1024).toFixed(2)+' TB' : n.toFixed(n<10?2:1)+' GB'),
  pct  : n => n==null ? null : n.toFixed(n<10?1:0)+'%',
  mins : n => n==null ? null : (n>=60 ? Math.floor(n/60)+'h '+(n%60)+'m' : n+'m'),
  date : s => s,
  initials: name => name.split(/\s+/).slice(0,2).map(w=>w[0]).join('').toUpperCase()
};

/* Contract rule 9: absent telemetry is declared, never fabricated, never zero. */
function NA(reason){ return '<span class="nodata" title="'+esc(reason||'No measurement available')+'">'+esc(reason||'Unavailable')+'</span>'; }
function NOTMEASURED(){ return NA('Not measured'); }

const PILL = {
  active:      ['success','check','Active'],
  online:      ['success','check','Online'],
  paid:        ['success','check','Paid'],
  approved:    ['success','check','Approved'],
  resolved:    ['success','check','Resolved'],
  completed:   ['success','check','Completed'],
  suspended:   ['warning','pause','Suspended'],
  degraded:    ['warning','tri','Degraded'],
  pending:     ['warning','clock','Pending'],
  overdue:     ['danger','bang','Overdue'],
  down:        ['danger','cross','Down'],
  breached:    ['danger','bang','SLA breached'],
  rejected:    ['danger','cross','Rejected'],
  terminated:  ['neutral','dash','Terminated'],
  inactive:    ['neutral','dash','Inactive'],
  neutral:     ['neutral','dash',''],
  draft:       ['neutral','ring','Draft'],
  open:        ['info','dot','Open'],
  inprogress:  ['info','play','In progress'],
  scheduled:   ['info','clock','Scheduled'],
  stale:       ['stale','clock','Stale'],
  partial:     ['partial','half','Partial'],
  unavailable: ['neutral','ring','Unavailable'],
  ai:          ['ai','sparkle','AI']
};
/* ---------------------------------------------------------------------------
   Theme.

   A preference, not a setting buried three screens deep. It starts from what
   the operating system already says the person wants, and once they choose
   for themselves that choice wins and is remembered — asking again every time
   is how a preference stops being one.
   --------------------------------------------------------------------------- */
const THEME = {
  key:'nim.theme',
  modes:[{id:'light', label:'Light', icon:'sun'},
         {id:'dark',  label:'Dark',  icon:'moon'}],
  osPrefers(){
    try{ return (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches)
      ? 'dark' : 'light'; }catch(e){ return 'light'; }
  },
  stored(){
    try{ return window.localStorage ? window.localStorage.getItem(this.key) : null; }catch(e){ return null; }
  },
  /* A console that has no switch must not silently follow the operating
     system, or it goes dark with nothing to turn it back. */
  locked:false,
  current(){ if(this.locked) return 'light';
    const v=this.stored(); return (v==='dark'||v==='light') ? v : this.osPrefers(); },
  /* True while the person has not chosen, which is what lets the app keep
     following the operating system if they change it there. */
  isAuto(){ return !this.stored(); },
  apply(mode){
    const m=(mode==='dark')?'dark':'light';
    document.documentElement.setAttribute('data-theme', m);
    return m;
  },
  set(mode){
    const m=this.apply(mode);
    try{ if(window.localStorage) window.localStorage.setItem(this.key, m); }catch(e){}
    const b=document.getElementById('themeBtn');
    if(b) b.outerHTML=THEME.button();
    if(typeof toast==='function')
      toast(m==='dark'?'Dark theme on':'Light theme on');
    return m;
  },
  toggle(){ return this.set(this.current()==='dark'?'light':'dark'); },
  init(){
    this.apply(this.current());
    /* Only follow the system while it has not been overridden. */
    try{
      const mq=window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)');
      if(mq && mq.addEventListener)
        mq.addEventListener('change', e=>{ if(THEME.isAuto()){ THEME.apply(e.matches?'dark':'light');
          const b=document.getElementById('themeBtn'); if(b) b.outerHTML=THEME.button(); } });
    }catch(e){}
  },
  button(){
    const m=this.current(), next=m==='dark'?'light':'dark';
    return '<button class="iconbtn" id="themeBtn" onclick="THEME.toggle()" '+
      'aria-label="Switch to the '+next+' theme. Currently '+m+'." '+
      'title="Switch to the '+next+' theme">'+ICO(m==='dark'?'sun':'moon',17)+'</button>';
  }
};
THEME.init();

function pill(key,labelOverride){
  const p = PILL[key] || PILL.unavailable;
  return '<span class="pill pill-'+p[0]+'">'+SH(p[1])+esc(labelOverride||p[2])+'</span>';
}

/* Partner tiers are a category, not a state — their own colours and shapes so
   they never read as good/bad. */
const TIERS = {
  Platinum:['platinum','star'], Gold:['gold','diamond'],
  Silver:['silver','hex'],      Bronze:['bronze','square']
};
function tierPill(tier){
  const t = TIERS[tier] || ['silver','hex'];
  return '<span class="tier tier-'+t[0]+'">'+SH(t[1])+esc(tier)+'</span>';
}

/* Capacity meter — level is carried by pattern + numeric label, not colour alone. */
function meter(pct, label, opts){
  opts = opts||{};
  if(pct==null) return '<div class="meterline"><div class="meter lvl-unavailable"></div><span class="mv">'+esc(opts.naLabel||'n/a')+'</span></div>';
  const lvl = pct>=90 ? 'lvl-danger' : pct>=75 ? 'lvl-warning' : '';
  return '<div class="meterline"><div class="meter '+lvl+'" role="meter" aria-valuenow="'+Math.round(pct)+'" aria-valuemin="0" aria-valuemax="100">'+
         '<span style="width:'+Math.min(100,pct)+'%"></span></div><span class="mv">'+esc(label!=null?label:FMT.pct(pct))+'</span></div>';
}

function delta(v,unit,invert){
  if(v==null) return '<span class="delta flat">'+NOTMEASURED()+'</span>';
  const good = invert ? v<0 : v>0;
  const cls = v===0 ? 'flat' : good ? 'up' : 'down';
  const gl  = v===0 ? 'right' : v>0 ? 'up' : 'down';
  return '<span class="delta '+cls+'">'+SH(gl,11)+Math.abs(v)+(unit||'%')+'</span>';
}

function metric(cfg){
  const val = cfg.value==null
    ? '<div class="m-value unavailable">'+esc(cfg.naLabel||'Not measured')+'</div>'
    : '<div class="m-value">'+cfg.value+'</div>';
  return '<div class="metric">'+
    '<div class="m-label">'+(cfg.icon?ICO(cfg.icon,14):'')+esc(cfg.label)+'</div>'+
    val+
    (cfg.foot?'<div class="m-foot">'+cfg.foot+'</div>':'')+
  '</div>';
}

function stateBlock(kind,title,body,action){
  const ico = {empty:'inbox',filtered:'filter',error:'alert',forbidden:'lock',unavailable:'eyeoff',loading:'refresh'}[kind]||'info';
  return '<div class="state state-'+kind+'"><div class="state-ico">'+ICO(ico,20)+'</div>'+
    '<h4>'+esc(title)+'</h4><p>'+body+'</p>'+(action?'<div class="state-act">'+action+'</div>':'')+'</div>';
}

/* A banner carries the sentence that says WHY a screen behaves as it does. It
   is the part somebody actually reads, so leaving it in English is the most
   visible kind of half-translated. Whole literals resolve here; fragments
   concatenated with a live number are wrapped at the call site. */
function banner(kind,html,icon){
  return '<div class="banner banner-'+kind+'">'+ICO(icon||(kind==='danger'?'alert':kind==='warning'?'warning':kind==='stale'?'clock':'info'),15)+
         '<div class="grow">'+html+'</div></div>';
}

/* --------------------------------- toasts -------------------------------- */
function toast(msg,kind){
  let host=$('.toasts'); if(!host){host=document.createElement('div');host.className='toasts';document.body.appendChild(host);}
  const k = kind||'ok';
  const el=document.createElement('div'); el.className='toast '+k; el.setAttribute('role','status');
  el.innerHTML = ICO(k==='err'?'alert':k==='warn'?'warning':'checkcircle',15)+'<span>'+esc(msg)+'</span>';
  host.appendChild(el);
  setTimeout(()=>{el.style.opacity='0';el.style.transition='opacity .25s';setTimeout(()=>el.remove(),260);},3200);
}

/* ------------------------- modal / inspector plumbing -------------------- */
let _lastFocus=null;
function openModal(html,opts){
  opts=opts||{};
  closeModal(true);
  _lastFocus = document.activeElement;
  const scrim=document.createElement('div'); scrim.className='scrim'; scrim.id='modalScrim';
  const m=document.createElement('div'); m.className='modal'+(opts.wide?' wide':''); m.id='modalHost';
  m.setAttribute('role','dialog'); m.setAttribute('aria-modal','true'); m.setAttribute('aria-label',opts.label||'Dialog');
  m.innerHTML=html;
  document.body.appendChild(scrim); document.body.appendChild(m);
  scrim.addEventListener('click',()=>closeModal());
  const f = m.querySelector('[data-autofocus]') || m.querySelector('button,input,select,textarea');
  if(f) f.focus();
  m.addEventListener('keydown',trapTab);
}
function trapTab(e){
  if(e.key!=='Tab') return;
  const f=$$('button,input,select,textarea,a[href],[tabindex]:not([tabindex="-1"])',e.currentTarget).filter(x=>!x.disabled&&x.offsetParent!==null);
  if(!f.length) return;
  const first=f[0], last=f[f.length-1];
  if(e.shiftKey && document.activeElement===first){e.preventDefault();last.focus();}
  else if(!e.shiftKey && document.activeElement===last){e.preventDefault();first.focus();}
}
function closeModal(silent){
  const m=$('#modalHost'), s=$('#modalScrim');
  if(m) m.remove(); if(s) s.remove();
  if(!silent && _lastFocus && _lastFocus.focus) _lastFocus.focus();   /* focus restoration */
}
document.addEventListener('keydown',e=>{
  if(e.key==='Escape'){ if($('#modalHost')) closeModal(); else if($('#inspector') && !$('#inspector').hidden) closeInspector(); }
  if((e.key==='/'||(e.key==='k'&&(e.metaKey||e.ctrlKey))) && !/^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName)){
    const g=$('#gsearchInput'); if(g){e.preventDefault();g.focus();}
  }
});

/* Risk-appropriate confirmation: impact context is mandatory for lifecycle actions. */
function confirmAction(cfg){
  const danger = cfg.risk==='high';
  openModal(
    '<div class="modal-head">'+ICO(danger?'warning':'info',18)+
      '<div class="grow"><h3 class="t-sub">'+esc(cfg.title)+'</h3>'+
      '<div class="t-small muted" style="margin-top:2px">'+esc(cfg.subtitle||'')+'</div></div>'+
      '<button class="iconbtn" onclick="closeModal()" aria-label="Close">'+ICO('x',16)+'</button></div>'+
    '<div class="modal-body stack">'+
      (cfg.body||'')+
      '<div class="impact'+(danger?' impact-danger':'')+'"><strong>'+esc(cfg.impactTitle||'What this changes')+'</strong>'+
        '<ul>'+(cfg.impact||[]).map(i=>'<li>'+i+'</li>').join('')+'</ul></div>'+
      (cfg.requireType?'<div class="field"><label for="cfmType">Type <strong>'+esc(cfg.requireType)+'</strong> to confirm</label>'+
        '<input class="inp" id="cfmType" autocomplete="off" oninput="document.getElementById(\'cfmGo\').disabled = this.value!==\''+esc(cfg.requireType)+'\'"></div>':'')+
      '<div id="cfmErr"></div>'+
    '</div>'+
    '<div class="modal-foot"><span class="t-tiny muted grow">'+esc(cfg.footNote||'')+'</span>'+
      '<button class="btn btn-quiet" onclick="closeModal()">Cancel</button>'+
      '<button class="btn '+(danger?'btn-danger':'btn-primary')+'" id="cfmGo" '+(cfg.requireType?'disabled':'')+' data-autofocus>'+esc(cfg.confirmLabel||'Confirm')+'</button></div>',
    {label:cfg.title}
  );
  /* Snapshot what the person typed BEFORE the dialog is removed, otherwise the
     handler reads a detached DOM and silently discards their input. */
  $('#cfmGo').onclick = ()=>{
    const host=$('#modalHost'), vals={};
    if(host) $$('input,select,textarea',host).forEach(el=>{
      if(!el.id || el.id==='cfmType') return;
      vals[el.id] = el.type==='checkbox' ? el.checked : el.value;
    });
    /* Validation runs while the dialog is still open. Closing first and then
       discovering the input was wrong throws away everything the person typed
       and leaves them with a toast and an empty screen. */
    if(cfg.validate){
      const err = cfg.validate(vals);
      if(err){
        const box=$('#cfmErr');
        if(box) box.innerHTML = banner('danger', err);
        return;
      }
    }
    closeModal();
    if(cfg.onConfirm) cfg.onConfirm(vals);
  };
}

function openInspector(html,label){
  let s=$('#inspScrim'), i=$('#inspector');
  if(!s){s=document.createElement('div');s.className='scrim';s.id='inspScrim';document.body.appendChild(s);s.addEventListener('click',closeInspector);}
  if(!i){i=document.createElement('aside');i.id='inspector';i.className='inspector';i.setAttribute('role','dialog');i.setAttribute('aria-modal','false');document.body.appendChild(i);}
  i.setAttribute('aria-label',label||'Details');
  i.innerHTML=html; i.hidden=false; s.hidden=false;
  const f=i.querySelector('button'); if(f) f.focus();
}
function closeInspector(){ const i=$('#inspector'),s=$('#inspScrim'); if(i)i.hidden=true; if(s)s.hidden=true; }

/* --------------------------------- charts -------------------------------- */
/* Hand-drawn SVG. Nothing external. Missing series render as a declared gap. */
const CH = {
  /* The left gutter has to fit the widest Y label. Hard-coding it meant
     "$302,577" rendered at a negative x and crept out over the card edge.
     Measured from the formatted strings at the .lbl font size (10px), which
     is an estimate, but an estimate that adapts beats a constant that cannot. */
  _gutter(max,fmt,floor){
    let w=0;
    for(let i=0;i<=4;i++){
      const t=String(fmt?fmt(max*i/4):Math.round(max*i/4));
      let px=0;
      for(let c=0;c<t.length;c++){
        const ch=t[c];
        px += (ch===','||ch==='.') ? 2.9 : (ch==='$'||ch==='€'||ch==='£') ? 6.2 : 5.9;
      }
      if(px>w) w=px;
    }
    return Math.max(floor||34, Math.ceil(w)+10);
  },
  bars(data,opts){
    opts=opts||{};
    if(!data || !data.length) return '<div class="chart-empty">'+esc(opts.naLabel||'Not measured for this period')+'</div>';
    const W=opts.w||640,H=opts.h||180,PR=10,PT=10,PB=24;
    const max=opts.max || Math.max.apply(null,data.map(d=>d.v||0))*1.15 || 1;
    const PL=CH._gutter(max,opts.fmt,34);
    const iw=W-PL-PR, ih=H-PT-PB, bw=Math.max(4,(iw/data.length)*0.58);
    let g='';
    for(let i=0;i<=4;i++){const y=PT+ih-(ih*i/4);
      g+='<line class="gridline" x1="'+PL+'" y1="'+y+'" x2="'+(W-PR)+'" y2="'+y+'"/>'+
         '<text class="lbl" x="'+(PL-6)+'" y="'+(y+3)+'" text-anchor="end">'+esc(opts.fmt?opts.fmt(max*i/4):Math.round(max*i/4))+'</text>';}
    let b='';
    data.forEach((d,i)=>{
      const x=PL+(iw/data.length)*i+((iw/data.length)-bw)/2;
      if(d.v==null){ b+='<rect x="'+x+'" y="'+PT+'" width="'+bw+'" height="'+ih+'" fill="url(#hatch)" opacity=".55"><title>'+esc(d.l)+': not measured</title></rect>'; }
      else{ const h=Math.max(1,ih*(d.v/max)), y=PT+ih-h;
        b+='<rect class="bar'+(d.alt?' alt':'')+'" x="'+x+'" y="'+y+'" width="'+bw+'" height="'+h+'" rx="2"><title>'+esc(d.l)+': '+esc(opts.tip?opts.tip(d.v):d.v)+'</title></rect>'; }
      b+='<text class="lbl" x="'+(x+bw/2)+'" y="'+(H-8)+'" text-anchor="middle">'+esc(d.l)+'</text>';
    });
    /* No preserveAspectRatio="none": stretching the box horizontally stretches
       the glyphs with it, which is why the axis labels looked wrong as well as
       misplaced. */
    return '<svg class="chart" viewBox="0 0 '+W+' '+H+'" role="img" aria-label="'+esc(opts.aria||'Bar chart')+'">'+
      '<defs><pattern id="hatch" width="6" height="6" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">'+
      '<rect width="6" height="6" fill="#F0F0F0"/><line x1="0" y1="0" x2="0" y2="6" stroke="#D8D8D8" stroke-width="3"/></pattern></defs>'+
      g+b+'<line class="axis" x1="'+PL+'" y1="'+(PT+ih)+'" x2="'+(W-PR)+'" y2="'+(PT+ih)+'"/></svg>';
  },
  line(series,opts){
    opts=opts||{};
    const first=series&&series[0];
    if(!first || !first.pts || !first.pts.length) return '<div class="chart-empty">'+esc(opts.naLabel||'Not measured for this period')+'</div>';
    const W=opts.w||640,H=opts.h||190,PR=12,PT=12,PB=24;
    let max=0; series.forEach(s=>s.pts.forEach(p=>{ if(p.v!=null && p.v>max) max=p.v; }));
    max = (opts.max||max*1.18)||1;
    const PL=CH._gutter(max,opts.fmt,36);
    const n=first.pts.length, iw=W-PL-PR, ih=H-PT-PB;
    const X=i=> PL + (n===1?iw/2:iw*i/(n-1));
    const Y=v=> PT + ih - ih*(v/max);
    let g='';
    for(let i=0;i<=4;i++){const y=PT+ih-(ih*i/4);
      g+='<line class="gridline" x1="'+PL+'" y1="'+y+'" x2="'+(W-PR)+'" y2="'+y+'"/>'+
         '<text class="lbl" x="'+(PL-6)+'" y="'+(y+3)+'" text-anchor="end">'+esc(opts.fmt?opts.fmt(max*i/4):Math.round(max*i/4))+'</text>';}
    let paths='',pts='';
    series.forEach((s,si)=>{
      let d='',open=false;
      s.pts.forEach((p,i)=>{ if(p.v==null){open=false;return;} d += (open?'L':'M')+X(i)+' '+Y(p.v)+' '; open=true; });
      paths += '<path class="'+(si===0?'lineA':'lineB')+'" d="'+d.trim()+'"/>';
      if(si===0) s.pts.forEach((p,i)=>{ if(p.v==null) return;
        pts += '<circle class="pt" cx="'+X(i)+'" cy="'+Y(p.v)+'" r="3"><title>'+esc(p.l)+': '+esc(opts.tip?opts.tip(p.v):p.v)+'</title></circle>'; });
    });
    let xl='';
    first.pts.forEach((p,i)=>{ if(n>12 && i%2) return; xl+='<text class="lbl" x="'+X(i)+'" y="'+(H-8)+'" text-anchor="middle">'+esc(p.l)+'</text>'; });
    return '<svg class="chart" viewBox="0 0 '+W+' '+H+'" role="img" aria-label="'+esc(opts.aria||'Line chart')+'">'+
      g+paths+pts+xl+'<line class="axis" x1="'+PL+'" y1="'+(PT+ih)+'" x2="'+(W-PR)+'" y2="'+(PT+ih)+'"/></svg>';
  },
  stack(rows,opts){
    opts=opts||{};
    if(!rows||!rows.length) return '<div class="chart-empty">'+esc(opts.naLabel||'Not measured')+'</div>';
    const colors=opts.colors||['#0099FF','#7FCBFF','#B9E2FF','#DCEFFB','#EDF7FE'];
    const max=Math.max.apply(null,rows.map(r=>r.parts.reduce((a,b)=>a+b,0)))||1;
    return '<div class="stack" style="gap:9px">'+rows.map(r=>{
      let acc=0;
      const seg=r.parts.map((v,i)=>{const w=(v/max)*100;acc+=v;
        return '<span style="display:block;height:100%;width:'+w+'%;background:'+colors[i%colors.length]+'" title="'+esc((opts.names&&opts.names[i])||'')+': '+esc(opts.fmt?opts.fmt(v):v)+'"></span>';}).join('');
      return '<div><div class="row" style="gap:8px;margin-bottom:3px"><span class="t-small grow" style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+esc(r.label)+'</span>'+
        '<span class="t-tiny t-num muted">'+esc(opts.fmt?opts.fmt(acc):acc)+'</span></div>'+
        '<div style="display:flex;height:9px;border-radius:3px;overflow:hidden;background:var(--nim-surface-100);border:1px solid var(--nim-line-100)">'+seg+'</div></div>';
    }).join('')+'</div>';
  },
  donut(parts,opts){
    opts=opts||{};
    const total=parts.reduce((a,p)=>a+p.v,0);
    if(!total) return '<div class="chart-empty">'+esc(opts.naLabel||'Not measured')+'</div>';
    const colors=opts.colors||['#0099FF','#7FCBFF','#B9E2FF','#8D8D8D','#DCDCDC'];
    const R=54,C=2*Math.PI*R; let off=0;
    const rings=parts.map((p,i)=>{
      const len=C*(p.v/total);
      const s='<circle cx="70" cy="70" r="'+R+'" fill="none" stroke="'+colors[i%colors.length]+'" stroke-width="18" '+
        'stroke-dasharray="'+len+' '+(C-len)+'" stroke-dashoffset="'+(-off)+'" transform="rotate(-90 70 70)"><title>'+esc(p.l)+': '+esc(opts.fmt?opts.fmt(p.v):p.v)+'</title></circle>';
      off+=len; return s;
    }).join('');
    return '<div class="row" style="gap:16px;align-items:center"><svg width="140" height="140" viewBox="0 0 140 140" role="img" aria-label="'+esc(opts.aria||'Breakdown')+'">'+
      rings+'<text x="70" y="66" text-anchor="middle" style="font-size:17px;font-weight:600;fill:#1D1D1D">'+esc(opts.centre||'')+'</text>'+
      '<text x="70" y="82" text-anchor="middle" style="font-size:10px;fill:#666">'+esc(opts.centreSub||'')+'</text></svg>'+
      '<div class="stack" style="gap:6px;flex:1 1 auto;min-width:0">'+parts.map((p,i)=>
        '<div class="row" style="gap:7px"><i style="width:9px;height:9px;border-radius:2px;background:'+colors[i%colors.length]+';flex:0 0 auto"></i>'+
        '<span class="t-small grow" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+esc(p.l)+'</span>'+
        '<span class="t-small t-num strong">'+esc(opts.fmt?opts.fmt(p.v):p.v)+'</span></div>').join('')+'</div></div>';
  },
  spark(vals,opts){
    opts=opts||{};
    if(!vals||!vals.length||vals.every(v=>v==null)) return '<span class="nodata">Not measured</span>';
    const W=opts.w||90,H=opts.h||22,max=Math.max.apply(null,vals.filter(v=>v!=null))||1,min=0;
    const d=vals.map((v,i)=>(v==null?null:(i*(W/(vals.length-1)))+' '+(H-2-((v-min)/(max-min||1))*(H-4)))).filter(Boolean);
    return '<svg width="'+W+'" height="'+H+'" viewBox="0 0 '+W+' '+H+'" aria-hidden="true"><polyline fill="none" stroke="'+
      (opts.color||'#0099FF')+'" stroke-width="1.6" stroke-linejoin="round" points="'+d.join(' ')+'"/></svg>';
  }
};

/* ------------------------------- data table ------------------------------ */
/* Sorting, text search, chip filters, pagination, row selection, empty vs
   filtered-empty distinction. One instance per table on a view. */
class DataTable{
  constructor(cfg){
    this.cfg=cfg;
    this.rows=cfg.rows||[];
    this.sortKey=cfg.sortKey||null;
    this.sortDir=cfg.sortDir||'asc';
    this.q='';
    this.filters={};
    this.page=1;
    this.pageSize=cfg.pageSize||12;
    this.id=cfg.id||('dt'+Math.random().toString(36).slice(2,8));
    DataTable.reg[this.id]=this;
  }
  visible(){
    let r=this.rows.slice();
    if(this.q){
      const q=this.q.toLowerCase();
      r=r.filter(x=>(this.cfg.searchFields||Object.keys(x)).some(f=>String(x[f]==null?'':x[f]).toLowerCase().includes(q)));
    }
    Object.keys(this.filters).forEach(k=>{
      const v=this.filters[k]; if(v==null||v==='') return;
      /* Some filters are not a plain field match — a partner belongs to several
         marketplaces, so the table declares how to test that key. */
      const fn=(this.cfg.filterFns||{})[k];
      r = fn ? r.filter(x=>fn(x,v)) : r.filter(x=>String(x[k])===String(v));
    });
    if(this.sortKey){
      const k=this.sortKey,dir=this.sortDir==='asc'?1:-1;
      r.sort((a,b)=>{
        let A=a[k],B=b[k];
        if(A==null&&B==null) return 0; if(A==null) return 1; if(B==null) return -1;
        if(typeof A==='number'&&typeof B==='number') return (A-B)*dir;
        return String(A).localeCompare(String(B))*dir;
      });
    }
    return r;
  }
  html(){
    const c=this.cfg, all=this.visible();
    const pages=Math.max(1,Math.ceil(all.length/this.pageSize));
    if(this.page>pages) this.page=pages;
    const rows=all.slice((this.page-1)*this.pageSize,this.page*this.pageSize);
    const filtering = !!this.q || Object.keys(this.filters).some(k=>this.filters[k]);

    let tool='';
    if(c.toolbar!==false){
      tool='<div class="tbl-toolbar">'+
        '<div class="gsearch" style="width:250px;margin:0;position:relative">'+ICO('search',14)+
        '<input class="inp" style="padding-left:30px" placeholder="'+esc(c.searchPlaceholder||'Search')+'" value="'+esc(this.q)+'" '+
        'oninput="DataTable.reg[\''+this.id+'\'].setQ(this.value)" aria-label="'+esc(c.searchPlaceholder||'Search')+'"></div>'+
        (c.chips||[]).map(g=>'<div class="row" style="gap:5px">'+g.options.map(o=>
          '<button class="filterchip" aria-pressed="'+(String(this.filters[g.key])===String(o.value))+'" '+
          'onclick="DataTable.reg[\''+this.id+'\'].toggleFilter(\''+g.key+'\',\''+esc(o.value)+'\')">'+esc(o.label)+
          (o.count!=null?'<span class="t-num muted">'+o.count+'</span>':'')+'</button>').join('')+'</div>').join('')+
        '<div class="spacer"></div>'+
        (filtering?'<button class="btn btn-sm btn-quiet" onclick="DataTable.reg[\''+this.id+'\'].clear()">'+ICO('x',13)+'Clear filters</button>':'')+
        (c.actions||'')+
      '</div>';
    }

    let body;
    if(!this.rows.length){
      body = stateBlock('empty', c.emptyTitle||'Nothing here yet', c.emptyBody||'Records will appear once they exist on this account.', c.emptyAction||'');
    } else if(!all.length){
      body = stateBlock('filtered','No matches for the current filters',
        'Your search and filters exclude all '+this.rows.length+' records. Adjust or clear them to see results.',
        '<button class="btn btn-sm" onclick="DataTable.reg[\''+this.id+'\'].clear()">'+'Clear filters'+'</button>');
    } else {
      body='<div class="tablewrap"><table class="tbl"><thead><tr>'+
        c.columns.map(col=>{
          const sortable=col.sort!==false;
          const isSorted=this.sortKey===col.key;
          return '<th class="'+(col.align==='right'?'num ':'')+(sortable?'sortable':'')+'" '+
            (isSorted?'aria-sort="'+(this.sortDir==='asc'?'ascending':'descending')+'"':'')+
            (col.width?' style="width:'+col.width+'"':'')+
            (sortable?' onclick="DataTable.reg[\''+this.id+'\'].sort(\''+col.key+'\')" tabindex="0" onkeydown="if(event.key===\'Enter\'||event.key===\' \'){event.preventDefault();DataTable.reg[\''+this.id+'\'].sort(\''+col.key+'\')}"':'')+
            '>'+esc(col.label)+(sortable
              ? '<span class="sortglyph">'+(isSorted?SH(this.sortDir==='asc'?'up':'down',10):SH('bars',10))+'</span>'
              : '')+'</th>';
        }).join('')+'</tr></thead><tbody>'+
        rows.map((r,i)=>'<tr '+(c.onRow?'style="cursor:pointer" tabindex="0" onclick="'+c.onRow.replace('$ID',esc(r[c.idKey||'id']))+'" onkeydown="if(event.key===\'Enter\'){'+c.onRow.replace('$ID',esc(r[c.idKey||'id']))+'}"':'')+'>'+
          c.columns.map(col=>'<td class="'+(col.align==='right'?'num':'')+(col.key==='__acts'?' acts':'')+'">'+(col.render?col.render(r,i):esc(r[col.key]))+'</td>').join('')+
        '</tr>').join('')+'</tbody></table></div>';
    }

    const foot = all.length ? '<div class="tbl-foot"><span>Showing '+((this.page-1)*this.pageSize+1)+'–'+Math.min(all.length,this.page*this.pageSize)+
      ' of '+all.length+(filtering?' filtered':'')+' '+esc(c.noun||'records')+'</span>'+
      (filtering?'<span class="pill pill-info">'+SH('dot')+'Filtered view</span>':'')+
      '<div class="spacer"></div>'+
      '<button class="btn btn-sm btn-quiet" '+(this.page<=1?'disabled':'')+' onclick="DataTable.reg[\''+this.id+'\'].go(-1)" aria-label="Previous page">'+ICO('chevleft',13)+'</button>'+
      '<span class="t-num">Page '+this.page+' of '+pages+'</span>'+
      '<button class="btn btn-sm btn-quiet" '+(this.page>=pages?'disabled':'')+' onclick="DataTable.reg[\''+this.id+'\'].go(1)" aria-label="Next page">'+ICO('chevright',13)+'</button></div>' : '';

    return '<div id="'+this.id+'_host" data-dt="'+this.id+'">'+tool+body+foot+'</div>';
  }
  redraw(){ const h=document.getElementById(this.id+'_host'); if(h) h.outerHTML=this.html(); }
  setQ(v){ this.q=v; this.page=1; this.redraw(); const i=document.querySelector('#'+this.id+'_host input'); if(i){i.focus();i.setSelectionRange(v.length,v.length);} }
  setFilter(k,v){ this.filters[k]=v; this.page=1; this.redraw(); }
  toggleFilter(k,v){ this.filters[k]= String(this.filters[k])===String(v) ? null : v; this.page=1; this.redraw(); }
  clear(){ this.q=''; this.filters={}; this.page=1; this.redraw(); }
  sort(k){ if(this.sortKey===k) this.sortDir=this.sortDir==='asc'?'desc':'asc'; else {this.sortKey=k;this.sortDir='asc';} this.redraw(); }
  go(d){ this.page+=d; this.redraw(); }
}
DataTable.reg={};

/* ------------------------------- application ----------------------------- */
const App = {
  cfg:null, view:null,
  init(cfg){
    this.cfg=cfg;
    if(cfg.theme===false){ THEME.locked=true; THEME.apply('light'); }
    else THEME.apply(THEME.current());
    document.title = cfg.product+' — '+cfg.persona.role;
    /* The gate is real: nothing behind it renders until a session exists.
       Rendering the shell and hiding it with CSS would put every record in
       the page for anyone who opens the inspector. */
    if(typeof AUTH!=='undefined' && !AUTH.signedIn && cfg.authGate!==false){ this.renderLogin(); return; }
    this.enterApp();
  },
  enterApp(){
    const cfg=this.cfg;
    this.renderShell();
    const start = (location.hash||'').replace('#','') || cfg.nav[0].items[0].id;
    this.go(this.findView(start)?start:cfg.nav[0].items[0].id);
    if(!this._hashBound){
      this._hashBound=true;
      window.addEventListener('hashchange',()=>{const id=(location.hash||'').replace('#','');if(id&&id!==this.view)this.go(id);});
    }
  },
  renderLogin(){
    document.body.setAttribute('data-brand', this.cfg.brand||'neutral');
    document.body.innerHTML='<main id="main" class="loginshell">'+loginGate()+'</main>';
  },
  findView(id){ let f=null; this.cfg.nav.forEach(g=>g.items.forEach(i=>{if(i.id===id)f=i;})); return f; },
  renderShell(){
    const c=this.cfg;
    document.body.setAttribute('data-brand', c.brand||'neutral');
    document.body.innerHTML =
    '<a class="skip-link" href="#main">Skip to main content</a>'+
    '<div class="app">'+
      '<nav class="rail" aria-label="Primary">'+
        '<div class="rail-brand">'+
          /* Official 6D mark is loaded from the approved asset only. It is never
             reconstructed in text, CSS or SVG. Absent asset = empty slot. */
          (c.brand==='6d'
            ? '<img class="brand-mark" src="assets/brand/6d-logo-white.png" alt="6D Technologies">'+
              '<div class="brand-word">'+esc(c.product)+'</div>'
            : '<div><div class="brand-word">'+esc(c.product)+'</div>'+
              '<div class="brand-tier">'+esc(c.tier)+'</div></div>')+
        '</div>'+
        '<div class="rail-scroll">'+
          c.nav.map(g=>'<div class="nav-group"><div class="nav-group-label">'+esc(g.label)+'</div>'+
            g.items.map(i=>{
              const c = typeof i.count==='function' ? i.count() : i.count;
              return '<button class="nav-item" id="nav_'+i.id+'" onclick="App.go(\''+i.id+'\')">'+
              ICO(i.icon,16)+'<span class="nav-txt">'+esc(i.label)+'</span>'+
              (c!=null&&c!==0?'<span class="nav-count">'+c+'</span>':'')+'</button>';}).join('')+
          '</div>').join('')+
        '</div>'+
        '<div class="rail-foot">'+esc(c.footNote||'')+'</div>'+
      '</nav>'+
      '<div class="main">'+
        '<header class="topbar">'+
          '<div class="crumbs" id="crumbs"></div>'+
          '<div class="gsearch">'+ICO('search',14)+
            '<input id="gsearchInput" placeholder="Search '+esc(c.searchScope||'this account')+'" autocomplete="off" role="combobox" aria-expanded="false" aria-controls="gres" aria-label="Global search">'+
            '<kbd>/</kbd><div class="gres" id="gres" role="listbox" hidden></div>'+
          '</div>'+
          '<div class="envstate">'+
            '<span class="env-chip env-name" title="Deployment environment">'+esc(c.env||'Production')+'</span>'+
            '<button class="env-chip is-btn" id="freshChip" title="Data freshness — click to refresh" aria-label="Refresh data">'+
              '<span class="dot" aria-hidden="true"></span><span id="freshTxt">Live</span></button>'+
          '</div>'+
          (c.cart?'<button class="iconbtn" onclick="openCart()" aria-label="Open basket">'+ICO('package',17)+
            '<span class="bell-dot" id="cartCount" hidden style="width:auto;min-width:14px;height:14px;border-radius:7px;'+
            'font-size:9px;line-height:11px;color:#FFF;text-align:center;top:3px;right:2px;padding:0 3px">0</span></button>':'')+
          /* Help follows you. Asking somebody to leave the screen they are stuck
             on, and then search for its name, is how a knowledge base goes unread. */
          (c.theme===false?'':THEME.button())+
          '<button class="iconbtn" id="helpBtn" onclick="App.help()" aria-label="Help on this screen">'+ICO('info',17)+'</button>'+
          '<button class="iconbtn" onclick="App.notifications()" aria-label="Notifications">'+ICO('bell',17)+
            (c.alertCount?'<span class="bell-dot"></span>':'')+'</button>'+
          '<button class="persona" id="personaBtn" onclick="App.profileMenu()" aria-haspopup="menu" '+
            'aria-expanded="false" aria-label="Account menu for '+esc(c.persona.name)+'">'+
            '<span class="avatar" aria-hidden="true">'+esc(FMT.initials(c.persona.name))+'</span>'+
            '<div class="persona-meta"><div class="persona-name">'+esc(c.persona.name)+'</div>'+
            '<div class="persona-role">'+esc(c.persona.role)+' · '+esc(c.persona.org)+'</div></div>'+
            ICO('chevdown',14)+
          '</button>'+
        '</header>'+
        '<div class="profile-menu" id="profileMenu" hidden role="menu" aria-label="Account"></div>'+
        '<main class="page" id="main" tabindex="-1"></main>'+
      '</div>'+
    '</div>'+
    (c.ai===false?'':'<div class="ai-dock"><button class="ai-fab" onclick="AI.open()" aria-label="Open the '+esc(c.aiName||'AI')+' assistant">'+
      AARYA_MARK(22)+esc(c.aiName||'Ask AARYA')+'</button></div>'+
      '<div class="ai-chat" id="aiChat" hidden role="dialog" aria-label="AI assistant"></div>');

    this.wireSearch();
    let secs=0;
    setInterval(()=>{
      secs++;
      const t=$('#freshTxt'), chip=$('#freshChip');
      if(!t) return;
      const mins=Math.floor(secs/60);
      if(secs<300){
        t.textContent = mins<1 ? 'Live' : mins+'m ago';
        chip.classList.remove('is-stale');
        chip.title = 'Data refreshed '+(mins<1?'moments':mins+' minutes')+' ago';
      } else {
        t.textContent = mins+'m ago';
        chip.classList.add('is-stale');
        chip.title = 'Data is more than five minutes old';
      }
    },1000);
    /* Refreshing is a real action, not decoration. */
    const fc=$('#freshChip');
    if(fc) fc.onclick=()=>{ secs=0; $('#freshTxt').textContent='Live';
      fc.classList.remove('is-stale'); recomputeIfPresent(); toast('Refreshed'); App.go(App.view); };
  },
  wireSearch(){
    const inp=$('#gsearchInput'), res=$('#gres');
    if(!inp) return;
    const idx=this.cfg.searchIndex||[];
    const draw=()=>{
      const q=inp.value.trim().toLowerCase();
      if(!q){res.hidden=true;inp.setAttribute('aria-expanded','false');return;}
      const hits=idx.filter(x=>x.t.toLowerCase().includes(q)||x.k.toLowerCase().includes(q)).slice(0,9);
      res.innerHTML = hits.length
        ? hits.map(h=>'<div class="gres-item" role="option" tabindex="0" onclick="App.go(\''+h.v+'\');document.getElementById(\'gres\').hidden=true;document.getElementById(\'gsearchInput\').value=\'\'">'+
            '<span class="gres-kind">'+esc(h.k)+'</span><span class="grow">'+esc(h.t)+'</span>'+ICO('chevright',13)+'</div>').join('')
        : '<div class="gres-empty">'+ICO('search',14)+' No match for “'+esc(inp.value)+'” in '+esc(this.cfg.searchScope||'this account')+'. Search covers users, services, invoices and tickets.</div>';
      res.hidden=false; inp.setAttribute('aria-expanded','true');
    };
    inp.addEventListener('input',draw);
    inp.addEventListener('blur',()=>setTimeout(()=>{res.hidden=true;inp.setAttribute('aria-expanded','false');},180));
  },
  go(id){
    /* A screen that has been merged into another keeps its identifier working.
       Without this a bookmark, a search hit or an in-page link to the old id
       silently does nothing, which reads as a broken button. */
    const alias=(this.cfg.aliases||{})[id];
    if(alias && !this.findView(id)) id=alias;
    const v=this.findView(id); if(!v) return;
    this.view=id; location.hash=id;
    $$('.nav-item').forEach(b=>b.removeAttribute('aria-current'));
    const nb=$('#nav_'+id); if(nb) nb.setAttribute('aria-current','page');
    let group=''; this.cfg.nav.forEach(g=>g.items.forEach(i=>{if(i.id===id)group=g.label;}));
    $('#crumbs').innerHTML =
      '<span class="crumb org">'+esc(this.cfg.persona.org)+'</span>'+
      '<span class="sep" aria-hidden="true">/</span>'+
      '<span class="crumb grp">'+esc(group)+'</span>'+
      '<span class="sep" aria-hidden="true">/</span>'+
      '<span class="crumb here">'+esc(v.label)+'</span>';
    closeInspector();
    const main=$('#main');
    main.innerHTML='<div class="stack">'+
      '<div class="panel"><div class="panel-body"><div class="skel" style="width:180px;height:15px"></div>'+
      '<div class="skel" style="width:100%;margin-top:12px"></div><div class="skel" style="width:78%;margin-top:8px"></div></div></div></div>';
    setTimeout(()=>{
      /* Views read derived collections, so anything an action mutated is
         recomputed before the next render rather than going stale. */
      if(typeof BEFORE_RENDER==='function') BEFORE_RENDER(id);
      this.refreshNav();
      main.innerHTML = VIEWS[id] ? VIEWS[id]() :
        stateBlock('error','This screen is not part of the agreed scope','The feature list for this persona does not include a screen with this identifier.');
      main.focus({preventScroll:true});
      if(typeof AFTER_RENDER==='function') AFTER_RENDER(id);
    }, 90);
  },
  /* Nav badge counts are functions where the underlying set can change, so a
     completed journey updates the rail without a page reload. */
  refreshNav(){
    (this.cfg.nav||[]).forEach(g=>g.items.forEach(i=>{
      if(typeof i.count!=='function') return;
      const b=document.getElementById('nav_'+i.id); if(!b) return;
      let el=b.querySelector('.nav-count');
      const v=i.count();
      if(v==null||v===0){ if(el) el.remove(); return; }
      if(!el){ el=document.createElement('span'); el.className='nav-count'; b.appendChild(el); }
      el.textContent=v;
    }));
  },
  /* The avatar is the one control everybody reaches for and it did nothing.
     It now opens the account menu the rest of the app already has screens for. */
  profileMenu(){
    const el=$('#profileMenu'), btn=$('#personaBtn');
    if(!el) return;
    if(!el.hidden){ this.closeProfileMenu(); return; }
    const c=this.cfg, p=c.persona;
    const me = (typeof orgUsers==='function' && c.orgCtx)
      ? orgUsers(c.orgCtx).filter(u=>u.you)[0] : null;
    const item=(icon,label,sub,onclick,disabled)=>
      '<button class="pm-item" role="menuitem" '+(disabled?'disabled':'onclick="App.closeProfileMenu();'+onclick+'"')+'>'+
        ICO(icon,15)+'<span class="grow"><span class="pm-label">'+esc(label)+'</span>'+
        (sub?'<span class="pm-sub">'+esc(sub)+'</span>':'')+'</span></button>';

    el.innerHTML =
      '<div class="pm-head">'+
        '<span class="avatar avatar-lg" aria-hidden="true">'+esc(FMT.initials(p.name))+'</span>'+
        '<div class="grow"><div class="t-small strong">'+esc(p.name)+'</div>'+
        '<div class="t-tiny muted">'+esc(me?me.email:(c.personaEmail||'—'))+'</div>'+
        '<div class="t-tiny muted">'+esc(p.role)+' · '+esc(p.org)+'</div></div>'+
      '</div>'+
      (me && me.mustReset
        ? '<div class="pm-alert">'+ICO('alert',13)+'Your password must be reset before your next sign-in.</div>'
        : '')+
      '<div class="pm-body">'+
        item('user','My details', c.profileSub||'Name, contact and how we reach you',
             (c.profileAction||'App.go(\''+(c.profileView||'account')+'\')')) +
        (c.orgCtx
          ? item('key','Change my password',
                 me && me.pwdChanged ? 'Last changed '+me.pwdChanged : 'Not set',
                 'changePasswordDialog(\''+c.orgCtx+'\',\''+(me?me.id:'')+'\')', !me)
          : '')+
        (c.orgCtx
          ? item('lock','Sign-in and security', me ? (me.mfa?'Multi-factor is on':'Multi-factor is off') : '',
                 'App.go(\''+(c.securityView||'users')+'\')')
          : '')+
        item('bell','Notification preferences','What reaches you, and how','App.go(\'notifications\')')+
        (c.rolesView!==false ? item('shield','My permissions','What this role may and may not do','App.go(\'roles\')') : '')+
      '</div>'+
      '<div class="pm-foot">'+
        '<span class="t-tiny muted grow">Signed in '+esc(c.signedIn||'today at 08:41')+'</span>'+
        '<button class="btn btn-sm" role="menuitem" onclick="App.signOut()">'+ICO('logout',13)+'Sign out</button>'+
      '</div>';
    el.hidden=false;
    if(btn) btn.setAttribute('aria-expanded','true');
    const first=el.querySelector('button'); if(first) first.focus();
    this._pmAway = (e)=>{ if(!el.contains(e.target) && !(btn&&btn.contains(e.target))) this.closeProfileMenu(); };
    this._pmKey  = (e)=>{ if(e.key==='Escape'){ this.closeProfileMenu(); if(btn) btn.focus(); } };
    setTimeout(()=>{ document.addEventListener('click',this._pmAway); },0);
    document.addEventListener('keydown',this._pmKey);
  },
  closeProfileMenu(){
    const el=$('#profileMenu'), btn=$('#personaBtn');
    if(el) el.hidden=true;
    if(btn) btn.setAttribute('aria-expanded','false');
    if(this._pmAway) document.removeEventListener('click',this._pmAway);
    if(this._pmKey)  document.removeEventListener('keydown',this._pmKey);
  },
  signOut(){
    this.closeProfileMenu();
    confirmAction({
      title:'Sign out of '+this.cfg.product, subtitle:this.cfg.persona.name+' · '+this.cfg.persona.org,
      confirmLabel:'Sign out',
      impact:['Anything you have not saved on this screen is lost.',
              'Your other sessions on other devices stay signed in — end those from Sign-in and sessions.',
              'You are returned to the sign-in screen.'],
      onConfirm:()=>{
        const ctx=(typeof authCtx==='function')?authCtx():null;
        if(ctx && typeof SESSIONS!=='undefined') SESSIONS[ctx]=(SESSIONS[ctx]||[]).filter(s=>!s.current);
        if(typeof audit==='function') audit('auth.signout',{object:App.cfg.persona.name, detail:'Signed out'});
        if(typeof AUTH!=='undefined'){ AUTH.signedIn=false; AUTH.step='creds'; AUTH.user=null; }
        toast('Signed out');
        App.renderLogin();
      }
    });
  },

  /* Contextual first, catalogue second. If nothing covers this screen we say
     so rather than dumping the reader on a search box. */
  help(){
    if(typeof kbHelpHere!=='function'){ toast('Help is not available in this console'); return; }
    if(typeof kbForView==='function' && !kbForView(this.view).length){
      if(this.findView('help')){ toast('No article covers this screen yet — here is everything else'); this.go('help'); }
      else toast('No article covers this screen yet');
      return;
    }
    kbHelpHere();
  },

  notifications(){
    const n=this.cfg.notifications||[];
    openInspector(
      '<div class="insp-head">'+ICO('bell',18)+'<div class="grow"><h3 class="t-sub">Notifications</h3>'+
        '<div class="t-small muted">'+n.filter(x=>!x.read).length+' unread · alert rules are configurable per account</div></div>'+
        '<button class="iconbtn" onclick="closeInspector()" aria-label="Close">'+ICO('x',16)+'</button></div>'+
      '<div class="insp-body">'+ (n.length? '<ul class="timeline">'+n.map(x=>
        '<li class="tl-'+(x.kind==='danger'?'danger':x.kind==='success'?'success':'primary')+'">'+
        '<div class="tl-when">'+esc(x.when)+'</div><div class="tl-what">'+(x.read?'':'<strong>')+esc(x.text)+(x.read?'':'</strong>')+'</div>'+
        '<div class="tl-who">'+esc(x.source)+'</div></li>').join('')+'</ul>'
        : stateBlock('empty','No notifications','Alerts you subscribe to will appear here.')) +'</div>'+
      '<div class="insp-foot"><button class="btn btn-quiet" onclick="closeInspector()">Close</button>'+
        '<div class="spacer"></div><button class="btn btn-sm" onclick="toast(\'All notifications marked as read\');closeInspector()">Mark all read</button></div>',
      'Notifications');
  }
};

/* The AARYA mark is an approved brand asset. It is referenced, never redrawn:
   no CSS or SVG reconstruction of the logo anywhere in this prototype. */
function AARYA_MARK(px){
  const s=px||20;
  return '<img class="aarya-mark" src="assets/brand/aarya-mark.png" alt="" aria-hidden="true" '+
    'width="'+s+'" height="'+Math.round(s*111/105)+'">';
}

/* --------------------------- AI assistant (agentic) ---------------------- */
/* Scripted, deterministic responses over the same synthetic dataset. Every
   answer declares its source. Orange is confined to these surfaces. */
const AI = {
  open(){
    const c=App.cfg;
    const el=$('#aiChat'); if(!el) return;
    el.hidden=false;
    el.innerHTML =
      '<div class="ai-chat-head">'+AARYA_MARK(26)+
        '<div class="grow"><div class="t-sub">'+esc(c.aiName||'AARYA assistant')+'</div>'+
        '<div class="t-tiny muted">Scoped to '+esc(c.persona.org)+' · read-only unless you approve an action</div></div>'+
        '<button class="iconbtn" onclick="AI.close()" aria-label="Close assistant">'+ICO('x',16)+'</button></div>'+
      '<div class="ai-log" id="aiLog"></div>'+
      '<div class="ai-sugg" id="aiSugg"></div>'+
      '<form class="ai-compose" onsubmit="event.preventDefault();AI.send(this.q.value);this.q.value=\'\'">'+
        '<input name="q" placeholder="Ask about usage, bills, services or tickets" autocomplete="off" aria-label="Message the assistant">'+
        '<button class="btn btn-primary" type="submit" aria-label="Send">'+ICO('send',14)+'</button></form>';
    if(!this._seeded){
      this.say('ai', (c.aiGreeting||'Hello. I can answer questions about this account using live self-care data.'));
      this._seeded=true;
    } else { $('#aiLog').innerHTML=this._log; }
    this.suggest();
    $('#aiChat').querySelector('input').focus();
  },
  close(){ this._log=$('#aiLog').innerHTML; $('#aiChat').hidden=true; },
  suggest(){
    const s=(App.cfg.aiSuggestions||[]);
    $('#aiSugg').innerHTML = s.map(t=>'<button class="btn btn-sm" onclick="AI.send('+JSON.stringify(t).replace(/"/g,'&quot;')+')">'+esc(t)+'</button>').join('');
  },
  say(who,html){
    const log=$('#aiLog'); if(!log) return;
    const d=document.createElement('div'); d.className='msg '+who; d.innerHTML=html;
    log.appendChild(d); log.scrollTop=log.scrollHeight;
  },
  send(q){
    if(!q||!q.trim()) return;
    this.say('me',esc(q));
    const log=$('#aiLog');
    const t=document.createElement('div'); t.className='msg ai';
    t.innerHTML='<span class="typing"><i></i><i></i><i></i></span>';
    log.appendChild(t); log.scrollTop=log.scrollHeight;
    setTimeout(()=>{
      t.remove();
      const ans=(App.cfg.aiAnswer||(()=>null))(q.toLowerCase());
      this.say('ai', ans || ('I do not have evidence for that in this account\'s self-care data, so I will not guess. '+
        '<div class="src">Checked: usage records, billing records, service inventory, ticket history.</div>'));
    }, 620);
  }
};


/* Views own their derived data; this lets the refresh control ask for it. */
function recomputeIfPresent(){ if(typeof recomputeDerived==='function') recomputeDerived(); }
