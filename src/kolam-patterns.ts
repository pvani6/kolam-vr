/**
 * Sikku (loop) kolam generator.
 *
 * Sikku kolams are "mirror curves": a line travels diagonally between the
 * pulli (dots), wraps around the outer dots, and bounces off imaginary
 * mirrors placed between some neighbouring dots. With the right mirrors the
 * whole kolam is ONE continuous line — the traditional ideal.
 *
 * Coordinates are in "dot units": dots sit on integer points.
 * The line passes through midpoints between neighbouring dots
 * (points with exactly one half-integer coordinate).
 *
 * This module is pure (no Three.js), so it can be tested on its own.
 */

export interface P2 {
  x: number;
  y: number;
  /** Set on path points where the line turns back inside the kolam (a mirror). */
  turn?: boolean;
}

export type MirrorType = 'wall' | 'bridge';

export interface KolamDesign {
  name: string;
  /** Tamil-friendly label shown to the player, e.g. "1-3-5-3-1". */
  label: string;
  dots: P2[];
  /** Internal mirrors keyed by midpoint "x,y" (doubled integer coords). */
  mirrors: Map<string, MirrorType>;
  /**
   * Dots that get a small circle drawn round them. The circle sits inside the
   * woven lattice — the lattice lines still pass all the way round it.
   */
  rings: P2[];
}

export interface KolamPath {
  /** Each loop as a closed polyline through midpoints (dot units). */
  loops: P2[][];
}

const key = (x: number, y: number) => `${x},${y}`;

// ---------------------------------------------------------------------------
// Dot layouts
// ---------------------------------------------------------------------------

/** Rectangular grid, w columns x h rows, (roughly) centred on the origin.
 * Dots stay on integer coordinates. */
export function rectDots(w: number, h: number): P2[] {
  const dots: P2[] = [];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      dots.push({ x: x - Math.floor((w - 1) / 2), y: y - Math.floor((h - 1) / 2) });
  return dots;
}

/** Diamond: rows of 1-3-5-...-(2r+1)-...-5-3-1 dots. */
export function diamondDots(r: number): P2[] {
  const dots: P2[] = [];
  for (let y = -r; y <= r; y++)
    for (let x = -r; x <= r; x++) if (Math.abs(x) + Math.abs(y) <= r) dots.push({ x, y });
  return dots;
}

// ---------------------------------------------------------------------------
// Mirror-curve tracing
// ---------------------------------------------------------------------------

/**
 * Trace every loop of the mirror curve.
 * Internally all coordinates are doubled so midpoints are integers.
 */
