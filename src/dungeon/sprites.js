/**
 * Procedural sprite atlas.
 *
 * Art direction, in one paragraph: nothing down here is an animal. Every
 * creature is a *bound construct* built from the same three materials - a body
 * of pale bone, clamped with bands of corroded verdigris metal, animated by an
 * ember core. The cast differs by silhouette and by how much of each material
 * it carries, which gives the set a shared language and, usefully, teaches one
 * rule that holds for every enemy in the game: the glowing part is the part you
 * shoot.
 *
 * Every colour comes from `palette.js`. Light falls from the upper left on all
 * of them, so each form gets a lit edge along its top-left and the dark
 * silhouette line along its bottom-right - selective outlining, which is what
 * keeps a sprite readable against both a lit wall and a black floor.
 *
 * Sprites are painted at runtime with integer `fillRect` calls, so the art is
 * pixel art in the literal sense and the repository holds no binary assets.
 */

import { hex } from './palette.js';

const CELL = 56;
const ATLAS_COLUMNS = 8;

function makePainter(ctx, originX, originY) {
  return (x, y, w, h, colour) => {
    if (!colour) return;
    ctx.fillStyle = colour;
    ctx.fillRect(originX + x, originY + y, w, h);
  };
}

/** Mirror a list of rects around a sprite's vertical centre line. */
function symmetric(px, width, rects) {
  for (const [x, y, w, h, c] of rects) {
    px(x, y, w, h, c);
    px(width - x - w, y, w, h, c);
  }
}

/**
 * Paint a solid form from a list of horizontal spans, shading it for a light
 * that always comes from the upper left.
 *
 * This is the workhorse. Doing the shading and the outlining by rule rather
 * than by hand is what keeps eleven sprites looking like one artist drew them:
 * the lit edge, the core tone, the shadow edge and the silhouette line land in
 * the same relationship every time.
 */
function paintForm(px, rows, ramp, options = {}) {
  const {
    light = hex(ramp, 4),
    mid = hex(ramp, 3),
    core = hex(ramp, 2),
    shade = hex(ramp, 1),
    outline = hex('void', 0),
    rim = true,
  } = options;

  const top = rows[0].y;
  const bottom = rows[rows.length - 1].y;

  for (const row of rows) {
    const { y, x0, x1 } = row;
    const width = x1 - x0 + 1;
    if (width <= 0) continue;
    const depth = (y - top) / Math.max(1, bottom - top);

    // Body: lighter toward the top, darker toward the bottom.
    const body = depth < 0.25 ? mid : depth < 0.62 ? core : shade;
    px(x0, y, width, 1, body);

    // Lit edge on the left, shadow edge on the right.
    if (width > 2) {
      px(x0, y, 1, 1, depth < 0.7 ? light : mid);
      px(x1, y, 1, 1, depth < 0.35 ? core : shade);
    }

    // Silhouette line: dark, and only where the form turns away from the light.
    px(x1 + 1, y, 1, 1, outline);
    if (rim && depth < 0.55) px(x0 - 1, y, 1, 1, depth < 0.3 ? light : mid);
    else px(x0 - 1, y, 1, 1, outline);
  }

  // Cap the top with the lit tone and the bottom with the silhouette line.
  const first = rows[0];
  const last = rows[rows.length - 1];
  px(first.x0, first.y - 1, first.x1 - first.x0 + 1, 1, rim ? light : outline);
  px(last.x0 - 1, last.y + 1, last.x1 - last.x0 + 3, 1, outline);
}

/** Spans describing a symmetric dome or capsule, for compactness. */
function spans(list) {
  return list.map(([y, x0, x1]) => ({ y, x0, x1 }));
}

/* ------------------------------- creatures ------------------------------ */

/**
 * Crawler - 24x16. Mostly bone, almost no metal, a small core. Low and wide so
 * it reads instantly as "the fast one that comes along the floor".
 */
