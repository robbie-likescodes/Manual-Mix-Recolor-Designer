/* ==========================================================
   Cup Mapper — app.js (full updated)
   Three-file setup: index.html + styles.css + this file
   ========================================================== */

/* -------------------- DOM -------------------- */
const $ = (id) => document.getElementById(id);
const els = {
  btnOpenHelp: $('btnOpenHelp'),
  btnOpenAbout: $('btnOpenAbout'),
  btnCloseHelp: $('btnCloseHelp'),
  btnCloseAbout: $('btnCloseAbout'),
  dlgHelp: $('dlgHelp'),
  dlgAbout: $('dlgAbout'),

  fileInput: $('fileInput'),
  maxW: $('maxW'),
  btnClear: $('btnClear'),
  btnLoadSample: $('btnLoadSample'),
  zoom: $('zoom'),
  zoomLabel: $('zoomLabel'),
  btnZoomFit: $('btnZoomFit'),
  btnZoom100: $('btnZoom100'),
  srcCanvas: $('srcCanvas'),
  outCanvas: $('outCanvas'),
  srcScroll: $('srcScroll'),
  outScroll: $('outScroll'),

  clusters: $('clusters'),
  btnExtract: $('btnExtract'),
  btnEyedrop: $('btnEyedrop'),
  origPalette: $('origPalette'),

  btnRefreshRestricted: $('btnRefreshRestricted'),
  allowWhite: $('allowWhite'),
  btnAddRestricted: $('btnAddRestricted'),
  restrictedPalette: $('restrictedPalette'),
  btnSaveKit: $('btnSaveKit'),
  kitSelect: $('kitSelect'),
  btnLoadKit: $('btnLoadKit'),
  btnDeleteKit: $('btnDeleteKit'),

  replaceSrc: $('replaceSrc'),
  blockSize: $('blockSize'),
  mixInks: $('mixInks'),
  btnAddMixInk: $('btnAddMixInk'),
  btnClearMix: $('btnClearMix'),
  mixTotal: $('mixTotal'),
  btnPreviewMix: $('btnPreviewMix'),
  mixPreview: $('mixPreview'),
  tplMixRow: $('tplMixRow'),
  mixPattern: $('mixPattern'),

  wL: $('wL'),
  wC: $('wC'),
  dither: $('dither'),
  sharpen: $('sharpen'),
  previewRes: $('previewRes'),
  btnMap: $('btnMap'),
  mapProgress: $('mapProgress'),
  mapProgressLabel: $('mapProgressLabel'),

  exportScale: $('exportScale'),
  exportTransparent: $('exportTransparent'),
  btnExportPNG: $('btnExportPNG'),
  btnExportSVG: $('btnExportSVG'),
  downloadLink: $('downloadLink'),

  btnSaveProject: $('btnSaveProject'),
  btnLoadProject: $('btnLoadProject'),
  btnDeleteProject: $('btnDeleteProject'),
  projectSelect: $('projectSelect'),

  statusText: $('statusText'),
  toastHost: $('toastHost'),
};

const srcCtx = els.srcCanvas.getContext('2d', { willReadFrequently: true });
const outCtx = els.outCanvas.getContext('2d', { willReadFrequently: true });

/* -------------------- App State -------------------- */
const KITS_KEY = 'cupmapper_kits_v1';
const PROJ_KEY = 'cupmapper_projects_v1';

let state = {
  srcW: 0, srcH: 0, zoom: 1,
  origPalette: [],
  restricted: [],
  allowWhite: false,
  mixRule: { srcHex: null, inks: [], block: 6 },
  mappedImageData: null,
  eyedropActive: false,
};

let lastMapSettings = {
  previewScale: 1,
  paramsHash: '',
  isFullRes: false,
};

