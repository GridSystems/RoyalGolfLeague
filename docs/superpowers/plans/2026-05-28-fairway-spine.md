# Fairway Spine Recording Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a piecewise-linear fairway spine per hole to `course-mapper.html`, with auto-generated tee→green baseline, draggable inflection waypoints, viewport-aware 10m distance rings, and a draggable measurement marker.

**Architecture:** New spine edit mode sits alongside the existing fairway polygon and green draw modes. All modes are mutually exclusive. Reuses the same draw bar and Supabase upsert pattern as green/fairway polygon features. New state variables track the working waypoint list, edit polyline, anchor markers, waypoint dot markers, distance ring layers, and measurement marker. Single file: `course-mapper.html` only.

**Tech Stack:** Vanilla JS, Leaflet.js, Supabase REST API, localStorage.

---

## File Structure

One file changes: `course-mapper.html`

Key insertion points (search for these landmark strings):
- After `.ind-fairway:hover { opacity: 0.8; }` → add `.ind-spine` CSS
- After `let fairwaySelectHole = null;` state block → add spine state vars
- After `sbUpsertFairwayPolygons` function → add `sbUpsertFairwaySpines`
- Inside `saveAll()` → add `rgcFairwaySpines` line
- After `redrawAllFairwayPolygons()` function → add helper functions + `redrawAllSpines`
- After `clearFairwayPolygonsForHole` function → add all spine mode functions
- Inside `updateDrawBar()` → add `drawingSpine` branch at top
- Inside `_exitDrawMode()` → add spine resets
- Inside `map.on('click', ...)` → add `drawingSpine` routing at top
- Inside `document.addEventListener('keydown', ...)` → add spine Escape case
- Inside `startDrawGreen()`, `startDrawTee()`, `startFairwayMode()` → add spine exit guards
- Inside `renderHoleList()` → add S indicator + ✕S button
- In the `// ── Init ──` section → add `redrawAllSpines()` call

---

### Task 1: Create Supabase table

**Files:**
- No file changes — SQL run in Supabase dashboard

- [ ] **Step 1: Run this SQL in the Supabase SQL editor** (Dashboard → SQL Editor → New query)

```sql
create table fairway_spines (
  hole        integer not null primary key,
  waypoints   jsonb   not null,
  recorded_at timestamptz default now()
);

alter table fairway_spines enable row level security;
create policy "public read"   on fairway_spines for select using (true);
create policy "public write"  on fairway_spines for insert with check (true);
create policy "public update" on fairway_spines for update using (true);
create policy "public delete" on fairway_spines for delete using (true);
```

`waypoints` stores inflection points only (not tee or green endpoint): `[[lat,lng], ...]`. Empty array = straight line.

- [ ] **Step 2: Verify table exists**

Supabase Table Editor → `fairway_spines` with columns: hole, waypoints, recorded_at.

- [ ] **Step 3: Test REST access via PowerShell**

```powershell
$key = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF2anlidGNieW1leGhlcXJqa2FpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQzNDUyMDAsImV4cCI6MjA4OTkyMTIwMH0.ODg9C2HU4exSpTt5ABfODz_vz3v0Uz_tQsL3XAuWJ-4"
$h = @{ apikey=$key; Authorization="Bearer $key" }
Invoke-RestMethod "https://qvjybtcbymexheqrjkai.supabase.co/rest/v1/fairway_spines?select=*" -Headers $h
```

Expected: empty array `[]`, no error.

- [ ] **Step 4: Commit empty marker**

```bash
git commit --allow-empty -m "feat: create fairway_spines Supabase table"
```

---

### Task 2: CSS + state variables + saveAll + sbUpsertFairwaySpines

**Files:**
- Modify: `course-mapper.html` — CSS block (~line 55), state block (~line 863), `saveAll()` (~line 2010), after `sbUpsertFairwayPolygons` (~line 545)

- [ ] **Step 1: Add `.ind-spine` CSS**

Find this exact block (around line 55–58):
```css
    .ind-fairway { font-size: 11px; padding: 2px 6px; border-radius: 3px; font-weight: 700; cursor: pointer; }
    .ind-fairway.set   { background: #f39c12; color: #000; }
    .ind-fairway.unset { background: #2a2a3e; color: #555; }
    .ind-fairway:hover { opacity: 0.8; }
```

Add immediately **after** `.ind-fairway:hover`:

```css
    .ind-spine { font-size: 11px; padding: 2px 6px; border-radius: 3px; font-weight: 700; cursor: pointer; }
    .ind-spine.set   { background: #17a2b8; color: #000; }
    .ind-spine.unset { background: #2a2a3e; color: #555; }
    .ind-spine:hover { opacity: 0.8; }
```

- [ ] **Step 2: Add spine state variables**

Find this exact block (around line 863):
```javascript
let fairwaySelectHole = null;  // hole in select-mode (pick-a-polygon-to-edit), or null
```

