# Green Polygon Tracing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user trace a green's edge by clicking satellite imagery in course-mapper, step through all 18 holes to review, push the polygons to a new `green_polygons` Supabase table, and have the main app compute front/mid/back distances dynamically from the player's live position.

**Architecture:** New `green_polygons` table (one row per hole, vertices as JSONB array). Course-mapper gains a "Review & Push" panel that shows each hole's drawn polygon with tee-relative front/mid/back preview dots; a single button upserts all traced holes to Supabase. Main app loads polygons on init and replaces the static `survey_points` green distance lookup with a live closest/furthest/midpoint computation.

**Tech Stack:** Vanilla JS, Leaflet.js, Supabase REST (PostgREST). No build step.

---

## File Map

| File | Change |
|---|---|
| `supabase/grants.sql` | Add `green_polygons` grant |
| `course-mapper.html` | CSS + HTML for review panel; `haversineM`, `HOLE_TEES`, `sbUpsertGreenPolygon`; full review panel logic |
| `index.html` | `greenPolygons` global; `getGreenDistances()`; extend `loadData()`; modify `toggleGreenZoom()` |

---

## Task 1: Supabase schema + grants

**Files:**
- Modify: `supabase/grants.sql`
- SQL to run manually in Supabase SQL Editor

- [ ] **Step 1: Run CREATE TABLE in Supabase SQL Editor**

Open the Supabase project `qvjybtcbymexheqrjkai` → SQL Editor → New Query. Paste and run:

```sql
CREATE TABLE IF NOT EXISTS public.green_polygons (
  hole        int PRIMARY KEY,
  vertices    jsonb NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now()
);
```

Expected: "Success. No rows returned."

- [ ] **Step 2: Verify table exists**

In Supabase Table Editor, confirm `green_polygons` appears in the list with columns `hole`, `vertices`, `recorded_at`.

- [ ] **Step 3: Add grant to grants.sql**

Open `supabase/grants.sql`. After the last `GRANT` line (currently `GRANT ... ON public.survey_points TO anon, authenticated;`), add:

```sql
GRANT SELECT, INSERT, UPDATE, DELETE ON public.green_polygons TO anon, authenticated;
```

- [ ] **Step 4: Run the grant in Supabase SQL Editor**

Paste and run:

```sql
GRANT SELECT, INSERT, UPDATE, DELETE ON public.green_polygons TO anon, authenticated;
```

Expected: "Success. No rows returned."

- [ ] **Step 5: Commit**

```bash
git add supabase/grants.sql
git commit -m "feat: add green_polygons table and grant"
```

---

## Task 2: course-mapper.html — haversineM, HOLE_TEES, sbUpsertGreenPolygon

**Files:**
- Modify: `course-mapper.html`

These are all purely additive — no existing behaviour changes.

- [ ] **Step 1: Add `haversineM` and `HOLE_TEES` after the Supabase API functions**

In `course-mapper.html`, find the `sbSurveyDelete` function ending (around line 250):

```javascript
async function sbSurveyDelete(id){
  const r=await fetch(`${SB_URL}/rest/v1/survey_points?id=eq.${id}`,{method:'DELETE',headers:SB_H});
  if(!r.ok)throw new Error(await r.text());
}
```

Insert immediately after it:

```javascript
// ── Green polygon utilities ──────────────────────────────────────────────
function haversineM(lat1,lng1,lat2,lng2){
  const R=6371000,rad=Math.PI/180;
  const dLat=(lat2-lat1)*rad,dLng=(lng2-lng1)*rad;
  const a=Math.sin(dLat/2)**2+Math.cos(lat1*rad)*Math.cos(lat2*rad)*Math.sin(dLng/2)**2;
  return Math.round(R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a)));
}

// Tee coordinates for all 18 holes (mirrored from index.html HOLE_DATA)
const HOLE_TEES=[
  {lat:55.637862,lng:12.570713}, // 1
  {lat:55.634847,lng:12.568994}, // 2
  {lat:55.637352,lng:12.572616}, // 3
  {lat:55.633469,lng:12.570590}, // 4
  {lat:55.633084,lng:12.569760}, // 5
  {lat:55.631495,lng:12.566455}, // 6
  {lat:55.632920,lng:12.562059}, // 7
  {lat:55.632275,lng:12.564736}, // 8
  {lat:55.636408,lng:12.566115}, // 9
  {lat:55.638637,lng:12.569938}, // 10
  {lat:55.635984,lng:12.565173}, // 11
  {lat:55.633464,lng:12.562049}, // 12
  {lat:55.637022,lng:12.564473}, // 13
  {lat:55.637122,lng:12.561879}, // 14
  {lat:55.633755,lng:12.559955}, // 15
  {lat:55.636370,lng:12.559528}, // 16
  {lat:55.635574,lng:12.556691}, // 17
  {lat:55.638948,lng:12.565195}, // 18
];

async function sbUpsertGreenPolygon(hole,vertices){
  const r=await fetch(`${SB_URL}/rest/v1/green_polygons`,{
    method:'POST',
    headers:{...SB_H,'Prefer':'resolution=merge-duplicates,return=minimal'},
    body:JSON.stringify({hole,vertices})
  });
  if(!r.ok)throw new Error(await r.text());
}
```

- [ ] **Step 2: Verify syntax — open course-mapper.html in browser**

Open `course-mapper.html` directly in a browser (File → Open). Open DevTools console. Confirm no JS errors on load.

- [ ] **Step 3: Commit**

```bash
git add course-mapper.html
git commit -m "feat(mapper): add haversineM, HOLE_TEES, sbUpsertGreenPolygon"
```

---

## Task 3: course-mapper.html — Review panel CSS + HTML + state

**Files:**
- Modify: `course-mapper.html`

- [ ] **Step 1: Add CSS for review panel and button**

In the `<style>` block, find the survey panel CSS block that starts `/* ── Survey panel ──` (around line 77). Insert immediately after the closing brace of `#surveyPanel .sv-body { ... }` rule (which ends around line 92):

```css
    /* ── Review panel ──────────────────────────────────────────────────────── */
    #reviewBtn { padding: 7px 14px; border-radius: 6px; border: 1px solid #555; background: none; color: #aaa; font-size: 13px; font-weight: 600; cursor: pointer; white-space: nowrap; }
    #reviewBtn.active { background: #27ae60; color: #fff; border-color: #27ae60; }
    #reviewPanel {
      position: fixed; z-index: 1003; top: 56px; left: 50%; transform: translateX(-50%);
      width: 92vw; max-width: 460px; max-height: calc(100vh - 70px); overflow-y: auto;
      background: #16213e; border: 1px solid #27ae60; border-radius: 10px;
      box-shadow: 0 8px 32px rgba(0,0,0,.7);
    }
```

- [ ] **Step 2: Add the Review button to the topbar**

Find the topbar HTML (around line 145–153):

```html
  <button id="surveyBtn" onclick="toggleSurveyPanel()">📍 Survey</button>
```

Add immediately after it:

```html
  <button id="reviewBtn" onclick="toggleReviewPanel()">🟢 Review</button>
```

- [ ] **Step 3: Add the review panel div to the HTML**

Find the survey panel HTML (around line 205):

```html
<div id="surveyPanel" style="display:none">
  <div class="sv-header">
    <span class="sv-title">📍 Survey Mode</span>
    <button class="sv-close" onclick="toggleSurveyPanel()">✕</button>
  </div>
  <div class="sv-body" id="surveyPanelBody">
    <!-- rendered by renderSurveyPanel() -->
```

Insert a new div **before** `<div id="surveyPanel"`:

```html
<div id="reviewPanel" style="display:none">
  <div class="sv-header">
    <span class="sv-title" style="color:#27ae60">🟢 Review &amp; Push Greens</span>
    <button class="sv-close" onclick="toggleReviewPanel()">✕</button>
  </div>
  <div class="sv-body" id="reviewPanelBody">
    <!-- rendered by renderReviewPanel() -->
  </div>
</div>

```

- [ ] **Step 4: Add review panel state variables**

Find the line (around line 523):

