# Tournament Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a two-team match-play tournament (fourball betterball + singles) with live hole-by-hole scoring, captain's alternating pick draw, and Ryder Cup-style leaderboard.

**Architecture:** All code lives in `index.html` (single file, vanilla JS, no build step). Four new Supabase tables store tournament data. A new Tournament nav tab shows leaderboard, captain's draw, or scoring screen depending on state. Captain identity = active player (no extra PIN). One scorer per match, any device can score.

**Tech Stack:** Vanilla JS, Supabase REST API, HTML/CSS inline styles (matching existing app patterns). Existing helpers: `sbGet`, `sbInsert`, `sbUpdate`, `sbDelete`, `hcpOnDate`, `HOLE_HCP`, `HOLE_PARS`, `COURSE_PAR`, `clr`, `ini`, `toast`, `isAdmin`.

**Spec:** `docs/superpowers/specs/2026-06-28-tournament-mode-design.md`

---

## Files Modified

- `index.html` — all feature code (globals, helpers, HTML, render functions)
- `supabase/grants.sql` — 4 new table grants

---

## Prerequisite: Run SQL Migration in Supabase

Before any code changes, run this in the Supabase SQL Editor:

```sql
CREATE TABLE IF NOT EXISTS public.tournaments (
  id bigint PRIMARY KEY,
  name text NOT NULL,
  date text NOT NULL,
  tee_id text NOT NULL,
  status text NOT NULL DEFAULT 'setup',
  team_a_name text NOT NULL DEFAULT 'Team A',
  team_b_name text NOT NULL DEFAULT 'Team B',
  team_a_captain_id bigint,
  team_b_captain_id bigint,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.tournament_players (
  id bigint PRIMARY KEY,
  tournament_id bigint NOT NULL REFERENCES public.tournaments(id),
  player_id bigint NOT NULL,
  team text NOT NULL CHECK (team IN ('a','b'))
);

CREATE TABLE IF NOT EXISTS public.tournament_matches (
  id bigint PRIMARY KEY,
  tournament_id bigint NOT NULL REFERENCES public.tournaments(id),
  round int NOT NULL,
  match_num int NOT NULL,
  team_a_p1_id bigint,
  team_a_p2_id bigint,
  team_b_p1_id bigint,
  team_b_p2_id bigint,
  status text NOT NULL DEFAULT 'pending',
  result text,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.tournament_scores (
  id bigint PRIMARY KEY,
  match_id bigint NOT NULL REFERENCES public.tournament_matches(id),
  hole int NOT NULL,
  player_id bigint NOT NULL,
  gross int NOT NULL
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.tournaments         TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tournament_players  TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tournament_matches  TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tournament_scores   TO anon, authenticated;
```

---

## Task 1: Grants file + data globals + loadData

**Files:** `supabase/grants.sql`, `index.html`

- [ ] **Step 1: Add grants to supabase/grants.sql**

Read `supabase/grants.sql`, then append after the last existing GRANT line:

```sql
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tournaments         TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tournament_players  TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tournament_matches  TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tournament_scores   TO anon, authenticated;
```

- [ ] **Step 2: Add globals**

In `index.html`, find the line that declares `let saturdayEvents=[],saturdaySignups=[];` (around line 803). Add immediately after it:

```js
let tournaments=[],tournamentPlayers=[],tournamentMatches=[],tournamentScores=[];
let activeTournamentId=null;
```

- [ ] **Step 3: Add sbDeleteWhere helper**

Find the `sbDelete` function (around line 748). Add immediately after it:

```js
async function sbDeleteWhere(t,filter){
  const r=await fetch(`${SUPABASE_URL}/rest/v1/${t}?${filter}`,{method:'DELETE',headers:H});
  if(!r.ok)throw new Error(await r.text());
}
```

- [ ] **Step 4: Add tournament data loading to loadData()**

In `loadData()`, after the `saturdaySignups` try/catch block, add:

```js
try{tournaments=await sbGet('tournaments','order=created_at.desc');}catch(e){tournaments=[];}
try{tournamentPlayers=await sbGet('tournament_players','order=id.asc');}catch(e){tournamentPlayers=[];}
try{tournamentMatches=await sbGet('tournament_matches','order=round.asc,match_num.asc');}catch(e){tournamentMatches=[];}
try{tournamentScores=await sbGet('tournament_scores','order=id.asc');}catch(e){tournamentScores=[];}
if(tournaments.length>0&&!activeTournamentId)activeTournamentId=tournaments[0].id;
```

- [ ] **Step 5: Verify**

Open the app in browser. Open DevTools console. Reload the page. Confirm no errors about tournament tables. Check `window.tournaments` in console — should be `[]` (until a tournament is created).

- [ ] **Step 6: Commit**

```bash
git add index.html supabase/grants.sql
git commit -m "feat(tournament): globals, loadData, sbDeleteWhere helper"
```

---

## Task 2: Handicap and match computation helpers

**Files:** `index.html`

These pure functions compute strokes, stableford points, hole results, and match state. They have no side effects and don't touch the DOM.

- [ ] **Step 1: Add helpers after `hcpOnDate`**

Find `function hcpOnDate` (around line 888). Add the following block immediately after the closing `}` of `hcpOnDate`:

```js
// ── Tournament helpers ────────────────────────────────────────────
function tmPlayingHcp(player,tee,date){
  const idx=hcpOnDate(player,date);
  const courseHcp=Math.round(idx*tee.slope/113+(tee.rating-COURSE_PAR));
  return Math.round(courseHcp*0.90);
}

// Returns {receivingTeam:'a'|'b', diff, strokeHoles:[0-indexed hole indices], phA1,phA2,phB1,phB2}
// Works for both fourball (p2 ids set) and singles (p2 ids null)
function tmMatchHcpInfo(match,date){
  const getP=id=>players.find(p=>p.id===id);
  const tee=tees.find(t=>t.id===match._teeId)||{slope:113,rating:COURSE_PAR}; // _teeId injected at render
  const phA1=match.team_a_p1_id?tmPlayingHcp(getP(match.team_a_p1_id),tee,date):0;
  const phA2=match.team_a_p2_id?tmPlayingHcp(getP(match.team_a_p2_id),tee,date):0;
  const phB1=match.team_b_p1_id?tmPlayingHcp(getP(match.team_b_p1_id),tee,date):0;
  const phB2=match.team_b_p2_id?tmPlayingHcp(getP(match.team_b_p2_id),tee,date):0;
  const combA=phA1+phA2,combB=phB1+phB2;
  const diff=Math.abs(combA-combB);
  const receivingTeam=combA>=combB?'a':'b';
  const strokeHoles=HOLE_HCP.map((si,i)=>({si,i})).filter(({si})=>si<=diff).map(({i})=>i);
  return{receivingTeam,diff,strokeHoles,combA,combB,phA1,phA2,phB1,phB2};
}

function tmPlayerPts(gross,par,hasStroke){
  if(gross==null)return null;
  return Math.max(0,2+par+(hasStroke?1:0)-gross);
}

// holeIdx is 0-based. Returns {aScore,bScore,result:'a'|'b'|'half'|null, ptsA1,ptsA2,ptsB1,ptsB2}
function tmHoleResult(holeIdx,match,hcpInfo,grossByPid){
  const par=HOLE_PARS[holeIdx];
  const isStroke=hcpInfo.strokeHoles.includes(holeIdx);
  const ptsA1=tmPlayerPts(grossByPid[match.team_a_p1_id],par,isStroke&&hcpInfo.receivingTeam==='a');
  const ptsA2=match.team_a_p2_id!=null?tmPlayerPts(grossByPid[match.team_a_p2_id],par,isStroke&&hcpInfo.receivingTeam==='a'):null;
  const ptsB1=tmPlayerPts(grossByPid[match.team_b_p1_id],par,isStroke&&hcpInfo.receivingTeam==='b');
  const ptsB2=match.team_b_p2_id!=null?tmPlayerPts(grossByPid[match.team_b_p2_id],par,isStroke&&hcpInfo.receivingTeam==='b'):null;
  const aScore=ptsA2!=null?Math.max(ptsA1??-1,ptsA2??-1):ptsA1;
  const bScore=ptsB2!=null?Math.max(ptsB1??-1,ptsB2??-1):ptsB1;
  if(aScore==null||bScore==null)return{aScore,bScore,result:null,ptsA1,ptsA2,ptsB1,ptsB2};
  const result=aScore>bScore?'a':bScore>aScore?'b':'half';
  return{aScore,bScore,result,ptsA1,ptsA2,ptsB1,ptsB2};
}

// Returns {holesWon:{a,b,half}, matchStatus (positive=A up), holesPlayed, holesRemaining, holeResults:[]}
function tmMatchState(match,hcpInfo,scores){
  // scores: tournament_scores rows for this match
  const holesWon={a:0,b:0,half:0};
  const holeResults=[];
  let holesPlayed=0;
  const playerIds=[match.team_a_p1_id,match.team_b_p1_id];
  if(match.team_a_p2_id)playerIds.push(match.team_a_p2_id);
  if(match.team_b_p2_id)playerIds.push(match.team_b_p2_id);
  for(let i=0;i<18;i++){
    const grossByPid={};
    let complete=true;
    for(const pid of playerIds){
      const s=scores.find(s=>s.player_id===pid&&s.hole===i+1);
      if(!s){complete=false;break;}
      grossByPid[pid]=s.gross;
    }
    if(!complete){holeResults.push(null);continue;}
    const hr=tmHoleResult(i,match,hcpInfo,grossByPid);
    holeResults.push(hr);
    if(hr.result){holesWon[hr.result]++;holesPlayed++;}
  }
  const matchStatus=holesWon.a-holesWon.b;
  const holesRemaining=18-holesPlayed;
  return{holesWon,matchStatus,holesPlayed,holesRemaining,holeResults};
}

// Returns display string: "3&2" | "A/S F" | "2UP H14" | "—"
function tmResultLabel(match,hcpInfo,scores){
  if(!match.team_a_p1_id||!match.team_b_p1_id)return'—';
  if(match.status==='pending'&&match.result==null)return'—';
  const{holesWon,matchStatus,holesPlayed,holesRemaining}=tmMatchState(match,hcpInfo,scores);
  if(match.status==='complete'){
    if(match.result==='half')return'A/S F';
    const up=Math.abs(matchStatus);
    return holesRemaining>0?`${up}&${holesRemaining}`:`${up}UP`;
  }
  if(match.status==='in_progress'){
    if(matchStatus===0)return`A/S H${holesPlayed+1}`;
    return`${Math.abs(matchStatus)}UP H${holesPlayed+1}`;
  }
  return'—';
}
// ── End tournament helpers ────────────────────────────────────────
```

