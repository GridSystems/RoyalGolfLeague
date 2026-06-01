# GPS Screen Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the GPS tracking screen with four selectable detail modes (`gps`/`shots`/`clubs`/`full`), a collapsible map, front/middle/back green distances in the header, and Drop/Replay/Provisional moved into the confirm panel.

**Architecture:** All changes are in `index.html`. Six tasks in dependency order. GR gains `detailMode` (string) and `mapOpen` (boolean). `renderGpsHole()` is fully restructured around `GR.detailMode`. The Leaflet map is only initialised when `GR.mapOpen` is true and torn down via the reset block at the top of `renderGpsHole()` on every re-render. The confirm panel adds a shot-kind row and gates club/lie/weight/result rows by mode. `selectShotKind()` updates `GR.pendingShot.type` in-place via CSS class swap without a full re-render.

**Tech Stack:** Vanilla JS, Leaflet.js, Supabase REST, single-file `index.html`. No build step. All testing is done by opening `index.html` in a browser.

---

## File

- Modify: `index.html` (all changes in one file)

Key reference lines (will shift as earlier tasks add lines — search by content, not line number):
- `getGreenDistances` function — ~line 806
- Units helpers `// ── Units preference` comment — ~line 821
- `renderGpsStart()` — ~line 1072
- `startGpsRound()` / GR init object — ~line 1112
- `startGpsWatch()` GPS fix callback / distance badge block — ~line 1177
- `renderGpsHole()` — ~line 1278
- `toggleDistRings()` — ~line 1617
- `toggleGreenZoom()` — ~line 1439
- `recordShot()` — ~line 1766
- `savePendingShot()` — ~line 1797
- `renderMyRounds()` — ~line 3633
- My Rounds `hsub-rounds` div / `myDreamPanel` — ~line 353

---

## Task 1: Helper functions + GR state additions

**Files:**
- Modify: `index.html` (units section ~line 821; `startGpsRound()` GR init ~line 1122)

- [ ] **Step 1: Add four new GPS helper functions**

Find (line ~821):
```javascript
// ── Units preference ──────────────────────────────────────────────────────────
function getUnits(){
```

Insert the following block immediately **before** that comment:
```javascript
// ── GPS detail mode preference ────────────────────────────────────────────────
function getGpsDetailMode(playerId){return localStorage.getItem('sl_gps_detail_'+playerId)||'full';}
function setGpsDetailMode(playerId,mode){localStorage.setItem('sl_gps_detail_'+playerId,mode);}
function toggleGpsMap(){if(!GR)return;GR.mapOpen=!GR.mapOpen;renderGpsHole();}
function selectShotKind(kind,el){
  if(!GR||!GR.pendingShot)return;
  GR.pendingShot.type=kind;
  document.querySelectorAll('.shot-kind-btn').forEach(b=>b.classList.remove('selected'));
  el.classList.add('selected');
}

```

- [ ] **Step 2: Add `detailMode` and `mapOpen` to GR init**

In `startGpsRound()`, find the GR object literal. The first three lines look like:
```javascript
    GR={
      date,teeId:gpsTeeId,currentHole:startHole,
      currentLat:lat,currentLng:lng,currentAccuracy:null,
```

Replace with:
```javascript
    const _dm=document.getElementById('gpsTrackMode')?.value||getGpsDetailMode(activeId);
    GR={
      date,teeId:gpsTeeId,currentHole:startHole,
      detailMode:_dm,mapOpen:_dm==='gps',
      currentLat:lat,currentLng:lng,currentAccuracy:null,
```

- [ ] **Step 3: Verify in browser console**

Open `index.html`. In the browser console:
```javascript
getGpsDetailMode(999)           // → 'full'
setGpsDetailMode(999, 'shots')
getGpsDetailMode(999)           // → 'shots'
localStorage.removeItem('sl_gps_detail_999')
getGpsDetailMode(999)           // → 'full'
```
Expected: all three assertions correct.

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "feat: GPS detail mode helpers + GR state fields (detailMode, mapOpen)"
```

---

## Task 2: Round setup — tracking mode selector

**Files:**
- Modify: `index.html` (`renderGpsStart()` ~line 1072)

- [ ] **Step 1: Add `selectGpsTrackMode` function**

Immediately before `function renderGpsStart()`, insert:
```javascript
function selectGpsTrackMode(mode){
  document.getElementById('gpsTrackMode').value=mode;
  document.querySelectorAll('#gpsTrackModeCards>[data-mode]').forEach(d=>{
    const sel=d.dataset.mode===mode;
    d.style.border=sel?'1px solid rgba(201,168,76,0.5)':'1px solid rgba(255,255,255,0.12)';
    d.style.background=sel?'rgba(201,168,76,0.08)':'rgba(0,0,0,0.2)';
    d.querySelector('div').style.color=sel?'var(--gold-l)':'rgba(255,255,255,0.85)';
  });
}

