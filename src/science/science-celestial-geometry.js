/* Physical celestial geometry. Coordinates/radii in this scene use the terrain's metre scale. */
(function(root){
  'use strict';
  function position(altitude,azimuth,distanceKm,longitude,observer){
    if(!Number.isFinite(distanceKm)||distanceKm<=0)throw new RangeError('Distance astronomique invalide.');
    const a=altitude*Math.PI/180,b=azimuth*Math.PI/180,l=longitude*Math.PI/180,d=distanceKm*1000;
    const east=Math.cos(a)*Math.sin(b),north=Math.cos(a)*Math.cos(b);
    return {x:observer.x+d*(east*Math.cos(l)-north*Math.sin(l)),y:observer.y+d*Math.sin(a),z:observer.z+d*(-east*Math.sin(l)-north*Math.cos(l))};
  }
  function angularDiameter(radiusKm,distanceKm){
    if(!Number.isFinite(distanceKm)||distanceKm<=radiusKm)return null;
    return 2*Math.asin(radiusKm/distanceKm)*180/Math.PI;
  }
  const api={position,angularDiameter};
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.CEST_CELESTIAL=api;
})(typeof window!=='undefined'?window:null);
