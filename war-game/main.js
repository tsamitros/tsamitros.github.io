// ============================================================================
// main.js — Game: boots Three.js, owns the frame loop and game state machine
// (menu / playing / paused / won / lost), and wires every subsystem together.
// This file intentionally contains no rendering-detail or AI logic of its
// own — it orchestrates the modules that do.
// ============================================================================
import * as THREE from 'three';
import { AudioManager } from './audio.js';
import { SettingsManager, detectDefaultGraphics, GRAPHICS_PRESETS, isTouchDevice } from './settings.js';
import { createInputState, InputManager } from './input.js';
import { MobileControls, vibrate } from './mobileControls.js';
import { buildHouse } from './world.js';
import { disposeObject3D } from './utils.js';
import { PlayerController } from './player.js';
import { CameraController } from './camera.js';
import { WeaponSystem } from './weapons.js';
import { EnemyManager } from './enemyAI.js';
import { MissionManager, MISSIONS } from './missions.js';
import { UIManager } from './ui.js';

const root = document;
const canvas = root.getElementById('wgCanvas');

// ---------------------------------------------------------------------------
// Boot sequence
// ---------------------------------------------------------------------------
const settings = new SettingsManager();
if (!settings.hasSavedGraphicsChoice()){
  settings.set('graphics', detectDefaultGraphics());
}
const quality = { ...GRAPHICS_PRESETS[settings.get('graphics')] };

const audio = new AudioManager();
audio.applySettings({
  master: settings.get('masterVolume') / 100,
  music: settings.get('musicVolume') / 100,
  sfx: settings.get('sfxVolume') / 100,
  muted: !!settings.get('muted'),
});

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = quality.shadows;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, quality.pixelRatioCap));

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x05060a);
scene.fog = new THREE.Fog(0x05060a, quality.drawDistance * 0.5, quality.drawDistance);

const camera = new THREE.PerspectiveCamera(62, 1, 0.1, 100);

function resize(){
  const w = canvas.clientWidth || window.innerWidth;
  const h = canvas.clientHeight || window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / Math.max(1, h);
  camera.updateProjectionMatrix();
  checkOrientation();
}
window.addEventListener('resize', resize);

function checkOrientation(){
  const isPortraitMobile = isTouchDevice() && window.innerHeight > window.innerWidth && gameState === 'playing';
  ui.setRotatePromptVisible(isPortraitMobile);
}

// ---------------------------------------------------------------------------
// World + entities (rebuilt fresh on every mission start/restart so a dead
// enemy or spent ammo never carries over between attempts)
// ---------------------------------------------------------------------------
let world, player, camCtrl, weapon, enemyManager, mission;
let houseGroup = null;

