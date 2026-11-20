/* Our World - a first look test: a little valley with our house, a lake, trees, a sun that
 * moves (day and night), and the two of us walking around together.
 * 3D engine: three.js. Models & textures come from the laptop (/game-assets/). */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { Sky } from 'three/addons/objects/Sky.js';
import { Water } from 'three/addons/objects/Water.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { plantTrees } from './trees.js';
import { buildLondon, photo, curtainTexture } from './london.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
// The setting: a rainy winter night in London (true), or the green valley (false).
const LONDON = true;
import { pose, stopPose, applyPoses, sound, cinematic, POSES } from './actions.js';

const $ = (id) => document.getElementById(id);
const store = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* private */ } } };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

// ---- Who am I? -------------------------------------------------------------------------
const myName = store.get('mn_name') || 'Guest';
let personal = { him: '', her: '', himLogins: [], herLogins: [] };
try { personal = await (await fetch('/api/personal', { cache: 'no-store' })).json(); } catch { /* offline */ }
const whoIs = (n) => {
  const x = String(n || '').toLowerCase();
  if ((personal.himLogins || []).some((y) => y.toLowerCase() === x) || (personal.him || '').toLowerCase() === x) return 'him';
  if ((personal.herLogins || []).some((y) => y.toLowerCase() === x) || (personal.her || '').toLowerCase() === x) return 'her';
  return null;
};
const petName = (n) => { const w = whoIs(n); return (w === 'him' && personal.him) || (w === 'her' && personal.her) || n; };
// Not set up yet: if he is already known, a new name is her.
const myKind = whoIs(myName) || ((personal.himLogins || []).length ? 'her' : 'him');

// ---- Quality ---------------------------------------------------------------------------
const isTouch = matchMedia('(pointer: coarse)').matches;
document.body.classList.toggle('is-touch', isTouch);
$('touch').classList.toggle('hidden', !isTouch);
const QUALITY = {
  // post: ambient occlusion (soft contact shadows) + light glow + smooth edges
  high: { pr: Math.min(devicePixelRatio, 1.5), shadows: true, shadowSize: 2048, water: true, trees: 260, grass: 26000, segs: 220, env: true, aa: false, far: 700, ao: true, bloom: true, smaa: true, clouds: true },
  medium: { pr: Math.min(devicePixelRatio, 1), shadows: true, shadowSize: 1024, water: true, trees: 160, grass: 8000, segs: 150, env: true, aa: true, far: 500, ao: false, bloom: true, smaa: false, clouds: true },
  low: { pr: Math.min(devicePixelRatio, 0.85), shadows: false, shadowSize: 512, water: false, trees: 90, grass: 0, segs: 90, env: false, aa: false, far: 320, ao: false, bloom: false, smaa: false, clouds: true },
};
const qName = store.get('mn_gq') || (isTouch || (navigator.hardwareConcurrency || 8) <= 4 ? 'low' : 'high');
const Q = QUALITY[qName] || QUALITY.medium;
$('quality').value = qName;
$('quality').onchange = () => { store.set('mn_gq', $('quality').value); location.reload(); };

