/**
 * Movie Night - subtitles.
 *
 *  findSubtitleSources(movieFile)  -> subtitle tracks inside the file + subtitle files next to it
 *  convertSubtitles(items, ...)    -> WebVTT files in <movie>/subs/, returns [{ file, label, lang }]
 *  addToMeta(movieDir, list)       -> merge into the movie's meta.json
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const SUB_EXT = new Set(['.srt', '.vtt', '.ass', '.ssa', '.sub', '.txt']);
const TEXT_CODECS = new Set(['subrip', 'srt', 'ass', 'ssa', 'webvtt', 'mov_text', 'text', 'microdvd', 'subviewer', 'stl', 'eia_608']);
const PICTURE_CODECS = new Set(['hdmv_pgs_subtitle', 'dvd_subtitle', 'dvb_subtitle', 'xsub', 'dvb_teletext']);

const LANGS = {
  en: 'English', eng: 'English', el: 'Greek', ell: 'Greek', gre: 'Greek', es: 'Spanish', spa: 'Spanish', fr: 'French', fre: 'French', fra: 'French',
  de: 'German', ger: 'German', deu: 'German', it: 'Italian', ita: 'Italian', pt: 'Portuguese', por: 'Portuguese', ja: 'Japanese', jpn: 'Japanese',
  nl: 'Dutch', dut: 'Dutch', nld: 'Dutch', ru: 'Russian', rus: 'Russian', ar: 'Arabic', ara: 'Arabic', zh: 'Chinese', chi: 'Chinese', zho: 'Chinese',
  ko: 'Korean', kor: 'Korean', tr: 'Turkish', tur: 'Turkish', pl: 'Polish', pol: 'Polish', sv: 'Swedish', swe: 'Swedish', ro: 'Romanian', rum: 'Romanian',
};
const TWO = { eng: 'en', ell: 'el', gre: 'el', spa: 'es', fre: 'fr', fra: 'fr', ger: 'de', deu: 'de', ita: 'it', por: 'pt', jpn: 'ja', dut: 'nl', nld: 'nl',
  rus: 'ru', ara: 'ar', chi: 'zh', zho: 'zh', kor: 'ko', tur: 'tr', pol: 'pl', swe: 'sv', rum: 'ro' };

const normLang = (l) => { l = String(l || '').toLowerCase(); return TWO[l] || (l.length === 2 ? l : l === 'und' ? '' : l.slice(0, 3)); };
const langName = (l) => LANGS[String(l || '').toLowerCase()] || (l ? String(l).toUpperCase() : '');
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'subs';

/** Subtitle tracks inside a movie file, plus subtitle files beside it (or in a Subs folder). */
function findSubtitleSources(movieFile, ffprobe = 'ffprobe') {
  const tracks = [];
  const r = spawnSync(ffprobe, ['-v', 'error', '-print_format', 'json', '-show_streams', '-select_streams', 's', movieFile],
    { encoding: 'utf8', windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
  let streams = [];
  try { streams = JSON.parse(r.stdout).streams || []; } catch { /* not readable */ }
  streams.forEach((st, n) => {
    const tags = st.tags || {};
    const lang = normLang(tags.language);
    const title = tags.title || '';
    const disp = st.disposition || {};
    tracks.push({
      type: 'track', stream: st.index, n, codec: st.codec_name, lang, title,
      forced: !!disp.forced, isDefault: !!disp.default,
      textBased: TEXT_CODECS.has(st.codec_name) || !PICTURE_CODECS.has(st.codec_name),
      label: [langName(lang) || `Track ${n + 1}`, title && title.toLowerCase() !== langName(lang).toLowerCase() ? title : ''].filter(Boolean).join(' · '),
    });
  });

  const files = [];
  const dir = path.dirname(movieFile);
  const base = path.basename(movieFile, path.extname(movieFile)).toLowerCase();
  const consider = (full, nameForLang) => {
    if (!SUB_EXT.has(path.extname(full).toLowerCase())) return;
    const stem = path.basename(nameForLang, path.extname(nameForLang));
    const parts = stem.split('.');
    const guess = parts.length > 1 ? normLang(parts[parts.length - 1]) : '';
    const lang = LANGS[guess] ? guess : '';
    files.push({ type: 'file', path: full, name: path.basename(full), lang, label: langName(lang) || 'Subtitles' });
  };
  try {
    for (const f of fs.readdirSync(dir)) {
      if (f.toLowerCase().startsWith(base)) consider(path.join(dir, f), f);
    }
  } catch { /* unreadable folder */ }
  for (const sub of ['Subs', 'subs', 'Subtitles', 'subtitles']) {
    const d = path.join(dir, sub);
    try {
      for (const f of fs.readdirSync(d)) {
        const full = path.join(d, f);
        if (fs.statSync(full).isDirectory() && f.toLowerCase().startsWith(base)) {
          for (const g of fs.readdirSync(full)) consider(path.join(full, g), g);  // Subs/<Movie>/2_English.srt
        } else if (f.toLowerCase().startsWith(base) || SUB_EXT.has(path.extname(f).toLowerCase())) consider(full, f);
      }
    } catch { /* no such folder */ }
  }
  return { tracks, files };
}

/** Which ones to tick by default: the main English track (not "signs & songs"/forced), else the first usable one. */
function defaultChoice(sources) {
  const all = [...sources.files, ...sources.tracks.filter((t) => t.textBased)];
  const full = (x) => !x.forced && !/sign|song|forced|commentary/i.test(`${x.title || ''} ${x.name || ''}`);
  const pick = all.find((x) => x.lang === 'en' && full(x)) || all.find((x) => x.lang === 'en') || all.find(full) || all[0];
  return pick ? [pick] : [];
}

function isUtf8(buf) {
  try { new TextDecoder('utf-8', { fatal: true }).decode(buf); return true; } catch { return false; }
}

function run(ffmpeg, args) {
  return new Promise((resolve, reject) => {
    let err = '';
    const p = spawn(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { windowsHide: true });
    p.stderr.on('data', (d) => { err = (err + d).slice(-2000); });
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(err.trim() || `ffmpeg exited with ${code}`))));
  });
}

