// Dev-only: schedule a hands-off desktop playthrough from inside the page (the
// recorder blocks other scripts): drag the comet on level 1, then on the empty
// sky plant gravity and drag again. Uses the same pointer path as a mouse.
export default async function run({ frame }) {
  await frame.evaluate(() => {
    const p = window.__perihelion;
    const at = (ms, fn) => setTimeout(fn, ms);
    const drag = (t0, id, getPull) => {
      at(t0, () => { const l = p.state().level.launcher; p.pointer(id, l.x, l.z, true); });
      for (let i = 1; i <= 24; i++) at(t0 + i * 40, () => { const l = p.state().level.launcher; const b = getPull(); p.pointer(id, l.x + (b.px * i) / 24, l.z + (b.pz * i) / 24, true); });
      at(t0 + 1700, () => { const l = p.state().level.launcher; const b = getPull(); p.pointer(id, l.x + b.px, l.z + b.pz, false); });
    };
    let pull = null;
    at(4200, () => { pull = p.solve(); });
    drag(4300, 0, () => pull);
    // Level 2, the empty sky: plant gravity at the helper spot, then pull.
    at(11500, () => { const h = p.state().level.helper; p.pointer(1, h.x + 0.05, h.z + 0.04, true); });
    for (let i = 1; i <= 15; i++) at(11500 + i * 50, () => { const h = p.state().level.helper; const k = 1 - i / 15; p.pointer(1, h.x + 0.05 * k, h.z + 0.04 * k, true); });
    at(12500, () => { const h = p.state().level.helper; p.pointer(1, h.x, h.z, false); pull = p.solve(); });
    drag(13300, 0, () => pull);
  });
  return 'scheduled';
}
