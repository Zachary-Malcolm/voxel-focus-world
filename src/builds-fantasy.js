// Phase 7: cozy fantasy buildings and small decor. Same rules as builds.js: the front faces +z,
// y=1 stands on the grass, the front door sits at x=0 (roads start in front of it), `deco: 1`
// marks ground details that don't need land underneath. Long scaled shapes count towards the
// spacing rect by their longest side, so long beams are laid as unit pieces.

import { Grid, C, S, W, N, E, pick, stoneFn, rockFn } from './builds.js';

const BRICK = ['#c9785a', '#bf6f52', '#d08463'];

/** Round-ish wall: a square ring without corners, plus pillars that round the corners off. */
function roundWall(g, r, y0, y1, color, o = {}, cx = 0, cz = 0) {
  const k = r >= 2 ? r - 0.4 : 0.62;
  for (let y = y0; y <= y1; y++) {
    for (let x = -r; x <= r; x++)
      for (let z = -r; z <= r; z++) {
        const edge = Math.abs(x) === r || Math.abs(z) === r;
        if (edge && !(Math.abs(x) === r && Math.abs(z) === r)) g.put(cx + x, y, cz + z, color, o);
      }
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.put(cx + sx * k, y, cz + sz * k, color, { ...o, shape: 'pillar', s: [1.05, 1, 1.05] });
  }
}

/** A little toadstool: stem + cap. */
function toadstool(g, x, z, cap, stem, h = 0.7, w = 0.9, extra = {}) {
  g.set(x, 0.5 + h / 2, z, stem, { mat: 'plaster', shape: 'pillar', s: [w * 0.38, h, w * 0.38], deco: 1 });
  g.set(x, 0.5 + h + 0.15, z, cap, { mat: 'plaster', shape: 'dome', s: [w, w * 0.55, w], deco: 1, ...extra });
}

function flowers(g, rng, pts) {
  for (const [x, z] of pts) {
    g.set(x, 0.85, z, pick(rng, C.leaves), { mat: 'leaves', shape: 'blob', s: 0.62, deco: 1 });
    for (const d of [-0.18, 0.18]) g.set(x + d, 1.12, z - d, pick(rng, C.flowers), { mat: 'cloth', shape: 'orb', s: 0.55, deco: 1 });
  }
}

// ------------------------------------------------------------------ homes

function mushroomhouse(rng) {
  const g = new Grid(rng);
  const cap = pick(rng, ['#e0473f', '#e98b3a', '#9b6ad6', '#4f8de0', '#d94f7c']);
  const stem = pick(rng, ['#f3ead8', '#efe2c8', '#f6eee2']);
  roundWall(g, 1, 1, 3, stem, { mat: 'plaster' });
  g.door(0, 1, 1, S, '#8a5a35', { step: '#b5bcc6' });
  g.window(1, 2, 0, E, { shutter: cap });
  g.window(-1, 2, 0, W, { box: '#8a5a35' });
  g.window(0, 3, -1, N, {});
  // gills, then the big spotted cap
  g.set(0, 3.75, 0, '#eadcc0', { mat: 'plaster', shape: 'pillar', s: [4.6, 0.5, 4.6] });
  g.set(0, 4.1, 0, '#efe0c6', { mat: 'plaster', shape: 'pillar', s: [7.6, 0.3, 7.6] });
  const R = 0.53 * 6;
  const H = 3.2;
  const yb = 4.0;
  g.set(0, yb + H / 2, 0, cap, { mat: 'plaster', shape: 'dome', s: [6, H, 6] });
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + rng() * 0.4;
    if (Math.abs(a - Math.PI / 2) < 0.45) continue; // keep the round window clear
    const t = 0.25 + rng() * 0.85;
    const cr = Math.cos(t) * R * 0.97;
    const s = 1.1 + rng() * 0.6;
    g.set(Math.cos(a) * cr, yb + Math.sin(t) * H * 0.97, Math.sin(a) * cr, '#fff8ee', { mat: 'plaster', shape: 'orb', s: [s, s * 0.7, s] });
  }
  g.set(0, yb + H - 0.02, 0, '#fff8ee', { mat: 'plaster', shape: 'orb', s: [1.8, 0.8, 1.8] });
  // round attic window in the cap
  g.set(0, 5.0, 2.98, '#8a5a35', { mat: 'wood', shape: 'orb', s: [2.6, 2.6, 0.7] });
  g.set(0, 5.0, 3.06, C.glass, { mat: 'glass', shape: 'orb', s: [2, 2, 0.7] });
  // crooked stove pipe
  g.set(1.2, 7.3, -0.8, '#8d8f99', { mat: 'metal', shape: 'pillar', s: [0.5, 1.6, 0.5] });
  g.set(1.2, 8.15, -0.8, '#6d7480', { mat: 'metal', shape: 'pillar', s: [0.7, 0.2, 0.7] });
  g.meta.smoke = [[1.2, 8.5, -0.8]];
  // garden: baby toadstools, flowers, stepping stones
  toadstool(g, -2, 1.7, cap, stem);
  toadstool(g, 2.1, 1.3, cap, stem, 0.5, 0.7);
  toadstool(g, -1.9, -1.6, cap, stem, 0.9, 1.1);
  flowers(g, rng, [[1.8, -1.6], [2.2, 2.3]]);
  g.set(0.25, 0.62, 2.95, '#a7afba', { mat: 'stone', shape: 'slab', s: [0.7, 0.25, 0.6], deco: 1 });
  return g.out();
}

