/* LOLA terrain engine for C'est Lunaire.
 * Shared Three.js scene and meshes for the main terrain view.
 * Simulation inputs: data-lunar-sites.js and data-celestial-positions.js.
 */
(() => {
  'use strict';

  const THREE = window.THREE;
  const canvas = document.querySelector('#globe');
  const mapCanvas = document.querySelector('#map2d');
  const stage = document.querySelector('.terrain-stage');
  const readout = document.querySelector('#terrainReadout');
  const skyHud = document.createElement('section');
  skyHud.id = 'skyPositionHud';
  skyHud.className = 'sky-position-hud';
  skyHud.setAttribute('role', 'group');
  skyHud.setAttribute('aria-label', 'Sun and Earth positions from the selected site');
  skyHud.innerHTML = `<div class="sky-hud-heading"><span>SKY FROM THE SITE</span><b>AZIMUTH · ELEVATION</b></div>
    <div class="sky-hud-content">
      <div class="sky-compass" aria-hidden="true"><span class="sky-north">N</span><span class="sky-east">E</span><span class="sky-south">S</span><span class="sky-west">O</span><i id="skySunPoint" class="sky-point sky-sun"></i><i id="skyEarthPoint" class="sky-point sky-earth"></i></div>
      <div class="sky-hud-values"><div class="sky-hud-row"><span class="sky-kind sky-kind-sun">Sun</span><b id="skySunPosition">—</b><small id="skySunVisibility">Calculating…</small></div><div class="sky-hud-row"><span class="sky-kind sky-kind-earth">Earth</span><b id="skyEarthPosition">—</b><small id="skyEarthVisibility">Calculating…</small></div></div>
    </div>
    <button type="button" class="sky-scale-toggle" aria-label="Enhanced visibility" aria-pressed="true">Enhanced visibility</button>`;
  // Share the normal-view control stack; fullscreen retains absolute HUD positioning.
  const bottomControls=stage.querySelector('.terrain-bottom-controls');
  if(bottomControls)bottomControls.prepend(skyHud);
  else stage.append(skyHud);
  const celestialCues = document.createElement('div');
  celestialCues.className = 'celestial-cues';
  celestialCues.setAttribute('aria-hidden', 'true');
  celestialCues.innerHTML = '<div class="celestial-cue celestial-cue-sun" hidden><span class="celestial-cue-arrow"></span><span class="celestial-cue-label">Sun</span></div><div class="celestial-cue celestial-cue-earth" hidden><span class="celestial-cue-arrow"></span><span class="celestial-cue-label">Earth</span></div>';
  stage.append(celestialCues);
  const sunCue = celestialCues.querySelector('.celestial-cue-sun');
  const earthCue = celestialCues.querySelector('.celestial-cue-earth');

  if (!THREE || !canvas || !window.CEST_DEM || !window.CEST_SKY?.length || !window.CEST_ENGINE) {
    const error = new Error('Three.js, LOLA terrain, DE421 vectors or the scientific engine is missing.');
    console.error(error);
    const loading = document.querySelector('#terrainLoading');
    if (loading) loading.textContent = error.message;
    return;
  }

  const MOON_RADIUS_KM = 1737.4;
  const MAX_RHO_KM = 2 * MOON_RADIUS_KM * Math.tan(Math.PI / 4 - 75 * Math.PI / 360);
  const HEIGHT_MIN_M = -7763;
  const HEIGHT_MAX_M = 7027;
  // Preserve physical elevations to align visibility calculations and 3D occlusion.
  const VERTICAL_SCALE = 1;
  const GRID = 640;
  const DETAIL_GRID = 449;
  const DETAIL_RADIUS_M = 32000;
  const FINE_GRID = 401, FINE_RADIUS_M = 6000;
  const WALK_HEIGHT_M = 600;
  // Initial orbit altitude above the selected site.
  const DEFAULT_SITE_ALTITUDE_M = 7500;
  const MIN_SITE_ALTITUDE_M = 700;
  const MAX_SITE_ALTITUDE_M = 20000;
  // Physical metres, shared radii, and DE421 distances; no enlarged celestial proxies.
  const SUN_RADIUS_M = window.CEST_ENGINE.SUN_RADIUS_KM * 1000;
  const EARTH_RADIUS_M = window.CEST_ENGINE.EARTH_RADIUS_KM * 1000;
  const angularFormat=new Intl.NumberFormat('en-US',{maximumFractionDigits:2,minimumFractionDigits:2});
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
  } catch (error) {
    console.error('Unable to initialize lunar terrain WebGL rendering:', error);
    const loading = document.querySelector('#terrainLoading');
    if (loading) { loading.textContent = 'WebGL is unavailable in this browser. Enable hardware acceleration or try a compatible browser.'; loading.classList.add('visible'); }
    return;
  }
  const pixelRatioCap = matchMedia('(max-width: 800px)').matches ? 1 : 1.25;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, pixelRatioCap));
  renderer.setClearColor(0x000000, 1);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.autoUpdate = false;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  renderer.autoClear = false;

  const scene = new THREE.Scene();
  scene.background = null;
  const skyScene = new THREE.Scene();
  skyScene.background = new THREE.Color(0x000000);
  // Separate depth ranges keep astronomical distances from degrading nearby terrain/rover precision.
  const skyCamera = new THREE.PerspectiveCamera(62,1,100000,200000000000);
  skyCamera.layers.enable(1);
  const camera = new THREE.PerspectiveCamera(56, 1, 0.5, 1200000);
  camera.layers.enable(1);
  const ambient = new THREE.HemisphereLight(0x9db8df, 0x282329, 0.45);
  scene.add(ambient);
  const sunLight = new THREE.DirectionalLight(0xffe8bc, 2.15);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.set(512, 512);
  sunLight.shadow.autoUpdate = false;
  sunLight.shadow.camera.left = -42000;
  sunLight.shadow.camera.right = 42000;
  sunLight.shadow.camera.top = 42000;
  sunLight.shadow.camera.bottom = -42000;
  sunLight.shadow.camera.near = 1;
  sunLight.shadow.camera.far = 200000;
  sunLight.shadow.bias = -0.00004;
  sunLight.shadow.normalBias = 0.4;
  scene.add(sunLight);
  scene.add(sunLight.target);
  const fillLight = new THREE.DirectionalLight(0x536989, 0.18);
  scene.add(fillLight);

  // Camera-centered star field, visible in overview and ground-level views.
  // Keep the star-field radius within the polar camera far plane; a sky
  // several million meters away was clipped by the map far plane.
  const starPositions = new Float32Array(1200 * 3);
  let starSeed = 890217;
  const randomStar = () => { starSeed = (starSeed * 1664525 + 1013904223) >>> 0; return starSeed / 4294967296; };
  for (let i = 0; i < 1200; i++) {
    const y = randomStar() * 2 - 1, angle = randomStar() * Math.PI * 2;
    const radius = 850000, ring = Math.sqrt(1 - y * y), offset = i * 3;
    starPositions[offset] = Math.cos(angle) * ring * radius;
    starPositions[offset + 1] = y * radius;
    starPositions[offset + 2] = Math.sin(angle) * ring * radius;
  }
  const starGeometry = new THREE.BufferGeometry();
  starGeometry.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
  const starField = new THREE.Points(starGeometry, new THREE.PointsMaterial({ color: 0xd9e5ff, size: 1500, sizeAttenuation: true, transparent: true, opacity: 0.84, depthWrite: false }));
  starField.frustumCulled = false;
  starField.material.transparent=false; // Draw opaque-list stars first, never over the planetary disks.
  starField.renderOrder=-1;
  skyScene.add(starField);

  const celestialGroup = new THREE.Group();
  skyScene.add(celestialGroup);
  const sunVisual = new THREE.Mesh(new THREE.SphereGeometry(SUN_RADIUS_M, 32, 20), new THREE.MeshBasicMaterial({ color: 0xffe6a6 }));
  const celestialAppearance=window.CEST_CELESTIAL_APPEARANCE(THREE,SUN_RADIUS_M);
  sunVisual.material.dispose();sunVisual.material=celestialAppearance.sunMaterial;sunVisual.add(celestialAppearance.glow);
  sunVisual.name = 'Sun · physical radius 695,700 km';
  celestialGroup.add(sunVisual);

  // Local 2048 × 1024 Earth photograph, replacing the coarse hand-drawn continent map.
  const earthTexture = new THREE.TextureLoader().load('assets/images/earth-blue-marble.jpg');
  earthTexture.colorSpace = THREE.SRGBColorSpace;
  earthTexture.anisotropy=Math.min(4,renderer.capabilities.getMaxAnisotropy());
  const earthVisual = new THREE.Mesh(new THREE.SphereGeometry(EARTH_RADIUS_M, 40, 28), new THREE.MeshStandardMaterial({ map: earthTexture, color: 0xffffff, roughness: 1, metalness: 0, emissive: 0x739bcb, emissiveMap: earthTexture, emissiveIntensity: 0.36 }));
  earthVisual.name = 'Earth · physical radius 6,371 km';
  earthVisual.layers.set(1);
  const earthAtmosphere = new THREE.Mesh(new THREE.SphereGeometry(EARTH_RADIUS_M * 1.015, 40, 28), celestialAppearance.atmosphereMaterial);
  earthAtmosphere.layers.set(1);
  earthVisual.add(earthAtmosphere);
  celestialGroup.add(earthVisual);
  const earthSunLight = new THREE.DirectionalLight(0xfff7ed, 3.2);
  earthSunLight.layers.set(1);
  earthVisual.layers.enable(1);
  earthAtmosphere.layers.enable(1);
  skyScene.add(earthSunLight);
  skyScene.add(earthSunLight.target);
  const skyScaleButton=skyHud.querySelector('.sky-scale-toggle');
  let enhancedSky=true;
  function applySkyScale(){
    sunVisual.scale.setScalar(enhancedSky ? 2 : 1);
    earthVisual.scale.setScalar(enhancedSky ? 1.5 : 1);
    skyScaleButton.setAttribute('aria-pressed',String(enhancedSky));
    skyScaleButton.textContent=enhancedSky ? 'Enhanced visibility' : 'True scale';
    skyScaleButton.title=enhancedSky ? 'Switch to true angular sizes' : 'Enlarge the Sun and Earth';
  }
  applySkyScale();
  skyScaleButton.addEventListener('click',()=>{
    enhancedSky=!enhancedSky;
    applySkyScale();
    updateLighting(true);
  });

  // Warm the few sky materials once, avoiding a shader-compilation hitch when a disk enters view.
  renderer.compile(skyScene,skyCamera);


  let heightPixels = null;
  let width = 0;
  let height = 0;
  let ground = null;
  let secretRover = null;
  let detailGround = null;
  let fineGround = null;
  let fineFadeStart = null;
  let detailFadeStart = null;
  let lastDetailRebuild = { x: NaN, z: NaN };
  let markerGroup = new THREE.Group();
  scene.add(markerGroup);
  let analysisZoneGroup = new THREE.Group();
  scene.add(analysisZoneGroup);
  let analysisZones = [];
  let selectedMarker = null;
  let selectedMarkerRing = null;
  let staticMarkersBuilt = false;
  let view = 'map';
  let transitioning = false;
  let viewTransitionId = 0;
  let viewAnimationId = 0;
  let mapAnimationId = 0;
  let pendingLandingTerrain = null;
  let settledMapFocus = null;
  let metricRecalculationTimer = 0;
  let pendingMetricPosition = null;
  let mode = 'public';
  let selected = { lat: -89.9, lon: 0, name: 'Test point' };
  let planMode = false;
  const MAP_RASTER_SPAN_METERS = 2 * MAX_RHO_KM * 1000;
  const mapRasters = { natural: null, heatmap: null };
  const mapRasterTasks = { natural: null, heatmap: null };
  const mapHeightStops = [[39,63,157],[42,139,205],[58,190,166],[176,220,96],[253,197,75],[235,89,75],[249,226,176]];
  let mapStyle = 'natural';
  let mapPointer = null;
  let mapCenterX = 0;
  let mapCenterZ = 0;
  let mapZoom = 1;
  let mapScale = 0;
  let mapDrawFrame = 0;
  let hour = 0;
  let activeVisibility = null;
  let activeRow = null;
  let activeVisibilityPosition = null;
  let horizonRaySteps = null;
  let pointer = null;
  let keys = new Set();
  let roverInputSuspended = false;
  document.addEventListener('cest:roverfocus', event => {
    roverInputSuspended = Boolean(event.detail?.active);
    keys.clear(); mapPointer = null; cancelPointerInteraction();
    if(!roverInputSuspended&&pendingMetricPosition&&!metricRecalculationTimer){
      const pending=pendingMetricPosition;scheduleMetricRecalculation(pending.x,pending.z,pending.coord);
    }
  });
  let yaw = 0;
  let pitch = -0.03;
  let orbitYaw = 0.48;
  const DEFAULT_ORBIT_POLAR = 40 * Math.PI / 180;
  const DEFAULT_MAP_FOV = 56;
  let orbitPolar = DEFAULT_ORBIT_POLAR;
  let selectedViewAltitudeM = DEFAULT_SITE_ALTITUDE_M;
  let orbitDistance = DEFAULT_SITE_ALTITUDE_M / Math.cos(orbitPolar);
  let targetX = 0;
  let targetZ = 0;
  let lastMetricUpdate = 0;
  let lastMetricPosition = { x: NaN, z: NaN };
  let lastFrame = performance.now();

  function viewTransitionDuration() {
    return matchMedia('(prefers-reduced-motion: reduce)').matches ? 180 : 1450;
  }
  function mapTransitionDuration() {
    return matchMedia('(prefers-reduced-motion: reduce)').matches ? 180 : 1350;
  }
  let selectedSky = { sun: new THREE.Vector3(0, 1, 0), earth: new THREE.Vector3(0, 1, 0), phase: 50 };
  let lastLightState = { hour: -1, x: NaN, z: NaN };
  let rendererSize = { width: 0, height: 0 };
  let renderFrameId = 0;
  let lastRenderedAt = 0;

  const grayToMeters = v => (v - 32768) * 0.5;
  const polarXY = (lat, lon) => {
    const phi = lat * Math.PI / 180;
    const lambda = lon * Math.PI / 180;
    const rho = 2 * MOON_RADIUS_KM * Math.tan(Math.PI / 4 + phi / 2);
    return { x: rho * Math.sin(lambda) * 1000, z: rho * Math.cos(lambda) * 1000 };
  };
  const inversePolar = (x, z) => {
    const rho = Math.hypot(x, z) / 1000;
    const lat = (2 * Math.atan(rho / (2 * MOON_RADIUS_KM)) - Math.PI / 2) * 180 / Math.PI;
    return { lat: clamp(lat, -90, -75.001), lon: ((Math.atan2(x, z) * 180 / Math.PI + 540) % 360) - 180 };
  };

  let releaseRenderPatch=null, renderPatchGeneration=0;

  function sampleMeters(x, z) {
    if (Math.hypot(x, z) > MAX_RHO_KM * 1000) return null;
    if(window.CEST_TILED_DEM?.ready){
      const dem=window.CEST_TILED_DEM;
      if(releaseRenderPatch && Math.abs(x-renderPatchCenter.x)<=FINE_RADIUS_M && Math.abs(z-renderPatchCenter.z)<=FINE_RADIUS_M) {
        return dem.sampleMetersWorld(x,z,true) ?? dem.sampleOverviewMeters(x,z);
      }
      return dem.sampleOverviewMeters(x,z);
    }
    const px = (x / (MAX_RHO_KM * 1000) + 1) * 0.5 * (width - 1);
    const py = (1 - z / (MAX_RHO_KM * 1000)) * 0.5 * (height - 1);
    if (px < 0 || py < 0 || px > width - 1 || py > height - 1) return null;
    const x0 = Math.floor(px), y0 = Math.floor(py);
    const x1 = Math.min(width - 1, x0 + 1), y1 = Math.min(height - 1, y0 + 1);
    const fx = px - x0, fy = py - y0;
    const at = (xx, yy) => heightPixels[yy * width + xx];
    const a = at(x0, y0) * (1 - fx) + at(x1, y0) * fx;
    const b = at(x0, y1) * (1 - fx) + at(x1, y1) * fx;
    return grayToMeters(a * (1 - fy) + b * fy);
  }

  function siteOverviewDistance() {
    return selectedViewAltitudeM / Math.max(0.15, Math.cos(orbitPolar));
  }

  function formatAltitude(meters) {
    return meters >= 1000 ? `${(meters / 1000).toLocaleString('en-US', { maximumFractionDigits: 1 })} km` : `${Math.round(meters)} m`;
  }

  function setSiteAltitude(meters, animate = true) {
    selectedViewAltitudeM = clamp(Number(meters) || DEFAULT_SITE_ALTITUDE_M, MIN_SITE_ALTITUDE_M, MAX_SITE_ALTITUDE_M);
    const slider = document.querySelector('#viewHeightSlider');
    const output = document.querySelector('#viewHeightValue');
    if (slider) slider.value = String(Math.round(selectedViewAltitudeM));
    if (output) output.textContent = formatAltitude(selectedViewAltitudeM);
    if (!planMode && view === 'map') {
      const distance = siteOverviewDistance();
      if (animate) animateMapTo(targetX, targetZ, distance);
      else { orbitDistance = distance; aimMapCamera(); }
    }
  }

  const ORBIT_MIN_POLAR = 5 * Math.PI / 180;
  const ORBIT_MAX_POLAR = 80 * Math.PI / 180;
  const ORBIT_CLEARANCE_METERS = 180;

  function mapFocusY(x = targetX, z = targetZ) {
    return roverSurface(x, z) ?? sampleMeters(x, z) ?? 0;
  }

  function mapCameraPose(x = targetX, z = targetZ, distance = orbitDistance) {
    const focusY = mapFocusY(x, z);
    const horizontal = distance * Math.sin(orbitPolar);
    const px = x + horizontal * Math.sin(orbitYaw);
    const pz = z + horizontal * Math.cos(orbitYaw);
    const terrainAtCamera = roverSurface(px, pz) ?? sampleMeters(px, pz);
    return {
      x: px,
      y: Math.max(focusY + distance * Math.cos(orbitPolar), (terrainAtCamera ?? focusY) + ORBIT_CLEARANCE_METERS),
      z: pz,
      focusY
    };
  }

  function aimMapCamera() {
    const pose = mapCameraPose();
    camera.position.set(pose.x, pose.y, pose.z);
    settledMapFocus=pose.focusY;
    camera.lookAt(targetX, pose.focusY, targetZ);
  }

  const visibleMapTiles=new Map();
  const failedMapOverviews=new Set();
  function buildMapRaster(style = mapStyle) {
    if(mapRasters[style])return Promise.resolve(mapRasters[style]);
    if(mapRasterTasks[style])return mapRasterTasks[style];
    mapRasterTasks[style]=(async()=>{
      const image=new Image();image.src=`assets/maps/map60-tiles/${style}/overview.png`;
      await image.decode();
      if(!planMode||style!==mapStyle)return null;
      // Retain just the active native-resolution image.
      mapRasters[style]=image;
      if(planMode)drawMap2D();
      return mapRasters[style];
    })().catch(error=>{
      if(planMode && style===mapStyle){
        failedMapOverviews.add(style);
        finishMapEntry();
        document.querySelector('#mapDetailStatus').textContent='Unable to load the 2D map. Select the map layer again to retry.';
      }
      console.error(error);
      throw error;
    }).finally(()=>{mapRasterTasks[style]=null;});
    return mapRasterTasks[style];
  }

  function mapPointToScreen(x, z, w, h) {
    return { x: w / 2 + (x - mapCenterX) * mapScale, y: h / 2 - (z - mapCenterZ) * mapScale };
  }

  let mapEntryLoading=false;
  function finishMapEntry() {
    if (!mapEntryLoading) return;
    mapEntryLoading=false;
    mapCanvas.style.visibility='';
    document.querySelector('#terrainLoading')?.classList.remove('visible');
  }
  function loadVisibleMapTile(key, tile, attempt = 1) {
    const redraw = () => {
      if (!planMode || visibleMapTiles.get(key) !== tile || mapDrawFrame) return;
      mapDrawFrame=requestAnimationFrame(()=>{mapDrawFrame=0;drawMap2D();});
    };
    tile.onload=redraw;
    tile.onerror=()=>{
      if (visibleMapTiles.get(key) !== tile) return;
      if (attempt < 3) {
        setTimeout(()=>{
          if (visibleMapTiles.get(key) === tile) loadVisibleMapTile(key,tile,attempt+1);
        },attempt*350);
      } else {
        tile.dataset.failed='true';
        redraw();
      }
    };
    tile.src=`assets/maps/map60-tiles/${key}.png${attempt>1?`?retry=${attempt}`:''}`;
  }
  function drawTiledMapBackground(ctx,w,h){
    const raster=mapRasters[mapStyle];
    if(!raster){
      if(!failedMapOverviews.has(mapStyle))buildMapRaster(mapStyle).catch(()=>{});
      return;
    }
    const halfSpan=MAP_RASTER_SPAN_METERS/2;
    const size=MAP_RASTER_SPAN_METERS*mapScale;
    const left=w/2-(mapCenterX+halfSpan)*mapScale;
    const top=h/2-(halfSpan-mapCenterZ)*mapScale;
    ctx.drawImage(raster,left,top,size,size);
    const factor=size>=4096?1:size>=2048?2:size>=1024?4:8;
    const needed=new Set();
    if(factor!==8){
      const count=16/factor, span=size/count;
      const x0=Math.max(0,Math.floor(-left/span)), x1=Math.min(count-1,Math.floor((w-left)/span));
      const y0=Math.max(0,Math.floor(-top/span)), y1=Math.min(count-1,Math.floor((h-top)/span));
      for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){
        const key=`${mapStyle}/${factor}-${x}-${y}`;
        needed.add(key);
        let tile=visibleMapTiles.get(key);
        if(!tile){
          tile=new Image();
          visibleMapTiles.set(key,tile);
          loadVisibleMapTile(key,tile);
        }
        if(tile.complete&&tile.naturalWidth)ctx.drawImage(tile,left+x*span,top+y*span,span,span);
      }
    }
    for(const key of visibleMapTiles.keys())if(!needed.has(key))visibleMapTiles.delete(key);
    finishMapEntry();
  }

  function constrainMapView(w,h) {
    const radius=MAX_RHO_KM*1000;
    // At the widest zoom the complete cap fits, and panning is locked to the pole.
    const fitZoom=180000*Math.min(w,h)/(2*radius*w);
    mapZoom=clamp(mapZoom,fitZoom,24);
    mapScale=w/180000*mapZoom;
    const margin=Math.min(w,h)/(2*mapScale);
    const limit=Math.max(0,radius-margin);
    const distance=Math.hypot(mapCenterX,mapCenterZ);
    if(distance>limit){
      mapCenterX=distance?mapCenterX*limit/distance:0;
      mapCenterZ=distance?mapCenterZ*limit/distance:0;
    }
  }

  function drawMap2D() {
    if (!planMode || !mapCanvas || !heightPixels) return;
    const rect = mapCanvas.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const pixelWidth = Math.round(rect.width * dpr), pixelHeight = Math.round(rect.height * dpr);
    if (mapCanvas.width !== pixelWidth || mapCanvas.height !== pixelHeight) {
      mapCanvas.width = pixelWidth; mapCanvas.height = pixelHeight;
    }
    const ctx = mapCanvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const w = rect.width, h = rect.height;
    constrainMapView(w,h);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#000000'; ctx.fillRect(0, 0, w, h);
    // Geographic coverage is the south-polar cap bounded by latitude 75 S.
    const capCenter = mapPointToScreen(0, 0, w, h);
    ctx.save();
    ctx.beginPath();
    ctx.arc(capCenter.x, capCenter.y, MAX_RHO_KM * 1000 * mapScale, 0, Math.PI * 2);
    ctx.clip();
    drawTiledMapBackground(ctx,w,h);
    ctx.save(); ctx.strokeStyle = '#dce6f221'; ctx.lineWidth = 1;
    for (let lat = -89; lat >= -90; lat -= 1) {
      const radius = 2 * MOON_RADIUS_KM * 1000 * Math.tan(Math.PI / 4 + lat * Math.PI / 360);
      const center = mapPointToScreen(0, 0, w, h);
      ctx.beginPath(); ctx.arc(center.x, center.y, radius * mapScale, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.restore();
    const features = [...(window.CEST_DATA?.sites || []), ...(window.CEST_DATA?.catalogue || [])];
    for (const feature of features) {
      const p = polarXY(feature.lat, feature.lon), q = mapPointToScreen(p.x, p.z, w, h);
      if (q.x < -12 || q.y < -12 || q.x > w + 12 || q.y > h + 12) continue;
      const featured = window.CEST_DATA?.sites?.some(site => site.id === feature.id);
      const favorable = Boolean(window.CEST_SITE_QUALITY?.[feature.id]?.favorable);
      ctx.beginPath(); ctx.arc(q.x, q.y, featured ? (favorable ? 4 : 3.2) : 1.8, 0, Math.PI * 2);
      ctx.fillStyle = favorable ? '#4ad295' : featured ? '#d9e8fa' : '#a9b7c9'; ctx.fill();
      if (favorable) {
        ctx.beginPath(); ctx.arc(q.x, q.y, 7, 0, Math.PI * 2);
        ctx.strokeStyle = '#4ad295'; ctx.lineWidth = 1.2; ctx.stroke();
      }
      if (featured) {
        ctx.font = '10px Segoe UI, Arial'; ctx.fillStyle = '#edf2fa';
        ctx.shadowColor = '#05080ecc'; ctx.shadowBlur = 4; ctx.fillText(feature.name, q.x + 7, q.y - 6); ctx.shadowBlur = 0;
      }
    }
    for (let index = 0; index < analysisZones.length; index++) {
      const zone = analysisZones[index], p = polarXY(zone.lat, zone.lon), q = mapPointToScreen(p.x, p.z, w, h);
      if (q.x < -18 || q.y < -18 || q.x > w + 18 || q.y > h + 18) continue;
      drawZoneBeacon(ctx, q.x, q.y, index, index === 0 ? 1 : .84);
    }
    const selectedPoint = polarXY(selected.lat, selected.lon), point = mapPointToScreen(selectedPoint.x, selectedPoint.z, w, h);
    ctx.beginPath(); ctx.arc(point.x, point.y, 7, 0, Math.PI * 2); ctx.fillStyle = '#ffd27d'; ctx.fill();
    ctx.beginPath(); ctx.arc(point.x, point.y, 13 + Math.sin(performance.now() * 0.003) * 1.5, 0, Math.PI * 2); ctx.strokeStyle = '#ffd27d99'; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.fillStyle = '#fff1cb'; ctx.font = '600 10px Segoe UI, Arial'; ctx.fillText(selected.name, point.x + 13, point.y - 10);
    ctx.restore();
    // Visible geographic edge, independent of the cached map image.
    ctx.beginPath();
    ctx.arc(capCenter.x,capCenter.y,MAX_RHO_KM*1000*mapScale,0,Math.PI*2);
    ctx.strokeStyle='#75818e';ctx.lineWidth=1.5;ctx.stroke();
    ctx.fillStyle = '#dbe4f4'; ctx.font = '10px Consolas, monospace'; ctx.fillText('N', w - 24, 22);
    ctx.beginPath(); ctx.moveTo(w - 20, 28); ctx.lineTo(w - 20, 42); ctx.strokeStyle = '#dbe4f4'; ctx.stroke();
    const scaleMeters = mapZoom >= 4 ? 2000 : mapZoom >= 1.5 ? 5000 : mapZoom < 0.6 ? 25000 : 10000;
    const scalePixels = scaleMeters * mapScale;
    ctx.strokeStyle = '#edf2fa'; ctx.fillStyle = '#edf2fa'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(18, h - 23); ctx.lineTo(18 + scalePixels, h - 23); ctx.moveTo(18, h - 27); ctx.lineTo(18, h - 19); ctx.moveTo(18 + scalePixels, h - 27); ctx.lineTo(18 + scalePixels, h - 19); ctx.stroke();
    ctx.font = '9px Consolas, monospace'; ctx.fillText(scaleMeters >= 1000 ? `${scaleMeters / 1000} km` : `${scaleMeters} m`, 18, h - 32);
    const detailUnavailable=Array.from(visibleMapTiles.values()).some(tile=>tile.dataset.failed==='true');
    const status=document.querySelector('#mapDetailStatus');
    const message=detailUnavailable?'Some map detail is unavailable. Showing the overview in those areas.':'';
    if(!failedMapOverviews.has(mapStyle) && status.textContent!==message)status.textContent=message;
  }

  // Hit-test in CSS pixels so markers remain easy to select at every zoom/DPR.
  function mapSiteAt(event) {
    if (!planMode || mapScale <= 0) return null;
    const rect = mapCanvas.getBoundingClientRect();
    const x = event.clientX - rect.left, y = event.clientY - rect.top;
    const worldX=mapCenterX+(x-rect.width/2)/mapScale, worldZ=mapCenterZ-(y-rect.height/2)/mapScale;
    if(Math.hypot(worldX,worldZ)>MAX_RHO_KM*1000)return null;
    const candidates = [
      ...analysisZones.map((zone, index) => ({ ...zone, name: `Communication area ${index + 1}`, scan: true })),
      ...(window.CEST_DATA?.sites || []), ...(window.CEST_DATA?.catalogue || [])
    ];
    let nearest = null, distance = Infinity;
    for (const feature of candidates) {
      const p = polarXY(feature.lat, feature.lon);
      if(Math.hypot(p.x,p.z)>MAX_RHO_KM*1000)continue;
      const q = mapPointToScreen(p.x, p.z, rect.width, rect.height);
      const d = Math.hypot(x - q.x, y - q.y);
      if (d <= (feature.scan ? 18 : 14) && d < distance) { nearest = feature; distance = d; }
    }
    return nearest;
  }

  function showMapPointChoice() {
    const panel = document.querySelector('#mapPointChoice');
    if (!planMode || !panel) return;
    document.querySelector('#mapChoiceTitle').textContent = selected.name;
    panel.classList.add('visible');
  }

  function set2DMode(enabled, animate3D = true) {
    if(enabled&&secretRover?.active)document.dispatchEvent(new CustomEvent('cest:roverclose'));
    planMode = !!enabled;
    if (planMode && !mapRasters[mapStyle]) {
      mapEntryLoading=true;
      mapCanvas.style.visibility='hidden';
      document.querySelector('#terrainLoading')?.classList.add('visible');
    } else finishMapEntry();
    document.body.classList.toggle('terrain-2d-mode', planMode);
    document.querySelector('#view2D')?.setAttribute('aria-pressed', String(planMode));
    document.querySelector('#view3D')?.setAttribute('aria-pressed', String(!planMode));
    document.querySelector('#terrainResolutionCaption').textContent = planMode
      ? 'LOLA · 60 M 2D MAP · NORTH VIEW · DRAG TO PAN'
      : 'LOLA · 30 M SOURCE · ADAPTIVE DETAIL · VERTICAL × 1';
    if (planMode) {
      pendingLandingTerrain=null;
      detailBuildCenter=null;
      clearRenderPatch();
      mapCenterX = targetX; mapCenterZ = targetZ; mapZoom = 1;
      document.querySelector('#mapPointChoice')?.classList.remove('visible');
      setMapStyle(mapStyle);
      if (document.pointerLockElement) document.exitPointerLock?.();
      if (view === 'walk') setView('map', null, siteOverviewDistance());
      drawMap2D();
    } else {
      mapRasters[mapStyle]=null;
      visibleMapTiles.clear();
      document.querySelector('#mapDetailStatus').textContent='';
      pendingLandingTerrain={x:targetX,z:targetZ};
      loadNativeDetail(targetX,targetZ);
      document.querySelector('#mapPointChoice')?.classList.remove('visible');
      if (animate3D && view === 'map') animateMapTo(targetX, targetZ, siteOverviewDistance());
      if (!document.hidden && !renderFrameId) {
        lastFrame = performance.now();
        lastRenderedAt = 0;
        renderFrameId = requestAnimationFrame(renderFrame);
      }
    }
  }

  function setMapStyle(style) {
    if (style !== 'natural' && style !== 'heatmap') return;
    if(style!==mapStyle)mapRasters[mapStyle]=null;
    mapStyle = style;
    failedMapOverviews.delete(style);
    document.querySelector('#mapDetailStatus').textContent='';
    document.body.classList.toggle('terrain-heatmap-mode', mapStyle === 'heatmap');
    document.querySelector('#mapNatural')?.setAttribute('aria-pressed', String(mapStyle === 'natural'));
    document.querySelector('#mapHeatmap')?.setAttribute('aria-pressed', String(mapStyle === 'heatmap'));
    document.querySelector('#heightLegend')?.setAttribute('aria-hidden', String(mapStyle !== 'heatmap' || !planMode));
    if (planMode) { buildMapRaster(mapStyle).catch(()=>{}); drawMap2D(); }
  }

  function horizonAlongAzimuth(lat, lon, azimuthDeg, observerHeightM) {
    if (width < 2) return 0;
    if (!horizonRaySteps) {
      const stepMeters = window.CEST_TILED_DEM?.ready?30:2 * MAX_RHO_KM * 1000 / (width - 1);
      const count = Math.ceil(100000 / stepMeters);
      const sinTheta = new Float64Array(count + 1), cosTheta = new Float64Array(count + 1);
      for (let k = 1; k <= count; k++) {
        const theta = k * stepMeters / 1000 / MOON_RADIUS_KM;
        sinTheta[k] = Math.sin(theta); cosTheta[k] = Math.cos(theta);
      }
      horizonRaySteps = { stepMeters, sinTheta, cosTheta };
    }
    const { stepMeters, sinTheta, cosTheta } = horizonRaySteps;
    const phi1 = lat * Math.PI / 180, lambda1 = lon * Math.PI / 180, azimuth = azimuthDeg * Math.PI / 180;
    const sinPhi1 = Math.sin(phi1), cosPhi1 = Math.cos(phi1), sinLon = Math.sin(lambda1), cosLon = Math.cos(lambda1), sinAz = Math.sin(azimuth), cosAz = Math.cos(azimuth);
    const upX = cosPhi1 * sinLon, upY = cosPhi1 * cosLon, upZ = sinPhi1;
    const eastX = cosLon, eastY = -sinLon, northX = -sinPhi1 * sinLon, northY = -sinPhi1 * cosLon, northZ = cosPhi1;
    const dirX = eastX * sinAz + northX * cosAz, dirY = eastY * sinAz + northY * cosAz, dirZ = northZ * cosAz;
    const observerRadius = MOON_RADIUS_KM + observerHeightM / 1000;
    let highestTangent = -Infinity;
    for (let k = 1; k < sinTheta.length; k++) {
      const sinTh = sinTheta[k], cosTh = cosTheta[k];
      const destX = upX * cosTh + dirX * sinTh, destY = upY * cosTh + dirY * sinTh, destZ = upZ * cosTh + dirZ * sinTh;
      const projectionScale = 2 * MOON_RADIUS_KM * 1000 / (1 - destZ);
      const terrain = sampleMeters(projectionScale * destX, projectionScale * destY);
      if (terrain === null) break;
      const targetRadius = MOON_RADIUS_KM + terrain / 1000;
      const tangent = (targetRadius * cosTh - observerRadius) / (targetRadius * sinTh);
      if (tangent > highestTangent) highestTangent = tangent;
    }
    return Math.atan(highestTangent) * 180 / Math.PI;
  }

  function makeTerrainGeometry(...args) {
    return buildTerrainGeometry(...args).next().value;
  }

  function* buildTerrainGeometry(resolution, minX, maxX, minZ, maxZ, local = false, verticalScale = local ? VERTICAL_SCALE : 1, blendToCoarse = false, sampleElevation = sampleMeters, reuse = null, center = null) {
    const centerX=center?.x ?? targetX, centerZ=center?.z ?? targetZ;
    const count = resolution * resolution;
    const positions = reuse?.attributes.position.array ?? new Float32Array(count * 3);
    const colors = reuse?.attributes.color.array ?? new Float32Array(count * 3);
    const indices = reuse?.index.array ?? new Uint32Array((resolution - 1) * (resolution - 1) * 6);
    const baseElevation = local ? (sampleElevation(centerX, centerZ) ?? 0) : 0;
    const coarseStep = 2 * MAX_RHO_KM * 1000 / (GRID - 1);
    const coarseHeight = (x, z) => roverSurface(x,z,true,true);
    const cellW = (maxX - minX) / (resolution - 1);
    const cellH = (maxZ - minZ) / (resolution - 1);
    let index = 0;
    for (let row = 0; row < resolution; row++) {
      const v = row / (resolution - 1);
      const z = maxZ - v * (maxZ - minZ);
      for (let col = 0; col < resolution; col++) {
        const u = col / (resolution - 1);
        const x = minX + u * (maxX - minX);
        const sampleX = local ? centerX + x : x;
        const sampleZ = local ? centerZ + z : z;
        const elevation = sampleElevation(sampleX, sampleZ);
        const offset = (row * resolution + col) * 3;
        if (elevation === null || (!local && Math.hypot(x, z) > MAX_RHO_KM * 1000)) {
          positions[offset] = positions[offset + 2] = 0;
          positions[offset + 1] = -50000;
          colors[offset] = 0.08; colors[offset + 1] = 0.09; colors[offset + 2] = 0.11;
          continue;
        }
        positions[offset] = x;
        let renderElevation = elevation;
        if (blendToCoarse) {
          const edge = Math.min(x - minX, maxX - x, z - minZ, maxZ - z);
          const mix = clamp((edge - Math.min(2500,(maxX-minX)*.03)) / Math.min(7000,(maxX-minX)*.1), 0, 1);
          const coarse = coarseHeight(sampleX, sampleZ);
          if (coarse !== null) renderElevation = coarse * (1 - mix) + elevation * mix;
        }
        positions[offset + 1] = local ? (renderElevation - baseElevation) * verticalScale : renderElevation;
        positions[offset + 2] = z;
        const shade = clamp((elevation - HEIGHT_MIN_M) / (HEIGHT_MAX_M - HEIGHT_MIN_M), 0, 1);
        const ridge = 0.22 + shade * 0.42;
        colors[offset] = ridge * 0.96;
        colors[offset + 1] = ridge * 0.99;
        colors[offset + 2] = ridge;
        if (row < resolution - 1 && col < resolution - 1) {
          const a = row * resolution + col, b = a + 1, c = a + resolution, d = c + 1;
          const cellX = local ? centerX + x : x;
          const cellZ = local ? centerZ + z : z;
      
          const cornersValid = positions[a * 3 + 1] > -10000 && positions[b * 3 + 1] > -10000 && positions[c * 3 + 1] > -10000 && positions[d * 3 + 1] > -10000;
          if (local || (cornersValid && Math.hypot(cellX + cellW / 2, cellZ - cellH / 2) <= MAX_RHO_KM * 1000)) {
            indices[index++] = a; indices[index++] = b; indices[index++] = c;
            indices[index++] = b; indices[index++] = d; indices[index++] = c;
          }
        }
      }
      if(center)yield;
    }
    const geometry = reuse ?? new THREE.BufferGeometry();
    if(reuse){
      geometry.attributes.position.needsUpdate=true;
      geometry.attributes.color.needsUpdate=true;
      geometry.index.needsUpdate=true;
    } else {
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      geometry.setIndex(new THREE.BufferAttribute(local ? indices : indices.subarray(0,index), 1));
    }
    geometry.setDrawRange(0,index);
    // Three computes normals across the index buffer, including inactive entries.
    indices.fill(0,index);
    if(center)yield* computeTerrainNormals(geometry,index);
    else geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    return geometry;
  }

  function* computeTerrainNormals(geometry,indexCount){
    const position=geometry.attributes.position;
    let normal=geometry.attributes.normal;
    if(!normal){
      normal=new THREE.BufferAttribute(new Float32Array(position.count*3),3);
      geometry.setAttribute('normal',normal);
    } else {
      normal.array.fill(0);
    }
    const indices=geometry.index.array;
    const a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3();
    const face=new THREE.Vector3(),edge=new THREE.Vector3(),sum=new THREE.Vector3();
    for(let i=0;i<indexCount;i+=3){
      const ia=indices[i],ib=indices[i+1],ic=indices[i+2];
      a.fromBufferAttribute(position,ia);
      b.fromBufferAttribute(position,ib);
      c.fromBufferAttribute(position,ic);
      face.subVectors(c,b).cross(edge.subVectors(a,b));
      sum.fromBufferAttribute(normal,ia).add(face);normal.setXYZ(ia,sum.x,sum.y,sum.z);
      sum.fromBufferAttribute(normal,ib).add(face);normal.setXYZ(ib,sum.x,sum.y,sum.z);
      sum.fromBufferAttribute(normal,ic).add(face);normal.setXYZ(ic,sum.x,sum.y,sum.z);
      if(i%3072===0)yield;
    }
    for(let i=0;i<normal.count;i++){
      sum.fromBufferAttribute(normal,i).normalize();normal.setXYZ(i,sum.x,sum.y,sum.z);
      if(i%1024===0)yield;
    }
    normal.needsUpdate=true;
  }

  function roverSurface(x,z,ignoreFine=false,onlyGlobal=false) {
    const sampleMesh=(mesh,resolution)=>{
      if(!mesh)return null;
      const p=mesh.geometry.attributes.position.array,ox=mesh.position.x,oz=mesh.position.z;
      const radius=mesh===ground?MAX_RHO_KM*1000:mesh===fineGround?FINE_RADIUS_M:DETAIL_RADIUS_M;
      const minX=-radius+ox,maxZ=radius+oz,stepX=2*radius/(resolution-1),stepZ=stepX;
      const u=(x-minX)/stepX,v=(maxZ-z)/stepZ,col=Math.floor(u),row=Math.floor(v);
      if(col<0||row<0||col>=resolution-1||row>=resolution-1)return null;
      const fx=u-col,fz=v-row,a=(row*resolution+col)*3;
      const h00=p[a+1],h10=p[a+4],h01=p[a+resolution*3+1],h11=p[a+resolution*3+4];
      if(Math.min(h00,h10,h01,h11)<-20000)return null;
      return mesh.position.y+(fx+fz<=1?h00+(h10-h00)*fx+(h01-h00)*fz:h11+(h01-h11)*(1-fx)+(h10-h11)*(1-fz));
    };
    if(onlyGlobal)return sampleMesh(ground,GRID);
    const fine=ignoreFine?null:sampleMesh(fineGround,FINE_GRID);if(fine!==null)return fine;
    const detail=sampleMesh(detailGround,DETAIL_GRID);return detail===null?sampleMesh(ground,GRID):detail;
  }

  function makeMainTerrain() {
    const geometry = makeTerrainGeometry(GRID, -MAX_RHO_KM * 1000, MAX_RHO_KM * 1000, -MAX_RHO_KM * 1000, MAX_RHO_KM * 1000);
    const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.96, metalness: 0, side: THREE.DoubleSide });
    ground = new THREE.Mesh(geometry, material);
    ground.name = 'LOLA South Pole terrain';
    ground.receiveShadow = true;
    ground.frustumCulled = true;
    scene.add(ground);
  }

  function maskCoveredTerrain(mesh,cx,cz,radius){
    if(!mesh)return;
    if(!mesh.userData.fullIndices)mesh.userData.fullIndices=mesh.geometry.index.array.slice();
    const source=mesh.userData.fullIndices;
    const index=mesh.geometry.index;
    if(radius===0){
      index.array.set(source);
      mesh.geometry.setDrawRange(0,source.length);
      index.needsUpdate=true;
      return;
    }
    const positions=mesh.geometry.attributes.position.array;
    const centerX=cx-mesh.position.x, centerZ=cz-mesh.position.z;
    const inside=vertex=>Math.abs(positions[vertex*3]-centerX)<radius
      && Math.abs(positions[vertex*3+2]-centerZ)<radius;
    let used=0;
    for(let i=0;i<source.length;i+=3){
      if(inside(source[i])&&inside(source[i+1])&&inside(source[i+2]))continue;
      index.array[used++]=source[i];
      index.array[used++]=source[i+1];
      index.array[used++]=source[i+2];
    }
    index.needsUpdate=true;
    mesh.geometry.setDrawRange(0,used);
  }

  function makeRevealMaterial(options){
    const material=new THREE.MeshStandardMaterial({...options,alphaHash:true});
    material.onBeforeCompile=shader=>{
      shader.fragmentShader=shader.fragmentShader.replace(
        '#include <alphahash_fragment>',
        'if (opacity < 1.0) {\n#include <alphahash_fragment>\n}'
      );
    };
    return material;
  }

  function rebuildDetailTerrain() {
    const geometry=makeTerrainGeometry(DETAIL_GRID,-DETAIL_RADIUS_M,DETAIL_RADIUS_M,-DETAIL_RADIUS_M,DETAIL_RADIUS_M,true,1,true);
    installDetailTerrain(geometry,{x:targetX,z:targetZ},sampleMeters(targetX,targetZ) ?? 0);
  }

  let detailBuildCenter=null;
  async function queueDetailTerrain(x,z){
    if(detailBuildCenter && Math.hypot(x-detailBuildCenter.x,z-detailBuildCenter.z)<=8000)return;
    const center={x,z};
    detailBuildCenter=center;
    const stale=()=>planMode || detailBuildCenter!==center || Math.hypot(targetX-x,targetZ-z)>8000;
    const elevation=sampleMeters(x,z) ?? 0;
    const builder=buildTerrainGeometry(DETAIL_GRID,-DETAIL_RADIUS_M,DETAIL_RADIUS_M,-DETAIL_RADIUS_M,DETAIL_RADIUS_M,true,1,true,sampleMeters,null,center);
    try{
      const geometry=await buildTerrainAcrossFrames(builder,stale);
      if(!geometry)return;
      if(stale()){geometry.dispose();return;}
      installDetailTerrain(geometry,center,elevation);
    } finally {
      if(detailBuildCenter===center)detailBuildCenter=null;
    }
  }

  function installDetailTerrain(geometry,center,elevation){
    const shouldFade=Boolean(detailGround) && !matchMedia('(prefers-reduced-motion: reduce)').matches;
    if(detailGround){
      detailGround.geometry.dispose();
      detailGround.geometry=geometry;
    } else {
      const material=makeRevealMaterial({vertexColors:true,roughness:.96,side:THREE.DoubleSide,polygonOffset:true,polygonOffsetFactor:-1,polygonOffsetUnits:-1});
      detailGround=new THREE.Mesh(geometry,material);
      scene.add(detailGround);
    }
    detailGround.position.set(center.x,elevation,center.z);
    detailGround.castShadow = true;
    detailGround.receiveShadow = true;
    detailGround.visible = true;
    detailGround.name = 'LOLA detail around the position';
    sunLight.shadow.needsUpdate = true;
    if(fineGround && fineFadeStart===null)maskCoveredTerrain(detailGround,fineGround.position.x,fineGround.position.z,FINE_RADIUS_M-150);
    if(shouldFade){
      maskCoveredTerrain(ground,0,0,0);
      detailFadeStart=performance.now();
      detailGround.material.opacity=0;
      detailGround.castShadow=false;
    } else {
      finishDetailTerrainFade();
    }
    lastDetailRebuild=center;
  }

  function finishDetailTerrainFade(){
    detailFadeStart=null;
    detailGround.material.opacity=1;
    detailGround.castShadow=true;
    maskCoveredTerrain(ground,detailGround.position.x,detailGround.position.z,DETAIL_RADIUS_M-1600);
    sunLight.shadow.needsUpdate=true;
  }

  function clearFineTerrain() {
    fineFadeStart=null;
    if(!fineGround)return;
    if(fineGround){scene.remove(fineGround);fineGround.geometry.dispose();fineGround.material.dispose();fineGround=null;}
    if(detailGround)maskCoveredTerrain(detailGround,0,0,0);
  }

  let spareFineGeometry=null;
  async function buildTerrainAcrossFrames(builder,stale){
    try {
      while(!stale()){
        const start=performance.now();
        do {
          const step=builder.next();
          if(step.done)return step.value;
        } while(performance.now()-start<2.5);
        await new Promise(resolve=>requestAnimationFrame(resolve));
      }
      return null;
    } finally {
      builder.return();
    }
  }

  async function prepareFineTerrain(center,dem,stale){
    const spare=spareFineGeometry;
    spareFineGeometry=null;
    const sample=(x,z)=>dem.sampleMetersWorld(x,z,true);
    const builder=buildTerrainGeometry(FINE_GRID,-FINE_RADIUS_M,FINE_RADIUS_M,-FINE_RADIUS_M,FINE_RADIUS_M,true,1,false,sample,spare,center);
    const geometry=await buildTerrainAcrossFrames(builder,stale);
    if(!geometry)spare?.dispose();
    return geometry;
  }
  function installFineTerrain(geometry,center,elevation){
    const existing=Boolean(fineGround);
    const distance=existing?Math.hypot(center.x-fineGround.position.x,center.z-fineGround.position.z):Infinity;
    const fade=distance>FINE_RADIUS_M && !matchMedia('(prefers-reduced-motion: reduce)').matches;
    if(fineGround){
      spareFineGeometry?.dispose();
      spareFineGeometry=fineGround.geometry;
      fineGround.geometry=geometry;
    } else {
      const material=makeRevealMaterial({vertexColors:true,roughness:.96,side:THREE.DoubleSide,polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-2});
      fineGround=new THREE.Mesh(geometry,material);
      fineGround.castShadow=true;fineGround.receiveShadow=true;
      fineGround.name='Native 30 m LOLA · 12 km patch';
      scene.add(fineGround);
    }
    fineGround.position.set(center.x,elevation,center.z);
    if(fade){
      if(existing)maskCoveredTerrain(detailGround,0,0,0);
      fineFadeStart=performance.now();
      fineGround.material.opacity=0;
      fineGround.castShadow=false;
    } else {
      finishFineTerrainFade();
    }
  }

  function finishFineTerrainFade(){
    fineFadeStart=null;
    fineGround.material.opacity=1;
    fineGround.castShadow=true;
    maskCoveredTerrain(detailGround,fineGround.position.x,fineGround.position.z,FINE_RADIUS_M-150);
    sunLight.shadow.needsUpdate=true;
  }

  function animateTerrainReveal(now){
    if(detailFadeStart!==null){
      const progress=clamp((now-detailFadeStart)/360,0,1);
      detailGround.material.opacity=progress*progress*(3-2*progress);
      if(progress===1)finishDetailTerrainFade();
    }
    if(fineFadeStart!==null){
      const progress=clamp((now-fineFadeStart)/320,0,1);
      fineGround.material.opacity=progress*progress*(3-2*progress);
      if(progress===1)finishFineTerrainFade();
    }
  }

  function makeSiteMarkers() {
    if (!staticMarkersBuilt) {
      const features = [...(window.CEST_DATA?.sites || []), ...(window.CEST_DATA?.catalogue || [])];
      const dotGeometry = new THREE.SphereGeometry(145, 10, 8);
      const dotMaterial = new THREE.MeshBasicMaterial({ color: 0x708b9f });
      const featuredMaterial = new THREE.MeshBasicMaterial({ color: 0xc4e2f1 });
      const favorableMaterial = new THREE.MeshBasicMaterial({ color: 0x4ad295 });
      const favorableRingGeometry = new THREE.TorusGeometry(285, 20, 6, 20);
      const favorableRingMaterial = new THREE.MeshBasicMaterial({ color: 0x4ad295, transparent: true, opacity: 0.75, depthWrite: false });
      const pickGeometry = new THREE.SphereGeometry(520, 8, 6);
      const pickMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, colorWrite: false, depthWrite: false });
      for (const feature of features) {
        const p = polarXY(feature.lat, feature.lon);
        const y = sampleMeters(p.x, p.z) ?? 0;
        const favorable = Boolean(window.CEST_SITE_QUALITY?.[feature.id]?.favorable);
        const featured = Boolean(window.CEST_SITE_QUALITY?.[feature.id]);
        const dot = new THREE.Mesh(dotGeometry, favorable ? favorableMaterial : featured ? featuredMaterial : dotMaterial);
        dot.position.set(p.x, y + 210, p.z);
        dot.userData = { lat: feature.lat, lon: feature.lon, name: feature.name };
        markerGroup.add(dot);
        if (favorable) {
          const ring = new THREE.Mesh(favorableRingGeometry, favorableRingMaterial);
          ring.rotation.x = -Math.PI / 2;
          ring.position.set(p.x, y + 210, p.z);
          markerGroup.add(ring);
        }
        const hitTarget = new THREE.Mesh(pickGeometry, pickMaterial);
        hitTarget.position.copy(dot.position);
        hitTarget.userData = { lat: feature.lat, lon: feature.lon, name: feature.name, sitePickTarget: true };
        markerGroup.add(hitTarget);
      }
      staticMarkersBuilt = true;
    }
    const pos = polarXY(selected.lat, selected.lon);
    if (!selectedMarker) {
      selectedMarker = new THREE.Mesh(new THREE.SphereGeometry(380, 16, 12), new THREE.MeshBasicMaterial({ color: 0xffdc91 }));
      selectedMarker.userData = { selected: true };
      markerGroup.add(selectedMarker);
      selectedMarkerRing = new THREE.Mesh(new THREE.TorusGeometry(620, 34, 8, 32), new THREE.MeshBasicMaterial({ color: 0xffdc91, transparent: true, opacity: 0.68, depthWrite: false }));
      selectedMarkerRing.rotation.x = -Math.PI / 2;
      markerGroup.add(selectedMarkerRing);
    }
    selectedMarker.position.set(pos.x, (sampleMeters(pos.x, pos.z) ?? 0) + 520, pos.z);
    selectedMarkerRing.position.set(pos.x, (sampleMeters(pos.x, pos.z) ?? 0) + 110, pos.z);
  }

  function drawZoneBeacon(ctx, x, y, index, scale = 1) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(scale, scale);
    ctx.beginPath();
    ctx.moveTo(0, 1); ctx.lineTo(-12, -10); ctx.lineTo(-12, -27);
    ctx.lineTo(12, -27); ctx.lineTo(12, -10); ctx.closePath();
    ctx.fillStyle = index === 0 ? '#a6ffce' : '#10261e';
    ctx.fill();
    ctx.strokeStyle = '#a6ffce';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = index === 0 ? '#10261e' : '#d7ffea';
    ctx.font = 'bold 12px Consolas, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(index + 1), 0, -17);
    ctx.restore();
  }

  function setAnalysisZones(zones = []) {
    analysisZones = Array.isArray(zones) ? zones.slice(0, 6) : [];
    while (analysisZoneGroup.children.length) {
      const marker = analysisZoneGroup.children[0];
      analysisZoneGroup.remove(marker);
      marker.material.map.dispose();
      marker.material.dispose();
    }
    analysisZones.forEach((zone, index) => {
      const point = polarXY(zone.lat, zone.lon);
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 128;
      drawZoneBeacon(canvas.getContext('2d'), 64, 123, index, 4);
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      const material = new THREE.SpriteMaterial({ map: texture, depthWrite: false, alphaTest: .1, sizeAttenuation: false });
      const marker = new THREE.Sprite(material);
      marker.center.set(.5, 0);
      marker.scale.setScalar(index === 0 ? .095 : .08);
      marker.position.set(point.x, (sampleMeters(point.x, point.z) ?? 0) + 120, point.z);
      marker.userData = { lat: zone.lat, lon: zone.lon, name: `Rank ${index + 1} candidate` };
      analysisZoneGroup.add(marker);
    });
    analysisZoneGroup.visible = view === 'map' && !planMode;
    if (planMode) drawMap2D();
  }

  function currentSunVectors(index, latitude = selected.lat, longitude = selected.lon) {
    const vectors = window.CEST_SKY[index];
    const lat = latitude * Math.PI / 180, lon = longitude * Math.PI / 180;
    const up = new THREE.Vector3(Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat));
    const east = new THREE.Vector3(-Math.sin(lon), Math.cos(lon), 0);
    const north = new THREE.Vector3(-Math.sin(lat) * Math.cos(lon), -Math.sin(lat) * Math.sin(lon), Math.cos(lat));
    const toLocal = (values) => {
      const body = new THREE.Vector3(values[0], values[1], values[2]).normalize();
      return new THREE.Vector3(body.dot(east), body.dot(up), body.dot(north)).normalize();
    };
    const sun = toLocal(vectors.slice(0, 3));
    const earth = toLocal(vectors.slice(3, 6));
    const earthFromMoon = new THREE.Vector3(...vectors.slice(3, 6));
    const sunFromEarth = new THREE.Vector3(...vectors.slice(0, 3)).sub(earthFromMoon).normalize();
    const moonFromEarth = earthFromMoon.negate().normalize();
    const phase = clamp((1 + sunFromEarth.dot(moonFromEarth)) * 50, 0, 100);
    return { sun, earth, phase };
  }

  let skyTransition=null, skySite=null;
  function applySkyPositions(sun,earth){
    sunVisual.position.copy(sun);
    earthVisual.position.copy(earth);
    const direction=new THREE.Vector3().subVectors(sun,earth).normalize();
    celestialAppearance.atmosphereMaterial.uniforms.sunDirection.value.copy(direction);
    earthVisual.lookAt(earthVisual.position.clone().add(direction));
    earthSunLight.position.copy(earth).addScaledVector(direction,1000000);
    earthSunLight.target.position.copy(earth);
  }
  function setSkyPositions(sun,earth,site){
    const toSun=new THREE.Vector3(sun.x,sun.y,sun.z);
    const toEarth=new THREE.Vector3(earth.x,earth.y,earth.z);
    const moved=skySite && Math.hypot(site.x-skySite.x,site.z-skySite.z)>60;
    skySite=site;
    if(!planMode && (moved || skyTransition) && !matchMedia('(prefers-reduced-motion: reduce)').matches){
      if(skyTransition && skyTransition.toSun.distanceToSquared(toSun)<1 && skyTransition.toEarth.distanceToSquared(toEarth)<1)return;
      skyTransition={
        start:performance.now(),fromSun:sunVisual.position.clone(),fromEarth:earthVisual.position.clone(),toSun,toEarth
      };
      return;
    }
    skyTransition=null;
    applySkyPositions(toSun,toEarth);
  }
  const animatedSun=new THREE.Vector3(),animatedEarth=new THREE.Vector3();
  function animateSkyPositions(now){
    if(!skyTransition)return;
    const {start,fromSun,fromEarth,toSun,toEarth}=skyTransition;
    const t=clamp((now-start)/850,0,1);
    const eased=t*t*(3-2*t);
    applySkyPositions(animatedSun.lerpVectors(fromSun,toSun,eased),animatedEarth.lerpVectors(fromEarth,toEarth,eased));
    if(t===1)skyTransition=null;
  }

  const renderedLightDirection=new THREE.Vector3();
  const targetLightDirection=new THREE.Vector3();
  const renderedLightAnchor=new THREE.Vector3();
  const targetLightAnchor=new THREE.Vector3();
  let lightSettling=false, lightInitialized=false, lightFrameTime=0, lastAnimatedShadow=0;
  function applyTerrainLighting(){
    sunLight.target.position.copy(renderedLightAnchor);
    sunLight.position.copy(renderedLightAnchor).addScaledVector(renderedLightDirection,100000);
  }
  function setTerrainLighting(direction,x,y,z){
    targetLightDirection.copy(direction);
    targetLightAnchor.set(x,y,z);
    if(!lightInitialized || planMode || matchMedia('(prefers-reduced-motion: reduce)').matches){
      renderedLightDirection.copy(targetLightDirection);
      renderedLightAnchor.copy(targetLightAnchor);
      lightInitialized=true;
      lightSettling=false;
      applyTerrainLighting();
      return;
    }
    if(!lightSettling)lightFrameTime=performance.now();
    lightSettling=true;
  }
  function animateTerrainLighting(now){
    if(!lightSettling)return;
    const elapsed=Math.max(0,now-lightFrameTime);
    lightFrameTime=now;
    const blend=1-Math.exp(-elapsed/145);
    renderedLightDirection.lerp(targetLightDirection,blend).normalize();
    renderedLightAnchor.lerp(targetLightAnchor,blend);
    if(renderedLightDirection.distanceToSquared(targetLightDirection)<1e-8 &&
       renderedLightAnchor.distanceToSquared(targetLightAnchor)<1){
      renderedLightDirection.copy(targetLightDirection);
      renderedLightAnchor.copy(targetLightAnchor);
      lightSettling=false;
    }
    applyTerrainLighting();
    if(view!=='map' && (!lightSettling || now-lastAnimatedShadow>=100)){
      sunLight.shadow.needsUpdate=true;
      lastAnimatedShadow=now;
    }
  }

  class LightingTracker {
    update() {
      selectedSky = currentSunVectors(hour);
      const p = polarXY(selected.lat, selected.lon);
      const science = window.CEST_ENGINE, vectors = window.CEST_SKY[hour];
      const base = sampleMeters(p.x, p.z) ?? 0, local = science.basis(selected.lat, selected.lon);
      const observer = local.up.map(value => value * (MOON_RADIUS_KM + base / 1000));
      const currentProfile = activeRow && activeVisibility && activeVisibilityPosition && Math.hypot(p.x - activeVisibilityPosition.x, p.z - activeVisibilityPosition.z) < 60;
      const sunObservation = currentProfile ? null : science.observe(vectors, observer, local, 0);
      const earthObservation = currentProfile ? null : science.observe(vectors, observer, local, 3);
      const row = currentProfile ? activeRow : { s: sunObservation.altitude, sa: sunObservation.azimuth, sd: sunObservation.distanceKm, e: earthObservation.altitude, ea: earthObservation.azimuth, ed: earthObservation.distanceKm };
      const geometry=window.CEST_CELESTIAL,observerWorld={x:p.x,y:base,z:p.z};
      const direction=geometry.position(row.s,row.sa,.001,selected.lon,{x:0,y:0,z:0});
      const sun=new THREE.Vector3(direction.x,direction.y,direction.z);
      setTerrainLighting(sun,p.x,base,p.z);
      const sunDistance=Number.isFinite(row.sd)?row.sd:science.observe(vectors,observer,local,0).distanceKm;
      const earthDistance=Number.isFinite(row.ed)?row.ed:science.observe(vectors,observer,local,3).distanceKm;
      const sunPoint=geometry.position(row.s,row.sa,sunDistance,selected.lon,observerWorld);
      const earthPoint=geometry.position(row.e,row.ea,earthDistance,selected.lon,observerWorld);
      setSkyPositions(sunPoint,earthPoint,p);
      const note=document.querySelector('#celestialScaleNote');
      if(note){
        const sunAngle=geometry.angularDiameter(science.SUN_RADIUS_KM,sunDistance),earthAngle=geometry.angularDiameter(science.EARTH_RADIUS_KM,earthDistance);
        const text=`True angular diameters · Sun ${angularFormat.format(sunAngle)}° · Earth ${angularFormat.format(earthAngle)}° as seen from the site. ${enhancedSky ? 'Display magnification: Sun ×2, Earth ×1.5.' : 'True display scale.'} Positions and distances use DE421.`;
        if(note.textContent!==text)note.textContent=text;
      }
      const heightAt = (latitude, longitude) => { const coordinate = polarXY(latitude, longitude); return sampleMeters(coordinate.x, coordinate.z) ?? base; };
      const condition = currentProfile ? activeVisibility : science.evaluateAtHorizon(
        row,
        horizonAlongAzimuth(selected.lat, selected.lon, row.sa, base),
        horizonAlongAzimuth(selected.lat, selected.lon, row.ea, base),
        science.surfaceNormal(selected.lat, selected.lon, heightAt)
      );
      const incidence = Math.acos(condition.incidenceCosine) * 180 / Math.PI;
      const earthRadius=geometry.angularDiameter(science.EARTH_RADIUS_KM,earthDistance)/2;
      const earthDiskVisible=row.e+earthRadius>condition.eh;
      return { earthDiskVisible, sunAltitude: row.s, sunAzimuth: row.sa, earthAltitude: row.e, earthAzimuth: row.ea, incidence,
        sunVisible: !!condition.s, earthVisible: !!condition.e, directLight: condition.light,
        communication: !!condition.combined, pending: !currentProfile, phase: selectedSky.phase };
    }
  }

  const lightingTracker = new LightingTracker();
  function updateSkyPositionHud(light) {
    const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    const setBody = (body, azimuth, altitude, visible, partial = false) => {
      const point = skyHud.querySelector(body === 'sun' ? '#skySunPoint' : '#skyEarthPoint');
      const position = skyHud.querySelector(body === 'sun' ? '#skySunPosition' : '#skyEarthPosition');
      const visibility = skyHud.querySelector(body === 'sun' ? '#skySunVisibility' : '#skyEarthVisibility');
      const bearing = ((azimuth % 360) + 360) % 360;
      const radians = bearing * Math.PI / 180;
      point.style.left = `${50 + Math.sin(radians) * 34}%`;
      point.style.top = `${50 - Math.cos(radians) * 34}%`;
      point.classList.toggle('is-masked', !visible);
      position.textContent = `${bearing.toFixed(0)}° ${directions[Math.round(bearing / 45) % 8]} · ${altitude >= 0 ? '+' : ''}${altitude.toFixed(1)}°`;
      visibility.textContent = partial ? 'Partly above terrain' : visible ? 'Above terrain' : 'Hidden by terrain';
    };
    setBody('sun', light.sunAzimuth, light.sunAltitude, light.sunVisible);
    setBody('earth', light.earthAzimuth, light.earthAltitude, light.earthDiskVisible, light.earthDiskVisible && !light.earthVisible);
  }
  function updateLighting(force = false) {
    const current = polarXY(selected.lat, selected.lon);
    if (!force && lastLightState.hour === hour && Math.hypot(current.x - lastLightState.x, current.z - lastLightState.z) < 60) return;
    const shadowDistance = Math.hypot(current.x - lastLightState.x, current.z - lastLightState.z);
    const refreshShadows = view!=='map' && (force || lastLightState.hour !== hour || shadowDistance > 1200);
    lastLightState = { hour, x: current.x, z: current.z };
    const light = lightingTracker.update();
    updateSkyPositionHud(light);
    sunVisual.visible = light.sunVisible;
    earthVisual.visible = light.earthDiskVisible;
    if (refreshShadows) {
      sunLight.shadow.needsUpdate = true;
    }
    const readoutSun = `${light.sunAltitude >= 0 ? '+' : ''}${light.sunAltitude.toFixed(1)}° · AZ ${light.sunAzimuth.toFixed(0)}° · INC ${light.incidence.toFixed(0)}°`;
    readout.textContent = `SUN ${readoutSun} · ${light.sunVisible ? 'VISIBLE' : 'HIDDEN'} · EARTH ${light.earthAltitude >= 0 ? '+' : ''}${light.earthAltitude.toFixed(1)}° · ${light.phase.toFixed(0)}% illuminated · ${light.earthVisible ? 'VISIBLE' : light.earthDiskVisible ? 'PARTLY VISIBLE' : 'HIDDEN'}`;
    document.querySelector('#terrainIllumination').textContent = `SUN ${readoutSun} · EARTH ${light.phase.toFixed(0)}%`;
    if (light.pending) {
      const sunStatus = document.querySelector('#fullscreenSunStatus'), earthStatus = document.querySelector('#fullscreenEarthStatus');
      if (sunStatus) { sunStatus.textContent = light.sunVisible ? 'VISIBLE' : 'HIDDEN'; sunStatus.dataset.state = light.sunVisible ? 'visible' : 'hidden'; }
      if (earthStatus) { earthStatus.textContent = light.earthVisible ? 'VISIBLE' : light.earthDiskVisible ? 'PARTLY VISIBLE' : 'HIDDEN'; earthStatus.dataset.state = light.earthDiskVisible ? 'visible' : 'hidden'; earthStatus.setAttribute('aria-label', `Earth · ${earthStatus.textContent.toLowerCase()}`); }
      const directValue = document.querySelector('#fullscreenLightValue'), joint = document.querySelector('#fullscreenBothCurrent');
      if (directValue) directValue.textContent = `${Math.round(light.directLight)} %`;
      if (joint) joint.textContent = light.communication ? 'Sufficient light · Earth visible' : light.earthVisible ? 'Earth visible · Sun below threshold' : 'Link unavailable at this time';
    }
  }

  function setWalkPosition(x, z, notify = false) {
    const r = Math.hypot(x, z), max = MAX_RHO_KM * 1000 - 300;
    if (r > max) { x *= max / r; z *= max / r; }
    const floor = sampleMeters(x, z);
    if (floor === null) return;
    camera.position.set(x, floor + WALK_HEIGHT_M, z);
    if (selectedMarker) selectedMarker.position.set(x, floor + 520, z);
    if (selectedMarkerRing) selectedMarkerRing.position.set(x, floor + 110, z);
    targetX = x; targetZ = z;
    const coord = inversePolar(x, z);
    selected.lat = coord.lat; selected.lon = coord.lon;
    updateTerrainAroundTarget();
    updateLighting();
    updateCoordinateLabel(coord);
    if (notify) scheduleMetricRecalculation(x, z, coord);
  }

  function updateCoordinateLabel(coord) {
    const label = document.querySelector('#coords');
    if (label) label.textContent = `${Math.abs(coord.lat).toFixed(3)}° S · ${coord.lon.toFixed(3)}° ${coord.lon < 0 ? 'W' : 'E'}`;
    const rail = document.querySelector('#railCoords');
    if (rail) rail.textContent = `${Math.abs(coord.lat).toFixed(3)}° S · ${coord.lon.toFixed(3)}° ${coord.lon < 0 ? 'W' : 'E'}`;

  }

  function scheduleMetricRecalculation(x, z, coord) {
    if(secretRover?.active)return;
    const now = performance.now();
    if (Math.hypot(x - lastMetricPosition.x, z - lastMetricPosition.z) < 40) return;
    window.CEST_METRICS_PENDING?.();
    pendingMetricPosition = { x, z, coord };
    if (metricRecalculationTimer) return;
    const delay = Math.max(0, 220 - (now - lastMetricUpdate));
    metricRecalculationTimer = setTimeout(() => {
      metricRecalculationTimer = 0;
      if(secretRover?.active)return;
      const pending = pendingMetricPosition;
      pendingMetricPosition = null;
      if (!pending || Math.hypot(pending.x - lastMetricPosition.x, pending.z - lastMetricPosition.z) < 40) return;
      lastMetricPosition = { x: pending.x, z: pending.z };
      lastMetricUpdate = performance.now();
      window.CEST_RECALCULATE_POSITION?.(pending.coord.lat, pending.coord.lon);
    }, delay);
  }

  let nativeDetailCenter={x:Infinity,z:Infinity};
  let renderPatchCenter=nativeDetailCenter;
  function clearRenderPatch(){
    ++renderPatchGeneration;
    releaseRenderPatch?.();
    releaseRenderPatch=null;
    clearFineTerrain();
    spareFineGeometry?.dispose();
    spareFineGeometry=null;
    nativeDetailCenter={x:Infinity,z:Infinity};
  }

  async function loadNativeDetail(x,z){
    const dem=window.CEST_TILED_DEM;
    if(planMode||!dem?.ready||!detailGround)return;
    nativeDetailCenter={x,z};
    const generation=++renderPatchGeneration;
    const stale=()=>generation!==renderPatchGeneration;
    let release=null;
    try {
      release=await dem.ensureRegionMeters(x,z,FINE_RADIUS_M+650,stale);
      if(stale())return;
      const center={x,z};
      const elevation=dem.sampleMetersWorld(x,z,true) ?? 0;
      const geometry=await prepareFineTerrain(center,dem,stale);
      if(!geometry)return;
      if(stale()){geometry.dispose();return;}
      releaseRenderPatch?.();
      releaseRenderPatch=release;
      release=null;
      renderPatchCenter=center;
      installFineTerrain(geometry,center,elevation);
      makeSiteMarkers();
    } catch(error) {
      if(stale()||error.name==='AbortError')return;
      nativeDetailCenter={x:Infinity,z:Infinity};
      console.warn('30 m detail unavailable:',error);
    } finally {
      release?.();
    }
  }

  function setSite(lat, lon, name = '') {
    if(secretRover?.active)document.dispatchEvent(new CustomEvent('cest:roverclose'));
    const p = polarXY(lat, lon);
    clearTimeout(metricRecalculationTimer);
    metricRecalculationTimer = 0;
    pendingMetricPosition = null;
    lastMetricPosition = { x: p.x, z: p.z };
    lastMetricUpdate = performance.now();
    selected = { ...selected, lat, lon, name: name || selected.name };
    makeSiteMarkers();
    targetX = p.x; targetZ = p.z;
    ++renderPatchGeneration;
    nativeDetailCenter={x:Infinity,z:Infinity};
    pendingLandingTerrain=planMode?null:p;
    updateLighting(true);
    if (planMode) {
      mapCenterX = p.x; mapCenterZ = p.z;
      drawMap2D();
      showMapPointChoice();
      return;
    }
    updateTerrainAroundTarget();
    if (view === 'walk') {
      setView('map', null, siteOverviewDistance());
    } else {
      animateMapTo(p.x, p.z, siteOverviewDistance());
    }
  }

  function setTime(index, row, lat, lon, visibility) {
    hour = clamp(Number(index) || 0, 0, window.CEST_SKY.length - 1);
    activeRow = row || null;
    activeVisibility = visibility || null;
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      selected.lat = lat;
      selected.lon = lon;
    }
    activeVisibilityPosition = activeVisibility ? polarXY(selected.lat, selected.lon) : null;
    updateLighting(true);
  }

  function setMode(next) {
    mode = next;
  }

  function setView(next, onComplete = null, mapDistance = null) {
    if (next === view) {
      if (view === 'map') animateMapTo(targetX, targetZ, Number.isFinite(mapDistance) ? mapDistance : orbitDistance);
      else {
        if (viewAnimationId) cancelAnimationFrame(viewAnimationId);
        viewAnimationId = 0;
        ++viewTransitionId;
        transitioning = false;
        document.body.classList.remove('view-transitioning');
        setWalkPosition(targetX, targetZ, false);
        onComplete?.();
      }
      return;
    }
    if (next === 'map' && document.pointerLockElement) document.exitPointerLock?.();
    if (mapAnimationId) {
      cancelAnimationFrame(mapAnimationId);
      mapAnimationId = 0;
    }
    if (viewAnimationId) {
      cancelAnimationFrame(viewAnimationId);
      viewAnimationId = 0;
    }
    const id = ++viewTransitionId;
    transitioning = true;
    document.body.classList.add('view-transitioning');
    view = next;
    camera.fov = view === 'map' ? DEFAULT_MAP_FOV : 62;
    camera.updateProjectionMatrix();
    markerGroup.visible = view === 'map';
    analysisZoneGroup.visible = view === 'map' && !planMode;
    document.body.classList.toggle('terrain-first-person', view === 'walk');
    document.body.classList.toggle('terrain-map-view', view === 'map');
    sunLight.castShadow = view !== 'map';
    if (view !== 'map') sunLight.shadow.needsUpdate = true;
    if (detailGround) detailGround.visible = true;
    if (view === 'walk') {
      if (Math.hypot(targetX-nativeDetailCenter.x,targetZ-nativeDetailCenter.z)>650) loadNativeDetail(targetX,targetZ);
    }
    const viewButton = document.querySelector('#mapView');
    viewButton.textContent = view === 'map' ? '↗ Site view' : '⌖ Polar map';
    viewButton.setAttribute('aria-label', view === 'map' ? 'Switch to site view' : 'Return to the polar map');

    const startPosition = camera.position.clone();
    const startQuaternion = camera.quaternion.clone();
    const focus = new THREE.Vector3(targetX, mapFocusY(), targetZ);
    const endCamera = new THREE.PerspectiveCamera();
    let endPosition;
    if (view === 'map') {
      orbitDistance = Number.isFinite(mapDistance) ? Math.max(700, mapDistance) : Math.max(700, orbitDistance);
      const pose = mapCameraPose(targetX, targetZ, orbitDistance);
      endPosition = new THREE.Vector3(pose.x, pose.y, pose.z);
      endCamera.position.copy(endPosition);
      endCamera.lookAt(focus);
    } else {
      endPosition = new THREE.Vector3(targetX, (sampleMeters(targetX, targetZ) ?? 0) + WALK_HEIGHT_M, targetZ);
      endCamera.rotation.order = 'YXZ';
      endCamera.rotation.set(pitch, yaw, 0);
    }
    const endQuaternion = endCamera.quaternion.clone();
    const begin = performance.now();
    const duration = viewTransitionDuration();
    const frame = now => {
      if (id !== viewTransitionId) return;
      const t = clamp((now - begin) / duration, 0, 1);
      const eased = t * t * t * (t * (t * 6 - 15) + 10);
      camera.position.lerpVectors(startPosition, endPosition, eased);
      camera.position.y += Math.sin(Math.PI * t) * Math.min(4000, orbitDistance * 0.025);
      camera.quaternion.slerpQuaternions(startQuaternion, endQuaternion, eased);
      if (t < 1) viewAnimationId = requestAnimationFrame(frame);
      else {
        viewAnimationId = 0;
        transitioning = false;
        document.body.classList.remove('view-transitioning');
        if (view === 'walk') setWalkPosition(targetX, targetZ, false);
        onComplete?.();
      }
    };
    viewAnimationId = requestAnimationFrame(frame);
  }

  function animateMapTo(x, z, distance, onComplete = null) {
    if (mapAnimationId) cancelAnimationFrame(mapAnimationId);
    if (viewAnimationId) {
      cancelAnimationFrame(viewAnimationId);
      viewAnimationId = 0;
    }
    const id = ++viewTransitionId;
    transitioning = true;
    document.body.classList.add('view-transitioning');
    targetX = x; targetZ = z; orbitDistance = distance;
    const start = camera.position.clone();
    const startRotation = camera.quaternion.clone();
    const begin = performance.now();
    const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const focusY = mapFocusY(x, z);
    const lookTarget = new THREE.Vector3(x, focusY, z);
    const pose = mapCameraPose(x, z, distance);
    const end = new THREE.Vector3(pose.x, pose.y, pose.z);
    const travel = Math.hypot(end.x - start.x, end.z - start.z);
    const duration = reducedMotion ? 180 : clamp(850 + travel * .009, 850, 2100);
    const lift = reducedMotion ? 0 : Math.min(9000, travel * .055);
    const endRotation = new THREE.Quaternion().setFromRotationMatrix(
      new THREE.Matrix4().lookAt(end, lookTarget, camera.up)
    );
    const frame = now => {
      if (view !== 'map' || id !== viewTransitionId) return;
      const t = clamp((now - begin) / duration, 0, 1);
      const eased = t * t * t * (t * (t * 6 - 15) + 10);
      camera.position.lerpVectors(start, end, eased);
      camera.position.y += Math.sin(Math.PI * eased) ** 2 * lift;
      camera.quaternion.slerpQuaternions(startRotation, endRotation, eased);
      if (t < 1) mapAnimationId = requestAnimationFrame(frame);
      else {
        transitioning = false;
        mapAnimationId = 0;
        settledMapFocus=focusY;
        document.body.classList.remove('view-transitioning');
        onComplete?.();
      }
    };
    mapAnimationId = requestAnimationFrame(frame);
  }

  function updateWalkCamera() {
    if (secretRover?.active || view !== 'walk' || transitioning) return;
    const direction = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
    const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
    const delta = Math.min(0.05, (performance.now() - lastFrame) / 1000);
    // Free-navigation speed with keyboard movement and Shift boost.
    const speed = keys.has('shift') ? 6000 : 1800;
    let dx = 0, dz = 0;
    if (keys.has('w') || keys.has('arrowup')) { dx += direction.x; dz += direction.z; }
    if (keys.has('s') || keys.has('arrowdown')) { dx -= direction.x; dz -= direction.z; }
    if (keys.has('d') || keys.has('arrowright')) { dx += right.x; dz += right.z; }
    if (keys.has('a') || keys.has('arrowleft')) { dx -= right.x; dz -= right.z; }
    const len = Math.hypot(dx, dz);
    if (len > 0) {
      setWalkPosition(camera.position.x + dx / len * speed * delta, camera.position.z + dz / len * speed * delta, true);
      camera.rotation.order = 'YXZ';
      camera.rotation.set(pitch, yaw, 0);
    }
  }

  function updateTerrainAroundTarget(){
    const x=targetX,z=targetZ;
    if (Math.hypot(x-nativeDetailCenter.x,z-nativeDetailCenter.z)>650) loadNativeDetail(x,z);
    if (Math.hypot(x-lastDetailRebuild.x,z-lastDetailRebuild.z)>8000) queueDetailTerrain(x,z).catch(error=>console.warn('Regional terrain unavailable:',error));
  }

  function updateMapRoam() {
    if (secretRover?.active || view !== 'map' || transitioning) return;
    const forward = new THREE.Vector2(-Math.sin(orbitYaw), -Math.cos(orbitYaw));
    const right = new THREE.Vector2(Math.cos(orbitYaw), -Math.sin(orbitYaw));
    let dx = 0, dz = 0;
    if (keys.has('w') || keys.has('arrowup')) { dx += forward.x; dz += forward.y; }
    if (keys.has('s') || keys.has('arrowdown')) { dx -= forward.x; dz -= forward.y; }
    if (keys.has('d') || keys.has('arrowright')) { dx += right.x; dz += right.y; }
    if (keys.has('a') || keys.has('arrowleft')) { dx -= right.x; dz -= right.y; }
    const length = Math.hypot(dx, dz);
    if (!length) return;
    const delta = Math.min(0.05, (performance.now() - lastFrame) / 1000);
    const speed = clamp(orbitDistance * 0.12, 1200, 18000) * (keys.has('shift') ? 3 : 1);
    let x = targetX + dx / length * speed * delta;
    let z = targetZ + dz / length * speed * delta;
    const radius = Math.hypot(x, z), limit = MAX_RHO_KM * 1000 - 150;
    if (radius > limit) { x *= limit / radius; z *= limit / radius; }
    const shiftX = x - targetX, shiftZ = z - targetZ;
    targetX = x; targetZ = z;
    camera.position.x += shiftX;
    camera.position.z += shiftZ;
    updateTerrainAroundTarget();
    const coord = inversePolar(x, z);
    selected.lat = coord.lat; selected.lon = coord.lon;
    const floor = sampleMeters(x, z) ?? 0;
    if (selectedMarker) selectedMarker.position.set(x, floor + 520, z);
    if (selectedMarkerRing) selectedMarkerRing.position.set(x, floor + 110, z);
    updateLighting();
    updateCoordinateLabel(coord);
    scheduleMetricRecalculation(x, z, coord);
  }

  const cueCameraSpace = new THREE.Vector3();
  const cueInverseRotation = new THREE.Quaternion();
  function updateCelestialCues(width, height) {
    if (planMode) {
      sunCue.hidden = true;
      earthCue.hidden = true;
      return;
    }
    cueInverseRotation.copy(camera.quaternion).invert();
    const fullscreen = document.body.classList.contains('terrain-fullscreen');
    const compact = fullscreen && width <= 800;
    // Keep arrows in the free space between HUD instruments.
    const inset = fullscreen && !compact ? Math.min(width * .42, 390) : Math.max(width * .13, 72);
    const left = inset;
    const right = width - inset;
    const top = compact ? height * .56 : height * .29;
    const bottom = compact ? height * .68 : height * .77;
    const centerX = (left + right) / 2;
    const centerY = (top + bottom) / 2;
    const halfFov = Math.tan(camera.fov * Math.PI / 360);
    const updateCue = (cue, object, name, visible) => {
      cueCameraSpace.subVectors(object.position, camera.position).applyQuaternion(cueInverseRotation);
      const inFront = cueCameraSpace.z < -0.001;
      const x = inFront ? cueCameraSpace.x / (-cueCameraSpace.z * halfFov * camera.aspect) : cueCameraSpace.x;
      const y = inFront ? cueCameraSpace.y / (-cueCameraSpace.z * halfFov) : cueCameraSpace.y;
      const onScreen = inFront && Math.abs(x) <= .94 && Math.abs(y) <= .94;
      if (visible && onScreen) { cue.hidden = true; return null; }
      let dx = x, dy = -y;
      if (!Number.isFinite(dx) || !Number.isFinite(dy) || Math.hypot(dx, dy) < 0.001) {
        dx = 0;
        dy = -1;
      }
      const scale = Math.min(
        dx > 0 ? (right - centerX) / Math.abs(dx) : dx < 0 ? (centerX - left) / Math.abs(dx) : Infinity,
        dy > 0 ? (bottom - centerY) / Math.abs(dy) : dy < 0 ? (centerY - top) / Math.abs(dy) : Infinity
      );
      const px = Math.round(centerX + dx * scale);
      const py = Math.round(centerY + dy * scale);
      const angle = Math.atan2(dy, dx) * 180 / Math.PI;
      const roundedAngle = Math.round(angle);
      if (cue._angle !== roundedAngle) {
        cue.style.setProperty('--cue-angle', `${roundedAngle}deg`);
        cue._angle = roundedAngle;
      }
      const label = `${name} · ${visible ? 'off screen' : 'hidden'}`;
      if (cue.dataset.label !== label) {
        cue.querySelector('.celestial-cue-label').textContent = label;
        cue.dataset.label = label;
      }
      cue.hidden = false;
      return { x: px, y: py };
    };
    const sunPosition = updateCue(sunCue, sunVisual, 'Sun', sunVisual.visible);
    const earthPosition = updateCue(earthCue, earthVisual, 'Earth', earthVisual.visible);
    let earthDisplayY = earthPosition?.y;
    if (sunPosition && earthPosition && Math.abs(sunPosition.x - earthPosition.x) < 115 && Math.abs(sunPosition.y - earthPosition.y) < 32) {
      earthDisplayY = earthPosition.y + 34 < bottom ? earthPosition.y + 34 : earthPosition.y - 34;
    }
    for (const [cue, position, displayY] of [[sunCue, sunPosition, sunPosition?.y], [earthCue, earthPosition, earthDisplayY]]) {
      if (!position || (cue._x === position.x && cue._y === displayY)) continue;
      cue.style.transform = `translate3d(${position.x}px, ${displayY}px, 0) translate(-50%, -50%)`;
      cue._x = position.x;
      cue._y = displayY;
    }
  }

  function renderFrame(now) {
    renderFrameId = 0;
    if (document.hidden || planMode) return;
    const activeMotion = detailFadeStart!==null || fineFadeStart!==null || pendingLandingTerrain || lightSettling || skyTransition || keys.size > 0 || pointer || transitioning || viewAnimationId || mapAnimationId || document.pointerLockElement === stage;
    if (!activeMotion && now - lastRenderedAt < 1000 / 30) {
      renderFrameId = requestAnimationFrame(renderFrame);
      return;
    }
    lastRenderedAt = now;
    updateWalkCamera();
    if (view === 'walk' && heightPixels) {
      const floor = sampleMeters(camera.position.x, camera.position.z);
      if (floor !== null && camera.position.y < floor + WALK_HEIGHT_M) camera.position.y = floor + WALK_HEIGHT_M;
    }
    updateMapRoam();
    if (view === 'map' && heightPixels) {
      const { x, z } = camera.position;
      const floor = roverSurface(x, z) ?? sampleMeters(x, z);
      if (floor !== null) camera.position.y = Math.max(camera.position.y, floor + ORBIT_CLEARANCE_METERS);
    }
    const rect = canvas.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) {
      renderFrameId = requestAnimationFrame(renderFrame);
      return;
    }
    const width = Math.round(rect.width), height = Math.round(rect.height);
    if (width !== rendererSize.width || height !== rendererSize.height) {
      renderer.setSize(width, height, false);
      rendererSize = { width, height };
    }
    const previousAspect = camera.aspect, previousNear = camera.near, previousFar = camera.far;
    camera.aspect = rect.width / rect.height;
    if (view === 'map') {
      camera.far = Math.max(14000000, orbitDistance + MAX_RHO_KM * 1000 * 2.6);
      camera.near = transitioning ? 0.5 : clamp(orbitDistance * 0.001, 1, 2000);
    } else {
      camera.near = 0.5;
      camera.far = 14000000;
    }
    if (camera.aspect !== previousAspect || camera.near !== previousNear || camera.far !== previousFar) camera.updateProjectionMatrix();
    if (view === 'map' && !transitioning) {
      const focus = mapFocusY();
      const elapsed = Math.max(0, Math.min(100, now-lastFrame));
      settledMapFocus = settledMapFocus===null ? focus : THREE.MathUtils.lerp(settledMapFocus,focus,1-Math.exp(-elapsed/135));
      camera.lookAt(targetX, settledMapFocus, targetZ);
    } else if (view !== 'map' && !transitioning) {
      camera.rotation.order = 'YXZ';
      camera.rotation.set(pitch, yaw, 0);
    }
    animateTerrainReveal(now);
    animateTerrainLighting(now);
    animateSkyPositions(now);
    updateCelestialCues(rect.width, rect.height);
    renderer.setScissorTest(false);
    renderer.clear(true, true, true);
    renderer.setViewport(0, 0, rect.width, rect.height);
    // Keep the star field at a constant distance to prevent frustum clipping
    // when the orbit camera changes site or zoom level.
    const renderCamera=secretRover?.active?secretRover.renderCamera(rect.width/rect.height):camera;
    starField.position.copy(renderCamera.position);
    if (selectedMarkerRing) selectedMarkerRing.scale.setScalar(1 + Math.sin(now * 0.002) * 0.07);
    const markerVisibility=markerGroup.visible,zoneVisibility=analysisZoneGroup.visible,detailVisibility=detailGround?.visible;
    if(secretRover?.active){markerGroup.visible=false;analysisZoneGroup.visible=false;if(detailGround)detailGround.visible=true;}
    skyCamera.position.copy(renderCamera.position);skyCamera.quaternion.copy(renderCamera.quaternion);
    skyCamera.fov=renderCamera.fov;skyCamera.aspect=renderCamera.aspect;skyCamera.updateProjectionMatrix();
    renderer.render(skyScene,skyCamera);renderer.clearDepth();
    renderer.render(scene, renderCamera);
    markerGroup.visible=markerVisibility;analysisZoneGroup.visible=zoneVisibility;if(detailGround)detailGround.visible=detailVisibility;
    renderer.setScissorTest(false);
    if(pendingLandingTerrain && !transitioning){
      const landing=pendingLandingTerrain;
      pendingLandingTerrain=null;
      requestAnimationFrame(()=>{
        if(planMode || transitioning || pendingLandingTerrain ||
           Math.hypot(targetX-landing.x,targetZ-landing.z)>650)return;
        updateTerrainAroundTarget();
      });
    }
    lastFrame = now;
    renderFrameId = requestAnimationFrame(renderFrame);
  }

  function screenRay(event) {
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left, y = event.clientY - rect.top;
    const ndc = new THREE.Vector2(x / rect.width * 2 - 1, -(y / rect.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    camera.updateMatrixWorld();
    ray.setFromCamera(ndc, camera);
    return ray;
  }
  function intersectRenderedTerrain(ray) {
    const meshes = [ground, detailGround, fineGround].filter(mesh => mesh?.visible);
    for (const mesh of meshes) mesh.updateWorldMatrix(true, false);
    return ray.intersectObjects(meshes, false)[0];
  }

  function screenToTerrain(event) {
    const ray = screenRay(event);
    if (!ray) return null;
    const hit = intersectRenderedTerrain(ray);
    const markerHits = ray.intersectObjects([...markerGroup.children, ...analysisZoneGroup.children], false);
    const marker = markerHits.find(hit => Number.isFinite(hit.object.userData.lat) && Number.isFinite(hit.object.userData.lon));
    if (marker && (!hit || marker.distance <= hit.distance + 1)) return { site: { lat: marker.object.userData.lat, lon: marker.object.userData.lon, name: marker.object.userData.name } };
    if (!hit || sampleMeters(hit.point.x, hit.point.z) === null) return null;
    return { point: hit.point };
  }
  function pointerOnSite(event) {
    const ray = screenRay(event);
    if (!ray) return false;
    const marker = ray.intersectObjects([...markerGroup.children, ...analysisZoneGroup.children], false)
      .find(hit => Number.isFinite(hit.object.userData.lat) && Number.isFinite(hit.object.userData.lon));
    if (!marker) return false;
    const terrain = intersectRenderedTerrain(ray);
    return (!terrain || marker.distance <= terrain.distance + 1);
  }

  function onPointerDown(event) {
    if (transitioning || roverInputSuspended || secretRover?.active) return;
    pointer = { x: event.clientX, y: event.clientY, moved: false, button: event.button, shiftKey: event.shiftKey };
    canvas.style.cursor = event.button === 0 ? 'grabbing' : 'move';
    canvas.setPointerCapture?.(event.pointerId);
  }
  function onPointerMove(event) {
    if (roverInputSuspended || secretRover?.active) return;
    if (!pointer) {
      if (view === 'map' && !planMode) canvas.style.cursor = pointerOnSite(event) ? 'pointer' : 'crosshair';
      return;
    }
    const dx = event.clientX - pointer.x, dy = event.clientY - pointer.y;
    if (Math.abs(dx) + Math.abs(dy) > 2) pointer.moved = true;
    if (view === 'map') {
      const pan = pointer.button === 2 || (pointer.button === 1 && pointer.shiftKey);
      if (pan) {
        const scale = orbitDistance / Math.max(250, canvas.clientHeight);
        targetX -= dx * scale; targetZ += dy * scale;
        camera.position.x -= dx * scale; camera.position.z += dy * scale;
        updateTerrainAroundTarget();
      } else if (pointer.button === 0 || pointer.button === 1) {
        // Dragging orbits opposite to the mouse, as with a rotating camera.
        orbitYaw = (orbitYaw - dx * 0.005) % (2 * Math.PI);
        orbitPolar = clamp(orbitPolar + dy * 0.004, ORBIT_MIN_POLAR, ORBIT_MAX_POLAR);
        orbitDistance = siteOverviewDistance();
        aimMapCamera();
      }
    } else {
      yaw -= dx * 0.003;
      pitch = clamp(pitch - dy * 0.0026, -1.25, 1.25);
    }
    pointer.x = event.clientX; pointer.y = event.clientY;
  }
  function onPointerUp(event) {
    if (roverInputSuspended || secretRover?.active) { cancelPointerInteraction(); return; }
    if (!pointer) return;
    const moved = pointer.moved;
    const button = pointer.button;
    pointer = null;
    canvas.style.cursor = view === 'map' ? 'crosshair' : '';
    if (moved || button !== 0 || view !== 'map') return;
    const hit = screenToTerrain(event);
    if (!hit) return;
    const coord = hit.site || inversePolar(hit.point.x, hit.point.z);
    const name = hit.site?.name || `Coordinates ${coord.lat.toFixed(3)}, ${coord.lon.toFixed(3)}`;
    selected = { ...selected, ...coord, name };
    setSite(coord.lat, coord.lon, name);
    if (window.CEST_SELECT_2D_POINT) window.CEST_SELECT_2D_POINT(coord.lat, coord.lon, name);
    else window.CEST_RECALCULATE_POSITION?.(coord.lat, coord.lon);
  }

  function cancelPointerInteraction() { pointer = null; canvas.style.cursor = view === 'map' ? 'crosshair' : ''; }

  function bindControls() {
    mapCanvas?.addEventListener('pointerdown', event => {
      if (roverInputSuspended || secretRover?.active) return;
      mapPointer = { x: event.clientX, y: event.clientY, moved: false };
      mapCanvas.setPointerCapture?.(event.pointerId);
    });
    mapCanvas?.addEventListener('pointermove', event => {
      if (!planMode) return;
      if (!mapPointer) {
        const site = mapSiteAt(event);
        mapCanvas.style.cursor = site ? 'pointer' : 'crosshair';
        mapCanvas.title = site?.name || '';
        return;
      }
      const dx = event.clientX - mapPointer.x, dy = event.clientY - mapPointer.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) mapPointer.moved = true;
      if (mapPointer.moved && mapScale > 0) {
        mapCenterX -= dx / mapScale; mapCenterZ += dy / mapScale;
        if (!mapDrawFrame) mapDrawFrame = requestAnimationFrame(() => { mapDrawFrame = 0; drawMap2D(); });
      }
      mapPointer.x = event.clientX; mapPointer.y = event.clientY;
    });
    mapCanvas?.addEventListener('pointerup', event => {
      if(secretRover?.active){mapPointer=null;return;}
      if (!mapPointer || !planMode) { mapPointer = null; return; }
      const moved = mapPointer.moved; mapPointer = null;
      if (moved || mapScale <= 0) return;
      const site = mapSiteAt(event);
      if (site) {
        setSite(site.lat, site.lon, site.name);
        window.CEST_SELECT_MAP_SITE?.(site);
        return;
      }
      const rect = mapCanvas.getBoundingClientRect();
      const x = mapCenterX + (event.clientX - rect.left - rect.width / 2) / mapScale;
      const z = mapCenterZ - (event.clientY - rect.top - rect.height / 2) / mapScale;
      if (sampleMeters(x, z) === null) return;
      const coord = inversePolar(x, z);
      const name = `Coordinates ${coord.lat.toFixed(3)}, ${coord.lon.toFixed(3)}`;
      setSite(coord.lat, coord.lon, name);
      if (window.CEST_SELECT_2D_POINT) window.CEST_SELECT_2D_POINT(coord.lat, coord.lon, name);
      else window.CEST_RECALCULATE_POSITION?.(coord.lat, coord.lon);
    });
    mapCanvas?.addEventListener('pointercancel', () => { mapPointer = null; });
    mapCanvas?.addEventListener('wheel', event => {
      if (roverInputSuspended || secretRover?.active) return;
      if (!planMode) return;
      event.preventDefault();
      mapZoom = clamp(mapZoom * Math.exp(-event.deltaY * 0.0012), 0.01, 24);
      drawMap2D();
    }, { passive: false });
    document.querySelector('#view2D')?.addEventListener('click', () => set2DMode(true));
    document.querySelector('#view3D')?.addEventListener('click', () => set2DMode(false));
    document.querySelector('#mapNatural')?.addEventListener('click', () => setMapStyle('natural'));
    document.querySelector('#mapHeatmap')?.addEventListener('click', () => setMapStyle('heatmap'));
    document.querySelector('#stay2D')?.addEventListener('click', () => document.querySelector('#mapPointChoice')?.classList.remove('visible'));
    document.querySelector('#go3D')?.addEventListener('click', () => {
      set2DMode(false, false);
      setView('map', null, siteOverviewDistance());
    });
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', cancelPointerInteraction);
    canvas.addEventListener('lostpointercapture', cancelPointerInteraction);
    canvas.addEventListener('contextmenu', event => event.preventDefault());
    canvas.addEventListener('wheel', event => {
      if (roverInputSuspended || secretRover?.active) return;
      event.preventDefault();
      camera.fov = clamp(camera.fov + event.deltaY * 0.025, 42, 82);
      camera.updateProjectionMatrix();
    }, { passive: false });
    window.addEventListener('keydown', event => {
      if (roverInputSuspended || secretRover?.active) return;
      const target = event.target;
      if (target?.closest?.('input, textarea, select, [contenteditable="true"]') || document.querySelector('.modal-backdrop.open')) return;
      const key = event.key.toLowerCase();
      if (['w','a','s','d','arrowup','arrowdown','arrowleft','arrowright','shift'].includes(key)) {
        keys.add(key); event.preventDefault();
      }
    });
    window.addEventListener('keyup', event => keys.delete(event.key.toLowerCase()));
    window.addEventListener('blur', () => { keys.clear(); cancelPointerInteraction(); });
    document.querySelector('#mapView').addEventListener('click', async () => {
      const next = view === 'map' ? 'walk' : 'map';
      setView(next);
      if (next === 'walk' && mode === 'public') {
        try { await stage.requestPointerLock?.(); }
        catch (error) { console.warn('Pointer lock is unavailable here.', error); }
      }
    });
    document.querySelector('#zoomIn').addEventListener('click', () => {
      if (planMode) { mapZoom = clamp(mapZoom * 1.3, 0.01, 24); drawMap2D(); }
      else { camera.fov = Math.max(42, camera.fov - 5); camera.updateProjectionMatrix(); }
    });
    document.querySelector('#zoomOut').addEventListener('click', () => {
      if (planMode) { mapZoom = clamp(mapZoom / 1.3, 0.01, 24); drawMap2D(); }
      else { camera.fov = Math.min(82, camera.fov + 5); camera.updateProjectionMatrix(); }
    });
    document.querySelector('#viewHeightSlider')?.addEventListener('input', event => {
      const value = clamp(Number(event.currentTarget.value), MIN_SITE_ALTITUDE_M, MAX_SITE_ALTITUDE_M);
      const output = document.querySelector('#viewHeightValue');
      if (output) output.textContent = formatAltitude(value);
    });
    document.querySelector('#viewHeightSlider')?.addEventListener('change', event => setSiteAltitude(event.currentTarget.value));
    document.querySelector('#resetView').addEventListener('click', () => {
      if (planMode) { mapCenterX = targetX; mapCenterZ = targetZ; mapZoom = 1; drawMap2D(); return; }
      orbitYaw = 0.48; orbitPolar = DEFAULT_ORBIT_POLAR; orbitDistance = siteOverviewDistance();
      camera.fov = view === 'map' ? DEFAULT_MAP_FOV : 62; camera.updateProjectionMatrix();
      setView('map');
    });
    canvas.addEventListener('dblclick', async () => {
      if (view !== 'walk' || planMode) return;
      try { await stage.requestPointerLock?.(); } catch (error) { console.warn('Pointer lock is unavailable here.', error); }
    });
    document.addEventListener('pointerlockchange', () => {
      if (document.pointerLockElement === stage) {
        document.addEventListener('mousemove', onLockedMouseMove);
      } else {
        document.removeEventListener('mousemove', onLockedMouseMove);
      }
    });
  }
  function onLockedMouseMove(event) {
    if (roverInputSuspended || secretRover?.active) return;
    yaw -= event.movementX * 0.0023;
    pitch = clamp(pitch - event.movementY * 0.002, -1.25, 1.25);
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      if (renderFrameId) cancelAnimationFrame(renderFrameId);
      renderFrameId = 0;
    } else if (!planMode && !renderFrameId) {
      lastRenderedAt = 0;
      renderFrameId = requestAnimationFrame(renderFrame);
    }
  });

  // Redraw before paint whenever layout changes the canvas size.
  new ResizeObserver(() => {
    if(planMode)drawMap2D();
  }).observe(mapCanvas);
  document.addEventListener('cest:fullscreenchange', () => {
    if(planMode)drawMap2D();
  });

  function loadHeightMap() {
    const loadImage = source => new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error(`Unable to decode LOLA file ${source}.`));
      image.src = source;
    });
    return (async () => {
      if(window.CEST_DEM.manifest){
        const data=await window.CEST_TILED_DEM.init();width=data.width;height=data.height;heightPixels=data.pixels;
        window.CEST_APP_SET_HEIGHTMAP?.({width,height},heightPixels);
        return;
      }
      const highImage = await loadImage(window.CEST_DEM.high);
      width = highImage.naturalWidth; height = highImage.naturalHeight;
      if (width < 128 || height < 128) throw new Error('The LOLA heightmap is too small for a reliable mesh.');
      const offscreen = document.createElement('canvas');
      offscreen.width = width; offscreen.height = height;
      const context = offscreen.getContext('2d', { willReadFrequently: true });
      if (!context) throw new Error('The browser cannot decode the LOLA heightmap in memory.');
      heightPixels = new Uint16Array(width * height);
      const decodeChannel = async (image, highByte) => {
        context.drawImage(image, 0, 0);
        const rowsPerBatch = 64;
        for (let row = 0; row < height; row += rowsPerBatch) {
          const rows = Math.min(rowsPerBatch, height - row);
          const pixels = context.getImageData(0, row, width, rows).data;
          for (let source = 0, target = row * width; source < pixels.length; source += 4, target++) {
            if (highByte) heightPixels[target] = pixels[source] << 8;
            else heightPixels[target] |= pixels[source];
          }
          // Yield to the interface without dropping any DEM samples.
          if (((row / rowsPerBatch) & 7) === 7) await new Promise(resolve => setTimeout(resolve, 0));
        }
        context.clearRect(0, 0, width, height);
      };
      await decodeChannel(highImage, true);
      highImage.src = '';
      const lowImage = await loadImage(window.CEST_DEM.low);
      if (lowImage.naturalWidth !== width || lowImage.naturalHeight !== height) throw new Error('The two LOLA heightmap layers have different dimensions.');
      await decodeChannel(lowImage, false);
      lowImage.src = '';
      offscreen.width = 1; offscreen.height = 1;
      window.CEST_APP_SET_HEIGHTMAP?.({ width, height }, heightPixels);
    })();
  }

  async function initialize() {
    try {
      document.querySelector('#terrainLoading').textContent = 'Reading the LOLA heightmap…';
      await loadHeightMap();
      makeMainTerrain();
      makeSiteMarkers();
      activeVisibility = window.CEST_TILED_DEM?.ready?null:window.CEST_DATA?.sites?.find(site => site.lat === selected.lat && site.lon === selected.lon)?.visibility?.[hour] || null;
      bindControls();
      const p = polarXY(selected.lat, selected.lon);
      targetX = p.x; targetZ = p.z;
      orbitDistance = siteOverviewDistance();
      const overview = mapCameraPose(p.x, p.z, orbitDistance);
      camera.position.set(overview.x, overview.y, overview.z);
      camera.lookAt(p.x, overview.focusY, p.z);
      yaw = selected.lon * Math.PI / 180;
      pitch = -0.08;
      rebuildDetailTerrain();
      loadNativeDetail(targetX,targetZ);
      if (detailGround) detailGround.visible = true;
      markerGroup.visible = true;
      document.body.classList.remove('terrain-first-person');
      document.body.classList.add('terrain-map-view');
      document.querySelector('#mapView').textContent = '↗ Site view';
      document.querySelector('#mapView').setAttribute('aria-label', 'Switch to site view');
      updateLighting();
      document.querySelector('#terrainLoading').classList.remove('visible');
      secretRover=window.CEST_CREATE_ROVER3D?.({THREE,scene,surface:roverSurface,origin:()=>{
        const radius=Math.hypot(targetX,targetZ),limit=MAX_RHO_KM*1000-1800;
        const scale=radius>limit?limit/radius:1;
        return {x:targetX*scale,z:targetZ*scale};
      }});
      window.CEST_TERRAIN3D = { rover:secretRover, setSite, setTime, setMode, setView, set2DMode, setSiteAltitude, setAnalysisZones, present2DChoice: showMapPointChoice, dispose: () => { if (renderFrameId) cancelAnimationFrame(renderFrameId); if (mapDrawFrame) cancelAnimationFrame(mapDrawFrame); secretRover?.dispose(); renderer.dispose(); } };
      setMode(mode);
      window.CEST_SYNC_TERRAIN?.();
      renderFrameId = requestAnimationFrame(renderFrame);
      document.dispatchEvent(new CustomEvent('cest:terrainready'));
    } catch (error) {
      console.error('Lunar terrain loading failed:', error);
      const loading = document.querySelector('#terrainLoading');
      if (location.protocol === 'file:') {
        document.body.classList.add('local-file-load-error');
        loading.textContent = 'The 3D terrain cannot load its files through file://. Run Start Cest Lunaire.cmd in this folder to open the app locally.';
      } else {
        loading.textContent = `LOLA terrain failed: ${error.message}`;
      }
      loading.classList.add('visible');
    }
  }

  initialize();
})();
