import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32, hash2 } from './rng.js';

/*
 * The building kit: materials (each with its own small procedural texture), shapes (not everything
 * is a cube), and MultiBatch, which draws any mix of shape x material as instanced meshes.
 *
 * A block is { x, y, z, color, mat?, shape?, r?, s? }:
 *   mat    key of MATERIALS (default 'plaster')
 *   shape  key of SHAPES (default 'cube'); every shape fits the unit cell centred on (x, y, z)
 *   r      quarter turns around y (0..3), same sense as rotateXZ. Wedges and stairs climb towards -z
 *          at r=0, so their slope faces the front (+z).
 *   s      scale: a number or [sx, sy, sz] in the block's own axes
 * Textures are greyscale and multiply the block colour, so colours stay true and editable.
 */

// ---------------------------------------------------------------- textures

const TEX = 32;

function makeTexture(name, paint, size = TEX) {
  const rng = mulberry32(hash2(0x7e57, [...name].reduce((a, c) => a * 31 + c.charCodeAt(0), 7)));
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(size, size);
  const v = paint(size, rng);
  for (let i = 0; i < size * size; i++) {
    const g = Math.max(0, Math.min(255, Math.round(v[i] * 255)));
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = g;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  return tex;
}

const field = (n, fn) => {
  const a = new Float32Array(n * n);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) a[y * n + x] = fn(x, y);
  return a;
};

/** Tileable cellular pattern: distance to nearest/second-nearest of k random points. */
function cells(n, rng, k) {
  const pts = Array.from({ length: k }, () => [rng() * n, rng() * n, rng()]);
  return (x, y) => {
    let d1 = 1e9;
    let d2 = 1e9;
    let id = 0;
    for (const [px, py, t] of pts)
      for (let ox = -n; ox <= n; ox += n)
        for (let oy = -n; oy <= n; oy += n) {
          const d = Math.hypot(x + 0.5 - px - ox, y + 0.5 - py - oy);
          if (d < d1) {
            d2 = d1;
            d1 = d;
            id = t;
          } else if (d < d2) d2 = d;
        }
    return { edge: d2 - d1, tone: id };
  };
}

