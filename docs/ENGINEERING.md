# Perihelion engineering log

What got in the way while building Perihelion, what we found, and what we did about it. Entries are in the
order we hit them. Each one says how it was verified, and what is still unproven.

**Standing constraint:** the whole build was done without a physical headset. Everything marked *verified*
was verified in the IWSDK browser emulator (Quest 3 profile, emulated hands, synthetic living room). The
[open risks](#open-risks) section lists what only a device can settle.

| # | Problem | Fix in one line |
|---|---|---|
| 1 | [No headset to test on](#1-no-headset-to-test-on) | Scripted emulator loop that drives real input and reads game state |
| 2 | [Random levels can be unsolvable](#2-random-levels-can-be-unsolvable) | Brute-force solver gates every generated level |
| 3 | [Solver and game could disagree](#3-solver-and-game-could-disagree) | One fixed 120 Hz step shared by both |
| 4 | [Grabbing the comet mid-flight](#4-grabbing-the-comet-mid-flight) | Deferred forced release |
| 5 | [Authored scene vs generated content](#5-authored-scene-vs-generated-content) | Board built in code; scene file holds only the welcome card |
| 6 | [Emulator commands failing silently](#6-emulator-commands-failing-silently) | Wait on readiness, re-enter XR after reloads |
| 7 | [Bloom is not affordable on Quest](#7-bloom-is-not-affordable-on-quest) | Additive billboard sprites |
| 8 | [Particles rendered as black squares](#8-particles-rendered-as-black-squares) | Write intensity to alpha |
| 9 | [Planet lighting broke when the board turned](#9-planet-lighting-broke-when-the-board-turned) | Spin the noise, not the mesh |
| 10 | [Passthrough did not matter](#10-passthrough-did-not-matter) | The player's hand is a gravity well |
| 11 | [A gravity well you can fly through](#11-a-gravity-well-you-can-fly-through) | Separate softening for the hand |
| 12 | [Onboarding was a sentence](#12-onboarding-was-a-sentence) | Ghost demo driven by the solver |
| 13 | [Occlusion ignored our shaders](#13-occlusion-ignored-our-shaders) | Anchor chunks plus one-time patch |
| 14 | [Occlusion faded the board into the desk](#14-occlusion-faded-the-board-into-the-desk) | Raised the play plane |
| 15 | [Quest does not report objects on a desk](#15-quest-does-not-report-objects-on-a-desk) | Depth-backed hit-test scan |
| 16 | [The scan mistook the floor for the desk](#16-the-scan-mistook-the-floor-for-the-desk) | Only probes near the board vote |
| 17 | [Hands read as desk objects](#17-hands-read-as-desk-objects) | Discard probes under a hand |
| 18 | [Real objects can make a level impossible](#18-real-objects-can-make-a-level-impossible) | Re-solve and ask the player to move something |
| 19 | [Deployment details](#19-deployment-details) | Explicit Vercel scope, relative asset paths |

---

## 1. No headset to test on

**Problem.** A hands-first mixed reality game has to be judged on a headset, and none was available.

**What we did.** Built a verification loop out of the IWSDK CLI:

- A debug hook, `window.__perihelion`, exposes `state()`, `shoot()`, `solve()`, `desk()`, `place()`, `scan()`.
- `test/live.*.mjs` scripts run inside the managed browser (`npx @iwsdk/cli browser run`) and assert state
  transitions: a miss, three wins, streak, persistence.
- The real input path is driven with `xr run-sequence`: an emulated hand moves to the comet, pinches, pulls
  and releases. That exercises `GrabSystem`, not the hook.
- The emulator's room has planes, hit-test geometry and depth, so placement, the desk scan and occlusion
  all run there.

**Verified.** Every feature below was exercised this way.
**Unproven.** Tracking jitter, real depth noise, frame rate, comfort. See [open risks](#open-risks).

## 2. Random levels can be unsolvable

**Problem.** A seeded random layout of planets and a target is often impossible, or trivially easy.

**What we did.** `generate()` builds a candidate, then `solve()` flies 960 launches (96 angles x 10 powers)
through it. A level is accepted only if the number of winning launches falls in a window per difficulty
(25+, 6 to 70, 3 to 45). From level 2 on, the first body is placed on the straight line to the target, so a
direct shot is blocked and the player must use gravity.

**Verified.** `npm test` generates 120 levels and asserts each is solvable, deterministic, and that the
solver's answer replays as a hit. Zero fallbacks in that run.

## 3. Solver and game could disagree

**Problem.** If the game integrates with the display's frame time, a shot the solver found may miss at
72 Hz and hit at 90 Hz.

**What we did.** One constant, `DT = 1/120 s`, and one `step()` function. The solver calls it directly. The
runtime accumulates frame time and runs whole steps (capped at 0.1 s per frame). Same inputs, same path, at
any frame rate.

**Verified.** The live scenario fires the solver's launch through the running game three times; all three hit.

## 4. Grabbing the comet mid-flight

**Problem.** The resting comet stays grabbable while a shot is in the air. A pinch there would start a
second drag.

**What we did.** The `Grabbed` qualify handler checks the phase. Outside `aim` it sets a flag, and the next
`update()` calls `GrabSystem.forceRelease()`. Releasing inside the query callback would mutate the query
while it is being notified.

## 5. Authored scene vs generated content

**Problem.** IWSDK favours scenes authored as JSON. Our content is different every level.

**What we did.** The scene file contains only the browser welcome card. `OrrerySystem` builds the board
under one root `Group` and rebuilds the level group on each load. Only things that need IWSDK behaviour
(the comet, the rim puck, the root) are entities.

## 6. Emulator commands failing silently

**Problem.** Twice a batch of checks returned `ok: false` with no state change: once because the managed
browser was still launching, once because a source edit hot-reloaded the page and ended the XR session.

**What we did.** Test batches now poll until a trivial script succeeds before running, and re-enter XR after
any edit. A stale result was never taken as a pass; the affected batch was rerun.

## 7. Bloom is not affordable on Quest

**Problem.** Glowing stars and comets want bloom. Meta's guidance for mobile VR is that a true bloom pass is
too expensive on a tiled GPU, and that billboarded blob sprites come close.

**What we did.** No post-processing at all. Every glow is an additive sprite using one shared radial
gradient texture. Particles are small points to keep transparent overdraw low.

## 8. Particles rendered as black squares

**Problem.** The first particle shader showed opaque black squares over the room in AR.

**Cause.** Three.js additive blending leaves destination colour alone but still adds source alpha. In
passthrough the compositor uses framebuffer alpha to decide how much of the real world shows. Alpha 1 meant
"opaque", and the colour there was nearly black.

**What we did.** Additive shaders now write their intensity to alpha: `vec4(color, intensity)`. The same fix
went into the atmosphere shell.

**Verified.** Before and after frames in the emulator's passthrough room.

## 9. Planet lighting broke when the board turned

**Problem.** Planets are lit from the level's star. Rotating each mesh to spin the planet also rotated its
normals, and the board itself is turned to face the player, so a light direction in board space was wrong
in world space.

**What we did.** Meshes never rotate. The spin is applied to the noise lookup inside the shader. Normals and
the light direction both go through `mat3(modelMatrix)`, which is safe because every body is only
translated and uniformly scaled under the root.

## 10. Passthrough did not matter

**Problem.** The competition asks that the real room change the experience. A board that merely sits on the
desk plays the same with passthrough off.

**What we did.** Made the player's body part of the simulation. During a flight, a pinch held over the
board turns that hand into a movable gravity well: a violet orb appears and the grid sinks under the
fingers. Later, real objects on the desk joined in ([#15](#15-quest-does-not-report-objects-on-a-desk)).

**Design guard.** The solver never sees the hand, so every level stays solvable with one hand. A day cleared
without the hand earns a gold rim light instead of a blue one.

**Verified.** Emulated left-hand pinch during a flight: `hand.gm = 0.006`, `nudged = true`.

## 11. A gravity well you can fly through

**Problem.** Planets have a crash radius, so the comet never gets close to the singularity. A hand has no
surface. With the planet softening (`1e-5`), a comet passing between the fingers saw accelerations in the
hundreds of m/s².

**What we did.** Bodies with `r = 0` use a 2 cm softening (`4e-4`). The pull stays strong at range and
levels off inside the fingers.

**Verified.** `npm test` flies a comet through a hand and asserts finite positions and a bent path.

## 12. Onboarding was a sentence

**Problem.** "Pinch the comet. Pull back. Let go." is a wall of text in miniature, and it gives no payoff.

**What we did.** Before the first shot of the day, the system asks the solver for one winning launch,
records its path, and loops a 3.4 s ghost: a cue closes on the comet like a pinch, a ghost comet is pulled
back with the band drawn, then it flies the recorded path into the ring. Copying it wins level 1.

## 13. Occlusion ignored our shaders

**Problem.** IWSDK's `DepthSensingSystem` makes real objects hide virtual ones, but three things stopped it
working with our materials:

1. It injects code by string-replacing chunks that only built-in Three.js materials contain
   (`#include <common>`, `#include <fog_vertex>`, `uniform vec3 diffuse;`, `vec4 diffuseColor = ...`).
   A custom `ShaderMaterial` has none of them, so the patch was a silent no-op: sprites and lines were
   occluded, planets and the grid were not.
2. It skips patching when the shader's uniforms already contain `occlusionEnabled`. For a `ShaderMaterial`
   the uniforms object is the material's own, so after the first compile every recompile was skipped and
   came out unpatched.
3. It patches materials once, when `DepthOccludable` is added. Each level creates new materials.

**What we did.**

- All five custom shaders carry the anchor lines and multiply their final alpha by `diffuseColor.a`.
- `occlude()` in `src/vfx.ts` applies the system's own patch once, at material creation, so the shader text
  is permanently patched and the system only has to feed uniforms.
- `refreshOcclusion()` removes and re-adds `DepthOccludable` after each level load and each desk scan.
- Depth is requested as an **optional** session feature. Without it the injected branch stays off.

**Trade-off.** `occlude()` calls a method that is private in `@iwsdk/core` 1.1.0-rc.2. The dependency is
pinned to that exact version, and the call is optional-chained: if a later release renames it, occlusion
turns off for those shaders and nothing else breaks.

**Verified.** Session reports `depth-sensing` enabled in the emulator, shaders compile with the injected
code, no console errors. **Unproven:** how the edges look around real fingers.

## 14. Occlusion faded the board into the desk

**Problem.** The injected test fades a fragment unless the real surface is at least 5 cm behind it. The
grid sat 5.2 cm above the desk, with wells dipping to under 1 cm.

**What we did.** Raised the play plane from 6 cm to 8 cm. The flat grid is now clear of the fade from normal
seated angles. Wells still sink toward the desk and fade as they go, which reads as the sheet pressing
into the surface.

## 15. Quest does not report objects on a desk

**Problem.** We wanted a mug on the desk to bend the comet. Quest scene data lists room furniture (table,
couch, screen), not small objects, and reflects a room scan that may be weeks old. The live depth map is
only exposed to a web page as a GPU texture, so reading it on the CPU means an expensive readback.

**What we found.** Since Horizon Browser 40.4, WebXR hit tests on Quest 3 and 3S are answered from the
Depth API instead of the saved scene mesh, out to about 5 m. A hit test is a CPU-side query against live
depth.

**What we did.** `src/desk.ts` casts 85 rays straight down over the board on a 4.5 cm hex grid, in batches
of 10 hit-test sources that are cancelled after four readings each. A scan takes roughly a second. The
heights go to two pure functions in `src/sim.ts`:

- `deskSurface()` finds the flat surface under the board.
- `clusterDesk()` groups probes standing more than 3 cm proud of it into at most three round bodies, with
  pull scaled by footprint and a crash radius. A lone probe must be 6 cm tall to count, because depth noise
  at arm's length is about a centimetre.

A real object is not drawn. It gets a ring on the grid at its base, the grid sinks under it, and with
occlusion on it hides the comet passing behind it. The scan also corrects the board's height.

**Verified.** Emulated player seated at the emulator's coffee table: plane detection put the board at
0.424 m, the scan corrected it to 0.440 m, and the cup on the table became one body (`r = 0.048 m`,
`gm = 0.0085`) with the HUD reading "That object on your desk has gravity now."
**Unproven.** The emulator answers hit tests from clean geometry. Real depth is noisier, and how many
simultaneous hit-test sources the Quest browser tolerates is not documented. Batches of 10 are a guess.

## 16. The scan mistook the floor for the desk

**Problem.** In the first emulator run the scan found nothing, although three probes clearly read 15 cm
tall. The raw heights showed why: the board overhung the table, 57 of 85 rays reached the floor, and the
percentile-based surface estimate chose the floor.

**What we did.** Only probes within 35 cm of the board's current height vote for the surface. Rays that fall
off the desk edge are simply "no desk there".

**Verified.** A regression case in `npm test` (half the rays at floor height) plus the live rerun in #15.

## 17. Hands read as desk objects

**Problem.** A hand hovering over the board is a tall thing on the desk as far as depth is concerned.

**What we did.** When a probe finishes, it is discarded if it lies within 12 cm of either hand's grip pose.
Scans are applied only in the `aim` phase, so the field never changes under a comet in flight.

## 18. Real objects can make a level impossible

**Problem.** The solvability guarantee covers generated bodies. A mug in front of the launcher breaks it.

**What we did.** After every scan that changes the desk, the solver runs on the combined field. If nothing
hits, the HUD says "Your desk blocks every path. Move something." and the desk is rescanned every 3 s. The
aiming preview and the onboarding ghost use the same combined field.

## 19. Deployment details

- The account had two Vercel scopes, so a bare `vercel deploy` stopped and asked. Deploys name the scope.
- `perihelion.vercel.app` belongs to someone else; the production alias is `perihelion-three.vercel.app`.
- Vite is configured with `base: './'`, so the same build works from any path.

---

## Open risks

Only a headset can close these.

| Risk | Why it is open | Escape hatch |
|---|---|---|
| Frame rate under 60 fps | Never profiled on device. Costs added late: 13-tap soft occlusion on the grid, three noise shaders | `?occlusion=hard` (1 tap) or `?occlusion=0` |
| Depth noise creates phantom objects | Emulator depth is clean | Thresholds in `src/sim.ts`; `?desk=0` |
| Too many hit-test sources | Browser limit unknown | `BATCH` in `src/desk.ts` |
| Pinch feel and hand-gravity strength | Tuned by reading state, not by feel | `HAND_GM`, grab radius |
| Occlusion edges around fingers | Depth map is about 320 px per eye | `?occlusion=0` |
| Particle size | One hand-tuned constant | `900.0` in the particle shader |
