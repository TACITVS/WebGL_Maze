/**
 * The heads-up display, drawn as pixels.
 *
 * The HUD lives on its own canvas at the same low resolution as the world and is
 * scaled up by the same amount, so bitmap text and segmented bars line up with
 * the chunky pixels behind them. Doing it in the DOM would have put smooth,
 * anti-aliased type on top of a deliberately pixelated game.
 */

import { drawText, textWidth } from './hudfont.js';

const PALETTE = {
  ink: '#f4f9ff',
  dim: '#7d8f9e',
  shadow: '#05080c',
  gold: '#ffcf4c',
  hp: '#ff3d52',
  hpLow: '#ff8a3c',
  energy: '#3fc9ff',
  panel: 'rgba(6, 10, 14, 0.82)',
  edge: '#2d4356',
  bad: '#ff6b6b',
  good: '#6fe39a',
};

const BAR_CELLS = 20;

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

  draw(state, dt) {
    this.advance(dt);
    const c = this.ctx;
    const W = this.canvas.width;
    const H = this.canvas.height;
    c.clearRect(0, 0, W, H);
    if (!state) return;

    const cx = Math.round(W / 2);
    const cy = Math.round(H / 2);

    this.crosshair(cx, cy, state.hitmark);

    // --- compass ------------------------------------------------------------
    if (state.compass) {
      const railW = Math.round(W * 0.30);
      const railY = 22;
      c.fillStyle = 'rgba(180, 200, 220, 0.18)';
      c.fillRect(cx - 1, railY - 3, 2, 3);
      const offset = Math.max(-1, Math.min(1, state.compass.delta / (Math.PI * 0.55)));
      const markX = Math.round(cx + offset * (railW / 2));
      const behind = Math.abs(state.compass.delta) > Math.PI * 0.55;
      const tone = behind ? PALETTE.dim : PALETTE.gold;
      c.fillStyle = tone;
      // Chevron pointing at the target.
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
      this.segmentBar(barX, barY + 10, barW, 6, state.boss.ratio, PALETTE.bad, '#3a1418');
    }

    // --- objective and keys ------------------------------------------------
    drawText(c, state.objective || '', 8, 8, { scale: 1, colour: PALETTE.gold, shadow: PALETTE.shadow });
    let keyX = 8;
    for (const lock of state.locks || []) {
      const label = lock.name;
      const w = textWidth(label, 1) + 6;
      c.fillStyle = lock.held ? lock.colour : 'rgba(255,255,255,0.06)';
      c.fillRect(keyX, 19, w, 11);
      c.fillStyle = lock.held ? lock.colour : PALETTE.edge;
      c.fillRect(keyX, 19, w, 1);
      c.fillRect(keyX, 29, w, 1);
      c.fillRect(keyX, 19, 1, 11);
      c.fillRect(keyX + w - 1, 19, 1, 11);
      drawText(c, label, keyX + 3, 21, {
        scale: 1,
        colour: lock.held ? '#0a0d10' : PALETTE.dim,
      });
      keyX += w + 4;
    }

    // --- score -------------------------------------------------------------
    drawText(c, 'SCORE', W - 8, 8, { scale: 1, colour: PALETTE.dim, align: 'right' });
    drawText(c, String(state.score).padStart(6, '0'), W - 8, 17,
      { scale: 3, colour: PALETTE.ink, align: 'right', shadow: PALETTE.shadow });
    if (state.combo > 0 && state.comboTimer > 0) {
      const label = `X${state.multiplier}  ${state.combo} CHAIN`;
      drawText(c, label, W - 8, 41, { scale: 1, colour: PALETTE.gold, align: 'right', shadow: PALETTE.shadow });
      const trackW = 70;
      const trackX = W - 8 - trackW;
      c.fillStyle = '#2a2415';
      c.fillRect(trackX, 50, trackW, 2);
      c.fillStyle = PALETTE.gold;
      c.fillRect(trackX, 50, Math.round(trackW * (state.comboTimer / state.comboWindow)), 2);
    }

    // --- bottom console ----------------------------------------------------
    const barH = 34;
    const barY = H - barH;
    this.panel(0, barY, W, barH);

    const hpRatio = state.hp / state.maxHp;
    const hpColour = hpRatio < 0.3 ? PALETTE.hpLow : PALETTE.hp;
    drawText(c, 'HULL', 8, barY + 6, { scale: 1, colour: PALETTE.dim });
    this.segmentBar(8, barY + 16, 132, 8, hpRatio, hpColour, '#33161a');
    drawText(c, String(Math.ceil(Math.max(0, state.hp))), 146, barY + 15, { scale: 2, colour: hpColour });

    drawText(c, 'CHARGE', W - 8, barY + 6, { scale: 1, colour: PALETTE.dim, align: 'right' });
    this.segmentBar(W - 140, barY + 16, 132, 8, state.energy / state.maxEnergy, PALETTE.energy, '#12303d');
    drawText(c, String(Math.floor(state.energy)), W - 146, barY + 15,
      { scale: 2, colour: PALETTE.energy, align: 'right' });

    drawText(c, 'DEPTH', cx, barY + 6, { scale: 1, colour: PALETTE.dim, align: 'center' });
    drawText(c, `${state.depth}/${state.floors}`, cx, barY + 14,
      { scale: 2, colour: PALETTE.ink, align: 'center', shadow: PALETTE.shadow });

    // --- toasts ------------------------------------------------------------
    let toastY = barY - 16;
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
    if (this.bannerState) {
      const b = this.bannerState;
      const fade = b.age < 0.25 ? b.age / 0.25 : b.age > 3.0 ? 1 - (b.age - 3.0) / 0.6 : 1;
      c.globalAlpha = Math.max(0, Math.min(1, fade));
      drawText(c, b.title, cx, Math.round(H * 0.32), { scale: 2, colour: PALETTE.ink, align: 'center', shadow: PALETTE.shadow });
      if (b.sub) {
        drawText(c, b.sub, cx, Math.round(H * 0.32) + 20, { scale: 1, colour: PALETTE.gold, align: 'center', shadow: PALETTE.shadow });
      }
      c.globalAlpha = 1;
    }

    // --- scanlines ---------------------------------------------------------
    // Drawn over everything, including the 3D behind this canvas, which is what
    // ties the picture together as one screen rather than a game with a UI on top.
    c.fillStyle = 'rgba(0, 0, 0, 0.17)';
    for (let y = 0; y < H; y += 2) c.fillRect(0, y, W, 1);
  }
}

export { PALETTE };