- [ ] **Step 2: Inject _teeId onto matches at load time**

In `loadData()`, after the `tournamentScores` line, add:

```js
// Inject tee info onto matches so tmMatchHcpInfo can find it
tournamentMatches.forEach(m=>{
  const tourn=tournaments.find(t=>t.id===m.tournament_id);
  if(tourn)m._teeId=tourn.tee_id;
});
```

- [ ] **Step 3: Verify helpers in console**

Open browser DevTools. After page load, run:

```js
// Should return a number (playing HCP for first player)
const p = players[0]; const t = tees[0];
console.log(tmPlayingHcp(p, t, '2026-06-28'));
```

Expected: a number (no error).

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "feat(tournament): handicap + match computation helpers"
```

---

## Task 3: Navigation tab + view HTML

**Files:** `index.html`

- [ ] **Step 1: Add Tournament nav tab**

Find the nav HTML block (around line 211). It ends with `<button class="nav-tab" id="adminTab"...>⚙ Admin</button>`. Add a new tab BEFORE the admin tab:

```html
<button class="nav-tab" id="tabTournament" style="display:none" onclick="showView('tournament',this)">🏆 Tournament</button>
```

- [ ] **Step 2: Add tournament view div**

Find the last `<div class="view" id="view-...">` block before the closing `</main>` or equivalent. Add this view after the last existing view:

```html
<div class="view" id="view-tournament">
  <div id="tournamentContent"></div>
</div>
```

- [ ] **Step 3: Wire showView for tournament**

In the `showView` function (around line 1019), add inside the if-chain:

```js
if(id==='tournament'){renderTournament();}
```

- [ ] **Step 4: Add tab visibility update**

Find the `init` function or wherever `loadData()` is called and then the UI is set up after page load. After `await loadData()`, add:

```js
document.getElementById('tabTournament').style.display=tournaments.length>0?'':'none';
```

Also add a stub `renderTournament` so the tab doesn't crash when clicked:

```js
function renderTournament(){
  const el=document.getElementById('tournamentContent');
  if(!el)return;
  el.innerHTML='<p style="padding:1rem;color:rgba(255,255,255,0.5)">Loading tournament…</p>';
}
```

- [ ] **Step 5: Verify**

Open app. If no tournaments in DB yet: Tournament tab hidden. Create a row in Supabase `tournaments` table directly (any values). Reload — Tournament tab should appear. Click it — should show "Loading tournament…" without errors.

- [ ] **Step 6: Commit**

```bash
git add index.html
git commit -m "feat(tournament): nav tab + view HTML stub"
```

---

## Task 4: Tournament leaderboard

**Files:** `index.html`

Replace the `renderTournament` stub with the full leaderboard. This is the main public-facing view.

- [ ] **Step 1: Add tournament selector and leaderboard render**

Replace the stub `renderTournament` function with:

```js
function renderTournament(){
  const el=document.getElementById('tournamentContent');
  if(!el)return;
  if(tournaments.length===0){el.innerHTML='<p style="padding:1rem;color:rgba(255,255,255,0.5)">No tournaments yet.</p>';return;}

  // Selector if multiple
  let selectorHtml='';
  if(tournaments.length>1){
    selectorHtml=`<div style="margin-bottom:1rem"><select onchange="activeTournamentId=parseInt(this.value);renderTournament()" style="background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.15);border-radius:7px;padding:0.4rem 0.75rem;color:#fff;font-size:0.85rem">
      ${tournaments.map(t=>`<option value="${t.id}"${t.id===activeTournamentId?' selected':''}>${t.name} (${t.date})</option>`).join('')}
    </select></div>`;
  }

  const tourn=tournaments.find(t=>t.id===activeTournamentId)||tournaments[0];
  activeTournamentId=tourn.id;

  // Draw phase — show draw screen for captains, read-only for others
  if(tourn.status==='fourball_draw'||tourn.status==='singles_draw'){
    el.innerHTML=selectorHtml+renderTournamentDrawHtml(tourn);
    wireTournamentDrawEvents(tourn);
    return;
  }

  // Scoring/complete — show leaderboard
  el.innerHTML=selectorHtml+renderTournamentLeaderboardHtml(tourn);
}

function renderTournamentLeaderboardHtml(tourn){
  const tPlayers=tournamentPlayers.filter(tp=>tp.tournament_id===tourn.id);
  const tMatches=tournamentMatches.filter(m=>m.tournament_id===tourn.id);
  const r1Matches=tMatches.filter(m=>m.round===1);
  const r2Matches=tMatches.filter(m=>m.round===2);

  // Team score (completed matches only)
  let aScore=0,bScore=0;
  tMatches.filter(m=>m.status==='complete').forEach(m=>{
    if(m.result==='a')aScore+=1;
    else if(m.result==='b')bScore+=1;
    else if(m.result==='half'){aScore+=0.5;bScore+=0.5;}
  });

  const adminBtn=isAdmin()&&tourn.status==='setup'?`<button class="btn btn-ghost btn-sm" onclick="showView('admin',null)" style="float:right;font-size:0.75rem">⚙ Edit</button>`:'';
  const resetBtn=isAdmin()&&tourn.status==='complete'?`<button class="btn btn-ghost btn-sm" onclick="resetTournament(${tourn.id})" style="float:right;font-size:0.75rem;color:rgba(220,80,80,0.8)">🗑 Reset</button>`:'';

  // Determine active round tab
  const activeRound=tourn.status==='round_2'||tourn.status==='singles_draw'||tourn.status==='complete'?2:1;

  return`
  <div style="margin-bottom:1rem">
    ${adminBtn}${resetBtn}
    <h2 style="font-family:'Playfair Display',serif;font-size:1.3rem;margin:0 0 0.25rem">${tourn.name}</h2>
    <div style="font-size:0.8rem;color:rgba(255,255,255,0.5)">${tourn.date} · ${tees.find(t=>t.id===tourn.tee_id)?.name||tourn.tee_id}</div>
  </div>

  <!-- Team score header -->
  <div style="display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:0.5rem;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.1);border-radius:10px;padding:1rem;margin-bottom:1rem;text-align:center">
    <div style="font-size:1rem;font-weight:700;color:#e8534a">${tourn.team_a_name}</div>
    <div style="font-size:2rem;font-weight:700;letter-spacing:0.1em">${aScore} – ${bScore}</div>
    <div style="font-size:1rem;font-weight:700;color:#4a90e8">${tourn.team_b_name}</div>
  </div>

  <!-- Round tabs -->
  <div style="display:flex;gap:0.5rem;margin-bottom:0.75rem">
    <button onclick="tmSetRoundTab(1,this)" class="sub-tab${activeRound===1?' active':''}" id="tmTabR1">Fourballs</button>
    <button onclick="tmSetRoundTab(2,this)" class="sub-tab${activeRound===2?' active':''}" id="tmTabR2">Singles</button>
  </div>

  <div id="tmRoundContent">
    ${renderTournamentMatchRows(tourn,activeRound===1?r1Matches:r2Matches,tourn,activeRound)}
  </div>`;
}

