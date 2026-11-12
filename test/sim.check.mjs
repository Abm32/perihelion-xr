// Run: npm test  (Node >= 22.18 strips TypeScript types natively)
import assert from 'node:assert/strict';
import {
  EMPTY_SAVE,
  LEVELS_PER_DAY,
  clearLevel,
  fly,
  levelFor,
  openDay,
  solve,
} from '../src/sim.ts';

const t0 = performance.now();
let fallbacks = 0;
for (let day = 20760; day < 20790; day++) {
  for (let i = 0; i < LEVELS_PER_DAY + 1; i++) {
    const level = levelFor(day, i);
    assert.deepEqual(levelFor(day, i), level, 'same seed, same level');
    const { count, best } = solve(level);
    assert.ok(count > 0 && best, `day ${day} level ${i} is solvable`);
    assert.equal(fly(level, best.px, best.pz), 'hit', 'solution replays');
    if (level.bodies.length !== Math.min(i, 2) + 1) fallbacks++;
  }
}
assert.ok(fallbacks <= 2, `generator fell back ${fallbacks} times in 120 levels`);

// Streak: finish day 10, finish day 11, skip 12, open 13.
let s = openDay(EMPTY_SAVE, 10);
for (let i = 0; i < LEVELS_PER_DAY; i++) s = clearLevel({ ...s, shots: s.shots + 2 });
assert.equal(s.streak, 1);
assert.equal(s.todayShots, 6);
s = clearLevel(s); // encore level does not double count
assert.equal(s.streak, 1);
s = openDay(s, 11);
assert.deepEqual([s.streak, s.index, s.shots], [1, 0, 0]);
for (let i = 0; i < LEVELS_PER_DAY; i++) s = clearLevel(s);
assert.equal(s.streak, 2);
assert.equal(openDay(s, 12).streak, 2, 'streak holds the day after');
assert.equal(openDay(s, 13).streak, 0, 'streak breaks after a missed day');

console.log(`sim ok (${Math.round(performance.now() - t0)} ms, ${fallbacks} fallbacks)`);
