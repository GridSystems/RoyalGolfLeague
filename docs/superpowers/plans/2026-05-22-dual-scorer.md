# Dual-Scorer System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow two players to independently score the same group's round, compare live, and block submission until all discrepancies are resolved.

**Architecture:** Six tasks, each buildable independently. Data lives in two new Supabase columns (`marker_id bigint`, `marker_holes jsonb`) already added to the `rounds` table. Group session persisted to `localStorage` key `sl_active_group`. Conflict state computed client-side from `HE.scores` vs `allRounds[*].marker_holes`. No websockets — each side sees updates on next patch/render cycle.

**Tech Stack:** Vanilla JS, single `index.html`, Supabase REST via `sbUpdate()`/`sbGet()`.

---

## Context for all tasks

**Key globals (defined near line 764):**
```js
let groupPlayerIds=[], playerTees={};
let HE = { playerList, scores, roundIds, currentHole, currentPidx, startHole, date, notes, teeTime };
let GR = { date, teeId, currentHole, scoringForIds, holeScores, ... };
```

**Key functions:**
- `heInit(playerList, date, notes, startHole)` — creates rounds in Supabase, sets `HE`, calls `heRender()`. Line ~1633.
- `hePatchRound(pid)` — PATCHes `holes` for one player. Line ~1658.
- `heRender()` — renders the scorecard UI including progress dots. Line ~1682.
- `startResumeEntry()` — restores HE from existing rounds without creating new ones. Line ~1976.
- `checkForResumableRounds()` — populates `#resumePanel`. Called by `showView('log')`. Line ~1863.
- `saveGroupRound()` — validates and saves all rounds. Line ~2456.
- `confirmEndHole()` — shows GPS End Hole score input. Line ~1304.
- `saveHoleScore(finishAfter)` — saves GPS hole score, advances hole. Line ~1339.
- `sbUpdate(table, id, updates)` — Supabase PATCH helper.
- `closeModal(id)` — hides a `.modal-bg` element.

**DB columns already added:**
```sql
-- Already run in Supabase:
ALTER TABLE public.rounds ADD COLUMN IF NOT EXISTS marker_id bigint;
ALTER TABLE public.rounds ADD COLUMN IF NOT EXISTS marker_holes jsonb;
```

**Repo:** `C:\Users\ChrisNel\OneDrive - Grid Systems\Repos\RoyalGolfClub\RoyalGolfClub`
**Branch:** `main`
**File:** `index.html` (all HTML + CSS + JS in one file)

All git commands must use absolute path prefix:
```bash
cd "C:\Users\ChrisNel\OneDrive - Grid Systems\Repos\RoyalGolfClub\RoyalGolfClub" &&
```

---

## Files

- Modify: `index.html` (HTML and JS sections)

---

### Task 1: Group session persistence + one-tap auto-restore

**Files:**
- Modify: `index.html`

**What this does:** Saves the active scoring group to `localStorage` when a round starts or resumes. On Log Round open, if a saved group matches today and their rounds exist and are incomplete, shows a one-tap "Resume round with [names] →" button that bypasses all setup.

- [ ] **Step 1: Add `saveActiveGroup()` helper**

Find this exact function:
```js
async function hePatchRound(pid){
```

Add immediately BEFORE it:
```js
function saveActiveGroup(){
  if(!HE||!HE.playerList||!HE.playerList.length)return;
  localStorage.setItem('sl_active_group',JSON.stringify({
    date:HE.date,
    players:HE.playerList.map(({p,teeId})=>({id:p.id,teeId:teeId||'platinum'})),
    startHole:HE.startHole,
    scorerPlayerId:activeId
  }));
}
```

- [ ] **Step 2: Call `saveActiveGroup()` at end of `heInit()`**

Find this exact line (the last two lines of `heInit`):
```js
  HE={playerList,scores,roundIds,currentHole:startHole,currentPidx:0,startHole,date,notes,teeTime:HE.teeTime||null};
  heRender();
```

Replace with:
```js
  HE={playerList,scores,roundIds,currentHole:startHole,currentPidx:0,startHole,date,notes,teeTime:HE.teeTime||null};
  saveActiveGroup();
  heRender();
```

- [ ] **Step 3: Call `saveActiveGroup()` at end of `startResumeEntry()`**