function treehouse(rng) {
  const g = new Grid(rng);
  const bark = '#7a5434';
  const leaves = rng() < 0.75 ? C.leaves : ['#f4a43a', '#e9892b', '#f8c450'];
  const hut = pick(rng, ['#b98a5c', '#a7794c', '#c9a06a']);
  const roof = pick(rng, ['#c4643c', '#3e6fd6', '#5d9b4a', '#8a5bc4']);
  const deck = '#a7794c';
  // trunk and roots
  for (let y = 1; y <= 5; y++) g.set(0, y, 0, bark, { mat: 'log', shape: 'pillar', s: [1.9 - 0.08 * y, 1, 1.9 - 0.08 * y] });
  for (let r = 0; r < 4; r++) g.rel(0, 1, 0, r, 0, -0.15, 0.95, bark, { mat: 'log', shape: 'wedge', s: [0.55, 0.7, 0.8], deco: 1 });
  // stilts and deck
  for (const x of [-1.8, 1.8]) for (const z of [-1.8, 1.8]) for (let y = 1; y <= 4; y++) g.set(x, y, z, bark, { mat: 'log', shape: 'pillar', s: [0.55, 1, 0.55] });
  g.box(-2, 2, 5, 5, -2, 2, deck, { mat: 'wood', shape: 'slab' });
  g.railing(-2, 2, 5.5, -2, 2, '#8d6748', (x, z) => x === 0 && z === 2);
  // ladder up the front
  for (let y = 1; y <= 5; y++) for (const x of [-0.32, 0.32]) g.set(x, y, 2.65, C.timber, { mat: 'wood', shape: 'post', s: [0.6, 1, 0.6], deco: y === 1 ? 1 : undefined });
  for (let y = 1; y <= 4.6; y += 0.6) g.set(0, y, 2.65, '#8d6748', { mat: 'wood', shape: 'beam', s: [0.62, 0.6, 0.6] });
  // the hut
  for (let y = 6; y <= 9; y++) g.set(0, y, 0, bark, { mat: 'log', shape: 'pillar', s: [1, 1, 1] });
  g.ring(-1, 1, 6, 7, -1, 1, hut, { mat: 'wood' });
  for (const x of [-1, 1]) for (const z of [-1, 1]) g.box(x, x, 6, 7, z, z, C.timber, { mat: 'log' });
  g.door(0, 6, 1, S, '#6b4428', { lamp: false });
  g.window(1, 7, 0, E, { shutter: roof });
  g.window(-1, 7, 0, W, { shutter: roof });
  g.window(0, 7, -1, N, {});
  g.gable(-2, 2, 8, -2, 2, roof, { ends: [-1, 1], endColor: hut, endMat: 'wood' });
  for (const x of [-2, 2]) g.set(x, 6.15, 2, C.lantern, { mat: 'lantern', shape: 'orb', s: 0.75 });
  // the tree carries on through the roof into a big canopy
  for (let y = 11; y <= 12; y++) g.set(0, y, -0.3, bark, { mat: 'log', shape: 'pillar', s: [0.8, 1, 0.8] });
  for (const [x, y, z, s] of [
    [0, 12.6, -0.6, 3.0],
    [-1.9, 11.3, -1.2, 2.2],
    [1.9, 11.5, -1.0, 2.2],
    [-1.4, 12.3, 1.1, 1.9],
    [1.5, 12.1, 1.1, 1.9],
    [0, 13.8, 0, 2.0],
    [-2.4, 10.3, 0.5, 1.5],
    [2.4, 10.5, -0.2, 1.6],
  ])
    g.set(x, y, z, pick(rng, leaves), { mat: 'leaves', shape: 'blob', s });
  // rope swing from a side branch
  g.set(2.6, 8.8, 0.6, bark, { mat: 'log', shape: 'logx', s: [2.2, 0.55, 0.55] });
  for (const z of [0.38, 0.82]) g.set(3.1, 7.4, z, '#d8c9a3', { mat: 'cloth', shape: 'post', s: [0.4, 2.7, 0.4] });
  g.set(3.1, 6.0, 0.6, '#8d6748', { mat: 'wood', s: [0.6, 0.12, 0.7] });
  // a bird box on the trunk
  g.set(0, 3, 0.95, '#c9a06a', { mat: 'wood', s: [0.45, 0.5, 0.4] });
  g.set(0, 3.05, 1.17, '#2b2b2b', { mat: 'plaster', shape: 'orb', s: [0.4, 0.4, 0.15] });
  g.set(0, 3.38, 0.95, roof, { mat: 'roof', shape: 'cone', s: [0.85, 0.35, 0.85] });
  flowers(g, rng, [[-2.6, 2.4], [2.5, 2.5]]);
  return g.out();
}

// ------------------------------------------------------------------ crafts + farming

function greenhouse(rng) {
  const g = new Grid(rng);
  const frame = pick(rng, ['#f4f1ea', '#e9f2ee', '#3f6f5a']);
  const pane = '#d8f3ec';
  const brick = () => ({ color: pick(rng, BRICK), mat: 'brick' });
  g.ring(-2, 2, 1, 1, -3, 2, brick);
  g.ring(-2, 2, 2, 3, -3, 2, pane, { mat: 'glass' });
  g.door(0, 1, 2, S, frame === '#3f6f5a' ? '#2f5545' : '#5fae7d', { step: '#b5bcc6' });
  // white frame: a post on every seam, unit beams along the top of the walls
  const post = { mat: 'metal', shape: 'post', s: [0.5, 2, 0.5] };
  for (let x = -2.5; x <= 2.5; x += 1) for (const z of [-3.5, 2.5]) g.set(x, 2.5, z, frame, post);
  for (let z = -2.5; z <= 1.5; z += 1) for (const x of [-2.5, 2.5]) g.set(x, 2.5, z, frame, post);
  for (let x = -2; x <= 2; x++) for (const z of [-3.5, 2.5]) g.set(x, 3.55, z, frame, { mat: 'metal', shape: 'beam', s: [1, 0.5, 0.5] });
  for (let z = -3; z <= 2; z++) for (const x of [-2.5, 2.5]) g.set(x, 3.55, z, frame, { mat: 'metal', shape: 'beam', r: 1, s: [1, 0.5, 0.5] });
  g.gable(-2, 2, 4, -3, 2, pane, { axis: 'z', mat: 'glass', ends: [-3, 2], endColor: pane, endMat: 'glass' });
  for (let z = -3; z <= 2; z++) g.set(0, 6.05, z, frame, { mat: 'metal', shape: 'beam', r: 1, s: [1, 0.6, 0.6] });
  for (const z of [-3, 2]) g.set(0, 6.35, z, C.gold, { mat: 'gold', shape: 'orb', s: 0.5 });
  // beds of plants inside, a path down the middle and a little lemon tree at the back
  for (const x of [-1, 1])
    for (let z = -2; z <= 1; z++) {
      g.set(x, 1.25, z, '#8d6748', { mat: 'wood', shape: 'slab', s: [0.9, 1.3, 0.9] });
      const r = rng();
      if (r < 0.4) g.set(x, 1.75, z, pick(rng, C.leaves), { mat: 'leaves', shape: 'blob', s: 0.75 });
      else if (r < 0.75) {
        g.set(x, 1.6, z, pick(rng, C.leaves), { mat: 'leaves', shape: 'blob', s: 0.5 });
        for (const d of [-0.2, 0.2]) g.set(x + d, 1.95, z + d, pick(rng, C.flowers), { mat: 'cloth', shape: 'orb', s: 0.6 });
      } else {
        g.set(x, 1.9, z, '#3f9a4a', { mat: 'leaves', shape: 'post', s: [0.9, 1.4, 0.9] });
        g.set(x + 0.15, 2.1, z, '#ff5e5e', { mat: 'cloth', shape: 'orb', s: 0.6 });
        g.set(x - 0.15, 1.8, z + 0.1, '#ff5e5e', { mat: 'cloth', shape: 'orb', s: 0.5 });
      }
    }
  for (let z = -1; z <= 1; z++) g.set(0, 1, z, pick(rng, C.stone), { mat: 'stone', shape: 'slab' });
  for (let y = 1; y <= 2; y++) g.set(0, y, -2, '#8a5a35', { mat: 'log', shape: 'pillar', s: [0.4, 1, 0.4] });
  g.set(0, 3, -2, pick(rng, C.leaves), { mat: 'leaves', shape: 'blob', s: 1.3 });
  for (const [x, y, z] of [[0.6, 3.1, -1.7], [-0.5, 2.8, -1.6], [0.2, 3.6, -1.5]]) g.set(x, y, z, '#ffe45c', { mat: 'cloth', shape: 'orb', s: 0.6 });
  // water butt and pots outside
  g.set(-3, 1, 1.2, '#8d6748', { mat: 'wood', shape: 'pillar', s: [0.85, 1, 0.85], deco: 1 });
  g.set(-3, 1.5, 1.2, '#4fb3f0', { mat: 'water', shape: 'pillar', s: [0.75, 0.1, 0.75], deco: 1 });
  for (const [x, z] of [[2.9, -1], [2.9, 0.3]]) {
    g.set(x, 0.8, z, '#c9785a', { mat: 'brick', shape: 'pillar', s: [0.6, 0.6, 0.6], deco: 1 });
    g.set(x, 1.25, z, pick(rng, C.flowers), { mat: 'cloth', shape: 'orb', s: 0.9, deco: 1 });
  }
  return g.out();
}

