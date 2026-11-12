/**
 * Perihelion visual effects. Everything is procedural: no textures on disk.
 *
 * Quest constraints that shaped these choices:
 * - No full-screen post-processing (true bloom is too expensive on a tiled
 *   mobile GPU), so glow is faked with additive billboard sprites.
 * - Transparent overdraw is the main cost, so particles are small points and
 *   the only large transparent surface is the gravity grid.
 */
import {
  AdditiveBlending,
  BackSide,
  BufferAttribute,
  BufferGeometry,
  Color,
  Group,
  Mesh,
  PlaneGeometry,
  Points,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
} from '@iwsdk/core';

const NOISE = /* glsl */ `
  float hash(vec3 p) {
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }
  float noise(vec3 x) {
    vec3 i = floor(x);
    vec3 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(hash(i), hash(i + vec3(1, 0, 0)), f.x),
          mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
      mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x),
          mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y),
      f.z);
  }
  float fbm(vec3 p) {
    float a = 0.5;
    float s = 0.0;
    for (int i = 0; i < 4; i++) {
      s += a * noise(p);
      p *= 2.03;
      a *= 0.5;
    }
    return s;
  }
  vec3 spinY(vec3 p, float a) {
    float c = cos(a);
    float s = sin(a);
    return vec3(c * p.x + s * p.z, p.y, -s * p.x + c * p.z);
  }
`;

// World-space normal and view vector. Meshes are only translated and uniformly
// scaled under the board root, so mat3(modelMatrix) keeps directions correct.
const SPHERE_VERT = /* glsl */ `
  varying vec3 vObj;
  varying vec3 vN;
  varying vec3 vV;
  varying vec3 vL;
  uniform vec3 uLight;
  void main() {
    vObj = position;
    vec4 world = modelMatrix * vec4(position, 1.0);
    vN = normalize(mat3(modelMatrix) * normal);
    vL = normalize(mat3(modelMatrix) * uLight);
    vV = normalize(cameraPosition - world.xyz);
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const sphere = new SphereGeometry(1, 48, 24);

/** Planet lit by the level's star: banded or mottled surface, terminator, thin atmosphere. */
export function makePlanet(hue: number, seed: number, light: Vector3): Group {
  const base = new Color().setHSL(hue, 0.55, 0.5);
  const alt = new Color().setHSL((hue + 0.08) % 1, 0.5, 0.25);
  const air = new Color().setHSL((hue + 0.5) % 1, 0.7, 0.7);
  const uniforms = {
    uTime: { value: 0 },
    uLight: { value: light },
    uBase: { value: base },
    uAlt: { value: alt },
    uAir: { value: air },
    uSeed: { value: seed * 37.0 },
    uBands: { value: seed > 0.5 ? 1 : 0 }, // gas giant or rocky world
  };
  const surface = new Mesh(
    sphere,
    new ShaderMaterial({
      uniforms,
      vertexShader: SPHERE_VERT,
      fragmentShader: /* glsl */ `
        ${NOISE}
        varying vec3 vObj; varying vec3 vN; varying vec3 vV; varying vec3 vL;
        uniform float uTime; uniform float uSeed; uniform float uBands;
        uniform vec3 uBase; uniform vec3 uAlt; uniform vec3 uAir;
        void main() {
          // Sample noise on the undeformed sphere direction, spun in the
          // shader so the mesh itself never rotates (keeps lighting simple).
          vec3 p = spinY(vObj, uTime * 0.25) + uSeed;
          float warp = fbm(p * 2.5);
          float bands = 0.5 + 0.5 * sin(vObj.y * 11.0 + warp * 5.0);
          float land = smoothstep(0.42, 0.62, fbm(p * 3.5 + warp));
          float m = mix(land, bands, uBands);
          vec3 albedo = mix(uAlt, uBase, m);
          albedo = mix(albedo, vec3(0.95), smoothstep(0.82, 0.95, abs(vObj.y)) * (1.0 - uBands));
          float ndl = dot(vN, vL);
          float day = smoothstep(-0.12, 0.35, ndl); // soft terminator
          vec3 col = albedo * (0.04 + day);
          float rim = pow(1.0 - max(dot(vN, vV), 0.0), 3.0);
          col += uAir * rim * (0.15 + day) * 0.8; // scattering is strongest at the limb
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    }),
  );
  // Second, larger back-face shell: brightest at the limb, fading outward.
  const shell = new Mesh(
    sphere,
    new ShaderMaterial({
      uniforms,
      side: BackSide,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      vertexShader: SPHERE_VERT,
      fragmentShader: /* glsl */ `
        varying vec3 vN; varying vec3 vV; varying vec3 vL;
        uniform vec3 uAir;
        void main() {
          float d = abs(dot(vN, vV));
          float glow = pow(smoothstep(0.0, 0.55, d), 1.6);
          float day = 0.25 + 0.75 * smoothstep(-0.3, 0.5, dot(-vN, vL));
          gl_FragColor = vec4(uAir, glow * day * 0.9); // alpha = intensity, see Particles
        }
      `,
    }),
  );
  shell.scale.setScalar(1.2);
  const group = new Group();
  group.add(surface, shell);
  group.userData.uniforms = uniforms;
  return group;
}

