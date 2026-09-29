/* ═══════════════════════════════════════════════════════════════════════
   LABEL PREVIEW — the Pi's drawing code, line for line (same fonts, sizes,
   positions and colours), then the printer's own red/black conversion
   (brother_ql, red mode, threshold 70). What you see is what prints.
   ═══════════════════════════════════════════════════════════════════════ */
/*FONTS*/
const LBL_W=696;
const LF={large:[700,36],medium:[700,28],small:[400,22],label:[700,20],notes:[400,24],tiny:[400,18],title:[700,52]};
const ASC={18:17,20:19,22:21,24:23,28:26,36:34,52:49};
const RGB=(r,g,b)=>`rgb(${r},${g},${b})`;
const RED=RGB(185,0,0),INK=RGB(20,20,20);
let _fontsReady=null;
function loadLabelFonts(){
  if(_fontsReady)return _fontsReady;
  _fontsReady=(async()=>{
    try{
      const reg=new FontFace('LabelSans',`url(data:font/woff2;base64,${FONT_REG})`,{weight:'400'});
      const bold=new FontFace('LabelSans',`url(data:font/woff2;base64,${FONT_BOLD})`,{weight:'700'});
      await Promise.all([reg.load(),bold.load()]);document.fonts.add(reg);document.fonts.add(bold);return true;
    }catch(e){console.warn('Label fonts',e);return false;}
  })();
  return _fontsReady;
}
function mkCanvas(w,h){const c=document.createElement('canvas');c.width=w;c.height=Math.max(1,h);return c;}
let _mx=null;
function mctx(){if(!_mx)_mx=mkCanvas(8,8).getContext('2d');return _mx;}
function setFont(ctx,k){const[w,s]=LF[k];ctx.font=`${w===700?'bold ':''}${s}px LabelSans,"DejaVu Sans",Verdana,sans-serif`;return s;}
function tw(text,k){const c=mctx();setFont(c,k);const m=c.measureText(String(text));const r=m.actualBoundingBoxRight,l=m.actualBoundingBoxLeft;return Math.round(r!=null&&l!=null?r+l:m.width);}
function wrapToWidth(text,k,maxW){
  const words=String(text).split(/\s+/).filter(Boolean);const lines=[];let cur='';
  for(const w of words){const t=(cur+' '+w).trim();if(tw(t,k)<=maxW)cur=t;else{if(cur)lines.push(cur);cur=w;}}
  if(cur)lines.push(cur);return lines.length?lines:[String(text)];
}
/* Python's textwrap.wrap (character widths, breaks long words, splits after hyphens). */
function pyWrap(text,width){
  text=String(text).replace(/[\t\n\x0b\x0c\r]/g,' ');
  const chunks=[];
  text.split(/(\s+)/).forEach(tok=>{
    if(!tok)return;if(/^\s+$/.test(tok)){chunks.push(tok);return;}
    let rest=tok;const re=/^([^-]*?[A-Za-z0-9]-)(?=[A-Za-z])/;let m;
    while((m=re.exec(rest))&&m[1].length<rest.length){chunks.push(m[1]);rest=rest.slice(m[1].length);}
    chunks.push(rest);
  });
  const lines=[];chunks.reverse();
  while(chunks.length){
    const cur=[];let len=0;
    if(chunks[chunks.length-1].trim()===''&&lines.length)chunks.pop();
    while(chunks.length){const l=chunks[chunks.length-1].length;if(len+l<=width){cur.push(chunks.pop());len+=l;}else break;}
    if(chunks.length&&chunks[chunks.length-1].length>width){const space=Math.max(width-len,1);const c=chunks[chunks.length-1];cur.push(c.slice(0,space));chunks[chunks.length-1]=c.slice(space);}
    if(cur.length&&cur[cur.length-1].trim()==='')cur.pop();
    if(cur.length)lines.push(cur.join(''));
  }
  return lines;
}
function box(x,x0,y0,x1,y1,col){x.fillStyle=col;x.fillRect(x0,y0,x1-x0+1,y1-y0+1);}   // PIL rectangles include both ends
function txt(x,px,py,text,k,col){const s=setFont(x,k);x.fillStyle=col;x.textBaseline='alphabetic';x.fillText(String(text),px,py+(ASC[s]||Math.round(s*.93)));}
function sv(d,k){const v=d[k];return v==null?'':String(v).trim();}
function fmtShort(v){return isYmd(v)?v.slice(8,10)+'/'+v.slice(5,7)+'/'+v.slice(2,4):(v||'');}

