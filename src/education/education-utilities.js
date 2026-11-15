/** Educational presentation utilities. No astronomical calculations. */
(function (root) {
  'use strict';
  const STEP = 3600000;
  const TRACKS = [{key:'s',label:'Sun visible',color:'#F5C84C'}, {key:'e',label:'Earth visible',color:'#F05D6C'}, {key:'combined',label:'Favorable window',color:'#4AD295'}];
  /** @param {Array<{t:string}>} series @param {Array<object>} visibility */
  function intervals(series, visibility, key) {
    const runs=[];
    series.forEach((row,i)=>{
      const time=Date.parse(row?.t), raw=visibility?.[i]?.[key];
      const state=Number.isFinite(time)&&(raw===0||raw===1||typeof raw==='boolean')?Boolean(raw):null;
      const last=runs[runs.length-1];
      if(last&&last.state===state&&time===last.endTime){last.end=i;last.endTime=time+STEP;last.hours++;}
      else runs.push({start:i,end:i,startTime:time,endTime:time+STEP,hours:1,state});
    });
    return runs;
  }
  function derive(site) {
    const series=site?.series||[],visibility=site?.visibility||[];
    return TRACKS.map(track=>({...track,runs:intervals(series,visibility,track.key)}));
  }
  function fact(site,hour) {
    const v=site?.visibility?.[hour],stats=site?.stats;
    if(!stats||!v)return 'Near the lunar South Pole, the Sun stays low on the horizon. Terrain creates long shadows.';
    if(stats.sun===0)return 'No visible Sun during this period does not establish permanent shadow: other seasons must be studied. Some polar craters may preserve ice, but that does not establish its presence here.';
    if(!v.e)return 'When terrain hides Earth, the direct radio path is blocked. A relay satellite may offer another path, depending on its own visibility.';
    if(v.s&&!v.available)return 'Seeing the Sun is not enough: grazing light or a partly hidden disk may provide little direct illumination on a slope.';
    if(stats.sun>=70)return 'Some polar ridges remain lit for long periods, which helps solar power. This simulation covers a limited period, not the whole year.';
    if(Number.isFinite(site.elevation)&&site.elevation<0)return 'An elevation below the lunar reference level does not establish darkness: ridges around the observer matter too.';
    return 'Near the lunar South Pole, sunlight grazes the horizon. A ridge can hide a celestial body and cast a very long shadow.';
  }
  const api={TRACKS,intervals,derive,fact};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  else root.CEST_CURIOUS_UTILS=api;
})(typeof window!=='undefined'?window:globalThis);