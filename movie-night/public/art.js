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

  // ---- Illustrated style ----------------------------------------------------------
  // Soft light from the upper left, warm skin highlights, glossy eyes with coloured irises,
  // and a pink-lilac glow along the edges. Gradients get unique ids (many drawings share a page).
  let uid = 0;
  const nid = (p) => `${p}${(++uid).toString(36)}`;
  /** A soft glow for the rim light (blurred, so it reads as light, not a line). */
  const glowDef = (id) => `<filter id="${id}" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="1.6"/></filter>`;
  const radial = (id, stops, cx = '40%', cy = '35%', r = '75%') =>
    `<radialGradient id="${id}" cx="${cx}" cy="${cy}" r="${r}">${stops.map(([o, c, a = 1]) => `<stop offset="${o}" stop-color="${c}" stop-opacity="${a}"/>`).join('')}</radialGradient>`;
  const linear = (id, stops, x2 = 0, y2 = 1) =>
    `<linearGradient id="${id}" x1="0" y1="0" x2="${x2}" y2="${y2}">${stops.map(([o, c, a = 1]) => `<stop offset="${o}" stop-color="${c}" stop-opacity="${a}"/>`).join('')}</linearGradient>`;

  /** A closed wavy outline round an ellipse (curly hair): n bumps from angle a0 to a1 (degrees). */
  function wavy(cx, cy, rx, ry, n, a0, a1, bump = 1.13, close = '') {
    const pt = (deg, k = 1) => { const t = (deg * Math.PI) / 180; return [(cx + Math.cos(t) * rx * k).toFixed(1), (cy + Math.sin(t) * ry * k).toFixed(1)]; };
    let d = `M${pt(a0).join(' ')}`;
    for (let i = 0; i < n; i++) {
      const a = a0 + ((a1 - a0) * i) / n, b = a0 + ((a1 - a0) * (i + 1)) / n;
      const k = bump + (i % 3 === 1 ? 0.05 : i % 3 === 2 ? -0.03 : 0);
      d += ` Q${pt((a + b) / 2, k).join(' ')} ${pt(b).join(' ')}`;
    }
    return d + (close || ' Z');
  }

  // ---- Faces ------------------------------------------------------------------
  /** iris: [light, dark] colours of the eyes (open-eye faces). */
  function eyes(face, lx, rx, y, s = 1, lashes = false, iris = ['#6b4527', '#2a170c']) {
    const ink = C.ink;
    const lash = (x, dir) => lashes
      ? `<path d="M${x + dir * 6.5 * s} ${y - 3.2 * s} q${dir * 3.5 * s} -2.5 ${dir * 6 * s} -1.2 M${x + dir * 5 * s} ${y - 5 * s} q${dir * 2.5 * s} -3 ${dir * 4.5 * s} -3" stroke="${ink}" stroke-width="${1.5 * s}" fill="none" stroke-linecap="round"/>` : '';
    const closed = (x, up) => `<path d="M${x - 7 * s} ${y + (up ? 2 : 0) * s} q${7 * s} ${(up ? -9 : 6) * s} ${14 * s} 0" stroke="${ink}" stroke-width="${2.4 * s}" fill="none" stroke-linecap="round"/>`;
    const id = nid('ir');
    const cols = iris === 'pet' ? ['#5a3a26', '#120a05'] : iris;
    const defs = `<defs>${linear(id, [[0, cols[0]], [1, cols[1]]])}</defs>`;
    // A glossy open eye: almond white, coloured iris, pupil, two sparkles, a strong upper lid.
    const open = (x, dir, big = false) => {
      if (iris === 'pet') {
        return `<g class="blink"><ellipse cx="${x}" cy="${y}" rx="${(big ? 5.4 : 4.6) * s}" ry="${(big ? 6.2 : 5.4) * s}" fill="url(#${id})"/>
          <circle cx="${x + 1.6 * s}" cy="${y - 2 * s}" r="${1.7 * s}" fill="#fff"/><circle cx="${x - 1.5 * s}" cy="${y + 2 * s}" r="${0.8 * s}" fill="#fff" opacity=".8"/></g>`;
      }
      const w = (big ? 8 : 7.2) * s, h = (big ? 7 : 5.6) * s, ir = (big ? 3.4 : 4.4) * s;
      return `<g class="blink">
        <path d="M${x - w} ${y} Q${x} ${y - h * 1.25} ${x + w} ${y} Q${x} ${y + h * 0.95} ${x - w} ${y} Z" fill="#fbf4ef"/>
        <circle cx="${x}" cy="${y + 0.4 * s}" r="${ir}" fill="url(#${id})"/>
        <circle cx="${x}" cy="${y + 0.4 * s}" r="${ir * 0.48}" fill="#140b06"/>
        <path d="M${x - w} ${y} Q${x} ${y - h * 1.25} ${x + w} ${y}" fill="none" stroke="${ink}" stroke-width="${2.3 * s}" stroke-linecap="round"/>
        <path d="M${x - w * 0.8} ${y + h * 0.55} Q${x} ${y + h * 1.05} ${x + w * 0.8} ${y + h * 0.5}" fill="none" stroke="${ink}" stroke-width="${0.7 * s}" opacity=".45"/>
        <circle cx="${x + 1.6 * s}" cy="${y - 1.4 * s}" r="${1.5 * s}" fill="#fff"/>
        <circle cx="${x - 1.7 * s}" cy="${y + 1.9 * s}" r="${0.75 * s}" fill="#fff" opacity=".85"/>
      </g>${lash(x, dir)}`;
    };
    switch (face) {
      case 'laugh':
        return [lx, rx].map((x) => closed(x, true)).join('');
      case 'love':
        return [lx, rx].map((x) => heart(x, y, 7.5 * s, C.heart) + `<circle cx="${x - 2.5 * s}" cy="${y - 2.5 * s}" r="${1.4 * s}" fill="#fff" opacity=".8"/>`).join('');
      case 'cry':
        return [lx, rx].map((x) => closed(x, false) +
          `<path d="M${x - 2 * s} ${y + 4 * s} q-3 ${10 * s} 0 ${14 * s} q3 -${4 * s} 0 -${14 * s}z" fill="${C.tear}" class="tear" opacity=".9"/>`).join('');
      case 'shock':
        return defs + open(lx, -1, true) + open(rx, 1, true);
      case 'wink':
        return defs + open(lx, -1) + `<path d="M${rx - 7 * s} ${y + 1 * s} q${7 * s} -8 ${14 * s} 0" stroke="${ink}" stroke-width="${2.4 * s}" fill="none" stroke-linecap="round"/>` + (lashes ? lash(rx, 1) : '');
      case 'sleepy':
        return [lx, rx].map((x) => `<path d="M${x - 7 * s} ${y} q${7 * s} ${3.5 * s} ${14 * s} 0" stroke="${ink}" stroke-width="${2.3 * s}" fill="none" stroke-linecap="round"/>`).join('');
      default:
        return defs + open(lx, -1) + open(rx, 1);
    }
  }

  /** glossy: full two-tone lips with a highlight (her); otherwise a softer mouth. */
  function mouth(face, x, y, s = 1, lip = C.ink, glossy = false) {
    const id = nid('lp');
    switch (face) {
      case 'laugh':
        return `<path d="M${x - 10 * s} ${y - 2 * s} q${10 * s} ${17 * s} ${20 * s} 0 z" fill="#6e1f2a"/>
          <path d="M${x - 8 * s} ${y - 1.2 * s} q${8 * s} ${2.2 * s} ${16 * s} 0 l-${1 * s} ${2.4 * s} q-${7 * s} ${1.6 * s} -${14 * s} 0 z" fill="#fff"/>
          <path d="M${x - 6 * s} ${y + 6 * s} q${6 * s} 4 ${12 * s} 0" fill="#e86f78"/>
          ${glossy ? `<path d="M${x - 10 * s} ${y - 2 * s} q${10 * s} -${4 * s} ${20 * s} 0" stroke="${lip}" stroke-width="${2.6 * s}" fill="none" stroke-linecap="round"/>` : ''}`;
      case 'cry': return `<path d="M${x - 7 * s} ${y + 4 * s} q${7 * s} -8 ${14 * s} 0" stroke="${glossy ? lip : '#5a2a22'}" stroke-width="${2.6 * s}" fill="none" stroke-linecap="round"/>`;
      case 'shock': return `<ellipse cx="${x}" cy="${y + 2 * s}" rx="${4.5 * s}" ry="${6 * s}" fill="#6e1f2a"/>${glossy ? `<ellipse cx="${x}" cy="${y + 2 * s}" rx="${4.5 * s}" ry="${6 * s}" fill="none" stroke="${lip}" stroke-width="${2 * s}"/>` : ''}`;
      case 'sleepy': return `<ellipse cx="${x}" cy="${y + 1 * s}" rx="${3.2 * s}" ry="${2.5 * s}" fill="${glossy ? lip : '#8a4a3c'}"/>`;
      default:
        if (!glossy) {
          return `<path d="M${x - 8 * s} ${y} q${8 * s} ${8 * s} ${16 * s} 0" stroke="#3a1d16" stroke-width="${2.4 * s}" fill="none" stroke-linecap="round"/>
            <path d="M${x - 5 * s} ${y + 4.5 * s} q${5 * s} ${2.5 * s} ${10 * s} 0" stroke="#a5644e" stroke-width="${2 * s}" fill="none" stroke-linecap="round" opacity=".8"/>`;
        }
        // A smile with full, glossy lips and a hint of teeth.
        return `<defs>${linear(id, [[0, '#e0505c'], [1, lip]])}</defs>
          <path d="M${x - 9 * s} ${y} Q${x - 4 * s} ${y - 3.5 * s} ${x} ${y - 1.6 * s} Q${x + 4 * s} ${y - 3.5 * s} ${x + 9 * s} ${y} Q${x} ${y + 2 * s} ${x - 9 * s} ${y} Z" fill="url(#${id})"/>
          <path d="M${x - 8 * s} ${y + 0.6 * s} Q${x} ${y + 2.4 * s} ${x + 8 * s} ${y + 0.6 * s} L${x + 6.5 * s} ${y + 2.6 * s} Q${x} ${y + 3.8 * s} ${x - 6.5 * s} ${y + 2.6 * s} Z" fill="#fff"/>
          <path d="M${x - 8 * s} ${y + 1 * s} Q${x} ${y + 11 * s} ${x + 8 * s} ${y + 1 * s} Q${x} ${y + 4.5 * s} ${x - 8 * s} ${y + 1 * s} Z" fill="url(#${id})"/>
          <ellipse cx="${x + 1.5 * s}" cy="${y + 5.6 * s}" rx="${3.2 * s}" ry="${1.2 * s}" fill="#fff" opacity=".55"/>`;
    }
  }

  function heart(x, y, r, fill, extra = '') {
    return `<path ${extra} d="M${x} ${y + r * 0.9} C ${x - r * 1.6} ${y - r * 0.2}, ${x - r * 0.9} ${y - r * 1.3}, ${x} ${y - r * 0.45} C ${x + r * 0.9} ${y - r * 1.3}, ${x + r * 1.6} ${y - r * 0.2}, ${x} ${y + r * 0.9} z" fill="${fill}"/>`;
  }

  function bow(x, y, s = 1, fill = C.bow, dark = C.bowDark) {
    const id = nid('bw');
    return `<g transform="translate(${x} ${y}) scale(${s})"><defs>${linear(id, [[0, '#f6c4bc'], [1, fill]])}</defs>
      <path d="M0 0 C -10 -12, -24 -8, -22 2 C -20 12, -8 8, 0 0 z" fill="url(#${id})" stroke="${dark}" stroke-width="1.2"/>
      <path d="M0 0 C 10 -12, 24 -8, 22 2 C 20 12, 8 8, 0 0 z" fill="url(#${id})" stroke="${dark}" stroke-width="1.2"/>
      <path d="M-14 -5 q4 -3 9 0 M14 -5 q-4 -3 -9 0" stroke="#fff" stroke-width="1.4" fill="none" opacity=".6" stroke-linecap="round"/>
      <path d="M-2 2 L -9 16 L -4 14 L -2 18 Z M2 2 L 9 16 L 4 14 L 2 18 Z" fill="url(#${id})" stroke="${dark}" stroke-width="1"/>
      <circle cx="0" cy="0" r="4" fill="${dark}"/><circle cx="-1.2" cy="-1.2" r="1.3" fill="#fff" opacity=".5"/></g>`;
  }

  const cheeks = (lx, rx, y, s = 1) => {
    const id = nid('ck');
    return `<defs>${radial(id, [[0, C.blush, 0.7], [1, C.blush, 0]], '50%', '50%', '50%')}</defs>
      <ellipse cx="${lx}" cy="${y}" rx="${8 * s}" ry="${4.5 * s}" fill="url(#${id})"/><ellipse cx="${rx}" cy="${y}" rx="${8 * s}" ry="${4.5 * s}" fill="url(#${id})"/>`;
  };

  /** Shaded clothes (a soft knit), with a fold shadow and a light edge. */
  function outfitShape(d, outfit, outfitDark, extra = '') {
    const id = nid('of');
    return `<defs>${radial(id, [[0, '#fffaf2'], [0.6, outfit], [1, outfitDark]], '35%', '20%', '95%')}</defs>
      <path d="${d}" fill="url(#${id})" stroke="${outfitDark}" stroke-width="1.4"/>${extra}`;
  }

  // ---- Characters (drawn in a 120 x 160 box, head centred at 60,54) -------------
  function him({ face = 'smile', body = true, outfit = C.cream, outfitDark = C.creamDark } = {}) {
    const sk = nid('sk'), hr = nid('hr'), bd = nid('bd'), rim = nid('rm'), gl = nid('gl');
    return `<g class="him"><defs>${glowDef(gl)}
        ${radial(sk, [[0, '#a8694a'], [0.55, C.himSkin], [1, '#4e2c1d']], '38%', '30%', '80%')}
        ${linear(hr, [[0, '#3a2a24'], [1, '#120c09']])}
        ${linear(bd, [[0, '#2e1f17'], [1, '#160e0a']])}
        ${linear(rim, [[0, '#ffb3c7', 0], [1, '#ffb3c7', 0.85]], 1, 0)}
      </defs>
      ${body ? outfitShape('M18 160 Q20 110 60 104 Q100 110 102 160 Z', outfit, outfitDark,
        `<path d="M60 106 V160" stroke="${outfitDark}" stroke-width="1.6"/><path d="M44 108 L60 124 L76 108" fill="none" stroke="${outfitDark}" stroke-width="1.6"/>
        <path d="M30 150 Q34 128 46 118" stroke="#fff" stroke-width="2" fill="none" opacity=".5"/>
        <rect x="51" y="86" width="18" height="22" rx="6" fill="${C.himSkinShade}"/><path d="M51 96 Q60 104 69 96 V108 H51 Z" fill="#3a2016" opacity=".5"/>`) : ''}
      <ellipse cx="21" cy="58" rx="7.5" ry="9" fill="url(#${sk})"/><ellipse cx="99" cy="58" rx="7.5" ry="9" fill="url(#${sk})"/>
      <path d="M19 55 q3 4 1 8 M101 55 q-3 4 -1 8" stroke="#4e2c1d" stroke-width="1.4" fill="none" opacity=".7"/>
      <ellipse cx="60" cy="54" rx="38" ry="41" fill="url(#${sk})" stroke="#4a2a1b" stroke-width="1"/>
      <path d="M96 40 Q100 62 88 84" stroke="url(#${rim})" stroke-width="4" fill="none" stroke-linecap="round" filter="url(#${gl})"/>
      <path d="M23 46 Q22 12 60 12 Q98 12 97 46 Q94 30 82 27 Q60 22 38 27 Q26 30 23 46 Z" fill="url(#${hr})"/>
      <path d="M30 30 Q44 18 64 18 M38 24 Q56 15 80 20 M72 17 Q88 20 94 32" stroke="#6b5a52" stroke-width="1.6" fill="none" opacity=".55" stroke-linecap="round"/>
      <path d="M26 44 Q30 32 40 28" stroke="#c9a2ff" stroke-width="3" fill="none" opacity=".5" stroke-linecap="round" filter="url(#${gl})"/>
      <path d="M24 56 Q24 90 60 96 Q96 90 96 56 Q92 76 80 80 Q70 84 60 84 Q50 84 40 80 Q28 76 24 56 Z" fill="url(#${bd})"/>
      <path d="M45 69 Q60 63 75 69 Q68 72 60 70 Q52 72 45 69 Z" fill="url(#${bd})"/>
      <path d="M32 80 l2 4 M40 86 l1 4 M50 89 l1 4 M70 89 l-1 4 M80 86 l-1 4 M88 80 l-2 4 M46 66 l3 -1 M71 65 l3 1" stroke="#4a3a32" stroke-width="1" opacity=".6" stroke-linecap="round"/>
      <path d="M38 40 q8 -4 15 -1 M67 39 q7 -3 15 1" stroke="#140c08" stroke-width="3.6" fill="none" stroke-linecap="round"/>
      <path d="M56 54 Q53 62 55 64 Q60 67 65 64 Q67 62 64 54" fill="none" stroke="#4e2c1d" stroke-width="1.3" opacity=".75" stroke-linecap="round"/>
      <ellipse cx="61" cy="61" rx="2.2" ry="1.3" fill="#d39a78" opacity=".6"/>
      <ellipse cx="44" cy="35" rx="9" ry="3" fill="#fff" opacity=".1"/>
      ${eyes(face, 45, 75, 50, 1.15, false, ['#7a4f2c', '#2a170c'])}
      ${cheeks(34, 86, 62, 0.9)}
      ${mouth(face, 60, 75, 1, '#f1c9b8')}
    </g>`;
  }

  function her({ face = 'smile', body = true, outfit = C.cream, outfitDark = C.creamDark, bowOn = true } = {}) {
    const sk = nid('sk'), hr = nid('hr'), hl = nid('hl'), rim = nid('rm'), gl = nid('gl');
    // Flowing curly hair: a wavy mass, strands with light running through them, loose curls, swept bangs.
    const strand = (d, light) => `<path d="${d}" stroke="${light ? '#ec9468' : C.herHairDark}" stroke-width="${light ? 1.6 : 1.3}" fill="none" opacity="${light ? 0.8 : 0.55}" stroke-linecap="round"/>`;
    const tendril = (x, y, dir, len) => `<path d="M${x} ${y} q${dir * 6} ${len * 0.3} 0 ${len * 0.55} q${-dir * 6} ${len * 0.25} 0 ${len * 0.45}" stroke="url(#${hr})" stroke-width="5" fill="none" stroke-linecap="round"/>
      <path d="M${x} ${y} q${dir * 6} ${len * 0.3} 0 ${len * 0.55}" stroke="#ec9468" stroke-width="1.2" fill="none" opacity=".7" stroke-linecap="round"/>`;
    return `<g class="her"><defs>${glowDef(gl)}
        ${radial(sk, [[0, '#fff3ea'], [0.55, C.herSkin], [1, '#e2b29b']], '40%', '32%', '80%')}
        ${radial(hr, [[0, '#d26a42'], [0.6, C.herHair], [1, '#6a2817']], '38%', '28%', '80%')}
        ${linear(hl, [[0, '#d97a50'], [1, C.herHairDark]])}
        ${linear(rim, [[0, '#c9a2ff', 0], [1, '#c9a2ff', 0.9]], 1, 0)}
      </defs>
      <path d="${body ? wavy(60, 82, 50, 80, 17, 128, 412, 1.09) : wavy(60, 66, 50, 64, 15, 150, 390, 1.1)}" fill="url(#${hr})"/>
      ${strand('M30 30 Q14 70 22 120', true)}${strand('M90 30 Q106 70 98 120', true)}
      ${strand('M24 44 Q12 88 26 140')}${strand('M96 44 Q108 88 94 140')}
      ${strand('M40 18 Q20 40 18 76', true)}${strand('M80 18 Q100 40 102 76')}
      ${body ? outfitShape('M22 160 Q24 112 60 106 Q96 112 98 160 Z', outfit, outfitDark,
        `<path d="M30 128 Q60 140 90 128" stroke="${outfitDark}" stroke-width="1.6" fill="none"/>
        <path d="M32 152 Q36 130 48 120" stroke="#fff" stroke-width="2" fill="none" opacity=".5"/>
        <rect x="52" y="86" width="16" height="22" rx="6" fill="${C.herSkinShade}"/><path d="M52 95 Q60 103 68 95 V108 H52 Z" fill="#c98f78" opacity=".55"/>
        <path d="M20 104 Q14 132 22 158 L34 158 Q28 130 32 106 Z M100 104 Q106 132 98 158 L86 158 Q92 130 88 106 Z" fill="url(#${hr})"/>
        ${strand('M24 106 Q19 130 26 156', true)}${strand('M96 106 Q101 130 94 156', true)}`) : ''}
      <ellipse cx="60" cy="56" rx="35" ry="38" fill="url(#${sk})" stroke="#d9a58c" stroke-width="1"/>
      <path d="M93 46 Q97 66 86 86" stroke="url(#${rim})" stroke-width="4" fill="none" stroke-linecap="round" filter="url(#${gl})"/>
      <path d="M30 50 Q40 44 54 42" stroke="#b9715a" stroke-width="6" fill="none" opacity=".16" stroke-linecap="round"/>
      <path d="M22 58 Q18 22 60 12 Q102 16 99 54 Q95 40 88 36 Q86 44 78 42 Q74 33 66 34 Q60 41 52 36 Q46 31 40 38 Q34 46 28 44 Q24 50 22 58 Z" fill="url(#${hl})"/>
      ${strand('M30 40 Q42 18 66 16', true)}${strand('M58 18 Q82 18 94 36', true)}${strand('M44 36 Q54 24 72 22')}${strand('M76 26 Q86 30 90 40')}
      <path d="M102 26 Q112 50 104 76" stroke="#c9a2ff" stroke-width="4" fill="none" opacity=".6" stroke-linecap="round" filter="url(#${gl})"/>
      <path d="M38 45 q7 -4 14 -1 M68 44 q7 -3 14 1" stroke="${C.herHairDark}" stroke-width="2.3" fill="none" stroke-linecap="round"/>
      <path d="M58 58 Q56 65 58 67 Q61 69 64 67" fill="none" stroke="#c98f78" stroke-width="1.2" stroke-linecap="round"/>
      <ellipse cx="61" cy="64.5" rx="1.6" ry="1" fill="#fff" opacity=".7"/>
      <ellipse cx="74" cy="47" rx="7" ry="2.2" fill="#fff" opacity=".22"/>
      ${eyes(face, 45, 75, 55, 1, true, ['#9bb86a', '#3e5a2a'])}
      ${cheeks(34, 86, 68)}
      ${mouth(face, 60, 78, 1.2, C.lips, true)}
      ${bowOn ? bow(88, 20, 0.85) : ''}
    </g>`;
  }

  // Front-facing pup (100 x 110 box).
  function dog({ face = 'smile', jacket = true } = {}) {
    const fur = nid('fu'), ear = nid('ea'), jk = nid('jk'), gl = nid('gl');
    return `<g class="dog"><defs>${glowDef(gl)}
        ${radial(fur, [[0, '#fffaf0'], [0.6, C.dog], [1, '#d9c09a']], '40%', '30%', '80%')}
        ${linear(ear, [[0, '#e9cfa6'], [1, '#c9a67a']])}
        ${radial(jk, [[0, '#d9d8e4'], [1, C.jacketDark]], '40%', '30%', '80%')}
      </defs>
      <path class="tail" d="M74 82 C 96 74, 100 52, 86 48 C 78 46, 80 58, 88 58" stroke="${C.dog}" stroke-width="9" fill="none" stroke-linecap="round"/>
      <ellipse cx="50" cy="84" rx="26" ry="22" fill="url(#${fur})"/>
      ${jacket ? `<path d="M26 80 Q30 64 50 64 Q70 64 74 80 Q72 96 50 98 Q28 96 26 80 Z" fill="url(#${jk})" stroke="${C.jacketDark}" stroke-width="1.2"/>
        <path d="M34 72 L66 92 M40 66 L72 86 M28 84 L58 98 M66 70 L36 94 M74 82 L50 98 M58 66 L30 86" stroke="${C.jacketDark}" stroke-width="1" opacity=".6"/>
        <path d="M36 66 Q50 74 64 66" stroke="#2b2b33" stroke-width="3" fill="none"/><circle cx="50" cy="72" r="2.2" fill="#e8c35a"/>` : ''}
      <rect x="35" y="94" width="10" height="14" rx="5" fill="${C.dogMuzzle}"/><rect x="55" y="94" width="10" height="14" rx="5" fill="${C.dogMuzzle}"/>
      <path class="ear" d="M30 30 C 12 18, 4 34, 14 48 C 20 54, 28 44, 30 36 Z" fill="url(#${ear})"/>
      <path class="ear" d="M70 30 C 88 18, 96 34, 86 48 C 80 54, 72 44, 70 36 Z" fill="url(#${ear})"/>
      <ellipse cx="50" cy="40" rx="26" ry="24" fill="url(#${fur})" stroke="#d9c09a" stroke-width="0.8"/>
      <path d="M30 22 q6 -6 14 -6 M56 16 q8 1 13 6" stroke="#fff" stroke-width="1.6" fill="none" opacity=".7" stroke-linecap="round"/>
      <path d="M74 32 Q78 44 72 56" stroke="#c9a2ff" stroke-width="3.5" fill="none" opacity=".55" stroke-linecap="round" filter="url(#${gl})"/>
      <ellipse cx="50" cy="52" rx="14" ry="10" fill="${C.dogMuzzle}"/>
      <ellipse cx="50" cy="46" rx="5.8" ry="4.2" fill="${C.dogNose}"/><ellipse cx="48.4" cy="44.6" rx="1.8" ry="1" fill="#fff" opacity=".7"/>
      ${eyes(face, 40, 60, 37, 0.85, false, 'pet')}
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

  // ---- Dress-up: things the three of us wear for different movies & seasons -----------
  // Drawn in the couple() picture's coordinates (300 x 180).
  // (inline transform-box: the page's CSS otherwise rotates every shape around its own centre)
  const santaHat = (x, y, w, tilt = 12) => `<g transform="rotate(${tilt} ${x + w / 2} ${y})" style="transform-box:view-box;transform-origin:0 0">
    <path d="M${x} ${y} Q${x + w * 0.45} ${y - w * 0.9} ${x + w * 1.05} ${y - w * 0.55} Q${x + w * 0.8} ${y - w * 0.3} ${x + w} ${y} Z" fill="#d6363f"/>
    <rect x="${x - 4}" y="${y - 6}" width="${w + 8}" height="13" rx="6.5" fill="#fffaf1"/><circle cx="${x + w * 1.05}" cy="${y - w * 0.55}" r="7" fill="#fffaf1"/></g>`;
  const partyHat = (x, y, w, fill) => `<g><path d="M${x} ${y} L${x + w / 2} ${y - w * 1.1} L${x + w} ${y} Z" fill="${fill}"/>
    <path d="M${x + w * 0.2} ${y - w * 0.25} L${x + w * 0.8} ${y - w * 0.25} M${x + w * 0.32} ${y - w * 0.55} L${x + w * 0.68} ${y - w * 0.55}" stroke="#fff" stroke-width="3"/>
    <circle cx="${x + w / 2}" cy="${y - w * 1.1}" r="5" fill="#f3d27a"/></g>`;
  const glasses3d = (x1, x2, y) => `<g>
    <rect x="${x1 - 14}" y="${y - 9}" width="27" height="18" rx="4" fill="#e5484d" opacity=".85" stroke="#2b1d17" stroke-width="3"/>
    <rect x="${x2 - 13}" y="${y - 9}" width="27" height="18" rx="4" fill="#3fb6e5" opacity=".85" stroke="#2b1d17" stroke-width="3"/>
    <path d="M${x1 + 13} ${y - 2} L${x2 - 13} ${y - 2}" stroke="#2b1d17" stroke-width="3"/></g>`;
  const ACCESSORIES = {
    glasses3d: () => glasses3d(75, 105, 68) + glasses3d(185, 215, 75),
    santa: () => santaHat(56, 36, 66, -8) + santaHat(168, 38, 62, 10) + santaHat(142, 131, 34, 8),
    party: () => partyHat(70, 34, 40, '#7fb2d8') + partyHat(184, 34, 36, '#e7a9a0') + partyHat(148, 131, 22, '#f3d27a')
      + [[30, 30, '#e5484d'], [262, 40, '#5aa77c'], [40, 110, '#f3d27a'], [270, 120, '#7fb2d8'], [150, 20, '#e7a9a0']]
        .map(([x, y, c]) => `<rect class="twinkle" x="${x}" y="${y}" width="7" height="7" rx="1.5" fill="${c}" transform="rotate(25 ${x} ${y})"/>`).join(''),
    witch: () => `<g><path d="M162 44 L238 44 L222 34 L206 -6 L190 30 Z" fill="#2b1d17"/><ellipse cx="200" cy="44" rx="48" ry="8" fill="#2b1d17"/><rect x="186" y="32" width="30" height="6" fill="#8e5bd1"/></g>
      <g transform="translate(18 132)"><ellipse cx="22" cy="22" rx="24" ry="20" fill="#f08a2c"/><path d="M22 2 q2 -8 8 -9" stroke="#5aa77c" stroke-width="4" fill="none"/>
      <path d="M10 18 l5 -6 l5 6 Z M26 18 l5 -6 l5 6 Z M10 28 q12 8 24 0 l-4 5 l-4 -4 l-4 4 l-4 -4 l-4 4 Z" fill="#2b1d17"/></g>
      <path class="float" d="M250 22 q8 -8 14 0 q6 -8 14 0 q-7 -2 -14 6 q-7 -8 -14 -6 Z" fill="#2b1d17"/>`,
    blanket: () => `<g class="shiver"><path d="M6 182 L10 118 Q60 98 150 104 Q240 98 294 116 L296 182 Z" fill="#d9c4a5"/>
      <path d="M14 126 Q80 108 150 114 Q220 108 290 126" stroke="#c4ab86" stroke-width="3" fill="none"/>
      <path d="M40 150 l14 14 M90 140 l14 14 M150 146 l14 14 M210 140 l14 14 M250 152 l14 14" stroke="#e7a9a0" stroke-width="5" stroke-linecap="round"/></g>`,
    tissues: () => `<g transform="translate(236 136)"><rect x="0" y="12" width="46" height="30" rx="5" fill="#f6eedf" stroke="#c4ab86" stroke-width="2"/>
      <path d="M0 22 H46" stroke="#e7a9a0" stroke-width="5"/><path d="M14 13 Q18 -8 24 2 Q30 -10 32 13 Z" fill="#fff" stroke="#e4d6bd" stroke-width="1.5"/></g>`,
    popcorn: () => popcorn(236, 132, 0.75),
  };

  /** What we'd wear for a movie: from its genres (TMDB names) and the time of year. */
  function outfitFor(genres = [], season = null) {
    const g = new Set(genres || []);
    const has = (...xs) => xs.some((x) => g.has(x));
    let face = 'smile';
    const extras = [];
    if (has('Horror', 'Thriller')) { face = 'shock'; extras.push('blanket'); }
    else if (has('Action', 'Science Fiction', 'Adventure', 'Fantasy')) { extras.push('glasses3d', 'popcorn'); }
    else if (has('Drama', 'Romance')) { face = g.has('Romance') ? 'love' : 'cry'; extras.push('tissues'); }
    else if (has('Comedy')) { face = 'laugh'; extras.push('popcorn'); }
    else if (has('Animation', 'Family', 'Music')) { extras.push('party'); }
    else extras.push('popcorn');
    if (season === 'christmas' || season === 'newyear') extras.push(season === 'christmas' ? 'santa' : 'party');
    if (season === 'halloween') extras.push('witch');
    return { face, extras: [...new Set(extras)] };
  }

  function couple(face = 'smile', extras = []) {
    const front = extras.filter((x) => ACCESSORIES[x]).map((x) => ACCESSORIES[x]()).join('');
    // Hats stick out above our heads: give them room.
    const hats = extras.some((x) => x === 'party' || x === 'santa' || x === 'witch');
    return `<svg class="couple" viewBox="${hats ? '0 -24 300 204' : '0 0 300 180'}" role="img" aria-label="Us">${place(him({ face }), 30, 18, 1)}${place(her({ face: face === 'smile' ? 'wink' : face }), 140, 20, 1)}${place(dog({ face: face === 'cry' ? 'cry' : 'smile' }), 108, 100, 0.72, 'bob')}${front}</svg>`;
  }

  /** A lipstick kiss mark. */
  function lips() {
    return `<svg class="lips" viewBox="0 0 120 70" aria-hidden="true">
      <path d="M6 34 Q24 6 46 14 Q56 18 60 24 Q64 18 74 14 Q96 6 114 34 Q92 34 60 38 Q28 34 6 34 Z" fill="#c9343c"/>
      <path d="M6 36 Q28 38 60 40 Q92 38 114 36 Q96 66 60 66 Q24 66 6 36 Z" fill="#b02631"/>
      <path d="M22 30 Q40 20 54 28 M70 28 Q84 20 98 30 M30 48 Q60 58 90 48" stroke="#e46a72" stroke-width="2.5" fill="none" opacity=".7"/></svg>`;
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

  window.Art = { head, bowSvg, him, her, dog, scene, reaction, couple, outfitFor, lips, fetchingPup, bow, heart, SCENES: Object.keys(SCENES), REACTIONS: Object.keys(REACTIONS) };
})();