const PAINTERS = {
  plaster: (n, r) => field(n, () => 0.93 + r() * 0.07),
  grass: (n, r) => {
    const a = field(n, () => 0.86 + r() * 0.1);
    for (let i = 0; i < 26; i++) {
      // little blades: 2-3 px light strokes
      const x = Math.floor(r() * n);
      const y = Math.floor(r() * n);
      const len = 2 + Math.floor(r() * 2);
      for (let k = 0; k < len; k++) a[((y + k) % n) * n + x] = 1 - k * 0.04;
    }
    return a;
  },
  dirt: (n, r) => {
    const a = field(n, () => 0.84 + r() * 0.12);
    for (let i = 0; i < 18; i++) {
      const x = Math.floor(r() * n);
      const y = Math.floor(r() * n);
      a[y * n + x] = 0.66;
      a[y * n + ((x + 1) % n)] = 0.74;
    }
    return a;
  },
  sand: (n, r) => field(n, (x, y) => 0.9 + r() * 0.08 + ((x * 7 + y * 3) % 11 === 0 ? -0.06 : 0)),
  stone: (n, r) => {
    const c = cells(n, r, 7);
    return field(n, (x, y) => {
      const { edge, tone } = c(x, y);
      return edge < 1.3 ? 0.6 : 0.8 + tone * 0.14 + r() * 0.05;
    });
  },
  rock: (n, r) => {
    const c = cells(n, r, 5);
    return field(n, (x, y) => {
      const { edge, tone } = c(x, y);
      return (edge < 0.9 ? 0.72 : 0.84 + tone * 0.1) + r() * 0.07;
    });
  },
  brick: (n, r) => {
    const tones = Array.from({ length: 64 }, () => 0.8 + r() * 0.16);
    return field(n, (x, y) => {
      const row = Math.floor(y / 8);
      const xx = (x + (row & 1) * 8) % n;
      if (y % 8 === 7 || xx % 16 === 15) return 0.62;
      return tones[(row * 4 + Math.floor(xx / 16)) % 64] + r() * 0.04;
    });
  },
  wood: (n, r) => {
    const tones = [0.86, 0.94, 0.82, 0.9];
    const knots = Array.from({ length: 3 }, () => [r() * n, r() * n]);
    return field(n, (x, y) => {
      const plank = Math.floor(y / 8);
      if (y % 8 === 0) return 0.6;
      let v = tones[plank % 4] + 0.05 * Math.sin(x * 0.55 + plank * 2 + Math.sin(y * 0.9) * 1.5);
      for (const [kx, ky] of knots) if (Math.hypot(x - kx, y - ky) < 1.6) v -= 0.16;
      return v + r() * 0.03;
    });
  },
  log: (n, r) => {
    const cols = Array.from({ length: n }, () => r());
    return field(n, (x, y) => {
      const c = cols[x];
      if (c < 0.12) return 0.58 + r() * 0.06; // deep bark cracks
      return 0.78 + c * 0.16 + 0.04 * Math.sin(y * 0.8 + x) + r() * 0.04;
    });
  },
  roof: (n, r) => {
    const tones = Array.from({ length: 32 }, () => 0.84 + r() * 0.12);
    return field(n, (x, y) => {
      const row = Math.floor(y / 6);
      const xx = (x + (row & 1) * 4) % n;
      const k = y % 6;
      if (xx % 8 === 0) return 0.7;
      return tones[(row * 4 + Math.floor(xx / 8)) % 32] - (k === 5 ? 0.18 : k === 4 ? 0.08 : 0) + r() * 0.03;
    });
  },
  thatch: (n, r) => {
    const cols = Array.from({ length: n }, () => r());
    return field(n, (x, y) => {
      const band = y % 8;
      return 0.8 + cols[(x + Math.floor(y / 8) * 3) % n] * 0.16 - (band === 7 ? 0.16 : 0) + r() * 0.04;
    });
  },
  glass: (n, r) =>
    field(n, (x, y) => {
      const frame = x < 3 || y < 3 || x >= n - 3 || y >= n - 3;
      const mull = Math.abs(x - n / 2 + 0.5) < 1 || Math.abs(y - n / 2 + 0.5) < 1;
      if (frame) return 0.55 + r() * 0.04;
      if (mull) return 0.62;
      const streak = (x + y) % n;
      return streak > 7 && streak < 11 ? 1 : 0.86 + (y / n) * 0.08;
    }),
  metal: (n, r) => {
    const rows = Array.from({ length: n }, () => r());
    return field(n, (x, y) => {
      if ((x === 3 || x === n - 4) && (y === 3 || y === n - 4)) return 1; // rivets
      return 0.82 + rows[y] * 0.1 + r() * 0.03;
    });
  },
  cloth: (n, r) => field(n, (x, y) => ((x + y) & 1 ? 0.86 : 0.96) - ((x % 4 === 0) ^ (y % 4 === 0) ? 0.04 : 0) + r() * 0.03),
  leaves: (n, r) => {
    const a = field(n, () => 0.76 + r() * 0.08);
    for (let i = 0; i < 30; i++) {
      const cx = r() * n;
      const cy = r() * n;
      const rad = 1.2 + r() * 2.2;
      const lift = 0.1 + r() * 0.14;
      for (let y = Math.floor(cy - rad); y <= cy + rad; y++)
        for (let x = Math.floor(cx - rad); x <= cx + rad; x++)
          if (Math.hypot(x - cx, y - cy) <= rad) {
            const i2 = (((y % n) + n) % n) * n + (((x % n) + n) % n);
            a[i2] = Math.min(1, a[i2] + lift);
          }
    }
    return a;
  },
  water: (n, r) => field(n, (x, y) => 0.86 + 0.08 * Math.sin((x + Math.sin(y * 0.4) * 3) * 0.5) + (r() < 0.03 ? 0.1 : 0)),
  crystal: (n) => field(n, (x, y) => 0.78 + 0.22 * (((x + y) % 12) / 12) + (Math.abs(x - y) % 16 < 1 ? 0.1 : 0)),
  lantern: (n) =>
    field(n, (x, y) => {
      const frame = x < 4 || y < 4 || x >= n - 4 || y >= n - 4;
      return frame ? 0.55 : 1;
    }),
  gold: (n, r) => field(n, (x, y) => 0.86 + 0.1 * Math.sin((x - y) * 0.4) + r() * 0.03),
  snow: (n, r) => field(n, () => 0.95 + r() * 0.05),
  moss: (n, r) => {
    const c = cells(n, r, 9);
    return field(n, (x, y) => 0.8 + c(x, y).tone * 0.16 + r() * 0.05);
  },
};

