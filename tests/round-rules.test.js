// Log Round says up front what supabase/round_rules.sql would refuse, before creating anyone's round:
// an earlier day is the player's own round only, up to 7 days back; anything else needs admin mode.
// Run: tests/run.ps1 -Test tests/round-rules.test.js
setTimeout(async function(){
  const out=[];const T=(n,c,d='')=>out.push((c?'PASS ':'FAIL ')+n+(c?'':' :: '+d));
  const alerts=[];let started=null,adminPrompt=0,adminOk=true;
  window.alert=m=>alerts.push(m);window.setLoading=()=>{};window.toast=()=>{};
  window.heInit=async(list,date)=>{started={ids:list.map(x=>x.p.id),date};};
  window.requireAdminMode=async()=>{adminPrompt++;if(!adminOk)throw new Error('cancelled');return true;};
  const P=(id,name,extra={})=>({id,name,color:id,hcp_history:[{date:'2026-01-01',value:18,note:''}],approved:true,is_social:false,...extra});
  const day=n=>new Date(Date.parse(today()+'T12:00:00Z')+n*864e5).toISOString().slice(0,10);
  const go=async(date,ids,{admin=false,ok=true}={})=>{
    players=[P(1,'Ann Ash',{user_id:'u1',is_admin:admin}),P(2,'Bo Berg'),P(3,'Cy Cole')];
    _session={user:{id:'u1'}};groupPlayerIds=ids;playerTees={};selectedStartHole='1';
    document.getElementById('roundDate').value=date;
    alerts.length=0;started=null;adminPrompt=0;adminOk=ok;
    await startGroupEntry();
  };
  try{
    await go(today(),[1,2,3]);
    T('today: the whole group starts',started&&started.ids.join()==='1,2,3'&&!alerts.length,JSON.stringify({started,alerts}));
    await go(day(-3),[1]);
    T('3 days ago, own round: starts',started&&started.ids.join()==='1'&&!alerts.length,JSON.stringify({started,alerts}));
    await go(day(-7),[1]);
    T('7 days ago, own round: starts',!!started&&!alerts.length,JSON.stringify(alerts));
    await go(day(-3),[1,2]);
    T('3 days ago with others: refused with the reason, nothing created',!started&&/only log your own round/.test(alerts[0]||''),JSON.stringify({started,alerts}));
    await go(day(-3),[2]);
    T('3 days ago, only someone else: refused',!started&&alerts.length===1,JSON.stringify(alerts));
    await go(day(-8),[1]);
    T('8 days ago, own round: refused, needs an admin',!started&&/more than 7 days/.test(alerts[0]||''),JSON.stringify({started,alerts}));
    await go(day(1),[1]);
    T('tomorrow: refused',!started&&/future/.test(alerts[0]||''),JSON.stringify({started,alerts}));
    T('a member is never asked for an admin code',adminPrompt===0,adminPrompt);
    await go(day(-30),[1,2,3],{admin:true});
    T('admin: an old group round asks for admin mode, then starts',adminPrompt===1&&started&&started.ids.join()==='1,2,3'&&!alerts.length,JSON.stringify({adminPrompt,started,alerts}));
    await go(day(-30),[1,2],{admin:true,ok:false});
    T('admin who cancels the code: refused, nothing created',!started&&alerts.length===1,JSON.stringify({started,alerts}));
    await go(day(-3),[1],{admin:true});
    T('admin, own round 3 days ago: no code needed',adminPrompt===0&&!!started,JSON.stringify({adminPrompt,started}));
  }catch(e){T('no exception',false,e.stack);}
  const pre=document.createElement('pre');pre.id='RESULT';pre.textContent=out.join('\n');document.body.appendChild(pre);
},1500);