Add immediately **after** that line:

```javascript

// Fairway spine recording state
let fairwaySpines      = JSON.parse(localStorage.getItem('rgcFairwaySpines') || '{}');
// { [hole]: [[lat,lng], ...] } — inflection waypoints only (not tee or green endpoint)
let spinePolyLayers    = {};    // { [hole]: L.polyline } — saved spine renderings
let drawingSpine       = null;  // hole number currently in spine-edit mode, or null
let spineWaypoints     = [];    // working copy of waypoints during edit session
let spineWptMarkers    = [];    // L.marker[] — draggable waypoint dots during edit
let spineEditPolyLayer = null;  // L.polyline — working teal polyline during edit
let spineAnchorMarkers = [];    // L.marker[2] — fixed tee + green centroid anchors during edit
let measureMarker      = null;  // L.marker — draggable measurement marker
let distRingLayers     = [];    // L.circle[] — static 10m rings from tee + green front
let liveRingLayers     = [];    // L.circle[] — live rings from measurement marker
```

- [ ] **Step 3: Add `sbUpsertFairwaySpines` function**

Find the end of `sbUpsertFairwayPolygons` (around line 545 — look for `if(!r.ok)throw new Error(await r.text())` followed by the closing `}`). Add the new function immediately after:

```javascript
async function sbUpsertFairwaySpines(hole, waypoints) {
  if (!Array.isArray(waypoints) || waypoints.length === 0) {
    // Empty waypoints means straight line — delete the row entirely
    const r = await fetch(`${SB_URL}/rest/v1/fairway_spines?hole=eq.${hole}`, {
      method: 'DELETE',
      headers: SB_H
    });
    if (!r.ok) throw new Error(await r.text());
    return;
  }
  const r = await fetch(`${SB_URL}/rest/v1/fairway_spines?on_conflict=hole`, {
    method: 'POST',
    headers: { ...SB_H, 'Prefer': 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ hole, waypoints })
  });
  if (!r.ok) throw new Error(await r.text());
}
```

**Note:** An empty waypoints array means "straight line, no inflection points" — we delete the row rather than storing an empty array, to keep the DB clean. The badge in the sidebar is driven by `fairwaySpines[hole]` in localStorage, not by the DB row.

- [ ] **Step 4: Update `saveAll()` to persist spine data**

Find `saveAll()` (around line 2005). It currently ends with:
```javascript
  localStorage.setItem('rgcFairwayPolygons', JSON.stringify(fairwayPolygons));
```

Add immediately after that line:
```javascript
  localStorage.setItem('rgcFairwaySpines', JSON.stringify(fairwaySpines));
```

- [ ] **Step 5: Verify in browser**

Open `course-mapper.html` in browser. Open DevTools console. Run:
```javascript
console.log(typeof sbUpsertFairwaySpines, typeof fairwaySpines);
```
Expected: `function object` — no errors.

- [ ] **Step 6: Commit**

```bash
git add course-mapper.html
git commit -m "feat: spine CSS, state vars, saveAll, sbUpsertFairwaySpines"
```

---

### Task 3: Helper functions + `redrawAllSpines` + init call

**Files:**
- Modify: `course-mapper.html` — after `redrawAllFairwayPolygons()` function (~line 1528), and init section (~line 2410)

- [ ] **Step 1: Add helper functions and `redrawAllSpines` after `redrawAllFairwayPolygons`**

Find the end of `redrawAllFairwayPolygons()` (look for the closing `}` after the `.forEach(verts =>` block, around line 1527). Add immediately after:

