# Survey Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an on-course GPS survey panel to `course-mapper.html` so multiple users can record fixed course features (tee boxes, fairway extents, green front/back, distance markers, hazard edges) that persist to Supabase and are shared across all users.

**Architecture:** A floating panel div overlaid on the Leaflet map, toggled by a topbar button. State lives in a JS array `surveyPoints` loaded from Supabase on open. Record/delete operations hit Supabase immediately; the local array is the in-memory cache. A single `renderSurveyPanel()` function re-renders the entire panel body on every state change.

**Tech Stack:** Vanilla JS, `navigator.geolocation` (high accuracy), Supabase REST API (raw fetch, same pattern as `index.html`), single `course-mapper.html`.

**Note:** The spec doc said "localStorage only" — this plan supersedes that and uses Supabase throughout.

---

## Files

- Modify: `course-mapper.html` (all changes — CSS, HTML, JS)
- Modify: `supabase/grants.sql` (add `survey_points` grant)
- No new files

---

### Task 1: Create survey_points table in Supabase + update grants

**Files:**
- Modify: `supabase/grants.sql`

- [ ] **Step 1: Run this SQL in the Supabase SQL Editor** (project `qvjybtcbymexheqrjkai`)

```sql
CREATE TABLE IF NOT EXISTS public.survey_points (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hole        smallint NOT NULL CHECK (hole BETWEEN 1 AND 18),
  type        text NOT NULL,
  lat         double precision NOT NULL,
  lng         double precision NOT NULL,
  accuracy    real NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.survey_points TO anon, authenticated;
```

- [ ] **Step 2: Verify in Supabase dashboard**

Open Table Editor → confirm `survey_points` table exists with columns: `id`, `hole`, `type`, `lat`, `lng`, `accuracy`, `recorded_at`.

Insert one test row manually, then delete it.

- [ ] **Step 3: Update grants.sql to document the new table**

In `supabase/grants.sql`, add this line after the `gps_shots` grant:

```sql
GRANT SELECT, INSERT, UPDATE, DELETE ON public.survey_points TO anon, authenticated;
```

- [ ] **Step 4: Commit**

```bash
git add supabase/grants.sql
git commit -m "feat: add survey_points table to Supabase"
```

---

### Task 2: Add Supabase helpers + survey constants to course-mapper.html

**Files:**
- Modify: `course-mapper.html` (inside `<script>`, at the very top, right after `<script>` on line 157)

- [ ] **Step 1: Insert Supabase helpers and survey constants**

Find the line `<script>` (line 157, the inline script tag, not the Leaflet CDN script tag). Insert immediately after it:

```js
// ── Supabase (survey_points only) ──────────────────────────────────────────
const SB_URL  = 'https://qvjybtcbymexheqrjkai.supabase.co';
const SB_KEY  = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF2anlidGNieW1leGhlcXJqa2FpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQzNDUyMDAsImV4cCI6MjA4OTkyMTIwMH0.ODg9C2HU4exSpTt5ABfODz_vz3v0Uz_tQsL3XAuWJ-4';
const SB_H    = {'Content-Type':'application/json','apikey':SB_KEY,'Authorization':'Bearer '+SB_KEY};
async function sbSurveyGet(){
  const r=await fetch(`${SB_URL}/rest/v1/survey_points?select=*&order=recorded_at.asc`,{headers:SB_H});
  if(!r.ok)throw new Error(await r.text());
  return r.json();
}
async function sbSurveyInsert(b){
  const r=await fetch(`${SB_URL}/rest/v1/survey_points`,{method:'POST',headers:{...SB_H,'Prefer':'return=representation'},body:JSON.stringify(b)});
  if(!r.ok)throw new Error(await r.text());
  return r.json();
}
async function sbSurveyDelete(id){
  const r=await fetch(`${SB_URL}/rest/v1/survey_points?id=eq.${id}`,{method:'DELETE',headers:SB_H});
  if(!r.ok)throw new Error(await r.text());
}

// ── Survey feature config ───────────────────────────────────────────────────
const SURVEY_FEATURES = [
  { type:'tee',          label:'Tee',          icon:'🏌️', multi:true  },
  { type:'fairway_start',label:'Fairway start', icon:'🌿', multi:false },
  { type:'fairway_end',  label:'Fairway end',   icon:'🌾', multi:false },
  { type:'bunker',       label:'Bunker',        icon:'🟡', multi:true  },
  { type:'water',        label:'Water',         icon:'💧', multi:true  },
  { type:'front_green',  label:'Front green',   icon:'⛳', multi:false },
  { type:'back_green',   label:'Back green',    icon:'🏁', multi:false },
  { type:'dist_200',     label:'200m',          icon:'📏', multi:false },
  { type:'dist_150',     label:'150m',          icon:'📏', multi:false },
  { type:'dist_100',     label:'100m',          icon:'📏', multi:false },
];
const SURVEY_COLORS = {
  tee:'#2196F3', fairway_start:'#27ae60', fairway_end:'#f39c12',
  bunker:'#d4a843', water:'#3498db', front_green:'#1abc9c',
  back_green:'#e74c3c', dist_200:'#9b59b6', dist_150:'#9b59b6', dist_100:'#9b59b6',
};

```

