# Auto-Compute Fairway Spine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auto-compute a fairway spine (centreline) from the recorded fairway polygon by sampling cross-section midpoints, so spine-edit mode shows a usable starting spine for every hole without manual recording.

**Architecture:** Three new functions — `dpSimplify2D`, `autoComputeSpine`, `resetSpineToAuto` — are added to `course-mapper.html`. `startSpineMode` calls `autoComputeSpine` when entering a hole with no saved spine. A new "↺ Auto" button in the spine draw bar lets the user re-run auto-compute at any time. No new files, no new Supabase tables.

**Tech Stack:** Vanilla JS, Leaflet.js. Single file: `course-mapper.html`.

---

## File Structure

**Modify only:** `course-mapper.html`

| Location | Change |
|---|---|
| After `arcToLatLngs` (~line 1713) | Add `dpSimplify2D` + `autoComputeSpine` |
| After `clearSpineWaypoints` (~line 2190) | Add `resetSpineToAuto` |
| `startSpineMode` (~line 2108) | Auto-fill waypoints when no saved spine |
| `setSpineDrawBar` (~line 1961) | Add "↺ Auto" button |

---

## Task 1: Add `dpSimplify2D` and `autoComputeSpine`

**Files:**
- Modify: `course-mapper.html` — insert after the closing `}` of `arcToLatLngs` (~line 1713, before `function redrawAllSpines`)

- [ ] **Step 1: Insert the three constants and two new functions**