function drawAllergens(x,W,y,contains,may,alLines,mayLines,alH){
  box(x,0,y,W,y+6,(contains||may)?RED:RGB(60,60,60));y+=6;
  if(contains||may){
    box(x,0,y,W,y+alH,RGB(255,235,235));box(x,0,y,8,y+alH,RED);
    let ay=y+12;for(const l of alLines){txt(x,16,ay,l,'small',RED);ay+=28;}
    for(const l of mayLines){txt(x,16,ay,l,'tiny',RGB(100,20,20));ay+=24;}
  }else{
    box(x,0,y,W,y+alH,RGB(240,240,240));box(x,0,y,8,y+alH,RGB(60,60,60));
    txt(x,16,y+9,'No allergens declared','label',RGB(60,60,60));
  }
  return y+alH;
}
function drawNotes(x,W,y,lines,notesH){
  if(!lines.length)return y;
  box(x,0,y,W,y+2,RGB(60,60,60));y+=2;
  box(x,0,y,W,y+notesH,RGB(255,250,235));box(x,0,y,8,y+notesH,RGB(140,100,0));
  let ny=y+12;for(const l of lines){txt(x,16,ny,l,'notes',RGB(60,40,0));ny+=28;}
  return y+notesH;
}
function drawFooter(x,W,y,total,text){box(x,0,y,W,y+2,RGB(60,60,60));y+=2;box(x,0,y,W,total,RGB(220,220,220));txt(x,10,y+7,text,'tiny',RGB(60,60,60));}

