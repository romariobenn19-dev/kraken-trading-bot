/* Our World - a rainy winter night in London (noir).
 *
 * A street of Victorian brick terraces (your house is one of them), wet asphalt and paving
 * that reflect the lamps, gas-style street lamps with pools of warm light, rain, fog, bare
 * plane trees, a red phone box and post box, and the Embankment with the Thames and the
 * Elizabeth Tower (Big Ben) glowing in the mist across the river.
 *
 * Street layout (metres): your front door faces +Z. Near pavement z 4.25..9, road 9..19,
 * far pavement 19..23.75, far terrace from 23.75. The Embankment and river are east (+X).
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Water } from 'three/addons/objects/Water.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { plantBareTrees } from './trees.js';

const PAVE = 0.12;                 // pavement height above the road
const NEAR_FRONT = 4.25, KERB_N = 9, KERB_F = 19, FAR_FRONT = 23.75;
const X_WEST = -86, X_ROAD_END = 84, X_RIVER = 92;

function rng(seed) { let s = seed % 2147483647; if (s <= 0) s += 2147483646; return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646; }
const canvasTex = (w, h, draw, { repeat = [1, 1], color = true } = {}) => {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...repeat);
  if (color) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
};

// ---- Textures made in code -------------------------------------------------------------------
function asphaltTextures() {
  // 40 m of road (x) by 10 m (z), 51.2 px per metre.
  const W = 2048, H = 512, ppm = 51.2;
  const r = rng(11);
  const map = canvasTex(W, H, (g) => {
    g.fillStyle = '#2b2d31'; g.fillRect(0, 0, W, H);
    for (let i = 0; i < 26000; i++) { const v = 30 + r() * 35; g.fillStyle = `rgba(${v},${v},${v + 4},${0.35 + r() * 0.4})`; g.fillRect(r() * W, r() * H, 1 + r() * 2.5, 1 + r() * 2.5); }
    for (let i = 0; i < 14; i++) { g.strokeStyle = 'rgba(15,15,18,.55)'; g.lineWidth = 1 + r() * 2; g.beginPath(); let x = r() * W, y = r() * H; g.moveTo(x, y); for (let k = 0; k < 8; k++) { x += (r() - 0.5) * 120; y += (r() - 0.5) * 40; g.lineTo(x, y); } g.stroke(); } // cracks / tar seams
    // Centre line (white dashes) and double yellow lines by both kerbs.
    g.fillStyle = 'rgba(225,225,215,.82)';
    for (let x = 0; x < W; x += 6 * ppm) g.fillRect(x, H / 2 - 0.06 * ppm, 3 * ppm, 0.12 * ppm);
    g.fillStyle = 'rgba(214,170,40,.85)';
    for (const y of [0.25, 0.42, 10 - 0.42 - 0.1, 10 - 0.25 - 0.1]) g.fillRect(0, y * ppm, W, 0.1 * ppm);
  });
  // Roughness: wet everywhere, puddles mirror-smooth.
  const rough = canvasTex(W, H, (g) => {
    g.fillStyle = 'rgb(120,120,120)'; g.fillRect(0, 0, W, H);
    for (let i = 0; i < 70; i++) {
      const x = r() * W, y = r() * H, rr = 20 + r() * 90;
      const grd = g.createRadialGradient(x, y, 0, x, y, rr); grd.addColorStop(0, 'rgb(14,14,14)'); grd.addColorStop(0.7, 'rgb(30,30,30)'); grd.addColorStop(1, 'rgba(120,120,120,0)');
      g.fillStyle = grd; g.beginPath(); g.ellipse(x, y, rr * (1 + r()), rr * 0.6, r() * 3, 0, Math.PI * 2); g.fill();
    }
    // Gutters along both kerbs hold water.
    for (const y of [0, H - 18]) { g.fillStyle = 'rgb(20,20,20)'; g.fillRect(0, y, W, 18); }
  }, { color: false });
  return { map, rough };
}
function pavingTextures() {
  // Grey paving slabs (0.9 m), 128 px per metre, 4 x 4 m tile.
  const S = 512, ppm = 128, r = rng(5);
  const map = canvasTex(S, S, (g) => {
    g.fillStyle = '#5d5f62'; g.fillRect(0, 0, S, S);
    const slab = 0.9 * ppm;
    for (let y = 0; y < S; y += slab) for (let x = 0; x < S; x += slab) {
      const v = 82 + r() * 26; g.fillStyle = `rgb(${v},${v + 1},${v + 4})`; g.fillRect(x + 2, y + 2, slab - 4, slab - 4);
      for (let i = 0; i < 60; i++) { const w = v - 15 + r() * 25; g.fillStyle = `rgba(${w},${w},${w},.5)`; g.fillRect(x + r() * slab, y + r() * slab, 2, 2); }
    }
  }, { repeat: [1, 1] });
  const rough = canvasTex(S, S, (g) => {
    g.fillStyle = 'rgb(150,150,150)'; g.fillRect(0, 0, S, S);
    for (let i = 0; i < 18; i++) { const x = r() * S, y = r() * S, rr = 15 + r() * 50; const grd = g.createRadialGradient(x, y, 0, x, y, rr); grd.addColorStop(0, 'rgb(25,25,25)'); grd.addColorStop(1, 'rgba(150,150,150,0)'); g.fillStyle = grd; g.fillRect(x - rr, y - rr, rr * 2, rr * 2); }
    g.strokeStyle = 'rgb(40,40,40)'; g.lineWidth = 3; // water sits in the joints
    for (let p = 0; p < S; p += 0.9 * ppm) { g.beginPath(); g.moveTo(p, 0); g.lineTo(p, S); g.moveTo(0, p); g.lineTo(S, p); g.stroke(); }
  }, { color: false });
  return { map, rough };
}
const lightPoolTexture = () => canvasTex(256, 256, (g) => {
  const grd = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  grd.addColorStop(0, 'rgba(255,190,110,1)'); grd.addColorStop(0.35, 'rgba(255,170,90,.45)'); grd.addColorStop(1, 'rgba(255,150,70,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 256, 256);
});
function clockFaceTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  t.draw = (now = new Date()) => {
    const g = c.getContext('2d');
    g.clearRect(0, 0, 256, 256);
    g.fillStyle = '#f4e3b0'; g.beginPath(); g.arc(128, 128, 120, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#3a2a14'; g.lineWidth = 6; g.stroke();
    g.fillStyle = '#3a2a14';
    for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; g.save(); g.translate(128, 128); g.rotate(a); g.fillRect(-3, -112, 6, 18); g.restore(); }
    const hand = (a, len, w) => { g.save(); g.translate(128, 128); g.rotate(a); g.fillRect(-w / 2, -len, w, len + 10); g.restore(); };
    // London time
    let h = now.getHours(), m = now.getMinutes();
    try { const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: 'numeric', minute: 'numeric', hour12: false }).formatToParts(now); h = +p.find((x) => x.type === 'hour').value; m = +p.find((x) => x.type === 'minute').value; } catch { /* local time */ }
    hand(((h % 12) + m / 60) / 12 * Math.PI * 2, 62, 9);
    hand((m / 60) * Math.PI * 2, 96, 5);
    t.needsUpdate = true;
  };
  t.draw();
  return t;
}
function phoneBoxTexture() {
  // One side of a red telephone box: red frame, small glass panes lit from inside, the sign at the top.
  return canvasTex(128, 320, (g) => {
    g.fillStyle = '#b5121b'; g.fillRect(0, 0, 128, 320);
    g.fillStyle = '#f2ead2'; g.fillRect(14, 8, 100, 22);
    g.fillStyle = '#111'; g.font = 'bold 15px sans-serif'; g.textAlign = 'center'; g.fillText('TELEPHONE', 64, 25);
    g.fillStyle = '#ffd98a';
    for (let row = 0; row < 8; row++) for (let col = 0; col < 3; col++) g.fillRect(18 + col * 31, 44 + row * 30, 26, 25);
  });
}

