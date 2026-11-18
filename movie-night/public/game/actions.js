/* Our World - the together interactions, layered on top of the walk/idle animations.
 *
 * Hands go to real places (her back, his shoulders, her bum…) with two-bone IK: the shoulder,
 * elbow and wrist work out how to bend so the hand lands on the target, with the elbow
 * pointing a natural way. Heads turn and tilt, the upper body leans, and every move has a
 * wind-up, the action, and a settle. Also: little sounds. */
import * as THREE from 'three';

const UP = new THREE.Vector3(0, 1, 0);
const v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), v3 = new THREE.Vector3(), v4 = new THREE.Vector3();
const q1 = new THREE.Quaternion(), q2 = new THREE.Quaternion(), qI = new THREE.Quaternion();
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const ease = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const easeOut = (t) => 1 - Math.pow(1 - clamp(t, 0, 1), 3);
const wpos = (o, out = new THREE.Vector3()) => o.getWorldPosition(out);

/** Turn a bone (in world space) so that `cur` direction becomes `des`, blended by w. Works whatever way the bone's axes point. */
function rotateTo(bone, cur, des, w) {
  if (!bone || w <= 0 || cur.lengthSq() < 1e-8 || des.lengthSq() < 1e-8) return;
  q1.setFromUnitVectors(cur.clone().normalize(), des.clone().normalize());
  if (w < 1) q1.slerpQuaternions(qI, q1, w);
  bone.getWorldQuaternion(q2);
  q2.premultiply(q1);                                    // new world rotation
  bone.parent.getWorldQuaternion(v4._q || (v4._q = new THREE.Quaternion()));
  bone.quaternion.copy(v4._q.invert().multiply(q2));
  bone.updateMatrixWorld(true);
}
/** Turn a bone around a world axis. */
function turn(bone, axis, angle) {
  if (!bone || !angle) return;
  q1.setFromAxisAngle(axis, angle);
  bone.getWorldQuaternion(q2);
  q2.premultiply(q1);
  bone.parent.getWorldQuaternion(v4._q || (v4._q = new THREE.Quaternion()));
  bone.quaternion.copy(v4._q.invert().multiply(q2));
  bone.updateMatrixWorld(true);
}
/**
 * Two-bone IK: bend upper arm + forearm so the hand reaches `target`; the elbow bends toward
 * `pole` (a direction). Blended in by w.
 */
function reach(arm, target, pole, w) {
  if (!arm.upper || w <= 0) return;
  const S = wpos(arm.upper, v1.clone()), E = wpos(arm.fore, v2.clone()), H = wpos(arm.hand, v3.clone());
  const a = S.distanceTo(E), b = E.distanceTo(H);
  const toT = target.clone().sub(S);
  const d = clamp(toT.length(), Math.abs(a - b) + 1e-3, (a + b) * 0.995);
  const dir = toT.normalize();
  const x = (a * a - b * b + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, a * a - x * x));
  const p = pole.clone().addScaledVector(dir, -pole.dot(dir));
  if (p.lengthSq() < 1e-6) p.copy(UP).addScaledVector(dir, -UP.dot(dir));
  p.normalize();
  const elbow = S.clone().addScaledVector(dir, x).addScaledVector(p, h);
  rotateTo(arm.upper, E.clone().sub(S), elbow.clone().sub(S), w);
  const E2 = wpos(arm.fore, new THREE.Vector3()), H2 = wpos(arm.hand, new THREE.Vector3());
  const T = S.clone().addScaledVector(dir, d);
  rotateTo(arm.fore, H2.clone().sub(E2), T.sub(E2), w);
}

/** How long each interaction lasts (seconds). */
export const POSES = { wave: 2.8, hug: 4.6, kiss: 3.8, slap: 1.25, slapped: 1.9, hands: Infinity };

export function pose(avatar, kind, opts = {}) {
  avatar.poses = (avatar.poses || []).filter((p) => p.kind !== kind);
  avatar.poses.push({ kind, start: performance.now() / 1000, dur: opts.dur || POSES[kind] || 2, partner: opts.partner || null, side: opts.side || 1 });
}
export function stopPose(avatar, kind) { avatar.poses = (avatar.poses || []).filter((p) => p.kind !== kind); }
export const hasPose = (avatar, kind) => !!(avatar.poses || []).some((p) => p.kind === kind);

