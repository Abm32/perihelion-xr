/**
 * Perihelion — pure game logic. No Three.js, no DOM: runs in Node for checks.
 * Board space is meters on the XZ plane; +z points at the player.
 */

export interface Body {
  x: number;
  z: number;
  r: number;
  /** Gravitational parameter (G * mass), m^3/s^2. */
  gm: number;
  hue: number;
  /** A real object found on the player's desk, not a generated body. */
  real?: boolean;
  /** Generated bodies: the heaviest is a star or a black hole, the rest are planets. */
  kind?: 'star' | 'hole' | 'planet' | 'rock';
  /** Circular orbit. `x`,`z` hold the position at shot time 0. */
  orbit?: { cx: number; cz: number; rad: number; phase: number; w: number };
}

/** Where a body is `t` seconds into a shot. Bodies only move while the comet flies. */
export function bodyPos(b: Body, t: number, out: { x: number; z: number }): { x: number; z: number } {
  if (b.orbit) {
    const a = b.orbit.phase + b.orbit.w * t;
    out.x = b.orbit.cx + Math.cos(a) * b.orbit.rad;
    out.z = b.orbit.cz + Math.sin(a) * b.orbit.rad;
  } else {
    out.x = b.x;
    out.z = b.z;
  }
  return out;
}

export interface Level {
  seed: number;
  difficulty: number;
  launcher: { x: number; z: number };
  target: { x: number; z: number; r: number };
  bodies: Body[];
  /**
   * An empty sky: no body here has gravity, and rock blocks every straight
   * path. It cannot be won without gravity the player adds.
   */
  void?: boolean;
  /** For a void level: one spot where added gravity is known to open a path. */
  helper?: { x: number; z: number };
}

export interface Shot {
  x: number;
  z: number;
  vx: number;
  vz: number;
  t: number;
}

export type Outcome = 'flying' | 'hit' | 'crash' | 'lost';

export const BOARD_R = 0.24;
export const DT = 1 / 120; // fixed step, shared by solver and runtime so solutions are exact
// A long pull for the same top speed makes each millimeter of hand error matter less.
export const MAX_PULL = 0.16;
export const MIN_PULL = 0.02;
export const POWER = 3.2; // launch speed (m/s) per meter of pull: 0.51 m/s at full draw
export const TARGET_R = 0.03;
// Launch pad, toward the player. Set in from the rim so a full draw (16 cm) ends 14 cm short of the body.
const PAD_Z = 0.15;
export const LEVELS_PER_DAY = 3;
const SOFT = 1e-5;
/** A hand has no surface to crash into (r = 0), so it gets a 2 cm softening instead. */
const HAND_SOFT = 4e-4;
/** Pull of a pinching hand: about a mid-sized planet. */
export const HAND_GM = 0.006;
const LOST_R2 = (BOARD_R + 0.08) ** 2;
const MAX_T = 6;

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Pull vector (handle minus launcher) to a fresh shot. Pull is clamped. Pass `out` to reuse. */
export function launch(
  level: Level,
  px: number,
  pz: number,
  out: Shot = { x: 0, z: 0, vx: 0, vz: 0, t: 0 },
): Shot {
  const len = Math.hypot(px, pz);
  const k = len > MAX_PULL ? MAX_PULL / len : 1;
  out.x = level.launcher.x;
  out.z = level.launcher.z;
  out.vx = -px * k * POWER;
  out.vz = -pz * k * POWER;
  out.t = 0;
  return out;
}

export function step(level: Level, s: Shot): Outcome {
  let ax = 0;
  let az = 0;
  for (const b of level.bodies) {
    let bx = b.x;
    let bz = b.z;
    if (b.orbit) {
      const a = b.orbit.phase + b.orbit.w * s.t;
      bx = b.orbit.cx + Math.cos(a) * b.orbit.rad;
      bz = b.orbit.cz + Math.sin(a) * b.orbit.rad;
    }
    const dx = bx - s.x;
    const dz = bz - s.z;
    const d2 = dx * dx + dz * dz;
    if (d2 < b.r * b.r) return 'crash';
    const e = d2 + (b.r > 0 ? SOFT : HAND_SOFT);
    const inv = b.gm / (e * Math.sqrt(e));
    ax += dx * inv;
    az += dz * inv;
  }
  s.vx += ax * DT;
  s.vz += az * DT;
  s.x += s.vx * DT;
  s.z += s.vz * DT;
  s.t += DT;
  const tx = level.target.x - s.x;
  const tz = level.target.z - s.z;
  if (tx * tx + tz * tz < level.target.r * level.target.r) return 'hit';
  if (s.x * s.x + s.z * s.z > LOST_R2 || s.t > MAX_T) return 'lost';
  return 'flying';
}

