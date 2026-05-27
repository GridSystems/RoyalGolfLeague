# Fairway Polygon Recording Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record one or more fairway polygons per hole in course-mapper.html, stored in Supabase and localStorage, with a select-mode UX to edit existing polygons.

**Architecture:** Reuses the existing green-polygon draw infrastructure (`drawVerts`, `drawVertMarkers`, `drawPolyLayer`, `_exitDrawMode`, `updateDrawBar`). A new `fairwaySelectHole` state enables a pick-a-polygon-to-edit UX when a hole already has polygons. Five new state variables, eleven new functions, six modified functions. Single file: `course-mapper.html`.

**Tech Stack:** Vanilla JS, Leaflet.js, Supabase REST API, localStorage.

---

## File Structure

One file changes: `course-mapper.html`

Key insertion points (search for landmark strings):
- After `/* ── Survey panel ──` CSS comment → add `.ind-fairway` CSS
- After `let teeStripLines = []` state block → add fairway state vars
- After `sbUpsertTeeStrips` function → add `sbUpsertFairwayPolygons`
- Inside `saveAll()` → add `rgcFairwayPolygons`
- After `redrawAllPolygons()` function → add all new fairway functions
- Inside `updateDrawBar()` → add fairway branch
- Inside `_exitDrawMode()` → add fairway resets
- Inside `map.on('click', ...)` → add fairwaySelectHole + drawingFairway routing
- Inside `document.addEventListener('keydown', ...)` → add fairway Escape/Enter
- Inside `startDrawGreen()` → add fairway exit guards
- Inside `startDrawTee()` → add fairway exit guards
- Inside `renderHoleList()` → add F indicator + ✕F button
- In the `// ── Init ──` section → add `redrawAllFairwayPolygons()` call

---

### Task 1: Create Supabase table

**Files:**
- No file changes — SQL run in Supabase dashboard

- [ ] **Step 1: Run this SQL in the Supabase SQL editor** (Dashboard → SQL Editor → New query)

```sql
create table fairway_polygons (
  hole        integer not null primary key,
  polygons    jsonb   not null,
  recorded_at timestamptz default now()
);

alter table fairway_polygons enable row level security;
create policy "public read"   on fairway_polygons for select using (true);
create policy "public write"  on fairway_polygons for insert with check (true);
create policy "public update" on fairway_polygons for update using (true);
create policy "public delete" on fairway_polygons for delete using (true);
```

`polygons` stores all polygons for the hole as a JSONB array: `[ [[lat,lng],...], [[lat,lng],...] ]`.

- [ ] **Step 2: Verify the table exists**

Supabase Table Editor → `fairway_polygons` with columns: hole, polygons, recorded_at.

- [ ] **Step 3: Test REST access via PowerShell**

```powershell
$key = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF2anlidGNieW1leGhlcXJqa2FpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQzNDUyMDAsImV4cCI6MjA4OTkyMTIwMH0.ODg9C2HU4exSpTt5ABfODz_vz3v0Uz_tQsL3XAuWJ-4"
$h = @{ apikey=$key; Authorization="Bearer $key" }
Invoke-RestMethod "https://qvjybtcbymexheqrjkai.supabase.co/rest/v1/fairway_polygons?select=*" -Headers $h
```
Expected: empty array (no error).

- [ ] **Step 4: Commit empty marker**

```bash
git commit --allow-empty -m "feat: create fairway_polygons Supabase table"
```

---

### Task 2: CSS + state variables + saveAll + sbUpsertFairwayPolygons

**Files:**
- Modify: `course-mapper.html` — CSS block (~line 51), state block (~line 800), `saveAll()` (~line 1728), after `sbUpsertTeeStrips` (~line 500)

- [ ] **Step 1: Add `.ind-fairway` CSS**

Find this block (around line 51):
```css
    .ind-ovl { font-size: 11px; padding: 2px 6px; border-radius: 3px; font-weight: 700; cursor: pointer; line-height: 1.4; }
    .ind-ovl.active { background: #9b59b6; color: #fff; }
    .ind-ovl.inactive { background: #2a2a3e; color: #444; }
    .ind-ovl:hover { opacity: 0.8; }
```

