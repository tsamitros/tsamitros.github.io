// ============================================================================
// enemyAI.js — Enemy (a single hostile) and EnemyManager (coordinates all of
// them: noise broadcasting, simple flank/role assignment, awareness queries
// for the HUD). Enemies never know the player's exact position by default —
// only what they can see (line-of-sight + view cone), what they can hear
// (noise events), and the last position anything told them about.
// ============================================================================
import * as THREE from 'three';
import { buildSoldierMesh, ENEMY_SCHEMES } from './character.js';
import { SoldierAnimator } from './animation.js';
import { resolveCircleCollisions, lineOfSightBlocked, clamp, damp, randRange, disposeObject3D } from './utils.js';
import { raycastHitscan, applyHit, spawnMuzzleFlash, spawnBulletImpact } from './combat.js';

const ARCHETYPE_PARAMS = {
  rifle:      { moveSpeed: 1.7, viewDist: 9.5, viewAngle: 1.15, fireCooldown: 1.05, accuracy: 0.72, engageRange: 8.5, repositionEvery: 6.5 },
  defensive:  { moveSpeed: 1.4, viewDist: 10.5, viewAngle: 1.0,  fireCooldown: 1.5,  accuracy: 0.85, engageRange: 10, repositionEvery: 999 },
  aggressive: { moveSpeed: 2.4, viewDist: 8.5,  viewAngle: 1.3,  fireCooldown: 0.75, accuracy: 0.55, engageRange: 5.5, repositionEvery: 4.0 },
};

const AI_TICK = 0.18; // perception/decision throttle — real work, not every frame
let _idCounter = 0;

export class Enemy {
  constructor({ scene, world, audio, spawn, quality }){
    this.id = _idCounter++;
    this.scene = scene;
    this.world = world;
    this.audio = audio;
    this.quality = quality;
    this.archetype = spawn.archetype;
    this.params = ARCHETYPE_PARAMS[spawn.archetype];

    this.rig = buildSoldierMesh(ENEMY_SCHEMES[spawn.archetype]);
    this.rig.root.position.set(spawn.x, 0, spawn.z);
    this.rig.root.rotation.y = spawn.ry;
    scene.add(this.rig.root);
    this.animator = new SoldierAnimator(this.rig);
    this.gunMesh = buildEnemyGun();
    this.rig.rightArm.hand.add(this.gunMesh);
    this.rig.hitboxMeshes.forEach(m => { m.userData.owner = this; });

    this.yaw = spawn.ry;
    this.spawn = spawn;
    this.health = 100;
    this.alive = true;
    this.hitsTaken = 0;
    this.state = 'patrol';
    this.role = 'hold';
    this.lastKnownPlayerPos = null;
    this.stateTimer = 0;
    this.aiTimer = Math.random() * AI_TICK;
    this.fireTimer = randRange(0.3, 1.2);
    this.repositionTimer = this.params.repositionEvery;
    this.coverPoint = null;
    this.retreating = false;
    this.speed01 = 0;
    this.raycaster = new THREE.Raycaster();

    this.patrolA = new THREE.Vector3(spawn.x, 0, spawn.z);
    this.patrolB = new THREE.Vector3(spawn.x + randRange(-1.6, 1.6), 0, spawn.z + randRange(-1.2, 1.2));
    this.patrolTarget = this.patrolB;
    this.moveTarget = null;

    this.onDeathCallback = null;
    this.onAlertCallback = null; // (pos) -> notify manager for coordination
  }

  dispose(){ disposeObject3D(this.rig.root); }

  getPosition(){ return this.rig.root.position; }
  getEyePosition(){ return new THREE.Vector3(this.rig.root.position.x, this.rig.root.position.y + 1.5, this.rig.root.position.z); }

  onHit(part){
    this.animator.triggerHit(part);
    this.audio.hitGrunt();
    if (this.state === 'patrol' || this.state === 'suspicious'){
      // Being shot is unmistakable — snap straight to combat awareness.
      this.state = 'alert';
      this.stateTimer = 0;
    }
  }
  onDeath(headshot){
    this.animator.triggerDeath(headshot);
    this.audio.deathSound();
    this.state = 'dead';
    if (this.onDeathCallback) this.onDeathCallback(this, headshot);
  }

