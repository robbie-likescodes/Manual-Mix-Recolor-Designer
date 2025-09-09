/* ==========================================================
   Cup Mapper — app.js (comprehensive, no external libs)
   Works with the provided index.html + styles.css (dark theme)
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

const srcCtx = els.srcCanvas.getContext('2d', { willReadFrequently: true });
const outCtx = els.outCanvas.getContext('2d', { willReadFrequently: true });

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
  // mix rule
  mixRule: {
    srcHex: null,     // original color to replace
    inks: [],         // [{hex, density}], 2..3
    block: 6,         // pixel block size
  },
  // processing outputs
  mappedImageData: null,
  // flags
  eyedropActive: false,
};

/* -------------------- Utilities -------------------- */
function toast(msg, type = 'ok') {
  console.log('[Toast]', msg);
  const t = document.createElement('div');
  t.className = `toast ${type === 'danger' ? 'toast--danger' : 'toast--ok'}`;
  t.textContent = msg;
  els.toastHost.appendChild(t);
  setTimeout(() => {
    t.style.opacity = '0';
    setTimeout(() => t.remove(), 300);
  }, 1600);
}
function status(msg) {
  els.statusText.textContent = msg;
}
function clamp(v, lo = 0, hi = 255) {
  return v < lo ? lo : v > hi ? hi : v;
}
function rgbToHex(r, g, b) {
  const h = (x) => x.toString(16).padStart(2, '0').toUpperCase();
  return `#${h(r)}${h(g)}${h(b)}`;
}
function hexToRgb(hex) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || '');
  if (!m) return { r: 0, g: 0, b: 0 };
  return { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) };
}
// sRGB -> XYZ -> Lab (D65)
function rgb2lab(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const inv = (u) => (u <= 0.04045 ? u / 12.92 : Math.pow((u + 0.055) / 1.055, 2.4));
  r = inv(r); g = inv(g); b = inv(b);
  let x = r * 0.4124 + g * 0.3576 + b * 0.1805;
  let y = r * 0.2126 + g * 0.7152 + b * 0.0722;
  let z = r * 0.0193 + g * 0.1192 + b * 0.9505;
  const xr = x / 0.95047, yr = y / 1.0000, zr = z / 1.08883;
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : (7.787 * t + 16 / 116));
  const fx = f(xr), fy = f(yr), fz = f(zr);
  return { L: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
}
function deltaE2(lab1, lab2, wL = 1, wC = 1) {
  const dL = (lab1.L - lab2.L) * wL;
  const da = (lab1.a - lab2.a) * wC;
  const db = (lab1.b - lab2.b) * wC;
  return dL * dL + da * da + db * db;
}

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
  const url = URL.createObjectURL(f);
  const img = new Image();
  img.onload = () => {
    drawToSrc(img);
    URL.revokeObjectURL(url);
    autoExtract();
  };
  img.onerror = () => toast('Failed to load image', 'danger');
  img.src = url;
}

function drawToSrc(img) {
  const maxW = Math.max(300, Math.min(6000, +els.maxW.value || 1600));
  let { width, height } = img;
  if (width > maxW) {
    const s = maxW / width;
    width = Math.round(width * s);
    height = Math.round(height * s);
  }
  els.srcCanvas.width = width; els.srcCanvas.height = height;
  srcCtx.clearRect(0, 0, width, height);
  srcCtx.drawImage(img, 0, 0, width, height);
  els.outCanvas.width = width; els.outCanvas.height = height;
  outCtx.clearRect(0, 0, width, height);

  state.srcW = width; state.srcH = height;
  setZoom(state.zoom); // preserve zoom
  status(`Loaded ${width}×${height}`);
}

function clearAll() {
  srcCtx.clearRect(0, 0, els.srcCanvas.width, els.srcCanvas.height);
  outCtx.clearRect(0, 0, els.outCanvas.width, els.outCanvas.height);
  state.srcW = 0; state.srcH = 0;
  state.origPalette = [];
  state.restricted = [];
  state.mixRule = { srcHex: null, inks: [], block: 6 };
  renderOrigPalette();
  renderRestricted();
  renderReplaceSrc();
  els.mixInks.innerHTML = '';
  updateMixTotal();
  status('Cleared.');
}