Add immediately after the `.ind-ovl:hover` line:

```css
    .ind-fairway { font-size: 11px; padding: 2px 6px; border-radius: 3px; font-weight: 700; cursor: pointer; }
    .ind-fairway.set   { background: #f39c12; color: #000; }
    .ind-fairway.unset { background: #2a2a3e; color: #555; }
    .ind-fairway:hover { opacity: 0.8; }
```

- [ ] **Step 2: Add fairway state variables**

Find this block (around line 806):
```javascript
let teeStripMarkers = [];     // Leaflet markers currently on map
let teeStripLines   = [];     // Leaflet polylines currently on map
// Green overlay state
```

Add immediately after `let teeStripLines`:

```javascript
// Fairway polygon recording state
let fairwayPolygons   = JSON.parse(localStorage.getItem('rgcFairwayPolygons') || '{}');
// { [hole]: [ [[lat,lng],...], [[lat,lng],...] ] }  — array of vertex arrays per hole
let fairwayPolyLayers = {};    // { [hole]: [L.polygon, ...] }
let drawingFairway    = null;  // hole number in vertex-edit mode, or null
let drawingFairwayIdx = null;  // index in fairwayPolygons[hole] being edited; null = new polygon
let fairwaySelectHole = null;  // hole in select-mode (pick-a-polygon-to-edit), or null
```

- [ ] **Step 3: Update saveAll to persist fairwayPolygons**

Find:
```javascript
function saveAll() {
  localStorage.setItem('rgcCourseMapper', JSON.stringify(assignments));
  localStorage.setItem('rgcCourseMapperPins', JSON.stringify(customPins));
  localStorage.setItem('rgcGreenPolygons', JSON.stringify(greenPolygons));
  localStorage.setItem('rgcTeeStrips', JSON.stringify(teeStrips));
}
```

Replace with:
```javascript
function saveAll() {
  localStorage.setItem('rgcCourseMapper', JSON.stringify(assignments));
  localStorage.setItem('rgcCourseMapperPins', JSON.stringify(customPins));
  localStorage.setItem('rgcGreenPolygons', JSON.stringify(greenPolygons));
  localStorage.setItem('rgcTeeStrips', JSON.stringify(teeStrips));
  localStorage.setItem('rgcFairwayPolygons', JSON.stringify(fairwayPolygons));
}
```

- [ ] **Step 4: Add sbUpsertFairwayPolygons**

Find the end of `sbUpsertTeeStrips`. It ends with:
```javascript
  if (!ins.ok) throw new Error(await ins.text());
}
```
(followed by a blank line)

Add immediately after that closing brace:

```javascript
async function sbUpsertFairwayPolygons(hole, polygons) {
  if (!polygons.length) {
    // No polygons left — delete the row
    const r = await fetch(`${SB_URL}/rest/v1/fairway_polygons?hole=eq.${hole}`, {
      method: 'DELETE',
      headers: SB_H
    });
    if (!r.ok) throw new Error(await r.text());
    return;
  }
  const r = await fetch(`${SB_URL}/rest/v1/fairway_polygons?on_conflict=hole`, {
    method: 'POST',
    headers: { ...SB_H, 'Prefer': 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ hole, polygons })
  });
  if (!r.ok) throw new Error(await r.text());
}
```

- [ ] **Step 5: Verify in browser console**

Open mapper (hard refresh Ctrl+Shift+R), open console (F12):
```javascript
fairwayPolygons       // should log {}
fairwayPolyLayers     // should log {}
drawingFairway        // should log null
saveAll();
localStorage.getItem('rgcFairwayPolygons')  // should log '{}'
```

Test sbUpsertFairwayPolygons:
```javascript
await sbUpsertFairwayPolygons(1, [ [[55.637, 12.570],[55.6369,12.5699],[55.6368,12.5698]] ]);
// Check Supabase Table Editor — fairway_polygons should have 1 row (hole=1)
await sbUpsertFairwayPolygons(1, []);
// Row should be deleted
```

- [ ] **Step 6: Commit**

