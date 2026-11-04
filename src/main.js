import * as THREE from 'three';
import { createScene } from './scene.js';
import { Home } from './home.js';
import { Site } from './site.js';
import { CameraRig } from './rig.js';
import { loadSave, persist, wipeSave } from './save.js';
import { CATALOG, DECOR, BY_KIND, NAME, coinsFor, isDecor } from './catalog.js';
import { hash2 } from './rng.js';
import { footprint } from './footprint.js';
import { makeThumbs, PREVIEW_VARIANT } from './thumbs.js';
import * as sfx from './audio.js';

const DEV = import.meta.env.DEV;
const DURATIONS = { focus: 25 * 60 * 1000, debug: 10 * 1000 };
const RING_LEN = 2 * Math.PI * 62;
// Construction island: far enough out that the home island reads as a backdrop, off to one side.
const SITE_POS = new THREE.Vector3(36, 14, 92);
import { Sky, WEATHER } from './sky.js';
import { tickMaterials } from './kit.js';
import { Life } from './life.js';
import { Editor } from './editor.js';

const $ = (id) => document.getElementById(id);
const ui = {
  time: $('time'),
  next: $('next'),
  ring: $('ring-fill'),
  btn: $('main-btn'),
  stats: $('stats'),
  toast: $('toast'),
  peek: $('peek-btn'),
  modes: $('modes'),
  modeChips: [...document.querySelectorAll('#modes .chip')],
  tray: $('tray'),
  timerPanel: $('timer-panel'),
  placePanel: $('place-panel'),
  placeTitle: $('place-title'),
  placeHint: $('place-hint'),
  rotateBtn: $('rotate-btn'),
  storeBtn: $('store-btn'),
  placeBtn: $('place-btn'),
  soundBtn: $('sound-btn'),
  coins: $('coins'),
  coinCount: $('coin-count'),
  coinFloat: $('coin-float'),
  shopBtn: $('shop-btn'),
  shop: $('shop'),
  shopGrid: $('shop-grid'),
  shopNote: $('shop-note'),
  shopCoins: $('shop-coins'),
  shopClose: $('shop-close'),
  bpBtn: $('bp-btn'),
  bpImg: $('bp-img'),
  bpName: $('bp-name'),
  bpSub: $('bp-sub'),
  bpFill: $('bp-fill'),
  bpChange: $('bp-change'),
};

let save = loadSave();
sfx.setMuted(save.muted);
if (!DEV) {
  // 10-second sessions are a development tool only.
  ui.modeChips.find((c) => c.dataset.mode === 'debug')?.remove();
  ui.modeChips = ui.modeChips.filter((c) => c.dataset.mode !== 'debug');
  save.mode = 'focus';
}
// A session saved by the phase-1 build (no projects yet) becomes a one-session project.
if (save.session && !save.project && save.session.kind) {
  save.project = { kind: save.session.kind, variant: save.session.variant, done: 0, sessionsDone: 0 };
  save.session = { startedAt: save.session.startedAt, durationMs: save.session.durationMs, startDone: 0, quota: footprint(save.session.kind, save.session.variant).count };
}
if (!save.owned.includes(save.pick)) save.pick = 'tree';

const view = createScene($('scene'));
const home = new Home(view.scene);
// Growth earned by focus: one new ring of land per 2.5 hours focused.
const GROW_EVERY_MS = 2.5 * 60 * 60 * 1000;
const earnedRadius = () => 7 + 2 * Math.floor(save.focusMs / GROW_EVERY_MS);
if (earnedRadius() > save.islandRadius) save.islandRadius = earnedRadius();
home.setBase(save.islandRadius, save.seed);
if (save.needsLayout) {
  // Re-space migrated v1 buildings with the village spacing rules.
  for (const b of save.buildings) {
    const fp = footprint(b.kind, b.variant, 0);
    let spot = home.findSpot(fp, b.id);
    while (!spot) {
      save.islandRadius += 2;
      home.setBase(save.islandRadius, save.seed);
      spot = home.findSpot(fp, b.id);
    }
    b.x = spot.x;
    b.z = spot.z;
    home.loadBuildings([b]);
  }
  delete save.needsLayout;
} else {
  home.loadBuildings(save.buildings);
}
if (!save.square) {
  // First run with roads: find the town square, then pave a road from every existing building.
  let sq = home.findSquareSpot();
  while (!sq) {
    save.islandRadius += 2;
    home.setBase(save.islandRadius, save.seed);
    sq = home.findSquareSpot();
  }
  save.square = sq;
  home.setSquare(sq);
  for (const b of save.buildings) home.pave(home.routeFor(home.buildings.get(b.id)), false);
  save.paths = [...home.paths];
} else {
  home.paths = new Set(save.paths);
  home.setSquare(save.square);
}
// Nature: the river's course is chosen once (around what's already built), then the water wheel.
if (save.river == null) save.river = home.chooseRiver();
home.setRiver(save.river);
if (!save.wheel) save.wheel = home.chooseWheelSpot();
if (save.wheel) home.setWheel(save.wheel);
// Villagers and animals live on the forever island and follow its roads and land.
const life = new Life(home);
persist(save);

const site = new Site(view.scene, SITE_POS);
const rig = new CameraRig(view.camera, view.controls);

// Shop pictures are rendered on demand (the catalog is big now), each kind once.
const thumbs = {};
function ensureThumbs(kinds) {
  const missing = kinds.filter((k) => !(k in thumbs));
  if (!missing.length) return;
  try {
    Object.assign(thumbs, makeThumbs(missing));
  } catch (err) {
    console.warn('thumbnails failed', err);
    for (const k of missing) thumbs[k] = '';
  }
}