// ---- Photographed materials (Poly Haven, CC0) ------------------------------------------------
// Every textured surface here has 1 texture unit = 3 m (see box()). Each material keeps its
// code-made look until the real images arrive, then switches over, so a failed download never
// leaves anything black.
const UV_M = 3;
const phLoader = new THREE.TextureLoader();
let PH_RES = '1k'; // 2k on High (set in buildLondon)
const phCache = new Map();
function phTex(id, kind, sizeM) {
  const key = `${id}_${kind}`;
  if (!phCache.has(key)) {
    phCache.set(key, new Promise((ok, fail) => phLoader.load(`/game-assets/ph_${id}_${kind}${PH_RES === '1k' ? '' : '_' + PH_RES}.jpg`, (t) => {
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.repeat.set(UV_M / sizeM, UV_M / sizeM);
      t.anisotropy = 8;
      if (kind === 'diff') t.colorSpace = THREE.SRGBColorSpace;
      ok(t);
    }, undefined, fail)));
  }
  return phCache.get(key);
}
/** Give `mat` a real photographed surface: id = Poly Haven texture, sizeM = metres one image covers. */
export function photo(mat, id, sizeM, { normal = 1, rough = 1, ao = 1 } = {}) {
  Promise.all(['diff', 'nor_gl', 'arm'].map((k) => phTex(id, k, sizeM))).then(([diff, nor, arm]) => {
    mat.map = diff;
    mat.normalMap = nor; mat.normalScale.set(normal, normal);
    mat.roughnessMap = arm; mat.roughness = rough;   // (green channel)
    mat.aoMap = arm; mat.aoMapIntensity = ao;         // (red channel): mortar lines and cracks stay dark
    mat.metalnessMap = null; mat.metalness = 0;
    mat.bumpMap = null;
    mat.needsUpdate = true;
  }).catch(() => { /* keep the code-made look */ });
  return mat;
}

// ---- Real 3D models (Poly Haven, CC0) ----------------------------------------------------------
const gltfLoader = new GLTFLoader();
const modelCache = new Map();
function loadModel(id) {
  if (!modelCache.has(id)) modelCache.set(id, gltfLoader.loadAsync(`/game-assets/ph_models/${id}/${id}_1k.gltf`).then((g) => { g.scene.updateMatrixWorld(true); return g.scene; }));
  return modelCache.get(id);
}
/** Put one copy of model `id` at each matrix (one draw call per part). Resolves to the meshes. */
function placeModel(scene, id, matrices, { shadow = false, onMaterial } = {}) {
  return loadModel(id).then((root) => {
    const out = [];
    root.traverse((o) => {
      if (!o.isMesh) return;
      if (onMaterial) onMaterial(o.material);
      const im = new THREE.InstancedMesh(o.geometry, o.material, matrices.length);
      const m = new THREE.Matrix4();
      matrices.forEach((mt, i) => im.setMatrixAt(i, m.multiplyMatrices(mt, o.matrixWorld)));
      im.castShadow = shadow; im.receiveShadow = true;
      im.computeBoundingSphere();
      scene.add(im); out.push(im);
    });
    return out;
  });
}
/** Lit window: warm room light with curtains half drawn. */
export function curtainTexture() {
  return canvasTex(128, 256, (g, w, h) => {
    const bg = g.createRadialGradient(w / 2, h * 0.45, 10, w / 2, h * 0.45, h * 0.7);
    bg.addColorStop(0, '#ffd9a0'); bg.addColorStop(0.6, '#d8924a'); bg.addColorStop(1, '#6a3a1c');
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    for (const [x0, x1] of [[0, w * 0.26], [w * 0.74, w]]) {
      for (let x = x0; x < x1; x += 4) { const v = 70 + 35 * Math.sin(x * 0.9); g.fillStyle = `rgb(${v + 12},${v * 0.86},${v * 0.7})`; g.fillRect(x, 0, 4, h); }
    }
    g.fillStyle = 'rgba(40,20,10,.55)'; g.fillRect(0, 0, w, h * 0.06); // pelmet
  }, { repeat: [1, 1] });
}

// ---- Light texture layout -----------------------------------------------------------------------
// Every face of the street gets its own patch of one 2048 x 2048 texture (a second set of texture
// coordinates, uv1), sized by how much it's seen: house fronts and the ground get the most detail,
// party walls, backs and roofs much less. Things outside the street share one small corner patch.
const LM = 2048, LM_PAD = 3, LM_CORNER = 8;
function lightmapUVs(geos) {
  const inStreet = (x, z) => x > X_WEST - 14 && x < X_RIVER + 3 && z > -32 && z < FAR_FRONT + 26;
  const zMid = (KERB_N + KERB_F) / 2;
  const charts = [], corner = [];
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3();
  const UVAX = [[2, 1], [0, 2], [0, 1]]; // which world axes a face along x / y / z is laid out with
  geos.forEach((g, gi) => {
    const pos = g.attributes.position;
    const uv1 = new Float32Array(pos.count * 2);
    g.setAttribute('uv1', new THREE.BufferAttribute(uv1, 2));
    const byKey = new Map();
    for (let t = 0; t < pos.count / 3; t++) {
      a.fromBufferAttribute(pos, t * 3); b.fromBufferAttribute(pos, t * 3 + 1); c.fromBufferAttribute(pos, t * 3 + 2);
      n.crossVectors(e1.subVectors(b, a), e2.subVectors(c, a));
      const cx = (a.x + b.x + c.x) / 3, cy = (a.y + b.y + c.y) / 3, cz = (a.z + b.z + c.z) / 3;
      if (!inStreet(cx, cz)) { corner.push([g, t]); continue; }
      const ax = Math.abs(n.x) >= Math.abs(n.y) && Math.abs(n.x) >= Math.abs(n.z) ? 0 : Math.abs(n.y) >= Math.abs(n.z) ? 1 : 2;
      const sign = n.getComponent(ax) >= 0 ? 1 : -1;
      const [ua, va] = UVAX[ax];
      const cu = [cx, cy, cz][ua], cv = [cx, cy, cz][va];
      const key = `${ax}${sign}|${Math.floor(cu / 24)}|${Math.floor(cv / 24)}`;
      let ch = byKey.get(key);
      if (!ch) {
        // How much detail: fronts facing the street and the ground get the most.
        let f;
        if (ax === 1) f = sign > 0 ? (cy < 0.6 ? 1 : 0.3) : 0.12;
        else if (ax === 2) f = sign * (zMid - cz) > 0 || cz < -5 ? 1 : 0.25;
        else f = 0.3;
        ch = { g, gi, ua, va, tris: [], u0: Infinity, v0: Infinity, u1: -Infinity, v1: -Infinity, f };
        byKey.set(key, ch); charts.push(ch);
      }
      ch.tris.push(t);
      for (const p of [a, b, c]) {
        const u = p.getComponent(ua), v = p.getComponent(va);
        ch.u0 = Math.min(ch.u0, u); ch.u1 = Math.max(ch.u1, u); ch.v0 = Math.min(ch.v0, v); ch.v1 = Math.max(ch.v1, v);
      }
    }
  });
  // Shelf packing, shrinking the detail until everything fits.
  let area = 0; for (const ch of charts) area += (ch.u1 - ch.u0) * (ch.v1 - ch.v0) * ch.f * ch.f;
  let d = Math.sqrt((0.72 * LM * LM) / Math.max(1, area)), placed = null;
  const order = charts.map((ch, i) => i);
  for (let tries = 0; tries < 40 && !placed; tries++) {
    const size = charts.map((ch) => [Math.max(1, Math.ceil((ch.u1 - ch.u0) * d * ch.f)) + LM_PAD * 2, Math.max(1, Math.ceil((ch.v1 - ch.v0) * d * ch.f)) + LM_PAD * 2]);
    order.sort((i, j) => size[j][1] - size[i][1] || i - j);
    let x = LM_CORNER, y = 0, rowH = LM_CORNER, ok = true;
    const at = new Array(charts.length);
    for (const i of order) {
      const [w, h] = size[i];
      if (x + w > LM) { x = 0; y += rowH; rowH = 0; }
      if (y + h > LM || w > LM) { ok = false; break; }
      at[i] = [x, y]; x += w; rowH = Math.max(rowH, h);
    }
    if (ok) placed = at; else d *= 0.94;
  }
  const p = new THREE.Vector3();
  charts.forEach((ch, i) => {
    const [x, y] = placed[i];
    const pos = ch.g.attributes.position, uv1 = ch.g.attributes.uv1.array, s = d * ch.f;
    for (const t of ch.tris) for (let k = 0; k < 3; k++) {
      p.fromBufferAttribute(pos, t * 3 + k);
      uv1[(t * 3 + k) * 2] = (x + LM_PAD + (p.getComponent(ch.ua) - ch.u0) * s) / LM;
      uv1[(t * 3 + k) * 2 + 1] = (y + LM_PAD + (p.getComponent(ch.va) - ch.v0) * s) / LM;
    }
  });
  for (const [g, t] of corner) { const uv1 = g.attributes.uv1.array; for (let k = 0; k < 3; k++) { uv1[(t * 3 + k) * 2] = (LM_CORNER / 2) / LM; uv1[(t * 3 + k) * 2 + 1] = (LM_CORNER / 2) / LM; } }
  // A fingerprint of the layout: the light textures only fit this exact street.
  let h = 2166136261 >>> 0;
  const mix = (v) => { h = Math.imul(h ^ (Math.round(v * 100) | 0), 16777619) >>> 0; };
  mix(charts.length); mix(d);
  for (const g of geos) { const arr = g.attributes.position.array; mix(arr.length); for (let i = 0; i < arr.length; i += 97) mix(arr[i]); }
  return { hash: h.toString(16), density: d };
}

