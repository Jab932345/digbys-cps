'use strict';
/* ═══════════════════════════════════════════════════════════════════════
   DIGBY'S CPS — labels for prep, plates and containers.
   Reads Kitchen Prep live (products with their allergens, events and job
   codes); CPS keeps custom products, containers, staff and print history.
   Prints through the Pi (print server 2.x) behind ngrok.
   ═══════════════════════════════════════════════════════════════════════ */
const APP_VERSION='3.0';
const CPS={url:'https://jaajrllkozknilvmdezt.supabase.co',key:'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImphYWpybGxrb3prbmlsdm1kZXp0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcwMjQxNDAsImV4cCI6MjA5MjYwMDE0MH0.09U5cba3JxRmysrn2X3TxPqr-q6jJE4QhyeKQwEK03M'};
const KP={url:'https://qfnwyooipwtfzikukztz.supabase.co',key:'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFmbnd5b29pcHd0Znppa3VrenR6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzczODY0MTcsImV4cCI6MjA5Mjk2MjQxN30.qzq30fT8L2bhX7kx46HZdco3rt7bN2zRGSKETCNgQqw'};
const KP_APP='https://digbys-prep.vercel.app';
const DEFAULT_PRINTER='https://palatable-shack-scallion.ngrok-free.dev';
const MANAGER='James Brierley';
const AL=['Gluten','Crustaceans','Eggs','Fish','Peanuts','Soya','Milk','Nuts','Celery','Mustard','Sesame','Sulphites','Lupin','Molluscs'];
const SECTIONS=['Canapés','Starters','Mains','Dessert','Evening Grazing','Tasting Menu'];
const KP_SECTION={'Canapés':'Canapés','Starters':'Starters','Mains':'Mains','Sides':'Mains','Kids':'Mains','Desserts':'Dessert','Evening Grazing':'Evening Grazing','Tasting Menu':'Tasting Menu'};
const KP_CAT_ORDER=['Canapés','Starters','Mains','Sides','Kids','Desserts','Evening Grazing','Tasting Menu'];
const CUSTOM_CATS=['Canapés','Starters','Mains','Desserts','Evening Grazing','Tasting Menu','Sauces & Dressings','Stocks & Soups','Pastry','Other'];
const CAT_SECTION={'Canapés':'Canapés','Starters':'Starters','Mains':'Mains','Desserts':'Dessert','Dessert':'Dessert','Evening Grazing':'Evening Grazing','Tasting Menu':'Tasting Menu'};
const EV_TYPES={PRIV:'Private Dining',WED:'Wedding',TM:'Tasting Menu',CAN:'Canapés',BUF:'Buffet',CORP:'Corporate',GAL:'Gala Dinner',GRZ:'Grazing',WAKE:'Wake'};
const DIETS=['Vegan','Vegetarian','Gluten Free','Lactose Free'];
const COLS=['#8C2F2F','#2F66A8','#2F8F4E','#7A4E9E','#B86E0A','#23798A','#A8477A','#5F7A2F'];
const CONTAINER='Container';
const DRY_STORE=[['Plain Flour','Gluten'],['Self Raising Flour','Gluten'],['Bread Flour','Gluten'],['Granulated Sugar',''],['Caster Sugar','']];
const SQL_SETUP=`-- Digby's CPS 3 — run once in the CPS project (SQL editor → New query → Run).
-- Adds the columns History uses to show where each label came from.
-- Safe to run more than once; changes nothing that's already there.
alter table public.print_jobs add column if not exists source text;
alter table public.print_jobs add column if not exists label_type text;
alter table public.print_jobs add column if not exists allergens_edited boolean not null default false;
alter table public.print_jobs add column if not exists status_date date;
alter table public.print_jobs add column if not exists weight_display text;
alter table public.print_jobs add column if not exists label_status text;
alter table public.print_jobs add column if not exists notes text;
notify pgrst, 'reload schema';`;

