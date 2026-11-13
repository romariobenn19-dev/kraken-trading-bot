/* Movie Night - web player (runs on both the host laptop and the partner's tablet). */
'use strict';

const $ = (id) => document.getElementById(id);

// If the artwork file is missing (e.g. an interrupted update), keep working with plain emojis.
if (!window.Art) {
  const blank = () => '';
  window.Art = {
    head: blank, bowSvg: blank, scene: blank, couple: blank, fetchingPup: blank, reaction: blank,
    SCENES: [], REACTIONS: [], fallback: true,
  };
}
const video = $('video');

// ---- Identity ---------------------------------------------------------------
const params = new URLSearchParams(location.search);
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};
if (params.get('role')) store.set('mn_role', params.get('role'));
const role = store.get('mn_role') === 'host' ? 'host' : 'guest';
// The server already stored the key in a cookie; keep it out of the address bar.
if (params.has('key')) {
  params.delete('key');
  history.replaceState(null, '', location.pathname + (params.toString() ? `?${params}` : ''));
}

// ---- State ------------------------------------------------------------------
let ws = null;
let state = null;          // latest room state from the server
let peers = [];
let movies = [];
let meta = null;           // the open movie
let hls = null;
let qualityLevels = [];    // [{ index, label }]
let stalled = false;
let clockOffset = 0;       // serverTime - localTime
let clockSamples = [];
let wakeLock = null;
let openId = null;          // movie currently open (or opening)
let isHost = false;         // true on the laptop running Movie Night
let appVersion = null;

const serverNow = () => Date.now() + clockOffset;
const expectedPos = () => (!state ? 0 : state.paused ? state.pos : state.pos + (serverNow() - state.at) / 1000);

// ---- Join ---------------------------------------------------------------------
$('name').value = store.get('mn_name') || '';
$('joinBtn').onclick = join;
$('name').addEventListener('keydown', (e) => { if (e.key === 'Enter') join(); });
// After the first visit, skip the name screen entirely - just open the link and you're in.
if (store.get('mn_name')) join();

function join() {
  const name = $('name').value.trim() || (role === 'host' ? 'Host' : 'Guest');
  store.set('mn_name', name);
  $('join').classList.add('hidden');
  showScreen('library');
  connect();
  refreshMovies();
  loadPersonal();
}