```bash
git add course-mapper.html
git commit -m "feat(fairway): add CSS, state variables, saveAll, and sbUpsertFairwayPolygons"
```

---

### Task 3: redrawAllFairwayPolygons + init call

**Files:**
- Modify: `course-mapper.html` — after `redrawAllPolygons()` (~line 1450), and init section (~line 2131)

- [ ] **Step 1: Add redrawAllFairwayPolygons after redrawAllPolygons**

Find the end of `redrawAllPolygons()`. It ends with:
```javascript
  });
}

function markerOpts(i) {
```

Insert between the `}` of `redrawAllPolygons` and `function markerOpts`:

```javascript
function redrawAllFairwayPolygons() {
  // Remove existing fairway polygon layers
  Object.values(fairwayPolyLayers).forEach(arr => arr.forEach(l => l.remove()));
  fairwayPolyLayers = {};
  Object.entries(fairwayPolygons).forEach(([hole, polygonsList]) => {
    if (!polygonsList || !polygonsList.length) return;
    fairwayPolyLayers[hole] = [];
    polygonsList.forEach(verts => {
      if (!verts || verts.length < 3) return;
      const layer = L.polygon(verts, {
        color: '#f39c12', weight: 2, fillColor: '#f39c12', fillOpacity: 0.15
      }).addTo(map);
      layer.bindTooltip('Hole ' + hole + ' fairway', { permanent: false, direction: 'center' });
      fairwayPolyLayers[hole].push(layer);
    });
  });
}
```

- [ ] **Step 2: Add redrawAllFairwayPolygons call in the init section**

Find (near the very end of the script):
```javascript
// ── Init ───────────────────────────────────────────────────────────────────
redrawAllPolygons();
renderHoleList();
```

Replace with:
```javascript
// ── Init ───────────────────────────────────────────────────────────────────
redrawAllPolygons();
redrawAllFairwayPolygons();
renderHoleList();
```

- [ ] **Step 3: Verify manually**

In console:
```javascript
fairwayPolygons[1] = [ [[55.637, 12.570],[55.6369,12.5699],[55.636,12.569]] ];
redrawAllFairwayPolygons();
```
Expected: an amber semi-transparent polygon appears on the map near hole 1.

```javascript
fairwayPolygons = {};
redrawAllFairwayPolygons();
```
Expected: polygon disappears.

- [ ] **Step 4: Commit**

```bash
git add course-mapper.html
git commit -m "feat(fairway): add redrawAllFairwayPolygons and init call"
```

---

### Task 4: Select mode — startFairwayMode, enterFairwaySelectMode, _exitFairwaySelectMode, setFairwaySelectBar

**Files:**
- Modify: `course-mapper.html` — add four functions after `redrawAllFairwayPolygons`

- [ ] **Step 1: Add the four functions immediately after `redrawAllFairwayPolygons`**

Find `function redrawAllFairwayPolygons() {` and its closing brace `}`. Place the following immediately after:

```javascript
function startFairwayMode(hole) {
  if (pinMode) togglePinMode();
  closePanel();
  if (drawingGreen !== null) cancelDrawGreen();
  if (teeDrawHole !== null) _exitTeeMode();
  if (drawingFairway !== null) cancelDrawFairway();
  if (fairwaySelectHole !== null) _exitFairwaySelectMode();

  const existing = fairwayPolygons[hole] || [];
  if (existing.length === 0) {
    // No existing polygons — go straight to vertex-edit for a new polygon
    startDrawFairway(hole, null);
  } else {
    // Existing polygons — enter select mode
    enterFairwaySelectMode(hole);
  }
}

function enterFairwaySelectMode(hole) {
  fairwaySelectHole = hole;

  // Highlight existing polygons for this hole and make them clickable
  const layers = fairwayPolyLayers[hole] || [];
  layers.forEach((layer, idx) => {
    layer.setStyle({ fillOpacity: 0.4, weight: 3 });
    layer._fwSelectHandler = e => {
      L.DomEvent.stop(e);
      startDrawFairway(hole, idx);
    };
    layer.on('click', layer._fwSelectHandler);
  });

  document.getElementById('map').classList.add('draw-mode');
  setFairwaySelectBar(hole);
}

function _exitFairwaySelectMode() {
  const layers = fairwayPolyLayers[fairwaySelectHole] || [];
  layers.forEach(layer => {
    if (layer._fwSelectHandler) {
      layer.off('click', layer._fwSelectHandler);
      delete layer._fwSelectHandler;
    }
    layer.setStyle({ fillOpacity: 0.15, weight: 2 }); // restore normal style
  });
  fairwaySelectHole = null;
  document.getElementById('map').classList.remove('draw-mode');
  document.getElementById('drawBar').style.display = 'none';
}

function setFairwaySelectBar(hole) {
  const bar = document.getElementById('drawBar');
  bar.style.display = 'flex';
  const btn = s => `style="padding:5px 12px;border-radius:5px;border:none;font-size:12px;font-weight:700;cursor:pointer;${s}"`;
  bar.innerHTML =
    `<span style="color:#f39c12;font-weight:600">Hole ${hole} — click a polygon to edit, or click map to add new</span>` +
    `<button onclick="_exitFairwaySelectMode()" ${btn('background:#e94560;color:#fff')}>✕ Cancel</button>`;
}
```