/* ── Small helpers ───────────────────────────────────────────────────── */
const $=(s,r=document)=>r.querySelector(s);
const $$=(s,r=document)=>[...r.querySelectorAll(s)];
function h(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function norm(s){return String(s??'').trim().toLowerCase().replace(/\s+/g,' ');}
function uid(){return Date.now().toString(36)+Math.random().toString(36).slice(2,8);}
function plural(n,one,many){return n+' '+(n===1?one:(many||one+'s'));}
function pad(n){return String(n).padStart(2,'0');}
function ymd(d){d=d||new Date();return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());}
function isYmd(s){return /^\d{4}-\d{2}-\d{2}$/.test(String(s||''));}
function parseYmd(s){const m=/^(\d{4})-(\d{2})-(\d{2})/.exec(String(s||''));return m?new Date(+m[1],+m[2]-1,+m[3]):null;}
function addDays(s,n){const d=parseYmd(s)||new Date();d.setDate(d.getDate()+n);return ymd(d);}
function addHours(s,hrs){return addDays(s,Math.floor((parseInt(hrs)||0)/24));}   // whole days, so a clock change never shifts a date
function hhmm(d){d=d||new Date();return pad(d.getHours())+':'+pad(d.getMinutes());}
function daysBetween(a,b){const x=parseYmd(a),y=parseYmd(b);return x&&y?Math.round((y-x)/86400000):null;}
function dayWords(s,{year=true}={}){
  const d=parseYmd(s);if(!d)return s||'';
  const diff=daysBetween(ymd(),s);
  if(diff===0)return'Today';if(diff===1)return'Tomorrow';if(diff===-1)return'Yesterday';
  const t=`${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d.getDay()]} ${d.getDate()} ${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()]}`;
  return year&&d.getFullYear()!==new Date().getFullYear()?t+' '+d.getFullYear():t;
}
function dayLower(s){const w=dayWords(s);return/^(Today|Tomorrow|Yesterday)$/.test(w)?w.toLowerCase():w;}
function dateLong(s){const d=parseYmd(s);return d?d.toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'long'}):(s||'');}
function inWords(s){const n=daysBetween(ymd(),s);if(n===null)return'';if(n===0)return'today';if(n===1)return'tomorrow';if(n===-1)return'yesterday';if(n>1)return'in '+n+' days';return-n+' days ago';}
function sortAl(list){const r=a=>{const i=AL.indexOf(a);return i<0?99:i;};return[...new Set(list)].sort((a,b)=>r(a)-r(b)||String(a).localeCompare(String(b)));}
function splitList(s){return String(s||'').split(',').map(x=>x.trim()).filter(Boolean);}
function initials(name){const p=String(name||'').trim().split(/\s+/).filter(Boolean);return((p[0]||'?')[0]+(p[1]?p[1][0]:(p[0]||'')[1]||'')).toUpperCase();}
function firstName(name){return String(name||'').trim().split(/\s+/)[0]||name;}
function debounce(fn,ms){let t;return(...a)=>{clearTimeout(t);t=setTimeout(()=>fn(...a),ms);};}
function timeoutSignal(ms){if(window.AbortSignal&&AbortSignal.timeout)return AbortSignal.timeout(ms);const c=new AbortController();setTimeout(()=>c.abort(),ms);return c.signal;}
function sameSet(a,b){a=[...new Set(a||[])];b=[...new Set(b||[])];return a.length===b.length&&a.every(x=>b.includes(x));}
function titleCase(s){return String(s||'').trim().replace(/\s+/g,' ').replace(/\b([a-z])/g,(m,c)=>c.toUpperCase());}
const LS={
  get(k,d){try{const v=localStorage.getItem(k);return v==null?d:JSON.parse(v);}catch(e){return d;}},
  set(k,v){try{localStorage.setItem(k,JSON.stringify(v));}catch(e){}},
  del(k){try{localStorage.removeItem(k);}catch(e){}}
};