/**
 * name: { label, rough, metal, glow (night emissive strength), glowColor, flat? }
 * Order is the order the editor lists them in.
 */
export const MATERIALS = {
  plaster: { label: 'Plaster', rough: 0.86 },
  wood: { label: 'Planks', rough: 0.8 },
  log: { label: 'Bark', rough: 0.92 },
  stone: { label: 'Cobble', rough: 0.9 },
  rock: { label: 'Rough stone', rough: 0.95 },
  brick: { label: 'Brick', rough: 0.88 },
  roof: { label: 'Shingles', rough: 0.72 },
  thatch: { label: 'Thatch', rough: 0.97 },
  glass: { label: 'Glass', rough: 0.12, metal: 0.1, glow: 1.15, glowColor: 0xffc66b },
  lantern: { label: 'Lantern', rough: 0.45, glow: 2.2, glowColor: 0xffb347, dayGlow: 0.25 },
  crystal: { label: 'Crystal', rough: 0.1, metal: 0.2, glow: 1.2, glowColor: 0x9fd8ff, dayGlow: 0.18 },
  metal: { label: 'Iron', rough: 0.38, metal: 0.45 },
  gold: { label: 'Gold', rough: 0.3, metal: 0.55 },
  cloth: { label: 'Cloth', rough: 0.97 },
  leaves: { label: 'Leaves', rough: 0.9 },
  grass: { label: 'Grass', rough: 0.95 },
  moss: { label: 'Moss', rough: 0.95 },
  dirt: { label: 'Dirt', rough: 0.97 },
  sand: { label: 'Sand', rough: 0.97 },
  water: { label: 'Water', rough: 0.08, metal: 0.05 },
  snow: { label: 'Snow', rough: 0.9 },
};

const textures = {};
function texture(name) {
  return (textures[name] ??= makeTexture(name, PAINTERS[name] || PAINTERS.plaster));
}

const materials = new Map();
const glowing = [];
let nightLevel = 0;

export function materialFor(mat, shape) {
  const def = MATERIALS[mat] || MATERIALS.plaster;
  const flat = !!SHAPE_DEFS[shape]?.flat;
  const key = `${mat}|${flat ? 1 : 0}`;
  let m = materials.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      map: texture(MATERIALS[mat] ? mat : 'plaster'),
      roughness: def.rough ?? 0.85,
      metalness: def.metal ?? 0,
      flatShading: flat,
    });
    if (def.glow) {
      m.emissive = new THREE.Color(def.glowColor);
      m.emissiveMap = m.map;
      m.userData.glow = def;
      glowing.push(m);
      applyGlow(m);
    }
    materials.set(key, m);
  }
  return m;
}

function applyGlow(m) {
  const g = m.userData.glow;
  m.emissiveIntensity = (g.dayGlow || 0) + nightLevel * g.glow;
}

/** Slow drift of the water texture so lakes shimmer and the river flows. */
export function tickMaterials(dt) {
  const w = textures.water;
  if (w) {
    w.offset.x = (w.offset.x + dt * 0.06) % 1;
    w.offset.y = (w.offset.y + dt * 0.025) % 1;
  }
}

/** 0 = full day, 1 = deep night: windows and lanterns light up. */
export function setNight(k) {
  nightLevel = k;
  for (const m of glowing) applyGlow(m);
}

// ---------------------------------------------------------------- shapes

