/**
 * Application layer: input, game rules and the diagnostic panels.
 */

import { generateDungeon, ROOM_TYPE } from './generator.js';
import { compileDungeon, Box } from './compiler.js';
import { DungeonPhysics } from './physics.js';
import { validateDungeon } from './validate.js';
import { Renderer } from './renderer.js';
import { AutoMap } from './minimap.js';
import { buildRoute } from './route.js';
import { TILE_SIZE } from './grid.js';

const MOVE_CODES = new Set([
  'KeyW', 'KeyA', 'KeyS', 'KeyD',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'ShiftLeft', 'ShiftRight',
]);

const ROOM_LABEL = {
  [ROOM_TYPE.ENTRANCE]: 'Entrance hall',
  [ROOM_TYPE.BOSS]: 'Throne of the deep',
  [ROOM_TYPE.VAULT]: 'Vault',
  [ROOM_TYPE.SHRINE]: 'Shrine',
  [ROOM_TYPE.LIBRARY]: 'Scriptorium',
  [ROOM_TYPE.BARRACKS]: 'Barracks',
  [ROOM_TYPE.CISTERN]: 'Cistern',
  [ROOM_TYPE.CRYPT]: 'Crypt',
  [ROOM_TYPE.HALL]: 'Pillared hall',
  [ROOM_TYPE.CHAMBER]: 'Chamber',
};

export class DungeonApp {
  constructor() {
    this.seedInput = document.getElementById('seed');
    this.checksEl = document.getElementById('checks');
    this.logEl = document.getElementById('log');
    this.statusEl = document.getElementById('status');
    this.hudEl = document.getElementById('hud');
    this.objectiveEl = document.getElementById('objective');
    this.crosshair = document.getElementById('cross');
    this.canvas = document.getElementById('gl');

    this.renderer = new Renderer(this.canvas);
    this.map = new AutoMap(document.getElementById('map'));

    this.player = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, eye: 1.62 };
    this.keys = new Set();
    this.held = new Set();
    this.pointerLocked = false;
    this.dragging = false;
    this.orbitDrag = false;
    this.lastMouse = [0, 0];
    this.sensitivity = 0.0018;
    this.invertY = false;
    this.showRoute = false;
    this.auto = null;
    this.lastFrame = performance.now();
    this.accumulator = 0;
    this.stepSeconds = 1 / 120;
    this.reachedGoal = false;