/** Star: boiling granulated surface, limb darkening. Corona is a sprite added by the caller. */
export function makeStar(hue: number): Mesh {
  const hot = new Color().setHSL(0.02 + hue * 0.12, 1, 0.55); // red dwarf to yellow
  const uniforms = { uTime: { value: 0 }, uLight: { value: new Vector3(0, 1, 0) }, uHot: { value: hot } };
  const star = new Mesh(
    sphere,
    new ShaderMaterial({
      uniforms,
      vertexShader: SPHERE_VERT,
      fragmentShader: /* glsl */ `
        ${NOISE}
        varying vec3 vObj; varying vec3 vN; varying vec3 vV;
        uniform float uTime; uniform vec3 uHot;
        void main() {
          vec3 p = spinY(vObj, uTime * 0.1) * 4.0;
          float cells = fbm(p + vec3(0.0, uTime * 0.35, 0.0));
          float flare = fbm(p * 2.2 - uTime * 0.5);
          float heat = clamp(cells * 1.3 + flare * 0.5 - 0.25, 0.0, 1.0);
          vec3 col = mix(uHot * 0.55, vec3(1.0, 0.96, 0.82), heat);
          float limb = 0.55 + 0.45 * pow(max(dot(vN, vV), 0.0), 0.6);
          gl_FragColor = vec4(col * limb * 1.25, 1.0);
        }
      `,
    }),
  );
  star.userData.uniforms = uniforms;
  return star;
}

/**
 * Rubber-sheet spacetime grid. Vertices sink by the same 1/r potential the
 * sim integrates, so what the player sees is what bends the comet.
 */
export function makeGravityGrid(radius: number) {
  const geo = new PlaneGeometry(radius * 2, radius * 2, 88, 88);
  geo.rotateX(-Math.PI / 2);
  const uniforms = {
    // xy = board xz, z = gravitational parameter (0 = unused slot)
    uBodies: { value: [new Vector3(), new Vector3(), new Vector3()] },
    // xy = board xz of the ring, z = seconds since the hit (<0 = idle)
    uRipple: { value: new Vector3(0, 0, -1) },
    uRadius: { value: radius },
  };
  const mesh = new Mesh(
    geo,
    new ShaderMaterial({
      uniforms,
      transparent: true,
      depthWrite: false,
      vertexShader: /* glsl */ `
        uniform vec3 uBodies[3];
        uniform vec3 uRipple;
        varying vec2 vP;
        varying float vDepth;
        void main() {
          vec3 p = position;
          float pot = 0.0;
          for (int i = 0; i < 3; i++) {
            vec2 q = p.xz - uBodies[i].xy;
            pot += uBodies[i].z / sqrt(dot(q, q) + 0.0009);
          }
          float dip = min(pot * 0.09, 0.046);
          float wave = 0.0;
          if (uRipple.z >= 0.0) {
            float front = length(p.xz - uRipple.xy) - uRipple.z * 0.4;
            wave = exp(-front * front * 1600.0) * 0.007 * max(0.0, 1.0 - uRipple.z / 1.4);
          }
          p.y += wave - dip;
          vP = position.xz;
          vDepth = dip / 0.046;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uRadius;
        varying vec2 vP;
        varying float vDepth;
        void main() {
          vec2 g = vP / 0.02;
          vec2 f = abs(fract(g - 0.5) - 0.5) / fwidth(g);
          float line = 1.0 - min(min(f.x, f.y), 1.0);
          float mask = 1.0 - smoothstep(0.9, 1.0, length(vP) / uRadius);
          vec3 ink = mix(vec3(0.22, 0.45, 1.0), vec3(1.0, 0.72, 0.35), vDepth);
          vec3 col = mix(vec3(0.012, 0.018, 0.04), ink, line * (0.3 + 0.7 * vDepth));
          gl_FragColor = vec4(col, mask * (0.6 + 0.3 * line));
        }
      `,
    }),
  );
  return { mesh, uniforms };
}

