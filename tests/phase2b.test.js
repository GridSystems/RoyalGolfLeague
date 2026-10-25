// Phase 2B — the PIN login is gone; only the email login remains. supabase-js is stubbed (the CDN is blocked in tests).
// Run: tests/run.ps1 -Test tests/phase2b.test.js
const __me=document.currentScript;   // this test's own text, left out of the "no PIN calls" scan
setTimeout(async function(){
  const out=[];const T=(n,c,d='')=>out.push((c?'PASS ':'FAIL ')+n+(c?'':' :: '+d));
  const calls=[];let respond=()=>[];
  window.fetch=async(url,opts={})=>{url=String(url);const body=opts.body?JSON.parse(opts.body):null;calls.push({url,method:opts.method||'GET',body,headers:opts.headers});
    const b=respond(url,body,opts.method||'GET');const st=b&&b.__status||200;return{ok:st<400,status:st,json:async()=>b,text:async()=>JSON.stringify(b)};};
  const reset=fn=>{calls.length=0;respond=fn||(()=>[]);};
  const authState={session:null};
  const fakeClient={auth:{
    getSession:async()=>({data:{session:authState.session},error:null}),
    onAuthStateChange:(cb)=>{authState.cb=cb;return{data:{subscription:{unsubscribe(){}}}};},
    signInWithPassword:async()=>({data:{session:null},error:{message:'Invalid login credentials'}}),
    signUp:async()=>({data:{},error:null}),signOut:async()=>({error:null}),
    mfa:{listFactors:async()=>({data:{all:[],totp:[]},error:null})}}};
  window.supabase={createClient:()=>fakeClient};
  const now=Math.floor(Date.now()/1000);
  const b64=o=>btoa(JSON.stringify(o)).replace(/=+$/,'').replace(/\+/g,'-').replace(/\//g,'_');
  const sessionFor=(sub,claims={})=>({access_token:'h.'+b64({sub,aal:'aal1',amr:[{method:'password',timestamp:now}],...claims})+'.s',user:{id:sub}});
  window.toast=()=>{};window.setLoading=()=>{};window.alert=()=>{};window.confirm=()=>true;
  const shown=id=>{const e=document.getElementById(id);return !!e&&e.style.display!=='none';};
  try{
    T('PIN UI is gone',['lockPinPanel','lockSetPinPanel','pinModal','adminPinModal','changePinModal','loginPin'].every(id=>document.getElementById(id)===null),
      ['lockPinPanel','lockSetPinPanel','pinModal','adminPinModal','changePinModal','loginPin'].filter(id=>document.getElementById(id)).join());

    // The page, minus this test's own script. boot() still clears the old admin-PIN key once
    // (removeItem('sl_admin_pin')); that clean-up is the only place the key may appear.
    const app=document.documentElement.outerHTML.split(__me.textContent).join('').split("removeItem('sl_admin_pin')").join('');
    const left=["sbRpc('login'",'has_pin','check_pin','set_first_pin','admin_reset_pin','sl_admin_pin','Reset PIN'].filter(s=>app.includes(s));
    T('no PIN calls remain',left.length===0,left.join(', '));

    T('version 4',APP_VERSION===4&&H['x-app-version']==='4',APP_VERSION+' / '+H['x-app-version']);
    T('PLAYER_COLS drops legacy_id',!PLAYER_COLS.split(',').includes('legacy_id')&&PLAYER_COLS.split(',').includes('user_id'),PLAYER_COLS);

    // A tab still holding a PIN-route session from before this release lands on the login panel.
    localStorage.clear();sessionStorage.clear();
    sessionStorage.setItem('sl_session_player','2');localStorage.setItem('sl_active_player','2');
    sessionStorage.setItem('admin_auth','1');localStorage.setItem('sl_admin_pin','1234');
    authState.session=null;
    reset(u=>u.includes('/players?')?[{id:2,name:'Bo',user_id:'u-2',color:0,hcp_history:[],approved:true}]:[]);
    document.getElementById('lockScreen').style.display='none';
    const renders=[];const origRender=renderTodayLb;window.renderTodayLb=()=>{renders.push(1);};
    await boot();
    window.renderTodayLb=origRender;
    T('stale PIN session lands on login',shown('lockLoginPanel')&&document.getElementById('lockScreen').style.display!=='none'&&renders.length===0
      &&sessionStorage.getItem('sl_session_player')===null&&sessionStorage.getItem('admin_auth')===null&&localStorage.getItem('sl_admin_pin')===null,
      JSON.stringify({login:shown('lockLoginPanel'),lock:document.getElementById('lockScreen').style.display,renders:renders.length,
        sp:sessionStorage.getItem('sl_session_player'),aa:sessionStorage.getItem('admin_auth'),pin:localStorage.getItem('sl_admin_pin')}));

    showLockPanel('lockLoginPanel');
    const lp=document.getElementById('lockLoginPanel');
    const link=[...lp.querySelectorAll('.lock-link')].find(e=>/set up your email login/i.test(e.textContent));
    const hasCopy=/Used a PIN before\? PIN sign-in has ended — set up your email login\./.test(lp.textContent);
    if(link)link.click();
    T('login panel tells PIN users what to do',hasCopy&&!!link&&shown('lockSetupPanel')&&!shown('lockLoginPanel'),lp.textContent);

    players=[{id:1,name:'Ann',user_id:'u-1',is_admin:true,color:0,hcp_history:[],approved:true}];activeId=players[0].id;_session=null;
    T('no session means no admin',isAdminAccount()===false);

    players=[{id:1,name:'Ann',user_id:'u-1',is_admin:true,color:0,hcp_history:[],approved:true},{id:2,name:'Bo',user_id:null,color:1,hcp_history:[],approved:true}];
    _session=sessionFor('u-1',{aal:'aal2',amr:[{method:'totp',timestamp:now}]});activeId=1;
    reset(u=>u.includes('/rpc/admin_member_emails')?[{player_id:1,name:'Ann',email:'ann@x.dk',linked:true},{player_id:2,name:'Bo',email:'bo@x.dk',linked:false}]:[]);
    await renderMoveOverList();
    const mo=document.getElementById('moveOverList').textContent;
    T('move-over copy',/1 of \d+ members haven't set up the email login yet/.test(mo)&&!mo.includes('PIN'),mo);
    // ── end ──
  }catch(e){out.push('FAIL EXCEPTION :: '+e.stack);}
  await new Promise(r=>setTimeout(r,150));
  const pre=document.createElement('pre');pre.id='RESULT';pre.textContent=out.join('\n');document.body.innerHTML='';document.body.appendChild(pre);
},400);