// ---- Renderer, scene, camera ----------------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ canvas: $('view'), antialias: Q.aa, powerPreference: 'high-performance' });
renderer.setPixelRatio(Q.pr);
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.55;
renderer.shadowMap.enabled = Q.shadows;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
// Laptops with two graphics chips often run browsers on the weak built-in one (Intel) instead of
// the gaming one (NVIDIA / AMD). Say so, with how to fix it.
let gpuName = '';
try {
  const gl = renderer.getContext(), ext = gl.getExtension('WEBGL_debug_renderer_info');
  gpuName = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
} catch { /* unknown */ }
const weakGpu = /intel/i.test(gpuName) && !/arc/i.test(gpuName) && !isTouch;
if (weakGpu) {
  setTimeout(() => toast('⚠️ The game is running on the laptop\'s built-in Intel graphics, not the NVIDIA card, so it will be slow. Fix: Windows Settings → System → Display → Graphics → pick your browser (Chrome or Edge) → High performance, then restart the browser.', 25000), 3000);
}
let composer = null; // effects on High/Medium (set up once the scene and camera exist)
const labels = new CSS2DRenderer({ element: $('labels') });
labels.setSize(innerWidth, innerHeight);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xbfd4e6, 60, Q.far);
const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 3000);
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight); labels.setSize(innerWidth, innerHeight);
  if (composer) composer.setSize(innerWidth, innerHeight);
});
// Noir grade: colours drained to almost black & white, except warm light (lamps, windows) and
// strong reds (phone box, post box) which keep their colour; deeper contrast, cool shadows,
// a vignette and a little film grain.
const NoirShader = {
  uniforms: { tDiffuse: { value: null }, time: { value: 0 }, sat: { value: 0.22 }, contrast: { value: 1.14 } },
  vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform float time; uniform float sat; uniform float contrast; varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      float l = dot(c, vec3(0.299, 0.587, 0.114));
      float mx = max(c.r, max(c.g, c.b)), mn = min(c.r, min(c.g, c.b));
      float s = (mx - mn) / (mx + 1e-4);
      float lamp = clamp((c.r - c.b) * 2.0, 0.0, 1.0) * smoothstep(0.78, 1.0, mx);  // only the brightest warm light (lamps, windows)
      float red = smoothstep(0.45, 0.7, s) * step(c.g * 2.4, c.r) * smoothstep(0.2, 0.32, mx); // the phone box, the post box, lipstick
      vec3 g = mix(vec3(l), c, clamp(sat + max(lamp * 0.7, red * 0.9), 0.0, 1.0));
      g *= mix(vec3(0.86, 0.92, 1.06), vec3(1.0), smoothstep(0.0, 0.55, l)); // cool shadows
      g = (g - 0.5) * contrast + 0.5;
      vec2 d = vUv - 0.5; g *= 1.0 - dot(d, d) * 0.95;                // vignette
      g += (hash(vUv * 900.0 + time) - 0.5) * 0.035;                    // grain
      gl_FragColor = vec4(clamp(g, 0.0, 1.0), 1.0);
    }`,
};
let noirPass = null, aoPass = null;
// Keep it smooth: when the frame rate drops, draw at a lower resolution (then switch off the
// ambient-occlusion effect, the most expensive one); when there's room again, go back up.
let curPR = Q.pr, perfT = 0, perfFrames = 0;
function adaptQuality(dt) {
  perfT += dt; perfFrames++;
  if (perfT < 2) return;
  const fps = perfFrames / perfT; perfT = 0; perfFrames = 0;
  let pr = curPR;
  if (fps < 48) {
    if (pr > Q.pr * 0.6 + 0.01) pr = Math.max(Q.pr * 0.6, pr - 0.1);
    else if (aoPass && aoPass.enabled) aoPass.enabled = false;
  } else if (fps > 58 && pr < Q.pr) pr = Math.min(Q.pr, pr + 0.05);
  if (pr !== curPR) {
    curPR = pr;
    renderer.setPixelRatio(pr); renderer.setSize(innerWidth, innerHeight);
    if (composer) { composer.setPixelRatio(pr); composer.setSize(innerWidth, innerHeight); }
  }
}
function setupEffects() {
  if (LONDON) {
    composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    if (Q.ao) {
      const ao = new GTAOPass(scene, camera, innerWidth, innerHeight);
      ao.updateGtaoMaterial({ radius: 0.6, distanceExponent: 1.4, thickness: 1.2, scale: 1.1, samples: 12 });
      ao.blendIntensity = 0.85;
      // Rain, splashes, halos and pools are see-through: don't let them cast contact shadows.
      const aoRender = ao.render.bind(ao);
      ao.render = (...a) => {
        const hide = london.see.filter((o) => o.visible);
        for (const o of hide) o.visible = false;
        try { aoRender(...a); } finally { for (const o of hide) o.visible = true; }
      };
      composer.addPass(ao);
      aoPass = ao;
    }
    if (Q.bloom) composer.addPass(new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.4, 0.55, 0.82)); // lamps glow in the mist
    composer.addPass(new OutputPass());
    noirPass = new ShaderPass(NoirShader);
    composer.addPass(noirPass);
    if (Q.smaa) composer.addPass(new SMAAPass(innerWidth * renderer.getPixelRatio(), innerHeight * renderer.getPixelRatio()));
    return;
  }
  if (!Q.ao && !Q.bloom && !Q.smaa) return;
  composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  if (Q.ao) {
    const ao = new GTAOPass(scene, camera, innerWidth, innerHeight);
    ao.updateGtaoMaterial({ radius: 0.6, distanceExponent: 1.4, thickness: 1.2, scale: 1.1, samples: 12 });
    ao.blendIntensity = 0.85;
    composer.addPass(ao);
  }
  if (Q.bloom) composer.addPass(new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.22, 0.5, 0.92));
  composer.addPass(new OutputPass());
  if (Q.smaa) composer.addPass(new SMAAPass(innerWidth * renderer.getPixelRatio(), innerHeight * renderer.getPixelRatio()));
}

// ---- Loading ------------------------------------------------------------------------------------
const manager = new THREE.LoadingManager();
manager.onProgress = (_url, done, total) => { $('loadBar').style.width = `${Math.round((done / total) * 100)}%`; $('loadText').textContent = `Loading ${done} of ${total}…`; };
const texLoader = new THREE.TextureLoader(manager);
const tex = (name, repeat = 1, color = false) => {
  const t = texLoader.load(`/game-assets/${name}`);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  if (color) t.colorSpace = THREE.SRGBColorSpace;
  return t;
};

// ---- Terrain ------------------------------------------------------------------------------------
function hash(x, z) { const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453; return s - Math.floor(s); }
function noise(x, z) {
  const xi = Math.floor(x), zi = Math.floor(z), xf = x - xi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
  const a = hash(xi, zi), b = hash(xi + 1, zi), c = hash(xi, zi + 1), d = hash(xi + 1, zi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x, z) { let t = 0, amp = 1, f = 1; for (let i = 0; i < 4; i++) { t += amp * noise(x * f, z * f); amp *= 0.5; f *= 2; } return t / 1.875; }
const LAKE = new THREE.Vector2(62, -48), LAKE_R = 30, SIZE = 420;
function heightAt(x, z) {
  if (LONDON) return 0;
  const d = Math.hypot(x, z);
  let h = 0.8 + (fbm(x / 55 + 3, z / 55 - 2) - 0.5) * 9;
  h += smooth(110, 200, d) * 45 * fbm(x / 35 + 9, z / 35);              // mountains round the valley
  h = lerp(0.6, h, smooth(20, 34, d));                                   // flat garden for the house
  const dl = Math.hypot(x - LAKE.x, z - LAKE.y);
  h = lerp(-3.2, Math.max(h, 0.8), smooth(LAKE_R - 10, LAKE_R + 8, dl)); // the lake
  return h;
}
const terrainGeo = new THREE.PlaneGeometry(SIZE, SIZE, Q.segs, Q.segs);
terrainGeo.rotateX(-Math.PI / 2);
{
  const pos = terrainGeo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i), y = heightAt(x, z);
    pos.setY(i, y);
    // Lighter meadows, darker patches, sand by the water, rock on the mountains.
    const n = fbm(x / 18, z / 18);
    let c = new THREE.Color().setHSL(0.24 + n * 0.05, 0.45, 0.32 + n * 0.12);
    if (y < 1.1) c.lerp(new THREE.Color(0xc8b48a), smooth(1.1, 0.2, y));
    if (y > 12) c.lerp(new THREE.Color(0x8a8378), smooth(12, 26, y));
    colors.set([c.r, c.g, c.b], i * 3);
  }
  terrainGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  terrainGeo.computeVertexNormals();
}
const grassTex = tex('grass.jpg', 70, true);
const terrain = new THREE.Mesh(terrainGeo, new THREE.MeshStandardMaterial({ map: grassTex, vertexColors: true, roughness: 0.95, metalness: 0 }));
terrain.receiveShadow = true;
if (!LONDON) scene.add(terrain);

// ---- Water ----------------------------------------------------------------------------------------
let water = null;
if (Q.water) {
  const normals = texLoader.load('/game-assets/waternormals.jpg', (t) => { t.wrapS = t.wrapT = THREE.RepeatWrapping; });
  water = new Water(new THREE.CircleGeometry(LAKE_R + 14, 64), {
    textureWidth: 512, textureHeight: 512, waterNormals: normals, sunDirection: new THREE.Vector3(), sunColor: 0xffffff,
    waterColor: 0x0f3a4a, distortionScale: 2.2, fog: true,
  });
  water.rotation.x = -Math.PI / 2;
} else {
  water = new THREE.Mesh(new THREE.CircleGeometry(LAKE_R + 14, 48), new THREE.MeshStandardMaterial({ color: 0x1f5a6e, roughness: 0.15, metalness: 0.2, transparent: true, opacity: 0.88 }));
  water.rotation.x = -Math.PI / 2;
}
water.position.set(LAKE.x, 0, LAKE.y);
if (!LONDON) scene.add(water); else water = null; // (London has the Thames instead)

// ---- Sky, sun, moon, stars -------------------------------------------------------------------
const sky = new Sky();
sky.scale.setScalar(4000);
Object.assign(sky.material.uniforms, {});
sky.material.uniforms.turbidity.value = 6;
sky.material.uniforms.rayleigh.value = 1.6;
sky.material.uniforms.mieCoefficient.value = 0.004;
sky.material.uniforms.mieDirectionalG.value = 0.8;
if (!LONDON) scene.add(sky);
const sunLight = new THREE.DirectionalLight(0xfff1dc, 3);
sunLight.castShadow = Q.shadows;
sunLight.shadow.mapSize.set(Q.shadowSize, Q.shadowSize);
Object.assign(sunLight.shadow.camera, { left: -45, right: 45, top: 45, bottom: -45, near: 1, far: 260 });
sunLight.shadow.bias = -0.0004;
sunLight.shadow.normalBias = 0.04;
scene.add(sunLight, sunLight.target);
const moonLight = new THREE.DirectionalLight(0x8fa8ff, 0);
scene.add(moonLight, moonLight.target);
const hemi = new THREE.HemisphereLight(0xcfe3ff, 0x5a4a32, 0.6);
scene.add(hemi);
const stars = (() => {
  const g = new THREE.BufferGeometry();
  const p = new Float32Array(1500 * 3);
  for (let i = 0; i < 1500; i++) {
    const th = Math.random() * Math.PI * 2, ph = Math.acos(Math.random() * 0.95);
    p.set([Math.sin(ph) * Math.cos(th) * 1500, Math.cos(ph) * 1500, Math.sin(ph) * Math.sin(th) * 1500], i * 3);
  }
  g.setAttribute('position', new THREE.BufferAttribute(p, 3));
  const m = new THREE.PointsMaterial({ color: 0xffffff, size: 2.2, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false });
  return new THREE.Points(g, m);
})();
if (!LONDON) scene.add(stars);
// Clouds: a soft layer drifting overhead.
let clouds = null;
if (Q.clouds) {
  const cc = document.createElement('canvas'); cc.width = cc.height = 512;
  const g = cc.getContext('2d');
  const img = g.createImageData(512, 512);
  for (let y = 0; y < 512; y++) for (let x = 0; x < 512; x++) {
    // tileable noise: sample on a torus
    const a = (x / 512) * Math.PI * 2, b = (y / 512) * Math.PI * 2;
    const n = fbm(Math.cos(a) * 3 + 10, Math.sin(a) * 3 + Math.cos(b) * 3 + Math.sin(b) * 2.3);
    const v = clamp((n - 0.5) * 3.2, 0, 1);
    const i = (y * 512 + x) * 4;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = 255; img.data[i + 3] = Math.round(v * 235);
  }
  g.putImageData(img, 0, 0);
  const ct = new THREE.CanvasTexture(cc); ct.wrapS = ct.wrapT = THREE.RepeatWrapping;
  // Fades out toward the horizon so the layer has no visible edge.
  clouds = new THREE.Mesh(new THREE.PlaneGeometry(2400, 2400), new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { map: { value: ct }, offset: { value: new THREE.Vector2() }, tint: { value: new THREE.Color(1, 1, 1) }, opacity: { value: 1 } },
    vertexShader: 'varying vec2 vUv; varying float vD; void main() { vUv = uv; vD = length(position.xy); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'uniform sampler2D map; uniform vec2 offset; uniform vec3 tint; uniform float opacity; varying vec2 vUv; varying float vD;'
      + ' void main() { float a = texture2D(map, vUv * 3.0 + offset).a * opacity * (1.0 - smoothstep(450.0, 1100.0, vD)); gl_FragColor = vec4(tint, a); }',
  }));
  clouds.rotation.x = Math.PI / 2;
  clouds.position.y = LONDON ? 140 : 260;
  scene.add(clouds);
}
const pmrem = new THREE.PMREMGenerator(renderer);
const envScene = new THREE.Scene();
const envSky = new Sky();
envSky.scale.setScalar(1000);
envScene.add(envSky);
let envRT = null, nightEnv = null;

// ---- The house ------------------------------------------------------------------------------------
const colliders = []; // axis-aligned boxes: [minX, minZ, maxX, maxZ]
const circles = [];   // trees & rocks: [x, z, r]
const brick = new THREE.MeshStandardMaterial({ map: tex('brick_diffuse.jpg', 1, true), bumpMap: tex('brick_bump.jpg'), bumpScale: 2, roughnessMap: tex('brick_roughness.jpg'), roughness: 1, color: 0xf2e2d6 });
if (LONDON) { photo(brick, 'red_brick_03', 1.0, { rough: 0.8 }); brick.color.set(0xc8b8b0); } // same London brick as the floors above
const wood = new THREE.MeshStandardMaterial({ map: tex('wood_diffuse.jpg', 1, true), bumpMap: tex('wood_bump.jpg'), bumpScale: 1, roughnessMap: tex('wood_roughness.jpg'), roughness: 1 });
const roofMat = new THREE.MeshStandardMaterial({ color: 0x4a3a36, roughness: 0.85, roughnessMap: tex('disturb.jpg', 3) });
const trimMat = new THREE.MeshStandardMaterial({ color: 0xf6eedf, roughness: 0.6 });
const windowMat = new THREE.MeshStandardMaterial({ color: 0x2a3a4c, roughness: 0.04, metalness: 0.7, emissive: 0xffb45c, emissiveIntensity: 0 });
if (LONDON) { windowMat.emissive.set(0xffe0b8); windowMat.emissiveMap = curtainTexture(); }
const frameWhite = new THREE.MeshStandardMaterial({ color: 0xe9e6dc, roughness: 0.6 });
const house = new THREE.Group();
const HX = 0, HZ = 0, HY = heightAt(HX, HZ);
house.position.set(HX, HY, HZ);
scene.add(house);
function box(w, h, d, mat, x, y, z, { collide = false, shadow = true, repeat } = {}) {
  const g = new THREE.BoxGeometry(w, h, d);
  if (repeat) { const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * repeat[0], uv.getY(i) * repeat[1]); }
  const m = new THREE.Mesh(g, mat);
  m.position.set(x, y, z);
  m.castShadow = shadow; m.receiveShadow = true;
  house.add(m);
  if (collide) colliders.push([HX + x - w / 2, HZ + z - d / 2, HX + x + w / 2, HZ + z + d / 2]);
  return m;
}
const W = 11, D = 8.5, H = 3.1, T = 0.28;
/** Where your feet go: the ground, or the house's step / floor (you used to sink through it). */
function groundAt(x, z) {
  const dx = Math.abs(x - HX), dz = Math.abs(z - HZ);
  if (dx <= W / 2 - 0.1 && dz <= D / 2 - 0.1) return HY + 0.4;   // floorboards
  if (dx <= W / 2 + 0.3 && dz <= D / 2 + 0.3) return HY + 0.35;  // the stone step round the house
  return london ? london.groundAt(x, z) : heightAt(x, z);
}
box(W + 0.6, 0.35, D + 0.6, trimMat, 0, 0.17, 0, { shadow: false });                              // foundation
box(W - 0.2, 0.06, D - 0.2, wood, 0, 0.37, 0, { shadow: false, repeat: [3, 3] });                    // floor
box(W, H, T, brick, 0, H / 2 + 0.35, -D / 2, { collide: true, repeat: [3, 1] });                     // back wall
box(T, H, D, brick, -W / 2, H / 2 + 0.35, 0, { collide: true, repeat: [2.4, 1] });                   // left wall
box(T, H, D, brick, W / 2, H / 2 + 0.35, 0, { collide: true, repeat: [2.4, 1] });                    // right wall
const doorW = 1.5;
box((W - doorW) / 2, H, T, brick, -(W + doorW) / 4, H / 2 + 0.35, D / 2, { collide: true, repeat: [1.4, 1] }); // front, left of door
box((W - doorW) / 2, H, T, brick, (W + doorW) / 4, H / 2 + 0.35, D / 2, { collide: true, repeat: [1.4, 1] });  // front, right of door
box(doorW, 0.7, T, brick, 0, H + 0.35 - 0.35, D / 2, { repeat: [0.4, 0.25] });                         // over the door
const door = box(doorW - 0.1, 2.35, 0.08, wood, 0, 1.55, D / 2 + 0.6, { shadow: true });
door.rotation.y = -1.2; door.position.x = -0.55;
if (LONDON) {
  // A glossy black London front door, opening inwards (not out over the pavement).
  door.material = new THREE.MeshStandardMaterial({ color: 0x0e0f12, roughness: 0.25, metalness: 0.2 });
  door.rotation.y = 1.25; door.position.set(-0.45, 1.55, D / 2 - 0.68);
}
for (const [x, z, ry] of [[-3, D / 2 + 0.16, 0], [3, D / 2 + 0.16, 0], [-W / 2 - 0.16, -1.5, Math.PI / 2], [W / 2 + 0.16, 1.5, Math.PI / 2], [-2.5, -D / 2 - 0.16, 0], [2.5, -D / 2 - 0.16, 0]]) {
  const fr = box(1.7, 1.4, 0.1, trimMat, x, 2.0, z, { shadow: false }); fr.rotation.y = ry;
  const gl = box(1.45, 1.15, 0.12, windowMat, x, 2.0, z, { shadow: false }); gl.rotation.y = ry;
  if (LONDON && ry === 0) { // sash bars, like the windows next door
    const zz = z + Math.sign(z) * 0.07;
    for (const bx of [-0.24, 0.24]) box(0.03, 1.15, 0.03, frameWhite, x + bx, 2.0, zz, { shadow: false });
    box(1.45, 0.06, 0.04, frameWhite, x, 2.0, zz, { shadow: false });
  }
}
// Gable roof (in London the house becomes a terraced house with floors above instead)
if (!LONDON) {
const roofRun = W / 2 + 0.8, pitch = 0.55, slab = (D / 2 + 0.7) / Math.cos(pitch);
for (const s of [-1, 1]) {
  // The roof passes through the top of the walls and overhangs them by 0.7.
  const cz = (D / 2 + 0.7) / 2;
  const r = box(W + 1.6, 0.18, slab, roofMat, 0, H + 0.35 + 0.09 + Math.tan(pitch) * (D / 2 - cz), s * cz);
  r.rotation.x = s * pitch;
}
const gableShape = new THREE.Shape([new THREE.Vector2(-D / 2, 0), new THREE.Vector2(D / 2, 0), new THREE.Vector2(0, Math.tan(pitch) * (D / 2))]);
for (const s of [-1, 1]) {
  const g = new THREE.Mesh(new THREE.ExtrudeGeometry(gableShape, { depth: T, bevelEnabled: false }), brick);
  g.rotation.y = Math.PI / 2;
  g.position.set(s * W / 2 - T / 2, H + 0.35, 0);
  g.castShadow = true;
  house.add(g);
}
void roofRun;
}
// Inside: rug, sofa, TV with our names, bed, lamp
const rug = box(4, 0.02, 2.6, new THREE.MeshStandardMaterial({ color: 0xe7a9a0, roughness: 1 }), -1, 0.41, 0.6, { shadow: false });
void rug;
const sofaMat = new THREE.MeshStandardMaterial({ color: 0xd9c4a5, roughness: 0.95 });
box(3.2, 0.5, 1, sofaMat, -1, 0.65, 2.4, { collide: true });
box(3.2, 0.8, 0.25, sofaMat, -1, 1.05, 2.85);
const tvCanvas = document.createElement('canvas'); tvCanvas.width = 512; tvCanvas.height = 288;
{
  const g = tvCanvas.getContext('2d');
  const grd = g.createLinearGradient(0, 0, 512, 288); grd.addColorStop(0, '#3a2430'); grd.addColorStop(1, '#b2606b');
  g.fillStyle = grd; g.fillRect(0, 0, 512, 288);
  g.fillStyle = '#fff4d6'; g.font = 'bold 44px Georgia'; g.textAlign = 'center';
  g.fillText(`${personal.him || 'Daddy'} & ${personal.her || 'Dolly'}`, 256, 130);
  g.font = '28px Georgia'; g.fillText('🎬 Movie Night', 256, 190);
}
const tvTex = new THREE.CanvasTexture(tvCanvas); tvTex.colorSpace = THREE.SRGBColorSpace;
box(2.4, 1.4, 0.12, new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.3 }), -1, 1.75, -D / 2 + 0.3);
box(2.25, 1.27, 0.02, new THREE.MeshBasicMaterial({ map: tvTex }), -1, 1.75, -D / 2 + 0.37, { shadow: false });
box(2.2, 0.6, 2.8, new THREE.MeshStandardMaterial({ color: 0xf6eedf, roughness: 0.9 }), 3.6, 0.7, -2.2, { collide: true }); // bed
box(2.2, 0.25, 0.9, new THREE.MeshStandardMaterial({ color: 0xb2606b, roughness: 0.9 }), 3.6, 1.1, -1.1);                   // blanket
const lampLight = new THREE.PointLight(0xffc77a, 0, 14, 1.6);
lampLight.position.set(1, 2.8, 0);
house.add(lampLight);
const porchLight = new THREE.PointLight(0xffb85c, 0, 12, 1.6);
porchLight.position.set(1.2, 2.9, D / 2 + 0.5);
house.add(porchLight);
box(0.25, 0.25, 0.25, new THREE.MeshStandardMaterial({ color: 0xfff1c9, emissive: 0xffc77a, emissiveIntensity: 0 }), 1.2, 2.9, D / 2 + 0.28, { shadow: false });
const porchBulb = house.children[house.children.length - 1];
// A path from the door
const pathTex = tex('grass.jpg', 1, true); pathTex.repeat.set(0.6, 4);
const path = new THREE.Mesh(new THREE.PlaneGeometry(2, 14), new THREE.MeshStandardMaterial({ color: 0x9a7a58, roughness: 1, map: pathTex }));
path.rotation.x = -Math.PI / 2; path.position.set(HX, HY + 0.03, HZ + D / 2 + 7.2); path.receiveShadow = true;
if (!LONDON) scene.add(path);

// ---- London --------------------------------------------------------------------------------------
const london = LONDON ? buildLondon({ scene, Q, qName, tex, colliders, circles, house: { HX, HZ, W, D, TOP: H + 0.35 } }) : null;
if (london) {
  water = london.water;
  scene.fog = new THREE.Fog(0x0b0d12, 12, lowQ() ? 120 : 170);
}
function lowQ() { return qName === 'low'; }

// ---- Trees & rocks (instanced: one draw call each) --------------------------------------------
if (!LONDON) {
  const rnd = (() => { let s = 1234567; return () => ((s = (s * 16807) % 2147483647) / 2147483647); })();
  const spots = [];
  for (let tries = 0; spots.length < Q.trees && tries < 6000; tries++) {
    const x = (rnd() - 0.5) * SIZE * 0.85, z = (rnd() - 0.5) * SIZE * 0.85;
    const d = Math.hypot(x, z);
    if (d < 26 || Math.hypot(x - LAKE.x, z - LAKE.y) < LAKE_R + 6 || (Math.abs(x) < 3 && z > 0 && z < 20)) continue;
    if (heightAt(x, z) > 20) continue;
    spots.push([x, z, 0.75 + rnd() * 0.7]);
  }
  // Real branches and leaves (see trees.js); higher up the hills it's mostly pines.
  plantTrees(scene, spots.map(([x, z, sc], i) => [x, heightAt(x, z) - 0.15, z, sc, (heightAt(x, z) > 6 || i % 3 === 0) ? 2 + (i % 2) : i % 2]), qName);
  for (const [x, z, sc] of spots) circles.push([x, z, 0.4 * sc]);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), c = new THREE.Color();
  // Rocks
  const rockGeo = new THREE.DodecahedronGeometry(1, 1);
  { const p = rockGeo.attributes.position; for (let i = 0; i < p.count; i++) { const v = new THREE.Vector3().fromBufferAttribute(p, i); v.multiplyScalar(1 + (noise(v.x * 2 + 9, v.z * 2 + v.y) - 0.5) * 0.5); p.setXYZ(i, v.x, v.y * 0.6, v.z); } rockGeo.computeVertexNormals(); }
  const rocks = new THREE.InstancedMesh(rockGeo, new THREE.MeshStandardMaterial({ color: 0x8b8680, roughness: 0.95, map: tex('disturb.jpg', 1) }), 60);
  for (let i = 0; i < 60; i++) {
    let x, z; do { x = (rnd() - 0.5) * SIZE * 0.8; z = (rnd() - 0.5) * SIZE * 0.8; } while (Math.hypot(x, z) < 24);
    const s = 0.4 + rnd() * 1.4;
    m.compose(new THREE.Vector3(x, heightAt(x, z) - 0.2 * s, z), q.setFromEuler(new THREE.Euler(rnd(), rnd() * 6, rnd())), sc.set(s, s, s));
    rocks.setMatrixAt(i, m);
    if (s > 0.8) circles.push([x, z, 0.8 * s]);
  }
  rocks.castShadow = true; rocks.receiveShadow = true; scene.add(rocks);
  // Grass tufts around the house (high quality only)
  if (Q.grass) {
    const blade = new THREE.PlaneGeometry(0.08, 0.5, 1, 2);
    blade.translate(0, 0.25, 0);
    { const p = blade.attributes.position; for (let i = 0; i < p.count; i++) if (p.getY(i) > 0.4) p.setX(i, 0); }
    // Light the blades like the ground they grow from (not like flat cards facing sideways).
    { const n = blade.attributes.normal; for (let i = 0; i < n.count; i++) n.setXYZ(i, 0, 1, 0); }
    const grass = new THREE.InstancedMesh(blade, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, side: THREE.DoubleSide }), Q.grass);
    for (let i = 0; i < Q.grass; i++) {
      let x, z; do { const a = rnd() * Math.PI * 2, r = 9 + Math.sqrt(rnd()) * 55; x = Math.cos(a) * r; z = Math.sin(a) * r; } while (Math.hypot(x - LAKE.x, z - LAKE.y) < LAKE_R + 2 || (Math.abs(x) < 1.4 && z > 4 && z < 20));
      const s = 0.6 + rnd() * 0.9;
      m.compose(new THREE.Vector3(x, heightAt(x, z), z), q.setFromEuler(new THREE.Euler((rnd() - 0.5) * 0.4, rnd() * 6, (rnd() - 0.5) * 0.4)), sc.set(s, s, s));
      grass.setMatrixAt(i, m);
      grass.setColorAt(i, c.setHSL(0.23 + rnd() * 0.06, 0.55, 0.09 + rnd() * 0.08));
    }
    grass.receiveShadow = true;
    scene.add(grass);
  }
}

// ---- The two of us ---------------------------------------------------------------------------
const gltf = new GLTFLoader(manager);
const [soldier, michelle, xbot] = await Promise.all([gltf.loadAsync('/game-assets/Soldier.glb'), gltf.loadAsync('/game-assets/Michelle.glb'),
  gltf.loadAsync('/game-assets/Xbot.glb').catch(() => null)]);
/** Mixamo characters can name bones "mixamorig1:Hips", "mixamorig5:Hips"…: make them all "mixamorigHips". */
function normalizeRig(obj) {
  const fix = (n) => n.replace(/^mixamorig\d*:?/i, 'mixamorig');
  obj.traverse((o) => { if (o.name) o.name = fix(o.name); });
  for (const a of obj.animations || []) for (const t of a.tracks) t.name = fix(t.name);
  return obj;
}
// Your own characters, if you've put them in game-assets\\Characters (him.fbx / her.fbx or .glb).
const CUSTOM = {};
const CHAR_NOTES = []; // shown on screen once the game starts
try {
  const list = await (await fetch('/api/game/characters', { cache: 'no-store' })).json();
  for (const who of ['him', 'her']) {
    if (!list[who]) continue;
    try {
      const loaded = /\.glb$/i.test(list[who].split('?')[0]) ? (await gltf.loadAsync(list[who])).scene : await new FBXLoader(manager).loadAsync(list[who]);
      normalizeRig(loaded);
      // FBX characters come with "Phong" materials, which ignore the sky's soft light: out of
      // the sun they went almost black. Use the same physically-based material as the world.
      loaded.traverse((o) => {
        if (!o.isMesh) return;
        const conv = (m) => {
          if (!m || m.isMeshStandardMaterial) return m;
          if (m.map) m.map.colorSpace = THREE.SRGBColorSpace;
          const n = new THREE.MeshStandardMaterial({
            name: m.name, map: m.map || null, normalMap: m.normalMap || null, alphaMap: m.alphaMap || null,
            color: m.map ? 0xffffff : (m.color || new THREE.Color(0xcccccc)), roughness: 0.75, metalness: 0,
            transparent: !!m.transparent, opacity: m.opacity ?? 1, alphaTest: m.alphaTest || (m.transparent ? 0.3 : 0), side: m.side,
          });
          if (m.emissiveMap) { n.emissiveMap = m.emissiveMap; n.emissive = new THREE.Color(0xffffff); }
          return n;
        };
        o.material = Array.isArray(o.material) ? o.material.map(conv) : conv(o.material);
      });
      let ok = false; loaded.traverse((o) => { if (o.isSkinnedMesh) ok = true; });
      if (ok && loaded.getObjectByName('mixamorigHips')) { CUSTOM[who] = loaded; CHAR_NOTES.push(`✅ ${who}.fbx loaded`); }
      else CHAR_NOTES.push(`⚠️ ${who}: not a Mixamo character (no Mixamo skeleton), using the default`);
    } catch (e) { CHAR_NOTES.push(`⚠️ Couldn't load ${who}: ${e.message}`); }
  }
} catch { /* none */ }
const clip = (g, name) => g.animations.find((a) => a.name === name);
// The walk/run/idle come from the Soldier; Michelle borrows them, and both of us can do
// Michelle's samba. The two skeletons have the same joints but different resting poses, so a
// borrowed animation is converted: each joint keeps its movement *relative to its rest pose*
// (copying the raw rotations turned her upside down). Position/scale tracks are dropped.
/**
 * Bones by name. In some Mixamo files each bone has a same-named copy attached inside it;
 * the animation moves the outer one, so use that.
 */
