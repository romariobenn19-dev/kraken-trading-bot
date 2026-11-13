/* Movie Night - web player (runs on both the host laptop and the partner's tablet). */
'use strict';

/**
 * Fetches each video chunk as several byte ranges in parallel.
 * Over long distances (e.g. Barbados -> Greece) a single connection rarely reaches the
 * line's real speed; 4 parallel ones get much closer. Falls back to one request if the
 * server doesn't do ranges. Plugs into hls.js as its fragment loader.
 */
class ParallelFragmentLoader {
  constructor() {
    this.controllers = [];
    this.stats = {
      aborted: false, loaded: 0, retry: 0, total: 0, chunkCount: 0, bwEstimate: 0,
      loading: { start: 0, first: 0, end: 0 }, parsing: { start: 0, end: 0 }, buffering: { start: 0, first: 0, end: 0 },
    };
  }

  destroy() { this.abortAll(); }

  abortAll() { for (const c of this.controllers) c.abort(); this.controllers = []; clearTimeout(this.timer); }

  abort() {
    this.stats.aborted = true;
    this.abortAll();
    if (this.callbacks && this.callbacks.onAbort) this.callbacks.onAbort(this.stats, this.context, null);
  }

  load(context, config, callbacks) {
    this.context = context;
    this.callbacks = callbacks;
    const stats = this.stats;
    stats.loading.start = performance.now();
    const timeout = (config && (config.loadPolicy ? config.loadPolicy.maxLoadTimeMs : config.timeout)) || 90000;
    this.timer = setTimeout(() => { this.abortAll(); callbacks.onTimeout(stats, context, null); }, timeout);
    this.run(context, callbacks).catch((err) => {
      if (stats.aborted) return;
      clearTimeout(this.timer);
      callbacks.onError({ code: err.status || 0, text: err.message || 'load failed' }, context, null, stats);
    });
  }

