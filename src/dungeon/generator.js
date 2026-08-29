/**
 * Roguelike dungeon generator.
 *
 * The layout is built floor by floor on a tile grid:
 *
 *   1. a BSP partition chops each floor into uneven leaves,
 *   2. one room of random shape is carved into most leaves,
 *   3. a minimum spanning tree over the room centres is carved into corridors,
 *      plus extra edges so the dungeon has loops instead of being a pure tree,
 *   4. stair towers are dropped wherever a room on one floor overlaps a room on
 *      the next, which is what stitches the floors into a single 3D graph,
 *   5. locks are placed on bridges of that graph and their keys are placed in
 *      the region that is still reachable without them, so every dungeon is
 *      solvable by construction.
 */

import { RNG } from './rng.js';
import { TILE, TILE_SIZE, DIRS, FloorPlan, floodFill, connectedWithout } from './grid.js';

/** Tile footprint of a stair tower: 3 tiles across the flights, 4 along them. */
export const SHAFT_ACROSS = 3;
export const SHAFT_ALONG = 4;

export const ROOM_TYPE = Object.freeze({
  ENTRANCE: 'entrance',
  BOSS: 'boss',
  VAULT: 'vault',
  SHRINE: 'shrine',
  LIBRARY: 'library',
  BARRACKS: 'barracks',
  CISTERN: 'cistern',
  CRYPT: 'crypt',
  HALL: 'hall',
  CHAMBER: 'chamber',
});

/** Furniture that a person cannot walk through. Routing has to know this too. */
export const SOLID_PROP_KINDS = new Set([
  'pillar', 'crate', 'shelf', 'sarcophagus', 'altar', 'chest', 'brazier',
]);

/** Per floor palettes, so descending actually looks like descending. */
const THEMES = [
  { name: 'Flooded undercroft', floor: [0.30, 0.33, 0.34], wall: [0.35, 0.34, 0.31], ceiling: [0.17, 0.19, 0.20], accent: [0.24, 0.52, 0.55], light: [1.00, 0.72, 0.38] },
  { name: 'Bone galleries', floor: [0.34, 0.32, 0.28], wall: [0.40, 0.37, 0.31], ceiling: [0.19, 0.18, 0.17], accent: [0.62, 0.55, 0.36], light: [1.00, 0.66, 0.30] },
  { name: 'Verdigris works', floor: [0.26, 0.31, 0.30], wall: [0.30, 0.35, 0.33], ceiling: [0.15, 0.18, 0.18], accent: [0.24, 0.60, 0.48], light: [0.62, 0.94, 0.78] },
  { name: 'Emberforge', floor: [0.33, 0.27, 0.25], wall: [0.38, 0.29, 0.25], ceiling: [0.20, 0.15, 0.14], accent: [0.72, 0.34, 0.20], light: [1.00, 0.55, 0.22] },
  { name: 'Obsidian sanctum', floor: [0.24, 0.24, 0.29], wall: [0.27, 0.26, 0.33], ceiling: [0.14, 0.14, 0.18], accent: [0.48, 0.36, 0.72], light: [0.72, 0.60, 1.00] },
];

/**
 * Recursively split a rectangle into uneven leaves.
 *
 * Splitting the long axis keeps leaves roughly square; the random split ratio is
 * what stops the result from reading as a grid.
 */
function splitBsp(rng, rect, depth, minLeaf, out) {
  const canSplitX = rect.w >= minLeaf * 2 + 1;
  const canSplitZ = rect.h >= minLeaf * 2 + 1;
  if (depth <= 0 || (!canSplitX && !canSplitZ)) {
    out.push(rect);
    return;
  }
  let horizontal;
  if (canSplitX && canSplitZ) {
    // Prefer cutting the longer side, but not always - variety beats tidiness.
    if (rect.w > rect.h * 1.25) horizontal = true;
    else if (rect.h > rect.w * 1.25) horizontal = false;
    else horizontal = rng.chance(0.5);
  } else {
    horizontal = canSplitX;
  }
  const span = horizontal ? rect.w : rect.h;
  const cut = Math.round(span * rng.float(0.36, 0.64));
  if (cut < minLeaf || span - cut < minLeaf) {
    out.push(rect);
    return;
  }
  const a = horizontal
    ? { x: rect.x, z: rect.z, w: cut, h: rect.h }
    : { x: rect.x, z: rect.z, w: rect.w, h: cut };
  const b = horizontal
    ? { x: rect.x + cut, z: rect.z, w: rect.w - cut, h: rect.h }
    : { x: rect.x, z: rect.z + cut, w: rect.w, h: rect.h - cut };
  splitBsp(rng, a, depth - 1, minLeaf, out);
  splitBsp(rng, b, depth - 1, minLeaf, out);
}

/** Stamp a rectangle of tiles as room floor owned by `room`. */
function fillRect(plan, room, x, z, w, h) {
  for (let dz = 0; dz < h; dz += 1) {
    for (let dx = 0; dx < w; dx += 1) {
      plan.set(x + dx, z + dz, TILE.ROOM);
      plan.setOwner(x + dx, z + dz, room.id);
    }
  }
}

/**
 * Carve one room into a leaf. Shape is picked at random so the dungeon is not
 * wall to wall rectangles.
 */
