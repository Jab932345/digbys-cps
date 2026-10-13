/* ═══════════════════════════════════════════════════════════════════════
   MANAGE — products, containers, job codes, staff, printer, setup.
   Kitchen Prep's products and events are read-only here by design.
   ═══════════════════════════════════════════════════════════════════════ */
const MG={page:null,ptab:'kp',pq:''};
const MG_PAGES=[
  {id:'products',icon:'tag',title:'Products',group:'Labels'},
  {id:'containers',icon:'box',title:'Containers',group:'Labels'},
  {id:'jobs',icon:'calendar',title:'Job codes',group:'Labels'},
  {id:'staff',icon:'people',title:'Staff',group:'Kitchen'},
  {id:'printer',icon:'printer',title:'Printer',group:'Kitchen'},
  {id:'setup',icon:'checklist',title:'Setup',group:'App',manager:true},
  {id:'backup',icon:'download',title:'Backup',group:'App'},
  {id:'activity',icon:'activity',title:'Activity',group:'App',manager:true},
  {id:'appearance',icon:'moon',title:'Appearance',group:'App'}
];
const SQL_EDITOR='https://supabase.com/dashboard/project/jaajrllkozknilvmdezt/sql/new';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function ago(ts){if(!ts)return'never';const s=Math.round((Date.now()-ts)/1000);if(s<45)return'just now';if(s<3600)return Math.round(s/60)+' min ago';if(s<86400)return Math.round(s/3600)+(Math.round(s/3600)===1?' hour ago':' hours ago');return new Date(ts).toLocaleString('en-GB',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});}
function mgHead(title,sub,acts){return`<div class="ph mg-ph"><button class="btn btn-plain mg-back" data-act="go" data-to="manage">${ico('chevronL')}Manage</button><div class="ph-title">${title}${sub?`<div class="ph-sub">${sub}</div>`:''}</div>${acts?`<div class="ph-acts">${acts}</div>`:''}</div>`;}
function renderManage(sub){
  const wide=matchMedia('(min-width:901px)').matches;
  const ok=MG_PAGES.find(p=>p.id===sub&&(!p.manager||isManager()));
  const page=ok?sub:(wide?'products':null);
  MG.page=page;
  $('#view-manage').innerHTML=`<div class="mg${ok?' detail':''}"><div class="mg-list" id="mg-list"></div><div class="mg-detail" id="mg-detail"></div></div>`;
  renderMgList();if(page)renderMgPage();
}
function renderMgList(){
  const el=$('#mg-list');if(!el)return;
  const groups=[...new Set(MG_PAGES.map(p=>p.group))];
  el.innerHTML=`<div class="ph" style="padding-left:4px;padding-right:4px"><div class="ph-title">Manage</div></div>`+groups.map(g=>{
    const pages=MG_PAGES.filter(p=>p.group===g&&(!p.manager||isManager()));
    return`<div class="group-hd">${g}</div><div class="group">${pages.map(p=>`<button class="row row-nav${MG.page===p.id?' on':''}" data-act="go" data-to="manage/${p.id}">${ico(p.icon)}<span class="row-main"><span class="row-t">${p.title}</span></span>${mgListValue(p.id)}${ico('chevron','chev')}</button>`).join('')}</div>`;
  }).join('')+`<div class="group-hd">Signed in</div><div class="group"><div class="row">${avatarHTML(S.user)}<span class="row-main"><span class="row-t">${h(S.user.name)}</span><span class="row-s">${isManager()?'Manager':'Kitchen'}</span></span></div>
    <button class="row row-nav" data-act="switch-user">${ico('logout')}<span class="row-main"><span class="row-t">Switch user</span></span></button></div><div class="group-ft">Digby's CPS ${APP_VERSION}</div>`;
}
function setupToDo(){return S.ext===false||S.pendingRecords.some(p=>p.error)||oldKpCopies().length>0||uncheckedProducts().length>0||(S.printer.state!=='offline'&&S.printer.info&&!S.printer.info.version);}
function mgListValue(id){
  if(id==='products')return`<span class="row-v num">${S.kp.products.length+customProducts().length||''}</span>`;
  if(id==='containers')return`<span class="row-v num">${containers().length||''}</span>`;
  if(id==='jobs')return`<span class="row-v num">${kpJobs().length+customJobs({current:true}).length||''}</span>`;
  if(id==='printer'){const[cls]=printerText();return`<span class="dot ${cls}"></span>`;}
  if(id==='setup'&&setupToDo())return'<span class="badge badge-warn">To do</span>';
  return'';
}
function renderMgPage(){
  const fn={products:mgProducts,containers:mgContainers,jobs:mgJobs,staff:mgStaff,printer:mgPrinter,setup:mgSetup,backup:mgBackup,activity:mgActivity,appearance:mgAppearance}[MG.page];
  if(fn)fn();
  const d=$('#mg-detail');if(d)syncSegs(d);
}

