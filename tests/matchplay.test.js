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
      // 1 beat 2, 2 beat 3, 3 beat 4, 4 beat 1; 1–3 and 2–4 halved — all four on 1½, and the mini-table
      // among all four is level too (each has one win, one loss, one half within the set), so it falls
      // to holes won (1=3, 2=2, 3=2, 4=1); 2 and 3 are still tied there and the restart at (a) — their
      // own match — puts 2 above 3.
      T('four-way tie: level mini-table falls to holes won, then restarts at (a) for the pair still tied',
        order([rec(1,2,'a',{holes:{a:3,b:0}}),rec(2,3,'a',{holes:{a:2,b:0}}),rec(3,4,'a',{holes:{a:2,b:0}}),rec(4,1,'a',{holes:{a:1,b:0}}),rec(1,3,'half'),rec(2,4,'half')])==='1,2,3,4');
      // 1 and 2 are level on points from separate matches; their own match against each other is still
      // in progress (some holes already won) — undecided, so it contributes nothing anywhere, and the
      // tie falls straight to holes won from the decided matches only.
      T('tied players whose own match is still in progress: it counts for nothing, not even its holes',
        order([rec(1,3,'a',{holes:{a:1,b:0}}),rec(2,4,'a',{holes:{a:3,b:0}}),rec(1,2,undefined,{holes:{a:5,b:0}})])==='2,1,3,4');
      // 1 and 2 are level on points and holes; 1's only match was an admin outcome (no ph recorded,
      // avgPh null), 2's had a real ph — even though 1 has the better seed, null ranks below a real average.
      st=mlStandings([1,2,3,4],[rec(1,3,'a'),rec(2,4,'a',{ph:{a:15,b:20}})],{1:1,2:2,3:3,4:4});
      T('a null average (all admin outcomes) ranks below a real average, even with the better seed',
        row(1).avgPh===null&&row(2).avgPh===15&&row(2).pos<row(1).pos);
      T('standings rows expose the public shape only — no internal phs array',
        mlStandings([1,2,3,4],[rec(1,2,'a')],{1:1,2:2,3:3,4:4}).every(s=>!('phs' in s)));
    }
    // ── Task 5: playoffs, places and the edit rules ──
    const G=[[1,2,3,4],[5,6,7,8],[9,10,11,12],[13,14,15,16]],SEEDS={};G.forEach(g=>g.forEach((p,i)=>SEEDS[p]=i+1));
    {
      const fresh=()=>mlFixtures(G).map((m,i)=>({id:i+1,stage:m.stage,round:m.round,match_num:m.match_num,bracket:m.bracket,a:m.team_a_p1_id,b:m.team_b_p1_id,decided:false,winner:null,holes:{a:0,b:0},ph:null,started:false,label:'—'}));
      const win=(r,w)=>Object.assign(r,{decided:true,started:true,winner:w,holes:w==='a'?{a:3,b:0}:w==='b'?{a:0,b:3}:{a:1,b:1}});
      const better=r=>SEEDS[r.a]<SEEDS[r.b]?'a':'b';
      const grouped=()=>{const rs=fresh();rs.filter(r=>r.stage==='group').forEach(r=>win(r,better(r)));return rs;};
      const put=(rs,ups)=>{for(const u of ups){const r=rs.find(x=>x.id===u.id);r.a=u.team_a_p1_id;r.b=u.team_b_p1_id;}return rs;};
      const settle=rs=>put(rs,Object.entries(mlPlan(rs,G,SEEDS).want).filter(([id,w])=>{const r=rs.find(x=>x.id===+id);return w.a!==r.a||w.b!==r.b;}).map(([id,w])=>({id:+id,team_a_p1_id:w.a,team_b_p1_id:w.b})));
      const clone=rs=>rs.map(r=>({...r,holes:{...r.holes}}));
      const find=(rs,stage,b,n)=>rs.find(r=>r.stage===stage&&r.bracket===b&&(n==null||r.match_num===n));
      const slots=r=>r.a+'v'+r.b;
      const semisPlayed=()=>{const rs=settle(grouped());for(let b=1;b<=4;b++){win(find(rs,'semi',b,b*2-1),'a');win(find(rs,'semi',b,b*2),'a');}return settle(rs);};
      const full=()=>{const rs=semisPlayed();for(let b=1;b<=4;b++){win(find(rs,'final',b),'a');win(find(rs,'place',b),'a');}return rs;};
      const stA=rs=>mlStandings(G[0],rs.filter(r=>r.stage==='group'&&mlGroupOf(r)===1),SEEDS).map(x=>x.pid).join(',');
      // progression
      let before=grouped();const lastG=before.filter(r=>r.stage==='group').pop();Object.assign(lastG,{decided:false,winner:null});
      let after=clone(before);win(after.find(r=>r.id===lastG.id),better(lastG));
      let g=mlGate(before,after,lastG.id,G,SEEDS);
      T('last group match decided: all 8 semis filled',!g.blocker&&g.updates.length===8);
      put(after,g.updates);
      T('Winners semis: A1 v B1 and C1 v D1',slots(find(after,'semi',1,1))==='1v5'&&slots(find(after,'semi',1,2))==='9v13');
      T('Fourths semis: A4 v B4 and C4 v D4',slots(find(after,'semi',4,7))==='4v8'&&slots(find(after,'semi',4,8))==='12v16');
      T('finals wait for the semis',g.updates.every(u=>after.find(r=>r.id===u.id).stage==='semi'));
      const fl=full(),pl=mlPlaces(fl);
      T('places 1–16: each once, 16 different players',pl.map(x=>x.place).join()===[...Array(16)].map((_,i)=>i+1).join()&&new Set(pl.map(x=>x.pid)).size===16);
      T('Winners bracket gives places 1–4: 1, 9, 5, 13',pl.slice(0,4).map(x=>x.pid).join()==='1,9,5,13');
      T('champion: the Winners final winner',mlChampion(fl)===1);
      T('everyone plays exactly 5 matches',[...Array(16)].every((_,i)=>fl.filter(r=>r.decided&&(r.a===i+1||r.b===i+1)).length===5));
      T('group edit before the playoffs exist: nothing else changes',(()=>{const b0=fresh();win(b0[0],'a');const a0=clone(b0);win(a0[0],'b');const x=mlGate(b0,a0,1,G,SEEDS);return !x.blocker&&x.updates.length===0;})());
      // E1 — group edit, playoffs filled, none started → brackets rebuilt in place
      const b1=settle(grouped()),ab=b1.find(r=>r.stage==='group'&&r.round===3&&r.a===1&&r.b===2);
      T('E1 before: group A order 1,2,3,4',stA(b1)==='1,2,3,4');
      const a1=clone(b1);win(a1.find(r=>r.id===ab.id),'b');
      T('E1 after: 2 tops group A',stA(a1)==='2,1,3,4');
      g=mlGate(b1,a1,ab.id,G,SEEDS);
      T('E1: group edit with no playoff match started rebuilds the brackets',!g.blocker&&g.updates.length===2);
      put(a1,g.updates);
      T('E1: Winners semi 1 now 2 v 5; Runners-up semi 1 now 1 v 6',slots(find(a1,'semi',1,1))==='2v5'&&slots(find(a1,'semi',2,3))==='1v6');
      T('E1: the same match rows are updated (ids kept)',g.updates.every(u=>b1.some(r=>r.id===u.id&&r.stage==='semi')));
      // E2 — group edit once ANY playoff match has started → refused, nothing changes
      const b2=settle(grouped());find(b2,'semi',4,7).started=true;
      const a2=clone(b2);win(a2.find(r=>r.id===ab.id),'b');
      g=mlGate(b2,a2,ab.id,G,SEEDS);
      T('E2: group edit refused once any playoff match has started (even another bracket)',!!g.blocker&&!g.updates);
      T('E2: the refusal names the blocking match',mlMatchName(g.blocker)==='Fourths semi-final 1');
      // E3 — a group match re-opened (no longer decided) → every semi emptied
      const b3=settle(grouped()),a3=clone(b3);Object.assign(a3.find(r=>r.id===ab.id),{decided:false,winner:null});
      g=mlGate(b3,a3,ab.id,G,SEEDS);
      T('E3: re-opened group match empties all 8 semis',!g.blocker&&g.updates.length===8&&g.updates.every(u=>u.team_a_p1_id==null&&u.team_b_p1_id==null));
      T('E3: group A table drops the re-opened match',mlStandings(G[0],a3.filter(r=>r.stage==='group'&&mlGroupOf(r)===1),SEEDS).find(x=>x.pid===1).P===2);
      // E4 — semi edit, final and 3rd/4th unstarted → exactly those two rebuilt
      const b4=semisPlayed(),sf1=find(b4,'semi',1,1);
      T('E4 before: Winners final 1 v 9, 3rd/4th 5 v 13',slots(find(b4,'final',1))==='1v9'&&slots(find(b4,'place',1))==='5v13');
      const a4=clone(b4);win(a4.find(r=>r.id===sf1.id),'b');
      g=mlGate(b4,a4,sf1.id,G,SEEDS);
      T('E4: semi edit rebuilds its final and 3rd/4th only',!g.blocker&&g.updates.length===2);
      put(a4,g.updates);
      T('E4: Winners final now 5 v 9; 3rd/4th 1 v 13',slots(find(a4,'final',1))==='5v9'&&slots(find(a4,'place',1))==='1v13');
      T('E4: other brackets untouched',[2,3,4].every(b=>slots(find(a4,'final',b))===slots(find(b4,'final',b))));
      // E5 — semi edit refused once its final or 3rd/4th has started; another bracket doesn't block
      let b5=semisPlayed();find(b5,'final',1).started=true;let a5=clone(b5);win(a5.find(r=>r.id===sf1.id),'b');
      g=mlGate(b5,a5,sf1.id,G,SEEDS);
      T('E5: semi edit refused once its final has started, naming it',!!g.blocker&&mlMatchName(g.blocker)==='Winners final');
      b5=semisPlayed();find(b5,'place',1).started=true;a5=clone(b5);win(a5.find(r=>r.id===sf1.id),'b');
      g=mlGate(b5,a5,sf1.id,G,SEEDS);
      T('E5: refused when only its 3rd/4th has started',!!g.blocker&&mlMatchName(g.blocker)==='Winners 3rd/4th');
      b5=semisPlayed();find(b5,'final',2).started=true;a5=clone(b5);win(a5.find(r=>r.id===sf1.id),'b');
      g=mlGate(b5,a5,sf1.id,G,SEEDS);
      T('E5: another bracket\'s final having started does not block',!g.blocker&&g.updates.length===2);
      // E6 — semi re-opened (now needs sudden death) → final and 3rd/4th emptied
      const b6=semisPlayed(),a6=clone(b6);Object.assign(a6.find(r=>r.id===sf1.id),{decided:false,winner:null});
      g=mlGate(b6,a6,sf1.id,G,SEEDS);
      T('E6: a re-opened semi empties its final and 3rd/4th',!g.blocker&&g.updates.length===2&&g.updates.every(u=>u.team_a_p1_id==null&&u.team_b_p1_id==null));
      // E7 — final edit: places and champion only
      const b7=full(),fin1=find(b7,'final',1),a7=clone(b7);win(a7.find(r=>r.id===fin1.id),'b');
      g=mlGate(b7,a7,fin1.id,G,SEEDS);
      T('E7: final edit changes no playoff slot',!g.blocker&&g.updates.length===0);
      T('E7: places 1 and 2 swap; places 3–16 unchanged',mlPlaces(a7).slice(0,4).map(x=>x.pid).join()==='9,1,5,13'&&mlPlaces(a7).slice(4).map(x=>x.pid).join()===mlPlaces(b7).slice(4).map(x=>x.pid).join());
      T('E7: the champion follows the final',mlChampion(b7)===1&&mlChampion(a7)===9);
      Object.assign(a7.find(r=>r.id===fin1.id),{decided:false,winner:null});
      T('E7: an undecided final leaves places 1–2 and the champion empty',mlChampion(a7)===null&&!mlPlaces(a7).some(x=>x.place<=2)&&mlPlaces(a7).length===14);
      // E8 — 3rd/4th edit
      const pl1=find(b7,'place',1),a8=clone(b7);win(a8.find(r=>r.id===pl1.id),'b');
      g=mlGate(b7,a8,pl1.id,G,SEEDS);
      T('E8: 3rd/4th edit: no slot changes, places 3 and 4 swap, champion unchanged',!g.blocker&&g.updates.length===0&&mlPlaces(a8).slice(2,4).map(x=>x.pid).join()==='13,5'&&mlChampion(a8)===1);
      // E9 — playoff double forfeit naming who goes through
      const b9=settle(grouped());win(find(b9,'semi',1,1),'a');
      const sf2=find(b9,'semi',1,2),a9=clone(b9);Object.assign(a9.find(r=>r.id===sf2.id),{decided:true,started:true,winner:'b',holes:{a:0,b:0}});
      g=mlGate(b9,a9,sf2.id,G,SEEDS);put(a9,g.updates);
      T('E9: playoff double forfeit: the named player goes through to the final',slots(find(a9,'final',1))==='1v13'&&slots(find(a9,'place',1))==='5v9');
      // ── strict extras: every edit rule both ways; "refused" means nothing is written ──
      const snap=rs=>JSON.stringify(rs),wo=(r,w)=>Object.assign(r,{decided:true,started:true,winner:w,holes:{a:0,b:0}});
      {const b=settle(grouped());find(b,'semi',2,3).started=true;const a=clone(b);win(a.find(r=>r.id===ab.id),'b');
       const sb=snap(b),sa=snap(a),x=mlGate(b,a,ab.id,G,SEEDS);
       T('X: a refusal carries only the blocker (no updates) and mutates neither side',!!x.blocker&&!('updates' in x)&&snap(b)===sb&&snap(a)===sa);}
      {const b=settle(grouped()),a=clone(b);win(a.find(r=>r.id===ab.id),'b');const sb=snap(b),sa=snap(a);mlGate(b,a,ab.id,G,SEEDS);
       T('X: an allowed rebuild mutates neither side either (the caller writes)',snap(b)===sb&&snap(a)===sa);}
      {const b=settle(grouped()),a=clone(b);Object.assign(a.find(r=>r.id===ab.id),{holes:{a:5,b:0}});
       const x=mlGate(b,a,ab.id,G,SEEDS);
       T('X: a group edit that moves nobody passes cleanly with no slot updates',stA(a)==='1,2,3,4'&&!x.blocker&&x.updates.length===0);
       find(b,'semi',3,5).started=true;const y=mlGate(b,a,ab.id,G,SEEDS);
       T('X: …but once any playoff match has started even that edit is refused (rule 1)',!!y.blocker&&mlMatchName(y.blocker)==='Thirds semi-final 1');}
      {const b=settle(grouped());find(b,'semi',1,1).started=true;const a=clone(b);Object.assign(a.find(r=>r.id===ab.id),{decided:false,winner:null});
       const x=mlGate(b,a,ab.id,G,SEEDS);
       T('X: re-opening a group match is refused once a playoff match has started',!!x.blocker&&!x.updates&&mlMatchName(x.blocker)==='Winners semi-final 1');}
      // admin outcomes are edits
      {const b=settle(grouped()),a=clone(b);wo(a.find(r=>r.id===ab.id),'b');const x=mlGate(b,a,ab.id,G,SEEDS);
       T('X: a group walkover is an edit: rebuilds the brackets like a score',stA(a)==='2,1,3,4'&&!x.blocker&&x.updates.length===2);
       find(b,'semi',4,8).started=true;const y=mlGate(b,a,ab.id,G,SEEDS);
       T('X: …and is refused once any playoff match has started',!!y.blocker&&!y.updates&&mlMatchName(y.blocker)==='Fourths semi-final 2');}
      {const b=settle(grouped()),a=clone(b);Object.assign(a.find(r=>r.id===ab.id),{decided:true,started:true,winner:'half',holes:{a:0,b:0}});
       const x=mlGate(b,a,ab.id,G,SEEDS);
       T('X: a group halve by decision that moves nobody passes with no slot updates',stA(a)==='1,2,3,4'&&!x.blocker&&x.updates.length===0);}
      {const b=semisPlayed(),a=clone(b);wo(a.find(r=>r.id===sf1.id),'b');const x=mlGate(b,a,sf1.id,G,SEEDS);put(a,x.updates);
       T('X: a semi walkover is an edit: rebuilds its final and 3rd/4th',!x.blocker&&x.updates.length===2&&slots(find(a,'final',1))==='5v9'&&slots(find(a,'place',1))==='1v13');
       const b2=semisPlayed();find(b2,'place',1).started=true;const a2=clone(b2);wo(a2.find(r=>r.id===sf1.id),'b');const y=mlGate(b2,a2,sf1.id,G,SEEDS);
       T('X: …refused once its 3rd/4th has started',!!y.blocker&&!y.updates&&mlMatchName(y.blocker)==='Winners 3rd/4th');}
      {const b=full(),f=find(b,'final',1),a=clone(b);wo(a.find(r=>r.id===f.id),'b');const x=mlGate(b,a,f.id,G,SEEDS);
       T('X: a final walkover changes no slot, only the champion',!x.blocker&&x.updates.length===0&&mlChampion(a)===9);}
      {const b=semisPlayed();find(b,'final',1).started=true;const a=clone(b);Object.assign(a.find(r=>r.id===sf1.id),{decided:false,winner:null});
       const x=mlGate(b,a,sf1.id,G,SEEDS);
       T('X: re-opening a semi (now needs sudden death) is refused once its final has started',!!x.blocker&&!x.updates&&mlMatchName(x.blocker)==='Winners final');}
      // scope: a semi edit touches only its own bracket; a final or 3rd/4th edit touches no slot at all
      {const b=semisPlayed();Object.assign(find(b,'final',2),{a:null,b:null});const a=clone(b);win(a.find(r=>r.id===sf1.id),'b');
       const x=mlGate(b,a,sf1.id,G,SEEDS);
       T('X: a semi edit updates only its own bracket, even with another bracket out of step',!x.blocker&&x.updates.length===2&&x.updates.every(u=>a.find(r=>r.id===u.id).bracket===1));}
      {const b=full();Object.assign(find(b,'place',3),{started:false,decided:false,winner:null,a:null,b:null});const f=find(b,'final',1),a=clone(b);win(a.find(r=>r.id===f.id),'b');
       const x=mlGate(b,a,f.id,G,SEEDS);
       T('X: a final edit writes no slot, even with another bracket out of step',!x.blocker&&x.updates.length===0);}
      // places and champion: derived from the current records on every call
      {const rs=full(),p0=mlPlaces(rs).map(x=>x.pid).join(),f4=find(rs,'final',4);f4.winner='b';
       T('X: places are re-derived from the current records on every call',mlPlaces(rs).find(x=>x.place===13).pid===f4.b&&mlPlaces(rs).map(x=>x.pid).join()!==p0);
       const r2=semisPlayed();win(find(r2,'final',3),'a');
       T('X: a bracket with only its final decided gives just those two places',mlPlaces(r2).map(x=>x.place).join()==='9,10');
       const r3=semisPlayed();for(let b=2;b<=4;b++)win(find(r3,'final',b),'a');win(find(r3,'place',1),'a');
       T('X: no champion until the Winners final is decided, whatever else is',mlChampion(r3)===null);}
    }
    // ── Task 6: the Tournament tab for a league ──
    const LG={id:900,name:'Matchplay 2027',date:'2027-04-01',tee_id:'57',format:'league',status:'drawn',buy_in:200,max_players:16,
      deadlines:{group_1:'2027-05-15',group_2:'2027-06-15',group_3:'2027-07-31',semi:'2027-08-20',final:'2027-09-10'}};
    // A drawn league: players 1–16 all index 18 (nett = gross), groups G, 40 matches (ids 1–40), no scores.
    const league=()=>{tournaments=[{...LG}];activeTournamentId=900;TE.matchId=null;mlTab='groups';
      players=[...Array(16)].map((_,i)=>P(i+1,'P'+(i+1)));players[0].is_admin=true;activeId=2;
      tournamentPlayers=G.flatMap((g,gi)=>g.map((pid,k)=>({id:100+pid,tournament_id:900,player_id:pid,team:'league',group_num:gi+1,seed_pot:k+1,entered_at:new Date(Date.UTC(2027,2,1,10,0,pid)).toISOString(),paid_at:null,amount:null})));
      tournamentMatches=mlFixtures(G).map((r,i)=>({id:i+1,tournament_id:900,status:'pending',result:null,start_hole:1,extra_holes:0,outcome:'played',decided_by:null,played_on:null,tee_id:null,team_a_p2_id:null,team_b_p2_id:null,_teeId:'57',...r}));
      tournamentScores=[];};
    // An open league with n entries (players 1–n signed up in that order; 20 players exist).
    const entryLeague=n=>{tournaments=[{...LG,status:'entry'}];activeTournamentId=900;TE.matchId=null;
      players=[...Array(20)].map((_,i)=>P(i+1,'P'+(i+1)));players[0].is_admin=true;
      tournamentPlayers=[...Array(n)].map((_,i)=>({id:300+i+1,tournament_id:900,player_id:i+1,team:'league',entered_at:new Date(Date.UTC(2027,2,1,10,0,i)).toISOString(),paid_at:null,amount:null,group_num:null,seed_pot:null}));
      tournamentMatches=[];tournamentScores=[];};
    let sid=1000;
    const stub=()=>reset((u,b,m)=>m==='POST'&&u.includes('tournament_scores')?[{id:++sid,...b}]:m==='PATCH'?[{...b,id:+(u.match(/id=eq\.(\d+)/)||[])[1]}]:[]);
    const byId=id=>tournamentMatches.find(m=>m.id===id);
    const gm=()=>tournamentMatches.filter(m=>m.stage==='group');
    const semi=(b,n)=>tournamentMatches.find(m=>m.stage==='semi'&&m.bracket===b&&m.match_num===b*2-2+n);
    const fin=(b,stage='final')=>tournamentMatches.find(m=>m.stage===stage&&m.bracket===b);
    const W=w=>w==='a'?[3,5]:[5,3];
    // Decide a match locally, no requests: the winner takes holes 1–10 (10&8).
    const decideLocal=(m,w)=>{tournamentScores.push(...card(m,holes(1,10,...W(w))));Object.assign(m,{status:'complete',result:w,played_on:'2027-05-01'});};
    const seedWin=m=>{const s={};tournamentPlayers.forEach(e=>s[e.player_id]=e.seed_pot);return s[m.team_a_p1_id]<s[m.team_b_p1_id]?'a':'b';};
    // Put the planned players into every playoff slot, locally (what mlChange writes).
    const fillLocal=()=>{const t=tournaments[0],{groups,seeds}=mlGroups(t),{want}=mlPlan(mlRecords(t),groups,seeds);for(const m of tournamentMatches)if(want[m.id]){m.team_a_p1_id=want[m.id].a;m.team_b_p1_id=want[m.id].b;}};
    const tc=()=>document.getElementById('tournamentContent').innerHTML;
    {
      league();today=()=>'2027-05-16';
      gm().filter(m=>mlGroupOf(m)===1&&m.round<3).forEach(m=>decideLocal(m,seedWin(m)));
      T('records: one per league match, decided from the scores',mlRecords(tournaments[0]).length===40&&mlRecords(tournaments[0]).filter(r=>r.decided).length===4&&mlRecords(tournaments[0])[0].label==='10&8');
      T('records: playing handicaps kept for played matches',mlRecords(tournaments[0])[0].ph.a===mlRecords(tournaments[0])[0].ph.b);
      T('groups from the draw, in pot order, with seeds',JSON.stringify(mlGroups(tournaments[0]).groups)===JSON.stringify(G)&&mlGroups(tournaments[0]).seeds[7]===3);
      renderTournament();let html=tc();
      T('league: Groups, Playoffs and Results tabs; no team-day tabs',/>Groups</.test(html)&&/>Playoffs</.test(html)&&/>Results</.test(html)&&!/Fourballs/.test(html));
      T('four group tables with P W H L Pts Holes Avg PH',(html.match(/>Group [ABCD]</g)||[]).length===4&&/>Pts</.test(html)&&/>Avg PH</.test(html));
      const blockA=html.split('>Group B<')[0];
      T('group A ordered by points',blockA.indexOf('>P1<')<blockA.indexOf('>P2<')&&blockA.indexOf('>P2<')<blockA.indexOf('>P3<'));
      T('fixtures show their round and play-by date',/Round 1 · play by 15 May 2027/.test(html));
      T('Overdue: the six undecided round-1 matches past 15 May, not the decided ones',(html.match(/>Overdue</g)||[]).length===6);
      T('decided result shown',/10&amp;8/.test(html));
      T('rows open for the two players while undecided',html.includes('teOpenMatch(5)')&&!html.includes('teOpenMatch(2)')&&!html.includes('teOpenMatch(6)'));
      activeId=1;renderTournament();html=tc();
      T('an admin can open any match, decided ones too',html.includes('teOpenMatch(2)')&&html.includes('teOpenMatch(6)'));
      mlTab='playoffs';renderTournament();html=tc();
      T('Playoffs: four brackets with their places',/Winners — places 1–4/.test(html)&&/Fourths — places 13–16/.test(html));
      T('Playoffs: how the semis are made',/Group A 1st v Group B 1st/.test(html));
      mlTab='results';renderTournament();
      T('Results: nothing yet',/Places appear as the finals/.test(tc()));
      gm().forEach(m=>{if(m.status!=='complete')decideLocal(m,seedWin(m));});fillLocal();
      for(let b=1;b<=4;b++){decideLocal(semi(b,1),'a');decideLocal(semi(b,2),'a');}fillLocal();
      for(let b=1;b<=4;b++){decideLocal(fin(b),'a');decideLocal(fin(b,'place'),'a');}
      renderTournament();html=tc();
      T('Results: 16 places, the champion marked',(html.match(/<tr><td>\d+(st|nd|rd|th)</g)||[]).length===16&&/🏆 P1</.test(html));
      mlTab='groups';players[2].name='<b>X</b>';players[3].archived_at='2027-05-01';renderTournament();
      T('names are escaped',!document.getElementById('tournamentContent').querySelector('b')&&/&lt;b&gt;X/.test(tc()));
      T('an archived player still shows by name',/>P4</.test(tc()));
      entryLeague(17);renderTournament();html=tc();
      T('entry phase: 16 in and a waiting list',/In \(16\/16\)/.test(html)&&/Waiting list/.test(html));
      tournaments=[{id:5,name:'Cup',date:'2026-07-04',tee_id:'57',status:'round_1',team_a_name:'Reds',team_b_name:'Blues'}];activeTournamentId=5;tournamentMatches=[];
      renderTournament();
      T('a tournament without format (before the migration) renders as team day',/Fourballs/.test(tc())&&/Reds/.test(tc()));
      today=()=>'2027-05-10';activeId=2;
    }
    // ── end ──
  }catch(e){out.push('FAIL EXCEPTION :: '+e.stack);}
  await new Promise(r=>setTimeout(r,150));
  const pre=document.createElement('pre');pre.id='RESULT';pre.textContent=out.join('\n');document.body.innerHTML='';document.body.appendChild(pre);
},400);
