import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  createSystem,
  DepthOccludable,
  Entity,
  Grabbed,
  GrabSystem,
  Group,
  Line,
  LineBasicMaterial,
  Mesh,
  MeshBasicMaterial,
  OneHandGrabbable,
  PlaneGeometry,
  Points,
  PointsMaterial,
  Quaternion,
  RingGeometry,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  TorusGeometry,
  Vector3,
  VisibilityState,
  XRPlane,
} from '@iwsdk/core';
import { BoardHandle, Comet } from './game-components.js';
import { DeskScanner } from './desk.js';
import { resumeAudio, sfx } from './sfx.js';
import { makeBlackHole, makeGravityGrid, makePlanet, makeStar, Particles } from './vfx.js';
import {
  Body,
  bodyPos,
  BOARD_R,
  clusterDesk,
  DeskSample,
  deskSurface,
  HAND_GM,
  clearLevel,
  dayNumber,
  DT,
  EMPTY_SAVE,
  launch,
  Level,
  levelFor,
  LEVELS_PER_DAY,
  MAX_PULL,
  MIN_PULL,
  mulberry32,
  openDay,
  Outcome,
  Save,
  Shot,
  solve,
  step,
} from './sim.js';

type Phase = 'aim' | 'drag' | 'fly' | 'won' | 'miss';

const PLAY_Y = 0.08; // comet plane above the desk: room for fingers, and clear of depth-occlusion fade
const HAND_SLOT = 7; // last gravity-grid slot
const PARAMS = new URLSearchParams(location.search);
const TRAIL_MAX = 400;
const PREVIEW_MAX = 48;
const PREVIEW_STRIDE = 4; // sim steps between preview dots
const SAVE_KEY = 'perihelion.v1';
const HANDLE_OFFSET = new Vector3(BOARD_R + 0.045, 0.02, 0.1);

function loadSave(): Save {
  try {
    return { ...EMPTY_SAVE, ...JSON.parse(localStorage.getItem(SAVE_KEY) ?? '{}') };
  } catch {
    return { ...EMPTY_SAVE };
  }
}

function storeSave(save: Save): void {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(save));
  } catch {
    // private window or blocked storage: play on without persistence
  }
}

function glowTexture(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.25, 'rgba(255,255,255,0.45)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  return new CanvasTexture(c);
}

