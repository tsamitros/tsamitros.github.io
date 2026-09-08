// ============================================================================
// ui.js — UIManager: screen switching, HUD updates, settings/pause/win/lose
// wiring. Pure DOM glue — no game logic lives here, it only reads state
// handed to it each frame and forwards user actions via callbacks.
// ============================================================================
import { MISSIONS } from './missions.js';

const SCREEN_IDS = [
  'wgLoading', 'wgStartMenu', 'wgMissionsMenu', 'wgSettingsMenu', 'wgControlsMenu',
  'wgCreditsMenu', 'wgPauseMenu', 'wgWin', 'wgLose',
];

export class UIManager {
  constructor(root, callbacks){
    this.root = root;
    this.cb = callbacks;
    this.el = {};
    SCREEN_IDS.forEach(id => { this.el[id] = root.querySelector('#' + id); });
    this.el.hud = root.querySelector('#wgHud');
    this._cacheEls();
    this._bindMenus();
    this._bindSettings();
    this._history = [];
    this._settingsReturnTo = 'wgStartMenu';
  }

  _cacheEls(){
    const q = (sel) => this.root.querySelector(sel);
    this.healthFill = q('#wgHealthFill');
    this.ammoMag = q('#wgAmmoMag');
    this.ammoReserve = q('#wgAmmoReserve');
    this.weaponName = q('#wgWeaponName');
    this.reloadHint = q('#wgReloadHint');
    this.crosshair = q('#wgCrosshair');
    this.hitMarker = q('#wgHitMarker');
    this.damageVignette = q('#wgDamageVignette');
    this.awareness = q('#wgAwareness');
    this.objectiveText = q('#wgObjectiveText');
    this.loadBar = q('#wgLoadBar');
    this.loadHint = q('#wgLoadHint');
    this.rotatePrompt = q('#wgRotatePrompt');
    this.missionList = q('#wgMissionList');
    this.graphicsSeg = q('#wgGraphicsSeg');
  }

  showScreen(id){
    SCREEN_IDS.forEach(sid => {
      if (!this.el[sid]) return;
      this.el[sid].hidden = sid !== id;
    });
  }

  setHudVisible(v){ this.el.hud.hidden = !v; }

  _bindMenus(){
    const c = this.cb;
    this.root.querySelector('#wgPlayBtn').addEventListener('click', () => c.onPlay(MISSIONS[0].id));
    this.root.querySelector('#wgMissionsBtn').addEventListener('click', () => { this._renderMissions(); this.showScreen('wgMissionsMenu'); });
    this.root.querySelector('#wgSettingsBtn').addEventListener('click', () => { this._settingsReturnTo = 'wgStartMenu'; this.showScreen('wgSettingsMenu'); });
    this.root.querySelector('#wgControlsBtn').addEventListener('click', () => this.showScreen('wgControlsMenu'));
    this.root.querySelector('#wgCreditsBtn').addEventListener('click', () => this.showScreen('wgCreditsMenu'));
    this.root.querySelectorAll('[data-wg-back]').forEach(btn => {
      btn.addEventListener('click', () => this.showScreen(btn.getAttribute('data-wg-back')));
    });
    this.root.querySelector('#wgSettingsBackBtn').addEventListener('click', () => this.showScreen(this._settingsReturnTo));

    this.root.querySelectorAll('[data-wg-tab]').forEach(tabBtn => {
      tabBtn.addEventListener('click', () => {
        const group = tabBtn.parentElement.querySelectorAll('[data-wg-tab]');
        group.forEach(b => b.classList.remove('is-active'));
        tabBtn.classList.add('is-active');
        const target = tabBtn.getAttribute('data-wg-tab');
        ['wgTabDesktop', 'wgTabMobile'].forEach(id => { this.root.querySelector('#' + id).hidden = id !== target; });
      });
    });

    // Pause menu
    this.root.querySelector('#wgResumeBtn').addEventListener('click', () => c.onResume());
    this.root.querySelector('#wgRestartBtn').addEventListener('click', () => c.onRestart());
    this.root.querySelector('#wgPauseSettingsBtn').addEventListener('click', () => { this._settingsReturnTo = 'wgPauseMenu'; this.showScreen('wgSettingsMenu'); });
    this.root.querySelector('#wgMainMenuBtn').addEventListener('click', () => c.onMainMenu());
    this.root.querySelector('#wgPauseBtn').addEventListener('click', () => c.onPauseRequested());

    // Win / lose
    this.root.querySelector('#wgWinNextBtn').addEventListener('click', () => c.onMainMenu());
    this.root.querySelector('#wgWinMenuBtn').addEventListener('click', () => c.onMainMenu());
    this.root.querySelector('#wgLoseRestartBtn').addEventListener('click', () => c.onRestart());
    this.root.querySelector('#wgLoseMenuBtn').addEventListener('click', () => c.onMainMenu());
  }

  _renderMissions(){
    this.missionList.innerHTML = '';
    MISSIONS.forEach(m => {
      const btn = document.createElement('button');
      btn.className = 'wg-btn' + (m.locked ? ' wg-ghost' : ' wg-primary');
      btn.textContent = m.locked ? (m.name + ' — Locked') : m.name;
      btn.disabled = m.locked;
      if (m.locked) btn.style.opacity = '0.45';
      btn.addEventListener('click', () => { if (!m.locked) this.cb.onPlay(m.id); });
      this.missionList.appendChild(btn);
    });
  }

