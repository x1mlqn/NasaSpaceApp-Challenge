/* Readability treatment only: physical geometry, horizon tests and illumination metrics are unchanged. */
(() => {
  window.CEST_CELESTIAL_APPEARANCE=(THREE,sunRadius)=>{
    const vertex=`varying vec2 vUv;varying vec3 vNormal;varying vec3 vView;varying vec3 vWorldNormal;
      void main(){vUv=uv;vNormal=normalize(normalMatrix*normal);vWorldNormal=normalize(mat3(modelMatrix)*normal);vec4 p=modelViewMatrix*vec4(position,1.0);vView=-p.xyz;gl_Position=projectionMatrix*p;}`;
    const sunMaterial=new THREE.ShaderMaterial({toneMapped:false,vertexShader:vertex,fragmentShader:`
      varying vec2 vUv;varying vec3 vNormal;varying vec3 vView;
      float grain(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
      void main(){float mu=max(dot(normalize(vNormal),normalize(vView)),0.0);
        float limb=smoothstep(0.0,0.72,mu);
        float detail=(grain(floor(vUv*180.0))-.5)*.035;
        vec3 edge=vec3(1.0,.69,.26),core=vec3(1.0,.98,.86);
        gl_FragColor=vec4(mix(edge,core,limb)+detail,1.0);
        #include <colorspace_fragment>
      }`});
    const atmosphereMaterial=new THREE.ShaderMaterial({transparent:true,depthWrite:false,side:THREE.BackSide,blending:THREE.AdditiveBlending,toneMapped:false,uniforms:{sunDirection:{value:new THREE.Vector3(0,1,0)}},vertexShader:vertex,fragmentShader:`
      uniform vec3 sunDirection;varying vec3 vNormal;varying vec3 vView;varying vec3 vWorldNormal;
      void main(){float rim=pow(1.0-abs(dot(normalize(vNormal),normalize(vView))),2.6);
        float day=max(dot(normalize(vWorldNormal),normalize(sunDirection)),0.0);
        gl_FragColor=vec4(.16,.48,1.0,rim*(.05+.42*sqrt(day)));
        #include <colorspace_fragment>
      }`});
    const canvas=document.createElement('canvas');canvas.width=256;canvas.height=256;
    const ctx=canvas.getContext('2d'),gradient=ctx.createRadialGradient(128,128,0,128,128,128);
    gradient.addColorStop(0,'rgba(255,220,140,0)');gradient.addColorStop(.37,'rgba(255,220,140,0)');
    gradient.addColorStop(.41,'rgba(255,205,100,.55)');gradient.addColorStop(.55,'rgba(255,164,55,.24)');
    gradient.addColorStop(.78,'rgba(255,132,40,.075)');gradient.addColorStop(1,'rgba(255,120,20,0)');
    ctx.fillStyle=gradient;ctx.fillRect(0,0,256,256);
    const glowTexture=new THREE.CanvasTexture(canvas);glowTexture.colorSpace=THREE.SRGBColorSpace;
    const glow=new THREE.Sprite(new THREE.SpriteMaterial({map:glowTexture,color:0xffdf9b,transparent:true,blending:THREE.AdditiveBlending,depthWrite:false,depthTest:true,toneMapped:false}));
    glow.name='Halo solaire · effet optique';glow.scale.set(sunRadius*5,sunRadius*5,1);
    return {sunMaterial,atmosphereMaterial,glow};
  };
})();