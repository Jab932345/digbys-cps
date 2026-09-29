/* ═══════════════════════════════════════════════════════════════════════
   ALLERGEN EDITOR — choose Contains or May contain, then tap allergens.
   One tap never downgrades Contains to May contain by accident.
   Used for one-offs, per-label changes, custom products and containers.
   ═══════════════════════════════════════════════════════════════════════ */
const AL_ED={};   // key → {get:()=>{c,m,none,mode}, set:state=>{}, after:()=>{}}
function alEditorHTML(key){
  const ed=AL_ED[key];if(!ed)return'';
  const st=ed.get();const mode=st.mode||'c';
  const extra=[...st.c,...st.m].filter(a=>!AL.includes(a));
  return`<div class="aled" id="aled-${key}">
    <div class="seg aled-mode">${[['c','Contains'],['m','May contain']].map(([v,l])=>`<button type="button" class="${mode===v?'on':''}" data-act="al-mode" data-ed="${key}" data-v="${v}">${l}</button>`).join('')}</div>
    <div class="chips aled-chips">${[...AL,...extra].map(a=>{const s=st.c.includes(a)?'c':st.m.includes(a)?'m':'';
      return`<button type="button" class="alc ${s}${st.none?' off':''}" data-act="al-tap" data-ed="${key}" data-v="${h(a)}" aria-pressed="${!!s}" aria-label="${h(a)}${s==='c'?', contains':s==='m'?', may contain':''}">${h(a)}${s==='m'?' <small>may</small>':''}</button>`;}).join('')}</div>
    <div class="aled-foot"><button type="button" class="btn btn-sm ${st.none?'btn-primary':''}" data-act="al-none" data-ed="${key}" aria-pressed="${!!st.none}">${ico(st.none?'checkCircle':'circle')}No allergens</button><span class="aled-sum">${h(alPhrase(st.c,st.m,st.none))}</span></div>
  </div>`;
}
function alPhrase(c,m,none){if(none)return'No allergens';const a=[];if(c.length)a.push('Contains '+c.join(', '));if(m.length)a.push('may contain '+m.join(', '));return a.join(' · ')||'Nothing chosen yet';}
function alRerender(key){const el=$('#aled-'+key);if(!el)return;el.outerHTML=alEditorHTML(key);syncSegs($('#aled-'+key)||document);}
function alTap(key,a){
  const ed=AL_ED[key];const st=ed.get();st.none=false;
  if((st.mode||'c')==='m'){
    if(st.c.includes(a)){toast(`${a} is marked Contains — switch to Contains and tap it to take it off first`,{type:'err',ms:4000});const b=$(`#aled-${key} .alc[data-v="${CSS.escape(a)}"]`);if(b){b.classList.remove('shake');void b.offsetWidth;b.classList.add('shake');}return;}
    if(st.m.includes(a))st.m=st.m.filter(x=>x!==a);else st.m=sortAl([...st.m,a]);
  }
  else{if(st.c.includes(a))st.c=st.c.filter(x=>x!==a);else{st.c=sortAl([...st.c,a]);st.m=st.m.filter(x=>x!==a);}}
  ed.set(st);alRerender(key);ed.after&&ed.after();
}
function alNone(key){const ed=AL_ED[key];const st=ed.get();st.none=!st.none;if(st.none){st.c=[];st.m=[];}ed.set(st);alRerender(key);ed.after&&ed.after();}
function alMode(key,v){const ed=AL_ED[key];const st=ed.get();st.mode=v;ed.set(st);$$(`#aled-${key} .aled-mode>button`).forEach(b=>b.classList.toggle('on',b.dataset.v===v));}
