/* ═══════════════════════════════════════════════════════════════════════
   PRINT — Product → (Job) → (Section) → (Allergens) → Check and print.
   Anything already known is filled in and its step skipped:
   · the job stays chosen for the next labels (for 3 hours) — pick the
     wedding once, then just tap products; its menu is listed first;
   · a Kitchen Prep product brings its section and locked allergens;
   · a custom product brings its allergens; its section is remembered;
   · only a one-off asks for allergens.
   After Print the wizard is instantly ready for the next label.
   ═══════════════════════════════════════════════════════════════════════ */
let W=null;
const STEP_TITLES={product:'Print',job:'Which job?',section:'Which section?',allergens:'Allergens',review:'Check and print'};
const STICKY_MS=3*3600e3;
function stickyJob(){const j=LS.get('dcps_job',null);if(!j||Date.now()-j.at>STICKY_MS)return undefined;return j.code?jobByCode(j.code):null;}
function setSticky(job){if(job===undefined)LS.del('dcps_job');else LS.set('dcps_job',{code:job?job.code:null,at:Date.now()});}
function defaultMaker(){const m=LS.get('dcps_maker',null);if(m&&Date.now()-m.at<12*3600e3&&S.staff.some(s=>s.name===m.name))return m.name;return S.user?S.user.name:'';}
function freshW(){
  return{step:'product',q:'',filter:'all',prod:null,job:stickyJob(),section:undefined,sectionFrom:'',flow:['product','review'],
    al:{c:[],m:[],none:false,chosen:false,unlocked:false},alMode:'c',
    status:'',statusChosen:true,made:ymd(),statusDate:ymd(),useby:'',usebyManual:false,
    staff:defaultMaker(),wmode:'none',wtotal:'',wunit:'kg',wportions:'',wsize:'',wsunit:'g',
    notes:'',labels:1,saveProduct:false,reprint:null,shield:0};
}
AL_ED.wiz={
  get:()=>({c:[...W.al.c],m:[...W.al.m],none:W.al.none,mode:W.alMode}),
  set:s=>{W.al.c=s.c;W.al.m=s.m;W.al.none=s.none;W.alMode=s.mode;W.al.chosen=W.prod.src!=='oneoff'||s.none||s.c.length+s.m.length>0;},
  after:()=>{if(W.step==='allergens'){renderStepFoot();}else{const n=$('#rv-al-note');if(n)n.outerHTML=alEditNoteHTML();}renderSideSummary();schedulePreview();}
};

/* ── Steps ───────────────────────────────────────────────────────────── */
function firstIncomplete(){
  const p=W.prod;if(!p)return'product';
  if(W.job===undefined)return'job';
  if(W.section===undefined)return'section';
  if(p.src==='oneoff'&&!W.al.chosen)return'allergens';
  return'review';
}
function planFlow(){
  const p=W.prod,f=['product'];
  if(W.job===undefined||W.flow.includes('job'))f.push('job');
  if(p&&(W.section===undefined||W.flow.includes('section')))f.push('section');
  if(p&&p.src==='oneoff')f.push('allergens');
  f.push('review');W.flow=f;
}
function goStep(step,back){
  if(step!=='product'&&step!=='job'&&!W.prod)step='product';
  if(!W.flow.includes(step)){const order=['product','job','section','allergens','review'];W.flow=order.filter(s=>W.flow.includes(s)||s===step);}
  W.step=step;renderStep(back?'back':'fwd');
  const body=$('#step-body');if(body)body.scrollTop=0;
  if(step==='product')focusSearch();
}
function wizBack(){
  if(W.step==='product'){if(W.q){W.q='';renderStep();focusSearch();}return;}
  const i=W.flow.indexOf(W.step);goStep(W.flow[Math.max(0,i-1)],true);
}
function focusSearch(){if(!matchMedia('(hover:hover)').matches)return;setTimeout(()=>{const q=$('#q');if(q&&S.view==='print')q.focus({preventScroll:true});},30);}

/* ── Remembered choices ──────────────────────────────────────────────── */
function pushRecent(key){const r=LS.get('dcps_recent',[]).filter(k=>k!==key);r.unshift(key);LS.set('dcps_recent',r.slice(0,16));}
function recentProducts(){const all=allProducts();return LS.get('dcps_recent',[]).map(k=>all.find(p=>p.key===k)).filter(Boolean);}
function lastSectionFor(p){const m=LS.get('dcps_last_section',{})||{};return Object.prototype.hasOwnProperty.call(m,norm(p.name))?m[norm(p.name)]:undefined;}
function rememberSection(p,sec){const m=LS.get('dcps_last_section',{})||{};m[norm(p.name)]=sec;const keys=Object.keys(m);if(keys.length>400)delete m[keys[0]];LS.set('dcps_last_section',m);}

/* ── Dates and derived values ────────────────────────────────────────── */
function autoUseby(){
  const p=W.prod;if(!p)return'';
  if(W.status==='FROZEN')return addDays(W.statusDate||ymd(),frozenDays());
  if(W.status==='THAWED')return addHours(W.statusDate||ymd(),Math.min(72,p.shelfHours||72));
  return addHours(W.made||ymd(),p.shelfHours||chilledDays()*24);
}
function recalcUseby(){W.useby=autoUseby();W.usebyManual=false;}
function usebyRule(){
  const p=W.prod;if(!p)return'';
  if(W.status==='FROZEN')return plural(frozenDays(),'day')+' frozen';
  if(W.status==='THAWED'){const t=Math.min(72,p.shelfHours||72);return(t%24?t+' hours':plural(Math.floor(t/24),'day'))+' once thawed';}
  const hrs=p.shelfHours||72;return hrs%24?hrs+' hours':plural(hrs/24,'day');
}
function weightDisplay(){
  if(W.wmode==='weight'){const v=String(W.wtotal).trim();return v?v+W.wunit:null;}
  if(W.wmode==='portions'){const n=parseInt(W.wportions);if(!n)return null;const sz=String(W.wsize).trim();return`×${n} portions`+(sz?` · ${sz}${W.wsunit} each`:'');}
  return null;
}
function alEdited(){
  const p=W.prod;if(!p||p.src==='oneoff')return false;
  if(W.al.none)return p.contains.length+p.may.length>0;
  return!sameSet(W.al.c,p.contains)||!sameSet(W.al.m,p.may);
}
function sourceNote(){const p=W.prod;if(!p)return'';const base=p.src==='kp'?'Kitchen Prep':p.src==='custom'?'Custom':'One-off';return base+(alEdited()?' · allergens edited':'');}
function wizPayload(){
  const p=W.prod||{name:''};const al=W.al;const status=W.statusChosen?(W.status||null):null;
  return{product_name:p.name,staff_name:W.staff||(S.user&&S.user.name)||'',section:W.section||null,job_code:W.job?W.job.code:null,quantity:W.labels,
    date_prepped:W.made,date_useby:W.useby,contains:al.none?null:(al.c.join(', ')||null),may_contain:al.none?null:(al.m.join(', ')||null),no_allergens:!!al.none,
    status,status_date:status?W.statusDate:null,weight_mode:W.wmode==='none'?null:W.wmode,weight_display:weightDisplay(),
    notes:String(W.notes||'').trim()||null,printed_at:hhmm(),source_note:sourceNote()};
}
function wizRecord(pl){
  const p=W.prod;
  return{product_name:pl.product_name,staff_name:pl.staff_name,section:pl.section,job_code:pl.job_code,quantity:pl.quantity,date_prepped:pl.date_prepped,date_useby:pl.date_useby,
    contains:pl.contains,may_contain:pl.may_contain,notes:pl.notes,printed_at:pl.printed_at,label_status:pl.status,
    source:p.src==='kp'?'kitchen-prep':p.src==='custom'?'custom':'one-off',label_type:'standard',allergens_edited:alEdited(),status_date:pl.status_date,weight_display:pl.weight_display};
}

