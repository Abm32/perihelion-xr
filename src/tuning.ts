/**
 * Feel knobs. Defaults are what ships. With `?tune=1` a small panel of sliders
 * edits them live so a person can play and judge; values persist in
 * localStorage and can be copied out as JSON. Without `?tune=1` the stored
 * values are ignored, so a tuning session never leaks into normal play.
 */
import { HAND_GM } from './sim.js';

export const tune = {
  /** Slowest playback during a close pass (1 = no slow motion). */
  slowFloor: 0.3,
  /** Multiplier on the distance at which slow motion begins. */
  slowReach: 1,
  /** Pull of planted gravity. Empty-sky levels are verified at the default. */
  wellGm: HAND_GM,
  /** Seconds for one loop of the onboarding ghost. */
  ghostLoop: 3.4,
  /** Seconds of smoothing on the release point (hides the twitch of letting go). */
  releaseSmooth: 0.08,
};

const KEY = 'perihelion.tuning';
const RANGES: Record<keyof typeof tune, [number, number, number]> = {
  slowFloor: [0.1, 1, 0.05],
  slowReach: [0.5, 2.5, 0.1],
  wellGm: [0.002, 0.014, 0.0005],
  ghostLoop: [2, 6, 0.2],
  releaseSmooth: [0, 0.25, 0.01],
};

export function initTuning(): void {
  if (new URLSearchParams(location.search).get('tune') !== '1') return;
  try {
    Object.assign(tune, JSON.parse(localStorage.getItem(KEY) ?? '{}'));
  } catch {
    // unreadable storage: start from defaults
  }
  const panel = document.createElement('div');
  panel.style.cssText =
    'position:fixed;top:12px;right:12px;z-index:10;padding:12px 14px;border-radius:12px;background:rgba(8,12,22,.88);color:#dfe8ff;font:13px system-ui,sans-serif;width:250px';
  panel.innerHTML = '<b>Feel tuning</b>';
  for (const key of Object.keys(RANGES) as (keyof typeof tune)[]) {
    const [min, max, step] = RANGES[key];
    const row = document.createElement('label');
    row.style.cssText = 'display:block;margin-top:8px';
    const value = document.createElement('span');
    value.textContent = String(tune[key]);
    const input = document.createElement('input');
    Object.assign(input, { type: 'range', min, max, step, value: tune[key] });
    input.style.width = '100%';
    input.oninput = () => {
      tune[key] = Number(input.value);
      value.textContent = input.value;
      try {
        localStorage.setItem(KEY, JSON.stringify(tune));
      } catch {
        // keep going without persistence
      }
    };
    row.append(`${key} `, value, input);
    panel.append(row);
  }
  const copy = document.createElement('button');
  copy.textContent = 'Copy values';
  copy.style.cssText = 'margin-top:10px;width:100%;padding:6px;border-radius:8px;border:0;cursor:pointer';
  copy.onclick = () => {
    void navigator.clipboard?.writeText(JSON.stringify(tune));
    copy.textContent = 'Copied';
  };
  panel.append(copy);
  document.body.append(panel);
}
