/* Our World - a first look test: a little valley with our house, a lake, trees, a sun that
 * moves (day and night), and the two of us walking around together.
 * 3D engine: three.js. Models & textures come from the laptop (/game-assets/). */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Sky } from 'three/addons/objects/Sky.js';
import { Water } from 'three/addons/objects/Water.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';

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
  high: { pr: Math.min(devicePixelRatio, 1.5), shadows: true, shadowSize: 2048, water: true, trees: 220, grass: 26000, segs: 220, env: true, aa: true, far: 700 },
  medium: { pr: Math.min(devicePixelRatio, 1), shadows: true, shadowSize: 1024, water: true, trees: 140, grass: 0, segs: 150, env: true, aa: true, far: 500 },
  low: { pr: Math.min(devicePixelRatio, 0.85), shadows: false, shadowSize: 512, water: false, trees: 80, grass: 0, segs: 90, env: false, aa: false, far: 320 },
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
const labels = new CSS2DRenderer({ element: $('labels') });
labels.setSize(innerWidth, innerHeight);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xbfd4e6, 60, Q.far);
const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 3000);
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight); labels.setSize(innerWidth, innerHeight);
});

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
scene.add(terrain);

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
scene.add(water);

// ---- Sky, sun, moon, stars -------------------------------------------------------------------
const sky = new Sky();
sky.scale.setScalar(4000);
Object.assign(sky.material.uniforms, {});
sky.material.uniforms.turbidity.value = 6;
sky.material.uniforms.rayleigh.value = 1.6;
sky.material.uniforms.mieCoefficient.value = 0.004;
sky.material.uniforms.mieDirectionalG.value = 0.8;
scene.add(sky);
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
scene.add(stars);
const pmrem = new THREE.PMREMGenerator(renderer);
const envScene = new THREE.Scene();
const envSky = new Sky();
envSky.scale.setScalar(1000);
envScene.add(envSky);
let envRT = null;

// ---- The house ------------------------------------------------------------------------------------
const colliders = []; // axis-aligned boxes: [minX, minZ, maxX, maxZ]
const circles = [];   // trees & rocks: [x, z, r]
const brick = new THREE.MeshStandardMaterial({ map: tex('brick_diffuse.jpg', 1, true), bumpMap: tex('brick_bump.jpg'), bumpScale: 2, roughnessMap: tex('brick_roughness.jpg'), roughness: 1, color: 0xf2e2d6 });
const wood = new THREE.MeshStandardMaterial({ map: tex('wood_diffuse.jpg', 1, true), bumpMap: tex('wood_bump.jpg'), bumpScale: 1, roughnessMap: tex('wood_roughness.jpg'), roughness: 1 });
const roofMat = new THREE.MeshStandardMaterial({ color: 0x4a3a36, roughness: 0.85, roughnessMap: tex('disturb.jpg', 3) });
const trimMat = new THREE.MeshStandardMaterial({ color: 0xf6eedf, roughness: 0.6 });
const windowMat = new THREE.MeshStandardMaterial({ color: 0x2a3a4c, roughness: 0.04, metalness: 0.7, emissive: 0xffb45c, emissiveIntensity: 0 });
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
for (const [x, z, ry] of [[-3, D / 2 + 0.16, 0], [3, D / 2 + 0.16, 0], [-W / 2 - 0.16, -1.5, Math.PI / 2], [W / 2 + 0.16, 1.5, Math.PI / 2], [-2.5, -D / 2 - 0.16, 0], [2.5, -D / 2 - 0.16, 0]]) {
  const fr = box(1.7, 1.4, 0.1, trimMat, x, 2.0, z, { shadow: false }); fr.rotation.y = ry;
  const gl = box(1.45, 1.15, 0.12, windowMat, x, 2.0, z, { shadow: false }); gl.rotation.y = ry;
}
// Gable roof
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
scene.add(path);