export function traceKolam(design: KolamDesign): KolamPath {
  // Doubled dot set (dots must be on a common integer or half-integer lattice).
  const dotSet = new Set(design.dots.map((d) => key(Math.round(d.x * 2), Math.round(d.y * 2))));
  const hasDot = (X: number, Y: number) => dotSet.has(key(X, Y));

  // A midpoint (X,Y) in doubled coords lies between dots (X±1,Y) if X is odd,
  // or (X,Y±1) if Y is odd. (Exactly one of X,Y is odd.)
  const neighbours = (X: number, Y: number): [P2, P2] =>
    X % 2 !== 0
      ? [{ x: X - 1, y: Y }, { x: X + 1, y: Y }]
      : [{ x: X, y: Y - 1 }, { x: X, y: Y + 1 }];

  /** How the line behaves at a midpoint. */
  const behaviour = (X: number, Y: number): 'cross' | MirrorType | null => {
    const [a, b] = neighbours(X, Y);
    const ia = hasDot(a.x, a.y);
    const ib = hasDot(b.x, b.y);
    if (!ia && !ib) return null;
    if (ia !== ib) return 'wall'; // outer edge: wrap around the dot
    return design.mirrors.get(key(X, Y)) ?? 'cross';
  };

  // A diagonal segment from midpoint M to M + d is valid when the dot it
  // curls around (nearest dot to the segment's middle) is part of the kolam.
  const segDot = (X: number, Y: number, dx: number, dy: number): P2 => {
    // Middle of segment in doubled coords = (X + dx/2, Y + dy/2); nearest even/even point.
    const mx = X + dx / 2;
    const my = Y + dy / 2;
    const rx = Math.round(mx / 2) * 2;
    const ry = Math.round(my / 2) * 2;
    return { x: rx, y: ry };
  };
  const segKey = (X: number, Y: number, dx: number, dy: number) => {
    const X2 = X + dx;
    const Y2 = Y + dy;
    return X < X2 || (X === X2 && Y < Y2) ? `${X},${Y}>${X2},${Y2}` : `${X2},${Y2}>${X},${Y}`;
  };

  // Collect every valid segment.
  const segments: { X: number; Y: number; dx: number; dy: number }[] = [];
  const seen = new Set<string>();
  for (const d of design.dots) {
    const DX = Math.round(d.x * 2);
    const DY = Math.round(d.y * 2);
    // The four midpoints around this dot, and the diagonal segments that curl around it.
    const around = [
      { X: DX + 1, Y: DY }, { X: DX, Y: DY + 1 }, { X: DX - 1, Y: DY }, { X: DX, Y: DY - 1 },
    ];
    for (let i = 0; i < 4; i++) {
      const a = around[i];
      const b = around[(i + 1) % 4];
      const k = segKey(a.X, a.Y, b.X - a.X, b.Y - a.Y);
      if (!seen.has(k)) {
        seen.add(k);
        segments.push({ X: a.X, Y: a.Y, dx: b.X - a.X, dy: b.Y - a.Y });
      }
    }
  }

  const visited = new Set<string>();
  const loops: P2[][] = [];

  for (const s of segments) {
    if (visited.has(segKey(s.X, s.Y, s.dx, s.dy))) continue;

    const loop: P2[] = [];
    let X = s.X;
    let Y = s.Y;
    let dx = s.dx;
    let dy = s.dy;
    const startState = `${X},${Y},${dx},${dy}`;
    let guard = 0;

    do {
      const sk = segKey(X, Y, dx, dy);
      const dot = segDot(X, Y, dx, dy);
      if (!hasDot(dot.x, dot.y)) {
        throw new Error(`Kolam "${design.name}": line left the dot area at ${X},${Y}`);
      }
      visited.add(sk);
      const here = behaviour(X, Y);
      const [na, nb] = neighbours(X, Y);
      const innerTurn = here !== null && here !== 'cross' && hasDot(na.x, na.y) && hasDot(nb.x, nb.y);
      loop.push({ x: X / 2, y: Y / 2, turn: innerTurn });

      // Move to the next midpoint.
      X += dx;
      Y += dy;

      const b = behaviour(X, Y);
      if (b === null) throw new Error(`Kolam "${design.name}": reached empty midpoint ${X},${Y}`);
      if (b !== 'cross') {
        // 'wall'   = mirror across the gap between the two dots.
        // 'bridge' = mirror along the gap (joins the two dots).
        const gapIsHorizontal = X % 2 !== 0; // dots left/right of this midpoint
        const flipX = (b === 'wall') === gapIsHorizontal;
        if (flipX) dx = -dx;
        else dy = -dy;
      }
      if (++guard > 100000) throw new Error('Kolam trace did not close');
    } while (`${X},${Y},${dx},${dy}` !== startState);

    loops.push(loop);
  }

  return { loops };
}

// ---------------------------------------------------------------------------
// Smoothing: turn the zig-zag midpoint path into flowing kolam curves
// ---------------------------------------------------------------------------

/**
 * Closed smooth curve through the points (cubic Hermite).
 * `roundness` > 1/3 bulges the line around each dot so the loops look
 * hand-drawn and round, the way real sikku kolams curl around the pulli.
 */