function carveRoom(rng, plan, room) {
  const { x, z, w, h } = room;
  const shape = room.shape;
  if (shape === 'L' && w >= 5 && h >= 5) {
    // Rectangle with one corner bitten out.
    const bw = Math.max(2, Math.floor(w * rng.float(0.32, 0.5)));
    const bh = Math.max(2, Math.floor(h * rng.float(0.32, 0.5)));
    const bx = rng.chance(0.5) ? x : x + w - bw;
    const bz = rng.chance(0.5) ? z : z + h - bh;
    fillRect(plan, room, x, z, w, h);
    for (let dz = 0; dz < bh; dz += 1) {
      for (let dx = 0; dx < bw; dx += 1) {
        plan.set(bx + dx, bz + dz, TILE.ROCK);
        plan.setOwner(bx + dx, bz + dz, -1);
      }
    }
  } else if (shape === 'vault' && w >= 6 && h >= 6) {
    // Ring of floor around a solid plinth - reads as a treasury or a well room.
    fillRect(plan, room, x, z, w, h);
    const px = x + Math.floor(w / 2) - 1;
    const pz = z + Math.floor(h / 2) - 1;
    for (let dz = 0; dz < 2; dz += 1) {
      for (let dx = 0; dx < 2; dx += 1) {
        plan.set(px + dx, pz + dz, TILE.ROCK);
        plan.setOwner(px + dx, pz + dz, -1);
      }
    }
  } else {
    // Too small for the shape that was rolled - fall back to a plain rectangle
    // and record that, so room typing is not misled by a shape that never got cut.
    room.shape = 'rect';
    fillRect(plan, room, x, z, w, h);
  }
  // The centre tile is used as the graph anchor, so it must be solid floor.
  if (!plan.walkable(room.cx, room.cz)) {
    const found = room.findAnyFloor(plan);
    if (found) {
      room.cx = found[0];
      room.cz = found[1];
    }
  }
}

class Room {
  constructor(id, floor, x, z, w, h, shape) {
    this.id = id;
    this.floor = floor;
    this.x = x;
    this.z = z;
    this.w = w;
    this.h = h;
    this.shape = shape;
    this.cx = x + Math.floor(w / 2);
    this.cz = z + Math.floor(h / 2);
    this.type = ROOM_TYPE.CHAMBER;
    this.links = [];
    this.tileCount = 0;
  }

  get area() {
    return this.w * this.h;
  }

  contains(x, z) {
    return x >= this.x && z >= this.z && x < this.x + this.w && z < this.z + this.h;
  }

  findAnyFloor(plan) {
    for (let dz = 0; dz < this.h; dz += 1) {
      for (let dx = 0; dx < this.w; dx += 1) {
        if (plan.get(this.x + dx, this.z + dz) === TILE.ROOM) return [this.x + dx, this.z + dz];
      }
    }
    return null;
  }

  /** Interior tiles, excluding the ring touching the walls - safe for props. */
  interiorTiles(plan) {
    const out = [];
    for (let dz = 1; dz < this.h - 1; dz += 1) {
      for (let dx = 1; dx < this.w - 1; dx += 1) {
        const x = this.x + dx;
        const z = this.z + dz;
        if (plan.get(x, z) !== TILE.ROOM || plan.isReserved(x, z)) continue;
        // Keep a clear ring: a prop may never sit next to a non-room tile.
        let safe = true;
        for (const d of DIRS) {
          if (plan.get(x + d.dx, z + d.dz) !== TILE.ROOM) safe = false;
        }
        if (safe) out.push([x, z]);
      }
    }
    return out;
  }

  /** Tiles along the inside of the room wall - where torches and shelves go. */
  perimeterTiles(plan) {
    const out = [];
    for (let dz = 0; dz < this.h; dz += 1) {
      for (let dx = 0; dx < this.w; dx += 1) {
        const x = this.x + dx;
        const z = this.z + dz;
        if (plan.get(x, z) !== TILE.ROOM || plan.isReserved(x, z)) continue;
        for (const d of DIRS) {
          if (plan.get(x + d.dx, z + d.dz) === TILE.ROCK) {
            out.push([x, z, d]);
            break;
          }
        }
      }
    }
    return out;
  }
}

/** Carve an L shaped corridor between two tiles. */
function carveCorridor(plan, ax, az, bx, bz, wide, rng) {
  const horizontalFirst = rng.chance(0.5);
  const cut = (x, z) => {
    if (!plan.inside(x, z)) return;
    if (plan.get(x, z) === TILE.ROCK) plan.set(x, z, TILE.CORRIDOR);
  };
  const run = (x0, x1, z0, z1) => {
    const stepX = Math.sign(x1 - x0);
    const stepZ = Math.sign(z1 - z0);
    let x = x0;
    let z = z0;
    for (;;) {
      cut(x, z);
      if (wide) cut(x + (stepZ !== 0 ? 1 : 0), z + (stepX !== 0 ? 1 : 0));
      if (x === x1 && z === z1) break;
      if (x !== x1) x += stepX;
      else if (z !== z1) z += stepZ;
      else break;
    }
  };
  if (horizontalFirst) {
    run(ax, bx, az, az);
    run(bx, bx, az, bz);
  } else {
    run(ax, ax, az, bz);
    run(ax, bx, bz, bz);
  }
}

