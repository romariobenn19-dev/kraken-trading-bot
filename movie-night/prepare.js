#!/usr/bin/env node
/**
 * Movie Night - prepare a movie for streaming.
 *
 * Converts one movie file into a multi-quality HLS stream (up to 4K) inside ./library.
 * Your laptop does all of the heavy work once, ahead of time; the viewer's device
 * only downloads small 4-second chunks at whatever quality its connection and
 * screen can handle.
 *
 * Usage:
 *   node prepare.js "C:\Movies\Some Film.mkv" [options]
 *
 * Options:
 *   --title "Name"        Display name (default: file name)
 *   --subs file.srt       Add a subtitle file (.srt / .vtt / .ass). A "Film.srt" next to
 *                         "Film.mkv" is picked up automatically.
 *   --sub-track N         Use embedded subtitle track N (0 = first) instead
 *   --subtitles JSON      Exact subtitle choices (used by the app)
 *   --audio-track N       Which audio track to use (0 = first, default)
 *   --encoder X           auto | nvenc | amf | qsv | cpu   (default: auto)
 *   --max 2160            Highest quality to produce (2160, 1440, 1080, 720 ...)
 *   --no-avc              Skip the H.264 compatibility versions (faster)
 *   --no-hevc             Skip the HEVC versions (H.264 only)
 *   --quick               Only the versions a 1080p tablet uses (1080p HQ, 720p, 480p)
 *   --denoise             Gently clean film grain/noise first. Grain wastes bitrate, so
 *                         grainy films come out noticeably sharper at the same size.
 *
 * It's safe to stop and re-run: finished qualities are skipped.
 */
'use strict';

const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const FFMPEG = process.env.FFMPEG || 'ffmpeg';
const FFPROBE = process.env.FFPROBE || 'ffprobe';
const LIBRARY = process.env.LIBRARY || path.join(__dirname, 'library');
const SEGMENT_SECONDS = 4;
// --progress-json: machine-readable progress for the Movie Night app ("@@{...}" lines).
let JSON_PROGRESS = false;
const step = { n: 0, of: 0 };
function emit(obj) { if (JSON_PROGRESS) process.stdout.write(`@@${JSON.stringify(obj)}\n`); }

// Quality ladder. Bitrates are averages in kbit/s, tuned for high quality per bit.
// HEVC gives roughly the same picture as H.264 at ~60% of the size.
const HEVC_LADDER = [
  { label: '2160p', width: 3840, kbps: 9000, codec: 'hvc1.1.6.L153.90' },
  { label: '1440p', width: 2560, kbps: 5000, codec: 'hvc1.1.6.L150.90' },
  // Extra-sharp 1080p for 1080p screens on ~6-8 Mbps connections (e.g. a Galaxy Tab A8).
  { label: '1080p', tag: 'hq', width: 1920, kbps: 4500, codec: 'hvc1.1.6.L123.90' },
  { label: '1080p', width: 1920, kbps: 3200, codec: 'hvc1.1.6.L123.90' },
  // Still full 1080p, compressed harder, so slow or shaky Wi-Fi can stay at 1080p.
  { label: '1080p', tag: 'lite', width: 1920, kbps: 1600, codec: 'hvc1.1.6.L123.90' },
  { label: '720p',  width: 1280, kbps: 1600, codec: 'hvc1.1.6.L93.90' },
  { label: '480p',  width: 854,  kbps: 800,  codec: 'hvc1.1.6.L90.90' },
  { label: '360p',  width: 640,  kbps: 420,  codec: 'hvc1.1.6.L90.90' },
];
// Fallback for devices/browsers without HEVC support.
const AVC_LADDER = [
  { label: '1080p', width: 1920, kbps: 5000, codec: 'avc1.640028' },
  { label: '1080p', tag: 'lite', width: 1920, kbps: 2400, codec: 'avc1.640028' },
  { label: '720p',  width: 1280, kbps: 2500, codec: 'avc1.64001f' },
  { label: '480p',  width: 854,  kbps: 1100, codec: 'avc1.64001e' },
];
const LABEL_HEIGHT = { '2160p': 2160, '1440p': 1440, '1080p': 1080, '720p': 720, '480p': 480, '360p': 360 };

