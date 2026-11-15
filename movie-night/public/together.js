/* Movie Night - together features while watching: curtains countdown, live chat,
 * hold-to-cuddle, love notes, snapshots, skip intro, next episode, and the diary rating card.
 * Uses globals from app.js and home.js. */
'use strict';

// ---- Messages from the server ------------------------------------------------------------
function onFeatureMessage(m) {
  switch (m.t) {
    case 'fchanged': loadFeatures(); break;
    case 'chat': showChat(m); break;
    case 'cuddle': onCuddle(m); break;
    case 'countdown': showCurtains(m.at); break;
    case 'nextUp': showNextUp(m); break;
    case 'rateMe': openRateCard(m.entryId, m.title, m.movieId); break;
    case 'snap': flash(); toast(`📸 ${m.by === myName() ? 'You' : petName(m.by)} saved a moment to your diary`); break;
    case 'wheel': if (!meta) { showTab('pick'); showWheel(m); } break;
    case 'wantAck': toast(m.by === myName()
      ? `⏳ Getting "${m.title}" ready. It'll open on both screens in about a minute.`
      : `⏳ ${petName(m.by)} picked "${m.title}". It'll open on both screens in about a minute.`, 7000); break;
    default: if (typeof onFunMessage === 'function') onFunMessage(m);
  }
}

// ---- Curtains + 3-2-1 when a movie starts -----------------------------------------------
function showCurtains(at) {
  if (!meta) return;
  const el = $('curtains');
  el.classList.remove('hidden', 'open');
  const tick = () => {
    const left = at - serverNow();
    if (left <= 0) {
      el.classList.add('open');
      $('curtainCount').textContent = '';
      setTimeout(() => el.classList.add('hidden'), 1600);
      return;
    }
    $('curtainCount').textContent = String(Math.min(3, Math.ceil(left / 1000)));
    setTimeout(tick, 100);
  };
  tick();
}

// ---- Live chat --------------------------------------------------------------------------------
$('chatBtn').onclick = (e) => {
  e.stopPropagation();
  const bar = $('chatBar');
  bar.classList.toggle('hidden');
  if (!bar.classList.contains('hidden')) { showChrome(); $('chatInput').focus(); }
};
$('chatBar').onsubmit = (e) => {
  e.preventDefault();
  const text = $('chatInput').value.trim();
  if (!text) return;
  send({ t: 'chat', text });
  $('chatInput').value = '';
};
$('chatInput').addEventListener('keydown', (e) => {
  e.stopPropagation(); // don't let typing trigger player shortcuts (space = pause)
  if (e.key === 'Escape') $('chatBar').classList.add('hidden');
});
function showChat(m) {
  const log = $('chatLog');
  const el = document.createElement('div');
  el.className = `chat-msg ${m.from === myName() ? 'mine' : ''}`;
  el.innerHTML = `<span class="avatar">${Art.head(avatarFor({ name: m.from }))}</span><span class="chat-bubble"><b></b><span></span></span>`;
  el.querySelector('b').textContent = petName(m.from);
  el.querySelector('.chat-bubble span').textContent = m.text;
  log.appendChild(el);
  while (log.children.length > 4) log.firstChild.remove();
  setTimeout(() => el.classList.add('fade'), 9000);
  setTimeout(() => el.remove(), 10000);
}

// ---- Hold to cuddle ----------------------------------------------------------------------------
let holdingNow = false;
const startHold = (e) => { e.preventDefault(); if (holdingNow) return; holdingNow = true; $('cuddleBtn').classList.add('holding'); send({ t: 'hold', on: true }); };
const endHold = () => { if (!holdingNow) return; holdingNow = false; $('cuddleBtn').classList.remove('holding'); send({ t: 'hold', on: false }); };
$('cuddleBtn').addEventListener('pointerdown', startHold);
for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) $('cuddleBtn').addEventListener(ev, endHold);
$('cuddleBtn').addEventListener('contextmenu', (e) => e.preventDefault());
let heartTimer = null;
let cuddleHintAt = 0;
function onCuddle(m) {
  const me = myName();
  const others = m.holders.filter((n) => n !== me);
  $('cuddleBtn').classList.toggle('invite', others.length > 0 && !m.holders.includes(me));
  if (m.on) {
    if (!heartTimer) heartTimer = setInterval(spawnHeart, 140);
  } else {
    clearInterval(heartTimer); heartTimer = null;
    if (others.length && !m.holders.includes(me) && Date.now() - cuddleHintAt > 8000) {
      cuddleHintAt = Date.now();
      toast(`🤗 ${petName(others[0])} wants a cuddle. Hold 🤗 too!`);
    }
  }
}
function spawnHeart() {
  const h = document.createElement('div');
  h.className = 'heart';
  h.textContent = ['❤️', '💕', '💗', '💖', '🤍'][Math.floor(Math.random() * 5)];
  h.style.left = `${Math.random() * 100}%`;
  h.style.fontSize = `${20 + Math.random() * 30}px`;
  h.style.animationDuration = `${3 + Math.random() * 2}s`;
  $('hearts').appendChild(h);
  setTimeout(() => h.remove(), 5200);
}