const stations = {
  home: () => ({ target: new THREE.Vector3(0, -1.5, 0), dist: 50 * Math.pow(Math.max(1, save.islandRadius / 7), 0.8) }),
  site: () => ({
    target: SITE_POS.clone().add(new THREE.Vector3(0, 1.5 + site.height * 0.3, 0)),
    dist: 30 * Math.pow(Math.max(1, site.half / 4, site.height / 9), 0.85),
  }),
};
let where = 'home';
function goTo(name, onArrive) {
  where = name;
  rig.fly(stations[name](), 1.7, onArrive);
}

/*
 * States:
 *  home         idle in the forever world
 *  running      a session is on; this session's share of the project goes up on the construction island
 *  finishing    session done, waiting for the last blocks to land (and for the tab to be visible)
 *  celebrating  hop wave; then either place the finished build or fly home with the project saved
 *  placing      choosing a spot back home (also while flying there)
 *  building     the placed building cascades into the forever world
 *  crumbling    gave up; this session's blocks fall apart
 */
let state = 'home';
let confirmUntil = 0;
let finishedItem = null; // set when the last session of a project completes
let sessionFrom = 0; // first block index of the session that just ended

// ---------- projects ----------

function projectInfo(p) {
  const total = footprint(p.kind, p.variant, 0).count;
  const sessions = BY_KIND[p.kind]?.sessions ?? 1;
  const left = Math.max(1, sessions - p.sessionsDone);
  const remaining = total - p.done;
  const quota = left > 1 ? Math.min(remaining, Math.ceil(total / sessions)) : remaining;
  return { total, sessions, quota };
}

// ---------- session flow ----------

function startSession() {
  if (state !== 'home' || rig.flying) return;
  sfx.unlockAudio().then(sfx.startSound);
  if (!save.project) {
    save.buildCounter += 1;
    save.project = { kind: save.pick, variant: hash2(save.seed, save.buildCounter), done: 0, sessionsDone: 0 };
  }
  const p = save.project;
  const { quota } = projectInfo(p);
  save.session = { startedAt: Date.now(), durationMs: DURATIONS[save.mode], startDone: p.done, quota };
  persist(save);
  site.setProject(p, p.done, p.done + quota);
  state = 'running';
  goTo('site');
}

function progressOf(s) {
  return Math.min(1, (Date.now() - s.startedAt) / s.durationMs);
}

function tick() {
  if (state !== 'running') return;
  const s = save.session;
  const p = progressOf(s);
  site.setTarget(s.startDone + Math.floor(p * s.quota));
  if (p >= 1) completeSession();
}

function completeSession() {
  const s = save.session;
  const p = save.project;
  const { total } = projectInfo(p);
  save.session = null;
  save.sessions += 1;
  save.focusMs += s.durationMs;
  const earned = coinsFor(s.durationMs);
  save.coins += earned;
  save.coinsEarned = (save.coinsEarned || 0) + earned;
  const day = dayKey(Date.now());
  save.days[day] = (save.days[day] || 0) + s.durationMs;
  p.done = Math.min(total, s.startDone + s.quota);
  p.sessionsDone += 1;
  sessionFrom = s.startDone;
  site.setTarget(p.done);
  finishedItem = null;
  if (p.done >= total) {
    finishedItem = { id: save.nextId++, kind: p.kind, variant: p.variant };
    save.tray.push(finishedItem); // safe in the tray even if the tab closes before it's placed
    save.project = null;
  }
  persist(save);
  showCoinGain(earned);
  state = 'finishing';
  if (document.hidden) {
    sfx.complete(); // audible nudge while the tab is in the background
    document.title = '✓ Session done · Voxel Focus World';
  }
  if (where !== 'site') goTo('site');
}

function celebrate() {
  state = 'celebrating';
  if (finishedItem) {
    const item = finishedItem;
    site.celebrate(0, () => {
      sfx.complete();
      toast(`${NAME(item.kind)} finished! Time to place it`);
      setTimeout(() => beginPlacing(item, true), 900);
    });
    return;
  }
  const p = save.project;
  const { sessions } = projectInfo(p);
  site.celebrate(sessionFrom, () => {
    sfx.complete();
    toast(`${NAME(p.kind)}: ${p.sessionsDone} of ${sessions} sessions done`);
    setTimeout(
      () =>
        goTo('home', () => {
          site.clearProject();
          state = 'home';
          setTimeout(maybeGrow, 500);
        }),
      1100,
    );
  });
}

function beginPlacing(item, fromSite) {
  state = 'placing';
  goTo('home', () => {
    if (fromSite) site.clearProject();
    let tries = 0;
    while (!home.beginPlacement(item) && tries++ < 6) growIsland();
  });
}

/** Back home after a session: if enough focus has piled up, a new ring of land rises. */
function maybeGrow() {
  if (state !== 'home' || earnedRadius() <= save.islandRadius) return;
  save.islandRadius = earnedRadius();
  persist(save);
  home.grow(save.islandRadius, save.seed, afterGrow);
  sfx.complete();
  toast('Your focus grew the island! A new ring of land rises');
  if (!rig.flying) rig.fly(stations.home(), 1.2);
}

/** After the island grows: the river may now be long enough for the water wheel. */
function afterGrow() {
  if (save.wheel) return;
  const spot = home.chooseWheelSpot();
  if (!spot) return;
  save.wheel = spot;
  persist(save);
  home.setWheel(spot, true);
  toast('A water wheel starts turning on the river');
}