/** Minimum spanning tree over room centres, plus a few extra loop edges. */
function roomGraphEdges(rng, rooms, extraRatio) {
  if (rooms.length < 2) return [];
  const cost = (a, b) => Math.hypot(a.cx - b.cx, a.cz - b.cz);
  const inTree = new Set([rooms[0].id]);
  const edges = [];
  const candidates = [];
  while (inTree.size < rooms.length) {
    let best = null;
    for (const a of rooms) {
      if (!inTree.has(a.id)) continue;
      for (const b of rooms) {
        if (inTree.has(b.id)) continue;
        const c = cost(a, b);
        if (!best || c < best.c) best = { a, b, c };
      }
    }
    if (!best) break;
    inTree.add(best.b.id);
    edges.push([best.a, best.b]);
  }
  // Extra links turn the tree into a graph with loops, which is what makes a
  // dungeon feel navigable instead of like a corridor puzzle.
  const taken = new Set(edges.map(([a, b]) => `${a.id}:${b.id}`));
  for (let i = 0; i < rooms.length; i += 1) {
    for (let j = i + 1; j < rooms.length; j += 1) {
      const key = `${rooms[i].id}:${rooms[j].id}`;
      const rkey = `${rooms[j].id}:${rooms[i].id}`;
      if (taken.has(key) || taken.has(rkey)) continue;
      candidates.push({ a: rooms[i], b: rooms[j], c: cost(rooms[i], rooms[j]) });
    }
  }
  candidates.sort((p, q) => p.c - q.c);
  const extra = Math.round(rooms.length * extraRatio);
  for (let i = 0; i < extra && i < candidates.length; i += 1) {
    const pick = candidates[rng.int(Math.min(candidates.length, extra * 3))] || candidates[i];
    edges.push([pick.a, pick.b]);
  }
  return edges;
}

/** Turn corridor tiles that form a threshold into a room into door tiles. */
function markDoors(plan) {
  const doors = [];
  for (let z = 0; z < plan.height; z += 1) {
    for (let x = 0; x < plan.width; x += 1) {
      if (plan.get(x, z) !== TILE.CORRIDOR) continue;
      let roomSides = 0;
      let openSides = 0;
      for (const d of DIRS) {
        const t = plan.get(x + d.dx, z + d.dz);
        if (t === TILE.ROOM) roomSides += 1;
        if (t === TILE.CORRIDOR || t === TILE.DOOR) openSides += 1;
      }
      if (roomSides >= 1 && openSides >= 1) {
        plan.set(x, z, TILE.DOOR);
        doors.push([x, z]);
      }
    }
  }
  return doors;
}

/**
 * Place stair towers between two consecutive floors.
 *
 * A tower needs the same tile footprint to be plain room floor on both floors,
 * with a clear tile in front of its mouth on each, so the flights always land
 * somewhere you can actually walk out of.
 */
