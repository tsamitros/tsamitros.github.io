// ============================================================================
// player.js — PlayerController: movement, collision, crouch/jump, footsteps,
// weapon mounting, and the "combatant" interface (hitsTaken/alive/onHit/
// onDeath) so enemy gunfire can damage the player through the same combat.js
// rules used against enemies.
// ============================================================================
import * as THREE from 'three';
import { buildSoldierMesh, PLAYER_SCHEME } from './character.js';
import { SoldierAnimator } from './animation.js';
import { resolveCircleCollisions, clamp, damp, disposeObject3D } from './utils.js';
import { getFloorSurfaceAt as floorAt } from './world.js';

const WALK_SPEED = 2.1;
const RUN_SPEED = 4.6;
const CROUCH_SPEED = 1.2;
const AIM_SPEED_MULT = 0.55;
const PLAYER_RADIUS = 0.32;
const MAX_HEALTH = 100;

export class PlayerController {
  constructor({ scene, world, audio, inputState, quality }){
    this.scene = scene;
    this.world = world;
    this.audio = audio;
    this.input = inputState;
    this.quality = quality;

    this.rig = buildSoldierMesh(PLAYER_SCHEME);
    this.rig.root.position.copy(world.playerSpawn);
    scene.add(this.rig.root);
    this.animator = new SoldierAnimator(this.rig);

    // Player's own hitboxes so enemies can shoot at them.
    this.rig.hitboxMeshes.forEach(m => { m.userData.owner = this; });

    // Weapon meshes mounted to the right hand.
    this.gunMesh = buildPistolMesh();
    this.knifeMesh = buildKnifeMesh();
    this.rig.rightArm.hand.add(this.gunMesh);
    this.rig.rightArm.hand.add(this.knifeMesh);
    this.knifeMesh.visible = false;

    this.yaw = Math.PI; // facing north into the house from the spawn point
    this.pitch = 0;
    this.position = this.rig.root.position;
    this.velocityY = 0;
    this.grounded = true;
    this.crouching = false;
    this.aiming = false;
    this.sprinting = false;
    this.health = MAX_HEALTH;
    this.alive = true;
    this.hitsTaken = 0;
    this.movingSpeed01 = 0;
    this._footstepTimer = 0;
    this._noiseCooldown = 0;
    this.lastNoisePosition = null;
    this.lastNoiseRadius = 0;
    this.lastNoiseTime = -999;
    this.weaponSlot = 1;

    this.damageFlashCallback = null; // set by main.js -> UI vignette
    this.onDeathCallback = null;
    this.onHitCallback = null;
    this.onNoise = null; // (position, radius) => void, wired by main.js -> enemy AI hearing
  }

  // Called just before a mission (re)build replaces this controller, so the
  // old rig doesn't keep rendering (invisibly, since nothing references it
  // any more) as an orphaned scene node.
  dispose(){ disposeObject3D(this.rig.root); }

  getPosition(){ return this.rig.root.position; }
  getEyePosition(){
    return new THREE.Vector3(
      this.rig.root.position.x,
      this.rig.root.position.y + (this.crouching ? 1.15 : 1.55),
      this.rig.root.position.z
    );
  }

  setWeaponSlot(slot){
    this.weaponSlot = slot;
    this.gunMesh.visible = slot === 1;
    this.knifeMesh.visible = slot === 2;
  }

  emitNoise(radius){
    if (this.onNoise) this.onNoise(this.getPosition().clone(), radius);
  }

  // ---- combat.js interface ----
  onHit(part){
    this.health = Math.max(0, this.health - 34);
    this.animator.triggerHit(part);
    this.audio.hitGrunt();
    if (this.damageFlashCallback) this.damageFlashCallback(part);
    if (this.onHitCallback) this.onHitCallback(part, this.health);
    if (this.health <= 0 && this.alive){
      this.alive = false;
      this.onDeath(false);
    }
  }
  onDeath(headshot){
    this.alive = false;
    this.animator.triggerDeath(headshot);
    this.audio.deathSound();
    if (this.onDeathCallback) this.onDeathCallback(headshot);
  }

  respawn(){
    this.rig.root.position.copy(this.world.playerSpawn);
    this.rig.root.rotation.set(0, 0, 0);
    this.yaw = Math.PI; this.pitch = 0;
    this.health = MAX_HEALTH;
    this.alive = true;
    this.hitsTaken = 0;
    this.velocityY = 0; this.grounded = true;
    this.crouching = false; this.aiming = false;
    this.animator.deathT = -1;
    this.animator.deathHeadshot = false;
    this.setWeaponSlot(1);
  }

