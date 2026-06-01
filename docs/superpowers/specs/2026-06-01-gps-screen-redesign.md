# GPS Screen Redesign Design Spec

**Date:** 2026-06-01
**Status:** Approved

---

## Problem

The GPS shot tracking screen is overwhelming during a round. It shows the map, shot action buttons, metadata entry (lie/club/weight/result), rings controls, and a footer all at once. Drop/Replay/Provisional clutter the main action area. There is no way to use GPS distances without recording shots, and no way to reduce the amount of data captured per shot.

---

## Solution

Four tracking modes selectable per player (with per-round override). A collapsed map by default. Shot type (Normal/Drop/Replay/Provisional) moved from the action screen into the confirm panel. Front/middle/back green distances in the header.

---

## Tracking Modes

| Key | Label | Shot entry? | Club? | Lie / weight / result? |
|---|---|---|---|---|
| `'gps'` | GPS only | ✗ | ✗ | ✗ |
| `'shots'` | Shots only | ✓ minimal | ✗ | ✗ |
| `'clubs'` | Shots + clubs | ✓ + club | ✓ | ✗ |
| `'full'` | Full detail | ✓ full | ✓ | ✓ |

### Descriptions (shown at round setup and in My Rounds preference)

- **GPS only** — Map, distances and rings. No shots recorded — use this when you just want live yardages.
- **Shots only** — Records each shot's GPS position and count. One confirm tap per shot, nothing else.
- **Shots + clubs** — Adds club selection to each shot. Good for tracking what you're hitting without the full detail.
- **Full detail** — Records lie, club, shot weight and result. Full shot analysis after the round.

---

## Screen Layout

### Normal shot modes (`'shots'`, `'clubs'`, `'full'`)

```
┌─────────────────────────────────────────┐
│ Hole 4  Par 4 · SI 12 · Shot 2          │
│ 135 · 142 · 149m ⛳          ⛳ Chip & Putt → │
├─────────────────────────────────────────┤
│  [         🎯  Hit         ]            │
│  [📍 Rings]  [⛳ Green]  [🗺 Map]       │
├─────────────────────────────────────────┤
│  (rings control bar — when rings active)│
├─────────────────────────────────────────┤
│  (map — collapsed by default)           │
├─────────────────────────────────────────┤
│  [Abandon]              [Finish Round]  │
└─────────────────────────────────────────┘
```

- Drop / Replay / Provisional removed from action screen — moved into confirm panel
- `GR.mapOpen` (boolean, default `false`) controls map visibility
- Map starts open in `'gps'` mode

### GPS only mode (`'gps'`)

```
┌─────────────────────────────────────────┐
│ Hole 4  Par 4 · SI 12                   │
│ 135 · 142 · 149m ⛳          End Hole → │
├─────────────────────────────────────────┤
│  [📍 Rings]  [⛳ Green]                 │
├─────────────────────────────────────────┤
│  (rings control bar — when rings active)│
├─────────────────────────────────────────┤
│  (map — open by default)                │
├─────────────────────────────────────────┤
│  [Abandon]              [Finish Round]  │
└─────────────────────────────────────────┘
```

- No Hit button, no shot count, no pending shot state
- End Hole → goes directly to `confirmEndHole()` (no shot data collected)
- Chip & Putt button not shown (no shot tracking)
- Map open by default

---

## Header: Front / Middle / Back Distances

Replace `distToGreen()` single distance with three distances from `getGreenDistances()`:

```javascript
// Header sub-line:
"135 · 142 · 149m ⛳"   // front · mid · back
```

- Uses `getGreenDistances(greenPolygons[hole], playerLat, playerLng)` which returns `{front, mid, back}` in metres
- Respects `getUnits()` (yards if `isYd`)
- Falls back to single `distToGreen()` value if no green polygon exists for the hole
- The `<span id="gpsDist">` element is updated live on each GPS fix (same as current)

---

## Confirm Panel

Shown after tapping 🎯 Hit (for all shot-tracking modes). Never shown in `'gps'` mode.

