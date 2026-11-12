#!/usr/bin/env node
/**
 * Movie Night server - runs on the host laptop.
 *
 *  - Serves the web player and the prepared movies (HLS chunks) from ./library
 *  - Keeps everyone's playback in sync over a WebSocket
 *  - Pauses everyone if anyone's connection falls behind, and resumes once
 *    every viewer has a healthy buffer again
 *
 * Start:  node server.js      (or double-click start-movie-night.bat on Windows)
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');
const LIBRARY = process.env.LIBRARY || path.join(ROOT, 'library');
const CONFIG_FILE = path.join(ROOT, 'config.json');
const PORT = Number(process.env.PORT || 8080);

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
fs.mkdirSync(LIBRARY, { recursive: true });

// ---- Buffering policy ---------------------------------------------------------
const LOW_BUFFER = 1.5;                         // seconds left before we call it a stall
const RESUME_STEPS = [20, 40, 60, 90, 120];     // buffer needed to (re)start; grows after repeated stalls
const START_BUFFER = 15;

// ---- HTTP -------------------------------------------------------------------
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.m3u8': 'application/vnd.apple.mpegurl', '.m4s': 'video/iso.segment',
  '.mp4': 'video/mp4', '.vtt': 'text/vtt; charset=utf-8', '.jpg': 'image/jpeg', '.png': 'image/png',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json',
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

function isAuthorized(req, url) {
  return safeEqual(url.searchParams.get('key'), config.key) || safeEqual(parseCookies(req.headers.cookie).mn_key, config.key);
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
      fs.createReadStream(file, { start, end }).pipe(res);
      return;
    }
    res.writeHead(200, { ...headers, 'Content-Length': st.size });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
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
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end(); return; }

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

  if (pathname === '/api/movies') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(listMovies()));
    return;
  }
  if (pathname.startsWith('/library/')) {
    const file = within(LIBRARY, pathname.slice('/library/'.length));
    if (!file) { res.writeHead(403); res.end(); return; }
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
const clients = new Map(); // ws -> { id, name, role, buffer, full, stalled, ct, movieId, quality, bw, seenAt }
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
  };
}

function peers() {
  return [...clients.values()].map((c) => ({
    id: c.id, name: c.name, role: c.role, buffer: c.buffer, full: c.full, stalled: c.stalled,
    quality: c.quality, bw: c.bw, ready: c.movieId === room.movieId,
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
function hasBuffer(c, need) {
  if (c.movieId !== room.movieId) return false;
  if (Math.abs(c.ct - room.pos) > 3) return false; // hasn't caught up with the latest seek yet
  return c.full || c.buffer >= need;
}

function evaluate() {
  if (!room.movieId || !room.wantPlay || clients.size === 0) return;
  const list = [...clients.values()];
  if (!room.paused) {
    const struggling = list.filter((c) => c.movieId === room.movieId && !c.full && (c.stalled || c.buffer < LOW_BUFFER));
    if (struggling.length) {
      room.stalls++;
      setPosition(nowPos(), true);
      room.hold = { reason: 'buffering', who: struggling.map((c) => c.name) };
      changed();
    }
  } else if (room.hold) {
    const need = room.hold.reason === 'starting' ? START_BUFFER : resumeTarget();
    const waitingFor = list.filter((c) => !hasBuffer(c, need)).map((c) => c.name);
    if (!waitingFor.length) {
      room.hold = null;
      setPosition(room.pos, false);
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
      c.role = msg.role === 'host' ? 'host' : 'guest';
      send(ws, publicState());
      break;
    case 'ping':
      send(ws, { t: 'pong', c: msg.c, s: Date.now() });
      break;
    case 'load':
      if (typeof msg.movieId !== 'string') return;
      room.movieId = msg.movieId || null;
      room.wantPlay = false; room.hold = null; room.stalls = 0;
      setPosition(Number(msg.pos) || 0, true);
      changed();
      break;
    case 'play':
      if (!room.movieId) return;
      room.wantPlay = true;
      setPosition(Number.isFinite(msg.pos) ? msg.pos : room.pos, true);
      room.hold = { reason: 'starting', who: [] };
      changed();
      evaluate();
      break;
    case 'pause':
      room.wantPlay = false; room.hold = null;
      setPosition(Number.isFinite(msg.pos) ? msg.pos : nowPos(), true);
      changed();
      break;
    case 'seek':
      if (!Number.isFinite(msg.pos)) return;
      setPosition(msg.pos, true);
      room.hold = room.wantPlay ? { reason: 'starting', who: [] } : null;
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
      evaluate();
      break;
    case 'react':
      broadcast({ t: 'react', from: c.name, emoji: String(msg.emoji || '').slice(0, 8) });
      break;
    default:
  }
}

const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 });
server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname !== '/sync' || !isAuthorized(req, url)) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n'); socket.destroy(); return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws));
});

wss.on('connection', (ws) => {
  const c = { id: nextId++, name: 'Viewer', role: 'guest', buffer: 0, full: false, stalled: false, ct: 0, movieId: null, quality: '', bw: 0 };
  clients.set(ws, c);
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('message', (data) => {
    let msg;
    try { msg = JSON.parse(data); } catch { return; }
    if (msg && typeof msg.t === 'string') handle(ws, c, msg);
  });
  ws.on('close', () => {
    clients.delete(ws);
    // If someone drops while we're held waiting for them, don't wait forever.
    evaluate();
  });
});

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

server.listen(PORT, '0.0.0.0', () => {
  const { tailscale, lan } = addresses();
  const k = encodeURIComponent(config.key);
  console.log('\n  Movie Night is running.\n');
  console.log(`  You (on this laptop):   http://localhost:${PORT}/?key=${k}&role=host`);
  if (tailscale.length) {
    console.log(`  Send this to her:       http://${tailscale[0]}:${PORT}/?key=${k}`);
  } else {
    console.log('  (Tailscale not detected - install it so she can reach you from anywhere; see README.)');
  }
  for (const ip of lan) console.log(`  Same Wi-Fi only:        http://${ip}:${PORT}/?key=${k}`);
  console.log(`\n  Movies: ${listMovies().length} ready in ${LIBRARY}`);
  console.log('  Keep this window open while you watch. Ctrl+C to stop.\n');
});
