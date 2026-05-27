# Tee Strip Recording Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record front and back GPS points for each tee strip on every hole and persist them to Supabase.

**Architecture:** Single file `course-mapper.html`. New state variables parallel the existing green polygon pattern. A guided draw bar (Back active → Front active → auto-swivel) collects strip points. `finishDrawTee()` writes localStorage then immediately upserts to Supabase using delete-then-insert to handle renumbering.

**Tech Stack:** Vanilla JS, Leaflet.js, Supabase REST API, localStorage.

---

## File Structure

One file changes: `course-mapper.html`

Insertion points (use these line numbers as approximate guides — search for the landmark strings):
- After `let detectInFlight` — add tee strip state variables
- After `sbUpsertGreenPolygon` function — add `sbUpsertTeeStrips`
- Inside `saveAll()` — add `rgcTeeStrips` persistence
- After `function _exitDrawMode` block — add all tee draw functions
- Inside `map.on('click', ...)` — add `teeDrawHole` routing at top
- Inside `renderHoleList()` — update T indicator

---

### Task 1: Create Supabase table

**Files:**
- No file changes — SQL run in Supabase dashboard

- [ ] **Step 1: Run this SQL in the Supabase SQL editor** (Dashboard → SQL Editor → New query)

```sql
create table tee_strips (
  hole        integer not null,
  strip_num   integer not null,
  back_lat    numeric not null,
  back_lng    numeric not null,
  front_lat   numeric not null,
  front_lng   numeric not null,
  recorded_at timestamptz default now(),
  primary key (hole, strip_num)
);

alter table tee_strips enable row level security;
create policy "public read"   on tee_strips for select using (true);
create policy "public write"  on tee_strips for insert with check (true);
create policy "public update" on tee_strips for update using (true);
create policy "public delete" on tee_strips for delete using (true);
```

- [ ] **Step 2: Verify the table exists**

In Supabase Table Editor you should see `tee_strips` with columns: hole, strip_num, back_lat, back_lng, front_lat, front_lng, recorded_at.

- [ ] **Step 3: Test REST access**

Run in PowerShell (or curl):
```powershell
$key = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF2anlidGNieW1leGhlcXJqa2FpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQzNDUyMDAsImV4cCI6MjA4OTkyMTIwMH0.ODg9C2HU4exSpTt5ABfODz_vz3v0Uz_tQsL3XAuWJ-4"
$h = @{ apikey=$key; Authorization="Bearer $key" }
Invoke-RestMethod "https://qvjybtcbymexheqrjkai.supabase.co/rest/v1/tee_strips?select=*" -Headers $h
```
Expected: empty array `[]` (no error).

- [ ] **Step 4: Commit**
```bash
git commit --allow-empty -m "feat: create tee_strips Supabase table"
```

---

### Task 2: State variables + saveAll

**Files:**
- Modify: `course-mapper.html` — after `let detectInFlight` line, and inside `saveAll()`

- [ ] **Step 1: Find the landmark** — search for `let detectInFlight = false;`

It looks like this (around line 772):
```javascript
let detectInFlight  = false;   // guard against concurrent invocations
```

- [ ] **Step 2: Add tee strip state variables immediately after that line**

```javascript
// Tee strip recording state
let teeStrips       = JSON.parse(localStorage.getItem('rgcTeeStrips') || '{}');
// { [hole]: [{back:[lat,lng], front:[lat,lng]}, ...] }  index = strip_num - 1
let teeDrawHole     = null;   // hole number 1-18 being recorded, or null
let teeDrawState    = null;   // 'back' | 'front' | null
let teeInProgress   = [];     // working copy of strips for current hole
let teePartialBack  = null;   // [lat,lng] of placed back point awaiting front
let teeStripMarkers = [];     // Leaflet markers currently on map
let teeStripLines   = [];     // Leaflet polylines currently on map
```

