// Dev-only: draw calls and triangles per frame on each of today's three levels.
export default async function run({ frame }) {
  const day = await frame.evaluate(() => window.__perihelion.state().save.day);
  const rows = [];
  for (const i of [0, 1, 2]) {
    await frame.evaluate(([d, n]) => window.__perihelion.load(d, n), [day, i]);
    await new Promise((r) => setTimeout(r, 800));
    const r = await frame.evaluate(() => window.__perihelion.state().render);
    rows.push(`level ${i + 1}: ${r.calls} draw calls, ${r.triangles} triangles, ${r.points} points, ${r.lines} lines`);
  }
  return rows.join(' | ');
}