export function fly(level: Level, px: number, pz: number): Outcome {
  const s = launch(level, px, pz);
  let o: Outcome = 'flying';
  while (o === 'flying') o = step(level, s);
  return o;
}

const ANGLES = 96;
const POWERS = 10;

/**
 * Brute-force every launch on a coarse grid. Returns how many hit, and the
 * most forgiving one: the hit with the most neighbouring hits on the grid
 * (one step of angle or power either way). `robust` is that neighbour count,
 * 0..4. A human hand cannot repeat a launch exactly, so a level needs an
 * answer that survives being a little wrong.
 */
export function solve(level: Level): {
  count: number;
  best: { px: number; pz: number } | null;
  robust: number;
} {
  const hit = new Uint8Array(ANGLES * (POWERS + 2));
  let count = 0;
  for (let a = 0; a < ANGLES; a++) {
    const th = (a / ANGLES) * Math.PI * 2;
    for (let p = 1; p <= POWERS; p++) {
      const len = MIN_PULL + ((MAX_PULL - MIN_PULL) * p) / POWERS;
      if (fly(level, Math.cos(th) * len, Math.sin(th) * len) === 'hit') {
        hit[a * (POWERS + 2) + p] = 1;
        count++;
      }
    }
  }
  let best: { px: number; pz: number } | null = null;
  let robust = -1;
  for (let a = 0; a < ANGLES; a++) {
    for (let p = 1; p <= POWERS; p++) {
      if (!hit[a * (POWERS + 2) + p]) continue;
      const n =
        hit[((a + 1) % ANGLES) * (POWERS + 2) + p] +
        hit[((a + ANGLES - 1) % ANGLES) * (POWERS + 2) + p] +
        hit[a * (POWERS + 2) + p + 1] +
        hit[a * (POWERS + 2) + p - 1];
      if (n > robust) {
        robust = n;
        const th = (a / ANGLES) * Math.PI * 2;
        const len = MIN_PULL + ((MAX_PULL - MIN_PULL) * p) / POWERS;
        best = { px: Math.cos(th) * len, pz: Math.sin(th) * len };
      }
    }
  }
  return { count, best, robust: Math.max(0, robust) };
}

function lineBlocked(level: Level): boolean {
  const { launcher: a, target: t } = level;
  const dx = t.x - a.x;
  const dz = t.z - a.z;
  const len2 = dx * dx + dz * dz;
  return level.bodies.some((b) => {
    const u = Math.max(
      0,
      Math.min(1, ((b.x - a.x) * dx + (b.z - a.z) * dz) / len2),
    );
    return Math.hypot(a.x + dx * u - b.x, a.z + dz * u - b.z) < b.r + 0.008;
  });
}