function placeStairs(rng, lower, upper, stairs, links, roomsById, wanted) {
  const candidates = [];
  for (const facing of DIRS) {
    // Local axes: `along` runs from the mouth to the back of the tower.
    const alongX = -facing.dx;
    const alongZ = -facing.dz;
    const acrossX = -facing.dz;
    const acrossZ = facing.dx;
    for (let z = 1; z < lower.height - 1; z += 1) {
      for (let x = 1; x < lower.width - 1; x += 1) {
        let ok = true;
        let lowerRoom = -1;
        let upperRoom = -1;
        for (let u = 0; u < SHAFT_ALONG && ok; u += 1) {
          for (let v = 0; v < SHAFT_ACROSS && ok; v += 1) {
            const tx = x + alongX * u + acrossX * v;
            const tz = z + alongZ * u + acrossZ * v;
            if (!lower.inside(tx, tz) || !upper.inside(tx, tz)) { ok = false; break; }
            if (lower.get(tx, tz) !== TILE.ROOM || upper.get(tx, tz) !== TILE.ROOM) { ok = false; break; }
            const lo = lower.ownerAt(tx, tz);
            const up = upper.ownerAt(tx, tz);
            if (lo < 0 || up < 0) { ok = false; break; }
            if (lowerRoom < 0) lowerRoom = lo; else if (lowerRoom !== lo) ok = false;
            if (upperRoom < 0) upperRoom = up; else if (upperRoom !== up) ok = false;
          }
        }
        if (!ok) continue;
        // The tile in front of the mouth must be walkable on both floors.
        let mouthOk = true;
        for (let v = 0; v < SHAFT_ACROSS; v += 1) {
          const fx = x + facing.dx + acrossX * v;
          const fz = z + facing.dz + acrossZ * v;
          if (!lower.walkable(fx, fz) || !upper.walkable(fx, fz)) mouthOk = false;
        }
        if (!mouthOk) continue;
        candidates.push({ x, z, facing, lowerRoom, upperRoom });
      }
    }
  }
  if (!candidates.length) return 0;
  rng.shuffle(candidates);
  const usedPairs = new Set();
  const usedTiles = new Set();
  let placed = 0;
  for (const c of candidates) {
    if (placed >= wanted) break;
    const pairKey = `${c.lowerRoom}:${c.upperRoom}`;
    if (usedPairs.has(pairKey)) continue;
    const alongX = -c.facing.dx;
    const alongZ = -c.facing.dz;
    const acrossX = -c.facing.dz;
    const acrossZ = c.facing.dx;
    // Reject overlaps with any tower already placed. A tower's casing spans both
    // of its floors, so two towers sharing a floor must not share tiles either -
    // the reservation mask is what carries that across floor pairs, since
    // `usedTiles` only sees the pair being placed right now.
    let clash = false;
    const tiles = [];
    for (let u = -1; u <= SHAFT_ALONG && !clash; u += 1) {
      for (let v = -1; v <= SHAFT_ACROSS && !clash; v += 1) {
        const tx = c.x + alongX * u + acrossX * v;
        const tz = c.z + alongZ * u + acrossZ * v;
        if (usedTiles.has(`${tx},${tz}`)) clash = true;
        if (lower.isReserved(tx, tz) || upper.isReserved(tx, tz)) clash = true;
        if (u >= 0 && u < SHAFT_ALONG && v >= 0 && v < SHAFT_ACROSS) tiles.push([tx, tz]);
      }
    }
    if (clash) continue;

    // A tower is only safe if neither floor loses connectivity to it. On the
    // upper floor the stairwell removes tiles; on the lower floor the tower's
    // casing walls them off. Both are checked before anything is committed.
    const exitTileX = c.x + acrossX * (SHAFT_ACROSS - 1);
    const exitTileZ = c.z + acrossZ * (SHAFT_ACROSS - 1);
    // The whole footprint is excluded on both floors, the exit tile included.
    // The exit stays walkable, but it sits inside the tower and is reachable
    // only through the mouth - so no route may be planned across it, on either
    // floor, and neither floor may depend on the tower to stay connected.
    if (!connectedWithout(upper, tiles)) continue;
    if (!connectedWithout(lower, tiles)) continue;

    for (let u = -1; u <= SHAFT_ALONG; u += 1) {
      for (let v = -1; v <= SHAFT_ACROSS; v += 1) {
        usedTiles.add(`${c.x + alongX * u + acrossX * v},${c.z + alongZ * u + acrossZ * v}`);
      }
    }
    usedPairs.add(pairKey);

    // Lane A (v = 0) carries the ascending flight, lane B (v = 2) the descending
    // one, so the tower exits on the upper floor beside where it was entered.
    const exitX = exitTileX;
    const exitZ = exitTileZ;
    for (const [tx, tz] of tiles) {
      upper.set(tx, tz, TILE.VOID);
      upper.setOwner(tx, tz, -1);
      // Furniture must never spawn inside a stair tower on either floor.
      upper.reserve(tx, tz);
      lower.reserve(tx, tz);
      // The tower's casing seals these tiles off on both floors, so no later
      // route may be planned through them.
      lower.blockStructure(tx, tz);
      upper.blockStructure(tx, tz);
    }
    for (let u = -1; u <= SHAFT_ALONG; u += 1) {
      for (let v = -1; v <= SHAFT_ACROSS; v += 1) {
        const tx = c.x + alongX * u + acrossX * v;
        const tz = c.z + alongZ * u + acrossZ * v;
        upper.reserve(tx, tz);
        lower.reserve(tx, tz);
      }
    }
    upper.set(exitX, exitZ, TILE.STAIR_EXIT);
    upper.setOwner(exitX, exitZ, c.upperRoom);
    // Leave the descent open: the mouth tile must connect to the shaft interior.
    upper.openEdges.add(FloorPlan.edgeKey(exitX, exitZ, exitX + alongX, exitZ + alongZ));
    // The tower casing already encloses the back and both sides from the lower
    // floor upwards, so suppress the railings the wall pass would otherwise put
    // in exactly the same plane. Only the mouth side keeps its railing.
    for (let u = 0; u < SHAFT_ALONG; u += 1) {
      for (let v = 0; v < SHAFT_ACROSS; v += 1) {
        const tx = c.x + alongX * u + acrossX * v;
        const tz = c.z + alongZ * u + acrossZ * v;
        const sides = [];
        if (v === 0) sides.push([-acrossX, -acrossZ]);
        if (v === SHAFT_ACROSS - 1) sides.push([acrossX, acrossZ]);
        if (u === SHAFT_ALONG - 1) sides.push([alongX, alongZ]);
        for (const [sx, sz] of sides) {
          upper.openEdges.add(FloorPlan.edgeKey(tx, tz, tx + sx, tz + sz));
        }
      }
    }

    const stair = {
      id: stairs.length,
      lowerFloor: lower.index,
      upperFloor: upper.index,
      x: c.x,
      z: c.z,
      facing: c.facing,
      alongX,
      alongZ,
      acrossX,
      acrossZ,
      tiles,
      exit: [exitX, exitZ],
      lowerRoom: c.lowerRoom,
      upperRoom: c.upperRoom,
    };
    stairs.push(stair);
    const link = {
      id: links.length,
      a: c.lowerRoom,
      b: c.upperRoom,
      kind: 'stair',
      stair,
      locked: null,
    };
    links.push(link);
    roomsById.get(c.lowerRoom).links.push(link.id);
    roomsById.get(c.upperRoom).links.push(link.id);
    placed += 1;
  }
  return placed;
}

