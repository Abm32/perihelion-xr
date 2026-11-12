// Dev-only: read the app's self-measurement under CPU throttling.
// PERF_RATE=4 slows the page's CPU fourfold (Chrome DevTools throttling). The
// desktop GPU is not slowed, so this bounds script cost, not fill cost.
// Run inside an active XR session: plays today's hardest level for a few seconds.
export default async function run({ frame, cdp }) {
  const rate = Number(process.env.PERF_RATE ?? 1);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  await cdp.send('Emulation.setCPUThrottlingRate', { rate });
  try {
    await frame.evaluate(() => { const p = window.__perihelion; p.load(p.state().save.day, 2); });
    await wait(1500);
    for (let i = 0; i < 2; i++) {
      await frame.evaluate(() => { const p = window.__perihelion; const b = p.solve(); if (p.state().phase === 'aim') p.shoot(b.px * 0.9, b.pz); });
      await wait(3500);
    }
    const r = await frame.evaluate(() => window.__perihelion.state().perf);
    return r && { rate, frames: r.frames, avgFps: r.avgFps, low1Fps: r.low1Fps, updateMsAvg: r.updateMsAvg, updateMsMax: r.updateMsMax, quality: r.quality };
  } finally {
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  }
}