function candidate(seed: number, difficulty: number, attempt: number): Level | null {
  const rnd = mulberry32(seed * 7919 + attempt * 104729 + 1);
  const launcher = { x: 0, z: PAD_Z };
  const target = {
    x: (rnd() * 2 - 1) * 0.16,
    z: -0.17 + rnd() * 0.15,
    r: TARGET_R,
  };
  const bodies: Body[] = [];
  const n = difficulty + 1;
  for (let i = 0; i < n; i++) {
    const r = 0.018 + rnd() * 0.016;
    const b: Body = { x: 0, z: 0, r, gm: 0.004 + rnd() * 0.008, hue: rnd() };
    if (i === 0 && difficulty > 0) {
      // First body sits on the straight line, so the direct shot is blocked.
      const u = 0.4 + rnd() * 0.2;
      b.x = launcher.x + (target.x - launcher.x) * u + (rnd() - 0.5) * r;
      b.z = launcher.z + (target.z - launcher.z) * u + (rnd() - 0.5) * r;
    } else {
      const rad = Math.sqrt(rnd()) * 0.19;
      const th = rnd() * Math.PI * 2;
      b.x = Math.cos(th) * rad;
      b.z = Math.sin(th) * rad;
    }
    const clear =
      Math.hypot(b.x - launcher.x, b.z - launcher.z) > r + 0.09 &&
      Math.hypot(b.x - target.x, b.z - target.z) > r + 0.05 &&
      bodies.every((o) => Math.hypot(b.x - o.x, b.z - o.z) > r + o.r + 0.03);
    if (!clear) return null;
    bodies.push(b);
  }

  const heavy = bodies.reduce((a, b) => (b.gm > a.gm ? b : a), bodies[0]);
  for (const b of bodies) b.kind = b === heavy ? 'star' : 'planet';
  if (difficulty > 0 && rnd() < 0.4) {
    // Black hole: far more mass in a far smaller body, so close passes are violent.
    heavy.kind = 'hole';
    heavy.gm = Math.min(0.02, heavy.gm * 1.8);
    heavy.r = 0.012;
  }
  if (difficulty > 1) {
    // One planet (never the blocker on the firing line) becomes a moon of the primary.
    const moon = bodies.find((b, i) => b !== heavy && i !== 0);
    if (moon) {
      const dist = (p: { x: number; z: number }) => Math.hypot(p.x - heavy.x, p.z - heavy.z);
      // Try a few orbit radii: the whole circle must stay on the board and clear of
      // the pad, the ring and the other planet.
      for (let k = 0; k < 16 && !moon.orbit; k++) {
        const rad = heavy.r + moon.r + 0.03 + rnd() * 0.1;
        const gap = (p: { x: number; z: number }) => Math.abs(dist(p) - rad);
        const free =
          Math.hypot(heavy.x, heavy.z) + rad < 0.2 &&
          gap(launcher) > moon.r + 0.045 &&
          gap(target) > moon.r + 0.04 &&
          bodies.every((o) => o === moon || o === heavy || gap(o) > moon.r + o.r + 0.02);
        if (!free) continue;
        const phase = rnd() * Math.PI * 2;
        moon.x = heavy.x + Math.cos(phase) * rad;
        moon.z = heavy.z + Math.sin(phase) * rad;
        moon.orbit = {
          cx: heavy.x,
          cz: heavy.z,
          rad,
          phase,
          // Kepler's third law, capped so the motion stays readable.
          w: (rnd() < 0.5 ? -1 : 1) * Math.min(2.2, Math.sqrt(heavy.gm / rad ** 3)),
        };
      }
    }
  }
  return { seed, difficulty, launcher, target, bodies };
}

// How many of the 960 grid launches may hit, per difficulty: [min, max].
const WINDOW: [number, number][] = [
  [25, 960],
  [10, 120],
  [6, 90],
];
// Fewest neighbouring hits the best answer must have, per difficulty.
const ROBUST = [4, 3, 3];

/** Deterministic, always-solvable level for a seed. Difficulty 0..2. */
export function generate(seed: number, difficulty: number): Level {
  const d = Math.max(0, Math.min(2, difficulty));
  const [min, max] = WINDOW[d];
  let fallback: Level | null = null;
  for (let attempt = 0; attempt < 120; attempt++) {
    const level = candidate(seed, d, attempt);
    if (!level || (d > 0 && !lineBlocked(level))) continue;
    // Hard levels should have a moon; settle for a static sky only late in the search.
    if (d === 2 && attempt < 70 && !level.bodies.some((b) => b.orbit)) continue;
    const { count, robust } = solve(level);
    // Late in the search, accept a slightly less forgiving answer rather than none.
    const need = attempt < 90 ? ROBUST[d] : ROBUST[d] - 1;
    if (count >= min && count <= max && robust >= need) return level;
    if (count > 0 && robust >= 2) fallback ??= level;
  }
  // Open board with a straight shot: only if 120 seeded layouts all failed.
  return (
    fallback ?? {
      seed,
      difficulty: d,
      launcher: { x: 0, z: PAD_Z },
      target: { x: 0, z: -0.12, r: TARGET_R },
      bodies: [],
    }
  );
}

/** Local calendar day as an integer; tomorrow is always today + 1. */
export function dayNumber(now: Date = new Date()): number {
  return Math.floor(
    Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / 86400000,
  );
}

/** A gravity well the player plants: no surface, hand softening. */
export function plantedWell(x: number, z: number, gm = HAND_GM): Body {
  return { x, z, r: 0, gm, hue: 0.75 };
}