function growIsland() {
  save.islandRadius += 2;
  home.grow(save.islandRadius, save.seed, afterGrow);
  persist(save);
  toast('Your island grew!');
  if (!rig.flying) rig.fly(stations.home(), 0.8);
}

function confirmPlace() {
  const p = home.placing;
  if (state !== 'placing' || !p || p.reason) return;
  const { item } = p;
  const record = { id: item.id, kind: item.kind, variant: item.variant, x: p.x, z: p.z, rot: p.rot, ...(item.paint ? { paint: item.paint } : {}) };
  save.buildings.push(record);
  save.tray = save.tray.filter((t) => t.id !== item.id);
  persist(save);
  home.endPlacement();
  state = 'building';
  sfx.unlockAudio();
  const decor = isDecor(record.kind);
  const road = home.build(record, () => {
    state = 'home';
    sfx.complete();
    toast(decor ? `${NAME(record.kind)} placed` : `${NAME(record.kind)} added to your world`);
    setTimeout(maybeGrow, 1600);
  });
  // neighbours come out to cheer once the walls are up (not for every lamp post)
  if (!decor) setTimeout(() => life.celebrate(p.x, p.z), 1200);
  save.paths.push(...road.map(([x, z]) => `${x},${z}`));
  persist(save);
}

function storeForLater() {
  if (state !== 'placing') return;
  home.endPlacement();
  state = 'home';
  toast('Kept in your tray for later');
}

function placeFromTray(id) {
  if (state !== 'home' || rig.flying) return;
  const item = save.tray.find((t) => t.id === id);
  if (!item) return;
  sfx.unlockAudio().then(sfx.uiTick);
  beginPlacing(item, false);
}

function giveUp() {
  if (state !== 'running') return;
  const now = performance.now();
  if (now > confirmUntil) {
    confirmUntil = now + 3000;
    sfx.uiTick();
    return;
  }
  confirmUntil = 0;
  sfx.giveUpSound();
  const s = save.session;
  const p = save.project;
  const name = NAME(p.kind).toLowerCase();
  const kept = p.sessionsDone > 0;
  save.session = null;
  if (!kept) save.project = null; // nothing invested yet: free to choose again
  save.giveUps = (save.giveUps || 0) + 1;
  persist(save);
  state = 'crumbling';
  if (where !== 'site') goTo('site');
  site.crumble(s.startDone, () => {
    toast(kept ? `This session's work crumbled. Your ${name} keeps its earlier progress` : `The ${name} crumbled. Your world is safe`);
    goTo('home', () => {
      site.clearProject();
      state = 'home';
    });
  });
}

function togglePeek() {
  if (rig.flying || state !== 'running') return;
  goTo(where === 'site' ? 'home' : 'site');
}

// ---------- coins + shop ----------

function showCoinGain(n) {
  sfx.coin();
  ui.coinFloat.textContent = `+${n}`;
  for (const el of [ui.coinFloat, ui.coins]) {
    const cls = el === ui.coins ? 'bump' : 'go';
    el.classList.remove(cls);
    void el.offsetWidth; // restart the animation
    el.classList.add(cls);
  }
}

function openShop() {
  if (state !== 'home' || rig.flying) return;
  sfx.unlockAudio().then(sfx.uiTick);
  renderShop();
  ui.shop.hidden = false;
}

function closeShop() {
  ui.shop.hidden = true;
}

function buy(entry) {
  if (save.owned.includes(entry.kind) || save.coins < entry.price) return;
  save.coins -= entry.price;
  save.owned.push(entry.kind);
  if (!save.project) save.pick = entry.kind;
  persist(save);
  sfx.unlockAudio().then(sfx.purchase);
  ui.coins.classList.remove('bump');
  void ui.coins.offsetWidth;
  ui.coins.classList.add('bump');
  toast(`${entry.name} blueprint unlocked!`);
  renderShop();
}

function choose(entry) {
  if (save.project || !save.owned.includes(entry.kind)) return;
  save.pick = entry.kind;
  persist(save);
  sfx.uiTick();
  closeShop();
}

// ---------- stats ----------

