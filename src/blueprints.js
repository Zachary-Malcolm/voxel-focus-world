import { mulberry32 } from './rng.js';
import { BUILDERS as NEW_BUILDERS } from './builds.js';
import { FANTASY_BUILDERS } from './builds-fantasy.js';

// Builders (src/builds.js) return blocks in drop order. They may also attach metadata to the array:
//   spin:  { pivot: [x,y,z], axis: 'x'|'z' } for blocks flagged spin:true (windmill sails)
//   smoke: [[x,y,z], ...] chimney tops that puff smoke once the building stands
// Saved buildings are rebuilt from kind + variant, so editing a builder restyles every copy.

/** Rotate a cell around the build origin in 90° steps (rot 0..3). */
export function rotateXZ(x, z, rot) {
  switch (rot & 3) {
    case 0:
      return [x, z];
    case 1:
      return [-z, x];
    case 2:
      return [-x, -z];
    default:
      return [z, -x];
  }
}

/** Blocks relative to the build origin, in drop order (bottom first). y=1 sits on the grass. */
export function blueprint(kind, variant) {
  const rng = mulberry32(variant);
  return BUILDERS[kind](rng);
}

const BUILDERS = { ...NEW_BUILDERS, ...FANTASY_BUILDERS };
