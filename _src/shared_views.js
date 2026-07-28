/* ---------------------------------------------------------------------------
   Shared view helpers used by every persona file.
   --------------------------------------------------------------------------- */
const _dt={};
/* A table is cached so the person's sort, search, filters and page survive a
   re-render — but its rows must not. Views hand in a freshly derived array
   every time, and anything a journey created has to show up in it. */
function dt(id,cfg){
  const t=_dt[id];
  if(!t){ _dt[id]=new DataTable(Object.assign({id:id},cfg)); }
  else {
    t.cfg  = Object.assign({}, t.cfg, cfg, {id:id});
    if(cfg.rows) t.rows = cfg.rows;
  }
  return _dt[id].html();
}

function pagehead(title,sub,acts){
  return '<div class="pagehead"><div class="grow"><h1 class="t-page">'+esc(title)+'</h1>'+
    (sub?'<div class="pagesub">'+sub+'</div>':'')+'</div>'+(acts?'<div class="pageacts">'+acts+'</div>':'')+'</div>';
}
function panel(title,body,opts){
  opts=opts||{};
  return '<section class="'+(opts.ai?'panel ai-panel':'panel')+'">'+
    (title?'<div class="panel-head">'+(opts.icon?ICO(opts.icon,15):'')+'<div class="grow"><h2 class="t-section">'+esc(title)+'</h2>'+
      (opts.sub?'<div class="t-tiny muted">'+opts.sub+'</div>':'')+'</div>'+(opts.acts||'')+'</div>':'')+
    '<div class="panel-body'+(opts.flush?' flush':'')+'">'+body+'</div></section>';
}
function statusPill(s){
  const map={active:'active',online:'online',suspended:'suspended',degraded:'degraded',down:'down',invited:'pending',
    deactivated:'inactive',terminated:'terminated',paid:'paid',overdue:'overdue',open:'open',inprogress:'inprogress',
    pending:'pending',resolved:'resolved',completed:'completed',approved:'approved',rejected:'rejected'};
  const lbl={invited:'Invited',open:'Open',inprogress:'In progress'};
  return pill(map[s]||'unavailable', lbl[s]);
}
function sevPill(s){
  const m={P1:['danger','bang'],P2:['warning','tri'],P3:['info','dot'],P4:['neutral','dash']}[s]||['neutral','dash'];
  return '<span class="pill pill-'+m[0]+'">'+SH(m[1])+esc(s)+'</span>';
}
function aiInsight(i){
  return '<div class="ai-insight"><span class="ai-mark">'+ICO(i.icon||'ai',12)+'</span>'+
    '<div class="ai-body"><h5>'+esc(i.title)+'</h5><p>'+i.body+'</p>'+
    (i.acts?'<div class="ai-acts">'+i.acts+'</div>':'')+'</div>'+
    '<span class="ai-conf" title="Model confidence for this insight">'+esc(i.conf)+'</span></div>';
}
function tinyMeter(used,allow){
  if(allow==null) return '<span class="t-tiny muted">Unmetered</span>';
  if(used==null) return meter(null,null,{naLabel:'Not measured'});
  return meter(used/allow*100, FMT.dec(used,1)+' / '+allow+' GB');
}
function healthPill(h){
  return h==='healthy'?pill('active','Healthy'):h==='attention'?pill('degraded','Needs attention'):pill('down','At risk');
}
function exportBtn(what){
  return '<button class="btn btn-sm" onclick="toast(\''+esc(what)+' exported to CSV — check your downloads\')">'+ICO('download',13)+'Export</button>';
}
function scheduleBtn(){
  return '<button class="btn btn-sm" onclick="openSchedule()">'+ICO('calendar',13)+'Schedule</button>';
}
function openSchedule(){
  openModal('<div class="modal-head">'+ICO('calendar',18)+'<div class="grow"><h3 class="t-sub">Schedule this report</h3>'+
    '<div class="t-small muted">Delivered as CSV and PDF to the recipients you choose.</div></div>'+
    '<button class="iconbtn" onclick="closeModal()" aria-label="Close">'+ICO('x',16)+'</button></div>'+
    '<div class="modal-body stack">'+
      '<div class="grid g2">'+
        '<div class="field"><label for="schFreq">Frequency</label><select class="inp" id="schFreq"><option>Weekly — Monday 07:00</option><option selected>Monthly — 1st, 07:00</option><option>Quarterly</option></select></div>'+
        '<div class="field"><label for="schFmt">Format</label><select class="inp" id="schFmt"><option selected>CSV + PDF</option><option>CSV only</option><option>PDF only</option></select></div>'+
      '</div>'+
      '<div class="field"><label for="schTo">Recipients</label><input class="inp" id="schTo" value="a.visser@gmail.com; finance@gmail.com"></div>'+
      '<label class="checkline"><input type="checkbox" checked> Include cost-centre breakdown</label>'+
      '<label class="checkline"><input type="checkbox"> Suppress delivery when no data changed</label>'+
    '</div>'+
    '<div class="modal-foot"><span class="t-tiny muted grow">Scheduler runs in the account time zone (CET).</span>'+
    '<button class="btn btn-quiet" onclick="closeModal()">Cancel</button>'+
    '<button class="btn btn-primary" onclick="closeModal();toast(\'Report scheduled — first delivery 01 Aug 2026\')" data-autofocus>Schedule report</button></div>',
    {label:'Schedule report'});
}

