// GPS off-course guard, no-show removal, Winter entry on Sign Up, tab order.
// Run: tests/run.ps1 -Test tests/saturday-fixes.test.js
setTimeout(async function(){
  const out=[];const T=(n,c,d='')=>out.push((c?'PASS ':'FAIL ')+n+(c?'':' :: '+d));
  const alerts=[],toasts=[],deletes=[],patches=[];let deleteRows=id=>[{id}];
  window.toast=m=>toasts.push(m);window.setLoading=()=>{};window.confirm=()=>true;window.alert=m=>alerts.push(m);
  window.sbDelete=async(t,id)=>{deletes.push({t,id});return deleteRows(id);};
  window.sbUpdate=async(t,id,b)=>{patches.push({t,id});return[b];};
  window.sbGet=async()=>[];
  const P=(id,name,x={})=>({id,name,color:id,hcp_history:[{date:'2026-01-01',value:18,note:''}],approved:true,is_social:false,...x});
  tees=[..._TEES_SEED];
  try{
    // ── GPS: the watch survives vague and near-course fixes, stops once really off course ──
    let onFix=null;
    Object.defineProperty(navigator,'geolocation',{configurable:true,value:{watchPosition:cb=>{onFix=cb;return 7;},clearWatch:()=>{}}});
    const fix=(lat,lng,accuracy)=>onFix({coords:{latitude:lat,longitude:lng,accuracy}});
    GR={};gpsWatchId=null;startGpsWatch();
    for(let i=0;i<6;i++)fix(55.66,12.60,800);
    T('vague fixes far away never stop the watch',gpsWatchId===7);
    for(let i=0;i<6;i++)fix(55.6250,12.5500,10);
    T('an accurate fix 500m beyond the old box keeps the watch',gpsWatchId===7);
    for(let i=0;i<5;i++)fix(55.66,12.60,10);
    T('five accurate fixes 2km away stop it',gpsWatchId===null&&toasts.some(m=>/off course/.test(m)));
    GR=null;

    // ── No-show: every hole picked up → Save offers to remove them ──
    const setup=()=>{
      players=[P(1,'Ann'),P(2,'Bo'),P(3,'Cy')];activeId=1;
      allRounds=[{id:101,player_id:1,date:today(),holes:[]},{id:102,player_id:2,date:today(),holes:[]},{id:103,player_id:3,date:today(),holes:[]}];
      const tee=getTee('platinum');
      HE={playerList:players.map(p=>({p,phcp:18,tee,teeId:'platinum'})),
        scores:{1:Array(18).fill(4),2:Array(18).fill(null),3:[5,...Array(17).fill(null)]},
        pickups:{1:Array(18).fill(false),2:Array(18).fill(true),3:Array(18).fill(false)},
        roundIds:{1:101,2:102,3:103},currentHole:1,currentPidx:1,startHole:1,date:today(),notes:''};
      groupPlayerIds=[1,2,3];deletes.length=0;patches.length=0;alerts.length=0;toasts.length=0;
    };
    setup();heRender();
    T('the no-show sees "Didn\'t turn up?"',/Didn't turn up\?/.test(document.getElementById('holeEntryCard').innerHTML));
    HE.currentPidx=0;heRender();
    T('a player with scores does not',!/Didn't turn up\?/.test(document.getElementById('holeEntryCard').innerHTML));
    T('a player with one score cannot be removed',await heRemovePlayer(3)===false&&!deletes.length&&/admin/.test(alerts[0]||''));
    setup();HE.scores[3]=Array(18).fill(5);
    await saveGroupRound();
    T('Save deletes the no-show round',deletes.length===1&&deletes[0].id===102);
    T('Save goes on to save the rest',patches.some(x=>x.id===101)&&patches.some(x=>x.id===103)&&!patches.some(x=>x.id===102));
    T('no "Enter at least 9 scores" block',!alerts.some(m=>/at least 9/.test(m)),alerts.join(' | '));
    setup();HE.scores[3]=Array(18).fill(5);window.confirm=()=>false;
    await saveGroupRound();
    T('declining the removal saves nothing',!deletes.length&&!patches.length);
    window.confirm=()=>true;
    setup();deleteRows=()=>[];   // database refused (policy not applied yet)
    T('a refused delete still takes them out of the group',await heRemovePlayer(2)===true&&HE.playerList.length===2&&toasts.some(m=>/ask an admin/.test(m)));
    T('the stored group forgets them',!JSON.parse(localStorage.getItem('sl_active_group')).players.some(x=>x.id===2));
    deleteRows=id=>[{id}];
    localStorage.removeItem('sl_active_group');

    // ── Winter entry on the Sign Up page ──
    today=()=>'2026-09-28';players=[P(1,'Ann')];activeId=1;seasonEntries=[];
    window.renderSaturdayView=()=>{};
    showView('signup',null);
    T('Sign Up shows the Winter entry box',/Enter Winter 2027/.test(document.getElementById('signupEntry').innerHTML));
    seasonEntries=[{id:1,season:'Winter 2027',player_id:1,paid_at:null,amount:null}];renderEntryBanner();
    T('and updates once entered',/entered in Winter 2027/.test(document.getElementById('signupEntry').innerHTML));

    // ── Tab order ──
    const tabs=[...document.querySelectorAll('.nav-tab')].map(t=>t.textContent.trim());
    T('Leaderboards, Sign Up, My Profile first',tabs.slice(0,3).join('|')==='Leaderboards|Sign Up|My Profile',tabs.join('|'));
    // ── Update check: only a newer deploy than the running page ──
    Object.defineProperty(document,'lastModified',{configurable:true,get:()=>'09/28/2026 14:36:22'});   // this page's own date
    const offered=async lm=>{
      document.getElementById('updateBar')?.remove();_lastUpdateCheck=0;
      window.fetch=async()=>({headers:{get:h=>h.toLowerCase()==='last-modified'?lm:null}});
      await checkForUpdate();return !!document.getElementById('updateBar');
    };
    const t=new Date(2026,8,28,14,36,22),utc=ms=>new Date(t.getTime()+ms).toUTCString();   // Last-Modified is GMT
    T('update: the same deploy is not offered',!(await offered(utc(0))));
    T('update: a CDN edge still serving an older copy is not offered',!(await offered(utc(-4*3600e3))));
    T('update: a newer deploy is offered on the first check',await offered(utc(60e3)));
    T('update: no Last-Modified header offers nothing',!(await offered(null)));
    // ── end ──
  }catch(e){out.push('FAIL EXCEPTION :: '+e.stack);}
  await new Promise(r=>setTimeout(r,150));
  const pre=document.createElement('pre');pre.id='RESULT';pre.textContent=out.join('\n');document.body.innerHTML='';document.body.appendChild(pre);
},400);
