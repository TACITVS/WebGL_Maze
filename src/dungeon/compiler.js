/**
 * Compiles a tile-based dungeon into renderable geometry, walk surfaces and
 * collision data.
 *
 * Everything here is derived from the tile map, so the geometry can never
 * disagree with the layout: if a tile is walkable there is a floor slab under
 * it, and if it is not there is a wall in the way.
 */

import { TILE, TILE_SIZE, DIRS, FloorPlan, greedyRects, isWalkable, isOpen } from './grid.js';
import { SHAFT_ACROSS, SHAFT_ALONG } from './generator.js';
import { rgb } from './palette.js';

/** Renderable axis-aligned box. `emissive` lifts a surface out of the lighting. */
export class Box {
  constructor(cx, cy, cz, hx, hy, hz, color, kind = 'solid', emissive = 0, floor = -1) {
    this.c = [cx, cy, cz];
    this.h = [hx, hy, hz];
    this.color = color;
    this.kind = kind;
    this.emissive = emissive;
    this.floor = floor;
  }
}

/** Extra vertical separation between floors in the cutaway view. */
export const EXPLODE_GAP = 11;

const WALL_THICKNESS = 0.16;
const STAIR_MAX_RISER = 0.19;
const STAIR_WIDTH = 1.4;

function shade(color, factor) {
  return [color[0] * factor, color[1] * factor, color[2] * factor];
}

/**
 * Deterministic per-surface tone variation.
 *
 * Slabs are merged into big rectangles, so nudging each one's colour breaks the
 * dungeon up into patches of stone instead of one flat painted tone. It is
 * derived from position, so it stays put between rebuilds of the same seed.
 */
function weather(color, x, z) {
  const h = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
  const n = h - Math.floor(h);
  const f = 0.86 + 0.28 * n;
  return [color[0] * f, color[1] * f, color[2] * f];
}

/** Ceiling height for a tile: corridors are deliberately tighter than rooms. */
function ceilingFor(plan, tile) {
  if (tile === TILE.CORRIDOR || tile === TILE.DOOR) return plan.ceilingCorridor;
  return plan.ceilingRoom;
}

/**
 * Emit merged wall runs for one floor.
 *
 * A wall belongs on any edge between open space and bedrock, and as a railing
 * on any edge between walkable floor and an open stairwell - minus the mouths
 * the generator explicitly opened.
 */
function buildWalls(plan, boxes, wallColor) {
  const { width, height } = plan;
  const needsWall = (x, z, nx, nz) => {
    const here = plan.get(x, z);
    const there = plan.inside(nx, nz) ? plan.get(nx, nz) : TILE.ROCK;
    if (!isOpen(here)) return 0;
    if (there === TILE.ROCK) return ceilingFor(plan, here);
    if (isWalkable(here) && there === TILE.VOID) {
      if (plan.openEdges.has(FloorPlan.edgeKey(x, z, nx, nz))) return 0;
      return ceilingFor(plan, here);
    }
    return 0;
  };

  // North and south faces merge along X; east and west merge along Z.
  for (const d of DIRS) {
    const alongX = d.dz !== 0;
    const outer = alongX ? height : width;
    const inner = alongX ? width : height;
    for (let a = 0; a < outer; a += 1) {
      let runStart = -1;
      let runHeight = 0;
      for (let b = 0; b <= inner; b += 1) {
        const x = alongX ? b : a;
        const z = alongX ? a : b;
        const h = b < inner ? needsWall(x, z, x + d.dx, z + d.dz) : 0;
        if (h > 0 && (runStart < 0 || Math.abs(h - runHeight) < 1e-6)) {
          if (runStart < 0) { runStart = b; runHeight = h; }
          continue;
        }
        if (runStart >= 0) {
          const len = (b - runStart) * TILE_SIZE;
          const midB = (runStart + b) / 2 * TILE_SIZE;
          // The wall plane sits on the shared tile edge.
          const edge = (a + (d.dx + d.dz > 0 ? 1 : 0)) * TILE_SIZE;
          const cx = alongX ? midB : edge;
          const cz = alongX ? edge : midB;
          const hx = alongX ? len / 2 : WALL_THICKNESS / 2;
          const hz = alongX ? WALL_THICKNESS / 2 : len / 2;
          boxes.push(new Box(cx, plan.elevation + runHeight / 2, cz, hx, runHeight / 2, hz, weather(wallColor, cx, cz), 'wall', 0, plan.index));
          runStart = -1;
        }
        if (h > 0) { runStart = b; runHeight = h; }
      }
    }
  }
}