function blacksmith(rng) {
  const g = new Grid(rng);
  const wall = pick(rng, ['#e8dcc6', '#e2d6c2', '#d9d2c4']);
  const roof = pick(rng, ['#4b505c', '#5a4a42', '#3c4f6b']);
  const brick = () => ({ color: pick(rng, ['#9e5a45', '#a8624a', '#8f5240']), mat: 'brick' });
  g.ring(-2, 2, 1, 2, -2, 2, stoneFn(rng));
  g.ring(-2, 2, 3, 3, -2, 2, C.timber, { mat: 'wood' });
  g.ring(-2, 2, 4, 4, -2, 2, wall, { mat: 'plaster' });
  for (const x of [-2, 2]) for (const z of [-2, 2]) g.box(x, x, 3, 4, z, z, C.timber, { mat: 'log' });
  g.door(0, 1, 2, S, '#4a3426', { step: '#8d8f99' });
  g.window(1, 2, 2, S, {});
  g.window(2, 2, 0, E, {});
  g.window(0, 4, 2, S, { shutter: '#7a4b2a', box: C.timber });
  g.window(2, 4, 0, E, { shutter: '#7a4b2a' });
  g.window(0, 4, -2, N, {});
  g.gable(-3, 3, 5, -3, 3, roof, { ends: [-2, 2], endColor: wall });
  g.window(2, 6, 0, E, {});
  // open forge under a lean-to on the west side
  for (const z of [-2, 2]) g.box(-4, -4, 1, 2, z, z, C.timber, { mat: 'log', shape: 'pillar' });
  for (let z = -2; z <= 2; z++) {
    g.set(-3, 4, z, roof, { mat: 'roof', shape: 'wedge', r: W });
    g.set(-4, 3, z, roof, { mat: 'roof', shape: 'wedge', r: W });
  }
  g.box(-3, -3, 1, 1, -2, -1, brick);
  g.set(-3, 1.62, -1.5, '#ff8a3a', { mat: 'lantern', shape: 'orb', s: [2.4, 0.9, 2.6] }); // glowing coals
  for (let y = 2; y <= 8; y++) g.set(-3, y, -2, pick(rng, ['#9e5a45', '#a8624a']), { mat: 'brick' });
  g.set(-3, 9, -2, '#8d8f99', { mat: 'stone', shape: 'slab', s: [1.25, 1, 1.25] });
  g.meta.smoke = [[-3, 9.6, -2]];
  // anvil, quench barrel, tools on the wall
  g.set(-3, 0.95, 1, C.iron, { mat: 'metal', shape: 'post', s: [1.6, 0.9, 1.6], deco: 1 });
  g.set(-3, 1.57, 1, '#4b525d', { mat: 'metal', s: [0.45, 0.35, 0.9], deco: 1 });
  g.set(-4, 0.95, 0, '#8d6748', { mat: 'wood', shape: 'pillar', s: [0.8, 0.9, 0.8], deco: 1 });
  g.set(-4, 1.42, 0, '#4fb3f0', { mat: 'water', shape: 'pillar', s: [0.7, 0.08, 0.7], deco: 1 });
  for (const [z, h] of [[-0.4, 1.4], [0, 1.1], [0.4, 1.3]]) g.set(-2.6, 2.4, z, C.iron, { mat: 'metal', shape: 'post', s: [0.4, h, 0.4] });
  // hanging sign with an anvil on it
  g.set(2, 3.3, 2.9, C.timber, { mat: 'wood', shape: 'beam', r: 1, s: [1, 1, 1] });
  g.set(2, 2.75, 3.2, '#d6a86c', { mat: 'wood', shape: 'pane', r: 1, s: [0.9, 0.8, 0.5] });
  for (const x of [1.9, 2.1]) g.set(x, 2.72, 3.2, '#3b4250', { mat: 'metal', shape: 'pane', r: 1, s: [0.5, 0.25, 0.7] });
  // a crate of iron bars by the door
  g.set(-1.4, 0.9, 2.8, '#a7794c', { mat: 'wood', s: [0.8, 0.8, 0.8], deco: 1 });
  for (const dx of [-0.2, 0.2]) g.set(-1.4 + dx, 1.38, 2.8, '#8d96a3', { mat: 'metal', shape: 'slab', s: [0.3, 0.3, 0.7], deco: 1 });
  return g.out();
}