// ---- Networking ---------------------------------------------------------------
let retry = 0;
function connect() {
  ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/sync`);
  ws.onopen = () => {
    retry = 0;
    $('netBanner').classList.add('hidden');
    send({ t: 'hello', name: store.get('mn_name'), role });
    clockSamples = [];
    for (let i = 0; i < 6; i++) setTimeout(ping, i * 300);
  };
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.t === 'state') onState(m);
    else if (m.t === 'pong') onPong(m);
    else if (m.t === 'peers') { peers = m.peers; renderPeers(); renderHold(); }
    else if (m.t === 'react') floatEmoji(m.emoji, m.from);
    else if (m.t === 'welcome') onWelcome(m);
    else if (m.t === 'jobs') renderJobs(m.jobs);
    else if (m.t === 'library') refreshMovies();
    else if (m.t === 'personal') loadPersonal();
    else if (m.t === 'restarting') { toast('Updating Movie Night… back in a few seconds'); appVersion = 'restarting'; }
  };
  ws.onclose = () => {
    $('netBanner').classList.remove('hidden');
    setTimeout(connect, Math.min(10000, 500 * 2 ** retry++));
  };
}
function send(m) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(m)); }
function ping() { send({ t: 'ping', c: Date.now() }); }
setInterval(ping, 10000);

function onPong(m) {
  const now = Date.now();
  const rtt = now - m.c;
  clockSamples.push({ rtt, off: m.s - (m.c + rtt / 2) });
  clockSamples = clockSamples.slice(-12);
  // The sample with the lowest round-trip time is the most trustworthy.
  clockOffset = clockSamples.reduce((a, b) => (b.rtt < a.rtt ? b : a)).off;
}

// ---- Library ------------------------------------------------------------------
async function refreshMovies() {
  try {
    const r = await fetch('/api/movies', { cache: 'no-store' });
    movies = await r.json();
  } catch { movies = []; }
  const grid = $('movies');
  grid.innerHTML = '';
  $('noMovies').classList.toggle('hidden', movies.length > 0);
  for (const mv of movies) {
    const b = document.createElement('button');
    b.className = 'card';
    const best = mv.renditions && mv.renditions[0] ? mv.renditions[0].label : '';
    b.innerHTML = `<div class="poster"></div><div class="meta"><b></b><span></span></div>`;
    const poster = b.querySelector('.poster');
    if (mv.poster) poster.style.backgroundImage = `url("/library/${encodeURIComponent(mv.id)}/${mv.poster}")`;
    else if (Art.SCENES.length) poster.innerHTML = Art.scene(Art.SCENES[movies.indexOf(mv) % Art.SCENES.length]);
    else poster.textContent = '🎞️';
    b.insertAdjacentHTML('beforeend', `<span class="card-bow">${Art.bowSvg()}</span>`);
    b.querySelector('b').textContent = mv.title;
    b.querySelector('span').textContent = `${fmt(mv.duration)} · up to ${best}${mv.subtitles ? ' · CC' : ''}`;
    b.onclick = () => send({ t: 'load', movieId: mv.id });
    if (isHost) {
      const del = document.createElement('span');
      del.className = 'del';
      del.setAttribute('role', 'button');
      del.title = 'Delete this movie from the laptop';
      del.textContent = '🗑';
      del.onclick = (e) => { e.stopPropagation(); deleteMovie(mv); };
      b.appendChild(del);
    }
    grid.appendChild(b);
  }
}

function showScreen(id) {
  for (const s of ['library', 'player']) $(s).classList.toggle('hidden', s !== id);
}

// ---- Room state -----------------------------------------------------------------
async function onState(s) {
  state = s;
  if ((s.movieId || null) !== openId) {
    openId = s.movieId || null;
    if (openId) await openMovie(openId);
    else closeMovie();
    if (openId !== (state.movieId || null)) return; // a newer state took over meanwhile
  }
  applyState();
  renderHold();
  updatePlayButton();
  renderIntermission();
}

function closeMovie() {
  if (hls) { hls.destroy(); hls = null; }
  video.removeAttribute('src');
  video.load();
  meta = null;
  releaseWakeLock();
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  showScreen('library');
  refreshMovies();
}

async function openMovie(id) {
  if (!movies.find((m) => m.id === id)) await refreshMovies();
  const mv = movies.find((m) => m.id === id);
  if (id !== openId) return;
  if (!mv) { showScreen('library'); return; }
  if (hls) { hls.destroy(); hls = null; }
  meta = mv;
  $('title').textContent = mv.title;
  showScreen('player');
  for (const t of [...video.querySelectorAll('track')]) t.remove();
  if (mv.subtitles) {
    const tr = document.createElement('track');
    tr.kind = 'subtitles'; tr.label = 'Subtitles'; tr.srclang = 'en';
    tr.src = `/library/${encodeURIComponent(mv.id)}/${mv.subtitles}`;
    video.appendChild(tr);
    $('subsBtn').classList.remove('hidden');
    setSubs(store.get('mn_subs') !== 'off');
  } else {
    $('subsBtn').classList.add('hidden');
  }

  const base = `/library/${encodeURIComponent(mv.id)}/`;
  const useHevc = mv.hevc && await canPlayHevc();
  if (id !== openId) return;
  const src = base + (useHevc ? mv.hevc : mv.avc || mv.hevc);
  const startPosition = state ? expectedPos() : 0;

  if (window.Hls && Hls.isSupported()) {
    hls = new Hls({
      // Deep buffer: keep up to ~2 minutes ahead so short Wi-Fi dips never show.
      maxBufferLength: 120,
      maxMaxBufferLength: 300,
      maxBufferSize: 120 * 1000 * 1000,
      backBufferLength: 20,
      startPosition,
      capLevelToPlayerSize: false,
      // Be a bit conservative so quality doesn't flip-flop on a shaky connection.
      abrEwmaDefaultEstimate: 2_500_000,
      abrBandWidthFactor: 0.8,
      abrBandWidthUpFactor: 0.7,
      // Forget a bad patch quickly so the picture climbs back up once Wi-Fi recovers.
      abrEwmaFastVoD: 3,
      abrEwmaSlowVoD: 8,
      fragLoadPolicy: {
        default: {
          maxTimeToFirstByteMs: 15000,
          maxLoadTimeMs: 90000,
          timeoutRetry: { maxNumRetry: 6, retryDelayMs: 500, maxRetryDelayMs: 4000 },
          errorRetry: { maxNumRetry: 10, retryDelayMs: 1000, maxRetryDelayMs: 8000 },
        },
      },
    });
    hls.on(Hls.Events.MANIFEST_PARSED, () => setupQuality());
    hls.on(Hls.Events.LEVEL_SWITCHED, () => updateQualityLabel());
    hls.on(Hls.Events.ERROR, (_e, data) => {
      if (!data.fatal) return;
      if (data.type === Hls.ErrorTypes.NETWORK_ERROR) setTimeout(() => hls && hls.startLoad(), 2000);
      else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) hls.recoverMediaError();
    });
    hls.loadSource(src);
    hls.attachMedia(video);
  } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
    // Safari / iPad: native HLS.
    video.src = src;
    video.addEventListener('loadedmetadata', () => { video.currentTime = startPosition; }, { once: true });
    $('quality').innerHTML = '<option>Auto</option>';
  }
  showChrome();
}

/** HEVC gives the same picture at ~60% of the data, so prefer it when the device decodes it in hardware. */
async function canPlayHevc() {
  const type = 'video/mp4; codecs="hvc1.1.6.L123.90"';
  if (!(window.MediaSource && MediaSource.isTypeSupported(type))) return false;
  if (!navigator.mediaCapabilities) return true;
  try {
    const r = await navigator.mediaCapabilities.decodingInfo({
      type: 'media-source', video: { contentType: type, width: 1920, height: 1080, bitrate: 3_500_000, framerate: 24 },
    });
    return r.supported && r.smooth;
  } catch { return true; }
}

/**
 * Only offer qualities this device can actually show and decode smoothly.
 * e.g. a 1920x1200 tablet gets up to 1080p; a 4K-capable laptop gets 2160p.
 */
async function setupQuality() {
  const levels = hls.levels;
  const screenPx = Math.max(screen.width, screen.height) * (window.devicePixelRatio || 1);
  let maxOk = 0;
  for (let i = 0; i < levels.length; i++) {
    const lv = levels[i];
    if (i > 0 && lv.width > screenPx * 1.15) continue;
    let ok = true;
    if (navigator.mediaCapabilities && lv.videoCodec) {
      try {
        const r = await navigator.mediaCapabilities.decodingInfo({
          type: 'media-source',
          video: { contentType: `video/mp4; codecs="${lv.videoCodec}"`, width: lv.width, height: lv.height,
            bitrate: lv.bitrate, framerate: lv.frameRate || (meta && meta.fps) || 24 },
        });
        ok = r.supported && r.smooth;
      } catch { /* assume ok */ }
    }
    if (ok || i === 0) maxOk = i;
  }
  if (!hls) return;
  hls.autoLevelCapping = maxOk;
  qualityLevels = levels.slice(0, maxOk + 1).map((lv, index) => ({ index, label: labelFor(lv) })).reverse();
  const sel = $('quality');
  sel.innerHTML = '';
  const auto = new Option('Auto', '-1');
  sel.appendChild(auto);
  for (const q of qualityLevels) sel.appendChild(new Option(q.label, String(q.index)));
  const saved = store.get('mn_quality');
  const savedLevel = qualityLevels.find((q) => q.label.split(' · ')[0] === saved);
  sel.value = savedLevel ? String(savedLevel.index) : '-1';
  if (savedLevel) hls.loadLevel = savedLevel.index;
  updateQualityLabel();
}

function labelFor(lv) {
  const name = lv.height >= 2000 || lv.width >= 3800 ? '2160p' : lv.width >= 2500 ? '1440p' : lv.width >= 1900 ? '1080p'
    : lv.width >= 1260 ? '720p' : lv.width >= 840 ? '480p' : '360p';
  const hq = name === '1080p' && String(lv.uri || [].concat(lv.url || [])[0] || '').includes('-hq_') ? ' HQ' : '';
  return `${name}${hq} · ${((lv.averageBitrate || lv.bitrate) / 1e6).toFixed(1)} Mbps`;
}

function updateQualityLabel() {
  const sel = $('quality');
  const autoOpt = sel.querySelector('option[value="-1"]');
  if (!autoOpt || !hls) return;
  const cur = hls.levels[hls.currentLevel];
  autoOpt.textContent = cur ? `Auto (${labelFor(cur).split(' · ')[0]})` : 'Auto';
}

$('quality').onchange = (e) => {
  if (!hls) return;
  const i = Number(e.target.value);
  // loadLevel switches from the next chunk on, keeping what's already buffered.
  hls.loadLevel = i;
  const q = qualityLevels.find((x) => x.index === i);
  store.set('mn_quality', q ? q.label.split(' · ')[0] : 'auto');
  updateQualityLabel();
};

// ---- Applying the shared state to the local video -----------------------------
function applyState() {
  if (!state || !meta) return;
  const exp = expectedPos();
  if (state.paused) {
    if (!video.paused) video.pause();
    video.playbackRate = 1;
    if (Math.abs(video.currentTime - exp) > 0.3) video.currentTime = exp;
    stalled = false;
    releaseWakeLock();
  } else {
    if (Math.abs(video.currentTime - exp) > 1) video.currentTime = exp;
    if (video.paused) {
      video.play().then(() => $('tapToPlay').classList.add('hidden')).catch(() => $('tapToPlay').classList.remove('hidden'));
    }
    requestWakeLock();
  }
}

// Gentle drift correction: speed up/slow down by a few % instead of jumping.
setInterval(() => {
  if (!state || !meta || state.paused || video.paused || video.seeking) return;
  const drift = video.currentTime - expectedPos();
  if (Math.abs(drift) > 1.5) { video.currentTime = expectedPos(); video.playbackRate = 1; }
  else if (Math.abs(drift) > 0.12) video.playbackRate = drift > 0 ? 0.96 : 1.04;
  else video.playbackRate = 1;
}, 500);

$('tapToPlay').onclick = () => { $('tapToPlay').classList.add('hidden'); applyState(); };

// ---- Reporting this device's health to the room --------------------------------
function bufferAhead() {
  const b = video.buffered, ct = video.currentTime;
  for (let i = 0; i < b.length; i++) {
    if (b.start(i) <= ct + 0.5 && b.end(i) >= ct) return b.end(i) - ct;
  }
  return 0;
}
/**
 * After a Wi-Fi dip the buffer is full of low-quality video that would play for a minute or more.
 * Once the connection is clearly healthy again, swap that out for the sharp version.
 */
let lastUpgrade = 0;
let upgradeGraceUntil = 0;
function maybeUpgradeBuffered() {
  if (!hls || !hls.autoLevelEnabled || !state || state.paused) return;
  const playing = hls.currentLevel, loading = hls.nextLoadLevel;
  if (playing < 0 || loading < 0 || loading - playing < 2) return;
  if (bufferAhead() < 30 || Date.now() - lastUpgrade < 60000) return;
  if (hls.bandwidthEstimate < hls.levels[loading].bitrate * 1.8) return;
  lastUpgrade = Date.now();
  upgradeGraceUntil = Date.now() + 10000;
  hls.nextLevel = loading; // keeps the current chunk, re-downloads the rest at the higher quality
  hls.once(Hls.Events.LEVEL_SWITCHED, () => { if (hls) hls.loadLevel = -1; }); // back to automatic
}

function reportStatus() {
  if (!meta) { send({ t: 'status', movieId: null }); return; }
  maybeUpgradeBuffered();
  // During a quality upgrade the buffer is briefly short on purpose; real stalls still report via 'waiting'.
  const ahead = Date.now() < upgradeGraceUntil ? Math.max(bufferAhead(), 5) : bufferAhead();
  const dur = video.duration || meta.duration || 0;
  const lv = hls && hls.levels[hls.currentLevel];
  send({
    t: 'status', movieId: meta.id, ct: video.currentTime, buffer: ahead,
    full: dur > 0 && video.currentTime + ahead >= dur - 1,
    stalled, quality: lv ? labelFor(lv).split(' · ')[0] : '',
    codec: lv && lv.videoCodec ? (/^(hvc1|hev1)/.test(lv.videoCodec) ? 'hevc' : 'avc') : '', bw: hls ? Math.round(hls.bandwidthEstimate || 0) : 0,
  });
}
setInterval(reportStatus, 1000);
video.addEventListener('waiting', () => {
  if (state && !state.paused) { stalled = true; reportStatus(); }
});
video.addEventListener('playing', () => { stalled = false; });
video.addEventListener('timeupdate', updateTime);
video.addEventListener('ended', () => send({ t: 'pause', pos: video.duration || expectedPos() }));

// ---- Controls --------------------------------------------------------------------
$('playBtn').onclick = () => {
  if (!state) return;
  if (state.wantPlay) send({ t: 'pause', pos: expectedPos() });
  else send({ t: 'play', pos: video.currentTime });
};
$('back10').onclick = () => send({ t: 'seek', pos: Math.max(0, expectedPos() - 10) });
$('fwd10').onclick = () => send({ t: 'seek', pos: Math.min(duration() - 1, expectedPos() + 10) });
$('backBtn').onclick = () => {
  if (confirm('Go back to the movie list for both of you?')) send({ t: 'load', movieId: '' });
};

let seeking = false;
$('seek').addEventListener('input', () => {
  seeking = true;
  $('time').textContent = `${fmt(seekValue())} / ${fmt(duration())}`;
});
$('seek').addEventListener('change', () => {
  seeking = false;
  send({ t: 'seek', pos: seekValue() });
});
function seekValue() { return (Number($('seek').value) / 1000) * duration(); }
function duration() { return video.duration || (meta && meta.duration) || 0; }

function updateTime() {
  if (seeking) return;
  const d = duration();
  $('time').textContent = `${fmt(video.currentTime)} / ${fmt(d)}`;
  $('seek').value = d ? String(Math.round((video.currentTime / d) * 1000)) : '0';
}
function updatePlayButton() {
  $('playBtn').textContent = state && state.wantPlay ? '❚❚' : '▶';
}

$('subsBtn').onclick = () => setSubs(!$('subsBtn').classList.contains('on'));
function setSubs(on) {
  const t = video.textTracks[0];
  if (t) t.mode = on ? 'showing' : 'hidden';
  $('subsBtn').classList.toggle('on', on);
  store.set('mn_subs', on ? 'on' : 'off');
}

$('fsBtn').onclick = async () => {
  if (document.fullscreenElement) { document.exitFullscreen().catch(() => {}); return; }
  try {
    await $('stage').requestFullscreen({ navigationUI: 'hide' });
    if (screen.orientation && screen.orientation.lock) screen.orientation.lock('landscape').catch(() => {});
  } catch { /* not supported */ }
};

// Reactions are little cartoon versions of us.
const REACT_LABELS = { love: 'Heart eyes', laugh: 'Laughing', cry: 'Crying', shock: 'Shocked pup', kiss: 'Kiss' };
const FALLBACK_REACTS = { love: '😍', laugh: '😂', cry: '😭', shock: '😮', kiss: '😘' };
for (const key of (Art.fallback ? Object.keys(FALLBACK_REACTS) : Art.REACTIONS)) {
  const b = document.createElement('button');
  b.className = 'react';
  b.title = REACT_LABELS[key] || key;
  b.setAttribute('aria-label', b.title);
  if (Art.fallback) { b.textContent = FALLBACK_REACTS[key]; b.style.fontSize = '24px'; } else b.innerHTML = Art.reaction(key);
  b.onclick = (e) => { e.stopPropagation(); send({ t: 'react', emoji: key }); };
  $('reacts').appendChild(b);
}
function floatEmoji(key, from) {
  const el = document.createElement('div');
  el.className = 'floater';
  el.style.left = `${8 + Math.random() * 76}%`;
  const face = document.createElement('div');
  face.className = 'face';
  if (Art.REACTIONS.includes(key)) face.innerHTML = Art.reaction(key);
  else { face.textContent = (typeof FALLBACK_REACTS !== 'undefined' && FALLBACK_REACTS[key]) || key; face.style.cssText = 'font-size:52px;display:grid;place-items:center'; }
  el.appendChild(face);
  const s = document.createElement('small');
  s.textContent = from;
  el.appendChild(s);
  $('floaters').appendChild(el);
  setTimeout(() => el.remove(), 3100);
}

document.addEventListener('keydown', (e) => {
  if (!meta || e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
  if (e.code === 'Space') { e.preventDefault(); $('playBtn').click(); }
  else if (e.code === 'ArrowLeft') $('back10').click();
  else if (e.code === 'ArrowRight') $('fwd10').click();
  else if (e.code === 'KeyF') $('fsBtn').click();
});

// Show controls on tap/move, hide after a few seconds of playback.
let hideTimer = null;
function showChrome() {
  $('chrome').classList.remove('off');
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => {
    if (state && !state.paused && !seeking) $('chrome').classList.add('off');
  }, 3500);
}
$('stage').addEventListener('pointerdown', (e) => {
  const off = $('chrome').classList.contains('off');
  if (off) { e.preventDefault(); showChrome(); return; }
  if (e.target === video || e.target === $('stage') || e.target.classList.contains('chrome')) {
    $('chrome').classList.add('off');
  } else showChrome();
});
$('stage').addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse') showChrome(); });

// ---- Status UI ------------------------------------------------------------------
function renderPeers() {
  const html = peers.map((p) => {
    const health = p.full || p.buffer >= 20 ? '' : p.buffer >= 5 ? 'warn' : 'bad';
    const parts = [escapeHtml(p.name)];
    if (meta && p.ready) {
      if (p.quality) parts.push(p.quality);
      parts.push(p.full ? 'fully loaded' : `${Math.floor(p.buffer)}s ahead`);
      if (p.bw) parts.push(`${(p.bw / 1e6).toFixed(1)} Mbps`);
    }
    return `<span class="peer"><span class="avatar">${Art.head(avatarFor(p))}</span><span class="dot ${meta && p.ready ? health : ''}"></span>${parts.join(' · ')}</span>`;
  }).join('');
  $('peersLib').innerHTML = html;
  $('peersPlayer').innerHTML = html;
}

function renderHold() {
  const el = $('hold');
  if (!state || !meta || !state.hold) { el.classList.add('hidden'); return; }
  el.classList.remove('hidden');
  const need = state.hold.reason === 'starting' ? state.startBuffer : state.resumeTarget;
  const who = (state.hold.who || []).join(' & ');
  const pup = personalInfo.dog || 'The pup';
  $('holdText').textContent = state.hold.reason === 'buffering'
    ? `${who || 'Someone'}'s Wi-Fi had a hiccup, so we've paused together. ${pup} is fetching a bigger buffer (${need}s) so it doesn't happen again.`
    : `${pup} is fetching the movie…${who ? ` (waiting for ${who})` : ''}`;
  $('holdBars').innerHTML = peers.filter((p) => p.ready).map((p) => {
    const pct = p.full ? 100 : Math.min(100, (p.buffer / need) * 100);
    return `<div>${escapeHtml(p.name)} ${p.quality ? `· ${p.quality}` : ''}<div class="meter"><i style="width:${pct}%"></i></div></div>`;
  }).join('');
}

