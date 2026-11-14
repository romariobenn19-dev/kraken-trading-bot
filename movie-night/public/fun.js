/* Movie Night - fun & games: seasonal themes, dress-up, reaction marks & replay, kisses,
 * snack breaks, doodles, quote quiz, predictions, movie bingo, badges, Our Year Wrapped,
 * postcards, mood picker, wishlist and surprise movies.
 * Uses globals from app.js, home.js and together.js. */
'use strict';

const EMOJI = { love: '😍', laugh: '😂', cry: '😭', shock: '😮', kiss: '😘' };
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const coupleNames = () => (personalInfo.him && personalInfo.her ? `${personalInfo.him} & ${personalInfo.her}` : 'You two');
const genresOf = (movieId) => { const mv = movies.find((m) => m.id === movieId); return (mv && mv.tmdb && mv.tmdb.genres) || []; };
const reducedMotion = () => window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

// =================================================================================
// Seasons: snow at Christmas, bats at Halloween, hearts for Valentine's & your anniversary
// =================================================================================
function currentSeason(d = new Date()) {
  const forced = new URLSearchParams(location.search).get('season') || store.get('mn_season');
  if (forced) return forced === 'none' ? null : forced;
  const m = d.getMonth() + 1, day = d.getDate();
  if (personalInfo.since) {
    const s = new Date(`${personalInfo.since}T00:00:00`);
    if (s.getMonth() + 1 === m && s.getDate() === day && d.getFullYear() > s.getFullYear()) return 'anniversary';
  }
  if ((m === 12 && day === 31) || (m === 1 && day === 1)) return 'newyear';
  if (m === 12) return 'christmas';
  if (m === 10 && day >= 15) return 'halloween';
  if (m === 2 && day >= 7 && day <= 14) return 'valentine';
  return null;
}
const SEASONS = {
  christmas: { fx: ['❄', '❅', '❆'], banner: () => `🎄 Merry Christmas, ${coupleNames()}! Cosy movie season is here.` },
  halloween: { fx: ['🦇', '🎃', '👻'], banner: () => '🎃 Spooky season: scary movies hit different under a blanket.' },
  valentine: { fx: ['💗', '💕', '🌹'], banner: () => `💘 Happy Valentine's week, ${coupleNames()}!` },
  newyear: { fx: ['🎉', '✨', '🥂'], banner: () => '🎆 Happy New Year! Here\'s to a year of movie nights.' },
  anniversary: {
    fx: ['💞', '💖', '🌸'],
    banner: () => {
      const years = new Date().getFullYear() - new Date(`${personalInfo.since}T00:00:00`).getFullYear();
      return `💞 Happy anniversary, ${coupleNames()}! ${years} year${years === 1 ? '' : 's'} together today.`;
    },
  },
};
let seasonShown = undefined;
function applySeason() {
  const season = currentSeason();
  document.body.dataset.season = season || '';
  const b = $('seasonBanner');
  if (season && SEASONS[season]) { b.textContent = SEASONS[season].banner(); b.classList.remove('hidden'); } else b.classList.add('hidden');
  if (season === seasonShown) return;
  seasonShown = season;
  const fx = $('seasonFx');
  fx.innerHTML = '';
  if (!season || !SEASONS[season] || reducedMotion()) return;
  for (let i = 0; i < 16; i++) {
    const p = document.createElement('span');
    p.textContent = pick(SEASONS[season].fx);
    p.style.left = `${Math.random() * 100}%`;
    p.style.animationDelay = `${-Math.random() * 18}s`;
    p.style.animationDuration = `${12 + Math.random() * 10}s`;
    p.style.fontSize = `${12 + Math.random() * 14}px`;
    fx.appendChild(p);
  }
  drawDressUp();
}

// =================================================================================
// Dress-up: the three of us dressed for the movie (and the season)
// =================================================================================
function dressed(genres, faceOverride) {
  const o = Art.outfitFor(genres, currentSeason());
  return Art.couple(faceOverride || o.face, o.extras);
}
function drawDressUp() {
  const season = currentSeason();
  const extras = Art.outfitFor([], season).extras.filter((x) => x !== 'popcorn');
  $('joinArt').innerHTML = Art.couple('smile', extras);
  $('emptyArt').innerHTML = Art.couple('laugh', [...extras, 'popcorn']);
}
let holdArtKey = '';
function updateHoldArt() {
  // While getting ready to start, show us dressed for this movie; while re-buffering, the pup fetching.
  const starting = state && meta && state.hold && state.hold.reason === 'starting' && !state.surprise;
  const key = starting ? `couple:${meta.id}` : 'pup';
  if (key === holdArtKey) return;
  holdArtKey = key;
  $('holdArt').innerHTML = starting ? dressed(genresOf(meta.id)) : Art.fetchingPup();
  $('holdArt').classList.toggle('dressed', !!starting);
}

// =================================================================================
// Reactions: marks on the seek bar, replay from last time, kisses
// =================================================================================
let sessionStart = Date.now();
let lastCt = null;
function onReactEvent(m) {
  if (m.movieId && Number.isFinite(m.pos)) {
    fstate.reactions = fstate.reactions || [];
    fstate.reactions.push({ movieId: m.movieId, t: m.pos, key: m.emoji, by: m.from, at: m.at || Date.now() });
    renderReactMarks();
  }
  if (m.emoji === 'kiss') showLips(m.from);
}
function renderReactMarks() {
  const el = $('reactMarks');
  const d = meta ? duration() : 0;
  if (!meta || !d) { el.innerHTML = ''; return; }
  const rs = (fstate.reactions || []).filter((r) => r.movieId === meta.id);
  const N = 80;
  const buckets = new Map();
  for (const r of rs) {
    const i = Math.min(N - 1, Math.floor((r.t / d) * N));
    const b = buckets.get(i) || { n: 0, keys: {} };
    b.n++; b.keys[r.key] = (b.keys[r.key] || 0) + 1;
    buckets.set(i, b);
  }
  el.innerHTML = [...buckets].map(([i, b]) => {
    const top = Object.entries(b.keys).sort((x, y) => y[1] - x[1])[0][0];
    const size = Math.min(22, 11 + b.n * 2);
    return `<span style="left:${((i + 0.5) / N) * 100}%;font-size:${size}px" title="${b.n} reaction${b.n === 1 ? '' : 's'}">${EMOJI[top] || '💗'}</span>`;
  }).join('');
}
video.addEventListener('loadedmetadata', renderReactMarks);
video.addEventListener('timeupdate', () => {
  const ct = video.currentTime;
  if (meta && !video.paused && lastCt !== null && ct > lastCt && ct - lastCt < 1.5) {
    // Reactions from an earlier viewing of this movie pop up at the same moment.
    const old = (fstate.reactions || []).filter((r) => r.movieId === meta.id && r.at < sessionStart - 30 * 60000 && r.t > lastCt && r.t <= ct);
    for (const r of old.slice(0, 2)) {
      floatEmoji(r.key, `${r.by === myName() ? 'You' : r.by} · last time`);
      const f = $('floaters').lastElementChild;
      if (f) f.classList.add('replay');
    }
  }
  lastCt = ct;
});
function showLips(from) {
  const el = document.createElement('div');
  el.className = 'lips-mark';
  el.style.left = `${15 + Math.random() * 60}%`;
  el.style.top = `${15 + Math.random() * 45}%`;
  el.style.transform = `rotate(${Math.round(Math.random() * 40 - 20)}deg)`;
  el.innerHTML = `${Art.lips()}<small></small>`;
  el.querySelector('small').textContent = from === myName() ? 'You sent a kiss' : `A kiss from ${from}`;
  (meta ? $('lipsLayer') : document.body).appendChild(el);
  setTimeout(() => el.remove(), 4200);
}

// =================================================================================
// The ✨ menu in the player
// =================================================================================
const FUN_ITEMS = [
  { id: 'snack', icon: '🍿', label: 'Snack break (5 min)', run: () => send({ t: 'intermission', minutes: 5 }) },
  { id: 'doodle', icon: '✏️', label: 'Doodle on this moment', run: () => openDoodle(true) },
  { id: 'bingo', icon: '🎯', label: 'Movie bingo', run: () => toggleBingo() },
  { id: 'predict', icon: '🔮', label: 'Make a prediction', run: () => meta && openPredict(meta.id) },
  { id: 'kiss', icon: '💋', label: 'Send a kiss', run: () => send({ t: 'react', emoji: 'kiss' }) },
  { id: 'quiz', icon: '🎬', label: 'Quote quiz', run: () => meta && startQuiz(meta.id) },
];
$('funMenu').innerHTML = FUN_ITEMS.map((it) => `<button role="menuitem" data-fun="${it.id}"><span>${it.icon}</span>${escapeHtml(it.label)}</button>`).join('');
for (const b of $('funMenu').querySelectorAll('[data-fun]')) {
  b.onclick = (e) => { e.stopPropagation(); $('funMenu').classList.add('hidden'); FUN_ITEMS.find((x) => x.id === b.dataset.fun).run(); };
}
$('funBtn').onclick = (e) => { e.stopPropagation(); $('funMenu').classList.toggle('hidden'); showChrome(); };
document.addEventListener('click', (e) => { if (!$('funMenu').contains(e.target) && e.target !== $('funBtn')) $('funMenu').classList.add('hidden'); });