function bonesOf(root) {
  const b = {};
  root.traverse((o) => { if (o.isBone && !b[o.name] && !(o.parent && o.parent.name === o.name)) b[o.name] = o; });
  return b;
}
const SKEL = { soldier: soldier.scene, michelle: michelle.scene };
SKEL.him = CUSTOM.him || soldier.scene;   // who you are in the game
SKEL.her = CUSTOM.her || michelle.scene;
// Both files come with a T-pose (arms straight out): put both skeletons in it, so "the same
// pose" means the same thing for each before comparing movements.
for (const [g, root] of [[soldier, soldier.scene], [michelle, michelle.scene]]) {
  const tp = g.animations.find((a) => a.name === 'TPose');
  const B = bonesOf(root);
  if (tp) for (const t of tp.tracks) if (t.name.endsWith('.quaternion') && B[t.name.slice(0, -11)]) B[t.name.slice(0, -11)].quaternion.fromArray(t.values, 0);
  root.updateMatrixWorld(true);
}
// Which way each model faces in its file (from the T-pose: right arm + up -> body frame).
function bodyFrame(root) {
  const B = bonesOf(root);
  const p = (n) => B[n].getWorldPosition(new THREE.Vector3());
  // Side-to-side from the hips (works whatever the arms are doing), up from hips to head.
  const up = p('mixamorigHead').sub(p('mixamorigHips')).normalize();
  const right = (B.mixamorigRightUpLeg && B.mixamorigLeftUpLeg ? p('mixamorigRightUpLeg').sub(p('mixamorigLeftUpLeg'))
    : p('mixamorigRightForeArm').sub(p('mixamorigRightArm')));
  right.addScaledVector(up, -right.dot(up)).normalize();
  // Facing +Z, a person's right hand is toward -X: so front = up x right, and the frame
  // (left, up, front) is right-handed. (right x up pointed backwards: everyone walked backwards.)
  const left = right.clone().negate();
  const fwd = new THREE.Vector3().crossVectors(up, right).normalize();
  const upO = new THREE.Vector3().crossVectors(fwd, left).normalize();
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(left, upO, fwd));
}
const FRAME = { soldier: bodyFrame(soldier.scene), michelle: bodyFrame(michelle.scene) };
/**
 * Put a skeleton into a T-pose (if it isn't in one): each spine/arm/leg bone is turned so it
 * points the same way, relative to the body, as in the Soldier's T-pose. Retargeting compares
 * movements against the rest pose, so a source resting in another pose (e.g. some "Without Skin"
 * downloads) would otherwise put every movement off (arms forward like a zombie).
 */
