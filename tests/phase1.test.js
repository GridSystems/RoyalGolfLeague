// Phase 1 — database-assigned ids, archive instead of delete, old browser ids translated.
// Run: tests/run.ps1 -Test tests/phase1.test.js
setTimeout(async function(){
  const out=[];const T=(name,cond,detail='')=>out.push((cond?'PASS ':'FAIL ')+name+(cond?'':' :: '+detail));
  const calls=[];let respond=()=>[];
  window.fetch=async(url,opts={})=>{url=String(url);const body=opts.body?JSON.parse(opts.body):null;calls.push({url,method:opts.method||'GET',body});
    const b=respond(url,body,opts.method||'GET');return{ok:true,status:b===undefined?204:200,json:async()=>b,text:async()=>b===undefined?'':JSON.stringify(b)};};
  const stubFetch=fn=>{calls.length=0;respond=fn;};
  // Inserts echo the body back with a database id, like PostgREST with return=representation.
  const echoInsert=(id)=>(u,b,m)=>m==='POST'&&!u.includes('/rpc/')?(Array.isArray(b)?b.map((r,i)=>({...r,id:id+i})):[{...b,id}]):[];
  window.toast=()=>{};window.setLoading=()=>{};window.confirm=()=>true;window.alert=m=>{window.__alert=m;};
  ['updateAdminUI','renderFineTypesList','closeModal','renderAdmin','renderFinesLb','renderSaturdayAdmin','renderSaturdayView','renderPendingApprovals'].forEach(f=>{if(typeof window[f]==='function')window[f]=()=>{};});
  try{
    // ── Task 5: no invented ids ──
    const html=document.documentElement.outerHTML;
    T('only the 3 in-memory GPS fallbacks still make timestamp ids',(html.match(/\bid: ?Date\.now\(\)/g)||[]).length===3,String((html.match(/\bid: ?Date\.now\(\)/g)||[]).length));

    players=[{id:1,name:'Ann',is_admin:true,color:0,hcp_history:[]}];activeId=1;
    stubFetch(echoInsert(42));
    document.getElementById('newName').value='Bo';document.getElementById('newHcp').value='';
    await addPlayer();
    const ins=calls.find(c=>c.method==='POST'&&c.url.includes('/players'));
    T('addPlayer sends no id',ins&&!('id' in ins.body),JSON.stringify(ins?.body));
    T('addPlayer keeps the saved row (database id)',players.some(p=>p.id===42&&p.name==='Bo'),JSON.stringify(players));

    fineTypes=[];stubFetch(echoInsert(7));
    document.getElementById('newFineTypeName').value='Late';document.getElementById('newFineTypeAmount').value='10';
    await addFineType();
    const ft=calls.find(c=>c.method==='POST');
    T('addFineType sends no id',ft&&!('id' in ft.body),JSON.stringify(ft?.body));
    T('addFineType keeps the saved row',fineTypes.some(f=>f.id===7),JSON.stringify(fineTypes));

    finePayments=[];stubFetch(echoInsert(9));
    document.getElementById('payPlayer').innerHTML='<option value="1">Ann</option>';document.getElementById('payPlayer').value='1';
    document.getElementById('payAmount').value='50';document.getElementById('payDate').value='2026-09-24';document.getElementById('payNote').value='';
    await submitPayment();
    const pm=calls.find(c=>c.method==='POST');
    T('submitPayment sends no id',pm&&!('id' in pm.body),JSON.stringify(pm?.body));
    T('submitPayment keeps the saved row',finePayments.some(p=>p.id===9),JSON.stringify(finePayments));

    stubFetch(echoInsert(55));
    ['signupName','signupEmail','signupDgu','signupHcp','signupPin','signupPinConfirm'].forEach(id=>document.getElementById(id).value='');
    document.getElementById('signupName').value='Cy';document.getElementById('signupEmail').value='cy@x.dk';document.getElementById('signupDgu').value='900-1';
    document.getElementById('signupPin').value='1234';document.getElementById('signupPinConfirm').value='1234';
    await submitSignup();
    const su=calls.find(c=>c.method==='POST'&&c.url.includes('/players'));
    T('sign-up sends no id',su&&!('id' in su.body),JSON.stringify(su?.body));
    // ── Task 6: archive instead of delete ──
    T('PLAYER_COLS reads archived_at and legacy_id',/(^|,)archived_at(,|$)/.test(PLAYER_COLS)&&/(^|,)legacy_id(,|$)/.test(PLAYER_COLS),PLAYER_COLS);
    players=[{id:1,name:'Ann',is_admin:true,color:0,hcp_history:[]},{id:2,name:'Bo',color:1,hcp_history:[]},{id:3,name:'Gone',color:2,hcp_history:[],archived_at:'2026-09-01T00:00:00Z'}];
    activeId=1; // isAdmin() is "the active player has is_admin"
    allRounds=[{id:1,player_id:3,date:'2026-06-01',tee_id:'57',holes:Array.from({length:18},(_,i)=>({hole:i+1,par:HOLE_PARS[i],score:HOLE_PARS[i]}))}];
    T('activePlayers() leaves archived out',activePlayers().map(p=>p.id).join()==='1,2',activePlayers().map(p=>p.id).join());
    stubFetch(()=>[{}]);
    await archivePlayer(2);
    const ar=calls.find(c=>c.method==='PATCH');
    T('archivePlayer PATCHes archived_at, never DELETEs',ar&&ar.url.includes('id=eq.2')&&typeof ar.body.archived_at==='string'&&!calls.some(c=>c.method==='DELETE'),JSON.stringify(calls));
    T('archived player stays in players (history)',players.some(p=>p.id===2&&p.archived_at),JSON.stringify(players));
    stubFetch(()=>[{}]);
    await restorePlayer(2);
    const rs=calls.find(c=>c.method==='PATCH');
    T('restorePlayer clears archived_at',rs&&rs.body.archived_at===null&&!players.find(p=>p.id===2).archived_at,JSON.stringify(rs?.body));
    players.find(p=>p.id===2).archived_at=null;
    window.__alert=null;stubFetch(()=>[{}]);
    await archivePlayer(1);
    T('cannot archive the only admin',/only admin/i.test(window.__alert||'')&&!calls.length,String(window.__alert));
    // pick lists
    showPicker();T('picker hides archived',!/Gone/.test(document.getElementById('pickerList').textContent));
    showAddFine();T('issue-fine list hides archived',![...document.getElementById('finePlayer').options].some(o=>o.textContent==='Gone'));
    showRecordPayment();T('payment list hides archived',![...document.getElementById('payPlayer').options].some(o=>o.textContent==='Gone'));
    buildPlayerCheckboxes();T('Log Round group hides archived',!/Gone/.test(document.getElementById('playerCheckboxes').textContent));
    renderGrid();
    const grid=document.getElementById('playerGrid').innerHTML;
    T('roster hides archived from the active list',(grid.split('Former members')[0]||'').indexOf('Gone')<0,grid.slice(0,200));
    T('admin roster lists former members with Restore',/Former members/.test(grid)&&/restorePlayer\(3\)/.test(grid));
    T('season standings keep archived history',seasonStandings('Summer 2026').some(s=>s.p.id===3));
    // rejecting a pending applicant removes their rows first, then the player
    pendingPlayers=[{id:9,name:'Applicant',approved:false}];stubFetch(()=>undefined);
    await rejectPlayer(9);
    const dels=calls.filter(c=>c.method==='DELETE').map(c=>c.url.replace(/^.*\/rest\/v1\//,''));
    T('rejectPlayer deletes the applicant\'s rows before the player',dels.length>1&&dels[dels.length-1].startsWith('players?id=eq.9')&&dels.slice(0,-1).every(u=>/player_id=eq\.9/.test(u)),JSON.stringify(dels));
    // ── Task 7: old browser ids ──
    players=[{id:1,name:'Ann',legacy_id:1774371644307},{id:2,name:'Bo',legacy_id:1774371644999,archived_at:'2026-09-01T00:00:00Z'}];pendingPlayers=[];
    localStorage.clear();sessionStorage.clear();
    localStorage.setItem('sl_active_player','1774371644307');sessionStorage.setItem('sl_session_player','1774371644307');
    localStorage.setItem('sl_units_1774371644307','yards');localStorage.setItem('sl_gps_detail_1774371644307','full');
    localStorage.setItem('sl_active_group',JSON.stringify({date:today(),players:[{id:1774371644307,teeId:'57'}]}));
    let cleared=reconcileStoredPlayer();
    T('old id translated in local and session storage',localStorage.getItem('sl_active_player')==='1'&&sessionStorage.getItem('sl_session_player')==='1'&&cleared===false);
    T('preference keys moved to the new id',localStorage.getItem('sl_units_1')==='yards'&&localStorage.getItem('sl_gps_detail_1')==='full'&&localStorage.getItem('sl_units_1774371644307')===null);
    T('saved Log Round group with old ids is discarded',localStorage.getItem('sl_active_group')===null);
    localStorage.clear();sessionStorage.clear();sessionStorage.setItem('sl_session_player','999');
    cleared=reconcileStoredPlayer();
    T('unknown id clears the session',cleared===true&&sessionStorage.getItem('sl_session_player')===null);
    localStorage.clear();sessionStorage.clear();sessionStorage.setItem('sl_session_player','2');localStorage.setItem('sl_active_player','2');
    cleared=reconcileStoredPlayer();
    T('archived player is signed out',cleared===true&&sessionStorage.getItem('sl_session_player')===null&&localStorage.getItem('sl_active_player')===null);
    localStorage.clear();sessionStorage.clear();sessionStorage.setItem('sl_session_player','1');
    T('current id is left alone',reconcileStoredPlayer()===false&&sessionStorage.getItem('sl_session_player')==='1');
    T('init calls reconcileStoredPlayer',/reconcileStoredPlayer\(\)/.test(init.toString()));
    // ── end ──
  }catch(e){out.push('FAIL EXCEPTION :: '+e.stack);}
  await new Promise(r=>setTimeout(r,150));
  const pre=document.createElement('pre');pre.id='RESULT';pre.textContent=out.join('\n');document.body.innerHTML='';document.body.appendChild(pre);
},400);
