/* Movie Night - a fuller home screen: the together dashboard, a rotating hero banner,
 * Discover (TMDB suggestions), and the sidebar of things to do together: daily question,
 * emoji movie puzzles, this-or-that, activity feed and profiles.
 * Uses globals from app.js, home.js and fun.js. */
'use strict';

const me = () => myName();
const nameOrYou = (n) => (n === me() ? 'You' : petName(n));
function ago(ts) {
  const s = Math.max(0, (Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)} d ago`;
  return new Date(ts).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}
const avatarHtml = (n) => (n ? `<span class="avatar">${Art.head(avatarFor({ name: n }))}</span>` : '<span class="avatar heart-av">💞</span>');
/** The two of you: names seen anywhere (you first). */
function couple() {
  // The sign-in names from Personalize (e.g. "Romario Benn" and "Jelina"), you first.
  const logins = [personalInfo.himLogin, personalInfo.herLogin].filter(Boolean);
  const names = new Set([me(), ...logins]);
  for (const n of Object.keys(fstate.people || {})) names.add(n);
  for (const e of fstate.diary || []) for (const n of Object.keys(e.ratings)) names.add(n);
  const list = [...names].filter(Boolean);
  const two = logins.length === 2 ? logins : list.slice(0, 2);
  return two.sort((a, b) => (a === me() ? -1 : b === me() ? 1 : 0));
}
const partnerName = () => petName(couple().find((n) => n !== me()) || '') || 'your love';

// =================================================================================
// Together dashboard
// =================================================================================
function weekStart(ts) { const d = new Date(ts); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d.getTime(); }
function currentStreak() {
  const weeks = new Set((fstate.diary || []).map((e) => weekStart(e.at)));
  let w = weekStart(Date.now());
  const thisWeek = weeks.has(w);
  if (!thisWeek) w -= 604800000;
  let n = 0;
  while (weeks.has(w)) { n++; w -= 604800000; }
  return { n, thisWeek };
}
function memory() {
  const diary = [...(fstate.diary || [])].sort((a, b) => b.at - a.at);
  if (!diary.length) return null;
  const near = (daysAgo) => diary.find((e) => Math.abs((Date.now() - e.at) / 86400000 - daysAgo) <= 2);
  const y = near(365);
  if (y) return { label: 'A year ago today', e: y };
  const m = near(30);
  if (m) return { label: 'A month ago', e: m };
  const first = diary[diary.length - 1];
  if (diary.length > 3 && Math.random() < 0.5) return { label: 'Your first movie together', e: first };
  return { label: 'Last time', e: diary[0] };
}
function renderDash() {
  const el = $('dash');
  const cards = [];
  if (personalInfo.since) {
    const days = Math.floor((Date.now() - new Date(`${personalInfo.since}T00:00:00`)) / 86400000);
    cards.push(`<div class="dash-card"><span class="dash-icon">💞</span><div><b>${days.toLocaleString()} days</b><span class="muted small">together${personalInfo.nights ? ` · movie night #${personalInfo.nights}` : ''}</span></div></div>`);
  }
  const zones = Object.entries(fstate.people || {}).filter(([, p]) => p.tz).slice(0, 2);
  if (zones.length) {
    const t = (tz) => { try { return new Date().toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', timeZone: tz }); } catch { return ''; } };
    const hour = (tz) => { try { return Number(new Date().toLocaleString('en-GB', { hour: 'numeric', hour12: false, timeZone: tz })); } catch { return 12; } };
    const same = zones.length < 2 || t(zones[0][1].tz) === t(zones[1][1].tz);
    cards.push(`<div class="dash-card clocks">${same
      ? `<span class="dash-icon">${hour(zones[0][1].tz) >= 7 && hour(zones[0][1].tz) < 19 ? '☀️' : '🌙'}</span><div><b>${t(zones[0][1].tz)}</b><span class="muted small">for both of you</span></div>`
      : zones.map(([n, p]) => `<div class="clock">${avatarHtml(n)}<div><b>${t(p.tz)} ${hour(p.tz) >= 7 && hour(p.tz) < 19 ? '☀️' : '🌙'}</b><span class="muted small">${escapeHtml(nameOrYou(n))}${n === me() ? '' : '\'s time'}</span></div></div>`).join('')}</div>`);
  }
  const st = currentStreak();
  cards.push(`<div class="dash-card"><span class="dash-icon">🔥</span><div><b>${st.n ? `${st.n}-week streak` : 'Start a streak'}</b><span class="muted small">${st.thisWeek ? 'Watched this week ✓' : 'Nothing yet this week'}</span></div></div>`);
  const earned = typeof earnedBadges === 'function' ? earnedBadges() : [];
  const lastId = Object.entries(fstate.badgeLog || {}).sort((a, b) => b[1] - a[1]).map(([k]) => k).find((k) => earned.some((b) => b.id === k));
  const last = earned.find((b) => b.id === lastId) || earned[earned.length - 1];
  cards.push(`<button class="dash-card link" data-go="diary"><span class="dash-icon">${last ? last.icon : '🏅'}</span><div><b>${earned.length} of ${typeof BADGES !== 'undefined' ? BADGES.length : 0} badges</b><span class="muted small">${last ? `Latest: ${escapeHtml(last.name)}` : 'Earn them by watching together'}</span></div></button>`);
  const mem = memory();
  if (mem) {
    const mv = movies.find((m) => m.id === mem.e.movieId);
    const img = mv ? imageFor(mv, 'tall') : null;
    cards.push(`<button class="dash-card link memory" data-go="diary">${img ? `<span class="mem-img" style="background-image:url('${img}')"></span>` : '<span class="dash-icon">🎞️</span>'}<div><span class="muted small">${escapeHtml(mem.label)}</span><b>${escapeHtml(mem.e.title)}</b></div></button>`);
  } else cards.push('<div class="dash-card"><span class="dash-icon">🍿</span><div><b>Your first movie night</b><span class="muted small">is waiting for you two</span></div></div>');
  el.innerHTML = cards.join('');
  for (const b of el.querySelectorAll('[data-go]')) b.onclick = () => showTab(b.dataset.go);
}
setInterval(() => { if (!$('library').classList.contains('hidden')) renderDash(); }, 30000);

// =================================================================================
// Rotating hero banner
// =================================================================================
let heroItems = [];
let heroIdx = 0;
let heroPausedUntil = 0;
const baseRenderHero = renderHero;
function pickHeroItems() {
  const ready = movies.filter((m) => !m.pending);
  const out = [];
  const add = (mv, kicker) => { if (mv && !out.some((x) => x.mv.id === mv.id)) out.push({ mv, kicker }); };
  const cont = ready.filter(inProgress).sort((a, b) => progressOf(b).at - progressOf(a).at);
  cont.slice(0, 2).forEach((mv) => add(mv, 'Continue watching'));
  add([...ready].sort((a, b) => String(b.preparedAt).localeCompare(String(a.preparedAt)))[0], 'Newest');
  const favs = ready.filter((m) => isFav(m.id)).sort((a, b) => avgStars(b.id) - avgStars(a.id));
  add(favs[0], 'Your favourite ♥');
  const unwatched = ready.filter((m) => !isDone(m) && !inProgress(m));
  const shuffled = (list) => list.map((x) => [Math.random(), x]).sort((p, q) => p[0] - q[0]).map((x) => x[1]);
  for (const mv of shuffled(unwatched)) { if (out.length >= 4) break; add(mv, 'Not watched yet'); }
  for (const mv of shuffled(ready)) { if (out.length >= 5) break; add(mv, 'Watch it again?'); }
  return out.slice(0, 5);
}
function showHero(i) {
  if (!heroItems.length) { baseRenderHero(); return; }
  heroIdx = ((i % heroItems.length) + heroItems.length) % heroItems.length;
  const it = heroItems[heroIdx];
  baseRenderHero(it.mv, it.kicker);
  const hero = $('hero');
  hero.classList.remove('fade-in'); void hero.offsetWidth; hero.classList.add('fade-in');
  if (heroItems.length > 1) {
    hero.insertAdjacentHTML('beforeend', `<div class="hero-dots">${heroItems.map((_, k) => `<button class="${k === heroIdx ? 'on' : ''}" data-k="${k}" aria-label="Show ${k + 1}"></button>`).join('')}</div>`);
    for (const b of hero.querySelectorAll('.hero-dots button')) b.onclick = (e) => { e.stopPropagation(); heroPausedUntil = Date.now() + 20000; showHero(Number(b.dataset.k)); };
  }
}
renderHero = function (forced, kicker) {
  if (forced) { baseRenderHero(forced, kicker); return; }
  const prev = heroItems[heroIdx] && heroItems[heroIdx].mv.id;
  heroItems = pickHeroItems();
  const keep = heroItems.findIndex((x) => x.mv.id === prev);
  showHero(keep >= 0 ? keep : 0);
};
setInterval(() => {
  if (heroItems.length < 2 || Date.now() < heroPausedUntil || $('library').classList.contains('hidden') || currentTab !== 'home') return;
  if ($('hero').matches(':hover')) return;
  showHero(heroIdx + 1);
}, 9000);

// =================================================================================
// Discover (TMDB recommendations you don't have yet)
// =================================================================================
let discoverData = null;
let discoverAt = 0;
async function loadDiscover(force) {
  if (!force && Date.now() - discoverAt < 10 * 60000) return;
  discoverAt = Date.now();
  try { const r = await fetch('/api/f/discover', { cache: 'no-store' }); if (r.ok) discoverData = await r.json(); } catch { /* offline */ }
  renderDiscover();
}
function renderDiscover() {
  const el = $('discover');
  if (!discoverData || !discoverData.items.length) {
    el.innerHTML = isHost && discoverData && (discoverData.reason === 'no-key' || discoverData.reason === 'bad-key')
      ? '<h3 class="row-title">✨ Discover</h3><p class="muted small pad">Add a free TMDB key in 🎀 Personalize to get movie suggestions here, picked from what you two love.</p>' : '';
    return;
  }
  const wished = new Set((fstate.wishlist || []).map((w) => w.title.toLowerCase().replace(/\s*\(\d{4}\)$/, '')));
  const groups = new Map();
  for (const it of discoverData.items) { const k = it.because || ''; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(it); }
  el.innerHTML = [...groups].map(([because, items], gi) => `<section class="row-block"><h3 class="row-title">${because ? `✨ Because you loved <i>${escapeHtml(because)}</i>` : '✨ Trending this week'}</h3>
    <div class="row-scroll posters">${items.map((it, i) => `<button class="poster-tile" data-g="${gi}" data-i="${i}" title="${escapeHtml(it.overview)}">
      <span class="poster-img" style="background-image:url('${it.poster}')">${wished.has(it.title.toLowerCase()) ? '<span class="tile-badge">🌟 On our wishlist</span>' : ''}</span>
      <b>${escapeHtml(it.title)}</b><span class="muted small">${[it.year, it.rating ? `★ ${it.rating.toFixed(1)}` : '', it.kind === 'tv' ? 'Series' : ''].filter(Boolean).join(' · ')}</span></button>`).join('')}</div></section>`).join('');
  const groupList = [...groups.values()];
  for (const b of el.querySelectorAll('.poster-tile')) b.onclick = () => openDiscoverCard(groupList[Number(b.dataset.g)][Number(b.dataset.i)]);
}
function openDiscoverCard(it) {
  let sheet = $('discoverSheet');
  if (!sheet) {
    sheet = document.createElement('div');
    sheet.id = 'discoverSheet';
    sheet.className = 'modal hidden';
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-modal', 'true');
    document.body.appendChild(sheet);
    sheet.addEventListener('click', (e) => { if (e.target === sheet) sheet.classList.add('hidden'); });
  }
  const wished = (fstate.wishlist || []).some((w) => w.title.toLowerCase().startsWith(it.title.toLowerCase()));
  sheet.innerHTML = `<div class="sheet discover-card"><div class="dc-poster" style="background-image:url('${it.poster}')"></div>
    <div class="dc-body"><h2></h2><div class="muted small">${[it.year, it.rating ? `★ ${it.rating.toFixed(1)}` : '', (it.genres || []).slice(0, 3).join(', ')].filter(Boolean).map(escapeHtml).join(' · ')}</div>
      <p></p>${it.because ? `<p class="muted small">Suggested because you loved ${escapeHtml(it.because)}.</p>` : ''}
      <div class="row"><button class="ghost" id="dcClose">Close</button><span class="spacer"></span>
      <button class="primary" id="dcWish" ${wished ? 'disabled' : ''}>${wished ? '🌟 On our wishlist' : '🌟 Add to our wishlist'}</button></div></div></div>`;
  sheet.querySelector('h2').textContent = it.title;
  sheet.querySelector('p').textContent = it.overview || '';
  $('dcClose').onclick = () => sheet.classList.add('hidden');
  $('dcWish').onclick = () => {
    send({ t: 'wish', title: it.year ? `${it.title} (${it.year})` : it.title });
    sheet.classList.add('hidden');
    toast(`🌟 ${it.title} is on your wishlist`);
  };
  sheet.classList.remove('hidden');
}

// =================================================================================
// Sidebar: things to do together
// =================================================================================
const TOT = [
  ['popcorn', '🍿 Popcorn', '🌮 Nachos'], ['genre1', '💘 Rom-com', '👻 Horror'], ['subs', '💬 Subtitles on', '🙉 Subtitles off'], ['time', '🌙 Late-night movie', '☀️ Afternoon movie'],
  ['sweet', '🍫 Chocolate', '🍬 Sweets'], ['ending', '😭 Sad ending', '🥰 Happy ending'], ['length', '⏱️ 90 minutes', '🎞️ Three-hour epic'], ['old', '📼 Classic', '🆕 Brand new'],
  ['blanket', '🛋️ Blanket on the sofa', '🛏️ Cosy in bed'], ['anim', '🎨 Animated', '🎬 Live action'], ['series', '📺 One more episode', '🎥 One whole movie'],
  ['hero', '🦸 Marvel', '🦇 DC'], ['scare', '😱 Jump scares', '🔪 Slow creepy'], ['drink', '🥤 Fizzy drink', '🍵 Hot tea'], ['rewatch', '🔁 Rewatch a favourite', '✨ Something new'],
  ['villain', '😈 Love the villain', '😇 Team hero'], ['music', '🎶 Musicals', '🔇 No singing please'], ['twist', '🌀 Big plot twist', '🧩 Figure it out early'],
  ['dub', '🗣️ Dubbed', '🈶 Original language'], ['date', '🕯️ Fancy date night', '🧦 Pyjama night'], ['space', '🚀 Space', '🌊 Ocean'], ['pizza', '🍕 Pizza', '🍣 Sushi'],
  ['cry', '😢 Movies that make you cry', '😂 Movies that make you laugh'], ['trailer', '🎟️ Watch the trailer first', '🙈 Go in blind'], ['credits', '🧾 Stay for the credits', '⏭️ Skip them'],
  ['book', '📚 Book first', '🎬 Movie first'], ['cinema', '🏛️ Big cinema', '🏡 Home sofa'], ['dog', '🐶 Dog movies', '🐱 Cat movies'], ['xmas', '🎄 Christmas movies in November', '🗓️ Only in December'],
  ['spoil', '🤐 No spoilers ever', '🤷 Spoilers are fine'], ['snackshare', '🤝 Share snacks', '🙅 Own snacks'], ['decide', '🎲 Spin the wheel', '🗳️ Talk it through'],
  ['anime', '🌸 Anime', '🤠 Westerns'], ['real', '📖 True story', '🧚 Pure fantasy'], ['volume', '🔊 Loud', '🔉 Quiet so we can talk'], ['sequel', '2️⃣ Sequels', '1️⃣ Originals only'],
  ['remake', '♻️ Remakes', '🚫 Leave classics alone'], ['hour', '⏰ Start on time', '🐢 Start whenever'], ['lights', '💡 Lights off', '🕯️ Fairy lights'], ['kiss', '💋 Kiss scenes', '🙈 Skip the soppy bits'],
];
let totLast = null; // the one you just answered, to show the result

function renderSide() {
  const side = $('homeSide');
  side.innerHTML = `${dailyCard()}${emojiCard()}${totCard()}${activityCard()}${profilesCard()}`;
  wireDaily(); wireEmoji(); wireTot();
  for (const d of side.querySelectorAll('details[data-key]')) {
    d.open = store.get(`mn_open_${d.dataset.key}`) === '1';
    d.addEventListener('toggle', () => store.set(`mn_open_${d.dataset.key}`, d.open ? '1' : '0'));
  }
}

// ---- Daily question
function dailyCard() {
  const t = fstate.today || { q: '', answers: {} };
  const mine = t.answers[me()];
  const others = Object.entries(t.answers).filter(([n]) => n !== me());
  let body;
  if (!mine) {
    body = `${others.length ? `<p class="muted small">💌 ${escapeHtml(petName(others[0][0]))} already answered. Answer to see theirs!</p>` : ''}
      <form id="dailyForm" class="side-form"><textarea id="dailyText" rows="2" maxlength="300" placeholder="Your answer…"></textarea><button class="primary small" type="submit">Answer</button></form>`;
  } else if (!others.length || others[0][1].sealed) {
    body = `<div class="answer mine">${avatarHtml(me())}<p></p></div><p class="muted small">🔒 Sealed. You'll both see the answers once ${escapeHtml(partnerName())} answers.</p>`;
  } else {
    body = [[me(), mine], ...others].map(([n, a]) => `<div class="answer">${avatarHtml(n)}<div><b>${escapeHtml(nameOrYou(n))}</b><p data-ans="${escapeHtml(n)}"></p></div></div>`).join('');
  }
  const hist = (fstate.dailyHistory || []).slice(0, 7);
  return `<section class="side-card daily"><div class="side-kicker">💭 Today's question</div><h3 class="daily-q"></h3>${body}
    ${hist.length ? `<details data-key="dailyhist"><summary>Past questions</summary>${hist.map((h) => `<div class="hist"><b>${escapeHtml(h.q)}</b>${Object.entries(h.answers).map(([n, a]) => `<div class="answer small">${avatarHtml(n)}<span>${escapeHtml(a.text)}</span></div>`).join('')}</div>`).join('')}</details>` : ''}</section>`;
}
function wireDaily() {
  const t = fstate.today || { q: '', answers: {} };
  const card = document.querySelector('.side-card.daily');
  if (!card) return;
  card.querySelector('.daily-q').textContent = t.q;
  const mineP = card.querySelector('.answer.mine p');
  if (mineP && t.answers[me()]) mineP.textContent = t.answers[me()].text;
  for (const p of card.querySelectorAll('[data-ans]')) { const a = t.answers[p.dataset.ans]; p.textContent = a ? a.text : ''; }
  const form = $('dailyForm');
  if (form) {
    $('dailyText').addEventListener('keydown', (e) => e.stopPropagation());
    form.onsubmit = (e) => {
      e.preventDefault();
      const text = $('dailyText').value.trim();
      if (!text) return;
      send({ t: 'dailyAnswer', text });
      toast('💭 Answer sealed');
    };
  }
}

