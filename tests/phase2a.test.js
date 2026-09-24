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
    signUp:async a=>{authCalls.push(['signUp',a]);return authState.signUp||{data:{},error:null};},
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
    // ── Task 7: login flows ──
    const field=(id,v)=>{document.getElementById(id).value=v;};
    const shown=id=>document.getElementById(id).style.display!=='none';
    showLockPanel('lockLoginPanel');
    field('loginEmail','a@b.dk');field('loginPassword','short');authCalls.length=0;await submitPasswordLogin();
    T('login: wrong password shows a neutral error',shown('loginError')&&/email or password/i.test(document.getElementById('loginError').textContent));
    authState.signIn={data:{session:sessionFor('u-2')},error:null};reset(u=>u.includes('/players?')?[{id:2,name:'Bo',user_id:'u-2',color:0,hcp_history:[],approved:true}]:[]);
    field('loginPassword','correct horse');await submitPasswordLogin();
    T('login: success starts the app as the player',activeId===2&&document.getElementById('lockScreen').style.display==='none');
    showLockPanel('lockSetupPanel');field('setupEmail','Bo@X.dk');field('setupPassword','abc');field('setupPassword2','abc');authCalls.length=0;await submitSetup();
    T('set-up: passwords under 8 characters refused',authCalls.length===0&&/8 characters/.test(document.getElementById('setupError').textContent));
    field('setupPassword','longenough1');field('setupPassword2','longenough1');await submitSetup();
    const su=authCalls.find(c=>c[0]==='signUp');
    T('set-up: signs up with the email and redirect, no player metadata',su&&su[1].email==='bo@x.dk'&&su[1].options.emailRedirectTo===SITE_URL&&!(su[1].options.data||{}).name);
    T('set-up: says to open the link on this device',shown('lockCheckEmailPanel')&&/this (phone|device)/i.test(document.getElementById('lockCheckEmailPanel').textContent));
    showLockPanel('lockSignupPanel');['signupName','signupEmail','signupDgu','signupHcp','signupPassword','signupPassword2'].forEach(id=>field(id,''));
    field('signupName','Cy');field('signupEmail','cy@x.dk');field('signupDgu','900-1');field('signupHcp','14.2');field('signupPassword','longenough1');field('signupPassword2','longenough1');
    authCalls.length=0;await submitSignup();
    const sg=authCalls.find(c=>c[0]==='signUp');
    T('sign-up: sends name, DGU, handicap and colour as metadata',sg&&sg[1].options.data.name==='Cy'&&sg[1].options.data.dgu_number==='900-1'&&sg[1].options.data.handicap===14.2&&Number.isInteger(sg[1].options.data.color));
    T('sign-up: never writes to players directly',!calls.some(c=>c.method==='POST'&&c.url.includes('/players')));
    showLockPanel('lockForgotPanel');field('forgotEmail','ghost@x.dk');authCalls.length=0;await submitForgot();
    const rs=authCalls.find(c=>c[0]==='reset');
    T('forgot: sends a reset with the site redirect',rs&&rs[1]==='ghost@x.dk'&&rs[2].redirectTo===SITE_URL);
    T('forgot: neutral message',/if that address belongs to a member/i.test(document.getElementById('lockCheckEmailPanel').textContent));
    showLockPanel('lockNewPwPanel');field('newPassword','longenough2');field('newPassword2','longenough2');authCalls.length=0;await submitNewPassword();
    T('new password: updates the password',authCalls.some(c=>c[0]==='update'&&c[1].password==='longenough2'));
    history.replaceState(null,'','?error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid');
    handleAuthRedirectError();
    T('a failed or wrong-device link explains itself',shown('loginError')&&/same (phone|device)|expired/i.test(document.getElementById('loginError').textContent));
    history.replaceState(null,'',location.pathname);

    // ── Task 7 fix round 1: never inject the typed email as HTML, never leak raw Supabase errors ──
    showLockPanel('lockSetupPanel');field('setupEmail','<img src=x onerror="window.__xss=1">@x.dk');field('setupPassword','longenough1');field('setupPassword2','longenough1');
    window.__xss=undefined;authState.signUp=null;authCalls.length=0;await submitSetup();
    const cet=document.getElementById('checkEmailText');
    T('set-up: a malicious email is never parsed as HTML',!cet.querySelector('img')&&window.__xss===undefined&&cet.textContent.includes('<img'),cet.innerHTML);

    showLockPanel('lockSetupPanel');field('setupEmail','existing@x.dk');field('setupPassword','longenough1');field('setupPassword2','longenough1');
    authState.signUp={data:{},error:{message:'User already registered'}};authCalls.length=0;await submitSetup();
    T('set-up: an already-registered email gets the same check-email screen as success',shown('lockCheckEmailPanel')&&document.getElementById('setupError').style.display==='none');

    showLockPanel('lockSetupPanel');field('setupEmail','weak@x.dk');field('setupPassword','longenough1');field('setupPassword2','longenough1');
    authState.signUp={data:{},error:{message:'Password should contain at least one number.'}};authCalls.length=0;await submitSetup();
    T('set-up: a weak-password error is shown in the form',shown('setupError')&&/password/i.test(document.getElementById('setupError').textContent)&&!shown('lockCheckEmailPanel'));

    showLockPanel('lockSetupPanel');field('setupEmail','busy@x.dk');field('setupPassword','longenough1');field('setupPassword2','longenough1');
    authState.signUp={data:{},error:{status:429,message:'Request rate limit reached'}};authCalls.length=0;await submitSetup();
    T('set-up: a rate-limit error shows a generic too-many-attempts message',shown('setupError')&&/too many attempts/i.test(document.getElementById('setupError').textContent));

    showLockPanel('lockSignupPanel');['signupName','signupEmail','signupDgu','signupHcp','signupPassword','signupPassword2'].forEach(id=>field(id,''));
    field('signupName','Zed');field('signupEmail','zed@x.dk');field('signupDgu','900-2');field('signupPassword','longenough1');field('signupPassword2','longenough1');
    authState.signUp={data:{},error:{message:'User already registered'}};authCalls.length=0;await submitSignup();
    T('sign-up: an already-registered email also gets the neutral check-email screen',shown('lockCheckEmailPanel')&&document.getElementById('signupError').style.display==='none');
    authState.signUp=null;

    window.forceReload=()=>{};
    authCalls.length=0;await signOut();
    T('sign out calls Supabase and clears the session',authCalls.some(c=>c[0]==='signOut')&&_session===null);

    // ── Task 8: admin mode ──
    players=[{id:1,name:'Ann',user_id:'u-1',is_admin:true,color:0,hcp_history:[],approved:true},{id:2,name:'Bo',user_id:'u-2',color:1,hcp_history:[],approved:true}];activeId=1;
    _session=sessionFor('u-1');
    T('password-only admin session is not admin mode',adminModeActive()===false);
    _session=sessionFor('u-1',{aal:'aal2',amr:[{method:'totp',timestamp:now-60}]});
    T('fresh second factor is admin mode',adminModeActive()===true);
    _session=sessionFor('u-1',{aal:'aal2',amr:[{method:'totp',timestamp:now-13*3600}]});
    T('second factor older than 12 hours is not admin mode',adminModeActive()===false);
    // first admin action: enrol + verify, then retry succeeds
    _session=sessionFor('u-1');authState.factors=[];let n=0;
    reset((u,b,m)=>{if(m==='POST'&&u.includes('/fine_types')){n++;return n===1?{__status:403,code:'42501',message:'new row violates row-level security policy'}:[{id:9,name:'x',amount:1}];}if(u.includes('/rpc/log_admin_mode'))return true;return[];});
    const verifyAndUpgrade=async()=>{document.getElementById('mfaCode').value='123456';_session=sessionFor('u-1',{aal:'aal2',amr:[{method:'totp',timestamp:now}]});await submitMfaCode();};
    const p=sbInsert('fine_types',{name:'x',amount:1});
    await new Promise(r=>setTimeout(r,50));
    T('a refused admin action opens the two-factor prompt',document.getElementById('mfaModal').style.display!=='none'&&authCalls.some(c=>c[0]==='enroll'));
    await verifyAndUpgrade();const res=await p;
    T('after the code, the action is retried and succeeds',res&&res[0]&&res[0].id===9&&n===2,`n=${n}`);
    T('admin mode unlock is logged by the database function',calls.some(c=>c.url.includes('/rpc/log_admin_mode')));
    // a member's refused action does not prompt
    activeId=2;_session=sessionFor('u-2');document.getElementById('mfaModal').style.display='none';
    reset(()=>({__status:403,code:'42501',message:'denied'}));let threw=false;try{await sbInsert('fine_types',{name:'y'});}catch(e){threw=true;}
    T('members are refused without a prompt',threw&&document.getElementById('mfaModal').style.display==='none');
    T('admin PIN is gone for signed-in users',typeof openAdminTab==='function'&&!/requireAdminPin/.test(document.getElementById('adminTab').getAttribute('onclick')));
    // an admin PATCH that silently matches nothing before admin mode → prompt → retried
    players=[{id:1,name:'Ann',user_id:'u-1',is_admin:true,color:0,hcp_history:[],approved:true}];activeId=1;
    _session=sessionFor('u-1');authState.factors=[{id:'f1',status:'verified'}];let k=0;
    reset((u,b,m)=>{if(m==='PATCH'){k++;return k===1?[]:[{id:5,approved:true}];}return u.includes('/rpc/log_admin_mode')?true:[];});
    const pu=sbUpdate('players',5,{approved:true});await new Promise(r=>setTimeout(r,50));
    T('an empty admin update opens the prompt (existing factor: no QR)',document.getElementById('mfaModal').style.display!=='none'&&document.getElementById('mfaEnroll').style.display==='none');
    await verifyAndUpgrade();const pr=await pu;
    T('…and the retried update returns the row',pr.length===1&&k===2,`k=${k}`);
    // ── end ──
  }catch(e){out.push('FAIL EXCEPTION :: '+e.stack);}
  await new Promise(r=>setTimeout(r,150));
  const pre=document.createElement('pre');pre.id='RESULT';pre.textContent=out.join('\n');document.body.innerHTML='';document.body.appendChild(pre);
},400);
