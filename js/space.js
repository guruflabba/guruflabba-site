import * as THREE from 'three';
import { textToVoxels, SPRITES } from './pixels.js';

// The 3D background: rendered at a low resolution, then pushed through a
// dither + VHS shader so everything reads like a taped arcade attract screen.

const FOV = 50;
const CAM_Z = 60;
const STAR_DEPTH = 280;
const BG = 0x05040b;
const TAN = Math.tan(THREE.MathUtils.degToRad(FOV / 2));
const TITLE_CAPACITY = 1800;
const LAYERS = 3;
const EYE_EVENT_Z = -40;

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const damp = (a, b, lambda, dt) => a + (b - a) * (1 - Math.exp(-lambda * dt));
const rand = (a = 0, b = 1) => a + Math.random() * (b - a);
const easeOut = (p) => 1 - (1 - p) ** 3;
const easeInOut = (p) => (p < 0.5 ? 4 * p ** 3 : 1 - (-2 * p + 2) ** 3 / 2);

const POST_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const POST_FRAG = /* glsl */ `
  uniform sampler2D tScene;
  uniform vec2 uLow;
  uniform float uTime;
  uniform float uGlitch;
  uniform float uStatic;
  uniform float uLevels;
  uniform float uHue;
  uniform float uBandRate;
  uniform float uAlpha;
  varying vec2 vUv;

  float hash12(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * .1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }
  float bayer2(vec2 a) { a = floor(a); return fract(a.x / 2. + a.y * a.y * .75); }
  float bayer4(vec2 a) { return bayer2(.5 * a) * .25 + bayer2(a); }
  float bayer8(vec2 a) { return bayer4(.5 * a) * .25 + bayer2(a); }

  vec3 hueShift(vec3 c, float a) {
    const vec3 k = vec3(0.57735);
    float ca = cos(a);
    return c * ca + cross(k, c) * sin(a) + k * dot(k, c) * (1. - ca);
  }

  void main() {
    vec2 uv = vUv;
    float row = floor(uv.y * uLow.y);
    float tf = floor(uTime * 24.);

    // per-line wobble
    float shift = (hash12(vec2(row, tf)) - .5) / uLow.x * (.7 + uGlitch * 16.);

    // tracking band rolling up the screen
    float bandPos = fract(-uTime * uBandRate);
    float band = smoothstep(.05, 0., abs(uv.y - bandPos));
    shift += band * (hash12(vec2(row, tf * 1.7)) - .25) * .014;

    // torn blocks when glitching
    float blockRow = floor(uv.y * 22.);
    float tear = step(1. - uGlitch * .4, hash12(vec2(blockRow, tf)));
    shift += tear * (hash12(vec2(blockRow + 7., tf)) - .5) * .16 * uGlitch;
    uv.x += shift;

    vec2 px = floor(uv * uLow);
    vec2 suv = (px + .5) / uLow;
    float ca = (1. + uGlitch * 5. + band * 2.) / uLow.x;

    vec4 sr = texture2D(tScene, suv + vec2(ca, 0.));
    vec4 sg = texture2D(tScene, suv);
    vec4 sb = texture2D(tScene, suv - vec2(ca, 0.));
    vec3 col = vec3(sr.r, sg.g, sb.b);
    // with a transparent background, the colour-split fringes stay opaque
    float alpha = uAlpha > .5 ? max(sg.a, max(sr.a, sb.a)) : 1.;

    col = pow(max(col, 0.), vec3(1. / 2.2));
    if (uHue != 0.) col = clamp(hueShift(col, uHue), 0., 1.);

    col += band * .06;
    float n = hash12(px + fract(uTime * 7.) * vec2(97., 31.));
    col = mix(col, vec3(n) * vec3(.85, .9, 1.), clamp(uStatic, 0., 1.));

    // ordered dither down to a handful of levels per channel
    col = floor(col * (uLevels - 1.) + bayer8(px)) / (uLevels - 1.);

    // scanlines locked to the low-res rows
    float fy = fract(vUv.y * uLow.y);
    col *= .68 + .32 * sin(fy * 3.14159);

    col += (hash12(gl_FragCoord.xy + uTime * 61.) - .5) * .045;
    col += band * step(.992, hash12(vec2(floor(vUv.x * uLow.x * .5), tf))) * .6;

    vec2 q = vUv - .5;
    col *= 1. - dot(q, q) * 1.1;

    gl_FragColor = vec4(clamp(col, 0., 1.) * alpha, alpha);
  }
`;

const STAR_VERT = /* glsl */ `
  attribute float aEnd;
  attribute vec3 aColor;
  uniform float uTravel;
  uniform float uStreak;
  uniform float uDepth;
  varying vec3 vColor;
  void main() {
    float z = mod(position.z + uTravel, uDepth) - uDepth;
    z -= aEnd * uStreak;
    float fade = smoothstep(-uDepth, -uDepth * .55, z);
    vColor = aColor * fade * (1. - aEnd * .75);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position.xy, z, 1.);
  }
`;

const STAR_FRAG = /* glsl */ `
  varying vec3 vColor;
  void main() { gl_FragColor = vec4(vColor, 1.); }
`;