Find this exact block at the end of `startResumeEntry()`:
```js
  groupPlayerIds=playerList.map(x=>x.p.id);
  HE={playerList,scores,roundIds,currentHole:startAtHole,currentPidx:0,startHole:startAtHole,date:r.date,notes:r.notes||''};
  document.getElementById('logStep1b').style.display='none';
  document.getElementById('logStep2').style.display='block';
  resumingRound=null;resumeGroupPlayerIds=[];resumePlayerTees={};
  heRender();
```

Replace with:
```js
  groupPlayerIds=playerList.map(x=>x.p.id);
  HE={playerList,scores,roundIds,currentHole:startAtHole,currentPidx:0,startHole:startAtHole,date:r.date,notes:r.notes||''};
  document.getElementById('logStep1b').style.display='none';
  document.getElementById('logStep2').style.display='block';
  resumingRound=null;resumeGroupPlayerIds=[];resumePlayerTees={};
  saveActiveGroup();
  heRender();
```

- [ ] **Step 4: Clear `sl_active_group` on successful save**

Find this exact line inside `saveGroupRound()`:
```js
    toast(`${HE.playerList.length} round${HE.playerList.length>1?'s':''} saved ✓`);
```

Add one line immediately after it:
```js
    localStorage.removeItem('sl_active_group');
```

- [ ] **Step 5: Add `autoResumeGroup()` function**

Find this exact function:
```js
function checkForResumableRounds(){
```

Add immediately BEFORE it:
```js
async function autoResumeGroup(){
  const raw=localStorage.getItem('sl_active_group');
  if(!raw)return;
  const saved=JSON.parse(raw);
  if(saved.date!==today()){localStorage.removeItem('sl_active_group');return;}
  const td=today();
  const playerList=[];
  const scores={};
  const roundIds={};
  let startAtHole=1;
  for(const{id,teeId}of saved.players){
    const p=players.find(x=>x.id===id)||pendingPlayers.find(x=>x.id===id);
    if(!p)continue;
    const r=allRounds.find(ar=>ar.player_id===id&&ar.date===td&&ar.holes.filter(h=>h&&h.score!=null).length<18);
    if(!r)continue;
    const tee=getTee(teeId||'57');
    const index=hcpOnDate(p,td);
    const phcp=index!=null?calcPlayingHcp(index,tee):null;
    scores[id]=r.holes.map(h=>h?h.score:null);
    roundIds[id]=r.id;
    playerList.push({p,phcp,index,tee,teeId:teeId||'57'});
    if(id===saved.scorerPlayerId){
      const firstUnscored=r.holes.find(h=>h&&h.score==null);
      startAtHole=firstUnscored?firstUnscored.hole:1;
    }
  }
  if(!playerList.length){localStorage.removeItem('sl_active_group');checkForResumableRounds();return;}
  groupPlayerIds=playerList.map(x=>x.p.id);
  HE={playerList,scores,roundIds,currentHole:startAtHole,currentPidx:0,startHole:startAtHole,date:td,notes:'',teeTime:null};
  document.getElementById('logStep1').style.display='none';
  document.getElementById('logStep1b').style.display='none';
  document.getElementById('logStep2').style.display='block';
  heRender();
}
```

- [ ] **Step 6: Modify `checkForResumableRounds()` to show auto-resume button first**

Find this exact block at the start of `checkForResumableRounds()`:
```js
  const panel=document.getElementById('resumePanel');
  if(!panel)return;
  const td=today();
```

Replace with:
```js
  const panel=document.getElementById('resumePanel');
  if(!panel)return;
  const td=today();
  // One-tap auto-restore if a group session was saved today
  const raw=localStorage.getItem('sl_active_group');
  if(raw){
    try{
      const saved=JSON.parse(raw);
      if(saved.date===td&&saved.players&&saved.players.length){
        const names=saved.players.map(({id})=>players.find(x=>x.id===id)?.name?.split(' ')[0]||'?').join(', ');
        panel.style.display='block';
        panel.innerHTML=`<div style="background:rgba(130,170,240,0.1);border:2px solid rgba(130,170,240,0.4);border-radius:12px;padding:1rem 1.2rem;display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap">
          <div>
            <div style="font-weight:600;font-size:0.95rem;color:#82aaf0">🏌️ Round in progress</div>
            <div style="font-size:0.8rem;color:rgba(255,255,255,0.5);margin-top:3px">${names}</div>
          </div>
          <div style="display:flex;gap:8px">
            <button class="btn btn-ghost btn-sm" onclick="localStorage.removeItem('sl_active_group');checkForResumableRounds()">Clear</button>
            <button class="btn btn-primary btn-sm" onclick="autoResumeGroup()">Resume round →</button>
          </div>
        </div>`;
        return;
      }
    }catch(e){localStorage.removeItem('sl_active_group');}
  }
```

