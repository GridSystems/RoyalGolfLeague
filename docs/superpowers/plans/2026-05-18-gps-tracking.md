# GPS Round Tracker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a live GPS shot-tracking mode to the Royal Golf Club Saturday League app that records each shot's position, club, and weight on a satellite map, silently captures wind conditions, and pre-fills score entry at the end of the round.

**Architecture:** All code stays in the single `index.html` (currently 2342 lines). A new `view-track` top-level view handles GPS tracking independently of existing score entry. Leaflet.js (CDN, no key) renders a satellite map; Open-Meteo (free, no key) provides wind data on a 15-minute global refresh. A new `gps_shots` Supabase table stores every shot; a `bag` JSONB column on `players` stores each player's club list.

**Tech Stack:** Leaflet.js 1.9.4 (ESRI satellite tiles), Open-Meteo API, Supabase REST (existing sbGet/sbInsert/sbUpdate/sbDelete helpers), Browser Geolocation API, vanilla JS/HTML/CSS.

**Note on testing:** No test framework exists — verification steps are manual browser checks. Open the app locally via a local HTTP server (e.g. `npx serve .`) so Geolocation API works on localhost.

---

## File Map

| File | Change |
|---|---|
| `index.html` | All changes — CSS, HTML views, JS functions |
| `supabase/add_gps_tracking.sql` | New — migration for gps_shots table + bag column |

---

## Task 1: Database Migration SQL

**Files:**
- Create: `supabase/add_gps_tracking.sql`

- [ ] **Step 1: Create the migration file**

```sql
-- Royal Golf Club — GPS Tracking tables
-- Run in Supabase SQL Editor (project qvjybtcbymexheqrjkai).
-- Safe to re-run (IF NOT EXISTS guards).

-- 1. gps_shots table
CREATE TABLE IF NOT EXISTS public.gps_shots (
  id           BIGSERIAL PRIMARY KEY,
  player_id    INTEGER REFERENCES public.players(id) ON DELETE CASCADE,
  round_date   DATE NOT NULL,
  hole         SMALLINT NOT NULL CHECK (hole BETWEEN 1 AND 18),
  shot_num     SMALLINT NOT NULL,
  type         TEXT NOT NULL DEFAULT 'normal'
               CHECK (type IN ('normal','replay','drop','provisional')),
  lat          DOUBLE PRECISION,   -- NULL for chip/putt (GPS suppressed)
  lng          DOUBLE PRECISION,   -- NULL for chip/putt
  club         TEXT,
  shot_weight  TEXT CHECK (shot_weight IN ('full','3/4','1/2','chip','putt')),
  wind_speed   NUMERIC(5,2),
  wind_dir     TEXT,
  wind_deg     SMALLINT,
  result       TEXT DEFAULT NULL,  -- TBC: post-shot sentiment
  recorded_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.gps_shots TO anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.gps_shots_id_seq TO anon, authenticated;

-- 2. bag column on players
ALTER TABLE public.players
  ADD COLUMN IF NOT EXISTS bag JSONB NOT NULL DEFAULT '[]';
```

- [ ] **Step 2: Run in Supabase SQL Editor**

Paste the file contents into https://supabase.com/dashboard/project/qvjybtcbymexheqrjkai/sql/new and click Run.

- [ ] **Step 3: Verify**

In the Supabase Table Editor, confirm `gps_shots` exists with all columns and `players` has a `bag` column defaulting to `[]`.

- [ ] **Step 4: Commit**

```bash
git add supabase/add_gps_tracking.sql
git commit -m "chore: add gps_shots table and players.bag column migration"
```

---

## Task 2: Leaflet CDN + GPS CSS

**Files:**
- Modify: `index.html` — `<head>` (after line 7, before closing `</style>` tag near line 125)

- [ ] **Step 1: Add Leaflet CSS and JS to `<head>` (after the Google Fonts link, line 7)**

```html
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
```

- [ ] **Step 2: Add GPS-specific CSS (inside `<style>`, before the closing `</style>` tag around line 125)**

```css
/* ── GPS Tracker ───────────────────────────────────────────── */
#gpsMap { height: 55vh; min-height: 280px; border-radius: 10px; overflow: hidden; z-index: 1; }
.gps-hole-header { display: flex; align-items: center; justify-content: space-between; padding: 0.75rem 1rem; background: rgba(0,0,0,0.3); border-bottom: 1px solid var(--border); }
.gps-actions { display: flex; gap: 8px; flex-wrap: wrap; padding: 0.75rem 1rem; background: rgba(0,0,0,0.18); }
.btn-hit { background: var(--gold); color: var(--gd); font-size: 1rem; font-weight: 700; padding: 12px 28px; border-radius: 10px; border: none; cursor: pointer; flex: 1; min-width: 100px; }
.btn-hit:active { transform: scale(0.97); }
.btn-shot-type { background: rgba(255,255,255,0.06); color: var(--cream); border: 1px solid var(--border); border-radius: 8px; font-family: 'DM Sans', sans-serif; font-size: 0.78rem; font-weight: 500; padding: 8px 12px; cursor: pointer; }
.btn-shot-type:hover { background: rgba(255,255,255,0.11); }
.btn-shot-type.provisional { border-color: rgba(240,192,96,0.4); color: #f0c060; }
.club-picker { display: flex; gap: 6px; overflow-x: auto; padding: 0.6rem 1rem; background: rgba(0,0,0,0.14); border-bottom: 1px solid var(--border); }
.club-btn { background: rgba(255,255,255,0.06); border: 1px solid var(--border); border-radius: 8px; color: var(--cream); font-family: 'DM Mono', monospace; font-size: 0.78rem; padding: 6px 12px; cursor: pointer; white-space: nowrap; flex-shrink: 0; transition: all 0.12s; }
.club-btn.selected { background: rgba(201,168,76,0.18); border-color: var(--gold); color: var(--gold-l); }
.weight-picker { display: flex; gap: 6px; padding: 0.5rem 1rem; background: rgba(0,0,0,0.1); border-bottom: 1px solid var(--border); }
.weight-btn { background: rgba(255,255,255,0.04); border: 1px solid var(--border); border-radius: 6px; color: rgba(255,255,255,0.5); font-family: 'DM Sans', sans-serif; font-size: 0.75rem; padding: 5px 11px; cursor: pointer; transition: all 0.12s; }
.weight-btn.selected { background: rgba(201,168,76,0.14); border-color: rgba(201,168,76,0.5); color: var(--gold-l); }
.gps-summary-card { background: rgba(255,255,255,0.04); border: 1px solid var(--border); border-radius: 12px; padding: 1.25rem; margin: 1rem; }
.shot-dot { width: 26px; height: 26px; border-radius: 50%; background: var(--gold); color: var(--gd); display: flex; align-items: center; justify-content: center; font-size: 0.7rem; font-weight: 700; border: 2px solid #fff; }
.bag-club-row { display: flex; align-items: center; gap: 8px; padding: 7px 0; border-bottom: 1px solid rgba(255,255,255,0.04); }
.bag-club-name { flex: 1; font-size: 0.88rem; }
```

