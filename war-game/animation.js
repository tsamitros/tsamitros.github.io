// ============================================================================
// animation.js — SoldierAnimator: procedural (not keyframed) animation for
// the shared soldier rig. Drives idle/walk/run/crouch/aim/shoot/reload/knife/
// hit/death purely from sine waves and eased blends, so there are no
// animation assets to author or load, and blending between states is just
// interpolating numbers — which also keeps transitions smooth by construction.
// ============================================================================
import { clamp, lerp, damp } from './utils.js';

export class SoldierAnimator {
  constructor(rig){
    this.rig = rig;
    this.phase = 0;
    this.speedBlend = 0;   // 0 idle .. 1 walk .. 2 run (continuous)
    this.crouchBlend = 0;  // 0..1
    this.aimBlend = 0;     // 0..1
    this.shootKick = 0;    // decays after firing
    this.reloadT = -1;     // -1 = not reloading, else 0..1 progress
    this.knifeT = -1;      // -1 = not swinging, else 0..1 progress
    this.hitFlinch = 0;    // decays after taking a hit
    this.hitPart = null;
    this.deathT = -1;      // -1 = alive, else 0..1 collapse progress
    this.deathHeadshot = false;
    this.aimYaw = 0;       // extra torso yaw while aiming (radians, small lean)
  }

  triggerShoot(){ this.shootKick = 1; }
  triggerReload(){ this.reloadT = 0; }
  triggerKnife(){ this.knifeT = 0; }
  triggerHit(part){ this.hitFlinch = 1; this.hitPart = part; }
  triggerDeath(headshot){ this.deathT = 0; this.deathHeadshot = !!headshot; }
  isDead(){ return this.deathT >= 1; }
  isBusyReloading(){ return this.reloadT >= 0 && this.reloadT < 1; }
  isBusyKnife(){ return this.knifeT >= 0 && this.knifeT < 1; }

