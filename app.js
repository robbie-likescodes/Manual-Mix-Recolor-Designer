/* ==========================================================
   Cup Mapper — app.js (single-thread, no external libs)
   - Fast preview mapping with selectable preview scale
   - Full-width hero preview for the original image (mobile-friendly)
   - Manual mix with patterns + logical pixel (cell) size
   - Kits, projects, PNG/SVG export
   ========================================================== */

/* -------------------- DOM -------------------- */
const $ = (id) => document.getElementById(id);
const els = {
  // header / dialogs
  btnOpenHelp: $('btnOpenHelp'),
  btnOpenAbout: $('btnOpenAbout'),
  btnCloseHelp: $('btnCloseHelp'),
  btnCloseAbout: $('btnCloseAbout'),
  dlgHelp: $('dlgHelp'),
  dlgAbout: $('dlgAbout'),

  // Stage 1
  heroCanvas: $('heroCanvas'),
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

  // Stage 2
  clusters: $('clusters'),
  btnExtract: $('btnExtract'),
  btnEyedrop: $('btnEyedrop'),
  origPalette: $('origPalette'),

  // Stage 3
  btnRefreshRestricted: $('btnRefreshRestricted'),
  allowWhite: $('allowWhite'),
  btnAddRestricted: $('btnAddRestricted'),
  restrictedPalette: $('restrictedPalette'),
  btnSaveKit: $('btnSaveKit'),
  kitSelect: $('kitSelect'),
  btnLoadKit: $('btnLoadKit'),
  btnDeleteKit: $('btnDeleteKit'),

  // Stage 4
  replaceSrc: $('replaceSrc'),
  blockSize: $('blockSize'),
  mixCellSize: $('mixCellSize'),
  mixPattern: $('mixPattern'),
  mixInks: $('mixInks'),
  btnAddMixInk: $('btnAddMixInk'),
  btnClearMix: $('btnClearMix'),
  mixTotal: $('mixTotal'),
  btnPreviewMix: $('btnPreviewMix'),
  mixPreview: $('mixPreview'),
  tplMixRow: $('tplMixRow'),

  // Stage 5
  wL: $('wL'),
  wC: $('wC'),
  dither: $('dither'),
  sharpen: $('sharpen'),
  previewRes: $('previewRes'),
  btnMap: $('btnMap'),
  mapProgress: $('mapProgress'),
  mapProgressLabel: $('mapProgressLabel'),

  // Stage 6
  exportScale: $('exportScale'),
  exportTransparent: $('exportTransparent'),
  btnExportPNG: $('btnExportPNG'),
  btnExportSVG: $('btnExportSVG'),
  downloadLink: $('downloadLink'),

  // Stage 7
  btnSaveProject: $('btnSaveProject'),
  btnLoadProject: $('btnLoadProject'),
  btnDeleteProject: $('btnDeleteProject'),
  projectSelect: $('projectSelect'),

  // Status + toasts
  statusText: $('statusText'),
  toastHost: $('toastHost'),
};

const srcCtx  = els.srcCanvas.getContext('2d', { willReadFrequently: true });
const outCtx  = els.outCanvas.getContext('2d', { willReadFrequently: true });
const heroCtx = els.heroCanvas.getContext('2d', { willReadFrequently: true });

/* -------------------- App State -------------------- */
const KITS_KEY = 'cupmapper_kits_v1';
const PROJ_KEY = 'cupmapper_projects_v1';

let state = {
  // image
  srcW: 0,
  srcH: 0,
  zoom: 1,

  // palettes
  origPalette: [], // hex[]
  restricted: [],  // [{hex, enabled}]
  allowWhite: false,

  // manual mix rule
  mixRule: {
    srcHex: null,     // original color to replace
    inks: [],         // [{hex, density}], 2..3, total 100
    block: 6,         // logical grid size
    pattern: 'blue',  // blue|checker|stripes-h|stripes-v|bayer
    cellSize: 1,      // logical pixel multiplier (bigger shapes for AI)
  },

  // mapping cache
  mappedImageData: null,
  lastPreview: {
    paramsHash: '',
    previewScale: 1,
    w: 0, h: 0,
  },

  // flags
  eyedropActive: false,
};

/* -------------------- Utilities -------------------- */
function toast(msg, type = 'ok') {
  const t = document.createElement('div');
  t.className = `toast ${type === 'danger' ? 'toast--danger' : 'toast--ok'}`;
  t.textContent = msg;
  els.toastHost.appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 300); }, 1600);
}
function status(msg) { els.statusText.textContent = msg; }
function clamp(v, lo = 0, hi = 255) { return v < lo ? lo : v > hi ? hi : v; }
function rgbToHex(r,g,b){const h=x=>x.toString(16).padStart(2,'0').toUpperCase();return `#${h(r)}${h(g)}${h(b)}`;}
function hexToRgb(hex){const m=/^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex||'');return m?{r:parseInt(m[1],16),g:parseInt(m[2],16),b:parseInt(m[3],16)}:{r:0,g:0,b:0};}
// sRGB -> XYZ -> Lab (D65)
function rgb2lab(r,g,b){r/=255;g/=255;b/=255;const inv=u=>u<=0.04045?u/12.92:Math.pow((u+0.055)/1.055,2.4);r=inv(r);g=inv(g);b=inv(b);let x=r*0.4124+g*0.3576+b*0.1805;let y=r*0.2126+g*0.7152+b*0.0722;let z=r*0.0193+g*0.1192+b*0.9505;const xr=x/0.95047,yr=y/1.0,zr=z/1.08883;const f=t=>t>0.008856?Math.cbrt(t):7.787*t+16/116;const fx=f(xr),fy=f(yr),fz=f(zr);return{L:116*fy-16,a:500*(fx-fy),b:200*(fy-fz)};}
function deltaE2(l1,l2,wL=1,wC=1){const dL=(l1.L-l2.L)*wL, da=(l1.a-l2.a)*wC, db=(l1.b-l2.b)*wC;return dL*dL+da*da+db*db;}

