// Dev-only: a real mouse drag. Press on the comet, draw back along the solver's
// pull, release. This goes through the canvas pointer events, not the hook.
export default async function run({ page, frame }) {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  await frame.evaluate(() => localStorage.removeItem('perihelion.v1'));
  await frame.evaluate(() => location.reload()).catch(() => {});
  await wait(4000);
  const el = await frame.frameElement().catch(() => null);
  const box = el ? await el.boundingBox() : { x: 0, y: 0 };
  const pts = await frame.evaluate(() => {
    const p = window.__perihelion; const l = p.state().level.launcher; const b = p.solve();
    return { from: p.toScreen(l.x, l.z), to: p.toScreen(l.x + b.px, l.z + b.pz) };
  });
  const at = ([x, y]) => [box.x + x, box.y + y];
  await page.mouse.move(...at(pts.from));
  await page.mouse.down();
  const phase1 = await frame.evaluate(() => window.__perihelion.state().phase);
  for (let i = 1; i <= 15; i++) {
    await page.mouse.move(...at([pts.from[0] + ((pts.to[0] - pts.from[0]) * i) / 15, pts.from[1] + ((pts.to[1] - pts.from[1]) * i) / 15]));
    await wait(40);
  }
  await wait(400);
  await page.mouse.up();
  await wait(7000);
  const end = await frame.evaluate(() => { const s = window.__perihelion.state(); return { index: s.save.index, shots: s.save.shots }; });
  return { afterPress: phase1, end };
}
