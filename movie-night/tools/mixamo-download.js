/*
 * Movie Night · Our World - download Mixamo animations in bulk.
 *
 * HOW TO USE (Chrome or Edge on the laptop):
 *   1. Sign in at https://www.mixamo.com and stay on the site.
 *   2. Press F12, click the "Console" tab.
 *   3. Paste this whole script and press Enter. (If Chrome says "allow pasting", type
 *      allow pasting and press Enter, then paste again.)
 *   4. The files go to your Downloads folder (like Mixamo's own Download button). When Chrome
 *      asks "Download multiple files?", click Allow. Afterwards, move them (and manifest.json)
 *      into  Movie Night\game-assets\mixamo.
 *   5. Leave the tab open. Progress shows in the console. You can stop (close the tab)
 *      and run it again later: animations already downloaded are skipped.
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
      if (r.status === 429 || r.status >= 500) { await sleep(5000 * (attempt + 1)); continue; } // too fast / busy: wait and retry
      if (!r.ok) throw new Error(`${r.status} on ${path}`);
      return r.json();
    }
    throw new Error(`Mixamo kept refusing ${path}`);
  }
  const primary = await api('characters/primary');
  const characterId = primary.primary_character_id;
  if (!characterId) { console.error('Could not find your Mixamo character. Click any character in Mixamo first.'); return; }

  // ---- Remember what's done (so a re-run skips it) ----------------------------------------------
  const DONE_KEY = 'mn_mixamo_done';
  const doneIds = new Set(JSON.parse(localStorage.getItem(DONE_KEY) || '[]'));
  const markDone = (id) => { doneIds.add(id); localStorage.setItem(DONE_KEY, JSON.stringify([...doneIds])); };
  // The page only allows downloads by following a link (not by fetching), like its own button.
  function saveLink(url, name) {
    const a = document.createElement('a');
    a.href = url; if (name) a.download = name; a.rel = 'noopener';
    document.body.appendChild(a); a.click(); a.remove();
  }
  const MANIFEST_KEY = 'mn_mixamo_manifest';
  const manifest = JSON.parse(localStorage.getItem(MANIFEST_KEY) || '[]');
  const saveManifestFile = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(manifest, null, 1)], { type: 'application/json' }));
    saveLink(url, 'manifest.json');
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };

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
  let done = 0, skipped = 0, failed = 0, n = 0;
  for (const a of wanted.values()) {
    n++;
    if (doneIds.has(a.id)) { skipped++; continue; }
    try {
      const info = await api(`products/${a.id}?similar=0&character_id=${characterId}`);
      const g = info.details.gms_hash;
      const gms = { 'model-id': g['model-id'], mirror: g.mirror, trim: g.trim, overdrive: g.overdrive,
        params: (g.params || []).map((p) => p[1]).join(','), 'arm-space': g['arm-space'], inplace: a.inplace ? true : g.inplace };
      await api('animations/export', { method: 'POST', body: JSON.stringify({ character_id: characterId, gms_hash: [gms], preferences: SETTINGS, product_name: a.name, type: 'Motion' }) });
      let url = null;
      for (let i = 0; i < 90 && !url; i++) {
        await sleep(2000);
        const m = await api(`characters/${characterId}/monitor`);
        if (m.status === 'completed') url = m.job_result;
        else if (m.status === 'failed') throw new Error('Mixamo could not export it');
      }
      if (!url) throw new Error('timed out');
      saveLink(url);
      const file = decodeURIComponent(new URL(url).pathname.split('/').pop());
      manifest.push({ ...a, file, order: manifest.length + 1 });
      localStorage.setItem(MANIFEST_KEY, JSON.stringify(manifest));
      markDone(a.id);
      done++;
      console.log(`✅ ${n}/${wanted.size} ${a.cat}/${a.name} (${a.description})`);
    } catch (e) {
      failed++;
      console.warn(`⚠️ ${n}/${wanted.size} ${a.name}: ${e.message}`);
    }
    await sleep(2500); // gentle on Mixamo (it refuses if asked too fast)
    if (done && done % 100 === 0) saveManifestFile();
  }
  saveManifestFile();
  console.log(`🎉 Finished: ${done} downloaded, ${skipped} already done, ${failed} failed. (Run again to retry the failed ones.) Now move the files and manifest.json into Movie Night\\game-assets\\mixamo.`);
})();