// ---- Emoji movie puzzles
let emojiMaking = false;
function currentPuzzle() {
  const ps = fstate.emoji || [];
  const open = (p) => !p.solvedBy[me()] && !p.gaveUp[me()] && p.by !== me();
  return ps.find((p) => !p.daily && open(p)) || ps.find((p) => p.daily) || null;
}
function emojiScores() {
  const s = {};
  for (const p of fstate.emoji || []) for (const n of Object.keys(p.solvedBy || {})) s[n] = (s[n] || 0) + 1;
  return s;
}
function emojiCard() {
  const p = currentPuzzle();
  const waiting = (fstate.emoji || []).filter((x) => !x.daily && x.by !== me() && !x.solvedBy[me()] && !x.gaveUp[me()]).length;
  const mine = (fstate.emoji || []).filter((x) => x.by === me()).slice(-3);
  const scores = emojiScores();
  let body = '';
  if (emojiMaking) {
    body = `<form id="emojiForm" class="side-form"><input id="emNew" maxlength="40" placeholder="Emojis, e.g. 🦁👑🌅" required>
      <input id="emAnswer" maxlength="80" placeholder="The movie, e.g. The Lion King" required><input id="emHint" maxlength="60" placeholder="Hint (optional), e.g. Animated, 1994">
      <div class="row"><button class="ghost small" type="button" id="emCancel">Cancel</button><span class="spacer"></span><button class="primary small" type="submit">Send to ${escapeHtml(partnerName())}</button></div></form>`;
  } else if (p) {
    const done = p.solvedBy[me()] || p.gaveUp[me()];
    body = `<div class="emoji-big">${escapeHtml(p.emojis)}</div>
      <div class="muted small">${p.daily ? 'Today\'s puzzle' : `From ${escapeHtml(p.by)}`}${p.hint ? ` · ${escapeHtml(p.hint)}` : ''} · ${p.letters} letters</div>
      ${done ? `<p class="emoji-answer">${p.solvedBy[me()] ? '✓ Solved!' : 'It was'} <b>${escapeHtml(p.answer || '')}</b></p>`
        : `<form id="emojiGuess" class="side-form inline"><input id="emGuess" maxlength="100" placeholder="Which movie is it?"><button class="primary small" type="submit">Guess</button></form>
           <button class="link-btn" id="emGiveUp" data-id="${escapeHtml(p.id)}">Give up</button>`}`;
  }
  return `<section class="side-card emoji"><div class="side-kicker">🧩 Emoji movie guess${waiting > 1 ? ` · ${waiting} waiting for you` : ''}</div>${body}
    ${emojiMaking ? '' : `<div class="row emoji-foot"><span class="muted small">${couple().map((n) => `${escapeHtml(nameOrYou(n))} ${scores[n] || 0}`).join(' · ')}</span><span class="spacer"></span><button class="ghost small" id="emMake">✏️ Make one for ${escapeHtml(partnerName())}</button></div>`}
    ${mine.length && !emojiMaking ? `<div class="muted small">Your puzzles: ${mine.map((x) => `${escapeHtml(x.emojis)} ${Object.keys(x.solvedBy).length ? '✓' : '…'}`).join('  ')}</div>` : ''}</section>`;
}
function wireEmoji() {
  const p = currentPuzzle();
  for (const id of ['emGuess', 'emNew', 'emAnswer', 'emHint']) { const x = $(id); if (x) x.addEventListener('keydown', (e) => e.stopPropagation()); }
  if ($('emojiGuess')) $('emojiGuess').onsubmit = (e) => {
    e.preventDefault();
    const guess = $('emGuess').value.trim();
    if (guess) send({ t: 'emojiGuess', id: p.id, guess });
  };
  if ($('emGiveUp')) $('emGiveUp').onclick = () => send({ t: 'emojiGiveUp', id: $('emGiveUp').dataset.id });
  if ($('emMake')) $('emMake').onclick = () => { emojiMaking = true; renderSide(); $('emNew').focus(); };
  if ($('emCancel')) $('emCancel').onclick = () => { emojiMaking = false; renderSide(); };
  if ($('emojiForm')) $('emojiForm').onsubmit = (e) => {
    e.preventDefault();
    send({ t: 'emojiNew', emojis: $('emNew').value.trim(), answer: $('emAnswer').value.trim(), hint: $('emHint').value.trim() });
    emojiMaking = false;
    toast(`🧩 Sent to ${partnerName()}!`);
  };
}