/* -------------------- Hero Preview (original image) -------------------- */
function renderHero() {
  if (!state.srcW || !state.srcH) { els.heroCanvas.width = 0; els.heroCanvas.height = 0; return; }
  const wrap = els.heroCanvas.parentElement.getBoundingClientRect();
  const targetW = Math.max(320, Math.floor(wrap.width));
  const cap = 2400; // pixel cap for iPhone memory
  const scale = Math.min(1, targetW / state.srcW, cap / state.srcW);
  const w = Math.max(1, Math.round(state.srcW * scale));
  const h = Math.max(1, Math.round(state.srcH * scale));
  els.heroCanvas.width = w; els.heroCanvas.height = h;
  heroCtx.imageSmoothingEnabled = true;
  heroCtx.clearRect(0, 0, w, h);
  heroCtx.drawImage(els.srcCanvas, 0, 0, w, h);
}
let _heroRaf = 0;
function scheduleHeroRender(){ cancelAnimationFrame(_heroRaf); _heroRaf = requestAnimationFrame(renderHero); }
window.addEventListener('resize', scheduleHeroRender);
window.addEventListener('orientationchange', scheduleHeroRender);

/* -------------------- Image Load & Zoom -------------------- */
els.fileInput.addEventListener('change', onFile);
els.btnClear.addEventListener('click', clearAll);
els.btnLoadSample.addEventListener('click', loadSample);
els.zoom.addEventListener('input', onZoomChange);
els.btnZoomFit.addEventListener('click', zoomFit);
els.btnZoom100.addEventListener('click', () => setZoom(1));

function onFile(e) {
  const f = e.target.files?.[0];
  if (!f) return;
  const fr = new FileReader();
  fr.onerror = () => toast('Could not read file', 'danger');
  fr.onload = () => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => { drawToSrc(img); autoExtract(); };
    img.onerror = () => toast('Failed to load image', 'danger');
    img.src = fr.result;
  };
  fr.readAsDataURL(f);
}
function drawToSrc(img) {
  const maxW = Math.max(300, Math.min(6000, +els.maxW.value || 1600));
  let { width, height } = img;
  if (width > maxW) { const s = maxW / width; width = Math.round(width * s); height = Math.round(height * s); }
  els.srcCanvas.width = width; els.srcCanvas.height = height;
  srcCtx.clearRect(0, 0, width, height);
  srcCtx.drawImage(img, 0, 0, width, height);

  els.outCanvas.width = width; els.outCanvas.height = height;
  outCtx.clearRect(0, 0, width, height);

  state.srcW = width; state.srcH = height;
  setZoom(state.zoom);
  status(`Loaded ${width}×${height}`);
  renderHero();
}
function clearAll() {
  srcCtx.clearRect(0,0,els.srcCanvas.width,els.srcCanvas.height);
  outCtx.clearRect(0,0,els.outCanvas.width,els.outCanvas.height);
  state.srcW = 0; state.srcH = 0;
  state.origPalette = [];
  state.restricted = [];
  state.allowWhite = false;
  state.mixRule = { srcHex:null, inks:[], block:6, pattern:'blue', cellSize:1 };
  els.allowWhite.checked = false;
  renderOrigPalette(); renderRestricted(); renderReplaceSrc();
  els.mixInks.innerHTML = ''; updateMixTotal();
  els.downloadLink.style.display = 'none';
  state.mappedImageData = null;
  state.lastPreview = { paramsHash: '', previewScale: 1, w:0, h:0 };
  renderHero();
  status('Cleared.');
}
function loadSample(){
  const w=1024,h=640; const c=document.createElement('canvas'); c.width=w; c.height=h; const ctx=c.getContext('2d');
  const g=ctx.createLinearGradient(0,0,w,h); g.addColorStop(0,'#264653'); g.addColorStop(.5,'#2a9d8f'); g.addColorStop(1,'#e9c46a');
  ctx.fillStyle=g; ctx.fillRect(0,0,w,h);
  ctx.fillStyle='#e76f51'; ctx.beginPath(); ctx.arc(280,240,120,0,Math.PI*2); ctx.fill();
  ctx.fillStyle='#f4a261'; ctx.fillRect(580,140,240,200);
  ctx.fillStyle='#1d3557'; ctx.beginPath(); ctx.moveTo(540,520); ctx.lineTo(860,520); ctx.lineTo(700,360); ctx.closePath(); ctx.fill();
  const img=new Image(); img.onload=()=>{ drawToSrc(img); autoExtract(); }; img.src=c.toDataURL('image/png');
}
function onZoomChange(){ setZoom(Math.max(0.1,(+els.zoom.value||100)/100)); }
function setZoom(z){ state.zoom=z; els.zoomLabel.textContent=`${Math.round(z*100)}%`; [els.srcCanvas,els.outCanvas].forEach(c=>{c.style.transformOrigin='top left'; c.style.transform=`scale(${z})`;}); }
function zoomFit(){ if(!state.srcW) return; const wrap=els.srcScroll.getBoundingClientRect(); const z=Math.max(0.1,Math.min(4,wrap.width/state.srcW)); els.zoom.value=Math.round(z*100); setZoom(z); }

