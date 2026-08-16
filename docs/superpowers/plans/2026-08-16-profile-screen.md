# Profile Screen + DGU Membership Number Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a DGU membership number to the player record, and split identity and preferences out of the My Rounds tab into a new Profile screen.

**Architecture:** Everything lives in `index.html` — a single static file with inline HTML, CSS and JS, no build step. The Profile screen is a new `view-*` div plus a nav tab, following the existing `showView()` pattern. It mostly *adopts* existing functions (`openEditName`, `showMyHcp`, `openBagModal`, `toggleUnits`, `renderGpsPreferencePanel`) rather than reimplementing them; the only new logic is the DGU field and its validation.

**Tech Stack:** Vanilla HTML/CSS/JS in one file. Supabase (Postgres + PostgREST) via the existing `sbUpdate`/`sbInsert` helpers. No npm, no framework, no test runner.

**Spec:** `docs/superpowers/specs/2026-08-16-profile-screen-design.md`

## Global Constraints

- **Single file.** All app changes go in `index.html`. No new JS/CSS files, no dependencies, no build step.
- **DGU validation:** `^\d+-\d+$` after trimming, max 20 characters.
- **Store the DGU value exactly as typed. Never reformat it.** Segments are variable-length (`900-1831`, `1-123456`), so `9001831` is ambiguous and auto-hyphenation would corrupt data.
- **`dgu_number` is nullable in the schema.** Required is enforced at the sign-up form only. Existing players have no number and must stay saveable.
- **Migration runs before the merge.** GitHub Pages serves `main`, so merging *is* deploying. Merging before the column exists makes every sign-up and Profile save return 400.
- **Never touch scores or fines.** Live testing is restricted to the author's own player record and to the `dgu_number` column only.
- **No `2>&1` on git in PowerShell.** It wraps stderr in ErrorRecords and has already caused a false failure and a hang in this repo. Run git plainly.
- Follow existing house style: compact inline handlers, `btn btn-ghost btn-sm` classes, `fgi` form groups, `toast()` on success, `alert()` on failure, `setLoading(true,'Saving…')` around awaits.

## Test Approach

The repo has no test harness and this machine has no Node, so tests are in-browser assertions run against a **scratch copy** of `index.html` with `sbUpdate` stubbed — no production rows are touched.

Set up once, reused by every task:

```
COPY  index.html  ->  <scratchpad>/test-profile.html
```

Open `test-profile.html` in Chrome, then run assertions by injecting JS. The standard preamble stubs the write path and seeds fixtures:

```js
window.__writes = [];
window.sbUpdate = async (table, id, patch) => { window.__writes.push({table, id, patch}); return patch; };
window.alert = (m) => { window.__alerts = (window.__alerts||[]).concat(m); };
window.toast = () => {};
window.setLoading = () => {};
players = [
  {id:1, name:'Test One', color:0, hcp_history:[{date:'2026-01-01',value:12.3,note:'x'}], dgu_number:null, is_admin:true},
  {id:2, name:'Test Two', color:1, hcp_history:[], dgu_number:'1-123456', is_admin:false}
];
activeId = 1;
```

Assertions log `PASS`/`FAIL` lines to the console, read back via the browser console reader.

---

### Task 1: Schema migration

**Files:**
- Create: `supabase/add_dgu_number.sql`

**Interfaces:**
- Consumes: nothing
- Produces: `players.dgu_number TEXT NULL` in the live database

- [ ] **Step 1: Write the migration file**

Create `supabase/add_dgu_number.sql`, matching `add_social_member.sql`:

```sql
-- Add DGU membership number to players
-- Run in Supabase SQL Editor (project qvjybtcbymexheqrjkai).
-- Safe to re-run.

ALTER TABLE public.players
  ADD COLUMN IF NOT EXISTS dgu_number TEXT;

-- Grant already covered by grants.sql but included here for completeness
GRANT SELECT, INSERT, UPDATE, DELETE ON public.players TO anon, authenticated;
```

Nullable on purpose: every existing player has no number, and `NOT NULL` would invalidate all existing rows.

- [ ] **Step 2: Run it in Supabase**

Supabase dashboard → project `qvjybtcbymexheqrjkai` → SQL Editor → paste → Run.
Expected: `Success. No rows returned.`