function rig(avatar) {
  if (avatar.rig) return avatar.rig;
  const g = (n) => avatar.model.getObjectByName(`mixamorig${n}`);
  avatar.rig = {
    hips: g('Hips'), spine: g('Spine1'), chest: g('Spine2'), neck: g('Neck'), head: g('Head'),
    R: { upper: g('RightArm'), fore: g('RightForeArm'), hand: g('RightHand'), shoulder: g('RightShoulder') },
    L: { upper: g('LeftArm'), fore: g('LeftForeArm'), hand: g('LeftHand'), shoulder: g('LeftShoulder') },
  };
  return avatar.rig;
}
/** Facing vectors from the avatar's heading. */
function frame(avatar) {
  const h = avatar.root.rotation.y;
  return { f: new THREE.Vector3(Math.sin(h), 0, Math.cos(h)), r: new THREE.Vector3(-Math.cos(h), 0, Math.sin(h)) };
}
/** A smooth in-hold-out weight for a pose. */
function weight(t, dur, fin = 0.4, fout = 0.45) {
  if (t < 0 || t > dur) return 0;
  return Math.min(ease(t / fin), ease((dur - t) / fout));
}

/**
 * Apply this frame's interaction poses to an avatar (after its animation has been updated).
 * find(name) returns the avatar of the person they're with.
 */
