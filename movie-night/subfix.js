/**
 * Movie Night - making subtitles behave.
 *
 *  assToCues(text)        Anime-style .ass/.ssa -> clean lines: duplicate layers removed,
 *                         signs/song lyrics moved to the top (so dialogue doesn't jump),
 *                         drawings and tiny flashes dropped.
 *  cleanCues(cues)        For every subtitle: merges a line that's split into pieces (it
 *                         would blink off and on), removes duplicates and 1-frame flashes.
 *  syncToAudio(...)       Lines a downloaded subtitle file up with the movie's dialogue:
 *                         finds the delay (and a 25 vs 23.976 fps speed difference) by
 *                         comparing when people talk with when subtitles are on screen.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

// ---- WebVTT in & out ---------------------------------------------------------------
function parseTime(s) {
  const m = String(s).trim().match(/^(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})$/);
  if (!m) return null;
  return Number(m[1] || 0) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4].padEnd(3, '0')) / 1000;
}
function fmtTime(t) {
  t = Math.max(0, t);
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = Math.floor(t % 60), ms = Math.round((t % 1) * 1000);
  const [S, MS] = ms === 1000 ? [s + 1, 0] : [s, ms];
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(S).padStart(2, '0')}.${String(MS).padStart(3, '0')}`;
}
function parseVtt(text) {
  const cues = [];
  for (const block of String(text).replace(/\r/g, '').replace(/^﻿/, '').split(/\n{2,}/)) {
    const lines = block.split('\n');
    const i = lines.findIndex((l) => l.includes('-->'));
    if (i < 0) continue;
    const [a, rest] = lines[i].split('-->');
    const parts = rest.trim().split(/\s+/);
    const start = parseTime(a), end = parseTime(parts[0]);
    if (start === null || end === null) continue;
    const body = lines.slice(i + 1).join('\n').trim();
    if (!body) continue;
    cues.push({ start, end, settings: parts.slice(1).join(' '), text: body });
  }
  return cues;
}
function writeVtt(cues) {
  return `WEBVTT\n\n${cues.map((c) => `${fmtTime(c.start)} --> ${fmtTime(c.end)}${c.settings ? ` ${c.settings}` : ''}\n${c.text}`).join('\n\n')}\n`;
}

// ---- Clean-up for every subtitle ----------------------------------------------------
const plain = (t) => t.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
function cleanCues(cues) {
  let list = cues.filter((c) => c.end - c.start >= 0.12 && plain(c.text)).sort((a, b) => a.start - b.start || a.end - b.end);
  const out = [];
  for (const c of list) {
    // Same words again, overlapping or straight after: one longer line instead of a blink/duplicate.
    const twin = out.slice(-6).find((o) => plain(o.text) === plain(c.text) && (o.settings || '') === (c.settings || '') && c.start <= o.end + 0.35);
    if (twin) { twin.end = Math.max(twin.end, c.end); continue; }
    out.push({ ...c });
  }
  list = out;
  // A line that ends a hair before the next starts: close the tiny gap so it doesn't flicker.
  for (let i = 0; i + 1 < list.length; i++) {
    const gap = list[i + 1].start - list[i].end;
    if (gap > 0 && gap < 0.08 && !(list[i].settings || list[i + 1].settings)) list[i].end = list[i + 1].start;
  }
  return list;
}

// ---- .ass / .ssa (most anime) --------------------------------------------------------
function assToCues(text) {
  const lines = String(text).replace(/\r/g, '').replace(/^﻿/, '').split('\n');
  const styles = {};
  let section = '', styleFmt = null, eventFmt = null;
  const cues = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (/^\[.*\]$/.test(line)) { section = line.toLowerCase(); continue; }
    const m = line.match(/^(\w+):\s*(.*)$/);
    if (!m) continue;
    const [, key, val] = m;
    if (section.includes('styles')) {
      if (key === 'Format') styleFmt = val.split(',').map((x) => x.trim().toLowerCase());
      else if (key === 'Style' && styleFmt) {
        const f = val.split(',');
        const o = Object.fromEntries(styleFmt.map((k, i) => [k, (f[i] || '').trim()]));
        styles[o.name] = { align: Number(o.alignment) || 2 };
      }
    } else if (section.includes('events')) {
      if (key === 'Format') { eventFmt = val.split(',').map((x) => x.trim().toLowerCase()); continue; }
      if (key !== 'Dialogue' || !eventFmt) continue;
      const f = val.split(',');
      const textIdx = eventFmt.indexOf('text');
      const o = Object.fromEntries(eventFmt.map((k, i) => [k, i === textIdx ? f.slice(i).join(',') : (f[i] || '').trim()]));
      const start = parseTime(o.start), end = parseTime(o.end);
      if (start === null || end === null || end <= start) continue;
      let t = o.text || '';
      if (/\\p[1-9]/.test(t)) continue; // vector drawings, not words
      const style = styles[o.style] || { align: 2 };
      const anTag = t.match(/\\an?(\d)/);
      const align = anTag ? Number(anTag[1]) : style.align;
      const placed = /\\(pos|move)\s*\(/.test(t) || align >= 7 || /sign|title|screen|typeset|note|^op|^ed|kara|song|lyric|insert/i.test(o.style || '') || /sign/i.test(o.name || '');
      t = t.replace(/\{[^}]*\}/g, '').replace(/\\N/g, '\n').replace(/\\n/g, ' ').replace(/\\h/g, ' ').replace(/[ \t]+/g, ' ')
        .split('\n').map((x) => x.trim()).filter(Boolean).join('\n');
      if (!t) continue;
      if (placed && end - start < 0.6) continue; // a sign that flashes past
      const safe = t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      cues.push({ start, end, settings: placed ? 'line:4% align:center' : '', text: safe });
    }
  }
  return cleanCues(cues);
}

// ---- Auto-sync with the movie's audio -------------------------------------------------
const STEP = 0.1; // seconds per sample
/** When people are talking, sample by sample (cached next to the movie). */
function voiceActivity(movieFile, ffmpeg, cacheFile) {
  try {
    const st = fs.statSync(movieFile);
    const c = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    if (c.size === st.size && c.mtime === st.mtimeMs) return Promise.resolve(Uint8Array.from(Buffer.from(c.v, 'base64')));
  } catch { /* not cached yet */ }
  return new Promise((resolve, reject) => {
    const RATE = 8000, WIN = RATE * STEP;
    const p = spawn(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-i', movieFile, '-map', '0:a:0', '-vn', '-sn', '-ac', '1', '-ar', String(RATE),
      '-af', 'highpass=f=250,lowpass=f=3500', '-f', 's16le', '-'], { windowsHide: true });
    const energy = [];
    let carry = Buffer.alloc(0), acc = 0, n = 0;
    p.stdout.on('data', (chunk) => {
      const buf = carry.length ? Buffer.concat([carry, chunk]) : chunk;
      const usable = buf.length - (buf.length % 2);
      for (let i = 0; i < usable; i += 2) {
        const v = buf.readInt16LE(i);
        acc += v * v;
        if (++n === WIN) { energy.push(10 * Math.log10(acc / WIN + 1)); acc = 0; n = 0; }
      }
      carry = buf.subarray(usable);
    });
    p.on('error', reject);
    p.on('close', (code) => {
      if (code !== 0 || energy.length < 600) { reject(new Error('Could not read the movie\'s audio')); return; }
      // Speech = clearly louder than the quiet floor around it (adapts to loud/quiet scenes).
      const W = 150; // 15 s
      const v = new Uint8Array(energy.length);
      for (let i = 0; i < energy.length; i += 10) {
        const win = energy.slice(Math.max(0, i - W), Math.min(energy.length, i + W)).sort((a, b) => a - b);
        const floor = win[Math.floor(win.length * 0.15)], top = win[Math.floor(win.length * 0.9)];
        const thr = floor + Math.max(4, (top - floor) * 0.35);
        for (let k = i; k < Math.min(i + 10, energy.length); k++) v[k] = energy[k] > thr ? 1 : 0;
      }
      try {
        const st = fs.statSync(movieFile);
        fs.writeFileSync(cacheFile, JSON.stringify({ size: st.size, mtime: st.mtimeMs, v: Buffer.from(v).toString('base64') }));
      } catch { /* cache is optional */ }
      resolve(v);
    });
  });
}
function subtitleSignal(cues, len, ratio, offset) {
  const s = new Float32Array(len);
  for (const c of cues) {
    const a = Math.max(0, Math.round((c.start * ratio + offset) / STEP)), b = Math.min(len, Math.round((c.end * ratio + offset) / STEP));
    for (let i = a; i < b; i++) s[i] = 1;
  }
  return s;
}
/** Best delay for one speed ratio: correlation of talk vs subtitles for every delay in range. */
function scan(voice, cues, ratio, maxShift) {
  const len = voice.length;
  const sub = subtitleSignal(cues, len, ratio, 0);
  let vm = 0, sm = 0;
  for (let i = 0; i < len; i++) { vm += voice[i]; sm += sub[i]; }
  vm /= len; sm /= len;
  const v = new Float32Array(len);
  for (let i = 0; i < len; i++) v[i] = voice[i] - vm;
  const on = [];
  for (let i = 0; i < len; i++) if (sub[i]) on.push(i);
  const steps = Math.round(maxShift / STEP);
  const scores = new Float32Array(2 * steps + 1);
  for (let k = -steps; k <= steps; k++) {
    let sum = 0;
    for (const i of on) { const j = i + k; if (j >= 0 && j < len) sum += v[j]; }
    scores[k + steps] = sum;
  }
  let best = 0;
  for (let i = 1; i < scores.length; i++) if (scores[i] > scores[best]) best = i;
  const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
  const sd = Math.sqrt(scores.reduce((a, b) => a + (b - mean) ** 2, 0) / scores.length) || 1;
  return { offset: (best - steps) * STEP, score: scores[best], z: (scores[best] - mean) / sd, zero: scores[steps] };
}
const RATIOS = [1, 25 / 23.976, 23.976 / 25, 24 / 23.976, 23.976 / 24, 25 / 24, 24 / 25];