export function createSpace(canvas, {
  reducedMotion = false,
  anchors = {},
  // voxel text for each orientation
  text = { landscape: ['GURUFLABBA'], portrait: ['GURU', 'FLABBA'] },
  // [fraction of screen width, fraction of screen height] the text may fill
  fit = { landscape: [0.78, 0.2], portrait: [0.84, 0.27] },
  // 'anchored' keeps the eye behind anchors.eye; 'event' hides it until watcher();
  // 'solo' shows it centred on its own, eyeFit of the view (short side) wide
  eyeMode = 'anchored',
  eyeFit = 0.6,
  // solo eye position as fractions of the half-screen [x, y]
  eyeAt = [0, 0],
  // leave parts out of the scene: any of 'title', 'planet', 'stars', 'drifters'
  hide = [],
  // transparent background instead of space (logo renders)
  transparent = false,
  // close the gaps between the eye's blocks (at large sizes they read as stray black lines)
  eyeGapless = false,
  // fixed planet spot as fractions of the half-screen, { landscape: [x, y], portrait: [x, y] };
  // otherwise the planet follows anchors.planet
  planetAt = null,
  // seconds: every motion repeats exactly on this period, so a recording loops seamlessly
  loop = 0,
  // keep the drawn frame readable for screenshots (video capture)
  capture = false,
  // render stills: device pixel ratio for the canvas, and CSS px per dithered pixel
  pixelRatio = Math.min(window.devicePixelRatio || 1, 1.5),
  pixelScale = 0,
} = {}) {
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: transparent,
      antialias: false,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: capture,
    });
  } catch {
    return null;
  }

  // In loop mode, round each angular frequency / repeat period to fit the loop.
  const TAU = Math.PI * 2;
  const W = (w) => (loop ? (Math.round((w * loop) / TAU) * TAU) / loop : w);
  const fitPeriod = (p) => (loop ? loop / Math.max(1, Math.round(loop / p)) : p);
  const starBase = (() => {
    const base = reducedMotion ? 4 : 12;
    return loop ? (Math.max(1, Math.round((base * loop) / STAR_DEPTH)) * STAR_DEPTH) / loop : base;
  })();
  const loopGlitches = (() => {
    if (!loop) return null;
    const count = Math.max(1, Math.round(loop / 9));
    return Array.from({ length: count }, (_, i) => ({ at: ((i + rand(0.2, 0.8)) * loop) / count, amp: rand(0.25, 0.6) }));
  })();
  renderer.setClearColor(BG, transparent ? 0 : 1);
  renderer.setPixelRatio(pixelRatio);

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(BG, 150, 460);
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.5, 900);
  camera.position.set(0, 0, CAM_Z);

  const ambient = new THREE.AmbientLight(0x2a2d6e, 2.4);
  const key = new THREE.DirectionalLight(0xffe2b0, 3.6);
  key.position.set(-0.6, 0.9, 1);
  const rim = new THREE.DirectionalLight(0x3347ff, 5.5);
  rim.position.set(1, -0.55, 0.35);
  scene.add(ambient, key, rim);
  const rimBase = rim.color.clone();
  const rimTarget = rim.color.clone();

  const boxGeo = new THREE.BoxGeometry(0.9, 0.9, 0.9);
  const voxelMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  const dummy = new THREE.Object3D();
  const tmpColor = new THREE.Color();

  function buildSprite(def) {
    const cells = [];
    def.rows.forEach((row, y) => [...row].forEach((ch, x) => {
      const p = '#o*'.indexOf(ch);
      if (p >= 0) cells.push({ x, y, p });
    }));
    const w = Math.max(...def.rows.map((r) => r.length));
    const h = def.rows.length;
    const mesh = new THREE.InstancedMesh(boxGeo, voxelMat, cells.length);
    cells.forEach((c, i) => {
      dummy.position.set(c.x - w / 2 + 0.5, h / 2 - c.y - 0.5, 0);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.setScalar(1);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      mesh.setColorAt(i, tmpColor.setHex(def.palette[c.p]));
    });
    const g = new THREE.Group();
    g.add(mesh);
    return g;
  }

  // ---------- low-res target + post pass ----------
  const rt = new THREE.WebGLRenderTarget(2, 2, {
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    depthBuffer: true,
  });
  const post = new THREE.ShaderMaterial({
    uniforms: {
      tScene: { value: rt.texture },
      uLow: { value: new THREE.Vector2(2, 2) },
      uTime: { value: 0 },
      uGlitch: { value: 0 },
      uStatic: { value: 0 },
      uLevels: { value: 6 },
      uHue: { value: 0 },
      uBandRate: { value: loop ? Math.max(1, Math.round(0.05 * loop)) / loop : 0.05 },
      uAlpha: { value: transparent ? 1 : 0 },
    },
    vertexShader: POST_VERT,
    fragmentShader: POST_FRAG,
    depthTest: false,
    depthWrite: false,
  });
  const postScene = new THREE.Scene();
  const postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), post);
  quad.frustumCulled = false;
  postScene.add(quad);

  // ---------- warp starfield ----------
  const stars = (() => {
    const count = 1700;
    const pos = new Float32Array(count * 6);
    const col = new Float32Array(count * 6);
    const end = new Float32Array(count * 2);
    const tints = [0xeef2dd, 0xeef2dd, 0xeef2dd, 0xffd21f, 0x7d8bff, 0xff6a3d].map((c) => new THREE.Color(c));
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 4 + Math.pow(Math.random(), 0.6) * 130;
      const x = Math.cos(a) * r;
      const y = Math.sin(a) * r;
      const z = Math.random() * STAR_DEPTH;
      const c = tints[(Math.random() * tints.length) | 0];
      for (let v = 0; v < 2; v++) {
        const k = i * 2 + v;
        pos[k * 3] = x; pos[k * 3 + 1] = y; pos[k * 3 + 2] = z;
        col[k * 3] = c.r; col[k * 3 + 1] = c.g; col[k * 3 + 2] = c.b;
        end[k] = v;
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('aEnd', new THREE.BufferAttribute(end, 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: { uTravel: { value: 0 }, uStreak: { value: 1 }, uDepth: { value: STAR_DEPTH } },
      vertexShader: STAR_VERT,
      fragmentShader: STAR_FRAG,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
    });
    const lines = new THREE.LineSegments(geo, mat);
    lines.frustumCulled = false;
    scene.add(lines);
    return lines;
  })();

  // ---------- voxel text ----------
  // One big instanced mesh with spare capacity, so the text can morph into
  // other words: voxels get new homes, extras shrink away, new ones fly in.
  const FRONT_ROWS = [0xfff7b8, 0xffe766, 0xffd21f, 0xffbd1a, 0xff9f1a, 0xff801a, 0xff5e1c];
  const LAYER_COLORS = [null, 0xff3d1c, 0x9c1033];
  const C = TITLE_CAPACITY;
  const title = {
    group: new THREE.Group(),
    mesh: new THREE.InstancedMesh(boxGeo, voxelMat, C),
    base: text,
    current: text,
    active: 0,
    drawn: 0,
    width: 1,
    height: 1,
    clock: 0,
    scale: 0,
    tiltX: 0,
    tiltY: 0,
    spin: null,
    cleanupAt: 0,
    floatUntil: 0,
    gravityUntil: 0,
    anchorY: null,
    anchorX: 0,
    home: new Float32Array(C * 3),
    pos: new Float32Array(C * 3),
    vel: new Float32Array(C * 3),
    rot: new Float32Array(C * 2),
    rotVel: new Float32Array(C * 2),
    delay: new Float32Array(C),
    size: new Float32Array(C),
    sizeTarget: new Float32Array(C),
    color: new Float32Array(C * 3),
  };
  title.mesh.count = 0;
  title.mesh.frustumCulled = false;
  title.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  title.mesh.setColorAt(0, tmpColor.set(0xffffff));
  title.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
  title.group.add(title.mesh);
  scene.add(title.group);

  function buildHomes(lines) {
    const { voxels, width, height } = textToVoxels(lines);
    const homes = [];
    for (const v of voxels) {
      for (let l = 0; l < LAYERS; l++) {
        homes.push({ x: v.x, y: v.y, z: -l * 0.9, color: l === 0 ? FRONT_ROWS[v.row] : LAYER_COLORS[l] });
      }
    }
    return { homes: homes.slice(0, C), width, height };
  }

  function setHome(i, h) {
    const i3 = i * 3;
    title.home[i3] = h.x;
    title.home[i3 + 1] = h.y;
    title.home[i3 + 2] = h.z;
    tmpColor.setHex(h.color);
    title.color[i3] = tmpColor.r;
    title.color[i3 + 1] = tmpColor.g;
    title.color[i3 + 2] = tmpColor.b;
    title.sizeTarget[i] = 1;
  }

  // Throws every voxel deep into space; they fly home left to right.
  function scatterTitle() {
    title.clock = 0;
    title.floatUntil = 0;
    title.gravityUntil = 0;
    for (let i = 0; i < title.active; i++) {
      const i3 = i * 3;
      const hx = title.home[i3];
      const hy = title.home[i3 + 1];
      title.vel.fill(0, i3, i3 + 3);
      title.rotVel.fill(0, i * 2, i * 2 + 2);
      title.size[i] = 1;
      if (reducedMotion) {
        title.pos.set([hx, hy, title.home[i3 + 2]], i3);
        title.rot.fill(0, i * 2, i * 2 + 2);
        title.delay[i] = 0;
        continue;
      }
      title.pos[i3] = hx * 2.5 + rand(-50, 50);
      title.pos[i3 + 1] = hy * 2.5 + rand(-35, 35);
      title.pos[i3 + 2] = rand(-260, -140);
      title.rot[i * 2] = rand(-6, 6);
      title.rot[i * 2 + 1] = rand(-6, 6);
      title.delay[i] = 0.2 + ((hx + title.width / 2) / title.width) * 0.9 + rand(0, 0.25) - title.home[i3 + 2] * 0.05;
    }
  }

  function setText(lines) {
    const { homes, width, height } = buildHomes(lines);
    title.width = width;
    title.height = height;
    homes.forEach((h, i) => setHome(i, h));
    title.active = title.drawn = homes.length;
    title.mesh.count = homes.length;
    title.cleanupAt = 0;
    scatterTitle();
  }

  // shuffle: voxels swap places across the whole text (chaotic); off keeps
  // them near their old spots so quick changes (like a countdown) stay readable
  function morphText(lines, { shuffle = true, stagger = 0.35 } = {}) {
    const { homes, width, height } = buildHomes(lines);
    if (shuffle) {
      for (let k = homes.length - 1; k > 0; k--) {
        const j = (Math.random() * (k + 1)) | 0;
        [homes[k], homes[j]] = [homes[j], homes[k]];
      }
    }
    const prevDrawn = title.drawn;
    title.width = width;
    title.height = height;
    title.floatUntil = 0;
    title.gravityUntil = 0;

    homes.forEach((h, i) => {
      const i3 = i * 3;
      if (i >= prevDrawn) {
        title.pos[i3] = rand(-60, 60);
        title.pos[i3 + 1] = rand(-40, 40);
        title.pos[i3 + 2] = rand(-200, -120);
        title.vel.fill(0, i3, i3 + 3);
        title.size[i] = 1;
      }
      setHome(i, h);
      title.delay[i] = title.clock + rand(0, stagger);
    });

    for (let i = homes.length; i < prevDrawn; i++) {
      const i3 = i * 3;
      title.home[i3] = title.pos[i3] * 2.2 + rand(-20, 20);
      title.home[i3 + 1] = title.pos[i3 + 1] * 2.2 + rand(-15, 15);
      title.home[i3 + 2] = rand(-120, -60);
      title.sizeTarget[i] = 0;
      title.delay[i] = title.clock;
    }

    title.active = homes.length;
    title.drawn = Math.max(prevDrawn, homes.length);
    title.mesh.count = title.drawn;
    title.cleanupAt = clock + 1.6;
  }

  // Voxels rebuild in a left-to-right wave.
  function restagger(spread) {
    for (let i = 0; i < title.active; i++) {
      title.delay[i] = title.clock + ((title.home[i * 3] + title.width / 2) / title.width) * spread + rand(0, 0.15);
    }
  }

  function explode(power = 1) {
    if (reducedMotion) return;
    for (let i = 0; i < title.active; i++) {
      const i3 = i * 3;
      const dx = rand(-1, 1), dy = rand(-1, 1), dz = rand(0.2, 1.4);
      const m = rand(20, 65) * power / Math.hypot(dx, dy, dz);
      title.vel[i3] += dx * m; title.vel[i3 + 1] += dy * m; title.vel[i3 + 2] += dz * m;
      title.rotVel[i * 2] += rand(-25, 25);
      title.rotVel[i * 2 + 1] += rand(-25, 25);
    }
  }

  function fitScale() {
    const f = title.current.fit || fit;
    const [fw, fh] = view.portrait ? f.portrait : f.landscape;
    const visH = 2 * CAM_Z * TAN;
    const visW = visH * camera.aspect;
    return Math.min((visW * fw) / title.width, (visH * fh) / title.height);
  }

  // ---------- planet ----------
  const planet = new THREE.Group();
  const core = new THREE.Mesh(
    new THREE.IcosahedronGeometry(20, 1),
    new THREE.MeshLambertMaterial({ color: 0x1d2bff, flatShading: true }),
  );
  const shell = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(20.6, 1)),
    new THREE.LineBasicMaterial({ color: 0x8f9bff }),
  );
  const ring = (() => {
    const count = 1800;
    const pos = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    const tints = [0xffd21f, 0xff9f1a, 0xeef2dd, 0xff4a1c].map((c) => new THREE.Color(c));
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() < 0.64 ? rand(28, 35) : rand(37.5, 42);
      pos[i * 3] = Math.cos(a) * r;
      pos[i * 3 + 1] = rand(-0.4, 0.4);
      pos[i * 3 + 2] = Math.sin(a) * r;
      const c = tints[(Math.random() * tints.length) | 0];
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const pts = new THREE.Points(geo, new THREE.PointsMaterial({ size: 1.5, sizeAttenuation: false, vertexColors: true }));
    pts.rotation.set(1.18, 0, 0.38);
    return pts;
  })();
  const moon = new THREE.Mesh(
    new THREE.IcosahedronGeometry(3.4, 0),
    new THREE.MeshLambertMaterial({ color: 0xff4a1c, flatShading: true }),
  );
  planet.add(core, shell, ring, moon);
  planet.position.z = -160;
  planet.userData.baseY = -60;
  scene.add(planet);

  // ---------- the watcher ----------
  const eye = (() => {
    const group = new THREE.Group();
    const lid = new THREE.Group();
    group.add(lid);

    const a = 11.5, b = 8;
    const sclera = [];
    for (let y = -10; y <= 10; y++) {
      for (let x = -14; x <= 14; x++) {
        const e = (x / a) ** 2 + (y / b) ** 2;
        const lidEdge = (x / (a + 1.4)) ** 2 + (y / (b + 1.4)) ** 2;
        if (e <= 1) sclera.push({ x, y, z: 0, color: e > 0.72 ? 0xb8b39a : 0xeef2dd });
        else if (lidEdge <= 1) sclera.push({ x, y, z: 0.4, color: 0x9c1033 });
      }
    }
    const scleraMesh = new THREE.InstancedMesh(boxGeo, voxelMat, sclera.length);
    const cube = eyeGapless ? 1 / 0.9 : 1;
    sclera.forEach((c, i) => {
      dummy.position.set(c.x, c.y, c.z);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.setScalar(cube);
      dummy.updateMatrix();
      scleraMesh.setMatrixAt(i, dummy.matrix);
      scleraMesh.setColorAt(i, tmpColor.setHex(c.color));
    });

    // yellow iris, ember rim, vertical slit pupil
    const irisCells = [];
    for (let y = -5; y <= 5; y++) {
      for (let x = -5; x <= 5; x++) {
        const d = Math.hypot(x, y);
        if (d > 5.2) continue;
        let color = d > 4.3 ? 0xff4a1c : 0xffd21f;
        if ((x / 1.3) ** 2 + (y / 3.9) ** 2 <= 1) color = 0x05040b;
        if (x === -2 && y === 2) color = 0xffffff;
        irisCells.push({ x, y, color });
      }
    }
    const irisMesh = new THREE.InstancedMesh(boxGeo, voxelMat, irisCells.length);
    irisCells.forEach((c, i) => {
      dummy.position.set(c.x, c.y, 0);
      dummy.updateMatrix();
      irisMesh.setMatrixAt(i, dummy.matrix);
      irisMesh.setColorAt(i, tmpColor.setHex(c.color));
    });
    dummy.scale.setScalar(1);
    const iris = new THREE.Group();
    iris.add(irisMesh);
    iris.position.z = 0.9;

    lid.add(scleraMesh, iris);
    group.position.z = -50;
    group.userData.baseY = -200;
    group.visible = eyeMode !== 'event';
    scene.add(group);
    return { group, lid, iris, nextBlink: 3, blink: 0, blinks: true, eventScale: 1, soloScale: 1, eventStart: -1, eventDur: 0 };
  })();
  const look = { x: 0, y: 0, next: 0, fixed: null };

  // ---------- drifting voxel junk ----------
  const drifters = Object.values(SPRITES).map((def, idx) => {
    const g = buildSprite(def);
    scene.add(g);
    const baseSpeed = rand(3, 6) * (idx % 2 ? -1 : 1) * (reducedMotion ? 0.3 : 1);
    return {
      g,
      z: -25 - idx * 28 - rand(0, 10),
      baseSpeed,
      speed: baseSpeed,
      halfW: 100,
      x: 0,
      y: rand(-1, 1),
      seed: rand(0, 100),
    };
  });

  // ---------- saucer fleet (event) ----------
  const fleet = { group: new THREE.Group(), ships: [], start: -1, dur: 8, dir: 1 };
  fleet.group.visible = false;
  scene.add(fleet.group);

  const hidden = new Set(hide);
  title.group.visible = !hidden.has('title');
  planet.visible = !hidden.has('planet');
  stars.visible = !hidden.has('stars');
  for (const d of drifters) d.g.visible = !hidden.has('drifters');

  // ---------- state ----------
  const view = { w: 1, h: 1, upx: 1, portrait: null };
  const pointer = { x: 0, y: 0, sx: 0, sy: 0, active: false };
  const local = new THREE.Vector3(9999, 9999, 0);
  const raycaster = new THREE.Raycaster();
  const titlePlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
  const ndc = new THREE.Vector2();

  let clock = 0;
  let last = performance.now();
  let rafId = 0;
  let travel = 0;
  let scrollPrev = window.scrollY;
  let scrollSmooth = window.scrollY;
  let scrollVel = 0;
  let glitch = 0;
  let staticAmt = 0;
  let staticHoldUntil = 0;
  let boost = 0;
  let boostTarget = 0;
  let hyper = 0;
  let hyperUntil = 0;
  let rewindUntil = 0;
  let kick = 0;
  let live = false;
  let nextGlitch = rand(4, 9);
  let onTitleSize = null;

  window.addEventListener('pointermove', (e) => {
    pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
    pointer.y = -(e.clientY / window.innerHeight) * 2 + 1;
    pointer.active = true;
  }, { passive: true });
  window.addEventListener('pointerup', (e) => {
    if (e.pointerType !== 'mouse') pointer.active = false;
  }, { passive: true });
  document.documentElement.addEventListener('pointerleave', () => { pointer.active = false; });

  function docCenterY(el) {
    const r = el.getBoundingClientRect();
    return r.top + window.scrollY + r.height / 2;
  }

  function refreshAnchors() {
    const toWorldY = (docY) => -(docY - view.h / 2) * view.upx;
    if (anchors.title) {
      const y = toWorldY(docCenterY(anchors.title));
      if (title.anchorY === null) title.group.position.y = y;
      title.anchorY = y;
      const r = anchors.title.getBoundingClientRect();
      title.anchorX = (r.left + r.width / 2 - view.w / 2) * view.upx;
    }
    if (anchors.planet) planet.userData.baseY = toWorldY(docCenterY(anchors.planet));
    if (anchors.eye) eye.group.userData.baseY = toWorldY(docCenterY(anchors.eye));
  }

  function layout() {
    view.w = window.innerWidth;
    view.h = window.innerHeight;
    renderer.setSize(view.w, view.h, false);
    camera.aspect = view.w / view.h;
    camera.updateProjectionMatrix();

    const lowH = pixelScale ? Math.round(view.h / pixelScale) : Math.round(clamp(view.h / 2.7, 200, 360));
    const lowW = Math.max(2, Math.round((lowH * view.w) / view.h));
    rt.setSize(lowW, lowH);
    post.uniforms.uLow.value.set(lowW, lowH);

    const visH = 2 * CAM_Z * TAN;
    view.upx = visH / view.h;

    const portrait = view.w / view.h < 0.85;
    const flipped = portrait !== view.portrait;
    view.portrait = portrait;
    if (flipped) setText(portrait ? title.current.portrait : title.current.landscape);
    const scale = fitScale();
    if (flipped) title.scale = scale;
    onTitleSize?.((title.height * scale) / view.upx);

    const planetDist = CAM_Z - planet.position.z;
    const spot = planetAt && (portrait ? planetAt.portrait : planetAt.landscape);
    planet.position.x = planetDist * TAN * camera.aspect * (spot ? spot[0] : portrait ? 0.62 : 0.52);
    if (spot) planet.userData.baseY = planetDist * TAN * spot[1];
    const eyeDist = CAM_Z - eye.group.position.z;
    eye.group.scale.setScalar(clamp((eyeDist * TAN * camera.aspect) / 30, 0.7, 1.4));
    const evDist = CAM_Z - EYE_EVENT_Z;
    eye.eventScale = Math.min((2 * evDist * TAN * 0.58) / 19, (2 * evDist * TAN * camera.aspect * 0.9) / 27);
    eye.soloScale = (2 * evDist * TAN * Math.min(1, camera.aspect) * eyeFit) / 26;

    for (const d of drifters) {
      d.halfW = (CAM_Z - d.z) * TAN * camera.aspect + 14;
      d.x = rand(-d.halfW, d.halfW);
      // in loop mode each crossing takes a whole number of loops' worth of distance
      const range = 2 * d.halfW;
      d.speed = loop
        ? (Math.sign(d.baseSpeed) * Math.max(1, Math.round((Math.abs(d.baseSpeed) * loop) / range)) * range) / loop
        : d.baseSpeed;
    }

    refreshAnchors();
  }

  function updateTitle(dt, t) {
    const s = title;
    s.clock += dt;
    if (s.cleanupAt && clock > s.cleanupAt) {
      s.drawn = s.active;
      s.mesh.count = s.active;
      s.cleanupAt = 0;
    }
    const floating = s.floatUntil > clock;
    if (s.floatUntil && !floating) {
      s.floatUntil = 0;
      restagger(0.9);
    }
    const falling = s.gravityUntil > clock;
    if (s.gravityUntil && !falling) {
      s.gravityUntil = 0;
      restagger(1.1);
    }
    const floorY = falling ? (camera.position.y - CAM_Z * TAN + 1.4 - s.group.position.y) / s.scale : 0;

    const K = 42;
    const D = 7.2;
    const R = 7.5;
    const wave = reducedMotion ? 0.08 : 0.38;
    const wy = W(1.1);
    const wz = W(1.6);
    const sweepPeriod = fitPeriod(5.5);
    const cyc = (t % sweepPeriod) / sweepPeriod;
    const sweepX = cyc < 0.35 ? -s.width / 2 - 4 + (cyc / 0.35) * (s.width + 8) : 1e9;
    const usePointer = pointer.active && !reducedMotion && !floating;
    const mesh = s.mesh;
    // letters crumble to dust while the watcher is up
    const eyeT = clock - eye.eventStart;
    const sizeMul = eye.eventStart >= 0 && eyeT > 0.4 && eyeT < eye.eventDur - 1.6 ? 0.28 : 1;

    for (let i = 0; i < s.drawn; i++) {
      const i2 = i * 2;
      const i3 = i * 3;
      const hx = s.home[i3];
      const hy = s.home[i3 + 1];

      if (falling && i < s.active) {
        s.vel[i3 + 1] -= 70 * dt;
        const drag = 1 - 0.6 * dt;
        s.vel[i3] *= drag;
        s.vel[i3 + 2] *= drag;
        for (let k = 0; k < 3; k++) s.pos[i3 + k] += s.vel[i3 + k] * dt;
        if (s.pos[i3 + 1] < floorY) {
          s.pos[i3 + 1] = floorY;
          if (s.vel[i3 + 1] < 0) s.vel[i3 + 1] *= -0.42;
          s.vel[i3] *= 0.85;
          s.rotVel[i2] *= 0.7;
          s.rotVel[i2 + 1] *= 0.7;
        }
        s.rot[i2] += s.rotVel[i2] * dt;
        s.rot[i2 + 1] += s.rotVel[i2 + 1] * dt;
      } else if (s.clock > s.delay[i]) {
        let tx = hx;
        let ty = hy;
        let tz = s.home[i3 + 2];
        if (!floating && i < s.active) {
          ty += Math.cos(t * wy + hx * 0.15) * wave * 0.4;
          tz += Math.sin(t * wz + hx * 0.22 + hy * 0.1) * wave;
          if (usePointer) {
            const dx = hx - local.x;
            const dy = hy - local.y;
            const d = Math.hypot(dx, dy);
            if (d < R) {
              const f = (1 - d / R) ** 2;
              tz += f * 5.5;
              tx += (dx / (d + 0.001)) * f * 1.4;
              ty += (dy / (d + 0.001)) * f * 1.4;
            }
          }
        }
        const k = floating ? 0 : K;
        const dd = floating ? 1.1 : D;
        const targets = [tx, ty, tz];
        for (let j = 0; j < 3; j++) {
          const acc = (targets[j] - s.pos[i3 + j]) * k - s.vel[i3 + j] * dd;
          s.vel[i3 + j] += acc * dt;
          s.pos[i3 + j] += s.vel[i3 + j] * dt;
        }
        for (let j = 0; j < 2; j++) {
          const acc = floating
            ? -s.rotVel[i2 + j] * 0.3
            : -s.rot[i2 + j] * K * 0.5 - s.rotVel[i2 + j] * D * 0.7;
          s.rotVel[i2 + j] += acc * dt;
          s.rot[i2 + j] += s.rotVel[i2 + j] * dt;
        }
      } else {
        // waiting its turn: keep drifting and tumbling
        for (let j = 0; j < 3; j++) s.pos[i3 + j] += s.vel[i3 + j] * dt;
        const drag = 1 - 0.8 * dt;
        s.vel[i3] *= drag; s.vel[i3 + 1] *= drag; s.vel[i3 + 2] *= drag;
        s.rot[i2] += (s.rotVel[i2] + 2.5) * dt;
        s.rot[i2 + 1] += (s.rotVel[i2 + 1] + 1.7) * dt;
      }

      s.size[i] = damp(s.size[i], s.sizeTarget[i] * sizeMul, 6, dt);
      dummy.position.set(s.pos[i3], s.pos[i3 + 1], s.pos[i3 + 2]);
      dummy.rotation.set(s.rot[i2], s.rot[i2 + 1], 0);
      dummy.scale.setScalar(s.size[i]);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);

      tmpColor.setRGB(s.color[i3], s.color[i3 + 1], s.color[i3 + 2]);
      if (hyper > 0.01) {
        const r = tmpColor.r, g = tmpColor.g, b = tmpColor.b;
        tmpColor.setHSL((hx * 0.03 + hy * 0.02 + t * 0.6) % 1, 1, 0.55);
        tmpColor.setRGB(r + (tmpColor.r - r) * hyper, g + (tmpColor.g - g) * hyper, b + (tmpColor.b - b) * hyper);
      }
      const glow = Math.max(0, 1 - Math.abs(hx - sweepX) / 2.4);
      if (glow > 0) tmpColor.multiplyScalar(1 + glow * 1.8);
      mesh.setColorAt(i, tmpColor);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor.needsUpdate = true;
  }

  function update(dt) {
    clock += dt;
    const t = clock;

    // scroll
    const sy = window.scrollY;
    scrollVel = damp(scrollVel, (sy - scrollPrev) / dt, 8, dt);
    scrollPrev = sy;
    scrollSmooth = damp(scrollSmooth, sy, 14, dt);
    const scrollSpeed = Math.abs(scrollVel);

    // pointer + camera
    pointer.sx = damp(pointer.sx, pointer.x, 3, dt);
    pointer.sy = damp(pointer.sy, pointer.y, 3, dt);
    kick = damp(kick, 0, 5, dt);
    camera.position.x = pointer.sx * 3;
    camera.position.y = -scrollSmooth * view.upx + pointer.sy * 1.6;
    camera.position.z = CAM_Z - kick * 2.5;
    camera.rotation.z = damp(camera.rotation.z, reducedMotion ? 0 : clamp(-scrollVel * 0.00009, -0.07, 0.07), 4, dt);
    camera.updateMatrixWorld();

    // effects state
    const rewinding = rewindUntil > t;
    if (hyperUntil && t > hyperUntil) hyperUntil = 0;
    hyper = damp(hyper, hyperUntil ? 1 : 0, 2.5, dt);
    boost = damp(boost, boostTarget, 3, dt);
    if (loopGlitches) {
      // fixed glitch moments inside the loop instead of random ones
      const phase = t % loop;
      for (const g of loopGlitches) glitch = Math.max(glitch, g.amp * Math.exp(-((phase - g.at + loop) % loop) * 6));
    } else if (!reducedMotion && t > nextGlitch) {
      glitch = Math.max(glitch, rand(0.25, 0.6));
      nextGlitch = t + rand(5, 13);
    }
    if (rewinding) glitch = Math.max(glitch, 0.5);
    glitch = damp(glitch, 0, 5, dt);
    if (staticHoldUntil > t) staticAmt = Math.max(staticAmt, 0.85);
    staticAmt = damp(staticAmt, 0, 9, dt);
    rim.color.lerp(rimTarget, 1 - Math.exp(-5 * dt));

    // stars
    let speed = starBase + Math.min(scrollSpeed * 0.06, 140) + boost * 110 + hyper * 320 + kick * 150;
    if (rewinding) speed = -140;
    travel += speed * dt;
    stars.material.uniforms.uTravel.value = travel % (STAR_DEPTH * 400);
    stars.material.uniforms.uStreak.value = Math.sign(speed) * (0.5 + Math.abs(speed) * 0.05);
    stars.position.set(camera.position.x, camera.position.y, CAM_Z);

    // title
    title.scale = damp(title.scale, fitScale(), 4, dt);
    title.group.scale.setScalar(title.scale);
    title.tiltY = damp(title.tiltY, pointer.sx * 0.22, 4, dt);
    title.tiltX = damp(title.tiltX, -pointer.sy * 0.14 + clamp(scrollVel * 0.00015, -0.3, 0.3), 4, dt);
    let spinY = 0;
    if (title.spin) {
      const p = Math.min(1, (t - title.spin.start) / title.spin.dur);
      spinY = easeInOut(p) * title.spin.angle;
      if (p >= 1) title.spin = null;
    }
    title.group.rotation.set(title.tiltX, title.tiltY + spinY, 0);
    title.group.position.x = title.anchorX + (rewinding ? rand(-0.7, 0.7) : 0);
    if (title.anchorY !== null) title.group.position.y = damp(title.group.position.y, title.anchorY, 6, dt);
    title.group.updateMatrixWorld();
    ndc.set(pointer.x, pointer.y);
    raycaster.setFromCamera(ndc, camera);
    if (raycaster.ray.intersectPlane(titlePlane, local)) title.group.worldToLocal(local);
    updateTitle(dt, t);

    // planet
    core.rotation.y = t * W(0.12);
    shell.rotation.y = core.rotation.y;
    shell.rotation.x = core.rotation.x = Math.sin(t * W(0.1)) * 0.2;
    ring.rotation.y = t * W(0.05);
    const orbit = t * W(0.35);
    moon.position.set(Math.cos(orbit) * 48, Math.sin(orbit) * 10, Math.sin(orbit) * 48);
    moon.rotation.x = t * W(0.8);
    moon.rotation.y = t * W(0.5);
    planet.position.y = planet.userData.baseY + Math.sin(t * W(0.3)) * 2;
    if (live) {
      const p = 0.5 + 0.5 * Math.sin(t * W(5));
      ring.material.color.setRGB(1, 0.3 + 0.4 * p, 0.3 + 0.4 * p);
    } else {
      ring.material.color.setRGB(1, 1, 1);
    }

    // eye: follows the pointer, or glances around on its own
    if (look.fixed) {
      look.x = look.fixed.x;
      look.y = look.fixed.y;
    } else if (pointer.active) {
      look.x = pointer.x;
      look.y = pointer.y;
    } else if (t > look.next) {
      look.x = rand(-1, 1);
      look.y = rand(-1, 1);
      look.next = t + rand(0.6, 1.8);
    }
    const lookSpeed = pointer.active ? 6 : 12;
    eye.iris.position.x = damp(eye.iris.position.x, look.x * 5.2, lookSpeed, dt);
    eye.iris.position.y = damp(eye.iris.position.y, look.y * 2.4 + clamp(-scrollVel * 0.002, -1, 1), lookSpeed, dt);
    if (eye.blinks && t > eye.nextBlink) {
      eye.blink = 1;
      eye.nextBlink = t + rand(2.5, 6.5);
    }
    eye.blink = Math.max(0, eye.blink - dt * 5.5);
    eye.lid.scale.y = eye.blink > 0 ? Math.max(0.08, Math.abs(eye.blink * 2 - 1)) : 1;

    if (eyeMode === 'event') {
      const e = t - eye.eventStart;
      if (eye.eventStart < 0 || e > eye.eventDur) {
        eye.eventStart = -1;
        eye.group.visible = false;
      } else {
        const outAt = eye.eventDur - 1.5;
        const k = e < 1.8 ? easeOut(e / 1.8) : e > outAt ? 1 - easeInOut((e - outAt) / 1.5) : 1;
        eye.group.visible = true;
        eye.group.scale.setScalar(eye.eventScale);
        eye.group.position.set(0, camera.position.y + Math.sin(t * W(0.7)) * 1.2, THREE.MathUtils.lerp(-620, EYE_EVENT_Z, k));
      }
    } else if (eyeMode === 'solo') {
      const half = (CAM_Z - EYE_EVENT_Z) * TAN;
      eye.group.scale.setScalar(eye.soloScale);
      eye.group.position.set(half * camera.aspect * eyeAt[0], camera.position.y + half * eyeAt[1], EYE_EVENT_Z);
    } else {
      eye.group.position.y = eye.group.userData.baseY + Math.sin(t * W(0.7)) * 1.2;
    }

    // drifting junk
    for (const d of drifters) {
      d.x += d.speed * dt;
      if (d.x > d.halfW) d.x -= 2 * d.halfW;
      if (d.x < -d.halfW) d.x += 2 * d.halfW;
      const halfH = (CAM_Z - d.z) * TAN + 10;
      const rel = d.y * halfH - camera.position.y * 0.35;
      const wrapped = ((((rel + halfH) % (halfH * 2)) + halfH * 2) % (halfH * 2)) - halfH;
      d.g.position.set(d.x, camera.position.y + wrapped + Math.sin(t * W(0.8) + d.seed) * 1.5, d.z);
      d.g.rotation.set(Math.sin(t * W(0.5) + d.seed) * 0.5, t * W(0.7) + d.seed, Math.sin(t * W(0.3) + d.seed) * 0.25);
    }

    // fleet: two rows of saucers crossing in opposite directions
    if (fleet.start >= 0) {
      const p = (t - fleet.start) / fleet.dur;
      if (p > 1) {
        fleet.start = -1;
        fleet.group.visible = false;
      } else {
        const z = -70;
        const halfH = (CAM_Z - z) * TAN;
        const halfW = halfH * camera.aspect + 12;
        const spacing = 15;
        const perRow = Math.ceil(fleet.ships.length / 2);
        const travelDist = 2 * halfW + spacing * perRow;
        fleet.ships.forEach((g, k) => {
          const row = k % 2;
          const idx = Math.floor(k / 2);
          const dir = row ? -fleet.dir : fleet.dir;
          const x = (-halfW + p * travelDist - idx * spacing) * dir;
          const y = camera.position.y + (row ? -1 : 1) * halfH * 0.72 + Math.sin(t * W(3) + k * 0.9) * 2.2;
          g.position.set(x, y, z);
          g.rotation.set(Math.sin(t * W(2) + k) * 0.25, t * W(2.4) + k, 0.2 * dir);
        });
      }
    }

    // post
    const u = post.uniforms;
    u.uTime.value = t;
    u.uGlitch.value = (reducedMotion ? 0.2 : 1) * Math.min(1, glitch + Math.min(scrollSpeed / 5000, 0.3) + hyper * 0.15);
    u.uStatic.value = staticAmt;
    u.uHue.value = hyper > 0.01 ? hyper * t * 2.2 : 0;
  }

  function draw() {
    renderer.setRenderTarget(rt);
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);
    renderer.render(postScene, postCam);
  }

  function tick(now) {
    rafId = requestAnimationFrame(tick);
    update(Math.min(0.05, Math.max(0.001, (now - last) / 1000)));
    last = now;
    draw();
  }

  let autoRun = false;
  function start() {
    autoRun = true;
    if (rafId) return;
    last = performance.now();
    rafId = requestAnimationFrame(tick);
  }
  function stop() {
    cancelAnimationFrame(rafId);
    rafId = 0;
  }

  // Manual clock for frame-by-frame capture: simulate up to `time` in small steps, then draw once.
  function stepTo(time, maxStep = 1 / 60, drawFrame = true) {
    while (clock < time - 1e-9) update(Math.min(maxStep, time - clock));
    if (drawFrame) draw();
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stop();
    else if (autoRun) start();
  });
  window.addEventListener('resize', layout);

  const orientedLines = (spec) => (view.portrait ? spec.portrait : spec.landscape);

  return {
    set onTitleSize(fn) { onTitleSize = fn; },
    get time() { return clock; },
    start,
    stepTo,
    layout,
    refreshAnchors,
    explode,
    replayIntro() { if (title.active) scatterTitle(); },
    glitch(amount = 0.6) { glitch = Math.max(glitch, amount); },
    staticBurst(amount = 0.8) { staticAmt = Math.max(staticAmt, reducedMotion ? amount * 0.3 : amount); },
    staticHold(seconds = 1) { staticHoldUntil = clock + seconds; },
    setBoost(v) { boostTarget = reducedMotion ? 0 : v; },
    setAccent(hex) {
      if (hex) rimTarget.set(hex).multiplyScalar(1.2);
      else rimTarget.copy(rimBase);
    },
    setLive(v) { live = v; },
    // fix where the eye looks (-1..1 each way); null follows the pointer again
    setGaze(x, y) { look.fixed = x == null ? null : { x, y }; },
    setBlinking(on) {
      eye.blinks = on;
      if (!on) eye.blink = 0;
    },
    hyperspace(seconds = 8) { hyperUntil = clock + seconds; },
    // a beat: stars surge, the camera punches in and the voxel text thumps forward
    pulse(amount = 0.5) {
      if (reducedMotion) return;
      kick = Math.max(kick, amount);
      for (let i = 0; i < title.active; i++) {
        title.vel[i * 3 + 2] += amount * (7 + 5 * Math.sin(title.home[i * 3] * 0.35 + clock * 3));
      }
    },

    // --- events used by the stream screens ---
    // spec: { landscape: lines, portrait: lines, fit? } — fit overrides the size for that text
    setBase(spec) {
      title.base = spec;
      title.current = spec;
      morphText(orientedLines(spec));
    },
    morphTo(spec, options) {
      title.current = spec;
      morphText(orientedLines(spec), options);
    },
    morphBack() {
      title.current = title.base;
      morphText(orientedLines(title.base));
    },
    shatter(seconds = 4) {
      if (reducedMotion) return;
      title.gravityUntil = 0;
      explode(0.5);
      title.floatUntil = clock + seconds;
    },
    gravity(seconds = 4) {
      if (reducedMotion) return;
      title.floatUntil = 0;
      title.gravityUntil = clock + seconds;
      for (let i = 0; i < title.active; i++) {
        const i3 = i * 3;
        title.vel[i3] += rand(-5, 5);
        title.vel[i3 + 1] += rand(3, 14);
        title.vel[i3 + 2] += rand(-2, 2);
        title.rotVel[i * 2] += rand(-8, 8);
        title.rotVel[i * 2 + 1] += rand(-8, 8);
      }
    },
    spin(turns = 1, seconds = 1.6) {
      title.spin = { start: clock, dur: seconds, angle: turns * Math.PI * 2 };
    },
    rewind(seconds = 4) {
      rewindUntil = clock + seconds;
      title.spin = { start: clock, dur: seconds * 0.9, angle: -Math.PI * 2 };
    },
    watcher(seconds = 8) {
      eye.eventStart = clock;
      eye.eventDur = seconds;
    },
    fleet(seconds = 8) {
      if (!fleet.ships.length) {
        for (let k = 0; k < 8; k++) {
          const g = buildSprite(SPRITES.saucer);
          fleet.group.add(g);
          fleet.ships.push(g);
        }
      }
      fleet.start = clock;
      fleet.dur = seconds;
      fleet.dir = Math.random() < 0.5 ? 1 : -1;
      fleet.group.visible = true;
    },
  };
}