// ---- Misc ------------------------------------------------------------------------
async function requestWakeLock() {
  if (wakeLock || !('wakeLock' in navigator)) return;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release', () => { wakeLock = null; });
  } catch { /* not allowed right now */ }
}
function releaseWakeLock() { if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; } }
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') { applyState(); if (state && !state.paused) requestWakeLock(); }
});

function fmt(s) {
  s = Math.max(0, Math.floor(s || 0));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---- Host tools (only on the laptop running Movie Night) -------------------------
let hostInfo = null;
let pickedFile = null;
let currentDir = null;

function onWelcome(m) {
  // After an update the server restarts with new code: reload to pick it up.
  if (appVersion && appVersion !== m.version) { location.reload(); return; }
  appVersion = m.version;
  isHost = !!m.isHost;
  $('hostBar').classList.toggle('hidden', !isHost);
  if (isHost) { loadHostInfo(); refreshMovies(); }
}

async function api(path, body) {
  const r = await fetch(path, body === undefined ? { cache: 'no-store' } : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `Something went wrong (${r.status})`);
  return data;
}

async function loadHostInfo() {
  try {
    hostInfo = await api('/api/host/info');
    $('herLink').textContent = hostInfo.links.her || 'Tailscale is off — start Tailscale on this laptop';
    $('copyLink').disabled = !hostInfo.links.her;
    if (!hostInfo.ffmpegFound) toast('FFmpeg is missing — run setup.bat once so movies can be prepared.', 8000);
  } catch (e) { toast(e.message); }
}

$('copyLink').onclick = async () => {
  if (!hostInfo || !hostInfo.links.her) return;
  try { await navigator.clipboard.writeText(hostInfo.links.her); toast('Copied! Send it to her on WhatsApp.'); }
  catch { prompt('Copy her link:', hostInfo.links.her); }
};

$('updateBtn').onclick = async () => {
  const btn = $('updateBtn');
  btn.disabled = true;
  btn.textContent = 'Checking…';
  try {
    const info = await api('/api/host/update');
    if (!info.newer) { toast(`You're up to date (version ${info.current}).`); return; }
    if (!confirm(`Update Movie Night from ${info.current} to ${info.latest}? It restarts in a few seconds.`)) return;
    btn.textContent = 'Updating…';
    await api('/api/host/update', {});
    toast('Updated! Restarting…');
  } catch (e) { toast(`Couldn't update: ${e.message}`, 7000); }
  finally { btn.disabled = false; btn.textContent = 'Check for updates'; }
};

async function deleteMovie(mv) {
  if (!confirm(`Delete "${mv.title}" from Movie Night? Your original movie file is not touched.`)) return;
  try { await api('/api/host/delete', { id: mv.id }); toast('Deleted.'); } catch (e) { toast(e.message); }
}

// Conversion progress
function renderJobs(jobs) {
  const box = $('jobs');
  box.innerHTML = '';
  for (const j of jobs) {
    const el = document.createElement('div');
    el.className = `job ${j.status}`;
    const p = j.progress;
    let detail = '', pct = 0;
    if (j.status === 'queued') detail = 'Waiting for the movie before it to finish';
    else if (j.status === 'running') {
      if (p && p.steps) {
        pct = ((p.step - 1) + p.pct / 100) / p.steps * 100;
        detail = `Making ${p.label} (${p.step} of ${p.steps}) · ${p.pct}%` + (p.eta ? ` · this part ~${fmt(p.eta)} left` : '');
      } else detail = 'Starting…';
    } else if (j.status === 'done') { detail = 'Ready to watch ✓'; pct = 100; }
    else if (j.status === 'cancelled') detail = 'Stopped';
    else if (j.status === 'failed') detail = 'Something went wrong';
    el.innerHTML = `<div class="job-top"><b></b><span class="muted small"></span><button class="ghost small"></button></div>
      ${j.status === 'running' || j.status === 'done' ? `<div class="meter"><i style="width:${pct.toFixed(1)}%"></i></div>` : ''}
      ${j.error ? '<pre></pre>' : ''}`;
    el.querySelector('b').textContent = j.title;
    el.querySelector('.muted').textContent = detail;
    const btn = el.querySelector('button');
    if (j.status === 'running' || j.status === 'queued') {
      btn.textContent = 'Stop';
      btn.onclick = () => { if (confirm(`Stop preparing "${j.title}"?`)) api('/api/host/cancel', { id: j.id }).catch((e) => toast(e.message)); };
    } else {
      btn.textContent = 'Dismiss';
      btn.onclick = () => api('/api/host/clear', {}).catch(() => {});
    }
    if (j.error) el.querySelector('pre').textContent = j.error;
    box.appendChild(el);
  }
}

// File picker
$('addMovieBtn').onclick = () => openPicker();
$('pickerClose').onclick = closePicker;
$('picker').addEventListener('click', (e) => { if (e.target === $('picker')) closePicker(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('picker').classList.contains('hidden')) closePicker(); });
$('upBtn').onclick = () => { if (currentDir && currentDir.parent) browseTo(currentDir.parent); else browseTo(null); };
$('backToBrowse').onclick = () => { $('confirmView').classList.add('hidden'); $('browseView').classList.remove('hidden'); };

function openPicker() {
  $('picker').classList.remove('hidden');
  $('confirmView').classList.add('hidden');
  $('browseView').classList.remove('hidden');
  browseTo(store.get('mn_lastDir') || null);
}
function closePicker() { $('picker').classList.add('hidden'); }

async function browseTo(dir) {
  let data;
  try { data = await api(`/api/host/browse${dir ? `?dir=${encodeURIComponent(dir)}` : ''}`); }
  catch (e) { toast(e.message); return; }
  if (data.error && dir) { toast(data.error); if (dir !== null) return browseTo(null); }
  currentDir = data;
  if (data.dir) store.set('mn_lastDir', data.dir);
  const places = $('places');
  places.innerHTML = '';
  for (const p of data.places || []) {
    const b = document.createElement('button');
    b.textContent = p.label;
    b.onclick = () => browseTo(p.path);
    places.appendChild(b);
  }
  $('crumb').textContent = data.dir || 'Choose a place to look for your movie';
  $('upBtn').disabled = !data.dir;
  const list = $('entries');
  list.innerHTML = '';
  if (!data.dir) {
    list.innerHTML = '<p class="muted small" style="padding:8px 10px">Your movies are usually in <b>Downloads</b> or <b>Videos</b>.</p>';
    return;
  }
  if (!data.entries.length) {
    list.innerHTML = '<p class="muted small" style="padding:8px 10px">No folders or movie files here.</p>';
  }
  for (const e of data.entries) {
    const b = document.createElement('button');
    b.className = `entry ${e.type}`;
    b.innerHTML = `<span>${e.type === 'dir' ? '📁' : '🎬'}</span><span class="name"></span><span class="muted small"></span>`;
    b.querySelector('.name').textContent = e.name;
    if (e.type === 'file') b.querySelector('.muted').textContent = fmtSize(e.size);
    b.onclick = () => (e.type === 'dir' ? browseTo(e.path) : pickFile(e));
    list.appendChild(b);
  }
  list.scrollTop = 0;
}

function pickFile(e) {
  pickedFile = e;
  $('browseView').classList.add('hidden');
  $('confirmView').classList.remove('hidden');
  $('confirmFile').textContent = `${e.name} · ${fmtSize(e.size)}`;
  $('titleInput').value = e.title;
  $('optDenoise').checked = false;
  const confirmed = hostInfo && hostInfo.hevcConfirmed;
  $('optSkipAvc').checked = !!confirmed;
  $('skipHint').textContent = confirmed
    ? 'Her tablet already played an HEVC movie smoothly, so the H.264 backups aren\'t needed.'
    : 'Leave this off until her tablet has played a movie in HEVC. The app will remember once it has.';
  $('titleInput').focus();
}

$('startPrep').onclick = async () => {
  if (!pickedFile) return;
  try {
    await api('/api/host/prepare', {
      file: pickedFile.path, title: $('titleInput').value.trim(),
      denoise: $('optDenoise').checked, skipAvc: $('optSkipAvc').checked,
    });
    closePicker();
    toast('Preparing in the background. You can keep using your laptop.');
  } catch (e) { toast(e.message); }
};

function fmtSize(bytes) {
  if (!bytes) return '';
  return bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.round(bytes / 1e6)} MB`;
}

let toastTimer = null;
function toast(text, ms = 4000) {
  const t = $('toast');
  t.textContent = text;
  t.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), ms);
}

// ---- Personal touches -----------------------------------------------------------
let personalInfo = { him: '', her: '', dog: '', since: '', nights: 0, photos: [] };

const CAPTIONS = { cinema: 'Popcorn date', space: 'Lost in space', horror: 'Scary movie night', heroes: 'Superhero duo', romance: 'Under the stars', pirates: 'Pirates of the sofa' };
const TILTS = [-3, 2, -1.5, 3, -2.5, 1.5, -1, 2.5];

function polaroid(inner, caption, i) {
  const tilt = TILTS[i % TILTS.length];
  return `<figure class="polaroid" style="--tilt:${tilt}deg;--delay:${-(i * 1.3)}s">
    <span class="pin">${Art.bowSvg()}</span><div class="pic">${inner}</div><figcaption>${escapeHtml(caption)}</figcaption></figure>`;
}

function collageItems() {
  if (!Art.SCENES.length && !personalInfo.photos.length) return [];
  const items = Art.SCENES.map((n) => ({ html: Art.scene(n), cap: CAPTIONS[n] || '' }));
  // Mix in your real photos (from the private personal\photos folder on the laptop).
  const photos = personalInfo.photos.map((src) => ({ html: `<img src="${src}" alt="" loading="lazy">`, cap: '♡' }));
  const out = [];
  const n = Math.max(items.length, photos.length);
  for (let i = 0; i < n; i++) {
    if (items[i]) out.push(items[i]);
    if (photos[i]) out.push(photos[i]);
  }
  return out;
}

function drawArt() {
  for (const el of document.querySelectorAll('.title-bow')) el.innerHTML = Art.bowSvg();
  $('joinArt').innerHTML = Art.couple();
  $('emptyArt').innerHTML = Art.couple('laugh');
  $('holdArt').innerHTML = Art.fetchingPup();
  const items = collageItems();
  // Join screen: a wall of polaroids.
  const wall = [];
  for (let i = 0; i < (items.length ? 18 : 0); i++) wall.push(polaroid(items[i % items.length].html, items[i % items.length].cap, i));
  $('joinCollage').innerHTML = wall.join('');
  // Library: a slowly drifting strip (doubled so it loops seamlessly).
  const strip = items.map((it, i) => polaroid(it.html, it.cap, i)).join('');
  $('strip').innerHTML = strip + strip;
}

async function loadPersonal() {
  try {
    const r = await fetch('/api/personal', { cache: 'no-store' });
    if (r.ok) personalInfo = await r.json();
  } catch { /* offline */ }
  const names = personalInfo.him && personalInfo.her ? `${personalInfo.him} & ${personalInfo.her}'s Movie Night` : 'Movie Night';
  for (const el of document.querySelectorAll('.couple-title')) el.textContent = names;
  document.title = names;
  const bits = [];
  if (personalInfo.since) {
    const days = Math.floor((Date.now() - new Date(`${personalInfo.since}T00:00:00`)) / 86400000);
    if (days >= 0) bits.push(`Together <b>${days.toLocaleString()} days</b>`);
  }
  if (personalInfo.nights) bits.push(`Movie night <b>#${personalInfo.nights}</b>`);
  if (personalInfo.dog) bits.push(`<b>${escapeHtml(personalInfo.dog)}</b> approved 🐾`);
  $('tidbits').innerHTML = bits.join(' · ');
  $('tidbits').classList.toggle('hidden', !bits.length);
  drawArt();
}