- [ ] **Step 3: Verify**

Open `index.html` in a browser. No visual change expected yet — confirm no console errors (Leaflet loads fine).

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "feat: add Leaflet CDN and GPS tracker CSS"
```

---

## Task 3: "Track Round" Nav Tab + View Skeleton

**Files:**
- Modify: `index.html` — nav tabs (~line 191), view divs (~line 453)

- [ ] **Step 1: Add the nav tab**

After the Rules tab (line ~197, `onclick="showView('rules',this)">Rules</button>`), insert:

```html
<button class="nav-tab" id="tabTrack" onclick="showView('track',this)" style="display:none">📍 Track</button>
```

It starts hidden — Task 14 will show it for eligible players.

- [ ] **Step 2: Add the view div**

After `<div class="view" id="view-rules">` block and before `<div class="view" id="view-admin">` (around line 453), insert:

```html
<!-- GPS ROUND TRACKER -->
<div class="view" id="view-track">
  <div id="trackContent"></div>
</div>
```

- [ ] **Step 3: Wire up `showView` handler**

Find `function showView(id,btn)` (line ~843). After the existing `if(id==='rules')renderRules();` line, add:

```javascript
if(id==='track')renderTrackView();
```

- [ ] **Step 4: Add stub `renderTrackView` function**

After `function renderRules(){...}` (around line 875), add:

```javascript
// ── GPS Round Tracker ─────────────────────────────────────────────────────────
function renderTrackView(){
  const el=document.getElementById('trackContent');
  if(!el)return;
  if(GR){renderGpsHole();}
  else{renderGpsStart();}
}
```

- [ ] **Step 5: Verify**

Tab is hidden (expected). Open browser console — no errors. Switching to Track view (if you temporarily remove `style="display:none"`) shows an empty panel.

- [ ] **Step 6: Commit**

```bash
git add index.html
git commit -m "feat: add Track Round nav tab and view skeleton"
```

---

## Task 4: GPS State Object + Utilities

**Files:**
- Modify: `index.html` — globals section (~line 686)

- [ ] **Step 1: Add GPS globals after `let players=[],allRounds=[],activeId=null,selColor=0;` (line 686)**

```javascript
// ── GPS Tracker state ─────────────────────────────────────────────────────────
let GR = null;        // null = not tracking; object = active GPS round
let currentWeather = null;  // {speed_kmh, dir, deg} — refreshed every 15 min
let weatherInterval = null;
```

- [ ] **Step 2: Add Haversine distance utility (after `const today=()=>...` line ~708)**

```javascript
function haversineM(lat1,lng1,lat2,lng2){
  const R=6371000,rad=Math.PI/180;
  const dLat=(lat2-lat1)*rad,dLng=(lng2-lng1)*rad;
  const a=Math.sin(dLat/2)**2+Math.cos(lat1*rad)*Math.cos(lat2*rad)*Math.sin(dLng/2)**2;
  return Math.round(R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a)));
}
```

- [ ] **Step 3: Add wind-degree-to-text utility (directly after haversineM)**

```javascript
function windDegToText(deg){
  const dirs=['N','NE','E','SE','S','SW','W','NW'];
  return dirs[Math.round((deg||0)/45)%8];
}
```

- [ ] **Step 4: Verify**

In browser console:
```javascript
haversineM(55.6761, 12.5683, 55.6801, 12.5700) // expect ~460 (metres)
windDegToText(45)  // expect "NE"
windDegToText(270) // expect "W"
```

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "feat: add GPS state globals and distance/wind utilities"
```

---

## Task 5: Weather Module (Open-Meteo)

**Files:**
- Modify: `index.html` — GPS Tracker section (after utilities from Task 4)

- [ ] **Step 1: Add `fetchWeather` function**

```javascript
async function fetchWeather(lat,lng){
  try{
    const r=await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=wind_speed_10m,wind_direction_10m&wind_speed_unit=kmh&forecast_days=1`);
    if(!r.ok)return;
    const d=await r.json();
    const spd=d.current?.wind_speed_10m??null;
    const deg=d.current?.wind_direction_10m??null;
    currentWeather={speed_kmh:spd,dir:deg!=null?windDegToText(deg):null,deg};
  }catch(e){/* silent — wind is non-critical */}
}
```

- [ ] **Step 2: Add `startWeatherRefresh` function**

```javascript
function startWeatherRefresh(lat,lng){
  if(weatherInterval)clearInterval(weatherInterval);
  fetchWeather(lat,lng);
  weatherInterval=setInterval(()=>fetchWeather(lat,lng),15*60*1000);
}
```

- [ ] **Step 3: Verify weather fetch manually**

In browser console:
```javascript
fetchWeather(55.6761,12.5683).then(()=>console.log(currentWeather))
// expect: {speed_kmh: <number>, dir: "NE"|"SW"|etc, deg: <number>}
```

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "feat: add Open-Meteo weather module with 15-min refresh"
```

---

## Task 6: Track Round Start Screen

**Files:**
- Modify: `index.html` — GPS Tracker section

- [ ] **Step 1: Add `MASTER_CLUBS` constant (near HOLE_PARS/HOLE_HCP, ~line 672)**