    this.bindUI();
    this.bindInput();
    window.addEventListener('resize', () => this.renderer.resize());
    this.generate();
    requestAnimationFrame((t) => this.frame(t));
  }

  bindUI() {
    document.getElementById('regen').onclick = () => this.generate();
    document.getElementById('reroll').onclick = () => {
      this.seedInput.value = String(Math.floor(Math.random() * 1e6));
      this.generate();
    };
    document.getElementById('mode').onclick = () => this.toggleMode();
    document.getElementById('solution').onclick = () => {
      this.showRoute = !this.showRoute;
      this.refreshOverlay();
    };
    document.getElementById('autowalk').onclick = () => this.startAuto();
    document.getElementById('validate').onclick = () => this.runValidation(true);
    const sens = document.getElementById('sensitivity');
    sens.oninput = () => { this.sensitivity = 0.0018 * Number(sens.value); };
    const invert = document.getElementById('invertY');
    invert.onchange = () => { this.invertY = invert.checked; };
  }

  bindInput() {
    const clear = () => this.keys.clear();
    this.canvas.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      this.lastMouse = [e.clientX, e.clientY];
      if (this.renderer.mode === 'fps') {
        this.dragging = true;
        if (document.pointerLockElement !== this.canvas) this.canvas.requestPointerLock?.();
      } else {
        this.orbitDrag = true;
      }
    });
    window.addEventListener('mouseup', () => { this.dragging = false; this.orbitDrag = false; });
    window.addEventListener('blur', clear);
    document.addEventListener('visibilitychange', () => { if (document.hidden) clear(); });
    document.addEventListener('pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement === this.canvas;
      if (!this.pointerLocked) clear();
      this.updateHud();
    });

    window.addEventListener('mousemove', (e) => {
      if (this.renderer.mode === 'fps') {
        if (this.pointerLocked) this.look(e.movementX, e.movementY);
        else if (this.dragging) {
          this.look(e.clientX - this.lastMouse[0], e.clientY - this.lastMouse[1]);
          this.lastMouse = [e.clientX, e.clientY];
        }
      } else if (this.orbitDrag) {
        const o = this.renderer.orbit;
        o.yaw -= (e.clientX - this.lastMouse[0]) * 0.007;
        o.pitch = Math.max(0.12, Math.min(1.45, o.pitch + (e.clientY - this.lastMouse[1]) * 0.007));
        this.lastMouse = [e.clientX, e.clientY];
      }
    });

    this.canvas.addEventListener('wheel', (e) => {
      if (this.renderer.mode !== 'debug') return;
      e.preventDefault();
      const o = this.renderer.orbit;
      o.distance = Math.max(18, Math.min(220, o.distance * Math.exp(e.deltaY * 0.001)));
    }, { passive: false });

    window.addEventListener('keydown', (e) => {
      if (['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target?.tagName) && !this.pointerLocked) return;
      if (e.code === 'KeyM') { e.preventDefault(); this.toggleMode(); return; }
      if (MOVE_CODES.has(e.code)) {
        this.keys.add(e.code);
        if (this.auto) { this.auto = null; this.log('Auto-walk cancelled: manual control resumed.'); }
        if (this.renderer.mode === 'fps') e.preventDefault();
      }
    }, { passive: false });
    window.addEventListener('keyup', (e) => {
      if (MOVE_CODES.has(e.code)) this.keys.delete(e.code);
    });
  }

  look(dx, dy) {
    this.player.yaw += dx * this.sensitivity;
    if (this.player.yaw > Math.PI) this.player.yaw -= Math.PI * 2;
    else if (this.player.yaw < -Math.PI) this.player.yaw += Math.PI * 2;
    const sign = this.invertY ? 1 : -1;
    this.player.pitch = Math.max(-1.25, Math.min(1.25, this.player.pitch + dy * this.sensitivity * 0.9 * sign));
  }

  generate() {
    const seed = Number(this.seedInput.value) || 1;
    try {
      this.dungeon = generateDungeon(seed);
      this.compiled = compileDungeon(this.dungeon);
      this.physics = new DungeonPhysics(this.dungeon, this.compiled);
      this.renderer.setDungeon(this.dungeon, this.compiled);
      this.map.reset(this.dungeon);
      this.route = buildRoute(this.dungeon, this.dungeon.links);

      const start = this.dungeon.roomsById.get(this.dungeon.start);
      const plan = this.dungeon.floors[start.floor];
      const spawn = plan.worldOf(start.cx, start.cz);
      this.player.x = spawn[0];
      this.player.z = spawn[2];
      this.player.y = this.physics.canOccupy(spawn[0], spawn[2], spawn[1]) ?? plan.elevation;
      this.player.pitch = 0;
      // Face the first leg of the route, so the way on is in front of you.
      this.player.yaw = 0;
      if (this.route) {
        for (const point of this.route) {
          const dx = point[0] - this.player.x;
          const dz = point[2] - this.player.z;
          if (Math.hypot(dx, dz) > 1.2) { this.player.yaw = Math.atan2(dx, -dz); break; }
        }
      }

      this.held.clear();
      this.keys.clear();
      this.auto = null;
      this.showRoute = false;
      this.reachedGoal = false;
      this.accumulator = 0;
      for (const prop of this.dungeon.props) prop.taken = false;
      for (const door of this.compiled.doors) door.open = false;
      this.refreshOverlay();
      this.runValidation(false);
      this.logSummary();
    } catch (err) {
      this.log(`GENERATION ERROR\n${err.stack || err.message}`);
    }
  }

  logSummary() {
    const d = this.dungeon;
    const perFloor = d.floors.map((f) => `  depth ${f.index + 1}: ${f.rooms.length} rooms · ${f.theme.name}`).join('\n');
    const lockLines = d.locks.length
      ? d.locks.map((l) => `  ${l.name} key → guarded door (key in room ${l.keyRoom})`).join('\n')
      : '  none';
    this.log([
      `Seed ${d.seed}`,
      `${d.floorCount} floors · ${d.rooms.length} rooms · ${d.links.length} connections · ${d.stairs.length} stair towers`,
      `Tile grid ${d.width}×${d.height} per floor (${(d.width * TILE_SIZE).toFixed(0)}m across)`,
      '',
      'Floors:',
      perFloor,
      '',
      'Locks:',
      lockLines,
      '',
      `Geometry: ${this.compiled.boxes.length} boxes · ${this.dungeon.lights.length} light sources`,
      `Objective: reach the ${ROOM_LABEL[ROOM_TYPE.BOSS]} on depth ${d.roomsById.get(d.goal).floor + 1}.`,
    ].join('\n'));
  }

  runValidation(verbose) {
    const result = validateDungeon(this.dungeon, this.physics, this.compiled);
    this.validation = result;
    this.checksEl.innerHTML = result.checks
      .map((c) => `<div>${c.name}${c.detail ? ` <span class="muted">(${c.detail})</span>` : ''}</div><span class="pill ${c.ok ? 'pass' : 'fail'}">${c.ok ? 'PASS' : 'FAIL'}</span>`)
      .join('');
    this.statusEl.textContent = `${this.dungeon.rooms.length} rooms · ${result.reachedRooms}/${result.totalRooms} physically reachable · `
      + `${this.dungeon.stairs.length} stair towers · ${this.dungeon.locks.length} locked doors · `
      + `dungeon ${result.passed ? 'VALID' : 'BROKEN'}`;
    if (verbose) {
      const lines = result.checks.map((c) => `${c.ok ? 'PASS' : 'FAIL'}  ${c.name}${c.detail ? ` — ${c.detail}` : ''}`);
      lines.push('', `walk samples: ${result.walkNodes}`);
      if (result.unreached.length) {
        lines.push('', 'unreachable rooms:');
        for (const r of result.unreached) lines.push(`  room ${r.id} on depth ${r.floor + 1} (${r.type})`);
      }
      for (const p of result.stairProblems) lines.push(`stair: ${p}`);
      for (const p of result.lockProblems) lines.push(`lock: ${p}`);
      this.log(lines.join('\n'));
    }
    return result;
  }

  refreshOverlay() {
    const boxes = [];
    for (const door of this.compiled.doors) {
      if (!door.open) boxes.push(door.box);
    }
    if (this.showRoute && this.route) {
      for (let i = 0; i < this.route.length - 1; i += 1) {
        const a = this.route[i];
        const b = this.route[i + 1];
        const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
        const steps = Math.max(1, Math.ceil(len / 0.4));
        for (let j = 0; j <= steps; j += 1) {
          const t = j / steps;
          boxes.push(new Box(
            a[0] + (b[0] - a[0]) * t,
            a[1] + (b[1] - a[1]) * t + 0.12,
            a[2] + (b[2] - a[2]) * t,
            0.06, 0.06, 0.06,
            [0.25, 0.95, 0.5], 'route', 1.0,
          ));
        }
      }
    }
    this.renderer.setOverlay(boxes);
  }

  toggleMode() {
    this.keys.clear();
    this.auto = null;
    this.renderer.mode = this.renderer.mode === 'fps' ? 'debug' : 'fps';
    document.getElementById('mode').textContent = this.renderer.mode === 'fps' ? 'Cutaway view' : 'First person';
    this.crosshair.style.display = this.renderer.mode === 'fps' ? 'block' : 'none';
    if (this.renderer.mode !== 'fps') document.exitPointerLock?.();
    this.updateHud();
  }

  startAuto() {
    if (!this.route) { this.log('Auto-walk refused: no route to the goal.'); return; }
    this.keys.clear();
    this.auto = { index: 0, t: 0, speed: 4.6 };
    this.showRoute = true;
    this.refreshOverlay();
    this.log('Auto-walk following the compiled route. It uses the same walk-surface query as manual movement, and opens locked doors as it collects their keys.');
  }

  updateAuto(dt) {
    const auto = this.auto;
    if (!auto || !this.route) return;
    // Advance in short hops. A slow frame would otherwise move the walker a
    // metre at a time, which steps clean off the side of a staircase.
    let budget = auto.speed * dt;
    while (budget > 0) {
      if (auto.index >= this.route.length - 1) {
        const end = this.route[this.route.length - 1];
        [this.player.x, this.player.y, this.player.z] = end;
        this.auto = null;
        this.log('AUTO-WALK COMPLETE: reached the goal on foot, through stair towers and locked doors.');
        return;
      }
      const a = this.route[auto.index];
      const b = this.route[auto.index + 1];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
      const hop = Math.min(budget, 0.08);
      budget -= hop;
      auto.t += hop / Math.max(0.001, len);
      if (auto.t >= 1) { auto.index += 1; auto.t = 0; continue; }

      const t = auto.t;
      const x = a[0] + (b[0] - a[0]) * t;
      const z = a[2] + (b[2] - a[2]) * t;
      const expected = a[1] + (b[1] - a[1]) * t;
      const y = this.physics.canOccupy(x, z, this.player.y, expected);
      if (y === null) {
        this.auto = null;
        this.log(`AUTO-WALK BLOCKED near ${x.toFixed(1)}, ${expected.toFixed(1)}, ${z.toFixed(1)} — a locked door, or a route the validator should have rejected.`);
        return;
      }
      const dx = b[0] - a[0];
      const dz = b[2] - a[2];
      if (Math.hypot(dx, dz) > 0.01) this.player.yaw = Math.atan2(dx, -dz);
      this.player.x = x;
      this.player.z = z;
      this.player.y = y;
      // Keys are collected mid-hop, so a door unlocks before the walker meets it.
      this.updateInteractions();
    }
  }

  updateMovement(dt) {
    let forward = 0;
    let strafe = 0;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) forward += 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) forward -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) strafe += 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) strafe -= 1;
    if (!forward && !strafe) return;
    const norm = Math.hypot(forward, strafe) || 1;
    forward /= norm;
    strafe /= norm;
    // Yaw 0 faces north (-Z); D always strafes to the camera's right.
    const fx = Math.sin(this.player.yaw);
    const fz = -Math.cos(this.player.yaw);
    const rx = Math.cos(this.player.yaw);
    const rz = Math.sin(this.player.yaw);
    const running = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
    const speed = running ? 5.4 : 3.1;
    this.physics.move(
      this.player,
      (fx * forward + rx * strafe) * speed * dt,
      (fz * forward + rz * strafe) * speed * dt,
    );
  }

  /** Pick up keys, open the doors they fit, and notice arriving at the goal. */
  updateInteractions() {
    const floorIndex = this.physics.floorAt(this.player.y);
    let changed = false;
    for (const prop of this.dungeon.props) {
      if (prop.kind !== 'key' || prop.taken || prop.floor !== floorIndex) continue;
      if (Math.hypot(prop.x - this.player.x, prop.z - this.player.z) > 1.1) continue;
      prop.taken = true;
      this.held.add(prop.lockId);
      const lock = this.dungeon.locks.find((l) => l.id === prop.lockId);
      this.log(`Picked up the ${lock ? lock.name : ''} key.`);
      changed = true;
    }
    for (const door of this.compiled.doors) {
      if (door.open || !this.held.has(door.lock.id)) continue;
      door.open = true;
      this.log(`The ${door.lock.name} door swings open.`);
      changed = true;
    }
    if (changed) this.refreshOverlay();

    const goal = this.dungeon.roomsById.get(this.dungeon.goal);
    if (!this.reachedGoal && goal && goal.floor === floorIndex) {
      const owner = this.dungeon.floors[floorIndex].ownerAt(
        Math.floor(this.player.x / TILE_SIZE),
        Math.floor(this.player.z / TILE_SIZE),
      );
      if (owner === goal.id) {
        this.reachedGoal = true;
        this.log('You reach the throne of the deep. The dungeon is complete.');
      }
    }
  }

  currentRoom(floorIndex) {
    const plan = this.dungeon.floors[floorIndex];
    if (!plan) return null;
    const owner = plan.ownerAt(Math.floor(this.player.x / TILE_SIZE), Math.floor(this.player.z / TILE_SIZE));
    return owner >= 0 ? this.dungeon.roomsById.get(owner) : null;
  }

  updateHud() {
    if (!this.dungeon) return;
    const floorIndex = this.physics.floorAt(this.player.y);
    const room = this.currentRoom(floorIndex);
    const lead = this.renderer.mode !== 'fps'
      ? 'Cutaway · drag to orbit, wheel to zoom'
      : (this.pointerLocked ? 'Mouse captured' : 'Click the view to capture the mouse (or drag to look)');
    this.hudEl.textContent = `${lead} · WASD move · Shift run · M cutaway · Esc release`;

    const keyNames = this.dungeon.locks
      .filter((l) => this.held.has(l.id))
      .map((l) => l.name);
    const remaining = this.dungeon.locks.filter((l) => !this.held.has(l.id)).length;
    const parts = [`Depth ${floorIndex + 1}/${this.dungeon.floorCount}`];
    if (room) parts.push(ROOM_LABEL[room.type] || 'Passage');
    parts.push(keyNames.length ? `Keys: ${keyNames.join(', ')}` : 'Keys: none');
    if (this.reachedGoal) parts.push('GOAL REACHED');
    else if (remaining) parts.push(`${remaining} locked door${remaining > 1 ? 's' : ''} ahead`);
    this.objectiveEl.textContent = parts.join(' · ');
  }

  frame(now) {
    const raw = Math.min(0.25, Math.max(0, (now - this.lastFrame) / 1000));
    this.lastFrame = now;

    if (this.renderer.mode === 'fps') {
      if (this.auto) {
        this.accumulator = 0;
        this.updateAuto(raw);
      } else {
        this.accumulator = Math.min(0.25, this.accumulator + raw);
        let steps = 0;
        while (this.accumulator >= this.stepSeconds && steps < 40) {
          this.updateMovement(this.stepSeconds);
          this.accumulator -= this.stepSeconds;
          steps += 1;
        }
        if (steps >= 40) this.accumulator = 0;
      }
      this.updateInteractions();
    }

    const floorIndex = this.physics.floorAt(this.player.y);
    this.map.observe(floorIndex, this.player.x, this.player.z);
    this.renderer.render(this.player, raw);
    this.map.draw(this.dungeon, this.player, floorIndex, {
      doors: this.compiled.doors,
      revealAll: this.renderer.mode !== 'fps',
    });
    this.updateHud();
    requestAnimationFrame((t) => this.frame(t));
  }

  log(text) {
    this.logEl.textContent = text;
  }
}