  update(dt, params){
    const r = this.rig;
    if (this.deathT >= 0){
      this._updateDeath(dt);
      return;
    }

    const targetSpeed = params.speed01 * 2; // 0..2 (idle/walk/run)
    this.speedBlend = damp(this.speedBlend, targetSpeed, 10, dt);
    this.crouchBlend = damp(this.crouchBlend, params.crouch ? 1 : 0, 8, dt);
    this.aimBlend = damp(this.aimBlend, params.aiming ? 1 : 0, 10, dt);
    if (this.shootKick > 0) this.shootKick = Math.max(0, this.shootKick - dt * 6);
    if (this.hitFlinch > 0) this.hitFlinch = Math.max(0, this.hitFlinch - dt * 4);
    if (this.reloadT >= 0) this.reloadT = Math.min(1, this.reloadT + dt / (params.reloadDuration || 1.6));
    if (this.knifeT >= 0) this.knifeT = Math.min(1, this.knifeT + dt / 0.42);

    this.phase += dt * (2.2 + this.speedBlend * 3.2);

    // ---- Hip height for crouch ----
    r.hips.position.y = lerp(0.92, 0.66, this.crouchBlend);

    // ---- Leg cycle ----
    const legAmp = lerp(0.18, 0.55, clamp(this.speedBlend / 2, 0, 1)) * (this.speedBlend > 0.05 ? 1 : 0);
    const s = Math.sin(this.phase);
    const c = Math.cos(this.phase);
    r.leftLeg.hip.rotation.x = s * legAmp;
    r.rightLeg.hip.rotation.x = -s * legAmp;
    r.leftLeg.knee.rotation.x = Math.max(0, -c * legAmp * 1.3);
    r.rightLeg.knee.rotation.x = Math.max(0, c * legAmp * 1.3);

    // ---- Torso lean forward slightly when running / crouched ----
    const runLean = clamp((this.speedBlend - 1), 0, 1) * 0.12;
    r.torsoPivot.rotation.x = runLean + this.crouchBlend * 0.08;

    // ---- Arms: idle sway vs aim pose ----
    const idleSwayAmp = legAmp * 0.6;
    const idleShoulderL = { x: 0.15 + s * idleSwayAmp * 0.5, y: 0, z: 0.12 };
    const idleShoulderR = { x: 0.15 - s * idleSwayAmp * 0.5, y: 0, z: -0.12 };

    // Aim pose: both arms rotate forward/up, right arm (weapon hand) points ahead.
    const aimShoulderR = { x: -1.35, y: 0.05, z: -0.05 };
    const aimShoulderL = { x: -1.15, y: -0.35, z: 0.35 };

    const aimT = this.aimBlend;
    r.rightArm.shoulder.rotation.x = lerp(idleShoulderR.x, aimShoulderR.x, aimT);
    r.rightArm.shoulder.rotation.y = lerp(idleShoulderR.y, aimShoulderR.y, aimT);
    r.rightArm.shoulder.rotation.z = lerp(idleShoulderR.z, aimShoulderR.z, aimT);
    r.leftArm.shoulder.rotation.x = lerp(idleShoulderL.x, aimShoulderL.x, aimT);
    r.leftArm.shoulder.rotation.y = lerp(idleShoulderL.y, aimShoulderL.y, aimT);
    r.leftArm.shoulder.rotation.z = lerp(idleShoulderL.z, aimShoulderL.z, aimT);

    r.rightArm.elbow.rotation.x = lerp(-0.25, -0.15, aimT);
    r.leftArm.elbow.rotation.x = lerp(-0.25, -0.55, aimT);

    // Recoil kick after shooting — quick backward jolt on the arm + torso.
    if (this.shootKick > 0){
      r.rightArm.shoulder.rotation.x -= this.shootKick * 0.18;
      r.torsoPivot.rotation.x -= this.shootKick * 0.05;
    }

    // Reload: lower both arms toward the belt/magazine well briefly.
    if (this.reloadT >= 0 && this.reloadT < 1){
      const rt = this.reloadT;
      const dip = Math.sin(rt * Math.PI); // rises then returns
      r.rightArm.shoulder.rotation.x = lerp(r.rightArm.shoulder.rotation.x, 0.9, dip);
      r.leftArm.shoulder.rotation.x = lerp(r.leftArm.shoulder.rotation.x, 1.0, dip);
      r.leftArm.elbow.rotation.x = lerp(r.leftArm.elbow.rotation.x, -1.4, dip);
    } else if (this.reloadT >= 1){
      this.reloadT = -1;
    }

    // Knife swing: right arm arcs across the body.
    if (this.knifeT >= 0 && this.knifeT < 1){
      const kt = this.knifeT;
      const arc = Math.sin(kt * Math.PI);
      r.rightArm.shoulder.rotation.x = lerp(-0.4, -1.6, arc);
      r.rightArm.shoulder.rotation.z = lerp(0.6, -0.5, kt);
      r.rightArm.elbow.rotation.x = -0.3 - arc * 0.6;
    } else if (this.knifeT >= 1){
      this.knifeT = -1;
    }

    // Hit reaction: quick flinch away from the hit part.
    if (this.hitFlinch > 0){
      const f = this.hitFlinch;
      r.torsoPivot.rotation.z = (this.hitPart === 'leftArm' ? 0.2 : this.hitPart === 'rightArm' ? -0.2 : 0.12) * f;
      r.torsoPivot.rotation.x -= 0.1 * f;
      r.headPivot.rotation.x = -0.25 * f;
      if (this.hitPart === 'leftLeg' || this.hitPart === 'rightLeg'){
        r.hips.position.y -= 0.06 * f;
      }
    } else {
      r.headPivot.rotation.x = damp(r.headPivot.rotation.x, 0, 10, dt);
      r.torsoPivot.rotation.z = damp(r.torsoPivot.rotation.z, 0, 10, dt);
    }
  }

  _updateDeath(dt){
    const r = this.rig;
    this.deathT = Math.min(1, this.deathT + dt / 0.75);
    const t = this.deathT;
    const ease = t * t * (3 - 2 * t);
    if (this.deathHeadshot){
      r.headPivot.rotation.x = lerp(0, -1.7, ease);
      r.hips.position.y = lerp(0.92, 0.15, ease);
      r.root.rotation.x = lerp(0, 1.3, ease);
    } else {
      r.hips.position.y = lerp(0.92, 0.15, ease);
      r.root.rotation.z = lerp(0, (this._deathSide || (this._deathSide = Math.random() > 0.5 ? 1 : -1)) * 1.5, ease);
      r.root.rotation.x = lerp(0, 0.3, ease);
      r.torsoPivot.rotation.x = lerp(0, 0.3, ease);
    }
  }
}
