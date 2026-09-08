// ============================================================================
// settings.js — SettingsManager: persists audio/graphics/control preferences
// and mission completion to localStorage. No account required.
// ============================================================================
const STORAGE_KEY = 'stou-breach-clear-settings';
const PROGRESS_KEY = 'stou-breach-clear-progress';

const DEFAULTS = {
  masterVolume: 80,
  musicVolume: 65,
  sfxVolume: 90,
  sensitivity: 50,
  mobileOpacity: 85,
  graphics: 'high', // low | medium | high — overridden by device detection on first run
  vibration: true,
  muted: false,
};

export class SettingsManager {
  constructor(){
    this.values = { ...DEFAULTS, ...this._load() };
  }

  _load(){
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch(e){ return {}; }
  }

  save(){
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(this.values)); } catch(e){ /* ignore */ }
  }

  set(key, value){
    this.values[key] = value;
    this.save();
  }

  get(key){ return this.values[key]; }

  hasSavedGraphicsChoice(){
    try { return !!localStorage.getItem(STORAGE_KEY); } catch(e){ return false; }
  }

  // ---- mission progress ----------------------------------------------
  getProgress(){
    try {
      const raw = localStorage.getItem(PROGRESS_KEY);
      return raw ? JSON.parse(raw) : { completed: [] };
    } catch(e){ return { completed: [] }; }
  }

  markMissionComplete(missionId, stats){
    const progress = this.getProgress();
    if (!progress.completed.includes(missionId)) progress.completed.push(missionId);
    progress.lastStats = progress.lastStats || {};
    progress.lastStats[missionId] = stats;
    try { localStorage.setItem(PROGRESS_KEY, JSON.stringify(progress)); } catch(e){ /* ignore */ }
    return progress;
  }
}

export function detectDefaultGraphics(){
  const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) ||
    (navigator.maxTouchPoints && navigator.maxTouchPoints > 1 && !/Macintosh/i.test(navigator.userAgent));
  const cores = navigator.hardwareConcurrency || 4;
  if (isMobile) return cores >= 6 ? 'medium' : 'low';
  return cores >= 8 ? 'high' : 'medium';
}

export function isTouchDevice(){
  return ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
}

export const GRAPHICS_PRESETS = {
  low:    { shadows: false, shadowMapSize: 512,  pixelRatioCap: 1.0, particleScale: 0.35, drawDistance: 26, ambientOcclusion: false },
  medium: { shadows: true,  shadowMapSize: 1024, pixelRatioCap: 1.5, particleScale: 0.7,  drawDistance: 34, ambientOcclusion: false },
  high:   { shadows: true,  shadowMapSize: 2048, pixelRatioCap: 2.0, particleScale: 1.0,  drawDistance: 44, ambientOcclusion: true },
};