  update(dt, enabled){
    if (!this.alive){
      this.animator.update(dt, {});
      return;
    }
    if (!enabled){ this.animator.update(dt, { speed01: 0, crouch: this.crouching, aiming: false }); return; }

    const st = this.input;

    // ---- Look ----
    this.yaw -= st.lookDX;
    this.pitch = clamp(this.pitch - st.lookDY, -1.1, 1.1);

    // ---- Crouch / aim ----
    this.crouching = !!st.crouchHeld;
    this.aiming = !!st.aimHeld;
    this.sprinting = !!st.sprintHeld && !this.aiming && !this.crouching;

    // ---- Movement (camera-relative on the XZ plane) ----
    const moveVec = new THREE.Vector3(st.moveX, 0, st.moveZ);
    const hasInput = moveVec.lengthSq() > 0.0001;
    if (hasInput) moveVec.normalize();
    const forward = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    const right = new THREE.Vector3(Math.sin(this.yaw + Math.PI/2), 0, Math.cos(this.yaw + Math.PI/2));
    const speed = this.crouching ? CROUCH_SPEED : (this.sprinting ? RUN_SPEED : WALK_SPEED);
    const finalSpeed = speed * (this.aiming ? AIM_SPEED_MULT : 1);
    const delta = new THREE.Vector3();
    delta.addScaledVector(forward, -moveVec.z * finalSpeed * dt);
    delta.addScaledVector(right, moveVec.x * finalSpeed * dt);

    const newPos = this.position.clone().add(delta);
    resolveCircleCollisions(newPos, PLAYER_RADIUS, this.world.collisionBoxes);
    // Keep inside the outer shell as a safety net.
    newPos.x = clamp(newPos.x, -6.9, 6.9);
    newPos.z = clamp(newPos.z, -4.9, 4.9);
    this.position.copy(newPos);

    // ---- Jump (small hop, purely cosmetic — house is single-storey/flat) ----
    if (st.jumpPressed && this.grounded){
      this.velocityY = 3.4;
      this.grounded = false;
      this.audio.jump();
    }
    this.velocityY -= 9.8 * dt;
    this.rig.root.position.y += this.velocityY * dt;
    if (this.rig.root.position.y <= 0){
      if (!this.grounded && this.velocityY < -2) this.audio.land();
      this.rig.root.position.y = 0;
      this.velocityY = 0;
      this.grounded = true;
    }

    this.rig.root.rotation.y = this.yaw;

    // ---- Footsteps + movement noise ----
    const speed01raw = hasInput ? finalSpeed / RUN_SPEED : 0;
    this.movingSpeed01 = damp(this.movingSpeed01, speed01raw, 12, dt);
    if (hasInput && this.grounded){
      this._footstepTimer -= dt * (this.sprinting ? 1.6 : this.crouching ? 0.7 : 1.0);
      if (this._footstepTimer <= 0){
        this._footstepTimer = 0.36;
        const surface = floorAt(this.world.floorZones, this.position.x, this.position.z);
        this.audio.footstep(surface, this.sprinting);
        if (this.sprinting || !this.crouching){
          const radius = this.sprinting ? 7.5 : 3.0;
          this.emitNoise(radius);
        }
      }
    }

    // ---- Weapon switching ----
    if (st.weaponSwitch === 1) this.setWeaponSlot(1);
    if (st.weaponSwitch === 2) this.setWeaponSlot(2);

    // ---- Animation params ----
    this.animator.update(dt, {
      speed01: clamp(this.movingSpeed01, 0, 1) + (this.sprinting ? 0.5 : 0),
      crouch: this.crouching,
      aiming: this.aiming,
      reloadDuration: 1.6,
    });
  }
}

function buildPistolMesh(){
  const g = new THREE.Group();
  const matBody = new THREE.MeshStandardMaterial({ color: 0x25262b, roughness: 0.4, metalness: 0.6 });
  const slide = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.06, 0.2), matBody);
  slide.position.set(0, 0.03, -0.05);
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.13, 0.06), matBody);
  grip.position.set(0, -0.06, 0.03);
  g.add(slide, grip);
  g.rotation.y = Math.PI / 2;
  g.position.set(0.02, -0.02, 0.05);
  return g;
}
function buildKnifeMesh(){
  const g = new THREE.Group();
  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.18, 0.03), new THREE.MeshStandardMaterial({ color: 0xd8d8dc, roughness: 0.25, metalness: 0.85 }));
  blade.position.y = 0.11;
  const handle = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.09, 0.035), new THREE.MeshStandardMaterial({ color: 0x2a2018, roughness: 0.8 }));
  handle.position.y = 0.0;
  g.add(blade, handle);
  g.position.set(0.02, -0.02, 0.02);
  return g;
}
