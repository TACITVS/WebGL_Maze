/**
 * Validation.
 *
 * The point of this module is that it does not trust the generator. It walks the
 * compiled world with the same `canOccupy` query the player's own movement uses,
 * so a pass means a person really can get from the entrance to the goal - not
 * merely that some hand-authored centreline happens to be supported.
 */

import { TILE_SIZE } from './grid.js';
import { STEP_LIMIT } from './physics.js';
import { graphBfs } from './generator.js';

const PROBE_STEP = 0.2;

/**
 * Flood fill everywhere the player can physically stand, starting from the
 * entrance. Returns the set of rooms actually reached.
 */
export function physicalReach(dungeon, physics, limit = 3_000_000) {
  // Reachability is about the architecture, not about inventory: keys are proven
  // obtainable separately by checkLocks, so doors are treated as open here.
  const doorState = physics.doors.map((d) => d.open);
  physics.doors.forEach((d) => { d.open = true; });
  try {
    return physicalReachInner(dungeon, physics, limit);
  } finally {
    physics.doors.forEach((d, i) => { d.open = doorState[i]; });
  }
}

function physicalReachInner(dungeon, physics, limit) {
  const start = dungeon.roomsById.get(dungeon.start);
  const plan = dungeon.floors[start.floor];
  const origin = plan.worldOf(start.cx, start.cz);
  const startY = physics.canOccupy(origin[0], origin[2], origin[1]);
  if (startY === null) return { ok: false, reason: 'entrance is not standable', rooms: new Set(), nodes: 0 };

  // The visited key identifies the surface the sample is standing on, not its
  // height. Bucketing by height merges a stair tread with the floor a few
  // centimetres above it and silently prunes the way down a staircase.
  const startSupport = physics.occupancy(origin[0], origin[2], origin[1]);
  const key = (x, z, id) => `${Math.round(x / PROBE_STEP)}:${Math.round(z / PROBE_STEP)}:${id}`;
  const seen = new Set([key(origin[0], origin[2], startSupport.id)]);
  const stack = [[origin[0], startY, origin[2]]];
  const rooms = new Set();
  const floorsSeen = new Set();
  const dirs = [];
  for (let i = 0; i < 8; i += 1) {
    const a = (i * Math.PI) / 4;
    dirs.push([Math.cos(a) * PROBE_STEP, Math.sin(a) * PROBE_STEP]);
  }

  let nodes = 0;
  while (stack.length) {
    const [x, y, z] = stack.pop();
    nodes += 1;
    if (nodes > limit) break;

    // Record which room this sample sits in.
    const floorIndex = physics.floorAt(y);
    const fp = dungeon.floors[floorIndex];
    if (Math.abs(fp.elevation - y) <= STEP_LIMIT) {
      floorsSeen.add(floorIndex);
      const owner = fp.ownerAt(Math.floor(x / TILE_SIZE), Math.floor(z / TILE_SIZE));
      if (owner >= 0) rooms.add(owner);
    }

    for (const [dx, dz] of dirs) {
      const nx = x + dx;
      const nz = z + dz;
      const next = physics.occupancy(nx, nz, y);
      if (!next) continue;
      const k = key(nx, nz, next.id);
      if (seen.has(k)) continue;
      seen.add(k);
      stack.push([nx, next.y, nz]);
    }
  }
  return { ok: true, rooms, floors: floorsSeen, nodes: seen.size };
}

/** Stair towers must be climbable by a human, not a ladder in disguise. */
export function checkStairs(dungeon, compiled) {
  const problems = [];
  for (const surface of compiled.walk) {
    if (surface.kind !== 'ramp') continue;
    const rise = Math.abs(surface.b[1] - surface.a[1]);
    const run = Math.hypot(surface.b[0] - surface.a[0], surface.b[2] - surface.a[2]);
    const slope = (Math.atan2(rise, run) * 180) / Math.PI;
    if (slope > 42) problems.push(`${surface.tag}: ${slope.toFixed(1)}° is too steep`);
    if (run < 1.0) problems.push(`${surface.tag}: run of ${run.toFixed(2)}m is too short`);
  }
  return problems;
}

/**
 * Confirm each key can be picked up before the door it opens - checked against
 * the graph rather than assumed from how the locks were placed.
 */
export function checkLocks(dungeon) {
  const problems = [];
  const blocked = new Set(dungeon.locks.map((l) => l.linkId));
  const opened = new Set();
  const remaining = [...dungeon.locks];
  let guard = 0;
  while (remaining.length && guard < 32) {
    guard += 1;
    const stillBlocked = new Set([...blocked].filter((id) => !opened.has(id)));
    const reach = graphBfs(dungeon.rooms, dungeon.links, dungeon.start, stillBlocked).dist;
    const found = remaining.findIndex((lock) => reach.has(lock.keyRoom));
    if (found < 0) {
      problems.push(`key "${remaining[0].name}" is locked behind the door it opens`);
      break;
    }
    opened.add(remaining[found].linkId);
    remaining.splice(found, 1);
  }
  const finalReach = graphBfs(dungeon.rooms, dungeon.links, dungeon.start, new Set()).dist;
  if (!finalReach.has(dungeon.goal)) problems.push('goal is not connected in the room graph');
  return problems;
}

/** Run every check and summarise. */
export function validateDungeon(dungeon, physics, compiled) {
  const reach = physicalReach(dungeon, physics);
  const totalRooms = dungeon.rooms.length;
  const reachedRooms = reach.rooms ? reach.rooms.size : 0;
  const unreached = dungeon.rooms.filter((r) => !reach.rooms.has(r.id));
  const stairProblems = checkStairs(dungeon, compiled);
  const lockProblems = checkLocks(dungeon);

  const checks = [
    { name: 'Entrance is standable', ok: reach.ok },
    { name: 'Every room physically reachable', ok: unreached.length === 0, detail: unreached.length ? `${unreached.length} unreachable` : '' },
    { name: 'Goal reachable on foot', ok: reach.rooms.has(dungeon.goal) },
    { name: 'All floors reachable', ok: (reach.floors?.size || 0) === dungeon.floorCount },
    { name: 'Stairs climbable', ok: stairProblems.length === 0, detail: stairProblems[0] || '' },
    { name: 'Keys obtainable before locks', ok: lockProblems.length === 0, detail: lockProblems[0] || '' },
  ];

  return {
    checks,
    passed: checks.every((c) => c.ok),
    reachedRooms,
    totalRooms,
    unreached,
    walkNodes: reach.nodes,
    stairProblems,
    lockProblems,
  };
}
