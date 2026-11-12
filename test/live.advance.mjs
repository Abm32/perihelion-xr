// Dev-only: clear N levels with the solver so later levels can be inspected.
export default async function run({ frame }) {
  for (let i = 0; i < 2; i++) {
    await frame.evaluate(() => { const b = window.__perihelion.solve(); window.__perihelion.shoot(b.px, b.pz); });
    await new Promise((r) => setTimeout(r, 8500));
  }
  return frame.evaluate(() => window.__perihelion.state().save.index);
}