  /** One ranged request; streams into `into` at `offset`, counting progress for the ABR. */
  async part(url, start, end, onHeaders, into) {
    const ctrl = new AbortController();
    this.controllers.push(ctrl);
    const r = await fetch(url, { headers: { Range: `bytes=${start}-${end}` }, signal: ctrl.signal, credentials: 'same-origin' });
    if (!r.ok) { const e = new Error(`HTTP ${r.status}`); e.status = r.status; throw e; }
    const info = onHeaders(r);
    const target = into || info.buffer;
    let pos = info.offset;
    const reader = r.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!this.stats.loading.first) this.stats.loading.first = performance.now();
      if (target && pos + value.length <= target.length) target.set(value, pos);
      else info.overflow.push(value);
      pos += value.length;
      this.stats.loaded += value.length;
    }
    return { r, pos };
  }

  async run(context, callbacks) {
    const url = context.url;
    const FIRST = 384 * 1024;
    const PARALLEL = 4;
    let total = 0;
    let buffer = null;
    const overflow = [];
    // First request: the start of the file, which also tells us the full size.
    const first = this.part(url, 0, FIRST - 1, (r) => {
      const cr = r.headers.get('Content-Range');
      total = cr ? Number(cr.split('/')[1]) : Number(r.headers.get('Content-Length')) || 0;
      if (r.status === 200 || !total) total = 0; // no range support: whole file in one go
      buffer = total ? new Uint8Array(total) : null;
      this.stats.total = total;
      return { buffer, offset: 0, overflow };
    });
    // Wait just for the headers of the first request before starting the others.
    const firstDone = first;
    await new Promise((resolve) => {
      const check = () => (buffer || total === 0 && this.stats.loading.first ? resolve() : setTimeout(check, 5));
      check();
      firstDone.then(resolve, resolve);
    });
    const parts = [firstDone];
    if (buffer && total > FIRST) {
      const rest = total - FIRST;
      const size = Math.ceil(rest / (PARALLEL - 1));
      for (let start = FIRST; start < total; start += size) {
        const end = Math.min(total - 1, start + size - 1);
        parts.push(this.part(url, start, end, () => ({ buffer, offset: start, overflow: [] }), buffer));
      }
    }
    const results = await Promise.all(parts);
    clearTimeout(this.timer);
    let data;
    if (buffer) data = buffer.buffer;
    else {
      // Server sent the whole file in one response.
      const len = overflow.reduce((n, c) => n + c.length, 0);
      const all = new Uint8Array(len);
      let o = 0;
      for (const c of overflow) { all.set(c, o); o += c.length; }
      data = all.buffer;
      this.stats.total = len;
    }
    const stats = this.stats;
    stats.loading.end = performance.now();
    if (!stats.loading.first) stats.loading.first = stats.loading.end;
    stats.total = stats.total || stats.loaded;
    callbacks.onSuccess({ url: results[0].r.url || url, data }, stats, context, null);
  }

  getCacheAge() { return null; }
  getResponseHeader() { return null; }
}

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
// A random id per device, so the laptop knows which devices can play HEVC.
let deviceId = store.get('mn_device');
if (!deviceId) { deviceId = Math.random().toString(36).slice(2, 14).padEnd(12, '0'); store.set('mn_device', deviceId); }
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
let playerError = null;     // e.g. 'needs-hevc' when this browser can't play the movie
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
    hevcSupport.then((hevc) => send({ t: 'hello', name: store.get('mn_name'), role, deviceId, hevc }));
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
    else if (m.t === 'replaced') onReplaced();
    else if (m.t === 'jobs') renderJobs(m.jobs);
    else if (m.t === 'library') refreshMovies().then(syncOpenMovieSubs);
    else if (m.t === 'personal') loadPersonal();
    else if (m.t === 'restarting') { toast('Updating Movie Night… back in a few seconds'); appVersion = 'restarting'; }
  };
  ws.onclose = (ev) => {
    if (replaced || ev.code === 4001) return; // opened somewhere else: don't fight over it
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
    b.querySelector('span').textContent = `${fmt(mv.duration)} · up to ${best}${mv.subtitles ? ' · CC' : ''}${mv.partial ? ' · finishing backups…' : ''}`;
    b.onclick = () => send({ t: 'load', movieId: mv.id });
    if (isHost) {
      const del = document.createElement('span');
      del.className = 'del';
      del.setAttribute('role', 'button');
      del.title = 'Delete this movie from the laptop';
      del.textContent = '🗑';
      del.onclick = (e) => { e.stopPropagation(); deleteMovie(mv); };
      b.appendChild(del);
      const cc = document.createElement('span');
      cc.className = 'subs-btn';
      cc.setAttribute('role', 'button');
      cc.title = 'Subtitles for this movie';
      cc.textContent = subsOf(mv).length ? `CC ${subsOf(mv).length}` : 'CC+';
      cc.onclick = (e) => { e.stopPropagation(); openSubsDialog(mv); };
      b.appendChild(cc);
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
  buildSubtitleTracks(mv);

  const base = `/library/${encodeURIComponent(mv.id)}/`;
  setPlayerError(null);
  mediaErrors = 0;
  const useHevc = mv.hevc && await hevcSupport;
  if (!useHevc && !mv.avc) { setPlayerError('needs-hevc'); showChrome(); return; }
  if (id !== openId) return;
  const src = base + (useHevc ? mv.hevc : mv.avc || mv.hevc);
  const startPosition = state ? expectedPos() : 0;

  $('quality').classList.add('hidden');
  updateTime();
  if (window.Hls && Hls.isSupported()) {
    hls = new Hls({
      // Deep buffer: keep up to ~2 minutes ahead so short Wi-Fi dips never show.
      maxBufferLength: 120,
      maxMaxBufferLength: 300,
      maxBufferSize: 120 * 1000 * 1000,
      backBufferLength: 20,
      startPosition,
      // Don't start downloading until we've picked the starting quality (see setupQuality).
      autoStartLoad: false,
      capLevelToPlayerSize: false,
      // Be a bit conservative so quality doesn't flip-flop on a shaky connection.
      // Start from this device's last measured speed (or assume a decent connection).
      abrEwmaDefaultEstimate: savedBandwidth() || 8_000_000,
      abrBandWidthFactor: 0.8,
      abrBandWidthUpFactor: 0.7,
      // Forget a bad patch quickly so the picture climbs back up once Wi-Fi recovers.
      abrEwmaFastVoD: 3,
      abrEwmaSlowVoD: 8,
      // Long-distance links: fetch each chunk over several connections at once.
      fLoader: ParallelFragmentLoader,
      fragLoadPolicy: {
        default: {
          maxTimeToFirstByteMs: 15000,
          maxLoadTimeMs: 90000,
          timeoutRetry: { maxNumRetry: 6, retryDelayMs: 500, maxRetryDelayMs: 4000 },
          errorRetry: { maxNumRetry: 10, retryDelayMs: 1000, maxRetryDelayMs: 8000 },
        },
      },
    });
    hls.on(Hls.Events.MANIFEST_PARSED, () => {
      // Safety net: whatever happens while choosing quality, start loading.
      setupQuality().catch(() => {}).finally(() => beginLoading(hls ? hls.levels.length - 1 : 0, null));
    });
    hls.on(Hls.Events.LEVEL_SWITCHED, () => updateQualityLabel());
    hls.on(Hls.Events.ERROR, (_e, data) => {
      if (!data.fatal) return;
      if (data.details === Hls.ErrorDetails.MANIFEST_INCOMPATIBLE_CODECS_ERROR) { setPlayerError('needs-hevc'); return; }
      if (data.type === Hls.ErrorTypes.NETWORK_ERROR) setTimeout(() => hls && hls.startLoad(), 2000);
      else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
        mediaErrors++;
        if (mediaErrors > 3) setPlayerError('playback'); else hls.recoverMediaError();
      } else setPlayerError('playback');
    });
    pendingStart = startPosition;
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
        // Only 'supported' is reliable; many phones wrongly report smooth=false.
        ok = r.supported;
      } catch { /* assume ok */ }
    }
    if (ok || i === 0) maxOk = i;
  }
  if (!hls) return;
  hls.autoLevelCapping = maxOk;
  $('quality').classList.toggle('hidden', maxOk < 1);
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
  beginLoading(maxOk, savedLevel);
}

/**
 * Start with the sharpest version this device can show, unless this device's
 * connection was measured too slow for it last time; then the best that fits.
 */
let pendingStart = null;
function beginLoading(maxOk, savedLevel) {
  if (!hls || pendingStart === null) return;
  let start = maxOk;
  const bw = savedBandwidth();
  if (bw) {
    // Shaky connection lately? Start more carefully.
    const factor = isShaky() ? 0.5 : 0.75;
    while (start > 0 && (hls.levels[start].averageBitrate || hls.levels[start].bitrate) > bw * factor) start--;
  }
  hls.startLevel = savedLevel ? savedLevel.index : start;
  hls.startLoad(pendingStart);
  pendingStart = null;
}

