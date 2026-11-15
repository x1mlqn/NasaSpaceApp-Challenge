/* Respect reduced motion, offer a real pause, and stop GIF decoding outside the welcome page. */
(() => {
  const image=document.getElementById('welcomeMoon'),button=document.getElementById('moonAnimationToggle');
  if(!image||!button)return;
  const reduce=matchMedia('(prefers-reduced-motion: reduce)');let paused=reduce.matches;
  function update(){
    const playing=!paused&&!reduce.matches&&!document.hidden&&document.body.classList.contains('welcome-active');
    const source=playing?'assets/images/welcome-moon.gif':'assets/images/welcome-moon-still.png';
    if(image.getAttribute('src')!==source)image.setAttribute('src',source);
    button.disabled=reduce.matches;
    button.textContent=reduce.matches?'Still image':playing?'Pause':'Animate';button.setAttribute('aria-pressed',String(!playing));
    button.setAttribute('aria-label',reduce.matches?'Animation disabled: reduced motion':playing?'Pause the Moon animation':'Animate the Moon phases');
  }
  button.addEventListener('click',()=>{paused=!paused;update();});
  reduce.addEventListener('change',()=>{paused=reduce.matches;update();});
  document.addEventListener('visibilitychange',update);
  new MutationObserver(update).observe(document.body,{attributes:true,attributeFilter:['class']});
  update();
})();