function wedgeGeometry() {
  const pos = [];
  const uv = [];
  const quad = (a, b, c, d) => {
    pos.push(...a, ...b, ...c, ...a, ...c, ...d);
    uv.push(0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1);
  };
  const tri = (a, b, c) => {
    pos.push(...a, ...b, ...c);
    uv.push(0, 0, 1, 0, 0, 1);
  };
  const h = 0.5;
  quad([-h, -h, -h], [h, -h, -h], [h, -h, h], [-h, -h, h]); // bottom
  quad([h, -h, -h], [-h, -h, -h], [-h, h, -h], [h, h, -h]); // back (tall side)
  quad([-h, -h, h], [h, -h, h], [h, h, -h], [-h, h, -h]); // slope, facing +z and up
  tri([h, -h, h], [h, -h, -h], [h, h, -h]); // +x side
  tri([-h, -h, -h], [-h, -h, h], [-h, h, -h]); // -x side
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}

/** Outer corner of a hip roof: a pyramid whose two slopes face +x and +z at r=0. */
function cornerGeometry() {
  const h = 0.5;
  const pos = [];
  const uv = [];
  const tri = (a, b, c) => {
    pos.push(...a, ...b, ...c);
    uv.push(0, 0, 1, 0, 0, 1);
  };
  const b0 = [-h, -h, -h];
  const b1 = [h, -h, -h];
  const b2 = [h, -h, h];
  const b3 = [-h, -h, h];
  const A = [-h, h, -h];
  tri(b0, b1, b2);
  tri(b0, b2, b3); // bottom
  tri(b1, b0, A); // back
  tri(b0, b3, A); // left
  tri(b2, b1, A); // slope +x
  tri(b3, b2, A); // slope +z
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}

function box(w, h, d, x = 0, y = 0, z = 0, radius = 0) {
  const g = radius > 0 ? new RoundedBoxGeometry(w, h, d, 1, radius) : new THREE.BoxGeometry(w, h, d);
  g.translate(x, y, z);
  return g;
}

/** Merge parts that may differ in index/attribute layout. */
function merge(parts) {
  return mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p)).map((p) => {
    for (const k of Object.keys(p.attributes)) if (!['position', 'normal', 'uv'].includes(k)) p.deleteAttribute(k);
    return p;
  }));
}

function rockGeometry() {
  const g = new THREE.DodecahedronGeometry(0.6, 0);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    // move shared corners identically (hash of the rounded corner position)
    const h = hash2(Math.round(x * 100) + 1000, Math.round(y * 100) * 4096 + Math.round(z * 100));
    const k = 0.82 + ((h % 1000) / 1000) * 0.32;
    p.setXYZ(i, x * k, y * k * 0.8, z * k);
  }
  g.computeVertexNormals();
  return g;
}

