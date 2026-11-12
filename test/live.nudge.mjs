// Dev-only: fire a slow shot and sample the hand-gravity state mid-flight.
// Expects a hand already pinching over the board (see README, live checks).
export default async function run({ frame }) {
  await frame.evaluate(() => window.__perihelion.shoot(0.0, 0.03));
  await new Promise((r) => setTimeout(r, 500));
  return frame.evaluate(() => { const s = window.__perihelion.state(); return { phase: s.phase, hand: s.hand, nudged: s.save.nudged }; });
}
