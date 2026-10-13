/* ═══════════════════════════════════════════════════════════════════════
   STATE + DATA
   Kitchen Prep is the source of truth for its products (allergens locked
   here), its events and their job codes. CPS keeps what only CPS knows:
   custom products, containers, staff, job codes made here, history.
   ═══════════════════════════════════════════════════════════════════════ */
const S={
  user:null,
  staff:LS.get('dcps_staff_cache',[]),staffLoaded:false,
  kp:{products:[],dishes:[],events:[],settings:{},at:0,ok:null,error:null},
  cps:{products:[],jobs:[],at:0,ok:null,error:null},
  ext:LS.get('dcps_ext',null),          // print_jobs has the CPS 3 columns?
  printer:{state:'unknown',info:null,at:0,error:null},
  outbox:LS.get('dcps_outbox',[]),
  pendingRecords:LS.get('dcps_pending_records',[]),
  inbox:[],
  view:'print'
};
const isManager=()=>!!S.user&&(S.user.name===MANAGER||(S.staffLoaded&&S.staff.length===1&&String(S.staff[0].id)===String(S.user.id)));

/* ── Allergen names: Kitchen Prep's FSA names, old names and synonyms all
      land on the 14 CPS names. Anything else is kept as written — never dropped. ── */
const AL_SYN={'lactose':'Milk','cereals containing gluten':'Gluten','cereals':'Gluten','gluten':'Gluten','wheat':'Gluten','barley':'Gluten','rye':'Gluten','oats':'Gluten','spelt':'Gluten',
  'crustaceans':'Crustaceans','crustacean':'Crustaceans','shellfish':'Crustaceans','eggs':'Eggs','egg':'Eggs','fish':'Fish','peanuts':'Peanuts','peanut':'Peanuts',
  'soya':'Soya','soy':'Soya','soybeans':'Soya','soybean':'Soya','soya beans':'Soya','milk':'Milk','dairy':'Milk','nuts':'Nuts','tree nuts':'Nuts','nut':'Nuts',
  'celery':'Celery','celeriac':'Celery','mustard':'Mustard','sesame':'Sesame','sesame seeds':'Sesame','sulphites':'Sulphites','sulphur dioxide':'Sulphites',
  'sulfites':'Sulphites','sulphur dioxide and sulphites':'Sulphites','so2':'Sulphites','lupin':'Lupin','lupine':'Lupin','molluscs':'Molluscs','mollusc':'Molluscs','mollusks':'Molluscs'};
function mapAl(name){const raw=String(name??'').trim();const n=norm(raw);if(!n)return null;return AL_SYN[n]||AL.find(a=>a.toLowerCase()===n)||titleCase(raw);}
function alList(s){return sortAl(splitList(s).map(mapAl).filter(Boolean));}

/* ── Kitchen Prep ─────────────────────────────────────────────────────── */
function labelName(comp,dish){const c=String(comp&&comp.name||'').trim(),d=String(dish&&dish.name||'').trim();return c&&d&&c.toLowerCase()!==d.toLowerCase()?`${c} — ${d}`:(c||d||'Product');}
function kpSetting(k,d){const v=S.kp.settings[k];if(v===undefined||v===null||v==='')return d;return v;}
function chilledDays(){return parseInt(kpSetting('useby_chilled_days',3))||3;}
function frozenDays(){return parseInt(kpSetting('useby_frozen_days',90))||90;}
function rowsToAl(rows){
  const con=[],may=[];
  (rows||[]).forEach(a=>{const n=mapAl(a.allergen);if(!n)return;if(/may/i.test(a.status||''))may.push(n);else con.push(n);});
  return{contains:sortAl(con),may:sortAl(may.filter(x=>!con.includes(x)))};
}
/* Where a Kitchen Prep dish's allergens come from — the same as Kitchen Prep:
   · set on the dish (the builder keeps them on its first component; rows can
     be left on others after a reorder, or kept for prepped stock);
   · brought by its ingredients (Kitchen Prep 45+ tags ingredients: "Nuts" for
     contains, "may:Nuts" for may contain), matched by name as Kitchen Prep
     matches them — any case.
   Every component of a dish gets everything from all of its components and
   their ingredients; Contains wins over May contain. Never fewer than the dish has. */
