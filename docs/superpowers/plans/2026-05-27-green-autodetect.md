# Green Auto-Detection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the manual vertex-by-vertex green polygon drawing with a single seed click that auto-detects the green boundary from Esri satellite tile pixels, presents a tolerance slider and draggable vertex handles for correction, then feeds the result into the existing Review & Push pipeline.

**Architecture:** All logic lives in `course-mapper.html` (single-file vanilla JS). The detection pipeline is a chain of pure functions: tile coordinate maths → tile image fetch → flood-fill → boundary trace → RDP simplify → pixel-to-lat/lng. The draw bar is repurposed with three states (awaiting-seed / detected / vertex-edit) controlled by `setDrawBarState()`. Existing `finishDrawGreen()`, `greenPolygons`, and the Review & Push panel are unchanged.

**Tech Stack:** Vanilla JS, Leaflet.js, Esri World Imagery tiles (CORS-enabled), HTML Canvas API.

---

## File Map

| File | Change |
|---|---|
| `course-mapper.html` | All changes — 8 tasks, all additions except small modifications to `startDrawGreen`, `_exitDrawMode`, `updateDrawBar`, map click/dblclick/keydown handlers, and `_addVertMarker` |

---

## Task 1: Tile coordinate utilities

**Files:**
- Modify: `course-mapper.html` — add after the `// ── Green polygon utilities` comment block (around line 273)

These are pure functions with no side effects. Test each in the browser console before moving on.

- [ ] **Step 1: Add the three utility functions**

Find the line in `course-mapper.html`:
```javascript
// ── Green polygon utilities ──────────────────────────────────────────────
function haversineM(lat1,lng1,lat2,lng2){
```

Add the three new functions immediately before it:

```javascript
// ── Auto-detect tile coordinate utilities ────────────────────────────────

/**
 * Convert a lat/lng to Esri/OSM tile XY at the given zoom.
 */
function latLngToTile(lat, lng, zoom) {
  const n = Math.pow(2, zoom);
  const tileX = Math.floor((lng + 180) / 360 * n);
  const tileY = Math.floor(
    (1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI)
    / 2 * n
  );
  return { tileX, tileY };
}

/**
 * Convert a lat/lng to pixel coordinates within a 512×512 canvas that
 * covers a 2×2 block of tiles starting at (tileX, tileY) at `zoom`.
 */
function latLngToCanvasPixel(lat, lng, tileX, tileY, zoom) {
  const n = Math.pow(2, zoom);
  const fracX = (lng + 180) / 360 * n - tileX;
  const fracY =
    (1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI)
    / 2 * n - tileY;
  return { px: Math.round(fracX * 256), py: Math.round(fracY * 256) };
}

/**
 * Convert a pixel position in the 512×512 canvas back to lat/lng.
 * Canvas covers tiles (tileX, tileY) to (tileX+1, tileY+1) at `zoom`.
 */
function canvasPixelToLatLng(px, py, tileX, tileY, zoom) {
  const n = Math.pow(2, zoom);
  const tileXFrac = tileX + px / 256;
  const tileYFrac = tileY + py / 256;
  const lng = tileXFrac / n * 360 - 180;
  const latRad = Math.atan(Math.sinh(Math.PI * (1 - 2 * tileYFrac / n)));
  return [latRad * 180 / Math.PI, lng];
}
```

- [ ] **Step 2: Verify in browser console**

Open `course-mapper.html` in a browser. Open DevTools → Console. Run:

```javascript
// Hole 1 tee is approximately lat 55.6379, lng 12.5707
const t = latLngToTile(55.6379, 12.5707, 20);
console.log(t); // expect tileX ~559xxx, tileY ~324xxx

const {px, py} = latLngToCanvasPixel(55.6379, 12.5707, t.tileX, t.tileY, 20);
console.log(px, py); // expect 0-511 each

const [lat2, lng2] = canvasPixelToLatLng(px, py, t.tileX, t.tileY, 20);
console.log(Math.abs(lat2 - 55.6379) < 0.0001, Math.abs(lng2 - 12.5707) < 0.0001);
// expect: true true  (round-trip within ~10m)
```