- [ ] **Step 3: Find saveAll** — search for `function saveAll()`. It looks like:

```javascript
function saveAll() {
  localStorage.setItem('rgcCourseMapper', JSON.stringify(assignments));
  localStorage.setItem('rgcCourseMapperPins', JSON.stringify(customPins));
  localStorage.setItem('rgcGreenPolygons', JSON.stringify(greenPolygons));
}
```

- [ ] **Step 4: Add teeStrips persistence to saveAll**

```javascript
function saveAll() {
  localStorage.setItem('rgcCourseMapper', JSON.stringify(assignments));
  localStorage.setItem('rgcCourseMapperPins', JSON.stringify(customPins));
  localStorage.setItem('rgcGreenPolygons', JSON.stringify(greenPolygons));
  localStorage.setItem('rgcTeeStrips', JSON.stringify(teeStrips));
}
```

- [ ] **Step 5: Verify in browser console**

Open the mapper, open console (F12), run:
```javascript
teeStrips        // should log {}
teeDrawHole      // should log null
saveAll(); localStorage.getItem('rgcTeeStrips')  // should log '{}'
```

- [ ] **Step 6: Commit**
```bash
git add course-mapper.html
git commit -m "feat(tee): add tee strip state variables and localStorage persistence"
```

---

### Task 3: sbUpsertTeeStrips function

**Files:**
- Modify: `course-mapper.html` — after `sbUpsertGreenPolygon` function

- [ ] **Step 1: Find the landmark** — search for `async function sbUpsertGreenPolygon`. It ends with:

```javascript
  if(!r.ok)throw new Error(await r.text());
}
```

- [ ] **Step 2: Add sbUpsertTeeStrips immediately after**

```javascript
async function sbUpsertTeeStrips(hole, strips) {
  // Delete all existing strips for this hole (handles renumbering cleanly)
  const del = await fetch(`${SB_URL}/rest/v1/tee_strips?hole=eq.${hole}`, {
    method: 'DELETE',
    headers: SB_H
  });
  if (!del.ok) throw new Error(await del.text());

  if (!strips.length) return; // nothing to insert

  // Insert all strips with their new strip_nums (1-based)
  const rows = strips.map((s, i) => ({
    hole,
    strip_num: i + 1,
    back_lat:  s.back[0],
    back_lng:  s.back[1],
    front_lat: s.front[0],
    front_lng: s.front[1]
  }));
  const ins = await fetch(`${SB_URL}/rest/v1/tee_strips`, {
    method: 'POST',
    headers: { ...SB_H, 'Prefer': 'return=minimal' },
    body: JSON.stringify(rows)
  });
  if (!ins.ok) throw new Error(await ins.text());
}
```

- [ ] **Step 3: Test from browser console**

In console:
```javascript
await sbUpsertTeeStrips(1, [
  { back: [55.637, 12.570], front: [55.6369, 12.5699] }
]);
```
Expected: no error. Then check Supabase Table Editor — `tee_strips` should have one row: hole=1, strip_num=1.

Clean up:
```javascript
await sbUpsertTeeStrips(1, []); // deletes it again
```

- [ ] **Step 4: Commit**
```bash
git add course-mapper.html
git commit -m "feat(tee): add sbUpsertTeeStrips with delete-then-insert strategy"
```

---

### Task 4: Draw bar — CSS + setTeeBarState

**Files:**
- Modify: `course-mapper.html` — CSS block near top, and new function after `updateDrawBar`

- [ ] **Step 1: Find the CSS landmark** — search for `.ind-tee.unset`. It looks like:

```css
.ind-tee.set { background: #2196F3; color: #fff; cursor: pointer; }
.ind-tee.unset { background: #2a2a3e; color: #555; }
```

- [ ] **Step 2: Make the unset T indicator also show pointer cursor** (clicking it will open recording mode)

```css
.ind-tee.set   { background: #2196F3; color: #fff; cursor: pointer; }
.ind-tee.unset { background: #2a2a3e; color: #555; cursor: pointer; }
```