- [ ] **Step 3: Verify the column exists**

In the SQL Editor:

```sql
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'players' AND column_name = 'dgu_number';
```

Expected: exactly one row — `dgu_number | text | YES`.

- [ ] **Step 4: Verify PostgREST exposes it**

Reload the live app, open the console, and confirm a loaded player object has the key:

```js
players[0].hasOwnProperty('dgu_number')   // expect: true
```

If `false`, PostgREST has cached the old schema — Supabase → Settings → API → "Reload schema cache".

- [ ] **Step 5: Commit**

```bash
git add supabase/add_dgu_number.sql
git commit -m "feat(db): add dgu_number column to players"
```

---

### Task 2: DGU validation helper

**Files:**
- Modify: `index.html` — add beside the other small helpers near `currentHcp()` (~line 1056)

**Interfaces:**
- Consumes: nothing
- Produces: `isValidDgu(value) -> boolean`

- [ ] **Step 1: Write the failing test**

Open the scratch copy, run the preamble, then:

```js
const cases = [
  ['900-1831', true],  ['1-123456', true],   ['12-34', true],
  [' 900-1831 ', true],                        // trimmed
  ['9001831', false],                          // no hyphen — ambiguous
  ['900-1831-2', false], ['900-abc', false],
  ['900-', false], ['-1831', false], ['', false],
  [null, false], ['9'.repeat(10)+'-'+'9'.repeat(10), false]  // 21 chars
];
cases.forEach(([input, want]) => {
  let got; try { got = isValidDgu(input); } catch (e) { got = 'THREW: ' + e.message; }
  console.log(got === want ? `PASS ${JSON.stringify(input)}` : `FAIL ${JSON.stringify(input)} got=${got} want=${want}`);
});
```

- [ ] **Step 2: Run it to verify it fails**

Expected: every line `FAIL ... THREW: isValidDgu is not defined`.

- [ ] **Step 3: Write the implementation**

In `index.html`, after `function currentHcp(player){...}`:

```js
function isValidDgu(v){const s=(v||'').trim();return s.length<=20&&/^\d+-\d+$/.test(s);}
```

- [ ] **Step 4: Re-copy the scratch file and re-run**

Expected: all 12 lines `PASS`.

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "feat(profile): add DGU number validation helper"
```

---

### Task 3: Profile screen scaffold, with name and handicap moved in

**Files:**
- Modify: `index.html` — nav (~line 217), new view after `view-history` (~line 384), `showView()` (~line 1203), `renderMyRounds()` header (~line 358-369)

**Interfaces:**
- Consumes: `openEditName()`, `showMyHcp()`, `currentHcp(p)`, `clr(p)`, `isValidDgu`
- Produces: `renderProfile()`, `#view-profile`, `#profileBody`, `#profileTitle`

- [ ] **Step 1: Add the nav tab**

In the `.nav` block, immediately before the Players tab (line ~218):

```html
    <button class="nav-tab" id="tabProfile" onclick="showView('profile',this)">My Profile</button>
```

- [ ] **Step 2: Add the view**

After the closing `</div>` of `view-history` (line ~384), before `<!-- PLAYERS -->`:

```html
  <!-- PROFILE -->
  <div class="view" id="view-profile">
    <div class="panel">
      <div class="ph"><span class="pt" id="profileTitle">My Profile</span></div>
      <div class="pb" id="profileBody"></div>
    </div>
  </div>
```

- [ ] **Step 3: Add `renderProfile()`**

Place next to `renderMyRounds()` (~line 5185):

```js
function renderProfile(){
  const p=players.find(x=>x.id===activeId);
  const body=document.getElementById('profileBody');
  const title=document.getElementById('profileTitle');
  if(!p){title.textContent='My Profile';body.innerHTML='<div class="empty">Select your player profile (top right).</div>';return;}
  title.textContent=p.name;
  const row=(label,value,btn)=>`<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:0.65rem 0;border-bottom:1px solid rgba(255,255,255,0.06)"><div style="min-width:0"><div style="font-size:0.68rem;color:rgba(255,255,255,0.36);text-transform:uppercase;letter-spacing:0.06em">${label}</div><div style="font-size:0.95rem;margin-top:3px">${value}</div></div>${btn||''}</div>`;
  const hcp=currentHcp(p);
  body.innerHTML=
    row('Name',p.name,`<button class="btn btn-ghost btn-sm" onclick="openEditName()">Edit</button>`)+
    row('Handicap Index',hcp!=null?hcp:'—',`<button class="btn btn-warn btn-sm" onclick="showMyHcp()">Update</button>`)+
    row('Colour',`<span style="display:inline-block;width:15px;height:15px;border-radius:50%;background:${clr(p)}"></span>`,'');
}
```

- [ ] **Step 4: Dispatch it in `showView()`**

After the `if(id==='players')` line (~1204):

```js
  if(id==='profile'){renderProfile();}
