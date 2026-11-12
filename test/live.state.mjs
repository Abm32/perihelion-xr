// Dev-only: print game state from the managed IWSDK browser.
// Run: npx @iwsdk/cli browser run test/live.state.mjs  (dev server needs --allow-browser-automation)
export default async function run({ frame }) {
  return frame.evaluate(() => {
    const s = window.__perihelion.state();
    return { phase: s.phase, message: s.message, save: s.save, board: s.board, yaw: s.yaw, comet: s.comet, ghost: s.ghost, hand: s.hand, bodies: s.level.bodies.length };
  });
}
