/* ═══════════════════════════════════════════════════════════════════════
   PRINTER — the Pi's print server, reached through ngrok. Its address lives
   in Kitchen Prep (app_settings.butchery_printer_url), so both apps always
   print to the same place.
   ═══════════════════════════════════════════════════════════════════════ */
LS.del('dcps_printer');   // CPS 3.0 kept a per-device address; there's one shared address now
function printerBase(){
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
  if(!d){const err=new Error(r.status===502||/ERR_NGROK_8012/.test(text)?'The Pi is on, but its print server isn’t running':/ERR_NGROK_3200/.test(text)?'The Pi is offline':'The Pi sent something unexpected (HTTP '+r.status+')');err.unreachable=true;throw err;}
  if(!r.ok&&d.success!==true){const err=new Error(d.error||('HTTP '+r.status));err.data=d;err.status=r.status;throw err;}
  return d;
}
/* A big run takes the Pi a while to prepare, so the wait grows with the count.
   "Didn't answer in time" may still have printed — it's never resent by itself. */
async function sendToPrinter(payload){
  const n=Math.max(1,Math.min(50,parseInt(payload.quantity)||1));
  try{const d=await piCall('POST','/print',payload,20000+n*1200);if(d.success)return{ok:true,ip:d.printer_ip};return{ok:false,error:d.error||'The printer said no'};}
  catch(e){return{ok:false,error:e.message,unreachable:!!e.unreachable,timeout:!!e.timeout};}
  finally{setTimeout(checkPrinter,1500);}
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
    case'ready':return['ok','Printer ready',p.info&&p.info.printer_ip?'Brother QL · '+p.info.printer_ip:'Brother QL-820'];
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
let _printerTimer=null;
function startPrinterPolling(){
  clearTimeout(_printerTimer);
  const tick=async()=>{if(!document.hidden&&S.user)await checkPrinter();_printerTimer=setTimeout(tick,S.printer.state==='ready'?30000:8000);};
  tick();
}
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&S.user){checkPrinter();loadInbox();if(Date.now()-S.kp.at>60000)loadKP();if(Date.now()-S.cps.at>60000)loadCPS();}});

/* Latest print server published with this app (pi/VERSION next to index.html). */
let _latestPi=null;
async function latestPiVersion(){
  if(_latestPi)return _latestPi;
  try{const r=await fetch('pi/VERSION?t='+Date.now(),{cache:'no-store',signal:timeoutSignal(6000)});if(r.ok){const t=(await r.text()).trim();if(/^\d+\.\d+/.test(t))_latestPi=t;}}catch(e){}
  return _latestPi;
}
function newerVersion(a,b){const pa=String(a||'0').split('.').map(Number),pb=String(b||'0').split('.').map(Number);for(let i=0;i<3;i++){if((pa[i]||0)>(pb[i]||0))return true;if((pa[i]||0)<(pb[i]||0))return false;}return false;}
const PI_UPDATE_CMD='curl -fsSL https://digbys-cps.vercel.app/pi/update.sh | bash';