/**
 * Close the gap above a threshold where two open tiles have different ceiling
 * heights - without this you can see straight over a corridor's ceiling into
 * the rock above it.
 */
function buildLintels(plan, boxes, color) {
  const { width, height } = plan;
  for (const d of DIRS) {
    if (d.dx < 0 || d.dz < 0) continue; // each shared edge only once
    for (let z = 0; z < height; z += 1) {
      for (let x = 0; x < width; x += 1) {
        const here = plan.get(x, z);
        const there = plan.get(x + d.dx, z + d.dz);
        if (!isOpen(here) || !isOpen(there)) continue;
        const a = ceilingFor(plan, here);
        const b = ceilingFor(plan, there);
        if (Math.abs(a - b) < 0.02) continue;
        const low = Math.min(a, b);
        const high = Math.max(a, b);
        const span = high - low;
        // The lintel sits on the shared edge: east edges are a plane in X, south
        // edges a plane in Z.
        const cx = d.dx ? (x + 1) * TILE_SIZE : (x + 0.5) * TILE_SIZE;
        const cz = d.dx ? (z + 0.5) * TILE_SIZE : (z + 1) * TILE_SIZE;
        boxes.push(new Box(
          cx,
          plan.elevation + low + span / 2,
          cz,
          d.dx ? WALL_THICKNESS / 2 : TILE_SIZE / 2,
          span / 2,
          d.dx ? TILE_SIZE / 2 : WALL_THICKNESS / 2,
          color,
          'wall',
          0,
          plan.index,
        ));
      }
    }
  }
}

/** Floor slabs and ceiling slabs, merged into as few boxes as the mask allows. */
function buildSlabs(plan, boxes, stairs) {
  const { width, height } = plan;
  const floorMask = new Uint8Array(width * height);
  const roomCeil = new Uint8Array(width * height);
  const corrCeil = new Uint8Array(width * height);
  for (let z = 0; z < height; z += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = z * width + x;
      const t = plan.get(x, z);
      if (!isWalkable(t)) continue;
      floorMask[i] = 1;
      if (t === TILE.CORRIDOR || t === TILE.DOOR) corrCeil[i] = 1;
      else roomCeil[i] = 1;
    }
  }
  for (const stair of stairs) {
    // A stair tower punches through the ceiling of the floor it climbs from.
    if (stair.lowerFloor === plan.index) {
      for (const [tx, tz] of stair.tiles) {
        if (!plan.inside(tx, tz)) continue;
        roomCeil[tz * width + tx] = 0;
        corrCeil[tz * width + tx] = 0;
      }
    }
    // On the floor it opens into, the stairwell is a hole in the floor but still
    // wants a ceiling over it - otherwise you can look up out of the dungeon.
    if (stair.upperFloor === plan.index) {
      for (const [tx, tz] of stair.tiles) {
        if (!plan.inside(tx, tz)) continue;
        if (!corrCeil[tz * width + tx]) roomCeil[tz * width + tx] = 1;
      }
    }
  }

  const emit = (mask, y, thickness, color, kind) => {
    for (const r of greedyRects(mask, width, height)) {
      boxes.push(new Box(
        (r.x + r.w / 2) * TILE_SIZE,
        y,
        (r.z + r.h / 2) * TILE_SIZE,
        (r.w * TILE_SIZE) / 2,
        thickness / 2,
        (r.h * TILE_SIZE) / 2,
        weather(color, r.x, r.z),
        kind,
        0,
        plan.index,
      ));
    }
  };

  emit(floorMask, plan.elevation - 0.1, 0.2, plan.theme.floor, 'floor');
  emit(roomCeil, plan.elevation + plan.ceilingRoom, 0.18, plan.theme.ceiling, 'ceiling');
  emit(corrCeil, plan.elevation + plan.ceilingCorridor, 0.18, shade(plan.theme.ceiling, 0.9), 'ceiling');
}