/* -------------------- Stage 2: Palette (K-means + Eyedropper) -------------------- */
els.btnExtract.addEventListener('click', autoExtract);
els.btnEyedrop.addEventListener('click', () => {
  if (!state.srcW) return toast('Load an image first','danger');
  state.eyedropActive = true; status('Eyedropper active — click the source image');
});
els.srcCanvas.addEventListener('click', (e) => {
  if (!state.eyedropActive) return;
  state.eyedropActive = false;
  const rect=els.srcCanvas.getBoundingClientRect();
  const x=Math.floor((e.clientX-rect.left)*(els.srcCanvas.width/rect.width));
  const y=Math.floor((e.clientY-rect.top)*(els.srcCanvas.height/rect.height));
  const d=srcCtx.getImageData(x,y,1,1).data;
  const hex=rgbToHex(d[0],d[1],d[2]);
  if(!state.origPalette.includes(hex)){ state.origPalette.push(hex); renderOrigPalette(); renderReplaceSrc(); toast(`Added ${hex} to original palette`); }
});

function samplePixels(ctx, max = 120000) {
  const W=ctx.canvas.width, H=ctx.canvas.height;
  let data;
  try {
    data = ctx.getImageData(0,0,W,H).data;
  } catch {
    const scale=Math.min(1,Math.sqrt(max/(W*H)));
    const w2=Math.max(1,Math.floor(W*scale)), h2=Math.max(1,Math.floor(H*scale));
    const t=document.createElement('canvas'); t.width=w2; t.height=h2;
    const tc=t.getContext('2d'); tc.imageSmoothingEnabled=true; tc.drawImage(ctx.canvas,0,0,w2,h2);
    data = tc.getImageData(0,0,w2,h2).data;
  }
  const step=Math.max(1,Math.floor((data.length/4)/max)); const out=[];
  for(let i=0;i<data.length;i+=step*4){ const a=data[i+3]; if(a<10) continue; out.push([data[i],data[i+1],data[i+2]]); }
  return out;
}
function kmeans(samples,K=8,iters=8){
  if(!samples.length) return [];
  const cent=[], used=new Set();
  while(cent.length<K && cent.length<samples.length){ const j=Math.floor(Math.random()*samples.length); if(used.has(j))continue; used.add(j); cent.push(samples[j].slice()); }
  const labels=new Array(samples.length).fill(0);
  for(let it=0;it<iters;it++){
    for(let i=0;i<samples.length;i++){
      let best=0,bd=1e18; const s=samples[i];
      for(let k=0;k<cent.length;k++){ const c=cent[k]; const d=(s[0]-c[0])**2+(s[1]-c[1])**2+(s[2]-c[2])**2; if(d<bd){bd=d; best=k;} }
      labels[i]=best;
    }
    const sum=cent.map(()=>[0,0,0,0]);
    for(let i=0;i<samples.length;i++){ const k=labels[i], s=samples[i]; sum[k][0]+=s[0]; sum[k][1]+=s[1]; sum[k][2]+=s[2]; sum[k][3]++; }
    for(let k=0;k<cent.length;k++){ if(sum[k][3]){ cent[k][0]=Math.round(sum[k][0]/sum[k][3]); cent[k][1]=Math.round(sum[k][1]/sum[k][3]); cent[k][2]=Math.round(sum[k][2]/sum[k][3]); } }
  }
  const freq=new Array(cent.length).fill(0); for(const lab of labels) freq[lab]++;
  return cent.map((c,i)=>({hex:rgbToHex(c[0],c[1],c[2]),n:freq[i]}))
             .filter((v,i,s)=>s.findIndex(u=>u.hex===v.hex)===i)
             .sort((a,b)=>b.n-a.n).map(o=>o.hex);
}
function autoExtract(){
  if(!state.srcW) return toast('Load an image first','danger');
  const K=Math.max(2,Math.min(16,+els.clusters.value||8));
  const samples=samplePixels(srcCtx); if(!samples.length) return toast('No pixels to sample','danger');
  state.origPalette=kmeans(samples,K,8);
  renderOrigPalette(); renderReplaceSrc();
  if(state.restricted.length===0){ state.restricted=state.origPalette.slice(0,10).map(hex=>({hex,enabled:true})); renderRestricted(); }
  status(`Extracted ${state.origPalette.length} colors`);
}

/* -------------------- Stage 3: Restricted palette -------------------- */
function renderOrigPalette(){
  els.origPalette.innerHTML='';
  state.origPalette.forEach((hex, idx)=>{
    const sw=document.createElement('div'); sw.className='swatch';
    const dot=document.createElement('div'); dot.className='dot'; dot.style.background=hex;
    const col=document.createElement('input'); col.type='color'; col.value=hex;
    col.addEventListener('input',()=>{ state.origPalette[idx]=col.value.toUpperCase(); renderOrigPalette(); renderReplaceSrc(); });
    const label=document.createElement('span'); label.textContent=hex;
    sw.append(dot,col,label); els.origPalette.appendChild(sw);
  });
}
function renderRestricted(){
  els.restrictedPalette.innerHTML='';
  state.restricted.slice(0,10).forEach((item,idx)=>{
    const sw=document.createElement('div'); sw.className='swatch';
    const dot=document.createElement('div'); dot.className='dot'; dot.style.background=item.hex;
    const col=document.createElement('input'); col.type='color'; col.value=item.hex;
    col.addEventListener('input',()=>{ state.restricted[idx].hex=col.value.toUpperCase(); renderRestricted(); });
    const label=document.createElement('span'); label.textContent=item.hex;
    const chk=document.createElement('input'); chk.type='checkbox'; chk.checked=item.enabled;
    chk.addEventListener('change',()=>{ state.restricted[idx].enabled=chk.checked; });
    const del=document.createElement('button'); del.className='btn btn-danger'; del.textContent='Remove';
    del.addEventListener('click',()=>{ state.restricted.splice(idx,1); renderRestricted(); });
    sw.append(dot,col,label,chk,del); els.restrictedPalette.appendChild(sw);
  });
}
els.btnRefreshRestricted.addEventListener('click',()=>{ state.restricted=state.origPalette.slice(0,10).map(hex=>({hex,enabled:true})); renderRestricted(); });
els.allowWhite.addEventListener('change',()=>{ state.allowWhite=!!els.allowWhite.checked; });
els.btnAddRestricted.addEventListener('click',()=>{ if(state.restricted.length>=10) return toast('Max 10 inks','danger'); state.restricted.push({hex:'#FFFFFF',enabled:true}); renderRestricted(); });