// ---- Love notes ----------------------------------------------------------------------------
$('noteBtn').onclick = (e) => {
  e.stopPropagation();
  if (!meta) return;
  const t = video.currentTime;
  $('noteWhere').textContent = `At ${fmt(t)} in ${meta.title}. It'll pop up for the other person when they reach this moment.`;
  $('noteText').value = '';
  $('noteSheet').classList.remove('hidden');
  $('noteText').focus();
  $('noteSave').onclick = () => {
    const text = $('noteText').value.trim();
    if (!text) return;
    send({ t: 'note', movieId: meta.id, time: t, text });
    $('noteSheet').classList.add('hidden');
    toast('💌 Note left');
  };
};
$('noteText').addEventListener('keydown', (e) => e.stopPropagation());
function seenNotes() { try { return new Set(JSON.parse(store.get('mn_notesSeen') || '[]')); } catch { return new Set(); } }
function checkNotes() {
  if (!meta || video.paused) return;
  const t = video.currentTime;
  const seen = seenNotes();
  const due = fstate.notes.find((n) => n.movieId === meta.id && n.from !== myName() && !seen.has(n.id) && t >= n.time && t < n.time + 20);
  if (!due) return;
  seen.add(due.id);
  store.set('mn_notesSeen', JSON.stringify([...seen].slice(-500)));
  const el = $('noteToast');
  el.innerHTML = `<div class="note-env">💌</div><div><span class="muted small">A love note from</span> <b></b><p></p></div>`;
  el.querySelector('b').textContent = petName(due.from);
  el.querySelector('p').textContent = due.text;
  el.classList.remove('hidden');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.add('hidden'), 12000);
}
video.addEventListener('timeupdate', checkNotes);
$('noteToast').onclick = () => $('noteToast').classList.add('hidden');

// ---- Snapshot -------------------------------------------------------------------------------
$('snapBtn').onclick = async (e) => {
  e.stopPropagation();
  if (!meta || !video.videoWidth) return;
  const scale = Math.min(1, 1280 / video.videoWidth);
  const c = document.createElement('canvas');
  c.width = Math.round(video.videoWidth * scale);
  c.height = Math.round(video.videoHeight * scale);
  c.getContext('2d').drawImage(video, 0, 0, c.width, c.height);
  const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.88));
  if (!blob) { toast("Couldn't capture this frame."); return; }
  try {
    const r = await fetch(`/api/f/snapshot?movieId=${encodeURIComponent(meta.id)}&t=${video.currentTime.toFixed(1)}&by=${encodeURIComponent(myName())}`, {
      method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: blob,
    });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.status);
  } catch (err) { toast(`Couldn't save the snapshot: ${err.message}`); }
};
function flash() {
  const f = $('flash');
  f.classList.remove('hidden');
  f.classList.remove('go'); void f.offsetWidth; f.classList.add('go');
  setTimeout(() => f.classList.add('hidden'), 700);
}

// ---- Skip intro -------------------------------------------------------------------------------
let skippedFor = null;
function updateSkipIntro() {
  const btn = $('skipIntro');
  const ep = meta && Series.parse(meta.title);
  const t = video.currentTime;
  const show = !!(ep && skippedFor !== meta.id && state && state.wantPlay && t > 10 && t < 8 * 60);
  btn.classList.toggle('hidden', !show);
}
video.addEventListener('timeupdate', updateSkipIntro);
$('skipIntro').onclick = () => {
  const ep = Series.parse(meta.title);
  const intro = (ep && fstate.series[ep.key] && fstate.series[ep.key].intro) || 85;
  skippedFor = meta.id;
  send({ t: 'seek', pos: Math.min(duration() - 5, expectedPos() + intro) });
  updateSkipIntro();
};

// ---- Next episode ----------------------------------------------------------------------------
let nextTimer = null;
function showNextUp(m) {
  const el = $('nextUp');
  clearInterval(nextTimer);
  if (m.cancel) { el.classList.add('hidden'); return; }
  const ep = Series.parse(m.title);
  const render = () => {
    const left = Math.max(0, Math.ceil((m.at - serverNow()) / 1000));
    el.innerHTML = `<span class="muted small">Next episode in ${left}s</span><b></b>
      <div class="row"><button class="ghost small" id="nextCancel">Cancel</button><button class="primary" id="nextNow">▶ Play now</button></div>`;
    el.querySelector('b').textContent = ep ? `E${ep.episode}${ep.name ? ` · ${ep.name}` : ''}` : m.title;
    $('nextCancel').onclick = () => send({ t: 'nextCancel' });
    $('nextNow').onclick = () => send({ t: 'nextNow' });
  };
  render();
  el.classList.remove('hidden');
  nextTimer = setInterval(render, 1000);
}

