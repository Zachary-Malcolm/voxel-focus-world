import * as THREE from 'three';
import { MultiBatch } from './kit.js';
import { mulberry32, hash2 } from './rng.js';
import { ROLE } from './catalog.js';

/*
 * The living village: little voxel people who walk the roads between their homes, workplaces and
 * the square (and go indoors at night with a lantern), plus sheep, cats, dogs, ducks, birds,
 * butterflies and fireflies. Everything moves slowly so it stays in the background while you focus.
 * Creatures are kit blocks posed every frame in island-local space (children of the home group).
 */

const UP = new THREE.Vector3(0, 1, 0);
const _qy = new THREE.Quaternion();
const _qp = new THREE.Quaternion();
const _qf = new THREE.Quaternion();
const _e = new THREE.Euler();
const _v = new THREE.Vector3();
const k2 = (x, z) => `${x},${z}`;
const DIR4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const lerpAngle = (a, b, t) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * t;
const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];

/** A creature made of posed parts. Part: { name, shape, mat, color, o:[x,y,z], s:[sx,sy,sz], pv?:[x,y,z] } */
class Body {
  constructor(batch, parts, scale = 1) {
    this.batch = batch;
    this.scale = scale;
    this.parts = parts.map((p) => ({ ...p, pv: p.pv || p.o, h: batch.add({ shape: p.shape, mat: p.mat }, 0, -200, 0, 0.0001, 0.0001, 0.0001, null, p.color) }));
  }
  /** anim: { part: { rx, ry, rz, dx, dy, dz } }, show: { part: bool } (parts with opt: true are hidden unless shown) */
  pose(x, y, z, yaw, anim = {}, show = {}, visible = true) {
    _qy.setFromAxisAngle(UP, yaw);
    const sc = this.scale;
    for (const p of this.parts) {
      if (!visible || (p.opt && !show[p.name])) {
        this.batch.set(p.h, x, y - 200, z, 0.0001);
        continue;
      }
      const a = anim[p.name];
      if (a) _qp.setFromEuler(_e.set(a.rx || 0, a.ry || 0, a.rz || 0));
      else _qp.identity();
      _v.set(p.o[0] - p.pv[0], p.o[1] - p.pv[1], p.o[2] - p.pv[2]).applyQuaternion(_qp);
      _v.x += p.pv[0] + (a?.dx || 0);
      _v.y += p.pv[1] + (a?.dy || 0);
      _v.z += p.pv[2] + (a?.dz || 0);
      _v.multiplyScalar(sc).applyQuaternion(_qy);
      _qf.multiplyQuaternions(_qy, _qp);
      this.batch.set(p.h, x + _v.x, y + _v.y, z + _v.z, p.s[0] * sc, p.s[1] * sc, p.s[2] * sc, _qf);
    }
  }
  dispose() {
    for (const p of this.parts) this.batch.remove(p.h);
  }
}

// ---------------------------------------------------------------- looks

const SKIN = ['#f6dcc5', '#f3d2b3', '#e0ac85', '#c68863', '#8d5a3b', '#5e3a24'];
const HAIR = ['#2b1d14', '#5a3a22', '#a0522d', '#e6c27a', '#d9d9d9', '#1c1c1c', '#b5562f'];
const SHIRT = ['#e85d5d', '#4f9de8', '#4fbf7a', '#f2a33a', '#c77dff', '#f6f0e4', '#3fa3a3', '#d9534a', '#ffd34d'];
const TROUSERS = ['#4a5568', '#6b4a2f', '#2f4f6f', '#5b5f73', '#7a5434'];
const UMBRELLA = ['#ff6f91', '#ffd34d', '#4f9de8', '#4fbf7a', '#e85d5d', '#c77dff'];
const HATS = {
  bakery: { shape: 'pillar', mat: 'cloth', color: '#ffffff', o: [0, 1.3, 0], s: [0.4, 0.3, 0.4] },
  windmill: { shape: 'slab', mat: 'cloth', color: '#e8dcc0', o: [0, 1.27, 0], s: [0.42, 0.3, 0.42] },
  stall: { shape: 'cone', mat: 'thatch', color: '#e3c46a', o: [0, 1.26, 0], s: [0.75, 0.22, 0.75] },
  castle: { shape: 'dome', mat: 'metal', color: '#9aa2ad', o: [0, 1.13, 0], s: [0.42, 0.26, 0.42] },
  lighthouse: { shape: 'slab', mat: 'cloth', color: '#3e6fd6', o: [0, 1.27, 0], s: [0.4, 0.3, 0.4] },
  cathedral: { shape: 'spire', mat: 'cloth', color: '#7b56c9', o: [0, 1.3, 0], s: [0.4, 0.4, 0.4] },
  tower: { shape: 'dome', mat: 'metal', color: '#9aa2ad', o: [0, 1.13, 0], s: [0.42, 0.26, 0.42] },
  greenhouse: { shape: 'cone', mat: 'thatch', color: '#e3c46a', o: [0, 1.26, 0], s: [0.75, 0.22, 0.75] },
  granary: { shape: 'cone', mat: 'thatch', color: '#d9b45a', o: [0, 1.26, 0], s: [0.75, 0.22, 0.75] },
  blacksmith: { shape: 'dome', mat: 'cloth', color: '#3b4250', o: [0, 1.13, 0], s: [0.4, 0.24, 0.4] },
  stable: { shape: 'slab', mat: 'cloth', color: '#7a5434', o: [0, 1.27, 0.02], s: [0.42, 0.24, 0.46] },
  tavern: { shape: 'slab', mat: 'cloth', color: '#f4efe4', o: [0, 1.27, 0], s: [0.4, 0.3, 0.4] },
  chapel: { shape: 'spire', mat: 'cloth', color: '#f4efe4', o: [0, 1.3, 0], s: [0.4, 0.4, 0.4] },
  library: { shape: 'slab', mat: 'cloth', color: '#2f3a5a', o: [0, 1.29, 0], s: [0.55, 0.16, 0.55] },
  wizardtower: { shape: 'cone', mat: 'cloth', color: '#5b3c8c', o: [0, 1.42, 0], s: [0.5, 0.55, 0.5] },
};