function stable(rng) {
  const g = new Grid(rng);
  const [wall, roof] = pick(rng, [
    ['#b5523b', '#5a4a42'],
    ['#8a5a3c', '#3e6fd6'],
    ['#c9a06a', '#b5523b'],
    ['#7a8f5a', '#5a4a42'],
  ]);
  const trim = '#f4efe4';
  g.ring(-3, 3, 1, 1, -2, 2, stoneFn(rng));
  g.ring(-3, 3, 2, 4, -2, 2, wall, { mat: 'wood' });
  for (const x of [-3, 3]) for (const z of [-2, 2]) g.box(x, x, 1, 4, z, z, trim, { mat: 'log' });
  g.door(0, 1, 2, S, trim, { step: '#a7afba' });
  g.set(0, 3.25, 2.58, '#9aa2ad', { mat: 'metal', shape: 'arch', s: [0.45, 0.45, 0.15] }); // lucky horseshoe
  for (const x of [-1, 1]) g.window(x, 2, 2, S, { shutter: trim });
  // two stalls with half doors and a horse looking out of each
  const coats = ['#8a5a35', '#3d2b1f', '#e8e0d0', '#b07a45', '#6b6b6b'];
  for (const x of [-2, 2]) {
    const coat = pick(rng, coats);
    const mane = coat === '#e8e0d0' ? '#b5a58a' : '#2b2018';
    g.del(x, 1, 2);
    g.del(x, 2, 2);
    g.set(x, 1, 2.15, trim, { mat: 'wood', shape: 'pane', s: [0.92, 1, 1] });
    g.set(x, 2, 1, '#2e2219', { mat: 'wood' }); // the dark stall behind
    for (const d of [-0.47, 0.47]) g.set(x + d, 2, 2.3, trim, { mat: 'wood', shape: 'post', s: [0.5, 1, 0.6] });
    g.set(x, 2.2, 1.95, coat, { mat: 'cloth', s: [0.4, 0.62, 0.5] });
    g.set(x, 2.45, 2.4, coat, { mat: 'cloth', s: [0.44, 0.44, 0.75] });
    g.set(x, 2.3, 2.86, coat === '#3d2b1f' ? '#5a4030' : '#d9c8b4', { mat: 'cloth', s: [0.36, 0.32, 0.34] });
    for (const d of [-0.12, 0.12]) g.set(x + d, 2.76, 2.22, coat, { mat: 'cloth', shape: 'post', s: [0.35, 0.4, 0.35] });
    for (const d of [-0.23, 0.23]) g.set(x + d, 2.55, 2.5, '#2b2b2b', { mat: 'plaster', shape: 'orb', s: [0.18, 0.2, 0.18] });
    g.set(x, 2.66, 2.0, mane, { mat: 'cloth', shape: 'pane', s: [0.15, 0.4, 1.8] });
  }
  // hay loft: windows and a hatch over the door
  for (const x of [-2, 2]) g.window(x, 4, 2, S, {});
  g.set(0, 4, 2.15, '#5a3f2a', { mat: 'wood', shape: 'pane', s: [0.92, 0.9, 1] });
  for (const x of [-2, 2]) g.window(x, 3, -2, N, {});
  g.window(3, 2, 0, E, { shutter: trim });
  g.gable(-4, 4, 5, -3, 3, roof, { ends: [-3, 3], endColor: wall, endMat: 'wood' });
  // hay door and hoist on the east gable
  g.set(3, 6, 0, '#5a3f2a', { mat: 'wood' });
  g.set(3.56, 6, 0, trim, { mat: 'wood', shape: 'pane', r: 1, s: [0.9, 0.95, 0.5] });
  g.set(3.5, 5.75, 0.05, '#e3c35a', { mat: 'thatch', shape: 'blob', s: [0.6, 0.45, 0.6] });
  g.set(3.7, 7.05, 0, C.timber, { mat: 'wood', shape: 'beam', s: [1.4, 1.2, 1.2] });
  g.set(4.2, 6.3, 0, '#d8c9a3', { mat: 'cloth', shape: 'post', s: [0.25, 1.4, 0.25] });
  g.set(4.2, 5.45, 0, '#e3c35a', { mat: 'thatch', s: [0.6, 0.45, 0.5] });
  // cupola with a weathervane on the ridge
  g.set(0, 8.5, 0, trim, { mat: 'wood', s: [1.2, 1, 1.2] });
  for (const r of [S, W, N, E]) g.rel(0, 8.5, 0, r, 0, 0, 0.62, '#3d2b1f', { mat: 'wood', shape: 'pane', s: [0.7, 0.6, 0.3] });
  g.set(0, 9.5, 0, roof, { mat: 'roof', shape: 'cone', s: [2.2, 1, 2.2] });
  g.set(0, 10.3, 0, C.iron, { mat: 'metal', shape: 'post', s: [0.4, 0.8, 0.4] });
  g.set(0.15, 10.55, 0, C.gold, { mat: 'gold', shape: 'pane', s: [0.9, 0.35, 0.3] });
  // water trough and hay bales
  g.set(-2.5, 0.85, 3.1, '#8d6748', { mat: 'wood', s: [1.6, 0.6, 0.7], deco: 1 });
  g.set(-2.5, 1.18, 3.1, '#4fb3f0', { mat: 'water', s: [1.4, 0.06, 0.5], deco: 1 });
  g.set(2.6, 0.85, 3.1, '#e3c35a', { mat: 'thatch', s: [1, 0.7, 0.7], deco: 1 });
  g.set(2.45, 1.5, 3.05, '#d9b45a', { mat: 'thatch', s: [0.9, 0.6, 0.65], deco: 1 });
  return g.out();
}