```javascript
// ── Fairway spine helpers ──────────────────────────────────────────────────

function greenCentroid(hole) {
  const verts = greenPolygons[hole];
  if (!verts || verts.length === 0) return null;
  const lat = verts.reduce((s, v) => s + v[0], 0) / verts.length;
  const lng = verts.reduce((s, v) => s + v[1], 0) / verts.length;
  return { lat, lng };
}

function greenFront(hole) {
  const verts = greenPolygons[hole];
  if (!verts || verts.length === 0) return null;
  const tee = HOLE_TEES[hole - 1];
  if (!tee) return null;
  let minD = Infinity, best = null;
  verts.forEach(v => {
    const d = haversineM(tee.lat, tee.lng, v[0], v[1]);
    if (d < minD) { minD = d; best = { lat: v[0], lng: v[1] }; }
  });
  return best;
}

function spineProjection(pt, tee, green) {
  // Returns scalar t (0 = tee, 1 = green) for projection of pt onto tee→green vector
  const dx = green.lat - tee.lat, dy = green.lng - tee.lng;
  const px = pt[0]   - tee.lat,  py = pt[1]   - tee.lng;
  const denom = dx * dx + dy * dy;
  if (denom === 0) return 0;
  return (px * dx + py * dy) / denom;
}

function sortSpineWaypoints() {
  const tee   = HOLE_TEES[drawingSpine - 1];
  const green = greenCentroid(drawingSpine);
  if (!tee || !green) return;
  spineWaypoints.sort((a, b) => spineProjection(a, tee, green) - spineProjection(b, tee, green));
}

function maxViewportDist(anchor) {
  const b = map.getBounds();
  const corners = [b.getNorthWest(), b.getNorthEast(), b.getSouthWest(), b.getSouthEast()];
  return Math.max(...corners.map(c => haversineM(anchor.lat, anchor.lng, c.lat, c.lng)));
}

function redrawAllSpines() {
  // Remove existing spine layers
  Object.values(spinePolyLayers).forEach(l => l.remove());
  spinePolyLayers = {};

  Object.entries(fairwaySpines).forEach(([holeStr, wpts]) => {
    const hole = parseInt(holeStr, 10);
    if (drawingSpine === hole) return; // skip hole being edited — edit polyline handles it
    const tee   = HOLE_TEES[hole - 1];
    const green = greenCentroid(hole);
    if (!tee || !green) return;
    const points = [[tee.lat, tee.lng], ...(wpts || []), [green.lat, green.lng]];
    if (points.length < 2) return;
    const layer = L.polyline(points, { color: '#17a2b8', weight: 2, opacity: 0.7 }).addTo(map);
    layer.bindTooltip('Hole ' + hole + ' spine', { permanent: false, direction: 'center' });
    spinePolyLayers[hole] = layer;
  });
}
```

- [ ] **Step 2: Add `redrawAllSpines()` to the init section**

Find the init section (at the very bottom of the `<script>`, around line 2409–2412):
```javascript
redrawAllPolygons();
redrawAllFairwayPolygons();
renderHoleList();
loadSurveyPoints();
```

Add `redrawAllSpines();` between `redrawAllFairwayPolygons()` and `renderHoleList()`:
```javascript
redrawAllPolygons();
redrawAllFairwayPolygons();
redrawAllSpines();
renderHoleList();
loadSurveyPoints();
```

- [ ] **Step 3: Verify in browser**

Open `course-mapper.html`. Open DevTools console. Run:
```javascript
console.log(typeof greenCentroid, typeof greenFront, typeof spineProjection, typeof sortSpineWaypoints, typeof redrawAllSpines);
```
Expected: `function function function function function` — no errors.

Test `greenCentroid` on a hole that has a recorded green polygon (e.g. hole 1):
```javascript
console.log(greenCentroid(1)); // should return {lat: ~55.636, lng: ~12.570}
```

- [ ] **Step 4: Commit**

```bash
git add course-mapper.html
git commit -m "feat: spine helper functions, redrawAllSpines, init call"
```

---

### Task 4: Spine draw bar (`setSpineDrawBar`) + `updateDrawBar`

**Files:**
- Modify: `course-mapper.html` — after `setFairwayDrawBar()` function (~line 1604), and inside `updateDrawBar()` (~line 1145)

- [ ] **Step 1: Add `setSpineDrawBar` after `setFairwayDrawBar`**

Find the end of `setFairwayDrawBar()` (look for its closing `}`, around line 1603). Add immediately after:

```javascript
function setSpineDrawBar() {
  const bar = document.getElementById('drawBar');
  const hole = drawingSpine;
  const n    = spineWaypoints.length;
  const btn  = s => `style="padding:5px 12px;border-radius:5px;border:none;font-size:12px;font-weight:700;cursor:pointer;${s}"`;
  const label = n === 0
    ? `<span style="color:#17a2b8;font-weight:600">Spine ${hole} — straight</span>`
    : `<span style="color:#17a2b8;font-weight:600">Spine ${hole} — ${n} waypoint${n !== 1 ? 's' : ''}</span>`;
  bar.innerHTML =
    label +
    `<button onclick="finishSpine()" ${btn('background:#2ecc71;color:#000')}>✓ Finish</button>` +
    `<button onclick="clearSpineWaypoints()" ${btn('background:#555;color:#eee')}>🗑 Clear</button>` +
    `<button onclick="cancelSpine()" ${btn('background:#e94560;color:#fff')}>✕ Cancel</button>`;
}
```

- [ ] **Step 2: Update `updateDrawBar` to check `drawingSpine` first**

Find `updateDrawBar()` (around line 1145):
```javascript
function updateDrawBar() {
  if (drawingFairway !== null) {
    setFairwayDrawBar();
  } else {
    setDrawBarState('vertex-edit');
  }
}
```

Replace the entire function with:
```javascript
function updateDrawBar() {
  if (drawingSpine !== null) {
    setSpineDrawBar();
  } else if (drawingFairway !== null) {
    setFairwayDrawBar();
  } else {
    setDrawBarState('vertex-edit');
  }
}
```