let KP_ING=new Map();      // lower-case ingredient name → its allergen rows
function ingRows(list){
  return(Array.isArray(list)?list:splitList(list)).map(x=>{const t=String(x||'').trim();const may=/^may:/i.test(t);return{allergen:(may?t.slice(4):t).trim(),status:may?'May Contain':'Contains'};}).filter(r=>r.allergen);
}
function ingMap(ings){const m=new Map();(ings||[]).forEach(i=>{const k=String(i&&i.name||'').toLowerCase();if(k&&!m.has(k))m.set(k,ingRows(i.allergens));});return m;}
function compIngRows(c,map){return(c.recipe_ingredients||[]).flatMap(ri=>map.get(String(ri.ingredient_name||ri.name||'').toLowerCase().trim())||[]);}
function dishAllergens(d,map){
  const m=map||KP_ING;
  const all=rowsToAl((d.components||[]).flatMap(c=>[...(c.component_allergens||[]),...compIngRows(c,m)]));
  return{scope:'dish',of:()=>all};
}
function buildKpProducts(dishes,map){
  const out=[],seen=new Set();const chilledH=chilledDays()*24;
  for(const d of dishes||[]){
    const al=dishAllergens(d,map);
    for(const c of (d.components||[])){
      const name=labelName(c,d);const k=norm(name);if(!k||seen.has(k))continue;seen.add(k);
      const a=al.of(c);const hrs=parseInt(c.use_by_hours)||0;
      out.push({key:'kp:'+c.id,src:'kp',id:c.id,name,comp:c.name||'',dish:d.name||'',dishId:d.id,cat:d.category||'Other',
        section:KP_SECTION[d.category]||'',contains:a.contains,may:a.may,alScope:al.scope,
        shelfHours:hrs||chilledH,shelfFromKp:!!hrs,frozen:!!c.freeze_flag});
    }
  }
  return out;
}
function kpCache(){return LS.get('dcps_kp_cache',null);}
function applyKp(dishes,events,settings,at,ings){
  S.kp.settings=settings||{};
  if(ings!==undefined){S.kp.ings=ings;S.kp.ingKnown=!!ings;}
  KP_ING=ingMap(S.kp.ings||[]);
  S.kp.dishes=(dishes||[]).map(d=>({id:d.id,name:d.name,category:d.category||'Other',comps:(d.components||[]).map(c=>c.id)}));
  S.kp.products=buildKpProducts(dishes);
  S.kp.events=(events||[]).map(e=>({id:e.id,job_code:e.job_code?String(e.job_code).toUpperCase().trim():'',client_name:e.client_name||'',event_type:e.event_type||'',
    event_date:e.event_date||'',start_time:e.start_time||'',covers:e.covers||null,status:e.status||'',venue_name:e.venue_name||'',
    guest_allergens:Array.isArray(e.guest_allergens)?e.guest_allergens:[],dishes:(e.event_dishes||[]).map(x=>({dish_id:x.dish_id,portions:x.portions||null}))}));
  S.kp.at=at||Date.now();
  LS.set('dcps_kp_names2',{labels:S.kp.products.map(p=>norm(p.name)),dishes:(dishes||[]).map(d=>norm(d.name)),comps:(dishes||[]).flatMap(d=>(d.components||[]).map(c=>norm(c.name)))});
}
function slimDishes(dishes){return(dishes||[]).map(d=>({id:d.id,name:d.name,category:d.category,components:(d.components||[]).map(c=>({id:c.id,name:c.name,use_by_hours:c.use_by_hours,freeze_flag:c.freeze_flag,
  component_allergens:(c.component_allergens||[]).map(a=>({allergen:a.allergen,status:a.status})),recipe_ingredients:(c.recipe_ingredients||[]).map(ri=>({ingredient_name:ri.ingredient_name||ri.name||''}))}))}));}