function granary(rng) {
  const g = new Grid(rng);
  const wall = pick(rng, ['#c4925a', '#b98a5c', '#d1a46c']);
  const thatch = pick(rng, ['#d9b45a', '#cfa24c', '#e0bf6a']);
  // staddle stones lift the store off the ground, away from the mice
  for (const x of [-2, 0, 2])
    for (const z of [-2, 0, 2]) {
      g.set(x, 1, z, pick(rng, C.stone), { mat: 'stone', shape: 'pillar', s: [0.65, 1, 0.65] });
      g.set(x, 1.75, z, pick(rng, C.stone), { mat: 'stone', shape: 'dome', s: [1.3, 0.5, 1.3] });
    }
  g.box(-2, 2, 2.5, 2.5, -2, 2, '#9b6a43', { mat: 'wood', shape: 'slab' });
  g.ring(-2, 2, 3, 5, -2, 2, wall, { mat: 'wood' });
  for (const x of [-2, 2]) for (const z of [-2, 2]) g.box(x, x, 3, 5, z, z, C.timber, { mat: 'log' });
  g.door(0, 3, 2, S, C.door, { lamp: true });
  // steps up to the door
  g.set(0, 1, 3, '#8d6748', { mat: 'wood', deco: 1 });
  g.set(0, 2, 3, '#b98a5c', { mat: 'wood', shape: 'stair', deco: 1 });
  g.set(0, 1, 4, '#b98a5c', { mat: 'wood', shape: 'stair', deco: 1 });
  g.window(2, 4, 0, E, { shutter: '#7a4b2a' });
  g.window(-2, 4, 0, W, { shutter: '#7a4b2a' });
  g.window(0, 4, -2, N, {});
  g.window(0, 5, 2, S, {});
  g.hip(-3, 3, 6, -3, 3, thatch, {
    mat: 'thatch',
    cap: (x, y) => {
      g.set(x, y + 0.6, 0, '#e8c25a', { mat: 'thatch', shape: 'cone', s: [0.8, 1, 0.8] });
      g.set(x, y + 1.2, 0, C.gold, { mat: 'gold', shape: 'orb', s: 0.45 });
    },
  });
  // hoist with a sack on the east side
  g.set(3.2, 5.4, 0, C.timber, { mat: 'wood', shape: 'beam', s: [1.4, 1.2, 1.2] });
  g.set(3.6, 4.5, 0, '#d8c9a3', { mat: 'cloth', shape: 'post', s: [0.2, 1.5, 0.2] });
  g.set(3.6, 3.5, 0, '#e8dcc0', { mat: 'cloth', shape: 'blob', s: [0.6, 0.75, 0.6] });
  // sacks and pumpkins by the steps
  for (const [x, z] of [[-1.3, 3], [-1.7, 2.7]]) g.set(x, 0.95, z, '#e2d4b5', { mat: 'cloth', shape: 'blob', s: [0.6, 0.75, 0.6], deco: 1 });
  for (const [x, z, s] of [[1.4, 3.1, 0.9], [1.9, 2.7, 0.7]]) g.set(x, 0.5 + s * 0.25, z, '#f08a2a', { mat: 'cloth', shape: 'dome', s: [s, s * 0.6, s], deco: 1 });
  return g.out();
}

// ------------------------------------------------------------------ village life

function tavern(rng) {
  const g = new Grid(rng);
  const wall = pick(rng, ['#f4e7cf', '#f6efe0', '#efe0c4']);
  const roof = pick(rng, ['#b5523b', '#4f6a8a', '#5a7a4a', '#8c5a3c']);
  const accent = pick(rng, ['#3fa36b', '#d9534a', '#4f9de8']);
  // ground floor: stone footing, tall plaster walls in a timber frame
  g.ring(-3, 3, 1, 1, -2, 2, stoneFn(rng));
  g.ring(-3, 3, 2, 3, -2, 2, wall, { mat: 'plaster' });
  for (const x of [-3, 3]) for (const z of [-2, 2]) g.box(x, x, 1, 3, z, z, C.timber, { mat: 'log' });
  g.door(0, 1, 2, S, '#5a3a22', { lamp: false, step: '#b5bcc6' });
  g.set(0, 3, 2, C.timber, { mat: 'wood' });
  for (const x of [-2, -1, 1, 2]) g.window(x, 2, 2, S, Math.abs(x) === 2 ? { box: C.timber } : {});
  for (const x of [-3, 3]) g.window(x, 2, 0, x > 0 ? E : W, { shutter: accent });
  g.window(-1, 2, -2, N, {});
  // porch posts holding up the overhanging upper floor
  for (const x of [-3, -1.5, 1.5, 3]) g.set(x, 2, 3, C.timber, { mat: 'wood', shape: 'post', s: [1.4, 3, 1.4] });
  for (const x of [-1.5, 1.5]) g.set(x, 2.9, 3.32, C.lantern, { mat: 'lantern', shape: 'orb', s: 0.7 });
  // upper floor, jettied out over the porch
  g.ring(-3, 3, 4, 4, -2, 3, C.timber, { mat: 'wood' });
  g.ring(-3, 3, 5, 6, -2, 3, wall, { mat: 'plaster' });
  for (const x of [-3, 3]) for (const z of [-2, 3]) g.box(x, x, 4, 6, z, z, C.timber, { mat: 'log' });
  for (const x of [-1, 1]) g.box(x, x, 5, 6, 3, 3, C.timber, { mat: 'wood' });
  for (const x of [-2, 0, 2]) g.window(x, 5, 3, S, { shutter: accent, box: C.timber });
  for (const x of [-3, 3]) for (const z of [-1, 1]) g.window(x, 5, z, x > 0 ? E : W, {});
  g.window(0, 5, -2, N, {});
  g.gable(-4, 4, 7, -3, 4, roof, { ends: [-3, 3], endColor: wall });
  for (const x of [-3, 3]) g.window(x, 8, 1, x > 0 ? E : W, {});
  // dormers on the front slope
  for (const x of [-2, 2]) {
    g.window(x, 8, 3, S, {});
    g.set(x, 9, 3, roof, { mat: 'roof', shape: 'wedge' });
  }
  // two chimneys
  for (const x of [-2, 2]) {
    for (let y = 9; y <= 11; y++) g.set(x, y, -1, pick(rng, BRICK), { mat: 'brick' });
    g.set(x, 12, -1, '#8d8f99', { mat: 'stone', shape: 'slab', s: [1.25, 1, 1.25] });
  }
  g.meta.smoke = [[-2, 12.6, -1], [2, 12.6, -1]];
  // sign board over the door with a frothy mug
  g.set(0, 3.1, 2.62, '#d6a86c', { mat: 'wood', shape: 'pane', s: [2.6, 0.7, 0.5] });
  g.set(0, 3.05, 2.75, '#f2c14e', { mat: 'gold', s: [0.28, 0.32, 0.15] });
  g.set(0, 3.3, 2.78, '#fff8ee', { mat: 'cloth', shape: 'orb', s: [1.1, 0.5, 0.4] });
  // a table and stools out front, and a barrel
  g.set(-2.2, 0.95, 4, '#8d6748', { mat: 'wood', shape: 'post', s: [0.8, 0.9, 0.8], deco: 1 });
  g.set(-2.2, 1.42, 4, '#b98a5c', { mat: 'wood', s: [1.1, 0.12, 0.8], deco: 1 });
  for (const x of [-2.9, -1.5]) g.set(x, 0.78, 4, '#8d6748', { mat: 'wood', shape: 'pillar', s: [0.5, 0.55, 0.5], deco: 1 });
  for (const x of [-2.45, -1.95]) g.set(x, 1.6, 4, '#f2c14e', { mat: 'gold', s: [0.18, 0.24, 0.18], deco: 1 });
  g.set(2.4, 1, 4, '#9b6a43', { mat: 'wood', shape: 'pillar', s: [0.85, 1, 0.85], deco: 1 });
  for (const y of [0.75, 1.25]) g.set(2.4, y, 4, '#5d6470', { mat: 'metal', shape: 'pillar', s: [0.9, 0.08, 0.9], deco: 1 });
  return g.out();
}