const CHAIN = [['Spine', 'Spine1'], ['Spine1', 'Spine2'], ['Spine2', 'Neck'], ['Neck', 'Head'],
  ['LeftShoulder', 'LeftArm'], ['LeftArm', 'LeftForeArm'], ['LeftForeArm', 'LeftHand'], ['LeftHand', 'LeftHandMiddle1'],
  ['RightShoulder', 'RightArm'], ['RightArm', 'RightForeArm'], ['RightForeArm', 'RightHand'], ['RightHand', 'RightHandMiddle1'],
  ['LeftUpLeg', 'LeftLeg'], ['LeftLeg', 'LeftFoot'], ['RightUpLeg', 'RightLeg'], ['RightLeg', 'RightFoot']];
function isTPose(root) {
  const B = bonesOf(root);
  root.updateMatrixWorld(true);
  const d = (a, b) => B[b].getWorldPosition(new THREE.Vector3()).sub(B[a].getWorldPosition(new THREE.Vector3())).normalize();
  if (!B.mixamorigRightArm || !B.mixamorigLeftArm) return true;
  return Math.abs(d('mixamorigRightArm', 'mixamorigRightForeArm').y) < 0.3 && Math.abs(d('mixamorigLeftArm', 'mixamorigLeftForeArm').y) < 0.3
    && Math.abs(d('mixamorigRightForeArm', 'mixamorigRightHand').y) < 0.35;
}
/**
 * Your Mixamo downloads were made on X Bot. If one doesn't rest in a T-pose, give its bones
 * X Bot's own resting rotations (exactly what the recording is relative to).
 */
const XBOT_REST = {};
if (xbot) { const XB = bonesOf(xbot.scene); for (const [n, bone] of Object.entries(XB)) XBOT_REST[n] = bone.quaternion.clone(); }
function ensureTPose(root) {
  if (isTPose(root)) return false;
  const B0 = bonesOf(root);
  const names = Object.keys(B0);
  if (xbot && names.length && names.every((n) => XBOT_REST[n]) && Object.keys(XBOT_REST).every((n) => B0[n])) {
    for (const n of names) B0[n].quaternion.copy(XBOT_REST[n]);
    root.updateMatrixWorld(true);
    if (isTPose(root)) return 'xbot';
  }
  const B = bonesOf(root), R = bonesOf(SKEL.soldier);
  SKEL.soldier.updateMatrixWorld(true);
  const refInv = FRAME.soldier.clone().invert();
  const frameQ = bodyFrame(root);
  const wp = (o) => o.getWorldPosition(new THREE.Vector3());
  const q = new THREE.Quaternion(), pq = new THREE.Quaternion(), wq = new THREE.Quaternion();
  for (const [a, b] of CHAIN) {
    const sa = B[`mixamorig${a}`], sb = B[`mixamorig${b}`], ra = R[`mixamorig${a}`], rb = R[`mixamorig${b}`];
    if (!sa || !sb || !ra || !rb) continue;
    root.updateMatrixWorld(true);
    const want = wp(rb).sub(wp(ra)).normalize().applyQuaternion(refInv).applyQuaternion(frameQ);
    const cur = wp(sb).sub(wp(sa)).normalize();
    q.setFromUnitVectors(cur, want);
    sa.getWorldQuaternion(wq); wq.premultiply(q);
    sa.parent.getWorldQuaternion(pq);
    sa.quaternion.copy(pq.invert().multiply(wq));
  }
  root.updateMatrixWorld(true);
  return true;
}
for (const k of ['him', 'her']) if (CUSTOM[k]) ensureTPose(CUSTOM[k]);
FRAME.him = CUSTOM.him ? bodyFrame(CUSTOM.him) : FRAME.soldier;
FRAME.her = CUSTOM.her ? bodyFrame(CUSTOM.her) : FRAME.michelle;
/** Turn needed so a model faces +Z (the way the game expects) at rotation 0. */
const FACE = {};
for (const k of ['him', 'her']) {
  const f = new THREE.Vector3(0, 0, 1).applyQuaternion(FRAME[k]);
  FACE[k] = Math.atan2(-f.x, f.z) || 0;
}
/**
 * Full retarget, rotation only: for every keyframe, walk down the skeleton and give each
 * target joint the same change in *body space* as the source joint (relative to each
 * skeleton's own rest pose), then turn that back into the joint's local rotation.
 */
function borrow(c, from, to) {
  // from: 'soldier' | 'michelle' | { root, frame } (a skeleton loaded from a Mixamo file)
  const src = typeof from === 'string' ? { root: SKEL[from], frame: FRAME[from] } : from;
  const sRoot = src.root, tRoot = SKEL[to];
  sRoot.updateMatrixWorld(true); tRoot.updateMatrixWorld(true);
  const S = bonesOf(sRoot), T = bonesOf(tRoot);
  const order = []; tRoot.traverse((o) => { if (o.isBone && S[o.name]) order.push(o.name); });
  const wq = (o) => o.getWorldQuaternion(new THREE.Quaternion());
  const Ws = {}, Wt = {}, Wts = {};
  for (const n of order) { Ws[n] = wq(S[n]); Wt[n] = wq(T[n]); Wts[n] = Ws[n].clone().invert(); }
  const interp = {};
  for (const t of c.tracks) if (t.name.endsWith('.quaternion')) interp[t.name.slice(0, -11)] = t.createInterpolant();
  const times = (c.tracks.find((t) => t.name === 'mixamorigHips.quaternion') || c.tracks.find((t) => t.name.endsWith('.quaternion'))).times;
  const out = Object.fromEntries(order.map((n) => [n, new Float32Array(times.length * 4)]));
  const local = new THREE.Quaternion(), D = new THREE.Quaternion();
  // The two models may face different ways: carry each movement over in the other's body frame.
  const R = FRAME[to].clone().multiply(src.frame.clone().invert()), Rinv = R.clone().invert();
  for (let i = 0; i < times.length; i++) {
    const As = {}, At = {};
    for (const n of order) {
      const sb = S[n], tb = T[n];
      if (interp[n]) local.fromArray(interp[n].evaluate(times[i])); else local.copy(sb.quaternion);
      const ps = sb.parent && As[sb.parent.name] ? As[sb.parent.name] : wq(sb.parent);
      As[n] = ps.clone().multiply(local);
      D.copy(As[n]).multiply(Wts[n]);                 // change from rest, in body space
      D.premultiply(R).multiply(Rinv);                // ...seen from the other model's front
      At[n] = D.clone().multiply(Wt[n]);
      const pt = tb.parent && At[tb.parent.name] ? At[tb.parent.name] : wq(tb.parent);
      pt.clone().invert().multiply(At[n]).normalize().toArray(out[n], i * 4);
    }
  }
  const cl = c.clone();
  cl.tracks = order.map((n) => new THREE.QuaternionKeyframeTrack(`${n}.quaternion`, times, out[n]));
  // The hips' up-and-down bounce (sideways/forward movement is left out: the game moves you).
  const hipTrack = c.tracks.find((t) => t.name === 'mixamorigHips.position');
  const sH = S.mixamorigHips, tH = T.mixamorigHips;
  if (hipTrack && sH && tH && sH.parent && tH.parent) {
    const hi = hipTrack.createInterpolant();
    const sRest = sH.getWorldPosition(new THREE.Vector3()), tRest = tH.getWorldPosition(new THREE.Vector3());
    const sGround = new THREE.Vector3().setFromMatrixPosition(sRoot.matrixWorld), tGround = new THREE.Vector3().setFromMatrixPosition(tRoot.matrixWorld);
    const ratio = (tRest.y - tGround.y) / Math.max(1e-4, sRest.y - sGround.y);
    const tInv = tH.parent.matrixWorld.clone().invert();
    const ht = hipTrack.times;
    const vals = new Float32Array(ht.length * 3);
    const v = new THREE.Vector3();
    for (let i = 0; i < ht.length; i++) {
      v.fromArray(hi.evaluate(ht[i])).applyMatrix4(sH.parent.matrixWorld);
      const dy = clamp((v.y - sRest.y) * ratio, -0.35 * (tRest.y - tGround.y), 0.25 * (tRest.y - tGround.y));
      v.set(tRest.x, tRest.y + dy, tRest.z).applyMatrix4(tInv);
      v.toArray(vals, i * 3);
    }
    cl.tracks.push(new THREE.VectorKeyframeTrack('mixamorigHips.position', ht, vals));
  }
  return cl;
}
const builtIn = (k) => ({
  idle: borrow(clip(soldier, 'Idle'), 'soldier', k), walk: borrow(clip(soldier, 'Walk'), 'soldier', k),
  run: borrow(clip(soldier, 'Run'), 'soldier', k), dance: borrow(clip(michelle, 'SambaDance'), 'michelle', k),
});
const CLIPS = { him: builtIn('him'), her: builtIn('her') };
const BASE = { him: SKEL.him, her: SKEL.her };
const MOCAP_LOADED = new Map(); // move -> Mixamo animation name
const ONCE = new Set(['wave', 'hug', 'kiss', 'slap', 'flinch', 'cheer', 'blowkiss', 'laugh', 'clap']); // play once, not on a loop
const HEIGHT = { him: 1.8, her: 1.68 };
const baseScale = {};
for (const k of ['him', 'her']) {
  BASE[k].traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; } });
  const bb = new THREE.Box3().setFromObject(BASE[k]);
  baseScale[k] = HEIGHT[k] / Math.max(0.1, bb.max.y - bb.min.y);
}