  hearNoise(position, radius, strong){
    if (!this.alive || this.state === 'combat' || this.state === 'dead') return;
    const d = this.getPosition().distanceTo(position);
    if (d > radius) return;
    this.lastKnownPlayerPos = position.clone();
    if (strong || this.state === 'alert' || this.state === 'searching'){
      this.state = 'alert';
    } else {
      this.state = 'suspicious';
    }
    this.stateTimer = 0;
  }

  notifyAlly(position){
    if (!this.alive || this.state === 'combat' || this.state === 'dead') return;
    this.lastKnownPlayerPos = position.clone();
    this.state = 'alert';
    this.stateTimer = 0;
  }

  _canSeePlayer(player, occluders){
    const eye = this.getEyePosition();
    const playerPos = player.getEyePosition();
    const to = new THREE.Vector3().subVectors(playerPos, eye);
    const dist = to.length();
    if (dist > this.params.viewDist) return false;
    to.normalize();
    const facing = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    const flatTo = new THREE.Vector3(to.x, 0, to.z).normalize();
    const angle = Math.acos(clamp(facing.dot(flatTo), -1, 1));
    if (angle > this.params.viewAngle / 2) return false;
    if (lineOfSightBlocked(eye, playerPos, occluders, this.raycaster)) return false;
    return true;
  }

  _nearestCoverPoint(awayFromPos){
    let best = null, bestScore = -Infinity;
    for (const cp of this.world.coverPoints){
      const d = Math.hypot(cp.x - this.getPosition().x, cp.z - this.getPosition().z);
      const dAway = awayFromPos ? Math.hypot(cp.x - awayFromPos.x, cp.z - awayFromPos.z) : 0;
      const score = -d + dAway * 0.3;
      if (score > bestScore){ bestScore = score; best = cp; }
    }
    return best;
  }

