import { hash2, mulberry32 } from './rng.js';
import { blueprint } from './blueprints.js';
import { jitterColor } from './voxels.js';

/*
 * Natural terrain: a pure function of the island seed and a cell's position, so it is the same on
 * every load and growing the island only reveals more of it. Home layers this over the flat base
 * island and flattens it wherever people have built (buildings, the square, roads).
 *
 *   hills   value-noise heights 0..3 away from the centre, sloped edges (wedges / corners)
 *   lakes   low spots of a second noise field, with sandy shores and lily pads
 *   river   starts at a spring pond near the centre and winds outward, over the rim as a waterfall
 *   nature  wild trees in woods, boulders, flowers, grass tufts, bushes, mushrooms, reeds
 */

export const CORE = 8; // the middle stays a flat meadow for the first buildings
export const RIVER_START = 10;

function lattice(seed, ix, iz) {
  return hash2(hash2(seed, ix + 8192), iz + 8192) / 4294967296;
}
const fade = (t) => t * t * (3 - 2 * t);
function vnoise(seed, x, z) {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = fade(x - ix);
  const fz = fade(z - iz);
  const a = lattice(seed, ix, iz);
  const b = lattice(seed, ix + 1, iz);
  const c = lattice(seed, ix, iz + 1);
  const d = lattice(seed, ix + 1, iz + 1);
  return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
}
export function fbm(seed, x, z) {
  return vnoise(seed, x, z) * 0.6 + vnoise(seed + 17, x * 2.1 + 5.3, z * 2.1) * 0.28 + vnoise(seed + 31, x * 4.3, z * 4.3 + 1.7) * 0.12;
}

export function riverAngleAt(seed, a0, d) {
  const ph = (seed % 997) * 0.01;
  return a0 + 0.42 * Math.sin(d * 0.2 + ph) + 0.18 * Math.sin(d * 0.51 + 1.7 + ph);
}

// The river's centre line, sampled every quarter tile from the spring outward (cached per course).
const lines = new Map();
function riverLine(seed, a0) {
  const key = `${seed}:${a0}`;
  let pts = lines.get(key);
  if (!pts) {
    pts = [];
    for (let d = RIVER_START; d <= 90; d += 0.25) {
      const a = riverAngleAt(seed, a0, d);
      pts.push([Math.cos(a) * d, Math.sin(a) * d]);
    }
    lines.set(key, pts);
  }
  return pts;
}

/** Distance (in tiles) from a cell to the river's centre line, or Infinity. */
export function riverDist(seed, a0, x, z) {
  if (a0 == null) return Infinity;
  const d = Math.hypot(x, z);
  if (d < RIVER_START - 1.5) return Infinity;
  let best = Infinity;
  for (const [px, pz] of riverLine(seed, a0)) {
    const dx = px - x;
    const dz = pz - z;
    if (dx > best || -dx > best) continue;
    const dd = Math.hypot(dx, dz);
    if (dd < best) best = dd;
  }
  return best;
}

export function springAt(seed, a0) {
  const a = riverAngleAt(seed, a0, RIVER_START);
  return [Math.cos(a) * RIVER_START, Math.sin(a) * RIVER_START];
}

/** What nature puts in a cell, ignoring buildings: { water: 'river'|'lake'|null, hill: 0..3 }. */
export function natural(seed, a0, x, z) {
  const d = Math.hypot(x, z);
  const lat = riverDist(seed, a0, x, z);
  let water = null;
  if (lat <= 0.95) water = 'river';
  else if (a0 != null) {
    const [sx, sz] = springAt(seed, a0);
    if (Math.hypot(x - sx, z - sz) <= 1.7) water = 'lake'; // the spring pond
  }
  if (!water && d > CORE + 2 && fbm(seed + 202, x / 8.5, z / 8.5) < 0.3) water = 'lake';
  let hill = 0;
  if (!water && d > CORE + 1 && lat > 2.5) {
    const h = fbm(seed + 101, x / 7, z / 7);
    hill = Math.max(0, Math.min(3, Math.floor((h - 0.55) * 14)));
    if (d < CORE + 3) hill = Math.min(hill, 1);
  }
  return { water, hill };
}

const FLOWERS = ['#ff6f91', '#ffd34d', '#c77dff', '#ff9f43', '#ffffff', '#6fc3ff', '#ff5e5e'];
const GRASS_TUFT = ['#5fbf45', '#6ccb4f', '#4fae3c'];
const ROCK = ['#8f97a3', '#9aa2ad', '#a7afba', '#868e9a'];

/** One wild tree per 3x3 block of cells at most, so woods never clump into a wall. */
function treeHere(seed, x, z, d) {
  const bx = Math.floor((x + 1536) / 3);
  const bz = Math.floor((z + 1536) / 3);
  const hb = hash2(hash2(seed, 0x7ee), bx * 4096 + bz);
  if (bx * 3 - 1536 + (hb % 3) !== x || bz * 3 - 1536 + ((hb >>> 4) % 3) !== z) return 0;
  const forest = fbm(seed + 303, x / 10, z / 10);
  let p = forest > 0.6 ? 0.9 : forest > 0.5 ? 0.35 : 0.07;
  if (d < CORE) p *= 0.35;
  return (hb >>> 8) / 16777216 < p ? hb : 0;
}

