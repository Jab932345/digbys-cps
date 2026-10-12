/* ═══════════════════════════════════════════════════════════════════════
   SHELL — navigation, one handler for every tap, keyboard, boot.
   ═══════════════════════════════════════════════════════════════════════ */
const NAV=[['print','printer','Print'],['plates','plate','Plates'],['containers','box','Containers'],['history','clock','History'],['manage','sliders','Manage']];
function navBadge(id,tab){
  if(id==='print'&&S.outbox.length)return`<span class="nav-n" title="Didn’t print">${S.outbox.length}</span>`;
  if(id==='print'&&S.inbox.length)return`<span class="nav-n kp" title="Sent from Kitchen Prep">${S.inbox.length}</span>`;
  if(tab)return'';
  if(id==='plates'&&PL.queue.length)return`<span class="nav-n soft">${PL.queue.length}</span>`;
  if(id==='containers'&&CT.tray.length)return`<span class="nav-n soft">${trayCount()}</span>`;
  return'';
}
function renderNav(){
  $('#sb-nav').innerHTML=NAV.map(([id,icon,label])=>`<button class="nav-item${S.view===id?' on':''}" data-act="go" data-to="${id}" ${S.view===id?'aria-current="page"':''}>${ico(icon)}<span>${label}</span>${navBadge(id)}</button>`).join('');
  $('#tabbar').innerHTML=NAV.map(([id,icon,label])=>`<button class="tab${S.view===id?' on':''}" data-act="go" data-to="${id}" ${S.view===id?'aria-current="page"':''}>${ico(icon)}<span>${label}</span>${navBadge(id,true)}</button>`).join('');
  if(S.user)$('#sb-user').innerHTML=`${avatarHTML(S.user)}<span class="grow"><span>${h(S.user.name)}</span><span class="sub">Switch user</span></span>`;
}
function updateBadges(){if(S.user)renderNav();}
function go(to){const target='#'+to;if(location.hash===target)route();else location.hash=target;}
const VIEWS={print:()=>renderPrintView(),plates:()=>renderPlates(),containers:()=>renderContainers(),history:()=>renderHistory(),manage:sub=>renderManage(sub)};
function route(){
  if(!S.user)return;
  const [view,sub]=(location.hash||'#print').slice(1).split('/');
  const v=VIEWS[view]?view:'print';
  if(Sheet.open)closeSheet();if(_confirm)resolveConfirm(false);
  S.view=v;
  $$('.view').forEach(el=>el.classList.toggle('on',el.id==='view-'+v));
  renderNav();VIEWS[v](sub);renderFloatBar();setToastLift();
  if(v==='print'){loadInbox();if(Date.now()-S.kp.at>60000)loadKP();}
}
window.addEventListener('hashchange',route);

/* ── Data changed → redraw only what shows it (never the field you're typing in) ── */
onData('any',kind=>{
  if(!S.user)return;
  if(kind==='printer'){
    if(S.view==='manage'){if(MG.page==='printer')renderMgPrinter();renderMgList();}
    if(S.view==='print'&&W&&W.step==='review')renderStepFoot();
    return;
  }
  if(kind==='inbox'){updateBadges();if(S.view==='print'&&W&&W.step==='product')renderInbox();return;}
  if(kind==='history'){if(S.view==='history')renderHiList();return;}
  if(S.view==='print'&&W){
    if(W.prod&&W.prod.src!=='oneoff'&&!W.al.unlocked&&!W.reprint){const fresh=productByKey(W.prod.key);if(fresh){const was=W.prod;W.prod=fresh;W.al.c=[...fresh.contains];W.al.m=[...fresh.may];if(!W.usebyManual&&was.shelfHours!==fresh.shelfHours){recalcUseby();const d=$('#rv-dates');if(d)d.innerHTML=datesHTML();}if(W.step==='review'&&(!sameSet(was.contains,fresh.contains)||!sameSet(was.may,fresh.may))){const a=$('#rv-al');if(a)a.innerHTML=reviewAllergensHTML();toast(`Kitchen Prep just updated the allergens for ${fresh.name}`,{type:'err',ms:6000});}}}
    if(W.job&&W.job.code){const j=jobByCode(W.job.code);if(j)W.job=j;}
    renderPrintBanner();
    if(W.step==='product'){renderProducts();renderInbox();}else if(W.step==='job')renderJobs();
    renderSideSummary();schedulePreview();
  }
  if(S.view==='plates'&&!document.activeElement?.closest('#pl-form')){renderPlForm();}
  if(S.view==='containers'){refreshTray();renderCtMain();renderCtSide();}
  if(S.view==='manage'){renderMgList();if(MG.page==='products')renderMgPList();else if(['containers','jobs'].includes(MG.page))renderMgPage();}
  if(S.view==='history')renderHiList();
});

