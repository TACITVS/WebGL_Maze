/**
 * The heads-up display, drawn as pixels.
 *
 * The HUD lives on its own canvas at the same low resolution as the world and is
 * scaled up by the same amount, so bitmap text and segmented bars line up with
 * the chunky pixels behind them. Doing it in the DOM would have put smooth,
 * anti-aliased type on top of a deliberately pixelated game.
 */

import { drawText, textWidth } from './hudfont.js';
import { hex } from './palette.js';

/** The HUD draws from the same ramps as the world, so it belongs to it. */
const PALETTE = {
  ink: hex('bone', 4),
  dim: hex('stone', 4),
  shadow: hex('void', 0),
  gold: hex('ember', 4),
  hp: hex('blood', 3),
  hpLow: hex('ember', 3),
  hpEmpty: hex('blood', 0),
  energy: hex('ice', 3),
  energyEmpty: hex('ice', 0),
  panel: 'rgba(8, 11, 18, 0.84)',
  edge: hex('void', 3),
  bad: hex('blood', 4),
  good: hex('verdigris', 4),
};

const BAR_CELLS = 20;

/** Greedy word wrap in bitmap-font pixels. A long word is broken rather than clipped. */
function wrapWords(text, maxWidth) {
  const lines = [];
  let line = '';
  for (const word of String(text).split(' ')) {
    const candidate = line ? `${line} ${word}` : word;
    if (textWidth(candidate, 1) <= maxWidth || !line) {
      if (textWidth(candidate, 1) <= maxWidth) { line = candidate; continue; }
      // A single word wider than the card: break it on the character.
      let chunk = '';
      for (const ch of word) {
        if (textWidth(chunk + ch, 1) > maxWidth && chunk) { lines.push(chunk); chunk = ch; }
        else chunk += ch;
      }
      line = chunk;
      continue;
    }
    lines.push(line);
    line = word;
  }
  if (line) lines.push(line);
  return lines;
}