// ---- This or that
function totCard() {
  const answers = fstate.tot || {};
  const next = TOT.find(([id]) => !(answers[id] && answers[id][me()] !== undefined));
  const both = TOT.filter(([id]) => answers[id] && answers[id][me()] !== undefined && Object.keys(answers[id]).some((n) => n !== me()));
  const agree = both.filter(([id]) => { const a = answers[id]; const o = Object.keys(a).find((n) => n !== me()); return a[o] === a[me()]; });
  let result = '';
  if (totLast) {
    const [id, a, b] = TOT.find((x) => x[0] === totLast) || [];
    const ans = answers[id] || {};
    const o = Object.keys(ans).find((n) => n !== me());
    const mineTxt = ans[me()] === 0 ? a : b;
    result = o === undefined ? `<p class="tot-result">You picked <b>${escapeHtml(mineTxt)}</b>. ${escapeHtml(partnerName())} hasn't answered yet 🤫</p>`
      : ans[o] === ans[me()] ? `<p class="tot-result match">💞 You both picked <b>${escapeHtml(mineTxt)}</b>!</p>`
        : `<p class="tot-result">You: <b>${escapeHtml(mineTxt)}</b> · ${escapeHtml(o)}: <b>${escapeHtml(ans[o] === 0 ? a : b)}</b> 😄</p>`;
  }
  return `<section class="side-card tot"><div class="side-kicker">⚖️ This or that</div>${result}
    ${next ? `<div class="tot-pair"><button class="tot-btn" data-id="${next[0]}" data-c="0"></button><span class="tot-or">or</span><button class="tot-btn" data-id="${next[0]}" data-c="1"></button></div>`
      : '<p class="muted small">You\'ve answered them all! 🎉</p>'}
    <div class="muted small">${both.length ? `You agree on <b>${Math.round((agree.length / both.length) * 100)}%</b> (${agree.length} of ${both.length})` : `Answer a few and see how much you and ${escapeHtml(partnerName())} agree.`}</div></section>`;
}
function wireTot() {
  const btns = document.querySelectorAll('.tot-btn');
  btns.forEach((b) => { const pair = TOT.find((x) => x[0] === b.dataset.id); b.textContent = pair[1 + Number(b.dataset.c)]; });
  for (const b of btns) b.onclick = () => {
    totLast = b.dataset.id;
    const c = Number(b.dataset.c);
    (fstate.tot[totLast] || (fstate.tot[totLast] = {}))[me()] = c; // show the result straight away
    send({ t: 'tot', id: totLast, choice: c });
    renderSide();
  };
}