Find this line in `course-mapper.html` (it's the line immediately after `arcToLatLngs` closes):
```javascript
function redrawAllSpines() {
```

Insert the following block immediately before it:

```javascript
// ── Auto-compute spine constants ─────────────────────────────────────────
const SPINE_STEP_M     = 15;   // cross-section sample interval (metres)
const SPINE_DP_EPS_M   = 4;    // Douglas-Peucker simplification threshold (metres)
const SPINE_MAX_HALF_W = 120;  // max perpendicular search distance (metres)

// Douglas-Peucker simplification for 2D points in local metres [[x,y], ...].
function dpSimplify2D(pts, eps) {
  if (pts.length < 3) return pts.slice();
  let maxD = 0, idx = 0;
  const [x1, y1] = pts[0], [x2, y2] = pts[pts.length - 1];
  const dx = x2 - x1, dy = y2 - y1, len = Math.sqrt(dx * dx + dy * dy);
  for (let i = 1; i < pts.length - 1; i++) {
    const d = len < 1e-9
      ? Math.hypot(pts[i][0] - x1, pts[i][1] - y1)
      : Math.abs(dy * pts[i][0] - dx * pts[i][1] + x2 * y1 - y2 * x1) / len;
    if (d > maxD) { maxD = d; idx = i; }
  }
  if (maxD <= eps) return [pts[0], pts[pts.length - 1]];
  return [
    ...dpSimplify2D(pts.slice(0, idx + 1), eps).slice(0, -1),
    ...dpSimplify2D(pts.slice(idx), eps)
  ];
}

// Auto-compute fairway spine waypoints from the fairway polygon(s) for a hole.
// Samples perpendicular cross-sections every SPINE_STEP_M metres along the
// tee→green axis, finds the left+right fairway boundary intersections,
// takes their midpoint, then Douglas-Peucker simplifies the result.
// Returns [[lat,lng], ...] waypoints (empty array = straight-line spine).
function autoComputeSpine(hole) {
  const tee   = HOLE_TEES[hole - 1];
  const green = greenCentroid(hole);
  const polys = fairwayPolygons[hole];
  if (!tee || !green || !polys || polys.length === 0) return [];

  const refLat = tee.lat, refLng = tee.lng;
  const LAT_M  = 111320;
  const LNG_M  = 111320 * Math.cos(refLat * Math.PI / 180);

  function toXY(lat, lng) { return [(lng - refLng) * LNG_M, (lat - refLat) * LAT_M]; }
  function toLL(x, y)     { return [refLat + y / LAT_M, refLng + x / LNG_M]; }

  const [tx, ty] = toXY(tee.lat, tee.lng);       // [0, 0] — origin is tee
  const [gx, gy] = toXY(green.lat, green.lng);
  const totalLen = Math.hypot(gx - tx, gy - ty);
  if (totalLen < 1) return [];

  const ux = (gx - tx) / totalLen, uy = (gy - ty) / totalLen; // unit along axis
  const px = -uy, py = ux;                                     // unit perpendicular (left)

  // Pre-convert all polygon vertices to local XY
  const allPolyVerts = polys.map(poly => poly.map(v => toXY(v[0], v[1])));

  const raw = []; // [[x, y], ...]

  for (let d = SPINE_STEP_M; d < totalLen - SPINE_STEP_M; d += SPINE_STEP_M) {
    const ax = tx + ux * d;
    const ay = ty + uy * d;
    const tHits = [];

    for (const polyVerts of allPolyVerts) {
      const n = polyVerts.length;
      for (let i = 0; i < n; i++) {
        const [e1x, e1y] = polyVerts[i];
        const [e2x, e2y] = polyVerts[(i + 1) % n];
        const edx = e2x - e1x, edy = e2y - e1y;
        const rx1 = e1x - ax,  ry1 = e1y - ay;
        const det = edx * py - edy * px;
        if (Math.abs(det) < 1e-10) continue; // edge parallel to perpendicular
        const t = (edx * ry1 - edy * rx1) / det;
        const s = (px  * ry1 - py  * rx1) / det;
        if (s >= 0 && s <= 1) tHits.push(t);
      }
    }

    if (tHits.length < 2) continue; // perpendicular misses the fairway here
    const tMin = Math.min(...tHits), tMax = Math.max(...tHits);
    if (tMax - tMin > SPINE_MAX_HALF_W * 2) continue; // unreasonably wide — skip
    const tMid = (tMin + tMax) / 2;
    raw.push([ax + tMid * px, ay + tMid * py]);
  }

  if (raw.length < 2) return [];
  const simplified = dpSimplify2D(raw, SPINE_DP_EPS_M);
  return simplified.map(([x, y]) => toLL(x, y));
}

```

- [ ] **Step 2: Verify the functions are callable in the browser console**

Open `course-mapper.html` in Chrome. Open DevTools → Console. Run:

```javascript
// Should return an array of [lat,lng] pairs (or [] for straight holes)
const wpts = autoComputeSpine(1);
console.log('Hole 1 waypoints:', wpts.length, wpts);
```

Expected: an array of lat/lng pairs. No errors. Exact count will vary (typically 2–8 for most holes).

Also test DP directly:
```javascript
// Collinear points → should simplify to just first and last
dpSimplify2D([[0,0],[1,0],[2,0],[3,0]], 0.1)
// Expected: [[0,0],[3,0]]

// Bent line → should keep the bend
dpSimplify2D([[0,0],[5,5],[10,0]], 1)
// Expected: [[0,0],[5,5],[10,0]]
```

- [ ] **Step 3: Visually verify hole 1 in the browser console**

```javascript
// Print human-readable waypoint count and first/last lat,lng
const w = autoComputeSpine(1);
console.log(`Hole 1: ${w.length} waypoints`);
if (w.length) {
  console.log('First:', w[0]);
  console.log('Last:', w[w.length-1]);
}
```

Expected: waypoints within the lat/lng bounds of hole 1 fairway (lat ~55.635–55.637, lng ~12.568–12.570).

- [ ] **Step 4: Commit**

```bash
git add course-mapper.html
git commit -m "feat: add dpSimplify2D + autoComputeSpine for polygon cross-section spine"
```

---

## Task 2: Wire auto-compute into `startSpineMode` + add `resetSpineToAuto`

**Files:**
- Modify: `course-mapper.html`
  - `startSpineMode` (~line 2108): add auto-fill after waypoints copy
  - After `clearSpineWaypoints` (~line 2190): add `resetSpineToAuto`

- [ ] **Step 1: Modify `startSpineMode` to auto-fill waypoints**

Find this exact block in `startSpineMode`:

```javascript
  drawingSpine   = hole;
  spineWaypoints = (fairwaySpines[hole] || []).map(v => [...v]); // working copy
```

Replace with:

```javascript
  drawingSpine   = hole;
  spineWaypoints = (fairwaySpines[hole] || []).map(v => [...v]); // working copy
  // Auto-compute spine from fairway polygon when no saved spine exists
  if (spineWaypoints.length === 0 && (fairwayPolygons[hole] || []).length > 0) {
    spineWaypoints = autoComputeSpine(hole);
  }
```

- [ ] **Step 2: Add `resetSpineToAuto` after `clearSpineWaypoints`**

Find this exact block:

```javascript
function clearSpineWaypoints() {
  spineWaypoints = [];
  redrawEditSpine();
  setSpineDrawBar();
}
```

Add immediately after it:

```javascript
function resetSpineToAuto() {
  spineWaypoints = autoComputeSpine(drawingSpine);
  redrawEditSpine();
  setSpineDrawBar();
}
```

- [ ] **Step 3: Verify in browser — click S badge for hole 1**

Open `course-mapper.html`. Click the **S** badge for hole 1 in the sidebar.

Expected:
- Map flies to hole 1
- A teal polyline appears on the map — NOT a straight line from tee to green, but a computed centreline following the fairway shape
- Draggable white waypoint dots appear on the spine
- Draw bar shows `Spine 1 — N waypoints` where N ≥ 1

If the spine looks like a straight line despite the fairway having bends, open the console and run `autoComputeSpine(1)` to check the raw output.

- [ ] **Step 4: Commit**

```bash
git add course-mapper.html
git commit -m "feat: auto-fill spine waypoints from polygon on startSpineMode"
```

---

## Task 3: Add "↺ Auto" button to the spine draw bar

**Files:**
- Modify: `course-mapper.html` — `setSpineDrawBar` (~line 1961)

- [ ] **Step 1: Update `setSpineDrawBar` to include "↺ Auto" button**

Find this exact function:

```javascript
function setSpineDrawBar() {
  const bar = document.getElementById('drawBar');
  const hole = drawingSpine;
  const n    = spineWaypoints.length;
  const btn  = s => `style="padding:5px 12px;border-radius:5px;border:none;font-size:12px;font-weight:700;cursor:pointer;${s}"`;
  const label = n === 0
    ? `<span style="color:#17a2b8;font-weight:600">Spine ${hole} — straight</span>`
    : `<span style="color:#17a2b8;font-weight:600">Spine ${hole} — ${n} waypoint${n !== 1 ? 's' : ''}</span>`;
  bar.innerHTML =
    label +
    `<button onclick="finishSpine()" ${btn('background:#2ecc71;color:#000')}>✓ Finish</button>` +
    `<button onclick="clearSpineWaypoints()" ${btn('background:#555;color:#eee')}>🗑 Clear</button>` +
    `<button onclick="cancelSpine()" ${btn('background:#e94560;color:#fff')}>✕ Cancel</button>`;
}
```

Replace with:

```javascript
function setSpineDrawBar() {
  const bar = document.getElementById('drawBar');
  const hole = drawingSpine;
  const n    = spineWaypoints.length;
  const hasPolygon = (fairwayPolygons[hole] || []).length > 0;
  const btn  = s => `style="padding:5px 12px;border-radius:5px;border:none;font-size:12px;font-weight:700;cursor:pointer;${s}"`;
  const label = n === 0
    ? `<span style="color:#17a2b8;font-weight:600">Spine ${hole} — straight</span>`
    : `<span style="color:#17a2b8;font-weight:600">Spine ${hole} — ${n} waypoint${n !== 1 ? 's' : ''}</span>`;
  bar.innerHTML =
    label +
    `<button onclick="finishSpine()" ${btn('background:#2ecc71;color:#000')}>✓ Finish</button>` +
    `<button onclick="clearSpineWaypoints()" ${btn('background:#555;color:#eee')}>🗑 Clear</button>` +
    (hasPolygon ? `<button onclick="resetSpineToAuto()" ${btn('background:#17a2b8;color:#000')}>↺ Auto</button>` : '') +
    `<button onclick="cancelSpine()" ${btn('background:#e94560;color:#fff')}>✕ Cancel</button>`;
}
```

- [ ] **Step 2: Verify "↺ Auto" button appears and works**

Open `course-mapper.html`. Click **S** badge for hole 1.

Expected:
- Draw bar shows: `Spine 1 — N waypoints  [✓ Finish] [🗑 Clear] [↺ Auto] [✕ Cancel]`
- Drag a few waypoints to move them off-centre
- Click **↺ Auto** — waypoints reset to the auto-computed positions, draw bar updates count

Also test on a hole with no fairway polygon (if any exist — unlikely since all 18 are recorded):
- Draw bar should show `[✓ Finish] [🗑 Clear] [✕ Cancel]` only (no Auto button)

- [ ] **Step 3: End-to-end test — save hole 1 spine**

1. Click **S** badge for hole 1 — auto-computed spine appears
2. Inspect the spine visually — does it follow the fairway centreline?
3. Drag any waypoints that look off
4. Click **✓ Finish**
5. Spine saves, S badge updates, teal line persists on map
6. Click **S** again — saved spine loads (NOT re-auto-computed, since a saved spine now exists)
7. Click **↺ Auto** — waypoints reset to the computed positions (overrides the saved spine visually, but doesn't save until ✓ Finish)

- [ ] **Step 4: Commit**

```bash
git add course-mapper.html
git commit -m "feat: add Auto button to spine draw bar for polygon-computed reset"
```
