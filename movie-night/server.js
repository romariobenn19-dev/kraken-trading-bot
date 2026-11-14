#!/usr/bin/env node
/**
 * Movie Night server - runs on the host laptop.
 *
 *  - Serves the web player and the prepared movies (HLS chunks) from ./library
 *  - Keeps everyone's playback in sync over a WebSocket
 *  - Pauses everyone if anyone's connection falls behind, and resumes once
 *    every viewer has a healthy buffer again
 *
 * Start:  node server.js [--open | --background]
 *   --open        open the host page in the browser (if already running, just open it)
 *   --background  quiet start used at Windows login
 * On Windows, the "Movie Night" desktop shortcut made by setup.bat does this for you.
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { pipeline } = require('stream');
const { WebSocketServer } = require('ws');

// Finish an update that couldn't swap every file last time (Windows had one busy).
// Runs first thing, before the rest of the app is loaded.
(function finishPendingUpdate() {
  const walk = (dir, depth) => {
    let list = [];
    try { list = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of list) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { if (depth < 1 && e.name === 'public') walk(full, depth + 1); }
      else if (e.name.endsWith('.new')) {
        try { fs.renameSync(full, full.slice(0, -4)); } catch {
          try { fs.copyFileSync(full, full.slice(0, -4)); fs.rmSync(full, { force: true }); } catch { /* try again next start */ }
        }
      }
    }
  };
  walk(__dirname, 0);
})();

const createHost = require('./host');
const createFeatures = require('./features');
const createTmdb = require('./tmdb');

const ROOT = __dirname;

// A bug somewhere must never take the whole app down (every button would then say
// "Failed to fetch"). Write it to error.log, keep running; the laptop's app shows it.
const ERROR_LOG = path.join(ROOT, 'error.log');
function logCrash(kind, err) {
  const text = `[${new Date().toISOString()}] ${kind}: ${(err && err.stack) || err}\n`;
  console.error(text);
  try {
    let old = ''; try { old = fs.readFileSync(ERROR_LOG, 'utf8').slice(-20000); } catch { /* none yet */ }
    fs.writeFileSync(ERROR_LOG, old + text);
  } catch { /* nowhere to write */ }
}
process.on('uncaughtException', (err) => {
  logCrash('error', err);
  if (err && err.code === 'EADDRINUSE') process.exit(1); // can't run at all: let startup handle it
});
process.on('unhandledRejection', (err) => logCrash('unhandled', err));


const PUBLIC = path.join(ROOT, 'public');
const LIBRARY = process.env.LIBRARY || path.join(ROOT, 'library');
const CONFIG_FILE = path.join(ROOT, 'config.json');
const PHOTOS = path.join(ROOT, 'personal', 'photos'); // private: never uploaded, never in git
const PHOTO_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);
const PORT = Number(process.env.PORT || 8080);
const ARGS = new Set(process.argv.slice(2));

// ---- Config: a secret key so only people with your link can watch ----------
function loadConfig() {
  let cfg = {};
  try { cfg = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); } catch { /* first run */ }
  if (!cfg.key) {
    cfg.key = crypto.randomBytes(12).toString('base64url');
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2));
  }
  return cfg;
}
const config = loadConfig();
function saveConfig() { fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2)); }
fs.mkdirSync(LIBRARY, { recursive: true });

// ---- Buffering policy ---------------------------------------------------------
const LOW_BUFFER = 1.5;                         // seconds left before we call it a stall
const RESUME_STEPS = [20, 40, 60, 90, 120];     // buffer needed to (re)start; grows after repeated stalls
const START_BUFFER = 15;
const START_TIMEOUT = 20000;   // after this, start without anyone who hasn't managed to load anything
const START_TIMEOUT_MAX = 90000; // ...and after this, without anyone still loading
const SHAKY_START = 45;          // seconds a viewer with a shaky connection loads before starting
const LATE_READY = 10;          // a late joiner counts again once this many seconds are loaded

// ---- HTTP -------------------------------------------------------------------
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.m3u8': 'application/vnd.apple.mpegurl', '.m4s': 'video/iso.segment',
  '.mp4': 'video/mp4', '.vtt': 'text/vtt; charset=utf-8', '.jpg': 'image/jpeg', '.png': 'image/png',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.webmanifest': 'application/manifest+json',
};

