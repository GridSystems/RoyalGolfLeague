// Renders every leaderboard, the Hall of Fame and Fines for all seasons from window.__DATA,
// so a snapshot taken before a migration can be diffed against one taken after.
// Run: tests/run.ps1 -Test tests/leaderboards.render.js -Data <snapshot.json>
setTimeout(async function(){
  const out=[];const D=window.__DATA;
  window.toast=()=>{};window.setLoading=()=>{};
  tees=[];try{tees=D.tees||tees;}catch(e){}
  players=D.players.filter(p=>p.approved!==false);allRounds=[...D.rounds].sort((a,b)=>b.date.localeCompare(a.date));
  fineTypes=D.fine_types;allFines=D.fines;finePayments=D.fine_payments;activeId=null;
  populateYearSelects();
  for(const season of getSeasons()){
    for(const [view,sel,render,el] of [['season','seasonYear',renderSeasonLb,'seasonTable'],['eclectic','dreamYear',renderDreamCard,'eclecticRankings'],['fines','finesYear',renderFinesLb,'finesTable']]){
      document.getElementById(sel).value=season;render();
      out.push(`PASS render ${view} ${season}`,`----- ${view} ${season}`,document.getElementById(el).innerText);
    }
  }
  renderHallOfFame();out.push('PASS render fame','----- fame',document.getElementById('fameBody').innerText);
  await new Promise(r=>setTimeout(r,150));
  const pre=document.createElement('pre');pre.id='RESULT';pre.textContent=out.join('\n');document.body.innerHTML='';document.body.appendChild(pre);
},400);
