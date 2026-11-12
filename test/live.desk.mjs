// Dev-only: report what the desk scan found and where the board settled.
export default async function run({ frame }) {
  return frame.evaluate(() => {
    const p = window.__perihelion; const s = p.state();
    return { phase: s.phase, message: s.message, board: s.board.map((n) => +n.toFixed(3)), desk: p.desk() };
  });
}