function parseArgs(argv) {
  const opts = { encoder: 'auto', max: 2160, audioTrack: 0, avc: true, hevc: true };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      if (i + 1 >= argv.length) die(`Missing value for ${a}`);
      return argv[++i];
    };
    if (a === '--title') opts.title = next();
    else if (a === '--subs') opts.subs = next();
    else if (a === '--sub-track') opts.subTrack = parseInt(next(), 10);
    else if (a === '--audio-track') opts.audioTrack = parseInt(next(), 10);
    else if (a === '--encoder') opts.encoder = next().toLowerCase();
    else if (a === '--max') opts.max = parseInt(next(), 10);
    else if (a === '--no-avc') opts.avc = false;
    else if (a === '--no-hevc') opts.hevc = false;
    else if (a === '--denoise') opts.denoise = true;
    else if (a === '--quick') opts.quick = true;
    else if (a === '--subtitles') opts.subtitlesJson = next();
    else if (a === '--progress-json') JSON_PROGRESS = true;
    else if (a === '-h' || a === '--help') { printHelp(); process.exit(0); }
    else if (a.startsWith('--')) die(`Unknown option ${a}`);
    else rest.push(a);
  }
  if (rest.length !== 1) { printHelp(); process.exit(1); }
  opts.input = path.resolve(rest[0]);
  if (!opts.avc && !opts.hevc) die('Nothing to do: both --no-avc and --no-hevc given.');
  return opts;
}