function loadSample() {
  // Generate a synthetic sample (smooth gradient + shapes) for instant demo
  const w = 1024, h = 640;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');

  // Background gradient
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, '#264653');
  g.addColorStop(0.5, '#2a9d8f');
  g.addColorStop(1, '#e9c46a');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  // Shapes
  ctx.fillStyle = '#e76f51'; ctx.beginPath(); ctx.arc(280, 240, 120, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#f4a261'; ctx.fillRect(580, 140, 240, 200);
  ctx.fillStyle = '#1d3557'; ctx.beginPath(); ctx.moveTo(540, 520); ctx.lineTo(860, 520); ctx.lineTo(700, 360); ctx.closePath(); ctx.fill();

  // Image element
  const img = new Image();
  img.onload = () => {
    drawToSrc(img);
    autoExtract();
  };
  img.src = c.toDataURL('image/png');
}

function onZoomChange() {
  const val = Math.max(0.1, (+els.zoom.value || 100) / 100);
  setZoom(val);
}
function setZoom(z) {
  state.zoom = z;
  const pct = Math.round(z * 100);
  els.zoomLabel.textContent = `${pct}%`;
  // apply transform scale on canvases
  for (const canvas of [els.srcCanvas, els.outCanvas]) {
    canvas.style.transformOrigin = 'top left';
    canvas.style.transform = `scale(${z})`;
  }
}
function zoomFit() {
  if (!state.srcW) return;
  // fit source canvas into its scroll viewport width
  const wrap = els.srcScroll.getBoundingClientRect();
  const z = Math.max(0.1, Math.min(4, wrap.width / state.srcW));
  els.zoom.value = Math.round(z * 100);
  setZoom(z);
}

/* -------------------- Stage 2: Palette (K-means + Eyedropper) -------------------- */
els.btnExtract.addEventListener('click', autoExtract);
els.btnEyedrop.addEventListener('click', () => {
  if (!state.srcW) return toast('Load an image first', 'danger');
  state.eyedropActive = true;
  status('Eyedropper active — click the source image');
});
els.srcCanvas.addEventListener('click', (e) => {
  if (!state.eyedropActive) return;
  state.eyedropActive = false;
  const rect = els.srcCanvas.getBoundingClientRect();
  const x = Math.floor((e.clientX - rect.left) * (els.srcCanvas.width / rect.width));
  const y = Math.floor((e.clientY - rect.top) * (els.srcCanvas.height / rect.height));
  const d = srcCtx.getImageData(x, y, 1, 1).data;
  const hex = rgbToHex(d[0], d[1], d[2]);
  if (!state.origPalette.includes(hex)) {
    state.origPalette.push(hex);
    renderOrigPalette();
    renderReplaceSrc();
    toast(`Added ${hex} to original palette`);
  }
});

function samplePixels(ctx, max = 120000) {
  const { width, height } = ctx.canvas;
  const data = ctx.getImageData(0, 0, width, height).data;
  const step = Math.max(1, Math.floor((width * height) / max));
  const samples = [];
  for (let i = 0; i < width * height; i += step) {
    const idx = i * 4;
    const a = data[idx + 3];
    if (a < 10) continue;
    samples.push([data[idx], data[idx + 1], data[idx + 2]]);
  }
  return samples;
}
function kmeans(samples, K = 8, iters = 8) {
  if (!samples.length) return [];
  // init centroids from random samples
  const centroids = [];
  const used = new Set();
  while (centroids.length < K && centroids.length < samples.length) {
    const j = Math.floor(Math.random() * samples.length);
    if (used.has(j)) continue;
    used.add(j);
    centroids.push(samples[j].slice());
  }
  const labels = new Array(samples.length).fill(0);
  for (let it = 0; it < iters; it++) {
    // assign
    for (let i = 0; i < samples.length; i++) {
      let best = 0, bestD = 1e18;
      const s = samples[i];
      for (let k = 0; k < centroids.length; k++) {
        const c = centroids[k];
        const d = (s[0] - c[0]) ** 2 + (s[1] - c[1]) ** 2 + (s[2] - c[2]) ** 2;
        if (d < bestD) { bestD = d; best = k; }
      }
      labels[i] = best;
    }
    // update
    const sum = centroids.map(() => [0, 0, 0, 0]);
    for (let i = 0; i < samples.length; i++) {
      const k = labels[i], s = samples[i];
      sum[k][0] += s[0]; sum[k][1] += s[1]; sum[k][2] += s[2]; sum[k][3]++;
    }
    for (let k = 0; k < centroids.length; k++) {
      if (sum[k][3] > 0) {
        centroids[k][0] = Math.round(sum[k][0] / sum[k][3]);
        centroids[k][1] = Math.round(sum[k][1] / sum[k][3]);
        centroids[k][2] = Math.round(sum[k][2] / sum[k][3]);
      }
    }
  }
  // rank by frequency
  const freq = new Array(centroids.length).fill(0);
  for (const lab of labels) freq[lab]++;
  return centroids.map((c, i) => ({ hex: rgbToHex(c[0], c[1], c[2]), n: freq[i] }))
    .filter((v, i, self) => self.findIndex(u => u.hex === v.hex) === i)
    .sort((a, b) => b.n - a.n)
    .map(o => o.hex);
}