- [ ] **Step 2: Verify in browser console**

```javascript
// Seed a polygon so select mode has something to show
fairwayPolygons[5] = [ [[55.636,12.565],[55.6355,12.5645],[55.635,12.564]] ];
redrawAllFairwayPolygons();
startFairwayMode(5);
```
Expected: draw bar appears with "Hole 5 — click a polygon to edit — or click map to add new", the fairway polygon for hole 5 turns more opaque (highlight). Cancel button visible.

```javascript
_exitFairwaySelectMode();
```
Expected: draw bar disappears, fairwaySelectHole is null, polygon returns to normal opacity.

Clean up: `fairwayPolygons = {}; redrawAllFairwayPolygons();`

- [ ] **Step 3: Commit**

```bash
git add course-mapper.html
git commit -m "feat(fairway): add select mode — startFairwayMode, enterFairwaySelectMode, _exitFairwaySelectMode, setFairwaySelectBar"
```

---

### Task 5: Draw mode — setFairwayDrawBar, startDrawFairway, finishDrawFairway, cancelDrawFairway, deleteFairwayPolygon, clearFairwayPolygonsForHole

**Files:**
- Modify: `course-mapper.html` — add six functions after `setFairwaySelectBar`

- [ ] **Step 1: Add all six functions immediately after `setFairwaySelectBar`**