function buildWorldAndActors(missionId){
  // Tear down the previous mission's actors and geometry before rebuilding —
  // otherwise every (re)start leaves the old player/enemy rigs and house
  // meshes orphaned in the scene graph (still rendered, just invisible under
  // the new ones), wasting draw calls and GPU memory on every retry.
  if (houseGroup) disposeObject3D(houseGroup, false); // false: house materials reuse cached textures
  if (player) player.dispose();
  if (enemyManager) enemyManager.dispose();

  world = buildHouse(scene, quality);
  houseGroup = world.group;

  player = new PlayerController({ scene, world, audio, inputState, quality });
  player.setWeaponSlot(1);
  player.onNoise = (pos, radius) => enemyManager.broadcastNoise(pos, radius, false);
  player.damageFlashCallback = () => ui.flashDamage();
  player.onDeathCallback = () => { /* handled via mission.update watching player.alive */ };

  camCtrl = new CameraController(camera, () => world.occluders);

  enemyManager = new EnemyManager({ scene, world, audio, quality });

  weapon = new WeaponSystem({
    scene, camera, audio,
    animator: player.animator,
    getMuzzleWorldPosition: () => {
      const p = new THREE.Vector3();
      player.gunMesh.getWorldPosition(p);
      return p;
    },
    getEnemyCombatants: () => enemyManager.getCombatants(),
    occludersRef: () => world.occluders,
    quality,
    onStatsHit: (kind, result) => {
      mission.recordStatHit(kind, result);
      if (kind === 'hit' || kind === 'knifeHit'){
        ui.flashHitMarker(result && result.headshot);
      }
    },
    vibrate: (pattern) => vibrate(pattern, settings),
  });

  mission = new MissionManager(missionId);
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------
const inputState = createInputState();
const inputManager = new InputManager(canvas, inputState, () => settings.get('sensitivity'));
const mobileControls = new MobileControls(root, inputState, () => settings.get('sensitivity'));
mobileControls.setOpacity(settings.get('mobileOpacity'));

// ---------------------------------------------------------------------------
// UI
// ---------------------------------------------------------------------------
let gameState = 'boot'; // boot | menu | playing | paused | won | lost
let prevShootHeld = false;

const ui = new UIManager(root, {
  onPlay: (missionId) => startMission(missionId),
  onResume: () => resumeGame(),
  onRestart: () => startMission(mission ? mission.mission.id : MISSIONS[0].id),
  onMainMenu: () => goToMainMenu(),
  onPauseRequested: () => pauseGame(),
  onSettingChange: (key, value) => {
    settings.set(key, value);
    applyLiveSetting(key, value);
  },
  onFullscreenToggle: () => toggleFullscreen(),
});
ui.applySettingsToInputs(settings);

function applyLiveSetting(key, value){
  if (key === 'masterVolume' || key === 'musicVolume' || key === 'sfxVolume'){
    audio.applySettings({
      master: settings.get('masterVolume') / 100,
      music: settings.get('musicVolume') / 100,
      sfx: settings.get('sfxVolume') / 100,
    });
  } else if (key === 'mobileOpacity'){
    mobileControls.setOpacity(value);
  } else if (key === 'graphics'){
    const preset = GRAPHICS_PRESETS[value];
    Object.assign(quality, preset); // live-updates particleScale/drawDistance for anything reading `quality` by reference
    renderer.shadowMap.enabled = preset.shadows;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, preset.pixelRatioCap));
    scene.fog.far = preset.drawDistance;
    scene.fog.near = preset.drawDistance * 0.5;
    // Shadow resolution and full relighting apply cleanly on the next mission (re)start.
  } else if (key === 'vibration'){
    // read live via settings.get in vibrate() calls
  }
}

function toggleFullscreen(){
  const el = root.getElementById('wgRoot');
  if (!document.fullscreenElement){
    if (el.requestFullscreen) el.requestFullscreen().catch(() => {});
  } else if (document.exitFullscreen){
    document.exitFullscreen().catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Game state transitions
// ---------------------------------------------------------------------------
function startMission(missionId){
  audio.unlock();
  buildWorldAndActors(missionId);
  gameState = 'playing';
  ui.showScreen(null);
  ui.setHudVisible(true);
  inputManager.setEnabled(true);
  mobileControls.setEnabled(true);
  if (!isTouchDevice()) inputManager.requestPointerLock();
  checkOrientation();
}

function pauseGame(){
  if (gameState !== 'playing') return;
  gameState = 'paused';
  inputManager.setEnabled(false);
  mobileControls.setEnabled(false);
  inputManager.exitPointerLock();
  ui.showScreen('wgPauseMenu');
}

function resumeGame(){
  if (gameState !== 'paused') return;
  gameState = 'playing';
  ui.showScreen(null);
  inputManager.setEnabled(true);
  mobileControls.setEnabled(true);
  if (!isTouchDevice()) inputManager.requestPointerLock();
}

function goToMainMenu(){
  gameState = 'menu';
  inputManager.setEnabled(false);
  mobileControls.setEnabled(false);
  inputManager.exitPointerLock();
  ui.setHudVisible(false);
  ui.setRotatePromptVisible(false);
  ui.showScreen('wgStartMenu');
}

function endMission(won){
  gameState = won ? 'won' : 'lost';
  inputManager.setEnabled(false);
  mobileControls.setEnabled(false);
  inputManager.exitPointerLock();
  ui.setHudVisible(false);
  audio.setMusicState(won ? 'victory' : 'defeat');
  if (won){
    audio.stingerVictory();
    settings.markMissionComplete(mission.mission.id, {
      kills: mission.stats.kills, accuracy: mission.accuracy(), time: mission.formattedTime(),
    });
    ui.showWin(mission.mission.name, {
      kills: mission.stats.kills,
      accuracy: mission.accuracy(),
      shotsFired: mission.stats.shotsFired,
      headshots: mission.stats.headshots,
      time: mission.formattedTime(),
      damageTaken: mission.stats.damageTaken,
    });
  } else {
    audio.stingerDefeat();
    ui.showLose();
  }
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden && gameState === 'playing') pauseGame();
});