// ---- Activity feed
function activityCard() {
  const list = [...(fstate.activity || [])].reverse().slice(0, 12);
  return `<section class="side-card activity"><div class="side-kicker">💌 Lately</div>
    ${list.length ? `<div class="feed">${list.map((a) => `<div class="feed-item">${avatarHtml(a.by)}<div><span>${a.by ? `<b>${escapeHtml(nameOrYou(a.by))}</b> ` : ''}${escapeHtml(a.text)}</span><span class="muted small">${ago(a.at)}</span></div>
      ${a.img ? `<img src="${escapeHtml(a.img)}" alt="" loading="lazy">` : ''}</div>`).join('')}</div>`
      : '<p class="muted small">Love notes, ratings, wishes, badges and games show up here.</p>'}</section>`;
}

// ---- Profiles
function profileStats(n) {
  const diary = fstate.diary || [];
  const rated = diary.filter((e) => e.ratings[n]);
  const avg = rated.length ? rated.reduce((s, e) => s + e.ratings[n].stars, 0) / rated.length : null;
  const gcount = {};
  for (const e of rated.filter((x) => x.ratings[n].stars >= 4)) for (const g of genresOf(e.movieId)) gcount[g] = (gcount[g] || 0) + 1;
  const topGenre = Object.entries(gcount).sort((a, b) => b[1] - a[1])[0];
  const rc = {};
  for (const r of fstate.reactions || []) if (r.by === n) rc[r.key] = (rc[r.key] || 0) + 1;
  const topReact = Object.entries(rc).sort((a, b) => b[1] - a[1])[0];
  const games = fstate.games || [];
  return {
    avg, rated: rated.length, topGenre: topGenre && topGenre[0], topReact: topReact && EMOJI[topReact[0]],
    reacts: Object.values(rc).reduce((a, b) => a + b, 0),
    quiz: games.filter((g) => g.type === 'quiz' && (g.winners || []).length === 1 && g.winners[0] === n).length,
    bingo: games.filter((g) => g.type === 'bingo' && g.winner === n).length,
    puzzles: emojiScores()[n] || 0,
    notes: (fstate.notes || []).filter((x) => x.from === n).length,
  };
}
function profilesCard() {
  const people = couple();
  return `<section class="side-card profiles"><div class="side-kicker">👫 Us</div><div class="profile-grid">${people.map((n) => {
    const s = profileStats(n);
    const rows = [
      ['⭐', 'Average rating', s.avg ? `${s.avg.toFixed(1)}★` : '–'],
      ['🎬', 'Movies rated', s.rated],
      ['❤️', 'Loves', s.topGenre || '–'],
      ['😊', 'Go-to reaction', s.topReact ? `${s.topReact} (${s.reacts})` : '–'],
      ['🧠', 'Quiz wins', s.quiz], ['🎯', 'Bingos', s.bingo], ['🧩', 'Puzzles solved', s.puzzles], ['💌', 'Love notes', s.notes],
    ];
    return `<div class="profile"><div class="profile-head">${avatarHtml(n)}<b>${escapeHtml(petName(n))}</b></div>${rows.map(([i, l, v]) => `<div class="stat-row"><span>${i} ${l}</span><b>${escapeHtml(String(v))}</b></div>`).join('')}</div>`;
  }).join('')}</div></section>`;
}

