import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

const _m = new THREE.Matrix4();
const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _c = new THREE.Color();
const IDENTITY_Q = new THREE.Quaternion();

export function voxelGeometry(size = 1, radius = 0.1) {
  return new RoundedBoxGeometry(size, size, size, 2, radius);
}

/**
 * A pool of cubes drawn with one InstancedMesh.
 * Callers get stable handles; removal swaps the last instance into the hole so draw count stays tight.
 */
export class VoxelBatch {
  constructor(geometry, material, capacity, { shadows = true } = {}) {
    this.capacity = capacity;
    this.mesh = new THREE.InstancedMesh(geometry, material, capacity);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.setColorAt(0, _c.set(0xffffff)); // allocates instanceColor
    this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = shadows;
    this.mesh.receiveShadow = shadows;
    this.slotOf = new Map();
    this.handleAt = [];
    this.nextHandle = 1;
  }

  get size() {
    return this.mesh.count;
  }

  add(x, y, z, color, scale = 1) {
    if (this.mesh.count >= this.capacity) {
      console.warn('VoxelBatch full', this.capacity);
      return null;
    }
    const slot = this.mesh.count++;
    const handle = this.nextHandle++;
    this.slotOf.set(handle, slot);
    this.handleAt[slot] = handle;
    this.set(handle, x, y, z, scale, scale, scale);
    this.setColor(handle, color);
    return handle;
  }

  set(handle, x, y, z, sx = 1, sy = sx, sz = sx, quat = IDENTITY_Q) {
    const slot = this.slotOf.get(handle);
    if (slot === undefined) return;
    _p.set(x, y, z);
    _s.set(sx, sy, sz);
    _m.compose(_p, quat, _s);
    this.mesh.setMatrixAt(slot, _m);
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  setColor(handle, color) {
    const slot = this.slotOf.get(handle);
    if (slot === undefined) return;
    this.mesh.setColorAt(slot, color instanceof THREE.Color ? color : _c.set(color));
    this.mesh.instanceColor.needsUpdate = true;
  }

  remove(handle) {
    const slot = this.slotOf.get(handle);
    if (slot === undefined) return;
    const last = this.mesh.count - 1;
    if (slot !== last) {
      this.mesh.getMatrixAt(last, _m);
      this.mesh.setMatrixAt(slot, _m);
      this.mesh.getColorAt(last, _c);
      this.mesh.setColorAt(slot, _c);
      const moved = this.handleAt[last];
      this.handleAt[slot] = moved;
      this.slotOf.set(moved, slot);
    }
    this.handleAt.length = last;
    this.slotOf.delete(handle);
    this.mesh.count = last;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor.needsUpdate = true;
  }

  clear() {
    this.slotOf.clear();
    this.handleAt.length = 0;
    this.mesh.count = 0;
  }
}

/** Slight per-block colour variation gives flat cubes a hand-made feel. */
export function jitterColor(hex, rng, amount = 0.045) {
  const c = new THREE.Color(hex);
  const hsl = {};
  c.getHSL(hsl);
  c.setHSL(hsl.h + (rng() - 0.5) * amount * 0.3, hsl.s, THREE.MathUtils.clamp(hsl.l + (rng() - 0.5) * amount * 2, 0, 1));
  return c;
}
