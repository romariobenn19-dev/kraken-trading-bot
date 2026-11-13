/* Movie Night - recognise series episodes from titles (shared by the server and the player).
 *   "Frieren - Beyond Journey's End - S01E14"   -> Frieren - Beyond Journey's End, S1 E14
 *   "Naruto Shippuden Episode 166 Confessions"  -> Naruto Shippuden, E166 "Confessions"
 *   "[Group] Spy x Family - 07 [1080p]"          -> Spy x Family, E7
 *   "Show 2x05"                                  -> Show, S2 E5
 */
(function (root) {
  'use strict';

  function clean(s) {
    return String(s || '').replace(/\[[^\]]*\]|\([^)]*\)/g, ' ').replace(/[._]+/g, ' ').replace(/\s+/g, ' ').trim();
  }
  const tidy = (s) => clean(s).replace(/[\s\-–—:]+$/, '').replace(/^[\s\-–—:]+/, '').trim();

  /** Returns { show, key, season, episode, name } or null if it's not an episode. */
  function parse(title) {
    const t = clean(title);
    let m = t.match(/^(.*?)[\s\-–—]*\bS(\d{1,2})\s*E(\d{1,4})\b(.*)$/i)
      || t.match(/^(.*?)[\s\-–—]*\b(\d{1,2})x(\d{1,3})\b(.*)$/i);
    let show, season, episode, rest;
    if (m) { [, show, season, episode, rest] = m; }
    else if ((m = t.match(/^(.*?)[\s\-–—]*\b(?:Episode|Ep\.?|E)\s*(\d{1,4})\b(.*)$/i))) { [, show, episode, rest] = m; season = 1; }
    else if ((m = t.match(/^(.*?)\s+[-–—]\s+(\d{1,4})(?:v\d)?(?:\s|$)(.*)$/))) { [, show, episode, rest] = m; season = 1; }
    else return null;
    show = tidy(show);
    if (!show || /^(19|20)\d{2}$/.test(String(episode))) return null; // "Movie 2024" is a year, not an episode
    // "Show Season 2" -> show "Show", season 2
    const sm = show.match(/^(.*?)\s+(?:Season|S)\s*(\d{1,2})$/i);
    if (sm) { show = tidy(sm[1]); season = Number(sm[2]); }
    return {
      show,
      key: show.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''),
      season: Number(season) || 1,
      episode: Number(episode),
      name: tidy(rest || ''),
    };
  }

  /** Group library movies into { series: [{key, show, episodes:[movie+ep]}], movies: [...] }. */
  function group(movies) {
    const series = new Map();
    const singles = [];
    for (const mv of movies) {
      const ep = parse(mv.title);
      if (!ep) { singles.push(mv); continue; }
      if (!series.has(ep.key)) series.set(ep.key, { key: ep.key, show: ep.show, episodes: [] });
      series.get(ep.key).episodes.push({ ...mv, ep });
    }
    for (const s of series.values()) s.episodes.sort((a, b) => a.ep.season - b.ep.season || a.ep.episode - b.ep.episode);
    return { series: [...series.values()], movies: singles };
  }

  /** The episode after this one in the library (same show), or null. */
  function next(movies, movieId) {
    const { series } = group(movies);
    for (const s of series) {
      const i = s.episodes.findIndex((e) => e.id === movieId);
      if (i >= 0) return s.episodes[i + 1] || null;
    }
    return null;
  }

  const api = { parse, group, next };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Series = api;
})(typeof window !== 'undefined' ? window : globalThis);