/* -------------------- Kits (save / load / delete) -------------------- */
function loadKits(){ const obj=JSON.parse(localStorage.getItem(KITS_KEY)||'{}'); els.kitSelect.innerHTML=''; Object.keys(obj).forEach(name=>{ const o=document.createElement('option'); o.value=name; o.textContent=name; els.kitSelect.appendChild(o); }); return obj; }
function saveKits(obj){ localStorage.setItem(KITS_KEY, JSON.stringify(obj)); }
els.btnSaveKit.addEventListener('click',()=>{ const name=prompt('Kit name?'); if(!name) return; const kits=loadKits(); kits[name]=state.restricted; saveKits(kits); loadKits(); toast('Kit saved'); });
els.btnLoadKit.addEventListener('click',()=>{ const kits=loadKits(); const name=els.kitSelect.value; if(!name) return; state.restricted=kits[name]||[]; renderRestricted(); toast('Kit loaded'); });
els.btnDeleteKit.addEventListener('click',()=>{ const kits=loadKits(); const name=els.kitSelect.value; if(!name) return; delete kits[name]; saveKits(kits); loadKits(); toast('Kit deleted'); });
loadKits();

/* -------------------- Stage 4: Manual Mix -------------------- */
function renderReplaceSrc(){
  els.replaceSrc.innerHTML='';
  state.origPalette.forEach(hex=>{ const o=document.createElement('option'); o.value=hex; o.textContent=hex; els.replaceSrc.appendChild(o); });
  if(state.origPalette.length && !state.mixRule.srcHex) state.mixRule.srcHex=state.origPalette[0];
  if(state.mixRule.srcHex) els.replaceSrc.value=state.mixRule.srcHex;
}
els.replaceSrc.addEventListener('change',()=>{ state.mixRule.srcHex=els.replaceSrc.value; });
els.blockSize.addEventListener('change',()=>{ state.mixRule.block=Math.max(2,Math.min(64,+els.blockSize.value||6)); });
els.mixCellSize.addEventListener('change',()=>{ state.mixRule.cellSize=Math.max(1, +(els.mixCellSize.value||1)); });
els.mixPattern.addEventListener('change',()=>{ state.mixRule.pattern=els.mixPattern.value||'blue'; });

function addMixRow(hex=null, density=0){
  const frag=document.importNode(els.tplMixRow.content,true);
  const row=frag.querySelector('.mix-row');
  const sel=frag.querySelector('.mix-ink-select');
  const rng=frag.querySelector('.mix-ink-range');
  const val=frag.querySelector('.mix-ink-val');
  const del=frag.querySelector('.mix-ink-remove');
  const enabled=state.restricted.filter(r=>r.enabled).map(r=>r.hex);
  enabled.forEach(h=>{ const o=document.createElement('option'); o.value=h; o.textContent=h; sel.appendChild(o); });
  if(hex && enabled.includes(hex)) sel.value=hex;
  rng.value=density; val.textContent=`${density}%`;
  rng.addEventListener('input',()=>{ val.textContent=`${rng.value}%`; updateMixTotal(); });
  del.addEventListener('click',()=>{ row.remove(); updateMixTotal(); });
  els.mixInks.appendChild(row); updateMixTotal();
}
function getMixInksFromUI(){ return [...els.mixInks.querySelectorAll('.mix-row')].map(r=>({hex:r.querySelector('.mix-ink-select').value, density:+r.querySelector('.mix-ink-range').value})); }
function updateMixTotal(){ const tot=getMixInksFromUI().reduce((s,i)=>s+(i.density||0),0); els.mixTotal.textContent=`Total: ${tot}%`; }
els.btnAddMixInk.addEventListener('click',()=>{ if(els.mixInks.querySelectorAll('.mix-row').length>=3) return toast('Max 3 inks','danger'); addMixRow(); });
els.btnClearMix.addEventListener('click',()=>{ els.mixInks.innerHTML=''; updateMixTotal(); });
addMixRow();