```

- [ ] **Step 5: Remove the moved buttons from My Rounds**

In the My Rounds panel header, delete these two lines (~362-363):

```html
            <button class="btn btn-warn btn-sm" onclick="showMyHcp()" id="myHcpBtn" style="display:none">Update My HCP</button>
            <button class="btn btn-ghost btn-sm" onclick="openEditName()" id="myNameBtn" style="display:none">Edit Name</button>
```

In `showView()`, simplify the `history` branch (~1203) — the two button ids no longer exist:

```js
  if(id==='history'){renderMyRounds();showHistorySub('rounds',document.querySelector('#view-history .sub-tab'));}
```

Then remove the now-dead `myHcpBtn` show lines at ~5290 and inside `setPlayer` restore at ~5588 (`const hb=document.getElementById('myHcpBtn');if(hb)hb.style.display='inline-block';`). Leave the `myBagBtn` lines alone — Task 4 handles those.

- [ ] **Step 6: Update the callers that re-render after a name or HCP change**

`saveEditName()` (~5415) and `saveMyHcp()` (~5386) both call `renderMyRounds()`. Add `renderProfile()` so the Profile screen refreshes too:

```js
    renderMyRounds();renderProfile();renderGrid();if(isAdmin())renderAdmin();
```

- [ ] **Step 7: Verify in the browser**

Re-copy the scratch file, load it, then:

```js
showView('profile', document.getElementById('tabProfile'));
console.log(document.getElementById('view-profile').classList.contains('active') ? 'PASS view active' : 'FAIL view active');
console.log(document.getElementById('profileTitle').textContent === 'Test One' ? 'PASS title' : 'FAIL title');
console.log(/Handicap Index/.test(document.getElementById('profileBody').innerHTML) ? 'PASS hcp row' : 'FAIL hcp row');
console.log(document.getElementById('myHcpBtn') === null ? 'PASS old button gone' : 'FAIL old button still present');
showView('history', document.getElementById('tabHistory'));
console.log(document.getElementById('myTable') ? 'PASS my rounds still renders' : 'FAIL my rounds broken');
```

Expected: all five `PASS`.

- [ ] **Step 8: Commit**

```bash
git add index.html
git commit -m "feat(profile): add Profile screen with name, handicap and colour"
```

---

### Task 4: Move preferences and My Bag onto Profile

**Files:**
- Modify: `index.html` — Profile view, My Rounds body (~line 379), Players tab header (~line 389), `renderMyRounds()` (~5184), `renderProfile()`

**Interfaces:**
- Consumes: `toggleUnits()`, `getUnits()`, `openBagModal()`, `renderGpsPreferencePanel()`
- Produces: Profile owns `#myGpsPrefWrap`

- [ ] **Step 1: Move the GPS preference container**

Delete this line from the My Rounds body (~379):

```html
      <div id="myGpsPrefWrap" data-open="0"></div>
```

Add it inside `view-profile`, after the closing `</div>` of the panel:

```html
    <div id="myGpsPrefWrap" data-open="0"></div>
```

- [ ] **Step 2: Stop My Rounds rendering it**

In `renderMyRounds()` (~5184), remove the `renderGpsPreferencePanel();` call. Note the early-return branch at ~5177 exits before it anyway — that asymmetry is why the panel currently vanishes for a player with no rounds, and moving it to Profile fixes that.

- [ ] **Step 3: Remove the units button from My Rounds**

Delete from the My Rounds header (~361):

```html
            <button class="btn btn-ghost btn-sm" id="unitsBtn" onclick="toggleUnits()" style="font-weight:700;min-width:34px">m</button>
```

`updateUnitsBtn()` already guards with `if(btn)`, so it stays safe with the element gone.

