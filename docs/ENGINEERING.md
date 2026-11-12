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
| 20 | [Moving bodies vs a provable level](#20-moving-bodies-vs-a-provable-level) | Time advances only while the comet flies |
| 21 | [Moons almost never appeared](#21-moons-almost-never-appeared) | Construct the orbit, then prefer moon layouts |
| 22 | [A black hole without ray tracing](#22-a-black-hole-without-ray-tracing) | Three cheap layers that read as one |
| 23 | [Slow motion without breaking determinism](#23-slow-motion-without-breaking-determinism) | Scale time fed to the fixed step |
| 24 | [No way to measure frame rate](#24-no-way-to-measure-frame-rate) | The app governs itself |
| 25 | [Would it fit a narrower headset view?](#25-would-it-fit-a-narrower-headset-view) | Measured against the glasses profile; HUD lowered |
| 26 | [Correct levels that nobody could win](#26-correct-levels-that-nobody-could-win) | Simulated playtest; longer draw, wider ring, forgiving answers |
| 27 | [A slingshot is a known genre](#27-a-slingshot-is-a-known-genre) | Empty skies that only the player's gravity can solve |
| 28 | [Hand gravity needed two hands and fast timing](#28-hand-gravity-needed-two-hands-and-fast-timing) | Planted gravity that stays put |
| 29 | [No human had ever played it](#29-no-human-had-ever-played-it) | Mouse, webcam hands and live tuning in the browser |
| 30 | [Depth noise invented desk objects](#30-depth-noise-invented-desk-objects) | Two adjacent probes, two agreeing scans |
| 31 | [Is the scene within Quest's budget?](#31-is-the-scene-within-quests-budget) | Counted draw calls and triangles |
| 32 | [Three numbers we could not measure](#32-three-numbers-we-could-not-measure) | The app measures itself and prints a report |
| 33 | [Our hand-error figure was optimistic](#33-our-hand-error-figure-was-optimistic) | Re-ran the playtest at published error; smoothed the well |
| 34 | [Depth noise was a guess](#34-depth-noise-was-a-guess) | The scan measures noise and sets its own threshold |
| 35 | [The only real device was a phone](#35-the-only-real-device-was-a-phone) | Touch input for the AR session |

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

## 20. Moving bodies vs a provable level

**Problem.** Orbiting moons make gravity assists possible, but if moons run on wall-clock time the outcome
of a shot depends on the instant of release. The solver cannot prove a level solvable, and two players get
different puzzles from the same seed.

**What we did.** Made it a rule: the sky moves only while the comet flies. `step()` poses every orbiting
body from the shot's own elapsed time, and the sky rewinds when the comet resets. Solver, aiming preview
and live flight all see the same moving field. The moon's track is drawn so its future position can be
judged before firing.

**Verified.** `npm test` checks each orbit starts at its stored position, closes after one period, and
never sweeps over the pad or the ring. Live: today's third level (black hole, moon, planet) was cleared by
the solver's launch.

## 21. Moons almost never appeared

**Problem.** First attempt turned an already-placed planet into a moon if its circle happened to be clear.
Over 120 test levels that produced **1** moon. A second attempt, drawing a fresh radius 16 times, produced
**9**: most accepted layouts simply had no room.

**What we did.** Two changes. The moon is now *constructed*: pick a radius that keeps the whole circle on
the board and clear of pad, ring and the other planet, then place the moon on it. And on hard levels the
generator skips layouts without a moon for the first 45 attempts before settling for a static sky. Skipped
layouts never reach the solver, so the search stays cheap.

**Verified.** 35 of the 60 hard levels in the test window now have a moon; all 120 are still solvable.
The test asserts a floor of 10 so a regression is caught.

## 22. A black hole without ray tracing

**Problem.** The film look (bent light around a dark sphere) is gravitational lensing, a ray-traced effect.
A full-screen distortion pass is exactly the kind of post-processing ruled out in [#7](#7-bloom-is-not-affordable-on-quest),
and in passthrough there is no rendered background to distort.

**What we did.** Three cheap layers: a black sphere (alpha 1, so it truly blots out the room), a flat ring
mesh with a shader for the disc (Keplerian shear, `r^-3/4` temperature colour, one Doppler-bright side),
and one billboard sprite for the photon ring. The grid well under it does the rest. `docs/PHYSICS.md`
states plainly that this is painted, not simulated.

## 23. Slow motion without breaking determinism

**Problem.** A slow-motion close pass is the cinematic beat we wanted, but changing the time step near the
primary would change the path and void the solver's proof.

**What we did.** The step never changes. The runtime scales how much frame time it feeds the accumulator
(down to 30% near the primary), so fewer fixed steps run per frame. Same steps, same path, slower playback.

**Verified.** Live sample on a black-hole level: 0.61 s of wall time advanced the shot by 0.43 s, and the
solver's launch still hit.

## 24. No way to measure frame rate

**Problem.** The competition expects 60 fps on Quest hardware, and this build has never run on one. The
costliest addition is soft real-world occlusion: 13 depth samples per fragment.

**What we did.** A governor in `OrrerySystem`. While immersive it keeps a running average of frame time;
if that stays above 1/55 s for three seconds it steps occlusion from 13 taps to 1, and three seconds later
to off. It only ever steps down, so there is no oscillation.

**Trade-off.** In the headless emulator, which is slow, the governor fires. That is expected and does not
reflect device performance either way.

## 25. Would it fit a narrower headset view?

**Problem.** Judging asks for field-of-view-aware design, and the board was laid out by eye in a Quest 3
emulator. Meta VR Glasses see only 37° to each side, 25° up and 43° down.

**What we did.** Switched the emulator to the `metaVRGlasses` profile, looked at the board centre from the
default seat, and captured the masked frame. Separately computed each essential element's angle against
the view axis from runtime positions. Everything fit. The tightest was the top of the HUD at 20.1° against
a 25° limit, so the HUD was lowered 2.5 cm (to about 18°). The widest is the rim puck at 27.7° against 37°.

**Verified.** Masked screenshot shows board, HUD, puck and streak lights unclipped; a hand pinch, pull and
release under the glasses profile launched a shot. The table of angles is in the README.
**Unproven.** Fit for a player who sits much closer than the default 45 cm.

## 26. Correct levels that nobody could win

**Problem.** Every level was proven solvable, and that proved nothing about people. Feel had been tuned by
reading numbers.

**What we did.** Wrote `test/playtest.mjs`: a model of a player with imprecise hands (5 mm error per
release) who aims at the ring, watches the trail, and tries variations. Its first report: level 1 took a
median of 5 shots, level 3 took 14, and the solver's own answer survived a human release only about 30%
of the time. The game was too twitchy to enjoy.

The cause was sensitivity. A full draw was 10 cm, so 5 mm of error was 5% of the range. Fixes, each
re-measured: draw lengthened to 16 cm for the same top speed, ring widened from 2.2 to 3 cm, the solver
changed to return the most forgiving answer and levels required to have one, the release point smoothed
over 80 ms, and hints added for anyone stuck.

**Verified.** Level 1: median 1 shot, answer survives 96%. Level 3: median 3 shots, 3% give up. Full
before-and-after tables are in `docs/PLAYTEST.md`.
**Unproven.** The 5 mm hand error is an assumption about Quest tracking, not a measurement.

**Side effect caught.** The longer draw reached 10 cm from the player's body. The launch pad moved 4 cm in
from the rim so a full draw ends 14 cm short.

## 27. A slingshot is a known genre

**Problem.** Scored honestly, the core verb was familiar: pull back, let go, curve around planets.
Planted gravity and desk objects were optional extras on top of it.

**What we did.** Made the player's gravity the point. One level a day is an empty sky: a single rock with
no gravity sits on the firing line. With nothing to bend its path the comet flies straight into the rock,
so the generator can prove the level has no solution at all. It is accepted only if gravity planted at a
tested spot opens a forgiving path. The player solves it by pinching the air, or by putting something real
on the desk. The tagline changed with it: *you are the gravity.*

**Verified.** `npm test`: all 30 empty skies in the window have zero straight solutions and six or more
with gravity at the stored spot. Live: two straight shots fail, the hint appears, planted gravity clears
the level and does not cost the gold light.

## 28. Hand gravity needed two hands and fast timing

**Problem.** Gravity from a hand existed only while that hand pinched during a flight. A flight to the
first obstacle lasts about a third of a second, so the launching hand could not get there in time: in
practice it needed two hands tracked at once, and it could not be aimed with, because the preview never
showed it.

**What we did.** Gravity is now *planted*. A pinch over the board leaves a well that stays after the hand
lets go. It can be moved (even mid-flight) and is removed by dragging it off the board. The aiming preview
includes it, so the line visibly bends as the well moves. A pinch right at the launch pad is left to the
comet grab, and a hand holding the comet or the rim puck never plants.

**Verified.** Emulated XR pinch: planted, dragged 5 cm, released; `gm` stayed 0.006 at the release point.

## 29. No human had ever played it

**Problem.** Slow-motion strength, well strength and ghost pacing were guesses. The team has no headset.

**What we did.** Made the browser version playable. In a non-immersive page the same rules are driven by
board-space pointers: the mouse (drag the comet, click to plant gravity) or, with `?camera=1`, real hands
tracked from the webcam by MediaPipe. `?tune=1` adds sliders for the feel constants, persisted and
copyable, and ignored unless that flag is present.

**Verified.** A real mouse drag through the canvas cleared level 1 in one shot. The webcam path shares
that game-side code and its downloads resolve.
**Unproven.** The webcam tracking loop itself has not been run by us; the build machine has no camera.

## 30. Depth noise invented desk objects

**Problem.** Meta documents the Depth API as low resolution, unreliable under 20 cm, and weak on dark or
reflective surfaces. Our desk-object thresholds had only ever met the emulator's clean geometry.

**What we did.** Added a noise-injection test: 1.2 cm Gaussian jitter on every probe plus 3% outliers of
5 cm, on an empty desk and on a desk with a mug. The original rules invented an object in **68%** of empty
scans. Requiring two adjacent tall probes (and estimating the surface as a mean, not a low percentile)
cut that to 11%. Requiring two consecutive scans to agree on the position cut it to **0 in 300**, with
the mug still found in 299 of 300.

**Trade-off.** An object must now be at least about 5 cm wide, and appears one scan later.

## 31. Is the scene within Quest's budget?

**Problem.** Frame rate cannot be measured, but geometry and draw-call load can be counted.

**What we did.** Exposed the renderer's counters and measured each daily level: 22 to 28 draw calls and
22,000 to 32,000 triangles per view. Meta's guidance for Quest 3 is under 200 draw calls and under
1.5 million triangles.

**Unproven.** Fragment cost (noise shaders, occlusion taps) is not in those counters. The governor in
[#24](#24-no-way-to-measure-frame-rate) remains the safeguard for that.

## 32. Three numbers we could not measure

**Problem.** Frame rate, real hand steadiness and real depth noise all need a headset. We looked for a way
around that. Meta's guidance is plain: frame timing has to come from an immersive session on the device
(OVR Metrics Tool, or tracing through `chrome://inspect`). A desktop tab renders at the monitor's rate and
says nothing about a Quest.

**What we did.** Since we cannot bring a headset to the build, the build carries the instrument to the
headset. `src/perf.ts` records every frame of an immersive session, the cost of our own update, the
governor's state, the player's hand wobble and release jump, and the depth noise the desk scan sees. On
leaving the session it saves a report and prints one line on the page. One screenshot from any tester,
or from a judge's own session, is a measurement. `?perf=1` shows live frame rate in the HUD.

For today, Chrome's CPU throttle gave a bound on script cost: 0.10 ms per update, 0.41 ms at 6x slowdown,
against a 13.9 ms frame at 72 Hz. The one spike is level generation (43 ms at 6x), which lands between
levels.

**Verified.** Emulator session produced and displayed the report line. **Unproven:** every number in it
until a real device runs it. GPU fill cost in particular is still unmeasured.

## 33. Our hand-error figure was optimistic

**Problem.** The simulated playtest assumed 5 mm of hand error. Published measurements are larger: about
1.1 cm average fingertip error on Quest 2 and 1.73 cm on Quest 3, with knuckles steadier than fingertips.

**What we found.** Those are absolute errors against a motion-capture ground truth. In this game the
player aims by looking at the rendered comet, so a constant offset between real and tracked hand does not
matter; wobble and the release jump do, and neither study reports those separately. So we re-ran the
playtest with the full published error treated as random, which overstates it. Level 1 stayed a one- or
two-shot win and level 3 about four shots.

**What we changed.** A planted well follows the fingertip, the noisiest point, so it now trails it with a
short lag. The comet already moves with the grab pose and launches from an 80 ms smoothed pull. And the
recorder in #32 measures real wobble and release jump whenever a device runs the game.

## 34. Depth noise was a guess

**Problem.** We searched for a published accuracy figure for the Quest 3 Depth API and found none, only
Meta's qualitative limits. The 3.5 cm object threshold rested on an assumed 1.2 cm of noise.

**What we did.** The desk scan already samples 85 points of a surface that should be flat. The spread of
those heights around the fitted surface *is* the depth noise, measured in the player's room on the
player's device. The threshold is now three times that, never below 3.5 cm and never above 8 cm.

**Verified.** With simulated 2 cm noise the estimate read 19 mm, phantoms per scan fell from 106 in 300
(fixed threshold) to 1 in 300, and to 0 with two-scan agreement. The measured noise goes into the report.

## 35. The only real device was a phone

**Problem.** Every mixed-reality feature had run only against the emulator's synthetic room. The one real
AR device available was an Android phone, and on it the game opened in AR and could not be played: phones
have no hand tracking, and all in-session input was hand pinches.

**What we did.** In an AR session a finger on the screen arrives as a transient WebXR input source whose
ray leaves the camera through the touch point. `OrrerySystem` listens for those (`targetRayMode ===
'screen'`), meets each ray with the play plane, and passes the board point to the same pointer handler the
mouse uses: on the comet it draws it back, elsewhere it plants gravity. The catch radius is wider for a
fingertip, and the wording changes from "pinch" to "drag" and "tap".

Two things changed for phones' benefit and help headsets too. The desk scan now retries every two seconds
while it finds no flat surface, because a phone maps a desk only after the camera has moved. And the flat
page pulls its camera back in portrait so the board fits, and stops the page scrolling under a dragging
finger.

**Verified.** In the emulator's XR session, synthetic screen rays hit the right board point (within
2 mm), dragged and launched the comet, cleared level 1 and planted gravity with a tap.
**Unproven.** The touch events themselves, surface mapping, depth availability and appearance on a real
phone. The first phone session is the test.

---

## Open risks

Only a headset can close these.

| Risk | Why it is open | Escape hatch |
|---|---|---|
| Frame rate under 60 fps | Never profiled on device; the app now reports it after any session (#32). The governor (#24) sheds occlusion cost automatically, but the noise shaders and the grid are fixed costs | `?occlusion=hard` (1 tap) or `?occlusion=0` |
| Slow motion feels sluggish | Tuned without playing it | `timeScale` floor (0.3) in `OrrerySystem.update` |
| Depth noise creates phantom objects | Emulator depth is clean | Thresholds in `src/sim.ts`; `?desk=0` |
| Too many hit-test sources | Browser limit unknown | `BATCH` in `src/desk.ts` |
| Pinch feel and planted-gravity strength | Now playable with mouse or webcam, still not on device | `?tune=1` sliders; `HAND_GM`, grab radius |
| Planting gravity by accident | Any pinch over the board plants | 5 cm exclusion at the pad; drag off the board to remove |
| Empty-sky level too hard | Hardest level for the simulated player | Hint ring after 2 misses; real objects also work |
| Occlusion edges around fingers | Depth map is about 320 px per eye | `?occlusion=0` |
| Particle size | One hand-tuned constant | `900.0` in the particle shader |
