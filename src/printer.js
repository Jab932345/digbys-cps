/* ═══════════════════════════════════════════════════════════════════════
   PRINTER — the Pi's print server. Two routes:
   · on the kitchen Wi-Fi, CPS opened from the Pi itself (http://<pi>:3000)
     talks to it directly — fast, and no internet needed;
   · anywhere else, through the ngrok tunnel. Its address lives in Kitchen
     Prep (app_settings.butchery_printer_url), so both apps print to one place.
   The tunnel's free plan allows 20,000 requests a month, so over it the
   printer is checked sparingly and the print replies themselves say how it is.
   ═══════════════════════════════════════════════════════════════════════ */
LS.del('dcps_printer');   // CPS 3.0 kept a per-device address; there's one shared address now
function printerBase(){
  if(ON_PI)return location.origin;
  let u=String(kpSetting('butchery_printer_url','')||DEFAULT_PRINTER).trim();
  if(!/^https?:\/\//i.test(u))u='https://'+u;
  return u.replace(/\/(print|status|butchery\/label)?\/*$/,'');
}
async function piCall(method,path,body,ms){
  let r;
  try{r=await fetch(printerBase()+path,{method,headers:{'Content-Type':'application/json','ngrok-skip-browser-warning':'true'},body:body?JSON.stringify(body):undefined,signal:timeoutSignal(ms||20000),cache:'no-store'});}
  catch(e){
    const timeout=!!(e&&(e.name==='TimeoutError'||e.name==='AbortError'));
    const err=new Error(timeout?'The printer didn’t answer in time':'Can’t reach the Pi');err.unreachable=!timeout;err.timeout=timeout;throw err;
  }
  const text=await r.text();let d=null;try{d=JSON.parse(text);}catch(e){}
  if(!d){const limit=r.status===429||/ERR_NGROK_7\d\d|limit/i.test(text)&&/ngrok/i.test(text);
    const err=new Error(limit?'The internet route to the Pi has hit its monthly limit — open CPS on the kitchen Wi-Fi from the Pi instead (Manage → Printer)':r.status===502||/ERR_NGROK_8012/.test(text)?'The Pi is on, but its print server isn’t running':/ERR_NGROK_3200/.test(text)?'The Pi is offline':'The Pi sent something unexpected (HTTP '+r.status+')');err.unreachable=true;err.limit=limit;throw err;}
  if(!r.ok&&d.success!==true){const err=new Error(d.error||('HTTP '+r.status));err.data=d;err.status=r.status;throw err;}
  return d;
}
/* "Busy": another run had the printer all the while the Pi waited (25 s).
   Nothing printed, so it's asked again after a pause — for up to 1½ minutes.
   The wait for an answer covers the Pi's worst case: 25 s for the printer to
   be free, then about 30 s to find it if it's gone, then the labels. */
async function piPrint(body,ms){
  const until=Date.now()+90000;
  for(;;){
    try{return await piCall('POST','/print',body,ms);}
    catch(e){if(!(e.data&&e.data.busy)||Date.now()>until)throw e;await new Promise(r=>setTimeout(r,2000));}
  }
}
/* A big run takes the Pi a while to prepare, so the wait grows with the count.
   "Didn't answer in time" may still have printed — it's never resent by itself. */
async function sendToPrinter(payload){
  const n=Math.max(1,Math.min(50,parseInt(payload.quantity)||1));
  let res;
  try{const d=await piPrint(payload,70000+n*4000);res=d.success?{ok:true,ip:d.printer_ip}:{ok:false,error:d.error||'The printer said no'};}
  catch(e){const d=e.data||{};const maybe=!!(d.uncertain||d.printed);res={ok:false,error:e.message,unreachable:!!e.unreachable,piBusy:!!d.busy,timeout:!!(e.timeout||maybe),piSaid:maybe};}
  notePrintResult(res);return res;
}
/* A queue in a few requests (print server 2.2+): one trip to the Pi and one
   connection to the printer for up to 6 labels — short enough that a label
   from another iPad or Kitchen Prep (which waits 15 s at most) gets its turn
   between them. Each job carries its job_id; results say which printed. */
const BATCH_MAX=6;
function piCanBatch(){const i=S.printer.info;return!!(i&&(i.batch||(i.version&&!newerVersion('2.2.0',i.version))));}
async function sendBatch(jobs){
  const n=jobs.reduce((a,j)=>a+Math.max(1,Math.min(50,parseInt(j.quantity)||1)),0);
  let res;
  try{const d=await piPrint({jobs},70000+n*4000);res={ok:!!d.success,results:d.results||[],error:d.error};}
  catch(e){const d=e.data||{};res={ok:false,error:e.message,results:d.results||[],unreachable:!!e.unreachable,piBusy:!!d.busy,timeout:!!e.timeout,uncertain:!!d.uncertain};}
  notePrintResult(res);return res;
}
/* Split a queue into requests of at most BATCH_MAX labels. */
function chunkJobs(jobs){const out=[];let cur=[],n=0;jobs.forEach(j=>{const q=Math.max(1,Math.min(50,parseInt(j.quantity)||1));if(cur.length&&n+q>BATCH_MAX){out.push(cur);cur=[];n=0;}cur.push(j);n+=q;});if(cur.length)out.push(cur);return out;}
/* A queue (plates, containers, Kitchen Prep requests): a request per 6
   labels when the Pi can, else one by one. Stops at the first failure; what
   didn't print stays queued, and its job_id makes the retry safe. A job that
   may have printed says so, and `unsure` tells the caller to say check first. */
async function printQueue(items,toJob,onDone,onFail){
  let ok=0,bad=0,err='',unsure=false;
  const pairs=items.map(it=>({it,job:toJob(it)}));
  const failMsg=res=>res.timeout&&!res.piSaid?'Didn’t answer in time — it may have printed':(res.error||'Not printed');
  if(piCanBatch()&&pairs.length>1){
    for(const chunk of chunkJobs(pairs.map(p=>p.job))){
      const res=await sendBatch(chunk);
      const byId=new Map((res.results||[]).map(r=>[r.job_id,r]));let first=true;
      for(const job of chunk){
        const it=pairs.find(p=>p.job===job).it;const r=res.timeout?null:byId.get(job.job_id);
        if(r&&r.success){ok++;onDone(it,job);continue;}
        bad++;
        // a job some of whose labels printed, or may have: said on that job itself
        if(res.timeout||(r&&r.uncertain)){unsure=true;const m=r&&r.error||failMsg(res);if(first)err=m;onFail(it,m);}
        else{const m=(r&&r.error)||failMsg(res);if(first)err=m;onFail(it,first?m:'');}
        first=false;
      }
      if(!res.ok)return{ok,bad,unsure,err:res.timeout?failMsg(res):(err||res.error)};
    }
    return{ok,bad,err,unsure};
  }
  for(const {it,job} of pairs){
    let res=await sendToPrinter(job);
    if(!res.ok&&!res.timeout&&!res.piBusy){await new Promise(r=>setTimeout(r,2500));res=await sendToPrinter(job);}
    if(res.ok){ok++;onDone(it,job);}
    else{bad++;err=failMsg(res);unsure=!!res.timeout;onFail(it,err);break;}
  }
  return{ok,bad,err,unsure};
}
/* A print's reply is the freshest news about the printer — no extra check needed. */
function notePrintResult(res){
  const was=S.printer.state;
  if(res.ok)S.printer={...S.printer,state:'ready',at:Date.now(),error:null};
  else if(res.unreachable)S.printer={...S.printer,state:'offline',at:Date.now(),error:res.error};
  else if(!res.timeout&&/not found/i.test(res.error||''))S.printer={...S.printer,state:'noprinter',at:Date.now(),error:res.error};
  else return;
  if(S.printer.state!=='ready'&&was==='ready'){_pollMiss=0;startPrinterPolling(15000);}   // look again soon, then back off
  renderPrinterPill();onDataChanged('printer');
  if(S.printer.state==='ready'&&was!=='ready'&&was!=='unknown'&&typeof onPrinterBack==='function')setTimeout(onPrinterBack,0);
}
async function checkPrinter(){
  if(checkPrinter.busy)return S.printer;checkPrinter.busy=true;
  const was=S.printer.state;
  try{
    const d=await piCall('GET','/status',null,7000);
    const found=('printer' in d)?d.printer===true:!!(d.success||d.ok||d.status==='ok');
    S.printer={state:found?'ready':(d.searching?'searching':'noprinter'),info:d,at:Date.now(),error:null};
  }catch(e){S.printer={state:'offline',info:null,at:Date.now(),error:e.message};}
  finally{checkPrinter.busy=false;}
  renderPrinterPill();onDataChanged('printer');
  if(S.printer.state==='ready'){if(S.pendingRecords.length)flushRecords();if(was!=='ready'&&was!=='unknown'&&typeof onPrinterBack==='function')onPrinterBack();}
  return S.printer;
}
function printerText(){
  const p=S.printer;
  switch(p.state){
    case'ready':return['ok','Printer ready',p.info&&p.info.usb?'Brother QL · USB'+(p.info.wifi?' + Wi-Fi':''):p.info&&p.info.printer_ip?'Brother QL · Wi-Fi '+p.info.printer_ip:'Brother QL-820'];
    case'searching':return['warn pulse','Finding the printer…','The Pi is looking for it'];
    case'noprinter':return['bad','Printer not found','Is it on, with labels in?'];
    case'offline':return['bad','Printer offline',p.error||'Can’t reach the Pi'];
    default:return['','Checking printer…',''];
  }
}
function renderPrinterPill(){
  const [cls,t,sub]=printerText();
  const el=$('#sb-printer');if(el)el.innerHTML=`<span class="dot ${cls}"></span><span class="grow"><span>${h(t)}</span>${sub?`<span class="sub">${h(sub)}</span>`:''}</span>`;
  $$('.pr-pill').forEach(p=>{p.innerHTML=`<span class="dot ${cls}"></span><span>${h(t)}</span>`;p.classList.toggle('bad',cls.startsWith('bad'));});
}
function printerPillHTML(extra=''){const [cls,t]=printerText();return`<button class="btn btn-sm btn-plain pr-pill ${extra}${cls.startsWith('bad')?' bad':''}" data-act="go" data-to="manage/printer"><span class="dot ${cls}"></span><span>${h(t)}</span></button>`;}
/* How often to ask the Pi how it is. On the kitchen Wi-Fi it costs nothing;
   through the tunnel: every 5 minutes when it's fine, backing off from 15 s
   to 5 minutes when it isn't (a minute at most while labels wait to resend). */
let _printerTimer=null,_pollMiss=0,_pollGen=0;
function nextPollMs(){
  if(ON_PI)return S.printer.state==='ready'?30000:8000;
  if(S.printer.state==='ready')return 300000;
  const ms=[15000,30000,60000,120000,300000][Math.min(_pollMiss,4)];
  return S.outbox.some(o=>(o.unreachable||o.noPrinter)&&!o.maybePrinted&&!o.stale&&Date.now()-o.at<30*60e3)?Math.min(ms,60000):ms;
}
function startPrinterPolling(firstIn){
  clearTimeout(_printerTimer);const gen=++_pollGen;
  const tick=async()=>{
    if(gen!==_pollGen)return;
    if(!document.hidden&&S.user){await checkPrinter();if(gen!==_pollGen)return;_pollMiss=S.printer.state==='ready'?0:_pollMiss+1;}
    _printerTimer=setTimeout(tick,nextPollMs());
  };
  if(firstIn)_printerTimer=setTimeout(tick,firstIn);else tick();
}
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&S.user){if(ON_PI||Date.now()-S.printer.at>60000)checkPrinter();loadInbox();if(Date.now()-S.kp.at>60000)refreshKP();if(Date.now()-S.cps.at>60000)loadCPS();}});

/* Latest print server published with this app (pi/VERSION next to index.html). */
let _latestPi=null;
async function latestPiVersion(){
  if(_latestPi)return _latestPi;
  try{const r=await fetch('pi/VERSION?t='+Date.now(),{cache:'no-store',signal:timeoutSignal(6000)});if(r.ok){const t=(await r.text()).trim();if(/^\d+\.\d+/.test(t))_latestPi=t;}}catch(e){}
  return _latestPi;
}
function newerVersion(a,b){const pa=String(a||'0').split('.').map(Number),pb=String(b||'0').split('.').map(Number);for(let i=0;i<3;i++){if((pa[i]||0)>(pb[i]||0))return true;if((pa[i]||0)<(pb[i]||0))return false;}return false;}
const PI_UPDATE_CMD='curl -fsSL https://digbys-cps.vercel.app/pi/update.sh | bash';
