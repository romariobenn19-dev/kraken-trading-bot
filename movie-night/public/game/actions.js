/* Our World - poses made in code on top of the animations (wave, hug, kiss, slap, holding
 * hands, a jump when surprised), plus little sound effects. The arms are pointed in a
 * direction (e.g. "forward and a bit inward") and the joints work it out. */
import * as THREE from 'three';

const Y = new THREE.Vector3(0, 1, 0);
const tq = new THREE.Quaternion(), tq2 = new THREE.Quaternion(), tv = new THREE.Vector3();

/** Point a bone (its +Y runs along the limb) toward a direction in the world. */
function aim(bone, dir, w) {
  if (!bone || w <= 0) return;
  bone.parent.updateWorldMatrix(true, false);
  bone.parent.getWorldQuaternion(tq);
  tv.copy(dir).normalize().applyQuaternion(tq.invert());
  tq2.setFromUnitVectors(Y, tv);
  bone.quaternion.slerp(tq2, w);
  bone.updateMatrixWorld(true);
}
/** Turn a bone around an axis given in the world. */
function turn(bone, axis, angle) {
  if (!bone || !angle) return;
  bone.parent.updateWorldMatrix(true, false);
  bone.parent.getWorldQuaternion(tq);
  const local = tv.copy(axis).applyQuaternion(tq2.copy(tq).invert()).normalize();
  bone.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(local, angle));
  bone.updateMatrixWorld(true);
}
const ease = (t) => t * t * (3 - 2 * t);
/** How strongly a pose shows: fades in, holds, fades out. */
function envelope(t, dur, fadeIn = 0.25, fadeOut = 0.3) {
  if (t < 0 || t > dur) return 0;
  return Math.min(ease(Math.min(1, t / fadeIn)), ease(Math.min(1, (dur - t) / fadeOut)));
}

export const POSES = {
  wave: 2.4, hug: 3.6, kiss: 2.6, slap: 0.6, jump: 0.9, hands: Infinity, cheer: 2.0,
};

/** Start a pose on an avatar (it plays on top of walking/idle). */
export function pose(avatar, kind, opts = {}) {
  avatar.poses = (avatar.poses || []).filter((p) => p.kind !== kind);
  avatar.poses.push({ kind, start: performance.now() / 1000, dur: opts.dur || POSES[kind] || 2, side: opts.side || 1 });
}
export function stopPose(avatar, kind) { avatar.poses = (avatar.poses || []).filter((p) => p.kind !== kind); }

