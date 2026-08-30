/**
 * A 5x7 bitmap font, drawn as pixels.
 *
 * The HUD is rendered into a small canvas and scaled up with the rest of the
 * frame, so the text has to be made of real pixels or it would be the one
 * smooth thing on screen and give the whole illusion away.
 */

const GLYPHS = {
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  B: ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
  C: ['01110', '10001', '10000', '10000', '10000', '10001', '01110'],
  D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  F: ['11111', '10000', '10000', '11110', '10000', '10000', '10000'],
  G: ['01110', '10001', '10000', '10111', '10001', '10001', '01111'],
  H: ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
  I: ['11111', '00100', '00100', '00100', '00100', '00100', '11111'],
  J: ['00111', '00010', '00010', '00010', '00010', '10010', '01100'],
  K: ['10001', '10010', '10100', '11000', '10100', '10010', '10001'],
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  M: ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
  N: ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
  O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
  Q: ['01110', '10001', '10001', '10001', '10101', '10010', '01101'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  U: ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
  V: ['10001', '10001', '10001', '10001', '10001', '01010', '00100'],
  W: ['10001', '10001', '10001', '10101', '10101', '11011', '10001'],
  X: ['10001', '10001', '01010', '00100', '01010', '10001', '10001'],
  Y: ['10001', '10001', '01010', '00100', '00100', '00100', '00100'],
  Z: ['11111', '00001', '00010', '00100', '01000', '10000', '11111'],
  0: ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
  1: ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  2: ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
  3: ['11111', '00010', '00100', '00010', '00001', '10001', '01110'],
  4: ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  5: ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
  6: ['00110', '01000', '10000', '11110', '10001', '10001', '01110'],
  7: ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  8: ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  9: ['01110', '10001', '10001', '01111', '00001', '00010', '01100'],
  ' ': ['00000', '00000', '00000', '00000', '00000', '00000', '00000'],
  '.': ['00000', '00000', '00000', '00000', '00000', '00000', '00100'],
  ',': ['00000', '00000', '00000', '00000', '00100', '00100', '01000'],
  ':': ['00000', '00100', '00000', '00000', '00100', '00000', '00000'],
  '-': ['00000', '00000', '00000', '11111', '00000', '00000', '00000'],
  '+': ['00000', '00100', '00100', '11111', '00100', '00100', '00000'],
  '/': ['00001', '00010', '00010', '00100', '01000', '01000', '10000'],
  '*': ['00000', '10001', '01010', '00100', '01010', '10001', '00000'],
  '!': ['00100', '00100', '00100', '00100', '00100', '00000', '00100'],
  '?': ['01110', '10001', '00001', '00010', '00100', '00000', '00100'],
  '%': ['11001', '11010', '00010', '00100', '01000', '01011', '10011'],
  '(': ['00010', '00100', '01000', '01000', '01000', '00100', '00010'],
  ')': ['01000', '00100', '00010', '00010', '00010', '00100', '01000'],
  "'": ['00100', '00100', '00000', '00000', '00000', '00000', '00000'],
  '>': ['01000', '00100', '00010', '00001', '00010', '00100', '01000'],
  '<': ['00010', '00100', '01000', '10000', '01000', '00100', '00010'],
};

export const GLYPH_WIDTH = 5;
export const GLYPH_HEIGHT = 7;
/** One blank column between characters. */
export const TRACKING = 1;

/** Width in pixels a string will occupy at the given scale. */
export function textWidth(text, scale = 1) {
  if (!text.length) return 0;
  return (text.length * (GLYPH_WIDTH + TRACKING) - TRACKING) * scale;
}

/**
 * Draw text as pixel blocks. `align` may be 'left', 'center' or 'right'.
 * A `shadow` colour paints a one-pixel drop shadow, which is what keeps the
 * HUD legible over a bright wall.
 */
/**
 * Glyphs, pre-painted once each.
 *
 * Drawing this font by rule meant one `fillRect` per lit pixel - up to seventy
 * per character once a shadow pass is counted - and the HUD is redrawn every
 * frame. It measured at 1.4 ms per frame, more than rendering the entire 3D
 * world beside it. Painting each glyph once into a tiny canvas and blitting it
 * turns that into one `drawImage` per character.
 *
 * The cache is keyed on character, scale and colour together, because the tile
 * bakes the colour in. That set is small and bounded: the HUD uses a handful of
 * palette entries at three scales.
 */
const glyphCache = new Map();

function glyphTile(char, scale, fill) {
  const key = `${char}|${scale}|${fill}`;
  const cached = glyphCache.get(key);
  if (cached !== undefined) return cached;

  const glyph = GLYPHS[char] || GLYPHS['?'];
  let tile = null;
  if (glyph) {
    tile = document.createElement('canvas');
    tile.width = Math.max(1, GLYPH_WIDTH * scale);
    tile.height = Math.max(1, GLYPH_HEIGHT * scale);
    const g = tile.getContext('2d');
    g.fillStyle = fill;
    for (let row = 0; row < GLYPH_HEIGHT; row += 1) {
      const bits = glyph[row];
      for (let col = 0; col < GLYPH_WIDTH; col += 1) {
        if (bits[col] === '1') g.fillRect(col * scale, row * scale, scale, scale);
      }
    }
  }
  glyphCache.set(key, tile);
  return tile;
}

export function drawText(ctx, text, x, y, options = {}) {
  const { scale = 1, colour = '#ffffff', align = 'left', shadow = null } = options;
  // Fold the typographic characters the game's prose uses onto glyphs the font
  // actually has, so an em dash never renders as a question mark.
  const upper = String(text)
    .toUpperCase()
    .replace(/[\u2014\u2013\u2212]/g, '-')
    .replace(/[\u00B7\u2022]/g, '-')
    .replace(/[\u00D7]/g, '*')
    .replace(/[\u2018\u2019]/g, "'");
  const width = textWidth(upper, scale);
  let cursor = x;
  if (align === 'center') cursor = Math.round(x - width / 2);
  else if (align === 'right') cursor = Math.round(x - width);

  const paint = (offsetX, offsetY, fill) => {
    let penX = cursor + offsetX;
    for (const char of upper) {
      const tile = glyphTile(char, scale, fill);
      if (tile) ctx.drawImage(tile, penX, y + offsetY);
      penX += (GLYPH_WIDTH + TRACKING) * scale;
    }
  };

  if (shadow) paint(scale, scale, shadow);
  paint(0, 0, colour);
  return width;
}
