# Green Auto-Detection Design Spec

**Date:** 2026-05-27  
**Status:** Approved

---

## Problem

The existing green polygon tool requires clicking around the perimeter vertex-by-vertex. At zoom 19–20 (~50cm/pixel) the green/fringe boundary is clearly visible as a colour change (different grass height = different reflectance), but tracing it manually is slow and imprecise. A single seed click should be enough to auto-detect the boundary.

---

## Solution

Replace the manual vertex-by-vertex draw mode with a seed-point flood-fill detector. The user clicks once on the green surface; the app fetches the satellite tile, runs a colour flood-fill from the click pixel, traces and simplifies the boundary into a polygon, and presents it for approval. Two correction tiers are available before accepting: tolerance slider (re-detect) then vertex nudge (drag handles).

---

## Detection Algorithm

### Trigger
User clicks the map while in "detect green" mode for a specific hole. The click provides a lat/lng seed point.

### Step 1 — Tile fetch
Convert seed lat/lng to Esri tile coordinates at zoom 20:
```
n = 2^zoom
tileX = floor((lng + 180) / 360 * n)
tileY = floor((1 - ln(tan(lat*π/180) + sec(lat*π/180)) / π) / 2 * n)
```
Fetch up to 4 tiles (the seed tile plus its right, bottom, and bottom-right neighbours) as images using `crossOrigin="anonymous"`. Esri World Imagery tiles respond with `Access-Control-Allow-Origin: *`. Cache the fetched tiles for the duration of the detection session so slider adjustments don't re-fetch.

Tile URL pattern: `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/20/{tileY}/{tileX}`

### Step 2 — Seed pixel colour
Draw the relevant tile(s) to an offscreen `<canvas>`. Convert the seed lat/lng to pixel coordinates within the composite canvas. Read the RGB value at that pixel — this is the reference colour `C₀`.

### Step 3 — Flood-fill
BFS from the seed pixel. Include a neighbour pixel if:
```
√((r-r₀)² + (g-g₀)² + (b-b₀)²) ≤ T
```
where `T` is the tolerance (default 30, range 10–80, controlled by the slider).

Cap the fill at 200×200 pixels to prevent runaway fills on unusual imagery. If the fill hits the cap, treat it as a failed detection (show error, prompt re-click).

### Step 4 — Boundary trace
Walk the outer edge of the filled pixel set using a Moore neighbourhood contour tracing algorithm. Produces an ordered list of boundary pixels.

### Step 5 — Simplify
Run Ramer-Douglas-Peucker on the boundary pixel list with epsilon = 3 pixels. Target: 15–60 vertices. If the result has fewer than 6 vertices, the detection is considered failed (degenerate shape).

### Step 6 — Pixel to lat/lng
Convert each simplified vertex from pixel coordinates back to lat/lng using the known geographic bounds of the tile at zoom 20. Each tile covers exactly `360 / 2^20` degrees longitude and a corresponding latitude span derived from the Mercator projection.

---

## Correction Tiers

### Tier 1 — Tolerance slider
Slider range 10–80, default 30. Label: "Tight ◄────► Loose". On drag: re-run steps 3–6 using the cached tile canvas (no re-fetch). Polygon redraws live. Fast enough to feel immediate.

### Tier 2 — Vertex nudge
After detection (or after slider adjustment), the simplified polygon vertices are rendered as draggable yellow `circleMarker` handles — reusing the existing `_addVertMarker` / `drawVertMarkers` infrastructure. Dragging a handle updates `drawVerts` and redraws the preview polygon. Click a handle to delete it. This is the same UX as the current manual draw mode, just entered automatically after detection rather than by the user placing each point.

---

## Draw Bar States

The existing `#drawBar` element is repurposed. Three states:

**State: awaiting-seed**
```
[ 🎯 Click on the green to detect its boundary ]  [ ✕ Cancel ]
```

**State: detected**
```
[ Tight ◄──●────► Loose ]  [ ✓ Accept ]  [ ↩ Re-click ]
```
"Re-click" clears the polygon and returns to awaiting-seed state.

**State: vertex-edit** (after dragging any handle)
```
[ N vertices ]  [ ✓ Finish ]  [ 🗑 Clear ]
```
Same as current draw bar. "Finish" calls the existing `finishDrawGreen()` path.

---

## Integration Points

### `startDrawGreen(hole)` — modified
Currently enters manual vertex mode immediately. New behaviour:
1. Fly to the green (unchanged)
2. Set `drawBar` to awaiting-seed state
3. Set a flag `detectMode = true`
4. Map click handler routes to `handleDetectClick(lat, lng)` instead of `addDrawVertex(lat, lng)`

### `handleDetectClick(lat, lng)` — new function
Runs the full detection pipeline (steps 1–6). On success: populates `drawVerts` with simplified vertices, renders vertex markers, shows detected bar state. On failure (cap hit or degenerate): shows inline error message in the bar, stays in awaiting-seed state.

### `setDetectTolerance(T)` — new function
Called on slider input. Re-runs steps 3–6 using cached canvas. Updates `drawVerts` and vertex markers.

### `finishDrawGreen()` — unchanged
Saves `drawVerts` to `greenPolygons[hole]` and localStorage. Called by "Accept" (in detected state) and "Finish" (in vertex-edit state).

### Manual draw path (`addDrawVertex`) — kept, demoted
Still called when the user drags or repositions a vertex handle. Not the primary entry point any more.

---

## Error Handling

| Condition | Behaviour |
|---|---|
| CORS blocked (tile fetch fails) | Show "Could not load imagery — try zooming in and clicking again" in draw bar |
| Fill hits 200×200 pixel cap | Show "Detected region too large — click closer to the centre of the green" |
| Fewer than 6 vertices after simplify | Show "Detection unclear — try a different spot or adjust the slider" |
| Click outside any tile | No-op (shouldn't happen at zoom 19–20 over the course) |

---

## Files Changed

| File | Change |
|---|---|
| `course-mapper.html` | Modify `startDrawGreen`, add `handleDetectClick`, `setDetectTolerance`; update draw bar HTML/states; add offscreen canvas + flood-fill + boundary trace + RDP simplify functions |

No other files change. No new Supabase tables. No changes to `index.html` or `grants.sql`. The `green_polygons` localStorage format and the Review & Push panel are unchanged.

---

## Out of Scope

- Automatic multi-hole batch detection
- Undo/redo history within a session
- Detection on imagery other than Esri World Imagery zoom 20
- Showing the flood-fill region itself (only the traced boundary polygon is shown)
- Vertex insertion (add a new point between two existing ones)