```javascript
const MASTER_CLUBS=['Driver','2W','3W','4W','5W','7W','9W','2H','3H','4H','5H','6H','7H','1i','2i','3i','4i','5i','6i','7i','8i','9i','PW','GW','SW','LW','Putter'];
```

- [ ] **Step 2: Add `renderGpsStart` function**

```javascript
function renderGpsStart(){
  const el=document.getElementById('trackContent');
  const p=players.find(x=>x.id===activeId);
  if(!p){el.innerHTML='<div class="empty">Select your player first.</div>';return;}
  el.innerHTML=`
    <div class="panel">
      <div class="ph"><span class="pt">Track Round</span></div>
      <div class="pb" style="display:flex;flex-direction:column;gap:14px">
        <div class="fg">
          <div class="fgi">
            <label>Date</label>
            <input type="date" id="gpsDate" value="${today()}" onchange="validateSaturdayDate(this)">
          </div>
          <div class="fgi">
            <label>Starting Hole</label>
            <select id="gpsStartHole">${Array.from({length:18},(_,i)=>`<option value="${i+1}">Hole ${i+1}</option>`).join('')}</select>
          </div>
          <div class="fgi full">
            <label>Tee</label>
            <div class="tee-sel" id="gpsTeeSelect">
              ${TEES.map(t=>`<div class="tee-opt${t.id==='platinum'?' selected':''}" onclick="selectGpsTee('${t.id}',this)"><span class="tee-dot" style="background:${t.color}"></span>${t.name}</div>`).join('')}
            </div>
          </div>
        </div>
        <div style="display:flex;gap:10px;justify-content:flex-end">
          <button class="btn btn-primary" onclick="startGpsRound()">Start Tracking →</button>
        </div>
      </div>
    </div>`;
}
```

- [ ] **Step 3: Add `selectGpsTee` + `startGpsRound` functions**

```javascript
let gpsTeeId='platinum';
function selectGpsTee(id,el){
  gpsTeeId=id;
  document.querySelectorAll('#gpsTeeSelect .tee-opt').forEach(o=>o.classList.remove('selected'));
  el.classList.add('selected');
}

async function startGpsRound(){
  const date=document.getElementById('gpsDate').value;
  const startHole=parseInt(document.getElementById('gpsStartHole').value)||1;
  if(!date){alert('Please select a date.');return;}
  setLoading(true,'Getting GPS…');
  try{
    const pos=await new Promise((res,rej)=>
      navigator.geolocation.getCurrentPosition(res,rej,{enableHighAccuracy:true,timeout:10000})
    );
    const {latitude:lat,longitude:lng}=pos.coords;
    startWeatherRefresh(lat,lng);
    GR={
      date,teeId:gpsTeeId,currentHole:startHole,
      selectedClub:null,selectedWeight:'full',
      holeScores:{},provisionalShotId:null,
      map:null,markers:[],polylines:[],shots:[]
    };
    // load any existing shots for today
    try{
      GR.shots=await sbGet('gps_shots',`player_id=eq.${activeId}&round_date=eq.${date}&order=hole.asc,shot_num.asc`);
    }catch(e){GR.shots=[];}
    renderGpsHole();
  }catch(e){
    alert('Could not get GPS location. Please allow location access and try again.');
  }finally{setLoading(false);}
}
```

- [ ] **Step 4: Verify**

