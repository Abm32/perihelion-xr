// Dev-only: rescan and summarise the raw probe heights.
export default async function run({ frame }) {
  await frame.evaluate(() => window.__perihelion.scan());
  await new Promise((r) => setTimeout(r, 6000));
  return frame.evaluate(() => {
    const p = window.__perihelion; const hs = p.lastScan().map((s) => +s.h.toFixed(3)).sort((a, b) => a - b);
    return { scanner: p.scanner(), n: hs.length, hs: hs.join(' '), desk: p.desk().length, message: p.state().message };
  });
}