function tmSetRoundTab(round,btn){
  document.querySelectorAll('#view-tournament .sub-tab').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  const tourn=tournaments.find(t=>t.id===activeTournamentId);
  if(!tourn)return;
  const tMatches=tournamentMatches.filter(m=>m.tournament_id===tourn.id&&m.round===round);
  document.getElementById('tmRoundContent').innerHTML=renderTournamentMatchRows(tourn,tMatches,tourn,round);
}

function renderTournamentMatchRows(tourn,matches,_unused,round){
  if(matches.length===0){
    if((round===1&&(tourn.status==='setup'||tourn.status==='fourball_draw'))||
       (round===2&&['setup','fourball_draw','round_1','singles_draw'].includes(tourn.status))){
      return`<div style="color:rgba(255,255,255,0.4);font-size:0.85rem;padding:0.5rem 0">Draw not yet complete</div>`;
    }
    return`<div style="color:rgba(255,255,255,0.4);font-size:0.85rem;padding:0.5rem 0">No matches</div>`;
  }

  return matches.map(match=>{
    const mScores=tournamentScores.filter(s=>s.match_id===match.id);
    const hcpInfo=tmMatchHcpInfo(match,tourn.date);
    const state=tmMatchState(match,hcpInfo,mScores);
    const label=tmResultLabel(match,hcpInfo,mScores);
    const isLive=match.status==='in_progress';
    const isDone=match.status==='complete';

    const pName=id=>{const p=players.find(p=>p.id===id);return p?p.name.split(' ')[0]:'?';};
    const pColor=id=>{const p=players.find(p=>p.id===id);return p?clr(p):'#666';};
    const dot=(id)=>`<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${pColor(id)};margin-right:4px"></span>`;

    const aWin=isDone&&match.result==='a';
    const bWin=isDone&&match.result==='b';
    const liveAUp=isLive&&state.matchStatus>0;
    const liveBUp=isLive&&state.matchStatus<0;
    const aBg=aWin||liveAUp?'rgba(232,83,74,0.18)':'transparent';
    const bBg=bWin||liveBUp?'rgba(74,144,232,0.18)':'transparent';
    const halfBg=isDone&&match.result==='half'?'rgba(255,255,255,0.06)':'transparent';

    const aNames=match.team_a_p1_id
      ?`${dot(match.team_a_p1_id)}${pName(match.team_a_p1_id)}${match.team_a_p2_id?` / ${dot(match.team_a_p2_id)}${pName(match.team_a_p2_id)}`:''}`
      :'<span style="color:rgba(255,255,255,0.3)">—</span>';
    const bNames=match.team_b_p1_id
      ?`${dot(match.team_b_p1_id)}${pName(match.team_b_p1_id)}${match.team_b_p2_id?` / ${dot(match.team_b_p2_id)}${pName(match.team_b_p2_id)}`:''}`
      :'<span style="color:rgba(255,255,255,0.3)">—</span>';

    const canScore=match.team_a_p1_id&&match.team_b_p1_id&&(match.status==='pending'||match.status==='in_progress');
    const clickHandler=canScore?`onclick="teOpenMatch(${match.id})" style="cursor:pointer"`:'';

    // Hole strip for live matches
    let holeStrip='';
    if(isLive){
      const dots=state.holeResults.map((hr,i)=>{
        if(!hr)return`<span style="display:inline-block;width:16px;height:16px;border-radius:3px;background:rgba(255,255,255,0.08);font-size:0.6rem;line-height:16px;text-align:center;color:rgba(255,255,255,0.3)">${i+1}</span>`;
        const c=hr.result==='a'?'rgba(232,83,74,0.7)':hr.result==='b'?'rgba(74,144,232,0.7)':'rgba(255,255,255,0.25)';
        const lbl=hr.result==='a'?'S':hr.result==='b'?'L':'½';
        return`<span style="display:inline-block;width:16px;height:16px;border-radius:3px;background:${c};font-size:0.6rem;line-height:16px;text-align:center;font-weight:600">${lbl}</span>`;
      }).join('');
      holeStrip=`<div style="padding:0.35rem 0.75rem;display:flex;gap:2px;flex-wrap:wrap">${dots}</div>`;
    }

    const statusColor=isLive?'#f5c518':isDone?'rgba(255,255,255,0.6)':'rgba(255,255,255,0.3)';

    return`<div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:10px;margin-bottom:0.5rem;overflow:hidden">
      <div style="display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:0.5rem;padding:0.65rem 0.75rem" ${clickHandler}>
        <div style="font-size:0.85rem;background:${aWin||liveAUp?aBg:halfBg};padding:0.25rem 0.4rem;border-radius:5px">${aNames}</div>
        <div style="font-size:0.8rem;font-weight:600;color:${statusColor};text-align:center;min-width:60px">${label}</div>
        <div style="font-size:0.85rem;text-align:right;background:${bWin||liveBUp?bBg:halfBg};padding:0.25rem 0.4rem;border-radius:5px">${bNames}</div>
      </div>
      ${holeStrip}
    </div>`;
  }).join('');
}
```

- [ ] **Step 2: Add 30s auto-refresh**

Find the `showView` function. In the `if(id==='tournament')` branch, replace with:

```js
if(id==='tournament'){
  clearInterval(window._tmRefreshInterval);
  renderTournament();
  window._tmRefreshInterval=setInterval(async()=>{
    try{
      tournamentMatches=await sbGet('tournament_matches','order=round.asc,match_num.asc');
      tournamentScores=await sbGet('tournament_scores','order=id.asc');
      tournamentMatches.forEach(m=>{const t=tournaments.find(x=>x.id===m.tournament_id);if(t)m._teeId=t.tee_id;});
      renderTournament();
    }catch(e){/* silent */}
  },30000);
}
```

Also find the other `if(id===...)` branches and add at the very start of `showView`:

```js
if(id!=='tournament')clearInterval(window._tmRefreshInterval);
```

- [ ] **Step 3: Verify**

Open app. Create a tournament in Supabase (insert directly). Reload. Click Tournament tab. Should show team score header `0 – 0`, "Fourballs" and "Singles" tabs, and "Draw not yet complete" for each. No console errors.

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "feat(tournament): leaderboard with Ryder Cup match rows + hole strips + 30s refresh"
```

---

## Task 5: Admin tournament setup

**Files:** `index.html`

Admin can create a tournament, assign players to teams, name captains, and advance lifecycle to `fourball_draw` (which creates the 4 match placeholders).

- [ ] **Step 1: Add renderAdminTournament call**

Find `function renderAdmin()` (called when admin tab opens). Inside it, after the last `render...()` call, add:

```js
renderAdminTournament();
```

- [ ] **Step 2: Add HTML anchor in admin view**

Find `<div class="view" id="view-admin">`. Inside it, after the last collapsible panel, add:

```html
<div class="panel">
  <div class="panel-header" onclick="togglePanel('adminTournamentPanel')">
    🏆 Tournament <span class="panel-toggle" id="adminTournamentPanelToggle">▶</span>
  </div>
  <div class="panel-body" id="adminTournamentBody" style="display:none"></div>
</div>
```

- [ ] **Step 3: Add renderAdminTournament function**

Add after `renderSaturdayAdmin`:

```js
function renderAdminTournament(){
  const el=document.getElementById('adminTournamentBody');if(!el)return;
  const tourn=tournaments[0]||null; // edit most recent

  // Create form (shown when no tournament or adding new)
  const createHtml=`
  <div style="margin-bottom:1rem">
    <h4 style="margin:0 0 0.75rem;font-size:0.9rem">New Tournament</h4>
    <div style="display:grid;gap:0.5rem">
      <input id="tmNewName" placeholder="Tournament name" class="input" value="Mid-Season Invitational">
      <input id="tmNewDate" type="date" class="input" value="${new Date().toISOString().slice(0,10)}">
      <select id="tmNewTee" class="input">
        ${tees.filter(t=>!t.archived).map(t=>`<option value="${t.id}">${t.name}</option>`).join('')}
      </select>
      <input id="tmNewTeamA" placeholder="Team A name" class="input" value="Team A">
      <input id="tmNewTeamB" placeholder="Team B name" class="input" value="Team B">
      <button class="btn btn-primary btn-sm" onclick="createTournament()">Create Tournament</button>
    </div>
  </div>`;

  if(!tourn){el.innerHTML=createHtml;return;}

  const tPlayers=tournamentPlayers.filter(tp=>tp.tournament_id===tourn.id);
  const teamA=tPlayers.filter(tp=>tp.team==='a').map(tp=>players.find(p=>p.id===tp.player_id)).filter(Boolean);
  const teamB=tPlayers.filter(tp=>tp.team==='b').map(tp=>players.find(p=>p.id===tp.player_id)).filter(Boolean);
  const unassigned=players.filter(p=>!tPlayers.find(tp=>tp.player_id===p.id));

  const pRow=(p,team)=>`<div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.3rem">
    <span style="width:22px;height:22px;border-radius:50%;background:${clr(p)};display:inline-flex;align-items:center;justify-content:center;font-size:0.6rem;font-weight:700">${ini(p.name)}</span>
    <span style="flex:1;font-size:0.85rem">${p.name}</span>
    ${tourn.team_a_captain_id===p.id||tourn.team_b_captain_id===p.id?'<span style="font-size:0.7rem;color:gold">★ Cap</span>':''}
    <button class="btn btn-ghost btn-sm" onclick="setTournamentCaptain(${tourn.id},'${team}',${p.id})" style="font-size:0.65rem;padding:0.1rem 0.4rem">★ Cap</button>
    <button class="btn btn-ghost btn-sm" onclick="removeTournamentPlayer(${tourn.id},${p.id})" style="font-size:0.65rem;padding:0.1rem 0.4rem;color:rgba(220,80,80,0.7)">✕</button>
  </div>`;

  const addDropdown=(team)=>unassigned.length?`<select id="tmAdd${team}" class="input" style="font-size:0.8rem;padding:0.25rem 0.5rem">
    ${unassigned.map(p=>`<option value="${p.id}">${p.name}</option>`).join('')}
  </select>
  <button class="btn btn-ghost btn-sm" onclick="assignTournamentPlayer(${tourn.id},'${team}',parseInt(document.getElementById('tmAdd${team}').value))" style="font-size:0.75rem">+ Add</button>`:'<span style="font-size:0.75rem;color:rgba(255,255,255,0.3)">All players assigned</span>';

  const canAdvance=tourn.status==='setup'&&teamA.length>0&&teamB.length>0&&tourn.team_a_captain_id&&tourn.team_b_captain_id;
  const canAdvanceR2=tourn.status==='round_1'&&tournamentMatches.filter(m=>m.tournament_id===tourn.id&&m.round===1&&m.status==='complete').length===4;

  el.innerHTML=`
  ${createHtml}
  <hr style="border-color:rgba(255,255,255,0.08);margin:1rem 0">
  <h4 style="margin:0 0 0.75rem;font-size:0.9rem">${tourn.name} <span style="font-size:0.7rem;opacity:0.5">${tourn.status}</span></h4>

  <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;margin-bottom:1rem">
    <div>
      <div style="font-size:0.75rem;font-weight:600;color:#e8534a;margin-bottom:0.4rem">Team A: ${tourn.team_a_name}</div>
      ${teamA.map(p=>pRow(p,'a')).join('')}
      <div style="margin-top:0.5rem;display:flex;gap:0.4rem;align-items:center">${addDropdown('a')}</div>
    </div>
    <div>
      <div style="font-size:0.75rem;font-weight:600;color:#4a90e8;margin-bottom:0.4rem">Team B: ${tourn.team_b_name}</div>
      ${teamB.map(p=>pRow(p,'b')).join('')}
      <div style="margin-top:0.5rem;display:flex;gap:0.4rem;align-items:center">${addDropdown('b')}</div>
    </div>
  </div>

  ${tourn.status==='setup'?`<button class="btn btn-primary btn-sm" onclick="advanceTournamentStatus(${tourn.id})" ${canAdvance?'':'disabled'} title="${canAdvance?'':'Need teams + captains set'}">Start Draw (Fourballs) →</button>`:''}
  ${tourn.status==='round_1'?`<button class="btn btn-primary btn-sm" onclick="advanceTournamentStatus(${tourn.id})" ${canAdvanceR2?'':'disabled'} title="${canAdvanceR2?'':'Complete all 4 fourballs first'}">Start Singles Draw →</button>`:''}
  `;
}
```

- [ ] **Step 4: Add CRUD functions**

Add after `renderAdminTournament`:

```js
async function createTournament(){
  const name=document.getElementById('tmNewName').value.trim();
  const date=document.getElementById('tmNewDate').value;
  const teeId=document.getElementById('tmNewTee').value;
  const teamAName=document.getElementById('tmNewTeamA').value.trim()||'Team A';
  const teamBName=document.getElementById('tmNewTeamB').value.trim()||'Team B';
  if(!name||!date||!teeId){alert('Name, date and tee required');return;}
  const payload={id:Date.now()+Math.floor(Math.random()*9999),name,date,tee_id:teeId,status:'setup',team_a_name:teamAName,team_b_name:teamBName};
  try{
    const[saved]=await sbInsert('tournaments',payload);
    tournaments.unshift(saved||payload);
    activeTournamentId=(saved||payload).id;
    document.getElementById('tabTournament').style.display='';
    toast('Tournament created ✅');
    renderAdminTournament();
  }catch(e){alert('Error: '+e.message);}
}

async function assignTournamentPlayer(tournId,team,playerId){
  if(tournamentPlayers.find(tp=>tp.tournament_id===tournId&&tp.player_id===playerId))return;
  const payload={id:Date.now()+Math.floor(Math.random()*9999),tournament_id:tournId,player_id:playerId,team};
  try{
    const[saved]=await sbInsert('tournament_players',payload);
    tournamentPlayers.push(saved||payload);
    renderAdminTournament();
  }catch(e){alert('Error: '+e.message);}
}

async function removeTournamentPlayer(tournId,playerId){
  const tp=tournamentPlayers.find(x=>x.tournament_id===tournId&&x.player_id===playerId);
  if(!tp)return;
  try{
    await sbDelete('tournament_players',tp.id);
    tournamentPlayers=tournamentPlayers.filter(x=>x.id!==tp.id);
    // Clear captain if removed
    const t=tournaments.find(x=>x.id===tournId);
    if(t&&(t.team_a_captain_id===playerId||t.team_b_captain_id===playerId)){
      const patch=t.team_a_captain_id===playerId?{team_a_captain_id:null}:{team_b_captain_id:null};
      await sbUpdate('tournaments',tournId,patch);
      Object.assign(t,patch);
    }
    renderAdminTournament();
  }catch(e){alert('Error: '+e.message);}
}

async function setTournamentCaptain(tournId,team,playerId){
  const t=tournaments.find(x=>x.id===tournId);if(!t)return;
  const patch=team==='a'?{team_a_captain_id:playerId}:{team_b_captain_id:playerId};
  try{
    await sbUpdate('tournaments',tournId,patch);
    Object.assign(t,patch);
    toast(`Captain set ★`);
    renderAdminTournament();
  }catch(e){alert('Error: '+e.message);}
}

async function advanceTournamentStatus(tournId){
  const t=tournaments.find(x=>x.id===tournId);if(!t)return;
  const transitions={setup:'fourball_draw',round_1:'singles_draw'};
  const next=transitions[t.status];if(!next)return;
  try{
    // Create match placeholders
    if(next==='fourball_draw'){
      for(let i=1;i<=4;i++){
        const payload={id:Date.now()+Math.floor(Math.random()*9999)+i,tournament_id:tournId,round:1,match_num:i,status:'pending'};
        const[saved]=await sbInsert('tournament_matches',payload);
        const m=saved||payload;m._teeId=t.tee_id;
        tournamentMatches.push(m);
      }
    }
    if(next==='singles_draw'){
      for(let i=1;i<=8;i++){
        const payload={id:Date.now()+Math.floor(Math.random()*9999)+i,tournament_id:tournId,round:2,match_num:i,status:'pending'};
        const[saved]=await sbInsert('tournament_matches',payload);
        const m=saved||payload;m._teeId=t.tee_id;
        tournamentMatches.push(m);
      }
    }
    await sbUpdate('tournaments',tournId,{status:next});
    t.status=next;
    toast('Tournament advanced ✅');
    renderAdminTournament();
  }catch(e){alert('Error: '+e.message);}
}

async function resetTournament(tournId){
  if(!confirm('Delete all match and score data for this tournament? The tournament record stays.'))return;
  try{
    const mIds=tournamentMatches.filter(m=>m.tournament_id===tournId).map(m=>m.id);
    for(const mid of mIds){
      await sbDeleteWhere('tournament_scores',`match_id=eq.${mid}`);
    }
    for(const mid of mIds)await sbDelete('tournament_matches',mid);
    tournamentMatches=tournamentMatches.filter(m=>m.tournament_id!==tournId);
    tournamentScores=tournamentScores.filter(s=>!mIds.includes(s.match_id));
    await sbUpdate('tournaments',tournId,{status:'setup',team_a_captain_id:null,team_b_captain_id:null});
    const t=tournaments.find(x=>x.id===tournId);
    if(t){t.status='setup';t.team_a_captain_id=null;t.team_b_captain_id=null;}
    toast('Tournament reset');
    renderAdminTournament();
    renderTournament();
  }catch(e){alert('Error: '+e.message);}
}
```

- [ ] **Step 5: Verify**