function villagerParts(rng, job) {
  const skin = pick(rng, SKIN);
  const shirt = pick(rng, SHIRT);
  const tr = pick(rng, TROUSERS);
  const parts = [
    { name: 'legL', shape: 'post', mat: 'cloth', color: tr, o: [-0.11, 0.22, 0], s: [0.6, 0.44, 0.6], pv: [-0.11, 0.44, 0] },
    { name: 'legR', shape: 'post', mat: 'cloth', color: tr, o: [0.11, 0.22, 0], s: [0.6, 0.44, 0.6], pv: [0.11, 0.44, 0] },
    { name: 'body', shape: 'cube', mat: 'cloth', color: shirt, o: [0, 0.64, 0], s: [0.42, 0.42, 0.28] },
    { name: 'armL', shape: 'post', mat: 'cloth', color: shirt, o: [-0.27, 0.64, 0], s: [0.45, 0.36, 0.45], pv: [-0.27, 0.82, 0] },
    { name: 'armR', shape: 'post', mat: 'cloth', color: shirt, o: [0.27, 0.64, 0], s: [0.45, 0.36, 0.45], pv: [0.27, 0.82, 0] },
    { name: 'head', shape: 'cube', mat: 'plaster', color: skin, o: [0, 1.0, 0], s: [0.34, 0.32, 0.32] },
    { name: 'hair', shape: 'cube', mat: 'cloth', color: pick(rng, HAIR), o: [0, 1.14, -0.03], s: [0.37, 0.12, 0.36] },
    { name: 'eyeL', shape: 'orb', mat: 'plaster', color: '#2b2b2b', o: [-0.075, 1.02, 0.165], s: [0.17, 0.17, 0.1] },
    { name: 'eyeR', shape: 'orb', mat: 'plaster', color: '#2b2b2b', o: [0.075, 1.02, 0.165], s: [0.17, 0.17, 0.1] },
    { name: 'umbrella', opt: true, shape: 'dome', mat: 'cloth', color: pick(rng, UMBRELLA), o: [0.05, 1.6, 0], s: [1, 0.36, 1] },
    { name: 'handle', opt: true, shape: 'post', mat: 'wood', color: '#6b4a2f', o: [0.05, 1.3, 0], s: [0.2, 0.62, 0.2] },
    { name: 'lamp', opt: true, shape: 'orb', mat: 'lantern', color: '#ffd36b', o: [0.31, 0.42, 0.08], s: [0.42, 0.5, 0.42], pv: [0.27, 0.82, 0] },
  ];
  if (HATS[job]) parts.push({ name: 'hat', ...HATS[job] });
  return parts;
}

function sheepParts(rng) {
  const wool = pick(rng, ['#f7f4ec', '#f2eee4', '#fbfaf5', '#e9e4d8']);
  const face = pick(rng, ['#3b3330', '#2b2522', '#f0e2d0']);
  const H = [0, 0.68, 0.36]; // neck pivot
  return [
    // a cloud of wool puffs
    { name: 'body', shape: 'orb', mat: 'snow', color: wool, o: [0, 0.58, -0.17], s: 0.72 },
    { name: 'body2', shape: 'orb', mat: 'snow', color: wool, o: [0, 0.6, 0.17], s: 0.72 },
    { name: 'body3', shape: 'orb', mat: 'snow', color: wool, o: [-0.2, 0.55, 0], s: 0.56 },
    { name: 'body4', shape: 'orb', mat: 'snow', color: wool, o: [0.2, 0.55, 0], s: 0.56 },
    { name: 'body5', shape: 'orb', mat: 'snow', color: wool, o: [0, 0.8, -0.02], s: 0.56 },
    { name: 'head', shape: 'cube', mat: 'plaster', color: face, o: [0, 0.68, 0.5], s: [0.26, 0.28, 0.3], pv: H },
    { name: 'tuft', shape: 'orb', mat: 'snow', color: wool, o: [0, 0.86, 0.5], s: 0.3, pv: H },
    { name: 'eyeL', shape: 'orb', mat: 'plaster', color: '#1c1c1c', o: [-0.08, 0.72, 0.69], s: 0.08, pv: H },
    { name: 'eyeR', shape: 'orb', mat: 'plaster', color: '#1c1c1c', o: [0.08, 0.72, 0.69], s: 0.08, pv: H },
    ...[[-0.15, -0.2], [0.15, -0.2], [-0.15, 0.2], [0.15, 0.2]].map(([x, z], i) => ({
      name: `leg${i}`,
      shape: 'post',
      mat: 'plaster',
      color: face,
      o: [x, 0.17, z],
      s: [0.42, 0.3, 0.42],
      pv: [x, 0.32, z],
    })),
  ].map((p) => (typeof p.s === 'number' ? { ...p, s: [p.s, p.s, p.s] } : p));
}

