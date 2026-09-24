// Phase 0 — PINs are checked server-side; email/PIN are never read. Run: tests/run.ps1 -Test tests/phase0.test.js
setTimeout(async function(){
  const out=[];const T=(name,cond,detail='')=>out.push((cond?'PASS ':'FAIL ')+name+(cond?'':' :: '+detail));
  const calls=[];let respond=()=>[];
  window.fetch=async(url,opts={})=>{url=String(url);const body=opts.body?JSON.parse(opts.body):null;calls.push({url,method:opts.method||'GET',body});const b=respond(url,body);
    return{ok:true,status:b===undefined?204:200,json:async()=>b,text:async()=>b===undefined?'':JSON.stringify(b)};};
  const reset=(fn)=>{calls.length=0;respond=fn||(()=>[]);};
  const rpc=name=>calls.find(c=>c.url.includes('/rpc/'+name));
  const vis=id=>document.getElementById(id).style.display!=='none';
  let loggedIn=null,switched=null;
  window.loginAs=async p=>{loggedIn=p;};window.init=async()=>{};window.setPlayer=id=>{switched=id;};
  window.toast=()=>{};window.setLoading=()=>{};window.confirm=()=>true;window.alert=()=>{};window.renderAdmin=()=>{};
  const HIDDEN=/(^|[,=])(email|pin|pin_failures|pin_locked_until)(,|&|$)/;
  try{
    // ── Data helpers never ask for the credential columns ──
    reset();await sbGet('players','order=created_at.asc');
    T('sbGet players names its columns',/[?&]select=/.test(calls[0].url),calls[0].url);
    T('sbGet players excludes email/pin',!HIDDEN.test(decodeURIComponent(calls[0].url.split('select=')[1]||'')),calls[0].url);
    reset(()=>[{id:1}]);await sbUpdate('players',1,{name:'X'});
    T('sbUpdate players names its columns',/[?&]select=/.test(calls[0].url)&&!HIDDEN.test(decodeURIComponent(calls[0].url.split('select=')[1]||'')),calls[0].url);
    reset(()=>[{id:1}]);await sbInsert('players',{id:1,name:'X'});
    T('sbInsert players names its columns',/[?&]select=/.test(calls[0].url)&&!HIDDEN.test(decodeURIComponent(calls[0].url.split('select=')[1]||'')),calls[0].url);
    reset();await sbGet('rounds','order=date.desc');
    T('other tables unchanged',!/select=/.test(calls[0].url),calls[0].url);

    // ── Email + PIN login ──
    const login=async(email,pin,resp)=>{reset(u=>u.includes('/rpc/login')?resp:[]);loggedIn=null;showLockLogin();
      document.getElementById('loginEmail').value=email;document.getElementById('loginPin').value=pin;await submitEmailPin();};
    await login('A@B.com ','1234',{ok:true,id:7,name:'Ann'});
    T('login calls rpc/login',!!rpc('login'),JSON.stringify(calls.map(c=>c.url)));
    T('login sends email+pin',rpc('login')?.body?.p_email==='a@b.com'&&rpc('login')?.body?.p_pin==='1234',JSON.stringify(rpc('login')?.body));
    T('login never reads players by email',!calls.some(c=>/players\?.*email=/.test(c.url)),JSON.stringify(calls.map(c=>c.url)));
    T('successful login logs in as returned id',loggedIn&&loggedIn.id===7,JSON.stringify(loggedIn));
    await login('a@b.com','9999',{ok:false});
    T('wrong PIN or unknown email: one generic message',vis('loginError')&&/email or pin/i.test(document.getElementById('loginError').textContent)&&!loggedIn,document.getElementById('loginError').textContent);
    await login('a@b.com','9999',{ok:false,locked:true});
    T('locked account says so',/15 minutes/.test(document.getElementById('loginError').textContent),document.getElementById('loginError').textContent);
    await login('a@b.com','',{ok:false});
    T('empty PIN is rejected before calling server',!rpc('login'),'called');
    await login('new@b.com','0000',{ok:true,id:8,name:'Neo',needs_pin:true});
    T('needs_pin shows set-PIN panel with name',vis('lockSetPinPanel')&&document.getElementById('lockSetPinName').textContent==='Neo'&&!loggedIn,document.getElementById('lockSetPinName').textContent);
    // first PIN from the login screen
    reset(u=>u.includes('/rpc/set_first_pin')?{ok:true}:[]);
    document.getElementById('lockSetPinInput').value='4321';document.getElementById('lockSetPinConfirm').value='4321';await submitLockSetPin();
    const sf=rpc('set_first_pin');
    T('login first-PIN uses rpc/set_first_pin',sf&&sf.body.p_id===8&&sf.body.p_email==='new@b.com'&&sf.body.p_pin==='4321',JSON.stringify(sf?.body));
    T('login first-PIN never PATCHes pin',!calls.some(c=>c.method==='PATCH'),JSON.stringify(calls));
    T('login first-PIN then logs in',loggedIn&&loggedIn.id===8,JSON.stringify(loggedIn));
    reset(u=>u.includes('/rpc/set_first_pin')?{ok:false,error:'That email does not match this player, or a PIN is already set.'}:[]);loggedIn=null;
    document.getElementById('lockSetPinInput').value='4321';document.getElementById('lockSetPinConfirm').value='4321';await submitLockSetPin();
    T('login first-PIN failure shown',vis('lockSetPinError')&&/does not match/.test(document.getElementById('lockSetPinError').textContent)&&!loggedIn,document.getElementById('lockSetPinError').textContent);

    // ── Player picker PIN ──
    players=[{id:5,name:'Pat',color:0,hcp_history:[]}];
    reset(u=>u.includes('/rpc/has_pin')?true:[]);await requirePin(5);
    T('picker asks server whether PIN is set',!!rpc('has_pin')&&rpc('has_pin').body.p_id===5,JSON.stringify(calls));
    T('picker with PIN shows enter section',vis('pinEnterSection')&&!vis('pinSetSection'));
    reset(u=>u.includes('/rpc/check_pin')?{ok:true}:[]);switched=null;document.getElementById('pinInput').value='1111';await submitPin();
    T('picker PIN checked by rpc/check_pin',rpc('check_pin')?.body?.p_pin==='1111'&&switched===5,JSON.stringify(calls)+' switched='+switched);
    reset(u=>u.includes('/rpc/check_pin')?{ok:false}:[]);switched=null;document.getElementById('pinInput').value='2222';await submitPin();
    T('picker wrong PIN shows error',vis('pinError')&&switched===null);
    reset(u=>u.includes('/rpc/check_pin')?{ok:false,locked:true}:[]);document.getElementById('pinInput').value='2222';await submitPin();
    T('picker locked says so',/15 minutes/.test(document.getElementById('pinError').textContent),document.getElementById('pinError').textContent);
    reset(u=>u.includes('/rpc/has_pin')?false:[]);await requirePin(5);
    T('picker without PIN shows set section with email field',vis('pinSetSection')&&!!document.getElementById('pinSetEmail'));
    reset(u=>u.includes('/rpc/set_first_pin')?{ok:true}:[]);switched=null;
    document.getElementById('pinSetEmail').value='Pat@X.dk';document.getElementById('pinSetInput').value='5555';document.getElementById('pinSetConfirm').value='5555';await saveFirstPin();
    const sf2=rpc('set_first_pin');
    T('picker first-PIN uses rpc/set_first_pin with email',sf2&&sf2.body.p_id===5&&sf2.body.p_email==='pat@x.dk'&&sf2.body.p_pin==='5555'&&switched===5,JSON.stringify(sf2?.body)+' switched='+switched);
    T('picker first-PIN never PATCHes pin',!calls.some(c=>c.method==='PATCH'));

    // ── Admin ──
    reset();await resetPlayerPin(5);
    T('admin reset uses rpc/admin_reset_pin',rpc('admin_reset_pin')?.body?.p_id===5&&!calls.some(c=>c.method==='PATCH'),JSON.stringify(calls));
    openEditEmail(5);
    T('edit email starts empty with hidden hint',document.getElementById('editEmailVal').value===''&&/hidden/i.test(document.getElementById('editEmailVal').placeholder),document.getElementById('editEmailVal').placeholder);
  }catch(e){out.push('FAIL EXCEPTION :: '+e.stack);}
  await new Promise(r=>setTimeout(r,150)); // let the app's delayed focus() calls land before the DOM is cleared
  const pre=document.createElement('pre');pre.id='RESULT';pre.textContent=out.join('\n');document.body.innerHTML='';document.body.appendChild(pre);
},400);