```

- [ ] **Step 2: Add tracking section to `renderGpsStart()` HTML**

Inside `renderGpsStart()`, find the closing of the tee section and the start of the scoring-for block:
```javascript
          </div>
        </div>
        ${(()=>{const date=document.getElementById('gpsDate')?.value||today();const list=buildScoringForList(date);return list.length?`<div>
```

Replace with:
```javascript
          </div>
        </div>
        <div>
          <label style="font-size:0.78rem;color:rgba(255,255,255,0.5);text-transform:uppercase;letter-spacing:0.05em">Tracking</label>
          <input type="hidden" id="gpsTrackMode" value="${getGpsDetailMode(activeId)}">
          <div style="display:flex;flex-direction:column;gap:6px;margin-top:6px" id="gpsTrackModeCards">
            ${[{v:'gps',l:'GPS only',d:'Map, distances and rings. No shots recorded — use this when you just want live yardages.'},{v:'shots',l:'Shots only',d:"Records each shot's GPS position and count. One confirm tap per shot, nothing else."},{v:'clubs',l:'Shots + clubs',d:"Adds club selection to each shot. Good for tracking what you're hitting without the full detail."},{v:'full',l:'Full detail',d:'Records lie, club, shot weight and result. Full shot analysis after the round.'}].map(m=>{const sel=getGpsDetailMode(activeId)===m.v;return `<div onclick="selectGpsTrackMode('${m.v}')" data-mode="${m.v}" style="padding:10px 12px;border-radius:9px;cursor:pointer;border:1px solid ${sel?'rgba(201,168,76,0.5)':'rgba(255,255,255,0.12)'};background:${sel?'rgba(201,168,76,0.08)':'rgba(0,0,0,0.2)'};user-select:none"><div style="font-weight:600;font-size:0.85rem;color:${sel?'var(--gold-l)':'rgba(255,255,255,0.85)'}">${m.l}</div><div style="font-size:0.72rem;color:rgba(255,255,255,0.4);margin-top:3px">${m.d}</div></div>`;}).join('')}
          </div>
        </div>
        ${(()=>{const date=document.getElementById('gpsDate')?.value||today();const list=buildScoringForList(date);return list.length?`<div>
```

- [ ] **Step 3: Verify**

Open `index.html` → Track Round. Expected:
- Four mode cards appear below the Tee selector, each with label + description
- The player's saved preference is highlighted (defaults to "Full detail" for new players)
- Clicking "GPS only" highlights that card and de-highlights the previous one
- Opening the setup screen again still shows the current saved preference highlighted

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "feat: GPS round setup — tracking mode selector with 4 modes"
```

---

## Task 3: Front / middle / back green distances

**Files:**
- Modify: `index.html` (`startGpsWatch()` callback ~line 1177)

- [ ] **Step 1: Update live GPS distance badge**

In `startGpsWatch()`, find:
```javascript
      // Update distance-to-green badge
      const distBadge=document.getElementById('gpsDist');
      if(distBadge){const d=distToGreen(GR.currentHole,GR.currentLat,GR.currentLng);if(d!=null)distBadge.textContent=dispDist(d)+' ⛳';}
```

Replace with:
```javascript
      // Update distance-to-green badge (front · mid · back, or single fallback)
      const distBadge=document.getElementById('gpsDist');
      if(distBadge){
        const _poly=greenPolygons[GR.currentHole];
        const _gd=_poly?getGreenDistances(_poly,GR.currentLat,GR.currentLng):null;
        if(_gd){distBadge.textContent=`${dispDist(Math.round(_gd.front.dist))} · ${dispDist(Math.round(_gd.mid.dist))} · ${dispDist(Math.round(_gd.back.dist))} ⛳`;}
        else{const _d=distToGreen(GR.currentHole,GR.currentLat,GR.currentLng);if(_d!=null)distBadge.textContent=dispDist(_d)+' ⛳';}
      }
```

- [ ] **Step 2: Verify**

Start a GPS tracking session (any mode). After getting a GPS fix, check the distance display in the header:
- If the current hole has a green polygon recorded in course-mapper: shows `135m · 142m · 149m ⛳`
- If no green polygon: shows single distance `142m ⛳` as before
- Distance updates live as you move

In console: `document.getElementById('gpsDist')?.textContent` — should show the distances.

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "feat: GPS distance badge shows front/mid/back green distances"
```

---

## Task 4: renderGpsHole() — mode-aware screen restructure

**Files:**
- Modify: `index.html` (`renderGpsHole()` ~line 1278; `toggleDistRings()` ~line 1617; `toggleGreenZoom()` ~line 1439)

This task replaces the outer shell of `renderGpsHole()` — header, action panels, map wrapper — while keeping the confirm panel (`GR.pendingShot` branch) as-is. Task 5 restructures the confirm panel.

- [ ] **Step 1: Add map removal to the `renderGpsHole()` reset block**

Find at the top of `renderGpsHole()`:
```javascript
  if(GR){GR.greenZoom=false;GR.greenLayers=[];GR.greenLabelMarkers=[];GR._greenMoveHandler=null;GR.distRingLayers=[];GR.distRingLabelMarkers=[];GR._distRingMoveHandler=null;if(GR.playerDot){GR.playerDot.remove();GR.playerDot=null;}}
```

Replace with:
```javascript
  if(GR){GR.greenZoom=false;GR.greenLayers=[];GR.greenLabelMarkers=[];GR._greenMoveHandler=null;GR.distRingLayers=[];GR.distRingLabelMarkers=[];GR._distRingMoveHandler=null;if(GR.playerDot){GR.playerDot.remove();GR.playerDot=null;}if(GR.map){GR.map.remove();GR.map=null;GR.markers=[];GR.polylines=[];}}
```

- [ ] **Step 2: Replace the variable block and full `el.innerHTML` in `renderGpsHole()`**

Find from `const dtg=distToGreen` through `initGpsMap(holeShots);` and the closing `}` of `renderGpsHole`. That is — everything after the reset block through to `}`. Replace the entire section with:

```javascript
  const el=document.getElementById('trackContent');
  const p=players.find(x=>x.id===activeId);
  const holeShots=GR.shots.filter(s=>s.hole===GR.currentHole);
  const shotCount=holeShots.length;
  const par=HOLE_PARS[GR.currentHole-1];
  const hasProvisional=GR.provisionalShotId!=null;
  const dtg=distToGreen(GR.currentHole,GR.currentLat??null,GR.currentLng??null);
  const _poly=greenPolygons[GR.currentHole];
  const _gd=(_poly&&GR.currentLat!=null)?getGreenDistances(_poly,GR.currentLat,GR.currentLng):null;
  const distHeaderHtml=_gd
    ?`<span id="gpsDist" style="color:#d4b483;font-weight:600">${dispDist(Math.round(_gd.front.dist))} · ${dispDist(Math.round(_gd.mid.dist))} · ${dispDist(Math.round(_gd.back.dist))} ⛳</span>`
    :dtg!=null?`<span id="gpsDist" style="color:#d4b483;font-weight:600">${dispDist(dtg)} ⛳</span>`
    :'<span id="gpsDist"></span>';
  const bag=p?.bag&&p.bag.length?p.bag:['Driver'];
  const isGpsOnly=GR.detailMode==='gps';

  // ── Confirm panel (GR.pendingShot) — Task 5 restructures this ─────────────
  const confirmPanel=GR.pendingShot?`<div style="padding:1rem;display:flex;flex-direction:column;gap:1.1rem;border-top:1px solid var(--border)">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <div style="font-size:0.7rem;text-transform:uppercase;letter-spacing:0.07em;color:rgba(255,255,255,0.4)">Shot ${shotCount+1} — describe the shot</div>
        <div id="gpsLocStatus" style="font-size:0.7rem;color:rgba(255,255,255,0.35)">${GR.pendingShot?.locating?'📍 Locating…':''}</div>
      </div>
      <div>
        <div style="font-size:0.72rem;color:rgba(255,255,255,0.45);margin-bottom:7px;text-transform:uppercase;letter-spacing:0.05em">Lie</div>
        <div style="display:flex;gap:6px;flex-wrap:wrap">${GPS_LIES.map(l=>`<button class="weight-btn lie-btn${GR.selectedLie===l.v?' selected':''}" onclick="selectGpsLie('${l.v}',this)">${l.l}</button>`).join('')}</div>
      </div>
      <div>
        <div style="font-size:0.72rem;color:rgba(255,255,255,0.45);margin-bottom:7px;text-transform:uppercase;letter-spacing:0.05em">Club</div>
        <div style="display:flex;gap:6px;flex-wrap:wrap">${bag.map(c=>`<button class="club-btn${GR.selectedClub===c?' selected':''}" onclick="selectGpsClub('${c.replace(/'/g,"\\'")}',this)">${escHtml(c)}</button>`).join('')}</div>
      </div>
      <div>
        <div style="font-size:0.72rem;color:rgba(255,255,255,0.45);margin-bottom:7px;text-transform:uppercase;letter-spacing:0.05em">Shot type</div>
        <div style="display:flex;gap:6px;flex-wrap:wrap">${GPS_WEIGHTS.map(w=>`<button class="weight-btn${GR.selectedWeight===w.v?' selected':''}" onclick="selectGpsWeight('${w.v}',this)">${w.l}</button>`).join('')}</div>
      </div>
      <div>
        <div style="font-size:0.72rem;color:rgba(255,255,255,0.45);margin-bottom:7px;text-transform:uppercase;letter-spacing:0.05em">Result</div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:6px">${GPS_DIRECTIONS.map(d=>`<button class="weight-btn dir-btn${GR.selectedDirection===d.v?' selected':''}" onclick="selectGpsDirection('${d.v}',this)">${d.l}</button>`).join('')}</div>
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          <button class="weight-btn outcome-btn${GR.selectedOutcome==='lost'?' selected':''}" onclick="selectGpsOutcome('lost',this)">⚠ Lost</button>
          <button class="weight-btn outcome-btn${GR.selectedOutcome==='green'?' selected':''}" onclick="selectGpsOutcome('green',this)">⛳ Green</button>
        </div>
        <div id="outcomeNote" style="font-size:0.7rem;color:rgba(255,255,255,0.35);margin-top:5px;display:${GR.selectedOutcome?'block':'none'}">GPS distance won't be tracked for the next shot</div>
      </div>
      <div style="display:flex;gap:8px">
        <button class="btn btn-ghost btn-sm" onclick="cancelPendingShot()">Cancel</button>
        <button class="btn btn-primary" style="flex:1" onclick="savePendingShot()">Save Shot →</button>
      </div>
    </div>`:null;

  // ── bodyHtml ───────────────────────────────────────────────────────────────
  const bodyHtml=confirmPanel??
    (GR.chipAndPutt?
    `<div style="padding:1.5rem 1rem;display:flex;flex-direction:column;align-items:center;gap:1.2rem;border-top:1px solid var(--border)">
      <div style="font-size:0.82rem;color:rgba(255,255,255,0.35);text-align:center">Chip and putt out, then end the hole</div>
      <div style="display:flex;gap:8px;width:100%;flex-wrap:wrap">
        <button class="btn-shot-type${GR.distRings?' selected':''}" style="flex:0 0 auto" onclick="toggleDistRings()">${GR.distRings?'Rings ✕':'📍 Rings'}</button>
        <button class="btn-shot-type${GR.greenZoom?' selected':''}" style="flex:0 0 auto" onclick="toggleGreenZoom()">${GR.greenZoom?'Green ✕':'⛳ Green'}</button>
        <button class="btn-shot-type${GR.mapOpen?' selected':''}" style="flex:0 0 auto" onclick="toggleGpsMap()">🗺 Map${GR.mapOpen?' ✕':''}</button>
        <button class="btn btn-primary" style="flex:1;min-width:120px;padding:0.9rem;font-size:1rem" onclick="confirmEndHole()">End Hole →</button>
      </div>
    </div>`:
    isGpsOnly?
    `<div class="gps-actions">
      <div style="display:flex;gap:8px;flex-wrap:wrap;width:100%">
        <button class="btn-shot-type${GR.distRings?' selected':''}" onclick="toggleDistRings()">${GR.distRings?'Rings ✕':'📍 Rings'}</button>
        <button class="btn-shot-type${GR.greenZoom?' selected':''}" onclick="toggleGreenZoom()">${GR.greenZoom?'Green ✕':'⛳ Green'}</button>
      </div>
    </div>`:
    `<div class="gps-actions">
      <button class="btn-hit" onclick="recordShot('normal')">🎯 Hit</button>
      <div style="display:flex;gap:8px;flex-wrap:wrap;width:100%">
        <button class="btn-shot-type${GR.distRings?' selected':''}" onclick="toggleDistRings()">${GR.distRings?'Rings ✕':'📍 Rings'}</button>
        <button class="btn-shot-type${GR.greenZoom?' selected':''}" onclick="toggleGreenZoom()">${GR.greenZoom?'Green ✕':'⛳ Green'}</button>
        <button class="btn-shot-type${GR.mapOpen?' selected':''}" onclick="toggleGpsMap()">🗺 Map${GR.mapOpen?' ✕':''}</button>
      </div>
      ${hasProvisional?`
      <button class="btn-shot-type" style="color:#7fcc9e;border-color:rgba(127,204,158,0.4)" onclick="resolveProvisional('found')">✓ Found Original</button>
      <button class="btn-shot-type" style="color:#f0c060;border-color:rgba(240,192,96,0.4)" onclick="resolveProvisional('inplay')">▶ Provisional In Play</button>`:''}
    </div>`);

  // ── Rings / green zoom control bar ────────────────────────────────────────
  const controlBar=GR.distRings?`<div style="display:flex;gap:8px;align-items:center;padding:8px 12px;background:rgba(100,160,255,0.08);border-top:1px solid rgba(100,180,255,0.18);flex-wrap:wrap">
        <button class="btn btn-ghost btn-sm" onclick="shiftDistRings(-50)" style="min-width:44px">−50</button>
        <span id="distRingCentreDisplay" style="font-size:0.8rem;color:rgba(100,190,255,0.9);font-weight:600;min-width:58px;text-align:center">~${GR.distRingCentre}${getUnits()}</span>
        <button class="btn btn-ghost btn-sm" onclick="shiftDistRings(50)" style="min-width:44px">+50</button>
        <div style="width:1px;height:18px;background:rgba(255,255,255,0.12);margin:0 2px"></div>
        <button id="distRingIntervalBtn" class="btn btn-ghost btn-sm" onclick="cycleDistInterval()" style="min-width:48px">±${GR.distRingInterval}</button>
        <span style="font-size:0.7rem;color:rgba(255,255,255,0.3)">interval</span>
        <div style="width:1px;height:18px;background:rgba(255,255,255,0.12);margin:0 2px"></div>
        <button class="btn btn-ghost btn-sm" onclick="if(GR&&GR.currentLat&&GR.map)GR.map.setView([GR.currentLat,GR.currentLng],18)" style="min-width:44px" title="Re-centre on me">📍 Me</button>
        <div style="width:1px;height:18px;background:rgba(255,255,255,0.12);margin:0 2px"></div>
        <span id="gpsAccBadge" style="font-size:0.75rem;font-weight:600;color:${GR.currentAccuracy!=null?(GR.currentAccuracy<=5?'rgba(127,204,158,0.9)':'rgba(240,180,60,0.9)'):'rgba(255,255,255,0.3)'}">${GR.currentAccuracy!=null?`📍 ±${Math.round(GR.currentAccuracy)}m`:'📍 …'}</span>
      </div>`:GR.greenZoom?`<div style="display:flex;gap:8px;align-items:center;padding:6px 12px;background:rgba(46,204,113,0.06);border-top:1px solid rgba(46,204,113,0.18)">
        <span id="gpsAccBadge" style="font-size:0.75rem;font-weight:600;color:${GR.currentAccuracy!=null?(GR.currentAccuracy<=5?'rgba(127,204,158,0.9)':'rgba(240,180,60,0.9)'):'rgba(255,255,255,0.3)'}">${GR.currentAccuracy!=null?`📍 ±${Math.round(GR.currentAccuracy)}m`:'📍 …'}</span>
      </div>`:'';

  // ── Header ─────────────────────────────────────────────────────────────────
  const headerSub=isGpsOnly
    ?`Par ${par} · SI ${HOLE_HCP[GR.currentHole-1]} · ${distHeaderHtml}`
    :`Par ${par} · SI ${HOLE_HCP[GR.currentHole-1]} · Shot ${shotCount+1} · ${distHeaderHtml}`;
  const headerBtn=isGpsOnly||GR.chipAndPutt
    ?`<button class="btn btn-ghost btn-sm" onclick="confirmEndHole()">End Hole →</button>`
    :`<button class="btn btn-ghost btn-sm" onclick="enterChipAndPutt()">⛳ Chip &amp; Putt →</button>`;

  el.innerHTML=`
    <div style="background:rgba(0,0,0,0.3);border:1px solid var(--border);border-radius:14px;overflow:hidden">
      <div class="gps-hole-header">
        <div>
          <div style="font-family:'Playfair Display',serif;color:var(--gold-l);font-size:1.1rem">Hole ${GR.currentHole}</div>
          <div style="font-size:0.72rem;color:rgba(255,255,255,0.4)">${headerSub}</div>
        </div>
        ${headerBtn}
      </div>
      ${bodyHtml}
      ${controlBar}
      <div id="gpsMapWrap" style="${GR.mapOpen?'':'display:none'}"><div id="gpsMap"></div></div>
      <div style="padding:0.5rem 1rem;display:flex;gap:8px;justify-content:flex-end;border-top:1px solid var(--border)">
        <button class="btn btn-ghost btn-sm" onclick="abandonGpsRound()">Abandon</button>
        <button class="btn btn-primary btn-sm" onclick="confirmEndHole()">Finish Round</button>
      </div>
    </div>`;
  if(GR.mapOpen)initGpsMap(holeShots);
}
```

