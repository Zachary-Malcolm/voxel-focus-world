import * as THREE from 'three';
import { IslandFX } from './islandfx.js';
import { VoxelBatch } from './voxels.js';
import { generateIsland } from './island.js';
import { footprint, placeBlocks, shiftRect } from './footprint.js';
import { rotateXZ } from './blueprints.js';
import { hash2, mulberry32 } from './rng.js';
import { natural, feature, RIVER_START } from './terrain.js';
import { Grid, S, W, N, E } from './builds.js';
import { jitterColor } from './voxels.js';
import * as sfx from './audio.js';

// Empty tiles required between any two buildings: close like a village, never touching.
export const GAP = 2;
const SQUARE_GAP = 1; // buildings keep one tile clear around the town square
const SQUARE_HALF = 2; // 5x5 plaza
const TOP = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.5); // grass surface, island-local
const PATH_COLORS = ['#e3d1a8', '#d9c497', '#e8d8b4'];
const PLAZA_COLORS = ['#d3ccbf', '#c6bfb2'];
const NO_PATH_KINDS = new Set(['tree']); // trees don't need a front door

const key2 = (x, z) => `${x},${z}`;
const key3 = (b) => `${b.x},${b.y},${b.z}`;
const tkey = (b) => `${b.x},${b.y},${b.z},${b.shape || 'cube'},${b.mat || ''},${b.r || 0}`;
const DIR4 = [[0, 1, S], [-1, 0, W], [0, -1, N], [1, 0, E]]; // dx, dz, facing
const HILL_GRASS = ['#6cc24a', '#62b843', '#78cc55'];
const WATER = ['#4fb3f0', '#47a9e8', '#5bbcf5'];
const RIVER_WATER = ['#46a6e6', '#3f9cdf', '#52b1ee'];
const SAND = ['#eadcae', '#e3d3a0', '#efe3bb'];
const colorKey = (c) => (typeof c === 'string' ? c : c.getHexString ? c.getHexString() : String(c));

/** The permanent "forever world": base island, town square + paths, buildings, placement. */
export class Home {
  constructor(scene) {
    this.fx = new IslandFX(scene, { capacity: 40000, ghostCapacity: 1200 });
    this.group = this.fx.group;
    this.baseMap = new Map(); // "x,y,z" -> block
    this.topCells = new Set();
    this.buildings = new Map(); // id -> { record, fp, rect, blocks, spinner? }
    this.emitters = []; // chimney smoke sources
    this.placing = null;
    this.square = null; // { x, z } centre of the town square
    this.fountain = [];
    this.paths = new Set(); // "x,z" paved cells
    this.paving = []; // queued tiles for the paving animation
    this.pendingPave = new Set();
    this.paveTimer = 0;
    this.seed = 0;
    this.river = null; // river angle (saved once chosen), null = no river yet
    this.cells = new Map(); // "x,z" -> { x, z, water, hill, rim, near, path, beach }
    this.terrain = new Map(); // tkey -> block (hills, nature, bridges, waterfalls)
    this.drips = []; // waterfall spray sources
    this.landmarks = []; // fixed structures of the land itself: { kind, rect, blocks, spinner }
    this.extraReserve = []; // rects about to be built on (layout moves): keep nature off them
    this.preferRoads = null; // while re-routing: old road cells are cheaper, so roads stay put

    this.tileMat = new THREE.MeshBasicMaterial({ color: 0x5be37d, transparent: true, opacity: 0.55, depthWrite: false });
    this.tiles = new VoxelBatch(new THREE.BoxGeometry(0.96, 0.06, 0.96), this.tileMat, 900, { shadows: false });
    this.tiles.mesh.renderOrder = 1;
    this.group.add(this.tiles.mesh);
  }

  // ---------- ground ----------

  setBase(radius, seed) {
    for (const b of this.baseMap.values()) this.fx.remove(b);
    this.baseMap.clear();
    this.seed = seed;
    const { blocks, topCells } = generateIsland(radius, seed);
    for (const b of blocks) {
      b.orig = { color: b.color, mat: b.mat };
      this.fx.add(b);
      this.baseMap.set(key3(b), b);
    }
    this.topCells = topCells;
    this.refreshTerrain(false);
  }

  /** Animated growth: new rim drops in as a wave around the island, deep rock appears underneath. */
  grow(radius, seed, onDone) {
    const { blocks, topCells } = generateIsland(radius, seed);
    const next = new Map(blocks.map((b) => [key3(b), b]));
    const gone = [];
    for (const [k, b] of this.baseMap) if (!next.has(k)) gone.push(b);
    const wave = [];
    const merged = new Map();
    for (const [k, b] of next) {
      const old = this.baseMap.get(k);
      if (old) merged.set(k, old);
      else {
        b.orig = { color: b.color, mat: b.mat };
        merged.set(k, b);
        if (b.y >= -2) wave.push(b);
        else this.fx.add(b);
      }
    }
    this.baseMap = merged;
    this.topCells = topCells;
    this.fx.many('crumble', gone, 0.004, {});
    wave.sort((a, b) => Math.atan2(a.z, a.x) - Math.atan2(b.z, b.x) || a.y - b.y);
    this.fx.many('drop', wave, Math.min(0.012, 3.2 / Math.max(1, wave.length)), { velocity: 0.8, height: 7 }, () => {
      this.refreshTerrain(true); // new land brings new hills, woods and water
      onDone?.();
    });
  }

  /** Give a base block a style (only touches the GPU when it actually changes). */
  styleBase(b, style) {
    if (!b) return;
    const k = `${style.mat}|${style.shape || 'cube'}|${colorKey(style.color)}`;
    if (b.styleKey === k) return;
    b.styleKey = k;
    this.fx.restyle(b, { color: style.color, mat: style.mat, shape: style.shape || 'cube' });
  }