- [ ] **Step 3: Find the landmark for setTeeBarState** — search for `function updateDrawBar()`. It looks like:

```javascript
function updateDrawBar() {
  setDrawBarState('vertex-edit');
}
```

- [ ] **Step 4: Add setTeeBarState immediately after updateDrawBar**

```javascript
function setTeeBarState(state) {
  teeDrawState = state;
  const bar = document.getElementById('drawBar');
  const backActive  = state === 'back';
  const frontActive = state === 'front';
  const n = teeInProgress.length;
  const btn = s => `style="padding:5px 12px;border-radius:5px;border:none;font-size:12px;font-weight:700;cursor:pointer;${s}"`;
  bar.innerHTML =
    `<button onclick="setTeeBarState('back')"  ${btn('background:' + (backActive  ? '#2196F3;color:#fff' : '#2a2a3e;color:#aaa'))}>● Back</button>` +
    `<button onclick="setTeeBarState('front')" ${btn('background:' + (frontActive ? '#ffd700;color:#000' : '#2a2a3e;color:#aaa'))}>● Front</button>` +
    (n > 0 ? `<span style="color:#2ecc71;font-size:11px;font-weight:600">${n} strip${n!==1?'s':''}</span>` : '') +
    `<button onclick="finishDrawTee()"  ${n===0?'disabled ':''} ${btn('background:#2ecc71;color:#000' + (n===0?';opacity:0.4':''))}>✓ Finish</button>` +
    `<button onclick="clearTeeStrips()" ${btn('background:#555;color:#eee')}>🗑 Clear</button>` +
    `<button onclick="cancelDrawTee()"  ${btn('background:#e94560;color:#fff')}>✕ Cancel</button>`;
}
```

- [ ] **Step 5: Verify in console**

```javascript
document.getElementById('drawBar').style.display = 'flex';
teeInProgress = [];
setTeeBarState('back');
```
Expected: draw bar appears with Back button highlighted blue, Front dim, Finish disabled.

```javascript
teeInProgress = [{ back:[0,0], front:[0,0] }];
setTeeBarState('front');
```
Expected: Front button highlighted gold, "1 strip" label shows, Finish enabled.

Clean up: `document.getElementById('drawBar').style.display = 'none'; teeInProgress = [];`

- [ ] **Step 6: Commit**
```bash
git add course-mapper.html
git commit -m "feat(tee): add setTeeBarState draw bar renderer"
```

---

### Task 5: startDrawTee, _exitTeeMode, cancelDrawTee

**Files:**
- Modify: `course-mapper.html` — add three functions after `function _exitDrawMode`

- [ ] **Step 1: Find the landmark** — search for `function _exitDrawMode()`. It ends with:

```javascript
  document.getElementById('drawBar').style.display = 'none';
}
```

- [ ] **Step 2: Add the three functions immediately after that closing brace**

```javascript
function startDrawTee(hole) {
  if (pinMode) togglePinMode();
  closePanel();
  if (drawingGreen !== null) return; // don't open tee mode during green draw

  teeDrawHole   = hole;
  teeInProgress = (teeStrips[hole] || []).map(s => ({ back: [...s.back], front: [...s.front] }));
  teePartialBack = null;

  document.getElementById('map').classList.add('draw-mode');
  document.getElementById('drawBar').style.display = 'flex';
  setTeeBarState('back');

  // Fly to existing strips if any, else fall back to HOLE_TEES hardcoded reference
  if (teeInProgress.length > 0) {
    const allLats = teeInProgress.flatMap(s => [s.back[0], s.front[0]]);
    const allLngs = teeInProgress.flatMap(s => [s.back[1], s.front[1]]);
    map.flyToBounds(
      [[Math.min(...allLats), Math.min(...allLngs)], [Math.max(...allLats), Math.max(...allLngs)]],
      { padding: [60, 60], maxZoom: 20, animate: true, duration: 0.6 }
    );
  } else {
    const t = HOLE_TEES[hole - 1];
    if (t) map.flyTo([t.lat, t.lng], 19, { animate: true, duration: 0.6 });
  }

  redrawTeeMarkers();
}

function _exitTeeMode() {
  teeStripMarkers.forEach(m => m.remove()); teeStripMarkers = [];
  teeStripLines.forEach(l => l.remove());   teeStripLines   = [];
  teeDrawHole    = null;
  teeDrawState   = null;
  teeInProgress  = [];
  teePartialBack = null;
  document.getElementById('map').classList.remove('draw-mode');
  document.getElementById('drawBar').style.display = 'none';
}

function cancelDrawTee() {
  _exitTeeMode();
}
```