els.btnPreviewMix.addEventListener('click',()=>{
  if(!state.mixRule.srcHex) state.mixRule.srcHex=els.replaceSrc.value;
  const inks=getMixInksFromUI().filter(i=>i.density>0);
  if(inks.length<2) return toast('Choose 2–3 inks with densities','danger');
  const tot=inks.reduce((s,i)=>s+i.density,0);
  if(tot!==100) return toast('Densities must total 100%','danger');
  state.mixRule.inks=inks;
  state.mixRule.block=Math.max(2,Math.min(64,+els.blockSize.value||6));
  state.mixRule.cellSize=Math.max(1, +(els.mixCellSize.value||1));
  state.mixRule.pattern=els.mixPattern.value||'blue';

  const ctx=els.mixPreview.getContext('2d');
  ctx.clearRect(0,0,els.mixPreview.width,els.mixPreview.height);
  const tile=buildDotTile(state.mixRule.block, inks, state.mixRule.pattern, state.mixRule.cellSize);
  for(let y=0;y<els.mixPreview.height;y+=tile.height){ for(let x=0;x<els.mixPreview.width;x+=tile.width){ ctx.putImageData(tile,x,y); } }
  toast('Mix preview updated');
});

// Build a tile with patterns + logical pixel (cell) size
function buildDotTile(b, inks, pattern = 'blue', cellSize = 1) {
  b = Math.max(1, b|0);
  cellSize = Math.max(1, cellSize|0);

  const tileW = b * cellSize;
  const tileH = b * cellSize;
  const tile = new ImageData(tileW, tileH);

  const cells = b * b;
  const quotas = inks.map(i => Math.round(cells * (i.density / 100)));
  let remaining = quotas.reduce((s, v) => s + v, 0);

  // Logical positions
  const positions = [];
  for (let gy = 0; gy < b; gy++) for (let gx = 0; gx < b; gx++) positions.push({ gx, gy });

  // Pattern ordering
  if (pattern === 'checker') {
    positions.sort((p, q) => ((p.gx + p.gy) & 1) - ((q.gx + q.gy) & 1));
  } else if (pattern === 'stripes-h') {
    positions.sort((p, q) => (p.gy - q.gy) || (p.gx - q.gx));
  } else if (pattern === 'stripes-v') {
    positions.sort((p, q) => (p.gx - q.gx) || (p.gy - q.gy));
  } else if (pattern === 'bayer') {
    const M = [[0,8,2,10],[12,4,14,6],[3,11,1,9],[15,7,13,5]];
    positions.sort((p,q) => (M[p.gy % 4][p.gx % 4]) - (M[q.gy % 4][q.gx % 4]));
  } else { // blue-noise-ish stable shuffle
    positions.sort((p, q) => ((p.gx * 73856093) ^ (p.gy * 19349663)) - ((q.gx * 73856093) ^ (q.gy * 19349663)));
  }

  // Round-robin assignment respecting quotas
  let i = 0;
  for (const pos of positions) {
    let guard = 0;
    while (quotas[i] <= 0 && guard < inks.length) { i = (i + 1) % inks.length; guard++; }
    if (remaining <= 0) break;
    if (quotas[i] <= 0) continue;

    const c = hexToRgb(inks[i].hex);
    const x0 = pos.gx * cellSize;
    const y0 = pos.gy * cellSize;

    // Paint NxN block
    for (let dy = 0; dy < cellSize; dy++) {
      const y = y0 + dy, row = y * tileW;
      for (let dx = 0; dx < cellSize; dx++) {
        const x = x0 + dx, idx = (row + x) * 4;
        tile.data[idx + 0] = c.r;
        tile.data[idx + 1] = c.g;
        tile.data[idx + 2] = c.b;
        tile.data[idx + 3] = 255;
      }
    }

    quotas[i]--; remaining--;
    i = (i + 1) % inks.length;
  }

  return tile;
}

/* -------------------- Stage 5: Mapping (preview with scale) -------------------- */
els.btnMap.addEventListener('click', mapToPalette);

function buildEnabledInks(){
  const arr=state.restricted.filter(r=>r.enabled).map(r=>r.hex);
  if(state.allowWhite && !arr.includes('#FFFFFF')) arr.push('#FFFFFF');
  return arr.slice(0,10);
}
function currentParamsHash(previewScale){
  const mix = (state.mixRule && state.mixRule.inks && state.mixRule.inks.length>=2)
    ? { srcHex: state.mixRule.srcHex,
        inks: state.mixRule.inks,
        block: state.mixRule.block,
        pattern: state.mixRule.pattern || 'blue',
        cellSize: state.mixRule.cellSize || 1,
        origPalette: state.origPalette.slice() }
    : null;
  return JSON.stringify({
    inks: buildEnabledInks(),
    wL: +els.wL.value || 1.0,
    wC: +els.wC.value || 1.0,
    dither: !!els.dither.checked,
    sharpen: !!els.sharpen.checked,
    snapE2: 1.2,
    mixRule: mix,
    previewScale
  });
}
function getScaledSrcImageData(scale){
  scale = Math.max(0.1, Math.min(1, +scale || 1));
  const sw=state.srcW, sh=state.srcH;
  const w=Math.max(1, Math.round(sw*scale)), h=Math.max(1, Math.round(sh*scale));
  const off=document.createElement('canvas'); off.width=w; off.height=h;
  const cx=off.getContext('2d',{willReadFrequently:true});
  cx.imageSmoothingEnabled=true; cx.drawImage(els.srcCanvas,0,0,w,h);
  return { imageData: cx.getImageData(0,0,w,h), width:w, height:h };
}

// Dithering propagate (Floyd–Steinberg)
function fsPropagate(err,width,x,y,er,eg,eb){
  function add(xx, yy, mul) {
    if (xx < 0 || yy < 0 || xx >= width) return;
    const i = (yy * width + xx) * 3;
    err[i + 0] += er * mul; err[i + 1] += eg * mul; err[i + 2] += eb * mul;
  }
  add(x + 1, y, 7 / 16);
  add(x - 1, y + 1, 3 / 16);
  add(x, y + 1, 5 / 16);
  add(x + 1, y + 1, 1 / 16);
}

