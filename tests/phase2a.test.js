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
    // ── end ──
  }catch(e){out.push('FAIL EXCEPTION :: '+e.stack);}
  await new Promise(r=>setTimeout(r,150));
  const pre=document.createElement('pre');pre.id='RESULT';pre.textContent=out.join('\n');document.body.innerHTML='';document.body.appendChild(pre);
},400);
