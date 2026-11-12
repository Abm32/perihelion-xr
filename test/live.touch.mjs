// Dev-only: phone AR touch maths. Inside an XR session, cast world-space rays
// from the viewer the way a finger on a phone screen does: onto the comet,
// dragged back along the solver's pull, released. Then one tap on the board.
// Run after `xr enter`. This checks ray -> board mapping and game handling,
// not the browser's touch events themselves.
export default async function run({ frame }) {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const out = [];
  const check = (name, ok, info) => out.push(`${ok ? 'PASS' : 'FAIL'} ${name} ${JSON.stringify(info)}`);
  const eye = [0.05, 1.62, 0.12]; // a phone held a little off the head position
  const info = await frame.evaluate(() => {
    const p = window.__perihelion; const s = p.state();
    return { board: s.board, yaw: s.yaw, launcher: s.level.launcher, best: p.solve(), playY: s.comet[1] };
  });
  // Board point -> world (the emulator's board has yaw 0 here, asserted below).
  const world = (x, z) => [info.board[0] + x, info.playY, info.board[2] + z];
  const dir = (to) => to.map((v, i) => v - eye[i]);
  check('board is unrotated in this scenario', Math.abs(info.yaw) < 1e-6, info.yaw);
  const l = info.launcher;
  const hit = await frame.evaluate(([o, d]) => window.__perihelion.ray(11, o, d, true), [eye, dir(world(l.x, l.z))]);
  check('ray lands on the launch pad', hit && Math.hypot(hit[0] - l.x, hit[1] - l.z) < 0.002, hit);
  let phase = await frame.evaluate(() => window.__perihelion.state().phase);
  check('touching the comet starts a drag', phase === 'drag', phase);
  for (let i = 1; i <= 15; i++) {
    const k = i / 15;
    await frame.evaluate(([o, d]) => window.__perihelion.ray(11, o, d, true), [eye, dir(world(l.x + info.best.px * k, l.z + info.best.pz * k))]);
    await wait(40);
  }
  await wait(400);
  await frame.evaluate(([o, d]) => window.__perihelion.ray(11, o, d, false), [eye, dir(world(l.x + info.best.px, l.z + info.best.pz))]);
  await wait(300);
  phase = await frame.evaluate(() => window.__perihelion.state().phase);
  check('lifting the finger launches', phase === 'fly' || phase === 'won', phase);
  await wait(8000);
  let st = await frame.evaluate(() => { const s = window.__perihelion.state(); return { index: s.save.index, void: !!s.level.void, helper: s.level.helper }; });
  check('touch shot cleared level 1', st.index === 1 && st.void, st);
  const h = st.helper;
  await frame.evaluate(([o, d]) => { const p = window.__perihelion; p.ray(12, o, d, true); p.ray(12, o, d, false); }, [eye, dir(world(h.x, h.z))]);
  const hand = await frame.evaluate(() => window.__perihelion.state().hand);
  check('a tap on the board plants gravity there', hand.gm > 0 && Math.hypot(hand.x - h.x, hand.z - h.z) < 0.002, hand);
  return out.join('\n');
}