- [ ] **Step 7: Verify**

Open `index.html` in a browser. Start a round from Log Round. Close the tab. Reopen and navigate to Log Round — confirm the blue "Round in progress" banner appears with player names and "Resume round →" button. Click it — confirm you land directly in the scoring screen at the correct hole with all players present. Confirm "Clear" removes the banner.

- [ ] **Step 8: Commit**

```bash
cd "C:\Users\ChrisNel\OneDrive - Grid Systems\Repos\RoyalGolfClub\RoyalGolfClub" && git add index.html && git commit -m "feat: persist group session to localStorage, one-tap auto-resume on Log Round open"
```

---

### Task 2: Hole state indicators (○ / ✓ / ⚠) in progress bar

**Files:**
- Modify: `index.html`

**What this does:** Adds a `holeState(h)` function that computes per-hole conflict status when a second scorer is active. Updates the progress dots in `heRender()` to show ⚠ (amber) for conflicts, ✓ (green) for agreement, and ○ (grey) for waiting. Conflict dots open the resolution modal (Task 3) instead of jumping to that hole.

- [ ] **Step 1: Add `holeState(h)` function**

Find this exact function:
```js
function saveActiveGroup(){
```

Add immediately BEFORE it:
```js
function holeState(h){
  // Returns null (no second scorer), 'waiting' (○), 'agree' (✓), or 'conflict' (⚠)
  const hasMarker=HE.playerList.some(({p})=>{
    const r=allRounds.find(x=>x.id===HE.roundIds[p.id]);
    return r&&r.marker_holes!=null;
  });
  if(!hasMarker)return null;
  let anyConflict=false,allMatch=true;
  for(const{p}of HE.playerList){
    const r=allRounds.find(x=>x.id===HE.roundIds[p.id]);
    if(!r||!r.marker_holes){allMatch=false;continue;}
    const a=HE.scores[p.id][h-1];
    const b=r.marker_holes[h-1]?.score??null;
    if(a==null||b==null){allMatch=false;continue;}
    if(a!==b){anyConflict=true;allMatch=false;}
  }
  if(anyConflict)return'conflict';
  if(allMatch)return'agree';
  return'waiting';
}
```

- [ ] **Step 2: Update progress dots in `heRender()` to use `holeState()`**

Find this exact block inside `heRender()` (the `dots` computation):
```js
  const dots=order.map(h=>{
    const isCur=h===hole;
    const filled=s.playerList.every(({p})=>s.scores[p.id][h-1]!==null);
    const partial=s.playerList.some(({p})=>s.scores[p.id][h-1]!==null);
    let bg=filled?'var(--gold)':partial?'rgba(201,168,76,0.4)':'rgba(255,255,255,0.15)';
    if(isCur)bg='#82aaf0';
    return`<div onclick="heJump(${h})" style="width:${isCur?'24px':'10px'};height:10px;border-radius:5px;background:${bg};cursor:pointer;transition:all 0.2s;flex-shrink:0;display:flex;align-items:center;justify-content:center">${isCur?`<span style="font-size:0.55rem;font-weight:600;color:#fff">${h}</span>`:''}</div>`;
  }).join('');
```

Replace with:
```js
  const dots=order.map(h=>{
    const isCur=h===hole;
    const filled=s.playerList.every(({p})=>s.scores[p.id][h-1]!==null);
    const partial=s.playerList.some(({p})=>s.scores[p.id][h-1]!==null);
    const state=holeState(h);
    let bg;
    if(isCur){bg='#82aaf0';}
    else if(state==='conflict'){bg='rgba(240,180,60,0.85)';}
    else if(state==='agree'){bg='rgba(74,140,92,0.85)';}
    else{bg=filled?'var(--gold)':partial?'rgba(201,168,76,0.4)':'rgba(255,255,255,0.15)';}
    const clickFn=state==='conflict'?`openConflictModal(${h})`:`heJump(${h})`;
    const label=isCur?`<span style="font-size:0.55rem;font-weight:600;color:#fff">${h}</span>`:state==='conflict'?`<span style="font-size:0.55rem;font-weight:700;color:#fff">!</span>`:state==='agree'?`<span style="font-size:0.55rem;color:#fff">✓</span>`:'';
    return`<div onclick="${clickFn}" style="width:${isCur||state?'14px':'10px'};height:10px;border-radius:5px;background:${bg};cursor:pointer;transition:all 0.2s;flex-shrink:0;display:flex;align-items:center;justify-content:center">${label}</div>`;
  }).join('');
```

