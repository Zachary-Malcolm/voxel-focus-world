import { hash2 } from './rng.js';
import { ROLE } from './catalog.js';

/*
 * World layouts: one tap rearranges every placed building into a pattern. Each template's setup()
 * returns how Home.planLayout should place them:
 *   order            buildings in placing order (earlier ones get the best spots)
 *   score(x, z, e)   lower is better for building e at cell (x, z)
 *   face(x, z, e)    point the front door should look towards (optional)
 *   keepClear(rect)  true if a building may not cover this rect (optional)
 *   onPlace(e, spot, rect), avenue()  hooks for templates that lay their own roads
 * Spacing, land and water rules still apply (Home.check), roads are re-routed afterwards.
 */

const SHOPS = new Set(['stall', 'bakery', 'well', 'clocktower', 'tavern', 'blacksmith', 'chapel']);
const isTree = (e) => ROLE(e.record.kind) === 'nature';
const isHome = (e) => ROLE(e.record.kind) === 'home';
const area = (e) => {
  const r = e.fp.rect;
  return (r.x1 - r.x0 + 1) * (r.z1 - r.z0 + 1);
};
/** A little organic wobble so rows don't come out ruler-straight. */
const jit = (x, z, salt) => (hash2(x * 73856093 + z * 19349663, salt) / 4294967296) * 0.6;
const radius = (home) => Math.sqrt(home.topCells.size / Math.PI);
const byArea = (asc) => (a, b) => (asc ? area(a) - area(b) : area(b) - area(a));

/** A dry spot well away from the square: where trees gather into a grove. */
function grove(home, sq) {
  const R = radius(home);
  let best = null;
  let bd = -1;
  for (const k of home.topCells) {
    const [x, z] = k.split(',').map(Number);
    if (Math.hypot(x, z) > R * 0.72 || home.cells.get(k)?.water) continue;
    const d = Math.hypot(x - sq.x, z - sq.z);
    if (d > bd) {
      bd = d;
      best = [x, z];
    }
  }
  return best || [sq.x + 6, sq.z];
}

/** Nearest dry cell to a point. */
function dryNear(home, px, pz) {
  let best = [Math.round(px), Math.round(pz)];
  let bd = Infinity;
  for (const k of home.topCells) {
    const c = home.cells.get(k);
    if (c?.water || c?.rim) continue;
    const [x, z] = k.split(',').map(Number);
    const d = Math.hypot(x - px, z - pz);
    if (d < bd) {
      bd = d;
      best = [x, z];
    }
  }
  return best;
}

function ringRound(home, entries, sq, smallFirst) {
  const g = grove(home, sq);
  return {
    order: [...entries.filter((e) => !isTree(e)).sort(byArea(smallFirst)), ...entries.filter(isTree)],
    score: (x, z, e) => (isTree(e) ? Math.hypot(x - g[0], z - g[1]) + jit(x, z, 7) : Math.hypot(x - sq.x, z - sq.z) + jit(x, z, 1)),
    face: (x, z, e) => (isTree(e) ? null : [sq.x, sq.z]),
  };
}