function parseCookies(header) {
  const out = {};
  for (const part of (header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a || '')), y = Buffer.from(String(b || ''));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

/** Requests from the laptop itself: the host. Only the host can add/delete movies or update. */
function isLocal(req) {
  const a = (req.socket && req.socket.remoteAddress) || '';
  if (!(a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1')) return false;
  // Requests relayed by Tailscale's HTTPS (her https:// link) also arrive from 127.0.0.1,
  // so only count it as the laptop when it was addressed to localhost and not forwarded.
  if (req.headers['x-forwarded-for'] || req.headers['tailscale-user-login']) return false;
  const h = String(req.headers.host || '').toLowerCase();
  return h.startsWith('localhost') || h.startsWith('127.0.0.1') || h.startsWith('[::1]');
}

// Files needed to install the app / show the "not on" page. Nothing private in them.
const PUBLIC_FILES = new Set(['/manifest.webmanifest', '/sw.js', '/offline.html', '/icon.png', '/icon.ico',
  '/icon-192.png', '/icon-512.png', '/icon-maskable-512.png', '/apple-touch-icon.png']);

function isAuthorized(req, url) {
  return isLocal(req) || safeEqual(url.searchParams.get('key'), config.key) || safeEqual(parseCookies(req.headers.cookie).mn_key, config.key);
}

function sendFile(req, res, file, cacheControl) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404); res.end('Not found'); return; }
    const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
    const headers = { 'Content-Type': type, 'Cache-Control': cacheControl, 'Accept-Ranges': 'bytes' };
    const range = req.headers.range && /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
    if (range) {
      let start = range[1] === '' ? st.size - Number(range[2]) : Number(range[1]);
      let end = range[1] !== '' && range[2] !== '' ? Number(range[2]) : st.size - 1;
      if (start < 0) start = 0;
      if (start > end || start >= st.size) {
        res.writeHead(416, { 'Content-Range': `bytes */${st.size}` }); res.end(); return;
      }
      end = Math.min(end, st.size - 1);
      res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Content-Length': end - start + 1 });
      if (req.method === 'HEAD') return res.end();
      // pipeline() closes the file even if the viewer cancels the download halfway
      // (a plain .pipe() leaves it open, and Windows then can't replace it during an update).
      pipeline(fs.createReadStream(file, { start, end }), res, () => {});
      return;
    }
    res.writeHead(200, { ...headers, 'Content-Length': st.size });
    if (req.method === 'HEAD') return res.end();
    pipeline(fs.createReadStream(file), res, () => {});
  });
}

/** Resolve a URL path inside a base directory, refusing anything that escapes it. */
function within(base, rel) {
  const p = path.normalize(path.join(base, rel));
  return p === base || p.startsWith(base + path.sep) ? p : null;
}

