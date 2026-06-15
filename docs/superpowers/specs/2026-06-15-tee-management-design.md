# Tee Management Design Spec

**Date:** 2026-06-15
**Status:** Approved

---

## Problem

Tees are hardcoded in the `TEES` array in `index.html`. When course ratings, slopes, or distances change, only a developer can update them. Admins need to be able to edit tee details, add new tees, and archive retired ones — all without touching code.

---

## Solution

Move tees to a Supabase `tees` table. Load at init alongside players and rounds. Add a Tees management panel to the admin screen with full edit, add, and archive capability.

---

## Database

### New table: `tees`

```sql
CREATE TABLE IF NOT EXISTS public.tees (
  id        text PRIMARY KEY,
  name      text NOT NULL,
  color     text NOT NULL,
  rating    numeric NOT NULL,
  slope     integer NOT NULL,
  dist      jsonb,
  archived  boolean NOT NULL DEFAULT false
);
```

`dist` is a JSON array of 18 integers (metres, one per hole, 0-indexed). Individual holes may be `null` within the array. The whole column may be `null` if no distances are recorded.

### Grants

```sql
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tees TO anon, authenticated;
```

Add this to `supabase/grants.sql`.

### Seed data

On first load, if the `tees` table is empty, insert the 7 hardcoded tees from the current `TEES` array:

| id | name | color | rating | slope |
|---|---|---|---|---|
| champion | Royal Champion | #222 | 77.9 | 153 |
| platinum | Royal Platinum | #b0a0c0 | 77.6 | 153 |
| 62 | 62 Tee | #e0d8b0 | 76.2 | 149 |
| 57 | 57 Tee | #f5e840 | 73.1 | 144 |
| 54 | 54 Tee | #4a8ce8 | 71.3 | 141 |
| 50 | 50 Tee | #e84848 | 69.5 | 134 |
| 43 | 43 Tee | #f0a030 | 66.0 | 125 |

`dist` values are included for all 7 seed tees (from the current hardcoded array).

---

## Data loading

### `tees` global variable

Replace the hardcoded `const TEES = [...]` with a mutable global:

```javascript
let tees = [];  // loaded from Supabase; replaces const TEES
```

### `loadData()` change

Add tees fetch alongside existing players/rounds fetch:

```javascript
tees = await sbGet('tees', 'order=archived.asc,name.asc');
if(tees.length === 0) await seedTees();
```

`seedTees()` inserts the 7 hardcoded tees into Supabase and sets `tees` to the result.

### `getTee()` unchanged signature

```javascript
const getTee = id => tees.find(t => t.id === id) || tees.find(t => t.id === 'platinum') || tees[0];
```

Searches all tees including archived, so historical rounds with archived `tee_id` values still resolve. Falls back to platinum or first tee if no match.

### Tee selectors

All tee `<select>` elements are built by `buildTeeSelectorEl()`. Update it to filter out archived tees:

```javascript
function buildTeeSelectorEl(elId, selectedId, stateVar) {
  const el = document.getElementById(elId);
  if(!el) return;
  el.innerHTML = tees
    .filter(t => !t.archived)
    .map(t => `<option value="${t.id}" ${t.id===selectedId?'selected':''}>${t.name}</option>`)
    .join('');
}
```

---

## Admin UI

### Panel placement

Add a **Tees** panel to `view-admin`, between the existing info-box and the Pending Approvals panel.

### Panel structure

```
┌─────────────────────────────────────────┐
│ Tees                    [+ Add Tee]     │
├─────────────────────────────────────────┤
│ Royal Champion  77.9  153  ████  [Edit] [Archive] │
│ Royal Platinum  77.6  153  ████  [Edit] [Archive] │
│ ...                                     │
│ ── Archived ──                          │
│ Old Champion    77.5  150  ████  [Edit] [Restore] │
└─────────────────────────────────────────┘
```

### Table columns

| Column | Content |
|---|---|
| Name | Tee name |
| CR | Course rating (numeric) |
| Slope | Slope (integer) |
| Colour | Small colour swatch (the tee's `color` hex) |
| Actions | Edit button + Archive/Restore button |

Active tees shown first (sorted by name), archived tees greyed out below a divider.

### Edit form

Tapping **Edit** expands an inline form below the tee's row (same panel, no modal). Fields:

| Field | Input | Required |
|---|---|---|
| Name | text | ✓ |
| Color | `<input type="color">` | ✓ |
| Course Rating | number (step 0.1) | ✓ |
| Slope | number (integer) | ✓ |
| Distances | 18 number inputs, grouped Out (1–9) and In (10–18) | optional |

**Save** button: validates name + CR + slope are present, PATCHes to Supabase, updates `tees` in memory, refreshes the tee table display and all tee selectors, collapses the form.

**Cancel** button: collapses without saving.

Only one edit form open at a time. Opening a second auto-closes the first.

### Add Tee form

**+ Add Tee** button at top-right of panel header. Expands an inline form at the top of the tee list (same fields as Edit, all blank). On save, generates an `id` from the name (`name.toLowerCase().replace(/\s+/g,'-').replace(/[^a-z0-9-]/g,'')`) and INSERTs to Supabase.

If the generated id already exists, append `-2`, `-3`, etc. until unique.

### Archive / Restore

- **Archive**: sets `archived = true` on the tee. No confirmation needed (reversible).
- **Restore**: sets `archived = false`.
- Cannot archive a tee that is currently selected in any active tee selector (check `selTeeId`, `gpsTeeId`, `BE.teeId` before archiving; show a toast if blocked).

---

## Variable rename

`const TEES` is removed and replaced with `let tees = []`. Every reference to `TEES` in `index.html` is updated to `tees`. The only direct references outside `getTee()` and `buildTeeSelectorEl()` are in the bulk entry and scorecard rendering paths — all updated as part of Task 1.

---

## Functions added / changed

| Function | Change |
|---|---|
| `getTee(id)` | Searches `tees` (global var) instead of `TEES` (const) |
| `buildTeeSelectorEl()` | Filters `t.archived === false` |
| `loadData()` | Fetches `tees` table; calls `seedTees()` if empty |
| `seedTees()` | New — inserts 7 hardcoded tees into Supabase |
| `renderAdminTees()` | New — renders the Tees panel |
| `renderAdmin()` | Calls `renderAdminTees()` |
| `saveTeeEdit(id)` | New — PATCHes tee to Supabase, updates memory + UI |
| `addTee()` | New — INSERTs new tee, updates memory + UI |
| `archiveTee(id)` | New — toggles `archived`, updates memory + UI |

---

## Out of Scope

- Reordering tees (sort order is alphabetical by name within active/archived groups)
- Per-hole par or SI editing (those are hardcoded constants `HOLE_PARS` / `HOLE_HCP`)
- Deleting tees permanently (archive is the only removal path)
- Tee visibility per player or per event