- [ ] **Step 2: Verify the page still loads without JS errors**

Open `course-mapper.html` in a browser. Open DevTools console. Confirm no errors. The page should look and work exactly as before.

- [ ] **Step 3: Commit**

```bash
git add course-mapper.html
git commit -m "feat: add Supabase helpers + SURVEY_FEATURES constants to course-mapper"
```

---

### Task 3: Add survey panel CSS

**Files:**
- Modify: `course-mapper.html` (inside `<style>`, before the closing `</style>` tag)

- [ ] **Step 1: Insert CSS before `</style>`**

Find `  </style>` (line 77). Insert immediately before it:

```css
    /* ── Survey panel ──────────────────────────────────────────────────────── */
    #surveyBtn { padding: 7px 14px; border-radius: 6px; border: 1px solid #555; background: none; color: #aaa; font-size: 13px; font-weight: 600; cursor: pointer; white-space: nowrap; }
    #surveyBtn.active { background: #e94560; color: #fff; border-color: #e94560; }
    #surveyPanel {
      position: fixed; z-index: 1003; top: 56px; left: 50%; transform: translateX(-50%);
      width: 92vw; max-width: 420px; max-height: calc(100vh - 70px); overflow-y: auto;
      background: #16213e; border: 1px solid #e94560; border-radius: 10px;
      box-shadow: 0 8px 32px rgba(0,0,0,.7);
    }
    #surveyPanel .sv-header {
      display: flex; align-items: center; gap: 8px; padding: 10px 14px;
      border-bottom: 1px solid #0f3460; position: sticky; top: 0; background: #16213e; z-index: 1;
    }
    #surveyPanel .sv-title { font-size: 14px; font-weight: 700; color: #e94560; flex: 1; }
    #surveyPanel .sv-close { background: none; border: none; color: #666; font-size: 18px; cursor: pointer; padding: 2px 6px; }
    #surveyPanel .sv-body { padding: 12px 14px; display: flex; flex-direction: column; gap: 12px; }
    .sv-section-label { font-size: 10px; text-transform: uppercase; letter-spacing: 1.2px; color: #556; font-weight: 700; margin-bottom: 4px; }
    .sv-hole-row { display: flex; flex-wrap: wrap; gap: 5px; }
    .sv-hole-btn { width: 36px; height: 36px; border-radius: 7px; border: 1px solid #2a2a4e; background: #1a1a3e; color: #888; font-size: 12px; font-weight: 700; cursor: pointer; display: flex; align-items: center; justify-content: center; position: relative; }
    .sv-hole-btn.sv-hole-sel { background: #e94560; border-color: #e94560; color: #fff; }
    .sv-hole-btn.sv-hole-dot::after { content: ''; position: absolute; bottom: 3px; right: 3px; width: 5px; height: 5px; border-radius: 50%; background: #27ae60; }
    .sv-feat-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 6px; }
    .sv-feat-btn { padding: 9px 4px; border-radius: 7px; border: 1px solid #2a2a4e; background: #1a1a3e; color: #aaa; font-size: 11px; font-weight: 600; cursor: pointer; text-align: center; line-height: 1.4; }
    .sv-feat-btn.sv-feat-sel { background: #0f3460; border-color: #4a90d9; color: #fff; }
    .sv-feat-btn.sv-feat-rec { border-color: #27ae60; color: #4caf50; }
    .sv-note { background: #1a1a0e; border: 1px solid #3a3a1a; border-radius: 7px; padding: 7px 10px; font-size: 11px; color: #888; line-height: 1.5; }
    .sv-gps-row { background: #0d1a2e; border: 1px solid #1a3a5e; border-radius: 7px; padding: 9px 12px; display: flex; align-items: center; justify-content: space-between; }
    .sv-gps-coords { font-size: 11px; color: #4a90d9; font-family: monospace; }
    .sv-gps-good { font-size: 11px; color: #4caf50; font-weight: 700; }
    .sv-gps-poor { font-size: 11px; color: #ff9800; font-weight: 700; }
    .sv-action-row { display: flex; gap: 8px; }
    .sv-btn-refresh { flex: 1; padding: 12px; border-radius: 8px; border: 1px solid #4a90d9; background: #0f3460; color: #7bb8f0; font-size: 13px; font-weight: 700; cursor: pointer; }
    .sv-btn-record  { flex: 1; padding: 12px; border-radius: 8px; border: none; background: #27ae60; color: #fff; font-size: 13px; font-weight: 700; cursor: pointer; }
    .sv-list-header { font-size: 11px; text-transform: uppercase; letter-spacing: 0.8px; color: #556; display: flex; justify-content: space-between; align-items: center; }
    .sv-list-count  { color: #27ae60; font-size: 12px; text-transform: none; letter-spacing: 0; }
    .sv-list-empty  { font-size: 12px; color: #444; text-align: center; padding: 8px; }
    .sv-list        { background: #0d1a2e; border: 1px solid #1a3a5e; border-radius: 7px; overflow: hidden; }
    .sv-list-item   { padding: 7px 10px; border-top: 1px solid #1a2a3e; display: flex; align-items: center; gap: 8px; }
    .sv-list-item:first-child { border-top: none; }
    .sv-list-dot    { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
    .sv-list-name   { color: #ccc; flex: 1; font-size: 12px; }
    .sv-list-acc    { color: #556; font-size: 10px; }
    .sv-list-del    { background: none; border: none; color: #e94560; font-size: 18px; cursor: pointer; padding: 0 2px; line-height: 1; }
    .sv-copy-btn    { width: 100%; padding: 10px; border-radius: 7px; border: 1px solid #555; background: none; color: #aaa; font-size: 12px; font-weight: 600; cursor: pointer; }
```

