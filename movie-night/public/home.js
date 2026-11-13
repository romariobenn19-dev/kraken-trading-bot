/* Movie Night - home page (streaming-style rows), series, our diary, pick together,
 * movie-night countdown and notifications. Uses globals from app.js. */
'use strict';

let fstate = { progress: {}, diary: [], notes: [], votes: {}, schedule: null, people: {}, series: {}, favorites: {}, snaps: [], pushKey: null };
let currentTab = store.get('mn_tab') || 'home';
const myName = () => store.get('mn_name') || '';

async function loadFeatures() {
  try {
    const r = await fetch('/api/f/state', { cache: 'no-store' });
    if (r.ok) fstate = await r.json();
  } catch { /* offline */ }
  renderHome();
  if (currentTab === 'diary') renderDiary();
  if (currentTab === 'pick') renderPick();
  if (typeof afterFeatures === 'function') afterFeatures();
}

// ---- Tabs ------------------------------------------------------------------------------
for (const b of document.querySelectorAll('.tab')) b.onclick = () => showTab(b.dataset.tab);
function showTab(tab) {
  currentTab = tab;
  store.set('mn_tab', tab);
  for (const b of document.querySelectorAll('.tab')) {
    b.classList.toggle('on', b.dataset.tab === tab);
    b.setAttribute('aria-selected', String(b.dataset.tab === tab));
  }
  for (const t of ['home', 'diary', 'pick']) $(`tab-${t}`).classList.toggle('hidden', t !== tab);
  if (tab === 'diary') renderDiary();
  if (tab === 'pick') renderPick();
}

// ---- Helpers ---------------------------------------------------------------------------
const lib = (id, file) => `/library/${encodeURIComponent(id)}/${file}`;
function imageFor(mv, kind = 'wide') {
  const t = mv.tmdb;
  if (t) {
    if (kind === 'wide' && (t.still || t.backdrop)) return lib(mv.id, t.still || t.backdrop);
    if (kind === 'tall' && t.poster) return lib(mv.id, t.poster);
    if (t.backdrop) return lib(mv.id, t.backdrop);
  }
  return mv.poster ? lib(mv.id, mv.poster) : null;
}
const progressOf = (mv) => fstate.progress[mv.id] || null;
const inProgress = (mv) => { const p = progressOf(mv); return p && !p.done && p.pos > 30; };
const isDone = (mv) => { const p = progressOf(mv); return !!(p && p.done); };
function timeLeft(mv) {
  const p = progressOf(mv);
  if (!p) return fmt(mv.duration);
  const left = Math.max(0, (mv.duration || p.duration) - p.pos);
  return left > 3600 ? `${Math.floor(left / 3600)}h ${Math.round((left % 3600) / 60)}m left` : `${Math.max(1, Math.round(left / 60))} min left`;
}
const epLabel = (ep) => `S${ep.season} E${ep.episode}${ep.name ? ` · ${ep.name}` : ''}`;
function avgStars(movieId) {
  const all = fstate.diary.filter((e) => e.movieId === movieId).flatMap((e) => Object.values(e.ratings).map((r) => r.stars));
  return all.length ? all.reduce((a, b) => a + b, 0) / all.length : 0;
}
const isFav = (id) => !!fstate.favorites[id] || avgStars(id) >= 4;

function play(mv, fromStart) {
  if (fromStart) send({ t: 'load', movieId: mv.id, pos: 0 }); else send({ t: 'load', movieId: mv.id });
}

