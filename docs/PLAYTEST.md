# Playtesting without a headset

Nobody on the project has a headset, so feel was tested three other ways. Each answers a different
question, and none of them replaces a person wearing one.

| Method | Answers | Cannot answer |
|---|---|---|
| [Simulated playtest](#1-simulated-playtest) | How many shots does an imprecise person need? Is the answer forgiving? | Whether it is fun |
| [Desktop play, mouse or webcam hands](#2-play-it-yourself) | How do the pull, slow motion, planted gravity and ghost feel? | Depth, presence, comfort, real tracking |
| [Emulated XR hands](#3-emulated-xr-hands) | Does the real input path work end to end? | Anything about feel |

## 1. Simulated playtest

```bash
npm run playtest            # 5 mm hand error
SIGMA=0.008 npm run playtest
```

`test/playtest.mjs` models a person, not a solver:

- **Imprecise hands.** Every release lands with Gaussian error, 5 mm per axis by default (tracking jitter
  plus the twitch of letting go).
- **No orbital maths.** The first shot is straight at the ring at 60% draw.
- **Learns from the trail.** Each try varies the best shot so far, judged by how close its trail came to
  the ring. Variations start 2.5 cm wide and narrow 15% whenever a try does not improve.
- **Uses the preview.** Before letting go they sweep six candidate pulls and keep the one whose dotted
  line looks best, with the same preview length the game shows.
- **Empty sky.** They plant gravity near the hint, 1.5 cm off.

It plays 20 days of levels, 40 players each, giving up after 15 shots, and separately asks how often the
solver's own answer still hits when released by that hand.

### What it found

The first run was a shock. The levels passed every correctness test and were close to unplayable:

| Level | Median shots | 90th percentile | Gave up | Known answer survives a 5 mm hand |
|---|---|---|---|---|
| 1 easy | 5 | 15 | 10% | 32% |
| 2 (then a two-body sky) | more than 15 | more than 15 | 60% | 29% |
| 3 hard | 14 | more than 15 | 46% | 28% |

Even a player who knew the answer exactly would land it less than a third of the time. The cause was
sensitivity, not level layout: a full draw was only 10 cm, so 5 mm of hand error was 5% of the whole range.

### What changed

| Change | Why |
|---|---|
| Full draw 10 cm to 16 cm, same top speed (`POWER` 5 to 3.2) | Each millimetre of error moves the launch less |
| Ring radius 2.2 cm to 3 cm | Wider target |
| Solver returns the *most forgiving* answer; levels must have one whose neighbouring launches also hit | A level needs an answer that survives being slightly wrong |
| Release point smoothed over 80 ms | The twitch of opening the fingers no longer aims the shot (not modelled by the bot; it assumes 5 mm regardless) |
| Long aiming preview on empty-sky levels | Watching the line bend as gravity moves is the lesson |
| Hint ring after 2 misses (empty sky); ghost of one winning path after 5 misses (other levels) | Nobody should be stuck |

### After

| Level | Median shots | 90th percentile | Gave up | Known answer survives 5 mm | …8 mm |
|---|---|---|---|---|---|
| 1 easy | 1 | 3 | 0% | 96% | 83% |
| 2 empty sky | 5 | more than 15 | 23% | 80% | 71% |
| 3 hard | 3 | 7 | 3% | 71% | 58% |

Level 1 is now a first-try win for a typical player, which is what a first minute should be. Level 3 takes
a few tries. The empty sky is still the hardest: the modelled player plants gravity once and never moves
it, and does not get the hint ring or the option of using a real object, so the 23% is pessimistic, but it
is the level to watch.

### Limits of the model

The 5 mm figure is an assumption, not a measurement of Quest hand tracking. The learner is cruder than a
person in some ways (no understanding of gravity) and better in others (never bored, never tired). Treat
the numbers as comparisons between versions, not as predictions.

## 2. Play it yourself

Open the site in a desktop browser. No headset or install is needed.

- **Mouse.** Drag the comet back and let go. Click anywhere else on the board to plant gravity; drag it to
  move it; drag it off the board to remove it.
- **Webcam hands** (`?camera=1`). Hold a hand up to the camera and pinch thumb to index. One hand pulls the
  comet, either hand plants gravity. Hand tracking runs in the page with MediaPipe; video is not uploaded.
- **Tuning** (`?tune=1`, combinable: `?camera=1&tune=1`). Sliders change the feel live:

| Slider | Meaning | Ships at |
|---|---|---|
| `slowFloor` | Slowest playback on a close pass (1 = none) | 0.3 |
| `slowReach` | How far out slow motion starts | 1 |
| `wellGm` | Pull of planted gravity | 0.006 |
| `ghostLoop` | Seconds per loop of the onboarding ghost | 3.4 |
| `releaseSmooth` | Seconds of smoothing on the release point | 0.08 |

Values persist between visits and **Copy values** puts them on the clipboard as JSON. They apply only while
`?tune=1` is in the address, so a tuning session never changes normal play.

What the webcam mode is not: it maps the flat camera image onto the board, so there is no depth, and
MediaPipe's jitter is not Quest's. It is for judging pacing and strength, with real hands that shake.

**Verification status.** The mouse path is tested by automation with a real pointer drag. The webcam path
shares all game-side code with the mouse, and its three downloads were checked to resolve, but the tracking
loop itself has not been run by us: there is no camera on the build machine.

## 3. Emulated XR hands

The IWSDK emulator drives a synthetic hand through the real WebXR input path:

```bash
npx @iwsdk/cli dev up --allow-browser-automation
npx @iwsdk/cli xr enter && npx @iwsdk/cli xr set-input-mode --input-json '{"mode":"hand"}'
npx @iwsdk/cli xr run-sequence --input-json '{"device":"hand-left","steps":[
  {"position":{"x":-0.1,"y":1.24,"z":-0.5},"anchor":"index-tip","pinch":{"value":1,"at":"arrival"}},
  {"position":{"x":-0.06,"y":1.24,"z":-0.46},"anchor":"index-tip","duration":0.5},
  {"pinch":0,"duration":0.15}]}'
```

That sequence plants gravity with a pinch, drags it 5 cm, and lets go; the well stays where it was left.
The scripts under `test/live.*.mjs` cover the rest: `live.hook` (rules), `live.desktop` (pointer play and
the empty-sky hint), `live.mouse` (real mouse), `live.cinema` (slow motion), `live.desk` and `live.place`
(desk scan), `live.render` (draw calls).
