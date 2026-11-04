import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { VoxelBatch, voxelGeometry, jitterColor } from './voxels.js';
import { mulberry32 } from './rng.js';

export function createScene(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0x000000, 0);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;

  const scene = new THREE.Scene();

  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 300);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.enablePan = false;
  controls.minDistance = 18;
  controls.maxDistance = 240; // tall phone screens and big islands need room
  controls.minPolarAngle = 0.35;
  controls.maxPolarAngle = 1.45;

  const hemi = new THREE.HemisphereLight(0xd8efff, 0x7a9a5c, 1.6);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff3dc, 2.6);
  sun.position.set(14, 24, 9);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = -26;
  sc.right = 26;
  sc.top = 26;
  sc.bottom = -26;
  sc.near = 1;
  sc.far = 80;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
  scene.add(sun);
  scene.add(sun.target); // main.js moves the sun with the camera target so shadows follow

  const clouds = makeClouds(scene);

  function resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // Shift the view up a little to leave room for the bottom panel.
    camera.setViewOffset(w, h, 0, h * 0.06, w, h);
    camera.updateProjectionMatrix();
  }
  resize();
  window.addEventListener('resize', resize);

  return { renderer, scene, camera, controls, sun, hemi, clouds };
}

function makeClouds(scene) {
  const geo = voxelGeometry(1, 0.22);
  const mat = new THREE.MeshStandardMaterial({ roughness: 1, color: 0xffffff });
  const batch = new VoxelBatch(geo, mat, 256, { shadows: false });
  scene.add(batch.mesh);
  const rng = mulberry32(1234);
  const list = [];
  for (let i = 0; i < 7; i++) {
    const parts = [];
    const n = 5 + Math.floor(rng() * 6);
    for (let k = 0; k < n; k++) {
      const px = Math.floor(rng() * 5) - 2;
      const py = rng() < 0.3 ? 1 : 0;
      const pz = Math.floor(rng() * 3) - 1;
      const s = 1.4 + rng() * 0.8;
      parts.push({ px: px * 1.3, py: py * 1.1, pz: pz * 1.3, s, handle: batch.add(0, 0, 0, jitterColor('#ffffff', rng, 0.03), s) });
    }
    list.push({
      parts,
      angle: rng() * Math.PI * 2,
      radius: 30 + rng() * 10,
      y: -14 + rng() * 10,
      speed: (0.012 + rng() * 0.012) * (rng() < 0.5 ? 1 : -1),
    });
  }
  function update(dt) {
    for (const c of list) {
      c.angle += c.speed * dt;
      const cx = Math.cos(c.angle) * c.radius;
      const cz = Math.sin(c.angle) * c.radius;
      for (const p of c.parts) batch.set(p.handle, cx + p.px, c.y + p.py, cz + p.pz, p.s);
    }
  }
  update(0);
  const tint = (c, glow) => {
    mat.color.copy(c);
    if (glow) mat.emissive.copy(glow);
  };
  return { update, tint };
}