// ---- Home -------------------------------------------------------------------------------
function renderHome() {
  const rows = $('rows');
  if (!rows) return;
  $('noMovies').classList.toggle('hidden', movies.length > 0);
  renderCountdown();
  renderHero();
  const { series, movies: singles } = Series.group(movies);
  const seriesByKey = new Map(series.map((s) => [s.key, s]));
  const out = [];

  const cont = movies.filter(inProgress).sort((a, b) => progressOf(b).at - progressOf(a).at);
  if (cont.length) out.push(row('Continue watching', cont.map((mv) => movieCard(mv, { progress: true }))));

  if (series.length) out.push(row('Series', series.map((s) => seriesCard(s))));

  const fresh = [...movies].sort((a, b) => String(b.preparedAt).localeCompare(String(a.preparedAt))).slice(0, 12);
  if (fresh.length) out.push(row('New', fresh.map((mv) => movieCard(mv))));

  const animeShows = series.filter((s) => s.episodes.some((e) => e.tmdb && e.tmdb.anime));
  const animeFilms = singles.filter((m) => m.tmdb && m.tmdb.anime);
  if (animeShows.length + animeFilms.length) out.push(row('Anime', [...animeShows.map(seriesCard), ...animeFilms.map((m) => movieCard(m))]));

  const favs = movies.filter((m) => isFav(m.id));
  const favShows = [...new Set(favs.map((m) => (Series.parse(m.title) || {}).key).filter(Boolean))].map((k) => seriesByKey.get(k)).filter(Boolean);
  const favFilms = favs.filter((m) => !Series.parse(m.title));
  if (favShows.length + favFilms.length) out.push(row('Favourites ♥', [...favShows.map(seriesCard), ...favFilms.map((m) => movieCard(m))]));

  if (singles.length) out.push(row('Movies', singles.map((mv) => movieCard(mv))));

  rows.replaceChildren(...out);
}

function row(title, cards) {
  const wrap = document.createElement('section');
  wrap.className = 'row-block';
  wrap.innerHTML = `<h3 class="row-title">${escapeHtml(title)}</h3><div class="row-scroll"></div>`;
  wrap.querySelector('.row-scroll').append(...cards);
  return wrap;
}

function movieCard(mv, { progress } = {}) {
  const ep = Series.parse(mv.title);
  const b = document.createElement('button');
  b.className = 'tile';
  const img = imageFor(mv);
  const p = progressOf(mv);
  const title = ep ? ep.show : (mv.tmdb && mv.tmdb.title) || mv.title;
  const sub = ep ? epLabel(ep) : [mv.tmdb && mv.tmdb.year, fmt(mv.duration)].filter(Boolean).join(' · ');
  b.innerHTML = `<div class="tile-img">${img ? '' : Art.scene(Art.SCENES[Math.abs(hash(mv.id)) % Art.SCENES.length])}
      ${isDone(mv) ? '<span class="tile-badge">✓ Watched</span>' : ''}
      ${progress || inProgress(mv) ? `<span class="tile-bar"><i style="width:${Math.min(100, (p.pos / (mv.duration || p.duration)) * 100).toFixed(1)}%"></i></span>` : ''}
    </div>
    <div class="tile-meta"><b></b><span></span></div>`;
  if (img) b.querySelector('.tile-img').style.backgroundImage = `url("${img}")`;
  b.querySelector('b').textContent = title;
  b.querySelector('.tile-meta span').textContent = progress ? `${sub ? `${sub} · ` : ''}${timeLeft(mv)}` : sub;
  b.title = mv.tmdb && mv.tmdb.overview ? mv.tmdb.overview : mv.title;
  b.onclick = () => play(mv);
  b.appendChild(tileActions(mv));
  return b;
}

function seriesCard(s) {
  const b = document.createElement('button');
  b.className = 'tile';
  const cover = s.episodes.find((e) => e.tmdb && (e.tmdb.backdrop || e.tmdb.poster)) || s.episodes[0];
  const img = cover.tmdb && cover.tmdb.backdrop ? lib(cover.id, cover.tmdb.backdrop) : imageFor(cover);
  const nextEp = s.episodes.find((e) => !isDone(e)) || s.episodes[s.episodes.length - 1];
  const watched = s.episodes.filter(isDone).length;
  b.innerHTML = `<div class="tile-img"><span class="tile-badge">${s.episodes.length} ep${s.episodes.length === 1 ? '' : 's'}</span>
      ${watched ? `<span class="tile-bar"><i style="width:${((watched / s.episodes.length) * 100).toFixed(1)}%"></i></span>` : ''}</div>
    <div class="tile-meta"><b></b><span></span></div>`;
  if (img) b.querySelector('.tile-img').style.backgroundImage = `url("${img}")`;
  else b.querySelector('.tile-img').insertAdjacentHTML('afterbegin', Art.scene('cinema'));
  b.querySelector('b').textContent = s.show;
  b.querySelector('.tile-meta span').textContent = `Next: ${epLabel(nextEp.ep)}`;
  b.onclick = () => openSeries(s.key);
  return b;
}