/* ── Taps ─────────────────────────────────────────────────────────────── */
function updateLabelsUI(){
  const n=$('#lbl-n');if(n)n.innerHTML=`${W.labels}<small>${W.labels===1?'label':'labels'}</small>`;
  const minus=$('[data-act=wiz-labels][data-d="-1"]'),plus=$('[data-act=wiz-labels][data-d="1"]');
  if(minus)minus.disabled=W.labels<=1;if(plus)plus.disabled=W.labels>=50;
  const pb=$('#print-btn');if(pb&&W.statusChosen)pb.innerHTML=`${ico('printer')}<span>Print ${plural(W.labels,'label')}</span>`;
  const sn=$('#side-n');if(sn)sn.textContent=W.labels>1?`×${W.labels} labels`:'';
  $$('#side-prev .lp-paper, .rv .lp-paper').forEach(p=>p.classList.toggle('stack',W.labels>1));
}
function updateTrayRow(key){
  const t=CT.tray.find(x=>x.key===key);if(!t){renderCtMain();renderCtSide();return;}
  const b=$(`[data-act=ct-inc][data-key="${CSS.escape(key)}"]`);if(!b){renderCtSide();return;}
  const row=b.closest('.tray-row');row.querySelector('.stepper-n').textContent=t.count;b.disabled=t.count>=50;
  const c=t.id!=null&&$('#cnt-'+CSS.escape(String(t.id)));if(c)c.textContent=t.count;
  const hd=$('#ct-side .group-hd .n');if(hd)hd.textContent=plural(trayCount(),'label');
  const pb=$('#ct-side [data-act=ct-print]');if(pb&&!CT.busy)pb.innerHTML=ico('printer')+'Print '+plural(trayCount(),'label');
  renderFloatBar();
}
async function printInboxRow(r){
  return once('ib-'+r.id,async()=>{
    const p=productByName(r.product_name);let fresh=null;
    if(p&&p.src==='kp'){
      fresh=await freshKpProduct(p);
      if(fresh&&fresh.gone){loadKP();toast(`${r.product_name} is no longer in Kitchen Prep — not printed. Dismiss it, or print it as a one-off.`,{type:'err'});return{ok:false};}
      if(fresh&&(!sameSet(fresh.contains,p.contains)||!sameSet(fresh.may,p.may)))loadKP();
    }
    const pl=inboxPayload(r,fresh);
    if(pl.date_useby&&pl.date_useby<ymd()){toast(`${r.product_name}: its use-by (${dayWords(pl.date_useby)}) has passed — not printed.`,{type:'err'});return{ok:false};}
    toast(`Printing ${plural(pl.quantity,'label')} — ${r.product_name}`,{type:'busy'});
    const res=await sendToPrinter({...pl,job_id:'ib-'+r.id});
    if(res.ok){await markInboxPrinted(r);alog('Printed from Kitchen Prep',`${pl.quantity}× ${r.product_name}`);toast(`Sent ${plural(pl.quantity,'label')} — ${r.product_name}`);}
    else toast(res.timeout?`${r.product_name}: the printer didn’t answer in time — check it before trying again`:`${r.product_name} didn’t print — ${res.error}`,{type:'err',ms:6000});
    return res;
  });
}
async function onPrinterBack(){
  const due=S.outbox.filter(o=>o.unreachable&&!o.maybePrinted&&!o.stale&&Date.now()-o.at<30*60e3);
  if(!due.length)return;
  await once('auto-resend',async()=>{for(const it of [...due].reverse()){const r=await sendChecked({...it,payload:{...it.payload,printed_at:hhmm()}});if(r&&r.busy)continue;if(!r||!r.ok)break;}});
  renderPrintBanner();
}
const ACT={
  'go':el=>go(el.dataset.to),
  'switch-user':()=>{alog('Signed out','');signOut();},
  'toast-act':()=>{const f=_toastAct;hideToast();if(f)f();},
  'toast-x':()=>hideToast(),
  'toast-copy':async el=>{const r=_errLog[0];if(r)el.textContent=(await copyText(errReport(r)))?'Copied':'Couldn’t copy';},
  'sheet-close':()=>closeSheet(),
  'confirm-yes':()=>resolveConfirm(true),
  'confirm-no':()=>resolveConfirm(false),
  'copy':async el=>{toast((await copyText(el.dataset.v))?'Copied':'Couldn’t copy — select it and copy instead');},
  // sign in
  'pin-user':el=>{_pinFor=S.staff.find(s=>String(s.id)===el.dataset.id)||null;_pinBuf='';renderLogin();},
  'pin-key':el=>pinKey(el.dataset.v),
  'pin-del':()=>pinDel(),
  'pin-cancel':()=>{_pinFor=null;_pinBuf='';renderLogin();},
  'login-retry':()=>{S.loginError=null;renderLogin();refreshStaffForLogin();},
  'first-run':()=>once('first-run',firstRun),
  // allergen editor
  'al-mode':el=>alMode(el.dataset.ed,el.dataset.v),
  'al-tap':el=>alTap(el.dataset.ed,el.dataset.v),
  'al-none':el=>alNone(el.dataset.ed),
  // print wizard
  'wiz-back':()=>wizBack(),
  'wiz-go':el=>{const s=el.dataset.step;if(s==='review'&&firstIncomplete()!=='review'){goStep(firstIncomplete());return;}const order=['product','job','section','allergens','review'];goStep(s,order.indexOf(s)<order.indexOf(W.step));},
  'wiz-filter':el=>{W.filter=el.dataset.v;$$('#prod-filters .chip').forEach(c=>{c.classList.toggle('on',c.dataset.v===W.filter);c.setAttribute('aria-pressed',c.dataset.v===W.filter);});renderProducts();},
  'wiz-q-clear':()=>{W.q='';const q=$('#q');if(q){q.value='';q.focus();}$('.search-x')?.setAttribute('hidden','');renderProducts();},
  'wiz-pick':el=>{const p=productByKey(el.dataset.key);if(p)wizPick(p);},
  'wiz-oneoff':()=>wizPickOneOff(),
  'wiz-job':el=>wizPickJob(el.dataset.code),
  'wiz-job-clear':()=>{W.job=undefined;setSticky(undefined);if(W.prod)planFlow();renderStep();},
  'wiz-sec':el=>wizPickSection(el.dataset.v),
  'wiz-al-done':()=>{if(W.al.chosen)goStep(firstIncomplete()==='allergens'?'review':firstIncomplete());},
  'wiz-al-unlock':()=>{W.al.unlocked=true;W.alMode='c';refreshReviewBits();},
  'wiz-al-revert':()=>{const p=W.prod;W.al={c:[...p.contains],m:[...p.may],none:false,chosen:true,unlocked:false};refreshReviewBits();},
  'wiz-al-jump':()=>{goStep('review');setTimeout(()=>{const a=$('#rv-al');if(a)a.scrollIntoView({behavior:'smooth',block:'center'});},60);},
  'wiz-status':el=>{W.status=el.dataset.v;W.statusChosen=true;W.statusDate=ymd();recalcUseby();$('#rv-store .group')?.classList.remove('need');$('#rv-store .need-note')?.remove();$$('[data-act=wiz-status]').forEach(b=>b.classList.toggle('on',b.dataset.v===W.status));refreshReviewBits();},
  'wiz-useby-reset':()=>{recalcUseby();refreshReviewBits();},
  'wiz-wmode':el=>{W.wmode=el.dataset.v;$$('[data-act=wiz-wmode]').forEach(b=>b.classList.toggle('on',b.dataset.v===W.wmode));$('#rv-w').innerHTML=weightFieldsHTML();syncSegs($('#rv-w'));schedulePreview();const f=$('#rv-w input');if(f&&matchMedia('(hover:hover)').matches)f.focus();},
  'wiz-wunit':el=>{W.wunit=el.dataset.v;$$('[data-act=wiz-wunit]').forEach(b=>b.classList.toggle('on',b.dataset.v===W.wunit));schedulePreview();},
  'wiz-wsunit':el=>{W.wsunit=el.dataset.v;$$('[data-act=wiz-wsunit]').forEach(b=>b.classList.toggle('on',b.dataset.v===W.wsunit));schedulePreview();},
  'wiz-maker':el=>{W.staff=el.dataset.v;$$('#rv-makers .maker').forEach(b=>{b.classList.toggle('on',b.dataset.v===W.staff);b.setAttribute('aria-pressed',b.dataset.v===W.staff);});schedulePreview();},
  'wiz-labels':el=>{W.labels=Math.max(1,Math.min(50,W.labels+parseInt(el.dataset.d)));updateLabelsUI();schedulePreview();},
  'wiz-labels-sheet':()=>labelsSheet(),
  'wiz-labels-set':el=>{W.labels=Math.max(1,Math.min(50,parseInt(el.dataset.v)||1));closeSheet();updateLabelsUI();schedulePreview();},
  'wiz-labels-other':()=>{const v=parseInt(($('#qty-other')||{}).value);if(!(v>=1&&v<=50)){toast('Between 1 and 50',{type:'err'});return;}W.labels=v;closeSheet();updateLabelsUI();schedulePreview();},
  'wiz-print':()=>once('print',wizPrint),
  'print-product':el=>{const p=productByKey(el.dataset.key);if(!p)return;closeSheet();W=freshW();applyPick(p);W.step=firstIncomplete();go('print');},
  'kp-retry':()=>once('kp',async()=>{toast('Asking Kitchen Prep…',{type:'busy'});await loadKP();toast(S.kp.ok?'Kitchen Prep is back':'Still no answer from Kitchen Prep',{type:S.kp.ok?'ok':'err'});}),
  'kp-refresh':()=>once('kp',async()=>{toast('Refreshing from Kitchen Prep…',{type:'busy'});await loadKP();toast(S.kp.ok?'Up to date':'Kitchen Prep isn’t answering',{type:S.kp.ok?'ok':'err'});}),
  // sent from Kitchen Prep
  'ib-more':()=>{_ibOpen=true;renderInbox();},
  'ib-print':el=>{const r=S.inbox.find(x=>String(x.id)===el.dataset.id);if(r)printInboxRow(r);},
  'ib-all':()=>once('ib-all',async()=>{for(const r of S.inbox.filter(x=>!inboxExpired(x))){const res=await printInboxRow(r);if(!res||!res.ok)break;}}),
  'ib-dismiss':el=>once('ibd-'+el.dataset.id,async()=>{const r=S.inbox.find(x=>String(x.id)===el.dataset.id);if(!r)return;
    try{await rest(CPS,'PATCH','print_jobs?id=eq.'+encodeURIComponent(r.id),{label_status:'DISMISSED'},{prefer:'return=minimal'});}catch(e){toast('Couldn’t dismiss it — '+e.message,{type:'err'});return;}
    S.inbox=S.inbox.filter(x=>x!==r);onDataChanged('inbox');alog('Dismissed from Kitchen Prep',r.product_name);
    toast(`Dismissed ${r.product_name}`,{action:'Undo',onAction:()=>once('ibu-'+r.id,async()=>{try{await rest(CPS,'PATCH','print_jobs?id=eq.'+encodeURIComponent(r.id),{label_status:r.label_status},{prefer:'return=minimal'});await loadInbox();}catch(e){toast('Couldn’t undo — '+e.message,{type:'err'});}})});}),
  // didn't print
  'outbox':()=>outboxSheet(),
  'outbox-retry-all':()=>once('ob-all',retryAllOutbox),
  'ob-retry':el=>retryOutbox(el.dataset.id),
  'ob-discard':el=>{const it=S.outbox.find(o=>o.id===el.dataset.id);removeFromOutbox(el.dataset.id);renderPrintBanner();if(S.outbox.length)outboxSheet();else closeSheet();if(it)toast(`Discarded ${it.title}`,{action:'Undo',onAction:()=>{S.outbox.unshift(it);saveOutbox();renderPrintBanner();}});},
  // plates
  'pl-event':()=>plEventSheet(),
  'pl-event-pick':el=>{PL.eventId=el.dataset.id;LS.set('dcps_plate_event',PL.eventId);plClear();closeSheet();renderPlForm();renderPlSide();},
  'pl-event-clear':()=>{PL.eventId=null;LS.set('dcps_plate_event',null);closeSheet();renderPlForm();},
  'pl-guest':el=>{const ev=plEvent();const g=ev&&ev.guest_allergens[+el.dataset.i];if(!g)return;guestToForm(g,guestKey(g,+el.dataset.i));renderPlForm();renderPlSide();const t=PL.table?null:$('#pl-table');if(t&&matchMedia('(hover:hover)').matches)t.focus({preventScroll:true});},
  'pl-urg':el=>{PL.urgency=el.dataset.v;$$('[data-act=pl-urg]').forEach(b=>b.classList.toggle('on',b.dataset.v===PL.urgency));plPreview();},
  'pl-diet':el=>{const d=el.dataset.v;PL.diets=PL.diets.includes(d)?PL.diets.filter(x=>x!==d):[...PL.diets,d];$('#pl-chips').innerHTML=plChipsHTML();plPreview();},
  'pl-dish':el=>{const d=el.dataset.v;PL.dishes=PL.dishes.includes(d)?PL.dishes.filter(x=>x!==d):[...PL.dishes,d];const m=$('#pl-menu');if(m)m.innerHTML=plMenuHTML();const b=$('#pl-add span');if(b)b.textContent=plAddText();plPreview();},
  'pl-add':()=>plAdd(),
  'pl-next':()=>{plClear();renderPlForm();renderPlSide();const n=$('#pl-name');if(n&&matchMedia('(hover:hover)').matches)n.focus();},
  'pl-rm':el=>{const q=PL.queue.find(x=>x.id===el.dataset.id);PL.queue=PL.queue.filter(x=>x.id!==el.dataset.id);savePlQueue();renderPlSide();renderPlForm();if(q)toast(`Removed ${q.name}${q.dish?' — '+q.dish:''}`,{action:'Undo',onAction:()=>{PL.queue.push(q);savePlQueue();renderPlSide();renderPlForm();}});},
  'pl-print':()=>once('pl-print',()=>plPrint()),
  'pl-print-course':el=>once('pl-print',()=>plPrint(q=>String(q.course??90)===el.dataset.c)),
  'pl-clear-queue':()=>{if(!PL.queue.length)return;const old=[...PL.queue];PL.queue=[];savePlQueue();renderPlSide();renderPlForm();toast(`Cleared ${plural(old.length,'label')}`,{action:'Undo',onAction:()=>{PL.queue=old;savePlQueue();renderPlSide();renderPlForm();}});},
  // containers
  'ct-tap':el=>ctTap(el.dataset.id),
  'ct-inc':el=>{const t=CT.tray.find(x=>x.key===el.dataset.key);if(!t||t.count>=50)return;t.count++;t.err=null;saveTray();updateTrayRow(t.key);},
  'ct-dec':el=>{const t=CT.tray.find(x=>x.key===el.dataset.key);if(!t)return;t.count--;t.err=null;if(t.count<=0){CT.tray=CT.tray.filter(x=>x!==t);saveTray();renderCtMain();renderCtSide();return;}saveTray();updateTrayRow(t.key);},
  'ct-print':()=>once('ct-print',ctPrint),
  'ct-clear':()=>{const old=CT.tray;CT.tray=[];saveTray();renderCtMain();renderCtSide();toast('Cleared',{action:'Undo',onAction:()=>{CT.tray=old;saveTray();renderCtMain();renderCtSide();}});},
  'ct-edit':()=>{CT.edit=!CT.edit;renderContainers();},
  'ct-new':()=>ctEditSheet(null),
  'ct-edit-id':el=>{const c=containers().find(x=>String(x.id)===el.dataset.id);if(c)ctEditSheet(c);},
  'ct-seed':()=>once('ct-seed',ctSeed),
  'ce-save':()=>once('ce-save',ceSave),
  'ce-shelf':el=>{CE.shelf=el.dataset.v;CE.shelfSet=true;$('#ce-shelf').innerHTML=ceShelfHTML();},
  'ce-del':()=>once('ce-del',ceDelete),
  // history
  'hi-filter':el=>{HI.filter=el.dataset.v;$$('[data-act=hi-filter]').forEach(b=>b.classList.toggle('on',b.dataset.v===HI.filter));renderHiList();},
  'hi-refresh':()=>loadHistory(),
  'hi-more':()=>{HI.limit+=300;loadHistory();},
  'hi-open':el=>hiOpen(el.dataset.k),
  'hi-reprint':el=>hiReprint(el.dataset.k),
  'hi-csv':()=>hiCSV(),
  // manage
  'mg-ptab':el=>{MG.ptab=el.dataset.v;mgProducts();syncSegs($('#mg-detail'));},
  'kp-view':el=>{const p=productByKey(el.dataset.key);if(p)kpViewSheet(p);},
  'cp-new':()=>cpSheet(null),
  'cp-edit':el=>{const p=productByKey(el.dataset.key);if(p)cpSheet(p);},
  'cp-check':el=>{const r=S.cps.products.find(x=>String(x.id)===el.dataset.id);if(r)cpSheet(customFromRow(r));},
  'cp-cat':el=>{CP.cat=el.dataset.v;$('#cp-cat').innerHTML=cpCatHTML();},
  'cp-life':el=>{CP.hours=+el.dataset.v;$('#cp-life').innerHTML=cpLifeHTML();},
  'cp-save':()=>once('cp-save',cpSave),
  'cp-del':()=>once('cp-del',cpDelete),
  'cp-tidy':()=>once('cp-tidy',cpTidy),
  'jc-new':()=>jcSheet(),
  'jc-type':el=>{JC.type=el.dataset.v;$('#jc-type').innerHTML=jcTypeHTML();$('#jc-out').textContent=jcCode();},
  'jc-save':()=>once('jc-save',jcSave),
  'jc-del':el=>once('jc-del-'+el.dataset.id,()=>jcDelete(el.dataset.id)),
  'st-new':()=>staffSheet(null),
  'st-edit':el=>{const s=S.staff.find(x=>String(x.id)===el.dataset.id);if(s)staffSheet(s);},
  'sf-save':()=>once('sf-save',sfSave),
  'sf-del':()=>once('sf-del',sfDelete),
  'pr-check':()=>checkPrinter(),
  'pr-test':()=>once('pr-test',prTest),
  'pr-update':()=>once('pr-update',prUpdate),
  'pr-save-url':()=>once('pr-url',prSaveUrl),
  'pr-shutdown':()=>once('pr-shutdown',prShutdown),
  'go-setup':()=>mgSetup(),
  'flush-records':()=>once('flush',async()=>{await flushRecords();toast(S.pendingRecords.length?'Some still couldn’t be saved':'Uploaded',{type:S.pendingRecords.length?'err':'ok'});mgSetup();}),
  'discard-stuck':()=>{const stuck=S.pendingRecords.filter(p=>p.error);S.pendingRecords=S.pendingRecords.filter(p=>!p.error);savePending();mgSetup();toast(`Discarded ${plural(stuck.length,'record')}`,{action:'Undo',onAction:()=>{S.pendingRecords.push(...stuck);savePending();mgSetup();}});},
  'bk-history':()=>once('bk',()=>backup('bk-history')),'bk-products':()=>backup('bk-products'),'bk-jobs':()=>backup('bk-jobs'),'bk-staff':()=>backup('bk-staff'),
  'act-csv':()=>{const l=LS.get('_dcps_a',[]);saveCSV([['Who','What','Detail','When'],...l.map(e=>[e.who,e.action,e.detail,e.when])],`digbys-activity-${ymd()}.csv`);},
  'theme':el=>{LS.set('dcps_theme',el.dataset.v);applyTheme();$$('[data-act=theme]').forEach(b=>b.classList.toggle('on',b.dataset.v===el.dataset.v));}
};
document.addEventListener('click',e=>{
  const el=e.target.closest('[data-act]');if(!el||el.disabled)return;
  if(el._skipClick){el._skipClick=false;return;}
  const fn=ACT[el.dataset.act];if(!fn)return;
  if(el.tagName==='A'&&!el.getAttribute('href'))e.preventDefault();
  fn(el,e);
});
$('#ovc').addEventListener('click',e=>{if(e.target.id==='ovc')resolveConfirm(false);});
/* Press and hold a − / + to keep counting. */
let _holdT=null;
function stopHold(){clearTimeout(_holdT);clearInterval(_holdT);_holdT=null;}
document.addEventListener('pointerdown',e=>{
  const el=e.target.closest('[data-hold]');if(!el||el.disabled||(e.button!==undefined&&e.button>0))return;
  const fn=ACT[el.dataset.act];if(!fn)return;
  fn(el,e);el._skipClick=true;stopHold();
  _holdT=setTimeout(()=>{_holdT=setInterval(()=>{if(!document.contains(el)||el.disabled){stopHold();return;}fn(el,e);},90);},420);
});
['pointerup','pointercancel','pointerleave','blur'].forEach(t=>document.addEventListener(t,stopHold,true));

