/**
 * The game's levels, built from the pulli kolam catalogue.
 *
 * Levels are grouped by dot family and ordered by difficulty — from 3-1 and
 * 2 x 2 dots up to 13-1 dots — the way kolams are traditionally learned.
 * Every drawing is produced by our own generator (kolam-patterns.ts).
 */

import { CATALOG } from './kolam-catalog.js';
import { crossDots, design, diamondDots, octagonDots, rectDots, ringDots, type KolamDesign, type P2 } from './kolam-patterns.js';
import type { Layout } from './kolam-catalog.js';

/** Friendly names, cycled through the designs of each family. */
const NAMES = [
  'Malligai', // jasmine
  'Thamarai', // lotus
  'Vilakku', // lamp
  'Maavilai', // mango leaf
  'Kolusu', // anklet
  'Thoranam', // doorway garland
  'Pongal Paanai', // pongal pot
  'Muthu', // pearl
  'Sooriyan', // sun
  'Nila', // moon
  'Mayil', // peacock
  'Kuthu Vilakku', // standing lamp
];

export interface Level extends KolamDesign {
  family: string;
  /** 1-based position of this design within its family, and the family size. */
  variant: number;
  variants: number;
}

export function dotsFor(l: Layout): P2[] {
  switch (l.type) {
    case 'rect':
      return rectDots(l.w, l.h);
    case 'diamond':
      return diamondDots(l.r);
    case 'octagon':
      return octagonDots(l.r, l.cut);
    case 'cross':
      return crossDots(l.arm, l.thick);
  }
}

function build(): Level[] {
  const counts = new Map<string, number>();
  for (const e of CATALOG) counts.set(e.family, (counts.get(e.family) ?? 0) + 1);

  const seen = new Map<string, number>();
  return CATALOG.map((e, i) => {
    const dots = dotsFor(e.layout);
    const variant = (seen.get(e.family) ?? 0) + 1;
    seen.set(e.family, variant);
    const name = NAMES[i % NAMES.length];
    return {
      ...design(name, e.style === 'woven' ? e.family : `${e.family} · ${e.style}`, dots, ringDots(e.circled.map(([x, y]) => ({ x, y })))),
      family: e.family,
      variant,
      variants: counts.get(e.family) ?? 1,
    };
  });
}

export const LEVELS: Level[] = build();