/**
 * Local frame of a stair tower.
 *
 * `u` runs from the tower mouth to its back wall, `v` runs across the two
 * flights. Working in this frame means one implementation covers all four
 * orientations instead of four near-identical special cases.
 */
function stairFrame(stair) {
  let xmin = Infinity;
  let xmax = -Infinity;
  let zmin = Infinity;
  let zmax = -Infinity;
  for (const [tx, tz] of stair.tiles) {
    xmin = Math.min(xmin, tx);
    xmax = Math.max(xmax, tx);
    zmin = Math.min(zmin, tz);
    zmax = Math.max(zmax, tz);
  }
  const wx0 = xmin * TILE_SIZE;
  const wx1 = (xmax + 1) * TILE_SIZE;
  const wz0 = zmin * TILE_SIZE;
  const wz1 = (zmax + 1) * TILE_SIZE;
  const A = [stair.alongX, stair.alongZ];
  const C = [stair.acrossX, stair.acrossZ];
  // Pick the AABB corner that both local axes point away from.
  const originX = (A[0] > 0 || C[0] > 0) ? wx0 : wx1;
  const originZ = (A[1] > 0 || C[1] > 0) ? wz0 : wz1;
  return {
    origin: [originX, originZ],
    A,
    C,
    along: SHAFT_ALONG * TILE_SIZE,
    across: SHAFT_ACROSS * TILE_SIZE,
    at: (u, v) => [originX + A[0] * u + C[0] * v, originZ + A[1] * u + C[1] * v],
  };
}

/**
 * Build one switchback stair tower: two flights, three landings, and a stone
 * casing that encloses everything but the mouth.
 */
function buildStair(dungeon, stair, boxes, walk, blockers) {
  const lower = dungeon.floors[stair.lowerFloor];
  const upper = dungeon.floors[stair.upperFloor];
  const yLo = lower.elevation;
  const yUp = upper.elevation;
  const rise = yUp - yLo;
  const midY = yLo + rise / 2;
  const frame = stairFrame(stair);
  const theme = lower.theme;
  const stepColor = shade(theme.accent, 0.9);

  const laneA = 0.5 * TILE_SIZE;
  const laneB = (SHAFT_ACROSS - 0.5) * TILE_SIZE;
  const uMouth = 0.95;
  const uBack = (SHAFT_ALONG - 1) * TILE_SIZE - 0.45;

  const flight = (v, u0, u1, y0, y1) => {
    const p0 = frame.at(u0, v);
    const p1 = frame.at(u1, v);
    const a = [p0[0], y0, p0[1]];
    const b = [p1[0], y1, p1[1]];
    const steps = Math.max(6, Math.ceil(Math.abs(y1 - y0) / STAIR_MAX_RISER));
    const run = Math.abs(u1 - u0);
    const tread = run / steps;
    const alongX = Math.abs(b[0] - a[0]) > Math.abs(b[2] - a[2]);
    for (let i = 0; i < steps; i += 1) {
      const t = (i + 0.5) / steps;
      const px = a[0] + (b[0] - a[0]) * t;
      const pz = a[2] + (b[2] - a[2]) * t;
      const top = y0 + (y1 - y0) * ((i + 1) / steps);
      const box = new Box(
        px,
        top - 0.08,
        pz,
        alongX ? tread * 0.55 : STAIR_WIDTH / 2,
        0.08,
        alongX ? STAIR_WIDTH / 2 : tread * 0.55,
        stepColor,
        'stair',
        0,
        stair.lowerFloor,
      );
      boxes.push(box);
    }
    walk.push({ kind: 'ramp', a, b, width: STAIR_WIDTH, tag: `stair:${stair.id}` });
    return { a, b };
  };

  // Keep the flights on the stair so routing can walk a tower without having to
  // re-derive its geometry.
  stair.ascending = flight(laneA, uMouth, uBack, yLo, midY);
  stair.descending = flight(laneB, uBack, uMouth, midY, yUp);
  stair.midY = midY;

  // Landings. The mid landing is what joins the two flights.
  const addLanding = (uCentre, vCentre, uHalf, vHalf, y, color) => {
    const p = frame.at(uCentre, vCentre);
    const hx = Math.abs(frame.A[0]) * uHalf + Math.abs(frame.C[0]) * vHalf;
    const hz = Math.abs(frame.A[1]) * uHalf + Math.abs(frame.C[1]) * vHalf;
    boxes.push(new Box(p[0], y - 0.08, p[1], hx, 0.08, hz, color, 'landing', 0, stair.lowerFloor));
    walk.push({
      kind: 'flat',
      x0: p[0] - hx, x1: p[0] + hx,
      z0: p[1] - hz, z1: p[1] + hz,
      y,
      tag: `landing:${stair.id}`,
    });
  };
  const landColor = shade(theme.accent, 0.75);
  addLanding(uBack + 0.5, frame.across / 2, 0.55, frame.across / 2 - 0.12, midY, landColor);
  addLanding(uMouth / 2, laneA, uMouth / 2, STAIR_WIDTH / 2, yLo, landColor);
  addLanding(uMouth / 2, laneB, uMouth / 2, STAIR_WIDTH / 2, yUp, landColor);

  // Casing: three sides from the lower floor all the way to the upper floor, so
  // the shaft is a solid tower rather than a hole with a view into the void.
  const casingColor = shade(lower.theme.wall, 0.85);
  const casingHeight = (yUp + upper.ceilingRoom) - yLo;
  const casingY = yLo + casingHeight / 2;
  const addCasing = (uCentre, vCentre, uHalf, vHalf) => {
    const p = frame.at(uCentre, vCentre);
    const hx = Math.abs(frame.A[0]) * uHalf + Math.abs(frame.C[0]) * vHalf;
    const hz = Math.abs(frame.A[1]) * uHalf + Math.abs(frame.C[1]) * vHalf;
    const box = new Box(p[0], casingY, p[1], hx, casingHeight / 2, hz, casingColor, 'casing', 0, stair.lowerFloor);
    boxes.push(box);
    blockers.push(box);
  };
  const t = WALL_THICKNESS / 2;
  addCasing(frame.along - t, frame.across / 2, t, frame.across / 2);       // back
  addCasing(frame.along / 2, t, frame.along / 2, t);                       // side by lane A
  addCasing(frame.along / 2, frame.across - t, frame.along / 2, t);        // side by lane B
}