function petParts(rng, dog) {
  const fur = dog ? pick(rng, ['#b07a4f', '#3b3330', '#e8dcc0', '#8d5a3b', '#f2f2f2']) : pick(rng, ['#f2a33a', '#7d8796', '#2b2b2b', '#f4efe6', '#c9783f']);
  const len = dog ? 0.6 : 0.46;
  const h = dog ? 0.42 : 0.32;
  return [
    { name: 'body', shape: 'cube', mat: 'cloth', color: fur, o: [0, h, 0], s: [dog ? 0.32 : 0.26, dog ? 0.28 : 0.22, len] },
    { name: 'head', shape: 'cube', mat: 'cloth', color: fur, o: [0, h + 0.14, len / 2 + 0.06], s: [dog ? 0.28 : 0.25, 0.24, dog ? 0.3 : 0.22], pv: [0, h + 0.05, len / 2] },
    { name: 'earL', shape: dog ? 'cube' : 'spire', mat: 'cloth', color: fur, o: [-0.08, h + (dog ? 0.2 : 0.3), len / 2 + 0.03], s: dog ? [0.08, 0.16, 0.08] : [0.14, 0.14, 0.12], pv: [0, h + 0.05, len / 2] },
    { name: 'earR', shape: dog ? 'cube' : 'spire', mat: 'cloth', color: fur, o: [0.08, h + (dog ? 0.2 : 0.3), len / 2 + 0.03], s: dog ? [0.08, 0.16, 0.08] : [0.14, 0.14, 0.12], pv: [0, h + 0.05, len / 2] },
    { name: 'nose', shape: 'orb', mat: 'plaster', color: dog ? '#2b2b2b' : '#ff9fb0', o: [0, h + 0.13, len / 2 + 0.18 + (dog ? 0.04 : 0)], s: [0.13, 0.13, 0.13], pv: [0, h + 0.05, len / 2] },
    { name: 'tail', shape: 'post', mat: 'cloth', color: fur, o: [0, h + 0.12, -len / 2 - 0.08], s: [0.22, dog ? 0.32 : 0.45, 0.22], pv: [0, h + 0.02, -len / 2] },
    ...[[-0.08, -len / 3], [0.08, -len / 3], [-0.08, len / 3], [0.08, len / 3]].map(([x, z], i) => ({
      name: `leg${i}`,
      shape: 'post',
      mat: 'cloth',
      color: fur,
      o: [x, h / 2 - 0.04, z],
      s: [0.24, h - 0.06, 0.24],
      pv: [x, h - 0.06, z],
    })),
  ];
}

function duckParts(rng) {
  const male = rng() < 0.5;
  return [
    { name: 'body', shape: 'blob', mat: 'cloth', color: male ? '#e9e4d8' : '#a07b56', o: [0, 0.1, 0], s: [0.34, 0.24, 0.5] },
    { name: 'head', shape: 'orb', mat: 'cloth', color: male ? '#2f8a4a' : '#8d6748', o: [0, 0.3, 0.18], s: [0.26, 0.26, 0.26] },
    { name: 'beak', shape: 'orb', mat: 'plaster', color: '#f2a33a', o: [0, 0.28, 0.33], s: [0.12, 0.07, 0.16] },
    { name: 'tail', shape: 'spire', mat: 'cloth', color: male ? '#e9e4d8' : '#a07b56', o: [0, 0.17, -0.24], s: [0.14, 0.16, 0.14] },
  ];
}

function birdParts(rng) {
  const c = pick(rng, ['#4f9de8', '#e85d5d', '#5a4a42', '#f2a33a', '#3b3330']);
  return [
    { name: 'body', shape: 'blob', mat: 'cloth', color: c, o: [0, 0, 0], s: [0.28, 0.22, 0.42] },
    { name: 'head', shape: 'orb', mat: 'cloth', color: c, o: [0, 0.08, 0.2], s: [0.55, 0.55, 0.55] },
    { name: 'beak', shape: 'orb', mat: 'plaster', color: '#ffcf45', o: [0, 0.07, 0.33], s: [0.2, 0.15, 0.3] },
    { name: 'wingL', shape: 'cube', mat: 'cloth', color: c, o: [-0.28, 0.03, 0], s: [0.38, 0.05, 0.24], pv: [-0.08, 0.03, 0] },
    { name: 'wingR', shape: 'cube', mat: 'cloth', color: c, o: [0.28, 0.03, 0], s: [0.38, 0.05, 0.24], pv: [0.08, 0.03, 0] },
  ];
}

function butterflyParts(rng) {
  const c = pick(rng, ['#ffd34d', '#ff9f43', '#6fc3ff', '#ff6f91', '#ffffff', '#c77dff']);
  return [
    { name: 'body', shape: 'post', mat: 'cloth', color: '#3b3330', o: [0, 0, 0], s: [0.12, 0.05, 0.12] },
    { name: 'wingL', shape: 'cube', mat: 'cloth', color: c, o: [-0.11, 0, 0], s: [0.2, 0.025, 0.2], pv: [0, 0, 0] },
    { name: 'wingR', shape: 'cube', mat: 'cloth', color: c, o: [0.11, 0, 0], s: [0.2, 0.025, 0.2], pv: [0, 0, 0] },
  ];
}