/** Apply the poses after the animation has been updated for this frame. */
export function applyPoses(avatar) {
  if (!avatar.poses || !avatar.poses.length) { avatar.root.children[0].position.y = 0; return; }
  const now = performance.now() / 1000;
  avatar.poses = avatar.poses.filter((p) => now - p.start <= p.dur);
  const b = avatar.bones || (avatar.bones = {
    rArm: avatar.model.getObjectByName('mixamorigRightArm'), rFore: avatar.model.getObjectByName('mixamorigRightForeArm'),
    lArm: avatar.model.getObjectByName('mixamorigLeftArm'), lFore: avatar.model.getObjectByName('mixamorigLeftForeArm'),
    spine: avatar.model.getObjectByName('mixamorigSpine2'), head: avatar.model.getObjectByName('mixamorigHead'),
  });
  const h = avatar.root.rotation.y;
  const f = new THREE.Vector3(Math.sin(h), 0, Math.cos(h));      // forward
  const r = new THREE.Vector3(-Math.cos(h), 0, Math.sin(h));     // the avatar's right
  const u = Y;
  const mix = (...parts) => parts.reduce((acc, [v, k]) => acc.addScaledVector(v, k), new THREE.Vector3());
  let lift = 0;
  avatar.model.updateMatrixWorld(true);
  for (const p of avatar.poses) {
    const t = now - p.start;
    const w = envelope(t, p.dur);
    switch (p.kind) {
      case 'wave': {
        aim(b.rArm, mix([r, 0.55], [u, 1.0], [f, 0.15]), w);
        aim(b.rFore, mix([u, 1], [r, 0.45 * Math.sin(t * 11)]), w);
        break;
      }
      case 'cheer': {
        aim(b.rArm, mix([r, 0.3], [u, 1]), w); aim(b.rFore, mix([u, 1], [r, 0.1]), w);
        aim(b.lArm, mix([r, -0.3], [u, 1]), w); aim(b.lFore, mix([u, 1], [r, -0.1]), w);
        lift = Math.max(lift, Math.abs(Math.sin(t * 7)) * 0.12 * w);
        break;
      }
      case 'hug': {
        aim(b.rArm, mix([f, 1], [r, 0.35], [u, 0.1]), w); aim(b.rFore, mix([f, 0.35], [r, -1]), w);
        aim(b.lArm, mix([f, 1], [r, -0.35], [u, 0.12]), w); aim(b.lFore, mix([f, 0.35], [r, 1]), w);
        turn(b.spine, r, 0.12 * w);
        turn(b.head, u, 0.35 * w);
        break;
      }
      case 'kiss': {
        turn(b.spine, r, 0.2 * w);
        turn(b.head, r, 0.12 * w);
        aim(b.rArm, mix([f, 0.8], [r, 0.3], [u, -0.3]), w * 0.8); aim(b.rFore, mix([f, 0.6], [r, -0.8], [u, 0.4]), w * 0.8);
        aim(b.lArm, mix([f, 0.8], [r, -0.3], [u, -0.3]), w * 0.8); aim(b.lFore, mix([f, 0.6], [r, 0.8], [u, 0.4]), w * 0.8);
        break;
      }
      case 'slap': {
        // A quick swing of the right hand, back then forward and low.
        const k = Math.min(1, t / 0.28);
        const back = mix([r, 0.45], [f, -0.6], [u, -0.2]), front = mix([r, 0.05], [f, 0.9], [u, -0.55]);
        aim(b.rArm, back.lerp(front, ease(k)), w);
        aim(b.rFore, mix([f, 0.6], [u, -0.6], [r, -0.25]), w);
        turn(b.spine, u, (-0.35 + 0.6 * ease(k)) * w);
        break;
      }
      case 'jump': {
        // Surprised: a little hop and a look back over the shoulder.
        lift = Math.max(lift, Math.sin(Math.min(1, t / 0.45) * Math.PI) * 0.18);
        turn(b.head, u, 0.7 * w * p.side);
        aim(b.rArm, mix([r, 0.5], [u, -0.6], [f, -0.4]), w * 0.6);
        aim(b.lArm, mix([r, -0.5], [u, -0.6], [f, -0.4]), w * 0.6);
        break;
      }
      case 'hands': {
        // Arm down and out toward the person beside you (side: +1 = right hand, -1 = left).
        const s = p.side;
        if (s > 0) { aim(b.rArm, mix([u, -1], [r, 0.42], [f, 0.12]), w); aim(b.rFore, mix([u, -1], [r, 0.3], [f, 0.25]), w); }
        else { aim(b.lArm, mix([u, -1], [r, -0.42], [f, 0.12]), w); aim(b.lFore, mix([u, -1], [r, -0.3], [f, 0.25]), w); }
        break;
      }
      default:
    }
  }
  avatar.root.children[0].position.y = lift;
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
    // soft chime (hug, holding hands)
    for (const [fq, dl] of [[660, 0], [880, 0.09], [1320, 0.18]]) {
      const o = a.createOscillator(); o.type = 'triangle'; o.frequency.value = fq;
      const g = a.createGain(); g.gain.setValueAtTime(0.0001, t0 + dl); g.gain.exponentialRampToValueAtTime(0.18, t0 + dl + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dl + 0.6);
      o.connect(g); g.connect(a.destination); o.start(t0 + dl); o.stop(t0 + dl + 0.65);
    }
  }
}