/** Turn a furniture item into boxes, and into a collider when it is solid. */
function buildProp(prop, boxes, blockers) {
  const y = prop.y;
  const accent = prop.accent || [0.5, 0.45, 0.4];
  const push = (box, blocking) => {
    box.floor = prop.floor;
    boxes.push(box);
    if (blocking) blockers.push(box);
  };
  switch (prop.kind) {
    case 'pillar':
      push(new Box(prop.x, y + 1.6, prop.z, 0.32, 1.6, 0.32, rgb('stone', 2), 'prop'), true);
      push(new Box(prop.x, y + 0.12, prop.z, 0.46, 0.12, 0.46, rgb('stone', 1), 'prop'), false);
      push(new Box(prop.x, y + 3.1, prop.z, 0.44, 0.14, 0.44, rgb('stone', 3), 'prop'), false);
      break;
    case 'crate':
      push(new Box(prop.x, y + 0.34, prop.z, 0.34, 0.34, 0.34, rgb('bone', 1), 'prop'), true);
      push(new Box(prop.x, y + 0.69, prop.z, 0.36, 0.03, 0.36, rgb('verdigris', 2), 'prop'), false);
      break;
    case 'shelf':
      push(new Box(prop.x, y + 0.95, prop.z, 0.55, 0.95, 0.22, rgb('bone', 0), 'prop'), true);
      push(new Box(prop.x, y + 1.3, prop.z, 0.5, 0.06, 0.24, rgb('bone', 2), 'prop'), false);
      push(new Box(prop.x, y + 0.7, prop.z, 0.5, 0.06, 0.24, rgb('bone', 2), 'prop'), false);
      break;
    case 'sarcophagus':
      push(new Box(prop.x, y + 0.35, prop.z, 0.62, 0.35, 0.34, rgb('stone', 2), 'prop'), true);
      push(new Box(prop.x, y + 0.76, prop.z, 0.55, 0.08, 0.28, rgb('bone', 2), 'prop'), false);
      push(new Box(prop.x, y + 0.5, prop.z, 0.64, 0.05, 0.36, rgb('verdigris', 2), 'prop'), false);
      break;
    case 'altar':
      push(new Box(prop.x, y + 0.45, prop.z, 0.55, 0.45, 0.55, rgb('stone', 2), 'prop'), true);
      push(new Box(prop.x, y + 0.94, prop.z, 0.62, 0.06, 0.62, rgb('stone', 3), 'prop'), false);
      push(new Box(prop.x, y + 1.12, prop.z, 0.2, 0.2, 0.2, accent, 'prop', 0.9), false);
      break;
    case 'chest':
      push(new Box(prop.x, y + 0.28, prop.z, 0.42, 0.28, 0.30, rgb('bone', 1), 'prop'), true);
      push(new Box(prop.x, y + 0.60, prop.z, 0.42, 0.10, 0.30, rgb('ember', 3), 'prop', 0.35), false);
      push(new Box(prop.x, y + 0.42, prop.z, 0.44, 0.04, 0.32, rgb('verdigris', 2), 'prop'), false);
      break;
    case 'brazier':
      push(new Box(prop.x, y + 0.35, prop.z, 0.20, 0.35, 0.20, rgb('verdigris', 1), 'prop'), true);
      push(new Box(prop.x, y + 0.68, prop.z, 0.28, 0.06, 0.28, rgb('verdigris', 2), 'prop'), false);
      push(new Box(prop.x, y + 0.84, prop.z, 0.24, 0.16, 0.24, prop.accent || rgb('ember', 4), 'flame', 1.0), false);
      break;
    case 'torch': {
      const d = prop.dir || { dx: 0, dz: 1 };
      push(new Box(prop.x, y + 1.85, prop.z, 0.09 + Math.abs(d.dz) * 0.05, 0.28, 0.09 + Math.abs(d.dx) * 0.05, rgb('verdigris', 1), 'prop'), false);
      push(new Box(prop.x, y + 2.12, prop.z, 0.13, 0.16, 0.13, prop.color || rgb('ember', 4), 'flame', 1.0), false);
      break;
    }
    case 'key':
      // Only the plinth is geometry; the key itself is a sprite, so it reads as
      // an object rather than a floating cube.
      push(new Box(prop.x, y + 0.08, prop.z, 0.32, 0.08, 0.32, rgb('stone', 2), 'prop'), false);
      push(new Box(prop.x, y + 0.17, prop.z, 0.22, 0.03, 0.22, shade(prop.color, 0.5), 'prop', 0.4), false);
      break;
    case 'portal':
      push(new Box(prop.x, y + 0.06, prop.z, 0.75, 0.06, 0.75, rgb('ice', 2), 'prop', 0.45), false);
      push(new Box(prop.x, y + 0.10, prop.z, 0.52, 0.05, 0.52, rgb('ice', 3), 'prop', 0.7), false);
      break;
    default:
      break;
  }
}

