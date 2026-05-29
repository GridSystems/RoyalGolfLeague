# Auto-Compute Fairway Spine Design Spec

**Date:** 2026-05-28  
**Status:** Approved

---

## Problem

Recording fairway spines manually (S-badge in course-mapper) is time-consuming and hasn't been used. All 18 fairway polygons are already recorded in Supabase. The centreline should be derivable automatically from that polygon data, with manual correction available for any holes where the result is off.

---

## Solution

Auto-compute the spine when entering spine-edit mode for a hole with no saved spine. Use perpendicular cross-section sampling along the tee→green axis to find the fairway width midpoint at regular intervals, then simplify the result. Display the computed points as draggable waypoints so the user can correct any that look wrong before saving.

---

## Algorithm: `autoComputeSpine(hole)`

### Coordinate system
Local XY in metres, origin = tee position. Conversion:
```
LAT_M = 111320
LNG_M = 111320 × cos(tee.lat × π/180)
x = (lng - tee.lng) × LNG_M
y = (lat - tee.lat) × LAT_M
```

### Steps

1. Compute unit vector `(ux, uy)` along tee→green in local metres.  
   Perpendicular: `(px, py) = (-uy, ux)`.

2. Sample every `STEP = 15` metres along the axis, from `STEP` to `totalLen - STEP` (skip endpoints — tee and green are always the first/last polyline points).

3. At each sample distance `d`:
   - Axis point: `(ax, ay) = tee_xy + d × (ux, uy)`
   - For each edge of each fairway polygon, solve the intersection with the perpendicular ray through `(ax, ay)`:  
     `det = edx×py − edy×px`  
     `t   = (edx×(e1y−ay) − edy×(e1x−ax)) / det`  
     `s   = (px×(e1y−ay) − py×(e1x−ax)) / det`  
     Keep `t` if `s ∈ [0, 1]`.
   - Collect all `t` values; need ≥ 2 hits to form a cross-section.
   - Midpoint `t_mid = (min(t) + max(t)) / 2`
   - Midpoint in XY: `(ax + t_mid×px, ay + t_mid×py)`

4. Douglas-Peucker simplify the raw XY sample array with `epsilon = 4` metres.

5. Convert simplified points back to `[lat, lng]` and return as waypoints array.  
   Return `[]` if fewer than 2 hits were found at every sample (no fairway polygon intersection — hole falls back to straight-line spine).

---

## Douglas-Peucker (`dpSimplify2D`)

Standard recursive DP for 2D points (metres). New helper function:

```javascript
function dpSimplify2D(pts, eps) {
  if (pts.length < 3) return pts.slice();
  // Find point farthest from line pts[0]→pts[last]
  let maxD = 0, idx = 0;
  const [x1,y1] = pts[0], [x2,y2] = pts[pts.length-1];
  const dx = x2-x1, dy = y2-y1, len = Math.sqrt(dx*dx+dy*dy);
  for (let i = 1; i < pts.length-1; i++) {
    const d = len < 1e-9 ? Math.hypot(pts[i][0]-x1, pts[i][1]-y1)
      : Math.abs(dy*pts[i][0] - dx*pts[i][1] + x2*y1 - y2*x1) / len;
    if (d > maxD) { maxD = d; idx = i; }
  }
  if (maxD <= eps) return [pts[0], pts[pts.length-1]];
  return [
    ...dpSimplify2D(pts.slice(0, idx+1), eps).slice(0,-1),
    ...dpSimplify2D(pts.slice(idx), eps)
  ];
}
```

---

## UI Changes — course-mapper.html

### `startSpineMode(hole)` modification

After copying existing waypoints into `spineWaypoints`, add:

```
if (spineWaypoints.length === 0 && fairwayPolygons[hole]?.length > 0) {
  spineWaypoints = autoComputeSpine(hole);
}
```

So: holes with no saved spine auto-fill on entry. Holes with a saved spine always load their saved spine.

### "↺ Auto" button in draw bar

Added to the spine draw bar (alongside ✓ Finish, 🗑 Clear, ✕ Cancel). Only visible when `fairwayPolygons[drawingSpine]` has data.

Calls `resetSpineToAuto()`:
```javascript
function resetSpineToAuto() {
  spineWaypoints = autoComputeSpine(drawingSpine);
  redrawEditSpine();
}
```

Draw bar label format unchanged: `Spine N — M waypoints` / `Spine N — straight`.

---

## Functions

### New
- `dpSimplify2D(pts, eps)` → `[[x,y], ...]` — Douglas-Peucker in local metres
- `autoComputeSpine(hole)` → `[[lat,lng], ...]` — perpendicular cross-section sampling + DP simplification
- `resetSpineToAuto()` — refills `spineWaypoints` from `autoComputeSpine(drawingSpine)`, redraws

### Modified
- `startSpineMode(hole)` — auto-fill from `autoComputeSpine` when no saved spine and fairway polygon exists
- `setSpineDrawBar()` / `updateDrawBar()` — adds "↺ Auto" button when fairway polygon exists for hole

---

## Constants
```javascript
const SPINE_STEP_M     = 15;  // cross-section sample interval (metres)
const SPINE_DP_EPS_M   = 4;   // Douglas-Peucker simplification threshold (metres)
const SPINE_MAX_HALF_W = 120; // max perpendicular search distance (metres) — covers any fairway width
```

---

## Behaviour Matrix

| Condition | `startSpineMode` behaviour |
|---|---|
| No saved spine, no fairway polygon | Straight line (0 waypoints) |
| No saved spine, fairway polygon exists | Auto-compute fills waypoints |
| Saved spine exists | Load saved spine (auto-compute not triggered) |
| Click "↺ Auto" during edit | Always re-runs auto-compute, replaces current waypoints |

---

## Out of Scope

- GPS smart aiming (second feature — separate spec)
- Iterative refinement for tight doglegs (manual drag handles the edge cases)
- Per-hole auto-compute batch button (do it hole by hole via the S badge)
