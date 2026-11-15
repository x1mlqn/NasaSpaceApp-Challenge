/* One visual identity. Stored historic palette choices no longer affect the app. */
(() => {
  const root=document.documentElement;
  const palette={hue:218,start:'#000000',end:'#000000',accent:'#b7cdf2',glow:'#6e8fcb'};
  root.dataset.theme='space';
  const properties={'--primary-hue':palette.hue,'--bg-gradient-start':palette.start,'--bg-gradient-end':palette.end,'--accent-color':palette.accent,'--theme-glow':palette.glow,'--gold':palette.accent,'--gold2':palette.accent,'--blue':palette.accent};
  Object.entries(properties).forEach(([key,value])=>root.style.setProperty(key,value));
  const meta=document.querySelector('meta[name="theme-color"]');if(meta)meta.content=palette.start;
  document.dispatchEvent(new CustomEvent('lunar:themechange',{detail:{theme:'space',hue:palette.hue}}));
})();
