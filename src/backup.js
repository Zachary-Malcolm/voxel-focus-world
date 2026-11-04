/*
 * Keeping a village safe. Everything lives in this browser's localStorage, which a cleared cache or a
 * phone tidy-up can wipe, so:
 *   - export: a .json file, or a short text code (gzipped + base64url) to paste on another device
 *   - import: a file or a code, checked before it replaces anything; the village it replaces is kept
 *   - snapshots: one automatic copy per day for the last few days, in case something goes wrong
 *   - keepStorage(): asks the browser not to evict our storage (silent in Chrome for engaged sites)
 */

import { isDecor } from './catalog.js';

const CODE_GZ = 'VFW1.'; // gzip + base64url
const CODE_RAW = 'VFW0.'; // plain base64url (browsers without CompressionStream)
const SNAPSHOTS = 'vfw.save.snapshots';
const BEFORE_RESTORE = 'vfw.save.before-restore';
const KEEP_DAYS = 3;

/** What goes into a backup: the save without a session in progress (that would end at once on import). */
function exportable(save) {
  return { ...save, session: null };
}

function toB64url(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(text) {
  const b = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
  return out;
}

async function pipe(bytes, stream) {
  const res = new Response(new Blob([bytes]).stream().pipeThrough(stream));
  return new Uint8Array(await res.arrayBuffer());
}

/** A village as a text code. */
export async function encode(save) {
  const bytes = new TextEncoder().encode(JSON.stringify(exportable(save)));
  if (typeof CompressionStream === 'function') return CODE_GZ + toB64url(await pipe(bytes, new CompressionStream('gzip')));
  return CODE_RAW + toB64url(bytes);
}

/** A village from a code or a file's text. Throws an Error with a friendly message if it isn't one. */
export async function decode(text) {
  const t = String(text || '').trim();
  if (!t) throw new Error('Paste a village code or choose a file first.');
  let json;
  try {
    if (t.startsWith('{')) json = t;
    else {
      const body = t.replace(/\s+/g, '');
      if (body.startsWith(CODE_GZ)) {
        if (typeof DecompressionStream !== 'function') throw new Error('This browser can’t open compressed codes. Try a file instead.');
        json = new TextDecoder().decode(await pipe(fromB64url(body.slice(CODE_GZ.length)), new DecompressionStream('gzip')));
      } else if (body.startsWith(CODE_RAW)) json = new TextDecoder().decode(fromB64url(body.slice(CODE_RAW.length)));
      else throw new Error('That doesn’t look like a village code. Codes start with VFW.');
    }
  } catch (err) {
    throw err instanceof Error && err.message.includes('VFW') ? err : new Error('That code seems to be cut short or changed. Copy it again in full.');
  }
  let data;
  try {
    data = JSON.parse(json);
  } catch {
    throw new Error('That file isn’t a village backup.');
  }
  if (!data || data.version !== 2 || !Array.isArray(data.buildings) || typeof data.seed !== 'number')
    throw new Error('That file isn’t a Voxel Focus World village.');
  return data;
}

/** Short description of a village, for "this will bring back…". */
export function describe(data) {
  const n = (data.buildings || []).filter((b) => !isDecor(b.kind)).length;
  const min = Math.floor((data.focusMs || 0) / 60000);
  const focus = min < 60 ? `${min}m` : `${Math.floor(min / 60)}h ${min % 60}m`;
  return `${n} building${n === 1 ? '' : 's'}, ${focus} focused, ${data.coins ?? 0} coins`;
}

export function download(save) {
  const d = new Date();
  const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const blob = new Blob([JSON.stringify(exportable(save))], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `voxel-focus-world-${day}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/** Replace the stored village with `data` (the current one is kept under BEFORE_RESTORE). Reload afterwards. */
export function restore(data, storeKey) {
  try {
    const cur = localStorage.getItem(storeKey);
    if (cur) localStorage.setItem(BEFORE_RESTORE, cur);
    localStorage.setItem(storeKey, JSON.stringify({ ...data, session: null }));
    return true;
  } catch {
    return false;
  }
}

/** The village as it was before the last restore, if any. */
export function beforeRestore() {
  try {
    const raw = localStorage.getItem(BEFORE_RESTORE);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/** Keep one copy per day for the last few days (newest first: [{ day, data }]). */
export function snapshot(save, day) {
  try {
    const list = snapshots().filter((s) => s.day !== day);
    list.unshift({ day, data: exportable(save) });
    localStorage.setItem(SNAPSHOTS, JSON.stringify(list.slice(0, KEEP_DAYS)));
  } catch {
    /* storage full or blocked: snapshots are a bonus */
  }
}

export function snapshots() {
  try {
    const list = JSON.parse(localStorage.getItem(SNAPSHOTS) || '[]');
    return Array.isArray(list) ? list.filter((s) => s && s.day && s.data) : [];
  } catch {
    return [];
  }
}

/** Ask the browser not to clear our storage when space runs low (Chrome decides silently). */
export async function keepStorage() {
  try {
    if (navigator.storage?.persist && !(await navigator.storage.persisted())) await navigator.storage.persist();
  } catch {
    /* not supported */
  }
}
