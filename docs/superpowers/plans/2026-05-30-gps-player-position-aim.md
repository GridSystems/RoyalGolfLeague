# GPS Player Position & Aim Direction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a persistent blue player-position dot on the GPS map, and make the distance-ring cone/arc rotate in real-time to follow wherever the user pans the map.

**Architecture:** Three independent changes to `index.html`: (1) a persistent `GR.playerDot` circleMarker updated on every GPS fix; (2) `drawDistRings()` computes aim bearing from map centre instead of green, and `_distRingMoveHandler` now triggers a full ring redraw on every `move` event; (3) a 📍 re-centre button in the rings control bar.

**Tech Stack:** Leaflet.js, vanilla JS, single-file `index.html`. No build step.

---

## File

- Modify: `index.html`

Key lines for orientation:
- **GR init** — line 1129: `distRings:false,...,_distRingMoveHandler:null` (end of the GR object literal)
- **`startGpsWatch` / `watchPosition` callback** — lines 1144–1189
- **`stopGpsWatch`** — lines 1196–1199
- **`toggleDistRings`** — lines 1601–1614
- **`drawDistRings`** — lines 1640–1732 (aim bearing at lines 1653–1657; move handler at lines 1724–1731)
- **Rings control bar HTML** — lines 1343–1351 (rendered when `GR.distRings` is true)

---

## Task 1: Persistent player dot

**Files:**
- Modify: `index.html` (GR init, `watchPosition` callback, `stopGpsWatch`, `drawDistRings`)

### Step 1: Add `playerDot` to GR initialisation

Find line 1129:
```javascript
      distRings:false,distRingLayers:[],distRingLabelMarkers:[],distRingCentre:150,distRingInterval:10,_distRingMoveHandler:null
```
Replace with:
```javascript
      distRings:false,distRingLayers:[],distRingLabelMarkers:[],distRingCentre:150,distRingInterval:10,_distRingMoveHandler:null,
      playerDot:null
```

### Step 2: Create / update the dot on every GPS fix

Find this block inside the `watchPosition` callback (lines 1162–1167):
```javascript
      const firstFix=GR.currentAccuracy==null;
      GR.currentLat=lat;
      GR.currentLng=lng;
      GR.currentAccuracy=pos.coords.accuracy;
      // Centre map once on first watch fix
      if(firstFix&&GR.map)GR.map.setView([GR.currentLat,GR.currentLng],18);
```
Replace with:
```javascript
      const firstFix=GR.currentAccuracy==null;
      GR.currentLat=lat;
      GR.currentLng=lng;
      GR.currentAccuracy=pos.coords.accuracy;
      // Centre map once on first watch fix
      if(firstFix&&GR.map)GR.map.setView([GR.currentLat,GR.currentLng],18);
      // Persistent player dot — create on first fix, update position on subsequent fixes
      if(GR.map){
        if(!GR.playerDot){
          GR.playerDot=L.circleMarker([lat,lng],{radius:7,color:'#fff',weight:2,fillColor:'#4A90E2',fillOpacity:0.9,interactive:false,zIndexOffset:500}).addTo(GR.map);
        }else{
          GR.playerDot.setLatLng([lat,lng]);
        }
      }
```

### Step 3: Remove the dot when GPS watch stops

Find `stopGpsWatch` (lines 1196–1199):
```javascript
function stopGpsWatch(){
  if(gpsWatchId!==null){navigator.geolocation.clearWatch(gpsWatchId);gpsWatchId=null;}
  if(gpsWatchTimeout!==null){clearTimeout(gpsWatchTimeout);gpsWatchTimeout=null;}
}
```
Replace with:
```javascript
function stopGpsWatch(){
  if(gpsWatchId!==null){navigator.geolocation.clearWatch(gpsWatchId);gpsWatchId=null;}
  if(gpsWatchTimeout!==null){clearTimeout(gpsWatchTimeout);gpsWatchTimeout=null;}
  if(GR&&GR.playerDot){GR.playerDot.remove();GR.playerDot=null;}
}
```