/* Shared ticket detail inspector (all personas) */
function openTicket(id){
  const t=TICKETS.find(x=>x.id===id); if(!t) return;
  openInspector(
    '<div class="insp-head">'+ICO('support',18)+'<div class="grow"><div class="row" style="gap:7px">'+sevPill(t.severity)+statusPill(t.status)+
      (t.breached?pill('breached'):'')+(t.escalated?pill('warning','Escalated'):'')+'</div>'+
      '<h3 class="t-sub" style="margin-top:5px">'+esc(t.subject)+'</h3>'+
      '<div class="t-small muted">'+esc(t.id)+' · opened '+esc(t.opened)+' via '+esc(t.channel)+'</div></div>'+
      '<button class="iconbtn" onclick="closeInspector()" aria-label="Close">'+ICO('x',16)+'</button></div>'+
    '<div class="insp-body stack">'+
      '<dl class="deflist">'+
        '<dt>Raised by</dt><dd>'+esc(t.openedBy)+'</dd>'+
        '<dt>Team</dt><dd>'+esc(t.teamName)+'</dd>'+
        '<dt>Assigned to</dt><dd>'+esc(t.owner)+'</dd>'+
        '<dt>SLA target</dt><dd>'+FMT.mins(t.slaMins)+'</dd>'+
        '<dt>Time to resolve</dt><dd>'+(t.resolutionMins!=null?FMT.mins(t.resolutionMins)+(t.breached?' <span class="t-tiny" style="color:var(--nim-danger-fg)">(over target)</span>':''):'<span class="nodata">Still open</span>')+'</dd>'+
      '</dl>'+
      '<div class="divider"></div>'+
      '<h4 class="t-sub">History</h4>'+
      '<ul class="timeline">'+
        '<li class="tl-primary"><div class="tl-when">'+esc(t.opened)+'</div><div class="tl-what">Ticket raised from '+esc(t.channel)+'</div><div class="tl-who">'+esc(t.openedBy)+'</div></li>'+
        '<li class="tl-primary"><div class="tl-when">+6 min</div><div class="tl-what">Auto-triaged to '+esc(t.owner)+' by severity rule '+esc(t.severity)+'</div><div class="tl-who">Routing engine</div></li>'+
        (t.escalated?'<li class="tl-danger"><div class="tl-when">+'+FMT.mins(Math.round(t.slaMins*0.6))+'</div><div class="tl-what">Escalated — no operator update within half the SLA window</div><div class="tl-who">Escalation policy</div></li>':'')+
        (t.status==='resolved'
          ? '<li class="tl-success"><div class="tl-when">+'+FMT.mins(t.resolutionMins)+'</div><div class="tl-what">Resolved and confirmed by the requester</div><div class="tl-who">'+esc(t.owner)+'</div></li>'
          : '<li><div class="tl-when">Now</div><div class="tl-what">Awaiting operator update</div><div class="tl-who">'+esc(t.owner)+'</div></li>')+
      '</ul>'+
    '</div>'+
    '<div class="insp-foot"><button class="btn btn-quiet" onclick="closeInspector()">Close</button><div class="spacer"></div>'+
      (t.status==='resolved'
        ? '<button class="btn btn-sm" onclick="toast(\'Ticket reopened\')">Reopen</button>'
        : '<button class="btn btn-sm" onclick="toast(\'Escalation sent to Kestrel Telecom\',\'warn\')">'+ICO('trendup',13)+'Escalate</button>'+
          '<button class="btn btn-sm btn-primary" onclick="toast(\'Update posted to the ticket\')">Add update</button>')+
    '</div>','Ticket '+t.id);
}

