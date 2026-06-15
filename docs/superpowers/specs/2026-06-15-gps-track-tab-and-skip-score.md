# GPS Track Tab + Skip Score Design Spec

**Date:** 2026-06-15
**Status:** Approved

---

## Feature 1: Track Tab Opens in New Browser Tab

### Problem

The `📍 Track` nav button navigates to the GPS tracking view within the same browser tab. Players who want to keep the leaderboard or scorecard visible in one tab while tracking GPS have no way to do so.

### Solution

Change the Track nav button to open the GPS tracking view in a new browser tab automatically. The original tab stays on whatever screen the player was on.

### Implementation

**Nav button change:**

```html
<button class="nav-tab" id="tabTrack" onclick="openTrackTab()" style="display:none">📍 Track</button>
```

`onclick` changes from `showView('track',this)` to `openTrackTab()`.

**`openTrackTab()` function:**

```javascript
function openTrackTab(){
  window.open(location.href.split('?')[0] + '?view=track', '_blank');
}
```

Strips any existing query string before appending `?view=track` to keep the URL clean.

**On page load — auto-navigate to track view:**

At the end of `init()`, after `setLoading(false)`, add:

```javascript
const _initView = new URLSearchParams(location.search).get('view');
if(_initView === 'track') showView('track', document.getElementById('tabTrack'));
```

This runs once at init time, after data is loaded and the UI is ready. If the tab was opened with `?view=track`, the app lands directly on the Track screen rather than the default Leaderboard.

**Behaviour:**

- Clicking `📍 Track` in the original tab opens a new tab pointed at `?view=track`
- The new tab loads the full app, detects the param, and calls `showView('track')` — the Track nav button becomes active
- The original tab is unaffected — stays on its current screen
- If the player navigates away from Track in the new tab (e.g. back to Leaderboard), then back, the Track view re-renders normally (no special param handling needed for in-tab navigation)
- The `?view=track` param is cosmetic only — no other page-load behaviour changes

---

## Feature 2: Skip Score on End Hole

### Problem

In `confirmEndHole()`, the score input is a hard gate. `saveHoleScore()` calls `alert('Enter a valid score.')` and returns if the input is empty or zero. The only escape is `← Back`, which returns to the hole screen — not the next hole. Players cannot advance past a hole without entering a score.

### Solution

Add a **"No Score"** button to the `confirmEndHole()` panel. Tapping it skips the gross score for that hole and advances normally (next hole or finish round). GPS shots recorded for the hole are unaffected.

### Implementation

**In `confirmEndHole()` — add No Score button:**

```javascript
<div class="fa">
  <button class="btn btn-ghost" onclick="renderGpsHole()">← Back</button>
  <button class="btn btn-ghost" onclick="skipHoleScore()">No Score</button>
  ${GR.currentHole<18?`<button class="btn btn-ghost" onclick="saveHoleScore(true)">Finish Round</button>`:''}
  <button class="btn btn-primary" onclick="saveHoleScore()">
    ${GR.currentHole<18?'Next Hole →':'Finish Round'}
  </button>
</div>
```

**`skipHoleScore()` function:**

```javascript
function skipHoleScore(){
  // Leave GR.holeScores[GR.currentHole] unset (no gross score for this hole)
  GR._pendingFinish = GR.currentHole >= 18;
  if(GR.scoringForIds && GR.scoringForIds.length > 0){
    renderMarkerScoring(0);
  } else if(GR.currentHole < 18){
    GR.currentHole++;
    GR.provisionalShotId = null;
    GR.chipAndPutt = false;
    renderGpsHole();
  } else {
    finishGpsRound();
  }
}
```

This mirrors `saveHoleScore()` exactly except it does not write to `GR.holeScores` and needs no input validation.

**Effect on round data:**

`finishGpsRound()` uses `GR.holeScores` to patch rounds. A hole with no entry in `GR.holeScores` will keep its existing `score: null` in the database — same as a hole that was never reached. The round stays valid; it just has one fewer hole scored.

**Marker scoring flow:**

When "No Score" is tapped by the GPS player, `renderMarkerScoring()` still runs for any players being scored by marker — they can still have their scores entered even if the GPS player skipped their own.

---

## Out of Scope

- Changing the in-tab Track view for any other purpose
- Mid-round mode switching
- Any changes to how skipped holes appear in the leaderboard (null scores are already excluded from Stableford totals)
