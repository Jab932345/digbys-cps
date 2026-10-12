/* ═══════════════════════════════════════════════════════════════════════
   CONTAINERS — the dry-store and walk-in tubs. Tap a container, tap it
   again for another label, Print. Big name on black, the date it went in,
   allergens. Containers live in CPS products (category "Container").
   ═══════════════════════════════════════════════════════════════════════ */
const CT={tray:LS.get('dcps_tray',[]),edit:false,busy:false};
let CE=null;
/* Date in: today, unless it was changed today. */
function ctDate(){const d=LS.get('dcps_ct_date',null);return d&&d.on===ymd()&&isYmd(d.v)?d.v:ymd();}
function setCtDate(v){LS.set('dcps_ct_date',{v,on:ymd()});}
function saveTray(){LS.set('dcps_tray',CT.tray);updateBadges();renderFloatBar();}
function trayCount(){return CT.tray.reduce((a,t)=>a+(t.count||0),0);}
function ctPayload(t){return{storage:true,product_name:t.name,date_prepped:ctDate(),contains:t.contains.join(', ')||null,may_contain:t.may.join(', ')||null,notes:null,printed_at:hhmm(),quantity:t.count};}
function ctRecord(t){return{product_name:t.name,staff_name:S.user?S.user.name:'',section:'Containers',job_code:null,quantity:t.count,date_prepped:ctDate(),date_useby:null,
  contains:t.contains.join(', ')||null,may_contain:t.may.join(', ')||null,notes:null,printed_at:hhmm(),label_status:null,source:'container',label_type:'container',allergens_edited:false};}