function slimIngs(ings){return(ings||[]).filter(i=>i&&i.name&&(Array.isArray(i.allergens)?i.allergens.length:i.allergens)).map(i=>({name:i.name,allergens:i.allergens}));}
const DISH_Q=['dishes?select=id,name,category,components(id,name,use_by_hours,freeze_flag,component_allergens(allergen,status),recipe_ingredients(ingredient_name,name))&order=name','dishes?select=*,components(*,component_allergens(*),recipe_ingredients(*))&order=name'];
/* Ingredient allergens. A Kitchen Prep without them (no table or column) has none to add;
   any other failure fails the load — never labels missing what an ingredient brings. */
async function loadKpIngs(){
  try{return slimIngs(await rest(KP,'GET','ingredients?select=name,allergens&order=name'));}
  catch(e){if(!e.offline&&(e.code==='42P01'||e.code==='42703'||e.status===404))return[];throw e;}
}
async function tryQueries(db,qs){try{return await rest(db,'GET',qs[0]);}catch(e){if(e.offline)throw e;return await rest(db,'GET',qs[1]);}}
let _kpLoad=null;
function loadKP(){
  if(_kpLoad)return _kpLoad;
  _kpLoad=(async()=>{
    const from=addDays(ymd(),-10);
    const evQ=[`events?select=id,job_code,client_name,event_type,event_date,start_time,covers,status,venue_name,guest_allergens,event_dishes(dish_id,portions)&event_date=gte.${from}&order=event_date`,`events?select=*,event_dishes(*)&event_date=gte.${from}&order=event_date`];
    try{
      const stamp=await kpDishStamp().catch(()=>null);   // before the dishes, so an edit made meanwhile isn't missed
      const [dishes,events,settingsRows,ings]=await Promise.all([tryQueries(KP,DISH_Q),tryQueries(KP,evQ),rest(KP,'GET','app_settings?select=key,value').catch(()=>[]),loadKpIngs()]);
      const settings={};(settingsRows||[]).forEach(r=>{let v=r.value;if(typeof v==='string'){try{const j=JSON.parse(v);if(typeof j!=='object')v=j;}catch(e){}}settings[r.key]=v;});
      applyKp(dishes,events,settings,Date.now(),ings);
      S.kp.ok=true;S.kp.error=null;S.kp.fullAt=Date.now();S.kp.raw=slimDishes(dishes);S.kp.stamp=settledStamp(stamp);S.kp.ingSig=JSON.stringify(ings);markKpCopies();
      LS.set('dcps_kp_cache',{at:S.kp.at,dishes:S.kp.raw,events:S.kp.events.map(e=>({...e,event_dishes:e.dishes})),settings,ings});
    }catch(e){
      S.kp.ok=false;S.kp.error=e.message||String(e);
      if(!S.kp.products.length){const c=kpCache();if(c)try{applyKp(c.dishes,c.events,c.settings,c.at,c.ings===undefined?null:c.ings);}catch(_){}}
    }
    onDataChanged('kp');
  })().finally(()=>{_kpLoad=null;});
  return _kpLoad;
}
/* Kept fresh cheaply: dishes (the big part) are fetched again only when one
   was saved or deleted in Kitchen Prep — the newest updated_at or the count
   moves — or every 15 minutes regardless. Events are small and come every time.
   Labels don't depend on this: each Kitchen Prep label re-checks its dish the
   moment before it prints. */
async function kpDishStamp(){
  const r=await fetch(KP.url+'/rest/v1/dishes?select=updated_at&order=updated_at.desc.nullslast&limit=1',{headers:{apikey:KP.key,Authorization:'Bearer '+KP.key,Prefer:'count=exact'},signal:timeoutSignal(10000),cache:'no-store'});
  if(!r.ok)throw new Error('HTTP '+r.status);
  const d=await r.json();return((r.headers.get('content-range')||'').split('/')[1]||'')+'|'+((d&&d[0]&&d[0].updated_at)||'');
}
/* Kitchen Prep stamps a dish as it starts saving it, then rewrites its
   components, recipes and allergens. A load in that minute may have caught it
   half-saved, so its stamp isn't kept: the next refresh loads the dishes again. */