function unsharp(img) {
  const w = img.width, h = img.height;
  const src = img.data;
  const tmp = new Uint8ClampedArray(src.length);
  // 3x3 box blur
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx, yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
          const i = (yy * w + xx) * 4;
          r += src[i]; g += src[i + 1]; b += src[i + 2]; a += src[i + 3]; n++;
        }
      }
      const i = (y * w + x) * 4;
      tmp[i + 0] = r / n; tmp[i + 1] = g / n; tmp[i + 2] = b / n; tmp[i + 3] = a / n;
    }
  }
  const amt = 0.6;
  for (let i = 0; i < src.length; i += 4) {
    src[i + 0] = clamp(src[i + 0] + amt * (src[i + 0] - tmp[i + 0]));
    src[i + 1] = clamp(src[i + 1] + amt * (src[i + 1] - tmp[i + 1]));
    src[i + 2] = clamp(src[i + 2] + amt * (src[i + 2] - tmp[i + 2]));
  }
}

function mapToPalette(){
  if(!state.srcW) return toast('Load an image first','danger');
  const enabled=buildEnabledInks(); if(enabled.length===0) return toast('Enable at least one ink','danger');

  const previewScale = +(els.previewRes?.value || 1);
  const { imageData, width, height } = getScaledSrcImageData(previewScale);
  const paramsHash = currentParamsHash(previewScale);

  // Early exit if nothing changed
  if (state.lastPreview.paramsHash === paramsHash &&
      state.lastPreview.w === width && state.lastPreview.h === height) {
    toast('Preview already up to date');
    return;
  }

  els.mapProgress.classList.remove('hidden');
  els.mapProgressLabel.textContent = 'Processing…';
  status('Mapping preview…');

  // Precompute ink labs
  const wL = +els.wL.value || 1.0;
  const wC = +els.wC.value || 1.0;
  const dither = !!els.dither.checked;
  const doSharpen = !!els.sharpen.checked;
  const snapE2 = 1.2;

  const inkLabs = enabled.map(hex => {
    const { r, g, b } = hexToRgb(hex);
    return { hex, rgb:{r,g,b}, lab: rgb2lab(r,g,b) };
  });

  // Manual mix prep
  const hasMix = !!(state.mixRule.srcHex && state.mixRule.inks && state.mixRule.inks.length >= 2);
  const block = Math.max(2, Math.min(64, state.mixRule.block || 6));
  const cellSize = Math.max(1, state.mixRule.cellSize || 1);
  const fullBlock = block * cellSize;
  const mixTile = hasMix ? buildDotTile(block, state.mixRule.inks, state.mixRule.pattern || 'blue', cellSize) : null;

  // Optional dither buffer
  const err = dither ? new Float32Array(width * height * 3) : null;

  const src = imageData;
  const out = new ImageData(width, height);

  // Process in row chunks to keep UI responsive
  let y = 0;
  const ROWS_PER_CHUNK = 32;

  function processChunk(){
    const yEnd = Math.min(height, y + ROWS_PER_CHUNK);
    for (; y < yEnd; y++) {
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x);
        const i4 = idx * 4;
        let r = src.data[i4], g = src.data[i4 + 1], b = src.data[i4 + 2], a = src.data[i4 + 3];
        if (a < 10) { out.data.set([0,0,0,0], i4); continue; }

        if (dither) {
          r = clamp(r + err[idx * 3 + 0], 0, 255);
          g = clamp(g + err[idx * 3 + 1], 0, 255);
          b = clamp(b + err[idx * 3 + 2], 0, 255);
        }

        // Manual mix: apply tile where nearest ORIGINAL equals srcHex
        if (hasMix && state.origPalette.length) {
          let bestHex = null, bestD = 1e18;
          for (const oh of state.origPalette) {
            const c = hexToRgb(oh);
            const d2 = (r - c.r) ** 2 + (g - c.g) ** 2 + (b - c.b) ** 2;
            if (d2 < bestD) { bestD = d2; bestHex = oh; }
          }
          if (bestHex === state.mixRule.srcHex) {
            const mx = x % fullBlock, my = y % fullBlock;
            const mi = (my * mixTile.width + mx) * 4;
            const mr = mixTile.data[mi + 0], mg = mixTile.data[mi + 1], mb = mixTile.data[mi + 2], ma = mixTile.data[mi + 3];
            if (ma === 255) {
              out.data[i4 + 0] = mr; out.data[i4 + 1] = mg; out.data[i4 + 2] = mb; out.data[i4 + 3] = a;
              if (dither) {
                const er = r - mr, eg = g - mg, eb = b - mb;
                fsPropagate(err, width, x, y, er, eg, eb);
              }
              continue;
            }
          }
        }

        // Otherwise pick nearest ink in Lab
        const lab = rgb2lab(r, g, b);
        let chosen = null, bestE = 1e18;
        for (const ink of inkLabs) {
          const e2 = deltaE2(lab, ink.lab, wL, wC);
          if (e2 < bestE) { bestE = e2; chosen = ink; }
          if (e2 < snapE2) { chosen = ink; bestE = e2; break; }
        }

        out.data[i4 + 0] = chosen.rgb.r;
        out.data[i4 + 1] = chosen.rgb.g;
        out.data[i4 + 2] = chosen.rgb.b;
        out.data[i4 + 3] = a;

        if (dither) {
          const er = r - chosen.rgb.r;
          const eg = g - chosen.rgb.g;
          const eb = b - chosen.rgb.b;
          fsPropagate(err, width, x, y, er, eg, eb);
        }
      }
    }

    els.mapProgressLabel.textContent = `Processing… ${Math.round((y/height)*100)}%`;
    if (y < height) {
      // Let the UI breathe
      setTimeout(processChunk, 0);
    } else {
      if (doSharpen) unsharp(out);
      els.outCanvas.width = width; els.outCanvas.height = height;
      outCtx.putImageData(out, 0, 0);
      state.mappedImageData = out;
      state.lastPreview = { paramsHash, previewScale, w: width, h: height };
      els.mapProgress.classList.add('hidden');
      status('Preview mapping complete');
      toast('Preview updated');
    }
  }
  processChunk();
}