- [ ] **Step 3: Commit**

```bash
git add course-mapper.html
git commit -m "feat(autodetect): add tile coordinate utility functions"
```

---

## Task 2: fetchTileCanvas

**Files:**
- Modify: `course-mapper.html` — add after the three functions from Task 1

Fetch a 2×2 block of Esri tiles and stitch them into a 512×512 offscreen canvas.

- [ ] **Step 1: Add `fetchTileCanvas`**

Add immediately after the `canvasPixelToLatLng` function:

```javascript
/**
 * Fetch a 2×2 block of Esri World Imagery tiles at zoom 20 starting at
 * (tileX, tileY). Returns a 512×512 HTMLCanvasElement.
 * Throws if any tile fails to load (CORS or network error).
 */
async function fetchTileCanvas(tileX, tileY) {
  const ZOOM = 20;
  const coords = [
    [tileX,   tileY  ],
    [tileX+1, tileY  ],
    [tileX,   tileY+1],
    [tileX+1, tileY+1],
  ];
  const imgs = await Promise.all(coords.map(([tx, ty]) =>
    new Promise((res, rej) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => res(img);
      img.onerror = () => rej(new Error(`Tile load failed: ${ZOOM}/${ty}/${tx}`));
      img.src = `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${ZOOM}/${ty}/${tx}`;
    })
  ));
  const canvas = document.createElement('canvas');
  canvas.width = 512; canvas.height = 512;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(imgs[0],   0,   0);
  ctx.drawImage(imgs[1], 256,   0);
  ctx.drawImage(imgs[2],   0, 256);
  ctx.drawImage(imgs[3], 256, 256);
  return canvas;
}
```

- [ ] **Step 2: Verify in browser console**

```javascript
const {tileX, tileY} = latLngToTile(55.6379, 12.5707, 20);
fetchTileCanvas(tileX, tileY).then(c => {
  document.body.appendChild(c);  // should show a 512×512 satellite image patch
  console.log('canvas size:', c.width, c.height);  // 512 512
});
```

You should see a small satellite image appear at the bottom of the page showing the course area. Remove it afterwards: `document.body.removeChild(document.querySelector('canvas'))`.

- [ ] **Step 3: Commit**

```bash
git add course-mapper.html
git commit -m "feat(autodetect): add fetchTileCanvas — fetch and stitch 2x2 Esri tiles"
```

---

## Task 3: floodFill

**Files:**
- Modify: `course-mapper.html` — add after `fetchTileCanvas`

BFS flood-fill starting from a seed pixel. Returns a `Uint8Array` (filled flags) or `null` if the fill hit the cap.

- [ ] **Step 1: Add `floodFill`**

```javascript
/**
 * BFS flood-fill on `imageData` from seed pixel (seedPx, seedPy).
 * Includes neighbours whose RGB distance from seed colour ≤ tolerance.
 * Returns Uint8Array of length w*h (1=filled, 0=not) or null if > 200×200
 * pixels were filled (runaway fill).
 */
function floodFill(imageData, seedPx, seedPy, w, h, tolerance) {
  const d = imageData.data;
  const si = (seedPy * w + seedPx) * 4;
  const r0 = d[si], g0 = d[si+1], b0 = d[si+2];

  const filled = new Uint8Array(w * h);
  const queue = [[seedPx, seedPy]];
  filled[seedPy * w + seedPx] = 1;
  let count = 0;
  const CAP = 200 * 200;

  while (queue.length && count < CAP) {
    const [x, y] = queue.shift();
    count++;
    for (const [dx, dy] of [[-1,0],[1,0],[0,-1],[0,1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
      if (filled[ny * w + nx]) continue;
      const ni = (ny * w + nx) * 4;
      const dr = d[ni]-r0, dg = d[ni+1]-g0, db = d[ni+2]-b0;
      if (Math.sqrt(dr*dr + dg*dg + db*db) <= tolerance) {
        filled[ny * w + nx] = 1;
        queue.push([nx, ny]);
      }
    }
  }
  return count >= CAP ? null : filled;
}
```

