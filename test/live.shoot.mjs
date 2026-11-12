// Dev-only: fire the solver's answer once.
export default async function run({ frame }) {
  await frame.evaluate(() => { const b = window.__perihelion.solve(); window.__perihelion.shoot(b.px, b.pz); });
  return 'fired';
}