function refreshTray(){
  const list=containers();
  CT.tray.forEach(t=>{const c=t.id!=null?list.find(x=>String(x.id)===String(t.id)):null;if(c){t.name=c.name;t.contains=c.contains;t.may=c.may;}});
}
AL_ED.ce={get:()=>({c:[...CE.c],m:[...CE.m],none:CE.none,mode:CE.mode}),set:s=>{CE.c=s.c;CE.m=s.m;CE.none=s.none;CE.mode=s.mode;},after:()=>cePreview()};
function ctDateHTML(){const v=ctDate();return`<label class="date-pill" title="The date it went in the tub">${ico('calendar','ico-sm')}<span>Date in</span><b>${h(dayWords(v))}</b><input type="date" data-ch="ct-date" value="${h(v)}" aria-label="Date in"></label>`;}
function renderContainers(){
  $('#view-containers').innerHTML=`<div class="ph"><div class="ph-title">Containers<div class="ph-sub">Tap a tub to add its label</div></div>
    <div class="ph-acts"><span id="ct-date-pill">${ctDateHTML()}</span><button class="btn btn-sm${CT.edit?' btn-primary':''}" data-act="ct-edit">${CT.edit?'Done':ico('pencil')+'Edit'}</button><button class="btn btn-sm" data-act="ct-new">${ico('plus')}New</button></div></div>
    <div class="two"><div class="two-main" id="ct-main"></div><aside class="two-side show" id="ct-side"></aside></div>`;
  refreshTray();renderCtMain();renderCtSide();renderFloatBar();
}
function renderCtMain(){
  const el=$('#ct-main');if(!el)return;
  const list=containers();
  if(!list.length){
    el.innerHTML=S.cps.ok===null?`<div class="tiles">${Array.from({length:5},()=>'<div class="tile skel"></div>').join('')}</div>`
      :`<div class="empty">${ico('box')}<div class="empty-t">No containers yet</div><div class="empty-s">Make one for each tub in the dry store or walk-in. Its name prints big, with the date it went in and its allergens.</div>
        <div class="inline" style="justify-content:center;margin-top:12px"><button class="btn btn-primary" data-act="ct-seed">Add flour and sugar</button><button class="btn" data-act="ct-new">${ico('plus')}New container</button></div>
        <div class="empty-s faint" style="margin-top:8px">Plain, self raising and bread flour (gluten) · granulated and caster sugar</div></div>`;
    return;
  }
  el.innerHTML=`<div class="tiles ct-tiles${CT.edit?' edit-on':''}">${list.map(c=>{const t=CT.tray.find(x=>String(x.id)===String(c.id));
    return`<button class="tile" data-act="ct-tap" data-id="${h(c.id)}" aria-label="${h(c.name)}${t?', '+t.count+' to print':''}"><div class="tile-name">${h(c.name)}</div><div class="tile-meta">${alMetaHTML(c.contains,c.may)}</div>${t&&!CT.edit?`<span class="cnt" id="cnt-${h(c.id)}">${t.count}</span>`:''}<span class="edit-ico">${ico('pencil')}</span></button>`;}).join('')}</div>
    ${CT.edit?'<div class="group-ft" style="padding-top:12px">Tap a container to rename it or change its allergens.</div>':''}`;
}
function renderCtSide(){
  const el=$('#ct-side');if(!el)return;
  const n=trayCount(),last=CT.tray[CT.tray.length-1];
  el.innerHTML=`<div class="lp"><div class="lp-cap"><b>Label</b><span>as it prints</span></div>${last?previewHTML('lp-ct',last.count):`<div class="lp-ghost" style="height:170px">${ico('box')}<span>Tap a container</span></div>`}</div>
    <div><div class="group-hd"><span>To print</span><span class="n">${n?plural(n,'label'):''}</span></div>
    <div class="group">${CT.tray.length?CT.tray.map(t=>`<div class="tray-row"><span class="grow">${h(t.name)}<small class="${t.contains.length?'al-text':'muted'}">${h(t.contains.length?t.contains.join(', '):t.may.length?'May contain '+t.may.join(', '):'No allergens')}</small>${t.err?`<small class="q-err">${h(t.err)}</small>`:''}</span>
      <div class="stepper sm"><button class="btn" data-act="ct-dec" data-key="${h(t.key)}" data-hold="1" aria-label="One fewer ${h(t.name)}">${ico('minus')}</button><span class="stepper-n">${t.count}</span><button class="btn" data-act="ct-inc" data-key="${h(t.key)}" data-hold="1" aria-label="One more ${h(t.name)}" ${t.count>=50?'disabled':''}>${ico('plus')}</button></div></div>`).join('')
      :`<div class="empty" style="padding:26px 16px">${ico('box')}<div class="empty-s">Tap tubs to add their labels here.</div></div>`}</div></div>
    ${n?`<div class="side-foot"><button class="btn btn-primary btn-lg btn-block desk-only" data-act="ct-print" ${CT.busy?'disabled':''}>${CT.busy?'<span class="spin"></span>Printing…':ico('printer')+'Print '+plural(n,'label')}</button><button class="btn btn-sm btn-plain" data-act="ct-clear" ${CT.busy?'disabled':''}>Clear</button></div>`:''}`;
  if(last)paintLabel($('#lp-ct'),ctPayload(last));
}
function ctTap(id){
  const c=containers().find(x=>String(x.id)===String(id));if(!c)return;
  if(CT.edit){ctEditSheet(c);return;}
  let t=CT.tray.find(x=>String(x.id)===String(c.id));
  if(t){if(t.count>=50)return;t.count++;t.err=null;CT.tray=CT.tray.filter(x=>x!==t).concat([t]);}
  else{t={key:'id:'+c.id,id:c.id,name:c.name,contains:c.contains,may:c.may,count:1};CT.tray.push(t);}
  saveTray();renderCtMain();renderCtSide();
  const b=$('#cnt-'+CSS.escape(String(c.id)));if(b)b.classList.add('pop');
}
function ctStep(key,d){
  const t=CT.tray.find(x=>x.key===key);if(!t)return;
  t.count=Math.min(50,t.count+d);t.err=null;
  if(t.count<=0)CT.tray=CT.tray.filter(x=>x!==t);
  saveTray();renderCtMain();renderCtSide();
}
async function ctPrint(){
  if(CT.busy||!CT.tray.length)return;
  CT.busy=true;renderCtSide();renderFloatBar();
  let ok=0,bad=0,err='';
  for(const t of [...CT.tray]){
    const n=t.count;if(!(n>0))continue;
    if(!t.jid||t.jidN!==n){t.jid=uid();t.jidN=n;}
    let res=await sendToPrinter({...ctPayload(t),quantity:n,job_id:'ct-'+t.jid});
    if(!res.ok&&!res.timeout){await new Promise(r=>setTimeout(r,2500));res=await sendToPrinter({...ctPayload(t),quantity:n,job_id:'ct-'+t.jid});}
    if(res.ok){ok+=n;recordPrint(ctRecord({...t,count:n}));t.count-=n;t.jid=null;if(t.count<=0)CT.tray=CT.tray.filter(x=>x!==t);}
    else{bad++;t.err=res.timeout?'Didn’t answer in time — it may have printed':res.error;err=res.error;break;}
    saveTray();
  }
  CT.busy=false;saveTray();renderCtMain();renderCtSide();renderFloatBar();
  if(ok)alog('Printed container labels',plural(ok,'label'));
  if(!bad)toast(`Sent ${plural(ok,'container label')} to the printer`);
  else toast(`${ok?ok+' sent. ':''}The rest are still here — ${err}`,{type:'err',ms:6000,action:'Retry',onAction:ctPrint});
}
function ctEditSheet(c){
  CE=c?{id:c.id,name:c.name,c:[...c.contains],m:[...c.may],none:false,mode:'c'}:{id:null,name:'',c:[],m:[],none:false,mode:'c'};
  openSheet({title:c?'Edit container':'New container',sub:c?'':'For a tub in the dry store or walk-in',body:`
    <div class="fld"><label class="fld-label" for="ce-name">Name — prints big</label><input class="inp inp-lg" id="ce-name" data-in="ce-name" value="${h(CE.name)}" placeholder="e.g. Plain Flour" autocomplete="off" autofocus></div>
    <div class="fld"><span class="fld-label">Allergens</span>${alEditorHTML('ce')}</div>
    <div class="lp"><div class="lp-cap"><b>Label</b><span>as it prints</span></div>${previewHTML('lp-ce',1)}</div>`,
    foot:`${c?`<button class="btn btn-danger" data-act="ce-del">${ico('trash')}Delete</button><span class="spacer"></span>`:''}<button class="btn" data-act="sheet-close">Cancel</button><button class="btn btn-primary" data-act="ce-save">${c?'Save':'Add container'}</button>`});
  cePreview();
}
const cePreview=debounce(()=>{if(CE)paintLabel($('#lp-ce'),{storage:true,product_name:titleCase(CE.name)||'Container name',date_prepped:ctDate(),contains:CE.c.join(', ')||null,may_contain:CE.m.join(', ')||null,printed_at:hhmm()});},60);
async function ceSave(){
  if(!CE)return;const name=titleCase(CE.name);
  if(!name){toast('Give it a name',{type:'err'});$('#ce-name')?.focus();return;}
  if(containers().some(x=>norm(x.name)===norm(name)&&String(x.id)!==String(CE.id))){toast(`There’s already a container called ${name}`,{type:'err'});return;}
  const body={name,category:CONTAINER,contains:CE.c.join(', ')||null,may_contain:CE.m.join(', ')||null,shelf_life_hours:72};
  try{
    if(CE.id!=null)await rest(CPS,'PATCH','products?id=eq.'+encodeURIComponent(CE.id),body,{prefer:'return=minimal'});
    else await rest(CPS,'POST','products',body,{prefer:'return=minimal'});
    alog(CE.id!=null?'Edited container':'Added container',name);
    const was=CE.id;closeSheet();await loadCPS();refreshTray();saveTray();
    toast(was!=null?`Saved ${name}`:`Added ${name}`);
  }catch(e){toast('Couldn’t save — '+e.message,{type:'err'});}
}
async function ceDelete(){
  const c=CE&&containers().find(x=>String(x.id)===String(CE.id));if(!c)return;
  try{
    await rest(CPS,'DELETE','products?id=eq.'+encodeURIComponent(c.id));
    closeSheet();alog('Deleted container',c.name);
    const tray=CT.tray;CT.tray=CT.tray.filter(t=>String(t.id)!==String(c.id));saveTray();
    await loadCPS();
    toast(`Deleted ${c.name}`,{action:'Undo',onAction:()=>once('undo-ct-'+c.id,async()=>{try{await rest(CPS,'POST','products',{name:c.name,category:CONTAINER,contains:c.contains.join(', ')||null,may_contain:c.may.join(', ')||null,shelf_life_hours:72},{prefer:'return=minimal'});await loadCPS();toast(`${c.name} is back`);}catch(e){toast('Couldn’t undo — '+e.message,{type:'err'});}})});
  }catch(e){toast('Couldn’t delete — '+e.message,{type:'err'});}
}
async function ctSeed(){
  const have=new Set(containers().map(c=>norm(c.name)));
  const rows=DRY_STORE.filter(([n])=>!have.has(norm(n))).map(([n,a])=>({name:n,category:CONTAINER,contains:a||null,may_contain:null,shelf_life_hours:72}));
  if(!rows.length){toast('They’re already there');return;}
  try{await rest(CPS,'POST','products',rows,{prefer:'return=minimal'});alog('Added containers',rows.map(r=>r.name).join(', '));await loadCPS();toast(`Added ${plural(rows.length,'container')}`);}
  catch(e){toast('Couldn’t add them — '+e.message,{type:'err'});}
}

/* Phone: the print button floats above the tab bar while there's something to print. */
function renderFloatBar(){
  let el=$('#float-bar');
  if(!el){el=document.createElement('div');el.id='float-bar';el.className='float-bar phone-only';document.body.appendChild(el);}
  let html='';
  if(S.user&&S.view==='plates'&&PL.queue.length)html=`<button class="btn btn-primary btn-lg btn-block" data-act="pl-print" ${PL.busy?'disabled':''}>${PL.busy?'<span class="spin"></span>Printing…':ico('printer')+'Print all '+plural(PL.queue.length,'plate label')}</button>`;
  else if(S.user&&S.view==='containers'&&CT.tray.length&&!CT.edit)html=`<button class="btn btn-primary btn-lg btn-block" data-act="ct-print" ${CT.busy?'disabled':''}>${CT.busy?'<span class="spin"></span>Printing…':ico('printer')+'Print '+plural(trayCount(),'label')}</button>`;
  el.innerHTML=html;el.hidden=!html;
  document.body.classList.toggle('has-float',!!html);setToastLift();
}