Open Admin tab → Tournament panel. Fill in a tournament name and create it. Should appear in the list. Assign some players to Team A and Team B. Set captains. Verify "Start Draw" button appears (enabled only when teams + captains are set). Click it — should toast "Tournament advanced" and set status to `fourball_draw`.

- [ ] **Step 6: Commit**

```bash
git add index.html
git commit -m "feat(tournament): admin setup — create, assign players, captains, advance lifecycle"
```

---

## Task 6: Captain's draw

**Files:** `index.html`

When tournament is in `fourball_draw` or `singles_draw`, the Tournament tab shows the draw screen. Captains make picks; the screen polls every 5s for opponent picks.

- [ ] **Step 1: Add draw HTML builder**

Add after `renderTournamentLeaderboardHtml`:

```js
function renderTournamentDrawHtml(tourn){
  const isFourball=tourn.status==='fourball_draw';
  const round=isFourball?1:2;
  const tMatches=tournamentMatches.filter(m=>m.tournament_id===tourn.id&&m.round===round);
  const tPlayers=tournamentPlayers.filter(tp=>tp.tournament_id===tourn.id);

  // Determine role
  const isCapA=activeId===tourn.team_a_captain_id;
  const isCapB=activeId===tourn.team_b_captain_id;
  const myTeam=isCapA?'a':isCapB?'b':null;

  // Placed player IDs per team
  const placedA=new Set(tMatches.flatMap(m=>[m.team_a_p1_id,m.team_a_p2_id].filter(Boolean)));
  const placedB=new Set(tMatches.flatMap(m=>[m.team_b_p1_id,m.team_b_p2_id].filter(Boolean)));
  const benchA=tPlayers.filter(tp=>tp.team==='a'&&!placedA.has(tp.player_id)).map(tp=>players.find(p=>p.id===tp.player_id)).filter(Boolean);
  const benchB=tPlayers.filter(tp=>tp.team==='b'&&!placedB.has(tp.player_id)).map(tp=>players.find(p=>p.id===tp.player_id)).filter(Boolean);

  // Find active match (first where not all slots filled)
  const activeMatch=tMatches.find(m=>isFourball?(m.team_a_p1_id==null||m.team_b_p1_id==null):(m.team_a_p1_id==null||m.team_b_p1_id==null))||null;
  const pickState=activeMatch?tmDrawPickState(activeMatch):null;

  const myTurn=myTeam&&pickState&&(pickState===`${myTeam}_picks`||pickState===`${myTeam}_responds`);
  const needsCount=isFourball?2:1;

  const matchRows=tMatches.map(m=>{
    const aFull=isFourball?(m.team_a_p1_id&&m.team_a_p2_id):(m.team_a_p1_id!=null);
    const bFull=isFourball?(m.team_b_p1_id&&m.team_b_p2_id):(m.team_b_p1_id!=null);
    const pn=id=>{const p=players.find(x=>x.id===id);return p?p.name.split(' ')[0]:'?';};
    const aNames=m.team_a_p1_id?`${pn(m.team_a_p1_id)}${m.team_a_p2_id?' / '+pn(m.team_a_p2_id):''}`:isFourball?'_ / _':'_';
    const bNames=m.team_b_p1_id?`${pn(m.team_b_p1_id)}${m.team_b_p2_id?' / '+pn(m.team_b_p2_id):''}`:isFourball?'_ / _':'_';
    const isActive=activeMatch&&m.id===activeMatch.id;
    return`<div style="display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:0.5rem;padding:0.5rem 0.75rem;border-bottom:1px solid rgba(255,255,255,0.06);background:${isActive?'rgba(255,255,255,0.04)':'transparent'}">
      <div style="font-size:0.85rem;color:${aFull?'#e8534a':'rgba(255,255,255,0.4)'}">${aNames}</div>
      <div style="font-size:0.75rem;color:rgba(255,255,255,0.3)">M${m.match_num}</div>
      <div style="font-size:0.85rem;text-align:right;color:${bFull?'#4a90e8':'rgba(255,255,255,0.4)'}">${bNames}</div>
    </div>`;
  }).join('');

  const bench=(players,team)=>players.map(p=>`<div class="tm-bench-player" data-pid="${p.id}" data-team="${team}" onclick="tmTogglePick(this)" style="display:inline-flex;align-items:center;gap:6px;padding:0.4rem 0.65rem;border:1px solid rgba(255,255,255,0.15);border-radius:20px;cursor:pointer;margin:0.25rem;transition:background 0.15s">
    <span style="width:22px;height:22px;border-radius:50%;background:${clr(p)};display:inline-flex;align-items:center;justify-content:center;font-size:0.6rem;font-weight:700">${ini(p.name)}</span>
    <span style="font-size:0.85rem">${p.name}</span>
  </div>`).join('');

  const waitMsg=myTeam&&!myTurn?`<div style="text-align:center;padding:1rem;color:rgba(255,255,255,0.4);font-style:italic">Waiting for ${myTeam==='a'?tourn.team_b_name:tourn.team_a_name} captain to pick…</div>`:'';
  const specMsg=!myTeam?`<div style="text-align:center;padding:0.75rem;color:rgba(255,255,255,0.35);font-size:0.85rem">👁 Spectator view — auto-refreshes every 5s</div>`:'';

  const myBench=myTeam==='a'?benchA:myTeam==='b'?benchB:[];
  const pickHtml=myTurn?`
    <div style="margin-top:1rem">
      <div style="font-size:0.8rem;color:rgba(255,255,255,0.5);margin-bottom:0.5rem">
        ${pickState==='a_picks'||pickState==='b_picks'?'Pick your side for Match '+activeMatch.match_num:'Respond to their pick — select your side for Match '+activeMatch.match_num}
        ${isFourball?` (select 2)`:' (select 1)'}
      </div>
      <div id="tmBench">${bench(myBench,myTeam)}</div>
      <button class="btn btn-primary btn-sm" id="tmConfirmPick" onclick="tmConfirmPick(${tourn.id},${activeMatch?.id},${isFourball})" disabled style="margin-top:0.75rem">Confirm Pick</button>
    </div>`:waitMsg||specMsg;

  return`<div>
    <h3 style="font-family:'Playfair Display',serif;font-size:1.1rem;margin:0 0 0.75rem">${isFourball?'Fourball Draw':'Singles Draw'}</h3>
    <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:10px;margin-bottom:1rem;overflow:hidden">
      <div style="display:grid;grid-template-columns:1fr auto 1fr;padding:0.4rem 0.75rem;font-size:0.7rem;font-weight:600;color:rgba(255,255,255,0.3);border-bottom:1px solid rgba(255,255,255,0.06)">
        <span style="color:#e8534a">${tourn.team_a_name}</span><span></span><span style="color:#4a90e8;text-align:right">${tourn.team_b_name}</span>
      </div>
      ${matchRows}
    </div>
    ${pickHtml}
  </div>`;
}

function wireTournamentDrawEvents(tourn){
  clearInterval(window._tmDrawPollInterval);
  window._tmDrawPollInterval=setInterval(async()=>{
    try{
      const fresh=await sbGet('tournament_matches',`tournament_id=eq.${tourn.id}&order=round.asc,match_num.asc`);
      fresh.forEach(m=>{m._teeId=tourn.tee_id;});
      tournamentMatches=tournamentMatches.filter(m=>m.tournament_id!==tourn.id).concat(fresh);
      // Also re-fetch tournament status in case it advanced
      const freshT=await sbGet('tournaments',`id=eq.${tourn.id}`);
      if(freshT[0]){Object.assign(tourn,freshT[0]);const idx=tournaments.findIndex(t=>t.id===tourn.id);if(idx>=0)tournaments[idx]=freshT[0];}
      renderTournament();
    }catch(e){/* silent */}
  },5000);
}

function tmDrawPickState(match){
  const aFull=match.team_a_p1_id!=null;
  const bFull=match.team_b_p1_id!=null;
  if(!aFull&&!bFull)return match.match_num%2===1?'a_picks':'b_picks';
  if(aFull&&!bFull)return'b_responds';
  if(!aFull&&bFull)return'a_responds';
  return'complete';
}

let _tmSelectedPids=[];
function tmTogglePick(el){
  const pid=parseInt(el.dataset.pid);
  const idx=_tmSelectedPids.indexOf(pid);
  if(idx>=0){_tmSelectedPids.splice(idx,1);el.style.background='';el.style.borderColor='rgba(255,255,255,0.15)';}
  else{_tmSelectedPids.push(pid);el.style.background='rgba(255,255,255,0.12)';el.style.borderColor='rgba(255,255,255,0.4)';}
  const btn=document.getElementById('tmConfirmPick');
  if(btn){const need=_tmSelectedPids.length>0&&_tmSelectedPids.length<=(el.closest('[onclick]')?2:1);btn.disabled=false;}
}

async function tmConfirmPick(tournId,matchId,isFourball){
  const tourn=tournaments.find(t=>t.id===tournId);
  const match=tournamentMatches.find(m=>m.id===matchId);
  if(!tourn||!match)return;
  const need=isFourball?2:1;
  if(_tmSelectedPids.length!==need){alert(`Please select ${need} player(s)`);return;}
  const pickState=tmDrawPickState(match);
  const myTeam=activeId===tourn.team_a_captain_id?'a':activeId===tourn.team_b_captain_id?'b':null;
  if(!myTeam)return;
  const patch=isFourball
    ?{[`team_${myTeam}_p1_id`]:_tmSelectedPids[0],[`team_${myTeam}_p2_id`]:_tmSelectedPids[1]}
    :{[`team_${myTeam}_p1_id`]:_tmSelectedPids[0]};
  try{
    await sbUpdate('tournament_matches',matchId,patch);
    Object.assign(match,patch);
    _tmSelectedPids=[];
    // Check if match is now fully picked and advance tournament if draw complete
    await checkTournamentDrawAdvance(tourn);
    renderTournament();
    toast('Pick saved ✅');
  }catch(e){alert('Error: '+e.message);}
}

async function checkTournamentDrawAdvance(tourn){
  const tMatches=tournamentMatches.filter(m=>m.tournament_id===tourn.id);
  if(tourn.status==='fourball_draw'){
    const r1=tMatches.filter(m=>m.round===1);
    const done=r1.every(m=>m.team_a_p1_id&&m.team_b_p1_id&&(m.team_a_p2_id||true)&&(m.team_b_p2_id||true));
    // Check all 4 have both sides filled
    const allFilled=r1.every(m=>m.team_a_p1_id&&m.team_a_p2_id&&m.team_b_p1_id&&m.team_b_p2_id);
    if(allFilled){
      await sbUpdate('tournaments',tourn.id,{status:'round_1'});
      tourn.status='round_1';
      const idx=tournaments.findIndex(t=>t.id===tourn.id);
      if(idx>=0)tournaments[idx].status='round_1';
      toast('Draw complete — Round 1 is live! 🏌️');
    }
  }
  if(tourn.status==='singles_draw'){
    const r2=tMatches.filter(m=>m.round===2);
    const allFilled=r2.every(m=>m.team_a_p1_id&&m.team_b_p1_id);
    if(allFilled){
      await sbUpdate('tournaments',tourn.id,{status:'round_2'});
      tourn.status='round_2';
      const idx=tournaments.findIndex(t=>t.id===tourn.id);
      if(idx>=0)tournaments[idx].status='round_2';
      toast('Singles draw complete — Round 2 is live! 🏌️');
    }
  }
}
```