/** Breadth first search over the room graph. Returns predecessor maps. */
function graphBfs(rooms, links, startId, blockedLinks = new Set()) {
  const adj = new Map();
  for (const r of rooms) adj.set(r.id, []);
  for (const l of links) {
    if (blockedLinks.has(l.id)) continue;
    adj.get(l.a).push([l.b, l.id]);
    adj.get(l.b).push([l.a, l.id]);
  }
  const dist = new Map([[startId, 0]]);
  const prev = new Map([[startId, null]]);
  const queue = [startId];
  for (let head = 0; head < queue.length; head += 1) {
    const cur = queue[head];
    for (const [next, linkId] of adj.get(cur) || []) {
      if (dist.has(next)) continue;
      dist.set(next, dist.get(cur) + 1);
      prev.set(next, { from: cur, linkId });
      queue.push(next);
    }
  }
  return { dist, prev, adj };
}

/** Links whose removal disconnects the graph - the only places a lock can bite. */
function findBridges(rooms, links) {
  const adj = new Map();
  for (const r of rooms) adj.set(r.id, []);
  for (const l of links) {
    adj.get(l.a).push([l.b, l.id]);
    adj.get(l.b).push([l.a, l.id]);
  }
  const disc = new Map();
  const low = new Map();
  const bridges = new Set();
  let timer = 0;
  // Iterative Tarjan: the room graph is small but recursion depth is not worth risking.
  for (const root of rooms) {
    if (disc.has(root.id)) continue;
    const stack = [{ node: root.id, parentLink: -1, iter: 0 }];
    disc.set(root.id, timer);
    low.set(root.id, timer);
    timer += 1;
    while (stack.length) {
      const frame = stack[stack.length - 1];
      const neighbours = adj.get(frame.node);
      if (frame.iter < neighbours.length) {
        const [next, linkId] = neighbours[frame.iter];
        frame.iter += 1;
        if (linkId === frame.parentLink) continue;
        if (disc.has(next)) {
          low.set(frame.node, Math.min(low.get(frame.node), disc.get(next)));
        } else {
          disc.set(next, timer);
          low.set(next, timer);
          timer += 1;
          stack.push({ node: next, parentLink: linkId, iter: 0 });
        }
      } else {
        stack.pop();
        const parent = stack[stack.length - 1];
        if (parent) {
          low.set(parent.node, Math.min(low.get(parent.node), low.get(frame.node)));
          if (low.get(frame.node) > disc.get(parent.node)) bridges.add(frame.parentLink);
        }
      }
    }
  }
  return bridges;
}

const KEY_STYLES = [
  { name: 'Bronze', color: [0.85, 0.60, 0.25] },
  { name: 'Iron', color: [0.72, 0.76, 0.82] },
  { name: 'Jade', color: [0.36, 0.84, 0.60] },
];

/**
 * Lock a few doors on the critical path and hide their keys behind them in
 * order. Because every lock is a bridge and every key sits in the component
 * that is still open when the player needs it, the dungeon always solves.
 */
function placeLocks(rng, rooms, links, startId, goalId, wanted) {
  const locks = [];
  if (wanted <= 0) return locks;
  const bridges = findBridges(rooms, links);
  const { prev } = graphBfs(rooms, links, startId);
  if (!prev.has(goalId)) return locks;

  // Walk the solution path from the entrance outwards.
  const path = [];
  for (let cur = goalId; prev.get(cur); cur = prev.get(cur).from) path.push(prev.get(cur).linkId);
  path.reverse();

  const lockable = path.filter((id) => bridges.has(id));
  if (!lockable.length) return locks;

  const roomsById = new Map(rooms.map((r) => [r.id, r]));
  const chosen = [];
  const stride = Math.max(1, Math.floor(lockable.length / (wanted + 1)));
  for (let i = 1; i <= wanted && i * stride - 1 < lockable.length; i += 1) {
    chosen.push(lockable[i * stride - 1]);
  }

  const blocked = new Set();
  let previousReach = null;
  for (let i = 0; i < chosen.length; i += 1) {
    const linkId = chosen[i];
    const trial = new Set(blocked);
    trial.add(linkId);
    const reach = graphBfs(rooms, links, startId, trial).dist;
    // Prefer a dead end that only became available since the previous lock.
    const fresh = [...reach.keys()].filter((id) => !previousReach || !previousReach.has(id));
    const pool = (fresh.length ? fresh : [...reach.keys()])
      .map((id) => roomsById.get(id))
      .filter((r) => r && r.id !== startId);
    if (!pool.length) continue;
    pool.sort((a, b) => (a.links.length - b.links.length) || (reach.get(b.id) - reach.get(a.id)));
    const keyRoom = pool[0];
    const style = KEY_STYLES[i % KEY_STYLES.length];
    const lock = {
      id: locks.length,
      linkId,
      keyRoom: keyRoom.id,
      name: style.name,
      color: style.color,
    };
    locks.push(lock);
    const link = links.find((l) => l.id === linkId);
    link.locked = lock;
    blocked.add(linkId);
    previousReach = reach;
  }
  return locks;
}

/** Give every room a role, which drives its props, lighting and minimap colour. */
function assignRoomTypes(rng, rooms, startId, goalId, locks) {
  const keyRooms = new Set(locks.map((l) => l.keyRoom));
  for (const room of rooms) {
    if (room.id === startId) { room.type = ROOM_TYPE.ENTRANCE; continue; }
    if (room.id === goalId) { room.type = ROOM_TYPE.BOSS; continue; }
    if (keyRooms.has(room.id)) { room.type = ROOM_TYPE.SHRINE; continue; }
    const deadEnd = room.links.length <= 1;
    if (deadEnd && room.area <= 40) { room.type = ROOM_TYPE.VAULT; continue; }
    if (room.area >= 90) { room.type = rng.pick([ROOM_TYPE.HALL, ROOM_TYPE.CISTERN, ROOM_TYPE.BARRACKS]); continue; }
    if (room.shape === 'vault') { room.type = ROOM_TYPE.CRYPT; continue; }
    room.type = rng.pick([ROOM_TYPE.CHAMBER, ROOM_TYPE.LIBRARY, ROOM_TYPE.BARRACKS, ROOM_TYPE.CRYPT]);
  }
}

