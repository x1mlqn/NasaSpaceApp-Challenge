/* Lossless native DEM tiles, bounded decoded cache, shared by rendering and science. */
(() => {
  'use strict';
  const tiles=new Map(),pending=new Map(),pins=new Map();
  const budget=192*1024*1024;
  const littleEndian=new Uint8Array(new Uint16Array([1]).buffer)[0]===1;
  let bytes=0,tick=0,meta=null,overview=null,baseURL='',initPromise=null;const fastTiles=[];
  function evict(){
    if(bytes<=budget)return;
    const candidates=[...tiles].filter(([key])=>!pins.has(key)).sort((a,b)=>a[1].used-b[1].used);
    for(const [key,tile] of candidates){if(bytes<=budget)break;tiles.delete(key);fastTiles[tile.slot]=null;bytes-=tile.values.byteLength;}
  }
  async function readGzip(url,expected,signal){
    if(typeof DecompressionStream!=='function')throw new Error('This browser does not support compressed tiles. Use a recent Chromium browser.');
    const response=await fetch(url,{signal});if(!response.ok)throw new Error(`LOLA tile unavailable (${response.status}).`);
    const buffer=await new Response(response.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
    if(buffer.byteLength!==expected*2)throw new Error('Incorrect LOLA tile dimensions.');
    // The source and tile format are explicitly little endian.
    if(littleEndian)return new Uint16Array(buffer);
    const values=new Uint16Array(expected),view=new DataView(buffer);for(let i=0;i<expected;i++)values[i]=view.getUint16(i*2,true);return values;
  }
  async function init(){
    if(initPromise)return initPromise;
    initPromise=(async()=>{
      const url=new URL(window.CEST_DEM.manifest,document.baseURI),response=await fetch(url);
      if(!response.ok)throw new Error('The 30 m DEM manifest could not be found.');
      meta=await response.json();baseURL=url.href;
      if(meta.version!==1||meta.sampleMeters!==30||meta.encodingOffset!==32768)throw new Error('Unsupported DEM format.');
      overview=await readGzip(new URL(meta.overview.url,baseURL),meta.overview.width*meta.overview.height);
      api.ready=true;api.metadata=meta;return {width:meta.overview.width,height:meta.overview.height,pixels:overview};
    })();return initPromise;
  }
  function coordinates(x,north){return {x:x/meta.sampleMeters+meta.centerPixel,y:meta.centerPixel-north/meta.sampleMeters};}
  function bilinear(values,w,h,x,y){
    x=Math.max(0,Math.min(w-1,x));y=Math.max(0,Math.min(h-1,y));
    const a=Math.floor(x),b=Math.floor(y),c=Math.min(a+1,w-1),d=Math.min(b+1,h-1),fx=x-a,fy=y-b;
    return (values[b*w+a]*(1-fx)+values[b*w+c]*fx)*(1-fy)+(values[d*w+a]*(1-fx)+values[d*w+c]*fx)*fy;
  }
  function at(x,y){
    const tx=Math.floor(x/meta.tileSize),ty=Math.floor(y/meta.tileSize),tile=fastTiles[ty*meta.tileColumns+tx];
    if(!tile)return null;tile.used=++tick;
    return tile.values[(y-ty*meta.tileSize)*tile.width+x-tx*meta.tileSize];
  }
  function sampleEncodedWorld(x,north,strict=false){
    if(!api.ready)return null;let p=coordinates(x,north);
    if(p.x<-.5||p.y<-.5||p.x>meta.width-.5||p.y>meta.height-.5)return null;
    p.x=Math.max(0,Math.min(meta.width-1,p.x));p.y=Math.max(0,Math.min(meta.height-1,p.y));
    const x0=Math.floor(p.x),y0=Math.floor(p.y),x1=Math.min(x0+1,meta.width-1),y1=Math.min(y0+1,meta.height-1);
    const tx=Math.floor(x0/meta.tileSize),ty=Math.floor(y0/meta.tileSize);
    const tile=fastTiles[ty*meta.tileColumns+tx];
    const localX=x0-tx*meta.tileSize,localY=y0-ty*meta.tileSize;
    if(tile && localX+x1-x0<tile.width && localY+y1-y0<tile.height){
      tile.used=++tick;
      const row=localY*tile.width+localX,nextRow=row+(y1-y0)*tile.width,step=x1-x0;
      const fx=p.x-x0,fy=p.y-y0,v=tile.values;
      return (v[row]*(1-fx)+v[row+step]*fx)*(1-fy)+(v[nextRow]*(1-fx)+v[nextRow+step]*fx)*fy;
    }
    const a=at(x0,y0),b=at(x1,y0),c=at(x0,y1),d=at(x1,y1);
    if(a!==null&&b!==null&&c!==null&&d!==null){const fx=p.x-x0,fy=p.y-y0;return (a*(1-fx)+b*fx)*(1-fy)+(c*(1-fx)+d*fx)*fy;}
    if(strict)return null;
    return bilinear(overview,meta.overview.width,meta.overview.height,(p.x-meta.overview.firstNativePixel)/meta.overview.factor,(p.y-meta.overview.firstNativePixel)/meta.overview.factor);
  }
  function sampleMetersWorld(x,north,strict=false){const value=sampleEncodedWorld(x,north,strict);return value===null?null:(value-32768)*meta.scaleMeters;}
  function fetchTile(x,y){
    const key=`${x}_${y}`;if(tiles.has(key))return Promise.resolve();if(pending.has(key))return pending.get(key);
    const job=(async()=>{const w=Math.min(meta.tileSize,meta.width-x*meta.tileSize),h=Math.min(meta.tileSize,meta.height-y*meta.tileSize);
      const path=meta.tilePattern.replace('{x}',x).replace('{y}',y);const values=await readGzip(new URL(path,baseURL),w*h);
      const tile={values,width:w,height:h,used:++tick,slot:y*meta.tileColumns+x};tiles.set(key,tile);fastTiles[tile.slot]=tile;bytes+=values.byteLength;evict();
    })().finally(()=>pending.delete(key));pending.set(key,job);return job;
  }
  async function ensureRegionMeters(x,north,radius,isCancelled=()=>false){
    await init();
    if(isCancelled())throw Object.assign(new Error('Loading canceled.'),{name:'AbortError'});
    const p=coordinates(x,north),r=radius/meta.sampleMeters+2;
    const x0=Math.max(0,Math.floor((p.x-r)/meta.tileSize)),x1=Math.min(meta.tileColumns-1,Math.floor((p.x+r)/meta.tileSize));
    const y0=Math.max(0,Math.floor((p.y-r)/meta.tileSize)),y1=Math.min(meta.tileRows-1,Math.floor((p.y+r)/meta.tileSize));
    const jobs=[];for(let ty=y0;ty<=y1;ty++)for(let tx=x0;tx<=x1;tx++){const key=`${tx}_${ty}`;jobs.push([tx,ty,key]);pins.set(key,(pins.get(key)||0)+1);}
    let released=false;const release=()=>{if(released)return;released=true;for(const [,,key] of jobs){const n=(pins.get(key)||1)-1;n?pins.set(key,n):pins.delete(key);}evict();};
    const centerX=p.x/meta.tileSize-.5,centerY=p.y/meta.tileSize-.5;
    jobs.sort(([ax,ay],[bx,by])=>(ax-centerX)**2+(ay-centerY)**2-(bx-centerX)**2-(by-centerY)**2);
    const concurrency=Math.min(jobs.length,radius>=50000?3:4);
    let next=0,stopped=false;
    try{
      await Promise.all(Array.from({length:concurrency},async()=>{
        while(!stopped && next<jobs.length){
          if(isCancelled())throw Object.assign(new Error('Loading canceled.'),{name:'AbortError'});
          const [tx,ty]=jobs[next++];
          await fetchTile(tx,ty);
        }
      }));
      return release;
    } catch(error){
      stopped=true;
      release();
      throw error;
    }
  }
  function sampleOverviewMeters(x,north){
    const p=coordinates(x,north),o=meta.overview;
    return (bilinear(overview,o.width,o.height,(p.x-o.firstNativePixel)/o.factor,(p.y-o.firstNativePixel)/o.factor)-meta.encodingOffset)*meta.scaleMeters;
  }
  const api={ready:false,metadata:null,init,ensureRegionMeters,sampleEncodedWorld,sampleMetersWorld,coordinates,sampleOverviewMeters,
    diagnostics:()=>({tiles:tiles.size,bytes,budget,pending:pending.size,pinned:pins.size,nativeSampleMeters:meta?.sampleMeters})};
  window.CEST_TILED_DEM=api;
})();
