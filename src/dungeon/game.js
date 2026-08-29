/**
 * Nexus Depths - the game.
 *
 * A run is one generated dungeon. You start on depth 1 with a pulse weapon,
 * fight down four floors collecting the keys that open the way, and destroy the
 * Warden in the deepest chamber. Kills feed a combo multiplier that decays in
 * seconds, so the loop rewards pushing forward rather than turtling.
 */

import { generateDungeon, ROOM_TYPE } from './generator.js';
import { compileDungeon, Box } from './compiler.js';
import { DungeonPhysics } from './physics.js';
import { Renderer } from './renderer.js';
import { AutoMap } from './minimap.js';
import { Swarm } from './entities.js';
import { AudioEngine } from './audio.js';
import { RNG } from './rng.js';
import { TILE_SIZE } from './grid.js';

const MOVE_CODES = new Set([
  'KeyW', 'KeyA', 'KeyS', 'KeyD',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'ShiftLeft', 'ShiftRight',
]);

const PLAYER = {
  maxHp: 120,
  maxEnergy: 100,
  energyRegen: 24,
  regenDelay: 0.32,
  walkSpeed: 3.3,
  runSpeed: 5.5,
  eye: 1.62,
  invulnAfterHit: 0.45,
};

const PULSE = { cost: 7, damage: 17, cooldown: 0.13, range: 46 };
const BLAST = { cost: 34, damage: 52, splash: 34, radius: 3.3, cooldown: 0.6, range: 40 };

const COMBO_WINDOW = 4.0;

const DEPTH_NAMES = ['Flooded Undercroft', 'Bone Galleries', 'Verdigris Works', 'Emberforge'];

export class Game {
  constructor() {
    this.el = {
      canvas: document.getElementById('gl'),
      map: document.getElementById('map'),
      hp: document.getElementById('hpFill'),
      hpText: document.getElementById('hpText'),
      energy: document.getElementById('energyFill'),
      energyText: document.getElementById('energyText'),
      score: document.getElementById('score'),
      combo: document.getElementById('combo'),
      comboBar: document.getElementById('comboBar'),
      depth: document.getElementById('depth'),
      objective: document.getElementById('objective'),
      keys: document.getElementById('keys'),
      compass: document.getElementById('compass'),
      crosshair: document.getElementById('cross'),
      hitmark: document.getElementById('hitmark'),
      damage: document.getElementById('damageFlash'),
      lowHp: document.getElementById('lowHp'),
      banner: document.getElementById('banner'),
      bannerTitle: document.getElementById('bannerTitle'),
      bannerSub: document.getElementById('bannerSub'),
      toast: document.getElementById('toast'),
      bossBar: document.getElementById('bossBar'),
      bossFill: document.getElementById('bossFill'),
      title: document.getElementById('titleScreen'),
      over: document.getElementById('overScreen'),
      overTitle: document.getElementById('overTitle'),
      overStats: document.getElementById('overStats'),
      pause: document.getElementById('pauseScreen'),
      seed: document.getElementById('seedInput'),
      best: document.getElementById('bestScore'),
      hud: document.getElementById('hud'),
    };

    this.renderer = new Renderer(this.el.canvas);
    this.map = new AutoMap(this.el.map);
    this.audio = new AudioEngine();

    this.state = 'title';
    this.keys = new Set();
    this.firing = false;
    this.blasting = false;
    this.pointerLocked = false;
    this.sensitivity = 0.0019;
    this.invertY = false;
    this.lastFrame = performance.now();
    this.accumulator = 0;
    this.stepSeconds = 1 / 120;
    this.toasts = [];

    this.bindInput();
    window.addEventListener('resize', () => this.renderer.resize());
    this.showBest();
    requestAnimationFrame((t) => this.frame(t));
  }

  /* ------------------------------- setup ------------------------------- */

  showBest() {
    let best = 0;
    try { best = Number(localStorage.getItem('nexusDepthsBest')) || 0; } catch { best = 0; }
    this.best = best;
    if (this.el.best) this.el.best.textContent = best ? best.toLocaleString() : '—';
  }

  recordBest() {
    if (this.score <= this.best) return;
    this.best = this.score;
    try { localStorage.setItem('nexusDepthsBest', String(this.score)); } catch { /* private mode */ }
    if (this.el.best) this.el.best.textContent = this.best.toLocaleString();
  }