  _bindSettings(){
    const c = this.cb;
    const bindRange = (id, key) => {
      const el = this.root.querySelector('#' + id);
      el.addEventListener('input', () => c.onSettingChange(key, parseInt(el.value, 10)));
    };
    bindRange('wgVolMaster', 'masterVolume');
    bindRange('wgVolMusic', 'musicVolume');
    bindRange('wgVolSfx', 'sfxVolume');
    bindRange('wgSensitivity', 'sensitivity');
    bindRange('wgOpacity', 'mobileOpacity');

    this.graphicsSeg.querySelectorAll('button').forEach(btn => {
      btn.addEventListener('click', () => {
        this.graphicsSeg.querySelectorAll('button').forEach(b => b.classList.remove('is-active'));
        btn.classList.add('is-active');
        c.onSettingChange('graphics', btn.getAttribute('data-q'));
      });
    });

    const vibToggle = this.root.querySelector('#wgVibrationToggle');
    vibToggle.addEventListener('click', () => {
      const on = !vibToggle.classList.contains('is-on');
      vibToggle.classList.toggle('is-on', on);
      c.onSettingChange('vibration', on);
    });

    this.root.querySelector('#wgFullscreenBtn').addEventListener('click', () => c.onFullscreenToggle());
  }

  applySettingsToInputs(settings){
    this.root.querySelector('#wgVolMaster').value = settings.get('masterVolume');
    this.root.querySelector('#wgVolMusic').value = settings.get('musicVolume');
    this.root.querySelector('#wgVolSfx').value = settings.get('sfxVolume');
    this.root.querySelector('#wgSensitivity').value = settings.get('sensitivity');
    this.root.querySelector('#wgOpacity').value = settings.get('mobileOpacity');
    this.graphicsSeg.querySelectorAll('button').forEach(b => b.classList.toggle('is-active', b.getAttribute('data-q') === settings.get('graphics')));
    this.root.querySelector('#wgVibrationToggle').classList.toggle('is-on', !!settings.get('vibration'));
  }

  setLoadProgress(pct, hint){
    this.loadBar.style.width = clampPct(pct) + '%';
    if (hint) this.loadHint.textContent = hint;
  }

  setRotatePromptVisible(v){ this.rotatePrompt.classList.toggle('is-visible', v); }

  // ---- Per-frame HUD updates ----
  updateHud(state){
    this.healthFill.style.width = clampPct(state.health) + '%';
    this.healthFill.style.background = state.health < 30
      ? 'linear-gradient(90deg,#b91c1c,#ef4444)'
      : 'linear-gradient(90deg,#ff3b3b,#ff8c3b)';
    this.weaponName.textContent = state.weaponName;
    if (state.mag === null){
      this.ammoMag.textContent = '—';
      this.ammoReserve.textContent = '—';
    } else {
      this.ammoMag.textContent = state.mag;
      this.ammoReserve.textContent = state.reserve;
    }
    this.reloadHint.textContent = state.reloading ? 'RELOADING…' : '';
    this.objectiveText.textContent = state.objective;

    this.awareness.textContent = capitalize(state.awareness);
    this.awareness.className = 'wg-awareness ' + (state.awareness === 'suspicious' ? 'lvl-suspicious'
      : state.awareness === 'alert' ? 'lvl-alert'
      : state.awareness === 'combat' ? 'lvl-combat' : '');

    this.crosshair.classList.toggle('is-aiming', state.aiming);
    this.crosshair.classList.toggle('is-moving', state.moving && !state.aiming);
  }

  flashDamage(){
    this.damageVignette.style.opacity = '0.85';
    clearTimeout(this._dmgTimer);
    this._dmgTimer = setTimeout(() => { this.damageVignette.style.opacity = '0'; }, 260);
  }

  flashHitMarker(headshot){
    this.hitMarker.style.transition = 'none';
    this.hitMarker.style.opacity = '1';
    this.hitMarker.style.transform = 'translate(-50%,-50%) rotate(45deg) scale(1)';
    if (headshot) this.hitMarker.style.background = 'none';
    requestAnimationFrame(() => {
      this.hitMarker.style.transition = 'opacity 0.25s ease, transform 0.25s ease';
      this.hitMarker.style.opacity = '0';
      this.hitMarker.style.transform = 'translate(-50%,-50%) rotate(45deg) scale(1.5)';
    });
  }

  showWin(missionName, stats){
    this.root.querySelector('#wgWinMissionName').textContent = missionName;
    this.root.querySelector('#wgStatKills').textContent = stats.kills;
    this.root.querySelector('#wgStatAccuracy').textContent = stats.accuracy + '%';
    this.root.querySelector('#wgStatShots').textContent = stats.shotsFired;
    this.root.querySelector('#wgStatHeadshots').textContent = stats.headshots;
    this.root.querySelector('#wgStatTime').textContent = stats.time;
    this.root.querySelector('#wgStatDamage').textContent = stats.damageTaken;
    this.showScreen('wgWin');
  }

  showLose(){ this.showScreen('wgLose'); }
}

function clampPct(v){ return Math.max(0, Math.min(100, v)); }
function capitalize(s){ return s.charAt(0).toUpperCase() + s.slice(1); }
