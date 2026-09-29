/* ═══════════════════════════════════════════════════════════════════════
   HISTORY — every label, newest first, with where it came from. Tap one
   to see the label itself and print it again (same batch, same dates).
   ═══════════════════════════════════════════════════════════════════════ */
const HI={rows:[],loaded:false,loading:false,error:null,q:'',filter:'all',limit:300,more:false};
function rowKind(r){
  if(r.label_type)return r.label_type;
  const n=String(r.product_name||'');
  if(r.section==='Plates'||/^Plate · /.test(n))return'plate';
  if(r.section==='Containers'||r.section==='Storage')return'container';
  if(/^\[Custom\]/.test(n))return'freeform';
  return'standard';
}
function rowSource(r){
  if(r.source)return r.source;
  const k=rowKind(r);if(k!=='standard')return k;
  const n=norm(r.product_name);
  if(kpNameSet().has(n)||/^(FRIDGE|FREEZER)$/.test(r.label_status||''))return'kitchen-prep';
  if(customProducts().some(p=>norm(p.name)===n))return'custom';
  return'one-off';
}
function rowWaiting(r){return/^(FRIDGE|FREEZER)$/.test(String(r.label_status||''));}
function rowDay(r){if(r.created_at){const d=new Date(r.created_at);if(!isNaN(d))return ymd(d);}return isYmd(r.date_prepped)?r.date_prepped:'';}
function rowTime(r){if(r.printed_at&&/^\d{1,2}:\d{2}/.test(r.printed_at))return String(r.printed_at).slice(0,5);if(r.created_at){const d=new Date(r.created_at);if(!isNaN(d))return hhmm(d);}return'';}
function rowName(r){const k=rowKind(r);const n=String(r.product_name||'');return k==='plate'?n.replace(/^Plate · /,''):k==='freeform'?n.replace(/^\[Custom\]\s*/,''):n;}
function rowKey(r){return r._pid?'p:'+r._pid:'r:'+r.id;}
function rowQty(r){const s=String(r.quantity??1).trim();return/^\d+$/.test(s)?parseInt(s):1;}
function qtyText(r){const s=String(r.quantity??1).trim();return/^\d+$/.test(s)?'×'+s:s;}
function rowBadges(r){
  const kind=rowKind(r),src=rowSource(r),b=[];
  if(kind==='plate')b.push(`<span class="badge">${ico('plate')}Plate</span>`);
  else if(kind==='container')b.push(`<span class="badge">${ico('box')}Container</span>`);
  else if(kind==='freeform')b.push('<span class="badge badge-one">Free text</span>');
  else if(src==='kitchen-prep')b.push(`<span class="badge badge-kp">${ico('lock')}Kitchen Prep</span>`);
  else if(src==='custom')b.push('<span class="badge badge-custom">Custom</span>');
  else b.push('<span class="badge badge-one">One-off</span>');
  const st=String(r.label_status||'').toUpperCase();
  if(st==='FROZEN'||st==='FREEZER')b.push(`<span class="badge badge-frz">${ico('snowflake')}Frozen</span>`);
  if(st==='THAWED')b.push(`<span class="badge badge-warn">${ico('drop')}Thawed</span>`);
  if(rowWaiting(r))b.push(`<span class="badge badge-warn">${ico('clock')}${rowDay(r)>=addDays(ymd(),-3)?'Waiting to print':'Never printed'}</span>`);
  if(st==='DISMISSED')b.push('<span class="badge">Not printed</span>');
  if(r.allergens_edited)b.push(`<span class="badge badge-warn">${ico('pencil')}Allergens edited</span>`);
  if(r._pending)b.push(`<span class="badge">${ico('clock')}Not uploaded yet</span>`);
  return b.join('');
}
function rowPayload(r){
  const kind=rowKind(r);
  if(kind==='plate'){const m=/^T(\S*) P(\S*)(?: · (.*))?$/.exec(r.notes||'')||[];return{plate:true,guest_name:rowName(r),table:m[1]||'',position:m[2]||'',dietary:r.contains||'',dish:m[3]||'',urgency:String(r.label_status||'allergy').toLowerCase(),printed_at:rowTime(r)};}
  if(kind==='container')return{storage:true,product_name:r.product_name,date_prepped:r.date_prepped,contains:r.contains,may_contain:r.may_contain,notes:r.notes,printed_at:rowTime(r)};
  if(rowWaiting(r))return inboxPayload(r);
  const st=String(r.label_status||'').toUpperCase(),src=rowSource(r);
  const note=r.source?({'kitchen-prep':'Kitchen Prep',custom:'Custom','one-off':'One-off'}[src]||'')+(r.allergens_edited?' · allergens edited':''):'';
  return{product_name:rowName(r),job_code:r.job_code,date_prepped:r.date_prepped,date_useby:r.date_useby,staff_name:r.staff_name,section:r.section,contains:r.contains,may_contain:r.may_contain,
    notes:kind==='freeform'?null:r.notes,printed_at:rowTime(r),status:st==='FROZEN'||st==='THAWED'?st:'',status_date:r.status_date,weight_display:r.weight_display,source_note:note};
}
function renderHistory(){
  $('#view-history').innerHTML=`<div class="ph"><div class="ph-title">History<div class="ph-sub">Every label printed, newest first</div></div>
    <div class="ph-acts"><button class="btn btn-sm" data-act="hi-refresh" aria-label="Refresh">${ico('refresh')}<span class="desk-only">Refresh</span></button><button class="btn btn-sm" data-act="hi-csv">${ico('download')}Export</button></div></div>
    <div class="bar"><div class="search" style="flex:1 1 220px;max-width:440px">${ico('search')}<input class="inp" id="hq" type="search" placeholder="Search product, job or who" data-in="hi-q" value="${h(HI.q)}" autocomplete="off" aria-label="Search history"></div>${seg([['all','All'],['today','Today'],['mine','Mine']],HI.filter,'hi-filter')}</div>
    <div class="body" id="hi-list"></div>`;
  renderHiList();loadHistory();
}
async function loadHistory(){
  if(HI.loading)return;HI.loading=true;if(!HI.loaded)renderHiList();
  try{HI.rows=await rest(CPS,'GET',`print_jobs?select=*&order=created_at.desc&limit=${HI.limit}`)||[];HI.error=null;HI.more=HI.rows.length>=HI.limit;}
  catch(e){HI.error=e.message;}
  HI.loading=false;HI.loaded=true;renderHiList();
}
function hiAllRows(){
  const pend=S.pendingRecords.map(p=>({...p.rec,created_at:new Date(p.at).toISOString(),_pending:true,_pid:p.pid||String(p.at)}));
  return[...pend,...HI.rows];
}
function hiFind(key){return hiAllRows().find(r=>rowKey(r)===key)||null;}
function hiFiltered(){
  const q=norm(HI.q),words=q.split(' ').filter(Boolean),today=ymd(),me=norm(S.user&&S.user.name);
  return hiAllRows().filter(r=>{
    if(HI.filter==='today'&&rowDay(r)!==today)return false;
    if(HI.filter==='mine'&&norm(r.staff_name)!==me)return false;
    if(words.length){const hay=norm([r.product_name,r.job_code,r.staff_name,r.section,r.contains,r.notes,dayWords(rowDay(r))].join(' '));if(!words.every(w=>hay.includes(w)))return false;}
    return true;
  });
}
function renderHiList(){
  const el=$('#hi-list');if(!el)return;
  if(!HI.loaded&&!S.pendingRecords.length){el.innerHTML=`<div class="group">${Array.from({length:7},()=>'<div class="row"><div class="skel" style="height:34px;width:100%"></div></div>').join('')}</div>`;return;}
  if(HI.error&&!HI.rows.length){el.innerHTML=`<div class="empty">${ico('warning')}<div class="empty-t">Can’t load History</div><div class="empty-s">${h(HI.error)}</div><button class="btn" data-act="hi-refresh">${ico('refresh')}Try again</button></div>`;return;}
  const list=hiFiltered();
  if(!list.length){el.innerHTML=`<div class="empty">${ico('clock')}<div class="empty-t">${HI.q||HI.filter!=='all'?'Nothing matches':'Nothing printed yet'}</div><div class="empty-s">${HI.q||HI.filter!=='all'?'Try All, or a different search.':'Labels appear here as they print.'}</div></div>`;return;}
  const days=[];list.forEach(r=>{const d=rowDay(r);let g=days.find(x=>x.d===d);if(!g){g={d,rows:[]};days.push(g);}g.rows.push(r);});
  el.innerHTML=days.map(g=>{const n=g.rows.reduce((a,r)=>a+rowQty(r),0);return`<div class="hday"><span>${h(g.d?dayWords(g.d):'Earlier')}</span><span class="n">${plural(n,'label')}</span></div>
    <div class="group">${g.rows.map(hiRowHTML).join('')}</div>`;}).join('')
    +(HI.more?`<div style="text-align:center;padding:18px"><button class="btn" data-act="hi-more">Show older labels</button></div>`:'');
}
function hiRowHTML(r){
  const kind=rowKind(r);
  const meta=[r.job_code?`<span class="mono">${h(r.job_code)}</span>`:'',h(r.staff_name||''),kind==='standard'&&r.section?h(r.section):'',kind==='plate'?h(r.notes||''):'',kind==='container'&&isYmd(r.date_prepped)?'dated '+h(dayLower(r.date_prepped)):''].filter(Boolean).join(' · ');
  return`<button class="row row-nav hrow" data-act="hi-open" data-k="${h(rowKey(r))}"><span class="h-time">${h(rowTime(r))}</span><span class="row-main"><span class="h-name">${h(rowName(r))}</span><span class="h-meta">${meta}</span><span class="h-badges">${rowBadges(r)}</span></span><span class="h-qty">${h(qtyText(r))}</span></button>`;
}
function hiOpen(key){
  const r=hiFind(key);if(!r)return;
  const kind=rowKind(r),pl=rowPayload(r);
  const kv=[['Printed',`${dayWords(rowDay(r))}${rowTime(r)?' at '+rowTime(r):''}`],['By',h(r.staff_name||'—')]];
  if(kind==='standard'||kind==='freeform'){
    const j=r.job_code?jobByCode(r.job_code):null;
    kv.push(['Job',r.job_code?`<span class="mono">${h(r.job_code)}</span>${j&&j.client?' · '+h(j.client):''}`:'No job — stock'],['Section',h(r.section||'—')],['Made',h(isYmd(r.date_prepped)?dayWords(r.date_prepped):r.date_prepped||'—')],['Use by',h(isYmd(r.date_useby)?dayWords(r.date_useby):r.date_useby||'—')]);
  }
  if(kind==='container')kv.push(['Date in',h(isYmd(r.date_prepped)?dayWords(r.date_prepped):r.date_prepped||'—')]);
  if(kind==='plate')kv.push(['Job',r.job_code?`<span class="mono">${h(r.job_code)}</span>`:'—']);
  kv.push([/^\d+$/.test(String(r.quantity??1).trim())?'Labels':'Quantity',h(r.quantity||1)]);
  const act=rowWaiting(r)?'Print it now':kind==='plate'?'Add to the plate queue':kind==='container'?'Add to containers':'Print again';
  openSheet({title:h(rowName(r)),sub:`<span class="h-badges" style="margin-top:6px">${rowBadges(r)}</span>`,cls:'wide',
    body:`<div class="lp lp-sheet">${previewHTML('lp-hi',parseInt(pl.quantity||rowQty(r))||1)}</div><dl class="kv">${kv.map(([k,v])=>`<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>`,
    foot:`<button class="btn" data-act="sheet-close">Close</button><button class="btn btn-primary" data-act="hi-reprint" data-k="${h(key)}">${ico('printer')}${act}</button>`});
  paintLabel($('#lp-hi'),pl);
}
function hiReprint(key){
  const r=hiFind(key);if(!r)return;
  closeSheet();
  const kind=rowKind(r);
  if(rowWaiting(r)){printInboxRow(r);return;}
  if(kind==='plate'){
    const p=rowPayload(r);const u=['allergy','intolerance','dislike'].includes(p.urgency)?p.urgency:'allergy';
    PL.queue.push({id:uid(),name:p.guest_name,table:p.table,pos:p.position,urgency:u,dietary:p.dietary,dish:p.dish,course:p.dish?dishCourse(p.dish):90,job:r.job_code||null,eventId:null});
    savePlQueue();go('plates');toast(`${p.guest_name} is in the plate queue`);return;
  }
  if(kind==='container'){
    const c=containers().find(x=>norm(x.name)===norm(r.product_name));const k='id:'+(c?c.id:'name:'+norm(r.product_name));
    const t=CT.tray.find(x=>x.key===k);
    if(t)t.count=Math.min(50,t.count+1);
    else CT.tray.push({key:k,id:c?c.id:null,name:c?c.name:r.product_name,contains:c?c.contains:alList(r.contains),may:c?c.may:alList(r.may_contain),count:1});
    saveTray();go('containers');toast(`${r.product_name} is ready to print`);return;
  }
  wizFromRecord({...r,product_name:rowName(r),notes:kind==='freeform'?null:r.notes});
}
async function hiCSV(){
  const list=hiFiltered();if(!list.length){toast('Nothing to export',{type:'err'});return;}
  const rows=[['Date','Time','Product','From','Type','Job code','Section','Made by','Labels','Made','Use by','Status','Contains','May contain','Notes','Allergens edited']];
  list.forEach(r=>rows.push([rowDay(r),rowTime(r),rowName(r),rowSource(r),rowKind(r),r.job_code||'',r.section||'',r.staff_name||'',r.quantity||1,r.date_prepped||'',r.date_useby||'',r.label_status||'',r.contains||'',r.may_contain||'',r.notes||'',r.allergens_edited?'yes':'']));
  await saveCSV(rows,`digbys-labels-${ymd()}.csv`);
}
