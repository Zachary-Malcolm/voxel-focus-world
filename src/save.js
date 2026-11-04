import { randomSeed } from './rng.js';
import { STARTER_KINDS } from './catalog.js';

const STARTING_COINS = 50;

const KEY = 'vfw.save.v2';
const V1_KEY = 'vfw.save.v1';

export function defaultSave() {
  return {
    version: 2,
    seed: randomSeed(), // island shape + build variants
    islandRadius: 7,
    buildings: [], // placed in the forever world: [{ id, kind, variant, x, z, rot }]
    tray: [], // finished but not placed yet: [{ id, kind, variant }]
    nextId: 1,
    buildCounter: 0, // never goes down, so every project gets a fresh variant
    sessions: 0,
    focusMs: 0,
    mode: 'focus', // 'focus' | 'debug'
    pick: 'tree', // blueprint chosen for the next new project
    muted: false,
    coins: STARTING_COINS,
    owned: [...STARTER_KINDS], // blueprints bought (or free)
    sky: { live: true, hour: 12, weather: 'auto', cur: 'fair', until: 0 },
    music: true,
    days: {}, // "YYYY-MM-DD" (local) -> focused ms, for streaks and the week chart
    coinsEarned: 0,
    giveUps: 0,
    square: null, // { x, z } town square centre, chosen once
    paths: [], // paved road cells "x,z"
    project: null, // the build in progress on the construction island: { kind, variant, done, sessionsDone }
    session: null, // { startedAt, durationMs, startDone, quota } while a session runs (survives reloads)
  };
}

// Saves from before the shop existed: pay out what their past focus would have earned.
function upgrade(data) {
  if (data.coins == null) data.coins = STARTING_COINS + Math.floor((data.focusMs || 0) / 60000) + 5 * (data.sessions || 0);
  if (!Array.isArray(data.owned)) data.owned = [...STARTER_KINDS];
  if (data.coinsEarned == null) data.coinsEarned = Math.floor((data.focusMs || 0) / 60000) + 5 * (data.sessions || 0);
  if (!data.days || typeof data.days !== "object") data.days = {};
  return data;
}

export function loadSave() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const data = JSON.parse(raw);
      if (data && data.version === 2 && Array.isArray(data.buildings)) return { ...defaultSave(), ...upgrade(data) };
    }
    const old = localStorage.getItem(V1_KEY);
    if (old) {
      const v1 = JSON.parse(old);
      const s = migrateV1(v1);
      s.coins = null;
      return upgrade(s);
    }
  } catch {
    /* fall through to a fresh island */
  }
  return defaultSave();
}

// v1 dropped builds straight onto the island; they become placed buildings, unrotated.
function migrateV1(v1) {
  const s = defaultSave();
  if (!v1 || !Array.isArray(v1.builds)) return s;
  for (const k of ['seed', 'islandRadius', 'sessions', 'focusMs', 'mode', 'buildCounter']) if (v1[k] != null) s[k] = v1[k];
  s.buildings = v1.builds.map((b) => ({ id: s.nextId++, kind: b.kind, variant: b.variant, x: b.ox, z: b.oz, rot: 0 }));
  s.needsLayout = true; // v1 packed builds tightly; main.js re-spaces them once
  return s;
}

export function persist(save) {
  try {
    localStorage.setItem(KEY, JSON.stringify(save));
  } catch {
    /* storage blocked: progress lives only for this tab */
  }
}

export function wipeSave() {
  try {
    localStorage.removeItem(KEY);
    localStorage.removeItem(V1_KEY);
  } catch {}
}