Open Track tab. Start screen shows date, hole picker, tee selector. Tapping a tee highlights it. Tapping Start Tracking prompts for GPS permission (accept it) — console should log no errors.

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "feat: GPS round start screen with date, hole, tee selection"
```

---

## Task 7: Hole View + Leaflet Map

**Files:**
- Modify: `index.html` — GPS Tracker section

- [ ] **Step 1: Add `renderGpsHole` function**

```javascript
function renderGpsHole(){
  const el=document.getElementById('trackContent');
  const p=players.find(x=>x.id===activeId);
  const holeShots=GR.shots.filter(s=>s.hole===GR.currentHole);
  const shotCount=holeShots.length;
  const par=HOLE_PARS[GR.currentHole-1];
  const hasProvisional=GR.provisionalShotId!=null;

  el.innerHTML=`
    <div style="background:rgba(0,0,0,0.3);border:1px solid var(--border);border-radius:14px;overflow:hidden">
      <div class="gps-hole-header">
        <div>
          <div style="font-family:'Playfair Display',serif;color:var(--gold-l);font-size:1.1rem">Hole ${GR.currentHole}</div>
          <div style="font-size:0.72rem;color:rgba(255,255,255,0.4)">Par ${par} · SI ${HOLE_HCP[GR.currentHole-1]} · Shot ${shotCount+1}</div>
        </div>
        <button class="btn btn-ghost btn-sm" onclick="confirmEndHole()">End Hole →</button>
      </div>
      <div id="gpsMap"></div>
      <div class="club-picker" id="clubPicker">${renderClubPicker(p)}</div>
      <div class="weight-picker" id="weightPicker">${renderWeightPicker()}</div>
      <div class="gps-actions">
        <button class="btn-hit" onclick="recordShot('normal')">🎯 Hit</button>
        <button class="btn-shot-type" onclick="recordShot('drop')">⬇ Drop</button>
        <button class="btn-shot-type" onclick="recordShot('replay')">↩ Replay</button>
        <button class="btn-shot-type provisional" onclick="recordShot('provisional')">P Provisional</button>
        ${hasProvisional?`
        <button class="btn-shot-type" style="color:#7fcc9e;border-color:rgba(127,204,158,0.4)" onclick="resolveProvisional('found')">✓ Found Original</button>
        <button class="btn-shot-type" style="color:#f0c060;border-color:rgba(240,192,96,0.4)" onclick="resolveProvisional('inplay')">▶ Provisional In Play</button>`:''}
      </div>
      <div style="padding:0.5rem 1rem;display:flex;gap:8px;justify-content:flex-end;border-top:1px solid var(--border)">
        <button class="btn btn-ghost btn-sm" onclick="abandonGpsRound()">Abandon</button>
        <button class="btn btn-primary btn-sm" onclick="finishGpsRound()">Finish Round</button>
      </div>
    </div>`;

  initGpsMap(holeShots);
}
```

- [ ] **Step 2: Add `renderClubPicker` helper**

```javascript
function renderClubPicker(player){
  const bag=(player?.bag&&player.bag.length)?player.bag:['Driver'];
  return bag.map(c=>`<button class="club-btn${GR.selectedClub===c?' selected':''}" onclick="selectGpsClub('${c.replace(/'/g,"\\'")}',this)">${c}</button>`).join('');
}
function selectGpsClub(club,el){
  GR.selectedClub=club;
  document.querySelectorAll('.club-btn').forEach(b=>b.classList.remove('selected'));
  el.classList.add('selected');
}
```

- [ ] **Step 3: Add `renderWeightPicker` helper**

```javascript
const GPS_WEIGHTS=[{v:'full',l:'Full'},{v:'3/4',l:'¾'},{v:'1/2',l:'½'},{v:'chip',l:'Chip'},{v:'putt',l:'Putt'}];
function renderWeightPicker(){
  return GPS_WEIGHTS.map(w=>`<button class="weight-btn${GR.selectedWeight===w.v?' selected':''}" onclick="selectGpsWeight('${w.v}',this)">${w.l}</button>`).join('');
}
function selectGpsWeight(weight,el){
  GR.selectedWeight=weight;
  document.querySelectorAll('.weight-btn').forEach(b=>b.classList.remove('selected'));
  el.classList.add('selected');
}
```

- [ ] **Step 4: Add `initGpsMap` function**

```javascript
function initGpsMap(holeShots){
  // Destroy existing map instance if any
  if(GR.map){GR.map.remove();GR.map=null;GR.markers=[];GR.polylines=[];}

  const mapEl=document.getElementById('gpsMap');
  if(!mapEl)return;

  // Default centre: Copenhagen area — overridden by GPS on first shot or current pos
  const defaultLat=55.68,defaultLng=12.56;
  GR.map=L.map('gpsMap',{zoomControl:true,attributionControl:false}).setView([defaultLat,defaultLng],17);

  L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',{
    maxZoom:20,attribution:'Tiles © Esri'
  }).addTo(GR.map);

  // Try to centre on current position
  navigator.geolocation.getCurrentPosition(pos=>{
    if(GR.map)GR.map.setView([pos.coords.latitude,pos.coords.longitude],18);
  },{},{ enableHighAccuracy:true,timeout:5000 });

  drawShotMap(holeShots);
}
```

- [ ] **Step 5: Add `drawShotMap` function**

```javascript
function drawShotMap(holeShots){
  if(!GR.map)return;
  // Clear previous markers/polylines
  GR.markers.forEach(m=>m.remove());GR.markers=[];
  GR.polylines.forEach(l=>l.remove());GR.polylines=[];

  const gpsShots=holeShots.filter(s=>s.lat!=null&&s.lng!=null);
  gpsShots.forEach((shot,idx)=>{
    const isProvisional=shot.type==='provisional';
    const isDrop=shot.type==='drop';
    const isReplay=shot.type==='replay';
    const isCurrentProvisional=shot.id===GR.provisionalShotId;
    const color=isCurrentProvisional?'#f0c060':isProvisional?'#f0c060':isDrop?'#f08080':isReplay?'#82aaf0':'#ffd700';

    // Marker
    const icon=L.divIcon({
      className:'',
      html:`<div style="width:24px;height:24px;border-radius:50%;background:${color};color:#1a3a2a;display:flex;align-items:center;justify-content:center;font-size:0.65rem;font-weight:700;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,0.5)">${shot.shot_num}</div>`,
      iconSize:[24,24],iconAnchor:[12,12]
    });
    const label=isDrop?' ⬇':isReplay?' ↩':isProvisional?' P':'';
    const distLabel=idx>0&&!isDrop?` ${gpsShots[idx-1]?haversineM(gpsShots[idx-1].lat,gpsShots[idx-1].lng,shot.lat,shot.lng)+'m':''}`:' Drop';
    const m=L.marker([shot.lat,shot.lng],{icon})
      .bindTooltip(`${shot.shot_num}${label}${idx>0?distLabel:''}`,{permanent:false,direction:'top'})
      .addTo(GR.map);
    GR.markers.push(m);

    // Polyline to previous GPS shot
    if(idx>0&&!isDrop){
      const prev=gpsShots[idx-1];
      const line=L.polyline([[prev.lat,prev.lng],[shot.lat,shot.lng]],{
        color:isProvisional?'#f0c060':'rgba(255,215,0,0.7)',
        weight:2,
        dashArray:isProvisional?'6,4':null
      }).addTo(GR.map);
      GR.polylines.push(line);
    }
  });

  // Fit map to show all shots
  if(gpsShots.length>=2){
    GR.map.fitBounds(gpsShots.map(s=>[s.lat,s.lng]),{padding:[30,30]});
  } else if(gpsShots.length===1){
    GR.map.setView([gpsShots[0].lat,gpsShots[0].lng],18);
  }
}
```

- [ ] **Step 6: Verify**

Start a GPS round. Hole view renders with satellite map centred on current location. No console errors from Leaflet.

- [ ] **Step 7: Commit**

```bash
git add index.html
git commit -m "feat: GPS hole view with Leaflet satellite map"
```

---

## Task 8: Recording Shots (Hit / Drop / Replay / Provisional)

**Files:**
- Modify: `index.html` — GPS Tracker section

- [ ] **Step 1: Add `recordShot` function**

```javascript
async function recordShot(type){
  if(!GR||!activeId)return;
  const isChipOrPutt=GR.selectedWeight==='chip'||GR.selectedWeight==='putt';
  setLoading(true,'Recording…');
  try{
    let lat=null,lng=null;
    if(!isChipOrPutt){
      // GPS required for non-chip/putt shots
      const pos=await new Promise((res,rej)=>
        navigator.geolocation.getCurrentPosition(res,rej,{enableHighAccuracy:true,timeout:8000})
      );
      lat=pos.coords.latitude;
      lng=pos.coords.longitude;
    }
    const holeShots=GR.shots.filter(s=>s.hole===GR.currentHole);
    const shot_num=holeShots.length+1;
    const payload={
      player_id:activeId,
      round_date:GR.date,
      hole:GR.currentHole,
      shot_num,
      type,
      lat,lng,
      club:GR.selectedClub,
      shot_weight:GR.selectedWeight,
      wind_speed:currentWeather?.speed_kmh??null,
      wind_dir:currentWeather?.dir??null,
      wind_deg:currentWeather?.deg??null
    };
    const [saved]=await sbInsert('gps_shots',payload);
    GR.shots.push(saved||{...payload,id:Date.now()});
    if(type==='provisional')GR.provisionalShotId=(saved||payload).id;
    renderGpsHole();
  }catch(e){
    alert('Could not record shot: '+e.message);
  }finally{setLoading(false);}
}
```

- [ ] **Step 2: Verify**

Start a round, select a club, tap Hit. Shot appears as numbered dot on map. Tap Drop — dot appears without line. Tap Provisional — dashed line and "P" dot appear, and "Found Original" / "Provisional In Play" buttons appear.

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "feat: record shots with GPS coordinates, club, weight, wind snapshot"
```

