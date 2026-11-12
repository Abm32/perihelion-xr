/**
 * Webcam hands for playing without a headset (`?camera=1`).
 *
 * MediaPipe Hand Landmarker runs in the page and turns each visible hand into
 * a board pointer: where the pinch point is, and whether thumb and index are
 * together. It exists so a person can feel the game with real, jittery hands:
 * pull strength, slow motion, planting gravity. It is a flat mapping from the
 * camera image to the board, not depth tracking, and not what a headset does.
 *
 * Video never leaves the page. The library and model are downloaded from
 * public CDNs on first use; nothing is uploaded.
 */
const BUNDLE = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs';
const WASM = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm';
const MODEL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

// Image span mapped onto the board, in meters: the full 54 cm board fits with room to drag off it.
const SPAN_X = 0.8;
const SPAN_Z = 0.6;
const PINCH_ON = 0.38; // thumb-index gap over palm length
const PINCH_OFF = 0.55; // wider to let go: hysteresis stops flicker

export type HandPointer = (id: number, x: number, z: number, down: boolean, seen: boolean) => void;

interface Landmark {
  x: number;
  y: number;
}

export async function startCameraHands(onHand: HandPointer): Promise<void> {
  const status = document.createElement('div');
  status.style.cssText =
    'position:fixed;left:12px;bottom:150px;z-index:10;padding:6px 10px;border-radius:8px;background:rgba(8,12,22,.88);color:#dfe8ff;font:13px system-ui,sans-serif';
  status.textContent = 'Starting camera…';
  const video = document.createElement('video');
  video.style.cssText =
    'position:fixed;left:12px;bottom:12px;z-index:10;width:176px;border-radius:10px;transform:scaleX(-1);opacity:.85';
  video.muted = true;
  video.playsInline = true;
  document.body.append(video, status);

  try {
    video.srcObject = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } });
    await video.play();
    status.textContent = 'Loading hand tracking…';
    const vision = await import(/* @vite-ignore */ BUNDLE);
    const files = await vision.FilesetResolver.forVisionTasks(WASM);
    const tracker = await vision.HandLandmarker.createFromOptions(files, {
      baseOptions: { modelAssetPath: MODEL, delegate: 'GPU' },
      runningMode: 'VIDEO',
      numHands: 2,
    });
    status.textContent = 'Pinch thumb and index to grab. Show both hands for two pointers.';

    const state = [0, 1].map(() => ({ x: 0, z: 0, down: false, seen: false }));
    let lastTime = -1;
    const tick = () => {
      requestAnimationFrame(tick);
      if (video.currentTime === lastTime) return;
      lastTime = video.currentTime;
      const result = tracker.detectForVideo(video, performance.now());
      const present = [false, false];
      const aspect = video.videoWidth / video.videoHeight;
      (result.landmarks as Landmark[][]).forEach((marks, i) => {
        // MediaPipe labels handedness for an unmirrored image, which matches the user's own hand in a selfie view.
        const id = result.handednesses?.[i]?.[0]?.categoryName === 'Left' ? 0 : 1;
        if (present[id]) return;
        present[id] = true;
        const [wrist, knuckle, thumb, index] = [marks[0], marks[5], marks[4], marks[8]];
        const gap = Math.hypot((thumb.x - index.x) * aspect, thumb.y - index.y);
        const palm = Math.hypot((wrist.x - knuckle.x) * aspect, wrist.y - knuckle.y) || 1;
        const s = state[id];
        s.down = s.down ? gap / palm < PINCH_OFF : gap / palm < PINCH_ON;
        // Mirror X so moving a hand right moves the pointer right. Down in the image is toward the player.
        const x = (0.5 - (thumb.x + index.x) / 2) * SPAN_X;
        const z = ((thumb.y + index.y) / 2 - 0.5) * SPAN_Z;
        const k = s.seen ? 0.5 : 1; // light smoothing; the first sample snaps
        s.x += (x - s.x) * k;
        s.z += (z - s.z) * k;
        s.seen = true;
      });
      state.forEach((s, id) => {
        if (!present[id]) {
          if (s.seen) onHand(id, s.x, s.z, false, false);
          s.seen = false;
          s.down = false;
        } else {
          onHand(id, s.x, s.z, s.down, true);
        }
      });
    };
    tick();
  } catch (error) {
    status.textContent = `Camera hands unavailable: ${(error as Error).message}. The mouse still works.`;
    video.remove();
  }
}