- [ ] **Step 3: Verify**

Open `index.html`. Start a round. In browser console, manually set a `marker_holes` value on a round in `allRounds`:
```js
const r = allRounds[0];
r.marker_holes = r.holes.map(h=>({...h}));
r.marker_holes[0].score = 99; // force conflict on hole 1
heRender();
```
Confirm hole 1 dot turns amber with `!`. Set it to match: `r.marker_holes[0].score = allRounds[0].holes[0].score; heRender()` — confirm dot turns green with `✓`.

- [ ] **Step 4: Commit**

```bash
cd "C:\Users\ChrisNel\OneDrive - Grid Systems\Repos\RoyalGolfClub\RoyalGolfClub" && git add index.html && git commit -m "feat: add holeState() and dual-scorer progress bar indicators"
```

---

### Task 3: Conflict resolution modal

**Files:**
- Modify: `index.html` (HTML and JS sections)

**What this does:** Adds a `#conflictModal` that opens when a ⚠ hole is tapped. Shows each player's "You" vs "Other" score for that hole. Each scorer can only accept the other's score on their own side. Modal auto-closes when all rows are resolved.

- [ ] **Step 1: Add `#conflictModal` HTML**

Find this exact line (the bagModal — last modal in the file):
```html
<div class="modal-bg" id="bagModal" style="display:none"><div class="modal modal-sm">
```

Add immediately AFTER the closing `</div></div>` of bagModal:
```html
<div class="modal-bg" id="conflictModal" style="display:none"><div class="modal modal-sm">
  <h3 id="conflictModalTitle">Resolve Scores</h3>
  <div id="conflictModalBody" style="display:flex;flex-direction:column;gap:10px;margin-top:0.75rem"></div>
  <div style="display:flex;justify-content:flex-end;margin-top:1rem">
    <button class="btn btn-ghost btn-sm" onclick="closeModal('conflictModal')">Close</button>
  </div>
</div></div>
```

- [ ] **Step 2: Add `openConflictModal(h)` function**

Find this exact function:
```js
function holeState(h){
```

Add immediately BEFORE it:
```js
function openConflictModal(h){
  const saved=JSON.parse(localStorage.getItem('sl_active_group')||'{}');
  const isLogScorer=!saved.scorerPlayerId||saved.scorerPlayerId===activeId;
  const par=HOLE_PARS[h-1];
  document.getElementById('conflictModalTitle').textContent=`Hole ${h} — Par ${par}`;
  const rows=HE.playerList.map(({p})=>{
    const r=allRounds.find(x=>x.id===HE.roundIds[p.id]);
    const aScore=HE.scores[p.id][h-1];
    const bScore=r?.marker_holes?.[h-1]?.score??null;
    const myScore=isLogScorer?aScore:bScore;
    const otherScore=isLogScorer?bScore:aScore;
    if(myScore==null&&otherScore==null)return'';
    const agreed=myScore!=null&&otherScore!=null&&myScore===otherScore;
    return`<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 12px;background:rgba(0,0,0,0.2);border-radius:8px;border:1px solid ${agreed?'rgba(74,140,92,0.3)':'rgba(240,180,60,0.3)'}">
      <div style="display:flex;align-items:center;gap:7px">
        <div style="width:20px;height:20px;border-radius:50%;background:${clr(p)};display:flex;align-items:center;justify-content:center;font-size:0.58rem;font-weight:700;color:#fff">${ini(p.name)}</div>
        <span style="font-size:0.85rem">${p.name.split(' ')[0]}</span>
      </div>
      <div style="display:flex;align-items:center;gap:10px;font-size:0.82rem">
        <span>You: <strong>${myScore??'—'}</strong></span>
        <span style="color:rgba(255,255,255,0.35)">Other: ${otherScore??'—'}</span>
        ${agreed?`<span style="color:#7fcc9e;font-size:0.9rem">✓</span>`
          :myScore!=null&&otherScore!=null?`<button class="btn btn-ghost btn-sm" onclick="acceptScore(${p.id},${h},${otherScore},${isLogScorer})">Accept ${otherScore}</button>`:''}
      </div>
    </div>`;
  }).filter(Boolean).join('');
  document.getElementById('conflictModalBody').innerHTML=rows||'<div style="color:rgba(255,255,255,0.4);font-size:0.85rem">No conflicts on this hole.</div>';
  document.getElementById('conflictModal').style.display='flex';
}
```

