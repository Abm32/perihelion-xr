// Dev-only: the report line shown on the page after an immersive session.
export default async function run({ frame }) {
  return frame.evaluate(() => document.getElementById('perf-line')?.textContent ?? '(missing)');
}