```javascript
function setFairwayDrawBar() {
  const bar = document.getElementById('drawBar');
  const n = drawVerts.length;
  const isEdit = drawingFairwayIdx !== null;
  const btn = s => `style="padding:5px 12px;border-radius:5px;border:none;font-size:12px;font-weight:700;cursor:pointer;${s}"`;
  if (n === 0) {
    bar.innerHTML =
      `<span style="color:#aaa;font-size:12px">Fairway ${drawingFairway} — click map to place points</span>` +
      (isEdit ? `<button onclick="deleteFairwayPolygon(${drawingFairway},${drawingFairwayIdx})" ${btn('background:#e94560;color:#fff')}>✕ Delete polygon</button>` : '') +
      `<button onclick="cancelDrawFairway()" ${btn('background:#e94560;color:#fff')}>✕ Cancel</button>`;
  } else {
    bar.innerHTML =
      `<span style="color:#f39c12;font-weight:600">Fairway ${drawingFairway} — ${n} pt${n!==1?'s':''}</span>` +
      `<button onclick="finishDrawFairway()" ${n<3?'disabled ':''} ${btn('background:#2ecc71;color:#000' + (n<3?';opacity:0.5':''))}>✓ Finish</button>` +
      `<button onclick="clearDrawVerts()" ${btn('background:#555;color:#eee')}>🗑 Clear</button>` +
      (isEdit ? `<button onclick="deleteFairwayPolygon(${drawingFairway},${drawingFairwayIdx})" ${btn('background:#e94560;color:#fff')}>✕ Delete polygon</button>` : '') +
      `<button onclick="cancelDrawFairway()" ${btn('background:#e94560;color:#fff')}>✕ Cancel</button>`;
  }
}

function startDrawFairway(hole, idx) {
  // Exit any active mode first
  if (fairwaySelectHole !== null) _exitFairwaySelectMode();
  if (teeDrawHole !== null) _exitTeeMode();
  if (drawingGreen !== null) cancelDrawGreen();
  if (drawingFairway !== null) _exitDrawMode(); // clear prior fairway vertex session

  // Hide existing fairway polygons for this hole while editing
  (fairwayPolyLayers[hole] || []).forEach(l => l.remove());
  delete fairwayPolyLayers[hole];

  drawingFairway    = hole;
  drawingFairwayIdx = idx;
  drawVerts         = [];
  drawVertMarkers   = [];
  drawPolyLayer     = null;

  // Load existing vertices if editing
  if (idx !== null && fairwayPolygons[hole] && fairwayPolygons[hole][idx]) {
    drawVerts = fairwayPolygons[hole][idx].map(v => [...v]);
    drawVerts.forEach(v => _addVertMarker(v[0], v[1]));
  }

  document.getElementById('map').classList.add('draw-mode');
  document.getElementById('drawBar').style.display = 'flex';
  setFairwayDrawBar();

  // Fly to existing vertices, other fairway polygons for context, or HOLE_TEES fallback
  if (drawVerts.length >= 3) {
    const lats = drawVerts.map(v => v[0]), lngs = drawVerts.map(v => v[1]);
    map.flyToBounds([[Math.min(...lats), Math.min(...lngs)], [Math.max(...lats), Math.max(...lngs)]],
      { padding: [60, 60], maxZoom: 20, animate: true, duration: 0.6 });
  } else if (fairwayPolygons[hole] && fairwayPolygons[hole].length > 0) {
    const allVerts = fairwayPolygons[hole].flat();
    const lats = allVerts.map(v => v[0]), lngs = allVerts.map(v => v[1]);
    map.flyToBounds([[Math.min(...lats), Math.min(...lngs)], [Math.max(...lats), Math.max(...lngs)]],
      { padding: [60, 60], maxZoom: 20, animate: true, duration: 0.6 });
  } else {
    const t = HOLE_TEES[hole - 1];
    if (t) map.flyTo([t.lat, t.lng], 18, { animate: true, duration: 0.6 });
  }
}

async function finishDrawFairway() {
  if (drawVerts.length < 3) return;
  const hole = drawingFairway;
  const idx  = drawingFairwayIdx;

  // Sort vertices by centroid angle (prevents crossing edges)
  const cx = drawVerts.reduce((s, v) => s + v[0], 0) / drawVerts.length;
  const cy = drawVerts.reduce((s, v) => s + v[1], 0) / drawVerts.length;
  const sorted = drawVerts.slice().sort((a, b) =>
    Math.atan2(a[1] - cy, a[0] - cx) - Math.atan2(b[1] - cy, b[0] - cx)
  );

  if (!fairwayPolygons[hole]) fairwayPolygons[hole] = [];
  if (idx !== null) {
    fairwayPolygons[hole][idx] = sorted;
  } else {
    fairwayPolygons[hole].push(sorted);
  }
  saveAll();

  // Save to Supabase
  const bar = document.getElementById('drawBar');
  bar.innerHTML = '<span style="color:#f39c12;font-weight:600">⏳ Saving…</span>';
  try {
    await sbUpsertFairwayPolygons(hole, fairwayPolygons[hole]);
  } catch (err) {
    console.error('finishDrawFairway:', err);
    bar.innerHTML =
      '<span style="color:#e74c3c">⚠ Save failed — ' + err.message + '</span>' +
      '<button onclick="finishDrawFairway()" style="padding:5px 12px;border-radius:5px;border:none;background:#2ecc71;color:#000;font-size:12px;font-weight:700;cursor:pointer">Retry</button>' +
      '<button onclick="cancelDrawFairway()" style="padding:5px 12px;border-radius:5px;border:none;background:#e94560;color:#fff;font-size:12px;font-weight:700;cursor:pointer">✕ Cancel</button>';
    return;
  }

  _exitDrawMode();
  redrawAllFairwayPolygons();
  renderHoleList();
}

function cancelDrawFairway() {
  _exitDrawMode();
  redrawAllFairwayPolygons(); // restore saved polygons
}

async function deleteFairwayPolygon(hole, idx) {
  if (!fairwayPolygons[hole]) return;
  fairwayPolygons[hole].splice(idx, 1);
  if (fairwayPolygons[hole].length === 0) delete fairwayPolygons[hole];
  saveAll();
  _exitDrawMode();
  try {
    await sbUpsertFairwayPolygons(hole, fairwayPolygons[hole] || []);
  } catch (err) {
    console.error('deleteFairwayPolygon Supabase error (local save succeeded):', err);
  }
  redrawAllFairwayPolygons();
  renderHoleList();
}

async function clearFairwayPolygonsForHole(hole) {
  delete fairwayPolygons[hole];
  saveAll();
  (fairwayPolyLayers[hole] || []).forEach(l => l.remove());
  delete fairwayPolyLayers[hole];
  try {
    await sbUpsertFairwayPolygons(hole, []);
  } catch (err) {
    console.error('clearFairwayPolygonsForHole Supabase error (local save succeeded):', err);
  }
  renderHoleList();
}
```