/**
 * Scatter furniture and torches. Props only ever land on interior tiles that are
 * fully surrounded by room floor, so no prop can ever seal a room off.
 */
function furnish(rng, dungeon) {
  const props = [];
  const lights = [];
  for (const room of dungeon.rooms) {
    const plan = dungeon.floors[room.floor];
    const theme = plan.theme;
    const interior = rng.shuffle(room.interiorTiles(plan));
    const perimeter = rng.shuffle(room.perimeterTiles(plan));

    // Torches: the main light source, and the reason the dungeon reads as 3D.
    const torchCount = Math.max(1, Math.min(4, Math.round(room.area / 34)));
    for (let i = 0; i < torchCount && i < perimeter.length; i += 1) {
      const [x, z, dir] = perimeter[i * 2 % perimeter.length];
      const wx = (x + 0.5 + dir.dx * 0.34) * TILE_SIZE;
      const wz = (z + 0.5 + dir.dz * 0.34) * TILE_SIZE;
      props.push({ kind: 'torch', floor: room.floor, x: wx, z: wz, y: plan.elevation, dir, color: theme.light });
      lights.push({
        pos: [wx, plan.elevation + 2.05, wz],
        color: theme.light,
        intensity: room.type === ROOM_TYPE.BOSS ? 1.5 : 1.0,
        floor: room.floor,
      });
    }

    let slot = 0;
    const take = () => (slot < interior.length ? interior[slot++] : null);
    const place = (kind, count, extra = {}) => {
      for (let i = 0; i < count; i += 1) {
        const tile = take();
        if (!tile) return;
        props.push({
          kind,
          floor: room.floor,
          x: (tile[0] + 0.5) * TILE_SIZE,
          z: (tile[1] + 0.5) * TILE_SIZE,
          y: plan.elevation,
          tile,
          accent: theme.accent,
          solid: SOLID_PROP_KINDS.has(kind),
          ...extra,
        });
      }
    };

    switch (room.type) {
      case ROOM_TYPE.ENTRANCE:
        place('portal', 1);
        break;
      case ROOM_TYPE.BOSS:
        place('altar', 1);
        place('brazier', Math.min(4, Math.floor(interior.length / 4)));
        break;
      case ROOM_TYPE.VAULT:
        place('chest', 1);
        place('crate', rng.range(1, 3));
        break;
      case ROOM_TYPE.SHRINE:
        place('altar', 1);
        break;
      case ROOM_TYPE.LIBRARY:
        place('shelf', Math.min(6, Math.floor(interior.length / 3)));
        break;
      case ROOM_TYPE.BARRACKS:
        place('crate', Math.min(6, Math.floor(interior.length / 3)));
        break;
      case ROOM_TYPE.CRYPT:
        place('sarcophagus', Math.min(4, Math.floor(interior.length / 4)));
        break;
      case ROOM_TYPE.CISTERN:
        place('pillar', Math.min(8, Math.floor(interior.length / 3)));
        break;
      case ROOM_TYPE.HALL:
        place('pillar', Math.min(10, Math.floor(interior.length / 3)));
        break;
      default:
        if (rng.chance(0.5)) place('crate', rng.range(1, 2));
        break;
    }
  }

  // Corridors need light too, or the connective tissue of the dungeon is a
  // black tunnel between lit rooms.
  for (const plan of dungeon.floors) {
    for (let z = 0; z < plan.height; z += 1) {
      for (let x = 0; x < plan.width; x += 1) {
        const tile = plan.get(x, z);
        if (tile !== TILE.CORRIDOR) continue;
        // A sconce every few tiles, on a stretch that actually has a wall.
        if (((x * 7 + z * 13) % 5) !== 0) continue;
        const wall = DIRS.find((d) => plan.get(x + d.dx, z + d.dz) === TILE.ROCK);
        if (!wall) continue;
        const wx = (x + 0.5 + wall.dx * 0.34) * TILE_SIZE;
        const wz = (z + 0.5 + wall.dz * 0.34) * TILE_SIZE;
        props.push({ kind: 'torch', floor: plan.index, x: wx, z: wz, y: plan.elevation, dir: wall, color: plan.theme.light });
        lights.push({ pos: [wx, plan.elevation + 1.95, wz], color: plan.theme.light, intensity: 0.75, floor: plan.index });
      }
    }
  }

  // Keys and the goal marker are content, not furniture, but they light up too.
  for (const lock of dungeon.locks) {
    const room = dungeon.roomsById.get(lock.keyRoom);
    const plan = dungeon.floors[room.floor];
    // On the room's anchor tile: that is the tile every route passes through, so
    // a key can never end up somewhere a walker would miss. Keys are not solid,
    // so putting one there blocks nothing.
    const spot = [room.cx, room.cz];
    props.push({
      kind: 'key',
      floor: room.floor,
      x: (spot[0] + 0.5) * TILE_SIZE,
      z: (spot[1] + 0.5) * TILE_SIZE,
      y: plan.elevation,
      color: lock.color,
      lockId: lock.id,
    });
    lights.push({ pos: [(spot[0] + 0.5) * TILE_SIZE, plan.elevation + 1.1, (spot[1] + 0.5) * TILE_SIZE], color: lock.color, intensity: 0.9, floor: room.floor });
  }

  dungeon.props = props;
  dungeon.lights = lights;
  ensureRoutable(dungeon);
}

