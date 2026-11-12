# Perihelion

**A daily gravity puzzle that lives on your desk.** Pinch the comet, pull back, let go — and bend its path
around a star and its planets into the ring.

- **Play:** https://perihelion-three.vercel.app (open in the Meta Quest browser, tap *Play on your desk*)
- **Built for:** Meta VR Start Developer Competition 2026 — Gaming track, New Experience
- **Built with:** [Immersive Web SDK](https://developers.meta.com/horizon/documentation/iwsdk/guides/overview/) 1.1 (WebXR, Three.js, ECS), TypeScript, Vite

| Aiming | In flight | A real cup with gravity |
|---|---|---|
| ![Aiming](docs/screens/aim-emulator.png) | ![In flight](docs/screens/flight-emulator.png) | ![Desk object](docs/screens/desk-object-emulator.png) |

<sub>All frames are from the IWSDK browser emulator (Quest 3 profile, emulated hands, synthetic living room).
They are not headset captures.</sub>

## Contents

- [How it plays](#how-it-plays)
- [Architecture](#architecture)
- [Workflows](#workflows)
- [Technical notes](#technical-notes)
- [Visual effects](#visual-effects)
- [Run, test, deploy](#run-test-deploy)
- [Competition requirements](#competition-requirements)
- [Limitations](#limitations)
- [Engineering log](docs/ENGINEERING.md): every problem we hit and how it was solved
- [Build log](#build-log)

## How it plays

- **Hands only.** One verb: pinch, pull, release. No controller, no menus, no buttons inside XR.
- **Seated.** The board is 54 cm across and is placed 45 cm in front of you. Everything is within reach.
- **On your real desk.** In passthrough the board drops onto the nearest horizontal surface at desk height.
  Pinch the amber puck on the rim to drag the board somewhere else.
- **Readable physics.** The grid under the planets sinks where gravity is strong. A dotted line shows the
  start of your shot: long on the first level, short afterwards.
- **Your other hand has gravity.** While the comet is flying, pinch the air over the board: that hand becomes
  a gravity well you can move, and the grid sinks under it. Every level can be solved without it, so
  one-handed play always works; a day cleared with no hand gravity earns a gold light.
- **Your desk joins the sky.** The game looks straight down at the desk under the board with depth-based
  hit tests. A mug, a stack of books, anything standing more than 3 cm tall becomes a body with gravity and
  a ring at its base. Move the mug and the puzzle changes.
- **Real things hide virtual things.** With depth sensing, your hands and desk objects occlude the board.
- **Shown, not told.** Before your first shot a ghost performs one winning pull and release on a loop.
- **Three puzzles a day.** The same three skies for everyone, easy to hard. Finish them to grow your streak;
  miss a day and it resets. Each day of the streak adds a light to the far rim (gold for a clean day, blue
  otherwise, up to 30). Encore levels follow.

## Architecture

```mermaid
flowchart LR
    subgraph Browser["Meta Quest browser (WebXR)"]
        direction TB
        IDX["src/index.ts<br/>World.create + system registration"]
        subgraph Systems["IWSDK systems"]
            ORR["OrrerySystem<br/>src/orrery.ts<br/>state machine, board, HUD, placement"]
            PAN["PanelSystem<br/>src/panel.ts<br/>welcome card, Enter XR"]
        end
        subgraph Pure["Pure modules (no Three.js, no DOM)"]
            SIM["src/sim.ts<br/>gravity step, level generator,<br/>solver, streak rules"]
        end
        subgraph Presentation
            VFX["src/vfx.ts<br/>planet, star, grid shaders,<br/>particle pool"]
            SFX["src/sfx.ts<br/>Web Audio oscillators"]
        end
        DESK["src/desk.ts<br/>DeskScanner: batched<br/>downward hit tests"]
        LS[("localStorage<br/>perihelion.v1")]
    end

    subgraph IWSDK["IWSDK runtime"]
        GRAB["GrabSystem<br/>OneHandGrabbable, Grabbed"]
        SU["SceneUnderstandingSystem<br/>XRPlane entities"]
        VIS["world.visibilityState"]
        HEAD["player.head"]
        DEPTH["DepthSensingSystem<br/>DepthOccludable"]
    end

    subgraph WebXR["WebXR session"]
        HT["hit-test<br/>(live depth on Quest 3/3S)"]
        DS["depth-sensing<br/>(optional)"]
    end

    IDX --> ORR & PAN
    ORR -->|"launch, step, levelFor, clearLevel"| SIM
    ORR --> VFX & SFX
    ORR <-->|"save and load"| LS
    GRAB -->|"Grabbed qualify and disqualify"| ORR
    SU -->|"horizontal planes"| ORR
    VIS -->|"enter XR, pause on blur"| ORR
    HEAD -->|"seat position and facing"| ORR
    VIS --> PAN
    ORR --> DESK
    DESK -->|"requestHitTestSource"| HT
    DESK -->|"probe heights"| SIM
    DS --> DEPTH
    DEPTH -->|"occlusion uniforms"| VFX
```

| File | Responsibility |
|---|---|
| `src/sim.ts` | Fixed-step gravity integration, seeded level generator, brute-force solver, day and streak rules, desk-surface and object clustering. Runs unchanged in Node. |
| `src/orrery.ts` | The one gameplay system. Owns the board, the phase state machine, HUD canvas, desk placement and the debug hook. |
| `src/vfx.ts` | Shader materials (planet, atmosphere shell, star, gravity grid) and a fixed-size particle pool. |
| `src/desk.ts` | `DeskScanner`: 85 downward WebXR hit tests in batches of 10, returning real heights under the board. |
| `src/sfx.ts` | Every sound is one or two oscillators with an envelope. There are no audio files. |
| `src/panel.ts` | Browser welcome card (UIKitML). Hidden while immersive. |
| `src/game-components.ts` | Two tag components: `Comet`, `BoardHandle`. |
| `public/scenes/main.iwsdk.scene.json` | Only the welcome panel. The board is built in code because every level is generated. |
| `test/sim.check.mjs` | Offline self-check of the sim. |
| `test/live.*.mjs` | Scripts that drive the running app in the managed emulator. |

## Workflows

### One shot (runtime sequence)

```mermaid
sequenceDiagram
    actor P as Player hand
    participant G as GrabSystem
    participant O as OrrerySystem
    participant S as sim.ts
    participant V as vfx / sfx

    P->>G: pinch on comet
    G->>O: Grabbed qualifies (Comet)
    O->>V: grab tone
    loop every frame while held
        O->>S: launch(pull) then step() x N
        S-->>O: preview points
        O->>V: band, dotted preview, tension tick
    end
    P->>G: release
    G->>O: Grabbed disqualifies
    O->>S: launch(level, pull)
    loop fixed 120 Hz steps
        O->>S: step(level, shot)
        S-->>O: flying / hit / crash / lost
        O->>V: trail, dust and ion tail
        opt other hand pinching over the board
            O->>S: hand added as a body (r = 0, 2 cm softening)
            O->>V: violet orb, grid sinks under the hand
        end
    end
    alt hit
        O->>S: clearLevel(save)
        O->>V: gold burst, grid ripple, chime
        O->>O: next level after 2.2 s
    else crash or lost
        O->>V: impact burst, tone
        O->>O: comet back on the pad after 0.6 s
    end
```

### Game phases

```mermaid
stateDiagram-v2
    [*] --> aim: level loaded
    aim --> drag: pinch comet
    drag --> aim: released under 1.5 cm (a tap)
    drag --> fly: released
    fly --> won: enters ring
    fly --> miss: hits a body, leaves the board, or 6 s pass
    miss --> aim: 0.6 s
    won --> aim: 2.2 s, next level
```

A pinch on the comet while it is in flight is released on the next frame (`GrabSystem.forceRelease`), so the
shot cannot be interrupted.

### Level generation

```mermaid
flowchart TD
    A["day number + level index"] --> B["seed = day * 100 + index"]
    B --> C["candidate layout from mulberry32(seed, attempt)<br/>target, 1 to 3 bodies"]
    C --> D{"bodies clear of launcher,<br/>target and each other?"}
    D -- no --> C
    D -- yes --> E{"difficulty > 0:<br/>straight line blocked?"}
    E -- no --> C
    E -- yes --> F["solve: fly 96 angles x 10 powers<br/>with the game's own step()"]
    F --> G{"hit count inside the<br/>difficulty window?"}
    G -- no --> C
    G -- yes --> H["accept level"]
    C -. "60 attempts exhausted" .-> I["first solvable candidate,<br/>else an open board"]
```

### Desk scan

```mermaid
flowchart TD
    T["trigger: board placed, board moved,<br/>level loaded, or unsolvable desk (every 3 s)"] --> B["next batch of 10 probe points<br/>(85 on a 4.5 cm hex grid)"]
    B --> R["requestHitTestSource<br/>ray straight down from 40 cm above the board"]
    R --> F["read 4 frames of results per probe<br/>(30-frame timeout), then cancel the source"]
    F --> H{"probe within 12 cm<br/>of a hand?"}
    H -- yes --> X["discard"]
    H -- no --> S["keep height in board space"]
    X & S --> M{"more points?"}
    M -- yes --> B
    M -- no --> W["wait for the aim phase"]
    W --> SF["deskSurface: flat level among probes<br/>within 35 cm of the board"]
    SF -- none --> K["keep generated level only"]
    SF -- found --> Y["correct board height"]
    Y --> C["clusterDesk: probes over 3 cm tall<br/>grouped into up to 3 bodies"]
    C --> V{"solve(level + desk)<br/>has a hit?"}
    V -- yes --> OK["rings on the grid, grid sinks,<br/>HUD announces the object"]
    V -- no --> MV["HUD: move something<br/>rescan in 3 s"]
```

### Development and release

```mermaid
flowchart LR
    A["feature branch<br/>feat/..."] --> B["npm test<br/>sim self-check"]
    B --> C["npm run typecheck"]
    C --> D["iwsdk dev up<br/>managed emulator"]
    D --> E["test/live.hook.mjs<br/>miss, 3 wins, streak"]
    E --> F["xr run-sequence<br/>emulated hand pinch"]
    F --> G["npm run build"]
    G --> H["conventional commit<br/>+ pull request"]
    H --> I["vercel deploy --prod"]
    I --> J["headset check<br/>(not done yet)"]
```

## Technical notes

### Simulation

- Board space is meters on the XZ plane, +z toward the player. The comet moves in that plane.
- Acceleration is the sum over bodies of `gm * d / (|d|^2 + 1e-5)^(3/2)` (softened Newtonian gravity),
  integrated with semi-implicit Euler at a fixed `DT = 1/120 s`.
- Launch speed is `5 m/s` per meter of pull, pull clamped to 10 cm, so the fastest shot is 0.5 m/s and a
  board crossing takes about a second.
- A shot ends on `hit` (inside the 2.2 cm ring), `crash` (inside a body), or `lost` (8 cm past the rim, or 6 s).
- The runtime accumulates frame time and advances in whole `DT` steps, capped at 0.1 s per frame. The solver
  uses the same `step()`, so any launch the solver found replays exactly in the game at any frame rate.

### Levels and difficulty

| Daily level | Bodies | Straight shot | Solver hits allowed (of 960) |
|---|---|---|---|
| 1 | 1 (a star) | may work | 25 or more |
| 2 | 2 | blocked | 6 to 70 |
| 3 and encore | 3 | blocked | 3 to 45 |

The heaviest body in a level is drawn as the star; the others are planets lit from it.

### Day and streak

- The day number is the local calendar date, so a new set appears at local midnight.
- `openDay` resets progress on a new day and zeroes the streak if a day was skipped.
- `clearLevel` adds one to the streak the first time the third level is cleared that day.
- Save shape (`localStorage["perihelion.v1"]`): `{ lastDay, streak, day, index, shots, todayShots, nudged, log }`.
  `log` holds one entry per day of the current streak (1 = cleared, 2 = cleared without hand gravity).
  If storage is blocked the game still runs, without persistence.

### Hand interaction

- The comet and the rim puck are `OneHandGrabbable` entities. IWSDK maps a hand pinch to that grab by
  default, and a controller squeeze works too, so no controller is required and none is excluded.
- The comet's grab volume (2.8 cm radius) is larger than its visible core, so a loose pinch still catches it.
- The pull vector is read in board space, so it stays correct after the board is moved or turned.

### Hand gravity

- During the `fly` phase, a hand whose pinch is held (`gamepads[side].getSelecting()`) within 10 cm of the
  board edge and 25 cm of the play plane is projected into board space from its index tip.
- It joins the flight as an extra body with `gm = 0.006` (a mid-sized planet), no crash radius, and a 2 cm
  softening so a comet passing through the fingers is not flung away.
- The level generator never sees the hand. Levels are accepted on their generated bodies alone, so the hand is an aid, not a
  requirement. Using it sets `nudged` for the day, which decides the colour of that day's rim light.

### Onboarding ghost

On the first level, until the first shot of the day, the system takes one launch from the solver, records
its path, and loops a 3.4 s demo: a cue closes on the comet like a pinch, a ghost comet is pulled back along
that launch with the band drawn, then the ghost flies the recorded path into the ring. Grabbing the comet
hides it.

### Real desk objects

- On Quest 3 and 3S (Horizon Browser 40.4+) WebXR hit tests are answered from the live depth map rather
  than the saved room mesh. A ray cast straight down therefore lands on whatever is really there now.
- `DeskScanner` never holds more than 10 hit-test sources open and finishes a scan in about a second.
- `deskSurface` and `clusterDesk` are pure and covered by `npm test`, including a board that overhangs the
  desk edge and a single noisy probe.
- A found body has `r` from its footprint (at most 7 cm), `gm` from its probe count (0.0055 to 0.012), and
  `real: true`. It is not drawn; it gets a ring. The aiming preview, the ghost and the solver all use the
  generated level plus the desk; the hand is added only for the live flight.
- If the session refuses a hit-test source, the scanner marks itself unsupported and the game continues
  with generated bodies only. `?desk=0` turns the scan off.

### Depth occlusion

- `depth-sensing` is requested as an optional feature (`gpu-optimized`, `float32`) and IWSDK's
  `DepthSensingSystem` is registered. The board root and the rim puck carry `DepthOccludable`.
- Custom shaders are made compatible in `src/vfx.ts` (`occlude()`); the reasons are in the
  [engineering log](docs/ENGINEERING.md#13-occlusion-ignored-our-shaders).
- `?occlusion=hard` switches to single-tap occlusion; `?occlusion=0` turns it off.

### Desk placement

1. About 0.6 s after the session becomes visible, the board is placed 45 cm ahead of the head along its
   flattened forward direction, 45 cm below eye height, turned to face the player.
2. Among detected `XRPlane` entities, horizontal planes 20 to 90 cm below the head and within 70 cm of the
   board are candidates; the board drops onto the nearest. Planes that arrive in the next 8 s are also used.
3. The desk scan then measures the real surface under the board from live depth and corrects the height.
4. Dragging the rim puck moves the board, ends plane snapping, and triggers a new scan.

The plane test uses each plane's center, not its outline. A very large desk whose center is far away is
missed; the rim puck covers that case.

### Pause and resume

While `visibilityState` is `VisibleBlurred` (system menu open) the system skips its update, so a shot in
flight freezes and continues afterwards.

### Debug hook

`window.__perihelion` exposes `state()`, `shoot(px, pz)`, `solve()`, `desk()`, `place()`, `scan()`, `lastScan()` and `feed(samples)`. The live test scripts use it. It
does not change game rules.

## Visual effects

Nothing is loaded from disk: every surface is a shader or a canvas texture.

| Effect | Technique |
|---|---|
| Planets | Four-octave value noise sampled on the undeformed sphere direction; gas giants add warped latitude bands, rocky worlds get land masks and pale poles. A soft terminator is lit from the level's star. |
| Atmosphere | A fresnel rim on the surface plus a second, 20% larger back-face sphere with additive blending, brightest at the limb and on the day side. |
| Star | Two animated noise fields for granulation and flares, with limb darkening. The corona is a billboard sprite. |
| Gravity grid | An 88 x 88 plane whose vertices sink by the same `gm / r` potential the sim integrates. Grid lines are anti-aliased with `fwidth`. A hit sends one ripple out from the ring. |
| Comet | Two tails, as on a real comet: dust lags along the path, ions blow straight away from the star and strengthen near it. |
| Bursts | Launch sparks, crash debris and the win burst all come from one pool of 384 points that never allocates. |

Choices made for Quest hardware:

- **No post-processing.** Meta's guidance is that true bloom is too expensive on mobile VR and that
  billboarded blob sprites get close, so every glow here is an additive sprite.
- **Little transparent overdraw.** Particles are small points; the grid is the only large transparent surface.
- **Passthrough-safe additive blending.** Additive shaders write their intensity to alpha. Writing alpha 1
  made the compositor treat each particle as an opaque black square over the real room.

References studied: Meta's [WebXR performance best practices](https://developers.meta.com/horizon/documentation/web/webxr-perf-bp/)
and [PC rendering techniques to avoid on mobile VR](https://developers.meta.com/horizon/blog/pc-rendering-techniques-to-avoid-when-developing-for-mobile-vr/),
and community write-ups of the fresnel-rim-plus-back-face-shell atmosphere.

## Run, test, deploy

Needs Node 22.18+ (or 24).

```bash
npm install
npm run dev          # managed browser with the XR emulator
npm test             # sim self-check
npm run typecheck
npm run build        # static site in dist/
```

**Offline check (`npm test`).** Generates 120 levels (30 days x 4), asserts each is deterministic and
solvable and that the solver's answer replays as a hit, then walks the streak rules through a finished day,
the next day and a skipped day.

**Live checks.** Start the dev server with automation enabled, then run a script:

```bash
npx @iwsdk/cli dev up --allow-browser-automation
npx @iwsdk/cli browser run test/live.hook.mjs    # miss, three wins, streak, persistence
npx @iwsdk/cli browser run test/live.nudge.mjs   # with an emulated hand pinching over the board: hand gravity is live
```

The real input path is exercised with an emulated hand:

```bash
npx @iwsdk/cli xr enter --input-json '{}'
npx @iwsdk/cli xr set-input-mode --input-json '{"mode":"hand"}'
npx @iwsdk/cli xr run-sequence --input-json '{"device":"hand-right","steps":[
  {"position":{"x":0,"y":1.21,"z":-0.26},"pinch":{"value":1,"at":"arrival"}},
  {"position":{"x":0.01,"y":1.21,"z":-0.185},"duration":0.8},
  {"pinch":0,"duration":0.15}]}'
```

**Deploy.** The build is a static site with relative asset paths.

```bash
vercel deploy --prod
```

To test on a headset during development, open the dev server's HTTPS URL in the Quest browser.

## Competition requirements

| Requirement or guideline | How Perihelion meets it |
|---|---|
| Hands-first, end to end | The browser card is tapped with a hand pinch like any web page; inside XR, pinch to play and pinch to move the board. No controller is ever needed. |
| Seated, two-foot radius | 54 cm board placed 45 cm ahead; the pull is at most 10 cm. |
| A complete moment in under ten minutes | Three daily levels; each shot resolves in at most 6 s. |
| Original, not a wrapper | No third-party service. No network calls after the page loads. |
| Purposeful passthrough | The board sits on the real desk at its measured height; real objects on it and the player's own hand are bodies in the simulation; real things occlude virtual ones. Turn passthrough off and the puzzle is a different puzzle. |
| Holds up in untested rooms | Height comes from live depth, not only stored planes; no room setup is needed for the scan; every real-world feature degrades to off if its session feature is missing. |
| Accessible by default | Every level is solvable with one hand and one gesture; the second hand is optional. |
| Reason to come back | New seeded set each local day, streak, shots-to-finish for the day, a rim of lights that grows per day and rewards clean clears. |

## Limitations

- **Not yet tested on a physical headset.** Pinch feel, plane snapping on a real desk and frame rate on
  Quest hardware are unverified. In the emulator, seated at its coffee table, plane snapping and the
  depth correction both ran (0.424 m, then 0.440 m).
- Frame rate has not been profiled. The 60 fps minimum is a target, not a measurement.
- The streak is stored per browser. Clearing site data resets it; there is no account or leaderboard.
- The particle size constant is hand-tuned in the emulator and may need retuning on device.
- Hand gravity is verified with an emulated pinch only; how it feels with real tracking jitter is unknown.
- Depth occlusion and the desk scan are verified against the emulator's clean depth and geometry only.
  Real depth is noisier; thresholds and batch sizes are educated guesses. Escape hatches: `?desk=0`,
  `?occlusion=0`, `?occlusion=hard`.
- Desk objects are approximated as circles and capped at three.
- No voice alternative or high-contrast mode yet.

## Build log

**Nov 12, 2026**
- IWSDK AR starter scaffolded; starter demo content removed.
- `sim.ts`: gravity step, seeded generator, solver, streak rules, with the offline check.
- `orrery.ts`: board, pinch slingshot, preview, trail, HUD, desk placement, rim puck, save.
- Live verification in the emulator: hook scenario and emulated hand pinch.
- `vfx.ts`: shader planets, star, gravity grid, comet tails, bursts; passthrough alpha fix.
- Deployed to Vercel.
- Hand gravity, onboarding ghost and streak lights.
- Depth occlusion for all materials including custom shaders.
- Desk scan: real objects become gravity bodies; board height corrected from live depth.
- Engineering log written.