  startRun(seed) {
    this.seed = seed;
    this.dungeon = generateDungeon(seed);
    this.compiled = compileDungeon(this.dungeon);
    this.physics = new DungeonPhysics(this.dungeon, this.compiled);
    this.renderer.setDungeon(this.dungeon, this.compiled);
    this.map.reset(this.dungeon);
    this.swarm = new Swarm(this.dungeon, this.physics, new RNG(seed ^ 0x5f3759df)).populate();

    const startRoom = this.dungeon.roomsById.get(this.dungeon.start);
    const plan = this.dungeon.floors[startRoom.floor];
    const spawn = plan.worldOf(startRoom.cx, startRoom.cz);
    this.player = {
      x: spawn[0],
      z: spawn[2],
      y: this.physics.canOccupy(spawn[0], spawn[2], spawn[1]) ?? plan.elevation,
      yaw: 0,
      pitch: 0,
      eye: PLAYER.eye,
      hp: PLAYER.maxHp,
      energy: PLAYER.maxEnergy,
      invuln: 0,
      regenHold: 0,
    };

    this.held = new Set();
    this.score = 0;
    this.combo = 0;
    this.comboTimer = 0;
    this.kills = 0;
    this.runTime = 0;
    this.deepest = 0;
    this.visited = new Set([startRoom.floor]);
    this.shake = 0;
    this.damageFlash = 0;
    this.hitmarkTimer = 0;
    this.pulseCooldown = 0;
    this.blastCooldown = 0;
    this.bossAwake = false;
    this.bossDead = false;
    for (const door of this.compiled.doors) door.open = false;
    for (const prop of this.dungeon.props) prop.taken = false;

    this.refreshOverlay();
    this.audio.setDepth(0);
    this.audio.setBoss(false);
    this.state = 'playing';
    this.el.title.classList.add('hidden');
    this.el.over.classList.add('hidden');
    this.el.pause.classList.add('hidden');
    this.el.hud.classList.remove('hidden');
    this.banner(`DEPTH 1 — ${DEPTH_NAMES[0].toUpperCase()}`, 'Find the way down. Something is already awake.');
    this.el.canvas.requestPointerLock?.();
  }

  refreshOverlay() {
    const boxes = [];
    for (const door of this.compiled.doors) if (!door.open) boxes.push(door.box);
    this.renderer.setOverlay(boxes);
  }

  /* ------------------------------- input ------------------------------- */

