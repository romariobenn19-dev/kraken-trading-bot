/**
 * Movie Night - host-only features (only reachable from the laptop itself).
 *
 *  - Browse the laptop's folders and pick a movie file
 *  - Convert movies in the background (one at a time) with live progress
 *  - Delete movies
 *  - Check for and install app updates from GitHub
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const subtitles = require('./subtitles');
const createWatcher = require('./watchfolder');

const VIDEO_EXT = new Set(['.mp4', '.mkv', '.avi', '.mov', '.m4v', '.wmv', '.webm', '.ts', '.m2ts', '.mpg', '.mpeg', '.flv']);

// Files that make up the app. The updater also uses the list published in the
// new version's package.json (movieNight.files), so files added later are never missed.
const APP_FILES = [
  'server.js', 'host.js', 'prepare.js', 'subtitles.js', 'watchfolder.js', 'features.js', 'tmdb.js', 'public/series.js', 'public/home.js', 'public/together.js', 'package.json', 'README.md',
  'setup.bat', 'setup-helper.ps1', 'setup-shortcuts.ps1', 'start-movie-night.bat', 'prepare-movie.bat',
  'public/index.html', 'public/app.js', 'public/art.js', 'public/style.css', 'public/icon.png', 'public/icon.ico',
  'public/manifest.webmanifest', 'public/sw.js', 'public/offline.html', 'public/icon-192.png', 'public/icon-512.png',
  'public/icon-maskable-512.png', 'public/apple-touch-icon.png',
];

/** "Resident.Evil.2026.REPACK.1080p.AMZN.WEB-DL" -> "Resident Evil (2026)" */
function cleanTitle(file) {
  // "[SubsPlease] Frieren - 14 (1080p) [ABCD1234]" -> "Frieren - 14"; release-group tags in [] are dropped.
  let n = path.basename(file, path.extname(file)).replace(/\[[^\]]*\]/g, ' ').replace(/[._]+/g, ' ').replace(/\s+/g, ' ').trim();
  const year = n.match(/^(.*?)[\s([]*((?:19|20)\d{2})(?=[\s)\]]|$)/);
  if (year && year[1].trim()) return `${year[1].trim().replace(/[\s-]+$/, '')} (${year[2]})`;
  n = n.split(/\b(?:2160p|1080p|720p|480p|4k|uhd|hdr|web[- ]?dl|webrip|bluray|blu[- ]?ray|brrip|hdrip|dvdrip|x264|x265|h ?264|h ?265|hevc|remux|repack|proper|extended)\b/i)[0];
  return n.replace(/[\s-[(]+$/, '').trim() || path.basename(file, path.extname(file));
}

function slugify(s) {
  return s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'movie';
}

/** Find ffmpeg/ffprobe even if this process started before they were added to PATH. */
function findTool(name) {
  if (process.env[name.toUpperCase()]) return process.env[name.toUpperCase()];
  if (!spawnSync(name, ['-version'], { windowsHide: true }).error) return name;
  const candidates = [];
  if (process.platform === 'win32') {
    const local = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    candidates.push(path.join(local, 'Microsoft', 'WinGet', 'Links', `${name}.exe`));
    const pkgs = path.join(local, 'Microsoft', 'WinGet', 'Packages');
    try {
      for (const d of fs.readdirSync(pkgs)) {
        if (!/ffmpeg/i.test(d)) continue;
        for (const sub of fs.readdirSync(path.join(pkgs, d))) {
          candidates.push(path.join(pkgs, d, sub, 'bin', `${name}.exe`));
        }
      }
    } catch { /* no winget packages folder */ }
  }
  return candidates.find((c) => fs.existsSync(c)) || name;
}

function compareVersions(a, b) {
  const pa = String(a).split('.').map(Number), pb = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  }
  return 0;
}

/** Only plain relative paths inside the app folder (no "..", no absolute paths). */
function isSafeAppPath(f) {
  return typeof f === 'string' && /^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/.test(f) && !f.split('/').includes('..');
}