// ---- Trees & rocks (instanced: one draw call each) --------------------------------------------
{
  const rnd = (() => { let s = 1234567; return () => ((s = (s * 16807) % 2147483647) / 2147483647); })();
  const spots = [];
  for (let tries = 0; spots.length < Q.trees && tries < 6000; tries++) {
    const x = (rnd() - 0.5) * SIZE * 0.85, z = (rnd() - 0.5) * SIZE * 0.85;
    const d = Math.hypot(x, z);
    if (d < 26 || Math.hypot(x - LAKE.x, z - LAKE.y) < LAKE_R + 6 || (Math.abs(x) < 3 && z > 0 && z < 20)) continue;
    if (heightAt(x, z) > 20) continue;
    spots.push([x, z, 0.75 + rnd() * 0.7]);
  }
  const trunkGeo = new THREE.CylinderGeometry(0.18, 0.32, 3.2, 7); trunkGeo.translate(0, 1.6, 0);
  const crownGeo = new THREE.IcosahedronGeometry(1.9, 3);
  { const p = crownGeo.attributes.position; for (let i = 0; i < p.count; i++) { const v = new THREE.Vector3().fromBufferAttribute(p, i); v.multiplyScalar(1 + (noise(v.x * 1.3 + 5, v.z * 1.3 + v.y) - 0.5) * 0.45); v.y *= 1.15; p.setXYZ(i, v.x, v.y, v.z); } crownGeo.computeVertexNormals(); crownGeo.translate(0, 4.4, 0); }
  const trunks = new THREE.InstancedMesh(trunkGeo, new THREE.MeshStandardMaterial({ color: 0x5b4330, roughness: 1, map: tex('disturb.jpg', 1) }), spots.length);
  const crowns = new THREE.InstancedMesh(crownGeo, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 }), spots.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), c = new THREE.Color();
  spots.forEach(([x, z, s], i) => {
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rnd() * Math.PI * 2);
    sc.set(s, s * (0.9 + rnd() * 0.3), s);
    m.compose(new THREE.Vector3(x, heightAt(x, z) - 0.1, z), q, sc);
    trunks.setMatrixAt(i, m); crowns.setMatrixAt(i, m);
    crowns.setColorAt(i, c.setHSL(0.27 + rnd() * 0.06, 0.55 + rnd() * 0.2, 0.05 + rnd() * 0.05));
    circles.push([x, z, 0.45 * s]);
  });
  for (const im of [trunks, crowns]) { im.castShadow = true; im.receiveShadow = true; scene.add(im); }
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
const [soldier, michelle] = await Promise.all([gltf.loadAsync('/game-assets/Soldier.glb'), gltf.loadAsync('/game-assets/Michelle.glb')]);
const clip = (g, name) => g.animations.find((a) => a.name === name);
// The walk/run/idle come from the Soldier; Michelle borrows them (same skeleton), and both of us
// can do Michelle's samba. Position tracks are dropped when borrowing (different body sizes).
const borrow = (c) => { const cl = c.clone(); cl.tracks = cl.tracks.filter((t) => !t.name.endsWith('.position')); return cl; };
const CLIPS = {
  him: { idle: clip(soldier, 'Idle'), walk: clip(soldier, 'Walk'), run: clip(soldier, 'Run'), dance: borrow(clip(michelle, 'SambaDance')) },
  her: { idle: borrow(clip(soldier, 'Idle')), walk: borrow(clip(soldier, 'Walk')), run: borrow(clip(soldier, 'Run')), dance: clip(michelle, 'SambaDance') },
};
const BASE = { him: soldier.scene, her: michelle.scene };
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
    this.model.rotation.y = Math.PI; // the models face the other way
    this.root.add(this.model);
    scene.add(this.root);
    this.mixer = new THREE.AnimationMixer(this.model);
    this.actions = Object.fromEntries(Object.entries(CLIPS[kind]).map(([k, c]) => [k, this.mixer.clipAction(c)]));
    this.current = 'idle';
    this.actions.idle.play();
    const tag = document.createElement('div'); tag.className = 'nametag'; tag.textContent = petName(name);
    this.tag = new CSS2DObject(tag); this.tag.position.set(0, HEIGHT[kind] + 0.35, 0);
    this.root.add(this.tag);
  }
  play(name) {
    if (name === this.current || !this.actions[name]) return;
    const from = this.actions[this.current], to = this.actions[name];
    to.reset().setEffectiveWeight(1).play();
    from.crossFadeTo(to, 0.25, false);
    this.current = name;
  }
  heart(symbol = '💋') {
    const el = document.createElement('div'); el.className = 'float-heart'; el.textContent = symbol;
    const o = new CSS2DObject(el); o.position.set(0, HEIGHT[this.kind] + 0.6, 0);
    this.root.add(o);
    setTimeout(() => { this.root.remove(o); el.remove(); }, 2400);
  }
  dispose() { scene.remove(this.root); this.tag.element.remove(); }
}

const me = new Avatar(myKind, myName);
me.root.position.set(HX + (myKind === 'him' ? -1 : 1), 0, HZ + D / 2 + 3);
me.root.position.y = heightAt(me.root.position.x, me.root.position.z);
let heading = Math.PI; // facing away from the house, toward the path
const others = new Map();

