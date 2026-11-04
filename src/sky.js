import * as THREE from 'three';
import { setNight, MultiBatch } from './kit.js';
import { mulberry32 } from './rng.js';

/*
 * Sky, time of day and weather. Everything here is slow on purpose: light drifts with the real
 * clock (or a chosen hour), weather changes every few minutes and blends over ~40 s.
 *
 * Weather states are mixes of a few ingredients (cloud cover, gloom, rain, snow, fog), so the
 * in-between moments look natural too: sun showers, sleet, misty drizzle...
 */

export const WEATHER = {
  clear: { label: 'Clear', cloud: 0.08, dark: 0, rain: 0, snow: 0, fog: 0 },
  fair: { label: 'Fair', cloud: 0.45, dark: 0.04, rain: 0, snow: 0, fog: 0 },
  showers: { label: 'Sun showers', cloud: 0.5, dark: 0.08, rain: 0.45, snow: 0, fog: 0 },
  cloudy: { label: 'Cloudy', cloud: 0.9, dark: 0.3, rain: 0, snow: 0, fog: 0.05 },
  drizzle: { label: 'Drizzle', cloud: 0.9, dark: 0.35, rain: 0.3, snow: 0, fog: 0.25 },
  rain: { label: 'Rain', cloud: 1, dark: 0.55, rain: 1, snow: 0, fog: 0.2 },
  sleet: { label: 'Sleet', cloud: 0.95, dark: 0.45, rain: 0.4, snow: 0.45, fog: 0.15 },
  snow: { label: 'Snow', cloud: 0.85, dark: 0.3, rain: 0, snow: 1, fog: 0.15 },
  fog: { label: 'Fog', cloud: 0.4, dark: 0.22, rain: 0, snow: 0, fog: 1 },
};

// Which weather tends to follow which. Snow is weighted by season (more in winter).
const NEXT = {
  clear: [['clear', 3], ['fair', 4], ['fog', 1]],
  fair: [['clear', 3], ['fair', 2], ['cloudy', 3], ['showers', 1.5]],
  showers: [['fair', 3], ['cloudy', 2], ['drizzle', 1]],
  cloudy: [['fair', 3], ['drizzle', 3], ['rain', 2], ['snow', 1], ['sleet', 0.6], ['fog', 1]],
  drizzle: [['cloudy', 3], ['rain', 2], ['fair', 1], ['fog', 1]],
  rain: [['drizzle', 3], ['cloudy', 3], ['sleet', 0.5]],
  sleet: [['snow', 2], ['rain', 1], ['cloudy', 2]],
  snow: [['cloudy', 3], ['snow', 1.5], ['fair', 1], ['sleet', 0.5]],
  fog: [['fair', 3], ['clear', 2], ['cloudy', 1], ['drizzle', 1]],
};
const KEYS = ['cloud', 'dark', 'rain', 'snow', 'fog'];

const SKY = {
  night: ['#0c1430', '#1d2a55', '#34436f'],
  dusk: ['#4a6fb5', '#ff9e7d', '#ffd29a'],
  day: ['#5fb8ff', '#9fd6ff', '#dff3ff'],
  grey: ['#8c99a9', '#aab4c0', '#c9d0d8'],
  greyNight: ['#151b2b', '#232b3d', '#323b50'],
};

const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const _a = new THREE.Color();
const _b = new THREE.Color();
const _c = new THREE.Color();
const _v = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();

function mix3(a, b, t, i) {
  return _c.set(a[i]).lerp(_b.set(b[i]), t).clone();
}

function winterFactor() {
  const m = new Date().getMonth(); // 0 = Jan
  return [3, 2.5, 1.2, 0.4, 0.05, 0, 0, 0, 0.05, 0.4, 1.2, 2.5][m];
}