/** Remember this device's real download speed for next time. */
function savedBandwidth() {
  const v = Number(store.get('mn_bw'));
  return Number.isFinite(v) && v > 100000 ? v : 0;
}
let bwSavedAt = 0;
function rememberBandwidth() {
  if (!hls || !hls.bandwidthEstimate || Date.now() - bwSavedAt < 15000) return;
  // Only trust the estimate once real chunks have been downloaded.
  if (!hls.levels.length || hls.currentLevel < 0) return;
  bwSavedAt = Date.now();
  store.set('mn_bw', String(Math.round(hls.bandwidthEstimate)));
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
  const playing = hls.currentLevel;
  if (playing < 0 || bufferAhead() < 30 || Date.now() - lastUpgrade < 30000) return;
  if (Date.now() - lastStallAt < 120000) return; // just had a pause: stay steady for a bit
  // Best version the connection sustains even at its slowest moment of the last 30 s
  // (1.5x headroom so the buffer refills while we re-download).
  const bw = safeBandwidth();
  const top = hls.autoLevelCapping >= 0 ? hls.autoLevelCapping : hls.levels.length - 1;
  let target = -1;
  for (let i = top; i > playing; i--) {
    if (levelRate(i) * 1.5 <= bw) { target = i; break; }
  }
  if (target < 0) return;
  const KEEP = 20; // seconds of what's already loaded to keep as a safety cushion
  const sc = hls.streamController;
  if (sc && typeof sc.flushMainBuffer === 'function' && typeof sc.getBufferedFrag === 'function') {
    // Only worth it if what's queued up after the cushion is lower quality than we can now get.
    const queued = sc.getBufferedFrag(video.currentTime + KEEP + 2);
    if (!queued || queued.level >= target) return;
    lastUpgrade = Date.now();
    if (typeof sc.abortCurrentFrag === 'function') sc.abortCurrentFrag();
    sc.flushMainBuffer(video.currentTime + KEEP, Number.POSITIVE_INFINITY); // hls.js re-downloads it, sharper
    return;
  }
  // Fallback: switch from the next chunk on (re-downloads everything after it).
  lastUpgrade = Date.now();
  upgradeGraceUntil = Date.now() + 12000;
  hls.nextLevel = target;
  hls.once(Hls.Events.LEVEL_SWITCHED, () => { if (hls) hls.loadLevel = -1; }); // back to automatic
}
const levelRate = (i) => hls.levels[i].averageBitrate || hls.levels[i].bitrate;

function reportStatus() {
  const visible = document.visibilityState !== 'hidden';
  if (!meta) { send({ t: 'status', movieId: null, visible }); return; }
  maybeUpgradeBuffered();
  rememberBandwidth();
  tuneAbrForBuffer();
  // During a quality upgrade the buffer is briefly short on purpose; real stalls still report via 'waiting'.
  const ahead = Date.now() < upgradeGraceUntil ? Math.max(bufferAhead(), 5) : bufferAhead();
  const dur = video.duration || meta.duration || 0;
  const lv = hls && hls.levels[hls.currentLevel];
  send({
    t: 'status', movieId: meta.id, ct: video.currentTime, buffer: ahead, visible, error: playerError,
    full: dur > 0 && video.currentTime + ahead >= dur - 1,
    stalled, quality: qualityText(lv), shaky: isShaky(),
    codec: lv && lv.videoCodec ? (/^(hvc1|hev1)/.test(lv.videoCodec) ? 'hevc' : 'avc') : '', bw: hls ? Math.round(hls.bandwidthEstimate || 0) : 0,
  });
}
setInterval(reportStatus, 1000);
video.addEventListener('waiting', () => {
  if (state && !state.paused) {
    if (!stalled) noteStall();
    stalled = true;
    reportStatus();
  }
});
video.addEventListener('playing', () => { stalled = false; });
video.addEventListener('timeupdate', updateTime);
video.addEventListener('loadedmetadata', updateTime);
video.addEventListener('progress', paintSeek);
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
  paintSeek();
}
/** Seek bar shows what's played and how much is already loaded. */
function paintSeek() {
  const d = duration();
  const played = d ? (Number($('seek').value) / 10) : 0;
  const loaded = d ? Math.min(100, ((video.currentTime + bufferAhead()) / d) * 100) : 0;
  $('seek').style.setProperty('--played', `${played}%`);
  $('seek').style.setProperty('--loaded', `${Math.max(played, loaded)}%`);
}
function updatePlayButton() {
  const playing = !!(state && state.wantPlay);
  $('playBtn').innerHTML = playing ? ICONS.pause : ICONS.play;
  $('playBtn').setAttribute('aria-label', playing ? 'Pause' : 'Play');
}

$('subsBtn').onclick = (e) => { e.stopPropagation(); toggleSubsMenu(); };