- [ ] **Step 2: Verify in browser console**

```javascript
// Create a simple 10×10 test canvas: green square in the middle
const c = document.createElement('canvas'); c.width=10; c.height=10;
const ctx = c.getContext('2d');
ctx.fillStyle = '#4a4'; ctx.fillRect(3,3,4,4);  // 4×4 green square at (3,3)
ctx.fillStyle = '#aaa'; ctx.fillRect(0,0,3,10); // grey border

const idata = ctx.getImageData(0,0,10,10);
const result = floodFill(idata, 5, 5, 10, 10, 40);

// Count filled pixels — expect 16 (4×4 square)
let n = 0; for(let i=0;i<100;i++) if(result[i]) n++;
console.log('filled pixels:', n); // should be ~16

// Verify null on runaway (tiny tolerance, large canvas)
const big = document.createElement('canvas'); big.width=512; big.height=512;
const bc = big.getContext('2d');
bc.fillStyle='#4a4'; bc.fillRect(0,0,512,512);
const bi = bc.getImageData(0,0,512,512);
console.log('runaway:', floodFill(bi, 256, 256, 512, 512, 80)); // null
```

- [ ] **Step 3: Commit**

```bash
git add course-mapper.html
git commit -m "feat(autodetect): add floodFill — BFS colour-tolerance region growing"
```

---

## Task 4: traceBoundary + rdpSimplify

**Files:**
- Modify: `course-mapper.html` — add after `floodFill`

Extract an ordered boundary from a filled region and simplify it.

- [ ] **Step 1: Add `traceBoundary`**

```javascript
/**
 * Extract an ordered boundary from a flood-fill result.
 * Collects all filled pixels that have at least one unfilled 4-neighbour,
 * then sorts them by angle from the centroid of the filled region.
 * Returns [[px,py], ...] (ordered, but not closed).
 */
function traceBoundary(filled, w, h) {
  let cx = 0, cy = 0, count = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (filled[y * w + x]) { cx += x; cy += y; count++; }
    }
  }
  if (!count) return [];
  cx /= count; cy /= count;

  const boundary = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!filled[y * w + x]) continue;
      const onEdge =
        x === 0 || x === w-1 || y === 0 || y === h-1 ||
        !filled[y*w + x-1] || !filled[y*w + x+1] ||
        !filled[(y-1)*w + x] || !filled[(y+1)*w + x];
      if (onEdge) boundary.push([x, y]);
    }
  }
  boundary.sort((a, b) =>
    Math.atan2(a[1]-cy, a[0]-cx) - Math.atan2(b[1]-cy, b[0]-cx)
  );
  return boundary;
}
```

- [ ] **Step 2: Add `rdpSimplify`**

Add immediately after `traceBoundary`:

```javascript
/**
 * Ramer-Douglas-Peucker polygon simplification.
 * `points` is [[x,y], ...], `epsilon` is max pixel deviation.
 * Returns a simplified subset of the input points.
 */
function rdpSimplify(points, epsilon) {
  if (points.length <= 2) return points;
  const [x1, y1] = points[0];
  const [x2, y2] = points[points.length - 1];
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.sqrt(dx*dx + dy*dy);
  let maxDist = 0, maxIdx = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const [px, py] = points[i];
    const dist = len === 0
      ? Math.sqrt((px-x1)**2 + (py-y1)**2)
      : Math.abs(dy*px - dx*py + x2*y1 - y2*x1) / len;
    if (dist > maxDist) { maxDist = dist; maxIdx = i; }
  }
  if (maxDist <= epsilon) return [points[0], points[points.length - 1]];
  const left  = rdpSimplify(points.slice(0, maxIdx + 1), epsilon);
  const right = rdpSimplify(points.slice(maxIdx), epsilon);
  return [...left.slice(0, -1), ...right];
}
```

- [ ] **Step 3: Verify in browser console**