/* ── Picks ───────────────────────────────────────────────────────────── */
function applyPick(p){
  const changed=!W.prod||W.prod.key!==p.key;
  W.prod=p;
  if(changed){
    W.al={c:[...p.contains],m:[...p.may],none:false,chosen:p.src!=='oneoff',unlocked:false};W.alMode='c';
    if(p.section){W.section=p.section;W.sectionFrom=p.src==='kp'?'kp':'product';}
    else{const last=lastSectionFor(p);if(last!==undefined&&p.src!=='oneoff'){W.section=last;W.sectionFrom='last';}else{W.section=undefined;W.sectionFrom='';}}
    W.made=ymd();W.statusDate=ymd();W.status='';W.statusChosen=!p.frozen;
    recalcUseby();W.saveProduct=false;W.reprint=null;W.labels=1;
  }
  W.flow=['product'];planFlow();
}
function refreshSticky(){if(!W.prod&&W.job!==undefined&&stickyJob()===undefined)W.job=undefined;}
function wizPick(p){if(Date.now()<W.shield)return;refreshSticky();applyPick(p);if(W.prod.src!=='oneoff')pushRecent(p.key);goStep(firstIncomplete());}
function titleCaseFirst(s){s=String(s||'').trim().replace(/\s+/g,' ');return s?s[0].toUpperCase()+s.slice(1):'';}
function wizPickOneOff(){const name=titleCaseFirst(W.q);if(name)wizPick(oneOff(name,[],[]));}
function wizPickJob(code){
  W.job=code?jobByCode(code):null;setSticky(W.job);
  if(!W.prod){goStep('product',true);return;}
  goStep(firstIncomplete());
}
function wizPickSection(v){W.section=v;W.sectionFrom='chosen';if(W.prod&&!W.prod.section&&W.prod.src!=='oneoff')rememberSection(W.prod,v);goStep(firstIncomplete());}

/* ── Render ──────────────────────────────────────────────────────────── */
function renderPrintView(){
  if(!W)W=freshW();refreshSticky();
  $('#view-print').innerHTML=`<div class="pv" id="pv">
    <div class="pv-main">
      <div id="pv-banner"></div>
      <div class="step-hd" id="step-hd"></div>
      <div class="step-body" id="step-body"></div>
      <div class="step-foot" id="step-foot" hidden></div>
    </div>
    <aside class="pv-side" id="pv-side" aria-label="Label preview"></aside>
  </div>`;
  renderStep();
  if(W.step==='product')focusSearch();
}
function renderStep(dir){
  if(!$('#step-body'))return;
  $('#pv').classList.toggle('no-side',W.step==='product'&&!W.prod||W.step==='job'&&!W.prod);
  renderPrintBanner();renderStepHead();renderStepBody(dir);renderStepFoot();renderSide();schedulePreview();
}
function renderPrintBanner(){
  const el=$('#pv-banner');if(!el)return;
  if(S.outbox.length){
    const n=S.outbox.reduce((a,o)=>a+(o.payload&&o.payload.quantity||1),0);const maybe=S.outbox.every(o=>o.maybePrinted);const stale=S.outbox.every(o=>o.stale);
    el.innerHTML=`<div class="banner" role="alert">${ico('warning')}<div class="grow"><div class="banner-t">${plural(n,'label')} ${maybe?'may not have printed':'didn’t print'}</div><div class="banner-s">${h(S.outbox[0].error||'')}${S.outbox[0].maybePrinted?' — check the printer before retrying':''}</div></div><button class="btn btn-sm" data-act="outbox">See</button><button class="btn btn-sm btn-primary" data-act="outbox-retry-all">${stale?'Check':'Retry'}</button></div>`;
  }else if(S.kp.ok===false&&!kpKnown()){
    el.innerHTML=`<div class="banner soft">${ico('warning')}<div class="grow"><div class="banner-t">Kitchen Prep hasn’t loaded on this device</div><div class="banner-s">Its products aren’t listed yet, and anything shown as Custom may be an old copy — check allergens before printing.</div></div><button class="btn btn-sm" data-act="kp-retry">${ico('refresh')}Retry</button></div>`;
  }else if(S.kp.ok===false){
    el.innerHTML=`<div class="banner soft">${ico('info')}<div class="grow"><div class="banner-t">Kitchen Prep isn’t answering</div><div class="banner-s">Using its products and allergens from ${h(ago(S.kp.at))}.</div></div><button class="btn btn-sm" data-act="kp-retry">${ico('refresh')}Retry</button></div>`;
  }else el.innerHTML='';
}
function stepDots(){
  const s=W.flow,i=s.indexOf(W.step);if(i<1)return'';
  return`<div class="steps" aria-label="Step ${i+1} of ${s.length}">${s.map((x,j)=>`<i class="${j<i?'done':j===i?'cur':''}"></i>`).join('')}</div>`;
}
function renderStepHead(){
  const el=$('#step-hd');if(!el)return;
  if(W.step==='product'){
    el.innerHTML=`<div class="step-title big">Print<span class="sub">What are you labelling?</span></div><span class="phone-only">${printerPillHTML()}</span>`;
    return;
  }
  const subs={job:W.prod?h(W.prod.name):'For every label until you change it',section:W.prod?h(W.prod.name):'',allergens:W.prod?h(W.prod.name)+' · one-off':'',review:W.reprint?`Reprint — same batch, dates kept${W.reprint.orig>1?' · originally ×'+W.reprint.orig:''}`:''};
  el.innerHTML=`<button class="btn btn-icon btn-plain step-back" data-act="wiz-back" aria-label="Back">${ico('chevronL')}</button>
    <div class="step-title">${STEP_TITLES[W.step]}${subs[W.step]?`<span class="sub">${subs[W.step]}</span>`:''}</div>${stepDots()}`;
}
function renderStepBody(dir){
  const el=$('#step-body');if(!el)return;
  const fn={product:bodyProduct,job:bodyJob,section:bodySection,allergens:bodyAllergens,review:bodyReview}[W.step];
  el.innerHTML=fn();
  if(dir&&el.firstElementChild)el.firstElementChild.classList.add(dir==='back'?'step-back-in':'step-in');
  if(W.step==='product'){renderInbox();renderProducts();}
  if(W.step==='job')renderJobs();
  syncSegs(el);
}
function renderStepFoot(){
  const el=$('#step-foot');if(!el)return;
  if(W.step==='review'){
    el.hidden=false;
    const [cls,t]=printerText();const need=!W.statusChosen;
    el.innerHTML=`<div class="stepper" role="group" aria-label="Number of labels"><button class="btn" data-act="wiz-labels" data-d="-1" data-hold="1" aria-label="One fewer label" ${W.labels<=1?'disabled':''}>${ico('minus')}</button><button class="stepper-n" data-act="wiz-labels-sheet" aria-label="${W.labels} labels — choose how many">${W.labels}<small>${W.labels===1?'label':'labels'}</small></button><button class="btn" data-act="wiz-labels" data-d="1" data-hold="1" aria-label="One more label" ${W.labels>=50?'disabled':''}>${ico('plus')}</button></div>
      <div class="foot-print"><button class="btn btn-primary btn-xl" data-act="wiz-print" id="print-btn">${need?`<span>Fresh or frozen?</span>`:`${ico('printer')}<span>Print ${plural(W.labels,'label')}</span>`}</button><span class="foot-pr ${cls.split(' ')[0]}"><span class="dot ${cls}"></span>${h(t)}</span></div>`;
  }else if(W.step==='allergens'){
    el.hidden=false;
    el.innerHTML=`<span class="muted grow foot-hint">${W.al.chosen?h(alPhrase(W.al.c,W.al.m,W.al.none)):'Tap what it contains — or No allergens'}</span><button class="btn btn-primary btn-lg" data-act="wiz-al-done" ${W.al.chosen?'':'disabled'}>Continue</button>`;
  }else{el.hidden=true;el.innerHTML='';}
  setToastLift();
}

