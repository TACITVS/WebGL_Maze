/**
 * The palette.
 *
 * Every colour in the game - sprites, walls, props, HUD - comes from this file
 * and nowhere else. A single hand-picked set used everywhere is the thing that
 * makes art read as authored rather than assembled, because it forces each new
 * element to be described in terms of what already exists. It is the working
 * principle behind DawnBringer's classic palettes, and it is why the crawlers,
 * the masonry and the health bar all look like they come from one world.
 *
 * Each ramp runs dark to light in five steps and is hue-shifted as it climbs:
 * shadows lean cool (toward violet-blue), highlights lean warm (toward
 * yellow-cream), and saturation peaks in the midtones. Shading by value alone
 * is what makes pixel art look flat.
 */

/** Ramps are ordered darkest to lightest. Index 0 doubles as an outline. */
export const RAMPS = {
  // Blue-black. Outlines, deep shadow, the space between things.
  void: ['#080b12', '#0f1622', '#1a2436', '#2b3a55'],

  // Cool masonry. The dungeon is built of this.
  stone: ['#241f2b', '#3a3341', '#544a52', '#6f6262', '#8c7c75'],

  // Warm and light. Creature bodies, so they separate from the walls.
  bone: ['#4a3a3f', '#7a6152', '#ab8b66', '#d8b784', '#f5e3b8'],

  // Corroded metal. The bands and clamps that hold the constructs together.
  verdigris: ['#122a2a', '#1d4841', '#2e6f5f', '#49a07c', '#7ad39b'],

  // Firelight. Torches, and the core inside every living thing down here.
  ember: ['#3d1710', '#7a2c10', '#c25714', '#f2912f', '#ffd166'],

  // The Warden, damage, danger.
  blood: ['#2e0b14', '#5e1226', '#9c1e37', '#d1414e', '#ff7a7a'],

  // Wraiths, keys, wards.
  arcane: ['#1c1136', '#33205c', '#553594', '#8560d4', '#b799f2'],

  // Charge, cold light, interface.
  ice: ['#0a2233', '#134a63', '#1f83a8', '#3fc9ff', '#a8ecff'],
};

/** Shorthand: `hex('ember', 3)`. */
export function hex(ramp, step) {
  const list = RAMPS[ramp];
  return list[Math.max(0, Math.min(list.length - 1, step))];
}

/** The same colour as WebGL wants it: three floats in 0..1. */
export function rgb(ramp, step) {
  return hexToRgb(hex(ramp, step));
}

export function hexToRgb(value) {
  const n = parseInt(value.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/**
 * Light comes from the upper left, everywhere, always.
 *
 * Sprites are drawn with this in mind: a lighter step along the top-left edge,
 * the darkest step along the bottom-right. Consistency here is most of what
 * separates a set of sprites from a pile of them.
 */
export const LIGHT_FROM = { x: -1, y: -1 };