- [ ] **Step 3: Make Rings and Green buttons auto-open the map**

`toggleDistRings()` and `toggleGreenZoom()` both guard with `if(!GR.map)return` — which silently does nothing when the map is collapsed. Fix both to auto-open the map when called with a collapsed map.

Find the opening of `toggleDistRings()`:
```javascript
function toggleDistRings(){
  if(!GR||!GR.map)return;
```

Replace with:
```javascript
function toggleDistRings(){
  if(!GR)return;
  if(!GR.map){if(!GR.mapOpen){GR.mapOpen=true;GR.distRings=!GR.distRings;renderGpsHole();}return;}
```

Find the opening of `toggleGreenZoom()`:
```javascript
function toggleGreenZoom(){
  if(!GR||!GR.map)return;
```

Replace with:
```javascript
function toggleGreenZoom(){
  if(!GR)return;
  if(!GR.map){if(!GR.mapOpen){GR.mapOpen=true;renderGpsHole();}return;}
```

- [ ] **Step 4: Verify**

Start a GPS round in **Full detail** mode. Expected:
- Header shows `Hole N · Par X · SI Y · Shot 1 · [distances]`
- ⛳ Chip & Putt → in header; Hit button + Rings, Green, Map buttons in body
- Map is **collapsed** initially; 🗺 Map button not highlighted
- Clicking 🗺 Map opens the map; clicking again collapses it
- Clicking 📍 Rings with map collapsed: map opens AND rings activate
- Clicking ⛳ Green with map collapsed: map opens

