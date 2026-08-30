/**
 * Nexus Depths - the game.
 *
 * A bullet heaven in first person. Your weapons fire themselves; your job is
 * where you stand and where you look. Every kill drops essence, essence fills a
 * bar, and every level hands you three procedurally generated capabilities to
 * choose between - so the run is a build you assemble under pressure, and no two
 * runs hand you the same one.
 *
 * The loop is deliberately short: kill the depth's quota to crack open the way
 * down, then decide whether to leave or keep farming while the spawn rate keeps
 * climbing. Descending is safety; staying is power. That choice, every ninety
 * seconds, is the whole game.
 */

import { generateDungeon } from './generator.js';
import { compileDungeon, Box } from './compiler.js';
import { DungeonPhysics } from './physics.js';
import { Renderer } from './renderer.js';
import { AutoMap } from './minimap.js';
import { Hud } from './hud.js';
import { Swarm } from './entities.js';
import { AudioEngine } from './audio.js';
import { buildSpriteAtlas } from './sprites.js';
import { Loadout, generateWeapon, recomputeWeapon } from './loadout.js';
import { RNG } from './rng.js';
import { TILE_SIZE } from './grid.js';
import { rgb } from './palette.js';

const MOVE_CODES = new Set([
  'KeyW', 'KeyA', 'KeyS', 'KeyD',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'ShiftLeft', 'ShiftRight',
]);

const PLAYER = {
  maxHull: 130,
  maxCharge: 100,
  chargeRegen: 19,
  // You move at a shooter's pace, not a walking-simulator's. The earlier 3.9
  // was slower than a crawler's 4.35, which meant Shift was not a sprint but a
  // requirement - the game was unplayable without holding it, and holding a key
  // to move at a normal speed is the definition of sluggish. Base speed now
  // outruns the horde in open ground, and the threat is being surrounded rather
  // than being outpaced, which is what a bullet heaven is actually about.
  walkSpeed: 5.7,
  runSpeed: 8.4,
  eye: 1.62,
  invulnAfterHit: 0.42,
};

/** Look feel. Persisted, because a fixed sensitivity fits nobody's mouse. */
const LOOK = {
  defaultSensitivity: 0.0032,
  minSensitivity: 0.0006,
  maxSensitivity: 0.010,
  // Just short of straight up and straight down, as every modern shooter does.
  pitchLimit: (89 * Math.PI) / 180,
  // Vertical FOV in degrees. 74 vertical is about 107 horizontal at 16:9.
  defaultFov: 74,
  minFov: 55,
  maxFov: 100,
};

const SURGE = { cost: 26, cooldown: 0.55 };
const BLAST = { cost: 38, damage: 60, radius: 4.2, cooldown: 0.8 };

const DEPTH_NAMES = ['Flooded Undercroft', 'Bone Galleries', 'Verdigris Works', 'Emberforge'];

/** Essence needed for the next level. Early ones land fast on purpose. */
function xpForLevel(level) {
  // The first few still land quickly, because a build needs to get going, but
  // the curve climbs much faster after that. The old one was near-linear in
  // practice against a kill rate that grows all run, which is how a four-minute
  // run produced thirty levels - an upgrade every eight seconds.
  return Math.round(14 + Math.pow(level, 1.95) * 6.5);
}

export class Game {
  constructor() {
    this.el = {
      canvas: document.getElementById('gl'),
      hudCanvas: document.getElementById('hudCanvas'),
      map: document.getElementById('map'),
      mapwrap: document.getElementById('mapwrap'),
      damage: document.getElementById('damageFlash'),
      lowHp: document.getElementById('lowHp'),
      title: document.getElementById('titleScreen'),
      over: document.getElementById('overScreen'),
      overTitle: document.getElementById('overTitle'),
      overStats: document.getElementById('overStats'),
      pause: document.getElementById('pauseScreen'),
      seed: document.getElementById('seedInput'),
      best: document.getElementById('bestScore'),
    };

    this.renderer = new Renderer(this.el.canvas);
    const atlas = buildSpriteAtlas();
    this.renderer.setSpriteAtlas(atlas.canvas);
    this.spriteFrames = atlas.frames;
    this.map = new AutoMap(this.el.map);
    this.hud = new Hud(this.el.hudCanvas);
    this.audio = new AudioEngine();

    this.state = 'title';
    this.keys = new Set();
    this.surging = false;
    this.blasting = false;
    this.pointerLocked = false;
    this.sensitivity = this.loadSetting('nexusDepthsSens', LOOK.defaultSensitivity,
      LOOK.minSensitivity, LOOK.maxSensitivity);
    this.invertY = this.loadSetting('nexusDepthsInvertY', 0, 0, 1) === 1;
    // 'auto' keeps the bullet-heaven feel; 'manual' makes it a shooter you
    // drive. The mode changes what the left button does, so it is bound once
    // here and read everywhere rather than branched at each call site.
    let mode = 'auto';
    try { mode = localStorage.getItem('nexusDepthsFireMode') || 'auto'; } catch { mode = 'auto'; }
    this.fireMode = mode === 'manual' ? 'manual' : 'auto';
    this.firing = false;
    this.hasTarget = false;
    this.fov = this.loadSetting('nexusDepthsFov', LOOK.defaultFov, LOOK.minFov, LOOK.maxFov);
    this.renderer.fov = (this.fov * Math.PI) / 180;
    // Hold-to-sprint is the default; toggle suits players who would rather not
    // hold a key for the entire run.
    let sprint = 'hold';
    try { sprint = localStorage.getItem('nexusDepthsSprint') || 'hold'; } catch { sprint = 'hold'; }
    this.sprintMode = sprint === 'toggle' ? 'toggle' : 'hold';
    this.sprintLatched = false;
    this.lastFrame = performance.now();
    this.accumulator = 0;
    this.stepSeconds = 1 / 120;

    this.bindInput();
    window.addEventListener('resize', () => this.syncResolution());
    this.syncResolution();
    this.showBest();
    requestAnimationFrame((t) => this.frame(t));
  }