/* ── Icons (the Kitchen Prep set) ────────────────────────────────────── */
const ICONS={
  printer:'<path d="M6 9V3.5h12V9"/><rect x="3" y="9" width="18" height="9" rx="2"/><path d="M6 15h12v5.5H6z"/>',
  plate:'<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4.5"/>',
  box:'<path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="M3 8l9 5 9-5M12 13v8"/>',
  clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  sliders:'<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
  search:'<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  plus:'<path d="M12 5v14M5 12h14"/>',
  minus:'<path d="M5 12h14"/>',
  chevron:'<path d="m9 6 6 6-6 6"/>',
  chevronL:'<path d="m15 6-6 6 6 6"/>',
  xmark:'<path d="M6 6l12 12M18 6 6 18"/>',
  check:'<path d="m5 12 5 5L20 7"/>',
  checkCircle:'<circle cx="12" cy="12" r="9"/><path d="m8.5 12 2.5 2.5 5-5"/>',
  warning:'<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
  info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
  lock:'<rect x="4" y="11" width="16" height="10" rx="2.5"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  unlock:'<rect x="4" y="11" width="16" height="10" rx="2.5"/><path d="M8 11V7a4 4 0 0 1 7.7-1.5"/>',
  pencil:'<path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z"/>',
  trash:'<path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/><path d="M10 10v6M14 10v6"/>',
  refresh:'<path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/>',
  snowflake:'<path d="M12 2v20M4.9 6.5l14.2 11M19.1 6.5 4.9 17.5"/><path d="m9.5 3.5 2.5 2 2.5-2M9.5 20.5l2.5-2 2.5 2"/>',
  drop:'<path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z"/>',
  leaf:'<path d="M11 20A7 7 0 0 1 4 13c0-5 4-9 11-10 2 0 4 .5 5 1-1 7-5 16-9 16z"/><path d="M4 21c3-4 6-6 11-8"/>',
  tag:'<path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z"/><circle cx="7.5" cy="7.5" r="1"/>',
  people:'<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M21.5 20a6.5 6.5 0 0 0-5-6.3"/>',
  person:'<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  calendar:'<rect x="3" y="4.5" width="18" height="17" rx="2.5"/><path d="M16 2.5v4M8 2.5v4M3 10h18"/>',
  doc:'<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h8"/>',
  copy:'<rect x="9" y="9" width="12" height="12" rx="2.5"/><path d="M5 15H4.5A2.5 2.5 0 0 1 2 12.5v-8A2.5 2.5 0 0 1 4.5 2h8A2.5 2.5 0 0 1 15 4.5V5"/>',
  share:'<path d="M12 3v12M8 7l4-4 4 4"/><path d="M4 13v6a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-6"/>',
  power:'<path d="M12 3v9"/><path d="M6.3 6.3a8 8 0 1 0 11.4 0"/>',
  download:'<path d="M12 3v12M8 11l4 4 4-4"/><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/>',
  bolt:'<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
  moon:'<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z"/>',
  checklist:'<path d="M10 6h11M10 12h11M10 18h11"/><path d="m3 6 1.5 1.5L7 5M3 12l1.5 1.5L7 11M3 18l1.5 1.5L7 17"/>',
  database:'<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5"/><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
  activity:'<path d="M3 12h4l3-8 4 16 3-8h4"/>',
  logout:'<path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><path d="M10 17l-5-5 5-5M5 12h11"/>',
  forkknife:'<path d="M5 2v7a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2V2M8 2v20M17 2c-2 0-3 3-3 6v3h3v11"/>',
  ellipsis:'<circle cx="5" cy="12" r="1.2" fill="currentColor"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/><circle cx="19" cy="12" r="1.2" fill="currentColor"/>',
  back:'<path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>',
  external:'<path d="M14 4h6v6M20 4l-9 9"/><path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/>',
  del:'<path d="M21 5H9l-7 7 7 7h12a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1z"/><path d="m17.5 9.5-5 5M12.5 9.5l5 5"/>',
  circle:'<circle cx="12" cy="12" r="9"/>'
};
function ico(name,cls=''){return`<svg class="ico ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]||ICONS.circle}</svg>`;}

/* ── Database (PostgREST over fetch) ─────────────────────────────────── */
async function rest(db,method,path,body,opt={}){
  const headers={apikey:db.key,Authorization:'Bearer '+db.key};
  if(body!==undefined)headers['Content-Type']='application/json';
  if(opt.prefer)headers.Prefer=opt.prefer;
  let r;
  try{r=await fetch(db.url+'/rest/v1/'+path,{method,headers,body:body!==undefined?JSON.stringify(body):undefined,signal:timeoutSignal(opt.timeout||15000),cache:'no-store'});}
  catch(e){const err=new Error(e&&e.name==='TimeoutError'?'The database took too long to answer':'No connection to the database');err.offline=true;throw err;}
  const txt=await r.text();let data=null;try{data=txt?JSON.parse(txt):null;}catch(e){}
  if(!r.ok){const err=new Error((data&&(data.message||data.hint||data.error))||txt||('HTTP '+r.status));err.status=r.status;err.code=data&&data.code;err.details=data&&data.details;throw err;}
  return data;
}
function isColumnError(e){return!!e&&(e.code==='PGRST204'||e.code==='42703'||/column/i.test(e.message||''));}

