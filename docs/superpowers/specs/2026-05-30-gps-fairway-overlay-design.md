# GPS Fairway Ring Overlay Design Spec

**Date:** 2026-05-30
**Status:** Approved

---

## Problem

The GPS distance rings always aim at the green with a fixed ±15° cone. The cone width is arbitrary — it tells you nothing about the actual fairway shape. There's also no visible green distance marker on the map itself.

---

## Solution (v1)

When the rings overlay is active, replace the fixed ±15° cone with an accurate fairway-width overlay: the bright arc on each ring spans exactly the left and right edges of the fairway polygon at that distance, cone lines run to those edge intersection points, and a green distance pin sits at the green polygon centroid.

No spine data required — uses the fairway polygon already recorded for all 18 holes.

---

## Scope

**In scope (v1):**
- Fairway edge intersection dots on each ring
- Cone lines and bright arc adapted to actual fairway width
- Green distance pin at green polygon centroid

**Out of scope (v1 — deferred to v2):**
- Spine centreline dot (requires spine data per hole)
- Aim direction following map pan (separate feature)

---

## Algorithm: `ringFairwayIntersections(playerLat, playerLng, radiusM, polys, greenBrg)`

### Coordinate system
Local XY metres, origin = player position:
```
LAT_M = 111320
LNG_M = 111320 × cos(playerLat × π/180)
x = (lng - playerLng) × LNG_M
y = (lat - playerLat) × LAT_M
```

### Steps

1. Convert all polygon vertices to local XY.

2. For each edge `p1 → p2` in each polygon patch, solve for the parameter `s ∈ [0,1]` where the edge intersects the circle of radius `radiusM`:

   ```
   dx = p2x - p1x,  dy = p2y - p1y
   a  = dx² + dy²
   b  = 2(p1x·dx + p1y·dy)
   c  = p1x² + p1y² - radiusM²
   disc = b² - 4ac
   ```

   If `disc < 0`: no intersection. Otherwise:
   ```
   s = (-b ± √disc) / (2a)
   ```
   Keep solutions where `s ∈ [0,1]`. Intersection point: `(p1x + s·dx, p1y + s·dy)`.

3. Convert all intersection points back to LatLng.

4. Filter: keep only intersections where `bearingDeg(player, point)` is within ±90° of `greenBrg` (forward-facing — discard points behind the player).

5. Among forward intersections, compute bearing from player to each. Return:
   - `left`: point with the smallest bearing offset from `greenBrg` to the left (minimum bearing)
   - `right`: point with the largest bearing offset from `greenBrg` to the right (maximum bearing)

   If fewer than 2 forward intersections found, return `null` (fallback to fixed ±15°).

### Edge case: bearing wraparound
When comparing bearings, normalise differences to `(-180, +180]` to handle the 0°/360° boundary correctly.

---

## Green Centroid: `gpsGreenCentroid(hole)`

```javascript
function gpsGreenCentroid(hole) {
  const poly = greenPolygons[hole];
  if (poly && poly.length >= 3) {
    const lat = poly.reduce((s, v) => s + v[0], 0) / poly.length;
    const lng = poly.reduce((s, v) => s + v[1], 0) / poly.length;
    return { lat, lng };
  }
  return HOLE_DATA[hole - 1]?.green || null;
}
```

---

## Changes to `drawDistRings()`

### New behaviour per ring

For each ring at radius `R`:

1. Call `ringFairwayIntersections(...)` with the current hole's fairway polygon(s) and bearing to green.

2. **If intersections found (left + right):**
   - Bright arc: `arcPoints(playerLat, playerLng, radiusM, brgLeft, brgRight)` — spans the actual fairway width
   - Cone lines: `[playerLL → leftLL]` and `[playerLL → rightLL]` (replacing the fixed ±15° lines)
   - Edge dots: `L.circleMarker` at `leftLL` and `rightLL`, radius 4, matching ring colour

3. **If no intersections (hole has no polygon, or ring is beyond fairway):**
   - Fall back to existing fixed ±15° arc and cone lines (unchanged behaviour)

### Green distance pin (drawn once, after ring loop)

```javascript
const centroid = gpsGreenCentroid(GR.currentHole);
if (centroid) {
  const distM = haversineM(GR.currentLat, GR.currentLng, centroid.lat, centroid.lng);
  const distDisplay = isYd ? Math.round(distM / YD) + 'y' : Math.round(distM) + 'm';
  // L.marker at centroid with divIcon showing distDisplay + ' ⛳'
  // Style: gold text, dark background, same border-radius as ring labels
}
```

All new markers (dots, cone lines, green pin) are pushed to `GR.distRingLayers` and cleaned up automatically.

---

## Data Loading

### New global in `index.html`

```javascript
let fairwayPolygons = {}; // {hole: [[[lat,lng],...], ...]} — array of polygon patches per hole
```

### Addition to `loadData()`

```javascript
try {
  const fp = await sbGet('fairway_polygons', '');
  fairwayPolygons = {};
  fp.forEach(r => { fairwayPolygons[r.hole] = r.polygons; });
} catch(e) { console.warn('fairway_polygons load failed:', e); }
```

Table: `fairway_polygons` — columns `hole` (int), `polygons` (jsonb: `[[[lat,lng],...]]`).

---

## Fallback Matrix

| Condition | Behaviour |
|---|---|
| Fairway polygon exists for hole | Fairway-width arc, cone to edges, edge dots |
| No fairway polygon | Fixed ±15° arc and cone lines (existing) |
| Green polygon exists | Pin at centroid with computed distance |
| No green polygon | Pin at `HOLE_DATA[hole].green` |
| Ring beyond fairway (no forward intersections) | Fixed ±15° fallback for that ring |

---

## Functions

### New
- `gpsGreenCentroid(hole)` → `{lat, lng}` — centroid of green polygon or HOLE_DATA fallback
- `ringFairwayIntersections(playerLat, playerLng, radiusM, polys, greenBrg)` → `{left, right}` LatLng or `null`

### Modified
- `loadData()` — add fairway polygon fetch
- `drawDistRings()` — use fairway intersections for arc/cone; add green pin

---

## Visual Style

| Element | Style |
|---|---|
| Edge dots | `L.circleMarker`, radius 4, ring colour at opacity 1, weight 2 |
| Cone lines (to edges) | Same as existing: `rgba(255,255,255,0.18)`, weight 1, dashArray `4,8` |
| Bright arc | Same weight/opacity as existing arc, spans `brgLeft → brgRight` |
| Green pin label | Gold `rgba(255,208,55,1)`, dark background `rgba(0,0,0,0.65)`, same font/border as ring labels |