- [ ] **Step 3: Verify in browser**

Open DevTools console. Run:
```javascript
drawingSpine = 5;
spineWaypoints = [];
updateDrawBar();
// drawBar should show: "Spine 5 — straight" with Finish / Clear / Cancel
spineWaypoints = [[55.6, 12.5]];
updateDrawBar();
// drawBar should show: "Spine 5 — 1 waypoint" with Finish / Clear / Cancel
drawingSpine = null;
spineWaypoints = [];
document.getElementById('drawBar').style.display = 'none';
```

- [ ] **Step 4: Commit**

```bash
git add course-mapper.html
git commit -m "feat: setSpineDrawBar, updateDrawBar spine branch"
```

---

### Task 5: Distance overlay functions

**Files:**
- Modify: `course-mapper.html` — add after `redrawAllSpines()` function (after Task 3 additions)

- [ ] **Step 1: Add distance overlay functions**

Find the end of `redrawAllSpines()` (the `}` closing it from Task 3). Add immediately after:

```javascript
function updateDistanceRings() {
  // Clear existing static rings
  distRingLayers.forEach(l => l.remove());
  distRingLayers = [];
  if (drawingSpine === null) return;

  const hole     = drawingSpine;
  const tee      = HOLE_TEES[hole - 1];
  const front    = greenFront(hole);
  if (!tee || !front) return;

  const teePt    = { lat: tee.lat,   lng: tee.lng   };
  const frontPt  = { lat: front.lat, lng: front.lng };
  const maxTee   = maxViewportDist(teePt);
  const maxFront = maxViewportDist(frontPt);

  // Tee rings — grey dashed
  for (let r = 10; r <= Math.ceil(maxTee / 10) * 10; r += 10) {
    const c = L.circle([teePt.lat, teePt.lng], {
      radius: r, color: '#888888', weight: 1,
      dashArray: '4 6', fillOpacity: 0, interactive: false
    }).addTo(map);
    c.bindTooltip(r + 'm', { permanent: false, direction: 'center', className: '' });
    distRingLayers.push(c);
  }

  // Green-front rings — amber dashed
  for (let r = 10; r <= Math.ceil(maxFront / 10) * 10; r += 10) {
    const c = L.circle([frontPt.lat, frontPt.lng], {
      radius: r, color: '#f39c12', weight: 1,
      dashArray: '4 6', fillOpacity: 0, interactive: false
    }).addTo(map);
    c.bindTooltip(r + 'm', { permanent: false, direction: 'center', className: '' });
    distRingLayers.push(c);
  }
}

function showDistanceRings() {
  updateDistanceRings();
  map.on('moveend zoomend', updateDistanceRings);
}

function hideDistanceRings() {
  map.off('moveend zoomend', updateDistanceRings);
  distRingLayers.forEach(l => l.remove());
  distRingLayers = [];
}

function removeMeasurementMarker() {
  if (measureMarker) { measureMarker.remove(); measureMarker = null; }
  liveRingLayers.forEach(l => l.remove());
  liveRingLayers = [];
}

function initMeasurementMarker(hole) {
  removeMeasurementMarker();
  const tee   = HOLE_TEES[hole - 1];
  const green = greenCentroid(hole);
  if (!tee || !green) return;

  // Start at midpoint of tee → green
  const midLat = (tee.lat + green.lat) / 2;
  const midLng = (tee.lng + green.lng) / 2;

  const icon = L.divIcon({
    className: '',
    html: '<div style="width:16px;height:16px;background:rgba(255,255,255,0.85);border:2px solid #fff;border-radius:50%;margin:-8px 0 0 -8px;cursor:move;box-shadow:0 0 4px rgba(0,0,0,0.5)"></div>',
    iconSize: [16, 16],
    iconAnchor: [8, 8]
  });

  measureMarker = L.marker([midLat, midLng], { icon, draggable: true, zIndexOffset: 500 }).addTo(map);

  measureMarker.on('dragend', () => {
    const pos   = measureMarker.getLatLng();
    const front = greenFront(hole);
    if (!front) return;

    const distToTee   = haversineM(tee.lat, tee.lng, pos.lat, pos.lng);
    const distToGreen = haversineM(front.lat, front.lng, pos.lat, pos.lng);

    // Remove old live rings
    liveRingLayers.forEach(l => l.remove());
    liveRingLayers = [];

    // Ring from tee
    liveRingLayers.push(
      L.circle([tee.lat, tee.lng], {
        radius: distToTee, color: '#888888', weight: 2, fillOpacity: 0, interactive: false
      }).addTo(map)
    );

    // Ring from green front
    liveRingLayers.push(
      L.circle([front.lat, front.lng], {
        radius: distToGreen, color: '#f39c12', weight: 2, fillOpacity: 0, interactive: false
      }).addTo(map)
    );

    // Label on the marker
    measureMarker.bindTooltip(
      Math.round(distToTee) + 'm from tee &nbsp;|&nbsp; ' + Math.round(distToGreen) + 'm to green',
      { permanent: true, direction: 'top', offset: [0, -10] }
    ).openTooltip();
  });
}
```