// ---------------------------------------------------------------- the village

export class Life {
  constructor(home) {
    this.home = home;
    this.group = new THREE.Group();
    home.group.add(this.group);
    this.batch = new MultiBatch(this.group);
    this.version = -1;
    this.time = 0;
    this.villagers = [];
    this.sheep = [];
    this.pets = [];
    this.ducks = [];
    this.birds = [];
    this.flies = [];
    this.butterflies = [];
    this.roads = new Set();
    this.spots = [];
    this.serial = 0;
  }

  // ---------- reading the world ----------

  occupied(x, z) {
    for (const { rect } of this.home.buildings.values()) if (x >= rect.x0 && x <= rect.x1 && z >= rect.z0 && z <= rect.z1) return true;
    for (const { rect } of this.home.landmarks) if (x >= rect.x0 && x <= rect.x1 && z >= rect.z0 && z <= rect.z1) return true;
    const c = this.home.construction?.rect;
    if (c && x >= c.x0 && x <= c.x1 && z >= c.z0 && z <= c.z1) return true;
    return this.home.inFountain(x, z);
  }

  /** Ground an animal may stand on. */
  grass(x, z) {
    const c = this.home.cells.get(k2(x, z));
    return !!c && !c.water && !c.blocked && !this.occupied(x, z) && !this.roads.has(k2(x, z)) && !c.rim;
  }

  land(x, z) {
    const c = this.home.cells.get(k2(x, z));
    return !!c && (!c.water || c.path) && !c.blocked && !c.rim && !this.occupied(x, z);
  }

  /** Can a creature step from cell a to cell b without climbing a cliff? */
  climbable(ax, az, bx, bz) {
    const a = this.home.cells.get(k2(ax, az));
    const b = this.home.cells.get(k2(bx, bz));
    return !a || !b || Math.abs((a.hill || 0) - (b.hill || 0)) <= 1;
  }

  water(x, z) {
    const c = this.home.cells.get(k2(x, z));
    return !!c && !!c.water && !c.path && !c.rim;
  }

  groundY(x, z) {
    return this.home.groundAt(x, z)?.y ?? 0.5;
  }

  /** Re-read roads, doors and land, then add or remove creatures to suit the village. */
  sync() {
    const home = this.home;
    this.roads = new Set();
    for (const k of home.paths) this.roads.add(k);
    if (home.square) for (const [x, z] of home.plazaCells()) if (!home.inFountain(x, z)) this.roads.add(k2(x, z));

    // a door spot per building: the road cell touching its rectangle (or the nearest road)
    this.spots = [];
    const roadList = [...this.roads].map((k) => k.split(',').map(Number));
    for (const [id, e] of home.buildings) {
      if (ROLE(e.record.kind) === 'decor') continue; // nobody lives or works in a lamp post
      const r = e.rect;
      let best = null;
      let bd = Infinity;
      for (const [x, z] of roadList) {
        const dx = x < r.x0 ? r.x0 - x : x > r.x1 ? x - r.x1 : 0;
        const dz = z < r.z0 ? r.z0 - z : z > r.z1 ? z - r.z1 : 0;
        const d = dx + dz;
        if (d < bd) {
          bd = d;
          best = [x, z];
        }
      }
      if (best && bd <= 3) this.spots.push({ id, kind: e.record.kind, x: best[0], z: best[1], enter: e.record.kind !== 'tree' && e.record.kind !== 'well' });
    }
    this.plaza = roadList.filter(([x, z]) => home.inPlaza(x, z));

    const kinds = [...home.buildings.values()].map((e) => e.record.kind).filter((k) => ROLE(k) !== 'decor');
    const homes = kinds.filter((k) => ROLE(k) === 'home').length;
    const works = kinds.filter((k) => ROLE(k) === 'work').length;
    const wantPeople = this.roads.size ? Math.min(22, 1 + homes * 2 + works) : 0;
    const radius = Math.sqrt(home.topCells.size / Math.PI);
    const wantSheep = Math.min(10, Math.max(2, Math.floor(radius / 3)));
    const wantCats = Math.min(4, 1 + Math.floor(kinds.length / 4));
    const wantDogs = Math.min(3, Math.floor(kinds.length / 4));
    const waterCells = [...home.cells.values()].filter((c) => c.water && !c.path && !c.rim).length;
    const wantDucks = waterCells >= 5 ? Math.min(6, 1 + Math.floor(waterCells / 12)) : 0;

    this.resize(this.villagers, wantPeople, () => this.makeVillager());
    this.resize(this.sheep, wantSheep, () => this.makeAnimal('sheep'));
    this.resize(
      this.pets,
      wantCats + wantDogs,
      () => this.makeAnimal(this.pets.filter((p) => p.dog).length < wantDogs ? 'dog' : 'cat'),
    );
    this.resize(this.ducks, wantDucks, () => this.makeAnimal('duck'));
    if (!this.birds.length) for (let i = 0; i < 7; i++) this.birds.push(this.makeBird(i));
    if (!this.flies.length) for (let i = 0; i < 26; i++) this.flies.push(this.makeFly(i));
    if (!this.butterflies.length) for (let i = 0; i < 6; i++) this.butterflies.push(this.makeButterfly(i));
    // anyone now standing somewhere impossible (a building landed on them) steps away
    for (const v of this.villagers) if (!this.roads.has(k2(Math.round(v.x), Math.round(v.z)))) this.placeOnRoad(v);
    for (const a of [...this.sheep, ...this.pets]) if (!this.land(Math.round(a.x), Math.round(a.z))) this.placeOn(a, a.kind === 'sheep' ? this.grass.bind(this) : this.land.bind(this));
    for (const d of this.ducks) if (!this.water(Math.round(d.x), Math.round(d.z))) this.placeOn(d, this.water.bind(this));
  }