  /** Surface of one cell: plaza, road, water, beach or its own grass. Water beds turn to sand. */
  applyTop(x, z) {
    const top = this.baseMap.get(`${x},0,${z}`);
    if (!top) return;
    const c = this.cells.get(key2(x, z));
    const h = hash2(x * 92837111 + 7, z * 689287499 + 3);
    let style;
    if (this.inPlaza(x, z)) style = { mat: 'brick', color: PLAZA_COLORS[(x + z) & 1] };
    else if (c?.water) style = { mat: 'water', shape: 'slab', color: (c.water === 'river' ? RIVER_WATER : WATER)[h % 3] };
    else if (this.paths.has(key2(x, z)) && !this.pendingPave.has(key2(x, z))) style = { mat: 'stone', color: PATH_COLORS[h % PATH_COLORS.length] };
    else if (c?.beach) style = { mat: 'sand', color: SAND[h % 3] };
    else style = top.orig;
    this.styleBase(top, style);
    const bed = this.baseMap.get(`${x},-1,${z}`);
    if (bed) this.styleBase(bed, c?.water ? { mat: 'sand', color: SAND[(h >>> 3) % 3] } : bed.orig);
  }

  // ---------- terrain ----------

  /** Cells kept flat and bare because people use them: around buildings, the square, roads. */
  reserved() {
    const flat = new Set();
    const noTree = new Set();
    const bare = new Set(); // no wild plants or rocks, but the land keeps its shape
    const mark = (r, pad, set) => {
      for (let x = r.x0 - pad; x <= r.x1 + pad; x++) for (let z = r.z0 - pad; z <= r.z1 + pad; z++) set.add(key2(x, z));
    };
    for (const { rect, fp } of this.buildings.values()) {
      mark(rect, fp.decor ? 0 : 1, flat); // a lamp or a fence doesn't level the hill around it
      mark(rect, fp.decor ? 1 : 2, noTree);
    }
    for (const l of this.landmarks) {
      mark(l.rect, 0, flat); // no padding: the wheel itself stands in the river next door
      mark(l.rect, 1, noTree);
      mark(l.rect, 1, bare);
    }
    for (const r of this.extraReserve) {
      mark(r, 1, flat);
      mark(r, 2, noTree);
    }
    if (this.square) {
      mark(this.squareRect(), 1, flat);
      mark(this.squareRect(), 2, noTree);
    }
    for (const k of this.paths) {
      flat.add(k);
      noTree.add(k);
    }
    return { flat, noTree, bare };
  }

  /** Work out every cell's water / hill / shore from nature + what people built. */
  computeCells() {
    const { flat, noTree, bare } = this.reserved();
    const cells = new Map();
    const land = (x, z) => this.topCells.has(key2(x, z));
    for (const k of this.topCells) {
      const [x, z] = k.split(',').map(Number);
      const nat = natural(this.seed, this.river, x, z);
      const rim = DIR4.some(([dx, dz]) => !land(x + dx, z + dz));
      const nearRim = rim || DIR4.some(([dx, dz]) => !land(x + 2 * dx, z + 2 * dz));
      const path = this.paths.has(k);
      let water = nat.water;
      let hill = nat.hill;
      if (water === 'lake' && rim) water = null; // lakes keep a shore; only the river spills over
      if (nearRim) hill = Math.min(hill, rim ? 0 : 1);
      if (flat.has(k)) {
        hill = 0;
        if (!path) water = null; // roads cross water on bridges; buildings get dry land
      }
      cells.set(k, { x, z, water, hill, rim, path, reserved: flat.has(k), noTree: noTree.has(k), bare: bare.has(k) });
    }
    for (const c of cells.values()) {
      let near = false;
      for (let dx = -1; dx <= 1 && !near; dx++) for (let dz = -1; dz <= 1 && !near; dz++) if (cells.get(key2(c.x + dx, c.z + dz))?.water) near = true;
      c.near = near && !c.water;
      c.beach = c.near && !c.hill && !c.path && !this.inPlaza(c.x, c.z);
    }
    return cells;
  }

  /**
   * Rebuild hills, nature, bridges and waterfalls for the current world and restyle the ground.
   * Only the differences change: with animate, new things drop in softly and cleared things crumble.
   */
  refreshTerrain(animate) {
    this.version = (this.version || 0) + 1; // creatures re-read the world when this changes
    this.cells = this.computeCells();
    const want = new Map();
    const add = (b) => want.set(tkey(b), b);
    const height = (x, z) => this.cells.get(key2(x, z))?.hill ?? -1;
    this.drips = [];
    for (const c of this.cells.values()) {
      const { x, z } = c;
      const h = hash2(x * 73856093 + 11, z * 19349663 + 5);
      const rng = mulberry32(h);
      // hills: dirt underneath, grass on top, sloped where the ground falls away
      for (let y = 1; y <= c.hill; y++) {
        const top = y === c.hill;
        const b = { x, y, z, mat: top ? 'grass' : 'dirt', color: top ? jitterColor(HILL_GRASS[h % 3], rng, 0.04) : jitterColor('#b07a4f', rng, 0.04) };
        if (top) {
          const lower = DIR4.map(([dx, dz]) => height(x + dx, z + dz) < y);
          const n = lower.filter(Boolean).length;
          const [s, w, nn, e] = lower;
          if (n === 1) {
            b.shape = 'wedge';
            b.r = DIR4[lower.indexOf(true)][2];
          } else if (n === 2 && !(s && nn) && !(w && e)) {
            b.shape = 'corner';
            b.r = e && s ? 0 : w && s ? 1 : w && nn ? 2 : 3;
          }
        }
        add(b);
      }
      // bridges where a road crosses water
      if (c.water && c.path) {
        add({ x, y: 0.42, z, mat: 'wood', color: jitterColor('#b98a5c', rng, 0.04), s: [1, 0.24, 1] });
        for (const [dx, dz] of DIR4) {
          const n = this.cells.get(key2(x + dx, z + dz));
          if (n && !n.path && n.water) add({ x: x + dx * 0.42, y: 0.95, z: z + dz * 0.42, mat: 'wood', shape: 'fence', r: dx ? 1 : 0, s: [1, 0.8, 0.5], color: '#8d6748' });
        }
      }
      // the river spills over the rim as a waterfall
      if (c.water === 'river' && c.rim) {
        for (const [dx, dz] of DIR4) {
          if (this.topCells.has(key2(x + dx, z + dz))) continue;
          for (let k = 0; k < 7; k++)
            add({ x: x + dx * 0.62, y: -0.15 - k, z: z + dz * 0.62, mat: 'water', s: dx ? [0.3, 1, 1] : [1, 1, 0.3], color: RIVER_WATER[(h + k) % 3] });
          this.drips.push({ x: x + dx * 0.75, y: -0.4, z: z + dz * 0.75, t: Math.random() });
        }
      }
      // nature
      if (!c.reserved && !c.bare && !this.inPlaza(x, z)) {
        const f = feature(this.seed, x, z, { water: c.water, hill: c.hill, nearWater: c.near, allowTree: !c.noTree && !c.water && !c.rim });
        if (f) for (const b of f) add(b);
        // trees, boulders and bushes are in the way of wandering animals
        c.blocked = !!f && f.some((b) => b.shape === 'rock' || b.shape === 'blob' || b.mat === 'log' || b.mat === 'wood');
      } else c.blocked = false;
    }

    const gone = [];
    const added = [];
    const next = new Map();
    for (const [k, b] of this.terrain) if (!want.has(k)) gone.push(b);
    for (const [k, b] of want) {
      const old = this.terrain.get(k);
      if (old) next.set(k, old);
      else {
        next.set(k, b);
        added.push(b);
      }
    }
    this.terrain = next;
    if (animate) {
      gone.sort((a, b) => a.y - b.y);
      this.fx.many('crumble', gone, Math.min(0.01, 1.5 / Math.max(1, gone.length)), {});
      added.sort((a, b) => Math.hypot(a.x, a.z) - Math.hypot(b.x, b.z) || a.y - b.y);
      this.fx.many('drop', added, Math.min(0.012, 3 / Math.max(1, added.length)), { velocity: 0.45, height: 5 });
    } else {
      for (const b of gone) this.fx.remove(b);
      for (const b of added) this.fx.add(b);
    }
    for (const c of this.cells.values()) this.applyTop(c.x, c.z);
  }