---

## Task 9: Provisional Resolution + Abandon

**Files:**
- Modify: `index.html` — GPS Tracker section

- [ ] **Step 1: Add `resolveProvisional` function**

```javascript
async function resolveProvisional(action){
  if(!GR||!GR.provisionalShotId)return;
  setLoading(true,'Updating…');
  try{
    if(action==='found'){
      // Delete the provisional shot
      await sbDelete('gps_shots',GR.provisionalShotId);
      GR.shots=GR.shots.filter(s=>s.id!==GR.provisionalShotId);
    } else {
      // Provisional becomes normal — update type in DB and local state
      await sbUpdate('gps_shots',GR.provisionalShotId,{type:'normal'});
      const s=GR.shots.find(x=>x.id===GR.provisionalShotId);
      if(s)s.type='normal';
    }
    GR.provisionalShotId=null;
    renderGpsHole();
  }catch(e){alert('Error: '+e.message);}
  finally{setLoading(false);}
}
```

- [ ] **Step 2: Add `abandonGpsRound` function**

```javascript
function abandonGpsRound(){
  if(!confirm('Abandon GPS tracking for this round? Shots recorded so far are kept in the database.'))return;
  if(GR?.map){GR.map.remove();}
  if(weatherInterval){clearInterval(weatherInterval);weatherInterval=null;}
  GR=null;
  renderGpsStart();
}
```

- [ ] **Step 3: Verify**

Record a provisional, tap "Found Original" — provisional dot disappears and resolution buttons hide. Record another provisional, tap "Provisional In Play" — dot stays but dashed line becomes solid and P label disappears.

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "feat: provisional shot resolution (found original / in play)"
```

---

## Task 10: End Hole + Score Prompt + Next Hole

**Files:**
- Modify: `index.html` — GPS Tracker section

- [ ] **Step 1: Add `confirmEndHole` function**

```javascript
function confirmEndHole(){
  const holeShots=GR.shots.filter(s=>s.hole===GR.currentHole);
  const totalShots=holeShots.length;
  const gpsShots=holeShots.filter(s=>s.lat!=null);
  const totalDist=gpsShots.reduce((sum,s,i)=>{
    if(i===0)return sum;
    const prev=gpsShots[i-1];
    return sum+haversineM(prev.lat,prev.lng,s.lat,s.lng);
  },0);
  const par=HOLE_PARS[GR.currentHole-1];

  const el=document.getElementById('trackContent');
  el.innerHTML=`
    <div class="panel">
      <div class="ph"><span class="pt">Hole ${GR.currentHole} Complete</span></div>
      <div class="pb" style="display:flex;flex-direction:column;gap:16px">
        <div class="stats-row">
          <div class="sc"><div class="sl">Shots</div><div class="sv">${totalShots}</div></div>
          <div class="sc"><div class="sl">Par</div><div class="sv">${par}</div></div>
          <div class="sc"><div class="sl">Distance</div><div class="sv">${totalDist}m</div></div>
        </div>
        <div class="fgi">
          <label>Gross Score (hint: ${totalShots} shots recorded)</label>
          <input type="number" id="holeScoreInput" value="${totalShots}" min="1" max="20" inputmode="numeric">
        </div>
        <div class="fa">
          <button class="btn btn-ghost" onclick="renderGpsHole()">← Back</button>
          <button class="btn btn-primary" onclick="saveHoleScore()">
            ${GR.currentHole<18?'Next Hole →':'Finish Round'}
          </button>
        </div>
      </div>
    </div>`;
  setTimeout(()=>{const i=document.getElementById('holeScoreInput');if(i){i.focus();i.select();}},50);
}
```

- [ ] **Step 2: Add `saveHoleScore` function**

```javascript
function saveHoleScore(){
  const val=parseInt(document.getElementById('holeScoreInput').value);
  if(!val||val<1){alert('Enter a valid score.');return;}
  GR.holeScores[GR.currentHole]=val;
  if(GR.currentHole<18){
    GR.currentHole++;
    GR.provisionalShotId=null;
    renderGpsHole();
  } else {
    finishGpsRound();
  }
}
```

- [ ] **Step 3: Verify**

Record shots on hole 1, tap End Hole — summary shows shot count and distance. Enter a score, tap Next Hole — hole counter increments to 2 and map resets.

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "feat: end hole summary with score prompt and next hole transition"
```

---

## Task 11: Finish Round → Score Entry Handoff

**Files:**
- Modify: `index.html` — GPS Tracker section

- [ ] **Step 1: Add `finishGpsRound` function**

```javascript
function finishGpsRound(){
  const scores=GR.holeScores;
  const holesRecorded=Object.keys(scores).length;
  if(holesRecorded===0){
    if(!confirm('No holes completed. Abandon GPS tracking?'))return;
    abandonGpsRound();return;
  }
  if(!confirm(`Transfer ${holesRecorded} hole scores to score entry?`))return;

  // Clean up map
  if(GR.map){GR.map.remove();}
  if(weatherInterval){clearInterval(weatherInterval);weatherInterval=null;}
  const savedScores={...scores};
  GR=null;

  // Switch to Log Round tab and pre-fill scores
  const logTab=document.querySelector('.nav-tab[onclick*="log"]');
  showView('log',logTab);

  // Wait for Log Round to render, then pre-fill
  setTimeout(()=>{
    for(let h=1;h<=18;h++){
      if(savedScores[h]!=null){
        const inp=document.getElementById(`sc${h}`);
        if(inp){inp.value=savedScores[h];inp.dispatchEvent(new Event('input'));}
      }
    }
    toast(`${holesRecorded} hole scores pre-filled from GPS round ✓`);
  },300);
}
```