document.addEventListener('fullscreenchange', () => {
  $('fsBtn').innerHTML = document.fullscreenElement ? ICONS.exitFs : ICONS.fs;
});
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
      if (!p.quality && !p.full) parts.push('loading…');
      else {
        parts.push(p.full ? 'fully loaded' : `${Math.floor(p.buffer)}s ahead`);
        if (p.bw) parts.push(`${(p.bw / 1e6).toFixed(1)} Mbps`);
      }
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
  const needFor = (p) => (state.hold.reason === 'starting' && p.shaky ? Math.max(need, 45) : need);
  const who = (state.hold.who || []).join(' & ');
  const pup = personalInfo.dog || 'The pup';
  $('holdText').textContent = state.hold.reason === 'buffering'
    ? `${who || 'Someone'}'s Wi-Fi had a hiccup, so we've paused together. ${pup} is fetching a bigger buffer (${need}s) so it doesn't happen again.`
    : `${pup} is fetching the movie…${who ? ` (waiting for ${who})` : ''}`;
  $('holdBars').innerHTML = peers.map((p) => {
    let note = '';
    if (!p.ready) note = 'browsing the movie list';
    else if (p.error === 'needs-hevc') note = 'this browser can\'t play the movie';
    else if (p.error) note = 'playback problem';
    else if (!p.visible) note = 'app not on screen';
    else if (p.late) note = 'still loading, will catch up';
    const pct = p.full ? 100 : Math.min(100, (p.buffer / needFor(p)) * 100);
    return `<div class="hold-peer"><span class="avatar">${Art.head(avatarFor(p))}</span><div class="hold-peer-main">
      <div class="hold-peer-top"><b>${escapeHtml(p.name)}</b><span class="muted">${note ? escapeHtml(note) : p.quality || ''}</span></div>
      ${note ? '' : `<div class="meter"><i style="width:${pct.toFixed(0)}%"></i></div>`}</div></div>`;
  }).join('');
  const waitingOnOthers = (state.hold.who || []).some((n) => n !== store.get('mn_name'));
  $('forceStart').classList.toggle('hidden', !waitingOnOthers);
  $('forceStart').textContent = state.hold.reason === 'starting' ? 'Start without waiting' : 'Carry on without waiting';
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
    renderHttpsNote();
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
        detail = (j.ready ? 'Ready to watch ✓ · making backups: ' : 'Making the version you\'ll watch: ') +
          `${p.label} (${p.step} of ${p.steps}) · ${p.pct}%` + (p.eta ? ` · this part ~${fmt(p.eta)} left` : '');
      } else detail = 'Starting…';
    } else if (j.status === 'done') { detail = 'Ready to watch ✓'; pct = 100; }
    else if (j.status === 'cancelled') detail = 'Stopped';
    else if (j.status === 'failed') detail = 'Something went wrong';
    el.innerHTML = `<div class="job-top"><b></b><span class="muted small"></span><button class="ghost small"></button></div>
      ${j.status === 'running' || j.status === 'done' ? `<div class="meter"><i style="width:${pct.toFixed(1)}%"></i></div>` : ''}
      ${j.error ? '<pre></pre>' : ''}`;
    if (j.source && j.source.width && (j.status === 'running' || j.status === 'done')) {
      const srcP = Math.min(j.source.height, Math.round(j.source.width * 9 / 16));
      detail += ` · original file: ${j.source.width}×${j.source.height}` + (srcP < 700 ? ' (that\'s as sharp as this file goes)' : '');
    }
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
$('addMovieBtn').onclick = () => openPicker('movie');
$('pickerClose').onclick = closePicker;
$('picker').addEventListener('click', (e) => { if (e.target === $('picker')) closePicker(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('picker').classList.contains('hidden')) closePicker(); });
$('upBtn').onclick = () => { if (currentDir && currentDir.parent) browseTo(currentDir.parent); else browseTo(null); };
$('backToBrowse').onclick = () => { $('confirmView').classList.add('hidden'); $('browseView').classList.remove('hidden'); };

let pickerMode = { kind: 'movie' };
function openPicker(kind = 'movie', onPick = null) {
  pickerMode = { kind, onPick };
  $('picker').querySelector('.sheet-head b').textContent = kind === 'subs' ? 'Choose a subtitle file' : 'Add a movie';
  $('picker').classList.remove('hidden');
  $('confirmView').classList.add('hidden');
  $('browseView').classList.remove('hidden');
  browseTo(store.get('mn_lastDir') || null);
}
function closePicker() { $('picker').classList.add('hidden'); }

async function browseTo(dir) {
  let data;
  try { data = await api(`/api/host/browse?kind=${pickerMode.kind}${dir ? `&dir=${encodeURIComponent(dir)}` : ''}`); }
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
  if (pickerMode.kind === 'subs') { closePicker(); if (pickerMode.onPick) pickerMode.onPick(e); return; }
  pickedFile = e;
  loadSubChoices({ file: e.path });
  $('browseView').classList.add('hidden');
  $('confirmView').classList.remove('hidden');
  $('confirmFile').textContent = `${e.name} · ${fmtSize(e.size)}`;
  $('titleInput').value = e.title;
  $('optDenoise').checked = false;
  $('optQuick').checked = true;
  const confirmed = hostInfo && hostInfo.hevcConfirmed;
  $('optSkipAvc').checked = !!confirmed;
  const cannot = (hostInfo && hostInfo.cannotPlayHevc) || [];
  $('skipHint').textContent = confirmed
    ? 'Every device you two use can play HEVC, so the H.264 backups aren\'t needed.'
    : cannot.length
      ? `Keep the backups: ${cannot.join(', ')} can't play HEVC. (On the laptop, Chrome can.)`
      : 'Keep the backups until her tablet has opened Movie Night. The app checks each device and ticks this for you.';
  $('titleInput').focus();
}