/* ── Step 1: product ─────────────────────────────────────────────────── */
function jobPillHTML(){
  if(W.job===undefined)return'';
  const j=W.job;
  return`<div class="job-pill" role="group" aria-label="Job for these labels">${ico(j?'calendar':'box')}<button class="job-pill-main" data-act="wiz-go" data-step="job"><span class="jp-k">${j?'For':'Stock'}</span> ${j?`<span class="mono">${h(j.code)}</span>${j.client?' · '+h(j.client):''}${j.date?` <span class="faint">· ${h(dayWords(j.date))}</span>`:''}`:'No job — for the fridge or freezer'}</button><button class="btn btn-sm btn-plain" data-act="wiz-go" data-step="job">Change</button><button class="btn btn-icon btn-sm btn-plain" data-act="wiz-job-clear" aria-label="Stop using this job">${ico('xmark')}</button></div>`;
}
function bodyProduct(){
  return`<div>
    <div class="find">
      ${jobPillHTML()}
      <div id="inbox"></div>
      <div class="search">${ico('search')}<input class="inp" id="q" type="search" placeholder="Search products — or type a name for a one-off" value="${h(W.q)}" data-in="wiz-q" autocomplete="off" autocorrect="off" spellcheck="false" enterkeyhint="go" aria-label="Search products"><button class="search-x" data-act="wiz-q-clear" aria-label="Clear the search" ${W.q?'':'hidden'}>${ico('xmark')}</button></div>
      <div class="chip-row" id="prod-filters">${filtersHTML()}</div>
    </div>
    <div id="prod-results"></div>
  </div>`;
}
function filtersHTML(){
  const have=new Set(allProducts().map(p=>p.section||'Other'));
  const secs=[...SECTIONS,'Other'].filter(s=>have.has(s));
  const filters=[['all','All'],['recent','Recent'],['kp','Kitchen Prep'],['custom','Custom'],...secs.map(s=>[s,s])];
  if(!filters.some(f=>f[0]===W.filter))W.filter='all';
  return filters.map(([v,l])=>`<button class="chip${W.filter===v?' on':''}" data-act="wiz-filter" data-v="${h(v)}" aria-pressed="${W.filter===v}">${v==='kp'?ico('lock','ico-xs'):''}${h(l)}</button>`).join('');
}
let _ibOpen=false;
function renderInbox(){
  const el=$('#inbox');if(!el)return;
  if(!S.inbox.length){el.innerHTML='';_ibOpen=false;return;}
  const MAX=3,rows=_ibOpen?S.inbox:S.inbox.slice(0,MAX),more=S.inbox.length-rows.length;
  el.innerHTML=`<div class="inbox"><div class="inbox-hd">${ico('share')}<span class="grow"><b>From Kitchen Prep</b> · ${plural(S.inbox.length,'label run')} sent to print here</span>${S.inbox.length>1?`<button class="btn btn-sm btn-primary" data-act="ib-all">${ico('printer')}Print all</button>`:''}</div>
    ${rows.map(r=>{const pl=inboxPayload(r);return`<div class="inbox-row"><div class="grow"><div class="inbox-t">${h(r.product_name)} <span class="muted">×${pl.quantity}</span>${pl.status==='FROZEN'?` <span class="badge badge-frz">${ico('snowflake')}Frozen</span>`:''}</div>
      <div class="inbox-s">${pl.job_code?`<span class="mono">${h(pl.job_code)}</span> · `:''}<span class="${pl.contains?'al-text':''}">${h(pl.contains||'No allergens')}</span> · use by ${h(dayWords(pl.date_useby))} · from ${h(firstName(r.staff_name)||'Kitchen Prep')}${r.created_at?' at '+h(hhmm(new Date(r.created_at))):''}${inboxChanged(r)?' · <b class="al-text">allergens updated since</b>':''}</div>
      ${pl.date_useby&&pl.date_useby<ymd()?`<div class="warn-note" style="margin-top:4px">${ico('warning','ico-sm')}Use-by has passed — it can’t be printed</div>`:''}</div>
      <button class="btn btn-sm btn-plain" data-act="ib-dismiss" data-id="${h(r.id)}">Dismiss</button>${pl.date_useby&&pl.date_useby<ymd()?'':`<button class="btn btn-sm btn-primary" data-act="ib-print" data-id="${h(r.id)}">Print</button>`}</div>`;}).join('')}${more?`<button class="inbox-more" data-act="ib-more">Show ${more} more</button>`:''}</div>`;
}
function matchScore(p,words,q){
  const hay=norm(p.name+' '+(p.dish||'')+' '+p.cat+' '+(p.section||''));
  if(!words.every(w=>hay.includes(w)))return-1;
  const n=norm(p.name);if(n===q)return 0;if(n.startsWith(q))return 1;if(n.split(/[\s—-]+/).some(w=>w.startsWith(words[0])))return 2;return 3;
}
function sectionOrder(s){const i=SECTIONS.indexOf(s);return i<0?99:i;}
function renderProducts(){
  const el=$('#prod-results');if(!el)return;
  const fr=$('#prod-filters');if(fr){const html=filtersHTML();if(fr.innerHTML!==html)fr.innerHTML=html;}
  const q=norm(W.q),words=q.split(' ').filter(Boolean);
  let list=allProducts();
  const f=W.filter;
  if(f==='kp')list=list.filter(p=>p.src==='kp');
  else if(f==='custom')list=list.filter(p=>p.src==='custom');
  else if(f==='recent')list=recentProducts();
  else if(f!=='all')list=list.filter(p=>(p.section||'Other')===f);
  const loading=!allProducts().length&&(S.kp.ok===null||S.cps.ok===null);
  if(loading&&!q){el.innerHTML=`<div class="tiles">${Array.from({length:8},()=>'<div class="tile skel"></div>').join('')}</div>`;return;}
  if(q){
    const scored=list.map(p=>[p,matchScore(p,words,q)]).filter(x=>x[1]>=0).sort((a,b)=>a[1]-b[1]||a[0].name.localeCompare(b[0].name)).map(x=>x[0]);
    const exact=allProducts().some(p=>norm(p.name)===q);
    const one=exact?'':`<button class="oneoff-row" data-act="wiz-oneoff">${ico('plus')}<span class="grow">Print “<b>${h(titleCaseFirst(W.q))}</b>” as a one-off</span><span class="faint">you’ll set its allergens</span></button>`;
    el.innerHTML=one+(scored.length?`<div class="tiles">${scored.slice(0,150).map(p=>tileHTML(p)).join('')}</div>`:`<div class="empty-s muted" style="padding:10px 4px">Nothing called “${h(W.q)}” in Kitchen Prep or your custom products.</div>`);
    return;
  }
  if(!list.length){
    const msg=f==='recent'?['clock','Nothing printed yet','Products you print appear here for next time.']:f==='custom'?['tag','No custom products','Add them in Manage → Products, or save a one-off when you print it.']:!allProducts().length?['search','No products yet','Type a name above to print a one-off.']:['search','None here',''];
    el.innerHTML=`<div class="empty">${ico(msg[0])}<div class="empty-t">${msg[1]}</div>${msg[2]?`<div class="empty-s">${msg[2]}</div>`:''}${f==='custom'&&isManager()?`<button class="btn" data-act="go" data-to="manage/products">Products</button>`:''}</div>`;
    return;
  }
  const groups=[];
  if(f==='all'){
    const menu=W.job&&W.job.ev?menuProducts(W.job).filter(x=>list.includes(x.p)):[];
    if(menu.length)groups.push([`On the menu · ${W.job.code}`,menu.map(x=>x.p),menu]);
    const rec=recentProducts().slice(0,6);if(rec.length)groups.push(['Recent',rec]);
  }
  if(f==='recent'){el.innerHTML=`<div class="tiles">${list.map(p=>tileHTML(p)).join('')}</div>`;return;}
  const secs=[...new Set(list.map(p=>p.section||'Other'))].sort((a,b)=>sectionOrder(a)-sectionOrder(b));
  secs.forEach(s=>groups.push([s,list.filter(p=>(p.section||'Other')===s)]));
  el.innerHTML=groups.map(([t,ps,menu])=>`<div class="group-hd"><span>${h(t)}</span><span class="n">${ps.length}</span></div><div class="tiles">${ps.map((p,i)=>tileHTML(p,menu&&menu[i]&&menu[i].portions?`<span class="eb eb-menu">${menu[i].portions} portions</span>`:'')).join('')}</div>`).join('');
}
function eyebrow(p,extra=''){
  const src=p.src==='kp'?`<span class="eb eb-kp">${ico('lock')}Kitchen Prep</span>`:p.src==='custom'?`<span class="eb eb-custom">Custom</span>`:`<span class="eb eb-one">One-off</span>`;
  return`<div class="tile-eb">${src}${p.frozen?`<span class="eb eb-frz">${ico('snowflake')}Freezer</span>`:''}${extra}</div>`;
}
function alShort(list,n=3){return list.length>n?list.slice(0,n).join(', ')+' +'+(list.length-n):list.join(', ');}
function alMetaHTML(c,m){
  if(c.length)return`<span class="al-text">${h(alShort(c))}</span>${m.length?`<span class="may">&nbsp;· may&nbsp;${h(alShort(m,2))}</span>`:''}`;
  if(m.length)return`<span class="may">May contain ${h(alShort(m))}</span>`;
  return`<span>No allergens</span>`;
}
function prodNameHTML(p){return p.src==='kp'&&p.comp&&p.dish&&norm(p.comp)!==norm(p.dish)?`${h(p.comp)} <span class="of">— ${h(p.dish)}</span>`:h(p.name);}
function tileHTML(p,extra=''){
  return`<button class="tile${W.prod&&W.prod.key===p.key?' sel':''}" data-act="wiz-pick" data-key="${h(p.key)}">${eyebrow(p,extra)}<div class="tile-name">${prodNameHTML(p)}</div><div class="tile-meta">${alMetaHTML(p.contains,p.may)}</div></button>`;
}