  /** Surface height (top of the ground) under a point, and whether it's water. */
  groundAt(x, z) {
    const c = this.cells.get(key2(Math.round(x), Math.round(z)));
    if (!c) return null;
    return { y: c.water ? (c.path ? 0.56 : 0) : c.hill + 0.5, water: !!c.water && !c.path, hill: c.hill, cell: c };
  }

  /** Pick the river's direction once: the way that crosses the fewest buildings and roads. */
  chooseRiver() {
    const { flat } = this.reserved();
    let best = 0;
    let bestScore = Infinity;
    for (let i = 0; i < 24; i++) {
      const a0 = (i / 24) * Math.PI * 2 + (this.seed % 100) * 0.001;
      let score = 0;
      for (const k of this.topCells) {
        const [x, z] = k.split(',').map(Number);
        const n = natural(this.seed, a0, x, z);
        if (n.water === 'river' && flat.has(k)) score += this.paths.has(k) ? 1 : 6;
      }
      score += ((hash2(this.seed, i) % 1000) / 1000) * 0.5;
      if (score < bestScore) {
        bestScore = score;
        best = a0;
      }
    }
    return best;
  }

  setRiver(a0, animate = false) {
    this.river = a0;
    this.refreshTerrain(animate);
  }

  // ---------- the water wheel ----------

  /** Somewhere on the river with a dry bank beside it for the mill hut, or null. */
  chooseWheelSpot() {
    const river = [...this.cells.values()]
      .filter((c) => c.water === 'river' && !c.rim && !c.path)
      .map((c) => ({ c, d: Math.hypot(c.x, c.z) }))
      .filter(({ d }) => d >= RIVER_START + 2.5)
      .sort((a, b) => a.d - b.d);
    for (const { c } of river) {
      const flow = Math.abs(c.x) >= Math.abs(c.z) ? 'x' : 'z';
      for (const side of [1, -1]) {
        const [px, pz] = flow === 'x' ? [0, side] : [side, 0];
        // the wheel sits in the last water cell before the bank
        let wx = c.x;
        let wz = c.z;
        while (this.cells.get(key2(wx + px, wz + pz))?.water) {
          wx += px;
          wz += pz;
        }
        const hx = wx + px * 2;
        const hz = wz + pz * 2;
        const rect = { x0: hx - 1, x1: hx + 1, z0: hz - 1, z1: hz + 1 };
        let ok = true;
        for (let x = rect.x0; x <= rect.x1 && ok; x++)
          for (let z = rect.z0; z <= rect.z1 && ok; z++) {
            const cc = this.cells.get(key2(x, z));
            if (!cc || cc.water || cc.reserved || cc.rim) ok = false;
          }
        if (!ok) continue;
        if ([...this.buildings.values()].some(({ rect: o }) => !apart(rect, o, 1))) continue;
        return { x: wx, z: wz, flow, side };
      }
    }
    return null;
  }

