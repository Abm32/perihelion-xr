# Perihelion

**A daily gravity puzzle that lives on your desk.** Pinch the comet, pull back, let go — and bend its path
around the planets into the ring.

Built for the Meta VR Start Developer Competition 2026 (Gaming track, New Experience) with the
[Immersive Web SDK](https://developers.meta.com/horizon/documentation/iwsdk/guides/overview/).

## How it plays

- **Hands only.** One verb: pinch, pull, release. No controller, no menus, no buttons.
- **Seated.** The whole board is 54 cm across and sits within arm's reach.
- **On your real desk.** In passthrough the board snaps onto the nearest horizontal surface at desk height.
  Pinch the amber puck on the rim to drag it somewhere else.
- **Three puzzles a day.** Everyone gets the same three skies, easy to hard. Finish them to grow your
  streak; miss a day and it resets. Encore levels follow for anyone who wants more.

## How it works

| File | What it does |
|---|---|
| `src/sim.ts` | Pure game logic: gravity integration at a fixed 120 Hz step, seeded level generator, brute-force solver, streak rules. No Three.js or DOM. |
| `src/orrery.ts` | The IWSDK system: board, comet (`OneHandGrabbable`), trajectory preview, trail, HUD, desk placement from `XRPlane`. |
| `src/sfx.ts` | Procedural Web Audio. There are no audio files. |
| `src/panel.ts` | Browser welcome card with the Enter XR button. |

Every level is solved on a 960-launch grid before it is accepted, and the solver uses the same fixed step
as the game, so a daily puzzle is never unsolvable. All visuals are generated in code.

## Run it

Needs Node 22.18+ (or 24).

```bash
npm install
npm run dev        # managed browser with the XR emulator
npm test           # sim self-check: 120 levels solvable, deterministic, streak rules
npm run typecheck
npm run build
```

`test/live.*.mjs` drive the running app through `npx @iwsdk/cli browser run` (start the dev server with
`--allow-browser-automation`).

## Status

Verified in the IWSDK emulator (Quest 3 profile, hand input): pinch, pull, release, win, miss, streak
persistence. Not yet tested on a physical headset.