function drawCrawler(px, frame) {
  const W = 24;
  const lift = frame === 1 ? 1 : 0;
  const snap = frame === 2;
  const legDark = hex('stone', 1);
  const legLit = hex('stone', 3);

  // Six legs, counter-phased. Drawn first so the carapace overlaps them.
  const legs = [[2, 0], [6, 1], [10, 0]];
  legs.forEach(([lx, phase], i) => {
    const drop = (phase === 0 ? lift : 1 - lift);
    symmetric(px, W, [
      [lx, 9 + drop, 2, 4, legDark],
      [lx, 9 + drop, 1, 3, legLit],
      [lx - 1, 12 + drop, 3, 1, hex('void', 0)],
    ]);
    void i;
  });

  // Carapace.
  paintForm(px, spans([
    [3, 9, 14],
    [4, 7, 16],
    [5, 5, 18],
    [6, 4, 19],
    [7, 4, 19],
    [8, 4, 19],
    [9, 5, 18],
    [10, 6, 17],
  ]), 'bone');

  // The clamp band: two rivets and a strap of corroded metal.
  px(4, 5, 16, 2, hex('verdigris', 2));
  px(4, 5, 16, 1, hex('verdigris', 3));
  px(19, 5, 1, 2, hex('verdigris', 1));
  symmetric(px, W, [[5, 5, 2, 2, hex('verdigris', 4)]]);

  // Mandibles, flung open on the attack pose.
  const spread = snap ? 3 : 0;
  symmetric(px, W, [
    [8 - spread, 11, 2, 3, hex('bone', 1)],
    [8 - spread, 11, 1, 2, hex('bone', 3)],
    [7 - spread, 14, 2, 1, hex('void', 0)],
  ]);
}

/** Crawler's ember core, drawn on its own so it can glow. */
function drawCrawlerGlow(px) {
  px(10, 7, 4, 3, hex('ember', 3));
  px(11, 7, 2, 2, hex('ember', 4));
  px(10, 10, 4, 1, hex('ember', 2));
}

/**
 * Sentinel - 20x30. Mostly metal: a hovering column with a heavy head and one
 * wide eye. Tall and narrow, the opposite silhouette to the crawler.
 */
function drawSentinel(px, frame) {
  const W = 20;
  const hover = frame === 1 ? 1 : 0;
  const open = frame === 2;

  // Skirt. A gap under it is what sells the hover at this size.
  px(6, 26 + hover, 8, 3, hex('verdigris', 1));
  px(6, 26 + hover, 8, 1, hex('verdigris', 3));
  px(7, 29 + hover, 6, 1, hex('void', 0));

  // Arms first, so the column overlaps them and they read as attached.
  const out = open ? 2 : 0;
  symmetric(px, W, [
    [2 - out, 14, 5, 9, hex('bone', 1)],
    [2 - out, 14, 5, 1, hex('bone', 3)],
    [2 - out, 15, 1, 7, hex('bone', 3)],
    [1 - out, 23, 7, 1, hex('void', 0)],
    [2 - out, 17, 5, 2, hex('verdigris', 2)],
  ]);

  // Column, running the full height of the body.
  paintForm(px, spans([
    [11, 7, 12],
    [12, 6, 13],
    [13, 6, 13],
    [14, 6, 13],
    [15, 6, 13],
    [16, 6, 13],
    [17, 6, 13],
    [18, 6, 13],
    [19, 6, 13],
    [20, 6, 13],
    [21, 6, 13],
    [22, 6, 13],
    [23, 7, 12],
    [24, 7, 12],
    [25, 7, 12],
  ]), 'verdigris');

  // Bone ribs banding the column - the same clamp motif as the crawler.
  for (const y of [13, 17, 21]) {
    px(6, y, 8, 1, hex('bone', 2));
    px(6, y, 2, 1, hex('bone', 4));
  }

  // Head, deliberately smaller than the body so it does not dominate.
  paintForm(px, spans([
    [3, 7, 12],
    [4, 6, 13],
    [5, 5, 14],
    [6, 5, 14],
    [7, 5, 14],
    [8, 5, 14],
    [9, 6, 13],
  ]), 'bone');
  px(5, 10, 10, 1, hex('verdigris', 2));
}

