/**
 * Walk-surface and collision queries.
 *
 * The player never falls and never flies: every horizontal move is accepted only
 * if the destination has a walk surface within one step of the current height
 * and the body does not overlap rock or furniture. Manual movement, auto-walk
 * and the validator all go through `canOccupy`, so what the validator proves is
 * exactly what the player experiences.
 */

import { TILE, TILE_SIZE } from './grid.js';

/** Largest height change a single step may cross. */
export const STEP_LIMIT = 0.42;
export const PLAYER_RADIUS = 0.3;
export const PLAYER_HEIGHT = 1.7;

export class DungeonPhysics {
  constructor(dungeon, compiled) {
    this.dungeon = dungeon;
    this.walk = compiled.walk;
    this.blockers = compiled.blockers;
    /** Locked doors. Closed ones block; opening one is just a flag. */
    this.doors = compiled.doors || [];
    this.blockerIndex = this.buildIndex(compiled.blockers, 4);
    this.rampIndex = this.buildIndex(
      compiled.walk.map((s, i) => ({ surface: s, id: `surface:${i}`, bounds: surfaceBounds(s) })),
      6,
      (entry) => entry.bounds,
    );
  }

  buildIndex(items, cell, boundsOf) {
    const index = new Map();
    for (const item of items) {
      const b = boundsOf ? boundsOf(item) : {
        x0: item.c[0] - item.h[0], x1: item.c[0] + item.h[0],
        z0: item.c[2] - item.h[2], z1: item.c[2] + item.h[2],
      };
      const ix0 = Math.floor(b.x0 / cell);
      const ix1 = Math.floor(b.x1 / cell);
      const iz0 = Math.floor(b.z0 / cell);
      const iz1 = Math.floor(b.z1 / cell);
      for (let ix = ix0; ix <= ix1; ix += 1) {
        for (let iz = iz0; iz <= iz1; iz += 1) {
          const key = `${ix}:${iz}`;
          let bucket = index.get(key);
          if (!bucket) { bucket = []; index.set(key, bucket); }
          bucket.push(item);
        }
      }
    }
    return { index, cell };
  }

  lookup({ index, cell }, x, z) {
    return index.get(`${Math.floor(x / cell)}:${Math.floor(z / cell)}`) || [];
  }

  /**
   * Height of the walk surface under (x, z) that is reachable from `currentY`.
   * Returns null when there is nothing to stand on.
   */
  support(x, z, currentY, expectedY = null) {
    const tileX = Math.floor(x / TILE_SIZE);
    const tileZ = Math.floor(z / TILE_SIZE);
    const candidates = [];

    // Floor tiles: one lookup per floor, and floors never overlap in height.
    for (const plan of this.dungeon.floors) {
      if (!plan.walkable(tileX, tileZ)) continue;
      const dy = plan.elevation - currentY;
      if (Math.abs(dy) > STEP_LIMIT) continue;
      candidates.push({ y: plan.elevation, kind: 'tile', plan, id: `floor:${plan.index}` });
    }

    // Stair ramps and landings.
    for (const entry of this.lookup(this.rampIndex, x, z)) {
      const s = entry.surface;
      let y = null;
      if (s.kind === 'flat') {
        if (x >= s.x0 && x <= s.x1 && z >= s.z0 && z <= s.z1) y = s.y;
      } else {
        const dx = s.b[0] - s.a[0];
        const dz = s.b[2] - s.a[2];
        const lenSq = dx * dx + dz * dz;
        if (lenSq > 1e-4) {
          const t = ((x - s.a[0]) * dx + (z - s.a[2]) * dz) / lenSq;
          if (t >= 0 && t <= 1) {
            const px = s.a[0] + dx * t;
            const pz = s.a[2] + dz * t;
            if (Math.hypot(x - px, z - pz) <= s.width / 2) y = s.a[1] + (s.b[1] - s.a[1]) * t;
          }
        }
      }
      if (y === null || Math.abs(y - currentY) > STEP_LIMIT) continue;
      candidates.push({ y, kind: s.kind === 'ramp' ? 'ramp' : 'landing', surface: s, id: entry.id });
    }

    if (!candidates.length) return null;
    // The validator and auto-walk know the height the route intends, which
    // disambiguates stacked stair towers sharing one footprint.
    if (expectedY !== null) {
      candidates.sort((a, b) => Math.abs(a.y - expectedY) - Math.abs(b.y - expectedY));
      return candidates[0];
    }
    // Stairs win over the floor they pass over, otherwise take the nearest.
    const ramps = candidates.filter((c) => c.kind !== 'tile');
    const pool = ramps.length ? ramps : candidates;
    pool.sort((a, b) => Math.abs(a.y - currentY) - Math.abs(b.y - currentY));
    return pool[0];
  }