function readBody(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new Error('Request too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

module.exports = function createHost({ ROOT, LIBRARY, config, saveConfig, sendToHosts, libraryChanged, links, onMovieDeleted, restart, savePersonal, openPhotosFolder, httpsStatus, retryHttps, tmdb, onMovieReady }) {
  const FFMPEG = findTool('ffmpeg');
  const FFPROBE = findTool('ffprobe');
  const version = () => JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;

  // ---- Conversion queue ----------------------------------------------------------
  // Each movie is converted in two stages:
  //   'watch'   - the version you watch (playable within about a minute)
  //   'backups' - the lighter versions for Wi-Fi dips
  // All movies' 'watch' stages run before any 'backups', so everything you add becomes
  // watchable quickly. A movie someone taps "watch now" on jumps the queue and may run
  // alongside the current conversion.
  const jobs = [];
  const runningJobs = new Set();
  const MAX_PARALLEL = 2;
  let nextJobId = 1;
  let lastPush = 0;

  function publicJobs() {
    return jobs.map(({ id, title, file, status, progress, error, startedAt, finishedAt, ready, source, auto, phase, priority, complete }) =>
      ({ id, title, file: path.basename(file), status, progress, error, startedAt, finishedAt, ready: !!ready, source: source || null, auto: !!auto, phase, priority: !!priority, complete: !!complete }));
  }
  function pushJobs(force) {
    const now = Date.now();
    if (!force && now - lastPush < 700) return;
    lastPush = now;
    sendToHosts({ t: 'jobs', jobs: publicJobs() });
  }

  function enqueue({ file, title, denoise, skipAvc, skipHevc, quick, subtitles: subs, auto, phase = 'watch' }) {
    const job = {
      id: nextJobId++, file, title, movieId: slugify(title), denoise: !!denoise, skipAvc: !!skipAvc, skipHevc: !!skipHevc, quick: !!quick,
      subtitles: subs, auto: !!auto, phase, priority: false,
      status: 'queued', progress: null, error: null, log: '', startedAt: null, finishedAt: null,
    };
    jobs.push(job);
    // Keep the list short: drop old finished jobs.
    while (jobs.length > 30) {
      const i = jobs.findIndex((j) => ['done', 'failed', 'cancelled'].includes(j.status));
      if (i < 0) break;
      jobs.splice(i, 1);
    }
    runNext();
    pushJobs(true);
    if (phase === 'watch') libraryChanged(); // it appears on both screens straight away
    return job;
  }

  function nextQueued() {
    const q = jobs.filter((j) => j.status === 'queued');
    return q.find((j) => j.priority) || q.find((j) => j.phase === 'watch') || q[0];
  }

  function runNext() {
    for (;;) {
      const job = nextQueued();
      if (!job) return;
      // One conversion at a time, plus one extra for a "watch this now" request.
      if (runningJobs.size >= (job.priority ? MAX_PARALLEL : 1)) return;
      start(job);
    }
  }

  function start(job) {
    runningJobs.add(job);
    job.status = 'running';
    job.startedAt = Date.now();
    const args = [path.join(ROOT, 'prepare.js'), job.file, '--title', job.title, '--progress-json'];
    if (job.denoise) args.push('--denoise');
    if (job.skipAvc) args.push('--no-avc');
    if (job.skipHevc) args.push('--no-hevc');
    if (job.quick) args.push('--quick');
    if (job.phase === 'watch') args.push('--first-only');
    if (job.phase === 'backups') args.push('--keep-subs');
    if (job.subtitles && job.phase === 'watch') args.push('--subtitles', JSON.stringify(job.subtitles));
    const p = spawn(process.execPath, args, {
      cwd: ROOT, windowsHide: true,
      env: { ...process.env, LIBRARY, FFMPEG, FFPROBE },
    });
    job.proc = p;
    let buf = '';
    p.stdout.on('data', (chunk) => {
      buf += chunk;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (line.startsWith('@@')) {
          try {
            const ev = JSON.parse(line.slice(2));
            if (ev.done) { job.resultId = ev.id; job.complete = !!ev.complete; }
            else if (ev.source) job.source = ev.source;
            else if (ev.ready) {
              // The movie is watchable now (it may still be converting ahead of you).
              const first = !job.ready;
              job.ready = true;
              libraryChanged();
              if (first && job.phase === 'watch' && onMovieReady) onMovieReady(job.title, ev.id || job.movieId);
              pushJobs(first);
            } else job.progress = ev;
            pushJobs();
          } catch { /* ignore */ }
        } else if (line) {
          job.log = (job.log + '\n' + line).slice(-3000);
        }
      }
    });
    p.stderr.on('data', (c) => { job.log = (job.log + c).slice(-3000); });
    p.on('close', (code) => {
      job.finishedAt = Date.now();
      delete job.proc;
      if (job.status === 'cancelled') { /* user stopped it */ }
      else if (code === 0) job.status = 'done';
      else {
        job.status = 'failed';
        const m = job.log.match(/Error: ([\s\S]*)$/);
        job.error = (m ? m[1] : job.log).trim().split('\n').slice(0, 6).join('\n').slice(0, 600) || `Stopped (code ${code})`;
      }
      runningJobs.delete(job);
      // Watchable version done: queue its backups (after every other movie's watchable version).
      if (job.status === 'done' && job.phase === 'watch' && !job.complete) {
        enqueue({ file: job.file, title: job.title, denoise: job.denoise, skipAvc: job.skipAvc, skipHevc: job.skipHevc, quick: job.quick, auto: job.auto, phase: 'backups' });
      }
      pushJobs(true);
      libraryChanged();
      runNext();
    });
  }

  /** Someone tapped a movie that isn't ready yet: start it now. */
  function prioritize(movieId) {
    const job = jobs.find((j) => j.movieId === movieId && j.phase === 'watch' && (j.status === 'queued' || j.status === 'running'));
    if (!job) return null;
    if (job.status === 'queued') { job.priority = true; runNext(); pushJobs(true); libraryChanged(); }
    return { title: job.title, status: job.status };
  }

  /** Movies added but not watchable yet, so both screens can show them straight away. */
  function pendingMovies() {
    return jobs.filter((j) => j.phase === 'watch' && (j.status === 'queued' || j.status === 'running') && !j.ready)
      .map((j) => ({ id: j.movieId, title: j.title, pending: true, state: j.status, preparedAt: new Date(j.startedAt || Date.now()).toISOString() }));
  }

  function cancel(id) {
    const job = jobs.find((j) => j.id === id);
    if (!job) return false;
    if (job.status === 'queued') job.status = 'cancelled';
    else if (job.status === 'running' && job.proc) {
      job.status = 'cancelled';
      job.proc.kill();
    }
    pushJobs(true);
    libraryChanged();
    return true;
  }

  // ---- Folder browsing -------------------------------------------------------------
  function places() {
    const home = os.homedir();
    const out = [];
    for (const [label, dir] of [['Downloads', 'Downloads'], ['Videos', 'Videos'], ['Desktop', 'Desktop'], ['Documents', 'Documents']]) {
      const p = path.join(home, dir);
      if (fs.existsSync(p)) out.push({ label, path: p });
    }
    // OneDrive-redirected folders (common on Windows).
    for (const od of ['OneDrive', ...safeList(home).filter((n) => n.startsWith('OneDrive - '))]) {
      for (const dir of ['Desktop', 'Videos', 'Documents']) {
        const p = path.join(home, od, dir);
        if (fs.existsSync(p) && !out.some((o) => o.path === p)) out.push({ label: `${dir} (OneDrive)`, path: p });
      }
    }
    if (process.platform === 'win32') {
      for (const letter of 'CDEFGHIJKLMNOPQRSTUVWXYZ') {
        const p = `${letter}:\\`;
        if (fs.existsSync(p)) out.push({ label: `${letter}: drive`, path: p });
      }
    } else {
      out.push({ label: 'Home', path: home });
    }
    return out;
  }
  function safeList(dir) { try { return fs.readdirSync(dir); } catch { return []; } }

  function browse(dir, kind = 'movie') {
    const wanted = kind === 'subs' ? subtitles.SUB_EXT : VIDEO_EXT;
    const entries = [];
    let list;
    try { list = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) {
      return { error: `Can't open this folder (${e.code || e.message}).` };
    }
    for (const d of list) {
      if (d.name.startsWith('.') || d.name.startsWith('$') || d.name === 'System Volume Information') continue;
      const full = path.join(dir, d.name);
      if (path.resolve(full) === path.resolve(LIBRARY)) continue;
      if (d.isDirectory()) entries.push({ type: 'dir', name: d.name, path: full });
      else if (d.isFile() && wanted.has(path.extname(d.name).toLowerCase())) {
        let size = 0;
        try { size = fs.statSync(full).size; } catch { /* ignore */ }
        entries.push({ type: 'file', name: d.name, path: full, size, title: cleanTitle(d.name) });
      }
    }
    entries.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name, undefined, { numeric: true }) : a.type === 'dir' ? -1 : 1));
    const parent = path.dirname(dir);
    return { dir, parent: parent === dir ? null : parent, entries };
  }

  // ---- Updates -----------------------------------------------------------------------
  const src = () => {
    if (config.updateSource) return config.updateSource; // optional override in config.json
    try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).movieNight.updateSource || {}; } catch { return {}; }
  };
  const rawBase = () => `https://raw.githubusercontent.com/${src().repo}/${src().branch}/${src().path ? `${src().path}/` : ''}`;

  async function fetchText(url) {
    // Unique query string so GitHub's 5-minute cache doesn't hand out an old copy right after a release.
    const r = await fetch(`${url}?v=${Date.now()}`, { cache: 'no-store', headers: { 'Cache-Control': 'no-cache' } });
    if (!r.ok) throw new Error(`${r.status} for ${url}`);
    return Buffer.from(await r.arrayBuffer());
  }

  async function checkUpdate() {
    if (!src().repo) return { current: version(), latest: null, newer: false };
    const pkg = JSON.parse((await fetchText(rawBase() + 'package.json')).toString('utf8'));
    return { current: version(), latest: pkg.version, newer: compareVersions(pkg.version, version()) > 0 };
  }

  /** Move src over dest, retrying while Windows reports the file busy; copy as a last resort. */
  async function replaceFile(src, dest) {
    for (let i = 0; i < 25; i++) {
      try { fs.renameSync(src, dest); return true; } catch (e) {
        if (!['EPERM', 'EBUSY', 'EACCES'].includes(e.code)) throw e;
        await new Promise((r) => setTimeout(r, 100 + i * 30));
      }
    }
    try { fs.copyFileSync(src, dest); fs.rmSync(src, { force: true }); return true; } catch { return false; }
  }

  async function applyUpdate() {
    if (runningJobs.size) throw new Error('A movie is still converting. Try again when it has finished.');
    const info = await checkUpdate();
    if (!info.newer) return { ...info, updated: false };
    // Download everything first; only write if every file arrived.
    const files = {};
    let remoteList = [];
    try { remoteList = JSON.parse((await fetchText(rawBase() + 'package.json')).toString('utf8')).movieNight.files || []; } catch { /* older layout */ }
    for (const f of new Set([...APP_FILES, ...remoteList.filter(isSafeAppPath)])) {
      try { files[f] = await fetchText(rawBase() + f); } catch (e) {
        if (/^404/.test(e.message)) continue; // file not in this version
        throw e;
      }
    }
    if (!files['server.js'] || !files['package.json']) throw new Error('Update download was incomplete - nothing was changed.');
    const oldDeps = JSON.stringify(JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).dependencies);
    // 1. Write every new file next to the old one as "<name>.new".
    const order = Object.keys(files).filter((f) => f !== 'package.json').concat('package.json'); // version number last
    for (const f of order) {
      const target = path.join(ROOT, f);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      // Windows scripts need Windows line endings.
      const out = /\.(bat|cmd|vbs|ps1)$/i.test(f) ? Buffer.from(files[f].toString('utf8').replace(/\r?\n/g, '\r\n')) : files[f];
      fs.writeFileSync(target + '.new', out);
    }
    // 2. Swap them in. Windows sometimes holds a file for a moment (antivirus scanning it),
    //    so retry; anything still stuck is finished automatically on the next start.
    const stuck = [];
    for (const f of order) {
      if (!(await replaceFile(path.join(ROOT, f) + '.new', path.join(ROOT, f)))) stuck.push(f);
    }
    if (stuck.length) {
      setTimeout(restart, 300); // the next start finishes the swap (nothing holds the files then)
      return { ...info, updated: true, finishing: stuck };
    }
    const newDeps = JSON.stringify(JSON.parse(files['package.json'].toString('utf8')).dependencies);
    if (newDeps !== oldDeps) {
      const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
      spawnSync(npm, ['install', '--omit=dev', '--no-audit', '--no-fund'], { cwd: ROOT, windowsHide: true, shell: process.platform === 'win32' });
    }
    setTimeout(restart, 300);
    return { ...info, updated: true };
  }

  // ---- HTTP API (/api/host/...) ----------------------------------------------------
  async function handle(req, res, pathname, url) {
    try {
      if (req.method === 'GET' && pathname === '/api/host/info') {
        return json(res, 200, {
          version: version(), links: links(), https: httpsStatus(), ...hevcDevices(), tmdbKey: tmdb && tmdb.hasKey(),
          ffmpegFound: !spawnSync(FFMPEG, ['-version'], { windowsHide: true }).error,
          freeGb: freeSpaceGb(LIBRARY), watchFolder: watcher.folder(), recentError: recentError(),
        });
      }
      if (req.method === 'GET' && pathname === '/api/host/browse') {
        const dir = url.searchParams.get('dir');
        if (!dir) return json(res, 200, { dir: null, places: places(), entries: [] });
        return json(res, 200, { ...browse(dir, url.searchParams.get('kind') || 'movie'), places: places() });
      }
      if (req.method === 'GET' && pathname === '/api/host/jobs') return json(res, 200, publicJobs());
      if (req.method === 'GET' && pathname === '/api/host/subsources') {
        // ?file=<movie file>  or  ?id=<movie in the library> (uses its original file)
        let file = url.searchParams.get('file');
        const id = url.searchParams.get('id');
        if (id) {
          if (!/^[a-z0-9-]+$/.test(id)) return json(res, 400, { error: 'Bad movie id' });
          try { file = JSON.parse(fs.readFileSync(path.join(LIBRARY, id, '.source.json'), 'utf8')).file; } catch { file = null; }
        }
        if (!file || !fs.existsSync(file)) return json(res, 200, { tracks: [], files: [], defaults: [], sourceMissing: true });
        const src = subtitles.findSubtitleSources(file, FFPROBE);
        return json(res, 200, { ...src, defaults: subtitles.defaultChoice(src), movieFile: file });
      }
      if (req.method === 'GET' && pathname === '/api/host/update') return json(res, 200, await checkUpdate());

      if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });
      const body = await readBody(req);

      if (pathname === '/api/host/prepare') {
        const file = String(body.file || '');
        if (!VIDEO_EXT.has(path.extname(file).toLowerCase()) || !fs.existsSync(file)) {
          return json(res, 400, { error: 'That file isn\'t a movie I can read.' });
        }
        const title = String(body.title || '').trim().slice(0, 120) || cleanTitle(file);
        const job = enqueue({ file, title, denoise: body.denoise, skipAvc: body.skipAvc, quick: body.quick !== false,
          subtitles: Array.isArray(body.subtitles) ? subtitles.sanitizeItems(body.subtitles) : null });
        return json(res, 200, { id: job.id });
      }
      if (pathname === '/api/host/add-subs') {
        const id = String(body.id || '');
        if (!/^[a-z0-9-]+$/.test(id) || !fs.existsSync(path.join(LIBRARY, id, 'meta.json'))) return json(res, 400, { error: 'Movie not found' });
        const items = subtitles.sanitizeItems(body.items);
        if (!items.length) return json(res, 400, { error: 'Pick at least one subtitle.' });
        let movieFile = null;
        try { movieFile = JSON.parse(fs.readFileSync(path.join(LIBRARY, id, '.source.json'), 'utf8')).file; } catch { /* only files possible */ }
        if (items.some((i) => i.type === 'track') && (!movieFile || !fs.existsSync(movieFile))) {
          return json(res, 400, { error: 'The original movie file has moved or been deleted, so its built-in subtitles can\'t be read. Choose a subtitle file instead.' });
        }
        const made = await subtitles.convertSubtitles(items, movieFile, path.join(LIBRARY, id), FFMPEG);
        if (!made.length) return json(res, 400, { error: 'Those subtitles couldn\'t be read. Try a different file or track.' });
        subtitles.addToMeta(path.join(LIBRARY, id), made);
        libraryChanged();
        return json(res, 200, { added: made });
      }
      if (pathname === '/api/host/remove-subs') {
        const id = String(body.id || '');
        const file = String(body.file || '');
        if (!/^[a-z0-9-]+$/.test(id) || !/^subs\/[a-z0-9-]+\.vtt$|^subs\.vtt$/.test(file)) return json(res, 400, { error: 'Bad request' });
        const metaFile = path.join(LIBRARY, id, 'meta.json');
        const meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
        meta.subtitles = subtitles.normalizeMetaSubs(meta.subtitles).filter((x) => x.file !== file);
        fs.writeFileSync(metaFile, JSON.stringify(meta, null, 2));
        fs.rmSync(path.join(LIBRARY, id, file), { force: true });
        libraryChanged();
        return json(res, 200, {});
      }
      if (pathname === '/api/host/cancel') return json(res, cancel(Number(body.id)) ? 200 : 404, {});
      if (pathname === '/api/host/clear') {
        for (let i = jobs.length - 1; i >= 0; i--) if (['done', 'failed', 'cancelled'].includes(jobs[i].status)) jobs.splice(i, 1);
        pushJobs(true);
        return json(res, 200, {});
      }
      if (pathname === '/api/host/delete') {
        const id = String(body.id || '');
        if (!/^[a-z0-9-]+$/.test(id)) return json(res, 400, { error: 'Bad movie id' });
        if ([...runningJobs].some((j) => j.movieId === id)) return json(res, 409, { error: 'That movie is still converting.' });
        fs.rmSync(path.join(LIBRARY, id), { recursive: true, force: true });
        onMovieDeleted(id);
        libraryChanged();
        return json(res, 200, {});
      }
      if (pathname === '/api/host/update') return json(res, 200, await applyUpdate());
      if (pathname === '/api/host/personal') { savePersonal(body); return json(res, 200, {}); }
      if (pathname === '/api/host/open-photos') return json(res, 200, { folder: openPhotosFolder() });
      if (pathname === '/api/host/tmdb') {
        config.tmdbKey = String(body.key || '').trim().slice(0, 400);
        saveConfig();
        if (!config.tmdbKey) return json(res, 200, { ok: true, removed: true });
        const r = await tmdb.refresh(true);
        if (!r.ok && r.reason === 'bad-key') return json(res, 400, { error: 'TMDB didn\'t accept that key. Copy the "API Key" (or "API Read Access Token") again.' });
        return json(res, 200, r);
      }
      if (pathname === '/api/host/watch-folder') {
        const dir = path.resolve(String(body.dir || ''));
        try { fs.mkdirSync(dir, { recursive: true }); } catch { return json(res, 400, { error: "Can't use that folder." }); }
        if (path.resolve(dir) === path.resolve(LIBRARY) || dir.startsWith(path.resolve(LIBRARY) + path.sep)) return json(res, 400, { error: "That's Movie Night's own library folder. Pick a different one." });
        watcher.setFolder(dir);
        return json(res, 200, { folder: dir });
      }
      if (pathname === '/api/host/open-watch-folder') {
        fs.mkdirSync(watcher.folder(), { recursive: true });
        const opener = process.platform === 'win32' ? 'explorer' : process.platform === 'darwin' ? 'open' : 'xdg-open';
        try { spawn(opener, [watcher.folder()], { detached: true, stdio: 'ignore' }).on('error', () => {}).unref(); } catch { /* headless */ }
        return json(res, 200, { folder: watcher.folder() });
      }
      if (pathname === '/api/host/https-retry') { await retryHttps(); return json(res, 200, httpsStatus()); }
      return json(res, 404, { error: 'Not found' });
    } catch (e) {
      return json(res, 500, { error: e.message });
    }
  }

  function freeSpaceGb(dir) {
    try {
      const st = fs.statfsSync(dir);
      return Math.round((st.bavail * st.bsize) / 1e8) / 10;
    } catch { return null; }
  }

  /**
   * H.264 backups can be skipped only if every device you've used lately (her tablet,
   * your phone, the laptop's browser...) can play HEVC, including at least one that isn't the laptop.
   */
  function hevcDevices() {
    const cutoff = Date.now() - 60 * 86400000;
    const recent = Object.values(config.devices || {}).filter((d) => new Date(d.lastSeen).getTime() >= cutoff);
    const bad = recent.filter((d) => !d.hevc);
    const cannot = [...new Set(bad.filter((d) => !d.host).map((d) => `${d.name}'s device`))];
    if (bad.some((d) => d.host)) cannot.push("this laptop's browser");
    const hevcConfirmed = recent.some((d) => !d.host) && bad.length === 0;
    return { hevcConfirmed, cannotPlayHevc: cannot.length > 3 ? [...cannot.slice(0, 3), 'others'] : cannot };
  }

  function onStatus() { /* device capabilities are recorded at hello */ }

  // ---- Auto-add folder ------------------------------------------------------------------
  const watcher = createWatcher({
    LIBRARY, config, saveConfig, enqueue, cleanTitle, slugify, ffprobe: FFPROBE,
    isQueued: (f) => jobs.some((j) => j.file === f && (j.status === 'queued' || j.status === 'running')),
    skipAvcDefault: () => hevcDevices().hevcConfirmed,
    subtitleFilesAdded: async (id, items) => {
      const made = await subtitles.convertSubtitles(items, null, path.join(LIBRARY, id), FFMPEG);
      if (made.length) { subtitles.addToMeta(path.join(LIBRARY, id), made); libraryChanged(); }
      return made.length;
    },
  });
  watcher.start();

  /** On startup: if any app file is missing (e.g. an interrupted update), fetch it from GitHub. */
  async function repairMissing() {
    let list = APP_FILES;
    try { list = [...new Set([...APP_FILES, ...(JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).movieNight.files || [])])]; } catch { /* ignore */ }
    const missing = list.filter((f) => isSafeAppPath(f) && !fs.existsSync(path.join(ROOT, f)));
    if (!missing.length || !src().repo) return [];
    const fixed = [];
    for (const f of missing) {
      try {
        const data = await fetchText(rawBase() + f);
        const target = path.join(ROOT, f);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        const out = /\.(bat|cmd|vbs|ps1)$/i.test(f) ? Buffer.from(data.toString('utf8').replace(/\r?\n/g, '\r\n')) : data;
        fs.writeFileSync(target, out);
        fixed.push(f);
      } catch (e) { console.log(`  Could not restore ${f}: ${e.message}`); }
    }
    if (fixed.length) console.log(`  Restored missing files: ${fixed.join(', ')}`);
    return fixed;
  }

  /** The last problem written to error.log in the past day (shown once in the laptop's app). */
  function recentError() {
    try {
      const f = path.join(ROOT, 'error.log');
      const st = fs.statSync(f);
      if (Date.now() - st.mtimeMs > 86400000) return null;
      const all = fs.readFileSync(f, 'utf8').trim().split(/\n(?=\[\d{4}-)/);
      return { at: st.mtimeMs, text: all[all.length - 1].slice(0, 700) };
    } catch { return null; }
  }

  /**
   * Movies added before the 360p safety version existed (or whose backups were cut short
   * by a restart): queue a backups pass. Finished versions are reused, so only what's
   * missing is made.
   */
  function topUpOldMovies() {
    let ids = [];
    try { ids = fs.readdirSync(LIBRARY); } catch { return; }
    for (const id of ids) {
      try {
        const meta = JSON.parse(fs.readFileSync(path.join(LIBRARY, id, 'meta.json'), 'utf8'));
        if (meta.converting || jobs.some((j) => j.movieId === id && ['queued', 'running'].includes(j.status))) continue;
        const r = meta.renditions || [];
        const hasSafety = r.some((x) => x.height <= 400);
        if (hasSafety && !meta.partial) continue;
        if (slugify(meta.title) !== id) continue;
        const { file } = JSON.parse(fs.readFileSync(path.join(LIBRARY, id, '.source.json'), 'utf8'));
        if (!file || !fs.existsSync(file)) continue;
        const has1080 = r.some((x) => x.height >= 1000 && x.height <= 1100);
        const quick = !r.some((x) => x.height > 1100 || (has1080 && /^720p_/.test(x.dir)));
        enqueue({ file, title: meta.title, skipAvc: !meta.avc, skipHevc: !meta.hevc, quick, phase: 'backups' });
      } catch { /* not a movie folder, or no original file: leave it */ }
    }
  }
  setTimeout(topUpOldMovies, 20000).unref();

  return { handle, onStatus, publicJobs, repairMissing, prioritize, pendingMovies, isBusy: () => runningJobs.size > 0, ffmpeg: FFMPEG };
};

module.exports.cleanTitle = cleanTitle;
