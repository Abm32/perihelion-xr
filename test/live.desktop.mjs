// Dev-only: play the first level the way a desktop visitor does, with a pointer
// in board space: press on the comet, draw back along the solver's pull over
// 20 frames, let go. Then check an empty-sky level refuses a straight shot and
// shows its hint after two misses.
export default async function run({ frame }) {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const out = [];
  const check = (name, ok, info) => out.push(`${ok ? 'PASS' : 'FAIL'} ${name} ${JSON.stringify(info)}`);
  await frame.evaluate(() => localStorage.removeItem('perihelion.v1'));
  await frame.evaluate(() => location.reload()).catch(() => {});
  await wait(4000);
  const info = await frame.evaluate(() => { const p = window.__perihelion; const s = p.state(); return { launcher: s.level.launcher, best: p.solve() }; });
  await frame.evaluate(({ launcher }) => window.__perihelion.pointer(0, launcher.x, launcher.z, true), info);
  let s = await frame.evaluate(() => window.__perihelion.state().phase);
  check('press on comet starts a drag', s === 'drag', s);
  for (let i = 1; i <= 20; i++) {
    await frame.evaluate(({ launcher, best, k }) => window.__perihelion.pointer(0, launcher.x + best.px * k, launcher.z + best.pz * k, true), { ...info, k: i / 20 });
    await wait(40);
  }
  await wait(400); // let the release smoothing settle on the held pull
  await frame.evaluate(({ launcher, best }) => window.__perihelion.pointer(0, launcher.x + best.px, launcher.z + best.pz, false), info);
  await wait(300);
  s = await frame.evaluate(() => window.__perihelion.state().phase);
  check('letting go launches', s === 'fly' || s === 'won', s);
  await wait(8000);
  let st = await frame.evaluate(() => { const s = window.__perihelion.state(); return { index: s.save.index, void: !!s.level.void, phase: s.phase }; });
  check('dragged shot cleared level 1; level 2 is an empty sky', st.index === 1 && st.void, st);
  for (let i = 0; i < 2; i++) {
    await frame.evaluate(() => window.__perihelion.shoot(0, 0.1)); // straight at the rock
    await wait(3500);
  }
  st = await frame.evaluate(() => { const s = window.__perihelion.state(); return { index: s.save.index, misses: s.misses, hint: s.hint }; });
  check('straight shots fail and the hint appears', st.index === 1 && st.misses === 2 && st.hint, st);
  await frame.evaluate(() => { const p = window.__perihelion; const h = p.state().level.helper; p.pointer(1, h.x, h.z, true); p.pointer(1, h.x, h.z, false); const b = p.solve(); p.shoot(b.px, b.pz); });
  await wait(8000);
  st = await frame.evaluate(() => { const s = window.__perihelion.state(); return { index: s.save.index, nudged: s.save.nudged, render: s.render }; });
  check('planted gravity clears it, without costing the gold light', st.index === 2 && st.nudged === false, st);
  return out.join('\n');
}
