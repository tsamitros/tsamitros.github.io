// ============================================================================
// utils.js — small shared helpers: math, random, procedural canvas textures.
// Keeping texture generation procedural means the game needs zero external
// image assets (no loading stalls, nothing that can 404 on GitHub Pages).
// ============================================================================
import * as THREE from 'three';

export function clamp(v, min, max){ return Math.max(min, Math.min(max, v)); }

// Removes an Object3D (and every descendant) from its parent and frees its
// GPU-side geometry/material buffers. Used when a mission restarts so the
// previous player/enemy rigs (or house) don't linger in the scene graph as
// invisible-but-still-rendered orphans (a real, if slow, memory/draw-call leak).
//
// `disposeTextures` defaults to true (safe for player/enemy rigs, whose
// materials/textures are built fresh per-instance). Pass false for objects
// whose materials reference the module-level procedural-texture cache in
// this file (e.g. the house — see woodTexture/tileTexture/etc. above),
// since those texture objects are shared and reused by the NEXT build.
export function disposeObject3D(root, disposeTextures = true){
  if (!root) return;
  root.traverse(obj => {
    if (obj.geometry) obj.geometry.dispose();
    if (obj.material){
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      mats.forEach(m => {
        if (!m) return;
        if (disposeTextures){
          for (const key of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'alphaMap', 'emissiveMap']){
            if (m[key]) m[key].dispose();
          }
        }
        m.dispose();
      });
    }
    // Shadow-casting lights (e.g. the house's sun DirectionalLight) allocate
    // a GPU shadow-map render target the first time they render — that's a
    // texture too, and it isn't freed just by removing the light from the
    // scene, so it has to be disposed explicitly or it leaks one texture
    // per rebuild.
    if (obj.isLight && obj.shadow && obj.shadow.map){
      obj.shadow.map.dispose();
      obj.shadow.map = null;
    }
  });
  if (root.parent) root.parent.remove(root);
}
export function lerp(a, b, t){ return a + (b - a) * t; }
export function damp(current, target, lambda, dt){
  // Frame-rate independent exponential smoothing (Lerp toward target).
  return lerp(current, target, 1 - Math.exp(-lambda * dt));
}
export function randRange(min, max){ return min + Math.random() * (max - min); }
export function randInt(min, max){ return Math.floor(randRange(min, max + 1)); }
export function choice(arr){ return arr[Math.floor(Math.random() * arr.length)]; }
export function angleLerp(a, b, t){
  let diff = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (diff < -Math.PI) diff += Math.PI * 2;
  return a + diff * t;
}

// ---------------------------------------------------------------------------
// Procedural texture factory — draws simple grain/noise patterns to a canvas
// so materials (wood floor, tile, carpet, wallpaper) don't need image files.
// ---------------------------------------------------------------------------
const _cache = {};

function makeCanvas(size){
  const c = document.createElement('canvas');
  c.width = size; c.height = size;
  return c;
}

export function woodTexture(baseColor = '#7a5230', grainColor = '#5c3c22'){
  const key = 'wood_' + baseColor + grainColor;
  if (_cache[key]) return _cache[key];
  const size = 256;
  const c = makeCanvas(size);
  const ctx = c.getContext('2d');
  ctx.fillStyle = baseColor;
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = grainColor;
  for (let i = 0; i < 40; i++){
    ctx.globalAlpha = 0.08 + Math.random() * 0.12;
    ctx.lineWidth = 1 + Math.random() * 2;
    const y = (i / 40) * size + randRange(-3, 3);
    ctx.beginPath();
    ctx.moveTo(0, y);
    for (let x = 0; x <= size; x += 16){
      ctx.lineTo(x, y + Math.sin(x * 0.05 + i) * 3);
    }
    ctx.stroke();
  }
  // plank seams
  ctx.globalAlpha = 0.5;
  ctx.strokeStyle = 'rgba(0,0,0,0.25)';
  ctx.lineWidth = 2;
  for (let x = 0; x < size; x += size / 4){
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, size); ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  _cache[key] = tex;
  return tex;
}

export function tileTexture(baseColor = '#c9c9c9', lineColor = '#9a9a9a'){
  const key = 'tile_' + baseColor + lineColor;
  if (_cache[key]) return _cache[key];
  const size = 256;
  const c = makeCanvas(size);
  const ctx = c.getContext('2d');
  ctx.fillStyle = baseColor;
  ctx.fillRect(0, 0, size, size);
  const grid = 4;
  ctx.strokeStyle = lineColor;
  ctx.lineWidth = 3;
  for (let i = 0; i <= grid; i++){
    const p = (i / grid) * size;
    ctx.beginPath(); ctx.moveTo(p, 0); ctx.lineTo(p, size); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, p); ctx.lineTo(size, p); ctx.stroke();
  }
  // subtle speckle
  for (let i = 0; i < 300; i++){
    ctx.globalAlpha = 0.03 + Math.random() * 0.05;
    ctx.fillStyle = Math.random() > 0.5 ? '#000' : '#fff';
    ctx.fillRect(Math.random() * size, Math.random() * size, 2, 2);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  _cache[key] = tex;
  return tex;
}

