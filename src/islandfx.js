import * as THREE from 'three';
import { VoxelBatch, voxelGeometry } from './voxels.js';
import { MultiBatch, prep } from './kit.js';
import * as sfx from './audio.js';

const GRAVITY = 62;
export const DROP_HEIGHT = 10;
const SETTLE_TIME = 0.7;
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();

/**
 * One voxel island's drawing + juice: solid blocks, a translucent ghost layer, dust,
 * and the drop / hop / crumble animations. Blocks are plain objects {x,y,z,color,handle}.
 */
export class IslandFX {
  constructor(parent, { capacity = 12000, ghostCapacity = 800 } = {}) {
    this.group = new THREE.Group();
    parent.add(this.group);

    // blocks of every shape x material; capacity grows on demand (the old fixed sizes are ignored)
    void capacity;
    void ghostCapacity;
    this.blocks = new MultiBatch(this.group);

    this.ghostMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.3, depthWrite: false });
    this.ghost = new MultiBatch(this.group, { shadows: false, renderOrder: 2, material: () => this.ghostMat, keyFn: (b) => b.shape || 'cube' });
    this.ghostPulse = true;
    this.ghostPops = [];

    const dustMat = new THREE.MeshStandardMaterial({ color: 0xf3ead9, roughness: 1 });
    this.dust = new VoxelBatch(voxelGeometry(0.26, 0.05), dustMat, 1500, { shadows: false });
    this.group.add(this.dust.mesh);
    this.dustParts = [];

    this.anims = [];
    this.time = 0;
    this.lastLand = -10;
    this.lastSound = -10;
    this.combo = 0;
    this.spinners = [];
    this.byHandle = new Map(); // block handle -> block, for picking
  }

  // ---------- spinning parts (windmill sails) ----------

  /** Move blocks into their own rotating group around pivot. Blocks keep their island coordinates. */
  addSpinner(blocks, pivot, axis, speed = 0.7) {
    const group = new THREE.Group();
    group.position.set(pivot[0], pivot[1], pivot[2]);
    this.group.add(group);
    const batch = new MultiBatch(group);
    const s = { group, batch, axis, speed, blocks, byHandle: new Map() };
    for (const b of blocks) {
      this.remove(b);
      prep(b);
      b.sh = batch.add(b, b.x - pivot[0], b.y - pivot[1], b.z - pivot[2], b.sv[0], b.sv[1], b.sv[2], b.q);
      b.spinner = s;
      s.byHandle.set(b.sh, b);
    }
    this.spinners.push(s);
    return s;
  }

  removeSpinner(s) {
    for (const b of s.blocks) {
      b.sh = null;
      b.spinner = null;
    }
    s.batch.dispose();
    this.group.remove(s.group);
    this.spinners = this.spinners.filter((x) => x !== s);
  }

  /** A slow wisp of chimney smoke. */
  smoke(x, y, z) {
    const handle = this.dust.add(x, y, z, 0xffffff, 0.01);
    if (handle == null) return;
    this.dustParts.push({
      handle,
      x,
      y,
      z,
      vx: (Math.random() - 0.5) * 0.35 + 0.25,
      vy: 0.9 + Math.random() * 0.3,
      vz: (Math.random() - 0.5) * 0.35,
      life: 0,
      max: 2.4 + Math.random() * 0.8,
      s: 1.6 + Math.random() * 0.6,
      smoke: true,
    });
  }

  /** Waterfall spray: a droplet that falls and fades. */
  drip(x, y, z) {
    const handle = this.dust.add(x, y, z, 0xffffff, 0.01);
    if (handle == null) return;
    this.dustParts.push({ handle, x, y, z, vx: (Math.random() - 0.5) * 0.4, vy: -0.5, vz: (Math.random() - 0.5) * 0.4, life: 0, max: 1.4 + Math.random() * 0.6, s: 0.6 + Math.random() * 0.5, fall: true });
  }

  get busy() {
    return this.anims.length > 0;
  }

  add(b) {
    prep(b);
    b.handle = this.blocks.add(b, b.x, b.y, b.z, b.sv[0], b.sv[1], b.sv[2], b.q);
    this.byHandle.set(b.handle, b);
    return b.handle;
  }

  remove(b) {
    if (b.handle != null) {
      this.blocks.remove(b.handle);
      this.byHandle.delete(b.handle);
    }
    b.handle = null;
  }

  /** Show a block in another colour without changing it (selection flash). Works on turning parts too. */
  tint(b, color) {
    if (b.handle != null) this.blocks.setColor(b.handle, color);
    else if (b.spinner && b.sh != null) b.spinner.batch.setColor(b.sh, color);
  }

  /** The block under a screen ray (solid blocks and turning parts), nearest first: { b, point } or null. */
  pickBlock(raycaster, accept = () => true) {
    const meshes = [...this.blocks.meshes];
    for (const s of this.spinners) meshes.push(...s.batch.meshes);
    for (const m of meshes) m.boundingSphere = null; // instances move: recompute before raycasting
    const hits = raycaster.intersectObjects(meshes, false);
    for (const h of hits) {
      if (h.instanceId == null) continue;
      let b = null;
      const hb = this.blocks.handleAt(h.object, h.instanceId);
      if (hb != null) b = this.byHandle.get(hb);
      else
        for (const s of this.spinners) {
          const hs = s.batch.handleAt(h.object, h.instanceId);
          if (hs != null) {
            b = s.byHandle.get(hs);
            break;
          }
        }
      if (b) return accept(b) ? { b, point: h.point } : null;
    }
    return null;
  }

  /** Place a block's instance: animation scale (sx,sy,sz) and spin q stack on the block's own r and s. */
  pose(b, x, y, z, sx = 1, sy = sx, sz = sx, q = null) {
    const v = b.sv;
    this.blocks.set(b.handle, x, y, z, sx * v[0], sy * v[1], sz * v[2], q ? _q2.multiplyQuaternions(q, b.q) : b.q);
  }

  setColor(b, color) {
    b.color = color;
    if (b.handle != null) this.blocks.setColor(b.handle, color);
  }

  /** Change colour / material / shape / rotation of a standing block (moves it between pools). */
  restyle(b, changes) {
    Object.assign(b, changes);
    if (b.handle == null) return;
    this.blocks.remove(b.handle);
    this.add(b);
  }

  // ---------- animations ----------

  drop(b, { delay = 0, height = DROP_HEIGHT, velocity = 1, onEnd } = {}) {
    prep(b);
    b.handle = this.blocks.add(b, b.x, b.y + height, b.z, 0);
    this.byHandle.set(b.handle, b);
    this.anims.push({ kind: 'drop', b, delay, t: 0, phase: 'wait', height, fall: Math.sqrt((2 * height) / GRAVITY), velocity, onEnd });
  }

  /** Celebration hop: the block jumps a little and lands again with a thock. */
  hop(b, { delay = 0, velocity = 1, onEnd } = {}) {
    if (b.handle == null) return void onEnd?.();
    this.anims.push({ kind: 'hop', b, delay, t: 0, phase: 'wait', velocity, onEnd });
  }

  crumble(b, { delay = 0, cx = 0, cz = 0, index = 0, onEnd } = {}) {
    if (b.handle == null) return void onEnd?.();
    const out = Math.atan2(b.z - cz, b.x - cx) + (Math.random() - 0.5) * 1.6;
    const speed = 1.5 + Math.random() * 2.5;
    this.anims.push({
      kind: 'crumble',
      b,
      delay,
      t: 0,
      phase: 'wait',
      index,
      vx: Math.cos(out) * speed,
      vy: 3 + Math.random() * 3,
      vz: Math.sin(out) * speed,
      axis: new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize(),
      spin: (Math.random() * 2 - 1) * 9,
      onEnd,
    });
  }

  /** Packed away: the block floats up, shrinking, and is gone (store / move). */
  lift(b, { delay = 0, onEnd } = {}) {
    if (b.handle == null) return void onEnd?.();
    this.anims.push({ kind: 'lift', b, delay, t: 0, phase: 'wait', onEnd });
  }

  /** Run one animation over many blocks with a stagger; onDone fires once after the last one ends. */
  many(kind, blocks, stagger, opts = {}, onDone) {
    let left = blocks.length;
    if (!left) return void onDone?.();
    const done = () => {
      if (--left === 0) onDone?.();
    };
    blocks.forEach((b, i) => this[kind](b, { ...opts, delay: (opts.delay || 0) + i * stagger, index: i, onEnd: done }));
  }

  /** Jump every running animation to its end state without callbacks or sound. */
  finishAll() {
    for (const a of this.anims) {
      if (a.kind === 'crumble' || a.kind === 'lift') this.remove(a.b);
      else this.pose(a.b, a.b.x, a.b.y, a.b.z);
    }
    this.anims = [];
  }

  // ---------- dust ----------

  puff(x, y, z, count = 8, strength = 1) {
    for (let k = 0; k < count; k++) {
      const a = (k / count) * Math.PI * 2 + Math.random() * 0.6;
      const sp = (2.2 + Math.random() * 2.2) * strength;
      const handle = this.dust.add(x, y, z, 0xffffff, 1);
      if (handle == null) return;
      this.dustParts.push({
        handle,
        x,
        y,
        z,
        vx: Math.cos(a) * sp,
        vy: 0.8 + Math.random() * 1.6,
        vz: Math.sin(a) * sp,
        life: 0,
        max: 0.45 + Math.random() * 0.3,
        s: 0.8 + Math.random() * 0.8,
      });
    }
  }

  puffRing(radius) {
    for (let k = 0; k < 28; k++) {
      const a = (k / 28) * Math.PI * 2;
      this.puff(Math.cos(a) * radius, 0.5, Math.sin(a) * radius, 4, 1.4);
    }
  }

  // ---------- ghost ----------

  ghostSet(blocks, { pop = true } = {}) {
    this.ghost.clear();
    this.ghostPops = [];
    blocks.forEach((b, i) => {
      prep(b);
      const k = pop ? 0.01 : 0.94;
      const handle = this.ghost.add(b, b.x, b.y, b.z, k * b.sv[0], k * b.sv[1], k * b.sv[2], b.q);
      if (pop) this.ghostPops.push({ handle, b, born: this.time + i * 0.012 });
    });
  }

  ghostClear() {
    this.ghost.clear();
    this.ghostPops = [];
  }

  // ---------- per frame ----------

  update(dt) {
    this.time += dt;
    const keep = [];
    const ended = [];
    for (const a of this.anims) {
      a.t += dt;
      let alive;
      if (a.kind === 'crumble') alive = this.stepCrumble(a, dt);
      else if (a.kind === 'lift') alive = this.stepLift(a);
      else alive = this.stepMove(a);
      if (alive) keep.push(a);
      else ended.push(a.onEnd);
    }
    this.anims = keep;
    for (const fn of ended) fn?.();

    const dk = [];
    for (const p of this.dustParts) {
      p.life += dt;
      if (p.life >= p.max) {
        this.dust.remove(p.handle);
        continue;
      }
      if (p.fall) {
        p.vy -= 9 * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.z += p.vz * dt;
        const k = p.life / p.max;
        this.dust.set(p.handle, p.x, p.y, p.z, Math.max(0.01, p.s * (1 - k) * Math.min(1, p.life * 8)));
        dk.push(p);
        continue;
      }
      if (p.smoke) {
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.z += p.vz * dt;
        const k = p.life / p.max;
        this.dust.set(p.handle, p.x, p.y, p.z, Math.max(0.01, p.s * Math.sin(Math.PI * k) * (0.6 + k)));
        dk.push(p);
        continue;
      }
      const drag = Math.exp(-5 * dt);
      p.vx *= drag;
      p.vz *= drag;
      p.vy = p.vy * drag + 0.6 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      this.dust.set(p.handle, p.x, p.y, p.z, p.s * Math.sqrt(1 - p.life / p.max));
      dk.push(p);
    }
    this.dustParts = dk;

    if (this.ghostPops.length) {
      const still = [];
      for (const g of this.ghostPops) {
        const age = this.time - g.born;
        if (age < 0) {
          still.push(g);
          continue;
        }
        const s = age > 0.5 ? 1 : 1 - Math.exp(-9 * age) * Math.cos(16 * age);
        const k = Math.max(0.01, s) * 0.94;
        const v = g.b.sv;
        this.ghost.set(g.handle, g.b.x, g.b.y, g.b.z, k * v[0], k * v[1], k * v[2], g.b.q);
        if (age <= 0.5) still.push(g);
      }
      this.ghostPops = still;
    }
    if (this.ghostPulse) this.ghostMat.opacity = 0.26 + 0.08 * Math.sin(this.time * 2.2);
    for (const s of this.spinners) s.group.rotation[s.axis] += dt * s.speed;
  }

  land(a) {
    const b = a.b;
    this.combo = this.time - this.lastLand < 0.45 ? this.combo + 1 : 0;
    this.lastLand = this.time;
    // Big cascades land many blocks per frame: keep the sound and dust readable.
    if (this.time - this.lastSound >= 0.03) {
      this.lastSound = this.time;
      sfx.thock(this.combo, a.velocity);
    }
    const crowded = this.anims.length > 60;
    if (!crowded || this.combo % 3 === 0) this.puff(b.x, b.y - 0.45, b.z, a.velocity < 1 || crowded ? 4 : this.combo % 2 === 0 ? 7 : 5);
  }

  // drop + hop share the squash-and-settle ending
  stepMove(a) {
    const b = a.b;
    if (a.phase === 'wait') {
      if (a.t < a.delay) return true;
      a.phase = a.kind === 'drop' ? 'fall' : 'hop';
      a.t -= a.delay;
    }
    if (a.phase === 'fall') {
      if (a.t < a.fall) {
        const y = b.y + a.height - 0.5 * GRAVITY * a.t * a.t;
        const k = a.t / a.fall;
        const sxz = 1 - 0.14 * k;
        this.pose(b, b.x, y, b.z, sxz, 1 + 0.3 * k, sxz); // stretch as it speeds up
        return true;
      }
      a.phase = 'settle';
      a.t -= a.fall;
      this.land(a);
    }
    if (a.phase === 'hop') {
      const dur = 0.3;
      if (a.t < dur) {
        const k = a.t / dur;
        const sxz = 1 - 0.08 * Math.sin(Math.PI * k);
        this.pose(b, b.x, b.y + 3.2 * k * (1 - k), b.z, sxz, 1 + 0.18 * Math.sin(Math.PI * k), sxz);
        return true;
      }
      a.phase = 'settle';
      a.t -= dur;
      this.land(a);
    }
    if (a.t < SETTLE_TIME) {
      const s = 0.42 * Math.exp(-8 * a.t) * Math.cos(20 * a.t);
      const sy = 1 - s;
      const sxz = 1 + s * 0.55;
      this.pose(b, b.x, b.y - (b.sv[1] * (1 - sy)) / 2, b.z, sxz, sy, sxz);
      return true;
    }
    this.pose(b, b.x, b.y, b.z);
    return false;
  }

  stepLift(a) {
    const b = a.b;
    if (a.phase === 'wait') {
      if (a.t < a.delay) return true;
      a.phase = 'up';
      a.t -= a.delay;
    }
    const k = Math.min(1, a.t / 0.55);
    if (k >= 1) {
      this.remove(b);
      return false;
    }
    const s = 1 - k * k * k;
    this.pose(b, b.x, b.y + 5 * k * k, b.z, s, s, s);
    return true;
  }

  stepCrumble(a, dt) {
    const b = a.b;
    if (a.phase === 'wait') {
      if (a.t < a.delay) return true;
      a.phase = 'shake';
      a.t -= a.delay;
    }
    if (a.phase === 'shake') {
      if (a.t < 0.16) {
        const j = 0.07;
        this.pose(b, b.x + (Math.random() - 0.5) * j, b.y, b.z + (Math.random() - 0.5) * j);
        return true;
      }
      a.phase = 'fall';
      a.t -= 0.16;
      a.px = b.x;
      a.py = b.y;
      a.pz = b.z;
      sfx.crumble(a.index);
      if (a.index % 3 === 0) this.puff(b.x, b.y, b.z, 4, 0.6);
    }
    a.vy -= 30 * dt;
    a.px += a.vx * dt;
    a.py += a.vy * dt;
    a.pz += a.vz * dt;
    const k = Math.min(1, a.t / 0.95);
    if (k >= 1) {
      this.remove(b);
      return false;
    }
    _q.setFromAxisAngle(a.axis, a.spin * a.t);
    const s = 1 - k * k;
    this.pose(b, a.px, a.py, a.pz, s, s, s, _q);
    return true;
  }
}
