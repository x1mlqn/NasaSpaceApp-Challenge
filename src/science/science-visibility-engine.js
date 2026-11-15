/* Shared scientific calculations for views, statistics, charts and exports. */
(() => {
  'use strict';
  const DEG = Math.PI / 180;
  const MOON_RADIUS_KM = 1737.4;
  // NASA NSSDC volumetric mean radii; shared with the 3D representation.
  // https://nssdc.gsfc.nasa.gov/planetary/factsheet/sunfact.html
  const SUN_RADIUS_KM = 695700;
  const EARTH_RADIUS_KM = 6371;
  const MIN_DIRECT_LIGHT_PERCENT = 10;
  const MODEL_VERSION = 'lola60-engine1';
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

  function basis(latitude, longitude) {
    const phi = latitude * DEG, lambda = longitude * DEG;
    const cp = Math.cos(phi), sp = Math.sin(phi), cl = Math.cos(lambda), sl = Math.sin(lambda);
    return {
      up: [cp * cl, cp * sl, sp],
      east: [-sl, cl, 0],
      north: [-sp * cl, -sp * sl, cp]
    };
  }

  function observe(vector, siteVector, local, offset = 0) {
    const dx = vector[offset] - siteVector[0], dy = vector[offset + 1] - siteVector[1], dz = vector[offset + 2] - siteVector[2];
    const distanceKm = Math.hypot(dx, dy, dz);
    if (!(distanceKm > 0)) throw new Error('Vecteur astronomique invalide.');
    const x = dx / distanceKm, y = dy / distanceKm, z = dz / distanceKm;
    const dot = axis => x * axis[0] + y * axis[1] + z * axis[2];
    return {
      altitude: Math.asin(clamp(dot(local.up), -1, 1)) / DEG,
      azimuth: (Math.atan2(dot(local.east), dot(local.north)) / DEG + 360) % 360,
      distanceKm
    };
  }

  function destination(latitude, longitude, azimuth, distanceKm) {
    const phi = latitude * DEG, lambda = longitude * DEG, az = azimuth * DEG, arc = distanceKm / MOON_RADIUS_KM;
    const sinPhi = Math.sin(phi), cosPhi = Math.cos(phi), sinArc = Math.sin(arc), cosArc = Math.cos(arc);
    const phi2 = Math.asin(clamp(sinPhi * cosArc + cosPhi * sinArc * Math.cos(az), -1, 1));
    const lambda2 = lambda + Math.atan2(Math.sin(az) * sinArc * cosPhi, cosArc - sinPhi * Math.sin(phi2));
    return { latitude: phi2 / DEG, longitude: lambda2 / DEG };
  }

  function surfaceNormal(latitude, longitude, heightAt, spacingMeters = 225) {
    const height = azimuth => { const point = destination(latitude, longitude, azimuth, spacingMeters / 1000); return heightAt(point.latitude, point.longitude); };
    const eastSlope = (height(90) - height(270)) / (2 * spacingMeters);
    const northSlope = (height(0) - height(180)) / (2 * spacingMeters);
    const length = Math.hypot(eastSlope, northSlope, 1);
    return { east: -eastSlope / length, north: -northSlope / length, up: 1 / length };
  }

  function horizonAt(profile, azimuth) {
    if (!profile || profile.length < 2) throw new Error('Missing horizon profile.');
    const position = ((azimuth % 360) + 360) % 360 * profile.length / 360;
    const index = Math.floor(position), fraction = position - index;
    return profile[index] * (1 - fraction) + profile[(index + 1) % profile.length] * fraction;
  }

  function visibleDiskFraction(altitude, horizon, radius) {
    const offset = (altitude - horizon) / radius;
    if (offset <= -1) return 0;
    if (offset >= 1) return 1;
    return (Math.acos(-offset) + offset * Math.sqrt(1 - offset * offset)) / Math.PI;
  }

  function evaluateAtHorizon(row, sunHorizon, earthHorizon, normal) {
    const sunRadius = Math.asin(clamp(SUN_RADIUS_KM / (row.sd || 149597870.7), 0, 1)) / DEG;
    const sunDiskFraction = visibleDiskFraction(row.s, sunHorizon, sunRadius);
    const sunAltitude = row.s * DEG, sunAzimuth = row.sa * DEG;
    const incidenceCosine = clamp(
      normal.east * Math.cos(sunAltitude) * Math.sin(sunAzimuth) +
      normal.north * Math.cos(sunAltitude) * Math.cos(sunAzimuth) +
      normal.up * Math.sin(sunAltitude), -1, 1);
    const incidence = Math.max(0, incidenceCosine);
    const directLightPercent = 100 * sunDiskFraction * incidence;
    const sunVisible = sunDiskFraction > 0;
    // The center of Earth is the geometric target of the radio-link proxy.
    const earthVisible = row.e > earthHorizon;
    const sunAvailable = directLightPercent >= MIN_DIRECT_LIGHT_PERCENT;
    return {
      s: Number(sunVisible), e: Number(earthVisible), sh: sunHorizon, eh: earthHorizon,
      disk: sunDiskFraction, incidence, incidenceCosine, light: directLightPercent,
      available: Number(sunAvailable), combined: Number(sunAvailable && earthVisible)
    };
  }

  function evaluateHour(row, profile, normal) {
    return evaluateAtHorizon(row, horizonAt(profile, row.sa), horizonAt(profile, row.ea), normal);
  }

  function windowsFor(flags) {
    const windows = []; let start = -1;
    for (let index = 0; index <= flags.length; index++) {
      if (index < flags.length && flags[index]) { if (start < 0) start = index; }
      else if (start >= 0) { windows.push({ start, end: index - 1, hours: index - start }); start = -1; }
    }
    return windows;
  }

  function earthPhasePercent(vectors) {
    const toSun = [vectors[0] - vectors[3], vectors[1] - vectors[4], vectors[2] - vectors[5]];
    const toMoon = [-vectors[3], -vectors[4], -vectors[5]];
    const dot = toSun[0] * toMoon[0] + toSun[1] * toMoon[1] + toSun[2] * toMoon[2];
    return 50 * (1 + clamp(dot / (Math.hypot(...toSun) * Math.hypot(...toMoon)), -1, 1));
  }

  function evaluateSeries(series, profile, normal) {
    if (!Array.isArray(series) || !series.length) throw new Error('Missing astronomical time series.');
    if (!profile || profile.length < 2 || Array.from(profile).some(value => !Number.isFinite(value))) throw new Error('Invalid horizon profile.');
    if (!normal || ![normal.east, normal.north, normal.up].every(Number.isFinite)) throw new Error('Invalid terrain normal.');
    const visibility = series.map(row => evaluateHour(row, profile, normal));
    const sunVisibleFlags = visibility.map(value => Boolean(value.s));
    const solarFlags = visibility.map(value => Boolean(value.available));
    const earthFlags = visibility.map(value => Boolean(value.e));
    const combinedFlags = visibility.map(value => Boolean(value.combined));
    const percent = flags => 100 * flags.filter(Boolean).length / flags.length;
    const stats = {
      sun: +percent(sunVisibleFlags).toFixed(1),
      earth: +percent(earthFlags).toFixed(1),
      both: +percent(combinedFlags).toFixed(1),
      flatSun: +(100 * series.filter(row => row.s + Math.asin(clamp(SUN_RADIUS_KM / (row.sd || 149597870.7), 0, 1)) / DEG > 0).length / series.length).toFixed(1),
      flatEarth: +(100 * series.filter(row => row.e > 0).length / series.length).toFixed(1)
    };
    return { visibility, sunVisibleFlags, solarFlags, earthFlags, combinedFlags, combinedWindows: windowsFor(combinedFlags), stats,
      sunDirectPercent: percent(solarFlags).toFixed(1), earthVisiblePercent: percent(earthFlags).toFixed(1) };
  }

  const engine = Object.freeze({ MODEL_VERSION, MOON_RADIUS_KM, SUN_RADIUS_KM, EARTH_RADIUS_KM, MIN_DIRECT_LIGHT_PERCENT, basis, observe, destination, surfaceNormal, horizonAt, visibleDiskFraction, evaluateAtHorizon, evaluateHour, evaluateSeries, windowsFor, earthPhasePercent });
  if (typeof module === 'object' && module.exports) module.exports = engine;
  if (typeof window !== 'undefined') window.CEST_ENGINE = engine;
})();