/**
 * Furniture may decorate a room but it may never break the way through it.
 *
 * Routes are planned over tile centres, so a chest sitting on a centre makes
 * that tile unusable to the planner. This removes the smallest number of solid
 * props needed for every room anchor and every stair mouth on a floor to remain
 * mutually reachable.
 */
function ensureRoutable(dungeon) {
  for (const plan of dungeon.floors) {
    // Tiles a route must be able to reach on this floor.
    const targets = plan.rooms.map((r) => [r.cx, r.cz]);
    for (const stair of dungeon.stairs) {
      if (stair.upperFloor === plan.index) {
        targets.push([stair.exit[0] + stair.facing.dx, stair.exit[1] + stair.facing.dz]);
      }
      if (stair.lowerFloor === plan.index) {
        targets.push([stair.x + stair.facing.dx, stair.z + stair.facing.dz]);
      }
    }
    if (targets.length < 2) continue;

    const towerTiles = new Set();
    for (const stair of dungeon.stairs) {
      if (stair.lowerFloor !== plan.index && stair.upperFloor !== plan.index) continue;
      for (const [tx, tz] of stair.tiles) towerTiles.add(`${tx},${tz}`);
    }

    for (let guard = 0; guard < 64; guard += 1) {
      const solid = dungeon.props.filter((pr) => pr.solid && !pr.removed && pr.floor === plan.index);
      const blocked = new Set(towerTiles);
      for (const pr of solid) {
        blocked.add(`${Math.floor(pr.x / TILE_SIZE)},${Math.floor(pr.z / TILE_SIZE)}`);
      }
      const seed = targets.find(([x, z]) => plan.walkable(x, z) && !blocked.has(`${x},${z}`));
      if (!seed) break;
      const seen = new Set([`${seed[0]},${seed[1]}`]);
      const stack = [seed];
      while (stack.length) {
        const [x, z] = stack.pop();
        for (const d of DIRS) {
          const nx = x + d.dx;
          const nz = z + d.dz;
          const key = `${nx},${nz}`;
          if (seen.has(key) || blocked.has(key) || !plan.walkable(nx, nz)) continue;
          seen.add(key);
          stack.push([nx, nz]);
        }
      }
      const stranded = targets.filter(([x, z]) => plan.walkable(x, z) && !seen.has(`${x},${z}`));
      if (!stranded.length) break;
      // Drop the solid prop nearest a stranded target and try again.
      let victim = null;
      for (const pr of solid) {
        for (const [x, z] of stranded) {
          const dist = Math.hypot(pr.x / TILE_SIZE - x, pr.z / TILE_SIZE - z);
          if (!victim || dist < victim.dist) victim = { pr, dist };
        }
      }
      if (!victim) break;
      victim.pr.removed = true;
    }
  }
  dungeon.props = dungeon.props.filter((pr) => !pr.removed);
}

/**
 * Build a complete dungeon from a seed.
 */
