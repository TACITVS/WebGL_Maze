/**
 * WebGL renderer.
 *
 * Geometry is static, so the whole dungeon uploads once into two buffers - the
 * full world and a roofless cutaway. Lighting is where the mood comes from: a
 * weak headlamp plus the nearest torches, picked per frame, which is what makes
 * a corridor feel like a corridor rather than a lit box.
 */

const MAX_LIGHTS = 8;

const VERTEX_SHADER = `
attribute vec3 aP, aN, aC;
attribute float aE;
uniform mat4 uVP;
varying vec3 vN, vC, vW;
varying float vE;
void main() {
  vN = aN;
  vC = aC;
  vW = aP;
  vE = aE;
  gl_Position = uVP * vec4(aP, 1.0);
}`;

const FRAGMENT_SHADER = `
precision mediump float;
varying vec3 vN, vC, vW;
varying float vE;
uniform vec3 uEye;
uniform vec3 uLightPos[${MAX_LIGHTS}];
uniform vec3 uLightColor[${MAX_LIGHTS}];
uniform float uLightPower[${MAX_LIGHTS}];
uniform vec3 uFogColor;
uniform float uAmbient;
uniform float uFogStart;
uniform float uFogRange;
void main() {
  vec3 N = normalize(vN);
  vec3 toEye = uEye - vW;
  float dEye = length(toEye);
  vec3 E = toEye / max(dEye, 0.001);

  vec3 lit = vC * uAmbient;
  // Headlamp: keeps the player from being blind between torches.
  lit += vC * max(dot(N, E), 0.0) * 0.30 / (1.0 + dEye * dEye * 0.05);

  for (int i = 0; i < ${MAX_LIGHTS}; i++) {
    vec3 delta = uLightPos[i] - vW;
    float dist = length(delta);
    float atten = uLightPower[i] / (1.0 + 0.25 * dist + 0.20 * dist * dist);
    float lambert = max(dot(N, delta / max(dist, 0.001)), 0.0);
    lit += vC * uLightColor[i] * (0.25 + 0.75 * lambert) * atten;
  }
  // Keep torchlight from blowing out surfaces the player is standing against.
  lit = lit / (1.0 + 0.42 * max(max(lit.r, lit.g), lit.b));

  // Emissive surfaces (flames, keys, wards) ignore the lighting entirely.
  lit = mix(lit, vC * 1.15, vE);
  float fog = clamp((dEye - uFogStart) / uFogRange, 0.0, 0.92) * (1.0 - vE);
  gl_FragColor = vec4(mix(lit, uFogColor, fog), 1.0);
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
    this.gl = canvas.getContext('webgl', { antialias: true });
    if (!this.gl) throw new Error('WebGL is unavailable in this browser');
    this.mode = 'fps';
    this.fov = (74 * Math.PI) / 180;
    this.lights = [];
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

  initGL() {
    const g = this.gl;
    const program = g.createProgram();
    g.attachShader(program, this.compile(g.VERTEX_SHADER, VERTEX_SHADER));
    g.attachShader(program, this.compile(g.FRAGMENT_SHADER, FRAGMENT_SHADER));
    g.linkProgram(program);
    if (!g.getProgramParameter(program, g.LINK_STATUS)) throw new Error(g.getProgramInfoLog(program));
    this.program = program;
    this.loc = {
      p: g.getAttribLocation(program, 'aP'),
      n: g.getAttribLocation(program, 'aN'),
      c: g.getAttribLocation(program, 'aC'),
      e: g.getAttribLocation(program, 'aE'),
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
    this.world = new Mesh(g);
    this.cutaway = new Mesh(g);
    this.overlay = new Mesh(g);
    g.enable(g.DEPTH_TEST);
    g.disable(g.CULL_FACE);
    g.clearColor(0.012, 0.014, 0.018, 1);
    this.lightPos = new Float32Array(MAX_LIGHTS * 3);
    this.lightColor = new Float32Array(MAX_LIGHTS * 3);
    this.lightPower = new Float32Array(MAX_LIGHTS);
  }

  setDungeon(dungeon, compiled) {
    this.world.upload(compiled.boxes);
    this.cutaway.upload(compiled.cutaway);
    this.overlay.upload([]);
    this.lights = dungeon.lights;
    // Frame the cutaway from its own bounds: the floors are pulled apart there,
    // so the world's extent is not the right thing to look at.
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

  setOverlay(boxes) {
    this.overlay.upload(boxes || []);
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;
    this.canvas.width = Math.max(1, Math.floor(rect.width * ratio));
    this.canvas.height = Math.max(1, Math.floor(rect.height * ratio));
    this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
  }

  /** Upload the torches nearest the camera; distant ones cannot be seen anyway. */
  uploadLights(eye, dt) {
    this.time += dt;
    const near = [];
    for (const light of this.lights) {
      const d = (light.pos[0] - eye[0]) ** 2 + (light.pos[1] - eye[1]) ** 2 + (light.pos[2] - eye[2]) ** 2;
      if (d > 900) continue;
      near.push({ light, d });
    }
    near.sort((a, b) => a.d - b.d);
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
      // A little flicker per light, offset by position so they are out of phase.
      const phase = light.pos[0] * 0.7 + light.pos[2] * 1.3;
      const flicker = 0.86 + 0.14 * Math.sin(this.time * 7.3 + phase) * Math.sin(this.time * 3.1 + phase * 0.6);
      this.lightPos[i * 3] = light.pos[0];
      this.lightPos[i * 3 + 1] = light.pos[1];
      this.lightPos[i * 3 + 2] = light.pos[2];
      this.lightColor[i * 3] = light.color[0];
      this.lightColor[i * 3 + 1] = light.color[1];
      this.lightColor[i * 3 + 2] = light.color[2];
      this.lightPower[i] = light.intensity * flicker * 2.2;
    }
    const g = this.gl;
    g.uniform3fv(this.loc.lightPos, this.lightPos);
    g.uniform3fv(this.loc.lightColor, this.lightColor);
    g.uniform1fv(this.loc.lightPower, this.lightPower);
  }

  render(player, dt) {
    const g = this.gl;
    g.clear(g.COLOR_BUFFER_BIT | g.DEPTH_BUFFER_BIT);
    g.useProgram(this.program);

    let eye;
    let target;
    if (this.mode === 'fps') {
      eye = [player.x, player.y + player.eye, player.z];
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
    g.uniformMatrix4fv(this.loc.vp, false, multiply(projection, lookAt(eye, target)));
    g.uniform3fv(this.loc.eye, new Float32Array(eye));
    g.uniform3fv(this.loc.fog, new Float32Array(this.mode === 'fps' ? [0.020, 0.024, 0.030] : [0.03, 0.035, 0.045]));
    g.uniform1f(this.loc.ambient, this.mode === 'fps' ? 0.10 : 0.92);
    g.uniform1f(this.loc.fogStart, this.mode === 'fps' ? 9.0 : 90.0);
    g.uniform1f(this.loc.fogRange, this.mode === 'fps' ? 40.0 : 160.0);
    this.uploadLights(eye, dt);

    (this.mode === 'fps' ? this.world : this.cutaway).draw(this.loc);
    this.overlay.draw(this.loc);
  }
}