- [ ] **Step 3: Add `acceptScore()` function**

Add immediately after `openConflictModal`:
```js
async function acceptScore(pid,h,score,isLogScorer){
  const rid=HE.roundIds[pid];
  if(!rid)return;
  const r=allRounds.find(x=>x.id===rid);
  if(!r)return;
  setLoading(true,'Saving…');
  try{
    if(isLogScorer){
      HE.scores[pid][h-1]=score;
      await hePatchRound(pid);
    }else{
      const mh=r.marker_holes?r.marker_holes.map(x=>({...x})):Array.from({length:18},(_,i)=>({hole:i+1,score:null,par:HOLE_PARS[i],hcp:HOLE_HCP[i]}));
      mh[h-1]={...mh[h-1],score};
      await sbUpdate('rounds',rid,{marker_holes:mh});
      r.marker_holes=mh;
    }
    toast('Score accepted ✓');
    openConflictModal(h);
    heRender();
    // Auto-close if all rows resolved
    const allOk=HE.playerList.every(({p})=>{
      const rr=allRounds.find(x=>x.id===HE.roundIds[p.id]);
      if(!rr||!rr.marker_holes)return true;
      const a=HE.scores[p.id][h-1];
      const b=rr.marker_holes[h-1]?.score??null;
      return a==null||b==null||a===b;
    });
    if(allOk)closeModal('conflictModal');
  }catch(e){alert('Error: '+e.message);}
  finally{setLoading(false);}
}
```

- [ ] **Step 4: Verify**

Open `index.html`. Start a round with 2+ players. In console:
```js
const r = allRounds[0];
r.marker_holes = r.holes.map(h=>({...h}));
r.marker_holes[0].score = 99;
heRender();
```
Click the amber `!` dot for hole 1 — confirm modal opens showing "You: [score]  Other: 99  [Accept 99]". Click "Accept 99" — confirm your score updates, toast appears. Confirm dot turns green and modal auto-closes if all resolved.

- [ ] **Step 5: Commit**

```bash
cd "C:\Users\ChrisNel\OneDrive - Grid Systems\Repos\RoyalGolfClub\RoyalGolfClub" && git add index.html && git commit -m "feat: add conflict resolution modal with per-scorer accept flow"
```

---

### Task 4: Submit gate — block save if conflicts exist

**Files:**
- Modify: `index.html`

**What this does:** Adds `getConflicts()` helper. Calls it in `saveGroupRound()` before any saves. Blocks with a specific error message listing the conflicting holes and players.

- [ ] **Step 1: Add `getConflicts()` helper**

Find this exact function:
```js
async function saveGroupRound(){
```

Add immediately BEFORE it:
```js
function getConflicts(){
  const out=[];
  for(let h=1;h<=18;h++){
    const names=[];
    for(const{p}of HE.playerList){
      const r=allRounds.find(x=>x.id===HE.roundIds[p.id]);
      if(!r||!r.marker_holes)continue;
      const a=HE.scores[p.id][h-1];
      const b=r.marker_holes[h-1]?.score??null;
      if(a!=null&&b!=null&&a!==b)names.push(p.name.split(' ')[0]);
    }
    if(names.length)out.push({hole:h,names});
  }
  return out;
}
```

- [ ] **Step 2: Add conflict check at the top of `saveGroupRound()`**

Find this exact line at the start of `saveGroupRound()`:
```js
  heFlushInputs();
  // Validate minimum holes
```

Replace with:
```js
  heFlushInputs();
  // Block save if dual-scorer conflicts exist
  const conflicts=getConflicts();
  if(conflicts.length){
    alert('Cannot save — unresolved conflicts on '+conflicts.map(c=>`Hole ${c.hole} (${c.names.join(', ')})`).join(', '));
    return;
  }
  // Validate minimum holes
```

- [ ] **Step 3: Verify**

In console, force a conflict:
```js
const r = allRounds[0];
r.marker_holes = r.holes.map(h=>({...h}));
r.marker_holes[2].score = 99; // hole 3
```
Try to click "Save All Rounds" — confirm alert fires: `Cannot save — unresolved conflicts on Hole 3 (...)`. Resolve in console: `r.marker_holes[2].score = HE.scores[r.player_id][2]` — confirm save proceeds normally.