Start in **GPS only** mode. Expected:
- Header shows `Hole N · Par X · SI Y · [distances]` (no "Shot N")
- No Hit button; only Rings and Green in body
- Map is open by default
- Header shows **End Hole →**; Chip & Putt absent

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "feat: GPS hole screen mode-aware layout with collapsible map"
```

---

## Task 5: Confirm panel — shot kind row + mode gating + provisional fix

**Files:**
- Modify: `index.html` (`renderGpsHole()` confirmPanel block; `savePendingShot()` ~line 1797)

- [ ] **Step 1: Replace the `confirmPanel` block in `renderGpsHole()`**

Find the block that begins:
```javascript
  const confirmPanel=GR.pendingShot?`<div style="padding:1rem;display:flex;flex-direction:column;gap:1.1rem;border-top:1px solid var(--border)">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <div style="font-size:0.7rem;text-transform:uppercase;letter-spacing:0.07em;color:rgba(255,255,255,0.4)">Shot ${shotCount+1} — describe the shot</div>
```

And ends with:
```javascript
      </div>
    </div>`:null;
```

Replace the entire `confirmPanel` declaration with:
```javascript
  const confirmPanel=GR.pendingShot?`<div style="padding:1rem;display:flex;flex-direction:column;gap:1.1rem;border-top:1px solid var(--border)">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <div style="font-size:0.7rem;text-transform:uppercase;letter-spacing:0.07em;color:rgba(255,255,255,0.4)">Shot ${shotCount+1} — describe the shot</div>
        <div id="gpsLocStatus" style="font-size:0.7rem;color:rgba(255,255,255,0.35)">${GR.pendingShot?.locating?'📍 Locating…':''}</div>
      </div>
      <div>
        <div style="font-size:0.72rem;color:rgba(255,255,255,0.45);margin-bottom:7px;text-transform:uppercase;letter-spacing:0.05em">Shot kind</div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:6px">
          ${[{v:'normal',l:'Normal',d:'Standard shot'},{v:'drop',l:'Drop',d:'Penalty / OOB / water'},{v:'replay',l:'Replay',d:'Same spot, hit again'},{v:'provisional',l:'Provisional',d:'Ball may be lost'}].map(k=>`<button class="weight-btn shot-kind-btn${GR.pendingShot.type===k.v?' selected':''}" onclick="selectShotKind('${k.v}',this)" style="display:flex;flex-direction:column;align-items:flex-start;padding:8px 10px;height:auto;white-space:normal;text-align:left"><span style="font-weight:600;font-size:0.82rem">${k.l}</span><span style="font-size:0.68rem;color:rgba(255,255,255,0.45);margin-top:2px;font-weight:400">${k.d}</span></button>`).join('')}
        </div>
      </div>
      ${['clubs','full'].includes(GR.detailMode)?`<div>
        <div style="font-size:0.72rem;color:rgba(255,255,255,0.45);margin-bottom:7px;text-transform:uppercase;letter-spacing:0.05em">Club</div>
        <div style="display:flex;gap:6px;flex-wrap:wrap">${bag.map(c=>`<button class="club-btn${GR.selectedClub===c?' selected':''}" onclick="selectGpsClub('${c.replace(/'/g,"\\'")}',this)">${escHtml(c)}</button>`).join('')}</div>
      </div>`:''}
      ${GR.detailMode==='full'?`<div>
        <div style="font-size:0.72rem;color:rgba(255,255,255,0.45);margin-bottom:7px;text-transform:uppercase;letter-spacing:0.05em">Lie</div>
        <div style="display:flex;gap:6px;flex-wrap:wrap">${GPS_LIES.map(l=>`<button class="weight-btn lie-btn${GR.selectedLie===l.v?' selected':''}" onclick="selectGpsLie('${l.v}',this)">${l.l}</button>`).join('')}</div>
      </div>
      <div>
        <div style="font-size:0.72rem;color:rgba(255,255,255,0.45);margin-bottom:7px;text-transform:uppercase;letter-spacing:0.05em">Shot weight</div>
        <div style="display:flex;gap:6px;flex-wrap:wrap">${GPS_WEIGHTS.map(w=>`<button class="weight-btn${GR.selectedWeight===w.v?' selected':''}" onclick="selectGpsWeight('${w.v}',this)">${w.l}</button>`).join('')}</div>
      </div>
      <div>
        <div style="font-size:0.72rem;color:rgba(255,255,255,0.45);margin-bottom:7px;text-transform:uppercase;letter-spacing:0.05em">Result</div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:6px">${GPS_DIRECTIONS.map(d=>`<button class="weight-btn dir-btn${GR.selectedDirection===d.v?' selected':''}" onclick="selectGpsDirection('${d.v}',this)">${d.l}</button>`).join('')}</div>
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          <button class="weight-btn outcome-btn${GR.selectedOutcome==='lost'?' selected':''}" onclick="selectGpsOutcome('lost',this)">⚠ Lost</button>
          <button class="weight-btn outcome-btn${GR.selectedOutcome==='green'?' selected':''}" onclick="selectGpsOutcome('green',this)">⛳ Green</button>
        </div>
        <div id="outcomeNote" style="font-size:0.7rem;color:rgba(255,255,255,0.35);margin-top:5px;display:${GR.selectedOutcome?'block':'none'}">GPS distance won't be tracked for the next shot</div>
      </div>`:''}
      <div style="display:flex;gap:8px">
        <button class="btn btn-ghost btn-sm" onclick="cancelPendingShot()">Cancel</button>
        <button class="btn btn-primary" style="flex:1" onclick="savePendingShot()">Save Shot →</button>
      </div>
    </div>`:null;
