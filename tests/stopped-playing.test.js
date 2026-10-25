// "A player stopped playing…" in Log Round: the rest of their card is marked not played.
// Run: tests/run.ps1 -Test tests/stopped-playing.test.js
setTimeout(async function(){
  const out=[];const T=(n,c,d='')=>out.push((c?'PASS ':'FAIL ')+n+(c?'':' :: '+d));
  const alerts=[],toasts=[],patches=[];let dbRows={};   // round id -> what the database holds
  window.toast=m=>toasts.push(m);window.setLoading=()=>{};window.confirm=()=>true;window.alert=m=>alerts.push(m);
  const clone=x=>JSON.parse(JSON.stringify(x));let getDelay=0;   // getDelay: a slow read, for the race test
  window.sbUpdate=async(t,id,b)=>{patches.push({t,id,b});dbRows[id]=clone(b);return[b];};
  window.sbGet=async(t,q)=>{const id=+(/^id=eq\.(\d+)/.exec(q)||[])[1],row=dbRows[id]&&clone(dbRows[id]);if(getDelay)await new Promise(r=>setTimeout(r,getDelay));return row?[row]:[];};
  window.sbDelete=async(t,id)=>[{id}];window.startWeatherRefresh=()=>{};
  const P=(id,name)=>({id,name,color:id,hcp_history:[{date:'2026-01-01',value:18,note:''}],approved:true,is_social:false});
  const tick=()=>new Promise(r=>setTimeout(r,20));
  const card=()=>document.getElementById('holeEntryCard'),body=()=>document.getElementById('stopModalBody');
  const btn=(root,re)=>[...root.querySelectorAll('button')].find(b=>re.test(b.textContent.trim()));
  const lastPatch=id=>[...patches].reverse().find(x=>x.id===id)?.b;
  const holes=(scores,pu,st)=>scores.map((s,i)=>({hole:i+1,score:pu[i]?null:s,par:HOLE_PARS[i],hcp:HOLE_HCP[i],...(pu[i]?{pickup:true}:{}),...(st&&st[i]?{stopped:true}:{})}));
  tees=[..._TEES_SEED];
  // Ann and Cy have played 12 holes in play order, Bo `boPlayed` (one of them a pickup); on the 13th hole of play.
  const setup=(startHole=1,boPlayed=12)=>{
    players=[P(1,'Ann Ash'),P(2,'Bo Berg'),P(3,'Cy Cole')];activeId=1;
    const order=heOrderedHoles(startHole),sc=n=>{const s=new Set(order.slice(0,n));return Array.from({length:18},(_,i)=>s.has(i+1)?4:null);};
    const tee=getTee('platinum');
    HE={playerList:players.map(p=>({p,phcp:18,tee,teeId:'platinum'})),
      scores:{1:sc(12),2:sc(boPlayed),3:sc(12)},pickups:{1:Array(18).fill(false),2:Array(18).fill(false),3:Array(18).fill(false)},stopped:{},
      roundIds:{1:101,2:102,3:103},currentHole:order[12],currentPidx:0,startHole,date:today(),notes:''};
    HE.scores[2][order[1]-1]=null;HE.pickups[2][order[1]-1]=true;   // Bo picked up their 2nd hole
    allRounds=[101,102,103].map((id,k)=>({id,player_id:k+1,date:today(),tee_id:'platinum',holes:holes(HE.scores[k+1],HE.pickups[k+1])}));
    groupPlayerIds=[1,2,3];patches.length=0;alerts.length=0;dbRows={};_heKeypadBuffer='';
    closeModal('stopModal');heRender();
  };
  const stopBo=async()=>{btn(card(),/stopped playing/).click();btn(body(),/^Bo$/).click();btn(body(),/^Yes, Bo stopped$/).click();await tick();};
  try{
    // ── The entry point ──
    setup();
    const link=btn(card(),/^A player stopped playing…$/),pad=document.getElementById('heKeypad');
    T('the link is on the card',!!link);
    for(let e=card();e;e=e.parentElement)if(getComputedStyle(e).display==='none')e.style.display='block';   // lay it out to measure
    const gap=link.getBoundingClientRect().top-pad.getBoundingClientRect().bottom;
    T('and well clear of the keypad, below a divider',!pad.contains(link)&&!link.closest('#heActions')&&gap>=40&&getComputedStyle(link.parentElement).borderTopStyle==='solid',gap);
    link.click();
    T('tapping it opens the picker',document.getElementById('stopModal').style.display==='flex');
    const names=[...body().querySelectorAll('button')].map(b=>b.textContent.trim());
    T('it lists the group by first name',['Ann','Bo','Cy'].every(n=>names.includes(n)),names.join('|'));
    T('with nobody pre-selected',!/stopped after hole/.test(body().textContent)&&!body().querySelector('.selected,[aria-pressed="true"]'));

    // ── Confirmation copy, Cancel ──
    btn(body(),/^Bo$/).click();
    const copy=body().textContent.replace(/\s+/g,' ');
    T('the confirmation names the player, the hole and the holes marked',copy.includes('Bo stopped after hole 12? Holes 13–18 will be marked not played. They keep their 12 holes.'),copy);
    T('no gendered pronoun',!/\b(he|his|him)\b/i.test(copy));
    T('the buttons name the player',!!btn(body(),/^Yes, Bo stopped$/)&&!!btn(body(),/^Cancel$/));
    btn(body(),/^Cancel$/).click();await tick();
    T('Cancel closes it and changes nothing',document.getElementById('stopModal').style.display==='none'&&!(HE.stopped[2]||[]).some(Boolean)&&!patches.length);

    // ── Stopping Bo after 12 ──
    const before=JSON.stringify([HE.scores[2],HE.pickups[2]]);
    await stopBo();
    T('holes 13–18 are stopped, 1–12 are not',HE.stopped[2].map((s,i)=>s===(i>=12)).every(Boolean),JSON.stringify(HE.stopped[2]));
    T("Bo's scores and pickup are untouched",JSON.stringify([HE.scores[2],HE.pickups[2]])===before);
    const pb=lastPatch(102);
    T('the PATCH carries the flags',!!pb&&pb.holes.slice(12).every(h=>h.stopped===true&&h.score===null&&!h.pickup)&&pb.holes.slice(0,12).every(h=>!h.stopped),JSON.stringify(pb&&pb.holes));
    T('and keeps the pickup',!!pb&&pb.holes[1].pickup===true);
    T('Bo\'s row says "Stopped after 12 · Undo"',/Stopped after 12\s*·\s*Undo/.test(card().textContent));
    btn(card(),/stopped playing/).click();
    T('the picker no longer lists Bo',!btn(body(),/^Bo$/)&&!!btn(body(),/^Ann$/));
    closeModal('stopModal');

    // ── The hole flow skips him ──
    HE.currentHole=13;HE.currentPidx=0;heRender();
    heKeypadDigit(4);heKeypadEnter();await tick();
    T('Enter after Ann goes to Cy, not Bo',HE.currentHole===13&&HE.currentPidx===2,`${HE.currentHole}/${HE.currentPidx}`);
    heKeypadDigit(5);heKeypadEnter();await tick();
    T('Cy completes the hole: on to 14, Ann first',HE.currentHole===14&&HE.currentPidx===0,`${HE.currentHole}/${HE.currentPidx}`);
    T('hole 13 shows as complete',/var\(--gold\)/.test(card().querySelector('[onclick="heJump(13)"]').getAttribute('style')));
    HE.currentHole=16;HE.currentPidx=1;heRender();
    T('landing on Bo on a stopped hole moves on to Cy',HE.currentPidx===2);
    HE.currentHole=12;HE.currentPidx=1;heRender();
    T('on a hole Bo played, Bo still gets a turn',HE.currentPidx===1);

    // ── Save ──
    await saveGroupRound();
    T('Save succeeds with Bo on 12 played',!alerts.length&&patches.some(x=>x.id===102),alerts.join(' | '));
    setup(1,8);await stopBo();alerts.length=0;patches.length=0;
    await saveGroupRound();
    T('Save still blocks a player stopped after 8',alerts.some(m=>/at least 9 holes for Bo/.test(m))&&!patches.length,alerts.join(' | '));

    // ── Undo ──
    setup();await stopBo();
    dbRows={102:{holes:lastPatch(102).holes}};   // the database still holds the flags
    btn(card(),/^Undo$/).click();await tick();
    T('Undo clears the flags',!HE.stopped[2].some(Boolean));
    T("and keeps Bo's scores",JSON.stringify([HE.scores[2],HE.pickups[2]])===before);
    T('the Undo PATCH carries no flags',!lastPatch(102).holes.some(h=>h.stopped),JSON.stringify(lastPatch(102).holes));
    T("Bo's row no longer says stopped",!/Stopped after/.test(card().textContent));
    HE.currentHole=13;HE.currentPidx=0;heRender();heKeypadDigit(4);heKeypadEnter();await tick();
    T('Bo is back in the flow',HE.currentPidx===1);

    // ── Start on the 10th: play order ──
    setup(10,12);btn(card(),/stopped playing/).click();btn(body(),/^Bo$/).click();
    const copy10=body().textContent.replace(/\s+/g,' ');
    T('start 10: after hole 3, holes 4–9 marked',copy10.includes('Bo stopped after hole 3? Holes 4–9 will be marked not played. They keep their 12 holes.'),copy10);
    btn(body(),/^Yes, Bo stopped$/).click();await tick();
    T('start 10: holes 4–9 carry the flag, nothing else',HE.stopped[2].map((s,i)=>s===(i>=3&&i<=8)).every(Boolean),JSON.stringify(HE.stopped[2]));
    T('start 10: the row says "Stopped after 3"',/Stopped after 3\b/.test(card().textContent));

    // ── A second phone merges the other's flags ──
    setup();const other=holes(HE.scores[2],HE.pickups[2],Array.from({length:18},(_,i)=>i>=12));
    dbRows={102:{holes:other}};await hePatchRound(2);
    T('a merge keeps the other phone\'s stopped flags',lastPatch(102).holes.slice(12).every(h=>h.stopped)&&HE.stopped[2].slice(12).every(Boolean));
    // The other phone then undoes (the database loses the flags): this phone's next PATCH must not put them back
    dbRows[102]={holes:holes(HE.scores[2],HE.pickups[2])};await hePatchRound(2);
    T('after the other phone\'s Undo, the next PATCH here leaves them cleared',!lastPatch(102).holes.some(h=>h.stopped)&&!HE.stopped[2].some(Boolean),JSON.stringify(lastPatch(102).holes));
    // A stop made while a hole PATCH is still reading the database
    setup();dbRows={102:{holes:holes(HE.scores[2],HE.pickups[2])}};getDelay=60;
    const inFlight=hePatchRound(2);await tick();getDelay=0;
    await stopBo();await inFlight;await new Promise(r=>setTimeout(r,100));
    T('a stop made during an in-flight PATCH sticks',dbRows[102].holes.slice(12).every(h=>h.stopped)&&HE.stopped[2].slice(12).every(Boolean)&&!HE.stopDirty[2],JSON.stringify(dbRows[102].holes.map(h=>!!h.stopped)));

    // ── Two players with the same first name ──
    setup();players.push(P(4,'Bo Dahl'));HE.playerList.push({p:players[3],phcp:18,tee:getTee('platinum'),teeId:'platinum'});
    HE.scores[4]=[...HE.scores[2]];HE.pickups[4]=Array(18).fill(false);HE.roundIds[4]=104;allRounds.push({id:104,player_id:4,date:today(),holes:[]});heRender();
    btn(card(),/stopped playing/).click();const nm=[...body().querySelectorAll('button')].map(b=>b.textContent.trim());
    T('two Bos are told apart by full name',nm.includes('Bo Berg')&&nm.includes('Bo Dahl')&&nm.includes('Ann'),nm.join('|'));
    btn(body(),/^Bo Dahl$/).click();
    T('and the confirmation names the right one',/^Bo Dahl stopped after hole 12\?/.test(body().textContent.trim())&&!!btn(body(),/^Yes, Bo Dahl stopped$/),body().textContent);
    closeModal('stopModal');

    // ── Finished for progress, not played for points ──
    setup();await stopBo();
    const bo=allRounds.find(r=>r.id===102);bo.holes=lastPatch(102).holes;
    localStorage.removeItem('sl_active_group');activeId=2;checkForResumableRounds();
    T("the resume offer no longer lists Bo's round",document.getElementById('resumePanel').style.display==='none');
    activeId=1;resumingRound=null;
    T('but the group-resume list keeps a stopped team-mate',resumeCandidateRounds().some(r=>r.id===102));
    const p2=players[1],pts=calcHolePoints(bo,p2);
    T('stopped holes score no points',pts.slice(12).every(x=>x===null)&&pts.slice(0,12).filter(Boolean).length===11);
    const ecl=eclecticCard(p2,[bo],0.95);
    T('eclectic: a stopped hole is unplayed (nett par + 3)',ecl.bestPerHole.slice(12).every(x=>!x)&&ecl.filled===11);
    allRounds=[bo];renderHallOfFame();
    const longest=()=>document.getElementById('fameBody').innerHTML.split('Longest day')[1].split('</tr>')[0];
    T('a stopped card is not a finished round for the longest day',!/Bo Berg/.test(longest()));
    bo.holes=bo.holes.map(h=>h.stopped?{hole:h.hole,score:null,par:h.par,hcp:h.hcp,pickup:true}:h);renderHallOfFame();
    T('(control: picked up instead, it would be)',/Bo Berg/.test(longest()));

    // ── Today leaderboard ──
    setup();await stopBo();allRounds.find(r=>r.id===102).holes=lastPatch(102).holes;
    renderTodayLb();
    const boRow=[...document.querySelectorAll('#todayTable tr')].find(tr=>/Bo Berg/.test(tr.textContent));
    T('Today shows "Stopped after 12" for Bo',!!boRow&&/Stopped after 12/.test(boRow.textContent),boRow&&boRow.textContent);
    T('and not for Ann',!/Stopped/.test([...document.querySelectorAll('#todayTable tr')].find(tr=>/Ann Ash/.test(tr.textContent)).textContent));

    // ── Loading from data (another phone / resume) ──
    setup();await stopBo();const boHoles=lastPatch(102).holes;
    allRounds.find(r=>r.id===102).holes=boHoles;
    localStorage.setItem('sl_active_group',JSON.stringify({date:today(),players:[1,2,3].map(id=>({id,teeId:'platinum'})),startHole:1,scorerPlayerId:1}));
    HE={playerList:[],scores:{},pickups:{},roundIds:{},currentHole:1,currentPidx:0,startHole:1};
    await autoResumeGroup();
    T('resume keeps Bo in the group',HE.playerList.some(x=>x.p.id===2));
    T("resume restores Bo's stopped holes",!!HE.stopped&&HE.stopped[2].map((s,i)=>s===(i>=12)).every(Boolean),JSON.stringify(HE.stopped));
    T("resume opens on hole 13 with Bo's row stopped",HE.currentHole===13&&/Stopped after 12/.test(card().textContent),HE.currentHole);
    allRounds.forEach(r=>{if(r.id!==102)r.holes=r.holes.map(h=>({...h,score:4}));});
    HE={playerList:[],scores:{},pickups:{},roundIds:{},currentHole:1,currentPidx:0,startHole:1};
    await autoResumeGroup();
    T('a group with nothing left to play is not resumed',!localStorage.getItem('sl_active_group')&&!HE.playerList.length);
    // A second phone setting up the same group adopts Bo's stopped round rather than minting one
    window.sbGet=async(t,q)=>{const pid=+(/player_id=eq\.(\d+)/.exec(q)||[])[1];return pid===2?[{id:102,player_id:2,date:today(),tee_id:'platinum',holes:boHoles}]:[];};
    let inserted=0;window.sbInsert=async(t,b)=>[{...b,id:900+(++inserted)}];
    players=[P(1,'Ann Ash'),P(2,'Bo Berg'),P(3,'Cy Cole')];
    await heInit(players.map(p=>({p,index:18,teeId:'platinum'})),today(),'',1);
    T('heInit adopts the stopped round',HE.roundIds[2]===102&&inserted===2,`${HE.roundIds[2]} / ${inserted}`);
    T('and restores its stopped holes',!!HE.stopped&&HE.stopped[2].slice(12).every(Boolean)&&!HE.stopped[2].slice(0,12).some(Boolean));
    // ── Manual "Continue →" resume: the start hole is inferred, a stopped team-mate comes along ──
    players=[P(1,'Ann Ash'),P(2,'Bo Berg')];activeId=1;localStorage.removeItem('sl_active_group');
    const tenth=stop=>Array.from({length:18},(_,i)=>({hole:i+1,score:i>=9&&i<=13?4:null,par:HOLE_PARS[i],hcp:HOLE_HCP[i],...(stop&&!(i>=9&&i<=13)?{stopped:true}:{})}));
    allRounds=[{id:201,player_id:1,date:today(),tee_id:'57',holes:tenth(false)},{id:202,player_id:2,date:today(),tee_id:'57',holes:tenth(true)}];
    T('inferStartHole: 10–14 played is a 10th-tee start (1–7 played is a 1st)',inferStartHole(allRounds.map(r=>r.holes))===10&&inferStartHole([tenth(false).map((h,i)=>({...h,score:i<7?4:null}))])===1);
    resumeRound(201);await startResumeEntry();
    T('manual resume: startHole 10, opens on 15',HE.startHole===10&&HE.currentHole===15,`${HE.startHole}/${HE.currentHole}`);
    T('manual resume brings the stopped team-mate, still stopped',HE.playerList.some(x=>x.p.id===2)&&/Stopped after 14/.test(card().textContent));
    HE.stopped[2]=Array(18).fill(false);const plan=heStopPlan(2);
    T('and stopping again follows the real play order',!!plan&&plan.after===14&&plan.holes.join()==='15,16,17,18,1,2,3,4,5,6,7,8,9',JSON.stringify(plan));
    // ── end ──
  }catch(e){out.push('FAIL EXCEPTION :: '+e.stack);}
  localStorage.removeItem('sl_active_group');
  await new Promise(r=>setTimeout(r,150));
  const pre=document.createElement('pre');pre.id='RESULT';pre.textContent=out.join('\n');document.body.innerHTML='';document.body.appendChild(pre);
},400);
