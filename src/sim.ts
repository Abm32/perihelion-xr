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
}

export interface Level {
  seed: number;
  difficulty: number;
  launcher: { x: number; z: number };
  target: { x: number; z: number; r: number };
  bodies: Body[];
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
export const MAX_PULL = 0.1;
export const MIN_PULL = 0.015;
export const POWER = 5; // launch speed (m/s) per meter of pull
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
    const dx = b.x - s.x;
    const dz = b.z - s.z;
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

/** Brute-force every launch on a coarse grid. Returns how many hit, and one that does. */
export function solve(level: Level): {
  count: number;
  best: { px: number; pz: number } | null;
} {
  let count = 0;
  let best: { px: number; pz: number } | null = null;
  for (let a = 0; a < ANGLES; a++) {
    const th = (a / ANGLES) * Math.PI * 2;
    for (let p = 1; p <= POWERS; p++) {
      const len = MIN_PULL + ((MAX_PULL - MIN_PULL) * p) / POWERS;
      const px = Math.cos(th) * len;
      const pz = Math.sin(th) * len;
      if (fly(level, px, pz) === 'hit') {
        count++;
        best ??= { px, pz };
      }
    }
  }
  return { count, best };
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
  const launcher = { x: 0, z: 0.19 };
  const target = {
    x: (rnd() * 2 - 1) * 0.16,
    z: -0.17 + rnd() * 0.15,
    r: 0.022,
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
  return { seed, difficulty, launcher, target, bodies };
}

// How many of the 960 grid launches may hit, per difficulty: [min, max].
const WINDOW: [number, number][] = [
  [25, 960],
  [6, 70],
  [3, 45],
];

/** Deterministic, always-solvable level for a seed. Difficulty 0..2. */
export function generate(seed: number, difficulty: number): Level {
  const d = Math.max(0, Math.min(2, difficulty));
  const [min, max] = WINDOW[d];
  let fallback: Level | null = null;
  for (let attempt = 0; attempt < 60; attempt++) {
    const level = candidate(seed, d, attempt);
    if (!level || (d > 0 && !lineBlocked(level))) continue;
    const { count } = solve(level);
    if (count >= min && count <= max) return level;
    if (count > 0) fallback ??= level;
  }
  // Open board with a straight shot: only if 60 seeded layouts all failed.
  return (
    fallback ?? {
      seed,
      difficulty: d,
      launcher: { x: 0, z: 0.19 },
      target: { x: 0, z: -0.12, r: 0.022 },
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

/** Daily levels 0..2 ramp in difficulty; anything after is an endless hard encore. */
export function levelFor(day: number, index: number): Level {
  return generate(day * 100 + index, Math.min(index, 2));
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
