# Fairway Spine Recording Design Spec

**Date:** 2026-05-28  
**Status:** Approved

---

## Problem

Each golf hole needs a centreline (spine) along the fairway so that distance-to-green can be calculated from any point in the fairway. "Leave me 120m to green from centre fairway" requires knowing the routed path from tee to green, including doglegs.

---

## Solution

Record a piecewise-linear spine per hole in `course-mapper.html`. Auto-generate a straight-line baseline (tee → green centroid). Allow the user to add draggable inflection waypoints for doglegs — waypoints auto-sort by projection along the tee→green vector so insertion order doesn't matter. Display 10m-interval distance rings from both the tee and the front of the green (viewport-aware), plus a draggable measurement marker that shows live distance rings to both anchors.

---

## Data Model

### Supabase table: `fairway_spines`

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

`waypoints` stores **inflection points only** — not the tee or green endpoint. Format: `[[lat,lng], [lat,lng], ...]`. A straight-line hole stores `[]`.

The full displayed polyline is always reconstructed as: `[teePoint, ...waypoints, greenCentroid]`.

Storing only waypoints means: if the green polygon is updated later, the spine automatically stretches to the new centroid. Tee position is already fixed in `HOLE_TEES`.

Upsert strategy: merge-on-conflict on `hole` (same pattern as `green_polygons`, `fairway_polygons`).

### localStorage key: `rgcFairwaySpines`

Format: `{ [hole]: [[lat,lng], ...] }` — hole key is a string (JSON). Empty array = straight line, no waypoints.

---

## Distance-to-Green (future use)

The stored data directly supports the planned distance calculation:

1. Reconstruct full spine: `[tee, ...waypoints, greenCentroid]`
2. For player position P, project P onto the nearest spine segment
3. Walk the remaining segments from the projection to `greenCentroid`
4. Sum = distance to green along the centreline

This works correctly for dogleg holes because the piecewise structure routes through the bend.

---

## State Variables

```javascript
let fairwaySpines    = JSON.parse(localStorage.getItem('rgcFairwaySpines') || '{}');
// { [hole]: [[lat,lng], ...] } — inflection waypoints only

let spinePolyLayers  = {};    // { [hole]: L.polyline } — saved spine renderings
let drawingSpine     = null;  // hole number currently in spine-edit mode, or null
let spineWaypoints   = [];    // working copy of waypoints during edit session
let spineWptMarkers  = [];    // L.marker[] — draggable waypoint dots during edit
let measureMarker    = null;  // L.marker — draggable measurement marker
let distRingLayers   = [];    // L.circle[] — static 10m rings from tee + green front
let liveRingLayers   = [];    // L.circle[] — live rings from measurement marker
```

---

## Recording UI — course-mapper.html

### Sidebar indicator

New **S** badge per hole in `renderHoleList`, after the F indicator:

- **Unset:** `S` (grey, `#2a2a3e`)
- **Set (no waypoints):** `S` (teal `#17a2b8`) — straight line recorded
- **Set (with waypoints):** `S2`, `S3` etc. (teal, showing waypoint count)
- Clicking always calls `startSpineMode(h)`

CSS:
```css
.ind-spine { font-size: 11px; padding: 2px 6px; border-radius: 3px; font-weight: 700; cursor: pointer; }
.ind-spine.set   { background: #17a2b8; color: #000; }
.ind-spine.unset { background: #2a2a3e; color: #555; }
.ind-spine:hover { opacity: 0.8; }
```

A **✕S** clear button appears in the hole-row clears section when a spine exists, following the ✕F pattern.

### Spine edit mode (`drawingSpine !== null`)

Entered by clicking the S indicator. Exits any active mode first.

**Map contents during edit:**
- Teal polyline connecting `[tee, ...spineWaypoints, greenCentroid]`
- Fixed anchor markers at tee (non-draggable, teal pin) and green centroid (non-draggable, teal pin)
- Draggable waypoint dots for each inflection point (same style as fairway vertex markers). **Click** a waypoint → delete it. **Drag** → reposition it (re-sorts on dragend).
- Static 10m-interval distance rings from the tee and from the green front (viewport-aware — see Distance Overlay section)
- Draggable 📍 measurement marker, initially placed at the spine midpoint