- [ ] **Step 4: Commit**

```bash
cd "C:\Users\ChrisNel\OneDrive - Grid Systems\Repos\RoyalGolfClub\RoyalGolfClub" && git add index.html && git commit -m "feat: block saveGroupRound if dual-scorer conflicts remain"
```

---

### Task 5: GPS "Scoring for" picker at session setup

**Files:**
- Modify: `index.html`

**What this does:** Adds a "Scoring for" section to the GPS setup screen. Shows players with rounds today at the same tee time as the GPS tracker's own round (falling back to all today's rounds if no tee time match). Selection stored in `GR.scoringForIds`.

- [ ] **Step 1: Add `buildScoringForList(date)` helper**

Find this exact function:
```js
function renderGpsStart(){
```

Add immediately BEFORE it:
```js
function buildScoringForList(date){
  const td=date||today();
  const myRound=allRounds.find(r=>r.player_id===activeId&&r.date===td);
  const myTeeTime=myRound?.tee_time||null;
  const seen=new Set();
  return allRounds.filter(r=>{
    if(r.player_id===activeId)return false;
    if(r.date!==td)return false;
    if(myTeeTime&&r.tee_time&&r.tee_time!==myTeeTime)return false;
    if(seen.has(r.player_id))return false;
    seen.add(r.player_id);
    return true;
  }).map(r=>{
    const p=players.find(x=>x.id===r.player_id);
    return p?{p,roundId:r.id}:null;
  }).filter(Boolean);
}
```

- [ ] **Step 2: Add `GR.scoringForIds` to GR initial state in `startGpsRound()`**

Find this exact line:
```js
    GR={
      date,teeId:gpsTeeId,currentHole:startHole,
      selectedClub:null,selectedWeight:'full',selectedLie:'fairway',selectedDirection:null,selectedOutcome:null,
      pendingShot:null,
```

Replace with:
```js
    GR={
      date,teeId:gpsTeeId,currentHole:startHole,
      selectedClub:null,selectedWeight:'full',selectedLie:'fairway',selectedDirection:null,selectedOutcome:null,
      pendingShot:null,scoringForIds:[],
```

- [ ] **Step 3: Add "Scoring for" section to `renderGpsStart()`**

Find this exact block inside `renderGpsStart()`:
```html
        <div style="display:flex;gap:10px;justify-content:flex-end">
          <button class="btn btn-primary" onclick="startGpsRound()">Start Tracking →</button>
        </div>
```

Replace with:
```html
        ${(()=>{const date=document.getElementById('gpsDate')?.value||today();const list=buildScoringForList(date);return list.length?`<div>
          <label style="font-size:0.78rem;color:rgba(255,255,255,0.5);text-transform:uppercase;letter-spacing:0.05em">Scoring for</label>
          <div style="display:flex;flex-direction:column;gap:6px;margin-top:6px" id="scoringForList">
            ${list.map(({p})=>`<div onclick="toggleScoringFor(${p.id},this)" style="display:flex;align-items:center;gap:8px;padding:7px 12px;border-radius:8px;cursor:pointer;border:1px solid rgba(255,255,255,0.12);background:rgba(0,0,0,0.2);user-select:none" data-pid="${p.id}">
              <div style="width:20px;height:20px;border-radius:50%;background:${clr(p)};display:flex;align-items:center;justify-content:center;font-size:0.58rem;font-weight:700;color:#fff">${ini(p.name)}</div>
              <span style="font-size:0.85rem;flex:1">${p.name}</span>
              <span class="sfcheck" style="width:18px;text-align:center;color:var(--gold);font-size:0.8rem"></span>
            </div>`).join('')}
          </div>
        </div>`:'';})()}
        <div style="display:flex;gap:10px;justify-content:flex-end">
          <button class="btn btn-primary" onclick="startGpsRound()">Start Tracking →</button>
        </div>
```

- [ ] **Step 4: Add `toggleScoringFor()` function**

Find this exact function:
```js
function buildScoringForList(date){
```