/* ── Products ─────────────────────────────────────────────────────────── */
function mgProducts(){
  const d=$('#mg-detail');
  d.innerHTML=mgHead('Products',`${S.kp.products.length} from Kitchen Prep · ${customProducts().length} custom`,seg([['kp',ico('lock')+'Kitchen Prep'],['custom','Custom']],MG.ptab,'mg-ptab'))+
    `<div class="bar"><div class="search" style="flex:1 1 220px;max-width:420px">${ico('search')}<input class="inp" type="search" placeholder="Search products" data-in="mg-pq" value="${h(MG.pq)}" autocomplete="off" aria-label="Search products"></div>
    ${MG.ptab==='custom'?`<button class="btn btn-primary btn-sm" data-act="cp-new">${ico('plus')}New product</button>`:`<button class="btn btn-sm" data-act="kp-refresh">${ico('refresh')}Refresh</button><a class="btn btn-sm" href="${KP_APP}" target="_blank" rel="noopener">${ico('external')}Kitchen Prep</a>`}</div>
    <div class="body" id="mg-plist"></div>`;
  renderMgPList();
}
function renderMgPList(){
  const el=$('#mg-plist');if(!el)return;
  const words=norm(MG.pq).split(' ').filter(Boolean);
  const match=p=>!words.length||words.every(w=>norm(p.name+' '+(p.dish||'')+' '+p.cat).includes(w));
  const row=(p,act)=>`<button class="row row-nav" data-act="${act}" data-key="${h(p.key)}"><span class="row-main"><span class="row-t">${prodNameHTML(p)}</span><span class="row-s">${alMetaHTML(p.contains,p.may)}${p.frozen?' · Freezer':''}${p.src==='custom'?' · keeps '+h(p.shelfHours%24?p.shelfHours+' h':plural(p.shelfHours/24,'day')):''}</span></span>${p.src==='kp'?ico('lock','ico-sm faint'):''}${ico('chevron','chev')}</button>`;
  if(MG.ptab==='kp'){
    const info=S.kp.ok===false?`Kitchen Prep isn’t answering — showing what it sent ${S.kp.at?ago(S.kp.at):'last'}.`:S.kp.at?`Updated ${ago(S.kp.at)}.`:'Loading…';
    const note=`<div class="banner info" style="margin:0 0 14px">${ico('lock')}<div class="grow"><div class="banner-t">Kitchen Prep is in charge of these</div><div class="banner-s">Their allergens are locked here — change a recipe in Kitchen Prep and its labels change everywhere. A dish’s allergens go on every part of it. ${h(info)}</div></div></div>`;
    const list=S.kp.products.filter(match);
    if(!list.length){el.innerHTML=note+`<div class="empty">${ico('tag')}<div class="empty-t">${words.length?'Nothing matches':'No products yet'}</div></div>`;return;}
    const secs=[...new Set(list.map(p=>p.section||'Other'))].sort((a,b)=>sectionOrder(a)-sectionOrder(b));
    el.innerHTML=note+secs.map(s=>{const ps=list.filter(p=>(p.section||'Other')===s);return`<div class="group-hd"><span>${h(s)}</span><span class="n">${ps.length}</span></div><div class="group">${ps.map(p=>row(p,'kp-view')).join('')}</div>`;}).join('');
  }else{
    const unchecked=new Set(uncheckedProducts().map(r=>String(r.id)));
    const list=customProducts().filter(p=>!unchecked.has(String(p.id))).filter(match);const old=oldKpCopies();
    const toCheck=uncheckedProducts().filter(r=>match({name:r.name,cat:r.category||''}));
    const checkHTML=toCheck.length&&isManager()?`<div class="group-hd"><span>Check these once</span><span class="n">${toCheck.length}</span></div><div class="group"><div class="row row-stack"><div class="row-s">These were in CPS before this version, so CPS can’t tell whether they’re yours or old copies of Kitchen Prep products. Open each one and Save it if it’s yours — check its allergens and how long it keeps — or delete it.${toCheck.some(r=>kpCopyKind(r)==='maybe')?' Ones that keep exactly '+frozenDays()+' days look like Kitchen Prep freezer copies and aren’t offered for printing until they’re saved.':''}</div></div>
      ${toCheck.map(r=>`<button class="row row-nav" data-act="cp-check" data-id="${h(r.id)}"><span class="row-main"><span class="row-t">${h(r.name)}</span><span class="row-s">${alMetaHTML(alList(r.contains),alList(r.may_contain).filter(x=>!alList(r.contains).includes(x)))} · keeps ${h(parseInt(r.shelf_life_hours)%24?parseInt(r.shelf_life_hours)+' h':plural(Math.round((parseInt(r.shelf_life_hours)||72)/24),'day'))}</span></span><span class="badge badge-warn">Check</span>${ico('chevron','chev')}</button>`).join('')}</div>`:'';
    el.innerHTML=checkHTML+(list.length?`${checkHTML?'<div class="group-hd">Custom products</div>':''}<div class="group">${list.map(p=>row(p,'cp-edit')).join('')}</div><div class="group-ft">For things that aren’t in Kitchen Prep. Anything with the same name as a Kitchen Prep product is replaced by it.</div>`
      :checkHTML&&!words.length?'':`<div class="empty">${ico('tag')}<div class="empty-t">${words.length?'Nothing matches':'No custom products'}</div><div class="empty-s">For things that aren’t in Kitchen Prep — staff food, specials, bought-in items.</div><button class="btn btn-primary" data-act="cp-new">${ico('plus')}New product</button></div>`)
      +(old.length&&isManager()?`<div class="group-hd"><span>Old Kitchen Prep copies</span><span class="n">${old.length}</span></div><div class="group"><div class="row row-stack"><div class="row-s">Kitchen Prep keeps a copy of each product in CPS. These are left over from products renamed or deleted there — they aren’t offered for printing. Remove them to keep things tidy.</div><div class="chips">${old.slice(0,40).map(p=>`<span class="alc sm">${h(p.name)}</span>`).join('')}${old.length>40?`<span class="muted">+${old.length-40}</span>`:''}</div><div><button class="btn btn-sm btn-danger" data-act="cp-tidy">${ico('trash')}Remove ${plural(old.length,'old copy','old copies')}</button></div></div></div>`:'');
  }
}
function kpViewSheet(p){
  const keeps=p.frozen?`Freezer — ${frozenDays()} days frozen`:`${p.shelfHours%24?p.shelfHours+' hours':plural(p.shelfHours/24,'day')} fresh${p.shelfFromKp?'':' (Kitchen Prep’s default)'}`;
  const chips=p.contains.length||p.may.length?p.contains.map(a=>`<span class="alc sm c">${h(a)}</span>`).join('')+p.may.map(a=>`<span class="alc sm m">${h(a)} <small>may</small></span>`).join(''):'<span class="alc sm">No allergens</span>';
  openSheet({title:h(p.name),sub:`<span class="badge badge-kp" style="margin-top:6px">${ico('lock')}Kitchen Prep</span>`,body:`
    <dl class="kv"><dt>Part</dt><dd>${h(p.comp||'—')}</dd><dt>Dish</dt><dd>${h(p.dish||'—')}</dd><dt>Category</dt><dd>${h(p.cat)}</dd><dt>Section</dt><dd>${h(p.section||'Asked when printing')}</dd><dt>Keeps</dt><dd>${h(keeps)}</dd></dl>
    <div class="fld"><span class="fld-label">Allergens${p.alScope==='dish'&&norm(p.comp)!==norm(p.dish)?' — the whole dish’s':''}</span><div class="chips">${chips}</div></div>
    <div class="lock-note">${ico('lock','ico-sm')}<span>Locked. Change them in Kitchen Prep and every label follows. For a one-time difference, use “Change for this label only” when printing.</span></div>`,
    foot:`<a class="btn" href="${KP_APP}" target="_blank" rel="noopener">${ico('external')}Open Kitchen Prep</a><span class="spacer"></span><button class="btn btn-primary" data-act="print-product" data-key="${h(p.key)}">${ico('printer')}Print a label</button>`});
}
let CP=null;
AL_ED.cp={get:()=>({c:[...CP.c],m:[...CP.m],none:CP.none,mode:CP.mode}),set:s=>{CP.c=s.c;CP.m=s.m;CP.none=s.none;CP.mode=s.mode;}};
function cpSheet(p){
  CP=p?{id:p.id,name:p.name,cat:p.cat,hours:p.shelfHours,c:[...p.contains],m:[...p.may],none:!p.contains.length&&!p.may.length&&p.row&&p.row.contains!=null,mode:'c',row:p.row,p}:{id:null,name:'',cat:'Other',hours:72,c:[],m:[],none:false,mode:'c'};
  openSheet({title:p?'Edit product':'New product',sub:'Custom — for things that aren’t in Kitchen Prep',body:`
    <div class="fld"><label class="fld-label" for="cp-name">Name</label><input class="inp inp-lg" id="cp-name" data-in="cp-name" value="${h(CP.name)}" placeholder="e.g. Staff lasagne" autocomplete="off" autofocus></div>
    <div class="fld"><span class="fld-label">Category</span><div class="chips" id="cp-cat">${cpCatHTML()}</div></div>
    <div class="fld"><span class="fld-label">Keeps for, fresh</span><div class="chips" id="cp-life">${cpLifeHTML()}</div></div>
    <div class="fld"><span class="fld-label">Allergens</span>${alEditorHTML('cp')}</div>`,
    foot:`${p?`<button class="btn btn-danger" data-act="cp-del">${ico('trash')}Delete</button><span class="spacer"></span>`:''}<button class="btn" data-act="sheet-close">Cancel</button><button class="btn btn-primary" data-act="cp-save">${p?'Save':'Add product'}</button>`});
}
function cpCatHTML(){return CUSTOM_CATS.map(c=>`<button class="chip${CP.cat===c?' on':''}" data-act="cp-cat" data-v="${h(c)}" aria-pressed="${CP.cat===c}">${h(c)}</button>`).join('');}
function cpLifeHTML(){const o=[[24,'1 day'],[48,'2 days'],[72,'3 days'],[120,'5 days'],[168,'7 days']];const custom=!o.some(x=>x[0]===CP.hours);
  return o.map(([v,l])=>`<button class="chip${CP.hours===v?' on':''}" data-act="cp-life" data-v="${v}" aria-pressed="${CP.hours===v}">${l}</button>`).join('')+`<span class="inline" style="flex:0 0 auto;gap:6px"><input class="inp inp-num" style="width:84px;min-height:36px;padding:4px 8px" type="number" min="1" max="4000" data-in="cp-hours" value="${custom?h(CP.hours):''}" placeholder="—" aria-label="Hours"><span class="muted">hours</span></span>`;}
