// ============================================================================
// audio.js — AudioManager: fully synthesized SFX + adaptive music via the
// Web Audio API. No external audio files, so nothing to fetch or license,
// and it can't fail to load on a slow connection. Must be unlocked by a
// user gesture (handled by main.js calling AudioManager.unlock() on Play).
// ============================================================================

export class AudioManager {
  constructor(){
    this.ctx = null;
    this.master = null;
    this.musicGain = null;
    this.sfxGain = null;
    this.unlocked = false;
    this.musicState = 'explore'; // explore | alert | combat | victory | defeat
    this._musicNodes = [];
    this._musicTimer = null;
    this.settings = { master: 0.8, music: 0.65, sfx: 0.9, muted: false };
  }

  unlock(){
    if (this.unlocked) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    this.ctx = new Ctx();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.settings.muted ? 0 : this.settings.master;
    this.master.connect(this.ctx.destination);
    this.musicGain = this.ctx.createGain();
    this.musicGain.gain.value = this.settings.music;
    this.musicGain.connect(this.master);
    this.sfxGain = this.ctx.createGain();
    this.sfxGain.gain.value = this.settings.sfx;
    this.sfxGain.connect(this.master);
    this.unlocked = true;
    this._startMusicLoop();
  }

  applySettings(s){
    Object.assign(this.settings, s);
    if (!this.ctx) return;
    this.master.gain.setTargetAtTime(this.settings.muted ? 0 : this.settings.master, this.ctx.currentTime, 0.05);
    this.musicGain.gain.setTargetAtTime(this.settings.music, this.ctx.currentTime, 0.05);
    this.sfxGain.gain.setTargetAtTime(this.settings.sfx, this.ctx.currentTime, 0.05);
  }

  setMuted(m){ this.settings.muted = m; this.applySettings({}); }

  // ---- low-level helpers ----------------------------------------------
  _now(){ return this.ctx.currentTime; }