/* ── Step 2: job ─────────────────────────────────────────────────────── */
function bodyJob(){
  return`<div>
    <div class="find"><div class="search">${ico('search')}<input class="inp" id="jq" type="search" placeholder="Search jobs — code, client or date" data-in="wiz-jq" autocomplete="off" aria-label="Search jobs"></div></div>
    <div id="job-results"></div></div>`;
}
function jobCardHTML(j,extra){
  const sel=W.job&&W.job.code===j.code;
  if(!j.code)return`<div class="job off" aria-disabled="true"><div class="job-top"><span class="job-code faint">No job code</span>${j.status?`<span class="badge st-${h(j.status)}">${h(j.status)}</span>`:''}</div><div class="job-client">${h(j.client||'—')}</div><div class="job-meta"><span>${h(dayWords(j.date))}</span><span>· add its job code in Kitchen Prep to label for it</span></div></div>`;
  return`<button class="job${sel?' sel':''}" data-act="wiz-job" data-code="${h(j.code)}">
    <div class="job-top"><span class="job-code">${h(j.code)}</span>${j.status?`<span class="badge st-${h(j.status)}">${h(j.status)}</span>`:''}${j.src==='cps'?'<span class="badge">Made in CPS</span>':''}</div>
    <div class="job-client">${h(j.client||'—')}</div>
    <div class="job-meta">${j.date?`<span>${h(dayWords(j.date))}${j.date>=ymd()?' · '+h(inWords(j.date)):''}</span>`:''}${j.covers?`<span>· ${j.covers} covers</span>`:''}${extra||''}</div></button>`;
}
function renderJobs(){
  const el=$('#job-results');if(!el)return;
  const q=norm(($('#jq')||{}).value||''),words=q.split(' ').filter(Boolean);
  const today=ymd();
  const evs=kpEvents().map(evJob),cu=customJobs({current:true});
  const stock=`<button class="job job-stock${W.job===null?' sel':''}" data-act="wiz-job" data-code="">${ico('box','ico-lg')}<div><div class="job-client">No job — stock</div><div class="job-meta">For the fridge or freezer, not a particular event</div></div></button>`;
  const hay=j=>norm((j.code||'')+' '+j.client+' '+(j.date?dayWords(j.date)+' '+j.date:'')+' '+(j.venue||''));
  if(words.length){
    const hits=[...evs,...customJobs()].filter(j=>words.every(w=>hay(j).includes(w)));
    el.innerHTML=`<div class="jobs">${stock}${hits.map(j=>jobCardHTML(j)).join('')}</div>${hits.length?'':`<div class="empty-s muted" style="padding:14px 4px">No job matches “${h(q)}”.</div>`}`;
    return;
  }
  const shown=new Set();let html=`<div class="jobs">${stock}</div>`;
  const p=W.prod;
  if(p&&p.src==='kp'){
    const menu=eventsWithDish(p.dishId);
    if(menu.length){
      html+=`<div class="group-hd"><span>On the menu</span><span class="n">${menu.length}</span></div><div class="jobs">${menu.map(j=>{shown.add(j.code);const ed=j.ev.dishes.find(d=>d.dish_id===p.dishId);return jobCardHTML(j,`<span class="menu-tag">· ${ed&&ed.portions?ed.portions+' portions':'on the menu'}</span>`);}).join('')}</div>`;
    }
  }
  const up=evs.filter(j=>j.date>=today&&!shown.has(j.code));
  html+=`<div class="group-hd"><span>Coming up</span><span class="n">${up.length||''}</span></div>`;
  html+=up.length?`<div class="jobs">${up.map(j=>jobCardHTML(j)).join('')}</div>`:`<div class="group"><div class="row"><span class="muted">${S.kp.ok===false&&!S.kp.events.length?'Kitchen Prep isn’t answering — its events appear when it’s back.':'No events coming up in Kitchen Prep.'}</span></div></div>`;
  if(cu.length)html+=`<div class="group-hd"><span>Made in CPS</span><span class="n">${cu.length}</span></div><div class="jobs">${cu.map(j=>jobCardHTML(j)).join('')}</div>`;
  const past=evs.filter(j=>j.date<today&&j.code).reverse();
  if(past.length)html+=`<details class="past"><summary class="group-hd"><span>Last few days <span class="n">${past.length}</span></span></summary><div class="jobs">${past.map(j=>jobCardHTML(j)).join('')}</div></details>`;
  el.innerHTML=html;
}