async function cpSave(){
  if(!CP)return;const name=titleCaseFirst(CP.name).replace(/\s—\s/g,' - ');
  if(!name){toast('Give it a name',{type:'err'});$('#cp-name')?.focus();return;}
  if(kpNameSet().has(norm(name))){toast(`Kitchen Prep already has ${name} — use that one; its allergens stay up to date`,{type:'err'});return;}
  if(customProducts().some(p=>norm(p.name)===norm(name)&&String(p.id)!==String(CP.id))||containers().some(c=>norm(c.name)===norm(name))){toast(`There’s already something called ${name}`,{type:'err'});return;}
  if(!CP.c.length&&!CP.m.length&&!CP.none){toast('Choose its allergens — or tap No allergens',{type:'err'});const a=$('#aled-cp');if(a){a.classList.remove('need');void a.offsetWidth;a.classList.add('need');a.scrollIntoView({behavior:'smooth',block:'center'});}return;}
  const hours=Math.max(1,Math.min(4000,parseInt(CP.hours)||72));
  const body={name,category:CP.cat,menu_type:CUSTOM_MARK,shelf_life_hours:hours,contains:CP.none?'':(CP.c.join(', ')||''),may_contain:CP.none?null:(CP.m.join(', ')||null)};
  try{
    if(CP.id!=null)await saveProductRow('PATCH','products?id=eq.'+encodeURIComponent(CP.id),body);
    else await saveProductRow('POST','products',body);
    alog(CP.id!=null?'Edited product':'Added product',name);forgetKpName(name);
    const was=CP.id;closeSheet();await loadCPS();toast(was!=null?`Saved ${name}`:`Added ${name}`);
  }catch(e){toast('Couldn’t save — '+e.message,{type:'err'});}
}
async function cpDelete(){
  const p=CP&&(customProducts().find(x=>String(x.id)===String(CP.id))||CP.p);if(!p)return;
  try{
    await rest(CPS,'DELETE','products?id=eq.'+encodeURIComponent(p.id));closeSheet();alog('Deleted product',p.name);await loadCPS();
    toast(`Deleted ${p.name}`,{action:'Undo',onAction:()=>once('undo-cp-'+p.id,async()=>{try{await rest(CPS,'POST','products',rowForInsert(p.row),{prefer:'return=minimal'});await loadCPS();toast(`${p.name} is back`);}catch(e){toast('Couldn’t undo — '+e.message,{type:'err'});}})});
  }catch(e){toast('Couldn’t delete — '+e.message,{type:'err'});}
}
async function cpTidy(){
  const old=oldKpCopies();if(!old.length)return;
  try{
    for(const r of old)await rest(CPS,'DELETE','products?id=eq.'+encodeURIComponent(r.id));
    alog('Removed old Kitchen Prep copies',plural(old.length,'product'));await loadCPS();
    toast(`Removed ${plural(old.length,'old copy','old copies')}`,{action:'Undo',onAction:()=>once('undo-tidy',async()=>{try{await rest(CPS,'POST','products',old.map(rowForInsert),{prefer:'return=minimal'});await loadCPS();toast('Put back');}catch(e){toast('Couldn’t undo — '+e.message,{type:'err'});}})});
  }catch(e){toast('Couldn’t remove them — '+e.message,{type:'err'});await loadCPS();}
}