function autoExtract() {
  if (!state.srcW) return toast('Load an image first', 'danger');
  const K = Math.max(2, Math.min(16, +els.clusters.value || 8));
  const samples = samplePixels(srcCtx);
  state.origPalette = kmeans(samples, K, 8);
  renderOrigPalette();
  renderReplaceSrc();
  // first-time default restricted = orig (enabled)
  if (state.restricted.length === 0) {
    state.restricted = state.origPalette.slice(0, 10).map(hex => ({ hex, enabled: true }));
    renderRestricted();
  }
  status(`Extracted ${state.origPalette.length} colors`);
}

/* -------------------- Render Palettes -------------------- */
function renderOrigPalette() {
  els.origPalette.innerHTML = '';
  state.origPalette.forEach((hex, idx) => {
    const sw = document.createElement('div');
    sw.className = 'swatch';
    const dot = document.createElement('div'); dot.className = 'dot'; dot.style.background = hex;
    const col = document.createElement('input'); col.type = 'color'; col.value = hex;
    col.addEventListener('input', () => {
      state.origPalette[idx] = col.value.toUpperCase();
      renderOrigPalette();
      renderReplaceSrc();
    });
    const label = document.createElement('span'); label.textContent = hex;
    sw.append(dot, col, label);
    els.origPalette.appendChild(sw);
  });
}
function renderRestricted() {
  els.restrictedPalette.innerHTML = '';
  state.restricted.slice(0, 10).forEach((item, idx) => {
    const sw = document.createElement('div');
    sw.className = 'swatch';
    const dot = document.createElement('div'); dot.className = 'dot'; dot.style.background = item.hex;
    const col = document.createElement('input'); col.type = 'color'; col.value = item.hex;
    col.addEventListener('input', () => {
      state.restricted[idx].hex = col.value.toUpperCase();
      renderRestricted();
    });
    const label = document.createElement('span'); label.textContent = item.hex;
    const chk = document.createElement('input'); chk.type = 'checkbox'; chk.checked = item.enabled;
    chk.addEventListener('change', () => { state.restricted[idx].enabled = chk.checked; });
    const del = document.createElement('button'); del.className = 'btn btn-danger'; del.textContent = 'Remove';
    del.addEventListener('click', () => {
      state.restricted.splice(idx, 1);
      renderRestricted();
    });
    sw.append(dot, col, label, chk, del);
    els.restrictedPalette.appendChild(sw);
  });
}
els.btnRefreshRestricted.addEventListener('click', () => {
  state.restricted = state.origPalette.slice(0, 10).map(hex => ({ hex, enabled: true }));
  renderRestricted();
});
els.allowWhite.addEventListener('change', () => {
  state.allowWhite = !!els.allowWhite.checked;
});
els.btnAddRestricted.addEventListener('click', () => {
  if (state.restricted.length >= 10) return toast('Max 10 inks', 'danger');
  state.restricted.push({ hex: '#FFFFFF', enabled: true });
  renderRestricted();
});