  resize(list, n, make) {
    while (list.length > n) list.pop().body.dispose();
    while (list.length < n) {
      const c = make();
      if (!c) break;
      list.push(c);
    }
  }

  randomCell(ok, rng = Math.random) {
    const cells = [...this.home.cells.values()];
    for (let i = 0; i < 80; i++) {
      const c = cells[Math.floor(rng() * cells.length)];
      if (c && ok(c.x, c.z)) return c;
    }
    return null;
  }

  placeOn(a, ok) {
    const c = this.randomCell(ok);
    if (!c) return false;
    a.x = c.x + (Math.random() - 0.5) * 0.4;
    a.z = c.z + (Math.random() - 0.5) * 0.4;
    a.y = this.groundY(a.x, a.z);
    a.tx = a.x;
    a.tz = a.z;
    return true;
  }

  // ---------- villagers ----------

  makeVillager() {
    const rng = mulberry32(hash2(this.home.seed, 5000 + this.serial++));
    const workplaces = this.spots.filter((s) => ROLE(s.kind) === 'work');
    const homes = this.spots.filter((s) => ROLE(s.kind) === 'home');
    const job = workplaces.length ? pick(rng, workplaces) : null;
    const home = homes.length ? pick(rng, homes) : null;
    const v = {
      body: new Body(this.batch, villagerParts(rng, job?.kind), 0.92 + rng() * 0.12),
      job: job?.id ?? null,
      jobKind: job?.kind,
      home: home?.id ?? null,
      x: 0,
      y: 0.5,
      z: 0,
      yaw: rng() * 6.28,
      path: [],
      mode: 'idle',
      timer: rng() * 4,
      phase: rng() * 6,
      speed: 0.75 + rng() * 0.3,
      off: [(rng() - 0.5) * 0.45, (rng() - 0.5) * 0.45],
      cheer: 0,
      working: false,
    };
    this.placeOnRoad(v);
    return v;
  }

  placeOnRoad(v) {
    const roads = [...this.roads];
    if (!roads.length) return;
    const [x, z] = roads[Math.floor(Math.random() * roads.length)].split(',').map(Number);
    v.x = x + v.off[0];
    v.z = z + v.off[1];
    v.y = this.groundY(x, z);
    v.path = [];
    v.mode = 'idle';
    v.timer = 1 + Math.random() * 3;
  }

  /** Breadth-first walk over road cells. */
  route(from, to) {
    const start = k2(from[0], from[1]);
    const goal = k2(to[0], to[1]);
    if (!this.roads.has(start) || !this.roads.has(goal)) return null;
    const prev = new Map([[start, null]]);
    const queue = [start];
    while (queue.length) {
      const k = queue.shift();
      if (k === goal) break;
      const [x, z] = k.split(',').map(Number);
      for (const [dx, dz] of DIR4) {
        const nk = k2(x + dx, z + dz);
        if (this.roads.has(nk) && !prev.has(nk)) {
          prev.set(nk, k);
          queue.push(nk);
        }
      }
    }
    if (!prev.has(goal)) return null;
    const out = [];
    for (let k = goal; k; k = prev.get(k)) out.push(k.split(',').map(Number));
    return out.reverse().slice(1);
  }

  goTo(v, spot, then) {
    const path = this.route([Math.round(v.x - v.off[0]), Math.round(v.z - v.off[1])], [spot.x, spot.z]);
    if (!path) {
      v.mode = 'idle';
      v.timer = 2;
      v.then = null;
      return false;
    }
    v.path = path;
    v.mode = 'walk';
    v.then = then;
    return true;
  }

  nextErrand(v, night) {
    const home = this.spots.find((s) => s.id === v.home);
    if (night) {
      const bed = home || this.spots.find((s) => s.enter) || null;
      if (!bed || !this.goTo(v, bed, 'sleep')) {
        // nowhere reachable to go: slip indoors where they are until morning
        v.mode = 'inside';
        v.then = 'sleep';
        v.timer = 5 + Math.random() * 20;
      }
      return;
    }
    const r = Math.random();
    const job = this.spots.find((s) => s.id === v.job);
    if (job && r < 0.45) this.goTo(v, job, Math.random() < 0.35 && job.enter ? 'inside' : 'work');
    else if (this.plaza.length && r < 0.75) {
      const [x, z] = pick(Math.random, this.plaza);
      this.goTo(v, { x, z }, 'chat');
    } else if (this.spots.length) this.goTo(v, pick(Math.random, this.spots), Math.random() < 0.3 ? 'inside' : 'chat');
  }

