/**
 * Procedural particles for the garden around you. Each formation returns
 * `count` vec4s in its own frame: xyz position plus w = accent amount
 * (0 ink, 1 vermilion highlight). `buildWorld` places them at their stations
 * and adds the surroundings. Everything is shuffled so any prefix is a fair
 * sample — lets us lower the particle count at runtime with setDrawRange() alone.
 */

import { GROUND, ORBITERS, placeAt, type Vec3 } from './world';
import { RAKE } from './Ground';

type Rand = () => number;

export const SHAPE_COUNT = 6;

export function mulberry32(seed: number): Rand {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TAU = Math.PI * 2;

function gauss(rand: Rand) {
  const u = Math.max(rand(), 1e-9);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * rand());
}

function inBall(rand: Rand, r: number): Vec3 {
  const z = rand() * 2 - 1;
  const a = rand() * TAU;
  const s = Math.sqrt(1 - z * z);
  const k = r * Math.cbrt(rand());
  return [Math.cos(a) * s * k, Math.sin(a) * s * k, z * k];
}

function rotate([x, y, z]: Vec3, ax: number, ay: number, az = 0): Vec3 {
  let c = Math.cos(ax), s = Math.sin(ax);
  [y, z] = [y * c - z * s, y * s + z * c];
  c = Math.cos(ay); s = Math.sin(ay);
  [x, z] = [x * c + z * s, -x * s + z * c];
  c = Math.cos(az); s = Math.sin(az);
  [x, y] = [x * c - y * s, x * s + y * c];
  return [x, y, z];
}

function build(count: number, seed: number, sample: (rand: Rand, i: number) => [Vec3, number]) {
  const rand = mulberry32(seed);
  const out = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    const [[x, y, z], w] = sample(rand, i);
    out.set([x, y, z, w], i * 4);
  }
  // Fisher–Yates over vec4s.
  for (let i = count - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    for (let k = 0; k < 4; k++) {
      const t = out[i * 4 + k];
      out[i * 4 + k] = out[j * 4 + k];
      out[j * 4 + k] = t;
    }
  }
  return out;
}

/** 0 — Ensō: a single brushed circle, thick at the start, dry at the tail. */
function enso(count: number, salt = 0) {
  return build(count, 11 + salt, (rand) => {
    if (rand() < 0.05) {
      const [x, y, z] = inBall(rand, 2.6);
      return [[x, y, z * 0.3], 0];
    }
    const t = Math.pow(rand(), 0.85);
    const angle = 1.15 - t * TAU * 0.93;
    const thick = 0.24 * (1 - 0.72 * Math.pow(t, 1.4)) * (0.85 + 0.15 * Math.sin(t * 23));
    let u = rand() * 2 - 1;
    // Dry-brush streaks: toward the tail, some bristle lanes run out of ink.
    const lane = Math.floor((u + 1) * 6);
    if (t > 0.55 && Math.abs(Math.sin(lane * 91.7)) < (t - 0.55) * 1.4) u *= 0.3;
    const r = 1.5 + u * thick + gauss(rand) * 0.012;
    return [[Math.cos(angle) * r, Math.sin(angle) * r, gauss(rand) * 0.05 + u * 0.05], 0];
  });
}