/** label, make(), flat (faceted shading for low-poly shapes). */
const SHAPE_DEFS = {
  cube: { label: 'Block', make: () => new RoundedBoxGeometry(1, 1, 1, 2, 0.1) },
  slab: { label: 'Slab', make: () => box(1, 0.5, 1, 0, -0.25, 0, 0.07) },
  topslab: { label: 'Top slab', make: () => box(1, 0.5, 1, 0, 0.25, 0, 0.07) },
  wedge: { label: 'Slope', make: wedgeGeometry },
  corner: { label: 'Roof corner', make: cornerGeometry },
  stair: { label: 'Stair', make: () => merge([box(1, 0.5, 1, 0, -0.25, 0), box(1, 0.5, 0.5, 0, 0.25, -0.25)]) },
  pillar: { label: 'Pillar', flat: true, make: () => new THREE.CylinderGeometry(0.4, 0.4, 1, 8) },
  logx: { label: 'Log', flat: true, make: () => new THREE.CylinderGeometry(0.42, 0.42, 1, 8).rotateZ(Math.PI / 2) },
  post: { label: 'Post', make: () => box(0.3, 1, 0.3, 0, 0, 0, 0.05) },
  beam: { label: 'Beam', make: () => box(1, 0.3, 0.3, 0, 0, 0, 0.05) },
  pane: { label: 'Panel', make: () => box(1, 1, 0.2, 0, 0, 0, 0.04) },
  fence: {
    label: 'Fence',
    make: () => merge([box(0.22, 0.95, 0.22, 0, -0.03, 0), box(1, 0.12, 0.1, 0, -0.12, 0), box(1, 0.12, 0.1, 0, 0.22, 0)]),
  },
  cone: { label: 'Cone', flat: true, make: () => new THREE.ConeGeometry(0.62, 1, 8) },
  spire: { label: 'Spire', flat: true, make: () => new THREE.ConeGeometry(0.46, 1, 6) },
  dome: { label: 'Dome', flat: true, make: () => new THREE.SphereGeometry(0.5, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2).scale(1.06, 2, 1.06).translate(0, -0.5, 0) },
  blob: { label: 'Bush', flat: true, make: () => new THREE.IcosahedronGeometry(0.64, 0) },
  orb: { label: 'Orb', flat: true, make: () => new THREE.IcosahedronGeometry(0.3, 1) },
  rock: { label: 'Boulder', flat: true, make: rockGeometry },
  arch: {
    label: 'Arch',
    make: () => {
      const s = new THREE.Shape();
      s.moveTo(-0.5, -0.5);
      s.lineTo(-0.5, 0.5);
      s.lineTo(0.5, 0.5);
      s.lineTo(0.5, -0.5);
      s.lineTo(0.3, -0.5);
      s.absarc(0, -0.5, 0.3, 0, Math.PI, false);
      s.lineTo(-0.5, -0.5);
      const g = new THREE.ExtrudeGeometry(s, { depth: 1, bevelEnabled: false, curveSegments: 6 });
      g.translate(0, 0, -0.5);
      // ExtrudeGeometry UVs are in shape units; fine for these textures
      return g;
    },
  },
};

export const SHAPES = Object.fromEntries(Object.entries(SHAPE_DEFS).map(([k, v]) => [k, v.label]));

const geometries = {};
export function geometryFor(shape) {
  return (geometries[shape] ??= (SHAPE_DEFS[shape] || SHAPE_DEFS.cube).make());
}

// ---------------------------------------------------------------- per-block pose

const YAW = [0, 1, 2, 3].map((r) => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), (-r * Math.PI) / 2));
const ONE = [1, 1, 1];

/** Fill in the block's cached rotation + scale vector (call again after changing r or s). */
export function prep(b) {
  b.q = YAW[((b.r || 0) % 4 + 4) % 4];
  b.sv = b.s == null ? ONE : Array.isArray(b.s) ? b.s : [b.s, b.s, b.s];
  return b;
}

export const keyOf = (b) => `${b.shape || 'cube'}|${b.mat || 'plaster'}`;

// ---------------------------------------------------------------- MultiBatch

const _m = new THREE.Matrix4();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();
const _q = new THREE.Quaternion();

/** One growable InstancedMesh with handle-based add/remove (swap-remove keeps it dense). */
class Pool {
  constructor(parent, geometry, material, shadows, renderOrder) {
    this.parent = parent;
    this.geometry = geometry;
    this.material = material;
    this.shadows = shadows;
    this.renderOrder = renderOrder;
    this.handles = []; // slot -> global handle
    this.mesh = this.makeMesh(64);
  }
  makeMesh(cap) {
    const mesh = new THREE.InstancedMesh(this.geometry, this.material, cap);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.setColorAt(0, _c.set(0xffffff));
    mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.castShadow = mesh.receiveShadow = this.shadows;
    mesh.renderOrder = this.renderOrder;
    this.parent.add(mesh);
    return mesh;
  }
  grow() {
    const old = this.mesh;
    const mesh = this.makeMesh(old.instanceMatrix.count * 2);
    mesh.instanceMatrix.array.set(old.instanceMatrix.array);
    mesh.instanceColor.array.set(old.instanceColor.array);
    mesh.count = old.count;
    mesh.instanceMatrix.needsUpdate = mesh.instanceColor.needsUpdate = true;
    this.parent.remove(old);
    old.dispose();
    this.mesh = mesh;
  }
}

