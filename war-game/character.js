// ============================================================================
// character.js — shared low-poly soldier rig used by both the player and
// enemies. Built from primitives grouped into a pivot hierarchy so we can
// procedurally animate it (no external model/animation files needed).
// Each hitbox-relevant mesh is tagged with userData.hitboxPart so the combat
// system's raycaster can tell exactly which body part was hit.
// ============================================================================
import * as THREE from 'three';

export function buildSoldierMesh(scheme = {}){
  const skin = scheme.skin || 0xc79a72;
  const uniform = scheme.uniform || 0x3d4a3a;
  const uniformDark = scheme.uniformDark || 0x2a3324;
  const gear = scheme.gear || 0x23261f;
  const matSkin = new THREE.MeshStandardMaterial({ color: skin, roughness: 0.85 });
  const matUniform = new THREE.MeshStandardMaterial({ color: uniform, roughness: 0.9 });
  const matUniformDark = new THREE.MeshStandardMaterial({ color: uniformDark, roughness: 0.9 });
  const matGear = new THREE.MeshStandardMaterial({ color: gear, roughness: 0.7, metalness: 0.15 });
  const matBoot = new THREE.MeshStandardMaterial({ color: 0x1c1a17, roughness: 0.8 });

  const root = new THREE.Group();

  // Hips pivot — global crouch offset applied here.
  const hips = new THREE.Group();
  hips.position.y = 0.92;
  root.add(hips);

  // ---- Torso / chest hitbox ----
  const torsoPivot = new THREE.Group();
  hips.add(torsoPivot);
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.58, 0.24), matUniform);
  torso.position.y = 0.29;
  torso.userData.hitboxPart = 'chest';
  torso.castShadow = true; torso.receiveShadow = true;
  torsoPivot.add(torso);
  const vest = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.32, 0.27), matGear);
  vest.position.y = 0.34;
  vest.castShadow = true;
  torsoPivot.add(vest);

  // ---- Head (its own pivot for look/aim + hit reactions) ----
  const headPivot = new THREE.Group();
  headPivot.position.set(0, 0.58 + 0.16, 0);
  torsoPivot.add(headPivot);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.15, 12, 10), matSkin);
  head.userData.hitboxPart = 'head';
  head.castShadow = true;
  headPivot.add(head);
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.165, 12, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), matUniformDark);
  helmet.position.y = 0.02;
  helmet.castShadow = true;
  headPivot.add(helmet);

  // ---- Arms ----
  function buildArm(side){
    const sign = side === 'left' ? -1 : 1;
    const shoulder = new THREE.Group();
    shoulder.position.set(sign * 0.26, 0.52, 0);
    torsoPivot.add(shoulder);
    const upper = new THREE.Mesh(new THREE.CapsuleGeometry(0.055, 0.28, 4, 6), matUniform);
    upper.position.y = -0.16;
    upper.castShadow = true;
    shoulder.add(upper);

    const elbow = new THREE.Group();
    elbow.position.y = -0.32;
    shoulder.add(elbow);
    const lower = new THREE.Mesh(new THREE.CapsuleGeometry(0.05, 0.26, 4, 6), matSkin);
    lower.position.y = -0.15;
    lower.userData.hitboxPart = side === 'left' ? 'leftArm' : 'rightArm';
    lower.castShadow = true;
    elbow.add(lower);

    const hand = new THREE.Group();
    hand.position.y = -0.3;
    elbow.add(hand);

    return { shoulder, elbow, hand };
  }
  const leftArm = buildArm('left');
  const rightArm = buildArm('right');

  // ---- Legs ----
  function buildLeg(side){
    const sign = side === 'left' ? -1 : 1;
    const hip = new THREE.Group();
    hip.position.set(sign * 0.12, 0, 0);
    hips.add(hip);
    const upper = new THREE.Mesh(new THREE.CapsuleGeometry(0.07, 0.32, 4, 6), matUniformDark);
    upper.position.y = -0.18;
    upper.castShadow = true;
    hip.add(upper);

    const knee = new THREE.Group();
    knee.position.y = -0.36;
    hip.add(knee);
    const lower = new THREE.Mesh(new THREE.CapsuleGeometry(0.06, 0.3, 4, 6), matUniformDark);
    lower.position.y = -0.17;
    lower.userData.hitboxPart = side === 'left' ? 'leftLeg' : 'rightLeg';
    lower.castShadow = true;
    knee.add(lower);

    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.08, 0.2), matBoot);
    foot.position.set(0, -0.36, 0.04);
    foot.castShadow = true;
    knee.add(foot);

    return { hip, knee };
  }
  const leftLeg = buildLeg('left');
  const rightLeg = buildLeg('right');

  // Collect every hitbox mesh for fast raycasting.
  const hitboxMeshes = [];
  root.traverse(o => { if (o.userData && o.userData.hitboxPart) hitboxMeshes.push(o); });

  return {
    root, hips, torsoPivot, headPivot, leftArm, rightArm, leftLeg, rightLeg,
    hitboxMeshes,
  };
}

export const PLAYER_SCHEME = { uniform: 0x3d4a3a, uniformDark: 0x2a3324, gear: 0x23261f, skin: 0xc79a72 };
export const ENEMY_SCHEMES = {
  rifle:      { uniform: 0x5a3030, uniformDark: 0x3a1e1e, gear: 0x201414, skin: 0xb98a63 },
  defensive:  { uniform: 0x30405a, uniformDark: 0x1e2a3a, gear: 0x141c20, skin: 0xa98a6c },
  aggressive: { uniform: 0x5a4a20, uniformDark: 0x3a3014, gear: 0x201a10, skin: 0xb08662 },
};
