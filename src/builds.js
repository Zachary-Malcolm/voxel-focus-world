// Every blueprint in the game. Front of every building faces +z; y=1 stands on the grass.
// Blocks carry kit fields (mat, shape, r, s; see kit.js). `deco: 1` marks small details at
// ground level that should not count towards the land a building needs underneath it.
// Changing a builder changes every saved copy of that building (they are rebuilt from
// kind + variant), so keep footprints about the same size when editing.

export const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];
const r2 = (v) => Math.round(v * 100) / 100;

// facings: which way a wall's outside points. Same numbers as block r.
export const S = 0; // +z (front)
export const W = 1; // -x
export const N = 2; // -z
export const E = 3; // +x

export function turn(x, z, r) {
  switch (r & 3) {
    case 0:
      return [x, z];
    case 1:
      return [-z, x];
    case 2:
      return [-x, -z];
    default:
      return [z, -x];
  }
}

export const C = {
  stone: ['#b5bcc6', '#a7afba', '#c1c7d0'],
  rock: ['#8f97a3', '#9aa2ad', '#868e9a'],
  bark: '#7a5434',
  timber: '#6b4a2f',
  door: '#6b4428',
  glass: '#c9ecf7',
  lantern: '#ffd36b',
  gold: '#ffcf45',
  iron: '#5d6470',
  flowers: ['#ff6f91', '#ffd34d', '#c77dff', '#ff9f43', '#ffffff', '#6fc3ff'],
  flags: ['#ff5a5a', '#ffcf3a', '#4ecbff', '#b06bff', '#4fd18b'],
  leaves: ['#4fae3c', '#409c31', '#62c04a'],
};