export class OrrerySystem extends createSystem({
  cometHeld: { required: [Comet, Grabbed] },
  boardHeld: { required: [BoardHandle, Grabbed] },
  planes: { required: [XRPlane] },
}) {
  private root = new Group();
  private levelGroup = new Group();
  private comet!: Mesh;
  private cometEntity!: Entity;
  private shotMesh!: Mesh;
  private boardHandle!: Mesh;
  private target!: Mesh;
  private targetMat!: MeshBasicMaterial;
  private trail!: Line;
  private trailPos = new Float32Array(TRAIL_MAX * 3);
  private trailCount = 0;
  private preview!: Points;
  private previewPos = new Float32Array(PREVIEW_MAX * 3);
  private band!: Line;
  private bandPos = new Float32Array(6);
  private hudCanvas = document.createElement('canvas');
  private hudTexture!: CanvasTexture;
  private glow = glowTexture();
  private unitSphere = new SphereGeometry(1, 32, 16);
  private grid = makeGravityGrid(BOARD_R + 0.03);
  private particles = new Particles();
  private timeUniforms: { value: number }[] = [];
  private star = { x: 0, z: 0 }; // heaviest body: lights the planets, blows the comet tail
  // The player's other hand: a gravity well while it pinches during a flight.
  private hand: Body = { x: 0, z: 0, r: 0, gm: 0, hue: 0 };
  private handOrb!: Sprite;
  private field!: Level; // generated level plus real desk objects: what the player aims through
  private live!: Level; // field plus the hand, used for the real flight only
  private rootEntity!: Entity;
  private handleEntity!: Entity;
  // Real desk objects found by the depth scan.
  private scanner = new DeskScanner();
  private desk: Body[] = [];
  private deskRings = new Group();
  private pendingScan: DeskSample[] | null = null;
  private lastScan: DeskSample[] = []; // kept for the debug hook
  private scanIn = -1;
  private wasBoardHeld = false;
  // One entry per generated body, in level order, so moving bodies can be re-posed each frame.
  private bodyViews: { body: Body; view: Group | Mesh; light: Vector3 | null }[] = [];
  private primary: Body | null = null;
  private p2 = { x: 0, z: 0 };
  // Shot telemetry: closest pass of the primary and top speed.
  private periapsis = Infinity;
  private topSpeed = 0;
  // Frame-rate governor: 0 soft occlusion, 1 single-tap occlusion, 2 occlusion off.
  private quality = 0;
  private frameAvg = 1 / 72;
  private perfClock = 0;
  private logLights = new Group();
  // First-level demo: a ghost performs one winning pull, then the ghost comet flies it.
  private ghost = new Group();
  private ghostDot!: Mesh;
  private ghostCue!: Sprite;
  private ghostBand!: Line;
  private ghostBandPos = new Float32Array(6);
  private ghostPull = { px: 0, pz: 0 };
  private ghostPath = new Float32Array(240 * 2);
  private ghostN = 0;

  private save: Save = EMPTY_SAVE;
  private level!: Level;
  private phase: Phase = 'aim';
  private shot: Shot = { x: 0, z: 0, vx: 0, vz: 0, t: 0 };
  private scratch: Shot = { x: 0, z: 0, vx: 0, vz: 0, t: 0 };
  private acc = 0;
  private timer = 0;
  private clock = 0;
  private lastTick = 0;
  private dropComet = false;
  private placeIn = -1;
  private snapWindow = 0;
  private message = '';

  private v1 = new Vector3();
  private v2 = new Vector3();
  private q1 = new Quaternion();

  init(): void {
    const rootEntity = this.world.createTransformEntity(this.root);
    this.rootEntity = rootEntity;
    this.root.position.set(0, 0.85, -0.55);
    this.buildBoard();

    // Pinchable comet. The grab volume is larger than the visible core so a
    // loose pinch still catches it.
    this.comet = new Mesh(
      this.unitSphere,
      new MeshBasicMaterial({ color: 0x9fe8ff, transparent: true, opacity: 0.22 }),
    );
    this.comet.scale.setScalar(0.028);
    const core = new Mesh(this.unitSphere, new MeshBasicMaterial({ color: 0xffffff }));
    core.scale.setScalar(0.4);
    this.comet.add(core, this.halo(0x9fe8ff, 5));
    this.cometEntity = this.world.createTransformEntity(this.comet, { parent: rootEntity });
    this.cometEntity.addComponent(Comet);
    this.cometEntity.addComponent(OneHandGrabbable, { rotate: false });

    // Rim puck: pinch and drag to move the whole board.
    this.boardHandle = new Mesh(
      this.unitSphere,
      new MeshBasicMaterial({ color: 0xffc46b, transparent: true, opacity: 0.7 }),
    );
    this.boardHandle.scale.setScalar(0.016);
    const handleEntity = this.world.createTransformEntity(this.boardHandle);
    this.handleEntity = handleEntity;
    handleEntity.addComponent(BoardHandle);
    handleEntity.addComponent(OneHandGrabbable, { rotate: false });

    this.cleanupFuncs.push(
      this.queries.cometHeld.subscribe('qualify', () => {
        resumeAudio();
        if (this.phase === 'aim') {
          this.phase = 'drag';
          this.lastTick = 0;
          sfx.grab();
        } else {
          this.dropComet = true; // grabbed mid-flight: release it next update
        }
      }),
      this.queries.cometHeld.subscribe('disqualify', () => this.onRelease()),
      this.queries.planes.subscribe('qualify', () => {
        if (this.snapWindow > 0) this.snapToDesk();
      }),
      this.world.visibilityState.subscribe((state) => {
        if (state === VisibilityState.Visible && this.placeIn < 0 && this.snapWindow <= 0) {
          resumeAudio();
          this.placeIn = 0.6; // let the head pose settle before placing the board
        }
        if (state === VisibilityState.NonImmersive) {
          this.root.position.set(0, 0.85, -0.55);
          this.root.rotation.y = 0;
          this.snapWindow = 0;
        }
      }),
    );

    this.save = openDay(loadSave(), dayNumber());
    this.loadLevel();

    // Debug and verification hook (emulator, tests, demo capture).
    (window as unknown as Record<string, unknown>).__perihelion = {
      state: () => ({
        phase: this.phase,
        save: this.save,
        level: this.level,
        message: this.message,
        board: this.root.position.toArray(),
        yaw: this.root.rotation.y,
        hand: { ...this.hand },
        ghost: this.ghost.visible,
        quality: this.quality,
        periapsis: this.periapsis,
        topSpeed: this.topSpeed,
        t: this.shot.t,
        comet: this.comet.getWorldPosition(new Vector3()).toArray(),
      }),
      shoot: (px: number, pz: number) => this.fire(px, pz),
      solve: () => solve(this.field).best,
      desk: () => this.desk,
      // Jump to any day's level (changes the in-memory save; for capture and tests only).
      load: (day: number, index: number) => {
        this.save = { ...this.save, day, index };
        this.loadLevel();
      },
      lastScan: () => this.lastScan,
      scanner: () => ({ supported: this.scanner.supported, busy: this.scanner.busy }),
      scan: () => { this.scanIn = 0.01; },
      place: () => this.placeInFront(),
      feed: (samples: DeskSample[]) => { this.pendingScan = samples; }, // inject a fake scan
    };
  }

  // ---- construction -------------------------------------------------------

  private halo(color: number, scale: number): Sprite {
    const sprite = new Sprite(
      new SpriteMaterial({
        map: this.glow,
        color,
        blending: AdditiveBlending,
        depthWrite: false,
        transparent: true,
        opacity: 0.7,
      }),
    );
    sprite.scale.setScalar(scale);
    return sprite;
  }

  private buildBoard(): void {
    // Dark gravity grid: reads against any real desk in passthrough and shows the wells.
    this.grid.mesh.position.y = PLAY_Y - 0.008;
    const rim = new Mesh(
      new RingGeometry(BOARD_R + 0.026, BOARD_R + 0.03, 96),
      new MeshBasicMaterial({ color: 0x6fb7ff, transparent: true, opacity: 0.8 }),
    );
    rim.rotation.x = -Math.PI / 2;
    rim.position.y = PLAY_Y - 0.007;

    const rnd = mulberry32(7);
    const stars = new Float32Array(90 * 3);
    for (let i = 0; i < 90; i++) {
      const r = Math.sqrt(rnd()) * BOARD_R;
      const th = rnd() * Math.PI * 2;
      stars.set([Math.cos(th) * r, PLAY_Y + 0.02 + rnd() * 0.09, Math.sin(th) * r], i * 3);
    }
    const starGeo = new BufferGeometry();
    starGeo.setAttribute('position', new BufferAttribute(stars, 3));
    const starPoints = new Points(
      starGeo,
      new PointsMaterial({ color: 0xbcd4ff, size: 0.0022, transparent: true, opacity: 0.7 }),
    );

    const trailGeo = new BufferGeometry();
    trailGeo.setAttribute('position', new BufferAttribute(this.trailPos, 3));
    trailGeo.setDrawRange(0, 0);
    this.trail = new Line(trailGeo, new LineBasicMaterial({ color: 0x9fe8ff, transparent: true }));
    this.trail.frustumCulled = false;

    const previewGeo = new BufferGeometry();
    previewGeo.setAttribute('position', new BufferAttribute(this.previewPos, 3));
    previewGeo.setDrawRange(0, 0);
    this.preview = new Points(
      previewGeo,
      new PointsMaterial({ color: 0xffffff, size: 0.004, transparent: true, opacity: 0.85 }),
    );
    this.preview.frustumCulled = false;

    const bandGeo = new BufferGeometry();
    bandGeo.setAttribute('position', new BufferAttribute(this.bandPos, 3));
    this.band = new Line(bandGeo, new LineBasicMaterial({ color: 0xffc46b }));
    this.band.frustumCulled = false;
    this.band.visible = false;

    this.shotMesh = new Mesh(this.unitSphere, new MeshBasicMaterial({ color: 0xffffff }));
    this.shotMesh.scale.setScalar(0.009);
    this.shotMesh.add(this.halo(0x9fe8ff, 7));
    this.shotMesh.visible = false;

    this.hudCanvas.width = 1024;
    this.hudCanvas.height = 256;
    this.hudTexture = new CanvasTexture(this.hudCanvas);
    const hud = new Mesh(
      new PlaneGeometry(0.36, 0.09),
      new MeshBasicMaterial({ map: this.hudTexture, transparent: true }),
    );
    // Low enough to sit inside the Meta VR Glasses view (25 degrees above the view axis).
    hud.position.set(0, 0.125, -BOARD_R - 0.03);
    hud.rotation.x = -0.45; // tilt up toward a seated player's eyes

    this.handOrb = this.halo(0xc59bff, 0.09);
    this.handOrb.visible = false;

    this.ghostDot = new Mesh(
      this.unitSphere,
      new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55 }),
    );
    this.ghostDot.scale.setScalar(0.011);
    this.ghostCue = this.halo(0xffffff, 0.06);
    const ghostGeo = new BufferGeometry();
    ghostGeo.setAttribute('position', new BufferAttribute(this.ghostBandPos, 3));
    this.ghostBand = new Line(
      ghostGeo,
      new LineBasicMaterial({ color: 0xffc46b, transparent: true, opacity: 0.6 }),
    );
    this.ghostBand.frustumCulled = false;
    this.ghost.add(this.ghostDot, this.ghostCue, this.ghostBand);
    this.ghost.visible = false;

    this.root.add(
      this.grid.mesh,
      rim,
      this.particles.points,
      starPoints,
      this.levelGroup,
      this.trail,
      this.preview,
      this.band,
      this.shotMesh,
      this.handOrb,
      this.deskRings,
      this.logLights,
      this.ghost,
      hud,
    );
  }

  private loadLevel(): void {
    this.levelGroup.traverse((o) => {
      const m = o as Mesh;
      (m.material as MeshBasicMaterial | undefined)?.dispose?.();
      if (m.geometry && m.geometry.type !== 'SphereGeometry') m.geometry.dispose();
    });
    this.levelGroup.clear();
    this.timeUniforms.length = 0;
    this.level = levelFor(this.save.day, this.save.index);
    this.rebuildField();
    this.buildLog();
    if (this.world.visibilityState.peek() !== VisibilityState.NonImmersive) this.scanIn = 0.4;

    const bodies = this.level.bodies;
    const primary = bodies.find((b) => b.kind !== 'planet') ?? null;
    this.primary = primary;
    this.star = primary ? { x: primary.x, z: primary.z } : { x: 0, z: 0 };
    this.grid.uniforms.uRipple.value.z = -1;
    this.bodyViews.length = 0;
    const color = new Color();
    for (const b of bodies) {
      let view: Group | Mesh;
      let light: Vector3 | null = null;
      if (b.kind === 'hole') {
        view = makeBlackHole();
      } else if (b.kind === 'star') {
        view = makeStar(b.hue);
        color.setHSL(0.02 + b.hue * 0.12, 1, 0.6);
        view.add(this.halo(color.getHex(), 6)); // corona: sprite, not bloom
      } else {
        light = new Vector3(0, 1, 0);
        view = makePlanet(b.hue, (b.gm * 1000) % 1, light);
      }
      view.scale.setScalar(b.r);
      this.timeUniforms.push(view.userData.uniforms.uTime);
      this.levelGroup.add(view);
      this.bodyViews.push({ body: b, view, light });
      if (b.orbit) {
        // The moon's track, so its future position can be judged before firing.
        const track = new Mesh(
          new RingGeometry(b.orbit.rad - 0.0007, b.orbit.rad + 0.0007, 96),
          new MeshBasicMaterial({ color: 0x9fb8ff, transparent: true, opacity: 0.35 }),
        );
        track.rotation.x = -Math.PI / 2;
        track.position.set(b.orbit.cx, PLAY_Y - 0.004, b.orbit.cz);
        this.levelGroup.add(track);
      }
    }
    this.syncBodies(0);
    const t = this.level.target;
    this.targetMat = new MeshBasicMaterial({ color: 0xffd76b, transparent: true });
    this.target = new Mesh(new TorusGeometry(t.r, 0.0025, 8, 48), this.targetMat);
    this.target.rotation.x = Math.PI / 2;
    this.target.position.set(t.x, PLAY_Y, t.z);
    const pad = new Mesh(
      new RingGeometry(0.014, 0.016, 32),
      new MeshBasicMaterial({ color: 0xffc46b, transparent: true, opacity: 0.8 }),
    );
    pad.rotation.x = -Math.PI / 2;
    pad.position.set(this.level.launcher.x, PLAY_Y, this.level.launcher.z);
    const gate = this.halo(0xffd76b, t.r * 3.2);
    gate.position.copy(this.target.position);
    this.levelGroup.add(this.target, pad, gate);

    this.trailCount = 0;
    this.trail.geometry.setDrawRange(0, 0);
    this.resetComet();
    this.refreshOcclusion();
    this.say(
      this.save.index === 0 && this.save.shots === 0
        ? 'Pinch the comet. Pull back. Let go.'
        : this.save.index >= LEVELS_PER_DAY
          ? 'Encore. A new sky tomorrow.'
          : this.save.index === 1
            ? 'Mid-flight, pinch the air. Your hand has gravity.'
            : bodies.some((b) => b.orbit)
              ? 'Time moves only while the comet flies.'
              : primary?.kind === 'hole'
                ? 'A black hole. Stay outside the horizon.'
                : 'Bend it into the ring.',
    );
  }

  private resetComet(): void {
    this.phase = 'aim';
    this.releaseHand();
    this.syncBodies(0); // the sky rewinds with the comet
    this.comet.visible = true;
    this.comet.position.set(this.level.launcher.x, PLAY_Y, this.level.launcher.z);
    this.shotMesh.visible = false;
    this.band.visible = false;
    this.preview.geometry.setDrawRange(0, 0);
  }

  // ---- onboarding ghost, streak lights, hand gravity ------------------------

  /** Only before the very first shot of the day: precompute one winning pull and its path. */
  private buildGhost(): void {
    this.ghostN = 0;
    this.ghost.visible = false;
    if (this.save.index !== 0 || this.save.shots !== 0) return;
    const best = solve(this.field).best;
    if (!best) return;
    this.ghostPull = best;
    const s = launch(this.field, best.px, best.pz);
    let o: Outcome = 'flying';
    for (let i = 0; o === 'flying' && this.ghostN < 240; i++) {
      o = step(this.field, s);
      if (i % 3 === 0) {
        this.ghostPath[this.ghostN * 2] = s.x;
        this.ghostPath[this.ghostN * 2 + 1] = s.z;
        this.ghostN++;
      }
    }
  }

  /** Loop: pinch cue closes on the comet, ghost pulls back, lets go, ghost comet flies to the ring. */
  private updateGhost(delta: number): void {
    if (this.ghostN === 0 || this.save.shots > 0) {
      this.ghost.visible = false;
      return;
    }
    this.ghost.visible = true;
    this.timer = (this.timer + delta) % 3.4;
    const t = this.timer;
    const l = this.level.launcher;
    const pull = Math.min(1, Math.max(0, (t - 0.6) / 1.0));
    const ease = pull * pull * (3 - 2 * pull);
    const gx = l.x + this.ghostPull.px * ease;
    const gz = l.z + this.ghostPull.pz * ease;
    const flying = t > 1.9;
    this.ghostCue.visible = !flying;
    this.ghostCue.position.set(gx, PLAY_Y, gz);
    this.ghostCue.scale.setScalar(0.09 - 0.05 * Math.min(1, t / 0.6)); // closes like a pinch
    this.ghostBand.visible = !flying && t > 0.6;
    this.ghostBandPos.set([l.x, PLAY_Y, l.z, gx, PLAY_Y, gz]);
    this.ghostBand.geometry.attributes.position.needsUpdate = true;
    if (flying) {
      const i = Math.min(this.ghostN - 1, Math.floor(((t - 1.9) / 1.5) * this.ghostN));
      this.ghostDot.position.set(this.ghostPath[i * 2], PLAY_Y, this.ghostPath[i * 2 + 1]);
    } else {
      this.ghostDot.position.set(gx, PLAY_Y, gz);
    }
  }

  /** Lights on the far rim: one per day of the streak, gold when cleared without hand gravity. */
  private buildLog(): void {
    this.logLights.traverse((o) => ((o as Mesh).material as MeshBasicMaterial | undefined)?.dispose?.());
    this.logLights.clear();
    const log = this.save.log;
    log.forEach((kind, i) => {
      const a = -Math.PI / 2 + (i - (log.length - 1) / 2) * 0.075;
      const light = new Mesh(
        this.unitSphere,
        new MeshBasicMaterial({ color: kind === 2 ? 0xffd76b : 0x6fb7ff }),
      );
      light.scale.setScalar(0.0045);
      light.position.set(Math.cos(a) * (BOARD_R + 0.048), PLAY_Y - 0.004, Math.sin(a) * (BOARD_R + 0.048));
      this.logLights.add(light);
    });
  }

  /** During a flight, a pinch held over the board turns that hand into a gravity well. */
  private updateHand(): void {
    const pads = this.input.xr.gamepads;
    let active = false;
    for (const side of ['left', 'right'] as const) {
      if (!pads?.[side]?.getSelecting()) continue;
      this.player.indexTipSpaces[side].getWorldPosition(this.v1);
      this.root.worldToLocal(this.v1);
      if (Math.hypot(this.v1.x, this.v1.z) > BOARD_R + 0.1 || Math.abs(this.v1.y - PLAY_Y) > 0.25) continue;
      this.hand.x = this.v1.x;
      this.hand.z = this.v1.z;
      active = true;
      break;
    }
    if (active && this.hand.gm === 0) {
      sfx.grab();
      if (!this.save.nudged) this.save = { ...this.save, nudged: true };
    }
    this.hand.gm = active ? HAND_GM : 0;
    this.handOrb.visible = active;
    this.handOrb.position.set(this.hand.x, PLAY_Y, this.hand.z);
    this.grid.uniforms.uBodies.value[HAND_SLOT].set(this.hand.x, this.hand.z, this.hand.gm);
  }

  private releaseHand(): void {
    this.hand.gm = 0;
    this.handOrb.visible = false;
    this.grid.uniforms.uBodies.value[HAND_SLOT].set(0, 0, 0);
  }

  /** Pose moving bodies for shot time `t`: mesh, grid well and the light falling on planets. */
  private syncBodies(t: number): void {
    const slots = this.grid.uniforms.uBodies.value;
    for (let i = 0; i < this.bodyViews.length; i++) {
      const { body, view, light } = this.bodyViews[i];
      const p = bodyPos(body, t, this.p2);
      view.position.set(p.x, PLAY_Y, p.z);
      slots[i].set(p.x, p.z, body.gm);
      light?.set(this.star.x - p.x, 0.15, this.star.z - p.z).normalize();
    }
  }

  /**
   * Frame-rate governor. The build was never profiled on a headset, so the app
   * protects its own frame rate: if frames average slower than 55 fps for three
   * seconds, real-world occlusion steps down from 13 taps to 1, then off.
   */
  private govern(delta: number, immersive: boolean): void {
    if (!immersive || this.quality >= 2) return;
    this.frameAvg = this.frameAvg * 0.95 + delta * 0.05;
    this.perfClock += delta;
    if (this.perfClock > 3 && this.frameAvg > 1 / 55) {
      this.quality++;
      this.perfClock = 0;
      this.refreshOcclusion();
    }
  }

  // ---- real world: desk objects and occlusion ---------------------------------

  /** Recompose what the comet flies through: generated bodies, real desk objects, then the hand. */
  private rebuildField(): void {
    this.field = { ...this.level, bodies: [...this.level.bodies, ...this.desk] };
    this.live = { ...this.field, bodies: [...this.field.bodies, this.hand] };
    const slots = this.grid.uniforms.uBodies.value;
    const bodies = this.field.bodies;
    for (let i = 0; i < HAND_SLOT; i++) {
      if (bodies[i]) slots[i].set(bodies[i].x, bodies[i].z, bodies[i].gm);
      else slots[i].set(0, 0, 0);
    }
    // A real object is its own visual. It only gets a ring on the grid at its base.
    this.deskRings.traverse((o) => {
      const m = o as Mesh;
      (m.material as MeshBasicMaterial | undefined)?.dispose?.();
      m.geometry?.dispose();
    });
    this.deskRings.clear();
    for (const b of this.desk) {
      const ring = new Mesh(
        new RingGeometry(b.r, b.r + 0.004, 48),
        new MeshBasicMaterial({ color: 0xffc46b, transparent: true, opacity: 0.9 }),
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(b.x, PLAY_Y - 0.006, b.z);
      this.deskRings.add(ring);
    }
    this.buildGhost();
  }

  /** Apply a finished scan: settle the board on the real surface, then adopt what stands on it. */
  private applyScan(samples: DeskSample[]): void {
    this.lastScan = samples;
    const surface = deskSurface(samples);
    if (surface === null) return; // no flat surface under the board: keep the generated level only
    // Depth-based height is live; it corrects a missing or stale plane.
    this.root.position.y += surface + 0.004;
    const before = this.desk.length;
    this.desk = clusterDesk(samples, surface);
    if (this.desk.length === 0 && before === 0) return;
    this.rebuildField();
    this.refreshOcclusion();
    if (this.desk.length === 0) {
      this.say('Desk cleared.');
    } else if (solve(this.field).count === 0) {
      this.say('Your desk blocks every path. Move something.');
      this.scanIn = 3; // look again once the player has had time to move it
    } else if (this.desk.length !== before) {
      this.say(this.desk.length === 1 ? 'That object on your desk has gravity now.' : `${this.desk.length} things on your desk have gravity now.`);
    }
  }

  private updateScan(delta: number): void {
    if (PARAMS.get('desk') === '0') return;
    const held = this.queries.boardHeld.entities.size > 0;
    if (this.wasBoardHeld && !held) this.scanIn = 0.5; // board was moved: the desk under it changed
    this.wasBoardHeld = held;
    if (this.scanIn >= 0 && !held) {
      this.scanIn -= delta;
      if (this.scanIn < 0) this.scanner.start();
    }
    const session = this.xrManager.getSession();
    const frame = this.xrFrame;
    const refSpace = this.xrManager.getReferenceSpace();
    if (session && frame && refSpace && this.scanner.busy) {
      const done = this.scanner.update(session, frame, refSpace, this.root, this.player, this.underHand);
      if (done) this.pendingScan = done;
    } else if (!session && this.scanner.busy) {
      this.scanner.cancel();
    }
    // Never change the field under a comet in flight.
    if (this.pendingScan && this.phase === 'aim') {
      const samples = this.pendingScan;
      this.pendingScan = null;
      this.applyScan(samples);
    }
  }

  /** True when a board-space point is within 12 cm of either hand. */
  private underHand = (x: number, z: number): boolean => {
    for (const side of ['left', 'right'] as const) {
      this.player.gripSpaces[side].getWorldPosition(this.v1);
      this.root.worldToLocal(this.v1);
      if (Math.abs(this.v1.y) < 0.5 && Math.hypot(this.v1.x - x, this.v1.z - z) < 0.12) return true;
    }
    return false;
  };

  /**
   * DepthSensingSystem patches materials once, when the component is added.
   * Levels create new materials, so re-add the component to patch those too.
   */
  private refreshOcclusion(): void {
    const param = PARAMS.get('occlusion');
    const off = param === '0' || this.quality >= 2;
    const value = { mode: param === 'hard' || this.quality === 1 ? 'HardOcclusion' : 'SoftOcclusion' } as const;
    for (const entity of [this.rootEntity, this.handleEntity]) {
      if (entity.hasComponent(DepthOccludable)) entity.removeComponent(DepthOccludable);
      if (!off) entity.addComponent(DepthOccludable, value);
    }
  }

  // ---- HUD ----------------------------------------------------------------

  private say(message: string): void {
    this.message = message;
    const g = this.hudCanvas.getContext('2d')!;
    g.clearRect(0, 0, 1024, 256);
    g.fillStyle = 'rgba(4,6,12,0.72)';
    g.beginPath();
    g.roundRect(0, 0, 1024, 256, 40);
    g.fill();
    g.textAlign = 'center';
    g.fillStyle = '#6fb7ff';
    g.font = '600 34px system-ui, sans-serif';
    const n = this.save.index;
    const where = n < LEVELS_PER_DAY ? `LEVEL ${n + 1} OF ${LEVELS_PER_DAY}` : `ENCORE ${n - LEVELS_PER_DAY + 1}`;
    g.fillText(`PERIHELION   ·   ${where}`, 512, 62);
    g.fillStyle = '#ffffff';
    g.font = '600 58px system-ui, sans-serif';
    g.fillText(message, 512, 150, 960);
    g.fillStyle = '#ffd76b';
    g.font = '500 36px system-ui, sans-serif';
    const best =
      (this.save.todayShots ? `   ·   TODAY ${this.save.todayShots}` : '') +
      (this.save.closest ? `   ·   CLOSEST ${(this.save.closest * 100).toFixed(1)} CM` : '');
    g.fillText(`SHOTS ${this.save.shots}   ·   STREAK ${this.save.streak}${best}`, 512, 218);
    this.hudTexture.needsUpdate = true;
  }

  // ---- board placement ----------------------------------------------------

  /** Put the board within arm's reach in front of the seated player, facing them. */
  private placeInFront(): void {
    const head = this.player.head;
    head.getWorldPosition(this.v1);
    this.v2.set(0, 0, -1).applyQuaternion(head.getWorldQuaternion(this.q1));
    this.v2.y = 0;
    if (this.v2.lengthSq() < 1e-4) this.v2.set(0, 0, -1);
    this.v2.normalize();
    this.root.position.set(
      this.v1.x + this.v2.x * 0.45,
      this.v1.y - 0.45,
      this.v1.z + this.v2.z * 0.45,
    );
    this.root.rotation.y = Math.atan2(-this.v2.x, -this.v2.z);
    this.snapWindow = 8; // planes often arrive a few seconds into the session
    this.snapToDesk();
    this.scanIn = 1.2; // then look at what is really on the desk
  }

  /** Drop the board onto the nearest real horizontal surface at desk height. */
  private snapToDesk(): void {
    this.player.head.getWorldPosition(this.v1);
    let bestY = NaN;
    let bestD = 0.7;
    for (const entity of this.queries.planes.entities) {
      const plane = entity.getValue(XRPlane, '_plane') as { orientation?: string } | undefined;
      const obj = entity.object3D;
      if (!obj || plane?.orientation !== 'horizontal') continue;
      obj.getWorldPosition(this.v2);
      const below = this.v1.y - this.v2.y;
      if (below < 0.2 || below > 0.9) continue; // skips floor and shelves above the lap
      // ponytail: tests distance to the plane's center, not its polygon. A huge
      // desk whose center is >0.7 m away is missed; the rim puck covers that.
      const d = Math.hypot(this.v2.x - this.root.position.x, this.v2.z - this.root.position.z);
      if (d < bestD) {
        bestD = d;
        bestY = this.v2.y;
      }
    }
    if (!Number.isNaN(bestY)) this.root.position.y = bestY + 0.004;
  }

  // ---- play ---------------------------------------------------------------

  private onRelease(): void {
    if (this.phase !== 'drag') return;
    const px = this.comet.position.x - this.level.launcher.x;
    const pz = this.comet.position.z - this.level.launcher.z;
    if (Math.hypot(px, pz) < MIN_PULL) {
      this.resetComet(); // a tap, not a pull
      return;
    }
    this.fire(px, pz);
  }

  private fire(px: number, pz: number): void {
    if (this.phase !== 'aim' && this.phase !== 'drag') return;
    launch(this.level, px, pz, this.shot);
    this.save = { ...this.save, shots: this.save.shots + 1 };
    storeSave(this.save);
    this.phase = 'fly';
    this.periapsis = Infinity;
    this.topSpeed = 0;
    this.acc = 0;
    this.trailCount = 0;
    (this.trail.material as LineBasicMaterial).opacity = 1;
    this.comet.visible = false;
    this.comet.position.set(this.level.launcher.x, PLAY_Y, this.level.launcher.z);
    this.band.visible = false;
    this.preview.geometry.setDrawRange(0, 0);
    this.shotMesh.visible = true;
    this.particles.burst(this.shot.x, PLAY_Y, this.shot.z, 14, 0.12, 0.35, 0.6, 0.9, 1);
    sfx.launch(Math.min(1, Math.hypot(px, pz) / MAX_PULL));
    this.say('…');
  }

  private pushTrail(): void {
    if (this.trailCount >= TRAIL_MAX) return;
    this.trailPos.set([this.shot.x, PLAY_Y, this.shot.z], this.trailCount * 3);
    this.trailCount++;
  }

  /** Two tails, as on a real comet: dust lags along the path, ions blow straight away from the star. */
  private emitTail(): void {
    const { x, z, vx, vz } = this.shot;
    const ax = x - this.star.x;
    const az = z - this.star.z;
    const d = Math.hypot(ax, az) || 1;
    const j = () => (Math.random() - 0.5) * 0.02;
    this.particles.emit(x, PLAY_Y, z, -vx * 0.25 + j(), j() * 0.5, -vz * 0.25 + j(), 0.7, 0.006, 1, 0.85, 0.6);
    // Ion tail brightens near the star, like outgassing near perihelion.
    const push = Math.min(0.25, 0.012 / d);
    this.particles.emit(x, PLAY_Y, z, (ax / d) * push + j(), 0, (az / d) * push + j(), 0.5, 0.005, 0.5, 0.8, 1);
  }

  private land(outcome: Outcome): void {
    this.timer = 0;
    this.releaseHand();
    this.shotMesh.visible = false;
    // The spent trail stays, dimmed, as a reference for the next attempt.
    (this.trail.material as LineBasicMaterial).opacity = 0.35;
    const { x, z } = this.shot;
    if (outcome === 'hit') {
      this.particles.burst(x, PLAY_Y, z, 70, 0.22, 1.1, 1, 0.82, 0.35);
      this.grid.uniforms.uRipple.value.set(this.level.target.x, this.level.target.z, 0);
      this.phase = 'won';
      const before = this.save;
      this.save = clearLevel(this.save);
      storeSave(this.save);
      sfx.hit();
      // Perihelion: the closest point of an orbit to its star. The stat the game is named for.
      const pass = Number.isFinite(this.periapsis) ? this.periapsis : 0;
      const record = pass > 0 && (this.save.closest === 0 || pass < this.save.closest);
      if (record) this.save = { ...this.save, closest: pass };
      storeSave(this.save);
      const stats = `${(pass * 100).toFixed(1)} cm pass at ${this.topSpeed.toFixed(2)} m/s`;
      this.say(
        this.save.streak > before.streak
          ? `Daily done in ${this.save.todayShots} shots. Streak ${this.save.streak}.`
          : record
            ? `Closest pass yet: ${stats}`
            : `Perihelion: ${stats}`,
      );
    } else {
      this.phase = 'miss';
      if (outcome === 'crash') {
        this.particles.burst(x, PLAY_Y, z, 45, 0.16, 0.6, 1, 0.5, 0.15);
        sfx.crash();
      } else {
        sfx.lost();
      }
      const swallowed =
        outcome === 'crash' && this.primary?.kind === 'hole' && this.periapsis < this.primary.r + 0.004;
      this.say(
        swallowed
          ? 'Crossed the event horizon.'
          : outcome === 'crash'
            ? 'Burned up. Try again.'
            : `Escaped at ${this.topSpeed.toFixed(2)} m/s. Lost to deep space.`,
      );
    }
  }

  private updateDrag(): void {
    const l = this.level.launcher;
    const px = this.comet.position.x - l.x;
    const pz = this.comet.position.z - l.z;
    const pull = Math.min(1, Math.hypot(px, pz) / MAX_PULL);

    this.bandPos.set([l.x, PLAY_Y, l.z, this.comet.position.x, this.comet.position.y, this.comet.position.z]);
    this.band.geometry.attributes.position.needsUpdate = true;
    this.band.visible = true;

    const tick = Math.floor(pull * 8);
    if (tick !== this.lastTick) {
      this.lastTick = tick;
      sfx.stretch(pull);
    }

    // Short look-ahead: long on the first level to teach, shorter after so the
    // curve past the first planet is still the player's to work out.
    const dots = this.level.difficulty === 0 ? PREVIEW_MAX : 20;
    let n = 0;
    if (pull * MAX_PULL >= MIN_PULL) {
      const s = launch(this.field, px, pz, this.scratch);
      outer: for (; n < dots; n++) {
        for (let k = 0; k < PREVIEW_STRIDE; k++) {
          if (step(this.field, s) !== 'flying') break outer;
        }
        this.previewPos.set([s.x, PLAY_Y, s.z], n * 3);
      }
    }
    this.preview.geometry.attributes.position.needsUpdate = true;
    this.preview.geometry.setDrawRange(0, n);
  }

  update(delta: number): void {
    const visibility = this.world.visibilityState.peek();
    if (visibility === VisibilityState.VisibleBlurred) return; // system menu open: pause

    this.clock += delta;
    this.govern(delta, visibility === VisibilityState.Visible);
    for (const u of this.timeUniforms) u.value = this.clock;
    const ripple = this.grid.uniforms.uRipple.value;
    if (ripple.z >= 0) ripple.z = ripple.z > 1.4 ? -1 : ripple.z + delta;
    this.particles.update(delta);
    if (this.placeIn >= 0) {
      this.placeIn -= delta;
      if (this.placeIn < 0) this.placeInFront();
    }
    if (this.snapWindow > 0) this.snapWindow -= delta;
    this.updateScan(delta);

    // Rim puck drags the board; otherwise it rides along on the rim.
    if (this.queries.boardHeld.entities.size > 0) {
      this.snapWindow = 0; // the player chose a spot: stop auto-snapping
      this.v1.copy(HANDLE_OFFSET).applyAxisAngle(this.v2.set(0, 1, 0), this.root.rotation.y);
      this.root.position.copy(this.boardHandle.position).sub(this.v1);
    } else {
      this.root.updateMatrixWorld();
      this.boardHandle.position.copy(HANDLE_OFFSET).applyMatrix4(this.root.matrixWorld);
    }

    if (this.dropComet) {
      this.dropComet = false;
      this.world.getSystem(GrabSystem)?.forceRelease(this.cometEntity);
    }

    const pulse = 1 + Math.sin(this.clock * 4) * 0.08;
    switch (this.phase) {
      case 'aim':
        this.updateGhost(delta);
        this.target.scale.setScalar(pulse);
        this.comet.scale.setScalar(0.028 * pulse);
        break;
      case 'drag':
        this.ghost.visible = false;
        this.updateDrag();
        break;
      case 'fly': {
        this.updateHand();
        // Slow motion on the close pass: the film shot of the slingshot. Sim time
        // per frame shrinks; the path itself is untouched.
        const near = this.primary?.kind === 'hole' ? 0.075 : 0.05;
        const dPrimary = this.primary
          ? Math.hypot(this.shot.x - this.star.x, this.shot.z - this.star.z) - this.primary.r
          : 1;
        const timeScale = Math.min(1, Math.max(0.3, dPrimary / near));
        this.acc = Math.min(this.acc + delta * timeScale, 0.1);
        let outcome: Outcome = 'flying';
        while (this.acc >= DT && outcome === 'flying') {
          this.acc -= DT;
          outcome = step(this.live, this.shot);
          this.pushTrail();
          if (this.primary) {
            const d = Math.hypot(this.shot.x - this.star.x, this.shot.z - this.star.z);
            if (d < this.periapsis) this.periapsis = d;
          }
          const v = Math.hypot(this.shot.vx, this.shot.vz);
          if (v > this.topSpeed) this.topSpeed = v;
        }
        this.syncBodies(this.shot.t);
        this.shotMesh.position.set(this.shot.x, PLAY_Y, this.shot.z);
        this.emitTail();
        this.trail.geometry.attributes.position.needsUpdate = true;
        this.trail.geometry.setDrawRange(0, this.trailCount);
        if (outcome !== 'flying') this.land(outcome);
        break;
      }
      case 'won':
        this.timer += delta;
        this.target.scale.setScalar(1 + this.timer * 2.5);
        this.targetMat.opacity = Math.max(0, 1 - this.timer / 1.2);
        if (this.timer > 2.2) this.loadLevel();
        break;
      case 'miss':
        this.timer += delta;
        if (this.timer > 0.6) this.resetComet();
        break;
    }
  }
}