function tileActions(mv) {
  const box = document.createElement('span');
  box.className = 'tile-actions';
  const fav = document.createElement('span');
  fav.className = `tile-act ${fstate.favorites[mv.id] ? 'on' : ''}`;
  fav.setAttribute('role', 'button');
  fav.title = fstate.favorites[mv.id] ? 'Remove from favourites' : 'Add to favourites';
  fav.textContent = fstate.favorites[mv.id] ? '♥' : '♡';
  fav.onclick = (e) => { e.stopPropagation(); send({ t: 'fav', movieId: mv.id, on: !fstate.favorites[mv.id] }); };
  box.appendChild(fav);
  if (isHost) {
    const cc = document.createElement('span');
    cc.className = 'tile-act';
    cc.setAttribute('role', 'button');
    cc.title = 'Subtitles';
    cc.textContent = subsOf(mv).length ? `CC ${subsOf(mv).length}` : 'CC+';
    cc.onclick = (e) => { e.stopPropagation(); openSubsDialog(mv); };
    const del = document.createElement('span');
    del.className = 'tile-act';
    del.setAttribute('role', 'button');
    del.title = 'Delete from the laptop';
    del.textContent = '🗑';
    del.onclick = (e) => { e.stopPropagation(); deleteMovie(mv); };
    box.append(cc, del);
  }
  return box;
}

function hash(s) { let h = 0; for (const ch of String(s)) h = (h * 31 + ch.charCodeAt(0)) | 0; return h; }

// ---- Hero banner ----------------------------------------------------------------------------
function renderHero() {
  const hero = $('hero');
  const cont = movies.filter(inProgress).sort((a, b) => progressOf(b).at - progressOf(a).at);
  const mv = cont[0] || [...movies].sort((a, b) => String(b.preparedAt).localeCompare(String(a.preparedAt)))[0];
  if (!mv) { hero.classList.add('hidden'); return; }
  hero.classList.remove('hidden');
  const ep = Series.parse(mv.title);
  const img = (mv.tmdb && mv.tmdb.backdrop && lib(mv.id, mv.tmdb.backdrop)) || imageFor(mv);
  const resuming = inProgress(mv);
  const overview = (mv.tmdb && mv.tmdb.overview) || '';
  hero.innerHTML = `
    <div class="hero-img">${img ? '' : Art.scene('romance')}</div>
    <div class="hero-shade"></div>
    <div class="hero-text">
      <div class="hero-kicker">${resuming ? 'Continue watching' : 'Newest'}</div>
      <h2 class="hero-title"></h2>
      <div class="hero-sub"></div>
      ${overview ? '<p class="hero-overview"></p>' : ''}
      <div class="hero-btns">
        <button class="primary" id="heroPlay">▶ ${resuming ? 'Continue' : 'Play'}</button>
        ${resuming ? '<button class="ghost" id="heroRestart">↺ Start over</button>' : ''}
        ${ep ? '<button class="ghost" id="heroSeries">All episodes</button>' : ''}
      </div>
    </div>`;
  if (img) hero.querySelector('.hero-img').style.backgroundImage = `url("${img}")`;
  hero.querySelector('.hero-title').textContent = ep ? ep.show : (mv.tmdb && mv.tmdb.title) || mv.title;
  const bits = [ep ? epLabel(ep) : (mv.tmdb && mv.tmdb.year), mv.tmdb && mv.tmdb.rating ? `★ ${mv.tmdb.rating.toFixed(1)}` : '', resuming ? timeLeft(mv) : fmt(mv.duration)];
  hero.querySelector('.hero-sub').textContent = bits.filter(Boolean).join(' · ');
  if (overview) hero.querySelector('.hero-overview').textContent = overview;
  $('heroPlay').onclick = () => play(mv);
  if (resuming) $('heroRestart').onclick = () => play(mv, true);
  if (ep) $('heroSeries').onclick = () => openSeries(ep.key);
}