export class Sky {
  /**
   * prefs (saved): { live: bool, hour: 0..24, weather: 'auto' | key, cur, until }
   * onChange(prefs) is called when the weather moves on, so it can be saved.
   */
  constructor(view, prefs, onChange) {
    this.view = view;
    this.prefs = prefs;
    this.onChange = onChange;
    this.p = { ...WEATHER[prefs.cur || 'fair'] }; // live blended parameters
    this.hour = 12;
    this.day = 1;
    this.cssTimer = 0;
    this.time = 0;
    if (!WEATHER[prefs.cur]) prefs.cur = 'fair';
    if (!prefs.until || prefs.until < Date.now() - 3600_000) prefs.until = Date.now() + this.spell();

    this.buildStars();
    this.buildPrecip();
    this.buildClouds();
    view.scene.fog = new THREE.Fog(0xdff3ff, 100, 1000);
  }

  /** Weather lasts 3 to 9 minutes. */
  spell() {
    return (3 + Math.random() * 6) * 60_000;
  }

  get current() {
    return this.prefs.weather === 'auto' ? this.prefs.cur : this.prefs.weather;
  }

  advance() {
    const opts = NEXT[this.prefs.cur] || NEXT.fair;
    const w = winterFactor();
    const weights = opts.map(([k, n]) => (k === 'snow' || k === 'sleet' ? n * w : n));
    let r = Math.random() * weights.reduce((a, b) => a + b, 0);
    let next = opts[0][0];
    for (let i = 0; i < opts.length; i++) {
      r -= weights[i];
      if (r <= 0) {
        next = opts[i][0];
        break;
      }
    }
    this.prefs.cur = next;
    this.prefs.until = Date.now() + this.spell();
    this.onChange?.(this.prefs);
  }

  // ---------- stars ----------

  buildStars() {
    const rng = mulberry32(42);
    const n = 500;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      // upper hemisphere, biased up
      const u = rng() * Math.PI * 2;
      const v = Math.acos(1 - rng() * 1.1);
      pos[i * 3] = Math.sin(v) * Math.cos(u) * 200;
      pos[i * 3 + 1] = Math.cos(v) * 200 - 20;
      pos[i * 3 + 2] = Math.sin(v) * Math.sin(u) * 200;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.starMat = new THREE.PointsMaterial({ color: 0xfff6dc, size: 2, sizeAttenuation: false, transparent: true, opacity: 0, depthWrite: false, fog: false });
    this.stars = new THREE.Points(g, this.starMat);
    this.stars.frustumCulled = false;
    this.stars.renderOrder = -1;
    this.view.scene.add(this.stars);
  }

  // ---------- rain + snow ----------