  /* ------------------------------- setup ------------------------------- */

  /** Read a persisted setting, clamped, tolerating private-mode storage errors. */
  loadSetting(key, fallback, min, max) {
    let raw = NaN;
    try { raw = Number(localStorage.getItem(key)); } catch { raw = NaN; }
    if (!Number.isFinite(raw) || raw === 0 && fallback !== 0) return fallback;
    return Math.max(min, Math.min(max, raw));
  }

  saveSetting(key, value) {
    try { localStorage.setItem(key, String(value)); } catch { /* private mode */ }
  }

  showBest() {
    let best = 0;
    try { best = Number(localStorage.getItem('nexusDepthsBest')) || 0; } catch { best = 0; }
    this.best = best;
    if (this.el.best) this.el.best.textContent = String(best).padStart(6, '0');
  }

  recordBest() {
    if (this.score <= this.best) return;
    this.best = this.score;
    try { localStorage.setItem('nexusDepthsBest', String(this.score)); } catch { /* private mode */ }
    if (this.el.best) this.el.best.textContent = String(this.best).padStart(6, '0');
  }

  startRun(seed) {
    this.seed = seed;
    this.rng = new RNG(seed ^ 0x9e3779b9);
    // No locks: the descent is gated on kills, not on searching. The generator
    // still supports them and the lab still exercises them.
    this.dungeon = generateDungeon(seed, { locks: 0 });
    this.compiled = compileDungeon(this.dungeon);
    this.physics = new DungeonPhysics(this.dungeon, this.compiled);
    this.renderer.setDungeon(this.dungeon, this.compiled);
    this.map.reset(this.dungeon);
    this.swarm = new Swarm(this.dungeon, this.physics, new RNG(seed ^ 0x5f3759df)).populate();
    this.swarm.setFrames(this.spriteFrames);

    this.loadout = new Loadout(this.rng);
    this.loadout.addWeapon(this.startingWeapon());

    const startRoom = this.dungeon.roomsById.get(this.dungeon.start);
    const plan = this.dungeon.floors[startRoom.floor];
    const spawn = plan.worldOf(startRoom.cx, startRoom.cz);
    this.player = {
      x: spawn[0], z: spawn[2],
      y: this.physics.canOccupy(spawn[0], spawn[2], spawn[1]) ?? plan.elevation,
      yaw: 0, pitch: 0, eye: PLAYER.eye,
      hull: PLAYER.maxHull, charge: PLAYER.maxCharge,
      invuln: 0, regenHold: 0,
    };

    this.score = 0;
    this.kills = 0;
    this.level = 1;
    this.xp = 0;
    this.xpNeeded = xpForLevel(1);
    this.runTime = 0;
    this.deepest = 0;
    this.visited = new Set([startRoom.floor]);
    this.floorTime = 0;
    this.shake = 0;
    this.damageFlash = 0;
    this.hitmarkTimer = 0;
    this.surgeCooldown = 0;
    this.blastCooldown = 0;
    this.bossAwake = false;
    this.bossDead = false;
    this.bossState = null;
    this.compass = null;
    this.pendingCards = null;
    this.banked = 0;
    this.orbits = [];
    this.muzzle = null;
    this.combo = 0;
    this.comboTimer = 0;
    this.bestCombo = 0;
    this.setQuota(startRoom.floor);

    this.renderer.setOverlay([]);
    this.audio.setDepth(0);
    this.audio.setBoss(false);
    this.state = 'playing';
    this.el.title.classList.add('hidden');
    this.el.over.classList.add('hidden');
    this.el.pause.classList.add('hidden');
    this.el.mapwrap.classList.remove('hidden');
    this.hud.clearMessages();
    this.banner(`DEPTH 1 - ${DEPTH_NAMES[0].toUpperCase()}`, 'THEY ARE ALREADY MOVING');
    this.el.canvas.requestPointerLock?.();
  }

  /** Everyone starts with a rolled weapon, so run one is already unique. */
  startingWeapon() {
    const weapon = generateWeapon(this.rng, 0);
    weapon.coreKey = this.rng.pick(['bolt', 'scatter', 'seeker']);
    weapon.rarity = { name: 'Common', tier: 0, mult: 1, weight: 1, colour: 'stone' };
    weapon.level = 1;
    recomputeWeapon(weapon);
    return weapon;
  }

  setQuota(depth) {
    const isBossFloor = depth === this.dungeon.floorCount - 1;
    this.quota = {
      need: isBossFloor ? 0 : 34 + depth * 22,
      done: 0,
      boss: isBossFloor,
    };
    this.riftOpen = isBossFloor;
    this.floorTime = 0;
  }