/* ── Typing ───────────────────────────────────────────────────────────── */
const IN={
  'wiz-q':el=>{W.q=el.value;const x=$('.search-x');if(x)x.toggleAttribute('hidden',!W.q);renderProducts();const b=$('#step-body');if(b)b.scrollTop=0;},
  'wiz-jq':()=>renderJobs(),
  'wiz-notes':el=>{W.notes=el.value;schedulePreview();},
  'wiz-w':el=>{W[el.dataset.k]=el.value;schedulePreview();},
  'pl-f':el=>{PL[el.dataset.k]=el.value;if(el.dataset.k==='dish'){const b=$('#pl-add span');if(b)b.textContent=plAddText();}if(el.dataset.k==='name')plNameWarn();plPreview();},
  'ce-name':el=>{CE.name=el.value;if(!CE.shelfSet&&CE.id==null){const g=guessShelf(CE.name);if(g!==CE.shelf){CE.shelf=g;const s=$('#ce-shelf');if(s)s.innerHTML=ceShelfHTML();}}cePreview();},
  'cp-name':el=>{CP.name=el.value;},
  'cp-hours':el=>{const v=parseInt(el.value);if(v>0){CP.hours=v;$$('#cp-life .chip').forEach(c=>c.classList.toggle('on',+c.dataset.v===v));}},
  'jc':el=>{JC[el.dataset.k]=el.value;$('#jc-out').textContent=jcCode();},
  'sf':el=>{SF[el.dataset.k]=el.value;},
  'hi-q':el=>{HI.q=el.value;renderHiList();},
  'mg-pq':el=>{MG.pq=el.value;renderMgPList();}
};
const CH={
  'wiz-date':el=>{const k=el.dataset.k;const v=el.value;if(!isYmd(v))return;W[k]=v;if(k==='useby')W.usebyManual=v!==autoUseby();else if(!W.usebyManual)recalcUseby();refreshReviewBits();},
  'wiz-save':el=>{W.saveProduct=el.checked;},
  'ct-date':el=>{if(isYmd(el.value)){setCtDate(el.value);const p=$('#ct-date-pill');if(p)p.innerHTML=ctDateHTML();renderCtSide();}},
  'jc':el=>{JC[el.dataset.k]=el.value;$('#jc-out').textContent=jcCode();}
};
document.addEventListener('input',e=>{const el=e.target.closest('[data-in]');if(el&&IN[el.dataset.in])IN[el.dataset.in](el,e);});
document.addEventListener('change',e=>{const el=e.target.closest('[data-ch]');if(el&&CH[el.dataset.ch])CH[el.dataset.ch](el,e);});