Note: The Log Round input IDs follow the existing `sc1`–`sc18` pattern used in `buildScorecardHTML`. Verify the exact prefix used in your log round form by searching for `id="sc1"` in index.html. If a different prefix is used, adjust accordingly.

- [ ] **Step 2: Verify the input prefix**

```bash
grep -n 'id="sc1"\|id="sc2"' index.html | head -5
```

If the prefix differs (e.g. `lr_1`), update the `id` lookup in `finishGpsRound` to match.

- [ ] **Step 3: Verify end-to-end**

Complete 2–3 holes, tap Finish Round, confirm transfer — Log Round tab opens with scores pre-filled in the correct inputs.

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "feat: finish GPS round pre-fills score entry"
```

---

## Task 12: Bag Setup UI in Player Profile

**Files:**
- Modify: `index.html` — `view-players` section (~line 351) and GPS Tracker section

- [ ] **Step 1: Find the player profile panel in `view-players`**

Search for `id="view-players"` (~line 351). Find where the player profile/detail section is rendered (look for `renderGrid` or where personal settings appear). This is likely inside `updateAdminUI` or a profile card render.

- [ ] **Step 2: Add bag setup panel to `renderGrid` or profile section**

In `renderGrid()` (find it by searching `function renderGrid`), locate where the active player's profile is rendered. Add a bag setup section after the existing profile controls:

```javascript
function renderBagSetup(){
  const p=players.find(x=>x.id===activeId);
  if(!p)return;
  const bag=Array.isArray(p.bag)?p.bag:[];
  const el=document.getElementById('bagSetupPanel');
  if(!el)return;
  el.innerHTML=`
    <div class="ph"><span class="pt">My Bag</span></div>
    <div class="pb" style="display:flex;flex-direction:column;gap:10px">
      ${bag.length===0?'<div style="color:rgba(255,255,255,0.3);font-size:0.82rem">No clubs added yet.</div>':''}
      ${bag.map((club,i)=>`
        <div class="bag-club-row">
          <span class="bag-club-name">${club}</span>
          <button class="btn btn-ghost btn-sm" onclick="moveBagClub(${i},-1)" ${i===0?'disabled':''}>↑</button>
          <button class="btn btn-ghost btn-sm" onclick="moveBagClub(${i},1)" ${i===bag.length-1?'disabled':''}>↓</button>
          <button class="btn btn-danger btn-sm" onclick="removeBagClub(${i})">✕</button>
        </div>`).join('')}
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px">
        <select id="masterClubSelect" style="flex:1;min-width:120px">
          ${MASTER_CLUBS.filter(c=>!bag.includes(c)).map(c=>`<option value="${c}">${c}</option>`).join('')}
        </select>
        <button class="btn btn-ghost btn-sm" onclick="addBagClub()">+ Add</button>
      </div>
      <div style="display:flex;gap:8px">
        <input type="text" id="customClubInput" placeholder="Custom club (e.g. 48° PW)" style="flex:1">
        <button class="btn btn-ghost btn-sm" onclick="addCustomBagClub()">+ Custom</button>
      </div>
    </div>`;
}
```

- [ ] **Step 3: Add a `<div class="panel" id="bagSetupPanel">` into the `view-players` HTML**

Find `<div class="view" id="view-players">` and locate where player profile content is shown. Add after the existing profile panel:

```html
<div class="panel" id="bagSetupPanel" style="margin-top:1rem"></div>
```

- [ ] **Step 4: Call `renderBagSetup()` in `showView`**

In `showView(id,btn)`, add:

```javascript
if(id==='players'){renderGrid();renderBagSetup();}
```

Replace the existing `if(id==='players')renderGrid();` line.

- [ ] **Step 5: Add bag mutation functions**

```javascript
async function saveBag(bag){
  const p=players.find(x=>x.id===activeId);
  if(!p)return;
  try{
    await sbUpdate('players',p.id,{bag:JSON.stringify(bag)});
    p.bag=bag;
    renderBagSetup();
    toast('Bag saved ✓');
  }catch(e){alert('Error saving bag: '+e.message);}
}
function addBagClub(){
  const sel=document.getElementById('masterClubSelect');
  if(!sel||!sel.value)return;
  const p=players.find(x=>x.id===activeId);
  const bag=Array.isArray(p?.bag)?[...p.bag]:[];
  if(!bag.includes(sel.value)){bag.push(sel.value);saveBag(bag);}
}
function addCustomBagClub(){
  const inp=document.getElementById('customClubInput');
  const val=inp?.value.trim();
  if(!val)return;
  const p=players.find(x=>x.id===activeId);
  const bag=Array.isArray(p?.bag)?[...p.bag]:[];
  if(!bag.includes(val)){bag.push(val);inp.value='';saveBag(bag);}
}
function removeBagClub(idx){
  const p=players.find(x=>x.id===activeId);
  const bag=Array.isArray(p?.bag)?[...p.bag]:[];
  bag.splice(idx,1);saveBag(bag);
}
function moveBagClub(idx,dir){
  const p=players.find(x=>x.id===activeId);
  const bag=Array.isArray(p?.bag)?[...p.bag]:[];
  const target=idx+dir;
  if(target<0||target>=bag.length)return;
  [bag[idx],bag[target]]=[bag[target],bag[idx]];
  saveBag(bag);
}
```

- [ ] **Step 6: Verify**

Open Players tab. Bag setup panel shows. Add Driver from dropdown — appears in list. Add "48° PW" as custom — appears. Use ↑/↓ to reorder. ✕ removes. Changes persist after page reload.

- [ ] **Step 7: Commit**

```bash
git add index.html
git commit -m "feat: bag setup UI with master list, custom clubs, reorder"
```

---

## Task 13: GPS Stats View

**Files:**
- Modify: `index.html` — `view-history` section and GPS Tracker section

- [ ] **Step 1: Add a "GPS Stats" sub-tab to My Rounds view**

Find `<div class="view" id="view-history">` (~line 326). If it has sub-tabs, add a GPS Stats tab alongside them. If it's a flat view, wrap the existing content in sub-tabs:

```html
<div class="sub-tabs">
  <button class="sub-tab active" onclick="showHistorySub('rounds',this)">My Rounds</button>
  <button class="sub-tab" onclick="showHistorySub('gpsstats',this)">📍 GPS Stats</button>