// =================================================================================
// Snack break (intermission)
// =================================================================================
let snackTimer = null;
function renderSnackBreak() {
  const el = $('intermission');
  const im = state && state.intermission;
  if (!im || !meta) {
    el.classList.remove('snack');
    clearInterval(snackTimer); snackTimer = null;
    return false;
  }
  if (!el.classList.contains('snack')) {
    el.classList.add('snack');
    el.innerHTML = `<div class="snack-art">${Art.couple('laugh', ['popcorn', ...Art.outfitFor([], currentSeason()).extras.filter((x) => x !== 'popcorn')])}</div>
      <h2>Snack break 🍿</h2><div class="snack-time" id="snackTime"></div><p class="muted" id="snackBy"></p>
      <div class="row"><button class="ghost" id="snackMore">+2 min</button><button class="primary" id="snackEnd">▶ Back to the movie</button></div>`;
    $('snackMore').onclick = (e) => { e.stopPropagation(); send({ t: 'intermissionMore' }); };
    $('snackEnd').onclick = (e) => { e.stopPropagation(); send({ t: 'intermissionEnd' }); };
  }
  $('snackBy').textContent = `${im.by === myName() ? 'You' : im.by} called a break. Grab snacks, the movie carries on together when the timer ends.`;
  const tick = () => {
    const left = Math.max(0, Math.ceil(((state.intermission ? state.intermission.until : 0) - serverNow()) / 1000));
    const t = $('snackTime');
    if (t) t.textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
  };
  tick();
  if (!snackTimer) snackTimer = setInterval(tick, 500);
  el.classList.remove('hidden');
  return true;
}

// =================================================================================
// Doodle on a paused frame (both screens see the drawing)
// =================================================================================
const doodle = { open: false, strokes: [], color: '#e5484d', width: 6, current: null, pending: [], timer: null };
const DOODLE_COLORS = ['#e5484d', '#f2a0a0', '#ffffff', '#f3d27a', '#3fb6e5', '#2b1d17'];
function videoRect() {
  const st = $('stage').getBoundingClientRect();
  const vw = video.videoWidth || 16, vh = video.videoHeight || 9;
  const scale = Math.min(st.width / vw, st.height / vh);
  const w = vw * scale, h = vh * scale;
  return { x: (st.width - w) / 2, y: (st.height - h) / 2, w, h, sw: st.width, sh: st.height };
}
function openDoodle(mine) {
  if (!meta) return;
  if (mine) {
    if (state && !state.paused) send({ t: 'pause', pos: expectedPos() });
    send({ t: 'doodle', kind: 'open' });
  }
  if (doodle.open) return;
  doodle.open = true;
  doodle.strokes = [];
  $('doodleBar').innerHTML = `${DOODLE_COLORS.map((c) => `<button class="swatch ${c === doodle.color ? 'on' : ''}" data-c="${c}" style="background:${c}" aria-label="Colour"></button>`).join('')}
    <button class="ghost small" id="doodleSize">${doodle.width > 8 ? 'Thin' : 'Thick'}</button>
    <button class="ghost small" id="doodleClear">Clear</button>
    <button class="ghost small" id="doodleSave">💾 Save to diary</button>
    <button class="primary small" id="doodleDone">Done</button>`;
  for (const b of $('doodleBar').querySelectorAll('.swatch')) b.onclick = () => {
    doodle.color = b.dataset.c;
    for (const x of $('doodleBar').querySelectorAll('.swatch')) x.classList.toggle('on', x === b);
  };
  $('doodleSize').onclick = () => { doodle.width = doodle.width > 8 ? 6 : 14; $('doodleSize').textContent = doodle.width > 8 ? 'Thin' : 'Thick'; };
  $('doodleClear').onclick = () => { send({ t: 'doodle', kind: 'clear' }); clearDoodle(); };
  $('doodleSave').onclick = saveDoodle;
  $('doodleDone').onclick = () => { send({ t: 'doodle', kind: 'close' }); closeDoodle(); };
  $('doodleCanvas').classList.remove('hidden');
  $('doodleBar').classList.remove('hidden');
  sizeDoodle();
  if (!mine) toast('✏️ Doodle time! Draw on the picture, you\'ll both see it.');
}
function closeDoodle() {
  doodle.open = false;
  $('doodleCanvas').classList.add('hidden');
  $('doodleBar').classList.add('hidden');
}
function clearDoodle() { doodle.strokes = []; redrawDoodle(); }
function sizeDoodle() {
  const c = $('doodleCanvas');
  const r = videoRect();
  const dpr = window.devicePixelRatio || 1;
  c.style.left = `${r.x}px`; c.style.top = `${r.y}px`; c.style.width = `${r.w}px`; c.style.height = `${r.h}px`;
  c.width = Math.round(r.w * dpr); c.height = Math.round(r.h * dpr);
  redrawDoodle();
}
window.addEventListener('resize', () => { if (doodle.open) sizeDoodle(); });
function drawStroke(ctx, s, w, h) {
  if (s.pts.length < 2) return;
  ctx.strokeStyle = s.c; ctx.lineWidth = (s.w * w) / 1000; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(s.pts[0] * w, s.pts[1] * h);
  for (let i = 2; i < s.pts.length; i += 2) ctx.lineTo(s.pts[i] * w, s.pts[i + 1] * h);
  if (s.pts.length === 2) ctx.lineTo(s.pts[0] * w + 0.1, s.pts[1] * h);
  ctx.stroke();
}
function redrawDoodle() {
  const c = $('doodleCanvas');
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, c.width, c.height);
  for (const s of doodle.strokes) drawStroke(ctx, s, c.width, c.height);
}
function addRemoteStroke(m) {
  let s = doodle.strokes.find((x) => x.sid === m.sid && x.from === m.from);
  if (!s) { s = { sid: m.sid, from: m.from, c: m.c, w: m.w, pts: [] }; doodle.strokes.push(s); }
  s.pts.push(...m.pts);
  redrawDoodle();
}
(function wireDoodleCanvas() {
  const c = $('doodleCanvas');
  const pt = (e) => { const r = c.getBoundingClientRect(); return [Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)), Math.max(0, Math.min(1, (e.clientY - r.top) / r.height))]; };
  const flush = () => {
    if (!doodle.current || !doodle.pending.length) return;
    send({ t: 'doodle', kind: 'stroke', sid: doodle.current.sid, c: doodle.current.c, w: doodle.current.w, pts: doodle.pending });
    // Keep the last point so the next piece joins up.
    doodle.pending = doodle.pending.slice(-2);
  };
  c.addEventListener('pointerdown', (e) => {
    e.preventDefault(); e.stopPropagation();
    c.setPointerCapture(e.pointerId);
    const p = pt(e);
    doodle.current = { sid: Math.random().toString(36).slice(2, 10), from: myName(), c: doodle.color, w: doodle.width, pts: [...p], mine: true };
    doodle.strokes.push(doodle.current);
    doodle.pending = [...p];
    clearInterval(doodle.timer);
    doodle.timer = setInterval(flush, 90);
    redrawDoodle();
  });
  c.addEventListener('pointermove', (e) => {
    if (!doodle.current) return;
    const p = pt(e);
    doodle.current.pts.push(...p);
    doodle.pending.push(...p);
    if (doodle.pending.length > 360) flush();
    redrawDoodle();
  });
  const end = () => { if (!doodle.current) return; flush(); clearInterval(doodle.timer); doodle.current = null; doodle.pending = []; };
  c.addEventListener('pointerup', end);
  c.addEventListener('pointercancel', end);
  c.addEventListener('click', (e) => e.stopPropagation());
})();
async function saveDoodle() {
  if (!meta || !video.videoWidth) return;
  const scale = Math.min(1, 1280 / video.videoWidth);
  const w = Math.round(video.videoWidth * scale), h = Math.round(video.videoHeight * scale);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  ctx.drawImage(video, 0, 0, w, h);
  for (const s of doodle.strokes) drawStroke(ctx, s, w, h);
  const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9));
  if (!blob) return;
  try {
    const r = await fetch(`/api/f/snapshot?movieId=${encodeURIComponent(meta.id)}&t=${video.currentTime.toFixed(1)}&by=${encodeURIComponent(myName())}&doodle=1`,
      { method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: blob });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.status);
  } catch (err) { toast(`Couldn't save the doodle: ${err.message}`); }
}

