# Green Polygon Tracing — Design Spec

**Date:** 2026-05-27
**Status:** Approved

---

## Problem

GPS survey (±3–5 m) is too imprecise to reliably differentiate the green edge from the fringe. Esri World Imagery at zoom 19–20 renders satellite imagery at ~50 cm/pixel. Clicking the visible colour boundary between green and fringe on that imagery gives ~50 cm accuracy — an order of magnitude better than walking with GPS.

"Front of green" is not a fixed label. It depends on the player's approach direction. A player coming from the left of the fairway has a different front edge than one coming straight up the middle. The solution must compute front/back dynamically from the player's current position at runtime, not from a baked-in tee-bearing assumption.

---

## Solution

### 1. Polygon Tracing in Course Mapper

The user traces the green edge by clicking around the perimeter on the satellite imagery. The polygon is stored per hole. A step-through review UI lets the user inspect all 18 holes before pushing to Supabase.

### 2. New Supabase Table: `green_polygons`

```sql
CREATE TABLE public.green_polygons (
  hole        int PRIMARY KEY,    -- 1–18
  vertices    jsonb NOT NULL,     -- ordered array: [[lat,lng], [lat,lng], ...]
  recorded_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.green_polygons TO anon, authenticated;
```

Add to `supabase/grants.sql`.

One row per hole. Upsert on push replaces the entire polygon for that hole atomically.

### 3. Runtime Distance Computation (Main App)

Given the player's current lat/lng and the polygon vertices for the current hole:

- **Front** = vertex with minimum haversine distance to player
- **Back** = vertex with maximum haversine distance to player
- **Mid** = haversine midpoint of front and back coordinates

These three distances are shown when the player requests green distances during a GPS round.

**Fallback:** if no polygon exists for the hole, fall back to `survey_points` rows with `type` in `('front_green', 'mid_green', 'back_green')` — existing behaviour unchanged.

---

## Course Mapper Changes

### Tracing Mode

- The existing "Draw Green" polygon tool is the tracing mechanism — the user clicks around the green edge on the satellite imagery
- Vertex placement and editing already works via the Leaflet polygon draw layer
- The drawn polygon is saved to `localStorage` key `'rgcGreenPolygons'` as `{1: [[lat,lng],...], 2: [...], ...}` (already in place)
- No changes needed to the draw/click interaction itself

### Step-Through Review Panel

A new "Review & Push" section replaces or extends the existing push workflow. It contains:

1. **Hole selector bar** — 18 numbered cells showing status per hole:
   - `✓` green = polygon traced (has vertices in localStorage)
   - `—` grey = not yet traced
   - Clicking a cell navigates the map to that hole

2. **Map view** — the selected hole's polygon is rendered with:
   - Green fill at 30% opacity, green stroke
   - Blue dot = closest vertex to tee (sanity-check preview of "front from tee")
   - Red dot = furthest vertex from tee (sanity-check "back from tee")
   - White dot = midpoint of those two

3. **Navigation** — "← Prev" and "Next →" buttons cycle through holes

4. **Push button** — "Push All to Supabase" upserts all traced holes. Untouched holes are skipped. Shows per-hole success/failure feedback.

### Local Storage Schema

Existing key `'rgcGreenPolygons'` stores `{[hole]: [[lat,lng],...]}` — no change required. The review panel reads from this and the push writes from it.

---

## Main App Changes (`index.html`)

### Data Loading

On app init (alongside `players` and `allRounds`), fetch:

```js
greenPolygons = {};  // {hole: [[lat,lng],...]}

// in loadData():
const pgRows = await sbGet('green_polygons', '');
pgRows.forEach(r => { greenPolygons[r.hole] = r.vertices; });
```

### Green Distance Computation

New function `getGreenDistances(holePoly, playerLat, playerLng)`:

```
Input:  polygon vertex array [[lat,lng],...], player coords
Output: { front: {lat,lng,dist}, mid: {lat,lng,dist}, back: {lat,lng,dist} }
```

Algorithm:
1. Compute haversine distance from player to every vertex
2. Pick vertex with minimum distance → front
3. Pick vertex with maximum distance → back
4. Midpoint: lat = (front.lat + back.lat) / 2, lng = (front.lng + back.lng) / 2
5. Distances in metres

### GPS Round Integration

In the GPS round view, when displaying green distances for the current hole (`HE.currentHole` or `GR.currentHole`):

```js
if (greenPolygons[hole]) {
  const g = getGreenDistances(greenPolygons[hole], GR.currentLat, GR.currentLng);
  // display g.front.dist, g.mid.dist, g.back.dist
} else {
  // fall back to survey_points front_green / mid_green / back_green
}
```

The display shows three labelled distances: **Front**, **Mid**, **Back** — always computed from the player's current live position as `GR.currentLat`/`GR.currentLng` update.

---

## Files Changed

| File | Change |
|---|---|
| `course-mapper.html` | Add step-through review panel + push to `green_polygons` |
| `index.html` | Load `green_polygons` on init; `getGreenDistances()`; GPS round green display |
| `supabase/grants.sql` | Add `green_polygons` grant |

No new files. No build step. No new dependencies.

---

## Out of Scope

- Editing individual vertices after polygon is drawn (use Clear + redraw)
- Per-hole polygon versioning / history
- Automatic polygon detection from imagery (manual click-tracing only)
- Showing green polygon outline in the main app map view (distance numbers only)
