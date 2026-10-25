// Stored XSS: every piece of user text reaches the page escaped. One payload goes into every free-text
// field (names, DGU numbers, notes, reasons, tee/fine-type/tournament names, audit details, emails), then
// every view and editing modal is rendered and checked: nothing parsed as markup, no handler carries it,
// the text still shows, and nothing is escaped twice.
// Run: tests/run.ps1 -Test tests/xss.test.js
setTimeout(async function(){
  const out=[];const T=(n,c,d='')=>out.push((c?'PASS ':'FAIL ')+n+(c?'':' :: '+d));
  // Breaks out of element content, double-quoted attributes and single-quoted JS strings.
  const X=`Bo<img src=x onerror="window.__xss=1"><b id=xssB>"q" O'Neil');window.__xss=2;//`;
  const tick=(ms=40)=>new Promise(r=>setTimeout(r,ms));
  // want: 'full' — the whole payload must show as text; 'first' — at least a first name ("Bo<img"); null — no user text expected.
  async function check(name,root,want){
    await tick();
    const bad=[];
    if(document.querySelector('img[src="x"]'))bad.push('an <img src=x> was parsed');
    if(document.getElementById('xssB'))bad.push('#xssB was parsed');
    if(window.__xss!==undefined)bad.push('script ran: __xss='+window.__xss);
    const els=[...document.querySelectorAll('body *')].filter(el=>el.tagName!=='SCRIPT');
    const onAttr=els.flatMap(el=>[...el.attributes].filter(a=>/^on/i.test(a.name)&&a.value.includes('__xss')).map(a=>el.tagName+'['+a.name+']'));
    if(onAttr.length)bad.push('payload in a handler: '+onAttr.slice(0,3).join(', '));
    const twice=s=>/&(lt|gt|amp|quot|#39);/.test(s);
    const attr=els.flatMap(el=>[...el.attributes].filter(a=>/^(title|value|placeholder|label|data-)/.test(a.name)&&twice(a.value)).map(a=>el.tagName+'['+a.name+']'));
    const vals=els.filter(el=>(el.tagName==='INPUT'||el.tagName==='TEXTAREA')&&twice(el.value)).map(el=>'#'+el.id);
    if(attr.length||vals.length)bad.push('escaped twice: '+[...attr,...vals].slice(0,3).join(', '));
    const txt=root?root.innerText:'';
    if(twice(txt))bad.push('visible text escaped twice: '+txt.match(/.{0,20}&(lt|gt|amp|quot|#39);.{0,10}/)[0]);
    if(want==='full'&&!txt.includes("O'Neil"))bad.push("O'Neil not shown");
    if(want==='first'&&!txt.includes('Bo<img'))bad.push('"Bo<img" not shown');
    T(name,!bad.length,bad.join('; '));
    document.querySelectorAll('img[src="x"],#xssB').forEach(e=>e.remove());delete window.__xss;   // one miss, one FAIL
  }
  const step=async(name,root,want,fn)=>{try{await fn();}catch(e){T(name,false,'threw: '+e.message);return;}await check(name,typeof root==='function'?root():root,want);};
  const $=id=>document.getElementById(id);

  // ── stubs: nothing leaves the page ──
  window.toast=()=>{};window.setLoading=()=>{};window.confirm=()=>false;window.alert=()=>{};window.prompt=()=>null;
  window.sbUpdate=async(t,id,b)=>[{id,...b}];window.sbInsert=async(t,b)=>[b];window.sbDelete=async(t,id)=>[{id}];window.sbDeleteWhere=async()=>{};
  const TD='2026-10-24';today=()=>TD;
  window.sbGet=async t=>t==='audit_log'?[{at:TD+'T10:00:00Z',actor_player_id:1,target_player_id:2,action:X,details:{[X]:X}}]
    :t==='gps_shots'?[{id:1,player_id:1,round_date:TD,hole:1,shot_num:1,type:'normal',club:X,lat:55.637,lng:12.570,lie:'tee'},{id:2,player_id:1,round_date:TD,hole:1,shot_num:2,type:'normal',club:X,lat:55.636,lng:12.569,lie:'fairway'}]:[];
  window.sbRpc=async fn=>fn==='admin_member_emails'?[{name:X,email:X,linked:false}]:null;
  window.isAdminAccount=()=>true;window.adminModeActive=()=>true;window.requireAdminMode=async()=>true;
  _session={user:{id:'u1'},access_token:''};

  // ── seed every user-text field with X ──
  tees=[..._TEES_SEED,{id:'xss',name:X,color:'#123456',rating:70,slope:130,dist:Array(18).fill(300)}];
  const P=(id,x={})=>({id,name:X+' '+id,color:id%10,dgu_number:X,handicap:18,hcp_history:[{date:'2026-01-01',value:18,note:X}],approved:true,is_social:false,is_admin:false,bag:[X,'Driver'],archived_at:null,user_id:null,...x});
  players=[P(1,{is_admin:true,user_id:'u1'}),P(2),P(3,{is_social:true}),...[4,5,6,7,8,9,10,11,12,13,14,15,16].map(i=>P(i)),P(17,{archived_at:'2026-09-01T00:00:00Z'})];
  pendingPlayers=[P(50,{approved:false})];activeId=1;
  const holes=(n,s=4)=>HOLE_PARS.map((par,i)=>({hole:i+1,score:i<n?s+(i%2):null,par,hcp:HOLE_HCP[i]}));
  const R=(id,pid,date,n,x={})=>({id,player_id:pid,date,tee_id:'xss',tee_name:X,tee_color:'#123456',rating:70,slope:130,hcp_index:18,course_hcp:19,playing_hcp:18,notes:X,tee_time:X,holes:holes(n),...x});
  allRounds=[R(1,1,TD,5,{marker_holes:holes(5,6)}),R(2,2,TD,5),R(3,3,TD,4),R(4,4,TD,3),
    ...[1,2,3,4].flatMap(pid=>[R(10+pid,pid,'2026-10-17',18),R(20+pid,pid,'2026-10-10',18,{holes:holes(18,3)})]),
    ...[1,2,3,4].map(pid=>R(30+pid,pid,'2026-08-01',18,{holes:holes(18,1)}))];   // aces and eagles for the records rows
  seasonEntries=[{id:1,season:'Winter 2027',player_id:1,entered_at:TD,paid_at:TD+'T10:00:00Z',amount:175,recorded_by:1},{id:2,season:'Winter 2027',player_id:2,entered_at:TD,paid_at:null,amount:null},{id:3,season:'Winter 2027',player_id:4,entered_at:TD,paid_at:TD+'T10:00:00Z',amount:175}];
  fineTypes=[{id:1,name:X,amount:10,active:true},{id:2,name:X+' 2',amount:20,active:false}];
  allFines=[{id:1,player_id:2,fine_type_id:1,amount:10,hole:3,date:TD,issued_by:1,notes:X,created_at:TD+'T10:00:00Z'},{id:2,player_id:1,fine_type_id:1,amount:10,hole:4,date:'2026-08-01',issued_by:2,notes:X,created_at:'2026-08-01T10:00:00Z'}];
  finePayments=[{id:1,player_id:2,amount:5,date:TD,note:X,recorded_by:1}];
  const sats=getNextSaturdays(4);
  saturdayEvents=[{id:1,date:sats[0],tee_times:[X,'08:40'],locked:false,cancelled:false}];
  saturdaySignups=[1,2,3,4].map(pid=>({id:pid,date:sats[0],player_id:pid,early_tee_request:true,early_tee_reason:X,tee_time:pid<3?X:'08:40',group_num:pid<3?1:2,created_at:TD}))
    .concat([1,2,50].map((pid,i)=>({id:10+i,date:sats[1],player_id:pid,early_tee_request:true,early_tee_reason:X,tee_time:null,group_num:null,created_at:TD})));
  const G=[[1,2,3,4],[5,6,7,8],[9,10,11,12],[13,14,15,16]];
  tournaments=[{id:1,name:X,date:TD,tee_id:'xss',status:'round_1',format:'team_day',team_a_name:X+' A',team_b_name:X+' B',team_a_captain_id:1,team_b_captain_id:2},
    {id:2,name:X+' L',date:'2026-11-01',tee_id:'xss',status:'drawn',format:'league',buy_in:100,max_players:16,deadlines:{group_1:'2026-12-01',group_2:'2027-01-01',group_3:'2027-02-01',semi:'2027-03-01',final:'2027-04-01'}},
    {id:3,name:X+' E',date:'2027-04-01',tee_id:'xss',status:'entry',format:'league',buy_in:100,max_players:16,deadlines:{}}];
  tournamentPlayers=[[1,'a'],[3,'a'],[6,'a'],[2,'b'],[4,'b'],[7,'b']].map(([pid,team],i)=>({id:i+1,tournament_id:1,player_id:pid,team}))
    .concat(G.flatMap((g,gi)=>g.map((pid,k)=>({id:100+pid,tournament_id:2,player_id:pid,team:'league',group_num:gi+1,seed_pot:k+1,entered_at:'2026-10-01T10:00:00Z',paid_at:pid%2?TD:null,amount:pid%2?100:null}))))
    .concat([...Array(17)].map((_,i)=>({id:300+i,tournament_id:3,player_id:i+1,team:'league',entered_at:new Date(Date.UTC(2026,9,1,10,0,i)).toISOString(),paid_at:i%2?TD:null,amount:i%2?100:null,group_num:null,seed_pot:null})));
  tournamentMatches=[{id:11,tournament_id:1,round:1,match_num:1,team_a_p1_id:1,team_a_p2_id:3,team_b_p1_id:2,team_b_p2_id:4,status:'in_progress',result:null,_teeId:'xss'},
    {id:12,tournament_id:1,round:1,match_num:2,team_a_p1_id:null,team_a_p2_id:null,team_b_p1_id:null,team_b_p2_id:null,status:'pending',result:null,_teeId:'xss'},
    ...mlFixtures(G).map((r,i)=>({id:100+i,tournament_id:2,status:'pending',result:null,start_hole:1,outcome:'played',played_on:null,tee_id:null,team_a_p2_id:null,team_b_p2_id:null,_teeId:'xss',...r}))];
  tournamentScores=[[11,1,4],[11,3,5],[11,2,5],[11,4,6],[100,1,4],[100,4,5]].map(([match_id,player_id,gross],i)=>({id:i+1,match_id,hole:1,player_id,gross}));
  tmLoaded=true;
  const tee=getTee('xss');
  const startHE=()=>{HE={playerList:[1,2,3,4].map(id=>({p:players.find(p=>p.id===id),phcp:18,tee,teeId:'xss'})),
    scores:{1:[4,5,null,...Array(15).fill(null)],2:[5,4,null,...Array(15).fill(null)],3:Array(18).fill(null),4:[4,null,...Array(16).fill(null)]},
    pickups:{1:Array(18).fill(false),2:Array(18).fill(false),3:Array(18).fill(false),4:Array(18).fill(false)},
    roundIds:{1:1,2:2,3:3,4:4},currentHole:2,currentPidx:0,startHole:1,date:TD,notes:X};};

  try{
    // ── Leaderboards ──
    await step('Leaderboards: Today',()=>$('view-leaderboard'),'full',()=>showView('leaderboard',null));
    for(const s of SEASONS.map(x=>x.name)){
      const pick=()=>['seasonYear','dreamYear','finesYear'].forEach(id=>{const e=$(id);if(e)e.value=s;});
      await step(`Leaderboards: Season (${s})`,()=>$('lb-season'),'full',()=>{showLb('season',null);pick();renderSeasonLb();});
      await step(`Leaderboards: Eclectic (${s})`,()=>$('lb-dreamcard'),'first',()=>{showLb('dreamcard',null);pick();renderDreamCard();});
      await step(`Leaderboards: Fines (${s})`,()=>$('lb-fines'),'full',()=>{showLb('fines',null);pick();renderFinesLb();});
    }
    await step('Leaderboards: Hall of Fame',()=>$('lb-fame'),'full',()=>showLb('fame',null));
    showLb('today',null);

    // ── Sign Up and Tee Sheet ──
    await step('Sign Up',()=>$('view-signup'),'full',()=>showView('signup',null));
    await step('Sign Up: edit form with early reason',()=>$('view-signup'),'full',()=>showEditSignupForm(sats[1]));
    await step('Tee Sheet',()=>$('view-teesheet'),'full',()=>showView('teesheet',null));

    // ── My Profile, My Rounds, Players ──
    await step('My Profile',()=>$('view-profile'),'full',()=>showView('profile',null));
    await step('My Rounds',()=>$('view-history'),'first',()=>showView('history',null));
    await step('My Rounds: GPS Stats',()=>$('view-history'),null,async()=>{showHistorySub('gpsstats',null);await tick(150);});
    await step('Players',()=>$('view-players'),'full',()=>showView('players',null));
    await step('Player picker',()=>$('pickerList'),'full',()=>showPicker());

    // ── Log Round ──
    localStorage.setItem('sl_active_group',JSON.stringify({date:TD,players:[{id:1},{id:2}]}));
    await step('Log Round: group resume banner',()=>$('view-log'),'first',()=>showView('log',null));
    localStorage.removeItem('sl_active_group');
    await step('Log Round: resume banner',()=>$('view-log'),'full',()=>checkForResumableRounds());
    await step('Log Round: resume a round',()=>$('view-log'),'full',()=>resumeRound(1));
    startHE();
    await step('Log Round: hole card',()=>$('holeEntryCard'),'first',()=>heRender());
    await step('Log Round: stopped-playing picker',()=>$('stopModal'),'first',()=>heStopPick());
    await step('Log Round: stopped-playing confirm',()=>$('stopModal'),'first',()=>heStopAsk(2));
    closeModal('stopModal');
    await step('Log Round: score conflict',()=>$('conflictModal'),'first',()=>openConflictModal(1));
    closeModal('conflictModal');
    HE=null;

    // ── Tournament: team day, its draw, a league ──
    activeTournamentId=1;
    await step('Tournament: team day',()=>$('view-tournament'),'full',()=>showView('tournament',null));
    await step('Tournament: team day individual',()=>$('view-tournament'),'first',()=>tmSetPlayersTab(document.querySelector('#view-tournament .sub-tab')||document.createElement('button')));
    await step('Tournament: team day match scoring',()=>$('view-tournament'),'full',()=>teOpenMatch(11));
    TE.matchId=null;tournaments[0].status='fourball_draw';
    await step('Tournament: team day draw',()=>$('view-tournament'),'full',()=>renderTournament());
    tournaments[0].status='round_1';
    activeTournamentId=2;
    for(const tab of ['groups','playoffs','results'])
      await step(`Tournament: league ${tab}`,()=>$('view-tournament'),tab==='groups'?'full':null,()=>{mlTab=tab;renderTournament();});
    mlTab='groups';
    await step('Tournament: league match scoring',()=>$('view-tournament'),'first',()=>teOpenMatch(100));
    TE.matchId=null;activeTournamentId=3;
    await step('Tournament: league entries',()=>$('view-tournament'),'full',()=>renderTournament());
    clearInterval(window._tmRefreshInterval);

    // ── Rules, Track ──
    await step('Rules',()=>$('view-rules'),null,()=>showView('rules',null));
    GR=null;
    await step('Track: start',()=>$('view-track'),'full',()=>showView('track',null));
    GR={date:TD,teeId:'xss',currentHole:1,detailMode:'full',mapOpen:false,currentLat:null,currentLng:null,currentAccuracy:null,selectedClub:null,selectedWeight:'full',selectedLie:'fairway',
      pendingShot:{type:'normal'},chipAndPutt:false,scoringForIds:[2],holeScores:{},provisionalShotId:null,map:null,markers:[],polylines:[],shots:[],surveyPoints:[],greenLayers:[],greenLabelMarkers:[],distRingLayers:[],distRingLabelMarkers:[],distRingCentre:150,distRingInterval:10};
    await step('Track: shot with clubs',()=>$('view-track'),'first',()=>renderGpsHole());
    await step('Track: marking a playing partner',()=>$('view-track'),'full',()=>renderMarkerScoring(0));
    GR=null;
    await step('My Bag',()=>$('bagModal'),'first',()=>openBagModal());
    closeModal('bagModal');

    // ── Admin: everything, then the editing forms ──
    activeTournamentId=1;
    await step('Admin',()=>$('view-admin'),'full',async()=>{showView('admin',null);await tick(100);});
    await step('Admin: audit log',()=>$('auditPanel'),'full',()=>renderAuditPanel());
    for(const id of [2,3])await step(`Admin: tournament ${id===2?'league (drawn)':'league (entries)'}`,()=>$('adminTournamentBody'),'full',()=>{activeTournamentId=id;renderAdminTournament();});
    await step('Admin: edit tee',()=>$('view-admin'),null,()=>{_editingTeeId='xss';renderAdminTees();});
    _editingTeeId=null;
    await step('Admin: edit fine type',()=>$('view-admin'),null,()=>editFineType(1));
    await step('Admin: edit round',()=>$('editRoundModal'),'full',()=>openEditRound(1));
    closeModal('editRoundModal');
    for(const [fn,modal] of [['openEditName','editNameModal'],['openEditDgu','editDguModal'],['openHcpEdit','editHcpModal'],['openEditEmail','editEmailModal']]){
      await step(`Admin: ${fn}`,()=>$(modal),'full',()=>window[fn](2));closeModal(modal);
    }
    await step('My Profile: update handicap',()=>$('myHcpModal'),'full',()=>showMyHcp());
    closeModal('myHcpModal');
    // ── HCP history delete goes by position, not by text through onclick ──
    {const p=players.find(x=>x.id===2);p.hcp_history=[{date:'2026-01-01',value:18,note:X},{date:'2026-05-01',value:16,note:X}];window.confirm=()=>true;
      await deleteHcpEntry(2,0);window.confirm=()=>false;
      T('deleteHcpEntry(pid, i) removes the newest-first i-th entry',p.hcp_history.length===1&&p.hcp_history[0].date==='2026-01-01',JSON.stringify(p.hcp_history));}
    // ── tmEditField looks the text up by id ──
    {let shown=null;window.prompt=(l,v)=>{shown=v;return null;};await tmEditField(1,'team_a_name');window.prompt=()=>null;
      T('tmEditField(id, field) offers the stored text',shown===X+' A',String(shown));}
    // ── a club with a quote reaches selectGpsClub as text ──
    {GR={selectedClub:null};const holder=document.createElement('div');document.body.appendChild(holder);
      holder.innerHTML=renderClubPicker({bag:[X]});holder.querySelector('.club-btn').click();
      T('a club name round-trips through the picker',GR.selectedClub===X,String(GR.selectedClub));holder.remove();GR=null;}
    await check('final sweep',document.body,null);
  }catch(e){out.push('FAIL EXCEPTION :: '+e.stack);}
  await new Promise(r=>setTimeout(r,150));
  const pre=document.createElement('pre');pre.id='RESULT';pre.textContent=out.join('\n');document.body.innerHTML='';document.body.appendChild(pre);
},400);