// =================================================================================
// Predictions (secret until the end of the movie)
// =================================================================================
let predictFor = null;
let predictStars = 0;
function openPredict(movieId) {
  predictFor = movieId;
  const mine = (() => { try { return JSON.parse(store.get(`mn_pred_${movieId}`) || 'null'); } catch { return null; } })();
  $('predictText').value = mine ? mine.text : '';
  predictStars = mine ? mine.stars : 0;
  renderPredictStars();
  $('predictSheet').classList.remove('hidden');
  $('predictText').focus();
}
function renderPredictStars() {
  $('predictStars').innerHTML = [1, 2, 3, 4, 5].map((n) => `<button class="star ${n <= predictStars ? 'on' : ''}" role="radio" aria-checked="${n === predictStars}" aria-label="${n} stars" data-n="${n}">★</button>`).join('');
  for (const b of $('predictStars').querySelectorAll('.star')) b.onclick = () => { predictStars = Number(b.dataset.n); renderPredictStars(); };
}
$('predictText').addEventListener('keydown', (e) => e.stopPropagation());
$('predictSave').onclick = () => {
  const text = $('predictText').value.trim();
  if (!text && !predictStars) { toast('Write a guess or pick the stars 🔮'); return; }
  send({ t: 'predict', movieId: predictFor, text, stars: predictStars });
  store.set(`mn_pred_${predictFor}`, JSON.stringify({ text, stars: predictStars }));
  $('predictSheet').classList.add('hidden');
  toast('🔮 Sealed! You\'ll both see it at the end.');
};
function predictionsHtml(movieId) {
  const preds = (fstate.predictions || {})[movieId];
  if (!preds) return '';
  const shown = Object.entries(preds).filter(([, p]) => p.revealed);
  if (!shown.length) return '';
  return `<div class="preds"><div class="field-title">🔮 Your predictions</div>${shown.map(([n, p]) => `<div class="pred"><span class="avatar">${Art.head(avatarFor({ name: n }))}</span>
    <span><b>${escapeHtml(n)}</b>${p.stars ? ` guessed <span class="stars">${'★'.repeat(p.stars)}</span>` : ''}${p.text ? `<br><q>${escapeHtml(p.text)}</q>` : ''}</span></div>`).join('')}</div>`;
}
let nudgeTimer = null;
function maybeNudgePrediction() {
  if (!meta || !state || state.pos > 60 || state.surprise) return;
  const preds = (fstate.predictions || {})[meta.id] || {};
  if (preds[myName()] && !preds[myName()].revealed) return;
  let el = document.querySelector('.nudge');
  if (!el) { el = document.createElement('div'); el.className = 'nudge'; $('stage').appendChild(el); }
  el.innerHTML = '<span>🔮 Make a secret prediction before it starts?</span><button class="primary small">Predict</button><button class="ghost small" aria-label="No thanks">✕</button>';
  el.querySelector('.primary').onclick = (e) => { e.stopPropagation(); el.remove(); openPredict(meta.id); };
  el.querySelector('.ghost').onclick = (e) => { e.stopPropagation(); el.remove(); };
  clearTimeout(nudgeTimer);
  nudgeTimer = setTimeout(() => el.remove(), 15000);
}

// =================================================================================
// Quote quiz (made from the movie's subtitles; you both answer, scores at the end)
// =================================================================================
let quiz = null;
function startQuiz(movieId) { send({ t: 'quizStart', movieId }); }
function onQuiz(m) {
  const body = $('quizBody');
  if (m.phase === 'none') { toast(m.title ? `"${m.title}" has no subtitles to make a quiz from. Add some with CC+ on the laptop.` : 'No subtitles to make a quiz from.', 6000); return; }
  if (m.phase === 'busy') { toast('A quiz is already running.'); $('quizSheet').classList.remove('hidden'); return; }
  if (m.phase === 'stop') { $('quizSheet').classList.add('hidden'); quiz = null; toast(`${m.by === myName() ? 'You' : m.by} ended the quiz.`); return; }
  if (m.phase === 'q') {
    quiz = { id: m.id, i: m.i, n: m.n, q: m.q, title: m.title || (quiz && quiz.title), endsAt: m.endsAt, mine: null, scores: m.scores };
    const scores = Object.entries(m.scores || {}).map(([n, v]) => `<span class="qscore"><span class="avatar">${Art.head(avatarFor({ name: n }))}</span>${escapeHtml(n)} <b>${v}</b></span>`).join('');
    body.innerHTML = `<header class="sheet-head"><b>🎬 Quote quiz</b><button class="ghost small" id="quizClose" aria-label="Close">✕</button></header>
      <div class="quiz-main">
        <div class="muted small">${escapeHtml(quiz.title || '')} · question ${m.i + 1} of ${m.n}</div>
        <div class="quiz-kind">${m.q.type === 'finish' ? 'Finish the line' : m.q.type === 'first' ? 'Which came first?' : 'When was this said?'}</div>
        <p class="quiz-prompt"></p>
        <div class="quiz-options">${m.q.options.map((o, i) => `<button class="quiz-opt" data-i="${i}"><span class="opt-letter">${'ABCD'[i]}</span><span class="opt-text"></span><span class="opt-who"></span></button>`).join('')}</div>
        <div class="quiz-timer"><i id="quizBar"></i></div>
        <div class="quiz-scores">${scores}</div>
        <div class="muted small" id="quizWho"></div>
      </div>`;
    body.querySelector('.quiz-prompt').textContent = m.q.prompt;
    body.querySelectorAll('.opt-text').forEach((el, i) => { el.textContent = m.q.options[i]; });
    for (const b of body.querySelectorAll('.quiz-opt')) b.onclick = () => {
      if (!quiz || quiz.mine !== null) return;
      quiz.mine = Number(b.dataset.i);
      b.classList.add('picked');
      for (const x of body.querySelectorAll('.quiz-opt')) x.disabled = true;
      send({ t: 'quizAnswer', id: quiz.id, i: quiz.i, choice: quiz.mine });
    };
    $('quizClose').onclick = closeQuizSheet;
    $('quizSheet').classList.remove('hidden');
    const total = m.endsAt - serverNow();
    const tick = () => {
      const bar = $('quizBar');
      if (!bar || !quiz || quiz.i !== m.i) return;
      bar.style.width = `${Math.max(0, ((quiz.endsAt - serverNow()) / total) * 100)}%`;
      requestAnimationFrame(tick);
    };
    tick();
    return;
  }
  if (!quiz || m.id !== quiz.id) return;
  if (m.phase === 'answered') {
    const others = m.who.filter((n) => n !== myName());
    $('quizWho').textContent = others.length ? `✓ ${others.join(' & ')} answered` : '';
  }
  if (m.phase === 'reveal') {
    quiz.i = -1; // stops the timer bar
    const opts = body.querySelectorAll('.quiz-opt');
    opts.forEach((b, i) => {
      b.disabled = true;
      if (i === m.correct) b.classList.add('right');
      else if (i === quiz.mine) b.classList.add('wrong');
      const who = Object.entries(m.answers).filter(([, a]) => a === i).map(([n]) => `<span class="avatar">${Art.head(avatarFor({ name: n }))}</span>`).join('');
      b.querySelector('.opt-who').innerHTML = who;
    });
    $('quizWho').textContent = quiz.mine === m.correct ? '🎉 You got it!' : quiz.mine === null ? 'Too slow! ⏰' : 'Not quite 🙈';
  }
  if (m.phase === 'end') {
    const entries = Object.entries(m.scores).sort((a, b) => b[1] - a[1]);
    const headline = !m.winners.length ? 'Nobody scored. Rewatch time? 😄'
      : m.winners.length > 1 ? `It's a tie! ${m.winners.join(' & ')} 💞` : `🏆 ${m.winners[0] === myName() ? 'You win' : `${m.winners[0]} wins`}!`;
    body.innerHTML = `<header class="sheet-head"><b>🎬 Quote quiz</b><button class="ghost small" id="quizClose" aria-label="Close">✕</button></header>
      <div class="quiz-main quiz-end"><div class="quiz-art">${Art.couple(m.winners.length ? 'laugh' : 'smile', ['party'])}</div>
        <h2>${escapeHtml(headline)}</h2>
        <div class="quiz-scores big">${entries.map(([n, v]) => `<span class="qscore"><span class="avatar">${Art.head(avatarFor({ name: n }))}</span>${escapeHtml(n)} <b>${v}/${m.n}</b></span>`).join('')}</div>
        <p class="muted small">Saved to your diary.</p>
        <button class="primary" id="quizDone">Close</button></div>`;
    $('quizClose').onclick = closeQuizSheet;
    $('quizDone').onclick = closeQuizSheet;
    quiz = null;
    burstHearts();
  }
}
function closeQuizSheet() {
  $('quizSheet').classList.add('hidden');
  if (quiz && confirm('End the quiz for both of you?')) send({ t: 'quizStop' });
}

