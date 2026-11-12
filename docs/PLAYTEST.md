# Playtesting without a headset

Nobody on the project has a headset, so feel was tested three other ways. Each answers a different
question, and none of them replaces a person wearing one.

| Method | Answers | Cannot answer |
|---|---|---|
| [Simulated playtest](#1-simulated-playtest) | How many shots does an imprecise person need? Is the answer forgiving? | Whether it is fun |
| [Desktop play, mouse or webcam hands](#2-play-it-yourself) | How do the pull, slow motion, planted gravity and ghost feel? | Depth, presence, comfort, real tracking |
| [Emulated XR hands](#3-emulated-xr-hands) | Does the real input path work end to end? | Anything about feel |
| [Phone AR](#5-phone-ar-on-android) | Does the board land on a real desk? Does the scan cope with a real camera? Real frame rate on a real device | Hand tracking, stereo, Quest's own depth sensor |
| [Self-measurement](#4-self-measurement-on-any-headset) | Frame rate, hand steadiness and depth noise on a real device | Nothing, until someone with a headset opens the link |

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

### Against published hand-tracking error

Two studies measured Quest hand tracking against a ground truth: about 1.1 cm average fingertip error on
Quest 2 (Abdlkarim et al., *Behavior Research Methods*, 2023) and 1.73 cm on Quest 3 in best conditions
(robotic characterisation, IEEE, 2025), with the knuckle steadier than the fingertip. Those are *absolute*
errors: how far the tracked finger is from the real one. The player aims by watching the rendered comet,
so a constant offset cancels out; what hurts is wobble and the jump on release. Treating the whole
published error as random per-shot error is therefore the pessimistic case:

| Hand error | Level 1 median / answer survives | Level 2 empty sky | Level 3 hard |
|---|---|---|---|
| 5 mm (our working figure) | 1 shot / 96% | 5 / 80% | 3 / 71% |
| 11 mm (Quest 2 absolute error) | 1 / 68% | 6 / 62% | 4 / 48% |
| 17.3 mm (Quest 3 absolute error) | 2 / 54% | 7 / 47% | 4 / 35% |

Even in the pessimistic case level 1 is a one- or two-shot win and level 3 takes about four. Because the
studies found fingertips noisier than knuckles, a planted well now follows the fingertip with a short lag
instead of raw.

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

## 4. Self-measurement on any headset

Three things could not be measured without a device: frame rate, how steady a real tracked hand is, and how
noisy real depth is. So the app measures them itself during every immersive session (`src/perf.ts`):

| Measured | How |
|---|---|
| Average frame rate, slowest 1%, share of frames under 60 fps | Every frame's delta, up to the last 100 s |
| Display rate the session targets | `XRSession.frameRate`, where the browser reports it |
| Cost of the game's own update | `performance.now()` around the system update |
| How far the governor stepped occlusion down | Governor state |
| Hand wobble while holding a pull | RMS distance between the raw and smoothed hand while it moves under 5 cm/s |
| Jump at release | Raw-versus-smoothed distance at the instant of letting go, median over shots |
| Depth noise | Spread of desk-scan probe heights around the fitted surface |

When the session ends, the report is saved in that browser and printed at the top-left of the page:

```
Last session (Quest 3, 94 s): 71.8 fps avg, 1% low 61.2, 0.4% of frames under 60, target 72;
update 0.4 ms; soft occlusion; hand jitter 2.1 mm, release twitch 3.4 mm over 9 shots; depth noise 8.2 mm
```

(Example format; those numbers are illustrative, not a measurement.) Nothing is transmitted. **Anyone with
a Quest can measure the game for us:** open the link, play two minutes, leave the session, and screenshot
the page. Adding `?perf=1` also shows live frame rate on the in-game HUD.

Meta's own tooling gives a second opinion on device: the OVR Metrics Tool overlay for frame rate, and
`chrome://inspect` tracing from a connected computer.

### What we could measure today

In the emulator, with Chrome's CPU throttle (the GPU is not throttled, so this bounds script cost only):

| CPU slowdown | Game update, average | Worst single update |
|---|---|---|
| 1x | 0.10 ms | 9 ms |
| 4x | 0.28 ms | 29 ms |
| 6x | 0.41 ms | 43 ms |

At 72 Hz a frame has 13.9 ms. The steady-state update is a few percent of that even at 6x. The worst case
is a single frame when a new level is generated and solved; it happens between levels, during the win
animation. Frame *rate* in the headless emulator is not reported here: it reflects this machine's software
renderer, not a headset.

The depth scan also adapts to what it measures: the height an object must clear is three times the
measured noise (never less than 3.5 cm). In simulation with 2 cm noise, phantom objects per scan fell from
106 in 300 to 1 in 300, and to 0 with two-scan agreement.

## 5. Phone AR on Android

An Android phone with Google's AR services is a real mixed-reality device that most people already own.
Chrome on Android runs the same `immersive-ar` WebXR session as the headset, so the same build runs on it.

1. Open the link in **Chrome** on the phone and tap **Play on your desk**. Allow the camera.
2. Hold the phone about 40 cm above a desk, looking down. Move it slowly for a few seconds so the phone
   can map the surface. The board appears in front of the camera, then settles onto the desk once the
   surface is found (it keeps looking for about 40 seconds).
3. **Drag the comet** back on the screen and let go. **Tap the board** to plant gravity; drag it to move it.
4. Put a mug on the desk inside the board and wait a few seconds for the next scan.
5. Leave AR with the back gesture. The page then shows the self-measurement line for the session.

What differs from a headset: there is no hand tracking, so a finger on the screen stands in for a pinch.
The touch becomes a ray from the camera through the finger, met with the play plane, and is then handled by
the same code as a mouse pointer. Depth comes from the phone's camera, not Quest's sensors, and may not be
offered at all; without it, real objects are found only where the phone maps them as surfaces, and nothing
is occluded. If the picture misbehaves, add `?occlusion=0` to the address.

**Verification status.** In the emulator, rays cast the way a screen touch produces them land on the right
board point, drag and launch the comet, clear level 1, and plant gravity on a tap. The browser's touch
events, the phone's surface mapping, and everything about how it looks on a real phone have not been run
by us.

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

## Recording the demo video

The video is recorded from the same emulator session used for testing. `test/rec.mjs` saves Chrome's
screencast frames with their timestamps; `scripts/demo-lib.sh` holds the helpers that pose the emulated
headset and hand; `scripts/make-demo.py` cuts and captions the result.

| Shot | What is driven | What it shows |
|---|---|---|
| `a_level1` | Emulated hand pinches the comet, pulls to the solver's launch, releases | Ghost onboarding, the core gesture, a first-try win |
| `b_void` | Straight pull (crash), pinch at the helper spot, pull again | The empty sky, planting gravity, the bent preview, the win |
| `c_cup` | Board re-placed at the emulator table's cup, push-in, one pull | Board landing on the desk, the scan finding the cup, a shot through its gravity |
| `d_blackhole` | One pull on today's third level | Black hole, orbiting moon, slow motion, "Daily done", streak |
| `f_flat` | In-page pointer schedule (the mouse code path) on levels 1 and 2 | Play without a headset |

Two practical notes. `browser run` scripts cannot overlap, so anything the game must do while the recorder
runs is either a CLI `xr` command or scheduled inside the page beforehand (`test/live.place-later.mjs`,
`test/live.demo-flat.mjs`). And the emulator draws the room and the app on separate canvases at different
scales, so recording a canvas directly gives a wrong picture; the screencast is the compositor's output.