class Avatar {
  constructor(kind, name) {
    this.kind = kind;
    this.root = new THREE.Group();
    this.model = SkeletonUtils.clone(BASE[kind]);
    this.model.scale.setScalar(baseScale[kind]);
    this.model.rotation.y = FACE[kind]; // face +Z like the game expects
    this.root.add(this.model);
    scene.add(this.root);
    this.mixer = new THREE.AnimationMixer(this.model);
    this.actions = {};
    this.mocap = new Set(MOCAP_LOADED.keys());
    for (const [k, c] of Object.entries(CLIPS[kind])) {
      this.actions[k] = this.mixer.clipAction(c);
      if (ONCE.has(k)) { this.actions[k].setLoop(THREE.LoopOnce, 1); this.actions[k].clampWhenFinished = true; }
    }
    this.current = 'idle';
    this.actions.idle.play();
    const tag = document.createElement('div'); tag.innerHTML = '<div class="nametag"></div>'; tag.firstChild.textContent = petName(name);
    this.tag = new CSS2DObject(tag); this.tag.position.set(0, HEIGHT[kind] + 0.35, 0);
    this.root.add(this.tag);
  }
  /** Put in a new animation (e.g. one from Mixamo) for a move. */
  setClip(name, clip) {
    const old = this.actions[name];
    const act = this.mixer.clipAction(clip);
    if (ONCE.has(name)) { act.setLoop(THREE.LoopOnce, 1); act.clampWhenFinished = true; }
    this.actions[name] = act;
    if (old && this.current === name) { act.reset().play(); old.crossFadeTo(act, 0.3, false); }
  }
  /** A one-off full-body move (hug, wave…) from Mixamo, if we have it; walking resumes after. */
  gesture(name, dur) {
    if (!this.actions[name] || !this.mocap || !this.mocap.has(name)) return false;
    this.gestureUntil = performance.now() + (dur || this.actions[name].getClip().duration) * 1000;
    this.play(name, true);
    return true;
  }
  play(name, force) {
    if (!force && this.gestureUntil > performance.now()) return; // let the gesture finish
    if (name === this.current || !this.actions[name]) return;
    const from = this.actions[this.current], to = this.actions[name];
    to.reset().setEffectiveWeight(1).play();
    from.crossFadeTo(to, 0.25, false);
    this.current = name;
  }
  heart(symbol = '💋') {
    // The outer element is placed over the head each frame; the inner one does the animation
    // (an animation on the outer one would override the placement).
    const el = document.createElement('div'); el.innerHTML = '<div class="float-heart"></div>'; el.firstChild.textContent = symbol;
    const o = new CSS2DObject(el); o.position.set(0, HEIGHT[this.kind] + 0.6, 0);
    this.root.add(o);
    setTimeout(() => { this.root.remove(o); el.remove(); }, 2400);
  }
  say(text) {
    const el = document.createElement('div'); el.innerHTML = '<div class="bubble"></div>'; el.firstChild.textContent = text;
    const o = new CSS2DObject(el); o.position.set(0, HEIGHT[this.kind] + 0.75, 0);
    this.root.add(o);
    setTimeout(() => { this.root.remove(o); el.remove(); }, 2200);
  }
  dispose() { scene.remove(this.root); this.tag.element.remove(); }
}

// ---- People out in the rain: pedestrians walking up and down the pavements -----------------------
const peds = [];
const PAVE_Y = 0.12; // pavement height in London
if (london) {
  const N = { high: 10, medium: 6, low: 3 }[qName] || 4;
  const pr = (() => { let s = 4242; return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646; })();
  const walkFor = {
    soldier: clip(soldier, 'Walk'),
    michelle: (() => { try { return borrow(clip(soldier, 'Walk'), 'soldier', 'michelle'); } catch { return null; } })(),
  };
  const coat = new THREE.MeshStandardMaterial({ color: 0x1a1b1f, roughness: 0.55 });
  const umbMat = new THREE.MeshStandardMaterial({ color: 0x0c0c0e, roughness: 0.3, side: THREE.DoubleSide });
  for (let i = 0; i < N; i++) {
    const kind = i % 2 ? 'michelle' : 'soldier';
    if (!walkFor[kind]) continue;
    const src = SKEL[kind];
    const model = SkeletonUtils.clone(src);
    const bb = new THREE.Box3().setFromObject(src);
    model.scale.setScalar((1.62 + pr() * 0.22) / Math.max(0.1, bb.max.y - bb.min.y));
    const f = new THREE.Vector3(0, 0, 1).applyQuaternion(FRAME[kind]);
    model.rotation.y = Math.atan2(-f.x, f.z) || 0;
    model.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = qName === 'high'; o.receiveShadow = true; o.frustumCulled = false;
      if (kind === 'soldier') o.material = coat; // a dark winter coat, not a uniform
    });
    const root = new THREE.Group(); root.add(model);
    if (pr() < 0.65) { // an umbrella
      const u = new THREE.Group();
      const can = new THREE.Mesh(new THREE.ConeGeometry(0.55, 0.3, 10, 1, true), umbMat); can.position.y = 2.05; u.add(can);
      const sh = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.95, 5), umbMat); sh.position.y = 1.6; u.add(sh);
      u.position.set(0.16, 0, 0.12); root.add(u);
    }
    const mixer = new THREE.AnimationMixer(model);
    const act = mixer.clipAction(walkFor[kind]); act.play(); act.time = pr() * 2;
    const lane = london.lanes[i % 2];
    const dir = pr() < 0.5 ? 1 : -1;
    const p = { root, mixer, act, lane, dir, x: lane.x0 + pr() * (lane.x1 - lane.x0), off: (pr() - 0.5) * 0.8, side: 0, speed: 1.15 + pr() * 0.3 };
    root.position.set(p.x, PAVE_Y, lane.z + p.off);
    scene.add(root);
    peds.push(p);
  }
}
function updatePeds(dt) {
  for (const p of peds) {
    p.x += p.dir * p.speed * dt;
    if (p.x > p.lane.x1) { p.x = p.lane.x1; p.dir = -1; } else if (p.x < p.lane.x0) { p.x = p.lane.x0; p.dir = 1; }
    // Step aside for you (and for each other) rather than walking through.
    let want = 0;
    const pz = p.lane.z + p.off;
    for (const a of [me.root.position, ...[...others.values()].map((o) => o.av.root.position)]) {
      if (Math.abs(a.x - p.x) < 2.2 && Math.abs(a.z - pz) < 1.2) want = a.z > pz ? -1.1 : 1.1;
    }
    p.side += (want - p.side) * Math.min(1, dt * 3);
    p.root.position.set(p.x, PAVE_Y, pz + p.side);
    p.root.rotation.y = p.dir > 0 ? Math.PI / 2 : -Math.PI / 2;
    const near = p.root.position.distanceToSquared(camera.position) < 70 * 70;
    p.root.visible = near;
    if (near) p.mixer.update(dt * p.speed / 1.3);
  }
}
const me = new Avatar(myKind, myName);
me.root.position.set(HX + (myKind === 'him' ? -1 : 1), 0, HZ + D / 2 + 3);
if (london) me.root.position.set(london.spawn.x + (myKind === 'him' ? -0.7 : 0.7), london.spawn.y, london.spawn.z);
me.root.position.y = groundAt(me.root.position.x, me.root.position.z);
let heading = Math.PI; // facing away from the house, toward the path
const others = new Map();

// ---- Controls --------------------------------------------------------------------------------
const keys = new Set();
let camYaw = 0, camPitch = 0.32, camDist = 6.5, dancing = false, runToggle = false;
const stick = { x: 0, y: 0, active: false };
addEventListener('keydown', (e) => {
  keys.add(e.code);
  if (e.code === 'KeyG') toggleDance();
  if (e.code === 'KeyQ') doAct('wave');
  if (e.code === 'KeyL') emote('laugh');
  if (e.code === 'KeyC') emote('clap');
  if (e.code === 'KeyV') emote('cheer');
  if (e.code === 'KeyK') { if (nearest()) doAct('kiss'); else blowKiss(); }
  if (e.code === 'KeyH') doAct('hug');
  if (e.code === 'KeyJ') doAct('slap');
  if (e.code === 'KeyF') doAct('hands');
});
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('blur', () => keys.clear());
// Look around: drag on the right side (touch) or anywhere (mouse)
let look = null;
$('view').addEventListener('pointerdown', (e) => { look = { id: e.pointerId, x: e.clientX, y: e.clientY }; $('view').setPointerCapture(e.pointerId); });
$('view').addEventListener('pointermove', (e) => {
  if (!look || e.pointerId !== look.id) return;
  camYaw -= (e.clientX - look.x) * 0.006;
  camPitch = clamp(camPitch + (e.clientY - look.y) * 0.004, 0.05, 1.2);
  look.x = e.clientX; look.y = e.clientY;
});
$('view').addEventListener('pointerup', () => { look = null; });
addEventListener('wheel', (e) => { camDist = clamp(camDist + e.deltaY * 0.005, 2.5, 14); }, { passive: true });
// Touch joystick
{
  const zone = $('stickZone'), base = $('stick'), knob = base.querySelector('i');
  let id = null, cx = 0, cy = 0;
  zone.addEventListener('pointerdown', (e) => {
    id = e.pointerId; zone.setPointerCapture(id);
    const r = base.getBoundingClientRect(); cx = r.left + r.width / 2; cy = r.top + r.height / 2;
    stick.active = true; move(e);
  });
  const move = (e) => {
    if (e.pointerId !== id) return;
    let dx = e.clientX - cx, dy = e.clientY - cy;
    const len = Math.hypot(dx, dy), max = 55;
    if (len > max) { dx *= max / len; dy *= max / len; }
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
    stick.x = dx / max; stick.y = -dy / max;
  };
  zone.addEventListener('pointermove', move);
  const end = (e) => { if (e.pointerId !== id) return; id = null; stick.active = false; stick.x = stick.y = 0; knob.style.transform = ''; };
  zone.addEventListener('pointerup', end); zone.addEventListener('pointercancel', end);
}
const toggleDance = () => { dancing = !dancing; $('tDance').classList.toggle('on', dancing); $('dDance').classList.toggle('on', dancing); };
function blowKiss() { me.gesture('blowkiss'); setTimeout(() => me.heart('💋'), 700); send({ t: 'gemote', e: 'kiss' }); }
/** Laugh / clap / celebrate (real moves if you have them, otherwise just the emoji). */
const EMOTE_ICON = { laugh: '😂', clap: '👏', cheer: '🎉' };
function emote(e) { me.gesture(e); me.heart(EMOTE_ICON[e]); send({ t: 'gemote', e }); }
$('tRun').onclick = () => { runToggle = !runToggle; $('tRun').classList.toggle('on', runToggle); };
$('tDance').onclick = toggleDance; $('dDance').onclick = toggleDance;
$('tKiss').onclick = () => (nearest() ? doAct('kiss') : blowKiss());
$('dKiss').onclick = () => (nearest() ? doAct('kiss') : blowKiss());
$('tWave').onclick = () => doAct('wave'); $('dWave').onclick = () => doAct('wave');
for (const b of document.querySelectorAll('[data-emote]')) b.onclick = () => emote(b.dataset.emote);
for (const b of document.querySelectorAll('#acts [data-act]')) b.onclick = () => doAct(b.dataset.act);

