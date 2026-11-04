import * as THREE from 'three';
import { MultiBatch, addBlock } from './kit.js';
import { footprint } from './footprint.js';

export const PREVIEW_VARIANT = 20261104;

/** Render a small isometric picture of each blueprint once, with a throwaway renderer. */
export function makeThumbs(kinds, size = 168, variant = PREVIEW_VARIANT) {
  const canvas = document.createElement('canvas');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(size, size, false);
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xd8efff, 0x7a9a5c, 1.7));
  const sun = new THREE.DirectionalLight(0xfff3dc, 2.4);
  sun.position.set(14, 24, 9);
  scene.add(sun);

  const out = {};
  for (const kind of kinds) {
    const fp = footprint(kind, variant, 0);
    const r = fp.rect;
    const group = new THREE.Group();
    scene.add(group);
    const batch = new MultiBatch(group, { shadows: false });
    for (const b of fp.rel) addBlock(batch, { ...b, q: null });
    // a little grass slab to stand on
    for (let x = r.x0 - 1; x <= r.x1 + 1; x++) for (let z = r.z0 - 1; z <= r.z1 + 1; z++) addBlock(batch, { x, y: 0, z, mat: 'grass', color: (x + z) & 1 ? 0x74c94f : 0x68bf45 });

    const cx = (r.x0 + r.x1) / 2;
    const cz = (r.z0 + r.z1) / 2;
    const cy = fp.height / 2;
    const span = Math.max(r.x1 - r.x0 + 3, r.z1 - r.z0 + 3, fp.height * 1.1) * 0.78;
    const cam = new THREE.OrthographicCamera(-span, span, span, -span, 0.1, 200);
    cam.position.set(cx + 40, cy + 32, cz + 40);
    cam.lookAt(cx, cy, cz);
    renderer.render(scene, cam);
    out[kind] = canvas.toDataURL('image/png');
    batch.dispose();
    scene.remove(group);
  }
  renderer.dispose();
  renderer.forceContextLoss();
  return out;
}