- [ ] **Step 3: Verify in browser console**

```javascript
startDrawTee(1);
```
Expected: draw bar appears, map flies to hole 1 area, Back button active.

```javascript
cancelDrawTee();
```
Expected: draw bar disappears, teeDrawHole is null.

- [ ] **Step 4: Commit**
```bash
git add course-mapper.html
git commit -m "feat(tee): add startDrawTee, _exitTeeMode, cancelDrawTee"
```

---

### Task 6: handleTeeClick + completeTeeStrip

**Files:**
- Modify: `course-mapper.html` — add two functions after `cancelDrawTee`

- [ ] **Step 1: Add handleTeeClick and completeTeeStrip immediately after cancelDrawTee**

```javascript
function handleTeeClick(lat, lng) {
  if (teeDrawState === 'back') {
    // Place back edge point and swivel to front
    teePartialBack = [lat, lng];
    setTeeBarState('front');
    redrawTeeMarkers();
  } else if (teeDrawState === 'front') {
    // Place front edge point — strip is complete
    if (!teePartialBack) {
      // Shouldn't happen, but guard: reset to back state
      setTeeBarState('back');
      return;
    }
    completeTeeStrip([lat, lng]);
  }
}

function completeTeeStrip(frontLatLng) {
  teeInProgress.push({ back: teePartialBack, front: frontLatLng });
  teePartialBack = null;
  setTeeBarState('back'); // ready for next strip
  redrawTeeMarkers();
}
```

- [ ] **Step 2: Verify manually**

In console:
```javascript
startDrawTee(1);
handleTeeClick(55.637, 12.570);   // places back point
// bar should now show Front active
handleTeeClick(55.6369, 12.5699); // places front point — strip 1 complete
// bar shows Back active again, "1 strip" label visible
```

- [ ] **Step 3: Commit**
```bash
git add course-mapper.html
git commit -m "feat(tee): add handleTeeClick and completeTeeStrip"
```

---

### Task 7: redrawTeeMarkers

**Files:**
- Modify: `course-mapper.html` — add `redrawTeeMarkers` after `completeTeeStrip`

- [ ] **Step 1: Add redrawTeeMarkers**

