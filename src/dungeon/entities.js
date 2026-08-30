/**
 * Enemies, projectiles, pickups and particles.
 *
 * This is a bullet heaven, so everything here is built for crowds. Navigation is
 * a flow field - one breadth-first sweep out from the player's tile serves the
 * whole floor, so a hundred monsters cost about what one does. Separation runs
 * off a spatial hash rebuilt each frame rather than comparing every pair, which
 * is the difference between a horde and a slideshow.
 */

import { TILE_SIZE, DIRS } from './grid.js';
import { ROOM_TYPE } from './generator.js';
import { rgb } from './palette.js';

export const ENEMY_TYPES = {
  crawler: {
    name: 'Crawler',
    hp: 17, speed: 4.35, radius: 0.34, height: 1.05,
    damage: 5, range: 1.5, windup: 0.32, recover: 0.5,
    ranged: false, score: 60, xp: 3,
    colour: 'bone', eye: rgb('ember', 4),
  },
  wraith: {
    name: 'Wraith',
    hp: 34, speed: 3.5, radius: 0.36, height: 1.6,
    damage: 9, range: 1.8, windup: 0.44, recover: 0.8,
    ranged: false, lunge: 9.5, score: 130, xp: 6,
    colour: 'arcane', eye: rgb('arcane', 4),
  },
  sentinel: {
    name: 'Sentinel',
    hp: 62, speed: 1.6, radius: 0.48, height: 1.85,
    damage: 8, range: 15, windup: 0.7, recover: 1.45,
    ranged: true, projectileSpeed: 12, score: 190, xp: 9,
    colour: 'verdigris', eye: rgb('ember', 4),
  },
  warden: {
    name: 'The Warden',
    hp: 1500, speed: 1.9, radius: 0.95, height: 3.0,
    damage: 16, range: 20, windup: 0.9, recover: 1.35,
    ranged: true, projectileSpeed: 12, score: 6000, xp: 160, boss: true,
    colour: 'blood', eye: rgb('ember', 4),
  },
};

/** Hard ceiling on live monsters. Past this the frame, not the fight, is the enemy. */
const MAX_ENEMIES = 150;
/**
 * How many monsters may linger on floors the player is not on.
 *
 * Anything above this is bookkeeping, not gameplay: it is unseen, it cannot be
 * fought, and every slot it holds is a slot the floor under your feet does not
 * get. Left unchecked the swarm fills its whole budget with monsters three
 * floors up and the fight in front of you starves. The spawner refills any
 * floor you walk back onto within seconds, so nothing observable is lost.
 */
const OFF_FLOOR_BUDGET = 24;
/** The body the pathing mask is cut for: the widest monster that walks (sentinel). */
/** How many line-of-sight rays one auto-aim lock may spend before giving up. */
const SIGHT_TESTS = 6;
const BODY_RADIUS = 0.5;
const BODY_HEIGHT = 1.85;
const SEPARATION_CELL = 1.6;

let nextId = 1;

export class Swarm {
  constructor(dungeon, physics, rng) {
    this.dungeon = dungeon;
    this.physics = physics;
    this.rng = rng;
    this.enemies = [];
    this.projectiles = [];
    this.particles = [];
    this.pickups = [];
    this.motes = [];
    this.arcs = [];
    this.flow = new Map();
    this.flowAge = 0;
    this.flowFloor = -1;
    this.aggroCount = 0;
    this.boss = null;
    this.clock = 0;
    this.spawnAccumulator = 0;
    this.grid = new Map();
    this.killsByFloor = new Map();
  }

  setFrames(frames) { this.frames = frames; }

  /**
   * Every walkable tile per floor, cached once.
   *
   * The spawner used to guess coordinates and throw most of them away, which
   * quietly capped the horde at a trickle. Sampling from a real list means a
   * requested spawn almost always happens.
   */
  /**
   * Tiles a monster body can actually stand on.
   *
   * `plan.walkable` answers a question about the tile map; `canOccupy` answers
   * the question the movement code actually asks, with a radius and a height. A
   * doorway with a brazier in it is walkable and unstandable, and routing a
   * horde through one parks it against the obstruction forever. Everything that
   * decides where monsters go - the flow field, the spawner - reads this mask,
   * so pathing and movement agree by construction.
   */
  passableMask(floorIndex) {
    if (!this.masks) this.masks = new Map();
    // Hashed once per frame in update(), not once per enemy: this is called from
    // flowStep for every chasing monster.
    const doorState = this.doorState || 0;
    const cached = this.masks.get(floorIndex);
    if (cached && cached.doorState === doorState) return cached.mask;
    const plan = this.dungeon.floors[floorIndex];
    const mask = new Uint8Array(plan.width * plan.height);
    for (let z = 0; z < plan.height; z += 1) {
      for (let x = 0; x < plan.width; x += 1) {
        if (!plan.walkable(x, z)) continue;
        const world = plan.worldOf(x, z);
        const y = this.physics.canOccupy(world[0], world[2], world[1], world[1], BODY_RADIUS, BODY_HEIGHT);
        if (y !== null) mask[z * plan.width + x] = 1;
      }
    }
    this.masks.set(floorIndex, { mask, doorState });
    return mask;
  }

  buildSpawnTiles() {
    this.spawnTiles = this.dungeon.floors.map((plan) => {
      const mask = this.passableMask(plan.index);
      const tiles = [];
      for (let z = 0; z < plan.height; z += 1) {
        for (let x = 0; x < plan.width; x += 1) {
          if (mask[z * plan.width + x] && !plan.isReserved(x, z)) tiles.push(x, z);
        }
      }
      return tiles;
    });
  }

  /* ------------------------------ spawning ----------------------------- */

  /** Seed each floor lightly; the waves do the real work once you arrive. */
  populate() {
    for (const plan of this.dungeon.floors) {
      const rooms = plan.rooms.filter((r) => r.id !== this.dungeon.start);
      for (let i = 0; i < 4 + plan.index * 2 && rooms.length; i += 1) {
        const room = this.rng.pick(rooms);
        const spot = this.freeTileIn(plan, room);
        if (spot) this.spawn(this.pickKind(plan.index), plan, spot[0], spot[1]);
      }
      for (const room of rooms) {
        if (room.type !== ROOM_TYPE.VAULT && room.type !== ROOM_TYPE.SHRINE) continue;
        const spot = this.freeTileIn(plan, room);
        if (spot) this.addPickup(room.type === ROOM_TYPE.VAULT ? 'health' : 'energy', plan, spot[0], spot[1], 35);
      }
    }
    const goal = this.dungeon.roomsById.get(this.dungeon.goal);
    if (goal) {
      const plan = this.dungeon.floors[goal.floor];
      this.boss = this.spawn('warden', plan, goal.cx, goal.cz) || null;
      if (this.boss) this.boss.dormant = true;
      for (let i = 0; i < 4; i += 1) {
        const spot = this.freeTileIn(plan, goal);
        if (spot) this.addPickup(i % 2 ? 'energy' : 'health', plan, spot[0], spot[1], i % 2 ? 45 : 30);
      }
    }
    return this;
  }