- [ ] **Step 2: Verify no visual regressions**

Open `course-mapper.html`. The page should look identical to before (no new visible elements yet — the CSS is ready but no HTML uses it).

- [ ] **Step 3: Commit**

```bash
git add course-mapper.html
git commit -m "feat: add survey panel CSS"
```

---

### Task 4: Add surveyPanel HTML + topbar button

**Files:**
- Modify: `course-mapper.html` (HTML section)

- [ ] **Step 1: Add the Survey button to the topbar**

Find this exact line in the topbar:
```html
  <button id="copyOverlayBtn" onclick="copyOverlaySettings()" title="Copy saved overlay settings to clipboard">📋 Copy Overlays</button>
```

Add immediately after it (on the next line):
```html
  <button id="surveyBtn" onclick="toggleSurveyPanel()">📍 Survey</button>
```

- [ ] **Step 2: Add the surveyPanel div**

Find this exact line (end of the overlayBar div):
```html
  <button onclick="removeOverlay()" style="background:#e94560;color:#fff">✕ Remove</button>
</div>
```

Add immediately after that closing `</div>` (before the `<div id="legend">` line):
```html

<div id="surveyPanel" style="display:none">
  <div class="sv-header">
    <span class="sv-title">📍 Survey Mode</span>
    <button class="sv-close" onclick="toggleSurveyPanel()">✕</button>
  </div>
  <div class="sv-body" id="surveyPanelBody">
    <!-- rendered by renderSurveyPanel() -->
  </div>
</div>
```

