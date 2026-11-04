import * as THREE from 'three';

const DIR = new THREE.Vector3(0.62, 0.5, 0.62).normalize();

/** Camera stations and the swoop between them. OrbitControls stay usable once parked. */
export class CameraRig {
  constructor(camera, controls) {
    this.camera = camera;
    this.controls = controls;
    this.flight = null;
  }

  get flying() {
    return !!this.flight;
  }

  pose(station) {
    const a = this.camera.aspect;
    const scale = a < 1 ? Math.pow(1 / a, 0.75) : 1;
    const target = station.target.clone();
    return { target, pos: target.clone().addScaledVector(station.dir || DIR, station.dist * scale) };
  }

  snap(station) {
    const p = this.pose(station);
    this.camera.position.copy(p.pos);
    this.controls.target.copy(p.target);
    this.controls.update();
  }

  fly(station, duration = 1.7, onArrive) {
    const to = this.pose(station);
    this.flight = {
      fromPos: this.camera.position.clone(),
      fromTarget: this.controls.target.clone(),
      to,
      t: 0,
      duration,
      onArrive,
    };
    this.controls.enabled = false;
  }

  update(dt) {
    const f = this.flight;
    if (!f) {
      this.controls.update();
      return;
    }
    f.t += dt;
    const k = Math.min(1, f.t / f.duration);
    const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
    const travel = f.fromTarget.distanceTo(f.to.target);
    this.camera.position.lerpVectors(f.fromPos, f.to.pos, e);
    this.camera.position.y += Math.sin(Math.PI * e) * Math.min(10, travel * 0.18); // arc over
    this.controls.target.lerpVectors(f.fromTarget, f.to.target, e);
    this.camera.lookAt(this.controls.target);
    if (k >= 1) {
      this.flight = null;
      this.controls.enabled = true;
      this.controls.update();
      f.onArrive?.();
    }
  }
}
