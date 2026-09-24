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
    allRounds=[round(1,2,'2026-11-01',4),round(2,1,'2026-11-01',5),round(3,3,'2026-11-01',3)];today=()=>'2026-11-01';renderTodayLb();
    T('Today: a non-entrant gets no prize place',/1st/.test(document.getElementById('todayTable').innerHTML)&&!/2nd/.test(document.getElementById('todayTable').innerHTML));
    const rankCellOf=pid=>{const row=[...document.querySelectorAll('#todayTable tbody tr')].find(tr=>tr.textContent.includes(players.find(p=>p.id===pid).name));return row?row.querySelector('td').innerHTML:'';};
    T('Today: non-social non-entrant\'s rank cell has no Social tag',!/Social/.test(rankCellOf(2)));
    T('Today: social member\'s rank cell still shows Social',/Social/.test(rankCellOf(3)));
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
    // ── Task 5: admin entries ──
    today=()=>'2026-10-10';_session=null;activeId=1;
    players=[P(1,'Ann',{is_admin:true}),P(2,'<b>Bo</b>'),P(3,'Cy'),P(4,'Di',{is_social:true})];
    seasonEntries=[{id:21,season:'Winter 2027',player_id:2,paid_at:null,amount:null},{id:22,season:'Winter 2027',player_id:1,paid_at:'2026-10-05T10:00:00Z',amount:175}];
    renderAdminEntries();const adm=()=>document.getElementById('adminEntriesBody').innerHTML;
    T('title names the entry season',document.getElementById('adminEntriesTitle').textContent==='Winter 2027 entries');
    T('summary: 2 entered · 1 paid · DKK 175 received',/2 entered · 1 paid · DKK 175 received/.test(adm()));
    T('names are escaped',!document.getElementById('adminEntriesBody').querySelector('b')&&/&lt;b&gt;Bo/.test(adm()));
    T('enter-for lists non-social members without an entry',/value="3"/.test(adm())&&!/value="4"/.test(adm())&&!/value="2"/.test(adm()));
    reset((u,b,m)=>m==='PATCH'&&u.includes('season_entries')?[{id:21,season:'Winter 2027',player_id:2,paid_at:b.paid_at,amount:b.amount,recorded_by:b.recorded_by}]:[]);
    await markEntryPaid(21);
    const patch=calls.find(c=>c.method==='PATCH');
    T('Mark paid sets paid_at, the season buy-in and who recorded it',patch&&patch.body.amount===175&&patch.body.recorded_by===1&&!!patch.body.paid_at);
    T('after Mark paid: 2 paid, DKK 350',/2 entered · 2 paid · DKK 350 received/.test(adm()));
    reset((u,b,m)=>m==='PATCH'?[{id:21,season:'Winter 2027',player_id:2,paid_at:null,amount:null,recorded_by:null}]:[]);
    await undoEntryPaid(21);
    T('Undo clears the payment and the pot drops back',calls.some(c=>c.method==='PATCH'&&c.body.paid_at===null&&c.body.amount===null)&&/1 paid · DKK 175/.test(adm()));
    renderSeasonLb();
    reset((u,b,m)=>m==='POST'?[{id:23,season:b.season,player_id:b.player_id,paid_at:null,amount:null}]:[]);
    document.getElementById('entryForPlayer').value='3';await enterPlayerFor();
    T('Enter player posts that player for the entry season',calls.some(c=>c.method==='POST'&&c.body.player_id===3&&c.body.season==='Winter 2027')&&!!entryOf(3,'Winter 2027'));
    reset((u,b,m)=>m==='DELETE'?[{id:23}]:[]);
    await removeEntry(23);
    T('Remove deletes the entry',calls.some(c=>c.method==='DELETE'&&c.url.includes('season_entries?id=eq.23'))&&!entryOf(3,'Winter 2027'));
    // ── Task 5 fix round 1: an RLS-filtered write (200, []) must not be treated as success ──
    reset((u,b,m)=>m==='PATCH'?[]:[]);
    await markEntryPaid(21);
    T('Mark paid round 1: RLS-filtered update leaves the entry unpaid',!entryOf(2,'Winter 2027').paid_at&&/2 entered · 1 paid · DKK 175 received/.test(adm()));
    reset((u,b,m)=>m==='PATCH'?[]:[]);
    await undoEntryPaid(22);
    T('Undo round 1: RLS-filtered update leaves the entry paid',!!entryOf(1,'Winter 2027').paid_at&&/2 entered · 1 paid · DKK 175 received/.test(adm()));
    reset((u,b,m)=>m==='DELETE'?[]:[]);
    await removeEntry(21);
    T('Remove round 1: RLS-filtered delete keeps the entry',!!entryOf(2,'Winter 2027')&&/2 entered · 1 paid · DKK 175 received/.test(adm()));
    document.getElementById('entryForPlayer').value='3';
    reset((u,b,m)=>m==='POST'?[]:[]);
    await enterPlayerFor();
    T('Enter player round 1: RLS-filtered insert does not add an entry',!entryOf(3,'Winter 2027')&&seasonEntries.every(e=>e&&e.id!=null)&&/2 entered · 1 paid · DKK 175 received/.test(adm()));
    const saved3=SEASONS.splice(1,1);today=()=>'2026-09-20';renderAdminEntries();
    T('no season taking entries: says so',/No season is taking entries/.test(adm()));SEASONS.push(...saved3);
    // ── Task 6: sign out in the header ──
    const so=()=>document.getElementById('signOutBtn');
    T('header has a Sign out button wired to signOut',!!so()&&so().closest('header')&&/signOut\(\)/.test(so().getAttribute('onclick')));
    _session=null;sessionStorage.removeItem('sl_session_player');updateSignOutBtn();
    T('hidden when nobody is signed in',so().style.display==='none');
    sessionStorage.setItem('sl_session_player','1');updateSignOutBtn();
    T('shown on the old PIN route',so().style.display!=='none');
    sessionStorage.removeItem('sl_session_player');_session={access_token:'h.e30.s',user:{id:'u-9'}};updateSignOutBtn();
    T('shown on the new login',so().style.display!=='none');
    players=[P(1,'Ann',{user_id:'u-1'}),P(2,'Bo')];_session={access_token:'h.e30.s',user:{id:'u-1'}};activeId=2;updateSignOutBtn();
    T('shown while an admin views as someone else',so().style.display!=='none');
    activeId=1;renderProfile();
    T('My Profile keeps Change email but no longer has Sign out',/submitEmailChange/.test(document.getElementById('profileBody').innerHTML)&&!/signOut\(\)/.test(document.getElementById('profileBody').innerHTML));
    const mediaRule=Array.from(document.styleSheets).flatMap(ss=>{try{return Array.from(ss.cssRules||[]);}catch(e){return[];}}).find(r=>r.media&&r.media.mediaText.includes('640px'));
    const txt=mediaRule?mediaRule.cssText.replace(/\s+/g,''):'';
    T('mobile media query hides db-status.db-ok and wraps hdr-right',mediaRule&&txt.includes('.db-status.db-ok{display:none')&&txt.includes('flex-wrap:wrap'));
    _session=null;
    // ── Eclectic: an unplayed hole counts as a nett triple bogey (all seasons) ──
    const nine=(id,pid,date,score)=>{const r=round(id,pid,date,score);r.holes=r.holes.map((h,i)=>i<9?h:{...h,score:null});return r;};
    today=()=>'2026-09-20';players=[P(1,'Ann'),P(2,'Bo')];seasonEntries=[];
    const e9=eclecticCard(players[0],[nine(1,1,'2026-09-12',4)],0.95);
    const back=HOLE_PARS.slice(9).reduce((s,p)=>s+p+3,0),front=e9.bestPerHole.slice(0,9).reduce((s,b)=>s+b.nett,0);
    T('a 9-hole card counts each unplayed hole as par + 3',e9.filled===9&&e9.totalNett===front+back&&e9.completedPar===72,e9.totalNett+' vs '+(front+back));
    allRounds=[nine(1,1,'2026-09-12',4),round(2,2,'2026-09-12',5)];
    T('a half card no longer ranks above a full card',eclecticStandings('Summer 2026')[0].p.id===2);
    allRounds=[nine(1,1,'2026-09-12',4)];renderHallOfFame();
    T('the Hall of Fame Eclectic winner no longer needs all 18 holes',/Ann/.test(document.getElementById('fameBody').innerHTML.split('Best')[0]));
    document.getElementById('dreamYear').innerHTML='<option>Summer 2026</option>';document.getElementById('dreamYear').value='Summer 2026';renderDreamCard();
    T('unplayed holes show on the card as par + 3',document.getElementById('eclecticScorecards').innerHTML.includes('Not played yet'));
    // Nett Out + Nett In must add up to the total, assumed holes included (back nine unplayed here).
    const backAssumed=String(HOLE_PARS.slice(9).reduce((s,p)=>s+p+3,0));
    T('Nett In shows the assumed back-nine subtotal, not a dash',[...document.querySelectorAll('#eclecticRankings td')].some(td=>td.textContent.trim()===backAssumed));
    activeId=1;document.getElementById('myDreamYear')&&(document.getElementById('myDreamYear').innerHTML='<option>Summer 2026</option>');renderMyDreamCard();
    T('My Dream Card shows the assumed back-nine subtotal too',document.getElementById('myDreamCardBody')?.innerHTML.includes('>'+backAssumed+'<'));
    // ── Rules page by season ──
    players=[P(1,'Ann'),P(2,'Bo')];seasonEntries=[{id:31,season:'Winter 2027',player_id:1,paid_at:'2026-09-26T10:00:00Z',amount:175}];
    const notes=()=>document.getElementById('rulesSeasonNotes').innerText,opts=()=>[...document.getElementById('rulesSeason').options].map(o=>o.value);
    today=()=>'2026-09-28';renderRules();
    T('during Summer the Rules page offers Summer and the Winter taking entries, Summer first',opts().includes('Summer 2026')&&opts().includes('Winter 2027')&&document.getElementById('rulesSeason').value==='Summer 2026');
    T('Summer rules: best 4, DKK 250, no entry text',/best 4/i.test(notes())&&/DKK 250/.test(notes())&&!/Enter on the Season tab/.test(notes()));
    renderRules('Winter 2027');
    T('Winter rules: best 3, DKK 175, entry, 60% eclectic, season end and tees',/best 3/i.test(notes())&&/DKK 175/.test(notes())&&/Enter on the Season tab/.test(notes())&&/60%/.test(notes())&&/1 April/.test(notes())&&/tee 54 is assumed/.test(notes()));
    T('choosing Winter sets best N and the pot to Winter',[...document.querySelectorAll('.rulesBestN')].every(e=>e.textContent==='3')&&/1 paid entry/.test(document.getElementById('rulesPot').innerHTML));
    T('the page names the season it describes',/Winter 2027/.test(document.getElementById('rulesSeasonTitle').textContent));
    today=()=>'2026-11-01';renderRules();
    T('from 4 October the Rules page opens on Winter',document.getElementById('rulesSeason').value==='Winter 2027');
    // ── end ──
  }catch(e){out.push('FAIL EXCEPTION :: '+e.stack);}
  await new Promise(r=>setTimeout(r,150));
  const pre=document.createElement('pre');pre.id='RESULT';pre.textContent=out.join('\n');document.body.innerHTML='';document.body.appendChild(pre);
},400);