- [ ] **Step 3: Verify**

Open `course-mapper.html`. You should see a `📍 Survey` button in the topbar. Clicking it does nothing yet (no JS). No console errors.

- [ ] **Step 4: Commit**

```bash
git add course-mapper.html
git commit -m "feat: add survey panel HTML skeleton + topbar button"
```

---

### Task 5: Add survey state variables + loadSurveyPoints()

**Files:**
- Modify: `course-mapper.html` (JS section)

- [ ] **Step 1: Add state variables after the existing state block**

Find this exact line:
```js
let hazardVisible   = true;
```

Add immediately after it:
```js

// ── Survey state ────────────────────────────────────────────────────────────
let surveyPanelOpen = false;
let surveyHole      = 1;
let surveyFeature   = 'front_green';
let surveyGpsPos    = null;
let surveyPoints    = [];
```

- [ ] **Step 2: Add loadSurveyPoints() before the `// ── Init ──` section**

Find this exact line:
```js
// ── Init ───────────────────────────────────────────────────────────────────
```

Add immediately before it:
```js
// ── Survey data load ────────────────────────────────────────────────────────
async function loadSurveyPoints() {
  try {
    surveyPoints = await sbSurveyGet();
  } catch (e) {
    console.warn('Could not load survey points from Supabase:', e);
    surveyPoints = [];
  }
}

```

- [ ] **Step 3: Verify**

Open `course-mapper.html`. Open DevTools console. Run `loadSurveyPoints()` manually. It should resolve without error (logs a warning only if Supabase is unreachable). `surveyPoints` should be an empty array (table is empty).

- [ ] **Step 4: Commit**

```bash
git add course-mapper.html
git commit -m "feat: add survey state variables + loadSurveyPoints()"
```

---

### Task 6: Add renderSurveyPanel()

**Files:**
- Modify: `course-mapper.html` (JS section, before `// ── Init ──`)

- [ ] **Step 1: Add renderSurveyPanel() and the two setter helpers**

Find the line:
```js
// ── Survey data load ────────────────────────────────────────────────────────
```

