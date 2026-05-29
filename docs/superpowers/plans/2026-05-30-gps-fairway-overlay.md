# GPS Fairway Ring Overlay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When GPS distance rings are active, replace the fixed ±15° cone with a fairway-width overlay — bright arcs and edge dots at actual polygon boundaries — plus a green distance pin at the green polygon centroid.

**Architecture:** Three changes to `index.html` only: (1) load `fairwayPolygons` in `loadData()`; (2) add two helper functions `gpsGreenCentroid` and `ringFairwayIntersections`; (3) replace the cone/arc logic in `drawDistRings()` with fairway-aware versions. Falls back to ±15° when no polygon data exists.

**Tech Stack:** Vanilla JS, Leaflet.js. Single file: `index.html`.

---

## File Structure

**Modify only:** `index.html`

| Location | Change |
|---|---|
| After `let greenPolygons = {};` (~line 764) | Add `let fairwayPolygons = {};` global |
| `loadData()` (~line 857) | Add `fairway_polygons` fetch |
| After `function arcPoints` (~line 1535) | Add `gpsGreenCentroid` + `ringFairwayIntersections` |
| `drawDistRings()` (~line 1582) | Replace with fairway-aware version |

---

## Task 1: Load fairway polygon data

**Files:**
- Modify: `index.html` — add global + `loadData()` addition

- [ ] **Step 1: Add `fairwayPolygons` global**

Find this line (~line 764):
```javascript
let greenPolygons = {};  // {hole: [[lat,lng],...]} loaded from Supabase
```

Insert immediately after it:
```javascript
let fairwayPolygons = {}; // {hole: [[[lat,lng],...], ...]} — array of polygon patches per hole
```

- [ ] **Step 2: Add fairway polygon fetch to `loadData()`**

Find this block inside `loadData()` (~line 857):
```javascript
  try{const pg=await sbGet('green_polygons','');greenPolygons={};pg.forEach(r=>{greenPolygons[r.hole]=r.vertices;});}catch(e){console.warn('green_polygons load failed:',e);}
```

Add immediately after it:
```javascript
  try{const fp=await sbGet('fairway_polygons','');fairwayPolygons={};fp.forEach(r=>{fairwayPolygons[r.hole]=r.polygons;});}catch(e){console.warn('fairway_polygons load failed:',e);}
```

- [ ] **Step 3: Verify in browser console**

Open `index.html`. After the page loads, run:
```javascript
console.log('Fairway polygon holes:', Object.keys(fairwayPolygons).map(Number).sort((a,b)=>a-b));
console.log('Hole 1 patches:', fairwayPolygons[1]?.length, 'vertices[0]:', fairwayPolygons[1]?.[0]?.length);
```