/* ── Step 3: section ─────────────────────────────────────────────────── */
function bodySection(){
  const cur=W.section;
  return`<div><div class="secs">${SECTIONS.map(s=>`<button class="sec${cur===s?' sel':''}" data-act="wiz-sec" data-v="${h(s)}">${h(s)}</button>`).join('')}
    <button class="sec none${cur===''?' sel':''}" data-act="wiz-sec" data-v="">No section</button></div>
    ${W.prod&&W.prod.src==='kp'&&W.prod.section?`<div class="group-ft" style="padding-top:12px">Kitchen Prep puts this in ${h(W.prod.section)}.</div>`:W.prod&&W.prod.src!=='oneoff'?'<div class="group-ft" style="padding-top:12px">Remembered for next time.</div>':''}</div>`;
}

/* ── Step 4: allergens (one-offs) ────────────────────────────────────── */
function bodyAllergens(){
  return`<div class="al-step">
    <div class="lock-note" style="margin-bottom:14px">${ico('info')}<span>A one-off has no saved allergens, so nothing is assumed. Choose <b>Contains</b> or <b>May contain</b>, then tap.</span></div>
    ${alEditorHTML('wiz')}</div>`;
}

/* ── Step 5: check and print ─────────────────────────────────────────── */
function sumRows(opt={}){
  const p=W.prod,cur=W.step;
  const row=(step,k,v,todo)=>`<button class="row row-nav${cur===step?' cur':''}${todo?' todo':''}" data-act="wiz-go" data-step="${step}"><span class="row-k">${k}</span><span class="row-v">${v}</span>${ico('chevron','chev')}</button>`;
  let out=row('product','Product',p?h(p.name):'Choose a product',!p);
  out+=row('job','Job',W.job===undefined?'Choose a job':W.job===null?'No job — stock':`<span class="mono">${h(W.job.code)}</span>${W.job.client?' · '+h(W.job.client):''}`,W.job===undefined);
  if(p){
    const from={kp:'Kitchen Prep',last:'last time',product:''}[W.sectionFrom]||'';
    out+=row('section','Section',W.section===undefined?'Choose a section':W.section===''?'No section':h(W.section)+(from?` <span class="faint">· ${from}</span>`:''),W.section===undefined);
  }
  if(p&&!opt.noAllergens){
    const alV=W.al.none?'No allergens':W.al.c.length||W.al.m.length?`<span class="al-text">${h(alShort(W.al.c,4))}</span>${W.al.m.length?`<span class="may">${W.al.c.length?' · ':''}may ${h(alShort(W.al.m,3))}</span>`:''}`:(p.src==='oneoff'&&!W.al.chosen?'Set the allergens':'No allergens');
    out+=`<button class="row row-nav${cur==='allergens'?' cur':''}${p.src==='oneoff'&&!W.al.chosen?' todo':''}" data-act="${p.src==='oneoff'?'wiz-go':'wiz-al-jump'}" data-step="allergens"><span class="row-k">Allergens${p.src!=='oneoff'&&!W.al.unlocked?' '+ico('lock','ico-xs'):''}</span><span class="row-v">${alV}</span>${ico('chevron','chev')}</button>`;
  }
  return out;
}
function bodyReview(){
  const p=W.prod;
  const notice=W.reprint&&W.reprint.notice?`<div class="edit-note rv-wide">${ico('warning','ico-sm')}<span>${h(W.reprint.notice)}</span></div>`:'';
  return`<div class="rv">
    ${notice}
    <div class="phone-only lp rv-wide">${previewHTML('lp-phone',W.labels)}</div>
    <section class="rv-sec rv-sum phone-only"><div class="group sum" data-noal="1">${sumRows({noAllergens:true})}</div></section>
    <section class="rv-sec" id="rv-al">${reviewAllergensHTML()}</section>
    <section class="rv-sec" id="rv-store"><div class="group-hd">Storage</div><div class="group${W.statusChosen?'':' need'}"><div class="row row-stack">
      ${W.statusChosen?'':`<div class="need-note">${ico('snowflake','ico-sm')}This usually goes in the freezer — is this batch fresh or frozen?</div>`}
      ${seg([['','Fresh'],['FROZEN',ico('snowflake')+'Frozen'],['THAWED',ico('drop')+'Thawed']],W.statusChosen?W.status:'none','wiz-status','seg-lg seg-block')}
      <div class="dates" id="rv-dates">${datesHTML()}</div></div></div></section>
    <section class="rv-sec"><div class="group-hd">On the label</div><div class="group">
      <div class="row row-stack"><span class="row-k">Made by</span><div class="maker-strip" id="rv-makers">${makersHTML()}</div></div>
      <div class="row row-stack"><span class="row-k">Weight or portions</span>${seg([['none','None'],['weight','Weight'],['portions','Portions']],W.wmode,'wiz-wmode','seg-block')}<div id="rv-w">${weightFieldsHTML()}</div></div>
      <div class="row row-stack"><label class="row-k" for="rv-notes">Notes <span class="faint" style="font-weight:400">· prints on the label</span></label><input class="inp" id="rv-notes" data-in="wiz-notes" value="${h(W.notes)}" placeholder="e.g. Freezer 2 · made without alliums" maxlength="140" autocomplete="off"></div>
    </div>
    ${p&&p.src==='oneoff'?`<div class="group" style="margin-top:16px"><label class="row toggle-row" style="cursor:pointer"><span class="row-main"><span class="row-t">Save as a custom product</span><span class="row-s">It’ll be in the list next time, with these allergens</span></span><span class="switch"><input type="checkbox" data-ch="wiz-save" ${W.saveProduct?'checked':''}><span class="knob"></span></span></label></div>`:''}
    </section>
  </div>`;
}
function makersHTML(){
  const names=S.staff.map(s=>s.name);const list=[...S.staff];
  if(W.staff&&!names.includes(W.staff))list.unshift({id:'x',name:W.staff});
  return list.map(s=>`<button class="maker${W.staff===s.name?' on':''}" data-act="wiz-maker" data-v="${h(s.name)}" aria-pressed="${W.staff===s.name}">${avatarHTML(s)}<span>${h(firstName(s.name))}</span></button>`).join('')||`<span class="muted">No staff loaded</span>`;
}
function alEditNoteHTML(){
  const p=W.prod;const edited=alEdited();const src=p.src==='kp'?'Kitchen Prep':'The saved product';
  return`<div class="edit-note" id="rv-al-note">${ico('warning','ico-sm')}<span>${edited?`Changed for this label only — it prints “allergens edited”, and History shows it. ${src} stays as it is.`:`Changes apply to this label only. ${src} stays as it is.`}</span></div>`;
}
function reviewAllergensHTML(){
  const p=W.prod;if(!p)return'';
  if(p.src!=='oneoff'&&!W.al.unlocked){
    const chips=W.al.none||(!W.al.c.length&&!W.al.m.length)?'<span class="alc sm">No allergens</span>':W.al.c.map(a=>`<span class="alc sm c">${h(a)}</span>`).join('')+W.al.m.map(a=>`<span class="alc sm m">${h(a)} <small>may</small></span>`).join('');
    const why=p.src==='kp'?`From Kitchen Prep${p.alScope==='dish'&&norm(p.comp)!==norm(p.dish)?' — the '+h(p.dish)+' dish’s allergens':''}. Change them there and they change everywhere.`:'From the custom product — edit it in Manage → Products.';
    return`<div class="group-hd">Allergens</div><div class="group"><div class="row row-stack">
      <div class="chips">${chips}</div>
      <div class="lock-note">${ico('lock','ico-sm')}<span>${why}</span></div>
      <div><button class="btn btn-sm" data-act="wiz-al-unlock">${ico('pencil')}Change for this label only</button></div></div></div>`;
  }
  return`<div class="group-hd">Allergens</div><div class="group"><div class="row row-stack">
    ${p.src!=='oneoff'?alEditNoteHTML():''}
    ${alEditorHTML('wiz')}
    ${p.src!=='oneoff'?`<div><button class="btn btn-sm btn-plain" data-act="wiz-al-revert">${ico('back')}Use ${p.src==='kp'?'Kitchen Prep’s':'the saved'} allergens</button></div>`:''}
  </div></div>`;
}
function datesHTML(){
  const today=ymd();
  const warn=W.useby&&W.useby<today?`<div class="warn-note">${ico('warning','ico-sm')}That use-by has passed — this label can’t be printed.</div>`:W.useby===today?`<div class="warn-note soft">${ico('info','ico-sm')}Use by today.</div>`:'';
  const ub=`<div class="fld"><label class="fld-label" for="rv-useby">Use by <span class="hint">· ${h(dayWords(W.useby))}</span></label><input class="inp" type="date" id="rv-useby" data-ch="wiz-date" data-k="useby" value="${h(W.useby)}"><div class="fld-note">${W.usebyManual?`Changed by hand <button class="btn btn-xs btn-plain" data-act="wiz-useby-reset">${ico('refresh')}Back to auto</button>`:'Auto · '+h(usebyRule())}</div></div>`;
  const d=(k,l)=>`<div class="fld"><label class="fld-label" for="rv-${k}">${l} <span class="hint">· ${h(dayWords(W[k]))}</span></label><input class="inp" type="date" id="rv-${k}" data-ch="wiz-date" data-k="${k}" value="${h(W[k])}"></div>`;
  if(W.statusChosen&&W.status==='FROZEN')return d('statusDate','Frozen on')+ub+warn;
  if(W.statusChosen&&W.status==='THAWED')return d('statusDate','Thawed on')+ub+warn;
  return d('made','Made')+ub+warn;
}
function weightFieldsHTML(){
  if(W.wmode==='weight')return`<div class="inline"><input class="inp inp-num" type="number" inputmode="decimal" step="0.01" min="0" data-in="wiz-w" data-k="wtotal" value="${h(W.wtotal)}" placeholder="Weight" aria-label="Weight">${seg([['kg','kg'],['g','g']],W.wunit,'wiz-wunit')}</div>`;
  if(W.wmode==='portions')return`<div class="inline"><input class="inp inp-num" type="number" inputmode="numeric" step="1" min="1" data-in="wiz-w" data-k="wportions" value="${h(W.wportions)}" placeholder="Portions" aria-label="Number of portions"><span class="muted">×</span><input class="inp inp-num" type="number" inputmode="decimal" step="1" min="0" data-in="wiz-w" data-k="wsize" value="${h(W.wsize)}" placeholder="Size (optional)" aria-label="Portion size">${seg([['g','g'],['ml','ml']],W.wsunit,'wiz-wsunit')}</div>`;
  return'';
}