Add immediately before it:
```js
// ── Survey panel render ─────────────────────────────────────────────────────
function setSurveyHole(h) { surveyHole = h; renderSurveyPanel(); }
function setSurveyFeature(t) { surveyFeature = t; renderSurveyPanel(); }

function renderSurveyPanel() {
  if (!surveyPanelOpen) return;
  const body = document.getElementById('surveyPanelBody');

  // Hole selector
  let holeHtml = '<div class="sv-section-label">Hole</div><div class="sv-hole-row">';
  for (let h = 1; h <= 18; h++) {
    const hasDot = surveyPoints.some(p => p.hole === h);
    holeHtml += `<button class="sv-hole-btn${h===surveyHole?' sv-hole-sel':''}${hasDot?' sv-hole-dot':''}" onclick="setSurveyHole(${h})">${h}</button>`;
  }
  holeHtml += '</div>';

  // Feature grid
  let featHtml = '<div class="sv-section-label">Feature</div><div class="sv-feat-grid">';
  for (const f of SURVEY_FEATURES) {
    const isSel = surveyFeature === f.type;
    const isRec = !f.multi && surveyPoints.some(p => p.hole === surveyHole && p.type === f.type);
    featHtml += `<button class="sv-feat-btn${isSel?' sv-feat-sel':''}${isRec?' sv-feat-rec':''}" onclick="setSurveyFeature('${f.type}')">${f.icon}<br><span>${f.label}${isRec?' ✓':''}</span></button>`;
  }
  featHtml += '</div>';

  // Instruction note for multi-instance features
  const feat = SURVEY_FEATURES.find(f => f.type === surveyFeature);
  let noteHtml = '';
  if (feat && feat.multi) {
    const cnt = surveyPoints.filter(p => p.hole === surveyHole && p.type === surveyFeature).length;
    noteHtml = `<div class="sv-note">${feat.icon} <b>${feat.label}</b> — tap Record each time you're at a new one. ${cnt > 0 ? cnt + ' recorded.' : ''}</div>`;
  }

  // GPS readout
  let gpsHtml;
  if (!surveyGpsPos) {
    gpsHtml = '<div class="sv-gps-row"><span class="sv-gps-coords" style="color:#556">Fetching GPS…</span><span style="color:#556;font-size:11px">—</span></div>';
  } else {
    const acc = surveyGpsPos.coords.accuracy.toFixed(0);
    gpsHtml = `<div class="sv-gps-row"><span class="sv-gps-coords">${surveyGpsPos.coords.latitude.toFixed(5)}°N&nbsp;&nbsp;${surveyGpsPos.coords.longitude.toFixed(5)}°E</span><span class="${acc<=3?'sv-gps-good':'sv-gps-poor'}">±${acc}m</span></div>`;
  }

  // Action buttons
  const actionHtml = `<div class="sv-action-row"><button class="sv-btn-refresh" onclick="fetchSurveyGps()">↻ Refresh GPS</button><button class="sv-btn-record" id="surveyRecordBtn" onclick="recordSurveyPoint()">✓ Record</button></div>`;

  // Recorded list for this hole
  const holePoints = surveyPoints.filter(p => p.hole === surveyHole);
  const multiIdx = {};
  const labelled = holePoints.map(p => {
    const f = SURVEY_FEATURES.find(f => f.type === p.type);
    if (f && f.multi) { multiIdx[p.type] = (multiIdx[p.type] || 0) + 1; return {...p, label: `${f.label} #${multiIdx[p.type]}`}; }
    return {...p, label: f ? f.label : p.type};
  });

  let listHtml = `<div class="sv-list-header"><span>Recorded — Hole ${surveyHole}</span><span class="sv-list-count">${holePoints.length} point${holePoints.length!==1?'s':''}</span></div>`;
  if (holePoints.length === 0) {
    listHtml += '<div class="sv-list-empty">No points yet for this hole.</div>';
  } else {
    listHtml += '<div class="sv-list">' + labelled.map(p =>
      `<div class="sv-list-item"><span class="sv-list-dot" style="background:${SURVEY_COLORS[p.type]||'#888'}"></span><span class="sv-list-name">${p.label}</span><span class="sv-list-acc">±${p.accuracy.toFixed(0)}m</span><button class="sv-list-del" onclick="deleteSurveyPoint('${p.id}')">×</button></div>`
    ).join('') + '</div>';
  }

  // Copy button footer
  const copyHtml = '<button class="sv-copy-btn" id="surveyCopyBtn" onclick="copySurveyData()">📋 Copy Survey Data</button>';

  body.innerHTML = holeHtml + featHtml + noteHtml + gpsHtml + actionHtml + listHtml + copyHtml;
}

```

- [ ] **Step 2: Verify**

Open DevTools console. Run:
```js
surveyPanelOpen = true;
renderSurveyPanel();
```
The survey panel body should now show the hole grid, feature grid, GPS readout ("Fetching GPS…"), action buttons, empty list, and copy button.

- [ ] **Step 3: Commit**

```bash
git add course-mapper.html
git commit -m "feat: add renderSurveyPanel()"
```

---

### Task 7: Add toggleSurveyPanel() + fetchSurveyGps()

**Files:**
- Modify: `course-mapper.html` (JS section, before `// ── Survey panel render ──`)