Add immediately BEFORE it:
```js
let _gpsScoreForIds=[];
function toggleScoringFor(pid,el){
  const idx=_gpsScoreForIds.indexOf(pid);
  if(idx===-1){
    _gpsScoreForIds.push(pid);
    el.style.border='1px solid rgba(201,168,76,0.5)';
    el.style.background='rgba(201,168,76,0.1)';
    el.querySelector('.sfcheck').textContent='✓';
  }else{
    _gpsScoreForIds.splice(idx,1);
    el.style.border='1px solid rgba(255,255,255,0.12)';
    el.style.background='rgba(0,0,0,0.2)';
    el.querySelector('.sfcheck').textContent='';
  }
}
```

- [ ] **Step 5: Pass `_gpsScoreForIds` into `GR` in `startGpsRound()`**

Find this exact line inside `startGpsRound()`:
```js
      pendingShot:null,scoringForIds:[],
```

Replace with:
```js
      pendingShot:null,scoringForIds:[..._gpsScoreForIds],
```

And add a reset after:
Find:
```js
    GR.shots=await sbGet('gps_shots',`player_id=eq.${activeId}&round_date=eq.${date}&order=hole.asc,shot_num.asc`);
```
Add one line immediately after:
```js
    _gpsScoreForIds=[];
```

- [ ] **Step 6: Verify**

Open GPS tracker tab. Confirm "Scoring for" checklist appears when other players have rounds today. Tick a player — confirm gold highlight and ✓. Untick — confirms back to grey. Start tracking — confirm `GR.scoringForIds` contains the selected IDs (check in console: `GR.scoringForIds`).

- [ ] **Step 7: Commit**

```bash
cd "C:\Users\ChrisNel\OneDrive - Grid Systems\Repos\RoyalGolfClub\RoyalGolfClub" && git add index.html && git commit -m "feat: add Scoring For picker to GPS setup, stored in GR.scoringForIds"
```

---

### Task 6: GPS End Hole — per-player marker score entry

**Files:**
- Modify: `index.html`

**What this does:** After the GPS tracker confirms their own gross score at End Hole, the app steps through each player in `GR.scoringForIds` showing a score input. On confirm, patches `marker_holes[h-1].score` and sets `marker_id` on that player's round in Supabase.

- [ ] **Step 1: Add `renderMarkerScoring(idx)` function**

Find this exact function:
```js
async function finishGpsRound(){
```

Add immediately BEFORE it:
```js
function renderMarkerScoring(idx){
  if(!GR||!GR.scoringForIds||idx>=GR.scoringForIds.length){
    // All players done — advance hole or finish
    if(GR._pendingFinish){GR._pendingFinish=false;finishGpsRound();return;}
    if(GR.currentHole<18){
      GR.currentHole++;
      GR.provisionalShotId=null;
      renderGpsHole();
    }else{
      finishGpsRound();
    }
    return;
  }
  const pid=GR.scoringForIds[idx];
  const p=players.find(x=>x.id===pid);
  if(!p){renderMarkerScoring(idx+1);return;}
  const hole=GR.currentHole;
  const par=HOLE_PARS[hole-1];
  const el=document.getElementById('trackContent');
  el.innerHTML=`
    <div class="panel">
      <div class="ph"><span class="pt">Score for ${p.name}</span></div>
      <div class="pb" style="display:flex;flex-direction:column;gap:16px">
        <div class="stats-row">
          <div class="sc"><div class="sl">Hole</div><div class="sv">${hole}</div></div>
          <div class="sc"><div class="sl">Par</div><div class="sv">${par}</div></div>
        </div>
        <div class="fgi">
          <label>Gross Score for ${p.name}</label>
          <input type="number" id="markerScoreInput" value="${par}" min="1" max="20" inputmode="numeric">
        </div>
        <div class="fa">
          <button class="btn btn-ghost" onclick="renderMarkerScoring(${idx+1})">Skip</button>
          <button class="btn btn-primary" onclick="saveMarkerHoleScore(${pid},${idx})">
            ${idx<GR.scoringForIds.length-1?'Next Player →':'Done ✓'}
          </button>
        </div>
      </div>
    </div>`;
  setTimeout(()=>{const i=document.getElementById('markerScoreInput');if(i){i.focus();i.select();}},50);
}
async function saveMarkerHoleScore(pid,idx){
  const val=parseInt(document.getElementById('markerScoreInput').value,10);
  if(!val||val<1){alert('Enter a valid score.');return;}
  const hole=GR.currentHole;
  const r=allRounds.find(x=>x.player_id===pid&&x.date===GR.date&&x.holes.filter(h=>h&&h.score!=null).length<18);
  if(!r){
    const p=players.find(x=>x.id===pid);
    toast(`No active round for ${p?.name||pid} — skipping`);
    renderMarkerScoring(idx+1);
    return;
  }
  setLoading(true,'Saving…');
  try{
    const mh=r.marker_holes?r.marker_holes.map(x=>({...x})):Array.from({length:18},(_,i)=>({hole:i+1,score:null,par:HOLE_PARS[i],hcp:HOLE_HCP[i]}));
    mh[hole-1]={...mh[hole-1],score:val};
    const updates={marker_holes:mh};
    if(!r.marker_id)updates.marker_id=activeId;
    await sbUpdate('rounds',r.id,updates);
    r.marker_holes=mh;
    if(!r.marker_id)r.marker_id=activeId;
  }catch(e){alert('Error saving score: '+e.message);}
  finally{setLoading(false);}
  renderMarkerScoring(idx+1);
}
```

