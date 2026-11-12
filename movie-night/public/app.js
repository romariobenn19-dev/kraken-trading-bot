/* Movie Night - web player (runs on both the host laptop and the partner's tablet). */
'use strict';

const $ = (id) => document.getElementById(id);
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
    else poster.textContent = '🎞️';
    b.querySelector('b').textContent = mv.title;
    b.querySelector('span').textContent = `${fmt(mv.duration)} · up to ${best}${mv.subtitles ? ' · CC' : ''}`;
    b.onclick = () => send({ t: 'load', movieId: mv.id });
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
    stalled, quality: lv ? labelFor(lv).split(' · ')[0] : '', bw: hls ? Math.round(hls.bandwidthEstimate || 0) : 0,
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

for (const b of document.querySelectorAll('.react')) {
  b.onclick = (e) => { e.stopPropagation(); send({ t: 'react', emoji: b.dataset.e }); };
}
function floatEmoji(emoji, from) {
  const el = document.createElement('div');
  el.className = 'floater';
  el.style.left = `${10 + Math.random() * 80}%`;
  el.textContent = emoji;
  const s = document.createElement('small');
  s.textContent = from;
  el.appendChild(s);
  $('floaters').appendChild(el);
  setTimeout(() => el.remove(), 2700);
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
    return `<span class="peer"><span class="dot ${meta && p.ready ? health : ''}"></span>${parts.join(' · ')}</span>`;
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
  $('holdText').textContent = state.hold.reason === 'buffering'
    ? `${who || 'Someone'}'s connection dipped, so we've paused together and are building a bigger buffer (${need}s) so it doesn't happen again.`
    : who ? `Loading… waiting for ${who}` : 'Loading…';
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