function dayKey(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function streaks() {
  const has = (offset) => !!save.days[dayKey(Date.now() - offset * 86400000)];
  let current = 0;
  let o = has(0) ? 0 : 1; // a streak survives until today is over
  while (has(o)) {
    current++;
    o++;
  }
  let best = 0;
  let run = 0;
  let prev = null;
  for (const k of Object.keys(save.days).sort()) {
    const ts = new Date(`${k}T12:00:00`).getTime();
    run = prev != null && Math.round((ts - prev) / 86400000) === 1 ? run + 1 : 1;
    best = Math.max(best, run);
    prev = ts;
  }
  return { current, best: Math.max(best, current) };
}

function statTile(label, value, sub) {
  const el = document.createElement('div');
  el.className = 'tile';
  for (const [cls, text] of [['tile-label', label], ['tile-value', value], ['tile-sub', sub || '']]) {
    const d = document.createElement('div');
    d.className = cls;
    d.textContent = text;
    el.appendChild(d);
  }
  return el;
}

function openStats() {
  sfx.unlockAudio().then(sfx.uiTick);
  renderStats();
  $('stats-sheet').hidden = false;
}
function closeStats() {
  $('stats-sheet').hidden = true;
}

function renderStats() {
  const { current, best } = streaks();
  $('stat-tiles').replaceChildren(
    statTile('Focused', fmtFocus(save.focusMs), `${save.sessions} session${save.sessions === 1 ? '' : 's'}`),
    statTile('Streak', `${current} day${current === 1 ? '' : 's'}`, `best ${best}`),
    statTile('Coins earned', String(save.coinsEarned || 0), `${save.coins} to spend`),
    statTile('Buildings', String(save.buildings.filter((x) => !isDecor(x.kind)).length), save.project ? `${NAME(save.project.kind)} underway` : 'in your village'),
  );

  // Last 7 days, one bar per day. Single series: one hue, no legend, hover for the exact value.
  const chart = $('week-chart');
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const ts = Date.now() - i * 86400000;
    days.push({ ts, min: Math.round((save.days[dayKey(ts)] || 0) / 60000), today: i === 0 });
  }
  const max = Math.max(25, ...days.map((d) => d.min));
  setText($('week-total'), `${fmtFocus(days.reduce((a, d) => a + d.min, 0) * 60000)} this week`);
  chart.replaceChildren();
  const labels = document.createElement('div');
  labels.className = 'wk-labels';
  for (const d of days) {
    const date = new Date(d.ts);
    const col = document.createElement('div');
    col.className = 'wk-col';
    col.tabIndex = 0;
    const h = d.min ? Math.max(4, (100 * d.min) / max) : 0;
    const bar = document.createElement('div');
    bar.className = 'wk-bar' + (d.min ? '' : ' empty');
    bar.style.height = d.min ? `${h}%` : '3px';
    const tip = document.createElement('div');
    tip.className = 'wk-tip';
    tip.textContent = `${date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}: ${d.min} min`;
    col.append(tip, bar);
    if (d.today && d.min) {
      const val = document.createElement('div');
      val.className = 'wk-val';
      val.style.bottom = `${h}%`;
      val.textContent = `${d.min}m`;
      col.appendChild(val);
    }
    chart.appendChild(col);
    const lab = document.createElement('span');
    lab.textContent = d.today ? 'Today' : date.toLocaleDateString(undefined, { weekday: 'short' });
    if (d.today) lab.className = "today";
    labels.appendChild(lab);
  }
  chart.setAttribute('role', 'img');
  chart.setAttribute('aria-label', 'Minutes focused, last 7 days: ' + days.map((d) => `${new Date(d.ts).toLocaleDateString(undefined, { weekday: 'long' })} ${d.min}`).join(', '));
  chart.parentElement.querySelectorAll('.wk-labels').forEach((el) => el.remove());
  chart.after(labels);

  const into = save.focusMs % GROW_EVERY_MS;
  $('grow-fill').style.width = `${(100 * into) / GROW_EVERY_MS}%`;
  setText($('grow-aside'), `radius ${save.islandRadius}`);
  setText($('grow-note'), `${fmtFocus(GROW_EVERY_MS - into)} more focus until a new ring of land rises.`);

  const counts = {};
  for (const b of save.buildings) counts[b.kind] = (counts[b.kind] || 0) + 1;
  const village = $('village');
  village.replaceChildren();
  for (const [kind, n] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
    const chip = document.createElement('span');
    const em = document.createElement('em');
    em.textContent = `${n}×`;
    chip.append(em, ` ${NAME(kind)}`);
    village.appendChild(chip);
  }
  if (!save.buildings.length) village.textContent = 'Nothing placed yet.';
  setText($('village-aside'), `${save.paths.length} road tiles`);
}

let shopTab = 'build';

/** Decor is bought outright: it goes into the tray and you place it straight away. */
function buyDecor(entry) {
  if (save.coins < entry.price || state !== 'home') return;
  save.coins -= entry.price;
  const item = { id: save.nextId++, kind: entry.kind, variant: (Math.random() * 2 ** 31) >>> 0 };
  save.tray.push(item);
  persist(save);
  sfx.unlockAudio().then(sfx.purchase);
  closeShop();
  beginPlacing(item, false);
}

function renderDecor() {
  setText(ui.shopNote, 'Little touches for your village. Buy one and place it right away, no focus session needed.');
  ui.shopNote.classList.remove('warn');
  const placed = {};
  for (const b of save.buildings) placed[b.kind] = (placed[b.kind] || 0) + 1;
  ensureThumbs(DECOR.map((d) => d.kind));
  for (const entry of DECOR) {
    const card = document.createElement('div');
    card.className = 'card';
    const img = document.createElement('img');
    img.className = 'card-img';
    img.alt = '';
    if (thumbs[entry.kind]) img.src = thumbs[entry.kind];
    const name = document.createElement('div');
    name.className = 'card-name';
    name.textContent = entry.name;
    const meta = document.createElement('div');
    meta.className = 'card-meta';
    meta.textContent = entry.blurb;
    const btn = document.createElement('button');
    const short = entry.price - save.coins;
    btn.className = 'btn btn-buy';
    btn.textContent = short > 0 ? `${entry.price} coins · need ${short}` : `Buy & place · ${entry.price}`;
    btn.disabled = short > 0 || state !== 'home';
    btn.addEventListener('click', () => buyDecor(entry));
    card.append(img, name, meta, btn);
    if (placed[entry.kind]) {
      const tag = document.createElement('span');
      tag.className = 'count';
      tag.textContent = `${placed[entry.kind]} placed`;
      card.appendChild(tag);
    }
    ui.shopGrid.appendChild(card);
  }
}

