/**
 * WebGL renderer.
 *
 * Two passes over the same lighting model: box geometry for the dungeon itself,
 * and textured billboards for everything alive. The frame is drawn at a low
 * internal resolution and scaled up by the browser with nearest-neighbour
 * filtering, which is what gives the game its chunky arcade look - the pixels
 * are real, not a filter.
 */

const MAX_LIGHTS = 8;

/** Internal render height in pixels. Width follows the viewport aspect. */
const PIXEL_HEIGHT = 340;
/** Vertical half-window for a light to count, in metres. Floors are 4.8 apart. */
const VERTICAL_LIGHT_REACH = 4.0;
/** Slots the room's own lights always keep, however busy the fight gets. */
const STATIC_LIGHT_RESERVE = 3;

/** Shared lighting body, so sprites and walls sit in the same world. */
const LIGHT_UNIFORMS = `
uniform vec3 uEye;
uniform vec3 uLightPos[${MAX_LIGHTS}];
uniform vec3 uLightColor[${MAX_LIGHTS}];
uniform float uLightPower[${MAX_LIGHTS}];
uniform vec3 uFogColor;
uniform float uAmbient;
uniform float uFogStart;
uniform float uFogRange;
`;

const LIGHT_BODY = `
// Ordered 4x4 dither, built from two nested 2x2 matrices so it needs no array
// indexing - GLSL ES 1.0 is fussy about that. Without it, quantising smooth
// torchlight paints concentric contour rings across every flat wall.
float bayer2(vec2 p) {
  return p.x * 2.0 + p.y * 3.0 - p.x * p.y * 4.0;
}
float ditherValue(vec2 fragment) {
  vec2 p = floor(mod(fragment, 4.0));
  return (bayer2(floor(p * 0.5)) * 4.0 + bayer2(mod(p, 2.0))) / 16.0;
}

vec3 shade(vec3 albedo, vec3 N, vec3 world, float emissive) {
  vec3 toEye = uEye - world;
  float dEye = length(toEye);
  vec3 E = toEye / max(dEye, 0.001);

  vec3 lit = albedo * uAmbient;
  lit += albedo * max(dot(N, E), 0.0) * 0.20 / (1.0 + dEye * dEye * 0.06);

  for (int i = 0; i < ${MAX_LIGHTS}; i++) {
    vec3 delta = uLightPos[i] - world;
    float dist = length(delta);
    float atten = uLightPower[i] / (1.0 + 0.25 * dist + 0.20 * dist * dist);
    float lambert = max(dot(N, delta / max(dist, 0.001)), 0.0);
    lit += albedo * uLightColor[i] * (0.25 + 0.75 * lambert) * atten;
  }
  lit = lit / (1.0 + 0.62 * max(max(lit.r, lit.g), lit.b));
  lit = mix(lit, albedo * 1.15, emissive);

  float fog = clamp((dEye - uFogStart) / uFogRange, 0.0, 0.92) * (1.0 - emissive);
  lit = mix(lit, uFogColor, fog);
  // Posterise through the dither: a limited palette is half of what makes this
  // read as a game from the era it is imitating, and the dither is what keeps
  // the bands from showing.
  float levels = 18.0;
  return floor(lit * levels + ditherValue(gl_FragCoord.xy)) / levels;
}
`;

const WORLD_VS = `
attribute vec3 aP, aN, aC;
attribute float aE;
uniform mat4 uVP;
varying vec3 vN, vC, vW;
varying float vE;
void main() {
  vN = aN; vC = aC; vW = aP; vE = aE;
  gl_Position = uVP * vec4(aP, 1.0);
}`;

const WORLD_FS = `
precision mediump float;
varying vec3 vN, vC, vW;
varying float vE;
${LIGHT_UNIFORMS}
${LIGHT_BODY}
void main() {
  gl_FragColor = vec4(shade(vC, normalize(vN), vW, vE), 1.0);
}`;

const SPRITE_VS = `
attribute vec3 aP;
attribute vec2 aUV;
attribute vec3 aC;
attribute float aE;
uniform mat4 uVP;
varying vec2 vUV;
varying vec3 vC, vW;
varying float vE;
void main() {
  vUV = aUV; vC = aC; vW = aP; vE = aE;
  gl_Position = uVP * vec4(aP, 1.0);
}`;