- [ ] **Step 2: Clear draw poll on tab leave**

In `showView`, at the top, change the clear interval line to:

```js
if(id!=='tournament'){clearInterval(window._tmRefreshInterval);clearInterval(window._tmDrawPollInterval);}
```

- [ ] **Step 3: Verify**

In Supabase, set a tournament's status to `fourball_draw`. Set `team_a_captain_id` to your active player ID. Reload app. Click Tournament tab — should show the draw screen with match rows. The active player should see their bench of unplaced players. Other devices/players should see "Waiting for…" or spectator view.

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "feat(tournament): captain draw screen with alternating picks and 5s polling"
```

---

## Task 7: Match scoring screen

**Files:** `index.html`

Any device can tap an active match to open hole-by-hole scoring. Score saves to Supabase after each player. Auto-close prompt when match is mathematically decided.

- [ ] **Step 1: Add TE state + teOpenMatch**

Add after `checkTournamentDrawAdvance`:

```js
// ── Tournament Entry (TE) state ───────────────────────────────────
let TE={matchId:null,match:null,tournament:null,tee:null,hcpInfo:null,playerOrder:[],currentPlayerIdx:0,currentHole:1,scores:{}};
let _teBuffer='';

function teOpenMatch(matchId){
  const match=tournamentMatches.find(m=>m.id===matchId);if(!match)return;
  const tournament=tournaments.find(t=>t.id===match.tournament_id);if(!tournament)return;
  const tee=tees.find(t=>t.id===tournament.tee_id)||{slope:113,rating:COURSE_PAR,id:tournament.tee_id};
  match._teeId=tee.id;
  const hcpInfo=tmMatchHcpInfo(match,tournament.date);
  const playerOrder=[match.team_a_p1_id];
  if(match.team_a_p2_id)playerOrder.push(match.team_a_p2_id);
  playerOrder.push(match.team_b_p1_id);
  if(match.team_b_p2_id)playerOrder.push(match.team_b_p2_id);

  // Load existing scores
  const scores={};
  const mScores=tournamentScores.filter(s=>s.match_id===matchId);
  for(const s of mScores){
    if(!scores[s.player_id])scores[s.player_id]={};
    scores[s.player_id][s.hole]=s.gross;
  }

  // Find first incomplete hole
  let currentHole=1;
  for(let h=1;h<=18;h++){
    const allScored=playerOrder.every(pid=>scores[pid]?.[h]!=null);
    if(!allScored){currentHole=h;break;}
    if(h===18){currentHole=18;}
  }

  TE={matchId,match,tournament,tee,hcpInfo,playerOrder,currentPlayerIdx:0,currentHole,scores};
  _teBuffer='';

  if(match.status==='pending'){
    sbUpdate('tournament_matches',matchId,{status:'in_progress'}).catch(()=>{});
    match.status='in_progress';
  }

  renderMatchScoring();
}
```

- [ ] **Step 2: Add renderMatchScoring**

```js
function renderMatchScoring(){
  const el=document.getElementById('tournamentContent');if(!el)return;
  const{match,tournament,tee,hcpInfo,playerOrder,currentPlayerIdx,currentHole,scores}=TE;
  const holeIdx=currentHole-1;
  const par=HOLE_PARS[holeIdx];
  const si=HOLE_HCP[holeIdx];
  const isStroke=hcpInfo.strokeHoles.includes(holeIdx);
  const currentPid=playerOrder[currentPlayerIdx];
  const currentP=players.find(p=>p.id===currentPid);

  const pCard=(pid,teamLabel)=>{
    const p=players.find(x=>x.id===pid);if(!p)return'';
    const gross=scores[pid]?.[currentHole]??null;
    const isCurrent=pid===currentPid;
    const onReceiving=hcpInfo.receivingTeam===(teamLabel==='A'?'a':'b');
    const hasStroke=isStroke&&onReceiving;
    const pts=gross!=null?tmPlayerPts(gross,par,hasStroke):null;
    return`<div style="display:flex;align-items:center;gap:0.5rem;padding:0.4rem;border-radius:6px;background:${isCurrent?'rgba(255,255,255,0.07)':'transparent'}">
      <span style="width:24px;height:24px;border-radius:50%;background:${clr(p)};display:inline-flex;align-items:center;justify-content:center;font-size:0.6rem;font-weight:700">${ini(p.name)}</span>
      <span style="flex:1;font-size:0.85rem${isCurrent?';font-weight:600':''}">${p.name.split(' ')[0]}</span>
      ${hasStroke?'<span style="font-size:0.65rem;background:rgba(255,200,50,0.2);color:#f5c518;border-radius:4px;padding:1px 4px">+stroke</span>':''}
      <span style="font-size:1.1rem;font-weight:700;min-width:28px;text-align:center">${gross??'—'}</span>
      <span style="font-size:0.85rem;color:rgba(255,255,255,0.5);min-width:30px;text-align:center">${pts!=null?pts+'pts':'—'}</span>
    </div>`;
  };

  // Compute current hole result if all scored
  const grossByPid={};
  let holeComplete=true;
  for(const pid of playerOrder){
    const g=scores[pid]?.[currentHole]??null;
    if(g==null){holeComplete=false;}
    grossByPid[pid]=g;
  }
  const hr=holeComplete?tmHoleResult(holeIdx,match,hcpInfo,grossByPid):null;
  const holeResultHtml=hr&&hr.result?`<div style="text-align:center;padding:0.35rem;font-size:0.8rem;font-weight:600;color:${hr.result==='a'?'#e8534a':hr.result==='b'?'#4a90e8':'rgba(255,255,255,0.6)'}">
    ${hr.result==='a'?tournament.team_a_name+' wins hole':hr.result==='b'?tournament.team_b_name+' wins hole':'Hole halved'} · ${hr.aScore}–${hr.bScore} bb pts
  </div>`:'';

  // Match status banner
  const mScores=tournamentScores.filter(s=>s.match_id===match.id);
  const state=tmMatchState(match,hcpInfo,mScores);
  const statusText=state.matchStatus===0?`All Square thru ${state.holesPlayed}`
    :state.matchStatus>0?`${tournament.team_a_name} ${state.matchStatus}UP thru ${state.holesPlayed}`
    :`${tournament.team_b_name} ${Math.abs(state.matchStatus)}UP thru ${state.holesPlayed}`;

  // Hole strip
  const holeStrip=Array.from({length:18},(_,i)=>{
    const hr2=state.holeResults[i];
    const isCur=i+1===currentHole;
    const bg=isCur?'rgba(245,197,24,0.7)':!hr2?'rgba(255,255,255,0.06)':hr2.result==='a'?'rgba(232,83,74,0.7)':hr2.result==='b'?'rgba(74,144,232,0.7)':'rgba(255,255,255,0.2)';
    const lbl=isCur?currentHole:!hr2?'':hr2.result==='a'?'S':hr2.result==='b'?'L':'½';
    return`<span style="display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;border-radius:3px;background:${bg};font-size:0.55rem;font-weight:600">${lbl}</span>`;
  }).join('');

  // HCP banner
  const recv=hcpInfo.receivingTeam==='a'?tournament.team_a_name:tournament.team_b_name;
  const hcpBanner=hcpInfo.diff>0?`<div style="font-size:0.75rem;color:rgba(255,255,255,0.45);margin-bottom:0.75rem;padding:0.4rem 0.5rem;background:rgba(255,255,255,0.04);border-radius:6px">${recv} receive ${hcpInfo.diff} stroke${hcpInfo.diff>1?'s':''} · SI 1–${hcpInfo.diff}</div>`:'';

  // Team A p2 and Team B p2 sections
  const aP2html=match.team_a_p2_id?pCard(match.team_a_p2_id,'A'):'';
  const bP2html=match.team_b_p2_id?pCard(match.team_b_p2_id,'B'):'';

  el.innerHTML=`
  <div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.75rem">
    <button onclick="teBack()" style="background:none;border:none;color:rgba(255,255,255,0.5);cursor:pointer;font-size:1.1rem;padding:0">←</button>
    <div style="flex:1">
      <div style="font-size:0.85rem;font-weight:600">${tournament.team_a_name} vs ${tournament.team_b_name}</div>
      <div style="font-size:0.75rem;color:rgba(255,255,255,0.4)">${statusText}</div>
    </div>
    <button class="btn btn-ghost btn-sm" onclick="teCloseMatchPrompt()" style="font-size:0.7rem">Close match</button>
  </div>

  ${hcpBanner}

  <!-- Hole card -->
  <div style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.1);border-radius:10px;margin-bottom:0.75rem;overflow:hidden">
    <div style="display:flex;align-items:center;justify-content:space-between;padding:0.5rem 0.75rem;border-bottom:1px solid rgba(255,255,255,0.08)">
      <span style="font-weight:700">Hole ${currentHole}</span>
      <span style="font-size:0.8rem;color:rgba(255,255,255,0.5)">Par ${par} · SI ${si}${isStroke?` · <span style="color:#f5c518">stroke hole</span>`:''}</span>
    </div>
    <div style="padding:0.5rem">
      <div style="font-size:0.7rem;font-weight:600;color:#e8534a;margin-bottom:0.2rem">${tournament.team_a_name}</div>
      ${pCard(match.team_a_p1_id,'A')}
      ${aP2html}
      <div style="font-size:0.7rem;font-weight:600;color:#4a90e8;margin:0.5rem 0 0.2rem">${tournament.team_b_name}</div>
      ${pCard(match.team_b_p1_id,'B')}
      ${bP2html}
      ${holeResultHtml}
    </div>
  </div>

  <!-- Hole strip -->
  <div style="display:flex;gap:2px;flex-wrap:wrap;margin-bottom:0.75rem">${holeStrip}</div>

  <!-- Entering label -->
  <div style="font-size:0.8rem;color:rgba(255,255,255,0.4);margin-bottom:0.4rem">Entering: <strong style="color:#fff">${currentP?.name||'?'}</strong></div>

  <!-- Keypad -->
  <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:0.35rem;max-width:260px;margin:0 auto">
    ${[1,2,3,4,5,6,7,8,9].map(d=>`<button onclick="teKey(${d})" style="padding:0.9rem;font-size:1.2rem;font-weight:700;background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.12);border-radius:8px;color:#fff;cursor:pointer">${d}</button>`).join('')}
    <button onclick="teBack_key()" style="padding:0.9rem;font-size:1rem;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:8px;color:#fff;cursor:pointer">⌫</button>
    <div style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.1);border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:1.3rem;font-weight:700;min-height:52px">${_teBuffer||'—'}</div>
    <button onclick="teEnter()" style="padding:0.9rem;font-size:0.75rem;font-weight:700;background:rgba(74,144,232,0.3);border:1px solid rgba(74,144,232,0.4);border-radius:8px;color:#fff;cursor:pointer">NEXT →</button>
  </div>`;
}

