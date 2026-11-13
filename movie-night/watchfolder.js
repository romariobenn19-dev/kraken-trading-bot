/**
 * Movie Night - auto-add folder.
 *
 * Movies saved into the folder (default: Videos/Movie Night) are added and converted
 * automatically. Subtitle files saved next to them are matched to the right movie or
 * episode, even if they're added later. Original files are never moved or deleted.
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const Series = require('./public/series');
const subtitles = require('./subtitles');

const VIDEO_EXT = new Set(['.mp4', '.mkv', '.avi', '.mov', '.m4v', '.wmv', '.webm', '.ts', '.m2ts', '.mpg', '.mpeg', '.flv']);
const TEMP = /\.(part|crdownload|download|tmp|!qb|!ut|partial)$/i;
const SCAN_MS = 15000;

module.exports = function createWatcher({ LIBRARY, config, saveConfig, enqueue, isQueued, cleanTitle, slugify, skipAvcDefault, subtitleFilesAdded, ffprobe = 'ffprobe', log = console.log }) {
  const defaultFolder = () => path.join(os.homedir(), 'Videos', 'Movie Night');
  const folder = () => config.watchFolder || defaultFolder();
  const seen = () => config.watched || (config.watched = {}); // path -> { size, mtime, id, subs: [] }
  const pending = new Map(); // path -> size at last scan (waiting for it to stop growing)
  let timer = null;

  function ensureFolder() {
    try { fs.mkdirSync(folder(), { recursive: true }); return true; } catch { return false; }
  }

  /** Everything in the folder and one level of subfolders (e.g. "Frieren Season 1/"). */
  function listFiles() {
    const out = [];
    const walk = (dir, depth) => {
      let entries = [];
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        if (e.name.startsWith('.')) continue;
        const full = path.join(dir, e.name);
        if (e.isDirectory() && depth < 2) walk(full, depth + 1);
        else if (e.isFile()) out.push(full);
      }
    };
    walk(folder(), 0);
    return out;
  }

  const base = (f) => path.basename(f, path.extname(f));
  const norm = (s) => String(s).toLowerCase().replace(/\[[^\]]*\]|\([^)]*\)/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();

  /** Does this subtitle file belong to this movie? */
  function matches(subFile, movieFile, videosInSameDir) {
    const sb = base(subFile).toLowerCase();
    const mb = base(movieFile).toLowerCase();
    if (sb.startsWith(mb)) return true; // Film.mkv + Film.en.srt
    const sEp = Series.parse(base(subFile).replace(/\.[a-z]{2,3}$/i, ''));
    const mEp = Series.parse(base(movieFile));
    if (sEp && mEp) return sEp.key === mEp.key && sEp.season === mEp.season && sEp.episode === mEp.episode;
    if (!sEp && !mEp && norm(cleanTitle(subFile)) === norm(cleanTitle(movieFile))) return true;
    // A folder with exactly one movie: every subtitle file in it belongs to that movie.
    return path.dirname(subFile) === path.dirname(movieFile) && videosInSameDir === 1;
  }

  function langOf(subFile) {
    const m = base(subFile).match(/[._\s-]([a-z]{2,3})$/i) || base(subFile).match(/\b(english|greek|spanish|french|german|italian|portuguese|japanese)\b/i);
    if (!m) return '';
    const t = m[1].toLowerCase();
    return { english: 'en', greek: 'el', spanish: 'es', french: 'fr', german: 'de', italian: 'it', portuguese: 'pt', japanese: 'ja' }[t] || t;
  }
  const LABELS = { en: 'English', eng: 'English', el: 'Greek', gre: 'Greek', ell: 'Greek', es: 'Spanish', spa: 'Spanish', fr: 'French', fre: 'French', de: 'German', ger: 'German', it: 'Italian', pt: 'Portuguese', ja: 'Japanese', jpn: 'Japanese' };

  function scan() {
    if (!ensureFolder()) return;
    const files = listFiles();
    const videos = files.filter((f) => VIDEO_EXT.has(path.extname(f).toLowerCase()) && !TEMP.test(f) && !/\bsample\b/i.test(base(f)));
    const subs = files.filter((f) => subtitles.SUB_EXT.has(path.extname(f).toLowerCase()) && !TEMP.test(f) && path.extname(f).toLowerCase() !== '.txt');
    const videosPerDir = new Map();
    for (const v of videos) videosPerDir.set(path.dirname(v), (videosPerDir.get(path.dirname(v)) || 0) + 1);
    const W = seen();
    let dirty = false;

    for (const v of videos) {
      let st;
      try { st = fs.statSync(v); } catch { continue; }
      if (st.size < 5 * 1024 * 1024) continue; // not a movie (or still starting to download)
      const known = W[v];
      const mySubs = subs.filter((s) => matches(s, v, videosPerDir.get(path.dirname(v))));

      if (!known) {
        // Wait until the file has stopped growing (download/copy finished).
        if (pending.get(v) !== st.size) { pending.set(v, st.size); continue; }
        pending.delete(v);
        const title = cleanTitle(v);
        const id = slugify(title);
        if (fs.existsSync(path.join(LIBRARY, id, 'meta.json')) || isQueued(v)) {
          W[v] = { size: st.size, mtime: st.mtimeMs, id, subs: mySubs };
          dirty = true;
          continue;
        }
        // Subtitles: every matching subtitle file, plus the main built-in English track if there's no file.
        const items = mySubs.map((s) => ({ type: 'file', path: s, lang: langOf(s), label: LABELS[langOf(s)] || 'Subtitles' }));
        try {
          const src = subtitles.findSubtitleSources(v, ffprobe);
          if (!items.length) items.push(...subtitles.defaultChoice(src).filter((d) => d.type === 'track'));
        } catch { /* fine without */ }
        log(`  Auto-add: ${path.basename(v)} -> "${title}"${items.length ? ` (+${items.length} subtitles)` : ''}`);
        enqueue({ file: v, title, quick: true, skipAvc: skipAvcDefault(), subtitles: items, auto: true });
        W[v] = { size: st.size, mtime: st.mtimeMs, id, subs: mySubs };
        dirty = true;
        continue;
      }

      // Already added: pick up subtitle files saved later.
      const fresh = mySubs.filter((s) => !(known.subs || []).includes(s));
      if (fresh.length && fs.existsSync(path.join(LIBRARY, known.id, 'meta.json'))) {
        known.subs = [...(known.subs || []), ...fresh];
        dirty = true;
        const items = fresh.map((s) => ({ type: 'file', path: s, lang: langOf(s), label: LABELS[langOf(s)] || 'Subtitles' }));
        subtitleFilesAdded(known.id, items).then((n) => { if (n) log(`  Auto-add: ${n} subtitle file(s) added to ${known.id}`); }).catch(() => {});
      }
    }
    // Forget files that were removed from the folder (so re-adding them works).
    for (const p of Object.keys(W)) if (!videos.includes(p) && !fs.existsSync(p)) { delete W[p]; dirty = true; }
    if (dirty) saveConfig();
  }

  function start() {
    clearInterval(timer);
    ensureFolder();
    // Files already there when this is first switched on are treated as new too.
    setTimeout(scan, 3000);
    timer = setInterval(() => { try { scan(); } catch (e) { log(`  Auto-add folder: ${e.message}`); } }, SCAN_MS);
  }

  function setFolder(dir) {
    config.watchFolder = dir;
    config.watched = {};
    pending.clear();
    saveConfig();
    start();
  }

  return { start, scan, folder, setFolder, defaultFolder };
};