- [ ] **Step 4: Remove My Bag from the Players tab**

In the Players panel header (~389), delete:

```html
<button class="btn btn-ghost btn-sm" id="myBagBtn" style="display:none" onclick="openBagModal()">🎒 My Bag</button>
```

Then remove the two lines that show it: at ~5588 in the `setPlayer` restore block (`const bb=document.getElementById('myBagBtn');if(bb)bb.style.display='inline-block';`) and any equivalent in `setPlayer()` itself. Search for `myBagBtn` and remove every hit.

- [ ] **Step 5: Add the three rows to `renderProfile()`**

Append to the `body.innerHTML=` chain, after the Colour row:

```js
    row('My Bag','Clubs and carry distances',`<button class="btn btn-ghost btn-sm" onclick="openBagModal()">Edit</button>`)+
    row('Units',getUnits()==='yd'?'Yards':'Metres',`<button class="btn btn-ghost btn-sm" onclick="toggleUnits();renderProfile()">Switch</button>`);
```

Change the preceding Colour row's line ending from `+` to `+` (it now continues) and end the chain on the Units row. Then call the GPS panel at the end of `renderProfile()`:

```js
  renderGpsPreferencePanel();
```

- [ ] **Step 6: Verify in the browser**

```js
showView('profile', document.getElementById('tabProfile'));
const h = document.getElementById('profileBody').innerHTML;
console.log(/My Bag/.test(h) ? 'PASS bag row' : 'FAIL bag row');
console.log(/Metres|Yards/.test(h) ? 'PASS units row' : 'FAIL units row');
console.log(document.getElementById('myGpsPrefWrap').innerHTML.length > 0 ? 'PASS gps panel renders' : 'FAIL gps panel');
console.log(document.getElementById('unitsBtn') === null ? 'PASS units btn gone' : 'FAIL units btn present');
console.log(document.getElementById('myBagBtn') === null ? 'PASS bag btn gone' : 'FAIL bag btn present');
showView('players', document.getElementById('tabPlayers'));
console.log(document.getElementById('playerGrid').innerHTML.length > 0 ? 'PASS roster still renders' : 'FAIL roster broken');
```

Expected: all six `PASS`.

- [ ] **Step 7: Commit**

```bash
git add index.html
git commit -m "feat(profile): move units, GPS mode and My Bag onto Profile"
```

---

### Task 5: DGU field — modal, save path, Profile row, admin row

**Files:**
- Modify: `index.html` — modal block (after `editNameModal`, ~line 614), functions near `saveEditName` (~5417), `renderProfile()`, `renderAdmin()` (~5510)

**Interfaces:**
- Consumes: `isValidDgu()`, `sbUpdate()`, `isAdmin()`, `renderProfile()`, `renderGrid()`, `renderAdmin()`
- Produces: `openEditDgu(id?)`, `saveDguNumber()`, `#editDguModal`

- [ ] **Step 1: Add the modal**

After the `editNameModal` block closes (~line 614):

```html
<div class="modal-bg" id="editDguModal" style="display:none"><div class="modal modal-sm">
  <h3 id="editDguTitle">Membership Number</h3>
  <div style="font-size:0.8rem;color:rgba(255,255,255,0.45);margin-bottom:1rem">Your DGU number — digits, a hyphen, then digits. For example 900-1831 or 1-123456.</div>
  <div style="display:flex;flex-direction:column;gap:10px;margin-bottom:1rem">
    <div class="fgi"><label>DGU Number</label><input type="text" id="editDguVal" placeholder="e.g. 900-1831" maxlength="20"></div>
  </div>
  <div style="display:flex;gap:9px;justify-content:flex-end">
    <button class="btn btn-ghost btn-sm" onclick="closeModal('editDguModal')">Cancel</button>
    <button class="btn btn-primary btn-sm" onclick="saveDguNumber()">Save</button>
  </div>
</div></div>
```

No `inputmode="numeric"` — the hyphen is required and numeric keypads on some Android builds omit it.

- [ ] **Step 2: Write the failing test**

Scratch copy, preamble, then:

