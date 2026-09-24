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
    // ── Task 3: entries decide the prizes ──
    today=()=>'2026-11-01';
    players=[P(1,'Ann'),P(2,'Bo'),P(3,'Cy',{is_social:true}),P(4,'Di')];
    allRounds=[round(1,1,'2026-10-10',5),round(2,2,'2026-10-10',4),round(3,3,'2026-10-10',3),round(4,4,'2026-10-10',6)];
    seasonEntries=[{id:1,season:'Winter 2027',player_id:1,paid_at:'2026-10-01T10:00:00Z',amount:175},{id:2,season:'Winter 2027',player_id:4,paid_at:null,amount:null}];
    T('inPrizes: entered and not social',inPrizes(players[0],'Winter 2027')&&inPrizes(players[3],'Winter 2027')&&!inPrizes(players[1],'Winter 2027')&&!inPrizes(players[2],'Winter 2027'));
    T('Winter eclectic lists entrants only',JSON.stringify(eclecticStandings('Winter 2027').map(e=>e.p.id).sort())==='[1,4]');
    T('Winter standings list entrants only',JSON.stringify(seasonStandings('Winter 2027').map(s=>s.p.id).sort())==='[1,4]');
    allRounds.push(round(5,2,'2026-10-05',4));seasonEntries.push({id:3,season:'Winter 2027',player_id:2,paid_at:null,amount:null,entered_at:'2026-11-01T09:00:00Z'});
    T('a late entry counts rounds from before entering',seasonStandings('Winter 2027').find(s=>s.p.id===2)?.rounds===2);
    document.getElementById('seasonYear').innerHTML='<option>Winter 2027</option>';document.getElementById('seasonYear').value='Winter 2027';renderSeasonLb();
    T('unpaid entrants are tagged unpaid in the Season table',(document.getElementById('seasonTable').innerHTML.match(/>unpaid</g)||[]).length===2);
    allRounds=[round(1,1,'2026-05-10',5),round(2,2,'2026-05-10',4)];
    T('Summer ignores entries: every non-social member is in',seasonStandings('Summer 2026').length===2&&inPrizes(players[1],'Summer 2026'));
    T('Summer eclectic still lists everyone, social included',eclecticStandings('Summer 2026').length===2);
    today=()=>'2026-11-01';renderRules();
    T('Winter pot counts paid entries only',/DKK 175/.test(document.getElementById('rulesPot').innerHTML)&&/1 paid entry/.test(document.getElementById('rulesPot').innerHTML));
    today=()=>'2026-09-20';renderRules();
    T('Summer pot is still players × DKK 250',/DKK 250 × 3 players = DKK 750/.test(document.getElementById('rulesPot').innerHTML));
    // Bo (2) has not entered; Ann (1) has.
    seasonEntries=[{id:1,season:'Winter 2027',player_id:1,paid_at:'2026-10-01T10:00:00Z',amount:175}];
    allRounds=[round(1,2,'2026-11-01',4),round(2,1,'2026-11-01',5)];today=()=>'2026-11-01';renderTodayLb();
    T('Today: a non-entrant gets no prize place',/1st/.test(document.getElementById('todayTable').innerHTML)&&!/2nd/.test(document.getElementById('todayTable').innerHTML));
    // tees non-empty so loadData doesn't try to seed them; everything else empty; season_entries fails.
    reset(u=>u.includes('/season_entries')?{__status:500,message:'boom'}:u.includes('/tees')?[{id:'platinum',name:'Royal Platinum',color:'#b0a0c0',rating:77.6,slope:153,dist:[]}]:[]);
    seasonEntries=[{id:9}];
    try{await loadData();}catch(e){out.push('FAIL loadData threw :: '+e.message);}
    T('load failure: season_entries failing leaves an empty list, not a crash',Array.isArray(seasonEntries)&&seasonEntries.length===0);
    // ── Task 4: member banner ──
    today=()=>'2026-09-28';players=[P(1,'Ann'),P(2,'Bo',{is_social:true}),P(3,'Cy',{approved:false})];seasonEntries=[];activeId=1;
    renderEntryBanner();const ban=()=>document.getElementById('entryBanner').innerHTML;
    T('not entered: Enter Winter 2027 for DKK 175, best 3',/Enter Winter 2027/.test(ban())&&/DKK 175/.test(ban())&&/best 3/.test(ban())&&/enterSeason\(\)/.test(ban()));
    reset((u,b,m)=>u.includes('/season_entries')&&m==='POST'?[{id:11,season:b.season,player_id:b.player_id,paid_at:null,amount:null}]:[]);
    await enterSeason();
    const post=calls.find(c=>c.method==='POST'&&c.url.includes('/season_entries'));
    T('Enter posts season and own player only',post&&post.body.season==='Winter 2027'&&post.body.player_id===1&&!('id' in post.body)&&!('paid_at' in post.body));
    T('entered, unpaid: payment not recorded, MobilePay link, Withdraw',/payment not yet recorded/.test(ban())&&ban().includes(MOBILEPAY_URL)&&/withdrawEntry\(\)/.test(ban()));
    reset((u,b,m)=>u.includes('/season_entries')&&m==='DELETE'?[{id:11}]:[]);
    await withdrawEntry();
    T('Withdraw deletes the entry and shows Enter again',calls.some(c=>c.method==='DELETE'&&c.url.includes('season_entries?id=eq.11'))&&/enterSeason\(\)/.test(ban())&&!entryOf(1,'Winter 2027'));
    // ── Task 4 fix round 1 ──
    // RLS filtered the DELETE (e.g. an admin marked the entry paid after the member loaded the
    // page) — PostgREST returns 200 [], not an error. withdrawEntry must not treat that as success.
    seasonEntries=[{id:13,season:'Winter 2027',player_id:1,paid_at:null,amount:null}];renderEntryBanner();
    reset((u,b,m)=>u.includes('/season_entries')&&m==='DELETE'?[]:[]);
    await withdrawEntry();
    T('Withdraw round 1: an RLS-filtered delete (0 rows) keeps the entry and the unpaid banner',!!entryOf(1,'Winter 2027')&&/payment not yet recorded/.test(ban())&&!/Enter Winter 2027/.test(ban()));
    seasonEntries=[{id:12,season:'Winter 2027',player_id:1,paid_at:'2026-09-29T10:00:00Z',amount:175}];renderEntryBanner();
    T('paid: entered and paid, no Withdraw',/entered in Winter 2027 and paid/.test(ban())&&!/withdrawEntry/.test(ban()));
    activeId=2;renderEntryBanner();T('social members see no banner',ban()==='');
    activeId=3;renderEntryBanner();T('pending members see no banner',ban()==='');
    const saved2=SEASONS.splice(1,1);activeId=1;renderEntryBanner();T('no banner when no season takes entries',ban()==='');SEASONS.push(...saved2);
    activeId=1;seasonEntries=[];renderProfile();
    T('My Profile shows the entry status',/Enter Winter 2027/.test(document.getElementById('profileBody').innerHTML));
    // ── end ──
  }catch(e){out.push('FAIL EXCEPTION :: '+e.stack);}
  await new Promise(r=>setTimeout(r,150));
  const pre=document.createElement('pre');pre.id='RESULT';pre.textContent=out.join('\n');document.body.innerHTML='';document.body.appendChild(pre);
},400);