/** 1 — Spatial audio: a spherical-harmonic directivity pattern with wavefront rings. */
function audio(count: number, salt = 0) {
  return build(count, 23 + salt, (rand) => {
    const roll = rand();
    if (roll < 0.03) return [inBall(rand, 0.09), 1]; // the source
    if (roll < 0.34) {
      // Expanding wavefronts, drawn as dotted rings in a tilted plane.
      const ring = Math.floor(rand() * 3);
      const r = 1.4 + ring * 0.26 + gauss(rand) * 0.01;
      const dots = 72 + ring * 24;
      const a = ((Math.floor(rand() * dots) + gauss(rand) * 0.06) / dots) * TAU;
      return [rotate([Math.cos(a) * r, gauss(rand) * 0.01, Math.sin(a) * r], 1.15, 0, 0.2), 0];
    }
    // Real SH, l = 3, m = 2: Y ∝ sin²θ cosθ cos 2φ (max ≈ 0.385).
    const z = rand() * 2 - 1;
    const phi = rand() * TAU;
    const s = Math.sqrt(1 - z * z);
    const y = Math.abs(s * s * z * Math.cos(2 * phi)) / 0.385;
    const r = (0.22 + 1.1 * y) * (0.9 + 0.1 * rand());
    return [rotate([s * Math.cos(phi) * r, s * Math.sin(phi) * r, z * r], 0.55, 0.4, 0.25), y > 0.92 ? 0.6 : 0];
  });
}

/** 2 — Bayesian optimization: a GP posterior mean, its uncertainty, and samples converging on the peak. */
const SAMPLES: [number, number][] = [
  [-1.45, 1.2], [1.55, 1.25], [-0.55, -1.3], [1.2, -1.1], [0.15, 0.45], [0.9, 0.1], [0.5, -0.35], [0.62, -0.2],
];

function objective(x: number, z: number) {
  return (
    0.95 * Math.exp(-((x - 0.6) ** 2 + (z + 0.2) ** 2) / 0.35) +
    0.5 * Math.exp(-((x + 0.95) ** 2 + (z - 0.7) ** 2) / 0.5) -
    0.35 * Math.exp(-((x + 0.2) ** 2 + (z + 1.0) ** 2) / 0.4) +
    0.08 * Math.sin(1.7 * x) * Math.cos(1.3 * z)
  );
}

function optimization(count: number, salt = 0) {
  const place = (p: Vec3): Vec3 => {
    const [x, y, z] = rotate([p[0] * 0.72, p[1] * 0.72, p[2] * 0.72], 0.62, -0.35);
    return [x, y - 0.25, z];
  };
  return build(count, 37 + salt, (rand) => {
    const roll = rand();
    if (roll < 0.09) {
      const [sx, sz] = SAMPLES[Math.floor(rand() * SAMPLES.length)];
      const [bx, by, bz] = inBall(rand, 0.055);
      return [place([sx + bx, objective(sx, sz) + by, sz + bz]), 1];
    }
    let x = rand() * 3.8 - 1.9;
    let z = rand() * 3.8 - 1.9;
    if (roll < 0.6) {
      // Wireframe: snap one coordinate to the grid.
      const snap = (v: number) => Math.round(v / 0.19) * 0.19;
      if (rand() < 0.5) x = snap(x);
      else z = snap(z);
      return [place([x, objective(x, z), z]), 0];
    }
    if (roll < 0.78) return [place([x, objective(x, z), z]), 0];
    // Uncertainty: wide where we have not sampled, collapsing near observations.
    let near = 0;
    for (const [sx, sz] of SAMPLES) near = Math.max(near, Math.exp(-((x - sx) ** 2 + (z - sz) ** 2) / 0.25));
    const sigma = 0.32 * (1 - near) + 0.01;
    return [place([x, objective(x, z) + gauss(rand) * sigma, z]), 0];
  });
}

/** 3 — Motion capture: a point-cloud figure in a tai-chi pose, with markers and a hand trail. */
const J: Record<string, Vec3> = {
  head: [0, 1.48, 0.02],
  neck: [0, 1.2, 0],
  chest: [0, 0.92, 0],
  pelvis: [0, 0.2, 0],
  lSh: [-0.32, 1.08, 0],
  rSh: [0.32, 1.08, 0],
  lEl: [-0.62, 0.95, 0.1],
  lHa: [-0.95, 1.12, 0.15],
  rEl: [0.58, 0.72, 0.1],
  rHa: [0.85, 0.5, 0.12],
  lHip: [-0.17, 0.14, 0],
  rHip: [0.17, 0.14, 0],
  lKn: [-0.44, -0.44, 0.12],
  lAn: [-0.5, -1.04, 0],
  rKn: [0.4, -0.44, -0.06],
  rAn: [0.52, -1.04, 0.05],
  lToe: [-0.55, -1.1, 0.22],
  rToe: [0.6, -1.1, 0.26],
};

