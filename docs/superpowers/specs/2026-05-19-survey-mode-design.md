# Survey Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an on-course GPS survey panel to course-mapper.html so a player can record fixed course features (tee boxes, fairway extents, green front/back, distance markers, hazard edges) hole by hole, storing the data in localStorage for use by distance-to-green calculations and overlay calibration.

**Architecture:** A floating panel overlaid on the existing Leaflet map, opened via a topbar button. All data written to `localStorage['rgcSurveyPoints']` as a flat array of typed GPS points. No new files — everything added to the single `course-mapper.html`.

**Tech Stack:** Vanilla JS, Leaflet.js, `navigator.geolocation`, localStorage. GitHub Pages (no server).

---

## Data model

Each recorded point:
```js
{
  id:        string,   // crypto.randomUUID()
  hole:      number,   // 1–18
  type:      string,   // see Feature types below
  lat:       number,
  lng:       number,
  accuracy:  number,   // metres, from GeolocationCoordinates.accuracy
  timestamp: string,   // ISO 8601
}
```

localStorage key: `rgcSurveyPoints` — JSON array of the above objects.

**Feature types** (value used as `type` field):
- `tee` — back edge of a tee box (multi-instance per hole)
- `fairway_start` — start of fairway (single per hole)
- `fairway_end` — end of fairway / lay-up zone (single per hole)
- `bunker` — near edge of a bunker, fairway side (multi-instance per hole)
- `water` — near edge of water hazard (multi-instance per hole)
- `front_green` — front edge of green on approach axis (single per hole)
- `back_green` — back edge of green (single per hole)
- `dist_200` — 200m marker (single per hole)
- `dist_150` — 150m marker (single per hole)
- `dist_100` — 100m marker (single per hole)

**Multi-instance types:** `tee`, `bunker`, `water` — each Record tap appends a new point.  
**Single-instance types:** all others — recording replaces any existing point of that type for that hole.

---

## UI components

### Topbar button
New button `📍 Survey` in the existing topbar (after the 🏌️ Hazards button). Toggles the survey panel open/closed. When panel is open, button shows active style.

### Survey panel (`#surveyPanel`)
Fixed overlay, centered horizontally, top-aligned with some margin. Same dark theme as `#overlayBar`. Contains:

1. **Header row** — "📍 Survey Mode" title, live GPS accuracy badge (green ≤3m, orange >3m), close ✕ button.

2. **Hole selector** — 18 small buttons (1–18) in a wrap row. Selected hole highlighted red. Holes that have any recorded points show a small green dot indicator.

3. **Feature grid** — 10 buttons in a 3-column grid. Each shows an icon + label. Selected feature highlighted blue. Single-instance features that already have a recorded point for the current hole show a green ✓ tint.

4. **Instruction note** — shown only for multi-instance features (tee, bunker, water). One line of text explaining "tap Record for each one".

5. **GPS readout row** — live `lat, lng` in monospace + accuracy badge.

6. **Action row** — `↻ Refresh GPS` button (re-fetches position) + `✓ Record` button (saves point).

7. **Recorded list** — header "Recorded — Hole N · X points", then one row per point for the current hole: coloured dot by type, feature label (with index for multi-instance, e.g. "Tee #2"), accuracy, delete ✕ button.

### Panel state
```js
let surveyPanelOpen  = false;
let surveyHole       = 1;           // currently selected hole
let surveyFeature    = 'front_green'; // currently selected feature type
let surveyGpsPos     = null;        // last fetched GeolocationPosition
let surveyPoints     = JSON.parse(localStorage.getItem('rgcSurveyPoints') || '[]');
```

---

## Behaviour

### Opening the panel
`toggleSurveyPanel()` — flips `surveyPanelOpen`, shows/hides `#surveyPanel`, calls `renderSurveyPanel()`.

### GPS fetch
On panel open, immediately call `navigator.geolocation.getCurrentPosition(...)` with `{ enableHighAccuracy: true, timeout: 10000 }`. Update `surveyGpsPos` and re-render the GPS readout. `↻ Refresh GPS` button re-calls the same. Show "Fetching…" while waiting.

### Recording a point
`recordSurveyPoint()`:
1. Guard: `surveyGpsPos` must be non-null. If null, flash "Fetch GPS first".
2. For single-instance types: remove any existing point with same `hole` + `type` before inserting.
3. Push new point object (with `crypto.randomUUID()`) onto `surveyPoints`.
4. Persist: `localStorage.setItem('rgcSurveyPoints', JSON.stringify(surveyPoints))`.
5. Re-render panel (updates ✓ indicators and recorded list).
6. Flash the Record button green briefly ("✓ Saved").

### Deleting a point
`deleteSurveyPoint(id)` — filter `surveyPoints` by id, persist, re-render.

### Render
`renderSurveyPanel()` — full re-render of panel contents from state. Called after every state change.

---

## Feature config table
Used to drive the grid render and recording logic — no duplicated conditionals.

```js
const SURVEY_FEATURES = [
  { type: 'tee',          label: 'Tee',           icon: '🏌️', multi: true  },
  { type: 'fairway_start',label: 'Fairway start',  icon: '🌿', multi: false },
  { type: 'fairway_end',  label: 'Fairway end',    icon: '🌾', multi: false },
  { type: 'bunker',       label: 'Bunker',         icon: '🟡', multi: true  },
  { type: 'water',        label: 'Water',          icon: '💧', multi: true  },
  { type: 'front_green',  label: 'Front green',    icon: '⛳', multi: false },
  { type: 'back_green',   label: 'Back green',     icon: '🏁', multi: false },
  { type: 'dist_200',     label: '200m',           icon: '📏', multi: false },
  { type: 'dist_150',     label: '150m',           icon: '📏', multi: false },
  { type: 'dist_100',     label: '100m',           icon: '📏', multi: false },
];
```

---

## Dot colours for recorded list
```js
const SURVEY_COLORS = {
  tee:          '#2196F3',
  fairway_start:'#27ae60',
  fairway_end:  '#f39c12',
  bunker:       '#d4a843',
  water:        '#3498db',
  front_green:  '#1abc9c',
  back_green:   '#e74c3c',
  dist_200:     '#9b59b6',
  dist_150:     '#9b59b6',
  dist_100:     '#9b59b6',
};
```

---

## Copy/export
A `📋 Copy Survey Data` button lives inside the survey panel footer (not the topbar — topbar is already crowded). Copies the full `surveyPoints` JSON array to clipboard using the same flash animation pattern as `copyOverlaySettings()`.

---

## Out of scope
- Tee proximity matching at round-start (separate feature, uses this data)
- Uploading survey points to Supabase (localStorage only for now)
- Middle-of-green point (front + back is sufficient to derive centre)
- Map visualisation of survey points (data capture only)
