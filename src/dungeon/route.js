/**
 * Routing.
 *
 * A path through this dungeon is a tile path on each floor plus an explicit
 * walk through each stair tower, because a tower is the one place where the
 * route leaves the tile grid and follows geometry instead.
 */

import { TILE_SIZE, DIRS } from './grid.js';

/**
 * Tiles on a floor whose centre a solid prop occupies. Routing walks tile
 * centres, so a chest in the middle of a tile makes that tile unusable even
 * though a person could still squeeze past it.
 */
export function blockedTiles(dungeon, floorIndex) {
  const blocked = new Set();
  for (const prop of dungeon.props) {
    if (!prop.solid || prop.floor !== floorIndex) continue;
    blocked.add(`${Math.floor(prop.x / TILE_SIZE)},${Math.floor(prop.z / TILE_SIZE)}`);
  }
  // A stair tower is walled on three sides. Its tiles are never a through route
  // on either floor - the only way in is the mouth, which the caller handles.
  for (const stair of dungeon.stairs) {
    if (stair.lowerFloor !== floorIndex && stair.upperFloor !== floorIndex) continue;
    for (const [tx, tz] of stair.tiles) blocked.add(`${tx},${tz}`);
  }
  return blocked;
}

/** Breadth first search across a floor's walkable tiles. */
function tilePath(plan, from, to, blocked = null) {
  const width = plan.width;
  const prev = new Int32Array(width * plan.height).fill(-2);
  const startIndex = from[1] * width + from[0];
  const goalIndex = to[1] * width + to[0];
  if (!plan.walkable(from[0], from[1]) || !plan.walkable(to[0], to[1])) return null;
  prev[startIndex] = -1;
  const queue = [startIndex];
  for (let head = 0; head < queue.length; head += 1) {
    const cur = queue[head];
    if (cur === goalIndex) break;
    const x = cur % width;
    const z = (cur - x) / width;
    for (const d of DIRS) {
      const nx = x + d.dx;
      const nz = z + d.dz;
      if (!plan.walkable(nx, nz)) continue;
      if (blocked && blocked.has(`${nx},${nz}`)) continue;
      const idx = nz * width + nx;
      if (prev[idx] !== -2) continue;
      prev[idx] = cur;
      queue.push(idx);
    }
  }
  if (prev[goalIndex] === -2) return null;
  const path = [];
  for (let cur = goalIndex; cur !== -1; cur = prev[cur]) {
    const x = cur % width;
    path.push([x, (cur - x) / width]);
  }
  return path.reverse();
}

/** World waypoints down one stair tower, from its upper mouth to its base. */
function stairWaypoints(dungeon, stair) {
  const upper = dungeon.floors[stair.upperFloor];
  const lower = dungeon.floors[stair.lowerFloor];
  const [ex, ez] = stair.exit;
  const points = [];
  const exitCentre = upper.worldOf(ex, ez);
  points.push([exitCentre[0], upper.elevation, exitCentre[2]]);
  if (stair.descending) {
    points.push([...stair.descending.b]);
    points.push([...stair.descending.a]);
  }
  if (stair.ascending) {
    points.push([...stair.ascending.b]);
    points.push([...stair.ascending.a]);
  }
  // Step out of the tower mouth onto the lower floor.
  const mouthX = stair.x + stair.facing.dx;
  const mouthZ = stair.z + stair.facing.dz;
  const mouth = lower.worldOf(mouthX, mouthZ);
  points.push([mouth[0], lower.elevation, mouth[2]]);
  return points;
}

/**
 * Tile path that prefers to keep clear of furniture but will squeeze past it
 * rather than give up: a route through a cluttered hall is still a route, and
 * the player's own collision decides the rest.
 */
function walkTo(plan, from, to, blocked) {
  return tilePath(plan, from, to, blocked) || tilePath(plan, from, to, null);
}

/**
 * Build a walkable polyline from the entrance to the goal.
 *
 * Returns null when no route exists, which the caller should treat as a failed
 * dungeon rather than as a missing feature.
 */