- [ ] **Step 1: Add toggle and GPS functions**

Find the line:
```js
// ── Survey panel render ─────────────────────────────────────────────────────
```

Add immediately before it:
```js
// ── Survey panel toggle + GPS ───────────────────────────────────────────────
function toggleSurveyPanel() {
  surveyPanelOpen = !surveyPanelOpen;
  document.getElementById('surveyPanel').style.display = surveyPanelOpen ? 'block' : 'none';
  document.getElementById('surveyBtn').classList.toggle('active', surveyPanelOpen);
  if (surveyPanelOpen) {
    renderSurveyPanel();
    fetchSurveyGps();
  }
}

function fetchSurveyGps() {
  surveyGpsPos = null;
  renderSurveyPanel();
  if (!navigator.geolocation) {
    console.warn('Geolocation not available');
    return;
  }
  navigator.geolocation.getCurrentPosition(
    pos => { surveyGpsPos = pos; renderSurveyPanel(); },
    err => { console.warn('GPS error', err.code, err.message); renderSurveyPanel(); },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
  );
}

```

- [ ] **Step 2: Verify toggle works**

Open `course-mapper.html`. Click `📍 Survey`. The panel should slide open showing the hole grid, feature grid, and "Fetching GPS…". The button should turn red (active). Click ✕ to close. Click again to reopen.

On desktop the GPS will likely be rejected (no hardware) or show a low-accuracy reading — that's expected. The readout should update once the browser responds.

- [ ] **Step 3: Commit**

```bash
git add course-mapper.html
git commit -m "feat: add toggleSurveyPanel() + fetchSurveyGps()"
```

---

### Task 8: Add recordSurveyPoint(), deleteSurveyPoint(), copySurveyData() + init call

**Files:**
- Modify: `course-mapper.html` (JS section)

- [ ] **Step 1: Add record/delete/copy functions**

Find the line:
```js
// ── Survey data load ────────────────────────────────────────────────────────
```

Add immediately before it:
```js
// ── Survey record / delete / copy ───────────────────────────────────────────
async function recordSurveyPoint() {
  if (!surveyGpsPos) {
    const btn = document.getElementById('surveyRecordBtn');
    if (btn) { btn.textContent = '⚠ Fetch GPS first'; setTimeout(() => { btn.textContent = '✓ Record'; }, 1500); }
    return;
  }
  const feat = SURVEY_FEATURES.find(f => f.type === surveyFeature);
  // Single-instance: delete existing same-hole same-type rows first
  if (feat && !feat.multi) {
    const existing = surveyPoints.filter(p => p.hole === surveyHole && p.type === surveyFeature);
    for (const p of existing) {
      try { await sbSurveyDelete(p.id); } catch(e) { console.error('Delete old point failed:', e); }
    }
    surveyPoints = surveyPoints.filter(p => !(p.hole === surveyHole && p.type === surveyFeature));
  }
  const payload = {
    hole:     surveyHole,
    type:     surveyFeature,
    lat:      surveyGpsPos.coords.latitude,
    lng:      surveyGpsPos.coords.longitude,
    accuracy: surveyGpsPos.coords.accuracy,
  };
  try {
    const [inserted] = await sbSurveyInsert(payload);
    surveyPoints.push(inserted);
    renderSurveyPanel();
    const btn = document.getElementById('surveyRecordBtn');
    if (btn) {
      btn.textContent = '✓ Saved!';
      btn.style.background = '#2ecc71';
      setTimeout(() => { btn.textContent = '✓ Record'; btn.style.background = ''; }, 1200);
    }
  } catch (e) {
    console.error('Failed to save survey point:', e);
    const btn = document.getElementById('surveyRecordBtn');
    if (btn) { btn.textContent = '⚠ Save failed'; setTimeout(() => { btn.textContent = '✓ Record'; }, 2000); }
  }
}

async function deleteSurveyPoint(id) {
  try {
    await sbSurveyDelete(id);
    surveyPoints = surveyPoints.filter(p => p.id !== id);
    renderSurveyPanel();
  } catch (e) {
    console.error('Failed to delete survey point:', e);
  }
}

function copySurveyData() {
  navigator.clipboard.writeText(JSON.stringify(surveyPoints, null, 2)).then(() => {
    const btn = document.getElementById('surveyCopyBtn');
    if (btn) {
      btn.textContent = '✓ Copied!';
      btn.style.background = '#27ae60';
      btn.style.color = '#fff';
      setTimeout(() => { btn.textContent = '📋 Copy Survey Data'; btn.style.background = ''; btn.style.color = ''; }, 1500);
    }
  });
}

```