/* ── Side panel: one live label + the summary ─────────────────────────── */
function renderSide(){
  const el=$('#pv-side');if(!el)return;
  if(!$('#side-prev')){el.innerHTML=`<div class="lp"><div class="lp-cap"><b>Label</b><span>62 mm · as it prints</span></div><div id="side-prev"></div><div class="lp-n" id="side-n"></div></div><div class="group sum" id="side-sum"></div><div id="side-go"></div>`;}
  const prev=$('#side-prev');
  if(W.prod){if(!$('#lp-side')){prev.innerHTML=`<div class="lp-paper"><canvas id="lp-side" role="img"></canvas></div>`;}}
  else prev.innerHTML=`<div class="lp-ghost">${ico('tag')}<span>Pick a product —<br>the label builds here as you go</span></div>`;
  const paper=prev.querySelector('.lp-paper');if(paper)paper.classList.toggle('stack',W.labels>1);
  $('#side-n').textContent=W.prod&&W.labels>1?`×${W.labels} labels`:'';
  renderSideSummary();
  $('#side-go').innerHTML=W.prod&&W.step!=='review'&&firstIncomplete()==='review'?`<button class="btn btn-tint btn-block" data-act="wiz-go" data-step="review">${ico('printer')}Go to print</button>`:'';
}
function renderSideSummary(){$$('.sum').forEach(s=>s.innerHTML=sumRows({noAllergens:!!s.dataset.noal}));}
const schedulePreview=debounce(()=>{if(!W||!W.prod)return;const d=wizPayload();paintLabel($('#lp-side'),d);paintLabel($('#lp-phone'),d);},60);
function refreshReviewBits(){
  const a=$('#rv-al');if(a){a.innerHTML=reviewAllergensHTML();syncSegs(a);}
  const d=$('#rv-dates');if(d)d.innerHTML=datesHTML();
  renderSide();renderStepFoot();schedulePreview();
}
function animateOut(){
  if(matchMedia('(prefers-reduced-motion: reduce)').matches)return;
  const c=[$('#lp-side'),$('#lp-phone')].find(x=>x&&x.getBoundingClientRect().width);if(!c)return;
  const r=c.getBoundingClientRect();const img=document.createElement('img');
  img.src=c.toDataURL();img.className='fly';img.alt='';img.style.cssText=`left:${r.left}px;top:${r.top}px;width:${r.width}px`;
  document.body.appendChild(img);requestAnimationFrame(()=>requestAnimationFrame(()=>img.classList.add('go')));setTimeout(()=>img.remove(),800);
}