function listMovies() {
  const movies = [];
  for (const dir of fs.readdirSync(LIBRARY, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    try {
      const meta = JSON.parse(fs.readFileSync(path.join(LIBRARY, dir.name, 'meta.json'), 'utf8'));
      movies.push(meta);
    } catch { /* still preparing, or not a movie folder */ }
  }
  return movies.sort((a, b) => String(b.preparedAt).localeCompare(String(a.preparedAt)));
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const hostApi = url.pathname.startsWith('/api/host/');
  const featureApi = url.pathname.startsWith('/api/f/');
  if (req.method !== 'GET' && req.method !== 'HEAD' && !((hostApi || featureApi) && req.method === 'POST')) { res.writeHead(405); res.end(); return; }

  if (PUBLIC_FILES.has(url.pathname) && req.method !== 'POST') {
    const extra = url.pathname === '/sw.js' ? 'no-cache' : 'public, max-age=86400';
    sendFile(req, res, path.join(PUBLIC, url.pathname.slice(1)), extra);
    return;
  }
  if (!isAuthorized(req, url)) {
    res.writeHead(401, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<!doctype html><meta name=viewport content="width=device-width"><body style="font-family:sans-serif;' +
      'background:#111;color:#eee;padding:2em">Movie Night: this link is missing its key. Ask your partner for the full link.</body>');
    return;
  }
  if (url.searchParams.has('key')) {
    // Remember the key in a cookie so video requests and the sync socket are authorized too.
    res.setHeader('Set-Cookie', `mn_key=${encodeURIComponent(config.key)}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax`);
  }

  let pathname;
  try { pathname = decodeURIComponent(url.pathname); } catch { res.writeHead(400); res.end(); return; }

  if (hostApi) {
    if (!isLocal(req)) { res.writeHead(403); res.end('Only on the host laptop'); return; }
    // Block other websites from poking the host API through the browser.
    const origin = req.headers.origin;
    if (origin && new URL(origin).host !== req.headers.host) { res.writeHead(403); res.end(); return; }
    host.handle(req, res, pathname, url);
    return;
  }
  if (featureApi) {
    const origin = req.headers.origin;
    if (req.method === 'POST' && origin && new URL(origin).host !== req.headers.host) { res.writeHead(403); res.end(); return; }
    features.http(req, res, pathname, url);
    return;
  }
  if (pathname.startsWith('/personal/snapshots/')) {
    const file = within(features.snapsDir, pathname.slice('/personal/snapshots/'.length));
    if (!file || !file.endsWith('.jpg')) { res.writeHead(403); res.end(); return; }
    sendFile(req, res, file, 'private, max-age=86400');
    return;
  }
  if (pathname === '/api/personal') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(personal()));
    return;
  }
  if (pathname.startsWith('/personal/photos/')) {
    const file = within(PHOTOS, pathname.slice('/personal/photos/'.length));
    if (!file || !PHOTO_EXT.has(path.extname(file).toLowerCase())) { res.writeHead(403); res.end(); return; }
    sendFile(req, res, file, 'private, max-age=3600');
    return;
  }
  if (pathname === '/api/movies') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    const ready = listMovies().map((m) => ({ ...m, tmdb: tmdb.cached(m.id) }));
    // Movies added but not watchable yet (so they show up straight away on both screens).
    const pending = host.pendingMovies().filter((p) => !ready.some((m) => m.id === p.id));
    res.end(JSON.stringify([...pending, ...ready]));
    return;
  }
  if (pathname.startsWith('/library/')) {
    const file = within(LIBRARY, pathname.slice('/library/'.length));
    // Private files (e.g. .source.json with the laptop's file path) are never served.
    if (!file || path.basename(file).startsWith('.')) { res.writeHead(403); res.end(); return; }
    const ext = path.extname(file);
    const cache = ext === '.m4s' || ext === '.mp4' ? 'private, max-age=86400' : 'no-cache';
    sendFile(req, res, file, cache);
    return;
  }
  if (pathname === '/vendor/hls.min.js') {
    sendFile(req, res, path.join(ROOT, 'node_modules', 'hls.js', 'dist', 'hls.min.js'), 'private, max-age=86400');
    return;
  }
  const file = within(PUBLIC, pathname === '/' ? 'index.html' : pathname.slice(1));
  if (!file) { res.writeHead(403); res.end(); return; }
  sendFile(req, res, file, 'no-cache');
});

// ---- Sync room ----------------------------------------------------------------
// One shared room: this app is for the two of you.
const room = {
  movieId: null,
  paused: true,       // what players are doing right now
  wantPlay: false,    // what the viewers asked for (may be playing-but-held for buffering)
  pos: 0,             // movie position (seconds) at server time `at`
  at: Date.now(),
  hold: null,         // { reason: 'starting'|'buffering', who: [names] }
  stalls: 0,          // stalls during this movie; raises the resume buffer
  version: 0,
};
const clients = new Map(); // ws -> { id, name, role, isHost, buffer, full, stalled, ct, movieId, quality, bw }
let nextId = 1;

function nowPos() {
  return room.paused ? room.pos : room.pos + (Date.now() - room.at) / 1000;
}

function resumeTarget() {
  return RESUME_STEPS[Math.min(room.stalls, RESUME_STEPS.length - 1)];
}

function setPosition(pos, paused) {
  room.pos = Math.max(0, pos);
  room.at = Date.now();
  room.paused = paused;
}

function publicState() {
  return {
    t: 'state', v: room.version, movieId: room.movieId, paused: room.paused, wantPlay: room.wantPlay,
    pos: room.pos, at: room.at, hold: room.hold, resumeTarget: resumeTarget(), startBuffer: START_BUFFER,
    intermission: room.intermission ? { until: room.intermission.until, by: room.intermission.by } : null,
    surprise: !!room.movieId && room.surprise === room.movieId,
  };
}

function peers() {
  return [...clients.values()].map((c) => ({
    id: c.id, name: c.name, role: c.role, buffer: c.buffer, full: c.full, stalled: c.stalled,
    quality: c.quality, bw: c.bw, ready: c.movieId === room.movieId,
    visible: c.visible !== false, error: c.error || null, late: !!c.late, hevc: c.hevc, shaky: !!c.shaky,
  }));
}

function send(ws, msg) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}
function broadcast(msg) {
  const data = JSON.stringify(msg);
  for (const ws of clients.keys()) if (ws.readyState === ws.OPEN) ws.send(data);
}
function changed() {
  room.version++;
  broadcast(publicState());
}

/** Is this viewer buffered enough (relative to the shared position) to play? */
/** Is this viewer actually in the movie right now (player working, app on screen, still talking to us)? */
function participating(c) {
  return c.movieId === room.movieId && c.visible !== false && !c.error && Date.now() - (c.seenAt || 0) < 6000;
}