**Interactions:**
- **Click empty map** → `addSpineWaypoint(latlng)` — inserts waypoint at correct sorted position, redraws polyline
- **Drag waypoint** → reposition, re-sort all waypoints by projection on dragend, redraw
- **Click waypoint** → delete waypoint, redraw
- **Drag measurement marker** → update live rings and distance labels
- **✓ Finish** → `finishSpine()` — saves, exits
- **🗑 Clear** → `clearSpineWaypoints()` — removes all inflection points (keeps straight-line spine)
- **✕ Cancel** → `cancelSpine()` — exits without saving

Draw bar label: `Spine N — M waypoints` (or `Spine N — straight` when M = 0).

---

## Waypoint Ordering

When a new waypoint P is added (or a waypoint is dragged to a new position), all waypoints are sorted by their scalar projection onto the tee→green vector:

```javascript
function spineProjection(pt, tee, green) {
  const dx = green.lat - tee.lat, dy = green.lng - tee.lng;
  const px = pt[0]  - tee.lat,   py = pt[1]  - tee.lng;
  return (px * dx + py * dy) / (dx * dx + dy * dy); // t in [0,1]
}
// sort: spineWaypoints.sort((a, b) => spineProjection(a, tee, green) - spineProjection(b, tee, green))
```

This ensures waypoints always run tee→green regardless of click/drag order.

---

## Distance Overlay

### Static rings

Shown throughout spine edit mode. Updated on map `moveend` and `zoomend`.

- Rings from **tee**: grey `#888888`, dashed (`dashArray: '4 6'`), `fillOpacity: 0`, at 10m intervals up to the farthest visible viewport corner from the tee
- Rings from **green front**: amber `#f39c12`, dashed, `fillOpacity: 0`, at 10m intervals up to the farthest visible viewport corner from the green front
- Each ring has a small tooltip showing its distance (e.g. `"150m"`) on hover

**Green front** = vertex in `greenPolygons[hole]` with minimum Euclidean distance to the tee position. (Euclidean is sufficient at these geographic scales.)

**Viewport-aware computation:**
```javascript
function maxViewportDist(anchor) {
  const b = map.getBounds();
  const corners = [b.getNorthWest(), b.getNorthEast(), b.getSouthWest(), b.getSouthEast()];
  return Math.max(...corners.map(c => haversineM(anchor, c)));
}
// rings = [10, 20, 30, ..., Math.ceil(maxDist / 10) * 10]
```

### Live rings (measurement marker)

On `dragend` of the measurement marker:
1. `distToTee = haversineM(markerLatLng, HOLE_TEES[hole-1])`
2. `distToGreen = haversineM(markerLatLng, greenFront(hole))`
3. Remove all `liveRingLayers`
4. Draw circle centred on tee, radius `distToTee`, style: grey, solid, weight 2
5. Draw circle centred on green front, radius `distToGreen`, style: amber, solid, weight 2
6. Show floating labels: `"XXm from tee"` and `"XXm to green"` near the marker

---

## Map Rendering (saved spines)

Outside of edit mode, all saved spines render as teal polylines:

```javascript
{ color: '#17a2b8', weight: 2, opacity: 0.7 }
```

With tooltip `"Hole N spine"` on hover. No fill. During spine edit for hole N, the saved spine for that hole is hidden (the working edit polyline replaces it).

---

## Functions — course-mapper.html

### Helper functions
- `greenCentroid(hole)` → `{lat, lng}` — average lat/lng of all vertices in `greenPolygons[hole]`
- `greenFront(hole)` → `{lat, lng}` — vertex in `greenPolygons[hole]` nearest to `HOLE_TEES[hole-1]`
- `spineProjection(pt, tee, green)` → `number` — scalar projection t along tee→green (see Waypoint Ordering)
- `sortSpineWaypoints()` — sorts `spineWaypoints` in-place by `spineProjection`