// ---------------------------------------------------------------------------
// Frame loop
// ---------------------------------------------------------------------------
let lastTime = performance.now();

function frame(now){
  requestAnimationFrame(frame);
  let dt = (now - lastTime) / 1000;
  lastTime = now;
  dt = Math.min(dt, 1 / 20); // clamp huge stalls (tab switches, GC pauses)

  if (gameState === 'playing'){
    updateGameplay(dt);
  }

  renderer.render(scene, camera);
}

function updateGameplay(dt){
  if (inputState.pausePressed){ pauseGame(); inputManager.consumeEdges(); return; }

  player.update(dt, true);
  camCtrl.update(dt, player);

  // Weapon switching + fire/melee (edge-triggered so holding the button
  // doesn't spam full-auto out of a semi-auto pistol).
  if (inputState.weaponSwitch === 1) weapon.switchTo(1);
  if (inputState.weaponSwitch === 2) weapon.switchTo(2);
  if (inputState.knifePressed){ weapon.switchTo(2); player.setWeaponSlot(2); weapon.swingKnife(); }
  player.setWeaponSlot(weapon.slot);

  const shootEdge = inputState.shootHeld && !prevShootHeld;
  prevShootHeld = inputState.shootHeld;
  if (shootEdge){
    if (weapon.slot === 1){
      const fired = weapon.fireGun();
      if (fired) enemyManager.broadcastNoise(player.getPosition(), 15, true);
    } else {
      weapon.swingKnife();
    }
  }
  if (inputState.reloadPressed) weapon.requestReload();

  weapon.update(dt);

  const ctx = { player, occluders: world.occluders, statsTracker: mission.stats };
  enemyManager.update(dt, ctx);

  mission.update(dt, enemyManager, player);

  const awareness = enemyManager.getHighestAwareness();
  audio.setMusicState(awareness === 'combat' ? 'combat' : (awareness === 'alert' || awareness === 'suspicious') ? 'alert' : 'explore');

  const hud = weapon.getHudState();
  ui.updateHud({
    health: player.health,
    weaponName: hud.weaponName,
    mag: hud.mag,
    reserve: hud.reserve,
    reloading: hud.reloading,
    objective: mission.mission.objective + ` (${enemyManager.aliveCount()} left)`,
    awareness,
    aiming: player.aiming,
    moving: player.movingSpeed01 > 0.05,
  });

  inputManager.consumeEdges();

  if (mission.state === 'won') endMission(true);
  else if (mission.state === 'lost') endMission(false);
}

// ---------------------------------------------------------------------------
// Loading screen -> start menu
// ---------------------------------------------------------------------------
function boot(){
  resize();
  ui.setLoadProgress(15, 'PREPARING RENDERER…');
  requestAnimationFrame(() => {
    ui.setLoadProgress(55, 'BUILDING SAFE HOUSE…');
    requestAnimationFrame(() => {
      // Warm up geometry once off-screen so the first real mission start
      // doesn't hitch on shader compilation.
      buildWorldAndActors(MISSIONS[0].id);
      ui.setLoadProgress(90, 'ARMING…');
      requestAnimationFrame(() => {
        ui.setLoadProgress(100, 'READY');
        setTimeout(() => {
          gameState = 'menu';
          ui.showScreen('wgStartMenu');
        }, 260);
      });
    });
  });
}

boot();
requestAnimationFrame(frame);