/** Sparse grid of blocks: later writes win; out() sorts into a satisfying drop order. */
export class Grid {
  constructor(rng) {
    this.rng = rng;
    this.m = new Map();
    this.meta = {};
  }
  set(x, y, z, color, o) {
    x = r2(x);
    y = r2(y);
    z = r2(z);
    this.m.set(`${x},${y},${z}`, { x, y, z, color, ...o });
  }
  del(x, y, z) {
    this.m.delete(`${r2(x)},${r2(y)},${r2(z)}`);
  }
  has(x, y, z) {
    return this.m.has(`${r2(x)},${r2(y)},${r2(z)}`);
  }
  /** color may be a value or fn(x,y,z) returning a colour or { color, ...fields }. */
  put(x, y, z, color, o) {
    const v = typeof color === 'function' ? color(x, y, z) : color;
    if (v && typeof v === 'object' && 'color' in v) {
      const { color: c, ...rest } = v;
      this.set(x, y, z, c, { ...o, ...rest });
    } else this.set(x, y, z, v, o);
  }
  box(x0, x1, y0, y1, z0, z1, color, o) {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) this.put(x, y, z, color, o);
  }
  /** Walls only: the outline of the box on each layer. */
  ring(x0, x1, y0, y1, z0, z1, color, o) {
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) if (x === x0 || x === x1 || z === z0 || z === z1) this.put(x, y, z, color, o);
  }
  clear(x0, x1, y0, y1, z0, z1) {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) this.del(x, y, z);
  }
  /** Place relative to a wall cell whose outside faces r: dx to the right, dy up, dz outwards. */
  rel(x, y, z, r, dx, dy, dz, color, o = {}) {
    const [ox, oz] = turn(dx, dz, r);
    this.set(x + ox, y + dy, z + oz, color, { ...o, r: ((o.r || 0) + r) % 4 });
  }

  /** Glass in a wall cell, with optional shutters and a flower box. */
  window(x, y, z, r, { shutter, box, glass = C.glass } = {}) {
    this.set(x, y, z, glass, { mat: 'glass' });
    if (shutter) for (const s of [-1, 1]) this.rel(x, y, z, r, s * 0.74, 0, 0.56, shutter, { mat: 'wood', shape: 'pane', s: [0.48, 0.92, 0.5], deco: 1 });
    if (box) {
      this.rel(x, y, z, r, 0, -0.55, 0.62, box, { mat: 'wood', shape: 'beam', s: [1.05, 0.9, 1.4], deco: 1 });
      for (const d of [-0.3, 0, 0.3]) this.rel(x, y, z, r, d, -0.36, 0.64, pick(this.rng, C.flowers), { mat: 'cloth', shape: 'orb', s: 0.5, deco: 1 });
    }
  }

  /** A recessed plank door two cells tall, with a lantern beside it. */
  door(x, y, z, r, color = C.door, { lamp = true, step = null } = {}) {
    this.del(x, y, z);
    this.del(x, y + 1, z);
    for (const dy of [0, 1]) this.rel(x, y + dy, z, r, 0, 0, 0.18, color, { mat: 'wood', shape: 'pane', s: [0.92, 1, 1] });
    this.rel(x, y + 1, z, r, 0.32, -0.55, 0.36, C.gold, { mat: 'gold', shape: 'orb', s: 0.22, deco: 1 }); // handle
    if (lamp) this.rel(x, y + 1, z, r, 0.86, 0.15, 0.66, C.lantern, { mat: 'lantern', shape: 'orb', s: 0.7, deco: 1 });
    if (step) this.rel(x, y, z, r, 0, 0, 1, step, { mat: 'stone', shape: 'slab', s: [1, 1, 0.9], deco: 1 });
  }

  /**
   * Pitched roof of wedges. axis 'x' = ridge along x (slopes face ±z). Extents include the overhang.
   * ends: wall planes (x for axis 'x', z for axis 'z') whose triangles get filled with endColor.
   */
  gable(x0, x1, y0, z0, z1, color, { axis = 'x', mat = 'roof', ends = [], endColor, endMat = 'plaster' } = {}) {
    const [a0, a1, b0, b1] = axis === 'x' ? [x0, x1, z0, z1] : [z0, z1, x0, x1];
    const at = (a, b) => (axis === 'x' ? [a, b] : [b, a]);
    const lo = axis === 'x' ? N : W; // slope facing towards b0
    const hi = axis === 'x' ? S : E;
    for (let k = 0; ; k++) {
      const bl = b0 + k;
      const bh = b1 - k;
      if (bl > bh) break;
      const y = y0 + k;
      for (let a = a0; a <= a1; a++) {
        if (bl === bh) {
          const [x, z] = at(a, bl);
          this.set(x, y, z, color, { mat, shape: 'slab' });
        } else {
          const [xl, zl] = at(a, bl);
          const [xh, zh] = at(a, bh);
          this.set(xl, y, zl, color, { mat, shape: 'wedge', r: lo });
          this.set(xh, y, zh, color, { mat, shape: 'wedge', r: hi });
        }
      }
      if (endColor)
        for (const e of ends)
          for (let b = bl + 1; b <= bh - 1; b++) {
            const [x, z] = at(e, b);
            this.put(x, y, z, endColor, { mat: endMat });
          }
    }
  }

  /** Hipped roof (slopes on all four sides). layers limits how many rings are laid. cap: top block. */
  hip(x0, x1, y0, z0, z1, color, { mat = 'roof', layers = 99, cap } = {}) {
    for (let k = 0; k < layers; k++) {
      const xa = x0 + k;
      const xb = x1 - k;
      const za = z0 + k;
      const zb = z1 - k;
      if (xa > xb || za > zb) break;
      const y = y0 + k;
      if (xa === xb || za === zb) {
        for (let x = xa; x <= xb; x++) for (let z = za; z <= zb; z++) this.set(x, y, z, color, { mat, shape: 'slab' });
        if (cap) cap(xa, y, za, xb, zb);
        break;
      }
      for (let x = xa + 1; x < xb; x++) {
        this.set(x, y, za, color, { mat, shape: 'wedge', r: N });
        this.set(x, y, zb, color, { mat, shape: 'wedge', r: S });
      }
      for (let z = za + 1; z < zb; z++) {
        this.set(xa, y, z, color, { mat, shape: 'wedge', r: W });
        this.set(xb, y, z, color, { mat, shape: 'wedge', r: E });
      }
      this.set(xb, y, zb, color, { mat, shape: 'corner', r: 0 });
      this.set(xa, y, zb, color, { mat, shape: 'corner', r: 1 });
      this.set(xa, y, za, color, { mat, shape: 'corner', r: 2 });
      this.set(xb, y, za, color, { mat, shape: 'corner', r: 3 });
    }
  }

  /** A railing of fence pieces around the outline of a rectangle at height y. */
  railing(x0, x1, y, z0, z1, color, skip = () => false) {
    for (let x = x0; x <= x1; x++)
      for (const z of [z0, z1]) if (!skip(x, z)) this.set(x, y, z, color, { mat: 'wood', shape: 'fence', r: 0 });
    for (let z = z0 + 1; z < z1; z++) for (const x of [x0, x1]) if (!skip(x, z)) this.set(x, y, z, color, { mat: 'wood', shape: 'fence', r: 1 });
  }

  /** Little flag on a pole, top of the pole at (x, y, z). */
  flag(x, y, z, color) {
    this.set(x, y - 0.6, z, C.timber, { mat: 'wood', shape: 'post', s: [0.5, 1.6, 0.5] });
    this.set(x + 0.5, y - 0.1, z, color, { mat: 'cloth', shape: 'pane', s: [0.9, 0.55, 0.4] });
    this.set(x, y + 0.25, z, C.gold, { mat: 'gold', shape: 'orb', s: 0.35 });
  }

  out() {
    const arr = [...this.m.values()];
    for (const b of arr) {
      for (const k of Object.keys(b)) if (b[k] === undefined) delete b[k];
      if (b.r === 0) delete b.r;
    }
    // bottom-up, each layer laid around in a ring; spinning parts go on last
    arr.sort((a, b) => (a.spin ? 1 : 0) - (b.spin ? 1 : 0) || Math.round(a.y * 2) - Math.round(b.y * 2) || Math.atan2(a.z, a.x) - Math.atan2(b.z, b.x));
    return Object.assign(arr, this.meta);
  }
}

export const stoneFn = (rng, mat = 'stone') => () => ({ color: pick(rng, C.stone), mat });
export const rockFn = (rng) => () => ({ color: pick(rng, C.rock), mat: 'rock' });

// ------------------------------------------------------------------ nature