export class Hud {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.toasts = [];
    this.bannerState = null;
    this.flashTimer = 0;
  }

  resize(width, height) {
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    this.ctx.imageSmoothingEnabled = false;
  }

  toast(text, tone = '') {
    this.toasts.push({ text, tone, age: 0 });
    if (this.toasts.length > 6) this.toasts.shift();
  }

  banner(title, sub) {
    this.bannerState = { title, sub, age: 0 };
  }

  clearMessages() {
    this.toasts.length = 0;
    this.bannerState = null;
  }

  advance(dt) {
    // A wall clock for anything that pulses. Kept here rather than read from
    // the game so the HUD animates on its own terms.
    this.clock = (this.clock || 0) + dt;
    for (const t of this.toasts) t.age += dt;
    this.toasts = this.toasts.filter((t) => t.age < 2.2);
    if (this.bannerState) {
      this.bannerState.age += dt;
      if (this.bannerState.age > 3.6) this.bannerState = null;
    }
  }

  /* ------------------------------- pieces ------------------------------- */

  /** A chunky bordered panel. Two tones, no rounding: arcade furniture. */
  panel(x, y, w, h) {
    const c = this.ctx;
    c.fillStyle = PALETTE.panel;
    c.fillRect(x, y, w, h);
    c.fillStyle = PALETTE.edge;
    c.fillRect(x, y, w, 1);
    c.fillRect(x, y + h - 1, w, 1);
    c.fillRect(x, y, 1, h);
    c.fillRect(x + w - 1, y, 1, h);
  }

  /**
   * A bar made of discrete cells. Segments read as a quantity at a glance in a
   * way a smooth fill never does, and they are what makes it feel like a cabinet.
   */
  segmentBar(x, y, w, h, ratio, colour, dimColour) {
    const c = this.ctx;
    const cells = BAR_CELLS;
    const gap = 1;
    const cellW = (w - (cells - 1) * gap) / cells;
    const filled = Math.round(Math.max(0, Math.min(1, ratio)) * cells);
    for (let i = 0; i < cells; i += 1) {
      c.fillStyle = i < filled ? colour : dimColour;
      c.fillRect(Math.round(x + i * (cellW + gap)), y, Math.ceil(cellW), h);
    }
  }

  crosshair(cx, cy, hitmark) {
    const c = this.ctx;
    c.fillStyle = PALETTE.ink;
    c.fillRect(cx - 4, cy, 3, 1);
    c.fillRect(cx + 2, cy, 3, 1);
    c.fillRect(cx, cy - 4, 1, 3);
    c.fillRect(cx, cy + 2, 1, 3);
    if (hitmark > 0) {
      c.fillStyle = PALETTE.gold;
      for (const [dx, dy] of [[-5, -5], [3, -5], [-5, 3], [3, 3]]) {
        c.fillRect(cx + dx, cy + dy, 3, 1);
        c.fillRect(cx + dx + (dx < 0 ? 0 : 2), cy + dy, 1, 3);
      }
    }
  }

  /* -------------------------------- draw -------------------------------- */

  /**
   * The level-up offer.
   *
   * Three cards, chosen with 1/2/3 so the mouse never has to leave the fight.
   * The border carries the rarity, which is the first thing the eye lands on
   * when the game has just stopped dead around you.
   */
  drawCards(cards, W, H) {
    const c = this.ctx;
    c.fillStyle = 'rgba(4, 7, 12, 0.78)';
    c.fillRect(0, 0, W, H);

    drawText(c, 'ESSENCE THRESHOLD', Math.round(W / 2), Math.round(H * 0.13),
      { scale: 1, colour: PALETTE.dim, align: 'center', shadow: PALETTE.shadow });
    drawText(c, 'CHOOSE ONE', Math.round(W / 2), Math.round(H * 0.13) + 11,
      { scale: 2, colour: PALETTE.gold, align: 'center', shadow: PALETTE.shadow });

    const cardW = Math.min(132, Math.floor((W - 40) / cards.length));
    // Height follows the wordiest card, so three cards stay a matched set and
    // none of them is mostly empty.
    let bodyLines = 0;
    for (const card of cards) {
      let n = wrapWords(String(card.title).toUpperCase(), cardW - 12).length;
      for (const text of card.lines) n += wrapWords(text, cardW - 12).length;
      bodyLines = Math.max(bodyLines, n);
    }
    // 21 above the title, 20 for the subtitle and rule, 6 of breathing room.
    const cardH = Math.max(72, 47 + bodyLines * 9);
    const gap = 8;
    const totalW = cards.length * cardW + (cards.length - 1) * gap;
    const startX = Math.round((W - totalW) / 2);
    const top = Math.round(H * 0.30);

    // Remember where each card landed so the game can hit-test a click against
    // it. The HUD owns the layout, so the HUD is what knows the rectangles.
    this.cardRects = cards.map((_, i) => ({
      x: startX + i * (cardW + gap), y: top, w: cardW, h: cardH,
    }));

    cards.forEach((card, i) => {
      const x = startX + i * (cardW + gap);
      const tone = hex(card.rarity.colour, 3);
      const hovered = i === this.hoverCard;
      c.fillStyle = hovered ? 'rgba(22, 32, 46, 0.98)' : 'rgba(10, 15, 22, 0.96)';
      c.fillRect(x, top, cardW, cardH);
      c.fillStyle = tone;
      const edge = hovered ? 3 : 2;
      c.fillRect(x, top, cardW, edge);
      c.fillRect(x, top + cardH - edge, cardW, edge);
      c.fillRect(x, top, edge, cardH);
      c.fillRect(x + cardW - edge, top, edge, cardH);

      // Key hint, so the choice is one keystroke away.
      c.fillStyle = tone;
      c.fillRect(x + 4, top + 4, 11, 11);
      drawText(c, String(i + 1), x + 7, top + 6, { scale: 1, colour: '#0a0d12' });

      drawText(c, card.rarity.name, x + cardW - 5, top + 6,
        { scale: 1, colour: tone, align: 'right' });

      // Title, wrapped: at this width two short lines beat one clipped.
      const lines = wrapWords(String(card.title).toUpperCase(), cardW - 12);
      let ty = top + 21;
      for (const text of lines.slice(0, 3)) {
        drawText(c, text, x + 6, ty, { scale: 1, colour: PALETTE.ink });
        ty += 9;
      }
      drawText(c, card.subtitle, x + 6, ty + 2, { scale: 1, colour: PALETTE.dim });
      ty += 15;
      c.fillStyle = PALETTE.edge;
      c.fillRect(x + 6, ty, cardW - 12, 1);
      ty += 5;
      // Body copy wraps too. Clipping a card's own description mid-word is the
      // one place the HUD cannot afford to look unfinished: it is the text the
      // player is being asked to make a decision from.
      const body = [];
      for (const text of card.lines) {
        for (const piece of wrapWords(text, cardW - 12)) body.push(piece);
      }
      const room = Math.floor((top + cardH - 6 - ty) / 9);
      for (const text of body.slice(0, Math.max(1, room))) {
        drawText(c, text, x + 6, ty, { scale: 1, colour: PALETTE.gold });
        ty += 9;
      }
    });

    drawText(c, 'CLICK A CARD  OR PRESS 1  2  3', Math.round(W / 2), top + cardH + 10,
      { scale: 1, colour: PALETTE.dim, align: 'center', shadow: PALETTE.shadow });
  }

  draw(state, dt) {
    this.advance(dt);
    const c = this.ctx;
    const W = this.canvas.width;
    const H = this.canvas.height;
    c.clearRect(0, 0, W, H);
    if (!state) return;

    const cx = Math.round(W / 2);
    const cy = Math.round(H / 2);

    if (!state.cards) this.crosshair(cx, cy, state.hitmark);

    // --- compass ------------------------------------------------------------
    if (state.compass && !state.cards) {
      const railW = Math.round(W * 0.30);
      const railY = 22;
      c.fillStyle = 'rgba(180, 200, 220, 0.18)';
      c.fillRect(cx - 1, railY - 3, 2, 3);
      const offset = Math.max(-1, Math.min(1, state.compass.delta / (Math.PI * 0.55)));
      const markX = Math.round(cx + offset * (railW / 2));
      const behind = Math.abs(state.compass.delta) > Math.PI * 0.55;
      const tone = behind ? PALETTE.dim : PALETTE.gold;
      c.fillStyle = tone;
      c.fillRect(markX - 3, railY + 3, 7, 1);
      c.fillRect(markX - 2, railY + 2, 5, 1);
      c.fillRect(markX - 1, railY + 1, 3, 1);
      c.fillRect(markX, railY, 1, 1);
      drawText(c, `${state.compass.label} ${Math.round(state.compass.distance)}M`, markX, railY + 6,
        { scale: 1, colour: tone, align: 'center', shadow: PALETTE.shadow });
    }

    // --- boss bar ----------------------------------------------------------
    if (state.boss) {
      const barW = Math.round(W * 0.5);
      const barX = cx - Math.round(barW / 2);
      const barY = 40;
      drawText(c, state.boss.name, cx, barY, { scale: 1, colour: PALETTE.bad, align: 'center', shadow: PALETTE.shadow });
      this.segmentBar(barX, barY + 10, barW, 6, state.boss.ratio, PALETTE.bad, PALETTE.hpEmpty);
    }

    // --- objective ---------------------------------------------------------
    drawText(c, state.objective || '', 8, 8, { scale: 1, colour: state.riftOpen ? PALETTE.good : PALETTE.gold, shadow: PALETTE.shadow });
    drawText(c, `${state.hostiles} HOSTILE${state.hostiles === 1 ? '' : 'S'}`, 8, 18,
      { scale: 1, colour: PALETTE.dim, shadow: PALETTE.shadow });

    // Quota pips: visible progress toward the way down.
    if (state.quota && !state.quota.boss && !state.riftOpen) {
      const pips = 16;
      const filled = Math.round((state.quota.done / Math.max(1, state.quota.need)) * pips);
      for (let i = 0; i < pips; i += 1) {
        c.fillStyle = i < filled ? PALETTE.gold : 'rgba(255,255,255,0.10)';
        c.fillRect(8 + i * 5, 28, 3, 4);
      }
    }

    // --- weapon rack -------------------------------------------------------
    let wy = 40;
    for (const weapon of state.weapons || []) {
      c.fillStyle = weapon.ready ? weapon.colour : 'rgba(255,255,255,0.16)';
      c.fillRect(8, wy + 1, 3, 6);
      const label = weapon.name.length > 22 ? `${weapon.name.slice(0, 22)}` : weapon.name;
      drawText(c, label, 14, wy, { scale: 1, colour: weapon.ready ? PALETTE.ink : PALETTE.dim });
      drawText(c, `L${weapon.level}`, 14 + textWidth(label, 1) + 4, wy, { scale: 1, colour: PALETTE.dim });
      wy += 10;
    }
    if (state.relics) {
      drawText(c, `${state.relics} RELIC${state.relics === 1 ? '' : 'S'}`, 8, wy + 2,
        { scale: 1, colour: PALETTE.dim });
    }

    // --- score and level ---------------------------------------------------
    drawText(c, 'SCORE', W - 8, 8, { scale: 1, colour: PALETTE.dim, align: 'right' });
    drawText(c, String(state.score).padStart(6, '0'), W - 8, 17,
      { scale: 3, colour: PALETTE.ink, align: 'right', shadow: PALETTE.shadow });
    drawText(c, `LEVEL ${state.level}`, W - 8, 41,
      { scale: 1, colour: PALETTE.gold, align: 'right', shadow: PALETTE.shadow });

    // --- banked upgrades ---------------------------------------------------
    // Loud enough that you know it is there, quiet enough that it never takes
    // the screen away from you mid-fight.
    if (state.banked > 0) {
      const label = state.banked > 1 ? `${state.banked} UPGRADES READY` : 'UPGRADE READY';
      const w = textWidth(label, 1) + 10;
      const x = Math.round(cx - w / 2);
      const y = Math.round(H * 0.62);
      const pulse = 0.55 + 0.45 * Math.sin(this.clock * 5);
      c.globalAlpha = pulse;
      c.fillStyle = PALETTE.gold;
      c.fillRect(x, y - 2, w, 1);
      c.fillRect(x, y + 11, w, 1);
      c.globalAlpha = 1;
      drawText(c, label, cx, y + 2, { scale: 1, colour: PALETTE.gold, align: 'center', shadow: PALETTE.shadow });
      drawText(c, 'PRESS TAB', cx, y + 14, { scale: 1, colour: PALETTE.dim, align: 'center', shadow: PALETTE.shadow });
    }

    // --- kill chain --------------------------------------------------------
    // Only shown once it means something, and it drains in plain sight: the
    // draining is the whole point, because it is what makes you keep moving.
    if (state.combo >= 3) {
      const mult = `X${(state.comboMult || 1).toFixed(2)}`;
      const hot = state.combo >= 20 ? PALETTE.gold : PALETTE.good;
      drawText(c, mult, W - 8, 52, { scale: 2, colour: hot, align: 'right', shadow: PALETTE.shadow });
      const label = `${state.combo} CHAIN`;
      drawText(c, label, W - 8, 68, { scale: 1, colour: PALETTE.dim, align: 'right' });
      const meterW = 62;
      const meterX = W - 8 - meterW;
      c.fillStyle = PALETTE.edge;
      c.fillRect(meterX, 79, meterW, 3);
      c.fillStyle = hot;
      c.fillRect(meterX, 79, Math.max(1, Math.round(meterW * (state.comboRatio || 0))), 3);
    }

    // --- bottom console ----------------------------------------------------
    const barH = 34;
    const barY = H - barH;

    // Essence bar runs the full width above the console: the loop's heartbeat.
    const xpRatio = Math.max(0, Math.min(1, state.xp / Math.max(1, state.xpNeeded)));
    c.fillStyle = 'rgba(6,10,16,0.9)';
    c.fillRect(0, barY - 6, W, 6);
    c.fillStyle = hex('ice', 0);
    c.fillRect(0, barY - 5, W, 4);
    c.fillStyle = hex('ice', 3);
    c.fillRect(0, barY - 5, Math.round(W * xpRatio), 4);
    c.fillStyle = hex('ice', 4);
    c.fillRect(Math.max(0, Math.round(W * xpRatio) - 2), barY - 5, 2, 4);

    this.panel(0, barY, W, barH);

    const hullRatio = state.hull / state.maxHull;
    const hullColour = hullRatio < 0.3 ? PALETTE.hpLow : PALETTE.hp;
    drawText(c, 'HULL', 8, barY + 6, { scale: 1, colour: PALETTE.dim });
    this.segmentBar(8, barY + 16, 132, 8, hullRatio, hullColour, PALETTE.hpEmpty);
    drawText(c, String(Math.ceil(Math.max(0, state.hull))), 146, barY + 15, { scale: 2, colour: hullColour });

    drawText(c, 'CHARGE', W - 8, barY + 6, { scale: 1, colour: PALETTE.dim, align: 'right' });
    this.segmentBar(W - 140, barY + 16, 132, 8, state.charge / state.maxCharge, PALETTE.energy, PALETTE.energyEmpty);
    drawText(c, String(Math.floor(state.charge)), W - 146, barY + 15,
      { scale: 2, colour: PALETTE.energy, align: 'right' });

    drawText(c, 'DEPTH', cx, barY + 6, { scale: 1, colour: PALETTE.dim, align: 'center' });
    drawText(c, `${state.depth}/${state.floors}`, cx, barY + 14,
      { scale: 2, colour: PALETTE.ink, align: 'center', shadow: PALETTE.shadow });

    // --- toasts ------------------------------------------------------------
    let toastY = barY - 22;
    for (let i = this.toasts.length - 1; i >= 0; i -= 1) {
      const t = this.toasts[i];
      const fade = t.age > 1.6 ? 1 - (t.age - 1.6) / 0.6 : 1;
      if (fade <= 0) continue;
      const colour = t.tone === 'hot' ? PALETTE.gold
        : t.tone === 'good' ? PALETTE.good
          : t.tone === 'warn' ? PALETTE.bad : PALETTE.ink;
      c.globalAlpha = Math.max(0, Math.min(1, fade));
      drawText(c, t.text, cx, Math.round(toastY - Math.min(8, t.age * 6)),
        { scale: 1, colour, align: 'center', shadow: PALETTE.shadow });
      c.globalAlpha = 1;
      toastY -= 11;
    }

    // --- banner ------------------------------------------------------------
    if (this.bannerState && !state.cards) {
      const b = this.bannerState;
      const fade = b.age < 0.25 ? b.age / 0.25 : b.age > 3.0 ? 1 - (b.age - 3.0) / 0.6 : 1;
      c.globalAlpha = Math.max(0, Math.min(1, fade));
      drawText(c, b.title, cx, Math.round(H * 0.30), { scale: 2, colour: PALETTE.ink, align: 'center', shadow: PALETTE.shadow });
      if (b.sub) {
        drawText(c, b.sub, cx, Math.round(H * 0.30) + 20, { scale: 1, colour: PALETTE.gold, align: 'center', shadow: PALETTE.shadow });
      }
      c.globalAlpha = 1;
    }

    this.hoverCard = state.hoverCard === undefined ? -1 : state.hoverCard;
    if (state.cards) this.drawCards(state.cards, W, H);
    else this.cardRects = null;

    // --- scanlines ---------------------------------------------------------
    c.fillStyle = 'rgba(0, 0, 0, 0.17)';
    for (let y = 0; y < H; y += 2) c.fillRect(0, y, W, 1);
  }
}

export { PALETTE };