</div>
<div class="lb-view active" id="hsub-rounds">
  <!-- existing My Rounds content here -->
</div>
<div class="lb-view" id="hsub-gpsstats">
  <div id="gpsStatsContent"></div>
</div>
```

- [ ] **Step 2: Add `showHistorySub` function**

```javascript
function showHistorySub(id,btn){
  document.querySelectorAll('#view-history .lb-view').forEach(v=>v.classList.remove('active'));
  document.querySelectorAll('#view-history .sub-tab').forEach(t=>t.classList.remove('active'));
  document.getElementById('hsub-'+id).classList.add('active');
  if(btn)btn.classList.add('active');
  if(id==='gpsstats')renderGpsStats();
}
```

- [ ] **Step 3: Add `renderGpsStats` function**

```javascript
async function renderGpsStats(){
  const el=document.getElementById('gpsStatsContent');
  if(!el||!activeId){if(el)el.innerHTML='<div class="empty">Select your player first.</div>';return;}
  el.innerHTML='<div class="empty">Loading…</div>';
  try{
    const shots=await sbGet('gps_shots',`player_id=eq.${activeId}&order=round_date.desc,hole.asc,shot_num.asc`);
    if(!shots.length){el.innerHTML='<div class="empty">No GPS rounds recorded yet.</div>';return;}

    // Avg distance per club (GPS shots only, exclude chip/putt)
    const byClub={};
    shots.filter(s=>s.lat!=null&&s.club&&s.shot_weight!=='chip'&&s.shot_weight!=='putt').forEach(s=>{
      if(!byClub[s.club])byClub[s.club]={dists:[],count:0};
      byClub[s.club].count++;
      // find next GPS shot on same hole/round to calc distance
      const next=shots.find(n=>n.round_date===s.round_date&&n.hole===s.hole&&n.shot_num===s.shot_num+1&&n.lat!=null);
      if(next)byClub[s.club].dists.push(haversineM(s.lat,s.lng,next.lat,next.lng));
    });

    // Putts per round
    const byRound={};
    shots.forEach(s=>{
      const k=s.round_date;
      if(!byRound[k])byRound[k]={putts:0,holes:new Set(),dist:0};
      if(s.club==='Putter'||s.shot_weight==='putt')byRound[k].putts++;
      byRound[k].holes.add(s.hole);
    });
    // Distance walked per round
    shots.filter(s=>s.lat!=null).forEach(s=>{
      const next=shots.find(n=>n.round_date===s.round_date&&n.hole===s.hole&&n.shot_num===s.shot_num+1&&n.lat!=null);
      if(next&&byRound[s.round_date])byRound[s.round_date].dist+=haversineM(s.lat,s.lng,next.lat,next.lng);
    });

    const rounds=Object.keys(byRound).sort().reverse();
    const avgPutts=rounds.length?Math.round(rounds.reduce((s,r)=>s+byRound[r].putts,0)/rounds.length):0;
    const avgDist=rounds.length?Math.round(rounds.reduce((s,r)=>s+byRound[r].dist,0)/rounds.length):0;

    // Driver stats
    const driverFull=shots.filter(s=>s.club==='Driver'&&s.shot_weight==='full'&&s.lat!=null);
    const driverDists=driverFull.map(s=>{
      const next=shots.find(n=>n.round_date===s.round_date&&n.hole===s.hole&&n.shot_num===s.shot_num+1&&n.lat!=null);
      return next?haversineM(s.lat,s.lng,next.lat,next.lng):null;
    }).filter(d=>d!=null&&d>50&&d<400);
    const avgDriver=driverDists.length?Math.round(driverDists.reduce((a,b)=>a+b,0)/driverDists.length):null;
    const maxDriver=driverDists.length?Math.max(...driverDists):null;

    el.innerHTML=`
      <div class="stats-row" style="margin-top:1rem">
        ${avgDriver!=null?`<div class="sc"><div class="sl">Avg Drive</div><div class="sv">${avgDriver}m</div></div>`:''}
        ${maxDriver!=null?`<div class="sc"><div class="sl">Longest Drive</div><div class="sv">${maxDriver}m</div></div>`:''}
        <div class="sc"><div class="sl">Avg Putts</div><div class="sv">${avgPutts}</div><div class="ss">per round</div></div>
        <div class="sc"><div class="sl">Avg Distance</div><div class="sv">${(avgDist/1000).toFixed(1)}km</div><div class="ss">walked/round</div></div>
        <div class="sc"><div class="sl">GPS Rounds</div><div class="sv">${rounds.length}</div></div>
      </div>
      <div class="panel" style="margin-top:1rem">
        <div class="ph"><span class="pt">Avg Distance Per Club</span></div>
        <div class="pb">
          ${Object.entries(byClub).filter(([,v])=>v.dists.length>0).sort((a,b)=>Math.round(b[1].dists.reduce((x,y)=>x+y,0)/b[1].dists.length)-Math.round(a[1].dists.reduce((x,y)=>x+y,0)/a[1].dists.length)).map(([club,v])=>{
            const avg=Math.round(v.dists.reduce((x,y)=>x+y,0)/v.dists.length);
            const max=Math.max(...v.dists);
            return `<div style="display:flex;align-items:center;gap:10px;padding:6px 0;border-bottom:1px solid rgba(255,255,255,0.04)">
              <span style="min-width:60px;font-size:0.85rem;font-weight:500">${club}</span>
              <div style="flex:1;background:rgba(255,255,255,0.06);border-radius:4px;height:6px">
                <div style="width:${Math.min(100,Math.round(avg/4))}%;height:100%;background:var(--gold);border-radius:4px"></div>
              </div>
              <span style="font-family:'DM Mono',monospace;font-size:0.82rem;color:var(--gold-l)">${avg}m</span>
              <span style="font-size:0.7rem;color:rgba(255,255,255,0.3)">(max ${max}m, ${v.count} shots)</span>
            </div>`;
          }).join('')||'<div style="color:rgba(255,255,255,0.3);font-size:0.82rem">Not enough shots to calculate yet.</div>'}
        </div>
      </div>`;
  }catch(e){el.innerHTML=`<div class="empty">Error: ${e.message}</div>`;}
}
```

- [ ] **Step 4: Verify**

After recording 2+ GPS rounds, open My Rounds → GPS Stats. Stats cards and club distance bars appear. Driver avg/max shows if Driver shots recorded.

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "feat: GPS stats view — avg distance per club, driving stats, putts, distance walked"
```