function settledStamp(stamp){
  const t=Date.parse(String(stamp||'').split('|')[1]||'');
  const age=Date.now()-t;
  return stamp&&!(t&&age<90e3&&age>-300e3)?stamp:null;
}
let _kpRefresh=null;
function refreshKP(){
  if(!S.kp.ok||!S.kp.raw||!S.kp.stamp||Date.now()-(S.kp.fullAt||0)>15*60e3)return loadKP();
  if(_kpRefresh||_kpLoad)return _kpRefresh||_kpLoad;
  _kpRefresh=(async()=>{
    try{
      let stamp;try{stamp=await kpDishStamp();}catch(e){_kpRefresh=null;return await loadKP();}
      if(stamp!==S.kp.stamp){_kpRefresh=null;return await loadKP();}
      const from=addDays(ymd(),-10);
      const [events,ings]=await Promise.all([tryQueries(KP,[`events?select=id,job_code,client_name,event_type,event_date,start_time,covers,status,venue_name,guest_allergens,event_dishes(dish_id,portions)&event_date=gte.${from}&order=event_date`,`events?select=*,event_dishes(*)&event_date=gte.${from}&order=event_date`]),loadKpIngs()]);
      applyKp(S.kp.raw,events,S.kp.settings,Date.now(),ings);S.kp.ok=true;S.kp.error=null;S.kp.ingSig=JSON.stringify(ings);
      LS.set('dcps_kp_cache',{at:S.kp.at,dishes:S.kp.raw,events:S.kp.events.map(e=>({...e,event_dishes:e.dishes})),settings:S.kp.settings,ings});
      onDataChanged('kp');
    }catch(e){S.kp.ok=false;S.kp.error=e.message||String(e);onDataChanged('kp');}
  })().finally(()=>{_kpRefresh=null;});
  return _kpRefresh;
}

/* Right before a Kitchen Prep product prints: its dish's allergens, straight
   from Kitchen Prep. Returns null if Kitchen Prep can't be reached. Labels
   checked together share one fetch of the ingredients (ingsP). */
async function freshKpProduct(p,ingsP){
  if(!p||p.src!=='kp')return null;
  try{
    const q=[`dishes?id=eq.${encodeURIComponent(p.dishId)}&select=id,name,category,components(id,name,use_by_hours,freeze_flag,component_allergens(allergen,status),recipe_ingredients(ingredient_name,name))`,`dishes?id=eq.${encodeURIComponent(p.dishId)}&select=*,components(*,component_allergens(*),recipe_ingredients(*))`];
    const [rows,ings]=await Promise.all([tryQueries(KP,q),ingsP||loadKpIngs()]);
    if(!rows||!rows.length)return{gone:true};
    return buildKpProducts(rows,ingMap(ings)).find(x=>x.key===p.key)||{gone:true};
  }catch(e){return null;}
}
function kpKnown(){return S.kp.products.length>0||!!LS.get('dcps_kp_names2',null);}
let _kpn=null,_kpnAt=-1;
function kpNames(){
  if(_kpn&&_kpnAt===S.kp.at)return _kpn;
  if(S.kp.products.length)_kpn={labels:new Set(S.kp.products.map(p=>norm(p.name))),dishes:new Set(S.kp.dishes.map(d=>norm(d.name))),comps:new Set(S.kp.products.map(p=>norm(p.comp)).filter(Boolean))};
  else{const c=LS.get('dcps_kp_names2',null)||{};_kpn={labels:new Set(c.labels||[]),dishes:new Set(c.dishes||[]),comps:new Set(c.comps||[])};}
  _kpnAt=S.kp.at;return _kpn;
}
function kpNameSet(){return kpNames().labels;}
/* A CPS product row that Kitchen Prep wrote (its sync keeps a copy of every
   product in CPS). Current ones are hidden behind the real thing; ones left
   behind by a rename are "old copies" — hidden too, and listed for tidying. */
