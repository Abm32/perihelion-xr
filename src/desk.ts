/**
 * Scans the real desk under the board with WebXR hit tests.
 *
 * On Quest 3 and 3S (Horizon Browser 40.4+) hit tests are answered from the
 * live depth map rather than the saved room mesh, so a ray cast straight down
 * lands on whatever is really there right now: the desk, a mug, a keyboard.
 * Depth is only exposed to the page as a GPU texture, so hit tests are the
 * cheap way to get a few dozen real-world heights onto the CPU.
 *
 * Hit-test sources are created in small batches and cancelled after a few
 * frames, so a scan never holds more than BATCH sources open.
 */
import { Object3D, Vector3 } from '@iwsdk/core';
import { DeskSample, deskProbePoints } from './sim.js';

const BATCH = 10;
const FRAMES_WANTED = 4; // readings averaged per probe
const FRAMES_TIMEOUT = 30; // give up on a probe that never answers
const CAST_HEIGHT = 0.4; // rays start this far above the board

interface Probe {
  x: number;
  z: number;
  source: XRHitTestSource | null;
  sum: number;
  hits: number;
  age: number;
  done: boolean;
}

export class DeskScanner {
  /** False once the session has refused a hit-test source; the game then runs without the scan. */
  supported = true;
  private points = deskProbePoints();
  private next = 0;
  private batch: Probe[] = [];
  private samples: DeskSample[] = [];
  private running = false;
  private v = new Vector3();

  get busy(): boolean {
    return this.running;
  }

  start(): void {
    if (!this.supported || this.running) return;
    this.running = true;
    this.next = 0;
    this.samples = [];
    this.batch = [];
  }

  cancel(): void {
    for (const p of this.batch) p.source?.cancel();
    this.batch = [];
    this.running = false;
  }

  /**
   * Advance the scan by one frame. Returns the samples when the scan completes,
   * otherwise null. `skip` is asked, in board space, whether a point is under a hand.
   */
  update(
    session: XRSession,
    frame: XRFrame,
    refSpace: XRReferenceSpace,
    board: Object3D,
    rig: Object3D,
    skip: (x: number, z: number) => boolean,
  ): DeskSample[] | null {
    if (!this.running) return null;
    if (typeof session.requestHitTestSource !== 'function' || typeof XRRay === 'undefined') {
      this.supported = false;
      this.running = false;
      return null;
    }

    if (this.batch.length === 0) {
      if (this.next >= this.points.length) {
        this.running = false;
        return this.samples;
      }
      for (const pt of this.points.slice(this.next, this.next + BATCH)) {
        const probe: Probe = { ...pt, source: null, sum: 0, hits: 0, age: 0, done: false };
        this.batch.push(probe);
        // Ray origin: above the probe point, expressed in the XR reference space.
        this.v.set(pt.x, CAST_HEIGHT, pt.z);
        board.localToWorld(this.v);
        rig.worldToLocal(this.v);
        const ray = new XRRay({ x: this.v.x, y: this.v.y, z: this.v.z, w: 1 }, { x: 0, y: -1, z: 0, w: 0 });
        session
          .requestHitTestSource({ space: refSpace, offsetRay: ray })
          ?.then((source) => {
            if (probe.done || !this.running) source.cancel();
            else probe.source = source;
          })
          .catch(() => {
            this.supported = false; // feature not granted: stop asking
            probe.done = true;
          });
      }
      this.next += BATCH;
      return null;
    }

    let open = 0;
    for (const p of this.batch) {
      if (p.done) continue;
      p.age++;
      if (p.source) {
        const pose = frame.getHitTestResults(p.source)[0]?.getPose(refSpace);
        if (pose) {
          const t = pose.transform.position;
          this.v.set(t.x, t.y, t.z);
          rig.localToWorld(this.v);
          board.worldToLocal(this.v);
          p.sum += this.v.y;
          p.hits++;
        }
      }
      if (p.hits >= FRAMES_WANTED || p.age >= FRAMES_TIMEOUT) {
        p.done = true;
        p.source?.cancel();
        p.source = null;
        // A point under the player's hand would read as an object: leave it unknown.
        if (p.hits > 0 && !skip(p.x, p.z)) this.samples.push({ x: p.x, z: p.z, h: p.sum / p.hits });
      } else {
        open++;
      }
    }
    if (open === 0) this.batch = [];
    return null;
  }
}