/* -------------------- Utilities -------------------- */
function toast(msg, type = 'ok') {
  const t = document.createElement('div');
  t.className = `toast ${type === 'danger' ? 'toast--danger' : 'toast--ok'}`;
  t.textContent = msg;
  els.toastHost.appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 300); }, 1800);
}
function status(msg) { els.statusText.textContent = msg; }
function clamp(v, lo = 0, hi = 255) { return v < lo ? lo : v > hi ? hi : v; }
function rgbToHex(r,g,b){const h=(x)=>x.toString(16).padStart(2,'0').toUpperCase();return `#${h(r)}${h(g)}${h(b)}`;}
function hexToRgb(hex){const m=/^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex||'');return m?{r:parseInt(m[1],16),g:parseInt(m[2],16),b:parseInt(m[3],16)}:{r:0,g:0,b:0};}
function rgb2lab(r,g,b){r/=255;g/=255;b/=255;const inv=u=>(u<=0.04045?u/12.92:Math.pow((u+0.055)/1.055,2.4));r=inv(r);g=inv(g);b=inv(b);let x=r*0.4124+g*0.3576+b*0.1805;let y=r*0.2126+g*0.7152+b*0.0722;let z=r*0.0193+g*0.1192+b*0.9505;const xr=x/0.95047,yr=y/1.0,zr=z/1.08883;const f=t=>(t>0.008856?Math.cbrt(t):(7.787*t+16/116));const fx=f(xr),fy=f(yr),fz=f(zr);return{L:116*fy-16,a:500*(fx-fy),b:200*(fy-fz)};}
function deltaE2(l1,l2,wL=1,wC=1){const dL=(l1.L-l2.L)*wL;const da=(l1.a-l2.a)*wC;const db=(l1.b-l2.b)*wC;return dL*dL+da*da+db*db;}

/* -------------------- Image Load -------------------- */
els.fileInput.addEventListener('change', onFile);
els.btnClear.addEventListener('click', clearAll);
els.btnLoadSample.addEventListener('click', loadSample);

function onFile(e){
  const f=e.target.files?.[0]; if(!f) return;
  const fr=new FileReader();
  fr.onload=()=>{const img=new Image(); img.onload=()=>{drawToSrc(img); autoExtract();}; img.src=fr.result;};
  fr.readAsDataURL(f);
}
function drawToSrc(img){
  const maxW=Math.max(300,Math.min(6000,+els.maxW.value||1600));
  let {width,height}=img;
  if(width>maxW){const s=maxW/width;width=Math.round(width*s);height=Math.round(height*s);}
  els.srcCanvas.width=width; els.srcCanvas.height=height;
  srcCtx.clearRect(0,0,width,height);
  srcCtx.drawImage(img,0,0,width,height);
  els.outCanvas.width=width; els.outCanvas.height=height; outCtx.clearRect(0,0,width,height);
  state.srcW=width; state.srcH=height; setZoom(state.zoom);
  status(`Loaded ${width}×${height}`);
}
function clearAll(){
  srcCtx.clearRect(0,0,els.srcCanvas.width,els.srcCanvas.height);
  outCtx.clearRect(0,0,els.outCanvas.width,els.outCanvas.height);
  state={...state,srcW:0,srcH:0,origPalette:[],restricted:[],mixRule:{srcHex:null,inks:[],block:6}};
  renderOrigPalette(); renderRestricted(); renderReplaceSrc(); els.mixInks.innerHTML=''; updateMixTotal();
  status('Cleared.');
}
function loadSample(){
  const w=512,h=384; const c=document.createElement('canvas');c.width=w;c.height=h;const ctx=c.getContext('2d');
  const g=ctx.createLinearGradient(0,0,w,h); g.addColorStop(0,'#264653'); g.addColorStop(.5,'#2a9d8f'); g.addColorStop(1,'#e9c46a');
  ctx.fillStyle=g; ctx.fillRect(0,0,w,h); ctx.fillStyle='#e76f51'; ctx.beginPath(); ctx.arc(180,150,80,0,Math.PI*2); ctx.fill();
  const img=new Image(); img.onload=()=>{drawToSrc(img); autoExtract();}; img.src=c.toDataURL('image/png');
}

/* -------------------- Zoom -------------------- */
els.zoom.addEventListener('input',()=>setZoom((+els.zoom.value||100)/100));
els.btnZoomFit.addEventListener('click',zoomFit);
els.btnZoom100.addEventListener('click',()=>setZoom(1));
function setZoom(z){state.zoom=z;els.zoomLabel.textContent=`${Math.round(z*100)}%`;[els.srcCanvas,els.outCanvas].forEach(c=>{c.style.transform=`scale(${z})`;});}
function zoomFit(){if(!state.srcW) return;const wrap=els.srcScroll.getBoundingClientRect();const z=wrap.width/state.srcW;els.zoom.value=Math.round(z*100);setZoom(z);}