// ---- Geometry helpers -------------------------------------------------------------------------
/** A box whose texture coordinates are in metres / tile (so brick looks the same size everywhere). */
function box(w, h, d, x, y, z, tile = 3) {
  const seg = (v) => Math.max(1, Math.ceil(v / 10)); // long faces in 10 m pieces (for the light textures)
  const g = new THREE.BoxGeometry(w, h, d, seg(w), seg(h), seg(d));
  const uv = g.attributes.uv;
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]]; // +x -x +y -y +z -z
  g.groups.forEach((gr, f) => {
    const vs = new Set(); for (let k = gr.start; k < gr.start + gr.count; k++) vs.add(g.index.getX(k));
    for (const i of vs) uv.setXY(i, uv.getX(i) * dims[f][0] / tile, uv.getY(i) * dims[f][1] / tile);
  });
  g.translate(x, y, z);
  return g;
}

export function buildLondon({ scene, Q, qName, tex, colliders, circles, house: H }) {
  const lowQ = qName === 'low';
  PH_RES = qName === 'high' ? '2k' : '1k';
  const groups = new Map(); // material -> [geometries] (merged at the end: few draw calls)
  const add = (mat, geo) => { if (!groups.has(mat)) groups.set(mat, []); groups.get(mat).push(geo); };

  // ---- Materials --------------------------------------------------------------------------------
  const brickMaps = { map: tex('brick_diffuse.jpg', 1, true), bumpMap: tex('brick_bump.jpg'), roughnessMap: tex('brick_roughness.jpg') };
  const bricks = [0x8f5a48, 0xb59a74, 0x6f4a3e, 0x9c7f6a].map((c) => new THREE.MeshStandardMaterial({ ...brickMaps, color: c, bumpScale: 1.5, roughness: 0.9 }));
  // London stock brick (yellow-grey), red brick and old mixed brick; wet, so a little shinier.
  photo(bricks[0], 'red_brick_03', 1.0, { rough: 0.8 }); bricks[0].color.set(0xc8b8b0);
  photo(bricks[1], 'yellow_brick', 2.0, { rough: 0.8 }); bricks[1].color.set(0xffffff);
  photo(bricks[2], 'brick_wall_02', 2.0, { rough: 0.8 }); bricks[2].color.set(0xb8aca4);
  photo(bricks[3], 'yellow_brick', 2.0, { rough: 0.8 }); bricks[3].color.set(0xd8d0c8);
  const stucco = photo(new THREE.MeshStandardMaterial({ color: 0xd8d2c4, roughness: 0.75 }), 'white_stucco', 2.0, { rough: 0.7, normal: 2 });
  stucco.color.set(0x8f8b84); // painted stucco, grimy with London rain (not bright white panels)
  const stone = photo(new THREE.MeshStandardMaterial({ color: 0x8d8a83, roughness: 0.85 }), 'granite_tile', 2.3, { rough: 0.6 });
  const iron = new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.35, metalness: 0.6 });
  const slate = photo(new THREE.MeshStandardMaterial({ color: 0x2c2f35, roughness: 0.6 }), 'roof_slates_03', 3.0, { rough: 0.5 });
  const pot = new THREE.MeshStandardMaterial({ color: 0x8a4a32, roughness: 0.9 });
  const frameMat = new THREE.MeshStandardMaterial({ color: 0xe9e6dc, roughness: 0.6 });
  const glassDark = new THREE.MeshStandardMaterial({ color: 0x0d1117, roughness: 0.05, metalness: 0.8 });
  const glassLit = new THREE.MeshStandardMaterial({ color: 0x2b2116, roughness: 0.2, metalness: 0.2, emissive: 0xffe0b8, emissiveMap: curtainTexture(), emissiveIntensity: 1.1 });
  const trimMat = new THREE.MeshStandardMaterial({ color: 0xbdb6a8, roughness: 0.65 });   // painted stucco trim
  const brass = new THREE.MeshStandardMaterial({ color: 0xb8913a, roughness: 0.3, metalness: 1 });
  const doorMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35, metalness: 0.1 });

  // ---- Ground: road, pavements, kerbs ------------------------------------------------------------
  const asphalt = asphaltTextures();
  asphalt.map.repeat.set(UV_M / 40, UV_M / 10); asphalt.rough.repeat.copy(asphalt.map.repeat);
  const road = new THREE.Mesh(new THREE.PlaneGeometry(X_ROAD_END - X_WEST, KERB_F - KERB_N, Math.ceil((X_ROAD_END - X_WEST) / 10), 1), new THREE.MeshStandardMaterial({
    map: asphalt.map, roughnessMap: asphalt.rough, roughness: 0.85, metalness: 0.05, color: 0xb0b0b0,
  }));
  // Real worn asphalt, kept wet (low roughness) so the lamps reflect in it.
  { const uv = road.geometry.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (X_ROAD_END - X_WEST) / UV_M, uv.getY(i) * (KERB_F - KERB_N) / UV_M); }
  photo(road.material, 'asphalt_02', 3.0, { rough: 0.42, normal: 0.8 }); road.material.color.set(0x9a9a9a);
  road.geometry.rotateX(-Math.PI / 2);
  road.geometry.translate((X_WEST + X_ROAD_END) / 2, 0, (KERB_N + KERB_F) / 2);
  const roadMat = road.material;
  add(roadMat, road.geometry);
  // Painted lines: double yellows along both kerbs, a dashed white line down the middle.
  {
    const yellow = new THREE.MeshStandardMaterial({ color: 0xc9a227, roughness: 0.5 });
    const white = new THREE.MeshStandardMaterial({ color: 0xd8d8d0, roughness: 0.5 });
    const line = (mat, x0, x1, z, w) => { const g = new THREE.PlaneGeometry(x1 - x0, w); g.rotateX(-Math.PI / 2); g.translate((x0 + x1) / 2, 0.006, z); add(mat, g); };
    for (const [z, d] of [[KERB_N, 1], [KERB_F, -1]]) { line(yellow, X_WEST, X_ROAD_END - 0.3, z + d * 0.35, 0.1); line(yellow, X_WEST, X_ROAD_END - 0.3, z + d * 0.55, 0.1); }
    for (let x = X_WEST + 1; x < X_ROAD_END - 4; x += 9) line(white, x, x + 4, (KERB_N + KERB_F) / 2, 0.12);
  }
  const paving = pavingTextures();
  const pavingMat = new THREE.MeshStandardMaterial({ map: paving.map, roughnessMap: paving.rough, roughness: 0.9, color: 0xc8c8c8 });
  photo(pavingMat, 'precast_stone_paving', 2.24, { rough: 0.55 }); // London flagstones, wet
  const pave = (x0, x1, z0, z1) => {
    const g = new THREE.BoxGeometry(x1 - x0, PAVE, z1 - z0, Math.ceil((x1 - x0) / 10), 1, Math.ceil((z1 - z0) / 10));
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (x1 - x0) / UV_M, uv.getY(i) * (z1 - z0) / UV_M);
    g.translate((x0 + x1) / 2, PAVE / 2, (z0 + z1) / 2);
    add(pavingMat, g);
  };
  pave(X_WEST, X_RIVER, NEAR_FRONT, KERB_N);
  pave(X_WEST, X_RIVER, KERB_F, FAR_FRONT);
  pave(X_ROAD_END, X_RIVER, KERB_N, KERB_F); // the Embankment promenade
  // Granite kerbs
  add(stone, box(X_ROAD_END - X_WEST, PAVE + 0.02, 0.22, (X_WEST + X_ROAD_END) / 2, PAVE / 2, KERB_N - 0.11));
  add(stone, box(X_ROAD_END - X_WEST, PAVE + 0.02, 0.22, (X_WEST + X_ROAD_END) / 2, PAVE / 2, KERB_F + 0.11));
  add(stone, box(0.22, PAVE + 0.02, KERB_F - KERB_N, X_ROAD_END + 0.11, PAVE / 2, (KERB_N + KERB_F) / 2));

  // ---- Terraced houses ---------------------------------------------------------------------------
  const r = rng(1987);
  const windows = { dark: [], lit: [], frame: [], sill: [], trim: [] };
  const fronts = []; // [x0, x1, zFront, dir, doorX] for railings
  const doors = [];
  const doorColors = [0x111214, 0x1b2a44, 0x4a1418, 0x173226, 0x111214, 0x2b2b2b];
  const addWindow = (x, y, zFace, dir, w = 1.1, h = 1.8) => {
    // A Georgian sash window: the glass sits back behind a stucco surround, under a stone lintel,
    // with a white sash frame and glazing bars (six panes over six).
    const zf = (o) => zFace + dir * o;
    const T = 0.15, D = 0.17;
    windows.trim.push([x - w / 2 - T / 2, y, zf(D / 2), T, h + 2 * T, D], [x + w / 2 + T / 2, y, zf(D / 2), T, h + 2 * T, D], [x, y + h / 2 + T / 2, zf(D / 2), w + 2 * T, T, D]);
    windows.trim.push([x, y + h / 2 + T + 0.12, zf(0.12), w + 2 * T + 0.24, 0.24, 0.24]);
    (r() < (y < 3 ? 0.55 : 0.4) ? windows.lit : windows.dark).push([x, y, zf(0.02), w, h, 0.02]);
    const S = 0.06, zs = zf(0.055);
    windows.frame.push([x - w / 2 + S / 2, y, zs, S, h, 0.05], [x + w / 2 - S / 2, y, zs, S, h, 0.05], [x, y + h / 2 - S / 2, zs, w, S, 0.05], [x, y - h / 2 + S / 2, zs, w, S, 0.05]);
    windows.frame.push([x, y, zf(0.065), w, 0.075, 0.07]);                                  // meeting rail
    windows.frame.push([x - w / 6, y, zs, 0.03, h, 0.035], [x + w / 6, y, zs, 0.03, h, 0.035]);   // glazing bars
    windows.frame.push([x, y + h / 4, zs, w, 0.03, 0.035], [x, y - h / 4, zs, w, 0.03, 0.035]);
    windows.sill.push([x, y - h / 2 - 0.07, zf(0.13), w + 0.42, 0.12, 0.26]);
  };
  /** One terraced house: front at zFront, facing dir (+1 = +Z), from x0 to x1. */
  const building = (x0, x1, zFront, dir, opts = {}) => {
    const w = x1 - x0, cx = (x0 + x1) / 2;
    const floors = opts.floors || (3 + (r() < 0.45 ? 1 : 0));
    const fh = 3.2, height = opts.height || (floors * fh + 0.6);
    const depth = 20, zBack = zFront - dir * depth;
    const brickMat = opts.mat || bricks[Math.floor(r() * bricks.length)];
    const y0 = opts.y0 || 0;
    // Body (front face is brick; stucco ground floor on some houses)
    add(brickMat, box(w, height - y0, depth, cx, y0 + (height - y0) / 2, (zFront + zBack) / 2));
    if (!opts.y0 && r() < 0.4) add(stucco, box(w, fh, 0.12, cx, fh / 2, zFront + dir * 0.06));
    // Cornice & parapet
    add(stone, box(w, 0.3, 0.45, cx, height - 0.45, zFront + dir * 0.18));
    add(brickMat, box(w, 0.7, 0.3, cx, height + 0.35, zFront - dir * 0.15));
    // Chimney stack with pots (on the party wall)
    const chx = r() < 0.5 ? x0 + 0.6 : x1 - 0.6;
    add(brickMat, box(1.0, 1.8, 2.2, chx, height + 0.9, zFront - dir * 6));
    for (let k = 0; k < 3; k++) {
      const g = new THREE.CylinderGeometry(0.11, 0.14, 0.55, 8); g.translate(chx, height + 2.05, zFront - dir * (5.4 + k * 0.6)); add(pot, g);
    }
    // Windows: upper floors evenly; ground floor has the front door at one side
    const n = Math.max(2, Math.floor(w / 2.3));
    for (let f = opts.y0 ? Math.round(opts.y0 / fh) : 1; f < floors; f++) {
      for (let i = 0; i < n; i++) addWindow(x0 + (w / n) * (i + 0.5), f * fh + 1.55, zFront, dir, 1.05, f === 1 ? 2.0 : 1.7);
    }
    if (!opts.y0) {
      const doorLeft = r() < 0.5;
      const dx = doorLeft ? x0 + 1.1 : x1 - 1.1;
      doors.push([dx, zFront, dir, doorColors[Math.floor(r() * doorColors.length)]]);
      fronts.push([x0, x1, zFront, dir, dx]);
      const span = doorLeft ? [x0 + 2.2, x1] : [x0, x1 - 2.2];
      const m = Math.max(1, Math.floor((span[1] - span[0]) / 2.4));
      for (let i = 0; i < m; i++) addWindow(span[0] + ((span[1] - span[0]) / m) * (i + 0.5), 1.75, zFront, dir, 1.2, 2.0);
    }
    colliders.push([Math.min(x0, x1), Math.min(zFront, zBack), Math.max(x0, x1), Math.max(zFront, zBack)]);
  };
  const row = (zFront, dir, skip) => {
    let x = X_WEST;
    while (x < X_ROAD_END - 3) {
      let w = 5.4 + r() * 2.2;
      if (skip && x < skip[1] && x + w > skip[0]) { // leave the gap for your house exactly
        if (x < skip[0] - 3) w = skip[0] - x; else { x = skip[1]; continue; }
      }
      if (x + w > X_ROAD_END - 3) w = X_ROAD_END - x;
      building(x, x + w, zFront, dir);
      x += w;
    }
  };
  const HOUSE_GAP = [H.HX - H.W / 2 - 0.3, H.HX + H.W / 2 + 0.3];
  row(NEAR_FRONT, 1, HOUSE_GAP);
  row(FAR_FRONT, -1, null);
  // Your house becomes a terraced house: upper floors on top, and a block behind it.
  building(H.HX - H.W / 2, H.HX + H.W / 2, NEAR_FRONT, 1, { y0: H.TOP, floors: 4, height: 4 * 3.2 + 0.6, mat: bricks[0] });
  colliders.pop(); // (your own house's ground floor has its own walls and door)
  add(bricks[0], box(H.W + 0.6, 13, 12, H.HX, 6.5, H.HZ - H.D / 2 - 6.3));
  colliders.push([HOUSE_GAP[0], H.HZ - H.D / 2 - 12.3, HOUSE_GAP[1], H.HZ - H.D / 2 - 0.3]);
  // The end of the street to the west: a closing block.
  add(bricks[2], box(10, 14, FAR_FRONT - NEAR_FRONT + 40, X_WEST - 5, 7, (NEAR_FRONT + FAR_FRONT) / 2));

  // Windows & doors (instanced: one draw call each)
  const inst = (geoFn, mat, list, setup) => {
    if (!list.length) return null;
    const im = new THREE.InstancedMesh(geoFn(), mat, list.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    list.forEach((it, i) => { setup(it, p, q, s); m.compose(p, q, s); im.setMatrixAt(i, m); });
    im.receiveShadow = true;
    scene.add(im);
    return im;
  };
  const unitBox = () => new THREE.BoxGeometry(1, 1, 1);
  for (const [k, mat] of [['frame', frameMat], ['dark', glassDark], ['lit', glassLit], ['sill', trimMat], ['trim', trimMat]]) {
    inst(unitBox, mat, windows[k], ([x, y, z, w, h, d], p, q, s) => { p.set(x, y, z); q.identity(); s.set(w, h, d); });
  }
  const doorIm = inst(unitBox, doorMat, doors, ([x, z, dir], p, q, s) => { p.set(x, PAVE + 1.25, z + dir * 0.05); q.identity(); s.set(1.05, 2.3, 0.08); });
  if (doorIm) { doors.forEach((d, i) => doorIm.setColorAt(i, new THREE.Color(d[3]))); doorIm.instanceColor.needsUpdate = true; }
  inst(unitBox, glassLit, doors, ([x, z, dir], p, q, s) => { p.set(x, PAVE + 2.65, z + dir * 0.06); q.identity(); s.set(1.0, 0.4, 0.02); }); // fanlights
  inst(unitBox, stone, doors, ([x, z, dir], p, q, s) => { p.set(x, PAVE + 0.09, z + dir * 0.3); q.identity(); s.set(1.6, 0.18, 0.55); }); // door steps
  // Four raised panels on each door (in the door's own colour), a brass knob and letterbox.
  const panels = [];
  for (const d of doors) for (const [ox, oy] of [[-0.24, 0.62], [0.24, 0.62], [-0.24, 1.62], [0.24, 1.62]]) panels.push([d[0] + ox, d[1], d[2], d[3], oy]);
  const panelIm = inst(unitBox, doorMat, panels, ([x, z, dir, , oy], p, q, s) => { p.set(x, PAVE + oy, z + dir * 0.1); q.identity(); s.set(0.34, oy < 1 ? 0.8 : 0.9, 0.03); });
  if (panelIm) { panels.forEach((d, i) => panelIm.setColorAt(i, new THREE.Color(d[3]).multiplyScalar(1.25))); panelIm.instanceColor.needsUpdate = true; }
  inst(() => new THREE.SphereGeometry(0.05, 10, 8), brass, doors, ([x, z, dir], p, q, s) => { p.set(x, PAVE + 1.15, z + dir * 0.13); q.identity(); s.set(1, 1, 1); });
  inst(unitBox, brass, doors, ([x, z, dir], p, q, s) => { p.set(x, PAVE + 1.0, z + dir * 0.1); q.identity(); s.set(0.3, 0.07, 0.03); });
  // Stucco pilasters either side of the door and a cornice above the fanlight.
  const pil = [];
  for (const [x, z, dir] of doors) pil.push([x - 0.68, z, dir, 0.24, 2.95], [x + 0.68, z, dir, 0.24, 2.95]);
  inst(unitBox, trimMat, pil, ([x, z, dir, w, h], p, q, s) => { p.set(x, PAVE + h / 2, z + dir * 0.1); q.identity(); s.set(w, h, 0.2); });
  inst(unitBox, trimMat, doors, ([x, z, dir], p, q, s) => { p.set(x, PAVE + 3.08, z + dir * 0.16); q.identity(); s.set(1.75, 0.3, 0.32); });

  // ---- Black iron railings with spear tops along the house fronts (gap at each front door) -------
  {
    const bars = [], spans = [];
    for (const [x0, x1, zFront, dir, dx] of fronts) {
      const z = zFront + dir * 1.35;
      for (const [a, b] of [[x0 + 0.05, dx - 0.75], [dx + 0.75, x1 - 0.05]]) {
        if (b - a < 0.3) continue;
        spans.push([a, b, z]);
        for (let x = a + 0.06; x < b; x += 0.13) bars.push([x, z]);
      }
      // The railings turn back to the house wall beside the door path.
      for (const sx of [dx - 0.75, dx + 0.75]) {
        spans.push([sx, sx, z, zFront]);
        for (let t = 0.13; t < 1.3; t += 0.13) bars.push([sx, z - dir * t]);
      }
    }
    const H_R = 1.05;
    inst(() => new THREE.CylinderGeometry(0.011, 0.011, H_R, 5), iron, bars, ([x, z], p, q, s) => { p.set(x, PAVE + H_R / 2, z); q.identity(); s.set(1, 1, 1); });
    inst(() => new THREE.ConeGeometry(0.03, 0.12, 4), iron, bars, ([x, z], p, q, s) => { p.set(x, PAVE + H_R + 0.05, z); q.identity(); s.set(1, 1, 1); });
    for (const [a, b, z, zf] of spans) {
      if (zf === undefined) {
        for (const y of [0.12, H_R - 0.08]) add(iron, box(b - a, 0.03, 0.03, (a + b) / 2, PAVE + y, z));
        colliders.push([a, z - 0.06, b, z + 0.06]);
      } else {
        const z0 = Math.min(z, zf), z1 = Math.max(z, zf);
        for (const y of [0.12, H_R - 0.08]) add(iron, box(0.03, 0.03, z1 - z0, a, PAVE + y, (z0 + z1) / 2));
        add(iron, box(0.07, H_R + 0.25, 0.07, a, PAVE + (H_R + 0.25) / 2, z)); // gate post
        colliders.push([a - 0.05, z0, a + 0.05, z1]);
      }
    }
  }

  // ---- Street lamps ----------------------------------------------------------------------------
  const lamps = [];
  for (let x = X_WEST + 8; x < X_ROAD_END - 2; x += 14) {
    if (Math.abs(x - H.HX) > 2.5) lamps.push([x, KERB_N - 0.45]);
    lamps.push([x + 7, KERB_F + 0.45]);
  }
  for (let z = NEAR_FRONT + 2; z < FAR_FRONT; z += 6.5) lamps.push([X_RIVER - 0.6, z]); // Embankment lamps
  const LAMP_S = 1.1, LAMP_Y = PAVE + 3.264 * LAMP_S; // the bulb of the real model
  const simpleLamp = [
    inst(() => new THREE.CylinderGeometry(0.07, 0.09, 3.4, 8), iron, lamps, ([x, z], p, q, s) => { p.set(x, PAVE + 1.7, z); q.identity(); s.set(1, 1, 1); }),
    inst(() => new THREE.CylinderGeometry(0.15, 0.2, 0.55, 8), iron, lamps, ([x, z], p, q, s) => { p.set(x, PAVE + 0.27, z); q.identity(); s.set(1, 1, 1); }),
    inst(() => new THREE.ConeGeometry(0.36, 0.3, 4), iron, lamps, ([x, z], p, q, s) => { p.set(x, LAMP_Y + 0.4, z); q.setFromEuler(new THREE.Euler(0, Math.PI / 4, 0)); s.set(1, 1, 1); }),
  ];
  const lanternMat = new THREE.MeshStandardMaterial({ color: 0x3a2a18, emissive: 0xffc070, emissiveIntensity: 2.5, roughness: 0.3 });
  simpleLamp.push(inst(() => new THREE.BoxGeometry(0.4, 0.5, 0.4), lanternMat, lamps, ([x, z], p, q, s) => { p.set(x, LAMP_Y, z); q.identity(); s.set(1, 1, 1); }));
  // Glowing bulbs and glass on the real lamps.
  const glow = (mat) => {
    if (/bulb/.test(mat.name)) { mat.emissive = new THREE.Color(0xffc878); mat.emissiveIntensity = 4; }
    else if (/glass/.test(mat.name)) { mat.emissive = new THREE.Color(0xffb060); mat.emissiveIntensity = 0.7; mat.depthWrite = false; }
  };
  {
    const mats = lamps.map(([x, z], i) => new THREE.Matrix4().compose(new THREE.Vector3(x, PAVE, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), (i % 4) * Math.PI / 2), new THREE.Vector3(LAMP_S, LAMP_S, LAMP_S)));
    placeModel(scene, 'street_lamp_01', mats, { shadow: !lowQ, onMaterial: glow }).then(() => { for (const m of simpleLamp) if (m) m.visible = false; }).catch(() => {});
  }
  // Wall lanterns beside some front doors (and yours).
  const lanterns = [];
  {
    const wl = lanterns;
    wl.push([H.HX + 1.25, NEAR_FRONT + 0.14, 1]);
    for (const [x, z, dir] of doors) if (r() < 0.4) wl.push([x + 0.95, z + dir * 0.2, dir]);
    const mats = wl.map(([x, z, dir]) => new THREE.Matrix4().compose(new THREE.Vector3(x, PAVE + 2.55, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), dir > 0 ? 0 : Math.PI), new THREE.Vector3(0.85, 0.85, 0.85)));
    placeModel(scene, 'street_lamp_02', mats, { onMaterial: glow }).catch(() => {});
  }
  for (const [x, z] of lamps) circles.push([x, z, 0.18]);
  // A soft halo of light in the rainy mist round every lamp.
  const haloMat = new THREE.SpriteMaterial({ map: lightPoolTexture(), color: 0xffd9a8, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, fog: true });
  const see = []; // see-through effects (kept out of the ambient-occlusion pass)
  for (const [x, z] of lamps) { const h = new THREE.Sprite(haloMat); h.position.set(x, LAMP_Y, z); h.scale.set(2.6, 2.6, 1); scene.add(h); see.push(h); }
  // Pools of lamplight on the wet ground (cheap: a soft glow each), and a few real lights near you.
  const poolMat = new THREE.MeshBasicMaterial({ map: lightPoolTexture(), transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, fog: true });
  const pools = inst(() => { const g = new THREE.PlaneGeometry(8, 8); g.rotateX(-Math.PI / 2); return g; }, poolMat, lamps, ([x, z], p, q, s) => { p.set(x, PAVE + 0.02, z); q.identity(); s.set(1, 1, 1); });
  if (pools) { pools.renderOrder = 2; pools.receiveShadow = false; see.push(pools); }
  const NL = { high: 6, medium: 4, low: 2 }[qName] || 3;
  const lampLights = [];
  for (let i = 0; i < NL; i++) { const l = new THREE.PointLight(0xffd2a0, 0, 18, 1.4); l.position.set(0, -50, 0); scene.add(l); lampLights.push(l); }

  // ---- Parked cars, under covers for the winter ----------------------------------------------------
  {
    const cars = [];
    for (const [z, dir] of [[KERB_N + 1.05, 1], [KERB_F - 1.05, -1]]) {
      for (let x = X_WEST + 6 + r() * 6; x < X_ROAD_END - 8; x += 9 + r() * 14) {
        if (Math.abs(x - H.HX) < 5 && dir > 0) continue; // keep the road outside your door clear
        cars.push([x, z, dir]);
        colliders.push([x - 2.25, z - 0.95, x + 2.25, z + 0.95]);
      }
    }
    const mats = cars.map(([x, z, dir]) => new THREE.Matrix4().compose(new THREE.Vector3(x, 0, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), dir > 0 ? Math.PI / 2 : -Math.PI / 2), new THREE.Vector3(1, 1, 1)));
    placeModel(scene, 'covered_car', mats, { shadow: !lowQ, onMaterial: (m) => { m.color.multiplyScalar(0.7); m.roughness = 0.75; } }).catch(() => {});
  }

  // ---- Bare plane trees, phone box, post box, bollards, benches -----------------------------------
  const treeSpots = [];
  for (let x = X_WEST + 15; x < X_ROAD_END - 4; x += 17) {
    if (Math.abs(x - H.HX) > 6) treeSpots.push([x, PAVE, KERB_N - 1.4, 1.35 + r() * 0.35, Math.floor(r() * 100)]);
    treeSpots.push([x + 8.5, PAVE, KERB_F + 1.4, 1.35 + r() * 0.35, Math.floor(r() * 100)]);
  }
  plantBareTrees(scene, treeSpots, qName);
  for (const [x, , z] of treeSpots) { circles.push([x, z, 0.4]); add(iron, box(1.2, 0.02, 1.2, x, PAVE + 0.01, z)); } // tree pit grates
  // Red telephone box across the road from your door
  const pb = { x: H.HX + 6, z: KERB_F + 1.6 };
  const pbTex = phoneBoxTexture();
  const pbSide = new THREE.MeshStandardMaterial({ map: pbTex, emissiveMap: pbTex, emissive: 0x332211, emissiveIntensity: 0.6, roughness: 0.4 });
  const red = new THREE.MeshStandardMaterial({ color: 0xa8111a, roughness: 0.35 });
  const phone = new THREE.Mesh(new THREE.BoxGeometry(1.0, 2.5, 1.0), [pbSide, pbSide, red, red, pbSide, pbSide]);
  phone.position.set(pb.x, PAVE + 1.25, pb.z); phone.castShadow = true; scene.add(phone);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.22, 1.15), red); roof.position.set(pb.x, PAVE + 2.6, pb.z); scene.add(roof);
  const dome = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.55, 0.22, 4), red); dome.position.set(pb.x, PAVE + 2.82, pb.z); dome.rotation.y = Math.PI / 4; scene.add(dome);
  circles.push([pb.x, pb.z, 0.65]);
  // Pillar box (post box) on your side
  const post = new THREE.Group();
  const pbody = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.3, 1.35, 20), red); pbody.position.y = 0.68;
  const pcap = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.32, 0.14, 20), red); pcap.position.y = 1.42;
  const ptop = new THREE.Mesh(new THREE.SphereGeometry(0.33, 20, 8, 0, Math.PI * 2, 0, Math.PI / 2), red); ptop.position.y = 1.48;
  const slot = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.05, 0.05), iron); slot.position.set(0, 1.12, 0.28);
  post.add(pbody, pcap, ptop, slot); post.position.set(H.HX - 8.5, PAVE, KERB_N - 0.9);
  post.traverse((o) => { o.castShadow = true; }); scene.add(post);
  circles.push([post.position.x, post.position.z, 0.4]);
  // Embankment: parapet wall, bollards and a bench
  add(stone, box(1.0, 1.0, 260, X_RIVER + 0.5, 0.5, 14));
  for (let z = NEAR_FRONT + 0.8; z < FAR_FRONT; z += 2.2) { const g = new THREE.CylinderGeometry(0.1, 0.12, 0.9, 8); g.translate(X_ROAD_END + 0.6, PAVE + 0.45, z); add(iron, g); }
  add(slate, box(1.8, 0.08, 0.5, X_RIVER - 1.2, PAVE + 0.45, 13)); add(iron, box(0.08, 0.45, 0.45, X_RIVER - 2.0, PAVE + 0.22, 13)); add(iron, box(0.08, 0.45, 0.45, X_RIVER - 0.4, PAVE + 0.22, 13));
  colliders.push([X_RIVER - 2.15, 12.7, X_RIVER - 0.25, 13.3]);

  // ---- The Thames, and Westminster across it ------------------------------------------------------
  let water;
  if (Q.water) {
    const normals = tex('waternormals.jpg');
    water = new Water(new THREE.PlaneGeometry(1400, 1400), {
      textureWidth: 512, textureHeight: 512, waterNormals: normals, sunDirection: new THREE.Vector3(0.3, 0.6, 0.2), sunColor: 0x8899aa,
      waterColor: 0x0a141a, distortionScale: 1.6, fog: true,
    });
  } else water = new THREE.Mesh(new THREE.PlaneGeometry(1400, 1400), new THREE.MeshStandardMaterial({ color: 0x0b1419, roughness: 0.12, metalness: 0.5 }));
  water.rotation.x = -Math.PI / 2;
  water.position.set(X_RIVER + 1 + 700, -2.2, 14);
  scene.add(water);
  // Distant silhouettes don't take fog (they're seen as dark shapes through the mist).
  const far = new THREE.MeshBasicMaterial({ color: 0x1c2029, fog: false });
  const farWin = new THREE.MeshBasicMaterial({ color: 0xffb562, fog: false });
  const W0 = 560; // the far bank
  const farGeo = [];
  farGeo.push(box(60, 26, 340, W0 + 30, 13, -40));                          // the Palace of Westminster (low and long)
  for (let z = -200; z < 130; z += 9) { const g = new THREE.ConeGeometry(1.6, 9, 4); g.translate(W0 + 2, 30, z); farGeo.push(g); } // pinnacles
  { const g = new THREE.BoxGeometry(16, 60, 16); g.translate(W0 + 20, 30, -230); farGeo.push(g); }      // Victoria Tower
  const bx = W0 + 4, bz = 120;                                             // the Elizabeth Tower (Big Ben)
  farGeo.push(box(12, 74, 12, bx, 37, bz), box(14, 14, 14, bx, 81, bz), box(11, 10, 11, bx, 93, bz));
  { const g = new THREE.ConeGeometry(8.5, 30, 4); g.rotateY(Math.PI / 4); g.translate(bx, 113, bz); farGeo.push(g); }
  for (const [dx, dz] of [[-6, -6], [6, -6], [-6, 6], [6, 6]]) { const g = new THREE.ConeGeometry(0.9, 8, 4); g.translate(bx + dx, 92, bz + dz); farGeo.push(g); }
  const farMesh = new THREE.Mesh(mergeGeometries(farGeo.map((g) => g.toNonIndexed())), far);
  scene.add(farMesh);
  const clockTex = clockFaceTexture();
  const clockMat = new THREE.MeshBasicMaterial({ map: clockTex, fog: false, transparent: true });
  for (const [dx, dz, ry] of [[-7.05, 0, -Math.PI / 2], [0, 7.05, 0], [0, -7.05, Math.PI], [7.05, 0, Math.PI / 2]]) {
    const c = new THREE.Mesh(new THREE.CircleGeometry(5.2, 32), clockMat);
    c.position.set(bx + dx, 81, bz + dz); c.rotation.y = ry; scene.add(c);
  }
  // Lit windows across the river
  const farW = [];
  const fr = rng(77);
  for (let i = 0; i < 320; i++) farW.push([W0 - 0.2, 3 + fr() * 21, -200 + fr() * 330]);
  inst(() => new THREE.PlaneGeometry(2.6, 3.6), farWin, farW, ([x, y, z], p, q) => { p.set(x, y, z); q.setFromEuler(new THREE.Euler(0, -Math.PI / 2, 0)); });

  // ---- Merge everything that shares a material ---------------------------------------------------
  const flat = [...groups.entries()].map(([mat, list]) => [mat, list.map((g) => (g.index ? g.toNonIndexed() : g))]);
  const lm = lightmapUVs(flat.flatMap(([, l]) => l));
  const statics = [];
  for (const [mat, list] of flat) {
    for (const g of list) { if (g.attributes.normal === undefined) g.computeVertexNormals(); for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'uv1'].includes(k)) g.deleteAttribute(k); }
    const mesh = new THREE.Mesh(mergeGeometries(list), mat);
    mesh.castShadow = mat !== pavingMat && mat !== roadMat;
    mesh.receiveShadow = true;
    scene.add(mesh);
    statics.push(mesh);
  }
  // Light precalculated in Blender (tools/bake-london): how the grey sky lights the street by day,
  // and how every lamp and lit window lights it at night, bounces included. Used when it matches
  // this exact street (the hash); otherwise everything is lit live as before.
  const lmMix = { value: 1 }, lmDayI = { value: 1 }, lmNightI = { value: 1 };
  const LM_DAY = 4.4, LM_NIGHT = 4.5; // (Blender's light units to the game's; tuned by eye)
  const baked = { on: false };
  fetch('/game/baked/london.json').then((r) => (r.ok ? r.json() : null)).then(async (info) => {
    if (!info || info.hash !== lm.hash) { if (info) console.warn('London light textures are out of date: lit live instead'); return; }
    const load = (f) => new Promise((ok, no) => new THREE.TextureLoader().load(`/game/baked/${f}?v=${info.hash}`, (t) => {
      t.colorSpace = THREE.SRGBColorSpace; t.channel = 1; t.generateMipmaps = false; t.minFilter = THREE.LinearFilter; ok(t);
    }, undefined, no));
    const [day, night] = await Promise.all([load(info.day), load(info.night)]);
    // The textures are stored scaled to fit; scale back, then tune to the game's own light levels.
    lmDayI.value = info.dayScale * LM_DAY; lmNightI.value = info.nightScale * LM_NIGHT;
    const noHemi = THREE.ShaderChunk.lights_fragment_begin.replace('irradiance += getHemisphereLightIrradiance( hemisphereLights[ i ], geometryNormal );', '');
    const maps = `#if defined( RE_IndirectDiffuse )
        irradiance += mix(texture2D(lightMap, vLightMapUv).rgb * lmDayI, texture2D(lmNight, vLightMapUv).rgb * lmNightI, lmMix) * lightMapIntensity;
      #endif
      #if defined( USE_ENVMAP ) && defined( RE_IndirectSpecular )
        radiance += getIBLRadiance( geometryViewDir, geometryNormal, material.roughness );
      #endif`;
    for (const m of statics) {
      const mat = m.material;
      mat.lightMap = day; mat.lightMapIntensity = 1;
      mat.onBeforeCompile = (sh) => {
        sh.uniforms.lmNight = { value: night }; sh.uniforms.lmMix = lmMix; sh.uniforms.lmDayI = lmDayI; sh.uniforms.lmNightI = lmNightI;
        sh.fragmentShader = 'uniform sampler2D lmNight; uniform float lmMix, lmDayI, lmNightI;\n' + sh.fragmentShader
          .replace('#include <lights_fragment_begin>', noHemi)
          .replace('#include <lights_fragment_maps>', maps);
      };
      mat.customProgramCacheKey = () => 'baked';
      mat.needsUpdate = true;
    }
    baked.on = true;
  }).catch(() => { /* lit live */ });

  // ---- Sky: low winter cloud, city glow at night --------------------------------------------------
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: new THREE.Color() }, horizon: { value: new THREE.Color() }, glow: { value: new THREE.Color() } },
    vertexShader: 'varying vec3 vP; void main() { vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'uniform vec3 top; uniform vec3 horizon; uniform vec3 glow; varying vec3 vP;'
      + ' void main() { float h = clamp(vP.y, 0.0, 1.0); vec3 c = mix(horizon, top, pow(h, 0.6)); c += glow * exp(-h * 9.0); gl_FragColor = vec4(c, 1.0); }',
  });
  const skyDome = new THREE.Mesh(new THREE.SphereGeometry(2600, 32, 16), skyMat);
  scene.add(skyDome);
  const envScene = new THREE.Scene();
  envScene.add(new THREE.Mesh(new THREE.SphereGeometry(100, 24, 12), skyMat));
  // a few bright "lamps" in the reflection world so wet surfaces catch warm highlights
  const envLamp = new THREE.MeshBasicMaterial({ color: 0xffb060 });
  for (let i = 0; i < 10; i++) { const s = new THREE.Mesh(new THREE.SphereGeometry(2.2, 8, 6), envLamp); const a = (i / 10) * Math.PI * 2; s.position.set(Math.cos(a) * 60, 6, Math.sin(a) * 60); envScene.add(s); }

  // ---- Rain ------------------------------------------------------------------------------------------
  const N = { high: 7000, medium: 4000, low: 1600 }[qName] || 3000;
  const R = 26, HT = 20;
  const rg = new THREE.BufferGeometry();
  const seed = new Float32Array(N * 2 * 3), tail = new Float32Array(N * 2), pos = new Float32Array(N * 2 * 3);
  const rr = rng(4242);
  for (let i = 0; i < N; i++) {
    const a = rr() * 2 - 1, b = rr() * 2 - 1, c = rr();
    for (let k = 0; k < 2; k++) { seed.set([a, b, c], (i * 2 + k) * 3); tail[i * 2 + k] = k; }
  }
  rg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  rg.setAttribute('seed', new THREE.BufferAttribute(seed, 3));
  rg.setAttribute('tail', new THREE.BufferAttribute(tail, 1));
  const rainMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { time: { value: 0 }, center: { value: new THREE.Vector3() }, color: { value: new THREE.Color(0xaab4c4) }, opacity: { value: 0.5 } },
    vertexShader: `attribute vec3 seed; attribute float tail; uniform float time; uniform vec3 center; varying float vA;
      void main() {
        float speed = 14.0 + seed.z * 5.0;
        float y = mod(seed.z * ${HT.toFixed(1)} - time * speed, ${HT.toFixed(1)});
        vec3 p = vec3(center.x + seed.x * ${R.toFixed(1)}, center.y - 6.0 + y + tail * 0.55, center.z + seed.y * ${R.toFixed(1)});
        p.x += tail * 0.06;                                    // a slight slant in the wind
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        vA = (1.0 - smoothstep(10.0, ${R.toFixed(1)}, -mv.z)) * smoothstep(0.5, 2.0, -mv.z) * (0.55 + 0.45 * tail);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: 'uniform vec3 color; uniform float opacity; varying float vA; void main() { gl_FragColor = vec4(color, opacity * vA); }',
  });
  const rain = new THREE.LineSegments(rg, rainMat);
  // Raindrops splashing on the ground round you: small rings that spread and fade.
  const NS = { high: 700, medium: 400, low: 150 }[qName] || 300;
  const sg = new THREE.InstancedBufferGeometry();
  sg.index = new THREE.PlaneGeometry(1, 1).index; sg.setAttribute('position', new THREE.PlaneGeometry(1, 1).attributes.position); sg.setAttribute('uv', new THREE.PlaneGeometry(1, 1).attributes.uv);
  { const sr = rng(77), a = new Float32Array(NS * 3); for (let i = 0; i < NS; i++) { a[i * 3] = (sr() - 0.5) * 26; a[i * 3 + 1] = (sr() - 0.5) * 26; a[i * 3 + 2] = sr(); } sg.setAttribute('aSeed', new THREE.InstancedBufferAttribute(a, 3)); }
  sg.instanceCount = NS;
  const splashMat = new THREE.ShaderMaterial({
    uniforms: { time: { value: 0 }, center: { value: new THREE.Vector3() }, opacity: { value: 0.5 }, kerbN: { value: KERB_N }, kerbF: { value: KERB_F }, pave: { value: PAVE } },
    vertexShader: `attribute vec3 aSeed; uniform float time; uniform vec3 center; uniform float kerbN, kerbF, pave; varying vec2 vUv; varying float vT;
      float h(float n) { return fract(sin(n) * 43758.5453); }
      void main() {
        float k = time * 1.6 + aSeed.z; float cyc = floor(k); vT = fract(k);
        vec2 p = center.xz + aSeed.xy + vec2(h(cyc + aSeed.x) - 0.5, h(cyc * 1.7 + aSeed.y) - 0.5) * 6.0;
        float y = (p.y > kerbN && p.y < kerbF) ? 0.012 : pave + 0.012;
        float s = 0.04 + 0.22 * vT;
        vUv = uv;
        gl_Position = projectionMatrix * viewMatrix * vec4(p.x + position.x * s, y, p.y - position.y * s, 1.0);
      }`,
    fragmentShader: `uniform float opacity; varying vec2 vUv; varying float vT;
      void main() { float r = length(vUv - 0.5) * 2.0; float ring = smoothstep(0.7, 0.85, r) * (1.0 - smoothstep(0.85, 1.0, r));
        gl_FragColor = vec4(vec3(0.85, 0.88, 0.95), ring * (1.0 - vT) * opacity); }`,
    transparent: true, depthWrite: false,
  });
  const splashes = new THREE.Mesh(sg, splashMat); splashes.frustumCulled = false; splashes.renderOrder = 3;
  scene.add(splashes); see.push(splashes, rain);
  rain.frustumCulled = false;
  rain.renderOrder = 5;
  scene.add(rain);

  // ---- Rain sound (made on the fly; starts on your first tap/key, as browsers require) -------------
  let audio = null;
  const startRainSound = () => {
    if (audio) return;
    try {
      const a = new (window.AudioContext || window.webkitAudioContext)();
      const len = a.sampleRate * 2, buf = a.createBuffer(1, len, a.sampleRate), d = buf.getChannelData(0);
      let last = 0;
      for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; last = (last + 0.02 * w) / 1.02; d[i] = w * 0.5 + last * 3; }
      const src = a.createBufferSource(); src.buffer = buf; src.loop = true;
      const bp = a.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1400; bp.Q.value = 0.4;
      const lp = a.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 5000;
      const gain = a.createGain(); gain.gain.value = 0;
      src.connect(bp); bp.connect(lp); lp.connect(gain); gain.connect(a.destination); src.start();
      gain.gain.linearRampToValueAtTime(0.09, a.currentTime + 2);
      audio = { a, gain };
    } catch { /* no sound */ }
  };
  const muted = () => { try { return localStorage.getItem('mn_rainMute') === '1'; } catch { return false; } };
  for (const ev of ['pointerdown', 'keydown']) addEventListener(ev, () => { if (!muted()) startRainSound(); }, { once: true });
  const setMuted = (m) => {
    try { localStorage.setItem('mn_rainMute', m ? '1' : '0'); } catch { /* ignore */ }
    if (m && audio) audio.gain.gain.value = 0; else if (!m) { startRainSound(); if (audio) audio.gain.gain.value = 0.09; }
  };

  // ---- Each frame ---------------------------------------------------------------------------------------
  const lampVec = lamps.map(([x, z]) => new THREE.Vector3(x, LAMP_Y - 0.3, z));
  let lampT = 1, clockT = 0, t = 0;
  const cTop = new THREE.Color(), cHor = new THREE.Color();
  function update(dt, player, camPos, day) {
    t += dt;
    const night = 1 - day;
    rainMat.uniforms.time.value = t;
    rainMat.uniforms.center.value.copy(camPos);
    splashMat.uniforms.time.value = t;
    splashMat.uniforms.center.value.set(player.x, 0, player.z);
    haloMat.opacity = 0.08 + 0.42 * night;
    lmMix.value = Math.min(1, Math.max(0, (night - 0.15) / 0.7));
    rainMat.uniforms.opacity.value = 0.32 + 0.25 * night;
    // Sky: overcast grey by day, near-black with an orange city glow at night.
    cTop.setRGB(0.36, 0.39, 0.43).lerp(new THREE.Color(0.012, 0.016, 0.028), night);
    cHor.setRGB(0.55, 0.58, 0.61).lerp(new THREE.Color(0.05, 0.055, 0.07), night);
    skyMat.uniforms.top.value.copy(cTop); skyMat.uniforms.horizon.value.copy(cHor);
    skyMat.uniforms.glow.value.setRGB(0.14, 0.08, 0.035).multiplyScalar(night);
    far.color.setRGB(0.21, 0.23, 0.26).lerp(new THREE.Color(0.075, 0.08, 0.095), night);
    lanternMat.emissiveIntensity = 0.6 + 2.6 * night;
    glassLit.emissiveIntensity = 0.25 + 1.3 * night;
    poolMat.opacity = 0.2 * night; // (the wet road reflects the real lamps now)
    pbSide.emissiveIntensity = 0.2 + 1.2 * night;
    farWin.color.setRGB(1, 0.71, 0.38).multiplyScalar(0.25 + 0.75 * night);
    // Real lights at the lamps nearest you.
    lampT += dt;
    if (lampT > 0.4) {
      lampT = 0;
      const near = lampVec.map((v) => [v, v.distanceToSquared(player)]).sort((a, b) => a[1] - b[1]).slice(0, lampLights.length);
      near.forEach(([v], i) => lampLights[i].position.copy(v));
    }
    for (const l of lampLights) l.intensity = (baked.on ? 6 : 17) * night; // (with light textures the lamps already light the street; these light you)
    clockT += dt;
    if (clockT > 20) { clockT = 0; clockTex.draw(); }
  }

  /** Height of the ground you stand on (road or pavement). */
  function groundAt(x, z) {
    if (z >= NEAR_FRONT - 0.01 && z <= KERB_N) return PAVE;
    if (z >= KERB_F && z <= FAR_FRONT + 0.01) return PAVE;
    if (x >= X_ROAD_END) return PAVE;
    return 0;
  }
  const lanes = [{ z: NEAR_FRONT + 2.35, x0: X_WEST + 4, x1: X_ROAD_END - 4 }, { z: FAR_FRONT - 2.35, x0: X_WEST + 4, x1: X_ROAD_END - 4 }];
  return {
    lanes, see, statics, baked, lmMix, lmDayI, lmNightI,
    bakeInfo: { hash: lm.hash, density: lm.density, lamps: lamps.map(([x, z]) => [x, LAMP_Y, z]), lanterns: lanterns.map(([x, z, dir]) => [x, PAVE + 2.55 + 0.45, z + dir * 0.55]), lit: windows.lit },
    update, groundAt, skyDome, envScene, water, setMuted, muted,
    bounds: { x0: X_WEST + 0.6, x1: X_RIVER - 0.45, z0: H.HZ - H.D / 2 + 0.4, z1: FAR_FRONT - 0.4 },
    spawn: new THREE.Vector3(H.HX + 1.5, PAVE, NEAR_FRONT + 1.6),
  };
}