  _moveToward(target, dt, speed, world){
    const pos = this.getPosition();
    const dx = target.x - pos.x, dz = target.z - pos.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.12){ this.speed01 = damp(this.speed01, 0, 8, dt); return true; }
    const dirX = dx / dist, dirZ = dz / dist;
    const step = Math.min(dist, speed * dt);
    const newPos = pos.clone();
    newPos.x += dirX * step;
    newPos.z += dirZ * step;
    resolveCircleCollisions(newPos, 0.32, world.collisionBoxes);
    pos.copy(newPos);
    const desiredYaw = Math.atan2(dirX, dirZ);
    this.yaw = angleLerpLocal(this.yaw, desiredYaw, 1 - Math.exp(-10 * dt));
    this.rig.root.rotation.y = this.yaw;
    this.speed01 = damp(this.speed01, 1, 8, dt);
    return false;
  }

  _faceToward(target, dt){
    const pos = this.getPosition();
    const dx = target.x - pos.x, dz = target.z - pos.z;
    if (Math.hypot(dx, dz) < 0.05) return;
    const desiredYaw = Math.atan2(dx, dz);
    this.yaw = angleLerpLocal(this.yaw, desiredYaw, 1 - Math.exp(-8 * dt));
    this.rig.root.rotation.y = this.yaw;
  }

  _tryShoot(player, occluders, dt, statsTracker){
    if (this.fireTimer > 0) return;
    this.fireTimer = this.params.fireCooldown * randRange(0.85, 1.2);
    this.animator.triggerShoot();
    this.audio.gunshot('rifle');
    const muzzle = this.getEyePosition().addScaledVector(new THREE.Vector3(Math.sin(this.yaw), -0.15, Math.cos(this.yaw)), 0.3);
    spawnMuzzleFlash(this.scene, muzzle, this.quality);

    const targetPoint = player.getEyePosition().clone();
    const missSpread = (1 - this.params.accuracy) * 0.9;
    targetPoint.x += randRange(-missSpread, missSpread);
    targetPoint.y += randRange(-missSpread * 0.6, missSpread * 0.3) - (this.params.accuracy > 0.75 ? 0 : 0.1);
    targetPoint.z += randRange(-missSpread, missSpread);

    const origin = this.getEyePosition();
    const dir = new THREE.Vector3().subVectors(targetPoint, origin).normalize();
    const hit = raycastHitscan(this.raycaster, origin, dir, player.rig.hitboxMeshes, occluders, 40);
    if (hit && hit.isCharacterHit){
      applyHit(player, hit.part);
      this.audio.bulletImpact('flesh');
      if (statsTracker) statsTracker.damageTaken += 1;
    } else if (hit){
      spawnBulletImpact(this.scene, hit.point, hit.normal, this.quality);
    }
  }

  update(dt, ctx){
    const { player, occluders, statsTracker } = ctx;
    if (!this.alive){ this.animator.update(dt, {}); return; }

    if (this.fireTimer > 0) this.fireTimer -= dt;
    this.aiTimer -= dt;
    let seesPlayer = false;
    if (this.aiTimer <= 0){
      this.aiTimer = AI_TICK;
      if (player.alive) seesPlayer = this._canSeePlayer(player, occluders);
      if (seesPlayer){
        this.lastKnownPlayerPos = player.getPosition().clone();
        if (this.state !== 'combat' && this.onAlertCallback) this.onAlertCallback(this, this.lastKnownPlayerPos);
        this.state = 'combat';
        this.stateTimer = 0;
      } else if (this.state === 'combat'){
        this.stateTimer += AI_TICK;
        if (this.stateTimer > 1.6){ this.state = 'searching'; this.stateTimer = 0; }
      }
    }

    // Retreat check (once per hit) — everyone gets cautious, aggressive mostly ignores it.
    if (this.hitsTaken >= 1 && !this.retreating && this.state === 'combat'){
      if (this.archetype !== 'aggressive' || Math.random() < 0.4) this.retreating = true;
    }

    switch (this.state){
      case 'patrol': this._updatePatrol(dt); break;
      case 'suspicious': this._updateInvestigate(dt, 3.5, 0.9); break;
      case 'alert': this._updateInvestigate(dt, 4.5, 1.4); break;
      case 'combat': this._updateCombat(dt, player, occluders, statsTracker); break;
      case 'searching': this._updateSearch(dt); break;
    }

    this.animator.update(dt, {
      speed01: clamp(this.speed01, 0, 1),
      crouch: this.state === 'combat' && this.archetype === 'defensive',
      aiming: this.state === 'combat',
      reloadDuration: 1.2,
    });
  }

  _updatePatrol(dt){
    const arrived = this._moveToward(this.patrolTarget, dt, this.params.moveSpeed * 0.5, this.world);
    if (arrived){
      this.stateTimer += dt;
      if (this.stateTimer > 2.2){
        this.patrolTarget = this.patrolTarget === this.patrolA ? this.patrolB : this.patrolA;
        this.stateTimer = 0;
      }
    }
  }

  _updateInvestigate(dt, duration, speedMult){
    if (!this.lastKnownPlayerPos){ this.state = 'patrol'; return; }
    const arrived = this._moveToward(this.lastKnownPlayerPos, dt, this.params.moveSpeed * speedMult, this.world);
    if (arrived){
      this.stateTimer += dt;
      this.yaw += dt * 0.8; // slow scan
      this.rig.root.rotation.y = this.yaw;
      if (this.stateTimer > duration){
        this.state = 'patrol';
        this.stateTimer = 0;
        this.lastKnownPlayerPos = null;
      }
    }
  }

  _updateSearch(dt){
    this._updateInvestigate(dt, 4.0, 1.1);
    if (this.state === 'patrol'){
      // resume patrol from current position rather than teleporting back
      this.patrolA = this.getPosition().clone();
    }
  }

  _updateCombat(dt, player, occluders, statsTracker){
    if (!this.lastKnownPlayerPos){ this.state = 'searching'; this.stateTimer = 0; return; }

    if (this.retreating){
      const cp = this._nearestCoverPoint(this.lastKnownPlayerPos);
      if (cp){
        const arrived = this._moveToward(new THREE.Vector3(cp.x, 0, cp.z), dt, this.params.moveSpeed, this.world);
        this._faceToward(this.lastKnownPlayerPos, dt);
        if (arrived) this.retreating = false;
      } else {
        this.retreating = false;
      }
      return;
    }

    const dist = this.getPosition().distanceTo(this.lastKnownPlayerPos);

    if (this.archetype === 'aggressive'){
      if (dist > 2.0){
        this._moveToward(this.lastKnownPlayerPos, dt, this.params.moveSpeed, this.world);
      } else {
        this.speed01 = damp(this.speed01, 0, 8, dt);
        this._faceToward(this.lastKnownPlayerPos, dt);
      }
    } else {
      // rifle / defensive: hold or move to a cover point; occasionally reposition to flank.
      this.repositionTimer -= dt;
      if (!this.coverPoint || this.repositionTimer <= 0){
        this.coverPoint = this.role === 'flank'
          ? this._nearestCoverPoint(player.getPosition())
          : this._nearestCoverPoint(null);
        this.repositionTimer = this.params.repositionEvery * randRange(0.8, 1.3);
      }
      if (this.coverPoint){
        const target = new THREE.Vector3(this.coverPoint.x, 0, this.coverPoint.z);
        const arrived = this._moveToward(target, dt, this.params.moveSpeed, this.world);
        if (arrived){
          this.speed01 = damp(this.speed01, 0, 8, dt);
          this._faceToward(this.lastKnownPlayerPos, dt);
        }
      } else {
        this._faceToward(this.lastKnownPlayerPos, dt);
      }
    }

    if (dist <= this.params.engageRange){
      const hasLOS = !lineOfSightBlocked(this.getEyePosition(), player.getEyePosition(), occluders, this.raycaster);
      if (hasLOS) this._tryShoot(player, occluders, dt, statsTracker);
    }
  }
}