// =================================================================================
// Hooks
// =================================================================================
function onHubMessage(m) {
  if (m.t === 'emojiResult') {
    if (m.ok) { celebrate(`🧩 Yes! It's ${m.answer}!`); }
    else if (m.gaveUp) toast(`It was "${m.answer}" 🙈`);
    else {
      const inp = $('emGuess');
      if (inp) { inp.classList.remove('shake'); void inp.offsetWidth; inp.classList.add('shake'); inp.select(); }
      toast('Not quite. Try again! 🤔');
    }
  }
}
const baseRenderHome2 = renderHome;
renderHome = function () {
  baseRenderHome2();
  for (const r of document.querySelectorAll('#rows .row-block')) r.classList.toggle('few', r.querySelectorAll('.tile').length <= 3);
  renderDash();
  // Don't wipe something you're typing.
  const typing = document.activeElement && $('homeSide').contains(document.activeElement) && /INPUT|TEXTAREA/.test(document.activeElement.tagName);
  if (!typing) renderSide();
  renderDiscover();
  loadDiscover();
};

// =================================================================================
// The wheel: choose the films, call her to come watch, spin together
// =================================================================================
/** Every movie and show you could put on the wheel (watched ones too). */
function wheelItems() {
  const { series, movies: singles } = Series.group(movies.filter((m) => !m.pending));
  const out = [];
  for (const s of series) {
    const ep = s.episodes.find((e) => !isDone(e)) || s.episodes[0];
    out.push({ key: `series:${s.key}`, title: s.show, sub: `Next: ${epLabel(ep.ep)}`, play: ep, img: imageFor(ep), done: s.episodes.every(isDone) });
  }
  for (const m of singles) {
    out.push({ key: `movie:${m.id}`, title: (m.tmdb && m.tmdb.title) || m.title, sub: [m.tmdb && m.tmdb.year, fmt(m.duration)].filter(Boolean).join(' · '),
      play: m, img: imageFor(m, 'tall') || imageFor(m), done: isDone(m) });
  }
  return out;
}
const WHEEL_COLORS = ['#e9b4ab', '#c9976a', '#b2606b', '#f3d27a', '#9ec5de', '#d9c4a5'];
/** What's on the wheel: the films you chose, else your matches, else what you haven't watched. */
function wheelPool() {
  const all = wheelItems();
  const chosen = ((fstate.wheelPicks && fstate.wheelPicks.keys) || []).map((k) => all.find((x) => x.key === k)).filter(Boolean);
  if (chosen.length) return { items: chosen, source: 'chosen' };
  const me = myName();
  const mine = (fstate.votes || {})[me] || {};
  const others = Object.keys(fstate.votes || {}).filter((n) => n !== me);
  const matches = all.filter((it) => mine[it.key] === 1 && others.some((n) => (fstate.votes[n] || {})[it.key] === 1));
  if (matches.length >= 2) return { items: matches.slice(0, 12), source: 'matches' };
  return { items: all.filter((x) => !x.done).slice(0, 8), source: 'unwatched' };
}
function miniWheel(items) {
  if (!items.length) return '<div class="mini-wheel empty">🎡</div>';
  const seg = 360 / items.length;
  return `<div class="mini-wheel" style="background:conic-gradient(${items.map((p, i) => `${WHEEL_COLORS[i % WHEEL_COLORS.length]} ${i * seg}deg ${(i + 1) * seg}deg`).join(',')})"><span>${items.length}</span></div>`;
}
let wheelLive = null;
function renderWheelPanel() {
  const el = $('wheelPanel');
  if (!el) return;
  const { items, source } = wheelPool();
  const other = partnerName();
  const live = wheelLive || fstate.wheelLive;
  const calling = live && live.phase === 'calling';
  const watchers = live ? live.watchers.filter((n) => n !== myName()) : [];
  const srcText = source === 'chosen' ? `Chosen by ${escapeHtml(fstate.wheelPicks.by === myName() ? 'you' : petName(fstate.wheelPicks.by))}`
    : source === 'matches' ? 'Your matches (choose your own with ✏️)' : 'What you haven\'t watched (choose your own with ✏️)';
  el.innerHTML = `<div class="wheel-panel-top">${miniWheel(items)}
    <div class="wheel-panel-text"><h3>🎡 Our wheel</h3><span class="muted small">${srcText}</span>
      <div class="wheel-chips">${items.map((it) => `<span class="wheel-chip">${escapeHtml(it.title)}${source === 'chosen' ? `<button data-rm="${escapeHtml(it.key)}" aria-label="Take ${escapeHtml(it.title)} off the wheel">✕</button>` : ''}</span>`).join('') || '<span class="muted small">Nothing to spin yet.</span>'}</div></div></div>
    <div class="wheel-actions">
      <button class="ghost small" id="wheelEdit">✏️ Choose films</button>
      ${source === 'chosen' ? '<button class="ghost small" id="wheelClear">↺ Clear</button>' : ''}
      <span class="spacer"></span>
      ${calling && live.by === myName() ? `<span class="wheel-live">${watchers.length ? `👀 ${escapeHtml(watchers.map(petName).join(' & '))} ${watchers.length > 1 ? 'are' : 'is'} watching!` : `📣 Waiting for ${escapeHtml(other)}…`}</span>`
        : `<button class="ghost small" id="wheelCall" ${items.length < 2 ? 'disabled' : ''}>📣 Call ${escapeHtml(other)} to watch</button>`}
      <button class="primary ${calling && watchers.length ? 'pulse' : ''}" id="wheelSpin" ${items.length < 2 ? 'disabled' : ''}>🎡 Spin!</button>
    </div>`;
  for (const b of el.querySelectorAll('[data-rm]')) b.onclick = () => send({ t: 'wheelSet', keys: fstate.wheelPicks.keys.filter((k) => k !== b.dataset.rm) });
  $('wheelEdit').onclick = openWheelPicker;
  if ($('wheelClear')) $('wheelClear').onclick = () => send({ t: 'wheelSet', keys: [] });
  if ($('wheelCall')) $('wheelCall').onclick = () => { send({ t: 'wheelCall' }); openWheelLobby(); };
  $('wheelSpin').onclick = () => spinWheel();
}
function spinWheel() {
  const { items } = wheelPool();
  if (items.length < 2) { toast('Put at least two films on the wheel first.'); return; }
  send({ t: 'wheel', keys: items.map((x) => x.key) });
}

