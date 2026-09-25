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
    // ── Task 3: draw, fixtures, deadlines ──
    {
      const ents=[5,30,12,1,22,8,17,3,26,14,9,20,2,28,11,6].map((index,i)=>({pid:100+i,index}));
      const potOf={};[...ents].sort((x,y)=>x.index-y.index).forEach((e,i)=>potOf[e.pid]=Math.floor(i/4)+1);
      let okPots=true,okDistinct=true;const seenInA=new Set();
      for(let k=0;k<200;k++){const gs=mlDrawGroups(ents);
        if(!gs.every(g=>g.map(p=>potOf[p]).join()==='1,2,3,4'))okPots=false;
        if(new Set(gs.flat()).size!==16)okDistinct=false;
        seenInA.add(gs[0][0]);}
      T('draw: every group has one player from each pot, in pot order',okPots);
      T('draw: 16 distinct players',okDistinct);
      T('draw: which pot-1 player lands in group A varies',seenInA.size===4);
      const tie=[...Array(16)].map((_,i)=>({pid:200+i,index:i<3?1:i<5?10:20+i}));   // 203 and 204 tie on 10 across the pot 1/2 boundary
      T('draw: an index tie across a pot boundary goes by sign-up order',mlDrawGroups(tie).some(g=>g[0]===203)&&mlDrawGroups(tie).every(g=>g[0]!==204));
      const GR=[[1,2,3,4],[5,6,7,8],[9,10,11,12],[13,14,15,16]];
      const fx=mlFixtures(GR),grp=fx.filter(r=>r.stage==='group');
      T('fixtures: 40 rows — 24 group matches, 8 semis, 4 finals, 4 third/fourth',fx.length===40&&grp.length===24&&fx.filter(r=>r.stage==='semi').length===8&&fx.filter(r=>r.stage==='final').length===4&&fx.filter(r=>r.stage==='place').length===4);
      T('fixtures: every pair in a group meets exactly once',GR.every(g=>{const ps=grp.filter(r=>g.includes(r.team_a_p1_id)).map(r=>[r.team_a_p1_id,r.team_b_p1_id].sort((x,y)=>x-y).join('-'));return ps.length===6&&new Set(ps).size===6&&ps.every(p=>p.split('-').every(x=>g.includes(+x)));}));
      T('fixtures: 2 matches per group per round, each player once a round',GR.every((g,gi)=>[1,2,3].every(rd=>{const ms=grp.filter(r=>r.round===rd&&mlGroupOf(r)===gi+1);return ms.length===2&&new Set(ms.flatMap(r=>[r.team_a_p1_id,r.team_b_p1_id])).size===4;})));
      T('fixtures: round + match number identify every slot',new Set(fx.map(r=>r.round+'-'+r.match_num)).size===40);
      T('fixtures: playoff slots start empty, semis round 4, finals and 3rd/4th round 5',fx.filter(r=>r.stage!=='group').every(r=>r.team_a_p1_id==null&&r.team_b_p1_id==null&&r.bracket>=1)&&fx.filter(r=>r.stage==='semi').every(r=>r.round===4)&&fx.filter(r=>r.stage==='final'||r.stage==='place').every(r=>r.round===5));
      T('match names',mlMatchName({stage:'group',round:2,match_num:3})==='Group B · round 2'&&mlMatchName({stage:'semi',bracket:2,match_num:4})==='Runners-up semi-final 2'&&mlMatchName({stage:'final',bracket:1,match_num:1})==='Winners final'&&mlMatchName({stage:'place',bracket:4,match_num:8})==='Fourths 3rd/4th');
      const LGd={deadlines:{group_1:'2027-05-15',group_2:'2027-06-15',group_3:'2027-07-31',semi:'2027-08-20',final:'2027-09-10'}};
      today=()=>'2027-05-16';
      T('deadline by round: 1 → group_1, 4 → semi, 5 → final',mlDeadline(LGd,{round:1})==='2027-05-15'&&mlDeadline(LGd,{round:4})==='2027-08-20'&&mlDeadline(LGd,{round:5})==='2027-09-10');
      T('overdue: past the deadline and undecided',mlOverdue(LGd,{round:1},{decided:false}));
      T('not overdue once decided',!mlOverdue(LGd,{round:1},{decided:true}));
      today=()=>'2027-05-15';T('not overdue on the deadline day itself',!mlOverdue(LGd,{round:1},{decided:false}));
      T('no deadlines set: never overdue',!mlOverdue({},{round:1},{decided:false}));
      today=()=>'2027-05-10';
    }
    // ── Task 4: group standings and tie-breaks ──
    {
      const rec=(a,b,winner,x={})=>({stage:'group',a,b,decided:winner!==undefined,winner:winner===undefined?null:winner,holes:{a:0,b:0},ph:null,started:true,...x});
      const order=(recs,seeds={1:1,2:2,3:3,4:4})=>mlStandings([1,2,3,4],recs,seeds).map(s=>s.pid).join(',');
      let st=mlStandings([1,2,3,4],[rec(1,4,'a'),rec(2,3,'half'),rec(1,3,'b'),rec(4,2,'b'),rec(1,2,undefined),rec(3,4,undefined)],{1:1,2:2,3:3,4:4});
      const row=pid=>st.find(s=>s.pid===pid);
      T('table: P W H L and points (1 / ½ / 0); undecided matches not counted',row(1).P===2&&row(1).W===1&&row(1).L===1&&row(1).pts===1&&row(2).H===1&&row(2).pts===1.5&&row(4).P===2&&row(4).pts===0);
      T('table: ordered by points, positions 1–4',st[0].pts===1.5&&st[3].pid===4&&st.map(s=>s.pos).join()==='1,2,3,4');
      T('(a) two tied: the winner of their match ranks higher, even with fewer holes won',
        order([rec(1,2,'b',{holes:{a:0,b:1}}),rec(1,3,'a',{holes:{a:9,b:0}}),rec(2,4,'b',{holes:{a:0,b:2}}),rec(3,4,'a'),rec(1,4,'a',{holes:{a:5,b:0}}),rec(2,3,'a',{holes:{a:1,b:0}})])==='2,1,3,4');
      T('(b) tied and halved against each other: more group holes won ranks higher',
        order([rec(1,2,'half'),rec(1,3,'a',{holes:{a:2,b:0}}),rec(2,3,'a',{holes:{a:5,b:0}}),rec(1,4,'b'),rec(2,4,'b'),rec(3,4,'b')])==='4,2,1,3');
      T('(c) then lower average playing handicap',
        order([rec(1,2,'half',{ph:{a:14,b:10}}),rec(1,3,'a',{ph:{a:14,b:9}}),rec(2,3,'a',{ph:{a:10,b:9}}),rec(1,4,'b',{ph:{a:14,b:3}}),rec(2,4,'b',{ph:{a:10,b:3}}),rec(3,4,'b',{ph:{a:9,b:3}})])==='4,2,1,3');
      const flat=[rec(1,2,'half'),rec(1,3,'a'),rec(2,3,'a'),rec(1,4,'b'),rec(2,4,'b'),rec(3,4,'b')];
      T('(d) and finally seed pot',order(flat,{1:2,2:1,3:3,4:4})==='4,2,1,3'&&order(flat)==='4,1,2,3');
      // 1 beat 2, 2 beat 3, 1 halved 3; 1–4 double forfeit, 2–4 halved, 3 beat 4 → 1, 2, 3 all on 1½
      const three=[rec(1,2,'a',{holes:{a:1,b:0}}),rec(2,3,'a',{holes:{a:1,b:0}}),rec(1,3,'half'),rec(1,4,null),rec(2,4,'half'),rec(3,4,'a',{holes:{a:9,b:0}})];
      T('three-way tie resolved by the mini-table of their own matches (not holes, not seed)',order(three,{1:3,2:2,3:1,4:4})==='1,2,3,4');
      st=mlStandings([1,2,3,4],three,{1:3,2:2,3:1,4:4});
      T('double forfeit: played and lost for both, no points',row(4).L===2&&row(4).P===3&&row(1).L===1&&row(1).pts===1.5);
      T('three-way circle (equal mini-table) falls to holes won, then head-to-head again for the pair still level',
        order([rec(1,2,'a',{holes:{a:2,b:0}}),rec(2,3,'a',{holes:{a:1,b:0}}),rec(3,1,'a',{holes:{a:4,b:0}}),rec(1,4,'a',{holes:{a:3,b:0}}),rec(2,4,'a',{holes:{a:1,b:0}}),rec(3,4,'a',{holes:{a:1,b:0}})])==='3,1,2,4');
      st=mlStandings([1,2,3,4],[rec(1,2,'a',{ph:{a:10,b:20}}),rec(1,3,'a'),rec(1,4,'a',{ph:{a:14,b:2}})],{1:1,2:2,3:3,4:4});
      T('average playing handicap: played matches only (a walkover has none)',row(1).avgPh===12&&row(3).avgPh===null);
    }
    // ── end ──
  }catch(e){out.push('FAIL EXCEPTION :: '+e.stack);}
  await new Promise(r=>setTimeout(r,150));
  const pre=document.createElement('pre');pre.id='RESULT';pre.textContent=out.join('\n');document.body.innerHTML='';document.body.appendChild(pre);
},400);