function teKey(d){_teBuffer=String(d);renderMatchScoring();}
function teBack_key(){_teBuffer='';renderMatchScoring();}

async function teEnter(){
  const gross=parseInt(_teBuffer);
  if(!gross||gross<1||gross>15){toast('Enter score 1–15');return;}
  const pid=TE.playerOrder[TE.currentPlayerIdx];
  if(!TE.scores[pid])TE.scores[pid]={};
  TE.scores[pid][TE.currentHole]=gross;
  _teBuffer='';

  // Save to Supabase (delete existing + insert)
  try{
    await sbDeleteWhere('tournament_scores',`match_id=eq.${TE.matchId}&hole=eq.${TE.currentHole}&player_id=eq.${pid}`);
    const payload={id:Date.now()+Math.floor(Math.random()*9999),match_id:TE.matchId,hole:TE.currentHole,player_id:pid,gross};
    const[saved]=await sbInsert('tournament_scores',payload);
    tournamentScores=tournamentScores.filter(s=>!(s.match_id===TE.matchId&&s.hole===TE.currentHole&&s.player_id===pid));
    tournamentScores.push(saved||payload);
  }catch(e){toast('Save error: '+e.message,3000);}

  // Advance player
  TE.currentPlayerIdx++;
  if(TE.currentPlayerIdx>=TE.playerOrder.length){
    // All players scored this hole
    TE.currentPlayerIdx=0;
    // Auto-close check
    const mScores=tournamentScores.filter(s=>s.match_id===TE.matchId);
    const state=tmMatchState(TE.match,TE.hcpInfo,mScores);
    if(TE.currentHole<18&&Math.abs(state.matchStatus)>state.holesRemaining-1){
      // Will be decided after this hole advances
      const up=Math.abs(state.matchStatus);
      const winner=state.matchStatus>0?TE.tournament.team_a_name:TE.tournament.team_b_name;
      if(confirm(`${winner} wins ${up}&${state.holesRemaining-1}. Close match?`)){
        await teCloseMatch(state.matchStatus>0?'a':'b');return;
      }
    }
    if(TE.currentHole<18)TE.currentHole++;
  }
  renderMatchScoring();
}

function teBack(){
  clearInterval(window._tmRefreshInterval);
  clearInterval(window._tmDrawPollInterval);
  TE={matchId:null,match:null,tournament:null,tee:null,hcpInfo:null,playerOrder:[],currentPlayerIdx:0,currentHole:1,scores:{}};
  renderTournament();
  // Re-start leaderboard refresh
  showView('tournament',null);
}

function teCloseMatchPrompt(){
  const mScores=tournamentScores.filter(s=>s.match_id===TE.matchId);
  const state=tmMatchState(TE.match,TE.hcpInfo,mScores);
  let result,label;
  if(state.matchStatus>0){result='a';label=`${TE.tournament.team_a_name} wins`;}
  else if(state.matchStatus<0){result='b';label=`${TE.tournament.team_b_name} wins`;}
  else{result='half';label='Match halved';}
  if(confirm(`Close match: ${label}?`))teCloseMatch(result);
}

async function teCloseMatch(result){
  try{
    await sbUpdate('tournament_matches',TE.matchId,{status:'complete',result});
    TE.match.status='complete';TE.match.result=result;
    const idx=tournamentMatches.findIndex(m=>m.id===TE.matchId);
    if(idx>=0){tournamentMatches[idx].status='complete';tournamentMatches[idx].result=result;}
    toast('Match closed ✅');
    await checkTournamentStatusAdvance(TE.tournament);
    teBack();
  }catch(e){alert('Error: '+e.message);}
}