const KP_MARK='Kitchen Prep',CUSTOM_MARK='Custom';   // products.menu_type: a copy Kitchen Prep's sync wrote / made here
let _seen=null;
function kpSeen(){return _seen||(_seen=new Set(LS.get('dcps_kp_seen',[])));}
function forgetKpName(name){const s=kpSeen();if(s.delete(norm(name))){LS.set('dcps_kp_seen',[...s]);_cpCache=null;}}
function kpCopyKind(row){
  const name=typeof row==='string'?row:row&&row.name;const n=norm(name);if(!n)return null;
  const k=kpNames();
  if(k.labels.has(n)||k.dishes.has(n))return'current';
  if(row&&row.menu_type===CUSTOM_MARK)return null;
  if(row&&row.menu_type===KP_MARK)return'old';
  if(n.includes(' — ')||kpSeen().has(n)||(k.comps&&k.comps.has(n)))return'old';
  // The sync gives freezer components exactly the frozen days as a shelf life — never
  // offered as a fresh custom product until a manager checks it.
  if(row&&parseInt(row.shelf_life_hours)===frozenDays()*24)return'maybe';
  return null;
}
/* Once both lists are in: mark the CPS rows that are copies of Kitchen Prep
   products, so they're still known as copies after a rename there. */
let _marking=false;
async function markKpCopies(){
  if(_marking||!S.kp.ok||!S.cps.ok)return;
  const k=kpNames();
  const seen=kpSeen();const before=seen.size;k.labels.forEach(n=>seen.add(n));
  if(seen.size!==before){LS.set('dcps_kp_seen',[...seen].slice(-3000));_cpCache=null;}
  const todo=S.cps.products.filter(p=>p.category!==CONTAINER&&p.menu_type!==KP_MARK&&(k.labels.has(norm(p.name))||k.dishes.has(norm(p.name))));
  if(!todo.length)return;
  _marking=true;
  try{await rest(CPS,'PATCH','products?id=in.('+todo.map(p=>encodeURIComponent(p.id)).join(',')+')',{menu_type:KP_MARK},{prefer:'return=minimal'});todo.forEach(p=>p.menu_type=KP_MARK);}
  catch(e){}
  finally{_marking=false;}
}

/* ── CPS ──────────────────────────────────────────────────────────────── */
async function loadStaff(){
  const rows=await rest(CPS,'GET','staff?select=*&order=name.asc');
  S.staff=(rows||[]).filter(s=>s&&s.name);S.staffLoaded=true;LS.set('dcps_staff_cache',S.staff);return S.staff;
}
async function loadCPS(){
  try{
    const [prods,jobs]=await Promise.all([rest(CPS,'GET','products?select=*&order=name.asc'),rest(CPS,'GET','job_codes?select=*&order=created_at.desc')]);
    S.cps.products=prods||[];S.cps.jobs=jobs||[];S.cps.at=Date.now();S.cps.ok=true;S.cps.error=null;markKpCopies();
    LS.set('dcps_cps_cache',{products:S.cps.products,jobs:S.cps.jobs,at:S.cps.at});
  }catch(e){
    S.cps.ok=false;S.cps.error=e.message;
    if(!S.cps.products.length){const c=LS.get('dcps_cps_cache',null);if(c){S.cps.products=c.products||[];S.cps.jobs=c.jobs||[];S.cps.at=c.at;}}
  }
  onDataChanged('cps');
}
async function probeExt(){
  try{await rest(CPS,'GET','print_jobs?select=source,label_type,allergens_edited,status_date,weight_display&limit=1');S.ext=true;}
  catch(e){if(!e.offline)S.ext=false;}
  LS.set('dcps_ext',S.ext);return S.ext;
}

/* ── One product list for the picker ──────────────────────────────────── */
let _cpCache=null,_cpKey=null;
function customProducts(){
  const key=[S.cps.products,S.kp.at,S.cps.products.length];
  if(_cpCache&&_cpKey&&_cpKey.every((v,i)=>v===key[i]))return _cpCache;
  _cpKey=key;
  return _cpCache=S.cps.products.filter(p=>p.category!==CONTAINER&&!kpCopyKind(p)).map(customFromRow);
}
function customFromRow(p){
  return{key:'cps:'+p.id,src:'custom',id:p.id,name:String(p.name||'').trim(),cat:p.category||'Other',section:CAT_SECTION[p.category]||'',
    contains:alList(p.contains),may:alList(p.may_contain).filter(x=>!alList(p.contains).includes(x)),
    shelfHours:parseInt(p.shelf_life_hours)||72,frozen:false,row:p};
}
function oldKpCopies(){return S.cps.products.filter(p=>p.category!==CONTAINER&&kpCopyKind(p)==='old');}
/* Made before CPS 3 (no mark), or looks like a Kitchen Prep freezer copy: a manager checks each once. */
function uncheckedProducts(){return S.cps.products.filter(p=>p.category!==CONTAINER&&p.menu_type!==CUSTOM_MARK&&(kpCopyKind(p)===null||kpCopyKind(p)==='maybe'));}
/* A product row, written with its mark — without it if this database has no such column. */
async function saveProductRow(method,path,body){
  try{return await rest(CPS,method,path,body,{prefer:'return=minimal'});}
  catch(e){const has=Array.isArray(body)?body.some(b=>'menu_type'in b):'menu_type'in body;if(!e.offline&&has&&(isColumnError(e)||/22P02|42804|malformed array/i.test((e.code||'')+' '+e.message))){const strip=({menu_type,...r})=>r;return await rest(CPS,method,path,Array.isArray(body)?body.map(strip):strip(body),{prefer:'return=minimal'});}throw e;}
}
function rowForInsert(r){const{id,created_at,updated_at,...rest}=r;return rest;}
/* checked: its allergens were chosen — some allergens, or No allergens (saved as an empty contains).
   An older container saved with nothing has to be checked before it prints. */
