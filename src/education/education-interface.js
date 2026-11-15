(() => {
  'use strict';
  const U=window.CEST_CURIOUS_UTILS, panel=document.querySelector('#curiousPanel');
  if(!U||!panel)return;
  const $=s=>panel.querySelector(s);
  const date=new Intl.DateTimeFormat('en-US',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit',hour12:false,timeZone:'UTC'});
  const stamp=t=>Number.isFinite(t)?date.format(new Date(t)):'date unavailable';
  const duration=h=>`${h} h`;
  const scenarios={
    earth:'When terrain hides Earth, a direct radio link loses its line of sight. A relay satellite may offer another path if its position and equipment allow it.',
    sun:'Without an unobstructed Sun, panels receive no direct sunlight. Batteries or another energy source become essential during the interruption.',
    both:'A visible Sun and Earth help operations. They do not guarantee sufficient power or a radio link: slope, panels, antennas and equipment matter too.'
  };
  let site=null,tracks=[],selected=0,simulationHour=0,pending=false;
  const cache=new WeakMap();
  function scenario(key){
    panel.querySelectorAll('[data-scenario]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.scenario===key)));
    $('#curiousScenarioText').textContent=scenarios[key];
  }
  panel.querySelectorAll('[data-scenario]').forEach(b=>b.addEventListener('click',()=>scenario(b.dataset.scenario)));
  function explainBoundary(index){
    if(index<=0)return 'Start of the simulated period.';
    const a=site.visibility[index-1],b=site.visibility[index];
    if(!a||!b)return 'Missing data at this boundary.';
    const reasons=[];
    if(a.e!==b.e)reasons.push(b.e?'Earth clears the ridge':'Earth moves behind the ridge');
    if(a.available!==b.available)reasons.push(b.available?'direct illumination reaches 10%':'direct illumination falls below 10%');
    return reasons.length?reasons.join(' ; ')+'.':'Conditions remain unchanged at the operating threshold.';
  }
  function inspect(index){
    if(pending||!site?.series?.length)return;
    selected=Math.max(0,Math.min(site.series.length-1,index));
    $('#curiousHour').value=selected;
    const time=Date.parse(site.series[selected].t);
    $('#curiousHour').setAttribute('aria-valuetext',`${stamp(time)} UTC`);
    $('#curiousInspectionTime').textContent=`Inspection : ${stamp(time)} UTC`;
    $('#curiousCursor').setAttribute('x1',String((selected+.5)/site.series.length*1000));
    $('#curiousCursor').setAttribute('x2',String((selected+.5)/site.series.length*1000));
    const lines=tracks.map(track=>{
      const run=track.runs.find(r=>selected>=r.start&&selected<=r.end);
      if(!run)return `${track.label} : data unavailable.`;
      return `${track.label} : ${run.state===null?'missing data':run.state?'available':'unavailable'} · ${stamp(run.startTime)} → ${stamp(run.endTime)} UTC · ${duration(run.hours)}.`;
    });
    $('#curiousInspection').textContent=lines.join('\n');
    $('#curiousNextButton').disabled=!tracks[2].runs.some(r=>r.state&&r.start>selected);
    const favorable=tracks[2].runs.find(r=>r.state&&selected>=r.start&&selected<=r.end);
    $('#curiousBoundary').textContent=favorable?`Start: ${explainBoundary(favorable.start)} End: ${favorable.end===site.series.length-1?'end of the simulated period.':explainBoundary(favorable.end+1)}`:'A favorable window requires Earth visibility and direct illumination ≥ 10%.';
  }
  function render(){
    const series=site.series;
    let svg='<svg viewBox="0 0 1000 108" preserveAspectRatio="none" role="img" aria-label="Three hourly tracks: Sun, Earth and favorable windows. Use the slider to inspect intervals.">';
    const first=Date.parse(series[0].t),last=Date.parse(series[series.length-1].t)+3600000;
    tracks.forEach((track,row)=>{
      svg+=`<rect x="0" y="${row*36+2}" width="1000" height="26" rx="4" fill="#233346"/>`;
      track.runs.forEach(run=>{
        const x=(run.startTime-first)/(last-first)*1000,w=(run.endTime-run.startTime)/(last-first)*1000;
        if(!Number.isFinite(x)||!Number.isFinite(w))return;
        svg+=`<rect x="${x}" y="${row*36+2}" width="${w}" height="26" fill="${run.state===null?'#7d8b9b':run.state?track.color:'#233346'}"><title>${track.label} : ${run.state===null?'missing data':run.state?'available':'unavailable'}, ${stamp(run.startTime)} to ${stamp(run.endTime)} UTC, ${duration(run.hours)}</title></rect>`;
      });
    });
    svg+='<line id="curiousCursor" x1="0" x2="0" y1="0" y2="104" stroke="#ffffff" stroke-width="3"/></svg>';
    $('#curiousTracks').innerHTML=svg;
    $('#curiousPeriod').textContent=`${stamp(first)} → ${stamp(last)} UTC · 1 h steps`;
    $('#curiousHour').max=series.length-1;
    const favorable=tracks[2].runs.filter(r=>r.state);
    const longest=favorable.reduce((best,r)=>!best||r.hours>best.hours?r:best,null);
    $('#curiousLongest').textContent=longest?`Longest window : ${duration(longest.hours)} · ${stamp(longest.startTime)} → ${stamp(longest.endTime)} UTC.`:'No favorable window during this period.';
    const list=$('#curiousWindows');list.replaceChildren();
    favorable.forEach(run=>{
      const b=document.createElement('button');b.type='button';b.textContent=`${stamp(run.startTime)} → ${stamp(run.endTime)} UTC · ${duration(run.hours)}`;
      b.addEventListener('click',()=>inspect(run.start));list.append(b);
    });
    $('#curiousWindowCount').textContent=`All windows (${favorable.length})`;
  }
  $('#curiousHour').addEventListener('input',e=>inspect(Number(e.target.value)));
  $('#curiousTracks').addEventListener('pointermove',e=>{
    if(e.pointerType==='touch'||pending||!site?.series?.length)return;
    const box=e.currentTarget.getBoundingClientRect();inspect(Math.floor((e.clientX-box.left)/box.width*site.series.length));
  });
  $('#curiousNow').addEventListener('click',()=>inspect(simulationHour));
  $('#curiousNextButton').addEventListener('click',()=>{
    const next=tracks[2]?.runs.find(r=>r.state&&r.start>selected);if(next)inspect(next.start);
  });
  function update(next,hour,status='ready'){
    if(!document.body.classList.contains('mode-public'))return;
    simulationHour=hour;
    pending=status!=='ready'||!next?.series?.length||!next?.visibility?.length;
    panel.setAttribute('aria-busy',String(status==='loading'));
    $('#curiousData').hidden=pending;
    $('#curiousState').hidden=!pending;
    $('#curiousState').textContent=status==='error'?'Calculation unavailable. Choose another position to try again.':'Calculating conditions at this position…';
    $('#curiousFact').textContent=pending?U.fact(null,0):U.fact(next,hour);
    if(pending){site=null;$('#curiousActual').textContent='Site conditions pending.';return;}
    if(site!==next){site=next;tracks=cache.get(site)||U.derive(site);cache.set(site,tracks);render();inspect(hour);}
    const now=next.visibility[hour];
    const known=v=>v===0||v===1||typeof v==='boolean';
    $('#curiousActual').textContent=now&&known(now.s)&&known(now.e)?`Simulated time : ${now.s?'Sun visible':'Sun hidden'} · ${now.e?'Earth visible':'Earth hidden'}.`:'Simulated time : missing data.';
    const runs=tracks[2].runs,active=runs.find(r=>r.state&&hour>=r.start&&hour<=r.end),future=runs.find(r=>r.state&&r.start>hour);
    $('#curiousNext').textContent=active?`Window active until ${stamp(active.endTime)} UTC.`:future?`Next window : ${stamp(future.startTime)} UTC · ${duration(future.hours)}.`:'No new window before this period ends.';
    if(runs.some(r=>r.state===null)){
      $('#curiousNext').textContent+=' Incomplete data: additional windows cannot be ruled out.';
      if(!runs.some(r=>r.state))$('#curiousLongest').textContent='No favorable window confirmed; some data is missing.';
    }
    $('#curiousNextButton').disabled=!runs.some(r=>r.state&&r.start>selected);
  }
  scenario('earth');
  window.CEST_CURIOUS={update};
})();