function chapel(rng) {
  const g = new Grid(rng);
  const s = () => ({ color: pick(rng, ['#e8e2d4', '#dcd5c5', '#efe9dc']), mat: 'stone' });
  const slate = pick(rng, ['#5d6b8a', '#4f6a63', '#7a4e5a', '#6a5d7f']);
  const glass = ['#6fa8ff', '#ff7a8a', '#ffd166', '#8be08b', '#b48cff'];
  g.ring(-2, 2, 1, 1, -2, 2, rockFn(rng));
  g.ring(-2, 2, 2, 4, -2, 2, s);
  for (const x of [-2, 2])
    for (const z of [-1, 1]) {
      const c = pick(rng, glass);
      g.window(x, 2, z, x > 0 ? E : W, { glass: c });
      g.window(x, 3, z, x > 0 ? E : W, { glass: c });
    }
  for (const x of [-3, 3])
    for (const z of [-2, 0, 2]) {
      g.box(x, x, 1, 2, z, z, s);
      g.set(x, 3, z, '#d8d0bc', { mat: 'stone', shape: 'wedge', r: x > 0 ? E : W });
    }
  // rounded apse at the back with its own little dome
  for (let y = 1; y <= 3; y++) {
    g.put(0, y, -3, s);
    for (const x of [-1, 1]) g.put(x * 0.8, y, -2.9, s, { shape: 'pillar', s: [1.1, 1, 1.1] });
  }
  g.window(0, 2, -3, N, { glass: pick(rng, glass) });
  g.set(0, 4.6, -2.8, slate, { mat: 'roof', shape: 'dome', s: [3.2, 2.2, 3.2] });
  g.gable(-3, 3, 5, -2, 3, slate, { axis: 'z', ends: [-2, 2], endColor: s, endMat: 'stone' });
  // bell tower over the door, with a rose window and a tall spire
  g.ring(-1, 1, 1, 7, 2, 4, s);
  g.door(0, 1, 4, S, '#5a3a22', { step: '#b5bcc6' });
  g.set(0, 3, 4, '#e2dac6', { mat: 'stone', shape: 'arch' });
  g.rel(0, 5, 4, S, 0, 0, 0.45, pick(rng, glass), { mat: 'glass', shape: 'orb', s: [2.2, 2.2, 0.8] });
  g.clear(-1, 1, 8, 9, 2, 4);
  for (const x of [-1, 1]) for (const z of [2, 4]) g.box(x, x, 8, 9, z, z, '#e2dac6', { mat: 'stone', shape: 'pillar' });
  g.set(0, 8.6, 3, C.gold, { mat: 'gold', shape: 'dome', s: [1.1, 1.1, 1.1] });
  g.set(0, 9.4, 3, C.timber, { mat: 'wood', shape: 'beam', s: [3, 1, 1] });
  g.box(-1, 1, 10, 10, 2, 4, '#d8d0bc', { mat: 'stone', shape: 'slab', s: [1.1, 1, 1.1] });
  g.set(0, 12.2, 3, slate, { mat: 'roof', shape: 'spire', s: [3, 4.4, 3] });
  g.set(0, 14.6, 3, C.gold, { mat: 'gold', shape: 'orb', s: 0.5 });
  // lamp posts and flowers
  for (const x of [-2, 2]) {
    g.set(x, 1.7, 4, '#3b4250', { mat: 'metal', shape: 'post', s: [0.9, 2.4, 0.9] });
    g.set(x, 3.05, 4, C.lantern, { mat: 'lantern', shape: 'orb', s: 0.8 });
  }
  flowers(g, rng, [[-3, -1], [3, -1], [-3, 1], [3, 1]]);
  return g.out();
}

function library(rng) {
  const g = new Grid(rng);
  const s = () => ({ color: pick(rng, ['#ece5d4', '#e2dac6', '#f2ecdf']), mat: 'stone' });
  const roof = pick(rng, ['#4f8f87', '#3c5aa8', '#7a4e8f', '#8a3b3b']);
  const col = '#f6f1e6';
  g.ring(-3, 3, 1, 1, -2, 2, rockFn(rng));
  g.ring(-3, 3, 2, 4, -2, 2, s);
  // portico: platform, columns, entablature, pediment
  g.box(-3, 3, 1, 1, 3, 3, s, { shape: 'slab' });
  for (const x of [-2.5, -0.9, 0.9, 2.5]) for (const y of [1.5, 2.5, 3.5]) g.set(x, y, 3, col, { mat: 'stone', shape: 'pillar', s: [0.85, 1, 0.85] });
  g.box(-3, 3, 4, 4, 3, 3, col, { mat: 'stone', shape: 'topslab' });
  g.door(0, 1, 2, S, '#5a3a22', { lamp: false });
  g.set(0, 3, 2, col, { mat: 'stone', shape: 'arch' });
  for (const x of [-2, 2]) for (const y of [2, 3]) g.window(x, y, 2, S, {});
  for (const x of [-3, 3]) for (const z of [-1, 1]) for (const y of [2, 3]) g.window(x, y, z, x > 0 ? E : W, {});
  for (const x of [-1, 1]) g.window(x, 3, -2, N, {});
  g.gable(-3, 3, 5, -3, 3, roof, { axis: 'z', ends: [-2, 3], endColor: s, endMat: 'stone' });
  g.set(0, 6, 3.45, C.glass, { mat: 'glass', shape: 'orb', s: [2, 2, 0.6] });
  // reading-room drum and dome on the ridge, with a telescope poking out
  roundWall(g, 1, 8, 8, col, { mat: 'stone' });
  for (const [x, z, r] of [[0, 1, S], [0, -1, N], [1, 0, E], [-1, 0, W]]) g.window(x, 8, z, r, {});
  g.set(0, 9.8, 0, roof, { mat: 'roof', shape: 'dome', s: [3.4, 2.6, 3.4] });
  g.set(0, 11.25, 0, C.gold, { mat: 'gold', shape: 'spire', s: [0.5, 0.8, 0.5] });
  g.set(0, 11.75, 0, C.gold, { mat: 'gold', shape: 'orb', s: 0.45 });
  g.set(1.6, 9.7, 0, '#c9a24a', { mat: 'gold', shape: 'logx', s: [1.4, 0.4, 0.4] });
  g.set(2.32, 9.7, 0, C.glass, { mat: 'glass', shape: 'orb', s: 0.6 });
  // steps, lamps, a pile of books and a globe on the portico
  for (let x = -1; x <= 1; x++) g.set(x, 0.75, 4, pick(rng, C.stone), { mat: 'stone', shape: 'slab', s: [1, 0.5, 1], deco: 1 });
  for (const x of [-2, 2]) {
    g.set(x, 1.7, 4, '#3b4250', { mat: 'metal', shape: 'post', s: [0.9, 2.4, 0.9] });
    g.set(x, 3.05, 4, C.lantern, { mat: 'lantern', shape: 'orb', s: 0.8 });
  }
  ['#c4443c', '#3e6fd6', '#3fa36b', '#f2a33a'].forEach((c, i) =>
    g.set(1.7 + (i & 1) * 0.06, 1.15 + i * 0.15, 3.2, c, { mat: 'cloth', shape: 'slab', s: [0.6, 0.3, 0.45], r: i & 1, deco: 1 }),
  );
  g.set(-1.7, 1.3, 3.2, C.gold, { mat: 'gold', shape: 'post', s: [0.6, 0.6, 0.6], deco: 1 });
  g.set(-1.7, 1.85, 3.2, '#4f9de8', { mat: 'cloth', shape: 'orb', s: 1.3 });
  for (const x of [-3, 3]) g.set(x * 1.12, 1.05, -2.4, pick(rng, C.leaves), { mat: 'leaves', shape: 'blob', s: 0.95, deco: 1 });
  return g.out();
}

