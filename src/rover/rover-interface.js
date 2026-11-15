(() => {
  'use strict';
  const stage=document.querySelector('.terrain-stage');
  const logos=[...document.querySelectorAll('[data-rover-trigger]')];
  if(!stage||!logos.length)return;
  const game=document.createElement('section');
  game.className='lunar-rover';game.hidden=true;game.tabIndex=0;
  game.setAttribute('role','region');game.setAttribute('aria-label','Lunar mini rover');game.setAttribute('aria-describedby','roverInstructions');
  game.innerHTML=`<div class="lunar-rover__top"><span class="lunar-rover__message" role="status" aria-live="polite"></span><button type="button" data-rover-close aria-label="Close the 3D rover">×</button></div>
    <p id="roverInstructions">↑ ↓ / W S Drive · ← → / A D Turn · Space: jump · Escape: close <small>3D rover mini-game · 20 m/s · play radius : 20 km · simulation unchanged</small></p><p class="lunar-rover__telemetry" aria-live="off">Distance traveled : 0 m</p><div class="lunar-rover__buttons"><button type="button" data-rover-drive="left" aria-label="Turn left">↶</button><button type="button" data-rover-drive="forward" aria-label="Move forward">↑</button><button type="button" data-rover-drive="back" aria-label="Move backward">↓</button><button type="button" data-rover-drive="right" aria-label="Turn right">↷</button><button type="button" data-rover-hop>Jump</button></div>`;
  stage.append(game);
  const message=game.querySelector('.lunar-rover__message');
  const telemetry=game.querySelector('.lunar-rover__telemetry');
  const rover=()=>window.CEST_TERRAIN3D?.rover;
  const motion=matchMedia('(prefers-reduced-motion: reduce)');
  new ResizeObserver(entries=>{
    const height=entries[0]?.borderBoxSize?.[0]?.blockSize||game.getBoundingClientRect().height;
    document.body.style.setProperty('--rover-bar-height',`${Math.ceil(height)}px`);
  }).observe(game);
  let activations=[],active=false,returnTo=null,queued=null,frame=0,last=0,toastTimer=0,was2D=false;
  let held=new Set(),touch=new Map(),focused=false;
  const editable=el=>Boolean(el?.closest?.('input,textarea,select,[contenteditable]:not([contenteditable="false"])'));
  const ownsFocus=()=>active&&game.contains(document.activeElement)&&!editable(document.activeElement);
  function suspend(on){
    on=active; // Terrain navigation stays suspended for the entire rover session.
    if(focused===on)return;focused=on;
    document.dispatchEvent(new CustomEvent('cest:roverfocus',{detail:{active:on}}));
  }
  function stop(){if(frame)cancelAnimationFrame(frame);frame=0;last=0;rover()?.pause();}
  function clear(){held.clear();touch.clear();stop();}
  function controls(){
    const values=[...touch.values()];
    const aliases={ArrowUp:'w',ArrowDown:'s',ArrowLeft:'a',ArrowRight:'d'};
    const down=(key,name)=>held.has(key)||held.has(aliases[key])||values.includes(name);
    return {drive:Number(down('ArrowUp','forward'))-Number(down('ArrowDown','back')),steer:Number(down('ArrowRight','right'))-Number(down('ArrowLeft','left'))};
  }
  function schedule(){if(active&&ownsFocus()&&!document.hidden&&!frame)frame=requestAnimationFrame(tick);}
  function tick(now){
    frame=0;if(!active||!ownsFocus()||document.hidden){stop();return;}
    const dt=last?Math.min((now-last)/1000,.04):0;last=now;
    const {drive,steer}=controls();
    const moving=rover()?.step(dt,drive,steer);
    const status=rover()?.status();
    if(telemetry&&status){const text=`Distance traveled : ${Math.round(status.traveled)} m · ${Math.round(status.speed||0)} m/s${status.atBoundary?' · Boundary reached: reverse or turn.':''}`;if(telemetry.textContent!==text)telemetry.textContent=text;}
    if(moving)schedule();else stop();
  }
  function hop(){if(!motion.matches){rover()?.hop();schedule();}else message.textContent='A little hop!';}
  function focusState(){
    const on=ownsFocus();suspend(on);
    if(on){if(document.pointerLockElement)document.exitPointerLock?.();schedule();}
    else clear();
  }
  function open(trigger){
    if(document.body.classList.contains('welcome-active')){queued=trigger;return;}
    if(active){game.focus({preventScroll:true});return;}
    if(!rover()){
      queued=trigger;
      const toast=document.querySelector('#toast');
      if(toast){toast.textContent='The rover will arrive once the 3D terrain has loaded…';toast.classList.add('show');setTimeout(()=>toast.classList.remove('show'),3500);}
      return;
    }
    was2D=document.body.classList.contains('terrain-2d-mode');
    if(was2D)window.CEST_TERRAIN3D.set2DMode(false,false);
    if(!rover().open()){
      if(was2D)window.CEST_TERRAIN3D.set2DMode(true,false);
      const toast=document.querySelector('#toast');
      if(toast){toast.textContent='Rover unavailable here. Choose an area of the loaded polar terrain.';toast.classList.add('show');setTimeout(()=>toast.classList.remove('show'),4000);}
      return;
    }
    rover().setReducedMotion(motion.matches);
    returnTo=trigger;active=true;game.hidden=false;document.body.classList.add('lunar-rover-open');
    message.textContent='Houston, we are having fun.';
    if(telemetry)telemetry.textContent='Distance traveled : 0 m';
    clearTimeout(toastTimer);toastTimer=setTimeout(()=>{message.textContent='3D exploration';},3200);
    game.focus({preventScroll:false});focusState();
  }
  function close(){
    if(!active)return;active=false;queued=null;clear();clearTimeout(toastTimer);rover()?.close();suspend(false);
    game.hidden=true;document.body.classList.remove('lunar-rover-open');document.body.style.removeProperty('--rover-bar-height');
    if(was2D)window.CEST_TERRAIN3D?.set2DMode(true,false);
    const target=returnTo?.getClientRects().length?returnTo:document.querySelector('.rover-logo');
    target?.focus({preventScroll:true});
  }
  function activate(trigger){
    const now=performance.now();activations=activations.filter(time=>now-time<=3000);activations.push(now);
    if(activations.length>=5){activations=[];setTimeout(()=>open(trigger),0);}
  }
  logos.forEach(logo=>{
    // Preserve normal anchor navigation, including modified clicks.
    logo.addEventListener('click',event=>{if(!event.ctrlKey&&!event.metaKey&&!event.altKey&&!event.shiftKey)activate(logo);});
    logo.addEventListener('keydown',event=>{if(event.key===' '&&!event.repeat){event.preventDefault();logo.click();}});
  });
  game.querySelector('[data-rover-close]').addEventListener('click',close);
  stage.addEventListener('pointerdown',event=>{
    if(!active||!event.target?.closest?.('canvas'))return;
    event.preventDefault();event.stopImmediatePropagation();
    game.focus({preventScroll:true});focusState();
  },true);
  game.addEventListener('focusin',focusState);
  game.addEventListener('focusout',()=>queueMicrotask(focusState));
  // Capture before terrain/document shortcuts. Tab is left untouched.
  window.addEventListener('keydown',event=>{
    if(!ownsFocus()||editable(event.target))return;
    if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown',' ','Escape','w','a','s','d','W','A','S','D','Shift'].includes(event.key)){
      event.preventDefault();event.stopImmediatePropagation();
      if(event.key==='Escape'){close();return;}
      if(event.key===' '&&!event.repeat)hop();
      const key=event.key.length===1?event.key.toLowerCase():event.key;
      if(key.startsWith('Arrow')||key==='Shift'||['w','a','s','d'].includes(key)){held.add(key);schedule();}
    }
  },true);
  window.addEventListener('keyup',event=>{
    const wasHeld=held.delete(event.key.length===1?event.key.toLowerCase():event.key);
    if(ownsFocus()&&!editable(event.target)&&(wasHeld||event.key===' ')){event.preventDefault();event.stopImmediatePropagation();}
  },true);
  game.querySelectorAll('[data-rover-drive]').forEach(button=>{
    button.addEventListener('pointerdown',event=>{
      if(event.button!==0)return;event.preventDefault();button.focus();touch.set(event.pointerId,button.dataset.roverDrive);button.setPointerCapture?.(event.pointerId);schedule();
    });
    for(const name of ['pointerup','pointercancel','lostpointercapture'])button.addEventListener(name,event=>touch.delete(event.pointerId));
    // Keyboard and assistive-technology click: a short nudge.
    button.addEventListener('click',event=>{if(event.detail===0){const action=button.dataset.roverDrive;rover()?.step(.04,action==='forward'?1:action==='back'?-1:0,action==='right'?1:action==='left'?-1:0);}});
  });
  game.querySelector('[data-rover-hop]').addEventListener('click',hop);
  window.addEventListener('blur',()=>{clear();suspend(false);});
  window.addEventListener('focus',focusState);
  document.addEventListener('visibilitychange',()=>{clear();if(document.hidden)suspend(false);else focusState();});
  document.addEventListener('cest:fullscreenchange',()=>{clear();if(active){game.focus({preventScroll:true});focusState();}});
  document.addEventListener('cest:roverclose',close);
  document.addEventListener('cest:terrainready',()=>{if(queued){const trigger=queued;queued=null;open(trigger);}});
  motion.addEventListener('change',()=>rover()?.setReducedMotion(motion.matches));
  new MutationObserver(()=>{
    if(queued&&!document.body.classList.contains('welcome-active')){const trigger=queued;queued=null;open(trigger);}
    if(active&&document.body.classList.contains('welcome-active'))close();
  }).observe(document.body,{attributes:true,attributeFilter:['class']});
})();