function tree(rng) {
  const g = new Grid(rng);
  const roll = rng();
  const kind = roll < 0.42 ? 'oak' : roll < 0.64 ? 'blossom' : roll < 0.8 ? 'autumn' : 'pine';
  const pal = {
    oak: C.leaves,
    blossom: ['#f6a3c0', '#f08cb1', '#ffc3d7'],
    autumn: ['#f4a43a', '#e9892b', '#f8c450'],
    pine: ['#2f8a4a', '#2a7a42', '#38995a'],
  }[kind];
  const bark = kind === 'blossom' ? '#6e4a3a' : '#8a5a35';
  const h = (kind === 'pine' ? 2 : 3) + Math.floor(rng() * 2);
  for (let y = 1; y <= h; y++) {
    const w = 0.8 - 0.06 * (y - 1);
    g.set(0, y, 0, bark, { mat: 'log', shape: 'pillar', s: [w, 1, w] });
  }
  for (let r = 0; r < 4; r++) if (rng() < 0.75) g.rel(0, 1, 0, r, 0, -0.2, 0.48, bark, { mat: 'log', shape: 'wedge', s: [0.34, 0.6, 0.5], deco: 1 });
  if (kind === 'pine') {
    for (let i = 0; i < 4; i++) {
      const w = (3.6 - 0.8 * i) / 1.24;
      g.set(0, h + 0.4 + i * 1.05, 0, pal[i % 3], { mat: 'leaves', shape: 'cone', s: [w, 1.5, w] });
    }
    return g.out();
  }
  const top = h + 1.3;
  g.set(0, top, 0, pal[0], { mat: 'leaves', shape: 'blob', s: 2.5 });
  const n = 5 + Math.floor(rng() * 3);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rng() * 0.5;
    const d = 1 + rng() * 0.35;
    g.set(Math.cos(a) * d, top - 0.5 + rng() * 1.1, Math.sin(a) * d, pick(rng, pal), { mat: 'leaves', shape: 'blob', s: 1.3 + rng() * 0.5 });
  }
  g.set(0, top + 1.15, 0, pick(rng, pal), { mat: 'leaves', shape: 'blob', s: 1.6 });
  const fruit = kind === 'oak' && rng() < 0.45 ? '#ff4f4f' : kind === 'blossom' ? '#ffffff' : null;
  if (fruit)
    for (let i = 0; i < 6; i++) {
      const a = rng() * Math.PI * 2;
      const e = rng() * 1.1 - 0.3;
      g.set(Math.cos(a) * 1.75, top + e, Math.sin(a) * 1.75, fruit, { mat: 'cloth', shape: 'orb', s: 0.55 });
    }
  return g.out();
}

// ------------------------------------------------------------------ homes

function house(rng) {
  const g = new Grid(rng);
  const p = pick(rng, [
    { wall: '#f4e7cf', roof: '#d9534a', trim: '#7a5434', shut: '#4f9de8' },
    { wall: '#dceef3', roof: '#3e6fd6', trim: '#6b4a2f', shut: '#e85d5d' },
    { wall: '#ffe3a3', roof: '#3fa36b', trim: '#7a5434', shut: '#3fa36b' },
    { wall: '#f6d0c0', roof: '#5b5f73', trim: '#5e4030', shut: '#5b8a5f' },
    { wall: '#efe6f7', roof: '#8a5bc4', trim: '#6b4a2f', shut: '#f2a33a' },
  ]);
  const thatch = rng() < 0.3;
  const roofMat = thatch ? 'thatch' : 'roof';
  const roof = thatch ? '#d9b45a' : p.roof;
  g.ring(-2, 2, 1, 1, -2, 2, stoneFn(rng));
  g.ring(-2, 2, 2, 2, -2, 2, p.wall, { mat: 'plaster' });
  g.ring(-2, 2, 3, 3, -2, 2, p.trim, { mat: 'wood' });
  g.ring(-2, 2, 4, 4, -2, 2, p.wall, { mat: 'plaster' });
  for (const x of [-2, 2]) for (const z of [-2, 2]) g.box(x, x, 2, 4, z, z, p.trim, { mat: 'log' });
  g.door(0, 1, 2, S, C.door, { step: '#b5bcc6' });
  for (const x of [-1, 1]) g.window(x, 2, 2, S, { box: p.trim });
  g.window(2, 2, 0, E, { shutter: p.shut });
  g.window(-2, 2, 0, W, { shutter: p.shut });
  g.window(0, 2, -2, N, { shutter: p.shut });
  g.window(0, 4, 2, S, { shutter: p.shut, box: p.trim });
  g.window(1, 4, -2, N, {});
  // porch roof over the door
  for (const x of [-1, 0, 1]) g.set(x, 3, 3, roof, { mat: roofMat, shape: 'wedge' });
  for (const x of [-1, 1]) g.set(x, 1.5, 3, p.trim, { mat: 'wood', shape: 'post', s: [1, 2, 1], deco: 1 });
  g.gable(-3, 3, 5, -3, 3, roof, { mat: roofMat, ends: [-2, 2], endColor: p.wall });
  g.window(2, 6, 0, E, {});
  g.window(-2, 6, 0, W, {});
  // chimney through the back slope
  for (let y = 7; y <= 9; y++) g.set(1, y, -1, '#b0644c', { mat: 'brick' });
  g.set(1, 10, -1, '#8d8f99', { mat: 'stone', shape: 'slab', s: [1.25, 1, 1.25] });
  g.meta.smoke = [[1, 10.6, -1]];
  for (const x of [-2, 2]) if (rng() < 0.7) g.set(x, 1.1, 3, pick(rng, C.leaves), { mat: 'leaves', shape: 'blob', s: 0.9, deco: 1 });
  return g.out();
}