// ---- Choosing the films
let pickerSel = new Set();
function openWheelPicker() {
  const all = wheelItems();
  pickerSel = new Set(((fstate.wheelPicks && fstate.wheelPicks.keys) || wheelPool().items.map((x) => x.key)).filter((k) => all.some((x) => x.key === k)));
  let sheet = $('wheelPickSheet');
  if (!sheet) {
    sheet = document.createElement('div');
    sheet.id = 'wheelPickSheet';
    sheet.className = 'modal hidden';
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-modal', 'true');
    sheet.setAttribute('aria-label', 'Choose the films for the wheel');
    document.body.appendChild(sheet);
    sheet.addEventListener('click', (e) => { if (e.target === sheet) sheet.classList.add('hidden'); });
  }
  const draw = () => {
    const unwatched = all.filter((x) => !x.done);
    sheet.innerHTML = `<div class="sheet wheel-pick"><header class="sheet-head"><b>🎡 What goes on the wheel?</b><button class="ghost small" id="wpClose" aria-label="Close">✕</button></header>
      <div class="wp-quick"><span class="muted small">Quick:</span>
        <button class="ghost small" data-q="matches">💞 Our matches</button><button class="ghost small" data-q="random">🎲 6 random unwatched</button><button class="ghost small" data-q="none">Clear all</button></div>
      <div class="wp-grid">${all.map((it, i) => `<button class="wp-item ${pickerSel.has(it.key) ? 'on' : ''}" data-i="${i}" aria-pressed="${pickerSel.has(it.key)}">
        <span class="wp-img" ${it.img ? `style="background-image:url('${it.img}')"` : ''}>${pickerSel.has(it.key) ? '<span class="wp-check">✓</span>' : ''}${it.done ? '<span class="tile-badge">✓ Watched</span>' : ''}</span>
        <b>${escapeHtml(it.title)}</b><span class="muted small">${escapeHtml(it.sub)}</span></button>`).join('')}</div>
      <div class="row pad wp-foot"><span class="muted">${pickerSel.size} on the wheel${pickerSel.size > 12 ? ' (max 12)' : pickerSel.size === 2 ? ' · a toss-up!' : ''}</span><span class="spacer"></span>
        <button class="primary" id="wpDone" ${pickerSel.size < 2 || pickerSel.size > 12 ? 'disabled' : ''}>Put them on the wheel</button></div></div>`;
    for (const b of sheet.querySelectorAll('.wp-item')) b.onclick = () => { const k = all[Number(b.dataset.i)].key; if (pickerSel.has(k)) pickerSel.delete(k); else pickerSel.add(k); draw(); };
    for (const b of sheet.querySelectorAll('[data-q]')) b.onclick = () => {
      if (b.dataset.q === 'none') pickerSel = new Set();
      if (b.dataset.q === 'random') pickerSel = new Set(unwatched.map((x) => [Math.random(), x.key]).sort((p, q) => p[0] - q[0]).slice(0, 6).map((x) => x[1]));
      if (b.dataset.q === 'matches') {
        const me = myName(); const mine = (fstate.votes || {})[me] || {};
        const others = Object.keys(fstate.votes || {}).filter((n) => n !== me);
        pickerSel = new Set(all.filter((it) => mine[it.key] === 1 && others.some((n) => (fstate.votes[n] || {})[it.key] === 1)).map((x) => x.key).slice(0, 12));
        if (!pickerSel.size) toast('No matches yet: swipe ♥ in Pick together first.');
      }
      draw();
    };
    $('wpClose').onclick = () => sheet.classList.add('hidden');
    $('wpDone').onclick = () => { send({ t: 'wheelSet', keys: [...pickerSel] }); sheet.classList.add('hidden'); toast(`🎡 ${pickerSel.size} films on the wheel`); };
  };
  draw();
  sheet.classList.remove('hidden');
}

