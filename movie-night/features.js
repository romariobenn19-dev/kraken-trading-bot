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

module.exports = function createFeatures({ ROOT, config, saveConfig, broadcast, clients, room, listMovies, loadMovie, startPlaying, publicLinks }) {
  const DATA_FILE = path.join(ROOT, 'data.json');
  const SNAPS = path.join(ROOT, 'personal', 'snapshots');
  let data = {};
  try { data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch { /* first run */ }
  data = {
    progress: {}, diary: [], notes: [], votes: {}, schedule: null, people: {}, series: {}, favorites: {}, snaps: [], push: {},
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
    };
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
    save();
    broadcast({ t: 'rateMe', entryId: entry.id, movieId: mv.id, title: mv.title });
    broadcast({ t: 'fchanged', what: 'diary' });
  }

  // ---- Snapshots -----------------------------------------------------------------------
  function saveSnapshot(buf, movieId, t, by) {
    if (!/^[a-z0-9-]+$/.test(movieId)) throw new Error('Bad movie');
    if (buf.length < 100 || buf[0] !== 0xff || buf[1] !== 0xd8) throw new Error('Not a JPEG image');
    fs.mkdirSync(SNAPS, { recursive: true });
    const file = `${movieId}-${Date.now()}.jpg`;
    fs.writeFileSync(path.join(SNAPS, file), buf);
    const mv = listMovies().find((m) => m.id === movieId);
    const snap = { file: `/personal/snapshots/${file}`, movieId, title: mv ? mv.title : movieId, t: Number(t) || 0, by, at: Date.now() };
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
        const snap = saveSnapshot(buf, url.searchParams.get('movieId') || '', url.searchParams.get('t'), String(url.searchParams.get('by') || 'Someone').slice(0, 30));
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
    handle, onDisconnect, http, trackProgress, notify,
    progressOf: (movieId) => data.progress[movieId] || null,
    hasCountdownFor: (movieId) => (data.progress[movieId] || {}).pos > 3,
    onNewMovie: (title) => notify({ title: 'New movie ready 🎬', body: `${title} is ready to watch.` }),
    onMovieLoaded: (title, by) => notify({ title: `${by} started Movie Night 🍿`, body: title, except: by }),
    snapsDir: SNAPS,
  };
};