const BONES: [string, string, number][] = [
  ['neck', 'chest', 0.09],
  ['chest', 'pelvis', 0.19],
  ['lSh', 'rSh', 0.07],
  ['lSh', 'lEl', 0.065],
  ['lEl', 'lHa', 0.05],
  ['rSh', 'rEl', 0.065],
  ['rEl', 'rHa', 0.05],
  ['lHip', 'rHip', 0.1],
  ['lHip', 'lKn', 0.095],
  ['lKn', 'lAn', 0.065],
  ['rHip', 'rKn', 0.095],
  ['rKn', 'rAn', 0.065],
  ['lAn', 'lToe', 0.045],
  ['rAn', 'rToe', 0.045],
];

function motion(count: number, salt = 0) {
  const scale = 1.1;
  const place = ([x, y, z]: Vec3): Vec3 => rotate([x * scale, (y - 0.22) * scale, z * scale], 0, 0.2);
  const lengths = BONES.map(([a, b, r]) => Math.hypot(...J[a].map((v, i) => v - J[b][i])) * (r + 0.04));
  const total = lengths.reduce((s, l) => s + l, 0);
  const markers = Object.values(J);

  return build(count, 51 + salt, (rand) => {
    const roll = rand();
    if (roll < 0.07) {
      const m = markers[Math.floor(rand() * markers.length)];
      const [bx, by, bz] = inBall(rand, 0.035);
      return [place([m[0] + bx, m[1] + by, m[2] + bz]), 1];
    }
    if (roll < 0.16) {
      // Trail of the left hand sweeping a "cloud hands" arc.
      // The left hand's recent path, rising from below; denser near the hand.
      const a = 2.59 + Math.pow(rand(), 2) * 1.7;
      return [place([-0.35 + Math.cos(a) * 0.705 + gauss(rand) * 0.012, 0.75 + Math.sin(a) * 0.705 + gauss(rand) * 0.012, 0.15]), 0];
    }
    if (roll < 0.25) {
      const [x, y, z] = inBall(rand, 1);
      const r = 0.17;
      const k = Math.hypot(x, y, z) || 1;
      return [place([J.head[0] + (x / k) * r * 0.9, J.head[1] + (y / k) * r * 1.1, J.head[2] + (z / k) * r]), 0];
    }
    let pick = rand() * total;
    let bone = 0;
    while (pick > lengths[bone] && bone < BONES.length - 1) pick -= lengths[bone++];
    const [a, b, r] = BONES[bone];
    const t = rand();
    const [ox, oy, oz] = inBall(rand, 1);
    const k = (Math.hypot(ox, oy, oz) || 1) / (0.75 + 0.25 * rand());
    const p: Vec3 = [0, 1, 2].map((i) => J[a][i] + (J[b][i] - J[a][i]) * t) as Vec3;
    return [place([p[0] + (ox / k) * r, p[1] + (oy / k) * r, p[2] + (oz / k) * r * 0.7]), 0];
  });
}