  _noiseBuffer(duration = 0.5){
    const rate = this.ctx.sampleRate;
    const buf = this.ctx.createBuffer(1, rate * duration, rate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  _envGain(node, attack, hold, release, peak = 1){
    const t = this._now();
    node.gain.cancelScheduledValues(t);
    node.gain.setValueAtTime(0.0001, t);
    node.gain.exponentialRampToValueAtTime(peak, t + attack);
    node.gain.setValueAtTime(peak, t + attack + hold);
    node.gain.exponentialRampToValueAtTime(0.0001, t + attack + hold + release);
  }

  // ---- SFX ---------------------------------------------------------------
  gunshot(kind = 'pistol'){
    if (!this.ctx) return;
    const t = this._now();
    // Body: filtered noise burst for the "crack"
    const noise = this.ctx.createBufferSource();
    noise.buffer = this._noiseBuffer(0.25);
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = kind === 'pistol' ? 1400 : 900;
    bp.Q.value = 0.8;
    const g = this.ctx.createGain();
    this._envGain(g, 0.001, 0.02, 0.12, 0.9);
    noise.connect(bp).connect(g).connect(this.sfxGain);
    noise.start(t); noise.stop(t + 0.3);

    // Low thump for weight
    const osc = this.ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(120, t);
    osc.frequency.exponentialRampToValueAtTime(45, t + 0.09);
    const og = this.ctx.createGain();
    this._envGain(og, 0.001, 0.01, 0.14, 0.7);
    osc.connect(og).connect(this.sfxGain);
    osc.start(t); osc.stop(t + 0.2);

    // High tail "sizzle"
    const noise2 = this.ctx.createBufferSource();
    noise2.buffer = this._noiseBuffer(0.3);
    const hp = this.ctx.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 3500;
    const g2 = this.ctx.createGain();
    this._envGain(g2, 0.001, 0.01, 0.22, 0.25);
    noise2.connect(hp).connect(g2).connect(this.sfxGain);
    noise2.start(t); noise2.stop(t + 0.3);
  }

  reloadSound(stage){
    if (!this.ctx) return;
    const t = this._now();
    // stage: 'out' (mag drop), 'in' (mag insert), 'rack' (slide rack)
    const freq = stage === 'out' ? 480 : stage === 'in' ? 620 : 900;
    const osc = this.ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.value = freq;
    const g = this.ctx.createGain();
    this._envGain(g, 0.001, 0.01, 0.06, 0.35);
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 2200;
    osc.connect(lp).connect(g).connect(this.sfxGain);
    osc.start(t); osc.stop(t + 0.1);
  }

  knifeSwing(){
    if (!this.ctx) return;
    const t = this._now();
    const noise = this.ctx.createBufferSource();
    noise.buffer = this._noiseBuffer(0.25);
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(2200, t);
    bp.frequency.exponentialRampToValueAtTime(600, t + 0.18);
    bp.Q.value = 1.2;
    const g = this.ctx.createGain();
    this._envGain(g, 0.001, 0.02, 0.16, 0.5);
    noise.connect(bp).connect(g).connect(this.sfxGain);
    noise.start(t); noise.stop(t + 0.25);
  }

  knifeImpact(){
    if (!this.ctx) return;
    const t = this._now();
    const noise = this.ctx.createBufferSource();
    noise.buffer = this._noiseBuffer(0.15);
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 700;
    const g = this.ctx.createGain();
    this._envGain(g, 0.001, 0.01, 0.1, 0.7);
    noise.connect(lp).connect(g).connect(this.sfxGain);
    noise.start(t); noise.stop(t + 0.15);
  }

  footstep(surface = 'wood', running = false){
    if (!this.ctx) return;
    const t = this._now();
    const freqMap = { wood: 220, tile: 340, carpet: 140, concrete: 260 };
    const noise = this.ctx.createBufferSource();
    noise.buffer = this._noiseBuffer(0.1);
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = freqMap[surface] || 220;
    bp.Q.value = surface === 'carpet' ? 0.5 : 1.4;
    const g = this.ctx.createGain();
    this._envGain(g, 0.001, 0.005, surface === 'carpet' ? 0.05 : 0.08, running ? 0.32 : 0.2);
    noise.connect(bp).connect(g).connect(this.sfxGain);
    noise.start(t); noise.stop(t + 0.12);
  }

  jump(){ this._blip(520, 0.08, 'sine'); }
  land(){ this._blip(140, 0.12, 'triangle', 0.5); }

  _blip(freq, dur, type = 'sine', peak = 0.4){
    if (!this.ctx) return;
    const t = this._now();
    const osc = this.ctx.createOscillator();
    osc.type = type; osc.frequency.value = freq;
    const g = this.ctx.createGain();
    this._envGain(g, 0.005, 0.02, dur, peak);
    osc.connect(g).connect(this.sfxGain);
    osc.start(t); osc.stop(t + dur + 0.05);
  }

  bulletImpact(surface = 'wall'){
    if (!this.ctx) return;
    const t = this._now();
    const noise = this.ctx.createBufferSource();
    noise.buffer = this._noiseBuffer(0.12);
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = surface === 'flesh' ? 300 : 1600;
    bp.Q.value = 1;
    const g = this.ctx.createGain();
    this._envGain(g, 0.001, 0.01, 0.1, 0.5);
    noise.connect(bp).connect(g).connect(this.sfxGain);
    noise.start(t); noise.stop(t + 0.12);
  }

  hitGrunt(){
    if (!this.ctx) return;
    const t = this._now();
    const osc = this.ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(180, t);
    osc.frequency.exponentialRampToValueAtTime(90, t + 0.15);
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 900;
    const g = this.ctx.createGain();
    this._envGain(g, 0.001, 0.02, 0.18, 0.5);
    osc.connect(lp).connect(g).connect(this.sfxGain);
    osc.start(t); osc.stop(t + 0.25);
  }

  deathSound(){
    if (!this.ctx) return;
    const t = this._now();
    const osc = this.ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(220, t);
    osc.frequency.exponentialRampToValueAtTime(50, t + 0.6);
    const g = this.ctx.createGain();
    this._envGain(g, 0.005, 0.05, 0.6, 0.55);
    osc.connect(g).connect(this.sfxGain);
    osc.start(t); osc.stop(t + 0.7);
  }

  uiClick(){ this._blip(700, 0.05, 'square', 0.25); }

  // ---- Adaptive music ------------------------------------------------------
  setMusicState(state){
    if (this.musicState === state) return;
    this.musicState = state;
  }

  _startMusicLoop(){
    if (!this.ctx) return;
    const step = () => {
      this._playMusicBar();
      const bpm = this.musicState === 'combat' ? 150 : this.musicState === 'alert' ? 110 : 78;
      const barSeconds = (60 / bpm) * 4;
      this._musicTimer = setTimeout(step, barSeconds * 1000);
    };
    step();
  }

  _playMusicBar(){
    if (!this.ctx) return;
    const t = this._now();
    const state = this.musicState;
    const bpm = state === 'combat' ? 150 : state === 'alert' ? 110 : 78;
    const beat = 60 / bpm;

    // Sub bass pulse — present in every state, deeper/louder in combat.
    const bassFreq = state === 'combat' ? 55 : 48;
    for (let i = 0; i < 4; i++){
      const bt = t + i * beat;
      const osc = this.ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = bassFreq;
      const g = this.ctx.createGain();
      const peak = state === 'combat' ? 0.5 : state === 'alert' ? 0.3 : 0.16;
      g.gain.setValueAtTime(0.0001, bt);
      g.gain.exponentialRampToValueAtTime(peak, bt + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, bt + beat * 0.85);
      osc.connect(g).connect(this.musicGain);
      osc.start(bt); osc.stop(bt + beat);
    }

    if (state === 'combat'){
      // Driving arp for tension.
      const notes = [110, 130.8, 146.8, 130.8];
      for (let i = 0; i < 8; i++){
        const bt = t + i * (beat / 2);
        const osc = this.ctx.createOscillator();
        osc.type = 'square';
        osc.frequency.value = notes[i % notes.length];
        const g = this.ctx.createGain();
        g.gain.setValueAtTime(0.0001, bt);
        g.gain.exponentialRampToValueAtTime(0.14, bt + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, bt + beat * 0.4);
        const lp = this.ctx.createBiquadFilter();
        lp.type = 'lowpass'; lp.frequency.value = 1800;
        osc.connect(lp).connect(g).connect(this.musicGain);
        osc.start(bt); osc.stop(bt + beat / 2);
      }
      // Noise hats
      for (let i = 0; i < 4; i++){
        const bt = t + i * beat + beat / 2;
        const noise = this.ctx.createBufferSource();
        noise.buffer = this._noiseBuffer(0.05);
        const hp = this.ctx.createBiquadFilter();
        hp.type = 'highpass'; hp.frequency.value = 6000;
        const g = this.ctx.createGain();
        g.gain.setValueAtTime(0.0001, bt);
        g.gain.exponentialRampToValueAtTime(0.08, bt + 0.005);
        g.gain.exponentialRampToValueAtTime(0.0001, bt + 0.05);
        noise.connect(hp).connect(g).connect(this.musicGain);
        noise.start(bt); noise.stop(bt + 0.06);
      }
    } else if (state === 'alert'){
      const osc = this.ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = 87.3;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.1, t + 0.3);
      g.gain.exponentialRampToValueAtTime(0.0001, t + beat * 3.6);
      const lp = this.ctx.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.value = 500;
      osc.connect(lp).connect(g).connect(this.musicGain);
      osc.start(t); osc.stop(t + beat * 4);
    } else if (state === 'explore'){
      // Sparse ambient pad, low and slow.
      const osc = this.ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = 65.4;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.06, t + 1.2);
      g.gain.exponentialRampToValueAtTime(0.0001, t + beat * 4 - 0.1);
      osc.connect(g).connect(this.musicGain);
      osc.start(t); osc.stop(t + beat * 4);
    }
  }

  stingerVictory(){
    if (!this.ctx) return;
    const t = this._now();
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((f, i) => {
      const osc = this.ctx.createOscillator();
      osc.type = 'triangle'; osc.frequency.value = f;
      const g = this.ctx.createGain();
      const bt = t + i * 0.14;
      g.gain.setValueAtTime(0.0001, bt);
      g.gain.exponentialRampToValueAtTime(0.3, bt + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, bt + 0.5);
      osc.connect(g).connect(this.musicGain);
      osc.start(bt); osc.stop(bt + 0.55);
    });
  }

  stingerDefeat(){
    if (!this.ctx) return;
    const t = this._now();
    const notes = [220, 196, 174.6, 130.8];
    notes.forEach((f, i) => {
      const osc = this.ctx.createOscillator();
      osc.type = 'sawtooth'; osc.frequency.value = f;
      const g = this.ctx.createGain();
      const bt = t + i * 0.22;
      g.gain.setValueAtTime(0.0001, bt);
      g.gain.exponentialRampToValueAtTime(0.28, bt + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, bt + 0.5);
      osc.connect(g).connect(this.musicGain);
      osc.start(bt); osc.stop(bt + 0.55);
    });
  }
}