  pickKind(depth) {
    const roll = this.rng.next();
    if (depth <= 0) return roll < 0.82 ? 'crawler' : 'sentinel';
    if (depth === 1) return roll < 0.66 ? 'crawler' : roll < 0.86 ? 'wraith' : 'sentinel';
    if (depth === 2) return roll < 0.52 ? 'crawler' : roll < 0.80 ? 'wraith' : 'sentinel';
    return roll < 0.44 ? 'crawler' : roll < 0.74 ? 'wraith' : 'sentinel';
  }

  freeTileIn(plan, room) {
    for (let attempt = 0; attempt < 14; attempt += 1) {
      const x = room.x + this.rng.int(room.w);
      const z = room.z + this.rng.int(room.h);
      if (plan.get(x, z) !== 1 || plan.isReserved(x, z)) continue;
      return [x, z];
    }
    return null;
  }

  spawn(kind, plan, tileX, tileZ, elite = false) {
    if (this.enemies.length >= MAX_ENEMIES) return null;
    const type = ENEMY_TYPES[kind];
    const world = plan.worldOf(tileX, tileZ);
    const y = this.physics.canOccupy(world[0], world[2], world[1], world[1], type.radius, type.height);
    if (y === null) return null;
    const scale = elite ? 1.5 : 1;
    const enemy = {
      id: nextId++,
      kind, type, elite,
      x: world[0], y, z: world[2],
      floor: plan.index,
      hp: type.hp * (elite ? 3.2 : 1),
      maxHp: type.hp * (elite ? 3.2 : 1),
      scale,
      state: 'idle',
      stateTime: 0,
      facing: this.rng.next() * Math.PI * 2,
      hurtFlash: 0,
      bob: this.rng.next() * 6.28,
      aggro: false,
      dormant: false,
      earshot: 0,
      slowUntil: 0,
      burnUntil: 0,
      burnDps: 0,
    };
    this.enemies.push(enemy);
    return enemy;
  }

  /**
   * Continuous pressure. Monsters arrive out of sight and walk in, so the horde
   * builds rather than popping into existence in front of you.
   */
  spawnWave(dt, player, depth, intensity) {
    if (this.enemies.length >= MAX_ENEMIES) return;
    const plan = this.dungeon.floors[depth];
    if (!plan) return;
    if (!this.spawnTiles) this.buildSpawnTiles();
    const tiles = this.spawnTiles[depth];
    if (!tiles || !tiles.length) return;

    // A live ceiling as well as the hard one. The floor you just arrived on is
    // thin enough to read; the one you have been farming for two minutes is a
    // wall of bodies. The ramp is what turns "stay or leave" into a real choice.
    const ceiling = Math.min(MAX_ENEMIES, Math.round(34 + depth * 20 + intensity * 46));
    const live = this.aliveOnFloor(depth);
    if (live >= ceiling) { this.spawnAccumulator = 0; return; }

    const field = this.flowFloor === depth ? this.flow.get(depth) : null;
    const rate = 1.9 + depth * 0.8 + intensity * 6.4;
    this.spawnAccumulator += dt * rate;
    let budget = Math.floor(this.spawnAccumulator);
    if (budget <= 0) return;
    this.spawnAccumulator -= budget;
    budget = Math.min(budget, MAX_ENEMIES - this.enemies.length, ceiling - live);

    // Three progressively looser windows. The first is the one we want - out of
    // sight, close enough to arrive soon - but a player holding a corner of a
    // sparse floor can starve it of candidates, and a horde that stops arriving
    // is the one failure this loop cannot survive. So the rules relax rather
    // than the budget being dropped.
    const windows = [
      { min: 7, max: 30, hideRoll: 0.8 },
      { min: 6, max: 42, hideRoll: 0.35 },
      { min: 5, max: 70, hideRoll: 0 },
    ];
    for (const window of windows) {
      let guard = 0;
      while (budget > 0 && guard < 200) {
        guard += 1;
        const i = this.rng.int(tiles.length >> 1) << 1;
        const tx = tiles[i];
        const tz = tiles[i + 1];
        const world = plan.worldOf(tx, tz);
        const dist = Math.hypot(world[0] - player.x, world[2] - player.z);
        if (dist < window.min || dist > window.max) continue;
        // A monster that cannot walk to you is worse than no monster: it holds
        // a slot, it never arrives, and the floor quietly goes quiet. The flow
        // field is already a reachability map from the player, so ask it.
        if (field && field[tz * plan.width + tx] < 0) continue;
        if (window.hideRoll > 0 && dist < 18) {
          const seen = this.physics.rayClear(
            [player.x, player.y + 1.4, player.z], [world[0], world[1] + 1, world[2]],
          );
          if (seen && this.rng.next() < window.hideRoll) continue;
        }
        const elite = this.rng.next() < 0.035 + depth * 0.02;
        const spawned = this.spawn(this.pickKind(depth), plan, tx, tz, elite);
        if (spawned) {
          spawned.aggro = true;
          spawned.state = 'chase';
          budget -= 1;
        }
      }
      if (budget <= 0) break;
    }
  }

  addPickup(kind, plan, tileX, tileZ, amount) {
    const world = plan.worldOf(tileX, tileZ);
    const y = this.physics.canOccupy(world[0], world[2], world[1], world[1], 0.2, 0.5);
    if (y === null) return;
    this.pickups.push({ kind, amount, floor: plan.index, x: world[0], y, z: world[2], bob: Math.random() * 6.28 });
  }