// ---- Together: hug, kiss, a cheeky slap, holding hands, waving ----------------------------
const HUG_GAP = 0.3, KISS_GAP = 0.3; // metres between you (chest to chest)
const SLAP_LINES = ['Hey! 😳', 'Oi! 😏', 'Cheeky! 🍑', 'Behave! 😂', 'Again? 😉', 'Excuse you! 😆'];
let lockUntil = 0;          // no walking during a hug/kiss/slap
let leading = null;         // name of who's holding my hand while I lead
let following = null;       // name of who I'm walking beside (they lead)
let shot = null;            // close-up camera during an interaction
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const otherOf = (name) => others.get(name);
const findAvatar = (name) => (name === myName ? me : (others.get(name) || {}).av || null);
/** The other player close enough to touch (within 1.8 m), or null. */
function nearest(max = 1.8) {
  let best = null, bd = max;
  for (const [name, o] of others) { const d = o.av.root.position.distanceTo(me.root.position); if (d < bd) { bd = d; best = name; } }
  return best;
}
const angleTo = (from, to) => Math.atan2(to.x - from.x, to.z - from.z);
/** Put me at a spot relative to someone (their facing), facing a given way. */
function placeMe(x, z, h) { me.root.position.x = x; me.root.position.z = z; heading = h; me.root.rotation.y = h; }
function startShot(kind, partner) {
  const c = cinematic(kind);
  if (c) shot = { ...c, partner, until: performance.now() + POSES[kind] * 1000 };
}
function doAct(a) {
  if (a === 'wave') { if (!me.gesture('wave')) pose(me, 'wave'); send({ t: 'gact', a: 'wave' }); return; }
  const to = a === 'hands' && (leading || following) ? (leading || following) : nearest();
  if (!to) { if (a !== 'hands') me.say('Get closer 😉'); return; }
  const o = otherOf(to);
  const P = o.av.root.position, ph = o.rot;
  const line = a === 'slap' ? pick(SLAP_LINES) : undefined;
  if (a === 'hug' || a === 'kiss') {
    // Face them; they step into place in front of me (on their screen).
    heading = angleTo(me.root.position, P);
    me.root.rotation.y = heading;
    lockUntil = performance.now() + POSES[a] * 1000;
    stopHands(false); dancing = false;
    pose(me, a, { partner: to }); pose(o.av, a, { partner: myName });
    me.gesture(a, POSES[a]); o.av.gesture(a, POSES[a]);
    // She steps into place in front of me on her screen; show her there right away on mine.
    const d = a === 'hug' ? HUG_GAP : KISS_GAP;
    o.target.set(me.root.position.x + Math.sin(heading) * d, o.target.y, me.root.position.z + Math.cos(heading) * d);
    o.av.root.position.copy(o.target); o.rot = heading + Math.PI; o.av.root.rotation.y = o.rot;
    o.pinUntil = performance.now() + POSES[a] * 1000; // ignore older position updates meanwhile
    setTimeout(() => sound(a === 'kiss' ? 'kiss' : 'chime'), a === 'kiss' ? 900 : 300);
    setTimeout(() => me.heart(a === 'kiss' ? '💋' : '🤗'), 1000);
    startShot(a, to);
  } else if (a === 'slap') {
    // Step to her right side, just behind, turned toward her, then the swing.
    const fx = Math.sin(ph), fz = Math.cos(ph), rx = -Math.cos(ph), rz = Math.sin(ph);
    placeMe(P.x + rx * 0.5 - fx * 0.2, P.z + rz * 0.5 - fz * 0.2, ph + 0.5);
    lockUntil = performance.now() + POSES.slap * 1000;
    dancing = false;
    pose(me, 'slap', { partner: to });
    pose(o.av, 'slapped', { side: -1 });
    me.gesture('slap', POSES.slap); setTimeout(() => o.av.gesture('flinch', 1.2), 450);
    setTimeout(() => { sound('slap'); }, 450);
    setTimeout(() => o.av.say(line), 520);
    startShot('slap', to);
  } else if (a === 'hands') {
    if (leading || following) { stopHands(true); return; }
    leading = to;
    pose(me, 'hands', { partner: to, side: 1 }); pose(o.av, 'hands', { partner: myName, side: -1 });
    sound('chime');
  }
  send({ t: 'gact', a, to, line, p: [me.root.position.x, me.root.position.y, me.root.position.z], r: heading });
  updateActs();
}
function stopHands(tell) {
  const who = leading || following;
  if (!who) return;
  stopPose(me, 'hands');
  const o = otherOf(who); if (o) stopPose(o.av, 'hands');
  leading = following = null;
  if (tell) send({ t: 'gact', a: 'hands', to: who, off: true });
  updateActs();
}
/** Something the other player did (to me, or just near me). */
function onAct(m) {
  const o = otherOf(m.from); if (!o) return;
  const forMe = m.to === myName;
  // Their exact spot for this moment (so poses line up on both screens).
  if (Array.isArray(m.p)) { o.target.set(...m.p); o.av.root.position.set(...m.p); }
  if (Number.isFinite(m.r)) { o.rot = m.r; o.av.root.rotation.y = m.r; }
  if (m.a === 'wave') { if (!o.av.gesture('wave')) pose(o.av, 'wave'); return; }
  if (m.a === 'hug' || m.a === 'kiss') {
    pose(o.av, m.a, { partner: m.to });
    o.av.gesture(m.a, POSES[m.a]);
    if (forMe) {
      // Step into place in front of them, facing them.
      const h = o.rot, d = m.a === 'hug' ? HUG_GAP : KISS_GAP;
      placeMe(o.av.root.position.x + Math.sin(h) * d, o.av.root.position.z + Math.cos(h) * d, h + Math.PI);
      lockUntil = performance.now() + POSES[m.a] * 1000;
      dancing = false;
      stopHands(false);
      pose(me, m.a, { partner: m.from });
      me.gesture(m.a, POSES[m.a]);
      setTimeout(() => sound(m.a === 'kiss' ? 'kiss' : 'chime'), m.a === 'kiss' ? 900 : 300);
      if (navigator.vibrate) { try { navigator.vibrate(40); } catch { /* not allowed */ } }
      startShot(m.a, m.from);
    }
    setTimeout(() => o.av.heart(m.a === 'kiss' ? '💋' : '🤗'), 1000);
  } else if (m.a === 'slap') {
    pose(o.av, 'slap', { partner: m.to });
    o.av.gesture('slap', POSES.slap);
    const target = forMe ? me : (otherOf(m.to) || {}).av;
    if (target) { pose(target, 'slapped', { side: -1 }); setTimeout(() => target.gesture('flinch', 1.2), 450); }
    if (forMe) { lockUntil = performance.now() + POSES.slapped * 1000; dancing = false; startShot('slap', m.from); }
    setTimeout(() => {
      sound('slap');
      if (forMe && navigator.vibrate) { try { navigator.vibrate([30, 30, 60]); } catch { /* not allowed */ } }
    }, 450);
    setTimeout(() => { if (target) target.say(m.line || pick(SLAP_LINES)); }, 520);
  } else if (m.a === 'hands' && forMe) {
    if (m.off) { stopHands(false); return; }
    following = m.from; leading = null;
    pose(o.av, 'hands', { partner: myName, side: 1 }); pose(me, 'hands', { partner: m.from, side: -1 });
    sound('chime');
  }
  updateActs();
}
function updateActs() {
  const who = nearest() || leading || following;
  $('acts').classList.toggle('hidden', !who);
  $('help').classList.toggle('hidden', !!who);
  if (!who) return;
  $('actsWho').textContent = petName(who);
  const handsBtn = document.querySelector('#acts [data-act="hands"]');
  handsBtn.classList.toggle('on', !!(leading || following));
  handsBtn.querySelector('span').textContent = leading || following ? 'Let go' : 'Hold hands';
}