- [ ] **Step 2: Modify `saveHoleScore()` to trigger marker scoring flow**

Find this exact function:
```js
function saveHoleScore(finishAfter=false){
  const val=parseInt(document.getElementById('holeScoreInput').value,10);
  if(!val||val<1){alert('Enter a valid score.');return;}
  GR.holeScores[GR.currentHole]=val;
  if(!finishAfter&&GR.currentHole<18){
    GR.currentHole++;
    GR.provisionalShotId=null;
    renderGpsHole();
  } else {
    finishGpsRound();
  }
}
```

Replace with:
```js
function saveHoleScore(finishAfter=false){
  const val=parseInt(document.getElementById('holeScoreInput').value,10);
  if(!val||val<1){alert('Enter a valid score.');return;}
  GR.holeScores[GR.currentHole]=val;
  GR._pendingFinish=finishAfter||(GR.currentHole>=18);
  if(GR.scoringForIds&&GR.scoringForIds.length>0){
    renderMarkerScoring(0);
  }else if(!finishAfter&&GR.currentHole<18){
    GR.currentHole++;
    GR.provisionalShotId=null;
    renderGpsHole();
  }else{
    finishGpsRound();
  }
}
```

- [ ] **Step 3: Verify end-to-end**

a. Start a GPS round with `scoringForIds` containing a player who has a round today.
b. Record shots on hole 1, tap "End Hole →".
c. Confirm your own score input appears first.
d. Tap "Next Hole →" (or whatever the button says).
e. Confirm the "Score for [Name]" screen appears with par pre-filled.
f. Enter a score, confirm "Done ✓".
g. Confirm you advance to hole 2.
h. In Supabase Table Editor, confirm `marker_holes[0].score` on that player's round is set and `marker_id` is your player ID.
i. In the Log Round tab, confirm the hole 1 dot shows amber `!` if scores differ, green `✓` if they match.

- [ ] **Step 4: Commit**

```bash
cd "C:\Users\ChrisNel\OneDrive - Grid Systems\Repos\RoyalGolfClub\RoyalGolfClub" && git add index.html && git commit -m "feat: GPS End Hole steps through marker scores for each player in scoringForIds"
```

---

## Self-review

**Spec coverage:**
- ✅ `marker_id` + `marker_holes` columns — Task 1 (DB already done, referenced throughout)
- ✅ `sl_active_group` localStorage save/restore — Task 1
- ✅ One-tap auto-resume button — Task 1 Step 6
- ✅ Clear on `saveGroupRound` success — Task 1 Step 4
- ✅ `holeState()` ○/✓/⚠ logic — Task 2 Step 1
- ✅ Progress bar indicators — Task 2 Step 2
- ✅ Resolution modal — Task 3
- ✅ Accept own side only — Task 3 Step 3 (`isLogScorer` flag)
- ✅ Auto-close modal when resolved — Task 3 Step 3
- ✅ Submit gate — Task 4
- ✅ "Scoring for" picker filtered by tee time — Task 5
- ✅ Per-player marker scoring in GPS End Hole — Task 6
- ✅ `marker_id` set on first marker score — Task 6 Step 1

**No placeholders found.**

**Type consistency:**
- `holeState()` returns `null|'waiting'|'agree'|'conflict'` — used consistently in Tasks 2, 3, 4.
- `GR.scoringForIds` is `number[]` — set in Task 5, consumed in Task 6.
- `acceptScore(pid, h, score, isLogScorer)` — all four params explicit at every call site.
- `saveMarkerHoleScore(pid, idx)` — idx used only to chain to `renderMarkerScoring(idx+1)`.