function tower(rng) {
  const g = new Grid(rng);
  const H = 5 + Math.floor(rng() * 2);
  const roof = pick(rng, ['#3e6fd6', '#c4443c', '#3fa36b', '#7b56c9']);
  const flag = pick(rng, C.flags);
  g.box(-1, 1, 1, 1, -1, 1, rockFn(rng));
  g.ring(-1, 1, 2, H, -1, 1, stoneFn(rng));
  g.door(0, 1, 1, S);
  g.window(0, H - 1, -1, N, {});
  g.window(1, H - 2, 0, E, {});
  g.window(-1, 3, 0, W, {});
  // corbels under the balcony
  // joists poking out under the balcony
  for (const r of [S, W, N, E]) for (const d of [-0.6, 0.6]) g.rel(0, H, 0, r, d, 0.3, 1.75, '#8d6748', { mat: 'wood', shape: 'beam', s: [1.6, 1, 1], r: 1 });
  g.box(-2, 2, H + 1, H + 1, -2, 2, '#b98a5c', { mat: 'wood', shape: 'slab' });
  g.railing(-2, 2, H + 1.5, -2, 2, '#8d6748');
  for (const x of [-2, 2]) for (const z of [-2, 2]) g.set(x, H + 2.5, z, C.timber, { mat: 'wood', shape: 'post', s: [1, 1.05, 1] });
  g.set(0, H + 2.3, 0, C.lantern, { mat: 'lantern', shape: 'orb', s: 1.3 }); // watch fire
  g.set(0, H + 4.5, 0, roof, { mat: 'roof', shape: 'cone', s: [4.7, 3, 4.7] });
  g.flag(0, H + 6.6, 0, flag);
  return g.out();
}

// ------------------------------------------------------------------ village

function well(rng) {
  const g = new Grid(rng);
  const roof = pick(rng, ['#d9534a', '#3e6fd6', '#3fa36b', '#8a5bc4']);
  g.ring(-1, 1, 1, 1, -1, 1, stoneFn(rng));
  g.set(0, 1, 0, '#4fb3f0', { mat: 'water', shape: 'slab', s: [1, 1.4, 1] });
  for (const [x, z] of [[-1, -1], [0, -1], [1, -1], [-1, 1], [0, 1], [1, 1]]) g.set(x, 2, z, pick(rng, C.stone), { mat: 'stone', shape: 'slab' });
  for (const x of [-1, 1]) g.box(x, x, 2, 3, 0, 0, C.timber, { mat: 'wood', shape: 'post' });
  g.set(0, 3.65, 0, C.timber, { mat: 'log', shape: 'beam', s: [3, 1.3, 1.3] });
  g.set(0, 3.05, 0, '#d8c9a3', { mat: 'cloth', shape: 'post', s: [0.25, 0.9, 0.25] });
  g.set(0, 2.45, 0, '#9b6a43', { mat: 'wood', shape: 'pillar', s: [0.55, 0.45, 0.55] });
  g.gable(-1, 1, 4, -1, 1, roof, {});
  g.set(-1.25, 1.75, 1.25, pick(rng, C.flowers), { mat: 'cloth', shape: 'orb', s: 0.5, deco: 1 });
  g.set(1.25, 1.75, -1.25, pick(rng, C.flowers), { mat: 'cloth', shape: 'orb', s: 0.5, deco: 1 });
  return g.out();
}

function stall(rng) {
  const g = new Grid(rng);
  const [a, b] = pick(rng, [
    ['#e85d5d', '#fff3e0'],
    ['#4f9de8', '#fff3e0'],
    ['#4fbf7a', '#fff8e6'],
    ['#f2a33a', '#fff8e6'],
  ]);
  const goods = ['#ff9f43', '#7ed957', '#ff5e5e', '#ffd34d', '#c77dff'];
  for (const x of [-2, 2]) {
    g.box(x, x, 1, 3, 1, 1, C.timber, { mat: 'wood', shape: 'post' });
    g.box(x, x, 1, 4, -1, -1, C.timber, { mat: 'wood', shape: 'post' });
  }
  g.box(-1, 1, 1, 1, 1, 1, '#c4925a', { mat: 'wood' });
  for (let x = -1; x <= 1; x++) for (const d of [-0.22, 0.22]) g.set(x + d, 1.78, 1 + (d > 0 ? 0.1 : -0.1), pick(rng, goods), { mat: 'cloth', shape: 'orb', s: 0.62 });
  g.set(-1, 0.95, -1, '#a7794c', { mat: 'wood', s: 0.9 });
  g.set(-1, 1.8, -1, '#b98a5c', { mat: 'wood', s: 0.7 });
  g.set(0.1, 0.95, -1, '#8d6748', { mat: 'wood', shape: 'pillar', s: [0.85, 0.9, 0.85] });
  g.set(1, 0.95, -1, '#a7794c', { mat: 'wood', s: 0.9 });
  g.set(1, 1.75, -1, pick(rng, goods), { mat: 'cloth', shape: 'blob', s: 0.7 });
  const stripe = (x) => ((x & 1) === 0 ? a : b);
  for (let x = -2; x <= 2; x++) {
    const c = stripe(x);
    g.set(x, 4, 1, c, { mat: 'cloth', shape: 'wedge' });
    g.set(x, 4, 0, c, { mat: 'cloth' });
    g.set(x, 4, -1, c, { mat: 'cloth' });
    g.set(x, 5, 0, c, { mat: 'cloth', shape: 'wedge' });
    g.set(x, 5, -1, c, { mat: 'cloth', shape: 'wedge' });
    g.set(x, 3.3, 1.55, c, { mat: 'cloth', shape: 'pane', s: [0.9, 0.4, 0.5] }); // valance
  }
  g.set(0, 5.9, -1, '#d6a86c', { mat: 'wood', shape: 'pane', s: [2.2, 0.8, 0.6] }); // sign
  g.set(2.1, 2.8, 1.6, C.lantern, { mat: 'lantern', shape: 'orb', s: 0.6 });
  return g.out();
}

