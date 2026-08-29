/**
 * Automap.
 *
 * Draws the floor the player is standing on, revealing tiles as they are walked
 * past. Fog of war is what turns a map into a record of the expedition.
 */

import { TILE, TILE_SIZE } from './grid.js';
import { ROOM_TYPE } from './generator.js';

const ROOM_TINT = {
  [ROOM_TYPE.ENTRANCE]: '#2c4f63',
  [ROOM_TYPE.BOSS]: '#5a2733',
  [ROOM_TYPE.VAULT]: '#4d4326',
  [ROOM_TYPE.SHRINE]: '#3d3055',
  [ROOM_TYPE.LIBRARY]: '#33402f',
  [ROOM_TYPE.BARRACKS]: '#3a3630',
  [ROOM_TYPE.CISTERN]: '#25404a',
  [ROOM_TYPE.CRYPT]: '#38323c',
  [ROOM_TYPE.HALL]: '#2f3a44',
  [ROOM_TYPE.CHAMBER]: '#2b333b',
};

export class AutoMap {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.explored = null;
  }

  reset(dungeon) {
    this.dungeon = dungeon;
    this.explored = dungeon.floors.map((f) => new Uint8Array(f.width * f.height));
  }

  /** Reveal the tiles around the player. */
  observe(floorIndex, x, z, radius = 4) {
    if (!this.explored) return;
    const plan = this.dungeon.floors[floorIndex];
    if (!plan) return;
    const tx = Math.floor(x / TILE_SIZE);
    const tz = Math.floor(z / TILE_SIZE);
    const mask = this.explored[floorIndex];
    for (let dz = -radius; dz <= radius; dz += 1) {
      for (let dx = -radius; dx <= radius; dx += 1) {
        if (dx * dx + dz * dz > radius * radius) continue;
        const nx = tx + dx;
        const nz = tz + dz;
        if (!plan.inside(nx, nz)) continue;
        mask[nz * plan.width + nx] = 1;
      }
    }
  }

  draw(dungeon, player, floorIndex, options = {}) {
    // A fixed low backing-store size, scaled up by CSS, so the map is drawn with
    // the same size pixels as the rest of the screen.
    const size = this.pixelSize || 104;
    if (this.canvas.width !== size || this.canvas.height !== size) {
      this.canvas.width = size;
      this.canvas.height = size;
    }
    const rect = { width: size, height: size };
    const c = this.ctx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.imageSmoothingEnabled = false;
    c.fillStyle = '#05080b';
    c.fillRect(0, 0, rect.width, rect.height);

    const plan = dungeon.floors[floorIndex];
    if (!plan) return;
    const pad = 6;
    const scale = Math.min((rect.width - pad * 2) / plan.width, (rect.height - pad * 2) / plan.height);
    const ox = (rect.width - plan.width * scale) / 2;
    const oz = (rect.height - plan.height * scale) / 2;
    const mask = this.explored?.[floorIndex];
    const revealAll = options.revealAll;

    for (let z = 0; z < plan.height; z += 1) {
      for (let x = 0; x < plan.width; x += 1) {
        const tile = plan.get(x, z);
        if (tile === TILE.ROCK) continue;
        if (!revealAll && mask && !mask[z * plan.width + x]) continue;
        let color;
        if (tile === TILE.VOID) color = '#101a20';
        else if (tile === TILE.STAIR_EXIT) color = '#2f6f7d';
        else if (tile === TILE.CORRIDOR) color = '#232b32';
        else if (tile === TILE.DOOR) color = '#4a4030';
        else {
          const owner = plan.ownerAt(x, z);
          const room = owner >= 0 ? dungeon.roomsById.get(owner) : null;
          color = (room && ROOM_TINT[room.type]) || '#2b333b';
        }
        c.fillStyle = color;
        c.fillRect(ox + x * scale, oz + z * scale, scale + 0.6, scale + 0.6);
      }
    }

    // Stairwells on this floor, so the way down is findable.
    for (const stair of dungeon.stairs) {
      if (stair.upperFloor !== floorIndex) continue;
      const [ex, ez] = stair.exit;
      if (!revealAll && mask && !mask[ez * plan.width + ex]) continue;
      c.fillStyle = '#6fe0f5';
      c.font = `bold ${Math.max(5, scale * 1.5)}px monospace`;
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText('▼', ox + (ex + 0.5) * scale, oz + (ez + 0.5) * scale);
    }

    // Locked doors still shut.
    for (const door of options.doors || []) {
      if (door.floor !== floorIndex || door.open) continue;
      const tx = Math.floor(door.x / TILE_SIZE);
      const tz = Math.floor(door.z / TILE_SIZE);
      if (!revealAll && mask && !mask[tz * plan.width + tx]) continue;
      const col = door.lock.color;
      c.fillStyle = `rgb(${col.map((v) => Math.round(v * 255)).join(',')})`;
      c.fillRect(ox + tx * scale - 0.5, oz + tz * scale - 0.5, scale + 1, scale + 1);
    }

    // Uncollected keys the player has already laid eyes on.
    for (const prop of dungeon.props) {
      if (prop.kind !== 'key' || prop.floor !== floorIndex || prop.taken) continue;
      const tx = Math.floor(prop.x / TILE_SIZE);
      const tz = Math.floor(prop.z / TILE_SIZE);
      if (!revealAll && mask && !mask[tz * plan.width + tx]) continue;
      const col = prop.color;
      c.fillStyle = `rgb(${col.map((v) => Math.round(v * 255)).join(',')})`;
      c.beginPath();
      c.arc(ox + (tx + 0.5) * scale, oz + (tz + 0.5) * scale, Math.max(2, scale * 0.45), 0, Math.PI * 2);
      c.fill();
    }

    // The goal, once seen.
    const goal = dungeon.roomsById.get(dungeon.goal);
    if (goal && goal.floor === floorIndex && (revealAll || !mask || mask[goal.cz * plan.width + goal.cx])) {
      c.fillStyle = '#ff8b6b';
      c.font = `bold ${Math.max(6, scale * 1.7)}px monospace`;
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText('✦', ox + (goal.cx + 0.5) * scale, oz + (goal.cz + 0.5) * scale);
    }

    // Player arrow.
    const px = ox + (player.x / TILE_SIZE) * scale;
    const pz = oz + (player.z / TILE_SIZE) * scale;
    const fx = Math.sin(player.yaw);
    const fz = -Math.cos(player.yaw);
    const rx = Math.cos(player.yaw);
    const rz = Math.sin(player.yaw);
    c.fillStyle = '#ffd166';
    c.beginPath();
    c.moveTo(px + fx * 5, pz + fz * 5);
    c.lineTo(px - fx * 3 + rx * 3, pz - fz * 3 + rz * 3);
    c.lineTo(px - fx * 3 - rx * 3, pz - fz * 3 - rz * 3);
    c.closePath();
    c.fill();

    c.fillStyle = '#9facb8';
    c.font = 'bold 7px monospace';
    c.textAlign = 'left';
    c.textBaseline = 'top';
    c.fillText(`D${floorIndex + 1}`, 3, 3);
  }
}