function drawSentinelGlow(px, frame) {
  const open = frame === 2;
  if (open) {
    px(6, 5, 8, 4, hex('ember', 3));
    px(7, 6, 6, 2, hex('ember', 4));
  } else {
    px(7, 6, 6, 2, hex('ember', 3));
    px(8, 6, 4, 1, hex('ember', 4));
  }
}

/**
 * Wraith - 20x26. A shroud over a bone mask. Almost no metal and a torn hem, so
 * its silhouette breaks up where the others are solid.
 */
function drawWraith(px, frame) {
  const sway = frame === 1 ? 1 : 0;
  const flare = frame === 2 ? 2 : 0;

  // Torn hem: separate strands with gaps, so the bottom edge never reads solid.
  const hem = [[4 + sway, 19, 3, 6], [8, 20, 3, 6], [12 - sway, 19, 3, 5]];
  for (const [hx, hy, hw, hh] of hem) {
    px(hx, hy, hw, hh, hex('arcane', 1));
    px(hx, hy, 1, hh - 1, hex('arcane', 3));
    px(hx + hw, hy, 1, hh, hex('void', 0));
  }

  // Shroud.
  paintForm(px, spans([
    [9, 5 - flare, 14 + flare],
    [10, 4 - flare, 15 + flare],
    [11, 3 - flare, 16 + flare],
    [12, 3 - flare, 16 + flare],
    [13, 3 - flare, 16 + flare],
    [14, 3 - flare, 16 + flare],
    [15, 4 - flare, 15 + flare],
    [16, 4 - flare, 15 + flare],
    [17, 5, 14],
    [18, 5, 14],
  ]), 'arcane');

  // Hood.
  paintForm(px, spans([
    [2, 7, 12],
    [3, 5, 14],
    [4, 4, 15],
    [5, 4, 15],
    [6, 4, 15],
    [7, 4, 15],
    [8, 5, 14],
  ]), 'arcane');

  // The bone mask inside the hood: the family resemblance, in shadow.
  px(6, 5, 8, 4, hex('bone', 1));
  px(6, 5, 8, 1, hex('bone', 2));
  // A single verdigris torc at the throat.
  px(6, 9, 8, 1, hex('verdigris', 2));
}

function drawWraithGlow(px) {
  px(7, 6, 2, 2, hex('ember', 4));
  px(11, 6, 2, 2, hex('ember', 4));
  px(7, 8, 2, 1, hex('ember', 2));
  px(11, 8, 2, 1, hex('ember', 2));
}

/**
 * The Warden - 44x52. Every material at scale, and a core big enough to aim at
 * from across the room. Wide shoulders and horns so the silhouette is
 * unmistakable the moment it steps into the light.
 */