export function smoothLoop(points: P2[], samplesPerSegment = 8, roundness = 0.62): P2[] {
  const n = points.length;
  const out: P2[] = [];
  for (let i = 0; i < n; i++) {
    const p0 = points[(i - 1 + n) % n];
    const p1 = points[i];
    const p2 = points[(i + 1) % n];
    const p3 = points[(i + 2) % n];
    // Tangents (central differences), scaled into Bezier handles.
    const h1x = ((p2.x - p0.x) / 2) * roundness;
    const h1y = ((p2.y - p0.y) / 2) * roundness;
    const h2x = ((p3.x - p1.x) / 2) * roundness;
    const h2y = ((p3.y - p1.y) / 2) * roundness;
    const c1x = p1.x + h1x;
    const c1y = p1.y + h1y;
    const c2x = p2.x - h2x;
    const c2y = p2.y - h2y;
    for (let s = 0; s < samplesPerSegment; s++) {
      const t = s / samplesPerSegment;
      const u = 1 - t;
      const a = u * u * u;
      const b = 3 * u * u * t;
      const c = 3 * u * t * t;
      const d = t * t * t;
      out.push({
        x: a * p1.x + b * c1x + c * c2x + d * p2.x,
        y: a * p1.y + b * c1y + c * c2y + d * p2.y,
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Designs
// ---------------------------------------------------------------------------

/**
 * Add mirrors with 4-fold rotational symmetry (kolams are symmetric).
 * (cx, cy) is the centre of rotation in dot units (0.5, 0.5 for even grids).
 */
function sym4(list: [number, number, MirrorType][], cx = 0, cy = 0): Map<string, MirrorType> {
  const m = new Map<string, MirrorType>();
  const CX = Math.round(cx * 2);
  const CY = Math.round(cy * 2);
  for (const [x, y, t] of list) {
    let X = Math.round(x * 2);
    let Y = Math.round(y * 2);
    for (let r = 0; r < 4; r++) {
      m.set(key(X, Y), t);
      [X, Y] = [CX - (Y - CY), CY + (X - CX)];
    }
  }
  return m;
}

export function design(
  name: string,
  label: string,
  dots: P2[],
  mirrors: Map<string, MirrorType> = new Map(),
  rings: P2[] = [],
): KolamDesign {
  return { name, label, dots, mirrors, rings };
}

/** Number of separate lines a design draws (1 = a true sikku kolam). */
export function loopCount(d: KolamDesign): number {
  return traceKolam(d).loops.length;
}

export { sym4 };

/**
 * Ring the given dots: put a wall on all four sides so the line makes a
 * small circle around each one (a very common kolam motif).
 */
export function ringDots(dots: P2[], base: Map<string, MirrorType> = new Map()): Map<string, MirrorType> {
  const m = new Map(base);
  for (const d of dots) {
    const X = Math.round(d.x * 2);
    const Y = Math.round(d.y * 2);
    for (const [x, y] of [[X + 1, Y], [X - 1, Y], [X, Y + 1], [X, Y - 1]]) m.set(`${x},${y}`, 'wall');
  }
  return m;
}

/** Plus / cross shaped layout: a square centre with arms. */
export function crossDots(arm: number, thick: number): P2[] {
  const dots: P2[] = [];
  const h = Math.floor(thick / 2);
  const r = h + arm;
  for (let y = -r; y <= r; y++)
    for (let x = -r; x <= r; x++) if (Math.abs(x) <= h || Math.abs(y) <= h) dots.push({ x, y });
  return dots;
}

/** Octagon-ish layout: a square with its corners cut. */
export function octagonDots(r: number, cut: number): P2[] {
  const dots: P2[] = [];
  for (let y = -r; y <= r; y++)
    for (let x = -r; x <= r; x++) if (Math.abs(x) + Math.abs(y) <= 2 * r - cut) dots.push({ x, y });
  return dots;
}

/** Radius (in dot spacings) of the small circle drawn round a ringed dot. */
export const RING_RADIUS = 0.22;

/**
 * The finished drawing: every line of the kolam as a smooth closed curve,
 * ready to render. Small loops around a single dot become neat circles.
 */
export function kolamCurves(d: KolamDesign, samplesPerSegment = 10): P2[][] {
  const { loops } = traceKolam(d);
  return loops.map((loop) => {
    if (loop.length === 4) {
      const cx = loop.reduce((a, p) => a + p.x, 0) / 4;
      const cy = loop.reduce((a, p) => a + p.y, 0) / 4;
      const isRing = loop.every((p) => Math.abs(Math.hypot(p.x - cx, p.y - cy) - 0.5) < 1e-6);
      if (isRing) {
        const n = 4 * samplesPerSegment;
        return Array.from({ length: n }, (_, i) => {
          const a = (i / n) * Math.PI * 2;
          return { x: cx + Math.cos(a) * RING_RADIUS, y: cy + Math.sin(a) * RING_RADIUS };
        });
      }
    }
    return kolamLoop(loop, samplesPerSegment);
  }).concat(
    d.rings.map((c) => {
      const n = 4 * samplesPerSegment;
      return Array.from({ length: n }, (_, i) => {
        const a = (i / n) * Math.PI * 2;
        return { x: c.x + Math.cos(a) * RING_RADIUS, y: c.y + Math.sin(a) * RING_RADIUS };
      });
    }),
  );
}

/**
 * At an inner turn two strands of the line meet at the same point. In a real
 * kolam they never touch: each strand curves back before the meeting point.
 * Pull every turn point towards its own strand so a clear gap opens up.
 */
export const TURN_GAP = 0.3;
function separateTurns(loop: P2[]): P2[] {
  const n = loop.length;
  return loop.map((p, i) => {
    if (!p.turn) return p;
    const a = loop[(i - 1 + n) % n];
    const b = loop[(i + 1) % n];
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    return { x: p.x + (mx - p.x) * TURN_GAP, y: p.y + (my - p.y) * TURN_GAP };
  });
}

/**
 * Draw one kolam line the traditional way.
 *
 * The line moves between the midpoints of neighbouring dots. Where it goes
 * straight through a midpoint (a crossing) it is a straight diagonal; where it
 * turns, it curls round the dot it is passing as a circular arc centred on
 * that dot. Each piece is a cubic Bezier whose end tangents are set that way,
 * which gives straight crossings and round, centred loops.
 */
export function kolamLoop(loop: P2[], samplesPerSegment = 10): P2[] {
  const n = loop.length;
  // 1) Where the line turns between two dots, two strands meet at the same
  //    midpoint. Pull each strand back towards its own side so they never touch.
  const pos = loop.map((p, i) => {
    if (!p.turn) return p;
    const a = loop[(i - 1 + n) % n];
    const b = loop[(i + 1) % n];
    return { x: p.x + ((a.x + b.x) / 2 - p.x) * TURN_GAP, y: p.y + ((a.y + b.y) / 2 - p.y) * TURN_GAP };
  });
  // 2) Tangent at each point: along the direction from the previous to the next
  //    point. This is straight through a crossing and round a dot at a turn.
  const tan = loop.map((_, i) => {
    const a = loop[(i - 1 + n) % n];
    const b = loop[(i + 1) % n];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const l = Math.hypot(dx, dy) || 1;
    return { x: dx / l, y: dy / l };
  });
  const out: P2[] = [];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const a = pos[i];
    const b = pos[j];
    const h = Math.hypot(b.x - a.x, b.y - a.y) * 0.39; // ≈ circular arc for a quarter turn
    const c1 = { x: a.x + tan[i].x * h, y: a.y + tan[i].y * h };
    const c2 = { x: b.x - tan[j].x * h, y: b.y - tan[j].y * h };
    for (let k = 0; k < samplesPerSegment; k++) {
      const t = k / samplesPerSegment;
      const u = 1 - t;
      const w0 = u * u * u;
      const w1 = 3 * u * u * t;
      const w2 = 3 * u * t * t;
      const w3 = t * t * t;
      out.push({ x: w0 * a.x + w1 * c1.x + w2 * c2.x + w3 * b.x, y: w0 * a.y + w1 * c1.y + w2 * c2.y + w3 * b.y });
    }
  }
  return out;
}
