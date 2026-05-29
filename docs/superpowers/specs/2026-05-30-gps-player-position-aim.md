# GPS Player Position & Aim Direction Design Spec

**Date:** 2026-05-30
**Status:** Approved

---

## Problem

1. There is no persistent "you are here" marker on the GPS tracker map. A player dot only appears while distance rings are active (`drawDistRings()`), and vanishes when rings are off.

2. The distance ring cone and fairway arc always aim at the green. The player cannot pan the map to aim at a different target (e.g. a gap in the trees, a layup zone) and see ring distances in that direction.

---

## Solution

### 1. Persistent player dot

A blue `L.circleMarker` stored as `GR.playerDot`. Created on the first GPS fix, updated on every subsequent fix via `.setLatLng()`. Always visible while GPS is active — independent of rings mode.

**Style:** radius 7, white border (weight 2), blue fill (`#4A90E2`), fillOpacity 0.9. `zIndexOffset: 500` so it sits above ring arcs.

**Lifecycle:**
- Created in `watchPosition` callback on first fix (`GR.playerDot === null`)
- Updated with `.setLatLng()` on all subsequent fixes
- Removed in GPS stop/cleanup path

### 2. Aim bearing from map centre

In `drawDistRings()`, replace the fixed green bearing (`greenBrg`) with an aim bearing derived from the current map centre:

```javascript
const mc = GR.map.getCenter();
const aimBrg = bearingDeg(GR.currentLat, GR.currentLng, mc.lat, mc.lng);
```

`aimBrg` replaces `greenBrg` everywhere it was used for direction:
- The ±90° forward-facing filter inside `ringFairwayIntersections()`
- The fallback ±15° fixed arc/cone direction
- The bright fairway arc span direction

The green distance pin continues to render at the green centroid with its computed distance — it is not affected by aim direction.

### 3. Redraw rings on map pan

When rings are toggled **on** (`toggleDistRings()`), attach a move listener:

```javascript
GR._aimMoveHandler = () => drawDistRings();
GR.map.on('move', GR._aimMoveHandler);
```

When rings are toggled **off**, detach:

```javascript
if (GR._aimMoveHandler) {
  GR.map.off('move', GR._aimMoveHandler);
  GR._aimMoveHandler = null;
}
```

The rings redraw on every `move` event (fires continuously while panning). The cone swings in real-time to follow the map centre.

### 4. Re-centre button (📍)

A small button added to the GPS tracker toolbar/UI. On tap:

```javascript
GR.map.setView([GR.currentLat, GR.currentLng]);
```

Snaps the map back so the player is at the centre. Useful after panning far away to aim and wanting to reset to the player's position.

---

## Fallback

If `GR.currentLat` and `GR.currentLng` equal the map centre (player is exactly at map centre), `aimBrg` is undefined (bearingDeg of zero distance). In this case fall back to bearing from player to green centroid — same as current behaviour.

---

## Functions Modified

| Function | Change |
|---|---|
| `watchPosition` callback | Create `GR.playerDot` on first fix; update `.setLatLng()` on all fixes |
| `drawDistRings()` | Compute `aimBrg` from map centre; pass to fairway intersections and arc/cone |
| `toggleDistRings()` | Attach `GR.map.on('move', ...)` when enabling; detach when disabling |
| GPS tracker HTML | Add 📍 re-centre button |

## New GR Properties

| Property | Type | Description |
|---|---|---|
| `GR.playerDot` | `L.circleMarker \| null` | Persistent player position marker |
| `GR._aimMoveHandler` | `function \| null` | Map move listener; null when rings off |

---

## Out of Scope

- Map rotation (Approach B) — deferred
- Accuracy radius halo — deferred
- Compass/bearing indicator showing current aim angle — deferred
