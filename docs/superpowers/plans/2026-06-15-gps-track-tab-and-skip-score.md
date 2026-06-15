# GPS Track New-Tab + Skip Score Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the GPS Track tab open in a new browser tab, and add a "No Score" skip button to the End Hole panel.

**Architecture:** Two independent edits to `index.html`. Task 1 changes the nav button onclick and adds `openTrackTab()` + an init-time URL param check. Task 2 adds a button and a new function to the End Hole flow. No new state, no schema changes.

**Tech Stack:** Vanilla JS, single-file HTML app. No build step. No test framework — verification is manual in the browser.

---

## File Modified

- `index.html` — all changes here

---

### Task 1: Track tab opens in new browser tab

**Context:** The `📍 Track` nav button (line 219) currently calls `showView('track',this)` which navigates in-page. We need it to instead open a new tab pointed at `?view=track`. On load, if that param is present, the app auto-navigates to the Track view after data loads.

**Files:**
- Modify: `index.html:219` — change onclick
- Modify: `index.html:825` — add `openTrackTab()` after existing GPS preference helpers
- Modify: `index.html:4013` — add URL param detection after `setLoading(false)`

---

- [ ] **Step 1: Change the tabTrack onclick**

At line 219, replace:

```html
<button class="nav-tab" id="tabTrack" onclick="showView('track',this)" style="display:none">📍 Track</button>
```

with:

```html
<button class="nav-tab" id="tabTrack" onclick="openTrackTab()" style="display:none">📍 Track</button>
```

- [ ] **Step 2: Add openTrackTab() function**

At line 825 (after `function selectShotKind...` opens, actually insert after line 825 which ends the `toggleGpsMap` one-liner), add the new function immediately after the existing GPS preference helpers block. The block currently ends around line 829. Add after line 825:

```javascript
function openTrackTab(){
  window.open(location.href.split('?')[0]+'?view=track','_blank');
}
```

Place it on the line immediately after:
```javascript
function toggleGpsMap(){if(!GR)return;GR.mapOpen=!GR.mapOpen;renderGpsHole();}
```

So the block reads:
```javascript
function getGpsDetailMode(playerId){return localStorage.getItem('sl_gps_detail_'+playerId)||'full';}
function setGpsDetailMode(playerId,mode){localStorage.setItem('sl_gps_detail_'+playerId,mode);}
function toggleGpsMap(){if(!GR)return;GR.mapOpen=!GR.mapOpen;renderGpsHole();}
function openTrackTab(){window.open(location.href.split('?')[0]+'?view=track','_blank');}
function selectShotKind(kind,el){
```

- [ ] **Step 3: Add URL param detection at end of init()**

At line 4013 the `init()` function ends with:
```javascript
  setLoading(false);
}
```

Change it to:
```javascript
  setLoading(false);
  const _initView=new URLSearchParams(location.search).get('view');
  if(_initView==='track')showView('track',document.getElementById('tabTrack'));
}
```

- [ ] **Step 4: Verify in browser**

Open `index.html` (or the live GitHub Pages URL). Log in as a player.

**Test A — button opens new tab:**
1. Start a GPS round so the `📍 Track` nav button becomes visible
2. Tap `📍 Track`
3. Expected: a new browser tab opens. The URL contains `?view=track`. The new tab shows the Track screen (GPS setup or resume banner). The original tab stays on whatever screen you were on.

**Test B — direct URL load:**
1. In a fresh tab, open `index.html?view=track` directly
2. Expected: app loads normally, then auto-navigates to the Track view (📍 Track tab is highlighted in the nav)

**Test C — no regression:**
1. Open `index.html` without `?view=track`
2. Expected: app loads normally on the Leaderboard. No unintended navigation.

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "feat: GPS track tab opens in new browser tab via ?view=track param"
```

---

### Task 2: No Score skip button on End Hole

**Context:** `confirmEndHole()` (line 1929) renders a score entry panel. `saveHoleScore()` (line 1964) has a hard `alert` gate if the input is empty. Players need a "No Score" escape that advances to the next hole (or finishes the round) without recording a gross score.

**Files:**
- Modify: `index.html:1953-1959` — add "No Score" button to the buttons div
- Modify: `index.html:1978` — add `skipHoleScore()` immediately after `saveHoleScore()`

---

- [ ] **Step 1: Add "No Score" button to confirmEndHole()**

Lines 1953–1959 currently read:

```javascript
        <div class="fa">
          <button class="btn btn-ghost" onclick="renderGpsHole()">← Back</button>
          ${GR.currentHole<18?`<button class="btn btn-ghost" onclick="saveHoleScore(true)">Finish Round</button>`:''}
          <button class="btn btn-primary" onclick="saveHoleScore()">
            ${GR.currentHole<18?'Next Hole →':'Finish Round'}
          </button>
        </div>
```

Replace with:

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

The only addition is the single "No Score" button on the second line of the div.

- [ ] **Step 2: Add skipHoleScore() function**

After line 1978 (the closing `}` of `saveHoleScore()`), insert:

```javascript
function skipHoleScore(){
  GR._pendingFinish=GR.currentHole>=18;
  if(GR.scoringForIds&&GR.scoringForIds.length>0){
    renderMarkerScoring(0);
  }else if(GR.currentHole<18){
    GR.currentHole++;
    GR.provisionalShotId=null;GR.chipAndPutt=false;
    renderGpsHole();
  }else{
    finishGpsRound();
  }
}
```

This mirrors `saveHoleScore()` exactly, minus the score input read and validation. It does not write to `GR.holeScores`, so the hole keeps `score: null` in Supabase when the round is patched by `finishGpsRound()`.

- [ ] **Step 3: Verify in browser**

Start a GPS round in any tracking mode that shows the End Hole button (shots/clubs/full — any mode except gps-only which goes directly to confirmEndHole).

**Test A — No Score advances hole:**
1. Tap "End Hole →" on any hole (e.g. hole 3)
2. The "Hole 3 Complete" panel appears with the score input
3. Tap "No Score"
4. Expected: the panel disappears and the GPS hole screen shows hole 4. No alert appears.

**Test B — No Score on hole 18 finishes round:**
1. Navigate to the last hole (hole 18 or whichever is last based on starting hole)
2. Tap "End Hole →", then "No Score"
3. Expected: `finishGpsRound()` is called — the round summary or leaderboard appears. No alert.

**Test C — No Score with marker scoring:**
1. Start a GPS round where "Scoring for" includes other players (marker mode)
2. Tap "End Hole →", then "No Score"
3. Expected: the GPS player's own score is skipped, but the marker scoring panel still appears for each player being scored. Each player's score entry works normally.

**Test D — Normal score entry still works:**
1. Tap "End Hole →", enter a score (e.g. 4), tap "Next Hole →"
2. Expected: behaves identically to before this change. The "No Score" button is present but does not interfere.

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "feat: No Score skip button on GPS End Hole panel"
```