- [ ] **Step 2: Verify in browser**

Open DevTools console. Run:
```javascript
// Simulate being in spine mode for hole 1
drawingSpine = 1;
showDistanceRings();
// Should see grey and amber dashed rings appear on the map (need green polygon for hole 1)
hideDistanceRings();
drawingSpine = null;
```

Expected: rings appear centred on the hole 1 tee and green front, then disappear.

- [ ] **Step 3: Commit**

```bash
git add course-mapper.html
git commit -m "feat: spine distance overlay — updateDistanceRings, measurement marker"
```

---

### Task 6: Spine mode entry/exit + waypoint editing

**Files:**
- Modify: `course-mapper.html` — add after `clearFairwayPolygonsForHole` function (~line 1720)

- [ ] **Step 1: Add all spine mode and waypoint functions**

Find the end of `clearFairwayPolygonsForHole()` (look for the closing `}` after `renderHoleList();`, around line 1720). Add all the following functions immediately after:

```javascript
// ── Fairway spine mode ─────────────────────────────────────────────────────

function startSpineMode(hole) {
  if (!greenPolygons[hole] || greenPolygons[hole].length < 3) {
    alert('Record the green polygon for hole ' + hole + ' before adding its spine.');
    return;
  }
  // Exit any active mode first
  if (teeDrawHole !== null)       _exitTeeMode();
  if (drawingGreen !== null)      cancelDrawGreen();
  if (fairwaySelectHole !== null) _exitFairwaySelectMode();
  if (drawingFairway !== null)    cancelDrawFairway();
  if (drawingSpine !== null)      _exitSpineMode();

  drawingSpine   = hole;
  spineWaypoints = (fairwaySpines[hole] || []).map(v => [...v]); // working copy

  // Hide saved spine for this hole while editing (edit polyline replaces it)
  if (spinePolyLayers[hole]) { spinePolyLayers[hole].remove(); delete spinePolyLayers[hole]; }

  document.getElementById('map').classList.add('draw-mode');
  document.getElementById('drawBar').style.display = 'flex';
  setSpineDrawBar();

  redrawEditSpine();
  showDistanceRings();
  initMeasurementMarker(hole);

  // Fly to hole bounds (tee → green centroid, with padding)
  const tee   = HOLE_TEES[hole - 1];
  const green = greenCentroid(hole);
  if (tee && green) {
    map.flyToBounds(
      [[Math.min(tee.lat, green.lat), Math.min(tee.lng, green.lng)],
       [Math.max(tee.lat, green.lat), Math.max(tee.lng, green.lng)]],
      { padding: [80, 80], maxZoom: 18, animate: true, duration: 0.6 }
    );
  } else if (tee) {
    map.flyTo([tee.lat, tee.lng], 18, { animate: true, duration: 0.6 });
  }
}

function _exitSpineMode() {
  // Remove edit polyline
  if (spineEditPolyLayer) { spineEditPolyLayer.remove(); spineEditPolyLayer = null; }
  // Remove anchor markers
  spineAnchorMarkers.forEach(m => m.remove()); spineAnchorMarkers = [];
  // Remove waypoint dots
  spineWptMarkers.forEach(m => m.remove()); spineWptMarkers = [];
  // Remove distance overlay
  hideDistanceRings();
  removeMeasurementMarker();

  drawingSpine   = null;
  spineWaypoints = [];
  spineWptMarkers = [];

  document.getElementById('map').classList.remove('draw-mode');
  document.getElementById('drawBar').style.display = 'none';
}

function cancelSpine() {
  _exitSpineMode();
  // Redraw any saved spine that was hidden during edit
  redrawAllSpines();
}

async function finishSpine() {
  sortSpineWaypoints();
  const hole = drawingSpine;
  const wpts = spineWaypoints.map(v => [...v]); // capture before _exitSpineMode resets

  fairwaySpines[hole] = wpts;
  saveAll();

  const bar = document.getElementById('drawBar');
  bar.innerHTML = '<span style="color:#17a2b8;font-weight:600">⏳ Saving…</span>';

  try {
    await sbUpsertFairwaySpines(hole, wpts);
  } catch (err) {
    console.error('finishSpine:', err);
    bar.innerHTML =
      '<span style="color:#e74c3c">⚠ Save failed — ' + err.message + '</span>' +
      '<button onclick="finishSpine()" style="padding:5px 12px;border-radius:5px;border:none;background:#2ecc71;color:#000;font-size:12px;font-weight:700;cursor:pointer">Retry</button>' +
      '<button onclick="cancelSpine()" style="padding:5px 12px;border-radius:5px;border:none;background:#e94560;color:#fff;font-size:12px;font-weight:700;cursor:pointer">✕ Cancel</button>';
    return;
  }

  _exitSpineMode();
  redrawAllSpines();
  renderHoleList();
}

function clearSpineWaypoints() {
  spineWaypoints = [];
  redrawEditSpine();
  setSpineDrawBar();
}

async function deleteSpine(hole) {
  delete fairwaySpines[hole];
  saveAll();
  if (spinePolyLayers[hole]) { spinePolyLayers[hole].remove(); delete spinePolyLayers[hole]; }
  try {
    await sbUpsertFairwaySpines(hole, []);
  } catch (err) {
    console.error('deleteSpine Supabase error (local save succeeded):', err);
  }
  renderHoleList();
}

function addSpineWaypoint(latlng) {
  spineWaypoints.push([latlng.lat, latlng.lng]);
  sortSpineWaypoints();
  redrawEditSpine();
  setSpineDrawBar();
}

function deleteSpineWaypoint(idx) {
  spineWaypoints.splice(idx, 1);
  redrawEditSpine();
  setSpineDrawBar();
}

function redrawEditSpine() {
  // Remove existing edit polyline, anchor markers, waypoint dots
  if (spineEditPolyLayer) { spineEditPolyLayer.remove(); spineEditPolyLayer = null; }
  spineAnchorMarkers.forEach(m => m.remove()); spineAnchorMarkers = [];
  spineWptMarkers.forEach(m => m.remove());    spineWptMarkers    = [];

  const hole  = drawingSpine;
  const tee   = HOLE_TEES[hole - 1];
  const green = greenCentroid(hole);
  if (!tee || !green) return;

  const points = [[tee.lat, tee.lng], ...spineWaypoints, [green.lat, green.lng]];

  // Teal edit polyline
  spineEditPolyLayer = L.polyline(points, {
    color: '#17a2b8', weight: 2, opacity: 0.9
  }).addTo(map);

  // Fixed anchor markers (non-draggable)
  const anchorIcon = L.divIcon({
    className: '',
    html: '<div style="width:12px;height:12px;background:#17a2b8;border:2px solid #fff;border-radius:50%;margin:-6px 0 0 -6px"></div>',
    iconSize: [12, 12], iconAnchor: [6, 6]
  });
  spineAnchorMarkers.push(
    L.marker([tee.lat, tee.lng],     { icon: anchorIcon, interactive: false }).addTo(map)
  );
  spineAnchorMarkers.push(
    L.marker([green.lat, green.lng], { icon: anchorIcon, interactive: false }).addTo(map)
  );

  // Draggable waypoint dot markers
  const wptIcon = L.divIcon({
    className: '',
    html: '<div style="width:10px;height:10px;background:#17a2b8;border:1.5px solid #fff;border-radius:50%;margin:-5px 0 0 -5px;cursor:grab"></div>',
    iconSize: [10, 10], iconAnchor: [5, 5]
  });

  spineWaypoints.forEach((wpt, i) => {
    const m = L.marker([wpt[0], wpt[1]], { icon: wptIcon, draggable: true }).addTo(map);

    m.on('click', e => {
      L.DomEvent.stopPropagation(e);
      deleteSpineWaypoint(i);
    });

    m.on('drag', e => {
      spineWaypoints[i] = [e.latlng.lat, e.latlng.lng];
      // Live update the polyline while dragging
      if (spineEditPolyLayer) {
        const pts = [[tee.lat, tee.lng], ...spineWaypoints, [green.lat, green.lng]];
        spineEditPolyLayer.setLatLngs(pts);
      }
    });

    m.on('dragend', () => {
      sortSpineWaypoints();
      redrawEditSpine();
      setSpineDrawBar();
    });

    spineWptMarkers.push(m);
  });
}
```