function wizardtower(rng) {
  const g = new Grid(rng);
  const stone = ['#a9a3c8', '#9d97bd', '#b3aed1'];
  const st = () => ({ color: pick(rng, stone), mat: 'stone' });
  const hat = pick(rng, ['#5b3c8c', '#2f4f8f', '#7a2f5a', '#2f6b5a']);
  const glow = pick(rng, ['#9b7bff', '#5fe0ff', '#7dffb0', '#ff8ad8']);
  const plaster = pick(rng, ['#efe6f7', '#e6eef7', '#f3ead6']);
  const trim = '#6b4a2f';
  // ground floor: a round stone tower
  roundWall(g, 2, 1, 1, rockFn(rng));
  roundWall(g, 2, 2, 5, st);
  g.door(0, 1, 2, S, hat, { step: '#8d8f99' });
  g.set(0, 3, 2, pick(rng, stone), { mat: 'stone', shape: 'arch' });
  g.window(0, 4, 2, S, { glass: glow });
  g.window(2, 3, 0, E, { glass: glow });
  g.window(-2, 4, 0, W, { glass: glow });
  g.window(0, 4, -2, N, { glass: glow });
  for (const [x, y, z] of [[1, 2.6, 2.55], [-1, 3.4, 2.55], [2.55, 4.6, -1], [-2.55, 2.4, 1]]) g.set(x, y, z, glow, { mat: 'crystal', shape: 'orb', s: 0.55 });
  // balcony
  g.set(0, 5.75, 0, '#8d6748', { mat: 'wood', shape: 'pillar', s: [5.8, 0.5, 5.8] });
  for (let x = -2; x <= 2; x++)
    for (let z = -2; z <= 2; z++)
      if ((Math.abs(x) === 2) !== (Math.abs(z) === 2)) g.set(x, 6.45, z, trim, { mat: 'wood', shape: 'fence', r: Math.abs(x) === 2 ? 1 : 0 });
  // first floor: plaster study with a door onto the balcony
  roundWall(g, 1, 6.5, 7.5, plaster, { mat: 'plaster' });
  roundWall(g, 1, 8.5, 8.5, trim, { mat: 'wood' });
  g.door(0, 6.5, 1, S, hat, { lamp: false });
  g.window(1, 7.5, 0, E, { glass: glow });
  g.window(-1, 7.5, 0, W, { glass: glow });
  g.window(0, 7.5, -1, N, { glass: glow });
  g.set(1.6, 7.7, -1.3, '#8d8f99', { mat: 'metal', shape: 'pillar', s: [0.4, 3.4, 0.4] });
  g.meta.smoke = [[1.6, 9.8, -1.3]];
  // a wide floor, then the crooked top room
  g.set(0, 9.25, 0, '#8d6748', { mat: 'wood', shape: 'pillar', s: [4.6, 0.5, 4.6] });
  const cx = -0.25;
  const cz = 0.2;
  roundWall(g, 1, 10, 11, st, {}, cx, cz);
  g.window(cx, 11, cz + 1, S, { glass: glow });
  g.window(cx + 1, 10, cz, E, { glass: glow });
  g.window(cx - 1, 11, cz, W, { glass: glow });
  // the pointy hat: brim, band, cone, bent tip, stars
  g.set(cx, 11.6, cz, hat, { mat: 'cloth', shape: 'pillar', s: [5.4, 0.3, 5.4] });
  g.set(cx, 12.0, cz, C.gold, { mat: 'gold', shape: 'pillar', s: [4.5, 0.35, 4.5] });
  g.set(cx, 13.8, cz, hat, { mat: 'cloth', shape: 'cone', s: [2.8, 4.2, 2.8] });
  g.set(0.25, 16.3, 0.55, hat, { mat: 'cloth', shape: 'cone', s: [1.1, 1.6, 1.1] });
  g.set(0.5, 17.2, 0.7, C.gold, { mat: 'gold', shape: 'orb', s: 0.6 });
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + rng() * 0.6;
    const h = 0.6 + rng() * 2.4;
    const r = 1.74 * (1 - h / 4.2) + 0.06;
    g.set(cx + Math.cos(a) * r, 11.7 + h, cz + Math.sin(a) * r, C.gold, { mat: 'gold', shape: 'orb', s: 0.5 });
  }
  // a floating crystal, a bubbling cauldron, glowing toadstools
  g.set(2.6, 8.2, 1.6, glow, { mat: 'crystal', shape: 'orb', s: 1.6 });
  g.set(2.2, 9.1, 1.9, glow, { mat: 'crystal', shape: 'orb', s: 0.6 });
  g.set(-2.6, 0.9, 2, '#3b4250', { mat: 'metal', shape: 'pillar', s: [1.1, 0.75, 1.1], deco: 1 });
  g.set(-2.6, 1.28, 2, glow, { mat: 'crystal', shape: 'pillar', s: [0.9, 0.1, 0.9], deco: 1 });
  g.set(-2.5, 1.5, 2.1, glow, { mat: 'crystal', shape: 'orb', s: 0.5, deco: 1 });
  toadstool(g, 2.4, -1.8, glow, '#efe6f7', 0.5, 0.7, { mat: 'crystal' });
  toadstool(g, -2.3, -1.5, glow, '#efe6f7', 0.7, 0.8, { mat: 'crystal' });
  toadstool(g, 2.1, 2.4, glow, '#efe6f7', 0.4, 0.6, { mat: 'crystal' });
  return g.out();
}

