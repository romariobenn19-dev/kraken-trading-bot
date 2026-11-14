/**
 * Movie Night - real posters, backdrops, descriptions and ratings from TMDB (themoviedb.org).
 * Optional: needs a free TMDB API key (Personalize on the laptop). Results are cached per
 * movie in library/<id>/tmdb.json with the images saved next to it.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const Series = require('./public/series');

const API = process.env.TMDB_BASE || 'https://api.themoviedb.org/3';
const IMG = process.env.TMDB_IMG || 'https://image.tmdb.org/t/p';

module.exports = function createTmdb({ LIBRARY, config, listMovies, onUpdated }) {
  let genres = null;
  let running = false;
  let again = false;

  const key = () => String(config.tmdbKey || '').trim();

  async function get(pathname, params = {}) {
    const k = key();
    const url = new URL(API + pathname);
    for (const [a, b] of Object.entries(params)) if (b !== undefined && b !== '') url.searchParams.set(a, b);
    const headers = { Accept: 'application/json' };
    // v4 "read access tokens" are long JWTs; v3 "API keys" are 32 hex characters.
    if (k.length > 40) headers.Authorization = `Bearer ${k}`; else url.searchParams.set('api_key', k);
    const r = await fetch(url, { headers });
    if (r.status === 401) throw Object.assign(new Error('TMDB key was rejected'), { auth: true });
    if (!r.ok) throw new Error(`TMDB ${r.status}`);
    return r.json();
  }

  async function download(remote, file) {
    if (!remote) return null;
    if (fs.existsSync(file)) return path.basename(file);
    const r = await fetch(`${IMG}${remote}`);
    if (!r.ok) return null;
    fs.writeFileSync(file, Buffer.from(await r.arrayBuffer()));
    return path.basename(file);
  }

  async function genreNames() {
    if (genres) return genres;
    const [m, t] = await Promise.all([get('/genre/movie/list'), get('/genre/tv/list')]);
    genres = new Map([...(m.genres || []), ...(t.genres || [])].map((g) => [g.id, g.name]));
    return genres;
  }

  /** "Resident Evil (2026)" -> { query: "Resident Evil", year: "2026" } */
  function splitYear(title) {
    const m = String(title).match(/^(.*?)\s*\((\d{4})\)\s*$/);
    return m ? { query: m[1], year: m[2] } : { query: title, year: '' };
  }

  async function lookup(mv) {
    const dir = path.join(LIBRARY, mv.id);
    const ep = Series.parse(mv.title);
    const g = await genreNames();
    let info;
    if (ep) {
      const found = (await get('/search/tv', { query: ep.show })).results || [];
      const show = found[0];
      if (!show) return { found: false };
      let episode = null;
      try { episode = await get(`/tv/${show.id}/season/${ep.season}/episode/${ep.episode}`); } catch { /* not listed */ }
      info = {
        kind: 'episode', tmdbId: show.id, show: show.name, title: episode && episode.name ? `${show.name} · ${episode.name}` : show.name,
        overview: (episode && episode.overview) || show.overview || '', rating: show.vote_average || null,
        year: (show.first_air_date || '').slice(0, 4), genres: (show.genre_ids || []).map((i) => g.get(i)).filter(Boolean),
        language: show.original_language || '',
        poster: await download(show.poster_path && `/w500${show.poster_path}`, path.join(dir, 'tmdb-poster.jpg')),
        backdrop: await download(show.backdrop_path && `/w1280${show.backdrop_path}`, path.join(dir, 'tmdb-backdrop.jpg')),
        still: await download(episode && episode.still_path && `/w780${episode.still_path}`, path.join(dir, 'tmdb-still.jpg')),
      };
    } else {
      const { query, year } = splitYear(mv.title);
      const found = (await get('/search/movie', { query, year })).results || [];
      const film = found[0] || ((await get('/search/movie', { query })).results || [])[0];
      if (!film) return { found: false };
      info = {
        kind: 'movie', tmdbId: film.id, title: film.title, overview: film.overview || '', rating: film.vote_average || null,
        year: (film.release_date || '').slice(0, 4), genres: (film.genre_ids || []).map((i) => g.get(i)).filter(Boolean),
        language: film.original_language || '',
        poster: await download(film.poster_path && `/w500${film.poster_path}`, path.join(dir, 'tmdb-poster.jpg')),
        backdrop: await download(film.backdrop_path && `/w1280${film.backdrop_path}`, path.join(dir, 'tmdb-backdrop.jpg')),
      };
    }
    info.anime = info.genres.includes('Animation') && info.language === 'ja';
    return { found: true, ...info };
  }

  /** Look up every movie that hasn't been looked up yet (one at a time, in the background). */
  async function refresh(force) {
    if (!key()) return { ok: false, reason: 'no-key' };
    if (running) { again = true; return { ok: true, reason: 'busy' }; }
    running = true;
    let updated = 0;
    try {
      for (const mv of listMovies()) {
        const file = path.join(LIBRARY, mv.id, 'tmdb.json');
        if (!force && fs.existsSync(file)) continue;
        try {
          const info = await lookup(mv);
          fs.writeFileSync(file, JSON.stringify({ ...info, title_lookedup: mv.title, at: Date.now() }, null, 2));
          updated++;
        } catch (e) {
          if (e.auth) return { ok: false, reason: 'bad-key' };
          console.log(`  TMDB: couldn't look up "${mv.title}": ${e.message}`);
        }
      }
    } finally {
      running = false;
      if (updated) onUpdated();
      if (again) { again = false; setTimeout(() => refresh(), 1000); }
    }
    return { ok: true, updated };
  }

  /** Read cached info for a movie (merged into /api/movies). */
  function cached(id) {
    try {
      const t = JSON.parse(fs.readFileSync(path.join(LIBRARY, id, 'tmdb.json'), 'utf8'));
      return t.found ? t : null;
    } catch { return null; }
  }

  /**
   * "Because you loved X": movies you don't have yet, from TMDB recommendations for the
   * ones you rated highest (or what's trending, if there's nothing to go on yet).
   */
  let discoverCache = null;
  async function discover(seeds, lib, wishlist) {
    if (!key()) return { items: [], reason: 'no-key' };
    const seedInfo = seeds.map((m) => ({ m, t: cached(m.id) })).filter((x) => x.t && x.t.tmdbId);
    const cacheKey = seedInfo.slice(0, 4).map((x) => x.t.tmdbId).join(',');
    if (discoverCache && discoverCache.key === cacheKey && Date.now() - discoverCache.at < 6 * 3600000) return discoverCache.value;
    const norm = (t) => String(t).toLowerCase().replace(/\(\d{4}\)/g, '').replace(/[^a-z0-9]+/g, '');
    const have = new Set(lib.map((m) => cached(m.id)).filter(Boolean).map((t) => `${t.kind === 'episode' ? 'tv' : 'movie'}:${t.tmdbId}`));
    const haveTitles = new Set([...lib.map((m) => norm((cached(m.id) || {}).show || (cached(m.id) || {}).title || m.title)), ...(wishlist || []).map((w) => norm(w.title))]);
    const lists = [];
    const seen = new Set();
    const usedShows = new Set();
    for (const { m, t } of seedInfo) {
      if (lists.length >= 4) break;
      const kind = t.kind === 'episode' ? 'tv' : 'movie';
      if (kind === 'tv' && usedShows.has(t.tmdbId)) continue;
      usedShows.add(t.tmdbId);
      try {
        const r = await get(`/${kind}/${t.tmdbId}/recommendations`);
        lists.push({ because: kind === 'tv' ? (t.show || m.title) : (t.title || m.title), kind, results: r.results || [] });
      } catch (e) { if (e.auth) return { items: [], reason: 'bad-key' }; }
    }
    if (!lists.some((l) => l.results.length)) {
      try { lists.push({ because: null, kind: 'movie', results: (await get('/trending/movie/week')).results || [] }); } catch (e) { return { items: [], reason: e.auth ? 'bad-key' : 'offline' }; }
    }
    const g = await genreNames().catch(() => new Map());
    const items = [];
    for (let i = 0; items.length < 18 && i < 20; i++) {
      for (const l of lists) {
        const r = l.results[i];
        if (!r) continue;
        const kind = r.media_type === 'tv' || l.kind === 'tv' ? 'tv' : 'movie';
        const title = r.title || r.name;
        const k = `${kind}:${r.id}`;
        if (!title || !r.poster_path || seen.has(k) || have.has(k) || haveTitles.has(norm(title))) continue;
        seen.add(k);
        items.push({ tmdbId: r.id, kind, title, year: (r.release_date || r.first_air_date || '').slice(0, 4), overview: r.overview || '',
          rating: r.vote_average || null, poster: `${IMG}/w342${r.poster_path}`, genres: (r.genre_ids || []).map((x) => g.get(x)).filter(Boolean), because: l.because });
      }
    }
    const value = { items, reason: items.length ? null : 'none' };
    discoverCache = { key: cacheKey, at: Date.now(), value };
    return value;
  }

  return { refresh, cached, discover, hasKey: () => !!key() };
};
