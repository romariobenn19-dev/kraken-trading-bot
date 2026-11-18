/*
 * Movie Night · Our World - download Mixamo animations in bulk.
 *
 * HOW TO USE (Chrome or Edge on the laptop):
 *   1. Sign in at https://www.mixamo.com and stay on the site.
 *   2. Press F12, click the "Console" tab.
 *   3. Paste this whole script and press Enter. (If Chrome says "allow pasting", type
 *      allow pasting and press Enter, then paste again.)
 *   4. Click the "Choose folder" button that appears, then pick (or create) the folder
 *      Movie Night\game-assets\mixamo  and allow Chrome to save files there.
 *   5. Leave the tab open. Progress shows in the console. You can stop (close the tab)
 *      and run it again later: files that are already there are skipped.
 *
 * What it does: searches Mixamo for every kind of action in the list below, and saves
 * each animation as FBX (no skin, 30 fps, no keyframe reduction; walking/running "in place").
 * It only talks to mixamo.com with your own signed-in session. Nothing is sent anywhere else.
 */
(async () => {
  'use strict';
  // ---- What to fetch -------------------------------------------------------------------
  // [folder, search words, in place?]
  const SEARCHES = [
    ['locomotion', 'idle'], ['locomotion', 'breathing idle'], ['locomotion', 'walking', true], ['locomotion', 'walk', true],
    ['locomotion', 'running', true], ['locomotion', 'jog', true], ['locomotion', 'sprint', true], ['locomotion', 'strafe', true],
    ['locomotion', 'walking backwards', true], ['locomotion', 'turn'], ['locomotion', 'jump'], ['locomotion', 'crouch', true],
    ['locomotion', 'sneak', true], ['locomotion', 'crawl', true], ['locomotion', 'climb'], ['locomotion', 'ladder'],
    ['locomotion', 'swim'], ['locomotion', 'fall'], ['locomotion', 'landing'], ['locomotion', 'roll'], ['locomotion', 'injured', true],
    ['social', 'wave'], ['social', 'greeting'], ['social', 'hug'], ['social', 'kiss'], ['social', 'blow kiss'], ['social', 'handshake'],
    ['social', 'talking'], ['social', 'laughing'], ['social', 'crying'], ['social', 'clapping'], ['social', 'cheering'],
    ['social', 'pointing'], ['social', 'thumbs up'], ['social', 'shrug'], ['social', 'bow'], ['social', 'thinking'],
    ['social', 'agree'], ['social', 'disagree'], ['social', 'angry'], ['social', 'sad'], ['social', 'happy'], ['social', 'excited'],
    ['social', 'surprised'], ['social', 'shocked'], ['social', 'scared'], ['social', 'flinch'], ['social', 'yawn'],
    ['social', 'stretching'], ['social', 'kneeling'], ['social', 'praying'], ['social', 'phone'], ['social', 'texting'], ['social', 'look around'],
    ['romance', 'slow dance'], ['romance', 'dancing'], ['romance', 'salsa'], ['romance', 'samba'], ['romance', 'tango'],
    ['romance', 'waltz'], ['romance', 'swing dancing'], ['romance', 'hip hop dancing'], ['romance', 'carry'], ['romance', 'slap'],
    ['home', 'sitting'], ['home', 'sit'], ['home', 'stand up'], ['home', 'lying'], ['home', 'sleeping'], ['home', 'laying'],
    ['home', 'drinking'], ['home', 'eating'], ['home', 'cooking'], ['home', 'typing'], ['home', 'open door'], ['home', 'knocking'],
    ['home', 'pick up'], ['home', 'put down'], ['home', 'push'], ['home', 'pull'], ['home', 'lifting'],
    ['work', 'chopping'], ['work', 'hammering'], ['work', 'digging'], ['work', 'mining'], ['work', 'fishing'], ['work', 'planting'],
    ['work', 'gathering'], ['work', 'building'], ['work', 'working'], ['work', 'carrying'], ['work', 'sweeping'], ['work', 'painting'],
    ['combat', 'rifle'], ['combat', 'pistol'], ['combat', 'shooting'], ['combat', 'firing'], ['combat', 'aiming'], ['combat', 'reload'],
    ['combat', 'grenade'], ['combat', 'cover'], ['combat', 'punch'], ['combat', 'kick'], ['combat', 'block'], ['combat', 'dodge'],
    ['combat', 'hit reaction'], ['combat', 'death'], ['combat', 'dying'], ['combat', 'knocked down'], ['combat', 'getting up'],
    ['combat', 'melee'], ['combat', 'bat'], ['combat', 'surrender'],
  ];
  const MAX_PER_SEARCH = 40;          // at most this many results per search word
  const SETTINGS = { format: 'fbx7', skin: 'false', fps: '30', reducekf: '0' };

  // ---- Mixamo API --------------------------------------------------------------------------
  const token = localStorage.getItem('access_token');
  if (!token) { console.error('Not signed in to Mixamo: sign in first, then run this again.'); return; }
  const H = { Authorization: `Bearer ${token}`, 'X-Api-Key': 'mixamo2', 'Content-Type': 'application/json', Accept: 'application/json' };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  async function api(path, opts = {}) {
    for (let attempt = 0; attempt < 6; attempt++) {
      const r = await fetch(`https://www.mixamo.com/api/v1/${path}`, { headers: H, ...opts });
      if (r.status === 429 || r.status >= 500) { await sleep(2000 * (attempt + 1)); continue; }
      if (!r.ok) throw new Error(`${r.status} on ${path}`);
      return r.json();
    }
    throw new Error(`Mixamo kept refusing ${path}`);
  }
  const primary = await api('characters/primary');
  const characterId = primary.primary_character_id;
  if (!characterId) { console.error('Could not find your Mixamo character. Click any character in Mixamo first.'); return; }

  // ---- Where to save ---------------------------------------------------------------------------
  const dir = await new Promise((resolve) => {
    const b = document.createElement('button');
    b.textContent = '📁 Choose folder (Movie Night\\game-assets\\mixamo)';
    Object.assign(b.style, { position: 'fixed', top: '20px', left: '50%', transform: 'translateX(-50%)', zIndex: 99999,
      padding: '16px 26px', fontSize: '18px', fontWeight: 700, background: '#b2606b', color: '#fff', border: 0, borderRadius: '999px', cursor: 'pointer' });
    b.onclick = async () => { try { const d = await window.showDirectoryPicker({ mode: 'readwrite' }); b.remove(); resolve(d); } catch { /* cancelled */ } };
    document.body.appendChild(b);
    console.log('👉 Click the pink "Choose folder" button at the top of the page.');
  });
  const sub = {};
  const folder = async (name) => sub[name] || (sub[name] = await dir.getDirectoryHandle(name, { create: true }));
  const exists = async (d, name) => { try { await d.getFileHandle(name); return true; } catch { return false; } };
  const clean = (s) => String(s).replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 70);

  // ---- Find everything -------------------------------------------------------------------------
  const wanted = new Map(); // id -> { id, name, description, cat, inplace }
  for (const [cat, query, inplace] of SEARCHES) {
    let got = 0;
    for (let page = 1; got < MAX_PER_SEARCH; page++) {
      const res = await api(`products?page=${page}&limit=96&order=&type=Motion&query=${encodeURIComponent(query)}`);
      const list = (res.results || []).filter((x) => x.type === 'Motion');
      for (const x of list) {
        if (got >= MAX_PER_SEARCH) break;
        got++;
        if (!wanted.has(x.id)) wanted.set(x.id, { id: x.id, name: x.name, description: x.description || '', cat, inplace: !!inplace, query });
      }
      const pages = (res.pagination && res.pagination.num_pages) || 1;
      if (page >= pages || !list.length) break;
    }
    console.log(`🔎 "${query}": ${got} found (${wanted.size} different so far)`);
  }
  console.log(`📋 ${wanted.size} animations to fetch. This takes a while; keep this tab open.`);

  // ---- Download ------------------------------------------------------------------------------------
  const manifest = [];
  let done = 0, skipped = 0, failed = 0, n = 0;
  for (const a of wanted.values()) {
    n++;
    const d = await folder(a.cat);
    const file = `${clean(a.name)} - ${clean(a.description).slice(0, 40)} [${a.id.slice(0, 8)}].fbx`;
    manifest.push({ ...a, file: `${a.cat}/${file}` });
    if (await exists(d, file)) { skipped++; continue; }
    try {
      const info = await api(`products/${a.id}?similar=0&character_id=${characterId}`);
      const g = info.details.gms_hash;
      const gms = { 'model-id': g['model-id'], mirror: g.mirror, trim: g.trim, overdrive: g.overdrive,
        params: (g.params || []).map((p) => p[1]).join(','), 'arm-space': g['arm-space'], inplace: a.inplace ? true : g.inplace };
      await api('animations/export', { method: 'POST', body: JSON.stringify({ character_id: characterId, gms_hash: [gms], preferences: SETTINGS, product_name: a.name, type: 'Motion' }) });
      let url = null;
      for (let i = 0; i < 90 && !url; i++) {
        await sleep(1500);
        const m = await api(`characters/${characterId}/monitor`);
        if (m.status === 'completed') url = m.job_result;
        else if (m.status === 'failed') throw new Error('Mixamo could not export it');
      }
      if (!url) throw new Error('timed out');
      const blob = await (await fetch(url)).blob();
      const w = await (await d.getFileHandle(file, { create: true })).createWritable();
      await w.write(blob); await w.close();
      done++;
      console.log(`✅ ${n}/${wanted.size} ${a.cat}/${a.name} (${a.description})`);
    } catch (e) {
      failed++;
      console.warn(`⚠️ ${n}/${wanted.size} ${a.name}: ${e.message}`);
    }
    if (n % 25 === 0) {
      const w = await (await dir.getFileHandle('manifest.json', { create: true })).createWritable();
      await w.write(JSON.stringify(manifest, null, 1)); await w.close();
    }
  }
  const w = await (await dir.getFileHandle('manifest.json', { create: true })).createWritable();
  await w.write(JSON.stringify([...wanted.values()].map((a) => manifest.find((m) => m.id === a.id)), null, 1)); await w.close();
  console.log(`🎉 Finished: ${done} downloaded, ${skipped} already there, ${failed} failed. (Run again to retry the failed ones.)`);
})();