  dropLoot(enemy) {
    // Essence always drops - the loop depends on every kill feeding the bar.
    const value = enemy.type.xp * (enemy.elite ? 5 : 1);
    const motes = enemy.elite ? 5 : enemy.type.xp > 5 ? 2 : 1;
    for (let i = 0; i < motes; i += 1) {
      const a = this.rng.next() * Math.PI * 2;
      this.motes.push({
        x: enemy.x + Math.cos(a) * 0.35,
        y: enemy.y + 0.4,
        z: enemy.z + Math.sin(a) * 0.35,
        vx: Math.cos(a) * 2.4, vy: 3.2, vz: Math.sin(a) * 2.4,
        value: Math.max(1, Math.round(value / motes)),
        floor: enemy.floor, age: 0,
      });
    }
    // Desperation drops. At full hull the horde is stingy; at a sliver it starts
    // handing out lifelines, so a run that is nearly over can still be clawed
    // back - and clawing it back is the moment players replay for.
    const mercy = (this.desperation || 0) * 0.16;
    const roll = this.rng.next();
    if (roll < (enemy.elite ? 0.7 : 0.055 + mercy)) {
      this.pickups.push({ kind: 'health', amount: 14, floor: enemy.floor, x: enemy.x, y: enemy.y, z: enemy.z, bob: 0 });
    } else if (roll < (enemy.elite ? 0.95 : 0.11 + mercy)) {
      this.pickups.push({ kind: 'energy', amount: 26, floor: enemy.floor, x: enemy.x, y: enemy.y, z: enemy.z, bob: 0 });
    }
  }

  /* ---------------------------- flow field ----------------------------- */

  rebuildFlow(floorIndex, tileX, tileZ) {
    const plan = this.dungeon.floors[floorIndex];
    if (!plan) return;
    const size = plan.width * plan.height;
    let field = this.flow.get(floorIndex);
    if (!field) {
      field = new Int32Array(size);
      this.flow.set(floorIndex, field);
    }
    field.fill(-1);
    const mask = this.passableMask(floorIndex);
    const open = (x, z) => plan.inside(x, z) && mask[z * plan.width + x] === 1;
    if (!open(tileX, tileZ)) {
      const near = DIRS.map((d) => [tileX + d.dx, tileZ + d.dz]).find(([x, z]) => open(x, z));
      if (!near) return;
      [tileX, tileZ] = near;
    }
    const queue = [tileZ * plan.width + tileX];
    field[queue[0]] = 0;
    for (let head = 0; head < queue.length; head += 1) {
      const index = queue[head];
      const x = index % plan.width;
      const z = (index - x) / plan.width;
      const next = field[index] + 1;
      for (const d of DIRS) {
        const nx = x + d.dx;
        const nz = z + d.dz;
        if (!open(nx, nz)) continue;
        const ni = nz * plan.width + nx;
        if (field[ni] !== -1) continue;
        field[ni] = next;
        queue.push(ni);
      }
    }
    this.flowFloor = floorIndex;
  }

  flowStep(enemy) {
    const plan = this.dungeon.floors[enemy.floor];
    const field = this.flow.get(enemy.floor);
    if (!plan || !field) return null;
    const tx = Math.floor(enemy.x / TILE_SIZE);
    const tz = Math.floor(enemy.z / TILE_SIZE);
    let best = null;
    const mask = this.passableMask(enemy.floor);
    for (const d of DIRS) {
      const nx = tx + d.dx;
      const nz = tz + d.dz;
      if (!plan.inside(nx, nz) || mask[nz * plan.width + nx] !== 1) continue;
      const value = field[nz * plan.width + nx];
      if (value < 0) continue;
      if (!best || value < best.value) best = { value, x: nx, z: nz };
    }
    if (!best) return null;
    const target = plan.worldOf(best.x, best.z);
    return [target[0] - enemy.x, target[2] - enemy.z];
  }

  /* --------------------------- spatial hash ---------------------------- */

  rebuildGrid() {
    this.grid.clear();
    for (const enemy of this.enemies) {
      if (enemy.hp <= 0) continue;
      const key = `${Math.floor(enemy.x / SEPARATION_CELL)}:${Math.floor(enemy.z / SEPARATION_CELL)}`;
      let bucket = this.grid.get(key);
      if (!bucket) { bucket = []; this.grid.set(key, bucket); }
      bucket.push(enemy);
    }
  }