/* ── Containers ───────────────────────────────────────────────────────── */
function mgContainers(){
  const list=containers();const missing=DRY_STORE.filter(([n])=>!list.some(c=>norm(c.name)===norm(n))).length;
  $('#mg-detail').innerHTML=mgHead('Containers','Dry store and walk-in tubs',`<button class="btn btn-primary btn-sm" data-act="ct-new">${ico('plus')}New container</button>`)+`<div class="body narrow">
    ${list.length?byShelf(list).map(([s,l])=>`<div class="group-hd"><span>${h(s)}</span><span class="n">${l.length}</span></div><div class="group">${l.map(c=>`<button class="row row-nav" data-act="ct-edit-id" data-id="${h(c.id)}"><span class="row-main"><span class="row-t">${h(c.name)}</span><span class="row-s">${c.checked?alMetaHTML(c.contains,c.may):'Allergens not set'}</span></span>${c.checked?'':'<span class="badge badge-warn">Check</span>'}${ico('chevron','chev')}</button>`).join('')}</div>`).join(''):`<div class="empty">${ico('box')}<div class="empty-t">No containers yet</div></div>`}
    ${missing?`<div style="margin-top:14px"><button class="btn" data-act="ct-seed">Add flour and sugar</button></div>`:''}
    <div class="group-ft" style="margin-top:8px">Print them from Containers — tap a tub, tap it again for another label.</div></div>`;
}

/* ── Job codes ────────────────────────────────────────────────────────── */
function mgJobs(){
  const kp=kpEvents().filter(e=>e.event_date>=ymd()),cu=customJobs();
  $('#mg-detail').innerHTML=mgHead('Job codes','Kitchen Prep events bring their own codes',`<button class="btn btn-primary btn-sm" data-act="jc-new">${ico('plus')}New job code</button>`)+`<div class="body narrow">
    <div class="group-hd"><span>From Kitchen Prep</span><span class="n">${kp.length}</span></div>
    <div class="group">${kp.map(e=>`<div class="row">${ico('lock','ico-sm faint')}<span class="row-main"><span class="row-t">${e.job_code?`<span class="mono">${h(e.job_code)}</span> · `:'<span class="faint">No job code</span> · '}${h(e.client_name)}</span><span class="row-s">${h(dayWords(e.event_date))}${e.covers?' · '+e.covers+' covers':''}${e.job_code?'':' · add one in Kitchen Prep to label for it'}</span></span>${e.status?`<span class="badge st-${h(e.status)}">${h(e.status)}</span>`:''}</div>`).join('')||`<div class="row muted">${S.kp.ok===false?'Kitchen Prep isn’t answering':'No events coming up'}</div>`}</div>
    <div class="group-ft">Add the event in Kitchen Prep and its code appears here — and in Kitchen Prep’s own labels.</div>
    <div class="group-hd"><span>Made in CPS</span><span class="n">${cu.length}</span></div>
    <div class="group">${cu.map(j=>`<div class="row"><span class="row-main"><span class="row-t mono">${h(j.code)}</span><span class="row-s">${h(j.client||'')}${j.date&&j.date<addDays(ymd(),-7)?' · finished — no longer offered when printing':''}</span></span><button class="btn btn-sm btn-plain" data-act="jc-del" data-id="${h(j.id)}" aria-label="Delete ${h(j.code)}">${ico('trash')}</button></div>`).join('')||'<div class="row muted">None — make one for a job that isn’t in Kitchen Prep</div>'}</div></div>`;
}
let JC=null;
function jcCode(){
  const ini=String(JC.client).trim().split(/\s+/).filter(Boolean).map(w=>w[0]).join('').toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,3)||'XXX';
  const d=parseYmd(JC.date);return ini+(d?pad(d.getDate())+pad(d.getMonth()+1)+String(d.getFullYear()).slice(2):'DDMMYY')+JC.type;
}
function jcSheet(){
  JC={client:'',date:ymd(),type:'PRIV',desc:''};
  openSheet({title:'New job code',sub:'For a job that isn’t in Kitchen Prep',body:`
    <div class="code-out" id="jc-out">${h(jcCode())}</div>
    <div class="fld"><label class="fld-label" for="jc-client">Client</label><input class="inp" id="jc-client" data-in="jc" data-k="client" placeholder="e.g. Sarah Jones" autocomplete="off" autofocus></div>
    <div class="fld"><label class="fld-label" for="jc-date">Date</label><input class="inp" type="date" id="jc-date" data-ch="jc" data-k="date" value="${JC.date}"></div>
    <div class="fld"><span class="fld-label">Type</span><div class="chips" id="jc-type">${jcTypeHTML()}</div></div>
    <div class="fld"><label class="fld-label" for="jc-desc">Description <span class="faint">· optional</span></label><input class="inp" id="jc-desc" data-in="jc" data-k="desc" placeholder="Shown next to the code" autocomplete="off"></div>`,
    foot:`<button class="btn" data-act="sheet-close">Cancel</button><button class="btn btn-primary" data-act="jc-save">Add job code</button>`});
}
function jcTypeHTML(){return Object.entries(EV_TYPES).map(([k,v])=>`<button class="chip${JC.type===k?' on':''}" data-act="jc-type" data-v="${k}" aria-pressed="${JC.type===k}">${h(v)}</button>`).join('');}
async function jcSave(){
  if(!JC)return;
  if(!JC.client.trim()){toast('Type the client’s name',{type:'err'});$('#jc-client')?.focus();return;}
  if(!isYmd(JC.date)){toast('Choose the date',{type:'err'});return;}
  const code=jcCode();
  if(allKpCodes().has(code)||customJobs().some(j=>j.code===code)){toast(`${code} already exists`,{type:'err'});return;}
  const d=parseYmd(JC.date);
  const description=JC.desc.trim()||`${JC.client.trim()} · ${d.getDate()} ${d.toLocaleDateString('en-GB',{month:'short'})}`;
  try{await rest(CPS,'POST','job_codes',{code,description},{prefer:'return=minimal'});alog('Added job code',code);closeSheet();await loadCPS();toast(`Added ${code}`);}
  catch(e){toast('Couldn’t save — '+e.message,{type:'err'});}
}
async function jcDelete(id){
  const j=customJobs().find(x=>String(x.id)===String(id));if(!j)return;
  try{await rest(CPS,'DELETE','job_codes?id=eq.'+encodeURIComponent(id));alog('Deleted job code',j.code);await loadCPS();
    toast(`Deleted ${j.code}`,{action:'Undo',onAction:()=>once('undo-jc-'+id,async()=>{try{await rest(CPS,'POST','job_codes',{code:j.row.code,description:j.row.description},{prefer:'return=minimal'});await loadCPS();toast(`${j.code} is back`);}catch(e){toast('Couldn’t undo — '+e.message,{type:'err'});}})});
  }catch(e){toast('Couldn’t delete — '+e.message,{type:'err'});}
}