// ---- Series page ----------------------------------------------------------------------------
let openSeriesKey = null;
let seriesSeason = null;
function openSeries(key) {
  openSeriesKey = key;
  seriesSeason = null;
  renderSeries();
  $('seriesSheet').classList.remove('hidden');
}
function renderSeries() {
  const s = Series.group(movies).series.find((x) => x.key === openSeriesKey);
  if (!s) { $('seriesSheet').classList.add('hidden'); return; }
  const seasons = [...new Set(s.episodes.map((e) => e.ep.season))];
  if (!seasons.includes(seriesSeason)) {
    const nextEp = s.episodes.find((e) => !isDone(e)) || s.episodes[0];
    seriesSeason = nextEp.ep.season;
  }
  const cover = s.episodes.find((e) => e.tmdb && e.tmdb.backdrop);
  const overview = (s.episodes.find((e) => e.tmdb) || {}).tmdb;
  const intro = (fstate.series[s.key] && fstate.series[s.key].intro) || 85;
  const nextEp = s.episodes.find((e) => !isDone(e));
  $('seriesHead').innerHTML = `
    <div class="series-cover"></div><div class="hero-shade"></div>
    <button class="ghost small series-close" aria-label="Close">✕</button>
    <div class="series-head-text">
      <h2 id="seriesTitle"></h2>
      <p class="series-overview"></p>
      <div class="hero-btns">${nextEp ? `<button class="primary" id="seriesPlay">▶ ${inProgress(nextEp) ? 'Continue' : 'Play'} ${epLabel(nextEp.ep).split(' · ')[0]}</button>` : ''}</div>
    </div>`;
  const coverImg = cover ? lib(cover.id, cover.tmdb.backdrop) : imageFor(s.episodes[0]);
  if (coverImg) {
    const c = $('seriesHead').querySelector('.series-cover');
    c.style.backgroundImage = `url("${coverImg}")`;
    if (!cover) c.classList.add('soft');
  }
  $('seriesTitle').textContent = s.show;
  $('seriesHead').querySelector('.series-overview').textContent = overview && overview.kind === 'episode' && overview.show ? '' : '';
  $('seriesHead').querySelector('.series-close').onclick = () => $('seriesSheet').classList.add('hidden');
  if (nextEp) $('seriesPlay').onclick = () => { $('seriesSheet').classList.add('hidden'); play(nextEp); };
  const eps = s.episodes.filter((e) => e.ep.season === seriesSeason);
  $('seriesBody').innerHTML = `
    ${seasons.length > 1 ? `<div class="season-tabs">${seasons.map((n) => `<button class="season ${n === seriesSeason ? 'on' : ''}" data-s="${n}">Season ${n}</button>`).join('')}</div>` : ''}
    <div class="ep-list">${eps.map((e, i) => `
      <button class="ep" data-i="${i}">
        <span class="ep-img" ${imageFor(e) ? `style="background-image:url('${imageFor(e)}')"` : ''}>${isDone(e) ? '<span class="tile-badge">✓</span>' : ''}
          ${inProgress(e) ? `<span class="tile-bar"><i style="width:${Math.min(100, (progressOf(e).pos / e.duration) * 100).toFixed(1)}%"></i></span>` : ''}</span>
        <span class="ep-text"><b>${e.ep.episode}. ${escapeHtml(e.ep.name || (e.tmdb && e.tmdb.kind === 'episode' ? e.tmdb.title.split(' · ').slice(1).join(' · ') : '') || `Episode ${e.ep.episode}`)}</b>
          <span class="muted small">${escapeHtml(fmt(e.duration))}${inProgress(e) ? ` · ${escapeHtml(timeLeft(e))}` : ''}</span>
          ${e.tmdb && e.tmdb.overview ? `<span class="ep-overview">${escapeHtml(e.tmdb.overview)}</span>` : ''}</span>
      </button>`).join('')}</div>
    <div class="intro-setting"><span>Intro length for "Skip intro":</span>
      <button class="ghost small" data-intro="-5">−5s</button><b>${fmt(intro)}</b><button class="ghost small" data-intro="5">+5s</button></div>`;
  for (const b of $('seriesBody').querySelectorAll('.season')) b.onclick = () => { seriesSeason = Number(b.dataset.s); renderSeries(); };
  for (const b of $('seriesBody').querySelectorAll('.ep')) b.onclick = () => { $('seriesSheet').classList.add('hidden'); play(eps[Number(b.dataset.i)]); };
  for (const b of $('seriesBody').querySelectorAll('[data-intro]')) b.onclick = () => send({ t: 'seriesSettings', key: s.key, intro: intro + Number(b.dataset.intro) });
}
$('seriesSheet').addEventListener('click', (e) => { if (e.target === $('seriesSheet')) $('seriesSheet').classList.add('hidden'); });