$('startPrep').onclick = async () => {
  if (!pickedFile) return;
  try {
    await api('/api/host/prepare', {
      file: pickedFile.path, title: $('titleInput').value.trim(),
      denoise: $('optDenoise').checked, skipAvc: $('optSkipAvc').checked, quick: $('optQuick').checked,
      subtitles: $('subsChoices')._items ? chosenSubs($('subsChoices')) : null,
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
  $('errorArt').innerHTML = Art.reaction('shock');
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
  $('tidbits').innerHTML = bits.map((b) => `<span>${b}</span>`).join(' · ');
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

// ---- Playback problems on this device ------------------------------------------
let mediaErrors = 0;
const hevcSupport = canPlayHevc();

function setPlayerError(kind) {
  playerError = kind;
  const box = $('playError');
  if (!kind) { box.classList.add('hidden'); return; }
  const chrome = /Edg\//.test(navigator.userAgent) ? 'Microsoft Edge can\'t play this movie\'s format (HEVC) unless the "HEVC Video Extensions" app is installed. '
    : 'This browser can\'t play this movie\'s format (HEVC). ';
  $('playErrorText').textContent = kind === 'needs-hevc'
    ? `${chrome}Open Movie Night in Google Chrome instead, or re-add the movie with "Skip H.264 backups" unticked.`
    : 'Something went wrong playing this movie on this device. Try going back to Movies and opening it again.';
  box.classList.remove('hidden');
  reportStatus();
}

$('forceStart').onclick = () => send({ t: 'force' });
document.addEventListener('visibilitychange', () => reportStatus());

// ---- Icons --------------------------------------------------------------------
const svgIcon = (d, extra = '') => `<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ${extra}>${d}</svg>`;
const ICONS = {
  play: svgIcon('<path d="M7 4.5v15l12-7.5z" fill="currentColor" stroke="none"/>'),
  pause: svgIcon('<rect x="6" y="4.5" width="4" height="15" rx="1.2" fill="currentColor" stroke="none"/><rect x="14" y="4.5" width="4" height="15" rx="1.2" fill="currentColor" stroke="none"/>'),
  back10: svgIcon('<path d="M4 12a8 8 0 1 0 2.4-5.7"/><path d="M4 4v4.5h4.5"/><text x="12" y="15.6" font-size="7.5" text-anchor="middle" fill="currentColor" stroke="none" font-family="system-ui,sans-serif" font-weight="700">10</text>'),
  fwd10: svgIcon('<path d="M20 12a8 8 0 1 1-2.4-5.7"/><path d="M20 4v4.5h-4.5"/><text x="12" y="15.6" font-size="7.5" text-anchor="middle" fill="currentColor" stroke="none" font-family="system-ui,sans-serif" font-weight="700">10</text>'),
  fs: svgIcon('<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>'),
  exitFs: svgIcon('<path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/>'),
  cc: svgIcon('<rect x="3" y="5.5" width="18" height="13" rx="3"/><path d="M10.5 10.2a2.5 2.5 0 1 0 0 3.6M17 10.2a2.5 2.5 0 1 0 0 3.6"/>'),
  back: svgIcon('<path d="M15 5l-7 7 7 7"/>'),
};
$('back10').innerHTML = ICONS.back10; $('back10').setAttribute('aria-label', 'Back 10 seconds');
$('fwd10').innerHTML = ICONS.fwd10; $('fwd10').setAttribute('aria-label', 'Forward 10 seconds');
$('fsBtn').innerHTML = ICONS.fs; $('fsBtn').setAttribute('aria-label', 'Full screen');
$('subsBtn').innerHTML = ICONS.cc; $('subsBtn').setAttribute('aria-label', 'Subtitles');
$('backBtn').innerHTML = `${ICONS.back}<span>Movies</span>`;
updatePlayButton();

// ---- Only one of each of us at a time ------------------------------------------
let replaced = false;
function onReplaced() {
  replaced = true;
  try { video.pause(); } catch { /* ignore */ }
  if (hls) { hls.destroy(); hls = null; }
  releaseWakeLock();
  $('replacedArt').innerHTML = Art.reaction('shock');
  $('replaced').classList.remove('hidden');
}
$('useHere').onclick = () => location.reload();

// ---- Install as an app ------------------------------------------------------------
let installPrompt = null;
if ('serviceWorker' in navigator && window.isSecureContext) {
  navigator.serviceWorker.register('/sw.js').catch(() => { /* not critical */ });
}
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installPrompt = e;
  $('installBtn').classList.remove('hidden');
});
$('installBtn').onclick = async () => {
  if (!installPrompt) return;
  installPrompt.prompt();
  const choice = await installPrompt.userChoice.catch(() => null);
  if (choice && choice.outcome === 'accepted') $('installBtn').classList.add('hidden');
  installPrompt = null;
};
window.addEventListener('appinstalled', () => {
  $('installBtn').classList.add('hidden');
  toast('Installed! Movie Night now has its own icon 🎀');
});

/** On the laptop: help switch her link to https:// so she can install the app too. */
function renderHttpsNote() {
  const el = $('httpsNote');
  const h = hostInfo && hostInfo.https;
  if (!h || h.status === 'ok' || h.status === 'checking' || !hostInfo.links.her) { el.classList.add('hidden'); return; }
  el.classList.remove('hidden');
  if (h.status === 'needs-enable') {
    el.innerHTML = `<span>🔒 To let her <b>install the app</b>, her link needs to be secure (https). Tailscale needs a one-time OK:</span>
      <a class="ghost small" href="${h.enableUrl}" target="_blank" rel="noopener">Open Tailscale</a>
      <button class="ghost small" id="httpsRetry">I've done it — check again</button>`;
  } else {
    el.innerHTML = `<span>🔒 Her link isn't secure yet, so she can't install the app. ${escapeHtml(h.detail || '')}</span>
      <button class="ghost small" id="httpsRetry">Check again</button>`;
  }
  $('httpsRetry').onclick = async () => {
    $('httpsRetry').textContent = 'Checking…';
    try { await api('/api/host/https-retry', {}); } catch { /* shown below */ }
    await loadHostInfo();
    if (hostInfo.https.status === 'ok') toast('Her link is secure now. Copy it and send her the new one!', 7000);
  };
}

// ---- Subtitles ------------------------------------------------------------------
/** meta.subtitles used to be one file name; now it's a list. */
function subsOf(mv) {
  if (!mv || !mv.subtitles) return [];
  if (typeof mv.subtitles === 'string') return [{ file: mv.subtitles, label: 'Subtitles', lang: 'en' }];
  return mv.subtitles;
}
const subKey = (s) => `${s.lang}|${s.label}`;
const appliedOffset = new WeakMap();
let subOffset = 0;

function buildSubtitleTracks(mv) {
  for (const t of [...video.querySelectorAll('track')]) t.remove();
  const subs = subsOf(mv);
  $('subsBtn').classList.toggle('hidden', !subs.length);
  $('subsMenu').classList.add('hidden');
  subOffset = Number(store.get(`mn_suboff_${mv.id}`)) || 0;
  for (const sub of subs) {
    const tr = document.createElement('track');
    tr.kind = 'subtitles';
    tr.label = sub.label;
    tr.srclang = sub.lang && sub.lang !== 'und' ? sub.lang : 'en';
    tr.src = `/library/${encodeURIComponent(mv.id)}/${sub.file}`;
    tr.dataset.key = subKey(sub);
    tr.addEventListener('load', applySubOffset);
    video.appendChild(tr);
  }
  applySubSize();
  selectSub(preferredSub(subs));
}

/** This device's choice: the same language/label as last time, else English, else the first. */
function preferredSub(subs) {
  const saved = store.get('mn_subChoice');
  if (saved === 'off' || (!saved && store.get('mn_subs') === 'off')) return 'off';
  if (!subs.length) return 'off';
  const exact = subs.find((x) => subKey(x) === saved);
  const sameLang = saved && subs.find((x) => x.lang === saved.split('|')[0]);
  return subKey(exact || sameLang || subs.find((x) => x.lang === 'en') || subs[0]);
}

function selectSub(key) {
  [...video.querySelectorAll('track')].forEach((el, i) => {
    const t = video.textTracks[i];
    if (t) t.mode = el.dataset.key === key ? 'showing' : 'disabled';
  });
  $('subsBtn').classList.toggle('on', key !== 'off');
  setTimeout(applySubOffset, 300);
}

/** Shift every subtitle line by the timing nudge (positive = later). */
function applySubOffset() {
  for (const t of video.textTracks) {
    if (!t.cues || !t.cues.length) continue;
    const delta = subOffset - (appliedOffset.get(t) || 0);
    if (!delta) continue;
    for (const c of [...t.cues]) {
      c.startTime = Math.max(0, c.startTime + delta);
      c.endTime = Math.max(c.startTime + 0.1, c.endTime + delta);
    }
    appliedOffset.set(t, subOffset);
  }
}

function applySubSize() {
  const size = store.get('mn_subSize') || 'm';
  $('stage').classList.remove('subs-s', 'subs-m', 'subs-l');
  $('stage').classList.add(`subs-${size}`);
}

function toggleSubsMenu(force) {
  const menu = $('subsMenu');
  const open = force !== undefined ? force : menu.classList.contains('hidden');
  if (!open) { menu.classList.add('hidden'); return; }
  renderSubsMenu();
  menu.classList.remove('hidden');
  showChrome();
}

function renderSubsMenu() {
  const menu = $('subsMenu');
  const subs = subsOf(meta);
  const current = [...video.querySelectorAll('track')].find((el, i) => video.textTracks[i] && video.textTracks[i].mode === 'showing');
  const currentKey = current ? current.dataset.key : 'off';
  const size = store.get('mn_subSize') || 'm';
  const off = subOffset === 0 ? 'On time' : `${subOffset > 0 ? '+' : '−'}${Math.abs(subOffset).toFixed(1)}s ${subOffset > 0 ? 'later' : 'earlier'}`;
  menu.innerHTML = `
    <h4>Subtitles</h4>
    <div>
      <button class="opt ${currentKey === 'off' ? 'on' : ''}" data-key="off">Off</button>
      ${subs.map((x) => `<button class="opt ${subKey(x) === currentKey ? 'on' : ''}" data-key="${escapeHtml(subKey(x))}">${escapeHtml(x.label)}</button>`).join('')}
    </div>
    <h4>Text size</h4>
    <div class="seg">${[['s', 'Small'], ['m', 'Medium'], ['l', 'Large']].map(([k, l]) => `<button data-size="${k}" class="${size === k ? 'on' : ''}">${l}</button>`).join('')}</div>
    <h4>Timing</h4>
    <div class="timing"><button data-nudge="-0.5" aria-label="Show subtitles earlier">−½s</button><span>${off}</span><button data-nudge="0.5" aria-label="Show subtitles later">+½s</button>
      ${subOffset ? '<button data-nudge="reset">Reset</button>' : ''}</div>
    <p class="hint">Words appearing too early? Use +½s. Too late? Use −½s. Only changes your screen.</p>`;
  for (const b of menu.querySelectorAll('[data-key]')) b.onclick = () => {
    store.set('mn_subChoice', b.dataset.key);
    selectSub(b.dataset.key);
    renderSubsMenu();
  };
  for (const b of menu.querySelectorAll('[data-size]')) b.onclick = () => { store.set('mn_subSize', b.dataset.size); applySubSize(); renderSubsMenu(); };
  for (const b of menu.querySelectorAll('[data-nudge]')) b.onclick = () => {
    subOffset = b.dataset.nudge === 'reset' ? 0 : Math.round((subOffset + Number(b.dataset.nudge)) * 10) / 10;
    store.set(`mn_suboff_${meta.id}`, String(subOffset));
    applySubOffset();
    renderSubsMenu();
  };
}
document.addEventListener('pointerdown', (e) => {
  if (!$('subsMenu').classList.contains('hidden') && !e.target.closest('#subsMenu') && !e.target.closest('#subsBtn')) toggleSubsMenu(false);
});

/** Subtitles were added on the laptop while a movie is open: show them without interrupting playback. */
function syncOpenMovieSubs() {
  if (!meta) return;
  const fresh = movies.find((m) => m.id === meta.id);
  if (!fresh || JSON.stringify(subsOf(fresh)) === JSON.stringify(subsOf(meta))) return;
  const had = subsOf(meta).length;
  meta = fresh;
  buildSubtitleTracks(meta);
  if (subsOf(meta).length > had) toast('New subtitles added. Tap CC to choose them.');
}

// Subtitle choices (Add movie dialog and Subtitles dialog)
function renderSubChoices(container, items, checked) {
  container._items = items;
  if (!items.length) { container.innerHTML = '<p class="muted small">No subtitles found inside this file or next to it. You can add a subtitle file later from the movie\'s CC+ button.</p>'; return; }
  container.innerHTML = items.map((it, i) => {
    const already = (container._existing || []).includes(it.label);
    const usable = (it.type === 'file' || it.textBased) && !already;
    const where = it.type === 'file' ? `file: ${it.name}` : `built in${it.forced ? ' · forced' : ''}${it.codec ? ` · ${it.codec}` : ''}`;
    return `<label class="check ${usable ? '' : 'disabled'}"><input type="checkbox" data-i="${i}" ${checked.has(i) && usable ? 'checked' : ''} ${usable ? '' : 'disabled'}>
      <span>${escapeHtml(it.label)} <span class="note">· ${escapeHtml(where)}${already ? ' · already added' : usable ? '' : ' · picture-based, can\'t be used'}</span></span></label>`;
  }).join('');
}
function chosenSubs(container) {
  return (container._items || []).filter((it, i) => { const cb = container.querySelector(`input[data-i="${i}"]`); return cb && cb.checked; })
    .map((it) => (it.type === 'track' ? { type: 'track', stream: it.stream, label: it.label, lang: it.lang } : { type: 'file', path: it.path, label: it.label, lang: it.lang }));
}
const sameSource = (a, b) => a.type === b.type && (a.type === 'track' ? a.stream === b.stream : a.path === b.path);

async function loadSubChoices({ file, id }) {
  const box = id ? $('subsAvailable') : $('subsChoices');
  box._items = null;
  box._existing = id && subsDialogMovie ? subsOf(subsDialogMovie).map((x) => x.label) : [];
  box.innerHTML = '<p class="muted small">Looking for subtitles…</p>';
  try {
    const src = await api(`/api/host/subsources?${id ? `id=${encodeURIComponent(id)}` : `file=${encodeURIComponent(file)}`}`);
    const items = [...src.files, ...src.tracks];
    const checked = new Set(id ? [] : items.map((it, i) => (src.defaults.some((d) => sameSource(d, it)) ? i : -1)).filter((i) => i >= 0));
    renderSubChoices(box, items, checked);
    if (id && src.sourceMissing) box.insertAdjacentHTML('afterbegin', '<p class="muted small">The original movie file has moved, so only subtitle files can be added.</p>');
  } catch (e) { box.innerHTML = `<p class="muted small">${escapeHtml(e.message)}</p>`; box._items = null; }
}

// Subtitles dialog for a movie already in the library
let subsDialogMovie = null;
function openSubsDialog(mv) {
  subsDialogMovie = mv;
  $('subsDialogTitle').textContent = `Subtitles · ${mv.title}`;
  renderCurrentSubs();
  $('subsDialog').classList.remove('hidden');
  loadSubChoices({ id: mv.id });
}
function renderCurrentSubs() {
  const subs = subsOf(subsDialogMovie);
  $('subsCurrent').innerHTML = subs.length
    ? subs.map((x) => `<span class="chip">${escapeHtml(x.label)}<button data-file="${escapeHtml(x.file)}" aria-label="Remove ${escapeHtml(x.label)}">✕</button></span>`).join('')
    : '<span class="muted small">None yet.</span>';
  for (const b of $('subsCurrent').querySelectorAll('button')) b.onclick = async () => {
    if (!confirm('Remove these subtitles?')) return;
    try {
      await api('/api/host/remove-subs', { id: subsDialogMovie.id, file: b.dataset.file });
      subsDialogMovie = { ...subsDialogMovie, subtitles: subsOf(subsDialogMovie).filter((x) => x.file !== b.dataset.file) };
      renderCurrentSubs();
      loadSubChoices({ id: subsDialogMovie.id });
    } catch (e) { toast(e.message); }
  };
}
$('subsDialogClose').onclick = () => $('subsDialog').classList.add('hidden');
$('subsDialog').addEventListener('click', (e) => { if (e.target === $('subsDialog')) $('subsDialog').classList.add('hidden'); });
$('subsBrowse').onclick = () => {
  const box = $('subsAvailable');
  openPicker('subs', (f) => {
    const items = box._items || [];
    const checked = new Set(items.map((it, i) => { const cb = box.querySelector(`input[data-i="${i}"]`); return cb && cb.checked ? i : -1; }).filter((i) => i >= 0));
    const lang = (f.name.match(/\.([a-z]{2,3})\.[a-z]+$/i) || [])[1] || '';
    items.unshift({ type: 'file', path: f.path, name: f.name, lang: lang.toLowerCase(), label: ({ en: 'English', eng: 'English', el: 'Greek', gre: 'Greek' })[lang.toLowerCase()] || 'Subtitles' });
    renderSubChoices(box, items, new Set([0, ...[...checked].map((i) => i + 1)]));
  });
};
$('subsAdd').onclick = async () => {
  const items = chosenSubs($('subsAvailable'));
  if (!items.length) { toast('Tick at least one subtitle, or choose a subtitle file.'); return; }
  $('subsAdd').disabled = true;
  $('subsAdd').textContent = 'Adding…';
  try {
    const r = await api('/api/host/add-subs', { id: subsDialogMovie.id, items });
    toast(`Added: ${r.added.map((x) => x.label).join(', ')}`);
    $('subsDialog').classList.add('hidden');
  } catch (e) { toast(e.message, 7000); }
  finally { $('subsAdd').disabled = false; $('subsAdd').textContent = 'Add subtitles'; }
};

/**
 * With minutes already loaded, it's safe to aim higher: be braver about switching up
 * the more buffer there is (a dip can't cause a pause before quality drops back).
 */
function tuneAbrForBuffer() {
  if (!hls || !hls.levels.length) return;
  const ahead = bufferAhead();
  hls.config.abrBandWidthUpFactor = ahead > 90 ? 0.95 : ahead > 45 ? 0.85 : 0.7;
  hls.config.abrBandWidthFactor = ahead > 90 ? 1.0 : ahead > 45 ? 0.9 : 0.8;
  // Don't panic on a short dip: with plenty loaded, keep a quality floor.
  // (If the connection really collapses, the buffer drains below these and the floor lifts.)
  const levels = hls.levels;
  const top = hls.autoLevelCapping >= 0 ? hls.autoLevelCapping : levels.length - 1;
  const firstAtLeast = (w) => { const i = levels.findIndex((l) => l.width >= w); return i < 0 ? top : Math.min(i, top); };
  let floor = ahead > 90 ? firstAtLeast(1900) : ahead > 45 ? firstAtLeast(1260) : 0;
  // Only hold a floor the connection can actually keep up with at its slowest lately.
  while (floor > 0 && levelRate(floor) * 1.2 > safeBandwidth()) floor--;
  hls.config.minAutoBitrate = floor > 0 ? levels[floor].maxBitrate || levels[floor].bitrate : 0;
}

/** "1080p HQ", or "480p ↗ 1080p HQ" while sharper video is being loaded after a dip. */
function qualityText(lv) {
  if (!lv) return '';
  const name = (l) => labelFor(l).split(' · ')[0];
  const next = hls && hls.levels[hls.nextLoadLevel];
  return next && next !== lv && (next.bitrate > lv.bitrate) ? `${name(lv)} ↗ ${name(next)}` : name(lv);
}

// ---- Steady mode for shaky connections --------------------------------------------
const bwSamples = []; // [time, bits/s] over the last minute
let lastStallAt = 0;
setInterval(() => {
  if (!hls || !hls.bandwidthEstimate || hls.currentLevel < 0) return;
  bwSamples.push([Date.now(), hls.bandwidthEstimate]);
  while (bwSamples.length && bwSamples[0][0] < Date.now() - 60000) bwSamples.shift();
}, 2000);

/** The slowest the connection has been over the last 30 s (what we can count on). */
function safeBandwidth() {
  const recent = bwSamples.filter(([t]) => t > Date.now() - 30000).map(([, b]) => b);
  if (!recent.length) return hls ? hls.bandwidthEstimate || 0 : 0;
  return Math.min(...recent);
}

function noteStall() {
  lastStallAt = Date.now();
  let log = [];
  try { log = JSON.parse(store.get('mn_stalls') || '[]'); } catch { /* ignore */ }
  log = [...log.filter((t) => t > Date.now() - 7 * 86400000), Date.now()].slice(-20);
  store.set('mn_stalls', JSON.stringify(log));
}

/** Two or more pauses on this device in the last week: be careful. */
function isShaky() {
  try { return JSON.parse(store.get('mn_stalls') || '[]').filter((t) => t > Date.now() - 7 * 86400000).length >= 2; }
  catch { return false; }
}