### Step 4: Remove the redundant white player dot from `drawDistRings`

Find line 1705–1706 inside `drawDistRings`:
```javascript
  // Player dot
  GR.distRingLayers.push(L.circleMarker(pLL,{radius:6,color:'#fff',weight:2,fillColor:'#fff',fillOpacity:0.9,interactive:false}).addTo(GR.map));
```
Delete both lines (the comment and the marker push). The persistent `GR.playerDot` now handles this.

### Step 5: Verify visually

Open `index.html` in a browser. Navigate to the GPS tracker screen. Grant location. Confirm:
- A blue dot (blue fill, white border) appears at your GPS position
- The dot is visible without activating rings
- The dot updates as position changes

### Step 6: Commit

```bash
git add index.html
git commit -m "feat: persistent GPS player position dot"
```

---

## Task 2: Aim bearing from map centre + redraw on pan

**Files:**
- Modify: `index.html` (`drawDistRings`, `toggleDistRings`)

### Step 1: Replace green-bearing with map-centre bearing in `drawDistRings`

Find lines 1653–1657 inside `drawDistRings`:
```javascript
  // Aim bearing towards green
  const _hd=HOLE_DATA[GR.currentHole-1];
  const _sp=(GR.surveyPoints||[]).filter(p=>p.hole===GR.currentHole&&['mid_green','front_green','back_green'].includes(p.type));
  const _target=(_sp.find(p=>p.type==='mid_green')||_sp[0])||(_hd&&_hd.green?_hd.green:null);
  const brg=_target?bearingDeg(GR.currentLat,GR.currentLng,_target.lat,_target.lng):0;
```
Replace with:
```javascript
  // Aim bearing: player → map centre; fall back to green bearing if player is at map centre
  const mc=GR.map.getCenter();
  const distToMc=haversineM(GR.currentLat,GR.currentLng,mc.lat,mc.lng);
  let brg;
  if(distToMc<1){
    // Player at map centre — use green bearing as fallback
    const _hd=HOLE_DATA[GR.currentHole-1];
    const _sp=(GR.surveyPoints||[]).filter(p=>p.hole===GR.currentHole&&['mid_green','front_green','back_green'].includes(p.type));
    const _target=(_sp.find(p=>p.type==='mid_green')||_sp[0])||(_hd&&_hd.green?_hd.green:null);
    brg=_target?bearingDeg(GR.currentLat,GR.currentLng,_target.lat,_target.lng):0;
  }else{
    brg=bearingDeg(GR.currentLat,GR.currentLng,mc.lat,mc.lng);
  }
```

### Step 2: Make the move handler do a full redraw on `move`

Find lines 1724–1731 inside `drawDistRings` (the `_distRingMoveHandler` block):
```javascript
  GR._distRingMoveHandler=()=>{
    if(!GR||!GR.map||!GR.distRings)return;
    const bounds=GR.map.getBounds();
    GR.distRingLabelMarkers.forEach(({marker,radiusM})=>{
      marker.setLatLng(bestLabelPos(GR.currentLat,GR.currentLng,radiusM,brg,bounds,offsetM));
    });
  };
  GR.map.on('moveend',GR._distRingMoveHandler);
```
Replace with:
```javascript
  GR._distRingMoveHandler=()=>{ if(GR&&GR.distRings)drawDistRings(false); };
  GR.map.on('move',GR._distRingMoveHandler);
```

### Step 3: Update the `off` calls to match the new event name

Find line 1641 (top of `drawDistRings`, where the old handler is detached):
```javascript
  if(GR._distRingMoveHandler){GR.map&&GR.map.off('moveend',GR._distRingMoveHandler);GR._distRingMoveHandler=null;}
```
Replace with:
```javascript
  if(GR._distRingMoveHandler){GR.map&&GR.map.off('move',GR._distRingMoveHandler);GR._distRingMoveHandler=null;}
```