```javascript
function redrawTeeMarkers() {
  // Clear existing map layers
  teeStripMarkers.forEach(m => m.remove()); teeStripMarkers = [];
  teeStripLines.forEach(l => l.remove());   teeStripLines   = [];

  const backIcon  = L.divIcon({
    className: '',
    html: '<div style="width:10px;height:10px;background:#e74c3c;border:1.5px solid #fff;border-radius:50%;margin:-5px 0 0 -5px;cursor:grab"></div>',
    iconSize: [10, 10], iconAnchor: [5, 5]
  });
  const frontIcon = L.divIcon({
    className: '',
    html: '<div style="width:10px;height:10px;background:#ffd700;border:1.5px solid #fff;border-radius:50%;margin:-5px 0 0 -5px;cursor:grab"></div>',
    iconSize: [10, 10], iconAnchor: [5, 5]
  });

  // Draw completed strips
  teeInProgress.forEach((strip, idx) => {
    const backM = L.marker(strip.back, { icon: backIcon, draggable: true }).addTo(map);
    backM.on('click', e => { L.DomEvent.stopPropagation(e); deleteTeeStrip(idx); });
    backM.on('drag',  e => {
      teeInProgress[idx].back = [e.latlng.lat, e.latlng.lng];
      if (teeStripLines[idx]) teeStripLines[idx].setLatLngs([teeInProgress[idx].back, teeInProgress[idx].front]);
    });

    const frontM = L.marker(strip.front, { icon: frontIcon, draggable: true }).addTo(map);
    frontM.on('click', e => { L.DomEvent.stopPropagation(e); deleteTeeStrip(idx); });
    frontM.on('drag',  e => {
      teeInProgress[idx].front = [e.latlng.lat, e.latlng.lng];
      if (teeStripLines[idx]) teeStripLines[idx].setLatLngs([teeInProgress[idx].back, teeInProgress[idx].front]);
    });

    teeStripMarkers.push(backM, frontM);

    const line = L.polyline([strip.back, strip.front], {
      color: '#2196F3', weight: 3, opacity: 0.85
    }).addTo(map);
    line.on('click', e => { L.DomEvent.stopPropagation(e); deleteTeeStrip(idx); });
    line.bindTooltip('S' + (idx + 1), { permanent: true, direction: 'center' });
    teeStripLines.push(line);
  });

  // Draw partial back point if awaiting front
  if (teePartialBack) {
    const pm = L.marker(teePartialBack, { icon: backIcon, draggable: true }).addTo(map);
    pm.on('drag', e => { teePartialBack = [e.latlng.lat, e.latlng.lng]; });
    teeStripMarkers.push(pm);
  }
}
```

- [ ] **Step 2: Verify manually**

```javascript
startDrawTee(1);
handleTeeClick(55.637, 12.570);
handleTeeClick(55.6369, 12.5699);
```
Expected: red marker (back) and gold marker (front) on map, connected by a blue line labelled "S1".

Drag either marker — line should update in real time.

- [ ] **Step 3: Commit**
```bash
git add course-mapper.html
git commit -m "feat(tee): add redrawTeeMarkers with drag-to-reposition"
```

---

### Task 8: deleteTeeStrip + clearTeeStrips

**Files:**
- Modify: `course-mapper.html` — add two functions after `redrawTeeMarkers`

- [ ] **Step 1: Add deleteTeeStrip and clearTeeStrips**

```javascript
function deleteTeeStrip(idx) {
  teeInProgress.splice(idx, 1);
  setTeeBarState(teeDrawState || 'back'); // refresh strip count in bar
  redrawTeeMarkers();
}

function clearTeeStrips() {
  teeInProgress  = [];
  teePartialBack = null;
  setTeeBarState('back');
  redrawTeeMarkers();
}
```

- [ ] **Step 2: Verify manually**

```javascript
startDrawTee(1);
handleTeeClick(55.637,  12.570);
handleTeeClick(55.6369, 12.5699);
handleTeeClick(55.6365, 12.569);
handleTeeClick(55.6364, 12.5689);
// Should show 2 strips
deleteTeeStrip(0);
// Should show 1 strip (S1 renumbered)
clearTeeStrips();
// Should show 0 strips, Back active
```

- [ ] **Step 3: Commit**
```bash
git add course-mapper.html
git commit -m "feat(tee): add deleteTeeStrip and clearTeeStrips"
```

---

### Task 9: finishDrawTee

**Files:**
- Modify: `course-mapper.html` — add `finishDrawTee` after `clearTeeStrips`

- [ ] **Step 1: Add finishDrawTee**