/* ── Staff ────────────────────────────────────────────────────────────── */
function mgStaff(){
  const m=isManager();
  $('#mg-detail').innerHTML=mgHead('Staff','Who can sign in and print',m?`<button class="btn btn-primary btn-sm" data-act="st-new">${ico('plus')}Add someone</button>`:'')+`<div class="body narrow">
    <div class="group">${S.staff.map(s=>m?`<button class="row row-nav" data-act="st-edit" data-id="${h(s.id)}">${avatarHTML(s)}<span class="row-main"><span class="row-t">${h(s.name)}</span><span class="row-s">${s.name===MANAGER?'Manager':'Kitchen'}</span></span>${ico('chevron','chev')}</button>`
      :`<div class="row">${avatarHTML(s)}<span class="row-main"><span class="row-t">${h(s.name)}</span><span class="row-s">${s.name===MANAGER?'Manager':'Kitchen'}</span></span></div>`).join('')||'<div class="row muted">No staff loaded</div>'}</div>
    ${m?'':'<div class="group-ft">Only the manager can add people or change PINs.</div>'}</div>`;
}
let SF=null;
function staffSheet(s){
  SF=s?{id:s.id,name:s.name,pin:''}:{id:null,name:'',pin:''};
  const canRemove=s&&s.name!==MANAGER&&String(s.id)!==String(S.user.id);
  openSheet({title:s?h(s.name):'Add someone',cls:'narrow',body:`
    ${s?'':`<div class="fld"><label class="fld-label" for="sf-name">Full name</label><input class="inp" id="sf-name" data-in="sf" data-k="name" placeholder="e.g. Ellie Marsh" autocomplete="off" autofocus></div>`}
    <div class="fld"><label class="fld-label" for="sf-pin">${s?'New PIN':'PIN'} — 4 numbers</label><input class="inp inp-lg inp-num" id="sf-pin" data-in="sf" data-k="pin" inputmode="numeric" maxlength="4" autocomplete="off" placeholder="••••" ${s?'autofocus':''}></div>`,
    foot:`${canRemove?`<button class="btn btn-danger" data-act="sf-del">${ico('trash')}Remove</button><span class="spacer"></span>`:''}<button class="btn" data-act="sheet-close">Cancel</button><button class="btn btn-primary" data-act="sf-save">${s?'Change PIN':'Add'}</button>`});
}
async function sfSave(){
  if(!SF)return;const pin=String(SF.pin).trim();
  if(!/^\d{4}$/.test(pin)){toast('The PIN is 4 numbers',{type:'err'});$('#sf-pin')?.focus();return;}
  try{
    if(SF.id!=null){await rest(CPS,'PATCH','staff?id=eq.'+encodeURIComponent(SF.id),{pin},{prefer:'return=minimal'});alog('Changed PIN',SF.name);closeSheet();toast(`Changed ${firstName(SF.name)}’s PIN`);}
    else{
      const name=titleCase(SF.name);if(!name){toast('Type their name',{type:'err'});$('#sf-name')?.focus();return;}
      if(S.staff.some(x=>norm(x.name)===norm(name))){toast(`${name} is already here`,{type:'err'});return;}
      await rest(CPS,'POST','staff',{name,pin,initials:initials(name),color:COLS[S.staff.length%COLS.length]},{prefer:'return=minimal'});alog('Added staff',name);closeSheet();toast(`Added ${name}`);
    }
    await loadStaff();if(MG.page==='staff')mgStaff();
  }catch(e){toast('Couldn’t save — '+e.message,{type:'err'});}
}
async function sfDelete(){
  const s=S.staff.find(x=>String(x.id)===String(SF&&SF.id));if(!s)return;
  try{await rest(CPS,'DELETE','staff?id=eq.'+encodeURIComponent(s.id));alog('Removed staff',s.name);closeSheet();await loadStaff();if(MG.page==='staff')mgStaff();
    toast(`Removed ${s.name}`,{action:'Undo',onAction:()=>once('undo-sf-'+s.id,async()=>{try{await rest(CPS,'POST','staff',{name:s.name,pin:s.pin,initials:s.initials||initials(s.name),color:s.color||null},{prefer:'return=minimal'});await loadStaff();if(MG.page==='staff')mgStaff();toast(`${s.name} is back`);}catch(e){toast('Couldn’t undo — '+e.message,{type:'err'});}})});}
  catch(e){toast('Couldn’t remove — '+e.message,{type:'err'});}
}