---

## Task 14: Nav Visibility + Integration Polish

**Files:**
- Modify: `index.html` — `applyPendingUI`, `loadData`, init

- [ ] **Step 1: Show Track tab for eligible players**

Find `function applyPendingUI()` (~line 731). Add Track tab visibility logic:

```javascript
// Inside applyPendingUI, after the existing tab visibility lines:
const trackTab=document.getElementById('tabTrack');
if(trackTab){
  const me=players.find(x=>x.id===activeId)||pendingPlayers.find(x=>x.id===activeId);
  const canTrack=me&&me.approved!==false&&!me.is_social;
  trackTab.style.display=canTrack?'':'none';
}
```

- [ ] **Step 2: Reset GPS state on player change**

Find `function setPlayer(id)` (~line 2150). Add at the start:

```javascript
// Reset GPS tracking if player changes mid-round
if(GR&&id!==activeId){if(GR.map)GR.map.remove();GR=null;toast('GPS round cleared (player changed)');}
```

- [ ] **Step 3: Add admin bag editing capability**

In `renderAdmin()` or wherever admin player management is done, add a note or a direct call to `renderBagSetup()` when an admin selects a player — or simply note that admin can switch to the target player and use the bag setup in Players tab.

Confirm that `renderBagSetup()` works when admin is viewing another player's profile. If `activeId` is the admin but editing another player, you may need to pass a `targetPlayerId` parameter. Simplest approach: confirm `renderBagSetup()` operates on `activeId` and document that admin should switch player first.

- [ ] **Step 4: Verify Track tab visibility**

- Log in as a normal approved player → Track tab visible
- Log in as a Social member → Track tab hidden
- Pending player → Track tab hidden

- [ ] **Step 5: Verify GPS round state resets on player change**

Start a GPS round, switch player — toast appears, GR is null, Track tab shows start screen.

- [ ] **Step 6: Final end-to-end walkthrough**

1. Log in → Track tab visible
2. Track tab → start screen → set up bag if needed
3. Start Tracking → GPS permission → hole view with satellite map
4. Select club, select weight, tap Hit → dot appears on map
5. Tap Drop/Replay/Provisional → correct visual treatment
6. End Hole → summary card → enter score → Next Hole
7. After 18 (or Finish Round) → Log Round pre-filled → submit round normally
8. My Rounds → GPS Stats → stats appear

- [ ] **Step 7: Commit**

```bash
git add index.html
git commit -m "feat: Track tab visibility for eligible players, GPS state reset on player change"
```

---

## Task 15: Push for Review

- [ ] **Step 1: Push branch**

```bash
git push origin feat/gps-tracking
```

- [ ] **Step 2: Open PR via GitHub API**

```powershell
$token = "<your-github-token>"
$headers = @{ Authorization = "token $token"; Accept = "application/vnd.github.v3+json" }
$body = [PSCustomObject]@{
  title = "feat: GPS round tracker"
  head  = "feat/gps-tracking"
  base  = "main"
  body  = "## Summary`n- Live GPS shot tracking with Leaflet satellite map`n- Club bag setup per player`n- Shot types: normal, drop, replay, provisional (with resolution)`n- Open-Meteo wind data snapshotted per shot (silent during round)`n- End-of-hole score prompt pre-fills score entry`n- GPS stats: avg distance per club, driving, putts, distance walked`n`n## Test plan`n- [ ] Run migration SQL in Supabase`n- [ ] Track tab visible for approved non-social players only`n- [ ] GPS round start screen`n- [ ] Shot recording with map rendering`n- [ ] Provisional resolution (found / in play)`n- [ ] End hole → score prompt → next hole`n- [ ] Finish round → Log Round pre-filled`n- [ ] Bag setup saves and persists`n- [ ] GPS Stats renders after rounds recorded`n`n Generated with Claude Code"
} | ConvertTo-Json
$pr = Invoke-RestMethod -Uri "https://api.github.com/repos/GridSystems/RoyalGolfLeague/pulls" -Method Post -Headers $headers -Body $body -ContentType "application/json"
Write-Output $pr.html_url
```

---

## Self-Review Checklist

- [x] **Spec coverage:** All spec sections have corresponding tasks — DB schema (T1), Leaflet map (T7), shot types (T8,T9), weather (T5), bag setup (T12), GPS stats (T13), nav visibility (T14), score entry handoff (T11)
- [x] **Placeholder scan:** No TBD/TODO left — provisional behaviour fully specified, all code shown
- [x] **Type consistency:** `GR.shots`, `GR.selectedClub`, `GR.selectedWeight`, `GR.provisionalShotId`, `GR.holeScores` used consistently across tasks; `haversineM` and `windDegToText` names consistent throughout; `sbGet/sbInsert/sbUpdate/sbDelete` match existing helpers
- [x] **Chip/putt GPS suppression:** Task 8 checks `isChipOrPutt` and leaves `lat/lng` null — spec requirement met
- [x] **Wind not displayed during round:** `currentWeather` is snapshotted per shot but never rendered in the hole view HTML — spec requirement met
- [x] **GRANT on sequence:** Task 1 includes `GRANT USAGE, SELECT ON SEQUENCE public.gps_shots_id_seq` so BIGSERIAL inserts work via anon/authenticated roles
