// Dev-only: stage the empty-sky level mid-aim with gravity planted, for a screenshot.
export default async function run({ frame }) {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  await frame.evaluate(() => { const p = window.__perihelion; p.load(p.state().save.day, 1); });
  await wait(500);
  await frame.evaluate(() => {
    const p = window.__perihelion; const lv = p.state().level;
    p.pointer(1, lv.helper.x, lv.helper.z, true); p.pointer(1, lv.helper.x, lv.helper.z, false);
    const b = p.solve(); const l = lv.launcher;
    p.pointer(0, l.x, l.z, true);
    window.__hold = setInterval(() => p.pointer(0, l.x + b.px, l.z + b.pz, true), 30);
  });
  await wait(1200);
  return 'staged';
}