/** Start/continue without anyone who's still waiting; they'll catch up and join in. */
function leaveBehind(list) {
  for (const c of list) c.late = true;
}

function hasBuffer(c, need) {
  if (c.movieId !== room.movieId) return false;
  // Shaky connections start with a bigger cushion (fewer pauses mid-movie).
  if (room.hold && room.hold.reason === 'starting' && c.shaky) need = Math.max(need, SHAKY_START);
  if (Math.abs(c.ct - room.pos) > 3) return false; // hasn't caught up with the latest seek yet
  return c.full || c.buffer >= need;
}

function evaluate() {
  if (!room.movieId || !room.wantPlay || clients.size === 0) return;
  if (room.hold && room.hold.reason === 'countdown') return; // curtains are opening
  const list = [...clients.values()];
  if (!room.paused) {
    const struggling = list.filter((c) => participating(c) && !c.late && !c.full && (c.stalled || c.buffer < LOW_BUFFER));
    if (struggling.length) {
      room.stalls++;
      setPosition(nowPos(), true);
      room.hold = { reason: 'buffering', who: struggling.map((c) => c.name), since: Date.now() };
      changed();
    }
  } else if (room.hold) {
    const need = room.hold.reason === 'starting' ? START_BUFFER : resumeTarget();
    let waiting = list.filter((c) => participating(c) && !c.late && !hasBuffer(c, need));
    // Don't let one slow starter hold everyone up: after a while, start with whoever is ready.
    if (waiting.length && room.hold.reason === 'starting' && Date.now() - room.hold.since > START_TIMEOUT) {
      const ready = list.filter((c) => participating(c) && !c.late && hasBuffer(c, need));
      // Leave behind only viewers who are stuck (nothing loaded); slow-but-loading ones are
      // waited for, up to START_TIMEOUT_MAX.
      const longWait = Date.now() - room.hold.since > START_TIMEOUT_MAX;
      const stuck = waiting.filter((c) => longWait || c.buffer < 3);
      if (ready.length && stuck.length) { leaveBehind(stuck); waiting = waiting.filter((c) => !stuck.includes(c)); }
    }
    const waitingFor = waiting.map((c) => c.name);
    if (!waitingFor.length) {
      if (room.pos < 2 && room.countdownFor !== room.movieId) { startWithCurtains(); return; }
      room.hold = null;
      setPosition(room.pos, false);
      countMovieNight();
      changed();
    } else if (String(waitingFor) !== String(room.hold.who)) {
      room.hold.who = waitingFor;
      changed();
    }
  }
}