/**
 * An empty sky. Rocks have no gravity, so the comet flies dead straight and a
 * rock on the firing line blocks every launch: provably unsolvable as dealt.
 * The level is accepted only if one planted well, tried at four spots beside
 * the rock, opens a path.
 */
export function generateVoid(seed: number): Level {
  for (let attempt = 0; attempt < 40; attempt++) {
    const rnd = mulberry32(seed * 6151 + attempt * 9973 + 5);
    const launcher = { x: 0, z: PAD_Z };
    const target = { x: (rnd() * 2 - 1) * 0.13, z: -0.16 + rnd() * 0.1, r: TARGET_R };
    const dx = target.x - launcher.x;
    const dz = target.z - launcher.z;
    const len = Math.hypot(dx, dz);
    const u = 0.42 + rnd() * 0.16;
    const rock: Body = {
      x: launcher.x + dx * u,
      z: launcher.z + dz * u,
      r: 0.036 + rnd() * 0.012,
      gm: 0,
      hue: rnd(),
      kind: 'rock',
    };
    const level: Level = { seed, difficulty: 1, launcher, target, bodies: [rock], void: true };
    if (solve(level).count > 0) continue; // a straight shot slipped past: not a void
    // Perpendicular to the firing line, on either side of the rock.
    const nx = -dz / len;
    const nz = dx / len;
    let best = 0;
    for (const side of [1, -1]) {
      for (const off of [rock.r + 0.035, rock.r + 0.07]) {
        const hx = rock.x + nx * off * side;
        const hz = rock.z + nz * off * side;
        if (Math.hypot(hx, hz) > BOARD_R - 0.03) continue;
        const helped = solve({ ...level, bodies: [rock, plantedWell(hx, hz)] });
        const count = helped.robust >= 3 ? helped.count : 0;
        if (count > best) {
          best = count;
          level.helper = { x: hx, z: hz };
        }
      }
    }
    if (best >= 6) return level;
  }
  return generate(seed, 1); // 40 seeded skies all failed: fall back to an ordinary level
}

/**
 * The daily set: an easy sky, an empty sky you must add gravity to, a hard sky.
 * Encore levels are hard, with every third one empty.
 */
export function levelFor(day: number, index: number): Level {
  const seed = day * 100 + index;
  if (index === 1 || (index > 3 && index % 3 === 1)) return generateVoid(seed);
  return generate(seed, index === 0 ? 0 : 2);
}

export interface Save {
  /** Last day the daily set was finished. */
  lastDay: number;
  streak: number;
  /** In-progress day, so quitting mid-set resumes. */
  day: number;
  index: number;
  shots: number;
  /** Shots used to finish today's set (0 = not finished). */
  todayShots: number;
  /** Hand gravity was used at least once today. */
  nudged: boolean;
  /** Closest winning pass of the primary ever flown, in meters (0 = none yet). */
  closest: number;
  /** One entry per day of the current streak, newest last: 1 = cleared, 2 = cleared with no hand gravity. */
  log: number[];
}

export const EMPTY_SAVE: Save = {
  lastDay: -1,
  streak: 0,
  day: -1,
  index: 0,
  shots: 0,
  todayShots: 0,
  nudged: false,
  closest: 0,
  log: [],
};

/** Roll the save forward to `day`: new day resets progress, a skipped day breaks the streak. */
export function openDay(save: Save, day: number): Save {
  if (save.day === day) return save;
  return {
    ...save,
    day,
    index: 0,
    shots: 0,
    todayShots: 0,
    nudged: false,
    streak: save.lastDay >= day - 1 ? save.streak : 0,
    log: save.lastDay >= day - 1 ? save.log : [],
  };
}

/** Record one cleared level. */
export function clearLevel(save: Save): Save {
  const next = { ...save, index: save.index + 1 };
  if (next.index === LEVELS_PER_DAY && save.lastDay !== save.day) {
    next.streak = save.streak + 1;
    next.lastDay = save.day;
    next.todayShots = save.shots;
    next.log = [...save.log, save.nudged ? 1 : 2].slice(-30);
  }
  return next;
}

// ---- real desk objects ------------------------------------------------------

/** One downward depth probe: board-space position and height above the board origin. */
export interface DeskSample {
  x: number;
  z: number;
  h: number;
}