- [ ] **Step 2: Verify in browser console**

```javascript
// Test startDrawFairway (new polygon)
startDrawFairway(3, null);
```
Expected: draw bar shows "Fairway 3 — click map to place points", no delete button, Cancel button.

```javascript
// Simulate placing 4 vertices
addDrawVertex(55.636, 12.565);
addDrawVertex(55.6355, 12.5645);
addDrawVertex(55.635, 12.564);
addDrawVertex(55.6345, 12.565);
```
Expected: bar updates to "Fairway 3 — 4 pts", Finish enabled.

```javascript
// Test finish
await finishDrawFairway();
```
Expected: saving banner briefly, then bar disappears, amber polygon appears on map. `fairwayPolygons[3]` should have 1 polygon. Check Supabase Table Editor — fairway_polygons should have a row for hole 3.

```javascript
// Test edit (re-enter for hole 3, edit polygon 0)
startDrawFairway(3, 0);
```
Expected: vertices of existing polygon load as draggable dots, bar shows "Fairway 3 — 4 pts", Delete polygon button visible.

```javascript
// Test delete
await deleteFairwayPolygon(3, 0);
```
Expected: polygon removed from map. `fairwayPolygons[3]` should be undefined. Supabase row should be gone.

Clean up if needed: `fairwayPolygons = {}; redrawAllFairwayPolygons();`

- [ ] **Step 3: Commit**

```bash
git add course-mapper.html
git commit -m "feat(fairway): add draw mode — setFairwayDrawBar, startDrawFairway, finishDrawFairway, cancelDrawFairway, deleteFairwayPolygon, clearFairwayPolygonsForHole"
```

---

### Task 6: Integration wiring — map click, Escape/Enter, guards, updateDrawBar, _exitDrawMode, renderHoleList

**Files:**
- Modify: `course-mapper.html` — six targeted edits

- [ ] **Step 1: Update `updateDrawBar()` to dispatch to fairway draw bar when in fairway mode**

Find:
```javascript
function updateDrawBar() {
  setDrawBarState('vertex-edit');
}
```

Replace with:
```javascript
function updateDrawBar() {
  if (drawingFairway !== null) {
    setFairwayDrawBar();
  } else {
    setDrawBarState('vertex-edit');
  }
}
```

- [ ] **Step 2: Update `_exitDrawMode()` to also reset fairway draw state**

Find:
```javascript
function _exitDrawMode() {
  drawVerts = [];
  drawVertMarkers.forEach(m => m.remove()); drawVertMarkers = [];
  if (drawPolyLayer) { drawPolyLayer.remove(); drawPolyLayer = null; }
  drawingGreen = null;
  detectMode = false;
```