  stepVillager(v, dt, ctx) {
    const night = ctx.day < 0.32;
    v.phase += dt;
    if (v.mode === 'inside') {
      v.timer -= dt;
      if (v.timer <= 0 && !(v.then === 'sleep' && night)) {
        v.mode = 'idle';
        v.timer = 0.5;
      }
      v.body.pose(v.x, v.y, v.z, v.yaw, {}, {}, false);
      return;
    }
    if (v.mode === 'walk' && night && v.then !== 'sleep') {
      // it got dark on the way: turn round and head home
      this.nextErrand(v, true);
    }
    if (v.mode === 'walk') {
      const next = v.path[0];
      if (!next) {
        // arrived
        if (v.then === 'sleep' || v.then === 'inside') {
          v.mode = 'inside';
          v.timer = v.then === 'sleep' ? 2 + Math.random() * 20 : 8 + Math.random() * 20;
        } else {
          v.mode = 'idle';
          v.working = v.then === 'work';
          v.timer = v.then === 'work' ? 8 + Math.random() * 14 : 4 + Math.random() * 9;
        }
      } else {
        const tx = next[0] + v.off[0];
        const tz = next[1] + v.off[1];
        const dx = tx - v.x;
        const dz = tz - v.z;
        const d = Math.hypot(dx, dz);
        const step = v.speed * dt;
        if (d <= step) {
          v.x = tx;
          v.z = tz;
          v.path.shift();
        } else {
          v.x += (dx / d) * step;
          v.z += (dz / d) * step;
        }
        v.yaw = lerpAngle(v.yaw, Math.atan2(dx, dz), Math.min(1, dt * 8));
      }
    } else {
      v.timer -= dt;
      if (night && v.then !== 'sleep') v.timer = Math.min(v.timer, 0);
      if (v.timer <= 0) {
        v.working = false;
        this.nextErrand(v, night);
      }
    }
    const gy = this.groundY(v.x, v.z);
    v.y += (gy - v.y) * Math.min(1, dt * 10);
    const walking = v.mode === 'walk';
    const swing = walking ? Math.sin(v.phase * v.speed * 9) : 0;
    const anim = {
      legL: { rx: swing * 0.6 },
      legR: { rx: -swing * 0.6 },
      armL: { rx: -swing * 0.5 },
      armR: { rx: swing * 0.5 },
      body: {},
    };
    let bob = walking ? Math.abs(swing) * 0.04 : 0;
    if (v.working) {
      // busy hands: kneading, hammering, sweeping...
      const w = Math.sin(v.phase * 5);
      anim.armR = { rx: -1.2 - w * 0.5 };
      anim.armL = { rx: -0.6 + w * 0.3 };
    } else if (!walking && v.mode === 'idle') {
      anim.head = { ry: Math.sin(v.phase * 0.7) * 0.4 };
      anim.hair = anim.head;
      anim.eyeL = anim.head;
      anim.eyeR = anim.head;
    }
    if (v.cheer > 0) {
      v.cheer -= dt;
      bob = Math.abs(Math.sin(v.cheer * 7)) * 0.35;
      anim.armL = { rz: -2.6 };
      anim.armR = { rz: 2.6 };
    }
    const rain = ctx.rain > 0.3 && v.cheer <= 0;
    if (rain) anim.armR = { rx: -0.3, rz: 0.2 };
    v.body.pose(v.x, v.y + bob, v.z, v.yaw, anim, { umbrella: rain, handle: rain, lamp: ctx.day < 0.45 && !rain }, true);
  }

  // ---------- animals ----------

  makeAnimal(kind) {
    const rng = mulberry32(hash2(this.home.seed, 9000 + this.serial++));
    const parts = kind === 'sheep' ? sheepParts(rng) : kind === 'duck' ? duckParts(rng) : petParts(rng, kind === 'dog');
    const scale = kind === 'sheep' && rng() < 0.3 ? 0.7 : 1; // lambs
    const a = {
      kind,
      dog: kind === 'dog',
      body: new Body(this.batch, parts, scale),
      x: 0,
      y: 0.5,
      z: 0,
      tx: 0,
      tz: 0,
      yaw: rng() * 6.28,
      mode: 'rest',
      timer: rng() * 5,
      phase: rng() * 6,
      speed: { sheep: 0.45, cat: 0.6, dog: 0.9, duck: 0.35 }[kind],
      hop: 0,
    };
    const ok = kind === 'sheep' ? this.grass.bind(this) : kind === 'duck' ? this.water.bind(this) : this.land.bind(this);
    if (!this.placeOn(a, ok)) {
      a.body.dispose();
      return null;
    }
    return a;
  }

  wanderTarget(a, ok, reach) {
    for (let i = 0; i < 12; i++) {
      const x = Math.round(a.x + (Math.random() - 0.5) * 2 * reach);
      const z = Math.round(a.z + (Math.random() - 0.5) * 2 * reach);
      const mx = Math.round((a.x + x) / 2);
      const mz = Math.round((a.z + z) / 2);
      if (ok(x, z) && ok(mx, mz)) {
        a.tx = x + (Math.random() - 0.5) * 0.5;
        a.tz = z + (Math.random() - 0.5) * 0.5;
        return true;
      }
    }
    return false;
  }