// ---- Our diary ------------------------------------------------------------------------------
function renderDiary() {
  const entries = [...fstate.diary].sort((a, b) => b.at - a.at);
  const minutes = entries.reduce((n, e) => n + (e.minutes || 0), 0);
  const people = [...new Set(entries.flatMap((e) => Object.keys(e.ratings)))];
  const favOf = (name) => {
    const best = entries.filter((e) => e.ratings[name]).sort((a, b) => b.ratings[name].stars - a.ratings[name].stars || b.at - a.at)[0];
    return best ? best.title : null;
  };
  $('diaryStats').innerHTML = `
    <div class="stat"><b>${entries.length}</b><span>${entries.length === 1 ? 'movie' : 'movies'} together</span></div>
    <div class="stat"><b>${minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${minutes}m`}</b><span>watched together</span></div>
    <div class="stat"><b>${fstate.snaps.length}</b><span>moments saved</span></div>
    ${people.map((n) => favOf(n) ? `<div class="stat wide"><span class="avatar">${Art.head(avatarFor({ name: n }))}</span><span><span class="muted small">${escapeHtml(n)}'s favourite</span><br><b class="fav-title">${escapeHtml(favOf(n))}</b></span></div>` : '').join('')}`;
  if (!entries.length) {
    $('diaryList').innerHTML = `<div class="empty"><div class="empty-art">${Art.couple()}</div><p class="muted">Your diary fills up as you watch. After each movie you'll both be asked for stars and a line about it.</p></div>`;
    return;
  }
  $('diaryList').innerHTML = entries.map((e) => {
    const mv = movies.find((m) => m.id === e.movieId);
    const img = mv ? imageFor(mv, 'tall') : null;
    const snaps = fstate.snaps.filter((s) => s.movieId === e.movieId).slice(-6);
    const notes = fstate.notes.filter((n) => n.movieId === e.movieId);
    const mineRated = !!e.ratings[myName()];
    return `<article class="page">
      <div class="page-poster" ${img ? `style="background-image:url('${img}')"` : ''}>${img ? '' : Art.scene('cinema')}</div>
      <div class="page-body">
        <div class="page-date">${new Date(e.at).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' })}</div>
        <h3>${escapeHtml(e.title)}</h3>
        ${Object.entries(e.ratings).map(([n, r]) => `<div class="page-rating"><span class="avatar">${Art.head(avatarFor({ name: n }))}</span>
          <span><span class="stars">${'★'.repeat(r.stars)}<span class="dim">${'★'.repeat(5 - r.stars)}</span></span> <b>${escapeHtml(n)}</b>${r.text ? `<br><q>${escapeHtml(r.text)}</q>` : ''}</span></div>`).join('')}
        ${mineRated ? '' : `<button class="ghost small" data-rate="${e.id}">★ Add your stars</button>`}
        ${notes.length ? `<div class="muted small">💌 ${notes.length} love note${notes.length === 1 ? '' : 's'} in this one</div>` : ''}
        ${snaps.length ? `<div class="page-snaps">${snaps.map((s) => `<button class="snap" data-src="${s.file}"><img src="${s.file}" alt="Moment from ${escapeHtml(e.title)}" loading="lazy"></button>`).join('')}</div>` : ''}
      </div>
    </article>`;
  }).join('');
  for (const b of $('diaryList').querySelectorAll('[data-rate]')) b.onclick = () => {
    const e = fstate.diary.find((x) => x.id === b.dataset.rate);
    if (e) openRateCard(e.id, e.title, e.movieId);
  };
  for (const b of $('diaryList').querySelectorAll('.snap')) b.onclick = () => { $('photoImg').src = b.dataset.src; $('photoView').classList.remove('hidden'); };
}
$('photoView').onclick = () => $('photoView').classList.add('hidden');