function renderIntermission() {
  const show = !!(state && meta && state.paused && !state.wantPlay && !state.hold && video.currentTime > 5);
  $('intermission').classList.toggle('hidden', !show);
}

// Personalize dialog (laptop only)
$('personalBtn').onclick = () => {
  $('pHim').value = personalInfo.him || store.get('mn_name') || '';
  $('pHer').value = personalInfo.her || '';
  $('pDog').value = personalInfo.dog || '';
  $('pSince').value = personalInfo.since || '';
  $('settings').classList.remove('hidden');
  $('pHer').focus();
};
$('settingsClose').onclick = () => $('settings').classList.add('hidden');
$('settings').addEventListener('click', (e) => { if (e.target === $('settings')) $('settings').classList.add('hidden'); });
$('savePersonal').onclick = async () => {
  try {
    await api('/api/host/personal', { him: $('pHim').value, her: $('pHer').value, dog: $('pDog').value, since: $('pSince').value });
    $('settings').classList.add('hidden');
    toast('Saved 🎀');
  } catch (e) { toast(e.message); }
};
$('openPhotos').onclick = async () => {
  try { await api('/api/host/open-photos', {}); toast('Drop photos in that folder, then refresh this page.', 6000); } catch (e) { toast(e.message); }
};

drawArt();

/** Whose little face to show next to a name. */
function avatarFor(p) {
  const n = String(p.name || '').trim().toLowerCase();
  if (personalInfo.her && n === personalInfo.her.toLowerCase()) return 'her';
  if (personalInfo.him && n === personalInfo.him.toLowerCase()) return 'him';
  return p.role === 'host' ? 'him' : 'her';
}