function containers(){return S.cps.products.filter(p=>p.category===CONTAINER).map(p=>({id:p.id,name:String(p.name||'').trim(),contains:alList(p.contains),may:alList(p.may_contain),
  shelf:SHELVES.includes(p.menu_type)?p.menu_type:'',checked:p.contains!=null||p.may_contain!=null,row:p})).sort((a,b)=>a.name.localeCompare(b.name));}
function shelfOf(c){return c.shelf||guessShelf(c.name);}
function byShelf(list){return SHELVES.map(s=>[s,list.filter(c=>shelfOf(c)===s)]).filter(([,l])=>l.length);}
function allProducts(){return[...S.kp.products,...customProducts()];}
function productByKey(k){return allProducts().find(p=>p.key===k)||null;}
function productByName(name){const n=norm(name);return S.kp.products.find(p=>norm(p.name)===n)||customProducts().find(p=>norm(p.name)===n)||null;}
function oneOff(name,contains=[],may=[]){return{key:'one:'+norm(name),src:'oneoff',name:String(name).trim(),cat:'One-off',section:'',contains,may,shelfHours:chilledDays()*24,frozen:false};}

/* ── Jobs: Kitchen Prep events first, then CPS-only codes ─────────────── */
function kpEvents(daysBack=3){
  const from=addDays(ymd(),-daysBack);
  return S.kp.events.filter(e=>e.status!=='Cancelled'&&e.event_date>=from).sort((a,b)=>(a.event_date+a.start_time).localeCompare(b.event_date+b.start_time));
}
function evJob(e){return{code:e.job_code,client:e.client_name||'Event',date:e.event_date,covers:e.covers,status:e.status,type:e.event_type,venue:e.venue_name,ev:e,src:'kp'};}
function kpJobs(){const seen=new Set();return kpEvents().filter(e=>e.job_code&&!seen.has(e.job_code)&&seen.add(e.job_code)).map(evJob);}
function allKpCodes(){return new Set(S.kp.events.map(e=>e.job_code).filter(Boolean));}
function codeDate(code){const m=/(\d{2})(\d{2})(\d{2})[A-Z]*$/.exec(String(code||''));if(!m)return null;const d=`20${m[3]}-${m[2]}-${m[1]}`;return isYmd(d)&&parseYmd(d).getDate()===+m[1]?d:null;}
function customJobs({current}={}){
  const kp=allKpCodes(),cut=addDays(ymd(),-7);
  return S.cps.jobs.filter(j=>j.code&&!kp.has(String(j.code).toUpperCase().trim())).map(j=>({code:String(j.code).toUpperCase().trim(),client:j.description||'',date:codeDate(j.code),src:'cps',id:j.id,row:j}))
    .filter(j=>!current||!j.date||j.date>=cut);
}
function jobByCode(code){if(!code)return null;const c=String(code).toUpperCase().trim();const ev=S.kp.events.find(e=>e.job_code===c);if(ev)return evJob(ev);const j=customJobs().find(x=>x.code===c);return j||{code:c,client:'',src:'unknown'};}
function eventsWithDish(dishId){if(!dishId)return[];return kpJobs().filter(j=>j.date>=ymd()&&j.ev.dishes.some(d=>d.dish_id===dishId));}
function menuProducts(job){
  if(!job||!job.ev)return[];
  const out=[];
  job.ev.dishes.forEach(ed=>{S.kp.products.filter(p=>p.dishId===ed.dish_id).forEach(p=>out.push({p,portions:ed.portions}));});
  return out;
}

