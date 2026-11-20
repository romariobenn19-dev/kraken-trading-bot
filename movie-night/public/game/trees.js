/* Our World - trees made in code: broadleaf trees with real branches and leaf clusters,
 * and pines with layered boughs. Each kind is drawn with one instanced mesh. */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

function rng(seed) { let s = seed % 2147483647; if (s <= 0) s += 2147483646; return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646; }

/** A cluster of leaves painted on a transparent card (the alpha cut-out makes it look leafy). */
function leafTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  const r = rng(7);
  for (let i = 0; i < 70; i++) {
    const x = 30 + r() * 196, y = 30 + r() * 196, a = r() * Math.PI * 2, l = 14 + r() * 16;
    const shade = 70 + Math.floor(r() * 70);
    g.save(); g.translate(x, y); g.rotate(a);
    g.fillStyle = `rgb(${Math.floor(shade * 0.55)}, ${shade + 30}, ${Math.floor(shade * 0.35)})`;
    g.beginPath(); g.ellipse(0, 0, l, l * 0.45, 0, 0, Math.PI * 2); g.fill();
    g.strokeStyle = 'rgba(20, 40, 10, .35)'; g.lineWidth = 1.2;
    g.beginPath(); g.moveTo(-l, 0); g.lineTo(l, 0); g.stroke();
    g.restore();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function barkTexture() {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#4a3828'; g.fillRect(0, 0, 64, 256);
  const r = rng(11);
  for (let i = 0; i < 90; i++) {
    g.fillStyle = `rgba(${20 + r() * 30}, ${15 + r() * 20}, ${10 + r() * 10}, ${0.4 + r() * 0.4})`;
    g.fillRect(r() * 64, r() * 256, 2 + r() * 4, 20 + r() * 60);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function needleTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#1f3a1c'; g.fillRect(0, 0, 128, 128);
  const r = rng(5);
  for (let i = 0; i < 500; i++) {
    g.strokeStyle = `rgba(${30 + r() * 40}, ${70 + r() * 60}, ${30 + r() * 30}, .8)`;
    const x = r() * 128, y = r() * 128;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + (r() - 0.5) * 8, y + 6 + r() * 6); g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** A branch from a to b as a tapered cylinder. */
function limb(a, b, r0, r1, sides = 6) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  const geo = new THREE.CylinderGeometry(r1, r0, len, sides, 1, true);
  geo.translate(0, len / 2, 0);
  geo.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize()));
  geo.translate(a.x, a.y, a.z);
  return geo;
}
/** Leaf cards around a point: crossed quads facing every which way. */
function leafCluster(at, size, r, out) {
  for (let i = 0; i < 5; i++) {
    const q = new THREE.PlaneGeometry(size, size);
    q.rotateX(r() * Math.PI); q.rotateY(r() * Math.PI * 2); q.rotateZ(r() * Math.PI);
    q.translate(at.x + (r() - 0.5) * size * 0.6, at.y + (r() - 0.5) * size * 0.5, at.z + (r() - 0.5) * size * 0.6);
    out.push(q);
  }
}

function broadleaf(seed) {
  const r = rng(seed);
  const wood = [], leaves = [];
  const h = 3.2 + r() * 1.2;
  const top = new THREE.Vector3((r() - 0.5) * 0.4, h, (r() - 0.5) * 0.4);
  wood.push(limb(new THREE.Vector3(0, -0.2, 0), top, 0.3, 0.16, 8));
  const grow = (from, dir, len, rad, depth) => {
    const to = from.clone().addScaledVector(dir, len);
    wood.push(limb(from, to, rad, rad * 0.65));
    if (depth === 0) { leafCluster(to, 1.7, r, leaves); return; }
    const kids = 2 + Math.floor(r() * 2);
    for (let k = 0; k < kids; k++) {
      const d = dir.clone().add(new THREE.Vector3((r() - 0.5) * 1.3, 0.25 + r() * 0.5, (r() - 0.5) * 1.3)).normalize();
      grow(to, d, len * (0.6 + r() * 0.2), rad * 0.62, depth - 1);
    }
    if (depth <= 1) leafCluster(to, 1.5, r, leaves);
  };
  const main = 4 + Math.floor(r() * 2);
  for (let i = 0; i < main; i++) {
    const a = (i / main) * Math.PI * 2 + r() * 0.6;
    const start = top.clone().add(new THREE.Vector3(0, -r() * 1.1, 0));
    grow(start, new THREE.Vector3(Math.cos(a), 0.7 + r() * 0.5, Math.sin(a)).normalize(), 1.5 + r() * 0.5, 0.12, 2);
  }
  leafCluster(top.clone().add(new THREE.Vector3(0, 1.2, 0)), 2.2, r, leaves);
  return { wood: mergeGeometries(wood.map((g) => g.toNonIndexed ? g.toNonIndexed() : g)), leaves: mergeGeometries(leaves.map((g) => g.toNonIndexed())) };
}