function drawWarden(px, frame) {
  const W = 44;
  const step = frame === 1 ? 1 : 0;
  const rear = frame === 2 ? 2 : 0;

  // Legs, drawn first and tucked under the torso so the joint is hidden.
  symmetric(px, W, [
    [12, 38 - step, 8, 13, hex('stone', 1)],
    [12, 38 - step, 2, 11, hex('stone', 3)],
    [11, 50 - step, 10, 2, hex('void', 0)],
    [12, 42 - step, 8, 2, hex('verdigris', 2)],
  ]);

  // Pauldrons, flared while winding up.
  const out = rear;
  symmetric(px, W, [
    [1 - out, 17, 11, 12, hex('stone', 1)],
    [1 - out, 17, 11, 1, hex('stone', 3)],
    [1 - out, 18, 2, 10, hex('stone', 3)],
    [0 - out, 29, 13, 1, hex('void', 0)],
    [3 - out, 20, 7, 3, hex('verdigris', 2)],
    [3 - out, 20, 7, 1, hex('verdigris', 3)],
  ]);

  // Torso: broad and near-constant, tapering only at the waist.
  paintForm(px, spans([
    [17 - rear, 13, 30],
    [18 - rear, 12, 31],
    [19 - rear, 11, 32],
    [20 - rear, 11, 32],
    [21 - rear, 11, 32],
    [22 - rear, 11, 32],
    [23 - rear, 11, 32],
    [24 - rear, 11, 32],
    [25 - rear, 11, 32],
    [26 - rear, 11, 32],
    [27 - rear, 12, 31],
    [28 - rear, 12, 31],
    [29 - rear, 12, 31],
    [30 - rear, 12, 31],
    [31 - rear, 13, 30],
    [32 - rear, 13, 30],
    [33 - rear, 13, 30],
    [34 - rear, 14, 29],
    [35 - rear, 14, 29],
    [36 - rear, 14, 29],
    [37 - rear, 15, 28],
    [38 - rear, 16, 27],
  ]), 'blood');

  // Ribs of the same corroded metal that clamps every other creature.
  for (const y of [19, 27, 35]) {
    px(12, y - rear, 20, 2, hex('verdigris', 2));
    px(12, y - rear, 20, 1, hex('verdigris', 3));
    px(31, y - rear, 1, 2, hex('verdigris', 1));
  }

  // Skull, set low between the shoulders.
  paintForm(px, spans([
    [6, 17, 26],
    [7, 15, 28],
    [8, 14, 29],
    [9, 14, 29],
    [10, 14, 29],
    [11, 14, 29],
    [12, 15, 28],
    [13, 16, 27],
    [14, 17, 26],
    [15, 18, 25],
  ]), 'bone');

  // Horns, stepped so they sweep up and out from the temples.
  symmetric(px, W, [
    [11, 4, 4, 4, hex('bone', 2)],
    [11, 4, 2, 4, hex('bone', 4)],
    [8, 1, 4, 4, hex('bone', 1)],
    [8, 1, 2, 3, hex('bone', 3)],
    [7, 0, 3, 2, hex('bone', 2)],
    [6, 0, 2, 1, hex('void', 0)],
  ]);
  px(17, 14, 10, 1, hex('verdigris', 2));
}

function drawWardenGlow(px) {
  // Chest furnace: big enough to aim at from across the room.
  px(18, 22, 8, 10, hex('ember', 2));
  px(19, 23, 6, 8, hex('ember', 3));
  px(20, 24, 4, 5, hex('ember', 4));
  // Eye sockets.
  px(17, 9, 3, 3, hex('ember', 4));
  px(24, 9, 3, 3, hex('ember', 4));
  px(17, 12, 3, 1, hex('ember', 2));
  px(24, 12, 3, 1, hex('ember', 2));
}

/* -------------------------------- objects ------------------------------- */

function drawHealth(px) {
  paintForm(px, spans([
    [3, 3, 10],
    [4, 2, 11],
    [5, 2, 11],
    [6, 2, 11],
    [7, 2, 11],
    [8, 2, 11],
    [9, 3, 10],
  ]), 'blood');
  // Stopper, so it reads as a vial rather than a gem.
  px(5, 1, 4, 2, hex('stone', 2));
  px(5, 1, 4, 1, hex('stone', 4));
  // Cross.
  px(6, 4, 2, 5, hex('bone', 4));
  px(4, 5, 6, 2, hex('bone', 4));
}

function drawEnergy(px) {
  paintForm(px, spans([
    [2, 3, 10],
    [3, 2, 11],
    [4, 2, 11],
    [5, 2, 11],
    [6, 2, 11],
    [7, 2, 11],
    [8, 2, 11],
    [9, 3, 10],
  ]), 'ice');
  // Contacts at each end and a wound coil across the middle.
  px(4, 1, 6, 1, hex('verdigris', 3));
  px(4, 10, 6, 1, hex('verdigris', 1));
  px(3, 4, 8, 1, hex('ice', 4));
  px(3, 7, 8, 1, hex('ice', 4));
}

function drawShot(px, hot) {
  const ramp = hot ? 'blood' : 'ember';
  px(3, 1, 4, 8, hex(ramp, 2));
  px(1, 3, 8, 4, hex(ramp, 2));
  px(3, 2, 4, 6, hex(ramp, 3));
  px(2, 3, 6, 4, hex(ramp, 3));
  px(3, 3, 4, 4, hex(ramp, 4));
  px(4, 4, 2, 2, '#ffffff');
}

function drawSpark(px) {
  px(0, 0, 2, 2, '#ffffff');
}

