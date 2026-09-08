// ============================================================================
// camera.js — CameraController: third-person spring-arm camera. Follows the
// player's yaw/pitch (set by PlayerController from mouse/touch look input),
// pulls in when aiming, and raycasts from the player's shoulder toward the
// desired camera position so it never clips through walls/furniture — if
// the ray is blocked, the camera is pulled to just in front of the block.
// ============================================================================
import * as THREE from 'three';
import { lerp, damp } from './utils.js';

const NORMAL_DIST = 4.0;
const NORMAL_HEIGHT = 1.85;
const AIM_DIST = 2.3;
const AIM_HEIGHT = 1.6;
const SHOULDER_OFFSET = 0.42;

export class CameraController {
  constructor(camera, occludersProvider){
    this.camera = camera;
    this.getOccluders = occludersProvider;
    this.raycaster = new THREE.Raycaster();
    this.currentDist = NORMAL_DIST;
    this.shakeTime = 0;
    this.shakeMag = 0;
    this._smoothedPos = null;
  }

  addShake(mag, duration){
    this.shakeMag = Math.max(this.shakeMag, mag);
    this.shakeTime = Math.max(this.shakeTime, duration);
  }

  update(dt, player){
    const yaw = player.yaw;
    const pitch = player.pitch;
    const aimT = player.aiming ? 1 : 0;
    const targetDist = lerp(NORMAL_DIST, AIM_DIST, aimT);
    const targetHeight = lerp(NORMAL_HEIGHT, AIM_HEIGHT, aimT);

    const eye = player.getEyePosition();
    // Pivot slightly above the eye, offset to the right shoulder for an
    // over-the-shoulder feel rather than dead-center behind the head.
    const shoulderRight = new THREE.Vector3(Math.sin(yaw + Math.PI/2), 0, Math.cos(yaw + Math.PI/2));
    const pivot = eye.clone().addScaledVector(shoulderRight, SHOULDER_OFFSET * (1 - aimT * 0.4));
    pivot.y += 0.25;

    const camDir = new THREE.Vector3(
      Math.sin(yaw) * Math.cos(pitch),
      Math.sin(pitch),
      Math.cos(yaw) * Math.cos(pitch)
    );
    // Desired camera sits BEHIND the player relative to look direction,
    // raised a bit more when looking down so it doesn't dip into the floor.
    const desired = pivot.clone().addScaledVector(camDir, -targetDist);
    desired.y = pivot.y + targetHeight * 0.35 + Math.max(0, -camDir.y) * targetDist * 0.5;

    // Wall-collision pullback: raycast from pivot toward the desired camera spot.
    const toCam = new THREE.Vector3().subVectors(desired, pivot);
    const dist = toCam.length();
    let allowedDist = dist;
    if (dist > 0.01){
      toCam.normalize();
      this.raycaster.set(pivot, toCam);
      this.raycaster.far = dist;
      this.raycaster.near = 0.05;
      const hits = this.raycaster.intersectObjects(this.getOccluders(), false);
      if (hits.length){
        allowedDist = Math.max(0.4, hits[0].distance - 0.25);
      }
    }
    const finalPos = pivot.clone().addScaledVector(toCam.lengthSq() ? toCam : new THREE.Vector3(0,0,1), allowedDist);

    if (!this._smoothedPos) this._smoothedPos = finalPos.clone();
    this._smoothedPos.x = damp(this._smoothedPos.x, finalPos.x, 18, dt);
    this._smoothedPos.y = damp(this._smoothedPos.y, finalPos.y, 18, dt);
    this._smoothedPos.z = damp(this._smoothedPos.z, finalPos.z, 18, dt);

    let shakeOffset = new THREE.Vector3();
    if (this.shakeTime > 0){
      this.shakeTime -= dt;
      const m = this.shakeMag * Math.max(0, this.shakeTime);
      shakeOffset.set((Math.random()-0.5)*m, (Math.random()-0.5)*m, 0);
      if (this.shakeTime <= 0) this.shakeMag = 0;
    }

    this.camera.position.copy(this._smoothedPos).add(shakeOffset);
    const lookTarget = eye.clone().addScaledVector(camDir, 3);
    this.camera.lookAt(lookTarget);
  }
}