/* -------------------- Kits (save/load/delete) -------------------- */
function loadKits() {
  const obj = JSON.parse(localStorage.getItem(KITS_KEY) || '{}');
  els.kitSelect.innerHTML = '';
  Object.keys(obj).forEach(name => {
    const opt = document.createElement('option');
    opt.value = name; opt.textContent = name;
    els.kitSelect.appendChild(opt);
  });
  return obj;
}
function saveKits(obj) {
  localStorage.setItem(KITS_KEY, JSON.stringify(obj));
}
els.btnSaveKit.addEventListener('click', () => {
  const name = prompt('Kit name?'); if (!name) return;
  const kits = loadKits();
  kits[name] = state.restricted;
  saveKits(kits);
  loadKits();
  toast('Kit saved');
});
els.btnLoadKit.addEventListener('click', () => {
  const kits = loadKits();
  const name = els.kitSelect.value; if (!name) return;
  state.restricted = kits[name] || [];
  renderRestricted();
  toast('Kit loaded');
});
els.btnDeleteKit.addEventListener('click', () => {
  const kits = loadKits();
  const name = els.kitSelect.value; if (!name) return;
  delete kits[name];
  saveKits(kits);
  loadKits();
  toast('Kit deleted');
});
loadKits();

/* -------------------- Stage 4: Manual Mix (single rule) -------------------- */
function renderReplaceSrc() {
  els.replaceSrc.innerHTML = '';
  state.origPalette.forEach(hex => {
    const opt = document.createElement('option');
    opt.value = hex; opt.textContent = hex;
    els.replaceSrc.appendChild(opt);
  });
  if (state.origPalette.length && !state.mixRule.srcHex) {
    state.mixRule.srcHex = state.origPalette[0];
  }
  if (state.mixRule.srcHex) els.replaceSrc.value = state.mixRule.srcHex;
}
els.replaceSrc.addEventListener('change', () => {
  state.mixRule.srcHex = els.replaceSrc.value;
});
els.blockSize.addEventListener('change', () => {
  state.mixRule.block = Math.max(2, Math.min(64, +els.blockSize.value || 6));
});

function addMixRow(hex = null, density = 0) {
  const frag = document.importNode(els.tplMixRow.content, true);
  const row = frag.querySelector('.mix-row');
  const sel = frag.querySelector('.mix-ink-select');
  const rng = frag.querySelector('.mix-ink-range');
  const val = frag.querySelector('.mix-ink-val');
  const del = frag.querySelector('.mix-ink-remove');

  // populate options from enabled restricted inks
  const enabled = state.restricted.filter(r => r.enabled).map(r => r.hex);
  enabled.forEach(h => {
    const o = document.createElement('option');
    o.value = h; o.textContent = h;
    sel.appendChild(o);
  });
  if (hex && enabled.includes(hex)) sel.value = hex;

  rng.value = density;
  val.textContent = `${density}%`;
  rng.addEventListener('input', () => { val.textContent = `${rng.value}%`; updateMixTotal(); });
  del.addEventListener('click', () => { row.remove(); updateMixTotal(); });

  els.mixInks.appendChild(row);
  updateMixTotal();
}
function getMixInksFromUI() {
  const rows = [...els.mixInks.querySelectorAll('.mix-row')];
  return rows.map(r => ({
    hex: r.querySelector('.mix-ink-select').value,
    density: +r.querySelector('.mix-ink-range').value,
  }));
}
function updateMixTotal() {
  const tot = getMixInksFromUI().reduce((s, i) => s + (i.density || 0), 0);
  els.mixTotal.textContent = `Total: ${tot}%`;
}
els.btnAddMixInk.addEventListener('click', () => {
  if (els.mixInks.querySelectorAll('.mix-row').length >= 3) return toast('Max 3 inks', 'danger');
  addMixRow();
});
els.btnClearMix.addEventListener('click', () => {
  els.mixInks.innerHTML = ''; updateMixTotal();
});
// start with one row
addMixRow();

els.btnPreviewMix.addEventListener('click', () => {
  if (!state.mixRule.srcHex) state.mixRule.srcHex = els.replaceSrc.value;
  const inks = getMixInksFromUI().filter(i => i.density > 0);
  if (inks.length < 2) return toast('Choose 2–3 inks with densities', 'danger');
  const tot = inks.reduce((s, i) => s + i.density, 0);
  if (tot !== 100) return toast('Densities must total 100%', 'danger');

  state.mixRule.inks = inks;
  state.mixRule.block = Math.max(2, Math.min(64, +els.blockSize.value || 6));

  const ctx = els.mixPreview.getContext('2d');
  ctx.clearRect(0, 0, els.mixPreview.width, els.mixPreview.height);
  const tile = buildDotTile(state.mixRule.block, inks);
  // tile fill
  for (let y = 0; y < els.mixPreview.height; y += tile.height) {
    for (let x = 0; x < els.mixPreview.width; x += tile.width) {
      ctx.putImageData(tile, x, y);
    }
  }
  toast('Mix preview updated');
});