```javascript
let surveyPanelOpen = false;
```

Add immediately after:

```javascript
let reviewPanelOpen = false;
let reviewHole      = 1;
let reviewDotLayers = [];
```

- [ ] **Step 5: Add `toggleReviewPanel()` function**

Find `function toggleSurveyPanel()` in the JS. Add a new function immediately before it:

```javascript
function toggleReviewPanel(){
  reviewPanelOpen=!reviewPanelOpen;
  const panel=document.getElementById('reviewPanel');
  const btn=document.getElementById('reviewBtn');
  panel.style.display=reviewPanelOpen?'':'none';
  btn.classList.toggle('active',reviewPanelOpen);
  if(reviewPanelOpen){renderReviewPanel();selectReviewHole(reviewHole);}
  else{clearReviewDots();}
}
```

- [ ] **Step 6: Verify in browser**

Open `course-mapper.html`. Confirm:
- "🟢 Review" button appears in the topbar
- Clicking it opens an empty panel (no errors)
- Clicking ✕ closes it

- [ ] **Step 7: Commit**

```bash
git add course-mapper.html
git commit -m "feat(mapper): add review panel HTML, CSS, and toggle"
```

---

## Task 4: course-mapper.html — renderReviewPanel + selectReviewHole + navigation

**Files:**
- Modify: `course-mapper.html`

- [ ] **Step 1: Add the rendering and navigation functions**

Find `function toggleReviewPanel()` (just added in Task 3). Add immediately **after** it:

```javascript
function renderReviewPanel(){
  const body=document.getElementById('reviewPanelBody');
  if(!body)return;
  const traced=Object.keys(greenPolygons).filter(h=>greenPolygons[h]&&greenPolygons[h].length>=3);

  // Hole status bar
  let barHtml='<div class="sv-section-label">Holes — click to inspect</div><div class="sv-hole-row">';
  for(let h=1;h<=18;h++){
    const has=greenPolygons[h]&&greenPolygons[h].length>=3;
    const active=h===reviewHole;
    barHtml+=`<button class="sv-hole-btn${active?' active':''}"
      style="${has?'border-color:#27ae60;color:#27ae60':''}"
      onclick="selectReviewHole(${h})"
      title="Hole ${h}${has?' — ✓ traced':' — not traced'}">${h}${has?'✓':''}</button>`;
  }
  barHtml+='</div>';

  // Nav row
  const has=greenPolygons[reviewHole]&&greenPolygons[reviewHole].length>=3;
  const pts=has?greenPolygons[reviewHole].length:0;
  const navHtml=`<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
    <button class="sv-close" onclick="reviewPrevHole()" style="font-size:16px;padding:4px 10px;border:1px solid #555;border-radius:6px;color:#ccc;background:none;cursor:pointer">←</button>
    <span style="font-weight:700;color:#e0e0e0;font-size:14px;">Hole ${reviewHole}</span>
    <button class="sv-close" onclick="reviewNextHole()" style="font-size:16px;padding:4px 10px;border:1px solid #555;border-radius:6px;color:#ccc;background:none;cursor:pointer">→</button>
    <span style="font-size:12px;color:${has?'#27ae60':'#666'}">${has?`✓ ${pts} pts`:'— not traced'}</span>
    <span style="flex:1"></span>
    <span style="font-size:11px;color:#556">${traced.length}/18 traced</span>
  </div>`;

  // Push section
  const pushHtml=`<div>
    <button onclick="pushAllPolygons()" style="background:#27ae60;color:#fff;border:none;padding:8px 18px;border-radius:6px;font-weight:700;cursor:pointer;font-size:13px;width:100%">
      ⬆ Push All to Supabase (${traced.length} / 18 traced)
    </button>
    <div id="pushLog" style="margin-top:8px;font-size:11px;color:#aaa;max-height:80px;overflow-y:auto;line-height:1.8;word-break:break-all;"></div>
  </div>`;

  body.innerHTML=barHtml+navHtml+pushHtml;
}

function selectReviewHole(h){
  reviewHole=h;
  renderReviewPanel();
  updateReviewDots();
  if(polyLayers[h]){
    map.fitBounds(polyLayers[h].getBounds(),{padding:[30,30]});
  } else {
    const t=HOLE_TEES[h-1];
    if(t)map.flyTo([t.lat,t.lng],18,{animate:true,duration:0.6});
  }
}

function reviewPrevHole(){ selectReviewHole(reviewHole>1?reviewHole-1:18); }
function reviewNextHole(){ selectReviewHole(reviewHole<18?reviewHole+1:1); }
```