function renderShop() {
  setText(ui.shopCoins, String(save.coins));
  for (const b of $('shop-tabs').children) b.setAttribute('aria-checked', String(b.dataset.tab === shopTab));
  setText($('shop-title'), shopTab === 'decor' ? 'Decor' : 'Blueprints');
  ui.shopGrid.replaceChildren();
  if (shopTab === 'decor') return renderDecor();
  const p = save.project;
  if (p) {
    const { sessions } = projectInfo(p);
    setText(ui.shopNote, `Finish your ${NAME(p.kind).toLowerCase()} first (${p.sessionsDone} of ${sessions} sessions). You can still buy blueprints.`);
  } else setText(ui.shopNote, 'Focus to earn coins: 1 per minute, +5 per finished session. Bigger builds take more sessions.');
  ui.shopNote.classList.toggle('warn', !!p);

  ensureThumbs(CATALOG.map((c) => c.kind));
  for (const entry of CATALOG) {
    const owned = save.owned.includes(entry.kind);
    const selected = !p && save.pick === entry.kind;
    const card = document.createElement('div');
    card.className = 'card' + (owned ? '' : ' locked') + (selected ? ' selected' : '');
    const img = document.createElement('img');
    img.className = 'card-img';
    img.alt = '';
    if (thumbs[entry.kind]) img.src = thumbs[entry.kind];
    const name = document.createElement('div');
    name.className = 'card-name';
    name.textContent = entry.name;
    const meta = document.createElement('div');
    meta.className = 'card-meta';
    const blocks = footprint(entry.kind, PREVIEW_VARIANT).count;
    meta.textContent = `${entry.sessions} session${entry.sessions > 1 ? 's' : ''} · ${blocks} blocks`;
    const btn = document.createElement('button');
    if (owned) {
      btn.className = 'btn ' + (selected ? 'btn-soft' : 'btn-go');
      btn.textContent = selected ? 'Selected' : p ? 'Owned' : 'Build this';
      btn.disabled = selected || !!p;
      btn.addEventListener('click', () => choose(entry));
    } else {
      const short = entry.price - save.coins;
      btn.className = 'btn btn-buy';
      btn.textContent = short > 0 ? `${entry.price} coins · need ${short}` : `Buy · ${entry.price} coins`;
      btn.disabled = short > 0;
      btn.addEventListener('click', () => buy(entry));
    }
    card.append(img, name, meta, btn);
    if (p && p.kind === entry.kind) {
      const tag = document.createElement('span');
      tag.className = 'tag';
      tag.textContent = 'In progress';
      card.appendChild(tag);
    }
    ui.shopGrid.appendChild(card);
  }
}

// ---------- HUD ----------

function fmt(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

function fmtFocus(ms) {
  const min = Math.floor(ms / 60000);
  return min < 60 ? `${min}m` : `${Math.floor(min / 60)}h ${min % 60}m`;
}

function setText(el, s) {
  if (el.textContent !== s) el.textContent = s;
}
function setHidden(el, h) {
  if (el.hidden !== h) el.hidden = h;
}

let trayKey = '';
let lastTitle = '';
function render() {
  const running = state === 'running';
  const placing = state === 'placing';
  const idle = state === 'home';

  const editing = state === 'editing';
  setHidden(ui.timerPanel, placing || editing);
  const editBtn = $('edit-btn');
  editBtn.disabled = !(idle || editing) || rig.flying;
  editBtn.setAttribute('aria-pressed', String(editing));
  setHidden(ui.placePanel, !placing);
  setText(ui.coinCount, String(save.coins));
  ui.shopBtn.disabled = !idle || rig.flying;

  // timer
  const s = save.session;
  const dur = s ? s.durationMs : DURATIONS[save.mode];
  const remaining = running ? s.startedAt + dur - Date.now() : dur;
  const progress = running ? progressOf(s) : 0;
  setText(ui.time, fmt(remaining));
  ui.ring.style.strokeDashoffset = String(RING_LEN * (1 - progress));
  ui.ring.style.opacity = progress > 0.002 ? '1' : '0';

  // blueprint row
  const p = save.project;
  const kind = p ? p.kind : save.pick;
  const info = p ? projectInfo(p) : null;
  ensureThumbs([kind]);
  if (thumbs[kind] && ui.bpImg.getAttribute('src') !== thumbs[kind]) ui.bpImg.src = thumbs[kind];
  setText(ui.bpName, NAME(kind));
  const sessions = BY_KIND[kind]?.sessions ?? 1;
  setText(
    ui.bpSub,
    p
      ? `${running ? 'Session' : 'Continue · session'} ${Math.min(sessions, p.sessionsDone + 1)} of ${sessions}`
      : `${sessions} session${sessions > 1 ? 's' : ''} · ${footprint(kind, PREVIEW_VARIANT).count} blocks`,
  );
  setHidden(ui.bpFill.parentElement, !p);
  if (p) {
    const built = running || state === 'finishing' || state === 'celebrating' ? site.placed : p.done;
    ui.bpFill.style.width = `${Math.round((100 * built) / info.total)}%`;
  }
  setHidden(ui.bpChange, !idle || !!p);
  ui.bpBtn.disabled = !idle || rig.flying;

  setText(
    ui.next,
    {
      running: `Building: ${NAME(kind)}`,
      finishing: 'Finishing…',
      celebrating: 'Done!',
      building: 'Placing…',
      crumbling: 'Crumbling…',
    }[state] || (p ? `Next: more ${NAME(kind).toLowerCase()}` : `Next: ${NAME(kind)}`),
  );

  for (const c of ui.modeChips) {
    c.setAttribute('aria-checked', String(c.dataset.mode === save.mode));
    c.disabled = !idle;
  }

  const confirming = running && performance.now() < confirmUntil;
  ui.btn.disabled = !(idle || running) || rig.flying;
  ui.btn.className = 'btn ' + (running ? 'btn-stop' + (confirming ? ' confirm' : '') : 'btn-go');
  setText(
    ui.btn,
    running
      ? confirming
        ? p && p.sessionsDone > 0
          ? "Tap again: this session's blocks crumble"
          : `Tap again: the ${NAME(kind).toLowerCase()} crumbles`
        : 'Give up'
      : idle
        ? p
          ? 'Keep building'
          : 'Start focus'
        : '…',
  );

  setHidden(ui.peek, !running);
  ui.peek.disabled = rig.flying;
  setText(ui.peek, where === 'site' ? 'View world' : 'Back to site');

  const n = save.sessions;
  const b = save.buildings.filter((x) => !isDecor(x.kind)).length;
  setText(ui.stats, `${n} session${n === 1 ? '' : 's'} · ${fmtFocus(save.focusMs)} · ${b} building${b === 1 ? '' : 's'}`);

  // tray (only while idle at home)
  const showTray = idle && save.tray.length > 0;
  setHidden(ui.tray, !showTray);
  const key = showTray ? save.tray.map((t) => t.id).join(',') : '';
  if (key !== trayKey) {
    trayKey = key;
    ui.tray.replaceChildren(document.createTextNode('Ready to place:'));
    for (const t of save.tray) {
      const btn = document.createElement('button');
      btn.className = 'tray-item';
      btn.textContent = NAME(t.kind);
      btn.addEventListener('click', () => placeFromTray(t.id));
      ui.tray.appendChild(btn);
    }
  }

  // placement panel
  if (placing) {
    const pl = home.placing;
    setText(ui.placeTitle, pl ? `Place your ${NAME(pl.item.kind).toLowerCase()}` : 'Heading home…');
    setText(ui.placeHint, !pl ? ' ' : pl.reason ? pl.reason : 'Tap a spot on your island, then place it');
    ui.placeHint.classList.toggle('bad', !!pl?.reason);
    ui.placeBtn.disabled = !pl || !!pl.reason || rig.flying;
    ui.rotateBtn.disabled = ui.storeBtn.disabled = !pl || rig.flying;
  }

  const title = running ? `${fmt(remaining)} · Voxel Focus World` : 'Voxel Focus World';
  if (title !== lastTitle && !(state === 'finishing' && document.hidden)) {
    document.title = title;
    lastTitle = title;
  }
}

let toastTimer = 0;
function toast(msg) {
  ui.toast.textContent = msg;
  ui.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ui.toast.classList.remove('show'), 2800);
}