```

- [ ] **Step 2: Fix `savePendingShot()` to track provisional ID and null unused fields**

In `savePendingShot()`, find:
```javascript
    const payload={
      player_id:activeId,round_date:GR.date,hole:GR.currentHole,shot_num,
      type:GR.pendingShot.type,lat:GR.pendingShot.lat,lng:GR.pendingShot.lng,
      club:GR.selectedClub,shot_weight:GR.selectedWeight,
      lie:GR.selectedLie||null,direction:GR.selectedDirection||null,shot_outcome:GR.selectedOutcome||null,
      wind_speed:currentWeather?.speed_kmh??null,wind_dir:currentWeather?.dir??null,wind_deg:currentWeather?.deg??null,
      accuracy_m:GR.currentAccuracy??null
    };
    const [saved]=await sbInsert('gps_shots',payload);
    GR.shots.push(saved||{...payload,id:Date.now()});
    GR.pendingShot=null;
```

Replace with:
```javascript
    const _mode=GR.detailMode||'full';
    const payload={
      player_id:activeId,round_date:GR.date,hole:GR.currentHole,shot_num,
      type:GR.pendingShot.type,lat:GR.pendingShot.lat,lng:GR.pendingShot.lng,
      club:['clubs','full'].includes(_mode)?GR.selectedClub:null,
      shot_weight:_mode==='full'?GR.selectedWeight:null,
      lie:_mode==='full'?(GR.selectedLie||null):null,
      direction:_mode==='full'?(GR.selectedDirection||null):null,
      shot_outcome:_mode==='full'?(GR.selectedOutcome||null):null,
      wind_speed:currentWeather?.speed_kmh??null,wind_dir:currentWeather?.dir??null,wind_deg:currentWeather?.deg??null,
      accuracy_m:GR.currentAccuracy??null
    };
    const [saved]=await sbInsert('gps_shots',payload);
    GR.shots.push(saved||{...payload,id:Date.now()});
    if(GR.pendingShot.type==='provisional')GR.provisionalShotId=(saved||payload).id;
    GR.pendingShot=null;
