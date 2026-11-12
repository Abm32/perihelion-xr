// Dev-only: re-place the board a few seconds from now, from inside the page, so
// it can happen while the recorder (which blocks other scripts) is running.
export default async function run({ frame }) {
  const ms = Number(process.env.PLACE_IN ?? 5000);
  await frame.evaluate((t) => { setTimeout(() => window.__perihelion.place(), t); }, ms);
  return `place in ${ms} ms`;
}