function handle(ws, c, msg) {
  switch (msg.t) {
    case 'hello':
      c.name = String(msg.name || c.name).slice(0, 30);
      c.role = c.isHost || msg.role === 'host' ? 'host' : 'guest';
      c.hevc = typeof msg.hevc === 'boolean' ? msg.hevc : null;
      rememberDevice(c, msg.deviceId);
      // One of you at a time: a newer window/browser/device takes over from the older one.
      for (const [otherWs, other] of clients) {
        if (otherWs !== ws && other.name.trim().toLowerCase() === c.name.trim().toLowerCase()) {
          send(otherWs, { t: 'replaced' });
          clients.delete(otherWs);
          setTimeout(() => otherWs.close(4001, 'Opened somewhere else'), 100);
        }
      }
      send(ws, publicState());
      break;
    case 'ping':
      send(ws, { t: 'pong', c: msg.c, s: Date.now() });
      break;
    case 'load': {
      if (typeof msg.movieId !== 'string') return;
      if (room.movieId) features.trackProgress(nowPos(), true);
      room.surprise = msg.surprise && msg.movieId ? msg.movieId : null;
      loadMovie(msg.movieId, Number.isFinite(msg.pos) ? msg.pos : undefined);
      if (msg.movieId) {
        const mv = listMovies().find((m) => m.id === msg.movieId);
        if (mv) features.onMovieLoaded(mv.title, c.name, !!room.surprise);
      }
      break;
    }
    case 'play':
      if (!room.movieId) return;
      clearIntermission();
      for (const other of clients.values()) other.late = false;
      room.wantPlay = true;
      setPosition(Number.isFinite(msg.pos) ? msg.pos : room.pos, true);
      room.hold = { reason: 'starting', who: [], since: Date.now() };
      changed();
      evaluate();
      break;
    case 'force': {
      // "Start without them": go now; anyone still loading catches up on their own.
      if (!room.hold) return;
      leaveBehind([...clients.values()].filter((o) => !hasBuffer(o, 2)));
      room.hold = null;
      setPosition(room.pos, false);
      countMovieNight();
      changed();
      break;
    }
    case 'pause':
      room.wantPlay = false; room.hold = null;
      setPosition(Number.isFinite(msg.pos) ? msg.pos : nowPos(), true);
      features.trackProgress(room.pos, true);
      changed();
      break;
    case 'seek':
      if (!Number.isFinite(msg.pos)) return;
      for (const other of clients.values()) other.late = false;
      setPosition(msg.pos, true);
      room.hold = room.wantPlay ? { reason: 'starting', who: [], since: Date.now() } : null;
      changed();
      evaluate();
      break;
    case 'status':
      c.buffer = Number(msg.buffer) || 0;
      c.full = !!msg.full;
      c.stalled = !!msg.stalled;
      c.ct = Number(msg.ct) || 0;
      c.movieId = msg.movieId || null;
      c.quality = String(msg.quality || '').slice(0, 40);
      c.bw = Number(msg.bw) || 0;
      c.visible = msg.visible !== false;
      c.shaky = !!msg.shaky;
      c.error = msg.error ? String(msg.error).slice(0, 40) : null;
      c.seenAt = Date.now();
      if (c.late && (c.full || c.buffer >= LATE_READY) && Math.abs(c.ct - nowPos()) < 3) c.late = false;
      host.onStatus(c, msg);
      evaluate();
      break;
    case 'react': {
      const emoji = String(msg.emoji || '').slice(0, 8);
      const pos = room.movieId ? nowPos() : null;
      broadcast({ t: 'react', from: c.name, emoji, movieId: room.movieId, pos, at: Date.now() });
      if (room.movieId) features.recordReaction(c.name, emoji, room.movieId, pos);
      break;
    }
    case 'intermission': {
      // Snack break: pause together for a few minutes, then carry on together.
      if (!room.movieId) return;
      const mins = Math.max(1, Math.min(20, Number(msg.minutes) || 5));
      room.wantPlay = false; room.hold = null;
      setPosition(nowPos(), true);
      features.trackProgress(room.pos, true);
      room.intermission = { until: Date.now() + mins * 60000, by: c.name };
      scheduleIntermissionEnd();
      features.count('intermission');
      changed();
      break;
    }
    case 'intermissionMore':
      if (!room.intermission) return;
      room.intermission.until = Math.max(room.intermission.until, Date.now()) + 2 * 60000;
      scheduleIntermissionEnd();
      changed();
      break;
    case 'intermissionEnd':
      if (room.intermission) endIntermission();
      break;
    case 'want': {
      // "Watch this now" on a movie that's still waiting to be converted.
      const id = String(msg.movieId || '');
      if (listMovies().some((m) => m.id === id)) { loadMovie(id); break; }
      const r = host.prioritize(id);
      if (!r) break;
      room.want = { movieId: id, by: c.name, at: Date.now() };
      broadcast({ t: 'wantAck', movieId: id, title: r.title, by: c.name });
      break;
    }
    default:
      features.handle(c, msg);
  }
}

const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 });
server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname !== '/sync' || !isAuthorized(req, url)) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n'); socket.destroy(); return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
});

wss.on('connection', (ws, req) => {
  const c = { id: nextId++, name: 'Viewer', role: 'guest', isHost: isLocal(req), buffer: 0, full: false, stalled: false, ct: 0, movieId: null, quality: '', bw: 0 };
  clients.set(ws, c);
  send(ws, { t: 'welcome', isHost: c.isHost, version: appVersion() });
  if (c.isHost) send(ws, { t: 'jobs', jobs: host.publicJobs() });
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('message', (data) => {
    let msg;
    try { msg = JSON.parse(data); } catch { return; }
    if (msg && typeof msg.t === 'string') handle(ws, c, msg);
  });
  ws.on('close', () => {
    clients.delete(ws);
    features.onDisconnect(c);
    // If someone drops while we're held waiting for them, don't wait forever.
    evaluate();
  });
});

/** Remember which devices you two use and whether each can play HEVC (decides if H.264 backups are needed). */
function rememberDevice(c, deviceId) {
  if (typeof deviceId !== 'string' || !/^[a-z0-9]{8,32}$/.test(deviceId) || typeof c.hevc !== 'boolean') return;
  const devices = config.devices || (config.devices = {});
  const today = new Date().toISOString().slice(0, 10);
  const d = devices[deviceId];
  if (d && d.hevc === c.hevc && d.name === c.name && d.lastSeen === today) return;
  devices[deviceId] = { name: c.name, hevc: c.hevc, host: !!c.isHost, lastSeen: today };
  saveConfig();
}