/* ── Toasts: top capsule; errors stay with Copy ──────────────────────── */
const _errLog=[];
let _toastAct=null;
function toast(msg,o={}){
  const t=$('#toast');clearTimeout(toast._t);
  const type=o.type||'ok';
  _toastAct=o.onAction||null;
  const icon=type==='busy'?'<span class="spin"></span>':ico(type==='err'?'warning':'check');
  let acts='';
  if(o.action)acts+=`<button class="toast-act" data-act="toast-act">${h(o.action)}</button>`;
  if(type==='err'){
    _errLog.unshift({at:new Date(),msg:String(msg)});if(_errLog.length>20)_errLog.pop();
    if(!o.action)acts+=`<button class="toast-act" data-act="toast-copy">Copy</button>`;
    acts+=`<button class="toast-x" data-act="toast-x" aria-label="Dismiss">${ico('xmark')}</button>`;
  }
  t.innerHTML=`<span class="t-ico">${icon}</span><span class="toast-msg">${h(msg)}</span>${acts}`;
  t.className='toast show '+type;
  const ms=o.ms||(type==='err'?12000:type==='busy'?30000:(o.action?6000:String(msg).length>60?4500:2800));
  toast._t=setTimeout(hideToast,ms);
}
function hideToast(){$('#toast').classList.remove('show');_toastAct=null;}
/* Phones: toasts sit above the tab bar — and above the Print bar or floating button when one shows. */
function setToastLift(){
  let lift=0;const f=$('#step-foot');if(S.view==='print'&&f&&!f.hidden)lift=f.offsetHeight;
  const fb=$('#float-bar');if(fb&&!fb.hidden)lift=Math.max(lift,fb.offsetHeight+10);
  document.documentElement.style.setProperty('--toast-lift',lift+'px');
}
async function copyText(text){
  try{await navigator.clipboard.writeText(text);return true;}
  catch(e){const ta=document.createElement('textarea');ta.value=text;ta.style.position='fixed';ta.style.opacity='0';document.body.appendChild(ta);ta.select();let ok=false;try{ok=document.execCommand('copy');}catch(_){}ta.remove();return ok;}
}
function errReport(rec){return`[Digby's CPS ${APP_VERSION} · ${rec.at.toLocaleString('en-GB',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})}] ${rec.msg}`;}
window.addEventListener('unhandledrejection',e=>{const r=e.reason;const m=r&&(r.message||(typeof r==='string'?r:''));if(m)toast(m,{type:'err'});});
window.addEventListener('error',e=>{if(e.error&&e.error.message)toast(e.error.message,{type:'err'});});