Replace with:
```javascript
function _exitDrawMode() {
  drawVerts = [];
  drawVertMarkers.forEach(m => m.remove()); drawVertMarkers = [];
  if (drawPolyLayer) { drawPolyLayer.remove(); drawPolyLayer = null; }
  drawingGreen     = null;
  drawingFairway   = null;
  drawingFairwayIdx = null;
  detectMode = false;
```

- [ ] **Step 3: Update `map.on('click', ...)` to route fairway select and fairway vertex-edit**

Find:
```javascript
map.on('click', e => {
  if (teeDrawHole !== null) {
    const target = e.originalEvent && e.originalEvent.target;
    const onMarkerOrLine = target && (
      target.closest('.leaflet-marker-icon') ||
      target.tagName === 'path' ||
      target.tagName === 'PATH'
    );
    if (!onMarkerOrLine) handleTeeClick(e.latlng.lat, e.latlng.lng);
    return;
  }
  if (drawingGreen !== null) {
```

Replace with:
```javascript
map.on('click', e => {
  if (teeDrawHole !== null) {
    const target = e.originalEvent && e.originalEvent.target;
    const onMarkerOrLine = target && (
      target.closest('.leaflet-marker-icon') ||
      target.tagName === 'path' ||
      target.tagName === 'PATH'
    );
    if (!onMarkerOrLine) handleTeeClick(e.latlng.lat, e.latlng.lng);
    return;
  }
  if (fairwaySelectHole !== null) {
    // Polygon click handlers have L.DomEvent.stop(e), so reaching here means empty map click
    const target = e.originalEvent && e.originalEvent.target;
    const onPoly = target && (target.tagName === 'path' || target.tagName === 'PATH');
    if (!onPoly) startDrawFairway(fairwaySelectHole, null);
    return;
  }
  if (drawingFairway !== null) {
    addDrawVertex(e.latlng.lat, e.latlng.lng);
    return;
  }
  if (drawingGreen !== null) {
```

- [ ] **Step 4: Update the `keydown` handler to handle fairway Escape and Enter**

Find:
```javascript
  if (e.key === 'Escape') {
    if (teeDrawHole !== null) { cancelDrawTee(); return; }
    if (drawingGreen !== null) { cancelDrawGreen(); return; }
  }
  if (drawingGreen === null) return;
  if (e.key === 'Enter' && drawVerts.length >= 3 && !detectMode) finishDrawGreen();
```

Replace with:
```javascript
  if (e.key === 'Escape') {
    if (teeDrawHole !== null) { cancelDrawTee(); return; }
    if (fairwaySelectHole !== null) { _exitFairwaySelectMode(); return; }
    if (drawingFairway !== null) { cancelDrawFairway(); return; }
    if (drawingGreen !== null) { cancelDrawGreen(); return; }
  }
  if (drawingGreen === null && drawingFairway === null) return;
  if (e.key === 'Enter' && drawVerts.length >= 3 && !detectMode) {
    if (drawingFairway !== null) finishDrawFairway();
    else finishDrawGreen();
  }
```

- [ ] **Step 5: Add fairway exit guards to `startDrawGreen()` and `startDrawTee()`**

In `startDrawGreen`, find:
```javascript
  if (teeDrawHole !== null) _exitTeeMode(); // exit tee mode before entering green draw

  drawingGreen = hole;
```

Replace with:
```javascript
  if (teeDrawHole !== null) _exitTeeMode(); // exit tee mode before entering green draw
  if (fairwaySelectHole !== null) _exitFairwaySelectMode();
  if (drawingFairway !== null) cancelDrawFairway();

  drawingGreen = hole;
```

In `startDrawTee`, find:
```javascript
  if (drawingGreen !== null) return; // don't open tee mode during green draw
  if (teeDrawHole !== null) _exitTeeMode(); // clean up any prior tee session
```

Replace with:
```javascript
  if (drawingGreen !== null) return; // don't open tee mode during green draw
  if (teeDrawHole !== null) _exitTeeMode(); // clean up any prior tee session
  if (fairwaySelectHole !== null) _exitFairwaySelectMode();
  if (drawingFairway !== null) cancelDrawFairway();
```

- [ ] **Step 6: Update `renderHoleList()` to add F indicator and ✕F button**