/**
 * Line up a .vtt file with the movie. Returns { offset, ratio, changed, sure } and rewrites
 * the file only when the match is clear and the correction is noticeable.
 */
async function syncToAudio(vttFile, movieFile, ffmpeg, cacheFile, log = () => {}) {
  const cues = parseVtt(fs.readFileSync(vttFile, 'utf8')).filter((c) => !c.settings); // dialogue only
  if (cues.length < 40) return { changed: false, reason: 'too few lines' };
  const voice = await voiceActivity(movieFile, ffmpeg, cacheFile);
  let best = null;
  for (const ratio of RATIOS) {
    const r = { ratio, ...scan(voice, cues, ratio, 90) };
    if (!best || r.score > best.score) best = r;
  }
  const asIs = scan(voice, cues, 1, 0.5);
  const gain = best.score / Math.max(1, asIs.score);
  const sure = best.z >= 5;
  const noticeable = best.ratio !== 1 || Math.abs(best.offset) >= 0.3;
  if (!sure || !noticeable || gain < 1.08) {
    log(`  Subtitle timing: ${!noticeable ? 'already in sync' : 'left as is (no clear match)'}`);
    return { changed: false, offset: best.offset, ratio: best.ratio, sure };
  }
  const all = parseVtt(fs.readFileSync(vttFile, 'utf8')).map((c) => ({ ...c, start: c.start * best.ratio + best.offset, end: c.end * best.ratio + best.offset }))
    .filter((c) => c.end > 0);
  fs.writeFileSync(vttFile, writeVtt(all));
  log(`  Subtitle timing fixed: ${best.offset >= 0 ? 'delayed' : 'moved earlier'} by ${Math.abs(best.offset).toFixed(1)} s${best.ratio !== 1 ? `, speed ×${best.ratio.toFixed(4)}` : ''}`);
  return { changed: true, offset: best.offset, ratio: best.ratio, sure };
}

/** Tidy a .vtt in place (safe to run again). */
function cleanVttFile(file) {
  const before = fs.readFileSync(file, 'utf8');
  const cues = parseVtt(before);
  if (!cues.length) return false;
  const after = writeVtt(cleanCues(cues));
  if (after !== before) { fs.writeFileSync(file, after); return true; }
  return false;
}

module.exports = { parseVtt, writeVtt, cleanCues, assToCues, cleanVttFile, syncToAudio, voiceActivity };