/* -------------------- Palette -------------------- */
els.btnExtract.addEventListener('click', autoExtract);
els.btnEyedrop.addEventListener('click',()=>{state.eyedropActive=true;status('Click source image');});
els.srcCanvas.addEventListener('click',(e)=>{if(!state.eyedropActive) return;state.eyedropActive=false;
  const rect=els.srcCanvas.getBoundingClientRect();const x=Math.floor((e.clientX-rect.left)*(els.srcCanvas.width/rect.width));
  const y=Math.floor((e.clientY-rect.top)*(els.srcCanvas.height/rect.height));const d=srcCtx.getImageData(x,y,1,1).data;
  const hex=rgbToHex(d[0],d[1],d[2]); if(!state.origPalette.includes(hex)){state.origPalette.push(hex);renderOrigPalette();renderReplaceSrc();}});
function samplePixels(ctx,max=120000){let data;try{data=ctx.getImageData(0,0,ctx.canvas.width,ctx.canvas.height).data;}catch{const scale=Math.sqrt(max/(ctx.canvas.width*ctx.canvas.height));const w=Math.max(1,ctx.canvas.width*scale),h=Math.max(1,ctx.canvas.height*scale);const tmp=document.createElement('canvas');tmp.width=w;tmp.height=h;tmp.getContext('2d').drawImage(ctx.canvas,0,0,w,h);data=tmp.getContext('2d').getImageData(0,0,w,h).data;}
  const step=Math.max(1,Math.floor((data.length/4)/max));const samples=[];for(let i=0;i<data.length;i+=step*4){if(data[i+3]>10)samples.push([data[i],data[i+1],data[i+2]]);}return samples;}
function kmeans(samples,K=8,iters=6){if(!samples.length) return[];const c=[...Array(K)].map(()=>samples[Math.floor(Math.random()*samples.length)].slice());for(let it=0;it<iters;it++){const sums=c.map(()=>[0,0,0,0]);for(const s of samples){let bi=0,bd=1e9;for(let j=0;j<c.length;j++){const d=(s[0]-c[j][0])**2+(s[1]-c[j][1])**2+(s[2]-c[j][2])**2;if(d<bd){bd=d;bi=j;}}sums[bi][0]+=s[0];sums[bi][1]+=s[1];sums[bi][2]+=s[2];sums[bi][3]++; }for(let j=0;j<c.length;j++){if(sums[j][3]){c[j][0]=sums[j][0]/sums[j][3];c[j][1]=sums[j][1]/sums[j][3];c[j][2]=sums[j][2]/sums[j][3];}}}return c.map(r=>rgbToHex(...r));}
function autoExtract(){if(!state.srcW) return;const K=+els.clusters.value||8;const samples=samplePixels(srcCtx);state.origPalette=kmeans(samples,K,6);renderOrigPalette();renderReplaceSrc();if(!state.restricted.length){state.restricted=state.origPalette.slice(0,10).map(h=>({hex:h,enabled:true}));renderRestricted();}}

/* -------------------- Render Palettes -------------------- */
function renderOrigPalette(){els.origPalette.innerHTML='';state.origPalette.forEach((hex,i)=>{const sw=document.createElement('div');sw.className='swatch';const dot=document.createElement('div');dot.className='dot';dot.style.background=hex;const col=document.createElement('input');col.type='color';col.value=hex;col.oninput=()=>{state.origPalette[i]=col.value.toUpperCase();renderOrigPalette();renderReplaceSrc();};const label=document.createElement('span');label.textContent=hex;sw.append(dot,col,label);els.origPalette.appendChild(sw);});}
function renderRestricted(){els.restrictedPalette.innerHTML='';state.restricted.forEach((r,i)=>{const sw=document.createElement('div');sw.className='swatch';const dot=document.createElement('div');dot.className='dot';dot.style.background=r.hex;const col=document.createElement('input');col.type='color';col.value=r.hex;col.oninput=()=>{state.restricted[i].hex=col.value.toUpperCase();renderRestricted();};const label=document.createElement('span');label.textContent=r.hex;const chk=document.createElement('input');chk.type='checkbox';chk.checked=r.enabled;chk.onchange=()=>{state.restricted[i].enabled=chk.checked;};const del=document.createElement('button');del.textContent='Remove';del.className='btn btn-danger';del.onclick=()=>{state.restricted.splice(i,1);renderRestricted();};sw.append(dot,col,label,chk,del);els.restrictedPalette.appendChild(sw);});}
els.btnRefreshRestricted.onclick=()=>{state.restricted=state.origPalette.slice(0,10).map(h=>({hex:h,enabled:true}));renderRestricted();};
els.allowWhite.onchange=()=>{state.allowWhite=els.allowWhite.checked;};
els.btnAddRestricted.onclick=()=>{if(state.restricted.length>=10) return;state.restricted.push({hex:'#FFFFFF',enabled:true});renderRestricted();};