export const DESK_STEP = 0.045; // probe grid spacing
export const OBJECT_MIN_H = 0.035; // about three sigma of the depth noise we plan for (1.2 cm)
const OBJECT_MIN_PROBES = 2; // one tall probe is an outlier, never an object

/** Hex grid of probe points covering the board. */
export function deskProbePoints(): { x: number; z: number }[] {
  const pts: { x: number; z: number }[] = [];
  const rows = Math.ceil(BOARD_R / (DESK_STEP * 0.866));
  for (let j = -rows; j <= rows; j++) {
    const z = j * DESK_STEP * 0.866;
    const shift = j % 2 === 0 ? 0 : DESK_STEP / 2;
    for (let i = -rows; i <= rows; i++) {
      const x = i * DESK_STEP + shift;
      if (Math.hypot(x, z) <= BOARD_R - 0.02) pts.push({ x, z });
    }
  }
  return pts;
}

/**
 * Height of the flat surface under the board, or null when the probes do not
 * agree on one (board floating in the air, clutter everywhere, too few hits).
 * Only probes within 35 cm of the board's current height vote: a board that
 * overhangs the desk edge sends many rays to the floor, and those must not win.
 */
export function deskSurface(samples: DeskSample[]): number | null {
  const hs = samples
    .map((s) => s.h)
    .filter((h) => Math.abs(h) < 0.35)
    .sort((a, b) => a - b);
  if (hs.length < 12) return null;
  // Objects only ever stick up, so look for the surface below the median, then
  // refine to the mean of everything near it so noise does not bias it low.
  const base = hs[Math.floor(hs.length * 0.4)];
  const flat = hs.filter((h) => Math.abs(h - base) < 0.03);
  if (flat.length < hs.length * 0.5) return null;
  return flat.reduce((a, h) => a + h, 0) / flat.length;
}

/**
 * Depth noise as the desk itself shows it: the spread of probe heights around
 * the fitted surface, in meters. Probes more than 5 cm off are objects or
 * outliers, not noise, and are left out.
 */
export function deskNoise(samples: DeskSample[], surface: number): number {
  const res = samples.map((s) => s.h - surface).filter((d) => Math.abs(d) < 0.05);
  if (res.length < 8) return 0;
  return Math.sqrt(res.reduce((a, d) => a + d * d, 0) / res.length);
}

/** Height a probe must clear to count as an object: three sigma of the measured noise, at least 3.5 cm. */
export function objectThreshold(noise: number): number {
  return Math.min(0.08, Math.max(OBJECT_MIN_H, noise * 3));
}

/** Group probes that stand clear of the surface into at most three round bodies. */
export function clusterDesk(samples: DeskSample[], surface: number, minHeight = OBJECT_MIN_H): Body[] {
  const tall = samples.filter((s) => s.h - surface > minHeight && s.h - surface < 0.4);
  const seen = new Set<DeskSample>();
  const bodies: (Body & { n: number })[] = [];
  for (const seed of tall) {
    if (seen.has(seed)) continue;
    const group = [seed];
    seen.add(seed);
    for (let k = 0; k < group.length; k++) {
      for (const o of tall) {
        if (!seen.has(o) && Math.hypot(o.x - group[k].x, o.z - group[k].z) < DESK_STEP * 1.2) {
          seen.add(o);
          group.push(o);
        }
      }
    }
    if (group.length < OBJECT_MIN_PROBES) continue;
    const x = group.reduce((a, g) => a + g.x, 0) / group.length;
    const z = group.reduce((a, g) => a + g.z, 0) / group.length;
    const reach = Math.max(...group.map((g) => Math.hypot(g.x - x, g.z - z)));
    bodies.push({
      x,
      z,
      r: Math.min(0.07, reach + DESK_STEP / 2),
      gm: Math.min(0.012, 0.004 + 0.0015 * group.length), // bigger footprint, more pull
      hue: 0.1,
      real: true,
      n: group.length,
    });
  }
  return bodies
    .sort((a, b) => b.n - a.n)
    .slice(0, 3)
    .map(({ n: _n, ...b }) => b);
}

/**
 * Two-scan agreement. A body is adopted only if the previous scan saw one in
 * the same place; independent noise rarely repeats itself in one spot.
 */
export function confirmDesk(previous: Body[], current: Body[]): Body[] {
  return current.filter((c) => previous.some((p) => Math.hypot(p.x - c.x, p.z - c.z) < DESK_STEP));
}