/* ── Sheets (one sheet + one confirm on top), focus kept inside ───────── */
const Sheet={open:false,onClose:null,returnFocus:null};
function openSheet({title,sub,body,foot,cls='',onClose,focus=true}){
  const ov=$('#ov');
  if(!Sheet.open)Sheet.returnFocus=document.activeElement;
  Sheet.onClose=onClose||null;
  ov.innerHTML=`<div class="sheet ${cls}" role="document">
    <div class="sheet-hd"><div class="sheet-t">${title||''}${sub?`<div class="sheet-s">${sub}</div>`:''}</div><button class="sheet-x" data-act="sheet-close" aria-label="Close">${ico('xmark')}</button></div>
    <div class="sheet-body">${body||''}</div>${foot?`<div class="sheet-foot">${foot}</div>`:''}</div>`;
  ov.classList.add('open');Sheet.open=true;document.body.classList.add('sheet-open');
  syncSegs(ov);
  if(focus)setTimeout(()=>{const f=ov.querySelector('[autofocus]')||ov.querySelector('.sheet-body input:not([type=date]),.sheet-body textarea');if(f&&matchMedia('(hover:hover)').matches)f.focus();},60);
  return ov.querySelector('.sheet');
}
function closeSheet(){
  const ov=$('#ov');if(!Sheet.open)return;
  ov.classList.remove('open');ov.innerHTML='';Sheet.open=false;if(!$('#ovc').classList.contains('open'))document.body.classList.remove('sheet-open');
  const cb=Sheet.onClose;Sheet.onClose=null;if(cb)cb();
  if(Sheet.returnFocus&&document.contains(Sheet.returnFocus))try{Sheet.returnFocus.focus({preventScroll:true});}catch(e){}
}
let _confirm=null;
function askConfirm(message,{title='Are you sure?',ok='Confirm',danger=true,cancel='Cancel'}={}){
  return new Promise(res=>{
    if(_confirm)_confirm(false);
    _confirm=res;
    const ov=$('#ovc');
    ov.innerHTML=`<div class="sheet narrow" role="document"><div class="sheet-hd"><div class="sheet-t">${h(title)}</div></div>
      <div class="sheet-body"><div class="confirm-msg">${h(message)}</div></div>
      <div class="sheet-foot"><button class="btn" data-act="confirm-no">${h(cancel)}</button><button class="btn ${danger?'btn-danger-solid':'btn-primary'}" data-act="confirm-yes" autofocus>${h(ok)}</button></div></div>`;
    ov.classList.add('open');document.body.classList.add('sheet-open');
    setTimeout(()=>{const b=ov.querySelector('[data-act=confirm-yes]');if(b)b.focus();},40);
  });
}
function resolveConfirm(v){const ov=$('#ovc');ov.classList.remove('open');if(!Sheet.open)document.body.classList.remove('sheet-open');ov.innerHTML='';const r=_confirm;_confirm=null;if(r)r(v);}
function topOverlay(){if($('#ovc').classList.contains('open'))return $('#ovc');if(Sheet.open)return $('#ov');return null;}
document.addEventListener('keydown',e=>{
  if(e.key!=='Tab')return;const ov=topOverlay();if(!ov)return;
  const f=$$('button:not(:disabled),input:not(:disabled),select,textarea,[tabindex]:not([tabindex="-1"])',ov).filter(x=>x.offsetParent!==null);
  if(!f.length)return;const i=f.indexOf(document.activeElement);
  if(e.shiftKey&&(i<=0)){e.preventDefault();f[f.length-1].focus();}
  else if(!e.shiftKey&&(i===-1||i===f.length-1)){e.preventDefault();f[0].focus();}
});
$('#ov')?.addEventListener('click',e=>{if(e.target.id==='ov')closeSheet();});

/* ── Segmented controls: a real sliding thumb ────────────────────────── */
function segSync(seg){
  const on=seg.querySelector(':scope > .on');
  if(!on||!seg.offsetWidth){seg.style.setProperty('--seg-o','0');return;}
  seg.style.setProperty('--seg-x',on.offsetLeft+'px');seg.style.setProperty('--seg-w',on.offsetWidth+'px');seg.style.setProperty('--seg-o','1');
}
function syncSegs(root=document){$$('.seg',root).forEach(segSync);}
if('ResizeObserver' in window){const ro=new ResizeObserver(es=>es.forEach(e=>segSync(e.target)));new MutationObserver(()=>{$$('.seg').forEach(s=>{if(!s._ro){s._ro=1;ro.observe(s);}segSync(s);});}).observe(document.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:['class']});}
function seg(items,cur,act,extra=''){return`<div class="seg ${extra}">${items.map(([v,l])=>`<button type="button" class="${String(v)===String(cur)?'on':''}" data-act="${act}" data-v="${h(v)}">${l}</button>`).join('')}</div>`;}

/* ── Activity log (kept in this browser, as before) ───────────────────── */
function alog(action,detail){
  try{const l=LS.get('_dcps_a',[]);l.unshift({who:S.user?S.user.name:'?',action,detail:detail||'',when:new Date().toLocaleString('en-GB',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'})});LS.set('_dcps_a',l.slice(0,2000));}catch(e){}
}

/* ── Theme ───────────────────────────────────────────────────────────── */
function applyTheme(){const t=LS.get('dcps_theme','auto');if(t==='auto')delete document.documentElement.dataset.theme;else document.documentElement.dataset.theme=t;}
applyTheme();

/* ── CSV out: download on desktop, share sheet on phones ─────────────── */
async function saveCSV(rows,name){
  const esc=v=>{const s=String(v??'');return/[",\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s;};
  const csv=rows.map(r=>r.map(esc).join(',')).join('\n');
  const blob=new Blob(['﻿'+csv],{type:'text/csv'});
  const standalone=matchMedia('(display-mode: standalone)').matches||navigator.standalone;
  if(standalone&&navigator.canShare){try{const f=new File([blob],name,{type:'text/csv'});if(navigator.canShare({files:[f]})){await navigator.share({files:[f],title:name});return;}}catch(e){if(e.name==='AbortError')return;}}
  const u=URL.createObjectURL(blob);const a=document.createElement('a');a.href=u;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),2000);
}