/* ── Sent from Kitchen Prep: print_jobs rows it wrote to be printed here
      (label_status FRIDGE / FREEZER — the brine labels, stock labels). ── */
async function loadInbox(){
  const since=new Date(Date.now()-3*86400e3).toISOString();
  try{
    const rows=await rest(CPS,'GET',`print_jobs?select=*&label_status=in.(FRIDGE,FREEZER)&created_at=gte.${encodeURIComponent(since)}&order=created_at.asc&limit=100`);
    const done=new Set(LS.get('dcps_inbox_done',[]));
    S.inbox=(rows||[]).filter(r=>!done.has(String(r.id)));
    // anything printed here whose status couldn't be updated at the time: try again
    const stale=(rows||[]).filter(r=>done.has(String(r.id)));
    stale.forEach(r=>rest(CPS,'PATCH','print_jobs?id=eq.'+encodeURIComponent(r.id),{label_status:r.label_status==='FREEZER'?'FROZEN':null},{prefer:'return=minimal'}).catch(()=>{}));
  }catch(e){}
  onDataChanged('inbox');
}
/* prod: the Kitchen Prep product fetched a moment ago (else the loaded one). */
function inboxPayload(r,prod){
  const st=r.label_status==='FREEZER'?'FROZEN':null;const q=String(r.quantity??'1').trim();const whole=/^\d+$/.test(q);
  const p=prod&&!prod.gone?prod:productByName(r.product_name);const kp=!!(p&&p.src==='kp');
  const use=kp?{contains:p.contains.join(', ')||null,may:p.may.join(', ')||null}:{contains:r.contains||null,may:r.may_contain||null};
  const made=isYmd(r.date_prepped)?r.date_prepped:ymd();
  // Kitchen Prep dates its stock labels by its chilled/frozen days; a component with a shorter life gets its own.
  const cap=kp?(st?addDays(made,frozenDays()):addHours(made,p.shelfHours||chilledDays()*24)):null;
  let useby=isYmd(r.date_useby)?r.date_useby:(cap||'');if(cap&&(!useby||useby>cap))useby=cap;
  return{product_name:r.product_name,staff_name:r.staff_name||'',section:KP_SECTION[r.section]||r.section||null,job_code:r.job_code||null,quantity:whole?Math.max(1,Math.min(50,parseInt(q))):1,
    date_prepped:made,date_useby:useby,contains:use.contains,may_contain:use.may,status:st,status_date:st?made:null,
    weight_display:whole?null:(q||null),notes:r.notes||null,printed_at:hhmm(),source_note:'Kitchen Prep'};
}
function inboxExpired(r){const u=inboxPayload(r).date_useby;return!!u&&u<ymd();}
function inboxChanged(r){const p=productByName(r.product_name);return!!(p&&p.src==='kp'&&(!sameSet(alList(r.contains),p.contains)||!sameSet(alList(r.may_contain),p.may)));}
async function markInboxPrinted(r){
  const done=LS.get('dcps_inbox_done',[]);done.push(String(r.id));LS.set('dcps_inbox_done',done.slice(-300));
  S.inbox=S.inbox.filter(x=>String(x.id)!==String(r.id));
  try{await rest(CPS,'PATCH','print_jobs?id=eq.'+encodeURIComponent(r.id),{label_status:r.label_status==='FREEZER'?'FROZEN':null,printed_at:hhmm()},{prefer:'return=minimal'});}catch(e){}
  onDataChanged('inbox');
}