/** 4 — Spatial computing: a cubic lattice carved by a sphere — space made legible. */
function space(count: number, salt = 0) {
  const grid = [-1.2, -0.6, 0, 0.6, 1.2];
  const R = 1.45;
  const place = (p: Vec3) => rotate(p, 0.5, 0.65);
  return build(count, 67 + salt, (rand) => {
    const pickG = () => grid[Math.floor(rand() * grid.length)];
    if (rand() < 0.07) {
      for (;;) {
        const n: Vec3 = [pickG(), pickG(), pickG()];
        if (Math.hypot(...n) > R) continue;
        const [bx, by, bz] = inBall(rand, 0.04);
        return [place([n[0] + bx, n[1] + by, n[2] + bz]), 1];
      }
    }
    for (;;) {
      const axis = Math.floor(rand() * 3);
      const t = rand() * 2 * R - R;
      const p: Vec3 = [pickG(), pickG(), pickG()];
      p[axis] = t;
      if (Math.hypot(...p) > R) continue;
      // Edges fade toward the carving sphere, like a horizon.
      if (Math.hypot(...p) / R > 0.75 + 0.25 * rand()) continue;
      return [place([p[0] + gauss(rand) * 0.006, p[1] + gauss(rand) * 0.006, p[2] + gauss(rand) * 0.006]), 0];
    }
  });
}

/** 5 — Karesansui: raked gravel lines that ring around two stones. */
const STONES = [
  { x: 0.55, z: 0.1, rx: 0.3, ry: 0.2, rz: 0.24, reach: 0.95 },
  { x: -1.2, z: -0.45, rx: 0.18, ry: 0.13, rz: 0.15, reach: 0.55 },
];

function garden(count: number, salt = 0) {
  const step = 0.12;
  const place = (p: Vec3): Vec3 => {
    const [x, y, z] = rotate(p, 0.78, 0);
    return [x, y - 0.15, z];
  };
  return build(count, 79 + salt, (rand) => {
    if (rand() < 0.1) {
      const s = rand() < 0.7 ? STONES[0] : STONES[1];
      const [x, y, z] = inBall(rand, 1);
      const k = (Math.hypot(x, y, z) || 1) / (0.8 + 0.2 * rand());
      return [place([s.x + (x / k) * s.rx, Math.abs(y / k) * s.ry, s.z + (z / k) * s.rz]), 0.35];
    }
    for (;;) {
      let x = rand() * 4.2 - 2.1;
      let z = rand() * 2.6 - 1.3;
      const s = STONES.reduce((best, c) =>
        Math.hypot(x - c.x, z - c.z) / c.reach < Math.hypot(x - best.x, z - best.z) / best.reach ? c : best,
      );
      const d = Math.hypot(x - s.x, z - s.z);
      if (d < s.reach) {
        const r = Math.round(d / step) * step;
        if (r < Math.max(s.rx, s.rz) + 0.08) continue;
        const a = Math.atan2(z - s.z, x - s.x);
        x = s.x + Math.cos(a) * r;
        z = s.z + Math.sin(a) * r;
      } else {
        z = Math.round(z / step) * step;
      }
      return [place([x + gauss(rand) * 0.005, gauss(rand) * 0.008, z + gauss(rand) * 0.005]), 0];
    }
  });
}


// ── The garden around you ─────────────────────────────────────

/** What a particle is; the shader gives each kind its own behavior. */
export const GROUP = {
  pool: 0, // travels to whichever station the page is at
  resident: 1, // always at its station
  moon: 2, // fills the ensō at night
  sand: 3, // raked rings around you
  mote: 4, // dust by day, fireflies by night
  star: 5, // night sky
  glint: 6, // 6 + i: an orbiting sound source
} as const;

const FORMATIONS = [enso, audio, optimization, motion, space, garden];

/** Ensō interior, sampled as a soft moon with darker maria. */
function moon(count: number) {
  return build(count, 97, (rand) => {
    for (;;) {
      const r = 1.3 * Math.sqrt(rand());
      const a = rand() * TAU;
      const x = Math.cos(a) * r;
      const y = Math.sin(a) * r;
      const maria = 0.5 + 0.5 * Math.sin(x * 2.3 + 1.1) * Math.cos(y * 1.9 - 0.4);
      if (rand() > 0.35 + 0.65 * maria) continue;
      return [[x, y, -0.15 + gauss(rand) * 0.03], 0];
    }
  });
}