/**
 * Convert chosen subtitles to WebVTT inside <outDir>/subs/.
 * items: [{ type:'track', stream, label, lang } | { type:'file', path, label, lang }]
 */
async function convertSubtitles(items, movieFile, outDir, ffmpeg = 'ffmpeg', log = () => {}) {
  const subsDir = path.join(outDir, 'subs');
  fs.mkdirSync(subsDir, { recursive: true });
  // Give every item its output file name first.
  const planned = [];
  for (const it of items) {
    const label = String(it.label || langName(it.lang) || 'Subtitles').slice(0, 40);
    const lang = normLang(it.lang) || 'und';
    let name = `${slug(label)}.vtt`;
    for (let i = 2; planned.some((d) => d.name === name); i++) name = `${slug(label)}-${i}.vtt`;
    planned.push({ it, label, lang, name, out: path.join(subsDir, name) });
  }
  const failed = new Set();
  // Built-in tracks: ONE read of the movie for all of them (subtitles are spread through
  // the whole file, so each separate extraction would read the entire file again).
  const tracks = planned.filter((p) => p.it.type === 'track' && Number.isInteger(p.it.stream));
  if (tracks.length) {
    const args = ['-i', movieFile];
    for (const t of tracks) args.push('-map', `0:${t.it.stream}`, '-f', 'webvtt', t.out);
    try { await run(ffmpeg, args); } catch (e) {
      // One bad track shouldn't sink the others: retry them one at a time.
      for (const t of tracks) {
        try { await run(ffmpeg, ['-i', movieFile, '-map', `0:${t.it.stream}`, '-f', 'webvtt', t.out]); } catch (e2) { failed.add(t); log(`  Could not use subtitles "${t.label}": ${e2.message.split('\n')[0]}`); }
      }
    }
  }
  for (const p of planned.filter((x) => x.it.type !== 'track')) {
    try {
      const src = path.resolve(String(p.it.path));
      if (!SUB_EXT.has(path.extname(src).toLowerCase()) || !fs.existsSync(src)) throw new Error('subtitle file not found');
      // Older .srt files are often not UTF-8 (accents/Greek would come out garbled).
      const raw = fs.readFileSync(src);
      const enc = isUtf8(raw) ? [] : ['-sub_charenc', p.lang === 'el' ? 'CP1253' : p.lang === 'ru' ? 'CP1251' : 'CP1252'];
      await run(ffmpeg, [...enc, '-i', src, '-f', 'webvtt', p.out]);
    } catch (e) { failed.add(p); log(`  Could not use subtitles "${p.label}": ${e.message.split('\n')[0]}`); }
  }
  const done = [];
  for (const p of planned) {
    if (failed.has(p) || (p.it.type === 'track' && !Number.isInteger(p.it.stream))) continue;
    let size = 0;
    try { size = fs.statSync(p.out).size; } catch { /* not written */ }
    if (size < 20) { fs.rmSync(p.out, { force: true }); log(`  Could not use subtitles "${p.label}": no subtitle lines found`); continue; }
    done.push({ file: `subs/${p.name}`, label: p.label, lang: p.lang });
    log(`  Subtitles: ${p.label}`);
  }
  return done;
}

/** meta.subtitles used to be a single "subs.vtt" string; it's now a list. */
function normalizeMetaSubs(subs) {
  if (!subs) return [];
  if (typeof subs === 'string') return [{ file: subs, label: 'Subtitles', lang: 'en' }];
  return Array.isArray(subs) ? subs : [];
}

function addToMeta(movieDir, list) {
  const file = path.join(movieDir, 'meta.json');
  const meta = JSON.parse(fs.readFileSync(file, 'utf8'));
  const subs = normalizeMetaSubs(meta.subtitles);
  for (const s of list) {
    const i = subs.findIndex((x) => x.file === s.file);
    if (i >= 0) subs[i] = s; else subs.push(s);
  }
  meta.subtitles = subs;
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(meta, null, 2));
  fs.renameSync(`${file}.tmp`, file);
  return subs;
}

/** Validate subtitle choices that arrive from the browser. */
function sanitizeItems(items) {
  if (!Array.isArray(items)) return [];
  return items.slice(0, 12).map((it) => {
    const label = String((it && it.label) || '').slice(0, 40);
    const lang = String((it && it.lang) || '').slice(0, 8);
    if (it && it.type === 'track' && Number.isInteger(it.stream) && it.stream >= 0) return { type: 'track', stream: it.stream, label, lang };
    if (it && it.type === 'file' && typeof it.path === 'string' && SUB_EXT.has(path.extname(it.path).toLowerCase())) return { type: 'file', path: it.path, label, lang };
    return null;
  }).filter(Boolean);
}

module.exports = { findSubtitleSources, defaultChoice, convertSubtitles, addToMeta, normalizeMetaSubs, sanitizeItems, SUB_EXT };