- [ ] **Step 2: Verify in browser**

Open `course-mapper.html`. Draw a polygon on any hole. Click "🟢 Review".

Expected:
- The hole you drew shows `✓` and green colour in the status bar
- Other holes show `—` in grey
- Navigation arrows cycle through holes 1→18→1
- Clicking a hole cell with a polygon: map flies to it
- Clicking a hole cell without a polygon: map flies to tee position

- [ ] **Step 3: Commit**

```bash
git add course-mapper.html
git commit -m "feat(mapper): review panel rendering and hole navigation"
```

---

## Task 5: course-mapper.html — review dots + pushAllPolygons

**Files:**
- Modify: `course-mapper.html`

- [ ] **Step 1: Add `clearReviewDots`, `updateReviewDots`, `pushAllPolygons`**

Find the block just added in Task 4 (`function reviewNextHole()`). Add immediately after:

```javascript
function clearReviewDots(){
  reviewDotLayers.forEach(l=>map.removeLayer(l));
  reviewDotLayers=[];
}

function updateReviewDots(){
  clearReviewDots();
  const verts=greenPolygons[reviewHole];
  if(!verts||verts.length<3)return;
  const tee=HOLE_TEES[reviewHole-1];
  if(!tee)return;
  // Find closest/furthest vertex from tee (sanity-check preview)
  let minD=Infinity,maxD=-Infinity,frontV=null,backV=null;
  verts.forEach(([vlat,vlng])=>{
    const d=haversineM(tee.lat,tee.lng,vlat,vlng);
    if(d<minD){minD=d;frontV=[vlat,vlng];}
    if(d>maxD){maxD=d;backV=[vlat,vlng];}
  });
  const midLat=(frontV[0]+backV[0])/2, midLng=(frontV[1]+backV[1])/2;
  const addDot=(latlng,color,label)=>{
    const dot=L.circleMarker(latlng,{radius:6,color:'#fff',weight:1.5,fillColor:color,fillOpacity:1,interactive:false}).addTo(map);
    const lbl=L.marker(latlng,{
      icon:L.divIcon({className:'',
        html:`<div style="background:rgba(0,0,0,0.75);color:${color};font-size:10px;font-weight:700;padding:2px 6px;border-radius:3px;white-space:nowrap;border:1px solid ${color};margin-top:9px">${label}</div>`,
        iconSize:[60,16],iconAnchor:[30,-2]}),
      interactive:false
    }).addTo(map);
    reviewDotLayers.push(dot,lbl);
  };
  addDot(frontV,'#3498db','↑ Front');
  addDot([midLat,midLng],'#ecf0f1','Mid');
  addDot(backV,'#e74c3c','Back ↓');
}

async function pushAllPolygons(){
  const logEl=document.getElementById('pushLog');
  if(!logEl)return;
  logEl.innerHTML='⏳ Pushing…';
  const lines=[];
  for(let h=1;h<=18;h++){
    const verts=greenPolygons[h];
    if(!verts||verts.length<3){lines.push(`H${h}:—`);continue;}
    try{
      await sbUpsertGreenPolygon(h,verts);
      lines.push(`<span style="color:#27ae60">H${h}:✓</span>`);
    }catch(e){
      lines.push(`<span style="color:#e74c3c">H${h}:✗</span>`);
      console.error('pushAllPolygons hole',h,e);
    }
    logEl.innerHTML=lines.join(' ');
  }
}
```

- [ ] **Step 2: Verify review dots in browser**

Open `course-mapper.html`. Draw a polygon around a green. Open "🟢 Review". Navigate to that hole.