/**
 * Compile a generated dungeon into everything the renderer and the physics need.
 */
export function compileDungeon(dungeon) {
  const boxes = [];
  const walk = [];
  const blockers = [];

  for (const plan of dungeon.floors) {
    buildSlabs(plan, boxes, dungeon.stairs);
    buildWalls(plan, boxes, plan.theme.wall);
    buildLintels(plan, boxes, shade(plan.theme.wall, 0.85));
  }

  for (const stair of dungeon.stairs) buildStair(dungeon, stair, boxes, walk, blockers);

  // Locked doors are kept out of the static mesh: they are opened at runtime, so
  // the app re-uploads just this small list instead of the whole world.
  const doors = [];
  for (const link of dungeon.links) {
    if (!link.locked) continue;
    // A lock on a staircase is a gate across the tower mouth; a lock on a
    // corridor is a door across its threshold. Either way it must be a real
    // obstacle, or the key guards nothing.
    const marker = link.kind === 'stair'
      ? stairGateMarker(dungeon, link.stair)
      : doorMarker(dungeon, link);
    if (!marker) continue;
    const plan = dungeon.floors[marker.floor];
    const box = new Box(marker.x, plan.elevation + 1.15, marker.z, marker.hx, 1.15, marker.hz, link.locked.color, 'door', 0.4, marker.floor);
    const door = { link, box, lock: link.locked, open: false, floor: marker.floor, x: marker.x, z: marker.z };
    doors.push(door);
    link.door = door;
  }

  for (const prop of dungeon.props) buildProp(prop, boxes, blockers);

  return { boxes, cutaway: buildCutaway(dungeon, boxes), walk, blockers, doors };
}