// ---- Time of day -------------------------------------------------------------------------------
const DAY_SECONDS = (LONDON ? 16 : 8) * 60;
let dayT = LONDON ? 0.82 : 0.36;  // London starts at night
let dayFactor = 1;
if (london) {
  const rb = $('rainBtn');
  const show = () => { rb.textContent = london.muted() ? '🔇' : '🔊'; };
  rb.onclick = () => { london.setMuted(!london.muted()); show(); };
  show();
} else $('rainBtn').classList.add('hidden');
$('timeBtn').onclick = () => { dayT = dayT > 0.25 && dayT < 0.75 ? 0.8 : 0.33; updateEnv(true); };
const sunDir = new THREE.Vector3();
let envAt = -1;
function updateEnv(force) {
  const elev = Math.sin((dayT - 0.25) * Math.PI * 2);            // -1 .. 1
  const az = dayT * Math.PI * 2;
  sunDir.set(Math.cos(az) * Math.cos(elev * 1.2), Math.max(-0.4, elev), Math.sin(az) * Math.cos(elev * 1.2)).normalize();
  sky.material.uniforms.sunPosition.value.copy(sunDir);
  const day = smooth(-0.08, 0.25, elev);
  const golden = 1 - smooth(0.05, 0.35, elev);
  sunLight.intensity = 3.2 * day;
  sunLight.color.setHSL(0.09, 0.5 + golden * 0.4, 0.9 - golden * 0.25);
  moonLight.intensity = 0.35 * (1 - day);
  hemi.intensity = (0.26 + 0.42 * day) * (Q.env ? 1 : 1.9); // no sky reflections on Low: more soft light instead
  hemi.color.setHSL(0.6, 0.5, 0.35 + 0.45 * day);
  renderer.toneMappingExposure = 0.42 + 0.18 * day;
  stars.material.opacity = 1 - smooth(-0.15, 0.08, elev);
  if (clouds) { clouds.material.uniforms.tint.value.setHSL(0.07, 0.6 * golden * day, 0.12 + 0.85 * day); clouds.material.uniforms.opacity.value = 0.35 + 0.6 * day; }
  const night = 1 - day;
  windowMat.emissiveIntensity = night * 0.75;
  lampLight.intensity = night * 14;
  porchLight.intensity = night * 10;
  porchBulb.material.emissiveIntensity = night * 3;
  scene.fog.color.setHSL(0.58, 0.35 - golden * 0.1, 0.08 + 0.7 * day).lerp(new THREE.Color(0xf2b27a), golden * day * 0.35);
  if (water && water.material.uniforms) water.material.uniforms.sunDirection.value.copy(sunDir);
  dayFactor = day;
  if (london) {
    // Winter overcast: no hard sun, soft cold light by day; at night the lamps do the work.
    sunLight.intensity = 1.1 * day + 0.05;
    sunLight.color.setRGB(0.82, 0.86, 0.92);
    moonLight.intensity = 0.18 * (1 - day);
    hemi.color.setRGB(0.55, 0.6, 0.68); hemi.groundColor.setRGB(0.12, 0.11, 0.1);
    hemi.intensity = (0.24 + 0.45 * day) * (Q.env ? 1 : 1.6);
    renderer.toneMappingExposure = 0.78 + 0.06 * day;
    scene.fog.color.setRGB(0.48, 0.51, 0.55).lerp(new THREE.Color(0.035, 0.04, 0.055), 1 - day);
    if (clouds) { clouds.material.uniforms.tint.value.setRGB(0.42, 0.44, 0.48).multiplyScalar(0.15 + 0.85 * day); clouds.material.uniforms.opacity.value = 0.9; }
    stars.material.opacity = 0;
  }
  $('timeBtn').textContent = day > 0.5 ? '🌙' : '☀️';
  // Reflections & soft sky light (every couple of in-game minutes)
  if (Q.env && (force || Math.abs(dayT - envAt) > 0.015)) {
    envAt = dayT;
    envSky.material.uniforms.sunPosition.value.copy(sunDir);
    for (const k of ['turbidity', 'rayleigh', 'mieCoefficient', 'mieDirectionalG']) envSky.material.uniforms[k].value = sky.material.uniforms[k].value;
    if (envRT) envRT.dispose();
    if (london) london.update(0, me ? me.root.position : new THREE.Vector3(), camera.position, day); // sky colours first
    envRT = pmrem.fromScene(london ? london.envScene : envScene);
    scene.environment = envRT.texture;
    // At night in London: reflections from a photographed rainy street at night.
    if (london && nightEnv && day < 0.4) scene.environment = nightEnv;
    scene.environmentIntensity = london ? 0.35 + 0.3 * day : 0.15 + 0.4 * day;
  }
}

if (london && Q.env) {
  new RGBELoader().load('/game-assets/ph_night.hdr', (t) => {
    t.mapping = THREE.EquirectangularReflectionMapping;
    nightEnv = pmrem.fromEquirectangular(t).texture;
    t.dispose();
    updateEnv(true);
  }, undefined, () => { /* keep the built-in reflections */ });
}