```javascript
async function finishDrawTee() {
  if (teeInProgress.length === 0) return;
  const hole = teeDrawHole;

  // Save to localStorage
  teeStrips[hole] = teeInProgress.map(s => ({ back: [...s.back], front: [...s.front] }));
  saveAll();

  // Push to Supabase
  const bar = document.getElementById('drawBar');
  const origHTML = bar.innerHTML;
  bar.innerHTML = '<span style="color:#2ecc71;font-weight:600">⏳ Saving…</span>';
  try {
    await sbUpsertTeeStrips(hole, teeStrips[hole]);
  } catch (err) {
    console.error('finishDrawTee:', err);
    bar.innerHTML = '<span style="color:#e74c3c">⚠ Save failed — ' + err.message + '</span>' +
      '<button onclick="finishDrawTee()" style="padding:5px 12px;border-radius:5px;border:none;background:#2ecc71;color:#000;font-size:12px;font-weight:700;cursor:pointer">Retry</button>' +
      '<button onclick="cancelDrawTee()"  style="padding:5px 12px;border-radius:5px;border:none;background:#e94560;color:#fff;font-size:12px;font-weight:700;cursor:pointer">✕ Cancel</button>';
    return;
  }

  _exitTeeMode();
  renderHoleList();
}
```

- [ ] **Step 2: Verify manually**

```javascript
startDrawTee(1);
handleTeeClick(55.637,  12.570);
handleTeeClick(55.6369, 12.5699);
await finishDrawTee();
```
Expected: "Saving…" briefly, then bar disappears. Check Supabase Table Editor — `tee_strips` should have 1 row for hole 1. Check `localStorage.getItem('rgcTeeStrips')` — should have hole "1" with 1 strip.

- [ ] **Step 3: Commit**
```bash
git add course-mapper.html
git commit -m "feat(tee): add finishDrawTee with localStorage + Supabase save"
```

---

### Task 10: Wire map click + update renderHoleList + sidebar T indicator

**Files:**
- Modify: `course-mapper.html` — map click handler, renderHoleList

- [ ] **Step 1: Find the map click handler** — search for `map.on('click', e => {`. It starts with:

```javascript
map.on('click', e => {
  if (drawingGreen !== null) {
```

- [ ] **Step 2: Add teeDrawHole routing at the very top of the click handler**

```javascript
map.on('click', e => {
  if (teeDrawHole !== null) {
    handleTeeClick(e.latlng.lat, e.latlng.lng);
    return;
  }
  if (drawingGreen !== null) {
```

- [ ] **Step 3: Find the T indicator in renderHoleList** — search for `ind-tee`. It looks like:

```javascript
'<span class="indicator ind-tee ' + (teeIdx !== null ? 'set' : 'unset') + '"' +
  (teeIdx !== null ? ' title="Stay #'+(teeIdx+1)+'" onclick="focusStay('+teeIdx+')"' : '') +
  '>T' + (teeIdx !== null ? ' '+(teeIdx+1) : '') + '</span>' +
```

- [ ] **Step 4: Replace the T indicator span with a tee-strips-aware version**

```javascript
const teeStripsForHole = teeStrips[h] || [];
const hasTeeStrips = teeStripsForHole.length > 0;
```

Add that before the `row.innerHTML =` line, then replace the T indicator span with:

```javascript
'<span class="indicator ind-tee ' + (hasTeeStrips ? 'set' : 'unset') + '"' +
  ' onclick="startDrawTee(' + h + ')"' +
  ' title="' + (hasTeeStrips ? teeStripsForHole.length + ' strip' + (teeStripsForHole.length !== 1 ? 's' : '') + ' — click to edit' : 'Record tee strips') + '">' +
  'T' + (hasTeeStrips ? teeStripsForHole.length : '') + '</span>' +
```

- [ ] **Step 5: Verify the complete modified renderHoleList T section looks like this**