function drawStandard(d){
  const W=LBL_W;
  const product=sv(d,'product_name'),job=sv(d,'job_code'),prepped=sv(d,'date_prepped'),useby=sv(d,'date_useby'),staff=sv(d,'staff_name'),section=sv(d,'section');
  const contains=sv(d,'contains'),may=sv(d,'may_contain'),notes=sv(d,'notes'),printedAt=sv(d,'printed_at'),note=sv(d,'source_note');
  const status=(sv(d,'status')||sv(d,'label_status')).toUpperCase();
  const statusDate=sv(d,'status_date')||prepped,weight=sv(d,'weight_display');
  const jcW=job?tw(job,'small')+20:0;
  const nameLines=wrapToWidth(product,'large',W-20-jcW);
  const alLines=contains?pyWrap(contains,40):[];
  const mayLines=may?pyWrap('May contain: '+may,46):[];
  const noteLines=notes?pyWrap(notes,46).slice(0,3):[];
  const sd=fmtShort(statusDate);
  let st='';
  if(status==='FROZEN')st=sd?'FROZEN - Do not refreeze - '+sd:'FROZEN - Do not refreeze';
  else if(status==='THAWED')st=sd?'THAWED - '+sd:'THAWED';
  const stLines=st?wrapToWidth(st,'medium',W-20):[];
  const rows=[];
  if(!status)rows.push(['PREP DATE',prepped,'small',INK]);
  rows.push(['USE BY',useby,'medium',RED]);
  rows.push(['PREP BY',staff,'small',INK]);
  if(weight)rows.push(['WEIGHT',weight,'small',INK]);
  if(section)rows.push(['SECTION',section,'small',INK]);
  const rowH=44,headerH=14+nameLines.length*44+14,stH=stLines.length?stLines.length*36+16:0,rowsH=rows.length*rowH+rows.length;
  const alH=(contains||may)?12+alLines.length*28+mayLines.length*24+12:36,notesH=noteLines.length?12+noteLines.length*28+12:0,footerH=30;
  const total=headerH+stH+rowsH+6+alH+notesH+2+footerH;
  const c=mkCanvas(W,total),x=c.getContext('2d');
  box(x,0,0,W,total,'#fff');
  box(x,0,0,W,headerH,INK);
  let ty=14;for(const l of nameLines){txt(x,10,ty,l,'large','#fff');ty+=44;}
  if(job)txt(x,W-tw(job,'small')-10,16,job,'small',RGB(200,200,200));
  let y=headerH;
  if(stLines.length){box(x,0,y,W,y+stH,'#fff');let sy=y+8;for(const l of stLines){txt(x,Math.floor((W-tw(l,'medium'))/2),sy,l,'medium',RED);sy+=36;}y+=stH;}
  for(const[l,v,k,col] of rows){box(x,0,y,W,y+1,RGB(60,60,60));y+=1;txt(x,10,y+12,l,'label',RGB(40,40,40));txt(x,200,y+8,v,k,col);y+=rowH;}
  y=drawAllergens(x,W,y,contains,may,alLines,mayLines,alH);
  y=drawNotes(x,W,y,noteLines,notesH);
  drawFooter(x,W,y,total,printedAt+'  |  Digbys CPS'+(note?'  |  '+note:''));
  return c;
}
function drawPlate(d){
  const W=LBL_W;
  const name=sv(d,'guest_name'),table=sv(d,'table'),pos=sv(d,'position'),dietary=sv(d,'dietary'),dish=sv(d,'dish'),printedAt=sv(d,'printed_at');
  const urgency=(sv(d,'urgency')||'allergy').toLowerCase();
  const dishLines=dish?pyWrap(dish,50):[];
  const dietLines=wrapToWidth(dietary,'large',W-20);
  const ucol={allergy:RED,intolerance:RED,dislike:INK}[urgency]||RED;
  const ulbl={allergy:'ALLERGY',intolerance:'INTOLERANCE',dislike:'DISLIKE'}[urgency]||'ALLERGY';
  const urgH=44,nameH=54,dietH=dietLines.length*48+16,tableH=46,ruleH=2,dishH=dishLines.length?10+dishLines.length*24+10:0,footH=26;
  const total=urgH+nameH+dietH+tableH+ruleH+dishH+footH;
  const c=mkCanvas(W,total),x=c.getContext('2d');
  box(x,0,0,W,total,'#fff');
  let y=0;
  box(x,0,y,W,y+urgH,ucol);txt(x,Math.floor((W-tw(ulbl,'medium'))/2),y+8,ulbl,'medium','#fff');y+=urgH;
  box(x,0,y,W,y+nameH,'#fff');txt(x,14,y+10,name,'large',INK);y+=nameH;
  box(x,0,y,W,y+dietH,'#fff');let dy=y+8;for(const l of dietLines){txt(x,14,dy,l,'large',RED);dy+=48;}y+=dietH;
  box(x,0,y,W,y+1,RGB(60,60,60));y+=1;
  box(x,0,y,W,y+tableH,'#fff');txt(x,14,y+10,'T'+table+'   P'+pos,'large',INK);y+=tableH;
  if(dishLines.length){box(x,0,y,W,y+ruleH,RGB(180,180,180));y+=ruleH;box(x,0,y,W,y+dishH,RGB(235,235,235));let d2=y+10;for(const l of dishLines){txt(x,14,d2,l,'notes',INK);d2+=24;}y+=dishH;}
  box(x,0,y,W,y+ruleH,RGB(180,180,180));y+=ruleH;
  box(x,0,y,W,total,RGB(230,230,230));
  txt(x,14,y+5,printedAt+"  |  Digby's CPS  |  Plate Label",'tiny',RGB(100,100,100));
  return c;
}
function drawStorage(d){
  const W=LBL_W;
  const product=sv(d,'product_name'),contains=sv(d,'contains'),may=sv(d,'may_contain'),dateIn=sv(d,'date_prepped'),notes=sv(d,'notes'),printedAt=sv(d,'printed_at');
  const alLines=contains?pyWrap(contains,40):[],mayLines=may?pyWrap('May contain: '+may,46):[],noteLines=notes?pyWrap(notes,46).slice(0,3):[];
  const nameLines=wrapToWidth(product,'title',W-40);
  const headerH=24+nameLines.length*64+24,dateH=dateIn?46:0;
  const alH=(contains||may)?12+alLines.length*28+mayLines.length*24+12:36,notesH=noteLines.length?12+noteLines.length*28+12:0,footerH=30;
  const total=headerH+(dateIn?1+dateH:0)+6+alH+notesH+2+footerH;
  const c=mkCanvas(W,total),x=c.getContext('2d');
  box(x,0,0,W,total,'#fff');
  box(x,0,0,W,headerH,INK);
  let ty=20;for(const l of nameLines){txt(x,Math.floor((W-tw(l,'title'))/2),ty,l,'title','#fff');ty+=64;}
  let y=headerH;
  if(dateIn){box(x,0,y,W,y+1,RGB(60,60,60));y+=1;txt(x,10,y+12,'DATE IN','label',RGB(40,40,40));txt(x,200,y+8,dateIn,'medium',INK);y+=dateH;}
  y=drawAllergens(x,W,y,contains,may,alLines,mayLines,alH);
  y=drawNotes(x,W,y,noteLines,notesH);
  drawFooter(x,W,y,total,printedAt+'  |  Digbys CPS  |  Storage');
  return c;
}
/* brother_ql red mode: black where V<80; red where hue is red, S>100, V>80;
   a dot prints where the kept pixel's luminance is 179 or darker. */