/* -------------------- Stage 6: Export (full-res remap before save) -------------------- */
els.btnExportPNG.addEventListener('click', exportPNG);
els.btnExportSVG.addEventListener('click', exportSVG);

function ensureFullResMap(cb){
  const enabled=buildEnabledInks(); if(enabled.length===0){ toast('Enable at least one ink','danger'); return; }

  const paramsHashFull = currentParamsHash(1);
  const upToDate = state.mappedImageData &&
                   state.lastPreview.paramsHash === paramsHashFull &&
                   state.lastPreview.previewScale === 1 &&
                   state.mappedImageData.width === state.srcW &&
                   state.mappedImageData.height === state.srcH;

  if (upToDate) return cb(state.mappedImageData);

  els.mapProgress.classList.remove('hidden');
  els.mapProgressLabel.textContent = 'Building export…';

  // Run a synchronous full-res map using the same logic as preview
  const { imageData, width, height } = getScaledSrcImageData(1);

  const wL = +els.wL.value || 1.0;
  const wC = +els.wC.value || 1.0;
  const dither = !!els.dither.checked;
  const doSharpen = !!els.sharpen.checked;
  const snapE2 = 1.2;

  const inkLabs = enabled.map(hex => {
    const { r, g, b } = hexToRgb(hex);
    return { hex, rgb:{r,g,b}, lab: rgb2lab(r,g,b) };
  });

  const hasMix = !!(state.mixRule.srcHex && state.mixRule.inks && state.mixRule.inks.length >= 2);
  const block = Math.max(2, Math.min(64, state.mixRule.block || 6));
  const cellSize = Math.max(1, state.mixRule.cellSize || 1);
  const fullBlock = block * cellSize;
  const mixTile = hasMix ? buildDotTile(block, state.mixRule.inks, state.mixRule.pattern || 'blue', cellSize) : null;
  const err = dither ? new Float32Array(width * height * 3) : null;

  const src = imageData;
  const out = new ImageData(width, height);

  for (let y=0; y<height; y++){
    for (let x=0; x<width; x++){
      const idx = (y * width + x);
      const i4 = idx * 4;
      let r = src.data[i4], g = src.data[i4+1], b = src.data[i4+2], a = src.data[i4+3];
      if (a < 10) { out.data.set([0,0,0,0], i4); continue; }

      if (dither) {
        r = clamp(r + err[idx * 3 + 0], 0, 255);
        g = clamp(g + err[idx * 3 + 1], 0, 255);
        b = clamp(b + err[idx * 3 + 2], 0, 255);
      }

      if (hasMix && state.origPalette.length) {
        let bestHex = null, bestD = 1e18;
        for (const oh of state.origPalette) {
          const c = hexToRgb(oh);
          const d2 = (r - c.r) ** 2 + (g - c.g) ** 2 + (b - c.b) ** 2;
          if (d2 < bestD) { bestD = d2; bestHex = oh; }
        }
        if (bestHex === state.mixRule.srcHex) {
          const mx = x % fullBlock, my = y % fullBlock;
          const mi = (my * mixTile.width + mx) * 4;
          const mr = mixTile.data[mi + 0], mg = mixTile.data[mi + 1], mb = mixTile.data[mi + 2], ma = mixTile.data[mi + 3];
          if (ma === 255) {
            out.data[i4 + 0] = mr; out.data[i4 + 1] = mg; out.data[i4 + 2] = mb; out.data[i4 + 3] = a;
            if (dither) {
              const er = r - mr, eg = g - mg, eb = b - mb;
              fsPropagate(err, width, x, y, er, eg, eb);
            }
            continue;
          }
        }
      }

      const lab = rgb2lab(r,g,b);
      let chosen = null, bestE = 1e18;
      for (const ink of inkLabs) {
        const e2 = deltaE2(lab, ink.lab, wL, wC);
        if (e2 < bestE) { bestE = e2; chosen = ink; }
        if (e2 < snapE2) { chosen = ink; bestE = e2; break; }
      }
      out.data[i4 + 0] = chosen.rgb.r;
      out.data[i4 + 1] = chosen.rgb.g;
      out.data[i4 + 2] = chosen.rgb.b;
      out.data[i4 + 3] = a;

      if (dither) {
        const er = r - chosen.rgb.r;
        const eg = g - chosen.rgb.g;
        const eb = b - chosen.rgb.b;
        fsPropagate(err, width, x, y, er, eg, eb);
      }
    }
    if (y % 64 === 0) els.mapProgressLabel.textContent = `Building export… ${Math.round((y/height)*100)}%`;
  }

  if (doSharpen) unsharp(out);

  state.mappedImageData = out;
  state.lastPreview = { paramsHash: paramsHashFull, previewScale: 1, w: width, h: height };
  els.outCanvas.width = width; els.outCanvas.height = height;
  outCtx.putImageData(out, 0, 0);
  els.mapProgress.classList.add('hidden');
  cb(out);
}

