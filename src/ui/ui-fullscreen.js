(() => {
  const toggle = document.getElementById('fullscreenToggle');
  const dataToggle = document.getElementById('fullscreenDataToggle');
  const dataContent = document.getElementById('fullscreenDataContent');
  if (!toggle) return;
  const dataPanel=dataContent?.closest('.insight-panel');
  let collapseRun=0;const collapseAnimations=new Set();
  function cancelCollapse(){collapseAnimations.forEach(a=>a.cancel());collapseAnimations.clear();}
  function clearCollapseStyles(){
    dataPanel?.style.removeProperty('height');dataPanel?.style.removeProperty('overflow');if(dataPanel)delete dataPanel.dataset.collapseMotion;
    dataContent?.style.removeProperty('opacity');if(dataContent)dataContent.inert=false;
  }
  async function tween(element,frames,duration){
    if(!duration||!element?.animate)return;
    const animation=element.animate(frames,{duration,easing:'cubic-bezier(0.23, 1, 0.32, 1)',fill:'both'});
    collapseAnimations.add(animation);
    try{await animation.finished;}catch(_){}finally{collapseAnimations.delete(animation);animation.cancel();}
  }
  async function setDataExpanded(expand){
    const run=++collapseRun;
    const from=dataPanel?.getBoundingClientRect().height||0;
    const opacity=dataContent?getComputedStyle(dataContent).opacity:'1';
    cancelCollapse();
    window.CEST_UI_MOTION?.settle([dataContent]);
    dataToggle.setAttribute('aria-expanded',String(expand));dataToggle.textContent=expand?'Collapse −':'Data +';
    const immediate=matchMedia('(prefers-reduced-motion: reduce)').matches||document.documentElement.dataset.motionInput==='keyboard';
    if(!dataPanel||immediate){
      dataContent.hidden=!expand;document.body.classList.toggle('fullscreen-data-collapsed',!expand);clearCollapseStyles();return;
    }
    // Lock the outer box before changing content visibility or its collapsed height limit.
    dataPanel.dataset.collapseMotion='running';
    dataPanel.style.height=`${from}px`;dataPanel.style.overflow='hidden';
    if(!expand&&!dataContent.hidden){
      dataContent.inert=true;
      await tween(dataContent,[{opacity},{opacity:0}],200);
      if(run!==collapseRun)return;
    }
    dataContent.hidden=!expand;document.body.classList.toggle('fullscreen-data-collapsed',!expand);
    dataContent.style.opacity=expand?'0':'1';
    dataPanel.style.removeProperty('height');
    const to=dataPanel.getBoundingClientRect().height;
    dataPanel.style.height=`${from}px`;
    await tween(dataPanel,[{height:`${from}px`},{height:`${to}px`}],400);
    if(run!==collapseRun)return;
    if(expand){
      await tween(dataContent,[{opacity:0},{opacity:1}],200);
      if(run!==collapseRun)return;
    }
    clearCollapseStyles();
  }
  let fallbackActive = false;
  let entranceTimer = 0;
  const active = () => Boolean(fallbackActive || document.fullscreenElement === document.documentElement || document.webkitFullscreenElement === document.documentElement);
  const update = () => {
    const on = active();
    const wasOn = document.body.classList.contains('terrain-fullscreen');
    document.body.classList.toggle('terrain-fullscreen', on);
    if (on && !wasOn) {
      clearTimeout(entranceTimer);
      document.body.classList.add('fullscreen-entering');
      entranceTimer = setTimeout(() => document.body.classList.remove('fullscreen-entering'), 1100);
    } else if (!on) {
      clearTimeout(entranceTimer);
      entranceTimer = 0;
      document.body.classList.remove('fullscreen-entering');
    }
    if (!on && dataContent) { ++collapseRun;cancelCollapse();clearCollapseStyles();dataContent.hidden = false; document.body.classList.remove('fullscreen-data-collapsed'); dataToggle?.setAttribute('aria-expanded', 'true'); if (dataToggle) dataToggle.textContent = 'Collapse −'; }
    toggle.setAttribute('aria-label', on ? 'Exit full screen' : 'View terrain in full screen');
    toggle.title = on ? 'Exit full screen' : 'Full-screen terrain';
    const label = toggle.querySelector('span');
    if (label) label.textContent = on ? 'Exit' : 'Full screen';
    toggle.classList.toggle('is-active', on);
    document.dispatchEvent(new CustomEvent('cest:fullscreenchange', { detail: { active: on } }));
  };
  toggle.addEventListener('click', async () => {
    try {
      if (active()) {
        if (fallbackActive) fallbackActive = false;
        else if (document.exitFullscreen) await document.exitFullscreen();
        else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
        else fallbackActive = false;
      } else if (document.documentElement.requestFullscreen) {
        await document.documentElement.requestFullscreen();
      } else if (document.documentElement.webkitRequestFullscreen) {
        document.documentElement.webkitRequestFullscreen();
      } else {
        fallbackActive = !fallbackActive;
      }
    } catch {
      const toast = document.getElementById('toast');
      fallbackActive = !active();
      update();
      if (toast) { toast.textContent = fallbackActive ? 'Expanded view enabled; system full screen unavailable.' : 'The browser refused full screen.'; toast.classList.add('show'); }
    }
    update();
  });
  document.addEventListener('fullscreenchange', update);
  document.addEventListener('webkitfullscreenchange', update);
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && fallbackActive) { fallbackActive = false; update(); }
  });
  dataToggle?.addEventListener('click',()=>setDataExpanded(dataToggle.getAttribute('aria-expanded')!=='true'));
  update();
})();
