// Run: npm test  (Node >= 22.18 strips TypeScript types natively)
import assert from 'node:assert/strict';
import {
  EMPTY_SAVE,
  HAND_GM,
  bodyPos,
  plantedWell,
  clusterDesk,
  confirmDesk,
  deskNoise,
  objectThreshold,
  deskProbePoints,
  deskSurface,
  launch,
  step,
  LEVELS_PER_DAY,
  clearLevel,
  fly,
  levelFor,
  openDay,
  solve,
} from '../src/sim.ts';

const t0 = performance.now();
let fallbacks = 0;
let moons = 0;
let holes = 0;
let voids = 0;
for (let day = 20760; day < 20790; day++) {
  for (let i = 0; i < LEVELS_PER_DAY + 1; i++) {
    const level = levelFor(day, i);
    assert.deepEqual(levelFor(day, i), level, 'same seed, same level');
    if (level.void) {
      // Empty sky: impossible as dealt, possible once gravity is planted at the helper spot.
      voids++;
      assert.equal(solve(level).count, 0, `day ${day} void level has no straight path`);
      assert.ok(level.helper, 'void level names a helper spot');
      const helped = { ...level, bodies: [...level.bodies, plantedWell(level.helper.x, level.helper.z)] };
      const h = solve(helped);
      assert.ok(h.count >= 6 && h.best, `day ${day} void level opens with planted gravity`);
      assert.equal(fly(helped, h.best.px, h.best.pz), 'hit');
      continue;
    }
    const { count, best } = solve(level);
    assert.ok(count > 0 && best, `day ${day} level ${i} is solvable`);
    assert.equal(fly(level, best.px, best.pz), 'hit', 'solution replays');
    if (level.bodies.length !== (i === 0 ? 1 : 3)) fallbacks++;
    assert.equal(level.bodies.filter((b) => b.kind !== 'planet').length, 1, 'one primary');
    if (i === 0) assert.ok(level.bodies.every((b) => !b.orbit && b.kind !== 'hole'), 'first level stays simple');
    for (const b of level.bodies) {
      if (b.kind === 'hole') holes++;
      if (!b.orbit) continue;
      moons++;
      const p0 = bodyPos(b, 0, { x: 0, z: 0 });
      assert.ok(Math.hypot(p0.x - b.x, p0.z - b.z) < 1e-9, 'orbit starts at the stored position');
      const p1 = bodyPos(b, (2 * Math.PI) / Math.abs(b.orbit.w), { x: 0, z: 0 });
      assert.ok(Math.hypot(p1.x - b.x, p1.z - b.z) < 1e-9, 'orbit closes after one period');
      for (let t = 0; t < 6; t += 0.05) {
        const p = bodyPos(b, t, { x: 0, z: 0 });
        assert.ok(Math.hypot(p.x - level.target.x, p.z - level.target.z) > b.r + 0.02, 'moon never covers the ring');
        assert.ok(Math.hypot(p.x - level.launcher.x, p.z - level.launcher.z) > b.r + 0.02, 'moon never covers the pad');
      }
    }
  }
}
assert.ok(fallbacks <= 2, `generator fell back ${fallbacks} times in 120 levels`);
assert.ok(voids >= 28, `only ${voids} void levels in 120`);
assert.ok(moons >= 10, `only ${moons} orbiting moons in 120 levels`);
assert.ok(holes >= 10, `only ${holes} black holes in 120 levels`);

// Hand gravity: a pinching hand on the flight line changes the path and never produces NaN.
{
  const level = levelFor(20760, 0);
  const withHand = { ...level, bodies: [...level.bodies, { x: 0, z: 0.1, r: 0, gm: HAND_GM, hue: 0 }] };
  const a = launch(level, 0.03, 0.08);
  const b = launch(level, 0.03, 0.08);
  for (let i = 0; i < 60; i++) { step(level, a); step(withHand, b); }
  assert.ok(Number.isFinite(b.x) && Number.isFinite(b.z));
  assert.ok(Math.hypot(a.x - b.x, a.z - b.z) > 0.005, 'hand bends the path');
}

// Desk scan: a noisy flat desk 2 cm below the board origin with a mug and one noise spike.
{
  const rnd = (i) => ((Math.sin(i * 12.9898) * 43758.5453) % 1) * 0.008;
  const pts = deskProbePoints();
  assert.ok(pts.length > 40 && pts.length < 120, `probe count ${pts.length}`);
  const mug = { x: 0.09, z: -0.05 };
  const samples = pts.map((p, i) => ({
    ...p,
    h: -0.02 + rnd(i) + (Math.hypot(p.x - mug.x, p.z - mug.z) < 0.045 ? 0.09 : 0),
  }));
  samples[3].h += 0.04; // lone low spike: must be ignored
  const surface = deskSurface(samples);
  assert.ok(surface !== null && Math.abs(surface + 0.02) < 0.012, `surface ${surface}`);
  const found = clusterDesk(samples, surface);
  assert.equal(found.length, 1, 'one object, spike ignored');
  assert.ok(Math.hypot(found[0].x - mug.x, found[0].z - mug.z) < 0.03, 'object where the mug is');
  assert.ok(found[0].r >= 0.02 && found[0].r <= 0.07 && found[0].real);
  assert.equal(clusterDesk(samples.map((s) => ({ ...s, h: -0.02 })), -0.02).length, 0, 'empty desk');
  assert.equal(deskSurface(samples.map((s, i) => ({ ...s, h: i * 0.05 }))), null, 'no flat surface');
  // Board overhanging the desk edge: the near half of the rays reach the floor.
  const overhang = samples.map((s) => (s.z > 0 ? { ...s, h: -0.72 } : s));
  const edge = deskSurface(overhang);
  assert.ok(edge !== null && Math.abs(edge + 0.02) < 0.012, `overhang surface ${edge}`);
  assert.equal(clusterDesk(overhang, edge).length, 1, 'mug still found, floor ignored');
  assert.equal(deskSurface(samples.map((s) => ({ ...s, h: -0.9 }))), null, 'board in mid-air');
}