/** Start of a movie: curtains open with a 3-2-1 countdown on every screen, then play. */
function startWithCurtains() {
  room.countdownFor = room.movieId;
  room.hold = { reason: 'countdown', who: [], since: Date.now() };
  changed();
  const at = Date.now() + 3000;
  broadcast({ t: 'countdown', at });
  setTimeout(() => {
    if (!room.hold || room.hold.reason !== 'countdown') return;
    room.hold = null;
    setPosition(room.pos, false);
    countMovieNight();
    changed();
  }, 3000);
}

/** Open a movie on every screen (resuming where you left off unless told otherwise). */
function loadMovie(movieId, pos) {
  if ((movieId || null) !== room.movieId) features.onMovieChanged();
  clearIntermission();
  if (room.surprise && room.surprise !== movieId) room.surprise = null;
  room.movieId = movieId || null;
  room.wantPlay = false; room.hold = null; room.stalls = 0;
  let start = pos;
  if (start === undefined && movieId) {
    const p = features.progressOf(movieId);
    start = p && !p.done && p.pos > 30 ? Math.max(0, p.pos - 5) : 0;
  }
  setPosition(start || 0, true);
  changed();
}

let intermissionTimer = null;
function scheduleIntermissionEnd() {
  clearTimeout(intermissionTimer);
  intermissionTimer = setTimeout(endIntermission, Math.max(0, room.intermission.until - Date.now()));
}
function clearIntermission() {
  clearTimeout(intermissionTimer);
  room.intermission = null;
}
/** Break's over: everyone back on the sofa, the movie carries on together. */
function endIntermission() {
  clearIntermission();
  if (room.movieId) startPlaying(); else changed();
}

function startPlaying() {
  if (!room.movieId) return;
  for (const other of clients.values()) other.late = false;
  room.wantPlay = true;
  room.hold = { reason: 'starting', who: [], since: Date.now() };
  changed();
  evaluate();
}

// Remember how far you got (continue watching / diary), every few seconds while playing.
setInterval(() => { if (room.movieId && !room.paused) features.trackProgress(nowPos()); }, 5000);

// Re-check holds every second (for the start timeout), even if nobody sends anything.
setInterval(evaluate, 1000);

// Share everyone's connection health once a second, and drop dead sockets.
setInterval(() => broadcast({ t: 'peers', peers: peers() }), 1000);
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false; ws.ping();
  }
}, 15000);

// ---- Startup ------------------------------------------------------------------
function addresses() {
  const out = { tailscale: [], lan: [] };
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) {
      if (a.family !== 'IPv4' || a.internal) continue;
      const [x, y] = a.address.split('.').map(Number);
      if (x === 100 && y >= 64 && y <= 127) out.tailscale.push(a.address);
      else out.lan.push(a.address);
    }
  }
  return out;
}

// ---- Personal touches ---------------------------------------------------------------
function personal() {
  const p = config.personal || {};
  let photos = [];
  try {
    photos = fs.readdirSync(PHOTOS).filter((f) => PHOTO_EXT.has(path.extname(f).toLowerCase()))
      .sort().slice(0, 40).map((f) => `/personal/photos/${encodeURIComponent(f)}`);
  } catch { /* no photos yet */ }
  return { him: p.him || '', her: p.her || '', dog: p.dog || '', since: p.since || '', nights: p.nights || 0, photos };
}

function savePersonal(body) {
  const p = config.personal || (config.personal = {});
  for (const k of ['him', 'her', 'dog']) if (typeof body[k] === 'string') p[k] = body[k].trim().slice(0, 30);
  if (typeof body.since === 'string' && /^(\d{4}-\d{2}-\d{2})?$/.test(body.since)) p.since = body.since;
  saveConfig();
  broadcast({ t: 'personal' });
}

/** Each movie you start together on a given day counts as one movie night. */
function countMovieNight() {
  const p = config.personal || (config.personal = {});
  const key = `${new Date().toISOString().slice(0, 10)}|${room.movieId}`;
  if (p.lastNight === key) return;
  p.lastNight = key;
  p.nights = (p.nights || 0) + 1;
  saveConfig();
  broadcast({ t: 'personal' });
}

function openPhotosFolder() {
  fs.mkdirSync(PHOTOS, { recursive: true });
  const opener = process.platform === 'win32' ? 'explorer' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  try { spawn(opener, [PHOTOS], { detached: true, stdio: 'ignore' }).on('error', () => {}).unref(); } catch { /* headless */ }
  return PHOTOS;
}