```javascript
// 20-point circle boundary
const pts = Array.from({length:20}, (_,i) => {
  const a = i / 20 * Math.PI * 2;
  return [Math.round(50 + 30*Math.cos(a)), Math.round(50 + 30*Math.sin(a))];
});
const simplified = rdpSimplify(pts, 3);
console.log('original:', pts.length, '→ simplified:', simplified.length);
// expect: 20 → ~8-12 (circle is smooth so many points collapse)
```

- [ ] **Step 4: Commit**

```bash
git add course-mapper.html
git commit -m "feat(autodetect): add traceBoundary and rdpSimplify"
```

---

## Task 5: runDetectionPipeline

**Files:**
- Modify: `course-mapper.html` — add after `rdpSimplify`

Orchestrate steps 3–6 of the spec (flood-fill through pixel-to-lat/lng). Accepts a cached canvas so the slider can re-run without re-fetching.

- [ ] **Step 1: Add `runDetectionPipeline`**

```javascript
/**
 * Run the detection pipeline on a cached canvas.
 *
 * @param {HTMLCanvasElement} canvas  512×512 stitched tile canvas
 * @param {number} seedPx             seed pixel x (0-511)
 * @param {number} seedPy             seed pixel y (0-511)
 * @param {number} tileX              top-left tile X at zoom 20
 * @param {number} tileY              top-left tile Y at zoom 20
 * @param {number} tolerance          flood-fill tolerance (10-80)
 * @returns {[number,number][]|null}  array of [lat,lng] vertices, or null on failure
 */
function runDetectionPipeline(canvas, seedPx, seedPy, tileX, tileY, tolerance) {
  const ctx = canvas.getContext('2d');
  const imageData = ctx.getImageData(0, 0, 512, 512);

  // Step 3 — flood fill
  const filled = floodFill(imageData, seedPx, seedPy, 512, 512, tolerance);
  if (!filled) return null; // hit cap

  // Step 4 — boundary trace
  const boundary = traceBoundary(filled, 512, 512);
  if (!boundary.length) return null;

  // Step 5 — simplify
  const simplified = rdpSimplify(boundary, 3);
  if (simplified.length < 6) return null; // degenerate

  // Step 6 — pixel → lat/lng
  return simplified.map(([px, py]) => canvasPixelToLatLng(px, py, tileX, tileY, 20));
}
```

- [ ] **Step 2: Verify in browser console**

This function requires a real canvas from `fetchTileCanvas`. Run only if you have internet access from the console:

```javascript
const {tileX, tileY} = latLngToTile(55.6379, 12.5707, 20);
fetchTileCanvas(tileX, tileY).then(canvas => {
  // Click somewhere near the centre of the canvas for testing
  const verts = runDetectionPipeline(canvas, 128, 128, tileX, tileY, 30);
  console.log('vertices:', verts ? verts.length : 'null (failed)');
  // If the seed lands on a uniform surface: expect 6-60 vertices
  // If the seed lands on a colour boundary: may be null (degenerate)
});
```

- [ ] **Step 3: Commit**

```bash
git add course-mapper.html
git commit -m "feat(autodetect): add runDetectionPipeline — orchestrate fill→trace→simplify→latLng"
```

---

## Task 6: Draw bar states + wiring

**Files:**
- Modify: `course-mapper.html` — state variables, `setDrawBarState`, `updateDrawBar`, `startDrawGreen`, `_exitDrawMode`, map event handlers, `resetDetectMode`

This task rewires the draw mode entry point. After this task the draw bar shows the awaiting-seed prompt when entering draw mode, but clicking the map does nothing useful yet (Task 7 adds `handleDetectClick`).

- [ ] **Step 1: Add detect-mode state variables**

Find the existing draw state variables (around line 554):
```javascript
// Green polygon drawing state
let drawingGreen    = null;  // hole number 1-18, or null
let drawVerts       = [];    // [[lat,lng], ...]
let drawVertMarkers = [];    // L.circleMarker per vertex
let drawPolyLayer   = null;  // live preview L.polygon
let polyLayers      = {};    // saved polygon layers: {holeNum: L.polygon}
```

Add immediately after those lines:

```javascript
// Auto-detect state
let detectMode      = false;   // true = awaiting seed click or showing result
let detectCanvas    = null;    // cached 512×512 tile canvas
let detectTileX     = null;    // top-left tile X of cached canvas (zoom 20)
let detectTileY     = null;    // top-left tile Y of cached canvas (zoom 20)
let detectSeedPx    = null;    // seed pixel x within canvas
let detectSeedPy    = null;    // seed pixel y within canvas
let detectTolerance = 30;      // current slider value (10-80)
let detectBarState  = null;    // 'awaiting-seed'|'detected'|'vertex-edit'|'error'|null
```

- [ ] **Step 2: Add `setDrawBarState`**

Find `function updateDrawBar()` (around line 755). Add the new function immediately **before** it:

```javascript
function setDrawBarState(state, errorMsg) {
  detectBarState = state;
  const bar = document.getElementById('drawBar');
  const btn = s => `style="padding:5px 12px;border-radius:5px;border:none;font-size:12px;font-weight:700;cursor:pointer;${s}"`;
  if (state === 'awaiting-seed') {
    bar.innerHTML =
      `<span style="color:#2ecc71;font-weight:600">🎯 Click on the green to detect its boundary</span>` +
      `<button onclick="cancelDrawGreen()" ${btn('background:#e94560;color:#fff')}>✕ Cancel</button>`;
  } else if (state === 'detected') {
    bar.innerHTML =
      `<span style="font-size:11px;color:#aaa">Tight</span>` +
      `<input type="range" id="detectSlider" min="10" max="80" value="${detectTolerance}"` +
      ` style="width:90px;cursor:pointer;accent-color:#2ecc71" oninput="setDetectTolerance(+this.value)">` +
      `<span style="font-size:11px;color:#aaa">Loose</span>` +
      `<button onclick="finishDrawGreen()" ${btn('background:#2ecc71;color:#000')}>✓ Accept</button>` +
      `<button onclick="resetDetectMode()" ${btn('background:#555;color:#eee')}>↩ Re-click</button>` +
      `<button onclick="cancelDrawGreen()" ${btn('background:#e94560;color:#fff')}>✕ Cancel</button>`;
  } else if (state === 'vertex-edit') {
    const n = drawVerts.length;
    bar.innerHTML =
      `<span style="color:#2ecc71;font-weight:600">Hole ${drawingGreen} — ${n} pt${n!==1?'s':''} — drag to adjust</span>` +
      `<button onclick="finishDrawGreen()" ${n<3?'disabled ':''} ${btn('background:#2ecc71;color:#000' + (n<3?';opacity:0.5':''))}>✓ Finish</button>` +
      `<button onclick="resetDetectMode()" ${btn('background:#555;color:#eee')}>🗑 Clear</button>` +
      `<button onclick="cancelDrawGreen()" ${btn('background:#e94560;color:#fff')}>✕ Cancel</button>`;
  } else if (state === 'error') {
    bar.innerHTML =
      `<span style="color:#e74c3c;font-weight:600">⚠ ${errorMsg || 'Detection failed'}</span>` +
      `<button onclick="resetDetectMode()" ${btn('background:#555;color:#eee')}>↩ Try Again</button>` +
      `<button onclick="cancelDrawGreen()" ${btn('background:#e94560;color:#fff')}>✕ Cancel</button>`;
  }
}
```

- [ ] **Step 3: Simplify `updateDrawBar` to delegate to `setDrawBarState`**

Replace the existing `updateDrawBar` function:
```javascript
function updateDrawBar() {
  const n = drawVerts.length;
  document.getElementById('drawBarText').textContent =
    `Hole ${drawingGreen} green — ${n} point${n !== 1 ? 's' : ''}${n < 3 ? ' (need 3+)' : ' — double-click or Enter to finish'}`;
  document.getElementById('drawFinishBtn').disabled = n < 3;
}
```

With:
```javascript
function updateDrawBar() {
  setDrawBarState('vertex-edit');
}
```

- [ ] **Step 4: Add `resetDetectMode`**

Add after `updateDrawBar`:

```javascript
function resetDetectMode() {
  drawVerts = [];
  drawVertMarkers.forEach(m => m.remove()); drawVertMarkers = [];
  if (drawPolyLayer) { drawPolyLayer.remove(); drawPolyLayer = null; }
  detectCanvas = null;
  detectSeedPx = null; detectSeedPy = null;
  setDrawBarState('awaiting-seed');
}
```

- [ ] **Step 5: Modify `startDrawGreen` to enter detect mode**

Replace the existing `startDrawGreen` function:

```javascript
function startDrawGreen(hole) {
  if (pinMode) togglePinMode();
  closePanel();

  drawingGreen = hole;
  drawVerts = [];
  drawVertMarkers = [];
  drawPolyLayer = null;
  detectMode = true;
  detectCanvas = null;
  detectTolerance = 30;

  document.getElementById('map').classList.add('draw-mode');
  document.getElementById('drawBar').style.display = 'flex';
  setDrawBarState('awaiting-seed');

  // Fly to the green centre if we know it
  const gIdx = getAssignedIdx('green', hole);
  if (gIdx !== null) {
    const s = getStay(gIdx);
    map.flyTo([s.lat, s.lon], 19, { animate: true, duration: 0.6 });
  }
}
```

- [ ] **Step 6: Update `_exitDrawMode` to clear detect state**

Replace the existing `_exitDrawMode` function:

```javascript
function _exitDrawMode() {
  drawVerts = [];
  drawVertMarkers.forEach(m => m.remove()); drawVertMarkers = [];
  if (drawPolyLayer) { drawPolyLayer.remove(); drawPolyLayer = null; }
  drawingGreen = null;
  detectMode = false;
  detectCanvas = null;
  detectSeedPx = null; detectSeedPy = null;
  detectBarState = null;
  document.getElementById('map').classList.remove('draw-mode');
  document.getElementById('drawBar').style.display = 'none';
}
```

- [ ] **Step 7: Update the map click handler to route to detect vs manual**

Replace the existing `map.on('click', ...)` handler:

```javascript
map.on('click', e => {
  if (drawingGreen !== null) {
    if (detectMode && detectBarState === 'awaiting-seed') {
      handleDetectClick(e.latlng.lat, e.latlng.lng);
    } else if (!detectMode) {
      addDrawVertex(e.latlng.lat, e.latlng.lng);
    }
    // In 'detected' or 'vertex-edit' or 'error' states: ignore map clicks
  } else if (pinMode) {
    const {lat, lng} = e.latlng;
    customPins.push({ lat, lon: lng, custom: true });
    const idx = STAYS.length + customPins.length - 1;
    addMarker(customPins[customPins.length - 1], idx);
    saveAll();
    renderHoleList();
    openPanel(idx);
  } else {
    closePanel();
  }
});
```

- [ ] **Step 8: Guard dblclick and keydown against detect mode**

Replace the existing `map.on('dblclick', ...)`:

```javascript
map.on('dblclick', e => {
  if (drawingGreen !== null && !detectMode) {
    L.DomEvent.stopPropagation(e);
    if (drawVerts.length >= 3) finishDrawGreen();
  }
});
```

Replace the `Enter` line in the existing `document.addEventListener('keydown', ...)`:

```javascript
  if (e.key === 'Enter' && drawVerts.length >= 3 && !detectMode) finishDrawGreen();
```

- [ ] **Step 9: Verify in browser**