// Desk scan under realistic depth noise: 1.2 cm jitter plus 3% outliers of 5 cm.
{
  let seed = 99;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-9)) * Math.cos(2 * Math.PI * rnd());
  const pts = deskProbePoints();
  let phantom = 0;
  let found = 0;
  let phantom2 = 0;
  let found2 = 0;
  let prevEmpty = [];
  let prevMug = [];
  for (let trial = 0; trial < 300; trial++) {
    const noisy = (mug) => pts.map((p) => ({
      ...p,
      h: gauss() * 0.012 + (rnd() < 0.03 ? 0.05 : 0) + (mug && Math.hypot(p.x - 0.08, p.z + 0.04) < 0.045 ? 0.09 : 0),
    }));
    const empty = noisy(false);
    const s0 = deskSurface(empty);
    const e = s0 === null ? [] : clusterDesk(empty, s0);
    if (e.length > 0) phantom++;
    if (confirmDesk(prevEmpty, e).length > 0) phantom2++;
    prevEmpty = e;
    const withMug = noisy(true);
    const s1 = deskSurface(withMug);
    const m = s1 === null ? [] : clusterDesk(withMug, s1);
    const isMug = (b) => Math.hypot(b.x - 0.08, b.z + 0.04) < 0.04;
    if (m.some(isMug)) found++;
    if (confirmDesk(prevMug, m).some(isMug)) found2++;
    prevMug = m;
  }
  console.log(`desk noise: single scan phantom ${phantom}/300, mug ${found}/300; two-scan agreement phantom ${phantom2}/300, mug ${found2}/300`);
  assert.ok(phantom <= 45, `single-scan phantoms: ${phantom}/300`);
  assert.ok(phantom2 <= 3, `phantom objects survive two-scan agreement: ${phantom2}/300`);
  assert.ok(found2 >= 285, `mug lost by two-scan agreement: ${found2}/300`);
}

// Noisier depth than planned for (2 cm): the scan measures the noise and raises its own bar.
{
  let seed = 7;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-9)) * Math.cos(2 * Math.PI * rnd());
  const pts = deskProbePoints();
  let fixed = 0;
  let adaptive = 0;
  let agreed = 0;
  let measured = 0;
  let prev = [];
  for (let trial = 0; trial < 300; trial++) {
    const scan = pts.map((p) => ({ ...p, h: gauss() * 0.02 }));
    const surface = deskSurface(scan);
    if (surface === null) continue;
    const noise = deskNoise(scan, surface);
    measured += noise;
    if (clusterDesk(scan, surface).length) fixed++;
    const found = clusterDesk(scan, surface, objectThreshold(noise));
    if (found.length) adaptive++;
    if (confirmDesk(prev, found).length) agreed++;
    prev = found;
  }
  console.log(`2 cm depth noise: measured ${(measured / 300 * 1000).toFixed(1)} mm; phantoms fixed bar ${fixed}/300, adaptive bar ${adaptive}/300, adaptive + agreement ${agreed}/300`);
  assert.ok(Math.abs(measured / 300 - 0.02) < 0.004, 'noise estimate is close to the truth');
  assert.ok(adaptive < fixed / 3, 'adaptive bar removes most phantoms');
  assert.ok(agreed <= 2, `phantoms survive adaptive bar and agreement: ${agreed}/300`);
  assert.equal(objectThreshold(0.005), 0.035, 'quiet depth keeps the 3.5 cm floor');
}

// Streak: finish day 10, finish day 11, skip 12, open 13.
let s = openDay(EMPTY_SAVE, 10);
for (let i = 0; i < LEVELS_PER_DAY; i++) s = clearLevel({ ...s, shots: s.shots + 2 });
assert.equal(s.streak, 1);
assert.equal(s.todayShots, 6);
assert.deepEqual(s.log, [2], 'clean day logs 2');
s = clearLevel(s); // encore level does not double count
assert.equal(s.streak, 1);
s = openDay(s, 11);
assert.deepEqual([s.streak, s.index, s.shots], [1, 0, 0]);
s = { ...s, nudged: true };
for (let i = 0; i < LEVELS_PER_DAY; i++) s = clearLevel(s);
assert.equal(s.streak, 2);
assert.deepEqual(s.log, [2, 1], 'nudged day logs 1');
assert.equal(openDay(s, 12).streak, 2, 'streak holds the day after');
assert.equal(openDay(s, 13).streak, 0, 'streak breaks after a missed day');
assert.deepEqual(openDay(s, 13).log, [], 'log clears with the streak');

console.log(`sim ok (${Math.round(performance.now() - t0)} ms, ${fallbacks} fallbacks, ${moons} moons, ${holes} black holes, ${voids} voids)`);