```javascript
function renderHoleList() {
  const list = document.getElementById('holeList');
  list.innerHTML = '';
  let done = 0;
  for (let h = 1; h <= 18; h++) {
    const teeIdx   = getAssignedIdx('tee', h);
    const greenIdx = getAssignedIdx('green', h);
    if (teeIdx !== null && greenIdx !== null) done++;
    const poly = greenPolygons[h];
    const hasPoly = poly && poly.length >= 3;
    const teeStripsForHole = teeStrips[h] || [];
    const hasTeeStrips = teeStripsForHole.length > 0;
    const row = document.createElement('div');
    row.className = 'hole-row';
    row.innerHTML =
      '<div class="hole-num">' + h + '</div>' +
      '<div class="hole-indicators">' +
        '<span class="indicator ind-tee ' + (hasTeeStrips ? 'set' : 'unset') + '"' +
          ' onclick="startDrawTee(' + h + ')"' +
          ' title="' + (hasTeeStrips ? teeStripsForHole.length + ' strip' + (teeStripsForHole.length !== 1 ? 's' : '') + ' — click to edit' : 'Record tee strips') + '">' +
          'T' + (hasTeeStrips ? teeStripsForHole.length : '') + '</span>' +
        '<span class="indicator ind-green ' + (greenIdx !== null ? 'set' : 'unset') + '"' +
          (greenIdx !== null ? ' title="Stay #'+(greenIdx+1)+'" onclick="focusStay('+greenIdx+')"' : '') +
          '>G' + (greenIdx !== null ? ' '+(greenIdx+1) : '') + '</span>' +
        '<span class="ind-poly ' + (hasPoly ? 'set' : 'unset') + '" onclick="startDrawGreen('+h+')" title="' + (hasPoly ? poly.length+' pts — click to redraw' : 'Draw green polygon') + '">' +
          (hasPoly ? '⬡ '+poly.length : '⬡') + '</span>' +
        '<span class="ind-ovl ' + (overlayHole === h ? 'active' : 'inactive') + '" onclick="activateOverlay('+h+')" title="' + (overlaySaved[h] ? 'Overlay saved — click to restore' : 'Show green diagram overlay') + '">' + (overlaySaved[h] ? '🖼💾' : '🖼') + '</span>' +
      '</div>' +
      '<div class="hole-clears">' +
        (teeIdx !== null ? '<button class="clr" onclick="clearHoleType(\'tee\','+h+')">✕T</button>' : '') +
        (greenIdx !== null ? '<button class="clr" onclick="clearHoleType(\'green\','+h+')">✕G</button>' : '') +
        (hasPoly ? '<button class="clr" onclick="clearGreenPolygon('+h+')">✕⬡</button>' : '') +
      '</div>';
    list.appendChild(row);
  }
  document.getElementById('status').textContent = done + ' / 18 holes mapped';
  const btn = document.getElementById('exportBtn');
  btn.classList.toggle('ready', done === 18);
  btn.textContent = done === 18 ? 'Export JSON' : 'Export JSON (' + done + '/18)';
}
```

- [ ] **Step 6: Full end-to-end test in browser**

1. Hard refresh (`Ctrl+Shift+R`)
2. Sidebar: all T indicators should be grey with no number
3. Click T indicator for hole 1 → draw bar appears with Back active, map flies to hole 1
4. Click on the map near the back edge of hole 1's tee box → red dot appears, bar flips to Front
5. Click near the front edge → blue line appears connecting the two dots, labelled "S1", bar shows "1 strip"
6. Repeat for a second strip → line "S2" appears
7. Click a line or marker → that strip is deleted
8. Click ✓ Finish → "Saving…" then bar disappears
9. Sidebar T indicator for hole 1 turns blue showing the strip count
10. Click T indicator again → existing strips load as editable markers
11. Check Supabase: `tee_strips` should have correct rows for hole 1

- [ ] **Step 7: Commit**
```bash
git add course-mapper.html
git commit -m "feat(tee): wire map click handler and update sidebar T indicator"
```

- [ ] **Step 8: Push**
```bash
git push origin main
```
