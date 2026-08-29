/**
 * Enemies, projectiles, pickups and particles.
 *
 * Enemy navigation uses a flow field: a breadth-first sweep out from the
 * player's tile over the floor they are on, recomputed a few times a second.
 * Every enemy then just walks downhill. One sweep serves the whole floor, so a
 * roomful of monsters costs about the same as one.
 */

import { TILE_SIZE, DIRS } from './grid.js';
import { ROOM_TYPE } from './generator.js';

export const ENEMY_TYPES = {
  crawler: {
    name: 'Crawler',
    hp: 26, speed: 3.8, radius: 0.34, height: 1.05,
    damage: 8, range: 1.5, windup: 0.34, recover: 0.55,
    ranged: false, score: 100,
    body: [0.30, 0.30, 0.42], colour: [0.42, 0.78, 0.40], eye: [0.85, 1.0, 0.45],
  },
  sentinel: {
    name: 'Sentinel',
    hp: 78, speed: 1.45, radius: 0.48, height: 1.85,
    damage: 11, range: 16, windup: 0.75, recover: 1.5,
    ranged: true, projectileSpeed: 12, score: 250,
    body: [0.40, 0.62, 0.40], colour: [0.86, 0.62, 0.24], eye: [1.0, 0.85, 0.35],
  },
  wraith: {
    name: 'Wraith',
    hp: 44, speed: 2.5, radius: 0.36, height: 1.6,
    damage: 15, range: 1.8, windup: 0.48, recover: 0.9,
    ranged: false, lunge: 9.5, score: 180,
    body: [0.32, 0.55, 0.32], colour: [0.62, 0.42, 0.88], eye: [0.85, 0.6, 1.0],
  },
  warden: {
    name: 'The Warden',
    hp: 620, speed: 1.7, radius: 0.95, height: 3.0,
    damage: 17, range: 20, windup: 0.95, recover: 1.5,
    ranged: true, projectileSpeed: 11, score: 5000, boss: true,
    body: [0.85, 1.05, 0.85], colour: [0.80, 0.22, 0.24], eye: [1.0, 0.75, 0.35],
  },
};

