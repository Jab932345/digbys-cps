/* ═══════════════════════════════════════════════════════════════════════
   SIGN IN — tap your name, type your PIN. Stays signed in on this device
   for 12 hours; Switch user is one tap in the sidebar.
   ═══════════════════════════════════════════════════════════════════════ */
const SESSION_HRS=12;
let _pinFor=null,_pinBuf='';
function staffColour(s,i){return s&&s.color||COLS[(i<0?0:i)%COLS.length];}
function avatarHTML(s,cls=''){const i=S.staff.findIndex(x=>String(x.id)===String(s&&s.id));const col=/^#[0-9a-f]{3,8}$/i.test(String(staffColour(s,i)))?staffColour(s,i):COLS[0];return`<span class="av ${cls}" style="--av:${col}" aria-hidden="true">${h(s&&s.initials||initials(s&&s.name))}</span>`;}
function renderLogin(){
  const card=$('#login-card');if(!card)return;
  const mark=`<div class="wordmark"><span class="wm">DIGBY'S</span><span class="wm-sub">CPS · Labels</span></div>`;
  if(_pinFor){
    const s=_pinFor;
    card.innerHTML=`${mark}<div class="pin">${avatarHTML(s)}<div class="pin-name">${h(s.name)}</div><div class="pin-hint" id="pin-hint">Enter your PIN</div>
      <div class="pin-dots" id="pin-dots">${[0,1,2,3].map(i=>`<span class="pin-dot${i<_pinBuf.length?' on':''}"></span>`).join('')}</div>
      <div class="keypad">${[1,2,3,4,5,6,7,8,9].map(n=>`<button class="key" data-act="pin-key" data-v="${n}">${n}</button>`).join('')}
        <button class="key fn" data-act="pin-cancel">Not me</button><button class="key" data-act="pin-key" data-v="0">0</button><button class="key fn" data-act="pin-del" aria-label="Delete">${ico('del')}</button></div></div>
      <div class="login-foot">Digby's CPS ${APP_VERSION}</div>`;
    return;
  }
  const list=S.staff;
  let inner;
  if(!list.length&&S.staffLoaded){
    card.innerHTML=`${mark}<div class="login-t">Set up CPS</div>
      <div class="first"><div class="empty-s" style="text-align:center;margin:-8px auto 16px">Nobody’s been added yet. Add yourself — you’ll be the manager and can add everyone else from Manage → Staff.</div>
      <div class="fld"><label class="fld-label" for="fr-name">Your name</label><input class="inp inp-lg" id="fr-name" autocomplete="name" placeholder="e.g. James Brierley"></div>
      <div class="fld"><label class="fld-label" for="fr-pin">A 4-number PIN</label><input class="inp inp-lg inp-num" id="fr-pin" inputmode="numeric" maxlength="4" autocomplete="off" placeholder="••••"></div>
      <button class="btn btn-primary btn-lg btn-block" data-act="first-run">Start</button></div>
      <div class="login-foot">Digby's CPS ${APP_VERSION}</div>`;
    return;
  }
  if(list.length)inner=`<div class="staff-grid">${list.map(s=>`<button class="staff-btn" data-act="pin-user" data-id="${h(s.id)}">${avatarHTML(s)}<span class="nm">${h(firstName(s.name))}</span></button>`).join('')}</div>`;
  else if(S.loginError)inner=`<div class="empty">${ico('warning')}<div class="empty-t">Can’t load the team</div><div class="empty-s">${h(S.loginError)}. Check the kitchen Wi-Fi.</div><button class="btn" data-act="login-retry">${ico('refresh')}Try again</button></div>`;
  else inner=`<div class="empty"><span class="spin"></span></div>`;
  card.innerHTML=`${mark}<div class="login-t">Who’s printing?</div>${inner}<div class="login-foot">Digby's CPS ${APP_VERSION}</div>`;
}
function pinKey(v){if(!_pinFor||_pinBuf.length>=4)return;_pinBuf+=v;updatePinDots();if(_pinBuf.length===4)setTimeout(tryPin,110);}
function pinDel(){_pinBuf=_pinBuf.slice(0,-1);updatePinDots();}
function updatePinDots(){$$('#pin-dots .pin-dot').forEach((d,i)=>d.classList.toggle('on',i<_pinBuf.length));const hint=$('#pin-hint');if(hint&&_pinBuf.length){hint.textContent='Enter your PIN';hint.classList.remove('err');}}
function tryPin(){
  const s=_pinFor;if(!s||_pinBuf.length<4)return;
  if(String(s.pin??'').trim()===_pinBuf){signIn(s);return;}
  const dots=$('#pin-dots'),hint=$('#pin-hint');
  dots.classList.add('bad','shake');hint.textContent='Wrong PIN — try again';hint.classList.add('err');
  if(navigator.vibrate)try{navigator.vibrate(60);}catch(e){}
  setTimeout(()=>{_pinBuf='';dots.classList.remove('bad','shake');$$('#pin-dots .pin-dot').forEach(d=>d.classList.remove('on'));},460);
}
function signIn(s){
  S.user={id:s.id,name:s.name,color:s.color,initials:s.initials};
  LS.set('dcps_session',{id:s.id,name:s.name,exp:Date.now()+SESSION_HRS*3600e3});
  _pinFor=null;_pinBuf='';alog('Signed in','');enterApp();
}
function signOut(){hideToast();LS.del('dcps_session');LS.del('dcps_job');LS.del('dcps_maker');S.user=null;_pinFor=null;_pinBuf='';W=null;if(Sheet.open)closeSheet();showLogin();}
function showLogin(){$('#app').hidden=true;$('#login').hidden=false;renderLogin();refreshStaffForLogin();}
async function refreshStaffForLogin(){try{await loadStaff();S.loginError=null;}catch(e){S.loginError=e.message;}if(!S.user&&!_pinFor)renderLogin();}
function restoreSession(){
  const ss=LS.get('dcps_session',null);if(!ss||!(ss.exp>Date.now()))return false;
  const s=S.staff.find(x=>String(x.id)===String(ss.id));
  if(!s&&!ss.name)return false;
  S.user=s?{id:s.id,name:s.name,color:s.color,initials:s.initials}:{id:ss.id,name:ss.name};return true;
}
function loginKey(e){
  if(!_pinFor)return;
  if(/^[0-9]$/.test(e.key)){e.preventDefault();pinKey(e.key);}
  else if(e.key==='Backspace'){e.preventDefault();pinDel();}
  else if(e.key==='Escape'){_pinFor=null;_pinBuf='';renderLogin();}
}

async function firstRun(){
  const name=titleCase(($('#fr-name')||{}).value||''),pin=String(($('#fr-pin')||{}).value||'').trim();
  if(!name){toast('Type your name',{type:'err'});$('#fr-name')?.focus();return;}
  if(!/^\d{4}$/.test(pin)){toast('The PIN is 4 numbers',{type:'err'});$('#fr-pin')?.focus();return;}
  try{
    await rest(CPS,'POST','staff',{name,pin,initials:initials(name),color:COLS[0]},{prefer:'return=minimal'});
    await loadStaff();const s=S.staff.find(x=>norm(x.name)===norm(name));if(s)signIn(s);
  }catch(e){toast('Couldn’t add you — '+e.message,{type:'err'});}
}
/* Signed in for 12 hours on a device, even if the app stays open. */
setInterval(()=>{if(!S.user)return;const ss=LS.get('dcps_session',null);if(!ss||!(ss.exp>Date.now())){alog('Signed out after 12 hours','');signOut();toast('Signed out after 12 hours — sign in again');}},60000);