  syncResolution() {
    this.renderer.resize();
    this.hud.resize(this.renderer.canvas.width, this.renderer.canvas.height);
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
    // Look settings. The slider is in thousandths of a radian per pixel, which
    // is a number a person can reason about, and it applies live so you can
    // feel the change with the game still behind the pause panel.
    const sens = document.getElementById('sensInput');
    const sensValue = document.getElementById('sensValue');
    if (sens) {
      const sync = () => {
        sens.value = String(Math.round(this.sensitivity * 10000));
        if (sensValue) sensValue.textContent = sens.value;
      };
      sync();
      sens.addEventListener('input', () => {
        this.sensitivity = Math.max(LOOK.minSensitivity,
          Math.min(LOOK.maxSensitivity, Number(sens.value) / 10000));
        if (sensValue) sensValue.textContent = sens.value;
        this.saveSetting('nexusDepthsSens', this.sensitivity);
      });
    }
    const fov = document.getElementById('fovInput');
    const fovValue = document.getElementById('fovValue');
    if (fov) {
      fov.value = String(Math.round(this.fov));
      if (fovValue) fovValue.textContent = fov.value;
      fov.addEventListener('input', () => {
        this.fov = Math.max(LOOK.minFov, Math.min(LOOK.maxFov, Number(fov.value)));
        this.renderer.fov = (this.fov * Math.PI) / 180;
        if (fovValue) fovValue.textContent = String(Math.round(this.fov));
        this.saveSetting('nexusDepthsFov', this.fov);
      });
    }

    const sprintToggle = document.getElementById('sprintToggleInput');
    if (sprintToggle) {
      sprintToggle.checked = this.sprintMode === 'toggle';
      sprintToggle.addEventListener('change', () => {
        this.sprintMode = sprintToggle.checked ? 'toggle' : 'hold';
        this.sprintLatched = false;
        try { localStorage.setItem('nexusDepthsSprint', this.sprintMode); } catch { /* private mode */ }
      });
    }

    const auto = document.getElementById('autoFireInput');
    if (auto) {
      auto.checked = this.fireMode === 'auto';
      auto.addEventListener('change', () => {
        this.fireMode = auto.checked ? 'auto' : 'manual';
        this.firing = false;
        this.surging = false;
        try { localStorage.setItem('nexusDepthsFireMode', this.fireMode); } catch { /* private mode */ }
      });
    }

    const invert = document.getElementById('invertInput');
    if (invert) {
      invert.checked = this.invertY;
      invert.addEventListener('change', () => {
        this.invertY = invert.checked;
        this.saveSetting('nexusDepthsInvertY', this.invertY ? 1 : 0);
      });
    }

    const mute = document.getElementById('muteBtn');
    mute.onclick = () => {
      this.muted = !this.muted;
      this.audio.setMuted(this.muted);
      mute.textContent = this.muted ? 'SOUND OFF' : 'SOUND ON';
    };

    this.el.canvas.addEventListener('mousedown', (e) => {
      if (this.state === 'levelup') {
        // A short grace period, so a click already travelling when the cards
        // appeared cannot spend them.
        if (performance.now() - (this.cardsShownAt || 0) < 250) return;
        const index = this.cardAtPointer(e);
        if (index >= 0) this.chooseCard(index);
        return;
      }
      if (this.state !== 'playing') return;
      if (document.pointerLockElement !== this.el.canvas) { this.el.canvas.requestPointerLock?.(); return; }
      if (e.button === 0) {
        if (this.fireMode === 'manual') this.firing = true;
        else this.surging = true;
      }
      if (e.button === 2) { this.blasting = true; e.preventDefault(); }
    });
    this.el.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) { this.surging = false; this.firing = false; }
      if (e.button === 2) this.blasting = false;
    });

    document.addEventListener('pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement === this.el.canvas;
      if (!this.pointerLocked) {
        this.keys.clear();
        this.surging = false;
        this.firing = false;
        this.blasting = false;
        if (this.state === 'playing') this.setPaused(true);
      }
    });

    window.addEventListener('mousemove', (e) => {
      if (this.state === 'levelup') { this.hoverCard = this.cardAtPointer(e); return; }
      if (!this.player || !this.pointerLocked) return;
      if (this.state !== 'playing' && this.state !== 'levelup') return;
      // Raw deltas straight through: no smoothing and no acceleration, which is
      // what makes a shooter feel like it is tracking your hand. Vertical uses
      // the same sensitivity as horizontal so a 90-degree flick is the same
      // distance in both axes.
      this.player.yaw += e.movementX * this.sensitivity;
      if (this.player.yaw > Math.PI) this.player.yaw -= Math.PI * 2;
      else if (this.player.yaw < -Math.PI) this.player.yaw += Math.PI * 2;
      const dy = e.movementY * this.sensitivity * (this.invertY ? -1 : 1);
      this.player.pitch = Math.max(-LOOK.pitchLimit, Math.min(LOOK.pitchLimit, this.player.pitch - dy));
    });

    window.addEventListener('keydown', (e) => {
      if (['INPUT', 'TEXTAREA'].includes(e.target?.tagName) && !this.pointerLocked) return;
      if (this.state === 'levelup') {
        const index = ['Digit1', 'Digit2', 'Digit3'].indexOf(e.code);
        if (index >= 0) { this.chooseCard(index); e.preventDefault(); }
        return;
      }
      if (e.code === 'Tab') { this.openCards(); e.preventDefault(); return; }
      if (e.code === 'Escape') { if (this.state === 'playing') this.setPaused(true); return; }
      if (e.code === 'KeyR' && (this.state === 'dead' || this.state === 'victory')) { this.startRun(this.seed); return; }
      if (e.code === 'Enter' && this.state === 'title') { document.getElementById('startBtn').click(); return; }
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
        // In toggle mode a tap flips sprint rather than needing to be held.
        if (this.sprintMode === 'toggle' && !this.keys.has(e.code)) this.sprintLatched = !this.sprintLatched;
      }
      if (MOVE_CODES.has(e.code)) { this.keys.add(e.code); if (this.state === 'playing') e.preventDefault(); }
      if (e.code === 'Space' && this.state === 'playing') { this.blasting = true; e.preventDefault(); }
    }, { passive: false });

    window.addEventListener('keyup', (e) => {
      if (MOVE_CODES.has(e.code)) this.keys.delete(e.code);
      if (e.code === 'Space') this.blasting = false;
    });

    window.addEventListener('blur', () => {
      this.keys.clear();
      this.surging = false;
      this.firing = false;
      this.blasting = false;
    });
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
    this.el.mapwrap.classList.add('hidden');
    this.hud.clearMessages();
    this.hud.draw(null, 0);
    document.exitPointerLock?.();
    this.audio.setIntensity(0);
    this.audio.setBoss(false);
  }

  banner(title, sub) { this.hud.banner(title, sub); }
  toast(text, tone = '') { this.hud.toast(text, tone); }

  /* ------------------------------ levelling ---------------------------- */

  /**
   * Kills inside the streak window multiply score and essence. It costs nothing
   * to implement and it is the single thing that makes a player push one room
   * further instead of retreating: the meter is only ever falling.
   */
  comboWindow() { return Math.max(1.05, 2.2 - this.combo * 0.012); }

  comboScoreMult() { return 1 + Math.min(1.6, this.combo * 0.014); }

  comboEssenceMult() { return 1 + Math.min(0.8, this.combo * 0.007); }

  bumpCombo() {
    this.combo += 1;
    this.comboTimer = this.comboWindow();
    this.bestCombo = Math.max(this.bestCombo, this.combo);
    // Milestones are the only place the streak makes a noise of its own.
    if (this.combo % 10 === 0) {
      this.audio.play('levelUp', { pitch: 1.25 + Math.min(0.6, this.combo * 0.008), gain: 0.5, force: true });
      this.toast(`${this.combo} CHAIN`, 'good');
    }
  }

  gainEssence(value) {
    const gained = Math.max(1, Math.round(value * (1 + this.loadout.stats.xpGain) * this.comboEssenceMult()));
    this.xp += gained;
    this.score += Math.round(gained * 2 * this.comboScoreMult());
    this.audio.play('essence', { pitch: 0.9 + Math.random() * 0.5, spacing: 0.02 });
    while (this.xp >= this.xpNeeded) this.levelUp();
  }

  /**
   * Bank a level. It does NOT open the card screen.
   *
   * It used to, and at one level every eight seconds that meant a full-screen
   * modal seizing the game mid-fight, over and over. The choice is the good
   * part of the loop; being interrupted to make it is not. So a level parks an
   * upgrade, the HUD says one is waiting, and you spend it when there is a
   * lull - or stack several and spend them together.
   */
  levelUp() {
    this.xp -= this.xpNeeded;
    this.level += 1;
    this.xpNeeded = xpForLevel(this.level);
    this.banked = (this.banked || 0) + 1;
    // A share of what is missing, not a flat top-up. Near death a level is a
    // genuine rescue; at full hull it is worth nothing. A flat heal did the
    // opposite - levels arrive fastest when you are killing well, so the flat
    // version pinned a strong build at maximum hull and the fight stopped
    // being able to threaten it at all.
    this.player.hull += (this.maxHull() - this.player.hull) * 0.25;
    this.shake = Math.max(this.shake, 0.12);
    this.audio.play('levelUp', { force: true });
    this.toast(`LEVEL ${this.level} - UPGRADE READY`, 'good');
  }

  /** Open the banked choice. Bound to Tab, and to the HUD prompt. */
  openCards() {
    if (this.state !== 'playing' || !this.banked) return;
    this.pendingCards = this.loadout.offer(this.deepest);
    if (!this.pendingCards.length) { this.banked = 0; return; }
    this.state = 'levelup';
    // Hand the cursor back so the choice is a real click on a real card.
    // While the pointer was locked the only mouse affordance was "any click
    // takes card one", and since the left button is also the surge, a card
    // screen arriving mid-fight was dismissed before it could be read.
    this.cardsShownAt = performance.now();
    this.hoverCard = -1;
    this.firing = false;
    this.surging = false;
    document.exitPointerLock?.();
    document.body.classList.add('choosing');
    this.audio.setIntensity(0.2);
  }

  chooseCard(index) {
    if (!this.pendingCards) return;
    const card = this.pendingCards[Math.max(0, Math.min(this.pendingCards.length - 1, index))];
    if (!card) return;
    this.loadout.take(card);
    this.player.hull = Math.min(this.maxHull(), this.player.hull);
    this.banked = Math.max(0, (this.banked || 0) - 1);
    this.pendingCards = null;
    this.hoverCard = -1;
    this.state = 'playing';
    document.body.classList.remove('choosing');
    this.audio.play('choose', { force: true });
    this.toast(`${card.title.toUpperCase()}`, 'good');
    // Picking is itself the user gesture, so re-locking here is always allowed.
    if (!this.pointerLocked) this.el.canvas.requestPointerLock?.();
  }

  /**
   * Which card is under the mouse, or -1.
   *
   * The HUD canvas is a small buffer stretched over the window, so a client
   * coordinate has to be scaled into HUD pixels before it means anything.
   */
  cardAtPointer(event) {
    const rects = this.hud.cardRects;
    if (!rects) return -1;
    const canvas = this.el.hudCanvas;
    const box = canvas.getBoundingClientRect();
    if (!box.width || !box.height) return -1;
    const x = (event.clientX - box.left) * (canvas.width / box.width);
    const y = (event.clientY - box.top) * (canvas.height / box.height);
    for (let i = 0; i < rects.length; i += 1) {
      const r = rects[i];
      if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return i;
    }
    return -1;
  }

  maxHull() {
    return PLAYER.maxHull + this.loadout.stats.maxHull;
  }

  /* ------------------------------- combat ------------------------------ */

  viewDirection() {
    const cp = Math.cos(this.player.pitch);
    return [Math.sin(this.player.yaw) * cp, Math.sin(this.player.pitch), -Math.cos(this.player.yaw) * cp];
  }

  eyePoint() {
    return [this.player.x, this.player.y + this.player.eye, this.player.z];
  }

  combatHooks() {
    if (this._hooks) return this._hooks;
    this._hooks = {
      pickupBonus: 0,
      onPlayerHit: (amount) => this.hurtPlayer(amount),
      onWindup: (e) => this.audio.play('windup', { pitch: 0.85 + Math.random() * 0.3, spacing: 0.09 }),
      onEnemyShoot: () => this.audio.play('shoot', { pitch: 0.7, spacing: 0.06 }),
      onNotice: () => this.audio.play('notice', { pitch: 0.9 + Math.random() * 0.25, spacing: 0.18 }),
      onBossWake: () => {},
      onProjectileWall: (p) => {
        this.audio.play('hitWall', { pitch: 0.85 + Math.random() * 0.4, spacing: 0.04 });
        this.addFlash([p.x, p.y, p.z], p.colour, 1.1, 0.06);
      },
      onFire: (weapon, origin) => {
        const s = weapon.stats;
        this.audio.play('shoot', { pitch: 0.75 + Math.random() * 0.6, gain: 0.9, spacing: 0.025 });
        this.recoil = Math.min(1, (this.recoil || 0) + 0.3);
        this.muzzleWeapon = 0.05;
        this.shake = Math.max(this.shake, 0.012 + s.damage * 0.0004);
        this.addFlash(origin, s.trail, 1.8, 0.05);
      },
      onHit: (p, enemy, isCrit, killed) => {
        this.hitmarkTimer = isCrit ? 0.16 : 0.09;
        this.audio.play(isCrit ? 'crit' : (p.weapon ? p.weapon.sfx : 'hitEnemy'), {
          pitch: 0.85 + Math.random() * 0.45, spacing: 0.03,
        });
        this.addFlash([p.x, p.y, p.z], p.weapon ? p.weapon.trail : p.colour, isCrit ? 2.6 : 1.4, 0.07);
        if (p.weapon && p.weapon.lifesteal > 0 && !killed) {
          this.player.hull = Math.min(this.maxHull(), this.player.hull + p.damage * p.weapon.lifesteal);
        }
        const steal = this.loadout.stats.lifesteal;
        if (steal > 0) this.player.hull = Math.min(this.maxHull(), this.player.hull + p.damage * steal);
      },
      onBlast: (p, radius) => {
        this.audio.play('explode', { pitch: 0.8 + Math.random() * 0.35, spacing: 0.05 });
        this.addFlash([p.x, p.y, p.z], p.weapon ? p.weapon.trail : p.colour, 5.5, 0.16);
        const d = Math.hypot(p.x - this.player.x, p.z - this.player.z);
        this.shake = Math.max(this.shake, Math.max(0, 0.16 - d * 0.01) + radius * 0.008);
      },
      onChain: () => this.audio.play('hitArc', { pitch: 1.1 + Math.random() * 0.4, spacing: 0.04 }),
      onKill: (enemy) => this.onKill(enemy),
      onEssence: (value) => this.gainEssence(value),
      onPickup: (item) => {
        if (item.kind === 'health') {
          if (this.player.hull >= this.maxHull()) return false;
          this.player.hull = Math.min(this.maxHull(), this.player.hull + item.amount);
        } else {
          if (this.player.charge >= PLAYER.maxCharge) return false;
          this.player.charge = Math.min(PLAYER.maxCharge, this.player.charge + item.amount);
        }
        this.audio.play('pickup', { pitch: 0.95 + Math.random() * 0.3 });
        return true;
      },
    };
    return this._hooks;
  }

  /** Short-lived point light. This is what welds a sound to a visible event. */
  addFlash(pos, colour, intensity, life) {
    if (!this.flashes) this.flashes = [];
    if (this.flashes.length > 14) this.flashes.shift();
    this.flashes.push({ pos: [pos[0], pos[1], pos[2]], colour, intensity, life, maxLife: life });
  }

  /** Every weapon that is off cooldown, fired where you are looking. */
  /**
   * Run the weapons.
   *
   * Two things gate a shot. In MANUAL mode you have to be holding the trigger,
   * because a gun that fires whether or not you asked it to is not a weapon,
   * it is a noise. In AUTO mode there has to be something to shoot at: the old
   * behaviour fired every weapon on cooldown forever, so the very first thing
   * a new player saw was a pistol emptying itself into an empty room with no
   * way to stop it.
   *
   * `ignoreGate` is for the surge, which is an explicit button press and so is
   * allowed to fire into nothing if that is what the player asked for.
   */
  autoFire(dt, floorIndex, ignoreGate = false) {
    const haste = 1 + this.loadout.stats.haste;
    const bonus = {
      damage: this.loadout.stats.damage,
      area: this.loadout.stats.area,
      crit: this.loadout.stats.crit,
    };
    const origin = this.eyePoint();
    const forward = this.viewDirection();

    // One sight lookup for the whole volley rather than one per weapon.
    const target = this.swarm.targetFor(origin, forward, floorIndex);
    this.hasTarget = target !== null;

    let allowed = ignoreGate;
    if (!allowed) allowed = this.fireMode === 'manual' ? this.firing : this.hasTarget;

    for (const weapon of this.loadout.weapons) {
      if (weapon.stats.aim === 'orbit') continue;
      // Cooldowns always tick, so switching modes or finding a target does not
      // hand you a stockpiled volley.
      weapon.cooldownLeft -= dt * haste;
      if (!allowed) { weapon.cooldownLeft = Math.max(0, weapon.cooldownLeft); continue; }
      if (weapon.cooldownLeft > 0) continue;
      weapon.cooldownLeft += Math.max(0.08, weapon.stats.cooldown);
      this.swarm.fireWeapon(weapon, origin, forward, floorIndex, bonus, this.combatHooks(), target);
    }
  }

  /** Orbit weapons are not fired; they are simply always there, and always hurt. */
  updateOrbits(dt, floorIndex) {
    this.orbits.length = 0;
    const bonus = 1 + this.loadout.stats.area;
    const hooks = this.combatHooks();
    for (const weapon of this.loadout.weapons) {
      const s = weapon.stats;
      if (s.aim !== 'orbit') continue;
      weapon.orbitPhase += dt * (s.speed * (1 + this.loadout.stats.haste));
      if (!weapon.hitClock) weapon.hitClock = new Map();
      // Forget enemies past the re-hit window. Without this the map keeps an
      // entry for every body an orbit has ever brushed - thousands over a long
      // run, none of which can ever matter again.
      if (weapon.hitClock.size > 256) {
        const stale = this.swarm.clock - 1;
        for (const [id, when] of weapon.hitClock) {
          if (when < stale) weapon.hitClock.delete(id);
        }
      }
      const radius = 2.1 * bonus;
      for (let i = 0; i < s.count; i += 1) {
        const angle = weapon.orbitPhase + (i / s.count) * Math.PI * 2;
        const x = this.player.x + Math.cos(angle) * radius;
        const z = this.player.z + Math.sin(angle) * radius;
        const y = this.player.y + 1.0;
        this.orbits.push({ x, y, z, size: s.size * bonus, colour: s.trail });
        for (const enemy of this.swarm.nearby(x, z, [])) {
          if (enemy.hp <= 0 || enemy.floor !== floorIndex) continue;
          const reach = enemy.type.radius * enemy.scale + s.size * bonus + 0.2;
          if (Math.hypot(enemy.x - x, enemy.z - z) > reach) continue;
          const last = weapon.hitClock.get(enemy.id) || -1;
          if (this.swarm.clock - last < 0.42) continue;
          weapon.hitClock.set(enemy.id, this.swarm.clock);
          const dir = [enemy.x - this.player.x, enemy.z - this.player.z];
          const len = Math.hypot(dir[0], dir[1]) || 1;
          const damage = s.damage * (1 + this.loadout.stats.damage);
          // The floor and the area-scaled blast go in here too: applyImpact now
          // filters splash and chain by floor, and reads its radius off this.
          this.swarm.applyImpact({
            x, y, z, damage, weapon: s, colour: s.colour,
            floor: floorIndex, blast: s.blast * bonus,
          }, enemy, hooks);
          this.swarm.hurt(enemy, damage, [dir[0] / len, dir[1] / len], hooks);
          this.swarm.burst(x, y, z, s.trail, 3);
          this.audio.play(s.sfx, { pitch: 0.9 + Math.random() * 0.4, spacing: 0.05 });
        }
      }
    }
  }

  fireSurge(floorIndex) {
    if (this.surgeCooldown > 0 || this.player.charge < SURGE.cost) return;
    this.player.charge -= SURGE.cost;
    this.player.regenHold = 0.4;
    this.surgeCooldown = SURGE.cooldown;
    for (const weapon of this.loadout.weapons) weapon.cooldownLeft = 0;
    this.autoFire(0, floorIndex, true);
    this.shake = Math.max(this.shake, 0.1);
    this.audio.play('surge', { force: true });
  }

  fireBlast(floorIndex) {
    if (this.blastCooldown > 0 || this.player.charge < BLAST.cost) return;
    this.player.charge -= BLAST.cost;
    this.player.regenHold = 0.6;
    this.blastCooldown = BLAST.cooldown;
    this.shake = Math.max(this.shake, 0.24);
    this.audio.play('blast', { force: true });

    const centre = [this.player.x, this.player.y + 1.0, this.player.z];
    const radius = BLAST.radius * (1 + this.loadout.stats.area);
    const hooks = this.combatHooks();
    const damage = BLAST.damage * (1 + this.loadout.stats.damage);
    for (const enemy of [...this.swarm.enemies]) {
      if (enemy.hp <= 0 || enemy.floor !== floorIndex) continue;
      const d = Math.hypot(enemy.x - centre[0], enemy.z - centre[2]);
      if (d > radius) continue;
      const push = [(enemy.x - centre[0]) / (d || 1), (enemy.z - centre[2]) / (d || 1)];
      // Knock hard: the blast is a panic button, so it has to buy space.
      for (let i = 0; i < 5; i += 1) {
        this.physics.move(enemy, push[0] * 0.22, push[1] * 0.22, enemy.type.radius, enemy.type.height);
      }
      this.swarm.hurt(enemy, damage * (1 - (d / radius) * 0.55), push, hooks);
    }
    this.swarm.burst(centre[0], centre[1], centre[2], rgb('ice', 4), 42);
    this.addFlash(centre, rgb('ice', 4), 7, 0.22);
  }

  onKill(enemy) {
    this.kills += 1;
    this.bumpCombo();
    this.score += Math.round(enemy.type.score * this.comboScoreMult());
    if (!this.quota.boss && !this.riftOpen) {
      this.quota.done += 1;
      if (this.quota.done >= this.quota.need) this.openRift();
    }
    // The death note climbs with the streak, so the horde audibly rewards greed.
    this.audio.play('enemyDie', {
      pitch: 0.8 + Math.min(0.7, this.combo * 0.012) + Math.random() * 0.3, spacing: 0.04,
    });
    this.shake = Math.max(this.shake, enemy.type.boss ? 0.4 : 0.03);
    if (enemy.type.boss) this.onVictory();
  }

  openRift() {
    this.riftOpen = true;
    this.audio.play('riftOpen', { force: true });
    this.banner('THE WAY DOWN OPENS', 'LEAVE, OR STAY AND GROW STRONGER');
    this.shake = Math.max(this.shake, 0.2);
  }

  hurtPlayer(amount) {
    if (this.player.invuln > 0 || this.state !== 'playing') return;
    const reduced = amount * Math.max(0.25, 1 - this.loadout.stats.armour);
    this.player.hull -= reduced;
    // Half the chain, not all of it. A full reset would mean the meter never
    // climbs at depth-four density; keeping none of it would mean the meter
    // costs nothing. Half is a loss you can feel and still fight back from.
    if (this.combo > 1) {
      this.combo = Math.floor(this.combo / 2);
      this.comboTimer = this.comboWindow();
    }
    this.player.invuln = PLAYER.invulnAfterHit;
    this.damageFlash = 1;
    this.shake = Math.max(this.shake, 0.18);
    this.audio.play('playerHurt', { force: true });
    if (this.player.hull <= 0) {
      this.player.hull = 0;
      this.onDeath();
    }
  }

  onDeath() {
    this.state = 'dead';
    this.audio.play('death', { force: true });
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
    this.score += 6000 + Math.max(0, 5000 - Math.round(this.runTime * 12));
    this.audio.play('victory', { force: true });
    this.audio.setIntensity(0);
    this.audio.setBoss(false);
    this.recordBest();
    document.exitPointerLock?.();
    this.el.overTitle.textContent = 'THE WARDEN FALLS';
    this.el.overTitle.className = 'overTitle good';
    this.el.overStats.innerHTML = this.runSummary();
    this.el.over.classList.remove('hidden');
  }

  runSummary() {
    const minutes = Math.floor(this.runTime / 60);
    const seconds = Math.floor(this.runTime % 60).toString().padStart(2, '0');
    const pad = (n) => String(Math.max(0, Math.round(n))).padStart(6, '0');
    const build = this.loadout.weapons.map((w) => `${w.name} L${w.level}`).join(' / ') || 'NONE';
    return `
      <div class="statRow"><span>SCORE</span><b>${pad(this.score)}</b></div>
      <div class="statRow"><span>LEVEL</span><b>${this.level}</b></div>
      <div class="statRow"><span>KILLS</span><b>${this.kills}</b></div>
      <div class="statRow"><span>BEST CHAIN</span><b>${this.bestCombo}</b></div>
      <div class="statRow"><span>DEEPEST</span><b>DEPTH ${this.deepest + 1}</b></div>
      <div class="statRow"><span>TIME</span><b>${minutes}:${seconds}</b></div>
      <div class="statRow"><span>SEED</span><b>${this.seed}</b></div>
      <div class="statRow best"><span>BEST</span><b>${pad(Math.max(this.best, this.score))}</b></div>
      <div class="buildLine">${build.toUpperCase()}</div>`;
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
    const shift = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
    const running = this.sprintMode === 'toggle' ? this.sprintLatched : shift;
    const base = running ? PLAYER.runSpeed : PLAYER.walkSpeed;
    const speed = base * (1 + this.loadout.stats.moveSpeed);
    this.walkBob = (this.walkBob || 0) + dt * (running ? 13 : 8.5);
    this.physics.move(
      this.player,
      (fx * forward + rx * strafe) * speed * dt,
      (fz * forward + rz * strafe) * speed * dt,
    );
  }

  updateDepth(floorIndex) {
    if (this.visited.has(floorIndex)) return;
    this.visited.add(floorIndex);
    this.deepest = Math.max(this.deepest, floorIndex);
    this.audio.setDepth(floorIndex);
    this.audio.play('descend', { force: true });
    this.player.hull = Math.min(this.maxHull(), this.player.hull + 30);
    this.player.charge = PLAYER.maxCharge;
    this.score += 1200;
    this.setQuota(floorIndex);
    const name = DEPTH_NAMES[floorIndex] || `Depth ${floorIndex + 1}`;
    const last = floorIndex === this.dungeon.floorCount - 1;
    this.banner(`DEPTH ${floorIndex + 1} - ${name.toUpperCase()}`,
      last ? 'THE WARDEN IS HERE. KILL IT.' : 'DEEPER. FASTER. KILL MORE.');
  }

  updateCompass(floorIndex) {
    const plan = this.dungeon.floors[floorIndex];
    let target = null;
    if (this.riftOpen && !this.quota.boss) {
      for (const stair of this.dungeon.stairs) {
        if (stair.upperFloor !== floorIndex) continue;
        const world = plan.worldOf(stair.exit[0], stair.exit[1]);
        const d = Math.hypot(world[0] - this.player.x, world[2] - this.player.z);
        if (!target || d < target.d) target = { d, x: world[0], z: world[2], label: 'DESCEND' };
      }
    }
    const goal = this.dungeon.roomsById.get(this.dungeon.goal);
    if (!target && goal && goal.floor === floorIndex && !this.bossDead) {
      const world = this.dungeon.floors[goal.floor].worldOf(goal.cx, goal.cz);
      target = {
        d: Math.hypot(world[0] - this.player.x, world[2] - this.player.z),
        x: world[0], z: world[2], label: 'WARDEN',
      };
    }
    if (!target) { this.compass = null; return; }
    const angle = Math.atan2(target.x - this.player.x, -(target.z - this.player.z));
    let delta = angle - this.player.yaw;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    this.compass = { label: target.label, distance: target.d, delta };
  }

  checkBoss(floorIndex) {
    const boss = this.swarm.boss;
    if (!boss || this.bossDead) { this.bossState = null; return; }
    if (boss.hp <= 0) { this.bossState = null; return; }
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
      // Scale the Warden to whatever walked into the room.
      //
      // Builds arriving here range from a level-eight scrape to a level-thirty
      // engine of destruction, and a fixed pool cannot serve both: the same
      // 1500 hit points that are a wall for one are two and a half seconds for
      // the other. The run's last fight has to be the run's hardest fight, so
      // the Warden is measured against the player rather than against a number
      // chosen before the run began.
      boss.maxHp = Math.round(boss.type.hp * (1 + this.level * 0.19));
      boss.hp = boss.maxHp;
      this.audio.play('bossRoar', { force: true });
      this.audio.setBoss(true);
      this.banner('THE WARDEN', 'IT HAS BEEN WAITING');
    }
    this.bossState = { name: 'THE WARDEN', ratio: Math.max(0, boss.hp / boss.maxHp) };
  }

  updateHud(floorIndex, dt) {
    const remaining = this.swarm.aliveOnFloor(floorIndex);
    let objective;
    if (this.quota.boss) objective = this.bossAwake ? 'KILL THE WARDEN' : 'FIND THE WARDEN';
    else if (this.riftOpen) objective = 'THE WAY DOWN IS OPEN';
    else objective = `PURGE ${this.quota.need - this.quota.done} MORE`;

    this.hud.draw({
      hull: this.player.hull,
      maxHull: this.maxHull(),
      charge: this.player.charge,
      maxCharge: PLAYER.maxCharge,
      score: this.score,
      level: this.level,
      xp: this.xp,
      xpNeeded: this.xpNeeded,
      depth: floorIndex + 1,
      floors: this.dungeon.floorCount,
      objective,
      quota: this.quota,
      riftOpen: this.riftOpen,
      hostiles: remaining,
      weapons: this.loadout.weapons.map((w) => ({
        name: w.name, level: w.level,
        colour: `rgb(${w.stats.colour.map((v) => Math.round(v * 255)).join(',')})`,
        ready: w.cooldownLeft <= 0.05,
      })),
      relics: this.loadout.relics.length,
      banked: this.banked || 0,
      compass: this.compass,
      boss: this.bossState,
      hitmark: this.hitmarkTimer,
      cards: this.pendingCards,
      hoverCard: this.hoverCard,
      combo: this.combo,
      comboRatio: this.combo ? Math.max(0, this.comboTimer / this.comboWindow()) : 0,
      comboMult: this.comboScoreMult(),
    }, dt);

    // Only touch the DOM when the value actually changes. Assigning an inline
    // style every frame invalidates and recomposites a full-screen overlay
    // whether or not the number moved, which is real work for no change.
    const flash = Math.round(this.damageFlash * 55) / 100;
    if (flash !== this.lastFlash) {
      this.el.damage.style.opacity = String(flash);
      this.lastFlash = flash;
    }
    const low = this.player.hull / this.maxHull() < 0.3 && this.state === 'playing';
    if (low !== this.lastLow) {
      this.el.lowHp.classList.toggle('show', low);
      this.lastLow = low;
    }
  }

  step(dt, floorIndex) {
    this.runTime += dt;
    this.floorTime += dt;
    this.surgeCooldown = Math.max(0, this.surgeCooldown - dt);
    this.blastCooldown = Math.max(0, this.blastCooldown - dt);
    this.player.invuln = Math.max(0, this.player.invuln - dt);
    this.player.regenHold = Math.max(0, this.player.regenHold - dt);
    this.damageFlash = Math.max(0, this.damageFlash - dt * 2.4);
    this.hitmarkTimer = Math.max(0, this.hitmarkTimer - dt);
    this.shake = Math.max(0, this.shake - dt * 0.7);
    if (this.comboTimer > 0) {
      this.comboTimer -= dt;
      if (this.comboTimer <= 0) { this.combo = 0; this.comboTimer = 0; }
    }
    this.recoil = Math.max(0, (this.recoil || 0) - dt * 5.5);
    this.muzzleWeapon = Math.max(0, (this.muzzleWeapon || 0) - dt);
    if (this.player.regenHold <= 0 && this.player.charge < PLAYER.maxCharge) {
      this.player.charge = Math.min(PLAYER.maxCharge, this.player.charge + PLAYER.chargeRegen * dt);
    }
    this.updateMovement(dt);
    this.autoFire(dt, floorIndex);
    if (this.surging && this.fireMode === 'auto') this.fireSurge(floorIndex);
    if (this.blasting) { this.fireBlast(floorIndex); this.blasting = false; }
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

      const hooks = this.combatHooks();
      hooks.pickupBonus = this.loadout.stats.pickupRadius;
      this.swarm.desperation = Math.max(0, 1 - this.player.hull / this.maxHull());
      this.updateOrbits(raw, floorIndex);
      this.swarm.update(raw, this.player, hooks);

      // Pressure ramps while you stay, and again once the way down is open, so
      // farming is always a live risk rather than a free lunch.
      const intensity = Math.min(1.4, this.floorTime / 110 + (this.riftOpen ? 0.4 : 0));
      this.swarm.spawnWave(raw, this.player, floorIndex, intensity);

      this.updateDepth(floorIndex);
      this.checkBoss(floorIndex);
      this.updateCompass(floorIndex);
      this.map.observe(floorIndex, this.player.x, this.player.z);

      const pressure = Math.min(1, this.swarm.aggroCount / 14) * 0.7
        + (1 - this.player.hull / this.maxHull()) * 0.3;
      this.audio.setIntensity(this.bossAwake ? Math.max(0.8, pressure) : pressure);
    }

    if (this.dungeon) {
      const floorIndex = this.physics.floorAt(this.player.y);
      this.updateHud(floorIndex, raw);

      // Flashes decay here so they live exactly as long on screen as in the ear.
      const lights = this.swarm.lights();
      if (this.flashes) {
        for (const f of this.flashes) f.life -= raw;
        this.flashes = this.flashes.filter((f) => f.life > 0);
        for (const f of this.flashes) {
          lights.push({ pos: f.pos, colour: f.colour, intensity: f.intensity * (f.life / f.maxLife) });
        }
      }
      for (const o of this.orbits) lights.push({ pos: [o.x, o.y, o.z], colour: o.colour, intensity: 0.7 });

      this.renderer.shake = this.shake;
      this.renderer.setDynamic(this.state === 'playing' || this.state === 'levelup' ? this.viewModelBoxes() : []);
      this.renderer.setSprites(this.swarm.spriteList(this.orbits));
      this.renderer.setTransientLights(lights);
      this.renderer.render(this.player, raw);
      this.map.draw(this.dungeon, this.player, floorIndex, { doors: this.compiled.doors });
    }

    requestAnimationFrame((t) => this.frame(t));
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
    boxes.push(part(depth, side, drop, 0.016, 0.019, 0.080, rgb('stone', 3), 0.04));
    boxes.push(part(depth + 0.105, side, drop + 0.004, 0.008, 0.008, 0.055, rgb('stone', 1), 0.02));
    boxes.push(part(depth + 0.02, side, drop + 0.026, 0.005, 0.010, 0.012, rgb('stone', 2), 0));
    boxes.push(part(depth - 0.055, side, drop - 0.042, 0.011, 0.030, 0.014, rgb('bone', 0), 0));
    const level = this.player.charge / PLAYER.maxCharge;
    boxes.push(part(depth - 0.012, side - 0.017, drop + 0.006, 0.004, 0.008, 0.052 * Math.max(0.1, level),
      level > 0.25 ? rgb('ice', 3) : rgb('blood', 3), 1.0));
    if ((this.muzzleWeapon || 0) > 0) {
      boxes.push(part(depth + 0.18, side, drop + 0.004, 0.03, 0.03, 0.05, rgb('ember', 4), 1.0));
    }
    return boxes;
  }
}

export { PLAYER, SURGE, BLAST };