function thermal(c){
  const x=c.getContext('2d',{willReadFrequently:true});const img=x.getImageData(0,0,c.width,c.height);const p=img.data;
  for(let i=0;i<p.length;i+=4){
    const r=p[i],g=p[i+1],b=p[i+2];const mx=r>g?(r>b?r:b):(g>b?g:b),mn=r<g?(r<b?r:b):(g<b?g:b);
    const L=(r*19595+g*38470+b*7471+0x8000)>>16;let o=0;
    if(mx<80){if(L<=179)o=1;}
    else if(mx>80&&mx!==mn){
      const cr=mx-mn,s=Math.floor(cr/mx*255);
      if(s>100){const rc=(mx-r)/cr,gc=(mx-g)/cr,bc=(mx-b)/cr;let hh=r===mx?bc-gc:g===mx?2+rc-bc:4+gc-rc;hh=((hh/6+1)%1);const H=Math.floor(hh*255);if((H<40||H>210)&&L<=179)o=2;}
    }
    if(o===1){p[i]=24;p[i+1]=22;p[i+2]=21;}else if(o===2){p[i]=213;p[i+1]=25;p[i+2]=32;}else{p[i]=p[i+1]=p[i+2]=255;}
    p[i+3]=255;
  }
  x.putImageData(img,0,0);return c;
}
function drawLabel(d){return d.storage?drawStorage(d):d.plate?drawPlate(d):drawStandard(d);}
async function paintLabel(canvas,data){
  if(!canvas)return;await loadLabelFonts();
  const src=thermal(drawLabel(data));
  // Shown smaller than 696 px: scale down with proper filtering so thin strokes stay visible.
  const want=Math.round((canvas.clientWidth||src.width)*(window.devicePixelRatio||1));
  const w=Math.min(src.width,Math.max(120,want)),hgt=Math.round(src.height*w/src.width);
  canvas.width=w;canvas.height=hgt;
  const x=canvas.getContext('2d');x.imageSmoothingEnabled=true;x.imageSmoothingQuality='high';
  if(w===src.width)x.drawImage(src,0,0);else{let cur=src;while(cur.width/2>=w){const c2=mkCanvas(Math.round(cur.width/2),Math.round(cur.height/2));const x2=c2.getContext('2d');x2.imageSmoothingQuality='high';x2.drawImage(cur,0,0,c2.width,c2.height);cur=c2;}x.drawImage(cur,0,0,w,hgt);}
  canvas.setAttribute('aria-label','Label preview: '+(data.product_name||data.guest_name||''));
}
function previewHTML(id,count){return`<div class="lp-paper${count>1?' stack':''}"><canvas id="${id}" role="img"></canvas></div>${count>1?`<div class="lp-n">×${count} labels</div>`:''}`;}
