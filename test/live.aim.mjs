// Dev-only: world-space coordinates an emulated hand needs to play the current level.
// Assumes the board is unrotated (yaw 0), as it is when the headset faces -Z.
export default async function run({ frame }) {
  return frame.evaluate(() => {
    const p = window.__perihelion; const s = p.state(); const l = s.level.launcher; const b = p.solve();
    const y = s.comet[1];
    const w = (x, z) => [+(s.board[0] + x).toFixed(4), +y.toFixed(4), +(s.board[2] + z).toFixed(4)];
    // Empty sky: what to pull once gravity is planted at the helper spot (plant, solve, throw it away again).
    let helped = null;
    const h = s.level.helper;
    if (h) {
      p.pointer(7, h.x, h.z, true); p.pointer(7, h.x, h.z, false);
      const b2 = p.solve();
      helped = b2 && w(l.x + b2.px, l.z + b2.pz);
      p.pointer(7, h.x, h.z, true); p.pointer(7, 0.6, 0, true); p.pointer(7, 0.6, 0, false);
    }
    return JSON.stringify({ pad: w(l.x, l.z), pull: b && w(l.x + b.px, l.z + b.pz), helped, helper: s.level.helper ? w(s.level.helper.x, s.level.helper.z) : null, straight: w(l.x, l.z + 0.12), phase: s.phase, index: s.save.index, msg: s.message });
  });
}