// ------------------------------------------------------------------ decor (bought with coins, no session)

function lamp(rng) {
  const g = new Grid(rng);
  const iron = pick(rng, ['#3b4250', '#2f4f3f', '#4a3a5a']);
  g.set(0, 0.75, 0, '#8d8f99', { mat: 'stone', shape: 'pillar', s: [0.8, 0.5, 0.8] });
  g.set(0, 1.9, 0, iron, { mat: 'metal', shape: 'post', s: [0.8, 1.9, 0.8] });
  g.set(0, 2.88, 0, iron, { mat: 'metal', shape: 'pillar', s: [0.75, 0.08, 0.75] });
  g.set(0, 3.15, 0, C.lantern, { mat: 'lantern', s: [0.45, 0.5, 0.45] });
  g.set(0, 3.6, 0, iron, { mat: 'metal', shape: 'cone', s: [0.95, 0.45, 0.95] });
  g.set(0, 3.92, 0, iron, { mat: 'metal', shape: 'orb', s: 0.4 });
  if (rng() < 0.5) g.set(0.2, 1.1, 0.2, pick(rng, C.flowers), { mat: 'cloth', shape: 'orb', s: 0.6 });
  return g.out();
}

function bench(rng) {
  const g = new Grid(rng);
  const wood = pick(rng, ['#b98a5c', '#a7794c', '#8d6748', '#d9c3a0']);
  const leg = pick(rng, ['#3b4250', C.timber]);
  for (const x of [-0.3, 1.3]) {
    g.set(x, 0.74, 0, leg, { mat: 'metal', shape: 'post', s: [0.6, 0.48, 1.7] });
    g.set(x, 1.2, -0.24, leg, { mat: 'metal', shape: 'post', s: [0.6, 1, 0.6] });
  }
  g.set(0.5, 1.02, 0, wood, { mat: 'wood', s: [1.9, 0.12, 0.6] });
  for (const y of [1.3, 1.52]) g.set(0.5, y, -0.26, wood, { mat: 'wood', s: [1.9, 0.14, 0.08] });
  return g.out();
}

function fence(rng) {
  const g = new Grid(rng);
  const c = pick(rng, ['#8d6748', '#f4efe4', '#a7794c']);
  for (let x = -1; x <= 1; x++) g.set(x, 1, 0, c, { mat: 'wood', shape: 'fence' });
  for (const x of [-1.45, 1.45]) g.set(x, 1, 0, c, { mat: 'wood', shape: 'post', s: [1, 1.05, 1] });
  if (rng() < 0.4) g.set(0.6, 0.8, 0.35, pick(rng, C.flowers), { mat: 'cloth', shape: 'orb', s: 0.6 });
  return g.out();
}

function flowerbed(rng) {
  const g = new Grid(rng);
  const edge = pick(rng, ['#8d6748', '#a7afba', '#c9785a']);
  const mat = edge === '#a7afba' ? 'stone' : edge === '#c9785a' ? 'brick' : 'wood';
  const theme = pick(rng, [C.flowers, ['#ff6f91', '#ff9fb8', '#ffffff'], ['#6fc3ff', '#c77dff', '#ffffff'], ['#ffd34d', '#ff9f43', '#ff6f6f']]);
  for (let x = -1; x <= 1; x++) {
    g.set(x, 0.85, 0, edge, { mat, shape: 'slab', s: [1, 0.7, 1] });
    g.set(x, 0.9, 0, '#6b4a2f', { mat: 'dirt', shape: 'slab', s: [0.82, 0.2, 0.82] });
    g.set(x, 1.12, 0, pick(rng, C.leaves), { mat: 'leaves', shape: 'blob', s: 0.6 });
    for (const [dx, dz] of [[-0.25, -0.2], [0.22, 0.18], [0.05, -0.05]]) g.set(x + dx, 1.32 + rng() * 0.12, dz, pick(rng, theme), { mat: 'cloth', shape: 'orb', s: 0.62 });
  }
  return g.out();
}

function farmplot(rng) {
  const g = new Grid(rng);
  const crop = pick(rng, ['wheat', 'cabbage', 'pumpkin', 'carrot']);
  for (let x = -1; x <= 1; x++)
    for (let z = -1; z <= 1; z++) {
      g.set(x, 0.7, z, '#7a5434', { mat: 'dirt', shape: 'slab', s: [0.95, 0.4, 0.95] });
      if (crop === 'wheat') for (const dx of [-0.25, 0.25]) for (const dz of [-0.25, 0.25]) g.set(x + dx, 1.05, z + dz, '#e8c25a', { mat: 'thatch', shape: 'post', s: [0.7, 0.75, 0.7] });
      else if (crop === 'cabbage') g.set(x, 0.92, z, pick(rng, ['#7ccf5a', '#5fb84a']), { mat: 'leaves', shape: 'blob', s: 0.62 });
      else if (crop === 'pumpkin') {
        g.set(x, 0.9, z, '#f08a2a', { mat: 'cloth', shape: 'dome', s: [0.7, 0.5, 0.7] });
        g.set(x, 1.18, z, '#4f8a3c', { mat: 'leaves', shape: 'post', s: [0.4, 0.25, 0.4] });
      } else for (const dz of [-0.25, 0.25]) g.set(x, 0.95, z + dz, '#5fb84a', { mat: 'leaves', shape: 'cone', s: [0.45, 0.5, 0.45] });
    }
  if (rng() < 0.5) {
    // a scarecrow keeps watch over the middle
    g.set(0, 1.55, 0, C.timber, { mat: 'wood', shape: 'post', s: [0.7, 2.1, 0.7] });
    g.set(0, 1.95, 0, C.timber, { mat: 'wood', shape: 'beam', s: [1.4, 0.7, 0.7] });
    g.set(0, 1.75, 0, pick(rng, ['#e85d5d', '#4f9de8', '#4fbf7a']), { mat: 'cloth', s: [0.45, 0.5, 0.25] });
    g.set(0, 2.35, 0, '#e8dcc0', { mat: 'cloth', s: [0.32, 0.32, 0.3] });
    g.set(0, 2.62, 0, '#d9b45a', { mat: 'thatch', shape: 'cone', s: [0.9, 0.35, 0.9] });
  }
  return g.out();
}

export const FANTASY_BUILDERS = {
  mushroomhouse,
  greenhouse,
  blacksmith,
  stable,
  granary,
  treehouse,
  tavern,
  chapel,
  library,
  wizardtower,
  lamp,
  bench,
  fence,
  flowerbed,
  farmplot,
};