- [ ] **Step 2: Verify in browser**

Open DevTools console. Run (hole 1 must have a green polygon):
```javascript
startSpineMode(1);
```

Expected:
- Map flies to hole 1
- Draw bar shows "Spine 1 — straight" with Finish/Clear/Cancel
- Teal polyline from tee to green centroid
- Two teal anchor dots at tee and green centroid
- Grey and amber distance rings visible
- White measurement marker in the middle

Click on the map → waypoint appears, bar shows "Spine 1 — 1 waypoint".
Click the waypoint → it deletes.
Click Cancel → everything clears, draw bar hides.

- [ ] **Step 3: Commit**

```bash
git add course-mapper.html
git commit -m "feat: spine mode entry/exit, waypoint add/delete/drag, finishSpine, deleteSpine"
```

---

### Task 7: Integration wiring

**Files:**
- Modify: `course-mapper.html` — `map.on('click')`, `keydown` handler, `_exitDrawMode()`, `startDrawGreen()`, `startDrawTee()`, `startFairwayMode()`, `renderHoleList()`

- [ ] **Step 1: Add spine routing to `map.on('click')`**

Find `map.on('click', e => {` (around line 920). The first check is `if (teeDrawHole !== null)`. Add a new block **before** it:

```javascript
map.on('click', e => {
  if (drawingSpine !== null) {
    const target = e.originalEvent && e.originalEvent.target;
    const onMarker = target && target.closest('.leaflet-marker-icon');
    if (!onMarker) addSpineWaypoint(e.latlng);
    return;
  }
  if (teeDrawHole !== null) {
```

