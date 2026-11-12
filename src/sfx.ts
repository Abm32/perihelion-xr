/** Procedural Web Audio: no sample files. Every sound is one or two oscillators. */

let ctx: AudioContext | null = null;

/** Call from a user gesture (entering XR, first pinch) so the context may start. */
export function resumeAudio(): void {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
  } catch {
    ctx = null; // no audio device: the game stays playable, silent
  }
}

function tone(
  type: OscillatorType,
  from: number,
  to: number,
  duration: number,
  gain: number,
  delay = 0,
): void {
  if (!ctx || ctx.state !== 'running') return;
  const t = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  const amp = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(from, t);
  osc.frequency.exponentialRampToValueAtTime(to, t + duration);
  amp.gain.setValueAtTime(0.0001, t);
  amp.gain.exponentialRampToValueAtTime(gain, t + 0.01);
  amp.gain.exponentialRampToValueAtTime(0.0001, t + duration);
  osc.connect(amp).connect(ctx.destination);
  osc.start(t);
  osc.stop(t + duration + 0.02);
}

export const sfx = {
  grab: () => tone('sine', 330, 440, 0.12, 0.15),
  /** Band tension tick; `pull` is 0..1 and raises the pitch. */
  stretch: (pull: number) =>
    tone('triangle', 220 + pull * 440, 200 + pull * 400, 0.06, 0.08),
  launch: (power: number) =>
    tone('sawtooth', 180 + power * 500, 60, 0.35, 0.12),
  crash: () => tone('square', 140, 40, 0.3, 0.12),
  lost: () => tone('sine', 300, 90, 0.5, 0.1),
  hit: () => {
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) =>
      tone('sine', f, f, 0.5, 0.16, i * 0.09),
    );
  },
};
