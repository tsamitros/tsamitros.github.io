// ============================================================================
// mobileControls.js — MobileControls: virtual joystick (movement), a touch
// drag area (camera look), and spaced tap/hold buttons. Writes into the same
// shared InputState that desktop InputManager uses, so downstream systems
// are device-agnostic.
// ============================================================================
import { isTouchDevice } from './settings.js';

export class MobileControls {
  constructor(root, state, sensitivityGetter){
    this.root = root;
    this.state = state;
    this.getSensitivity = sensitivityGetter || (() => 50);
    this.active = isTouchDevice();
    this.enabled = false;

    this.joyBase = root.querySelector('#wgJoyBase');
    this.joyKnob = root.querySelector('#wgJoyKnob');
    this.lookArea = root.querySelector('#wgTouchLook');
    this.container = root.querySelector('#wgMobileControls');

    this._joyTouchId = null;
    this._lookTouchId = null;
    this._lookLastX = 0; this._lookLastY = 0;

    this.buttons = {
      shoot: root.querySelector('#wgBtnShoot'),
      aim: root.querySelector('#wgBtnAim'),
      reload: root.querySelector('#wgBtnReload'),
      jump: root.querySelector('#wgBtnJump'),
      crouch: root.querySelector('#wgBtnCrouch'),
      knife: root.querySelector('#wgBtnKnife'),
      gunToggle: root.querySelector('#wgBtnGunM'),
      knifeToggle: root.querySelector('#wgBtnKnifeToggleM'),
      pause: root.querySelector('#wgBtnPauseM'),
    };

    this._bind();
    if (this.active) this.container.classList.add('is-active');
  }

  setEnabled(v){ this.enabled = v; }
  setOpacity(pct){
    if (this.container) this.container.style.opacity = String(pct / 100);
  }

  _bind(){
    // --- Joystick ---
    const joyRadius = 52;
    const startJoy = (id, x, y) => {
      this._joyTouchId = id;
      this._joyOrigin = { x, y };
      this.joyKnob.style.transition = 'none';
    };
    const moveJoy = (x, y) => {
      let dx = x - this._joyOrigin.x, dy = y - this._joyOrigin.y;
      const len = Math.hypot(dx, dy);
      if (len > joyRadius){ dx = dx / len * joyRadius; dy = dy / len * joyRadius; }
      this.joyKnob.style.transform = `translate(${dx}px, ${dy}px)`;
      this.state.moveX = enabled_clamp(dx / joyRadius);
      this.state.moveZ = enabled_clamp(dy / joyRadius);
    };
    const endJoy = () => {
      this._joyTouchId = null;
      this.joyKnob.style.transition = 'transform 0.12s ease';
      this.joyKnob.style.transform = 'translate(0,0)';
      this.state.moveX = 0; this.state.moveZ = 0;
    };
    function enabled_clamp(v){ return Math.max(-1, Math.min(1, v)); }

    this.joyBase.addEventListener('touchstart', (e) => {
      if (!this.enabled) return;
      const t = e.changedTouches[0];
      const rect = this.joyBase.getBoundingClientRect();
      startJoy(t.identifier, rect.left + rect.width/2, rect.top + rect.height/2);
      e.preventDefault();
    }, { passive: false });
    window.addEventListener('touchmove', (e) => {
      if (this._joyTouchId === null) return;
      for (const t of e.changedTouches){
        if (t.identifier === this._joyTouchId) moveJoy(t.clientX, t.clientY);
      }
    }, { passive: true });
    window.addEventListener('touchend', (e) => {
      for (const t of e.changedTouches){
        if (t.identifier === this._joyTouchId) endJoy();
      }
    });

    // --- Look drag ---
    this.lookArea.addEventListener('touchstart', (e) => {
      if (!this.enabled) return;
      // Ignore touches that land on the joystick or a button.
      const t = e.changedTouches[0];
      const el = document.elementFromPoint(t.clientX, t.clientY);
      if (el && (el.closest('.wg-joy-base') || el.closest('.wg-mbtn') || el.closest('.wg-weapon-toggle'))) return;
      this._lookTouchId = t.identifier;
      this._lookLastX = t.clientX; this._lookLastY = t.clientY;
    }, { passive: true });
    window.addEventListener('touchmove', (e) => {
      if (this._lookTouchId === null) return;
      for (const t of e.changedTouches){
        if (t.identifier === this._lookTouchId){
          const sens = this.getSensitivity() / 50;
          const dx = t.clientX - this._lookLastX, dy = t.clientY - this._lookLastY;
          this.state.lookDX += dx * 0.0032 * sens;
          this.state.lookDY += dy * 0.0032 * sens;
          this._lookLastX = t.clientX; this._lookLastY = t.clientY;
        }
      }
    }, { passive: true });
    window.addEventListener('touchend', (e) => {
      for (const t of e.changedTouches){
        if (t.identifier === this._lookTouchId) this._lookTouchId = null;
      }
    });

    // --- Buttons (hold-style: shoot, aim, crouch / tap-style: reload, jump, knife, pause) ---
    const bindHold = (el, onDown, onUp) => {
      if (!el) return;
      el.addEventListener('touchstart', (e) => { if (!this.enabled) return; e.preventDefault(); el.classList.add('is-pressed'); onDown(); }, { passive: false });
      el.addEventListener('touchend', (e) => { e.preventDefault(); el.classList.remove('is-pressed'); onUp(); }, { passive: false });
      el.addEventListener('touchcancel', () => { el.classList.remove('is-pressed'); onUp(); });
    };
    const bindTap = (el, onTap) => {
      if (!el) return;
      el.addEventListener('touchstart', (e) => {
        if (!this.enabled) return;
        e.preventDefault(); e.stopPropagation();
        el.classList.add('is-pressed');
        onTap();
        setTimeout(() => el.classList.remove('is-pressed'), 120);
      }, { passive: false });
    };

    bindHold(this.buttons.shoot, () => this.state.shootHeld = true, () => this.state.shootHeld = false);
    bindHold(this.buttons.aim, () => this.state.aimHeld = true, () => this.state.aimHeld = false);
    let crouchOn = false;
    bindTap(this.buttons.crouch, () => { crouchOn = !crouchOn; this.state.crouchHeld = crouchOn; this.buttons.crouch.classList.toggle('is-pressed', crouchOn); });
    bindTap(this.buttons.reload, () => this.state.reloadPressed = true);
    bindTap(this.buttons.jump, () => this.state.jumpPressed = true);
    bindTap(this.buttons.knife, () => this.state.knifePressed = true);
    bindTap(this.buttons.pause, () => this.state.pausePressed = true);

    bindTap(this.buttons.gunToggle, () => {
      this.state.weaponSwitch = 1;
      this.buttons.gunToggle.classList.add('is-active');
      this.buttons.knifeToggle.classList.remove('is-active');
    });
    bindTap(this.buttons.knifeToggle, () => {
      this.state.weaponSwitch = 2;
      this.buttons.knifeToggle.classList.add('is-active');
      this.buttons.gunToggle.classList.remove('is-active');
    });
  }

  syncWeaponToggle(slot){
    if (!this.buttons.gunToggle) return;
    this.buttons.gunToggle.classList.toggle('is-active', slot === 1);
    this.buttons.knifeToggle.classList.toggle('is-active', slot === 2);
  }
}

export function vibrate(pattern, settings){
  if (!settings || !settings.get('vibration')) return;
  if (navigator.vibrate){
    try { navigator.vibrate(pattern); } catch(e){ /* ignore */ }
  }
}