// ---- Pick together --------------------------------------------------------------------------
function candidates() {
  const { series, movies: singles } = Series.group(movies);
  const items = [];
  for (const s of series) {
    const nextEp = s.episodes.find((e) => !isDone(e));
    if (nextEp) items.push({ key: `series:${s.key}`, title: s.show, sub: `Next: ${epLabel(nextEp.ep)}`, play: nextEp, img: imageFor(nextEp), overview: (nextEp.tmdb && nextEp.tmdb.overview) || '' });
  }
  for (const m of singles) if (!isDone(m)) items.push({ key: `movie:${m.id}`, title: (m.tmdb && m.tmdb.title) || m.title, sub: [m.tmdb && m.tmdb.year, fmt(m.duration)].filter(Boolean).join(' · '), play: m, img: imageFor(m), overview: (m.tmdb && m.tmdb.overview) || '' });
  return items;
}
function renderPick() {
  const items = candidates();
  const me = myName();
  const mine = fstate.votes[me] || {};
  const others = Object.keys(fstate.votes).filter((n) => n !== me);
  const matches = items.filter((it) => mine[it.key] === 1 && others.some((n) => (fstate.votes[n] || {})[it.key] === 1));
  const todo = items.filter((it) => mine[it.key] === undefined);
  const card = todo[0];
  const area = $('pickArea');
  area.innerHTML = `
    <div class="pick-head"><h3>Swipe ♥ on what you'd like to watch. When you both ♥ the same one, it's a match.</h3></div>
    <div class="pick-deck">${card ? `
      <div class="swipe-card" id="swipeCard">
        <div class="swipe-img" ${card.img ? `style="background-image:url('${card.img}')"` : ''}>${card.img ? '' : Art.scene('heroes')}</div>
        <div class="swipe-text"><b>${escapeHtml(card.title)}</b><span class="muted small">${escapeHtml(card.sub)}</span>${card.overview ? `<p>${escapeHtml(card.overview)}</p>` : ''}</div>
        <div class="swipe-stamp yes">♥</div><div class="swipe-stamp no">✗</div>
      </div>
      <div class="swipe-btns"><button class="swipe-no" id="voteNo" aria-label="Not tonight">✗</button><span class="muted small">${todo.length} left</span><button class="swipe-yes" id="voteYes" aria-label="Yes please">♥</button></div>`
      : `<div class="empty"><p class="muted">${items.length ? "You've swiped everything!" : 'Add some movies first.'}</p></div>`}</div>
    <div class="matches">
      <h3>💞 Your matches ${matches.length ? `(${matches.length})` : ''}</h3>
      ${matches.length ? `<div class="match-list">${matches.map((m) => `<button class="match" data-key="${escapeHtml(m.key)}"><span class="match-img" ${m.img ? `style="background-image:url('${m.img}')"` : ''}></span><b>${escapeHtml(m.title)}</b><span>▶</span></button>`).join('')}</div>`
        : `<p class="muted small">${others.length ? 'No matches yet. Keep swiping!' : `Waiting for your partner to swipe too.`}</p>`}
      <div class="row">
        <button class="primary" id="spinBtn" ${(matches.length || items.length) ? '' : 'disabled'}>🎡 Spin the wheel${matches.length >= 2 ? ' (matches)' : ''}</button>
        <span class="spacer"></span>
        <button class="ghost small" id="resetVotes">Start over</button>
      </div>
    </div>`;
  if (card) {
    const vote = (v) => { send({ t: 'vote', key: card.key, v }); fstate.votes[me] = { ...mine, [card.key]: v }; animateSwipe(v, renderPick); };
    $('voteYes').onclick = () => vote(1);
    $('voteNo').onclick = () => vote(-1);
    enableSwipe($('swipeCard'), vote);
  }
  for (const b of area.querySelectorAll('.match')) b.onclick = () => { const it = items.find((x) => x.key === b.dataset.key); if (it) play(it.play); };
  $('spinBtn').onclick = () => {
    const pool = (matches.length >= 2 ? matches : items).slice(0, 12);
    if (!pool.length) return;
    const winner = pool[Math.floor(Math.random() * pool.length)];
    send({ t: 'wheel', key: winner.key, keys: pool.map((p) => p.key) });
  };
  $('resetVotes').onclick = () => { if (confirm('Clear both of your swipes and start over?')) send({ t: 'votesReset' }); };
}
function animateSwipe(v, done) {
  const c = $('swipeCard');
  if (!c) { done(); return; }
  c.classList.add(v > 0 ? 'gone-right' : 'gone-left');
  setTimeout(done, 260);
}
function enableSwipe(el, vote) {
  let x0 = null; let dx = 0;
  el.addEventListener('pointerdown', (e) => { x0 = e.clientX; dx = 0; el.setPointerCapture(e.pointerId); el.style.transition = 'none'; });
  el.addEventListener('pointermove', (e) => {
    if (x0 === null) return;
    dx = e.clientX - x0;
    el.style.transform = `translateX(${dx}px) rotate(${dx / 20}deg)`;
    el.classList.toggle('lean-yes', dx > 40);
    el.classList.toggle('lean-no', dx < -40);
  });
  const end = () => {
    if (x0 === null) return;
    x0 = null;
    el.style.transition = '';
    if (dx > 90) vote(1); else if (dx < -90) vote(-1);
    else { el.style.transform = ''; el.classList.remove('lean-yes', 'lean-no'); }
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
}

// The wheel spins on both screens and lands on the same pick.
function showWheel(m) {
  const items = candidates();
  const pool = m.keys.map((k) => items.find((i) => i.key === k)).filter(Boolean);
  const winnerIdx = pool.findIndex((p) => p.key === m.key);
  if (winnerIdx < 0 || !pool.length) return;
  const colors = ['#e9b4ab', '#c9976a', '#b2606b', '#f3d27a', '#9ec5de', '#d9c4a5'];
  const seg = 360 / pool.length;
  const wheel = $('wheel');
  wheel.style.transition = 'none';
  wheel.style.transform = 'rotate(0deg)';
  wheel.style.background = `conic-gradient(${pool.map((p, i) => `${colors[i % colors.length]} ${i * seg}deg ${(i + 1) * seg}deg`).join(',')})`;
  $('wheelSheet').classList.remove('hidden');
  const radius = (wheel.clientWidth || 300) / 2;
  wheel.innerHTML = pool.map((p, i) => `<span class="wheel-label" style="transform: translate(-50%, -50%) rotate(${i * seg + seg / 2}deg) translateY(-${Math.round(radius * 0.58)}px)">${escapeHtml(p.title.slice(0, 16))}</span>`).join('');
  $('wheelResult').innerHTML = `<p class="muted">${escapeHtml(m.by)} spun the wheel…</p>`;
  $('wheelSheet').classList.remove('hidden');
  const target = 360 * 6 + (360 - (winnerIdx * seg + seg / 2));
  requestAnimationFrame(() => requestAnimationFrame(() => {
    wheel.style.transition = 'transform 4.2s cubic-bezier(.12,.75,.12,1)';
    wheel.style.transform = `rotate(${target}deg)`;
  }));
  setTimeout(() => {
    const w = pool[winnerIdx];
    $('wheelResult').innerHTML = `<h2>Tonight: ${escapeHtml(w.title)} 🎉</h2><div class="row center"><button class="ghost" id="wheelClose">Not yet</button><button class="primary" id="wheelPlay">▶ Watch it</button></div>`;
    $('wheelClose').onclick = () => $('wheelSheet').classList.add('hidden');
    $('wheelPlay').onclick = () => { $('wheelSheet').classList.add('hidden'); play(w.play); };
  }, 4400);
}
$('wheelSheet').addEventListener('click', (e) => { if (e.target === $('wheelSheet')) $('wheelSheet').classList.add('hidden'); });

// ---- Movie-night countdown -------------------------------------------------------------------
function partner() {
  const me = myName().toLowerCase();
  const names = Object.keys(fstate.people).filter((n) => n.toLowerCase() !== me);
  return names.find((n) => personalInfo.her && n.toLowerCase() === personalInfo.her.toLowerCase())
    || names.find((n) => personalInfo.him && n.toLowerCase() === personalInfo.him.toLowerCase()) || names[0];
}
function whenText(date, tz) {
  try {
    return date.toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: tz || undefined });
  } catch { return date.toLocaleString(); }
}
function renderCountdown() {
  const el = $('countdownCard');
  const s = fstate.schedule;
  if (!s || !s.at) {
    el.innerHTML = '<button class="ghost small" id="planBtn">📅 Plan our next movie night</button>';
    $('planBtn').onclick = openSchedule;
    return;
  }
  const at = new Date(s.at);
  const ms = at - serverNow();
  if (ms < -3 * 3600000) {
    el.innerHTML = '<button class="ghost small" id="planBtn">📅 Plan our next movie night</button>';
    $('planBtn').onclick = openSchedule;
    return;
  }
  const p = partner();
  const ptz = p && fstate.people[p] && fstate.people[p].tz;
  const myTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const left = ms <= 0 ? "It's movie night! 🍿" : (() => {
    const d = Math.floor(ms / 86400000), h = Math.floor((ms % 86400000) / 3600000), m = Math.floor((ms % 3600000) / 60000), sec = Math.floor((ms % 60000) / 1000);
    return d ? `${d}d ${h}h ${m}m` : h ? `${h}h ${m}m ${sec}s` : `${m}m ${sec}s`;
  })();
  el.innerHTML = `<div class="countdown">
      <div class="countdown-left"><span class="muted small">Next movie night</span><b class="countdown-time">${escapeHtml(left)}</b></div>
      <div class="countdown-when"><span>🕗 ${escapeHtml(whenText(at, myTz))} <span class="muted">your time</span></span>
        ${p && ptz && ptz !== myTz ? `<span>🕗 ${escapeHtml(whenText(at, ptz))} <span class="muted">${escapeHtml(p)}'s time</span></span>` : ''}</div>
      <button class="ghost small" id="planBtn">Change</button></div>`;
  $('planBtn').onclick = openSchedule;
}
setInterval(() => { if (currentTab === 'home' && !$('library').classList.contains('hidden') && fstate.schedule) renderCountdown(); }, 1000);

function openSchedule() {
  const s = fstate.schedule;
  const d = s && s.at ? new Date(s.at) : new Date(Date.now() + 86400000);
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  $('scheduleAt').value = local;
  updateSchedulePreview();
  $('scheduleSheet').classList.remove('hidden');
}
function updateSchedulePreview() {
  const v = $('scheduleAt').value;
  const p = partner();
  const ptz = p && fstate.people[p] && fstate.people[p].tz;
  $('schedulePreview').textContent = v && ptz ? `That's ${whenText(new Date(v), ptz)} for ${p}.` : '';
}
$('scheduleAt').addEventListener('input', updateSchedulePreview);
$('scheduleSave').onclick = () => { const v = $('scheduleAt').value; if (!v) return; send({ t: 'schedule', at: new Date(v).toISOString() }); $('scheduleSheet').classList.add('hidden'); toast('Movie night planned 📅'); };
$('scheduleClear').onclick = () => { send({ t: 'schedule', at: null }); $('scheduleSheet').classList.add('hidden'); };
for (const b of document.querySelectorAll('[data-close]')) b.onclick = () => $(b.dataset.close).classList.add('hidden');
for (const id of ['scheduleSheet', 'noteSheet']) $(id).addEventListener('click', (e) => { if (e.target === $(id)) $(id).classList.add('hidden'); });

