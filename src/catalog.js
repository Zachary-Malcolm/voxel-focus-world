// Everything the player can build, cheapest first. price 0 = owned from the start.
// role: 'home' (villagers live there), 'work' (villagers work there), 'nature' (no door, no road).
export const CATALOG = [
  { kind: 'tree', name: 'Tree', price: 0, sessions: 1, role: 'nature' },
  { kind: 'house', name: 'Cottage', price: 0, sessions: 1, role: 'home' },
  { kind: 'tower', name: 'Watchtower', price: 0, sessions: 1, role: 'work' },
  { kind: 'well', name: 'Wishing Well', price: 30, sessions: 1, role: 'work' },
  { kind: 'stall', name: 'Market Stall', price: 45, sessions: 1, role: 'work' },
  { kind: 'mushroomhouse', name: 'Mushroom House', price: 60, sessions: 1, role: 'home' },
  { kind: 'greenhouse', name: 'Greenhouse', price: 75, sessions: 1, role: 'work' },
  { kind: 'bakery', name: 'Bakery', price: 90, sessions: 2, role: 'work' },
  { kind: 'blacksmith', name: 'Blacksmith', price: 100, sessions: 2, role: 'work' },
  { kind: 'stable', name: 'Stable', price: 110, sessions: 2, role: 'work' },
  { kind: 'granary', name: 'Granary', price: 110, sessions: 2, role: 'work' },
  { kind: 'windmill', name: 'Windmill', price: 120, sessions: 2, role: 'work' },
  { kind: 'treehouse', name: 'Treehouse', price: 130, sessions: 2, role: 'home' },
  { kind: 'clocktower', name: 'Clock Tower', price: 150, sessions: 3, role: 'work' },
  { kind: 'tavern', name: 'Tavern', price: 160, sessions: 3, role: 'work' },
  { kind: 'chapel', name: 'Chapel', price: 170, sessions: 3, role: 'work' },
  { kind: 'lighthouse', name: 'Lighthouse', price: 180, sessions: 3, role: 'work' },
  { kind: 'library', name: 'Library', price: 200, sessions: 3, role: 'work' },
  { kind: 'wizardtower', name: 'Wizard Tower', price: 260, sessions: 4, role: 'work' },
  { kind: 'castle', name: 'Castle', price: 400, sessions: 6, role: 'work' },
  { kind: 'cathedral', name: 'Cathedral', price: 600, sessions: 8, role: 'work' },
];

// Small decor: bought with coins straight into the tray (no focus session), as many as you like.
// They may stand right next to buildings and each other, but never on a road, and need no road.
export const DECOR = [
  { kind: 'fence', name: 'Fence', price: 6, blurb: 'Three panels and two posts' },
  { kind: 'lamp', name: 'Lamp Post', price: 8, blurb: 'Glows when the sun goes down' },
  { kind: 'bench', name: 'Bench', price: 10, blurb: 'A seat with a view' },
  { kind: 'flowerbed', name: 'Flower Bed', price: 12, blurb: 'A raised bed in bloom' },
  { kind: 'farmplot', name: 'Farm Plot', price: 20, blurb: 'Wheat, cabbages, pumpkins or carrots' },
];

export const DECOR_KINDS = new Set(DECOR.map((d) => d.kind));
export const isDecor = (kind) => DECOR_KINDS.has(kind);
export const BY_KIND = Object.fromEntries([...CATALOG, ...DECOR].map((c) => [c.kind, c]));
export const NAME = (kind) => BY_KIND[kind]?.name ?? kind;
export const ROLE = (kind) => (isDecor(kind) ? 'decor' : BY_KIND[kind]?.role ?? 'work');
export const STARTER_KINDS = CATALOG.filter((c) => c.price === 0).map((c) => c.kind);

// Economy: 1 coin per focused minute + a bonus for seeing a session through. Only completed sessions pay.
export const SESSION_BONUS = 5;
export function coinsFor(durationMs) {
  return Math.round(durationMs / 60000) + SESSION_BONUS;
}