/* Shared invoice inspector */
function openInvoice(id){
  const v=INVOICES.find(x=>x.id===id); if(!v) return;
  openInspector(
    '<div class="insp-head">'+ICO('invoice',18)+'<div class="grow">'+statusPill(v.status)+
      '<h3 class="t-sub" style="margin-top:5px">'+esc(v.id)+'</h3>'+
      '<div class="t-small muted">Billing period '+esc(v.period)+' · '+v.lines+' charge lines</div></div>'+
      '<button class="iconbtn" onclick="closeInspector()" aria-label="Close">'+ICO('x',16)+'</button></div>'+
    '<div class="insp-body stack">'+
      (v.status==='overdue'?banner('danger','<strong>Overdue by 4 days.</strong> Late-payment terms apply from day 7 under '+esc(ENT.contractRef)+'.'):'')+
      '<dl class="deflist">'+
        '<dt>Issued</dt><dd>'+esc(v.issued)+'</dd>'+
        '<dt>Due</dt><dd>'+esc(v.due)+' ('+esc(ENT.paymentTerms)+')</dd>'+
        '<dt>Payment method</dt><dd>'+esc(v.method)+'</dd>'+
        '<dt>Settled on</dt><dd>'+(v.paidOn?esc(v.paidOn):'<span class="nodata">Not settled</span>')+'</dd>'+
      '</dl>'+
      '<div class="divider"></div>'+
      '<h4 class="t-sub">Charge summary</h4>'+
      '<table class="tbl"><tbody>'+
        '<tr><td>Recurring subscriptions</td><td class="num">'+CUR(v.recurring)+'</td></tr>'+
        '<tr><td>Usage and overage</td><td class="num">'+CUR(v.usage)+'</td></tr>'+
        '<tr><td>One-off and hardware</td><td class="num">'+CUR(v.oneoff)+'</td></tr>'+
        '<tr><td>VAT (21%)</td><td class="num">'+CUR(v.tax)+'</td></tr>'+
        '<tr><td class="cellmain">Total</td><td class="num cellmain">'+CUR(v.amount)+'</td></tr>'+
      '</tbody></table>'+
      '<div class="divider"></div>'+
      '<h4 class="t-sub">Cost-centre split</h4>'+
      CH.stack(TEAMS.map(t=>({label:t.name+' · '+t.cc, parts:[+(v.amount*t.spend/KPI.mrc).toFixed(2)]})),
        {names:['Charge'], fmt:n=>CUR0(n)})+
    '</div>'+
    '<div class="insp-foot"><button class="btn btn-quiet" onclick="closeInspector()">Close</button><div class="spacer"></div>'+
      '<button class="btn btn-sm" onclick="toast(\'PDF invoice downloaded\')">'+ICO('download',13)+'PDF</button>'+
      (v.status!=='paid'?'<button class="btn btn-sm btn-primary" onclick="payInvoice(\''+v.id+'\')">Pay '+CUR0(v.amount)+'</button>':'')+
    '</div>','Invoice '+v.id);
}
function payInvoice(id){
  const v=INVOICES.find(x=>x.id===id);
  confirmAction({
    title:'Pay invoice '+v.id, subtitle:CUR(v.amount)+' · billing period '+v.period, risk:'normal',
    confirmLabel:'Pay '+CUR0(v.amount),
    body:'<div class="field"><label for="payWith">Pay with</label><select class="inp" id="payWith">'+
      PAY_METHODS.filter(m=>m.status==='active').map(m=>'<option>'+esc(m.kind)+' — '+esc(m.detail)+'</option>').join('')+'</select></div>',
    impact:['The full balance of <strong>'+CUR(v.amount)+'</strong> is collected on the next banking day.',
            'A payment confirmation is emailed to the billing contacts on this account.',
            'Any dispute you have already raised on a line item stays open and is settled separately.'],
    footNote:'Payments are irreversible once submitted to the bank.',
    onConfirm:()=>{ v.status='paid'; v.paidOn='Today'; v.method='SEPA direct debit'; closeInspector(); toast('Payment submitted — '+v.id+' marked as paid'); App.go(App.view); }
  });
}