  nearby(x, z, out) {
    out.length = 0;
    const cx = Math.floor(x / SEPARATION_CELL);
    const cz = Math.floor(z / SEPARATION_CELL);
    for (let dz = -1; dz <= 1; dz += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        const bucket = this.grid.get(`${cx + dx}:${cz + dz}`);
        if (bucket) for (const e of bucket) out.push(e);
      }
    }
    return out;
  }

  /* ------------------------------ combat ------------------------------- */

  raycast(origin, dir, maxDistance) {
    let hit = null;
    for (const enemy of this.enemies) {
      if (enemy.hp <= 0) continue;
      const ex = enemy.x - origin[0];
      const ey = (enemy.y + enemy.type.height * 0.55) - origin[1];
      const ez = enemy.z - origin[2];
      const along = ex * dir[0] + ey * dir[1] + ez * dir[2];
      if (along < 0 || along > maxDistance) continue;
      const perp = Math.hypot(ex - dir[0] * along, ey - dir[1] * along, ez - dir[2] * along);
      const girth = Math.max(enemy.type.radius, enemy.type.height * 0.3) * enemy.scale;
      if (perp > girth) continue;
      if (!hit || along < hit.distance) hit = { enemy, distance: along };
    }
    return hit;
  }

  /**
   * Who a weapon shoots at.
   *
   * Bullet heavens do not ask you to aim - they ask you where to stand. So
   * weapons lock on by themselves, but they prefer whatever is in the arc you
   * are facing, which keeps looking around meaningful without ever wasting a
   * volley on empty air.
   */
  /**
   * What the auto-aim locks onto.
   *
   * Candidates are ranked - inside the facing arc first, then by distance - and
   * then checked for line of sight, because a target behind a wall is not a
   * target. Measured across five seeds on a populated floor, one lock in five
   * was through solid rock, and with weapons that fire themselves that is a
   * fifth of all damage spent shooting masonry, complete with impact sounds.
   *
   * Sight is tested lazily, only until something visible turns up, and capped:
   * a ray is far more expensive than a dot product and this runs whenever any
   * weapon comes off cooldown. Returning null is a real answer - the caller
   * fires straight ahead, which is where the player is looking anyway.
   */
  targetFor(origin, forward, floorIndex, maxDistance = 42) {
    const candidates = [];
    for (const enemy of this.enemies) {
      if (enemy.hp <= 0 || enemy.floor !== floorIndex || enemy.dormant) continue;
      const dx = enemy.x - origin[0];
      const dz = enemy.z - origin[2];
      const d = Math.hypot(dx, dz);
      if (d > maxDistance || d < 0.001) continue;
      const facing = (dx / d) * forward[0] + (dz / d) * forward[2];
      candidates.push({ d, enemy, inArc: facing > 0.26 });
    }
    if (!candidates.length) return null;
    candidates.sort((a, b) => (a.inArc === b.inArc ? a.d - b.d : (a.inArc ? -1 : 1)));

    let rays = 0;
    for (const c of candidates) {
      if (rays >= SIGHT_TESTS) break;
      rays += 1;
      const aim = [c.enemy.x, c.enemy.y + c.enemy.type.height * 0.5, c.enemy.z];
      if (this.physics.rayClear(origin, aim)) return c.enemy;
    }
    return null;
  }

  /** Closest live enemy on the player's floor, for homing rounds. */
  nearestTo(x, z, floorIndex, maxDistance = 40) {
    let best = null;
    for (const enemy of this.enemies) {
      if (enemy.hp <= 0 || enemy.floor !== floorIndex || enemy.dormant) continue;
      const d = Math.hypot(enemy.x - x, enemy.z - z);
      if (d > maxDistance) continue;
      if (!best || d < best.d) best = { d, enemy };
    }
    return best ? best.enemy : null;
  }

  alert(source, radius = 10) {
    for (const other of this.nearby(source.x, source.z, [])) {
      if (other === source || other.hp <= 0 || other.aggro || other.dormant) continue;
      if (other.floor !== source.floor) continue;
      other.aggro = true;
      other.state = 'chase';
      other.stateTime = 0;
    }
    void radius;
  }

  hurt(enemy, amount, knockDir, hooks = {}) {
    if (enemy.hp <= 0) return false;
    const wasCalm = !enemy.aggro;
    enemy.hp -= amount;
    enemy.hurtFlash = 0.16;
    enemy.aggro = true;
    enemy.dormant = false;
    if (wasCalm) this.alert(enemy);
    if (knockDir) {
      const push = enemy.type.boss ? 0.04 : 0.26 / enemy.scale;
      this.physics.move(enemy, knockDir[0] * push, knockDir[1] * push, enemy.type.radius, enemy.type.height);
    }
    if (enemy.hp <= 0) {
      enemy.state = 'dead';
      this.burst(enemy.x, enemy.y + enemy.type.height * 0.5, enemy.z,
        rgb(enemy.type.colour, 3), enemy.type.boss ? 60 : enemy.elite ? 26 : 11);
      this.dropLoot(enemy);
      if (hooks.onKill) hooks.onKill(enemy);
      return true;
    }
    if (enemy.state === 'windup' && !enemy.type.boss) {
      enemy.state = 'stagger';
      enemy.stateTime = 0;
    }
    return false;
  }

  burst(x, y, z, colour, count) {
    const room = 640 - this.particles.length;
    const n = Math.min(count, Math.max(0, room));
    for (let i = 0; i < n; i += 1) {
      const a = Math.random() * Math.PI * 2;
      const p = Math.random() * Math.PI - Math.PI / 2;
      const speed = 1.8 + Math.random() * 5.5;
      this.particles.push({
        x, y, z,
        vx: Math.cos(a) * Math.cos(p) * speed,
        vy: Math.sin(p) * speed + 1.9,
        vz: Math.sin(a) * Math.cos(p) * speed,
        life: 0.3 + Math.random() * 0.45,
        maxLife: 0.75,
        colour,
        size: 0.05 + Math.random() * 0.07,
      });
    }
  }

  /**
   * Fire one weapon. The core decides the aim pattern, so adding a new firing
   * shape means adding a case here and nothing else.
   */
  fireWeapon(weapon, origin, forward, floorIndex, bonus, hooks, knownTarget) {
    const s = weapon.stats;
    const damage = s.damage * (1 + (bonus.damage || 0));
    const size = s.size * (1 + (bonus.area || 0));
    const aimed = s.aim === 'nearest' || s.aim === 'target';
    // `knownTarget === undefined` means "look it up yourself"; null means the
    // caller already looked and found nothing.
    const target = !aimed ? null
      : (knownTarget !== undefined ? knownTarget : this.targetFor(origin, forward, floorIndex));

    let base = forward;
    if (target) {
      const dx = target.x - origin[0];
      const dy = (target.y + target.type.height * 0.5) - origin[1];
      const dz = target.z - origin[2];
      const len = Math.hypot(dx, dy, dz) || 1;
      base = [dx / len, dy / len, dz / len];
    }

    const shots = [];
    if (s.aim === 'radial') {
      for (let i = 0; i < s.count; i += 1) {
        const a = (i / s.count) * Math.PI * 2 + this.clock * 0.6;
        shots.push([Math.cos(a), 0, Math.sin(a)]);
      }
    } else {
      for (let i = 0; i < s.count; i += 1) {
        const offset = s.count === 1 ? 0 : ((i / (s.count - 1)) - 0.5) * s.spread;
        const cos = Math.cos(offset);
        const sin = Math.sin(offset);
        shots.push([
          base[0] * cos - base[2] * sin,
          base[1],
          base[0] * sin + base[2] * cos,
        ]);
      }
    }

    for (const dir of shots) {
      this.projectiles.push({
        x: origin[0], y: origin[1], z: origin[2],
        vx: dir[0] * s.speed, vy: dir[1] * s.speed, vz: dir[2] * s.speed,
        damage, size, weapon: s,
        blast: s.blast * (1 + (bonus.area || 0)),
        pierce: s.pierce, chain: s.chain, life: s.life,
        crit: s.crit + (bonus.crit || 0),
        colour: s.colour, owner: 'player', hits: null,
        floor: floorIndex,
      });
    }
    if (hooks.onFire) hooks.onFire(weapon, origin);
  }

  spawnEnemyProjectile(from, dir, speed, damage, colour, floor) {
    this.projectiles.push({
      x: from[0], y: from[1], z: from[2],
      vx: dir[0] * speed, vy: dir[1] * speed, vz: dir[2] * speed,
      damage, size: 0.34, colour, owner: 'enemy', life: 4.5, pierce: 0, chain: 0,
      floor,
    });
  }

  /** Apply a weapon's element effects where it landed. */
  applyImpact(projectile, enemy, hooks) {
    const s = projectile.weapon;
    if (!s) return;
    // `nearby` is a flat 2D hash: it answers "what is near this x/z" across
    // every floor at once, because separation only ever asked within one floor
    // and filtered afterwards. Splash and chain forgot to filter, so a shell
    // bursting here also killed whatever stood at the same x/z five metres
    // below - and those kills counted toward the quota while their essence
    // dropped on a floor the player was not on to collect it.
    const floor = projectile.floor;
    const onThisFloor = (other) => floor === undefined || other.floor === floor;
    if (s.slow > 0 && enemy) enemy.slowUntil = this.clock + 1.6;
    if (s.burn > 0 && enemy) {
      enemy.burnUntil = this.clock + 2.6;
      enemy.burnDps = Math.max(enemy.burnDps, s.burn);
    }
    if (s.pull > 0 && enemy) {
      const dx = projectile.x - enemy.x;
      const dz = projectile.z - enemy.z;
      const len = Math.hypot(dx, dz) || 1;
      this.physics.move(enemy, (dx / len) * 0.3, (dz / len) * 0.3, enemy.type.radius, enemy.type.height);
    }
    if (s.blast > 0) {
      // The radius is baked in at fire time so the area stat reaches it; the
      // old `s.blast * (1 + 0)` was a placeholder that silently dropped it.
      const radius = projectile.blast > 0 ? projectile.blast : s.blast;
      for (const other of this.nearby(projectile.x, projectile.z, [])) {
        if (other === enemy || other.hp <= 0 || !onThisFloor(other)) continue;
        const d = Math.hypot(other.x - projectile.x, other.z - projectile.z);
        if (d > radius) continue;
        const push = [(other.x - projectile.x) / (d || 1), (other.z - projectile.z) / (d || 1)];
        this.hurt(other, projectile.damage * 0.6 * (1 - d / radius), push, hooks);
      }
      this.burst(projectile.x, projectile.y, projectile.z, s.trail || projectile.colour, 14);
      if (hooks.onBlast) hooks.onBlast(projectile, radius);
    }
    if (s.chain > 0 && enemy) {
      let remaining = s.chain;
      let from = enemy;
      const struck = new Set([enemy.id]);
      while (remaining > 0) {
        let next = null;
        for (const other of this.nearby(from.x, from.z, [])) {
          if (other.hp <= 0 || struck.has(other.id) || !onThisFloor(other)) continue;
          const d = Math.hypot(other.x - from.x, other.z - from.z);
          if (d > 4.5) continue;
          if (!next || d < next.d) next = { d, enemy: other };
        }
        if (!next) break;
        struck.add(next.enemy.id);
        this.arcs.push({
          from: [from.x, from.y + from.type.height * 0.5, from.z],
          to: [next.enemy.x, next.enemy.y + next.enemy.type.height * 0.5, next.enemy.z],
          colour: s.trail || projectile.colour, life: 0.13, floor: from.floor,
        });
        this.hurt(next.enemy, projectile.damage * 0.7, null, hooks);
        from = next.enemy;
        remaining -= 1;
      }
      if (hooks.onChain) hooks.onChain();
    }
  }

  /* ------------------------------ update ------------------------------- */

  update(dt, player, hooks) {
    this.clock += dt;
    let doorState = 0;
    for (let i = 0; i < this.physics.doors.length; i += 1) {
      if (this.physics.doors[i].open) doorState += 1 << (i % 30);
    }
    this.doorState = doorState;
    const playerFloor = this.physics.floorAt(player.y);
    this.flowAge -= dt;
    if (this.flowAge <= 0 || this.flowFloor !== playerFloor) {
      this.rebuildFlow(playerFloor, Math.floor(player.x / TILE_SIZE), Math.floor(player.z / TILE_SIZE));
      this.flowAge = 0.2;
    }
    this.rebuildGrid();

    let aggro = 0;
    const scratch = [];
    for (const enemy of this.enemies) {
      if (enemy.hp <= 0) continue;
      this.updateEnemy(enemy, dt, player, playerFloor, hooks, scratch);
      if (enemy.aggro && enemy.floor === playerFloor) aggro += 1;
    }
    this.aggroCount = aggro;
    this.enemies = this.enemies.filter((e) => e.hp > 0);
    this.reapAbandoned(playerFloor);

    this.updateProjectiles(dt, player, hooks);
    this.updateParticles(dt);
    this.updateMotes(dt, player, playerFloor, hooks);
    this.updatePickups(dt, player, playerFloor, hooks);
    for (const arc of this.arcs) arc.life -= dt;
    this.arcs = this.arcs.filter((a) => a.life > 0);
  }

  /**
   * Forget monsters the player has walked away from.
   *
   * The hard cap is a frame-time budget, not a design statement, and sleeping
   * enemies on floors the player already left were quietly consuming all of it:
   * the swarm would sit at the cap with two thirds of it asleep three floors up,
   * the spawner would find no room, and the floor you were actually standing on
   * would go silent. Nothing observable is lost - these are dormant, unseen, and
   * the spawner refills any floor you return to within seconds.
   */
  reapAbandoned(playerFloor) {
    const spare = [];
    for (let i = 0; i < this.enemies.length; i += 1) {
      const e = this.enemies[i];
      if (e.floor === playerFloor || e.type.boss) continue;
      spare.push(i);
    }
    if (spare.length <= OFF_FLOOR_BUDGET) return;
    // Oldest first: whatever has been abandoned longest is forgotten first.
    const doomed = new Set(spare.slice(0, spare.length - OFF_FLOOR_BUDGET));
    this.enemies = this.enemies.filter((_, i) => !doomed.has(i));
  }

  updateEnemy(enemy, dt, player, playerFloor, hooks, scratch) {
    const type = enemy.type;
    enemy.stateTime += dt;
    enemy.hurtFlash = Math.max(0, enemy.hurtFlash - dt);
    enemy.bob += dt * (enemy.state === 'chase' ? 9 : 3);

    if (enemy.burnUntil > this.clock) {
      if (this.hurt(enemy, enemy.burnDps * dt, null, hooks)) return;
    }

    const dx = player.x - enemy.x;
    const dz = player.z - enemy.z;
    const distance = Math.hypot(dx, dz);
    const sameFloor = enemy.floor === playerFloor;
    if (enemy.dormant) return;

    if (!enemy.aggro) {
      if (!sameFloor) return;
      // Sight wakes a monster instantly. Hearing wakes it slowly, and hearing is
      // what keeps the loop alive: your weapons never stop firing, so anything
      // sharing a room-and-a-half with you is coming whether it saw you or not.
      // Without this a player who holds one corner simply runs out of enemies.
      if (distance < (type.boss ? 30 : 26)) enemy.earshot = (enemy.earshot || 0) + dt;
      else enemy.earshot = 0;
      const seen = distance < (type.boss ? 26 : 20)
        && this.physics.rayClear([enemy.x, enemy.y + type.height * 0.6, enemy.z], [player.x, player.y + 1.4, player.z]);
      const noticed = seen || enemy.earshot > (type.boss ? 4 : 1.8);
      if (!noticed) return;
      enemy.aggro = true;
      enemy.state = 'chase';
      enemy.stateTime = 0;
      this.alert(enemy);
      if (type.boss && hooks.onBossWake) hooks.onBossWake(enemy);
      else if (hooks.onNotice) hooks.onNotice(enemy);
    }

    if (!sameFloor) { enemy.state = 'idle'; return; }
    enemy.facing = Math.atan2(dx, -dz);
    const inRange = distance <= type.range;
    const slowed = enemy.slowUntil > this.clock;

    switch (enemy.state) {
      case 'stagger':
        if (enemy.stateTime > 0.26) { enemy.state = 'chase'; enemy.stateTime = 0; }
        break;
      case 'windup':
        if (enemy.stateTime >= type.windup) {
          this.releaseAttack(enemy, player, hooks);
          enemy.state = 'recover';
          enemy.stateTime = 0;
        }
        break;
      case 'recover':
        if (enemy.stateTime >= type.recover) { enemy.state = 'chase'; enemy.stateTime = 0; }
        break;
      case 'chase':
      default: {
        const canSee = !type.ranged || this.physics.rayClear(
          [enemy.x, enemy.y + type.height * 0.6, enemy.z], [player.x, player.y + 1.4, player.z],
        );
        if (inRange && canSee) {
          enemy.state = 'windup';
          enemy.stateTime = 0;
          if (hooks.onWindup) hooks.onWindup(enemy);
          break;
        }
        const step = this.flowStep(enemy);
        let mx = 0;
        let mz = 0;
        if (step) {
          const len = Math.hypot(step[0], step[1]) || 1;
          mx = step[0] / len;
          mz = step[1] / len;
        } else if (distance > 0.01) {
          mx = dx / distance;
          mz = dz / distance;
        }
        // Separation, from the spatial hash rather than every pair.
        //
        // It is normalised and weighted *below* the chase vector on purpose. An
        // unbounded sum of push-apart forces beats the one unit vector pointing
        // at the player as soon as a body has four neighbours, and the horde
        // then jams into a static ring a few metres out and mills there. Keeping
        // separation a nudge means a crowd spreads sideways while still closing.
        let sx = 0;
        let sz = 0;
        this.nearby(enemy.x, enemy.z, scratch);
        for (const other of scratch) {
          if (other === enemy || other.hp <= 0 || other.floor !== enemy.floor) continue;
          const ox = enemy.x - other.x;
          const oz = enemy.z - other.z;
          const d = Math.hypot(ox, oz);
          const want = (type.radius + other.type.radius) * 1.05 + 0.1;
          if (d > 0.001 && d < want) {
            sx += (ox / d) * (want - d);
            sz += (oz / d) * (want - d);
          }
        }
        const sLen = Math.hypot(sx, sz);
        if (sLen > 1e-4) {
          mx += (sx / sLen) * 0.55;
          mz += (sz / sLen) * 0.55;
        }
        const len = Math.hypot(mx, mz) || 1;
        let speed = type.speed * (enemy.kind === 'wraith' && distance < 7 ? 1.3 : 1);
        if (slowed) speed *= 0.45;
        this.physics.move(enemy, (mx / len) * speed * dt, (mz / len) * speed * dt, type.radius, type.height);
        break;
      }
    }
  }

  releaseAttack(enemy, player, hooks) {
    const type = enemy.type;
    const eyeY = enemy.y + type.height * 0.62;
    const dx = player.x - enemy.x;
    const dy = (player.y + 1.35) - eyeY;
    const dz = player.z - enemy.z;
    const distance = Math.hypot(dx, dy, dz) || 1;

    if (type.ranged) {
      const dir = [dx / distance, dy / distance, dz / distance];
      const spreadCount = type.boss ? [-0.2, -0.07, 0.07, 0.2] : [0];
      for (const spread of spreadCount) {
        const cos = Math.cos(spread);
        const sin = Math.sin(spread);
        this.spawnEnemyProjectile(
          [enemy.x, eyeY, enemy.z],
          [dir[0] * cos - dir[2] * sin, dir[1], dir[0] * sin + dir[2] * cos],
          type.projectileSpeed, type.damage, type.eye, enemy.floor,
        );
      }
      if (hooks.onEnemyShoot) hooks.onEnemyShoot(enemy);
      return;
    }
    const reach = Math.hypot(player.x - enemy.x, player.z - enemy.z);
    if (reach <= type.range + 0.5 && hooks.onPlayerHit) hooks.onPlayerHit(type.damage, enemy);
    if (enemy.kind === 'wraith') {
      const len = Math.hypot(dx, dz) || 1;
      this.physics.move(enemy, (dx / len) * 0.5, (dz / len) * 0.5, type.radius, type.height);
    }
  }

  updateProjectiles(dt, player, hooks) {
    const alive = [];
    const scratch = [];
    for (const p of this.projectiles) {
      let dead = false;
      // Homing steers before the move, so the turn is visible.
      if (p.weapon && p.weapon.homing > 0) {
        const target = this.nearestTo(p.x, p.z, p.floor, 18);
        if (target) {
          const tx = target.x - p.x;
          const ty = (target.y + target.type.height * 0.5) - p.y;
          const tz = target.z - p.z;
          const len = Math.hypot(tx, ty, tz) || 1;
          const speed = Math.hypot(p.vx, p.vy, p.vz) || 1;
          const k = Math.min(1, p.weapon.homing * dt);
          p.vx += ((tx / len) * speed - p.vx) * k;
          p.vy += ((ty / len) * speed - p.vy) * k;
          p.vz += ((tz / len) * speed - p.vz) * k;
        }
      }

      const speed = Math.hypot(p.vx, p.vy, p.vz);
      const steps = Math.max(1, Math.ceil((speed * dt) / 0.32));
      for (let i = 0; i < steps && !dead; i += 1) {
        const from = [p.x, p.y, p.z];
        p.x += (p.vx * dt) / steps;
        p.y += (p.vy * dt) / steps;
        p.z += (p.vz * dt) / steps;
        if (!this.physics.rayClear(from, [p.x, p.y, p.z])) {
          this.burst(p.x, p.y, p.z, p.colour, 5);
          if (p.owner === 'player') this.applyImpact(p, null, hooks);
          if (hooks.onProjectileWall) hooks.onProjectileWall(p);
          dead = true;
          break;
        }
        if (p.owner === 'enemy') {
          if (p.floor !== undefined && p.floor !== this.physics.floorAt(player.y)) continue;
          const d = Math.hypot(p.x - player.x, p.y - (player.y + 1.0), p.z - player.z);
          if (d < 0.6) {
            if (hooks.onPlayerHit) hooks.onPlayerHit(p.damage, null);
            this.burst(p.x, p.y, p.z, p.colour, 7);
            dead = true;
            break;
          }
          continue;
        }
        // Player shot: check the enemies in this cell only.
        this.nearby(p.x, p.z, scratch);
        for (const enemy of scratch) {
          if (enemy.hp <= 0) continue;
          if (p.hits && p.hits.has(enemy.id)) continue;
          const girth = (enemy.type.radius + p.size) * enemy.scale;
          const dx = enemy.x - p.x;
          const dz = enemy.z - p.z;
          if (dx * dx + dz * dz > girth * girth) continue;
          const dy = (enemy.y + enemy.type.height * 0.5) - p.y;
          if (Math.abs(dy) > enemy.type.height * 0.75) continue;

          const isCrit = this.rng.next() < (p.crit || 0);
          const dealt = p.damage * (isCrit ? 2 : 1);
          const knock = [p.vx, p.vz];
          const klen = Math.hypot(knock[0], knock[1]) || 1;
          this.applyImpact(p, enemy, hooks);
          const killed = this.hurt(enemy, dealt, [knock[0] / klen, knock[1] / klen], hooks);
          this.burst(p.x, p.y, p.z, p.weapon ? p.weapon.trail : p.colour, isCrit ? 9 : 4);
          if (hooks.onHit) hooks.onHit(p, enemy, isCrit, killed);
          if (p.pierce > 0) {
            p.pierce -= 1;
            if (!p.hits) p.hits = new Set();
            p.hits.add(enemy.id);
          } else {
            dead = true;
          }
          break;
        }
      }
      p.life -= dt;
      if (!dead && p.life > 0) alive.push(p);
    }
    this.projectiles = alive;
  }

  updateParticles(dt) {
    const alive = [];
    for (const p of this.particles) {
      p.life -= dt;
      if (p.life <= 0) continue;
      p.vy -= 9.5 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      alive.push(p);
    }
    this.particles = alive.length > 640 ? alive.slice(-640) : alive;
  }

  /**
   * Essence motes. They arc out of a kill, then home in hard - collection has to
   * feel automatic, because the moment you are choosing whether to walk over a
   * reward is the moment the loop stops being about fighting.
   */
  updateMotes(dt, player, playerFloor, hooks) {
    const alive = [];
    const radius = 5.5 * (1 + (hooks.pickupBonus || 0));
    for (const m of this.motes) {
      m.age += dt;
      if (m.floor === playerFloor) {
        const dx = player.x - m.x;
        const dz = player.z - m.z;
        const dy = (player.y + 0.9) - m.y;
        const d = Math.hypot(dx, dz);
        const len = Math.hypot(dx, dy, dz) || 1;
        if (m.age > 0.35 && d < radius) {
          // Close: snap in hard, so collection feels like suction.
          const pull = 30;
          m.vx = (dx / len) * pull;
          m.vy = (dy / len) * pull;
          m.vz = (dz / len) * pull;
        } else if (m.age > 1.1) {
          // Far: drift home anyway. Nothing a kill earned is ever stranded on
          // the far side of the floor - the bar has to keep filling or the loop
          // stops being about fighting.
          const pull = 4.5;
          m.vx += ((dx / len) * pull - m.vx) * Math.min(1, dt * 2.2);
          m.vy += ((dy / len) * pull - m.vy) * Math.min(1, dt * 2.2);
          m.vz += ((dz / len) * pull - m.vz) * Math.min(1, dt * 2.2);
        } else {
          m.vy -= 11 * dt;
        }
        if (d < 0.9 && m.age > 0.2) {
          if (hooks.onEssence) hooks.onEssence(m.value);
          continue;
        }
      } else {
        m.vy -= 11 * dt;
      }
      m.x += m.vx * dt;
      m.y += m.vy * dt;
      m.z += m.vz * dt;
      if (m.y < -400) continue;
      alive.push(m);
    }
    this.motes = alive;
  }

  updatePickups(dt, player, playerFloor, hooks) {
    const alive = [];
    const radius = 2.8 * (1 + (hooks.pickupBonus || 0));
    for (const item of this.pickups) {
      item.bob += dt * 3;
      if (item.floor === playerFloor && Math.abs(item.y - player.y) < 2.2) {
        const d = Math.hypot(item.x - player.x, item.z - player.z);
        if (d < radius && d > 0.001) {
          const pull = Math.min(1, (radius - d) / radius) * 7 * dt;
          item.x += ((player.x - item.x) / d) * pull;
          item.z += ((player.z - item.z) / d) * pull;
        }
        if (d < 1.1 && hooks.onPickup && hooks.onPickup(item)) continue;
      }
      alive.push(item);
    }
    this.pickups = alive;
  }

  /* ---------------------------- rendering ------------------------------ */

  spriteList(orbits, floorIndex) {
    const frames = this.frames;
    const out = [];
    if (!frames) return out;
    // Everything on every floor used to be submitted every frame - roughly
    // 50% more sprites than could possibly be seen, and anything visible
    // through a stairwell opening showed a body standing in mid-air a storey
    // away.
    const visible = (thing) => floorIndex === undefined || thing.floor === undefined || thing.floor === floorIndex;

    for (const enemy of this.enemies) {
      if (enemy.hp <= 0 || !visible(enemy)) continue;
      const type = enemy.type;
      const winding = enemy.state === 'windup';
      const tell = winding ? Math.min(1, enemy.stateTime / type.windup) : 0;
      const step = Math.floor(enemy.bob / Math.PI) % 2 === 0 ? 0 : 1;
      const frame = frames.get(`${enemy.kind}${winding ? 2 : step}`) || frames.get(`${enemy.kind}0`);
      if (!frame) continue;
      const flash = enemy.hurtFlash > 0;
      const chilled = enemy.slowUntil > this.clock;
      const tint = flash ? [2.6, 2.4, 2.4]
        : chilled ? [0.62, 0.86, 1.25]
          : enemy.elite ? [1.35, 1.05, 0.75] : [1, 1, 1];
      const height = type.height * enemy.scale * (1 + tell * 0.12);
      const y = enemy.y + Math.sin(enemy.bob) * 0.03;
      const w = height * frame.aspect;
      out.push({ x: enemy.x, y, z: enemy.z, h: height, w, frame, tint, emissive: flash ? 0.7 : 0 });

      const glowName = winding && frames.has(`${enemy.kind}Glow2`) ? `${enemy.kind}Glow2` : `${enemy.kind}Glow`;
      const glow = frames.get(glowName);
      if (glow) {
        const heat = 1 + tell * 1.5 + (enemy.elite ? 0.5 : 0);
        out.push({
          x: enemy.x, y, z: enemy.z, h: height, w, frame: glow,
          tint: [heat, heat * 0.92, heat * 0.8], emissive: 1,
        });
      }
    }

    const shot = frames.get('shot');
    const shotHot = frames.get('shotHot');
    for (const p of this.projectiles) {
      const frame = p.owner === 'enemy' ? (shotHot || shot) : shot;
      if (!frame || !visible(p)) continue;
      const size = p.size * 2.2;
      out.push({
        x: p.x, y: p.y - size / 2, z: p.z, w: size, h: size, frame,
        tint: [p.colour[0] * 1.9, p.colour[1] * 1.9, p.colour[2] * 1.9], emissive: 1,
      });
    }

    for (const o of orbits || []) {
      const frame = frames.get('shot');
      if (!frame) continue;
      const size = o.size * 2.4;
      out.push({
        x: o.x, y: o.y - size / 2, z: o.z, w: size, h: size, frame,
        tint: [o.colour[0] * 1.9, o.colour[1] * 1.9, o.colour[2] * 1.9], emissive: 1,
      });
    }

    const spark = frames.get('spark');
    if (spark) {
      for (const p of this.particles) {
        const fade = Math.max(0, p.life / p.maxLife);
        const size = p.size * 3.2 * (0.35 + fade);
        out.push({
          x: p.x, y: p.y - size / 2, z: p.z, w: size, h: size, frame: spark,
          tint: [p.colour[0] * 1.7, p.colour[1] * 1.7, p.colour[2] * 1.7], emissive: fade,
        });
      }
      // Chain arcs, drawn as a line of sparks between the two bodies.
      for (const arc of this.arcs) {
        for (let i = 0; i <= 6; i += 1) {
          const t = i / 6;
          out.push({
            x: arc.from[0] + (arc.to[0] - arc.from[0]) * t,
            y: arc.from[1] + (arc.to[1] - arc.from[1]) * t,
            z: arc.from[2] + (arc.to[2] - arc.from[2]) * t,
            w: 0.22, h: 0.22, frame: spark,
            tint: [arc.colour[0] * 2.2, arc.colour[1] * 2.2, arc.colour[2] * 2.2], emissive: 1,
          });
        }
      }
    }

    const moteFrame = frames.get('mote');
    if (moteFrame) {
      for (const m of this.motes) {
        out.push({
          x: m.x, y: m.y, z: m.z, w: 0.26, h: 0.26, frame: moteFrame,
          tint: [1.4, 1.4, 1.6], emissive: 1,
        });
      }
    }

    for (const item of this.pickups) {
      const frame = frames.get(item.kind === 'health' ? 'health' : 'energy');
      if (!frame) continue;
      const lift = 0.35 + Math.sin(item.bob) * 0.10;
      out.push({ x: item.x, y: item.y + lift, z: item.z, w: 0.5, h: 0.5, frame, tint: [1, 1, 1], emissive: 0.85 });
    }

    return out;
  }

  /**
   * The dynamic lights this frame, on the player's floor, rationed by category.
   *
   * The renderer keeps eight slots and fills them with whatever is nearest. An
   * unbudgeted category therefore does not just take its share, it takes the
   * lot: with ninety monsters on a floor there are dozens of wind-up glows a
   * couple of metres away, and they evicted every one of the seventy-odd
   * torches within range. The authored lighting of the room simply switched off
   * whenever a crowd formed, and the place was lit by monster eyes instead.
   *
   * So each category gets a cap and, within it, the nearest ones win. Together
   * they can claim at most half the slots, which leaves the room's own light
   * still doing the work.
   */
  lights(floorIndex, player) {
    const out = [];
    const px = player ? player.x : 0;
    const pz = player ? player.z : 0;
    const onFloor = (thing) => floorIndex === undefined || thing.floor === undefined || thing.floor === floorIndex;
    const nearest = (list, cap, toLight) => {
      const scored = [];
      for (const item of list) {
        if (!onFloor(item)) continue;
        scored.push({ item, d: (item.x - px) ** 2 + (item.z - pz) ** 2 });
      }
      scored.sort((a, b) => a.d - b.d);
      for (let i = 0; i < Math.min(cap, scored.length); i += 1) out.push(toLight(scored[i].item));
      return out;
    };

    nearest(this.projectiles, 2, (p) => ({ pos: [p.x, p.y, p.z], colour: p.colour, intensity: 0.85 }));
    nearest(this.pickups, 1, (item) => ({
      pos: [item.x, item.y + 0.5, item.z],
      colour: item.kind === 'health' ? rgb('blood', 3) : rgb('ice', 3),
      intensity: 0.5,
    }));
    nearest(
      this.enemies.filter((e) => e.state === 'windup' && e.hp > 0), 2,
      (e) => ({ pos: [e.x, e.y + e.type.height * 0.8, e.z], colour: e.type.eye, intensity: 1.2 }),
    );
    // Arcs are a handful of frames long and are the clearest read on a chain
    // firing, so they are not rationed - but they are still floor-bound.
    for (const arc of this.arcs) {
      if (floorIndex !== undefined && arc.floor !== undefined && arc.floor !== floorIndex) continue;
      out.push({ pos: arc.to, colour: arc.colour, intensity: 1.6 });
    }
    return out;
  }

  aliveOnFloor(floorIndex) {
    let n = 0;
    for (const e of this.enemies) if (e.hp > 0 && e.floor === floorIndex) n += 1;
    return n;
  }
}