export function applyPoses(avatar, find) {
  const body = avatar.root.children[0];
  if (!avatar.poses || !avatar.poses.length) { body.position.set(0, 0, 0); return; }
  const now = performance.now() / 1000;
  const frozen = typeof window.__freezePose === 'number' ? window.__freezePose : null; // for testing
  if (frozen === null) avatar.poses = avatar.poses.filter((p) => now - p.start <= p.dur);
  const R = rig(avatar);
  const { f, r } = frame(avatar);
  const isHim = avatar.kind === 'him';
  let lift = 0, push = 0;
  avatar.model.updateMatrixWorld(true);
  for (const p of avatar.poses) {
    const t = frozen !== null ? Math.min(frozen, p.dur === Infinity ? frozen : p.dur - 0.5) : now - p.start;
    const w = weight(t, p.dur);
    const other = p.partner ? find(p.partner) : null;
    const O = other ? rig(other) : null;
    if (other) other.model.updateMatrixWorld(true);
    switch (p.kind) {
      case 'wave': {
        // Upper arm out to the side and up, forearm up, the hand swinging from the elbow.
        const sh = wpos(R.R.upper, new THREE.Vector3());
        const swing = Math.sin(Math.max(0, t - 0.35) * 9) * 0.13 * ease((t - 0.3) / 0.3);
        // Hand up beside the head, a little forward, palm out; the elbow points down and out.
        const target = sh.clone().addScaledVector(UP, 0.32).addScaledVector(r, 0.2 + swing).addScaledVector(f, 0.2);
        reach(R.R, target, r.clone().multiplyScalar(0.5).addScaledVector(UP, -1).addScaledVector(f, 0.15), w);
        turn(R.head, UP, -0.12 * w);
        break;
      }
      case 'hug': {
        if (!O) break;
        // Arms around their back: one higher (over the shoulder), one lower (round the waist).
        const { f: of } = frame(other);
        const back = of.clone().negate();
        const chest = wpos(O.chest, new THREE.Vector3()), waist = wpos(O.spine, new THREE.Vector3());
        const hi = isHim ? 0 : 0.08;
        const tR = (isHim ? waist : chest).clone().addScaledVector(back, 0.12).addScaledVector(r, -0.04).addScaledVector(UP, hi);
        const tL = (isHim ? chest : waist).clone().addScaledVector(back, 0.12).addScaledVector(r, 0.04).addScaledVector(UP, -hi);
        reach(R.R, tR, r.clone().addScaledVector(UP, -0.4).addScaledVector(f, -0.2), w);
        reach(R.L, tL, r.clone().negate().addScaledVector(UP, -0.4).addScaledVector(f, -0.2), w);
        // Lean in, head to the side resting on the shoulder, and a gentle sway.
        turn(R.chest, r, 0.14 * w);
        turn(R.head, UP, (isHim ? 0.55 : -0.55) * w);
        turn(R.head, f, (isHim ? -0.12 : 0.12) * w);
        turn(R.hips, UP, Math.sin(t * 1.6) * 0.06 * w);
        break;
      }
      case 'kiss': {
        if (!O) break;
        if (avatar.mocap && avatar.mocap.has('kiss')) break; // the recorded kiss does it all
        // Lean in until the faces meet; heads tilt opposite ways; hands on waist / shoulders.
        const myHead = wpos(R.head, new THREE.Vector3()), theirHead = wpos(O.head, new THREE.Vector3());
        const gap = Math.hypot(theirHead.x - myHead.x, theirHead.z - myHead.z);
        const want = 0.11;                                       // forehead-to-forehead distance at the kiss
        const lean = clamp(Math.atan2(Math.max(0, gap - want) * 0.5, 0.55), 0, 0.42) * w;
        turn(R.spine, r, lean * 0.45);
        turn(R.chest, r, lean * 0.55);
        // Taller one tips the head down, shorter one up; both tilt to the side.
        const dy = theirHead.y - myHead.y;
        turn(R.head, r, clamp(-dy * 1.2, -0.3, 0.3) * w);
        turn(R.head, f, (isHim ? 0.32 : -0.32) * w);
        const ow = wpos(O.spine, new THREE.Vector3()), os = wpos(O.chest, new THREE.Vector3());
        if (isHim) {                                             // hands on her waist
          reach(R.R, ow.clone().addScaledVector(r, -0.13).addScaledVector(f, -0.02), r.clone().addScaledVector(UP, -0.6), w);
          reach(R.L, ow.clone().addScaledVector(r, 0.13).addScaledVector(f, -0.02), r.clone().negate().addScaledVector(UP, -0.6), w);
        } else {                                                 // hands on his shoulders
          reach(R.R, os.clone().addScaledVector(UP, 0.17).addScaledVector(r, -0.17), r.clone().addScaledVector(UP, -0.7), w);
          reach(R.L, os.clone().addScaledVector(UP, 0.17).addScaledVector(r, 0.17), r.clone().negate().addScaledVector(UP, -0.7), w);
          lift = Math.max(lift, 0.04 * w);                        // up on her toes a little
        }
        break;
      }
      case 'slap': {
        if (!O) break;
        // Wind up behind, swing, contact on her bum, a little follow-through, back to rest.
        const { f: of } = frame(other);
        const bum = wpos(O.hips, new THREE.Vector3()).addScaledVector(of, -0.17).addScaledVector(UP, -0.06);
        const sh = wpos(R.R.upper, new THREE.Vector3());
        const windup = sh.clone().addScaledVector(f, -0.28).addScaledVector(r, 0.32).addScaledVector(UP, -0.05);
        const through = bum.clone().addScaledVector(f, 0.12).addScaledVector(UP, -0.03);
        let target;
        if (t < 0.32) target = windup.clone().lerp(bum, 0); // wind-up
        else if (t < 0.45) target = windup.clone().lerp(bum, easeOut((t - 0.32) / 0.13));
        else if (t < 0.6) target = bum.clone().lerp(through, ease((t - 0.45) / 0.15));
        else target = through;
        const ww = t < 0.32 ? ease(t / 0.32) * w : w;
        reach(R.R, target, r.clone().addScaledVector(UP, 0.2).addScaledVector(f, -0.5), ww);
        turn(R.chest, UP, (t < 0.32 ? -0.32 * ease(t / 0.32) : -0.32 + 0.5 * easeOut((t - 0.32) / 0.18)) * w);
        turn(R.head, UP, -0.35 * w);                              // looking at her
        break;
      }
      case 'slapped': {
        // Contact at 0.45s: a jolt forward, a hop, a hand flies to her bum, she looks back at him.
        const tc = t - 0.45;
        if (tc < 0) break;
        const jolt = Math.sin(clamp(tc / 0.35, 0, 1) * Math.PI);
        push = Math.max(push, jolt * 0.08);
        lift = Math.max(lift, Math.sin(clamp(tc / 0.4, 0, 1) * Math.PI) * 0.13);
        turn(R.hips, r, -0.18 * jolt);
        const ww = ease(tc / 0.2) * weight(t, p.dur, 0.1, 0.5);
        // side -1: he's on her right, so her right hand goes to her right cheek and she looks right.
        const bum = wpos(R.hips, new THREE.Vector3()).addScaledVector(f, -0.16).addScaledVector(UP, -0.05).addScaledVector(r, -0.07 * p.side);
        reach(p.side < 0 ? R.R : R.L, bum, (p.side < 0 ? r.clone() : r.clone().negate()).addScaledVector(f, -0.6), ww);
        turn(R.chest, UP, 0.35 * p.side * ww);
        turn(R.head, UP, 0.75 * p.side * ww);
        turn(R.head, r, -0.15 * ww);
        break;
      }
      case 'hands': {
        if (!O) break;
        // Hands meet between you, at hip height, swinging a little as you walk.
        const mine = p.side > 0 ? R.R : R.L, theirs = p.side > 0 ? O.L : O.R;
        const m = wpos(R.hips, new THREE.Vector3()).add(wpos(O.hips, new THREE.Vector3())).multiplyScalar(0.5);
        void theirs;
        m.y -= 0.12;
        m.addScaledVector(f, 0.06);
        reach(mine, m, (p.side > 0 ? r : r.clone().negate()).clone().addScaledVector(f, -0.5).addScaledVector(UP, -0.3), w);
        break;
      }
      default:
    }
  }
  body.position.set(f.x * push, lift, f.z * push);
}

