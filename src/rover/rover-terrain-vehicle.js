/* A playful rover rendered by the existing Three.js renderer and lunar scene. */
(() => {
  'use strict';
  window.CEST_CREATE_ROVER3D=({THREE,scene,surface,origin})=>{
    const DRIVE_SPEED=20,PLAY_RADIUS=20000;
    const root=new THREE.Group();root.name='Hidden rover · mini-game';root.visible=false;scene.add(root);
    const body=new THREE.Group();root.add(body);
    const white=new THREE.MeshStandardMaterial({color:0xd9e1e6,roughness:.65,metalness:.3,emissive:0x344452,emissiveIntensity:.35});
    const dark=new THREE.MeshStandardMaterial({color:0x18232c,roughness:.95,emissive:0x17232d,emissiveIntensity:.25});
    const blue=new THREE.MeshStandardMaterial({color:0x285a86,roughness:.35,metalness:.5,emissive:0x14314a,emissiveIntensity:.4});
    const gold=new THREE.MeshStandardMaterial({color:0xd5ac58,roughness:.5,metalness:.4,emissive:0x59421a,emissiveIntensity:.25});
    const lamp=new THREE.MeshBasicMaterial({color:0xd7f3ff});
    function box(w,h,d,x,y,z,material=white,parent=body){const mesh=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),material);mesh.position.set(x,y,z);parent.add(mesh);return mesh;}
    box(2.7,.75,3.8,0,1.4,0);box(2.4,.28,3.2,0,1.96,.15,gold);box(3.5,.1,2.2,0,2.2,.5,blue);
    for(let i=-1;i<=1;i++)box(.025,.015,2.2,i,2.26,.5,white);
    for(let i=-1;i<=1;i++)box(3.5,.015,.025,0,2.26,.5+i*.65,white);
    box(.12,1.9,.12,0,2.9,-1.1,white);box(.8,.38,.45,0,3.8,-1.1,white);
    box(.2,.18,.05,-.2,3.8,-1.35,lamp);box(.2,.18,.05,.2,3.8,-1.35,lamp);
    box(.08,2.1,.08,1,2.8,.9,gold);
    const dish=new THREE.Mesh(new THREE.ConeGeometry(.45,.2,16,1,true),white);dish.position.set(1,3.85,.9);dish.rotation.z=.5;body.add(dish);
    box(.4,.22,.1,-.95,1.48,-1.96,lamp);box(.4,.22,.1,.95,1.48,-1.96,lamp);
    const wheels=[];
    for(const side of [-1,1])for(const z of [-1.35,0,1.35]){
      box(.65,.12,.15,side*1.5,.95,z,gold);
      const axle=new THREE.Group();axle.position.set(side*1.75,.65,z);body.add(axle);wheels.push(axle);
      const tire=new THREE.Mesh(new THREE.CylinderGeometry(.65,.65,.48,16),dark);tire.rotation.z=Math.PI/2;axle.add(tire);
      const hub=new THREE.Mesh(new THREE.CylinderGeometry(.25,.25,.51,12),white);hub.rotation.z=Math.PI/2;axle.add(hub);
      for(let i=0;i<8;i++){const a=i*Math.PI/4;const tread=box(.52,.08,.16,0,Math.cos(a)*.64,Math.sin(a)*.64,white,axle);tread.rotation.x=a;}
    }
    const shadow=new THREE.Mesh(new THREE.CircleGeometry(2.4,24),new THREE.MeshBasicMaterial({color:0x080b10,transparent:true,opacity:.28,depthWrite:false,side:THREE.DoubleSide}));shadow.rotation.x=-Math.PI/2;root.add(shadow);
    const particlePositions=new Float32Array(36),particleGeometry=new THREE.BufferGeometry();particleGeometry.setAttribute('position',new THREE.BufferAttribute(particlePositions,3));
    const particleMaterial=new THREE.PointsMaterial({color:0xbac4ca,size:.13,transparent:true,opacity:.35,depthWrite:false});
    const dust=new THREE.Points(particleGeometry,particleMaterial);root.add(dust);dust.visible=false;
    const tracks=new THREE.InstancedMesh(new THREE.PlaneGeometry(.38,.7).rotateX(-Math.PI/2),new THREE.MeshBasicMaterial({color:0x5c6570,transparent:true,opacity:.6,depthWrite:false,side:THREE.DoubleSide}),192);
    tracks.name='Decorative rover tracks';tracks.count=0;tracks.visible=false;tracks.frustumCulled=false;scene.add(tracks);
    const stampMatrix=new THREE.Matrix4(),stampPosition=new THREE.Vector3(),stampScale=new THREE.Vector3(1,1,1);
    let stampIndex=0,stampCount=0,stampDistance=0,traveled=0,atBoundary=false,currentSpeed=0;
    const camera=new THREE.PerspectiveCamera(55,1,.15,14000000);
    const cameraGoal=new THREE.Vector3(),forward=new THREE.Vector3(),side=new THREE.Vector3();let cameraReady=false;
    let active=false,x=0,z=0,heading=0,jump=0,velocity=0,phase=0,reduced=false,center={x:0,z:0};
    function height(px,pz){const value=surface(px,pz);return Number.isFinite(value)?value:null;}
    function pose(dt=1/60){
      const h=height(x,z);if(h===null)return;
      root.position.set(x,h+.06,z);body.position.y=jump;
      forward.set(Math.sin(heading),0,-Math.cos(heading));
      side.set(Math.cos(heading),0,Math.sin(heading));
      const ahead=height(x+forward.x*1.5,z+forward.z*1.5)??h,behind=height(x-forward.x*1.5,z-forward.z*1.5)??h;
      const left=height(x-side.x,z-side.z)??h,right=height(x+side.x,z+side.z)??h;
      body.rotation.set(Math.atan2(ahead-behind,3),-heading,Math.atan2(right-left,2),'YXZ');
      shadow.position.y=.015;shadow.scale.setScalar(1-jump*.08);
      const cx=x-forward.x*18,cz=z-forward.z*18;
      const camFloor=height(cx,cz)??h;
      cameraGoal.set(cx,Math.max(h+8+jump,camFloor+4),cz);
      if(!cameraReady){camera.position.copy(cameraGoal);cameraReady=true;}else camera.position.lerp(cameraGoal,reduced?1:1-Math.exp(-10*Math.max(0,dt)));
      camera.position.y=Math.max(camera.position.y,(height(camera.position.x,camera.position.z)??h)+4);
      camera.lookAt(x,root.position.y+1.95+jump,z);
    }
    function open(){
      const requested=origin();if(!requested)return false;
      let p={x:requested.x,z:requested.z};
      if(height(p.x,p.z)===null){
        // Find a nearby rendered triangle at the data edge, without changing the observation site.
        p=null;
        for(const radius of [25,100,400,1200,3200]){
          for(let i=0;i<16;i++){
            const a=i*Math.PI/8,candidate={x:requested.x+Math.cos(a)*radius,z:requested.z+Math.sin(a)*radius};
            if(height(candidate.x,candidate.z)!==null){p=candidate;break;}
          }
          if(p)break;
        }
        if(!p)return false;
      }
      center={x:p.x,z:p.z};x=p.x;z=p.z;heading=0;jump=0;velocity=0;phase=0;
      active=true;root.visible=true;dust.visible=false;cameraReady=false;stampIndex=0;stampCount=0;stampDistance=0;traveled=0;atBoundary=false;currentSpeed=0;tracks.count=0;tracks.visible=true;pose();return true;
    }
    function close(){currentSpeed=0;active=false;root.visible=false;tracks.visible=false;dust.visible=false;jump=0;velocity=0;}
    function step(dt,drive=0,steer=0){
      if(!active)return false;
      dt=Math.min(Math.max(dt,0),.04);heading+=steer*1.2*dt;
      const speed=DRIVE_SPEED;
      const distance=drive*speed*dt,nx=x+Math.sin(heading)*distance,nz=z-Math.cos(heading)*distance;
      const moved=Math.hypot(nx-center.x,nz-center.z)<=PLAY_RADIUS&&height(nx,nz)!==null;
      atBoundary=Boolean(drive)&&!moved;currentSpeed=moved?Math.abs(drive)*speed:0;
      if(moved){x=nx;z=nz;traveled+=Math.abs(distance);stampDistance+=Math.abs(distance);if(!reduced)wheels.forEach(w=>w.rotation.x-=distance/.65);}
      if(jump>0||velocity>0){velocity-=1.62*dt;jump=Math.max(0,jump+velocity*dt);if(!jump&&velocity<0)velocity=0;}
      phase+=dt;dust.visible=!reduced&&Boolean(drive)&&moved&&jump===0;
      if(dust.visible){for(let i=0;i<12;i++){const age=(phase*.8+i/12)%1;particlePositions[i*3]=Math.sin(heading)*(-1-age*3)+(i%2?1:-1)*1.7;particlePositions[i*3+1]=.12+Math.sin(age*Math.PI)*.4;particlePositions[i*3+2]=-Math.cos(heading)*(-1-age*3);}particleGeometry.attributes.position.needsUpdate=true;}
      pose(dt);
      if(moved&&drive&&jump===0&&stampDistance>=.8){
        stampDistance=0;
        for(const side of [-1,1]){
          const tx=x+Math.cos(heading)*side*1.75,tz=z+Math.sin(heading)*side*1.75;
          const floor=height(tx,tz);if(floor===null)continue;
          stampPosition.set(tx,floor+.08,tz);stampMatrix.compose(stampPosition,body.quaternion,stampScale);
          tracks.setMatrixAt(stampIndex,stampMatrix);stampIndex=(stampIndex+1)%192;stampCount=Math.min(192,stampCount+1);
        }
        tracks.count=stampCount;tracks.instanceMatrix.needsUpdate=true;
      }
      return Boolean(drive||steer||jump>0||velocity>0);
    }
    function hop(){if(active&&!reduced&&!jump&&!velocity)velocity=1.7;}
    function pause(){currentSpeed=0;dust.visible=false;}
    function setReducedMotion(value){reduced=value;if(value){jump=0;velocity=0;dust.visible=false;pose();}}
    function renderCamera(aspect){if(camera.aspect!==aspect){camera.aspect=aspect;camera.updateProjectionMatrix();}return camera;}
    function dispose(){close();scene.remove(root);scene.remove(tracks);tracks.geometry.dispose();tracks.material.dispose();const geometries=new Set(),materials=new Set();root.traverse(o=>{if(o.geometry)geometries.add(o.geometry);if(o.material)materials.add(o.material);});geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());}
    return {get active(){return active;},open,close,step,hop,pause,setReducedMotion,renderCamera,dispose,status:()=>({traveled,atBoundary,speed:currentSpeed,playRadius:PLAY_RADIUS})};
  };
})();