// ---- Notifications --------------------------------------------------------------------------
function urlB64(base64) {
  const pad = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}
async function updateNotifyButton() {
  const btn = $('notifyBtn');
  const ok = 'Notification' in window && 'serviceWorker' in navigator && 'PushManager' in window && window.isSecureContext && fstate.pushKey;
  if (!ok || isHost) { btn.classList.add('hidden'); return; }
  let subscribed = false;
  try { const reg = await navigator.serviceWorker.ready; subscribed = !!(await reg.pushManager.getSubscription()); } catch { /* ignore */ }
  btn.classList.toggle('hidden', subscribed && Notification.permission === 'granted');
}
$('notifyBtn').onclick = async () => {
  try {
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') { toast('Notifications are blocked. You can allow them in Chrome site settings.', 6000); return; }
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64(fstate.pushKey) });
    await api('/api/f/push', { sub: sub.toJSON(), deviceId, name: myName() });
    await api('/api/f/push-test', {});
    toast('Notifications on 🔔');
    updateNotifyButton();
  } catch (e) { toast(`Couldn't turn on notifications: ${e.message}`, 6000); }
};

// ---- Personalize: TMDB key ------------------------------------------------------------------
const savePersonalOriginal = $('savePersonal').onclick;
$('personalBtn').addEventListener('click', () => {
  $('pTmdb').value = '';
  $('pTmdb').placeholder = hostInfo && hostInfo.tmdbKey ? 'Saved ✓ (paste a new one to replace it)' : 'Paste your free TMDB key';
});
$('savePersonal').onclick = async () => {
  const key = $('pTmdb').value.trim();
  if (key) {
    try {
      const r = await api('/api/host/tmdb', { key });
      toast(r.updated ? `Found posters & info for ${r.updated} movie${r.updated === 1 ? '' : 's'} 🎬` : 'TMDB key saved. Posters will appear as movies are looked up.', 6000);
      if (hostInfo) hostInfo.tmdbKey = true;
      refreshMovies();
    } catch (e) { toast(e.message, 8000); return; }
  }
  if (savePersonalOriginal) await savePersonalOriginal();
};

// Extra moments for the polaroid strip: snapshots you saved while watching.
function extraMoments() {
  return fstate.snaps.slice(-12).reverse().map((s) => ({ html: `<img src="${s.file}" alt="" loading="lazy">`, cap: s.title.slice(0, 26) }));
}

showTab(currentTab);