/* ── Keyboard ─────────────────────────────────────────────────────────── */
document.addEventListener('keydown',e=>{
  if(!S.user){if(!$('#login').hidden)loginKey(e);return;}
  if(e.key==='Escape'){
    if($('#ovc').classList.contains('open')){resolveConfirm(false);return;}
    if(Sheet.open){closeSheet();return;}
    if(S.view==='print'){const a=document.activeElement;if(a&&a.id==='q'&&W.q){W.q='';a.value='';renderProducts();$('.search-x')?.setAttribute('hidden','');return;}wizBack();}
    return;
  }
  if(topOverlay()){if(e.key==='Enter'&&document.activeElement&&document.activeElement.id==='qty-other'){e.preventDefault();ACT['wiz-labels-other']();}return;}
  const a=document.activeElement;const typing=a&&/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName);
  if(e.key==='/'&&!typing&&S.view==='print'&&W.step==='product'){e.preventDefault();$('#q')?.focus();return;}
  if(S.view==='print'&&W.step==='review'&&e.key==='Enter'&&(e.metaKey||e.ctrlKey||(!typing&&!(a&&a.closest('button,a,summary'))))){e.preventDefault();ACT['wiz-print']();return;}
  if(S.view==='print'&&W.step==='product'&&e.key==='Enter'&&a&&a.id==='q'&&W.q){
    e.preventDefault();const first=$('#prod-results .tile')||$('#prod-results .oneoff-row');if(first)first.click();return;
  }
  if(S.view==='plates'&&e.key==='Enter'&&a&&a.closest('#pl-form')&&a.tagName==='INPUT'){e.preventDefault();plAdd();}
});