function printHelp() {
  const src = fs.readFileSync(__filename, 'utf8');
  const m = src.match(/\/\*\*([\s\S]*?)\*\//);
  console.log(m ? m[1].replace(/^ \* ?/gm, '') : 'node prepare.js <movie file>');
}

function die(msg) {
  console.error(`\nError: ${msg}\n`);
  process.exit(1);
}

/** "Film.mkv" -> "Film.srt" / "Film.en.srt" / "Film.eng.srt" if one sits next to it. */
function autoSubs(input) {
  const base = input.slice(0, -path.extname(input).length);
  for (const suffix of ['.srt', '.en.srt', '.eng.srt', '.English.srt', '.vtt', '.en.vtt']) {
    if (fs.existsSync(base + suffix)) return base + suffix;
  }
  return null;
}

function slugify(s) {
  return s.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'movie';
}

function checkTools() {
  for (const tool of [FFMPEG, FFPROBE]) {
    const r = spawnSync(tool, ['-version'], { encoding: 'utf8' });
    if (r.error) die(`Could not run "${tool}". Install FFmpeg (Windows: winget install Gyan.FFmpeg) and open a new terminal.`);
  }
}

function probe(file) {
  const r = spawnSync(FFPROBE, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) die(`ffprobe could not read the file:\n${r.stderr}`);
  return JSON.parse(r.stdout);
}

function parseRate(r) {
  if (!r || r === '0/0') return 0;
  const [n, d] = r.split('/').map(Number);
  return d ? n / d : n;
}

function hasFilter(name) {
  const r = spawnSync(FFMPEG, ['-hide_banner', '-filters'], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  return new RegExp(`\\s${name}\\s`).test(r.stdout || '');
}

/** Try to encode a tiny clip with an encoder; returns true if the hardware/driver supports it. */
function encoderWorks(enc) {
  const r = spawnSync(FFMPEG, ['-hide_banner', '-v', 'error', '-f', 'lavfi', '-i', 'color=black:s=1280x720:d=0.2',
    '-c:v', enc, '-f', 'null', '-'], { encoding: 'utf8' });
  return r.status === 0;
}

function pickEncoders(choice) {
  const families = {
    nvenc: { hevc: 'hevc_nvenc', avc: 'h264_nvenc' },
    amf: { hevc: 'hevc_amf', avc: 'h264_amf' },
    qsv: { hevc: 'hevc_qsv', avc: 'h264_qsv' },
    cpu: { hevc: 'libx265', avc: 'libx264' },
  };
  if (choice !== 'auto') {
    if (!families[choice]) die(`Unknown encoder "${choice}". Use auto, nvenc, amf, qsv or cpu.`);
    return { name: choice, ...families[choice] };
  }
  for (const name of ['nvenc', 'amf', 'qsv']) {
    if (encoderWorks(families[name].hevc) && encoderWorks(families[name].avc)) return { name, ...families[name] };
  }
  return { name: 'cpu', ...families.cpu };
}

/**
 * `best` = the version people will actually watch: slowest, sharpest settings.
 * Backup versions (only used during Wi-Fi dips) use faster settings - roughly 2-3x quicker.
 */
function videoCodecArgs(encName, codecFamily, kbps, gop, best) {
  const b = `${kbps}k`, max = `${Math.round(kbps * 1.6)}k`, buf = `${Math.round(kbps * 2)}k`;
  const rate = ['-b:v', b, '-maxrate', max, '-bufsize', buf];
  const hevc = codecFamily === 'hevc';
  const tag = hevc ? ['-tag:v', 'hvc1'] : [];
  switch (encName) {
    case 'nvenc':
      return ['-c:v', hevc ? 'hevc_nvenc' : 'h264_nvenc', '-preset', best ? 'p7' : 'p4', '-tune', 'hq', '-rc', 'vbr',
        '-multipass', best ? 'fullres' : 'disabled', '-spatial-aq', '1', '-rc-lookahead', best ? '32' : '16', '-forced-idr', '1',
        '-profile:v', hevc ? 'main' : 'high', '-g', String(gop), ...rate, ...tag];
    case 'amf':
      return ['-c:v', hevc ? 'hevc_amf' : 'h264_amf', '-quality', best ? 'quality' : 'balanced', '-rc', 'vbr_peak',
        '-profile:v', 'main', '-g', String(gop), ...rate, ...tag].map((v) =>
        (!hevc && v === 'main') ? 'high' : v);
    case 'qsv':
      return ['-c:v', hevc ? 'hevc_qsv' : 'h264_qsv', '-preset', best ? 'slower' : 'medium', '-profile:v', hevc ? 'main' : 'high',
        '-g', String(gop), ...rate, ...tag];
    default:
      if (hevc) {
        return ['-c:v', 'libx265', '-preset', best ? 'medium' : 'fast', '-profile:v', 'main', ...rate, ...tag,
          '-x265-params', `keyint=${gop}:min-keyint=${gop}:open-gop=0:scenecut=0:log-level=error`];
      }
      return ['-c:v', 'libx264', '-preset', best ? 'slow' : 'fast', '-profile:v', 'high', ...rate,
        '-g', String(gop), '-keyint_min', String(gop), '-sc_threshold', '0'];
  }
}

function even(n) { return Math.max(2, Math.round(n / 2) * 2); }

function runFfmpeg(args, durationSec, label, cwd) {
  return new Promise((resolve, reject) => {
    const p = spawn(FFMPEG, ['-hide_banner', '-y', '-nostats', '-progress', 'pipe:1', ...args],
      { stdio: ['ignore', 'pipe', 'pipe'], cwd });
    let errTail = '';
    let last = -1;
    const started = Date.now();
    p.stdout.on('data', (chunk) => {
      const m = String(chunk).match(/out_time_(?:us|ms)=(\d+)/g);
      if (!m || !durationSec) return;
      const us = Number(m[m.length - 1].split('=')[1]);
      const pct = Math.min(100, Math.floor((us / 1e6 / durationSec) * 100));
      if (pct !== last) {
        last = pct;
        const elapsed = (Date.now() - started) / 1000;
        const eta = pct > 0 ? Math.round(elapsed * (100 - pct) / pct) : 0;
        if (JSON_PROGRESS) emit({ label, pct, eta, step: step.n, steps: step.of });
        else process.stdout.write(`\r  ${label.padEnd(14)} ${String(pct).padStart(3)}%  ` +
          (pct > 0 ? `~${fmtDuration(eta)} left   ` : '              '));
      }
    });
    p.stderr.on('data', (c) => { errTail = (errTail + c).slice(-4000); });
    p.on('error', reject);
    p.on('close', (code) => {
      process.stdout.write('\n');
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg failed (${label}):\n${errTail}`));
    });
  });
}

function fmtDuration(sec) {
  sec = Math.round(sec);
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return h ? `${h}h${String(m).padStart(2, '0')}m` : m ? `${m}m${String(s).padStart(2, '0')}s` : `${s}s`;
}

/** Measure real average and peak bitrate of an encoded rendition from its playlist. */
function measureRendition(dir) {
  const pl = fs.readFileSync(path.join(dir, 'index.m3u8'), 'utf8').split(/\r?\n/);
  let total = 0, bytes = 0, peak = 0, dur = 0;
  const initPath = path.join(dir, 'init.mp4');
  const initBytes = fs.existsSync(initPath) ? fs.statSync(initPath).size : 0;
  for (const line of pl) {
    if (line.startsWith('#EXTINF:')) dur = parseFloat(line.slice(8));
    else if (line && !line.startsWith('#')) {
      const size = fs.statSync(path.join(dir, line)).size;
      bytes += size; total += dur;
      if (dur > 0.5) peak = Math.max(peak, (size * 8) / dur);
    }
  }
  const avg = total ? ((bytes + initBytes) * 8) / total : 0;
  return { avg: Math.round(avg), peak: Math.round(Math.max(peak, avg)), bytes: bytes + initBytes };
}

/** Write via a temp file so the server never reads a half-written file. */
function writeAtomic(file, data) {
  fs.writeFileSync(`${file}.tmp`, data);
  fs.renameSync(`${file}.tmp`, file);
}

function writeMaster(outDir, file, renditions, fps) {
  const lines = ['#EXTM3U', '#EXT-X-VERSION:7', '#EXT-X-INDEPENDENT-SEGMENTS'];
  for (const r of renditions) {
    lines.push(`#EXT-X-STREAM-INF:BANDWIDTH=${r.peak},AVERAGE-BANDWIDTH=${r.avg},RESOLUTION=${r.width}x${r.height},` +
      `CODECS="${r.codec},mp4a.40.2"${fps ? `,FRAME-RATE=${fps.toFixed(3)}` : ''}`);
    lines.push(`${r.dir}/index.m3u8`);
  }
  writeAtomic(path.join(outDir, file), lines.join('\n') + '\n');
}

/** Subtitles: the ones picked in the app (--subtitles), or --subs/--sub-track, or a matching file next to the movie. */
async function prepareSubtitles(opts, info, outDir) {
  const subs = require('./subtitles');
  let items = [];
  if (opts.subtitlesJson) {
    try { items = subs.sanitizeItems(JSON.parse(opts.subtitlesJson)); } catch { die('--subtitles must be JSON'); }
  } else if (opts.subs) {
    if (!fs.existsSync(opts.subs)) die(`Subtitle file not found: ${opts.subs}`);
    items = [{ type: 'file', path: path.resolve(opts.subs), label: 'Subtitles', lang: 'en' }];
  } else if (Number.isInteger(opts.subTrack)) {
    const st = info.streams.filter((x) => x.codec_type === 'subtitle')[opts.subTrack];
    if (!st) die(`Subtitle track ${opts.subTrack} doesn't exist.`);
    if (['hdmv_pgs_subtitle', 'dvd_subtitle', 'dvb_subtitle'].includes(st.codec_name)) {
      die('That subtitle track is a picture-based format (PGS/VobSub) and can\'t be converted to text. Use an .srt file with --subs instead.');
    }
    items = [{ type: 'track', stream: st.index, label: 'Subtitles', lang: (st.tags && st.tags.language) || 'en' }];
  } else {
    items = subs.defaultChoice(subs.findSubtitleSources(opts.input, FFPROBE));
  }
  const made = await subs.convertSubtitles(items, opts.input, outDir, FFMPEG, (m) => console.log(m));
  // Keep subtitles made earlier for this movie (e.g. added afterwards in the app).
  let earlier = [];
  try { earlier = subs.normalizeMetaSubs(JSON.parse(fs.readFileSync(path.join(outDir, 'meta.json'), 'utf8')).subtitles); } catch { /* new movie */ }
  const all = [...earlier.filter((e) => fs.existsSync(path.join(outDir, e.file)) && !made.some((m) => m.file === e.file)), ...made];
  if (!all.length && fs.existsSync(path.join(outDir, 'subs.vtt'))) all.push({ file: 'subs.vtt', label: 'Subtitles', lang: 'en' });
  return all;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!fs.existsSync(opts.input)) die(`File not found: ${opts.input}`);
  checkTools();

  const info = probe(opts.input);
  const video = info.streams.find((s) => s.codec_type === 'video' && !(s.disposition && s.disposition.attached_pic));
  if (!video) die('No video track found in that file.');
  const audios = info.streams.filter((s) => s.codec_type === 'audio');
  const audio = audios[opts.audioTrack];
  if (!audio && audios.length) die(`Audio track ${opts.audioTrack} doesn't exist (file has ${audios.length}).`);
  const duration = parseFloat(info.format.duration || video.duration || 0);
  const fps = parseRate(video.avg_frame_rate) || parseRate(video.r_frame_rate) || 24;
  const gop = Math.max(1, Math.round(fps * SEGMENT_SECONDS));

  // Account for non-square pixels so widescreen films keep the right shape.
  let srcW = video.width, srcH = video.height;
  const sar = video.sample_aspect_ratio && video.sample_aspect_ratio !== '0:1' ? video.sample_aspect_ratio.split(':').map(Number) : null;
  if (sar && sar[0] && sar[1] && sar[0] !== sar[1]) srcW = Math.round(srcW * sar[0] / sar[1]);
  const rotation = Math.abs(Number((video.tags && video.tags.rotate) || 0));
  if (rotation === 90 || rotation === 270) [srcW, srcH] = [srcH, srcW];

  const title = opts.title || path.basename(opts.input, path.extname(opts.input)).replace(/[._]+/g, ' ').trim();
  const id = slugify(title);
  const outDir = path.join(LIBRARY, id);
  fs.mkdirSync(outDir, { recursive: true });

  const isHdr = ['smpte2084', 'arib-std-b67'].includes(video.color_transfer);
  let toneMap = '';
  if (isHdr) {
    if (hasFilter('zscale') && hasFilter('tonemap')) {
      toneMap = ',zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=tonemap=hable:desat=0,' +
        'zscale=t=bt709:m=bt709:r=tv';
    } else {
      console.warn('! This is an HDR movie but your FFmpeg lacks the "zscale" filter, so colours may look washed out.\n' +
        '  The "full" FFmpeg build (winget install Gyan.FFmpeg) includes it.');
    }
  }

  const enc = pickEncoders(opts.encoder);
  console.log(`\nMovie Night - preparing "${title}"`);
  console.log(`  Source:   ${video.width}x${video.height} ${video.codec_name}${isHdr ? ' HDR' : ''}, ${fps.toFixed(2)} fps, ${fmtDuration(duration)}`);
  emit({ source: { width: srcW, height: srcH } });
  console.log(`  Encoder:  ${enc.name}${enc.name === 'cpu' ? ' (no GPU encoder found - this will be slow; leave it overnight)' : ' (GPU)'}`);
  console.log(`  Output:   ${outDir}\n`);

  // Only make qualities that don't exceed the source (with a little tolerance).
  const fits = (r) => r.width <= srcW * 1.05 && LABEL_HEIGHT[r.label] <= opts.max;
  let jobs = [];
  if (opts.hevc) for (const r of HEVC_LADDER.filter(fits)) jobs.push({ ...r, family: 'hevc' });
  if (opts.avc) for (const r of AVC_LADDER.filter(fits)) jobs.push({ ...r, family: 'avc' });
  if (!jobs.length) {
    // Very small source: make a single rendition at native width.
    const w = even(Math.min(srcW, 640));
    if (opts.hevc) jobs.push({ ...HEVC_LADDER[HEVC_LADDER.length - 1], width: w, family: 'hevc' });
    if (opts.avc) jobs.push({ ...AVC_LADDER[AVC_LADDER.length - 1], width: w, family: 'avc' });
  }

  // Keep the original's full detail: if it sits between the standard sizes (e.g. 768x432,
  // 640x360 below 480p...), add a version at its exact size so nothing is thrown away.
  const biggest = Math.max(0, ...jobs.filter((j) => j.width !== srcW).map((j) => j.width));
  const nativeW = even(srcW), nativeH = even(srcH);
  if (srcW < 1900 && nativeW > biggest * 1.08 && nativeH <= opts.max) {
    const scale = Math.pow((nativeW * nativeH) / (1920 * 1080), 0.8);
    const hevcKbps = Math.max(450, Math.round(3200 * scale * 1.25));
    const nativeJob = { label: `${nativeH}p`, tag: 'src', width: nativeW };
    // Drop the shrunk-down copies the native version replaces (same or very close size).
    jobs = jobs.filter((j) => j.width < nativeW * 0.8);
    if (opts.avc) jobs.unshift({ ...nativeJob, kbps: Math.round(hevcKbps * 1.5), codec: 'avc1.64001f', family: 'avc' });
    if (opts.hevc) jobs.unshift({ ...nativeJob, kbps: hevcKbps, codec: 'hvc1.1.6.L93.90', family: 'hevc' });
  }

  // Quick: only what a 1080p screen actually uses (1080p HQ, 1080p, 1080p Lite for slow links, 480p).
  if (opts.quick) {
    // 1080p Lite uses the same data as 720p but keeps full 1080p, so it replaces 720p here.
    const QUICK = new Set(['1080p-hq', '1080p', '1080p-lite', '480p']);
    const has1080 = jobs.some((j) => j.label === '1080p');
    if (!has1080) QUICK.add('720p');
    // (1080p H.264 stays: it's what a tablet without HEVC would watch.)
    const quick = jobs.filter((j) => QUICK.has(`${j.label}${j.tag ? `-${j.tag}` : ''}`) || j.tag === 'src' || (j.family === 'avc' && j.label === '1080p'));
    if (quick.length) jobs = quick;
  }

  // Sharpest (slowest) settings for the top version of each kind and for 1080p HQ; faster for backups.
  for (const fam of ['hevc', 'avc']) {
    const first = jobs.find((j) => j.family === fam);
    if (first) first.best = true;
  }
  // Sharpest settings for HQ, and for Lite (at a low bitrate, encoder effort shows the most).
  for (const j of jobs) if (j.tag === 'hq' || j.tag === 'lite') j.best = true;

  // Make the version people will actually watch first, so the movie is watchable
  // while the backup versions are still being made.
  const watchFirst = jobs.find((j) => j.family === 'hevc' && j.tag === 'hq') || jobs.find((j) => j.family === 'hevc') || jobs[0];
  const avcTop = jobs.find((j) => j.family === 'avc');
  jobs = [watchFirst, ...(avcTop && avcTop !== watchFirst ? [avcTop] : []), ...jobs.filter((j) => j !== watchFirst && j !== avcTop)];

  // Poster and subtitles first (seconds), so the movie looks complete the moment it appears.
  const poster = path.join(outDir, 'poster.jpg');
  if (!fs.existsSync(poster)) {
    try {
      await runFfmpeg(['-ss', String(Math.max(0, duration * 0.12)), '-i', opts.input, '-map', `0:${video.index}`,
        '-frames:v', '1', '-vf', `scale=640:-2${toneMap},format=yuvj420p`, '-q:v', '4', poster], 0, 'poster');
    } catch (e) { console.warn('  (could not make a poster image - not a problem)'); }
  }
  const subtitles = await prepareSubtitles(opts, info, outDir);
  // Remember the original file (private, never served) so subtitles can be added later.
  fs.writeFileSync(path.join(outDir, '.source.json'), JSON.stringify({ file: opts.input }));

  const done = { hevc: [], avc: [] };
  const preparedAt = (() => { try { return JSON.parse(fs.readFileSync(path.join(outDir, 'meta.json'), 'utf8')).preparedAt; } catch { return new Date().toISOString(); } })();
  step.of = jobs.length;
  for (const job of jobs) {
    step.n++;
    const dirName = `${job.label}${job.tag ? `-${job.tag}` : ''}_${job.family}`;
    const dir = path.join(outDir, dirName);
    const height = even((job.width * srcH) / srcW);
    const width = even(job.width);
    if (fs.existsSync(path.join(dir, '.done')) && fs.existsSync(path.join(dir, 'init.mp4'))) {
      console.log(`  ${(job.label + (job.tag === 'hq' ? ' HQ' : job.tag === 'lite' ? ' Lite' : '') + ' ' + job.family.toUpperCase()).padEnd(14)} already done, skipping`);
    } else {
      fs.rmSync(dir, { recursive: true, force: true });
      fs.mkdirSync(dir, { recursive: true });
      const denoise = opts.denoise ? 'hqdn3d=1.5:1.5:6:6,' : '';
      const vf = `${denoise}scale=${width}:${height}:flags=lanczos${toneMap},format=yuv420p,setsar=1`;
      const args = [
        '-i', opts.input,
        '-map', `0:${video.index}`,
        ...(audio ? ['-map', `0:${audio.index}`] : []),
        '-vf', vf,
        ...(isHdr && toneMap ? ['-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709'] : []),
        ...videoCodecArgs(enc.name, job.family, job.kbps, gop, job.best),
        '-force_key_frames', `expr:gte(t,n_forced*${SEGMENT_SECONDS})`,
        ...(audio ? ['-c:a', 'aac', '-b:a', '160k', '-ac', '2', '-ar', '48000'] : []),
        '-sn', '-dn', '-map_metadata', '-1', '-map_chapters', '-1',
        '-f', 'hls', '-hls_time', String(SEGMENT_SECONDS), '-hls_playlist_type', 'vod',
        '-hls_segment_type', 'fmp4', '-hls_fmp4_init_filename', 'init.mp4',
        // Relative names + running inside the folder: on Windows FFmpeg otherwise
        // writes init.mp4 to the current folder instead of next to the playlist.
        '-hls_segment_filename', 'seg_%05d.m4s',
        'index.m3u8',
      ];
      await runFfmpeg(args, duration, `${job.label}${job.tag === 'hq' ? ' HQ' : job.tag === 'lite' ? ' Lite' : ''} ${job.family.toUpperCase()}`, dir);
      if (!fs.existsSync(path.join(dir, 'init.mp4'))) throw new Error(`FFmpeg didn't create ${path.join(dir, 'init.mp4')}`);
      fs.writeFileSync(path.join(dir, '.done'), new Date().toISOString());
    }
    const m = measureRendition(dir);
    done[job.family].push({ dir: dirName, label: job.label, width, height, codec: job.codec, avg: m.avg, peak: m.peak, bytes: m.bytes });
    publish(step.n === jobs.length);
  }

  /** Make the movie playable with what's finished so far (called after every version). */
  function publish(final) {
    const hevc = [...done.hevc].sort((a, b) => b.peak - a.peak);
    const avc = [...done.avc].sort((a, b) => b.peak - a.peak);
    if (hevc.length) writeMaster(outDir, 'master-hevc.m3u8', hevc, fps);
    if (avc.length) writeMaster(outDir, 'master-avc.m3u8', avc, fps);
    const meta = {
      id, title, duration, fps,
      width: srcW, height: srcH, hdrSource: isHdr,
      hevc: hevc.length ? 'master-hevc.m3u8' : null,
      avc: avc.length ? 'master-avc.m3u8' : null,
      renditions: [...hevc, ...avc].map(({ dir, label, codec, avg, width, height }) => ({ dir, label, codec, avg, width, height })),
      poster: fs.existsSync(poster) ? 'poster.jpg' : null,
      subtitles,
      partial: !final,
      preparedAt: preparedAt,
    };
    writeAtomic(path.join(outDir, 'meta.json'), JSON.stringify(meta, null, 2));
    emit({ ready: true, id, partial: !final });
    if (!final && step.n === 1) console.log('  Watchable now - making the backup versions...');
  }

  const totalGb = [...done.hevc, ...done.avc].reduce((s, r) => s + r.bytes, 0) / 1e9;
  emit({ done: true, id, title, gb: totalGb });
  console.log(`\nDone! "${title}" is ready in Movie Night (${totalGb.toFixed(1)} GB on disk).`);
  for (const r of [...done.hevc, ...done.avc]) {
    const name = r.label + (r.dir.includes('-hq_') ? ' HQ' : r.dir.includes('-lite_') ? ' Lite' : '');
    console.log(`  ${name.padEnd(8)} ${r.dir.endsWith('hevc') ? 'HEVC ' : 'H.264'}  avg ${(r.avg / 1e6).toFixed(1)} Mbps`);
  }
}

main().catch((e) => die(e.message));
