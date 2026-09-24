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
    // ── end ──
  }catch(e){out.push('FAIL EXCEPTION :: '+e.stack);}
  await new Promise(r=>setTimeout(r,150));
  const pre=document.createElement('pre');pre.id='RESULT';pre.textContent=out.join('\n');document.body.innerHTML='';document.body.appendChild(pre);
},400);
