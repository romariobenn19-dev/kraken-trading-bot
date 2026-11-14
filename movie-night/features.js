/**
 * Movie Night - the "together" features (server side).
 *
 *  Watch progress (continue watching), movie diary (ratings, reviews, snapshots, stats),
 *  love notes, live chat, hold-to-cuddle, pick-together votes, movie-night countdown,
 *  next-episode autoplay, the curtain countdown, favourites and push notifications.
 *
 *  Everything is stored in data.json next to the app (never uploaded, not in git).
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Series = require('./public/series');

const MAX_SNAPSHOT = 4 * 1024 * 1024;

module.exports = function createFeatures({ ROOT, LIBRARY, config, saveConfig, broadcast, clients, room, listMovies, loadMovie, startPlaying, publicLinks }) {
  const DATA_FILE = path.join(ROOT, 'data.json');
  const SNAPS = path.join(ROOT, 'personal', 'snapshots');
  let data = {};
  try { data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch { /* first run */ }
  data = {
    progress: {}, diary: [], notes: [], votes: {}, schedule: null, people: {}, series: {}, favorites: {}, snaps: [], push: {},
    reactions: [], predictions: {}, games: [], wishlist: [], counts: {},
    ...data,
  };

  let saveTimer = null;
  function save(now) {
    clearTimeout(saveTimer);
    const write = () => {
      fs.writeFileSync(`${DATA_FILE}.tmp`, JSON.stringify(data, null, 1));
      fs.renameSync(`${DATA_FILE}.tmp`, DATA_FILE);
    };
    if (now) write(); else saveTimer = setTimeout(write, 1500);
  }
  const changed = (what) => { save(); broadcast({ t: 'fchanged', what }); };
  const id = () => crypto.randomBytes(6).toString('hex');
  const names = () => [...new Set([...clients.values()].map((c) => c.name))];

  // ---- What the home screen needs ----------------------------------------------------
  function publicState() {
    return {
      progress: data.progress,
      diary: data.diary.slice(-200),
      notes: data.notes,
      votes: data.votes,
      schedule: data.schedule,
      people: data.people,
      series: data.series,
      favorites: data.favorites,
      snaps: data.snaps.slice(-300),
      pushKey: vapid().publicKey,
      reactions: data.reactions.slice(-5000),
      // Predictions stay secret until the end of the movie.
      predictions: Object.fromEntries(Object.entries(data.predictions).map(([mid, byName]) => [mid,
        Object.fromEntries(Object.entries(byName).map(([n, pr]) => [n, pr.revealed ? pr : { made: true, at: pr.at }]))])),
      games: data.games.slice(-300),
      wishlist: data.wishlist,
      counts: data.counts,
      bingo: bingo ? { id: bingo.id, movieId: bingo.movieId, seed: bingo.seed, genres: bingo.genres, marks: bingo.marks, winners: bingo.winners } : null,
    };
  }
  const count = (k) => { data.counts[k] = (data.counts[k] || 0) + 1; save(); };
  const wsOf = (c) => { for (const [ws, x] of clients) if (x === c) return ws; return null; };
  const sendTo = (c, msg) => { const ws = wsOf(c); if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg)); };
  const movieById = (mid) => listMovies().find((m) => m.id === mid);

  // ---- Reactions (kept so they can be replayed when you rewatch) ---------------------
  function recordReaction(by, key, movieId, t) {
    if (!movieId || !Number.isFinite(t)) return;
    data.reactions.push({ movieId, t: Math.round(t * 10) / 10, key, by, at: Date.now() });
    if (data.reactions.length > 8000) data.reactions.splice(0, data.reactions.length - 8000);
    save();
  }

  // ---- Quote quiz (made from the movie's subtitles) ----------------------------------
  function subtitleLines(mv) {
    const subs = Array.isArray(mv.subtitles) ? mv.subtitles : typeof mv.subtitles === 'string' ? [{ file: mv.subtitles, lang: 'en', label: '' }] : [];
    const pick = subs.find((x) => /^en/i.test(x.lang || '') && !/sign|song|forced/i.test(x.label || ''))
      || subs.find((x) => !/sign|song|forced/i.test(x.label || '')) || subs[0];
    if (!pick) return [];
    let text = '';
    try { text = fs.readFileSync(path.join(LIBRARY, mv.id, pick.file), 'utf8'); } catch { return []; }
    const lines = [];
    const seen = new Set();
    for (const block of text.replace(/\r/g, '').split(/\n\n+/)) {
      const m = block.match(/(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{3})\s*-->/);
      if (!m) continue;
      const t = (Number(m[1] || 0) * 3600) + Number(m[2]) * 60 + Number(m[3]);
      const body = block.split('\n').filter((l) => !/-->/.test(l) && !/^\d+$/.test(l.trim()) && !/^WEBVTT/.test(l)).join(' ')
        .replace(/<[^>]*>/g, '').replace(/\{[^}]*\}/g, '').replace(/^[-–\s]+/, '').replace(/\s+-\s+/g, ' ').replace(/\s+/g, ' ').trim();
      const words = body.split(' ');
      if (words.length < 5 || words.length > 16 || !/[a-z]/i.test(body) || /^[\[(♪]/.test(body)) continue;
      const key = body.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      lines.push({ t, text: body });
    }
    return lines;
  }
  const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  function makeQuiz(mv) {
    const lines = subtitleLines(mv);
    if (lines.length < 16) return null;
    const dur = mv.duration || lines[lines.length - 1].t || 1;
    const pool = shuffle(lines.slice());
    const qs = [];
    const take = () => pool.pop();
    // Finish the line
    for (let k = 0; k < 3; k++) {
      const ln = take();
      const w = ln.text.split(' ');
      const cut = Math.max(2, Math.floor(w.length / 2));
      const ending = w.slice(cut).join(' ');
      const others = shuffle(lines.filter((x) => x !== ln)).slice(0, 3).map((x) => { const ww = x.text.split(' '); return ww.slice(Math.max(2, Math.floor(ww.length / 2))).join(' '); });
      const options = shuffle([ending, ...others]);
      qs.push({ type: 'finish', prompt: `${w.slice(0, cut).join(' ')} …`, options, answer: options.indexOf(ending) });
    }
    // Which came first?
    for (let k = 0; k < 2; k++) {
      const a = take();
      const b = shuffle(lines.filter((x) => Math.abs(x.t - a.t) > dur * 0.15))[0];
      if (!b) continue;
      const options = shuffle([a, b]);
      qs.push({ type: 'first', prompt: 'Which line came first?', options: options.map((x) => x.text), answer: options[0].t < options[1].t ? 0 : 1 });
    }
    // When was it said?
    const ln = take();
    qs.push({ type: 'when', prompt: `"${ln.text}"`, options: ['Near the start', 'In the middle', 'Near the end'], answer: Math.min(2, Math.floor((ln.t / dur) * 3)) });
    return shuffle(qs);
  }
  let quiz = null;
  function quizQuestion() {
    const q = quiz.qs[quiz.i];
    quiz.answers = {};
    quiz.phase = 'q';
    quiz.endsAt = Date.now() + 25000;
    clearTimeout(quiz.timer);
    quiz.timer = setTimeout(quizReveal, 25000);
    broadcast({ t: 'quiz', phase: 'q', id: quiz.id, title: quiz.title, i: quiz.i, n: quiz.qs.length, q: { type: q.type, prompt: q.prompt, options: q.options }, endsAt: quiz.endsAt, scores: quiz.scores });
  }
  function quizReveal() {
    if (!quiz || quiz.phase !== 'q') return;
    quiz.phase = 'reveal';
    clearTimeout(quiz.timer);
    const q = quiz.qs[quiz.i];
    for (const [n, a] of Object.entries(quiz.answers)) if (a === q.answer) quiz.scores[n] = (quiz.scores[n] || 0) + 1;
    broadcast({ t: 'quiz', phase: 'reveal', id: quiz.id, i: quiz.i, correct: q.answer, answers: quiz.answers, scores: quiz.scores });
    quiz.timer = setTimeout(() => {
      if (!quiz) return;
      quiz.i++;
      if (quiz.i < quiz.qs.length) { quizQuestion(); return; }
      const best = Math.max(0, ...Object.values(quiz.scores));
      const winners = Object.keys(quiz.scores).filter((n) => quiz.scores[n] === best && best > 0);
      data.games.push({ type: 'quiz', movieId: quiz.movieId, title: quiz.title, scores: quiz.scores, winners, of: quiz.qs.length, at: Date.now() });
      broadcast({ t: 'quiz', phase: 'end', id: quiz.id, scores: quiz.scores, winners, n: quiz.qs.length });
      quiz = null;
      changed('games');
    }, 4500);
  }

  // ---- Movie bingo ------------------------------------------------------------------------
  let bingo = null;

  // ---- Wishlist ---------------------------------------------------------------------------------
  const norm = (t) => String(t).toLowerCase().replace(/\(\d{4}\)/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  function wishesFulfilledBy(title) {
    const t = norm(title);
    for (const w of data.wishlist) {
      const n = norm(w.title);
      if (w.done || n.length < 3) continue;
      if (t === n || t.startsWith(`${n} `) || (n.length >= 6 && t.includes(n))) {
        w.done = true; w.doneAt = Date.now();
        notify({ title: 'Your wish came true 🌟', body: `${title} is ready to watch.`, evenIfOnline: true });
        changed('wishlist');
      }
    }
  }

  // ---- Watch progress (continue watching) ------------------------------------------
  let lastProgressAt = 0;
  function trackProgress(pos, force) {
    if (!room.movieId) return;
    if (!force && Date.now() - lastProgressAt < 10000) return;
    lastProgressAt = Date.now();
    const mv = listMovies().find((m) => m.id === room.movieId);
    if (!mv || !mv.duration) return;
    const p = data.progress[mv.id] || {};
    const frac = pos / mv.duration;
    p.pos = Math.max(0, pos);
    p.duration = mv.duration;
    p.at = Date.now();
    if (frac >= 0.92) p.done = true;
    else if (frac > 0.02 && frac < 0.85) p.done = false; // re-watching
    data.progress[mv.id] = p;
    save();
    // Nearly finished: time for the diary.
    if (frac >= 0.9 && !p.rated) { p.rated = true; askForRating(mv); }
  }

  // ---- Diary --------------------------------------------------------------------------
  function askForRating(mv) {
    const today = new Date().toISOString().slice(0, 10);
    let entry = data.diary.find((e) => e.movieId === mv.id && e.date === today);
    if (!entry) {
      entry = { id: id(), movieId: mv.id, title: mv.title, date: today, at: Date.now(), minutes: Math.round(mv.duration / 60), ratings: {} };
      data.diary.push(entry);
    }
    const preds = data.predictions[mv.id];
    if (preds) for (const pr of Object.values(preds)) pr.revealed = true;
    save();
    broadcast({ t: 'rateMe', entryId: entry.id, movieId: mv.id, title: mv.title });
    broadcast({ t: 'fchanged', what: 'diary' });
  }

  // ---- Snapshots -----------------------------------------------------------------------
  function saveSnapshot(buf, movieId, t, by, doodle) {
    if (!/^[a-z0-9-]+$/.test(movieId)) throw new Error('Bad movie');
    if (buf.length < 100 || buf[0] !== 0xff || buf[1] !== 0xd8) throw new Error('Not a JPEG image');
    fs.mkdirSync(SNAPS, { recursive: true });
    const file = `${movieId}-${Date.now()}.jpg`;
    fs.writeFileSync(path.join(SNAPS, file), buf);
    const mv = listMovies().find((m) => m.id === movieId);
    const snap = { file: `/personal/snapshots/${file}`, movieId, title: mv ? mv.title : movieId, t: Number(t) || 0, by, at: Date.now(), ...(doodle ? { doodle: true } : {}) };
    data.snaps.push(snap);
    changed('snaps');
    broadcast({ t: 'snap', by, title: snap.title });
    return snap;
  }

  // ---- Next episode & curtain countdown -----------------------------------------------
  let nextUp = null;
  function onEnded(movieId) {
    if (room.movieId !== movieId || nextUp) return;
    const mv = listMovies().find((m) => m.id === movieId);
    if (mv) { const p = data.progress[movieId] || {}; p.done = true; p.pos = mv.duration; p.at = Date.now(); data.progress[movieId] = p; if (!p.rated) { p.rated = true; askForRating(mv); } }
    const nx = Series.next(listMovies(), movieId);
    if (!nx) return;
    nextUp = { movieId: nx.id, title: nx.title, at: Date.now() + 12000 };
    nextUp.timer = setTimeout(playNext, 12000);
    broadcast({ t: 'nextUp', movieId: nx.id, title: nx.title, at: nextUp.at });
  }
  function playNext() {
    if (!nextUp) return;
    const nx = nextUp;
    clearTimeout(nx.timer);
    nextUp = null;
    broadcast({ t: 'nextUp', cancel: true });
    loadMovie(nx.movieId);
    setTimeout(() => startPlaying(), 1500);
  }
  function cancelNext() {
    if (!nextUp) return;
    clearTimeout(nextUp.timer);
    nextUp = null;
    broadcast({ t: 'nextUp', cancel: true });
  }

  // ---- Cuddle ------------------------------------------------------------------------------
  const holding = new Map(); // name -> since
  function cuddleState() {
    const holders = [...holding.keys()];
    broadcast({ t: 'cuddle', holders, on: holders.length >= 2 });
  }

  // ---- Countdown reminders ----------------------------------------------------------------
  let reminderTimers = [];
  function scheduleReminders() {
    for (const t of reminderTimers) clearTimeout(t);
    reminderTimers = [];
    if (!data.schedule || !data.schedule.at) return;
    const at = new Date(data.schedule.at).getTime();
    const plan = [[at - 30 * 60000, 'Movie night in 30 minutes 🍿', 'Get comfy!'], [at, "It's movie night! 🎬", 'Open Movie Night and press play together.']];
    for (const [when, title, body] of plan) {
      const wait = when - Date.now();
      if (wait > 0 && wait < 2147483647) reminderTimers.push(setTimeout(() => notify({ title, body, evenIfOnline: true }), wait));
    }
  }
  scheduleReminders();

  // ---- Push notifications ----------------------------------------------------------------
  let webpush = null;
  try { webpush = require('web-push'); } catch { /* not installed yet */ }
  function vapid() {
    if (!webpush) return { publicKey: null };
    if (!config.vapid) { config.vapid = webpush.generateVAPIDKeys(); saveConfig(); }
    return config.vapid;
  }
  async function notify({ title, body, except, url = '/', evenIfOnline = false }) {
    if (!webpush) return;
    const keys = vapid();
    const links = publicLinks();
    webpush.setVapidDetails(links.herSecure && links.her ? links.her.split('/?')[0] : 'mailto:movie-night@localhost', keys.publicKey, keys.privateKey);
    const online = new Set(names().map((n) => n.toLowerCase()));
    for (const [devId, s] of Object.entries(data.push)) {
      if (except && s.name.toLowerCase() === except.toLowerCase()) continue;
      if (!evenIfOnline && online.has(s.name.toLowerCase())) continue; // they're already in the app
      try {
        await webpush.sendNotification(s.sub, JSON.stringify({ title, body, url }), { TTL: 3600 });
      } catch (e) {
        if (e.statusCode === 404 || e.statusCode === 410) { delete data.push[devId]; save(); }
      }
    }
  }

  // ---- WebSocket messages ------------------------------------------------------------
  const lastChat = new Map();
  function handle(c, msg) {
    switch (msg.t) {
      case 'chat': {
        const text = String(msg.text || '').trim().slice(0, 240);
        if (!text || Date.now() - (lastChat.get(c.name) || 0) < 300) return true;
        lastChat.set(c.name, Date.now());
        broadcast({ t: 'chat', from: c.name, text, at: Date.now() });
        return true;
      }
      case 'hold':
        if (msg.on) holding.set(c.name, Date.now()); else holding.delete(c.name);
        cuddleState();
        return true;
      case 'note': {
        const text = String(msg.text || '').trim().slice(0, 300);
        if (!text || typeof msg.movieId !== 'string') return true;
        data.notes.push({ id: id(), movieId: msg.movieId, time: Math.max(0, Number(msg.time) || 0), from: c.name, text, at: Date.now() });
        changed('notes');
        return true;
      }
      case 'noteDelete':
        data.notes = data.notes.filter((n) => !(n.id === msg.id && n.from === c.name));
        changed('notes');
        return true;
      case 'rate': {
        const e = data.diary.find((x) => x.id === msg.entryId);
        if (!e) return true;
        e.ratings[c.name] = { stars: Math.max(1, Math.min(5, Number(msg.stars) || 0)), text: String(msg.text || '').trim().slice(0, 200), at: Date.now() };
        changed('diary');
        return true;
      }
      case 'vote': {
        if (typeof msg.key !== 'string' || msg.key.length > 120) return true;
        const v = data.votes[c.name] || (data.votes[c.name] = {});
        if (msg.v === 1 || msg.v === -1) v[msg.key] = msg.v; else delete v[msg.key];
        changed('votes');
        return true;
      }
      case 'votesReset':
        data.votes = {};
        changed('votes');
        return true;
      case 'wheel':
        // Everyone sees the same spin and the same winner.
        if (typeof msg.key === 'string') broadcast({ t: 'wheel', key: msg.key, keys: Array.isArray(msg.keys) ? msg.keys.slice(0, 40) : [], by: c.name, at: Date.now() + 300 });
        return true;
      case 'schedule': {
        const at = msg.at ? new Date(msg.at) : null;
        data.schedule = at && !Number.isNaN(at.getTime()) ? { at: at.toISOString(), by: c.name } : null;
        scheduleReminders();
        changed('schedule');
        return true;
      }
      case 'fav':
        if (typeof msg.movieId !== 'string') return true;
        if (msg.on) data.favorites[msg.movieId] = true; else delete data.favorites[msg.movieId];
        changed('favorites');
        return true;
      case 'seriesSettings': {
        if (typeof msg.key !== 'string' || msg.key.length > 80) return true;
        const s = data.series[msg.key] || (data.series[msg.key] = {});
        if (Number.isFinite(msg.intro)) s.intro = Math.max(10, Math.min(300, Math.round(msg.intro)));
        changed('series');
        return true;
      }
      case 'ended':
        onEnded(String(msg.movieId || ''));
        return true;
      case 'nextCancel':
        cancelNext();
        return true;
      case 'nextNow':
        playNext();
        return true;
      // ---- Fun & games ----
      case 'quizStart': {
        if (quiz) { sendTo(c, { t: 'quiz', phase: 'busy' }); return true; }
        const mv = movieById(String(msg.movieId || ''));
        const qs = mv && makeQuiz(mv);
        if (!qs) { sendTo(c, { t: 'quiz', phase: 'none', title: mv ? mv.title : '' }); return true; }
        quiz = { id: id(), movieId: mv.id, title: mv.title, qs, i: 0, scores: Object.fromEntries(names().map((n) => [n, 0])), answers: {} };
        quizQuestion();
        return true;
      }
      case 'quizAnswer':
        if (!quiz || quiz.phase !== 'q' || msg.id !== quiz.id || msg.i !== quiz.i || quiz.answers[c.name] !== undefined) return true;
        quiz.answers[c.name] = Math.max(0, Math.min(3, Number(msg.choice) || 0));
        if (!(c.name in quiz.scores)) quiz.scores[c.name] = 0;
        broadcast({ t: 'quiz', phase: 'answered', id: quiz.id, i: quiz.i, who: Object.keys(quiz.answers) });
        if (names().every((n) => quiz.answers[n] !== undefined)) quizReveal();
        return true;
      case 'quizStop':
        if (quiz) { clearTimeout(quiz.timer); quiz = null; broadcast({ t: 'quiz', phase: 'stop', by: c.name }); }
        return true;
      case 'bingoStart': {
        const mv = movieById(String(msg.movieId || room.movieId || ''));
        if (!mv) return true;
        bingo = { id: id(), movieId: mv.id, seed: Math.floor(Math.random() * 1e9), genres: (mv.tmdb && mv.tmdb.genres) || [], marks: {}, winners: [] };
        broadcast({ t: 'bingo', phase: 'start', by: c.name, ...publicState().bingo });
        return true;
      }
      case 'bingoMark':
        if (!bingo || msg.id !== bingo.id || !Array.isArray(msg.cells)) return true;
        bingo.marks[c.name] = msg.cells.filter((i) => Number.isInteger(i) && i >= 0 && i < 16).slice(0, 16);
        broadcast({ t: 'bingo', phase: 'marks', id: bingo.id, marks: bingo.marks });
        return true;
      case 'bingoWin':
        if (!bingo || msg.id !== bingo.id || bingo.winners.includes(c.name)) return true;
        bingo.winners.push(c.name);
        data.games.push({ type: 'bingo', movieId: bingo.movieId, winner: c.name, first: bingo.winners.length === 1, at: Date.now() });
        broadcast({ t: 'bingo', phase: 'win', id: bingo.id, by: c.name, first: bingo.winners.length === 1 });
        changed('games');
        return true;
      case 'bingoEnd':
        bingo = null;
        broadcast({ t: 'bingo', phase: 'end' });
        return true;
      case 'predict': {
        const mid = String(msg.movieId || '');
        if (!movieById(mid)) return true;
        const text = String(msg.text || '').trim().slice(0, 200);
        const stars = Math.max(0, Math.min(5, Math.round(Number(msg.stars) || 0)));
        if (!text && !stars) return true;
        (data.predictions[mid] || (data.predictions[mid] = {}))[c.name] = { text, stars, at: Date.now() };
        changed('predictions');
        broadcast({ t: 'predicted', by: c.name, movieId: mid });
        return true;
      }
      case 'doodle': {
        // Drawing on a paused frame: pass it straight to the other screen.
        const kind = ['stroke', 'clear', 'open', 'close'].includes(msg.kind) ? msg.kind : null;
        if (!kind) return true;
        const out = { t: 'doodle', kind, from: c.name };
        if (kind === 'stroke') {
          if (!Array.isArray(msg.pts)) return true;
          out.pts = msg.pts.slice(0, 400).map((v) => Math.max(0, Math.min(1, Number(v) || 0)));
          out.c = /^#[0-9a-f]{6}$/i.test(msg.c) ? msg.c : '#e5484d';
          out.w = Math.max(1, Math.min(30, Number(msg.w) || 6));
          out.sid = String(msg.sid || '').slice(0, 16);
        }
        broadcast(out);
        return true;
      }
      case 'wish': {
        const title = String(msg.title || '').trim().slice(0, 100);
        if (!title) return true;
        data.wishlist.push({ id: id(), title, by: c.name, at: Date.now(), done: false });
        if (data.wishlist.length > 100) data.wishlist.shift();
        changed('wishlist');
        notify({ title: 'Movie request 🎬', body: `${c.name} would love to watch ${title}`, except: c.name, evenIfOnline: true });
        return true;
      }
      case 'wishDone': {
        const w = data.wishlist.find((x) => x.id === msg.id);
        if (w) { w.done = !w.done; w.doneAt = Date.now(); changed('wishlist'); }
        return true;
      }
      case 'wishDelete':
        data.wishlist = data.wishlist.filter((x) => x.id !== msg.id);
        changed('wishlist');
        return true;
      case 'tz':
        if (typeof msg.tz === 'string' && msg.tz.length < 60) {
          const p = data.people[c.name] || (data.people[c.name] = {});
          if (p.tz !== msg.tz) { p.tz = msg.tz; changed('people'); }
        }
        return true;
      default:
        return false;
    }
  }

  function onDisconnect(c) {
    if (holding.delete(c.name)) cuddleState();
  }

  // ---- HTTP (/api/f/...) for both of you ------------------------------------------------
  function readRaw(req, limit) {
    return new Promise((resolve, reject) => {
      const chunks = []; let size = 0;
      req.on('data', (d) => { size += d.length; if (size > limit) { reject(new Error('Too large')); req.destroy(); } else chunks.push(d); });
      req.on('end', () => resolve(Buffer.concat(chunks)));
      req.on('error', reject);
    });
  }
  const json = (res, status, body) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); };

  async function http(req, res, pathname, url) {
    try {
      if (req.method === 'GET' && pathname === '/api/f/state') return json(res, 200, publicState());
      if (req.method === 'POST' && pathname === '/api/f/snapshot') {
        const buf = await readRaw(req, MAX_SNAPSHOT);
        const snap = saveSnapshot(buf, url.searchParams.get('movieId') || '', url.searchParams.get('t'), String(url.searchParams.get('by') || 'Someone').slice(0, 30), url.searchParams.get('doodle') === '1');
        return json(res, 200, snap);
      }
      if (req.method === 'POST' && pathname === '/api/f/push') {
        const body = JSON.parse((await readRaw(req, 16384)).toString('utf8') || '{}');
        if (!body.sub || !body.sub.endpoint || !/^https:\/\//.test(body.sub.endpoint) || typeof body.deviceId !== 'string') return json(res, 400, { error: 'Bad subscription' });
        data.push[body.deviceId.slice(0, 32)] = { name: String(body.name || 'Someone').slice(0, 30), sub: body.sub, at: Date.now() };
        save(true);
        return json(res, 200, {});
      }
      if (req.method === 'POST' && pathname === '/api/f/push-test') {
        await notify({ title: 'Notifications are on 🎀', body: "You'll hear from Movie Night here.", evenIfOnline: true });
        return json(res, 200, {});
      }
      return json(res, 404, { error: 'Not found' });
    } catch (e) {
      return json(res, 400, { error: e.message });
    }
  }

  return {
    handle, onDisconnect, http, trackProgress, notify, recordReaction, count,
    onMovieChanged: () => { if (bingo) { bingo = null; broadcast({ t: 'bingo', phase: 'end' }); } },
    progressOf: (movieId) => data.progress[movieId] || null,
    hasCountdownFor: (movieId) => (data.progress[movieId] || {}).pos > 3,
    onNewMovie: (title) => { notify({ title: 'New movie ready 🎬', body: `${title} is ready to watch.` }); wishesFulfilledBy(title); },
    onMovieLoaded: (title, by, surprise) => notify({ title: `${by} started Movie Night 🍿`, body: surprise ? '🎁 A surprise movie!' : title, except: by }),
    snapsDir: SNAPS,
  };
};