### Spine mode entry/exit
- `startSpineMode(hole)` — exits any active mode; sets `drawingSpine`; copies `fairwaySpines[hole] || []` into `spineWaypoints`; calls `redrawEditSpine()`, `showDistanceRings()`, `initMeasurementMarker()`; shows draw bar; flies to hole bounds
- `finishSpine()` — calls `sortSpineWaypoints()`; captures `hole = drawingSpine` and `wpts = [...spineWaypoints]`; saves to `fairwaySpines[hole]`; calls `saveAll()` + `sbUpsertFairwaySpines(hole, wpts)`; calls `_exitSpineMode()`; calls `redrawAllSpines()`; updates sidebar. (Capturing before `_exitSpineMode` resets state ensures a Supabase retry is safe.)
- `cancelSpine()` — calls `_exitSpineMode()`
- `_exitSpineMode()` — removes edit polyline, `spineWptMarkers`, measurement marker, distance rings, live rings; resets `drawingSpine`, `spineWaypoints`, `spineWptMarkers`, `measureMarker`, `distRingLayers`, `liveRingLayers`; hides draw bar
- `clearSpineWaypoints()` — clears `spineWaypoints`, redraws edit spine (straight line remains)
- `deleteSpine(hole)` — deletes `fairwaySpines[hole]`; calls `saveAll()` + `sbUpsertFairwaySpines(hole, [])`; removes `spinePolyLayers[hole]`; updates sidebar

### Waypoint editing
- `addSpineWaypoint(latlng)` — pushes `[latlng.lat, latlng.lng]` to `spineWaypoints`, calls `sortSpineWaypoints()`, calls `redrawEditSpine()`
- `deleteSpineWaypoint(idx)` — removes index from `spineWaypoints`, calls `redrawEditSpine()`
- `redrawEditSpine()` — rebuilds teal edit polyline (`[tee, ...spineWaypoints, greenCentroid]`) and replaces all `spineWptMarkers` (draggable dots with click-to-delete and dragend-resort)

### Distance overlay
- `updateDistanceRings()` — called on `moveend`/`zoomend` when `drawingSpine !== null`; clears `distRingLayers`; recomputes viewport max distances; creates 10m-interval rings from tee (grey) and green front (amber); stores in `distRingLayers`
- `initMeasurementMarker(hole)` — creates draggable marker at spine midpoint; on `dragend`, computes distances, clears `liveRingLayers`, draws two live circles + distance labels
- `showDistanceRings()` — calls `updateDistanceRings()`; wires `map.on('moveend zoomend', updateDistanceRings)`
- `hideDistanceRings()` — removes all `distRingLayers`; unwires `moveend`/`zoomend` handler
- `removeMeasurementMarker()` — removes `measureMarker` from map; clears `liveRingLayers`

### Persistence
- `sbUpsertFairwaySpines(hole, waypoints)` — POST to `/rest/v1/fairway_spines?on_conflict=hole` with `Prefer: resolution=merge-duplicates,return=minimal`. If `waypoints` is empty array, DELETEs the row instead.
- `redrawAllSpines()` — clears `spinePolyLayers`; re-renders all entries in `fairwaySpines` as teal polylines (full spine including tee + green centroid endpoints)

### Modified functions
- `saveAll()` — adds `localStorage.setItem('rgcFairwaySpines', JSON.stringify(fairwaySpines))`
- `map.on('click')` — routes to `addSpineWaypoint(e.latlng)` when `drawingSpine !== null` (above fairway select check)
- `renderHoleList()` — adds S indicator and ✕S clear button per hole
- `_exitDrawMode()` — also resets `drawingSpine`, `spineWaypoints`, `spineWptMarkers`
- `startDrawGreen(hole)`, `startDrawTee(hole)`, `startFairwayMode(hole)` — each calls `if (drawingSpine !== null) _exitSpineMode()` at top
- `updateDrawBar()` — shows `Spine N — M waypoints` when `drawingSpine !== null` and M > 0; shows `Spine N — straight` when M = 0
- Init section — calls `redrawAllSpines()` alongside `redrawAllFairwayPolygons()`

---

## Supabase upsert strategy

```
POST /rest/v1/fairway_spines?on_conflict=hole
Prefer: resolution=merge-duplicates,return=minimal
Body: { hole, waypoints: [[lat,lng], ...] }
```

Empty `waypoints: []` is valid (straight line). If the spine is deleted entirely, send a DELETE to `/rest/v1/fairway_spines?hole=eq.{hole}`.

---

## Out of Scope

- Distance-to-green calculation from player GPS position (future phase — spine data enables it)
- Showing spines in `index.html` scoring app (next phase after calculation logic)
- Auto-detecting dogleg direction from fairway polygon shape (manual placement only)
- Per-waypoint labels or metadata
