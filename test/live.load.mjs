// Dev-only: load today's level at the index given by PERI_INDEX (default 2).
export default async function run({ frame }) {
  const index = Number(process.env.PERI_INDEX ?? 2);
  const day = await frame.evaluate(() => window.__perihelion.state().save.day);
  await frame.evaluate(([d, i]) => window.__perihelion.load(d, i), [day, index]);
  return `loaded ${day}/${index}`;
}
