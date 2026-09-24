// Phase 2A — Supabase Auth login, admin mode, audit panel. supabase-js is stubbed (the CDN is blocked in tests).
setTimeout(async function(){
  const out=[];const T=(n,c,d='')=>out.push((c?'PASS ':'FAIL ')+n+(c?'':' :: '+d));
  const calls=[];let respond=()=>[];
  window.fetch=async(url,opts={})=>{url=String(url);const body=opts.body?JSON.parse(opts.body):null;calls.push({url,method:opts.method||'GET',body,headers:opts.headers});
    const b=respond(url,body,opts.method||'GET');const st=b&&b.__status||200;return{ok:st<400,status:st,json:async()=>b,text:async()=>JSON.stringify(b)};};
  const reset=fn=>{calls.length=0;respond=fn||(()=>[]);};
  // A tiny supabase-js stand-in: records calls, returns scripted results.
  const authCalls=[];let authState={session:null};
  const fakeClient={auth:{
    getSession:async()=>({data:{session:authState.session},error:null}),
    onAuthStateChange:(cb)=>{authState.cb=cb;return{data:{subscription:{unsubscribe(){}}}};},
    signInWithPassword:async a=>{authCalls.push(['signIn',a]);return authState.signIn||{data:{session:null},error:{message:'Invalid login credentials'}};},
    signUp:async a=>{authCalls.push(['signUp',a]);return{data:{},error:null};},
    resetPasswordForEmail:async(e,o)=>{authCalls.push(['reset',e,o]);return{data:{},error:null};},
    updateUser:async a=>{authCalls.push(['update',a]);return{data:{},error:null};},
    signOut:async()=>{authCalls.push(['signOut']);return{error:null};},
    mfa:{listFactors:async()=>({data:{totp:authState.factors||[]},error:null}),
         enroll:async a=>{authCalls.push(['enroll',a]);return{data:{id:'f1',totp:{qr_code:'<svg/>',secret:'S'}},error:null};},
         challengeAndVerify:async a=>{authCalls.push(['verify',a]);return authState.verify||{data:{},error:null};}}}};
  window.supabase={createClient:()=>fakeClient};
  const now=Math.floor(Date.now()/1000);
  const b64=o=>btoa(JSON.stringify(o)).replace(/=+$/,'').replace(/\+/g,'-').replace(/\//g,'_');
  const token=claims=>'h.'+b64(claims)+'.s';
  const sessionFor=(sub,claims={})=>({access_token:token({sub,aal:'aal1',amr:[{method:'password',timestamp:now}],...claims}),user:{id:sub}});
  window.toast=()=>{};window.setLoading=()=>{};window.alert=m=>{window.__alert=m;};window.confirm=()=>true;
  try{
    // ── Task 6: token, version, load fix ──
    T('APP_VERSION is 3',APP_VERSION===3,String(APP_VERSION));
    _session=sessionFor('u-2');reset(()=>[]);await sbGet('rounds');
    T('signed-in requests send the session token',calls[0].headers.Authorization==='Bearer '+_session.access_token,JSON.stringify(calls[0].headers));
    _session=null;reset(()=>[]);await sbGet('rounds');
    T('signed-out requests send the public key',calls[0].headers.Authorization==='Bearer '+SUPABASE_KEY);
    // boot with a session: render happens once, already as the player
    const rendered=[];const origRenderGrid=renderGrid;window.renderGrid=()=>{rendered.push(document.getElementById('playerName').textContent);};
    authState.session=sessionFor('u-2');
    reset(u=>u.includes('/players?')?[{id:2,name:'Bo',user_id:'u-2',color:0,hcp_history:[],approved:true}]:[]);
    document.getElementById('lockScreen').style.display='flex';
    await boot();
    T('boot with a session resolves the player before the first render',rendered.length>0&&rendered.every(n=>n==='Bo'),JSON.stringify(rendered));
    T('lock screen hidden only after start-up',document.getElementById('lockScreen').style.display==='none');
    T('the active player is the signed-in player',activeId===2,String(activeId));
    window.renderGrid=origRenderGrid;

    // ── Task 6 fix round 1: a failed load must not render "nobody" ──
    const dbFailRespond=u=>u.includes('/players?')?{__status:500}:[];
    const origShowLockPanel=showLockPanel;

    // old PIN route, players fetch fails: no render, lock screen stays up, message shown
    localStorage.clear();sessionStorage.clear();
    sessionStorage.setItem('sl_session_player','2');
    authState.session=null;
    reset(dbFailRespond);
    document.getElementById('lockScreen').style.display='flex';
    document.getElementById('loginError').style.display='none';document.getElementById('loginError').textContent='';
    const renderedFail1=[];window.renderGrid=()=>{renderedFail1.push(true);};
    await boot();
    window.renderGrid=origRenderGrid;
    T('old PIN route: failed load does not render',renderedFail1.length===0,JSON.stringify(renderedFail1));
    T('old PIN route: failed load keeps the lock screen up',document.getElementById('lockScreen').style.display!=='none',document.getElementById('lockScreen').style.display);
    T('old PIN route: failed load shows a database message',document.getElementById('loginError').style.display==='block'&&/database/i.test(document.getElementById('loginError').textContent),document.getElementById('loginError').textContent);

    // new login, players fetch fails: database message, not the unlinked panel
    localStorage.clear();sessionStorage.clear();
    authState.session=sessionFor('u-3');
    reset(dbFailRespond);
    document.getElementById('lockScreen').style.display='flex';
    document.getElementById('loginError').style.display='none';document.getElementById('loginError').textContent='';
    const panelCalls1=[];window.showLockPanel=id=>{panelCalls1.push(id);origShowLockPanel(id);};
    const renderedFail2=[];window.renderGrid=()=>{renderedFail2.push(true);};
    await boot();
    window.showLockPanel=origShowLockPanel;window.renderGrid=origRenderGrid;
    T('new login: failed load does not render',renderedFail2.length===0,JSON.stringify(renderedFail2));
    T('new login: failed load shows the database message, not the unlinked panel',!panelCalls1.includes('lockUnlinkedPanel')&&panelCalls1.includes('lockLoginPanel'),JSON.stringify(panelCalls1));
    T('new login: failed load database message visible',document.getElementById('loginError').style.display==='block'&&/database/i.test(document.getElementById('loginError').textContent));

    // new login, data loads but no linked player: unlinked panel (existing behaviour kept)
    localStorage.clear();sessionStorage.clear();
    authState.session=sessionFor('u-4');
    reset(u=>u.includes('/players?')?[{id:2,name:'Bo',user_id:'u-2',color:0,hcp_history:[],approved:true}]:[]);
    document.getElementById('lockScreen').style.display='flex';
    const panelCalls2=[];window.showLockPanel=id=>{panelCalls2.push(id);origShowLockPanel(id);};
    await boot();
    window.showLockPanel=origShowLockPanel;
    T('new login: unresolved player still shows the unlinked panel',panelCalls2.includes('lockUnlinkedPanel'),JSON.stringify(panelCalls2));
    T('new login: unresolved player keeps the lock screen up',document.getElementById('lockScreen').style.display!=='none');

    // old PIN route happy path: renders once as the remembered player
    localStorage.clear();sessionStorage.clear();
    sessionStorage.setItem('sl_session_player','2');localStorage.setItem('sl_active_player','2');
    authState.session=null;
    reset(u=>u.includes('/players?')?[{id:2,name:'Bo',user_id:'u-2',color:0,hcp_history:[],approved:true}]:[]);
    document.getElementById('lockScreen').style.display='flex';
    const renderedHappy=[];window.renderGrid=()=>{renderedHappy.push(document.getElementById('playerName').textContent);};
    await boot();
    window.renderGrid=origRenderGrid;
    T('old PIN route happy path renders once as the remembered player',renderedHappy.length>0&&renderedHappy.every(n=>n==='Bo'),JSON.stringify(renderedHappy));
    T('old PIN route happy path hides the lock screen',document.getElementById('lockScreen').style.display==='none');
    T('old PIN route happy path sets the active player',activeId===2,String(activeId));
    // ── end ──
  }catch(e){out.push('FAIL EXCEPTION :: '+e.stack);}
  await new Promise(r=>setTimeout(r,150));
  const pre=document.createElement('pre');pre.id='RESULT';pre.textContent=out.join('\n');document.body.innerHTML='';document.body.appendChild(pre);
},400);
