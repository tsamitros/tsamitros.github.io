// ============================================================================
// combat.js — shared hit-detection and damage rules used by both the
// player's weapon and enemy AI gunfire. One raycast decides everything: it
// intersects hitbox meshes AND wall/furniture occluders together, so a wall
// between shooter and target simply wins the raycast — bullets never punch
// through solid geometry.
//
// Damage rule (exact, per spec): a headshot is an instant kill. Any other
// body part (chest, either arm, either leg) counts toward a shared "hits
// taken" counter — the second such hit (from any of those parts) kills.
// This matches the brief's repeated "two shots to chest / arm / leg" while
// staying a single, consistent, non-random rule.
// ============================================================================
import * as THREE from 'three';
import { bulletHoleTexture } from './utils.js';

export function raycastHitscan(raycaster, origin, direction, hitboxMeshes, occluderMeshes, maxDist = 40){
  raycaster.set(origin, direction);
  raycaster.far = maxDist;
  raycaster.near = 0.05;
  const targets = hitboxMeshes.concat(occluderMeshes);
  const hits = raycaster.intersectObjects(targets, false);
  if (!hits.length) return null;
  const nearest = hits[0];
  const isHitbox = !!(nearest.object.userData && nearest.object.userData.hitboxPart);
  return {
    mesh: nearest.object,
    point: nearest.point,
    normal: nearest.face ? nearest.face.normal.clone().transformDirection(nearest.object.matrixWorld) : new THREE.Vector3(0, 1, 0),
    distance: nearest.distance,
    isCharacterHit: isHitbox,
    part: isHitbox ? nearest.object.userData.hitboxPart : null,
    owner: isHitbox ? nearest.object.userData.owner : null,
  };
}

// Applies one successful hit to a "combatant" (player or enemy instance).
// A combatant must expose: .hitsTaken (number), .alive (bool), .onHit(part),
// .onDeath(headshot).
export function applyHit(combatant, part){
  if (!combatant || !combatant.alive) return { killed: false };
  const isHeadshot = part === 'head';
  if (isHeadshot){
    combatant.alive = false;
    combatant.onDeath(true);
    return { killed: true, headshot: true };
  }
  combatant.hitsTaken = (combatant.hitsTaken || 0) + 1;
  combatant.onHit(part);
  if (combatant.hitsTaken >= 2){
    combatant.alive = false;
    combatant.onDeath(false);
    return { killed: true, headshot: false };
  }
  return { killed: false, headshot: false };
}

// ---- Visual/audio-adjacent effects (muzzle flash, impacts) ----------------

const _decalPool = [];
const MAX_DECALS = 40;

export function spawnBulletImpact(scene, point, normal, quality){
  const size = 0.12 + Math.random() * 0.05;
  const geo = new THREE.PlaneGeometry(size, size);
  const mat = new THREE.MeshBasicMaterial({ map: bulletHoleTexture(), transparent: true, depthWrite: false });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.copy(point).addScaledVector(normal, 0.01);
  mesh.lookAt(point.clone().add(normal));
  scene.add(mesh);
  _decalPool.push(mesh);
  if (_decalPool.length > MAX_DECALS){
    const old = _decalPool.shift();
    scene.remove(old);
    old.geometry.dispose(); old.material.dispose();
  }

  // Small debris puff — particle count scaled by graphics quality.
  const count = Math.round(6 * (quality ? quality.particleScale : 1));
  if (count > 0){
    const puffGeo = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++){
      positions[i*3] = point.x; positions[i*3+1] = point.y; positions[i*3+2] = point.z;
    }
    puffGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const puffMat = new THREE.PointsMaterial({ color: 0xcfc7b8, size: 0.035, transparent: true, opacity: 0.8 });
    const puff = new THREE.Points(puffGeo, puffMat);
    const velocities = [];
    for (let i = 0; i < count; i++){
      velocities.push(new THREE.Vector3(
        normal.x + (Math.random()-0.5)*0.8,
        Math.random() * 0.6 + 0.2,
        normal.z + (Math.random()-0.5)*0.8
      ));
    }
    scene.add(puff);
    let life = 0;
    function tick(dt){
      life += dt;
      const pos = puff.geometry.attributes.position;
      for (let i = 0; i < count; i++){
        pos.array[i*3]   += velocities[i].x * dt;
        pos.array[i*3+1] += (velocities[i].y - life * 1.8) * dt;
        pos.array[i*3+2] += velocities[i].z * dt;
      }
      pos.needsUpdate = true;
      puffMat.opacity = Math.max(0, 0.8 - life * 1.6);
      if (life > 0.5){
        scene.remove(puff); puffGeo.dispose(); puffMat.dispose();
        return false;
      }
      return true;
    }
    return tick;
  }
  return null;
}

export function spawnMuzzleFlash(scene, position, quality){
  const light = new THREE.PointLight(0xffcc77, 6, 3.2, 2.0);
  light.position.copy(position);
  scene.add(light);
  const geo = new THREE.SphereGeometry(0.06, 6, 6);
  const mat = new THREE.MeshBasicMaterial({ color: 0xffdca0, transparent: true, opacity: 0.95 });
  const flash = new THREE.Mesh(geo, mat);
  flash.position.copy(position);
  scene.add(flash);
  let life = 0;
  function tick(dt){
    life += dt;
    light.intensity = Math.max(0, 6 * (1 - life / 0.06));
    flash.scale.setScalar(1 + life * 8);
    mat.opacity = Math.max(0, 0.95 - life * 14);
    if (life > 0.07){
      scene.remove(light); scene.remove(flash);
      geo.dispose(); mat.dispose();
      return false;
    }
    return true;
  }
  return tick;
}
