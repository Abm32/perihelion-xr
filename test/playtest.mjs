// Simulated playtest. Run: npm run playtest
//
// A model of a person, not a solver:
// - Hands are imprecise: every release lands with Gaussian error (default 5 mm
//   per axis: tracking jitter plus the twitch of letting go).
// - They cannot compute orbits. First shot: straight at the ring, medium pull.
// - They learn from what they see. Each try is a variation on their best shot
//   so far, judged by how close its trail came to the ring. Variations start
//   wide (2.5 cm) and narrow by 15% each time a try does not improve.
// - They use the aiming preview. Before letting go they sweep the comet around
//   (six candidate pulls) and keep the one whose dotted line gets nearest the
//   ring. The preview is long on level 1 and short afterwards, as in the game.
// - On an empty-sky level they plant gravity near the hint spot, off by 1.5 cm.
//
// It reports how many shots that person needs, and how forgiving the known
// answer is to hand error. It reads feel, not correctness.
import { LEVELS_PER_DAY, MAX_PULL, launch, levelFor, plantedWell, solve, step } from '../src/sim.ts';

const SIGMA = Number(process.env.SIGMA ?? 0.005);
const DAYS = Number(process.env.DAYS ?? 20);
const TRIALS = Number(process.env.TRIALS ?? 40);
const MAX_SHOTS = 15;

let seed = 12345;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());

/** Fly a shot (or only its first `steps`, as the preview shows); report hit and closest approach to the ring. */
function attempt(level, px, pz, steps = Infinity) {
  const s = launch(level, px, pz);
  let o = 'flying';
  let closest = Infinity;
  for (let n = 0; o === 'flying' && n < steps; n++) {
    o = step(level, s);
    const d = Math.hypot(s.x - level.target.x, s.z - level.target.z);
    if (d < closest) closest = d;
  }
  return { hit: o === 'hit', closest };
}

function clamp(px, pz) {
  const len = Math.hypot(px, pz);
  return len > MAX_PULL ? [(px / len) * MAX_PULL, (pz / len) * MAX_PULL] : [px, pz];
}

function playOnce(level) {
  let field = level;
  if (level.void) {
    field = {
      ...level,
      bodies: [...level.bodies, plantedWell(level.helper.x + gauss() * 0.015, level.helper.z + gauss() * 0.015)],
    };
  }
  // Intent for the first shot: pull straight away from the ring, 60% power.
  const dx = level.target.x - level.launcher.x;
  const dz = level.target.z - level.launcher.z;
  const len = Math.hypot(dx, dz);
  let best = [(-dx / len) * MAX_PULL * 0.6, (-dz / len) * MAX_PULL * 0.6];
  let bestClosest = Infinity;
  let spread = 0.025;
  for (let shot = 1; shot <= MAX_SHOTS; shot++) {
    // Sweep while aiming: keep the candidate whose preview looks best.
    const horizon = level.difficulty === 0 || level.void ? 192 : 80;
    let intent = best;
    let look = shot === 1 ? attempt(field, best[0], best[1], horizon).closest : Infinity;
    for (let k = 0; k < 6; k++) {
      const c = clamp(best[0] + gauss() * spread, best[1] + gauss() * spread);
      const v = attempt(field, c[0], c[1], horizon).closest;
      if (v < look) {
        look = v;
        intent = c;
      }
    }
    const [px, pz] = clamp(intent[0] + gauss() * SIGMA, intent[1] + gauss() * SIGMA);
    const r = attempt(field, px, pz);
    if (r.hit) return shot;
    if (r.closest < bestClosest) {
      bestClosest = r.closest;
      best = intent;
    } else {
      spread = Math.max(0.006, spread * 0.85);
    }
  }
  return Infinity;
}

/** Chance that the solver's own answer still hits when a human hand releases it. */
function forgiveness(level) {
  const field = level.void
    ? { ...level, bodies: [...level.bodies, plantedWell(level.helper.x, level.helper.z)] }
    : level;
  const best = solve(field).best;
  let hits = 0;
  for (let i = 0; i < 100; i++) {
    if (attempt(field, best.px + gauss() * SIGMA, best.pz + gauss() * SIGMA).hit) hits++;
  }
  return hits / 100;
}

const day0 = 20760;
const names = ['1 easy', '2 empty sky', '3 hard'];
console.log(`hand error ${SIGMA * 1000} mm, ${DAYS} days x ${TRIALS} players, give up after ${MAX_SHOTS} shots\n`);
console.log('level          median  p90   gave up   answer survives hand error');
const out = [];
for (let i = 0; i < LEVELS_PER_DAY; i++) {
  const shots = [];
  let forgive = 0;
  for (let d = 0; d < DAYS; d++) {
    const level = levelFor(day0 + d, i);
    forgive += forgiveness(level);
    for (let t = 0; t < TRIALS; t++) shots.push(playOnce(level));
  }
  shots.sort((a, b) => a - b);
  const q = (p) => shots[Math.floor((shots.length - 1) * p)];
  const gaveUp = shots.filter((s) => s === Infinity).length / shots.length;
  const row = { level: names[i], median: q(0.5), p90: q(0.9), gaveUp, forgiveness: forgive / DAYS };
  out.push(row);
  const f = (v) => (v === Infinity ? '>15' : String(v)).padEnd(6);
  console.log(`${names[i].padEnd(14)} ${f(row.median)}  ${f(row.p90)}${(gaveUp * 100).toFixed(0).padStart(4)}%      ${(row.forgiveness * 100).toFixed(0)}%`);
}
export default out;