```js
window.__writes = []; window.__alerts = [];
activeId = 1;
openEditDgu();
document.getElementById('editDguVal').value = '9001831';
await saveDguNumber();
console.log(window.__writes.length === 0 ? 'PASS invalid rejected' : 'FAIL invalid was written');
console.log((window.__alerts[0]||'').includes('900-1831') ? 'PASS error message' : 'FAIL error message');

document.getElementById('editDguVal').value = '900-1831';
await saveDguNumber();
console.log(window.__writes.length === 1 ? 'PASS valid written' : 'FAIL valid not written');
console.log(window.__writes[0].patch.dgu_number === '900-1831' ? 'PASS stored verbatim' : 'FAIL reformatted: ' + window.__writes[0].patch.dgu_number);
console.log(players.find(p=>p.id===1).dgu_number === '900-1831' ? 'PASS in-memory updated' : 'FAIL in-memory');

await saveDguNumber();   // same value again
console.log(window.__writes.length === 1 ? 'PASS no-op skipped' : 'FAIL redundant write');

activeId = 2; players[0].is_admin = false; players[1].is_admin = false;
window.__alerts = [];
openEditDgu(1);
console.log((window.__alerts[0]||'').includes('own'), 'non-admin blocked from editing others');
```

- [ ] **Step 3: Run it to verify it fails**

Expected: `openEditDgu is not defined`.

- [ ] **Step 4: Implement**

After `saveEditName()` (~5417):

```js
let editingDguPlayerId=null;
function openEditDgu(id){
  const pid=id||activeId;
  if(!pid){alert('Select your player profile first.');return;}
  if(pid!==activeId&&!isAdmin()){alert('You can only edit your own membership number.');return;}
  const p=players.find(x=>x.id===pid);if(!p)return;
  editingDguPlayerId=pid;
  document.getElementById('editDguTitle').textContent='Membership Number — '+p.name;
  document.getElementById('editDguVal').value=p.dgu_number||'';
  document.getElementById('editDguModal').style.display='flex';
  setTimeout(()=>{const el=document.getElementById('editDguVal');el.focus();el.select();},50);
}
async function saveDguNumber(){
  const val=document.getElementById('editDguVal').value.trim();
  const p=players.find(x=>x.id===editingDguPlayerId);if(!p)return;
  if(!isValidDgu(val)){alert('Enter a DGU number as digits, a hyphen, then digits — for example 900-1831.');return;}
  if(val===(p.dgu_number||'')){closeModal('editDguModal');return;}
  setLoading(true,'Saving…');
  try{
    await sbUpdate('players',p.id,{dgu_number:val});
    p.dgu_number=val;
    toast('Membership number updated ✓');closeModal('editDguModal');
    renderProfile();renderGrid();if(isAdmin())renderAdmin();
  }catch(e){alert('Error: '+e.message);}finally{setLoading(false);}
}
```

- [ ] **Step 5: Re-run — expect all PASS**

- [ ] **Step 6: Add the Profile row**

In `renderProfile()`, insert directly after the Name row:

```js
    row('Membership Number',p.dgu_number||'—',`<button class="btn btn-ghost btn-sm" onclick="openEditDgu()">Edit</button>`)+
```

- [ ] **Step 7: Add the admin button and display**

In `renderAdmin()` (~5510), in the button group, after the Edit Email button:

```js
<button class="btn btn-ghost btn-sm" onclick="openEditDgu(${p.id})">Edit DGU</button>
```

And in the same row's sub-line, after the `Current:` handicap span, append:

```js
 · DGU: <strong style="color:var(--gold-l)">${p.dgu_number||'—'}</strong>
```

- [ ] **Step 8: Verify both surfaces**

```js
activeId = 1; players[0].is_admin = true; players[0].dgu_number = '900-1831';
showView('profile', document.getElementById('tabProfile'));
console.log(/900-1831/.test(document.getElementById('profileBody').innerHTML) ? 'PASS profile shows dgu' : 'FAIL profile');
renderAdmin();
console.log(/Edit DGU/.test(document.getElementById('adminHcpPanel').innerHTML) ? 'PASS admin button' : 'FAIL admin button');
console.log(/900-1831/.test(document.getElementById('adminHcpPanel').innerHTML) ? 'PASS admin shows dgu' : 'FAIL admin display');
```

- [ ] **Step 9: Commit**

```bash
git add index.html
git commit -m "feat(profile): add DGU membership number with admin editing"
```

