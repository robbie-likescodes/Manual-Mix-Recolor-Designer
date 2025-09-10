/* ==========================================================
   Cup Mapper — app.js  (export quality tweaks)
   ========================================================== */

/* ...everything above is identical to your last working file... */

/* -------------------- Stage 6: Export (full-res remap before save) -------------------- */
els.btnExportPNG.addEventListener('click', exportPNG);
els.btnExportSVG.addEventListener('click', exportSVG);

// Small helper to show/hide the existing progress pill during export too
function beginBusy(label = 'Processing…') {
  els.mapProgressLabel.textContent = label;
  els.mapProgress.classList.remove('hidden');
  els.btnExportPNG.disabled = true;
  els.btnExportSVG.disabled = true;
  els.btnMap.disabled = true;
}
function endBusy() {
  els.mapProgress.classList.add('hidden');
  els.btnExportPNG.disabled = false;
  els.btnExportSVG.disabled = false;
  els.btnMap.disabled = false;
}

// Typical safe canvas limits across browsers (very conservative)
const MAX_DIM   = 16384;        // clamp per-axis dimension
const MAX_PIXELS = 268_000_000; // ~268 MP area cap

function ensureFullResMap(cb){
  let enabled=buildEnabledInks();
  if (enabled.length===0){
    enabled = state.origPalette.slice(0, Math.min(10, state.origPalette.length));
    state.restricted = enabled.map(h => ({hex:h, enabled:true}));
    renderRestricted(true);
  }

  const paramsHashFull = currentParamsHash(1);
  const upToDate = state.mappedImageData &&
                   state.lastPreview.paramsHash === paramsHashFull &&
                   state.lastPreview.previewScale === 1 &&
                   state.mappedImageData.width === state.srcW &&
                   state.mappedImageData.height === state.srcH;

  if (upToDate) return cb(state.mappedImageData);

  beginBusy('Building export…');

  const { imageData, width, height } = getScaledSrcImageData(1);
  const wL = +els.wL.value || 1.0;
  const wC = +els.wC.value || 1.0;
  const dither = !!els.dither.checked;
  const doSharpen = !!els.sharpen.checked;
  const snapE2 = 1.2;

  const inkLabs = buildEnabledInks().map(hex => {
    const { r, g, b } = hexToRgb(hex);
    return { hex, rgb:{r,g,b}, lab: rgb2lab(r,g,b) };
  });

  const hasMix  = !!(state.mixRule.srcHex && state.mixRule.inks && state.mixRule.inks.length >= 2);
  const block   = Math.max(2, Math.min(64, state.mixRule.block || 6));
  const cellSize= Math.max(1, state.mixRule.cellSize || 1);
  const fullBlock = block * cellSize;
  const mixTile = hasMix ? buildMixTile(block, state.mixRule.inks, state.mixRule.pattern || 'blue', cellSize) : null;

  const pr    = state.patternRule.enabled && state.patternRule.srcHex ? { ...state.patternRule } : null;
  const prTile= pr ? buildPatternTile(pr) : null;

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

      // nearest original for 4a/4b
      let nearestOrig = null;
      if ((pr && state.origPalette.length) || (hasMix && state.origPalette.length)) {
        let bestHex = null, bestD = 1e18;
        for (const oh of state.origPalette) {
          const c = hexToRgb(oh);
          const d2 = (r - c.r) ** 2 + (g - c.g) ** 2 + (b - c.b) ** 2;
          if (d2 < bestD) { bestD = d2; bestHex = oh; }
        }
        nearestOrig = bestHex;
      }

      // 4b
      if (pr && sameHex(nearestOrig, pr.srcHex)) {
        const cell = Math.max(2, pr.cell|0);
        const sx = pr.stagger && (Math.floor(y / cell) % 2 === 1) ? ((x + Math.floor(cell/2)) % cell) : (x % cell);
        const sy = y % cell;
        const pi = (sy * prTile.width + sx) * 4;
        out.data[i4 + 0] = prTile.data[pi + 0];
        out.data[i4 + 1] = prTile.data[pi + 1];
        out.data[i4 + 2] = prTile.data[pi + 2];
        out.data[i4 + 3] = a;
        if (dither) {
          const er = r - prTile.data[pi + 0];
          const eg = g - prTile.data[pi + 1];
          const eb = b - prTile.data[pi + 2];
          fsPropagate(err, width, x, y, er, eg, eb);
        }
        continue;
      }

      // 4a
      if (hasMix && sameHex(nearestOrig, state.mixRule.srcHex)) {
        const mx = x % fullBlock, my = y % fullBlock;
        const mi = (my * mixTile.width + mx) * 4;
        out.data[i4 + 0] = mixTile.data[mi + 0];
        out.data[i4 + 1] = mixTile.data[mi + 1];
        out.data[i4 + 2] = mixTile.data[mi + 2];
        out.data[i4 + 3] = a;
        if (dither) {
          const er = r - mixTile.data[mi + 0];
          const eg = g - mixTile.data[mi + 1];
          const eb = b - mixTile.data[mi + 2];
          fsPropagate(err, width, x, y, er, eg, eb);
        }
        continue;
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
  endBusy();
  cb(out);
}

/* ------ NEW: fast + memory-safe tiled upscaler for PNG ------ */
async function drawScaledTiled(dstCtx, srcImgData, scale, onProgress) {
  const sw = srcImgData.width, sh = srcImgData.height;
  const tile = 512; // tile size in source pixels (keeps temp memory tiny)
  dstCtx.imageSmoothingEnabled = false;

  // Use createImageBitmap when available (faster & lean)
  const canBitmap = 'createImageBitmap' in window;

  for (let sy = 0; sy < sh; sy += tile) {
    const shh = Math.min(tile, sh - sy);
    for (let sx = 0; sx < sw; sx += tile) {
      const sww = Math.min(tile, sw - sx);

      if (canBitmap) {
        // Crop directly from ImageData without making a big temp canvas
        const bmp = await createImageBitmap(srcImgData, sx, sy, sww, shh);
        dstCtx.drawImage(bmp, sx * scale, sy * scale, sww * scale, shh * scale);
        bmp.close?.();
      } else {
        // Fallback: tiny temp canvas for this tile only
        const t = document.createElement('canvas');
        t.width = sww; t.height = shh;
        const tctx = t.getContext('2d', { willReadFrequently: true });
        const part = new ImageData(
          srcImgData.data.slice((sy * sw + sx) * 4, (sy * sw + sx) * 4 + shh * sw * 4),
          sw, shh
        );
        // putImageData can't offset into the slice horizontally, so copy row-by-row:
        const row = new ImageData(sww, 1);
        for (let y = 0; y < shh; y++) {
          const off = (y * sw + sx) * 4;
          row.data.set(srcImgData.data.slice(off, off + sww * 4));
          tctx.putImageData(row, 0, y);
        }
        dstCtx.drawImage(t, sx * scale, sy * scale, sww * scale, shh * scale);
      }
    }
    onProgress?.(Math.round((sy + shh) / sh * 100));
    // Yield to UI
    await new Promise(r => setTimeout(r, 0));
  }
}

function clampExportScale(w, h, desiredScale) {
  let scale = Math.max(1, Math.floor(desiredScale));
  // Per-axis clamp
  scale = Math.min(scale, Math.floor(MAX_DIM / Math.max(1, w)));
  scale = Math.min(scale, Math.floor(MAX_DIM / Math.max(1, h)));
  // Area clamp
  while ((w * scale) * (h * scale) > MAX_PIXELS && scale > 1) scale--;
  return Math.max(1, scale);
}

function exportPNG(){
  if(!state.srcW) return toast('Load an image first','danger');

  ensureFullResMap(async (fullImg)=>{
    let scale = +els.exportScale.value || 1;
    const transparent = !!els.exportTransparent.checked;

    // Safety clamp to the largest sane size the browser can handle
    const safeScale = clampExportScale(fullImg.width, fullImg.height, scale);
    if (safeScale < scale) {
      toast(`Scale clamped to ${safeScale}× for browser limits`, 'danger');
      scale = safeScale;
      els.exportScale.value = String(scale);
    }

    const outW = fullImg.width * scale;
    const outH = fullImg.height * scale;

    beginBusy('Exporting PNG…');

    // Create destination canvas
    const c = document.createElement('canvas');
    c.width = outW; c.height = outH;
    const cx = c.getContext('2d');
    cx.imageSmoothingEnabled = false;

    // Optional white background
    if (!transparent) { cx.fillStyle = '#FFFFFF'; cx.fillRect(0, 0, outW, outH); }

    // Tiled, nearest-neighbour exact scale
    try {
      await drawScaledTiled(cx, fullImg, scale, (p)=> {
        els.mapProgressLabel.textContent = `Exporting PNG… ${p}%`;
      });
    } catch (e) {
      // Fallback to one-shot draw if tiling fails (still nearest-neighbour)
      const tmp = document.createElement('canvas');
      tmp.width = fullImg.width; tmp.height = fullImg.height;
      tmp.getContext('2d').putImageData(fullImg, 0, 0);
      cx.drawImage(tmp, 0, 0, outW, outH);
    }

    c.toBlob((blob)=>{
      endBusy();
      if(!blob){ toast('PNG export failed', 'danger'); return; }
      const url = URL.createObjectURL(blob);
      els.downloadLink.href = url;
      els.downloadLink.download = 'cup-mapper.png';
      els.downloadLink.style.display = 'inline-flex';
      els.downloadLink.textContent = 'Download PNG';
      toast('PNG ready');
    }, 'image/png');
  });
}

function exportSVG(){
  if(!state.srcW) return toast('Load an image first','danger');
  ensureFullResMap((img)=>{
    beginBusy('Exporting SVG…');
    const {width,height,data}=img;
    let svg=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" shape-rendering="crispEdges">`;
    for(let y=0;y<height;y++){
      const row=y*width*4;
      for(let x=0;x<width;x++){
        const i=row+x*4; const a=data[i+3]; if(a<10) continue;
        const hex=rgbToHex(data[i],data[i+1],data[i+2]);
        svg+=`<rect x="${x}" y="${y}" width="1" height="1" fill="${hex}"/>`;
      }
      if (y % 128 === 0) els.mapProgressLabel.textContent = `Exporting SVG… ${Math.round((y/height)*100)}%`;
    }
    svg+=`</svg>`;
    const blob=new Blob([svg],{type:'image/svg+xml'});
    const url=URL.createObjectURL(blob);
    els.downloadLink.href=url; els.downloadLink.download='cup-mapper.svg';
    els.downloadLink.style.display='inline-flex'; els.downloadLink.textContent='Download SVG';
    endBusy();
    toast('SVG ready');
  });
}

/* -------------------- Stage 7 & Modals (unchanged) -------------------- */
/* ...rest of your file remains the same... */
