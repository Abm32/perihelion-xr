import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  createSystem,
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
import { resumeAudio, sfx } from './sfx.js';
import { makeGravityGrid, makePlanet, makeStar, Particles } from './vfx.js';
import {
  Body,
  BOARD_R,
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

const PLAY_Y = 0.06; // comet plane above the desk, leaves room for fingers
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
  private live!: Level; // level plus the hand, used for the real flight only
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
        comet: this.comet.getWorldPosition(new Vector3()).toArray(),
      }),
      shoot: (px: number, pz: number) => this.fire(px, pz),
      solve: () => solve(this.level).best,
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
    hud.position.set(0, 0.15, -BOARD_R - 0.03);
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
    this.live = { ...this.level, bodies: [...this.level.bodies, this.hand] };
    this.buildGhost();
    this.buildLog();

    const bodies = this.level.bodies;
    const heaviest = bodies.reduce((a, b) => (b.gm > a.gm ? b : a), bodies[0]);
    this.star = heaviest ? { x: heaviest.x, z: heaviest.z } : { x: 0, z: 0 };
    const slots = this.grid.uniforms.uBodies.value;
    slots.forEach((v, i) => (bodies[i] ? v.set(bodies[i].x, bodies[i].z, bodies[i].gm) : v.set(0, 0, 0)));
    this.grid.uniforms.uRipple.value.z = -1;
    const color = new Color();
    for (const b of bodies) {
      let body;
      if (b === heaviest) {
        body = makeStar(b.hue);
        color.setHSL(0.02 + b.hue * 0.12, 1, 0.6);
        body.add(this.halo(color.getHex(), 6)); // corona: sprite, not bloom
      } else {
        const light = new Vector3(heaviest.x - b.x, 0.15, heaviest.z - b.z).normalize();
        body = makePlanet(b.hue, (b.gm * 1000) % 1, light);
      }
      body.position.set(b.x, PLAY_Y, b.z);
      body.scale.setScalar(b.r);
      this.timeUniforms.push(body.userData.uniforms.uTime);
      this.levelGroup.add(body);
    }
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
    this.say(
      this.save.index === 0 && this.save.shots === 0
        ? 'Pinch the comet. Pull back. Let go.'
        : this.save.index >= LEVELS_PER_DAY
          ? 'Encore. A new sky tomorrow.'
          : this.save.index === 1
            ? 'Mid-flight, pinch the air. Your hand has gravity.'
            : 'Bend it into the ring.',
    );
  }

  private resetComet(): void {
    this.phase = 'aim';
    this.releaseHand();
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
    const best = solve(this.level).best;
    if (!best) return;
    this.ghostPull = best;
    const s = launch(this.level, best.px, best.pz);
    let o: Outcome = 'flying';
    for (let i = 0; o === 'flying' && this.ghostN < 240; i++) {
      o = step(this.level, s);
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
    this.grid.uniforms.uBodies.value[3].set(this.hand.x, this.hand.z, this.hand.gm);
  }

  private releaseHand(): void {
    this.hand.gm = 0;
    this.handOrb.visible = false;
    this.grid.uniforms.uBodies.value[3].set(0, 0, 0);
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
    const best = this.save.todayShots ? `   ·   TODAY ${this.save.todayShots} SHOTS` : '';
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
      this.say(
        this.save.streak > before.streak
          ? `Daily done in ${this.save.todayShots} shots. Streak ${this.save.streak}.`
          : 'Perihelion!',
      );
    } else {
      this.phase = 'miss';
      if (outcome === 'crash') {
        this.particles.burst(x, PLAY_Y, z, 45, 0.16, 0.6, 1, 0.5, 0.15);
        sfx.crash();
      } else {
        sfx.lost();
      }
      this.say(outcome === 'crash' ? 'Burned up. Try again.' : 'Lost to deep space.');
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
      const s = launch(this.level, px, pz, this.scratch);
      outer: for (; n < dots; n++) {
        for (let k = 0; k < PREVIEW_STRIDE; k++) {
          if (step(this.level, s) !== 'flying') break outer;
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
    for (const u of this.timeUniforms) u.value = this.clock;
    const ripple = this.grid.uniforms.uRipple.value;
    if (ripple.z >= 0) ripple.z = ripple.z > 1.4 ? -1 : ripple.z + delta;
    this.particles.update(delta);
    if (this.placeIn >= 0) {
      this.placeIn -= delta;
      if (this.placeIn < 0) this.placeInFront();
    }
    if (this.snapWindow > 0) this.snapWindow -= delta;

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
        this.acc = Math.min(this.acc + delta, 0.1);
        let outcome: Outcome = 'flying';
        while (this.acc >= DT && outcome === 'flying') {
          this.acc -= DT;
          outcome = step(this.live, this.shot);
          this.pushTrail();
        }
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