function appVersion() {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version; } catch { return '?'; }
}

function links() {
  const { tailscale, lan } = addresses();
  const k = encodeURIComponent(config.key);
  return {
    host: `http://localhost:${PORT}/?key=${k}`,
    her: tsHttps.url ? `${tsHttps.url}/?key=${k}` : tailscale.length ? `http://${tailscale[0]}:${PORT}/?key=${k}` : null,
    herSecure: !!tsHttps.url,
    lan: lan.map((ip) => `http://${ip}:${PORT}/?key=${k}`),
  };
}

// ---- Secure https:// link for her (lets her install the app) -------------------
// Uses Tailscale's own HTTPS ("tailscale serve"): a real certificate for
// https://<laptop>.<tailnet>.ts.net that only your Tailscale devices can reach.
const tsHttps = { status: 'checking', url: null, enableUrl: null, detail: '' };

function findTailscale() {
  const candidates = ['tailscale'];
  if (process.platform === 'win32') candidates.unshift(path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Tailscale', 'tailscale.exe'));
  if (process.platform === 'darwin') candidates.unshift('/Applications/Tailscale.app/Contents/MacOS/Tailscale');
  for (const c of candidates) {
    if (c !== 'tailscale' && !fs.existsSync(c)) continue;
    const r = require('child_process').spawnSync(c, ['version'], { windowsHide: true, timeout: 8000 });
    if (!r.error && r.status === 0) return c;
  }
  return null;
}

function runTs(cli, args, timeoutMs = 20000) {
  return new Promise((resolve) => {
    let out = '';
    const p = spawn(cli, args, { windowsHide: true });
    const t = setTimeout(() => { p.kill(); resolve({ code: -1, out }); }, timeoutMs);
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { out += d; });
    p.on('error', () => { clearTimeout(t); resolve({ code: -1, out }); });
    p.on('close', (code) => { clearTimeout(t); resolve({ code, out }); });
  });
}

async function setupHttps() {
  Object.assign(tsHttps, { status: 'checking', url: null, enableUrl: null, detail: '' });
  const cli = findTailscale();
  if (!cli) { Object.assign(tsHttps, { status: 'no-tailscale', detail: 'Tailscale is not installed on this laptop.' }); return; }
  const st = await runTs(cli, ['status', '--json'], 10000);
  let self;
  try { self = JSON.parse(st.out).Self; } catch { /* not running */ }
  if (!self || !self.DNSName) { Object.assign(tsHttps, { status: 'off', detail: 'Tailscale is off on this laptop.' }); return; }
  const host = self.DNSName.replace(/\.$/, '');
  // Serve https://<host>/ -> this app. Safe to repeat; it just replaces the same setting.
  const r = await runTs(cli, ['serve', '--bg', String(PORT)], 25000);
  const link = (r.out.match(/https:\/\/login\.tailscale\.com\/\S+/) || [])[0];
  if (r.code === 0 && !link) {
    Object.assign(tsHttps, { status: 'ok', url: `https://${host}` });
    console.log(`  Secure link for her:    https://${host}/?key=${encodeURIComponent(config.key)}`);
  } else if (link) {
    Object.assign(tsHttps, { status: 'needs-enable', enableUrl: link, detail: 'HTTPS needs switching on once in Tailscale.' });
  } else {
    Object.assign(tsHttps, { status: 'failed', detail: r.out.trim().split('\n').slice(-2).join(' ').slice(0, 300) });
  }
}

function openBrowser(url) {
  const opts = { detached: true, stdio: 'ignore', windowsHide: true };
  try {
    if (process.platform === 'win32') {
      // Prefer Chrome: it plays HEVC on NVIDIA/Intel/AMD graphics out of the box (Edge needs an extra extension).
      const chrome = ['ProgramFiles', 'ProgramFiles(x86)', 'LOCALAPPDATA']
        .map((v) => process.env[v] && path.join(process.env[v], 'Google', 'Chrome', 'Application', 'chrome.exe'))
        .find((p) => p && fs.existsSync(p));
      if (chrome) spawn(chrome, [url], opts).unref();
      else spawn('rundll32', ['url.dll,FileProtocolHandler', url], opts).unref();
    }
    else if (process.platform === 'darwin') spawn('open', [url], opts).unref();
    else spawn('xdg-open', [url], opts).on('error', () => {}).unref();
  } catch { /* no browser available */ }
}

/** Restart after an update: hand over to a fresh copy of the server. */
// Exit codes understood by start-movie-night.bat
// Keep idle connections open longer than browsers do: otherwise a click right after a pause
// can land on a connection the server is just closing, and the browser says "Failed to fetch".
server.keepAliveTimeout = 65000;
server.headersTimeout = 66000;