```

- [ ] **Step 3: Verify**

**Shots only mode** — tap 🎯 Hit:
- Confirm panel shows: Shot kind row only + Cancel/Save Shot
- No Club, Lie, Weight, Result rows

**Shots + clubs mode** — tap 🎯 Hit:
- Confirm panel shows: Shot kind row + Club row + Cancel/Save

**Full detail mode** — tap 🎯 Hit:
- Confirm panel shows: Shot kind + Club + Lie + Shot weight + Result + Cancel/Save
- Normal is pre-selected in Shot kind
- Tap Drop → Drop highlights, Normal de-highlights
- Tap Save Shot → shot saved with `type='drop'` (verify in console: `GR.shots[GR.shots.length-1].type`)

**Provisional resolution** — Full detail mode:
- Tap Hit → select Provisional → Save Shot
- Back on hole screen: "✓ Found Original" and "▶ Provisional In Play" buttons appear

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "feat: confirm panel shot kind row, mode-gated fields, provisional fix"
```

---

## Task 6: My Rounds — GPS tracking preference panel

**Files:**
- Modify: `index.html` (HTML ~line 375; `renderMyRounds()` ~line 3645)

- [ ] **Step 1: Add the `#myGpsPrefWrap` placeholder div to the HTML**

Find in the static HTML (inside `<div class="lb-view active" id="hsub-rounds">`):
```html
      </div>
    </div>
    <div class="lb-view" id="hsub-gpsstats">
```