/**
 * Small natural things standing in a cell (relative blocks), or null.
 * nearWater: the cell borders water. onHill: cell height > 0.
 */
export function feature(seed, x, z, { water, hill, nearWater, allowTree }) {
  const h = hash2(hash2(seed, 991), (x + 512) * 1024 + (z + 512));
  const rng = mulberry32(h);
  const r = rng();
  const d = Math.hypot(x, z);
  const out = [];
  const put = (dx, dy, dz, color, o) => out.push({ x: x + dx, y: hill + dy, z: z + dz, color, ...o });
  if (water) {
    // water surface is at y = 0 (a slab in the top cell)
    if (water === 'lake' && r < 0.09) put(rng() * 0.4 - 0.2, 0.03, rng() * 0.4 - 0.2, '#4fae3c', { mat: 'leaves', shape: 'pillar', s: [0.8, 0.07, 0.8] });
    if (water === 'lake' && r < 0.03) put(0.1, 0.14, 0, '#ff9fc4', { mat: 'cloth', shape: 'orb', s: 0.45 });
    return out.length ? out : null;
  }
  const tree = allowTree ? treeHere(seed, x, z, d) : 0;
  if (tree) {
    // reuse the Tree blueprint (seeded per cell) so wild trees match the ones you build
    const t = blueprint('tree', tree);
    for (const b of t) out.push({ ...b, x: x + b.x, y: hill + b.y, z: z + b.z, color: jitterColor(b.color, rng, 0.04) });
    return out;
  }
  const meadow = fbm(seed + 404, x / 6, z / 6);
  if (nearWater && r < 0.35) {
    for (let i = 0; i < 3; i++) {
      const ox = rng() * 0.7 - 0.35;
      const oz = rng() * 0.7 - 0.35;
      const tall = 0.7 + rng() * 0.5;
      put(ox, 0.5 + tall / 2, oz, '#5d9a3c', { mat: 'leaves', shape: 'post', s: [0.35, tall, 0.35] });
      if (rng() < 0.6) put(ox, 0.55 + tall, oz, '#7a5434', { mat: 'cloth', shape: 'pillar', s: [0.14, 0.3, 0.14] });
    }
    return out;
  }
  if (r < (hill ? 0.09 : 0.022)) {
    const s = 0.55 + rng() * (hill ? 1 : 0.6);
    put(rng() * 0.4 - 0.2, 0.25 + s * 0.3, rng() * 0.4 - 0.2, ROCK[Math.floor(rng() * ROCK.length)], { mat: 'rock', shape: 'rock', s });
    if (s > 1 && rng() < 0.5) put(0.5, 0.35, 0.3, ROCK[0], { mat: 'rock', shape: 'rock', s: 0.45 });
    return out;
  }
  if (r < 0.022 + meadow * 0.16) {
    // a little clump of flowers on stems
    const n = 2 + Math.floor(rng() * 3);
    const c = FLOWERS[Math.floor(rng() * FLOWERS.length)];
    for (let i = 0; i < n; i++) {
      const ox = rng() * 0.7 - 0.35;
      const oz = rng() * 0.7 - 0.35;
      put(ox, 0.68, oz, '#4f9a3a', { mat: 'leaves', shape: 'post', s: [0.25, 0.36, 0.25] });
      put(ox, 0.9, oz, rng() < 0.75 ? c : FLOWERS[Math.floor(rng() * FLOWERS.length)], { mat: 'cloth', shape: 'orb', s: 0.42 });
    }
    return out;
  }
  if (r < 0.32) {
    // grass tufts
    const n = 2 + Math.floor(rng() * 2);
    for (let i = 0; i < n; i++) put(rng() * 0.7 - 0.35, 0.72, rng() * 0.7 - 0.35, GRASS_TUFT[i % 3], { mat: 'leaves', shape: 'spire', s: [0.32, 0.45, 0.32] });
    return out;
  }
  if (r < 0.355) {
    put(0, 0.85, 0, GRASS_TUFT[2], { mat: 'leaves', shape: 'blob', s: [0.9, 0.7, 0.9] });
    if (rng() < 0.4) put(0.25, 1.05, 0.2, '#ff5e5e', { mat: 'cloth', shape: 'orb', s: 0.25 }); // berries
    return out;
  }
  if (r < 0.37 && fbm(seed + 303, x / 10, z / 10) > 0.5) {
    // mushrooms near the woods
    for (const [ox, oz, s] of [[0, 0, 1], [0.3, 0.25, 0.7]]) {
      put(ox, 0.5 + 0.2 * s, oz, '#f3ead6', { mat: 'plaster', shape: 'pillar', s: [0.25 * s, 0.4 * s, 0.25 * s] });
      put(ox, 0.5 + 0.4 * s, oz, '#e8524a', { mat: 'cloth', shape: 'dome', s: [0.6 * s, 0.3 * s, 0.6 * s] });
    }
    return out;
  }
  return null;
}