Find:
```javascript
    const poly = greenPolygons[h];
    const hasPoly = poly && poly.length >= 3;
    const teeStripsForHole = teeStrips[h] || [];
    const hasTeeStrips = teeStripsForHole.length > 0;
```

Replace with:
```javascript
    const poly = greenPolygons[h];
    const hasPoly = poly && poly.length >= 3;
    const teeStripsForHole = teeStrips[h] || [];
    const hasTeeStrips = teeStripsForHole.length > 0;
    const fairwayPolysForHole = fairwayPolygons[h] || [];
    const hasFairway = fairwayPolysForHole.length > 0;
```

Find the T indicator line:
```javascript
        '<span class="indicator ind-tee ' + (hasTeeStrips ? 'set' : 'unset') + '"' +
          ' onclick="startDrawTee(' + h + ')"' +
          ' title="' + (hasTeeStrips ? teeStripsForHole.length + ' strip' + (teeStripsForHole.length !== 1 ? 's' : '') + ' — click to edit' : 'Record tee strips') + '">' +
          'T' + (hasTeeStrips ? teeStripsForHole.length : '') + '</span>' +
```

Add the F indicator immediately after the T indicator (before the G indicator):
```javascript
        '<span class="indicator ind-tee ' + (hasTeeStrips ? 'set' : 'unset') + '"' +
          ' onclick="startDrawTee(' + h + ')"' +
          ' title="' + (hasTeeStrips ? teeStripsForHole.length + ' strip' + (teeStripsForHole.length !== 1 ? 's' : '') + ' — click to edit' : 'Record tee strips') + '">' +
          'T' + (hasTeeStrips ? teeStripsForHole.length : '') + '</span>' +
        '<span class="indicator ind-fairway ' + (hasFairway ? 'set' : 'unset') + '"' +
          ' onclick="startFairwayMode(' + h + ')"' +
          ' title="' + (hasFairway ? fairwayPolysForHole.length + ' polygon' + (fairwayPolysForHole.length !== 1 ? 's' : '') + ' — click to edit' : 'Record fairway') + '">' +
          'F' + (hasFairway ? fairwayPolysForHole.length : '') + '</span>' +
```

Find the ✕⬡ clear button line:
```javascript
        (hasPoly ? '<button class="clr" onclick="clearGreenPolygon('+h+')">✕⬡</button>' : '') +
```

Add ✕F immediately after ✕⬡:
```javascript
        (hasPoly ? '<button class="clr" onclick="clearGreenPolygon('+h+')">✕⬡</button>' : '') +
        (hasFairway ? '<button class="clr" onclick="clearFairwayPolygonsForHole('+h+')">✕F</button>' : '') +
```

- [ ] **Step 7: Full end-to-end test in browser**

1. Hard refresh (`Ctrl+Shift+R`)
2. Sidebar: all F indicators should be grey with no number
3. Click **F** for hole 7 → draw bar shows "Fairway 7 — click map to place points"
4. Click 4+ points around the hole 7 fairway area → dots appear, bar shows "Fairway 7 — N pts"
5. Press **Enter** or click **✓ Finish** → "Saving…" briefly, then bar disappears
6. F7 indicator turns amber showing **F1**
7. Click F7 again → draw bar shows select mode "click a polygon to edit..."
8. The polygon brightens to indicate it's clickable
9. Click on the polygon → vertices load as draggable dots (edit mode), Delete polygon button visible
10. Drag a vertex to reposition it → ✓ Finish → saved
11. Enter select mode again → click empty map → new polygon vertex-edit starts
12. Add a second polygon → F7 shows **F2**
13. Press **Escape** → cancelled, both polygons visible
14. **✕F** button in sidebar → all fairway polygons for hole 7 deleted
15. Check Supabase Table Editor — fairway_polygons should reflect all operations

- [ ] **Step 8: Commit**

```bash
git add course-mapper.html
git commit -m "feat(fairway): wire map click, Escape/Enter, mode guards, updateDrawBar, _exitDrawMode, renderHoleList F indicator"
```

- [ ] **Step 9: Push**

```bash
git push origin main
```