function buildDotTile(b, inks) {
  const tile = new ImageData(b, b);
  const cells = b * b;
  // counts per ink
  const counts = inks.map(i => Math.round(cells * (i.density / 100)));
  let sum = counts.reduce((s, v) => s + v, 0);
  while (sum > cells) { // trim overflow
    const idx = counts.indexOf(Math.max(...counts));
    counts[idx]--; sum--;
  }
  // pseudo-random positions (stable)
  const positions = [];
  for (let y = 0; y < b; y++) for (let x = 0; x < b; x++) positions.push({ x, y });
  positions.sort((p, q) => ((p.x * 73856093) ^ (p.y * 19349663)) - ((q.x * 73856093) ^ (q.y * 19349663)));

  let pos = 0;
  for (let i = 0; i < inks.length; i++) {
    const c = hexToRgb(inks[i].hex);
    for (let k = 0; k < counts[i]; k++) {
      if (pos >= positions.length) break;
      const { x, y } = positions[pos++];
      const idx = (y * tile.width + x) * 4;
      tile.data[idx + 0] = c.r;
      tile.data[idx + 1] = c.g;
      tile.data[idx + 2] = c.b;
      tile.data[idx + 3] = 255;
    }
  }
  return tile;
}

/* -------------------- Stage 5: Mapping -------------------- */
els.btnMap.addEventListener('click', mapToPalette);

function buildEnabledInks() {
  const arr = state.restricted.filter(r => r.enabled).map(r => r.hex);
  if (state.allowWhite && !arr.includes('#FFFFFF')) arr.push('#FFFFFF');
  return arr.slice(0, 10);
}