function bakery(rng) {
  const g = new Grid(rng);
  const wall = pick(rng, ['#f7e3c4', '#f6d3cf', '#e9edd2']);
  const roof = pick(rng, ['#b5523b', '#8c5a3c', '#c9784f']);
  const brick = () => ({ color: pick(rng, ['#c9785a', '#bf6f52', '#d08463']), mat: 'brick' });
  g.ring(-2, 2, 1, 2, -2, 2, brick);
  g.ring(-2, 2, 3, 3, -2, 2, C.timber, { mat: 'wood' });
  g.ring(-2, 2, 4, 4, -2, 2, wall, { mat: 'plaster' });
  for (const x of [-2, 2]) for (const z of [-2, 2]) g.box(x, x, 3, 4, z, z, C.timber, { mat: 'log' });
  g.door(0, 1, 2, S, C.door, { step: '#b5bcc6' });
  for (const x of [-1, 1]) {
    g.window(x, 2, 2, S, {});
    g.window(x, 1, 2, S, {});
    g.set(x, 1.45, 2.66, '#e3a15a', { mat: 'cloth', shape: 'orb', s: [1.5, 0.75, 0.8], deco: 1 }); // loaves on show
  }
  // striped awning
  for (let x = -2; x <= 2; x++) g.set(x, 3, 3, (x & 1) === 0 ? '#e86a5d' : '#fff3e0', { mat: 'cloth', shape: 'wedge' });
  g.window(0, 4, 2, S, { shutter: '#e86a5d', box: C.timber });
  g.window(2, 4, 0, E, { shutter: '#e86a5d' });
  g.window(-2, 4, 0, W, { shutter: '#e86a5d' });
  g.window(-2, 2, 0, W, {});
  g.gable(-3, 3, 5, -3, 3, roof, { axis: 'z', ends: [-2, 2], endColor: wall });
  g.window(0, 6, 2, S, {});
  // brick bread oven on the side, with its own little flue
  g.set(3, 1.3, 0, '#c9785a', { mat: 'brick', shape: 'dome', s: [2, 1.6, 2], deco: 1 });
  g.set(3, 2.6, 0.3, '#8d8f99', { mat: 'metal', shape: 'pillar', s: [0.4, 1, 0.4] });
  // main chimney
  for (let y = 7; y <= 9; y++) g.set(-1, y, -1, '#a8503a', { mat: 'brick' });
  g.set(-1, 10, -1, '#8d8f99', { mat: 'stone', shape: 'slab', s: [1.25, 1, 1.25] });
  g.meta.smoke = [[-1, 10.6, -1], [3, 3.4, 0.3]];
  return g.out();
}

function windmill(rng) {
  const g = new Grid(rng);
  const body = pick(rng, ['#efe8dc', '#e9dcc8', '#f3ede4']);
  const cap = pick(rng, ['#5a4a42', '#3e6fd6', '#b5523b']);
  const cloth = pick(rng, ['#f6f0e4', '#fbe7d0', '#f2f2f2']);
  g.ring(-2, 2, 1, 1, -2, 2, rockFn(rng));
  for (const x of [-2, 2]) for (const z of [-2, 2]) g.del(x, 1, z);
  g.box(-1, 1, 1, 1, -1, 1, rockFn(rng));
  for (const [x, z] of [[-2, -1], [-2, 0], [-2, 1], [2, -1], [2, 0], [2, 1], [-1, -2], [0, -2], [1, -2], [-1, 2], [1, 2]])
    g.set(x, 2, z, pick(rng, C.stone), { mat: 'stone', shape: 'slab' });
  g.ring(-1, 1, 2, 8, -1, 1, body, { mat: 'plaster' });
  g.ring(-1, 1, 6, 6, -1, 1, '#b98a5c', { mat: 'wood' }); // timber band
  g.door(0, 2, 1, S, C.door, { lamp: true });
  g.window(0, 5, 1, S, { shutter: cap });
  g.window(1, 6, 0, E, {});
  g.window(-1, 4, 0, W, {});
  g.window(0, 7, -1, N, {});
  g.ring(-1, 1, 9, 9, -1, 1, C.timber, { mat: 'wood' });
  g.set(0, 10.7, 0, cap, { mat: 'roof', shape: 'dome', s: [3.4, 2.4, 3.4] });
  g.set(0, 12.1, 0, C.gold, { mat: 'gold', shape: 'orb', s: 0.5 });
  // sails: four long arms with cloth, all spin around the hub
  const P = [0, 7, 2];
  g.set(0, 7, 1.9, '#5d6470', { mat: 'metal', shape: 'orb', s: 1.3, spin: true });
  for (const [dx, dy] of [[0, 1], [1, 0], [0, -1], [-1, 0]]) {
    const vertical = dx === 0;
    g.set(dx * 2.5, 7 + dy * 2.5, 2.15, C.timber, { mat: 'wood', shape: vertical ? 'post' : 'beam', s: vertical ? [1.2, 4.8, 1.2] : [4.8, 1.2, 1.2], spin: true });
    g.set(dx * 3 + dy * 0.8, 7 + dy * 3 - dx * 0.8, 2.05, cloth, { mat: 'cloth', shape: 'pane', s: vertical ? [1.45, 3.4, 0.5] : [3.4, 1.45, 0.5], spin: true });
    // lattice slats across the cloth
    for (const t of [2, 3, 4]) g.set(dx * t + dy * 0.8, 7 + dy * t - dx * 0.8, 2.12, '#8d6748', { mat: 'wood', shape: vertical ? 'beam' : 'post', s: vertical ? [1.5, 0.6, 0.6] : [0.6, 1.5, 0.6], spin: true });
  }
  g.meta.spin = { pivot: P, axis: 'z' };
  g.set(1.6, 1.4, 2.3, '#e8dcc0', { mat: 'cloth', shape: 'blob', s: [0.7, 0.8, 0.7], deco: 1 }); // flour sacks
  g.set(-1.5, 1.35, 2.4, '#e2d4b5', { mat: 'cloth', shape: 'blob', s: [0.65, 0.7, 0.65], deco: 1 });
  return g.out();
}