The closing `</div></div>` just above `hsub-gpsstats` is the end of `myDreamPanel`. Replace with:
```html
      </div>
    </div>
    <div id="myGpsPrefWrap" data-open="0"></div>
    <div class="lb-view" id="hsub-gpsstats">
```

- [ ] **Step 2: Call `renderGpsPreferencePanel()` from `renderMyRounds()`**

Find the last line of `renderMyRounds()`:
```javascript
  renderMyDreamCard();}
```

Replace with:
```javascript
  renderMyDreamCard();
  renderGpsPreferencePanel();
}
```

- [ ] **Step 3: Add the three preference functions**

Immediately after `renderMyRounds()` (before the `// ── Players` comment), insert:

```javascript
function renderGpsPreferencePanel(){
  if(!activeId)return;
  const wrap=document.getElementById('myGpsPrefWrap');
  if(!wrap)return;
  const cur=getGpsDetailMode(activeId);
  const labels={gps:'GPS only',shots:'Shots only',clubs:'Shots + clubs',full:'Full detail'};
  const descs={
    gps:'Map, distances and rings. No shots recorded — use this when you just want live yardages.',
    shots:"Records each shot's GPS position and count. One confirm tap per shot, nothing else.",
    clubs:"Adds club selection to each shot. Good for tracking what you're hitting without the full detail.",
    full:'Records lie, club, shot weight and result. Full shot analysis after the round.'
  };
  const open=wrap.dataset.open==='1';
  wrap.innerHTML=`<div class="panel" style="margin-top:1.25rem">
    <div class="ph" style="cursor:pointer" onclick="toggleGpsPrefPanel()">
      <span class="pt">GPS Tracking</span>
      <div style="display:flex;align-items:center;gap:8px">
        <span style="font-size:0.78rem;padding:3px 10px;border-radius:20px;background:rgba(201,168,76,0.12);border:1px solid rgba(201,168,76,0.3);color:var(--gold-l)">${labels[cur]}</span>
        <span style="color:rgba(255,255,255,0.4);font-size:0.75rem">${open?'▲':'▼'}</span>
      </div>
    </div>
    ${open?`<div style="padding:0.75rem 1rem;display:flex;flex-direction:column;gap:8px">
      ${['gps','shots','clubs','full'].map(m=>{const sel=cur===m;return `<div onclick="chooseGpsDetailMode('${m}')" style="padding:10px 12px;border-radius:9px;cursor:pointer;border:1px solid ${sel?'rgba(201,168,76,0.5)':'rgba(255,255,255,0.12)'};background:${sel?'rgba(201,168,76,0.08)':'rgba(0,0,0,0.2)'};user-select:none"><div style="font-weight:600;font-size:0.85rem;color:${sel?'var(--gold-l)':'rgba(255,255,255,0.85)'}">${labels[m]}</div><div style="font-size:0.72rem;color:rgba(255,255,255,0.4);margin-top:3px">${descs[m]}</div></div>`;}).join('')}
    </div>`:''}
  </div>`;
}
function toggleGpsPrefPanel(){
  const wrap=document.getElementById('myGpsPrefWrap');
  if(!wrap)return;
  wrap.dataset.open=wrap.dataset.open==='1'?'0':'1';
  renderGpsPreferencePanel();
}
function chooseGpsDetailMode(mode){
  if(!activeId)return;
  setGpsDetailMode(activeId,mode);
  const wrap=document.getElementById('myGpsPrefWrap');
  if(wrap)wrap.dataset.open='0';
  renderGpsPreferencePanel();
  toast('GPS tracking preference saved');
}
```