const SPRITE_FS = `
precision mediump float;
varying vec2 vUV;
varying vec3 vC, vW;
varying float vE;
uniform sampler2D uAtlas;
uniform vec3 uFacing;
${LIGHT_UNIFORMS}
${LIGHT_BODY}
void main() {
  vec4 texel = texture2D(uAtlas, vUV);
  // Hard alpha cut rather than blending: it keeps the pixel edges crisp and
  // lets sprites use the depth buffer like any other geometry.
  if (texel.a < 0.5) discard;
  gl_FragColor = vec4(shade(texel.rgb * vC, uFacing, vW, vE), 1.0);
}`;

/** Static triangle soup for a list of boxes. */
export class Mesh {
  constructor(gl) {
    this.gl = gl;
    this.buffer = gl.createBuffer();
    this.count = 0;
  }

  upload(boxes) {
    const data = [];
    const push = (p, n, c, e) => data.push(p[0], p[1], p[2], n[0], n[1], n[2], c[0], c[1], c[2], e);
    for (const b of boxes) {
      const [cx, cy, cz] = b.c;
      const [hx, hy, hz] = b.h;
      const c = b.color;
      const e = b.emissive || 0;
      if (b.basis) {
        // Oriented box: corners built in the box's own frame, which is what lets
        // a held weapon keep its shape however the camera turns.
        const [bx, by, bz] = b.basis;
        const corner = (sx, sy, sz) => [
          cx + bx[0] * hx * sx + by[0] * hy * sy + bz[0] * hz * sz,
          cy + bx[1] * hx * sx + by[1] * hy * sy + bz[1] * hz * sz,
          cz + bx[2] * hx * sx + by[2] * hy * sy + bz[2] * hz * sz,
        ];
        const neg = (v) => [-v[0], -v[1], -v[2]];
        const face = (normal, s0, s1, s2, s3) => {
          const q = [corner(...s0), corner(...s1), corner(...s2), corner(...s3)];
          for (const idx of [0, 1, 2, 0, 2, 3]) push(q[idx], normal, c, e);
        };
        face(by, [-1, 1, -1], [1, 1, -1], [1, 1, 1], [-1, 1, 1]);
        face(neg(by), [-1, -1, 1], [1, -1, 1], [1, -1, -1], [-1, -1, -1]);
        face(bz, [-1, -1, 1], [-1, 1, 1], [1, 1, 1], [1, -1, 1]);
        face(neg(bz), [1, -1, -1], [1, 1, -1], [-1, 1, -1], [-1, -1, -1]);
        face(bx, [1, -1, 1], [1, 1, 1], [1, 1, -1], [1, -1, -1]);
        face(neg(bx), [-1, -1, -1], [-1, 1, -1], [-1, 1, 1], [-1, -1, 1]);
        continue;
      }
      const l = cx - hx; const r = cx + hx;
      const d = cy - hy; const t = cy + hy;
      const n = cz - hz; const f = cz + hz;
      const face = (normal, q0, q1, q2, q3) => {
        for (const q of [q0, q1, q2, q0, q2, q3]) push(q, normal, c, e);
      };
      face([0, 1, 0], [l, t, n], [r, t, n], [r, t, f], [l, t, f]);
      face([0, -1, 0], [l, d, f], [r, d, f], [r, d, n], [l, d, n]);
      face([0, 0, 1], [l, d, f], [l, t, f], [r, t, f], [r, d, f]);
      face([0, 0, -1], [r, d, n], [r, t, n], [l, t, n], [l, d, n]);
      face([1, 0, 0], [r, d, f], [r, t, f], [r, t, n], [r, d, n]);
      face([-1, 0, 0], [l, d, n], [l, t, n], [l, t, f], [l, d, f]);
    }
    const array = new Float32Array(data);
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.buffer);
    this.gl.bufferData(this.gl.ARRAY_BUFFER, array, this.gl.STATIC_DRAW);
    this.count = array.length / 10;
  }

  draw(loc) {
    if (!this.count) return;
    const g = this.gl;
    g.bindBuffer(g.ARRAY_BUFFER, this.buffer);
    for (const a of [loc.p, loc.n, loc.c, loc.e]) g.enableVertexAttribArray(a);
    g.vertexAttribPointer(loc.p, 3, g.FLOAT, false, 40, 0);
    g.vertexAttribPointer(loc.n, 3, g.FLOAT, false, 40, 12);
    g.vertexAttribPointer(loc.c, 3, g.FLOAT, false, 40, 24);
    g.vertexAttribPointer(loc.e, 1, g.FLOAT, false, 40, 36);
    g.drawArrays(g.TRIANGLES, 0, this.count);
  }
}

