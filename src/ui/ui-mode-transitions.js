/* Mode changes: fade out education -> resize; resize -> fade in education. */
(() => {
  const workspace=document.querySelector('.workspace'),education=document.querySelector('#curiousPanel');
  if(!workspace||!education)return;
  const reduce=matchMedia('(prefers-reduced-motion: reduce)');
  const curve=getComputedStyle(document.documentElement).getPropertyValue('--ease-out').trim()||'cubic-bezier(0.23, 1, 0.32, 1)';
  let generation=0,busy=false;const animations=new Set();
  const panels=[...workspace.querySelectorAll(':scope > .globe-panel,:scope > .insight-panel,:scope > .curious-panel')];
  function clean(){
    workspace.style.removeProperty('height');workspace.style.removeProperty('overflow');
    education.style.removeProperty('opacity');education.inert=false;
    document.body.classList.remove('mode-layout-running');
  }
  function cancel(){animations.forEach(a=>a.cancel());animations.clear();}
  async function play(element,frames,duration){
    if(!element.animate)return;
    const animation=element.animate(frames,{duration,easing:curve,fill:'both'});animations.add(animation);
    try{await animation.finished;}catch(_){}finally{animations.delete(animation);animation.cancel();}
  }
  async function transition(next,commit){
    const token=++generation;
    // Preserve the current interpolated geometry when the user reverses midway.
    const initial={columns:getComputedStyle(workspace).gridTemplateColumns,height:workspace.getBoundingClientRect().height,opacity:getComputedStyle(education).opacity};
    cancel();clean();busy=true;
    const immediate=reduce.matches||document.body.classList.contains('welcome-active')||document.body.classList.contains('terrain-fullscreen');
    if(immediate){commit();busy=false;return;}
    window.CEST_UI_MOTION?.settle([...panels,...workspace.querySelectorAll('#fullscreenDataContent')]);
    panels.forEach(panel=>panel.getAnimations?.().forEach(animation=>{try{animation.finish();}catch(_){animation.cancel();}}));
    document.body.classList.add('mode-layout-running');
    const leaving=next==='teacher'&&getComputedStyle(education).display!=='none';
    if(leaving){
      education.inert=true;education.style.opacity=initial.opacity;
      await play(education,[{opacity:initial.opacity},{opacity:0}],400);
      if(token!==generation)return;
      education.style.opacity='0';
    }
    if(token!==generation)return;
    // Commit scientific/UI mode exactly once. The following animation only changes layout.
    commit();
    if(next==='public'){education.style.opacity='0';education.inert=true;}
    workspace.style.removeProperty('height');
    const target={columns:getComputedStyle(workspace).gridTemplateColumns,height:workspace.getBoundingClientRect().height};
    workspace.style.height=`${initial.height}px`;workspace.style.overflow='hidden';
    await play(workspace,[{gridTemplateColumns:initial.columns,height:`${initial.height}px`},{gridTemplateColumns:target.columns,height:`${target.height}px`}],1000);
    if(token!==generation)return;
    workspace.style.removeProperty('height');workspace.style.removeProperty('overflow');
    if(next==='public'){
      await play(education,[{opacity:0},{opacity:1}],400);
      if(token!==generation)return;
    }
    clean();busy=false;
    window.dispatchEvent(new Event('resize'));
  }
  window.CEST_MODE_LAYOUT={transition,get busy(){return busy;}};
})();
