# Fairway Polygon Recording Design Spec

**Date:** 2026-05-27  
**Status:** Approved

---

## Problem

Each golf hole has a fairway (sometimes split into two) that needs to be mapped as a polygon for future distance-to-surface calculations. The app currently has no fairway data. Green polygons are already recorded (one per hole), but fairways need to support multiple polygons per hole.

---

## Solution

Record fairway polygons using the same click-to-place-vertex mechanic as green polygons. Support multiple polygons per hole via a select mode: clicking the F indicator on a hole with existing polygons shows them as clickable editable sets; clicking an existing polygon edits it; clicking empty map adds a new one. Reuses the existing draw infrastructure (`drawVerts`, `drawVertMarkers`, `drawPolyLayer`, `_exitDrawMode`, `updateDrawBar`).

---

## Data Model

### Supabase table: `fairway_polygons`

```sql
create table fairway_polygons (
  hole        integer not null primary key,
  polygons    jsonb   not null,
  recorded_at timestamptz default now()
);

alter table fairway_polygons enable row level security;
create policy "public read"   on fairway_polygons for select using (true);
create policy "public write"  on fairway_polygons for insert with check (true);
create policy "public update" on fairway_polygons for update using (true);
create policy "public delete" on fairway_polygons for delete using (true);
```

`polygons` column format: `[ [[lat,lng],...], [[lat,lng],...] ]` — an array of vertex arrays, one entry per polygon. Holes with a split fairway have two entries; most holes have one.

Upsert strategy: merge-on-conflict on `hole` (same as `green_polygons`). Each save writes all polygons for the hole in one call.

### localStorage key: `rgcFairwayPolygons`

Format: `{ [hole]: [ [[lat,lng],...], [[lat,lng],...] ] }`  
Hole key is a string (JSON). Index in outer array = polygon index (0-based).

---

## State Variables

```javascript
let fairwayPolygons   = JSON.parse(localStorage.getItem('rgcFairwayPolygons') || '{}');
// { [hole]: [ [[lat,lng],...], ... ] }

let fairwayPolyLayers  = {};    // { [hole]: [L.polygon, ...] }
let drawingFairway     = null;  // hole number in vertex-edit mode, or null
let drawingFairwayIdx  = null;  // index of polygon being edited; null = new polygon
let fairwaySelectHole  = null;  // hole in select-mode (pick-a-polygon-to-edit), or null
```

`drawVerts`, `drawVertMarkers`, `drawPolyLayer`, and all existing draw-mode machinery are reused. The three draw modes (green, fairway vertex-edit, fairway select) are mutually exclusive — each entry point exits any active mode first.

---

## Recording UI — course-mapper.html

### Sidebar indicator

New **F** badge per hole in `renderHoleList`, after the ⬡ (green polygon) indicator:

- **Unset:** `F` (grey, `#2a2a3e`)
- **Set:** `F2`, `F3` etc. (amber `#f39c12`, showing polygon count)
- Clicking always calls `startFairwayMode(h)`

CSS: `.ind-fairway.set { background: #f39c12; color: #000; cursor: pointer; }` / `.ind-fairway.unset { background: #2a2a3e; color: #555; cursor: pointer; }`

A **✕F** clear button appears in the hole-row clears section when polygons exist, like ✕⬡ for greens. Clicking ✕F on a specific polygon is not in scope — individual polygon deletion is handled inside the draw/select session.

### Mode: Fairway select (`fairwaySelectHole !== null`)

Entered when clicking F indicator on a hole that already has polygons. All fairway polygons for the hole render as clickable (highlighted border, pointer cursor). Draw bar shows:

```
[ Click a polygon to edit — or click map to add new ]  [ ✕ Cancel ]
```

- Click an existing fairway polygon → exits select mode, enters vertex-edit mode for that polygon (vertices load as draggable dots)
- Click empty map → exits select mode, enters vertex-edit mode for new polygon (empty)
- ✕ Cancel → exits select mode, no changes

### Mode: Fairway vertex-edit (`drawingFairway !== null`)

Entered either directly (no existing polygons) or from select mode. Reuses the existing draw bar and vertex-placement mechanic identically to green polygon drawing:

- Click map → place vertex dot
- Drag vertex → reposition
- **✓ Finish** (≥ 3 pts) → sort vertices by centroid angle, save, exit
- **🗑 Clear** → clear all vertices for current polygon
- **✕ Delete polygon** (only when editing existing polygon, i.e. `drawingFairwayIdx !== null`) → removes this polygon from the hole's array, saves, exits
- **✕ Cancel** → exit without saving