function graphHops(dungeon, links, fromId, toId, blockedLinks) {
  const adjacency = new Map();
  for (const room of dungeon.rooms) adjacency.set(room.id, []);
  for (const link of links) {
    if (blockedLinks.has(link.id)) continue;
    adjacency.get(link.a).push([link.b, link]);
    adjacency.get(link.b).push([link.a, link]);
  }
  const prev = new Map([[fromId, null]]);
  const queue = [fromId];
  for (let head = 0; head < queue.length; head += 1) {
    const cur = queue[head];
    if (cur === toId) break;
    for (const [next, link] of adjacency.get(cur) || []) {
      if (prev.has(next)) continue;
      prev.set(next, { from: cur, link });
      queue.push(next);
    }
  }
  if (!prev.has(toId)) return null;
  const hops = [];
  for (let cur = toId; prev.get(cur); cur = prev.get(cur).from) {
    hops.push({ to: cur, from: prev.get(cur).from, link: prev.get(cur).link });
  }
  return hops.reverse();
}

export function buildRoute(dungeon, links, stops = null) {
  const startRoom = dungeon.roomsById.get(dungeon.start);
  const goalRoom = dungeon.roomsById.get(dungeon.goal);
  if (!startRoom || !goalRoom) return null;

  // The route is a tour, not a straight line: it collects each key before it
  // reaches the door that key opens, in the order the locks were placed.
  const tour = stops || [startRoom.id, ...dungeon.locks.map((l) => l.keyRoom), goalRoom.id];
  const hops = [];
  for (let i = 0; i < tour.length - 1; i += 1) {
    // Locks not yet collected on this leg are impassable.
    const stillLocked = new Set(dungeon.locks.slice(i).map((l) => l.linkId));
    const leg = graphHops(dungeon, links, tour[i], tour[i + 1], stillLocked);
    if (!leg) return null;
    hops.push(...leg);
  }

  const waypoints = [];
  const pushWorld = (plan, tile) => {
    const w = plan.worldOf(tile[0], tile[1]);
    waypoints.push([w[0], plan.elevation, w[2]]);
  };

  const blockedByFloor = dungeon.floors.map((_, i) => blockedTiles(dungeon, i));

  let currentTile = [startRoom.cx, startRoom.cz];
  let currentFloor = startRoom.floor;
  pushWorld(dungeon.floors[currentFloor], currentTile);

  for (const hop of hops) {
    const target = dungeon.roomsById.get(hop.to);
    if (hop.link.kind === 'stair') {
      const stair = hop.link.stair;
      const descending = stair.upperFloor === currentFloor;
      const upperPlan = dungeon.floors[stair.upperFloor];
      // A tower is entered only through its mouth, so the tile path stops at the
      // tile in front of it and the tower's own waypoints take over from there.
      const upperFront = [stair.exit[0] + stair.facing.dx, stair.exit[1] + stair.facing.dz];
      const lowerFront = [stair.x + stair.facing.dx, stair.z + stair.facing.dz];
      const tower = stairWaypoints(dungeon, stair);
      const plan = dungeon.floors[currentFloor];
      const gateTile = descending ? upperFront : lowerFront;
      const legs = walkTo(plan, currentTile, gateTile, blockedByFloor[currentFloor]);
      if (!legs) return null;
      for (const tile of legs.slice(1)) pushWorld(plan, tile);
      if (descending) {
        for (const point of tower) waypoints.push(point);
        currentFloor = stair.lowerFloor;
        currentTile = lowerFront;
      } else {
        for (const point of [...tower].reverse()) waypoints.push(point);
        pushWorld(upperPlan, upperFront);
        currentFloor = stair.upperFloor;
        currentTile = upperFront;
      }
    } else {
      const plan = dungeon.floors[currentFloor];
      const legs = walkTo(plan, currentTile, [target.cx, target.cz], blockedByFloor[currentFloor]);
      if (!legs) return null;
      for (const tile of legs.slice(1)) pushWorld(plan, tile);
      currentTile = [target.cx, target.cz];
    }
  }

  // Drop points that are on top of each other.
  const cleaned = [];
  for (const p of waypoints) {
    const last = cleaned[cleaned.length - 1];
    if (last && Math.hypot(p[0] - last[0], p[1] - last[1], p[2] - last[2]) < 0.05) continue;
    cleaned.push(p);
  }
  return cleaned;
}

export { tilePath };
