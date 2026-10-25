// Course mapper on a member login. supabase-js and fetch are stubbed (network is blocked in tests).
// Run: tests/run.ps1 -Test tests/course-mapper.test.js -Page course-mapper.html
// Leaflet (unpkg) can't load here, so the page script stops at its first L.* use (the GreenOverlay class);
// everything above that point, which is all these tests need, has already run. The title is reset at the end.
setTimeout(async function(){
  const out=[];const T=(n,c,d='')=>out.push((c?'PASS ':'FAIL ')+n+(c?'':' :: '+d));
  const calls=[];let respond=()=>[];
  window.fetch=async(url,opts={})=>{calls.push({url:String(url),method:opts.method||'GET',headers:opts.headers});
    const b=respond();const st=b&&b.__status||200;return{ok:st<400,status:st,json:async()=>b,text:async()=>JSON.stringify(b)};};
  const tokens=[];
  window.supabase={createClient:()=>({auth:{getSession:async()=>({data:{session:tokens.length?{access_token:tokens.shift()}:null},error:null})}})};
  try{
    tokens.push('t1','t2');
    await sbSurveyGet();await sbSurveyGet();
    T('fresh token per request',calls.length===2&&calls[0].headers.Authorization==='Bearer t1'&&calls[1].headers.Authorization==='Bearer t2',JSON.stringify(calls.map(c=>c.headers.Authorization)));
    T('version',calls.every(c=>c.headers['x-app-version']==='4'&&c.headers.apikey),JSON.stringify(calls.map(c=>c.headers)));

    calls.length=0;let msg='';
    try{await sbSurveyGet();}catch(e){msg=e.message;}
    T('signed out',msg.includes('Sign in to the Saturday League app on this device first')&&calls.length===0,msg+' / '+calls.length);

    tokens.push('t3');respond=()=>({__status:403,code:'42501'});msg='';
    try{await sbSurveyInsert({lat:1,lng:2});}catch(e){msg=e.message;}
    T('expired admin mode',msg.includes('Unlock admin mode in the app (Admin tab), then try again'),msg);

    tokens.push('t4');respond=()=>({__status:500,code:'XX'});msg='';
    try{await sbSurveyGet();}catch(e){msg=e.message;}
    T('other errors show the response text',msg.includes('"XX"'),msg);
  }catch(e){T('no exception',false,String(e&&e.stack||e));}
  document.title='course-mapper';
  const pre=document.createElement('pre');pre.id='RESULT';pre.textContent=out.join('\n');document.body.appendChild(pre);
},500);
