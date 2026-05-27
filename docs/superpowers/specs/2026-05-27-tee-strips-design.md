# Tee Strip Recording Design Spec

**Date:** 2026-05-27  
**Status:** Approved

---

## Problem

Each golf hole has multiple physical tee strips at different distances from the green. The club moves tee markers between strips (and within a strip) between rounds. The app currently stores a single hardcoded lat/lng per hole (`HOLE_TEES`) with no Supabase backing and no front/back extent. This prevents accurate distance-to-tee calculations and future stats about tee position within a strip.

---

## Solution

Record each tee strip as two GPS points — back edge (furthest from hole) and front edge (closest to hole). Store per hole in a new Supabase table. Recorded via the course mapper with a guided point-placement UI. Future: round entry will ask which third of the strip the tee marker was on.

---

## Data Model

### Supabase table: `tee_strips`

```sql
create table tee_strips (
  hole       integer not null,
  strip_num  integer not null,  -- 1 = furthest from green, 2, 3...
  back_lat   numeric not null,
  back_lng   numeric not null,
  front_lat  numeric not null,
  front_lng  numeric not null,
  recorded_at timestamptz default now(),
  primary key (hole, strip_num)
);

alter table tee_strips enable row level security;
create policy "public read" on tee_strips for select using (true);
create policy "public write" on tee_strips for insert with check (true);
create policy "public update" on tee_strips for update using (true);
create policy "public delete" on tee_strips for delete using (true);
```

### localStorage key: `rgcTeeStrips`

Format: `{ [hole]: [ {back:[lat,lng], front:[lat,lng]}, ... ] }`  
Index in array = strip_num - 1 (0-based). Strips ordered furthest to closest.

---

## Recording UI — course-mapper.html

### Sidebar indicator

The existing `T` indicator for each hole is replaced with a count badge:
- **Unset:** `T` (grey, same as now)
- **Set:** `T2`, `T3` etc. (blue, showing strip count)
- Clicking opens tee strip recording mode for that hole.

### Draw bar states

**State: `tee-placing-back`** (default when entering mode)
```
[ ● Back ]  [ ○ Front ]  [ ✓ Finish ]  [ 🗑 Clear ]  [ ✕ Cancel ]
```
— Back button is active (blue highlight). Clicking map places back edge point.

**State: `tee-placing-front`** (auto-swivel after back placed)
```
[ ○ Back ]  [ ● Front ]  [ ✓ Finish ]  [ 🗑 Clear ]  [ ✕ Cancel ]
```
— Front button is active. Clicking map places front edge point.

**Swivel behaviour:**
- After placing back point → auto-swivels to front state.
- After placing front point → strip is completed (both points saved to `teeInProgress`), auto-swivels back to back state for next strip.
- Tapping Back or Front button explicitly switches active state at any time.

### Map rendering during recording

- **Back point:** Red circle marker (10px, draggable).
- **Front point:** Yellow circle marker (10px, draggable).
- **Completed strip:** Thin line between back and front markers, labelled with strip number.
- **In-progress strip:** Single marker only (whichever point was placed first).
- Clicking a completed strip line or either of its markers deletes that strip immediately (no confirmation — Clear All handles bulk removal).

### Corrections

- Drag either marker of a completed strip to reposition it. Strip data updates live.
- Click a strip's line or marker to delete that strip. Remaining strips are renumbered from 1.
- Clear All button removes all strips for the current hole.

### Save

**Finish** saves all completed strips for the current hole:
1. Writes to `rgcTeeStrips` localStorage.
2. Immediately upserts each strip to Supabase `tee_strips` (no separate push step).
3. Strips with only one point placed (incomplete) are discarded on Finish.
4. Exits recording mode, sidebar T indicator updates.

---

## Functions — course-mapper.html

### New state variables
```javascript
let teeStrips = JSON.parse(localStorage.getItem('rgcTeeStrips') || '{}');
// { [hole]: [{back:[lat,lng], front:[lat,lng]}, ...] }

let teeDrawHole     = null;   // hole currently being recorded
let teeDrawState    = null;   // 'back' | 'front' | null
let teeInProgress   = [];     // completed strips for current hole (working copy)
let teePartialBack  = null;   // [lat,lng] of placed back point awaiting front
let teeStripMarkers = [];     // Leaflet markers on map
let teeStripLines   = [];     // Leaflet polylines on map
```

### New functions
- `startDrawTee(hole)` — enters tee strip recording mode; loads existing strips for hole.
- `setTeeDrawState(state)` — switches active point ('back'|'front'), updates bar.
- `handleTeeClick(lat, lng)` — called on map click in tee mode; places back or front point.
- `completeTeeStrip()` — called when both points placed; adds to `teeInProgress`, renumbers, redraws.
- `deleteTeeStrip(idx)` — removes strip at index, renumbers, redraws.
- `finishDrawTee()` — saves `teeInProgress` to localStorage and Supabase, exits mode.
- `cancelDrawTee()` — exits without saving.
- `clearTeeStrips()` — clears all strips for current hole, stays in mode.
- `sbUpsertTeeStrips(hole, strips)` — POSTs all strips for a hole to Supabase (delete-then-insert pattern, since strip_num may change after deletions).
- `redrawTeeMarkers()` — clears and redraws all tee markers and lines for current session.

### Modified functions
- `map.on('click')` — routes to `handleTeeClick` when `teeDrawHole !== null`.
- `renderHoleList()` — T indicator updated to show strip count.
- `saveAll()` — also saves `rgcTeeStrips` to localStorage.

---

## Supabase upsert strategy

Since strip_num can change when a strip is deleted (renumbering), use delete-then-insert per hole:
```
DELETE from tee_strips where hole = ?
INSERT into tee_strips (hole, strip_num, back_lat, back_lng, front_lat, front_lng) values ...
```
This avoids stale strip_num entries.

---

## Purge

Clear all existing tee strip data:
1. Delete all rows from `tee_strips` in Supabase (`hole=gte.1` filter).
2. Remove `rgcTeeStrips` from localStorage.
3. The old `HOLE_TEES` hardcoded array is left in place — it is still used as a fallback fly-to reference and is not removed.

---

## Out of Scope

- Recording which third of a strip the daily tee marker is on (future round-entry feature).
- Labelling strips by tee colour or name.
- Showing tee strips in the Saturday app `index.html` (next phase).
- Editing strip order after recording.