/** How many monsters a floor gets, and of what kind. */
function budgetFor(depth) {
  return {
    count: 7 + depth * 4,
    weights: [
      ['crawler', Math.max(1, 6 - depth)],
      ['sentinel', 1 + depth],
      ['wraith', depth],
    ],
  };
}

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
    this.flow = new Map();
    this.flowAge = 0;
    this.flowFloor = -1;
    this.aggroCount = 0;
    this.boss = null;
  }

  /* ------------------------------ spawning ----------------------------- */

  populate() {
    const startRoom = this.dungeon.roomsById.get(this.dungeon.start);
    for (const plan of this.dungeon.floors) {
      const budget = budgetFor(plan.index);
      const rooms = plan.rooms.filter((r) => r.id !== startRoom.id && r.id !== this.dungeon.goal);
      if (!rooms.length) continue;
      let placed = 0;
      let guard = 0;
      while (placed < budget.count && guard < budget.count * 12) {
        guard += 1;
        const room = this.rng.pick(rooms);
        const kind = this.pickKind(budget.weights);
        const spot = this.freeTileIn(plan, room);
        if (!spot) continue;
        if (this.spawn(kind, plan, spot[0], spot[1])) placed += 1;
      }
      // Every floor keeps a couple of health caches so exploring pays.
      for (const room of rooms) {
        if (room.type !== ROOM_TYPE.VAULT && room.type !== ROOM_TYPE.SHRINE) continue;
        const spot = this.freeTileIn(plan, room);
        if (spot) this.addPickup(room.type === ROOM_TYPE.VAULT ? 'health' : 'energy', plan, spot[0], spot[1], 40);
      }
    }
    // The boss waits in the deepest chamber, with supplies around the edges so
    // the fight is a battle of attrition rather than one unlucky volley.
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

  pickKind(weights) {
    const total = weights.reduce((sum, [, w]) => sum + w, 0);
    let roll = this.rng.next() * total;
    for (const [kind, w] of weights) {
      roll -= w;
      if (roll <= 0) return kind;
    }
    return weights[0][0];
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

  spawn(kind, plan, tileX, tileZ) {
    const type = ENEMY_TYPES[kind];
    const world = plan.worldOf(tileX, tileZ);
    const y = this.physics.canOccupy(world[0], world[2], world[1], world[1], type.radius, type.height);
    if (y === null) return null;
    const enemy = {
      id: nextId++,
      kind,
      type,
      x: world[0], y, z: world[2],
      floor: plan.index,
      hp: type.hp,
      maxHp: type.hp,
      state: 'idle',
      stateTime: 0,
      facing: this.rng.next() * Math.PI * 2,
      hurtFlash: 0,
      bob: this.rng.next() * 6.28,
      aggro: false,
      dormant: false,
      phase: 0,
    };
    this.enemies.push(enemy);
    return enemy;
  }

  addPickup(kind, plan, tileX, tileZ, amount) {
    const world = plan.worldOf(tileX, tileZ);
    const y = this.physics.canOccupy(world[0], world[2], world[1], world[1], 0.2, 0.5);
    if (y === null) return;
    this.pickups.push({
      kind, amount, floor: plan.index, x: world[0], y, z: world[2], bob: Math.random() * 6.28,
    });
  }

  dropLoot(enemy) {
    // Kills feed the loop: most drop something small, so pushing forward is
    // usually better than retreating.
    const roll = this.rng.next();
    const plan = this.dungeon.floors[enemy.floor];
    if (roll < 0.34) {
      this.pickups.push({ kind: 'health', amount: 12, floor: enemy.floor, x: enemy.x, y: enemy.y, z: enemy.z, bob: 0 });
    } else if (roll < 0.72) {
      this.pickups.push({ kind: 'energy', amount: 24, floor: enemy.floor, x: enemy.x, y: enemy.y, z: enemy.z, bob: 0 });
    }
    void plan;
  }

  /* ---------------------------- flow field ----------------------------- */

  /** Breadth-first distances to the player over one floor's walkable tiles. */
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
    if (!plan.walkable(tileX, tileZ)) {
      // The player may be standing on a stair tower; seed from a walkable neighbour.
      const near = DIRS.map((d) => [tileX + d.dx, tileZ + d.dz]).find(([x, z]) => plan.walkable(x, z));
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
        if (!plan.walkable(nx, nz)) continue;
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
    for (const d of DIRS) {
      const nx = tx + d.dx;
      const nz = tz + d.dz;
      if (!plan.inside(nx, nz) || !plan.walkable(nx, nz)) continue;
      const value = field[nz * plan.width + nx];
      if (value < 0) continue;
      if (!best || value < best.value) best = { value, x: nx, z: nz };
    }
    if (!best) return null;
    const target = plan.worldOf(best.x, best.z);
    return [target[0] - enemy.x, target[2] - enemy.z];
  }

  /* ------------------------------ combat ------------------------------- */

  /** First enemy a shot meets, or null. Walls are checked by the caller. */
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
      const girth = Math.max(enemy.type.radius, enemy.type.height * 0.3);
      if (perp > girth) continue;
      if (!hit || along < hit.distance) hit = { enemy, distance: along };
    }
    return hit;
  }

  /** Wake everything near a disturbance, so encounters grow instead of queueing. */
  alert(source, radius = 9) {
    for (const other of this.enemies) {
      if (other === source || other.hp <= 0 || other.aggro || other.dormant) continue;
      if (other.floor !== source.floor) continue;
      if (Math.hypot(other.x - source.x, other.z - source.z) > radius) continue;
      other.aggro = true;
      other.state = 'chase';
      other.stateTime = 0;
    }
  }

  hurt(enemy, amount, knockDir, onKill) {
    if (enemy.hp <= 0) return false;
    const wasCalm = !enemy.aggro;
    enemy.hp -= amount;
    enemy.hurtFlash = 0.18;
    enemy.aggro = true;
    enemy.dormant = false;
    if (wasCalm) this.alert(enemy);
    if (knockDir) {
      const push = enemy.type.boss ? 0.06 : 0.32;
      this.physics.move(enemy, knockDir[0] * push, knockDir[1] * push, enemy.type.radius, enemy.type.height);
    }
    if (enemy.hp <= 0) {
      enemy.state = 'dead';
      this.burst(enemy.x, enemy.y + enemy.type.height * 0.5, enemy.z, enemy.type.colour, enemy.type.boss ? 46 : 16);
      this.dropLoot(enemy);
      if (onKill) onKill(enemy);
      return true;
    }
    // Getting hit interrupts a wind-up, which rewards aggressive play.
    if (enemy.state === 'windup' && !enemy.type.boss) {
      enemy.state = 'stagger';
      enemy.stateTime = 0;
    }
    return false;
  }

  burst(x, y, z, colour, count) {
    for (let i = 0; i < count; i += 1) {
      const a = Math.random() * Math.PI * 2;
      const p = Math.random() * Math.PI - Math.PI / 2;
      const speed = 1.6 + Math.random() * 4.5;
      this.particles.push({
        x, y, z,
        vx: Math.cos(a) * Math.cos(p) * speed,
        vy: Math.sin(p) * speed + 1.6,
        vz: Math.sin(a) * Math.cos(p) * speed,
        life: 0.35 + Math.random() * 0.5,
        maxLife: 0.85,
        colour,
        size: 0.05 + Math.random() * 0.07,
      });
    }
  }

  spawnProjectile(from, dir, speed, damage, colour, owner) {
    this.projectiles.push({
      x: from[0], y: from[1], z: from[2],
      vx: dir[0] * speed, vy: dir[1] * speed, vz: dir[2] * speed,
      damage, colour, owner, life: 4.5,
    });
  }

  /* ------------------------------ update ------------------------------- */

  update(dt, player, hooks) {
    const playerFloor = this.physics.floorAt(player.y);
    this.flowAge -= dt;
    if (this.flowAge <= 0 || this.flowFloor !== playerFloor) {
      this.rebuildFlow(playerFloor, Math.floor(player.x / TILE_SIZE), Math.floor(player.z / TILE_SIZE));
      this.flowAge = 0.22;
    }

    let aggro = 0;
    for (const enemy of this.enemies) {
      if (enemy.hp <= 0) continue;
      this.updateEnemy(enemy, dt, player, playerFloor, hooks);
      if (enemy.aggro) aggro += 1;
    }
    this.aggroCount = aggro;
    this.enemies = this.enemies.filter((e) => e.hp > 0);

    this.updateProjectiles(dt, player, hooks);
    this.updateParticles(dt);
    this.updatePickups(dt, player, playerFloor, hooks);
  }

  updateEnemy(enemy, dt, player, playerFloor, hooks) {
    const type = enemy.type;
    enemy.stateTime += dt;
    enemy.hurtFlash = Math.max(0, enemy.hurtFlash - dt);
    enemy.bob += dt * (enemy.state === 'chase' ? 9 : 3);

    const dx = player.x - enemy.x;
    const dz = player.z - enemy.z;
    const distance = Math.hypot(dx, dz);
    const sameFloor = enemy.floor === playerFloor;

    // Dormant monsters (the boss before its door opens) do nothing at all.
    if (enemy.dormant) return;

    if (!enemy.aggro) {
      if (!sameFloor) return;
      const noticed = distance < (type.boss ? 26 : 19)
        && this.physics.rayClear([enemy.x, enemy.y + type.height * 0.6, enemy.z], [player.x, player.y + 1.4, player.z]);
      if (!noticed) return;
      enemy.aggro = true;
      enemy.state = 'chase';
      enemy.stateTime = 0;
      this.alert(enemy);
      if (type.boss && hooks.onBossWake) hooks.onBossWake(enemy);
      else if (hooks.onNotice) hooks.onNotice(enemy);
    }

    if (!sameFloor) {
      // Lost the player down a staircase: mill about rather than pathing blind.
      enemy.state = 'idle';
      return;
    }

    enemy.facing = Math.atan2(dx, -dz);
    const inRange = distance <= type.range;
    const canSee = this.physics.rayClear(
      [enemy.x, enemy.y + type.height * 0.6, enemy.z],
      [player.x, player.y + 1.4, player.z],
    );

    switch (enemy.state) {
      case 'stagger':
        if (enemy.stateTime > 0.28) { enemy.state = 'chase'; enemy.stateTime = 0; }
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
        // Keep the swarm from collapsing into one square.
        for (const other of this.enemies) {
          if (other === enemy || other.hp <= 0 || other.floor !== enemy.floor) continue;
          const ox = enemy.x - other.x;
          const oz = enemy.z - other.z;
          const d = Math.hypot(ox, oz);
          const want = type.radius + other.type.radius + 0.14;
          if (d > 0.001 && d < want) {
            mx += (ox / d) * (want - d) * 1.7;
            mz += (oz / d) * (want - d) * 1.7;
          }
        }
        const len = Math.hypot(mx, mz) || 1;
        const speed = type.speed * (enemy.kind === 'wraith' && distance < 7 ? 1.35 : 1);
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
      if (type.boss) {
        // The Warden fires a spread, so strafing alone will not save you.
        for (const spread of [-0.16, 0, 0.16]) {
          const cos = Math.cos(spread);
          const sin = Math.sin(spread);
          this.spawnProjectile(
            [enemy.x, eyeY, enemy.z],
            [dir[0] * cos - dir[2] * sin, dir[1], dir[0] * sin + dir[2] * cos],
            type.projectileSpeed, type.damage, type.eye, 'enemy',
          );
        }
      } else {
        this.spawnProjectile([enemy.x, eyeY, enemy.z], dir, type.projectileSpeed, type.damage, type.eye, 'enemy');
      }
      if (hooks.onEnemyShoot) hooks.onEnemyShoot(enemy);
      return;
    }

    // Melee only lands if the player is still there when the swing arrives.
    const reach = Math.hypot(player.x - enemy.x, player.z - enemy.z);
    if (reach <= type.range + 0.5 && hooks.onPlayerHit) {
      hooks.onPlayerHit(type.damage, enemy);
    }
    if (enemy.kind === 'wraith') {
      const len = Math.hypot(dx, dz) || 1;
      this.physics.move(enemy, (dx / len) * 0.5, (dz / len) * 0.5, type.radius, type.height);
    }
  }

  updateProjectiles(dt, player, hooks) {
    const alive = [];
    for (const p of this.projectiles) {
      const steps = Math.max(1, Math.ceil((Math.hypot(p.vx, p.vy, p.vz) * dt) / 0.28));
      let dead = false;
      for (let i = 0; i < steps && !dead; i += 1) {
        const from = [p.x, p.y, p.z];
        p.x += (p.vx * dt) / steps;
        p.y += (p.vy * dt) / steps;
        p.z += (p.vz * dt) / steps;
        if (!this.physics.rayClear(from, [p.x, p.y, p.z])) {
          this.burst(p.x, p.y, p.z, p.colour, 7);
          if (hooks.onProjectileWall) hooks.onProjectileWall(p);
          dead = true;
          break;
        }
        if (p.owner === 'enemy') {
          const d = Math.hypot(p.x - player.x, p.y - (player.y + 1.0), p.z - player.z);
          if (d < 0.62) {
            if (hooks.onPlayerHit) hooks.onPlayerHit(p.damage, null);
            this.burst(p.x, p.y, p.z, p.colour, 9);
            dead = true;
            break;
          }
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
    this.particles = alive.slice(-420);
  }

  updatePickups(dt, player, playerFloor, hooks) {
    const alive = [];
    for (const item of this.pickups) {
      item.bob += dt * 3;
      if (item.floor === playerFloor && Math.abs(item.y - player.y) < 2.2) {
        const d = Math.hypot(item.x - player.x, item.z - player.z);
        // Drift toward the player once they are near. A reward you have to walk
        // exactly over is a reward most players never actually get.
        if (d < 2.8 && d > 0.001) {
          const pull = Math.min(1, (2.8 - d) / 2.8) * 6 * dt;
          item.x += ((player.x - item.x) / d) * pull;
          item.z += ((player.z - item.z) / d) * pull;
        }
        if (d < 1.1) {
          if (hooks.onPickup && hooks.onPickup(item)) continue;
        }
      }
      alive.push(item);
    }
    this.pickups = alive;
  }

  /* ---------------------------- rendering ------------------------------ */

  /** The atlas lookup, handed over once the renderer has built it. */
  setFrames(frames) {
    this.frames = frames;
  }

  /**
   * Billboard descriptors for everything alive.
   *
   * Enemies pick a walk frame from their bob and switch to the attack pose while
   * winding up; the tint carries the hurt flash and the wind-up glow, so one set
   * of art covers every state.
   */
  spriteList() {
    const frames = this.frames;
    const out = [];
    if (!frames) return out;

    for (const enemy of this.enemies) {
      if (enemy.hp <= 0) continue;
      const type = enemy.type;
      const winding = enemy.state === 'windup';
      const tell = winding ? Math.min(1, enemy.stateTime / type.windup) : 0;
      const step = Math.floor(enemy.bob / Math.PI) % 2 === 0 ? 0 : 1;
      const frame = frames.get(`${enemy.kind}${winding ? 2 : step}`) || frames.get(`${enemy.kind}0`);
      if (!frame) continue;
      const flash = enemy.hurtFlash > 0;
      const tint = flash
        ? [2.4, 2.2, 2.2]
        : [1 + tell * 1.1, 1 - tell * 0.25, 1 - tell * 0.35];
      // Swelling on the wind-up reads even in peripheral vision.
      const height = type.height * (1 + tell * 0.12);
      out.push({
        x: enemy.x,
        y: enemy.y + Math.sin(enemy.bob) * 0.03,
        z: enemy.z,
        h: height,
        w: height * frame.aspect,
        frame,
        tint,
        emissive: flash ? 0.75 : tell * 0.45,
      });
    }

    const shot = frames.get('shot');
    const shotHot = frames.get('shotHot');
    for (const p of this.projectiles) {
      const frame = p.damage > 15 ? (shotHot || shot) : shot;
      if (!frame) continue;
      out.push({ x: p.x, y: p.y - 0.2, z: p.z, w: 0.42, h: 0.42, frame, tint: [1, 1, 1], emissive: 1 });
    }

    const spark = frames.get('spark');
    if (spark) {
      for (const p of this.particles) {
        const fade = Math.max(0, p.life / p.maxLife);
        const size = p.size * 3.2 * (0.35 + fade);
        out.push({
          x: p.x, y: p.y - size / 2, z: p.z, w: size, h: size,
          frame: spark,
          tint: [p.colour[0] * 1.6, p.colour[1] * 1.6, p.colour[2] * 1.6],
          emissive: fade,
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

  /** Light sources the renderer should consider this frame. */
  lights() {
    const out = [];
    for (const p of this.projectiles) {
      out.push({ pos: [p.x, p.y, p.z], colour: p.colour, intensity: 0.9 });
    }
    for (const item of this.pickups) {
      const colour = item.kind === 'health' ? [1.0, 0.32, 0.38] : [0.35, 0.85, 1.0];
      out.push({ pos: [item.x, item.y + 0.5, item.z], colour, intensity: 0.5 });
    }
    for (const enemy of this.enemies) {
      if (enemy.state !== 'windup' || enemy.hp <= 0) continue;
      out.push({ pos: [enemy.x, enemy.y + enemy.type.height * 0.8, enemy.z], colour: enemy.type.eye, intensity: 1.1 });
    }
    return out;
  }

  aliveOnFloor(floorIndex) {
    return this.enemies.filter((e) => e.hp > 0 && e.floor === floorIndex).length;
  }
}