export const LAYOUTS = [
  {
    key: 'green',
    name: 'Village green',
    blurb: 'Cottages and shops gather round the square, big buildings further out, trees in a grove.',
    setup: ({ home, entries, square }) => ringRound(home, entries, square, true),
  },
  {
    key: 'street',
    name: 'High street',
    blurb: 'One long street through the square, shops nearest, doors facing the road.',
    setup({ home, entries, square: sq }) {
      const run = (dx, dz) => {
        let n = 0;
        for (const s of [1, -1])
          for (let t = 1; t < 60; t++) {
            if (!home.topCells.has(`${sq.x + dx * t * s},${sq.z + dz * t * s}`)) break;
            n++;
          }
        return n;
      };
      const ax = run(1, 0) >= run(0, 1) ? 'x' : 'z';
      const along = (x, z) => (ax === 'x' ? x - sq.x : z - sq.z);
      const perp = (x, z) => (ax === 'x' ? z - sq.z : x - sq.x);
      const rank = (e) => (SHOPS.has(e.record.kind) ? 0 : isHome(e) ? 1 : isTree(e) ? 3 : 2);
      let lo = -3;
      let hi = 3;
      return {
        order: [...entries].sort((a, b) => rank(a) - rank(b) || area(a) - area(b)),
        score: (x, z) => Math.abs(perp(x, z)) * 1.6 + Math.abs(along(x, z)) * 0.55 + jit(x, z, 3),
        face: (x, z, e) => (isTree(e) ? null : ax === 'x' ? [x, sq.z] : [sq.x, z]),
        keepClear(r) {
          const p0 = ax === 'x' ? r.z0 - sq.z : r.x0 - sq.x;
          const p1 = ax === 'x' ? r.z1 - sq.z : r.x1 - sq.x;
          return p0 <= 1 && p1 >= -1; // a three-wide strip stays open for the street
        },
        onPlace(e, spot, r) {
          lo = Math.min(lo, ax === 'x' ? r.x0 - sq.x : r.z0 - sq.z);
          hi = Math.max(hi, ax === 'x' ? r.x1 - sq.x : r.z1 - sq.z);
        },
        avenue() {
          const out = [];
          for (const [from, to, step] of [[3, hi, 1], [-3, lo, -1]])
            for (let t = from; step > 0 ? t <= to : t >= to; t += step) {
              const [x, z] = ax === 'x' ? [sq.x + t, sq.z] : [sq.x, sq.z + t];
              if (!home.topCells.has(`${x},${z}`)) break;
              out.push([x, z]);
            }
          return out;
        },
      };
    },
  },
  {
    key: 'hamlets',
    name: 'Hamlets',
    blurb: 'Little clusters of homes around the island, each with its own green, joined by country lanes.',
    setup({ home, entries, square: sq }) {
      const R = radius(home);
      const n = entries.filter((e) => !isTree(e)).length;
      const k = Math.max(2, Math.min(4, Math.round(n / 4)));
      const a0 = Math.atan2(sq.z, sq.x) + Math.PI / k;
      const centres = [];
      for (let i = 0; i < k; i++) {
        const a = a0 + (i * 2 * Math.PI) / k;
        centres.push(dryNear(home, Math.cos(a) * R * 0.56, Math.sin(a) * R * 0.56));
      }
      const order = [...entries].sort((a, b) => isTree(a) - isTree(b) || area(b) - area(a));
      const of = new Map(order.map((e, i) => [e, centres[i % k]]));
      return {
        order,
        score(x, z, e) {
          const [cx, cz] = of.get(e);
          const d = Math.hypot(x - cx, z - cz);
          return d + Math.max(0, 3.5 - d) * 2 + jit(x, z, 4); // keep a little green in the middle
        },
        face: (x, z, e) => (isTree(e) ? null : of.get(e)),
      };
    },
  },
  {
    key: 'citadel',
    name: 'Grand centre',
    blurb: 'Your biggest buildings stand proudly by the square, everything else rings around them.',
    setup: ({ home, entries, square }) => ringRound(home, entries, square, false),
  },
  {
    key: 'country',
    name: 'Countryside',
    blurb: 'Everything spreads out across the island with meadows and woods in between.',
    setup({ home, entries, square: sq }) {
      const R = radius(home);
      const placed = [[sq.x, sq.z]];
      return {
        order: [...entries.filter((e) => !isTree(e)).sort(byArea(false)), ...entries.filter(isTree)],
        score(x, z, e) {
          let dmin = 99;
          for (const [px, pz] of placed) dmin = Math.min(dmin, Math.hypot(x - px, z - pz));
          return -Math.min(dmin, isTree(e) ? 5 : 11) + (Math.hypot(x, z) / R) * 4 + jit(x, z, 5);
        },
        face: (x, z, e) => (isTree(e) ? null : [sq.x, sq.z]),
        onPlace: (e, spot) => placed.push([spot.x, spot.z]),
      };
    },
  },
];

/** Small schematic pictures for the layout cards (inline SVG, 120x80). */
export const LAYOUT_ART = {
  green: `<rect x="50" y="30" width="20" height="20" rx="3" class="la-sq"/>${[[30, 14], [58, 8], [86, 14], [92, 38], [86, 62], [58, 66], [30, 62], [22, 38]].map(([x, y]) => `<rect x="${x - 6}" y="${y - 6}" width="12" height="12" rx="2" class="la-b"/>`).join('')}`,
  street: `<rect x="6" y="37" width="108" height="6" rx="3" class="la-road"/><rect x="52" y="32" width="16" height="16" rx="3" class="la-sq"/>${[18, 36, 84, 102].map((x) => `<rect x="${x - 6}" y="20" width="12" height="12" rx="2" class="la-b"/><rect x="${x - 6}" y="48" width="12" height="12" rx="2" class="la-b"/>`).join('')}`,
  hamlets: `<rect x="53" y="33" width="14" height="14" rx="3" class="la-sq"/>${[[24, 20], [96, 22], [60, 66]].map(([x, y]) => `<rect x="${x - 11}" y="${y - 8}" width="9" height="9" rx="2" class="la-b"/><rect x="${x + 2}" y="${y - 8}" width="9" height="9" rx="2" class="la-b"/><rect x="${x - 4}" y="${y + 3}" width="9" height="9" rx="2" class="la-b"/>`).join('')}`,
  citadel: `<rect x="50" y="34" width="20" height="14" rx="3" class="la-sq"/><rect x="44" y="6" width="32" height="24" rx="3" class="la-big"/>${[[22, 18], [98, 18], [22, 58], [98, 58], [60, 66], [36, 66], [84, 66]].map(([x, y]) => `<rect x="${x - 5}" y="${y - 5}" width="10" height="10" rx="2" class="la-b"/>`).join('')}`,
  country: `<rect x="53" y="33" width="14" height="14" rx="3" class="la-sq"/>${[[16, 14], [100, 10], [104, 62], [20, 64], [62, 8], [74, 68]].map(([x, y]) => `<rect x="${x - 5}" y="${y - 5}" width="10" height="10" rx="2" class="la-b"/>`).join('')}${[[36, 26], [86, 30], [40, 52], [90, 48], [30, 40]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="5" class="la-t"/>`).join('')}`,
};
