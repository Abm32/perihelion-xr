// Dev-only: drive one full win and one miss through the debug hook, assert state transitions.
export default async function run({ frame }) {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const get = () => frame.evaluate(() => { const s = window.__perihelion.state(); return { phase: s.phase, msg: s.message, save: s.save }; });
  const out = [];
  const check = (name, ok, info) => out.push(`${ok ? 'PASS' : 'FAIL'} ${name} ${JSON.stringify(info)}`);
  await frame.evaluate(() => { localStorage.removeItem('perihelion.v1'); });
  await frame.evaluate(() => location.reload()).catch(() => {});
  await wait(4000);
  let s = await get();
  check('initial aim, level 0, 0 shots', s.phase === 'aim' && s.save.index === 0 && s.save.shots === 0, s);
  // Miss: fire straight backwards off the board.
  await frame.evaluate(() => window.__perihelion.shoot(0, -0.1));
  await wait(200);
  s = await get();
  check('flying after shoot', s.phase === 'fly', s.phase);
  await wait(4000);
  s = await get();
  check('miss returns to aim, shot counted', s.phase === 'aim' && s.save.shots === 1 && s.save.index === 0, s);
  // Win all three daily levels with the solver's answer.
  for (let i = 0; i < 3; i++) {
    await frame.evaluate(() => {
      const p = window.__perihelion;
      const level = p.state().level;
      if (level.void) {
        // Empty sky: nothing to solve until gravity is planted. Plant it where the generator proved it works.
        p.pointer(1, level.helper.x, level.helper.z, true);
        p.pointer(1, level.helper.x, level.helper.z, false);
      }
      const b = p.solve();
      p.shoot(b.px, b.pz);
    });
    await wait(9000);
    s = await get();
    check(`level ${i} cleared`, s.phase === 'aim' && s.save.index === i + 1, s);
  }
  check('streak 1 and todayShots 4 after daily set', s.save.streak === 1 && s.save.todayShots === 4, s.save);
  const stored = await frame.evaluate(() => JSON.parse(localStorage.getItem('perihelion.v1')));
  check('persisted', stored.index === 3 && stored.streak === 1, stored);
  return out.join('\n');
}
