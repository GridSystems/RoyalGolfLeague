# Tee Management Admin UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move tees from a hardcoded JS array to Supabase, and add a full CRUD admin panel so admins can add, edit, and archive tees without touching code.

**Architecture:** Five tasks in order — schema first, then data layer (global + loadData + getTee), then UI shell, then render logic, then action functions. Each task is independently committable. Tasks 2–5 all touch `index.html` only; Task 1 touches `supabase/grants.sql` and Supabase directly.

**Tech Stack:** Vanilla JS, Supabase REST (`sbGet`/`sbInsert`/`sbUpdate`), single-file HTML app, no build step.

---

## File Structure

- `supabase/grants.sql` — add tees grant (Task 1)
- `index.html` — all other changes (Tasks 2–5)

---

## Supabase helpers reference (read before implementing)

```javascript
// All already exist in index.html — use them as-is:
sbGet(table, params)          // GET, returns array
sbInsert(table, body)         // POST with return=representation, returns array of rows
sbUpdate(table, id, body)     // PATCH ?id=eq.{id}, returns array
// For tees: id is a text PK (e.g. 'champion'), not a bigint — this is fine for sbUpdate/sbDelete
```

---

### Task 1: Supabase tees table + grants

**Files:**
- Modify: `supabase/grants.sql`
- Action: run SQL in Supabase SQL Editor (project `qvjybtcbymexheqrjkai`)

---

- [ ] **Step 1: Create the tees table in Supabase**

Open the Supabase SQL Editor and run:

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