function clocktower(rng) {
  const g = new Grid(rng);
  const brick = () => ({ color: pick(rng, ['#c9785a', '#bf6f52', '#d08463']), mat: 'brick' });
  const roof = pick(rng, ['#3c5aa8', '#2f7d5b', '#8a3b3b']);
  g.ring(-2, 2, 1, 2, -2, 2, stoneFn(rng));
  g.box(-1, 1, 1, 1, -1, 1, stoneFn(rng));
  g.door(0, 1, 2, S, C.door, { step: '#b5bcc6' });
  for (const [x, z, r] of [[2, 0, E], [-2, 0, W], [0, -2, N]]) g.window(x, 2, z, r, {});
  g.hip(-2, 2, 3, -2, 2, '#8d8f99', { mat: 'stone', layers: 1 });
  g.ring(-1, 1, 3, 10, -1, 1, brick);
  g.ring(-1, 1, 6, 6, -1, 1, C.gold, { mat: 'gold' });
  g.window(0, 4, 1, S, {});
  g.window(0, 4, -1, N, {});
  for (const r of [S, W, N, E]) {
    const [x, z] = turn(0, 1, r);
    g.set(x, 8, z, '#f3ead6', { mat: 'plaster' });
    g.rel(x, 8, z, r, 0, 0, 0.56, '#fff6d6', { mat: 'plaster', shape: 'pane', s: [1.5, 1.5, 0.5] });
    g.rel(x, 8, z, r, 0, 0.18, 0.64, '#2c3340', { mat: 'metal', shape: 'post', s: [0.4, 0.42, 0.5] });
    g.rel(x, 8, z, r, 0.18, 0, 0.64, '#2c3340', { mat: 'metal', shape: 'beam', s: [0.42, 0.4, 0.5] });
    for (const [px, py] of [[0, 0.55], [0, -0.55], [0.55, 0], [-0.55, 0]]) g.rel(x, 8, z, r, px, py, 0.62, C.gold, { mat: 'gold', shape: 'orb', s: 0.2 });
  }
  // open belfry with a bell
  for (const x of [-1, 1]) for (const z of [-1, 1]) g.box(x, x, 11, 12, z, z, pick(rng, C.stone), { mat: 'stone', shape: 'pillar' });
  g.set(0, 11.6, 0, C.gold, { mat: 'gold', shape: 'dome', s: [1.1, 1.1, 1.1] });
  g.set(0, 12.4, 0, C.timber, { mat: 'wood', shape: 'beam', s: [3, 1, 1] });
  g.box(-2, 2, 13, 13, -2, 2, '#9aa2ad', { mat: 'stone', shape: 'slab' });
  g.hip(-2, 2, 13.5, -2, 2, roof, {
    cap: (x, y) => {
      g.set(x, y + 1.2, 0, roof, { mat: 'roof', shape: 'spire', s: [1, 1.8, 1] });
      g.set(x, y + 2.3, 0, C.gold, { mat: 'gold', shape: 'orb', s: 0.45 });
    },
  });
  return g.out();
}

