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
    // A drawn league: players 1–16. Players 1 and 4 (the round-1 group-A pair behind mlRecords[0]) get
    // real, different indexes — 9.3 and 16.4 on tee 57 → playing handicaps 12 and 20 (Task 2) — so a
    // record's ph is checked against each player's own number, not the fourball zero-relative stroke
    // difference (which would give 0 either way). Everyone else stays level, index 18, nett = gross.
    // Groups G, 40 matches (ids 1–40), no scores.
    const league=()=>{tournaments=[{...LG}];activeTournamentId=900;TE.matchId=null;mlTab='groups';
      players=[...Array(16)].map((_,i)=>P(i+1,'P'+(i+1),i+1===1?9.3:i+1===4?16.4:18));players[0].is_admin=true;activeId=2;
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
      T('records: ph is each player\'s own playing handicap (12 v 20 on tee 57), not the stroke difference',mlRecords(tournaments[0])[0].ph.a===12&&mlRecords(tournaments[0])[0].ph.b===20);
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
    // ── Task 7: scoring through mlChange — the edit rules on real writes ──
    {
      // Players 1 and 4 are level with everyone here (index 18), so gross decides every hole as the
      // cards below intend (Task 6 gives them 9.3 and 16.4, which would hand out strokes).
      const level=()=>{for(const i of[0,3])players[i].hcp_history=[{date:'2026-01-01',value:18,note:''}];};
      const scoreHole=async(m,h,ga,gb)=>{await mlChange(m.id,{score:{hole:h,player_id:m.team_a_p1_id,gross:ga}});return mlChange(m.id,{score:{hole:h,player_id:m.team_b_p1_id,gross:gb}});};
      league();level();stub();
      gm().slice(0,23).forEach(m=>decideLocal(m,seedWin(m)));
      const last=gm()[23];activeId=last.team_a_p1_id;   // a league match is scored by its own players
      let res=await scoreHole(last,1,...W(seedWin(last)));
      const p1=calls.find(c=>c.method==='PATCH'&&c.url.includes(`tournament_matches?id=eq.${last.id}`));
      T('first score: match in progress, played today',res.ok&&p1&&p1.body.status==='in_progress'&&p1.body.played_on==='2027-05-10');
      T('a score is saved as a tournament_scores row',calls.some(c=>c.method==='POST'&&c.url.includes('tournament_scores')&&c.body.hole===1));
      for(let h=2;h<=10;h++)res=await scoreHole(last,h,...W(seedWin(last)));
      T('10 up with 8 to play: closed by itself, result saved',res.ok&&res.rec.label==='10&8'&&last.status==='complete'&&last.result==='a');
      T('group stage done: the 8 semis are filled (A1 v B1 first)',[1,2,3,4].every(b=>semi(b,1).team_a_p1_id!=null&&semi(b,2).team_b_p1_id!=null)&&semi(1,1).team_a_p1_id===1&&semi(1,1).team_b_p1_id===5);
      T('the finals wait',tournamentMatches.filter(m=>m.round===5).every(m=>m.team_a_p1_id==null));
      // refused: a playoff match has a score → a group correction writes nothing
      tournamentScores.push({id:1,match_id:semi(4,1).id,hole:1,player_id:semi(4,1).team_a_p1_id,gross:4});
      stub();activeId=1;
      const g0=gm()[0];
      res=await mlChange(g0.id,{score:{hole:1,player_id:g0.team_a_p1_id,gross:5}});
      T('group edit after a playoff match started: refused, naming it',!res.ok&&/Fourths semi-final 1/.test(res.msg));
      T('refused: nothing written, the old score kept',calls.length===0&&tournamentScores.find(s=>s.match_id===g0.id&&s.hole===1&&s.player_id===g0.team_a_p1_id).gross===3);
      // re-open: a 3&2 corrected to 2 up with 2 to play; semis filled, none started → all emptied
      league();level();stub();
      gm().forEach((m,i)=>{if(i){decideLocal(m,seedWin(m));return;}tournamentScores.push(...card(m,[...holes(1,3,...W(seedWin(m))),...holes(4,16,4,4)]));Object.assign(m,{status:'complete',result:seedWin(m),played_on:'2027-05-01'});});
      fillLocal();
      const Y=gm()[0];activeId=1;
      res=await mlChange(Y.id,{score:{hole:1,player_id:Y.team_a_p1_id,gross:5}});   // hole 1 now halved
      T('a correction re-opens a 3&2: in progress, no result',res.ok&&!res.rec.decided&&Y.status==='in_progress'&&Y.result===null);
      T('re-opened group match: all 8 semis emptied in place',tournamentMatches.filter(m=>m.stage==='semi').every(m=>m.team_a_p1_id==null&&m.team_b_p1_id==null)&&calls.filter(c=>c.method==='PATCH'&&c.body.team_a_p1_id===null).length===8);
      // a playoff 1UP corrected to level → sudden death; its final and 3rd/4th emptied, then refilled
      league();level();stub();gm().forEach(m=>decideLocal(m,seedWin(m)));fillLocal();
      const S=semi(1,1);tournamentScores.push(...card(S,[...holes(1,17,4,4),[18,3,4]]));Object.assign(S,{status:'complete',result:'a',played_on:'2027-08-01'});
      decideLocal(semi(1,2),'a');fillLocal();
      T('before: Winners final 1 v 9',fin(1).team_a_p1_id===1&&fin(1).team_b_p1_id===9);
      activeId=1;res=await mlChange(S.id,{score:{hole:18,player_id:S.team_a_p1_id,gross:4}});
      T('a semi corrected to level after 18 re-opens for sudden death',res.ok&&!res.rec.decided&&S.status==='in_progress'&&S.result===null&&/sudden death/.test(res.rec.label));
      T('its final and 3rd/4th are emptied',fin(1).team_a_p1_id==null&&fin(1,'place').team_a_p1_id==null);
      await scoreHole(S,19,4,4);res=await scoreHole(S,20,3,4);
      T('sudden death: won at the 20th; extra_holes 2 saved; final refilled',res.rec.label==='won at the 20th'&&S.status==='complete'&&S.result==='a'&&S.extra_holes===2&&fin(1).team_a_p1_id===1&&fin(1).team_b_p1_id===9);
      // an RLS-filtered update (200, []) is a failure
      league();level();reset((u,b,m)=>m==='POST'?[{id:++sid,...b}]:[]);activeId=2;
      const own=gm().find(m=>m.team_a_p1_id===2||m.team_b_p1_id===2);
      res=await mlChange(own.id,{score:{hole:1,player_id:2,gross:4}});
      T('an RLS-filtered update (0 rows) is reported, not silently accepted',!res.ok&&/Couldn't save/.test(res.msg)&&own.status==='pending');
      // Review Focus: admin mode cancelled while correcting a finished match
      league();level();gm().forEach(m=>decideLocal(m,seedWin(m)));stub();activeId=1;
      const keepRAM=requireAdminMode;window.requireAdminMode=async()=>false;
      res=await mlChange(gm()[0].id,{score:{hole:1,player_id:gm()[0].team_a_p1_id,gross:5}});
      T('admin mode cancelled: refused, nothing written',!res.ok&&calls.length===0);
      window.requireAdminMode=keepRAM;
      // Review Focus: the 30-second refresh replaces every match object while someone is scoring
      league();level();stub();activeId=2;const mine=gm().find(m=>m.team_a_p1_id===2||m.team_b_p1_id===2);
      teOpenMatch(mine.id);
      tournamentMatches=tournamentMatches.map(m=>({...m}));
      _teBuffer='4';await teEnter();
      T('after a refresh, scoring updates the live match object, not a stale copy',byId(mine.id).status==='in_progress'&&TE.match===byId(mine.id)&&TE.currentPlayerIdx===1);
      TE.matchId=null;
      // the scoring screen
      league();level();stub();activeId=1;const st10=semi(1,1);Object.assign(st10,{team_a_p1_id:1,team_b_p1_id:5,start_hole:10});
      teOpenMatch(st10.id);let html=tc();
      T('opens on the 10th for a match started there, without marking it started',TE.currentHole===10&&calls.length===0&&st10.status==='pending');
      T('scoring screen: player names, no team names, no Close match button',/P1/.test(html)&&/P5/.test(html)&&!/Team A/.test(html)&&!/teCloseMatchPrompt/.test(html));
      T('an unstarted league match offers the start hole',/teSetStart/.test(html));
      TE.matchId=null;tournamentScores.push(...card(st10,holes(1,18,4,4)));st10.status='in_progress';
      teOpenMatch(st10.id);html=tc();
      T('a level playoff opens on the 19th: sudden death, plays as hole 10',TE.currentHole===19&&/sudden death · plays as 10/.test(html)&&!/teSetStart/.test(html));
      T('navigation: back from the 19th goes to the 9th (last in play order)',teCanPrev()&&mlPrevHole(TE.match,19)===9);
      TE.matchId=null;
      league();players[0].hcp_history=[{date:'2026-01-01',value:2,note:''}];players[3].hcp_history=[{date:'2026-01-01',value:24,note:''}];stub();
      teOpenMatch(gm()[0].id);   // 1 v 4: 4 v 29 → 25 strokes
      T('diff over 18: the banner says every hole, two on SI 1–7',/every hole, two on SI 1–7/.test(tc()));
      TE.matchId=null;
      tournaments.push({id:901,name:'Cup',date:'2027-05-10',tee_id:'57',status:'round_2',team_a_name:'Reds',team_b_name:'Blues'});
      tournamentMatches.push({id:77,tournament_id:901,round:2,match_num:1,team_a_p1_id:1,team_b_p1_id:2,team_a_p2_id:null,team_b_p2_id:null,status:'pending',result:null,_teeId:'57'});
      stub();teOpenMatch(77);html=tc();
      T('team day untouched: opens on hole 1, marks in progress, team names, Close match',TE.currentHole===1&&calls.some(c=>c.method==='PATCH'&&c.body.status==='in_progress')&&/Reds/.test(html)&&/teCloseMatchPrompt/.test(html));
      TE.matchId=null;
      // self-heal: a decided group stage whose semi writes failed gets them filled (fill only)
      league();level();gm().forEach(m=>decideLocal(m,seedWin(m)));stub();activeId=5;
      await mlHealAll();
      T('heal: empty semis filled from the results',calls.filter(c=>c.method==='PATCH').length===8&&semi(1,1).team_a_p1_id===1);
      stub();await mlHealAll();T('heal again: nothing to do',calls.length===0);
      // ── strict: exactly which writes each edit makes, in order ──
      const seq=()=>calls.map(c=>c.method+' '+(c.url.match(/rest\/v1\/(\w+)/)||[])[1]).join(',');
      const idOf=c=>+(c.url.match(/id=eq\.(\d+)/)||[])[1];
      const PM='PATCH tournament_matches',SCORE='DELETE tournament_scores,POST tournament_scores';
      // a player's score closes a match early (3&2): score, then the match's cache, then the 8 semis
      league();level();stub();gm().slice(0,23).forEach(m=>decideLocal(m,seedWin(m)));
      const Z=gm()[23];activeId=Z.team_b_p1_id;
      for(let h=1;h<=3;h++)await scoreHole(Z,h,3,5);for(let h=4;h<=15;h++)await scoreHole(Z,h,4,4);
      await mlChange(Z.id,{score:{hole:16,player_id:Z.team_a_p1_id,gross:4}});
      T('holes before the decision fill no playoff slot',!calls.some(c=>c.method==='PATCH'&&idOf(c)!==Z.id));
      stub();res=await mlChange(Z.id,{score:{hole:16,player_id:Z.team_b_p1_id,gross:4}});
      T('3&2: the closing score writes the score, the match (complete, a), then the 8 semis — nothing else',res.ok&&res.rec.label==='3&2'
        &&seq()===[SCORE,...Array(9).fill(PM)].join()&&idOf(calls[2])===Z.id&&JSON.stringify(calls[2].body)==='{"status":"complete","result":"a"}'
        &&calls.slice(3).every(c=>byId(idOf(c)).stage==='semi'&&c.body.team_a_p1_id!=null));
      // item 3: the gate sees before/after differing only in the edited match
      {const keep=mlGate;let seen=null;window.mlGate=(b,a,id,g,s)=>{seen={b,a};return keep(b,a,id,g,s);};
       league();level();stub();activeId=2;const o=gm().find(m=>m.team_a_p1_id===2||m.team_b_p1_id===2);
       await mlChange(o.id,{score:{hole:1,player_id:2,gross:4}});window.mlGate=keep;
       T('the gate\'s "after" is "before" with only the edited match changed',!!seen&&seen.a.length===40
         &&seen.a.every((r,i)=>(JSON.stringify(r)===JSON.stringify(seen.b[i]))===(r.id!==o.id)));}
      // semi correction, final and 3rd/4th unstarted → exactly those two re-filled; started → refused, no writes
      league();level();gm().forEach(m=>decideLocal(m,seedWin(m)));fillLocal();
      const SF=semi(1,1);tournamentScores.push(...card(SF,[...holes(1,17,4,4),[18,3,4]]));Object.assign(SF,{status:'complete',result:'a',played_on:'2027-08-01'});
      decideLocal(semi(1,2),'a');fillLocal();stub();activeId=1;
      res=await mlChange(SF.id,{score:{hole:18,player_id:SF.team_a_p1_id,gross:5}});   // now B wins the 18th: 5 won 1UP
      T('semi correction: writes the score, the semi\'s result, then its final and 3rd/4th — in that order, nothing else',res.ok&&res.rec.winner==='b'
        &&seq()===[SCORE,PM,PM,PM].join()&&JSON.stringify(calls[2].body)==='{"result":"b"}'&&idOf(calls[3])===fin(1).id&&idOf(calls[4])===fin(1,'place').id);
      T('semi correction: Winners final now 5 v 9, 3rd/4th 1 v 13',fin(1).team_a_p1_id===5&&fin(1).team_b_p1_id===9&&fin(1,'place').team_a_p1_id===1&&fin(1,'place').team_b_p1_id===13);
      tournamentScores.push({id:2,match_id:fin(1).id,hole:1,player_id:5,gross:4});stub();
      res=await mlChange(SF.id,{score:{hole:18,player_id:SF.team_a_p1_id,gross:3}});
      T('semi correction once its final has started: refused naming it, no writes, slots kept',!res.ok&&/Winners final/.test(res.msg)&&calls.length===0&&fin(1).team_a_p1_id===5&&SF.result==='b');
      // final correction: places and champion only
      league();level();gm().forEach(m=>decideLocal(m,seedWin(m)));fillLocal();
      for(let b=1;b<=4;b++){decideLocal(semi(b,1),'a');decideLocal(semi(b,2),'a');}fillLocal();
      const F=fin(1);tournamentScores.push(...card(F,[...holes(1,17,4,4),[18,3,4]]));Object.assign(F,{status:'complete',result:'a',played_on:'2027-09-01'});
      for(let b=2;b<=4;b++)decideLocal(fin(b),'a');for(let b=1;b<=4;b++)decideLocal(fin(b,'place'),'a');
      const slotsNow=()=>JSON.stringify(tournamentMatches.map(m=>[m.team_a_p1_id,m.team_b_p1_id]));const sl0=slotsNow();
      T('before: champion 1',mlChampion(mlRecords(tournaments[0]))===1);
      stub();activeId=1;res=await mlChange(F.id,{score:{hole:18,player_id:F.team_a_p1_id,gross:5}});
      T('final correction: writes the score and the final\'s result only; no slot changes',res.ok&&seq()===[SCORE,PM].join()&&idOf(calls[2])===F.id&&slotsNow()===sl0,JSON.stringify(res)+seq()+JSON.stringify([F.team_a_p1_id,F.team_b_p1_id]));
      T('final correction: champion and places 1–2 follow',mlChampion(mlRecords(tournaments[0]))===9&&mlPlaces(mlRecords(tournaments[0])).slice(0,2).map(x=>x.pid).join()==='9,1');
      // sudden death from the 10th replays hole 10, 11 … at the same strokes (1 v 5: 12 v 22, 5 receives SI 1–10)
      const sdFrom=async start=>{league();stub();activeId=1;const s=semi(1,1);Object.assign(s,{team_a_p1_id:1,team_b_p1_id:5,start_hole:start,status:'in_progress',played_on:'2027-08-01'});
        tournamentScores.push(...card(s,HOLE_HCP.map((si,i)=>[i+1,4,4+strokesOnHole(10,i)])));   // every hole halved nett
        await scoreHole(s,19,4,5);return scoreHole(s,20,4,4);};
      res=await sdFrom(10);
      T('sudden death from the 10th: 19 = hole 10 (halved nett), 20 = hole 11 (SI 7, stroke): won by 5 at the 20th',res.ok&&res.rec.winner==='b'&&res.rec.label==='won at the 20th'&&semi(1,1).extra_holes===2&&semi(1,1).result==='b');
      res=await sdFrom(1);
      T('…from the 1st, 20 = hole 2 (SI 14, no stroke): still level, sudden death goes on',res.ok&&!res.rec.decided&&semi(1,1).status==='in_progress');
      // item 4: a player's correction that would overwrite or empty filled slots is refused whole
      league();level();gm().forEach(m=>decideLocal(m,seedWin(m)));fillLocal();
      const P2=gm().find(m=>m.team_a_p1_id===2||m.team_b_p1_id===2);P2.status='in_progress';   // its "complete" write had failed: stored in progress, derived 10&8
      const P2w=seedWin(P2)==='a'?P2.team_a_p1_id:P2.team_b_p1_id;
      stub();activeId=2;res=await mlChange(P2.id,{score:{hole:1,player_id:P2w,gross:9}});   // now 8 up with 8 to play: undecided
      T('a player\'s change that would empty filled playoff slots: refused up front, nothing written, told why',!res.ok&&calls.length===0
        &&/Only an admin/.test(res.msg)&&/semi-final/.test(res.msg)&&/Nothing was saved/.test(res.msg)&&semi(1,1).team_a_p1_id===1
        &&tournamentScores.find(s=>s.match_id===P2.id&&s.hole===1&&s.player_id===P2w).gross===3);
      activeId=1;res=await mlChange(P2.id,{score:{hole:1,player_id:P2w,gross:9}});
      T('…an admin can: the same change empties the 8 semis',res.ok&&tournamentMatches.filter(m=>m.stage==='semi').every(m=>m.team_a_p1_id==null));
      // item 5: one slot write fails part-way → the rest still written, that slot keeps its old players, flagged, healed
      league();level();gm().slice(0,23).forEach(m=>decideLocal(m,seedWin(m)));
      const L=gm()[23];activeId=L.team_a_p1_id;stub();for(let h=1;h<=9;h++)await scoreHole(L,h,3,5);
      const bad=semi(2,1).id;
      reset((u,b,m)=>m==='POST'?[{id:++sid,...b}]:m==='PATCH'&&idOf({url:u})!==bad?[{...b}]:[]);
      res=await scoreHole(L,10,3,5);
      T('a slot write that fails: the result is saved and the player told which slot',res.ok&&L.status==='complete'&&/playoff draw couldn't be updated for Runners-up semi-final 1/.test(res.warn||''));
      T('…that slot keeps its old (empty) players; the other 7 are written',semi(2,1).team_a_p1_id==null&&tournamentMatches.filter(m=>m.stage==='semi'&&m.team_a_p1_id!=null).length===7);
      renderTournament();
      T('…the league page flags it, with Repair (a fill: any member)',/out of step with the results: Runners-up semi-final 1/.test(tc())&&/mlHealAll\(true\)/.test(tc()));
      stub();activeId=5;await mlHealAll();
      T('…and the heal fills just that slot',seq()===PM&&idOf(calls[0])===bad&&semi(2,1).team_a_p1_id===2&&semi(2,1).team_b_p1_id===6);
      renderTournament();T('…then the flag is gone',!/out of step/.test(tc()));
      // item 5: a filled slot with the wrong players (unstarted) — a player's heal leaves it and flags it; an admin's repairs it
      league();level();gm().forEach(m=>decideLocal(m,seedWin(m)));fillLocal();Object.assign(semi(1,1),{team_a_p1_id:5,team_b_p1_id:1});
      stub();activeId=5;await mlHealAll();renderTournament();
      T('wrong players in a filled slot: a player\'s heal writes nothing; the page says an admin must repair it',calls.length===0&&/Winners semi-final 1/.test(tc())&&/An admin needs to repair it/.test(tc()));
      activeId=1;await mlHealAll();
      T('…an admin\'s heal repairs it in place',seq()===PM&&idOf(calls[0])===semi(1,1).id&&semi(1,1).team_a_p1_id===1&&semi(1,1).team_b_p1_id===5);
      tournamentScores.push({id:3,match_id:semi(2,1).id,hole:1,player_id:2,gross:4});Object.assign(semi(2,1),{team_a_p1_id:6,team_b_p1_id:2});stub();await mlHealAll();
      T('…a started match is never touched by the heal',calls.length===0&&semi(2,1).team_a_p1_id===6);
      // item 7: [] from the score insert is a failure; someone else's match is refused with no writes
      league();level();reset(()=>[]);activeId=2;const o7=gm().find(m=>m.team_a_p1_id===2||m.team_b_p1_id===2);
      res=await mlChange(o7.id,{score:{hole:1,player_id:2,gross:4}});
      T('an RLS-filtered score insert ([]) is reported, the match not touched',!res.ok&&/Couldn't save/.test(res.msg)&&!calls.some(c=>c.method==='PATCH')&&!tournamentScores.some(s=>s.match_id===o7.id));
      stub();const other=gm()[23];res=await mlChange(other.id,{score:{hole:1,player_id:other.team_a_p1_id,gross:4}});
      T('a non-admin scoring someone else\'s match: refused, nothing written',!res.ok&&calls.length===0&&/Only an admin/.test(res.msg));
      // item 1: strokes on the scoring screen for diff > 18, and a league round-1 match is singles
      league();players[0].hcp_history=[{date:'2026-01-01',value:2,note:''}];players[3].hcp_history=[{date:'2026-01-01',value:24,note:''}];stub();activeId=1;
      teOpenMatch(gm()[0].id);html=tc();
      T('diff 25 on hole 1 (SI 4): two strokes shown; singles, not a fourball',/\+2 strokes/.test(html)&&!/Fourball HCP/.test(html));
      TE.currentHole=2;renderMatchScoring();T('…hole 2 (SI 14): one stroke',/\+stroke/.test(tc())&&!/\+2 strokes/.test(tc()));
      TE.matchId=null;
      // item 6: the start hole after a refresh goes to the live match object too
      league();level();stub();activeId=1;const s6=semi(1,1);Object.assign(s6,{team_a_p1_id:1,team_b_p1_id:5});
      teOpenMatch(s6.id);tournamentMatches=tournamentMatches.map(m=>({...m}));await teSetStart(10);
      T('after a refresh, the start hole is set on the live match object',byId(s6.id).start_hole===10&&TE.match===byId(s6.id)&&TE.currentHole===10&&seq()===PM);
      TE.matchId=null;
      // scoring screen names are escaped
      league();level();players[1].name='<i>Z</i>';stub();teOpenMatch(gm().find(m=>m.team_a_p1_id===2||m.team_b_p1_id===2).id);
      T('scoring screen: player names are escaped',!document.getElementById('tournamentContent').querySelector('i')&&/&lt;i&gt;Z/.test(tc()));
      TE.matchId=null;
      // ── fix round 1 ──
      // 1 / 3c: a signed-in admin NOT in admin mode heals at start-up; a fill refused (42501) is skipped and flagged, never prompted
      {league();level();gm().forEach(m=>decideLocal(m,seedWin(m)));
       players[0].user_id='u-1';_session={user:{id:'u-1'},access_token:'x.'+btoa(JSON.stringify({aal:'aal1'}))+'.y'};
       const keep=requireAdminMode;let prompts=0;window.requireAdminMode=async()=>{prompts++;return true;};
       reset((u,b,m)=>m==='PATCH'?{__status:403,code:'42501',message:'Only an admin in admin mode can change who plays in a match.'}:[]);
       await mlHealAll();window.requireAdminMode=keep;
       T('heal, signed-in admin without admin mode, fills refused 42501: no prompt, each slot tried once and skipped',prompts===0&&calls.filter(c=>c.method==='PATCH').length===8&&tournamentMatches.filter(m=>m.stage==='semi').every(m=>m.team_a_p1_id==null));
       _session=null;renderTournament();
       T('…the skipped slots stay flagged on the league page',/out of step with the results: Winners semi-final 1/.test(tc()));}
      // 2: a correction that decides the match mid-card ends the card
      {league();level();stub();activeId=2;const m2=gm().find(m=>m.team_a_p1_id===2||m.team_b_p1_id===2);
       tournamentScores.push(...card(m2,[...holes(1,9,3,5),[10,5,3]]));Object.assign(m2,{status:'in_progress',played_on:'2027-05-01'});   // 8 up thru 10: undecided
       teOpenMatch(m2.id);const opened=TE.currentHole===11;
       TE.currentHole=10;TE.currentPlayerIdx=1;_teBuffer='6';
       const keepT=window.toast;let msg='';window.toast=s=>{msg=s;};await teEnter();window.toast=keepT;
       T('a correction that decides the match mid-card: "Match over — 10&8" and the card closes',opened&&msg==='Match over — 10&8'&&TE.matchId==null&&m2.status==='complete');}
      // 3a: a group match all square after 18 → complete, halved (exact body)
      {league();level();stub();activeId=2;const m3=gm().find(m=>m.team_a_p1_id===2||m.team_b_p1_id===2);
       tournamentScores.push(...card(m3,holes(1,17,4,4)),{match_id:m3.id,hole:18,player_id:m3.team_a_p1_id,gross:4});Object.assign(m3,{status:'in_progress',played_on:'2027-05-01'});
       res=await mlChange(m3.id,{score:{hole:18,player_id:m3.team_b_p1_id,gross:4}});
       T('group match all square after 18: writes the score then {"status":"complete","result":"half"}, nothing else',res.ok&&res.rec.label==='Halved'&&seq()===[SCORE,PM].join()&&JSON.stringify(calls[2].body)==='{"status":"complete","result":"half"}');}
      // 3b: a player correcting their own finished match is refused, nothing written
      {league();level();gm().forEach(m=>decideLocal(m,seedWin(m)));stub();activeId=2;const m4=gm().find(m=>m.team_a_p1_id===2||m.team_b_p1_id===2);
       res=await mlChange(m4.id,{score:{hole:1,player_id:2,gross:6}});
       T('a player correcting their own finished match: refused, zero writes, told an admin is needed',!res.ok&&calls.length===0&&/admin/.test(res.msg));}
      // 4: the score saved but the match cache update failed → said accurately
      {league();level();reset((u,b,m)=>m==='POST'?[{id:++sid,...b}]:[]);activeId=2;const m5=gm().find(m=>m.team_a_p1_id===2||m.team_b_p1_id===2);
       res=await mlChange(m5.id,{score:{hole:1,player_id:2,gross:4}});
       T('score saved, match status not: the message says exactly that',!res.ok&&res.saved&&/^Score saved/.test(res.msg)&&/match status/.test(res.msg)&&/correct itself on the next change/.test(res.msg)&&tournamentScores.some(s=>s.match_id===m5.id));}
      activeId=2;
    }
    // ── Task 8: entries — the shared entry box and admin panel ──
    const adm=()=>document.getElementById('adminTournamentBody').innerHTML;
    {
      entryLeague(17);activeId=17;renderTournament();
      T('17 entries: 16 in, #17 waiting',mlEntries(tournaments[0]).in.length===16&&mlEntries(tournaments[0]).waiting[0].player_id===17);
      T('member box: entered, #1 on the waiting list, pay link, withdraw',/#1 on the waiting list/.test(tc())&&tc().includes(MOBILEPAY_URL)&&/mlWithdraw\(900\)/.test(tc()));
      activeId=18;renderTournament();
      T('not entered: Enter, with the buy-in',/Enter Matchplay 2027/.test(tc())&&/DKK 200/.test(tc())&&/mlJoin\(900\)/.test(tc()));
      reset((u,b,m)=>m==='POST'&&u.includes('tournament_players')?[{id:400,entered_at:'2027-03-02T10:00:00Z',paid_at:null,amount:null,group_num:null,seed_pot:null,...b}]:[]);
      await mlJoin(900);
      const post=calls.find(c=>c.method==='POST');
      T('Enter posts own player and team league only',post&&post.body.player_id===18&&post.body.team==='league'&&post.body.tournament_id===900&&!('entered_at' in post.body)&&!('paid_at' in post.body));
      T('…and lands at #2 on the waiting list',/#2 on the waiting list/.test(tc()));
      activeId=3;reset((u,b,m)=>m==='DELETE'?[{id:303}]:[]);await mlWithdraw(900);
      T('a withdrawal moves the first waiting player in (derived; nothing else written)',mlEntries(tournaments[0]).in.some(e=>e.player_id===17)&&calls.filter(c=>c.method!=='DELETE').length===0);
      activeId=4;reset(()=>[]);await mlWithdraw(900);
      T('an RLS-filtered withdraw (0 rows) keeps the entry',mlEntryRows(tournaments[0]).some(e=>e.player_id===4));
      entryLeague(3);tournaments[0].buy_in=0;activeId=2;renderTournament();
      T('free league: entered, no pay link',/entered in Matchplay 2027\./.test(tc())&&!tc().includes(MOBILEPAY_URL));
      league();activeId=2;renderTournament();
      T('after the draw: no Withdraw, payment status still shown',!/mlWithdraw/.test(tc())&&/payment not yet recorded/.test(tc()));
      // admin panel — the same view as season entries
      entryLeague(17);activeId=1;renderAdminTournament();
      T('league admin: the shared entries panel, with a waiting list',/17 entered · 0 paid · DKK 0 received · 1 waiting/.test(adm())&&/Waiting list/.test(adm())&&/mlMoveIn\(317\)/.test(adm()));
      T('enter-for lists members not yet entered',/id="mlEntryFor"/.test(adm())&&/value="18"/.test(adm())&&!/value="17"/.test(adm()));
      reset((u,b,m)=>m==='PATCH'?[{...tournamentPlayers.find(e=>e.id===+u.match(/id=eq\.(\d+)/)[1]),...b}]:[]);
      await mlMoveIn(317);
      const mv=calls.find(c=>c.method==='PATCH'),at=pid=>Date.parse(tournamentPlayers.find(e=>e.player_id===pid).entered_at);
      T('Move in: one write, just ahead of the last player in',mv&&Date.parse(mv.body.entered_at)<at(16)&&Date.parse(mv.body.entered_at)>at(15));
      T('…17 is in, 16 tops the waiting list',mlEntries(tournaments[0]).in.some(e=>e.player_id===17)&&mlEntries(tournaments[0]).waiting[0].player_id===16);
      await mlMarkPaid(301);
      const mp=calls.filter(c=>c.method==='PATCH').pop();
      T('Mark paid: the league buy-in and who recorded it',mp.body.amount===200&&mp.body.recorded_by===1&&!!mp.body.paid_at&&!!tournamentPlayers.find(e=>e.id===301).paid_at);
      reset(()=>[]);await mlUndoPaid(301);
      T('an RLS-filtered undo (0 rows) leaves the payment',!!tournamentPlayers.find(e=>e.id===301).paid_at);
      reset((u,b,m)=>m==='POST'?[{id:500,entered_at:'2027-03-03T00:00:00Z',paid_at:null,amount:null,...b}]:[]);
      document.getElementById('mlEntryFor').value='18';await mlEnterFor();
      T('Enter player posts that player for the league',calls.some(c=>c.method==='POST'&&c.body.player_id===18&&c.body.tournament_id===900&&c.body.team==='league'));
      league();activeId=1;renderAdminTournament();
      T('after the draw: payments only — no Remove, Move in or Enter player',/16 entered/.test(adm())&&!/mlRemoveEntry|mlMoveIn|mlEntryFor/.test(adm()));
      activeId=2;
    }
    // ── Task 9: admin — create, draw, deadlines, outcomes ──
    const setV=(id,v)=>{document.getElementById(id).value=v;};
    {
      tournaments=[];tournamentPlayers=[];tournamentMatches=[];tournamentScores=[];activeTournamentId=null;TE.matchId=null;
      players=[...Array(20)].map((_,i)=>P(i+1,'P'+(i+1)));players[0].is_admin=true;activeId=1;
      renderAdminTournament();
      T('admin: the New matchplay league form, tee 57 by default',!!document.getElementById('mlNewName')&&document.getElementById('mlNewTee').value==='57');
      setV('mlNewName','Matchplay 2027');setV('mlNewDate','2027-04-01');setV('mlNewBuyIn','200');
      ['2027-05-15','2027-06-15','2027-07-31','2027-08-20','2027-09-10'].forEach((d,i)=>setV('mlDl_'+ML_ROUND_KEYS[i],d));
      setV('mlDl_semi','');reset(()=>[]);await mlCreate();
      T('create refuses a missing deadline',calls.length===0);
      setV('mlDl_semi','2027-07-01');await mlCreate();
      T('create refuses deadlines out of order',calls.length===0);
      setV('mlDl_semi','2027-08-20');
      reset((u,b,m)=>m==='POST'&&u.includes('/tournaments?')?[{id:900,created_at:'x',...b}]:[]);
      await mlCreate();
      const cp=calls.find(c=>c.method==='POST');
      T('create posts a league: format, entry, tee 57, buy-in, five deadlines',cp&&cp.body.format==='league'&&cp.body.status==='entry'&&cp.body.tee_id==='57'&&cp.body.buy_in===200&&Object.keys(cp.body.deadlines).join()===ML_ROUND_KEYS.join()&&tournaments[0].id===900);
      // draw
      entryLeague(16);activeId=1;
      [5,30,12,1,22,8,17,3,26,14,9,20,2,28,11,6].forEach((v,i)=>players[i].hcp_history=[{date:'2026-01-01',value:v,note:''}]);
      players[15].hcp_history=[];   // Review Focus: no handicap at all
      const drawStub=()=>reset((u,b,m)=>m==='PATCH'&&u.includes('tournament_players')?[{...tournamentPlayers.find(e=>e.id===+u.match(/id=eq\.(\d+)/)[1]),...b}]
        :m==='POST'&&u.includes('tournament_matches')?b.map((r,i)=>({id:i+1,...r})):m==='PATCH'?[{...tournaments[0],...b}]:[]);
      drawStub();await mlDraw(900);
      const pp=calls.filter(c=>c.method==='PATCH'&&c.url.includes('tournament_players'));
      T('draw: 16 players each get a group and a pot',pp.length===16&&new Set(pp.map(c=>c.body.group_num+'-'+c.body.seed_pot)).size===16);
      const potOf2=pid=>tournamentPlayers.find(e=>e.player_id===pid).seed_pot;
      T('draw: pot 1 is the four lowest indexes',[4,13,8,1].every(pid=>potOf2(pid)===1));
      T('draw: a player with no handicap lands in the last pot',potOf2(16)===4);
      const mp2=calls.find(c=>c.method==='POST'&&c.url.includes('tournament_matches'));
      T('draw: one request creates all 40 matches for this league',mp2&&mp2.body.length===40&&mp2.body.every(r=>r.tournament_id===900&&r.status==='pending'));
      T('draw: the league is marked drawn',tournaments[0].status==='drawn'&&calls.some(c=>c.method==='PATCH'&&c.url.includes('/tournaments?')&&c.body.status==='drawn'));
      const placed=JSON.stringify(tournamentPlayers.map(e=>[e.player_id,e.group_num,e.seed_pot]));
      tournaments[0].status='entry';tournamentMatches=[];drawStub();await mlDraw(900);
      T('re-pressing Draw after a partial failure keeps the groups',calls.filter(c=>c.url.includes('tournament_players')).length===0&&JSON.stringify(tournamentPlayers.map(e=>[e.player_id,e.group_num,e.seed_pot]))===placed&&tournamentMatches.length===40);
      entryLeague(15);reset(()=>[]);await mlDraw(900);
      T('the draw needs exactly 16 in',calls.length===0);
      renderAdminTournament();
      T('before the draw: Draw groups disabled until 16 are in',/Draw groups \(15\/16 in\)/.test(adm())&&document.querySelector('#adminTournamentBody button[onclick^="mlDraw"]').disabled);
      // deadlines
      league();activeId=1;renderAdminTournament();
      T('admin panel after the draw: outcome tool listing the matches, dates editor',!!document.getElementById('mlOutMatch')&&document.getElementById('mlOutMatch').options.length===24&&!!document.getElementById('mlEd_group_1'));
      setV('mlEd_final','2027-09-30');reset((u,b,m)=>m==='PATCH'?[{...tournaments[0],...b}]:[]);
      await mlSaveDeadlines(900);
      T('move a deadline: saved',tournaments[0].deadlines.final==='2027-09-30'&&calls.some(c=>c.body&&c.body.deadlines&&c.body.deadlines.final==='2027-09-30'));
      setV('mlEd_semi','2027-10-01');reset(()=>[]);await mlSaveDeadlines(900);
      T('deadlines out of order are refused',calls.length===0);
      // outcomes
      league();activeId=1;stub();
      const gA=gm()[0];
      await mlSetOutcome(gA.id,'walkover');
      T('a walkover needs a winner: nothing written',calls.length===0);
      await mlSetOutcome(gA.id,'walkover','b');
      const op=calls.find(c=>c.method==='PATCH'&&c.url.includes(`id=eq.${gA.id}`));
      T('group walkover: outcome, winner, who decided, closed',op&&op.body.outcome==='walkover'&&op.body.result==='b'&&op.body.decided_by===1&&op.body.status==='complete');
      const tblA=()=>mlStandings(G[0],mlRecords(tournaments[0]).filter(r=>r.stage==='group'&&mlGroupOf(r)===1),mlGroups(tournaments[0]).seeds);
      T('…counts in the table: 1 point to the walkover winner, no holes',tblA().find(s=>s.pid===gA.team_b_p1_id).pts===1&&tblA().find(s=>s.pid===gA.team_b_p1_id).holes===0);
      stub();await mlSetOutcome(gA.id,'played');
      T('clearing an outcome re-derives from the scores (none: back to pending)',gA.outcome==='played'&&gA.status==='pending'&&gA.result===null&&gA.decided_by===null);
      const sA=semi(1,1);Object.assign(sA,{team_a_p1_id:1,team_b_p1_id:5});stub();
      await mlSetOutcome(sA.id,'halve_decision');
      T('halve by decision refused in the playoffs',calls.length===0);
      await mlSetOutcome(sA.id,'double_forfeit');
      T('a playoff double forfeit must name who goes through',calls.length===0);
      // outcomes are edits: refused once a playoff started; otherwise the brackets rebuild
      league();gm().forEach(m=>decideLocal(m,seedWin(m)));fillLocal();activeId=1;
      tournamentScores.push({id:2,match_id:semi(2,1).id,hole:1,player_id:semi(2,1).team_a_p1_id,gross:4});stub();window.__alert=null;
      await mlSetOutcome(gm()[5].id,'double_forfeit');
      T('an outcome on a group match once a playoff started: refused, blocker named, nothing written',calls.length===0&&/Runners-up semi-final 1/.test(window.__alert||''));
      tournamentScores=tournamentScores.filter(s=>s.id!==2);stub();
      await mlSetOutcome(gm()[4].id,'walkover','b');   // group A: 1 v 2 → walkover to 2
      T('an outcome with no playoff started rebuilds the semis from the new table',semi(1,1).team_a_p1_id===2&&semi(2,1).team_a_p1_id===1);
      decideLocal(semi(1,2),'a');stub();
      await mlSetOutcome(semi(1,1).id,'double_forfeit','b');
      T('playoff double forfeit: the named player goes through to the final',fin(1).team_a_p1_id===5&&fin(1).team_b_p1_id===9&&fin(1,'place').team_a_p1_id===2);
      T('audit log names the league actions',AUDIT_LABELS.match_outcome==='Match outcome recorded'&&AUDIT_LABELS.league_entered==='Entered matchplay league');
      activeId=2;
    }
    // ── end ──
  }catch(e){out.push('FAIL EXCEPTION :: '+e.stack);}
  await new Promise(r=>setTimeout(r,150));
  const pre=document.createElement('pre');pre.id='RESULT';pre.textContent=out.join('\n');document.body.innerHTML='';document.body.appendChild(pre);
},400);
