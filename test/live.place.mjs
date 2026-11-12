// Dev-only: re-place the board in front of the current head pose and rescan the desk.
export default async function run({ frame }) {
  await frame.evaluate(() => window.__perihelion.place());
  await new Promise((r) => setTimeout(r, 6000));
  return frame.evaluate(() => {
    const p = window.__perihelion; const s = p.state();
    return { message: s.message, board: s.board.map((n) => +n.toFixed(3)), desk: p.desk().map((b) => ({ x: +b.x.toFixed(3), z: +b.z.toFixed(3), r: +b.r.toFixed(3), gm: b.gm })) };
  });
}
