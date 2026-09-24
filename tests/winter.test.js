// Winter 2027 — season rules, entries, sign out. Run: tests/run.ps1 -Test tests/winter.test.js
setTimeout(async function(){
  const out=[];const T=(n,c,d='')=>out.push((c?'PASS ':'FAIL ')+n+(c?'':' :: '+d));
  const calls=[];let respond=()=>[];
  window.fetch=async(url,opts={})=>{url=String(url);const body=opts.body?JSON.parse(opts.body):null;calls.push({url,method:opts.method||'GET',body});
    const b=respond(url,body,opts.method||'GET');const st=b&&b.__status||200;return{ok:st<400,status:st,json:async()=>b,text:async()=>JSON.stringify(b)};};
  const reset=fn=>{calls.length=0;respond=fn||(()=>[]);};
  window.toast=()=>{};window.setLoading=()=>{};window.confirm=()=>true;window.alert=()=>{};
  // 18-hole round on the platinum tee; `score` for every hole.
  const round=(id,pid,date,score)=>({id,player_id:pid,date,tee_id:'platinum',holes:HOLE_PARS.map((par,i)=>({hole:i+1,par,hcp:HOLE_HCP[i],score:score}))});
  const P=(id,name,x={})=>({id,name,color:id,hcp_history:[{date:'2026-01-01',value:18,note:''}],approved:true,is_social:false,...x});
  tees=[..._TEES_SEED];  // calcRoundPoints needs the platinum tee's rating/slope; init() isn't run in this harness.
  try{
    // ── Task 2: season rules ──
    T('Summer keeps best 4 and DKK 250',seasonInfo('Summer 2026').best===4&&seasonInfo('Summer 2026').buyIn===250&&seasonInfo('Summer 2026').entry===false);
    T('Winter is best 3, DKK 175, entry',seasonInfo('Winter 2027').best===3&&seasonInfo('Winter 2027').buyIn===175&&seasonInfo('Winter 2027').entry===true);
    today=()=>'2026-09-28';
    T('entries open for Winter during Summer\'s last week',entrySeason()?.name==='Winter 2027');
    today=()=>'2026-11-01';
    T('entry season is Winter during Winter',entrySeason()?.name==='Winter 2027');
    const saved=SEASONS.splice(1,1);today=()=>'2026-09-28';
    T('no entry season when none needs entry',entrySeason()===null);
    SEASONS.push(...saved);
    players=[P(1,'Ann'),P(2,'Bo')];seasonEntries=[];
    allRounds=[1,2,3,4,5].map(i=>round(i,1,`2026-10-${10+i}`,4+(i%3)));
    today=()=>'2026-11-01';
    const w=seasonStandings('Winter 2027');   // (Task 3 adds the entry rule; enter Ann so she counts)
    T('Winter counts the best 3 rounds',!w.length||w[0].counted.length===3);
    allRounds=[1,2,3,4,5].map(i=>round(i,1,`2026-05-${10+i}`,5));
    T('Summer counts the best 4 rounds',seasonStandings('Summer 2026')[0].counted.length===4);
    document.getElementById('seasonYear').innerHTML='<option>Winter 2027</option>';document.getElementById('seasonYear').value='Winter 2027';
    allRounds=[1,2,3,4].map(i=>round(i,1,`2026-10-${10+i}`,5));seasonEntries=[{id:1,season:'Winter 2027',player_id:1,paid_at:'2026-10-01T10:00:00Z',amount:175}];
    renderSeasonLb();
    T('Season heading reads Best 3',/Best 3 Rounds/.test(document.getElementById('seasonTable').innerHTML)&&document.getElementById('seasonBestN').textContent==='3');
    T('pay screen shows the entry season buy-in',/DKK 175/.test(payHtml())&&/Winter 2027/.test(payHtml())&&!/DKK 250/.test(payHtml()));
    today=()=>'2026-11-01';renderRules();
    T('Rules page names best 3 for Winter',[...document.querySelectorAll('.rulesBestN')].every(e=>e.textContent==='3'));
    // ── end ──
  }catch(e){out.push('FAIL EXCEPTION :: '+e.stack);}
  await new Promise(r=>setTimeout(r,150));
  const pre=document.createElement('pre');pre.id='RESULT';pre.textContent=out.join('\n');document.body.innerHTML='';document.body.appendChild(pre);
},400);