  /** A little mill hut on the bank with a wheel turning in the river. */
  setWheel(spot, animate = false) {
    for (const l of this.landmarks) {
      for (const b of l.blocks) this.fx.remove(b);
      if (l.spinner) this.fx.removeSpinner(l.spinner);
    }
    this.landmarks = [];
    if (!spot) return;
    const { x: wx, z: wz, flow, side } = spot;
    const [px, pz] = flow === 'x' ? [0, side] : [side, 0];
    const hx = wx + px * 2;
    const hz = wz + pz * 2;
    const g = new Grid(mulberry32(hash2(this.seed, 4242)));
    // hut, built at the origin then shifted (front faces the river)
    const face = px === 1 ? W : px === -1 ? E : pz === 1 ? N : S;
    g.ring(-1, 1, 1, 1, -1, 1, () => ({ color: ['#a7afba', '#b5bcc6'][Math.floor(Math.random() * 2)], mat: 'stone' }));
    g.ring(-1, 1, 2, 2, -1, 1, '#efe2c8', { mat: 'plaster' });
    for (const x of [-1, 1]) for (const z of [-1, 1]) g.box(x, x, 1, 2, z, z, '#7a5434', { mat: 'log' });
    const [fx, fz] = [[0, 1], [-1, 0], [0, -1], [1, 0]][face];
    g.window(fx, 2, fz, face, {});
    const back = (face + 2) % 4;
    const [bx, bz] = [[0, 1], [-1, 0], [0, -1], [1, 0]][back];
    g.door(bx, 1, bz, back, '#6b4428', { lamp: true });
    g.hip(-2, 2, 3, -2, 2, '#8c5a3c', {});
    g.set(0, 4.6, 0, '#6b4a2f', { mat: 'wood', shape: 'post', s: [1, 0.8, 1] });
    const blocks = g.out().map((b) => ({ ...b, x: b.x + hx, z: b.z + hz }));
    // wheel: spokes, paddles and hub turn about the axle
    const cy = 0.75;
    const R = 1.55;
    const toWorld = (u, w) => (flow === 'x' ? [wx + u, wz + w * side] : [wx + w * side, wz + u]);
    const alongU = flow === 'x' ? 0 : 1;
    const alongW = flow === 'x' ? 1 : 0;
    const wheel = [];
    const wood = '#8d6748';
    const put = (u, y, w, color, o) => {
      const [x, z] = toWorld(u, w);
      wheel.push({ x, y, z, color, spin: true, ...o });
    };
    put(0, cy, 0, '#5d6470', { mat: 'metal', shape: 'orb', s: 0.7 });
    put(0, cy, 0, wood, { mat: 'wood', shape: 'beam', r: alongU, s: [2 * R / 1, 1.1, 1.1] });
    put(0, cy, 0, wood, { mat: 'wood', shape: 'post', s: [1.1, 2 * R, 1.1] });
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      put(Math.cos(a) * R, cy + Math.sin(a) * R, 0, i % 2 ? '#a7794c' : wood, { mat: 'wood', shape: 'beam', r: alongW, s: [0.9, 1.3, 1.6] });
    }
    // a dotted rim of little blocks so it reads as a wheel, not a cross
    for (let i = 0; i < 24; i++) {
      const a = ((i + 0.5) / 24) * Math.PI * 2;
      const [x, z] = toWorld(Math.cos(a) * R * 0.74, 0);
      const s = flow === 'x' ? [0.22, 0.22, 0.34] : [0.34, 0.22, 0.22];
      wheel.push({ x, y: cy + Math.sin(a) * R * 0.74, z, color: '#6b4a2f', mat: 'wood', spin: true, s });
    }
    // fixed axle into the hut wall
    const [ax, az] = toWorld(0, 0.9);
    const axle = { x: ax, y: cy, z: az, color: '#6b4a2f', mat: 'log', shape: 'beam', r: alongW, s: [1.2, 1.2, 1.2] };
    const all = [...blocks, axle, ...wheel];
    for (const b of all) {
      if (animate) this.fx.drop(b, { height: 6, velocity: 0.6, delay: Math.random() * 0.6 });
      else this.fx.add(b);
    }
    const lm = { kind: 'wheel', rect: { x0: hx - 1, x1: hx + 1, z0: hz - 1, z1: hz + 1 }, blocks: all };
    const startSpin = () => {
      const [cx, cz] = toWorld(0, 0);
      const axis = flow === 'x' ? 'z' : 'x';
      const dirOut = flow === 'x' ? Math.sign(wx) || 1 : Math.sign(wz) || 1;
      lm.spinner = this.fx.addSpinner(wheel, [cx, cy, cz], axis, axis === 'z' ? 0.7 * dirOut : -0.7 * dirOut);
    };
    if (animate) setTimeout(startSpin, 2300);
    else startSpin();
    this.landmarks.push(lm);
    this.refreshTerrain(animate);
  }

  // ---------- town square ----------

  inPlaza(x, z) {
    const s = this.square;
    return !!s && Math.abs(x - s.x) <= SQUARE_HALF && Math.abs(z - s.z) <= SQUARE_HALF;
  }

  inFountain(x, z) {
    const s = this.square;
    return !!s && Math.abs(x - s.x) <= 1 && Math.abs(z - s.z) <= 1;
  }

  *plazaCells() {
    const s = this.square;
    for (let x = s.x - SQUARE_HALF; x <= s.x + SQUARE_HALF; x++) for (let z = s.z - SQUARE_HALF; z <= s.z + SQUARE_HALF; z++) yield [x, z];
  }

  squareRect() {
    const s = this.square;
    return { x0: s.x - SQUARE_HALF, x1: s.x + SQUARE_HALF, z0: s.z - SQUARE_HALF, z1: s.z + SQUARE_HALF };
  }

  /** Find the open spot closest to the centre that fits the plaza. */
  findSquareSpot() {
    const cells = [...this.topCells].map((k) => k.split(',').map(Number)).sort((a, b) => Math.hypot(...a) - Math.hypot(...b));
    for (const [x, z] of cells) {
      let ok = true;
      for (let dx = -SQUARE_HALF; dx <= SQUARE_HALF && ok; dx++)
        for (let dz = -SQUARE_HALF; dz <= SQUARE_HALF && ok; dz++) if (!this.topCells.has(key2(x + dx, z + dz))) ok = false;
      if (!ok) continue;
      const r = { x0: x - SQUARE_HALF, x1: x + SQUARE_HALF, z0: z - SQUARE_HALF, z1: z + SQUARE_HALF };
      if ([...this.buildings.values()].some(({ rect }) => !apart(r, rect, SQUARE_GAP))) continue;
      return { x, z };
    }
    return null;
  }

  setSquare(sq) {
    for (const b of this.fountain) this.fx.remove(b);
    this.fountain = [];
    this.square = sq;
    if (!sq) return;
    const add = (x, y, z, color) => {
      const b = { x: sq.x + x, y, z: sq.z + z, color };
      this.fx.add(b);
      this.fountain.push(b);
    };
    for (let x = -1; x <= 1; x++)
      for (let z = -1; z <= 1; z++) add(x, 1, z, x === 0 && z === 0 ? '#5bbcf2' : (x + z) & 1 ? '#b8c0cb' : '#c9d0d9');
    add(0, 2, 0, '#c9d0d9');
    add(0, 3, 0, '#8fd6ff');
    this.emitters.push({ x: sq.x, y: 3.6, z: sq.z, t: 0, spray: true });
    this.refreshTerrain(false);
  }

  // ---------- paths ----------

  /** Pave a road from a building's front door to the nearest road or the square. Returns new cells. */
  routeFor(entry) {
    if (!this.square || NO_PATH_KINDS.has(entry.record.kind) || entry.fp.decor) return [];
    const { record, fp } = entry;
    const starts = [];
    for (let turn = 0; turn < 4; turn++) {
      const [fx, fz] = rotateXZ(0, 1, (record.rot || 0) + turn);
      const r = fp.rect;
      const dx = fx === 1 ? r.x1 + 1 : fx === -1 ? r.x0 - 1 : 0;
      const dz = fz === 1 ? r.z1 + 1 : fz === -1 ? r.z0 - 1 : 0;
      starts.push([record.x + dx, record.z + dz]);
    }
    for (const [sx, sz] of starts) {
      const cells = this.shortestRoad(sx, sz);
      if (cells) return cells;
    }
    return [];
  }

  walkable(x, z) {
    if (!this.topCells.has(key2(x, z)) || this.inFountain(x, z)) return false;
    for (const { rect } of this.buildings.values()) if (x >= rect.x0 && x <= rect.x1 && z >= rect.z0 && z <= rect.z1) return false;
    for (const { rect } of this.landmarks) if (x >= rect.x0 && x <= rect.x1 && z >= rect.z0 && z <= rect.z1) return false;
    return true;
  }

  /** Extra cost of laying road on a cell: water needs a bridge, hills need digging. */
  roughness(x, z) {
    const c = this.cells.get(key2(x, z));
    if (!c) return 0;
    return (c.water ? 3 : 0) + c.hill * 0.7;
  }

  isRoad(x, z) {
    return this.paths.has(key2(x, z)) || (this.inPlaza(x, z) && !this.inFountain(x, z));
  }

  /** Dijkstra with a turn penalty, so roads come out as straight runs with few bends. */
  shortestRoad(sx, sz) {
    if (!this.walkable(sx, sz)) return null;
    if (this.isRoad(sx, sz)) return [];
    const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    const dist = new Map();
    const prev = new Map();
    const heap = [[0, sx, sz, -1]];
    dist.set(`${sx},${sz},-1`, 0);
    while (heap.length) {
      let bi = 0;
      for (let i = 1; i < heap.length; i++) if (heap[i][0] < heap[bi][0]) bi = i;
      const [d, x, z, dir] = heap[bi];
      heap[bi] = heap[heap.length - 1];
      heap.pop();
      const sk = `${x},${z},${dir}`;
      if (d > (dist.get(sk) ?? Infinity)) continue;
      if (this.isRoad(x, z)) {
        const out = [];
        let k = sk;
        while (k) {
          const [px, pz] = k.split(',').map(Number);
          if (!this.isRoad(px, pz)) out.push([px, pz]);
          k = prev.get(k);
        }
        return out.reverse();
      }
      DIRS.forEach(([dx, dz], nd) => {
        const nx = x + dx;
        const nz = z + dz;
        if (!this.walkable(nx, nz)) return;
        const cost = d + 1 + (dir !== -1 && dir !== nd ? 0.8 : 0) + this.roughness(nx, nz) - (this.preferRoads?.has(key2(nx, nz)) ? 0.6 : 0);
        const nk = `${nx},${nz},${nd}`;
        if (cost < (dist.get(nk) ?? Infinity)) {
          dist.set(nk, cost);
          prev.set(nk, sk);
          heap.push([cost, nx, nz, nd]);
        }
      });
      if (dist.size > 20000) break;
    }
    return null;
  }

  /** Add road cells; animated tiles get paved one by one from the door outwards. */
  pave(cells, animate) {
    for (const [x, z] of cells) {
      this.paths.add(key2(x, z));
      if (animate) {
        this.paving.push([x, z]);
        this.pendingPave.add(key2(x, z));
      }
    }
    this.refreshTerrain(animate);
  }

  // ---------- buildings ----------

  loadBuildings(records) {
    for (const r of records) {
      const entry = this.entryFor(r);
      for (const b of entry.blocks) this.fx.add(b);
      this.buildings.set(r.id, entry);
      this.activate(entry);
    }
  }

  entryFor(record) {
    const fp = footprint(record.kind, record.variant, record.rot || 0);
    const blocks = placeBlocks(fp, record.x, record.z);
    blocks.forEach((b, i) => {
      b.bid = record.id; // which building a picked block belongs to
      b.idx = i; // paint overrides are keyed by block index (stable across moves and rotations)
    });
    const entry = { record, fp, rect: shiftRect(fp.rect, record.x, record.z), blocks };
    this.paintBlocks(entry, false);
    return entry;
  }

  /** Bring a finished building to life: turning sails, chimney smoke. */
  activate(entry) {
    const { fp, record } = entry;
    this.spin(entry);
    for (const [x, y, z] of fp.smoke) this.emitters.push({ id: record.id, x: x + record.x, y, z: z + record.z, t: Math.random() * 1.5 });
  }

  spin(entry) {
    const { fp, record } = entry;
    if (!fp.spin) return;
    const [px, py, pz] = fp.spin.pivot;
    entry.spinner = this.fx.addSpinner(
      entry.blocks.filter((b) => b.spin),
      [px + record.x, py, pz + record.z],
      fp.spin.axis,
    );
  }

  /** Rebuild the turning part (after its blocks were repainted), keeping its angle. */
  respin(entry) {
    const s = entry.spinner;
    if (!s) return;
    const angle = s.group.rotation[s.axis];
    this.fx.removeSpinner(s);
    this.spin(entry);
    entry.spinner.group.rotation[entry.spinner.axis] = angle;
  }

  /** Drop a building into the world as a cascade (no road). */
  placeBuilding(record, onDone, { fast = false } = {}) {
    const entry = this.entryFor(record);
    this.buildings.set(record.id, entry);
    this.refreshTerrain(true); // clear the land: trees, rocks and hills under the new building crumble
    const n = entry.blocks.length;
    this.fx.many('drop', entry.blocks, Math.min(fast ? 0.025 : 0.07, (fast ? 1.5 : 3.5) / n), { velocity: fast ? 0.8 : 1 }, () => {
      this.activate(entry);
      onDone?.(entry);
    });
    return entry;
  }

  /** Drop a newly placed building in as a cascade, then pave its road. Returns the new road cells. */
  build(record, onDone) {
    let road = [];
    const entry = this.placeBuilding(record, () => {
      this.pave(road, true);
      onDone?.();
    });
    road = this.routeFor(entry);
    return road;
  }

  // ---------- editing (phase 6) ----------

  /**
   * Take a building out of the world. style: 'crumble' (demolish), 'lift' (store / move) or 'instant'.
   * regrow: let nature grow back where it stood (off while it is only being moved).
   */
  removeBuilding(id, style = 'crumble', onDone, { regrow = true } = {}) {
    const entry = this.buildings.get(id);
    if (!entry) return void onDone?.();
    this.buildings.delete(id);
    if (entry.spinner) {
      this.fx.removeSpinner(entry.spinner);
      entry.spinner = null;
      for (const b of entry.blocks) if (b.spin) this.fx.add(b);
    }
    this.emitters = this.emitters.filter((e) => e.id !== id);
    const blocks = [...entry.blocks].reverse(); // top first
    const done = () => {
      if (regrow) this.refreshTerrain(true);
      onDone?.();
    };
    if (style === 'instant') {
      for (const b of blocks) this.fx.remove(b);
      done();
    } else if (style === 'lift') this.fx.many('lift', blocks, Math.min(0.012, 0.8 / blocks.length), {}, done);
    else this.fx.many('crumble', blocks, Math.min(0.012, 1.3 / blocks.length), { cx: entry.record.x, cz: entry.record.z }, done);
    return entry;
  }

  buildingAt(x, z) {
    for (const [id, { rect: r }] of this.buildings) if (x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1) return id;
    return null;
  }

  /** The building under a screen ray: one of its blocks, or the ground it stands on. */
  pickBuilding(raycaster) {
    this.group.updateMatrixWorld();
    const hit = this.fx.pickBlock(raycaster);
    if (hit && hit.b.bid != null && this.buildings.has(hit.b.bid)) return hit.b.bid;
    const c = this.pick(raycaster);
    return c ? this.buildingAt(c.x, c.z) : null;
  }

  /** The block of building `id` under a screen ray (nothing if something else is in front). */
  pickPart(raycaster, id) {
    this.group.updateMatrixWorld();
    return this.fx.pickBlock(raycaster, (b) => b.bid === id)?.b || null;
  }

  /** Bring every block of a building in line with record.paint ({ index: { c: '#hex', m: material } }). */
  paintBlocks(entry, live = true) {
    const paint = entry.record.paint || {};
    let respin = false;
    entry.blocks.forEach((b, i) => {
      const o = entry.fp.rel[i];
      const p = paint[i];
      const color = p?.c ? paintColor(p.c, entry.record.variant, i) : o.color;
      const mat = p?.m || o.mat;
      if (colorKey(b.color) === colorKey(color) && (b.mat || 'plaster') === (mat || 'plaster')) return;
      if (!live || (b.handle == null && !b.spinner)) {
        b.color = color;
        b.mat = mat;
        return;
      }
      if (b.spinner) {
        b.color = color;
        b.mat = mat;
        respin = true;
        return;
      }
      this.fx.restyle(b, { color, mat });
    });
    if (respin) this.respin(entry);
  }

  /** Show a rectangle of tiles on the ground (selected building). */
  showRect(r, color = 0xffc34d) {
    this.tiles.clear();
    this.tileMat.color.set(color);
    for (let x = r.x0; x <= r.x1; x++) for (let z = r.z0; z <= r.z1; z++) this.tiles.add(x, 0.53, z, 0xffffff);
  }

  clearRect() {
    this.tiles.clear();
  }

  /** Start moving a placed building (already lifted out): the ghost starts where it stood. */
  beginMove(record) {
    this.placing = { item: { id: record.id, kind: record.kind, variant: record.variant }, rot: record.rot || 0, x: record.x, z: record.z, reason: null, move: true };
    this.refreshGhost();
  }

  /**
   * Plan new spots for every building from a layout template (see layouts.js).
   * Returns { moves: [{ id, x, z, rot }], avenue } or null when something doesn't fit.
   */
  planLayout(tpl) {
    const all = [...this.buildings.values()];
    const entries = all.filter((e) => !e.fp.decor);
    // Decor travels with the building it stands beside (same spot relative to its door), so a lamp
    // by a cottage is still by that cottage afterwards. Decor out on its own stays where it is.
    const anchors = new Map();
    for (const d of all.filter((e) => e.fp.decor)) {
      let best = null;
      let bd = 5;
      for (const b of entries) {
        const r = b.rect;
        const gap = Math.max(r.x0 - d.rect.x1, d.rect.x0 - r.x1, r.z0 - d.rect.z1, d.rect.z0 - r.z1, 0);
        if (gap < bd) {
          bd = gap;
          best = b;
        }
      }
      const rot = best ? best.record.rot || 0 : 0;
      const [dx, dz] = best ? rotateXZ(d.record.x - best.record.x, d.record.z - best.record.z, (4 - rot) & 3) : [0, 0];
      anchors.set(d, best ? { id: best.record.id, dx, dz, drot: ((d.record.rot || 0) - rot + 4) & 3 } : null);
    }
    const saved = this.buildings;
    this.buildings = new Map();
    const cells = [...this.topCells].map((k) => k.split(',').map(Number));
    const ctx = tpl.setup({ home: this, entries, square: this.square || { x: 0, z: 0 } });
    const moves = [];
    try {
      for (const e of ctx.order) {
        const rec = e.record;
        const cand = [];
        for (const [x, z] of cells) {
          const sc = ctx.score(x, z, e);
          if (Number.isFinite(sc)) cand.push({ x, z, s: sc });
        }
        cand.sort((a, b) => a.s - b.s);
        let best = null;
        for (const c of cand) {
          if (best && c.s >= best.score) break;
          const face = ctx.face ? ctx.face(c.x, c.z, e) : null;
          for (let rot = 0; rot < 4; rot++) {
            let pen = 0;
            if (face) {
              const [dx, dz] = rotateXZ(0, 1, rot); // the front door's direction
              const vx = face[0] - c.x;
              const vz = face[1] - c.z;
              const len = Math.hypot(vx, vz);
              if (len > 0.5) pen = (1 - (dx * vx + dz * vz) / len) * 1.2;
            }
            const score = c.s + pen;
            if (best && score >= best.score) continue;
            const fp = footprint(rec.kind, rec.variant, rot);
            if (this.check(fp, c.x, c.z, { ignoreRoads: true })) continue;
            const rect = shiftRect(fp.rect, c.x, c.z);
            if (ctx.keepClear?.(rect)) continue;
            best = { x: c.x, z: c.z, rot, score, rect };
          }
        }
        if (!best) return null;
        moves.push({ id: rec.id, x: best.x, z: best.z, rot: best.rot });
        ctx.onPlace?.(e, best, best.rect);
        const fp = footprint(rec.kind, rec.variant, best.rot);
        this.buildings.set(rec.id, { record: { ...rec, x: best.x, z: best.z, rot: best.rot }, fp, rect: best.rect, blocks: [] });
      }
      // then the decor: as close as it fits to where its anchor building puts it now
      for (const [d, a] of anchors) {
        const rec = d.record;
        let tx = rec.x;
        let tz = rec.z;
        let rot = rec.rot || 0;
        const nb = a && this.buildings.get(a.id)?.record;
        if (nb) {
          const [ox, oz] = rotateXZ(a.dx, a.dz, nb.rot);
          tx = nb.x + ox;
          tz = nb.z + oz;
          rot = (a.drot + nb.rot) & 3;
        }
        const fp = footprint(rec.kind, rec.variant, rot);
        const near = cells.map(([x, z]) => ({ x, z, d: Math.hypot(x - tx, z - tz) })).sort((p, q) => p.d - q.d);
        const spot = near.find((c) => !this.check(fp, c.x, c.z, { ignoreRoads: true }) && !ctx.keepClear?.(shiftRect(fp.rect, c.x, c.z)));
        if (!spot) return null;
        moves.push({ id: rec.id, x: spot.x, z: spot.z, rot });
        this.buildings.set(rec.id, { record: { ...rec, x: spot.x, z: spot.z, rot }, fp, rect: shiftRect(fp.rect, spot.x, spot.z), blocks: [] });
      }
      return { moves, avenue: ctx.avenue ? ctx.avenue() : [] };
    } finally {
      this.buildings = saved;
    }
  }

  /**
   * Move buildings to new spots: each one lifts out, then drops in at its new place, one after another.
   * Then every road is laid again (or set to `paths`, for undo). onDone(roadCells).
   */
  applyMoves(moves, { paths = null, avenue = [] } = {}, onDone) {
    const changed = moves.filter((m) => {
      const e = this.buildings.get(m.id);
      return e && (e.record.x !== m.x || e.record.z !== m.z || (e.record.rot || 0) !== m.rot);
    });
    const finish = () => {
      this.extraReserve = [];
      onDone?.(paths ? this.setPaths(paths, true) : this.rerouteAll(true, avenue));
    };
    if (!changed.length) return void finish();
    this.extraReserve = changed.map((m) => {
      const e = this.buildings.get(m.id);
      return shiftRect(footprint(e.record.kind, e.record.variant, m.rot).rect, m.x, m.z);
    });
    const lifted = changed.map((m) => [m, this.removeBuilding(m.id, 'lift', null, { regrow: false })]);
    let left = lifted.length;
    lifted.forEach(([m, entry], i) => {
      setTimeout(() => {
        Object.assign(entry.record, { x: m.x, z: m.z, rot: m.rot });
        this.placeBuilding(entry.record, () => --left === 0 && finish(), { fast: true });
      }, 750 + i * 280);
    });
  }

  /** Lay every road again (after buildings moved); old roads that still serve are kept. Returns road cells. */
  rerouteAll(animate, extra = []) {
    const old = this.paths;
    this.preferRoads = old;
    this.paths = new Set();
    for (const [x, z] of extra) if (this.walkable(x, z) && !this.inPlaza(x, z)) this.paths.add(key2(x, z));
    for (const entry of this.buildings.values()) for (const [x, z] of this.routeFor(entry)) this.paths.add(key2(x, z));
    this.preferRoads = null;
    return this.commitPaths(old, animate);
  }

  /** Replace the road network with exactly these cells (undo). */
  setPaths(list, animate) {
    const old = this.paths;
    this.paths = new Set(list);
    return this.commitPaths(old, animate);
  }

  commitPaths(old, animate) {
    this.paving = this.paving.filter(([x, z]) => this.paths.has(key2(x, z)));
    for (const k of [...this.pendingPave]) if (!this.paths.has(k)) this.pendingPave.delete(k);
    if (animate)
      for (const k of this.paths)
        if (!old.has(k)) {
          this.paving.push(k.split(',').map(Number));
          this.pendingPave.add(k);
        }
    for (const k of old)
      if (!this.paths.has(k) && animate) {
        const [x, z] = k.split(',').map(Number);
        this.fx.puff(x, 0.55, z, 2, 0.3);
      }
    this.refreshTerrain(animate);
    return [...this.paths];
  }

  update(dt) {
    for (const e of this.emitters) {
      e.t -= dt;
      if (e.t <= 0) {
        if (e.spray) {
          this.fx.puff(e.x, e.y, e.z, 3, 0.25);
          e.t = 0.35 + Math.random() * 0.3;
        } else {
          this.fx.smoke(e.x, e.y, e.z);
          e.t = 0.9 + Math.random() * 0.9;
        }
      }
    }
    this.paveTimer -= dt;
    while (this.paving.length && this.paveTimer <= 0) {
      const [x, z] = this.paving.shift();
      this.pendingPave.delete(key2(x, z));
      this.applyTop(x, z);
      this.fx.puff(x, 0.55, z, 3, 0.35);
      sfx.pave();
      this.paveTimer += 0.06;
    }
    if (!this.paving.length) this.paveTimer = Math.max(0, this.paveTimer);
    for (const d of this.drips) {
      d.t -= dt;
      if (d.t <= 0) {
        d.t = 0.12 + Math.random() * 0.18;
        this.fx.drip(d.x + (Math.random() - 0.5) * 0.8, d.y, d.z + (Math.random() - 0.5) * 0.8);
      }
    }
    this.fx.update(dt);
  }

  // ---------- placement ----------

  /** Returns null when the spot is fine, otherwise a short reason. */
  check(fp, x, z, { ignoreRoads = false } = {}) {
    const b = shiftRect(fp.base, x, z);
    for (let cx = b.x0; cx <= b.x1; cx++)
      for (let cz = b.z0; cz <= b.z1; cz++) {
        if (!this.topCells.has(key2(cx, cz))) return 'Needs solid ground';
        const cell = this.cells.get(key2(cx, cz));
        if (cell?.water && !cell.path) return "Can't build on water";
      }
    const r = shiftRect(fp.rect, x, z);
    for (const l of this.landmarks) if (!apart(r, l.rect, 1)) return 'Too close to the water wheel';
    // decor may stand right up against buildings, the square and other decor (just not on them)
    if (this.square && !apart(r, this.squareRect(), fp.decor ? 0 : SQUARE_GAP)) return fp.decor ? 'Not on the town square' : 'Too close to the town square';
    for (const { rect: o, fp: ofp } of this.buildings.values()) {
      const gap = fp.decor || ofp.decor ? 0 : GAP;
      if (!apart(r, o, gap)) return gap ? 'Too close to another building' : 'Something is already there';
    }
    if (!ignoreRoads) for (let cx = r.x0; cx <= r.x1; cx++) for (let cz = r.z0; cz <= r.z1; cz++) if (this.paths.has(key2(cx, cz))) return 'Keep the road clear';
    return null;
  }

  /** Best free spot: near the centre so the village grows outward, with a little variety. */
  findSpot(fp, salt = 0) {
    const cells = [...this.topCells].map((key) => {
      const [x, z] = key.split(',').map(Number);
      return { x, z, score: Math.hypot(x, z) + (hash2(x * 73856093 + z, salt) / 4294967296) * 2.5 };
    });
    cells.sort((a, b) => a.score - b.score);
    for (const c of cells) if (!this.check(fp, c.x, c.z)) return c;
    return null;
  }

  /** Start placing a finished build. Returns false if nothing fits (caller grows the island). */
  beginPlacement(item) {
    const fp = footprint(item.kind, item.variant, 0);
    const spot = this.findSpot(fp, item.id);
    if (!spot) return false;
    this.placing = { item, rot: 0, x: spot.x, z: spot.z, reason: null };
    this.refreshGhost();
    return true;
  }

  movePlacement(x, z) {
    const p = this.placing;
    if (!p || (p.x === x && p.z === z)) return;
    p.x = x;
    p.z = z;
    this.refreshGhost();
  }

  rotatePlacement() {
    const p = this.placing;
    if (!p) return;
    p.rot = (p.rot + 1) & 3;
    this.refreshGhost();
  }

  refreshGhost() {
    const p = this.placing;
    const fp = footprint(p.item.kind, p.item.variant, p.rot);
    p.reason = this.check(fp, p.x, p.z, { ignoreRoads: !!p.move }); // a moved building's roads get re-routed
    this.fx.ghostPulse = false;
    this.fx.ghostMat.color.set(p.reason ? 0xff6a6a : 0xffffff);
    this.fx.ghostMat.opacity = p.reason ? 0.45 : 0.6;
    // pale versions of the real colours, so a red roof never reads as "can't place here"
    const pale = new THREE.Color(0xffffff);
    this.fx.ghostSet(
      placeBlocks(fp, p.x, p.z).map((b) => ({ ...b, color: new THREE.Color(b.color).lerp(pale, 0.7) })),
      { pop: false },
    );
    this.tiles.clear();
    this.tileMat.color.set(p.reason ? 0xff5c5c : 0x5be37d);
    const r = shiftRect(fp.rect, p.x, p.z);
    for (let x = r.x0; x <= r.x1; x++) for (let z = r.z0; z <= r.z1; z++) this.tiles.add(x, 0.53, z, 0xffffff);
  }

  endPlacement() {
    this.placing = null;
    this.fx.ghostClear();
    this.tiles.clear();
  }

  /** Grid cell under a screen ray, in island-local coordinates. */
  pick(raycaster) {
    this.group.updateMatrixWorld();
    const ray = raycaster.ray.clone().applyMatrix4(this.group.matrixWorld.clone().invert());
    const hit = new THREE.Vector3();
    if (!ray.intersectPlane(TOP, hit)) return null;
    return { x: Math.round(hit.x), z: Math.round(hit.z) };
  }
}

/** A painted block's colour, with the same gentle per-block variation as the blueprint's own. */
function paintColor(hex, variant, i) {
  return jitterColor(hex, mulberry32(hash2(variant, i + 7)), 0.03);
}

/** True when two rectangles have at least `gap` empty tiles between them on some axis. */
function apart(a, b, gap) {
  return b.x0 - a.x1 - 1 >= gap || a.x0 - b.x1 - 1 >= gap || b.z0 - a.z1 - 1 >= gap || a.z0 - b.z1 - 1 >= gap;
}