/* -------------------- Kits -------------------- */
function loadKits(){return JSON.parse(localStorage.getItem(KITS_KEY)||'{}');}
function saveKits(o){localStorage.setItem(KITS_KEY,JSON.stringify(o));}
els.btnSaveKit.onclick=()=>{const name=prompt('Kit name?');if(!name)return;const kits=loadKits();kits[name]=state.restricted;saveKits(kits);updateKitSelect();};
function updateKitSelect(){const kits=loadKits();els.kitSelect.innerHTML='';Object.keys(kits).forEach(n=>{const o=document.createElement('option');o.value=n;o.textContent=n;els.kitSelect.appendChild(o);});}
els.btnLoadKit.onclick=()=>{const kits=loadKits();const k=els.kitSelect.value;if(k) state.restricted=kits[k];renderRestricted();};
els.btnDeleteKit.onclick=()=>{const kits=loadKits();delete kits[els.kitSelect.value];saveKits(kits);updateKitSelect();};
updateKitSelect();

/* -------------------- Manual Mixing -------------------- */
function renderReplaceSrc(){els.replaceSrc.innerHTML='';state.origPalette.forEach(h=>{const o=document.createElement('option');o.value=h;o.textContent=h;els.replaceSrc.appendChild(o);});}
function updateMixTotal(){const tot=[...els.mixInks.querySelectorAll('.mix-row')].reduce((s,r)=>s+(+r.querySelector('.mix-ink-range').value),0);els.mixTotal.textContent=`Total: ${tot}%`;}
els.btnAddMixInk.onclick=()=>{if(els.mixInks.children.length>=3) return;const frag=document.importNode(els.tplMixRow.content,true);const row=frag.querySelector('.mix-row');const rng=row.querySelector('.mix-ink-range');const val=row.querySelector('.mix-ink-val');rng.oninput=()=>{val.textContent=`${rng.value}%`;updateMixTotal();};row.querySelector('.mix-ink-remove').onclick=()=>{row.remove();updateMixTotal();};els.restricted.filter(r=>r.enabled).forEach(r=>{const o=document.createElement('option');o.value=r.hex;o.textContent=r.hex;row.querySelector('.mix-ink-select').appendChild(o);});els.mixInks.appendChild(row);updateMixTotal();};
els.btnClearMix.onclick=()=>{els.mixInks.innerHTML='';updateMixTotal();};
els.btnPreviewMix.onclick=()=>{const rows=[...els.mixInks.querySelectorAll('.mix-row')].map(r=>({hex:r.querySelector('.mix-ink-select').value,density:+r.querySelector('.mix-ink-range').value})).filter(i=>i.density>0);if(rows.length<2)return toast('Need 2–3 inks','danger');const tot=rows.reduce((s,i)=>s+i.density,0);if(tot!==100)return toast('Densities must total 100%','danger');state.mixRule={srcHex:els.replaceSrc.value,inks:rows,block:+els.blockSize.value||6,pattern:els.mixPattern.value};const ctx=els.mixPreview.getContext('2d');ctx.clearRect(0,0,els.mixPreview.width,els.mixPreview.height);ctx.fillStyle=rows[0].hex;ctx.fillRect(0,0,els.mixPreview.width,els.mixPreview.height);toast('Mix preview updated');};

/* -------------------- Worker Mapper -------------------- */
let mapperWorker=null; function getMapperWorker(){if(mapperWorker)return mapper
