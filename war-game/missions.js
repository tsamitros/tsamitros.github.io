// ============================================================================
// missions.js — MissionManager: objective tracking, stats, win/lose checks.
// Data-driven so more missions can be added later without touching the
// engine code; only Mission 1 is fully implemented today (see MISSIONS list
// for the honest "locked" placeholders for 2 and 3).
// ============================================================================

export const MISSIONS = [
  {
    id: 'clear-house',
    name: 'Clear the House',
    objective: 'Eliminate all hostiles',
    locked: false,
  },
  {
    id: 'secure-area',
    name: 'Secure the Area',
    objective: 'Coming soon',
    locked: true,
  },
  {
    id: 'hostage-rescue',
    name: 'Hostage Rescue',
    objective: 'Coming soon',
    locked: true,
  },
];

export class MissionManager {
  constructor(missionId){
    this.setMission(missionId || MISSIONS[0].id);
  }

  setMission(id){
    this.mission = MISSIONS.find(m => m.id === id) || MISSIONS[0];
    this.time = 0;
    this.stats = { shotsFired: 0, hits: 0, headshots: 0, kills: 0, damageTaken: 0 };
    this.state = 'active'; // active | won | lost
  }

  recordStatHit(kind, result){
    if (kind === 'shot') this.stats.shotsFired++;
    if (kind === 'hit' || kind === 'knifeHit'){
      this.stats.hits++;
      if (result && result.killed){
        this.stats.kills++;
        if (result.headshot) this.stats.headshots++;
      }
    }
  }

  accuracy(){
    if (this.stats.shotsFired === 0) return this.stats.hits > 0 ? 100 : 0;
    return Math.round((this.stats.hits / this.stats.shotsFired) * 100);
  }

  formattedTime(){
    const total = Math.floor(this.time);
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  update(dt, enemyManager, player){
    if (this.state !== 'active') return;
    this.time += dt;
    if (!player.alive){
      this.state = 'lost';
      return;
    }
    if (enemyManager.allDead()){
      this.state = 'won';
    }
  }
}