/**
 * Upright camera-facing quads.
 *
 * Billboards rotate about Y only, so a monster stays standing on the floor
 * instead of tipping over when you look down at it.
 */
export class SpriteBatch {
  constructor(gl) {
    this.gl = gl;
    this.buffer = gl.createBuffer();
    this.count = 0;
  }

  /** `sprites`: {x,y,z, w, h, frame:{u0,v0,u1,v1}, tint:[r,g,b], emissive}. */
  upload(sprites, right) {
    const data = [];
    const rx = right[0];
    const rz = right[2];
    for (const s of sprites) {
      const hw = s.w / 2;
      const f = s.frame;
      const t = s.tint || [1, 1, 1];
      const e = s.emissive || 0;
      const x0 = s.x - rx * hw;
      const z0 = s.z - rz * hw;
      const x1 = s.x + rx * hw;
      const z1 = s.z + rz * hw;
      const yb = s.y;
      const yt = s.y + s.h;
      // Two triangles: bottom-left, bottom-right, top-right, top-left.
      const corners = [
        [x0, yb, z0, f.u0, f.v1],
        [x1, yb, z1, f.u1, f.v1],
        [x1, yt, z1, f.u1, f.v0],
        [x0, yb, z0, f.u0, f.v1],
        [x1, yt, z1, f.u1, f.v0],
        [x0, yt, z0, f.u0, f.v0],
      ];
      for (const [px, py, pz, u, v] of corners) {
        data.push(px, py, pz, u, v, t[0], t[1], t[2], e);
      }
    }
    const array = new Float32Array(data);
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.buffer);
    this.gl.bufferData(this.gl.ARRAY_BUFFER, array, this.gl.DYNAMIC_DRAW);
    this.count = array.length / 9;
  }

  draw(loc) {
    if (!this.count) return;
    const g = this.gl;
    g.bindBuffer(g.ARRAY_BUFFER, this.buffer);
    for (const a of [loc.p, loc.uv, loc.c, loc.e]) g.enableVertexAttribArray(a);
    g.vertexAttribPointer(loc.p, 3, g.FLOAT, false, 36, 0);
    g.vertexAttribPointer(loc.uv, 2, g.FLOAT, false, 36, 12);
    g.vertexAttribPointer(loc.c, 3, g.FLOAT, false, 36, 20);
    g.vertexAttribPointer(loc.e, 1, g.FLOAT, false, 36, 32);
    g.drawArrays(g.TRIANGLES, 0, this.count);
  }
}

/* Column-major matrices, matching WebGL's expectations. */
export function multiply(a, b) {
  const o = new Float32Array(16);
  for (let c = 0; c < 4; c += 1) {
    for (let r = 0; r < 4; r += 1) {
      let sum = 0;
      for (let k = 0; k < 4; k += 1) sum += a[k * 4 + r] * b[c * 4 + k];
      o[c * 4 + r] = sum;
    }
  }
  return o;
}

export function perspective(fovY, aspect, near, far) {
  const q = 1 / Math.tan(fovY / 2);
  const o = new Float32Array(16);
  o[0] = q / aspect;
  o[5] = q;
  o[10] = (far + near) / (near - far);
  o[11] = -1;
  o[14] = (2 * far * near) / (near - far);
  return o;
}