Expected: 18 hole keys, hole 1 has 1+ patches each with many vertices.

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "feat: load fairway polygon data in GPS tracker"
```

---

## Task 2: Add `gpsGreenCentroid` and `ringFairwayIntersections` helpers

**Files:**
- Modify: `index.html` — insert after `function arcPoints` (~line 1542)

- [ ] **Step 1: Insert both helper functions**

Find this line (~line 1543):
```javascript
function toggleDistRings(){
```

Insert the following block immediately before it:

```javascript
// Returns the centroid of the green polygon for a hole, or HOLE_DATA fallback.
function gpsGreenCentroid(hole) {
  const poly = greenPolygons[hole];
  if (poly && poly.length >= 3) {
    const lat = poly.reduce((s, v) => s + v[0], 0) / poly.length;
    const lng = poly.reduce((s, v) => s + v[1], 0) / poly.length;
    return { lat, lng };
  }
  return HOLE_DATA[hole - 1]?.green || null;
}

// Finds where a ring circle (radius radiusM, centred on player) intersects the
// fairway polygon boundary in the forward direction (within ±90° of greenBrg).
// Returns { left: [lat,lng], right: [lat,lng] } or null if < 2 intersections found.
function ringFairwayIntersections(playerLat, playerLng, radiusM, polys, greenBrg) {
  const LAT_M = 111320;
  const LNG_M = 111320 * Math.cos(playerLat * Math.PI / 180);
  function toXY(lat, lng) { return [(lng - playerLng) * LNG_M, (lat - playerLat) * LAT_M]; }
  function toLL(x, y)     { return [playerLat + y / LAT_M, playerLng + x / LNG_M]; }

  const hits = [];
  for (const poly of polys) {
    const verts = poly.map(v => toXY(v[0], v[1]));
    for (let i = 0; i < verts.length; i++) {
      const [p1x, p1y] = verts[i];
      const [p2x, p2y] = verts[(i + 1) % verts.length];
      const dx = p2x - p1x, dy = p2y - p1y;
      const a = dx * dx + dy * dy;
      if (a < 1e-10) continue;
      const b = 2 * (p1x * dx + p1y * dy);
      const c = p1x * p1x + p1y * p1y - radiusM * radiusM;
      const disc = b * b - 4 * a * c;
      if (disc < 0) continue;
      const sq = Math.sqrt(disc);
      for (const s of [(-b - sq) / (2 * a), (-b + sq) / (2 * a)]) {
        if (s < -1e-9 || s > 1 + 1e-9) continue;
        hits.push(toLL(p1x + s * dx, p1y + s * dy));
      }
    }
  }

  // Keep only forward-facing hits (within ±90° of greenBrg)
  const forward = hits.filter(([lat, lng]) => {
    const diff = ((bearingDeg(playerLat, playerLng, lat, lng) - greenBrg + 540) % 360) - 180;
    return Math.abs(diff) <= 90;
  });
  if (forward.length < 2) return null;

  // Sort by signed bearing offset from greenBrg (negative = left, positive = right)
  forward.sort((a, b) => {
    const oa = ((bearingDeg(playerLat, playerLng, a[0], a[1]) - greenBrg + 540) % 360) - 180;
    const ob = ((bearingDeg(playerLat, playerLng, b[0], b[1]) - greenBrg + 540) % 360) - 180;
    return oa - ob;
  });
  return { left: forward[0], right: forward[forward.length - 1] };
}

```

- [ ] **Step 2: Verify `gpsGreenCentroid` in browser console**

```javascript
const c = gpsGreenCentroid(1);
console.log('Hole 1 green centroid:', c);
// Expected: {lat: ~55.636..., lng: ~12.568...} — within Royal Golf Club bounds
```

- [ ] **Step 3: Verify `ringFairwayIntersections` in browser console**

```javascript
// Simulate standing at hole 1 tee, ring at 150m, aiming at green
const hole = 1;
const tee = HOLE_DATA[0].tee;
const green = HOLE_DATA[0].green;
const brg = bearingDeg(tee.lat, tee.lng, green.lat, green.lng);
const result = ringFairwayIntersections(tee.lat, tee.lng, 150, fairwayPolygons[1], brg);
console.log('Hole 1, 150m ring intersections:', result);
// Expected: { left: [lat, lng], right: [lat, lng] }
// — two points roughly 150m from tee on left and right fairway edges
// — both should be within Royal Golf Club lat/lng bounds (~55.635-55.637, ~12.568-12.570)

// Also verify no-polygon fallback returns null
const noResult = ringFairwayIntersections(tee.lat, tee.lng, 150, [], brg);
console.log('No polygon fallback:', noResult); // Expected: null
```

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "feat: add gpsGreenCentroid and ringFairwayIntersections helpers"
```

---

## Task 3: Upgrade `drawDistRings()` with fairway overlay and green pin

**Files:**
- Modify: `index.html` — replace `drawDistRings()` (~lines 1582–1641)

- [ ] **Step 1: Replace `drawDistRings()`**

Find the entire existing function (from `function drawDistRings(refit=true){` to its closing `}`) at ~lines 1582–1641 and replace it with:

```javascript
function drawDistRings(refit=true){
  if(GR._distRingMoveHandler){GR.map&&GR.map.off('moveend',GR._distRingMoveHandler);GR._distRingMoveHandler=null;}
  (GR.distRingLayers||[]).forEach(l=>l.remove());
  GR.distRingLayers=[];GR.distRingLabelMarkers=[];
  if(!GR.distRings||!GR.currentLat||!GR.currentLng||!GR.map)return;
  const isYd=getUnits()==='yd';
  const YD=0.9144;
  const centre=GR.distRingCentre||150;
  const interval=GR.distRingInterval||10;
  const offsetM=isYd?5*YD:5;
  const pLL=[GR.currentLat,GR.currentLng];
  const startU=Math.max(interval,centre-50);
  const endU=centre+50;
  // Aim bearing towards green
  const _hd=HOLE_DATA[GR.currentHole-1];
  const _sp=(GR.surveyPoints||[]).filter(p=>p.hole===GR.currentHole&&['mid_green','front_green','back_green'].includes(p.type));
  const _target=(_sp.find(p=>p.type==='mid_green')||_sp[0])||(_hd&&_hd.green?_hd.green:null);
  const brg=_target?bearingDeg(GR.currentLat,GR.currentLng,_target.lat,_target.lng):0;
  // Fairway polygon patches for current hole
  const fwPolys=fairwayPolygons[GR.currentHole]||[];
  let outerLeft=null,outerRight=null;
  let ri=0;
  for(let u=Math.ceil(startU/interval)*interval;u<=endU;u+=interval){
    const radiusM=isYd?u*YD:u;
    const isCentre=u===centre;
    // Dim full ring
    GR.distRingLayers.push(L.circle(pLL,{radius:radiusM,color:ringCol(ri,isCentre?0.35:0.18),weight:1,fill:false,dashArray:'3,10',interactive:false}).addTo(GR.map));
    // Try fairway-width arc; fall back to fixed ±15°
    const fw=fwPolys.length>0?ringFairwayIntersections(GR.currentLat,GR.currentLng,radiusM,fwPolys,brg):null;
    if(fw){
      const brgL=bearingDeg(GR.currentLat,GR.currentLng,fw.left[0],fw.left[1]);
      const brgR=bearingDeg(GR.currentLat,GR.currentLng,fw.right[0],fw.right[1]);
      // Ensure arc goes clockwise from left to right (handle 0°/360° wrap)
      const arcTo=brgR<brgL?brgR+360:brgR;
      GR.distRingLayers.push(L.polyline(arcPoints(GR.currentLat,GR.currentLng,radiusM,brgL,arcTo),{
        color:ringCol(ri,isCentre?1:0.7),weight:isCentre?3:2,fill:false,interactive:false
      }).addTo(GR.map));
      // Edge dots on the ring
      GR.distRingLayers.push(L.circleMarker(fw.left,{radius:4,color:ringCol(ri,1),weight:2,fillColor:ringCol(ri,1),fillOpacity:1,interactive:false}).addTo(GR.map));
      GR.distRingLayers.push(L.circleMarker(fw.right,{radius:4,color:ringCol(ri,1),weight:2,fillColor:ringCol(ri,1),fillOpacity:1,interactive:false}).addTo(GR.map));
      outerLeft=fw.left;outerRight=fw.right;
    }else{
      GR.distRingLayers.push(L.polyline(arcPoints(GR.currentLat,GR.currentLng,radiusM,brg-15,brg+15),{
        color:ringCol(ri,isCentre?1:0.7),weight:isCentre?3:2,fill:false,interactive:false
      }).addTo(GR.map));
    }
    // Distance label
    const lblPt=bestLabelPos(GR.currentLat,GR.currentLng,radiusM,brg,GR.map.getBounds(),offsetM);
    const lbl=L.marker(lblPt,{
      icon:L.divIcon({className:'',html:`<div style="font-size:9px;color:${ringCol(ri,1)};font-weight:700;white-space:nowrap;text-shadow:0 1px 3px #000;background:rgba(0,0,0,0.65);padding:1px 4px;border-radius:3px;border:1px solid ${ringCol(ri,0.5)}">${u}${isYd?'y':'m'}</div>`,iconSize:[32,14],iconAnchor:[16,7]}),
      interactive:false,zIndexOffset:300
    }).addTo(GR.map);
    GR.distRingLayers.push(lbl);
    GR.distRingLabelMarkers.push({marker:lbl,radiusM});
    ri++;
  }
  // Cone edge lines — to fairway edges if found, else fixed ±15°
  const coneDistM=isYd?(endU+15)*YD:(endU+15);
  if(outerLeft&&outerRight){
    GR.distRingLayers.push(L.polyline([pLL,outerLeft],{color:'rgba(255,255,255,0.18)',weight:1,dashArray:'4,8',interactive:false}).addTo(GR.map));
    GR.distRingLayers.push(L.polyline([pLL,outerRight],{color:'rgba(255,255,255,0.18)',weight:1,dashArray:'4,8',interactive:false}).addTo(GR.map));
  }else{
    GR.distRingLayers.push(L.polyline([pLL,pointAtBearingDist(GR.currentLat,GR.currentLng,(brg-15+360)%360,coneDistM)],{color:'rgba(255,255,255,0.18)',weight:1,dashArray:'4,8',interactive:false}).addTo(GR.map));
    GR.distRingLayers.push(L.polyline([pLL,pointAtBearingDist(GR.currentLat,GR.currentLng,(brg+15)%360,coneDistM)],{color:'rgba(255,255,255,0.18)',weight:1,dashArray:'4,8',interactive:false}).addTo(GR.map));
  }
  // Player dot
  GR.distRingLayers.push(L.circleMarker(pLL,{radius:6,color:'#fff',weight:2,fillColor:'#fff',fillOpacity:0.9,interactive:false}).addTo(GR.map));
  // Green distance pin at green polygon centroid
  const greenCent=gpsGreenCentroid(GR.currentHole);
  if(greenCent){
    const distM=haversineM(GR.currentLat,GR.currentLng,greenCent.lat,greenCent.lng);
    const distDisplay=isYd?Math.round(distM/YD)+'y':Math.round(distM)+'m';
    GR.distRingLayers.push(L.marker([greenCent.lat,greenCent.lng],{
      icon:L.divIcon({className:'',html:`<div style="font-size:10px;color:rgba(255,208,55,1);font-weight:700;white-space:nowrap;text-shadow:0 1px 3px #000;background:rgba(0,0,0,0.75);padding:2px 5px;border-radius:4px;border:1px solid rgba(255,208,55,0.5)">${distDisplay} ⛳</div>`,iconSize:[52,16],iconAnchor:[26,8]}),
      interactive:false,zIndexOffset:400
    }).addTo(GR.map));
  }
  // Fit map on initial activation only
  if(refit){
    const maxRadM=isYd?(endU+15)*YD:(endU+15);
    const deg=maxRadM/111320;
    GR.map.fitBounds([[GR.currentLat-deg,GR.currentLng-deg],[GR.currentLat+deg,GR.currentLng+deg]],{padding:[20,20]});
  }
  // Reposition labels on pan
  GR._distRingMoveHandler=()=>{
    if(!GR||!GR.map||!GR.distRings)return;
    const bounds=GR.map.getBounds();
    GR.distRingLabelMarkers.forEach(({marker,radiusM})=>{
      marker.setLatLng(bestLabelPos(GR.currentLat,GR.currentLng,radiusM,brg,bounds,offsetM));
    });
  };
  GR.map.on('moveend',GR._distRingMoveHandler);
}
```

- [ ] **Step 2: Verify rings activate without errors**

Open `index.html` in a browser. Go to GPS → start a GPS round for any hole. Tap **📍 Rings**.

Expected:
- No console errors
- Rings appear on map
- Distance labels visible (100m, 110m … 200m at default settings)
- Player dot visible at centre

- [ ] **Step 3: Verify fairway-width arcs**

With rings active on hole 1, open DevTools Console and simulate a position near the hole 1 tee:

```javascript
GR.currentLat = 55.6358;  // approx hole 1 tee lat
GR.currentLng = 12.5686;  // approx hole 1 tee lng
drawDistRings(false);
```

Expected:
- The bright arc on each ring now spans a narrower, asymmetric angle (not a symmetric ±15°) matching the actual fairway polygon width
- Two small coloured dots visible at left and right fairway edges on each ring
- Two dashed white lines run from the player dot to the outermost edge dots (not to fixed ±15° points)

- [ ] **Step 4: Verify green distance pin**

With rings active (same simulated position):
- A gold label reading "XXXm ⛳" (or "XXXy ⛳" in yards mode) appears on the map at the green location
- Distance is plausible (for hole 1 from the tee, expect ~350–400m)

Run in console:
```javascript
const c = gpsGreenCentroid(GR.currentHole);
const d = haversineM(GR.currentLat, GR.currentLng, c.lat, c.lng);
console.log('Distance to green centroid:', Math.round(d) + 'm');
```

Expected: a reasonable yardage for the hole.

- [ ] **Step 5: Verify fallback on hole without polygon**

```javascript
// Temporarily clear polygon for current hole and redraw
const saved = fairwayPolygons[GR.currentHole];
delete fairwayPolygons[GR.currentHole];
drawDistRings(false);
// Expected: symmetric ±15° cone, no edge dots — identical to old behaviour
fairwayPolygons[GR.currentHole] = saved;
drawDistRings(false);
// Expected: fairway-width arcs return
```

- [ ] **Step 6: Verify shift and interval controls still work**

With rings active, click **−50** and **+50** buttons. Click **±interval** to cycle 5/10/20.

Expected: rings redraw correctly at new positions/intervals, fairway arcs and green pin update each time, no console errors.

- [ ] **Step 7: Commit**

```bash
git add index.html
git commit -m "feat: fairway-width ring arcs, edge dots and green distance pin on GPS rings"
```