// ---- Controls --------------------------------------------------------------------------------
const keys = new Set();
let camYaw = 0, camPitch = 0.32, camDist = 6.5, dancing = false, runToggle = false;
const stick = { x: 0, y: 0, active: false };
addEventListener('keydown', (e) => {
  keys.add(e.code);
  if (e.code === 'KeyG') toggleDance();
  if (e.code === 'KeyK') blowKiss();
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
function blowKiss() { me.heart('💋'); send({ t: 'gemote', e: 'kiss' }); }
$('tRun').onclick = () => { runToggle = !runToggle; $('tRun').classList.toggle('on', runToggle); };
$('tDance').onclick = toggleDance; $('dDance').onclick = toggleDance;
$('tKiss').onclick = blowKiss; $('dKiss').onclick = blowKiss;

// ---- Time of day -------------------------------------------------------------------------------
const DAY_SECONDS = 8 * 60; // one day = 8 minutes in this test
let dayT = 0.36;            // morning
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
  hemi.intensity = 0.26 + 0.42 * day;
  hemi.color.setHSL(0.6, 0.5, 0.35 + 0.45 * day);
  renderer.toneMappingExposure = 0.42 + 0.18 * day;
  stars.material.opacity = 1 - smooth(-0.15, 0.08, elev);
  const night = 1 - day;
  windowMat.emissiveIntensity = night * 0.75;
  lampLight.intensity = night * 14;
  porchLight.intensity = night * 10;
  porchBulb.material.emissiveIntensity = night * 3;
  scene.fog.color.setHSL(0.58, 0.35 - golden * 0.1, 0.08 + 0.7 * day).lerp(new THREE.Color(0xf2b27a), golden * day * 0.35);
  if (water.material.uniforms) water.material.uniforms.sunDirection.value.copy(sunDir);
  $('timeBtn').textContent = day > 0.5 ? '🌙' : '☀️';
  // Reflections & soft sky light (every couple of in-game minutes)
  if (Q.env && (force || Math.abs(dayT - envAt) > 0.015)) {
    envAt = dayT;
    envSky.material.uniforms.sunPosition.value.copy(sunDir);
    for (const k of ['turbidity', 'rayleigh', 'mieCoefficient', 'mieDirectionalG']) envSky.material.uniforms[k].value = sky.material.uniforms[k].value;
    if (envRT) envRT.dispose();
    envRT = pmrem.fromScene(envScene);
    scene.environment = envRT.texture;
    scene.environmentIntensity = 0.15 + 0.4 * day;
  }
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
      o.target.set(...m.p); o.rot = m.r; o.av.play(m.a); o.seen = performance.now();
      updatePartner();
    } else if (m.t === 'gemote' && others.has(m.from)) others.get(m.from).av.heart(m.e === 'kiss' ? '💋' : '💖');
    else if (m.t === 'gleave' && others.has(m.from)) { others.get(m.from).av.dispose(); others.delete(m.from); updatePartner(); }
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
let sendT = 0, lastSent = '', fpsT = 0, frames = 0;
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
  const mag = Math.min(1, Math.hypot(ix, iy));
  const running = keys.has('ShiftLeft') || keys.has('ShiftRight') || runToggle || (stick.active && mag > 0.92);
  let anim = dancing ? 'dance' : 'idle';
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
  me.root.position.y = heightAt(me.root.position.x, me.root.position.z);
  me.root.rotation.y = heading;
  me.play(anim);
  me.mixer.update(dt);
  // The other player: glide to where they are
  for (const o of others.values()) {
    o.av.root.position.lerp(o.target, Math.min(1, dt * 8));
    let diff = o.rot - o.av.root.rotation.y; diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    o.av.root.rotation.y += diff * Math.min(1, dt * 8);
    o.av.mixer.update(dt);
  }
  // Camera follows behind
  camTarget.lerp(new THREE.Vector3(me.root.position.x, me.root.position.y + 1.5, me.root.position.z), Math.min(1, dt * 10));
  const cp = new THREE.Vector3(
    camTarget.x + Math.sin(camYaw) * Math.cos(camPitch) * camDist,
    camTarget.y + Math.sin(camPitch) * camDist,
    camTarget.z + Math.cos(camYaw) * Math.cos(camPitch) * camDist);
  cp.y = Math.max(cp.y, heightAt(cp.x, cp.z) + 0.6);
  camera.position.copy(cp);
  camera.lookAt(camTarget);
  // Shadows follow me
  sunLight.target.position.copy(me.root.position);
  sunLight.position.copy(me.root.position).addScaledVector(sunDir, 120);
  moonLight.target.position.copy(me.root.position);
  moonLight.position.copy(me.root.position).add(new THREE.Vector3(-60, 90, 40));
  if (water.material.uniforms) water.material.uniforms.time.value += dt * 0.6;
  // Tell the other player (10x a second, only when something changed)
  sendT += dt;
  if (sendT > 0.1) {
    sendT = 0;
    const p = me.root.position;
    const msg = { t: 'gpos', p: [p.x, p.y, p.z], r: heading, a: anim, m: myKind };
    const key = `${p.x.toFixed(2)},${p.z.toFixed(2)},${heading.toFixed(2)},${anim}`;
    if (key !== lastSent) { lastSent = key; send(msg); }
  }
  renderer.render(scene, camera);
  labels.render(scene, camera);
  frames++; fpsT += dt;
  if (fpsT > 1) { $('fps').textContent = `${Math.round(frames / fpsT)} fps · ${qName}`; frames = 0; fpsT = 0; }
}
updateEnv(true);
$('loading').classList.add('hidden');
renderer.setAnimationLoop(tick);
window.__game = { me, others, scene, camera, renderer, labels, tick, setCam: (yaw, pitch, dist) => { camYaw = yaw; camPitch = pitch; camDist = dist; camTarget.copy(me.root.position).y += 1.5; }, setTime: (t) => { dayT = t; updateEnv(true); }, step: (n = 1) => { for (let i = 0; i < n; i++) tick(); } };
