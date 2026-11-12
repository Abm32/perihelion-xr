# The physics in Perihelion

What the game simulates, which parts are real physics, and which parts are stage craft. The split matters:
the path of the comet is honest; the look of a black hole is borrowed from film.

| Concept | In the game | Real or stylized |
|---|---|---|
| [Newtonian gravity](#newtonian-gravity) | Every body pulls the comet with `GM / r²` | Real, with softening |
| [Symplectic integration](#integration) | Semi-implicit Euler at a fixed 120 Hz | Real numerical method |
| [Kepler's laws](#keplers-laws) | Comet speeds up toward perihelion; moons orbit at `sqrt(GM / r³)` | Real (moon speed capped) |
| [Gravity assist](#gravity-assist) | Passing a moving moon changes the comet's speed | Real, emerges from the sim |
| [Perihelion](#perihelion) | Closest pass and top speed reported after each shot | Real measurement |
| [Rubber-sheet grid](#the-grid) | Grid sinks by the gravitational potential | Honest picture of the potential, not of curved spacetime |
| [Comet tails](#comet-tails) | Dust lags on the path, ions point away from the star | Real behaviour, simplified |
| [Black hole](#black-hole) | Horizon, sheared disc, Doppler-bright side, photon ring | Real ideas, painted not ray-traced |
| [Slow motion](#slow-motion) | Time slows on the close pass | Cinematic only |
| [Frozen sky](#the-frozen-sky) | Bodies move only while the comet flies | Game rule |
| [Hand and desk gravity](#hands-and-desks) | Your hand and your mug attract the comet | Game rule |

## Newtonian gravity

Each body contributes an acceleration toward itself:

```
a = GM * d / (|d|² + ε)^(3/2)
```

`d` is the vector from comet to body and `GM` is the body's gravitational parameter. The game stores `GM`
directly (0.004 to 0.02 m³/s²) because the comet's own mass cancels out of its motion, exactly as it does
for real spacecraft.

`ε` is **softening**, a standard trick from N-body astronomy: it stops the force from blowing up at zero
distance. Planets use a tiny `ε` because the comet crashes on their surface first. A hand has no surface,
so it uses a 2 cm softening and the comet can pass between your fingers.

The scale is the liberty: a real body with this pull at this size would be absurdly dense. The shapes of
the paths (ellipses, hyperbolas, slingshots) are the true ones.

## Integration

The comet advances by semi-implicit (symplectic) Euler: update velocity from acceleration, then position
from the new velocity. Plain Euler steadily gains energy and spirals orbits outward; the symplectic form
keeps energy bounded, which is why orbital codes favour this family. The step is fixed at 1/120 s and
shared with the level solver, so a path is identical at any frame rate.

## Kepler's laws

- **Second law.** A comet sweeps equal areas in equal times, so it is fastest at closest approach. You can
  watch this: the trail points spread out near the star.
- **Third law.** A moon at radius `r` around a primary of parameter `GM` orbits at angular speed
  `sqrt(GM / r³)`. The generator uses exactly that, capped at 2.2 rad/s so the motion stays readable.

## Gravity assist

When the comet swings behind a moon that is moving, it leaves faster than it arrived; passing in front
slows it. This is how Voyager reached the outer planets. The game does not script it: `step()` poses each
moon from the shot's elapsed time, and the momentum exchange falls out of ordinary gravity on a moving
source. (The moon itself is on rails and does not recoil.)

## Perihelion

Perihelion is the point of an orbit closest to its star. After every shot the HUD reports the closest pass
of the level's primary and the top speed reached, and the closest *winning* pass is kept as a personal
record. Diving closer buys more speed and more bend, at more risk.

## The grid

The board is a sheet whose height at each point is minus the gravitational potential, `Σ GM / r` (clamped
so wells do not reach the desk). The shader evaluates the same bodies the simulation uses, including your
hand and desk objects, so the wells you see are the wells that act. The picture is the classroom
rubber-sheet analogy: a good map of the potential, not a rendering of relativity.

## Comet tails

Real comets grow two tails. The **dust tail** is left along the orbit and curves behind the comet. The
**ion tail** is pushed by the solar wind and points straight away from the star whatever the comet's
direction, and both strengthen near perihelion as the nucleus heats. The particle emitter does both:
dust inherits a fraction of the comet's backward velocity, ions are pushed radially from the primary with
a strength proportional to `1 / r`.

## Black hole

A level's primary is sometimes a black hole: 1.8 times the mass inside a 1.2 cm horizon. Because the comet
can now get much closer before crashing, close passes are far more violent than around a star.

What is drawn:

- **Event horizon** — a pure black sphere. In passthrough it erases the room behind it.
- **Accretion disc** — gas in differential rotation (inner gas laps outer gas, as Kepler requires), hotter
  and whiter toward the inside, following the `r^-3/4` temperature profile of a thin disc.
- **Doppler beaming** — the side of the disc turning toward you is brighter.
- **Photon ring** — a thin circle at 1.5 horizon radii, where light itself can orbit.

What is not simulated: gravity here is Newtonian, so there is no light bending, no frame dragging and no
time dilation in the path. The photon ring is a billboard, not a ray-traced lens. Crossing the horizon is
simply a crash, reported as "Crossed the event horizon."

## Slow motion

As the comet nears the primary, the game feeds less simulated time into each frame (down to 30%), so the
close pass plays in slow motion, the way a film holds the slingshot shot. Only playback speed changes. The
path is computed from the same steps, so the solver's guarantee is untouched. It is a nod to gravitational
time dilation, not a model of it.

## The frozen sky

Moons move only while the comet is in flight, and rewind when it resets. That is a rule, not physics. It
makes a moving level a puzzle about *where things will be*, removes any dependence on when you let go, and
lets the solver prove each level solvable.

## Hands and desks

During a flight, a pinched hand over the board is a gravity well, and real objects found on your desk by
the depth scan are bodies with a crash radius. Their pull is assigned (about a mid-sized planet for a
hand, scaled by footprint for objects), not measured.