Expected:
- Blue dot (↑ Front) appears on the polygon vertex closest to the tee
- White dot (Mid) appears at the midpoint between front and back
- Red dot (Back ↓) appears on the polygon vertex furthest from the tee
- Dots clear when navigating to an untraced hole

- [ ] **Step 3: Verify push in browser (requires internet + Supabase access)**

With at least one hole traced, click "⬆ Push All to Supabase".

Expected log line: `H{n}:✓` in green for traced holes, `H{n}:—` in grey for untraced holes.

Verify in Supabase Table Editor: `green_polygons` table has a row for that hole with `vertices` containing the polygon coordinates.

- [ ] **Step 4: Verify upsert — push same hole twice**

Draw a slightly different polygon for the same hole. Push again.

Expected: Supabase `green_polygons` still has one row for that hole (upsert, not insert), with updated vertices.

- [ ] **Step 5: Commit**

```bash
git add course-mapper.html
git commit -m "feat(mapper): review dots and push all polygons to Supabase"
```

---

## Task 6: index.html — greenPolygons global + getGreenDistances + loadData

**Files:**
- Modify: `index.html`

- [ ] **Step 1: Add `greenPolygons` global variable**

Find the GPS state variables block (around line 760). It contains lines like:

```javascript
let GR = null;
let gpsWatchId = null;
```

Add immediately after those GPS variables:

```javascript
let greenPolygons = {};  // {hole: [[lat,lng],...]} loaded from Supabase
```

- [ ] **Step 2: Add `getGreenDistances` function**

Find the `distToGreen` function (around lines 799–803):

```javascript
function distToGreen(hole1based,lat,lng){
  const h=HOLE_DATA[hole1based-1];
  if(!h||!h.green||lat==null||lng==null)return null;
  return haversineM(lat,lng,h.green.lat,h.green.lng);
}
```

Add the new function immediately after it:

```javascript
function getGreenDistances(vertices,playerLat,playerLng){
  if(!vertices||vertices.length<3)return null;
  let minD=Infinity,maxD=-Infinity,frontV=null,backV=null;
  vertices.forEach(([vlat,vlng])=>{
    const d=haversineM(playerLat,playerLng,vlat,vlng);
    if(d<minD){minD=d;frontV=[vlat,vlng];}
    if(d>maxD){maxD=d;backV=[vlat,vlng];}
  });
  const midLat=(frontV[0]+backV[0])/2,midLng=(frontV[1]+backV[1])/2;
  return{
    front:{lat:frontV[0],lng:frontV[1],dist:minD},
    mid:  {lat:midLat,   lng:midLng,   dist:haversineM(playerLat,playerLng,midLat,midLng)},
    back: {lat:backV[0], lng:backV[1], dist:maxD}
  };
}
```

- [ ] **Step 3: Extend `loadData()` to fetch green_polygons**

Find the `loadData` function (around line 841). It ends with:

```javascript
  try{saturdaySignups=await sbGet('saturday_signups','order=created_at.asc');}catch(e){saturdaySignups=[];}}
```

Replace that closing brace with:

```javascript
  try{saturdaySignups=await sbGet('saturday_signups','order=created_at.asc');}catch(e){saturdaySignups=[];}
  try{const pg=await sbGet('green_polygons','');pg.forEach(r=>{greenPolygons[r.hole]=r.vertices;});}catch(e){console.warn('green_polygons load failed:',e);}
}
```

- [ ] **Step 4: Verify in browser (requires Supabase access)**

Open `index.html`. Open DevTools → Console. After the page loads, type:

```javascript
console.log(greenPolygons)
```