/** Grains along the raked rings (drawn by Ground.ts), with you as the stone at the center. */
function sand(count: number) {
  return build(count, 101, (rand) => {
    // Only the rings you can see past your feet; outer rings are longer, so they get more grains.
    const n = 11 + Math.floor(Math.sqrt(rand()) * 20);
    const r = (n + 0.5) * RAKE + gauss(rand) * 0.01;
    const a = rand() * TAU;
    return [[Math.sin(a) * r, GROUND + gauss(rand) * 0.01, -Math.cos(a) * r], 0];
  });
}

function motes(count: number) {
  return build(count, 127, (rand) => {
    const r = 1.6 + Math.pow(rand(), 0.7) * 11;
    const a = rand() * TAU;
    return [[Math.sin(a) * r, GROUND + rand() * 5.5, -Math.cos(a) * r], 0];
  });
}

function stars(count: number) {
  return build(count, 131, (rand) => {
    const el = 0.12 + Math.pow(rand(), 0.8) * 1.0;
    const a = rand() * TAU;
    const d = 45;
    return [[Math.sin(a) * Math.cos(el) * d, Math.sin(el) * d, -Math.cos(a) * Math.cos(el) * d], rand() < 0.08 ? 0.5 : 0];
  });
}

function glint(count: number, seed: number) {
  return build(count, seed, (rand) => [inBall(rand, 0.14), 1]);
}

export interface WorldData {
  count: number;
  /** Six vec4 targets per particle; only the pool uses more than the first. */
  shapes: Float32Array[];
  group: Float32Array;
}

export function buildWorld(budget: number): WorldData {
  const share = (f: number) => Math.round(budget * f);
  const parts: { group: number; targets: Float32Array[] }[] = [];

  // The pool: one sample per formation, each placed at its own station.
  const pool = share(0.34);
  parts.push({
    group: GROUP.pool,
    targets: FORMATIONS.map((fn, k) => placeAll(fn(pool), k)),
  });

  FORMATIONS.forEach((fn, k) => {
    parts.push({ group: GROUP.resident, targets: [placeAll(fn(share(0.06), 500), k)] });
  });
  parts.push({ group: GROUP.moon, targets: [placeAll(moon(share(0.07)), 0)] });
  parts.push({ group: GROUP.sand, targets: [sand(share(0.1))] });
  parts.push({ group: GROUP.mote, targets: [motes(share(0.06))] });
  parts.push({ group: GROUP.star, targets: [stars(share(0.045))] });
  ORBITERS.forEach((_, i) => parts.push({ group: GROUP.glint + i, targets: [glint(50, 140 + i)] }));

  const count = parts.reduce((n, p) => n + p.targets[0].length / 4, 0);
  const shapes = Array.from({ length: SHAPE_COUNT }, () => new Float32Array(count * 4));
  const group = new Float32Array(count);

  // Interleave all parts in one shuffled order.
  const order = Array.from({ length: count }, (_, i) => i);
  const rand = mulberry32(3);
  for (let i = count - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }

  let i = 0;
  for (const part of parts) {
    const n = part.targets[0].length / 4;
    for (let j = 0; j < n; j++, i++) {
      const dst = order[i];
      group[dst] = part.group;
      for (let s = 0; s < SHAPE_COUNT; s++) {
        const src = part.targets[s] ?? part.targets[0];
        shapes[s].set(src.subarray(j * 4, j * 4 + 4), dst * 4);
      }
    }
  }
  return { count, shapes, group };
}

/** Move a formation from its own frame to its station on the horizon. */
function placeAll(data: Float32Array, k: number, scale = 0.78) {
  for (let i = 0; i < data.length; i += 4) {
    const [x, y, z] = placeAt(k, [data[i] * scale, data[i + 1] * scale, data[i + 2] * scale]);
    data[i] = x;
    data[i + 1] = y;
    data[i + 2] = z;
  }
  return data;
}