/* ── Print ───────────────────────────────────────────────────────────── */
async function wizPrint(){
  const p=W.prod;
  if(!p){toast('Pick a product first',{type:'err'});return;}
  if(W.job===undefined){goStep('job');return;}
  if(W.section===undefined){goStep('section');return;}
  if(p.src==='oneoff'&&!W.al.chosen){goStep('allergens');toast('Set the allergens — or tap No allergens',{type:'err'});return;}
  if(!W.statusChosen){const s=$('#rv-store');if(s){s.scrollIntoView({behavior:'smooth',block:'center'});s.classList.remove('pulse');void s.offsetWidth;s.classList.add('pulse');}return;}
  if(!W.staff){toast('Tap who made it',{type:'err'});$('#rv-makers')?.scrollIntoView({block:'center'});return;}
  if(!isYmd(W.useby)){toast('Set a use-by date',{type:'err'});$('#rv-useby')?.focus();return;}
  if(W.useby<ymd()){toast('That use-by date has passed — change it to print',{type:'err'});$('#rv-useby')?.focus();return;}
  if(W.wmode==='weight'&&!(parseFloat(W.wtotal)>0)){toast('Type the weight — or choose None',{type:'err'});$('[data-k=wtotal]')?.focus();return;}
  if(W.wmode==='portions'&&!(parseInt(W.wportions)>0)){toast('Type how many portions — or choose None',{type:'err'});$('[data-k=wportions]')?.focus();return;}
  const payload=wizPayload(),record=wizRecord(payload);
  const item={id:uid(),kind:'standard',payload,record,title:payload.product_name,at:Date.now(),base:{key:p.key,src:p.src,dishId:p.dishId||null,contains:[...p.contains],may:[...p.may],shelfHours:p.shelfHours},
    state:{job:W.job?W.job.code:null,section:W.section,status:W.status,made:W.made,statusDate:W.statusDate,useby:W.useby,usebyManual:W.usebyManual,staff:W.staff,notes:W.notes,labels:W.labels,al:{...W.al}}};
  if(p.src!=='oneoff')pushRecent(p.key);
  if(!W.reprint)setSticky(W.job);
  LS.set('dcps_maker',{name:W.staff,at:Date.now()});
  if(p.src==='oneoff'&&W.saveProduct)saveOneOffProduct(p,W);
  alog('Printed',`${payload.quantity}× ${payload.product_name}${payload.job_code?' · '+payload.job_code:''}${record.allergens_edited?' · allergens edited':''}`);
  animateOut();
  // Instantly ready for the next label; the print carries on in the background.
  W=freshW();W.shield=Date.now()+600;renderStep();const b=$('#step-body');if(b)b.scrollTop=0;focusSearch();
  await sendChecked(item,true);
}
/* Kitchen Prep products: their allergens are checked against Kitchen Prep
   the moment before printing, so a change made a minute ago is never missed. */