export function lookAt(eye, target, up = [0, 1, 0]) {
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const norm = (a) => {
    const l = Math.hypot(a[0], a[1], a[2]) || 1;
    return [a[0] / l, a[1] / l, a[2] / l];
  };
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const z = norm(sub(eye, target));
  const x = norm(cross(up, z));
  const y = cross(z, x);
  const o = new Float32Array(16);
  o[0] = x[0]; o[1] = y[0]; o[2] = z[0];
  o[4] = x[1]; o[5] = y[1]; o[6] = z[1];
  o[8] = x[2]; o[9] = y[2]; o[10] = z[2];
  o[12] = -dot(x, eye); o[13] = -dot(y, eye); o[14] = -dot(z, eye); o[15] = 1;
  return o;
}

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.gl = canvas.getContext('webgl', { antialias: false });
    if (!this.gl) throw new Error('WebGL is unavailable in this browser');
    this.mode = 'fps';
    this.fov = (74 * Math.PI) / 180;
    this.lights = [];
    this.transient = [];
    this.shake = 0;
    this.time = 0;
    this.orbit = { yaw: 0.7, pitch: 0.85, distance: 78, target: [40, -7, 40] };
    this.initGL();
    this.resize();
  }

  compile(type, source) {
    const g = this.gl;
    const shader = g.createShader(type);
    g.shaderSource(shader, source);
    g.compileShader(shader);
    if (!g.getShaderParameter(shader, g.COMPILE_STATUS)) throw new Error(g.getShaderInfoLog(shader));
    return shader;
  }

  link(vs, fs) {
    const g = this.gl;
    const program = g.createProgram();
    g.attachShader(program, this.compile(g.VERTEX_SHADER, vs));
    g.attachShader(program, this.compile(g.FRAGMENT_SHADER, fs));
    g.linkProgram(program);
    if (!g.getProgramParameter(program, g.LINK_STATUS)) throw new Error(g.getProgramInfoLog(program));
    return program;
  }

  lightLocations(program) {
    const g = this.gl;
    return {
      vp: g.getUniformLocation(program, 'uVP'),
      eye: g.getUniformLocation(program, 'uEye'),
      lightPos: g.getUniformLocation(program, 'uLightPos'),
      lightColor: g.getUniformLocation(program, 'uLightColor'),
      lightPower: g.getUniformLocation(program, 'uLightPower'),
      fog: g.getUniformLocation(program, 'uFogColor'),
      ambient: g.getUniformLocation(program, 'uAmbient'),
      fogStart: g.getUniformLocation(program, 'uFogStart'),
      fogRange: g.getUniformLocation(program, 'uFogRange'),
    };
  }

  initGL() {
    const g = this.gl;
    this.worldProgram = this.link(WORLD_VS, WORLD_FS);
    this.worldLoc = {
      ...this.lightLocations(this.worldProgram),
      p: g.getAttribLocation(this.worldProgram, 'aP'),
      n: g.getAttribLocation(this.worldProgram, 'aN'),
      c: g.getAttribLocation(this.worldProgram, 'aC'),
      e: g.getAttribLocation(this.worldProgram, 'aE'),
    };
    this.spriteProgram = this.link(SPRITE_VS, SPRITE_FS);
    this.spriteLoc = {
      ...this.lightLocations(this.spriteProgram),
      p: g.getAttribLocation(this.spriteProgram, 'aP'),
      uv: g.getAttribLocation(this.spriteProgram, 'aUV'),
      c: g.getAttribLocation(this.spriteProgram, 'aC'),
      e: g.getAttribLocation(this.spriteProgram, 'aE'),
      atlas: g.getUniformLocation(this.spriteProgram, 'uAtlas'),
      facing: g.getUniformLocation(this.spriteProgram, 'uFacing'),
    };

    this.world = new Mesh(g);
    this.cutaway = new Mesh(g);
    this.overlay = new Mesh(g);
    this.dynamic = new Mesh(g);
    this.sprites = new SpriteBatch(g);

    g.enable(g.DEPTH_TEST);
    g.disable(g.CULL_FACE);
    g.clearColor(0.012, 0.014, 0.018, 1);
    this.lightPos = new Float32Array(MAX_LIGHTS * 3);
    this.lightColor = new Float32Array(MAX_LIGHTS * 3);
    this.lightPower = new Float32Array(MAX_LIGHTS);
  }

  /** Hand the renderer the sprite sheet. NEAREST filtering keeps pixels sharp. */
  setSpriteAtlas(canvas) {
    const g = this.gl;
    this.atlas = g.createTexture();
    g.bindTexture(g.TEXTURE_2D, this.atlas);
    g.texImage2D(g.TEXTURE_2D, 0, g.RGBA, g.RGBA, g.UNSIGNED_BYTE, canvas);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, g.NEAREST);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MAG_FILTER, g.NEAREST);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_S, g.CLAMP_TO_EDGE);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_T, g.CLAMP_TO_EDGE);
  }

  setDungeon(dungeon, compiled) {
    this.world.upload(compiled.boxes);
    this.cutaway.upload(compiled.cutaway);
    this.overlay.upload([]);
    this.lights = dungeon.lights;
    let minY = Infinity;
    let maxY = -Infinity;
    let minX = Infinity;
    let maxX = -Infinity;
    for (const box of compiled.cutaway) {
      minY = Math.min(minY, box.c[1] - box.h[1]);
      maxY = Math.max(maxY, box.c[1] + box.h[1]);
      minX = Math.min(minX, box.c[0] - box.h[0]);
      maxX = Math.max(maxX, box.c[0] + box.h[0]);
    }
    if (!Number.isFinite(minY)) { minY = 0; maxY = 0; minX = 0; maxX = 1; }
    const centre = (minX + maxX) / 2;
    this.orbit.target = [centre, (minY + maxY) / 2, centre];
    this.orbit.distance = Math.max(maxX - minX, maxY - minY) * 1.35;
    this.orbit.pitch = 0.42;
  }

  setOverlay(boxes) { this.overlay.upload(boxes || []); }
  setDynamic(boxes) { this.dynamic.upload(boxes || []); }
  setTransientLights(lights) { this.transient = lights || []; }
  setSprites(list) { this.spriteList = list || []; }

  /** Low internal resolution, scaled up by CSS. The pixels are the aesthetic. */
  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const aspect = Math.max(0.2, rect.width / Math.max(1, rect.height));
    this.canvas.height = PIXEL_HEIGHT;
    this.canvas.width = Math.max(1, Math.round(PIXEL_HEIGHT * aspect));
    this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
  }

  /** Pick the torches nearest the camera; distant ones cannot be seen anyway. */
  gatherLights(eye, dt) {
    this.time += dt;
    const near = [];
    // The shader has no occlusion: a light is a light wherever it is, and floors
    // sit 4.8 m apart, so a torch one storey down is well inside the 30 m radius
    // and shines up through solid rock. Worse, being nearer than a torch across
    // your own room, it takes that torch's slot. A vertical window is the cheap
    // stand-in for the occlusion test, and it is generous enough that a
    // staircase - where you genuinely can see two levels - still lights both.
    const reachesEye = (pos) => Math.abs(pos[1] - eye[1]) <= VERTICAL_LIGHT_REACH;
    for (const light of this.lights) {
      if (!reachesEye(light.pos)) continue;
      const d = (light.pos[0] - eye[0]) ** 2 + (light.pos[1] - eye[1]) ** 2 + (light.pos[2] - eye[2]) ** 2;
      if (d > 900) continue;
      near.push({ light, d });
    }
    for (const light of this.transient) {
      if (!reachesEye(light.pos)) continue;
      const d = (light.pos[0] - eye[0]) ** 2 + (light.pos[1] - eye[1]) ** 2 + (light.pos[2] - eye[2]) ** 2;
      if (d > 900) continue;
      // Transient lights are the reason you look up, so bias them forward.
      near.push({
        light: { pos: light.pos, color: light.colour || light.color, intensity: light.intensity },
        d: d * 0.35, transient: true,
      });
    }
    near.sort((a, b) => a.d - b.d);

    // Reserve slots for the room's own lighting.
    //
    // Transients are deliberately biased forward, and in a fight there are
    // always more of them than there are slots - muzzle flashes, impacts, every
    // monster winding up. Without a reservation they take all eight and the
    // authored torchlight switches off exactly when the room is busiest, which
    // reads as the level going black rather than as the fight getting loud.
    const statics = near.filter((e) => !e.transient);
    if (statics.length) {
      const reserve = Math.min(STATIC_LIGHT_RESERVE, statics.length, MAX_LIGHTS);
      const chosen = near.slice(0, MAX_LIGHTS - reserve);
      for (const entry of statics) {
        if (chosen.length >= MAX_LIGHTS) break;
        if (!chosen.includes(entry)) chosen.push(entry);
      }
      chosen.sort((a, b) => a.d - b.d);
      near.length = 0;
      for (const entry of chosen) near.push(entry);
    }

    for (let i = 0; i < MAX_LIGHTS; i += 1) {
      const entry = near[i];
      if (!entry) {
        this.lightPower[i] = 0;
        this.lightPos[i * 3] = 0;
        this.lightPos[i * 3 + 1] = -9999;
        this.lightPos[i * 3 + 2] = 0;
        continue;
      }
      const { light } = entry;
      const phase = light.pos[0] * 0.7 + light.pos[2] * 1.3;
      const flicker = 0.86 + 0.14 * Math.sin(this.time * 7.3 + phase) * Math.sin(this.time * 3.1 + phase * 0.6);
      this.lightPos[i * 3] = light.pos[0];
      this.lightPos[i * 3 + 1] = light.pos[1];
      this.lightPos[i * 3 + 2] = light.pos[2];
      this.lightColor[i * 3] = light.color[0];
      this.lightColor[i * 3 + 1] = light.color[1];
      this.lightColor[i * 3 + 2] = light.color[2];
      this.lightPower[i] = light.intensity * flicker * 1.9;
    }
  }

  applyUniforms(loc, vp, eye) {
    const g = this.gl;
    g.uniformMatrix4fv(loc.vp, false, vp);
    g.uniform3fv(loc.eye, new Float32Array(eye));
    g.uniform3fv(loc.lightPos, this.lightPos);
    g.uniform3fv(loc.lightColor, this.lightColor);
    g.uniform1fv(loc.lightPower, this.lightPower);
    g.uniform3fv(loc.fog, new Float32Array(this.mode === 'fps' ? [0.020, 0.024, 0.030] : [0.03, 0.035, 0.045]));
    g.uniform1f(loc.ambient, this.mode === 'fps' ? 0.10 : 0.92);
    g.uniform1f(loc.fogStart, this.mode === 'fps' ? 9.0 : 90.0);
    g.uniform1f(loc.fogRange, this.mode === 'fps' ? 40.0 : 160.0);
  }

  render(player, dt) {
    const g = this.gl;
    g.clear(g.COLOR_BUFFER_BIT | g.DEPTH_BUFFER_BIT);

    const shake = this.shake || 0;
    const jitter = shake > 0
      ? [(Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake]
      : [0, 0, 0];

    let eye;
    let target;
    if (this.mode === 'fps') {
      eye = [player.x + jitter[0], player.y + player.eye + jitter[1], player.z + jitter[2]];
      const cp = Math.cos(player.pitch);
      target = [
        eye[0] + Math.sin(player.yaw) * cp,
        eye[1] + Math.sin(player.pitch),
        eye[2] - Math.cos(player.yaw) * cp,
      ];
    } else {
      const o = this.orbit;
      const cp = Math.cos(o.pitch);
      eye = [
        o.target[0] + o.distance * cp * Math.sin(o.yaw),
        o.target[1] + o.distance * Math.sin(o.pitch),
        o.target[2] + o.distance * cp * Math.cos(o.yaw),
      ];
      target = o.target;
    }

    const aspect = this.canvas.width / Math.max(1, this.canvas.height);
    const projection = perspective(this.mode === 'fps' ? this.fov : Math.PI / 3.2, aspect, 0.06, 400);
    const vp = multiply(projection, lookAt(eye, target));
    this.gatherLights(eye, dt);

    g.useProgram(this.worldProgram);
    this.applyUniforms(this.worldLoc, vp, eye);
    (this.mode === 'fps' ? this.world : this.cutaway).draw(this.worldLoc);
    this.dynamic.draw(this.worldLoc);
    this.overlay.draw(this.worldLoc);

    if (this.atlas && this.spriteList && this.spriteList.length) {
      // Billboards face the camera's horizontal right; sprites stay upright.
      const toEye = [eye[0] - target[0], eye[2] - target[2]];
      const len = Math.hypot(toEye[0], toEye[1]) || 1;
      const forward = [-toEye[0] / len, -toEye[1] / len];
      const right = [-forward[1], 0, forward[0]];
      this.sprites.upload(this.spriteList, right);
      // Glow layers sit exactly on top of the body quad they belong to, so equal
      // depths have to pass or the core never draws. Restored afterwards, since
      // the world has coincident faces that rely on a strict test.
      g.depthFunc(g.LEQUAL);
      g.useProgram(this.spriteProgram);
      this.applyUniforms(this.spriteLoc, vp, eye);
      g.activeTexture(g.TEXTURE0);
      g.bindTexture(g.TEXTURE_2D, this.atlas);
      g.uniform1i(this.spriteLoc.atlas, 0);
      g.uniform3fv(this.spriteLoc.facing, new Float32Array([-forward[0], 0, -forward[1]]));
      this.sprites.draw(this.spriteLoc);
      g.depthFunc(g.LESS);
    }
  }
}

export { PIXEL_HEIGHT };