/* ── Didn't print ─────────────────────────────────────────────────────── */
function outboxSheet(){
  if(!S.outbox.length){closeSheet();return;}
  openSheet({title:'Didn’t print',sub:'Kept here until they print or you discard them',body:`<div class="group">${S.outbox.map(o=>`<div class="q-item"><div class="q-main"><div class="q-t">${h(o.title)} <span class="muted" style="font-weight:500">×${o.payload.quantity||1}</span></div>
      <div class="q-s">${o.payload.job_code?`<span class="mono">${h(o.payload.job_code)}</span> · `:''}${h(new Date(o.at).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'}))}${o.tries>1?' · tried '+o.tries+' times':''}</div>
      <div class="q-err">${h(o.error||'')}${o.maybePrinted?' — it may have printed; check before retrying':''}</div></div>
      <div class="inline" style="flex-wrap:nowrap"><button class="btn btn-sm" data-act="ob-discard" data-id="${h(o.id)}">Discard</button><button class="btn btn-sm btn-primary" data-act="ob-retry" data-id="${h(o.id)}">${o.stale?'Check':'Retry'}</button></div></div>`).join('')}</div>`,
    foot:`<button class="btn" data-act="sheet-close">Close</button><button class="btn btn-primary" data-act="outbox-retry-all">${ico('printer')}Retry all</button>`});
}
async function retryOutbox(id){
  return once('ob-'+id,async()=>{
    const it=S.outbox.find(o=>o.id===id);if(!it)return;
    if(it.stale){await checkStale(it);return;}
    const res=await sendChecked({...it,payload:{...it.payload,printed_at:hhmm()}});
    renderPrintBanner();if(Sheet.open)outboxSheet();
    return res;
  });
}
/* Kitchen Prep changed its allergens after this was sent: open it with the new ones. */
async function checkStale(it){
  closeSheet();await loadKP();
  // Kitchen Prep reloaded: its product now. If it didn't answer: what it sent when the change was spotted.
  const p=S.kp.ok?productByKey(it.base&&it.base.key):it.fresh;
  if(!p){toast(S.kp.ok?`${it.title} is no longer in Kitchen Prep — discard it`:'Kitchen Prep isn’t answering — try again in a moment',{type:'err'});return;}
  removeFromOutbox(it.id);renderPrintBanner();reopenItem(it,p);
}
async function retryAllOutbox(){
  const todo=S.outbox.filter(o=>!o.stale);
  if(!todo.length){if(S.outbox.length)await checkStale(S.outbox[0]);return;}
  for(const it of [...todo].reverse()){
    const res=await sendChecked({...it,payload:{...it.payload,printed_at:hhmm()}});
    if(res&&res.busy)continue;
    if(!res||!res.ok)break;
  }
  renderPrintBanner();if(Sheet.open)outboxSheet();
}

/* ── Boot ─────────────────────────────────────────────────────────────── */
let _kpTimer=null,_ibTimer=null;
function enterApp(){
  $('#login').hidden=true;$('#app').hidden=false;
  if(!W)W=freshW();
  renderNav();renderPrinterPill();
  if(!location.hash||location.hash==='#')history.replaceState(null,'','#print');
  route();
  loadKP();loadCPS();probeExt();startPrinterPolling();flushRecords();loadLabelFonts();loadInbox();
  clearInterval(_kpTimer);_kpTimer=setInterval(()=>{if(!document.hidden&&S.user){loadKP();loadCPS();flushRecords();}},3*60*1000);
  clearInterval(_ibTimer);_ibTimer=setInterval(()=>{if(!document.hidden&&S.user)loadInbox();},30000);
}
function boot(){
  const c=LS.get('dcps_cps_cache',null);if(c){S.cps.products=c.products||[];S.cps.jobs=c.jobs||[];S.cps.at=c.at||0;}
  const k=kpCache();if(k)try{applyKp(k.dishes,k.events,k.settings,k.at);}catch(e){}
  if(restoreSession()){
    enterApp();
    loadStaff().then(()=>{const s=S.staff.find(x=>String(x.id)===String(S.user.id));if(!s){signOut();return;}S.user={id:s.id,name:s.name,color:s.color,initials:s.initials};renderNav();}).catch(()=>{});
  }else showLogin();
}
boot();