function exportPNG(){
  if(!state.srcW) return toast('Load an image first','danger');
  ensureFullResMap((fullImg)=>{
    const scale=+els.exportScale.value||1;
    const transparent=!!els.exportTransparent.checked;
    const w=fullImg.width*scale, h=fullImg.height*scale;

    const c=document.createElement('canvas'); c.width=w; c.height=h;
    const cx=c.getContext('2d'); cx.imageSmoothingEnabled=false;

    if(!transparent){ cx.fillStyle='#FFFFFF'; cx.fillRect(0,0,w,h); }
    const tmp=document.createElement('canvas'); tmp.width=fullImg.width; tmp.height=fullImg.height;
    tmp.getContext('2d').putImageData(fullImg,0,0);
    cx.drawImage(tmp,0,0,w,h);

    c.toBlob((blob)=>{ const url=URL.createObjectURL(blob);
      els.downloadLink.href=url; els.downloadLink.download='cup-mapper.png';
      els.downloadLink.style.display='inline-flex'; els.downloadLink.textContent='Download PNG';
      toast('PNG ready');
    }, 'image/png');
  });
}
function exportSVG(){
  if(!state.srcW) return toast('Load an image first','danger');
  ensureFullResMap((img)=>{
    const {width,height,data}=img;
    let svg=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" shape-rendering="crispEdges">`;
    for(let y=0;y<height;y++){
      const row=y*width*4;
      for(let x=0;x<width;x++){
        const i=row+x*4; const a=data[i+3]; if(a<10) continue;
        const hex=rgbToHex(data[i],data[i+1],data[i+2]);
        svg+=`<rect x="${x}" y="${y}" width="1" height="1" fill="${hex}"/>`;
      }
    }
    svg+=`</svg>`;
    const blob=new Blob([svg],{type:'image/svg+xml'});
    const url=URL.createObjectURL(blob);
    els.downloadLink.href=url; els.downloadLink.download='cup-mapper.svg';
    els.downloadLink.style.display='inline-flex'; els.downloadLink.textContent='Download SVG';
    toast('SVG ready');
  });
}

/* -------------------- Stage 7: Projects -------------------- */
function listProjects(){ const arr=JSON.parse(localStorage.getItem(PROJ_KEY)||'[]'); els.projectSelect.innerHTML=''; arr.forEach((p,idx)=>{ const o=document.createElement('option'); o.value=String(idx); o.textContent=`${p.name} — ${new Date(p.ts).toLocaleString()}`; els.projectSelect.appendChild(o); }); return arr; }
function saveProjects(arr){ localStorage.setItem(PROJ_KEY, JSON.stringify(arr)); }
listProjects();

els.btnSaveProject.addEventListener('click',()=>{
  if(!state.srcW) return toast('Load an image first','danger');
  const name=prompt('Project name?')||'Untitled';
  const srcDataURL=els.srcCanvas.toDataURL('image/png');
  const proj={ name, ts:Date.now(),
    srcDataURL,
    origPalette:state.origPalette,
    restricted:state.restricted,
    allowWhite:state.allowWhite,
    mixRule:state.mixRule,
    settings:{ wL:+els.wL.value, wC:+els.wC.value, dither:!!els.dither.checked, sharpen:!!els.sharpen.checked } };
  const arr=listProjects(); arr.unshift(proj); saveProjects(arr); listProjects(); toast('Project saved');
});
els.btnLoadProject.addEventListener('click',()=>{
  const arr=listProjects(); const idx=+els.projectSelect.value; if(Number.isNaN(idx)) return;
  const p=arr[idx]; if(!p) return;
  const img=new Image();
  img.onload=()=>{
    drawToSrc(img);
    state.origPalette=p.origPalette||[];
    state.restricted=p.restricted||[];
    state.allowWhite=!!p.allowWhite; els.allowWhite.checked=state.allowWhite;
    state.mixRule={ srcHex:null, inks:[], block:6, pattern:'blue', cellSize:1, ...p.mixRule };
    els.wL.value=p.settings?.wL ?? 1.0;
    els.wC.value=p.settings?.wC ?? 1.0;
    els.dither.checked=!!(p.settings?.dither);
    els.sharpen.checked=!!(p.settings?.sharpen);
    els.blockSize.value=state.mixRule.block||6;
    els.mixCellSize.value=state.mixRule.cellSize||1;
    els.mixPattern.value=state.mixRule.pattern||'blue';
    renderOrigPalette(); renderRestricted(); renderReplaceSrc();
    renderHero();
    toast('Project loaded — click “Apply mapping” to render');
  };
  img.src=p.srcDataURL;
});
els.btnDeleteProject.addEventListener('click',()=>{
  const arr=listProjects(); const idx=+els.projectSelect.value; if(Number.isNaN(idx)) return;
  if(!confirm('Delete selected project?')) return;
  arr.splice(idx,1); saveProjects(arr); listProjects(); toast('Project deleted');
});

/* -------------------- Modals & Misc -------------------- */
els.btnOpenHelp.addEventListener('click',()=>els.dlgHelp.showModal());
els.btnOpenAbout.addEventListener('click',()=>els.dlgAbout.showModal());
els.btnCloseHelp.addEventListener('click',()=>els.dlgHelp.close());
els.btnCloseAbout.addEventListener('click',()=>els.dlgAbout.close());

/* -------------------- Init -------------------- */
status('Ready. Load an image or use “Load sample”.');