- [ ] **Step 4: Verify**

Navigate to My Rounds. Expected:
- "GPS Tracking" panel appears below the rounds table with current mode shown as a chip
- Clicking the panel header expands to show 4 mode cards with descriptions; current mode is highlighted
- Clicking "Shots only" saves, shows toast "GPS tracking preference saved", collapses selector, chip now reads "Shots only"
- Navigate to Track Round: Tracking mode selector now defaults to "Shots only"

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "feat: My Rounds GPS tracking preference panel"
```

---

## Self-Review Checklist

**Spec coverage:**
- 4 modes (gps/shots/clubs/full) ✓ Tasks 1–5
- GR.detailMode + GR.mapOpen ✓ Task 1
- Round setup tracking selector ✓ Task 2
- Front/mid/back distances ✓ Tasks 3 & 4
- Map collapsed by default for shot modes, open for GPS mode ✓ Task 1 (mapOpen:_dm==='gps')
- 🗺 Map toggle button ✓ Task 4
- No Hit button in GPS mode ✓ Task 4
- End Hole → in GPS mode calls confirmEndHole() ✓ Task 4
- Chip & Putt not shown in GPS mode ✓ Task 4 (headerBtn logic)
- Shot kind row in confirm panel (always) ✓ Task 5
- Club gated to clubs+full ✓ Task 5
- Lie/weight/result gated to full ✓ Task 5
- Drop/Replay/Provisional removed from action screen ✓ Task 4
- selectShotKind() ✓ Task 1
- Provisional resolution still works ✓ Task 5 (savePendingShot provisional fix)
- Rings/Green auto-open map ✓ Task 4 Step 3
- Player preference in localStorage ✓ Task 1
- My Rounds preference panel ✓ Task 6
- Round setup override ✓ Task 2
- Default to 'full' for new players (backward compat) ✓ getGpsDetailMode returns 'full'
- distToGreen() single-value fallback ✓ Task 3 & 4
