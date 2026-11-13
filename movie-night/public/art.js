/* Movie Night - hand-drawn (in code) cartoon versions of the three of us.
 * Everything is SVG so it stays crisp at any size and can be animated with CSS.
 *
 *   Art.him({ face })   Art.her({ face })   Art.dog({ face })
 *   faces: smile | laugh | love | cry | shock | wink | sleepy
 *   Art.scene(name)     cinema | space | horror | heroes | romance | pirates
 *   Art.reaction(key)   love | laugh | cry | shock | kiss
 */
'use strict';
(function () {
  const C = {
    himSkin: '#7a4a33', himSkinShade: '#5e3826', himHair: '#1f1612', himBeard: '#2a1c14',
    herSkin: '#f9e1d2', herSkinShade: '#efc9b6', herHair: '#9a432b', herHairDark: '#7d3220', lips: '#c9343c',
    dog: '#f4e6cf', dogShade: '#e7cfa9', dogMuzzle: '#fffaf1', dogNose: '#6e4a46', jacket: '#bfbecb', jacketDark: '#a3a2b2',
    cream: '#f6eedf', creamDark: '#e4d6bd', ink: '#2b1d17', blush: '#f2a0a0', bow: '#e7a9a0', bowDark: '#cf8a80',
    white: '#ffffff', tear: '#8fd0ff', heart: '#e5484d',
  };

  // ---- Faces ------------------------------------------------------------------
  function eyes(face, lx, rx, y, s = 1, lashes = false) {
    const ink = C.ink;
    const lash = (x, dir) => lashes
      ? `<path d="M${x + dir * 5 * s} ${y - 4 * s} q${dir * 4 * s} -3 ${dir * 7 * s} -1" stroke="${ink}" stroke-width="${1.8 * s}" fill="none" stroke-linecap="round"/>` : '';
    switch (face) {
      case 'laugh':
        return [lx, rx].map((x) => `<path d="M${x - 6 * s} ${y + 2 * s} q${6 * s} -9 ${12 * s} 0" stroke="${ink}" stroke-width="${2.6 * s}" fill="none" stroke-linecap="round"/>`).join('');
      case 'love':
        return [lx, rx].map((x) => heart(x, y, 7.5 * s, C.heart)).join('');
      case 'cry':
        return [lx, rx].map((x) => `<path d="M${x - 6 * s} ${y} q${6 * s} 6 ${12 * s} 0" stroke="${ink}" stroke-width="${2.6 * s}" fill="none" stroke-linecap="round"/>` +
          `<path d="M${x - 2 * s} ${y + 4 * s} q-3 ${10 * s} 0 ${14 * s} q3 -${4 * s} 0 -${14 * s}z" fill="${C.tear}" class="tear"/>`).join('');
      case 'shock':
        return [lx, rx].map((x) => `<circle cx="${x}" cy="${y}" r="${6.5 * s}" fill="${C.white}" stroke="${ink}" stroke-width="${2 * s}"/><circle cx="${x}" cy="${y}" r="${2.8 * s}" fill="${ink}"/>`).join('');
      case 'wink':
        return `<g class="blink"><ellipse cx="${lx}" cy="${y}" rx="${4.2 * s}" ry="${5.2 * s}" fill="${ink}"/><circle cx="${lx + 1.5 * s}" cy="${y - 2 * s}" r="${1.5 * s}" fill="#fff"/></g>${lash(lx, -1)}` +
          `<path d="M${rx - 6 * s} ${y + 1 * s} q${6 * s} -7 ${12 * s} 0" stroke="${ink}" stroke-width="${2.6 * s}" fill="none" stroke-linecap="round"/>`;
      case 'sleepy':
        return [lx, rx].map((x) => `<path d="M${x - 6 * s} ${y} h${12 * s}" stroke="${ink}" stroke-width="${2.6 * s}" stroke-linecap="round"/>`).join('');
      default:
        return [[lx, -1], [rx, 1]].map(([x, d]) =>
          `<g class="blink"><ellipse cx="${x}" cy="${y}" rx="${4.2 * s}" ry="${5.2 * s}" fill="${ink}"/><circle cx="${x + 1.5 * s}" cy="${y - 2 * s}" r="${1.5 * s}" fill="#fff"/></g>${lash(x, d)}`).join('');
    }
  }

  function mouth(face, x, y, s = 1, lip = C.ink) {
    switch (face) {
      case 'laugh': return `<path d="M${x - 9 * s} ${y - 2 * s} q${9 * s} ${16 * s} ${18 * s} 0 z" fill="#7a2730"/><path d="M${x - 6 * s} ${y + 5 * s} q${6 * s} 4 ${12 * s} 0" fill="#e86f78"/>`;
      case 'cry': return `<path d="M${x - 7 * s} ${y + 4 * s} q${7 * s} -8 ${14 * s} 0" stroke="${lip}" stroke-width="${2.6 * s}" fill="none" stroke-linecap="round"/>`;
      case 'shock': return `<ellipse cx="${x}" cy="${y + 2 * s}" rx="${4.5 * s}" ry="${6 * s}" fill="#7a2730"/>`;
      case 'love': return `<path d="M${x - 8 * s} ${y} q${8 * s} ${9 * s} ${16 * s} 0" stroke="${lip}" stroke-width="${2.8 * s}" fill="none" stroke-linecap="round"/>`;
      case 'sleepy': return `<ellipse cx="${x}" cy="${y + 1 * s}" rx="${3 * s}" ry="${2.4 * s}" fill="${lip}"/>`;
      default: return `<path d="M${x - 7 * s} ${y} q${7 * s} ${7 * s} ${14 * s} 0" stroke="${lip}" stroke-width="${2.6 * s}" fill="none" stroke-linecap="round"/>`;
    }
  }

  function heart(x, y, r, fill, extra = '') {
    return `<path ${extra} d="M${x} ${y + r * 0.9} C ${x - r * 1.6} ${y - r * 0.2}, ${x - r * 0.9} ${y - r * 1.3}, ${x} ${y - r * 0.45} C ${x + r * 0.9} ${y - r * 1.3}, ${x + r * 1.6} ${y - r * 0.2}, ${x} ${y + r * 0.9} z" fill="${fill}"/>`;
  }

  function bow(x, y, s = 1, fill = C.bow, dark = C.bowDark) {
    return `<g transform="translate(${x} ${y}) scale(${s})">
      <path d="M0 0 C -10 -12, -24 -8, -22 2 C -20 12, -8 8, 0 0 z" fill="${fill}" stroke="${dark}" stroke-width="1.5"/>
      <path d="M0 0 C 10 -12, 24 -8, 22 2 C 20 12, 8 8, 0 0 z" fill="${fill}" stroke="${dark}" stroke-width="1.5"/>
      <path d="M-2 2 L -9 16 L -4 14 L -2 18 Z M2 2 L 9 16 L 4 14 L 2 18 Z" fill="${fill}" stroke="${dark}" stroke-width="1.2"/>
      <circle cx="0" cy="0" r="4" fill="${dark}"/></g>`;
  }

  const cheeks = (lx, rx, y, s = 1) =>
    `<ellipse cx="${lx}" cy="${y}" rx="${6 * s}" ry="${3.6 * s}" fill="${C.blush}" opacity=".55"/><ellipse cx="${rx}" cy="${y}" rx="${6 * s}" ry="${3.6 * s}" fill="${C.blush}" opacity=".55"/>`;

  // ---- Characters (drawn in a 120 x 160 box, head centred at 60,54) -------------
  function him({ face = 'smile', body = true, outfit = C.cream, outfitDark = C.creamDark } = {}) {
    return `<g class="him">
      ${body ? `<path d="M18 160 Q20 110 60 104 Q100 110 102 160 Z" fill="${outfit}" stroke="${outfitDark}" stroke-width="2"/>
        <path d="M60 106 V160" stroke="${outfitDark}" stroke-width="2"/><path d="M44 108 L60 124 L76 108" fill="none" stroke="${outfitDark}" stroke-width="2"/>
        <rect x="51" y="88" width="18" height="20" rx="6" fill="${C.himSkinShade}"/>` : ''}
      <circle cx="21" cy="58" r="8" fill="${C.himSkin}"/><circle cx="99" cy="58" r="8" fill="${C.himSkin}"/>
      <ellipse cx="60" cy="54" rx="38" ry="41" fill="${C.himSkin}"/>
      <path d="M23 46 Q22 12 60 12 Q98 12 97 46 Q94 30 82 27 Q60 22 38 27 Q26 30 23 46 Z" fill="${C.himHair}"/>
      <path d="M24 56 Q24 90 60 96 Q96 90 96 56 Q92 76 80 80 Q70 84 60 84 Q50 84 40 80 Q28 76 24 56 Z" fill="${C.himBeard}"/>
      <path d="M45 69 Q60 63 75 69 Q68 72 60 70 Q52 72 45 69 Z" fill="${C.himBeard}"/>
      <path d="M38 40 q8 -4 15 -1 M67 39 q7 -3 15 1" stroke="${C.himHair}" stroke-width="3.5" fill="none" stroke-linecap="round"/>
      ${eyes(face, 45, 75, 50)}
      ${cheeks(36, 84, 62)}
      ${mouth(face, 60, 75, 1, '#f1c9b8')}
    </g>`;
  }

  function her({ face = 'smile', body = true, outfit = C.cream, outfitDark = C.creamDark, bowOn = true } = {}) {
    return `<g class="her">
      <path d="M17 52 Q10 118 20 158 L100 158 Q110 118 103 52 Q100 8 60 8 Q20 8 17 52 Z" fill="${C.herHair}"/>
      ${body ? `<path d="M22 160 Q24 112 60 106 Q96 112 98 160 Z" fill="${outfit}" stroke="${outfitDark}" stroke-width="2"/>
        <path d="M30 128 Q60 140 90 128" stroke="${outfitDark}" stroke-width="2" fill="none"/>
        <rect x="52" y="88" width="16" height="20" rx="6" fill="${C.herSkinShade}"/>
        <path d="M20 100 Q14 132 26 158 L36 158 Q28 128 34 104 Z M100 100 Q106 132 94 158 L84 158 Q92 128 86 104 Z" fill="${C.herHair}"/>` : ''}
      <ellipse cx="60" cy="56" rx="35" ry="38" fill="${C.herSkin}"/>
      <path d="M24 60 Q20 14 62 12 Q100 14 98 58 Q94 36 78 28 Q66 40 40 44 Q30 48 24 60 Z" fill="${C.herHair}"/>
      <path d="M78 28 Q86 40 96 44" stroke="${C.herHairDark}" stroke-width="2" fill="none"/>
      <path d="M38 44 q7 -4 14 -1 M68 43 q7 -3 14 1" stroke="${C.herHairDark}" stroke-width="2.5" fill="none" stroke-linecap="round"/>
      ${eyes(face, 45, 75, 55, 1, true)}
      ${cheeks(35, 85, 67)}
      ${mouth(face, 60, 77, 1, C.lips)}
      ${face === 'smile' || face === 'wink' ? `<path d="M53 77 q7 6 14 0 q-7 2 -14 0z" fill="${C.lips}"/>` : ''}
      ${bowOn ? bow(88, 20, 0.85) : ''}
    </g>`;
  }

  // Front-facing pup (100 x 110 box).
  function dog({ face = 'smile', jacket = true } = {}) {
    return `<g class="dog">
      <path class="tail" d="M74 82 C 96 74, 100 52, 86 48 C 78 46, 80 58, 88 58" stroke="${C.dog}" stroke-width="9" fill="none" stroke-linecap="round"/>
      <ellipse cx="50" cy="84" rx="26" ry="22" fill="${C.dog}"/>
      ${jacket ? `<path d="M26 80 Q30 64 50 64 Q70 64 74 80 Q72 96 50 98 Q28 96 26 80 Z" fill="${C.jacket}" stroke="${C.jacketDark}" stroke-width="1.5"/>
        <path d="M34 72 L66 92 M40 66 L72 86 M28 84 L58 98 M66 70 L36 94 M74 82 L50 98 M58 66 L30 86" stroke="${C.jacketDark}" stroke-width="1" opacity=".7"/>
        <path d="M36 66 Q50 74 64 66" stroke="#2b2b33" stroke-width="3" fill="none"/>` : ''}
      <rect x="35" y="94" width="10" height="14" rx="5" fill="${C.dogMuzzle}"/><rect x="55" y="94" width="10" height="14" rx="5" fill="${C.dogMuzzle}"/>
      <path class="ear" d="M30 30 C 12 18, 4 34, 14 48 C 20 54, 28 44, 30 36 Z" fill="${C.dogShade}"/>
      <path class="ear" d="M70 30 C 88 18, 96 34, 86 48 C 80 54, 72 44, 70 36 Z" fill="${C.dogShade}"/>
      <ellipse cx="50" cy="40" rx="26" ry="24" fill="${C.dog}"/>
      <ellipse cx="50" cy="52" rx="14" ry="10" fill="${C.dogMuzzle}"/>
      <ellipse cx="50" cy="46" rx="5.5" ry="4" fill="${C.dogNose}"/>
      ${eyes(face, 40, 60, 37, 0.85)}
      ${face === 'laugh' || face === 'shock' ? mouth(face, 50, 54, 0.6) : `<path d="M44 54 q6 5 12 0" stroke="${C.ink}" stroke-width="1.8" fill="none" stroke-linecap="round"/>`}
      ${face === 'smile' || face === 'love' ? `<path d="M48 56 q2 7 4 0 z" fill="#ef8a95"/>` : ''}
    </g>`;
  }

  const place = (svg, x, y, s = 1, cls = '') => `<g transform="translate(${x} ${y}) scale(${s})"><g class="${cls}">${svg}</g></g>`;

  // ---- Props -----------------------------------------------------------------------
  function popcorn(x, y, s = 1) {
    const kernels = [[10, -4], [22, -8], [34, -3], [16, -14], [28, -16], [40, -10]]
      .map(([kx, ky], i) => `<circle class="pop pop${i % 3}" cx="${kx}" cy="${ky}" r="6" fill="#fff8e6" stroke="#eadbb8"/>`).join('');
    return `<g transform="translate(${x} ${y}) scale(${s})">${kernels}
      <path d="M2 0 L46 0 L40 44 L8 44 Z" fill="#fff"/>
      <path d="M2 0 L10 0 L13 44 L8 44 Z M19 0 L27 0 L26 44 L20 44 Z M36 0 L44 0 L39 44 L34 44 Z" fill="#e5484d"/></g>`;
  }
  const star = (x, y, r, cls = 'twinkle') =>
    `<path class="${cls}" d="M${x} ${y - r} L${x + r * .3} ${y - r * .3} L${x + r} ${y} L${x + r * .3} ${y + r * .3} L${x} ${y + r} L${x - r * .3} ${y + r * .3} L${x - r} ${y} L${x - r * .3} ${y - r * .3}Z" fill="#fff6c9"/>`;
  const helmet = (cx, cy, r) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="#cfefff" opacity=".28" stroke="#ffffff" stroke-width="3"/><path d="M${cx - r * .6} ${cy - r * .5} q${r * .3} -${r * .3} ${r * .6} -${r * .35}" stroke="#fff" stroke-width="4" fill="none" stroke-linecap="round" opacity=".8"/>`;

  // ---- Scenes (360 x 240) -------------------------------------------------------
  const SCENES = {
    cinema: { title: 'Popcorn date', bg: '#3a2430', svg: () => `
      <rect width="360" height="240" fill="#3a2430"/>
      <path d="M0 0 H360 V34 Q300 54 240 34 Q180 54 120 34 Q60 54 0 34Z" fill="#a8323e"/>
      <rect x="40" y="14" width="280" height="6" rx="3" fill="#f3d27a" opacity=".5"/>
      <rect x="0" y="186" width="360" height="54" fill="#6e2b36"/>
      ${place(him({ face: 'laugh' }), 60, 48, 0.95)}
      ${place(her({ face: 'smile' }), 182, 50, 0.95)}
      ${popcorn(156, 146, 0.9)}
      ${place(dog({ face: 'laugh' }), 278, 132, 0.62, 'bob')}
      <rect x="0" y="200" width="360" height="40" fill="#8a3442"/>
      <path d="M20 200 q30 -16 60 0 M110 200 q30 -16 60 0 M200 200 q30 -16 60 0 M290 200 q30 -16 60 0" fill="#a13d4c"/>` },

    space: { title: 'Lost in space', bg: '#1d2140', svg: () => `
      <rect width="360" height="240" fill="#1d2140"/>
      ${[[30, 30, 4], [320, 40, 5], [200, 22, 3], [90, 200, 4], [300, 190, 3], [160, 120, 2.5], [340, 120, 3]].map(([x, y, r], i) => star(x, y, r, `twinkle t${i % 3}`)).join('')}
      <circle cx="300" cy="200" r="46" fill="#e7a9a0"/><ellipse cx="300" cy="200" rx="70" ry="12" fill="none" stroke="#f3d27a" stroke-width="5" transform="rotate(-15 300 200)"/>
      <g class="float">${place(him({ face: 'shock' }), 34, 30, 0.85)}${helmet(85, 76, 46)}</g>
      <g class="float f2">${place(her({ face: 'love' }), 160, 46, 0.85)}${helmet(211, 94, 46)}</g>
      <g class="float f3">${place(dog({ face: 'smile' }), 262, 34, 0.7)}${helmet(297, 64, 34)}</g>` },

    horror: { title: 'Scary movie night', bg: '#2c2a36', svg: () => `
      <rect width="360" height="240" fill="#2c2a36"/>
      <circle cx="300" cy="44" r="22" fill="#f3ead2"/><circle cx="292" cy="40" r="22" fill="#2c2a36"/>
      <g class="spook"><path d="M40 70 Q40 30 70 30 Q100 30 100 70 L100 104 L90 96 L80 104 L70 96 L60 104 L50 96 L40 104 Z" fill="#f5f2ff" opacity=".9"/>
        <circle cx="60" cy="64" r="4" fill="#2c2a36"/><circle cx="80" cy="64" r="4" fill="#2c2a36"/><ellipse cx="70" cy="78" rx="4" ry="5" fill="#2c2a36"/></g>
      ${place(him({ face: 'shock', body: false }), 120, 74, 0.8)}
      ${place(her({ face: 'shock', body: false, bowOn: true }), 200, 76, 0.8)}
      <g class="shiver"><path d="M100 150 Q180 120 290 150 L310 240 L80 240 Z" fill="#d9c4a5"/>
        <path d="M110 160 Q180 136 280 160" stroke="#c4ab86" stroke-width="3" fill="none"/>
        <path d="M120 190 l14 14 M150 180 l14 14 M200 186 l14 14 M240 178 l14 14" stroke="#e7a9a0" stroke-width="5" stroke-linecap="round"/></g>
      ${place(dog({ face: 'shock', jacket: true }), 262, 150, 0.6)}` },

    heroes: { title: 'Superhero duo', bg: '#2f5d8a', svg: () => `
      <rect width="360" height="240" fill="#7fb2d8"/>
      ${[[40, 200, 50, 90], [100, 180, 40, 110], [150, 190, 46, 100], [220, 170, 44, 120], [280, 186, 36, 104], [320, 176, 40, 114]].map(([x, y, w, h]) => `<rect x="${x - w / 2}" y="${240 - h}" width="${w}" height="${h}" fill="#5c8fbc"/>`).join('')}
      <path class="cape" d="M48 110 Q30 170 14 214 L110 206 Q100 160 92 110 Z" fill="#e5484d"/>
      <path class="cape c2" d="M168 112 Q150 172 136 214 L232 208 Q222 162 214 112 Z" fill="#e7a9a0"/>
      ${place(him({ face: 'smile', outfit: '#3b5ba5', outfitDark: '#2c4682' }), 10, 46, 0.85)}
      ${place(her({ face: 'wink', outfit: '#f3d27a', outfitDark: '#d8b558' }), 140, 48, 0.85)}
      <path class="cape c3" d="M262 168 Q250 200 244 224 L300 222 Q296 196 290 168 Z" fill="#f3d27a"/>
      ${place(dog({ face: 'smile' }), 236, 120, 0.72)}
      <text x="330" y="40" font-size="28" text-anchor="middle" fill="#fff" font-weight="900" class="pow">★</text>` },

    romance: { title: 'Under the stars', bg: '#33264a', svg: () => `
      <rect width="360" height="240" fill="#33264a"/>
      <circle cx="290" cy="56" r="30" fill="#fff4d6"/>
      ${[[40, 30], [120, 20], [200, 46], [330, 120], [20, 120]].map(([x, y], i) => star(x, y, 3, `twinkle t${i % 3}`)).join('')}
      ${[0, 1, 2, 3].map((i) => heart(150 + i * 22, 70, 7, '#e7a9a0', `class="rise r${i}"`)).join('')}
      <rect x="40" y="176" width="280" height="12" rx="4" fill="#8a6a4f"/><rect x="60" y="188" width="8" height="40" fill="#6e533d"/><rect x="292" y="188" width="8" height="40" fill="#6e533d"/>
      ${place(him({ face: 'love' }), 70, 50, 0.85)}
      ${place(her({ face: 'love' }), 168, 52, 0.85)}
      ${place(dog({ face: 'sleepy' }), 258, 140, 0.6)}
      <text x="292" y="148" font-size="14" fill="#fff" opacity=".8" class="zzz">z z</text>` },

    pirates: { title: 'Pirates of the sofa', bg: '#2b6f8f', svg: () => `
      <rect width="360" height="240" fill="#9ad6ea"/>
      <circle cx="320" cy="40" r="20" fill="#fff1b8"/>
      <g class="rock">
        <path d="M30 170 L330 170 L300 220 L60 220 Z" fill="#8a5a3c"/><rect x="176" y="40" width="6" height="130" fill="#6e4430"/>
        <path d="M182 50 L250 110 L182 120 Z" fill="#f6eedf"/>
        ${place(him({ face: 'laugh', outfit: '#f6eedf' }), 60, 46, 0.8)}
        <path d="M58 52 Q108 20 160 52 Z" fill="#2b1d17"/><circle cx="109" cy="40" r="5" fill="#fff"/>
        ${place(her({ face: 'smile', outfit: '#f6eedf' }), 196, 60, 0.75)}
        ${place(dog({ face: 'smile' }), 136, 120, 0.55)}
      </g>
      <path class="wave" d="M0 210 q20 -12 40 0 t40 0 t40 0 t40 0 t40 0 t40 0 t40 0 t40 0 t40 0 V240 H0Z" fill="#4aa3c7"/>` },
  };

  function scene(name) {
    const sc = SCENES[name];
    return `<svg class="scene scene-${name}" viewBox="0 0 360 240" role="img" aria-label="${sc.title}" preserveAspectRatio="xMidYMid slice">${sc.svg()}</svg>`;
  }

  // ---- Reactions (square faces) ----------------------------------------------------
  const REACTIONS = {
    love: { label: 'Heart eyes', svg: () => place(her({ face: 'love', body: false }), 0, 0, 1) },
    laugh: { label: 'Laughing', svg: () => place(him({ face: 'laugh', body: false }), 0, 4, 1) },
    cry: { label: 'Crying', svg: () => place(him({ face: 'cry', body: false }), -18, 18, 0.72) + place(her({ face: 'cry', body: false, bowOn: true }), 46, 16, 0.72) },
    shock: { label: 'Shocked pup', svg: () => place(dog({ face: 'shock', jacket: false }), 4, 4, 1.12) },
    kiss: { label: 'Kiss', svg: () => place(him({ face: 'sleepy', body: false }), -16, 22, 0.7) + place(her({ face: 'sleepy', body: false }), 50, 20, 0.7) + heart(60, 24, 13, C.heart, 'class="beat"') },
  };
  function reaction(key) {
    const r = REACTIONS[key] || REACTIONS.love;
    return `<svg class="reaction-face" viewBox="0 0 120 112" role="img" aria-label="${r.label}">${r.svg()}</svg>`;
  }

  function couple(face = 'smile') {
    return `<svg class="couple" viewBox="0 0 300 180" role="img" aria-label="Us">${place(him({ face }), 30, 18, 1)}${place(her({ face: face === 'smile' ? 'wink' : face }), 140, 20, 1)}${place(dog({ face: 'smile' }), 108, 100, 0.72, 'bob')}</svg>`;
  }

  function fetchingPup() {
    return `<svg class="fetch-pup" viewBox="0 0 160 110" role="img" aria-label="Fetching the movie">
      <g class="run">${place(dog({ face: 'smile' }), 30, 0, 1)}</g>
      <g class="film"><circle cx="124" cy="56" r="20" fill="#2b1d17"/><circle cx="124" cy="56" r="5" fill="#f6eedf"/>${[0, 1, 2, 3, 4].map((i) => { const a = (i / 5) * Math.PI * 2; return `<circle cx="${(124 + Math.cos(a) * 11).toFixed(1)}" cy="${(56 + Math.sin(a) * 11).toFixed(1)}" r="4.2" fill="#f6eedf"/>`; }).join('')}<path d="M124 76 q10 14 30 12" stroke="#2b1d17" stroke-width="5" fill="none" stroke-linecap="round"/></g>
    </svg>`;
  }

  /** Little round avatar: 'him' | 'her' | 'dog' */
  function head(who, face = 'smile') {
    const g = who === 'her' ? place(her({ face, body: false }), 0, 0, 1)
      : who === 'dog' ? place(dog({ face, jacket: false }), 10, 4, 1.05) : place(him({ face, body: false }), 0, 6, 1);
    return `<svg viewBox="0 0 120 112" aria-hidden="true">${g}</svg>`;
  }
  const bowSvg = () => `<svg viewBox="-26 -14 52 34" aria-hidden="true">${bow(0, 0, 1)}</svg>`;

  window.Art = { head, bowSvg, him, her, dog, scene, reaction, couple, fetchingPup, bow, heart, SCENES: Object.keys(SCENES), REACTIONS: Object.keys(REACTIONS) };
})();