// =================================================================================
// Movie bingo
// =================================================================================
const TROPES = {
  any: ['Someone says the movie\'s title', 'A phone with no signal', '"We need to talk"', 'Slow-motion walk', 'Someone trips while running',
    'A dramatic rainstorm', 'Flashback scene', '"I can explain"', 'Dog or cat on screen', 'Someone eats on screen', 'A car won\'t start',
    'Someone looks in a mirror', '"Trust me"', 'Hug that lasts too long', 'Someone says "wait"', 'Food gets spilled', 'A text message on screen',
    'Someone says "I\'m fine"', 'Dramatic music swell', 'A plan goes wrong', 'Someone gets slapped', 'Kiss in the rain'],
  Horror: ['Lights flicker', 'Jump scare', '"Hello? Is anyone there?"', 'They split up', 'Creepy child', 'Mirror scare', 'Door opens by itself',
    'Cat jump scare', 'Basement trip', 'Creepy doll', 'Someone hides in a closet', 'Old book of spells', 'Phone line goes dead', 'Running upstairs',
    'Final girl', 'It\'s not dead yet', 'Flashlight dies', 'Ominous whisper'],
  Action: ['Walks away from explosion', 'Hero loses a shoe/weapon', 'Car chase', 'Villain monologue', '"Let\'s do this"', 'Countdown timer',
    'Bad guys can\'t aim', 'Hero gets shot, keeps going', 'Rooftop fight', 'Helicopter', 'One-liner after a kill', 'Hacking scene',
    'Glass shatters in slow-mo', 'Sidekick saves the day', 'Fight on a moving vehicle', 'Hero is "too old for this"'],
  Romance: ['Meet cute', 'Almost-kiss interrupted', 'Big romantic speech', 'Running through an airport', 'Misunderstanding',
    'Best friend gives advice', 'Dancing in the kitchen', 'Rival love interest', 'Makeover moment', 'Rain kiss', 'Letter or note',
    'Wedding scene', '"It was always you"', 'Grand gesture', 'Montage of dates', 'Bumping into each other'],
  Comedy: ['Awkward silence', 'Someone falls over', 'Embarrassing parent', 'Spit-take', 'Wrong person overhears', 'Physical comedy',
    'Disguise that fools no one', 'Mistaken identity', 'Party gets out of hand', 'Someone gets stuck', 'Wedding goes wrong',
    'Fake accent', 'Things break in a shop', 'Cringe dance', 'Plan explained with props', 'Animal causes chaos'],
  Drama: ['Someone cries alone', 'Hospital scene', 'Sad phone call', 'Staring out a window', 'Funeral', 'Big family argument',
    'Letter read out loud', 'Old photos', 'Someone leaves without goodbye', 'Speech that makes you cry', 'Rain + sadness',
    'Kid says something wise', 'Secret revealed', 'Apology scene', 'Sunset reflection', 'Packing a suitcase'],
  'Science Fiction': ['Spaceship alarm', 'Robot learns feelings', '"It\'s impossible!"', 'Laser fight', 'Time travel paradox',
    'Aliens!', 'Hologram message', 'Countdown to launch', 'Scientist ignored', 'Futuristic city', 'Hyperspace jump',
    'Mysterious signal', 'Suit malfunction', 'Computer voice', 'Clone or double', 'Planet in danger'],
  Animation: ['Musical number', 'Talking animal', 'Comic-relief sidekick', 'Villain has a lair', 'Parent is missing',
    'Magical transformation', 'Big chase scene', 'Friendship lesson', 'Goofy fall', 'Sparkles!', 'Wish comes true',
    'Montage with a song', 'Cute sneeze', 'Dramatic gasp', 'Team-up at the end', 'Happy ending dance'],
};
const TROPE_GROUP = { Thriller: 'Horror', Mystery: 'Horror', Adventure: 'Action', Crime: 'Action', War: 'Action', Fantasy: 'Science Fiction',
  Family: 'Animation', Music: 'Animation' };