The draw bar label shows `Fairway N — M pts` (vs `Hole N — M pts` for greens) so the user knows which mode they're in.

### Map rendering

- **Fairway polygons (saved):** Semi-transparent amber fill — `color: '#f39c12', fillColor: '#f39c12', fillOpacity: 0.15, weight: 2`
- **Green polygon** remains visible while drawing fairway (not hidden — serves as visual guide for where to end the fairway boundary)
- **During vertex-edit:** Existing fairway polygon for the hole being edited is hidden (like green polygon hides during green edit). Other holes' fairway polygons remain visible.

---

## Functions — course-mapper.html

### New state variables
Added after `let fairwayPolyLayers = {}` (after tee strip state vars):
```javascript
let fairwayPolygons   = JSON.parse(localStorage.getItem('rgcFairwayPolygons') || '{}');
let fairwayPolyLayers = {};
let drawingFairway    = null;
let drawingFairwayIdx = null;
let fairwaySelectHole = null;
```

### New functions

- `startFairwayMode(hole)` — entry point from F indicator; if no polygons exists goes to `startDrawFairway(hole, null)`, else calls `enterFairwaySelectMode(hole)`
- `enterFairwaySelectMode(hole)` — sets `fairwaySelectHole`, renders clickable fairway layers for hole with `L.DomEvent.stop(e)` in click handlers (prevents map click also firing), shows select bar
- `_exitFairwaySelectMode()` — removes select-mode click handlers, resets `fairwaySelectHole`, hides draw bar
- `startDrawFairway(hole, idx)` — exits any active mode; sets `drawingFairway`/`drawingFairwayIdx`; hides fairway layers for hole; loads vertices if `idx !== null`; shows draw bar; flies to bounds or HOLE_TEES fallback
- `finishDrawFairway()` — sorts vertices by centroid angle; saves to `fairwayPolygons[hole]` at `idx` (or appends if null); calls `saveAll()` + `sbUpsertFairwayPolygons()`; exits draw mode; redraws; updates sidebar
- `deleteFairwayPolygon(hole, idx)` — removes polygon at index from `fairwayPolygons[hole]`; calls `saveAll()` + `sbUpsertFairwayPolygons()`; exits draw mode; redraws sidebar
- `clearFairwayPolygonsForHole(hole)` — deletes all polygons for hole from state + Supabase; updates sidebar
- `sbUpsertFairwayPolygons(hole, polygons)` — POSTs to `/rest/v1/fairway_polygons` with `Prefer: resolution=merge-duplicates,return=minimal`
- `redrawAllFairwayPolygons()` — clears `fairwayPolyLayers`, re-renders all fairway polygons from `fairwayPolygons` state

### Modified functions

- `saveAll()` — adds `localStorage.setItem('rgcFairwayPolygons', JSON.stringify(fairwayPolygons))`
- `map.on('click')` — adds `fairwaySelectHole !== null` routing (start new polygon) above the existing `teeDrawHole` and `drawingGreen` checks
- `renderHoleList()` — adds F indicator and ✕F clear button per hole
- `_exitDrawMode()` — also resets `drawingFairway` and `drawingFairwayIdx`
- `startDrawGreen(hole)` — adds `if (fairwaySelectHole !== null) _exitFairwaySelectMode()` and `if (drawingFairway !== null) _exitDrawMode()` guards at top
- `startDrawTee(hole)` — adds same fairway mode exit guards
- `updateDrawBar()` — updated label: shows `Fairway N — M pts` when `drawingFairway !== null`

---

## Supabase upsert strategy

Single merge-on-conflict upsert per hole (same as `green_polygons`):

```
POST /rest/v1/fairway_polygons
Prefer: resolution=merge-duplicates,return=minimal
Body: { hole, polygons: [[[lat,lng],...], ...] }
```

This overwrites all polygons for the hole in one call. No delete-then-insert needed since the entire `polygons` array is stored as one JSONB column.

---

## Out of Scope

- Distance-to-fairway calculations (future phase — to be designed once polygons are recorded)
- Auto-detect for fairway polygons (manual placement only)
- Per-polygon metadata (name, colour, notes)
- Showing fairway polygons in `index.html` scoring app (next phase)
