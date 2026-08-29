/**
 * Tile grid primitives shared by the generator and the geometry compiler.
 *
 * A dungeon floor is a plain tile map. Everything downstream - walls, collision,
 * walkability, the minimap - is derived from it, so the tile map is the single
 * source of truth and the 3D geometry can never disagree with the layout.
 */

/** World size of one tile, in metres. */
export const TILE_SIZE = 1.7;

export const TILE = Object.freeze({
  ROCK: 0,        // solid bedrock, never entered
  ROOM: 1,        // room floor
  CORRIDOR: 2,    // corridor floor
  DOOR: 3,        // corridor tile forming a threshold into a room
  STAIR_EXIT: 4,  // top landing of a stair tower, walkable
  VOID: 5,        // open stairwell above a stair tower, no floor
});

/** Tiles a player can stand on. */
export function isWalkable(tile) {
  return tile === TILE.ROOM || tile === TILE.CORRIDOR || tile === TILE.DOOR || tile === TILE.STAIR_EXIT;
}

/** Tiles that are open air rather than bedrock (walkable tiles plus stairwells). */
export function isOpen(tile) {
  return isWalkable(tile) || tile === TILE.VOID;
}

export const DIRS = Object.freeze([
  { dx: 0, dz: -1, name: 'N' },
  { dx: 1, dz: 0, name: 'E' },
  { dx: 0, dz: 1, name: 'S' },
  { dx: -1, dz: 0, name: 'W' },
]);

/**
 * One floor of the dungeon: a tile map plus the rooms carved into it.
 */
export class FloorPlan {
  constructor(index, width, height, elevation) {
    this.index = index;
    this.width = width;
    this.height = height;
    this.elevation = elevation;
    this.tiles = new Uint8Array(width * height); // starts as solid ROCK
    this.rooms = [];
    /** Tile edges where the wall builder must leave a gap (stair mouths). */
    this.openEdges = new Set();
    /** Which room owns each tile, or -1. */
    this.owner = new Int16Array(width * height).fill(-1);
    /** Tiles claimed by structure (stair towers) where props must not spawn. */
    this.reserved = new Uint8Array(width * height);
    /**
     * Tiles a stair tower's casing walls off. They stay walkable - you enter the
     * tower through its mouth - but nothing may *route through* them, so later
     * connectivity checks must treat them as solid.
     */
    this.structure = new Uint8Array(width * height);
  }

  inside(x, z) {
    return x >= 0 && z >= 0 && x < this.width && z < this.height;
  }

  get(x, z) {
    if (!this.inside(x, z)) return TILE.ROCK;
    return this.tiles[z * this.width + x];
  }

  set(x, z, value) {
    if (!this.inside(x, z)) return;
    this.tiles[z * this.width + x] = value;
  }

  ownerAt(x, z) {
    if (!this.inside(x, z)) return -1;
    return this.owner[z * this.width + x];
  }

  setOwner(x, z, roomId) {
    if (!this.inside(x, z)) return;
    this.owner[z * this.width + x] = roomId;
  }

  walkable(x, z) {
    return isWalkable(this.get(x, z));
  }

  isReserved(x, z) {
    if (!this.inside(x, z)) return true;
    return this.reserved[z * this.width + x] === 1;
  }

  reserve(x, z) {
    if (!this.inside(x, z)) return;
    this.reserved[z * this.width + x] = 1;
  }

  blockStructure(x, z) {
    if (!this.inside(x, z)) return;
    this.structure[z * this.width + x] = 1;
  }

  isStructure(x, z) {
    if (!this.inside(x, z)) return false;
    return this.structure[z * this.width + x] === 1;
  }

  /** Key identifying the shared edge between two adjacent tiles, order independent. */
  static edgeKey(x0, z0, x1, z1) {
    return x0 < x1 || (x0 === x1 && z0 < z1)
      ? `${x0},${z0}|${x1},${z1}`
      : `${x1},${z1}|${x0},${z0}`;
  }

  /** World-space centre of a tile. */
  worldOf(x, z) {
    return [(x + 0.5) * TILE_SIZE, this.elevation, (z + 0.5) * TILE_SIZE];
  }
}

/**
 * Decompose a boolean tile mask into a small set of axis-aligned rectangles.
 *
 * The renderer draws boxes, so emitting one box per tile would be ruinous. This
 * greedy pass grows each rectangle as wide then as tall as it can, which turns a
 * typical floor into a few dozen slabs instead of a few thousand.
 */
export function greedyRects(mask, width, height) {
  const used = new Uint8Array(width * height);
  const rects = [];
  for (let z = 0; z < height; z += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = z * width + x;
      if (!mask[i] || used[i]) continue;
      let w = 1;
      while (x + w < width && mask[i + w] && !used[i + w]) w += 1;
      let h = 1;
      grow: while (z + h < height) {
        const row = (z + h) * width + x;
        for (let k = 0; k < w; k += 1) {
          if (!mask[row + k] || used[row + k]) break grow;
        }
        h += 1;
      }
      for (let dz = 0; dz < h; dz += 1) {
        for (let dx = 0; dx < w; dx += 1) used[(z + dz) * width + x + dx] = 1;
      }
      rects.push({ x, z, w, h });
    }
  }
  return rects;
}

/**
 * Flood fill walkable tiles from a seed tile. Returns the visited mask.
 */
export function floodFill(plan, startX, startZ) {
  const seen = new Uint8Array(plan.width * plan.height);
  if (!plan.walkable(startX, startZ)) return seen;
  const stack = [startX, startZ];
  seen[startZ * plan.width + startX] = 1;
  while (stack.length) {
    const z = stack.pop();
    const x = stack.pop();
    for (const d of DIRS) {
      const nx = x + d.dx;
      const nz = z + d.dz;
      if (!plan.inside(nx, nz)) continue;
      const i = nz * plan.width + nx;
      if (seen[i] || !plan.walkable(nx, nz)) continue;
      seen[i] = 1;
      stack.push(nx, nz);
    }
  }
  return seen;
}

/**
 * Would the floor still be one connected walkable region if these tiles were
 * taken away? Used before committing a stair tower, because punching a
 * stairwell through a room - or dropping a tower into one - can quietly cut a
 * floor in half.
 */
export function connectedWithout(plan, removed) {
  const usable = [];
  const blocked = new Set(removed.map(([x, z]) => `${x},${z}`));
  for (let z = 0; z < plan.height; z += 1) {
    for (let x = 0; x < plan.width; x += 1) {
      if (!plan.walkable(x, z)) continue;
      if (plan.isStructure(x, z)) blocked.add(`${x},${z}`);
      if (blocked.has(`${x},${z}`)) continue;
      usable.push([x, z]);
    }
  }
  if (!usable.length) return false;
  const seen = new Set([`${usable[0][0]},${usable[0][1]}`]);
  const stack = [usable[0]];
  while (stack.length) {
    const [x, z] = stack.pop();
    for (const d of DIRS) {
      const nx = x + d.dx;
      const nz = z + d.dz;
      const key = `${nx},${nz}`;
      if (seen.has(key) || blocked.has(key)) continue;
      if (!plan.walkable(nx, nz)) continue;
      seen.add(key);
      stack.push([nx, nz]);
    }
  }
  return seen.size === usable.length;
}
