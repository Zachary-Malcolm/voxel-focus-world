import * as THREE from 'three';
import { IslandFX } from './islandfx.js';
import { footprint, placeBlocks } from './footprint.js';
import { mulberry32 } from './rng.js';
import { jitterColor } from './voxels.js';

const SPAWN_GAP = 0.075; // seconds between blocks when the site catches up
const _c = new THREE.Color();
const WHITE = new THREE.Color(0xffffff);

/**
 * The construction island: a plank deck where the current project goes up block by block while the
 * timer runs. A project can span several sessions. Giving up only ever touches what was laid in the
 * current session, and never the home island.
 */
export class Site {
  constructor(scene, position) {
    this.fx = new IslandFX(scene, { capacity: 6000, ghostCapacity: 1200 });
    this.group = this.fx.group;
    this.group.position.copy(position);
    this.blocks = [];
    this.platform = [];
    this.half = 0;
    this.height = 6;
    this.placed = 0;
    this.target = 0;
    this.spawnTimer = 0;
    this.buildPlatform(4);
  }

  /** Square plank deck with lantern posts; grows for big projects. */
  buildPlatform(half) {
    if (half === this.half) return;
    for (const b of this.platform) this.fx.remove(b);
    this.platform = [];
    this.half = half;
    const rng = mulberry32(777);
    const add = (x, y, z, c, mat, shape) => {
      const b = { x, y, z, color: jitterColor(c, rng, 0.03), mat, shape };
      this.fx.add(b);
      this.platform.push(b);
    };
    for (let x = -half; x <= half; x++) {
      for (let z = -half; z <= half; z++) {
        add(x, 0, z, x % 2 === 0 ? '#d6a86c' : '#c4925a', 'wood'); // plank deck
        const d = Math.max(Math.abs(x), Math.abs(z));
        for (let k = 1; k <= 4; k++) if (d <= half - k * Math.max(1, half / 4)) add(x, -k, z, k === 1 ? '#a17550' : ['#97a0ad', '#8a93a1'][(x + z + k) & 1], k === 1 ? 'dirt' : 'rock');
      }
    }
    for (const [x, z] of [[-half, -half], [half, -half], [half, half], [-half, half]]) {
      for (let y = 1; y <= 3; y++) add(x, y, z, '#7a5434', 'log', 'pillar');
      add(x, 4, z, '#ffd36b', 'lantern'); // lantern
    }
  }

  get total() {
    return this.blocks.length;
  }

  /** Every block that should be down has landed. */
  get settled() {
    return this.placed >= this.target && !this.fx.busy;
  }

  /**
   * Load a project. The first `done` blocks appear instantly (earlier sessions, or a reload).
   * Ghost blocks up to `sessionEnd` show in colour (this session's work); later ones are pale.
   */
  setProject(project, done = 0, sessionEnd = Infinity) {
    this.clearProject();
    const fp = footprint(project.kind, project.variant, 0);
    const ext = Math.max(-fp.rect.x0, fp.rect.x1, -fp.rect.z0, fp.rect.z1);
    this.buildPlatform(Math.max(4, ext + 2));
    this.height = fp.height;
    this.blocks = placeBlocks(fp);
    this.fx.ghostPulse = true;
    this.fx.ghostSet(
      this.blocks.map((b, i) => (i < sessionEnd ? b : { ...b, color: _c.copy(b.color).lerp(WHITE, 0.8).clone() })),
      { pop: true },
    );
    this.placed = Math.min(done, this.blocks.length);
    this.target = this.placed;
    for (let i = 0; i < this.placed; i++) this.fx.add(this.blocks[i]);
  }

  setTarget(n) {
    this.target = Math.max(this.target, Math.min(n, this.blocks.length));
  }

  update(dt) {
    this.spawnTimer = Math.max(0, this.spawnTimer - dt);
    while (this.placed < this.target && this.spawnTimer <= 0) {
      // A lone block during focus is quiet; a catch-up cascade gets the full thock.
      const behind = this.target - this.placed;
      this.fx.drop(this.blocks[this.placed], { velocity: behind > 1 ? 1 : 0.55 });
      this.placed++;
      this.spawnTimer += SPAWN_GAP;
    }
    this.fx.update(dt);
  }

  /** Hop wave over blocks [from, end). */
  celebrate(from, onDone) {
    const list = this.blocks.slice(from).filter((b) => b.handle != null);
    if (from === 0) this.fx.ghostClear();
    this.fx.many('hop', list, Math.min(0.03, 2 / Math.max(1, list.length)), { velocity: 1 }, onDone);
  }

  /** Give-up: blocks laid from index `from` onward fall apart. Earlier sessions' work stays. */
  crumble(from, onDone) {
    this.fx.finishAll();
    const standing = this.blocks.slice(from).filter((b) => b.handle != null).reverse();
    this.placed = this.target = from;
    this.fx.many('crumble', standing, Math.min(0.05, 2.5 / Math.max(1, standing.length)), {}, onDone);
  }

  clearProject() {
    this.fx.finishAll();
    for (const b of this.blocks) this.fx.remove(b);
    this.fx.ghostClear();
    this.blocks = [];
    this.placed = this.target = 0;
  }
}