function pine(seed) {
  const r = rng(seed);
  const h = 7 + r() * 3;
  const wood = [limb(new THREE.Vector3(0, -0.2, 0), new THREE.Vector3(0, h, 0), 0.28, 0.05, 7)];
  const boughs = [];
  const layers = 7;
  for (let i = 0; i < layers; i++) {
    const t = i / (layers - 1);
    const rad = 2.4 * (1 - t) + 0.35;
    const cone = new THREE.ConeGeometry(rad, 2.2 - t * 0.8, 10, 3, true);
    const p = cone.attributes.position;
    for (let k = 0; k < p.count; k++) {
      const x = p.getX(k), z = p.getZ(k), y = p.getY(k);
      const n = 1 + (Math.sin(Math.atan2(z, x) * 5 + seed + i) * 0.12) + (r() - 0.5) * 0.08;
      p.setXYZ(k, x * n, y - (Math.hypot(x, z) / rad) * 0.25, z * n);
    }
    cone.computeVertexNormals();
    cone.translate(0, 1.6 + t * (h - 2.2), 0);
    boughs.push(cone.toNonIndexed());
  }
  return { wood: mergeGeometries(wood.map((g) => g.toNonIndexed())), leaves: mergeGeometries(boughs) };
}

/**
 * Plant trees at the given spots ([x, y, z, scale, kind]); returns the meshes added.
 * quality: 'high' | 'medium' | 'low'
 */
export function plantTrees(scene, spots, quality) {
  const bark = new THREE.MeshStandardMaterial({ map: barkTexture(), roughness: 1, color: 0xb59c86 });
  const leafMat = new THREE.MeshStandardMaterial({ map: leafTexture(), alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.85, color: 0xc8d8a8 });
  const needleTex = needleTexture(); needleTex.repeat.set(4, 2);
  const needles = new THREE.MeshStandardMaterial({ map: needleTex, roughness: 0.95, color: 0xb8c8b0, side: THREE.DoubleSide });
  if (quality === 'low') {
    // No sky reflections on Low: lift the foliage so it doesn't turn into black silhouettes.
    for (const mat of [leafMat, needles]) { mat.emissive = new THREE.Color(0x1c2a14); mat.color.multiplyScalar(1.35); }
    bark.emissive = new THREE.Color(0x140e08);
  }
  const kinds = [broadleaf(3), broadleaf(17), pine(29), pine(41)];
  const meshes = [];
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), c = new THREE.Color();
  kinds.forEach((k, ki) => {
    const mine = spots.filter((sp) => sp[4] % kinds.length === ki);
    if (!mine.length) return;
    const isPine = ki >= 2;
    const wood = new THREE.InstancedMesh(k.wood, bark, mine.length);
    const leaves = new THREE.InstancedMesh(k.leaves, isPine ? needles : leafMat, mine.length);
    mine.forEach(([x, y, z, sc, kind], i) => {
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), (kind * 2.399) % (Math.PI * 2));
      s.set(sc, sc * (0.9 + ((kind * 7) % 10) / 30), sc);
      m.compose(new THREE.Vector3(x, y, z), q, s);
      wood.setMatrixAt(i, m); leaves.setMatrixAt(i, m);
      leaves.setColorAt(i, c.setHSL(0.24 + ((kind * 13) % 10) / 150, 0.35, 0.42 + ((kind * 3) % 10) / 60));
    });
    for (const im of [wood, leaves]) {
      im.castShadow = quality !== 'low';
      im.receiveShadow = true;
      scene.add(im);
      meshes.push(im);
    }
  });
  return meshes;
}

/** Winter: bare trees (branches only, no leaves), e.g. London plane trees along a street. spots: [x, y, z, scale, seed] */
export function plantBareTrees(scene, spots, quality) {
  const bark = new THREE.MeshStandardMaterial({ map: barkTexture(), roughness: 0.8, color: 0x6e6660 }); // dark and wet
  if (quality === 'low') bark.emissive = new THREE.Color(0x0c0c0e);
  const kinds = [broadleaf(3), broadleaf(17), broadleaf(23)];
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3();
  kinds.forEach((k, ki) => {
    const mine = spots.filter((sp) => sp[4] % kinds.length === ki);
    if (!mine.length) return;
    const im = new THREE.InstancedMesh(k.wood, bark, mine.length);
    mine.forEach(([x, y, z, sc, seed], i) => {
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), (seed * 2.399) % (Math.PI * 2));
      m.compose(new THREE.Vector3(x, y, z), q, s.set(sc, sc * 1.15, sc));
      im.setMatrixAt(i, m);
    });
    im.castShadow = quality !== 'low';
    im.receiveShadow = true;
    scene.add(im);
  });
}