// ---- Together (the other player) ----------------------------------------------------------------
let ws = null;
function send(m) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(m)); }
function connect() {
  ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/sync`);
  ws.onopen = () => send({ t: 'hello', name: myName, game: true });
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.t === 'gpos' && m.from !== myName) {
      let o = others.get(m.from);
      if (!o) { o = { av: new Avatar(m.m === 'her' ? 'her' : 'him', m.from), target: new THREE.Vector3(...m.p), rot: m.r }; o.av.root.position.set(...m.p); others.set(m.from, o); }
      if (!(o.pinUntil > performance.now())) { o.target.set(...m.p); o.rot = m.r; }
      o.av.play(m.a); o.seen = performance.now();
      updatePartner();
    } else if (m.t === 'gemote' && others.has(m.from)) {
      const av = others.get(m.from).av;
      if (m.e === 'kiss') { av.gesture('blowkiss'); setTimeout(() => av.heart('💋'), 700); }
      else if (EMOTE_ICON[m.e]) { av.gesture(m.e); av.heart(EMOTE_ICON[m.e]); }
      else av.heart('💖');
    } else if (m.t === 'gact' && m.from !== myName) onAct(m);
    else if (m.t === 'gleave' && others.has(m.from)) {
      if (leading === m.from || following === m.from) stopHands(false);
      others.get(m.from).av.dispose(); others.delete(m.from); updatePartner(); updateActs();
    }
  };
  ws.onclose = () => setTimeout(connect, 2000);
}
function updatePartner() {
  const names = [...others.keys()].map(petName);
  $('partner').textContent = names.length ? `💞 ${names.join(' & ')} ${names.length > 1 ? 'are' : 'is'} here` : 'Waiting for your love…';
}
connect();

// ---- Game loop ------------------------------------------------------------------------------------
const clock = new THREE.Clock();
let sendT = 0, lastSent = '', lastSentAt = 0, fpsT = 0, frames = 0, actsT = 0, shotMix = 0, lastShot = null;
const camTarget = new THREE.Vector3();
function collide(p) {
  for (const [x0, z0, x1, z1] of colliders) {
    const cx = clamp(p.x, x0, x1), cz = clamp(p.z, z0, z1);
    const dx = p.x - cx, dz = p.z - cz, d = Math.hypot(dx, dz), r = 0.35;
    if (d < r) { if (d > 1e-4) { p.x = cx + (dx / d) * r; p.z = cz + (dz / d) * r; } else { p.z = z1 + r; } }
  }
  for (const [x, z, r0] of circles) {
    const dx = p.x - x, dz = p.z - z, d = Math.hypot(dx, dz), r = r0 + 0.35;
    if (d < r && d > 1e-4) { p.x = x + (dx / d) * r; p.z = z + (dz / d) * r; }
  }
  if (london) { const b = london.bounds; p.x = clamp(p.x, b.x0, b.x1); p.z = clamp(p.z, b.z0, b.z1); return; }
  const lim = SIZE * 0.45;
  p.x = clamp(p.x, -lim, lim); p.z = clamp(p.z, -lim, lim);
}
function tick() {
  const dt = Math.min(0.05, clock.getDelta());
  dayT = (dayT + dt / DAY_SECONDS) % 1;
  updateEnv(false);
  // Move me
  let ix = 0, iy = 0;
  if (keys.has('KeyW') || keys.has('ArrowUp')) iy += 1;
  if (keys.has('KeyS') || keys.has('ArrowDown')) iy -= 1;
  if (keys.has('KeyA') || keys.has('ArrowLeft')) ix -= 1;
  if (keys.has('KeyD') || keys.has('ArrowRight')) ix += 1;
  if (stick.active) { ix = stick.x; iy = stick.y; }
  if (performance.now() < lockUntil) { ix = 0; iy = 0; }
  let mag = Math.min(1, Math.hypot(ix, iy));
  // Walking hand in hand: they lead, I stay at their right side (moving myself lets go).
  if (following) {
    const o = otherOf(following);
    if (!o || mag > 0.3) stopHands(true);
    else {
      const h = o.rot;
      me.root.position.x = o.av.root.position.x - Math.cos(h) * 0.62;
      me.root.position.z = o.av.root.position.z + Math.sin(h) * 0.62;
      heading = h;
      mag = 0;
    }
  }
  const running = keys.has('ShiftLeft') || keys.has('ShiftRight') || runToggle || (stick.active && mag > 0.92);
  let anim = dancing ? 'dance' : 'idle';
  if (following && otherOf(following)) anim = otherOf(following).av.current === 'dance' ? 'idle' : otherOf(following).av.current;
  if (leading && otherOf(leading) && otherOf(leading).av.root.position.distanceTo(me.root.position) > 4) stopHands(true);
  if (mag > 0.12) {
    dancing = false; $('tDance').classList.remove('on'); $('dDance').classList.remove('on');
    const fx = -Math.sin(camYaw), fz = -Math.cos(camYaw), rx = -fz, rz = fx;
    let mx = fx * iy + rx * ix, mz = fz * iy + rz * ix;
    const ml = Math.hypot(mx, mz); mx /= ml; mz /= ml;
    const speed = running ? 5.2 : 1.7 * Math.max(0.6, mag);
    const p = me.root.position.clone();
    p.x += mx * speed * dt; p.z += mz * speed * dt;
    collide(p);
    if (heightAt(p.x, p.z) > -0.35) { me.root.position.x = p.x; me.root.position.z = p.z; }
    const want = Math.atan2(mx, mz);
    let diff = want - heading; diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    heading += diff * Math.min(1, dt * 10);
    anim = running ? 'run' : 'walk';
  }
  { // step up/down smoothly (onto the step and the floor)
    const gy = groundAt(me.root.position.x, me.root.position.z);
    me.root.position.y = Math.abs(gy - me.root.position.y) > 0.6 ? gy : lerp(me.root.position.y, gy, Math.min(1, dt * 14));
  }
  me.root.rotation.y = heading;
  me.play(anim);
  me.mixer.update(dt);
  updatePeds(dt);
  applyPoses(me, findAvatar);
  if (window.__poseHook) window.__poseHook(me);
  // The other player: glide to where they are
  for (const o of others.values()) {
    o.av.root.position.lerp(o.target, Math.min(1, dt * 8));
    let diff = o.rot - o.av.root.rotation.y; diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    o.av.root.rotation.y += diff * Math.min(1, dt * 8);
    o.av.mixer.update(dt);
    applyPoses(o.av, findAvatar);
  }
  actsT += dt;
  if (actsT > 0.25) { actsT = 0; updateActs(); }
  // Camera follows behind; during a hug/kiss/slap it swings round to a close side view of you both.
  let yaw = camYaw, pitch = camPitch, dist = camDist;
  const focus = new THREE.Vector3(me.root.position.x, me.root.position.y + 1.5, me.root.position.z);
  if (shot && performance.now() > shot.until) shot = null;
  const partnerAv = shot && findAvatar(shot.partner);
  shotMix = clamp(shotMix + (shot && partnerAv ? dt * 2.5 : -dt * 2), 0, 1);
  if (shotMix > 0 && (partnerAv || lastShot)) {
    if (shot && partnerAv) lastShot = { ...shot, mid: me.root.position.clone().add(partnerAv.root.position).multiplyScalar(0.5), across: angleTo(me.root.position, partnerAv.root.position) };
    const s = lastShot, k = smooth(0, 1, shotMix);
    const pav = findAvatar(s.partner);
    const sideYaw = s.behind !== undefined && pav ? pav.root.rotation.y + Math.PI + s.behind   // behind them
      : s.across + (Math.PI / 2) * (s.side || 1);            // looking across the line between you
    let dy = sideYaw - camYaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    yaw = camYaw + dy * k; pitch = lerp(camPitch, s.pitch, k); dist = lerp(camDist, s.dist, k);
    focus.lerp(new THREE.Vector3(s.mid.x, s.mid.y + s.height, s.mid.z), k);
  }
  camTarget.lerp(focus, Math.min(1, dt * 10));
  const cp = new THREE.Vector3(
    camTarget.x + Math.sin(yaw) * Math.cos(pitch) * dist,
    camTarget.y + Math.sin(pitch) * dist,
    camTarget.z + Math.cos(yaw) * Math.cos(pitch) * dist);
  cp.y = Math.max(cp.y, heightAt(cp.x, cp.z) + 0.6);
  if (london) {
    // Don't let the camera go inside a building: bring it closer instead.
    const inside = (v) => colliders.some(([x0, z0, x1, z1]) => v.x > x0 - 0.2 && v.x < x1 + 0.2 && v.z > z0 - 0.2 && v.z < z1 + 0.2 && v.y < 14)
      || v.z > london.bounds.z1 + 0.4 || v.x < london.bounds.x0 - 0.4;
    if (inside(cp)) {
      const dir = cp.clone().sub(camTarget);
      const full = dir.length(); dir.normalize();
      let d = 0.6;
      while (d + 0.2 < full && !inside(camTarget.clone().addScaledVector(dir, d + 0.2))) d += 0.2;
      cp.copy(camTarget).addScaledVector(dir, d);
    }
  }
  camera.position.copy(cp);
  camera.lookAt(camTarget);
  // Shadows follow me
  sunLight.target.position.copy(me.root.position);
  sunLight.position.copy(me.root.position).addScaledVector(sunDir, 120);
  moonLight.target.position.copy(me.root.position);
  moonLight.position.copy(me.root.position).add(new THREE.Vector3(-60, 90, 40));
  if (water && water.material.uniforms) water.material.uniforms.time.value += dt * (london ? 0.3 : 0.6);
  if (london) london.update(dt, me.root.position, camera.position, dayFactor);
  if (noirPass) noirPass.uniforms.time.value += dt;
  if (clouds) { clouds.material.uniforms.offset.value.x += dt * 0.0012; clouds.position.x = me.root.position.x; clouds.position.z = me.root.position.z; }
  // Tell the other player (10x a second, only when something changed)
  sendT += dt;
  if (sendT > 0.1) {
    sendT = 0;
    const p = me.root.position;
    const msg = { t: 'gpos', p: [p.x, p.y, p.z], r: heading, a: anim, m: myKind };
    const key = `${p.x.toFixed(2)},${p.z.toFixed(2)},${heading.toFixed(2)},${anim}`;
    if (key !== lastSent || performance.now() - lastSentAt > 3000) { lastSent = key; lastSentAt = performance.now(); send(msg); }
  }
  if (composer) composer.render(dt); else renderer.render(scene, camera);
  adaptQuality(dt);
  labels.render(scene, camera);
  frames++; fpsT += dt;
  if (fpsT > 1) { $('fps').textContent = `${Math.round(frames / fpsT)} fps · ${qName}${weakGpu ? ' · Intel' : ''}`; $('fps').title = gpuName; frames = 0; fpsT = 0; }
}
// ---- Real motion-captured moves (your Mixamo downloads in game-assets\\Mixamo) ------------------
// Hand-picked from your Mixamo downloads (by their description), best first, for each of you.
const PICKS = {
  him: {
    idle: ['Breathing Idle', 'Weight Shift Idle', 'Standing Idle'],
    walk: ['Walking Forwards', 'Male Happy Walk', 'Walking With A Swagger'],
    run: ['Standard Running', 'Medium Speed Running', 'Running Forward Quickly'],
    dance: ['Male Partner Salsa Variation One', 'Male Salsa Variation Eight'],
    kiss: ['Kissing A Shorter Person For A Short Period', 'Kissing A Shorter Person For A Long Period'],
    blowkiss: ['Blowing A Kiss'], wave: ['Waving', 'Aj Waving Gesture'],
    flinch: ['Being Surprised And Looking Right'], laugh: ['Laughing Standing'], clap: ['Clap While Standing'], cheer: ['Celebrating After A Win'],
  },
  her: {
    idle: ['Neutral Idle', 'Happy Idle Variation 1', 'Breathing Idle'],
    walk: ['Feminine Walk Forward', 'Female Walk'],
    run: ['Female Run Forward', 'Happy Run Forward', 'Standard Running'],
    dance: ['Female Salsa Dancing', 'Female Samba Pagode Variation Five- Loop'],
    kiss: ['Kissing A Taller Person For A Short Period', 'Kissing A Taller Person For A Long Period'],
    blowkiss: ['Blowing A Kiss'], wave: ['Waving', 'Aj Waving Gesture'],
    flinch: ['Being Surprised And Looking Right'], laugh: ['Laughing Standing'], clap: ['Clap While Standing'], cheer: ['Celebrating After A Win'],
  },
};
const MOCAP = {
  // move: [words to look for (best first), words that rule a file out]
  idle: [['breathing idle', 'happy idle', 'standing idle', 'idle'], ['sword', 'rifle', 'pistol', 'gun', 'ninja', 'mutant', 'zombie', 'injured', 'fight', 'boxing', 'orc', 'dwarf', 'sit', 'crouch', 'magic', 'spell', 'drunk', 'warrior', 'to ', 'transition', 'turn']],
  walk: [['walking', 'walk'], ['sword', 'rifle', 'pistol', 'gun', 'zombie', 'injured', 'drunk', 'backward', 'strafe', 'turn', 'left', 'right', 'stairs', 'sneak', 'crouch', 'orc', 'dwarf', 'mutant', 'ninja', 'start', 'stop', 'to ']],
  run: [['running', 'run'], ['sword', 'rifle', 'pistol', 'gun', 'zombie', 'injured', 'backward', 'strafe', 'turn', 'left', 'right', 'jump', 'stop', 'start', 'slide', 'orc', 'mutant', 'ninja', 'to ']],
  dance: [['samba', 'salsa', 'dancing', 'dance'], ['slow', 'zombie', 'sword']],
  wave: [['waving', 'wave'], ['sword', 'rifle']],
  hug: [['hugging', 'hug'], []],
  kiss: [['kiss'], ['blow']],
  slap: [['slap'], []],
  flinch: [['surprised', 'flinch', 'shocked', 'startled'], ['rifle', 'sword']],
  cheer: [['cheering', 'cheer', 'victory', 'celebrat'], ['rifle', 'sword']],
};
/**
 * Safety check for standing/walking/running: on average the upper arms should hang down by the
 * sides. If they stick out forward (the "zombie" look of a badly fitted file), don't use it.
 */
const REJECTED = [];
function armsHangDown(clip, kind) {
  const m = SkeletonUtils.clone(BASE[kind]);
  const mx = new THREE.AnimationMixer(m);
  mx.clipAction(clip).play();
  const inv = FRAME[kind].clone().invert();
  let down = 0, fwd = 0, n = 0;
  for (let i = 0; i < 6; i++) {
    mx.setTime((clip.duration * (i + 0.5)) / 6);
    m.updateMatrixWorld(true);
    for (const side of ['Left', 'Right']) {
      const a = m.getObjectByName(`mixamorig${side}Arm`), b = m.getObjectByName(`mixamorig${side}ForeArm`);
      if (!a || !b) return true;
      const d = b.getWorldPosition(new THREE.Vector3()).sub(a.getWorldPosition(new THREE.Vector3())).normalize().applyQuaternion(inv);
      down += -d.y; fwd += Math.abs(d.z); n++;
    }
  }
  return down / n > 0.6 && fwd / n < 0.55;
}
async function loadMocap() {
  let list = [];
  try { list = (await (await fetch('/api/game/anims', { cache: 'no-store' })).json()).anims || []; } catch { return; }
  if (!list.length) return;
  const text = (a) => ` ${a.name} ${a.description} ${a.file} `.toLowerCase();
  const fbx = new FBXLoader();
  let got = 0;
  const byDesc = (d) => list.find((a) => a.description.toLowerCase() === d.toLowerCase());
  const byWords = (move) => {
    if (!MOCAP[move]) return null;
    const [want, avoid] = MOCAP[move];
    let best = null, bestScore = Infinity;
    for (const a of list) {
      const t = text(a);
      if (avoid.some((w) => t.includes(w))) continue;
      const i = want.findIndex((w) => t.includes(w));
      if (i < 0) continue;
      const score = i * 1000 + a.name.length;
      if (score < bestScore) { bestScore = score; best = a; }
    }
    return best;
  };
  const files = new Map(); // url -> loaded FBX (each file is loaded once)
  const moves = new Set([...Object.keys(MOCAP), ...Object.keys(PICKS.him), ...Object.keys(PICKS.her)]);
  for (const move of moves) {
    for (const kind of ['him', 'her']) {
      // The hand-picked version for this person (from the manifest), else the best name match.
      const pick = (PICKS[kind][move] || []).map(byDesc).find(Boolean) || byWords(move);
      if (!pick) continue;
      try {
        if (!files.has(pick.url)) files.set(pick.url, fbx.loadAsync(pick.url));
        const obj = await files.get(pick.url);
        const anim = obj.animations && obj.animations[0];
        if (!anim) continue;
        if (!obj.__ready) { normalizeRig(obj); obj.__fixedTPose = ensureTPose(obj); obj.__ready = true; }
        obj.updateMatrixWorld(true);
        const c = borrow(anim, { root: obj, frame: obj.__frame || (obj.__frame = bodyFrame(obj)) }, kind);
        if (['idle', 'walk', 'run'].includes(move) && !armsHangDown(c, kind)) {
          console.warn(`Not using "${pick.description}" for ${move}: the arms come out wrong (zombie pose); keeping the built-in one.`);
          REJECTED.push(`${move} (${pick.description})`);
          continue;
        }
        c.name = `${move}:${pick.description || pick.name}`;
        CLIPS[kind][move] = c;
        for (const av of [me, ...[...others.values()].map((o) => o.av)]) {
          if (av.kind !== kind) continue;
          av.setClip(move, c);
          (av.mocap || (av.mocap = new Set())).add(move);
        }
        if (!MOCAP_LOADED.has(move)) got++;
        MOCAP_LOADED.set(move, pick.description || pick.name);
      } catch (e) { console.warn('Could not use', pick.file, e.message); }
    }
  }
  if (got) toast(`🎞️ ${got} real motion-captured moves loaded${REJECTED.length ? ` · ${REJECTED.length} skipped (looked wrong)` : ''}`);
  else toast('🎞️ No Mixamo moves found yet (game-assets\\Mixamo + manifest.json)');
}
function toast(t, ms = 7000) {
  const el = document.createElement('div'); el.className = 'hud-pill game-toast'; el.textContent = t;
  const prev = document.querySelectorAll('.game-toast').length; el.style.marginTop = `${prev * 44}px`;
  document.body.appendChild(el); setTimeout(() => el.remove(), ms);
}

updateEnv(true);
setupEffects();
if (CHAR_NOTES.length) setTimeout(() => toast(CHAR_NOTES.join('  ·  ')), 400);
loadMocap();
$('loading').classList.add('hidden');
renderer.setAnimationLoop(tick);
window.__game = { london, peds, xbot, XBOT_REST, normalizeRig, ensureTPose, isTPose, doAct, MOCAP_LOADED, loadMocap, borrow, bodyFrame, FRAME, CLIPS, BASE, SKEL, soldier, michelle, SkeletonUtils, shotOff: () => { shot = null; shotMix = 0; }, forceShot: () => { shotMix = 1; }, setHeading: (h) => { heading = h; }, me, others, scene, camera, renderer, labels, tick, setCam: (yaw, pitch, dist) => { camYaw = yaw; camPitch = pitch; camDist = dist; camTarget.copy(me.root.position).y += 1.5; }, setTime: (t) => { dayT = t; updateEnv(true); }, step: (n = 1) => { for (let i = 0; i < n; i++) tick(); } };
