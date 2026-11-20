/* Export the London street for baking its lighting in Blender (see tools/bake/README.md).
 * Usage: node tools/bake/export-london.js <movie-night url with ?key=...> <out dir>
 * Writes london.glb (street surfaces with their light-texture layout + everything that casts
 * shadows) and london-lights.json (lamps, wall lanterns, lit windows). */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const [url, out] = process.argv.slice(2);
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const p = await (await b.newContext({ viewport: { width: 800, height: 500 } })).newPage();
  p.on('pageerror', (e) => console.log('PAGE ERROR', e.message));
  await p.goto(url);
  await p.evaluate(() => { localStorage.setItem('mn_name', 'Bake'); localStorage.setItem('mn_gq', 'high'); });
  await p.goto(new URL('/game/', url).href);
  await p.waitForFunction(() => document.getElementById('loading').classList.contains('hidden'), null, { timeout: 300000 });
  await p.waitForTimeout(20000); // the 3D models
  const res = await p.evaluate(async () => {
    const THREE = await import('three');
    const { GLTFExporter } = await import('three/addons/exporters/GLTFExporter.js');
    const { mergeGeometries } = await import('three/addons/utils/BufferGeometryUtils.js');
    const g = window.__game, L = g.london;
    g.renderer.setAnimationLoop(null);
    g.me.root.visible = false; for (const pd of g.peds) pd.root.visible = false;
    const shown = (o) => { for (let x = o; x; x = x.parent) if (!x.visible) return false; return true; };
    const out = new THREE.Scene();
    const albedo = [];
    L.statics.forEach((m, i) => {
      const geo = new THREE.BufferGeometry();
      for (const k of ['position', 'normal', 'uv1']) geo.setAttribute(k === 'uv1' ? 'uv' : k, m.geometry.attributes[k]); // (light layout as the first set)
      const c = m.material.color.clone().multiplyScalar(m.material.map ? 0.42 : 0.8);
      albedo.push(c.toArray());
      const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: c, roughness: 1 }));
      mesh.name = `S${i}`; mesh.material.name = `S${i}`;
      out.add(mesh);
    });
    // Everything else that stands still and blocks light.
    const occ = [];
    const statics = new Set(L.statics);
    const box = new THREE.Box3(), mtx = new THREE.Matrix4();
    g.scene.updateMatrixWorld(true);
    g.scene.traverse((o) => {
      if (!(o.isMesh) || o.isSkinnedMesh || statics.has(o) || !shown(o)) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      if (mats.some((m) => m.isShaderMaterial || m.transparent || /bulb|glass/i.test(m.name || ''))) return;
      box.setFromObject(o);
      if (box.isEmpty() || box.max.x - box.min.x > 400) return;
      const c = box.getCenter(new THREE.Vector3());
      if (c.x < -100 || c.x > 100 || c.z < -40 || c.z > 60) return;
      const base = new THREE.BufferGeometry(); base.setAttribute('position', o.geometry.attributes.position); if (o.geometry.index) base.setIndex(o.geometry.index);
      const n = o.isInstancedMesh ? o.count : 1;
      for (let i = 0; i < n; i++) {
        const gg = base.index ? base.toNonIndexed() : base.clone();
        if (o.isInstancedMesh) { o.getMatrixAt(i, mtx); gg.applyMatrix4(mtx.premultiply(o.matrixWorld)); } else gg.applyMatrix4(o.matrixWorld);
        occ.push(gg);
      }
    });
    const og = mergeGeometries(occ); og.computeVertexNormals();
    const om = new THREE.Mesh(og, new THREE.MeshStandardMaterial({ color: 0x404040, roughness: 1 })); om.name = 'OCCLUDERS'; om.material.name = 'OCCLUDERS';
    out.add(om);
    const glb = await new GLTFExporter().parseAsync(out, { binary: true });
    let bin = ''; const u8 = new Uint8Array(glb); for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    return { glb: btoa(bin), info: { ...L.bakeInfo, albedo, statics: L.statics.length, occluderTris: og.attributes.position.count / 3 } };
  });
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'london.glb'), Buffer.from(res.glb, 'base64'));
  fs.writeFileSync(path.join(out, 'london-lights.json'), JSON.stringify(res.info));
  console.log('exported', res.info.statics, 'surfaces,', res.info.occluderTris, 'occluder triangles, hash', res.info.hash, 'density', res.info.density.toFixed(1), 'px/m');
  await b.close();
})().catch((e) => { console.error('FAILED', e.message); process.exit(1); });