/**
 * Derive the cutaway view: roofs off, walls cut down to knee height, and the
 * floors pulled apart vertically so all of them can be seen at once. A stair
 * tower becomes a single connector column, because its real flights would be
 * left dangling in mid air once the floors are separated.
 */
function buildCutaway(dungeon, boxes) {
  const out = [];
  const offsetFor = (floor) => (floor < 0 ? 0 : -floor * EXPLODE_GAP);
  for (const box of boxes) {
    if (box.kind === 'ceiling') continue;
    // The tower's own geometry spans two floors, so it is replaced below.
    if (box.kind === 'stair' || box.kind === 'landing' || box.kind === 'casing') continue;
    const dy = offsetFor(box.floor);
    if (box.kind === 'wall') {
      const plan = dungeon.floors[box.floor];
      const base = plan ? plan.elevation : box.c[1];
      out.push(new Box(box.c[0], base + 0.55 + dy, box.c[2], box.h[0], 0.55, box.h[2], box.color, 'wall', 0, box.floor));
      continue;
    }
    out.push(new Box(box.c[0], box.c[1] + dy, box.c[2], box.h[0], box.h[1], box.h[2], box.color, box.kind, box.emissive, box.floor));
  }

  for (const stair of dungeon.stairs) {
    const frame = stairFrame(stair);
    const centre = frame.at(frame.along / 2, frame.across / 2);
    const upper = dungeon.floors[stair.upperFloor];
    const lower = dungeon.floors[stair.lowerFloor];
    const top = upper.elevation + offsetFor(stair.upperFloor);
    const bottom = lower.elevation + offsetFor(stair.lowerFloor);
    out.push(new Box(
      centre[0],
      (top + bottom) / 2,
      centre[1],
      0.55,
      Math.abs(top - bottom) / 2,
      0.55,
      shade(lower.theme.accent, 1.1),
      'connector',
      0.35,
      stair.lowerFloor,
    ));
  }
  return out;
}

/**
 * Where to bar a stair tower: across its mouth on the floor it opens into, which
 * is the single tile every descent has to pass through.
 */
function stairGateMarker(dungeon, stair) {
  if (!stair) return null;
  const plan = dungeon.floors[stair.upperFloor];
  const [ex, ez] = stair.exit;
  const centre = plan.worldOf(ex, ez);
  const acrossX = stair.facing.dx !== 0;
  return {
    floor: stair.upperFloor,
    x: centre[0] + stair.facing.dx * (TILE_SIZE / 2),
    z: centre[2] + stair.facing.dz * (TILE_SIZE / 2),
    hx: acrossX ? 0.12 : TILE_SIZE / 2,
    hz: acrossX ? TILE_SIZE / 2 : 0.12,
  };
}

/**
 * Find the tile a locked corridor passes through, so the door slab lands on the
 * actual threshold rather than on the room centre.
 */
function doorMarker(dungeon, link) {
  const a = dungeon.roomsById.get(link.a);
  const b = dungeon.roomsById.get(link.b);
  if (!a || !b || a.floor !== b.floor) return null;
  const plan = dungeon.floors[a.floor];
  let best = null;
  for (let z = 0; z < plan.height; z += 1) {
    for (let x = 0; x < plan.width; x += 1) {
      if (plan.get(x, z) !== TILE.DOOR) continue;
      // Prefer the threshold closest to the midpoint of the two room centres.
      const mx = (a.cx + b.cx) / 2;
      const mz = (a.cz + b.cz) / 2;
      const d = Math.hypot(x - mx, z - mz);
      if (!best || d < best.d) best = { d, x, z };
    }
  }
  if (!best) return null;
  // Orient the slab across the corridor.
  const openNS = plan.walkable(best.x, best.z - 1) && plan.walkable(best.x, best.z + 1);
  return {
    floor: a.floor,
    x: (best.x + 0.5) * TILE_SIZE,
    z: (best.z + 0.5) * TILE_SIZE,
    hx: openNS ? TILE_SIZE / 2 : 0.12,
    hz: openNS ? 0.12 : TILE_SIZE / 2,
    tile: [best.x, best.z],
  };
}

export { doorMarker, stairFrame };