function mapToPalette() {
  if (!state.srcW) return toast('Load an image first', 'danger');
  const enabled = buildEnabledInks();
  if (enabled.length === 0) return toast('Enable at least one ink', 'danger');

  const src = srcCtx.getImageData(0, 0, els.srcCanvas.width, els.srcCanvas.height);
  const out = new ImageData(src.width, src.height);

  const wL = +els.wL.value || 1.0;
  const wC = +els.wC.value || 1.0;
  const useDither = !!els.dither.checked;

  // Precompute ink labs
  const inkLabs = enabled.map(hex => {
    const { r, g, b } = hexToRgb(hex);
    return { hex, rgb: { r, g, b }, lab: rgb2lab(r, g, b) };
  });

  // Manual mix tile (applies where nearest ORIGINAL equals srcHex)
  let mixTile = null, block = state.mixRule.block || 6;
  const hasMix = !!(state.mixRule.srcHex && state.mixRule.inks && state.mixRule.inks.length >= 2);
  if (hasMix) {
    mixTile = buildDotTile(block, state.mixRule.inks);
  }

  // Error buffers for FS dithering
  const err = useDither ? new Float32Array(src.width * src.height * 3) : null;

  els.mapProgress.hidden = false; els.mapProgressLabel.textContent = 'Processing…';
  status('Mapping…');
  const t0 = performance.now();

  // Simple homogeneity threshold to preserve flat palette areas
  // If a pixel is within tiny ΔE of any enabled ink, snap directly (reduces stray dots)
  const SNAP_E2 = 1.2; // tiny threshold

  for (let y = 0; y < src.height; y++) {
    for (let x = 0; x < src.width; x++) {
      const idx = (y * src.width + x);
      const i4 = idx * 4;
      let r = src.data[i4], g = src.data[i4 + 1], b = src.data[i4 + 2], a = src.data[i4 + 3];
      if (a < 10) { out.data.set([0, 0, 0, 0], i4); continue; }

      if (useDither) {
        r = clamp(r + err[idx * 3 + 0], 0, 255);
        g = clamp(g + err[idx * 3 + 1], 0, 255);
        b = clamp(b + err[idx * 3 + 2], 0, 255);
      }

      const lab = rgb2lab(r, g, b);

      // If manual mix applies: detect nearest original palette color by RGB euclidean
      let usedMix = false;
      if (hasMix) {
        let bestHex = null, bestD = 1e18;
        for (const oh of state.origPalette) {
          const c = hexToRgb(oh);
          const d = (r - c.r) ** 2 + (g - c.g) ** 2 + (b - c.b) ** 2;
          if (d < bestD) { bestD = d; bestHex = oh; }
        }
        if (bestHex === state.mixRule.srcHex) {
          const mx = x % block, my = y % block;
          const mi = (my * mixTile.width + mx) * 4;
          const mr = mixTile.data[mi + 0], mg = mixTile.data[mi + 1], mb = mixTile.data[mi + 2], ma = mixTile.data[mi + 3];
          if (ma === 255) {
            out.data[i4 + 0] = mr; out.data[i4 + 1] = mg; out.data[i4 + 2] = mb; out.data[i4 + 3] = a; // preserve alpha
            if (useDither) {
              const er = r - mr, eg = g - mg, eb = b - mb;
              fsPropagate(err, src.width, x, y, er, eg, eb);
            }
            usedMix = true;
          }
        }
      }
      if (usedMix) continue;

      // Snap to ink if extremely close
      let chosen = null, bestE = 1e18;
      for (const ink of inkLabs) {
        const e2 = deltaE2(lab, ink.lab, wL, wC);
        if (e2 < bestE) { bestE = e2; chosen = ink; }
        if (e2 < SNAP_E2) { chosen = ink; bestE = e2; break; }
      }

      out.data[i4 + 0] = chosen.rgb.r;
      out.data[i4 + 1] = chosen.rgb.g;
      out.data[i4 + 2] = chosen.rgb.b;
      out.data[i4 + 3] = a; // preserve alpha

      if (useDither) {
        const er = r - chosen.rgb.r;
        const eg = g - chosen.rgb.g;
        const eb = b - chosen.rgb.b;
        fsPropagate(err, src.width, x, y, er, eg, eb);
      }
    }
    if (y % 64 === 0) els.mapProgressLabel.textContent = `Processing… ${Math.round((y / src.height) * 100)}%`;
  }

  if (els.sharpen.checked) {
    unsharp(out);
  }

  outCtx.putImageData(out, 0, 0);
  state.mappedImageData = out;

  const ms = Math.round(performance.now() - t0);
  els.mapProgress.hidden = true;
  status(`Mapping complete in ${ms} ms`);
  toast('Mapping complete');
}