function renderSound() {
  $('sound-waves').toggleAttribute('hidden', save.muted);
  $('sound-x').toggleAttribute('hidden', !save.muted);
  ui.soundBtn.setAttribute('aria-label', save.muted ? 'Unmute sound' : 'Mute sound');
}

// ---------- input ----------

ui.btn.addEventListener('click', () => (state === 'running' ? giveUp() : startSession()));
ui.peek.addEventListener('click', togglePeek);
ui.rotateBtn.addEventListener('click', () => {
  home.rotatePlacement();
  sfx.uiTick();
});
ui.storeBtn.addEventListener('click', storeForLater);
ui.placeBtn.addEventListener('click', confirmPlace);
ui.shopBtn.addEventListener('click', openShop);
ui.bpBtn.addEventListener('click', openShop);
ui.shopClose.addEventListener('click', closeShop);
$('shop-tabs').addEventListener('click', (e) => {
  const tab = e.target.closest('[data-tab]')?.dataset.tab;
  if (!tab || tab === shopTab) return;
  shopTab = tab;
  sfx.uiTick();
  renderShop();
  ui.shopGrid.scrollTop = 0;
});
$('stats-btn').addEventListener('click', openStats);
$('stats-close').addEventListener('click', closeStats);
$('stats-sheet').addEventListener('click', (e) => {
  if (e.target === $('stats-sheet')) closeStats();
});
ui.shop.addEventListener('click', (e) => {
  if (e.target === ui.shop) closeShop();
});
ui.soundBtn.addEventListener('click', () => {
  save.muted = !save.muted;
  sfx.setMuted(save.muted);
  persist(save);
  renderSound();
});
for (const c of ui.modeChips) {
  c.addEventListener('click', () => {
    if (state !== 'home') return;
    save.mode = c.dataset.mode;
    persist(save);
    sfx.unlockAudio().then(sfx.uiTick);
  });
}

window.addEventListener('keydown', (e) => {
  if (!ui.shop.hidden) {
    if (e.key === 'Escape') closeShop();
    return;
  }
  if (!$('stats-sheet').hidden) {
    if (e.key === 'Escape') closeStats();
    return;
  }
  if (state === 'editing') {
    editor.key(e);
    return;
  }
  if (state === 'placing') {
    if (e.key === 'r' || e.key === 'R') ui.rotateBtn.click();
    else if (e.key === 'Enter') confirmPlace();
    else if (e.key === 'Escape') storeForLater();
    return;
  }
  if (e.code === 'Space' && e.target === document.body) {
    e.preventDefault();
    ui.btn.click();
  }
});

