/* ═══════════════════════════════════════════════════════════════════════
   PLATES — dietary labels for the plate rim. Pick the event and its
   dietary guests come straight from Kitchen Prep's function sheet. Tap a
   guest (their table and seat are remembered), tap every course they're
   having, Add — one label per course. The queue prints course by course.
   ═══════════════════════════════════════════════════════════════════════ */
const PL={eventId:LS.get('dcps_plate_event',null),guestKey:null,name:'',table:'',pos:'',urgency:'allergy',diets:[],custom:'',dishes:[],dish:'',
  queue:LS.get('dcps_plate_queue',[]),busy:false};
const COURSES=[['Canapés',['Canapés']],['Starters',['Starters']],['Mains',['Mains','Sides','Kids']],['Desserts',['Desserts']],['Evening',['Evening Grazing']],['Tasting menu',['Tasting Menu']]];
const DIET_WORDS={'gf':'Gluten Free','gluten free':'Gluten Free','gluten-free':'Gluten Free','vegan':'Vegan','vegetarian':'Vegetarian','veggie':'Vegetarian','veg':'Vegetarian','lactose free':'Lactose Free','lactose-free':'Lactose Free'};
const DIET_IMPLIES={'Gluten Free':['Gluten'],'Vegan':['Milk','Eggs','Fish','Crustaceans','Molluscs'],'Vegetarian':['Fish','Crustaceans','Molluscs']};
function plEvent(){return PL.eventId?S.kp.events.find(e=>e.id===PL.eventId)||null:null;}
function savePlQueue(){LS.set('dcps_plate_queue',PL.queue.map(q=>({...q,state:''})));updateBadges();renderFloatBar();}
function plDietary(src){
  const d=src||PL;const diets=DIETS.filter(x=>d.diets.includes(x));const als=d.diets.filter(x=>!DIETS.includes(x));
  return[...diets,...(String(d.custom||'').trim()?[String(d.custom).trim()]:[]),...sortAl(als)].join(' · ');
}
function dishCourse(name){
  const d=S.kp.dishes.find(x=>norm(x.name)===norm(name));const cat=d?d.category:'';
  const i=COURSES.findIndex(([,cats])=>cats.includes(cat));return i<0?90:i;
}
function courseName(i){return i<COURSES.length?COURSES[i][0]:'Other';}
function plCurrent(){return{name:PL.name.trim(),table:String(PL.table).trim(),pos:String(PL.pos).trim(),urgency:PL.urgency,dietary:plDietary(),dish:'',job:(plEvent()||{}).job_code||null,eventId:PL.eventId};}
function plPayload(q){return{plate:true,guest_name:q.name,table:q.table,position:q.pos,dietary:q.dietary,dish:q.dish||'',urgency:q.urgency,printed_at:hhmm(),quantity:1};}
function plRecord(q){return{product_name:'Plate · '+q.name,staff_name:S.user?S.user.name:'',section:'Plates',job_code:q.job||null,quantity:1,date_prepped:ymd(),date_useby:null,
  contains:q.dietary||null,may_contain:null,notes:`T${q.table} P${q.pos}${q.dish?' · '+q.dish:''}`,printed_at:hhmm(),label_status:String(q.urgency||'allergy').toUpperCase(),
  source:'plate',label_type:'plate',allergens_edited:false};}
function guestKey(g,i){return i+':'+norm(g.name);}
function guestType(g){const t=String(g.type||g.severity||'allergy').toLowerCase();return t==='intolerance'?'intolerance':(t==='preference'||t==='dislike')?'dislike':'allergy';}
function seatFor(name){const m=LS.get('dcps_plate_seats',{})||{};return((m[PL.eventId||'-']||{})[norm(name)])||null;}
function rememberSeat(name,table,pos){const m=LS.get('dcps_plate_seats',{})||{};const k=PL.eventId||'-';(m[k]=m[k]||{})[norm(name)]={table,pos};LS.set('dcps_plate_seats',m);}
function guestCount(name){
  const n=norm(name);const q=PL.queue.filter(x=>x.eventId===PL.eventId&&norm(x.name)===n).length;
  const done=((LS.get('dcps_plate_done2',{})[PL.eventId]||{})[n])||0;return q+done;
}
function guestToForm(g,key){
  PL.guestKey=key;PL.name=String(g.name||'').trim();PL.urgency=guestType(g);
  const diet=String(g.dietary||g.custom||'').trim();const known=DIET_WORDS[norm(diet)];
  const implied=known?(DIET_IMPLIES[known]||[]):[];
  PL.diets=[...(known?[known]:[]),...(g.allergens||[]).map(mapAl).filter(a=>a&&!implied.includes(a))];
  PL.custom=known?'':diet;
  const seat=seatFor(PL.name);PL.table=seat?seat.table:'';PL.pos=seat?seat.pos:'';
  PL.dishes=[];PL.dish='';
}
function plClear(){Object.assign(PL,{guestKey:null,name:'',table:'',pos:'',urgency:'allergy',diets:[],custom:'',dishes:[],dish:''});}

