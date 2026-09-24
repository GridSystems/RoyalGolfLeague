// Matchplay league. Run: powershell -NoProfile -File tests/run.ps1 -Test tests/matchplay.test.js
setTimeout(async function(){
  const out=[];const T=(n,c,d='')=>out.push((c?'PASS ':'FAIL ')+n+(c?'':' :: '+d));
  const calls=[];let respond=()=>[];
  window.fetch=async(url,opts={})=>{url=String(url);const body=opts.body?JSON.parse(opts.body):null;calls.push({url,method:opts.method||'GET',body});
    const b=respond(url,body,opts.method||'GET');const st=b&&b.__status||200;return{ok:st<400,status:st,json:async()=>b,text:async()=>JSON.stringify(b)};};
  const reset=fn=>{calls.length=0;respond=fn||(()=>[]);};
  window.toast=()=>{};window.setLoading=()=>{};window.confirm=()=>true;window.alert=m=>{window.__alert=m;};
  tees=[..._TEES_SEED];_session=null;today=()=>'2027-05-10';
  // A player with one handicap index; a league match between a and b (group unless x says otherwise).
  const P=(id,name,idx=18,x={})=>({id,name,color:id%10,hcp_history:[{date:'2026-01-01',value:idx,note:''}],approved:true,is_social:false,...x});
  const M=(id,a,b,x={})=>({id,tournament_id:900,round:1,match_num:1,stage:'group',bracket:null,team_a_p1_id:a,team_b_p1_id:b,team_a_p2_id:null,team_b_p2_id:null,
    status:'pending',result:null,start_hole:1,extra_holes:0,outcome:'played',decided_by:null,played_on:null,tee_id:null,_teeId:'57',...x});
  // Score rows for a match: rows of [hole, grossA, grossB].
  const card=(m,rows)=>rows.flatMap(([h,ga,gb])=>[{match_id:m.id,hole:h,player_id:m.team_a_p1_id,gross:ga},{match_id:m.id,hole:h,player_id:m.team_b_p1_id,gross:gb}]);
  const holes=(from,to,ga,gb)=>{const r=[];for(let h=from;h<=to;h++)r.push([h,ga,gb]);return r;};
  try{
    // ── Task 2: strokes, hole order, deciding a match ──
    {
      players=[P(1,'Ann',9.3),P(2,'Bo',16.4),P(3,'Cy',2),P(4,'Di',24)];
      const t57=_TEES_SEED.find(t=>t.id==='57');
      T('90% of course handicap on the 57 tee: 9.3 → 12, 16.4 → 20',tmPlayingHcp(players[0],t57,'2027-05-10')===12&&tmPlayingHcp(players[1],t57,'2027-05-10')===20);
      let m=M(1,1,2),info=tmMatchHcpInfo(m,'2027-05-10');
      T('12 v 20: the 20 receives 8, the 12 plays off 0',info.diff===8&&info.receivingTeam==='b'&&info.phA1===12&&info.phB1===20);
      const wonBy=(mm,inf,ga,gb)=>HOLE_HCP.map((si,i)=>tmHoleResult(i,mm,inf,{[mm.team_a_p1_id]:ga,[mm.team_b_p1_id]:gb}).result);
      T('12 v 20, level gross: B wins exactly the SI 1–8 holes',wonBy(m,info,4,4).every((x,i)=>x===(HOLE_HCP[i]<=8?'b':'half')));
      m=M(2,3,4);info=tmMatchHcpInfo(m,'2027-05-10');
      T('diff > 18: 4 v 29 gives 25 strokes',info.diff===25&&info.receivingTeam==='b');
      T('diff 25: two strokes on SI 1–7 (B wins 5 v 4 there), one elsewhere (halved)',wonBy(m,info,4,5).every((x,i)=>x===(HOLE_HCP[i]<=7?'b':'half')));
      const td1={id:50,tournament_id:901,round:1,match_num:1,team_a_p1_id:1,team_a_p2_id:3,team_b_p1_id:2,team_b_p2_id:4,_teeId:'57'};
      info=tmMatchHcpInfo(td1,'2027-05-10');
      T('team day round 1 is still a fourball: the lowest of four plays off 0',tmIsFourball(td1)&&info.phA2===0&&info.phA1===8&&info.phB1===16&&info.phB2===25);
      T('a league match in round 1 is singles, not a fourball',!tmIsFourball(M(3,1,2,{round:1})));
      const td2={id:51,tournament_id:901,round:2,match_num:1,team_a_p1_id:1,team_b_p1_id:2,team_a_p2_id:null,team_b_p2_id:null,_teeId:'57'};
      info=tmMatchHcpInfo(td2,'2027-05-10');
      T('team day singles (diff ≤ 18) unchanged: strokes on SI 1–8',wonBy(td2,info,4,4).every((x,i)=>x===(HOLE_HCP[i]<=8?'b':'half'))&&info.strokeHoles.length===8);
      T('handicap date: team day uses the tournament date, a league match the day it was played',tmMatchDate(td2,{date:'2027-07-04'})==='2027-07-04'&&tmMatchDate(M(9,1,2,{played_on:'2027-06-01'}),{})==='2027-06-01'&&tmMatchDate(M(9,1,2),{})==='2027-05-10');
      // hole order
      T('start on the 1st: 1…18',mlPlayOrder(M(4,1,2)).join()==='1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18');
      const m10=M(5,1,2,{start_hole:10,stage:'semi',bracket:1,round:4});
      T('start on the 10th: 10…18 then 1…9',mlPlayOrder(m10).join()==='10,11,12,13,14,15,16,17,18,1,2,3,4,5,6,7,8,9');
      T('sudden death replays from the start hole: from 1st 19 = hole 1; from 10th 19 = hole 10, 20 = hole 11',tmHoleIdx(M(6,1,2),19)===0&&tmHoleIdx(m10,19)===9&&tmHoleIdx(m10,20)===10&&tmHoleIdx(m10,5)===4);
      T('next hole: 18 → 1 from the 10th; after the 9th a playoff goes to 19; then 20',mlNextHole(m10,18)===1&&mlNextHole(m10,9)===19&&mlNextHole(m10,19)===20);
      T('a group match never goes past its 18th hole',mlNextHole(M(7,1,2),18)===18);
      T('previous hole: 1 → 18 from the 10th; 19 → 9; the first hole stays',mlPrevHole(m10,1)===18&&mlPrevHole(m10,19)===9&&mlPrevHole(m10,10)===10&&mlPrevHole(m10,21)===20);
      // deciding a match (two level players: nett = gross)
      players.push(P(11,'Eve',18),P(12,'Fin',18));
      const lv=(id,x={})=>M(id,11,12,x);
      const decide=(mm,rows)=>mlDecide(mm,tmMatchHcpInfo(mm,'2027-05-10'),card(mm,rows));
      const g=lv(20);let d=decide(g,[...holes(1,3,3,4),...holes(4,16,4,4)]);
      T('3 up with 2 to play closes the match: 3&2, thru 16',d.decided&&d.winner==='a'&&d.label==='3&2'&&d.thru===16&&d.holes.a===3&&d.holes.b===0);
      d=decide(g,[...holes(1,3,3,4),...holes(4,16,4,4),[17,9,3],[18,9,3]]);
      T('holes after the match was decided are ignored',d.label==='3&2'&&d.holes.b===0);
      d=decide(g,[...holes(1,17,4,4),[18,3,4]]);T('won on the 18th: 1UP',d.decided&&d.winner==='a'&&d.label==='1UP');
      d=decide(g,holes(1,18,4,4));T('group match level after 18: halved',d.decided&&d.winner==='half'&&d.label==='Halved');
      d=decide(g,holes(1,5,4,4));T('in progress: undecided, A/S thru 5, started',!d.decided&&d.label==='A/S thru 5'&&d.started);
      T('no scores: not started',!decide(g,[]).started);
      d=decide(g,[[1,4,4],...holes(2,3,3,4),...holes(4,16,4,4)]);
      T('a corrected hole turns 3&2 into 2 up with 2 to play: the match is undecided again',!d.decided&&d.up===2&&d.thru===16);
      d=decide(g,[...holes(1,3,4,3),...holes(4,16,4,4)]);T('a correction can flip the winner',d.winner==='b'&&d.label==='3&2');
      d=decide(g,[[1,0,5],...holes(2,17,4,4),[18,4,4]]);T('a pickup (0) loses the hole: A picked up on the 1st, B wins 1UP',d.winner==='b'&&d.label==='1UP');
      const s1=lv(21,{stage:'semi',bracket:1,round:4});
      d=decide(s1,holes(1,18,4,4));T('playoff level after 18: sudden death, undecided',!d.decided&&/sudden death/.test(d.label));
      d=decide(s1,[...holes(1,18,4,4),[19,4,4],[20,4,3]]);
      T('sudden death: won at the 20th by B, 2 extra holes',d.decided&&d.winner==='b'&&d.label==='won at the 20th'&&d.extra===2);
      const s10=lv(22,{stage:'semi',bracket:1,round:4,start_hole:10});
      d=decide(s10,[...holes(10,12,3,4),...holes(13,18,4,4),...holes(1,7,4,4)]);
      T('from the 10th: 3&2 after 16 holes played (the 7th)',d.decided&&d.label==='3&2'&&d.thru===16);
      // sudden death at the same strokes: B receives 4 (SI 1–4); level in 18 because B scores 5 on SI 1–4
      const sd=start=>{const mm=M(23,1,2,{stage:'semi',bracket:1,round:4,start_hole:start});
        return mlDecide(mm,{receivingTeam:'b',diff:4},card(mm,[...HOLE_HCP.map((si,i)=>[i+1,4,si<=4?5:4]),[19,4,4]]));};
      T('sudden death from the 1st plays hole 1 (SI 4): the stroke wins it at the 19th',sd(1).winner==='b'&&sd(1).label==='won at the 19th');
      T('sudden death from the 10th plays hole 10 (SI 5): no stroke, still level',!sd(10).decided&&sd(10).extra===1);
      T('walkover: decided for the named player',decide(lv(24,{outcome:'walkover',result:'b'}),[]).winner==='b');
      d=decide(lv(25,{outcome:'halve_decision',result:'half'}),[]);T('halve by decision: half, started',d.winner==='half'&&d.started&&d.decided);
      d=decide(lv(26,{outcome:'double_forfeit'}),[]);T('group double forfeit: decided, nobody wins',d.decided&&d.winner===null);
      T('playoff double forfeit: the named player goes through',decide(lv(27,{outcome:'double_forfeit',result:'a',stage:'semi',bracket:1,round:4}),[]).winner==='a');
    }
    // ── end ──
  }catch(e){out.push('FAIL EXCEPTION :: '+e.stack);}
  await new Promise(r=>setTimeout(r,150));
  const pre=document.createElement('pre');pre.id='RESULT';pre.textContent=out.join('\n');document.body.innerHTML='';document.body.appendChild(pre);
},400);