Find line 1604 (inside `toggleDistRings`, the off call when rings are disabled):
```javascript
    if(GR._distRingMoveHandler){GR.map.off('moveend',GR._distRingMoveHandler);GR._distRingMoveHandler=null;}
```
Replace with:
```javascript
    if(GR._distRingMoveHandler){GR.map.off('move',GR._distRingMoveHandler);GR._distRingMoveHandler=null;}
```

### Step 4: Verify visually

Open `index.html`. Activate rings. Pan the map left — the cone and bright arc should swing left in real-time. Pan right — cone swings right. Confirm the green distance pin (⛳) stays pointing at the green regardless of pan direction.

### Step 5: Commit

```bash
git add index.html
git commit -m "feat: distance ring cone follows map pan direction"
```

---

## Task 3: Re-centre button

**Files:**
- Modify: `index.html` (rings control bar HTML in `renderGpsHole`)

### Step 1: Add 📍 button to the rings control bar

Find the rings control bar block starting at line 1343. The full block looks like:
```javascript
${GR.distRings?`<div style="display:flex;gap:8px;align-items:center;padding:8px 12px;background:rgba(100,160,255,0.08);border-top:1px solid rgba(100,180,255,0.18);flex-wrap:wrap">
        <button class="btn btn-ghost btn-sm" onclick="shiftDistRings(-50)" style="min-width:44px">−50</button>
        <span id="distRingCentreDisplay" style="font-size:0.8rem;color:rgba(100,190,255,0.9);font-weight:600;min-width:58px;text-align:center">~${GR.distRingCentre}${getUnits()}</span>
        <button class="btn btn-ghost btn-sm" onclick="shiftDistRings(50)" style="min-width:44px">+50</button>
        <div style="width:1px;height:18px;background:rgba(255,255,255,0.12);margin:0 2px"></div>
        <button id="distRingIntervalBtn" class="btn btn-ghost btn-sm" onclick="cycleDistInterval()" style="min-width:48px">±${GR.distRingInterval}</button>
        <span style="font-size:0.7rem;color:rgba(255,255,255,0.3)">interval</span>
        <div style="width:1px;height:18px;background:rgba(255,255,255,0.12);margin:0 2px"></div>
        <span id="gpsAccBadge" style="font-size:0.75rem;font-weight:600;color:${GR.currentAccuracy!=null?(GR.currentAccuracy<=5?'rgba(127,204,158,0.9)':'rgba(240,180,60,0.9)'):'rgba(255,255,255,0.3)'}">${GR.currentAccuracy!=null?`📍 ±${Math.round(GR.currentAccuracy)}m`:'📍 …'}</span>
      </div>`
```

Replace the last `<span id="gpsAccBadge"...` line and closing `</div>` with:
```javascript
        <button class="btn btn-ghost btn-sm" onclick="if(GR&&GR.currentLat&&GR.map)GR.map.setView([GR.currentLat,GR.currentLng])" style="min-width:44px" title="Re-centre on me">📍 Me</button>
        <div style="width:1px;height:18px;background:rgba(255,255,255,0.12);margin:0 2px"></div>
        <span id="gpsAccBadge" style="font-size:0.75rem;font-weight:600;color:${GR.currentAccuracy!=null?(GR.currentAccuracy<=5?'rgba(127,204,158,0.9)':'rgba(240,180,60,0.9)'):'rgba(255,255,255,0.3)'}">${GR.currentAccuracy!=null?`📍 ±${Math.round(GR.currentAccuracy)}m`:'📍 …'}</span>
      </div>`
```

### Step 2: Verify visually

Open `index.html`. Activate rings. Pan the map far away. Tap "📍 Me" — map should snap back so the player position is at the centre. Confirm the cone now aims away from the player (because map centre is now the player position, triggering the green-bearing fallback).

### Step 3: Commit

```bash
git add index.html
git commit -m "feat: re-centre map on player position button"
```