  /** True when the body at (x, z, feetY) overlaps rock, furniture or a locked door. */
  blocked(x, z, feetY, support) {
    const bodyMin = feetY + 0.05;
    const bodyMax = feetY + PLAYER_HEIGHT;
    for (const door of this.doors) {
      if (door.open) continue;
      const b = door.box;
      const bMin = b.c[1] - b.h[1];
      const bMax = b.c[1] + b.h[1];
      if (bodyMax <= bMin || bodyMin >= bMax) continue;
      const qx = Math.max(b.c[0] - b.h[0], Math.min(x, b.c[0] + b.h[0]));
      const qz = Math.max(b.c[2] - b.h[2], Math.min(z, b.c[2] + b.h[2]));
      if (Math.hypot(x - qx, z - qz) < PLAYER_RADIUS) return true;
    }
    for (const b of this.lookup(this.blockerIndex, x, z)) {
      const bMin = b.c[1] - b.h[1];
      const bMax = b.c[1] + b.h[1];
      if (bodyMax <= bMin || bodyMin >= bMax) continue;
      const qx = Math.max(b.c[0] - b.h[0], Math.min(x, b.c[0] + b.h[0]));
      const qz = Math.max(b.c[2] - b.h[2], Math.min(z, b.c[2] + b.h[2]));
      if (Math.hypot(x - qx, z - qz) < PLAYER_RADIUS) return true;
    }
    // Rock only blocks while standing on a floor tile. On a staircase the tower
    // casing is what confines the player, and an open stairwell is a hole rather
    // than a wall: stepping into one is refused by there being no support.
    if (!support || support.kind !== 'tile') return false;
    const plan = support.plan;
    const tileX = Math.floor(x / TILE_SIZE);
    const tileZ = Math.floor(z / TILE_SIZE);
    for (let dz = -1; dz <= 1; dz += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        const tx = tileX + dx;
        const tz = tileZ + dz;
        if (plan.get(tx, tz) !== TILE.ROCK) continue;
        const qx = Math.max(tx * TILE_SIZE, Math.min(x, (tx + 1) * TILE_SIZE));
        const qz = Math.max(tz * TILE_SIZE, Math.min(z, (tz + 1) * TILE_SIZE));
        if (Math.hypot(x - qx, z - qz) < PLAYER_RADIUS) return true;
      }
    }
    return false;
  }

  /**
   * The surface the player would end up on, or null if the position is unusable.
   * Callers that need to tell two stacked surfaces apart - the validator's flood
   * fill above all - key on `support.id` rather than on the height, because a
   * stair tread and the landing above it can sit only centimetres apart.
   */
  occupancy(x, z, currentY, expectedY = null) {
    const support = this.support(x, z, currentY, expectedY);
    if (!support) return null;
    if (this.blocked(x, z, support.y, support)) return null;
    return support;
  }

  /** Height the player would stand at, or null if the position is unusable. */
  canOccupy(x, z, currentY, expectedY = null) {
    const support = this.occupancy(x, z, currentY, expectedY);
    return support ? support.y : null;
  }

  /**
   * Advance the player, sliding along whatever it cannot pass. Sub-stepping
   * keeps fast movement from tunnelling through thin walls.
   */
  move(player, dx, dz) {
    const distance = Math.hypot(dx, dz);
    if (distance < 1e-9) return;
    const steps = Math.max(1, Math.ceil(distance / 0.06));
    const sx = dx / steps;
    const sz = dz / steps;
    for (let i = 0; i < steps; i += 1) {
      const tryMove = (mx, mz) => {
        if (Math.abs(mx) + Math.abs(mz) < 1e-9) return false;
        const y = this.canOccupy(player.x + mx, player.z + mz, player.y);
        if (y === null) return false;
        player.x += mx;
        player.z += mz;
        player.y = y;
        return true;
      };
      if (tryMove(sx, sz)) continue;
      // Try each axis on its own so walls slide instead of sticking.
      if (Math.abs(sx) >= Math.abs(sz)) {
        if (!tryMove(sx, 0)) tryMove(0, sz);
      } else if (!tryMove(0, sz)) {
        tryMove(sx, 0);
      }
    }
  }

  /** Index of the floor whose elevation the player is standing closest to. */
  floorAt(y) {
    let best = 0;
    let bestDist = Infinity;
    this.dungeon.floors.forEach((plan, i) => {
      const d = Math.abs(plan.elevation - y);
      if (d < bestDist) { bestDist = d; best = i; }
    });
    return best;
  }
}

function surfaceBounds(s) {
  if (s.kind === 'flat') return { x0: s.x0, x1: s.x1, z0: s.z0, z1: s.z1 };
  const hw = s.width / 2;
  return {
    x0: Math.min(s.a[0], s.b[0]) - hw,
    x1: Math.max(s.a[0], s.b[0]) + hw,
    z0: Math.min(s.a[2], s.b[2]) - hw,
    z1: Math.max(s.a[2], s.b[2]) + hw,
  };
}

export { surfaceBounds };