---

### Task 6: Show DGU on the Club Roster

**Files:**
- Modify: `index.html` — `renderGrid()` (~line 5329)

**Interfaces:**
- Consumes: `p.dgu_number`
- Produces: nothing

- [ ] **Step 1: Add it to the card sub-line**

Replace the sub-line (~5329):

```js
        <div style="font-size:0.7rem;color:rgba(255,255,255,0.36)">${currentHcp(p)!=null?'HCP '+currentHcp(p)+' · ':''}${allRounds.filter(r=>r.player_id===p.id).length} rounds</div>
```

with:

```js
        <div style="font-size:0.7rem;color:rgba(255,255,255,0.36)">${currentHcp(p)!=null?'HCP '+currentHcp(p)+' · ':''}${allRounds.filter(r=>r.player_id===p.id).length} rounds${p.dgu_number?' · DGU '+p.dgu_number:''}</div>
```

A player without a number shows no DGU segment at all — no dangling separator.

- [ ] **Step 2: Verify**

```js
players[0].dgu_number='900-1831'; players[1].dgu_number=null;
renderGrid();
const g = document.getElementById('playerGrid').innerHTML;
console.log(/DGU 900-1831/.test(g) ? 'PASS shows number' : 'FAIL shows number');
console.log(!/DGU\s*·|·\s*DGU\s*<//.test(g) ? 'PASS no dangling separator' : 'FAIL dangling separator');
```

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "feat(players): show DGU number on the club roster"
```

---

### Task 7: Require DGU at sign-up

**Files:**
- Modify: `index.html` — sign-up form (~line 179-180), `signupPlayer()` (~line 1135-1153)

**Interfaces:**
- Consumes: `isValidDgu()`
- Produces: `dgu_number` on the insert payload

- [ ] **Step 1: Add the field**

Between the Email and Handicap inputs (after line ~179):

```html
        <div class="fgi"><label>DGU Number</label><input type="text" id="signupDgu" placeholder="e.g. 900-1831" maxlength="20"></div>
```

- [ ] **Step 2: Write the failing test**

```js
window.__inserts = [];
window.sbInsert = async (t,p) => { window.__inserts.push({t,p}); return p; };
const set = (id,v) => document.getElementById(id).value = v;
set('signupName','Tester'); set('signupEmail','t@example.com');
set('signupPin','1234'); set('signupPinConfirm','1234'); set('signupHcp','14.2');

set('signupDgu','');            await signupPlayer();
console.log(window.__inserts.length===0 ? 'PASS empty rejected' : 'FAIL empty accepted');
set('signupDgu','9001831');     await signupPlayer();
console.log(window.__inserts.length===0 ? 'PASS malformed rejected' : 'FAIL malformed accepted');
console.log(/900-1831/.test(document.getElementById('signupError').textContent) ? 'PASS message shows example' : 'FAIL message');
set('signupDgu','900-1831');    await signupPlayer();
console.log(window.__inserts.length===1 ? 'PASS valid accepted' : 'FAIL valid rejected');
console.log(window.__inserts[0].p.dgu_number==='900-1831' ? 'PASS payload verbatim' : 'FAIL payload: '+window.__inserts[0].p.dgu_number);
```

- [ ] **Step 3: Run it — expect failures** (no `signupDgu` element yet, or no validation)

- [ ] **Step 4: Implement**

In `signupPlayer()`, read the value alongside the other fields:

```js
  const dgu=document.getElementById('signupDgu').value.trim();
```

Add validation after the PIN-match check (~line 1147), keeping the established `signupError` pattern:

```js
  if(!isValidDgu(dgu)){err.textContent='Enter your DGU number as digits, a hyphen, then digits — for example 900-1831.';err.style.display='block';return;}
```

Add it to the payload (~line 1150):

```js
  const payload={id:Date.now(),name,email,dgu_number:dgu,color:nextColor,handicap:hcpVal,hcp_history:hcpVal!=null?[{date:today(),value:hcpVal,note:'Sign-up entry'}]:[],approved:false,pin};