/** A good camera for watching an interaction: from the side, close, framing both of you. */
export function cinematic(kind) {
  if (kind === 'hug' || kind === 'kiss') return { side: 1, dist: kind === 'kiss' ? 1.55 : 2.3, pitch: 0.05, height: kind === 'kiss' ? 1.58 : 1.3 };
  // The slap: from behind her, a little to the side, at hip height (so you see the hand land).
  if (kind === 'slap') return { behind: 0.5, dist: 2.0, pitch: 0.12, height: 0.95 };
  return null;
}

// ---- Little sounds (made on the fly, no files) --------------------------------------------------
let actx = null;
function ctx() {
  if (!actx) { try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch { return null; } }
  if (actx.state === 'suspended') actx.resume();
  return actx;
}
export function sound(kind) {
  const a = ctx();
  if (!a) return;
  const t0 = a.currentTime;
  const out = a.createGain(); out.connect(a.destination);
  if (kind === 'slap') {
    const len = 0.12, buf = a.createBuffer(1, a.sampleRate * len, a.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 3);
    const src = a.createBufferSource(); src.buffer = buf;
    const bp = a.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1700; bp.Q.value = 0.8;
    src.connect(bp); bp.connect(out); out.gain.value = 1.6; src.start(t0);
  } else if (kind === 'kiss') {
    const o = a.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(900, t0); o.frequency.exponentialRampToValueAtTime(1800, t0 + 0.08);
    out.gain.setValueAtTime(0.0001, t0); out.gain.exponentialRampToValueAtTime(0.35, t0 + 0.02); out.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.14);
    o.connect(out); o.start(t0); o.stop(t0 + 0.16);
  } else {
    for (const [fq, dl] of [[660, 0], [880, 0.09], [1320, 0.18]]) {
      const o = a.createOscillator(); o.type = 'triangle'; o.frequency.value = fq;
      const g = a.createGain(); g.gain.setValueAtTime(0.0001, t0 + dl); g.gain.exponentialRampToValueAtTime(0.18, t0 + dl + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dl + 0.6);
      o.connect(g); g.connect(a.destination); o.start(t0 + dl); o.stop(t0 + dl + 0.65);
    }
  }
}