- [ ] **Step 2: Call loadSurveyPoints() in the init section**

Find these exact lines at the very bottom of the script:
```js
redrawAllPolygons();
renderHoleList();
```

Add one line after them:
```js
loadSurveyPoints();
```

- [ ] **Step 3: Delete the mockup file**

```bash
git rm course-mapper.html  # no — delete only the mockup
```

Actually just delete `survey-mockup.html`:
```bash
git rm survey-mockup.html
```

- [ ] **Step 4: Full end-to-end verification**

Open `course-mapper.html` in a browser.

a. Click `📍 Survey`. Panel opens. Hole 1 selected. Front green selected. "Fetching GPS…" shown.

b. On desktop GPS will fail or show very poor accuracy. Click `↻ Refresh GPS`. After a few seconds the readout shows coordinates and accuracy.

c. Click `✓ Record`. If GPS is available: button briefly shows "✓ Saved!", then resets. The recorded list at the bottom shows one entry. If GPS is not available: button shows "⚠ Fetch GPS first".

d. Check Supabase Table Editor → `survey_points`. Confirm the row exists with correct hole, type, lat, lng, accuracy.

e. Click the `×` delete button next to the recorded entry. Row disappears from list. Confirm it's also gone from Supabase.

f. Select Hole 2, select Tee. Note the instruction note appears: "tap Record each time you're at a new one." Record twice (if GPS available). Confirm two separate rows appear in the list and in Supabase.

g. Click `📋 Copy Survey Data`. Paste into a text editor. Confirm valid JSON array.

h. Close the panel (✕). Click 📍 Survey again. Survey points are still there (loaded from Supabase).

- [ ] **Step 5: Commit**

```bash
git add course-mapper.html
git rm survey-mockup.html
git commit -m "feat: add recordSurveyPoint, deleteSurveyPoint, copySurveyData + init load"
```

---

## Self-review

**Spec coverage check:**
- ✅ Topbar button (Task 4)
- ✅ Hole selector with green dot indicators (Task 6)
- ✅ Feature grid — 10 buttons, icon + label, selected + recorded states (Task 6)
- ✅ Instruction note for multi-instance features (Task 6)
- ✅ GPS readout with accuracy colour coding (Task 6)
- ✅ Refresh GPS + Record buttons (Tasks 7, 8)
- ✅ Recorded list with coloured dots, accuracy, delete (Task 6)
- ✅ Copy Survey Data button in panel footer (Tasks 6, 8)
- ✅ Multi-instance (tee/bunker/water): append each tap (Task 8)
- ✅ Single-instance: replace on re-record (Task 8)
- ✅ Supabase persistence — insert on record, delete on delete (Tasks 1, 8)
- ✅ Load on open (Task 5 + init)

**No placeholders found.**

**Type consistency:** `surveyPoints`, `surveyHole`, `surveyFeature`, `surveyGpsPos` used consistently across all tasks. `SURVEY_FEATURES[n].multi`, `.type`, `.label`, `.icon` match throughout. `SURVEY_COLORS[type]` keyed on same strings as `SURVEY_FEATURES[n].type`.