The full opening of `map.on('click'` should now look like:
```javascript
map.on('click', e => {
  if (drawingSpine !== null) {
    const target = e.originalEvent && e.originalEvent.target;
    const onMarker = target && target.closest('.leaflet-marker-icon');
    if (!onMarker) addSpineWaypoint(e.latlng);
    return;
  }
  if (teeDrawHole !== null) {
    // ... existing tee click handling ...
```

- [ ] **Step 2: Add spine Escape handling to `keydown` listener**

Find the `document.addEventListener('keydown', e => {` block (around line 972). It currently starts:
```javascript
  if (e.key === 'Escape') {
    if (teeDrawHole !== null) { cancelDrawTee(); return; }
    if (fairwaySelectHole !== null) { _exitFairwaySelectMode(); return; }
    if (drawingFairway !== null) { cancelDrawFairway(); return; }
    if (drawingGreen !== null) { cancelDrawGreen(); return; }
  }
```

Add `drawingSpine` at the **top** of the Escape block:
```javascript
  if (e.key === 'Escape') {
    if (drawingSpine !== null) { cancelSpine(); return; }
    if (teeDrawHole !== null) { cancelDrawTee(); return; }
    if (fairwaySelectHole !== null) { _exitFairwaySelectMode(); return; }
    if (drawingFairway !== null) { cancelDrawFairway(); return; }
    if (drawingGreen !== null) { cancelDrawGreen(); return; }
  }
```

- [ ] **Step 3: Add spine resets to `_exitDrawMode()`**

Find `_exitDrawMode()` (around line 1320). It currently ends with:
```javascript
  drawingGreen     = null;
  drawingFairway   = null;
  drawingFairwayIdx = null;
```

Add spine resets after those lines (before the `detectMode` reset block):
```javascript
  drawingGreen      = null;
  drawingFairway    = null;
  drawingFairwayIdx = null;
  // Spine state — reset if active (spine has its own _exitSpineMode but guard here too)
  if (drawingSpine !== null) {
    if (spineEditPolyLayer) { spineEditPolyLayer.remove(); spineEditPolyLayer = null; }
    spineAnchorMarkers.forEach(m => m.remove()); spineAnchorMarkers = [];
    spineWptMarkers.forEach(m => m.remove());    spineWptMarkers    = [];
    distRingLayers.forEach(l => l.remove());     distRingLayers     = [];
    liveRingLayers.forEach(l => l.remove());     liveRingLayers     = [];
    if (measureMarker) { measureMarker.remove(); measureMarker = null; }
    drawingSpine = null; spineWaypoints = [];
  }
```

- [ ] **Step 4: Add spine exit guard to `startDrawGreen`**

Find `startDrawGreen(hole)` (around line 1010). It currently starts with:
```javascript
function startDrawGreen(hole) {
  if (teeDrawHole !== null) _exitTeeMode();
```

Add `_exitSpineMode()` call at the very top:
```javascript
function startDrawGreen(hole) {
  if (drawingSpine !== null) { _exitSpineMode(); redrawAllSpines(); }
  if (teeDrawHole !== null) _exitTeeMode();
```

- [ ] **Step 5: Add spine exit guard to `startDrawTee`**

Find `startDrawTee(hole)` (around line 1337). It currently starts:
```javascript
function startDrawTee(hole) {
  if (pinMode) togglePinMode();
  closePanel();
  if (drawingGreen !== null) return;
  if (teeDrawHole !== null) _exitTeeMode();
  if (fairwaySelectHole !== null) _exitFairwaySelectMode();
  if (drawingFairway !== null) cancelDrawFairway();
```

Add spine exit after `cancelDrawFairway()`:
```javascript
  if (drawingFairway !== null) cancelDrawFairway();
  if (drawingSpine !== null) { cancelSpine(); }
```

- [ ] **Step 6: Add spine exit guard to `startFairwayMode`**

Find `startFairwayMode(hole)` (around line 1529):
```javascript
function startFairwayMode(hole) {
  if (pinMode) togglePinMode();
  closePanel();
  if (drawingGreen !== null) cancelDrawGreen();
  if (teeDrawHole !== null) _exitTeeMode();
  if (drawingFairway !== null) cancelDrawFairway();
  if (fairwaySelectHole !== null) _exitFairwaySelectMode();
```