function mulberry(seed) { return () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
let bingo = null; // { id, movieId, card: [16 strings], mine: Set, marks: {name:[...]}, won }
function bingoCard(seed, genres) {
  const groups = [...new Set((genres || []).map((g) => TROPE_GROUP[g] || g).filter((g) => TROPES[g]))];
  const special = groups.flatMap((g) => TROPES[g]);
  const rnd = mulberry(seed + hash(myName()));
  const shuffled = (a) => a.map((x) => [rnd(), x]).sort((p, q) => p[0] - q[0]).map((p) => p[1]);
  const fromSpecial = shuffled(special).slice(0, special.length ? 10 : 0);
  const rest = shuffled(TROPES.any.filter((x) => !fromSpecial.includes(x))).slice(0, 16 - fromSpecial.length);
  return shuffled([...fromSpecial, ...rest]);
}
const LINES = [[0, 1, 2, 3], [4, 5, 6, 7], [8, 9, 10, 11], [12, 13, 14, 15], [0, 4, 8, 12], [1, 5, 9, 13], [2, 6, 10, 14], [3, 7, 11, 15], [0, 5, 10, 15], [3, 6, 9, 12]];
const hasLine = (set) => LINES.some((l) => l.every((i) => set.has(i)));
function loadBingo(b) {
  if (!b) { bingo = null; renderBingo(); return; }
  const same = bingo && bingo.id === b.id;
  bingo = {
    id: b.id, movieId: b.movieId, card: bingoCard(b.seed, b.genres), marks: b.marks || {},
    mine: same ? bingo.mine : new Set((b.marks || {})[myName()] || []), won: same ? bingo.won : (b.winners || []).includes(myName()),
    open: same ? bingo.open : true,
  };
  renderBingo();
}
function toggleBingo() {
  if (!meta) return;
  if (!bingo || bingo.movieId !== meta.id) { send({ t: 'bingoStart', movieId: meta.id }); return; }
  bingo.open = !bingo.open;
  renderBingo();
}
function renderBingo() {
  const el = $('bingoPanel');
  if (!bingo || !meta || bingo.movieId !== meta.id) { el.classList.add('hidden'); return; }
  el.classList.remove('hidden');
  el.classList.toggle('collapsed', !bingo.open);
  const others = Object.entries(bingo.marks).filter(([n]) => n !== myName());
  if (!bingo.open) {
    el.innerHTML = `<button class="bingo-chip" id="bingoOpen">🎯 Bingo · ${bingo.mine.size}/16</button>`;
    $('bingoOpen').onclick = (e) => { e.stopPropagation(); bingo.open = true; renderBingo(); };
    return;
  }
  el.innerHTML = `<div class="bingo-head"><b>🎯 Movie bingo</b>
      <span class="muted small">${others.map(([n, cells]) => `${escapeHtml(n)}: ${cells.length} marked`).join(' · ') || 'Tap a square when it happens'}</span>
      <button class="ghost small" id="bingoMin" aria-label="Hide bingo card">–</button></div>
    <div class="bingo-grid">${bingo.card.map((t, i) => `<button class="bingo-cell ${bingo.mine.has(i) ? 'on' : ''}" data-i="${i}"></button>`).join('')}</div>
    <div class="row"><button class="ghost small" id="bingoNew">New cards</button></div>`;
  el.querySelectorAll('.bingo-cell').forEach((b, i) => { b.textContent = bingo.card[i]; });
  for (const b of el.querySelectorAll('.bingo-cell')) b.onclick = (e) => {
    e.stopPropagation();
    const i = Number(b.dataset.i);
    if (bingo.mine.has(i)) bingo.mine.delete(i); else bingo.mine.add(i);
    send({ t: 'bingoMark', id: bingo.id, cells: [...bingo.mine] });
    if (!bingo.won && hasLine(bingo.mine)) { bingo.won = true; send({ t: 'bingoWin', id: bingo.id }); }
    renderBingo();
  };
  $('bingoMin').onclick = (e) => { e.stopPropagation(); bingo.open = false; renderBingo(); };
  $('bingoNew').onclick = (e) => { e.stopPropagation(); if (confirm('Deal new bingo cards for both of you?')) send({ t: 'bingoStart', movieId: meta.id }); };
  el.onclick = (e) => e.stopPropagation();
}
function onBingo(m) {
  if (m.phase === 'start') {
    loadBingo(m);
    if (m.by !== myName()) toast(`🎯 ${m.by} dealt bingo cards! Tap a square when it happens.`);
  } else if (m.phase === 'marks' && bingo && m.id === bingo.id) { bingo.marks = m.marks; renderBingo(); }
  else if (m.phase === 'win' && bingo && m.id === bingo.id) {
    celebrate(m.by === myName() ? '🎯 BINGO! You got a line!' : `🎯 BINGO! ${m.by} got a line!`);
  } else if (m.phase === 'end') loadBingo(null);
}

// =================================================================================
// Surprise movie: the title stays hidden until the curtains open
// =================================================================================
const revealedSurprises = new Set();
function updateSurprise() {
  const stage = $('stage');
  const hiding = !!(state && meta && state.surprise && !revealedSurprises.has(meta.id));
  if (!hiding) { stage.classList.remove('surprise-hide'); return; }
  const playing = !state.paused && !state.hold;
  if (playing) {
    revealedSurprises.add(meta.id);
    stage.classList.remove('surprise-hide');
    $('title').textContent = meta.title;
    const mv = movies.find((x) => x.id === meta.id) || meta;
    const img = imageFor(mv, 'tall') || imageFor(mv);
    const el = $('surpriseReveal');
    el.innerHTML = `<div class="surprise-card">${img ? `<div class="surprise-img" style="background-image:url('${img}')"></div>` : ''}
      <div><div class="muted small">🎁 Tonight's surprise is…</div><h2></h2></div></div>`;
    el.querySelector('h2').textContent = (mv.tmdb && mv.tmdb.title) || mv.title;
    el.classList.remove('hidden');
    setTimeout(() => el.classList.add('hidden'), 5500);
    return;
  }
  stage.classList.add('surprise-hide');
  $('title').textContent = '🎁 Surprise movie';
}

// =================================================================================
// Celebrations
// =================================================================================
function burstHearts(n = 24) {
  if (reducedMotion()) return;
  for (let i = 0; i < n; i++) setTimeout(() => {
    const h = document.createElement('div');
    h.className = 'burst';
    h.textContent = pick(['💖', '💕', '✨', '🎉', '💗']);
    h.style.left = `${Math.random() * 100}%`;
    h.style.fontSize = `${18 + Math.random() * 26}px`;
    document.body.appendChild(h);
    setTimeout(() => h.remove(), 3200);
  }, i * 60);
}
const celebrations = [];
function celebrate(text) {
  // One at a time (a bingo can also earn a badge in the same moment).
  celebrations.push(text);
  if (celebrations.length === 1) showCelebration();
}
function showCelebration() {
  const text = celebrations[0];
  if (!text) return;
  const el = document.createElement('div');
  el.className = 'celebrate';
  el.textContent = text;
  document.body.appendChild(el);
  burstHearts();
  setTimeout(() => { el.remove(); celebrations.shift(); setTimeout(showCelebration, 250); }, 3600);
}

// =================================================================================
// Badges
// =================================================================================
function badgeContext() {
  const diary = fstate.diary || [];
  const reactions = fstate.reactions || [];
  const games = fstate.games || [];
  const byDate = {};
  for (const e of diary) (byDate[e.date] = byDate[e.date] || []).push(e);
  const weeks = [...new Set(diary.map((e) => { const d = new Date(e.at); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d.getTime(); }))].sort((a, b) => a - b);
  let streak = weeks.length ? 1 : 0, best = streak;
  for (let i = 1; i < weeks.length; i++) { streak = Math.round((weeks[i] - weeks[i - 1]) / 604800000) === 1 ? streak + 1 : 1; best = Math.max(best, streak); }
  const genres = new Set(diary.flatMap((e) => genresOf(e.movieId)));
  const showsByDay = Object.values(byDate).map((es) => {
    const c = {};
    for (const e of es) { const ep = Series.parse(e.title); if (ep) c[ep.key] = (c[ep.key] || 0) + 1; }
    return Math.max(0, ...Object.values(c));
  });
  const since = personalInfo.since ? new Date(`${personalInfo.since}T00:00:00`) : null;
  const predsHit = diary.some((e) => Object.entries(((fstate.predictions || {})[e.movieId]) || {}).some(([n, p]) => p.revealed && p.stars && e.ratings[n] && e.ratings[n].stars === p.stars));
  return {
    movies: diary.length,
    hours: diary.reduce((n, e) => n + (e.minutes || 0), 0) / 60,
    streak: best,
    marathon: Math.max(0, ...Object.values(byDate).map((x) => x.length)),
    genres,
    anime: diary.some((e) => { const mv = movies.find((m) => m.id === e.movieId); return mv && mv.tmdb && mv.tmdb.anime; }),
    binge: Math.max(0, ...showsByDay),
    react: (k) => reactions.filter((r) => r.key === k).length,
    reactBy: (k) => new Set(reactions.filter((r) => r.key === k).map((r) => r.by)).size,
    anniversary: !!since && diary.some((e) => { const d = new Date(e.at); return d.getMonth() === since.getMonth() && d.getDate() === since.getDate() && d.getFullYear() > since.getFullYear(); }),
    nightOwl: diary.some((e) => { const h = new Date(e.at).getHours(); return h >= 0 && h < 4; }),
    notes: (fstate.notes || []).length,
    snaps: (fstate.snaps || []).length,
    doodles: (fstate.snaps || []).filter((s) => s.doodle).length,
    quizWins: games.filter((g) => g.type === 'quiz' && g.winners && g.winners.length).length,
    bingos: games.filter((g) => g.type === 'bingo').length,
    predsHit,
    perfect: diary.some((e) => { const r = Object.values(e.ratings); return r.length >= 2 && r.every((x) => x.stars === 5); }),
    reviews: diary.reduce((n, e) => n + Object.values(e.ratings).filter((r) => r.text).length, 0),
    breaks: (fstate.counts || {}).intermission || 0,
  };
}
const BADGES = [
  { id: 'first', icon: '🎬', name: 'First movie night', desc: 'Watch your first movie together', ok: (c) => c.movies >= 1 },
  { id: 'ten', icon: '🍿', name: 'Ten together', desc: 'Watch 10 movies together', ok: (c) => c.movies >= 10 },
  { id: 'buffs', icon: '🏆', name: 'Movie buffs', desc: 'Watch 25 movies together', ok: (c) => c.movies >= 25 },
  { id: 'fifty', icon: '💯', name: 'Half a hundred', desc: 'Watch 50 movies together', ok: (c) => c.movies >= 50 },
  { id: 'hours10', icon: '⏰', name: 'Ten hours', desc: '10 hours on the same sofa, miles apart', ok: (c) => c.hours >= 10 },
  { id: 'hours50', icon: '⌛', name: 'Fifty hours', desc: '50 hours watched together', ok: (c) => c.hours >= 50 },
  { id: 'streak3', icon: '🔥', name: 'On a roll', desc: 'Movie night 3 weeks in a row', ok: (c) => c.streak >= 3 },
  { id: 'streak8', icon: '🌟', name: 'Unstoppable', desc: 'Movie night 8 weeks in a row', ok: (c) => c.streak >= 8 },
  { id: 'marathon', icon: '🎞️', name: 'Marathon', desc: '3 movies or episodes in one day', ok: (c) => c.marathon >= 3 },
  { id: 'binge', icon: '📺', name: 'Binge buddies', desc: '3 episodes of the same show in one day', ok: (c) => c.binge >= 3 },
  { id: 'brave', icon: '👻', name: 'Brave hearts', desc: 'Watch a horror movie together', ok: (c) => c.genres.has('Horror') },
  { id: 'cried', icon: '😭', name: 'Cried together', desc: 'Both send a crying reaction', ok: (c) => c.reactBy('cry') >= 2 },
  { id: 'giggles', icon: '😂', name: 'Giggle fit', desc: '50 laughing reactions', ok: (c) => c.react('laugh') >= 50 },
  { id: 'kisses', icon: '💋', name: 'Kiss collectors', desc: 'Send 20 kisses', ok: (c) => c.react('kiss') >= 20 },
  { id: 'anime', icon: '🌸', name: 'Anime night', desc: 'Watch an anime together', ok: (c) => c.anime },
  { id: 'anniv', icon: '💞', name: 'Anniversary night', desc: 'Watch a movie on your anniversary', ok: (c) => c.anniversary },
  { id: 'owls', icon: '🦉', name: 'Night owls', desc: 'Finish a movie after midnight', ok: (c) => c.nightOwl },
  { id: 'letters', icon: '💌', name: 'Love letters', desc: 'Leave 5 love notes', ok: (c) => c.notes >= 5 },
  { id: 'photos', icon: '📸', name: 'Photographers', desc: 'Save 10 moments', ok: (c) => c.snaps >= 10 },
  { id: 'artist', icon: '🎨', name: 'Little artists', desc: 'Save a doodle to the diary', ok: (c) => c.doodles >= 1 },
  { id: 'quiz', icon: '🧠', name: 'Quiz champ', desc: 'Win a quote quiz', ok: (c) => c.quizWins >= 1 },
  { id: 'bingo', icon: '🎯', name: 'Bingo!', desc: 'Get a line in movie bingo', ok: (c) => c.bingos >= 1 },
  { id: 'psychic', icon: '🔮', name: 'Fortune teller', desc: 'Predict your exact star rating', ok: (c) => c.predsHit },
  { id: 'perfect', icon: '⭐', name: 'Perfect match', desc: 'Both give a movie 5 stars', ok: (c) => c.perfect },
  { id: 'critics', icon: '✍️', name: 'Critics', desc: 'Write 10 one-line reviews', ok: (c) => c.reviews >= 10 },
  { id: 'snacks', icon: '🥤', name: 'Snack break', desc: 'Take an intermission', ok: (c) => c.breaks >= 1 },
];
const earnedBadges = () => { const c = badgeContext(); return BADGES.filter((b) => { try { return b.ok(c); } catch { return false; } }); };
function checkNewBadges() {
  if (!fstate.diary) return;
  const earned = earnedBadges().map((b) => b.id);
  const seenRaw = store.get('mn_badges');
  const seen = new Set((seenRaw || '').split(',').filter(Boolean));
  store.set('mn_badges', earned.join(','));
  if (seenRaw === null || seenRaw === undefined) return; // first time: no fanfare for old history
  const fresh = earned.filter((id) => !seen.has(id)).map((id) => BADGES.find((b) => b.id === id));
  if (fresh.length === 1) celebrate(`${fresh[0].icon} New badge: ${fresh[0].name}!`);
  else if (fresh.length > 1) celebrate(`🏅 ${fresh.length} new badges! See them in Our diary`);
}
function renderBadges() {
  const earned = new Set(earnedBadges().map((b) => b.id));
  $('badges').innerHTML = BADGES.map((b) => `<div class="badge ${earned.has(b.id) ? 'on' : ''}" title="${escapeHtml(b.desc)}">
    <span class="badge-icon">${b.icon}</span><b>${escapeHtml(b.name)}</b><span class="muted small">${escapeHtml(b.desc)}</span></div>`).join('');
}

// =================================================================================
// Our Year Wrapped
// =================================================================================
let wrapped = null;
function wrappedSlides() {
  const year = new Date().getFullYear();
  let entries = (fstate.diary || []).filter((e) => new Date(e.at).getFullYear() === year);
  let label = String(year);
  if (!entries.length) { entries = fstate.diary || []; label = 'So far'; }
  const ids = new Set(entries.map((e) => e.movieId));
  const reactions = (fstate.reactions || []).filter((r) => ids.has(r.movieId));
  const names = [...new Set([...entries.flatMap((e) => Object.keys(e.ratings)), ...reactions.map((r) => r.by)])];
  const hours = entries.reduce((n, e) => n + (e.minutes || 0), 0) / 60;
  const slides = [];
  slides.push({ cls: 'w-rose', html: `<div class="w-art">${dressed([], 'love')}</div><div class="w-kicker">${escapeHtml(coupleNames())}'s</div><h1>${escapeHtml(label)} Wrapped ✨</h1><p>Your movie nights, in one little story. Tap to continue.</p>` });
  if (!entries.length) {
    slides.push({ cls: 'w-cream', html: '<h2>Your story starts with the first movie 🍿</h2><p>Watch something together and come back here.</p>' });
    return slides;
  }
  slides.push({ cls: 'w-cream', html: `<div class="w-big">${entries.length}</div><h2>movies & episodes together</h2><p>That's <b>${hours >= 1 ? `${Math.round(hours)} hours` : `${Math.round(hours * 60)} minutes`}</b> on the same sofa, miles apart.</p>` });
  const gcount = {};
  for (const e of entries) for (const g of genresOf(e.movieId)) gcount[g] = (gcount[g] || 0) + 1;
  const topG = Object.entries(gcount).sort((a, b) => b[1] - a[1])[0];
  const GEMOJI = { Comedy: '😂', Horror: '👻', Romance: '💘', Drama: '🥹', Action: '💥', Animation: '🌈', 'Science Fiction': '🚀', Thriller: '😰', Adventure: '🗺️', Fantasy: '🧚', Family: '🏡', Crime: '🕵️', Mystery: '🔎' };
  if (topG) slides.push({ cls: 'w-dusk', html: `<div class="w-art">${dressed([topG[0]])}</div><div class="w-kicker">Your kind of night</div><h1>${GEMOJI[topG[0]] || '🎬'} ${escapeHtml(topG[0])}</h1><p>${topG[1]} of your movies.</p>` });
  const days = {};
  for (const e of entries) { const d = new Date(e.at).toLocaleDateString(undefined, { weekday: 'long' }); days[d] = (days[d] || 0) + 1; }
  const topDay = Object.entries(days).sort((a, b) => b[1] - a[1])[0];
  const months = {};
  for (const e of entries) { const m = new Date(e.at).toLocaleDateString(undefined, { month: 'long' }); months[m] = (months[m] || 0) + 1; }
  const topMonth = Object.entries(months).sort((a, b) => b[1] - a[1])[0];
  slides.push({ cls: 'w-cream', html: `<div class="w-kicker">Your movie night</div><h1>${escapeHtml(topDay[0])}s 🗓️</h1><p>Busiest month: <b>${escapeHtml(topMonth[0])}</b> (${topMonth[1]} ${topMonth[1] === 1 ? 'movie' : 'movies'}).</p>` });
  const rated = entries.map((e) => { const r = Object.values(e.ratings); return { e, avg: r.length ? r.reduce((a, b) => a + b.stars, 0) / r.length : 0 }; }).filter((x) => x.avg).sort((a, b) => b.avg - a.avg);
  if (rated.length) {
    const best = rated[0].e;
    const mv = movies.find((m) => m.id === best.movieId);
    const img = mv ? imageFor(mv, 'tall') : null;
    const quote = Object.values(best.ratings).find((r) => r.text);
    slides.push({ cls: 'w-rose', html: `<div class="w-kicker">Your favourite</div>${img ? `<div class="w-poster" style="background-image:url('${img}')"></div>` : ''}<h2>${escapeHtml(best.title)}</h2><p class="w-stars">${'★'.repeat(Math.round(rated[0].avg))}</p>${quote ? `<p><q>${escapeHtml(quote.text)}</q></p>` : ''}` });
  }
  const critic = names.map((n) => { const r = entries.map((e) => e.ratings[n]).filter(Boolean); return { n, avg: r.length ? r.reduce((a, b) => a + b.stars, 0) / r.length : null, count: r.length }; }).filter((x) => x.avg !== null);
  if (critic.length >= 2) {
    critic.sort((a, b) => a.avg - b.avg);
    slides.push({ cls: 'w-dusk', html: `<div class="w-kicker">The tougher critic</div><div class="w-avatar">${Art.head(avatarFor({ name: critic[0].n }))}</div><h1>${escapeHtml(critic[0].n)}</h1>
      <p>${critic.map((c) => `${escapeHtml(c.n)}: <b>${c.avg.toFixed(1)}★</b> on average`).join('<br>')}</p>` });
  }
  if (reactions.length) {
    const most = (k) => { const c = {}; for (const r of reactions) if (r.key === k) c[r.by] = (c[r.by] || 0) + 1; return Object.entries(c).sort((a, b) => b[1] - a[1])[0]; };
    const laugh = most('laugh'), cry = most('cry'), kiss = most('kiss');
    const spots = {};
    for (const r of reactions) { const k = `${r.movieId}|${Math.floor(r.t / 30)}`; spots[k] = (spots[k] || 0) + 1; }
    const hot = Object.entries(spots).sort((a, b) => b[1] - a[1])[0];
    const [hm, hb] = hot[0].split('|');
    const hmv = movies.find((m) => m.id === hm);
    slides.push({ cls: 'w-cream', html: `<div class="w-big">${reactions.length}</div><h2>reactions sent</h2>
      <p>${laugh ? `😂 Laughed the most: <b>${escapeHtml(laugh[0])}</b> (${laugh[1]})<br>` : ''}${cry ? `😭 Cried the most: <b>${escapeHtml(cry[0])}</b> (${cry[1]})<br>` : ''}${kiss ? `💋 Most kisses sent: <b>${escapeHtml(kiss[0])}</b> (${kiss[1]})<br>` : ''}
      🔥 Your loudest moment: <b>${escapeHtml(hmv ? (hmv.tmdb && hmv.tmdb.title) || hmv.title : 'a movie')}</b> at ${fmt(Number(hb) * 30)}</p>` });
  }
  const snaps = (fstate.snaps || []).filter((s) => ids.has(s.movieId)).slice(-6);
  if (snaps.length) slides.push({ cls: 'w-rose', html: `<div class="w-kicker">Moments you saved</div><div class="w-snaps">${snaps.map((s, i) => `<img src="${s.file}" alt="" style="transform:rotate(${(i % 2 ? 1 : -1) * (3 + i)}deg)">`).join('')}</div>` });
  const games = (fstate.games || []).filter((g) => new Date(g.at).getFullYear() === year || label === 'So far');
  if (games.length) {
    const wins = {};
    for (const g of games) for (const w of (g.type === 'quiz' ? g.winners || [] : [g.winner])) if (w) wins[w] = (wins[w] || 0) + 1;
    const champ = Object.entries(wins).sort((a, b) => b[1] - a[1])[0];
    slides.push({ cls: 'w-dusk', html: `<div class="w-kicker">Game nights</div><h2>${games.filter((g) => g.type === 'quiz').length} quizzes · ${games.filter((g) => g.type === 'bingo').length} bingos</h2>${champ ? `<p>🏆 Reigning champ: <b>${escapeHtml(champ[0])}</b> with ${champ[1]} win${champ[1] === 1 ? '' : 's'}</p>` : ''}` });
  }
  const badges = earnedBadges();
  if (badges.length) slides.push({ cls: 'w-cream', html: `<div class="w-kicker">Badges earned</div><div class="w-badges">${badges.map((b) => `<span title="${escapeHtml(b.name)}">${b.icon}</span>`).join('')}</div><p>${badges.length} of ${BADGES.length}</p>` });
  const sinceDays = personalInfo.since ? Math.floor((Date.now() - new Date(`${personalInfo.since}T00:00:00`)) / 86400000) : null;
  slides.push({ cls: 'w-rose', html: `<div class="w-art">${dressed([], 'love')}</div><h1>Here's to more movie nights 💞</h1>${sinceDays ? `<p>${sinceDays.toLocaleString()} days together and counting.</p>` : ''}<button class="primary" id="wrappedClose2">Close</button>` });
  return slides;
}
function openWrapped() {
  wrapped = { slides: wrappedSlides(), i: 0, timer: null };
  $('wrappedView').classList.remove('hidden');
  showWrapped(0);
}
function showWrapped(i) {
  if (!wrapped) return;
  wrapped.i = Math.max(0, Math.min(wrapped.slides.length - 1, i));
  const s = wrapped.slides[wrapped.i];
  $('wrappedView').className = `wrapped ${s.cls}`;
  $('wrappedView').innerHTML = `<div class="w-bars">${wrapped.slides.map((_, k) => `<i class="${k < wrapped.i ? 'done' : k === wrapped.i ? 'now' : ''}"></i>`).join('')}</div>
    <button class="w-close" aria-label="Close">✕</button><div class="w-slide">${s.html}</div>`;
  $('wrappedView').querySelector('.w-close').onclick = (e) => { e.stopPropagation(); closeWrapped(); };
  const c2 = $('wrappedClose2');
  if (c2) c2.onclick = (e) => { e.stopPropagation(); closeWrapped(); };
  clearTimeout(wrapped.timer);
  if (wrapped.i < wrapped.slides.length - 1) wrapped.timer = setTimeout(() => showWrapped(wrapped.i + 1), 7000);
}
function closeWrapped() { if (wrapped) clearTimeout(wrapped.timer); wrapped = null; $('wrappedView').classList.add('hidden'); }
$('wrappedView').onclick = (e) => {
  if (!wrapped) return;
  showWrapped(e.clientX < window.innerWidth / 3 ? wrapped.i - 1 : wrapped.i + 1);
};
document.addEventListener('keydown', (e) => {
  if (!wrapped) return;
  if (e.key === 'Escape') closeWrapped();
  if (e.key === 'ArrowRight') showWrapped(wrapped.i + 1);
  if (e.key === 'ArrowLeft') showWrapped(wrapped.i - 1);
});
$('wrappedBtn').onclick = openWrapped;

// =================================================================================
// Movie postcard (a picture to keep or send)
// =================================================================================
const loadImg = (src) => new Promise((res) => { if (!src) { res(null); return; } const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = src; });
function coverDraw(ctx, img, x, y, w, h) {
  const s = Math.max(w / img.width, h / img.height);
  const sw = w / s, sh = h / s;
  ctx.drawImage(img, (img.width - sw) / 2, (img.height - sh) / 2, sw, sh, x, y, w, h);
}
function roundRect(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
function wrapText(ctx, text, x, y, maxW, lineH, maxLines = 3) {
  const words = String(text).split(' ');
  let line = '', n = 0;
  for (const w of words) {
    const t = line ? `${line} ${w}` : w;
    if (ctx.measureText(t).width > maxW && line) { ctx.fillText(line, x, y); y += lineH; line = w; if (++n >= maxLines - 1) { line = `${words.slice(words.indexOf(w)).join(' ')}`; break; } } else line = t;
  }
  if (line) { while (ctx.measureText(line).width > maxW && line.length > 3) line = `${line.slice(0, -4)}…`; ctx.fillText(line, x, y); y += lineH; }
  return y;
}
async function makePostcard(entryId) {
  const e = (fstate.diary || []).find((x) => x.id === entryId);
  if (!e) return;
  const mv = movies.find((m) => m.id === e.movieId);
  const snaps = (fstate.snaps || []).filter((s) => s.movieId === e.movieId);
  const main = await loadImg((mv && (imageFor(mv, 'wide'))) || (snaps[0] && snaps[0].file));
  const snap = await loadImg(snaps.length ? snaps[snaps.length - 1].file : null);
  const W = 1080, H = 1350;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#f3e9da'; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#fffaf2'; roundRect(ctx, 50, 50, W - 100, H - 100, 40); ctx.fill();
  ctx.fillStyle = '#b2606b'; ctx.font = 'bold 40px Georgia, serif'; ctx.textAlign = 'center';
  ctx.fillText(`🎀 ${personalInfo.him && personalInfo.her ? `${personalInfo.him} & ${personalInfo.her}'s` : 'Our'} Movie Night`, W / 2, 130);
  if (main) { ctx.save(); roundRect(ctx, 100, 170, W - 200, 520, 28); ctx.clip(); coverDraw(ctx, main, 100, 170, W - 200, 520); ctx.restore(); }
  else { ctx.fillStyle = '#ead9c2'; roundRect(ctx, 100, 170, W - 200, 520, 28); ctx.fill(); ctx.font = '160px serif'; ctx.fillText('🎬', W / 2, 500); }
  if (snap && main && snap.src !== main.src) {
    ctx.save(); ctx.translate(W - 250, 640); ctx.rotate(0.08);
    ctx.shadowColor = 'rgba(0,0,0,.25)'; ctx.shadowBlur = 24; ctx.fillStyle = '#fff'; ctx.fillRect(-150, -110, 300, 260); ctx.shadowBlur = 0;
    coverDraw(ctx, snap, -132, -92, 264, 190); ctx.fillStyle = '#8f7663'; ctx.font = '26px Georgia, serif'; ctx.fillText('♡', 0, 130); ctx.restore();
  }
  ctx.textAlign = 'left'; ctx.fillStyle = '#4a3326';
  ctx.font = 'bold 58px Georgia, serif';
  let y = wrapText(ctx, (mv && mv.tmdb && mv.tmdb.title) || e.title, 100, 790, W - 420, 66, 2);
  ctx.font = '30px system-ui, sans-serif'; ctx.fillStyle = '#8f7663';
  ctx.fillText(new Date(e.at).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }), 100, y + 4);
  y += 70;
  for (const [n, r] of Object.entries(e.ratings).slice(0, 2)) {
    ctx.fillStyle = '#4a3326'; ctx.font = 'bold 34px system-ui, sans-serif'; ctx.fillText(n, 100, y);
    ctx.fillStyle = '#d7a23a'; ctx.font = '36px system-ui, sans-serif';
    ctx.fillText('★'.repeat(r.stars) + '☆'.repeat(5 - r.stars), 100 + ctx.measureText(n).width + 50, y);
    y += 46;
    if (r.text) { ctx.fillStyle = '#6b5446'; ctx.font = 'italic 30px Georgia, serif'; y = wrapText(ctx, `“${r.text}”`, 100, y, W - 200, 40, 2) + 10; }
    y += 14;
  }
  ctx.textAlign = 'center'; ctx.fillStyle = '#b2606b'; ctx.font = '30px Georgia, serif';
  ctx.fillText('Together, wherever we are 💞', W / 2, H - 100);
  const url = c.toDataURL('image/png');
  $('postcardImg').src = url;
  $('postcardSave').href = url;
  $('postcardSave').download = `postcard-${e.movieId}.png`;
  $('postcardShare').classList.toggle('hidden', !navigator.canShare);
  $('postcardShare').onclick = async () => {
    try {
      const blob = await (await fetch(url)).blob();
      const file = new File([blob], `postcard-${e.movieId}.png`, { type: 'image/png' });
      if (navigator.canShare({ files: [file] })) await navigator.share({ files: [file], title: e.title });
    } catch { /* cancelled */ }
  };
  $('postcardView').classList.remove('hidden');
}

// =================================================================================
// Mood picker
// =================================================================================
const MOODS = [
  { id: 'cosy', icon: '🛋️', label: 'Cosy', genres: ['Comedy', 'Animation', 'Family', 'Romance'] },
  { id: 'scary', icon: '😱', label: 'Scary', genres: ['Horror', 'Thriller', 'Mystery'] },
  { id: 'laugh', icon: '😂', label: 'Laugh', genres: ['Comedy'] },
  { id: 'cry', icon: '😭', label: 'Cry', genres: ['Drama', 'Romance'] },
  { id: 'thrill', icon: '💥', label: 'Thrill', genres: ['Action', 'Adventure', 'Crime', 'War', 'Thriller'] },
  { id: 'dream', icon: '✨', label: 'Dreamy', genres: ['Science Fiction', 'Fantasy', 'Animation'] },
];
let mood = null;
function renderMoods() {
  const el = $('moods');
  const anyGenres = movies.some((m) => m.tmdb && m.tmdb.genres && m.tmdb.genres.length);
  if (!anyGenres) { el.innerHTML = ''; return; }
  el.innerHTML = `<span class="moods-q">What are we feeling tonight?</span>${MOODS.map((m) => `<button class="mood ${mood === m.id ? 'on' : ''}" data-m="${m.id}">${m.icon} ${m.label}</button>`).join('')}`;
  for (const b of el.querySelectorAll('.mood')) b.onclick = () => { mood = mood === b.dataset.m ? null : b.dataset.m; renderHome(); };
  if (!mood) return;
  const md = MOODS.find((m) => m.id === mood);
  const items = candidates().filter((it) => ((it.play.tmdb && it.play.tmdb.genres) || []).some((g) => md.genres.includes(g)));
  const block = items.length ? row(`${md.icon} ${md.label} picks`, items.map((it) => movieCard(it.play)))
    : Object.assign(document.createElement('p'), { className: 'muted pad', textContent: `Nothing ${md.label.toLowerCase()} left that you haven't watched. Time to add one?` });
  block.classList.add('mood-row');
  $('rows').prepend(block);
}

// =================================================================================
// Our wishlist
// =================================================================================
function renderWishlist() {
  const el = $('wishlist');
  const list = [...(fstate.wishlist || [])].filter((w) => !w.done || Date.now() - (w.doneAt || 0) < 30 * 86400000).sort((a, b) => (a.done - b.done) || b.at - a.at).slice(0, 15);
  el.innerHTML = `<h3 class="row-title">Our wishlist 🌟</h3>
    <form id="wishForm" class="wish-form" autocomplete="off"><input id="wishInput" maxlength="100" placeholder="A movie you'd love to watch together…" aria-label="Movie wish"><button class="primary small" type="submit">Add</button></form>
    <div class="wish-list">${list.map((w) => `<div class="wish ${w.done ? 'done' : ''}"><span class="avatar">${Art.head(avatarFor({ name: w.by }))}</span>
      <span class="wish-text"><b></b><span class="muted small">${escapeHtml(w.by)}${w.done ? ' · ✓ added to Movie Night' : ' wishes for this'}</span></span>
      ${isHost ? `<button class="ghost small" data-wdone="${w.id}">${w.done ? 'Undo' : '✓ Got it'}</button>` : ''}
      ${w.by === myName() || isHost ? `<button class="ghost small" data-wdel="${w.id}" aria-label="Remove">✕</button>` : ''}</div>`).join('')
      || '<p class="muted small">Add movies you want to watch. The laptop gets a little note, and it\'s ticked off when the movie arrives.</p>'}</div>`;
  el.querySelectorAll('.wish-text b').forEach((b, i) => { b.textContent = list[i].title; });
  $('wishInput').addEventListener('keydown', (e) => e.stopPropagation());
  $('wishForm').onsubmit = (e) => {
    e.preventDefault();
    const title = $('wishInput').value.trim();
    if (!title) return;
    send({ t: 'wish', title });
    $('wishInput').value = '';
    toast('🌟 Added to your wishlist');
  };
  for (const b of el.querySelectorAll('[data-wdone]')) b.onclick = () => send({ t: 'wishDone', id: b.dataset.wdone });
  for (const b of el.querySelectorAll('[data-wdel]')) b.onclick = () => send({ t: 'wishDelete', id: b.dataset.wdel });
}

// =================================================================================
// Hooks into the rest of the app
// =================================================================================
function onFunMessage(m) {
  switch (m.t) {
    case 'quiz': onQuiz(m); break;
    case 'bingo': onBingo(m); break;
    case 'doodle':
      if (m.from === myName()) return;
      if (m.kind === 'open') openDoodle(false);
      else if (m.kind === 'stroke') { if (!doodle.open) openDoodle(false); addRemoteStroke(m); }
      else if (m.kind === 'clear') clearDoodle();
      else if (m.kind === 'close') closeDoodle();
      break;
    case 'predicted': if (m.by !== myName()) toast(`🔮 ${m.by} sealed a secret prediction`); break;
    default:
  }
}

// Home: moods on top, wishlist below.
const baseRenderHome = renderHome;
renderHome = function () { baseRenderHome(); renderMoods(); renderWishlist(); };

// Tiles: 🎁 start as a surprise.
const baseTileActions = tileActions;
tileActions = function (mv) {
  const box = baseTileActions(mv);
  if (isDone(mv)) return box; // a surprise is for something you haven't seen
  const gift = document.createElement('span');
  gift.className = 'tile-act';
  gift.setAttribute('role', 'button');
  gift.title = 'Start as a surprise';
  gift.textContent = '🎁';
  gift.onclick = (e) => {
    e.stopPropagation();
    if (!confirm(`Start "${(mv.tmdb && mv.tmdb.title) || mv.title}" as a surprise? Its name stays hidden on both screens until the curtains open.`)) return;
    send({ t: 'load', movieId: mv.id, surprise: true });
  };
  box.prepend(gift);
  return box;
};

// Diary: badges, predictions, game results, postcard & quiz buttons on each page.
const baseRenderDiary = renderDiary;
renderDiary = function () {
  baseRenderDiary();
  renderBadges();
  for (const page of document.querySelectorAll('#diaryList .page[data-entry]')) {
    const e = fstate.diary.find((x) => x.id === page.dataset.entry);
    if (!e) continue;
    const games = (fstate.games || []).filter((g) => g.movieId === e.movieId && new Date(g.at).toDateString() === new Date(e.at).toDateString());
    const gameLines = games.map((g) => g.type === 'quiz'
      ? `🎬 Quote quiz: ${Object.entries(g.scores).map(([n, v]) => `${escapeHtml(n)} ${v}`).join(' – ')}${g.winners && g.winners.length === 1 ? ` · 🏆 ${escapeHtml(g.winners[0])}` : ''}`
      : `🎯 ${escapeHtml(g.winner)} got a bingo${g.first ? ' first' : ''}!`);
    const rs = (fstate.reactions || []).filter((r) => r.movieId === e.movieId);
    const counts = {};
    for (const r of rs) counts[r.key] = (counts[r.key] || 0) + 1;
    page.querySelector('.page-body').insertAdjacentHTML('beforeend', `
      ${rs.length ? `<div class="muted small">${Object.entries(counts).map(([k, n]) => `${EMOJI[k] || k} ${n}`).join(' · ')}</div>` : ''}
      ${predictionsHtml(e.movieId)}
      ${gameLines.length ? `<div class="page-games">${gameLines.map((l) => `<div class="small">${l}</div>`).join('')}</div>` : ''}
      <div class="page-actions"><button class="ghost small" data-postcard="${e.id}">💌 Postcard</button><button class="ghost small" data-quiz="${e.movieId}">🎬 Quote quiz</button></div>`);
  }
  for (const b of document.querySelectorAll('[data-postcard]')) b.onclick = () => makePostcard(b.dataset.postcard);
  for (const b of document.querySelectorAll('[data-quiz]')) b.onclick = () => startQuiz(b.dataset.quiz);
};

// Rate card at the end: dressed-up art, the predictions revealed, and a quiz button.
const baseOpenRateCard = openRateCard;
openRateCard = async function (entryId, title, movieId) {
  baseOpenRateCard(entryId, title, movieId);
  if ($('rateCard').classList.contains('hidden')) return;
  $('rateArt').innerHTML = dressed(genresOf(movieId), 'love');
  try { const r = await fetch('/api/f/state', { cache: 'no-store' }); if (r.ok) fstate = await r.json(); } catch { /* offline */ }
  const card = $('rateCard').querySelector('.rate-card');
  card.querySelectorAll('.rate-extra').forEach((x) => x.remove());
  card.insertAdjacentHTML('beforeend', `<div class="rate-extra">${predictionsHtml(movieId)}
    <button class="ghost small" id="rateQuiz">🎬 Play the quote quiz together</button></div>`);
  $('rateQuiz').onclick = () => startQuiz(movieId);
};

// Artwork & seasons follow the personal settings.
const baseLoadPersonal = loadPersonal;
loadPersonal = async function () { await baseLoadPersonal(); applySeason(); drawDressUp(); };
const baseDrawArt = drawArt;
drawArt = function () { baseDrawArt(); drawDressUp(); holdArtKey = ''; updateHoldArt(); };

function funAfterOpen() {
  sessionStart = Date.now();
  lastCt = null;
  renderReactMarks();
  if (fstate.bingo && meta && fstate.bingo.movieId === meta.id) loadBingo(fstate.bingo); else renderBingo();
  setTimeout(maybeNudgePrediction, 2500);
}
function funAfterClose() {
  closeDoodle();
  $('bingoPanel').classList.add('hidden');
  $('reactMarks').innerHTML = '';
  $('stage').classList.remove('surprise-hide');
  const n = document.querySelector('.nudge');
  if (n) n.remove();
}
function funAfterState() { updateHoldArt(); updateSurprise(); renderSnackBreak(); if (state && !state.paused) { const n = document.querySelector('.nudge'); if (n) n.remove(); } }
function funAfterFeatures() { renderReactMarks(); checkNewBadges(); if (currentTab === 'diary') renderBadges(); }

applySeason();
setInterval(applySeason, 30 * 60000);
