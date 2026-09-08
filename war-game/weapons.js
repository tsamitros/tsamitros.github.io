// ============================================================================
// weapons.js — WeaponSystem: the player's pistol + knife. Owns ammo/reload
// state and fire timing; delegates actual hit resolution to combat.js so the
// exact same rule applies to enemy gunfire against the player.
// ============================================================================
import * as THREE from 'three';
import { raycastHitscan, applyHit, spawnMuzzleFlash, spawnBulletImpact } from './combat.js';

const MAG_SIZE = 12;
const RESERVE_START = 60;
const FIRE_COOLDOWN = 0.22; // seconds between pistol shots
const RELOAD_DURATION = 1.6;
const KNIFE_COOLDOWN = 0.5;
const KNIFE_RANGE = 1.4;
const KNIFE_ANGLE = Math.PI / 3.2; // ~56 degrees total cone

export class WeaponSystem {
  constructor({ scene, camera, audio, animator, getMuzzleWorldPosition, getEnemyCombatants, occludersRef, quality, onStatsHit, vibrate }){
    this.scene = scene;
    this.camera = camera;
    this.audio = audio;
    this.animator = animator;
    this.getMuzzleWorldPosition = getMuzzleWorldPosition;
    this.getEnemyCombatants = getEnemyCombatants; // () => [{hitboxMeshes, ref}]
    this.occludersRef = occludersRef; // () => occluder mesh array (walls etc, updated live)
    this.quality = quality;
    this.onStatsHit = onStatsHit || (() => {});
    this.vibrate = vibrate || (() => {});

    this.slot = 1; // 1 = gun, 2 = knife
    this.ammoMag = MAG_SIZE;
    this.ammoReserve = RESERVE_START;
    this.reloading = false;
    this._reloadTimer = 0;
    this._fireTimer = 0;
    this._knifeTimer = 0;
    this._pendingEffects = [];
    this.raycaster = new THREE.Raycaster();
    this.lastShotHit = null; // for crosshair hit-feedback
    this._hitFlashTimer = 0;
  }

  switchTo(slot){
    if (slot === this.slot) return;
    if (this.reloading) return;
    this.slot = slot;
  }

  canFire(){ return this.slot === 1 && !this.reloading && this.ammoMag > 0 && this._fireTimer <= 0; }

  requestReload(){
    if (this.slot !== 1 || this.reloading || this.ammoMag >= MAG_SIZE || this.ammoReserve <= 0) return;
    this.reloading = true;
    this._reloadTimer = RELOAD_DURATION;
    this.animator.triggerReload();
    this.audio.reloadSound('out');
    setTimeout(() => this.audio.reloadSound('in'), RELOAD_DURATION * 300);
    setTimeout(() => this.audio.reloadSound('rack'), RELOAD_DURATION * 700);
  }

  _finishReload(){
    const needed = MAG_SIZE - this.ammoMag;
    const take = Math.min(needed, this.ammoReserve);
    this.ammoMag += take;
    this.ammoReserve -= take;
    this.reloading = false;
  }

  fireGun(){
    if (!this.canFire()) return false;
    this.ammoMag--;
    this._fireTimer = FIRE_COOLDOWN;
    this.animator.triggerShoot();
    this.audio.gunshot('pistol');
    this.vibrate([18]);
    this.onStatsHit('shot', null);

    const muzzlePos = this.getMuzzleWorldPosition();
    this._pendingEffects.push(spawnMuzzleFlash(this.scene, muzzlePos, this.quality));

    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);
    const origin = this.camera.position.clone();
    const spread = 0.006;
    dir.x += (Math.random() - 0.5) * spread;
    dir.y += (Math.random() - 0.5) * spread;
    dir.normalize();

    const enemyMeshes = [];
    const enemyByMesh = new Map();
    for (const c of this.getEnemyCombatants()){
      for (const m of c.hitboxMeshes){ enemyMeshes.push(m); enemyByMesh.set(m, c.ref); }
    }
    const hit = raycastHitscan(this.raycaster, origin, dir, enemyMeshes, this.occludersRef(), 60);
    if (hit && hit.isCharacterHit){
      const target = enemyByMesh.get(hit.mesh) || hit.owner;
      const result = applyHit(target, hit.part);
      this.audio.bulletImpact('flesh');
      this.lastShotHit = { time: performance.now(), headshot: !!result.headshot };
      this.onStatsHit('hit', result);
      this.vibrate(result.killed ? [10, 30, 10] : [10]);
    } else if (hit){
      this.audio.bulletImpact('wall');
      const tick = spawnBulletImpact(this.scene, hit.point, hit.normal, this.quality);
      if (tick) this._pendingEffects.push(tick);
    }
    return true;
  }

  canKnife(){ return this.slot === 2 && this._knifeTimer <= 0 && !this.animator.isBusyKnife(); }

  swingKnife(){
    if (!this.canKnife()) return false;
    this._knifeTimer = KNIFE_COOLDOWN;
    this.animator.triggerKnife();
    this.audio.knifeSwing();
    this.vibrate([14]);
    this.onStatsHit('knifeSwing', null);

    // Resolve the melee connect slightly after the swing starts, for feel.
    setTimeout(() => this._resolveKnifeHit(), 140);
    return true;
  }

  _resolveKnifeHit(){
    const camPos = this.camera.position;
    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);
    dir.y = 0; dir.normalize();
    let best = null, bestDist = KNIFE_RANGE;
    for (const c of this.getEnemyCombatants()){
      if (!c.ref.alive) continue;
      const pos = c.ref.getPosition();
      const to = new THREE.Vector3().subVectors(pos, camPos);
      to.y = 0;
      const dist = to.length();
      if (dist > KNIFE_RANGE + 0.6) continue;
      to.normalize();
      const angle = Math.acos(THREE.MathUtils.clamp(dir.dot(to), -1, 1));
      if (angle < KNIFE_ANGLE / 2 && dist < bestDist){
        best = c.ref; bestDist = dist;
      }
    }
    if (best){
      const part = 'chest';
      const result = applyHit(best, part);
      this.audio.knifeImpact();
      this.vibrate(result.killed ? [10, 40, 10] : [12]);
      this.onStatsHit('knifeHit', result);
    }
  }

  update(dt){
    if (this._fireTimer > 0) this._fireTimer -= dt;
    if (this._knifeTimer > 0) this._knifeTimer -= dt;
    if (this.reloading){
      this._reloadTimer -= dt;
      if (this._reloadTimer <= 0) this._finishReload();
    }
    this._pendingEffects = this._pendingEffects.filter(tick => tick && tick(dt));
  }

  getHudState(){
    return {
      weaponName: this.slot === 1 ? 'Pistol' : 'Knife',
      mag: this.slot === 1 ? this.ammoMag : null,
      reserve: this.slot === 1 ? this.ammoReserve : null,
      reloading: this.reloading,
    };
  }
}
