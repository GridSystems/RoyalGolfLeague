# GPS Round Tracker — Design Spec
**Date:** 2026-05-18  
**Branch:** `feat/gps-tracking`  
**Project:** Royal Golf Club (single `index.html`, GitHub Pages + Supabase)

---

## Overview

A separate GPS-based round tracking mode that lets players record each shot's position live on the course during a Saturday round. Captures club used, shot weight, and weather conditions silently in the background. At the end of the round, pre-fills gross scores into the existing score entry flow. Builds up personal stats over time.

---

## Architecture

- All code stays in `index.html` — no new files, no build step
- **Leaflet.js** loaded from CDN (free, no API key) for satellite map rendering
- **Open-Meteo** (free, no API key) for wind data — `api.open-meteo.com`
- New Supabase table: `gps_shots`
- Addition to `players` table: `bag` JSON column
- GPS tracking is a new top-level view, independent of existing score entry

---

## Database Changes

### New table: `gps_shots`

```sql
CREATE TABLE public.gps_shots (
  id            BIGSERIAL PRIMARY KEY,
  player_id     INTEGER REFERENCES public.players(id),
  round_date    DATE NOT NULL,
  hole          SMALLINT NOT NULL CHECK (hole BETWEEN 1 AND 18),
  shot_num      SMALLINT NOT NULL,
  type          TEXT NOT NULL DEFAULT 'normal' CHECK (type IN ('normal','replay','drop','provisional')),
  lat           DOUBLE PRECISION NOT NULL,
  lng           DOUBLE PRECISION NOT NULL,
  club          TEXT,
  shot_weight   TEXT CHECK (shot_weight IN ('full','3/4','1/2','chip','putt')),
  wind_speed    NUMERIC(5,2),
  wind_dir      TEXT,
  wind_deg      SMALLINT,
  result        TEXT DEFAULT NULL,        -- TBC: post-shot sentiment (e.g. happy/neutral/unhappy)
  recorded_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.gps_shots TO anon, authenticated;
```

### Addition to `players` table

```sql
ALTER TABLE public.players
  ADD COLUMN IF NOT EXISTS bag JSONB NOT NULL DEFAULT '[]';
```

`bag` stores an ordered array of club names the player carries, e.g.:
```json
["Driver","3W","7H","5i","6i","7i","8i","9i","PW","52°","56°","Putter"]
```

---

## On-Course Flow

### 1. Start Screen
- **"Track Round"** button on main nav (visible to logged-in, approved, non-social players)
- Player confirms: date (pre-filled today), starting hole (default 1), tee (platinum/yellow/red)
- Requests GPS permission on entry
- Transitions to Hole View

### 2. Hole View
- **Satellite map** (Leaflet + OpenStreetMap) centred on current GPS position
- Shot dots numbered sequentially, connected by lines
- Line labels show distance between shots in metres
- `chip` and `putt` shots: GPS coordinates **not recorded**, no line drawn — club and shot weight still saved for frequency stats
- `drop` shots: no connecting line drawn from previous shot, dot labelled "⬇ Drop"
- `replay` shots: line drawn but distance shown as 0m, dot labelled "↩ Replay"
- `provisional` shots: dashed connecting line, dot labelled "P"
- Header: hole number, shot count, par
- Wind: **fetched and snapshotted silently — not displayed on hole view** (competition rules)

### 3. Pre-Shot Selector
Appears before each **Hit** — two quick selections:
- **Club** — scrollable list of player's bag in bag order (large tap targets)
- **Shot weight** — toggle: `Full` | `¾` | `½` | `Chip` | `Putt`

Then tap **Hit** → current GPS position recorded with club, weight, and cached wind data.

### 4. Special Shot Buttons
Alongside **Hit**:

| Button | Behaviour |
|---|---|
| **Replay** | Records shot at same/nearby position, no line distance, type=`replay` |
| **Drop** | Records shot at new position, no connecting line drawn, type=`drop` |
| **Provisional** | Records shot with dashed line and "P" label, type=`provisional` |

**Provisional resolution** (shown when a provisional exists):
- **Found Original** — deletes the provisional shot from the hole
- **Provisional in Play** — removes the "provisional" marker, shot becomes normal sequence

### 5. End Hole
- Tap **End Hole** when all shots for the hole are recorded
- Summary card: shots taken, total hole distance (sum of shot distances)
- Score prompt: "Enter gross score" — shot count shown as a hint (not forced as the score)
- Tap **Next Hole** → hole counter increments, map resets for new hole

### 6. Finish Round
- After final hole (or player taps **Finish Round** early)
- Transitions to existing score entry flow
- Gross scores pre-filled from GPS round (one per hole where End Hole was tapped)
- Player reviews and submits as normal

---

## Weather

- **Source:** Open-Meteo (`api.open-meteo.com`) — free, no API key
- **Refresh:** Global `setInterval` every 15 minutes while app is open
- **Data fetched:** wind speed (km/h), wind direction (text: N/NE/E etc.), wind degrees
- **Storage:** Cached in memory as `currentWeather` object
- **Per shot:** `wind_speed`, `wind_dir`, `wind_deg` snapshotted from cache at moment of Hit
- **Display during round:** None (competition rules)
- **Display in stats:** Shown in post-round shot review

---

## Bag Setup

- Accessible from the player's profile tab
- Player picks clubs from a master list and orders them (up/down buttons — mobile friendly)
- Master list: Driver, 2W–9W, 2H–7H (hybrids), 1i–9i, PW, GW, SW, LW, Putter
- **Custom club entry** — free-text "Add custom club" option for clubs not on the master list (e.g. "48° PW", "Driving Iron", "Chipper") — stored in `bag` JSON like any other club
- Saved as `bag` JSON on the `players` row
- Admin can also edit any player's bag
- Club picker in-round loads player's bag in defined order

---

## Stats (Post-Round)

Available in a new "My Stats" section on the player's profile:

| Stat | Source |
|---|---|
| Average distance per club | Distance between shots, filtered by club |
| Driving distance (avg, max) | Driver shots, type=normal, shot_weight=full |
| Putts per round / per hole | Club=Putter shots |
| Club frequency | Count per club across rounds |
| Total distance walked | Sum of all shot-to-shot distances per round |
| Shot conditions | Wind speed/direction snapshotted per shot |

---

## Supabase Migration File

`supabase/add_gps_tracking.sql` — safe to re-run (IF NOT EXISTS guards).

---

## Out of Scope (Future)

- Fairway hit % and GIR % (require course polygon data)
- Distance to pin (requires pin position recording per hole)
- Live wind display on hole view
- Multi-player live tracking on same map