export function carpetTexture(baseColor = '#5a2f3a'){
  const key = 'carpet_' + baseColor;
  if (_cache[key]) return _cache[key];
  const size = 128;
  const c = makeCanvas(size);
  const ctx = c.getContext('2d');
  ctx.fillStyle = baseColor;
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 2200; i++){
    ctx.globalAlpha = 0.04 + Math.random() * 0.10;
    ctx.fillStyle = Math.random() > 0.5 ? '#000' : '#fff';
    ctx.fillRect(Math.random() * size, Math.random() * size, 1.5, 1.5);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  _cache[key] = tex;
  return tex;
}

export function plasterTexture(baseColor = '#cfc7bd'){
  const key = 'plaster_' + baseColor;
  if (_cache[key]) return _cache[key];
  const size = 256;
  const c = makeCanvas(size);
  const ctx = c.getContext('2d');
  ctx.fillStyle = baseColor;
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 900; i++){
    ctx.globalAlpha = 0.02 + Math.random() * 0.05;
    ctx.fillStyle = Math.random() > 0.5 ? '#000' : '#fff';
    const r = Math.random() * 2.2;
    ctx.beginPath(); ctx.arc(Math.random() * size, Math.random() * size, r, 0, Math.PI * 2); ctx.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  _cache[key] = tex;
  return tex;
}

export function bulletHoleTexture(){
  const key = 'bullethole';
  if (_cache[key]) return _cache[key];
  const size = 64;
  const c = makeCanvas(size);
  const ctx = c.getContext('2d');
  const grad = ctx.createRadialGradient(size/2, size/2, 0, size/2, size/2, size/2);
  grad.addColorStop(0, 'rgba(10,10,10,0.9)');
  grad.addColorStop(0.4, 'rgba(20,20,20,0.6)');
  grad.addColorStop(0.75, 'rgba(30,30,30,0.25)');
  grad.addColorStop(1, 'rgba(30,30,30,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 10; i++){
    const a = Math.random() * Math.PI * 2;
    const len = size * 0.25 + Math.random() * size * 0.2;
    ctx.strokeStyle = 'rgba(10,10,10,0.4)';
    ctx.lineWidth = 1 + Math.random();
    ctx.beginPath();
    ctx.moveTo(size/2, size/2);
    ctx.lineTo(size/2 + Math.cos(a) * len, size/2 + Math.sin(a) * len);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  _cache[key] = tex;
  return tex;
}

// Simple axis-aligned box collider used for both static geometry (walls,
// furniture) and dynamic entities (player, enemies). Kept independent of
// Three.js Box3 so we can do fast 2D (XZ-plane) resolution for movement.
export class AABB {
  constructor(minX, minZ, maxX, maxZ, minY = 0, maxY = 3){
    this.minX = minX; this.minZ = minZ; this.maxX = maxX; this.maxZ = maxZ;
    this.minY = minY; this.maxY = maxY;
  }
  static fromCenter(cx, cz, hw, hd, minY = 0, maxY = 3){
    return new AABB(cx - hw, cz - hd, cx + hw, cz + hd, minY, maxY);
  }
  intersectsCircleXZ(cx, cz, r){
    const nx = clamp(cx, this.minX, this.maxX);
    const nz = clamp(cz, this.minZ, this.maxZ);
    const dx = cx - nx, dz = cz - nz;
    return (dx*dx + dz*dz) < r*r;
  }
  containsPointXZ(x, z){
    return x >= this.minX && x <= this.maxX && z >= this.minZ && z <= this.maxZ;
  }
}

// Resolve a moving circle (radius r) against a list of AABBs by pushing it
// out along the axis of least penetration. Good enough for a rectangular
// house layout without pulling in a full physics engine.
export function resolveCircleCollisions(pos, r, boxes){
  for (let iter = 0; iter < 3; iter++){
    for (const b of boxes){
      const nx = clamp(pos.x, b.minX, b.maxX);
      const nz = clamp(pos.z, b.minZ, b.maxZ);
      const dx = pos.x - nx, dz = pos.z - nz;
      const distSq = dx*dx + dz*dz;
      if (distSq < r*r){
        const dist = Math.sqrt(distSq);
        if (dist > 0.0001){
          const push = (r - dist) / dist;
          pos.x += dx * push;
          pos.z += dz * push;
        } else {
          // Center is inside the box — push out along smallest overlap axis.
          const overlapX = Math.min(pos.x - b.minX, b.maxX - pos.x);
          const overlapZ = Math.min(pos.z - b.minZ, b.maxZ - pos.z);
          if (overlapX < overlapZ){
            pos.x += (pos.x - (b.minX + b.maxX) / 2) > 0 ? overlapX : -overlapX;
          } else {
            pos.z += (pos.z - (b.minZ + b.maxZ) / 2) > 0 ? overlapZ : -overlapZ;
          }
        }
      }
    }
  }
  return pos;
}

export function lineOfSightBlocked(origin, target, occluderMeshes, raycaster){
  const dir = new THREE.Vector3().subVectors(target, origin);
  const dist = dir.length();
  if (dist < 0.001) return false;
  dir.normalize();
  raycaster.set(origin, dir);
  raycaster.far = dist - 0.15;
  raycaster.near = 0.01;
  const hits = raycaster.intersectObjects(occluderMeshes, false);
  return hits.length > 0;
}