// Placement: mouse hover previews and click places; on touch a tap moves the ghost and the button places.
const canvas = $('scene');
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
function cellAt(e) {
  const r = canvas.getBoundingClientRect();
  ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  raycaster.setFromCamera(ndc, view.camera);
  return home.pick(raycaster);
}
function rayAt(e) {
  const r = canvas.getBoundingClientRect();
  ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  raycaster.setFromCamera(ndc, view.camera);
  return raycaster;
}

// Edit mode: move / paint / store buildings, whole-village layouts (src/editor.js).
const editor = new Editor({
  home,
  life,
  get save() {
    return save;
  },
  persist,
  rig,
  sfx,
  toast,
  NAME,
  ray: rayAt,
  getState: () => state,
  setState: (s) => (state = s),
  flyHome: () => rig.fly(stations.home(), 1.1),
});
$('edit-btn').addEventListener('click', (e) => {
  e.stopPropagation();
  sfx.unlockAudio();
  if (state === 'editing') editor.close();
  else editor.open();
});
let downAt = null;
canvas.addEventListener('pointerdown', (e) => (downAt = { x: e.clientX, y: e.clientY }));
canvas.addEventListener('pointermove', (e) => {
  if (state !== 'placing' || !home.placing || e.pointerType !== 'mouse' || e.buttons) return;
  const c = cellAt(e);
  if (c) home.movePlacement(c.x, c.z);
});
canvas.addEventListener('pointerup', (e) => {
  if (!downAt || state !== 'placing' || !home.placing || rig.flying) return;
  const moved = Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y);
  downAt = null;
  if (moved > 6) return; // that was an orbit drag
  const c = cellAt(e);
  if (!c) return;
  home.movePlacement(c.x, c.z);
  if (e.pointerType === 'mouse') confirmPlace();
});

// Browsers only allow audio after a gesture; unlock on the first one anywhere.
window.addEventListener('pointerdown', () => sfx.unlockAudio(), { once: true });

// ---------- timing ----------

setInterval(tick, 250); // keeps the session honest when rAF is throttled in background tabs

// Resume a session that was running when the page was closed.
if (save.session && save.project) {
  const s = save.session;
  site.setProject(save.project, s.startDone + Math.floor(progressOf(s) * s.quota), s.startDone + s.quota);
  state = 'running';
  where = 'site';
  rig.snap(stations.site());
  tick();
} else {
  save.session = null;
  rig.snap(stations.home());
}

// ---------- time + weather ----------

if (!save.sky || typeof save.sky !== 'object') save.sky = { live: true, hour: 12, weather: 'auto', cur: 'fair', until: 0 };
const sky = new Sky(view, save.sky, () => persist(save));
let skyUiTimer = 0;
const skyPop = $('sky-pop');
const WEATHER_CHOICES = ['auto', 'clear', 'fair', 'showers', 'cloudy', 'rain', 'snow', 'fog'];
for (const key of WEATHER_CHOICES) {
  const b = document.createElement('button');
  b.className = 'mini-chip';
  b.dataset.weather = key;
  b.textContent = key === 'auto' ? 'Auto' : WEATHER[key].label;
  b.addEventListener('click', () => {
    save.sky.weather = key;
    persist(save);
    sfx.uiTick();
    renderSkyPop();
  });
  $('sky-weather').appendChild(b);
}

