// Dev-only: record the managed browser with Chrome's screencast (the real
// compositor output, the same picture `browser screenshot` takes).
//   REC_OUT=name REC_SECONDS=20 npx @iwsdk/cli browser run test/rec.mjs --timeout 60000 &
// Runs for REC_SECONDS while other CLI commands drive the emulated hands, then
// writes JPEG frames and an ffmpeg concat list with real frame timings to
// artifacts/rec/<name>/.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export default async function run({ cdp, workspaceRoot }) {
  const name = process.env.REC_OUT ?? 'clip';
  const seconds = Number(process.env.REC_SECONDS ?? 10);
  const dir = join(workspaceRoot, 'artifacts', 'rec', name);
  mkdirSync(dir, { recursive: true });
  const frames = [];
  const onFrame = (e) => {
    const file = `f${String(frames.length).padStart(5, '0')}.jpg`;
    writeFileSync(join(dir, file), Buffer.from(e.data, 'base64'));
    frames.push({ file, t: e.metadata.timestamp });
    cdp.send('Page.screencastFrameAck', { sessionId: e.sessionId }).catch(() => {});
  };
  cdp.on('Page.screencastFrame', onFrame);
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: 1280, maxHeight: 720, everyNthFrame: 1 });
  await new Promise((r) => setTimeout(r, seconds * 1000));
  await cdp.send('Page.stopScreencast');
  cdp.off?.('Page.screencastFrame', onFrame);
  const lines = ['ffconcat version 1.0'];
  frames.forEach((f, i) => {
    const d = i + 1 < frames.length ? frames[i + 1].t - f.t : 1 / 30;
    lines.push(`file ${f.file}`, `duration ${Math.max(0.001, d).toFixed(4)}`);
  });
  if (frames.length) lines.push(`file ${frames[frames.length - 1].file}`);
  writeFileSync(join(dir, 'list.txt'), lines.join('\n'));
  const span = frames.length > 1 ? frames[frames.length - 1].t - frames[0].t : 0;
  return `${name}: ${frames.length} frames over ${span.toFixed(1)} s (${(frames.length / Math.max(span, 0.001)).toFixed(1)} fps)`;
}
