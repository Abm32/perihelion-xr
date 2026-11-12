/**
 * Self-measurement. Nobody on the project has a headset, so the app records
 * what it can observe about itself during any immersive session and keeps a
 * short report: frame rate, its own CPU cost, how steady the player's hand
 * was, and how noisy the real depth was. The report is shown on the page after
 * the session, so one screenshot from any tester is a measurement.
 *
 * Nothing is sent anywhere. The report lives in this browser's localStorage.
 */
const KEY = 'perihelion.perf';
const MAX = 7200; // 100 s at 72 Hz; older frames are overwritten

export interface PerfReport {
  when: string;
  device: string;
  seconds: number;
  frames: number;
  avgFps: number;
  /** Frame rate of the slowest 1% of frames. */
  low1Fps: number;
  /** Share of frames slower than 60 fps, in percent. */
  under60Pct: number;
  /** Display rate the session asked for, if the browser reports it. */
  targetFps: number;
  /** Mean and worst time spent in the game's own update, in milliseconds. */
  updateMsAvg: number;
  updateMsMax: number;
  /** 0 soft occlusion, 1 single tap, 2 off: how far the governor stepped down. */
  quality: number;
  /** Hand wobble while holding a pull still, RMS millimetres. */
  holdJitterMm: number;
  /** Median jump of the hand at the instant of release, millimetres. */
  releaseTwitchMm: number;
  shots: number;
  /** Depth noise measured on the desk surface, millimetres (0 = no scan). */
  depthNoiseMm: number;
}

export class PerfRecorder {
  quality = 0;
  targetFps = 0;
  depthNoise = 0;
  private dts = new Float32Array(MAX);
  private n = 0;
  private time = 0;
  private updateSum = 0;
  private updateMax = 0;
  private jitterSq = 0;
  private jitterN = 0;
  private twitches: number[] = [];
  private sinceSave = 0;

  frame(dt: number, updateMs: number): void {
    this.dts[this.n % MAX] = dt;
    this.n++;
    this.time += dt;
    this.updateSum += updateMs;
    if (updateMs > this.updateMax) this.updateMax = updateMs;
    this.sinceSave += dt;
    if (this.sinceSave > 10) this.save(); // a crash or a pulled-off headset still leaves a report
  }

  /** Deviation of the raw hand from its smoothed position while a pull is held nearly still. */
  hold(deviation: number): void {
    this.jitterSq += deviation * deviation;
    this.jitterN++;
  }

  release(deviation: number): void {
    this.twitches.push(deviation);
  }

  get fps(): number {
    const k = Math.min(this.n, 72);
    let sum = 0;
    for (let i = 0; i < k; i++) sum += this.dts[(this.n - 1 - i + MAX * 2) % MAX];
    return k && sum ? k / sum : 0;
  }

  report(): PerfReport | null {
    const count = Math.min(this.n, MAX);
    if (count < 120) return null; // under two seconds: not a session
    const sorted = Array.from(this.dts.subarray(0, count)).sort((a, b) => a - b);
    const sum = sorted.reduce((a, b) => a + b, 0);
    const twitch = [...this.twitches].sort((a, b) => a - b);
    const r1 = (v: number) => Math.round(v * 10) / 10;
    return {
      when: new Date().toISOString(),
      device:
        navigator.userAgent.match(/Quest[^;)]*|OculusBrowser\/[\d.]+/)?.[0] ??
        (/Android/.test(navigator.userAgent) ? 'Android phone' : 'desktop browser'),
      seconds: Math.round(this.time),
      frames: this.n,
      avgFps: r1(count / sum),
      low1Fps: r1(1 / sorted[Math.floor(count * 0.99)]),
      under60Pct: r1((sorted.filter((d) => d > 1 / 58).length / count) * 100),
      targetFps: this.targetFps,
      updateMsAvg: Math.round((this.updateSum / this.n) * 100) / 100,
      updateMsMax: r1(this.updateMax),
      quality: this.quality,
      holdJitterMm: this.jitterN ? r1(Math.sqrt(this.jitterSq / this.jitterN) * 1000) : 0,
      releaseTwitchMm: twitch.length ? r1(twitch[Math.floor(twitch.length / 2)] * 1000) : 0,
      shots: twitch.length,
      depthNoiseMm: r1(this.depthNoise * 1000),
    };
  }

  save(): void {
    this.sinceSave = 0;
    const report = this.report();
    if (!report) return;
    try {
      localStorage.setItem(KEY, JSON.stringify(report));
    } catch {
      // storage blocked: the report is simply not kept
    }
  }

  static last(): PerfReport | null {
    try {
      return JSON.parse(localStorage.getItem(KEY) ?? 'null');
    } catch {
      return null;
    }
  }

  /** One line a tester can screenshot or read aloud. */
  static line(r: PerfReport | null): string {
    if (!r) return '';
    const occlusion = ['soft occlusion', 'single-tap occlusion', 'occlusion off'][r.quality] ?? '';
    return (
      `Last session (${r.device}, ${r.seconds} s): ${r.avgFps} fps avg, 1% low ${r.low1Fps}, ` +
      `${r.under60Pct}% of frames under 60` +
      (r.targetFps ? `, target ${r.targetFps}` : '') +
      `; update ${r.updateMsAvg} ms; ${occlusion}` +
      (r.shots ? `; hand jitter ${r.holdJitterMm} mm, release twitch ${r.releaseTwitchMm} mm over ${r.shots} shots` : '') +
      (r.depthNoiseMm ? `; depth noise ${r.depthNoiseMm} mm` : '')
    );
  }
}