/**
 * Draws blocks of any shape x material. Callers get global handles; each handle lives in the pool
 * for its key. Same verbs as the old single-mesh batch: add / set / setColor / remove / clear.
 */
export class MultiBatch {
  constructor(parent, { shadows = true, renderOrder = 0, material = materialFor, keyFn = keyOf } = {}) {
    this.parent = parent;
    this.shadows = shadows;
    this.renderOrder = renderOrder;
    this.material = material;
    this.keyFn = keyFn;
    this.pools = new Map();
    this.where = new Map(); // handle -> [pool, slot]
    this.next = 1;
    this.count = 0;
  }

  pool(b) {
    const key = this.keyFn(b);
    let p = this.pools.get(key);
    if (!p) {
      const shape = b.shape || 'cube';
      p = new Pool(this.parent, geometryFor(shape), this.material(b.mat || 'plaster', shape), this.shadows, this.renderOrder);
      this.pools.set(key, p);
    }
    return p;
  }

  /** Add block b (uses its shape/mat/color) at a pose. */
  add(b, x, y, z, sx = 1, sy = sx, sz = sx, q = null, color = b.color) {
    const p = this.pool(b);
    if (p.mesh.count >= p.mesh.instanceMatrix.count) p.grow();
    const slot = p.mesh.count++;
    const h = this.next++;
    p.handles[slot] = h;
    this.where.set(h, [p, slot]);
    this.count++;
    this.set(h, x, y, z, sx, sy, sz, q);
    this.setColor(h, color);
    return h;
  }

  set(h, x, y, z, sx = 1, sy = sx, sz = sx, q = null) {
    const w = this.where.get(h);
    if (!w) return;
    _p.set(x, y, z);
    _s.set(sx, sy, sz);
    _m.compose(_p, q || YAW[0], _s);
    w[0].mesh.setMatrixAt(w[1], _m);
    w[0].mesh.instanceMatrix.needsUpdate = true;
  }

  setColor(h, color) {
    const w = this.where.get(h);
    if (!w) return;
    w[0].mesh.setColorAt(w[1], color instanceof THREE.Color ? color : _c.set(color));
    w[0].mesh.instanceColor.needsUpdate = true;
  }

  remove(h) {
    const w = this.where.get(h);
    if (!w) return;
    const [p, slot] = w;
    const mesh = p.mesh;
    const last = mesh.count - 1;
    if (slot !== last) {
      mesh.getMatrixAt(last, _m);
      mesh.setMatrixAt(slot, _m);
      mesh.getColorAt(last, _c);
      mesh.setColorAt(slot, _c);
      const moved = p.handles[last];
      p.handles[slot] = moved;
      this.where.get(moved)[1] = slot;
    }
    p.handles.length = last;
    mesh.count = last;
    mesh.instanceMatrix.needsUpdate = mesh.instanceColor.needsUpdate = true;
    this.where.delete(h);
    this.count--;
  }

  clear() {
    for (const p of this.pools.values()) {
      p.mesh.count = 0;
      p.handles.length = 0;
    }
    this.where.clear();
    this.count = 0;
  }

  get size() {
    return this.count;
  }

  /** Meshes for raycasting. */
  get meshes() {
    return [...this.pools.values()].map((p) => p.mesh);
  }

  /** The handle drawn by instance `id` of `mesh` (from a raycast hit), or null. */
  handleAt(mesh, id) {
    for (const p of this.pools.values()) if (p.mesh === mesh) return p.handles[id] ?? null;
    return null;
  }

  dispose() {
    for (const p of this.pools.values()) {
      this.parent.remove(p.mesh);
      p.mesh.dispose();
    }
    this.pools.clear();
    this.where.clear();
  }
}

/** Add block b to batch at its own position, rotation and scale. Returns the handle. */
export function addBlock(batch, b, dx = 0, dy = 0, dz = 0, color = b.color) {
  if (!b.q) prep(b);
  return batch.add(b, b.x + dx, b.y + dy, b.z + dz, b.sv[0], b.sv[1], b.sv[2], b.q, color);
}

export { _q as scratchQuat };