const EXIT_RESTART = 75;      // "start me again" (after an update)
const EXIT_ALREADY_RUNNING = 3;

function restart() {
  broadcast({ t: 'restarting' });
  setTimeout(() => {
    for (const ws of wss.clients) ws.terminate();
    server.close();
    // Started by start-movie-night.bat: it relaunches us in the same window.
    if (process.env.MN_SUPERVISED === '1') process.exit(EXIT_RESTART);
    const log = fs.openSync(path.join(ROOT, 'movie-night.log'), 'a');
    spawn(process.execPath, [path.join(ROOT, 'server.js'), '--restarted'],
      { cwd: ROOT, detached: true, stdio: ['ignore', log, log], windowsHide: true, env: process.env }).unref();
    process.exit(0);
  }, 400);
}

const features = createFeatures({
  ROOT, LIBRARY, config, saveConfig, broadcast, clients, room, listMovies, loadMovie, startPlaying, publicLinks: () => links(),
});
const tmdb = createTmdb({ LIBRARY, config, listMovies, onUpdated: () => broadcast({ t: 'library' }) });

const host = createHost({
  ROOT, LIBRARY, config, saveConfig, links, restart, savePersonal, openPhotosFolder,
  httpsStatus: () => ({ ...tsHttps }), retryHttps: () => setupHttps(),
  tmdb, onMovieReady: (title, id) => {
    features.onNewMovie(title);
    tmdb.refresh().catch(() => {});
    // Someone asked to watch this one: open it on every screen now that it's watchable.
    if (room.want && room.want.movieId === id) {
      room.want = null;
      setTimeout(() => loadMovie(id, 0), 1500);
    }
  },
  sendToHosts(msg) {
    const data = JSON.stringify(msg);
    for (const [ws, c] of clients) if (c.isHost && ws.readyState === ws.OPEN) ws.send(data);
  },
  libraryChanged() { broadcast({ t: 'library' }); },
  onMovieDeleted(id) {
    if (room.movieId === id) {
      room.movieId = null; room.wantPlay = false; room.hold = null;
      setPosition(0, true);
      changed();
    }
  },
});

let listenTries = 0;
server.on('error', (err) => {
  if (err.code !== 'EADDRINUSE') throw err;
  if (ARGS.has('--restarted') && listenTries++ < 40) {
    setTimeout(() => server.listen(PORT, '0.0.0.0'), 500);
    return;
  }
  // Already running (e.g. started at login): just open it.
  if (ARGS.has('--open')) openBrowser(links().host);
  else if (!ARGS.has('--background')) console.log(`\n  Movie Night is already running. Open: ${links().host}\n`);
  setTimeout(() => process.exit(EXIT_ALREADY_RUNNING), 500);
});

server.listen(PORT, '0.0.0.0', () => {
  const l = links();
  console.log(`\n  Movie Night ${appVersion()} is running.\n`);
  console.log(`  You (on this laptop):   ${l.host}`);
  if (l.her) console.log(`  Send this to her:       ${l.her}`);
  else console.log('  (Tailscale not detected - install it so she can reach you from anywhere; see README.)');
  for (const u of l.lan) console.log(`  Same Wi-Fi only:        ${u}`);
  console.log(`\n  Movies: ${listMovies().length} ready in ${LIBRARY}`);
  console.log('  Everything else - adding movies, her link, updates - is in the app.\n');
  if (ARGS.has('--open')) openBrowser(l.host);
  host.repairMissing().then((fixed) => { if (fixed.length) broadcast({ t: 'library' }); }).catch(() => {});
  setupHttps().catch(() => {});
  setTimeout(() => tmdb.refresh().catch(() => {}), 3000);
  ensureWindowsShortcuts();
});

/**
 * Windows: point the desktop / Start menu / startup shortcuts at start-movie-night.bat
 * (in a minimised window). Earlier versions used a hidden launcher that some PCs block.
 */
function ensureWindowsShortcuts() {
  const LAUNCHER = 'bat-minimised-1';
  if (process.platform !== 'win32' || config.launcher === LAUNCHER) return;
  const script = path.join(ROOT, 'setup-shortcuts.ps1');
  if (!fs.existsSync(script)) return;
  const p = spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script],
    { cwd: ROOT, windowsHide: true, stdio: 'ignore' });
  p.on('error', () => {});
  p.on('close', (code) => {
    if (code === 0) { config.launcher = LAUNCHER; saveConfig(); console.log('  Desktop and startup shortcuts updated.'); }
  });
}