  stepAnimal(a, dt, ctx) {
    a.phase += dt;
    const ok = a.kind === 'sheep' ? this.grass.bind(this) : a.kind === 'duck' ? this.water.bind(this) : this.land.bind(this);
    if (a.mode === 'walk') {
      let tx = a.tx;
      let tz = a.tz;
      if (a.dog && a.follow) {
        tx = a.follow.x - Math.sin(a.follow.yaw) * 0.9;
        tz = a.follow.z - Math.cos(a.follow.yaw) * 0.9;
      }
      const dx = tx - a.x;
      const dz = tz - a.z;
      const d = Math.hypot(dx, dz);
      const speed = a.dog && a.follow && d > 2 ? 1.6 : a.speed;
      if (d < 0.08 || (a.dog && a.follow && d < 0.35)) {
        if (!(a.dog && a.follow && a.follow.mode === 'walk')) {
          a.mode = 'rest';
          a.timer = a.kind === 'sheep' ? 3 + Math.random() * 7 : a.kind === 'cat' ? 4 + Math.random() * 14 : 2 + Math.random() * 5;
          a.pose = a.kind === 'cat' && Math.random() < 0.4 ? 'sleep' : a.kind === 'cat' ? 'sit' : a.kind === 'sheep' && Math.random() < 0.7 ? 'graze' : 'stand';
        }
      } else {
        const step = Math.min(d, speed * dt);
        const nx = a.x + (dx / d) * step;
        const nz = a.z + (dz / d) * step;
        const cx = Math.round(nx);
        const cz = Math.round(nz);
        const same = cx === Math.round(a.x) && cz === Math.round(a.z);
        if (same || (a.dog && a.follow) || (ok(cx, cz) && this.climbable(Math.round(a.x), Math.round(a.z), cx, cz))) {
          a.x = nx;
          a.z = nz;
        } else a.mode = 'rest';
        a.yaw = lerpAngle(a.yaw, Math.atan2(dx, dz), Math.min(1, dt * 5));
      }
    } else {
      a.timer -= dt;
      if (a.timer <= 0) {
        a.pose = null;
        if (a.dog && Math.random() < 0.6 && this.villagers.length) {
          const v = pick(Math.random, this.villagers.filter((v) => v.mode !== 'inside'));
          a.follow = v || null;
          a.followFor = 15 + Math.random() * 25;
          a.mode = 'walk';
        } else {
          a.follow = null;
          if (this.wanderTarget(a, ok, a.kind === 'duck' ? 3 : 3.5)) a.mode = 'walk';
          else a.timer = 2;
        }
      }
    }
    if (a.follow) {
      a.followFor -= dt;
      if (a.followFor <= 0 || a.follow.mode === 'inside') {
        a.follow = null;
        a.mode = 'rest';
        a.timer = 3;
      }
    }
    const ground = a.kind === 'duck' ? 0.02 : this.groundY(a.x, a.z);
    a.y += (ground - a.y) * Math.min(1, dt * 8);
    let lift = 0;
    if (a.hop > 0) {
      a.hop -= dt;
      lift = Math.abs(Math.sin(a.hop * 9)) * 0.35;
    }
    const walking = a.mode === 'walk';
    const t = a.phase;
    const anim = {};
    if (a.kind === 'duck') {
      lift += Math.sin(t * 2) * 0.03;
      anim.head = { dy: walking ? 0 : Math.max(0, Math.sin(t * 0.8)) * -0.05 };
      anim.beak = anim.head;
    } else {
      const sw = walking ? Math.sin(t * (a.kind === 'sheep' ? 8 : 12)) * 0.5 : 0;
      for (let i = 0; i < 4; i++) anim[`leg${i}`] = { rx: (i === 0 || i === 3 ? sw : -sw) };
      if (a.kind === 'sheep') {
        const graze = a.pose === 'graze' ? 0.6 + Math.sin(t * 3) * 0.08 : 0;
        anim.head = { rx: graze };
        anim.tuft = anim.eyeL = anim.eyeR = anim.head;
      } else {
        const tailWag = a.dog ? Math.sin(t * (walking || a.follow ? 14 : 4)) * 0.6 : Math.sin(t * 1.5) * 0.3;
        anim.tail = { rx: a.dog ? -0.9 : -0.6, rz: tailWag };
        if (a.pose === 'sit' || a.pose === 'sleep') {
          const low = a.pose === 'sleep' ? -0.16 : -0.08;
          anim.body = { dy: low, rx: a.pose === 'sit' ? -0.35 : 0 };
          // legs tuck forward under the body (back legs when sitting, all four when curled up asleep)
          for (let i = 0; i < 4; i++) anim[`leg${i}`] = i < 2 || a.pose === 'sleep' ? { dy: low * 0.6, rx: -1.45 } : { dy: low * 0.3 };
          const lie = a.pose === 'sleep' ? -0.18 : 0;
          for (const n of ['head', 'earL', 'earR', 'nose']) anim[n] = { dy: lie + low * 0.5 };
          anim.tail = { ...anim.tail, dy: low };
        } else {
          anim.head = { ry: Math.sin(t * 0.6) * 0.3 };
          for (const n of ['earL', 'earR', 'nose']) anim[n] = anim.head;
        }
      }
    }
    a.body.pose(a.x, a.y + lift, a.z, a.yaw, anim, {}, true);
  }

  // ---------- birds, fireflies, butterflies ----------

  makeBird(i) {
    const rng = mulberry32(hash2(this.home.seed, 7000 + i));
    return {
      body: new Body(this.batch, birdParts(rng), 1.1),
      flock: i % 2,
      off: [(rng() - 0.5) * 3, (rng() - 0.5) * 1.5, (rng() - 0.5) * 3],
      phase: rng() * 6,
      flap: 6 + rng() * 3,
    };
  }