function angleLerpLocal(a, b, t){
  let diff = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (diff < -Math.PI) diff += Math.PI * 2;
  return a + diff * t;
}

function buildEnemyGun(){
  const g = new THREE.Group();
  const matBody = new THREE.MeshStandardMaterial({ color: 0x1c1d20, roughness: 0.45, metalness: 0.6 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.07, 0.42), matBody);
  body.position.set(0, 0.02, -0.14);
  const stock = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.06, 0.14), matBody);
  stock.position.set(0, -0.01, 0.08);
  g.add(body, stock);
  g.rotation.y = Math.PI / 2;
  g.position.set(0.02, -0.02, 0.05);
  return g;
}

// ---------------------------------------------------------------------------
// EnemyManager — owns all enemies, wires up noise + ally-alert coordination,
// and assigns simple hold/flank roles so multiple combat-state enemies don't
// all funnel through the same doorway.
// ---------------------------------------------------------------------------
export class EnemyManager {
  constructor({ scene, world, audio, quality }){
    this.scene = scene;
    this.world = world;
    this.audio = audio;
    this.quality = quality;
    this.enemies = world.enemySpawns.map(spawn => this._makeEnemy(spawn));
    this.killCount = 0;
    this.onEnemyDeath = null;
  }

  _makeEnemy(spawn){
    const e = new Enemy({ scene: this.scene, world: this.world, audio: this.audio, spawn, quality: this.quality });
    e.onDeathCallback = (enemy, headshot) => {
      this.killCount++;
      if (this.onEnemyDeath) this.onEnemyDeath(enemy, headshot);
    };
    e.onAlertCallback = (source, pos) => this._coordinateOnAlert(source, pos);
    return e;
  }

  _coordinateOnAlert(source, pos){
    // Tell nearby non-combat allies where the action is (radio comms).
    for (const e of this.enemies){
      if (e === source || !e.alive) continue;
      const d = e.getPosition().distanceTo(source.getPosition());
      if (d < 14 && e.state !== 'combat') e.notifyAlly(pos);
    }
    this._assignRoles();
  }

  _assignRoles(){
    const combatants = this.enemies.filter(e => e.alive && e.state === 'combat' && e.archetype !== 'aggressive');
    combatants.forEach((e, i) => { e.role = (i % 2 === 0) ? 'hold' : 'flank'; });
  }

  broadcastNoise(position, radius, strong){
    for (const e of this.enemies) e.hearNoise(position, radius, strong);
  }

  update(dt, ctx){
    for (const e of this.enemies) e.update(dt, ctx);
  }

  getCombatants(){
    return this.enemies.filter(e => e.alive).map(e => ({ hitboxMeshes: e.rig.hitboxMeshes, ref: e }));
  }

  getHighestAwareness(){
    const order = ['patrol', 'suspicious', 'alert', 'combat'];
    let best = 'patrol';
    for (const e of this.enemies){
      if (!e.alive) continue;
      if (order.indexOf(e.state) > order.indexOf(best)) best = e.state;
      if (e.state === 'searching' && order.indexOf('alert') > order.indexOf(best)) best = 'alert';
    }
    return best;
  }

  aliveCount(){ return this.enemies.filter(e => e.alive).length; }
  allDead(){ return this.enemies.every(e => !e.alive); }

  // Called just before a mission (re)build replaces this manager, so no
  // enemy rig from the previous attempt lingers in the scene graph.
  dispose(){
    this.enemies.forEach(e => e.dispose());
    this.enemies = [];
  }
}