// ---- Waiting at the wheel together (before the spin)
let inLobby = false;
function openWheelLobby() {
  const { items } = wheelPool();
  if (items.length < 2) return;
  inLobby = true;
  const seg = 360 / items.length;
  const wheel = $('wheel');
  wheel.style.transition = 'none';
  wheel.style.transform = 'rotate(0deg)';
  wheel.style.background = `conic-gradient(${items.map((p, i) => `${WHEEL_COLORS[i % WHEEL_COLORS.length]} ${i * seg}deg ${(i + 1) * seg}deg`).join(',')})`;
  $('wheelSheet').classList.remove('hidden');
  const radius = (wheel.clientWidth || 300) / 2;
  wheel.innerHTML = items.map((p, i) => `<span class="wheel-label" style="transform: translate(-50%, -50%) rotate(${i * seg + seg / 2}deg) translateY(-${Math.round(radius * 0.58)}px)">${escapeHtml(p.title.slice(0, 16))}</span>`).join('');
  renderLobby();
}
function renderLobby() {
  if (!inLobby || $('wheelSheet').classList.contains('hidden')) return;
  const live = wheelLive;
  if (live && live.phase === 'spinning') { inLobby = false; return; } // the spin takes over
  const here = live ? live.watchers : [myName()];
  const others = here.filter((n) => n !== myName());
  const caller = live && live.by;
  $('wheelResult').innerHTML = `<div class="lobby">${here.map((n) => `<span class="lobby-person"><span class="avatar">${Art.head(avatarFor({ name: n }))}</span>${escapeHtml(n === myName() ? 'You' : petName(n))}</span>`).join('')}</div>
    <p class="muted">${!live ? '' : caller === myName() ? (others.length ? `${escapeHtml(others.map(petName).join(' & '))} ${others.length > 1 ? 'are' : 'is'} here 👀 Spin when you're ready!` : `📣 Called ${escapeHtml(partnerName())}. Waiting for them to come…`)
      : `${escapeHtml(petName(caller))} is about to spin…`}</p>
    <div class="row center"><button class="ghost" id="lobbyClose">Close</button><button class="primary" id="lobbySpin">🎡 Spin!</button></div>`;
  $('lobbyClose').onclick = () => { send({ t: 'wheelLeave' }); inLobby = false; $('wheelSheet').classList.add('hidden'); };
  $('lobbySpin').onclick = () => spinWheel();
}
function comeWatch(by) {
  // Wherever she is in the app (not mid-movie): a big invitation.
  if (meta) { toast(`🎡 ${petName(by)} wants to spin the wheel. It'll be in Pick together after the movie.`, 6000); return; }
  let el = $('wheelInvite');
  if (!el) {
    el = document.createElement('div');
    el.id = 'wheelInvite';
    el.className = 'modal';
    el.setAttribute('role', 'alertdialog');
    document.body.appendChild(el);
  }
  const { items } = wheelPool();
  el.innerHTML = `<div class="sheet invite-card"><div class="invite-wheel">${miniWheel(items)}</div>
    <h2>🎡 ${escapeHtml(petName(by))} is about to spin the wheel!</h2>
    <p class="muted">On the wheel: ${escapeHtml(items.map((x) => x.title).join(', '))}</p>
    <div class="row center"><button class="ghost" id="inviteNo">Not now</button><button class="primary" id="inviteYes">👀 Come watch</button></div></div>`;
  el.classList.remove('hidden');
  if (navigator.vibrate) { try { navigator.vibrate([80, 60, 80]); } catch { /* not allowed */ } }
  $('inviteNo').onclick = () => el.classList.add('hidden');
  $('inviteYes').onclick = () => { el.classList.add('hidden'); send({ t: 'wheelWatch' }); showTab('pick'); openWheelLobby(); };
}
// Live wheel messages arrive through the fun/hub message hook.
const baseOnHubMessage = onHubMessage;
onHubMessage = function (m) {
  if (m.t === 'wheelCall') {
    wheelLive = { phase: 'calling', by: m.by, watchers: [m.by], at: m.at };
    if (m.by !== myName()) comeWatch(m.by);
    renderWheelPanel(); renderLobby();
    return;
  }
  if (m.t === 'wheelLive') {
    wheelLive = m.live;
    if (m.joined && m.joined !== myName() && wheelLive && wheelLive.by === myName()) toast(`👀 ${petName(m.joined)} is here to watch the spin!`);
    if (!wheelLive && $('wheelInvite')) $('wheelInvite').classList.add('hidden');
    renderWheelPanel(); renderLobby();
    return;
  }
  baseOnHubMessage(m);
};