function autoPickEvent(){
  const ev=plEvent();if(ev&&ev.event_date>=addDays(ymd(),-1))return;
  const next=kpEvents(1).find(e=>e.event_date>=ymd()&&(e.guest_allergens||[]).length);
  if(next){PL.eventId=next.id;LS.set('dcps_plate_event',next.id);}
}
function renderPlates(){
  autoPickEvent();
  $('#view-plates').innerHTML=`<div class="ph"><div class="ph-title">Plates<div class="ph-sub">Dietary labels for the plate rim</div></div><div class="ph-acts">${printerPillHTML()}</div></div>
    <div class="two"><div class="two-main"><div class="phone-only pl-sticky" id="pl-mini"></div><div class="pl-form" id="pl-form"></div></div><aside class="two-side show" id="pl-side"></aside></div>`;
  renderPlForm();renderPlSide();renderFloatBar();
}
function menuDishes(ev){
  if(!ev)return[];
  const ds=ev.dishes.map(x=>S.kp.dishes.find(d=>d.id===x.dish_id)).filter(Boolean);
  return ds.sort((a,b)=>dishCourse(a.name)-dishCourse(b.name));
}
function renderPlForm(){
  const el=$('#pl-form');if(!el)return;
  const ev=plEvent();const guests=ev?ev.guest_allergens||[]:[];
  el.innerHTML=`
    <div class="group-hd" style="padding-top:4px">Event</div>
    <div class="group"><button class="row row-nav" data-act="pl-event">${ico('calendar')}<span class="row-main"><span class="row-t">${ev?h(ev.client_name||'Event'):'Choose an event'}</span><span class="row-s">${ev?`${ev.job_code?`<span class="mono">${h(ev.job_code)}</span> · `:''}${h(dayWords(ev.event_date))}${ev.covers?' · '+ev.covers+' covers':''}`:'Brings in its dietary guests and menu from Kitchen Prep'}</span></span>${ico('chevron','chev')}</button></div>
    ${ev?(guests.length?`<div class="group-hd"><span>Dietary guests</span><span class="n">${guests.length}</span></div>
      <div class="guests">${guests.map((g,i)=>{const k=guestKey(g,i);const n=guestCount(g.name);const t=guestType(g);return`<button class="guest${PL.guestKey===k?' on':''}" data-act="pl-guest" data-i="${i}"><span class="gd ${t}"></span><span class="grow"><b>${h(g.name||'Guest')}</b> <span class="muted">${h(String(g.dietary||'').trim()||(g.allergens||[]).map(mapAl).filter(Boolean).join(', '))}</span></span>${n?`<span class="g-n">${n}</span>`:''}</button>`;}).join('')}</div>`
      :`<div class="group-ft">No dietary guests on this event in Kitchen Prep — type them below.</div>`):''}
    <div class="group-hd">Guest</div>
    <div class="group"><div class="row row-stack">
      <div class="fld"><label class="fld-label" for="pl-name">Name</label><input class="inp inp-lg" id="pl-name" data-in="pl-f" data-k="name" value="${h(PL.name)}" placeholder="Guest name" autocomplete="off"><div id="pl-name-warn"></div></div>
      <div class="tp"><div class="fld"><label class="fld-label" for="pl-table">Table</label><input class="inp inp-lg inp-num" id="pl-table" data-in="pl-f" data-k="table" value="${h(PL.table)}" inputmode="numeric" autocomplete="off" placeholder="—"></div>
      <div class="fld"><label class="fld-label" for="pl-pos">Position</label><input class="inp inp-lg inp-num" id="pl-pos" data-in="pl-f" data-k="pos" value="${h(PL.pos)}" inputmode="numeric" autocomplete="off" placeholder="—"></div></div>
    </div></div>
    <div class="group-hd">Requirement</div>
    <div class="group"><div class="row row-stack">
      ${seg([['allergy','Allergy'],['intolerance','Intolerance'],['dislike','Dislike']],PL.urgency,'pl-urg','seg-lg seg-block')}
      <div class="chips" id="pl-chips">${plChipsHTML()}</div>
      <input class="inp" data-in="pl-f" data-k="custom" value="${h(PL.custom)}" placeholder="Anything else — e.g. Coeliac, no alliums" autocomplete="off" aria-label="Other requirement">
    </div></div>
    <div class="group-hd"><span>Courses</span><span class="n">${ev&&menuDishes(ev).length?'tap each one they’re having':'optional'}</span></div>
    <div class="group"><div class="row row-stack">
      ${ev&&menuDishes(ev).length?`<div class="chips" id="pl-menu">${plMenuHTML()}</div>`:''}
      <input class="inp" id="pl-dish" data-in="pl-f" data-k="dish" value="${h(PL.dish)}" placeholder="${ev&&menuDishes(ev).length?'Or type a dish':'e.g. Gluten free bread, chilli honey butter'}" autocomplete="off" aria-label="Dish">
    </div></div>
    <div class="inline pl-acts"><button class="btn btn-primary btn-lg" data-act="pl-add" id="pl-add">${ico('plus')}<span>${plAddText()}</span></button><button class="btn btn-lg" data-act="pl-next">Next guest</button></div>
    <div class="group-ft">The guest stays filled in after Add, so the next course is just a tap.</div>`;
  syncSegs(el);plNameWarn();renderPlMini();
}
function plDishList(){const out=[...PL.dishes];if(PL.dish.trim())out.push(PL.dish.trim());return out;}
function plAddText(){const n=plDishList().length;return n>1?`Add ${n} labels`:'Add to queue';}
function plChipsHTML(){return[...DIETS,...AL].map(d=>`<button class="alc${PL.diets.includes(d)?(DIETS.includes(d)?' d':' c'):''}" data-act="pl-diet" data-v="${h(d)}" aria-pressed="${PL.diets.includes(d)}">${h(d)}</button>`).join('');}
function plMenuHTML(){return menuDishes(plEvent()).map(d=>`<button class="chip${PL.dishes.includes(d.name)?' on':''}" data-act="pl-dish" data-v="${h(d.name)}" aria-pressed="${PL.dishes.includes(d.name)}"><span class="faint">${h(courseName(dishCourse(d.name)))}</span> ${h(d.name)}</button>`).join('');}
function plNameWarn(){
  const el=$('#pl-name-warn');if(!el)return;
  const long=PL.name.trim()&&tw(PL.name.trim(),'large')>LBL_W-28;
  el.innerHTML=long?`<div class="warn-note soft" style="margin-top:6px">${ico('info','ico-sm')}Too long for the label — the end gets cut off. First name and initial fits.</div>`:'';
}
function plPreviewPayload(){const cur=plCurrent();const d=plDishList();return{...plPayload(cur),dish:d[0]||''};}
function renderPlMini(){
  const el=$('#pl-mini');if(!el)return;
  const cur=plCurrent();
  el.innerHTML=cur.name||cur.dietary?previewHTML('lp-plate-mini',1):'';
  if(cur.name||cur.dietary)paintLabel($('#lp-plate-mini'),plPreviewPayload());
}
function renderPlSide(){
  const el=$('#pl-side');if(!el)return;
  const cur=plCurrent();const show=cur.name||cur.dietary;const n=PL.queue.length;
  el.innerHTML=`<div class="lp desk-only"><div class="lp-cap"><b>Label</b><span>as it prints</span></div>${show?previewHTML('lp-plate',1):`<div class="lp-ghost" style="height:180px">${ico('plate')}<span>Choose a guest or type a name</span></div>`}</div>
    <div><div class="group-hd"><span>Queue</span><span class="n">${n?plural(n,'label'):''}</span></div>
    <div id="pl-queue">${plQueueHTML()}</div></div>
    ${n?`<div class="side-foot"><button class="btn btn-primary btn-lg btn-block desk-only" data-act="pl-print" ${PL.busy?'disabled':''}>${PL.busy?'<span class="spin"></span>Printing…':ico('printer')+'Print all '+plural(n,'label')}</button><button class="btn btn-sm btn-plain" data-act="pl-clear-queue" ${PL.busy?'disabled':''}>Clear the queue</button></div>`:''}`;
  if(show)paintLabel($('#lp-plate'),plPreviewPayload());
  renderPlMini();
}
function sortedQueue(){return[...PL.queue].sort((a,b)=>(a.course??90)-(b.course??90)||(parseFloat(a.table)||0)-(parseFloat(b.table)||0)||(parseFloat(a.pos)||0)-(parseFloat(b.pos)||0));}
function plQueueHTML(){
  if(!PL.queue.length)return`<div class="group"><div class="empty" style="padding:28px 16px">${ico('plate')}<div class="empty-s">Labels you add wait here, then print course by course.</div></div></div>`;
  const q=sortedQueue();const groups=[];q.forEach(x=>{const c=x.course??90;let g=groups.find(y=>y.c===c);if(!g){g={c,items:[]};groups.push(g);}g.items.push(x);});
  return groups.map(g=>`<div class="q-course"><span>${h(courseName(g.c))}</span>${groups.length>1?`<button class="btn btn-xs btn-tint" data-act="pl-print-course" data-c="${g.c}" ${PL.busy?'disabled':''}>${ico('printer')}Print ${g.items.length}</button>`:''}</div>
    <div class="group">${g.items.map(x=>`<div class="q-item"><div class="q-main"><div class="q-t">${h(x.name)} <span class="muted" style="font-weight:500">T${h(x.table)} · P${h(x.pos)}</span> <span class="badge ${x.urgency==='dislike'?'':'badge-al'}">${h(x.urgency[0].toUpperCase()+x.urgency.slice(1))}</span>${x.state==='printing'?'<span class="spin" style="width:14px;height:14px"></span>':''}</div>
      <div class="q-s"><span class="al-text">${h(x.dietary)}</span>${x.dish?' · '+h(x.dish):''}</div>${x.err?`<div class="q-err">${h(x.err)}</div>`:''}</div>
      <button class="btn btn-icon btn-sm btn-plain" data-act="pl-rm" data-id="${h(x.id)}" aria-label="Remove ${h(x.name)}${x.dish?' — '+h(x.dish):''}" ${PL.busy?'disabled':''}>${ico('xmark')}</button></div>`).join('')}</div>`).join('');
}
const plPreview=debounce(()=>{renderPlSide();},80);
function plAdd(){
  const cur=plCurrent();
  if(!cur.name){toast('Type the guest’s name',{type:'err'});$('#pl-name')?.focus();return;}
  if(!cur.table||!cur.pos){toast('Add the table and position',{type:'err'});(cur.table?$('#pl-pos'):$('#pl-table'))?.focus();return;}
  if(!cur.dietary){toast('Choose what they can’t have — or type it',{type:'err'});return;}
  const dishes=plDishList();const items=(dishes.length?dishes:['']).map(d=>({...cur,dish:d,course:d?dishCourse(d):90,id:uid()}));
  PL.queue.push(...items);savePlQueue();rememberSeat(cur.name,cur.table,cur.pos);
  PL.dishes=[];PL.dish='';
  renderPlForm();renderPlSide();
  toast(items.length>1?`Added ${items.length} labels for ${cur.name}`:`Added ${cur.name}${items[0].dish?' — '+items[0].dish:''}`);
}
async function plPrint(filter){
  if(PL.busy)return;
  const todo=sortedQueue().filter(filter||(()=>true));if(!todo.length)return;
  PL.busy=true;renderPlSide();renderFloatBar();
  const done=LS.get('dcps_plate_done2',{});
  todo.forEach(q=>{q.err=null;q.state='printing';});const qEl=$('#pl-queue');if(qEl)qEl.innerHTML=plQueueHTML();
  const {ok,bad,err:lastErr,unsure}=await printQueue(todo,q=>({...plPayload(q),job_id:'pl-'+q.id}),
    q=>{PL.queue=PL.queue.filter(x=>x.id!==q.id);recordPrint(plRecord(q));if(q.eventId){const m=(done[q.eventId]=done[q.eventId]||{});m[norm(q.name)]=(m[norm(q.name)]||0)+1;}savePlQueue();},
    (q,msg)=>{q.err=msg||null;});
  todo.forEach(q=>q.state='');
  LS.set('dcps_plate_done2',done);savePlQueue();
  PL.busy=false;renderPlSide();renderPlForm();renderFloatBar();
  if(ok)alog('Printed plate labels',plural(ok,'label'));
  if(!bad)toast(`Sent ${plural(ok,'plate label')} to the printer`);
  else if(unsure)toast(`${ok?ok+' sent. ':''}${lastErr}`,{type:'err',ms:8000});   // check the printer first: no one-tap Retry
  else toast(`${ok?ok+' sent. ':''}${plural(PL.queue.length,'label')} still waiting — ${lastErr}`,{type:'err',ms:6000,action:'Retry',onAction:()=>plPrint(filter)});
}
function plEventSheet(){
  const evs=kpEvents(3).filter(e=>e.event_date>=addDays(ymd(),-1));
  const rows=evs.map(e=>{const n=(e.guest_allergens||[]).length;return`<button class="row row-nav" data-act="pl-event-pick" data-id="${h(e.id)}"><span class="row-main"><span class="row-t">${h(e.client_name||'Event')}</span><span class="row-s">${e.job_code?`<span class="mono">${h(e.job_code)}</span> · `:''}${h(dayWords(e.event_date))}${e.covers?' · '+e.covers+' covers':''}</span></span>${n?`<span class="badge badge-al">${plural(n,'dietary guest')}</span>`:`<span class="badge">None</span>`}${PL.eventId===e.id?ico('check'):ico('chevron','chev')}</button>`;}).join('');
  openSheet({title:'Choose an event',sub:'Its dietary guests and menu come from Kitchen Prep',body:`<div class="group">${rows||`<div class="row muted">${S.kp.ok===false?'Kitchen Prep isn’t answering.':'No events coming up in Kitchen Prep.'}</div>`}</div>`,foot:PL.eventId?`<button class="btn" data-act="pl-event-clear">No event</button>`:''});
}