function fsPropagate(buf, width, x, y, er, eg, eb) {
  // Floyd–Steinberg diffusion
  function add(xx, yy, mul) {
    if (xx < 0 || yy < 0 || xx >= width) return;
    const i = (yy * width + xx) * 3;
    buf[i + 0] += er * mul;
    buf[i + 1] += eg * mul;
    buf[i + 2] += eb * mul;
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
  // box blur 3x3
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

/* -------------------- Stage 6: Export -------------------- */
els.btnExportPNG.addEventListener('click', exportPNG);
els.btnExportSVG.addEventListener('click', exportSVG);

function exportPNG() {
  if (!state.mappedImageData) return toast('Map first', 'danger');
  const scale = +els.exportScale.value || 1;
  const transparent = !!els.exportTransparent.checked;
  const w = state.mappedImageData.width * scale;
  const h = state.mappedImageData.height * scale;

  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const cx = c.getContext('2d');
  cx.imageSmoothingEnabled = false;

  // base
  if (!transparent) {
    cx.fillStyle = '#FFFFFF';
    cx.fillRect(0, 0, w, h);
  }
  // draw scaled
  const tmp = document.createElement('canvas');
  tmp.width = state.mappedImageData.width;
  tmp.height = state.mappedImageData.height;
  tmp.getContext('2d').putImageData(state.mappedImageData, 0, 0);
  cx.drawImage(tmp, 0, 0, w, h);

  c.toBlob((blob) => {
    const url = URL.createObjectURL(blob);
    els.downloadLink.href = url;
    els.downloadLink.download = 'cup-mapper.png';
    els.downloadLink.style.display = 'inline-flex';
    els.downloadLink.textContent = 'Download PNG';
    toast('PNG ready');
  }, 'image/png');
}

function exportSVG() {
  if (!state.mappedImageData) return toast('Map first', 'danger');
  const { width, height, data } = state.mappedImageData;
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" shape-rendering="crispEdges">`;
  for (let y = 0; y < height; y++) {
    const rowStart = y * width * 4;
    for (let x = 0; x < width; x++) {
      const i = rowStart + x * 4;
      const a = data[i + 3]; if (a < 10) continue;
      const hex = rgbToHex(data[i], data[i + 1], data[i + 2]);
      svg += `<rect x="${x}" y="${y}" width="1" height="1" fill="${hex}"/>`;
    }
  }
  svg += `</svg>`;
  const blob = new Blob([svg], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  els.downloadLink.href = url;
  els.downloadLink.download = 'cup-mapper.svg';
  els.downloadLink.style.display = 'inline-flex';
  els.downloadLink.textContent = 'Download SVG';
  toast('SVG ready');
}

/* -------------------- Stage 7: Projects -------------------- */
function listProjects() {
  const arr = JSON.parse(localStorage.getItem(PROJ_KEY) || '[]');
  els.projectSelect.innerHTML = '';
  arr.forEach((p, idx) => {
    const opt = document.createElement('option');
    opt.value = String(idx);
    const when = new Date(p.ts).toLocaleString();
    opt.textContent = `${p.name} — ${when}`;
    els.projectSelect.appendChild(opt);
  });
  return arr;
}
function saveProjects(arr) {
  localStorage.setItem(PROJ_KEY, JSON.stringify(arr));
}
listProjects();

els.btnSaveProject.addEventListener('click', () => {
  if (!state.srcW) return toast('Load an image first', 'danger');
  const name = prompt('Project name?') || 'Untitled';
  const srcDataURL = els.srcCanvas.toDataURL('image/png');

  const proj = {
    name, ts: Date.now(),
    srcDataURL,
    origPalette: state.origPalette,
    restricted: state.restricted,
    allowWhite: state.allowWhite,
    mixRule: state.mixRule,
    settings: {
      wL: +els.wL.value, wC: +els.wC.value, dither: !!els.dither.checked, sharpen: !!els.sharpen.checked
    }
  };
  const arr = listProjects();
  arr.unshift(proj);
  saveProjects(arr);
  listProjects();
  toast('Project saved');
});

els.btnLoadProject.addEventListener('click', () => {
  const arr = listProjects();
  const idx = +els.projectSelect.value;
  if (Number.isNaN(idx)) return;
  const p = arr[idx]; if (!p) return;
  const img = new Image();
  img.onload = () => {
    drawToSrc(img);
    state.origPalette = p.origPalette || [];
    state.restricted = p.restricted || [];
    state.allowWhite = !!p.allowWhite;
    els.allowWhite.checked = state.allowWhite;
    state.mixRule = p.mixRule || { srcHex: null, inks: [], block: 6 };
    els.wL.value = p.settings?.wL ?? 1.0;
    els.wC.value = p.settings?.wC ?? 1.0;
    els.dither.checked = !!(p.settings?.dither);
    els.sharpen.checked = !!(p.settings?.sharpen);
    renderOrigPalette(); renderRestricted(); renderReplaceSrc();
    toast('Project loaded — click “Apply mapping” to render');
  };
  img.src = p.srcDataURL;
});

els.btnDeleteProject.addEventListener('click', () => {
  const arr = listProjects();
  const idx = +els.projectSelect.value;
  if (Number.isNaN(idx)) return;
  if (!confirm('Delete selected project?')) return;
  arr.splice(idx, 1);
  saveProjects(arr);
  listProjects();
  toast('Project deleted');
});

/* -------------------- Modals & Misc -------------------- */
els.btnOpenHelp.addEventListener('click', () => els.dlgHelp.showModal());
els.btnOpenAbout.addEventListener('click', () => els.dlgAbout.showModal());
els.btnCloseHelp.addEventListener('click', () => els.dlgHelp.close());
els.btnCloseAbout.addEventListener('click', () => els.dlgAbout.close());

/* -------------------- Init -------------------- */
status('Ready. Load an image or use “Load sample”.');
