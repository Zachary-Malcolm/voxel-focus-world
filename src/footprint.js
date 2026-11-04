import { blueprint, rotateXZ } from './blueprints.js';
import { mulberry32 } from './rng.js';
import * as THREE from 'three';
import { jitterColor } from './voxels.js';
import { isDecor } from './catalog.js';

const cache = new Map();

/**
 * Blocks of a build relative to its origin after rotation, plus:
 *  rect:  everything the build covers (used for spacing between buildings)
 *  base:  the cells that must stand on land (ground floor, at least 3x3)
 *  spin:  rotated { pivot, axis } for spinning parts, or null
 *  smoke: rotated chimney tops
 *  height: top block y
 */
export function footprint(kind, variant, rot = 0) {
  const key = `${kind}:${variant}:${rot}`;
  if (cache.has(key)) return cache.get(key);
  const rng = mulberry32(variant ^ 0x51ed);
  const raw = blueprint(kind, variant);
  const rel = raw.map((b) => {
    const [x, z] = rotateXZ(b.x, b.z, rot);
    const out = { x, y: b.y, z, color: jitterColor(b.color, rng, b.mat === 'glass' || b.mat === 'lantern' ? 0.01 : 0.035), spin: !!b.spin };
    out.tone = typeof b.color === 'string' ? b.color : new THREE.Color(b.color).getHexString(); // blueprint colour, for "all like it"
    if (b.mat) out.mat = b.mat;
    if (b.shape) out.shape = b.shape;
    if (b.r || rot) out.r = ((b.r || 0) + rot) % 4;
    if (b.s != null) out.s = b.s;
    return out;
  });
  const rect = { x0: Infinity, x1: -Infinity, z0: Infinity, z1: -Infinity };
  // decor only needs land under what it actually stands on; buildings need at least 3x3
  const decor = isDecor(kind);
  const base = decor ? { x0: Infinity, x1: -Infinity, z0: Infinity, z1: -Infinity } : { x0: -1, x1: 1, z0: -1, z1: 1 };
  let height = 1;
  for (const b of rel) {
    const bx = Math.round(b.x);
    const bz = Math.round(b.z);
    // big scaled shapes (canopies, cones) reach past their own cell
    const sv = b.s == null ? [1, 1, 1] : Array.isArray(b.s) ? b.s : [b.s, b.s, b.s];
    const half = Math.max(0, (b.spin ? 1 : Math.max(sv[0], sv[2])) / 2 - 0.5);
    rect.x0 = Math.min(rect.x0, Math.round(b.x - half));
    rect.x1 = Math.max(rect.x1, Math.round(b.x + half));
    rect.z0 = Math.min(rect.z0, Math.round(b.z - half));
    rect.z1 = Math.max(rect.z1, Math.round(b.z + half));
    height = Math.max(height, Math.ceil(b.y + sv[1] / 2 - 0.5));
    if (Math.round(b.y) === 1 && !b.deco) {
      base.x0 = Math.min(base.x0, bx);
      base.x1 = Math.max(base.x1, bx);
      base.z0 = Math.min(base.z0, bz);
      base.z1 = Math.max(base.z1, bz);
    }
  }
  let spin = null;
  if (raw.spin) {
    const [px, pz] = rotateXZ(raw.spin.pivot[0], raw.spin.pivot[2], rot);
    // Sails sweep a full circle while turning: reserve that space sideways.
    const reach = 4;
    const axis = rot & 1 ? (raw.spin.axis === 'z' ? 'x' : 'z') : raw.spin.axis;
    spin = { pivot: [px, raw.spin.pivot[1], pz], axis };
    if (axis === 'z') {
      rect.x0 = Math.min(rect.x0, px - reach);
      rect.x1 = Math.max(rect.x1, px + reach);
    } else {
      rect.z0 = Math.min(rect.z0, pz - reach);
      rect.z1 = Math.max(rect.z1, pz + reach);
    }
  }
  const smoke = (raw.smoke || []).map(([x, y, z]) => {
    const [rx, rz] = rotateXZ(x, z, rot);
    return [rx, y, rz];
  });
  if (!Number.isFinite(base.x0)) Object.assign(base, rect);
  const fp = { rel, rect, base, spin, smoke, height, count: rel.length, decor };
  cache.set(key, fp);
  return fp;
}

/** Fresh absolute block objects for a build at (ox, oz). */
export function placeBlocks(fp, ox = 0, oz = 0, oy = 0) {
  return fp.rel.map((b) => ({ ...b, x: b.x + ox, y: b.y + oy, z: b.z + oz, handle: null, q: null, sv: null }));
}

export function shiftRect(r, x, z) {
  return { x0: r.x0 + x, x1: r.x1 + x, z0: r.z0 + z, z1: r.z1 + z };
}
