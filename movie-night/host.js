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

const VIDEO_EXT = new Set(['.mp4', '.mkv', '.avi', '.mov', '.m4v', '.wmv', '.webm', '.ts', '.m2ts', '.mpg', '.mpeg', '.flv']);

// Files that make up the app. The updater also uses the list published in the
// new version's package.json (movieNight.files), so files added later are never missed.
const APP_FILES = [
  'server.js', 'host.js', 'prepare.js', 'package.json', 'README.md',
  'setup.bat', 'setup-helper.ps1', 'setup-shortcuts.ps1', 'start-movie-night.bat', 'prepare-movie.bat',
  'public/index.html', 'public/app.js', 'public/art.js', 'public/style.css', 'public/icon.png', 'public/icon.ico',
];

/** "Resident.Evil.2026.REPACK.1080p.AMZN.WEB-DL" -> "Resident Evil (2026)" */
function cleanTitle(file) {
  let n = path.basename(file, path.extname(file)).replace(/[._]+/g, ' ').replace(/\s+/g, ' ').trim();
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

module.exports = function createHost({ ROOT, LIBRARY, config, saveConfig, sendToHosts, libraryChanged, links, onMovieDeleted, restart, savePersonal, openPhotosFolder }) {
  const FFMPEG = findTool('ffmpeg');
  const FFPROBE = findTool('ffprobe');
  const version = () => JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;

  // ---- Conversion queue ----------------------------------------------------------
  const jobs = [];
  let running = null;
  let nextJobId = 1;
  let lastPush = 0;

  function publicJobs() {
    return jobs.map(({ id, title, file, status, progress, error, startedAt, finishedAt }) =>
      ({ id, title, file: path.basename(file), status, progress, error, startedAt, finishedAt }));
  }
  function pushJobs(force) {
    const now = Date.now();
    if (!force && now - lastPush < 700) return;
    lastPush = now;
    sendToHosts({ t: 'jobs', jobs: publicJobs() });
  }

  function enqueue({ file, title, denoise, skipAvc }) {
    const job = {
      id: nextJobId++, file, title, denoise: !!denoise, skipAvc: !!skipAvc,
      status: 'queued', progress: null, error: null, log: '', startedAt: null, finishedAt: null,
    };
    jobs.push(job);
    // Keep the list short: drop old finished jobs.
    while (jobs.length > 12) {
      const i = jobs.findIndex((j) => ['done', 'failed', 'cancelled'].includes(j.status));
      if (i < 0) break;
      jobs.splice(i, 1);
    }
    runNext();
    pushJobs(true);
    return job;
  }

  function runNext() {
    if (running) return;
    const job = jobs.find((j) => j.status === 'queued');
    if (!job) return;
    running = job;
    job.status = 'running';
    job.startedAt = Date.now();
    const args = [path.join(ROOT, 'prepare.js'), job.file, '--title', job.title, '--progress-json'];
    if (job.denoise) args.push('--denoise');
    if (job.skipAvc) args.push('--no-avc');
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
            if (ev.done) job.resultId = ev.id;
            else job.progress = ev;
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
      running = null;
      pushJobs(true);
      if (job.status === 'done') libraryChanged();
      runNext();
    });
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

  function browse(dir) {
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
      else if (d.isFile() && VIDEO_EXT.has(path.extname(d.name).toLowerCase())) {
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

  async function applyUpdate() {
    if (running) throw new Error('A movie is still converting. Try again when it has finished.');
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
    for (const [f, data] of Object.entries(files)) {
      const target = path.join(ROOT, f);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      // Windows scripts need Windows line endings.
      const out = /\.(bat|cmd|vbs|ps1)$/i.test(f) ? Buffer.from(data.toString('utf8').replace(/\r?\n/g, '\r\n')) : data;
      fs.writeFileSync(target + '.new', out);
      fs.renameSync(target + '.new', target);
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
          version: version(), links: links(), hevcConfirmed: !!config.hevcConfirmed,
          ffmpegFound: !spawnSync(FFMPEG, ['-version'], { windowsHide: true }).error,
          freeGb: freeSpaceGb(LIBRARY),
        });
      }
      if (req.method === 'GET' && pathname === '/api/host/browse') {
        const dir = url.searchParams.get('dir');
        if (!dir) return json(res, 200, { dir: null, places: places(), entries: [] });
        return json(res, 200, { ...browse(dir), places: places() });
      }
      if (req.method === 'GET' && pathname === '/api/host/jobs') return json(res, 200, publicJobs());
      if (req.method === 'GET' && pathname === '/api/host/update') return json(res, 200, await checkUpdate());

      if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });
      const body = await readBody(req);

      if (pathname === '/api/host/prepare') {
        const file = String(body.file || '');
        if (!VIDEO_EXT.has(path.extname(file).toLowerCase()) || !fs.existsSync(file)) {
          return json(res, 400, { error: 'That file isn\'t a movie I can read.' });
        }
        const title = String(body.title || '').trim().slice(0, 120) || cleanTitle(file);
        const job = enqueue({ file, title, denoise: body.denoise, skipAvc: body.skipAvc });
        return json(res, 200, { id: job.id });
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
        if (running && slugify(running.title) === id) return json(res, 409, { error: 'That movie is still converting.' });
        fs.rmSync(path.join(LIBRARY, id), { recursive: true, force: true });
        onMovieDeleted(id);
        libraryChanged();
        return json(res, 200, {});
      }
      if (pathname === '/api/host/update') return json(res, 200, await applyUpdate());
      if (pathname === '/api/host/personal') { savePersonal(body); return json(res, 200, {}); }
      if (pathname === '/api/host/open-photos') return json(res, 200, { folder: openPhotosFolder() });
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

  /** Remember once her device has played HEVC smoothly, so H.264 backups can be skipped by default. */
  function onStatus(client, msg) {
    if (config.hevcConfirmed || client.isHost) return;
    if (msg.codec === 'hevc' && !msg.stalled && Number(msg.ct) > 20) {
      config.hevcConfirmed = true;
      saveConfig();
    }
  }

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

  return { handle, onStatus, publicJobs, repairMissing, isBusy: () => !!running, ffmpeg: FFMPEG };
};

module.exports.cleanTitle = cleanTitle;