Open `course-mapper.html`. Click a hole's "○" polygon indicator. Confirm:
- Draw bar appears showing "🎯 Click on the green to detect its boundary" and "✕ Cancel"
- Clicking the map does nothing yet (no `handleDetectClick` implemented — that's Task 7)
- Pressing Escape cancels and hides the bar
- Clicking ✕ Cancel cancels and hides the bar

- [ ] **Step 10: Commit**

```bash
git add course-mapper.html
git commit -m "feat(autodetect): draw bar states, startDrawGreen detect mode, click routing"
```

---

## Task 7: handleDetectClick + setDetectTolerance

**Files:**
- Modify: `course-mapper.html` — add after `resetDetectMode`

Implement the full detection flow when the user clicks the green, and the tolerance re-run when the slider moves.

- [ ] **Step 1: Add `handleDetectClick`**

Add after `resetDetectMode`:

```javascript
async function handleDetectClick(lat, lng) {
  // Show loading state
  document.getElementById('drawBar').innerHTML =
    '<span style="color:#2ecc71;font-weight:600">⏳ Detecting green boundary…</span>';

  try {
    // Step 1 — tile coordinates
    const { tileX, tileY } = latLngToTile(lat, lng, 20);

    // Step 2 — fetch tile canvas (cache it)
    const canvas = await fetchTileCanvas(tileX, tileY);

    // Seed pixel
    const { px, py } = latLngToCanvasPixel(lat, lng, tileX, tileY, 20);
    if (px < 0 || px >= 512 || py < 0 || py >= 512) {
      setDrawBarState('error', 'Click outside tile bounds — try again');
      return;
    }

    // Cache for slider re-runs
    detectCanvas  = canvas;
    detectTileX   = tileX;
    detectTileY   = tileY;
    detectSeedPx  = px;
    detectSeedPy  = py;
    detectTolerance = 30;

    // Steps 3-6
    const verts = runDetectionPipeline(canvas, px, py, tileX, tileY, detectTolerance);
    if (!verts) {
      setDrawBarState('error', 'Detected region too large — click closer to the centre of the green');
      return;
    }
    if (verts.length < 6) {
      setDrawBarState('error', 'Detection unclear — try a different spot or adjust the slider');
      return;
    }

    // Populate drawVerts and render
    drawVerts = verts;
    drawVertMarkers.forEach(m => m.remove()); drawVertMarkers = [];
    drawVerts.forEach(([vlat, vlng]) => _addVertMarker(vlat, vlng));
    updateDrawPreview();
    setDrawBarState('detected');

  } catch (err) {
    console.error('handleDetectClick:', err);
    setDrawBarState('error', 'Could not load imagery — try zooming in and clicking again');
  }
}
```

- [ ] **Step 2: Add `setDetectTolerance`**

Add immediately after `handleDetectClick`:

```javascript
function setDetectTolerance(T) {
  detectTolerance = T;
  if (!detectCanvas) return;

  const verts = runDetectionPipeline(detectCanvas, detectSeedPx, detectSeedPy,
                                      detectTileX, detectTileY, T);
  if (!verts || verts.length < 6) {
    setDrawBarState('error', 'Detection unclear at this tolerance — adjust the slider');
    return;
  }

  drawVerts = verts;
  drawVertMarkers.forEach(m => m.remove()); drawVertMarkers = [];
  drawVerts.forEach(([vlat, vlng]) => _addVertMarker(vlat, vlng));
  updateDrawPreview();
  setDrawBarState('detected');
}
```

- [ ] **Step 3: Verify in browser**

Open `course-mapper.html` at zoom 19 over the course. Click a hole indicator to enter detect mode. Click once on the green surface.

Expected:
- "⏳ Detecting…" flashes briefly
- A polygon overlay appears on the green
- The bar shows the slider + Accept + Re-click + Cancel
- Moving the slider left (tight) shrinks the polygon; right (loose) expands it
- Pressing "✓ Accept" saves the polygon and closes the bar
- Pressing "↩ Re-click" clears the polygon and returns to "🎯 Click on the green…"

If detection fails with a CORS error: the tile server might have a rate limit on initial load. Reload and try again.

- [ ] **Step 4: Commit**

```bash
git add course-mapper.html
git commit -m "feat(autodetect): handleDetectClick and setDetectTolerance — full detection pipeline"
```

---

## Task 8: Draggable vertex markers

**Files:**
- Modify: `course-mapper.html` — replace `_addVertMarker`

Change vertex handles from `L.circleMarker` (not draggable) to `L.marker` with a custom circular icon and `draggable: true`. Dragging a handle updates `drawVerts` and transitions to vertex-edit state.

- [ ] **Step 1: Replace `_addVertMarker`**

Replace the existing `_addVertMarker` function:

```javascript
function _addVertMarker(lat, lng) {
  const idx = drawVertMarkers.length;
  const m = L.circleMarker([lat, lng], {
    radius: 5, fillColor: '#ffd700', color: '#fff', weight: 1.5, fillOpacity: 1
  }).addTo(map);
  // Click a vertex to delete it
  m.on('click', e => {
    L.DomEvent.stopPropagation(e);
    drawVerts.splice(idx, 1);
    drawVertMarkers.forEach(x => x.remove());
    drawVertMarkers = [];
    drawVerts.forEach(v => _addVertMarker(v[0], v[1]));
    updateDrawPreview();
    updateDrawBar();
  });
  drawVertMarkers.push(m);
}
```

With:

```javascript
function _addVertMarker(lat, lng) {
  const icon = L.divIcon({
    className: '',
    html: '<div style="width:10px;height:10px;background:#ffd700;border:1.5px solid #fff;border-radius:50%;margin:-5px 0 0 -5px;cursor:grab"></div>',
    iconSize: [10, 10],
    iconAnchor: [5, 5],
  });
  const m = L.marker([lat, lng], { icon, draggable: true }).addTo(map);

  // Click to delete
  m.on('click', e => {
    L.DomEvent.stopPropagation(e);
    const i = drawVertMarkers.indexOf(m);
    if (i === -1) return;
    drawVerts.splice(i, 1);
    drawVertMarkers.forEach(x => x.remove());
    drawVertMarkers = [];
    drawVerts.forEach(v => _addVertMarker(v[0], v[1]));
    updateDrawPreview();
    updateDrawBar();
  });

  // Drag to nudge
  m.on('drag', e => {
    const i = drawVertMarkers.indexOf(m);
    if (i === -1) return;
    drawVerts[i] = [e.latlng.lat, e.latlng.lng];
    updateDrawPreview();
  });

  m.on('dragend', () => {
    setDrawBarState('vertex-edit');
  });

  drawVertMarkers.push(m);
}
```

- [ ] **Step 2: Verify in browser**

Open `course-mapper.html`. Detect a green polygon on any hole.

Expected:
- Yellow circular handles appear on each polygon vertex
- Hovering over a handle shows a `grab` cursor
- Dragging a handle moves the vertex and the polygon outline updates live
- After dragging, the bar changes to vertex-edit state showing "Hole N — X pts — drag to adjust" with Finish / Clear / Cancel
- Clicking a handle (without dragging) deletes it and re-renders all handles
- "✓ Finish" saves and exits draw mode; polygon appears on the map

- [ ] **Step 3: Full end-to-end test**

1. Open `course-mapper.html` at zoom 18-19 on the course
2. Click a hole indicator → bar shows "🎯 Click on the green…"
3. Click once on the visible green surface → polygon appears + slider
4. Drag slider tight → polygon shrinks; drag loose → expands
5. Drag one vertex off the green → vertex-edit state
6. Click ✕ on a vertex → it disappears, polygon redraws
7. Click "✓ Finish" → polygon saved, bar closes
8. Click "🟢 Review" → the hole shows ✓ with the detected polygon and front/mid/back dots

- [ ] **Step 4: Commit**

```bash
git add course-mapper.html
git commit -m "feat(autodetect): draggable vertex markers with nudge-to-vertex-edit transition"
```

---

## Final Verification

After all 8 tasks:

1. Open `course-mapper.html` at zoom 18+
2. For 3 different holes: click hole indicator → click green → accept polygon
3. Open "🟢 Review" — all 3 holes show ✓ and correct front/mid/back preview dots
4. Click "⬆ Push All to Supabase" — confirm `H{n}:✓` for each
5. Open `index.html` in a GPS round — tap ⛳ Green on a traced hole — confirm Front/Mid/Back labels appear
6. Try error cases:
   - Click fringe/rough → should detect, possibly require slider tighten
   - Slider all the way tight → may trigger "Detection unclear" error → "Try Again" returns to seed mode