```

- [ ] **Step 5: Re-run — expect all five PASS**

- [ ] **Step 6: Commit**

```bash
git add index.html
git commit -m "feat(signup): require a DGU number at registration"
```

---

### Task 8: Full regression pass, live verification, and merge

**Files:** none modified unless a defect is found

**Interfaces:**
- Consumes: everything above
- Produces: `main` updated and live

- [ ] **Step 1: Full stubbed regression on the scratch copy**

Re-copy `index.html` fresh, then confirm every moved control still works from Profile and nothing was orphaned:

```js
['tabProfile','view-profile','profileBody','editDguModal','signupDgu'].forEach(id =>
  console.log(document.getElementById(id) ? `PASS ${id} exists` : `FAIL ${id} missing`));
['myHcpBtn','myNameBtn','unitsBtn','myBagBtn'].forEach(id =>
  console.log(document.getElementById(id) === null ? `PASS ${id} removed` : `FAIL ${id} still present`));
['renderProfile','openEditDgu','saveDguNumber','isValidDgu'].forEach(fn =>
  console.log(typeof window[fn] === 'function' ? `PASS ${fn} defined` : `FAIL ${fn} missing`));
console.log(/myBagBtn|myHcpBtn|myNameBtn|unitsBtn/.test(document.documentElement.innerHTML) ? 'CHECK stale id reference remains' : 'PASS no stale id references');
```

- [ ] **Step 2: Click through every view in the browser**

Visit Leaderboards, Log Round, Sign Up, Tee Sheet, My Rounds (both sub-tabs), My Profile, Players, Rules. Confirm no view throws. Read the console for errors:

Expected: no uncaught exceptions, in particular no `Cannot read properties of null` from a removed element.

- [ ] **Step 3: Live verification — author's own record only**

Against the real app, signed in as the author. **Touch `dgu_number` only. Do not edit or delete any score, round or fine.**

1. Note the current value (expected: none).
2. Profile → Membership Number → Edit → `900-1831` → Save → toast appears.
3. Confirm it shows on Profile, on the Club Roster card, and in the Admin row.
4. Reload the page → value persisted.
5. Edit → `9001831` → Save → rejected, nothing written; reload confirms `900-1831` still stored.
6. Leave `900-1831` in place — it is the author's real number.

- [ ] **Step 4: Confirm the migration is already live**

This is the ordering constraint. Re-verify before merging:

```sql
SELECT column_name FROM information_schema.columns
WHERE table_name='players' AND column_name='dgu_number';
```

Expected: one row. **If this returns nothing, stop — do not merge.**

- [ ] **Step 5: Push the branch**

```bash
git push -u origin feature/profile-screen
```

- [ ] **Step 6: Merge to main — this deploys to production**

Requires explicit confirmation from the repo owner first.

```bash
git checkout main
git merge --no-ff feature/profile-screen -m "feat: Profile screen + DGU membership number"
git push origin main
```

- [ ] **Step 7: Verify the live site**

Hard-reload the GitHub Pages URL (GitHub Pages caches aggressively; allow a minute). Confirm the My Profile tab appears and the DGU number shows.

- [ ] **Step 8: Update project documentation**

`CLAUDE.md` is now stale in three places. Update in one commit:

- **players table** — add `dgu_number text (DGU membership number, "nnn-nnnn" shape, variable length)`
- **Navigation tabs** — add `My Profile`, and correct `My Rounds` (it no longer holds HCP update)
- **Players can:** — add "set their own membership number"

```bash
git add CLAUDE.md
git commit -m "docs: record Profile screen and dgu_number column"
git push origin main
```

---

## Self-Review

**Spec coverage:** migration → Task 1; validation rule → Task 2; Profile screen → Task 3; what-moves table → Tasks 3-4; `saveDguNumber` → Task 5; sign-up requirement → Task 7; admin editing → Task 5; display in all three places → Tasks 5-6; deployment ordering → Task 8 Steps 4-6; testing → every task plus Task 8. No gaps.

**Type consistency:** `isValidDgu(v)` returns boolean, used identically in Tasks 5 and 7. `openEditDgu(id?)` takes an optional id in both the Profile (no arg) and admin (with id) call sites, matching `openEditName`. `dgu_number` is the column, payload key and in-memory property name throughout — never `dguNumber`.

**Known risk:** Tasks 3-4 delete DOM ids that other code may reference. Task 8 Step 1 greps the built document for the four removed ids specifically to catch a missed reference, and Step 2 exercises every view to surface a null dereference.