  makeFly(i) {
    const rng = mulberry32(hash2(this.home.seed, 8000 + i));
    const h = this.batch.add({ shape: 'orb', mat: 'lantern' }, 0, -200, 0, 0.0001, 0.0001, 0.0001, null, '#fff3a0');
    return { h, cx: 0, cz: 0, rng, phase: rng() * 10, speed: 0.3 + rng() * 0.4, anchored: false };
  }

  makeButterfly(i) {
    const rng = mulberry32(hash2(this.home.seed, 8500 + i));
    return { body: new Body(this.batch, butterflyParts(rng), 1.2), x: 0, y: 1, z: 0, tx: 0, ty: 1, tz: 0, yaw: 0, phase: rng() * 6, placed: false };
  }

  stepSky(dt, ctx) {
    const R = Math.sqrt(this.home.topCells.size / Math.PI);
    const birdsOut = ctx.day > 0.45 && ctx.rain < 0.5;
    for (const b of this.birds) {
      b.phase += dt;
      const a = this.time * (b.flock ? 0.07 : -0.055) + (b.flock ? 0 : 2.5);
      const r = R * (b.flock ? 0.55 : 0.8);
      const x = Math.cos(a) * r + b.off[0];
      const z = Math.sin(a) * r + b.off[2];
      const y = (b.flock ? 11 : 14) + b.off[1] + Math.sin(b.phase * 0.8) * 0.4;
      const yaw = Math.atan2(-Math.sin(a), Math.cos(a)) * (b.flock ? 1 : -1) + (b.flock ? 0 : Math.PI);
      const f = Math.sin(b.phase * b.flap) * 0.8;
      const glide = Math.sin(b.phase * 0.5) > 0.3; // flap a while, glide a while
      b.body.pose(x, y, z, yaw, { wingL: { rz: glide ? -0.1 : f }, wingR: { rz: glide ? 0.1 : -f } }, {}, birdsOut);
    }
    const night = Math.max(0, Math.min(1, (0.45 - ctx.day) / 0.25)) * (1 - ctx.rain);
    for (const f of this.flies) {
      if (!f.anchored) {
        const c = this.randomCell((x, z) => this.grass(x, z), f.rng);
        if (c) {
          f.cx = c.x;
          f.cz = c.z;
          f.cy = this.groundY(c.x, c.z);
          f.anchored = true;
        }
      }
      f.phase += dt * f.speed;
      const s = night * (0.55 + 0.45 * Math.sin(f.phase * 5)) * 0.32;
      this.batch.set(
        f.h,
        f.cx + Math.sin(f.phase * 1.3) * 0.9,
        f.cy + 0.9 + Math.sin(f.phase * 0.9) * 0.5,
        f.cz + Math.cos(f.phase * 1.1) * 0.9,
        Math.max(0.0001, s),
      );
    }
    const fine = ctx.day > 0.6 && ctx.rain < 0.1 && ctx.cloud < 0.7;
    for (const b of this.butterflies) {
      b.phase += dt;
      if (!b.placed || Math.hypot(b.tx - b.x, b.tz - b.z) < 0.2) {
        const base = b.placed ? null : this.randomCell((x, z) => this.grass(x, z));
        if (base) {
          b.x = b.tx = base.x;
          b.z = b.tz = base.z;
          b.y = this.groundY(base.x, base.z) + 1;
          b.placed = true;
        }
        b.tx = b.x + (Math.random() - 0.5) * 3;
        b.tz = b.z + (Math.random() - 0.5) * 3;
        b.ty = this.groundY(b.tx, b.tz) + 0.7 + Math.random() * 1.2;
      }
      const dx = b.tx - b.x;
      const dz = b.tz - b.z;
      const d = Math.hypot(dx, dz) || 1;
      b.x += (dx / d) * dt * 0.6;
      b.z += (dz / d) * dt * 0.6;
      b.y += (b.ty - b.y) * dt + Math.sin(b.phase * 6) * dt * 0.4;
      b.yaw = lerpAngle(b.yaw, Math.atan2(dx, dz), dt * 3);
      const f = Math.sin(b.phase * 16) * 0.9;
      b.body.pose(b.x, b.y, b.z, b.yaw, { wingL: { rz: f }, wingR: { rz: -f } }, {}, fine);
    }
  }

  // ---------- events ----------

  /** A building just landed at (x, z): people nearby cheer and some wander over; animals startle. */
  celebrate(x, z) {
    this.sync();
    const spot = this.spots.find((s) => Math.abs(s.x - x) + Math.abs(s.z - z) < 8);
    for (const v of this.villagers) {
      if (v.mode === 'inside') continue;
      if (Math.hypot(v.x - x, v.z - z) < 14) {
        v.cheer = 2 + Math.random() * 0.8;
        if (spot && Math.random() < 0.5) setTimeout(() => this.goTo(v, spot, 'chat'), 2600);
      }
    }
    for (const a of [...this.sheep, ...this.pets]) if (Math.hypot(a.x - x, a.z - z) < 7) a.hop = 0.7;
  }

  update(dt, ctx) {
    this.time += dt;
    if (this.version !== this.home.version) {
      this.version = this.home.version;
      this.sync();
    }
    for (const v of this.villagers) this.stepVillager(v, dt, ctx);
    for (const a of this.sheep) this.stepAnimal(a, dt, ctx);
    for (const a of this.pets) this.stepAnimal(a, dt, ctx);
    for (const a of this.ducks) this.stepAnimal(a, dt, ctx);
    this.stepSky(dt, ctx);
  }
}