const _sending=new Set();   // one send per label run at a time, however it's retried
async function sendChecked(item,fromWizard){
  if(_sending.has(item.id))return{ok:false,inFlight:true};
  _sending.add(item.id);
  try{return await sendCheckedNow(item);}finally{_sending.delete(item.id);}
}
async function sendCheckedNow(item){
  const n=item.payload.quantity,title=item.title;
  toast(`Printing ${plural(n,'label')} — ${title}`,{type:'busy'});
  if(item.base&&item.base.src==='kp'){
    const fresh=await freshKpProduct({key:item.base.key,src:'kp',dishId:item.base.dishId});
    if(fresh===null&&!S.kp.ingKnown){
      addToOutbox(item,{error:'Kitchen Prep isn’t answering and hasn’t loaded on this device yet, so the allergens its ingredients bring can’t be checked',stale:true});renderPrintBanner();updateBadges();
      if(S.view==='print')hideToast();else toast(`${title} wasn’t printed — Kitchen Prep isn’t answering, so its allergens can’t be checked`,{type:'err'});
      return{ok:false,stale:true};
    }
    const alChanged=fresh&&!fresh.gone&&(!sameSet(fresh.contains,item.base.contains)||!sameSet(fresh.may,item.base.may));
    const lifeChanged=fresh&&!fresh.gone&&!(item.state&&item.state.usebyManual)&&item.base.shelfHours!=null&&fresh.shelfHours!==item.base.shelfHours;
    if(fresh&&(fresh.gone||alChanged||lifeChanged)){
      loadKP();
      const why=fresh.gone?'It’s no longer in Kitchen Prep':alChanged?'Kitchen Prep changed its allergens — check them and print again':'Kitchen Prep changed how long it keeps — check the use-by and print again';
      addToOutbox(item,{error:why,stale:true,fresh:fresh.gone?null:fresh});renderPrintBanner();updateBadges();
      if(S.view==='print'){hideToast();if(navigator.vibrate)try{navigator.vibrate([60,60,60]);}catch(e){}}
      else toast(fresh.gone?`${title} wasn’t printed — it’s no longer in Kitchen Prep.`:`${title} wasn’t printed — ${alChanged?'Kitchen Prep changed its allergens a moment ago. Check them':'Kitchen Prep changed how long it keeps. Check the use-by'} and print again.`,{type:'err',action:fresh.gone?null:'Check',onAction:fresh.gone?null:()=>{const it=S.outbox.find(o=>o.id===item.id);if(it){removeFromOutbox(it.id);renderPrintBanner();}reopenItem(item,fresh);}});
      return{ok:false,stale:true};
    }
  }
  const res=await sendItem(item);
  if(res.ok)toast(`Sent ${plural(n,'label')} — ${title}`,{action:'Print again',onAction:()=>printAgain(item)});
  else if(S.view==='print'){hideToast();if(navigator.vibrate)try{navigator.vibrate([60,60,60]);}catch(e){}}
  else if(res.timeout)toast(res.piSaid?`${title}: ${res.error}`:`${title}: the printer didn’t answer in time. It may have printed — check before retrying.`,{type:'err',ms:8000});
  else toast(`${title} didn’t print — ${res.error}`,{type:'err',ms:6000,action:'Retry',onAction:()=>retryOutbox(item.id)});
  renderPrintBanner();updateBadges();
  return res;
}
function printAgain(item){return once('again-'+item.id,()=>sendChecked({...item,id:uid(),payload:{...item.payload,printed_at:hhmm()},record:{...item.record}}));}
function reopenItem(item,fresh){
  const p=fresh&&!fresh.gone?fresh:productByKey(item.base.key);if(!p)return;
  W=freshW();applyPick(p);const s=item.state||{};
  W.job=s.job?jobByCode(s.job):null;W.section=s.section;W.status=s.status||'';W.statusChosen=true;W.made=s.made||ymd();W.statusDate=s.statusDate||ymd();
  if(s.usebyManual&&isYmd(s.useby)){W.useby=s.useby;W.usebyManual=true;}else recalcUseby();
  W.staff=s.staff||W.staff;W.notes=s.notes||'';W.labels=s.labels||1;
  W.reprint={notice:'Kitchen Prep changed this product a moment ago — these are its allergens and use-by now.'};
  W.step='review';W.flow=['product','review'];
  if(S.view!=='print')go('print');else renderPrintView();
}
async function saveOneOffProduct(p,w){
  const cat={'Dessert':'Desserts'}[w.section]||(CUSTOM_CATS.includes(w.section)?w.section:'Other');
  const days=daysBetween(w.made,w.useby);const hrs=w.status||days==null?72:days<=0?12:days*24;
  try{
    forgetKpName(p.name);
    await saveProductRow('POST','products',{name:p.name.replace(/\s—\s/g,' - '),category:cat,menu_type:CUSTOM_MARK,shelf_life_hours:hrs,contains:w.al.none?'':(w.al.c.join(', ')||''),may_contain:w.al.none?null:(w.al.m.join(', ')||null)});
    alog('Added product',p.name+' (from a one-off)');await loadCPS();
    const np=customProducts().find(x=>norm(x.name)===norm(p.name));if(np)pushRecent(np.key);
    if(w.section!==undefined&&np)rememberSection(np,w.section||'');
  }catch(e){toast('Couldn’t save '+p.name+' as a product — '+e.message,{type:'err'});}
}

/* ── Sheets used by the wizard ───────────────────────────────────────── */
function labelsSheet(){
  const picks=[1,2,3,4,5,6,8,10,12,15,20,24,30,40,50];
  openSheet({title:'How many labels?',cls:'narrow',body:`<div class="qty-grid">${picks.map(n=>`<button class="qty${W.labels===n?' on':''}" data-act="wiz-labels-set" data-v="${n}">${n}</button>`).join('')}</div>
    <div class="inline"><input class="inp inp-num" id="qty-other" type="number" inputmode="numeric" min="1" max="50" placeholder="Another number (up to 50)" aria-label="Number of labels"><button class="btn btn-primary" data-act="wiz-labels-other">Set</button></div>`,focus:false});
}

/* ── Load a history row back into the wizard (reprint: same batch) ──── */
function wizFromRecord(r){
  W=freshW();
  const rowC=alList(r.contains),rowM=alList(r.may_contain).filter(x=>!rowC.includes(x));
  let p=productByName(r.product_name),notice='';
  if(!p){p=oneOff(r.product_name,rowC,rowM);}
  applyPick(p);
  if(p.src==='oneoff'){
    const known=!!(rowC.length||rowM.length);
    W.al={c:rowC,m:rowM,none:false,chosen:known,unlocked:false};
    if(!known)notice='The original label didn’t record any allergens — set them before printing.';
  }else if(!sameSet(rowC,p.contains)||!sameSet(rowM,p.may))notice=`The allergens are different from the original label — this one uses ${p.src==='kp'?'Kitchen Prep’s':'the saved product’s'} current allergens.`;
  W.job=r.job_code?jobByCode(r.job_code):null;
  W.section=r.section||'';W.sectionFrom='';
  const st=String(r.label_status||'').toUpperCase();W.status=st==='FROZEN'||st==='THAWED'?st:'';W.statusChosen=true;
  W.made=isYmd(r.date_prepped)?r.date_prepped:ymd();
  W.statusDate=isYmd(r.status_date)?r.status_date:W.made;
  if(isYmd(r.date_useby)){W.useby=r.date_useby;W.usebyManual=W.useby!==autoUseby();}else recalcUseby();
  W.staff=r.staff_name||W.staff;
  W.notes=r.notes||'';
  W.labels=1;
  const wd=String(r.weight_display||'');let m;
  if((m=/^([\d.]+)\s*(kg|g)$/i.exec(wd))){W.wmode='weight';W.wtotal=m[1];W.wunit=m[2].toLowerCase();}
  else if((m=/^×(\d+) portions(?: · ([\d.]+)(g|ml) each)?$/.exec(wd))){W.wmode='portions';W.wportions=m[1];W.wsize=m[2]||'';W.wsunit=m[3]||'g';}
  W.reprint={notice,orig:parseInt(r.quantity)||1};
  W.flow=['product','review'];if(!W.al.chosen)W.flow=['product','allergens','review'];
  W.step=firstIncomplete();
  if(S.view!=='print')go('print');else renderPrintView();
}
