// Dev-only: load today's third level (index 2), fire the solver's answer, and
// sample shot time against wall time to show slow motion and a moving moon.
export default async function run({ frame }) {
  const day = await frame.evaluate(() => window.__perihelion.state().save.day);
  await frame.evaluate((d) => window.__perihelion.load(d, 2), day);
  const kinds = await frame.evaluate(() => window.__perihelion.state().level.bodies.map((b) => b.kind + (b.orbit ? '+orbit' : '')));
  await frame.evaluate(() => { const b = window.__perihelion.solve(); window.__perihelion.shoot(b.px, b.pz); });
  const samples = [];
  const t0 = Date.now();
  let last = null;
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 150));
    const s = await frame.evaluate(() => { const s = window.__perihelion.state(); return { phase: s.phase, t: s.t, peri: s.periapsis, v: s.topSpeed, msg: s.message, q: s.quality }; });
    samples.push(`${((Date.now() - t0) / 1000).toFixed(2)}s wall -> ${s.t.toFixed(2)}s shot`);
    last = s;
    if (s.phase !== 'fly') break;
  }
  return { kinds, samples: samples.filter((_, i) => i % 3 === 0), last };
}
