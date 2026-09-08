// ============================================================================
// input.js — InputManager: desktop keyboard + mouse. Mobile touch input lives
// in mobileControls.js; both write into the same shared InputState object so
// PlayerController/WeaponSystem/CameraController don't care which device is
// driving them.
// ============================================================================

export function createInputState(){
  return {
    moveX: 0, moveZ: 0,      // -1..1 strafe / forward-back
    lookDX: 0, lookDY: 0,    // accumulated look delta since last consume
    shootHeld: false,
    aimHeld: false,
    reloadPressed: false,    // edge-triggered, consumed once per press
    jumpPressed: false,
    crouchHeld: false,
    knifePressed: false,
    weaponSwitch: 0,         // 1 or 2 when just pressed, else 0
    pausePressed: false,
    sprintHeld: false,
  };
}

export class InputManager {
  constructor(canvas, state, sensitivityGetter){
    this.canvas = canvas;
    this.state = state;
    this.getSensitivity = sensitivityGetter || (() => 50);
    this.keys = new Set();
    this.pointerLocked = false;
    this.enabled = false;

    this._onKeyDown = this._onKeyDown.bind(this);
    this._onKeyUp = this._onKeyUp.bind(this);
    this._onMouseMove = this._onMouseMove.bind(this);
    this._onMouseDown = this._onMouseDown.bind(this);
    this._onMouseUp = this._onMouseUp.bind(this);
    this._onContextMenu = (e) => e.preventDefault();
    this._onPointerLockChange = this._onPointerLockChange.bind(this);

    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    document.addEventListener('mousemove', this._onMouseMove);
    canvas.addEventListener('mousedown', this._onMouseDown);
    window.addEventListener('mouseup', this._onMouseUp);
    canvas.addEventListener('contextmenu', this._onContextMenu);
    document.addEventListener('pointerlockchange', this._onPointerLockChange);
  }

  setEnabled(v){ this.enabled = v; if (!v) { this.state.moveX = 0; this.state.moveZ = 0; } }

  requestPointerLock(){
    if (this.canvas.requestPointerLock) this.canvas.requestPointerLock();
  }
  exitPointerLock(){
    if (document.exitPointerLock) document.exitPointerLock();
  }
  _onPointerLockChange(){
    this.pointerLocked = document.pointerLockElement === this.canvas;
  }

  _onKeyDown(e){
    if (!this.enabled && e.code !== 'Escape') return;
    if (this.keys.has(e.code)) { this._updateMoveFromKeys(); return; }
    this.keys.add(e.code);
    this._updateMoveFromKeys();
    if (e.code === 'KeyR') this.state.reloadPressed = true;
    if (e.code === 'Space') this.state.jumpPressed = true;
    if (e.code === 'Digit1') this.state.weaponSwitch = 1;
    if (e.code === 'Digit2') this.state.weaponSwitch = 2;
    if (e.code === 'KeyV') this.state.knifePressed = true;
    if (e.code === 'Escape') this.state.pausePressed = true;
    if (e.code === 'KeyC' || e.code === 'ControlLeft' || e.code === 'ControlRight') this.state.crouchHeld = !this.state.crouchHeld;
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') this.state.sprintHeld = true;
    if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space'].includes(e.code)) e.preventDefault();
  }
  _onKeyUp(e){
    this.keys.delete(e.code);
    this._updateMoveFromKeys();
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') this.state.sprintHeld = false;
  }
  _updateMoveFromKeys(){
    let x = 0, z = 0;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) z -= 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) z += 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) x -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) x += 1;
    this.state.moveX = x; this.state.moveZ = z;
  }

  _onMouseMove(e){
    if (!this.enabled || !this.pointerLocked) return;
    const sens = this.getSensitivity() / 50; // 1.0 at slider midpoint
    this.state.lookDX += (e.movementX || 0) * 0.0022 * sens;
    this.state.lookDY += (e.movementY || 0) * 0.0022 * sens;
  }
  _onMouseDown(e){
    if (!this.enabled) return;
    if (e.button === 0) this.state.shootHeld = true;
    if (e.button === 2) this.state.aimHeld = true;
    if (!this.pointerLocked) this.requestPointerLock();
  }
  _onMouseUp(e){
    if (e.button === 0) this.state.shootHeld = false;
    if (e.button === 2) this.state.aimHeld = false;
  }

  // Called once per frame after systems have read the edge-triggered flags.
  consumeEdges(){
    this.state.reloadPressed = false;
    this.state.jumpPressed = false;
    this.state.weaponSwitch = 0;
    this.state.knifePressed = false;
    this.state.pausePressed = false;
    this.state.lookDX = 0;
    this.state.lookDY = 0;
  }

  dispose(){
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
    document.removeEventListener('mousemove', this._onMouseMove);
    this.canvas.removeEventListener('mousedown', this._onMouseDown);
    window.removeEventListener('mouseup', this._onMouseUp);
    this.canvas.removeEventListener('contextmenu', this._onContextMenu);
    document.removeEventListener('pointerlockchange', this._onPointerLockChange);
  }
}