/* ── Printing records (history) — never lost ──────────────────────────── */
const BASE_COLS=['product_name','staff_name','section','job_code','quantity','date_prepped','date_useby','contains','may_contain','notes','printed_at','label_status'];
const EXT_COLS=['source','label_type','allergens_edited','status_date','weight_display'];
function pick(o,keys){const r={};keys.forEach(k=>{if(o[k]!==undefined)r[k]=o[k];});return r;}
async function insertRecord(rec){
  const useExt=S.ext!==false;
  let body=pick(rec,useExt?[...BASE_COLS,...EXT_COLS]:BASE_COLS);
  for(let attempt=0;attempt<3;attempt++){
    try{await rest(CPS,'POST','print_jobs',body,{prefer:'return=minimal'});if(useExt&&S.ext!==true){S.ext=true;LS.set('dcps_ext',true);}return true;}
    catch(e){
      if(e.offline)throw e;
      if(isColumnError(e)&&Object.keys(body).some(k=>EXT_COLS.includes(k))){S.ext=false;LS.set('dcps_ext',false);body=pick(rec,BASE_COLS);continue;}
      if(e.code==='23502'){body={...body};['date_useby','date_prepped'].forEach(k=>{if(body[k]==null)body[k]=rec.date_prepped||ymd();});['section','job_code','contains','may_contain','notes','label_status'].forEach(k=>{if(body[k]==null)body[k]='';});continue;}
      throw e;
    }
  }
  return false;
}
function savePending(){LS.set('dcps_pending_records',S.pendingRecords);}
async function recordPrint(rec){
  try{await insertRecord(rec);onDataChanged('history');return true;}
  catch(e){S.pendingRecords.push({rec,at:Date.now(),pid:uid(),error:e.offline?null:e.message});savePending();onDataChanged('history');return false;}
}
async function flushRecords(){
  if(!S.pendingRecords.length||flushRecords.busy)return;
  flushRecords.busy=true;
  const batch=S.pendingRecords;S.pendingRecords=[];
  const keep=[];let offline=false,sent=0;
  for(const p of batch){
    if(offline){keep.push(p);continue;}
    try{await insertRecord(p.rec);sent++;}
    catch(e){if(e.offline){offline=true;}else{p.tries=(p.tries||0)+1;p.error=e.message;}keep.push(p);}
  }
  S.pendingRecords=keep.concat(S.pendingRecords);savePending();
  flushRecords.busy=false;
  if(sent)onDataChanged('history');
}

/* ── Didn't print: kept until it prints or someone discards it ────────── */
function saveOutbox(){LS.set('dcps_outbox',S.outbox);updateBadges();}
function addToOutbox(item,res){
  const ex=S.outbox.find(o=>o.id===item.id);
  // the Pi answered but couldn't find the printer: nothing printed, so it's resent when the printer's back, like an unreachable Pi
  const noPrinter=!res.timeout&&!res.unreachable&&!res.stale&&/printer not found/i.test(res.error||'');
  const info={error:res.error,maybePrinted:!!res.timeout,unreachable:!!res.unreachable,noPrinter,stale:!!res.stale,fresh:res.fresh||null};
  if(ex){Object.assign(ex,info);ex.tries=(ex.tries||1)+1;ex.at=Date.now();}
  else S.outbox.unshift({...item,...info,tries:1,at:Date.now()});
  saveOutbox();
}
function removeFromOutbox(id){S.outbox=S.outbox.filter(o=>o.id!==id);saveOutbox();}
/* Send one item ({id,kind,payload,record,title}) to the printer; record it once it's sent. */
async function sendItem(item){
  const res=await sendToPrinter({...item.payload,job_id:item.id});
  if(res.ok){removeFromOutbox(item.id);recordPrint({...item.record,printed_at:item.payload.printed_at||hhmm()});return res;}
  addToOutbox(item,res);
  return res;
}

/* Everything that changes data tells the visible view to redraw. */
const _listeners={};
function onData(kind,fn){(_listeners[kind]=_listeners[kind]||[]).push(fn);}
function onDataChanged(kind){(_listeners[kind]||[]).forEach(fn=>{try{fn();}catch(e){console.error(e);}});(_listeners.any||[]).forEach(fn=>{try{fn(kind);}catch(e){console.error(e);}});}

/* One tap, one action: a second tap while the first is still running is ignored. */
const _busy=new Set();
async function once(key,fn){if(_busy.has(key))return;_busy.add(key);try{return await fn();}finally{_busy.delete(key);}}