/** Fixed-size additive point pool. No allocation after construction. */
export class Particles {
  readonly points: Points;
  private pos: Float32Array;
  private vel: Float32Array;
  private col: Float32Array; // rgb + fade
  private size: Float32Array;
  private age: Float32Array;
  private life: Float32Array;
  private next = 0;

  constructor(private count = 384) {
    this.pos = new Float32Array(count * 3);
    this.vel = new Float32Array(count * 3);
    this.col = new Float32Array(count * 4);
    this.size = new Float32Array(count);
    this.age = new Float32Array(count);
    this.life = new Float32Array(count); // 0 = dead
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(this.pos, 3));
    geo.setAttribute('aColor', new BufferAttribute(this.col, 4));
    geo.setAttribute('aSize', new BufferAttribute(this.size, 1));
    this.points = new Points(
      geo,
      new ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        // ponytail: 900 px/m is a hand-tuned constant, not derived from the
        // eye viewport. Retune on device if sparks look too big or too small.
        vertexShader: /* glsl */ `
          attribute vec4 aColor;
          attribute float aSize;
          varying vec4 vColor;
          void main() {
            vColor = aColor;
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            gl_PointSize = aSize * 900.0 / -mv.z;
            gl_Position = projectionMatrix * mv;
          }
        `,
        fragmentShader: /* glsl */ `
          varying vec4 vColor;
          void main() {
            float d = length(gl_PointCoord - 0.5);
            float a = smoothstep(0.5, 0.0, d);
            // Alpha carries the intensity: in passthrough the framebuffer alpha decides
            // how much real world shows through, so alpha 1 would punch a black square.
            gl_FragColor = vec4(vColor.rgb, a * a * vColor.a);
          }
        `,
      }),
    );
    this.points.frustumCulled = false;
  }

  emit(
    x: number, y: number, z: number,
    vx: number, vy: number, vz: number,
    life: number, size: number,
    r: number, g: number, b: number,
  ): void {
    const i = this.next;
    this.next = (i + 1) % this.count;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.col[i * 4] = r; this.col[i * 4 + 1] = g; this.col[i * 4 + 2] = b; this.col[i * 4 + 3] = 1;
    this.size[i] = size;
    this.age[i] = 0;
    this.life[i] = life;
  }

  /** Radial burst in the board plane with a little lift. */
  burst(x: number, y: number, z: number, n: number, speed: number, life: number, r: number, g: number, b: number): void {
    for (let i = 0; i < n; i++) {
      const th = Math.random() * Math.PI * 2;
      const s = speed * (0.3 + Math.random() * 0.7);
      this.emit(
        x, y, z,
        Math.cos(th) * s, (Math.random() - 0.2) * s * 0.6, Math.sin(th) * s,
        life * (0.5 + Math.random() * 0.5), 0.004 + Math.random() * 0.005,
        r, g, b,
      );
    }
  }

  update(dt: number): void {
    for (let i = 0; i < this.count; i++) {
      if (this.life[i] === 0) continue;
      this.age[i] += dt;
      const k = 1 - this.age[i] / this.life[i];
      if (k <= 0) {
        this.life[i] = 0;
        this.col[i * 4 + 3] = 0;
        continue;
      }
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.col[i * 4 + 3] = k;
    }
    const a = this.points.geometry.attributes;
    a.position.needsUpdate = true;
    a.aColor.needsUpdate = true;
    a.aSize.needsUpdate = true;
  }
}