/* ── Printer ──────────────────────────────────────────────────────────── */
function mgPrinter(){renderMgPrinter();checkPrinter();latestPiVersion().then(()=>{if(MG.page==='printer')renderMgPrinter();});}
function renderMgPrinter(){
  const d=$('#mg-detail');if(!d||MG.page!=='printer'||S.view!=='manage')return;
  const keepUrl=$('#pr-url')&&document.activeElement===$('#pr-url')?$('#pr-url').value:null;
  const p=S.printer,info=p.info||{};const[cls,t,sub]=printerText();const m=isManager();
  const ver=info.version||null,latest=_latestPi,canUpdate=!!(ver&&latest&&newerVersion(latest,ver)&&info.updatable);
  const oldServer=p.state!=='offline'&&p.info&&!ver;
  const help=p.state==='offline'?`<div class="group-ft" style="padding-bottom:4px">Check, in order: the Pi is plugged in (green light) · the Mango router is on · wait a minute after switching on. Then tap Check.</div>`
    :p.state==='noprinter'||p.state==='searching'?`<div class="group-ft" style="padding-bottom:4px">The Pi is fine but can’t see the printer. Check it’s on, has labels, and is on the Digbys-BOH Wi-Fi (Wi-Fi light steady). The Pi keeps looking by itself.</div>`:'';
  const rows=[['Print server',ver?'Version '+ver:oldServer?'Older version':'—'],['Printer',info.usb?'USB'+(info.printer_ip?' · Wi-Fi '+info.printer_ip:''):info.printer_ip?'Wi-Fi '+info.printer_ip:(p.state==='ready'?'Connected':'—')],['This iPad reaches it',ON_PI?'Kitchen Wi-Fi — direct':'Internet (tunnel)'],['USB',info.usb?'Plugged in':info.usb_support?'Ready — plug the printer into the Pi':ver?'Not set up — run the update over SSH once':'—'],['Pi',info.pi_ip||'—'],['Receipt printer',info.receipt?'Connected':'—'],['Checked',p.at?ago(p.at):'—']];
  const lan=info.pi_ip&&info.lan_app?`http://${info.pi_ip}:3000`:'';
  d.innerHTML=mgHead('Printer','Brother QL-820 on the Pi')+`<div class="body narrow">
    <div class="group"><div class="stat"><span class="dot ${cls}"></span><div class="grow"><div class="stat-t">${h(t)}</div><div class="stat-s">${h(sub||'')}</div></div><button class="btn btn-sm" data-act="pr-check">${ico('refresh')}Check</button></div></div>${help}
    <div class="group-hd">Details</div><div class="group">${rows.map(([k,v])=>`<div class="row"><span class="row-k">${k}</span><span class="row-v">${h(v)}</span></div>`).join('')}</div>
    ${ON_PI?`<div class="group-hd">Kitchen Wi-Fi</div><div class="group"><div class="row row-stack"><div class="row-t">Printing straight to the Pi</div><div class="row-s">This copy of CPS comes from the Pi, so labels print even when the internet is down. Products, allergens and History still need the internet to update.</div></div></div>`
      :lan?`<div class="group-hd">Kitchen Wi-Fi</div><div class="group"><div class="row row-stack"><div class="row-t">Faster, and prints without the internet</div><div class="row-s">On the Digbys-BOH Wi-Fi, open CPS from the Pi and add it to the Home Screen. Sign in once while the internet is up.</div><div class="code">${h(lan)}</div><div class="inline"><a class="btn btn-sm btn-primary" href="${h(lan)}" target="_blank" rel="noopener">${ico('external')}Open</a><button class="btn btn-sm" data-act="copy" data-v="${h(lan)}">${ico('copy')}Copy</button></div></div></div>`:''}
    <div class="group-hd">Test</div><div class="group"><button class="row row-nav" data-act="pr-test" ${p.state==='offline'?'disabled':''}>${ico('printer')}<span class="row-main"><span class="row-t">Print a test label</span><span class="row-s">A short label marked TEST</span></span></button></div>
    ${m?`<div class="group-hd">Print server</div><div class="group">
      ${canUpdate?`<div class="row row-stack"><div><div class="row-t">Update ready — version ${h(latest)}</div><div class="row-s">About 20 seconds. Printing pauses while it restarts.</div></div><div><button class="btn btn-primary" data-act="pr-update">Update print server</button></div></div>`:''}
      ${ver&&!info.updatable?`<div class="row row-stack"><div class="row-s">To update from here, run this once on the Pi over SSH:</div><div class="code">${PI_UPDATE_CMD}</div><div><button class="btn btn-sm" data-act="copy" data-v="${h(PI_UPDATE_CMD)}">${ico('copy')}Copy</button></div></div>`:''}
      ${oldServer?`<div class="row row-stack"><div class="row-t">Update the print server once</div><div class="row-s">The Pi runs the older print server. The new one finds the printer by itself when the router changes, keeps the receipt printer and butchery labels working, and updates from here after this. On the Pi, over SSH:</div><div class="code">${PI_UPDATE_CMD}</div><div><button class="btn btn-sm" data-act="copy" data-v="${h(PI_UPDATE_CMD)}">${ico('copy')}Copy</button></div></div>`:''}
      ${ver&&info.updatable&&!canUpdate?`<div class="row"><span class="row-main"><span class="row-t">Up to date</span><span class="row-s">Version ${h(ver)}</span></span>${ico('checkCircle')}</div>`:''}
      ${!ver&&!oldServer?`<div class="row muted">Shown when the Pi answers.</div>`:''}
    </div>
    ${ON_PI?'':`<div class="group-hd">Address</div><div class="group"><div class="row row-stack"><label class="fld-label" for="pr-url">Where the Pi is reached over the internet — Kitchen Prep uses the same one</label>
      <div class="inline"><input class="inp" id="pr-url" value="${h(keepUrl??printerBase())}" autocomplete="off" spellcheck="false" autocapitalize="off"><button class="btn" data-act="pr-save-url">Save</button></div></div></div>`}
    <div class="group-hd">Pi</div><div class="group"><button class="row row-nav" data-act="pr-shutdown">${ico('power')}<span class="row-main"><span class="row-t al-text">Shut down the Pi</span><span class="row-s">Before unplugging it</span></span></button></div>`:''}
  </div>`;
}
async function prTest(){
  const today=ymd();
  const payload={product_name:'TEST',staff_name:S.user.name,section:'Test',job_code:'TEST',quantity:1,date_prepped:today,date_useby:today,contains:null,may_contain:null,notes:'Test print from Digby’s CPS',printed_at:hhmm(),source_note:'Test',job_id:'test-'+uid()};
  toast('Printing a test label',{type:'busy'});
  const r=await sendToPrinter(payload);
  if(r.ok)toast('Test label sent to the printer');else toast('Test didn’t print — '+r.error,{type:'err'});
}
async function prUpdate(){
  if(!await askConfirm('Printing pauses for about 20 seconds while the print server restarts.',{title:'Update the print server?',ok:'Update',danger:false}))return;
  const from=(S.printer.info||{}).version;
  try{await piCall('POST','/update',null,15000);}catch(e){toast('Couldn’t start the update — '+e.message,{type:'err'});return;}
  toast('Updating the print server…',{type:'busy',ms:130000});
  const t0=Date.now();
  while(Date.now()-t0<120000){
    await sleep(4000);const p=await checkPrinter();const v=p.info&&p.info.version;
    if(v&&v!==from){alog('Updated print server',(from||'?')+' → '+v);toast(`Print server updated to ${v}`);renderMgPrinter();return;}
  }
  toast('The update is taking longer than usual — tap Check in a minute',{type:'err'});
}
async function prSaveUrl(){
  let u=String($('#pr-url').value||'').trim();
  if(!u){toast('Type the address',{type:'err'});return;}
  if(!/^https?:\/\//i.test(u))u='https://'+u;
  let url;try{url=new URL(u);}catch(e){toast('That doesn’t look like an address',{type:'err'});return;}
  if(url.protocol!=='https:'||/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|127\.|localhost$)|\.local$/i.test(url.hostname)){toast('This is the internet address (the ngrok one, https://…). The kitchen Wi-Fi address is only for opening CPS from the Pi.',{type:'err',ms:8000});return;}
  u=u.replace(/\/(print|status|butchery\/label)?\/*$/,'');
  try{
    const rows=await rest(KP,'PATCH','app_settings?key=eq.butchery_printer_url',{value:u},{prefer:'return=representation'});
    if(!rows||!rows.length)await rest(KP,'POST','app_settings',{key:'butchery_printer_url',value:u},{prefer:'return=minimal'});
    S.kp.settings.butchery_printer_url=u;alog('Changed printer address',u);
    toast('Saved — Kitchen Prep uses it too');checkPrinter();
  }catch(e){toast('Couldn’t save it in Kitchen Prep — '+e.message,{type:'err'});}
}
async function prShutdown(){
  if(!await askConfirm('Wait for the green light to stop flashing before unplugging it. To start it again, unplug it and plug it back in.',{title:'Shut down the Pi?',ok:'Shut down'}))return;
  try{await piCall('POST','/shutdown',null,8000);}catch(e){}
  alog('Shut down the Pi','');
  S.printer={state:'offline',info:null,at:Date.now(),error:'Shut down'};renderPrinterPill();renderMgPrinter();
  toast('The Pi is shutting down — unplug it once the green light stops');
}

/* ── Setup (manager) ──────────────────────────────────────────────────── */
async function mgSetup(){
  const d=$('#mg-detail');
  const row=(id,t)=>`<div class="chk wait" id="chk-${id}"><span class="spin" style="width:18px;height:18px"></span><div class="grow"><div class="chk-t">${t}</div><div class="chk-s">Checking…</div></div></div>`;
  const stuck=S.pendingRecords.filter(p=>p.error);
  d.innerHTML=mgHead('Setup','Checks that everything is connected',`<button class="btn btn-sm" data-act="go-setup">${ico('refresh')}Check again</button>`)+`<div class="body narrow"><div class="group">${row('cps','CPS database')}${row('kp','Kitchen Prep')}${row('ext','History details')}${row('pi','Print server')}${S.pendingRecords.length?row('pend','History waiting to upload'):''}${oldKpCopies().length?row('old','Old Kitchen Prep copies'):''}</div></div>`;
  const set=(id,ok,t,s,acts)=>{const el=$('#chk-'+id);if(!el)return;el.className='chk '+(ok===true?'ok':ok===false?'bad':'wait');el.innerHTML=`${ico(ok===true?'checkCircle':ok===false?'warning':'info')}<div class="grow"><div class="chk-t">${t}</div><div class="chk-s">${s}</div>${acts?`<div class="chk-acts">${acts}</div>`:''}</div>`;};
  rest(CPS,'GET','products?select=id&limit=1').then(()=>set('cps',true,'CPS database','Connected — products, staff, job codes and history.'),e=>set('cps',false,'CPS database',h(e.message)));
  (async()=>{await loadKP();if(S.kp.ok)set('kp',true,'Kitchen Prep',`${S.kp.products.length} products and ${kpEvents().filter(e=>e.event_date>=ymd()).length} events coming up. Allergens and job codes come from here.`);else set('kp',false,'Kitchen Prep',h(S.kp.error||'Not answering'),`<button class="btn btn-sm" data-act="go-setup">${ico('refresh')}Retry</button>`);})();
  probeExt().then(ok=>{if(ok)set('ext',true,'History details','Each label records whether it came from Kitchen Prep, was custom or a one-off, and whether its allergens were changed.');
    else if(ok===false)set('ext',false,'History details',`Optional. Run this once in Supabase (CPS project → SQL editor) so History shows where each label came from and flags changed allergens. Printing works without it.<div class="code" style="margin-top:8px">${h(SQL_SETUP)}</div>`,`<button class="btn btn-sm" data-act="copy" data-v="${h(SQL_SETUP)}">${ico('copy')}Copy SQL</button><a class="btn btn-sm" href="${SQL_EDITOR}" target="_blank" rel="noopener">${ico('external')}Open the SQL editor</a>`);
    else set('ext',null,'History details','Couldn’t check — no connection.');});
  checkPrinter().then(p=>{const v=p.info&&p.info.version;
    if(p.state==='offline')set('pi',false,'Print server',h(p.error||'Can’t reach the Pi'),`<button class="btn btn-sm" data-act="go" data-to="manage/printer">Printer</button>`);
    else if(!v)set('pi',false,'Print server','The Pi runs the older print server. Update it once so it finds the printer by itself when the router changes.',`<button class="btn btn-sm" data-act="copy" data-v="${h(PI_UPDATE_CMD)}">${ico('copy')}Copy the command</button><button class="btn btn-sm" data-act="go" data-to="manage/printer">Printer</button>`);
    else set('pi',p.state==='ready',`Print server ${h(v)}`,p.state==='ready'?'Printer found'+(p.info.printer_ip?' at '+h(p.info.printer_ip):'')+'.':h(printerText()[1]),p.state==='ready'?'':`<button class="btn btn-sm" data-act="go" data-to="manage/printer">Printer</button>`);});
  if(S.pendingRecords.length){
    if(stuck.length)set('pend',false,'History that couldn’t be saved',`${plural(stuck.length,'label')} printed but the database refused the record: “${h(stuck[0].error)}”.`,`<button class="btn btn-sm" data-act="flush-records">Try again</button><button class="btn btn-sm" data-act="copy" data-v="${h(JSON.stringify(stuck.map(p=>p.rec)))}">${ico('copy')}Copy them</button><button class="btn btn-sm btn-danger" data-act="discard-stuck">Discard</button>`);
    else set('pend',null,'History waiting to upload',`${plural(S.pendingRecords.length,'label')} printed while the database couldn’t be reached. They upload by themselves.`,`<button class="btn btn-sm" data-act="flush-records">Upload now</button>`);
  }
  if(oldKpCopies().length)set('old',false,'Old Kitchen Prep copies',`${plural(oldKpCopies().length,'product')} left over from products renamed or deleted in Kitchen Prep. They’re not offered for printing.`,`<button class="btn btn-sm" data-act="cp-tidy">${ico('trash')}Remove them</button>`);
}

/* ── Backup, activity, appearance ─────────────────────────────────────── */
function mgBackup(){
  $('#mg-detail').innerHTML=mgHead('Backup','Spreadsheets of everything in CPS')+`<div class="body narrow"><div class="group">
    ${[['bk-history','Print history','Every label, with where it came from'],['bk-products','Custom products and containers','Kitchen Prep keeps its own'],['bk-jobs','Job codes','Kitchen Prep’s and the ones made here'],['bk-staff','Staff','Names only — no PINs']].map(([a,t,s])=>`<button class="row row-nav" data-act="${a}">${ico('download')}<span class="row-main"><span class="row-t">${t}</span><span class="row-s">${s}</span></span></button>`).join('')}</div></div>`;
}
async function backup(kind){
  try{
    if(kind==='bk-history'){
      toast('Preparing…',{type:'busy'});
      const rows=await rest(CPS,'GET','print_jobs?select=*&order=created_at.desc&limit=20000',undefined,{timeout:30000})||[];
      const keys=[...new Set(rows.flatMap(r=>Object.keys(r)))];
      await saveCSV([keys,...rows.map(r=>keys.map(k=>r[k]))],`digbys-print-history-${ymd()}.csv`);hideToast();
    }else if(kind==='bk-products'){
      const keys=['name','category','shelf_life_hours','contains','may_contain','created_at'];
      await saveCSV([keys,...S.cps.products.map(p=>keys.map(k=>p[k]))],`digbys-products-${ymd()}.csv`);
    }else if(kind==='bk-jobs'){
      await saveCSV([['code','client or description','date','from'],...kpJobs().map(j=>[j.code,j.client,j.date,'Kitchen Prep']),...customJobs().map(j=>[j.code,j.client,j.date||'','CPS'])],`digbys-job-codes-${ymd()}.csv`);
    }else if(kind==='bk-staff'){
      await saveCSV([['name','initials'],...S.staff.map(s=>[s.name,s.initials||initials(s.name)])],`digbys-staff-${ymd()}.csv`);
    }
  }catch(e){toast('Couldn’t export — '+e.message,{type:'err'});}
}
function mgActivity(){
  const l=LS.get('_dcps_a',[]);
  $('#mg-detail').innerHTML=mgHead('Activity','What’s been done on this device',`<button class="btn btn-sm" data-act="act-csv" ${l.length?'':'disabled'}>${ico('download')}Export</button>`)+`<div class="body narrow">
    ${l.length?`<div class="group">${l.slice(0,400).map(e=>`<div class="row"><span class="row-main"><span class="row-t">${h(e.action)}${e.detail?` <span class="muted" style="font-weight:400">— ${h(e.detail)}</span>`:''}</span><span class="row-s">${h(e.who)} · ${h(e.when)}</span></span></div>`).join('')}</div>`:`<div class="empty">${ico('activity')}<div class="empty-t">Nothing yet</div></div>`}</div>`;
}
function mgAppearance(){
  const t=LS.get('dcps_theme','auto');
  $('#mg-detail').innerHTML=mgHead('Appearance')+`<div class="body narrow"><div class="group"><div class="row row-stack"><span class="row-k">Theme</span>${seg([['auto','Automatic'],['light','Light'],['dark','Dark']],t,'theme','seg-lg seg-block')}</div></div><div class="group-ft">Automatic follows the device. Labels always preview on white — they print on white.</div></div>`;
}