Add spine exit after `_exitFairwaySelectMode()`:
```javascript
  if (fairwaySelectHole !== null) _exitFairwaySelectMode();
  if (drawingSpine !== null) cancelSpine();
```

- [ ] **Step 7: Add S indicator and ✕S button to `renderHoleList`**

Find this section in `renderHoleList()` (around line 1973–1976):
```javascript
        '<span class="indicator ind-fairway ' + (hasFairway ? 'set' : 'unset') + '"' +
          ' onclick="startFairwayMode(' + h + ')"' +
          ' title="' + (hasFairway ? fairwayPolysForHole.length + ' polygon' + (fairwayPolysForHole.length !== 1 ? 's' : '') + ' — click to edit' : 'Record fairway') + '">' +
          'F' + (hasFairway ? fairwayPolysForHole.length : '') + '</span>' +
```

Add the S indicator immediately after (between the F indicator `</span>` and the G indicator `<span>`):

```javascript
        '<span class="indicator ind-fairway ' + (hasFairway ? 'set' : 'unset') + '"' +
          ' onclick="startFairwayMode(' + h + ')"' +
          ' title="' + (hasFairway ? fairwayPolysForHole.length + ' polygon' + (fairwayPolysForHole.length !== 1 ? 's' : '') + ' — click to edit' : 'Record fairway') + '">' +
          'F' + (hasFairway ? fairwayPolysForHole.length : '') + '</span>' +
```

becomes:

```javascript
        '<span class="indicator ind-fairway ' + (hasFairway ? 'set' : 'unset') + '"' +
          ' onclick="startFairwayMode(' + h + ')"' +
          ' title="' + (hasFairway ? fairwayPolysForHole.length + ' polygon' + (fairwayPolysForHole.length !== 1 ? 's' : '') + ' — click to edit' : 'Record fairway') + '">' +
          'F' + (hasFairway ? fairwayPolysForHole.length : '') + '</span>' +
        (() => {
          const spineWpts = fairwaySpines[h];
          const hasSpine  = spineWpts !== undefined;
          const wptCount  = hasSpine ? spineWpts.length : 0;
          const label     = hasSpine ? ('S' + (wptCount > 0 ? wptCount : '')) : 'S';
          const title     = hasSpine
            ? (wptCount > 0 ? wptCount + ' waypoint' + (wptCount !== 1 ? 's' : '') + ' — click to edit' : 'Straight line — click to edit')
            : 'Record fairway spine';
          return '<span class="indicator ind-spine ' + (hasSpine ? 'set' : 'unset') + '"' +
            ' onclick="startSpineMode(' + h + ')"' +
            ' title="' + title + '">' + label + '</span>';
        })() +
```

Also find the ✕F button in `renderHoleList()` (around line 1988):
```javascript
        (hasFairway ? '<button class="clr" onclick="clearFairwayPolygonsForHole('+h+')">✕F</button>' : '') +
```

Add a ✕S button immediately after:
```javascript
        (hasFairway ? '<button class="clr" onclick="clearFairwayPolygonsForHole('+h+')">✕F</button>' : '') +
        (fairwaySpines[h] !== undefined ? '<button class="clr" onclick="deleteSpine('+h+')">✕S</button>' : '') +
```

- [ ] **Step 8: Verify full feature in browser**

Open `course-mapper.html` in browser (hard refresh).

**Check sidebar:**
- Each hole row should show T, F, S, G, ⬡, 🖼 indicators
- S badges are grey for holes with no spine
- Any previously saved spines appear as set (teal)

**Check spine mode (use hole 1 which has a green polygon):**
1. Click the S badge on hole 1 → enters spine mode, map flies to hole 1, draw bar shows "Spine 1 — straight"
2. Distance rings visible (grey from tee, amber from green front)
3. White measurement marker at midpoint — drag it → shows distance tooltip
4. Click on fairway → waypoint appears, bar shows "Spine 1 — 1 waypoint"
5. Drag waypoint → polyline follows live
6. Click waypoint → deletes it
7. Add two waypoints in wrong order (near green first, then near tee) → they sort correctly on dragend
8. Click ✓ Finish → saves, spine appears as persistent teal polyline
9. S badge on hole 1 turns teal
10. Click S badge again → re-enters edit mode with saved waypoints loaded

**Check mode exclusivity:**
- In spine mode, click T badge → spine exits cleanly, tee mode starts
- In tee mode, click S badge → tee mode exits cleanly, spine mode starts
- Escape key → exits whichever mode is active

**Check ✕S clear:**
- With a saved spine, click ✕S → spine deleted, badge goes grey

- [ ] **Step 9: Commit**

```bash
git add course-mapper.html
git commit -m "feat: wire spine mode to map click, keyboard, mode guards, renderHoleList S indicator"
```
