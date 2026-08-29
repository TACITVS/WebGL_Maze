/**
 * Procedural sprite atlas.
 *
 * Every sprite is painted at runtime onto a canvas with integer `fillRect`
 * calls, so the art is pixel art in the literal sense - and the repository stays
 * free of binary assets. Tinting and the wind-up swell are done in the shader,
 * so each creature only needs its poses drawn once.
 */

/** Native pixel size of one atlas cell. Sprites are packed on this grid. */
const CELL = 48;
const ATLAS_COLUMNS = 8;

/** Shorthand painter: rectangles on an integer pixel grid. */
function makePainter(ctx, originX, originY) {
  return (x, y, w, h, colour) => {
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

/* ------------------------------- creatures ------------------------------ */

function drawCrawler(px, frame) {
  const W = 20;
  const shell = '#1d4a22';
  const body = '#46a03e';
  const lit = '#6fd45f';
  const limb = '#2f6b30';
  const eye = '#eaff8c';
  const lift = frame === 1 ? 1 : 0;
  const snap = frame === 2;

  // Legs first, and in a mid tone so the silhouette still reads against a dark
  // floor. Two pairs, counter-phased, which is enough to sell a scuttle.
  symmetric(px, W, [
    [0, 8 + lift, 2, 5, limb],
    [1, 12 + lift, 3, 1, shell],
    [4, 9 - lift, 2, 5, limb],
    [4, 13 - lift, 3, 1, shell],
  ]);
  // Domed carapace.
  px(4, 3, 12, 2, shell);
  px(3, 5, 14, 5, shell);
  px(4, 4, 10, 1, body);
  px(4, 6, 12, 3, body);
  px(5, 5, 7, 2, lit);
  // Mandibles: closed at rest, flung open on the attack pose.
  if (snap) {
    px(5, 10, 3, 4, shell);
    px(12, 10, 3, 4, shell);
    px(4, 13, 2, 1, shell);
    px(14, 13, 2, 1, shell);
  } else {
    px(7, 10, 2, 3, shell);
    px(11, 10, 2, 3, shell);
  }
  // The eye is the read: it is what you track in a dark room.
  px(7, 5, 6, 3, eye);
  px(8, 6, 2, 1, '#ffffff');
}

function drawSentinel(px, frame) {
  const W = 18;
  const shell = '#4a3310';
  const body = '#a4761f';
  const lit = '#e0ad42';
  const eye = '#ffe08a';
  const hover = frame === 1 ? 1 : 0;
  const open = frame === 2;

  // It floats: a gap under the skirt is what sells that at this size.
  px(6, 22 + hover, 6, 2, shell);
  px(5, 20 + hover, 8, 2, body);
  px(7, 19 + hover, 4, 1, lit);
  // Column.
  px(6, 9, 6, 11, shell);
  px(7, 10, 4, 9, body);
  px(7, 10, 2, 7, lit);
  // Arms flare outward as it charges a shot.
  symmetric(px, W, [
    [open ? 0 : 2, 10, 3, 7, shell],
    [open ? 1 : 3, 11, 1, 5, body],
  ]);
  // Head.
  px(4, 2, 10, 8, shell);
  px(5, 3, 8, 6, body);
  px(5, 3, 8, 1, lit);
  if (open) {
    px(5, 4, 8, 4, eye);
    px(6, 5, 6, 2, '#fffbe8');
  } else {
    px(6, 5, 6, 2, eye);
  }
}

function drawWraith(px, frame) {
  const shell = '#2b1b46';
  const body = '#6644ad';
  const lit = '#9a76e8';
  const eye = '#e6d0ff';
  const sway = frame === 1 ? 1 : 0;
  const flare = frame === 2 ? 2 : 0;

  // Tattered hem, drawn as separate strands with gaps between them so the
  // bottom of the silhouette breaks up instead of reading as a solid block.
  px(3 + sway, 17, 3, 6, shell);
  px(8, 18, 3, 6, shell);
  px(12 - sway, 17, 3, 5, shell);
  px(4 + sway, 18, 1, 4, body);
  px(9, 19, 1, 4, body);
  // Robe.
  px(3 - flare, 8, 12 + flare * 2, 10, shell);
  px(4 - flare, 9, 10 + flare * 2, 8, body);
  px(5, 9, 3, 7, lit);
  // Hood.
  px(4, 1, 10, 9, shell);
  px(5, 2, 8, 7, body);
  px(5, 2, 8, 2, lit);
  px(4, 8, 2, 3, shell);
  px(12, 8, 2, 3, shell);
  // Two eyes under the hood.
  px(6, 5, 2, 3, eye);
  px(10, 5, 2, 3, eye);
}

function drawWarden(px, frame) {
  const W = 40;
  const shell = '#400e14';
  const body = '#9b232b';
  const lit = '#d4404a';
  const iron = '#544850';
  const core = '#ffb14a';
  const step = frame === 1 ? 1 : 0;
  const rear = frame === 2 ? 2 : 0;

  // Legs.
  px(10, 36 - step, 7, 10, shell);
  px(23, 36 + step, 7, 10, shell);
  px(11, 37 - step, 5, 8, iron);
  px(24, 37 + step, 5, 8, iron);
  // Torso.
  px(9, 14 - rear, 22, 23, shell);
  px(11, 16 - rear, 18, 19, body);
  px(13, 16 - rear, 5, 15, lit);
  // Molten core: the thing you are actually shooting at.
  px(16, 21 - rear, 8, 9, shell);
  px(17, 22 - rear, 6, 7, core);
  px(18, 23 - rear, 4, 5, '#ffe9b0');
  // Pauldrons, flared when winding up.
  symmetric(px, W, [
    [3 - rear, 13 - rear, 8, 10, shell],
    [4 - rear, 14 - rear, 6, 7, iron],
    [5 - rear, 15 - rear, 3, 3, '#6d6068'],
  ]);
  // Head, set low between the shoulders.
  px(15, 5, 10, 11, shell);
  px(16, 7, 8, 8, body);
  // Stepped horns sweeping up and out, so it is not mistaken for ears.
  symmetric(px, W, [
    [13, 3, 3, 4, shell],
    [11, 0, 3, 4, shell],
    [10, 0, 2, 2, shell],
  ]);
  px(17, 10, 2, 3, core);
  px(21, 10, 2, 3, core);
  px(18, 14, 4, 1, core);
}

/* -------------------------------- objects ------------------------------- */

function drawHealth(px) {
  const shell = '#5c1420';
  const glass = '#ff4d5e';
  const shine = '#ffd2d6';
  px(3, 1, 6, 2, shell);
  px(2, 3, 8, 8, shell);
  px(3, 4, 6, 6, glass);
  px(4, 5, 2, 4, shine);
  // A cross, so it reads as health and not as a generic pickup.
  px(5, 5, 2, 4, '#ffffff');
  px(4, 6, 4, 2, '#ffffff');
}

function drawEnergy(px) {
  const shell = '#123c4d';
  const glass = '#3fc9ff';
  const shine = '#d5f4ff';
  px(2, 1, 8, 10, shell);
  px(3, 2, 6, 8, glass);
  px(4, 3, 2, 6, shine);
  px(3, 4, 6, 1, '#0a2430');
  px(3, 7, 6, 1, '#0a2430');
}

function drawShot(px, hot) {
  const outer = hot ? '#ff8a3c' : '#ffd15c';
  const inner = '#fff6d8';
  px(2, 1, 4, 6, outer);
  px(1, 2, 6, 4, outer);
  px(3, 2, 2, 4, inner);
  px(2, 3, 4, 2, inner);
}

function drawSpark(px) {
  px(0, 0, 3, 3, '#ffffff');
}

/* --------------------------------- atlas -------------------------------- */

/**
 * Sprite table. `w`/`h` are native pixels; `world` is how tall the sprite
 * stands in metres, with width derived from the aspect so nothing is stretched.
 */
const SPRITES = [
  { name: 'crawler0', w: 20, h: 14, draw: (p) => drawCrawler(p, 0) },
  { name: 'crawler1', w: 20, h: 14, draw: (p) => drawCrawler(p, 1) },
  { name: 'crawler2', w: 20, h: 14, draw: (p) => drawCrawler(p, 2) },
  { name: 'sentinel0', w: 18, h: 26, draw: (p) => drawSentinel(p, 0) },
  { name: 'sentinel1', w: 18, h: 26, draw: (p) => drawSentinel(p, 1) },
  { name: 'sentinel2', w: 18, h: 26, draw: (p) => drawSentinel(p, 2) },
  { name: 'wraith0', w: 18, h: 24, draw: (p) => drawWraith(p, 0) },
  { name: 'wraith1', w: 18, h: 24, draw: (p) => drawWraith(p, 1) },
  { name: 'wraith2', w: 18, h: 24, draw: (p) => drawWraith(p, 2) },
  { name: 'warden0', w: 40, h: 46, draw: (p) => drawWarden(p, 0) },
  { name: 'warden1', w: 40, h: 46, draw: (p) => drawWarden(p, 1) },
  { name: 'warden2', w: 40, h: 46, draw: (p) => drawWarden(p, 2) },
  { name: 'health', w: 12, h: 12, draw: (p) => drawHealth(p) },
  { name: 'energy', w: 12, h: 12, draw: (p) => drawEnergy(p) },
  { name: 'shot', w: 8, h: 8, draw: (p) => drawShot(p, false) },
  { name: 'shotHot', w: 8, h: 8, draw: (p) => drawShot(p, true) },
  { name: 'spark', w: 3, h: 3, draw: (p) => drawSpark(p) },
];

/**
 * Paint every sprite into one canvas and return it with a UV lookup.
 */
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
    const ox = col * CELL;
    const oy = row * CELL;
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