/** A key, so the objective marker is an object rather than a coloured square. */
function drawKey(px) {
  px(3, 1, 6, 6, hex('ember', 2));
  px(4, 2, 4, 4, hex('ember', 4));
  px(5, 3, 2, 2, hex('void', 0));
  px(5, 7, 2, 7, hex('ember', 3));
  px(7, 10, 3, 1, hex('ember', 3));
  px(7, 12, 3, 1, hex('ember', 3));
  px(5, 7, 1, 7, hex('ember', 4));
}

/* --------------------------------- atlas -------------------------------- */

const SPRITES = [
  { name: 'crawler0', w: 24, h: 16, draw: (p) => drawCrawler(p, 0) },
  { name: 'crawler1', w: 24, h: 16, draw: (p) => drawCrawler(p, 1) },
  { name: 'crawler2', w: 24, h: 16, draw: (p) => drawCrawler(p, 2) },
  { name: 'crawlerGlow', w: 24, h: 16, draw: (p) => drawCrawlerGlow(p) },
  { name: 'sentinel0', w: 20, h: 30, draw: (p) => drawSentinel(p, 0) },
  { name: 'sentinel1', w: 20, h: 30, draw: (p) => drawSentinel(p, 1) },
  { name: 'sentinel2', w: 20, h: 30, draw: (p) => drawSentinel(p, 2) },
  { name: 'sentinelGlow', w: 20, h: 30, draw: (p) => drawSentinelGlow(p, 0) },
  { name: 'sentinelGlow2', w: 20, h: 30, draw: (p) => drawSentinelGlow(p, 2) },
  { name: 'wraith0', w: 20, h: 26, draw: (p) => drawWraith(p, 0) },
  { name: 'wraith1', w: 20, h: 26, draw: (p) => drawWraith(p, 1) },
  { name: 'wraith2', w: 20, h: 26, draw: (p) => drawWraith(p, 2) },
  { name: 'wraithGlow', w: 20, h: 26, draw: (p) => drawWraithGlow(p) },
  { name: 'warden0', w: 44, h: 52, draw: (p) => drawWarden(p, 0) },
  { name: 'warden1', w: 44, h: 52, draw: (p) => drawWarden(p, 1) },
  { name: 'warden2', w: 44, h: 52, draw: (p) => drawWarden(p, 2) },
  { name: 'wardenGlow', w: 44, h: 52, draw: (p) => drawWardenGlow(p) },
  { name: 'health', w: 14, h: 14, draw: (p) => drawHealth(p) },
  { name: 'energy', w: 14, h: 14, draw: (p) => drawEnergy(p) },
  { name: 'key', w: 12, h: 15, draw: (p) => drawKey(p) },
  { name: 'shot', w: 10, h: 10, draw: (p) => drawShot(p, false) },
  { name: 'shotHot', w: 10, h: 10, draw: (p) => drawShot(p, true) },
  { name: 'spark', w: 2, h: 2, draw: (p) => drawSpark(p) },
];

/** Paint every sprite into one canvas and return it with a UV lookup. */
export function buildSpriteAtlas() {
  const rows = Math.ceil(SPRITES.length / ATLAS_COLUMNS);
  const canvas = document.createElement('canvas');
  canvas.width = ATLAS_COLUMNS * CELL;
  canvas.height = Math.max(1, rows) * CELL;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const frames = new Map();
  SPRITES.forEach((sprite, index) => {
    const col = index % ATLAS_COLUMNS;
    const row = Math.floor(index / ATLAS_COLUMNS);
    // One pixel of padding inside the cell, so the outline pass never bleeds
    // into a neighbour when the sampler lands on an edge.
    const ox = col * CELL + 2;
    const oy = row * CELL + 2;
    sprite.draw(makePainter(ctx, ox, oy));
    frames.set(sprite.name, {
      u0: ox / canvas.width,
      v0: oy / canvas.height,
      u1: (ox + sprite.w) / canvas.width,
      v1: (oy + sprite.h) / canvas.height,
      w: sprite.w,
      h: sprite.h,
      aspect: sprite.w / sprite.h,
    });
  });

  return { canvas, frames };
}

export { SPRITES };