GRANT SELECT, INSERT, UPDATE, DELETE ON public.tees TO anon, authenticated;
```

After running, verify in Supabase Table Editor that the `tees` table appears with the correct columns and is empty.

- [ ] **Step 2: Add grant to grants.sql**

Open `supabase/grants.sql`. The file currently ends at line 19 with:
```sql
GRANT SELECT, INSERT, UPDATE, DELETE ON public.green_polygons   TO anon, authenticated;
```

Add one line after it:
```sql
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tees             TO anon, authenticated;
```

- [ ] **Step 3: Commit**

```bash
cd "C:\Users\ChrisNel\OneDrive - Grid Systems\Repos\RoyalGolfClub\RoyalGolfClub"
git add supabase/grants.sql
git commit -m "feat(tees): add tees table + grant"
```

---

### Task 2: TEES → tees global, loadData, seedTees, getTee, buildTeeSelectorEl

**Context:** `const TEES` (line 728) is a hardcoded array of 7 tee objects. It is referenced in exactly three places: the definition itself, `getTee()` (line 787), and `buildTeeSelectorEl()` (line 2271). This task replaces it with a mutable `let tees=[]` loaded from Supabase on init, seeds it on first run, and updates all three references.

**Files:**
- Modify: `index.html:728-736` — replace const TEES with let tees
- Modify: `index.html:787` — update getTee
- Modify: `index.html:871` — update loadData to fetch tees + call seedTees
- Modify: `index.html:872` — add seedTees() after loadData
- Modify: `index.html:2271` — update buildTeeSelectorEl to use tees and filter archived

---

- [ ] **Step 1: Replace const TEES declaration with let tees**

Find lines 728–736 (the entire TEES array):
```javascript
const TEES=[
  {id:'champion',name:'Royal Champion',color:'#222',rating:77.9,slope:153,dist:[477,333,527,138,359,426,150,389,396,372,366,410,150,523,428,197,494,438]},
  {id:'platinum',name:'Royal Platinum',color:'#b0a0c0',rating:77.6,slope:153,dist:[432,333,527,138,359,426,150,389,396,372,366,410,150,523,428,197,476,438]},
  {id:'62',name:'62 Tee',color:'#e0d8b0',rating:76.2,slope:149,dist:[402,333,496,138,338,396,150,389,396,332,366,392,150,494,428,138,445,438]},
  {id:'57',name:'57 Tee',color:'#f5e840',rating:73.1,slope:144,dist:[371,318,466,119,305,363,127,354,374,300,337,362,129,431,382,124,424,404]},
  {id:'54',name:'54 Tee',color:'#4a8ce8',rating:71.3,slope:141,dist:[329,241,384,119,305,319,90,354,374,284,288,362,129,383,332,104,424,404]},
  {id:'50',name:'50 Tee',color:'#e84848',rating:69.5,slope:134,dist:[329,241,384,99,283,319,90,303,335,284,288,332,105,383,332,104,406,368]},
  {id:'43',name:'43 Tee',color:'#f0a030',rating:66.0,slope:125,dist:[282,211,347,79,255,250,50,266,296,235,274,289,85,351,304,70,313,359]},
];
```

Replace the entire block with:
```javascript
let tees=[];
const _TEES_SEED=[
  {id:'champion',name:'Royal Champion',color:'#222',rating:77.9,slope:153,dist:[477,333,527,138,359,426,150,389,396,372,366,410,150,523,428,197,494,438]},
  {id:'platinum',name:'Royal Platinum',color:'#b0a0c0',rating:77.6,slope:153,dist:[432,333,527,138,359,426,150,389,396,372,366,410,150,523,428,197,476,438]},
  {id:'62',name:'62 Tee',color:'#e0d8b0',rating:76.2,slope:149,dist:[402,333,496,138,338,396,150,389,396,332,366,392,150,494,428,138,445,438]},
  {id:'57',name:'57 Tee',color:'#f5e840',rating:73.1,slope:144,dist:[371,318,466,119,305,363,127,354,374,300,337,362,129,431,382,124,424,404]},
  {id:'54',name:'54 Tee',color:'#4a8ce8',rating:71.3,slope:141,dist:[329,241,384,119,305,319,90,354,374,284,288,362,129,383,332,104,424,404]},
  {id:'50',name:'50 Tee',color:'#e84848',rating:69.5,slope:134,dist:[329,241,384,99,283,319,90,303,335,284,288,332,105,383,332,104,406,368]},
  {id:'43',name:'43 Tee',color:'#f0a030',rating:66.0,slope:125,dist:[282,211,347,79,255,250,50,266,296,235,274,289,85,351,304,70,313,359]},
];
```

The seed data is kept as `_TEES_SEED` so `seedTees()` (added in Step 4) can use it without re-hardcoding the values.

- [ ] **Step 2: Update getTee()**

Find line 787:
```javascript
const getTee=id=>TEES.find(t=>t.id===id)||TEES[1];
```

Replace with:
```javascript
const getTee=id=>tees.find(t=>t.id===id)||tees.find(t=>t.id==='platinum')||tees[0];
```

- [ ] **Step 3: Update loadData() to fetch tees**

Find the start of `loadData` at line 871. The line begins:
```javascript
async function loadData(){const all=await sbGet('players',
```

Change only the opening of the function — add the tees fetch as the very first two statements. Find this exact text:
```javascript
async function loadData(){const all=await sbGet('players','order=created_at.asc');
```

Replace with:
```javascript
async function loadData(){tees=await sbGet('tees','order=archived.asc,name.asc');if(tees.length===0)await seedTees();const all=await sbGet('players','order=created_at.asc');
```

- [ ] **Step 4: Add seedTees() after loadData**

Find line 872 (the blank line after `loadData`):
```javascript

// ── Admin ─────────────────────────────────────────────────────────────────────
```

Insert the `seedTees` function in the blank line before the Admin comment:
```javascript
async function seedTees(){try{const rows=await sbInsert('tees',_TEES_SEED);tees=rows;}catch(e){console.warn('seedTees failed:',e);tees=[..._TEES_SEED];}}
```

So the block reads:
```javascript
async function seedTees(){try{const rows=await sbInsert('tees',_TEES_SEED);tees=rows;}catch(e){console.warn('seedTees failed:',e);tees=[..._TEES_SEED];}}

// ── Admin ─────────────────────────────────────────────────────────────────────
```

- [ ] **Step 5: Update buildTeeSelectorEl() to use tees and filter archived**

Find line 2271:
```javascript
function buildTeeSelectorEl(cid,active,sv){const el=document.getElementById(cid);if(!el)return;el.innerHTML=TEES.map(t=>`<div class="tee-opt${t.id===active?' selected':''}" onclick="selectTee('${cid}','${t.id}','${sv}')"><span class="tee-dot" style="background:${t.color};border:1px solid rgba(255,255,255,0.25)"></span>${t.name} <span style="font-size:0.68rem;color:rgba(255,255,255,0.32)">${t.rating}/${t.slope}</span></div>`).join('');}
```

Replace with:
```javascript
function buildTeeSelectorEl(cid,active,sv){const el=document.getElementById(cid);if(!el)return;el.innerHTML=tees.filter(t=>!t.archived).map(t=>`<div class="tee-opt${t.id===active?' selected':''}" onclick="selectTee('${cid}','${t.id}','${sv}')"><span class="tee-dot" style="background:${t.color};border:1px solid rgba(255,255,255,0.25)"></span>${t.name} <span style="font-size:0.68rem;color:rgba(255,255,255,0.32)">${t.rating}/${t.slope}</span></div>`).join('');}
```

The only change is `TEES.map(` → `tees.filter(t=>!t.archived).map(`.

- [ ] **Step 6: Verify in browser**

Open the app. On the Leaderboard, the tee selectors in Log Round should still show all 7 tees (they'll now come from Supabase, seeded on first load).

Open Supabase Table Editor → `tees` table. Confirm 7 rows exist with correct data and `archived = false`.

- [ ] **Step 7: Commit**

```bash
cd "C:\Users\ChrisNel\OneDrive - Grid Systems\Repos\RoyalGolfClub\RoyalGolfClub"
git add index.html
git commit -m "feat(tees): move TEES to Supabase — global, loadData, seedTees, getTee, buildTeeSelectorEl"
```

---

### Task 3: Admin panel HTML + renderAdmin wiring

**Context:** The admin view (`#view-admin`) has several panels: info-box, pendingApprovalsPanel, bulkEntryPanel, HCP panel, All Rounds, Fines, Saturday. We add a Tees panel immediately after the info-box (before pendingApprovalsPanel). We also call `renderAdminTees()` from `renderAdmin()`.

**Files:**
- Modify: `index.html:495` — add panel HTML after info-box closing tag
- Modify: `index.html:3950` — add renderAdminTees() call in renderAdmin()

---

- [ ] **Step 1: Add Tees panel HTML to the admin view**

Find this exact text (the closing of the info-box and start of pendingApprovalsPanel, around line 495–496):
```html
      <button class="btn btn-ghost btn-sm" onclick="document.getElementById('changePinModal').style.display='flex'">Change Admin PIN</button>
    </div>
    <div class="panel" id="pendingApprovalsPanel" style="display:none">
```

Replace with:
```html
      <button class="btn btn-ghost btn-sm" onclick="document.getElementById('changePinModal').style.display='flex'">Change Admin PIN</button>
    </div>
    <div class="panel" id="adminTeesPanel">
      <div class="ph">
        <span class="pt">Tees</span>
        <button class="btn btn-ghost btn-sm" onclick="openAddTee()">+ Add Tee</button>
      </div>
      <div class="pb" id="adminTeesBody"></div>
    </div>
    <div class="panel" id="pendingApprovalsPanel" style="display:none">
```

- [ ] **Step 2: Wire renderAdminTees() into renderAdmin()**

Find `renderAdmin()` (around line 3945). It ends with:
```javascript
  renderAdminRounds();
}
```

Replace with:
```javascript
  renderAdminRounds();
  renderAdminTees();
}
```

- [ ] **Step 3: Verify in browser**

Log in as admin. Go to Admin tab. A "Tees" panel should appear near the top with a "+ Add Tee" button. The body will be empty (no error) because `renderAdminTees()` doesn't exist yet — that's Task 4. Confirm no JS errors in the console from this change alone. (The `onclick="openAddTee()"` will error if clicked, which is expected.)

- [ ] **Step 4: Commit**

```bash
cd "C:\Users\ChrisNel\OneDrive - Grid Systems\Repos\RoyalGolfClub\RoyalGolfClub"
git add index.html
git commit -m "feat(tees): admin panel HTML shell + renderAdmin wiring"
```

---

### Task 4: renderAdminTees() + getTeeDistFromInputs() + openAddTee()

**Context:** Adds the render function that builds the tee table, the edit/add inline form, and the helper that reads the 18 distance inputs. These are display-only — the save/archive actions come in Task 5.

**Files:**
- Modify: `index.html` — add state vars and functions in the Admin functions section (around line 3944)

---

- [ ] **Step 1: Add state variables**

Find the Admin functions comment (around line 3944):
```javascript
// ── Admin functions ───────────────────────────────────────────────────────────
function renderAdmin(){
```

Insert two state variables immediately before `renderAdmin`:
```javascript
let _editingTeeId=null,_addingTee=false;
// ── Admin functions ───────────────────────────────────────────────────────────
function renderAdmin(){
```

- [ ] **Step 2: Add getTeeDistFromInputs() helper**

Find the line `function renderAdmin(){` (around line 3945, now shifted by 1). Add `getTeeDistFromInputs` immediately before it:

```javascript
function getTeeDistFromInputs(){const vals=Array.from({length:18},(_,i)=>{const v=document.getElementById('teeDistEdit_'+i)?.value;return v!==''&&v!=null?parseInt(v):null;});return vals.every(v=>v===null)?null:vals;}
```

- [ ] **Step 3: Add openAddTee() function**

Add immediately after `getTeeDistFromInputs`:
```javascript
function openAddTee(){_editingTeeId=null;_addingTee=!_addingTee;renderAdminTees();}
```

- [ ] **Step 4: Add renderAdminTees() function**

Add immediately after `openAddTee`:

```javascript
function renderAdminTees(){
  const el=document.getElementById('adminTeesBody');if(!el)return;
  const active=tees.filter(t=>!t.archived);
  const archived=tees.filter(t=>t.archived);
  const editForm=(t)=>{
    const dist=t?.dist||Array(18).fill(null);
    const distRow=(start)=>Array.from({length:9},(_,i)=>`<div style="text-align:center"><div style="font-size:0.6rem;color:rgba(255,255,255,0.3)">${start+i+1}</div><input type="number" id="teeDistEdit_${start+i}" value="${dist[start+i]??''}" min="0" max="999" style="width:100%;padding:2px;text-align:center;font-size:0.72rem;background:rgba(0,0,0,0.3);border:1px solid rgba(255,255,255,0.1);border-radius:3px;color:var(--cream)"></div>`).join('');
    return`<div style="padding:10px 0;border-bottom:1px solid rgba(255,255,255,0.06)"><div style="display:grid;grid-template-columns:1fr 80px 70px 50px;gap:8px;margin-bottom:8px;align-items:center"><input id="teeEditName" type="text" value="${t?.name||''}" placeholder="Tee name" style="background:rgba(0,0,0,0.3);border:1px solid rgba(255,255,255,0.12);border-radius:6px;color:var(--cream);padding:6px 10px;font-size:0.85rem"><input id="teeEditRating" type="number" value="${t?.rating||''}" placeholder="CR" step="0.1" min="50" max="90" style="background:rgba(0,0,0,0.3);border:1px solid rgba(255,255,255,0.12);border-radius:6px;color:var(--cream);padding:6px;font-size:0.85rem;text-align:center"><input id="teeEditSlope" type="number" value="${t?.slope||''}" placeholder="Slope" min="55" max="155" style="background:rgba(0,0,0,0.3);border:1px solid rgba(255,255,255,0.12);border-radius:6px;color:var(--cream);padding:6px;font-size:0.85rem;text-align:center"><input id="teeEditColor" type="color" value="${t?.color||'#888888'}" style="width:100%;height:34px;border:1px solid rgba(255,255,255,0.12);border-radius:6px;background:rgba(0,0,0,0.3);cursor:pointer;padding:2px"></div><div style="font-size:0.72rem;color:rgba(255,255,255,0.35);margin-bottom:4px">Distances (m) — optional</div><div style="display:grid;grid-template-columns:repeat(9,1fr);gap:3px;margin-bottom:4px">${distRow(0)}</div><div style="display:grid;grid-template-columns:repeat(9,1fr);gap:3px;margin-bottom:10px">${distRow(9)}</div><div class="fa"><button class="btn btn-ghost btn-sm" onclick="_editingTeeId=null;_addingTee=false;renderAdminTees()">Cancel</button><button class="btn btn-primary btn-sm" onclick="${t?`saveTeeEdit('${t.id}')`:'addTee()'}">${t?'Save Changes':'Add Tee'}</button></div></div>`;
  };
  const teeRow=(t)=>{
    if(_editingTeeId===t.id)return editForm(t);
    return`<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.06);${t.archived?'opacity:0.45':''}"><div style="width:14px;height:14px;border-radius:50%;background:${t.color};border:1px solid rgba(255,255,255,0.2);flex-shrink:0"></div><div style="flex:1;font-size:0.85rem">${t.name}</div><div style="font-size:0.78rem;color:rgba(255,255,255,0.45);white-space:nowrap">CR ${t.rating} / ${t.slope}</div><button class="btn btn-ghost btn-sm" onclick="_editingTeeId='${t.id}';_addingTee=false;renderAdminTees()">Edit</button><button class="btn btn-ghost btn-sm" onclick="archiveTee('${t.id}')">${t.archived?'Restore':'Archive'}</button></div>`;
  };
  let html='';
  if(_addingTee)html+=editForm(null);
  html+=active.map(t=>teeRow(t)).join('');
  if(archived.length)html+=`<div style="font-size:0.72rem;color:rgba(255,255,255,0.25);padding:10px 0 4px;text-transform:uppercase;letter-spacing:0.05em">Archived</div>`+archived.map(t=>teeRow(t)).join('');
  el.innerHTML=html||'<div class="empty">No tees.</div>';
}
```

- [ ] **Step 5: Verify in browser**

Log in as admin → Admin tab → Tees panel.

- The 7 tees should appear as rows: colour swatch / name / CR / Slope / Edit / Archive
- Tap **Edit** on Royal Champion: the row should expand to show the edit form with name, CR, slope, color, and two rows of 9 distance inputs (pre-filled with champion's distances)
- Tap **Cancel**: form collapses, row returns
- Tap **+ Add Tee**: a blank form appears at the top of the list
- The form's Save button calls `saveTeeEdit` or `addTee` (not yet implemented — clicking Save will error, which is expected at this stage)

- [ ] **Step 6: Commit**

```bash
cd "C:\Users\ChrisNel\OneDrive - Grid Systems\Repos\RoyalGolfClub\RoyalGolfClub"
git add index.html
git commit -m "feat(tees): renderAdminTees, editForm, openAddTee, getTeeDistFromInputs"
```

---

### Task 5: saveTeeEdit() + addTee() + archiveTee()

**Context:** The three action functions that write to Supabase, update the in-memory `tees` array, and refresh the UI. After each action, all tee selectors are rebuilt so the change is reflected immediately throughout the app.

**Files:**
- Modify: `index.html` — add three functions after `renderAdminTees()`

---

- [ ] **Step 1: Add saveTeeEdit()**

Add immediately after `renderAdminTees()`:

```javascript
async function saveTeeEdit(id){
  const name=document.getElementById('teeEditName').value.trim();
  const color=document.getElementById('teeEditColor').value;
  const rating=parseFloat(document.getElementById('teeEditRating').value);
  const slope=parseInt(document.getElementById('teeEditSlope').value);
  if(!name||isNaN(rating)||isNaN(slope)){alert('Name, CR and Slope are required.');return;}
  const dist=getTeeDistFromInputs();
  setLoading(true,'Saving…');
  try{
    await sbUpdate('tees',id,{name,color,rating,slope,dist});
    const t=tees.find(x=>x.id===id);
    if(t)Object.assign(t,{name,color,rating,slope,dist});
    _editingTeeId=null;
    renderAdminTees();
    _refreshTeeSelectors();
    toast('Tee updated ✓');
  }catch(e){alert('Error: '+e.message);}
  finally{setLoading(false);}
}
```

- [ ] **Step 2: Add addTee()**

Add immediately after `saveTeeEdit`:

```javascript
async function addTee(){
  const name=document.getElementById('teeEditName').value.trim();
  const color=document.getElementById('teeEditColor').value;
  const rating=parseFloat(document.getElementById('teeEditRating').value);
  const slope=parseInt(document.getElementById('teeEditSlope').value);
  if(!name||isNaN(rating)||isNaN(slope)){alert('Name, CR and Slope are required.');return;}
  const dist=getTeeDistFromInputs();
  let base=name.toLowerCase().replace(/\s+/g,'-').replace(/[^a-z0-9-]/g,'');
  let id=base,n=2;
  while(tees.find(t=>t.id===id)){id=base+'-'+n++;}
  setLoading(true,'Saving…');
  try{
    const rows=await sbInsert('tees',{id,name,color,rating,slope,dist,archived:false});
    tees.push(rows?.[0]||{id,name,color,rating,slope,dist,archived:false});
    _addingTee=false;
    renderAdminTees();
    _refreshTeeSelectors();
    toast('Tee added ✓');
  }catch(e){alert('Error: '+e.message);}
  finally{setLoading(false);}
}
```

- [ ] **Step 3: Add archiveTee()**

Add immediately after `addTee`:

```javascript
async function archiveTee(id){
  const t=tees.find(x=>x.id===id);if(!t)return;
  if(!t.archived){
    const inUse=[selTeeId,BE?.teeId,typeof erSelTeeId!=='undefined'?erSelTeeId:null,typeof gpsTeeId!=='undefined'?gpsTeeId:null].filter(Boolean);
    if(inUse.includes(id)){toast('Cannot archive — tee is currently selected');return;}
  }
  setLoading(true,'Saving…');
  try{
    await sbUpdate('tees',id,{archived:!t.archived});
    t.archived=!t.archived;
    renderAdminTees();
    _refreshTeeSelectors();
    toast(t.archived?'Tee archived':'Tee restored');
  }catch(e){alert('Error: '+e.message);}
  finally{setLoading(false);}
}
```

- [ ] **Step 4: Add _refreshTeeSelectors() helper**

Add immediately after `archiveTee`:

```javascript
function _refreshTeeSelectors(){
  buildTeeSelectorEl('teeSelector',selTeeId,'selTeeId');
  buildTeeSelectorEl('beTeeSelector',BE?.teeId||'platinum','beTeeId');
  buildTeeSelectorEl('erTeeSelector',typeof erSelTeeId!=='undefined'?erSelTeeId:'platinum','erSelTeeId');
  buildTeeSelectorEl('gpsTeeSelector',typeof gpsTeeId!=='undefined'?gpsTeeId:'platinum','gpsTeeId');
}
```

(`buildTeeSelectorEl` already has a null-check guard so calling it with a non-existent container ID is safe.)

- [ ] **Step 5: Verify all actions in browser**

Log in as admin → Admin tab → Tees panel.

**Edit test:**
1. Tap **Edit** on "57 Tee"
2. Change the CR from `73.1` to `73.5`
3. Tap **Save Changes**
4. Expected: toast "Tee updated ✓", row shows CR `73.5`
5. Open Supabase Table Editor → tees → confirm `57` row has `rating = 73.5`
6. Go to Log Round: the 57 Tee selector option should now show `73.5/144`

**Add test:**
1. Tap **+ Add Tee**
2. Enter Name: `Test Tee`, CR: `70.0`, Slope: `130`, leave colour at default
3. Tap **Add Tee**
4. Expected: toast "Tee added ✓", new row appears in active tees list
5. Check Supabase: a new row with `id='test-tee'` (or similar slug)
6. Go to Log Round: Test Tee should appear in the tee selector

**Archive test:**
1. Tap **Archive** on "Test Tee"
2. Expected: toast "Tee archived", row moves to Archived section (greyed out) with a "Restore" button
3. Go to Log Round: Test Tee should NOT appear in the tee selector
4. Tap **Restore** on Test Tee in the Archived section
5. Expected: row moves back to active, Log Round selector shows it again

**In-use guard test:**
1. On Log Round, select the 43 Tee
2. Go to Admin → Tees → tap Archive on 43 Tee
3. Expected: toast "Cannot archive — tee is currently selected" and tee remains active

- [ ] **Step 6: Commit**

```bash
cd "C:\Users\ChrisNel\OneDrive - Grid Systems\Repos\RoyalGolfClub\RoyalGolfClub"
git add index.html
git commit -m "feat(tees): saveTeeEdit, addTee, archiveTee, _refreshTeeSelectors"
```