function lighthouse(rng) {
  const g = new Grid(rng);
  const band = pick(rng, ['#e8524a', '#3e6fd6', '#2f9e6b']);
  const round = (x, z) => !(Math.abs(x) === 2 && Math.abs(z) === 2);
  for (let y = 1; y <= 9; y++) {
    const c = Math.floor((y - 1) / 2) % 2 ? band : '#f8f4ec';
    for (let x = -2; x <= 2; x++) for (let z = -2; z <= 2; z++) if (round(x, z) && (Math.abs(x) === 2 || Math.abs(z) === 2)) g.set(x, y, z, c, { mat: 'plaster' });
    for (const x of [-1.6, 1.6]) for (const z of [-1.6, 1.6]) g.set(x, y, z, c, { mat: 'plaster', shape: 'pillar' });
  }
  g.door(0, 1, 2, S, C.door, { step: '#b5bcc6' });
  g.window(0, 5, 2, S, {});
  g.window(2, 7, 0, E, {});
  g.window(-2, 3, 0, W, {});
  for (let x = -2; x <= 2; x++) for (let z = -2; z <= 2; z++) if (round(x, z)) g.set(x, 10, z, '#3b4250', { mat: 'metal', shape: 'slab' });
  g.railing(-2, 2, 10.5, -2, 2, '#3b4250', (x, z) => !round(x, z));
  g.ring(-1, 1, 11, 12, -1, 1, '#fff7c9', { mat: 'glass' });
  for (const x of [-1, 1]) for (const z of [-1, 1]) g.box(x, x, 11, 12, z, z, '#3b4250', { mat: 'metal', shape: 'post' });
  g.set(0, 11, 0, C.lantern, { mat: 'lantern' });
  g.set(0, 12, 0, C.lantern, { mat: 'lantern', shape: 'orb', s: 1.6 });
  g.set(0, 13.4, 0, band, { mat: 'roof', shape: 'dome', s: [3.4, 1.8, 3.4] });
  g.set(0, 14.7, 0, '#3b4250', { mat: 'metal', shape: 'spire', s: [0.6, 1.2, 0.6] });
  g.set(0, 15.4, 0, C.gold, { mat: 'gold', shape: 'orb', s: 0.4 });
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + rng() * 0.6;
    const d = 2.7 + rng() * 0.4;
    g.set(Math.cos(a) * d, 0.9, Math.sin(a) * d, pick(rng, C.rock), { mat: 'rock', shape: 'rock', s: 0.8 + rng() * 0.7, deco: 1 });
  }
  return g.out();
}

function castle(rng) {
  const g = new Grid(rng);
  const s = stoneFn(rng);
  const roof = pick(rng, ['#3e6fd6', '#c4443c', '#7b56c9']);
  const flag = pick(rng, C.flags);
  g.ring(-4, 4, 1, 1, -4, 4, rockFn(rng));
  g.ring(-4, 4, 2, 3, -4, 4, s);
  for (let x = -4; x <= 4; x++)
    for (let z = -4; z <= 4; z++)
      if ((Math.abs(x) === 4 || Math.abs(z) === 4) && (x + z) % 2 === 0) g.set(x, 4, z, pick(rng, C.stone), { mat: 'stone', s: [1, 0.9, 1] });
  // gatehouse: arched gate between two little towers
  g.clear(-1, 1, 1, 4, 4, 4);
  g.set(0, 2, 4, pick(rng, C.stone), { mat: 'stone', shape: 'arch' });
  g.set(0, 1.55, 4, C.iron, { mat: 'metal', shape: 'pane', s: [0.62, 0.5, 0.5] }); // raised portcullis
  for (const x of [-1, 1]) g.box(x, x, 1, 5, 4, 5, s);
  g.box(-1, 1, 3, 4, 4, 5, s);
  for (const x of [-1, 1]) for (const z of [4, 5]) if ((x + z) & 1) g.set(x, 6, z, pick(rng, C.stone), { mat: 'stone', s: [1, 0.9, 1] });
  g.rel(0, 4, 5, S, 0, 0, 0.56, flag, { mat: 'cloth', shape: 'pane', s: [0.8, 1.6, 0.4] });
  // round corner towers with conical roofs
  for (const cx of [-4, 4])
    for (const cz of [-4, 4]) {
      g.ring(cx - 1, cx + 1, 1, 6, cz - 1, cz + 1, s);
      for (const x of [cx - 1, cx + 1]) for (const z of [cz - 1, cz + 1]) g.box(x, x, 1, 6, z, z, pick(rng, C.stone), { mat: 'stone', shape: 'pillar', s: [1.1, 1, 1.1] });
      g.window(cx + Math.sign(cx), 5, cz, cx > 0 ? E : W, {});
      g.box(cx - 1, cx + 1, 7, 7, cz - 1, cz + 1, '#9aa2ad', { mat: 'stone', shape: 'slab', s: [1.15, 1, 1.15] });
      g.set(cx, 8.9, cz, roof, { mat: 'roof', shape: 'cone', s: [4, 3, 4] });
      g.flag(cx, 11.4, cz, flag);
    }
  // the keep: two floors, banners, hipped roof with a spire
  g.ring(-2, 2, 1, 6, -2, 2, s);
  g.door(0, 1, 2, S, C.door, {});
  for (const x of [-1, 1]) g.rel(x, 4, 2, S, 0, 0, 0.56, flag, { mat: 'cloth', shape: 'pane', s: [0.8, 1.8, 0.4] });
  g.window(0, 4, 2, S, {});
  for (const [x, z, r] of [[2, 0, E], [-2, 0, W], [0, -2, N]]) {
    g.window(x, 3, z, r, {});
    g.window(x, 5, z, r, {});
  }
  g.box(-2, 2, 7, 7, -2, 2, '#9aa2ad', { mat: 'stone', shape: 'slab', s: [1.1, 1, 1.1] });
  g.hip(-2, 2, 7.5, -2, 2, roof, {
    cap: (x, y) => {
      g.set(x, y + 1.6, 0, roof, { mat: 'roof', shape: 'spire', s: [1.2, 2.6, 1.2] });
      g.flag(x, y + 3.6, 0, flag);
    },
  });
  // courtyard
  for (const [x, z] of [[-3, -2], [3, -2]]) g.set(x, 0.95, z, '#8d6748', { mat: 'wood', shape: 'pillar', s: [0.8, 0.9, 0.8] });
  g.set(-3, 1.2, 2, pick(rng, C.leaves), { mat: 'leaves', shape: 'blob', s: 1.1 });
  g.set(3, 1.2, 2, pick(rng, C.leaves), { mat: 'leaves', shape: 'blob', s: 1.1 });
  return g.out();
}