function fmtHour(h) {
  const hh = Math.floor(h) % 24;
  const mm = Math.round((h - Math.floor(h)) * 60);
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

function renderSkyPop() {
  $('sky-live').setAttribute('aria-pressed', String(save.sky.live));
  const hour = $('sky-hour');
  if (document.activeElement !== hour) hour.value = String(save.sky.live ? sky.hourNow() : save.sky.hour);
  for (const b of $('sky-weather').children) b.setAttribute('aria-pressed', String(b.dataset.weather === save.sky.weather));
  setText($('sky-now'), `${WEATHER[sky.current]?.label || ''}${save.sky.weather === 'auto' ? ' (changes on its own)' : ''} · ${fmtHour(save.sky.live ? sky.hourNow() : save.sky.hour)}`);
  const music = save.music !== false;
  $('music-btn').setAttribute('aria-pressed', String(music));
  setText($('music-btn'), music ? 'On' : 'Off');
}

function renderSkyButton() {
  const night = sky.day < 0.4;
  $('sky-sun').toggleAttribute('hidden', night);
  $('sky-rays').toggleAttribute('hidden', night);
  $('sky-moon').toggleAttribute('hidden', !night);
  $('sky-btn').title = sky.describe();
  if (!skyPop.hidden) renderSkyPop();
}

function toggleSkyPop(open = skyPop.hidden) {
  skyPop.hidden = !open;
  $('sky-btn').setAttribute('aria-expanded', String(open));
  if (open) renderSkyPop();
}

$('sky-btn').addEventListener('click', (e) => {
  e.stopPropagation();
  sfx.unlockAudio().then(sfx.uiTick);
  toggleSkyPop();
});
skyPop.addEventListener('click', (e) => e.stopPropagation());
document.addEventListener('click', () => {
  if (!skyPop.hidden) toggleSkyPop(false);
});
$('sky-live').addEventListener('click', () => {
  save.sky.live = !save.sky.live;
  if (!save.sky.live) save.sky.hour = Math.round(sky.hourNow() * 4) / 4;
  persist(save);
  sfx.uiTick();
  renderSkyPop();
});
$('sky-hour').addEventListener('input', (e) => {
  save.sky.live = false;
  save.sky.hour = Number(e.target.value);
  persist(save);
  renderSkyPop();
});
$('music-btn').addEventListener('click', () => {
  save.music = save.music === false;
  persist(save);
  sfx.unlockAudio().then(() => sfx.setMusic(save.music));
  renderSkyPop();
});

// Browsers only allow sound after a gesture: the first tap anywhere starts music + ambience.
sfx.setMusic(save.music !== false);
window.addEventListener('pointerdown', () => sfx.unlockAudio(), { once: true, capture: true });

let prev = performance.now();
let debugFreeze = false;
function frame(now) {
  const dt = Math.min(0.05, (now - prev) / 1000);
  prev = now;
  const t = now / 1000;

  if (state !== 'placing' && state !== 'building' && state !== 'editing' && !debugFreeze) home.group.rotation.y += dt * 0.05;
  home.group.position.y = Math.sin(t * 0.7) * 0.25;
  site.group.position.y = SITE_POS.y + Math.sin(t * 0.9 + 1.3) * 0.2;

  tick();
  if (state === 'finishing' && !document.hidden && !rig.flying && site.settled) celebrate();

  view.clouds.update(dt);
  sky.update(dt, view.controls.target, view.camera);
  tickMaterials(dt);
  home.update(dt);
  editor.update(dt);
  editor.render();
  life.update(dt, { day: sky.day, rain: sky.p.rain + sky.p.snow * 0.5, cloud: sky.p.cloud });
  site.update(dt);
  rig.update(dt);
  skyUiTimer -= dt;
  if (skyUiTimer <= 0) {
    skyUiTimer = 1;
    renderSkyButton();
    const p = sky.p;
    sfx.setAmbience({ rain: Math.min(1, p.rain + p.snow * 0.15), wind: Math.min(1, p.snow * 0.8 + p.dark * 0.5 + p.fog * 0.2), day: sky.day, clear: 1 - p.cloud });
  }

  render();
  view.renderer.render(view.scene, view.camera);
  requestAnimationFrame(frame);
}
renderSound();
render();
requestAnimationFrame(frame);

// Handy in the console while developing.
window.vfw = {
  audio: () => sfx.audioState(),
  sky: () => ({ hour: sky.hour, day: sky.day, weather: sky.current, mix: { ...sky.p } }),
  get state() {
    return state;
  },
  get where() {
    return where;
  },
  save: () => save,
  home,
  life,
  editor,
  /** Point the camera at island cell (x, z) from `dist` away and stop the island turning (look() again with no args to resume). */
  look(x, z, dist = 9, ang = null, tilt = 0.66) {
    if (x == null) {
      debugFreeze = false;
      view.controls.minDistance = 18;
      return;
    }
    debugFreeze = true;
    view.controls.minDistance = 2;
    const v = new THREE.Vector3(x, 1, z);
    home.group.localToWorld(v);
    view.controls.target.copy(v);
    // ang: direction in island space (default: from the island centre out through the cell)
    const a = ang ?? Math.atan2(z, x);
    const dir = new THREE.Vector3(Math.cos(a), 0, Math.sin(a)).applyQuaternion(home.group.quaternion);
    dir.y = 0;
    dir.normalize().multiplyScalar(0.75);
    dir.y = tilt;
    view.camera.position.copy(v).addScaledVector(dir, dist);
    view.controls.update();
  },
  site,
  finishNow() {
    if (state === 'running') save.session.startedAt = Date.now() - save.session.durationMs;
  },
  reset() {
    wipeSave();
    location.reload();
  },
};
// ---------- installable app + offline (service worker is only built for production) ----------

if (!DEV && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((err) => console.warn('offline mode unavailable', err));
  });
}
let installPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault(); // offer it from the sky menu instead of a browser banner
  installPrompt = e;
  $('install-row').hidden = false;
});
window.addEventListener('appinstalled', () => {
  installPrompt = null;
  $('install-row').hidden = true;
  toast('Installed! Voxel Focus World now opens as its own app, even offline');
});
$('install-btn').addEventListener('click', async () => {
  if (!installPrompt) return;
  sfx.uiTick();
  installPrompt.prompt();
  await installPrompt.userChoice;
  installPrompt = null;
  $('install-row').hidden = true;
});

if (DEV) {
  window.vfw.addCoins = (n = 500) => {
    save.coins += n;
    persist(save);
    showCoinGain(n);
  };
  // DEV: pretend you focused for n minutes (feeds growth, streaks and the week chart)
  window.vfw.addFocus = (min = 150) => {
    save.focusMs += min * 60000;
    const k = dayKey(Date.now());
    save.days[k] = (save.days[k] || 0) + min * 60000;
    persist(save);
    maybeGrow();
  };
  // DEV: big previews of blueprints in an overlay (click it to close). variant defaults to the shop's.
  window.vfw.preview = (kinds, { size = 900, variant } = {}) => {
    kinds = [].concat(kinds);
    const t = makeThumbs(kinds, size, variant);
    document.getElementById('vfw-preview')?.remove();
    const d = document.createElement('div');
    d.id = 'vfw-preview';
    d.style.cssText = 'position:fixed;inset:0;z-index:9999;background:#9cc;display:flex;flex-wrap:wrap;justify-content:center;align-content:center;cursor:pointer';
    const w = kinds.length === 1 ? 'min(100vw,130vh)' : kinds.length === 2 ? '50vw' : '33vw';
    for (const k of kinds) {
      const i = new Image();
      i.src = t[k];
      i.style.width = w;
      d.appendChild(i);
    }
    d.onclick = () => d.remove();
    document.body.appendChild(d);
  };
}