```
Shot kind (always):
  [ Normal         ]  [ Drop           ]  [ Replay         ]  [ Provisional    ]
  [ Standard shot  ]  [ Penalty / OOB  ]  [ Same spot,     ]  [ Ball may be    ]
                      [ / water        ]  [ hit again      ]  [ lost           ]

Club (modes: clubs, full):
  [ Driver ]  [ 3W ]  [ 5i ] …  (from player's bag)

Lie (mode: full only):
  [ Tee        ]  [ Fairway     ]  [ Rough       ]  [ Sand        ]  [ Fringe      ]
  [ Tee box    ]  [ Short grass ]  [ Long grass  ]  [ Bunker      ]  [ Collar      ]

Weight (mode: full only):
  [ Full       ]  [ 3/4        ]  [ Punch       ]  [ Pitch       ]  [ Chip        ]  [ Putt       ]
  [ Max dist   ]  [ Control    ]  [ Low flight  ]  [ Short carry ]  [ Bump & run  ]  [ On green   ]

Direction + outcome (mode: full only):
  [ Left  ]  [ Straight ]  [ Right  ]
  [ ⚠ Lost ]  [ ⛳ Green ]

[ Cancel ]                              [ Save Shot → ]
```

### Shot kind selection

- Default: `Normal`
- Tapping 🎯 Hit always calls `recordShot('normal')`, which opens the confirm panel with `Normal` pre-selected
- Tapping a shot kind button in the panel sets `GR.pendingShot.type` to that value and re-renders the row
- "Save Shot →" commits the shot using `GR.pendingShot.type` (whatever is currently selected)
- Provisional logic (provisional resolution buttons on next shot) unchanged — triggered by `type === 'provisional'`
- The separate Drop / Replay / Provisional buttons that previously called `recordShot(type)` directly are removed

---

## Player Preference

- Stored in `localStorage` key `sl_gps_detail_<playerId>`
- Default: `'full'`
- Read via `getGpsDetailMode(playerId)` helper
- Set via `setGpsDetailMode(playerId, mode)` helper

### My Rounds screen

Add a **GPS tracking** row below the HCP section. Shows the current preference as a selected chip. Tapping expands an inline selector directly in the card, showing the four options and their descriptions. Selecting an option saves immediately to `localStorage` and collapses the selector.

---

## Round Setup Override

The GPS round start screen (date / tee / starting hole pickers) gains a **Tracking** row:

- Four option cards, one per mode
- Each card: bold label + description (from the Descriptions table above)
- Default = `getGpsDetailMode(activeId)`
- Selected mode stored in `GR.detailMode` at round start
- No mid-round mode switching

---

## GR State Changes

| Property | Type | Description |
|---|---|---|
| `GR.mapOpen` | boolean | Whether the map panel is expanded. Default `false` except `'gps'` mode (default `true`). |
| `GR.detailMode` | string | `'gps'` \| `'shots'` \| `'clubs'` \| `'full'`. Set at round start, locked for round. |

---

## Functions Modified

| Function | Change |
|---|---|
| `renderGpsHole()` | Full restructure: action screen uses `GR.detailMode`; map section toggleable via `GR.mapOpen`; header shows front/mid/back distances |
| `recordShot(type)` | Always called with `'normal'`; type row in confirm panel handles Drop/Replay/Provisional |
| `initGpsRound()` / GPS setup HTML | Add tracking mode selector |
| `startGpsWatch()` callback | Update `gpsDist` span to show three distances |

## New Functions

| Function | Description |
|---|---|
| `getGpsDetailMode(playerId)` | Returns `localStorage.getItem('sl_gps_detail_'+playerId) \|\| 'full'` |
| `setGpsDetailMode(playerId, mode)` | Saves to localStorage |
| `toggleGpsMap()` | Flips `GR.mapOpen`, re-renders map section |
| `selectShotKind(kind)` | Updates `GR.pendingShot.type` and re-renders shot kind row |

---

## Fallback / Backward Compatibility

- Players with no `sl_gps_detail_*` key in localStorage default to `'full'` — identical to current behaviour
- Existing shot data is unaffected
- `distToGreen()` still used as fallback when no green polygon recorded for a hole

---

## Out of Scope

- Mid-round mode switching
- Shot detail visible in the Today leaderboard (existing display unchanged)
- Redesign of My Rounds shot history display