export function generateDungeon(seed, options = {}) {
  const rng = new RNG(seed);
  const width = options.width || 46;
  const height = options.height || 46;
  const floorCount = options.floors || 4;
  const storeyHeight = options.storeyHeight || 4.8;
  const lockCount = options.locks ?? 2;

  const floors = [];
  const rooms = [];
  const links = [];
  const stairs = [];
  const roomsById = new Map();

  for (let f = 0; f < floorCount; f += 1) {
    const plan = new FloorPlan(f, width, height, -f * storeyHeight);
    plan.theme = THEMES[f % THEMES.length];
    plan.ceilingRoom = rng.float(3.3, 3.9);
    plan.ceilingCorridor = rng.float(2.4, 2.8);

    const leaves = [];
    splitBsp(rng, { x: 1, z: 1, w: width - 2, h: height - 2 }, options.depth || 4, options.minLeaf || 9, leaves);

    for (const leaf of leaves) {
      // A few leaves stay solid rock. Negative space is what makes the rest read
      // as rooms rather than as a partition diagram.
      if (leaves.length > 6 && rng.chance(0.12)) continue;
      const maxW = leaf.w - 2;
      const maxH = leaf.h - 2;
      if (maxW < 4 || maxH < 4) continue;
      const w = rng.range(Math.max(4, Math.floor(maxW * 0.5)), maxW);
      const h = rng.range(Math.max(4, Math.floor(maxH * 0.5)), maxH);
      const x = leaf.x + 1 + rng.int(Math.max(1, maxW - w + 1));
      const z = leaf.z + 1 + rng.int(Math.max(1, maxH - h + 1));
      const shape = rng.chance(0.2) ? 'L' : (rng.chance(0.14) ? 'vault' : 'rect');
      const room = new Room(rooms.length, f, x, z, w, h, shape);
      carveRoom(rng, plan, room);
      plan.rooms.push(room);
      rooms.push(room);
      roomsById.set(room.id, room);
    }

    // Corridors.
    for (const [a, b] of roomGraphEdges(rng, plan.rooms, options.loopRatio ?? 0.35)) {
      carveCorridor(plan, a.cx, a.cz, b.cx, b.cz, rng.chance(0.22), rng);
      const link = { id: links.length, a: a.id, b: b.id, kind: 'corridor', floor: f, locked: null };
      links.push(link);
      a.links.push(link.id);
      b.links.push(link.id);
    }

    // Guarantee the floor is one connected walkable region.
    for (let guard = 0; guard < 12; guard += 1) {
      const anchor = plan.rooms[0];
      if (!anchor) break;
      const seen = floodFill(plan, anchor.cx, anchor.cz);
      const stranded = plan.rooms.filter((r) => !seen[r.cz * width + r.cx]);
      if (!stranded.length) break;
      const orphan = stranded[0];
      let nearest = null;
      for (const r of plan.rooms) {
        if (!seen[r.cz * width + r.cx]) continue;
        const c = Math.hypot(r.cx - orphan.cx, r.cz - orphan.cz);
        if (!nearest || c < nearest.c) nearest = { r, c };
      }
      if (!nearest) break;
      carveCorridor(plan, orphan.cx, orphan.cz, nearest.r.cx, nearest.r.cz, false, rng);
      const link = { id: links.length, a: orphan.id, b: nearest.r.id, kind: 'corridor', floor: f, locked: null };
      links.push(link);
      orphan.links.push(link.id);
      nearest.r.links.push(link.id);
    }

    floors.push(plan);
  }

  // Stair towers stitch the floors together. Floor 0 is the entrance level and
  // each subsequent floor sits one storey deeper, so floors[f + 1] is the one a
  // tower climbs *from* and floors[f] is the one its stairwell opens into.
  for (let f = 0; f + 1 < floorCount; f += 1) {
    const wantedStairs = 1 + (rng.chance(0.6) ? 1 : 0);
    const placed = placeStairs(rng, floors[f + 1], floors[f], stairs, links, roomsById, wantedStairs);
    if (!placed) {
      // Without a tower the dungeon would be cut in half; retry with a relaxed
      // request before giving up on this seed.
      placeStairs(rng, floors[f + 1], floors[f], stairs, links, roomsById, 1);
    }
  }

  for (const plan of floors) markDoors(plan);

  // A stairwell can punch straight through the tile a room was anchored on, and
  // that anchor is what the graph, the minimap and the player spawn all use.
  // Move any anchor that is no longer a place a person could stand.
  for (const plan of floors) {
    for (const room of plan.rooms) {
      if (plan.walkable(room.cx, room.cz) && !plan.isReserved(room.cx, room.cz)) continue;
      const wantX = room.x + room.w / 2;
      const wantZ = room.z + room.h / 2;
      let best = null;
      for (let dz = 0; dz < room.h; dz += 1) {
        for (let dx = 0; dx < room.w; dx += 1) {
          const x = room.x + dx;
          const z = room.z + dz;
          if (plan.get(x, z) !== TILE.ROOM || plan.isReserved(x, z)) continue;
          const d = Math.hypot(x - wantX, z - wantZ);
          if (!best || d < best.d) best = { d, x, z };
        }
      }
      // Fall back to any walkable tile the room still owns.
      if (!best) {
        for (let dz = 0; dz < room.h && !best; dz += 1) {
          for (let dx = 0; dx < room.w && !best; dx += 1) {
            const x = room.x + dx;
            const z = room.z + dz;
            if (plan.walkable(x, z)) best = { d: 0, x, z };
          }
        }
      }
      if (best) {
        room.cx = best.x;
        room.cz = best.z;
      }
    }
    // The anchor is every route's waypoint for this room, so keep it clear of
    // furniture.
    for (const room of plan.rooms) plan.reserve(room.cx, room.cz);
  }

  // Count the tiles each room actually owns, for typing and stats.
  for (const plan of floors) {
    for (let i = 0; i < plan.tiles.length; i += 1) {
      const owner = plan.owner[i];
      if (owner >= 0 && roomsById.has(owner)) roomsById.get(owner).tileCount += 1;
    }
  }

  const dungeon = {
    seed,
    width,
    height,
    floorCount,
    storeyHeight,
    floors,
    rooms,
    links,
    stairs,
    roomsById,
    props: [],
    lights: [],
    locks: [],
  };

  // Entrance on the top floor, goal as deep and as far away as possible.
  const groundRooms = floors[0].rooms;
  dungeon.start = groundRooms.length ? groundRooms[rng.int(groundRooms.length)].id : rooms[0].id;
  const reach = graphBfs(rooms, links, dungeon.start);
  const deepest = rooms
    .filter((r) => reach.dist.has(r.id))
    .sort((a, b) => (b.floor - a.floor) || (reach.dist.get(b.id) - reach.dist.get(a.id)));
  dungeon.goal = deepest.length ? deepest[0].id : dungeon.start;

  dungeon.locks = placeLocks(rng, rooms, links, dungeon.start, dungeon.goal, lockCount);
  assignRoomTypes(rng, rooms, dungeon.start, dungeon.goal, dungeon.locks);
  furnish(rng, dungeon);

  dungeon.reachableRooms = reach.dist;
  return dungeon;
}

export { graphBfs, findBridges };