async function checkTournamentStatusAdvance(tourn){
  const tMatches=tournamentMatches.filter(m=>m.tournament_id===tourn.id);
  if(tourn.status==='round_1'){
    const r1Done=tMatches.filter(m=>m.round===1&&m.status==='complete').length===4;
    if(r1Done){
      await sbUpdate('tournaments',tourn.id,{status:'singles_draw'});
      tourn.status='singles_draw';
      const idx=tournaments.findIndex(t=>t.id===tourn.id);
      if(idx>=0)tournaments[idx].status='singles_draw';
      toast('All fourballs complete — Singles draw is open! 🏆');
    }
  }
  if(tourn.status==='round_2'){
    const r2Done=tMatches.filter(m=>m.round===2&&m.status==='complete').length===8;
    if(r2Done){
      await sbUpdate('tournaments',tourn.id,{status:'complete'});
      tourn.status='complete';
      const idx=tournaments.findIndex(t=>t.id===tourn.id);
      if(idx>=0)tournaments[idx].status='complete';
      toast('Tournament complete! 🏆');
    }
  }
}
```

- [ ] **Step 3: Verify scoring flow**

In Supabase, manually create a tournament_matches row with `status='pending'`, both team_a and team_b player IDs set. Reload. Click Tournament tab → click the match row. Should open scoring screen with hole 1, Par/SI info, player cards, and keypad. Enter a score (e.g., press `5` then `NEXT →`). Should advance to next player. After all players scored, should advance to hole 2. Open Supabase `tournament_scores` table to confirm rows were inserted.

- [ ] **Step 4: Verify auto-close**

Continue scoring until one team is mathematically winning (e.g., 3UP with 2 holes left). Should see a confirm dialog. Confirm → match closes, leaderboard re-renders with result.

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "feat(tournament): hole-by-hole scoring screen with TE state, keypad, auto-close"
```

---

## Task 8: Final wiring + polish

**Files:** `index.html`

- [ ] **Step 1: Hide draw poll interval when leaving admin tab**

In `showView`, find where other tabs clear intervals. Ensure the admin tab also clears draw poll:

```js
// Already handled in Task 6 Step 2 — double-check the line reads:
if(id!=='tournament'){clearInterval(window._tmRefreshInterval);clearInterval(window._tmDrawPollInterval);}
```

- [ ] **Step 2: Override draw — admin can fill any unfilled pick**

In `renderAdminTournament`, add this section after the match row list (inside the draw phase view). Find `renderTournamentDrawHtml` and add an admin override section at the bottom of the returned HTML for admin users:

In `renderTournamentDrawHtml`, before the closing `</div>`, add:

```js
const adminOverride=isAdmin()?`<div style="margin-top:1rem;padding-top:0.75rem;border-top:1px solid rgba(255,255,255,0.08)">
  <div style="font-size:0.75rem;color:rgba(255,255,255,0.35);margin-bottom:0.4rem">Admin override — fill any unfilled slot</div>
  <select id="tmOverrideMatch" class="input" style="font-size:0.8rem;padding:0.25rem 0.5rem;margin-right:0.4rem">
    ${tMatches.filter(m=>!m.team_a_p1_id||!m.team_b_p1_id).map(m=>`<option value="${m.id}">Match ${m.match_num}</option>`).join('')}
  </select>
  <select id="tmOverrideTeam" class="input" style="font-size:0.8rem;padding:0.25rem 0.5rem;margin-right:0.4rem">
    <option value="a">Team A</option><option value="b">Team B</option>
  </select>
  <select id="tmOverridePid1" class="input" style="font-size:0.8rem;padding:0.25rem 0.5rem;margin-right:0.4rem">
    ${players.map(p=>`<option value="${p.id}">${p.name}</option>`).join('')}
  </select>
  ${isFourball?`<select id="tmOverridePid2" class="input" style="font-size:0.8rem;padding:0.25rem 0.5rem;margin-right:0.4rem">${players.map(p=>`<option value="${p.id}">${p.name}</option>`).join('')}</select>`:''}
  <button class="btn btn-warn btn-sm" onclick="tmAdminOverridePick(${tourn.id},${isFourball})" style="font-size:0.75rem">Override</button>
</div>`:'';
```

Then add `${adminOverride}` before the final `</div>` of the returned HTML string.

Add the override function:

```js
async function tmAdminOverridePick(tournId,isFourball){
  const matchId=parseInt(document.getElementById('tmOverrideMatch').value);
  const team=document.getElementById('tmOverrideTeam').value;
  const p1=parseInt(document.getElementById('tmOverridePid1').value);
  const p2=isFourball?parseInt(document.getElementById('tmOverridePid2')?.value):null;
  const patch=isFourball?{[`team_${team}_p1_id`]:p1,[`team_${team}_p2_id`]:p2}:{[`team_${team}_p1_id`]:p1};
  try{
    await sbUpdate('tournament_matches',matchId,patch);
    const m=tournamentMatches.find(x=>x.id===matchId);if(m)Object.assign(m,patch);
    const tourn=tournaments.find(t=>t.id===tournId);
    if(tourn)await checkTournamentDrawAdvance(tourn);
    toast('Override applied');renderTournament();
  }catch(e){alert('Error: '+e.message);}
}
```

- [ ] **Step 3: Verify full tournament flow end-to-end**

Walk through the complete tournament lifecycle in the browser:

1. Admin creates tournament (name, date, tee)
2. Assign 8 players to each team
3. Set captains for each team
4. Click "Start Draw (Fourballs)"
5. Navigate to Tournament tab as Cap A — see draw screen, bench shows Team A players
6. Select 2 players, confirm pick for Match 1
7. Switch active player to Cap B — see opponent's pick, respond with 2 players
8. After Match 1 filled, Match 2 opens for Cap B first (even match)
9. Continue until all 4 fourballs drawn — status auto-advances to `round_1`
10. Tap a fourball match — scoring screen opens
11. Score 18 holes — auto-close fires when match decided
12. After all 4 fourballs complete — status advances to `singles_draw`
13. Repeat draw for 8 singles
14. Score singles — status advances to `complete`
15. Leaderboard shows final team score

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "feat(tournament): admin draw override, full lifecycle wiring"
```

---

## Self-Review

### Spec coverage check

| Spec requirement | Task |
|---|---|
| 4 new Supabase tables | Task 1 (prerequisite + grants) |
| Tournament lifecycle 6 states | Tasks 5, 6, 7 (advanceTournamentStatus, checkTournamentDrawAdvance, checkTournamentStatusAdvance) |
| Captain's alternating pick (odd→A first, even→B first) | Task 6 (tmDrawPickState) |
| Fourball strokes: both team players receive | Task 2 (tmHoleResult — hasStroke based on team membership) |
| Singles strokes: individual HCP diff | Task 2 (tmMatchHcpInfo — p2 IDs are null → combA=phA1, combB=phB1) |
| 90% playing HCP | Task 2 (tmPlayingHcp: `Math.round(courseHcp * 0.90)`) |
| Better ball: Math.max(pts_p1, pts_p2) | Task 2 (tmHoleResult: `Math.max(ptsA1, ptsA2)`) |
| Auto-close prompt | Task 7 (teEnter → auto-close check) |
| Ryder Cup colour wash | Task 4 (aBg/bBg in renderTournamentMatchRows) |
| Hole strip on live matches | Task 4 (holeStrip in renderTournamentMatchRows) |
| Round tabs Fourballs/Singles | Task 4 (tmSetRoundTab) |
| 30s auto-refresh | Task 4 |
| 5s draw polling | Task 6 (wireTournamentDrawEvents) |
| Admin override draw | Task 8 |
| Reset tournament | Task 5 (resetTournament) |
| Tournament selector (multiple) | Task 4 (selector HTML in renderTournament) |
| Tab hidden until tournaments exist | Task 3 |
| Score correction (UPSERT via delete+insert) | Task 7 (teEnter: sbDeleteWhere then sbInsert) |
| Match score saves immediately per player | Task 7 (teEnter calls sbDeleteWhere+sbInsert after each entry) |
| Scorer can open match from leaderboard | Task 4 (canScore + onclick teOpenMatch) |
| One scorer, any device | Task 7 (no auth on teOpenMatch) |
| Captain identity = activeId | Task 6 (isCapA/isCapB checks) |
| Admin inline controls | Tasks 4 (adminBtn, resetBtn), 8 (override) |
| Complete status when all matches done | Task 7 (checkTournamentStatusAdvance) |
| Team score from completed matches only | Task 4 (renderTournamentLeaderboardHtml filter: status==='complete') |

### Type consistency check

- `tmMatchHcpInfo(match, date)` — called in Task 4 and Task 7 with `(match, tournament.date)` ✅
- `tmMatchState(match, hcpInfo, scores)` — scores = `tournamentScores.filter(s=>s.match_id===match.id)` ✅
- `tmHoleResult(holeIdx, match, hcpInfo, grossByPid)` — `grossByPid` is `{playerId: gross}` ✅
- `TE.scores` structure: `{pid: {holeNum: gross}}` — accessed as `scores[pid]?.[currentHole]` ✅
- `tmDrawPickState(match)` — returns `'a_picks'|'b_picks'|'a_responds'|'b_responds'|'complete'` ✅
- `sbDeleteWhere(t, filter)` — filter is a query string like `match_id=eq.X&hole=eq.Y` ✅

### Placeholder check

No "TBD", "TODO", or "implement later" found. All functions have complete implementations. ✅

### One gap found and fixed

The spec says "A match is open for scoring as soon as both sides are filled" — this is handled in `renderTournamentMatchRows` where `canScore` checks `team_a_p1_id && team_b_p1_id`. ✅
