import { mulberry32, hash2 } from './rng.js';
import { jitterColor } from './voxels.js';

const GRASS = ['#74c94f', '#68bf45', '#7fd15a'];
const DIRT = '#b07a4f';
const STONE = ['#97a0ad', '#8a93a1', '#a3abb7'];

/**
 * Floating island: flat grass top at y=0, tapering into a rocky underside.
 * Every column is generated from its own hash, so growing the radius only adds blocks at the rim
 * and underneath; existing grass keeps its exact look. Returns blocks plus the top cells ("x,z").
 */
export function generateIsland(radius, seed) {
  const rng = mulberry32(seed);
  const blocks = [];
  const topCells = new Set();
  addLump(blocks, seed, 1, radius, 0, 0, 0, topCells);

  // Two little satellite rocks so the main island reads as "floating".
  const a1 = rng() * Math.PI * 2;
  const far = radius + 5;
  addLump(blocks, seed, 2, 1.6, Math.round(Math.cos(a1) * far), -3, Math.round(Math.sin(a1) * far));
  const a2 = a1 + Math.PI * (0.7 + rng() * 0.5);
  addLump(blocks, seed, 3, 1.2, Math.round(Math.cos(a2) * (far + 1)), 2, Math.round(Math.sin(a2) * (far + 1)));

  return { blocks, topCells };
}

function addLump(blocks, seed, salt, radius, cx, cy, cz, topCells) {
  const shape = mulberry32(hash2(seed, salt));
  const p1 = shape() * 6.28;
  const p2 = shape() * 6.28;
  const edge = (angle) => radius + 0.55 * Math.sin(3 * angle + p1) + 0.4 * Math.sin(5 * angle + p2);
  // Depth scales gently with size so a grown island gets a deeper rock tail.
  const maxDepth = Math.max(2, Math.round(Math.min(radius, 9) * 1.15 + Math.max(0, radius - 9) * 0.5));
  const R = Math.ceil(radius + 1);

  // Column depths first, so blocks buried on every side can be skipped: a big island is mostly
  // hidden rock, and leaving it out keeps the block count (and phones) happy.
  const depths = new Map();
  const cols = [];
  for (let x = -R; x <= R; x++) {
    for (let z = -R; z <= R; z++) {
      const d = Math.hypot(x, z);
      const e = edge(Math.atan2(z, x));
      if (d > e) continue;
      const cell = mulberry32(hash2(hash2(seed, salt * 7919), (x + 512) * 1024 + (z + 512)));
      const t = 1 - d / e;
      const depth = 2 + Math.round(Math.pow(t, 1.25) * maxDepth * 1.5 + cell() * 1.4);
      const dirt = 1 + (cell() < 0.5 ? 1 : 0);
      depths.set(`${x},${z}`, depth);
      cols.push([x, z, depth, dirt]);
    }
  }
  const depthAt = (x, z) => depths.get(`${x},${z}`) || 0;

  for (const [x, z, depth, dirt] of cols) {
    // k = 0 (grass) and 1 (the bed under water) always show; deeper ones only on a side or the bottom
    const shallowest = Math.min(depthAt(x + 1, z), depthAt(x - 1, z), depthAt(x, z + 1), depthAt(x, z - 1));
    for (let k = 0; k < depth; k++) {
      if (k >= 2 && k < depth - 1 && k < shallowest) continue;
      // per-block colour draws come from their own stream so depth changes never shift them
      const c = mulberry32(hash2(hash2(seed, salt), (x + 512) * 1048576 + (z + 512) * 1024 + k));
      let color;
      let mat;
      if (k === 0) (color = GRASS[Math.floor(c() * GRASS.length)]), (mat = 'grass');
      else if (k <= dirt) (color = DIRT), (mat = 'dirt');
      else (color = STONE[Math.floor(c() * STONE.length)]), (mat = 'rock');
      blocks.push({ x: cx + x, y: cy - k, z: cz + z, color: jitterColor(color, c), mat });
    }
    if (topCells) topCells.add(`${x},${z}`);
  }
}