function cathedral(rng) {
  const g = new Grid(rng);
  const s = () => ({ color: pick(rng, ['#ece5d4', '#e2dac6', '#f2ecdf']), mat: 'stone' });
  const slate = pick(rng, ['#5d6b8a', '#4f6a63', '#6a5d7f']);
  const glass = ['#6fa8ff', '#ff7a8a', '#ffd166', '#8be08b', '#b48cff'];
  const lancet = (x, z, r) => {
    const c = pick(rng, glass);
    g.window(x, 3, z, r, { glass: c });
    g.window(x, 4, z, r, { glass: c });
  };
  g.ring(-3, 3, 1, 6, -6, 6, s); // nave
  g.ring(-3, 3, 1, 1, -6, 6, () => ({ color: pick(rng, C.rock), mat: 'rock' }));
  g.ring(-6, 6, 1, 5, -2, 2, s); // transept
  g.clear(-3, -3, 1, 5, -1, 1);
  g.clear(3, 3, 1, 5, -1, 1);
  g.clear(-2, 2, 1, 5, -2, -2);
  g.clear(-2, 2, 1, 5, 2, 2);
  for (const x of [-3, 3]) for (const z of [-5, -3, 4]) lancet(x, z, x > 0 ? E : W);
  for (const x of [-6, 6]) lancet(x, 0, x > 0 ? E : W);
  lancet(0, -6, N);
  // flying buttresses along the nave
  for (const x of [-4, 4])
    for (const z of [-6, -4, 3]) {
      g.box(x, x, 1, 3, z, z, s);
      g.set(x, 4, z, '#d8d0bc', { mat: 'stone', shape: 'wedge', r: x > 0 ? E : W });
    }
  // great door under an arch, rose window above
  g.door(0, 1, 6, S, '#5a3a22', { lamp: false, step: '#b5bcc6' });
  g.set(0, 3, 6, '#e2dac6', { mat: 'stone', shape: 'arch' });
  for (const x of [-1, 1]) g.rel(x, 1, 6, S, 0, 0.6, 0.55, C.lantern, { mat: 'lantern', shape: 'orb', s: 0.6, deco: 1 });
  g.rel(0, 5, 6, S, 0, 0, 0.45, '#ff7a8a', { mat: 'glass', shape: 'orb', s: [2.6, 2.6, 0.9] });
  g.gable(-7, 7, 6, -3, 3, slate, { ends: [-6, 6], endColor: s, endMat: 'stone' });
  g.gable(-4, 4, 7, -7, 7, slate, { axis: 'z', ends: [-6, 6], endColor: s, endMat: 'stone' });
  // twin bell towers with tall spires and pinnacles
  for (const cx of [-3, 3]) {
    g.ring(cx - 1, cx + 1, 1, 9, 5, 7, s);
    g.door(cx, 1, 7, S, C.door, { lamp: false });
    g.window(cx, 5, 7, S, { glass: pick(rng, glass) });
    g.rel(cx, 8, 7, S, 0, 0, 0.2, C.timber, { mat: 'wood', shape: 'pane', s: [0.8, 0.9, 0.6] }); // louvres
    g.box(cx - 1, cx + 1, 10, 10, 5, 7, '#d8d0bc', { mat: 'stone', shape: 'slab', s: [1.1, 1, 1.1] });
    g.set(cx, 12.6, 6, slate, { mat: 'roof', shape: 'spire', s: [3.2, 5, 3.2] });
    g.set(cx, 15.3, 6, C.gold, { mat: 'gold', shape: 'orb', s: 0.5 });
    for (const x of [cx - 1, cx + 1]) for (const z of [5, 7]) g.set(x, 10.9, z, '#d8d0bc', { mat: 'stone', shape: 'spire', s: [0.6, 1.3, 0.6] });
  }
  // lantern tower and flèche over the crossing
  g.box(-1, 1, 11, 12, -1, 1, s);
  for (const r of [S, W, N, E]) {
    const [x, z] = turn(0, 1, r);
    g.window(x, 12, z, r, { glass: pick(rng, glass) });
  }
  g.set(0, 14.6, 0, slate, { mat: 'roof', shape: 'spire', s: [2.8, 4.2, 2.8] });
  g.set(0, 17, 0, C.gold, { mat: 'gold', shape: 'orb', s: 0.5 });
  return g.out();
}

export const BUILDERS = { tree, house, tower, well, stall, bakery, windmill, clocktower, lighthouse, castle, cathedral };