  buildPrecip() {
    const rng = mulberry32(7);
    const make = (geo, mat, n) => {
      const mesh = new THREE.InstancedMesh(geo, mat, n);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
      mesh.count = 0;
      this.view.scene.add(mesh);
      const parts = Array.from({ length: n }, () => ({ x: (rng() - 0.5) * 60, y: rng() * 40, z: (rng() - 0.5) * 60, k: rng() }));
      return { mesh, parts };
    };
    this.rain = make(
      new THREE.BoxGeometry(0.06, 1.1, 0.06),
      new THREE.MeshBasicMaterial({ color: 0xcfe3ff, transparent: true, opacity: 0.55, depthWrite: false }),
      900,
    );
    this.snow = make(
      new THREE.IcosahedronGeometry(0.13, 0),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95, depthWrite: false }),
      700,
    );
  }

  stepPrecip(dt, center) {
    const wind = 2.5 + this.p.dark * 3;
    const doRain = (sys, level, fall) => {
      const n = Math.round(sys.parts.length * Math.min(1, level));
      sys.mesh.count = n;
      if (!n) return;
      _q.setFromAxisAngle(_v.set(0, 0, 1), -Math.atan2(wind, fall) * 0.8);
      for (let i = 0; i < n; i++) {
        const p = sys.parts[i];
        p.y -= fall * (0.8 + p.k * 0.4) * dt;
        p.x += wind * dt;
        if (p.y < -12) {
          p.y += 40;
          p.x = (Math.random() - 0.5) * 60;
          p.z = (Math.random() - 0.5) * 60;
        }
        if (p.x > 30) p.x -= 60;
        _m.compose(_v.set(center.x + p.x, center.y + p.y - 6, center.z + p.z), _q, _s.set(1, 1, 1));
        sys.mesh.setMatrixAt(i, _m);
      }
      sys.mesh.instanceMatrix.needsUpdate = true;
    };
    doRain(this.rain, this.p.rain, 26);
    // snow drifts and sways
    const n = Math.round(this.snow.parts.length * Math.min(1, this.p.snow));
    this.snow.mesh.count = n;
    for (let i = 0; i < n; i++) {
      const p = this.snow.parts[i];
      p.y -= (1.6 + p.k) * dt;
      p.x += (0.6 + Math.sin(this.time * 0.8 + p.k * 20) * 0.9) * dt;
      p.z += Math.cos(this.time * 0.6 + p.k * 13) * 0.5 * dt;
      if (p.y < -12) {
        p.y += 40;
        p.x = (Math.random() - 0.5) * 60;
        p.z = (Math.random() - 0.5) * 60;
      }
      if (p.x > 30) p.x -= 60;
      const s = 0.7 + p.k * 0.7;
      _m.compose(_v.set(center.x + p.x, center.y + p.y - 6, center.z + p.z), _q.identity(), _s.set(s, s, s));
      this.snow.mesh.setMatrixAt(i, _m);
    }
    if (n) this.snow.mesh.instanceMatrix.needsUpdate = true;
  }

  // ---------- weather clouds (a soft layer that gathers overhead) ----------

  buildClouds() {
    const rng = mulberry32(99);
    this.cloudGroup = new THREE.Group();
    this.view.scene.add(this.cloudGroup);
    this.cloudMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, flatShading: true, transparent: true, opacity: 0.92 });
    this.cloudBatch = new MultiBatch(this.cloudGroup, { shadows: false, material: () => this.cloudMat });
    this.weatherClouds = [];
    for (let i = 0; i < 14; i++) {
      const parts = [];
      const n = 4 + Math.floor(rng() * 4);
      for (let k = 0; k < n; k++) {
        const b = { shape: 'blob', mat: 'cloud', color: 0xffffff };
        parts.push({
          b,
          dx: (k - n / 2) * 1.7 + rng(),
          dy: rng() * 1.2,
          dz: (rng() - 0.5) * 2.5,
          s: 2 + rng() * 1.6,
          h: this.cloudBatch.add(b, 0, 0, 0, 0.001),
        });
      }
      this.weatherClouds.push({
        parts,
        a: rng() * Math.PI * 2,
        r: 6 + rng() * 34,
        y: 23 + rng() * 9, // above whatever the camera is looking at
        speed: 0.006 + rng() * 0.01,
        rank: i / 14, // shows when cover > rank
        vis: 0,
      });
    }
  }

  stepClouds(dt, center) {
    for (const c of this.weatherClouds) {
      c.a += c.speed * dt;
      const want = this.p.cloud > c.rank + 0.04 ? 1 : 0;
      c.vis += (want - c.vis) * Math.min(1, dt * 0.25);
      const cx = center.x + Math.cos(c.a) * c.r;
      const cz = center.z + Math.sin(c.a) * c.r;
      for (const p of c.parts) {
        const s = Math.max(0.001, p.s * c.vis);
        this.cloudBatch.set(p.h, cx + p.dx, center.y + c.y + p.dy, cz + p.dz, s, s * 0.62, s);
      }
    }
  }

  // ---------- per frame ----------

  hourNow() {
    if (!this.prefs.live) return this.prefs.hour;
    const d = new Date();
    return d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600;
  }

  update(dt, center, camera) {
    this.time += dt;
    if (this.prefs.weather === 'auto' && Date.now() > this.prefs.until) this.advance();
    const target = WEATHER[this.current] || WEATHER.fair;
    const k = Math.min(1, dt / 12); // ~40 s to blend fully
    for (const key of KEYS) this.p[key] += (target[key] - this.p[key]) * k;

    // the shown hour eases towards the wanted one, so dragging the slider glides
    let want = this.hourNow();
    let diff = want - this.hour;
    if (diff > 12) diff -= 24;
    if (diff < -12) diff += 24;
    this.hour = (this.hour + diff * Math.min(1, dt * 3) + 24) % 24;

    const theta = ((this.hour - 6) / 12) * Math.PI;
    const elev = Math.sin(theta);
    const day = smooth(-0.14, 0.22, elev);
    const dusk = (1 - smooth(0.06, 0.5, Math.abs(elev))) * smooth(-0.3, 0.02, elev);
    this.day = day;
    const { cloud, dark, fog } = this.p;

    // sun by day, moon by night (they hand over at the horizon where both are faint)
    const v = this.view;
    const sunUp = elev > 0;
    const ang = sunUp ? theta : theta + Math.PI;
    _v.set(Math.cos(ang) * 0.85, Math.abs(Math.sin(ang)) + 0.25, 0.5).normalize();
    v.sun.position.copy(center).addScaledVector(_v, 32);
    v.sun.target.position.copy(center);
    const sunI = 2.7 * smooth(-0.02, 0.28, elev) * (1 - dark * 0.75);
    const moonI = 0.55 * smooth(0.02, 0.3, -elev) * (1 - dark * 0.6);
    v.sun.intensity = sunUp ? sunI : moonI;
    if (sunUp) v.sun.color.set('#fff3dc').lerp(_a.set('#ffa25e'), dusk * 0.8);
    else v.sun.color.set('#9fb6ff');
    v.hemi.intensity = (0.5 + 1.15 * day) * (1 - dark * 0.3);
    v.hemi.color.set('#36457a').lerp(_a.set('#d8efff'), day).lerp(_b.set('#ffc59a'), dusk * 0.35);
    v.hemi.groundColor.set('#232b3a').lerp(_a.set('#7a9a5c'), day);

    // sky gradient
    const cols = [0, 1, 2].map((i) => {
      let c = mix3(SKY.night, SKY.day, day, i);
      if (dusk > 0) c.lerp(_a.set(SKY.dusk[i]), dusk * 0.85);
      const grey = _b.set(SKY.greyNight[i]).lerp(_a.set(SKY.grey[i]), day);
      c.lerp(grey, Math.min(1, cloud * 0.25 + dark * 1.1));
      if (fog > 0.01) c.lerp(_a.set(day > 0.5 ? '#dfe6ec' : '#3a4356'), fog * 0.55);
      return c;
    });
    this.cssTimer -= dt;
    if (this.cssTimer <= 0) {
      this.cssTimer = 0.2;
      const root = document.documentElement.style;
      root.setProperty('--sky-top', `#${cols[0].getHexString()}`);
      root.setProperty('--sky-mid', `#${cols[1].getHexString()}`);
      root.setProperty('--sky-bottom', `#${cols[2].getHexString()}`);
      document.documentElement.dataset.night = day < 0.4 ? '1' : '';
    }

    // fog matches the horizon colour; thick fog pulls in close
    const dist = camera.position.distanceTo(center);
    v.scene.fog.color.copy(cols[1]);
    v.scene.fog.near = dist * (0.75 - fog * 0.55);
    v.scene.fog.far = fog < 0.02 ? 5000 : dist * (1.2 + (1 - fog) * 6);

    this.starMat.opacity = (1 - day) * (1 - Math.min(1, cloud * 0.9 + fog)) * (0.75 + 0.25 * Math.sin(this.time * 1.7));
    this.stars.position.copy(camera.position);

    // clouds catch the sky's colour (pink at dusk, blue at night) instead of going black
    const glow = _b.copy(cols[1]).multiplyScalar(0.42);
    this.cloudMat.color.set('#ffffff').lerp(_a.set('#8b95a3'), dark * 0.8).multiplyScalar(0.6 + 0.4 * day);
    this.cloudMat.emissive.copy(glow);
    v.clouds.tint?.(_c.set('#ffffff').lerp(_a.set('#a3adba'), dark * 0.8).multiplyScalar(0.6 + 0.4 * day), glow);

    setNight(Math.max(1 - day, dark * 0.45));
    this.stepClouds(dt, center);
    this.stepPrecip(dt, center);
  }

  /** e.g. "Rain · 14:30" for the button title. */
  describe() {
    const h = Math.floor(this.hour);
    const m = Math.floor((this.hour - h) * 60);
    return `${WEATHER[this.current]?.label || ''} · ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }
}