Expected: an object like `{5: [[55.63..., 12.56...], ...]}` showing the holes you pushed in Task 5. If you haven't pushed any yet, it will be `{}`.

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "feat: load green_polygons on init; add getGreenDistances()"
```

---

## Task 7: index.html — GPS round green display uses polygon

**Files:**
- Modify: `index.html`

This modifies the `toggleGreenZoom()` function. The existing code filters `GR.surveyPoints` for front/mid/back. We replace that block to prefer polygon-derived distances and fall back to survey points.

- [ ] **Step 1: Locate the exact lines to replace**

In `index.html`, search for this exact string (around line 1419):

```javascript
const surveyPts=(GR.surveyPoints||[]).filter(p=>p.hole===GR.currentHole&&['front_green','mid_green','back_green'].includes(p.type));
```

It should be followed immediately by:

```javascript
  // Fall back to HOLE_DATA estimated centre if no survey points yet
  const hd=HOLE_DATA[GR.currentHole-1];
  const usingSurvey=surveyPts.length>0;
  const holePts=usingSurvey?surveyPts:(hd&&hd.green?[{type:'est',lat:hd.green.lat,lng:hd.green.lng}]:[]);
```

- [ ] **Step 2: Replace the surveyPts/holePts block**

Replace the entire 5-line block (from `const surveyPts=` through `const holePts=...`) with:

```javascript
  // Prefer polygon-derived green distances if available
  let holePts;
  const poly=greenPolygons[GR.currentHole];
  if(poly&&poly.length>=3&&GR.currentLat!=null&&GR.currentLng!=null){
    const g=getGreenDistances(poly,GR.currentLat,GR.currentLng);
    if(g)holePts=[
      {type:'front_green',lat:g.front.lat,lng:g.front.lng},
      {type:'mid_green',  lat:g.mid.lat,  lng:g.mid.lng  },
      {type:'back_green', lat:g.back.lat, lng:g.back.lng  }
    ];
  }
  if(!holePts){
    // Fall back to GPS survey points, then HOLE_DATA estimate
    const surveyPts=(GR.surveyPoints||[]).filter(p=>p.hole===GR.currentHole&&['front_green','mid_green','back_green'].includes(p.type));
    const hd=HOLE_DATA[GR.currentHole-1];
    holePts=surveyPts.length>0?surveyPts:(hd&&hd.green?[{type:'est',lat:hd.green.lat,lng:hd.green.lng}]:[]);
  }
```

Note: the variable `usingSurvey` is removed — it was only used to build `holePts` and is not referenced elsewhere in the function.

- [ ] **Step 3: Verify syntax — load index.html in browser**

Open `index.html`. Open DevTools console. Confirm no JS errors on load.

- [ ] **Step 4: Manual test — green zoom with polygon data**

Prerequisites: complete Tasks 5 and 6 first (polygon in Supabase, loaded into `greenPolygons`).

In the app:
1. Start a GPS round
2. Navigate to a hole that has a polygon in `greenPolygons`
3. Tap "⛳ Green"

Expected:
- Three distance labels appear: **Front** (teal), **Mid** (green), **Back** (red)
- The labels show different distances — Front is shortest, Back is longest
- Distances update if you move (re-tap ⛳ Green to refresh)

- [ ] **Step 5: Manual test — fallback when no polygon**

Navigate to a hole that does NOT have a polygon in `greenPolygons` (e.g., one you haven't traced yet).
Tap "⛳ Green".

Expected: existing behaviour — shows `survey_points` distances, or the `Green~` estimated centre from `HOLE_DATA` if no survey points either. No errors.

- [ ] **Step 6: Commit**

```bash
git add index.html
git commit -m "feat: GPS green zoom uses polygon-derived front/mid/back distances"
```

---

## Final Verification

After all 7 tasks, do a full end-to-end test:

1. Open `course-mapper.html`. Draw polygons for 2–3 holes at zoom 19.
2. Click "🟢 Review". Step through each hole. Confirm blue/white/red dots appear on the correct polygon vertices.
3. Click "⬆ Push All to Supabase". Confirm green ✓ for each traced hole in the log.
4. Open Supabase Table Editor → `green_polygons`. Confirm rows for those holes with correct vertex arrays.
5. Open `index.html`. Hard-refresh (Ctrl+Shift+R) to reload `greenPolygons` from Supabase.
6. Start a GPS round. Go to a hole with a polygon. Tap ⛳ Green.
7. Confirm Front/Mid/Back labels appear with sensible distances.
8. Go to a hole without a polygon. Tap ⛳ Green. Confirm fallback behaviour (no errors).
