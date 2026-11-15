/* First appearance: introductory text, then windows, then their data. */
(() => {
  'use strict';
  const root=document.documentElement,reduce=matchMedia('(prefers-reduced-motion: reduce)');
  root.dataset.motionInput='pointer';
  window.addEventListener('pointerdown',()=>{root.dataset.motionInput='pointer';},true);
  window.addEventListener('keydown',()=>{root.dataset.motionInput='keyboard';},true);
  const seen=new WeakSet(),running=new Map(),kinds=new WeakMap(),panelEnds=new WeakMap();
  let mainRegistered=false,mainRevealAt=0;
  const tokens=getComputedStyle(root);
  const curve=tokens.getPropertyValue('--ease-out').trim()||'cubic-bezier(0.23, 1, 0.32, 1)';
  const ms=(name,fallback)=>{const value=parseFloat(tokens.getPropertyValue(name));return Number.isFinite(value)?value:fallback;};
  const textDuration=ms('--motion-text',600),surfaceDuration=ms('--motion-surface',600),stagger=ms('--motion-stagger',80);
  const windowDuration=ms('--motion-window',1000),dataDuration=ms('--motion-data',600);
  const introSpan=textDuration+3*stagger+80;
  function reveal(element,index=0){
    if(seen.has(element))return;seen.add(element);
    if(typeof element.animate!=='function')return;
    const kind=kinds.get(element)||'text',now=performance.now();
    let start=now,duration=textDuration;
    if(element.closest('.app-shell')){
      if(kind==='window'){start=Math.max(now,mainRevealAt+introSpan);duration=windowDuration;panelEnds.set(element,start+duration);}
      else if(kind==='data'){start=Math.max(now,mainRevealAt+introSpan+windowDuration+80,(panelEnds.get(element.closest('.panel'))||0)+80);duration=dataDuration;}
      else start=Math.max(now,mainRevealAt)+(index%4)*stagger;
    }else start+=(index%4)*stagger;
    const opacityOnly=reduce.matches||kind==='window'||kind==='data';
    const frames=opacityOnly?[{opacity:0},{opacity:1}]:[{opacity:0,transform:'translateY(8px)'},{opacity:1,transform:'translateY(0)'}];
    const animation=element.animate(frames,{duration:reduce.matches?160:duration,delay:reduce.matches?0:start-now,easing:curve,fill:'backwards'});
    running.set(element,animation);
    animation.finished.then(()=>{if(running.get(element)===animation){running.delete(element);animation.cancel();}},()=>{if(running.get(element)===animation)running.delete(element);});
  }
  const observer=typeof IntersectionObserver==='function'?new IntersectionObserver(entries=>{
    const rank={text:0,window:1,data:2};
    [...entries].sort((a,b)=>(rank[kinds.get(a.target)||'text']-rank[kinds.get(b.target)||'text'])).forEach((entry,index)=>{
      if(!entry.isIntersecting)return;observer.unobserve(entry.target);reveal(entry.target,index);
    });
  },{threshold:.05}):null;
  function register(selector,kind='text'){
    document.querySelectorAll(selector).forEach((element,index)=>{
      if(seen.has(element))return;kinds.set(element,kind);
      if(observer)observer.observe(element);else reveal(element,index);
    });
  }
  function sync(){
    if(!document.body.classList.contains('welcome-active')&&!mainRegistered){
      mainRegistered=true;
      mainRevealAt=performance.now()+(root.dataset.motionInput==='keyboard'?0:reduce.matches?160:surfaceDuration);
      register('.hero .eyebrow,.hero h1,.hero-copy,.audience-label');
      register('.workspace > .globe-panel,.workspace > .insight-panel,.workspace > .curious-panel,.timeline-panel,.operations-panel,.lower-grid > .panel','window');
      register('#fullscreenDataContent,.timeline-chart,.time-scrub,#operationsChart,.horizon-chart,.model-facts','data');
    }
    const hello=document.getElementById('helloCard');
    if(hello&&!hello.hidden)register('#helloName,.hello-signal');
  }
  register('.welcome-kicker,.welcome-card h1,.welcome-copy');sync();
  new MutationObserver(sync).observe(document.body,{attributes:true,attributeFilter:['class']});
  // A user-requested mode transition owns its surfaces; cancel any deferred first-load reveal there.
  window.CEST_UI_MOTION={settle(elements){
    elements.forEach(element=>{
      seen.add(element);observer?.unobserve(element);
      const animation=running.get(element);if(animation){running.delete(element);animation.cancel();}
    });
  }};
  reduce.addEventListener('change',()=>{if(reduce.matches){running.forEach(animation=>animation.cancel());running.clear();}});
})();