// ---- Review card (critic style) --------------------------------------------------------------
const REVIEW_TAGS = ['😭 Made me cry', '😂 So funny', '💘 Romantic', '😱 Scary', '🎭 Great acting', '🎨 Beautiful', '🎶 Great music', '🌀 Mind-blowing', '🐢 A bit slow', '🔁 Rewatch!'];
let rating = { entryId: null, movieId: null, stars: 0, tags: new Set() };
function openRateCard(entryId, title, movieId, manual) {
  const entry = entryId ? fstate.diary.find((e) => e.id === entryId) : [...fstate.diary].reverse().find((e) => e.movieId === movieId);
  const mine = entry && entry.ratings[myName()];
  if (mine && !manual) return; // already reviewed (the end-of-movie card only asks once)
  rating = { entryId: entry ? entry.id : null, movieId, stars: mine ? mine.stars : 0, tags: new Set(mine ? mine.tags || [] : []) };
  $('rateTitle').textContent = mine ? `Your review of ${title}` : `How was ${title}?`;
  $('rateArt').innerHTML = Art.couple('love');
  $('rateText').value = mine ? mine.text || '' : '';
  $('rateReview').value = mine ? mine.review || '' : '';
  $('rateMore').open = !!(mine && mine.review);
  $('rateSave').textContent = mine ? 'Save changes' : 'Save to our diary';
  renderStars();
  renderTags();
  $('rateCard').classList.remove('hidden');
}
function renderStars() {
  const s = rating.stars;
  $('rateStars').innerHTML = [1, 2, 3, 4, 5].map((n) => `<span class="star ${s >= n ? 'on' : s >= n - 0.5 ? 'half' : ''}" data-n="${n}">★</span>`).join('');
  $('rateStars').setAttribute('aria-valuenow', String(s));
  const v = starVerdict(s);
  $('rateVerdict').textContent = s ? `${starText(s)}  ${v}` : 'Tap a star (tap its left half for ½)';
  $('rateVerdict').classList.toggle('set', !!s);
}
$('rateStars').addEventListener('click', (e) => {
  const st = e.target.closest('.star');
  if (!st) return;
  const r = st.getBoundingClientRect();
  const n = Number(st.dataset.n);
  rating.stars = e.clientX - r.left < r.width / 2 ? n - 0.5 : n;
  renderStars();
});
$('rateStars').addEventListener('keydown', (e) => {
  if (e.key === 'ArrowRight' || e.key === 'ArrowUp') rating.stars = Math.min(5, (rating.stars || 0) + 0.5);
  else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') rating.stars = Math.max(0.5, (rating.stars || 1) - 0.5);
  else return;
  e.preventDefault(); e.stopPropagation(); renderStars();
});
function renderTags() {
  $('rateTags').innerHTML = REVIEW_TAGS.map((t) => `<button class="rtag ${rating.tags.has(t) ? 'on' : ''}" aria-pressed="${rating.tags.has(t)}"></button>`).join('');
  $('rateTags').querySelectorAll('.rtag').forEach((b, i) => {
    b.textContent = REVIEW_TAGS[i];
    b.onclick = () => { const t = REVIEW_TAGS[i]; if (rating.tags.has(t)) rating.tags.delete(t); else rating.tags.add(t); renderTags(); };
  });
}
$('rateSave').onclick = () => {
  if (!rating.stars) { toast('Tap the stars first ⭐'); return; }
  send({ t: 'rate', entryId: rating.entryId, movieId: rating.movieId, stars: rating.stars, text: $('rateText').value.trim(), review: $('rateReview').value.trim(), tags: [...rating.tags] });
  $('rateCard').classList.add('hidden');
  toast('Saved to your diary 📖');
};
$('rateSkip').onclick = () => $('rateCard').classList.add('hidden');
for (const id of ['rateText', 'rateReview']) $(id).addEventListener('keydown', (e) => e.stopPropagation());

// ---- Hooks from app.js ---------------------------------------------------------------------------
function afterOpenMovie() {
  $('nextUp').classList.add('hidden');
  $('chatBar').classList.add('hidden');
  updateSkipIntro();
  if (typeof funAfterOpen === 'function') funAfterOpen();
}
function afterCloseMovie() {
  $('nextUp').classList.add('hidden');
  $('curtains').classList.add('hidden');
  if (typeof funAfterClose === 'function') funAfterClose();
  loadFeatures();
}
function afterState() { updateSkipIntro(); if (typeof funAfterState === 'function') funAfterState(); }
function afterFeatures() { updateNotifyButton(); drawArt(); if (typeof funAfterFeatures === 'function') funAfterFeatures(); }

loadFeatures();
