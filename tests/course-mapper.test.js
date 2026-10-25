// Course mapper on a member login. supabase-js and fetch are stubbed (network is blocked in tests).
// Run: tests/run.ps1 -Test tests/course-mapper.test.js -Page course-mapper.html
// Leaflet (unpkg) can't load here, so the page script stops at its first L.* use (the GreenOverlay class);
// everything above that point, which is all these tests need, has already run. The title is reset at the end.
const __me=document.currentScript;
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

    tokens.push('t5');respond=()=>({__status:401,code:'42501'});msg='';
    try{await sbSurveyGet();}catch(e){msg=e.message;}
    T('401 with 42501 is admin mode',msg.includes('Unlock admin mode'),msg);
    tokens.push('t6');respond=()=>({__status:401,code:'PGRST301',message:'JWT expired'});msg='';
    try{await sbSurveyGet();}catch(e){msg=e.message;}
    T('401 JWT error is sign in',msg.includes('Sign in to the Saturday League app on this device first'),msg);

    // The user-facing callers, in a copy of the page where Leaflet is stubbed so the whole script runs (signed out).

    const html=document.documentElement.outerHTML.split(__me.textContent).join('').replace(/<script[^>]*(unpkg|jsdelivr)[^>]*><\/script>/g,'');
    const pre='<script>window.L=(function mk(){const f=function(){};return new Proxy(f,{get:(t,k)=>k===Symbol.toPrimitive?()=>0:mk(),apply:()=>mk(),construct:()=>mk()});})();'
      +'window.supabase={createClient:()=>({auth:{getSession:async()=>({data:{session:null}})}})};window.fetch=()=>{throw new Error("no fetch")};window.__alerts=[];window.alert=m=>__alerts.push(m);<\/script>';
    const fr=document.createElement('iframe');fr.srcdoc=html.replace('<head>','<head>'+pre);document.body.appendChild(fr);
    await new Promise(r=>fr.onload=r);await new Promise(r=>setTimeout(r,300));
    const w=fr.contentWindow;
    w.document.body.insertAdjacentHTML('beforeend','<div class="sv-gps-row"></div>');
    w.eval("surveyHole=1;surveySampling={type:'tee',samples:[{coords:{latitude:1,longitude:2,accuracy:3}}]};");
    await w.finishSampling();
    const row=w.document.querySelector('.sv-gps-row');
    T('signed-out insert is visible',!!row&&row.textContent.includes('Sign in to the Saturday League app on this device first'),row&&row.textContent);
    await w.deleteSurveyPoint(5);
    T('signed-out delete is visible',w.__alerts.some(m=>m.includes('Sign in to the Saturday League app on this device first')),JSON.stringify(w.__alerts));
    w.__alerts.length=0;await w.loadSurveyPoints();
    T('signed-out load is visible',w.__alerts.some(m=>m.includes('Sign in to the Saturday League app on this device first')),JSON.stringify(w.__alerts));
    // RLS filters a DELETE without admin mode: PostgREST answers 200 [] with return=representation, not 42501.
    w.eval("_sb={auth:{getSession:async()=>({data:{session:{access_token:'t7'}}})}};surveyPoints=[{id:7,hole:1,type:'tee'}];");
    const dc=[];w.fetch=async(u,o)=>{dc.push(o);return{ok:true,status:200,json:async()=>[],text:async()=>'[]'};};
    w.__alerts.length=0;await w.deleteSurveyPoint(7);
    T('empty delete result is admin mode',w.__alerts.some(m=>m.includes('Unlock admin mode in the app (Admin tab), then try again'))&&w.eval('surveyPoints.length')===1&&dc[0].headers.Prefer==='return=representation',JSON.stringify([w.__alerts,dc[0]&&dc[0].headers]));
    fr.remove();

    tokens.push('t4');respond=()=>({__status:500,code:'XX'});msg='';
    try{await sbSurveyGet();}catch(e){msg=e.message;}
    T('other errors show the response text',msg.includes('"XX"'),msg);
  }catch(e){T('no exception',false,String(e&&e.stack||e));}
  if(/L is not defined/.test(document.title))document.title='course-mapper';
  const pre=document.createElement('pre');pre.id='RESULT';pre.textContent=out.join('\n');document.body.appendChild(pre);
},500);