  bindInput() {
    const start = () => {
      this.audio.unlock();
      const raw = Number(this.el.seed?.value);
      this.startRun(Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : Math.floor(Math.random() * 999999) + 1);
    };
    document.getElementById('startBtn').onclick = start;
    document.getElementById('randomBtn').onclick = () => {
      this.el.seed.value = String(Math.floor(Math.random() * 999999) + 1);
      start();
    };
    document.getElementById('retryBtn').onclick = () => this.startRun(this.seed);
    document.getElementById('newRunBtn').onclick = () => this.startRun(Math.floor(Math.random() * 999999) + 1);
    document.getElementById('resumeBtn').onclick = () => this.setPaused(false);
    document.getElementById('quitBtn').onclick = () => this.toTitle();
    const mute = document.getElementById('muteBtn');
    mute.onclick = () => {
      this.muted = !this.muted;
      this.audio.setMuted(this.muted);
      mute.textContent = this.muted ? 'Sound: off' : 'Sound: on';
    };

    this.el.canvas.addEventListener('mousedown', (e) => {
      if (this.state !== 'playing') return;
      if (document.pointerLockElement !== this.el.canvas) {
        this.el.canvas.requestPointerLock?.();
        return;
      }
      if (e.button === 0) this.firing = true;
      if (e.button === 2) { this.blasting = true; e.preventDefault(); }
    });
    this.el.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.firing = false;
      if (e.button === 2) this.blasting = false;
    });

    document.addEventListener('pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement === this.el.canvas;
      if (!this.pointerLocked) {
        this.keys.clear();
        this.firing = false;
        this.blasting = false;
        if (this.state === 'playing') this.setPaused(true);
      }
    });

    window.addEventListener('mousemove', (e) => {
      if (this.state !== 'playing' || !this.pointerLocked) return;
      this.player.yaw += e.movementX * this.sensitivity;
      if (this.player.yaw > Math.PI) this.player.yaw -= Math.PI * 2;
      else if (this.player.yaw < -Math.PI) this.player.yaw += Math.PI * 2;
      const sign = this.invertY ? 1 : -1;
      this.player.pitch = Math.max(-1.25, Math.min(1.25, this.player.pitch + e.movementY * this.sensitivity * 0.9 * sign));
    });

    window.addEventListener('keydown', (e) => {
      if (['INPUT', 'TEXTAREA'].includes(e.target?.tagName) && !this.pointerLocked) return;
      if (e.code === 'Escape') { if (this.state === 'playing') this.setPaused(true); return; }
      if (e.code === 'KeyR' && (this.state === 'dead' || this.state === 'victory')) { this.startRun(this.seed); return; }
      if (e.code === 'Enter' && this.state === 'title') { document.getElementById('startBtn').click(); return; }
      if (MOVE_CODES.has(e.code)) { this.keys.add(e.code); if (this.state === 'playing') e.preventDefault(); }
      if (e.code === 'Space' && this.state === 'playing') { this.blasting = true; e.preventDefault(); }
    }, { passive: false });

    window.addEventListener('keyup', (e) => {
      if (MOVE_CODES.has(e.code)) this.keys.delete(e.code);
      if (e.code === 'Space') this.blasting = false;
    });

    window.addEventListener('blur', () => { this.keys.clear(); this.firing = false; this.blasting = false; });
  }

  setPaused(on) {
    if (on && this.state === 'playing') {
      this.state = 'paused';
      this.el.pause.classList.remove('hidden');
      document.exitPointerLock?.();
      this.audio.setIntensity(0);
    } else if (!on && this.state === 'paused') {
      this.state = 'playing';
      this.el.pause.classList.add('hidden');
      this.el.canvas.requestPointerLock?.();
    }
  }

  toTitle() {
    this.state = 'title';
    this.el.pause.classList.add('hidden');
    this.el.over.classList.add('hidden');
    this.el.title.classList.remove('hidden');
    this.el.hud.classList.add('hidden');
    document.exitPointerLock?.();
    this.audio.setIntensity(0);
    this.audio.setBoss(false);
  }

  /* ------------------------------ feedback ----------------------------- */

  banner(title, sub) {
    this.el.bannerTitle.textContent = title;
    this.el.bannerSub.textContent = sub || '';
    this.el.banner.classList.remove('show');
    // Restart the CSS animation.
    void this.el.banner.offsetWidth;
    this.el.banner.classList.add('show');
  }

  toast(text, tone = '') {
    const node = document.createElement('div');
    node.className = `toastLine ${tone}`;
    node.textContent = text;
    this.el.toast.appendChild(node);
    setTimeout(() => node.remove(), 1500);
  }

  /* ------------------------------- combat ------------------------------ */

  viewDirection() {
    const cp = Math.cos(this.player.pitch);
    return [Math.sin(this.player.yaw) * cp, Math.sin(this.player.pitch), -Math.cos(this.player.yaw) * cp];
  }

  eyePoint() {
    return [this.player.x, this.player.y + this.player.eye, this.player.z];
  }

  firePulse() {
    if (this.pulseCooldown > 0 || this.player.energy < PULSE.cost) {
      if (this.player.energy < PULSE.cost) this.hint('Out of charge');
      return;
    }
    this.player.energy -= PULSE.cost;
    this.player.regenHold = PLAYER.regenDelay;
    this.pulseCooldown = PULSE.cooldown;
    this.shake = Math.max(this.shake, 0.035);
    this.audio.play('shoot');

    const origin = this.eyePoint();
    const dir = this.viewDirection();
    const hit = this.swarm.raycast(origin, dir, PULSE.range);
    const end = hit
      ? [origin[0] + dir[0] * hit.distance, origin[1] + dir[1] * hit.distance, origin[2] + dir[2] * hit.distance]
      : [origin[0] + dir[0] * PULSE.range, origin[1] + dir[1] * PULSE.range, origin[2] + dir[2] * PULSE.range];

    this.recoil = Math.min(1, (this.recoil || 0) + 0.55);
    this.muzzleWeapon = 0.05;
    this.muzzle = { pos: [origin[0] + dir[0] * 0.6, origin[1] + dir[1] * 0.6, origin[2] + dir[2] * 0.6], life: 0.06 };

    if (hit && this.physics.rayClear(origin, end)) {
      this.swarm.hurt(hit.enemy, PULSE.damage, [dir[0], dir[2]], (e) => this.onKill(e));
      this.swarm.burst(end[0], end[1], end[2], [1, 0.85, 0.5], 4);
      this.hitmarkTimer = 0.12;
      this.audio.play('hitEnemy');
    } else {
      // Trace to the wall so the shot visibly lands somewhere.
      let stop = end;
      for (let t = 0.5; t <= PULSE.range; t += 0.5) {
        const point = [origin[0] + dir[0] * t, origin[1] + dir[1] * t, origin[2] + dir[2] * t];
        if (!this.physics.rayClear(origin, point)) { stop = point; break; }
      }
      this.swarm.burst(stop[0], stop[1], stop[2], [0.75, 0.8, 0.9], 3);
      this.audio.play('hitWall');
    }
  }

  fireBlast() {
    if (this.blastCooldown > 0) return;
    if (this.player.energy < BLAST.cost) { this.hint('Not enough charge for a blast'); return; }
    this.player.energy -= BLAST.cost;
    this.player.regenHold = PLAYER.regenDelay * 2;
    this.blastCooldown = BLAST.cooldown;
    this.shake = Math.max(this.shake, 0.11);
    this.audio.play('blast');

    const origin = this.eyePoint();
    const dir = this.viewDirection();
    const hit = this.swarm.raycast(origin, dir, BLAST.range);
    let centre = [origin[0] + dir[0] * BLAST.range, origin[1] + dir[1] * BLAST.range, origin[2] + dir[2] * BLAST.range];
    if (hit && this.physics.rayClear(origin, [hit.enemy.x, hit.enemy.y + 0.8, hit.enemy.z])) {
      centre = [hit.enemy.x, hit.enemy.y + hit.enemy.type.height * 0.5, hit.enemy.z];
      this.swarm.hurt(hit.enemy, BLAST.damage, [dir[0], dir[2]], (e) => this.onKill(e));
      this.hitmarkTimer = 0.16;
    } else {
      for (let t = 1; t <= BLAST.range; t += 0.5) {
        const point = [origin[0] + dir[0] * t, origin[1] + dir[1] * t, origin[2] + dir[2] * t];
        if (!this.physics.rayClear(origin, point)) { centre = point; break; }
      }
    }
    // Splash: everything close to the impact takes a share and gets shoved.
    for (const enemy of [...this.swarm.enemies]) {
      if (enemy.hp <= 0) continue;
      const d = Math.hypot(enemy.x - centre[0], enemy.z - centre[2], (enemy.y + 0.8) - centre[1]);
      if (d > BLAST.radius) continue;
      const falloff = 1 - d / BLAST.radius;
      const push = [enemy.x - centre[0], enemy.z - centre[2]];
      const len = Math.hypot(push[0], push[1]) || 1;
      this.swarm.hurt(enemy, BLAST.splash * falloff, [push[0] / len, push[1] / len], (e) => this.onKill(e));
    }
    this.swarm.burst(centre[0], centre[1], centre[2], [1, 0.7, 0.35], 26);
    this.recoil = 1;
    this.muzzle = { pos: centre, life: 0.16, big: true };
    this.muzzleWeapon = 0.1;
  }

  /**
   * The weapon in your hands. Drawn as world-space boxes pinned to the camera,
   * with sway and recoil - it is most of what makes shooting feel like shooting.
   */
  viewModelBoxes() {
    const yaw = this.player.yaw;
    const pitch = this.player.pitch;
    const cp = Math.cos(pitch);
    const forward = [Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp];
    const right = [Math.cos(yaw), 0, Math.sin(yaw)];
    const up = [
      right[1] * forward[2] - right[2] * forward[1],
      right[2] * forward[0] - right[0] * forward[2],
      right[0] * forward[1] - right[1] * forward[0],
    ];
    const basis = [right, up, forward];
    const eye = this.eyePoint();
    const recoil = this.recoil || 0;
    const bob = this.walkBob || 0;
    const sway = Math.sin(bob) * 0.008;
    const heave = Math.abs(Math.cos(bob)) * 0.007;

    const at = (f, r, u) => [
      eye[0] + forward[0] * f + right[0] * r + up[0] * u,
      eye[1] + forward[1] * f + right[1] * r + up[1] * u,
      eye[2] + forward[2] * f + right[2] * r + up[2] * u,
    ];
    /** Half-extents are given in weapon space: (right, up, forward). */
    const part = (f, r, u, hr, hu, hf, colour, emissive) => {
      const p = at(f, r, u);
      const box = new Box(p[0], p[1], p[2], hr, hu, hf, colour, 'weapon', emissive || 0);
      box.basis = basis;
      return box;
    };

    const depth = 0.60 - recoil * 0.06;
    const side = 0.155 + sway;
    const drop = -0.150 - heave + recoil * 0.022;
    const boxes = [];

    // Receiver, barrel, sight and grip. Long and thin reads as a weapon; a
    // chunky box reads as a crate you are carrying.
    boxes.push(part(depth, side, drop, 0.016, 0.019, 0.080, [0.27, 0.30, 0.35], 0.04));
    boxes.push(part(depth + 0.105, side, drop + 0.004, 0.008, 0.008, 0.055, [0.15, 0.17, 0.20], 0.02));
    boxes.push(part(depth + 0.02, side, drop + 0.026, 0.005, 0.010, 0.012, [0.20, 0.22, 0.26], 0));
    boxes.push(part(depth - 0.055, side, drop - 0.042, 0.011, 0.030, 0.014, [0.20, 0.16, 0.13], 0));
    // The charge cell runs along the receiver, so ammo is readable in the corner
    // of your eye without looking at the bar.
    const level = this.player.energy / PLAYER.maxEnergy;
    boxes.push(part(depth - 0.012, side - 0.017, drop + 0.006, 0.004, 0.008, 0.052 * Math.max(0.1, level),
      level > 0.25 ? [0.35, 0.85, 1.0] : [1.0, 0.4, 0.35], 1.0));
    if ((this.muzzleWeapon || 0) > 0) {
      const size = 0.026 + (this.muzzle && this.muzzle.big ? 0.026 : 0);
      boxes.push(part(depth + 0.18, side, drop + 0.004, size, size, size * 1.6, [1, 0.88, 0.6], 1.0));
    }
    return boxes;
  }

  onKill(enemy) {
    this.kills += 1;
    this.combo += 1;
    this.comboTimer = COMBO_WINDOW;
    const multiplier = this.comboMultiplier();
    const gained = Math.round(enemy.type.score * multiplier);
    this.score += gained;
    this.audio.play('enemyDie');
    this.toast(`${enemy.type.name} +${gained}${multiplier > 1 ? ` ×${multiplier}` : ''}`, multiplier > 2 ? 'hot' : '');
    this.shake = Math.max(this.shake, enemy.type.boss ? 0.4 : 0.05);
    if (enemy.type.boss) this.onVictory();
  }

  comboMultiplier() {
    return Math.min(5, 1 + Math.floor(this.combo / 3));
  }

  hint(text) {
    if (this.hintTimer > 0) return;
    this.hintTimer = 1.2;
    this.toast(text, 'warn');
  }

  hurtPlayer(amount) {
    if (this.player.invuln > 0 || this.state !== 'playing') return;
    this.player.hp -= amount;
    this.player.invuln = PLAYER.invulnAfterHit;
    this.damageFlash = 1;
    this.shake = Math.max(this.shake, 0.16);
    this.combo = 0;
    this.comboTimer = 0;
    this.audio.play('playerHurt');
    if (this.player.hp <= 0) {
      this.player.hp = 0;
      this.onDeath();
    }
  }

  onDeath() {
    this.state = 'dead';
    this.audio.play('death');
    this.audio.setIntensity(0);
    this.audio.setBoss(false);
    this.recordBest();
    document.exitPointerLock?.();
    this.el.overTitle.textContent = 'YOU DIED';
    this.el.overTitle.className = 'overTitle bad';
    this.el.overStats.innerHTML = this.runSummary();
    this.el.over.classList.remove('hidden');
  }

  onVictory() {
    if (this.state === 'victory') return;
    this.bossDead = true;
    this.state = 'victory';
    this.score += 5000 + Math.max(0, 4000 - Math.round(this.runTime * 10));
    this.audio.play('victory');
    this.audio.setIntensity(0);
    this.audio.setBoss(false);
    this.recordBest();
    document.exitPointerLock?.();
    this.el.bossBar.classList.add('hidden');
    this.el.overTitle.textContent = 'THE WARDEN FALLS';
    this.el.overTitle.className = 'overTitle good';
    this.el.overStats.innerHTML = this.runSummary();
    this.el.over.classList.remove('hidden');
  }

  runSummary() {
    const minutes = Math.floor(this.runTime / 60);
    const seconds = Math.floor(this.runTime % 60).toString().padStart(2, '0');
    return `
      <div class="statRow"><span>Score</span><b>${this.score.toLocaleString()}</b></div>
      <div class="statRow"><span>Kills</span><b>${this.kills}</b></div>
      <div class="statRow"><span>Deepest</span><b>Depth ${this.deepest + 1}</b></div>
      <div class="statRow"><span>Time</span><b>${minutes}:${seconds}</b></div>
      <div class="statRow"><span>Seed</span><b>${this.seed}</b></div>
      <div class="statRow best"><span>Best</span><b>${Math.max(this.best, this.score).toLocaleString()}</b></div>`;
  }

  /* ------------------------------- update ------------------------------ */

  updateMovement(dt) {
    let forward = 0;
    let strafe = 0;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) forward += 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) forward -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) strafe += 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) strafe -= 1;
    if (!forward && !strafe) { this.walkBob = (this.walkBob || 0) * 0.94; return; }
    const norm = Math.hypot(forward, strafe) || 1;
    forward /= norm;
    strafe /= norm;
    const fx = Math.sin(this.player.yaw);
    const fz = -Math.cos(this.player.yaw);
    const rx = Math.cos(this.player.yaw);
    const rz = Math.sin(this.player.yaw);
    const running = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
    const speed = running ? PLAYER.runSpeed : PLAYER.walkSpeed;
    this.walkBob = (this.walkBob || 0) + dt * (running ? 13 : 8.5);
    this.physics.move(
      this.player,
      (fx * forward + rx * strafe) * speed * dt,
      (fz * forward + rz * strafe) * speed * dt,
    );
  }

  updateInteractions(floorIndex) {
    let changed = false;
    for (const prop of this.dungeon.props) {
      if (prop.kind !== 'key' || prop.taken || prop.floor !== floorIndex) continue;
      if (Math.hypot(prop.x - this.player.x, prop.z - this.player.z) > 1.2) continue;
      prop.taken = true;
      this.held.add(prop.lockId);
      const lock = this.dungeon.locks.find((l) => l.id === prop.lockId);
      this.audio.play('key');
      this.toast(`${lock ? lock.name : 'A'} key acquired`, 'good');
      changed = true;
    }
    for (const door of this.compiled.doors) {
      if (door.open || !this.held.has(door.lock.id)) continue;
      door.open = true;
      this.audio.play('door');
      this.toast(`${door.lock.name} door opens`, 'good');
      changed = true;
    }
    if (changed) this.refreshOverlay();
  }

  updateDepth(floorIndex) {
    if (this.visited.has(floorIndex)) return;
    this.visited.add(floorIndex);
    this.deepest = Math.max(this.deepest, floorIndex);
    this.audio.setDepth(floorIndex);
    this.audio.play('descend');
    const heal = 25;
    this.player.hp = Math.min(PLAYER.maxHp, this.player.hp + heal);
    this.player.energy = PLAYER.maxEnergy;
    this.score += 750;
    const name = DEPTH_NAMES[floorIndex] || `Depth ${floorIndex + 1}`;
    const last = floorIndex === this.dungeon.floorCount - 1;
    this.banner(
      `DEPTH ${floorIndex + 1} — ${name.toUpperCase()}`,
      last ? 'The Warden is here. Kill it.' : 'Deeper. Louder. Keep moving.',
    );
  }

  /** A chevron pointing at the nearest way down, so nobody wanders lost. */
  updateCompass(floorIndex) {
    const plan = this.dungeon.floors[floorIndex];
    let target = null;
    if (!this.bossAwake) {
      for (const stair of this.dungeon.stairs) {
        if (stair.upperFloor !== floorIndex) continue;
        const world = plan.worldOf(stair.exit[0], stair.exit[1]);
        const d = Math.hypot(world[0] - this.player.x, world[2] - this.player.z);
        if (!target || d < target.d) target = { d, x: world[0], z: world[2], label: 'DOWN' };
      }
    }
    const goal = this.dungeon.roomsById.get(this.dungeon.goal);
    if (!target && goal && goal.floor === floorIndex) {
      const world = this.dungeon.floors[goal.floor].worldOf(goal.cx, goal.cz);
      target = { d: Math.hypot(world[0] - this.player.x, world[2] - this.player.z), x: world[0], z: world[2], label: 'WARDEN' };
    }
    if (!target) { this.el.compass.style.opacity = '0'; return; }
    const angle = Math.atan2(target.x - this.player.x, -(target.z - this.player.z));
    let delta = angle - this.player.yaw;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    const clamped = Math.max(-1, Math.min(1, delta / (Math.PI * 0.55)));
    this.el.compass.style.opacity = '1';
    this.el.compass.style.transform = `translateX(${clamped * 46}%)`;
    this.el.compass.textContent = `▲ ${target.label} ${Math.round(target.d)}m`;
    this.el.compass.classList.toggle('behind', Math.abs(delta) > Math.PI * 0.55);
  }

  checkBoss(floorIndex) {
    const boss = this.swarm.boss;
    if (!boss || this.bossDead) return;
    if (boss.hp <= 0) { this.el.bossBar.classList.add('hidden'); return; }
    const goal = this.dungeon.roomsById.get(this.dungeon.goal);
    if (!this.bossAwake) {
      if (floorIndex !== boss.floor) return;
      const d = Math.hypot(boss.x - this.player.x, boss.z - this.player.z);
      const inRoom = goal && this.dungeon.floors[floorIndex]
        .ownerAt(Math.floor(this.player.x / TILE_SIZE), Math.floor(this.player.z / TILE_SIZE)) === goal.id;
      if (d > 17 && !inRoom) return;
      this.bossAwake = true;
      boss.dormant = false;
      boss.aggro = true;
      boss.state = 'chase';
      this.audio.play('bossRoar');
      this.audio.setBoss(true);
      this.banner('THE WARDEN', 'It has been waiting for you.');
      this.el.bossBar.classList.remove('hidden');
    }
    this.el.bossFill.style.width = `${Math.max(0, (boss.hp / boss.maxHp) * 100)}%`;
  }

  updateHud(floorIndex) {
    const hpPct = (this.player.hp / PLAYER.maxHp) * 100;
    this.el.hp.style.width = `${Math.max(0, hpPct)}%`;
    this.el.hp.classList.toggle('critical', hpPct < 30);
    this.el.hpText.textContent = `${Math.ceil(Math.max(0, this.player.hp))}`;
    this.el.energy.style.width = `${(this.player.energy / PLAYER.maxEnergy) * 100}%`;
    this.el.energyText.textContent = `${Math.floor(this.player.energy)}`;
    this.el.score.textContent = this.score.toLocaleString();
    this.el.depth.textContent = `${floorIndex + 1}/${this.dungeon.floorCount}`;

    const multiplier = this.comboMultiplier();
    if (this.combo > 0 && this.comboTimer > 0) {
      this.el.combo.textContent = `×${multiplier}  (${this.combo} chain)`;
      this.el.combo.classList.add('active');
      this.el.comboBar.style.width = `${(this.comboTimer / COMBO_WINDOW) * 100}%`;
    } else {
      this.el.combo.textContent = '';
      this.el.combo.classList.remove('active');
      this.el.comboBar.style.width = '0%';
    }

    const owed = this.dungeon.locks.filter((l) => !this.held.has(l.id));
    this.el.keys.innerHTML = this.dungeon.locks
      .map((l) => `<span class="keyPip ${this.held.has(l.id) ? 'have' : ''}" style="--c:rgb(${l.color.map((v) => Math.round(v * 255)).join(',')})">${l.name}</span>`)
      .join('');

    const remaining = this.swarm.aliveOnFloor(floorIndex);
    if (this.bossAwake && !this.bossDead) this.el.objective.textContent = 'Destroy the Warden';
    else if (owed.length) this.el.objective.textContent = `Find the ${owed[0].name} key · ${remaining} hostiles on this depth`;
    else this.el.objective.textContent = `Descend · ${remaining} hostiles on this depth`;

    this.el.damage.style.opacity = String(this.damageFlash * 0.55);
    const low = this.player.hp / PLAYER.maxHp < 0.3 && this.state === 'playing';
    this.el.lowHp.classList.toggle('show', low);
    this.el.hitmark.style.opacity = this.hitmarkTimer > 0 ? '1' : '0';
  }

  step(dt, floorIndex) {
    this.runTime += dt;
    this.pulseCooldown = Math.max(0, this.pulseCooldown - dt);
    this.blastCooldown = Math.max(0, this.blastCooldown - dt);
    this.hintTimer = Math.max(0, (this.hintTimer || 0) - dt);
    this.player.invuln = Math.max(0, this.player.invuln - dt);
    this.player.regenHold = Math.max(0, this.player.regenHold - dt);
    this.damageFlash = Math.max(0, this.damageFlash - dt * 2.4);
    this.hitmarkTimer = Math.max(0, this.hitmarkTimer - dt);
    this.shake = Math.max(0, this.shake - dt * 0.6);
    this.recoil = Math.max(0, (this.recoil || 0) - dt * 5.5);
    this.muzzleWeapon = Math.max(0, (this.muzzleWeapon || 0) - dt);
    if (this.comboTimer > 0) {
      this.comboTimer -= dt;
      if (this.comboTimer <= 0) this.combo = 0;
    }
    if (this.player.regenHold <= 0 && this.player.energy < PLAYER.maxEnergy) {
      this.player.energy = Math.min(PLAYER.maxEnergy, this.player.energy + PLAYER.energyRegen * dt);
    }
    this.updateMovement(dt);
    if (this.firing) this.firePulse();
    if (this.blasting) { this.fireBlast(); this.blasting = false; }
    void floorIndex;
  }

  frame(now) {
    const raw = Math.min(0.1, Math.max(0, (now - this.lastFrame) / 1000));
    this.lastFrame = now;
    this.audio.update(raw);

    if (this.state === 'playing') {
      const floorIndex = this.physics.floorAt(this.player.y);
      this.accumulator = Math.min(0.25, this.accumulator + raw);
      let steps = 0;
      while (this.accumulator >= this.stepSeconds && steps < 40) {
        this.step(this.stepSeconds, floorIndex);
        this.accumulator -= this.stepSeconds;
        steps += 1;
      }
      if (steps >= 40) this.accumulator = 0;

      this.swarm.update(raw, this.player, {
        onPlayerHit: (amount) => this.hurtPlayer(amount),
        onWindup: () => this.audio.play('windup'),
        onEnemyShoot: () => this.audio.play('shoot'),
        onNotice: () => this.audio.play('notice'),
        onBossWake: () => {},
        onProjectileWall: () => {},
        onPickup: (item) => {
          if (item.kind === 'health') {
            if (this.player.hp >= PLAYER.maxHp) return false;
            this.player.hp = Math.min(PLAYER.maxHp, this.player.hp + item.amount);
          } else {
            if (this.player.energy >= PLAYER.maxEnergy) return false;
            this.player.energy = Math.min(PLAYER.maxEnergy, this.player.energy + item.amount);
          }
          this.audio.play('pickup');
          return true;
        },
      });

      this.updateInteractions(floorIndex);
      this.updateDepth(floorIndex);
      this.checkBoss(floorIndex);
      this.updateCompass(floorIndex);
      this.updateHud(floorIndex);
      this.map.observe(floorIndex, this.player.x, this.player.z);

      // Music tracks how much trouble the player is in.
      const pressure = Math.min(1, this.swarm.aggroCount / 5) * 0.7
        + (1 - this.player.hp / PLAYER.maxHp) * 0.3;
      this.audio.setIntensity(this.bossAwake ? Math.max(0.75, pressure) : pressure);
    }

    if (this.dungeon) {
      const floorIndex = this.physics.floorAt(this.player.y);
      const dynamic = this.swarm.boxes(now / 1000);
      if (this.state === 'playing') dynamic.push(...this.viewModelBoxes());
      if (this.muzzle) {
        this.muzzle.life -= raw;
        if (this.muzzle.life <= 0) this.muzzle = null;
      }
      this.renderer.shake = this.shake;
      this.renderer.setDynamic(dynamic);
      const lights = this.swarm.lights();
      if (this.muzzle) {
        lights.push({ pos: this.muzzle.pos, colour: [1, 0.85, 0.55], intensity: this.muzzle.big ? 4 : 2 });
      }
      this.renderer.setTransientLights(lights);
      this.renderer.render(this.player, raw);
      this.map.draw(this.dungeon, this.player, floorIndex, { doors: this.compiled.doors });
    }

    requestAnimationFrame((t) => this.frame(t));
  }
}

export { PLAYER, PULSE, BLAST, ROOM_TYPE, Box };
