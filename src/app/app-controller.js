(() => {
  const D = window.CEST_DATA, SKY = window.CEST_SKY, E = window.CEST_ENGINE;
  if (!D?.sites?.length || !SKY?.length || !window.CEST_DEM || !E) return;
  const $ = (s) => document.querySelector(s);
  const sourceSites = D.sites;
  const byId = new Map(sourceSites.map(s => [s.id, s]));
  // Indicative ranking of precomputed sites over the same 30-day period.
  const favorableTimePercent = 10;
  const siteQuality = Object.fromEntries(sourceSites.map(site => {
    const both = E.evaluateSeries(site.series, site.horizon, site.normal || { east: 0, north: 0, up: 1 }).stats.both;
    return [site.id, { both, favorable: both >= favorableTimePercent }];
  }));
  window.CEST_SITE_QUALITY = siteQuality;
  const RMOON = 1737.4, MAX_KM = 2 * RMOON * Math.tan(Math.PI / 4 - 75 * Math.PI / 360);
  const HOURS = 720;
  const clamp = (v,a,b) => Math.max(a,Math.min(b,v));
  const METRIC_COLORS = { sun: '#F5C84C', earth: '#F05D6C', both: '#4AD295' };
  const directSunIllumination = (row,visibility) => visibility.light ?? 0;
  const $select = $('#siteSelect');
  const validModes=['public','teacher'];
  if(document.body.dataset.expertiseMode==='research')document.body.dataset.expertiseMode='teacher';
  let current = sourceSites[0], metric='sun', mode=validModes.includes(document.body.dataset.expertiseMode)?document.body.dataset.expertiseMode:'public', hour=0;
  let curiousCalculationStatus='ready';
  const calculationCache = new Map();
  let heightPixels=null, heightCanvas=null, horizonRayCache=null, modeTransitionTimer=0, calculationGeneration=0;
  const lonLabel = lon => `${Math.abs(lon).toFixed(2)}° ${lon < 0 ? 'W' : 'E'}`;
  const latLabel = lat => `${Math.abs(lat).toFixed(2)}° ${lat < 0 ? 'S' : 'N'}`;
  const fmtDate = iso => new Date(iso).toLocaleString('en-US',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit',hour12:false,timeZone:'UTC'}).toUpperCase();
  const paletteColor = (alpha=1) => { const hex=getComputedStyle(document.documentElement).getPropertyValue('--accent-color').trim().match(/^#([\da-f]{6})$/i)?.[1]||'55e5f2'; const rgb=[0,2,4].map(i=>parseInt(hex.slice(i,i+2),16)); return `rgba(${rgb.join(',')},${alpha})`; };
  const setVisibilityStatus = (element,visible,hiddenLabel) => { if(!element)return; element.textContent=visible?'VISIBLE':hiddenLabel; element.dataset.state=visible?'visible':'hidden'; element.setAttribute('aria-label',`${element.previousElementSibling?.textContent||'Celestial body'} ${visible?'visible':'hidden'} from the selected site`); };

  function buildSiteOptions(){
    const main=document.createElement('optgroup');main.label='Precomputed sites';
    for(const s of sourceSites){const o=document.createElement('option');o.value=s.id;o.textContent=`${s.name} · ${latLabel(s.lat)}`;main.append(o)}
    const names=document.createElement('optgroup');names.label='South Pole nomenclature · USGS';
    for(const f of D.catalogue){const o=document.createElement('option');o.value=`usgs:${f.id}`;o.textContent=`${f.name} · ${latLabel(f.lat)}`;names.append(o)}
    $select.append(main,names);$select.value=current.id;
    const list=$('#siteQuicklist');
    for(const s of sourceSites){
      const b=document.createElement('button'),quality=siteQuality[s.id];
      b.type='button';b.className='quick-site';b.dataset.site=s.id;
      b.dataset.quality=quality.favorable?'favorable':'standard';
      b.innerHTML=`<i class="quick-pin" aria-hidden="true"></i><span><b>${s.name}</b><small>${latLabel(s.lat)} · ${lonLabel(s.lon)}</small><small class="site-quality">${quality.favorable?'◇ Favorable':'· Tracked site'} · ${quality.both.toFixed(1)} % joint</small></span><span class="quick-go" aria-hidden="true">↗</span>`;
      b.title=`${quality.both.toFixed(1)} % of the period with direct light ≥10% and Earth visible. ${quality.favorable?'Favorable site during this 30-day period.':'Tracked site.'}`;
      b.addEventListener('click',()=>chooseSite(s));list.append(b);
    }
  }
  buildSiteOptions();

  function projection(lat,lon){
    const phi=lat*Math.PI/180,lam=lon*Math.PI/180;
    const rho=2*RMOON*Math.tan(Math.PI/4+phi/2);
    return {x:rho*Math.sin(lam), north:rho*Math.cos(lam), xn:rho*Math.sin(lam)/MAX_KM, zn:rho*Math.cos(lam)/MAX_KM};
  }
  function pixelAtXY(xkm,northKm){return {x:(xkm/MAX_KM+1)*.5*(heightCanvas.width-1),y:(1-northKm/MAX_KM)*.5*(heightCanvas.height-1)}}
  function sampleGray(x,y){
    if(!heightCanvas||!heightPixels)return null;
    const w=heightCanvas.width,h=heightCanvas.height;
    if(window.CEST_TILED_DEM?.ready)return window.CEST_TILED_DEM.sampleEncodedWorld((x/(w-1)*2-1)*MAX_KM*1000,(1-y/(h-1)*2)*MAX_KM*1000,true);
    if(x<0||y<0||x>w-1||y>h-1)return null;
    const x0=Math.floor(x),y0=Math.floor(y),x1=Math.min(x0+1,w-1),y1=Math.min(y0+1,h-1),fx=x-x0,fy=y-y0,p=heightPixels;
    const a=p[y0*w+x0],b=p[y0*w+x1],c=p[y1*w+x0],d=p[y1*w+x1];
    return (a*(1-fx)+b*fx)*(1-fy)+(c*(1-fx)+d*fx)*fy;
  }
  function grayToMeters(v){return (v-32768)*0.5}
  function heightMeters(lat,lon){const p=projection(lat,lon),x=(p.x/MAX_KM+1)*.5*(heightCanvas.width-1),y=(1-p.north/MAX_KM)*.5*(heightCanvas.height-1),g=sampleGray(x,y);if(g===null&&window.CEST_TILED_DEM?.ready)throw new Error("The 30 m LOLA tiles for this calculation are not loaded.");return g===null?0:grayToMeters(g)}

  async function computeHorizon(lat,lon,isCancelled=()=>false){
    const profile=new Float32Array(360),phi1=lat*Math.PI/180,lam1=lon*Math.PI/180,sinPhi1=Math.sin(phi1),cosPhi1=Math.cos(phi1),h0=heightMeters(lat,lon),r0=RMOON+h0/1000;
    const step=window.CEST_TILED_DEM?.ready?window.CEST_TILED_DEM.metadata.sampleMeters/1000:2*MAX_KM/(heightCanvas.width-1),maxSteps=Math.ceil(100/step);
    if(!horizonRayCache||horizonRayCache.width!==heightCanvas.width){
      const sinTheta=new Float64Array(maxSteps+1),cosTheta=new Float64Array(maxSteps+1);
      for(let k=1;k<=maxSteps;k++){const theta=k*step/RMOON;sinTheta[k]=Math.sin(theta);cosTheta[k]=Math.cos(theta)}
      horizonRayCache={width:heightCanvas.width,step,maxSteps,sinTheta,cosTheta};
    }
    const {sinTheta,cosTheta}=horizonRayCache;
    const sinLon=Math.sin(lam1),cosLon=Math.cos(lam1),upX=cosPhi1*sinLon,upY=cosPhi1*cosLon,upZ=sinPhi1;
    const eastX=cosLon,eastY=-sinLon,northX=-sinPhi1*sinLon,northY=-sinPhi1*cosLon,northZ=cosPhi1;
    let sliceStarted=performance.now();
    for(let a=0;a<360;a++){
      const az=a*Math.PI/180,sinAz=Math.sin(az),cosAz=Math.cos(az),dirX=eastX*sinAz+northX*cosAz,dirY=eastY*sinAz+northY*cosAz,dirZ=northZ*cosAz;let highestTan=-Infinity;
      for(let k=1;k<=maxSteps;k++){
        const sinTh=sinTheta[k],cosTh=cosTheta[k],destX=upX*cosTh+dirX*sinTh,destY=upY*cosTh+dirY*sinTh,destZ=upZ*cosTh+dirZ*sinTh,scale=2*RMOON/(1-destZ),mapX=scale*destX,mapNorth=scale*destY,pixelX=(mapX/MAX_KM+1)*.5*(heightCanvas.width-1),pixelY=(1-mapNorth/MAX_KM)*.5*(heightCanvas.height-1),g=sampleGray(pixelX,pixelY);
        if(g===null)break;
        const rt=RMOON+grayToMeters(g)/1000,tangent=(rt*cosTh-r0)/(rt*sinTh);
        if(tangent>highestTan)highestTan=tangent;
      }
      if(performance.now()-sliceStarted>=5){await new Promise(resolve=>setTimeout(resolve,0));if(isCancelled())return null;sliceStarted=performance.now()}
      if(!Number.isFinite(highestTan))throw new Error(`Relief unavailable vers l’azimuth ${a}°.`);
      profile[a]=Math.atan(highestTan)*180/Math.PI;
    }
    return profile;
  }
  const horizonAt=E.horizonAt;
  const localBasis=E.basis;
  function observe(v,siteVec,basis,offset=0){const result=E.observe(v,siteVec,basis,offset);return {alt:result.altitude,az:result.azimuth,distanceKm:result.distanceKm}}

  function prepareIntervals(site){
    Object.assign(site,E.evaluateSeries(site.series,site.horizon,site.normal||{east:0,north:0,up:1}));
    site.windowIndexAtHour=new Int16Array(site.series.length).fill(-1);
    site.combinedWindows.forEach((window,index)=>{for(let i=window.start;i<=window.end;i++)site.windowIndexAtHour[i]=index});
    site.windowLabels=site.combinedWindows.map(formatWindow);
    site.sunDirectPercent=(100*site.solarFlags.filter(Boolean).length/site.solarFlags.length).toFixed(1);
    site.earthVisiblePercent=(100*site.earthFlags.filter(Boolean).length/site.earthFlags.length).toFixed(1);
    site.longestWindowIndex=site.combinedWindows.reduce((best,window,index)=>best<0||window.hours>site.combinedWindows[best].hours?index:best,-1);
  }

  function commitPoint(lat,lon,name,siteId,calculated){
    ++scanGeneration;
    window.CEST_TERRAIN3D?.setAnalysisZones?.([]);
    const scanStatus=$('#earthZoneScanStatus'),scanResults=$('#earthZoneResults');
    if(scanStatus)scanStatus.textContent='Ready to analyze the area around the selected site.';
    if(scanResults){scanResults.replaceChildren();scanResults.hidden=true}
    const {series,horizon}=calculated;
    current={id:siteId,name,lat,lon,demId:window.CEST_TILED_DEM?.metadata?.id||'legacy',elevation:heightMeters(lat,lon),series,horizon:Array.from(horizon),normal:E.surfaceNormal(lat,lon,heightMeters)};
    prepareIntervals(current);
    document.body.classList.remove('metrics-pending');
    if(siteId==='custom'){if(!$select.querySelector('option[value="custom"]')){const o=document.createElement('option');o.value='custom';$select.prepend(o)}$select.querySelector('option[value="custom"]').textContent=`${name} · ${latLabel(lat)}`}
    $select.value=siteId==='custom'?'custom':siteId;refreshInfo();window.CEST_TERRAIN3D?.setTime(hour,series[hour],lat,lon,current.visibility[hour]);$('#terrainLoading').classList.remove('visible');
  }

  async function calculatePoint(lat,lon,name,silent=false,siteId='custom'){
    if(!heightPixels){showToast('LOLA terrain is still loading.');return}
    const calculationId=++calculationGeneration;
    ++scanGeneration;
    let releaseTiles=null;
    try{
      markMetricsPending();
      if(!silent)window.CEST_TERRAIN3D?.setSite(lat,lon,name);
      if(window.CEST_TILED_DEM?.ready){const center=projection(lat,lon);releaseTiles=await window.CEST_TILED_DEM.ensureRegionMeters(center.x*1000,center.north*1000,103000,()=>calculationId!==calculationGeneration);if(calculationId!==calculationGeneration)return;}
      const key=`${window.CEST_TILED_DEM?.metadata?.id||'legacy'}:${lat.toFixed(5)},${lon.toFixed(5)}`;
      const known=sourceSites.find(site=>site.modelVersion===E.MODEL_VERSION&&site.demSize===(window.CEST_TILED_DEM?.metadata?.width||heightCanvas.width)&&(!window.CEST_TILED_DEM?.ready||(site.demId===window.CEST_TILED_DEM.metadata.id&&site.horizonStepMeters===30))&&Math.abs(site.lat-lat)<1e-8&&Math.abs(site.lon-lon)<1e-8);
      const cached=calculationCache.get(key)||known;
      if(cached&&calculationCache.has(key)){calculationCache.delete(key);calculationCache.set(key,cached)}
      if(cached){commitPoint(lat,lon,name,siteId,cached);return}
      if(calculationId!==calculationGeneration)return;
      const horizon=await computeHorizon(lat,lon,()=>calculationId!==calculationGeneration);
      if(!horizon||calculationId!==calculationGeneration)return;
      const hm=heightMeters(lat,lon),basis=localBasis(lat,lon),up=basis.up,siteVec=up.map(v=>v*(RMOON+hm/1000));
      const series=new Array(HOURS);
      for(let i=0;i<HOURS;i++){
        const vv=SKY[i],s=observe(vv,siteVec,basis,0),e=observe(vv,siteVec,basis,3);
        series[i]={t:sourceSites[0].series[i].t,s:s.alt,sa:s.az,sd:s.distanceKm,e:e.alt,ea:e.az,ed:e.distanceKm};
      }
      const computed={series,horizon};calculationCache.set(key,computed);
      if(calculationCache.size>24)calculationCache.delete(calculationCache.keys().next().value);
      commitPoint(lat,lon,name,siteId,computed);
    }catch(error){
      if(error.name==='AbortError')return;
      if(calculationId===calculationGeneration){console.error('Sun and Earth calculation failed:',error);$('#insightText').textContent='Calculation unavailable at this terrain point.';curiousCalculationStatus='error';window.CEST_CURIOUS?.update(null,hour,'error');showToast('Calculation unavailable at this terrain point. Choose another position.')}
    }finally{
      releaseTiles?.();
      if(calculationId===calculationGeneration)$('#terrainLoading').classList.remove('visible');
    }
  }

  function markMetricsPending(){
    curiousCalculationStatus='loading';
    window.CEST_CURIOUS?.update(current,hour,'loading');
    if(document.body.classList.contains('metrics-pending'))return;
    document.body.classList.add('metrics-pending');
    for(const selector of ['#sunStat','#earthStat','#bothStat','#timelineIntersectionCount'])$(selector).textContent='…';
    $('#insightText').textContent='Calculating conditions at this position…';
    $('#fullscreenIntersectionWindow').textContent='Recalculating windows at this position…';
    $('#fullscreenCommsSummary').textContent='Recalculating windows over 30 days…';
    $('#operationResult').textContent='Recalculating 720 hours and communication windows…';
  }

  function getInsight(){
    if(mode==='teacher')return `Flat horizon: Sun visible ${current.stats.flatSun}% of the time. With LOLA terrain: ${current.stats.sun}%. A ridge can hide a celestial body even after it rises.`;
    if(current.stats.sun===0&&current.stats.earth===0)return `Ridges at this site hide the Sun and Earth throughout the simulated 30-day period.`;
    return `From this point, the Sun is visible ${current.stats.sun}% of the time and Earth ${current.stats.earth}%. Direct light ≥10% and Earth visible : ${current.stats.both}%.`;
  }
  function refreshInfo(){
    const activeModeLabel=$('#activeModeLabel');if(activeModeLabel)activeModeLabel.textContent=({public:'EXPLORER',teacher:'TEACHER/RESEARCHER'})[mode];
    const modeSummary=$('#modeSummary');if(modeSummary)modeSummary.textContent=({public:'Choose a site, explore the lunar terrain and discover when sunlight and Earth appear.',teacher:'Compare horizons, analyze LOLA profiles and Sun/Earth windows; export PDF reports and 720 hourly samples.'})[mode];
    $('#siteTitle').textContent=current.name;
    $('#siteCoords').textContent=`${latLabel(current.lat)}  ·  ${lonLabel(current.lon)}`;
    $('#coords').textContent=`${latLabel(current.lat)} · ${lonLabel(current.lon)}`;
    const railCoords=$('#railCoords');if(railCoords)railCoords.textContent=`${latLabel(current.lat)} · ${lonLabel(current.lon)}`;
    $('#sunStat').textContent=`${current.stats.sun.toFixed(1)}%`;
    $('#earthStat').textContent=`${current.stats.earth.toFixed(1)}%`;
    $('#bothStat').textContent=`${current.stats.both.toFixed(1)}%`;
    $('#bothBar').style.width=`${clamp(current.stats.both,0,100)}%`;
    $('#insightText').textContent=getInsight();
    $('#researchExport').classList.toggle('visible',mode==='teacher');
    $('#horizonNote').textContent=mode==='teacher'?'LOLA · horizon calculated over 360 azimuths · range 100 km.':'Ridges along the skyline in each viewing direction.';
    $('#timelineDescription').textContent=mode==='teacher'?'720 hourly samples: colored segments show when the body clears the ridge; dark segments are obstructed.':'When the Sun or Earth clears the local terrain.';
    document.querySelectorAll('.quick-site').forEach(b=>b.classList.toggle('selected',b.dataset.site===current.id));
    drawTimeline();drawHorizon();drawFullscreenCharts();updateTime();
    if(document.body.classList.contains('metrics-pending')){document.body.classList.remove('metrics-pending');markMetricsPending()}
  }

  function drawFullscreenCharts(){
    const sunCanvas=$('#fullscreenBrightnessChart'),commsCanvas=$('#fullscreenCommsChart');
    if(!sunCanvas||!commsCanvas||!current?.series?.length)return;
    const n=current.series.length;
    if(!current.sunVisibleFlags||current.sunVisibleFlags.length!==n||!current.solarFlags||current.solarFlags.length!==n||!current.earthFlags||current.earthFlags.length!==n||!current.combinedFlags||current.combinedFlags.length!==n)prepareIntervals(current);
    const prepare=canvas=>{
      const rect=canvas.getBoundingClientRect();if(rect.width<2||rect.height<2)return null;
      const ratio=Math.min(window.devicePixelRatio||1,1.5),width=Math.max(1,Math.round(rect.width*ratio)),height=Math.max(1,Math.round(rect.height*ratio));
      if(canvas.width!==width||canvas.height!==height){canvas.width=width;canvas.height=height}
      const ctx=canvas.getContext('2d');ctx.setTransform(ratio,0,0,ratio,0,0);ctx.clearRect(0,0,rect.width,rect.height);return{ctx,w:rect.width,h:rect.height};
    };
    const sun=prepare(sunCanvas),comms=prepare(commsCanvas);if(!sun||!comms)return;
    const {ctx:light,w:lw,h:lh}=sun,pad=3,plotH=Math.max(1,lh-pad*2),series=current.series,visibility=current.visibility;
    light.fillStyle='#000000';light.fillRect(0,0,lw,lh);
    for(const level of [0,.5,1]){const y=pad+(1-level)*plotH;light.strokeStyle=level===0?'#414858':'#293244';light.lineWidth=1;light.beginPath();light.moveTo(0,y);light.lineTo(lw,y);light.stroke()}
    const xx=i=>i/(series.length-1)*lw,yy=v=>pad+(1-v)*plotH;
    light.beginPath();light.moveTo(0,yy(0));
    for(let i=0;i<series.length;i++){const value=directSunIllumination(series[i],visibility[i])/100;light.lineTo(xx(i),yy(value))}
    light.lineTo(lw,yy(0));light.closePath();const fill=light.createLinearGradient(0,pad,0,lh);fill.addColorStop(0,'#F5C84C88');fill.addColorStop(1,'#F5C84C08');light.fillStyle=fill;light.fill();
    light.beginPath();for(let i=0;i<series.length;i++){const value=directSunIllumination(series[i],visibility[i])/100;i?light.lineTo(xx(i),yy(value)):light.moveTo(xx(i),yy(value))}light.strokeStyle=METRIC_COLORS.sun;light.lineWidth=1.5;light.stroke();
    const {ctx:ctx2,w,h}=comms;ctx2.fillStyle='#000000';ctx2.fillRect(0,0,w,h);
    const tracks=[{label:'SUN',key:'sun',flags:current.sunVisibleFlags},{label:'EARTH',key:'earth',flags:current.earthFlags},{label:'COMM. ≥10%',key:'both',flags:current.combinedFlags}],left=Math.min(68,Math.max(58,w*.28)),right=3,trackW=Math.max(1,w-left-right),rowH=Math.max(2,(h-8)/3),stepW=trackW/(series.length);
    commsCanvas.dataset.plotLeft=String(left);commsCanvas.dataset.plotRight=String(w-right);
    ctx2.font='bold 7px Consolas,monospace';ctx2.textAlign='left';ctx2.textBaseline='middle';
    for(let row=0;row<tracks.length;row++){
      const band=tracks[row],top=4+row*rowH,barH=Math.max(2,rowH-2);ctx2.fillStyle='#111111';ctx2.fillRect(left,top,trackW,barH);
      ctx2.fillStyle=METRIC_COLORS[band.key];ctx2.globalAlpha=.96;
      for(let i=0;i<band.flags.length;i++)if(band.flags[i])ctx2.fillRect(left+i*stepW,top,Math.max(1,stepW+.15),Math.max(2,rowH-2));
      ctx2.globalAlpha=1;ctx2.fillStyle=METRIC_COLORS[band.key];ctx2.fillText(band.label,2,top+barH/2);
    }
    updateFullscreenCommsSummary();
  }
  function updateFullscreenCommsSummary(){
    const summary=$('#fullscreenCommsSummary');if(!summary||!current?.solarFlags||!current?.earthFlags)return;
    const sunWindows=windowsFor(current.sunVisibleFlags),earthWindows=windowsFor(current.earthFlags),sharedWindows=current.combinedWindows||[];
    summary.innerHTML=`<span class="comms-summary-sun">Sun visible ${sunWindows.length}</span><span class="comms-summary-earth">Earth ${earthWindows.length}</span><span class="comms-summary-both">Comm. ≥10 % ${sharedWindows.length}</span><span class="comms-summary-now">${current.sunVisibleFlags[hour]?'☼':'—'} / ${current.earthFlags[hour]?'Earth':'—'}</span>`;
    summary.setAttribute('aria-label',`${sunWindows.length} Sun visibility windows, ${earthWindows.length} Earth visibility windows and ${sharedWindows.length} joint windows with at least 10 percent direct illumination over 30 days. At the selected time: Sun ${current.sunVisibleFlags[hour]?'visible':'hidden'}, Earth ${current.earthFlags[hour]?'visible':'hidden'}.`);
  }

  function selectedValue(r,index){
    if(metric==='both')return current.combinedFlags[index]?1:0;
    const visibilityKey=metric==='sun'?'s':metric==='earth'?'e':null;
    return visibilityKey?Number(Boolean(r[visibilityKey])):0;
  }
  function drawTimeline(){
    const c=$('#timeline'),r=c.getBoundingClientRect(),d=Math.min(devicePixelRatio||1,2);c.width=Math.max(1,Math.round(r.width*d));c.height=Math.round(r.height*d);const x=c.getContext('2d');x.setTransform(d,0,0,d,0,0);const w=r.width,h=r.height,rows=current.visibility,color=METRIC_COLORS[metric]||METRIC_COLORS.sun;
    if (!w || !h || !rows.length) return;
    const cell=w/rows.length;
    const combined=current.combinedFlags;
    const tracks=[
      {top:12,height:30,color,windows:windowsFor(rows.map(selectedValue))},
      {top:54,height:16,color:METRIC_COLORS.both,windows:current.combinedWindows}
    ];
    for(const track of tracks){
      x.fillStyle='#18212b';
      x.fillRect(0,track.top,w,track.height);
      x.fillStyle=track.color;
      for(const span of track.windows){
        x.fillRect(span.start*cell,track.top,(span.end-span.start+1)*cell,track.height);
      }
    }
    x.strokeStyle='#8da2b750';
    for(let i=0;i<=4;i++){
      const px=[0,168,336,504,720][i]/720*w;
      x.beginPath();x.moveTo(px,8);x.lineTo(px,74);x.stroke();
    }
    const badge=$('#timelineIntersectionBadge'),count=$('#timelineIntersectionCount'),windows=current.combinedWindows,active=combined[hour];
    if(count)count.textContent=`${windows.length} window${windows.length>1?'s':''}`;
    if(badge){badge.classList.toggle('is-active',Boolean(active));badge.setAttribute('aria-label',`${windows.length} window${windows.length>1?'s':''} with direct sunlight and Earth visible simultaneously. ${active?'Overlap active at the selected time.':'No overlap at the selected time.'}`)}
  }
  function drawHorizon(){
    const c=$('#horizon');c.dataset.demId=current.demId||'preloaded';c.dataset.profile=JSON.stringify(current.horizon);c.dataset.latitude=String(current.lat);c.dataset.longitude=String(current.lon);c.dataset.elevation=String(current.elevation);const r=c.getBoundingClientRect(),d=Math.min(devicePixelRatio||1,2);c.width=Math.max(1,Math.round(r.width*d));c.height=Math.round(r.height*d);const x=c.getContext('2d');x.setTransform(d,0,0,d,0,0);const w=r.width,h=r.height,pad=8,vals=current.horizon,lo=Math.min(-2,...vals),hi=Math.max(4,...vals),y=v=>h-pad-(v-lo)/(hi-lo)*(h-2*pad),xx=i=>i/(vals.length-1)*w;
    x.clearRect(0,0,w,h);x.strokeStyle='#242938';x.lineWidth=1;[0,.33,.66,1].forEach(q=>{const yy=pad+q*(h-pad*2);x.beginPath();x.moveTo(0,yy);x.lineTo(w,yy);x.stroke()});const zero=y(0);x.setLineDash([4,4]);x.strokeStyle=paletteColor(.56);x.beginPath();x.moveTo(0,zero);x.lineTo(w,zero);x.stroke();x.setLineDash([]);
    const g=x.createLinearGradient(0,pad,0,h);g.addColorStop(0,'#F5C84C52');g.addColorStop(1,'#F5C84C04');x.beginPath();x.moveTo(0,zero);vals.forEach((v,i)=>x.lineTo(xx(i),y(v)));x.lineTo(w,zero);x.closePath();x.fillStyle=g;x.fill();x.beginPath();vals.forEach((v,i)=>i?x.lineTo(xx(i),y(v)):x.moveTo(xx(i),y(v)));x.strokeStyle=METRIC_COLORS.sun;x.lineWidth=1.7;x.stroke();x.fillStyle='#9ca1b0';x.font='9px Consolas,monospace';x.fillText(`${hi.toFixed(0)}°`,2,12);x.fillText(`${lo.toFixed(0)}°`,2,h-2);
  }
  function windowsFor(flags){
    const windows=[];let start=-1;
    for(let i=0;i<=flags.length;i++){
      if(i<flags.length&&flags[i]){if(start<0)start=i}
      else if(start>=0){windows.push({start,end:i-1,hours:i-start});start=-1}
    }
    return windows;
  }
  function formatWindow(w){
    if(!w)return 'no window during the 30-day period';
    const start=new Date(current.series[w.start].t),end=new Date(new Date(current.series[w.end].t).getTime()+3600000);
    const date=d=>d.toLocaleDateString('en-US',{day:'2-digit',month:'short',timeZone:'UTC'}).replace('.','');
    const time=d=>d.toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit',hour12:false,timeZone:'UTC'});
    const same=date(start)===date(end),span=same?`${time(start)}–${time(end)}`:`${time(start)} → ${date(end)} ${time(end)}`;
    return `${date(start)} · ${span} UTC · ${w.hours} h`;
  }
  let scanGeneration=0;
  const yieldToBrowser=()=>new Promise(resolve=>setTimeout(resolve,0));
  function scanHorizon(lat,lon){
    const bins=72,profile=new Float32Array(bins),phi=lat*Math.PI/180,lambda=lon*Math.PI/180,sinPhi=Math.sin(phi),cosPhi=Math.cos(phi),h0=heightMeters(lat,lon),r0=RMOON+h0/1000;
    const radialStep=500,maxSteps=Math.ceil(100000/radialStep),sinTheta=new Float64Array(maxSteps+1),cosTheta=new Float64Array(maxSteps+1);
    for(let k=1;k<=maxSteps;k++){const theta=k*radialStep/(RMOON*1000);sinTheta[k]=Math.sin(theta);cosTheta[k]=Math.cos(theta)}
    const sinLon=Math.sin(lambda),cosLon=Math.cos(lambda),upX=cosPhi*sinLon,upY=cosPhi*cosLon,upZ=sinPhi,eastX=cosLon,eastY=-sinLon,northX=-sinPhi*sinLon,northY=-sinPhi*cosLon,northZ=cosPhi;
    for(let a=0;a<bins;a++){
      const az=a*Math.PI*2/bins,sinAz=Math.sin(az),cosAz=Math.cos(az),dirX=eastX*sinAz+northX*cosAz,dirY=eastY*sinAz+northY*cosAz,dirZ=northZ*cosAz;let highest=-Infinity;
      for(let k=1;k<=maxSteps;k++){
        const st=sinTheta[k],ct=cosTheta[k],dx=upX*ct+dirX*st,dy=upY*ct+dirY*st,dz=upZ*ct+dirZ*st,scale=2*RMOON/(1-dz),mx=scale*dx,mn=scale*dy,px=(mx/MAX_KM+1)*.5*(heightCanvas.width-1),py=(1-mn/MAX_KM)*.5*(heightCanvas.height-1),gray=sampleGray(px,py);
        if(gray===null)break;
        const radius=RMOON+grayToMeters(gray)/1000,tangent=(radius*ct-r0)/(radius*st);if(tangent>highest)highest=tangent;
      }
      if(!Number.isFinite(highest))throw new Error(`Terrain unavailable in the scan area at ${a*5}°.`);
      profile[a]=Math.atan(highest)*180/Math.PI;
    }
    return profile;
  }
  function inverseProjection(x,north){const rho=Math.hypot(x,north),lat=(2*Math.atan(rho/(2*RMOON))-Math.PI/2)*180/Math.PI,lon=((Math.atan2(x,north)*180/Math.PI+540)%360)-180;return{lat,lon}}
  async function scanEarthZones(){
    const button=$('#scanEarthZonesButton'),status=$('#earthZoneScanStatus'),resultsBox=$('#earthZoneResults');
    if(mode==='public'){showToast('Scanning is available in Teacher/Researcher mode.');return}
    if(!heightPixels){status.textContent='LOLA terrain is still loading.';return}
    const scanId=++scanGeneration,radiusKm=Number($('#scanRadius').value)||20,spacingKm=Number($('#scanSpacing').value)||5,center=projection(current.lat,current.lon),candidates=[];
    for(let north=-radiusKm;north<=radiusKm+1e-6;north+=spacingKm)for(let east=-radiusKm;east<=radiusKm+1e-6;east+=spacingKm){if(Math.hypot(east,north)>radiusKm+1e-6)continue;const point=inverseProjection(center.x+east,center.north+north);if(point.lat<-90||point.lat>-75)continue;candidates.push(point)}
    button.disabled=true;button.textContent='Scanning…';resultsBox.hidden=true;status.textContent=`Analyzing ${candidates.length} points · sunlight and Earth visibility over 30 days…`;
    const found=[];
    try{
      for(let ci=0;ci<candidates.length;ci++){
        if(scanId!==scanGeneration)return;
        const point=candidates[ci],center=projection(point.lat,point.lon);let releaseScanTiles=null;
        try{
        if(window.CEST_TILED_DEM?.ready)releaseScanTiles=await window.CEST_TILED_DEM.ensureRegionMeters(center.x*1000,center.north*1000,103000,()=>scanId!==scanGeneration);
        if(scanId!==scanGeneration)return;
        const horizon=scanHorizon(point.lat,point.lon),hm=heightMeters(point.lat,point.lon),normal=E.surfaceNormal(point.lat,point.lon,heightMeters),basis=localBasis(point.lat,point.lon),siteVec=basis.up.map(v=>v*(RMOON+hm/1000)),flags=new Array(HOURS);let earthHours=0;
        for(let i=0;i<HOURS;i++){const sun=observe(SKY[i],siteVec,basis,0),earth=observe(SKY[i],siteVec,basis,3),condition=E.evaluateHour({s:sun.alt,sa:sun.az,sd:sun.distanceKm,e:earth.alt,ea:earth.az,ed:earth.distanceKm},horizon,normal);flags[i]=Boolean(condition.combined);earthHours+=condition.e}
        const windows=windowsFor(flags),visibleHours=flags.reduce((n,flag)=>n+(flag?1:0),0),longest=windows.reduce((best,item)=>!best||item.hours>best.hours?item:best,null);
        if(longest)found.push({...point,elevation:hm,visiblePercent:100*visibleHours/HOURS,earthPercent:100*earthHours/HOURS,visibleHours,windows,longest});
        }finally{releaseScanTiles?.();}
        if(ci%2===0||ci===candidates.length-1){status.textContent=`Analyzing ${ci+1} / ${candidates.length} points…`;await yieldToBrowser()}
      }
      if(scanId!==scanGeneration)return;
      found.sort((a,b)=>b.visibleHours-a.visibleHours||(b.longest?.hours||0)-(a.longest?.hours||0));
      const top=found.slice(0,6);window.CEST_TERRAIN3D?.setAnalysisZones?.(top);resultsBox.replaceChildren();
      if(!top.length){status.textContent='No joint window with direct sunlight ≥10% and Earth visible was found in this area.';resultsBox.hidden=true;return}
      status.textContent=`${found.length} sites with a joint window · ${candidates.length} points analyzed · quick estimate, confirm at the selected point.`;
      for(const [index,item] of top.entries()){const buttonResult=document.createElement('button');buttonResult.type='button';buttonResult.className='earth-zone-result';buttonResult.innerHTML=`<span class="zone-result-rank" aria-label="Rank ${index+1}">${index+1}</span><span><b>${Math.abs(item.lat).toFixed(3)}° S · ${Math.abs(item.lon).toFixed(3)}° ${item.lon<0?'W':'E'}</b><small>${item.visiblePercent.toFixed(1)} % joint window · Earth ${item.earthPercent.toFixed(1)} %</small><small>${formatWindow(item.longest)} · relief ${item.elevation.toFixed(0)} m</small></span><span><b>${item.longest.hours} h</b><small>best window</small></span>`;buttonResult.addEventListener('click',()=>window.CEST_SELECT_SITE_COORDINATES?.(item.lat,item.lon,`Communication area · ${Math.abs(item.lat).toFixed(2)}° S`));resultsBox.append(buttonResult)}
      resultsBox.hidden=false;
    }catch(error){if(error.name==='AbortError')return;console.error('Earth window scan failed:',error);status.textContent='The scan failed. Check that LOLA terrain has loaded.'}
    finally{button.disabled=false;button.textContent='Scan nearby areas'}
  }
  function pdfEscape(value){return String(value??'—').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^\x20-\x7E]/g,'?').replace(/[\\()]/g,'\\$&')}
  function buildPdf(lines){
    const pages=[];for(let i=0;i<lines.length;i+=47)pages.push(lines.slice(i,i+47));
    const objects=[null,'<< /Type /Catalog /Pages 2 0 R >>',null,'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>'];
    const pageIds=[];let nextId=5;
    for(const pageLines of pages){const pageId=nextId++,contentId=nextId++;pageIds.push(pageId);const text=['BT','/F2 11 Tf','38 570 Td',`(${pdfEscape('C\'EST LUNAIRE | POSITION REPORT')}) Tj`,'/F1 7 Tf','0 -18 Td','9 TL',...pageLines.flatMap(line=>[`(${pdfEscape(line)}) Tj`,'T*']),'ET'].join('\n');objects[pageId]=`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 842 595] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentId} 0 R >>`;objects[contentId]=`<< /Length ${text.length} >>\nstream\n${text}\nendstream`}
    objects[2]=`<< /Type /Pages /Kids [${pageIds.map(id=>`${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;
    let pdf='%PDF-1.4\n%CEST\n';const offsets=[0];for(let id=1;id<objects.length;id++){offsets[id]=pdf.length;pdf+=`${id} 0 obj\n${objects[id]}\nendobj\n`}
    const xref=pdf.length;pdf+=`xref\n0 ${objects.length}\n0000000000 65535 f \n`;for(let id=1;id<objects.length;id++)pdf+=`${String(offsets[id]).padStart(10,'0')} 00000 n \n`;pdf+=`trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
    return new TextEncoder().encode(pdf);
  }
  function exportPositionPdf(){
    if(mode!=='teacher'){showToast('PDF reports are available in Teacher/Researcher mode.');return}
    const lines=[],lat=`${Math.abs(current.lat).toFixed(5)} ${current.lat<0?'S':'N'}`,lon=`${Math.abs(current.lon).toFixed(5)} ${current.lon<0?'W':'E'}`,now=current.series[hour],vis=current.visibility[hour];
    const earthIllumination=E.earthPhasePercent(SKY[hour]);
    lines.push(
      'C\'EST LUNAIRE - POSITION REPORT',`Site : ${current.name}`,`Coordinates : ${lat}, ${lon}`,
      `Selected time : ${fmtDate(now.t)} UTC`,`LOLA elevation : ${current.elevation.toFixed(1)} m`,
      `DEM : ${current.demId||'LOLA'} - 30 m/pixel at the pole`,
      'Horizon: 30 m radial steps, 360 directions, 100 km range',
      'Local slope: centered differences over 225 m',
      '','30-DAY SUMMARY (720 HOURLY STEPS)',
      `Sun visible above terrain : ${current.stats.sun.toFixed(1)} % of the time`,
      `Earth visible above terrain : ${current.stats.earth.toFixed(1)} % of the time`,
      `Direct sunlight >= 10 % : ${current.sunDirectPercent} % of the time`,
      `Intersection Direct sunlight >= 10 % + Earth visible : ${current.stats.both.toFixed(1)} %`,
      `Sun at the selected time : altitude ${now.s.toFixed(3)} deg, azimuth ${now.sa.toFixed(3)} deg, ${vis.s?'visible':'hidden'}`,
      `Earth at the selected time : altitude ${now.e.toFixed(3)} deg, azimuth ${now.ea.toFixed(3)} deg, ${vis.e?'visible':'hidden'}`,
      `Visible solar disk : ${(100*vis.disk).toFixed(2)} %`,
      `Cosine of incidence on the local slope : ${vis.incidence.toFixed(4)}`,
      `Current direct solar illumination : ${vis.light.toFixed(2)} %`,
      `Communication window at the selected time : ${vis.combined?'yes':'no'}`,
      `Geometric Earth illumination : ${earthIllumination.toFixed(2)} %`,
      `Current local horizon : Sun ${vis.sh.toFixed(3)} deg, Earth ${vis.eh.toFixed(3)} deg`,
      '','JOINT SUN + EARTH WINDOWS');
    if(current.combinedWindows.length)current.combinedWindows.forEach((window,index)=>lines.push(`${index+1}. ${formatWindow(window)}`));else lines.push('No joint window during the simulated period.');
    lines.push('','HOURLY SAMPLES · UTC','Each hour uses two lines: solar conditions, followed by Earth and link conditions.');
    for(let i=0;i<HOURS;i++){
      const r=current.series[i],v=current.visibility[i],phase=E.earthPhasePercent(SKY[i]);
      lines.push(`${r.t} | Sun alt/az ${r.s.toFixed(3)}/${r.sa.toFixed(2)} deg | ridge ${v.sh.toFixed(2)} | disk ${(100*v.disk).toFixed(1)} % | incidence ${v.incidence.toFixed(3)} | direct ${v.light.toFixed(2)} % | threshold ${v.available?'yes':'no'}`);
      lines.push(`  Earth alt/az ${r.e.toFixed(3)}/${r.ea.toFixed(2)} deg | ridge ${v.eh.toFixed(2)} | visible ${v.e?'yes':'no'} | phase ${phase.toFixed(1)} % | communication ${v.combined?'yes':'no'}`);
    }
    lines.push('','LOLA HORIZON PROFILE · 360 AZIMUTHS','Azimuth (deg) | apparent ridge elevation (deg)');for(let a=0;a<360;a++)lines.push(`${a} | ${Number(current.horizon[a]).toFixed(4)} deg`);
    lines.push('','METHODOLOGY AND LIMITATIONS','Ephemerides: JPL DE421 lunar vectors, sampled hourly in UTC.','Terrain: LOLA model and local terrain horizon calculated out to 100 km.','Earth visibility is a geometric line-of-sight proxy.','No radio link budget, data rate or hardware availability is simulated.','Direct illumination combines the LOLA horizon, apparent solar disk and incidence.');
    const safe=String(current.name).normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9_-]+/gi,'-').replace(/^-|-$/g,'')||'site',blob=new Blob([buildPdf(lines)],{type:'application/pdf'}),url=URL.createObjectURL(blob),anchor=document.createElement('a');anchor.href=url;anchor.download=`cest-lunaire-${safe}-${Math.abs(current.lat).toFixed(2)}${current.lat<0?'S':'N'}-${Math.abs(current.lon).toFixed(2)}${current.lon<0?'W':'E'}.pdf`;anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1500);
  }
  let operationsPlot=null;
  function drawOperations(){
    const canvas=$('#operationsChart');if(!canvas||!current?.series?.length)return;
    const box=canvas.getBoundingClientRect(),d=Math.min(devicePixelRatio||1,2),w=Math.max(1,box.width),h=Math.max(240,box.height||260);
    if(operationsPlot?.site===current && operationsPlot.w===w && operationsPlot.h===h && operationsPlot.d===d){
      updateOperationReadouts();
      return;
    }
    canvas.width=Math.round(w*d);canvas.height=Math.round(h*d);
    const ctx=canvas.getContext('2d');ctx.setTransform(d,0,0,d,0,0);ctx.clearRect(0,0,w,h);
    const x0=50,x1=w-12,plotTop=18,plotBottom=Math.min(142,h-105),plotH=plotBottom-plotTop;
    const values=[];for(let i=0;i<current.series.length;i++){const r=current.series[i],v=current.visibility[i];values.push(r.s,r.e,v.sh,v.eh)}
    let lo=Math.min(-2,...values),hi=Math.max(4,...values);lo=Math.floor(lo/5)*5;hi=Math.ceil(hi/5)*5;if(hi-lo<10){lo-=5;hi+=5}
    const y=value=>plotBottom-(value-lo)/(hi-lo)*plotH,cell=(x1-x0)/current.series.length,xx=i=>x0+i*cell;
    ctx.fillStyle='#000000';ctx.fillRect(x0,plotTop,x1-x0,plotH);
    const step=Math.max(2,Math.ceil((hi-lo)/5));
    for(let v=Math.ceil(lo/step)*step;v<=hi;v+=step){const py=y(v);ctx.strokeStyle=v===0?'#5c5545':'#252a39';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(x0,Math.round(py)+.5);ctx.lineTo(x1,Math.round(py)+.5);ctx.stroke();ctx.fillStyle='#82889a';ctx.font='9px Consolas,monospace';ctx.fillText(`${v}°`,8,py+3)}
    ctx.save();ctx.beginPath();ctx.rect(x0,plotTop,x1-x0,plotH);ctx.clip();
    for(let i=0;i<current.series.length;i++){
      const r=current.series[i],v=current.visibility[i],x=xx(i);
      if(v.light>0 && r.s>v.sh){ctx.fillStyle=`rgba(245,200,76,${.08+clamp(v.light/100,0,1)*.35})`;ctx.fillRect(x,y(r.s),cell,Math.max(1,y(v.sh)-y(r.s)))}
      if(v.e){ctx.fillStyle='rgba(240,93,108,.14)';ctx.fillRect(x,y(r.e),cell,Math.max(1,y(v.eh)-y(r.e)))}
    }
    const plotLine=(key,color,dash=[])=>{ctx.beginPath();current.series.forEach((r,i)=>i?ctx.lineTo(xx(i),y(r[key])):ctx.moveTo(xx(i),y(r[key])));ctx.strokeStyle=color;ctx.lineWidth=dash.length?1:1.8;ctx.setLineDash(dash);ctx.stroke();ctx.setLineDash([])};
    const horizonLine=(key,color)=>{ctx.beginPath();current.visibility.forEach((r,i)=>i?ctx.lineTo(xx(i),y(r[key])):ctx.moveTo(xx(i),y(r[key])));ctx.strokeStyle=color;ctx.lineWidth=1;ctx.setLineDash([3,4]);ctx.stroke();ctx.setLineDash([])};
    plotLine('s',METRIC_COLORS.sun);horizonLine('sh','rgba(245,200,76,.58)');plotLine('e',METRIC_COLORS.earth);horizonLine('eh','rgba(240,93,108,.58)');
    ctx.restore();
    const solar=current.solarFlags,earth=current.earthFlags,combined=current.combinedFlags;
    const bands=[{label:'SUN DIRECT',flags:solar,color:METRIC_COLORS.sun,alpha:.68},{label:'EARTH VISIBLE',flags:earth,color:METRIC_COLORS.earth,alpha:.82},{label:'INTERSECTION',flags:combined,color:METRIC_COLORS.both,alpha:1}];
    const bandTop=plotBottom+20,bandH=13,bandGap=9;
    for(let b=0;b<bands.length;b++){
      const band=bands[b],by=bandTop+b*(bandH+bandGap);
      ctx.fillStyle='#0a0a0a';ctx.fillRect(x0,by,x1-x0,bandH);
      ctx.fillStyle=band.color;ctx.globalAlpha=band.alpha;
      for(const span of windowsFor(band.flags)){
        ctx.fillRect(xx(span.start),by,(span.end-span.start+1)*cell,bandH);
      }
      ctx.globalAlpha=1;ctx.fillStyle='#8a90a2';ctx.font='8px Consolas,monospace';ctx.fillText(band.label,8,by+9);
    }
    canvas.dataset.plotLeft=String(x0);canvas.dataset.plotRight=String(x1);
    operationsPlot={site:current,w,h,d};
    updateOperationReadouts();
  }
  function updateOperationReadouts(){
    const solar=current.solarFlags,earth=current.earthFlags;
    const combinedWindows=current.combinedWindows,windowIndex=current.windowIndexAtHour[hour],nextWindowIndex=windowIndex>=0?windowIndex:combinedWindows.findIndex(v=>v.start>hour);
    const result=$('#operationResult');
    const longestIndex=current.longestWindowIndex;
    if(result)result.textContent=`TERRAIN: ${current.elevation?.toFixed(0)??'—'} m · Direct sunlight (≥10 %) : ${current.sunDirectPercent} % · Earth above ridges : ${current.earthVisiblePercent} % · Intersection : ${combinedWindows.length} window(s) · ${windowIndex>=0?'active':nextWindowIndex>=0?'next':'none'} : ${windowIndex>=0?current.windowLabels[windowIndex]:nextWindowIndex>=0?current.windowLabels[nextWindowIndex]:'no window'}${longestIndex>=0?` · longest : ${current.windowLabels[longestIndex]}`:''}`;
    const fullScreenState=$('#fullscreenBothCurrent'),fullScreenWindow=$('#fullscreenIntersectionWindow');
    const localRelief=$('#fullscreenReliefValue'),localLight=$('#fullscreenLightValue'),localLightDetail=$('#fullscreenLightDetail');
    const localSun=$('#fullscreenSunStatus');
    const selectedHour=current.series[hour],selectedVisibility=current.visibility[hour];
    const directLight=Math.round(directSunIllumination(selectedHour,selectedVisibility));
    if(localRelief)localRelief.textContent=`${current.elevation?.toFixed(0)??'—'} m`;
    if(localLight)localLight.textContent=`${directLight} %`;
    if(localLightDetail)localLightDetail.textContent=`Sun ${selectedHour.s>=0?'+':''}${selectedHour.s.toFixed(1)}° · ridge ${selectedVisibility.sh>=0?'+':''}${selectedVisibility.sh.toFixed(1)}° · incidence ${(Math.acos(selectedVisibility.incidenceCosine)*180/Math.PI).toFixed(0)}°`;
    setVisibilityStatus(localSun,Boolean(selectedVisibility.s),'HIDDEN');
    if(fullScreenState){
      const sunNow=solar[hour],earthNow=earth[hour];
      fullScreenState.textContent=sunNow&&earthNow?'Sufficient light · Earth visible':sunNow?'Sufficient light · Earth hidden':earthNow?'Earth visible · Sun below threshold':'Neither condition met';
    }
    if(fullScreenWindow)fullScreenWindow.textContent=windowIndex>=0?`Joint window in progress · ${current.windowLabels[windowIndex]}`:nextWindowIndex>=0?`Next window · ${current.windowLabels[nextWindowIndex]}`:'No joint window during the 30-day period';
  }
  function operationHourAt(event){
    const c=$('#operationsChart'),r=c.getBoundingClientRect(),left=Number(c.dataset.plotLeft||50),right=Number(c.dataset.plotRight||r.width-12),fraction=clamp((event.clientX-r.left-left)/(right-left),0,1);
    return Math.min(HOURS-1,Math.floor(fraction*HOURS));
  }
  function setHourFromOperationEvent(event){
    hour=operationHourAt(event);$('#timeSlider').value=String(hour);updateTime();
  }
  function updateTime(renderGraphs=true){
    window.CEST_CURIOUS?.update(current,hour,document.body.classList.contains('metrics-pending')?curiousCalculationStatus:'ready');
    if(document.body.classList.contains('metrics-pending')){
      const dateLabel=`${fmtDate(current.series[hour].t)} UTC`;
      $('#scrubDate').textContent=dateLabel;
      $('#timeSlider').setAttribute('aria-valuetext',dateLabel);
      const slider=$('#fullscreenTimeSlider');
      if(slider){slider.value=String(hour);slider.setAttribute('aria-valuetext',dateLabel)}
      const label=$('#fullscreenLightTime');if(label)label.textContent=dateLabel.replace(' 2026','');
      window.CEST_TERRAIN3D?.setTime(hour,null,undefined,undefined,null);
      return;
    }
    const row=current.series[hour],visible=current.visibility[hour].s,dateLabel=`${fmtDate(row.t)} UTC`;
    $('#scrubDate').textContent=dateLabel;
    $('#timeSlider').setAttribute('aria-valuetext',dateLabel);
    const fullscreenSlider=$('#fullscreenTimeSlider'),fullscreenTime=$('#fullscreenLightTime');
    if(fullscreenSlider){fullscreenSlider.value=String(hour);fullscreenSlider.setAttribute('aria-valuetext',dateLabel)}
    if(fullscreenTime)fullscreenTime.textContent=dateLabel.replace(' 2026','');
    $('#terrainIllumination').textContent=`SUN ${row.s>=0?'+':''}${row.s.toFixed(1)}° · ${visible?'ABOVE TERRAIN':'HIDDEN AT SITE'}`;
    const h=$('#chartHover');
    h.parentElement.style.setProperty('--timeline-position',`${hour/(HOURS-1)*100}%`);
    h.style.display='block';
    h.textContent=`Sun ${row.s.toFixed(1)}° · Earth ${row.e.toFixed(1)}°`;
    const light=current.visibility[hour],sunClear=Boolean(current.solarFlags[hour]),earthClear=Boolean(current.earthFlags[hour]),bothNow=Boolean(current.combinedFlags[hour]),lightValue=$('#fullscreenLightValue'),sunStatus=$('#fullscreenSunStatus'),bothStatus=$('#fullscreenBothCurrent');
    if(lightValue)lightValue.textContent=`${Math.round(directSunIllumination(row,light))} %`;
    setVisibilityStatus(sunStatus,Boolean(light.s),'HIDDEN');
    if(bothStatus)bothStatus.textContent=bothNow?'Sufficient light · Earth visible':sunClear?'Sufficient light · Earth hidden':earthClear?'Earth visible · Sun below threshold':'Neither condition met';
    const windowIndex=current.windowIndexAtHour[hour],nextWindowIndex=windowIndex>=0?windowIndex:current.combinedWindows.findIndex(window=>window.start>hour),windowBadge=$('#timelineIntersectionBadge'),windowCount=$('#timelineIntersectionCount'),windowText=$('#fullscreenIntersectionWindow');
    if(windowBadge)windowBadge.classList.toggle('is-active',windowIndex>=0);
    if(windowCount)windowCount.textContent=`${current.combinedWindows.length} window${current.combinedWindows.length>1?'s':''}`;
    if(windowText)windowText.textContent=windowIndex>=0?`Joint window in progress · ${current.windowLabels[windowIndex]}`:nextWindowIndex>=0?`Next window · ${current.windowLabels[nextWindowIndex]}`:'No joint window during the 30-day period';
    const operationResult=$('#operationResult'),longestIndex=current.longestWindowIndex;
    if(operationResult)operationResult.textContent=`TERRAIN: ${current.elevation?.toFixed(0)??'—'} m · Direct sunlight (≥10 %) : ${current.sunDirectPercent} % · Earth visible : ${current.earthVisiblePercent} % · Intersection : ${current.combinedWindows.length} window(s) · ${windowIndex>=0?'active':nextWindowIndex>=0?'next':'none'} : ${windowIndex>=0?current.windowLabels[windowIndex]:nextWindowIndex>=0?current.windowLabels[nextWindowIndex]:'no window'}${longestIndex>=0?` · longest : ${current.windowLabels[longestIndex]}`:''}`;
    if(renderGraphs){drawTimeline();drawOperations()}
    const timelineCursor=$('#timelineCursor'),operationsCursor=$('#operationsCursor');
    if(timelineCursor)timelineCursor.style.left=`${hour/(HOURS-1)*100}%`;
    document.querySelectorAll('.fullscreen-graph-cursor').forEach(cursor=>cursor.style.left=`${hour/(HOURS-1)*100}%`);
    const commsCanvas=$('#fullscreenCommsChart'),commsCursor=commsCanvas?.parentElement?.querySelector('.fullscreen-graph-cursor');
    if(commsCanvas&&commsCursor){const box=commsCanvas.getBoundingClientRect(),left=Number(commsCanvas.dataset.plotLeft||0),right=Number(commsCanvas.dataset.plotRight||box.width);commsCursor.style.left=`${(left+(right-left)*hour/(HOURS-1))/Math.max(1,box.width)*100}%`}
    updateFullscreenCommsSummary();
    if(operationsCursor){const chart=$('#operationsChart'),box=chart.getBoundingClientRect(),left=Number(chart.dataset.plotLeft||50),right=Number(chart.dataset.plotRight||box.width-12);operationsCursor.style.left=`${(left+(right-left)*hour/(HOURS-1))/Math.max(1,box.width)*100}%`}
    window.CEST_TERRAIN3D?.setTime(hour,row,current.lat,current.lon,current.visibility[hour]);
  }
  function setCurrent(next){$select.value=byId.has(next.id)?next.id:next.id==='custom'?'custom':'';if(heightPixels)calculatePoint(next.lat,next.lon,next.name,false,next.id);else{current=next;prepareIntervals(current);refreshInfo();window.CEST_TERRAIN3D?.setSite(next.lat,next.lon,next.name)}}
  window.CEST_APP_SET_HEIGHTMAP=(canvas,pixels)=>{heightCanvas=canvas;heightPixels=pixels;calculationCache.clear();horizonRayCache=null;for(const s of sourceSites){if(s.demId&&s.demId===window.CEST_TILED_DEM?.metadata?.id)continue;const p=projection(s.lat,s.lon);s.elevation=window.CEST_TILED_DEM?.ready?window.CEST_TILED_DEM.sampleMetersWorld(p.x*1000,p.north*1000):heightMeters(s.lat,s.lon);}calculatePoint(current.lat,current.lon,current.name,true,current.id)};
  function chooseSite(s){setCurrent(s)}
  async function chooseCatalogue(feature){await calculatePoint(feature.lat,feature.lon,feature.name,false,`usgs:${feature.id}`)}
  $select.addEventListener('change',()=>{const v=$select.value;if(byId.has(v))chooseSite(byId.get(v));else if(v.startsWith('usgs:')){const f=D.catalogue.find(x=>x.id===v.slice(5));if(f)chooseCatalogue(f)}});
  $('#coordinateForm').addEventListener('submit',e=>{e.preventDefault();const value=$('#coordinateSearch').value.replace(/−/g,'-'),nums=value.match(/[+-]?(?:\d+\.?\d*|\.\d+)/g);if(!nums||nums.length!==2){showToast('Enter latitude and longitude, for example −89.70, 129.78.');return}const lat=Number(nums[0]),lon=Number(nums[1]);if(!Number.isFinite(lat)||!Number.isFinite(lon)||lat< -90||lat> -80||lon< -180||lon>180){showToast('Search covers the LOLA South Pole from 90°S to 80°S and longitudes 180°W to 180°E.');return}const name=`Coordinates ${latLabel(lat)}, ${lonLabel(lon)}`;calculatePoint(lat,lon,name)});
  function showToast(msg){const t=$('#toast');t.textContent=msg;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),3200)}
  $('#timeSlider').addEventListener('input',e=>{hour=Number(e.target.value);updateTime(false)});
  $('#timeSlider').addEventListener('change',()=>updateTime(true));
  $('#fullscreenTimeSlider')?.addEventListener('input',e=>{hour=Number(e.target.value);$('#timeSlider').value=String(hour);updateTime(false)});
  $('#fullscreenTimeSlider')?.addEventListener('change',()=>updateTime(true));
  document.querySelectorAll('.metric').forEach(b=>b.addEventListener('click',()=>{document.querySelectorAll('.metric').forEach(button=>{const active=button===b;button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active))});metric=b.dataset.metric;updateTime()}));
  function transitionMode(next){
    if(next==='research')next='teacher';
    if(!validModes.includes(next)||(next===mode&&!window.CEST_MODE_LAYOUT?.busy))return;
    document.querySelectorAll('.mode').forEach(button=>{const active=button.dataset.mode===next;button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active))});
    clearTimeout(modeTransitionTimer);
    const commit=()=>{
      mode=next;document.body.dataset.expertiseMode=mode;
      document.body.classList.remove('mode-public','mode-teacher','mode-research','mode-shifting');document.body.classList.add(`mode-${mode}`);
      window.CEST_TERRAIN3D?.setMode(mode);window.CEST_PROFILE_SET_MODE?.(mode);refreshInfo();
    };
    if(window.CEST_MODE_LAYOUT)window.CEST_MODE_LAYOUT.transition(next,commit);
    else commit();
  }
  document.querySelectorAll('.mode').forEach(button=>button.addEventListener('click',()=>transitionMode(button.dataset.mode)));
  document.addEventListener('cest:modechange',event=>transitionMode(event.detail?.mode));
  window.CEST_METRICS_PENDING=markMetricsPending;
  window.CEST_RECALCULATE_POSITION=(lat,lon)=>{markMetricsPending();const n=`Position ${latLabel(lat)}, ${lonLabel(lon)}`;calculatePoint(lat,lon,n,true)};
  window.CEST_SELECT_MAP_SITE=site=>calculatePoint(site.lat,site.lon,site.name,true,sourceSites.some(item=>item.id===site.id)?site.id:site.scan?'custom':`usgs:${site.id}`);
  window.CEST_SELECT_2D_POINT=(lat,lon,name)=>calculatePoint(lat,lon,name,true);
  window.CEST_SELECT_SITE_COORDINATES=(lat,lon,name)=>calculatePoint(lat,lon,name,false,'custom');
  window.CEST_SYNC_TERRAIN=()=>window.CEST_TERRAIN3D?.setTime(hour,current.series[hour],current.lat,current.lon,current.visibility[hour]);
  $('#scanEarthZonesButton')?.addEventListener('click',scanEarthZones);
  $('#exportPositionPdf')?.addEventListener('click',exportPositionPdf);
  $('#exportCsv').addEventListener('click',()=>{
    const header='time_utc,sun_elevation_deg,sun_azimuth_deg,sun_horizon_deg,sun_visible,earth_elevation_deg,earth_azimuth_deg,earth_horizon_deg,earth_visible,visible_solar_disk_fraction,incidence_cosine,direct_illumination_pct,direct_sunlight_10pct,communication_overlap';
    const lines=current.series.map((row,index)=>{
      const visibility=current.visibility[index];
      return [row.t,row.s,row.sa,visibility.sh,visibility.s,row.e,row.ea,visibility.eh,visibility.e,visibility.disk,visibility.incidence,visibility.light,visibility.available,visibility.combined].join(',');
    });
    const safeId=String(current.id).replace(/[^a-z0-9._-]/gi,'-'),hemisphere=current.lon<0?'W':'E';
    const blob=new Blob(['\uFEFF',header+'\n',lines.join('\n'),'\n'],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');
    a.href=url;a.download=`cest-lunaire-${safeId}-${Math.abs(current.lat).toFixed(2)}S-${Math.abs(current.lon).toFixed(2)}${hemisphere}.csv`;
    a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  });
  const modal = $('#modal');
  const closeModalButton = $('#closeModal');
  let modalReturnFocus = null;
  const openModal = () => {
    modalReturnFocus = document.activeElement;
    modal.classList.add('open');
    closeModalButton.focus();
  };
  const closeModal = () => {
    if (!modal.classList.contains('open')) return;
    modal.classList.remove('open');
    modalReturnFocus?.focus?.();
  };
  $('#aboutBtn').addEventListener('click', openModal);
  $('#methodBtn').addEventListener('click', openModal);
  closeModalButton.addEventListener('click', closeModal);
  modal.addEventListener('click', e => { if (e.target === modal) closeModal(); });
  document.addEventListener('keydown', e => {
    if (!modal.classList.contains('open')) return;
    if (e.key === 'Escape') closeModal();
    if (e.key === 'Tab') {
      const focusables = [...modal.querySelectorAll('button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter(el => !el.disabled);
      if (!focusables.length) return;
      const first = focusables[0], last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });
  document.querySelectorAll('[data-nav]').forEach(b=>b.addEventListener('click',()=>{document.querySelector('.nav-item.active')?.classList.remove('active');b.classList.add('active');const map={explore:'.hero',sites:'.insight-panel',light:'.timeline-panel',method:'.lower-grid'};document.querySelector(map[b.dataset.nav])?.scrollIntoView({behavior:'smooth',block:'center'})}));
  document.addEventListener('lunar:themechange',()=>requestAnimationFrame(()=>{drawTimeline();drawHorizon();drawOperations();drawFullscreenCharts()}));
  const operationsChart=$('#operationsChart');operationsChart?.addEventListener('pointermove',e=>{const i=operationHourAt(e),r=current.series[i],v=current.visibility[i],tip=$('#operationsHover'),rect=operationsChart.getBoundingClientRect();tip.style.display='block';tip.style.left=`${clamp(e.clientX-rect.left+12,8,rect.width-210)}px`;tip.style.top='8px';tip.textContent=`${fmtDate(r.t)} UTC · ☼ ${r.s.toFixed(1)}° / ridge ${v.sh.toFixed(1)}° · Earth ${r.e.toFixed(1)}° / ridge ${v.eh.toFixed(1)}°`;});operationsChart?.addEventListener('pointerleave',()=>{$('#operationsHover').style.display='none'});operationsChart?.addEventListener('click',setHourFromOperationEvent);
  window.addEventListener('resize',()=>{drawTimeline();drawHorizon();drawOperations();drawFullscreenCharts()});
  document.addEventListener('cest:fullscreenchange',()=>requestAnimationFrame(()=>requestAnimationFrame(drawFullscreenCharts)));
  const timelineCursor=document.createElement('i');timelineCursor.id='timelineCursor';timelineCursor.setAttribute('aria-hidden','true');$('#timeline').parentElement.append(timelineCursor);
  const operationsCursor=document.createElement('i');operationsCursor.id='operationsCursor';operationsCursor.setAttribute('aria-hidden','true');$('#operationsChart').parentElement.append(operationsCursor);
  document.body.classList.remove('mode-public','mode-teacher','mode-research');document.body.classList.add(`mode-${mode}`);
  document.querySelectorAll('.mode').forEach(button=>{const active=button.dataset.mode===mode;button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active))});
  prepareIntervals(current);refreshInfo();
})();